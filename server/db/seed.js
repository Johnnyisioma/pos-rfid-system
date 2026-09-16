/**
 * Realistic demo data for a Nigerian footwear boutique with two branches.
 * Safe to re-run after `npm run migrate -- --fresh`.
 */
import bcrypt from 'bcryptjs';
import { pool, tx } from './index.js';
import { receiveUnits, allocateUnits, markUnitsSold, moveStock } from '../services/inventory.js';
import { computeTotals } from '../services/pricing.js';

const EPC_PREFIX = '3035';
const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const chance = (p) => Math.random() < p;

const SIZES_MEN = ['40', '41', '42', '43', '44', '45'];
const SIZES_WOMEN = ['36', '37', '38', '39', '40', '41'];

const CATALOG = [
  { name: 'Marconi Classic Oxford', brand: 'Marconi', cat: 'Footwear', sub: 'Formal Shoes',
    colors: ['Black', 'Brown'], sizes: SIZES_MEN, cost: 21000, price: 38500 },
  { name: 'Marconi Penny Loafer', brand: 'Marconi', cat: 'Footwear', sub: 'Formal Shoes',
    colors: ['Black', 'Tan'], sizes: SIZES_MEN, cost: 18500, price: 33000 },
  { name: 'Aba Craft Leather Slip-on', brand: 'Aba Craft', cat: 'Footwear', sub: 'Casual Shoes',
    colors: ['Brown', 'Navy'], sizes: SIZES_MEN, cost: 12500, price: 24000 },
  { name: 'Streetline Runner Sneaker', brand: 'Streetline', cat: 'Footwear', sub: 'Sneakers',
    colors: ['White', 'Black', 'Grey'], sizes: SIZES_MEN, cost: 16000, price: 31500 },
  { name: 'Streetline Court Low', brand: 'Streetline', cat: 'Footwear', sub: 'Sneakers',
    colors: ['White', 'Red'], sizes: SIZES_WOMEN, cost: 15000, price: 29500 },
  { name: 'Lagos Sun Slide', brand: 'Lagos Sun', cat: 'Footwear', sub: 'Sandals',
    colors: ['Black', 'Brown', 'Olive'], sizes: SIZES_MEN, cost: 5500, price: 12500 },
  { name: 'Lagos Sun Braided Sandal', brand: 'Lagos Sun', cat: 'Footwear', sub: 'Sandals',
    colors: ['Tan', 'Gold'], sizes: SIZES_WOMEN, cost: 6500, price: 14500 },
  { name: 'Vera Block Heel', brand: 'Vera', cat: 'Footwear', sub: 'Heels',
    colors: ['Black', 'Nude', 'Burgundy'], sizes: SIZES_WOMEN, cost: 14000, price: 28000 },
  { name: 'Vera Pointed Pump', brand: 'Vera', cat: 'Footwear', sub: 'Heels',
    colors: ['Black', 'Red'], sizes: SIZES_WOMEN, cost: 15500, price: 30000 },
  { name: 'Kano Hide Chelsea Boot', brand: 'Kano Hide', cat: 'Footwear', sub: 'Boots',
    colors: ['Black', 'Chestnut'], sizes: SIZES_MEN, cost: 24000, price: 45000 },
  { name: 'Kano Hide Ankle Boot', brand: 'Kano Hide', cat: 'Footwear', sub: 'Boots',
    colors: ['Black', 'Tan'], sizes: SIZES_WOMEN, cost: 22000, price: 42000 },
  { name: 'Vera Tote Bag', brand: 'Vera', cat: 'Accessories', sub: 'Bags',
    colors: ['Black', 'Tan', 'Cream'], sizes: [], cost: 17000, price: 34000 },
  { name: 'Marconi Leather Belt', brand: 'Marconi', cat: 'Accessories', sub: 'Belts',
    colors: ['Black', 'Brown'], sizes: ['32', '34', '36', '38'], cost: 4200, price: 9500 },
  { name: 'Everyday Cotton Socks 3-pack', brand: 'Streetline', cat: 'Accessories', sub: 'Socks',
    colors: ['Mixed'], sizes: [], cost: 1800, price: 4500 },
  { name: 'Shoe Care Cream', brand: 'Aba Craft', cat: 'Accessories', sub: 'Shoe Care',
    colors: [], sizes: [], cost: 1200, price: 3200 },
  { name: 'Suede Protector Spray', brand: 'Aba Craft', cat: 'Accessories', sub: 'Shoe Care',
    colors: [], sizes: [], cost: 2400, price: 5500 },
];

