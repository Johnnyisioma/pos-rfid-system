/**
 * Simulates what a UHF reader on continuous trigger actually does to the
 * handheld screen: a fast stream of reads, most of them re-reads of tags it
 * already saw. Asserts the screen keeps up and does not flood the server.
 */
import { launchBrowser } from './lib/browser.mjs';

const BASE = 'http://localhost:3000';
const b = await launchBrowser();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();

const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

let scanPosts = 0, codesSent = 0;
p.on('request', (r) => {
  if (r.url().includes('/scan') && r.method() === 'POST') {
    scanPosts += 1;
    try { codesSent += (JSON.parse(r.postData() || '{}').codes || []).length; } catch {}
  }
});

await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await p.fill('input[type=email]', 'admin@millzee.test');
await p.fill('input[type=password]', 'password123');
await p.click('button:has-text("Sign in")');
await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

// Grab real EPCs in stock at this location.
const epcs = await p.evaluate(async () => {
  const t = localStorage.getItem('pos.token');
  const loc = localStorage.getItem('pos.location');
  const r = await fetch('/api/rfid/units?status=in_stock&limit=25', {
    headers: { Authorization: `Bearer ${t}`, 'X-Location-Id': loc } }).then((x) => x.json());
  return (r.data || []).map((u) => u.epc);
});
console.log(`got ${epcs.length} real EPCs`);
if (epcs.length < 10) { console.log('FAIL: not enough stock to test'); process.exit(1); }

// Close any count left open by an earlier run, so this test starts clean.
await p.evaluate(async () => {
  const t = localStorage.getItem('pos.token');
  const loc = localStorage.getItem('pos.location');
  const h = { Authorization: `Bearer ${t}`, 'X-Location-Id': loc, 'Content-Type': 'application/json' };
  const list = await fetch('/api/rfid/stock-takes', { headers: h }).then((x) => x.json());
  for (const s of list.filter((x) => x.status === 'open')) {
    await fetch(`/api/rfid/stock-takes/${s.id}/cancel`, { method: 'POST', headers: h, body: '{}' });
  }
});

await p.goto(`${BASE}/stock-take-mode`, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);

const startBtn = p.locator('button:has-text("Start counting")');
if (await startBtn.count()) { await startBtn.click(); await p.waitForTimeout(1200); }

scanPosts = 0; codesSent = 0;

// The firehose: 20 unique tags, each read ~15 times, interleaved, ~4ms apart.
const stream = [];
for (let pass = 0; pass < 15; pass += 1) for (const e of epcs.slice(0, 20)) stream.push(e);
console.log(`streaming ${stream.length} reads (${new Set(stream).size} unique)`);

const t0 = Date.now();
for (const epc of stream) {
  await p.keyboard.type(epc, { delay: 0 });
  await p.keyboard.press('Enter');
}
const elapsed = Date.now() - t0;
await p.waitForTimeout(2500);

const body = await p.textContent('body');
const uniqueShown = (body.match(/(\d+)\s+unique/) || [])[1];

console.log(`\n--- results ---`);
console.log(`reads typed:        ${stream.length} in ${elapsed}ms`);
console.log(`unique tags:        ${new Set(stream).size}`);
console.log(`"unique" on screen: ${uniqueShown}`);
console.log(`POSTs to server:    ${scanPosts}`);
console.log(`codes sent:         ${codesSent}`);
console.log(`page errors:        ${errs.length}`);
if (errs.length) console.log(errs.slice(0, 5));

const overflow = await p.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log(`h-overflow:         ${overflow}px`);

const uniq = new Set(stream).size;
const fails = [];
if (Number(uniqueShown) !== uniq) fails.push(`unique shown ${uniqueShown} != ${uniq} (reads dropped or corrupted)`);
if (codesSent !== uniq) fails.push(`sent ${codesSent} codes, expected ${uniq} (dedupe not working)`);
if (scanPosts > 12) fails.push(`${scanPosts} POSTs for ${uniq} tags (not batching)`);
if (errs.length) fails.push(`${errs.length} page error(s)`);
if (overflow > 4) fails.push(`horizontal overflow ${overflow}px`);

console.log(fails.length ? `\nFAIL:\n  ${fails.join('\n  ')}` : '\nPASS');
await b.close();
process.exit(fails.length ? 1 : 0);
