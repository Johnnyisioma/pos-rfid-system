import { money, num, dateTime, labelize } from '../lib/format.js';

/**
 * 80 mm thermal-style receipt. Rendered on screen and printed as-is
 * (see the @media print block in index.css). ESC/POS printers driven from the
 * browser print dialog use exactly this layout.
 */
export default function Receipt({ data }) {
  if (!data) return null;
  const b = data.business || {};
  const s = data.sale || {};
  const gift = data.gift;
  const hide = (v, node) => (v === null || v === undefined ? null : node);

  return (
    <div id="receipt" className="font-mono text-[12px] leading-snug text-slate-900 bg-white">
      <div className="text-center mb-2">
        <p className="font-bold text-sm uppercase">{b.legal_name || b.name}</p>
        {b.address && <p className="text-[11px]">{b.address}</p>}
        {b.phone && <p className="text-[11px]">{b.phone}</p>}
        {b.tin && <p className="text-[11px]">TIN: {b.tin}</p>}
      </div>

      <Divider />

      <div className="flex justify-between text-[11px]">
        <span>{s.invoice_no}</span>
        <span>{dateTime(s.created_at)}</span>
      </div>
      <div className="flex justify-between text-[11px]">
        <span>Served by {s.cashier_name || '—'}</span>
        <span>{s.location_name || ''}</span>
      </div>
      {s.customer_name && <p className="text-[11px]">Customer: {s.customer_name}</p>}
      {gift && <p className="text-center mt-1 font-bold">*** GIFT RECEIPT ***</p>}
      {data.offline && (
        <p className="text-center mt-1 font-bold">
          *** SAVED OFFLINE — WILL SYNC ***
        </p>
      )}

      <Divider />

      <table className="w-full">
        <tbody>
          {(s.items || []).map((i, idx) => (
            <tr key={idx} className="align-top">
              <td className="pr-1 py-0.5">
                <div>{i.product_name}</div>
                <div className="text-[10px] text-slate-600">
                  {i.variant_label}{i.sku ? ` · ${i.sku}` : ''}
                </div>
                {i.units?.length > 0 && (
                  <div className="text-[9px] text-slate-500 break-all">
                    {i.units.map((u) => u.readable || u.epc).join(', ')}
                  </div>
                )}
                <div className="text-[10px]">
                  {num(i.quantity)} {i.unit_price != null ? `× ${money(i.unit_price)}` : ''}
                  {Number(i.discount_amount) > 0 ? ` − ${money(i.discount_amount)}` : ''}
                </div>
              </td>
              <td className="text-right whitespace-nowrap py-0.5">
                {i.line_total != null ? money(i.line_total) : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Divider />

      <dl className="space-y-0.5">
        {hide(s.subtotal, <Line label="Subtotal" value={money(s.subtotal)} />)}
        {Number(s.discount_amount) > 0 && <Line label="Discount" value={`− ${money(s.discount_amount)}`} />}
        {hide(s.tax_amount, (
          <Line label={`VAT @ ${b.vat_rate}%${b.prices_include_vat ? ' (incl.)' : ''}`} value={money(s.tax_amount)} />
        ))}
        {hide(s.total, <Line label="TOTAL" value={money(s.total)} bold />)}
      </dl>

      {!gift && (s.payments || []).length > 0 && (
        <>
          <Divider />
          {s.payments.map((p, i) => (
            <Line key={i} label={labelize(p.method)}
              value={money(p.amount)} />
          ))}
          {Number(s.change_due) > 0 && <Line label="Change" value={money(s.change_due)} />}
          {Number(s.balance_due) > 0 && <Line label="Balance due" value={money(s.balance_due)} bold />}
        </>
      )}

      {!gift && Number(s.points_earned) > 0 && (
        <p className="text-[11px] mt-1">Loyalty points earned: {num(s.points_earned)}</p>
      )}

      <Divider />

      <p className="text-center text-[11px] mt-1 whitespace-pre-line">{b.footer}</p>
      {s.invoice_seq && (
        <p className="text-center text-[9px] text-slate-500 mt-1">
          Invoice sequence {s.invoice_seq} · VAT-registered receipt
        </p>
      )}
    </div>
  );
}

const Divider = () => <div className="border-t border-dashed border-slate-400 my-1.5" />;

function Line({ label, value, bold }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}>
      <dt>{label}</dt><dd>{value}</dd>
    </div>
  );
}
