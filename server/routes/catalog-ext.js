/**
 * Phase 1 catalog — the reference data the ERP catalog features hang off:
 * units of measure, price tiers, bin/shelf locations, lots, and label
 * templates. Small, CRUD-shaped, and all gated behind products.write because
 * these are setup tables an owner curates, not a cashier.
 *
 * The RFID synergy lives in how OTHER routes read these (a sweep resolving a
 * tag's pack_level to a price tier); here we just keep the lists.
 */
import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, num, int, bool, paging } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { normalizeEpc, isEpcHex } from '../services/epc.js';

const r = Router();

/* ═══════════════════ units of measure ═══════════════════ */
r.get('/units', h(async (req, res) => {
  res.json(await many(
    `SELECT u.*, b.name AS base_unit_name FROM units u
       LEFT JOIN units b ON b.id=u.base_unit_id
      WHERE u.is_active OR $1 ORDER BY u.name`, [bool(req.query.all)]));
}));

r.post('/units', requirePerm('products.write'), h(async (req, res) => {
  const name = str(req.body.name);
  const short = str(req.body.short_name);
  if (!name || !short) throw bad('A unit needs a name and a short name.');
  const row = await one(
    `INSERT INTO units (name, short_name, allow_decimal, base_unit_id, base_multiple)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [name, short, bool(req.body.allow_decimal),
     int(req.body.base_unit_id, null) || null,
     req.body.base_multiple != null ? num(req.body.base_multiple, null) : null]);
  await audit(req, 'create', 'unit', row.id, { name });
  res.status(201).json(row);
}));

r.put('/units/:id(\\d+)', requirePerm('products.write'), h(async (req, res) => {
  const row = await one(
    `UPDATE units SET name=COALESCE($2,name), short_name=COALESCE($3,short_name),
            allow_decimal=COALESCE($4,allow_decimal), base_unit_id=$5, base_multiple=$6,
            is_active=COALESCE($7,is_active)
      WHERE id=$1 RETURNING *`,
    [req.params.id, str(req.body.name) || null, str(req.body.short_name) || null,
     'allow_decimal' in req.body ? bool(req.body.allow_decimal) : null,
     int(req.body.base_unit_id, null) || null,
     req.body.base_multiple != null ? num(req.body.base_multiple, null) : null,
     'is_active' in req.body ? bool(req.body.is_active) : null]);
  if (!row) throw notFound('Unit not found');
  res.json(row);
}));

/* ═══════════════════ price groups (tiers) ═══════════════════ */
r.get('/price-groups', h(async (req, res) => {
  res.json(await many('SELECT * FROM price_groups WHERE is_active OR $1 ORDER BY name',
    [bool(req.query.all)]));
}));

r.post('/price-groups', requirePerm('products.write'), h(async (req, res) => {
  const name = str(req.body.name);
  if (!name) throw bad('Name the price group.');
  const row = await one(
    'INSERT INTO price_groups (name, description) VALUES ($1,$2) RETURNING *',
    [name, str(req.body.description)]);
  await audit(req, 'create', 'price_group', row.id, { name });
  res.status(201).json(row);
}));

r.put('/price-groups/:id(\\d+)', requirePerm('products.write'), h(async (req, res) => {
  const row = await one(
    `UPDATE price_groups SET name=COALESCE($2,name), description=COALESCE($3,description),
            is_active=COALESCE($4,is_active) WHERE id=$1 RETURNING *`,
    [req.params.id, str(req.body.name) || null, req.body.description ?? null,
     'is_active' in req.body ? bool(req.body.is_active) : null]);
  if (!row) throw notFound('Price group not found');
  res.json(row);
}));

/** The tier prices for one variant, and a way to set them in one call. */
r.get('/variants/:id(\\d+)/prices', h(async (req, res) => {
  res.json(await many(
    `SELECT pg.id AS group_id, pg.name, vgp.price
       FROM price_groups pg
       LEFT JOIN variant_group_prices vgp
         ON vgp.group_id=pg.id AND vgp.variant_id=$1
      WHERE pg.is_active ORDER BY pg.name`, [req.params.id]));
}));

r.put('/variants/:id(\\d+)/prices', requirePerm('products.write'), h(async (req, res) => {
  const variantId = int(req.params.id);
  const prices = Array.isArray(req.body.prices) ? req.body.prices : [];
  await tx(async (c) => {
    for (const p of prices) {
      const gid = int(p.group_id);
      if (!gid) continue;
      if (p.price === '' || p.price == null) {
        await c.query('DELETE FROM variant_group_prices WHERE variant_id=$1 AND group_id=$2',
          [variantId, gid]);
      } else {
        await c.query(
          `INSERT INTO variant_group_prices (variant_id, group_id, price)
           VALUES ($1,$2,$3) ON CONFLICT (variant_id, group_id)
           DO UPDATE SET price=EXCLUDED.price`, [variantId, gid, num(p.price, 0)]);
      }
    }
  });
  res.json({ ok: true });
}));

/* ═══════════════════ bin / shelf / rack ═══════════════════ */
r.get('/bins', h(async (req, res) => {
  const locationId = req.query.location_id === 'all' ? null : int(req.query.location_id, req.locationId);
  res.json(await many(
    `SELECT b.*, l.name AS location_name,
            (SELECT COUNT(*)::int FROM stock_units su
              WHERE su.bin_location_id=b.id AND su.status='in_stock') AS units
       FROM bin_locations b JOIN locations l ON l.id=b.location_id
      WHERE ($1::int IS NULL OR b.location_id=$1)
      ORDER BY b.label`, [locationId]));
}));

r.post('/bins', requirePerm('products.write'), h(async (req, res) => {
  const label = str(req.body.label);
  if (!label) throw bad('Give the location a label, like A-3-2.');
  const row = await one(
    `INSERT INTO bin_locations (location_id, zone, aisle, rack, shelf, bin, label)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [int(req.body.location_id, req.locationId), str(req.body.zone), str(req.body.aisle),
     str(req.body.rack), str(req.body.shelf), str(req.body.bin), label]);
  await audit(req, 'create', 'bin_location', row.id, { label });
  res.status(201).json(row);
}));

