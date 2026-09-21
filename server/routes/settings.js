import { Router } from 'express';
import { one, many, query } from '../db/index.js';
import { h, bad, str, int, getSettings } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { FEATURES, featureDefaults } from '../lib/permissions.js';

const r = Router();

/**
 * Which parts of the system this shop uses.
 *
 * A row per key, optionally per location, over a set of defaults. A shop with
 * one branch has no use for transfers and should not be looking at a Transfers
 * menu every day; a shop that does not sell on credit should not have a credit
 * button at the till waiting to be pressed by mistake.
 */
async function loadFeatures(locationId) {
  const flags = featureDefaults();
  const rows = await many(
    `SELECT key, enabled, location_id FROM feature_flags
      WHERE location_id IS NULL OR location_id=$1
      ORDER BY location_id NULLS FIRST`, [locationId || null]);
  // Global rows first, then the location's own, so a branch override wins.
  for (const row of rows) flags[row.key] = row.enabled;
  return flags;
}

r.get('/', h(async (req, res) => {
  const settings = await getSettings();
  res.json({ ...settings, features: await loadFeatures(req.locationId) });
}));

r.get('/features', h(async (req, res) => {
  res.json({
    catalog: FEATURES,
    values: await loadFeatures(req.locationId),
    location_id: req.locationId,
  });
}));

/**
 * Turn a feature on or off, for the whole business or for one branch.
 *
 * Writing NULL location_id is the business-wide setting; a location id is the
 * exception for that branch.
 */
r.put('/features', requirePerm('settings.write'), h(async (req, res) => {
  const values = req.body.values && typeof req.body.values === 'object' ? req.body.values : null;
  if (!values) throw bad('Send a { values: { key: true|false } } object.');
  const scope = req.body.scope === 'location' ? int(req.body.location_id, req.locationId) : null;

  const known = new Set(FEATURES.map((f) => f.key));
  for (const [key, enabled] of Object.entries(values)) {
    if (!known.has(key)) throw bad(`"${key}" is not a feature this system has.`);
    await query(
      `INSERT INTO feature_flags (key, enabled, location_id, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (key, COALESCE(location_id, 0)) DO UPDATE
         SET enabled=EXCLUDED.enabled, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [key, Boolean(enabled), scope, req.user.id]);
  }
  await audit(req, 'update', 'feature_flags', 1, { keys: Object.keys(values), scope });
  res.json({ values: await loadFeatures(req.locationId) });
}));

const EDITABLE = [
  'name', 'legal_name', 'tin', 'rc_number', 'address', 'phone', 'email',
  'currency', 'currency_symbol', 'vat_rate', 'prices_include_vat',
  'invoice_prefix', 'sku_prefix', 'epc_company_prefix', 'receipt_footer',
  'logo_url', 'loyalty_earn_per', 'loyalty_point_value', 'loyalty_enabled',
  'low_stock_default', 'fiscal_country', 'einvoice_scheme',
  'receipt_font_size', 'receipt_paper', 'receipt_show_logo', 'logo_width_mm',
  'sale_edit_window_days',
  // V5
  'rfid_region', 'rfid_power', 'whatsapp_number', 'public_base_url',
  // V6
  'enable_price_groups', 'enable_warranty', 'enable_sub_units', 'default_unit_id',
];

r.put('/', requirePerm('settings.write'), h(async (req, res) => {
  const sets = [];
  const vals = [];
  for (const key of EDITABLE) {
    if (key in req.body) {
      vals.push(req.body[key]);
      sets.push(`${key}=$${vals.length}`);
    }
  }
  if (!sets.length) return res.json({ ...(await getSettings()), features: await loadFeatures(req.locationId) });
  await query(`UPDATE business_settings SET ${sets.join(', ')}, updated_at=now() WHERE id=1`, vals);
  await audit(req, 'update', 'settings', 1, { fields: Object.keys(req.body) });
  res.json({ ...(await getSettings()), features: await loadFeatures(req.locationId) });
}));

/**
 * The business type — footwear/boutique, restaurant, pharmacy, and so on.
 *
 * Behind its own permission because it is the one setting that reshapes the
 * whole app: switching to 'restaurant' turns on tables and a kitchen screen,
 * and a shop should not flip that by accident from the general settings form.
 */
r.get('/business-type', h(async (req, res) => {
  const s = await getSettings();
  res.json({
    business_type: s.business_type || 'retail',
    types: [
      { key: 'retail',      label: 'Retail / Boutique / Footwear', note: 'Products with sizes and colours' },
      { key: 'supermarket', label: 'Supermarket / Grocery',        note: 'High volume, barcodes, units' },
      { key: 'pharmacy',    label: 'Pharmacy',                     note: 'Batch and expiry tracking' },
      { key: 'restaurant',  label: 'Restaurant / Kitchen',         note: 'Tables, kitchen orders, bookings' },
      { key: 'service',     label: 'Service business',             note: 'Bookings and service items' },
    ],
  });
}));

r.put('/business-type', requirePerm('settings.business_type'), h(async (req, res) => {
  const type = str(req.body.business_type);
  const allowed = ['retail', 'supermarket', 'pharmacy', 'restaurant', 'service'];
  if (!allowed.includes(type)) throw bad(`Business type must be one of: ${allowed.join(', ')}`);
  await query('UPDATE business_settings SET business_type=$1, updated_at=now() WHERE id=1', [type]);

  // Turn the restaurant feature family on or off to match, so the menu follows
  // the type without a second trip to the Features screen.
  const restaurant = type === 'restaurant';
  for (const key of ['tables', 'kitchen', 'bookings']) {
    await query(
      `INSERT INTO feature_flags (key, enabled, updated_by, updated_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (key, COALESCE(location_id, 0))
       DO UPDATE SET enabled=EXCLUDED.enabled, updated_at=now()`,
      [key, restaurant, req.user.id]);
  }
  await audit(req, 'set_business_type', 'settings', 1, { business_type: type });
  res.json({ ...(await getSettings()), features: await loadFeatures(req.locationId) });
}));

export default r;
