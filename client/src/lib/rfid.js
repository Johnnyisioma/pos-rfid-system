/**
 * One way in for every RFID read, whichever way it physically arrives.
 *
 * There are three delivery mechanisms in play and a shop should never have to
 * care which one is running:
 *
 *   native broadcast   The Android app hears com.seuic.uhftool directly. Tags
 *                      arrive as data, addressed to this app, with no focused
 *                      input involved. This is the good one, and it comes in
 *                      two shapes — the plain WebView shell in android-native/
 *                      and the Capacitor plugin in android-app/ — which
 *                      nativeReader() normalises into one interface.
 *
 *   commit             The UHF app's "Focus" mode calls a hidden
 *                      InputMethodManager.setCommitText(). The browser sees an
 *                      `input` event with no keydowns and no Enter, so a read
 *                      is only "finished" after a pause.
 *
 *   keystrokes         Classic keyboard wedge: real key events, usually ending
 *                      in Enter. What most barcode scanners do.
 *
 * subscribe() below picks the native path when it exists and falls back to
 * watching the document otherwise. Callers get a string per tag either way.
 */

import { isNative } from './platform.js';

/** How long a pause means "that code has finished arriving". */
const IDLE_MS = 220;

/** Anything shorter than this was a stray keypress, not a tag. */
const MIN_CODE_LEN = 6;

/**
 * The Capacitor plugin, when the app was built with Android Studio.
 * Promise-based, with addListener returning a removable handle.
 */
const capacitorPlugin = () => {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  return (isNative() && cap?.Plugins?.Rfid) || null;
};

/**
 * The plain WebView shell's bridge.
 *
 * A JavascriptInterface is synchronous and can only pass strings, and it has
 * no listener mechanism at all — the Java side pushes events by calling
 * window.__posRfidEvent. This adapter gives it the same shape as the Capacitor
 * plugin so nothing above here has to know which app it is running in.
 */
const shellPlugin = () => {
  const b = typeof window !== 'undefined' ? window.PosRfid : null;
  if (!b) return null;

  // One dispatcher for the whole page, installed the first time it is needed.
  if (!window.__posRfidEvent) {
    const handlers = { tag: new Set(), state: new Set(), triggerKey: new Set() };
    window.__posRfidListeners = handlers;
    window.__posRfidEvent = (type, json) => {
      let payload = {};
      try { payload = JSON.parse(json); } catch { payload = { raw: json }; }
      (handlers[type] || []).forEach((fn) => {
        // One screen's handler throwing must not stop the others receiving
        // the same tag — a stock take mid-sweep cannot afford that.
        try { fn(payload); } catch (e) { console.error('[rfid]', type, e); }
      });
    };
  }

  const on = (event, cb) => {
    const set = window.__posRfidListeners[event];
    if (!set) return Promise.resolve({ remove() {} });
    set.add(cb);
    const handle = { remove: () => set.delete(cb) };
    return Object.assign(Promise.resolve(handle), handle);
  };

  return {
    kind: 'shell',
    available: async () => {
      try { return JSON.parse(b.available()); } catch { return { available: true }; }
    },
    configure: async (o) => { b.configure(JSON.stringify(o || {})); return o || {}; },
    startListening: async () => { b.startListening(); return { listening: true }; },
    stopListening: async () => { b.stopListening(); return { listening: false }; },
    startScan: async () => { b.startScan(); return { scanning: true }; },
    stopScan: async () => { b.stopScan(); return { scanning: false }; },
    setReaderSetting: async ({ key, value }) => { b.setReaderSetting(key, String(value)); return { sent: true }; },
    resetDedupe: async () => { b.resetDedupe(); },
    addListener: on,
  };
};

/**
 * Whichever native reader this build has, or null in a browser.
 *
 * Deliberately NOT gated on isNative(): the shell loads the shop's live site,
 * so as far as the page is concerned it is an ordinary browser that happens to
 * have a radio attached. Tying "has a reader" to "is a Capacitor app" would
 * hide the reader from the very build that has one.
 */
const plugin = () => shellPlugin() || capacitorPlugin();

export const hasNativeReader = () => Boolean(plugin());

/** What the device says about itself. Null in a browser. */
export async function readerInfo() {
  const p = plugin();
  if (!p) return null;
  try { return await p.available(); } catch { return null; }
}

/** Tell the UHF app which intent strings this shop uses. */
export async function configureReader(opts) {
  const p = plugin();
  if (!p) return null;
  try { return await p.configure(opts || {}); } catch { return null; }
}

/** Start the radio from software — the thing a browser could never do. */
export async function startScan() {
  const p = plugin();
  if (!p) return false;
  try { await p.startScan(); return true; } catch { return false; }
}

export async function stopScan() {
  const p = plugin();
  if (!p) return false;
  try { await p.stopScan(); return true; } catch { return false; }
}

/** Push power/region/beep into the UHF app. */
export async function setReaderSetting(key, value) {
  const p = plugin();
  if (!p) return false;
  try { await p.setReaderSetting({ key, value: String(value) }); return true; } catch { return false; }
}

/**
 * Region and power for this shop.
 *
 * These handhelds leave the factory on FCC 902–928 MHz at 33 dBm. Nigeria's
 * RAIN RFID allocation is 865.6–867.6 MHz, 2 W ERP — the ETSI band. On the
 * wrong band the radio is both unlicensed and bad at its job, because the tags
 * are tuned for the band it is not using.
 */
