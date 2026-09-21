/**
 * A brand-new shop check.
 *
 * Every screen in this system was built and tested against a database full of
 * products, sales and history. A real first day has none of that, and "cannot
 * read properties of undefined" on an empty array is the classic way a fresh
 * install greets its owner. This walks the whole app on a database that has
 * only the bootstrap skeleton and fails on any crash, blank page or error text.
 *
 *   BASE=http://localhost:3200 ADMIN_PASS=… node scripts/empty-state-check.mjs
 */
import { launchBrowser } from './lib/browser.mjs';

const BASE = process.env.BASE || 'http://localhost:3200';
const EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const PASS = process.env.ADMIN_PASS;
if (!PASS) { console.error('Set ADMIN_PASS to the bootstrap password'); process.exit(2); }

const PAGES = [
  ['dashboard', '/'], ['pos', '/pos'], ['products', '/products'], ['product-new', '/products/new'],
  ['import-export', '/import-export'], ['inventory', '/inventory'],
  ['inventory-low', '/inventory?tab=low'], ['inventory-valuation', '/inventory?tab=valuation'],
  ['purchases', '/purchases'], ['purchases-returns', '/purchases?tab=returns'],
  ['purchases-suppliers', '/purchases?tab=suppliers'], ['purchases-reorder', '/purchases?tab=reorder'],
  ['transfers', '/transfers'], ['rfid', '/rfid'], ['rfid-lookup', '/rfid/lookup'],
  ['rfid-reader-test', '/rfid/reader-test'], ['rfid-tag-stock', '/rfid/tag-stock'],
  ['rfid-stock-take', '/rfid/stock-take'], ['rfid-find', '/rfid/find'],
  ['customers', '/customers'], ['sales', '/sales'], ['sales-held', '/sales?status=held'],
  ['returns', '/returns'], ['register', '/register'], ['expenses', '/expenses'],
  ['accounts', '/accounts'],
  ['reports-sales', '/reports?tab=sales'], ['reports-products', '/reports?tab=products'],
  ['reports-pl', '/reports?tab=pl'], ['reports-purchase-sale', '/reports?tab=purchase-sale'],
  ['reports-payments', '/reports?tab=payments'], ['reports-aging', '/reports?tab=aging'],
  ['reports-contacts', '/reports?tab=contacts'], ['reports-shrinkage', '/reports?tab=shrinkage'],
  ['reports-z', '/reports?tab=z'], ['reports-tax', '/reports?tab=tax'],
  ['settings', '/settings'], ['settings-receipt', '/settings?tab=receipt'],
  ['settings-taxes', '/settings?tab=taxes'], ['settings-roles', '/settings?tab=roles'],
  ['settings-catalog', '/settings?tab=catalog'], ['devices', '/devices'], ['audit', '/audit'],
  ['stock-take-mode', '/stock-take-mode'],
  // v5
  ['quarantine', '/rfid/quarantine'], ['commissions', '/commissions'],
  ['commission-rules', '/commissions?tab=rules'],
  ['reports-deadstock', '/reports?tab=deadstock'],
  ['settings-features', '/settings?tab=features'],
  ['catalog-units', '/catalog-setup?tab=units'], ['catalog-bins', '/catalog-setup?tab=bins'],
  ['catalog-labels', '/catalog-setup?tab=labels'], ['catalog-lots', '/catalog-setup?tab=lots'],
  // v6 phase 2 + 3
  ['sales-orders', '/sales-orders?tab=orders'], ['services', '/services?tab=services'],
  ['warranty-check', '/services?tab=check'],
  ['requisitions', '/requisitions'],
  ['accounting-coa', '/accounting?tab=coa'], ['accounting-journal', '/accounting?tab=journal'],
  ['accounting-balance', '/accounting?tab=balance'], ['accounting-pl', '/accounting?tab=pl'],
  ['expenses-recurring', '/expenses?tab=recurring'],
  ['documents-layouts', '/documents?tab=layouts'], ['documents-templates', '/documents?tab=templates'],
  ['documents-settings', '/documents?tab=settings'], ['documents-log', '/documents?tab=log'],
];

const IGNORE = [/favicon/i, /ServiceWorker/i, /sw\.js/i, /React DevTools/i, /net::ERR_ABORTED/i];
const problems = [];

const b = await launchBrowser();
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
const p = await ctx.newPage();
let label = 'login';
p.on('pageerror', (e) => problems.push({ page: label, kind: 'crash', text: e.message }));
p.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (IGNORE.some((r) => r.test(m.text()))) return;
  problems.push({ page: label, kind: 'console', text: m.text() });
});
p.on('response', (r) => {
  if (r.status() >= 500 && r.url().includes('/api/'))
    problems.push({ page: label, kind: 'http', text: `${r.status()} ${r.url()}` });
});

await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await p.fill('input[type=email]', EMAIL);
await p.fill('input[type=password]', PASS);
await p.click('button:has-text("Sign in")');
await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

for (const [name, route] of PAGES) {
  label = name;
  await p.goto(BASE + route, { waitUntil: 'networkidle' });
  await p.waitForTimeout(450);
  const body = (await p.textContent('body')) || '';
  if (body.trim().length < 40)
    problems.push({ page: name, kind: 'blank', text: 'rendered nothing' });
  if (/Cannot read propert|is not a function|undefined is not|NaN\b/i.test(body))
    problems.push({ page: name, kind: 'error-text', text: 'error text visible on an empty shop' });
}

// A fresh shop must be able to create its first product.
label = 'first-product';
await p.goto(`${BASE}/products/new`, { waitUntil: 'networkidle' });
await p.waitForTimeout(500);
if (!(await p.locator('input').count()))
  problems.push({ page: 'first-product', kind: 'flow', text: 'no product form on a new install' });

await b.close();

console.log(`\nEmpty-shop check — ${PAGES.length} screens on a database with no business data`);
console.log('-'.repeat(64));
if (!problems.length) console.log('  Every screen renders cleanly with nothing in it.');
else problems.forEach((x) => console.log(`  [${x.kind}] ${x.page}: ${x.text.slice(0, 160)}`));
console.log('-'.repeat(64));
console.log(`${problems.length} problem(s)\n`);
process.exit(problems.length ? 1 : 0);
