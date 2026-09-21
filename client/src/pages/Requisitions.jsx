import { useCallback, useEffect, useState } from 'react';
import {
  ClipboardCheck, Plus, Trash2, Check, X, ArrowRight, ShoppingCart,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { money, date } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, Pagination, useToast, Field, Spinner, Stat,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import VariantPicker from '../components/VariantPicker.jsx';

/**
 * Purchase requisitions — the ask-before-you-order control. A clerk raises a
 * requisition, a manager approves it, and an approved one converts to a real
 * purchase order in one click. Nobody commits the shop's money to a supplier
 * without a second signature.
 */
const STATUS_TONE = { pending: 'warning', approved: 'info', ordered: 'success', received: 'success', rejected: 'danger' };

export default function Requisitions() {
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(() => {
    api.get(`/api/requisitions${qs({ status, page, limit: 25 })}`)
      .then(setData).catch(() => setData({ data: [] }));
  }, [status, page]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageHeader title="Purchase requisitions"
        subtitle="Request stock, get it approved, then convert to a purchase order" />
      <div className="flex items-center gap-2 mb-3">
        <select className="input w-auto text-sm" value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {Object.keys(STATUS_TONE).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {can('purchases.write') && (
          <button className="btn-primary ml-auto text-sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> New requisition</button>)}
      </div>

      <Card bodyClass="p-0">
        {!data ? <Loading /> : data.data.length === 0
          ? <Empty icon={ClipboardCheck} title="No requisitions"
              hint="Raise a request for stock a branch is running low on." />
          : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Requisition</th><th>Branch</th><th>Required by</th>
                  <th className="text-right">Lines</th><th className="text-right">Est. value</th><th>Status</th></tr></thead>
                <tbody>
                  {data.data.map((rq) => (
                    <tr key={rq.id} className="cursor-pointer" onClick={() => setOpenId(rq.id)}>
                      <td>
                        <div className="font-mono text-sm">{rq.ref}</div>
                        <div className="text-xs text-slate-500">{date(rq.created_at)} · {rq.created_by_name}</div>
                      </td>
                      <td>{rq.location_name}</td>
                      <td className="text-sm">{rq.required_by ? date(rq.required_by) : '—'}</td>
                      <td className="text-right tabular-nums">{rq.line_count}</td>
                      <td className="text-right tabular-nums">{money(rq.est_total)}</td>
                      <td><Badge status={STATUS_TONE[rq.status]}>{rq.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>)}
        {data && <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
      </Card>

      {creating && <ReqEditor onClose={() => setCreating(false)}
        onDone={(rq) => { setCreating(false); load(); setOpenId(rq.id); }} />}
      {openId && <ReqDetail id={openId} can={can} onClose={() => setOpenId(null)}
        onChanged={load} onConverted={(poId) => nav(`/purchases?tab=orders`)} />}
    </>
  );
}

function ReqEditor({ onClose, onDone }) {
  const { locationId, locations } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ location_id: locationId, required_by: '', notes: '' });
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);

  const add = (v) => setLines((p) => {
    if (p.some((l) => l.variant_id === v.variant_id)) return p;
    return [...p, { variant_id: v.variant_id, label: `${v.name} · ${[v.size, v.color].filter(Boolean).join(' / ') || 'default'}`,
      sku: v.sku, quantity: 1, estimated_cost: v.cost_price ?? 0, on_hand: v.stock ?? null }];
  });
  const setLine = (i, patch) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.estimated_cost || 0), 0);

  const submit = async () => {
    const items = lines.filter((l) => l.variant_id && Number(l.quantity) > 0)
      .map((l) => ({ variant_id: l.variant_id, quantity: Number(l.quantity), estimated_cost: Number(l.estimated_cost) }));
    if (!items.length) return toast.error('Add at least one item');
    setBusy(true);
    try {
      const rq = await api.post('/api/requisitions', { ...form, items });
      toast.success(`${rq.ref} raised`); onDone(rq);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="New requisition" size="lg"
      footer={<><span className="mr-auto text-sm text-slate-600">Est. {money(total)}</span>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? <Spinner /> : null} Raise</button></>}>
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <Field label="Branch">
          <select className="input" value={form.location_id}
            onChange={(e) => setForm({ ...form, location_id: Number(e.target.value) })}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Required by">
          <input type="date" className="input" value={form.required_by}
            onChange={(e) => setForm({ ...form, required_by: e.target.value })} />
        </Field>
        <Field label="Notes">
          <input className="input" value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>

      <VariantPicker onPick={add} placeholder="Search a product to request…" />

      {lines.length > 0 && (
        <div className="mt-3 rounded-lg ring-1 ring-slate-200 overflow-hidden">
          <table className="data">
            <thead><tr><th>Item</th><th className="text-right w-20">On hand</th>
              <th className="text-right w-24">Qty</th><th className="text-right w-32">Est. cost</th><th className="w-8"></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td><div className="text-sm font-medium">{l.label}</div>
                    <div className="text-xs text-slate-500 font-mono">{l.sku}</div></td>
                  <td className="text-right text-sm tabular-nums">{l.on_hand ?? '—'}</td>
                  <td><input type="number" min="1" className="input py-1 text-right" value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                  <td><input type="number" className="input py-1 text-right" value={l.estimated_cost}
                    onChange={(e) => setLine(i, { estimated_cost: e.target.value })} /></td>
                  <td><button className="btn-ghost p-1.5 text-rose-600"
                    onClick={() => setLines((p) => p.filter((_, x) => x !== i))}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function ReqDetail({ id, can, onClose, onChanged, onConverted }) {
  const toast = useToast();
  const [rq, setRq] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get(`/api/requisitions/${id}`).then(setRq).catch((e) => toast.error(e.message)), [id]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  const act = async (path, body, msg) => {
    setBusy(true);
    try { await api.post(`/api/requisitions/${id}/${path}`, body || {}); toast.success(msg); load(); onChanged(); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  const convert = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/api/requisitions/${id}/convert`, {});
      toast.success(`Created ${r.po_number}`); onConverted(r.po_id);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  const reject = () => {
    const reason = window.prompt('Reason for rejecting?');
    if (reason !== null) act('reject', { reason }, 'Requisition rejected');
  };

  const estTotal = rq?.items?.reduce((s, it) => s + Number(it.quantity) * Number(it.estimated_cost), 0) || 0;

  return (
    <Modal open onClose={onClose} size="lg"
      title={rq ? rq.ref : 'Requisition'}
      subtitle={rq ? `${date(rq.created_at)} · ${rq.location_name}` : ''}
      footer={rq && <>
        <div className="mr-auto flex items-center gap-2">
          <Badge status={STATUS_TONE[rq.status]}>{rq.status}</Badge>
          {rq.po_number && <span className="text-xs text-slate-500">→ {rq.po_number}</span>}
        </div>
        {can('purchases.write') && rq.status === 'pending' && (<>
          <button className="btn-ghost text-rose-600" onClick={reject} disabled={busy}><X size={14} /> Reject</button>
          <button className="btn-primary" onClick={() => act('approve', {}, 'Approved')} disabled={busy}>
            <Check size={14} /> Approve</button>
        </>)}
        {can('purchases.write') && rq.status === 'approved' && (
          <button className="btn-primary" onClick={convert} disabled={busy}>
            {busy ? <Spinner /> : <ShoppingCart size={14} />} Convert to PO</button>)}
      </>}>
      {!rq ? <Loading /> : (
        <>
          {rq.rejected_reason && rq.status === 'rejected' && (
            <div className="mb-3 rounded-lg bg-rose-50 ring-1 ring-rose-200 px-3 py-2 text-sm text-rose-800">
              Rejected: {rq.rejected_reason}</div>)}
          <div className="rounded-lg ring-1 ring-slate-200 overflow-hidden">
            <table className="data">
              <thead><tr><th>Item</th><th className="text-right">On hand</th>
                <th className="text-right">Qty</th><th className="text-right">Est. cost</th>
                <th className="text-right">Line</th></tr></thead>
              <tbody>
                {rq.items.map((it) => (
                  <tr key={it.id}>
                    <td>
                      <div className="text-sm font-medium">{it.product_name || 'Deleted product'}</div>
                      <div className="text-xs text-slate-500">{[it.size, it.color].filter(Boolean).join(' / ')}</div>
                    </td>
                    <td className="text-right text-sm tabular-nums">{Number(it.on_hand)}</td>
                    <td className="text-right tabular-nums">{Number(it.quantity)}</td>
                    <td className="text-right tabular-nums">{money(it.estimated_cost)}</td>
                    <td className="text-right tabular-nums">{money(Number(it.quantity) * Number(it.estimated_cost))}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td colSpan={4}>Estimated total</td>
                  <td className="text-right tabular-nums">{money(estTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {rq.notes && <p className="mt-3 text-sm text-slate-600">{rq.notes}</p>}
        </>
      )}
    </Modal>
  );
}
