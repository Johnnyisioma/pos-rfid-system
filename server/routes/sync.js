/**
 * Offline sync endpoint.
 *
 * The PWA queues sales made while offline in IndexedDB and replays them here
 * when the connection returns. `client_uuid` makes every replay idempotent, so
 * a retry can never double-post a sale.
 */
import { Router } from 'express';
import { many, one, tx } from '../db/index.js';
import { h, getSettings } from '../lib/util.js';
import { audit } from '../lib/audit.js';
import { createSale, loadSale } from './sales.js';

const r = Router();

r.post('/sales', h(async (req, res) => {
  const queue = Array.isArray(req.body.sales) ? req.body.sales : [];
  const settings = await getSettings();
  const results = [];

  for (const item of queue) {
    const uuid = String(item.client_uuid || '');
    try {
      if (uuid) {
        const existing = await one('SELECT id, invoice_no FROM sales WHERE client_uuid=$1', [uuid]);
        if (existing) {
          results.push({ client_uuid: uuid, status: 'duplicate', sale_id: existing.id, invoice_no: existing.invoice_no });
          continue;
        }
      }
      const sale = await tx((c) =>
        createSale(c, item, {
          user: req.user,
          locationId: Number(item.location_id) || req.locationId,
          settings,
        }));
      results.push({ client_uuid: uuid, status: 'synced', sale_id: sale.id, invoice_no: sale.invoice_no });
    } catch (err) {
      results.push({ client_uuid: uuid, status: 'failed', error: err.message });
    }
  }

  const synced = results.filter((x) => x.status === 'synced').length;
  if (synced) await audit(req, 'sync', 'sale', null, { synced, queued: queue.length });
  res.json({
    ok: true,
    synced,
    duplicates: results.filter((x) => x.status === 'duplicate').length,
    failed: results.filter((x) => x.status === 'failed').length,
    results,
  });
}));

/**
 * Snapshot the client caches so the till can keep selling with no network:
 * catalog, prices, stock and customers for one location.
 */
r.get('/snapshot', h(async (req, res) => {
  const locationId = req.locationId;
  const [settings, variants, customers, locations, registers] = await Promise.all([
    getSettings(),
    many(
      `SELECT v.id AS variant_id, v.sku, v.barcode, v.size, v.color, v.cost_price,
              COALESCE(lp.selling_price, v.selling_price) AS price,
              p.id AS product_id, p.name, p.type, p.tax_rate, p.image_url, p.unit,
              COALESCE(i.quantity,0) AS stock
         FROM product_variants v
         JOIN products p ON p.id=v.product_id
         LEFT JOIN inventory i ON i.variant_id=v.id AND i.location_id=$1
         LEFT JOIN location_prices lp ON lp.variant_id=v.id AND lp.location_id=$1
        WHERE p.is_active AND v.is_active
        ORDER BY p.name, v.size, v.color`, [locationId]),
    many(
      `SELECT c.id, c.name, c.phone, c.email, c.loyalty_points, c.store_credit, c.balance,
              c.credit_limit, g.discount_percent
         FROM customers c LEFT JOIN customer_groups g ON g.id=c.group_id
        WHERE c.is_active ORDER BY c.name LIMIT 5000`),
    many('SELECT id, name, code FROM locations WHERE is_active ORDER BY name'),
    many('SELECT id, name FROM registers WHERE location_id=$1 AND is_active', [locationId]),
  ]);
  res.json({
    generated_at: new Date().toISOString(),
    location_id: locationId,
    settings, variants, customers, locations, registers,
  });
}));

export default r;
