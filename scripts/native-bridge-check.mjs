/**
 * The Android bridge, without an Android device.
 *
 * In the app, tags do not arrive as typed characters — the Java side hears the
 * UHF app's broadcast and hands them to JavaScript as data. That path cannot
 * be exercised by typing, so this stands a fake bridge in front of the app:
 * same method names, same event names, same shapes the Java side sends.
 *
 * It runs TWICE, because there are two Android builds and they present the
 * reader completely differently:
 *
 *   shell      android-native/ — a plain WebView app with a
 *              JavascriptInterface. Synchronous, strings only, no listener
 *              mechanism: the Java side pushes events by calling a global.
 *   capacitor  android-app/ — a Capacitor plugin. Promises, and addListener
 *              returning a removable handle.
 *
 * Testing only one of them is how the other quietly stops working.
 *
 * It proves three things that decide whether the APK is worth building:
 *
 *   1. The app detects the native reader and offers to start and stop it —
 *      the thing a browser can never do, and the reason for the APK.
 *   2. A broadcast tag reaches the till, the stock take and the diagnostics
 *      with no focused field and no Enter key anywhere.
 *   3. Starting a sweep actually calls through to the plugin, rather than
 *      only flipping a label on screen.
 *
 * It does NOT prove the Java compiles or that com.seuic.uhftool answers — only
 * a device can. It proves everything on this side of the bridge.
 */
import { launchBrowser } from './lib/browser.mjs';

const BASE = process.env.BASE || 'http://localhost:3000';

const MODE = process.env.BRIDGE || 'both';
const fails = [];
let mode = 'shell';
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  [${mode}] ${name}${cond ? '' : `  ${extra}`}`);
  if (!cond) fails.push(`${mode}: ${name}`);
};

const browser = await launchBrowser();

for (const thisMode of (MODE === 'both' ? ['shell', 'capacitor'] : [MODE])) {
mode = thisMode;
console.log(`\n--- ${mode} ---`);
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true });

/*
  Stand in for the plugin before a single line of app code runs.

  Mirrors RfidPlugin exactly: available/configure/startListening/startScan/
  stopScan/setReaderSetting, an addListener that returns something with
  remove(), and a __fire helper so the test can act as the broadcast receiver.
*/
await ctx.addInitScript(({ base, shape }) => {
  const calls = [];
  window.__rfidCalls = calls;

  const info = {
    available: true, platform: 'android', model: 'AUTOID-Pad',
    manufacturer: 'SEUIC', androidSdk: 33, listening: true, scanning: false,
    action: 'com.android.server.scannerservice.broadcast',
    dataKey: 'scannerdata', uhfAppInstalled: true,
  };

  if (shape === 'shell') {
    /*
      android-native/ — a JavascriptInterface. Synchronous, strings only, and
      no listener mechanism: the Java side pushes events by calling
      window.__posRfidEvent, which the app installs for itself.
    */
    window.PosRfid = {
      available: () => JSON.stringify({ ...info, shell: 'native' }),
      configure: (json) => { calls.push(['configure', JSON.parse(json || '{}')]); },
      startListening: () => { calls.push(['startListening']); },
      stopListening: () => { calls.push(['stopListening']); },
      startScan: () => { calls.push(['startScan']); },
      stopScan: () => { calls.push(['stopScan']); },
      setReaderSetting: (k, v) => { calls.push(['setReaderSetting', { key: k, value: v }]); },
      resetDedupe: () => { calls.push(['resetDedupe']); },
      vibrate: () => {},
      getServerUrl: () => base,
      changeServer: () => { calls.push(['changeServer']); },
    };
    window.__fireTag = (code) => window.__posRfidEvent && window.__posRfidEvent('tag',
      JSON.stringify({ code, source: 'broadcast', at: Date.now(),
        action: 'com.android.server.scannerservice.broadcast' }));
    window.__listenerCount = () =>
      (window.__posRfidListeners && window.__posRfidListeners.tag.size) || 0;
    return;
  }

  /* android-app/ — a Capacitor plugin. Promises and removable handles. */
  const listeners = {};
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: {
      Rfid: {
        available: async () => info,
        configure: async (o) => { calls.push(['configure', o]); return o; },
        startListening: async () => { calls.push(['startListening']); return { listening: true }; },
        stopListening: async () => { calls.push(['stopListening']); return { listening: false }; },
        startScan: async () => { calls.push(['startScan']); return { scanning: true }; },
        stopScan: async () => { calls.push(['stopScan']); return { scanning: false }; },
        setReaderSetting: async (o) => { calls.push(['setReaderSetting', o]); return { sent: true }; },
        resetDedupe: async () => { calls.push(['resetDedupe']); },
        addListener: (event, cb) => {
          (listeners[event] ||= []).push(cb);
          const handle = { remove: () => { listeners[event] = (listeners[event] || []).filter((f) => f !== cb); } };
          return Object.assign(Promise.resolve(handle), handle);
        },
      },
    },
  };
  window.__fireTag = (code) => {
    (listeners.tag || []).forEach((cb) => cb({
      code, source: 'broadcast', at: Date.now(),
      action: 'com.android.server.scannerservice.broadcast',
    }));
  };
  window.__listenerCount = () => (listeners.tag || []).length;

  // The Capacitor build serves its own assets, so it has to be told the
  // server once. The shell loads the live site and never asks.
  try { localStorage.setItem('pos.serverUrl', base); } catch { /* private mode */ }
}, { base: BASE, shape: thisMode });

const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

/*
  The Capacitor build ships relative asset paths and therefore hash routes.
  The shell loads the live site, so it routes by path like any browser. Same
  app, two URL shapes.
*/
const go = async (route) => {
  const url = mode === 'capacitor' ? `${BASE}/#${route}` : `${BASE}${route}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
};

