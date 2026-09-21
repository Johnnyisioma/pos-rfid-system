/**
 * Registers, shifts, and the cash-out.
 *
 * The important design decision in here is the BLIND COUNT.
 *
 * A till that shows the cashier what it expects before they count is not an
 * audit — it is a target. The cashier counts, sees they are ₦2,000 light,
 * finds ₦2,000, and the drawer balances every single day. The variance you
 * needed to see never appears.
 *
 * So by default the expected figure is withheld until the count is submitted,
 * and it is withheld at the API, not in the interface: a cashier's
 * /sessions/current simply does not contain the number. Someone with
 * register.audit sees everything, always — that is the manager checking a
 * drawer, not the person responsible for it.
 *
 * X and Z reports are the other half. Both are stored rather than recomputed,
 * because "what did the till say at four o'clock" is asked after the fact, and
 * a figure recalculated from a database that has moved on since is a different
 * answer to the one that was on the paper.
 */
import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, num, int, money } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { can } from '../lib/permissions.js';

const r = Router();

/** Can this person be shown the expected cash before counting it? */
const isAuditor = (req) => can(req.user?.role, 'register.audit');

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

/**
 * Everything the till has taken this shift.
 *
 * `reveal` decides whether the expected-cash figures are included. It is never
 * the caller's choice — see the note at the top of this file.
 */
async function sessionSummary(sessionId, { reveal = true } = {}) {
  const session = await one(
    `SELECT rs.*, rg.name AS register_name, l.name AS location_name, u.name AS user_name,
            cu.name AS counted_by_name, au.name AS approved_by_name
       FROM register_sessions rs
       JOIN registers rg ON rg.id=rs.register_id
       JOIN locations l ON l.id=rs.location_id
       LEFT JOIN users u ON u.id=rs.user_id
       LEFT JOIN users cu ON cu.id=rs.counted_by
       LEFT JOIN users au ON au.id=rs.approved_by WHERE rs.id=$1`, [sessionId]);
  if (!session) return null;

  const byMethod = await many(
    `SELECT p.method, COALESCE(SUM(p.amount),0) AS amount, COUNT(*)::int AS count
       FROM payments p JOIN sales s ON s.id=p.sale_id
      WHERE s.register_session_id=$1 GROUP BY p.method ORDER BY p.method`, [sessionId]);
  const sales = await one(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(total),0) AS total,
            COALESCE(SUM(tax_amount),0) AS tax, COALESCE(SUM(discount_amount),0) AS discounts,
            COALESCE(SUM(change_due),0) AS change_given,
            COALESCE(SUM(cost_total),0) AS cost
       FROM sales WHERE register_session_id=$1 AND status IN ('completed','partially_refunded','refunded')`,
    [sessionId]);
  const refunds = await one(
    `SELECT COALESCE(SUM(sr.total_refund),0) AS total, COUNT(*)::int AS count
       FROM sale_returns sr JOIN sales s ON s.id=sr.original_sale_id
      WHERE s.register_session_id=$1`, [sessionId]);
  const voids = await one(
    `SELECT COUNT(*)::int AS count FROM sales
      WHERE register_session_id=$1 AND status='cancelled'`, [sessionId]);
  const movements = await many(
    `SELECT m.*, u.name AS user_name FROM register_cash_movements m
       LEFT JOIN users u ON u.id=m.user_id
      WHERE m.session_id=$1 ORDER BY m.created_at`, [sessionId]);

  const cashIn = Number(byMethod.find((m) => m.method === 'cash')?.amount || 0);
  const paidIn = movements.filter((m) => m.direction === 'in')
    .reduce((s, m) => s + Number(m.amount), 0);
  const paidOut = movements.filter((m) => m.direction === 'out')
    .reduce((s, m) => s + Number(m.amount), 0);

  // Refunds paid in cash leave the drawer. Anything refunded to card or store
  // credit never was in it.
  const cashRefunds = Number(refunds.total || 0);

  const expected = money(
    Number(session.opening_cash) + cashIn + paidIn - paidOut
    - Number(sales.change_given) - cashRefunds);

  const base = {
    ...session,
    by_method: byMethod, sales, refunds, voids,
    movements, cash_in: cashIn, paid_in: money(paidIn), paid_out: money(paidOut),
    blind: Boolean(session.blind_count) && !reveal,
  };

  if (!reveal && session.status === 'open' && session.counted_cash === null) {
    // Withheld deliberately, and the keys are DELETED rather than set to null.
    // register_sessions carries expected_cash and difference as real columns,
    // so they arrive here from the row spread; leaving them as null would let
    // an interface render a confident-looking blank where the figure was.
    delete base.expected_cash;
    delete base.difference;
    return base;
  }
  return { ...base, expected_cash: expected, cash_refunds: money(cashRefunds) };
}

/** The same numbers, as the object stored on an X or Z report. */
async function reportPayload(sessionId) {
  const s = await sessionSummary(sessionId, { reveal: true });
  return {
    session_id: s.id,
    register: s.register_name,
    location: s.location_name,
    cashier: s.user_name,
    opened_at: s.opened_at,
    taken_at: new Date().toISOString(),
    opening_cash: Number(s.opening_cash),
    by_method: s.by_method,
    sales: s.sales,
    refunds: s.refunds,
    voids: s.voids,
    paid_in: s.paid_in,
    paid_out: s.paid_out,
    change_given: Number(s.sales.change_given || 0),
    expected_cash: s.expected_cash,
    counted_cash: s.counted_cash === null ? null : Number(s.counted_cash),
    difference: s.difference === null ? null : Number(s.difference),
  };
}

r.post('/:id(\\d+)/open', requirePerm('register.open'), h(async (req, res) => {
  const registerId = int(req.params.id);
  const reg = await one('SELECT * FROM registers WHERE id=$1', [registerId]);
  if (!reg) throw notFound('Register not found');
  const open = await one("SELECT * FROM register_sessions WHERE register_id=$1 AND status='open'", [registerId]);
  if (open) throw bad('That register already has an open session');

  // Blind by default. A shop can turn it off per shift, but it has to be an
  // explicit choice rather than the path of least resistance.
  const blind = req.body.blind_count === false ? false : true;

  const session = await one(
    `INSERT INTO register_sessions (register_id, location_id, user_id, opening_cash, notes, blind_count)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [registerId, reg.location_id, req.user.id,
     money(num(req.body.opening_cash, 0)), str(req.body.notes), blind]);
  await audit(req, 'open', 'register_session', session.id, {
    opening_cash: session.opening_cash, blind_count: blind });
  res.status(201).json(await sessionSummary(session.id, { reveal: isAuditor(req) || !blind }));
}));

