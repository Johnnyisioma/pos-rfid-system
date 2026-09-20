import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, ArrowLeftRight, Truck, PackageCheck, Trash2, Radio, ScanLine, Square,
  AlertTriangle, CheckCircle2, X,
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, num, dateTime, variantLabel } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, Pagination, useToast, Field, Spinner, ConfirmButton,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import VariantPicker from '../components/VariantPicker.jsx';
import { useRfidScan } from '../lib/useRfidScan.jsx';

export default function Transfers() {
  const { can, locationId, locations } = useAuth();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setData(null);
    setData(await api.get(`/api/transfers${qs({ status, page, limit: 25 })}`).catch(() => ({ data: [] })));
  }, [status, page, locationId]);
  useEffect(() => { load(); }, [load]);

  // The sidebar's "Add transfer" link lands here with ?new=1. Open the form,
  // then drop the flag so a refresh or a back-button press does not reopen it.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    if (can('transfers.write') && locations.length > 1) setCreating(true);
    setParams(new URLSearchParams(), { replace: true });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title="Stock transfers"
        subtitle="Move stock between branches with an in-transit stage and a receive confirmation"
        actions={can('transfers.write') && locations.length > 1 && (
          <>
            <button className="btn-secondary" onClick={() => setScanning(true)}>
              <ScanLine size={16} /> Scan a box
            </button>
            <button className="btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> New transfer
            </button>
          </>
        )} />

      <Card bodyClass="p-0">
        <div className="p-4 border-b border-slate-100 flex gap-2">
          <select className="input w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {['draft', 'in_transit', 'received', 'cancelled'].map((s) =>
              <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </div>

        {!data ? <Loading /> : data.data.length === 0 ? (
          <Empty title="No transfers yet" icon={ArrowLeftRight}
            hint={locations.length > 1
              ? 'Send stock to another branch and confirm it on arrival.'
              : 'Add a second location under Settings to start moving stock between shops.'} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Reference</th><th>From</th><th>To</th><th>Status</th>
                  <th className="text-right">Sent</th><th className="text-right">Received</th><th>Dispatched</th></tr></thead>
                <tbody>
                  {data.data.map((t) => (
                    <tr key={t.id} className="cursor-pointer" onClick={() => setOpen(t.id)}>
                      <td className="font-mono text-xs font-medium text-brand-700">{t.ref}</td>
                      <td>{t.from_location_name}</td>
                      <td>{t.to_location_name}</td>
                      <td><Badge status={t.status} /></td>
                      <td className="text-right tabular-nums">{num(t.total_qty)}</td>
                      <td className="text-right tabular-nums">{num(t.received_qty)}</td>
                      <td className="text-slate-500 text-xs whitespace-nowrap">{t.sent_at ? dateTime(t.sent_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <TransferEditor open={creating} onClose={() => setCreating(false)}
        onDone={() => { setCreating(false); load(); }} />
      <ScanToSend open={scanning} onClose={() => setScanning(false)}
        onDone={(t) => { setScanning(false); load(); setOpen(t.id); }} />
      {open && <TransferDetail id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}

function TransferEditor({ open, onClose, onDone }) {
  const { locationId, locations } = useAuth();
  const toast = useToast();
  const [to, setTo] = useState('');
  const [from, setFrom] = useState(locationId);
  const [notes, setNotes] = useState('');
  const [dispatch, setDispatch] = useState(true);
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFrom(locationId);
    setTo(locations.find((l) => l.id !== locationId)?.id || '');
    setLines([]); setNotes('');
  }, [open, locationId, locations]);

  const add = (v) => setLines((p) => [...p, {
    variant_id: v.variant_id, label: `${v.name} · ${variantLabel(v)}`, sku: v.sku,
    quantity: 1, available: v.stock,
  }]);

  const submit = async () => {
    const items = lines.filter((l) => Number(l.quantity) > 0)
      .map((l) => ({ variant_id: l.variant_id, quantity: Number(l.quantity) }));
    if (!items.length) return toast.error('Add at least one item');
    if (!to) return toast.error('Choose a destination');
    setBusy(true);
    try {
      const t = await api.post('/api/transfers', {
        from_location_id: from, to_location_id: Number(to), notes, dispatch, items });
      toast.success(`${t.ref} created${dispatch ? ' and dispatched' : ''}`);
      onDone();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New stock transfer" size="lg"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? <Spinner /> : <Truck size={16} />} {dispatch ? 'Create & dispatch' : 'Save draft'}
        </button></>}>
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <Field label="From">
          <select className="input" value={from} onChange={(e) => setFrom(Number(e.target.value))}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="To">
          <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose…</option>
            {locations.filter((l) => l.id !== from).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Notes">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>

      <VariantPicker onPick={add} placeholder="Search a product to transfer…" />

      {lines.length > 0 && (
        <div className="mt-3 rounded-lg ring-1 ring-slate-200 overflow-hidden">
          <table className="data">
            <thead><tr><th>Item</th><th className="text-right w-28">Qty</th><th className="w-10"></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <div className="text-sm font-medium">{l.label}</div>
                    <div className="text-xs text-slate-500">{num(l.available)} available at source</div>
                  </td>
                  <td><input type="number" className="input py-1 text-right" value={l.quantity}
                    onChange={(e) => setLines((p) => p.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))} /></td>
                  <td><button className="btn-ghost p-1.5 text-rose-600"
                    onClick={() => setLines((p) => p.filter((_, x) => x !== i))}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-700 mt-4">
        <input type="checkbox" checked={dispatch} onChange={(e) => setDispatch(e.target.checked)}
          className="rounded border-slate-300" />
        Dispatch now — units leave the source shop and become "in transit"
      </label>
    </Modal>
  );
}

/**
 * Send a box by reading it.
 *
 * The manifest is built from what the reader hears, so it cannot disagree with
 * what is physically in the box — which is the failure mode of every
 * pick-from-a-list transfer: the list says six, the box holds five, and nobody
 * finds out until the other branch counts it a week later.
 */
function ScanToSend({ open, onClose, onDone }) {
  const toast = useToast();
  const { locations, locationId } = useAuth();
  const [to, setTo] = useState('');
  const [codes, setCodes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const add = useCallback((code) => {
    setCodes((c) => (c.includes(code) ? c : [...c, code]));
    if (navigator.vibrate) navigator.vibrate(25);
  }, []);

  const scan = useRfidScan(add, { dedupeMs: 3000, tagsOnly: true, enabled: open });

  useEffect(() => { if (open) { setCodes([]); setResult(null); setTo(''); } }, [open]);

  const send = async () => {
    setBusy(true);
    try {
      const t = await api.post('/api/transfers/from-scan', {
        from_location_id: locationId, to_location_id: Number(to), codes });
      setResult(t.summary);
      toast.success(`${t.ref} dispatched — ${t.summary.sent} unit(s) on their way`);
      // Anything the reader picked up that could not be sent is worth looking
      // at before the box is taped shut, so hold the modal open when there is
      // something to report.
      if (!t.summary.rejected.length && !t.summary.unknown_tags.length) onDone(t);
      else setCodes([]);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Scan a box out"
      subtitle="Read everything going into the box — the manifest is what the reader hears"
      footer={
        <>
          <span className="mr-auto text-sm text-slate-500">
            {num(codes.length)} tag(s) read
          </span>
          <button className="btn-secondary" onClick={() => setCodes([])} disabled={!codes.length}>
            Clear
          </button>
          <button className="btn-primary" onClick={send} disabled={busy || !codes.length || !to}>
            {busy ? <Spinner /> : <Truck size={16} />} Dispatch to branch
          </button>
        </>
      }>
      <scan.CaptureField />

      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <Field label="Send to">
          <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose a branch…</option>
            {locations.filter((l) => l.id !== locationId).map((l) =>
              <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        {scan.native && (
          <Field label="Reader">
            <button onClick={scan.toggle} className={scan.scanning ? 'btn-danger w-full' : 'btn-secondary w-full'}>
              {scan.scanning ? <><Square size={16} /> Stop reading</> : <><Radio size={16} /> Read continuously</>}
            </button>
          </Field>
        )}
      </div>

      {result && (
        <div className="space-y-2 mb-4">
          {result.rejected.map((x, i) => (
            <div key={i} className="rounded-lg bg-amber-50 ring-1 ring-amber-200 p-3 text-sm flex gap-2">
              <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <span className="text-amber-900"><strong>{x.product_name}</strong> — {x.note}</span>
            </div>
          ))}
          {result.unknown_tags.length > 0 && (
            <div className="rounded-lg bg-rose-50 ring-1 ring-rose-200 p-3 text-sm flex gap-2">
              <AlertTriangle size={16} className="text-rose-600 shrink-0 mt-0.5" />
              <span className="text-rose-900">
                {result.unknown_tags.length} tag(s) are not in the system at all. Tag that stock
                before sending it, or it will arrive as a surprise at the other end.
              </span>
            </div>
          )}
        </div>
      )}

      {codes.length === 0 ? (
        <Empty title="Nothing read yet" icon={Radio}
          hint={scan.native
            ? 'Press Read continuously, or pull the trigger, and sweep the box.'
            : 'Pull the trigger on the handheld and sweep the box.'} />
      ) : (
        <div className="table-wrap max-h-72 overflow-y-auto">
          <table className="data">
            <thead><tr><th>#</th><th>Tag</th><th /></tr></thead>
            <tbody>
              {codes.map((c, i) => (
                <tr key={c}>
                  <td className="text-slate-400">{i + 1}</td>
                  <td className="font-mono text-xs">{c}</td>
                  <td className="text-right">
                    <button className="btn-ghost text-rose-600 text-xs"
                      onClick={() => setCodes((x) => x.filter((y) => y !== c))}>
                      <X size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/**
 * Receive a box by reading it.
 *
 * This is where per-unit tags pay for themselves: a quantity receive can only
 * confirm the count matched, while this confirms the contents did, and names
 * anything on the manifest that did not turn up.
 */
function ScanToReceive({ open, transfer, onClose, onDone }) {
  const toast = useToast();
  const [codes, setCodes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState(null);

  const add = useCallback((code) => {
    setCodes((c) => (c.includes(code) ? c : [...c, code]));
    if (navigator.vibrate) navigator.vibrate(25);
  }, []);
  const scan = useRfidScan(add, { dedupeMs: 3000, tagsOnly: true, enabled: open });

  useEffect(() => { if (open) { setCodes([]); setSummary(null); } }, [open]);

  const receive = async () => {
    setBusy(true);
    try {
      const t = await api.post(`/api/transfers/${transfer.id}/receive`, { codes });
      setSummary(t.summary);
      toast.success(`${t.summary.received} unit(s) received into stock`);
      onDone(t);
      setCodes([]);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const expected = (transfer.units || []).filter((u) => !u.received).length;

  return (
    <Modal open={open} onClose={onClose} size="lg" title={`Scan in ${transfer.ref}`}
      subtitle={`${expected} unit(s) still expected from ${transfer.from_location_name}`}
      footer={
        <>
          <span className="mr-auto text-sm text-slate-500">{num(codes.length)} tag(s) read</span>
          <button className="btn-primary" onClick={receive} disabled={busy || !codes.length}>
            {busy ? <Spinner /> : <PackageCheck size={16} />} Receive what was scanned
          </button>
        </>
      }>
      <scan.CaptureField />

      {scan.native && (
        <button onClick={scan.toggle}
          className={`${scan.scanning ? 'btn-danger' : 'btn-secondary'} w-full mb-4`}>
          {scan.scanning ? <><Square size={16} /> Stop reading</> : <><Radio size={16} /> Read continuously</>}
        </button>
      )}

      {summary ? (
        <div className="space-y-2">
          <div className="rounded-lg bg-emerald-50 ring-1 ring-emerald-200 p-3 text-sm flex gap-2">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
            <span className="text-emerald-900">
              {summary.received} unit(s) landed in stock here.
            </span>
          </div>
          {summary.missing.length > 0 && (
            <div className="rounded-lg bg-rose-50 ring-1 ring-rose-200 p-3 text-sm">
              <p className="font-medium text-rose-900 flex items-center gap-2">
                <AlertTriangle size={16} /> {summary.missing.length} unit(s) on the manifest were not in the box
              </p>
              <ul className="mt-2 space-y-0.5 text-rose-800 text-xs">
                {summary.missing.slice(0, 20).map((m) => (
                  <li key={m.id}>
                    {m.product_name} {[m.size, m.color].filter(Boolean).join(' / ')}
                    <span className="font-mono text-rose-600"> · {m.epc_readable}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-rose-700 mt-2">
                They stay in transit until they turn up, so neither branch counts them as stock.
              </p>
            </div>
          )}
          {summary.not_on_this_transfer.length > 0 && (
            <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 p-3 text-sm text-amber-900">
              {summary.not_on_this_transfer.length} unit(s) in the box are not on this transfer.
            </div>
          )}
          {summary.unknown_tags.length > 0 && (
            <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 p-3 text-sm text-slate-700">
              {summary.unknown_tags.length} tag(s) are not in the system at all.
            </div>
          )}
        </div>
      ) : codes.length === 0 ? (
        <Empty title="Nothing read yet" icon={Radio} hint="Sweep the box as you unpack it." />
      ) : (
        <p className="text-sm text-slate-600">
          {num(codes.length)} tag(s) read so far. Receive when the box is empty.
        </p>
      )}
    </Modal>
  );
}

function TransferDetail({ id, onClose, onChanged }) {
  const toast = useToast();
  const { can, locationId } = useAuth();
  const [t, setT] = useState(null);
  const [busy, setBusy] = useState(false);
  const [receiveScan, setReceiveScan] = useState(false);

  const load = useCallback(() => api.get(`/api/transfers/${id}`).then(setT).catch((e) => toast.error(e.message)), [id]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  const act = async (path, body) => {
    setBusy(true);
    try {
      const res = await api.post(`/api/transfers/${id}/${path}`, body || {});
      setT(res.ok ? await api.get(`/api/transfers/${id}`) : res);
      onChanged?.();
      toast.success('Transfer updated');
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  if (!t) return <Modal open onClose={onClose} title="Transfer"><Loading /></Modal>;
  const canReceive = t.status === 'in_transit' && (t.to_location_id === locationId || can('transfers.write'));

  return (
    <Modal open onClose={onClose} size="lg" title={t.ref}
      subtitle={`${t.from_location_name} → ${t.to_location_name}`}
      footer={
        <>
          <Badge status={t.status} className="mr-auto" />
          {can('transfers.write') && t.status === 'draft' && (
            <button className="btn-primary" onClick={() => act('dispatch')} disabled={busy}>
              <Truck size={16} /> Dispatch
            </button>
          )}
          {can('transfers.write') && ['draft', 'in_transit'].includes(t.status) && (
            <ConfirmButton className="btn-secondary" message="Cancel transfer?"
              onConfirm={() => act('cancel')}>Cancel transfer</ConfirmButton>
          )}
          {canReceive && (
            <>
              <button className="btn-secondary" onClick={() => setReceiveScan(true)} disabled={busy}>
                <ScanLine size={16} /> Scan the box in
              </button>
              <button className="btn-primary" onClick={() => act('receive')} disabled={busy}>
                {busy ? <Spinner /> : <PackageCheck size={16} />} Confirm receipt
              </button>
            </>
          )}
        </>
      }>
      <div className="table-wrap mb-4">
        <table className="data">
          <thead><tr><th>Item</th><th className="text-right">Sent</th><th className="text-right">Received</th></tr></thead>
          <tbody>
            {t.items.map((i) => (
              <tr key={i.id}>
                <td>
                  <div className="font-medium text-slate-800">{i.product_name}</div>
                  <div className="text-xs text-slate-500">
                    {[i.size, i.color].filter(Boolean).join(' / ')} · <span className="font-mono">{i.sku}</span>
                  </div>
                </td>
                <td className="text-right tabular-nums">{num(i.quantity)}</td>
                <td className="text-right tabular-nums">{num(i.received_quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {t.units.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1.5">
            <Radio size={13} /> Tagged units on this transfer
          </p>
          <div className="max-h-52 overflow-y-auto rounded-lg ring-1 ring-slate-200">
            <table className="data">
              <thead><tr><th>EPC</th><th>Product</th><th>Status</th><th>Received</th></tr></thead>
              <tbody>
                {t.units.map((u) => (
                  <tr key={u.unit_id}>
                    <td className="font-mono text-xs">{u.epc_readable}</td>
                    <td className="text-sm">{u.product_name} <span className="text-slate-500">
                      {[u.size, u.color].filter(Boolean).join(' / ')}</span></td>
                    <td><Badge status={u.status} /></td>
                    <td>{u.received ? '✓' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {t.notes && <p className="text-xs text-slate-500 mt-3">{t.notes}</p>}

      {receiveScan && (
        <ScanToReceive open transfer={t} onClose={() => setReceiveScan(false)}
          onDone={(next) => { setT({ ...t, ...next }); onChanged?.(); }} />
      )}
    </Modal>
  );
}
