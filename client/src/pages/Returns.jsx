import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  RotateCcw, Search, Plus, Trash2, ScanLine, ArrowRight, ShieldCheck, ShieldX, Radio, Square,
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, num, dateTime, labelize, variantLabel, date } from '../lib/format.js';
import { useRfidScan } from '../lib/useRfidScan.jsx';
import {
  Card, Loading, Empty, Badge, Modal, Pagination, useToast, Field, Spinner, Tabs, ScanInput,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTabParam } from '../lib/useTabParam.js';
import VariantPicker from '../components/VariantPicker.jsx';

export default function Returns() {
  const [params] = useSearchParams();
  const [tab, setTab] = useTabParam(params.get('invoice') ? 'new' : 'history');
  return (
    <>
      <PageHeader title="Returns & exchanges"
        subtitle="With or without a receipt — refunds, store credit and exchanges" />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'new', label: 'New return' },
        { value: 'history', label: 'History' },
      ]} />
      {tab === 'new' ? <NewReturn initialInvoice={params.get('invoice') || ''} onDone={() => setTab('history')} />
        : <History />}
    </>
  );
}

function NewReturn({ initialInvoice, onDone }) {
  const toast = useToast();
  const { can, feature } = useAuth();
  const [invoice, setInvoice] = useState(initialInvoice);
  const [sale, setSale] = useState(null);
  const [lines, setLines] = useState([]);
  const [noReceipt, setNoReceipt] = useState(!initialInvoice ? false : false);
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const lookup = async (e) => {
    e?.preventDefault();
    if (!invoice.trim()) return;
    setBusy(true);
    try {
      const s = await api.get(`/api/returns/lookup/${encodeURIComponent(invoice.trim())}`);
      setSale(s);
      setLines(s.items.map((i) => ({
        sale_item_id: i.id, label: `${i.product_name} · ${i.variant_label}`,
        max: Number(i.quantity) - Number(i.returned_quantity),
        quantity: 0, unit_price: Number(i.line_total) / Number(i.quantity), restock: true,
      })));
      setNoReceipt(false);
    } catch (err) { toast.error(err.message); setSale(null); }
    finally { setBusy(false); }
  };

  useEffect(() => { if (initialInvoice) lookup(); }, []); // eslint-disable-line

  const submit = async () => {
    if (!reason.trim()) return toast.error('A reason is required');
    const items = lines
      .filter((l) => Number(l.quantity) > 0)
      .map((l) => ({
        sale_item_id: l.sale_item_id, variant_id: l.variant_id,
        quantity: Number(l.quantity), unit_price: l.unit_price, restock: l.restock,
      }));
    if (!items.length) return toast.error('Choose at least one item to return');
    setBusy(true);
    try {
      const res = await api.post('/api/returns', {
        original_sale_id: sale?.id || null,
        customer_id: sale?.customer_id || null,
        reason, refund_method: method, type: 'refund', items,
      });
      setResult(res);
      toast.success(`${res.ref} — ${money(res.total_refund)} refunded`);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_price || 0), 0);

  if (result) {
    return (
      <Card title="Return processed">
        <p className="text-sm text-slate-700">
          Reference <span className="font-mono">{result.ref}</span> — {money(result.total_refund)} refunded
          by {labelize(method)}.
        </p>
        <p className="text-xs text-slate-500 mt-2">
          Restocked items went straight back into stock; a tag that was already sold is revived rather than
          re-issued, so the same physical unit keeps its EPC.
        </p>
        <div className="flex gap-2 mt-4">
          <button className="btn-secondary" onClick={() => { setResult(null); setSale(null); setLines([]); setInvoice(''); setReason(''); }}>
            Process another
          </button>
          <button className="btn-primary" onClick={onDone}>View history</button>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <Card title="1. Find the original sale"
          subtitle="Or switch to a no-receipt return below">
          <form onSubmit={lookup} className="flex gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input pl-9 font-mono" placeholder="INV-2026-000123" value={invoice}
                onChange={(e) => setInvoice(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={busy}>{busy ? <Spinner /> : null} Look up</button>
          </form>
          <button className="btn-ghost text-xs mt-2"
            onClick={() => { setNoReceipt(true); setSale(null); setLines([]); }}>
            No receipt? Process without one <ArrowRight size={13} />
          </button>

          {feature('warranties') && <WarrantyScan onSale={(inv) => { setInvoice(inv); }} />}

          {sale && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span><span className="text-slate-500">Invoice</span> <span className="font-mono">{sale.invoice_no}</span></span>
                <span><span className="text-slate-500">Date</span> {dateTime(sale.created_at)}</span>
                <span><span className="text-slate-500">Customer</span> {sale.customer_name || 'Walk-in'}</span>
                <span><span className="text-slate-500">Total</span> {money(sale.total)}</span>
              </div>
            </div>
          )}
        </Card>

        <Card title="2. Choose what is coming back" bodyClass={sale || noReceipt ? 'p-4' : 'p-0'}>
          {!sale && !noReceipt ? (
            <Empty title="Look up a receipt first" icon={Search} />
          ) : noReceipt ? (
            <>
              <VariantPicker placeholder="Search the product being returned…"
                onPick={(v) => setLines((p) => [...p, {
                  variant_id: v.variant_id, label: `${v.name} · ${variantLabel(v)}`,
                  quantity: 1, unit_price: Number(v.price), restock: true, max: 99,
                }])} />
              <p className="text-xs text-slate-500 mt-2">
                Without a receipt the refund is calculated at today's selling price. Store credit is the
                usual choice here.
              </p>
              <LineTable lines={lines} setLines={setLines} editablePrice />
            </>
          ) : (
            <LineTable lines={lines} setLines={setLines} />
          )}
        </Card>
      </div>

      <div>
        <Card title="3. Settle" className="lg:sticky lg:top-[4.5rem]">
          <Field label="Reason (required)">
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Choose…</option>
              {['Wrong size', 'Wrong colour', 'Changed mind', 'Faulty / defect', 'Not as described',
                'Duplicate purchase', 'Other'].map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Refund by" className="mt-3">
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="transfer">Bank transfer</option>
              <option value="card">Card reversal</option>
              <option value="store_credit">Store credit</option>
              <option value="account_credit">Reduce what they owe</option>
            </select>
          </Field>

          <div className="mt-4 pt-3 border-t border-slate-100">
            <div className="flex justify-between text-base font-semibold">
              <span>Refund total</span>
              <span className="tabular-nums">{money(total)}</span>
            </div>
          </div>

          <button className="btn-primary w-full mt-4" disabled={busy || total <= 0} onClick={submit}>
            {busy ? <Spinner /> : <RotateCcw size={16} />} Process return
          </button>
        </Card>
      </div>
    </div>
  );
}

/**
 * Warranty × RFID for returns: scan the item coming back and the exact serial
 * says whether it is still covered — and, if the tag was sold here, which
 * invoice it came off, which the cashier can load with one click.
 */
function WarrantyScan({ onSale }) {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const check = useCallback(async (epc) => {
    const code = String(epc || '').trim();
    if (!code) return;
    setBusy(true);
    try { setRes(await api.get(`/api/svc/warranty-check/${encodeURIComponent(code)}`)); }
    catch (e) { setRes({ registered: false, epc: code, error: e.message }); }
    finally { setBusy(false); }
  }, []);
  const scan = useRfidScan(check, { dedupeMs: 2000, tagsOnly: true });

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <scan.CaptureField />
      <div className="flex items-center gap-2">
        <ScanInput onScan={check} placeholder="Or scan the item to check its warranty…" className="flex-1" />
        {scan.native && (
          <button className={scan.scanning ? 'btn-danger' : 'btn-secondary'} onClick={scan.toggle}>
            {scan.scanning ? <Square size={14} /> : <Radio size={14} />}</button>)}
      </div>
      {busy && <div className="mt-2"><Spinner /></div>}
      {!busy && res?.registered && (
        <div className={`mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ${res.active
          ? 'bg-emerald-50 ring-emerald-200 text-emerald-800' : 'bg-rose-50 ring-rose-200 text-rose-800'}`}>
          {res.active ? <ShieldCheck size={16} /> : <ShieldX size={16} />}
          <span className="font-medium">{res.active ? 'Under warranty' : 'Warranty expired'}</span>
          <span className="text-xs opacity-80">
            {res.warranty_name}{res.expires_at ? ` · until ${date(res.expires_at)}` : ''}</span>
          {res.invoice_no && (
            <button className="btn-ghost text-xs ml-auto" onClick={() => onSale(res.invoice_no)}>
              Load {res.invoice_no} <ArrowRight size={12} /></button>)}
        </div>)}
      {!busy && res && !res.registered && (
        <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200">
          No warranty on record for <span className="font-mono">{res.epc}</span>.</div>)}
    </div>
  );
}

function LineTable({ lines, setLines, editablePrice }) {
  if (!lines.length) return <Empty title="Nothing selected yet" />;
  const set = (i, patch) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  return (
    <div className="mt-3 rounded-lg ring-1 ring-slate-200 overflow-hidden">
      <table className="data">
        <thead><tr><th>Item</th><th className="text-right w-24">Qty</th>
          <th className="text-right w-28">Refund each</th><th className="w-20">Restock</th><th className="w-10"></th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                <div className="text-sm font-medium text-slate-800">{l.label}</div>
                {l.max < 90 && <div className="text-xs text-slate-500">{num(l.max)} returnable</div>}
              </td>
              <td>
                <input type="number" className="input py-1 text-right" min="0" max={l.max}
                  value={l.quantity} onChange={(e) => set(i, { quantity: Math.min(Number(e.target.value) || 0, l.max) })} />
              </td>
              <td>
                {editablePrice
                  ? <input type="number" className="input py-1 text-right" value={l.unit_price}
                      onChange={(e) => set(i, { unit_price: e.target.value })} />
                  : <span className="block text-right tabular-nums text-sm">{money(l.unit_price)}</span>}
              </td>
              <td className="text-center">
                <input type="checkbox" className="rounded border-slate-300" checked={l.restock}
                  onChange={(e) => set(i, { restock: e.target.checked })} />
              </td>
              <td>
                <button className="btn-ghost p-1.5 text-rose-600"
                  onClick={() => setLines((p) => p.filter((_, x) => x !== i))}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function History() {
  const { locationId } = useAuth();
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    setData(null);
    api.get(`/api/returns${qs({ page, limit: 25 })}`).then(setData).catch(() => setData({ data: [] }));
  }, [page, locationId]);

  if (!data) return <Loading />;
  return (
    <>
      <Card bodyClass="p-0">
        {data.data.length === 0 ? <Empty title="No returns recorded" icon={RotateCcw} /> : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Reference</th><th>Original invoice</th><th>Customer</th><th>Type</th>
                  <th>Reason</th><th className="text-right">Lines</th><th className="text-right">Refunded</th>
                  <th>By</th><th>When</th></tr></thead>
                <tbody>
                  {data.data.map((r) => (
                    <tr key={r.id} className="cursor-pointer" onClick={() => setOpen(r.id)}>
                      <td className="font-mono text-xs font-medium text-brand-700">{r.ref}</td>
                      <td className="font-mono text-xs">{r.original_invoice || '—'}</td>
                      <td>{r.customer_name || 'Walk-in'}</td>
                      <td><Badge>{labelize(r.type)}</Badge></td>
                      <td className="text-slate-600">{r.reason}</td>
                      <td className="text-right tabular-nums">{num(r.line_count)}</td>
                      <td className="text-right tabular-nums">{money(r.total_refund)}</td>
                      <td className="text-slate-600 text-sm">{r.user_name || '—'}</td>
                      <td className="text-xs text-slate-500 whitespace-nowrap">{dateTime(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {open && <ReturnDetail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ReturnDetail({ id, onClose }) {
  const [r, setR] = useState(null);
  useEffect(() => { api.get(`/api/returns/${id}`).then(setR).catch(() => {}); }, [id]);
  if (!r) return <Modal open onClose={onClose} title="Return"><Loading /></Modal>;
  return (
    <Modal open onClose={onClose} title={r.ref} size="lg"
      subtitle={`${labelize(r.type)} · ${r.reason} · ${money(r.total_refund)} by ${labelize(r.refund_method)}`}
      footer={<button className="btn-primary" onClick={onClose}>Close</button>}>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Refund</th>
            <th>Restocked</th><th>Tag</th></tr></thead>
          <tbody>
            {r.items.map((i) => (
              <tr key={i.id}>
                <td>
                  <div className="font-medium text-slate-800">{i.product_name}</div>
                  <div className="text-xs text-slate-500">{[i.size, i.color].filter(Boolean).join(' / ')}</div>
                </td>
                <td className="text-right tabular-nums">{num(i.quantity)}</td>
                <td className="text-right tabular-nums">{money(i.refund_amount)}</td>
                <td>{i.restock ? 'Yes' : 'No'}</td>
                <td className="font-mono text-xs">{i.epc_readable || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
