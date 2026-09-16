import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, num, int, paging, nextRef } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const r = Router();

r.get('/', h(async (req, res) => {
  const { limit, offset, page } = paging(req, 50);
  const locationId = req.query.location_id === 'all' ? null : int(req.query.location_id, req.locationId);
  const rows = await many(
    `SELECT e.*, ec.name AS category_name, l.name AS location_name, u.name AS user_name
       FROM expenses e
       LEFT JOIN expense_categories ec ON ec.id=e.category_id
       JOIN locations l ON l.id=e.location_id
       LEFT JOIN users u ON u.id=e.user_id
      WHERE ($1::int IS NULL OR e.location_id=$1)
        AND ($2::date IS NULL OR e.expense_date >= $2::date)
        AND ($3::date IS NULL OR e.expense_date <= $3::date)
        AND ($4::int IS NULL OR e.category_id=$4)
      ORDER BY e.expense_date DESC, e.id DESC LIMIT ${limit} OFFSET ${offset}`,
    [locationId, req.query.from || null, req.query.to || null,
     req.query.category_id ? int(req.query.category_id) : null]);
  const totals = await one(
    `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS count FROM expenses e
      WHERE ($1::int IS NULL OR e.location_id=$1)
        AND ($2::date IS NULL OR e.expense_date >= $2::date)
        AND ($3::date IS NULL OR e.expense_date <= $3::date)`,
    [locationId, req.query.from || null, req.query.to || null]);
  const byCategory = await many(
    `SELECT COALESCE(ec.name,'Uncategorised') AS category, SUM(e.amount) AS total, COUNT(*)::int AS count
       FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id
      WHERE ($1::int IS NULL OR e.location_id=$1)
        AND ($2::date IS NULL OR e.expense_date >= $2::date)
        AND ($3::date IS NULL OR e.expense_date <= $3::date)
      GROUP BY 1 ORDER BY total DESC`,
    [locationId, req.query.from || null, req.query.to || null]);
  res.json({ data: rows, page, limit, totals, by_category: byCategory });
}));

r.post('/', requirePerm('expenses.write'), h(async (req, res) => {
  const amount = num(req.body.amount, 0);
  if (amount <= 0) throw bad('Enter an amount greater than zero');
  const row = await tx(async (c) => {
    const ref = await nextRef(c, 'expenses', 'EXP');
    const { rows } = await c.query(
      `INSERT INTO expenses (ref, location_id, category_id, amount, note, expense_date, user_id)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, CURRENT_DATE),$7) RETURNING *`,
      [ref, int(req.body.location_id, req.locationId), int(req.body.category_id) || null,
       amount, str(req.body.note), req.body.expense_date || null, req.user.id]);
    return rows[0];
  });
  await audit(req, 'create', 'expense', row.id, { ref: row.ref, amount });
  res.status(201).json(row);
}));

r.put('/:id', requirePerm('expenses.write'), h(async (req, res) => {
  const row = await one(
    `UPDATE expenses SET category_id=$2, amount=COALESCE($3,amount), note=COALESCE($4,note),
            expense_date=COALESCE($5::date, expense_date) WHERE id=$1 RETURNING *`,
    [req.params.id, int(req.body.category_id) || null, req.body.amount ?? null,
     req.body.note ?? null, req.body.expense_date || null]);
  if (!row) throw notFound('Expense not found');
  await audit(req, 'update', 'expense', row.id, {});
  res.json(row);
}));

r.delete('/:id', requirePerm('expenses.write'), h(async (req, res) => {
  await query('DELETE FROM expenses WHERE id=$1', [req.params.id]);
  await audit(req, 'delete', 'expense', req.params.id);
  res.json({ ok: true });
}));

export default r;