r.get('/sessions/current', h(async (req, res) => {
  const row = await one(
    `SELECT id, blind_count FROM register_sessions
      WHERE user_id=$1 AND location_id=$2 AND status='open' ORDER BY id DESC LIMIT 1`,
    [req.user.id, req.locationId]);
  if (!row) return res.json(null);
  res.json(await sessionSummary(row.id, { reveal: isAuditor(req) || !row.blind_count }));
}));

r.get('/sessions/:id(\\d+)', h(async (req, res) => {
  const id = int(req.params.id);
  const row = await one('SELECT blind_count, status, counted_cash FROM register_sessions WHERE id=$1', [id]);
  if (!row) throw notFound('Session not found');
  const reveal = isAuditor(req) || !row.blind_count || row.counted_cash !== null;
  res.json(await sessionSummary(id, { reveal }));
}));

r.get('/sessions', h(async (req, res) => {
  const rows = await many(
    `SELECT rs.*, rg.name AS register_name, u.name AS user_name, l.name AS location_name
       FROM register_sessions rs
       JOIN registers rg ON rg.id=rs.register_id
       JOIN locations l ON l.id=rs.location_id
       LEFT JOIN users u ON u.id=rs.user_id
      WHERE rs.location_id=$1 ORDER BY rs.id DESC LIMIT 50`, [req.locationId]);
  // A list of past shifts is management information; hide the variance from
  // anyone who is not allowed to see it rather than hiding the whole page.
  if (isAuditor(req)) return res.json(rows);
  res.json(rows.map((s) => (s.counted_cash === null && s.blind_count
    ? { ...s, expected_cash: undefined, difference: undefined }
    : s)));
}));

/* ------------------------------------------------------------------ */
/*  Cash in and out of the drawer that is not a sale                    */
/* ------------------------------------------------------------------ */

/**
 * A float top-up, a payout to a delivery rider, a drop to the safe.
 *
 * Without these the expected figure is wrong every time someone takes money
 * out of the till for a legitimate reason, and a drawer that is "wrong" for a
 * known reason teaches everyone to ignore the variance.
 */
