import { useEffect, useState, useCallback } from 'react';
import { Plus, Truck, PackageCheck, Trash2, Users, Radio, ShoppingBag, X } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, num, date, dateTime } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, Pagination, useToast, Field, Tabs, Spinner, ConfirmButton,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTabParam } from '../lib/useTabParam.js';
import VariantPicker from '../components/VariantPicker.jsx';

export default function Purchases() {
  const [tab, setTab] = useTabParam('orders');
  return (
    <>
      <PageHeader title="Purchases" subtitle="Purchase orders, goods receiving and suppliers" />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'orders', label: 'Purchase orders' },
        { value: 'suppliers', label: 'Suppliers' },
        { value: 'reorder', label: 'Reorder suggestions' },
      ]} />
      {tab === 'orders' && <Orders />}
      {tab === 'suppliers' && <Suppliers />}
      {tab === 'reorder' && <Reorder />}
    </>
  );
}

/* ---------------- purchase orders ---------------- */
function Orders() {
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
