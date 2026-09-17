import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, num, int, bool, paging, getSettings, variantLabel } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const r = Router();

/* ---------------- SKU generation ---------------- */
export function slugPart(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8);
}

export async function generateProductSku(client, name, prefix) {
  const base = slugPart(name).slice(0, 6) || 'PRD';
  for (let i = 0; i < 500; i++) {
    const candidate = i === 0 ? `${prefix}-${base}` : `${prefix}-${base}${i}`;
    const { rows } = await client.query('SELECT 1 FROM products WHERE sku=$1', [candidate]);
    if (!rows.length) return candidate;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

export async function generateVariantSku(client, productSku, size, color) {
  const suffix = [slugPart(size), slugPart(color)].filter(Boolean).join('-');
  const base = suffix ? `${productSku}-${suffix}` : productSku;
  for (let i = 0; i < 500; i++) {
    const candidate = i === 0 ? base : `${base}-${i}`;
    const { rows } = await client.query('SELECT 1 FROM product_variants WHERE sku=$1', [candidate]);
    if (!rows.length) return candidate;
  }
  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}

/* ---------------- list ---------------- */
r.get('/', h(async (req, res) => {
  const { limit, offset, page } = paging(req, 50);
  const locationId = req.locationId;
  const where = ['TRUE'];
  const params = [locationId];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };

  if (req.query.q) add(`(p.name ILIKE ? OR p.sku ILIKE ? OR EXISTS (
      SELECT 1 FROM product_variants v2 WHERE v2.product_id=p.id AND (v2.sku ILIKE ? OR v2.barcode ILIKE ?)))`,
      `%${req.query.q}%`);
  if (req.query.category_id) add('(p.category_id = ? OR p.sub_category_id = ?)', int(req.query.category_id));
  if (req.query.brand_id) add('p.brand_id = ?', int(req.query.brand_id));
  if (req.query.type) add('p.type = ?', str(req.query.type));
  if (req.query.active === 'true') where.push('p.is_active');
  if (req.query.active === 'false') where.push('NOT p.is_active');

  const sql = `
    WITH stock AS (
      SELECT v.product_id, SUM(COALESCE(i.quantity,0)) AS qty
        FROM product_variants v
        LEFT JOIN inventory i ON i.variant_id=v.id AND i.location_id=$1
       GROUP BY v.product_id
    )
    SELECT p.*, b.name AS brand_name, c.name AS category_name, sc.name AS sub_category_name,
           COALESCE(s.qty,0) AS stock,
           (SELECT COUNT(*) FROM product_variants v WHERE v.product_id=p.id) AS variant_count,
           (SELECT MIN(selling_price) FROM product_variants v WHERE v.product_id=p.id) AS min_price,
           (SELECT MAX(selling_price) FROM product_variants v WHERE v.product_id=p.id) AS max_price
      FROM products p
      LEFT JOIN brands b ON b.id=p.brand_id
      LEFT JOIN categories c ON c.id=p.category_id
      LEFT JOIN categories sc ON sc.id=p.sub_category_id
      LEFT JOIN stock s ON s.product_id=p.id
     WHERE ${where.join(' AND ')}
     ORDER BY p.name
     LIMIT ${limit} OFFSET ${offset}`;
  const rows = await many(sql, params);
  const totalRow = await one(
    `SELECT COUNT(*)::int AS n FROM products p
       LEFT JOIN brands b ON b.id=p.brand_id
      WHERE ($1::int IS NOT NULL OR TRUE) AND ${where.join(' AND ')}`, params);
  res.json({ data: rows, page, limit, total: totalRow.n });
}));

/* ---------------- search for POS (variant level) ---------------- */
r.get('/search', h(async (req, res) => {
  const q = str(req.query.q).trim();
  const locationId = req.locationId;
  if (!q) return res.json([]);
  const rows = await many(
    `SELECT v.id AS variant_id, v.sku, v.barcode, v.size, v.color,
            COALESCE(lp.selling_price, v.selling_price) AS price,
            v.cost_price, p.id AS product_id, p.name, p.type, p.tax_rate, p.image_url, p.unit,
            COALESCE(i.quantity,0) AS stock
       FROM product_variants v
       JOIN products p ON p.id=v.product_id
       LEFT JOIN inventory i ON i.variant_id=v.id AND i.location_id=$2
       LEFT JOIN location_prices lp ON lp.variant_id=v.id AND lp.location_id=$2
      WHERE p.is_active AND v.is_active
        AND (p.name ILIKE $1 OR v.sku ILIKE $1 OR p.sku ILIKE $1 OR v.barcode = $3)
      ORDER BY (COALESCE(i.quantity,0) > 0) DESC, p.name, v.size, v.color
      LIMIT 40`,
    [`%${q}%`, locationId, q]
  );
  res.json(rows);
}));

/* ---------------- single ---------------- */
async function loadProduct(id, locationId) {
  const product = await one(
    `SELECT p.*, b.name AS brand_name, c.name AS category_name, sc.name AS sub_category_name,
            tr.name AS tax_rate_name
       FROM products p
       LEFT JOIN brands b ON b.id=p.brand_id
       LEFT JOIN categories c ON c.id=p.category_id
       LEFT JOIN categories sc ON sc.id=p.sub_category_id
       LEFT JOIN tax_rates tr ON tr.id=p.tax_rate_id
      WHERE p.id=$1`, [id]);
  if (!product) return null;
  product.variants = await many(
    `SELECT v.*, COALESCE(i.quantity,0) AS stock,
            lp.selling_price AS location_price,
            (SELECT COUNT(*) FROM stock_units su WHERE su.variant_id=v.id AND su.status='in_stock'
               AND su.location_id=$2) AS units_in_stock
       FROM product_variants v
       LEFT JOIN inventory i ON i.variant_id=v.id AND i.location_id=$2
       LEFT JOIN location_prices lp ON lp.variant_id=v.id AND lp.location_id=$2
      WHERE v.product_id=$1
      ORDER BY v.size NULLS FIRST, v.color NULLS FIRST, v.id`,
    [id, locationId]
  );
  if (product.type === 'bundle') {
    product.bundle_items = await many(
      `SELECT bi.*, v.sku, v.size, v.color, p.name AS product_name
         FROM bundle_items bi
         JOIN product_variants v ON v.id=bi.component_variant_id
         JOIN products p ON p.id=v.product_id
        WHERE bi.bundle_variant_id IN (SELECT id FROM product_variants WHERE product_id=$1)`,
      [id]
    );
  }
  return product;
}

r.get('/:id', h(async (req, res) => {
  const product = await loadProduct(req.params.id, req.locationId);
  if (!product) throw notFound('Product not found');
  res.json(product);
}));

/* ---------------- create ---------------- */
r.post('/', requirePerm('products.write'), h(async (req, res) => {
  const settings = await getSettings();
  const body = req.body || {};
  const name = str(body.name).trim();
  if (!name) throw bad('Product name is required');
  const type = ['single', 'variable', 'bundle'].includes(body.type) ? body.type : 'single';

  const product = await tx(async (c) => {
    let sku = str(body.sku).trim().toUpperCase();
    if (!sku) sku = await generateProductSku(c, name, settings.sku_prefix);
    else if ((await c.query('SELECT 1 FROM products WHERE sku=$1', [sku])).rows.length)
      throw bad(`SKU "${sku}" already exists`);

    const { rows } = await c.query(
      `INSERT INTO products (name,sku,type,brand_id,category_id,sub_category_id,unit,description,
                             image_url,tax_rate,reorder_point,track_rfid,is_active,created_by,tax_rate_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [name, sku, type, body.brand_id || null, body.category_id || null, body.sub_category_id || null,
       str(body.unit, 'pair'), str(body.description), str(body.image_url),
       num(body.tax_rate, settings.vat_rate), int(body.reorder_point, settings.low_stock_default),
       body.track_rfid === undefined ? true : bool(body.track_rfid),
       body.is_active === undefined ? true : bool(body.is_active), req.user.id,
       int(body.tax_rate_id) || null]
    );
    const p = rows[0];

    const incoming = Array.isArray(body.variants) && body.variants.length
      ? body.variants
      : [{ size: null, color: null, cost_price: body.cost_price, selling_price: body.selling_price, barcode: body.barcode }];

    for (const v of incoming) {
      const vsku = str(v.sku).trim().toUpperCase() || await generateVariantSku(c, sku, v.size, v.color);
      await c.query(
        `INSERT INTO product_variants (product_id,sku,barcode,size,color,cost_price,selling_price,reorder_point,is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [p.id, vsku, str(v.barcode) || null, v.size || null, v.color || null,
         num(v.cost_price, 0), num(v.selling_price, 0),
         v.reorder_point == null ? null : int(v.reorder_point), v.is_active === false ? false : true]
      );
    }

    if (type === 'bundle' && Array.isArray(body.bundle_items)) {
      const bv = (await c.query('SELECT id FROM product_variants WHERE product_id=$1 LIMIT 1', [p.id])).rows[0];
      for (const bi of body.bundle_items) {
        await c.query(
          'INSERT INTO bundle_items (bundle_variant_id,component_variant_id,quantity) VALUES ($1,$2,$3)',
          [bv.id, bi.component_variant_id, num(bi.quantity, 1)]
        );
      }
    }
    return p;
  });

  await audit(req, 'create', 'product', product.id, { name: product.name, sku: product.sku });
  res.status(201).json(await loadProduct(product.id, req.locationId));
}));

/* ---------------- update (with variant add/edit/remove) ---------------- */
r.put('/:id', requirePerm('products.write'), h(async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const existing = await one('SELECT * FROM products WHERE id=$1', [id]);
  if (!existing) throw notFound('Product not found');

  await tx(async (c) => {
    await c.query(
      `UPDATE products SET name=COALESCE($2,name), brand_id=$3, category_id=$4, sub_category_id=$5,
              unit=COALESCE($6,unit), description=COALESCE($7,description), image_url=COALESCE($8,image_url),
              tax_rate=COALESCE($9,tax_rate), reorder_point=COALESCE($10,reorder_point),
              track_rfid=COALESCE($11,track_rfid), is_active=COALESCE($12,is_active),
              type=COALESCE($13,type), tax_rate_id=COALESCE($14,tax_rate_id), updated_at=now()
        WHERE id=$1`,
      [id, body.name ?? null, body.brand_id ?? null, body.category_id ?? null, body.sub_category_id ?? null,
       body.unit ?? null, body.description ?? null, body.image_url ?? null,
       body.tax_rate ?? null, body.reorder_point ?? null,
       'track_rfid' in body ? bool(body.track_rfid) : null,
       'is_active' in body ? bool(body.is_active) : null, body.type ?? null,
       int(body.tax_rate_id) || null]
    );

    if (Array.isArray(body.variants)) {
      const keepIds = [];
      for (const v of body.variants) {
        if (v.id) {
          keepIds.push(Number(v.id));
          await c.query(
            `UPDATE product_variants SET size=$2,color=$3,cost_price=$4,selling_price=$5,
                    barcode=$6, reorder_point=$7, is_active=COALESCE($8,is_active)
              WHERE id=$1 AND product_id=$9`,
            [v.id, v.size || null, v.color || null, num(v.cost_price, 0), num(v.selling_price, 0),
             str(v.barcode) || null, v.reorder_point == null ? null : int(v.reorder_point),
             'is_active' in v ? bool(v.is_active) : null, id]
          );
        } else {
          const vsku = str(v.sku).trim().toUpperCase() || await generateVariantSku(c, existing.sku, v.size, v.color);
          const ins = await c.query(
            `INSERT INTO product_variants (product_id,sku,barcode,size,color,cost_price,selling_price,reorder_point)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [id, vsku, str(v.barcode) || null, v.size || null, v.color || null,
             num(v.cost_price, 0), num(v.selling_price, 0), v.reorder_point == null ? null : int(v.reorder_point)]
          );
          keepIds.push(ins.rows[0].id);
        }
      }
      // Variants dropped from the list are deactivated (never hard-deleted —
      // they may be referenced by past sales and by physical RFID units).
      await c.query(
        `UPDATE product_variants SET is_active=FALSE
          WHERE product_id=$1 AND NOT (id = ANY($2::int[]))`,
        [id, keepIds.length ? keepIds : [0]]
      );
    }
  });

  await audit(req, 'update', 'product', id, { name: body.name ?? existing.name });
  res.json(await loadProduct(id, req.locationId));
}));

/* ---------------- duplicate ---------------- */
r.post('/:id/duplicate', requirePerm('products.write'), h(async (req, res) => {
  const settings = await getSettings();
  const src = await loadProduct(req.params.id, req.locationId);
  if (!src) throw notFound('Product not found');
  const newName = str(req.body.name).trim() || `${src.name} (copy)`;

  const newId = await tx(async (c) => {
    const sku = await generateProductSku(c, newName, settings.sku_prefix);
    const { rows } = await c.query(
      `INSERT INTO products (name,sku,type,brand_id,category_id,sub_category_id,unit,description,
                             image_url,tax_rate,reorder_point,track_rfid,created_by)
       SELECT $2,$3,type,brand_id,category_id,sub_category_id,unit,description,image_url,tax_rate,
              reorder_point,track_rfid,$4
         FROM products WHERE id=$1 RETURNING id`,
      [src.id, newName, sku, req.user.id]
    );
    const pid = rows[0].id;
    for (const v of src.variants) {
      await c.query(
        `INSERT INTO product_variants (product_id,sku,size,color,cost_price,selling_price,reorder_point)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [pid, await generateVariantSku(c, sku, v.size, v.color), v.size, v.color,
         v.cost_price, v.selling_price, v.reorder_point]
      );
    }
    return pid;
  });
  await audit(req, 'duplicate', 'product', newId, { from: src.id });
  res.status(201).json(await loadProduct(newId, req.locationId));
}));

/* ---------------- bulk edit ---------------- */
r.post('/bulk', requirePerm('products.write'), h(async (req, res) => {
  const ids = (req.body.product_ids || []).map(Number).filter(Boolean);
  const action = str(req.body.action);
  if (!ids.length) throw bad('Select at least one product');

  const result = await tx(async (c) => {
    switch (action) {
      case 'activate':
      case 'deactivate':
        await c.query('UPDATE products SET is_active=$2, updated_at=now() WHERE id = ANY($1::int[])',
          [ids, action === 'activate']);
        return { updated: ids.length };
      case 'set_category':
        await c.query('UPDATE products SET category_id=$2, updated_at=now() WHERE id = ANY($1::int[])',
          [ids, req.body.category_id || null]);
        return { updated: ids.length };
      case 'set_brand':
        await c.query('UPDATE products SET brand_id=$2, updated_at=now() WHERE id = ANY($1::int[])',
          [ids, req.body.brand_id || null]);
        return { updated: ids.length };
      case 'set_tax':
        await c.query('UPDATE products SET tax_rate=$2, updated_at=now() WHERE id = ANY($1::int[])',
          [ids, num(req.body.tax_rate, 0)]);
        return { updated: ids.length };
      case 'set_reorder_point':
        await c.query('UPDATE products SET reorder_point=$2, updated_at=now() WHERE id = ANY($1::int[])',
          [ids, int(req.body.reorder_point, 0)]);
        return { updated: ids.length };
      case 'adjust_price': {
        const pct = num(req.body.percent, 0);
        const { rowCount } = await c.query(
          `UPDATE product_variants SET selling_price = ROUND(selling_price * (1 + $2/100.0), 2)
            WHERE product_id = ANY($1::int[])`, [ids, pct]);
        return { updated: rowCount };
      }
      case 'set_price': {
        const { rowCount } = await c.query(
          'UPDATE product_variants SET selling_price=$2 WHERE product_id = ANY($1::int[])',
          [ids, num(req.body.selling_price, 0)]);
        return { updated: rowCount };
      }
      default:
        throw bad(`Unknown bulk action "${action}"`);
    }
  });
  await audit(req, 'bulk_update', 'product', ids.join(','), { action, ...result });
  res.json({ ok: true, action, ...result });
}));

/* ---------------- location price override ---------------- */
r.put('/variants/:variantId/location-price', requirePerm('products.write'), h(async (req, res) => {
  const variantId = Number(req.params.variantId);
  const locationId = int(req.body.location_id, req.locationId);
  if (req.body.selling_price === null || req.body.selling_price === '') {
    await query('DELETE FROM location_prices WHERE variant_id=$1 AND location_id=$2', [variantId, locationId]);
    return res.json({ ok: true, cleared: true });
  }
  const row = await one(
    `INSERT INTO location_prices (variant_id,location_id,selling_price) VALUES ($1,$2,$3)
     ON CONFLICT (variant_id,location_id) DO UPDATE SET selling_price=EXCLUDED.selling_price RETURNING *`,
    [variantId, locationId, num(req.body.selling_price, 0)]
  );
  await audit(req, 'update', 'location_price', variantId, { locationId, price: row.selling_price });
  res.json(row);
}));

r.delete('/:id', requirePerm('products.write'), h(async (req, res) => {
  const id = Number(req.params.id);
  const used = await one(
    `SELECT 1 FROM sale_items si JOIN product_variants v ON v.id=si.variant_id WHERE v.product_id=$1 LIMIT 1`, [id]);
  if (used) {
    await query('UPDATE products SET is_active=FALSE, updated_at=now() WHERE id=$1', [id]);
    await audit(req, 'deactivate', 'product', id, { reason: 'has sales history' });
    return res.json({ ok: true, deactivated: true,
      message: 'Product has sales history, so it was deactivated instead of deleted.' });
  }
  await query('DELETE FROM products WHERE id=$1', [id]);
  await audit(req, 'delete', 'product', id);
  res.json({ ok: true, deleted: true });
}));

export { loadProduct };
export default r;
