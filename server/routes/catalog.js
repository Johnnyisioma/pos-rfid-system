/** Brands, categories, variation templates, expense categories, customer groups. */
import { Router } from 'express';
import { many, one, query } from '../db/index.js';
import { h, bad, str, num } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const r = Router();

r.get('/', h(async (req, res) => {
  const [brands, categories, templates, expenseCategories, customerGroups, taxRates] = await Promise.all([
    many('SELECT * FROM brands ORDER BY name'),
    many(`SELECT c.*, p.name AS parent_name FROM categories c
            LEFT JOIN categories p ON p.id=c.parent_id ORDER BY COALESCE(p.name,c.name), c.name`),
    many('SELECT * FROM variation_templates ORDER BY axis, name'),
    many('SELECT * FROM expense_categories ORDER BY name'),
    many('SELECT * FROM customer_groups ORDER BY name'),
    many('SELECT * FROM tax_rates WHERE is_active ORDER BY is_default DESC, rate DESC'),
  ]);
  res.json({ brands, categories, templates, expenseCategories, customerGroups, taxRates });
}));

r.post('/brands', requirePerm('products.write'), h(async (req, res) => {
  const name = str(req.body.name).trim();
  if (!name) throw bad('Brand name required');
  const row = await one(
    'INSERT INTO brands (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING *', [name]);
  res.status(201).json(row);
}));

r.post('/categories', requirePerm('products.write'), h(async (req, res) => {
  const name = str(req.body.name).trim();
  if (!name) throw bad('Category name required');
  const parent = req.body.parent_id ? Number(req.body.parent_id) : null;
  const existing = await one(
    'SELECT * FROM categories WHERE name=$1 AND parent_id IS NOT DISTINCT FROM $2', [name, parent]);
  if (existing) return res.json(existing);
  const row = await one('INSERT INTO categories (name,parent_id) VALUES ($1,$2) RETURNING *', [name, parent]);
  res.status(201).json(row);
}));

