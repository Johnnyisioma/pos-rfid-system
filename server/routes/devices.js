import { Router } from 'express';
import { many, one, query } from '../db/index.js';
import { h, bad, notFound, str, int, bool } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { buildZpl, sendToPrinter } from '../services/hardware.js';

const r = Router();

r.get('/', h(async (req, res) => {
  const rows = await many(
    `SELECT d.*, l.name AS location_name FROM devices d
       LEFT JOIN locations l ON l.id=d.location_id ORDER BY d.kind, d.name`);
  res.json(rows);
}));

r.post('/', requirePerm('devices.write'), h(async (req, res) => {
  const name = str(req.body.name).trim();
  const kind = str(req.body.kind);
  if (!name) throw bad('Device name is required');
  if (!['rfid_printer', 'rfid_reader', 'barcode_printer', 'receipt_printer'].includes(kind))
    throw bad('Unsupported device kind');
  const row = await one(
    `INSERT INTO devices (name, kind, location_id, driver, host, port, config)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name, kind, int(req.body.location_id, req.locationId) || null, str(req.body.driver, 'mock'),
     str(req.body.host) || null, int(req.body.port, 9100), JSON.stringify(req.body.config || {})]);
  await audit(req, 'create', 'device', row.id, { name, kind, driver: row.driver });
  res.status(201).json(row);
}));

r.put('/:id', requirePerm('devices.write'), h(async (req, res) => {
  const row = await one(
    `UPDATE devices SET name=COALESCE($2,name), driver=COALESCE($3,driver), host=$4,
            port=COALESCE($5,port), location_id=$6, config=COALESCE($7,config),
            is_active=COALESCE($8,is_active) WHERE id=$1 RETURNING *`,
    [req.params.id, req.body.name ?? null, req.body.driver ?? null, str(req.body.host) || null,
     req.body.port ?? null, req.body.location_id ?? null,
     req.body.config ? JSON.stringify(req.body.config) : null,
     'is_active' in req.body ? bool(req.body.is_active) : null]);
  if (!row) throw notFound('Device not found');
  await audit(req, 'update', 'device', row.id, {});
  res.json(row);
}));

r.delete('/:id', requirePerm('devices.write'), h(async (req, res) => {
  await query('DELETE FROM devices WHERE id=$1', [req.params.id]);
  await audit(req, 'delete', 'device', req.params.id);
  res.json({ ok: true });
}));

/** Send a test label — proves connectivity before real stock is tagged. */
r.post('/:id/test', requirePerm('devices.write'), h(async (req, res) => {
  const device = await one('SELECT * FROM devices WHERE id=$1', [req.params.id]);
  if (!device) throw notFound('Device not found');
  const zpl = buildZpl({
    epc: '3035000000000000000000FF',
    readable: 'TEST-LABEL-0001',
    productName: 'Test label',
    variantLabel: device.name,
    sku: 'TEST',
    price: '0',
    currency: '',
  });
  try {
    const outcome = await sendToPrinter(device, zpl);
    await query('UPDATE devices SET last_used_at=now() WHERE id=$1', [device.id]);
    await query(
      `INSERT INTO print_jobs (device_id, epc, payload, status, user_id) VALUES ($1,$2,$3,$4,$5)`,
      [device.id, '3035000000000000000000FF', zpl, outcome.status, req.user.id]);
    res.json({ ok: true, ...outcome, zpl });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message, zpl });
  }
}));

r.get('/print-jobs', h(async (req, res) => {
  const rows = await many(
    `SELECT pj.id, pj.status, pj.epc, pj.error, pj.created_at, d.name AS device_name,
            su.epc_readable, p.name AS product_name, u.name AS user_name
       FROM print_jobs pj
       LEFT JOIN devices d ON d.id=pj.device_id
       LEFT JOIN stock_units su ON su.id=pj.unit_id
       LEFT JOIN product_variants v ON v.id=su.variant_id
       LEFT JOIN products p ON p.id=v.product_id
       LEFT JOIN users u ON u.id=pj.user_id
      ORDER BY pj.id DESC LIMIT 100`);
  res.json(rows);
}));

export default r;