await go('/login');
ok('the app does not ask for a server when it already has one',
  !(await page.textContent('body')).includes('Connect to your shop'));

await page.fill('input[type=email]', 'admin@millzee.test');
await page.fill('input[type=password]', 'password123');
await page.click('button:has-text("Sign in")');
await page.waitForTimeout(2500);
ok('routing matches the build',
  mode === 'capacitor' ? page.url().includes('#/') : !page.url().includes('#/'), page.url());

/* ---------- real tags to fire ---------- */
const epcs = await page.evaluate(async () => {
  const t = localStorage.getItem('pos.token');
  const l = localStorage.getItem('pos.location');
  const r = await fetch('/api/rfid/units?status=in_stock&limit=8', {
    headers: { Authorization: `Bearer ${t}`, 'X-Location-Id': l } }).then((x) => x.json());
  return (r.data || []).map((u) => u.epc);
});
if (epcs.length < 4) { console.log('FAIL: not enough tagged stock to test'); process.exit(1); }

/* ---------- 1. the diagnostics screen ---------- */
await go('/rfid/reader-test');
let body = await page.textContent('body');
ok('the handheld is detected and described', /Handheld reader/i.test(body));
ok('it reports the broadcast it is listening for',
  body.includes('com.android.server.scannerservice.broadcast'));
ok('and whether the UHF app is installed', /installed/i.test(body));

await page.evaluate(() => { window.__rfidCalls.length = 0; });
await page.click('button:has-text("Sweep")');
await page.waitForTimeout(500);
let calls = await page.evaluate(() => window.__rfidCalls.map((c) => c[0]));
ok('pressing Sweep starts the radio, not just the label', calls.includes('startScan'),
  JSON.stringify(calls));

await page.evaluate((e) => window.__fireTag(e), epcs[0]);
await page.waitForTimeout(1600);
body = await page.textContent('body');
ok('a broadcast tag is captured with no field focused', body.includes(epcs[0]));
ok('and is reported as arriving by broadcast', /broadcast/i.test(body));

// Region is the setting that decides whether the radio is legal here.
await page.evaluate(() => { window.__rfidCalls.length = 0; });
await page.selectOption('select', { index: 1 }).catch(() => {});
await page.waitForTimeout(400);
calls = await page.evaluate(() => window.__rfidCalls.filter((c) => c[0] === 'setReaderSetting'));
ok('changing the region pushes it to the reader', calls.length > 0, JSON.stringify(calls));

/* ---------- 2. the till ---------- */
await go('/pos');
ok('the till offers a sweep instead of a scan dialog',
  (await page.locator('button:has-text("Sweep")').count()) > 0);

