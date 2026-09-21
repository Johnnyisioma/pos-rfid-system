/**
 * Purchase requisitions — the step before a purchase order.
 *
 * A branch or a stock clerk raises a requisition ("we're low on these"), a
 * manager approves it, and an approved requisition is converted into a real
 * purchase order in one click, carrying its lines and estimated costs across.
 * This is the control that stops anyone from committing the shop's money to a
 * supplier without a second person signing off.
 */
import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, num, int, paging, nextRef } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const r = Router();

async function loadReq(id) {
  const rq = await one(
    `SELECT rq.*, l.name AS location_name, s.name AS supplier_name,
            cu.name AS created_by_name, au.name AS approved_by_name, po.po_number
       FROM purchase_requisitions rq
       JOIN locations l ON l.id=rq.location_id
       LEFT JOIN suppliers s ON s.id=rq.supplier_id
       LEFT JOIN users cu ON cu.id=rq.created_by
       LEFT JOIN users au ON au.id=rq.approved_by
       LEFT JOIN purchase_orders po ON po.id=rq.po_id
      WHERE rq.id=$1`, [id]);
  if (!rq) return null;
  rq.items = await many(
    `SELECT ri.*, v.sku, v.size, v.color, p.name AS product_name,
            (SELECT COALESCE(SUM(quantity),0) FROM inventory inv WHERE inv.variant_id=ri.variant_id) AS on_hand
       FROM purchase_requisition_items ri
       LEFT JOIN product_variants v ON v.id=ri.variant_id
       LEFT JOIN products p ON p.id=v.product_id
      WHERE ri.requisition_id=$1 ORDER BY ri.id`, [id]);
  return rq;
}

r.get('/', requirePerm('purchases.read'), h(async (req, res) => {
  const { limit, offset, page } = paging(req, 30);
  const rows = await many(
    `SELECT rq.*, l.name AS location_name, s.name AS supplier_name, u.name AS created_by_name,
            (SELECT COUNT(*) FROM purchase_requisition_items i WHERE i.requisition_id=rq.id) AS line_count,
            (SELECT COALESCE(SUM(quantity*estimated_cost),0) FROM purchase_requisition_items i WHERE i.requisition_id=rq.id) AS est_total
       FROM purchase_requisitions rq
       JOIN locations l ON l.id=rq.location_id
       LEFT JOIN suppliers s ON s.id=rq.supplier_id
       LEFT JOIN users u ON u.id=rq.created_by
      WHERE ($1='' OR rq.status=$1)
      ORDER BY rq.created_at DESC LIMIT ${limit} OFFSET ${offset}`, [str(req.query.status)]);
  res.json({ data: rows, page, limit });
}));

r.get('/:id(\\d+)', requirePerm('purchases.read'), h(async (req, res) => {
  const rq = await loadReq(req.params.id);
  if (!rq) throw notFound('Requisition not found');
  res.json(rq);
}));

r.post('/', requirePerm('purchases.write'), h(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const clean = items
    .map((it) => ({ variant_id: int(it.variant_id), quantity: num(it.quantity, 0), estimated_cost: num(it.estimated_cost, 0) }))
    .filter((it) => it.variant_id && it.quantity > 0);
  if (!clean.length) throw bad('Add at least one item.');
  const out = await tx(async (c) => {
    const ref = await nextRef(c, 'purchase_requisitions', 'REQ');
    const { rows } = await c.query(
      `INSERT INTO purchase_requisitions (ref, location_id, supplier_id, required_by, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [ref, int(req.body.location_id, req.locationId), int(req.body.supplier_id, null) || null,
       req.body.required_by || null, str(req.body.notes), req.user.id]);
    const rq = rows[0];
    for (const it of clean) {
      await c.query(
        'INSERT INTO purchase_requisition_items (requisition_id, variant_id, quantity, estimated_cost) VALUES ($1,$2,$3,$4)',
        [rq.id, it.variant_id, it.quantity, it.estimated_cost]);
    }
    return rq;
  });
  await audit(req, 'create', 'requisition', out.id, { ref: out.ref });
  res.status(201).json(await loadReq(out.id));
}));

r.post('/:id(\\d+)/approve', requirePerm('purchases.write'), h(async (req, res) => {
  const row = await one(
    `UPDATE purchase_requisitions SET status='approved', approved_by=$2
      WHERE id=$1 AND status='pending' RETURNING *`, [req.params.id, req.user.id]);
  if (!row) throw bad('Only a pending requisition can be approved.');
  await audit(req, 'approve', 'requisition', row.id, {});
  res.json(await loadReq(row.id));
}));

r.post('/:id(\\d+)/reject', requirePerm('purchases.write'), h(async (req, res) => {
  const row = await one(
    `UPDATE purchase_requisitions SET status='rejected', rejected_reason=$2, approved_by=$3
      WHERE id=$1 AND status='pending' RETURNING *`,
    [req.params.id, str(req.body.reason) || 'Rejected', req.user.id]);
  if (!row) throw bad('Only a pending requisition can be rejected.');
  await audit(req, 'reject', 'requisition', row.id, {});
  res.json(await loadReq(row.id));
}));

/** Convert an approved requisition into a draft purchase order. */
r.post('/:id(\\d+)/convert', requirePerm('purchases.write'), h(async (req, res) => {
  const out = await tx(async (c) => {
    const { rows } = await c.query(
      'SELECT * FROM purchase_requisitions WHERE id=$1 FOR UPDATE', [req.params.id]);
    const rq = rows[0];
    if (!rq) throw notFound('Requisition not found');
    if (rq.status !== 'approved') throw bad('Approve the requisition before converting it.');
    if (rq.po_id) throw bad('This requisition already has a purchase order.');

    const items = await many(
      'SELECT * FROM purchase_requisition_items WHERE requisition_id=$1', [rq.id]);
    if (!items.length) throw bad('Nothing to order.');

    // number the PO the same way purchases.js does
    const { rows: seq } = await c.query(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(po_number,'^.*-',''),'')::BIGINT),0)+1 AS n
         FROM purchase_orders WHERE po_number LIKE $1`, [`PO-${new Date().getFullYear()}-%`]);
    const poNumber = `PO-${new Date().getFullYear()}-${String(Number(seq[0].n)).padStart(6, '0')}`;

    const supplierId = int(req.body.supplier_id, rq.supplier_id) || null;
    const { rows: poRows } = await c.query(
      `INSERT INTO purchase_orders (po_number, supplier_id, location_id, status, order_date, notes, created_by)
       VALUES ($1,$2,$3,'draft',CURRENT_DATE,$4,$5) RETURNING *`,
      [poNumber, supplierId, rq.location_id, `From requisition ${rq.ref}`, req.user.id]);
    const po = poRows[0];
    let subtotal = 0;
    for (const it of items) {
      if (!it.variant_id) continue;
      subtotal += Number(it.quantity) * Number(it.estimated_cost);
      await c.query(
        'INSERT INTO purchase_order_items (po_id, variant_id, quantity, unit_cost) VALUES ($1,$2,$3,$4)',
        [po.id, it.variant_id, it.quantity, it.estimated_cost]);
    }
    await c.query('UPDATE purchase_orders SET subtotal=$2, total=$2 WHERE id=$1', [po.id, subtotal]);
    await c.query("UPDATE purchase_requisitions SET status='ordered', po_id=$2 WHERE id=$1", [rq.id, po.id]);
    return { po, rq };
  });
  await audit(req, 'convert', 'requisition', out.rq.id, { po: out.po.po_number });
  res.status(201).json({ ok: true, po_id: out.po.id, po_number: out.po.po_number });
}));

export default r;
