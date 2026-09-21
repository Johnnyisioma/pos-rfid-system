import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, num, int, bool, paging, nextRef } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { postExpense } from '../services/autopost.js';

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
      `INSERT INTO expenses (ref, location_id, category_id, amount, note, expense_date, user_id, account_id)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, CURRENT_DATE),$7,$8) RETURNING *`,
      [ref, int(req.body.location_id, req.locationId), int(req.body.category_id) || null,
       amount, str(req.body.note), req.body.expense_date || null, req.user.id,
       int(req.body.account_id) || null]);
    const created = rows[0];
    try { await postExpense(c, created.id); }
    catch (e) { console.error('[ledger] expense posting failed', created.id, e.message); }
    return created;
  });
  await audit(req, 'create', 'expense', row.id, { ref: row.ref, amount });
  res.status(201).json(row);
}));

r.put('/:id', requirePerm('expenses.write'), h(async (req, res) => {
  const row = await one(
    `UPDATE expenses SET category_id=$2, amount=COALESCE($3,amount), note=COALESCE($4,note),
            expense_date=COALESCE($5::date, expense_date), account_id=$6 WHERE id=$1 RETURNING *`,
    [req.params.id, int(req.body.category_id) || null, req.body.amount ?? null,
     req.body.note ?? null, req.body.expense_date || null, int(req.body.account_id) || null]);
  if (!row) throw notFound('Expense not found');
  await audit(req, 'update', 'expense', row.id, {});
  res.json(row);
}));

r.delete('/:id', requirePerm('expenses.write'), h(async (req, res) => {
  await query('DELETE FROM expenses WHERE id=$1', [req.params.id]);
  await audit(req, 'delete', 'expense', req.params.id);
  res.json({ ok: true });
}));

/* ═══════════════════ recurring expenses ═══════════════════
   Rent, salaries, subscriptions — bills that come round on a schedule. A
   template holds the amount and cadence; "run due" turns every template whose
   next_due has arrived into a real expense (which books to the ledger like any
   other) and rolls the schedule forward. Nothing posts on its own without a
   person pressing the button — a shop should never be surprised by a booking. */

const CADENCE_STEP = { weekly: '7 days', monthly: '1 month', quarterly: '3 months', yearly: '1 year' };

r.get('/recurring/all', requirePerm('expenses.read'), h(async (req, res) => {
  res.json(await many(
    `SELECT re.*, ec.name AS category_name, pa.name AS account_name, l.name AS location_name
       FROM recurring_expenses re
       LEFT JOIN expense_categories ec ON ec.id=re.category_id
       LEFT JOIN payment_accounts pa ON pa.id=re.account_id
       JOIN locations l ON l.id=re.location_id
      WHERE re.is_active OR $1
      ORDER BY re.next_due`, [req.query.all === '1' || req.query.all === 'true']));
}));

r.post('/recurring', requirePerm('expenses.write'), h(async (req, res) => {
  const name = str(req.body.name).trim();
  const amount = num(req.body.amount, 0);
  if (!name) throw bad('Name the recurring expense.');
  if (amount <= 0) throw bad('Enter an amount greater than zero.');
  const cadence = CADENCE_STEP[str(req.body.cadence)] ? req.body.cadence : 'monthly';
  const row = await one(
    `INSERT INTO recurring_expenses (name, location_id, category_id, account_id, amount, cadence, next_due, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE),$8,$9) RETURNING *`,
    [name, int(req.body.location_id, req.locationId), int(req.body.category_id) || null,
     int(req.body.account_id) || null, amount, cadence, req.body.next_due || null,
     str(req.body.note), req.user.id]);
  await audit(req, 'create', 'recurring_expense', row.id, { name });
  res.status(201).json(row);
}));

r.put('/recurring/:id(\\d+)', requirePerm('expenses.write'), h(async (req, res) => {
  const cadence = CADENCE_STEP[str(req.body.cadence)] ? req.body.cadence : null;
  const row = await one(
    `UPDATE recurring_expenses SET name=COALESCE($2,name), amount=COALESCE($3,amount),
            category_id=$4, account_id=$5, cadence=COALESCE($6,cadence),
            next_due=COALESCE($7::date,next_due), note=COALESCE($8,note),
            is_active=COALESCE($9,is_active)
      WHERE id=$1 RETURNING *`,
    [req.params.id, str(req.body.name) || null, req.body.amount != null ? num(req.body.amount, 0) : null,
     int(req.body.category_id) || null, int(req.body.account_id) || null, cadence,
     req.body.next_due || null, req.body.note ?? null,
     'is_active' in req.body ? bool(req.body.is_active) : null]);
  if (!row) throw notFound('Recurring expense not found');
  res.json(row);
}));

r.delete('/recurring/:id(\\d+)', requirePerm('expenses.write'), h(async (req, res) => {
  await query('DELETE FROM recurring_expenses WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

/** Generate a real expense for every template that has come due, and roll it
    forward. Returns what it created so the person can see it. */
r.post('/recurring/run', requirePerm('expenses.write'), h(async (req, res) => {
  const created = await tx(async (c) => {
    const { rows: due } = await c.query(
      `SELECT * FROM recurring_expenses
        WHERE is_active AND next_due <= CURRENT_DATE FOR UPDATE`);
    const made = [];
    for (const re of due) {
      const ref = await nextRef(c, 'expenses', 'EXP');
      const { rows } = await c.query(
        `INSERT INTO expenses (ref, location_id, category_id, amount, note, expense_date, user_id, account_id, recurring_id)
         VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,$6,$7,$8) RETURNING *`,
        [ref, re.location_id, re.category_id, re.amount,
         re.note || `Recurring: ${re.name}`, req.user.id, re.account_id, re.id]);
      try { await postExpense(c, rows[0].id); }
      catch (e) { console.error('[ledger] recurring expense posting failed', rows[0].id, e.message); }
      await c.query(
        `UPDATE recurring_expenses
            SET last_generated=CURRENT_DATE,
                next_due = next_due + $2::interval
          WHERE id=$1`, [re.id, CADENCE_STEP[re.cadence] || '1 month']);
      made.push({ id: rows[0].id, ref, name: re.name, amount: Number(re.amount) });
    }
    return made;
  });
  await audit(req, 'run', 'recurring_expenses', 0, { count: created.length });
  res.json({ generated: created.length, expenses: created });
}));

export default r;