await page.evaluate(() => { window.__rfidCalls.length = 0; });
await page.click('button:has-text("Sweep")');
await page.waitForTimeout(400);
calls = await page.evaluate(() => window.__rfidCalls.map((c) => c[0]));
ok('sweeping at the till starts the radio', calls.includes('startScan'), JSON.stringify(calls));

// A whole basket at once — the thing a barcode scanner cannot do.
for (const e of epcs.slice(0, 3)) {
  await page.evaluate((x) => window.__fireTag(x), e);
  await page.waitForTimeout(500);
}
// Re-reads of the same tags, which is what a reader in the field actually does.
for (const e of epcs.slice(0, 3)) {
  await page.evaluate((x) => window.__fireTag(x), e);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(1500);

// Count the cart rows themselves. Asserting that a Charge button exists proves
// nothing — it is on the screen before anything is scanned.
const cartLines = await page.evaluate(() => {
  const qty = [...document.querySelectorAll('input')]
    .filter((el) => el.type === 'number' || /^\d+$/.test(el.value || ''));
  return qty.length;
});
body = await page.textContent('body');
ok('a swept basket lands in the cart', cartLines >= 3, `${cartLines} cart line(s)`);
ok('re-reading the same tags does not add them twice', cartLines === 3,
  `${cartLines} lines from 3 distinct tags read twice each`);

/* ---------- 3. the stock take ---------- */
await page.evaluate(async () => {
  const t = localStorage.getItem('pos.token');
  const l = localStorage.getItem('pos.location');
  const h = { Authorization: `Bearer ${t}`, 'X-Location-Id': l, 'Content-Type': 'application/json' };
  const list = await fetch('/api/rfid/stock-takes', { headers: h }).then((x) => x.json());
  for (const s of list.filter((x) => x.status === 'open')) {
    await fetch(`/api/rfid/stock-takes/${s.id}/cancel`, { method: 'POST', headers: h, body: '{}' });
  }
});

await go('/stock-take-mode');
const startBtn = page.locator('button:has-text("Start counting")');
if (await startBtn.count()) { await startBtn.click(); await page.waitForTimeout(1400); }

body = await page.textContent('body');
ok('the stock take offers a continuous sweep on the handheld',
  /Sweep continuously/i.test(body), body.slice(0, 200));

await page.evaluate(() => { window.__rfidCalls.length = 0; });
await page.click('button:has-text("Sweep continuously")');
await page.waitForTimeout(400);
calls = await page.evaluate(() => window.__rfidCalls.map((c) => c[0]));
ok('it starts the radio rather than waiting for a trigger', calls.includes('startScan'),
  JSON.stringify(calls));

for (const e of epcs.slice(0, 5)) {
  await page.evaluate((x) => window.__fireTag(x), e);
  await page.waitForTimeout(80);
}
// The same five again, the way a reader re-reads whatever stays in its field.
for (let i = 0; i < 6; i += 1) {
  for (const e of epcs.slice(0, 5)) {
    await page.evaluate((x) => window.__fireTag(x), e);
  }
}
await page.waitForTimeout(2500);
body = await page.textContent('body');
const unique = Number((body.match(/(\d+)\s+unique/) || [])[1]);
ok('broadcast reads are counted', unique === 5, `saw ${unique} unique, expected 5`);

/* ---------- 4. leaving the screen releases the radio ----------
   Navigated from INSIDE the app, not with page.goto. A full page load would
   tear the document down and take the call log with it, which proves nothing
   about whether the screen released the radio on its way out. */
await page.evaluate(() => { window.__rfidCalls.length = 0; });
await page.click('button[aria-label="Close stock take"]');
await page.waitForTimeout(800);
calls = await page.evaluate(() => window.__rfidCalls.map((c) => c[0]));
ok('leaving a scanning screen stops the radio',
  calls.includes('stopScan') || calls.includes('stopListening'), JSON.stringify(calls));
const remaining = await page.evaluate(() => window.__listenerCount());
ok('and removes its listener rather than leaking one', remaining === 0, String(remaining));

ok('no page errors anywhere', errs.length === 0, errs.slice(0, 3).join(' | '));

await ctx.close();
}

await browser.close();
console.log(fails.length
  ? `\n${fails.length} native-bridge check(s) failed:\n  ${fails.join('\n  ')}\n`
  : '\nBoth Android bridges work end to end on this side of the JNI boundary\n');
process.exit(fails.length ? 1 : 0);
