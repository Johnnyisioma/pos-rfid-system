/** Brands, categories, variation templates, expense categories, customer groups. */
import { Router } from 'express';
import { many, one, query } from '../db/index.js';
import { h, bad, str, num } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const r = Router();

r.get('/', h(async (req, res) => {
  const [brands, categories, templates, expenseCategories, customerGroups] = await Promise.all([
    many('SELECT * FROM brands ORDER BY name'),
    many(`SELECT c.*, p.name AS parent_name FROM categories c
            LEFT JOIN categories p ON p.id=c.parent_id ORDER BY COALESCE(p.name,c.name), c.name`),
    many('SELECT * FROM variation_templates ORDER BY axis, name'),
    many('SELECT * FROM expense_categories ORDER BY name'),
    many('SELECT * FROM customer_groups ORDER BY name'),
  ]);
  res.json({ brands, categories, templates, expenseCategories, customerGroups });
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

export default r;
