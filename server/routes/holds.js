/**
 * Cross-branch stock visibility, and holds.
 *
 * "They have it at Ikeja" is only worth saying if it will still be there when
 * the customer gets to Ikeja. Without a hold, the useful half of multi-branch
 * visibility — telling a customer where to go — is the half that produces a
 * wasted journey and a lost sale.
 *
 * A hold takes the unit out of sellable stock at the branch that has it, under
 * a reference the customer can quote, with an expiry so forgotten holds do not
 * quietly strand stock for a month.
 */
import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, num, int, nextRef, paging } from '../lib/util.js';
import { requirePerm, requireFeature } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { moveStock } from '../services/inventory.js';

const r = Router();

/**
 * Where else is this in stock?
 *
 * Deliberately NOT behind the holds feature flag — knowing where stock is
 * useful on its own, even in a shop that never holds anything.
 */
r.get('/availability', h(async (req, res) => {
  const variantId = int(req.query.variant_id, null);
  if (!variantId) throw bad('Which item?');
  const rows = await many(
    `SELECT l.id AS location_id, l.name AS location_name, l.code, l.phone, l.address,
            COALESCE(i.quantity, 0) AS quantity,
            (SELECT COUNT(*)::int FROM stock_holds sh
              WHERE sh.variant_id=$1 AND sh.location_id=l.id AND sh.status='active') AS held,
            (SELECT COUNT(*)::int FROM stock_units su
              WHERE su.variant_id=$1 AND su.location_id=l.id AND su.status='in_stock') AS tagged_units
       FROM locations l
       LEFT JOIN inventory i ON i.variant_id=$1 AND i.location_id=l.id
      WHERE l.is_active
      ORDER BY (l.id = $2) DESC, COALESCE(i.quantity,0) DESC, l.name`,
    [variantId, req.locationId]);

  res.json(rows.map((row) => ({
    ...row,
    // What somebody could actually walk out with, which is not the same as
    // what the stock figure says once holds are counted.
    available: Math.max(0, Number(row.quantity) - Number(row.held)),
    is_current: Number(row.location_id) === Number(req.locationId),
  })));
}));

r.use(requireFeature('holds'));

const SELECT = `
  SELECT sh.*, p.name AS product_name, v.sku AS variant_sku, v.size, v.color,
         l.name AS location_name, fl.name AS for_location_name,
         c.name AS customer_name, c.phone AS customer_phone,
         u.name AS created_by_name, su.epc_readable
    FROM stock_holds sh
    JOIN product_variants v ON v.id=sh.variant_id
    JOIN products p ON p.id=v.product_id
    JOIN locations l ON l.id=sh.location_id
    LEFT JOIN locations fl ON fl.id=sh.for_location_id
    LEFT JOIN customers c ON c.id=sh.customer_id
    LEFT JOIN users u ON u.id=sh.created_by
    LEFT JOIN stock_units su ON su.id=sh.unit_id`;

