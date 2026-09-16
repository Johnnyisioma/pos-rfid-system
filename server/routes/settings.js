import { Router } from 'express';
import { one, query } from '../db/index.js';
import { h, getSettings } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const r = Router();

r.get('/', h(async (req, res) => res.json(await getSettings())));

const EDITABLE = [
  'name', 'legal_name', 'tin', 'rc_number', 'address', 'phone', 'email',
  'currency', 'currency_symbol', 'vat_rate', 'prices_include_vat',
  'invoice_prefix', 'sku_prefix', 'epc_company_prefix', 'receipt_footer',
  'logo_url', 'loyalty_earn_per', 'loyalty_point_value', 'loyalty_enabled',
  'low_stock_default', 'fiscal_country', 'einvoice_scheme',
  'receipt_font_size', 'receipt_paper', 'receipt_show_logo', 'logo_width_mm',
  'sale_edit_window_days',
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
  if (!sets.length) return res.json(await getSettings());
  await query(`UPDATE business_settings SET ${sets.join(', ')}, updated_at=now() WHERE id=1`, vals);
  await audit(req, 'update', 'settings', 1, { fields: Object.keys(req.body) });
  res.json(await getSettings());
}));

export default r;
