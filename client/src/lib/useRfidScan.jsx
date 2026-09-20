import { useCallback, useEffect, useRef, useState } from 'react';
import {
  subscribe, hasNativeReader, readerInfo, startScan, stopScan, looksLikeTag,
} from './rfid.js';

/**
 * The hook every scanning screen uses.
 *
 * It hides the difference between a native broadcast and a keyboard wedge, and
 * it owns the two things every scan screen was reimplementing badly:
 *
 *   · de-duplication, because a UHF reader re-reads the same tag many times a
 *     second and a stock count that trusts every read is fiction
 *   · the hidden capture field, which has to stay focused for the browser
 *     fallback to receive anything at all
 *
 * Usage:
 *
 *   const { CaptureField, native, scanning, toggle, reads } = useRfidScan(
 *     (code) => addToCart(code),
 *     { dedupeMs: 1500 }
 *   );
 *   return <><CaptureField />…</>;
 */
export function useRfidScan(onTag, options = {}) {
  const {
    dedupeMs = 1200,
    autoStart = false,
    enabled = true,
    wedge = true,
    tagsOnly = false,      // ignore anything that doesn't look like a tag
    keepFocus = true,
  } = options;

  const inputRef = useRef(null);
  const seen = useRef(new Map());
  const handler = useRef(onTag);
  handler.current = onTag;

  const [native] = useState(hasNativeReader);
  const [info, setInfo] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [reads, setReads] = useState(0);
  const [last, setLast] = useState(null);

  useEffect(() => { if (native) readerInfo().then(setInfo); }, [native]);

  const accept = useCallback((code, meta) => {
    if (tagsOnly && !looksLikeTag(code)) return;
    if (dedupeMs > 0) {
      const now = Date.now();
      const prev = seen.current.get(code);
      if (prev && now - prev < dedupeMs) return;
      seen.current.set(code, now);
      // Stop the map growing without bound over a long sweep.
      if (seen.current.size > 5000) {
        for (const [k, t] of seen.current) {
          if (now - t > dedupeMs) seen.current.delete(k);
          if (seen.current.size <= 2500) break;
        }
      }
    }
    setReads((n) => n + 1);
    setLast({ code, at: Date.now(), via: meta?.via || 'broadcast' });
    handler.current?.(code, meta || {});
  }, [dedupeMs, tagsOnly]);

  useEffect(() => {
    if (!enabled) return undefined;
    const off = subscribe(accept, {
      autoStart,
      wedge,
      onState: (s) => setScanning(Boolean(s.scanning)),
      // The physical trigger on the handheld toggles the sweep, which is what
      // people expect it to do after using the UHF app.
      onTrigger: (e) => { if (e?.down) setScanning((s) => !s); },
    });
    if (autoStart) setScanning(true);
    return () => { off(); setScanning(false); };
  }, [enabled, autoStart, wedge, accept]);

  // Keep the capture field focused so a wedge read always lands somewhere.
  useEffect(() => {
    if (!enabled || !keepFocus || native) return undefined;
    const focus = () => {
      const el = inputRef.current;
      if (!el) return;
      const active = document.activeElement;
      // Never steal focus from a field somebody is actually typing in.
      if (active && active !== el && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
      el.focus({ preventScroll: true });
    };
    focus();
    const t = setInterval(focus, 1000);
    document.addEventListener('click', focus);
    return () => { clearInterval(t); document.removeEventListener('click', focus); };
  }, [enabled, keepFocus, native]);

  const start = useCallback(async () => {
    if (native) await startScan();
    setScanning(true);
  }, [native]);

  const stop = useCallback(async () => {
    if (native) await stopScan();
    setScanning(false);
  }, [native]);

  const toggle = useCallback(() => (scanning ? stop() : start()), [scanning, start, stop]);

  const resetDedupe = useCallback(() => seen.current.clear(), []);

  /**
   * The invisible field the browser fallback types into. Rendering it is
   * harmless in the APK (nothing types into it there) and mandatory outside
   * one — data-scan-capture is what tells the wedge listener this field is a
   * reader's target and not a person's.
   */
  const CaptureField = useCallback(() => (
    <input
      ref={inputRef}
      data-scan-capture=""
      inputMode="none"
      autoComplete="off"
      aria-hidden="true"
      tabIndex={-1}
      defaultValue=""
      className="absolute opacity-0 pointer-events-none h-0 w-0"
    />
  ), []);

  return {
    CaptureField, inputRef,
    native, info, scanning, reads, last,
    start, stop, toggle, resetDedupe,
  };
}

export default useRfidScan;
