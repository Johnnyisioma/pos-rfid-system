import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Truck, PackageCheck, Trash2, Users, Radio, ShoppingBag, Undo2, AlertTriangle,
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, num, date, dateTime, daysAgo, today } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, Pagination, useToast, Field, Tabs, Spinner, ConfirmButton, Stat,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTabParam } from '../lib/useTabParam.js';
import VariantPicker from '../components/VariantPicker.jsx';
import ExportButtons from '../components/ExportButtons.jsx';

export default function Purchases() {
  const [tab, setTab] = useTabParam('orders');

  // The sidebar links "Add purchase" as ?tab=new. Treat it as the orders tab
  // with the editor already open, rather than a tab of its own.
  const wantsNew = tab === 'new';
  const active = wantsNew ? 'orders' : tab;

  return (
    <>
      <PageHeader title="Purchases" subtitle="Purchase orders, goods receiving, returns and suppliers" />
      <Tabs className="mb-4" value={active} onChange={setTab} tabs={[
        { value: 'orders', label: 'Purchase orders' },
        { value: 'returns', label: 'Purchase returns' },
        { value: 'suppliers', label: 'Suppliers' },
        { value: 'reorder', label: 'Reorder suggestions' },
      ]} />
      {active === 'orders' && <Orders autoNew={wantsNew} onNewHandled={() => setTab('orders')} />}
      {active === 'returns' && <PurchaseReturns />}
      {active === 'suppliers' && <Suppliers />}
      {active === 'reorder' && <Reorder />}
    </>
  );
}

const PO_COLUMNS = [
  { key: 'po_number', label: 'PO number' },
  { key: 'supplier_name', label: 'Supplier' },
  { key: 'location_name', label: 'Location' },
  { key: 'status', label: 'Status' },
  { key: 'ordered_qty', label: 'Ordered', align: 'right' },
  { key: 'received_qty', label: 'Received', align: 'right' },
  { key: 'total', label: 'Total', align: 'right', format: (v) => money(v) },
  { key: 'order_date', label: 'Date', format: (v) => date(v) },
];

const RETURN_COLUMNS = [
  { key: 'ref', label: 'Reference' },
  { key: 'created_at', label: 'Date', format: (v) => date(v) },
  { key: 'supplier_name', label: 'Supplier' },
  { key: 'po_number', label: 'Against PO' },
  { key: 'location_name', label: 'Location' },
  { key: 'reason', label: 'Reason' },
  { key: 'total_qty', label: 'Units', align: 'right' },
  { key: 'total', label: 'Value', align: 'right', format: (v) => money(v) },
  { key: 'credit_note', label: 'Credit note' },
  { key: 'user_name', label: 'Recorded by' },
];

