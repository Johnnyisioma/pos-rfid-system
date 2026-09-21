/**
 * Headless UI smoke test: logs in, visits every screen, records console errors
 * and failed requests, and saves screenshots.
 *
 *   node scripts/ui-check.mjs [--shots]
 */
import { launchBrowser } from './lib/browser.mjs';
import fs from 'fs';
import path from 'path';

const BASE = process.env.BASE || 'http://localhost:3000';
const SHOT_DIR = process.env.SHOT_DIR || '/tmp/pos-shots';
const wantShots = process.argv.includes('--shots');

const PAGES = [
  ['dashboard', '/'],
  ['pos', '/pos'],
  ['products', '/products'],
  ['product-new', '/products/new'],
  ['import-export', '/import-export'],
  ['inventory', '/inventory'],
  ['purchases', '/purchases'],
  ['transfers', '/transfers'],
  ['rfid-units', '/rfid'],
  ['rfid-lookup', '/rfid/lookup'],
  ['rfid-stock-take', '/rfid/stock-take'],
  ['rfid-find', '/rfid/find'],
  ['customers', '/customers'],
  ['sales', '/sales'],
  ['returns', '/returns'],
  ['register', '/register'],
  ['expenses', '/expenses'],
  ['reports', '/reports'],
  ['settings', '/settings'],
  ['settings-receipt', '/settings?tab=receipt'],
  ['settings-locations', '/settings?tab=locations'],
  ['settings-users', '/settings?tab=users'],
  ['settings-catalog', '/settings?tab=catalog'],
  ['inventory-low', '/inventory?tab=low'],
  ['inventory-valuation', '/inventory?tab=valuation'],
  ['purchases-suppliers', '/purchases?tab=suppliers'],
  ['purchases-reorder', '/purchases?tab=reorder'],
  ['customers-groups', '/customers?tab=groups'],
  ['reports-pl', '/reports?tab=pl'],
  ['reports-tax', '/reports?tab=tax'],
  ['returns-history', '/returns?tab=history'],
  ['devices', '/devices'],
  ['audit', '/audit'],

  // --- screens added with the Ultimate-POS style menu ---
  ['accounts', '/accounts'],
  ['rfid-reader-test', '/rfid/reader-test'],
  ['rfid-tag-stock', '/rfid/tag-stock'],
  ['purchases-returns', '/purchases?tab=returns'],
  ['purchases-new', '/purchases?tab=new'],
  ['settings-taxes', '/settings?tab=taxes'],
  ['settings-roles', '/settings?tab=roles'],
  ['reports-z', '/reports?tab=z'],
  ['reports-payments', '/reports?tab=payments'],
  ['reports-aging', '/reports?tab=aging'],
  ['reports-contacts', '/reports?tab=contacts'],
  ['reports-shrinkage', '/reports?tab=shrinkage'],
  ['reports-purchase-sale', '/reports?tab=purchase-sale'],
  ['sales-held', '/sales?status=held'],
  ['sales-draft', '/sales?status=draft'],
  ['sales-quotation', '/sales?status=quotation'],
  ['sales-layaway', '/sales?sale_type=layaway'],
  ['sales-unpaid', '/sales?credit=true'],
  ['transfers-new', '/transfers?new=1'],
  ['expenses-new', '/expenses?new=1'],

  ['stock-take-mode', '/stock-take-mode'],

  // --- v5 ---
  ['quarantine', '/rfid/quarantine'],
  ['quarantine-all', '/rfid/quarantine?tab=all'],
  ['commissions', '/commissions'],
  ['commission-rules', '/commissions?tab=rules'],
  ['reports-deadstock', '/reports?tab=deadstock'],
  ['settings-features', '/settings?tab=features'],
  // v6 phase 1
  ['catalog-units', '/catalog-setup?tab=units'],
  ['catalog-tiers', '/catalog-setup?tab=tiers'],
  ['catalog-bins', '/catalog-setup?tab=bins'],
  ['catalog-labels', '/catalog-setup?tab=labels'],
  ['catalog-lots', '/catalog-setup?tab=lots'],
  // v6 phase 2
  ['sales-orders', '/sales-orders?tab=orders'],
  ['shipments', '/sales-orders?tab=shipments'],
  ['services', '/services?tab=services'],
  ['warranties', '/services?tab=warranties'],
  ['warranty-check', '/services?tab=check'],
  // v6 phase 3
  ['requisitions', '/requisitions'],
  ['accounting-coa', '/accounting?tab=coa'],
  ['accounting-journal', '/accounting?tab=journal'],
  ['accounting-trial', '/accounting?tab=trial'],
  ['accounting-balance', '/accounting?tab=balance'],
  ['accounting-pl', '/accounting?tab=pl'],
  ['expenses-recurring', '/expenses?tab=recurring'],
  // v6 phase 4
  ['documents-layouts', '/documents?tab=layouts'],
  ['documents-templates', '/documents?tab=templates'],
  ['documents-settings', '/documents?tab=settings'],
  ['documents-log', '/documents?tab=log'],
];

