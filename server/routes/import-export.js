/**
 * Bulk product import / export (CSV + Excel), including variants.
 * - GET  /api/io/products/template   -> downloadable template (xlsx or csv)
 * - POST /api/io/products/validate   -> dry run, returns row-level errors
 * - POST /api/io/products/import     -> commits (all-or-nothing per file)
 * - GET  /api/io/products/export     -> full catalog incl. variants + stock
 */
import { Router } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { many, one, tx } from '../db/index.js';
import { h, bad, str, num, int, getSettings } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { generateProductSku, generateVariantSku } from './products.js';
import { receiveUnits } from '../services/inventory.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
const r = Router();

const COLUMNS = [
  'product_name', 'product_sku', 'type', 'brand', 'category', 'sub_category', 'unit',
  'description', 'tax_rate', 'reorder_point', 'track_rfid',
  'variant_sku', 'size', 'color', 'barcode', 'cost_price', 'selling_price',
  'opening_stock', 'location_code',
];

const SAMPLE = [
  {
    product_name: 'Classic Oxford Leather Shoe', product_sku: 'SKU-OXFORD', type: 'variable',
    brand: 'Marconi', category: 'Footwear', sub_category: 'Formal', unit: 'pair',
    description: 'Full-grain leather oxford', tax_rate: 7.5, reorder_point: 3, track_rfid: 'yes',
    variant_sku: '', size: '42', color: 'Black', barcode: '',
    cost_price: 21000, selling_price: 34500, opening_stock: 4, location_code: 'LAG',
  },
  {
    product_name: 'Classic Oxford Leather Shoe', product_sku: 'SKU-OXFORD', type: 'variable',
    brand: 'Marconi', category: 'Footwear', sub_category: 'Formal', unit: 'pair',
    description: '', tax_rate: 7.5, reorder_point: 3, track_rfid: 'yes',
    variant_sku: '', size: '43', color: 'Brown', barcode: '',
    cost_price: 21000, selling_price: 34500, opening_stock: 2, location_code: 'LAG',
  },
];

