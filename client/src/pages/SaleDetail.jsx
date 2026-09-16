import { useEffect, useState, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Printer, Gift, RotateCcw, CreditCard, Radio, FileCode2,
  PencilLine, History, Trash2, Plus, AlertTriangle,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { money, num, dateTime, labelize, variantLabel } from '../lib/format.js';
import { Card, Loading, Badge, Modal, useToast, Field, Empty, Spinner } from '../components/ui.jsx';
import VariantPicker from '../components/VariantPicker.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import Receipt from '../components/Receipt.jsx';

export default function SaleDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const [sale, setSale] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [gift, setGift] = useState(false);
  const [payModal, setPayModal] = useState(false);
  const [einvoice, setEinvoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editable, setEditable] = useState(null);
  const [revisions, setRevisions] = useState([]);
  const [amending, setAmending] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.get(`/api/sales/${id}`);
      setSale(s);
      setReceipt(await api.get(`/api/sales/${id}/receipt`));
      setEditable(await api.get(`/api/sales/${id}/editable`).catch(() => null));
      setRevisions(await api.get(`/api/sales/${id}/revisions`).catch(() => []));
    } catch (e) { toast.error(e.message); }
  }, [id]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  if (!sale) return <Loading />;

  const takePayment = async (amount, method, reference) => {
    setBusy(true);
    try {
      await api.post(`/api/sales/${id}/payments`, { amount, method, reference });
      toast.success('Payment recorded');
      setPayModal(false);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title={sale.invoice_no || `Sale #${sale.id}`}
        subtitle={`${dateTime(sale.created_at)} · ${sale.location_name} · ${sale.cashier_name || '—'}`}
        actions={
          <>
            <Link to="/sales" className="btn-secondary no-print"><ArrowLeft size={16} /> Back</Link>
            <button className="btn-secondary no-print" onClick={() => { setGift(false); setTimeout(() => window.print(), 50); }}>
              <Printer size={16} /> Print
            </button>
            <button className="btn-secondary no-print" onClick={() => setGift((g) => !g)}>
              <Gift size={16} /> {gift ? 'Show prices' : 'Gift receipt'}
            </button>
            {can('returns.create') && ['completed', 'partially_refunded'].includes(sale.status) && (
              <button className="btn-secondary no-print"
                onClick={() => navigate(`/returns?invoice=${sale.invoice_no}`)}>
                <RotateCcw size={16} /> Return
              </button>
            )}
            {editable?.editable && (
              <button className="btn-secondary no-print" onClick={() => setAmending(true)}>
                <PencilLine size={16} /> Edit sale
              </button>
            )}
            {Number(sale.balance_due) > 0 && can('sales.create') && (
              <button className="btn-primary no-print" onClick={() => setPayModal(true)}>
                <CreditCard size={16} /> Take payment
              </button>
            )}
          </>
        } />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4 no-print">
          <Card title="Items" bodyClass="p-0"
            actions={<Badge status={sale.status} />}>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Product</th><th className="text-right">Qty</th><th className="text-right">Unit price</th>
                  <th className="text-right">Discount</th><th className="text-right">VAT</th>
                  <th className="text-right">Line total</th></tr></thead>
                <tbody>
                  {sale.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <div className="font-medium text-slate-800">{i.product_name}</div>
                        <div className="text-xs text-slate-500">
                          {i.variant_label} {i.sku && <span className="font-mono">· {i.sku}</span>}
                        </div>
                        {i.units?.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {i.units.map((u) => (
                              <span key={u.id} className="badge bg-emerald-50 text-emerald-800 font-mono text-[10px]">
                                <Radio size={9} className="mr-1" />{u.readable || u.epc}
                              </span>
                            ))}
                          </div>
                        )}
                        {Number(i.returned_quantity) > 0 && (
                          <Badge status="refunded" className="mt-1">{num(i.returned_quantity)} returned</Badge>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{num(i.quantity)}</td>
                      <td className="text-right tabular-nums">{money(i.unit_price)}</td>
                      <td className="text-right tabular-nums">{Number(i.discount_amount) ? money(i.discount_amount) : '—'}</td>
                      <td className="text-right tabular-nums text-slate-500">{money(i.tax_amount)}</td>
                      <td className="text-right tabular-nums font-medium">{money(i.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid sm:grid-cols-2 gap-4">
            <Card title="Payments" bodyClass="p-0">
              {sale.payments.length === 0 ? <Empty title="No payments recorded" /> : (
                <table className="data">
                  <thead><tr><th>Method</th><th>Reference</th><th className="text-right">Amount</th><th>When</th></tr></thead>
                  <tbody>
                    {sale.payments.map((p) => (
                      <tr key={p.id}>
                        <td><Badge>{labelize(p.method)}</Badge></td>
                        <td className="text-xs text-slate-500">{p.reference || '—'}</td>
                        <td className={`text-right tabular-nums ${Number(p.amount) < 0 ? 'text-rose-600' : ''}`}>
                          {money(p.amount)}
                        </td>
                        <td className="text-xs text-slate-500 whitespace-nowrap">{dateTime(p.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="Summary">
              <dl className="text-sm space-y-1.5">
                <Row label="Subtotal" value={money(sale.subtotal)} />
                {Number(sale.discount_amount) > 0 && (
                  <Row label="Discount" value={`− ${money(sale.discount_amount)}`} tone="text-emerald-700" />
                )}
                <Row label={`VAT (${receipt?.business?.vat_rate ?? 7.5}%)`} value={money(sale.tax_amount)} />
                <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold text-base">
                  <dt>Total</dt><dd className="tabular-nums">{money(sale.total)}</dd>
                </div>
                <Row label="Paid" value={money(sale.amount_paid)} />
                {Number(sale.change_due) > 0 && <Row label="Change given" value={money(sale.change_due)} />}
                {Number(sale.balance_due) > 0 && (
                  <Row label="Balance due" value={money(sale.balance_due)} tone="text-amber-700 font-medium" />
                )}
                <Row label="Cost of goods" value={money(sale.cost_total)} muted />
                <Row label="Gross profit"
                  value={money(Number(sale.total) - Number(sale.tax_amount) - Number(sale.cost_total))}
                  tone="text-emerald-700" />
                {Number(sale.points_earned) > 0 && <Row label="Points earned" value={num(sale.points_earned)} muted />}
              </dl>
              {sale.customer_name && (
                <p className="text-sm text-slate-600 mt-3 pt-3 border-t border-slate-100">
                  Customer: <Link to={`/customers/${sale.customer_id}`} className="text-brand-700 hover:underline">
                    {sale.customer_name}</Link>
                </p>
              )}
              <button className="btn-secondary w-full mt-3 text-xs" onClick={() => setEinvoice(true)}>
                <FileCode2 size={14} /> View e-invoice payload
              </button>
            </Card>
          </div>

          {Number(sale.edit_count) > 0 && (
            <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 p-3 text-sm text-amber-900 flex gap-2.5">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">
                  This receipt has been amended {sale.edit_count} time{Number(sale.edit_count) === 1 ? '' : 's'}
                  {sale.edited_at ? ` — last on ${dateTime(sale.edited_at)}` : ''}.
                </p>
                <p className="text-xs mt-0.5">
                  The invoice number is unchanged and every earlier version is kept below.
                </p>
              </div>
            </div>
          )}

          {editable && !editable.editable && can('sales.edit') && (
            <p className="text-xs text-slate-500">
              This sale can no longer be edited: {editable.reasons.join(' ')}
            </p>
          )}
          {editable?.editable && (
            <p className="text-xs text-slate-500">
              Editable for another {editable.days_remaining} day{editable.days_remaining === 1 ? '' : 's'}
              {' '}(within the {editable.window_days}-day window).
            </p>
          )}

          {revisions.length > 0 && (
            <Card title="Amendment history" bodyClass="p-0"
              actions={<History size={15} className="text-slate-400" />}>
              <div className="divide-y divide-slate-100">
                {revisions.map((r) => (
                  <div key={r.id} className="p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                      <p className="font-medium text-slate-800 text-sm">
                        Revision {r.revision} · {r.reason}
                      </p>
                      <p className="text-xs text-slate-500">
                        {r.user_name || '—'} · {dateTime(r.created_at)}
                      </p>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3 text-xs">
                      <RevisionSide title="Before" data={r.before_json} tone="bg-rose-50 ring-rose-200" />
                      <RevisionSide title="After" data={r.after_json} tone="bg-emerald-50 ring-emerald-200" />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {sale.returns?.length > 0 && (
            <Card title="Returns against this sale" bodyClass="p-0">
              <table className="data">
                <thead><tr><th>Reference</th><th>Type</th><th>Reason</th>
                  <th className="text-right">Refunded</th><th>By</th><th>When</th></tr></thead>
                <tbody>
                  {sale.returns.map((r) => (
                    <tr key={r.id}>
                      <td className="font-mono text-xs">{r.ref}</td>
                      <td><Badge>{labelize(r.type)}</Badge></td>
                      <td className="text-slate-600">{r.reason}</td>
                      <td className="text-right tabular-nums">{money(r.total_refund)}</td>
                      <td className="text-slate-600 text-sm">{r.user_name || '—'}</td>
                      <td className="text-xs text-slate-500">{dateTime(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>

        <div>
          <Card title="Receipt preview" className="lg:sticky lg:top-[4.5rem]">
            {receipt ? <Receipt data={{ ...receipt, gift }} /> : <Loading />}
          </Card>
        </div>
      </div>

      {amending && (
        <AmendModal sale={sale} onClose={() => setAmending(false)}
          onSaved={() => { setAmending(false); load(); }} />
      )}

      {payModal && (
        <PaymentModal balance={Number(sale.balance_due)} busy={busy}
          onClose={() => setPayModal(false)} onSubmit={takePayment} />
      )}

      {einvoice && receipt && (
        <Modal open onClose={() => setEinvoice(false)} title="Structured invoice payload" size="lg"
          subtitle={`Shaped for ${receipt.einvoice.scheme} — the fields a FIRS e-invoice submission needs`}
          footer={<button className="btn-primary" onClick={() => setEinvoice(false)}>Close</button>}>
          <pre className="text-[11px] bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto">
            {JSON.stringify(receipt.einvoice, null, 2)}
          </pre>
          <p className="text-xs text-slate-500 mt-3">
            Nothing is transmitted to any tax authority — this shows that the invoice data is already
            captured in the shape an e-invoicing integration would need, so adding one later is a mapping
            job rather than a redesign.
          </p>
        </Modal>
      )}
    </>
  );
}

function RevisionSide({ title, data, tone }) {
  return (
    <div className={`rounded-lg ring-1 p-2.5 ${tone}`}>
      <p className="font-semibold mb-1.5">{title}</p>
      <ul className="space-y-1">
        {(data.items || []).map((i, idx) => (
          <li key={idx}>
            {i.product}{i.variant ? ` (${i.variant})` : ''} — {num(i.quantity)} × {money(i.unit_price)}
            {Number(i.discount) > 0 ? ` − ${money(i.discount)}` : ''} = {money(i.line_total)}
            {i.tags?.length > 0 && (
              <span className="block text-[10px] opacity-70 font-mono break-all">{i.tags.join(', ')}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 pt-1.5 border-t border-current/15 font-semibold">
        Total {money(data.total)}
        {Number(data.balance_due) > 0 ? ` · owing ${money(data.balance_due)}` : ''}
      </p>
    </div>
  );
}

const AMEND_REASONS = [
  'Wrong item rung up',
  'Wrong quantity rung up',
  'Wrong price applied',
  'Discount not applied at the till',
  'Customer added an item before leaving',
  'Wrong customer selected',
  'Other (explain below)',
];

/**
 * Amend an issued receipt.
 *
 * Lines are re-priced from the database on save, stock is unwound and
 * re-allocated, and the invoice number stays exactly as it was.
 */
function AmendModal({ sale, onClose, onSaved }) {
  const toast = useToast();
  const [lines, setLines] = useState(() => sale.items.map((i) => ({
    variant_id: i.variant_id,
    label: `${i.product_name}${i.variant_label ? ` · ${i.variant_label}` : ''}`,
    sku: i.sku,
    quantity: Number(i.quantity),
    unit_price: Number(i.unit_price),
    discount_amount: Number(i.discount_amount),
  })));
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const setLine = (i, patch) => setLines((p) => p.map((l, x) => (x === i ? { ...l, ...patch } : l)));
  const total = lines.reduce(
    (s, l) => s + Number(l.quantity || 0) * Number(l.unit_price || 0) - Number(l.discount_amount || 0), 0);
  const paid = Number(sale.amount_paid);

  const save = async () => {
    const chosen = reason === 'Other (explain below)' ? note.trim() : reason;
    if (!chosen) return toast.error('Choose a reason for the amendment');
    if (!lines.length) return toast.error('An amended sale still needs at least one line');
    setBusy(true);
    try {
      await api.put(`/api/sales/${sale.id}`, {
        items: lines.map((l) => ({
          variant_id: l.variant_id,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          discount_amount: Number(l.discount_amount) || 0,
        })),
        reason: chosen,
        note: note || undefined,
      });
      toast.success('Receipt amended');
      onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} size="lg"
      title={`Edit ${sale.invoice_no}`}
      subtitle="The invoice number and date stay the same. Stock and the customer's balance are corrected automatically."
      footer={
        <>
          <span className="mr-auto text-sm text-slate-600">
            New total {money(total)} · paid {money(paid)}
            {total > paid ? ` · will owe ${money(total - paid)}` : total < paid ? ` · refund ${money(paid - total)}` : ''}
          </span>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : <PencilLine size={16} />} Save amendment
          </button>
        </>
      }>
      <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 p-3 text-xs text-slate-600 mb-4">
        Prices are re-read from the catalogue when you save, so a typo here cannot change what a
        product is worth. The tagged units on the original sale go back on the shelf and are
        re-allocated against the new lines.
      </div>

      <div className="rounded-lg ring-1 ring-slate-200 overflow-hidden mb-3">
        <table className="data">
          <thead>
            <tr>
              <th>Item</th>
              <th className="text-right w-24">Qty</th>
              <th className="text-right w-32">Unit price</th>
              <th className="text-right w-32">Discount</th>
              <th className="text-right w-28">Line</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <div className="text-sm font-medium text-slate-800">{l.label}</div>
                  <div className="text-xs text-slate-500 font-mono">{l.sku}</div>
                </td>
                <td>
                  <input type="number" min="1" className="input py-1 text-right" value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })} />
                </td>
                <td>
                  <input type="number" className="input py-1 text-right" value={l.unit_price}
                    onChange={(e) => setLine(i, { unit_price: e.target.value })} />
                </td>
                <td>
                  <input type="number" className="input py-1 text-right" value={l.discount_amount}
                    onChange={(e) => setLine(i, { discount_amount: e.target.value })} />
                </td>
                <td className="text-right tabular-nums text-sm">
                  {money(Number(l.quantity || 0) * Number(l.unit_price || 0) - Number(l.discount_amount || 0))}
                </td>
                <td>
                  <button className="btn-ghost p-1.5 text-rose-600"
                    onClick={() => setLines((p) => p.filter((_, x) => x !== i))}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <VariantPicker placeholder="Add another item to this receipt…"
        onPick={(v) => setLines((p) => [...p, {
          variant_id: v.variant_id,
          label: `${v.name}${variantLabel(v) !== 'Default' ? ` · ${variantLabel(v)}` : ''}`,
          sku: v.sku, quantity: 1, unit_price: Number(v.price), discount_amount: 0,
        }])} />

      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        <Field label="Reason (kept on the record)">
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Choose…</option>
            {AMEND_REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Note" hint="Required if you chose “Other”">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function Row({ label, value, tone, muted }) {
  return (
    <div className={`flex justify-between ${muted ? 'text-slate-500' : 'text-slate-700'} ${tone || ''}`}>
      <dt>{label}</dt><dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function PaymentModal({ balance, onClose, onSubmit, busy }) {
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  return (
    <Modal open onClose={onClose} title="Take a payment" size="sm"
      subtitle={`Outstanding balance ${money(balance)}`}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy}
          onClick={() => onSubmit(Number(amount), method, reference)}>
          {busy ? <Spinner /> : null} Record payment
        </button></>}>
      <div className="space-y-3">
        <Field label="Amount"><input type="number" className="input" value={amount} autoFocus
          onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Method">
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {['cash', 'transfer', 'card', 'mobile_money'].map((m) =>
              <option key={m} value={m}>{labelize(m)}</option>)}
          </select>
        </Field>
        <Field label="Reference"><input className="input" value={reference}
          onChange={(e) => setReference(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
