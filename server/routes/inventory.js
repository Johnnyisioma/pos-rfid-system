import { Router } from 'express';
import { many, one, tx } from '../db/index.js';
import { h, bad, str, num, int, paging, nextRef, getSettings } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { moveStock, receiveUnits, setUnitStatus, allocateUnits } from '../services/inventory.js';

const r = Router();

/* ---- stock levels across the current (or all) location(s) ---- */
r.get('/levels', h(async (req, res) => {
  const { limit, offset, page } = paging(req, 50);
  const locationId = req.query.location_id === 'all' ? null : (int(req.query.location_id, req.locationId) || null);
  const params = [];
  const where = ['TRUE'];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (locationId) add('i.location_id = ?', locationId);
  if (req.query.q) add('(p.name ILIKE ? OR v.sku ILIKE ? OR p.sku ILIKE ?)', `%${req.query.q}%`);
  if (req.query.category_id) add('p.category_id = ?', int(req.query.category_id));
  if (req.query.low === 'true')
    where.push('i.quantity <= COALESCE(i.reorder_point, v.reorder_point, p.reorder_point, 0)');

  const rows = await many(
    `SELECT v.id AS variant_id, v.sku, v.size, v.color, v.cost_price, v.selling_price,
            p.id AS product_id, p.name AS product_name, p.unit, p.image_url,
            l.id AS location_id, l.name AS location_name, l.code AS location_code,
            COALESCE(i.quantity,0) AS quantity,
            COALESCE(i.reorder_point, v.reorder_point, p.reorder_point, 0) AS reorder_point,
            COALESCE(i.quantity,0) * v.cost_price AS stock_value,
            (SELECT COUNT(*) FROM stock_units su
              WHERE su.variant_id=v.id AND su.location_id=l.id AND su.status='in_stock') AS tagged_units
       FROM inventory i
       JOIN product_variants v ON v.id=i.variant_id
       JOIN products p ON p.id=v.product_id
       JOIN locations l ON l.id=i.location_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.name, v.size, v.color
      LIMIT ${limit} OFFSET ${offset}`, params);
  const total = await one(
    `SELECT COUNT(*)::int AS n FROM inventory i
       JOIN product_variants v ON v.id=i.variant_id
       JOIN products p ON p.id=v.product_id
       JOIN locations l ON l.id=i.location_id
      WHERE ${where.join(' AND ')}`, params);
  res.json({ data: rows, page, limit, total: total.n });
}));

/* ---- cross-location availability for one variant ---- */
r.get('/availability/:variantId', h(async (req, res) => {
  const rows = await many(
    `SELECT l.id AS location_id, l.name, l.code, COALESCE(i.quantity,0) AS quantity,
            (SELECT COUNT(*) FROM stock_units su
              WHERE su.variant_id=$1 AND su.location_id=l.id AND su.status='in_stock') AS units
       FROM locations l
       LEFT JOIN inventory i ON i.location_id=l.id AND i.variant_id=$1
      WHERE l.is_active ORDER BY l.name`, [req.params.variantId]);
  res.json(rows);
}));

/* ---- low stock ---- */
r.get('/low-stock', h(async (req, res) => {
  const locationId = req.query.location_id === 'all' ? null : (int(req.query.location_id, req.locationId) || null);
  const rows = await many(
    `SELECT v.id AS variant_id, v.sku, v.size, v.color, p.name AS product_name, p.id AS product_id,
            l.name AS location_name, l.id AS location_id,
            COALESCE(i.quantity,0) AS quantity,
            COALESCE(i.reorder_point, v.reorder_point, p.reorder_point, 0) AS reorder_point,
            v.cost_price, v.selling_price
       FROM inventory i
       JOIN product_variants v ON v.id=i.variant_id
       JOIN products p ON p.id=v.product_id
       JOIN locations l ON l.id=i.location_id
      WHERE p.is_active AND v.is_active
        AND COALESCE(i.quantity,0) <= COALESCE(i.reorder_point, v.reorder_point, p.reorder_point, 0)
        AND ($1::int IS NULL OR i.location_id=$1)
      ORDER BY (COALESCE(i.quantity,0) - COALESCE(i.reorder_point, v.reorder_point, p.reorder_point, 0)), p.name`,
    [locationId]);
  res.json(rows);
}));

/* ---- set reorder point per location ---- */
r.put('/reorder-point', requirePerm('inventory.write'), h(async (req, res) => {
  const variantId = int(req.body.variant_id);
  const locationId = int(req.body.location_id, req.locationId);
  const row = await one(
    `INSERT INTO inventory (variant_id, location_id, quantity, reorder_point)
     VALUES ($1,$2,0,$3)
     ON CONFLICT (variant_id, location_id) DO UPDATE SET reorder_point=EXCLUDED.reorder_point
     RETURNING *`, [variantId, locationId, int(req.body.reorder_point, 0)]);
  await audit(req, 'update', 'reorder_point', variantId, { locationId, value: row.reorder_point });
  res.json(row);
}));