export async function applyRegionSettings({ region = 'ETSI_NG', power = 26 } = {}) {
  if (!hasNativeReader()) return false;
  const band = region === 'FCC' ? '2' : '1';   // 1 = ETSI 865–868, 2 = FCC 902–928
  await setReaderSetting('region', band);
  await setReaderSetting('power', String(Math.max(5, Math.min(30, Number(power) || 26))));
  return true;
}

/**
 * Does this look like something a reader produced, rather than something a
 * person typed? Used to tell a scan apart from a search term on screens where
 * one text box serves both.
 */
export function looksLikeTag(raw) {
  const v = String(raw || '').trim();
  if (v.length < MIN_CODE_LEN) return false;
  const hex = v.replace(/^epc[:=]/i, '').replace(/[\s:\-_.]/g, '');
  // A Gen2 EPC: an even number of hex characters, 64 to 496 bits.
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length >= 16 && hex.length <= 62 && hex.length % 2 === 0) return true;
  // One of our own printed labels: SKU segments then a serial.
  return /^[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{4,}$/i.test(v);
}

/**
 * Subscribe to tag reads.
 *
 *   onTag(code, meta)  called once per tag
 *   options.autoStart  ask the radio to start sweeping immediately (native)
 *   options.dedupeMs   suppress a repeat of the same tag for this long
 *   options.wedge      false to ignore keyboard/commit delivery entirely
 *
 * Returns an unsubscribe function. Always call it — a screen that stays
 * subscribed after unmounting will keep adding tags to a cart nobody is
 * looking at.
 */
export function subscribe(onTag, options = {}) {
  const {
    autoStart = false,
    dedupeMs = 0,
    wedge = true,
    onState = null,
    onTrigger = null,
  } = options;

  let dead = false;
  const cleanups = [];
  const emit = (code, meta) => {
    if (dead) return;
    const clean = String(code || '').trim();
    if (clean.length < MIN_CODE_LEN) return;
    onTag(clean, meta || {});
  };

  // ---- native path ----
  const p = plugin();
  if (p) {
    p.configure({ dedupeMs }).catch(() => {});
    const handles = [];
    handles.push(p.addListener('tag', (e) => emit(e?.code, { via: 'broadcast', rssi: e?.rssi })));
    if (onState) handles.push(p.addListener('state', (e) => onState(e || {})));
    if (onTrigger) handles.push(p.addListener('triggerKey', (e) => onTrigger(e || {})));
    p.startListening().catch(() => {});
    if (autoStart) p.startScan().catch(() => {});

    cleanups.push(async () => {
      for (const h of handles) {
        try { (await h)?.remove?.(); } catch { /* listener already gone */ }
      }
      if (autoStart) p.stopScan().catch(() => {});
      p.stopListening().catch(() => {});
    });
  }

  // ---- browser path: keystrokes and commits ----
  // Kept alongside the native path rather than instead of it, because a shop
  // may run the APK against a different handheld, or plug a USB scanner into a
  // tablet. Duplicate delivery of the same tag is handled by the caller's own
  // de-duplication, which every scan screen has anyway.
  if (wedge && typeof document !== 'undefined') {
    // There are two places a read can accumulate and they must never both be
    // treated as the answer:
    //
    //   the capture field   when it has focus, the characters land in its
    //                       .value — whether they arrived as keystrokes or as
    //                       one committed string. The field is the read.
    //   keyBuffer           when nothing is focused, there is no field to land
    //                       in, so the keydowns themselves are the read.
    //
    // Reading both and picking whichever fired last is how an EPC turns into
    // its own last character.
    let keyBuffer = '';
    let keyCount = 0;
    let timer = null;

    const isCapture = (el) => Boolean(el) && el.dataset?.scanCapture !== undefined;

    const flush = (forced) => {
      clearTimeout(timer);
      timer = null;

      const el = document.activeElement;
      let text = '';
      if (isCapture(el) && el.value) {
        text = el.value;
        el.value = '';
      } else {
        text = keyBuffer;
      }
      const keys = keyCount;
      keyBuffer = '';
      keyCount = 0;
      if (!text) return;

      // A burst can carry several tags separated by the reader's interval
      // character. One burst is not necessarily one tag.
      const via = forced || (keys >= Math.max(1, text.length * 0.6) ? 'keystrokes' : 'commit');
      for (const part of text.split(/[\s,;\r\n\u0000\t]+/)) {
        if (part) emit(part, { via });
      }
    };

    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => flush(), IDLE_MS);
    };

    const onKeyDown = (e) => {
      const el = document.activeElement;

      // Let a person type into a form in peace. A reader fires into whatever
      // has focus, so a screen using this path keeps its own hidden capture
      // field focused; if something else is focused, the user is typing.
      if (el && !isCapture(el) && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '')) return;

      if (e.key === 'Enter' || e.key === 'Tab') {
        const hasSomething = keyBuffer || (isCapture(el) && el.value);
        if (hasSomething) { e.preventDefault(); flush('keystrokes'); }
        return;
      }
      if (e.key.length !== 1) return;

      keyCount += 1;
      // Only buffer the character ourselves when there is no field catching
      // it. Doing both is the bug this comment exists to prevent.
      if (!isCapture(el)) keyBuffer += e.key;
      arm();
    };

    // Focus mode commits text without firing a single key event, so `input` on
    // the capture field is the only signal that anything arrived.
    const onInput = (e) => {
      if (!isCapture(e.target)) return;
      arm();
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('input', onInput, true);
    cleanups.push(() => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('input', onInput, true);
    });
  }

  return () => {
    dead = true;
    cleanups.forEach((fn) => { try { fn(); } catch { /* nothing to undo */ } });
  };
}
