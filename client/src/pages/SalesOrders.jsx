import { useCallback, useEffect, useState } from 'react';
import {
  ClipboardList, Plus, Truck, Trash2, PackageCheck, X, Ban, Package,
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, date, dateTime } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, Pagination, useToast, Field, Spinner, Tabs, Stat,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTabParam } from '../lib/useTabParam.js';
import VariantPicker from '../components/VariantPicker.jsx';

/**
 * Sales orders and shipments — the pre-sale and fulfilment side of the ERP.
 *
 * A sales order is a promise, not a sale: the customer has committed to these
 * lines but nothing moves in stock and no invoice number is burned until it is
 * fulfilled at the till. Shipments then track the physical delivery.
 */
export default function SalesOrders() {
  const { can } = useAuth();
  const [tab, setTab] = useTabParam('orders');
  return (
    <>
      <PageHeader title="Sales orders"
        subtitle="Customer orders, backorders and delivery tracking" />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'orders', label: 'Orders' },
        { value: 'shipments', label: 'Shipments' },
      ]} />
      {tab === 'orders' && <Orders can={can} />}
      {tab === 'shipments' && <Shipments can={can} />}
    </>
  );
}

const ORDER_STATUS = {
  open: 'info', partial: 'warning', fulfilled: 'success', cancelled: 'muted',
};
const SHIP_STATUS = {
  pending: 'muted', packed: 'info', shipped: 'warning', delivered: 'success', returned: 'danger',
};