const CUSTOMERS = [
  ['Adaeze Nwosu', '08031234501', 'adaeze.n@example.com', 'Retail'],
  ['Chinedu Okafor', '08031234502', 'chinedu.o@example.com', 'Retail'],
  ['Fatima Bello', '08031234503', 'fatima.b@example.com', 'VIP'],
  ['Emeka Obi', '08031234504', '', 'Retail'],
  ['Ngozi Eze', '08031234505', 'ngozi.eze@example.com', 'VIP'],
  ['Tunde Adewale', '08031234506', '', 'Wholesale'],
  ['Blessing Ibrahim', '08031234507', 'blessing.i@example.com', 'Retail'],
  ['Segun Bamidele', '08031234508', '', 'Wholesale'],
  ['Halima Yusuf', '08031234509', 'halima.y@example.com', 'Retail'],
  ['Kelechi Anyanwu', '08031234510', '', 'Retail'],
  ['Oluwaseun Alabi', '08031234511', 'seun.alabi@example.com', 'VIP'],
  ['Amaka Uche', '08031234512', '', 'Retail'],
];

async function seed() {
  console.log('[seed] starting…');

  await tx(async (c) => {
    /* ---------- business settings ---------- */
    await c.query(
      `UPDATE business_settings SET
         name='Millzee Footwear', legal_name='Millzee Footwear Ltd',
         tin='PLACEHOLDER-TIN-0000', rc_number='RC-0000000',
         address='12 Adeola Odeku Street, Victoria Island, Lagos',
         phone='+234 803 000 0000', email='sales@millzeefootwear.example',
         currency='NGN', currency_symbol='₦', vat_rate=7.5, prices_include_vat=TRUE,
         invoice_prefix='INV', sku_prefix='MF', epc_company_prefix=$1,
         receipt_footer='Thank you for shopping with us. Exchanges within 7 days with receipt.',
         loyalty_earn_per=1000, loyalty_point_value=10, low_stock_default=3
       WHERE id=1`, [EPC_PREFIX]);

    /* ---------- locations ---------- */
    const locs = [];
    for (const [name, code, address, isDefault] of [
      ['Lagos Main Store', 'LAG', '12 Adeola Odeku Street, Victoria Island, Lagos', true],
      ['Umunede Branch', 'UMU', 'Old Lagos-Asaba Road, Umunede, Delta State', false],
    ]) {
      const { rows } = await c.query(
        `INSERT INTO locations (name, code, address, phone, is_default) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name RETURNING *`,
        [name, code, address, '+234 803 000 0000', isDefault]);
      locs.push(rows[0]);
    }
    const [lagos, umunede] = locs;

    /* ---------- users ---------- */
    const password = await bcrypt.hash('password123', 10);
    const users = [];
    for (const [name, email, role, maxDisc, locations] of [
      ['Millzee Jay', 'admin@millzee.test', 'admin', 100, [lagos.id, umunede.id]],
      ['Ifeoma Chukwu', 'manager@millzee.test', 'manager', 25, [lagos.id, umunede.id]],
      ['Bola Adeyemi', 'cashier@millzee.test', 'cashier', 5, [lagos.id]],
      ['Peter Okon', 'cashier2@millzee.test', 'cashier', 5, [umunede.id]],
      ['Grace Nnamdi', 'stock@millzee.test', 'inventory', 0, [lagos.id, umunede.id]],
    ]) {
      const { rows } = await c.query(
        `INSERT INTO users (name,email,password_hash,role,max_discount_percent)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name RETURNING *`,
        [name, email, password, role, maxDisc]);
      const u = rows[0];
      for (const lid of locations) {
        await c.query('INSERT INTO user_locations (user_id,location_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [u.id, lid]);
      }
      users.push(u);
    }
    const [admin, manager, cashierLag, cashierUmu, stockUser] = users;

    /* ---------- registers ---------- */
    for (const l of locs) {
      await c.query('INSERT INTO registers (location_id,name) VALUES ($1,$2)', [l.id, 'Counter 1']);
    }
    await c.query('INSERT INTO registers (location_id,name) VALUES ($1,$2)', [lagos.id, 'Counter 2']);

    /* ---------- devices (mock hardware) ---------- */
    await c.query(
      `INSERT INTO devices (name, kind, location_id, driver, host, port, config) VALUES
        ('Zebra ZD500R (Lagos)','rfid_printer',$1,'mock','192.168.1.50',9100,'{"note":"Switch driver to zebra_zpl_tcp when the printer is on the shop network"}'),
        ('Handheld UHF Reader (Lagos)','rfid_reader',$1,'mock',NULL,NULL,'{"posts_to":"/api/rfid/scan-events"}'),
        ('Thermal Receipt Printer','receipt_printer',$1,'mock',NULL,NULL,'{}')`,
      [lagos.id]);

    /* ---------- catalog scaffolding ---------- */
    const brandIds = {};
    for (const b of [...new Set(CATALOG.map((p) => p.brand))]) {
      const { rows } = await c.query(
        'INSERT INTO brands (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id', [b]);
      brandIds[b] = rows[0].id;
    }
    const catIds = {};
    for (const cat of [...new Set(CATALOG.map((p) => p.cat))]) {
      const { rows } = await c.query('INSERT INTO categories (name) VALUES ($1) RETURNING id', [cat]);
      catIds[cat] = rows[0].id;
    }
    const subIds = {};
    for (const p of CATALOG) {
      const key = `${p.cat}/${p.sub}`;
      if (subIds[key]) continue;
      const { rows } = await c.query(
        'INSERT INTO categories (name,parent_id) VALUES ($1,$2) RETURNING id', [p.sub, catIds[p.cat]]);
      subIds[key] = rows[0].id;
    }

    await c.query(
      `INSERT INTO variation_templates (name, axis, values_json) VALUES
        ('Men EU sizes','size',$1), ('Women EU sizes','size',$2),
        ('Belt sizes','size',$3), ('Core colours','color',$4), ('Leather colours','color',$5)
       ON CONFLICT (name) DO NOTHING`,
      [JSON.stringify(SIZES_MEN), JSON.stringify(SIZES_WOMEN), JSON.stringify(['32', '34', '36', '38']),
       JSON.stringify(['Black', 'White', 'Grey', 'Navy', 'Red']),
       JSON.stringify(['Black', 'Brown', 'Tan', 'Chestnut', 'Burgundy', 'Nude'])]);

    await c.query(
      `INSERT INTO customer_groups (name, discount_percent, notes) VALUES
        ('Retail',0,'Walk-in customers'),
        ('VIP',5,'Frequent shoppers — 5% standing discount'),
        ('Wholesale',12,'Bulk buyers and resellers')
       ON CONFLICT (name) DO NOTHING`);

    await c.query(
      `INSERT INTO expense_categories (name) VALUES
        ('Rent'),('Salaries'),('Electricity / Generator'),('Transport & Logistics'),
        ('Marketing'),('Bank Charges'),('Shop Supplies'),('Repairs & Maintenance')
       ON CONFLICT (name) DO NOTHING`);

    /* ---------- suppliers ---------- */
    const supplierIds = [];
    for (const [name, person, phone, email, address] of [
      ['Ariaria Leather Works', 'Uche Nnadi', '08051110001', 'sales@ariaria.example', 'Ariaria Market, Aba, Abia State'],
      ['Lagos Footwear Imports', 'Kemi Ade', '08051110002', 'orders@lfimports.example', 'Trade Fair Complex, Lagos'],
      ['Guangzhou Shoe Co.', 'Li Wei', '+8613800000000', 'export@gzshoe.example', 'Baiyun District, Guangzhou'],
      ['Kano Tannery Ltd', 'Musa Danjuma', '08051110003', 'info@kanotannery.example', 'Bompai Industrial Area, Kano'],
    ]) {
      const { rows } = await c.query(
        `INSERT INTO suppliers (name,contact_person,phone,email,address) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [name, person, phone, email, address]);
      supplierIds.push(rows[0].id);
    }

    /* ---------- products + variants ---------- */
    const variants = [];   // {id, cost, price, productName}
    let skuSeq = 0;
    for (const p of CATALOG) {
      skuSeq += 1;
      const sku = `MF-${String(skuSeq).padStart(4, '0')}`;
      const sizes = p.sizes.length ? p.sizes : [null];
      const colors = p.colors.length ? p.colors : [null];
      const type = sizes[0] === null && colors[0] === null ? 'single' : 'variable';
      const { rows } = await c.query(
        `INSERT INTO products (name,sku,type,brand_id,category_id,sub_category_id,unit,description,
                               tax_rate,reorder_point,track_rfid,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,7.5,$9,TRUE,$10) RETURNING id`,
        [p.name, sku, type, brandIds[p.brand], catIds[p.cat], subIds[`${p.cat}/${p.sub}`],
         p.cat === 'Footwear' ? 'pair' : 'piece',
         `${p.brand} ${p.sub.toLowerCase()} — ${p.name}.`,
         p.cat === 'Footwear' ? 2 : 4, admin.id]);
      const productId = rows[0].id;

      for (const size of sizes) {
        for (const color of colors) {
          const suffix = [size, color].filter(Boolean).map((x) => String(x).toUpperCase().replace(/[^A-Z0-9]/g, '')).join('-');
          const vsku = suffix ? `${sku}-${suffix}` : sku;
          const jitter = 1 + (rand(7) - 3) / 100;
          const price = Math.round((p.price * jitter) / 100) * 100;
          const { rows: vr } = await c.query(
            `INSERT INTO product_variants (product_id,sku,size,color,cost_price,selling_price,barcode)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [productId, vsku, size, color, p.cost, price,
             `20${String(skuSeq).padStart(3, '0')}${String(variants.length + 1).padStart(6, '0')}`]);
          variants.push({ id: vr.rows ? vr.rows[0].id : vr[0].id, cost: p.cost, price, productName: p.name, size, color });
        }
      }
    }
    // normalise (pg returns .rows)
    for (const v of variants) if (typeof v.id === 'object') v.id = v.id.id;

    /* ---------- a bundle product ---------- */
    const careVariants = variants.filter((v) => v.productName.includes('Shoe Care') || v.productName.includes('Suede Protector'));
    if (careVariants.length >= 2) {
      const { rows } = await c.query(
        `INSERT INTO products (name,sku,type,brand_id,category_id,unit,description,tax_rate,reorder_point,track_rfid,created_by)
         VALUES ('Shoe Care Starter Kit','MF-KIT01','bundle',$1,$2,'kit',
                 'Cream + protector spray sold together as one kit.',7.5,2,FALSE,$3) RETURNING id`,
        [brandIds['Aba Craft'], catIds['Accessories'], admin.id]);
      const { rows: bv } = await c.query(
        `INSERT INTO product_variants (product_id,sku,cost_price,selling_price)
         VALUES ($1,'MF-KIT01-STD',3600,8200) RETURNING id`, [rows[0].id]);
      for (const cv of careVariants.slice(0, 2)) {
        await c.query('INSERT INTO bundle_items (bundle_variant_id,component_variant_id,quantity) VALUES ($1,$2,1)',
          [bv[0].id, cv.id]);
      }
    }

    /* ---------- location price override example ---------- */
    const overrideVariant = variants.find((v) => v.productName.includes('Oxford'));
    if (overrideVariant) {
      await c.query(
        'INSERT INTO location_prices (variant_id,location_id,selling_price) VALUES ($1,$2,$3)',
        [overrideVariant.id, umunede.id, Math.round(overrideVariant.price * 0.93 / 100) * 100]);
    }

    /* ---------- purchase orders + goods receiving (creates EPC units) ---------- */
    let poSeq = 0;
    for (const location of locs) {
      for (let i = 0; i < 3; i++) {
        poSeq += 1;
        const supplierId = pick(supplierIds);
        const poNumber = `PO-${new Date().getFullYear()}-${String(poSeq).padStart(6, '0')}`;
        const { rows: por } = await c.query(
          `INSERT INTO purchase_orders (po_number,supplier_id,location_id,status,order_date,notes,created_by)
           VALUES ($1,$2,$3,'received', CURRENT_DATE - $4::int, $5, $6) RETURNING *`,
          [poNumber, supplierId, location.id, 60 - i * 18, 'Seed purchase order', stockUser.id]);
        const po = por[0];

        const chosen = [];
        const poolV = variants.filter(() => chance(location.id === lagos.id ? 0.85 : 0.6));
        for (const v of poolV.slice(0, location.id === lagos.id ? 60 : 45)) chosen.push(v);

        let subtotal = 0;
        for (const v of chosen) {
          const qty = location.id === lagos.id ? 4 + rand(6) : 2 + rand(4);
          const { rows: itemRows } = await c.query(
            `INSERT INTO purchase_order_items (po_id,variant_id,quantity,received_quantity,unit_cost)
             VALUES ($1,$2,$3,$3,$4) RETURNING id`, [po.id, v.id, qty, v.cost]);
          subtotal += qty * v.cost;
          await receiveUnits(c, {
            variantId: v.id, locationId: location.id, quantity: qty, costPrice: v.cost,
            companyPrefix: EPC_PREFIX, referenceType: 'purchase_order', referenceId: po.id,
            sourceRef: poNumber, userId: stockUser.id, type: 'purchase',
            reason: `Received on ${poNumber}`,
          });
        }
        await c.query('UPDATE purchase_orders SET subtotal=$2, total=$2, amount_paid=$2 WHERE id=$1',
          [po.id, subtotal]);
      }
    }

    // Mark most tags as already encoded; leave some awaiting encoding to demo the queue.
    await c.query("UPDATE stock_units SET tag_encoded=TRUE, encoded_at=received_at WHERE random() < 0.88");

    /* ---------- customers ---------- */
    const groupRows = await c.query('SELECT id,name FROM customer_groups');
    const groups = Object.fromEntries(groupRows.rows.map((g) => [g.name, g.id]));
    const customerIds = [];
    for (const [name, phone, email, group] of CUSTOMERS) {
      const { rows } = await c.query(
        `INSERT INTO customers (name,phone,email,group_id,credit_limit,address)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [name, phone, email || null, groups[group],
         group === 'Wholesale' ? 500000 : group === 'VIP' ? 150000 : 0,
         pick(['Lagos', 'Asaba', 'Umunede', 'Warri', 'Benin City'])]);
      customerIds.push(rows[0].id);
    }

    console.log(`[seed] catalog ready: ${variants.length} variants`);
    return { locs, users, customerIds, variants };
  });

  /* ---------- sales history (separate transactions, 60 days) ---------- */
  const { rows: locRows } = await pool.query('SELECT * FROM locations ORDER BY id');
  const { rows: userRows } = await pool.query('SELECT * FROM users ORDER BY id');
  const { rows: custRows } = await pool.query('SELECT id, group_id FROM customers');
  const { rows: settingsRows } = await pool.query('SELECT * FROM business_settings WHERE id=1');
  const settings = settingsRows[0];
  const { rows: groupRows } = await pool.query('SELECT id, discount_percent FROM customer_groups');
  const groupDiscount = Object.fromEntries(groupRows.map((g) => [g.id, Number(g.discount_percent)]));

  const cashiers = {
    [locRows[0].id]: userRows.filter((u) => ['cashier', 'manager'].includes(u.role)).slice(0, 2),
    [locRows[1].id]: userRows.filter((u) => u.role === 'cashier').slice(1),
  };

  let invoiceSeq = 1;
  let salesMade = 0;

  for (let dayAgo = 59; dayAgo >= 0; dayAgo--) {
    const date = new Date(Date.now() - dayAgo * 86400000);
    const dow = date.getDay();
    const busy = dow === 5 || dow === 6 ? 1.6 : dow === 0 ? 0.6 : 1;

    for (const location of locRows) {
      const base = location.code === 'LAG' ? 6 : 3;
      const count = Math.max(0, Math.round((base + rand(4)) * busy));
      for (let i = 0; i < count; i++) {
        const staffPool = cashiers[location.id]?.length ? cashiers[location.id] : userRows.filter((u) => u.role !== 'inventory');
        const cashier = pick(staffPool);
        const hour = 9 + rand(11);
        const when = new Date(date);
        when.setHours(hour, rand(60), rand(60), 0);

        try {
          await tx(async (c) => {
            const { rows: stockRows } = await c.query(
              `SELECT i.variant_id, i.quantity, v.cost_price,
                      COALESCE(lp.selling_price, v.selling_price) AS price,
                      p.name, p.tax_rate, v.size, v.color
                 FROM inventory i
                 JOIN product_variants v ON v.id=i.variant_id
                 JOIN products p ON p.id=v.product_id
                 LEFT JOIN location_prices lp ON lp.variant_id=v.id AND lp.location_id=$1
                WHERE i.location_id=$1 AND i.quantity > 0
                ORDER BY random() LIMIT 4`, [location.id]);
            if (!stockRows.length) return;

            const lineCount = 1 + (chance(0.35) ? 1 : 0) + (chance(0.12) ? 1 : 0);
            const chosen = stockRows.slice(0, lineCount);
            const customerId = chance(0.55) ? pick(custRows).id : null;
            const customer = customerId ? custRows.find((x) => x.id === customerId) : null;

            const lines = chosen.map((s) => ({
              variant_id: s.variant_id,
              product_name: s.name,
              variant_label: [s.size, s.color].filter(Boolean).join(' / '),
              quantity: 1,
              unit_price: Number(s.price),
              discount_amount: 0,
              tax_rate: Number(s.tax_rate),
              cost_price: Number(s.cost_price),
            }));

            const cartDiscount = customer && groupDiscount[customer.group_id]
              ? { type: 'percent', value: groupDiscount[customer.group_id] }
              : chance(0.12) ? { type: 'percent', value: pick([2, 5]) } : { type: 'fixed', value: 0 };

            const totals = computeTotals(lines, cartDiscount, settings);

            const isCredit = !!(customer && chance(0.05));
            const paidNow = isCredit ? Math.round(totals.total * 0.5) : totals.total;
            const method = pick(['cash', 'cash', 'transfer', 'card', 'mobile_money']);

            const invoiceNo = `INV-${when.getFullYear()}-${String(invoiceSeq).padStart(6, '0')}`;
            invoiceSeq += 1;
            const pointsEarned = customer ? Math.floor(totals.total / Number(settings.loyalty_earn_per)) : 0;

            const { rows: saleRows } = await c.query(
              `INSERT INTO sales (invoice_no,invoice_seq,location_id,user_id,customer_id,sale_type,status,
                                  subtotal,discount_amount,discount_type,discount_value,tax_amount,total,
                                  cost_total,amount_paid,change_due,balance_due,is_credit,points_earned,
                                  created_at,updated_at)
               VALUES ($1,$2,$3,$4,$5,'sale','completed',$6,$7,$8,$9,$10,$11,$12,$13,0,$14,$15,$16,$17,$17)
               RETURNING *`,
              [invoiceNo, invoiceSeq - 1, location.id, cashier.id, customerId,
               totals.subtotal, totals.discount_amount, cartDiscount.type, cartDiscount.value,
               totals.tax_amount, totals.total, totals.cost_total, paidNow,
               totals.total - paidNow, isCredit, pointsEarned, when]);
            const sale = saleRows[0];

            for (const l of totals.lines) {
              const { rows: itemRows } = await c.query(
                `INSERT INTO sale_items (sale_id,variant_id,product_name,variant_label,quantity,unit_price,
                                         discount_amount,tax_rate,tax_amount,line_total,cost_price,sku)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                         (SELECT sku FROM product_variants WHERE id=$2)) RETURNING id`,
                [sale.id, l.variant_id, l.product_name, l.variant_label, l.quantity, l.unit_price,
                 l.discount_amount, l.tax_rate, l.tax_amount, l.line_total, l.cost_price]);
              const itemId = itemRows[0].id;

              const units = await allocateUnits(c, {
                variantId: l.variant_id, locationId: location.id, quantity: 1,
              });
              for (const u of units) {
                await c.query('INSERT INTO sale_item_units (sale_item_id,unit_id) VALUES ($1,$2)', [itemId, u.id]);
              }
              await c.query(
                `UPDATE stock_units SET status='sold', sold_at=$2, sale_id=$3 WHERE id = ANY($1::bigint[])`,
                [units.map((u) => u.id), when, sale.id]);
              await moveStock(c, {
                variantId: l.variant_id, locationId: location.id, delta: -1, type: 'sale',
                referenceType: 'sale', referenceId: sale.id, userId: cashier.id,
              });
            }

            await c.query(
              'INSERT INTO payments (sale_id,method,amount,user_id,created_at) VALUES ($1,$2,$3,$4,$5)',
              [sale.id, method, paidNow, cashier.id, when]);

            if (customerId) {
              if (pointsEarned > 0) {
                await c.query('UPDATE customers SET loyalty_points = loyalty_points + $2 WHERE id=$1',
                  [customerId, pointsEarned]);
                await c.query(`INSERT INTO loyalty_ledger (customer_id,points,type,sale_id,created_at)
                               VALUES ($1,$2,'earn',$3,$4)`, [customerId, pointsEarned, sale.id, when]);
              }
              if (isCredit) {
                await c.query('UPDATE customers SET balance = balance + $2 WHERE id=$1',
                  [customerId, totals.total - paidNow]);
              }
            }
            salesMade += 1;
          });
        } catch (err) {
          if (!/Not enough stock|no rows/i.test(err.message)) {
            console.warn('[seed] sale skipped:', err.message);
          }
        }
      }
    }
  }

  /* ---------- a couple of returns ---------- */
  await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT s.id, s.location_id, s.customer_id, si.id AS item_id, si.variant_id, si.line_total, si.quantity
         FROM sales s JOIN sale_items si ON si.sale_id=s.id
        WHERE s.status='completed' AND s.created_at > now() - interval '20 days'
        ORDER BY random() LIMIT 3`);
    let n = 0;
    for (const row of rows) {
      n += 1;
      const ref = `RET-${new Date().getFullYear()}-${String(n).padStart(6, '0')}`;
      const { rows: retRows } = await c.query(
        `INSERT INTO sale_returns (ref,original_sale_id,location_id,customer_id,user_id,type,total_refund,refund_method,reason)
         VALUES ($1,$2,$3,$4,(SELECT id FROM users WHERE role='manager' LIMIT 1),'refund',$5,'cash',$6) RETURNING id`,
        [ref, row.id, row.location_id, row.customer_id, row.line_total,
         pick(['Wrong size', 'Customer changed mind', 'Minor defect on stitching'])]);
      await c.query(
        `INSERT INTO sale_return_items (return_id,sale_item_id,variant_id,quantity,unit_price,refund_amount,restock)
         VALUES ($1,$2,$3,1,$4,$4,TRUE)`,
        [retRows[0].id, row.item_id, row.variant_id, row.line_total]);
      await c.query('UPDATE sale_items SET returned_quantity=1 WHERE id=$1', [row.item_id]);
      await c.query("UPDATE sales SET status='partially_refunded' WHERE id=$1", [row.id]);
      const { rows: units } = await c.query(
        `UPDATE stock_units SET status='in_stock', sale_id=NULL, sold_at=NULL
          WHERE id IN (SELECT unit_id FROM sale_item_units WHERE sale_item_id=$1 LIMIT 1) RETURNING id, variant_id`,
        [row.item_id]);
      if (units.length) {
        await moveStock(c, {
          variantId: units[0].variant_id, locationId: row.location_id, delta: 1, type: 'return',
          referenceType: 'return', referenceId: retRows[0].id, reason: 'Seed return',
        });
      }
    }
  });

  /* ---------- expenses ---------- */
  await tx(async (c) => {
    const { rows: cats } = await c.query('SELECT id,name FROM expense_categories');
    const { rows: locsRows } = await c.query('SELECT id, code FROM locations');
    const amounts = { Rent: 450000, Salaries: 620000, 'Electricity / Generator': 85000,
      'Transport & Logistics': 42000, Marketing: 60000, 'Bank Charges': 8500,
      'Shop Supplies': 23000, 'Repairs & Maintenance': 35000 };
    let n = 0;
    for (let monthsAgo = 1; monthsAgo >= 0; monthsAgo--) {
      for (const loc of locsRows) {
        for (const cat of cats) {
          if (chance(0.25)) continue;
          n += 1;
          const factor = loc.code === 'LAG' ? 1 : 0.45;
          const amount = Math.round((amounts[cat.name] || 20000) * factor * (0.85 + Math.random() * 0.3));
          await c.query(
            `INSERT INTO expenses (ref,location_id,category_id,amount,note,expense_date,user_id)
             VALUES ($1,$2,$3,$4,$5, date_trunc('month', CURRENT_DATE) - ($6 || ' month')::interval + ($7 || ' days')::interval,
                     (SELECT id FROM users WHERE role='admin' LIMIT 1))`,
            [`EXP-${new Date().getFullYear()}-${String(n).padStart(6, '0')}`, loc.id, cat.id, amount,
             `${cat.name} — ${loc.code}`, monthsAgo, rand(26)]);
        }
      }
    }
  });

  /* ---------- an open register session + a held sale ---------- */
  await tx(async (c) => {
    const { rows: reg } = await c.query(
      `SELECT r.id, r.location_id FROM registers r JOIN locations l ON l.id=r.location_id
        WHERE l.code='LAG' ORDER BY r.id LIMIT 1`);
    const { rows: u } = await c.query("SELECT id FROM users WHERE role='cashier' ORDER BY id LIMIT 1");
    if (reg.length && u.length) {
      await c.query(
        `INSERT INTO register_sessions (register_id,location_id,user_id,opening_cash,status)
         VALUES ($1,$2,$3,50000,'open')`, [reg[0].id, reg[0].location_id, u[0].id]);
    }
  });

  await pool.query(
    `UPDATE business_settings
        SET invoice_next = COALESCE((SELECT MAX(invoice_seq) + 1 FROM sales), 1) WHERE id=1`);

  const counts = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM products) AS products,
      (SELECT COUNT(*) FROM product_variants) AS variants,
      (SELECT COUNT(*) FROM stock_units) AS units,
      (SELECT COUNT(*) FROM stock_units WHERE status='in_stock') AS in_stock,
      (SELECT COUNT(*) FROM sales) AS sales,
      (SELECT COUNT(*) FROM customers) AS customers,
      (SELECT COUNT(*) FROM expenses) AS expenses`);
  console.log('[seed] done:', counts.rows[0]);
  console.log('[seed] logins — admin@millzee.test / manager@millzee.test / cashier@millzee.test / stock@millzee.test  (password: password123)');
}

const RUN_STANDALONE = process.argv[1] && process.argv[1].endsWith('seed.js');

seed()
  .then(() => { if (RUN_STANDALONE) return pool.end(); })
  .catch((e) => {
    console.error('[seed] failed:', e);
    if (RUN_STANDALONE) process.exit(1);
  });
