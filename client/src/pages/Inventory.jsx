import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Search, PackagePlus, SlidersHorizontal, Download, AlertTriangle, Boxes, History, Radio, Plus, Trash2,
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, num, compactMoney, dateTime, labelize } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, Pagination, useToast, Field, Tabs, Stat, Spinner,
} from '../components/ui.jsx';
import { RankedBarChart } from '../components/charts.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import VariantPicker from '../components/VariantPicker.jsx';

export default function Inventory() {
  const { can, locationId, locations } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('low') === 'true' ? 'low' : 'levels');

  return (
    <>
      <PageHeader title="Inventory" subtitle="Stock levels, adjustments and valuation" />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'levels', label: 'Stock levels' },
        { value: 'low', label: 'Low stock' },
        { value: 'adjustments', label: 'Adjustments' },
        { value: 'movements', label: 'Movement ledger' },
        { value: 'valuation', label: 'Valuation' },
      ]} />
      {tab === 'levels' && <Levels />}
      {tab === 'low' && <LowStock />}
      {tab === 'adjustments' && <Adjustments />}
      {tab === 'movements' && <Movements />}
      {tab === 'valuation' && <Valuation />}
    </>
  );
}

/* ---------------- stock levels ---------------- */
function Levels() {
  const { can, locationId, locations } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('here');
  const [page, setPage] = useState(1);
  const [receive, setReceive] = useState(false);
  const [adjust, setAdjust] = useState(false);

  const load = useCallback(async () => {
    setData(null);
    try {
      setData(await api.get(`/api/inventory/levels${qs({
        q, page, limit: 30, location_id: scope === 'all' ? 'all' : locationId,
      })}`));
    } catch (e) { toast.error(e.message); }
  }, [q, page, scope, locationId]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [q, scope]);

  return (
    <>
      <Card bodyClass="p-0">
        <div className="p-4 flex flex-wrap gap-2 border-b border-slate-100">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search product or SKU…" value={q}
              onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input w-auto" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="here">This shop</option>
            <option value="all">All shops</option>
          </select>
          <button className="btn-secondary" onClick={() => api.download('/api/reports/export/inventory?format=xlsx')}>
            <Download size={16} /> Export
          </button>
          {can('inventory.write') && (
            <>
              <button className="btn-secondary" onClick={() => setAdjust(true)}>
                <SlidersHorizontal size={16} /> Adjust
              </button>
              <button className="btn-primary" onClick={() => setReceive(true)}>
                <PackagePlus size={16} /> Receive stock
              </button>
            </>
          )}
        </div>

        {!data ? <Loading /> : data.data.length === 0 ? (
          <Empty title="No stock records yet" icon={Boxes}
            hint="Receive stock or import a catalogue with opening quantities." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Product</th><th>Variant</th>
                    {scope === 'all' && <th>Location</th>}
                    <th className="text-right">On hand</th><th className="text-right">Tagged</th>
                    <th className="text-right">Reorder at</th><th className="text-right">Cost value</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((r) => {
                    const low = Number(r.quantity) <= Number(r.reorder_point);
                    return (
                      <tr key={`${r.variant_id}-${r.location_id}`}>
                        <td>
                          <Link to={`/products/${r.product_id}`} className="font-medium text-slate-800 hover:text-brand-700">
                            {r.product_name}
                          </Link>
                          <div className="text-xs text-slate-500 font-mono">{r.sku}</div>
                        </td>
                        <td className="text-slate-600">{[r.size, r.color].filter(Boolean).join(' / ') || '—'}</td>
                        {scope === 'all' && <td className="text-slate-600">{r.location_name}</td>}
                        <td className="text-right tabular-nums">
                          <span className={low ? 'text-amber-700 font-semibold' : ''}>{num(r.quantity)}</span>
                        </td>
                        <td className="text-right tabular-nums text-slate-500">{num(r.tagged_units)}</td>
                        <td className="text-right tabular-nums text-slate-500">{num(r.reorder_point)}</td>
                        <td className="text-right tabular-nums">{money(r.stock_value)}</td>
                        <td className="text-right">
                          <Link to={`/rfid?variant_id=${r.variant_id}`} className="btn-ghost p-2" title="Tagged units">
                            <Radio size={15} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <ReceiveModal open={receive} onClose={() => setReceive(false)} onDone={() => { setReceive(false); load(); }} />
      <AdjustModal open={adjust} onClose={() => setAdjust(false)} onDone={() => { setAdjust(false); load(); }} />
    </>
  );
}

/* ---------------- low stock ---------------- */
function LowStock() {
  const { locationId } = useAuth();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    setRows(null);
    api.get('/api/inventory/low-stock').then(setRows).catch(() => setRows([]));
  }, [locationId]);

  if (!rows) return <Loading />;
  return (
    <Card title={`${rows.length} line(s) at or below the reorder point`} bodyClass="p-0"
      actions={<button className="btn-secondary text-xs"
        onClick={() => api.download('/api/reports/export/low-stock?format=xlsx')}>
        <Download size={14} /> Export
      </button>}>
      {rows.length === 0 ? (
        <Empty title="Everything is above its reorder point" icon={Boxes} />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Product</th><th>Variant</th><th>Location</th>
                <th className="text-right">On hand</th><th className="text-right">Reorder at</th>
                <th className="text-right">Suggested order</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.variant_id}-${r.location_id}`}>
                  <td>
                    <Link to={`/products/${r.product_id}`} className="font-medium text-slate-800 hover:text-brand-700">
                      {r.product_name}
                    </Link>
                    <div className="text-xs text-slate-500 font-mono">{r.sku}</div>
                  </td>
                  <td className="text-slate-600">{[r.size, r.color].filter(Boolean).join(' / ') || '—'}</td>
                  <td className="text-slate-600">{r.location_name}</td>
                  <td className="text-right tabular-nums text-amber-700 font-semibold">{num(r.quantity)}</td>
                  <td className="text-right tabular-nums text-slate-500">{num(r.reorder_point)}</td>
                  <td className="text-right tabular-nums font-medium">
                    {num(Math.max(1, Number(r.reorder_point) * 2 - Number(r.quantity)))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ---------------- adjustments ---------------- */
function Adjustments() {
  const { locationId } = useAuth();
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    setData(null);
    api.get(`/api/inventory/adjustments${qs({ page, limit: 25 })}`).then(setData).catch(() => setData({ data: [] }));
  }, [page, locationId]);
  if (!data) return <Loading />;
  return (
    <Card bodyClass="p-0">
      {data.data.length === 0 ? <Empty title="No adjustments recorded" icon={SlidersHorizontal} /> : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Reference</th><th>Reason</th><th>Location</th><th>By</th>
                <th className="text-right">Lines</th><th className="text-right">Net change</th><th>When</th></tr></thead>
              <tbody>
                {data.data.map((a) => (
                  <tr key={a.id}>
                    <td className="font-mono text-xs">{a.ref}</td>
                    <td>{a.reason}{a.notes && <div className="text-xs text-slate-500">{a.notes}</div>}</td>
                    <td className="text-slate-600">{a.location_name}</td>
                    <td className="text-slate-600">{a.user_name || '—'}</td>
                    <td className="text-right tabular-nums">{num(a.line_count)}</td>
                    <td className={`text-right tabular-nums font-medium ${Number(a.net_change) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {Number(a.net_change) > 0 ? '+' : ''}{num(a.net_change)}
                    </td>
                    <td className="text-slate-500 text-xs whitespace-nowrap">{dateTime(a.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

/* ---------------- movement ledger ---------------- */
function Movements() {
  const { locationId } = useAuth();
  const [data, setData] = useState(null);
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    setData(null);
    api.get(`/api/inventory/movements${qs({ page, limit: 40, type })}`).then(setData).catch(() => setData({ data: [] }));
  }, [page, type, locationId]);

  return (
    <Card bodyClass="p-0">
      <div className="p-4 border-b border-slate-100 flex gap-2">
        <select className="input w-auto" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">All movement types</option>
          {['purchase', 'sale', 'return', 'adjustment', 'transfer_in', 'transfer_out', 'opening', 'stock_take']
            .map((t) => <option key={t} value={t}>{labelize(t)}</option>)}
        </select>
      </div>
      {!data ? <Loading /> : data.data.length === 0 ? <Empty title="No movements" icon={History} /> : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>When</th><th>Type</th><th>Product</th><th>Location</th>
                <th className="text-right">Change</th><th className="text-right">Balance</th><th>By</th><th>Reason</th></tr></thead>
              <tbody>
                {data.data.map((m) => (
                  <tr key={m.id}>
                    <td className="text-xs text-slate-500 whitespace-nowrap">{dateTime(m.created_at)}</td>
                    <td><Badge>{labelize(m.type)}</Badge></td>
                    <td>
                      <div className="font-medium text-slate-800">{m.product_name}</div>
                      <div className="text-xs text-slate-500">{[m.size, m.color].filter(Boolean).join(' / ')}</div>
                    </td>
                    <td className="text-slate-600">{m.location_name}</td>
                    <td className={`text-right tabular-nums font-medium ${Number(m.quantity) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {Number(m.quantity) > 0 ? '+' : ''}{num(m.quantity)}
                    </td>
                    <td className="text-right tabular-nums text-slate-500">{m.balance_after == null ? '—' : num(m.balance_after)}</td>
                    <td className="text-slate-600 text-xs">{m.user_name || '—'}</td>
                    <td className="text-slate-500 text-xs">{m.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

/* ---------------- valuation ---------------- */
function Valuation() {
  const { locationId } = useAuth();
  const [data, setData] = useState(null);
  const [scope, setScope] = useState('here');
  useEffect(() => {
    setData(null);
    api.get(`/api/inventory/valuation${qs({ location_id: scope === 'all' ? 'all' : locationId })}`)
      .then(setData).catch(() => setData(null));
  }, [scope, locationId]);

  if (!data) return <Loading />;
  return (
    <>
      <div className="flex justify-end mb-4">
        <select className="input w-auto" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="here">This shop</option>
          <option value="all">All shops</option>
        </select>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Units on hand" value={num(data.summary.units)} />
        <Stat label="Value at cost" value={money(data.summary.cost_value)} />
        <Stat label="Value at retail" value={money(data.summary.retail_value)} />
        <Stat label="Potential profit" value={money(data.summary.potential_profit)} tone="good" />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Stock value by category" subtitle="At cost">
          {data.by_category.length ? (
            <RankedBarChart height={Math.max(220, data.by_category.length * 34)}
              data={data.by_category.map((c) => ({ label: c.category, value: Number(c.cost_value) }))} />
          ) : <Empty title="No stock to value" />}
        </Card>
        <Card title="By location" bodyClass="p-0">
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Location</th><th className="text-right">Units</th>
                <th className="text-right">Cost</th><th className="text-right">Retail</th></tr></thead>
              <tbody>
                {data.by_location.map((l) => (
                  <tr key={l.location}>
                    <td className="font-medium">{l.location}</td>
                    <td className="text-right tabular-nums">{num(l.units)}</td>
                    <td className="text-right tabular-nums">{money(l.cost_value)}</td>
                    <td className="text-right tabular-nums">{money(l.retail_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

/* ---------------- modals ---------------- */
export function ReceiveModal({ open, onClose, onDone }) {
  const { locationId, locations } = useAuth();
  const toast = useToast();
  const [lines, setLines] = useState([]);
  const [loc, setLoc] = useState(locationId);
  const [reason, setReason] = useState('Direct stock receipt');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => { if (open) { setLines([]); setResult(null); setLoc(locationId); } }, [open, locationId]);

  const submit = async () => {
    const items = lines.filter((l) => l.variant_id && Number(l.quantity) > 0);
    if (!items.length) return toast.error('Add at least one line');
    setBusy(true);
    try {
      const res = await api.post('/api/inventory/receive', { location_id: loc, reason, items });
      setResult(res);
      toast.success(`${res.units_created} unit(s) received, each with its own RFID tag`);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Receive stock"
      subtitle="Creates one uniquely-tagged physical unit per item received"
      footer={result
        ? <button className="btn-primary" onClick={onDone}>Done</button>
        : <><button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <PackagePlus size={16} />} Receive
          </button></>}>
      {result ? (
        <div>
          <p className="text-sm text-slate-700 mb-3">
            Reference <span className="font-mono">{result.ref}</span> — {result.units_created} unit(s) created.
          </p>
          <div className="max-h-64 overflow-y-auto rounded-lg ring-1 ring-slate-200">
            <table className="data">
              <thead><tr><th>EPC</th><th>Label</th></tr></thead>
              <tbody>
                {result.units.map((u) => (
                  <tr key={u.id}>
                    <td className="font-mono text-xs">{u.epc}</td>
                    <td className="font-mono text-xs text-slate-500">{u.epc_readable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link to="/rfid?encoded=false" className="btn-secondary w-full mt-3">
            <Radio size={15} /> Go and encode these tags
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Location">
              <select className="input" value={loc} onChange={(e) => setLoc(Number(e.target.value))}>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
            <Field label="Reason / note">
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
          <LineEditor lines={lines} setLines={setLines} withCost />
        </div>
      )}
    </Modal>
  );
}

export function AdjustModal({ open, onClose, onDone }) {
  const { locationId, locations } = useAuth();
  const toast = useToast();
  const [lines, setLines] = useState([]);
  const [loc, setLoc] = useState(locationId);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setLines([]); setReason(''); setNotes(''); setLoc(locationId); } }, [open, locationId]);

  const submit = async () => {
    if (!reason.trim()) return toast.error('A reason is required for every adjustment');
    const items = lines
      .filter((l) => l.variant_id && Number(l.quantity) !== 0)
      .map((l) => ({ variant_id: l.variant_id, quantity_change: Number(l.quantity), cost_price: l.cost_price }));
    if (!items.length) return toast.error('Add at least one line');
    setBusy(true);
    try {
      const res = await api.post('/api/inventory/adjustments', { location_id: loc, reason, notes, items });
      toast.success(`Adjustment ${res.ref} recorded`);
      onDone();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Stock adjustment"
      subtitle="Use a negative quantity for damage or loss, positive to correct an undercount"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? <Spinner /> : null} Record adjustment
        </button></>}>
      <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Location">
            <select className="input" value={loc} onChange={(e) => setLoc(Number(e.target.value))}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Reason (required)">
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Choose a reason…</option>
              {['Damaged in store', 'Lost / missing', 'Theft', 'Stock count correction',
                'Supplier shortfall', 'Sample / display', 'Expired'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Notes">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <LineEditor lines={lines} setLines={setLines} allowNegative />
      </div>
    </Modal>
  );
}

export function LineEditor({ lines, setLines, withCost, allowNegative }) {
  const add = (v) => setLines((p) => [...p, {
    variant_id: v.variant_id, label: `${v.name} · ${[v.size, v.color].filter(Boolean).join(' / ') || 'default'}`,
    sku: v.sku, quantity: allowNegative ? -1 : 1, cost_price: v.cost_price ?? 0, stock: v.stock,
  }]);
  const setLine = (i, patch) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  return (
    <div>
      <VariantPicker onPick={add} />
      {lines.length > 0 && (
        <div className="mt-3 rounded-lg ring-1 ring-slate-200 overflow-hidden">
          <table className="data">
            <thead>
              <tr><th>Item</th><th className="text-right w-28">Qty</th>
                {withCost && <th className="text-right w-32">Unit cost</th>}<th className="w-10"></th></tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <div className="text-sm font-medium text-slate-800">{l.label}</div>
                    <div className="text-xs text-slate-500 font-mono">{l.sku} {l.stock != null && `· ${num(l.stock)} on hand`}</div>
                  </td>
                  <td><input type="number" className="input py-1 text-right" value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                  {withCost && (
                    <td><input type="number" className="input py-1 text-right" value={l.cost_price}
                      onChange={(e) => setLine(i, { cost_price: e.target.value })} /></td>
                  )}
                  <td>
                    <button className="btn-ghost p-1.5 text-rose-600"
                      onClick={() => setLines((p) => p.filter((_, x) => x !== i))}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