r.put('/bins/:id(\\d+)', requirePerm('products.write'), h(async (req, res) => {
  const row = await one(
    `UPDATE bin_locations SET zone=COALESCE($2,zone), aisle=COALESCE($3,aisle),
            rack=COALESCE($4,rack), shelf=COALESCE($5,shelf), bin=COALESCE($6,bin),
            label=COALESCE($7,label), is_active=COALESCE($8,is_active)
      WHERE id=$1 RETURNING *`,
    [req.params.id, str(req.body.zone) ?? null, str(req.body.aisle) ?? null,
     str(req.body.rack) ?? null, str(req.body.shelf) ?? null, str(req.body.bin) ?? null,
     str(req.body.label) || null, 'is_active' in req.body ? bool(req.body.is_active) : null]);
  if (!row) throw notFound('Bin not found');
  res.json(row);
}));

/** Move a tag to a bin — the write half of location-accurate sweeps. */
r.post('/bins/:id(\\d+)/assign', requirePerm('inventory.write'), h(async (req, res) => {
  const binId = int(req.params.id);
  const codes = (Array.isArray(req.body.codes) ? req.body.codes : [])
    .map(normalizeEpc).filter(isEpcHex);
  if (!codes.length) throw bad('Scan at least one tag to move into this bin.');
  const { rowCount } = await query(
    `UPDATE stock_units SET bin_location_id=$1 WHERE epc = ANY($2::text[])`, [binId, codes]);
  await audit(req, 'assign_bin', 'bin_location', binId, { units: rowCount });
  res.json({ ok: true, moved: rowCount });
}));

/* ═══════════════════ lots & expiry ═══════════════════ */
r.get('/lots', h(async (req, res) => {
  const { limit, offset, page } = paging(req, 50);
  const rows = await many(
    `SELECT pl.*, v.sku, p.name AS product_name,
            (SELECT COUNT(*)::int FROM stock_units su WHERE su.lot_id=pl.id AND su.status='in_stock') AS in_stock
       FROM product_lots pl
       JOIN product_variants v ON v.id=pl.variant_id
       JOIN products p ON p.id=v.product_id
      WHERE ($1::text = '' OR pl.expiry_date <= ($1::date))
      ORDER BY pl.expiry_date NULLS LAST, pl.id DESC LIMIT ${limit} OFFSET ${offset}`,
    [str(req.query.expiring_before)]);
  res.json({ data: rows, page, limit });
}));

