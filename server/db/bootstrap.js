/**
 * First-run bootstrap — the real skeleton, and nothing else.
 *
 * This creates only what a POS cannot function without: somewhere to sell from,
 * someone to log in as, a till, and the reference lists the forms need. It
 * creates NO products, NO stock, NO customers, NO sales, NO expenses and NO
 * devices. Those are yours.
 *
 * It replaced a demo seed that invented seventeen shoe products, eight hundred
 * sales and a fake Zebra printer. Demo data is fine for a sales pitch and
 * actively dangerous in a shop: the first real stock count reconciles against
 * invented stock, the first VAT report is computed from invented invoices, and
 * nobody is sure which figures are theirs.
 *
 * Re-running is safe — every step is skipped if it already exists — so this can
 * run on every boot without touching a live database.
 */
import bcrypt from 'bcryptjs';
import { pool, tx } from './index.js';

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
const ADMIN_NAME = process.env.ADMIN_NAME || 'Administrator';
const LOCATION_NAME = process.env.LOCATION_NAME || 'Main Shop';
const LOCATION_CODE = (process.env.LOCATION_CODE || 'MAIN').toUpperCase();

/** Sizes and colours are the two axes a footwear shop always needs. */
const VARIATION_TEMPLATES = [
  ['Shoe size (men)', 'size', ['39', '40', '41', '42', '43', '44', '45', '46']],
  ['Shoe size (women)', 'size', ['35', '36', '37', '38', '39', '40', '41']],
  ['Colour', 'color', ['Black', 'Brown', 'Tan', 'White', 'Navy', 'Grey', 'Red', 'Beige']],
];

/** Categories every small retailer books against. Rename or delete freely. */
const EXPENSE_CATEGORIES = [
  'Rent', 'Salaries', 'Electricity / Generator', 'Transport & Logistics',
  'Marketing', 'Bank Charges', 'Shop Supplies', 'Repairs & Maintenance',
];

