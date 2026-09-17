import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Tag, CheckCircle2, SkipForward, Radio, Undo2, PackageCheck, Info, AlertTriangle,
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { num, variantLabel } from '../lib/format.js';
import { Card, Loading, Empty, Badge, useToast, Stat, Spinner } from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';

/**
 * Tag stock — bind a pre-encoded label to a physical unit.
 *
 * The designed flow for this system is that it mints a 96-bit EPC and a Zebra
 * RFID printer writes it onto the inlay. That needs an RFID printer, which is
 * the single most expensive part of an RFID setup and the one a small shop is
 * least likely to own.
 *
 * This is the same result without one. Plain pre-encoded UHF labels cost very
 * little and every one already carries a unique factory EPC. Stick a label on
 * the shoe, pull the trigger, and that tag becomes this unit's identity. The
 * per-unit tracking is identical — two of the same shoe in the same size are
 * still two different tags — it just uses the tag's own code rather than one
 * this system wrote.
 *
 * Built as a station: one unit in front of you, scan, next. No hunting through
 * a list between items, because that is what makes people stop doing it.
 */
export default function TagStock() {
  const toast = useToast();
  const { locationId, location } = useAuth();
  const inputRef = useRef(null);
  const idleTimer = useRef(null);
  const busyRef = useRef(false);

  const [queue, setQueue] = useState(null);
  const [total, setTotal] = useState(0);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const load = useCallback(async () => {
    setQueue(null);
    try {
      const res = await api.get(`/api/rfid/untagged${qs({ limit: 200 })}`);
      setQueue(res.data);
      setTotal(res.total);
      setIndex(0);
    } catch {
      setQueue([]);
    }
  }, [locationId]);
  useEffect(() => { load(); }, [load]);

  // Keep the capture field focused so the trigger always lands somewhere.
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    focus();
    const t = setInterval(focus, 1000);
    document.addEventListener('click', focus);
    return () => { clearInterval(t); document.removeEventListener('click', focus); };
  }, [queue, index]);

  const current = queue?.[index] || null;

  const assign = useCallback(async (raw) => {
    const code = String(raw).trim();
    if (!code || busyRef.current) return;
    const unit = queue?.[index];
    if (!unit) return;

    busyRef.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const res = await api.post(`/api/rfid/units/${unit.id}/assign-tag`, { epc: code });
      setDone((d) => [{ ...unit, epc: code, bits: res.bits }, ...d].slice(0, 25));
      setIndex((i) => i + 1);
      setTotal((t) => Math.max(0, t - 1));
      if (navigator.vibrate) navigator.vibrate(40);
      toast.success(res.message);
    } catch (e) {
      // Almost always "that tag is already on something else" — show it in
      // place rather than as a toast that vanishes before they look up.
      setProblem(e.message);
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [queue, index, toast]);

  // Uncontrolled capture, Enter or idle-terminated — same handling as the
  // stock-take screen, because the same reader feeds both.
  const drain = useCallback(() => {
    clearTimeout(idleTimer.current);
    const el = inputRef.current;
    if (!el) return;
    const v = el.value;
    el.value = '';
    const first = v.split(/[\s,;\n\r]+/).filter(Boolean)[0];
    if (first) assign(first);
  }, [assign]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); drain(); }
  };
  const onInput = () => {
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(drain, 150);
  };

  const undo = async (unit) => {
    try {
      await api.post(`/api/rfid/units/${unit.id}/unassign-tag`, {});
      toast.success('Tag unbound — that unit is back in the queue');
      setDone((d) => d.filter((x) => x.id !== unit.id));
      load();
    } catch (e) { toast.error(e.message); }
  };

  if (!queue) return <Loading />;

  return (
    <>
      <PageHeader title="Tag stock"
        subtitle="Stick a pre-encoded label on the item, pull the trigger, and that tag becomes this unit"
        actions={
          <button className="btn-secondary" onClick={load}>
            <PackageCheck size={16} /> Refresh queue
          </button>
        } />

      {/* capture field */}
      <input ref={inputRef} inputMode="none" autoComplete="off" defaultValue=""
        onKeyDown={onKeyDown} onInput={onInput}
        className="absolute opacity-0 pointer-events-none h-0 w-0" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Waiting for a tag" value={num(total)} icon={Tag}
          sub={location?.name} />
        <Stat label="Tagged this session" value={num(done.length)} tone="good" />
        <Stat label="In this batch" value={num(queue.length)} />
        <Stat label="Position" value={queue.length ? `${Math.min(index + 1, queue.length)} of ${queue.length}` : '—'} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {!current ? (
            <Card>
              <Empty title={queue.length ? 'Batch finished' : 'Everything is tagged'}
                icon={CheckCircle2}
                hint={queue.length
                  ? 'Refresh the queue to pick up any stock received since you started.'
                  : 'Every unit in stock at this location already has a tag bound to it.'} />
            </Card>
          ) : (
            <Card bodyClass="p-0">
              <div className="p-5 border-b border-slate-100">
                <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Tag this one</p>
                <h2 className="text-2xl font-semibold text-slate-900 leading-tight">
                  {current.product_name}
                </h2>
                <p className="text-lg text-slate-600 mt-0.5">
                  {variantLabel(current) || 'default'}
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Badge>{current.variant_sku}</Badge>
                  <Badge status="found">{current.epc_readable}</Badge>
                  {current.location_name && <Badge>{current.location_name}</Badge>}
                </div>
              </div>

              <div className="p-5">
                {problem ? (
                  <div className="rounded-xl bg-rose-50 ring-1 ring-rose-200 p-4 flex items-start gap-3">
                    <AlertTriangle size={20} className="text-rose-600 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-rose-900">That tag cannot be used</p>
                      <p className="text-sm text-rose-800 mt-1">{problem}</p>
                      <button className="btn-secondary text-xs mt-3" onClick={() => setProblem(null)}>
                        Try another tag
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-brand-50 ring-1 ring-brand-200 p-6 text-center">
                    {busy ? (
                      <>
                        <Spinner className="mx-auto text-brand-600" />
                        <p className="text-brand-900 font-medium mt-2">Binding…</p>
                      </>
                    ) : (
                      <>
                        <Radio size={40} className="mx-auto text-brand-600 animate-pulse" />
                        <p className="text-lg font-medium text-brand-900 mt-2">
                          Pull the trigger on a blank label
                        </p>
                        <p className="text-sm text-brand-800/80 mt-1">
                          Hold just this one tag near the reader — anything else in range could be
                          picked up instead.
                        </p>
                      </>
                    )}
                  </div>
                )}

                <div className="flex gap-2 mt-4">
                  <button className="btn-secondary flex-1"
                    onClick={() => { setProblem(null); setIndex((i) => i + 1); }}>
                    <SkipForward size={16} /> Skip this one
                  </button>
                </div>
              </div>
            </Card>
          )}

          {done.length > 0 && (
            <Card bodyClass="p-0" title="Tagged just now"
              subtitle="Wrong item in front of you? Unbind it and the unit goes back in the queue">
              <div className="divide-y divide-slate-100">
                {done.map((d) => (
                  <div key={d.id} className="px-4 py-3 flex items-center gap-3">
                    <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-800 truncate">
                        {d.product_name} <span className="text-slate-500">{variantLabel(d)}</span>
                      </p>
                      <p className="text-xs font-mono text-slate-500 truncate">
                        {d.epc} <span className="text-slate-400">· {d.bits}-bit</span>
                      </p>
                    </div>
                    <button className="btn-ghost text-xs text-rose-600 shrink-0"
                      onClick={() => undo(d)}>
                      <Undo2 size={14} /> Unbind
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <Card title="How this works">
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              Every pre-encoded UHF label already carries a unique code from the factory. Binding
              one to a unit here gives you the same per-unit tracking as printing your own — two of
              the same shoe in the same size are still two different tags.
            </p>
            <p>
              <strong className="text-slate-800">You do not need an RFID printer for this.</strong>{' '}
              Plain pre-encoded labels are enough. The printer only matters if you want your own
              numbering written onto the inlay, or the price and product name printed on the label
              at the same time.
            </p>
            <p>
              A tag already bound to another unit is refused rather than moved, so you cannot
              accidentally make an item unfindable.
            </p>
            <p className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 rounded-lg p-2.5">
              <Info size={14} className="mt-0.5 shrink-0" />
              Keep the other labels away from the reader while you bind one — at full power a
              handheld will happily read a whole box of them at once, and bind the wrong one.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
