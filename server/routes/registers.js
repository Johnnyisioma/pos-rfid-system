import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, num, int, money } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const r = Router();

r.get('/', h(async (req, res) => {
  const rows = await many(
    `SELECT rg.*, l.name AS location_name,
            (SELECT row_to_json(x) FROM (
               SELECT rs.id, rs.opened_at, rs.opening_cash, u.name AS user_name
                 FROM register_sessions rs LEFT JOIN users u ON u.id=rs.user_id
                WHERE rs.register_id=rg.id AND rs.status='open' ORDER BY rs.id DESC LIMIT 1) x
            ) AS open_session
       FROM registers rg JOIN locations l ON l.id=rg.location_id
      WHERE rg.location_id=$1 AND rg.is_active ORDER BY rg.name`, [req.locationId]);
  res.json(rows);
}));

r.post('/', requirePerm('settings.write'), h(async (req, res) => {
  const row = await one(
    'INSERT INTO registers (location_id, name) VALUES ($1,$2) RETURNING *',
    [int(req.body.location_id, req.locationId), str(req.body.name, 'Counter 1')]);
  res.status(201).json(row);
}));

/** Cash position of an open session, computed from its payments. */
async function sessionSummary(sessionId) {
  const session = await one(
    `SELECT rs.*, rg.name AS register_name, l.name AS location_name, u.name AS user_name
       FROM register_sessions rs
       JOIN registers rg ON rg.id=rs.register_id
       JOIN locations l ON l.id=rs.location_id
       LEFT JOIN users u ON u.id=rs.user_id WHERE rs.id=$1`, [sessionId]);
  if (!session) return null;
  const byMethod = await many(
    `SELECT p.method, COALESCE(SUM(p.amount),0) AS amount, COUNT(*)::int AS count
       FROM payments p JOIN sales s ON s.id=p.sale_id
      WHERE s.register_session_id=$1 GROUP BY p.method ORDER BY p.method`, [sessionId]);
  const sales = await one(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(total),0) AS total,
            COALESCE(SUM(tax_amount),0) AS tax, COALESCE(SUM(discount_amount),0) AS discounts,
            COALESCE(SUM(change_due),0) AS change_given
       FROM sales WHERE register_session_id=$1 AND status IN ('completed','partially_refunded','refunded')`,
    [sessionId]);
  const refunds = await one(
    `SELECT COALESCE(SUM(sr.total_refund),0) AS total, COUNT(*)::int AS count
       FROM sale_returns sr JOIN sales s ON s.id=sr.original_sale_id
      WHERE s.register_session_id=$1`, [sessionId]);
  const cashIn = Number(byMethod.find((m) => m.method === 'cash')?.amount || 0);
  const expected = money(Number(session.opening_cash) + cashIn - Number(sales.change_given));
  return { ...session, by_method: byMethod, sales, refunds, cash_in: cashIn, expected_cash: expected };
}

r.post('/:id/open', requirePerm('register.open'), h(async (req, res) => {
  const registerId = int(req.params.id);
  const reg = await one('SELECT * FROM registers WHERE id=$1', [registerId]);
  if (!reg) throw notFound('Register not found');
  const open = await one("SELECT * FROM register_sessions WHERE register_id=$1 AND status='open'", [registerId]);
  if (open) throw bad('That register already has an open session');
  const session = await one(
    `INSERT INTO register_sessions (register_id, location_id, user_id, opening_cash, notes)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [registerId, reg.location_id, req.user.id, money(num(req.body.opening_cash, 0)), str(req.body.notes)]);
  await audit(req, 'open', 'register_session', session.id, { opening_cash: session.opening_cash });
  res.status(201).json(await sessionSummary(session.id));
}));

r.get('/sessions/current', h(async (req, res) => {
  const row = await one(
    `SELECT id FROM register_sessions
      WHERE user_id=$1 AND location_id=$2 AND status='open' ORDER BY id DESC LIMIT 1`,
    [req.user.id, req.locationId]);
  res.json(row ? await sessionSummary(row.id) : null);
}));

r.get('/sessions/:id', h(async (req, res) => {
  const s = await sessionSummary(int(req.params.id));
  if (!s) throw notFound('Session not found');
  res.json(s);
}));

r.get('/sessions', h(async (req, res) => {
  const rows = await many(
    `SELECT rs.*, rg.name AS register_name, u.name AS user_name, l.name AS location_name
       FROM register_sessions rs
       JOIN registers rg ON rg.id=rs.register_id
       JOIN locations l ON l.id=rs.location_id
       LEFT JOIN users u ON u.id=rs.user_id
      WHERE rs.location_id=$1 ORDER BY rs.id DESC LIMIT 50`, [req.locationId]);
  res.json(rows);
}));

r.post('/sessions/:id/close', requirePerm('register.close'), h(async (req, res) => {
  const id = int(req.params.id);
  const summary = await sessionSummary(id);
  if (!summary) throw notFound('Session not found');
  if (summary.status !== 'open') throw bad('That session is already closed');
  const counted = money(num(req.body.counted_cash, 0));
  const expected = Number(summary.expected_cash);
  const row = await one(
    `UPDATE register_sessions
        SET status='closed', closed_at=now(), counted_cash=$2, expected_cash=$3,
            difference=$4, notes = CASE WHEN $5='' THEN notes ELSE $5 END
      WHERE id=$1 RETURNING *`,
    [id, counted, expected, money(counted - expected), str(req.body.notes)]);
  await audit(req, 'close', 'register_session', id, {
    expected, counted, difference: row.difference });
  res.json({ ...(await sessionSummary(id)), ...row });
}));

export default r;
