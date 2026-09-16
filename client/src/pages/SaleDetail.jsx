import { useEffect, useState, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Printer, Gift, RotateCcw, CreditCard, Radio, FileCode2,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { money, num, dateTime, labelize } from '../lib/format.js';
import { Card, Loading, Badge, Modal, useToast, Field, Empty, Spinner } from '../components/ui.jsx';
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

  const load = useCallback(async () => {
    try {
      const s = await api.get(`/api/sales/${id}`);
      setSale(s);
      setReceipt(await api.get(`/api/sales/${id}/receipt`));
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
