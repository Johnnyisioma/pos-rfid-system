import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, num, int, bool, paging, money } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { resolveAccountId } from '../services/accounts.js';

const r = Router();

r.get('/', h(async (req, res) => {
  const { limit, offset, page } = paging(req, 50);
  const q = str(req.query.q).trim();
  const rows = await many(
    `SELECT c.*, g.name AS group_name, g.discount_percent,
            (SELECT COUNT(*) FROM sales s WHERE s.customer_id=c.id AND s.status='completed') AS order_count,
            (SELECT COALESCE(SUM(total),0) FROM sales s WHERE s.customer_id=c.id AND s.status IN ('completed','partially_refunded')) AS lifetime_value,
            (SELECT MAX(created_at) FROM sales s WHERE s.customer_id=c.id) AS last_purchase_at
       FROM customers c LEFT JOIN customer_groups g ON g.id=c.group_id
      WHERE ($1='' OR c.name ILIKE $2 OR c.phone ILIKE $2 OR c.email ILIKE $2)
        AND ($3::int IS NULL OR c.group_id=$3)
        AND ($4::bool IS NULL OR (c.balance > 0) = $4)
      ORDER BY c.name LIMIT ${limit} OFFSET ${offset}`,
    [q, `%${q}%`, req.query.group_id ? int(req.query.group_id) : null,
     req.query.owing === undefined ? null : bool(req.query.owing)]);
  const total = await one(
    `SELECT COUNT(*)::int AS n FROM customers c
      WHERE ($1='' OR c.name ILIKE $2 OR c.phone ILIKE $2 OR c.email ILIKE $2)`, [q, `%${q}%`]);
  res.json({ data: rows, page, limit, total: total.n });
}));

r.get('/:id', h(async (req, res) => {
  const c = await one(
    `SELECT c.*, g.name AS group_name, g.discount_percent
       FROM customers c LEFT JOIN customer_groups g ON g.id=c.group_id WHERE c.id=$1`, [req.params.id]);
  if (!c) throw notFound('Customer not found');
  c.sales = await many(
    `SELECT s.id, s.invoice_no, s.total, s.balance_due, s.status, s.created_at, l.name AS location_name,
            (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id=s.id) AS item_count
       FROM sales s JOIN locations l ON l.id=s.location_id
      WHERE s.customer_id=$1 ORDER BY s.created_at DESC LIMIT 100`, [req.params.id]);
  c.loyalty = await many(
    'SELECT * FROM loyalty_ledger WHERE customer_id=$1 ORDER BY id DESC LIMIT 50', [req.params.id]);
  c.store_credit_history = await many(
    'SELECT * FROM store_credit_ledger WHERE customer_id=$1 ORDER BY id DESC LIMIT 50', [req.params.id]);
  c.top_products = await many(
    `SELECT si.product_name, si.variant_label, SUM(si.quantity) AS qty, SUM(si.line_total) AS value
       FROM sale_items si JOIN sales s ON s.id=si.sale_id
      WHERE s.customer_id=$1 GROUP BY 1,2 ORDER BY qty DESC LIMIT 10`, [req.params.id]);
  res.json(c);
}));

