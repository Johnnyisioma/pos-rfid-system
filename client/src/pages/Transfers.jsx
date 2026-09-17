import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, ArrowLeftRight, Truck, PackageCheck, Trash2, Radio } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, num, dateTime, variantLabel } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, Pagination, useToast, Field, Spinner, ConfirmButton,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import VariantPicker from '../components/VariantPicker.jsx';

export default function Transfers() {
  const { can, locationId, locations } = useAuth();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
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
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New transfer
          </button>
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

function TransferDetail({ id, onClose, onChanged }) {
  const toast = useToast();
  const { can, locationId } = useAuth();
  const [t, setT] = useState(null);
  const [busy, setBusy] = useState(false);

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
            <button className="btn-primary" onClick={() => act('receive')} disabled={busy}>
              {busy ? <Spinner /> : <PackageCheck size={16} />} Confirm receipt
            </button>
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
    </Modal>
  );
}
