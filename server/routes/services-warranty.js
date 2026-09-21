/**
 * Service types, warranty policies, and warranty registrations — the rest of
 * Phase 2's setup data and the warranty × RFID tie-in.
 */
import { Router } from 'express';
import { many, one, query } from '../db/index.js';
import { h, bad, notFound, str, num, int, bool } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const r = Router();

/* ═══════════════════ service types ═══════════════════ */
r.get('/services', h(async (req, res) => {
  res.json(await many('SELECT * FROM service_types WHERE is_active OR $1 ORDER BY name', [bool(req.query.all)]));
}));

r.post('/services', requirePerm('products.write'), h(async (req, res) => {
  const name = str(req.body.name);
  if (!name) throw bad('Name the service.');
  const type = str(req.body.charge_type) === 'percent' ? 'percent' : 'fixed';
  const row = await one(
    `INSERT INTO service_types (name, charge_type, charge_value, taxable)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, type, num(req.body.charge_value, 0), bool(req.body.taxable ?? true)]);
  await audit(req, 'create', 'service_type', row.id, { name });
  res.status(201).json(row);
}));

r.put('/services/:id(\\d+)', requirePerm('products.write'), h(async (req, res) => {
  const row = await one(
    `UPDATE service_types SET name=COALESCE($2,name), charge_type=COALESCE($3,charge_type),
            charge_value=COALESCE($4,charge_value), taxable=COALESCE($5,taxable),
            is_active=COALESCE($6,is_active) WHERE id=$1 RETURNING *`,
    [req.params.id, str(req.body.name) || null,
     str(req.body.charge_type) || null,
     req.body.charge_value != null ? num(req.body.charge_value, 0) : null,
     'taxable' in req.body ? bool(req.body.taxable) : null,
     'is_active' in req.body ? bool(req.body.is_active) : null]);
  if (!row) throw notFound('Service not found');
  res.json(row);
}));

/* ═══════════════════ warranty policies ═══════════════════ */
r.get('/warranties', h(async (req, res) => {
  res.json(await many('SELECT * FROM warranties WHERE is_active OR $1 ORDER BY name', [bool(req.query.all)]));
}));

r.post('/warranties', requirePerm('products.write'), h(async (req, res) => {
  const name = str(req.body.name);
  if (!name) throw bad('Name the warranty.');
  const unit = ['days', 'months', 'years'].includes(str(req.body.duration_unit)) ? req.body.duration_unit : 'months';
  const row = await one(
    `INSERT INTO warranties (name, description, duration, duration_unit)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, str(req.body.description), int(req.body.duration, 0), unit]);
  await audit(req, 'create', 'warranty', row.id, { name });
  res.status(201).json(row);
}));

r.put('/warranties/:id(\\d+)', requirePerm('products.write'), h(async (req, res) => {
  const row = await one(
    `UPDATE warranties SET name=COALESCE($2,name), description=COALESCE($3,description),
            duration=COALESCE($4,duration), duration_unit=COALESCE($5,duration_unit),
            is_active=COALESCE($6,is_active) WHERE id=$1 RETURNING *`,
    [req.params.id, str(req.body.name) || null, req.body.description ?? null,
     req.body.duration != null ? int(req.body.duration, 0) : null,
     str(req.body.duration_unit) || null,
     'is_active' in req.body ? bool(req.body.is_active) : null]);
  if (!row) throw notFound('Warranty not found');
  res.json(row);
}));

/* ═══════════════════ warranty lookup by tag ═══════════════════ */
/**
 * Is this tag under warranty, and until when?
 *
 * The warranty synergy: a customer brings back a shoe, you scan it, and the
 * system says whether it is still covered — checked against the exact serial,
 * not a receipt they may not have.
 */
r.get('/warranty-check/:epc', h(async (req, res) => {
  const epc = String(req.params.epc || '').trim().toUpperCase();
  const reg = await one(
    `SELECT wr.*, w.name AS warranty_name, p.name AS product_name, s.invoice_no,
            (wr.expires_at IS NULL OR wr.expires_at >= CURRENT_DATE) AS active
       FROM warranty_registrations wr
       LEFT JOIN warranties w ON w.id=wr.warranty_id
       LEFT JOIN stock_units su ON su.id=wr.unit_id
       LEFT JOIN product_variants v ON v.id=wr.variant_id
       LEFT JOIN products p ON p.id=v.product_id
       LEFT JOIN sales s ON s.id=wr.sale_id
      WHERE wr.epc=$1 ORDER BY wr.created_at DESC LIMIT 1`, [epc]);
  if (!reg) return res.json({ registered: false, epc });
  res.json({ registered: true, ...reg });
}));

export default r;
