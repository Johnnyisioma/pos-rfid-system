import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Play, CheckCircle2, AlertTriangle, XCircle, Zap, Radio, RotateCcw, Pause,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { num } from '../lib/format.js';
import { Loading, useToast, Spinner } from '../components/ui.jsx';
import { useAuth } from '../lib/auth.jsx';

/**
 * Full-screen handheld mode, built for a UHF reader held on the trigger.
 *
 * A continuous sweep is not a series of scans — it is a firehose. The reader
 * returns tens of reads a second and re-reads the same tag over and over for as
 * long as it stays in the antenna's field. Three things follow from that, and
 * all three are why this screen does not just post each read as it arrives:
 *
 *  1. The capture input is UNCONTROLLED. A controlled React input round-trips
 *     state on every keystroke, and a wedge typing a 24-character EPC in a few
 *     milliseconds will lose characters that way — producing corrupt EPCs that
 *     look like unknown tags.
 *  2. Reads are DEDUPED IN THE BROWSER before anything is sent. The same tag
 *     read two hundred times is one network call, not two hundred.
 *  3. New codes are BATCHED on a short timer. One request every 400ms with
 *     thirty tags in it, rather than thirty requests.
 *
 * The count itself lives on the server: every scan is written against the open
 * stock take with a unique constraint per (take, EPC). So walking away, locking
 * the handheld, or closing the app loses nothing — reopening resumes the same
 * count where it left off.
 */

/** Mirrors normalizeEpc() on the server so the local dedupe agrees with it. */
const normalize = (s) =>
  String(s).trim().replace(/^epc[:=]/i, '').replace(/[\s:\-_.]/g, '').toUpperCase();

const FLUSH_MS = 400;        // how long a batch is allowed to gather
const FLUSH_AT = 30;         // …or this many codes, whichever comes first
const IDLE_TERMINATOR = 120; // treat a pause this long as the end of one read
const REFRESH_MS = 4000;     // full re-sync cadence while scanning

