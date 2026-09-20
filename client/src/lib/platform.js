/**
 * Where is this copy of the app running, and where does its server live?
 *
 * Three answers, and the app has to get this right before its first request:
 *
 *   browser, served by the POS server  → same origin, relative URLs, done
 *   browser, served from anywhere else → same as above unless told otherwise
 *   Android APK (Capacitor)            → the page is served from inside the
 *                                        APK at http://localhost, which is the
 *                                        phone, not the shop's server. Every
 *                                        relative /api call would 404 against
 *                                        the app's own bundle.
 *
 * So the APK has to be told its server's address once, on first launch, and
 * remember it. That is the whole reason ServerSetup exists.
 */

const KEY = 'pos.serverUrl';

/** True when running inside the Capacitor shell rather than a browser tab. */
export function isNative() {
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor;
  if (cap && typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
  return /^capacitor:/.test(window.location.protocol);
}

export function nativePlatform() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  return (cap && cap.getPlatform && cap.getPlatform()) || 'web';
}

/** Normalise whatever the user typed into a usable origin. */
export function normalizeServerUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export const getServerUrl = () => {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
};

export const setServerUrl = (url) => {
  try {
    const clean = normalizeServerUrl(url);
    if (clean) localStorage.setItem(KEY, clean);
    else localStorage.removeItem(KEY);
    return clean;
  } catch { return ''; }
};

/**
 * The prefix every API path gets.
 *
 * Empty string in a browser — relative URLs are correct there and survive the
 * shop moving to a different domain. A stored origin in the APK.
 */
export function apiBase() {
  const stored = getServerUrl();
  if (stored) return stored;
  if (isNative()) return '';          // not configured yet — ServerSetup takes over
  return '';                          // browser: same origin
}

/** Has the app got enough information to talk to a server at all? */
export function needsServerSetup() {
  return isNative() && !getServerUrl();
}

/** Ask a candidate server whether it is in fact a POS server. */
export async function probeServer(url, { timeoutMs = 8000 } = {}) {
  const base = normalizeServerUrl(url);
  if (!base) throw new Error('That does not look like a web address.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/health`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`The server answered ${res.status}.`);
    const body = await res.json();
    if (!body || body.ok !== true) throw new Error('That address answered, but it is not a POS server.');
    return { base, health: body };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('No answer from that address. Check the phone is on the same network.');
    // A bare "Failed to fetch" tells a shopkeeper nothing.
    if (/failed to fetch|network/i.test(e.message)) {
      throw new Error('Could not reach that address. Check the spelling, and that the phone has internet.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