function sheetToRows(buffer, filename = '') {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw bad('The uploaded file has no sheets');
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

function normKey(k) {
  return String(k).trim().toLowerCase().replace(/[\s\-]+/g, '_');
}

function normalizeRow(raw) {
  const out = {};
  // every known column exists, so a missing column reads as blank rather than undefined
  for (const col of COLUMNS) out[col] = '';
  for (const [k, v] of Object.entries(raw)) {
    const key = normKey(k);
    out[key] = typeof v === 'string' ? v.trim() : (v ?? '');
  }
  // tolerate a few common alternative headings
  out.product_name = out.product_name || out.name || out.product || '';
  out.product_sku = out.product_sku || out.sku || '';
  out.selling_price = out.selling_price ?? out.price ?? out.retail_price ?? '';
  out.cost_price = out.cost_price ?? out.cost ?? out.purchase_price ?? '';
  out.opening_stock = out.opening_stock ?? out.stock ?? out.quantity ?? out.qty ?? '';
  return out;
}

const yes = (v) => ['yes', 'y', 'true', '1'].includes(String(v).trim().toLowerCase());

/** Parse + validate without touching the database. */
async function analyse(rows, locations, settings) {
  const errors = [];
  const groups = new Map();   // key -> product draft
  const codes = new Set(locations.map((l) => l.code));

  rows.forEach((raw, idx) => {
    const rowNo = idx + 2; // +1 for header, +1 for 1-based
    const row = normalizeRow(raw);
    const name = str(row.product_name);
    if (!name) { errors.push({ row: rowNo, field: 'product_name', message: 'Product name is required' }); return; }

    const sp = row.selling_price === '' ? null : Number(row.selling_price);
    if (sp === null || !Number.isFinite(sp) || sp < 0)
      errors.push({ row: rowNo, field: 'selling_price', message: 'Selling price must be a number ≥ 0' });
    const cp = row.cost_price === '' ? 0 : Number(row.cost_price);
    if (!Number.isFinite(cp) || cp < 0)
      errors.push({ row: rowNo, field: 'cost_price', message: 'Cost price must be a number ≥ 0' });

    const stock = row.opening_stock === '' ? 0 : Number(row.opening_stock);
    if (!Number.isFinite(stock) || stock < 0 || !Number.isInteger(stock))
      errors.push({ row: rowNo, field: 'opening_stock', message: 'Opening stock must be a whole number ≥ 0' });

    const locCode = str(row.location_code).toUpperCase();
    if (locCode && !codes.has(locCode))
      errors.push({ row: rowNo, field: 'location_code', message: `Unknown location code "${locCode}". Known: ${[...codes].join(', ')}` });

    const type = str(row.type).toLowerCase() || (row.size || row.color ? 'variable' : 'single');
    if (!['single', 'variable', 'bundle'].includes(type))
      errors.push({ row: rowNo, field: 'type', message: 'Type must be single, variable or bundle' });

    const taxRate = row.tax_rate === '' ? Number(settings.vat_rate) : Number(row.tax_rate);
    if (!Number.isFinite(taxRate)) errors.push({ row: rowNo, field: 'tax_rate', message: 'Tax rate must be a number' });

    const key = (str(row.product_sku).toUpperCase() || `NAME:${name.toLowerCase()}`);
    if (!groups.has(key)) {
      groups.set(key, {
        key, rowNo, name, sku: str(row.product_sku).toUpperCase(), type,
        brand: str(row.brand), category: str(row.category), sub_category: str(row.sub_category),
        unit: str(row.unit) || 'pair', description: str(row.description),
        tax_rate: Number.isFinite(taxRate) ? taxRate : Number(settings.vat_rate),
        reorder_point: row.reorder_point === '' ? settings.low_stock_default : int(row.reorder_point, settings.low_stock_default),
        track_rfid: row.track_rfid === '' ? true : yes(row.track_rfid),
        variants: [],
      });
    }
    const g = groups.get(key);
    const dupe = g.variants.find(
      (v) => (v.size || '') === str(row.size) && (v.color || '') === str(row.color)
    );
    if (dupe) {
      errors.push({ row: rowNo, field: 'size/color',
        message: `Duplicate variant ${str(row.size)}/${str(row.color)} for "${name}" (also on row ${dupe.rowNo})` });
      return;
    }
    g.variants.push({
      rowNo,
      sku: str(row.variant_sku).toUpperCase(),
      size: str(row.size) || null,
      color: str(row.color) || null,
      barcode: str(row.barcode) || null,
      cost_price: Number.isFinite(cp) ? cp : 0,
      selling_price: Number.isFinite(sp) ? sp : 0,
      opening_stock: Number.isFinite(stock) ? Math.floor(stock) : 0,
      location_code: locCode,
    });
  });

  const products = [...groups.values()];
  const existing = new Map();
  for (const p of products) {
    if (p.sku) {
      const found = await one('SELECT id, name FROM products WHERE sku=$1', [p.sku]);
      if (found) existing.set(p.key, found);
    }
  }
  return {
    errors,
    products,
    summary: {
      rows: rows.length,
      products: products.length,
      variants: products.reduce((n, p) => n + p.variants.length, 0),
      units_to_create: products.reduce((n, p) => n + p.variants.reduce((m, v) => m + v.opening_stock, 0), 0),
      new_products: products.length - existing.size,
      updated_products: existing.size,
    },
    existing: Object.fromEntries(existing),
  };
}

r.get('/products/template', h(async (req, res) => {
  const format = str(req.query.format, 'xlsx');
  const ws = XLSX.utils.json_to_sheet(SAMPLE, { header: COLUMNS });
  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="product-import-template.csv"');
    return res.send(csv);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  const help = XLSX.utils.aoa_to_sheet([
    ['Column', 'Required', 'Notes'],
    ['product_name', 'yes', 'Rows sharing the same product_sku (or the same name when sku is blank) become ONE product with several variants.'],
    ['product_sku', 'no', 'Leave blank to auto-generate. Reusing an existing SKU updates that product and adds/updates its variants.'],
    ['type', 'no', 'single | variable | bundle. Defaults to variable when size or color is filled.'],
    ['brand / category / sub_category', 'no', 'Created automatically if they do not exist yet.'],
    ['tax_rate', 'no', 'Percent. Defaults to the business VAT rate.'],
    ['track_rfid', 'no', 'yes/no. When yes, a unique RFID EPC is generated for every physical unit.'],
    ['variant_sku', 'no', 'Leave blank to auto-generate as PRODUCTSKU-SIZE-COLOR.'],
    ['size / color', 'no', 'Leave both blank for a single (non-variable) product.'],
    ['cost_price / selling_price', 'selling_price yes', 'Numbers only, no currency symbols or thousands separators.'],
    ['opening_stock', 'no', 'Whole number. Creates that many physical units, each with its own EPC.'],
    ['location_code', 'no', 'Which shop the opening stock lands in. Defaults to your current location.'],
  ]);
  XLSX.utils.book_append_sheet(wb, help, 'How to use');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="product-import-template.xlsx"');
  res.send(buf);
}));

r.post('/products/validate', requirePerm('products.write'), upload.single('file'), h(async (req, res) => {
  if (!req.file) throw bad('No file uploaded');
  const rows = sheetToRows(req.file.buffer, req.file.originalname);
  if (!rows.length) throw bad('The file has no data rows');
  const [locations, settings] = await Promise.all([
    many('SELECT id, code, name FROM locations'), getSettings(),
  ]);
  const result = await analyse(rows, locations, settings);
  res.json({
    ok: result.errors.length === 0,
    errors: result.errors.slice(0, 200),
    error_count: result.errors.length,
    summary: result.summary,
    preview: result.products.slice(0, 20).map((p) => ({
      name: p.name, sku: p.sku || '(auto)', type: p.type, variants: p.variants.length,
      opening_units: p.variants.reduce((n, v) => n + v.opening_stock, 0),
    })),
  });
}));

r.post('/products/import', requirePerm('products.write'), upload.single('file'), h(async (req, res) => {
  if (!req.file) throw bad('No file uploaded');
  const rows = sheetToRows(req.file.buffer, req.file.originalname);
  if (!rows.length) throw bad('The file has no data rows');
  const [locations, settings] = await Promise.all([
    many('SELECT id, code, name FROM locations'), getSettings(),
  ]);
  const analysis = await analyse(rows, locations, settings);
  if (analysis.errors.length) {
    return res.status(422).json({
      ok: false, imported: 0,
      error_count: analysis.errors.length,
      errors: analysis.errors.slice(0, 200),
      message: 'Nothing was imported — fix the rows listed and upload again.',
    });
  }

  const locByCode = new Map(locations.map((l) => [l.code, l.id]));
  const created = { products: 0, updated: 0, variants: 0, units: 0 };

  await tx(async (c) => {
    const findOrCreate = async (table, name, extra = {}) => {
      if (!name) return null;
      if (table === 'brands') {
        const { rows: br } = await c.query(
          'INSERT INTO brands (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id', [name]);
        return br[0].id;
      }
      const parent = extra.parent_id ?? null;
      const found = await c.query(
        'SELECT id FROM categories WHERE name=$1 AND parent_id IS NOT DISTINCT FROM $2', [name, parent]);
      if (found.rows.length) return found.rows[0].id;
      const ins = await c.query('INSERT INTO categories (name,parent_id) VALUES ($1,$2) RETURNING id', [name, parent]);
      return ins.rows[0].id;
    };

    for (const p of analysis.products) {
      const brandId = await findOrCreate('brands', p.brand);
      const catId = await findOrCreate('categories', p.category);
      const subId = p.sub_category ? await findOrCreate('categories', p.sub_category, { parent_id: catId }) : null;

      let productId;
      const existing = p.sku ? (await c.query('SELECT id FROM products WHERE sku=$1', [p.sku])).rows[0] : null;
      if (existing) {
        productId = existing.id;
        await c.query(
          `UPDATE products SET name=$2,type=$3,brand_id=$4,category_id=$5,sub_category_id=$6,unit=$7,
                  description=CASE WHEN $8='' THEN description ELSE $8 END,
                  tax_rate=$9,reorder_point=$10,track_rfid=$11,updated_at=now()
            WHERE id=$1`,
          [productId, p.name, p.type, brandId, catId, subId, p.unit, p.description,
           p.tax_rate, p.reorder_point, p.track_rfid]
        );
        created.updated += 1;
      } else {
        const sku = p.sku || await generateProductSku(c, p.name, settings.sku_prefix);
        const ins = await c.query(
          `INSERT INTO products (name,sku,type,brand_id,category_id,sub_category_id,unit,description,
                                 tax_rate,reorder_point,track_rfid,created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, sku`,
          [p.name, sku, p.type, brandId, catId, subId, p.unit, p.description,
           p.tax_rate, p.reorder_point, p.track_rfid, req.user.id]
        );
        productId = ins.rows[0].id;
        p.sku = ins.rows[0].sku;
        created.products += 1;
      }

      const prodSku = p.sku || (await c.query('SELECT sku FROM products WHERE id=$1', [productId])).rows[0].sku;

      for (const v of p.variants) {
        let variantId;
        const bySku = v.sku ? (await c.query('SELECT id FROM product_variants WHERE sku=$1', [v.sku])).rows[0] : null;
        const byAttrs = bySku ? null : (await c.query(
          `SELECT id FROM product_variants
            WHERE product_id=$1 AND size IS NOT DISTINCT FROM $2 AND color IS NOT DISTINCT FROM $3`,
          [productId, v.size, v.color])).rows[0];
        const found = bySku || byAttrs;
        if (found) {
          variantId = found.id;
          await c.query(
            `UPDATE product_variants SET size=$2,color=$3,cost_price=$4,selling_price=$5,
                    barcode=COALESCE($6,barcode), is_active=TRUE WHERE id=$1`,
            [variantId, v.size, v.color, v.cost_price, v.selling_price, v.barcode]);
        } else {
          const vsku = v.sku || await generateVariantSku(c, prodSku, v.size, v.color);
          const ins = await c.query(
            `INSERT INTO product_variants (product_id,sku,barcode,size,color,cost_price,selling_price,reorder_point)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [productId, vsku, v.barcode, v.size, v.color, v.cost_price, v.selling_price, p.reorder_point]);
          variantId = ins.rows[0].id;
          created.variants += 1;
        }

        if (v.opening_stock > 0) {
          const locId = locByCode.get(v.location_code) || req.locationId || locations[0]?.id;
          const units = await receiveUnits(c, {
            variantId, locationId: locId, quantity: v.opening_stock,
            costPrice: v.cost_price, companyPrefix: settings.epc_company_prefix,
            referenceType: 'import', sourceRef: req.file.originalname,
            userId: req.user.id, type: 'opening', reason: 'Bulk import opening stock',
          });
          created.units += units.length;
        }
      }
    }
  });

  await audit(req, 'import', 'product', null, { file: req.file.originalname, ...created });
  res.json({ ok: true, ...created, summary: analysis.summary });
}));

r.get('/products/export', h(async (req, res) => {
  const format = str(req.query.format, 'xlsx');
  const locations = await many('SELECT * FROM locations ORDER BY name');
  const variants = await many(
    `SELECT p.name AS product_name, p.sku AS product_sku, p.type, b.name AS brand,
            c.name AS category, sc.name AS sub_category, p.unit, p.description,
            p.tax_rate, p.reorder_point, CASE WHEN p.track_rfid THEN 'yes' ELSE 'no' END AS track_rfid,
            v.id AS variant_id, v.sku AS variant_sku, v.size, v.color, v.barcode,
            v.cost_price, v.selling_price,
            CASE WHEN p.is_active AND v.is_active THEN 'active' ELSE 'inactive' END AS status
       FROM product_variants v
       JOIN products p ON p.id=v.product_id
       LEFT JOIN brands b ON b.id=p.brand_id
       LEFT JOIN categories c ON c.id=p.category_id
       LEFT JOIN categories sc ON sc.id=p.sub_category_id
      ORDER BY p.name, v.size, v.color`
  );
  const stock = await many(
    `SELECT i.variant_id, l.code, i.quantity FROM inventory i JOIN locations l ON l.id=i.location_id`);
  const stockMap = new Map();
  stock.forEach((s) => {
    if (!stockMap.has(s.variant_id)) stockMap.set(s.variant_id, {});
    stockMap.get(s.variant_id)[s.code] = Number(s.quantity);
  });

  const rows = variants.map((v) => {
    const perLoc = stockMap.get(v.variant_id) || {};
    const out = { ...v };
    delete out.variant_id;
    let total = 0;
    for (const l of locations) {
      const q = perLoc[l.code] || 0;
      out[`stock_${l.code}`] = q;
      total += q;
    }
    out.stock_total = total;
    out.stock_value_cost = Math.round(total * Number(v.cost_price) * 100) / 100;
    return out;
  });

  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    const ws = XLSX.utils.json_to_sheet(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="product-catalog-${stamp}.csv"`);
    return res.send(XLSX.utils.sheet_to_csv(ws));
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Catalog');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="product-catalog-${stamp}.xlsx"`);
  res.send(buf);
}));

export default r;
