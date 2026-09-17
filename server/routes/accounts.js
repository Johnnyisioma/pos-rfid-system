/**
 * Payment accounts — where money actually lands.
 *
 * A register tracks the cash drawer for one shift. This is the other half:
 * the bank account, the Opay or Moniepoint wallet, the POS terminal's
 * settlement account. Without it a transfer payment goes into the sale and
 * then vanishes, and nothing reconciles at the end of the month.
 */
import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, num, int, bool, money } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const r = Router();

const BALANCE_SQL = `
  SELECT a.*,
         l.name AS location_name,
         a.opening_balance
           + COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.account_id = a.id), 0)
           - COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.account_id = a.id), 0)
         AS balance,
         COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.account_id = a.id), 0) AS money_in,
         COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.account_id = a.id), 0) AS money_out,
         (SELECT COUNT(*) FROM payments p WHERE p.account_id = a.id) AS movements
    FROM payment_accounts a
    LEFT JOIN locations l ON l.id = a.location_id`;

r.get('/', h(async (req, res) => {
  const rows = await many(`${BALANCE_SQL} ORDER BY a.is_default DESC, a.name`);
  const mapping = await many('SELECT * FROM payment_method_accounts');
  res.json({ accounts: rows, method_defaults: mapping });
}));

// Constrained to digits so /accounts/method-defaults is never read as an id.
r.get('/:id(\\d+)', h(async (req, res) => {
  const account = await one(`${BALANCE_SQL} WHERE a.id = $1`, [req.params.id]);
  if (!account) throw notFound('Account not found');

  account.recent = await many(
    `SELECT 'payment' AS kind, p.id, p.amount, p.method, p.reference, p.created_at,
            s.invoice_no AS document, u.name AS user_name
       FROM payments p
       LEFT JOIN sales s ON s.id = p.sale_id
       LEFT JOIN users u ON u.id = p.user_id
      WHERE p.account_id = $1
      UNION ALL
     SELECT 'expense', e.id, -e.amount, 'expense', e.note, e.created_at, e.ref, u.name
       FROM expenses e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.account_id = $1
      ORDER BY created_at DESC
      LIMIT 100`, [req.params.id]);
  res.json(account);
}));

r.post('/', requirePerm('settings.write'), h(async (req, res) => {
  const name = str(req.body.name).trim();
  if (!name) throw bad('Give the account a name');
  const type = str(req.body.type, 'bank');
  if (!['cash', 'bank', 'mobile_money', 'card_terminal', 'other'].includes(type))
    throw bad('Unsupported account type');

  const row = await tx(async (c) => {
    if (bool(req.body.is_default)) {
      await c.query('UPDATE payment_accounts SET is_default = FALSE');
    }
    const { rows } = await c.query(
      `INSERT INTO payment_accounts (name, type, account_number, bank_name, opening_balance,
                                     location_id, is_default, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, type, str(req.body.account_number), str(req.body.bank_name),
       num(req.body.opening_balance, 0), int(req.body.location_id) || null,
       bool(req.body.is_default), str(req.body.notes)]);
    return rows[0];
  });
  await audit(req, 'create', 'payment_account', row.id, { name, type });
  res.status(201).json(row);
}));

r.put('/:id(\\d+)', requirePerm('settings.write'), h(async (req, res) => {
  const row = await tx(async (c) => {
    if (bool(req.body.is_default)) {
      await c.query('UPDATE payment_accounts SET is_default = FALSE');
    }
    const { rows } = await c.query(
      `UPDATE payment_accounts
          SET name=COALESCE($2,name), type=COALESCE($3,type),
              account_number=COALESCE($4,account_number), bank_name=COALESCE($5,bank_name),
              opening_balance=COALESCE($6,opening_balance), location_id=$7,
              is_default=COALESCE($8,is_default), is_active=COALESCE($9,is_active),
              notes=COALESCE($10,notes)
        WHERE id=$1 RETURNING *`,
      [req.params.id, req.body.name ?? null, req.body.type ?? null,
       req.body.account_number ?? null, req.body.bank_name ?? null,
       req.body.opening_balance ?? null, int(req.body.location_id) || null,
       'is_default' in req.body ? bool(req.body.is_default) : null,
       'is_active' in req.body ? bool(req.body.is_active) : null,
       req.body.notes ?? null]);
    return rows[0];
  });
  if (!row) throw notFound('Account not found');
  await audit(req, 'update', 'payment_account', row.id, {});
  res.json(row);
}));

r.delete('/:id(\\d+)', requirePerm('settings.write'), h(async (req, res) => {
  const used = await one('SELECT 1 FROM payments WHERE account_id=$1 LIMIT 1', [req.params.id]);
  if (used) {
    await query('UPDATE payment_accounts SET is_active=FALSE WHERE id=$1', [req.params.id]);
    await audit(req, 'deactivate', 'payment_account', req.params.id, { reason: 'has movements' });
    return res.json({ ok: true, deactivated: true,
      message: 'This account has money against it, so it was deactivated rather than deleted.' });
  }
  await query('DELETE FROM payment_accounts WHERE id=$1', [req.params.id]);
  await audit(req, 'delete', 'payment_account', req.params.id);
  res.json({ ok: true, deleted: true });
}));

/** Which account each tender type drops into by default. */
r.put('/method-defaults', requirePerm('settings.write'), h(async (req, res) => {
  const mapping = req.body.mapping || {};
  await tx(async (c) => {
    for (const [method, accountId] of Object.entries(mapping)) {
      if (accountId) {
        await c.query(
          `INSERT INTO payment_method_accounts (method, account_id) VALUES ($1,$2)
           ON CONFLICT (method) DO UPDATE SET account_id = EXCLUDED.account_id`,
          [method, int(accountId)]);
      } else {
        await c.query('DELETE FROM payment_method_accounts WHERE method=$1', [method]);
      }
    }
  });
  await audit(req, 'update', 'payment_method_accounts', null, { methods: Object.keys(mapping) });
  res.json(await many('SELECT * FROM payment_method_accounts'));
}));

export default r;