/* ---------------- purchase orders ---------------- */
function Orders({ autoNew, onNewHandled }) {
  const { can, locationId } = useAuth();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setData(null);
    setData(await api.get(`/api/purchases${qs({ status, page, limit: 25 })}`).catch(() => ({ data: [] })));
  }, [status, page, locationId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (autoNew && can('purchases.write')) { setCreating(true); onNewHandled?.(); }
  }, [autoNew]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Card bodyClass="p-0">
        <div className="p-4 flex flex-wrap gap-2 border-b border-slate-100">
          <select className="input w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {['draft', 'ordered', 'partial', 'received', 'cancelled'].map((s) =>
              <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
          <div className="flex-1" />
          <ExportButtons title="Purchase orders" columns={PO_COLUMNS} rows={data?.data || []}
            filename="purchase-orders" />
          {can('purchases.write') && (
            <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New purchase order</button>
          )}
        </div>

        {!data ? <Loading /> : data.data.length === 0 ? (
          <Empty title="No purchase orders yet" icon={Truck}
            hint="Raise one to track what you ordered, from whom, and what actually arrived." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>PO number</th><th>Supplier</th><th>Location</th><th>Status</th>
                  <th className="text-right">Ordered</th><th className="text-right">Received</th>
                  <th className="text-right">Total</th><th>Date</th></tr></thead>
                <tbody>
                  {data.data.map((po) => (
                    <tr key={po.id} className="cursor-pointer" onClick={() => setOpen(po.id)}>
                      <td className="font-mono text-xs font-medium text-brand-700">{po.po_number}</td>
                      <td>{po.supplier_name || '—'}</td>
                      <td className="text-slate-600">{po.location_name}</td>
                      <td><Badge status={po.status} /></td>
                      <td className="text-right tabular-nums">{num(po.ordered_qty)}</td>
                      <td className="text-right tabular-nums">{num(po.received_qty)}</td>
                      <td className="text-right tabular-nums">{money(po.total)}</td>
                      <td className="text-slate-500 text-xs whitespace-nowrap">{date(po.order_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <PoEditor open={creating} onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />
      {open && <PoDetail id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}

function PoEditor({ open, onClose, onDone, prefill }) {
  const { locationId, locations } = useAuth();
  const toast = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState({ supplier_id: '', location_id: locationId, expected_date: '', notes: '', status: 'ordered' });
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get('/api/suppliers?limit=200').then((r) => setSuppliers(r.data)).catch(() => {});
    setForm((f) => ({ ...f, location_id: locationId }));
    setLines(prefill || []);
  }, [open, locationId, prefill]);

  const add = (v) => setLines((p) => [...p, {
    variant_id: v.variant_id, label: `${v.name} · ${[v.size, v.color].filter(Boolean).join(' / ') || 'default'}`,
    sku: v.sku, quantity: 1, unit_cost: v.cost_price ?? 0,
  }]);
  const setLine = (i, patch) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0);

  const submit = async () => {
    const items = lines.filter((l) => l.variant_id && Number(l.quantity) > 0);
    if (!items.length) return toast.error('Add at least one line');
    setBusy(true);
    try {
      const po = await api.post('/api/purchases', { ...form, items });
      toast.success(`${po.po_number} created`);
      onDone();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New purchase order" size="lg"
      footer={<><span className="mr-auto text-sm text-slate-600">Total {money(total)}</span>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? <Spinner /> : null} Create</button></>}>
      <div className="grid sm:grid-cols-4 gap-3 mb-4">
        <Field label="Supplier" className="sm:col-span-2">
          <select className="input" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
            <option value="">—</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Deliver to">
          <select className="input" value={form.location_id} onChange={(e) => setForm({ ...form, location_id: Number(e.target.value) })}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Expected date">
          <input type="date" className="input" value={form.expected_date}
            onChange={(e) => setForm({ ...form, expected_date: e.target.value })} />
        </Field>
        <Field label="Notes" className="sm:col-span-4">
          <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>

      <VariantPicker onPick={add} placeholder="Search a product to order…" />

      {lines.length > 0 && (
        <div className="mt-3 rounded-lg ring-1 ring-slate-200 overflow-hidden">
          <table className="data">
            <thead><tr><th>Item</th><th className="text-right w-24">Qty</th>
              <th className="text-right w-32">Unit cost</th><th className="text-right w-32">Line total</th><th className="w-10"></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <div className="text-sm font-medium">{l.label}</div>
                    <div className="text-xs text-slate-500 font-mono">{l.sku}</div>
                  </td>
                  <td><input type="number" className="input py-1 text-right" value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                  <td><input type="number" className="input py-1 text-right" value={l.unit_cost}
                    onChange={(e) => setLine(i, { unit_cost: e.target.value })} /></td>
                  <td className="text-right tabular-nums">{money(Number(l.quantity || 0) * Number(l.unit_cost || 0))}</td>
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

function PoDetail({ id, onClose, onChanged }) {
  const toast = useToast();
  const { can } = useAuth();
  const [po, setPo] = useState(null);
  const [receiving, setReceiving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(() => api.get(`/api/purchases/${id}`).then(setPo).catch((e) => toast.error(e.message)), [id]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  const startReceive = () => setReceiving(
    po.items.map((i) => ({ item_id: i.id, label: `${i.product_name} · ${[i.size, i.color].filter(Boolean).join(' / ')}`,
      outstanding: Number(i.quantity) - Number(i.received_quantity), quantity: Number(i.quantity) - Number(i.received_quantity),
      unit_cost: i.unit_cost })));

  const receive = async () => {
    const items = receiving.filter((r) => Number(r.quantity) > 0)
      .map((r) => ({ item_id: r.item_id, quantity: Number(r.quantity), unit_cost: Number(r.unit_cost) }));
    if (!items.length) return toast.error('Nothing to receive');
    setBusy(true);
    try {
      const res = await api.post(`/api/purchases/${id}/receive`, { items });
      setResult(res);
      setReceiving(null);
      setPo(res.purchase_order);
      onChanged?.();
      toast.success(`${res.units_created} unit(s) received and tagged`);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  if (!po) return <Modal open onClose={onClose} title="Purchase order"><Loading /></Modal>;

  return (
    <Modal open onClose={onClose} size="lg"
      title={po.po_number}
      subtitle={`${po.supplier_name || 'No supplier'} · ${po.location_name}`}
      footer={
        <>
          <Badge status={po.status} className="mr-auto" />
          {can('purchases.write') && po.status !== 'received' && po.status !== 'cancelled' && (
            <>
              <ConfirmButton className="btn-secondary" message="Cancel this PO?"
                onConfirm={async () => { await api.post(`/api/purchases/${id}/cancel`, {}); onChanged?.(); onClose(); }}>
                Cancel PO
              </ConfirmButton>
              {!receiving && <button className="btn-primary" onClick={startReceive}>
                <PackageCheck size={16} /> Receive goods
              </button>}
            </>
          )}
          {receiving && (
            <button className="btn-primary" onClick={receive} disabled={busy}>
              {busy ? <Spinner /> : <PackageCheck size={16} />} Confirm receipt
            </button>
          )}
        </>
      }>
      {result && (
        <div className="mb-4 rounded-lg bg-emerald-50 ring-1 ring-emerald-200 p-3">
          <p className="text-sm font-medium text-emerald-900 flex items-center gap-2">
            <Radio size={15} /> {result.units_created} unit(s) created, each with its own EPC
          </p>
          <div className="mt-2 max-h-40 overflow-y-auto text-xs font-mono text-emerald-900 space-y-0.5">
            {result.units.map((u) => <div key={u.id}>{u.epc} · {u.epc_readable}</div>)}
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Item</th><th className="text-right">Ordered</th><th className="text-right">Received</th>
              <th className="text-right">Unit cost</th>
              {receiving && <th className="text-right w-28">Receive now</th>}</tr>
          </thead>
          <tbody>
            {po.items.map((i, idx) => (
              <tr key={i.id}>
                <td>
                  <div className="font-medium text-slate-800">{i.product_name}</div>
                  <div className="text-xs text-slate-500">
                    {[i.size, i.color].filter(Boolean).join(' / ')} · <span className="font-mono">{i.sku}</span>
                  </div>
                </td>
                <td className="text-right tabular-nums">{num(i.quantity)}</td>
                <td className="text-right tabular-nums">{num(i.received_quantity)}</td>
                <td className="text-right tabular-nums">{money(i.unit_cost)}</td>
                {receiving && (
                  <td>
                    <input type="number" className="input py-1 text-right" value={receiving[idx]?.quantity ?? 0}
                      max={receiving[idx]?.outstanding}
                      onChange={(e) => setReceiving((p) => p.map((r, x) => x === idx ? { ...r, quantity: e.target.value } : r))} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="mt-4 text-sm space-y-1 max-w-xs ml-auto">
        <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="tabular-nums">{money(po.subtotal)}</dd></div>
        <div className="flex justify-between font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(po.total)}</dd></div>
      </dl>
      {po.notes && <p className="text-xs text-slate-500 mt-3">{po.notes}</p>}
    </Modal>
  );
}

/* ---------------- suppliers ---------------- */
function Suppliers() {
  const { can } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(() =>
    api.get(`/api/suppliers${qs({ q, limit: 100 })}`).then(setData).catch(() => setData({ data: [] })), [q]);
  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    try {
      if (form.id) await api.put(`/api/suppliers/${form.id}`, form);
      else await api.post('/api/suppliers', form);
      toast.success('Supplier saved');
      setEditing(null);
      load();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <>
      <Card bodyClass="p-0">
        <div className="p-4 flex gap-2 border-b border-slate-100">
          <input className="input flex-1" placeholder="Search suppliers…" value={q} onChange={(e) => setQ(e.target.value)} />
          {can('suppliers.write') && (
            <button className="btn-primary" onClick={() => setEditing({})}><Plus size={16} /> New supplier</button>
          )}
        </div>
        {!data ? <Loading /> : data.data.length === 0 ? <Empty title="No suppliers yet" icon={Users} /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Supplier</th><th>Contact</th><th className="text-right">Orders</th>
                <th className="text-right">Purchased</th><th className="text-right">Outstanding</th><th></th></tr></thead>
              <tbody>
                {data.data.map((s) => (
                  <tr key={s.id}>
                    <td><div className="font-medium text-slate-800">{s.name}</div>
                      <div className="text-xs text-slate-500">{s.address}</div></td>
                    <td className="text-slate-600 text-sm">
                      {s.contact_person}<div className="text-xs text-slate-500">{s.phone} {s.email}</div>
                    </td>
                    <td className="text-right tabular-nums">{num(s.po_count)}</td>
                    <td className="text-right tabular-nums">{money(s.purchased_value)}</td>
                    <td className="text-right tabular-nums">{money(s.outstanding)}</td>
                    <td className="text-right">
                      {can('suppliers.write') && (
                        <button className="btn-ghost text-xs" onClick={() => setEditing(s)}>Edit</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <SupplierModal supplier={editing} onClose={() => setEditing(null)} onSave={save} />}
    </>
  );
}

function SupplierModal({ supplier, onClose, onSave }) {
  const [form, setForm] = useState({
    name: '', contact_person: '', phone: '', email: '', address: '', notes: '', ...supplier,
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title={supplier.id ? 'Edit supplier' : 'New supplier'} size="sm"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave(form)}>Save</button></>}>
      <div className="space-y-3">
        <Field label="Name"><input className="input" value={form.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Contact person"><input className="input" value={form.contact_person} onChange={set('contact_person')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
          <Field label="Email"><input className="input" value={form.email} onChange={set('email')} /></Field>
        </div>
        <Field label="Address"><input className="input" value={form.address} onChange={set('address')} /></Field>
        <Field label="Notes"><textarea className="input" rows="2" value={form.notes} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

/* ---------------- reorder suggestions ---------------- */
function Reorder() {
  const { locationId } = useAuth();
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setRows(null);
    api.get('/api/purchases/suggestions/reorder').then(setRows).catch(() => setRows([]));
  }, [locationId]);

  if (!rows) return <Loading />;

  const prefill = rows.filter((r) => selected.includes(r.variant_id)).map((r) => ({
    variant_id: r.variant_id,
    label: `${r.product_name} · ${[r.size, r.color].filter(Boolean).join(' / ') || 'default'}`,
    sku: r.sku, quantity: Number(r.suggested_qty), unit_cost: Number(r.cost_price),
  }));

  return (
    <>
      <Card bodyClass="p-0"
        title={`${rows.length} line(s) below the reorder point`}
        actions={selected.length > 0 && (
          <button className="btn-primary text-xs" onClick={() => setCreating(true)}>
            <ShoppingBag size={14} /> Create PO for {selected.length}
          </button>
        )}>
        {rows.length === 0 ? <Empty title="Nothing needs reordering" icon={PackageCheck} /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th className="w-10"></th><th>Product</th><th>Variant</th>
                <th className="text-right">On hand</th><th className="text-right">Reorder at</th>
                <th className="text-right">Suggested</th><th className="text-right">Est. cost</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.variant_id}>
                    <td>
                      <input type="checkbox" className="rounded border-slate-300"
                        checked={selected.includes(r.variant_id)}
                        onChange={() => setSelected((s) => s.includes(r.variant_id)
                          ? s.filter((x) => x !== r.variant_id) : [...s, r.variant_id])} />
                    </td>
                    <td className="font-medium text-slate-800">{r.product_name}</td>
                    <td className="text-slate-600">{[r.size, r.color].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="text-right tabular-nums text-amber-700 font-medium">{num(r.on_hand)}</td>
                    <td className="text-right tabular-nums text-slate-500">{num(r.reorder_point)}</td>
                    <td className="text-right tabular-nums font-medium">{num(r.suggested_qty)}</td>
                    <td className="text-right tabular-nums">{money(Number(r.suggested_qty) * Number(r.cost_price))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <PoEditor open={creating} prefill={prefill} onClose={() => setCreating(false)}
        onDone={() => { setCreating(false); setSelected([]); }} />
    </>
  );
}

/* ---------------- purchase returns ---------------- */
/**
 * Bad goods going back to the supplier. Deliberately not a stock adjustment:
 * an adjustment would bury supplier damage inside shrinkage and quietly
 * inflate what looks like staff loss. This takes the units out under their
 * own status and keeps the money on the supplier's account.
 */
const RETURN_REASONS = [
  'Damaged in transit', 'Faulty / defective', 'Wrong item supplied',
  'Wrong size or colour', 'Short-dated or expired', 'Over-supplied',
  'Quality below standard', 'Other',
];

function PurchaseReturns() {
  const { can, locationId } = useAuth();
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setData(null);
    setData(await api.get(`/api/purchases/returns${qs({ page, limit: 25 })}`)
      .catch(() => ({ data: [], total: 0, value: 0 })));
  }, [page, locationId]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <Stat label="Returns recorded" value={num(data?.total || 0)} icon={Undo2} />
        <Stat label="Value sent back" value={money(data?.value || 0)} tone="warn" />
        <Stat label="This page" value={num(data?.data?.length || 0)} />
      </div>

      <Card bodyClass="p-0">
        <div className="p-4 flex flex-wrap gap-2 border-b border-slate-100">
          <p className="text-sm text-slate-500 self-center flex-1 min-w-0">
            Goods sent back to a supplier — kept out of shrinkage so your loss figures stay honest.
          </p>
          <ExportButtons report="purchase-returns" title="Purchase returns"
            columns={RETURN_COLUMNS} rows={data?.data || []}
            params={{ from: daysAgo(365), to: today() }} />
          {can('purchases.write') && (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> Record return
            </button>
          )}
        </div>

        {!data ? <Loading /> : data.data.length === 0 ? (
          <Empty title="No purchase returns" icon={Undo2}
            hint="When a delivery arrives damaged or wrong, record it here rather than adjusting stock away." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Reference</th><th>Supplier</th><th>Against PO</th><th>Reason</th>
                  <th className="text-right">Units</th><th className="text-right">Value</th>
                  <th>Credit note</th><th>Date</th></tr></thead>
                <tbody>
                  {data.data.map((r) => (
                    <tr key={r.id} className="cursor-pointer" onClick={() => setOpen(r.id)}>
                      <td className="font-mono text-xs font-medium text-brand-700">{r.ref}</td>
                      <td>{r.supplier_name || '—'}</td>
                      <td className="font-mono text-xs text-slate-500">{r.po_number || '—'}</td>
                      <td className="text-slate-600 text-sm">{r.reason}</td>
                      <td className="text-right tabular-nums">{num(r.total_qty)}</td>
                      <td className="text-right tabular-nums">{money(r.total)}</td>
                      <td className="text-xs text-slate-500">{r.credit_note || '—'}</td>
                      <td className="text-slate-500 text-xs whitespace-nowrap">{date(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      {creating && (
        <ReturnEditor onClose={() => setCreating(false)}
          onDone={() => { setCreating(false); load(); }} />
      )}
      {open && <ReturnDetail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ReturnEditor({ onClose, onDone }) {
  const { locationId, locations } = useAuth();
  const toast = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [pos, setPos] = useState([]);
  const [form, setForm] = useState({
    supplier_id: '', po_id: '', location_id: locationId,
    reason: RETURN_REASONS[0], notes: '', credit_note: '',
  });
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/suppliers?limit=200').then((r) => setSuppliers(r.data)).catch(() => {});
    api.get('/api/purchases?limit=50&status=received').then((r) => setPos(r.data)).catch(() => {});
  }, []);

  const add = (v) => setLines((p) => {
    if (p.some((l) => l.variant_id === v.variant_id)) return p;
    return [...p, {
      variant_id: v.variant_id,
      label: `${v.name} · ${[v.size, v.color].filter(Boolean).join(' / ') || 'default'}`,
      sku: v.sku, on_hand: v.quantity ?? v.on_hand ?? null,
      quantity: 1, unit_cost: v.cost_price ?? 0,
    }];
  });
  const setLine = (i, patch) => setLines((p) => p.map((l, x) => (x === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0);

  const submit = async () => {
    const items = lines.filter((l) => l.variant_id && Number(l.quantity) > 0)
      .map((l) => ({ variant_id: l.variant_id, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost) }));
    if (!items.length) return toast.error('Add at least one item to return');
    if (!form.reason.trim()) return toast.error('A reason is required');
    setBusy(true);
    try {
      const res = await api.post('/api/purchases/returns', { ...form, items });
      toast.success(`${res.ref} recorded · ${money(res.total)} sent back`);
      onDone();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Record a purchase return" size="lg"
      subtitle="Units come out of stock under their own status, not as shrinkage."
      footer={<><span className="mr-auto text-sm text-slate-600">Value {money(total)}</span>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? <Spinner /> : <Undo2 size={16} />} Record return
        </button></>}>
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <Field label="Supplier">
          <select className="input" value={form.supplier_id}
            onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
            <option value="">—</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Against PO" hint="Optional, but it ties the credit to the right delivery">
          <select className="input" value={form.po_id}
            onChange={(e) => setForm({ ...form, po_id: e.target.value })}>
            <option value="">—</option>
            {pos.map((p) => <option key={p.id} value={p.id}>{p.po_number}</option>)}
          </select>
        </Field>
        <Field label="From location">
          <select className="input" value={form.location_id}
            onChange={(e) => setForm({ ...form, location_id: Number(e.target.value) })}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Reason" className="sm:col-span-2">
          <select className="input" value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}>
            {RETURN_REASONS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Supplier credit note">
          <input className="input" placeholder="CN-…" value={form.credit_note}
            onChange={(e) => setForm({ ...form, credit_note: e.target.value })} />
        </Field>
        <Field label="Notes" className="sm:col-span-3">
          <input className="input" value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>

      <VariantPicker onPick={add} placeholder="Search the item you are sending back…" />

      {lines.length > 0 && (
        <div className="mt-3 rounded-lg ring-1 ring-slate-200 overflow-hidden">
          <table className="data">
            <thead><tr><th>Item</th><th className="text-right w-24">Qty</th>
              <th className="text-right w-32">Unit cost</th>
              <th className="text-right w-32">Line value</th><th className="w-10"></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.variant_id}>
                  <td>
                    <div className="text-sm font-medium">{l.label}</div>
                    <div className="text-xs text-slate-500 font-mono">{l.sku}</div>
                  </td>
                  <td><input type="number" min="1" className="input py-1 text-right" value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                  <td><input type="number" className="input py-1 text-right" value={l.unit_cost}
                    onChange={(e) => setLine(i, { unit_cost: e.target.value })} /></td>
                  <td className="text-right tabular-nums">
                    {money(Number(l.quantity || 0) * Number(l.unit_cost || 0))}
                  </td>
                  <td><button className="btn-ghost p-1.5 text-rose-600"
                    onClick={() => setLines((p) => p.filter((_, x) => x !== i))}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 ring-1 ring-amber-200 rounded-lg p-2.5">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        The system picks the actual tagged units to send back and marks them
        <span className="font-mono mx-1">returned_supplier</span>. They stop counting as sellable
        stock straight away, and the supplier's outstanding balance drops by the return value.
      </p>
    </Modal>
  );
}

function ReturnDetail({ id, onClose }) {
  const [ret, setRet] = useState(null);
  useEffect(() => { api.get(`/api/purchases/returns/${id}`).then(setRet).catch(() => {}); }, [id]);
  if (!ret) return <Modal open onClose={onClose} title="Purchase return"><Loading /></Modal>;

  return (
    <Modal open onClose={onClose} size="lg" title={ret.ref}
      subtitle={`${ret.supplier_name || 'No supplier'} · ${ret.location_name} · ${dateTime(ret.created_at)}`}
      footer={<><span className="mr-auto text-sm font-medium text-slate-700">Value {money(ret.total)}</span>
        <button className="btn-primary" onClick={onClose}>Close</button></>}>
      <div className="flex flex-wrap gap-2 mb-4">
        <Badge>{ret.reason}</Badge>
        {ret.po_number && <Badge status="found">Against {ret.po_number}</Badge>}
        {ret.credit_note && <Badge>Credit note {ret.credit_note}</Badge>}
        {ret.user_name && <Badge>By {ret.user_name}</Badge>}
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Item</th><th className="text-right">Qty</th>
            <th className="text-right">Unit cost</th><th className="text-right">Line total</th></tr></thead>
          <tbody>
            {ret.items.map((i) => (
              <tr key={i.id}>
                <td>
                  <div className="font-medium text-slate-800">{i.product_name}</div>
                  <div className="text-xs text-slate-500">
                    {[i.size, i.color].filter(Boolean).join(' / ')} · <span className="font-mono">{i.sku}</span>
                  </div>
                </td>
                <td className="text-right tabular-nums">{num(i.quantity)}</td>
                <td className="text-right tabular-nums">{money(i.unit_cost)}</td>
                <td className="text-right tabular-nums">{money(i.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ret.units?.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            {ret.units.length} tagged unit(s) sent back
          </p>
          <div className="max-h-44 overflow-y-auto rounded-lg ring-1 ring-slate-200 divide-y divide-slate-100">
            {ret.units.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
                <span className="font-mono text-slate-700">{u.epc_readable}</span>
                <span className="text-slate-500 truncate">
                  {u.product_name} {[u.size, u.color].filter(Boolean).join(' / ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {ret.notes && <p className="text-xs text-slate-500 mt-3">{ret.notes}</p>}
    </Modal>
  );
}
