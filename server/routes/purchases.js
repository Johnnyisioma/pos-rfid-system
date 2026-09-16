import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, num, int, paging, getSettings, money } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { receiveUnits } from '../services/inventory.js';

const r = Router();

async function nextPoNumber(c) {
  const y = new Date().getFullYear();
  const { rows } = await c.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(po_number,'^.*-',''),'')::BIGINT),0) AS n
       FROM purchase_orders WHERE po_number LIKE $1`, [`PO-${y}-%`]);
  return `PO-${y}-${String(Number(rows[0].n) + 1).padStart(6, '0')}`;
}

async function recalcPo(c, poId) {
  const { rows } = await c.query(
    `SELECT COALESCE(SUM(quantity * unit_cost),0) AS subtotal FROM purchase_order_items WHERE po_id=$1`, [poId]);
  const subtotal = money(rows[0].subtotal);
  await c.query('UPDATE purchase_orders SET subtotal=$2, total=$2+tax_amount WHERE id=$1', [poId, subtotal]);
}

async function loadPo(id) {
  const po = await one(
    `SELECT po.*, s.name AS supplier_name, s.phone AS supplier_phone, s.email AS supplier_email,
            l.name AS location_name, u.name AS created_by_name
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id=po.supplier_id
       JOIN locations l ON l.id=po.location_id
       LEFT JOIN users u ON u.id=po.created_by WHERE po.id=$1`, [id]);
  if (!po) return null;
  po.items = await many(
    `SELECT poi.*, v.sku, v.size, v.color, p.name AS product_name, p.id AS product_id
       FROM purchase_order_items poi
       JOIN product_variants v ON v.id=poi.variant_id
       JOIN products p ON p.id=v.product_id
      WHERE poi.po_id=$1 ORDER BY poi.id`, [id]);
  return po;
}

r.get('/', h(async (req, res) => {
  const { limit, offset, page } = paging(req, 30);
  const rows = await many(
    `SELECT po.*, s.name AS supplier_name, l.name AS location_name,
            (SELECT COUNT(*) FROM purchase_order_items i WHERE i.po_id=po.id) AS line_count,
            (SELECT COALESCE(SUM(quantity),0) FROM purchase_order_items i WHERE i.po_id=po.id) AS ordered_qty,
            (SELECT COALESCE(SUM(received_quantity),0) FROM purchase_order_items i WHERE i.po_id=po.id) AS received_qty
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id=po.supplier_id
       JOIN locations l ON l.id=po.location_id
      WHERE ($1::int IS NULL OR po.location_id=$1)
        AND ($2='' OR po.status=$2)
      ORDER BY po.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [req.query.location_id === 'all' ? null : int(req.query.location_id, req.locationId), str(req.query.status)]);
  res.json({ data: rows, page, limit });
}));

r.get('/:id', h(async (req, res) => {
  const po = await loadPo(req.params.id);
  if (!po) throw notFound('Purchase order not found');
  res.json(po);
}));

r.post('/', requirePerm('purchases.write'), h(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw bad('Add at least one line to the purchase order');
  const po = await tx(async (c) => {
    const poNumber = await nextPoNumber(c);
    const { rows } = await c.query(
      `INSERT INTO purchase_orders (po_number, supplier_id, location_id, status, order_date, expected_date, notes, created_by)
       VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6,$7,$8) RETURNING *`,
      [poNumber, int(req.body.supplier_id) || null, int(req.body.location_id, req.locationId),
       ['draft', 'ordered'].includes(req.body.status) ? req.body.status : 'draft',
       req.body.order_date || null, req.body.expected_date || null, str(req.body.notes), req.user.id]);
    const created = rows[0];
    for (const it of items) {
      if (!int(it.variant_id) || num(it.quantity, 0) <= 0) continue;
      await c.query(
        'INSERT INTO purchase_order_items (po_id, variant_id, quantity, unit_cost) VALUES ($1,$2,$3,$4)',
        [created.id, int(it.variant_id), num(it.quantity), num(it.unit_cost, 0)]);
    }
    await recalcPo(c, created.id);
    return created;
  });
  await audit(req, 'create', 'purchase_order', po.id, { po_number: po.po_number });
  res.status(201).json(await loadPo(po.id));
}));

r.put('/:id', requirePerm('purchases.write'), h(async (req, res) => {
  const po = await one('SELECT * FROM purchase_orders WHERE id=$1', [req.params.id]);
  if (!po) throw notFound('Purchase order not found');
  if (['received', 'cancelled'].includes(po.status)) throw bad('This purchase order can no longer be edited');

  await tx(async (c) => {
    await c.query(
      `UPDATE purchase_orders SET supplier_id=$2, expected_date=$3, notes=COALESCE($4,notes),
              status=COALESCE($5,status), amount_paid=COALESCE($6,amount_paid) WHERE id=$1`,
      [po.id, int(req.body.supplier_id) || null, req.body.expected_date || null,
       req.body.notes ?? null, req.body.status ?? null, req.body.amount_paid ?? null]);
    if (Array.isArray(req.body.items)) {
      await c.query('DELETE FROM purchase_order_items WHERE po_id=$1 AND received_quantity=0', [po.id]);
      for (const it of req.body.items) {
        if (it.id) {
          await c.query('UPDATE purchase_order_items SET quantity=$2, unit_cost=$3 WHERE id=$1 AND po_id=$4',
            [it.id, num(it.quantity), num(it.unit_cost, 0), po.id]);
        } else if (int(it.variant_id)) {
          await c.query('INSERT INTO purchase_order_items (po_id,variant_id,quantity,unit_cost) VALUES ($1,$2,$3,$4)',
            [po.id, int(it.variant_id), num(it.quantity), num(it.unit_cost, 0)]);
        }
      }
    }
    await recalcPo(c, po.id);
  });
  await audit(req, 'update', 'purchase_order', po.id, {});
  res.json(await loadPo(po.id));
}));