r.post('/sessions/:id(\\d+)/cash', requirePerm('register.open'), h(async (req, res) => {
  const id = int(req.params.id);
  const session = await one('SELECT * FROM register_sessions WHERE id=$1', [id]);
  if (!session) throw notFound('Session not found');
  if (session.status !== 'open') throw bad('That shift is closed.');

  const direction = str(req.body.direction) === 'out' ? 'out' : 'in';
  const amount = money(num(req.body.amount, 0));
  if (amount <= 0) throw bad('Enter an amount.');
  const reason = str(req.body.reason);
  if (!reason) throw bad('Say what this is for — an unexplained payout is exactly what this is meant to prevent.');

  const row = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO register_cash_movements (session_id, direction, amount, reason, user_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`, [id, direction, amount, reason, req.user.id]);
    await c.query(
      `UPDATE register_sessions
          SET cash_in = cash_in + $2, cash_out = cash_out + $3 WHERE id=$1`,
      [id, direction === 'in' ? amount : 0, direction === 'out' ? amount : 0]);
    return rows[0];
  });

  await audit(req, 'cash_movement', 'register_session', id, { direction, amount, reason });
  res.status(201).json(row);
}));

/* ------------------------------------------------------------------ */
/*  X and Z reports                                                     */
/* ------------------------------------------------------------------ */

/**
 * X report — a snapshot, taken mid-shift, that changes nothing.
 *
 * Typically taken at a handover, or when a manager wants to know where the
 * till is without closing it. Needs register.audit, because it contains the
 * expected-cash figure the blind count exists to withhold.
 */
r.post('/sessions/:id(\\d+)/x-report', requirePerm('register.audit'), h(async (req, res) => {
  const id = int(req.params.id);
  const session = await one('SELECT * FROM register_sessions WHERE id=$1', [id]);
  if (!session) throw notFound('Session not found');

  const payload = await reportPayload(id);
  const row = await one(
    `INSERT INTO register_reports (session_id, kind, payload, user_id)
     VALUES ($1,'X',$2,$3) RETURNING *`, [id, JSON.stringify(payload), req.user.id]);
  await audit(req, 'x_report', 'register_session', id, { expected: payload.expected_cash });
  res.status(201).json({ ...row, payload });
}));

r.get('/sessions/:id(\\d+)/reports', requirePerm('register.audit'), h(async (req, res) => {
  const rows = await many(
    `SELECT rr.*, u.name AS user_name FROM register_reports rr
       LEFT JOIN users u ON u.id=rr.user_id
      WHERE rr.session_id=$1 ORDER BY rr.created_at DESC`, [int(req.params.id)]);
  res.json(rows);
}));

/**
 * Submit the count.
 *
 * This is the moment the blind ends: the cashier says what is in the drawer,
 * and only then does the system say what it expected. Splitting it from the
 * close means a manager can require a reason for a variance before the shift
 * is allowed to end.
 */
r.post('/sessions/:id(\\d+)/count', requirePerm('register.close'), h(async (req, res) => {
  const id = int(req.params.id);
  const before = await sessionSummary(id, { reveal: true });
  if (!before) throw notFound('Session not found');
  if (before.status !== 'open') throw bad('That shift is already closed.');

  // Counting by denomination is optional, but when it is provided it has to
  // add up to the figure being submitted — a mismatch there is a typo, and a
  // typo in a cash count is the thing everyone spends the evening chasing.
  const denominations = req.body.denominations && typeof req.body.denominations === 'object'
    ? req.body.denominations : null;
  let counted = money(num(req.body.counted_cash, 0));
  if (denominations) {
    const fromNotes = money(Object.entries(denominations)
      .reduce((s, [note, qty]) => s + (Number(note) || 0) * (Number(qty) || 0), 0));
    if (req.body.counted_cash === undefined) counted = fromNotes;
    else if (Math.abs(fromNotes - counted) > 0.009) {
      throw bad(`The notes add up to ${fromNotes}, but the total entered is ${counted}.`);
    }
  }

  const expected = Number(before.expected_cash);
  const row = await one(
    `UPDATE register_sessions
        SET counted_cash=$2, expected_cash=$3, difference=$4,
            counted_at=now(), counted_by=$5, denominations=$6,
            variance_reason = CASE WHEN $7='' THEN variance_reason ELSE $7 END
      WHERE id=$1 RETURNING *`,
    [id, counted, expected, money(counted - expected), req.user.id,
     denominations ? JSON.stringify(denominations) : null, str(req.body.variance_reason)]);

  await audit(req, 'count', 'register_session', id, {
    expected, counted, difference: row.difference });

  res.json(await sessionSummary(id, { reveal: true }));
}));

/**
 * Close the shift and cut the Z report.
 *
 * Z numbers are sequential per location and never reused — that sequence is
 * what makes a missing Z report visible. Taking the number inside the
 * transaction, against a locked row, is what stops two tills closing at the
 * same moment and both taking Z-41.
 */
r.post('/sessions/:id(\\d+)/close', requirePerm('register.close'), h(async (req, res) => {
  const id = int(req.params.id);
  const summary = await sessionSummary(id, { reveal: true });
  if (!summary) throw notFound('Session not found');
  if (summary.status !== 'open') throw bad('That session is already closed');

  const counted = req.body.counted_cash !== undefined
    ? money(num(req.body.counted_cash, 0))
    : (summary.counted_cash === null ? null : Number(summary.counted_cash));
  if (counted === null) throw bad('Count the drawer before closing the shift.');

  const expected = Number(summary.expected_cash);
  const difference = money(counted - expected);

  // A variance nobody has to explain is a variance nobody looks at.
  const reason = str(req.body.variance_reason) || summary.variance_reason || '';
  if (Math.abs(difference) >= 1 && !reason) {
    throw bad(`The drawer is ${difference > 0 ? 'over' : 'short'} by ${Math.abs(difference)}. `
      + 'Give a reason before closing — it is kept with the shift.');
  }

  const out = await tx(async (c) => {
    const { rows: locked } = await c.query(
      'SELECT * FROM register_sessions WHERE id=$1 FOR UPDATE', [id]);
    if (locked[0].status !== 'open') throw bad('That session is already closed');

    const { rows: seq } = await c.query(
      `SELECT COALESCE(MAX(z_number), 0) + 1 AS next
         FROM register_sessions WHERE location_id=$1`, [locked[0].location_id]);
    const zNumber = Number(seq[0].next);

    const denominations = req.body.denominations && typeof req.body.denominations === 'object'
      ? JSON.stringify(req.body.denominations) : null;
    const { rows } = await c.query(
      `UPDATE register_sessions
          SET status='closed', closed_at=now(), counted_cash=$2, expected_cash=$3,
              difference=$4, z_number=$5,
              counted_at = COALESCE(counted_at, now()),
              counted_by = COALESCE(counted_by, $6),
              variance_reason = CASE WHEN $7='' THEN variance_reason ELSE $7 END,
              notes = CASE WHEN $8='' THEN notes ELSE $8 END,
              denominations = COALESCE($9::jsonb, denominations)
        WHERE id=$1 RETURNING *`,
      [id, counted, expected, difference, zNumber, req.user.id, reason, str(req.body.notes), denominations]);
    return rows[0];
  });

  const payload = { ...(await reportPayload(id)), z_number: out.z_number, kind: 'Z' };
  const report = await one(
    `INSERT INTO register_reports (session_id, kind, seq, payload, user_id)
     VALUES ($1,'Z',$2,$3,$4) RETURNING *`,
    [id, out.z_number, JSON.stringify(payload), req.user.id]);

  await audit(req, 'close', 'register_session', id, {
    expected, counted, difference, z_number: out.z_number });

  res.json({ ...(await sessionSummary(id, { reveal: true })), z_report: { ...report, payload } });
}));

/** A manager signing off a variance after the fact. */
r.post('/sessions/:id(\\d+)/approve', requirePerm('register.audit'), h(async (req, res) => {
  const id = int(req.params.id);
  const row = await one(
    `UPDATE register_sessions SET approved_by=$2, approved_at=now(),
            variance_reason = CASE WHEN $3='' THEN variance_reason ELSE $3 END
      WHERE id=$1 RETURNING *`, [id, req.user.id, str(req.body.variance_reason)]);
  if (!row) throw notFound('Session not found');
  await audit(req, 'approve', 'register_session', id, { difference: row.difference });
  res.json(await sessionSummary(id, { reveal: true }));
}));

export default r;
