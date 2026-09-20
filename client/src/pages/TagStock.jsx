import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Tag, CheckCircle2, SkipForward, Radio, Undo2, PackageCheck, Info, AlertTriangle,
  Layers, Keyboard, Square, Smartphone, X,
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { num, variantLabel } from '../lib/format.js';
import { Card, Loading, Empty, Badge, useToast, Stat, Spinner, Modal, Field } from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useRfidScan } from '../lib/useRfidScan.jsx';

/**
 * Tag stock — give a physical item its licence plate.
 *
 * An EPC is a licence plate. It identifies one item and says nothing about what
 * that item is; everything else is looked up from it. That is why a
 * factory-encoded tag works exactly as well as one this system minted: the
 * number does not have to mean anything, it only has to be unique and stuck to
 * the right shoe.
 *
 * Which matters commercially, because minting your own means owning an RFID
 * printer — the most expensive part of an RFID setup and the one a small shop
 * is least likely to have. Plain pre-encoded labels cost very little and every
 * one already carries a unique factory EPC.
 *
 * Two ways to work:
 *
 *   One at a time   the queue picks the next untagged unit, you scan, it moves
 *                   on. Right for mixed stock coming off a delivery.
 *   Batch           fix one product and size up front and just scan, scan,
 *                   scan. Right for forty pairs of the same shoe, where picking
 *                   from a list of forty identical rows is the slow part.
 */