/**
 * Goods receiving: creates a physical, EPC-tagged unit for every item received.
 */
r.post('/:id/receive', requirePerm('purchases.write'), h(async (req, res) => {
  const settings = await getSettings();
  const lines = Array.isArray(req.body.items) ? req.body.items : [];
  if (!lines.length) throw bad('Nothing to receive');

  const out = await tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    const po = rows[0];
    if (!po) throw notFound('Purchase order not found');
    if (po.status === 'cancelled') throw bad('That purchase order was cancelled');

    const createdUnits = [];
    for (const line of lines) {
      const itemId = int(line.item_id);
      const qty = Math.round(num(line.quantity, 0));
      if (!itemId || qty <= 0) continue;
      const { rows: itemRows } = await c.query(
        'SELECT * FROM purchase_order_items WHERE id=$1 AND po_id=$2 FOR UPDATE', [itemId, po.id]);
      const item = itemRows[0];
      if (!item) throw bad('That line is not on this purchase order');
      const outstanding = Number(item.quantity) - Number(item.received_quantity);
      if (qty > outstanding + 0.001)
        throw bad(`Only ${outstanding} outstanding on that line — cannot receive ${qty}`);

      const unitCost = num(line.unit_cost, Number(item.unit_cost));
      const units = await receiveUnits(c, {
        variantId: item.variant_id, locationId: po.location_id, quantity: qty,
        costPrice: unitCost, companyPrefix: settings.epc_company_prefix,
        referenceType: 'purchase_order', referenceId: po.id, sourceRef: po.po_number,
        userId: req.user.id, type: 'purchase', reason: `Received on ${po.po_number}`,
      });
      createdUnits.push(...units);

      await c.query(
        'UPDATE purchase_order_items SET received_quantity = received_quantity + $2, unit_cost=$3 WHERE id=$1',
        [itemId, qty, unitCost]);
      if (num(line.update_cost_price, 1)) {
        await c.query('UPDATE product_variants SET cost_price=$2 WHERE id=$1', [item.variant_id, unitCost]);
      }
    }

    const { rows: totals } = await c.query(
      `SELECT COALESCE(SUM(quantity),0) AS ordered, COALESCE(SUM(received_quantity),0) AS received
         FROM purchase_order_items WHERE po_id=$1`, [po.id]);
    const status = Number(totals[0].received) >= Number(totals[0].ordered) ? 'received'
      : Number(totals[0].received) > 0 ? 'partial' : po.status;
    await c.query('UPDATE purchase_orders SET status=$2 WHERE id=$1', [po.id, status]);
    await recalcPo(c, po.id);
    return { po, units: createdUnits, status };
  });

  await audit(req, 'receive', 'purchase_order', req.params.id, {
    units: out.units.length, status: out.status });
  res.json({
    ok: true, status: out.status, units_created: out.units.length,
    units: out.units.map((u) => ({ id: u.id, epc: u.epc, epc_readable: u.epc_readable })),
    purchase_order: await loadPo(req.params.id),
  });
}));

r.post('/:id/cancel', requirePerm('purchases.write'), h(async (req, res) => {
  const po = await one('SELECT * FROM purchase_orders WHERE id=$1', [req.params.id]);
  if (!po) throw notFound('Purchase order not found');
  if (po.status === 'received') throw bad('A fully received purchase order cannot be cancelled');
  await query("UPDATE purchase_orders SET status='cancelled' WHERE id=$1", [po.id]);
  await audit(req, 'cancel', 'purchase_order', po.id, {});
  res.json({ ok: true });
}));

/** Suggested reorder list from reorder points, grouped by supplier's last price. */
r.get('/suggestions/reorder', h(async (req, res) => {
  const locationId = int(req.query.location_id, req.locationId);
  const rows = await many(
    `SELECT v.id AS variant_id, v.sku, v.size, v.color, p.name AS product_name,
            COALESCE(i.quantity,0) AS on_hand,
            COALESCE(i.reorder_point, v.reorder_point, p.reorder_point, 0) AS reorder_point,
            GREATEST(1, COALESCE(i.reorder_point, v.reorder_point, p.reorder_point, 0) * 2 - COALESCE(i.quantity,0)) AS suggested_qty,
            v.cost_price,
            (SELECT po.supplier_id FROM purchase_order_items poi JOIN purchase_orders po ON po.id=poi.po_id
              WHERE poi.variant_id=v.id ORDER BY po.created_at DESC LIMIT 1) AS last_supplier_id
       FROM product_variants v
       JOIN products p ON p.id=v.product_id
       LEFT JOIN inventory i ON i.variant_id=v.id AND i.location_id=$1
      WHERE p.is_active AND v.is_active
        AND COALESCE(i.quantity,0) <= COALESCE(i.reorder_point, v.reorder_point, p.reorder_point, 0)
      ORDER BY p.name, v.size LIMIT 200`, [locationId]);
  res.json(rows);
}));

export default r;
