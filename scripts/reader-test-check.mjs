/**
 * Drives the Reader test page the three ways a real reader misbehaves, and
 * asserts it gives the right diagnosis for each. The whole point of that page
 * is to tell these apart, so if it can't, it is worse than useless.
 */
import { launchBrowser } from './lib/browser.mjs';

const BASE = process.env.BASE || 'http://localhost:3000';
const b = await launchBrowser();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await p.fill('input[type=email]', 'admin@millzee.test');
await p.fill('input[type=password]', 'password123');
await p.click('button:has-text("Sign in")');
await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

const units = await p.evaluate(async () => {
  const t = localStorage.getItem('pos.token');
  const loc = localStorage.getItem('pos.location');
  const r = await fetch('/api/rfid/units?status=in_stock&limit=4', {
    headers: { Authorization: `Bearer ${t}`, 'X-Location-Id': loc } }).then((x) => x.json());
  return (r.data || []).map((u) => ({ epc: u.epc, readable: u.epc_readable }));
});
if (units.length < 2) { console.log('FAIL: not enough tagged stock'); process.exit(1); }

const fails = [];
const go = async () => {
  await p.goto(`${BASE}/rfid/reader-test`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
};
const check = async (name, expect) => {
  await p.waitForTimeout(1400);
  const body = await p.textContent('body');
  const hit = body.includes(expect);
  console.log(`${hit ? 'PASS' : 'FAIL'}  ${name}`);
  if (!hit) fails.push(`${name}: expected "${expect}"`);
};

// 1. Nothing at all — reader still on Broadcast, or not sending to the field.
await go();
await check('idle state points at the Send Mode setting', 'Send Mode');

// 2. THE REAL DEVICE CASE. A SEUIC handheld in Focus mode delivers through
// InputMethodManager.setCommitText: the browser sees one input event with the
// whole code and NO keydowns and NO Enter. insertText reproduces exactly that.
// An earlier build only listened for keydown, so this arrived as silence and
// the page wrongly reported the reader as not working at all.
await go();
await p.keyboard.insertText(units[0].epc);
await check('a committed read (no keystrokes, no Enter) is captured', units[0].epc.slice(0, 12));
await check('a committed read is reported as working', 'working end to end');
await check('the delivery style is named', 'text commit');

// A committed read of a well-formed but unregistered tag must be blamed on the
// tag, never on the reader — the reader did its job.
await go();
await p.keyboard.insertText('AAAA1111BBBB2222CCCC3333');
await check('a committed but unregistered tag is not blamed on the reader', 'not in the system');
await check('…and its delivery style is still reported', 'text commit');

// 3. A good read, terminated, that matches a real unit.
await go();
await p.keyboard.type(units[0].epc, { delay: 0 });
await p.keyboard.press('Enter');
await check('a valid terminated EPC reports working end to end', 'Reader is working end to end');

// 4. Typed character by character with no terminator — also fine.
await go();
await p.keyboard.type(units[1].epc, { delay: 0 });
await check('keystroke delivery with no Enter still resolves the unit', 'working end to end');

// 5. Wrong bank — TID rather than EPC.
await go();
await p.keyboard.type('E28011700000020F9A1B2C3D4E5F60718293A4B5', { delay: 0 });
await p.keyboard.press('Enter');
await check('an over-long hex code is called out as the wrong memory bank', 'not in a format this system knows');
await check('the fix names the actual SEUIC settings', 'Data start');

// 6. The printed label is recognised as naming the same unit.
await go();
await p.keyboard.type(units[0].readable, { delay: 0 });
await p.keyboard.press('Enter');
await check('the printed label is recognised', 'Printed label');

// 7. A well-formed EPC that simply is not registered here.
await go();
await p.keyboard.type('AAAA1111BBBB2222CCCC3333', { delay: 0 });
await p.keyboard.press('Enter');
await check('an unregistered but valid tag is not blamed on the reader', 'not in the system');

// 8. Copy diagnostics must produce something pasteable.
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
await p.click('button:has-text("Copy diagnostics")');
await p.waitForTimeout(400);
const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
const clipOk = clip.includes('Reader test') && clip.includes('diagnosis:');
console.log(`${clipOk ? 'PASS' : 'FAIL'}  diagnostics copy to clipboard`);
if (!clipOk) fails.push('clipboard report empty or malformed');

if (errs.length) { fails.push(`${errs.length} page error(s)`); console.log(errs.slice(0, 4)); }
console.log(`\n${fails.length ? `FAIL:\n  ${fails.join('\n  ')}` : 'All reader-test diagnoses correct'}`);
await b.close();
process.exit(fails.length ? 1 : 0);