r.post('/', requirePerm('customers.write'), h(async (req, res) => {
  const name = str(req.body.name).trim();
  if (!name) throw bad('Customer name is required');
  const row = await one(
    `INSERT INTO customers (name, phone, email, address, group_id, credit_limit, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name, str(req.body.phone) || null, str(req.body.email) || null, str(req.body.address),
     req.body.group_id || null, num(req.body.credit_limit, 0), str(req.body.notes)]);
  await audit(req, 'create', 'customer', row.id, { name });
  res.status(201).json(row);
}));

r.put('/:id', requirePerm('customers.write'), h(async (req, res) => {
  const row = await one(
    `UPDATE customers SET name=COALESCE($2,name), phone=$3, email=$4, address=COALESCE($5,address),
            group_id=$6, credit_limit=COALESCE($7,credit_limit), notes=COALESCE($8,notes),
            is_active=COALESCE($9,is_active)
      WHERE id=$1 RETURNING *`,
    [req.params.id, req.body.name ?? null, str(req.body.phone) || null, str(req.body.email) || null,
     req.body.address ?? null, req.body.group_id || null, req.body.credit_limit ?? null,
     req.body.notes ?? null, 'is_active' in req.body ? bool(req.body.is_active) : null]);
  if (!row) throw notFound('Customer not found');
  await audit(req, 'update', 'customer', row.id, { fields: Object.keys(req.body) });
  res.json(row);
}));

/** Record a payment against a customer's outstanding balance. */
r.post('/:id/payments', requirePerm('customers.write'), h(async (req, res) => {
  const amount = money(num(req.body.amount, 0));
  if (amount <= 0) throw bad('Enter an amount greater than zero');
  const out = await tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM customers WHERE id=$1 FOR UPDATE', [req.params.id]);
    const cust = rows[0];
    if (!cust) throw notFound('Customer not found');
    let left = Math.min(amount, Number(cust.balance));
    const { rows: due } = await c.query(
      `SELECT * FROM sales WHERE customer_id=$1 AND balance_due > 0 ORDER BY created_at ASC FOR UPDATE`,
      [cust.id]);
    const applied = [];
    for (const s of due) {
      if (left <= 0) break;
      const pay = Math.min(left, Number(s.balance_due));
      const method = str(req.body.method, 'cash');
      const accountId = await resolveAccountId(c, method, req.body.account_id);
      await c.query(
        `INSERT INTO payments (sale_id, method, amount, reference, user_id, account_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [s.id, method, pay, str(req.body.reference) || 'Account payment', req.user.id, accountId]);
      await c.query(
        `UPDATE sales SET amount_paid = amount_paid + $2, balance_due = balance_due - $2,
                is_credit = (balance_due - $2) > 0, updated_at=now() WHERE id=$1`, [s.id, pay]);
      applied.push({ invoice_no: s.invoice_no, amount: pay });
      left = money(left - pay);
    }
    const { rows: upd } = await c.query(
      'UPDATE customers SET balance = GREATEST(0, balance - $2) WHERE id=$1 RETURNING *',
      [cust.id, amount - left]);
    return { customer: upd[0], applied, unapplied: left };
  });
  await audit(req, 'payment', 'customer', req.params.id, { amount });
  res.json(out);
}));

/** Manual store credit / loyalty adjustment. */
r.post('/:id/store-credit', requirePerm('customers.write'), h(async (req, res) => {
  const amount = money(num(req.body.amount, 0));
  if (!amount) throw bad('Enter a non-zero amount');
  const row = await one(
    'UPDATE customers SET store_credit = GREATEST(0, store_credit + $2) WHERE id=$1 RETURNING *',
    [req.params.id, amount]);
  await query(
    `INSERT INTO store_credit_ledger (customer_id, amount, type, reference, user_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [req.params.id, amount, amount > 0 ? 'issue' : 'adjust', str(req.body.reason, 'Manual adjustment'), req.user.id]);
  await audit(req, 'store_credit', 'customer', req.params.id, { amount });
  res.json(row);
}));

r.post('/:id/loyalty', requirePerm('customers.write'), h(async (req, res) => {
  const points = num(req.body.points, 0);
  if (!points) throw bad('Enter a non-zero number of points');
  const row = await one(
    'UPDATE customers SET loyalty_points = GREATEST(0, loyalty_points + $2) WHERE id=$1 RETURNING *',
    [req.params.id, points]);
  await query(`INSERT INTO loyalty_ledger (customer_id, points, type) VALUES ($1,$2,'adjust')`,
    [req.params.id, points]);
  await audit(req, 'loyalty_adjust', 'customer', req.params.id, { points });
  res.json(row);
}));

export default r;
