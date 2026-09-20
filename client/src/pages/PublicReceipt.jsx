import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Receipt as ReceiptIcon, AlertTriangle, Printer } from 'lucide-react';
import { url } from '../lib/api.js';

/**
 * The customer's copy.
 *
 * No login, no chrome, no menu — a page you can open from a WhatsApp message
 * on a phone with one bar of signal. It deliberately does not use the app's
 * api helper's auth path: the whole point is that the token in the URL is the
 * only credential.
 */
export default function PublicReceipt() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(url(`/api/r/${token}`))
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404
          ? 'That receipt link is not valid. Ask the shop to send it again.'
          : 'Could not load that receipt.');
        return res.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-100 grid place-items-center p-6">
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6 max-w-sm text-center">
          <AlertTriangle size={28} className="text-amber-500 mx-auto mb-3" />
          <p className="text-slate-800">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="min-h-screen bg-slate-100 grid place-items-center text-slate-500">Loading…</div>;
  }

  const { sale, items, payments, business } = data;
  const sym = business.currency_symbol || '₦';
  const money = (n) => `${sym}${Number(n || 0).toLocaleString('en-NG',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="min-h-screen bg-slate-100 py-6 px-4 print:bg-white print:py-0">
      <div className="max-w-sm mx-auto bg-white rounded-2xl ring-1 ring-slate-200 p-6 print:ring-0 print:rounded-none">
        <div className="text-center border-b border-dashed border-slate-300 pb-4">
          {business.logo_url
            ? <img src={business.logo_url} alt="" className="h-12 mx-auto mb-2 object-contain" />
            : <ReceiptIcon size={28} className="mx-auto text-slate-400 mb-2" />}
          <h1 className="font-semibold text-slate-900">{business.name}</h1>
          {business.address && <p className="text-xs text-slate-500 mt-0.5">{business.address}</p>}
          {business.phone && <p className="text-xs text-slate-500">{business.phone}</p>}
          {business.tin && <p className="text-xs text-slate-400 mt-1">TIN {business.tin}</p>}
        </div>

        <div className="flex justify-between text-xs text-slate-600 py-3 border-b border-dashed border-slate-300">
          <span className="font-mono font-medium">{sale.invoice_no}</span>
          <span>{new Date(sale.created_at).toLocaleString('en-NG')}</span>
        </div>

        <table className="w-full text-sm my-3">
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="align-top">
                <td className="py-1.5">
                  <p className="text-slate-800 leading-tight">{it.product_name}</p>
                  {it.variant_label && <p className="text-xs text-slate-500">{it.variant_label}</p>}
                  <p className="text-xs text-slate-500">
                    {Number(it.quantity)} × {money(it.unit_price)}
                  </p>
                </td>
                <td className="py-1.5 text-right tabular-nums whitespace-nowrap">
                  {money(it.line_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="text-sm space-y-1 border-t border-dashed border-slate-300 pt-3">
          <Row label="Subtotal" value={money(sale.subtotal)} />
          {Number(sale.discount_amount) > 0 && (
            <Row label="Discount" value={`- ${money(sale.discount_amount)}`} />
          )}
          {Number(sale.tax_amount) > 0 && <Row label="VAT" value={money(sale.tax_amount)} />}
          <div className="flex justify-between font-semibold text-slate-900 text-base pt-1">
            <dt>Total</dt><dd className="tabular-nums">{money(sale.total)}</dd>
          </div>
          {payments.map((p, i) => (
            <Row key={i} label={p.method.replace('_', ' ')} value={money(p.amount)} muted />
          ))}
          {Number(sale.change_due) > 0 && <Row label="Change" value={money(sale.change_due)} muted />}
          {Number(sale.balance_due) > 0 && (
            <Row label="Balance due" value={money(sale.balance_due)} />
          )}
        </dl>

        {business.footer && (
          <p className="text-xs text-slate-500 text-center mt-5 pt-4 border-t border-dashed border-slate-300">
            {business.footer}
          </p>
        )}

        <button onClick={() => window.print()}
          className="w-full mt-5 rounded-xl bg-slate-900 text-white py-2.5 text-sm font-medium print:hidden">
          <Printer size={15} className="inline mr-1.5 -mt-0.5" /> Print or save as PDF
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, muted }) {
  return (
    <div className={`flex justify-between ${muted ? 'text-slate-500' : 'text-slate-700'}`}>
      <dt className="capitalize">{label}</dt><dd className="tabular-nums">{value}</dd>
    </div>
  );
}