/* ---- direct stock receipt (no PO) ---- */
r.post('/receive', requirePerm('inventory.write'), h(async (req, res) => {
  const settings = await getSettings();
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw bad('Add at least one item');
  const locationId = int(req.body.location_id, req.locationId);

  const result = await tx(async (c) => {
    const ref = await nextRef(c, 'stock_adjustments', 'RCV');
    const { rows } = await c.query(
      `INSERT INTO stock_adjustments (ref, location_id, reason, notes, user_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [ref, locationId, str(req.body.reason, 'Direct stock receipt'), str(req.body.notes), req.user.id]);
    const adj = rows[0];
    const allUnits = [];
    for (const it of items) {
      const qty = int(it.quantity, 0);
      if (qty <= 0) continue;
      const units = await receiveUnits(c, {
        variantId: int(it.variant_id), locationId, quantity: qty,
        costPrice: num(it.cost_price, 0), companyPrefix: settings.epc_company_prefix,
        referenceType: 'receipt', referenceId: adj.id, sourceRef: ref,
        userId: req.user.id, type: 'purchase', reason: adj.reason,
      });
      allUnits.push(...units);
      await c.query(
        'INSERT INTO stock_adjustment_items (adjustment_id,variant_id,quantity_change) VALUES ($1,$2,$3)',
        [adj.id, int(it.variant_id), qty]);
    }
    return { adj, units: allUnits };
  });

  await audit(req, 'receive', 'stock', result.adj.id, { ref: result.adj.ref, units: result.units.length });
  res.status(201).json({ ok: true, ref: result.adj.ref, units_created: result.units.length, units: result.units });
}));

/* ---- adjustments (damage / loss / correction) ---- */
r.post('/adjustments', requirePerm('inventory.write'), h(async (req, res) => {
  const settings = await getSettings();
  const reason = str(req.body.reason).trim();
  if (!reason) throw bad('A reason is required for every stock adjustment');
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw bad('Add at least one line');
  const locationId = int(req.body.location_id, req.locationId);

  const out = await tx(async (c) => {
    const ref = await nextRef(c, 'stock_adjustments', 'ADJ');
    const { rows } = await c.query(
      `INSERT INTO stock_adjustments (ref,location_id,reason,notes,user_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [ref, locationId, reason, str(req.body.notes), req.user.id]);
    const adj = rows[0];
    let created = 0;
    const affected = [];

    for (const it of items) {
      const variantId = int(it.variant_id);
      const delta = Math.round(num(it.quantity_change, 0));
      if (!variantId || delta === 0) continue;

      if (delta > 0) {
        const units = await receiveUnits(c, {
          variantId, locationId, quantity: delta, costPrice: num(it.cost_price, 0),
          companyPrefix: settings.epc_company_prefix, referenceType: 'adjustment',
          referenceId: adj.id, sourceRef: ref, userId: req.user.id,
          type: 'adjustment', reason,
        });
        created += units.length;
        for (const u of units) {
          await c.query('INSERT INTO stock_adjustment_items (adjustment_id,variant_id,quantity_change,unit_id) VALUES ($1,$2,$3,$4)',
            [adj.id, variantId, 1, u.id]);
        }
      } else {
        const need = Math.abs(delta);
        const onHandRow = await c.query(
          'SELECT COALESCE(quantity,0) AS q FROM inventory WHERE variant_id=$1 AND location_id=$2',
          [variantId, locationId]);
        const have = onHandRow.rows.length ? Number(onHandRow.rows[0].q) : 0;
        if (have < need && !req.body.allow_negative)
          throw bad(`Only ${have} in stock for that item — cannot remove ${need}`);

        const preferred = Array.isArray(it.unit_ids) ? it.unit_ids.map(Number) : [];
        const units = await allocateUnits(c, { variantId, locationId, quantity: need, preferredUnitIds: preferred });
        const status = /damag/i.test(reason) ? 'damaged' : /lost|miss|theft|stolen/i.test(reason) ? 'lost' : 'damaged';
        await setUnitStatus(c, units.map((u) => u.id), status);
        for (const u of units) {
          await c.query('INSERT INTO stock_adjustment_items (adjustment_id,variant_id,quantity_change,unit_id) VALUES ($1,$2,$3,$4)',
            [adj.id, variantId, -1, u.id]);
        }
        if (units.length < need) {
          await c.query('INSERT INTO stock_adjustment_items (adjustment_id,variant_id,quantity_change) VALUES ($1,$2,$3)',
            [adj.id, variantId, -(need - units.length)]);
        }
        await moveStock(c, {
          variantId, locationId, delta: -need, type: 'adjustment',
          referenceType: 'adjustment', referenceId: adj.id, reason, userId: req.user.id,
        });
      }
      affected.push(variantId);
    }
    return { adj, created, affected };
  });

  await audit(req, 'adjust', 'inventory', out.adj.id, { ref: out.adj.ref, reason, lines: items.length });
  res.status(201).json({ ok: true, ref: out.adj.ref, units_created: out.created });
}));

r.get('/adjustments', h(async (req, res) => {
  const { limit, offset, page } = paging(req, 30);
  const locationId = req.query.location_id === 'all' ? null : (int(req.query.location_id, req.locationId) || null);
  const rows = await many(
    `SELECT a.*, l.name AS location_name, u.name AS user_name,
            (SELECT COUNT(*) FROM stock_adjustment_items i WHERE i.adjustment_id=a.id) AS line_count,
            (SELECT COALESCE(SUM(quantity_change),0) FROM stock_adjustment_items i WHERE i.adjustment_id=a.id) AS net_change
       FROM stock_adjustments a
       JOIN locations l ON l.id=a.location_id
       LEFT JOIN users u ON u.id=a.user_id
      WHERE ($1::int IS NULL OR a.location_id=$1)
      ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`, [locationId]);
  res.json({ data: rows, page, limit });
}));

/* ---- movement ledger ---- */
r.get('/movements', h(async (req, res) => {
  const { limit, offset, page } = paging(req, 50);
  const params = [];
  const where = ['TRUE'];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.variant_id) add('m.variant_id = ?', int(req.query.variant_id));
  if (req.query.location_id && req.query.location_id !== 'all') add('m.location_id = ?', int(req.query.location_id));
  if (req.query.type) add('m.type = ?', str(req.query.type));
  const rows = await many(
    `SELECT m.*, v.sku, v.size, v.color, p.name AS product_name, l.name AS location_name, u.name AS user_name
       FROM stock_movements m
       JOIN product_variants v ON v.id=m.variant_id
       JOIN products p ON p.id=v.product_id
       JOIN locations l ON l.id=m.location_id
       LEFT JOIN users u ON u.id=m.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY m.created_at DESC, m.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.json({ data: rows, page, limit });
}));

/* ---- valuation ---- */
r.get('/valuation', h(async (req, res) => {
  const locationId = req.query.location_id === 'all' ? null : (int(req.query.location_id, req.locationId) || null);
  const summary = await one(
    `SELECT COALESCE(SUM(i.quantity),0) AS units,
            COALESCE(SUM(i.quantity * v.cost_price),0) AS cost_value,
            COALESCE(SUM(i.quantity * COALESCE(lp.selling_price, v.selling_price)),0) AS retail_value
       FROM inventory i
       JOIN product_variants v ON v.id=i.variant_id
       LEFT JOIN location_prices lp ON lp.variant_id=v.id AND lp.location_id=i.location_id
      WHERE i.quantity > 0 AND ($1::int IS NULL OR i.location_id=$1)`, [locationId]);
  const byCategory = await many(
    `SELECT COALESCE(c.name,'Uncategorised') AS category,
            SUM(i.quantity) AS units,
            SUM(i.quantity * v.cost_price) AS cost_value,
            SUM(i.quantity * COALESCE(lp.selling_price, v.selling_price)) AS retail_value
       FROM inventory i
       JOIN product_variants v ON v.id=i.variant_id
       JOIN products p ON p.id=v.product_id
       LEFT JOIN categories c ON c.id=p.category_id
       LEFT JOIN location_prices lp ON lp.variant_id=v.id AND lp.location_id=i.location_id
      WHERE i.quantity > 0 AND ($1::int IS NULL OR i.location_id=$1)
      GROUP BY 1 ORDER BY cost_value DESC`, [locationId]);
  const byLocation = await many(
    `SELECT l.name AS location, SUM(i.quantity) AS units,
            SUM(i.quantity * v.cost_price) AS cost_value,
            SUM(i.quantity * v.selling_price) AS retail_value
       FROM inventory i
       JOIN product_variants v ON v.id=i.variant_id
       JOIN locations l ON l.id=i.location_id
      WHERE i.quantity > 0 GROUP BY 1 ORDER BY cost_value DESC`);
  res.json({
    summary: {
      ...summary,
      potential_profit: Number(summary.retail_value) - Number(summary.cost_value),
    },
    by_category: byCategory,
    by_location: byLocation,
  });
}));

export default r;