r.delete('/categories/:id', requirePerm('products.write'), h(async (req, res) => {
  await query('DELETE FROM categories WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

r.post('/templates', requirePerm('products.write'), h(async (req, res) => {
  const name = str(req.body.name).trim();
  const axis = str(req.body.axis);
  const values = Array.isArray(req.body.values) ? req.body.values.map((v) => str(v).trim()).filter(Boolean) : [];
  if (!name) throw bad('Template name required');
  if (!['size', 'color'].includes(axis)) throw bad('Axis must be "size" or "color"');
  if (!values.length) throw bad('Add at least one value');
  const row = await one(
    `INSERT INTO variation_templates (name,axis,values_json) VALUES ($1,$2,$3)
     ON CONFLICT (name) DO UPDATE SET axis=EXCLUDED.axis, values_json=EXCLUDED.values_json RETURNING *`,
    [name, axis, JSON.stringify(values)]
  );
  await audit(req, 'upsert', 'variation_template', row.id, { name, axis });
  res.status(201).json(row);
}));

r.delete('/templates/:id', requirePerm('products.write'), h(async (req, res) => {
  await query('DELETE FROM variation_templates WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

r.post('/expense-categories', requirePerm('expenses.write'), h(async (req, res) => {
  const name = str(req.body.name).trim();
  if (!name) throw bad('Name required');
  const row = await one(
    'INSERT INTO expense_categories (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING *', [name]);
  res.status(201).json(row);
}));

r.post('/customer-groups', requirePerm('customers.write'), h(async (req, res) => {
  const name = str(req.body.name).trim();
  if (!name) throw bad('Name required');
  const row = await one(
    `INSERT INTO customer_groups (name,discount_percent,notes) VALUES ($1,$2,$3)
     ON CONFLICT (name) DO UPDATE SET discount_percent=EXCLUDED.discount_percent, notes=EXCLUDED.notes
     RETURNING *`,
    [name, num(req.body.discount_percent, 0), str(req.body.notes)]
  );
  res.status(201).json(row);
}));

r.put('/customer-groups/:id', requirePerm('customers.write'), h(async (req, res) => {
  const row = await one(
    'UPDATE customer_groups SET name=COALESCE($2,name), discount_percent=COALESCE($3,discount_percent), notes=COALESCE($4,notes) WHERE id=$1 RETURNING *',
    [req.params.id, req.body.name ?? null, req.body.discount_percent ?? null, req.body.notes ?? null]
  );
  res.json(row);
}));

/* ---------------- tax rates ---------------- */
r.post('/tax-rates', requirePerm('settings.write'), h(async (req, res) => {
  const name = str(req.body.name).trim();
  if (!name) throw bad('Give the tax rate a name');
  const rate = num(req.body.rate, 0);
  if (rate < 0 || rate > 100) throw bad('Rate must be between 0 and 100');
  const row = await one(
    `INSERT INTO tax_rates (name, rate, is_exempt, is_default)
     VALUES ($1,$2,$3,FALSE)
     ON CONFLICT (name) DO UPDATE
       SET rate = EXCLUDED.rate, is_exempt = EXCLUDED.is_exempt,
           -- Re-adding a rate that was retired brings it back rather than
           -- silently returning a row the product form will never show.
           is_active = TRUE
     RETURNING *`,
    [name, rate, rate === 0]);
  await audit(req, 'upsert', 'tax_rate', row.id, { name, rate });
  res.status(201).json(row);
}));

r.put('/tax-rates/:id', requirePerm('settings.write'), h(async (req, res) => {
  if (req.body.is_default) await query('UPDATE tax_rates SET is_default=FALSE');
  const row = await one(
    `UPDATE tax_rates SET name=COALESCE($2,name), rate=COALESCE($3,rate),
            is_default=COALESCE($4,is_default), is_active=COALESCE($5,is_active),
            is_exempt = COALESCE($3, rate) = 0
      WHERE id=$1 RETURNING *`,
    [req.params.id, req.body.name ?? null, req.body.rate ?? null,
     'is_default' in req.body ? !!req.body.is_default : null,
     'is_active' in req.body ? !!req.body.is_active : null]);
  if (!row) throw bad('Tax rate not found');
  await audit(req, 'update', 'tax_rate', row.id, {});
  res.json(row);
}));

r.delete('/tax-rates/:id', requirePerm('settings.write'), h(async (req, res) => {
  const used = await one('SELECT 1 FROM products WHERE tax_rate_id=$1 LIMIT 1', [req.params.id]);
  if (used) {
    await query('UPDATE tax_rates SET is_active=FALSE WHERE id=$1', [req.params.id]);
    return res.json({ ok: true, deactivated: true,
      message: 'Products use this rate, so it was deactivated rather than deleted.' });
  }
  await query('DELETE FROM tax_rates WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

/* ═══════════════════ tax groups ═══════════════════
   A single tax made of several rates — VAT + a state levy, say — so a line that
   attracts both is one selectable group whose rate is the sum of its members. */
r.get('/tax-groups', h(async (req, res) => {
  const groups = await many('SELECT * FROM tax_groups WHERE is_active OR $1 ORDER BY name',
    [String(req.query.all) === '1' || String(req.query.all) === 'true']);
  for (const g of groups) {
    g.members = await many(
      `SELECT tr.id, tr.name, tr.rate FROM tax_group_members m
         JOIN tax_rates tr ON tr.id=m.tax_rate_id WHERE m.group_id=$1 ORDER BY tr.name`, [g.id]);
  }
  res.json(groups);
}));

async function syncGroupMembers(groupId, memberIds) {
  await query('DELETE FROM tax_group_members WHERE group_id=$1', [groupId]);
  let rate = 0;
  for (const id of memberIds) {
    const tr = await one('SELECT rate FROM tax_rates WHERE id=$1', [id]);
    if (!tr) continue;
    await query('INSERT INTO tax_group_members (group_id, tax_rate_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [groupId, id]);
    rate += Number(tr.rate);
  }
  await query('UPDATE tax_groups SET rate=$2 WHERE id=$1', [groupId, rate]);
  return rate;
}

r.post('/tax-groups', requirePerm('settings.write'), h(async (req, res) => {
  const name = str(req.body.name).trim();
  if (!name) throw bad('Name the tax group.');
  const memberIds = (Array.isArray(req.body.tax_rate_ids) ? req.body.tax_rate_ids : []).map(Number).filter(Boolean);
  if (!memberIds.length) throw bad('Add at least one tax rate to the group.');
  const row = await one(
    'INSERT INTO tax_groups (name, description) VALUES ($1,$2) RETURNING *',
    [name, str(req.body.description)]).catch((e) => {
      if (/unique/i.test(e.message)) throw bad(`Tax group "${name}" already exists.`);
      throw e;
    });
  const rate = await syncGroupMembers(row.id, memberIds);
  await audit(req, 'create', 'tax_group', row.id, { name });
  res.status(201).json({ ...row, rate });
}));

r.put('/tax-groups/:id', requirePerm('settings.write'), h(async (req, res) => {
  const row = await one(
    `UPDATE tax_groups SET name=COALESCE($2,name), description=COALESCE($3,description),
            is_active=COALESCE($4,is_active) WHERE id=$1 RETURNING *`,
    [req.params.id, str(req.body.name) || null, req.body.description ?? null,
     'is_active' in req.body ? (req.body.is_active === true || req.body.is_active === 'true') : null]);
  if (!row) throw bad('Tax group not found');
  if (Array.isArray(req.body.tax_rate_ids)) {
    row.rate = await syncGroupMembers(row.id, req.body.tax_rate_ids.map(Number).filter(Boolean));
  }
  await audit(req, 'update', 'tax_group', row.id, {});
  res.json(row);
}));

r.delete('/tax-groups/:id', requirePerm('settings.write'), h(async (req, res) => {
  await query('DELETE FROM tax_groups WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

export default r;