/* ───────────────────────── orders ───────────────────────── */
function Orders({ can }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(() => {
    api.get(`/api/sales-orders${qs({ status, page, limit: 25 })}`)
      .then(setData).catch(() => setData({ data: [] }));
  }, [status, page]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <Loading />;
  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <select className="input w-auto text-sm" value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {Object.keys(ORDER_STATUS).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {can('sales_orders.write') && (
          <button className="btn-primary ml-auto text-sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> New order
          </button>)}
      </div>

      <Card bodyClass="p-0">
        {data.data.length === 0
          ? <Empty icon={ClipboardList} title="No sales orders"
              hint="Take an order for stock you owe a customer — even before it is in." />
          : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr>
                  <th>Order</th><th>Customer</th><th>Due</th>
                  <th className="text-right">Progress</th><th className="text-right">Total</th><th>Status</th>
                </tr></thead>
                <tbody>
                  {data.data.map((o) => (
                    <tr key={o.id} className="cursor-pointer" onClick={() => setOpenId(o.id)}>
                      <td>
                        <div className="font-mono text-sm">{o.ref}</div>
                        <div className="text-xs text-slate-500">{date(o.order_date)} · {o.location_name}</div>
                      </td>
                      <td>{o.customer_name || <span className="text-slate-400">Walk-in</span>}</td>
                      <td className="text-sm">{o.due_date ? date(o.due_date) : '—'}</td>
                      <td className="text-right tabular-nums text-sm">{Number(o.fulfilled)}/{Number(o.qty)}</td>
                      <td className="text-right tabular-nums">{money(o.total)}</td>
                      <td><Badge status={ORDER_STATUS[o.status]}>{o.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>)}
        <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
      </Card>

      {creating && <OrderEditor onClose={() => setCreating(false)}
        onDone={(o) => { setCreating(false); load(); setOpenId(o.id); }} />}
      {openId && <OrderDetail id={openId} can={can}
        onClose={() => setOpenId(null)} onChanged={load} />}
    </>
  );
}

function OrderEditor({ onClose, onDone }) {
  const { locationId, locations } = useAuth();
  const toast = useToast();
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ customer_id: '', location_id: locationId, due_date: '', notes: '' });
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/customers?limit=200').then((r) => setCustomers(r.data || [])).catch(() => {});
  }, []);

  const add = (v) => setLines((p) => {
    if (p.some((l) => l.variant_id === v.variant_id)) return p;
    return [...p, {
      variant_id: v.variant_id,
      label: `${v.name} · ${[v.size, v.color].filter(Boolean).join(' / ') || 'default'}`,
      sku: v.sku, quantity: 1, unit_price: Number(v.price) || 0, on_hand: v.stock ?? null,
    }];
  });
  const setLine = (i, patch) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_price || 0), 0);

  const submit = async () => {
    const items = lines.filter((l) => l.variant_id && Number(l.quantity) > 0)
      .map((l) => ({ variant_id: l.variant_id, quantity: Number(l.quantity), unit_price: Number(l.unit_price) }));
    if (!items.length) return toast.error('Add at least one line');
    setBusy(true);
    try {
      const order = await api.post('/api/sales-orders', { ...form, items });
      toast.success(`${order.ref} created`);
      onDone(order);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="New sales order" size="lg"
      footer={<><span className="mr-auto text-sm text-slate-600">Total {money(total)}</span>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? <Spinner /> : null} Create order</button></>}>
      <div className="grid sm:grid-cols-4 gap-3 mb-4">
        <Field label="Customer" className="sm:col-span-2">
          <select className="input" value={form.customer_id}
            onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
            <option value="">Walk-in</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Branch">
          <select className="input" value={form.location_id}
            onChange={(e) => setForm({ ...form, location_id: Number(e.target.value) })}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Due date">
          <input type="date" className="input" value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
        </Field>
        <Field label="Notes" className="sm:col-span-4">
          <input className="input" value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Delivery instructions, colour requested…" />
        </Field>
      </div>

      <VariantPicker onPick={add} placeholder="Search a product to order…" />

      {lines.length > 0 && (
        <div className="mt-3 rounded-lg ring-1 ring-slate-200 overflow-hidden">
          <table className="data">
            <thead><tr><th>Item</th><th className="text-right w-20">In stock</th>
              <th className="text-right w-24">Qty</th><th className="text-right w-32">Unit price</th>
              <th className="text-right w-32">Line</th><th className="w-10"></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <div className="text-sm font-medium">{l.label}</div>
                    <div className="text-xs text-slate-500 font-mono">{l.sku}</div>
                  </td>
                  <td className="text-right text-sm tabular-nums">
                    {l.on_hand == null ? '—'
                      : Number(l.quantity) > Number(l.on_hand)
                        ? <span className="text-amber-700">{Number(l.on_hand)} (backorder)</span>
                        : Number(l.on_hand)}
                  </td>
                  <td><input type="number" min="1" className="input py-1 text-right" value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                  <td><input type="number" className="input py-1 text-right" value={l.unit_price}
                    onChange={(e) => setLine(i, { unit_price: e.target.value })} /></td>
                  <td className="text-right tabular-nums">
                    {money(Number(l.quantity || 0) * Number(l.unit_price || 0))}</td>
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

function OrderDetail({ id, can, onClose, onChanged }) {
  const toast = useToast();
  const [order, setOrder] = useState(null);
  const [fulfil, setFulfil] = useState({});   // item_id -> qty to fulfil now
  const [busy, setBusy] = useState(false);
  const [shipping, setShipping] = useState(false);

  const load = useCallback(() => api.get(`/api/sales-orders/${id}`).then(setOrder).catch((e) => toast.error(e.message)), [id]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  const doFulfil = async () => {
    const items = Object.entries(fulfil)
      .map(([item_id, quantity]) => ({ item_id: Number(item_id), quantity: Number(quantity) }))
      .filter((x) => x.quantity > 0);
    if (!items.length) return toast.error('Enter a quantity to fulfil');
    setBusy(true);
    try {
      await api.post(`/api/sales-orders/${id}/fulfil`, { items });
      toast.success('Fulfilment recorded'); setFulfil({}); load(); onChanged();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!window.confirm('Cancel this order?')) return;
    try {
      await api.post(`/api/sales-orders/${id}/cancel`, {});
      toast.success('Order cancelled'); load(); onChanged();
    } catch (e) { toast.error(e.message); }
  };

  const remaining = (it) => Number(it.quantity) - Number(it.fulfilled_quantity);
  const writable = order && order.status !== 'cancelled' && order.status !== 'fulfilled';

  return (
    <Modal open onClose={onClose} size="lg"
      title={order ? order.ref : 'Order'}
      subtitle={order ? `${date(order.order_date)} · ${order.customer_name || 'Walk-in'}` : ''}
      footer={order && <>
        <div className="mr-auto flex items-center gap-2">
          <Badge status={ORDER_STATUS[order.status]}>{order.status}</Badge>
          {order.due_date && <span className="text-xs text-slate-500">due {date(order.due_date)}</span>}
        </div>
        {can('shipments.write') && order.status !== 'cancelled' && (
          <button className="btn-secondary" onClick={() => setShipping(true)}>
            <Truck size={14} /> Shipment</button>)}
        {can('sales_orders.write') && order.status !== 'fulfilled' && order.status !== 'cancelled' && (
          <button className="btn-ghost text-rose-600" onClick={cancel}><Ban size={14} /> Cancel</button>)}
        {can('sales_orders.write') && writable && (
          <button className="btn-primary" onClick={doFulfil} disabled={busy}>
            {busy ? <Spinner /> : <PackageCheck size={14} />} Record fulfilment</button>)}
      </>}>
      {!order ? <Loading /> : (
        <>
          <div className="rounded-lg ring-1 ring-slate-200 overflow-hidden">
            <table className="data">
              <thead><tr><th>Item</th><th className="text-right">On hand</th>
                <th className="text-right">Ordered</th><th className="text-right">Fulfilled</th>
                <th className="text-right">Remaining</th>
                {writable && <th className="text-right w-28">Fulfil now</th>}</tr></thead>
              <tbody>
                {order.items.map((it) => (
                  <tr key={it.id}>
                    <td>
                      <div className="text-sm font-medium">{it.product_name}</div>
                      <div className="text-xs text-slate-500">
                        {[it.size, it.color].filter(Boolean).join(' / ') || 'default'} · {money(it.unit_price)}</div>
                    </td>
                    <td className="text-right text-sm tabular-nums">{Number(it.on_hand)}</td>
                    <td className="text-right tabular-nums">{Number(it.quantity)}</td>
                    <td className="text-right tabular-nums">{Number(it.fulfilled_quantity)}</td>
                    <td className="text-right tabular-nums">
                      {remaining(it) > 0
                        ? <span className="text-amber-700">{remaining(it)}</span>
                        : <span className="text-emerald-700">0</span>}</td>
                    {writable && (
                      <td className="text-right">
                        {remaining(it) > 0 ? (
                          <input type="number" min="0" max={remaining(it)}
                            className="input py-1 text-right w-24"
                            value={fulfil[it.id] ?? ''} placeholder="0"
                            onChange={(e) => setFulfil((f) => ({ ...f, [it.id]: e.target.value }))} />
                        ) : <span className="text-xs text-slate-400">done</span>}
                      </td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {order.notes && <p className="mt-3 text-sm text-slate-600">{order.notes}</p>}

          {order.shipments?.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Shipments</div>
              <div className="space-y-1.5">
                {order.shipments.map((sh) => (
                  <div key={sh.id} className="flex items-center gap-2 text-sm rounded-lg ring-1 ring-slate-200 px-3 py-2">
                    <Package size={14} className="text-slate-400" />
                    <span className="font-mono">{sh.ref}</span>
                    {sh.carrier && <span className="text-slate-500">{sh.carrier}</span>}
                    {sh.tracking_no && <span className="text-slate-400 font-mono text-xs">{sh.tracking_no}</span>}
                    <Badge className="ml-auto" status={SHIP_STATUS[sh.status]}>{sh.status}</Badge>
                  </div>
                ))}
              </div>
            </div>)}

          {shipping && <ShipmentEditor salesOrderId={order.id} onClose={() => setShipping(false)}
            onDone={() => { setShipping(false); load(); }} />}
        </>
      )}
    </Modal>
  );
}

/* ───────────────────────── shipments ───────────────────────── */
function Shipments({ can }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    api.get(`/api/sales-orders/shipments/all${qs({ status, page, limit: 25 })}`)
      .then(setData).catch(() => setData({ data: [] }));
  }, [status, page]);
  useEffect(() => { load(); }, [load]);

  const advance = async (sh, next) => {
    try {
      await api.put(`/api/sales-orders/shipments/${sh.id}`, { status: next });
      toast.success(`Marked ${next}`); load();
    } catch (e) { toast.error(e.message); }
  };
  const flow = { pending: 'packed', packed: 'shipped', shipped: 'delivered' };

  if (!data) return <Loading />;
  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <select className="input w-auto text-sm" value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {Object.keys(SHIP_STATUS).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <Card bodyClass="p-0">
        {data.data.length === 0
          ? <Empty icon={Truck} title="No shipments"
              hint="Shipments track deliveries against an order or a completed sale." />
          : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Shipment</th><th>For</th><th>Carrier</th>
                  <th>Tracking</th><th>Status</th><th className="w-32"></th></tr></thead>
                <tbody>
                  {data.data.map((sh) => (
                    <tr key={sh.id}>
                      <td><div className="font-mono text-sm">{sh.ref}</div>
                        <div className="text-xs text-slate-500">{dateTime(sh.created_at)}</div></td>
                      <td className="text-sm">{sh.order_ref || sh.invoice_no || '—'}</td>
                      <td className="text-sm">{sh.carrier || '—'}</td>
                      <td className="font-mono text-xs">{sh.tracking_no || '—'}</td>
                      <td><Badge status={SHIP_STATUS[sh.status]}>{sh.status}</Badge></td>
                      <td className="text-right">
                        {can('shipments.write') && flow[sh.status] && (
                          <button className="btn-ghost text-xs" onClick={() => advance(sh, flow[sh.status])}>
                            Mark {flow[sh.status]}</button>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>)}
        <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
      </Card>
    </>
  );
}

function ShipmentEditor({ salesOrderId, saleId, onClose, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({ carrier: '', tracking_no: '', address: '', status: 'packed', notes: '' });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/api/sales-orders/shipments', {
        ...form, sales_order_id: salesOrderId || null, sale_id: saleId || null });
      toast.success('Shipment created'); onDone();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="New shipment" size="sm"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? <Spinner /> : null} Create</button></>}>
      <div className="space-y-3">
        <Field label="Carrier">
          <input className="input" value={form.carrier}
            onChange={(e) => setForm({ ...form, carrier: e.target.value })}
            placeholder="GIG, DHL, dispatch rider…" />
        </Field>
        <Field label="Tracking number">
          <input className="input font-mono" value={form.tracking_no}
            onChange={(e) => setForm({ ...form, tracking_no: e.target.value })} />
        </Field>
        <Field label="Delivery address">
          <input className="input" value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
        <Field label="Status">
          <select className="input" value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {['pending', 'packed', 'shipped', 'delivered'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
