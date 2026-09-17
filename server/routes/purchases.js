import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, num, int, paging, getSettings, money } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { receiveUnits, allocateUnits, setUnitStatus, moveStock } from '../services/inventory.js';
import { nextRef } from '../lib/util.js';

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

// constrained to digits so /purchases/returns is not read as a purchase order id
r.get('/:id(\\d+)', h(async (req, res) => {
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


/* ------------------------------------------------------------------ */
/*  Purchase returns — sending bad goods back to the supplier           */
/* ------------------------------------------------------------------ */

/**
 * Goods going back to a supplier must not leave as a stock adjustment: that
 * buries supplier damage inside shrinkage and corrupts cost of goods. A return
 * takes the units out of stock with their own status, keeps the cost on the
 * supplier's account, and shows up in its own report.
 */
r.post('/returns', requirePerm('purchases.write'), h(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw bad('Add at least one item to return');
  const reason = str(req.body.reason).trim();
  if (!reason) throw bad('A reason is required for every purchase return');
  const locationId = int(req.body.location_id, req.locationId);

  const out = await tx(async (c) => {
    const ref = await nextRef(c, 'purchase_returns', 'PRT');
    const { rows } = await c.query(
      `INSERT INTO purchase_returns (ref, po_id, supplier_id, location_id, reason, notes, credit_note, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [ref, int(req.body.po_id) || null, int(req.body.supplier_id) || null, locationId,
       reason, str(req.body.notes), str(req.body.credit_note), req.user.id]);
    const ret = rows[0];

    let total = 0;
    for (const it of items) {
      const variantId = int(it.variant_id);
      const qty = Math.round(num(it.quantity, 0));
      if (!variantId || qty <= 0) continue;

      const { rows: inv } = await c.query(
        'SELECT COALESCE(quantity,0) AS q FROM inventory WHERE variant_id=$1 AND location_id=$2',
        [variantId, locationId]);
      const have = inv.length ? Number(inv[0].q) : 0;
      if (have < qty)
        throw bad(`Only ${have} in stock for that item — cannot return ${qty} to the supplier`);

      const { rows: vr } = await c.query('SELECT cost_price FROM product_variants WHERE id=$1', [variantId]);
      const unitCost = num(it.unit_cost, Number(vr[0]?.cost_price || 0));
      const lineTotal = money(unitCost * qty);
      total = money(total + lineTotal);

      await c.query(
        `INSERT INTO purchase_return_items (return_id, variant_id, quantity, unit_cost, line_total)
         VALUES ($1,$2,$3,$4,$5)`, [ret.id, variantId, qty, unitCost, lineTotal]);

      const units = await allocateUnits(c, {
        variantId, locationId, quantity: qty,
        preferredUnitIds: (it.unit_ids || []).map(Number).filter(Boolean),
      });
      await setUnitStatus(c, units.map((u) => u.id), 'returned_supplier');
      for (const u of units) {
        await c.query(
          'INSERT INTO purchase_return_units (return_id, unit_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [ret.id, u.id]);
      }

      await moveStock(c, {
        variantId, locationId, delta: -qty, type: 'purchase_return',
        referenceType: 'purchase_return', referenceId: ret.id,
        reason: `Returned to supplier on ${ref}: ${reason}`, userId: req.user.id,
      });
    }

    await c.query('UPDATE purchase_returns SET total=$2 WHERE id=$1', [ret.id, total]);
    if (ret.supplier_id) {
      await c.query('UPDATE suppliers SET amount_due = GREATEST(0, amount_due - $2) WHERE id=$1',
        [ret.supplier_id, total]);
    }
    return { ret, total };
  });

  await audit(req, 'create', 'purchase_return', out.ret.id, {
    ref: out.ret.ref, total: out.total, reason });
  res.status(201).json({ ok: true, ref: out.ret.ref, id: out.ret.id, total: out.total });
}));

r.get('/returns', h(async (req, res) => {
  const { limit, offset, page } = paging(req, 30);
  const locationId = req.query.location_id === 'all' ? null : int(req.query.location_id, req.locationId);
  const rows = await many(
    `SELECT pr.*, s.name AS supplier_name, l.name AS location_name, u.name AS user_name,
            po.po_number,
            (SELECT COUNT(*) FROM purchase_return_items i WHERE i.return_id=pr.id) AS line_count,
            (SELECT COALESCE(SUM(quantity),0) FROM purchase_return_items i WHERE i.return_id=pr.id) AS total_qty
       FROM purchase_returns pr
       LEFT JOIN suppliers s ON s.id=pr.supplier_id
       LEFT JOIN purchase_orders po ON po.id=pr.po_id
       JOIN locations l ON l.id=pr.location_id
       LEFT JOIN users u ON u.id=pr.user_id
      WHERE ($1::int IS NULL OR pr.location_id=$1)
      ORDER BY pr.created_at DESC LIMIT ${limit} OFFSET ${offset}`, [locationId]);
  const totals = await one(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0) AS value FROM purchase_returns
      WHERE ($1::int IS NULL OR location_id=$1)`, [locationId]);
  res.json({ data: rows, page, limit, total: totals.n, value: totals.value });
}));

r.get('/returns/:id', h(async (req, res) => {
  const ret = await one(
    `SELECT pr.*, s.name AS supplier_name, l.name AS location_name, u.name AS user_name, po.po_number
       FROM purchase_returns pr
       LEFT JOIN suppliers s ON s.id=pr.supplier_id
       LEFT JOIN purchase_orders po ON po.id=pr.po_id
       JOIN locations l ON l.id=pr.location_id
       LEFT JOIN users u ON u.id=pr.user_id WHERE pr.id=$1`, [req.params.id]);
  if (!ret) throw notFound('Purchase return not found');
  ret.items = await many(
    `SELECT pri.*, v.sku, v.size, v.color, p.name AS product_name
       FROM purchase_return_items pri
       JOIN product_variants v ON v.id=pri.variant_id
       JOIN products p ON p.id=v.product_id WHERE pri.return_id=$1`, [req.params.id]);
  ret.units = await many(
    `SELECT su.id, su.epc, su.epc_readable, p.name AS product_name, v.size, v.color
       FROM purchase_return_units pru
       JOIN stock_units su ON su.id=pru.unit_id
       JOIN product_variants v ON v.id=su.variant_id
       JOIN products p ON p.id=v.product_id WHERE pru.return_id=$1`, [req.params.id]);
  res.json(ret);
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