export async function bootstrap({ quiet = false } = {}) {
  const log = (m) => { if (!quiet) console.log(`[bootstrap] ${m}`); };
  const created = [];

  await tx(async (c) => {
    /* ---------- a place to sell from ---------- */
    let { rows: locs } = await c.query('SELECT id FROM locations LIMIT 1');
    if (!locs.length) {
      const { rows } = await c.query(
        `INSERT INTO locations (name, code, is_default) VALUES ($1,$2,TRUE) RETURNING id`,
        [LOCATION_NAME, LOCATION_CODE]);
      locs = rows;
      created.push(`location "${LOCATION_NAME}"`);
    }
    const locationId = locs[0].id;

    /* ---------- a till to open ---------- */
    const { rows: regs } = await c.query(
      'SELECT 1 FROM registers WHERE location_id=$1 LIMIT 1', [locationId]);
    if (!regs.length) {
      await c.query('INSERT INTO registers (location_id, name) VALUES ($1,$2)',
        [locationId, 'Counter 1']);
      created.push('register "Counter 1"');
    }

    /* ---------- somebody to log in as ---------- */
    const { rows: users } = await c.query('SELECT COUNT(*)::int AS n FROM users');
    if (users[0].n === 0) {
      // A random password, printed once. Never a default like "admin123" — a
      // shop POS reachable from the internet with a known password is not a
      // system, it is an incident waiting to be written up.
      const password = process.env.ADMIN_PASSWORD
        || Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 6)).join('-');
      const hash = await bcrypt.hash(password, 10);
      const { rows: admin } = await c.query(
        `INSERT INTO users (name, email, password_hash, role, max_discount_percent)
         VALUES ($1,$2,$3,'admin',100) RETURNING id`, [ADMIN_NAME, ADMIN_EMAIL, hash]);
      await c.query('INSERT INTO user_locations (user_id, location_id) VALUES ($1,$2)',
        [admin.rows?.[0]?.id || admin[0].id, locationId]);
      created.push(`admin user ${ADMIN_EMAIL}`);

      if (!quiet) {
        console.log('');
        console.log('  ┌──────────────────────────────────────────────────────────');
        console.log('  │  FIRST-RUN ADMIN LOGIN — shown once, write it down now');
        console.log(`  │    email:    ${ADMIN_EMAIL}`);
        console.log(`  │    password: ${password}`);
        console.log('  │  Change it under Settings → My account after signing in.');
        console.log('  └──────────────────────────────────────────────────────────');
        console.log('');
      }
    } else {
      // Existing install: make sure every user can reach the default location.
      await c.query(
        `INSERT INTO user_locations (user_id, location_id)
         SELECT u.id, $1 FROM users u
          WHERE NOT EXISTS (SELECT 1 FROM user_locations ul WHERE ul.user_id = u.id)`,
        [locationId]);
    }

    /* ---------- reference lists the forms need ---------- */
    for (const [name, axis, values] of VARIATION_TEMPLATES) {
      await c.query(
        `INSERT INTO variation_templates (name, axis, values_json) VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`, [name, axis, JSON.stringify(values)]);
    }
    for (const name of EXPENSE_CATEGORIES) {
      await c.query('INSERT INTO expense_categories (name) VALUES ($1) ON CONFLICT DO NOTHING',
        [name]);
    }
    // One walk-in group so the customer form has something to select.
    await c.query(
      `INSERT INTO customer_groups (name, discount_percent, notes) VALUES ($1,0,$2)
       ON CONFLICT DO NOTHING`,
      ['Retail', 'Standard walk-in pricing']);

    // The units a footwear shop always reaches for. Rename or add freely.
    for (const [name, short, dec] of [['Pair', 'pr', false], ['Piece', 'pc', false],
                                      ['Box', 'box', false], ['Dozen', 'dz', false]]) {
      await c.query(
        `INSERT INTO units (name, short_name, allow_decimal) VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`, [name, short, dec]);
    }
    // The default retail price tier, so price-groups can be switched on without
    // a blank screen.
    await c.query(
      `INSERT INTO price_groups (name, description) VALUES ('Retail', 'Standard shelf price')
       ON CONFLICT DO NOTHING`);

    /* ---------- point the till account at this location ---------- */
    await c.query(
      `UPDATE payment_accounts SET location_id = $1
        WHERE type = 'cash' AND location_id IS NULL`, [locationId]);

    /* ---------- chart of accounts (double-entry skeleton) ----------
       Enough for a retail shop to produce a real balance sheet and P&L. The
       engine posts to the accounts flagged is_system via account_mappings, so
       these must exist before any sale is booked. Renamable, not deletable. */
    const COA = [
      // code, name, type, normal_balance, system, mapping_key
      ['1000', 'Cash on hand',            'asset',     'debit',  true,  'cash'],
      ['1010', 'Bank',                    'asset',     'debit',  true,  'bank'],
      ['1100', 'Accounts receivable',     'asset',     'debit',  true,  'ar'],
      ['1200', 'Inventory',               'asset',     'debit',  true,  'inventory'],
      ['2000', 'Accounts payable',        'liability', 'credit', true,  'ap'],
      ['2100', 'VAT payable',             'liability', 'credit', true,  'vat_payable'],
      ['3000', 'Owner equity',            'equity',    'credit', true,  'equity'],
      ['3900', 'Retained earnings',       'equity',    'credit', true,  'retained'],
      ['4000', 'Sales income',            'income',    'credit', true,  'sales_income'],
      ['4100', 'Sales returns',           'income',    'debit',  true,  'sales_returns'],
      ['5000', 'Cost of goods sold',      'expense',   'debit',  true,  'cogs'],
      ['6000', 'Operating expenses',      'expense',   'debit',  true,  'expense'],
    ];
    for (const [code, name, type, nb, sys, key] of COA) {
      const { rows: acc } = await c.query(
        `INSERT INTO chart_of_accounts (code, name, type, normal_balance, is_system)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (code) DO UPDATE SET is_system=EXCLUDED.is_system
         RETURNING id`, [code, name, type, nb, sys]);
      if (key) {
        await c.query(
          `INSERT INTO account_mappings (mapping_key, account_id) VALUES ($1,$2)
           ON CONFLICT (mapping_key) DO UPDATE SET account_id=COALESCE(account_mappings.account_id, EXCLUDED.account_id)`,
          [key, acc[0].id]);
      }
    }

    /* ---------- a default receipt layout + notification templates ---------- */
    const { rows: haveLayout } = await c.query('SELECT 1 FROM invoice_layouts LIMIT 1');
    if (!haveLayout.length) {
      await c.query(
        `INSERT INTO invoice_layouts (name, doc_type, header_text, footer_text, is_default, paper)
         VALUES ('Standard receipt','receipt','', 'Thank you for your patronage', TRUE, '80mm')`);
      await c.query(
        `INSERT INTO invoice_layouts (name, doc_type, header_text, footer_text, is_default, paper, show_customer, show_payment)
         VALUES ('A4 invoice','invoice','', 'Goods remain our property until paid in full', TRUE, 'A4', TRUE, TRUE)`);
    }
    // The message templates a shop actually sends. {name} {invoice} {total}
    // {balance} {link} {shop} are filled at send time.
    for (const [key, channel, subject, body] of [
      ['sale_complete', 'whatsapp', '', 'Hi {name}, thank you for shopping at {shop}! Your receipt {invoice} for {total} is here: {link}'],
      ['payment_due', 'whatsapp', '', 'Hi {name}, a reminder from {shop}: {balance} is outstanding on invoice {invoice}. Thank you.'],
      ['sale_complete', 'email', 'Your receipt from {shop}', 'Hi {name},\n\nThank you for your purchase. Your receipt {invoice} for {total} is attached / available at {link}.\n\n{shop}'],
    ]) {
      await c.query(
        `INSERT INTO notification_templates (key, channel, subject, body)
         VALUES ($1,$2,$3,$4) ON CONFLICT (key, channel) DO NOTHING`, [key, channel, subject, body]);
    }
  });

  if (created.length) log(`created: ${created.join(', ')}`);
  else log('nothing to do — this database is already set up');

  return { created };
}

// Allow `node server/db/bootstrap.js` directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap()
    .then(() => pool.end())
    .catch((e) => { console.error('[bootstrap] failed:', e.message); process.exit(1); });
}