r.post('/lots', requirePerm('inventory.write'), h(async (req, res) => {
  const variantId = int(req.body.variant_id);
  const lotNo = str(req.body.lot_no);
  if (!variantId || !lotNo) throw bad('A lot needs a product and a lot number.');
  const row = await one(
    `INSERT INTO product_lots (variant_id, lot_no, mfg_date, expiry_date, cost_price)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [variantId, lotNo, req.body.mfg_date || null, req.body.expiry_date || null,
     num(req.body.cost_price, 0)]);
  await audit(req, 'create', 'lot', row.id, { lot_no: lotNo });
  res.status(201).json(row);
}));

/* ═══════════════════ label / barcode templates ═══════════════════ */
r.get('/label-templates', h(async (req, res) => {
  res.json(await many('SELECT * FROM barcode_settings ORDER BY is_default DESC, name'));
}));

r.post('/label-templates', requirePerm('products.write'), h(async (req, res) => {
  const name = str(req.body.name);
  if (!name) throw bad('Name the label template.');
  const row = await tx(async (c) => {
    if (bool(req.body.is_default)) {
      await c.query('UPDATE barcode_settings SET is_default=FALSE');
    }
    const { rows } = await c.query(
      `INSERT INTO barcode_settings
         (name, width_mm, height_mm, cols, rows, show_name, show_price, show_variant,
          show_business, barcode_type, is_default, elements_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [name, num(req.body.width_mm, 50), num(req.body.height_mm, 25),
       int(req.body.cols, 2), int(req.body.rows, 7),
       bool(req.body.show_name ?? true), bool(req.body.show_price ?? true),
       bool(req.body.show_variant ?? true), bool(req.body.show_business),
       str(req.body.barcode_type) || 'CODE128', bool(req.body.is_default),
       JSON.stringify(req.body.elements_json || [])]);
    return rows[0];
  });
  await audit(req, 'create', 'label_template', row.id, { name });
  res.status(201).json(row);
}));

r.put('/label-templates/:id(\\d+)', requirePerm('products.write'), h(async (req, res) => {
  const row = await tx(async (c) => {
    if (bool(req.body.is_default)) await c.query('UPDATE barcode_settings SET is_default=FALSE');
    const { rows } = await c.query(
      `UPDATE barcode_settings SET name=COALESCE($2,name), width_mm=COALESCE($3,width_mm),
              height_mm=COALESCE($4,height_mm), cols=COALESCE($5,cols), rows=COALESCE($6,rows),
              show_name=COALESCE($7,show_name), show_price=COALESCE($8,show_price),
              show_variant=COALESCE($9,show_variant), show_business=COALESCE($10,show_business),
              barcode_type=COALESCE($11,barcode_type), is_default=COALESCE($12,is_default),
              elements_json=COALESCE($13,elements_json)
        WHERE id=$1 RETURNING *`,
      [req.params.id, str(req.body.name) || null,
       req.body.width_mm != null ? num(req.body.width_mm, 50) : null,
       req.body.height_mm != null ? num(req.body.height_mm, 25) : null,
       req.body.cols != null ? int(req.body.cols, 2) : null,
       req.body.rows != null ? int(req.body.rows, 7) : null,
       'show_name' in req.body ? bool(req.body.show_name) : null,
       'show_price' in req.body ? bool(req.body.show_price) : null,
       'show_variant' in req.body ? bool(req.body.show_variant) : null,
       'show_business' in req.body ? bool(req.body.show_business) : null,
       str(req.body.barcode_type) || null,
       'is_default' in req.body ? bool(req.body.is_default) : null,
       req.body.elements_json != null ? JSON.stringify(req.body.elements_json) : null]);
    return rows[0];
  });
  if (!row) throw notFound('Template not found');
  res.json(row);
}));

export default r;
