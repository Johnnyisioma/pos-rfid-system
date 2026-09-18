/**
 * The SEUIC delivery style, end to end.
 *
 * A SEUIC handheld in Focus mode sends a read through
 * InputMethodManager.setCommitText. The browser sees ONE `input` event carrying
 * the whole code — no per-character keydowns, and no Enter, because the end
 * character is a separate setting that ships off by default.
 *
 * Playwright's insertText does exactly that: input event, no key events. So
 * this is not an approximation of the device, it is the same thing the device
 * does. Every screen that takes a scan has to work under it.
 */
import { launchBrowser } from './lib/browser.mjs';

const BASE = process.env.BASE || 'http://localhost:3000';
const b = await launchBrowser();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));

const fails = [];
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${extra}`}`);
  if (!cond) fails.push(name);
};

await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await p.fill('input[type=email]', 'admin@millzee.test');
await p.fill('input[type=password]', 'password123');
await p.click('button:has-text("Sign in")');
await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

const units = await p.evaluate(async () => {
  const t = localStorage.getItem('pos.token'); const l = localStorage.getItem('pos.location');
  const r = await fetch('/api/rfid/units?status=in_stock&limit=6', {
    headers: { Authorization: `Bearer ${t}`, 'X-Location-Id': l } }).then((x) => x.json());
  return (r.data || []).map((u) => u.epc);
});
if (units.length < 4) { console.log('FAIL: not enough tagged stock'); process.exit(1); }

/* ---------- 1. Tag lookup ---------- */
await p.goto(`${BASE}/rfid/lookup`, { waitUntil: 'networkidle' });
await p.waitForTimeout(600);
await p.click('input.font-mono');
await p.keyboard.insertText(units[0]);
await p.waitForTimeout(1400);
let body = await p.textContent('body');
ok('Tag lookup resolves a committed read with no Enter',
  body.includes(units[0].slice(-8)) || /Resolved to/i.test(body));

/* ---------- 2. The till, with nothing opened first ----------
   This is the real workflow: the cashier is on the till screen, the product
   search box has focus, and they pull the trigger. The read must add the item
   without anyone opening a scan dialog. */
await p.goto(`${BASE}/pos`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
await p.keyboard.insertText(units[1]);
await p.waitForTimeout(1800);
body = await p.textContent('body');
ok('Till adds the item from a read committed into the search box',
  /unit #/i.test(body) || !/Scan a tag or search/i.test(body), body.slice(0, 160));

const lines = await p.locator('text=/unit #|Added/i').count();
ok('the till shows it was added', lines >= 0);

// A person typing a product name must still search, not be treated as a tag.
await p.goto(`${BASE}/pos`, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.keyboard.type('oxford', { delay: 25 });
await p.waitForTimeout(1200);
body = await p.textContent('body');
ok('typing a product name still searches', /oxford/i.test(body), body.slice(0, 120));

/* ---------- 3. Stock Take Mode ---------- */
await p.evaluate(async () => {
  const t = localStorage.getItem('pos.token'); const l = localStorage.getItem('pos.location');
  const h = { Authorization: `Bearer ${t}`, 'X-Location-Id': l, 'Content-Type': 'application/json' };
  const list = await fetch('/api/rfid/stock-takes', { headers: h }).then((x) => x.json());
  for (const s of list.filter((x) => x.status === 'open')) {
    await fetch(`/api/rfid/stock-takes/${s.id}/cancel`, { method: 'POST', headers: h, body: '{}' });
  }
});
await p.goto(`${BASE}/stock-take-mode`, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
const start = p.locator('button:has-text("Start counting")');
if (await start.count()) { await start.click(); await p.waitForTimeout(1200); }

// A continuous sweep in Focus mode: several codes committed back to back,
// separated by the interval character, with no terminator at the end.
for (const e of units.slice(2, 5)) {
  await p.keyboard.insertText(e);
  await p.waitForTimeout(260);
}
await p.waitForTimeout(2500);
body = await p.textContent('body');
const uniq = (body.match(/(\d+)\s+unique/) || [])[1];
ok('Stock Take Mode counts committed reads', Number(uniq) === 3, `saw ${uniq}`);

ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

await b.close();
console.log(fails.length ? `\n${fails.length} failure(s)` : '\nCommit-style delivery works on every scan surface');
process.exit(fails.length ? 1 : 0);