const IGNORE = [
  /favicon/i,
  /ServiceWorker/i,
  /sw\.js/i,
  /Download the React DevTools/i,
  /net::ERR_ABORTED/i,   // in-flight request cancelled by the next navigation
];

fs.mkdirSync(SHOT_DIR, { recursive: true });

const problems = [];

async function run() {
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();

  let currentLabel = 'startup';
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORE.some((r) => r.test(text))) return;
    problems.push({ page: currentLabel, kind: 'console', text });
  });
  page.on('pageerror', (err) => {
    problems.push({ page: currentLabel, kind: 'pageerror', text: err.message });
  });
  page.on('requestfailed', (req) => {
    const text = `${req.method()} ${req.url()} — ${req.failure()?.errorText}`;
    if (IGNORE.some((r) => r.test(text))) return;
    problems.push({ page: currentLabel, kind: 'requestfailed', text });
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && res.url().includes('/api/')) {
      problems.push({ page: currentLabel, kind: 'http', text: `${res.status()} ${res.url()}` });
    }
  });

  // --- login ---
  currentLabel = 'login';
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', 'admin@millzee.test');
  await page.fill('input[type=password]', 'password123');
  await page.click('button:has-text("Sign in")');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  if (wantShots) await page.screenshot({ path: path.join(SHOT_DIR, '00-login-done.png') });

  let i = 0;
  for (const [label, route] of PAGES) {
    i += 1;
    currentLabel = label;
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);

    const body = await page.textContent('body');
    if (!body || body.trim().length < 40) {
      problems.push({ page: label, kind: 'blank', text: 'Page rendered (almost) nothing' });
    }
    if (/Cannot read propert|is not a function|Unexpected token/i.test(body || '')) {
      problems.push({ page: label, kind: 'error-text', text: 'Error text visible on the page' });
    }
    if (wantShots) {
      await page.screenshot({
        path: path.join(SHOT_DIR, `${String(i).padStart(2, '0')}-${label}.png`),
        fullPage: label !== 'stock-take-mode',
      });
    }
  }

  // --- a real interaction pass on the till ---
  currentLabel = 'pos-interaction';
  await page.goto(`${BASE}/pos`, { waitUntil: 'networkidle' });
  await page.fill('input[placeholder*="Search"]', 'oxford');
  await page.waitForTimeout(900);
  const card = page.locator('button.card:not([disabled])').first();
  if (await card.count()) {
    await card.click();
    await page.waitForTimeout(400);
    const charge = page.locator('button:has-text("Charge")');
    if (await charge.count()) {
      await charge.click();
      await page.waitForTimeout(600);
      if (wantShots) await page.screenshot({ path: path.join(SHOT_DIR, '90-pos-payment.png') });
      const complete = page.locator('button:has-text("Complete")').first();
      if (await complete.count()) {
        await complete.click();
        await page.waitForTimeout(1500);
        const receiptVisible = await page.locator('#receipt').count();
        if (!receiptVisible) problems.push({ page: 'pos-interaction', kind: 'flow', text: 'No receipt after completing a sale' });
        if (wantShots) await page.screenshot({ path: path.join(SHOT_DIR, '91-pos-receipt.png') });
      } else {
        problems.push({ page: 'pos-interaction', kind: 'flow', text: 'Complete button not found' });
      }
    } else {
      problems.push({ page: 'pos-interaction', kind: 'flow', text: 'Charge button not found' });
    }
  } else {
    problems.push({ page: 'pos-interaction', kind: 'flow', text: 'No product results for "oxford"' });
  }

  // --- the new menu and top bar actually open ---
  currentLabel = 'menu-interaction';
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Every sidebar group should expand and reveal at least one link.
  const groupButtons = page.locator('nav button');
  const groupCount = await groupButtons.count();
  if (groupCount < 5) {
    problems.push({ page: 'menu-interaction', kind: 'menu',
      text: `Expected the grouped sidebar, found ${groupCount} group toggles` });
  }
  for (let g = 0; g < Math.min(groupCount, 14); g += 1) {
    const btn = groupButtons.nth(g);
    const name = (await btn.textContent())?.trim().slice(0, 30) || `group ${g}`;
    await btn.click();
    await page.waitForTimeout(140);
    const links = await page.locator('nav a').count();
    if (links === 0) {
      problems.push({ page: 'menu-interaction', kind: 'menu', text: `"${name}" revealed no links` });
    }
  }
  if (wantShots) await page.screenshot({ path: path.join(SHOT_DIR, '92-menu-open.png'), fullPage: true });

  // Every sidebar destination must resolve to a real screen, not the catch-all
  // redirect. A link the router does not know about is the classic symptom of
  // a menu rewritten ahead of the pages.
  const hrefs = await page.locator('nav a').evaluateAll((els) =>
    [...new Set(els.map((e) => e.getAttribute('href')).filter(Boolean))]);
  for (const href of hrefs) {
    if (!href.startsWith('/')) continue;
    currentLabel = `link${href}`;
    await page.goto(BASE + href, { waitUntil: 'networkidle' });
    await page.waitForTimeout(350);
    const landed = new URL(page.url()).pathname;
    const wanted = href.split('?')[0];
    if (landed !== wanted) {
      problems.push({ page: 'menu-links', kind: 'route',
        text: `${href} fell through to ${landed}` });
    }
  }

  // The calculator in the top bar is a real tool, not decoration.
  currentLabel = 'calculator';
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const calcBtn = page.locator('button[title*="alculator"]');
  if (await calcBtn.count()) {
    await calcBtn.first().click();
    await page.waitForTimeout(300);
    const dialog = await page.locator('text=/Calculator/i').count();
    if (!dialog) problems.push({ page: 'calculator', kind: 'flow', text: 'Calculator did not open' });
    if (wantShots) await page.screenshot({ path: path.join(SHOT_DIR, '93-calculator.png') });
    await page.keyboard.press('Escape');
  } else {
    problems.push({ page: 'calculator', kind: 'flow', text: 'No calculator button in the top bar' });
  }

  // The export toolbar must offer all three ways out.
  currentLabel = 'export-toolbar';
  await page.goto(`${BASE}/sales`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const exportBtn = page.locator('button:has-text("Export")').first();
  if (await exportBtn.count()) {
    await exportBtn.click();
    await page.waitForTimeout(250);
    for (const item of ['CSV', 'Excel', 'Print']) {
      if (!(await page.locator(`[role=menuitem]:has-text("${item}")`).count())) {
        problems.push({ page: 'export-toolbar', kind: 'flow', text: `No ${item} option in the export menu` });
      }
    }
    if (wantShots) await page.screenshot({ path: path.join(SHOT_DIR, '94-export-menu.png') });
    await page.keyboard.press('Escape');
  } else {
    problems.push({ page: 'export-toolbar', kind: 'flow', text: 'No export button on the sales list' });
  }

  /* --- the price cascade on the product editor ---
     Forty sizes of the same shoe are usually the same price. The awkward part
     is the one size that genuinely is not, so this checks both halves: that
     the bar sets every row, and that it leaves a row somebody priced
     differently alone when asked to. */
  currentLabel = 'variant-cascade';
  const editableId = await page.evaluate(async () => {
    const t = localStorage.getItem('pos.token');
    const l = localStorage.getItem('pos.location');
    const r = await fetch('/api/products?limit=20', {
      headers: { Authorization: `Bearer ${t}`, 'X-Location-Id': l } }).then((x) => x.json());
    const pick = (r.data || []).find((x) => Number(x.variant_count) > 3) || (r.data || [])[0];
    return pick?.id || null;
  });
  if (editableId) {
    await page.goto(`${BASE}/products/${editableId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);

    const cascade = page.locator('.bg-slate-50 input[type=number]');
    const rowPrices = () => page.evaluate(() =>
      [...document.querySelectorAll('td input[type=number]')]
        .map((e) => e.value).filter((_, i) => i % 2 === 1));

    if (await cascade.count() < 2) {
      problems.push({ page: 'variant-cascade', kind: 'flow', text: 'No price-for-all bar on the variants table' });
    } else {
      await cascade.nth(1).fill('5000');
      await page.click('button:has-text("Apply to")');
      await page.waitForTimeout(400);
      const flat = await rowPrices();
      if (new Set(flat).size !== 1 || flat[0] !== '5000') {
        problems.push({ page: 'variant-cascade', kind: 'flow',
          text: `Apply-to-all left ${new Set(flat).size} different prices` });
      }

      // One row priced differently is now an exception worth protecting.
      await page.locator('td input[type=number]').nth(1).fill('7777');
      await page.waitForTimeout(250);
      await cascade.nth(1).fill('9999');
      await page.waitForTimeout(250);
      await page.click('button:has-text("Apply to")');
      await page.waitForTimeout(400);
      const kept = await rowPrices();
      if (!kept.includes('7777')) {
        problems.push({ page: 'variant-cascade', kind: 'flow',
          text: 'The row priced differently was flattened instead of left alone' });
      }
      if (kept.filter((v) => v === '9999').length !== kept.length - 1) {
        problems.push({ page: 'variant-cascade', kind: 'flow',
          text: 'Apply-to-all did not set the remaining rows' });
      }
      if (wantShots) await page.screenshot({ path: path.join(SHOT_DIR, '95-variant-cascade.png') });
    }
    // Leave without saving — this pass must not rewrite the shop's prices.
  }

  // --- mobile viewport pass ---
  currentLabel = 'mobile';
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2,
  });
  const mp = await mobile.newPage();
  mp.on('pageerror', (err) => problems.push({ page: 'mobile', kind: 'pageerror', text: err.message }));
  await mp.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await mp.fill('input[type=email]', 'cashier@millzee.test');
  await mp.fill('input[type=password]', 'password123');
  await mp.click('button:has-text("Sign in")');
  await mp.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
  for (const [label, route] of [
    ['m-pos', '/pos'], ['m-stock-take-mode', '/stock-take-mode'], ['m-sales', '/sales'],
    ['m-dashboard', '/'], ['m-reports-z', '/reports?tab=z'], ['m-accounts', '/accounts'],
  ]) {
    currentLabel = label;
    await mp.goto(BASE + route, { waitUntil: 'networkidle' });
    await mp.waitForTimeout(600);
    const overflow = await mp.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 4) problems.push({ page: label, kind: 'layout', text: `Horizontal overflow of ${overflow}px` });
    if (wantShots) await mp.screenshot({ path: path.join(SHOT_DIR, `95-${label}.png`), fullPage: true });
  }

  // --- PWA manifest + icons ---
  currentLabel = 'pwa';
  for (const asset of ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/sw.js']) {
    const res = await page.request.get(BASE + asset);
    if (!res.ok()) problems.push({ page: 'pwa', kind: 'asset', text: `${asset} → ${res.status()}` });
  }

  await browser.close();

  const byPage = {};
  for (const p of problems) (byPage[p.page] ||= []).push(p);

  console.log(`\nUI check — ${PAGES.length} screens + interaction & mobile passes`);
  console.log('-'.repeat(64));
  if (!problems.length) {
    console.log('  No console errors, failed requests, blank screens or overflow found.');
  } else {
    for (const [pg, list] of Object.entries(byPage)) {
      console.log(`\n  ${pg}`);
      list.slice(0, 8).forEach((p) => console.log(`    [${p.kind}] ${p.text.slice(0, 220)}`));
      if (list.length > 8) console.log(`    …and ${list.length - 8} more`);
    }
  }
  console.log('-'.repeat(64));
  console.log(`${problems.length} problem(s)${wantShots ? `, screenshots in ${SHOT_DIR}` : ''}\n`);
  process.exit(problems.length ? 1 : 0);
}

run().catch((e) => { console.error('UI check crashed:', e); process.exit(2); });
