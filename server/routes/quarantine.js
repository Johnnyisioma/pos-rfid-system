/**
 * Quarantine and return to vendor.
 *
 * A damaged shoe is not shrinkage and it is not stock. Leaving it in stock
 * means the system will happily sell it to somebody; writing it off straight
 * away throws away the supplier claim. So it goes into quarantine: still a
 * real unit with a real history, visible, but not sellable and not counted in
 * the figure the till checks against.
 *
 * Every item leaves quarantine one of four ways, and all four are recorded:
 * back to stock, back to the vendor, repaired, or written off.
 */
import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, int, paging } from '../lib/util.js';
import { requirePerm, requireFeature } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { moveStock } from '../services/inventory.js';
import { normalizeEpc, isEpcHex } from '../services/epc.js';

const r = Router();
r.use(requireFeature('quarantine'));

const REASONS = ['damaged', 'wrong_item', 'customer_return', 'supplier_fault', 'other'];

const SELECT = `
  SELECT q.*, su.epc, su.epc_readable, p.name AS product_name, v.sku AS variant_sku,
         v.size, v.color, l.name AS location_name,
         ru.name AS raised_by_name, su2.name AS resolved_by_name
    FROM quarantine_items q
    LEFT JOIN stock_units su ON su.id=q.unit_id
    LEFT JOIN product_variants v ON v.id=COALESCE(q.variant_id, su.variant_id)
    LEFT JOIN products p ON p.id=v.product_id
    LEFT JOIN locations l ON l.id=q.location_id
    LEFT JOIN users ru ON ru.id=q.raised_by
    LEFT JOIN users su2 ON su2.id=q.resolved_by`;

r.get('/', h(async (req, res) => {
  const { limit, offset, page } = paging(req, 50);
  const rows = await many(
    `${SELECT}
      WHERE ($1::int IS NULL OR q.location_id=$1)
        AND ($2='' OR q.outcome=$2)
      ORDER BY q.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [req.query.location_id === 'all' ? null : int(req.query.location_id, req.locationId),
     str(req.query.outcome)]);
  const totals = await one(
    `SELECT COUNT(*) FILTER (WHERE outcome='pending')::int AS pending,
            COUNT(*)::int AS total
       FROM quarantine_items WHERE ($1::int IS NULL OR location_id=$1)`,
    [req.query.location_id === 'all' ? null : int(req.query.location_id, req.locationId)]);
  res.json({ data: rows, page, limit, totals });
}));

/**
 * Put a unit into quarantine.
 *
 * Takes a tag, so this is a scan-and-go operation on the shop floor rather
 * than something that has to be done back at a computer with the item's
 * paperwork in hand.
 */
r.post('/', requirePerm('quarantine.write'), h(async (req, res) => {
  const reason = str(req.body.reason) || 'other';
  if (!REASONS.includes(reason)) throw bad(`Reason must be one of: ${REASONS.join(', ')}`);

  const code = normalizeEpc(req.body.epc || req.body.code);
  if (!code) throw bad('Scan the item first.');

  const out = await tx(async (c) => {
    const { rows: units } = await c.query(
      `SELECT su.*, p.name AS product_name FROM stock_units su
         JOIN product_variants v ON v.id=su.variant_id
         JOIN products p ON p.id=v.product_id
        WHERE su.epc=$1 OR su.epc_readable=$2 FOR UPDATE`,
      [code, String(req.body.epc || req.body.code).trim().toUpperCase()]);
    const unit = units[0];
    if (!unit) throw bad(`No unit is registered against ${code}.`);
    if (unit.status === 'quarantined') throw bad('That item is already in quarantine.');
    if (unit.status === 'sold') throw bad('That item is sold. Take it back as a return first.');

    // Out of sellable stock, but still a unit with a history. The aggregate
    // has to come down with it or the till will keep offering it.
    await c.query(
      `UPDATE stock_units SET status='quarantined', quarantine_reason=$2, last_seen_at=now()
        WHERE id=$1`, [unit.id, reason]);
    if (unit.status === 'in_stock' && unit.location_id) {
      await moveStock(c, {
        variantId: unit.variant_id, locationId: unit.location_id, delta: -1,
        type: 'adjustment', unitId: unit.id, referenceType: 'quarantine',
        reason: `Quarantined: ${reason}`, userId: req.user.id });
    }

    const { rows } = await c.query(
      `INSERT INTO quarantine_items
         (unit_id, variant_id, location_id, reason, detail, photo_url, raised_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [unit.id, unit.variant_id, unit.location_id, reason, str(req.body.detail),
       str(req.body.photo_url) || null, req.user.id]);
    return { row: rows[0], unit };
  });

  await audit(req, 'quarantine', 'stock_unit', out.unit.id, { reason });
  res.status(201).json(await one(`${SELECT} WHERE q.id=$1`, [out.row.id]));
}));

/**
 * Decide what happens to it.
 *
 * `returned_to_stock` is the only outcome that puts the quantity back, and it
 * is deliberately the one that needs someone to have looked at the item.
 */
r.post('/:id(\\d+)/resolve', requirePerm('quarantine.write'), h(async (req, res) => {
  const outcome = str(req.body.outcome);
  const allowed = ['returned_to_stock', 'returned_to_vendor', 'written_off', 'repaired'];
  if (!allowed.includes(outcome)) throw bad(`Outcome must be one of: ${allowed.join(', ')}`);

  const out = await tx(async (c) => {
    const { rows } = await c.query(
      'SELECT * FROM quarantine_items WHERE id=$1 FOR UPDATE', [req.params.id]);
    const q = rows[0];
    if (!q) throw notFound('Not found');
    if (q.outcome !== 'pending') throw bad('That has already been dealt with.');

    const { rows: units } = await c.query('SELECT * FROM stock_units WHERE id=$1', [q.unit_id]);
    const unit = units[0];

    // repaired and returned_to_stock both mean it is sellable again.
    const backToStock = outcome === 'returned_to_stock' || outcome === 'repaired';
    const status = backToStock ? 'in_stock'
      : outcome === 'returned_to_vendor' ? 'returned_supplier' : 'damaged';

    if (unit) {
      await c.query('UPDATE stock_units SET status=$2, quarantine_reason=NULL WHERE id=$1',
        [unit.id, status]);
      if (backToStock && unit.location_id) {
        await moveStock(c, {
          variantId: unit.variant_id, locationId: unit.location_id, delta: 1,
          type: 'adjustment', unitId: unit.id, referenceType: 'quarantine',
          referenceId: q.id, reason: `Back in stock after ${outcome}`, userId: req.user.id });
      }
    }

    const { rows: updated } = await c.query(
      `UPDATE quarantine_items
          SET outcome=$2, resolved_by=$3, resolved_at=now(),
              detail = CASE WHEN $4='' THEN detail ELSE detail || E'\\n' || $4 END
        WHERE id=$1 RETURNING *`,
      [q.id, outcome, req.user.id, str(req.body.note)]);
    return updated[0];
  });

  await audit(req, 'resolve', 'quarantine_item', out.id, { outcome });
  res.json(await one(`${SELECT} WHERE q.id=$1`, [out.id]));
}));

export default r;