export default function StockTakeMode() {
  const navigate = useNavigate();
  const toast = useToast();
  const { locationId, location, user } = useAuth();

  const inputRef = useRef(null);
  const seenRef = useRef(new Set());   // EPCs already sent this session
  const queueRef = useRef([]);         // codes waiting to be sent
  const flushTimer = useRef(null);
  const idleTimer = useRef(null);
  const takeRef = useRef(null);
  const sendingRef = useRef(false);
  const lastBuzz = useRef(0);
  const rateRef = useRef([]);          // timestamps, for the reads/sec figure

  const [take, setTake] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState([]);
  const [live, setLive] = useState({ unique: 0, pending: 0, rate: 0, sending: false });
  const [paused, setPaused] = useState(false);

  useEffect(() => { takeRef.current = take; }, [take]);

  const refresh = useCallback(async (id) => {
    const t = await api.get(`/api/rfid/stock-takes/${id}`);
    setTake(t);
    return t;
  }, []);

  /* ---------- resume an open count ---------- */
  useEffect(() => {
    (async () => {
      try {
        const list = await api.get('/api/rfid/stock-takes');
        const open = list.find((t) => t.status === 'open' && t.location_id === locationId);
        if (open) {
          const t = await refresh(open.id);
          // Everything already counted is already deduped — don't re-send it.
          (t.scans || []).forEach((s) => seenRef.current.add(normalize(s.epc)));
          // Seed the on-screen figure too, or resuming a count reads as zero
          // tags while the tallies above show hundreds.
          setLive((l) => ({ ...l, unique: seenRef.current.size }));
        }
      } catch { /* offline — the queue still works, it just can't flush yet */ }
      setLoading(false);
    })();
  }, [locationId, refresh]);

  /* ---------- keep the capture input focused ---------- */
  useEffect(() => {
    const focus = () => { if (!paused) inputRef.current?.focus(); };
    focus();
    const t = setInterval(focus, 1200);
    document.addEventListener('click', focus);
    return () => { clearInterval(t); document.removeEventListener('click', focus); };
  }, [take, paused]);

  /* ---------- the reads/sec meter ---------- */
  useEffect(() => {
    const t = setInterval(() => {
      const cutoff = Date.now() - 1000;
      rateRef.current = rateRef.current.filter((x) => x > cutoff);
      setLive((l) => ({ ...l, rate: rateRef.current.length }));
    }, 500);
    return () => clearInterval(t);
  }, []);

  const push = (entries) =>
    setFeed((f) => [...entries, ...f].slice(0, 40));

  /* ---------- batching ---------- */
  const flush = useCallback(async () => {
    clearTimeout(flushTimer.current);
    flushTimer.current = null;
    if (sendingRef.current) {
      // A send is already in flight. Come back rather than just returning —
      // this call has already cancelled its own timer, so returning bare would
      // strand whatever is in the queue until the next read arrives, and at the
      // end of a sweep no next read ever comes.
      flushTimer.current = setTimeout(flush, FLUSH_MS);
      return;
    }
    const id = takeRef.current?.id;
    const batch = queueRef.current.splice(0, 200);
    if (!id || !batch.length) return;

    sendingRef.current = true;
    setLive((l) => ({ ...l, sending: true, pending: queueRef.current.length }));
    try {
      const res = await api.post(`/api/rfid/stock-takes/${id}/scan`, { codes: batch });
      const s = res.summary;

      push((s.results || []).map((r) => ({
        code: r.code,
        result: r.result,
        name: r.product_name,
        variant: r.variant,
        at: Date.now(),
      })));

      // Counts come back with the response, so the common case needs no refetch.
      if (res.stock_take) {
        setTake((t) => (t ? { ...t, ...res.stock_take, found: t.found, missing: t.missing } : t));
      }

      // One buzz per batch at most — a continuous sweep buzzing per tag is
      // unusable, and drains the battery.
      if (navigator.vibrate && Date.now() - lastBuzz.current > 350) {
        lastBuzz.current = Date.now();
        navigator.vibrate(s.unknown ? [70, 50, 70] : 30);
      }
    } catch (e) {
      // Put them back so nothing is lost to a dropped connection, and let the
      // dedupe set forget them so they can be sent again.
      queueRef.current.unshift(...batch);
      batch.forEach((c) => seenRef.current.delete(normalize(c)));
      push([{ code: `${batch.length} read(s) held`, result: 'error', name: e.message, at: Date.now() }]);
    } finally {
      sendingRef.current = false;
      setLive((l) => ({ ...l, sending: false, pending: queueRef.current.length }));
      if (queueRef.current.length) flushTimer.current = setTimeout(flush, FLUSH_MS);
    }
  }, []);

  /** A single read arriving from the wedge. */
  const accept = useCallback((raw) => {
    const code = String(raw).trim();
    if (!code) return;
    rateRef.current.push(Date.now());

    const key = normalize(code);
    if (seenRef.current.has(key)) return;   // re-read of a tag already counted
    seenRef.current.add(key);

    queueRef.current.push(code);
    setLive((l) => ({ ...l, unique: seenRef.current.size, pending: queueRef.current.length }));

    if (queueRef.current.length >= FLUSH_AT) flush();
    else if (!flushTimer.current) flushTimer.current = setTimeout(flush, FLUSH_MS);
  }, [flush]);

  /* ---------- wedge input handling ---------- */
  // Read straight off the DOM node. Some readers send a Return after each tag,
  // some send nothing at all — the idle timer covers the second kind.
  const drain = useCallback(() => {
    clearTimeout(idleTimer.current);
    idleTimer.current = null;
    const el = inputRef.current;
    if (!el) return;
    const v = el.value;
    el.value = '';
    v.split(/[\s,;\n\r]+/).filter(Boolean).forEach(accept);
  }, [accept]);

  const onInput = useCallback(() => {
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(drain, IDLE_TERMINATOR);
  }, [drain]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); drain(); }
  }, [drain]);

  /* ---------- periodic full re-sync ---------- */
  useEffect(() => {
    if (!take?.id) return undefined;
    const t = setInterval(() => {
      if (!sendingRef.current && !queueRef.current.length) refresh(take.id).catch(() => {});
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [take?.id, refresh]);

  // Never walk away with reads still in the queue.
  useEffect(() => () => { clearTimeout(flushTimer.current); clearTimeout(idleTimer.current); }, []);
  useEffect(() => {
    const warn = (e) => {
      if (queueRef.current.length) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const start = async () => {
    setBusy(true);
    try {
      const t = await api.post('/api/rfid/stock-takes', { location_id: locationId });
      seenRef.current = new Set();
      queueRef.current = [];
      setFeed([]);
      setLive({ unique: 0, pending: 0, rate: 0, sending: false });
      await refresh(t.id);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const simulate = async () => {
    setBusy(true);
    try {
      const res = await api.post('/api/rfid/simulate-sweep', { location_id: locationId, size: 15 });
      res.reads.forEach((r) => accept(r.epc));
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="min-h-screen bg-slate-900 grid place-items-center"><Loading /></div>;

  const counted = take ? (take.found?.length ?? take.found_count ?? 0) : 0;
  const missing = take ? (take.missing?.length ?? take.missing_count ?? 0) : 0;
  const expected = Number(take?.expected_count || 0);
  const accuracy = take?.accuracy != null
    ? take.accuracy
    : expected ? Math.round(((expected - missing) / expected) * 1000) / 10 : 0;

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col"
      onClick={() => !paused && inputRef.current?.focus()}>
      {/* Invisible capture field — uncontrolled on purpose (see the note above). */}
      <input ref={inputRef} inputMode="none" autoComplete="off" defaultValue=""
        onInput={onInput} onKeyDown={onKeyDown}
        className="absolute opacity-0 pointer-events-none h-0 w-0" />

      <header className="flex items-center justify-between px-4 py-3 bg-slate-800/80 shrink-0">
        <div className="min-w-0">
          <p className="font-semibold leading-tight truncate">Stock Take Mode</p>
          <p className="text-xs text-slate-400 truncate">
            {location?.name} · {user?.name}{take ? ` · ${take.ref}` : ''}
          </p>
        </div>
        <button onClick={() => navigate('/rfid/stock-take')} className="p-3 -mr-2 rounded-xl hover:bg-slate-700">
          <X size={24} />
        </button>
      </header>

      {!take ? (
        <div className="flex-1 grid place-items-center p-6">
          <div className="text-center max-w-sm">
            <Radio size={56} className="mx-auto text-brand-400 mb-4" />
            <h1 className="text-2xl font-semibold mb-2">Ready to count</h1>
            <p className="text-slate-400 mb-6">
              Start a count, then hold the trigger and sweep. Every tag is matched to its individual
              unit, and re-reading the same tag never counts it twice.
            </p>
            <button onClick={start} disabled={busy}
              className="btn-xl bg-emerald-600 hover:bg-emerald-700 text-white w-full">
              {busy ? <Spinner /> : <Play size={22} />} Start counting
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-px bg-slate-800 shrink-0">
            <Tally label="Found" value={counted} tone="text-emerald-400" />
            <Tally label="Missing" value={missing} tone="text-rose-400" />
            <Tally label="Accuracy" value={`${accuracy}%`} tone="text-brand-300" />
          </div>

          {/* Live scanning strip — proof it is still reading without touching it */}
          <div className="flex items-center gap-3 px-4 py-2 bg-slate-800/60 shrink-0 text-xs">
            <span className={`flex items-center gap-1.5 font-medium ${
              live.rate > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
              <span className={`h-2 w-2 rounded-full ${
                live.rate > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
              {live.rate > 0 ? `${live.rate} reads/s` : paused ? 'Paused' : 'Waiting for trigger'}
            </span>
            <span className="text-slate-400">{num(live.unique)} unique</span>
            {live.pending > 0 && <span className="text-amber-400">{num(live.pending)} queued</span>}
            {live.sending && <Spinner className="text-slate-400" />}
            <button onClick={() => setPaused((p) => !p)}
              className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-700 hover:bg-slate-600">
              {paused ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause</>}
            </button>
          </div>

          <div className="px-4 py-3 bg-slate-800/60 shrink-0">
            <div className="h-3 rounded-full bg-slate-700 overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all"
                style={{ width: `${Math.min(100, expected ? (counted / expected) * 100 : 0)}%` }} />
            </div>
            <p className="text-xs text-slate-400 mt-1.5 text-center">
              {num(counted)} of {num(expected)} expected units scanned
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {feed.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <Radio size={40} className="mx-auto mb-3 opacity-40" />
                <p className="text-lg">Hold the trigger and sweep</p>
                <p className="text-sm mt-1">
                  Reads appear here as they come in. Let go and walk to the next rack — the count
                  keeps everything you have already scanned.
                </p>
              </div>
            ) : feed.map((f, i) => (
              <FeedRow key={`${f.at}-${f.code}-${i}`} entry={f} />
            ))}
          </div>

          <div className="p-3 bg-slate-800 shrink-0 grid grid-cols-2 gap-2">
            <button onClick={simulate} disabled={busy}
              className="btn-xl bg-slate-700 hover:bg-slate-600 text-white">
              {busy ? <Spinner /> : <Zap size={20} />} Simulate
            </button>
            <button onClick={async () => { await flush(); navigate('/rfid/stock-take'); }}
              className="btn-xl bg-brand-600 hover:bg-brand-700 text-white">
              <CheckCircle2 size={20} /> Reconcile
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Tally({ label, value, tone }) {
  return (
    <div className="bg-slate-900 px-3 py-4 text-center">
      <p className={`text-3xl font-bold tabular-nums ${tone}`}>{num(value)}</p>
      <p className="text-[11px] uppercase tracking-wide text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}

function FeedRow({ entry }) {
  const map = {
    found: { icon: CheckCircle2, cls: 'bg-emerald-600/15 ring-emerald-600/40 text-emerald-300', label: 'Found' },
    wrong_location: { icon: AlertTriangle, cls: 'bg-amber-600/15 ring-amber-600/40 text-amber-300', label: 'Other branch' },
    unexpected: { icon: AlertTriangle, cls: 'bg-amber-600/15 ring-amber-600/40 text-amber-300', label: 'Unexpected' },
    unknown: { icon: XCircle, cls: 'bg-rose-600/15 ring-rose-600/40 text-rose-300', label: 'Unknown tag' },
    duplicate: { icon: RotateCcw, cls: 'bg-slate-600/20 ring-slate-500/40 text-slate-300', label: 'Already counted' },
    error: { icon: XCircle, cls: 'bg-rose-600/15 ring-rose-600/40 text-rose-300', label: 'Held' },
  }[entry.result] || { icon: Radio, cls: 'bg-slate-700/40 ring-slate-600 text-slate-300', label: entry.result };
  const Icon = map.icon;

  return (
    <div className={`rounded-xl ring-1 p-3 flex items-center gap-3 ${map.cls}`}>
      <Icon size={26} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-white truncate text-base leading-tight">
          {entry.name || map.label}
        </p>
        <p className="text-xs opacity-80 truncate">
          {entry.variant ? `${entry.variant} · ` : ''}<span className="font-mono">{entry.code}</span>
        </p>
      </div>
      <span className="text-xs font-medium shrink-0">{map.label}</span>
    </div>
  );
}