export default function TagStock() {
  const toast = useToast();
  const { locationId, location } = useAuth();
  const busyRef = useRef(false);

  const [mode, setMode] = useState('queue');       // queue | batch
  const [queue, setQueue] = useState(null);
  const [total, setTotal] = useState(0);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const [batch, setBatch] = useState(null);
  const [showNewBatch, setShowNewBatch] = useState(false);
  const [manual, setManual] = useState('');
  const [showManual, setShowManual] = useState(false);

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

  const current = queue?.[index] || null;

  /* ---------------- pairing ---------------- */

  const pairInBatch = useCallback(async (code) => {
    const res = await api.post(`/api/rfid/batches/${batch.id}/pair`, { epc: code });
    setBatch((b) => ({ ...b, ...res.batch, remaining: res.remaining }));
    setDone((d) => [{
      id: res.unit.id, epc: code, bits: res.bits,
      product_name: batch.product_name, size: batch.size, color: batch.color,
    }, ...d].slice(0, 25));
    setTotal((t) => Math.max(0, t - 1));
    return res.message;
  }, [batch]);

  const pairInQueue = useCallback(async (code) => {
    const unit = queue?.[index];
    if (!unit) throw new Error('Nothing left in the queue to tag.');
    const res = await api.post(`/api/rfid/units/${unit.id}/assign-tag`, { epc: code });
    setDone((d) => [{ ...unit, epc: code, bits: res.bits }, ...d].slice(0, 25));
    setIndex((i) => i + 1);
    setTotal((t) => Math.max(0, t - 1));
    return res.message;
  }, [queue, index]);

  const assign = useCallback(async (raw) => {
    const code = String(raw).trim();
    if (!code || busyRef.current) return;
    if (mode === 'batch' && !batch) return;
    if (mode === 'queue' && !queue?.[index]) return;

    busyRef.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const message = mode === 'batch' ? await pairInBatch(code) : await pairInQueue(code);
      if (navigator.vibrate) navigator.vibrate(40);
      toast.success(message);
    } catch (e) {
      // Almost always "that tag is already on something else". Shown in place
      // rather than as a toast, because a toast is gone before someone tagging
      // a shelf looks up from the shelf.
      setProblem(e.message);
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [mode, batch, queue, index, pairInBatch, pairInQueue, toast]);

  /*
    One tag at a time, deliberately.

    dedupeMs is short because the operator is holding ONE label to the reader
    and the next label is a different tag a second later — a long window would
    swallow real work. tagsOnly keeps a stray keypress from being paired.
  */
  const scan = useRfidScan(assign, { dedupeMs: 700, tagsOnly: true });

  const undo = async (unit) => {
    try {
      await api.post(`/api/rfid/units/${unit.id}/unassign-tag`, {});
      toast.success('Tag unbound — that unit is back in the queue');
      setDone((d) => d.filter((x) => x.id !== unit.id));
      load();
    } catch (e) { toast.error(e.message); }
  };

  if (!queue) return <Loading />;

  const waiting = mode === 'batch' ? (batch?.remaining ?? 0) : total;

  return (
    <>
      <PageHeader title="Tag stock"
        subtitle="Stick a label on the item, read it, and that tag becomes this unit's licence plate"
        actions={
          <>
            <button className="btn-secondary" onClick={() => setShowManual(true)}>
              <Keyboard size={16} /> Type a tag
            </button>
            <button className="btn-secondary" onClick={load}>
              <PackageCheck size={16} /> Refresh
            </button>
          </>
        } />

      <scan.CaptureField />

      {/* mode switch */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="inline-flex rounded-xl bg-slate-100 p-1">
          <button onClick={() => setMode('queue')}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium ${
              mode === 'queue' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-600'}`}>
            One at a time
          </button>
          <button onClick={() => setMode('batch')}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium ${
              mode === 'batch' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-600'}`}>
            <Layers size={14} className="inline mr-1 -mt-0.5" /> Batch
          </button>
        </div>

        {scan.native && (
          <>
            <button onClick={scan.toggle}
              className={scan.scanning ? 'btn-danger' : 'btn-secondary'}>
              {scan.scanning ? <><Square size={16} /> Stop reading</> : <><Radio size={16} /> Read continuously</>}
            </button>
            <span className="text-xs text-brand-700 flex items-center gap-1">
              <Smartphone size={13} /> handheld connected
            </span>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Waiting for a tag" value={num(waiting)} icon={Tag} sub={location?.name} />
        <Stat label="Tagged this session" value={num(done.length)} tone="good" />
        <Stat label={mode === 'batch' ? 'Paired in batch' : 'In this batch'}
          value={num(mode === 'batch' ? (batch?.provisioned || 0) : queue.length)} />
        <Stat label="Position"
          value={mode === 'batch'
            ? (batch ? batch.ref : '—')
            : (queue.length ? `${Math.min(index + 1, queue.length)} of ${queue.length}` : '—')} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {mode === 'batch' && !batch ? (
            <Card>
              <Empty title="Start a batch" icon={Layers}
                hint="Pick one product and size, then scan labels one after another without touching the screen."
                action={<button className="btn-primary" onClick={() => setShowNewBatch(true)}>
                  <Layers size={16} /> New batch
                </button>} />
            </Card>
          ) : (mode === 'queue' && !current) ? (
            <Card>
              <Empty title={queue.length ? 'Batch finished' : 'Everything is tagged'}
                icon={CheckCircle2}
                hint={queue.length
                  ? 'Refresh the queue to pick up any stock received since you started.'
                  : 'Every unit in stock at this location already has a tag bound to it.'} />
            </Card>
          ) : (
            <Card bodyClass="p-0">
              <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">
                    {mode === 'batch' ? 'Tagging this product' : 'Tag this one'}
                  </p>
                  <h2 className="text-2xl font-semibold text-slate-900 leading-tight">
                    {mode === 'batch' ? batch.product_name : current.product_name}
                  </h2>
                  <p className="text-lg text-slate-600 mt-0.5">
                    {variantLabel(mode === 'batch' ? batch : current) || 'default'}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Badge>{mode === 'batch' ? batch.variant_sku : current.variant_sku}</Badge>
                    {mode === 'queue' && <Badge status="found">{current.epc_readable}</Badge>}
                    {mode === 'batch' && <Badge status="found">{num(batch.remaining ?? 0)} left</Badge>}
                    {(mode === 'batch' ? batch.location_name : current.location_name) && (
                      <Badge>{mode === 'batch' ? batch.location_name : current.location_name}</Badge>
                    )}
                  </div>
                </div>
                {mode === 'batch' && (
                  <button className="btn-ghost text-slate-400 shrink-0"
                    onClick={async () => {
                      try { await api.post(`/api/rfid/batches/${batch.id}/close`, {}); } catch { /* already closed */ }
                      setBatch(null); load();
                    }} title="Finish this batch">
                    <X size={18} />
                  </button>
                )}
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
                        <p className="text-brand-900 font-medium mt-2">Pairing…</p>
                      </>
                    ) : (
                      <>
                        <Radio size={40} className="mx-auto text-brand-600 animate-pulse" />
                        <p className="text-lg font-medium text-brand-900 mt-2">
                          {scan.scanning ? 'Hold a label to the reader' : 'Pull the trigger on a blank label'}
                        </p>
                        <p className="text-sm text-brand-800/80 mt-1">
                          Hold just this one tag near the reader — anything else in range could be
                          picked up instead.
                        </p>
                      </>
                    )}
                  </div>
                )}

                {mode === 'queue' && (
                  <div className="flex gap-2 mt-4">
                    <button className="btn-secondary flex-1"
                      onClick={() => { setProblem(null); setIndex((i) => i + 1); }}>
                      <SkipForward size={16} /> Skip this one
                    </button>
                  </div>
                )}
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

      <NewBatchModal open={showNewBatch} onClose={() => setShowNewBatch(false)}
        onCreated={(b) => { setBatch({ ...b, remaining: b.remaining ?? 0 }); setShowNewBatch(false); }} />

      <Modal open={showManual} onClose={() => setShowManual(false)} size="sm"
        title="Type a tag code"
        subtitle="For a tag the reader will not pick up — read it in the UHF app and copy the number">
        <Field label="EPC">
          <input className="input font-mono" autoFocus value={manual}
            placeholder="E280 1160 6000 0207 2E1B 0C8F"
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const v = manual.trim();
              if (v) { assign(v); setManual(''); setShowManual(false); }
            }} />
        </Field>
        <button className="btn-primary w-full mt-3" disabled={!manual.trim()}
          onClick={() => { assign(manual.trim()); setManual(''); setShowManual(false); }}>
          Pair this tag
        </button>
      </Modal>
    </>
  );
}

/** Pick the product and size a batch is for. */
function NewBatchModal({ open, onClose, onCreated }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) { setQ(''); setRows([]); return undefined; }
    const t = setTimeout(async () => {
      if (q.trim().length < 2) { setRows([]); return; }
      try { setRows(await api.get(`/api/products/search${qs({ q: q.trim() })}`)); }
      catch { setRows([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  const create = async (row) => {
    setBusy(true);
    try {
      const b = await api.post('/api/rfid/batches', { variant_id: row.variant_id });
      onCreated({
        ...b,
        product_name: row.name, variant_sku: row.sku,
        size: row.size, color: row.color,
        remaining: Number(row.stock) || 0,
      });
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="sm" title="New tagging batch"
      subtitle="Everything you scan next will be paired to this product">
      <Field label="Find the product">
        <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Name, SKU or barcode" />
      </Field>
      <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-slate-100">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">
            {q.trim().length < 2 ? 'Start typing to search.' : 'Nothing matches that.'}
          </p>
        ) : rows.map((row) => (
          <button key={row.variant_id} disabled={busy} onClick={() => create(row)}
            className="w-full text-left px-1 py-3 hover:bg-slate-50 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-800 truncate">{row.name}</p>
              <p className="text-xs text-slate-500">{variantLabel(row)} · {row.sku}</p>
            </div>
            <Badge status={Number(row.stock) > 0 ? 'found' : undefined}>{num(row.stock)} in stock</Badge>
          </button>
        ))}
      </div>
    </Modal>
  );
}
