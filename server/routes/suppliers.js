import { Router } from 'express';
import { many, one } from '../db/index.js';
import { h, bad, notFound, str, num, bool, paging } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const r = Router();

r.get('/', h(async (req, res) => {
  const { limit, offset, page } = paging(req, 50);
  const q = str(req.query.q).trim();
  const rows = await many(
    `SELECT s.*,
            (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id=s.id) AS po_count,
            (SELECT COALESCE(SUM(po.total),0) FROM purchase_orders po
              WHERE po.supplier_id=s.id AND po.status IN ('ordered','partial','received')) AS purchased_value,
            (SELECT COALESCE(SUM(po.total - po.amount_paid),0) FROM purchase_orders po
              WHERE po.supplier_id=s.id AND po.status IN ('ordered','partial','received')) AS outstanding
       FROM suppliers s
      WHERE ($1='' OR s.name ILIKE $2 OR s.phone ILIKE $2 OR s.contact_person ILIKE $2)
      ORDER BY s.name LIMIT ${limit} OFFSET ${offset}`, [q, `%${q}%`]);
  res.json({ data: rows, page, limit });
}));

r.get('/:id', h(async (req, res) => {
  const s = await one('SELECT * FROM suppliers WHERE id=$1', [req.params.id]);
  if (!s) throw notFound('Supplier not found');
  s.purchase_orders = await many(
    `SELECT po.*, l.name AS location_name FROM purchase_orders po
       JOIN locations l ON l.id=po.location_id
      WHERE po.supplier_id=$1 ORDER BY po.created_at DESC LIMIT 50`, [req.params.id]);
  s.products = await many(
    `SELECT DISTINCT p.id, p.name, p.sku FROM purchase_order_items poi
       JOIN purchase_orders po ON po.id=poi.po_id
       JOIN product_variants v ON v.id=poi.variant_id
       JOIN products p ON p.id=v.product_id
      WHERE po.supplier_id=$1 ORDER BY p.name LIMIT 100`, [req.params.id]);
  res.json(s);
}));

r.post('/', requirePerm('suppliers.write'), h(async (req, res) => {
  const name = str(req.body.name).trim();
  if (!name) throw bad('Supplier name is required');
  const row = await one(
    `INSERT INTO suppliers (name, contact_person, phone, email, address, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name, str(req.body.contact_person), str(req.body.phone), str(req.body.email),
     str(req.body.address), str(req.body.notes)]);
  await audit(req, 'create', 'supplier', row.id, { name });
  res.status(201).json(row);
}));

r.put('/:id', requirePerm('suppliers.write'), h(async (req, res) => {
  const row = await one(
    `UPDATE suppliers SET name=COALESCE($2,name), contact_person=COALESCE($3,contact_person),
            phone=COALESCE($4,phone), email=COALESCE($5,email), address=COALESCE($6,address),
            notes=COALESCE($7,notes), is_active=COALESCE($8,is_active)
      WHERE id=$1 RETURNING *`,
    [req.params.id, req.body.name ?? null, req.body.contact_person ?? null, req.body.phone ?? null,
     req.body.email ?? null, req.body.address ?? null, req.body.notes ?? null,
     'is_active' in req.body ? bool(req.body.is_active) : null]);
  if (!row) throw notFound('Supplier not found');
  await audit(req, 'update', 'supplier', row.id, {});
  res.json(row);
}));

export default r;
