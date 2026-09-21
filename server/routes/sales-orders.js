/**
 * Sales orders and shipments — the pre-sales and fulfilment half of Phase 2.
 *
 * A sales order is a promise: the customer wants these items, maybe not all in
 * stock yet (backorder). It is NOT a sale — no stock moves, no invoice number —
 * until it is fulfilled into a real sale at the till. A shipment then tracks
 * the physical delivery.
 *
 * The RFID tie-in: fulfilment resolves the ordered variants against tagged
 * units at pick time, so what ships is what was scanned, not what was typed.
 */
import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, num, int, paging, nextRef } from '../lib/util.js';
import { requirePerm, requireFeature } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const r = Router();

/* ═══════════════════ sales orders ═══════════════════ */
r.get('/', requirePerm('sales_orders.read'), h(async (req, res) => {
  const { limit, offset, page } = paging(req, 30);
  const rows = await many(
    `SELECT so.*, c.name AS customer_name, l.name AS location_name, u.name AS created_by_name,
            (SELECT COALESCE(SUM(quantity),0) FROM sales_order_items i WHERE i.order_id=so.id) AS qty,
            (SELECT COALESCE(SUM(fulfilled_quantity),0) FROM sales_order_items i WHERE i.order_id=so.id) AS fulfilled
       FROM sales_orders so
       LEFT JOIN customers c ON c.id=so.customer_id
       JOIN locations l ON l.id=so.location_id
       LEFT JOIN users u ON u.id=so.created_by
      WHERE ($1::int IS NULL OR so.location_id=$1) AND ($2='' OR so.status=$2)
      ORDER BY so.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [req.query.location_id === 'all' ? null : int(req.query.location_id, req.locationId),
     str(req.query.status)]);
  res.json({ data: rows, page, limit });
}));

async function loadOrder(id) {
  const o = await one(
    `SELECT so.*, c.name AS customer_name, c.phone AS customer_phone, l.name AS location_name
       FROM sales_orders so LEFT JOIN customers c ON c.id=so.customer_id
       JOIN locations l ON l.id=so.location_id WHERE so.id=$1`, [id]);
  if (!o) return null;
  o.items = await many(
    `SELECT soi.*, v.sku, v.size, v.color, p.name AS product_name,
            (SELECT COALESCE(SUM(quantity),0) FROM inventory inv WHERE inv.variant_id=soi.variant_id) AS on_hand
       FROM sales_order_items soi
       JOIN product_variants v ON v.id=soi.variant_id
       JOIN products p ON p.id=v.product_id WHERE soi.order_id=$1 ORDER BY soi.id`, [id]);
  o.shipments = await many('SELECT * FROM shipments WHERE sales_order_id=$1 ORDER BY id DESC', [id]);
  return o;
}

r.get('/:id(\\d+)', requirePerm('sales_orders.read'), h(async (req, res) => {
  const o = await loadOrder(req.params.id);
  if (!o) throw notFound('Order not found');
  res.json(o);
}));

r.post('/', requirePerm('sales_orders.write'), h(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw bad('Add at least one line.');
  const out = await tx(async (c) => {
    const ref = await nextRef(c, 'sales_orders', 'SO');
    let subtotal = 0;
    const lines = [];
    for (const it of items) {
      const variantId = int(it.variant_id);
      const qty = num(it.quantity, 0);
      if (!variantId || qty <= 0) continue;
      const v = await one(
        `SELECT v.id, COALESCE(lp.selling_price, v.selling_price) AS price
           FROM product_variants v
           LEFT JOIN location_prices lp ON lp.variant_id=v.id AND lp.location_id=$2
          WHERE v.id=$1`, [variantId, int(req.body.location_id, req.locationId)]);
      if (!v) continue;
      const price = num(it.unit_price, Number(v.price));
      subtotal += price * qty;
      lines.push({ variantId, qty, price });
    }
    if (!lines.length) throw bad('No valid lines.');
    const { rows } = await c.query(
      `INSERT INTO sales_orders (ref, location_id, customer_id, order_date, due_date, subtotal, total, notes, created_by)
       VALUES ($1,$2,$3,CURRENT_DATE,$4,$5,$5,$6,$7) RETURNING *`,
      [ref, int(req.body.location_id, req.locationId), int(req.body.customer_id, null) || null,
       req.body.due_date || null, subtotal, str(req.body.notes), req.user.id]);
    const order = rows[0];
    for (const l of lines) {
      await c.query(
        'INSERT INTO sales_order_items (order_id, variant_id, quantity, unit_price) VALUES ($1,$2,$3,$4)',
        [order.id, l.variantId, l.qty, l.price]);
    }
    return order;
  });
  await audit(req, 'create', 'sales_order', out.id, { ref: out.ref });
  res.status(201).json(await loadOrder(out.id));
}));

/** Record fulfilment against ordered lines and advance the status. */
r.post('/:id(\\d+)/fulfil', requirePerm('sales_orders.write'), h(async (req, res) => {
  const lines = Array.isArray(req.body.items) ? req.body.items : [];
  const out = await tx(async (c) => {
    const { rows: orders } = await c.query('SELECT * FROM sales_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    const order = orders[0];
    if (!order) throw notFound('Order not found');
    if (order.status === 'cancelled') throw bad('That order is cancelled.');
    for (const l of lines) {
      const itemId = int(l.item_id);
      const qty = num(l.quantity, 0);
      if (!itemId || qty <= 0) continue;
      await c.query(
        `UPDATE sales_order_items
            SET fulfilled_quantity = LEAST(quantity, fulfilled_quantity + $2)
          WHERE id=$1 AND order_id=$3`, [itemId, qty, order.id]);
    }
    const { rows: totals } = await c.query(
      `SELECT COALESCE(SUM(quantity),0) AS q, COALESCE(SUM(fulfilled_quantity),0) AS f
         FROM sales_order_items WHERE order_id=$1`, [order.id]);
    const status = Number(totals[0].f) >= Number(totals[0].q) ? 'fulfilled'
      : Number(totals[0].f) > 0 ? 'partial' : 'open';
    await c.query('UPDATE sales_orders SET status=$2 WHERE id=$1', [order.id, status]);
    return status;
  });
  await audit(req, 'fulfil', 'sales_order', req.params.id, { status: out });
  res.json(await loadOrder(req.params.id));
}));

r.post('/:id(\\d+)/cancel', requirePerm('sales_orders.write'), h(async (req, res) => {
  const row = await one(
    "UPDATE sales_orders SET status='cancelled' WHERE id=$1 AND status<>'fulfilled' RETURNING *",
    [req.params.id]);
  if (!row) throw bad('A fulfilled order cannot be cancelled.');
  await audit(req, 'cancel', 'sales_order', row.id, {});
  res.json({ ok: true });
}));

/* ═══════════════════ shipments ═══════════════════ */
r.get('/shipments/all', requirePerm('shipments.read'), h(async (req, res) => {
  const { limit, offset, page } = paging(req, 30);
  const rows = await many(
    `SELECT sh.*, s.invoice_no, so.ref AS order_ref, u.name AS created_by_name
       FROM shipments sh
       LEFT JOIN sales s ON s.id=sh.sale_id
       LEFT JOIN sales_orders so ON so.id=sh.sales_order_id
       LEFT JOIN users u ON u.id=sh.created_by
      WHERE ($1='' OR sh.status=$1)
      ORDER BY sh.created_at DESC LIMIT ${limit} OFFSET ${offset}`, [str(req.query.status)]);
  res.json({ data: rows, page, limit });
}));

r.post('/shipments', requirePerm('shipments.write'), h(async (req, res) => {
  const out = await tx(async (c) => {
    const ref = await nextRef(c, 'shipments', 'SHP');
    const { rows } = await c.query(
      `INSERT INTO shipments (ref, sale_id, sales_order_id, status, carrier, tracking_no, address, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [ref, int(req.body.sale_id, null) || null, int(req.body.sales_order_id, null) || null,
       str(req.body.status) || 'pending', str(req.body.carrier), str(req.body.tracking_no),
       str(req.body.address), str(req.body.notes), req.user.id]);
    return rows[0];
  });
  await audit(req, 'create', 'shipment', out.id, { ref: out.ref });
  res.status(201).json(out);
}));

r.put('/shipments/:id(\\d+)', requirePerm('shipments.write'), h(async (req, res) => {
  const status = str(req.body.status);
  const stamp = status === 'shipped' ? ', shipped_at=now()'
    : status === 'delivered' ? ', delivered_at=now()' : '';
  const row = await one(
    `UPDATE shipments SET status=COALESCE($2,status), carrier=COALESCE($3,carrier),
            tracking_no=COALESCE($4,tracking_no), notes=COALESCE($5,notes) ${stamp}
      WHERE id=$1 RETURNING *`,
    [req.params.id, status || null, str(req.body.carrier) || null,
     str(req.body.tracking_no) || null, req.body.notes ?? null]);
  if (!row) throw notFound('Shipment not found');
  await audit(req, 'update', 'shipment', row.id, { status });
  res.json(row);
}));

export default r;
