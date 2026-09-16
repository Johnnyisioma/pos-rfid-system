import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Play, CheckCircle2, AlertTriangle, XCircle, Zap, Radio, RotateCcw, Vibrate,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { num, pct } from '../lib/format.js';
import { Loading, useToast, Spinner } from '../components/ui.jsx';
import { useAuth } from '../lib/auth.jsx';

/**
 * Full-screen handheld mode.
 *
 * Designed for an Android UHF scanner: big tap targets, a permanently focused
 * hidden input that swallows keyboard-wedge reads, and a running tally that
 * never needs scrolling. Works from the PWA home-screen icon.
 */
export default function StockTakeMode() {
  const navigate = useNavigate();
  const toast = useToast();
  const { locationId, location, user } = useAuth();
  const inputRef = useRef(null);

  const [take, setTake] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState([]);
  const [buffer, setBuffer] = useState('');

  const refresh = useCallback(async (id) => {
    const t = await api.get(`/api/rfid/stock-takes/${id}`);
    setTake(t);
    return t;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.get('/api/rfid/stock-takes');
        const open = list.find((t) => t.status === 'open' && t.location_id === locationId);
        if (open) await refresh(open.id);
      } catch { /* offline */ }
      setLoading(false);
    })();
  }, [locationId, refresh]);

  // keep the invisible input focused so a wedge scanner always lands somewhere
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    focus();
    const t = setInterval(focus, 1200);
    document.addEventListener('click', focus);
    return () => { clearInterval(t); document.removeEventListener('click', focus); };
  }, [take]);

  const start = async () => {
    setBusy(true);
    try {
      const t = await api.post('/api/rfid/stock-takes', { location_id: locationId });
      await refresh(t.id);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const push = (entry) => setFeed((f) => [entry, ...f].slice(0, 40));

  const submit = async (codes) => {
    if (!take || !codes.length) return;
    try {
      const res = await api.post(`/api/rfid/stock-takes/${take.id}/scan`, { codes });
      const t = await refresh(take.id);
      const s = res.summary;
      codes.forEach((c) => {
        const scan = t.scans.find((x) => x.epc === c.toUpperCase().replace(/[\s:\-_.]/g, ''));
        push({
          code: c,
          result: scan?.result || (s.duplicates ? 'duplicate' : 'unknown'),
          name: scan?.product_name,
          variant: [scan?.size, scan?.color].filter(Boolean).join(' / '),
          at: Date.now(),
        });
      });
      if (navigator.vibrate) navigator.vibrate(s.unknown ? [80, 60, 80] : 40);
    } catch (e) {
      push({ code: codes[0], result: 'error', name: e.message, at: Date.now() });
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    }
  };

  const simulate = async () => {
    setBusy(true);
    try {
      const res = await api.post('/api/rfid/simulate-sweep', { location_id: locationId, size: 15 });
      await submit([...new Set(res.reads.map((r) => r.epc))]);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="min-h-screen bg-slate-900 grid place-items-center"><Loading /></div>;

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col" onClick={() => inputRef.current?.focus()}>
      {/* hidden capture input — a wedge scanner types into this */}
      <input ref={inputRef} value={buffer} inputMode="none" autoComplete="off"
        onChange={(e) => setBuffer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const v = buffer.trim();
            if (v) submit([v]);
            setBuffer('');
          }
        }}
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
              Start a count, then sweep the shop floor with the handheld. Every tag you read is matched
              to its individual unit.
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
            <Tally label="Found" value={take.found.length} tone="text-emerald-400" />
            <Tally label="Missing" value={take.missing.length} tone="text-rose-400" />
            <Tally label="Accuracy" value={`${take.accuracy}%`} tone="text-brand-300" />
          </div>

          <div className="px-4 py-3 bg-slate-800/60 shrink-0">
            <div className="h-3 rounded-full bg-slate-700 overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all"
                style={{ width: `${Math.min(100, take.expected_count ? (take.found.length / take.expected_count) * 100 : 0)}%` }} />
            </div>
            <p className="text-xs text-slate-400 mt-1.5 text-center">
              {num(take.found.length)} of {num(take.expected_count)} expected units scanned
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {feed.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <Radio size={40} className="mx-auto mb-3 opacity-40" />
                <p className="text-lg">Pull the trigger to scan</p>
                <p className="text-sm mt-1">Reads appear here as they come in.</p>
              </div>
            ) : feed.map((f, i) => (
              <FeedRow key={`${f.at}-${i}`} entry={f} />
            ))}
          </div>

          <div className="p-3 bg-slate-800 shrink-0 grid grid-cols-2 gap-2">
            <button onClick={simulate} disabled={busy}
              className="btn-xl bg-slate-700 hover:bg-slate-600 text-white">
              {busy ? <Spinner /> : <Zap size={20} />} Simulate
            </button>
            <button onClick={() => navigate('/rfid/stock-take')}
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
      <p className={`text-3xl font-bold tabular-nums ${tone}`}>{value}</p>
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
    error: { icon: XCircle, cls: 'bg-rose-600/15 ring-rose-600/40 text-rose-300', label: 'Error' },
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
