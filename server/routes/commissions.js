/**
 * Sales-rep commission.
 *
 * The part everyone forgets is the clawback. Commission gets paid on a sale;
 * the customer brings the shoes back three weeks later; the commission has
 * already been earned and, usually, already been paid. Every shop that runs
 * commission on a spreadsheet discovers this once.
 *
 * So this is a ledger, not a total. A sale writes a positive row; a return
 * writes a negative one that references it. Nothing is ever edited, which is
 * what makes "why is my commission ₦4,000 less this month" answerable.
 */
import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, num, int, money, paging } from '../lib/util.js';
import { requirePerm, requireFeature } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const r = Router();
r.use(requireFeature('commissions'));

/* ---------------- rules ---------------- */

r.get('/rules', requirePerm('commissions.read'), h(async (req, res) => {
  const rows = await many(
    `SELECT cr.*, u.name AS user_name FROM commission_rules cr
       LEFT JOIN users u ON u.id=cr.user_id
      ORDER BY cr.is_active DESC, cr.name`);
  res.json(rows);
}));

r.post('/rules', requirePerm('commissions.write'), h(async (req, res) => {
  const basis = str(req.body.basis) || 'revenue';
  if (!['revenue', 'profit', 'unit'].includes(basis))
    throw bad('Basis must be revenue, profit or unit.');
  const scope = str(req.body.scope) || 'all';
  if (!['all', 'category', 'brand', 'product'].includes(scope))
    throw bad('Scope must be all, category, brand or product.');

  const rate = num(req.body.rate, 0);
  if (rate <= 0) throw bad('Set a rate above zero.');
  if (basis !== 'unit' && rate > 100) throw bad('A percentage rate above 100 is almost certainly a typo.');

  const row = await one(
    `INSERT INTO commission_rules (name, scope, scope_id, basis, rate, user_id, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING *`,
    [str(req.body.name) || 'Commission', scope, int(req.body.scope_id, null) || null,
     basis, rate, int(req.body.user_id, null) || null]);
  await audit(req, 'create', 'commission_rule', row.id, { basis, rate, scope });
  res.status(201).json(row);
}));

r.put('/rules/:id(\\d+)', requirePerm('commissions.write'), h(async (req, res) => {
  const row = await one(
    `UPDATE commission_rules
        SET name=COALESCE($2,name), rate=COALESCE($3,rate), is_active=COALESCE($4,is_active)
      WHERE id=$1 RETURNING *`,
    [req.params.id, req.body.name ?? null,
     req.body.rate === undefined ? null : num(req.body.rate, 0),
     req.body.is_active === undefined ? null : Boolean(req.body.is_active)]);
  if (!row) throw notFound('Rule not found');
  await audit(req, 'update', 'commission_rule', row.id, {});
  res.json(row);
}));

/* ---------------- the ledger ---------------- */

r.get('/', requirePerm('commissions.read'), h(async (req, res) => {
  const { limit, offset, page } = paging(req, 50);
  const userId = int(req.query.user_id, null) || null;
  const from = str(req.query.from) || null;
  const to = str(req.query.to) || null;

  const rows = await many(
    `SELECT ce.*, u.name AS user_name, s.invoice_no, sr.ref AS return_ref, cr.name AS rule_name
       FROM commission_entries ce
       JOIN users u ON u.id=ce.user_id
       LEFT JOIN sales s ON s.id=ce.sale_id
       LEFT JOIN sale_returns sr ON sr.id=ce.return_id
       LEFT JOIN commission_rules cr ON cr.id=ce.rule_id
      WHERE ($1::int IS NULL OR ce.user_id=$1)
        AND ($2::date IS NULL OR ce.created_at >= $2::date)
        AND ($3::date IS NULL OR ce.created_at < ($3::date + INTERVAL '1 day'))
      ORDER BY ce.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [userId, from, to]);

  const summary = await many(
    `SELECT ce.user_id, u.name AS user_name,
            COALESCE(SUM(ce.amount) FILTER (WHERE ce.kind='earned'),0)   AS earned,
            COALESCE(SUM(ce.amount) FILTER (WHERE ce.kind='clawback'),0) AS clawed_back,
            COALESCE(SUM(ce.amount) FILTER (WHERE ce.kind='paid'),0)     AS paid,
            COALESCE(SUM(ce.amount),0) AS owed
       FROM commission_entries ce JOIN users u ON u.id=ce.user_id
      WHERE ($1::int IS NULL OR ce.user_id=$1)
        AND ($2::date IS NULL OR ce.created_at >= $2::date)
        AND ($3::date IS NULL OR ce.created_at < ($3::date + INTERVAL '1 day'))
      GROUP BY ce.user_id, u.name ORDER BY owed DESC`,
    [userId, from, to]);

  res.json({ data: rows, page, limit, summary });
}));

/**
 * Record a payout.
 *
 * Written as a negative row rather than by clearing the earlier ones, so the
 * ledger still shows what was earned, what came back, and what was handed
 * over — three separate facts that a single "paid" flag collapses into one.
 */
r.post('/pay', requirePerm('commissions.write'), h(async (req, res) => {
  const userId = int(req.body.user_id);
  if (!userId) throw bad('Choose whose commission this is.');
  const amount = money(num(req.body.amount, 0));
  if (amount <= 0) throw bad('Enter an amount.');

  const owed = await one(
    'SELECT COALESCE(SUM(amount),0) AS owed FROM commission_entries WHERE user_id=$1', [userId]);
  if (amount > Number(owed.owed) + 0.009) {
    throw bad(`Only ${Number(owed.owed)} is outstanding for that person.`);
  }

  const row = await one(
    `INSERT INTO commission_entries (user_id, amount, kind, note, period)
     VALUES ($1,$2,'paid',$3,CURRENT_DATE) RETURNING *`,
    [userId, -amount, str(req.body.note) || 'Payout']);
  await audit(req, 'pay', 'commission', row.id, { user_id: userId, amount });
  res.status(201).json(row);
}));

export default r;