r.get('/', h(async (req, res) => {
  const { limit, offset, page } = paging(req, 50);
  const rows = await many(
    `${SELECT}
      WHERE ($1::int IS NULL OR sh.location_id=$1)
        AND ($2='' OR sh.status=$2)
      ORDER BY sh.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [req.query.location_id === 'all' ? null : int(req.query.location_id, req.locationId),
     str(req.query.status)]);
  res.json({ data: rows, page, limit });
}));

r.post('/', requirePerm('sales.create'), h(async (req, res) => {
  const variantId = int(req.body.variant_id);
  if (!variantId) throw bad('Which item?');
  const locationId = int(req.body.location_id, req.locationId);
  const quantity = Math.max(1, Math.round(num(req.body.quantity, 1)));
  const hours = Math.max(1, int(req.body.hours, 48));

  const out = await tx(async (c) => {
    const { rows: inv } = await c.query(
      `SELECT COALESCE(quantity,0) AS q FROM inventory
        WHERE variant_id=$1 AND location_id=$2 FOR UPDATE`, [variantId, locationId]);
    const onHand = inv.length ? Number(inv[0].q) : 0;
    const { rows: heldRows } = await c.query(
      `SELECT COUNT(*)::int AS n FROM stock_holds
        WHERE variant_id=$1 AND location_id=$2 AND status='active'`, [variantId, locationId]);
    const free = onHand - Number(heldRows[0].n);
    if (free < quantity) {
      throw bad(`Only ${Math.max(0, free)} available to hold there — the rest is already on hold or sold.`);
    }

    // Prefer holding a SPECIFIC tagged unit. Then the customer collects the
    // exact pair that was set aside, and a stock take can see why it is on the
    // shelf but not sellable.
    let unitId = int(req.body.unit_id, null) || null;
    if (!unitId) {
      const { rows: units } = await c.query(
        `SELECT id FROM stock_units
          WHERE variant_id=$1 AND location_id=$2 AND status='in_stock'
          ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT 1`, [variantId, locationId]);
      unitId = units[0]?.id || null;
    }

    const ref = await nextRef(c, 'stock_holds', 'HLD');
    const { rows } = await c.query(
      `INSERT INTO stock_holds
         (ref, variant_id, unit_id, location_id, quantity, customer_id, for_location_id,
          note, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + ($9 || ' hours')::interval, $10)
       RETURNING *`,
      [ref, variantId, unitId, locationId, quantity,
       int(req.body.customer_id, null) || null,
       int(req.body.for_location_id, null) || null,
       str(req.body.note), String(hours), req.user.id]);

    if (unitId) {
      await c.query("UPDATE stock_units SET status='held', held_for_sale_id=NULL WHERE id=$1", [unitId]);
    }
    return rows[0];
  });

  await audit(req, 'create', 'stock_hold', out.id, { ref: out.ref, variant_id: variantId });
  res.status(201).json(await one(`${SELECT} WHERE sh.id=$1`, [out.id]));
}));

/** Close a hold: collected, released, or transferred onward. */
r.post('/:id(\\d+)/close', requirePerm('sales.create'), h(async (req, res) => {
  const status = str(req.body.status) || 'released';
  if (!['collected', 'released', 'expired', 'transferred'].includes(status))
    throw bad('Status must be collected, released, expired or transferred.');

  const out = await tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM stock_holds WHERE id=$1 FOR UPDATE', [req.params.id]);
    const hold = rows[0];
    if (!hold) throw notFound('Hold not found');
    if (hold.status !== 'active') throw bad('That hold is already closed.');

    if (hold.unit_id) {
      // Collected means it went out on a sale, which handles the stock itself.
      // Released and expired put it straight back on the shelf.
      const back = status === 'released' || status === 'expired';
      await c.query(
        `UPDATE stock_units SET status=$2 WHERE id=$1 AND status='held'`,
        [hold.unit_id, back ? 'in_stock' : (status === 'transferred' ? 'in_transit' : 'in_stock')]);
    }

    const { rows: updated } = await c.query(
      `UPDATE stock_holds SET status=$2, closed_at=now() WHERE id=$1 RETURNING *`,
      [hold.id, status]);
    return updated[0];
  });

  await audit(req, 'close', 'stock_hold', out.id, { status });
  res.json(await one(`${SELECT} WHERE sh.id=$1`, [out.id]));
}));

/**
 * Expire everything past its time.
 *
 * Called by the app rather than a cron, because a shop that never opens the
 * holds screen has no holds to expire, and a background job that quietly
 * releases a customer's shoes on a Sunday is worse than one that runs when
 * somebody is looking.
 */
r.post('/expire-due', requirePerm('sales.create'), h(async (req, res) => {
  const out = await tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE stock_holds SET status='expired', closed_at=now()
        WHERE status='active' AND expires_at < now() RETURNING *`);
    const unitIds = rows.map((x) => x.unit_id).filter(Boolean);
    if (unitIds.length) {
      await c.query(
        "UPDATE stock_units SET status='in_stock' WHERE id = ANY($1::bigint[]) AND status='held'",
        [unitIds]);
    }
    return rows;
  });
  res.json({ expired: out.length, refs: out.map((x) => x.ref) });
}));

export default r;
