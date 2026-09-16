/**
 * Inventory service.
 *
 * Two layers are kept in step by every function here:
 *   1. `inventory`    — aggregate quantity per (variant, location). Fast reads.
 *   2. `stock_units`  — one row per PHYSICAL unit, each with its own EPC.
 *
 * All functions take a transaction client so callers can compose them.
 */
import { buildEpc, buildReadable } from './epc.js';
import { money, num } from '../lib/util.js';

/** Bump the aggregate and write the movement ledger row. */
export async function moveStock(client, {
  variantId, locationId, delta, type, referenceType = null, referenceId = null,
  reason = null, unitId = null, userId = null,
}) {
  const { rows } = await client.query(
    `INSERT INTO inventory (variant_id, location_id, quantity)
     VALUES ($1,$2,$3)
     ON CONFLICT (variant_id, location_id)
     DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity
     RETURNING quantity`,
    [variantId, locationId, delta]
  );
  const balance = Number(rows[0].quantity);
  await client.query(
    `INSERT INTO stock_movements
       (variant_id, location_id, unit_id, type, quantity, balance_after, reference_type, reference_id, reason, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [variantId, locationId, unitId, type, delta, balance, referenceType, referenceId, reason, userId]
  );
  return balance;
}

/**
 * Create N physical units for a variant, each with its own unique EPC.
 * This is the ONLY place stock_units rows are born.
 */
export async function receiveUnits(client, {
  variantId, locationId, quantity, costPrice = 0, companyPrefix = '3035',
  referenceType = null, referenceId = null, sourceRef = null, userId = null,
  type = 'purchase', reason = null,
}) {
  const qty = Math.round(num(quantity));
  if (qty <= 0) return [];

  // Lock the variant so two receipts can't take the same serial.
  const vres = await client.query(
    'SELECT id, sku FROM product_variants WHERE id=$1 FOR UPDATE',
    [variantId]
  );
  if (!vres.rows.length) throw new Error(`Variant ${variantId} not found`);
  const sku = vres.rows[0].sku;

  const sres = await client.query(
    'SELECT COALESCE(MAX(serial),0) AS max FROM stock_units WHERE variant_id=$1',
    [variantId]
  );
  let serial = Number(sres.rows[0].max);

  const units = [];
  for (let i = 0; i < qty; i++) {
    serial += 1;
    const epc = buildEpc({ companyPrefix, variantId, serial });
    const readable = buildReadable(sku, serial);
    const { rows } = await client.query(
      `INSERT INTO stock_units
         (epc, epc_readable, variant_id, location_id, serial, status, cost_price, source_ref)
       VALUES ($1,$2,$3,$4,$5,'in_stock',$6,$7)
       RETURNING *`,
      [epc, readable, variantId, locationId, serial, money(costPrice), sourceRef]
    );
    units.push(rows[0]);
  }

  await moveStock(client, {
    variantId, locationId, delta: qty, type,
    referenceType, referenceId, reason, userId,
  });
  return units;
}

/**
 * Pick physical units to fulfil a sale/transfer.
 * Honours explicitly scanned unit ids first (RFID checkout), then FIFO.
 */
export async function allocateUnits(client, { variantId, locationId, quantity, preferredUnitIds = [] }) {
  const qty = Math.round(num(quantity));
  if (qty <= 0) return [];
  const picked = [];

  if (preferredUnitIds.length) {
    const { rows } = await client.query(
      `SELECT * FROM stock_units
        WHERE id = ANY($1::bigint[]) AND variant_id=$2 AND location_id=$3 AND status='in_stock'
        FOR UPDATE`,
      [preferredUnitIds, variantId, locationId]
    );
    picked.push(...rows.slice(0, qty));
  }

  if (picked.length < qty) {
    const need = qty - picked.length;
    const exclude = picked.map((u) => u.id);
    const { rows } = await client.query(
      `SELECT * FROM stock_units
        WHERE variant_id=$1 AND location_id=$2 AND status='in_stock'
          AND NOT (id = ANY($3::bigint[]))
        ORDER BY received_at ASC, id ASC
        LIMIT $4
        FOR UPDATE SKIP LOCKED`,
      [variantId, locationId, exclude.length ? exclude : [0], need]
    );
    picked.push(...rows);
  }
  return picked;
}

export async function markUnitsSold(client, unitIds, saleId) {
  if (!unitIds.length) return;
  await client.query(
    `UPDATE stock_units
        SET status='sold', sold_at=now(), sale_id=$2, last_seen_at=now()
      WHERE id = ANY($1::bigint[])`,
    [unitIds, saleId]
  );
}

export async function setUnitStatus(client, unitIds, status, extra = {}) {
  if (!unitIds.length) return;
  await client.query(
    `UPDATE stock_units
        SET status=$2,
            location_id = COALESCE($3, location_id),
            last_seen_at = now()
      WHERE id = ANY($1::bigint[])`,
    [unitIds, status, extra.locationId ?? null]
  );
}

/** Current on-hand for a variant at a location (aggregate, not unit count). */
export async function onHand(client, variantId, locationId) {
  const { rows } = await client.query(
    'SELECT COALESCE(quantity,0) AS q FROM inventory WHERE variant_id=$1 AND location_id=$2',
    [variantId, locationId]
  );
  return rows.length ? Number(rows[0].q) : 0;
}

/**
 * Expand a bundle into its component variants (for stock deduction).
 * Returns [] for non-bundles.
 */
export async function bundleComponents(client, variantId) {
  const { rows } = await client.query(
    `SELECT bi.component_variant_id AS variant_id, bi.quantity
       FROM bundle_items bi WHERE bi.bundle_variant_id=$1`,
    [variantId]
  );
  return rows;
}

/** Effective selling price for a variant at a location (location override wins). */
export async function effectivePrice(client, variantId, locationId) {
  const { rows } = await client.query(
    `SELECT COALESCE(lp.selling_price, pv.selling_price) AS price
       FROM product_variants pv
       LEFT JOIN location_prices lp ON lp.variant_id=pv.id AND lp.location_id=$2
      WHERE pv.id=$1`,
    [variantId, locationId]
  );
  return rows.length ? Number(rows[0].price) : 0;
}
