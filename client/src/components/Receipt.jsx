import { useEffect } from 'react';
import { money, num, dateTime, labelize } from '../lib/format.js';

/**
 * The printed receipt.
 *
 * Width, font size and the logo all come from Settings → Receipt & invoice, and
 * the same component is used for the on-screen preview, the copy shown after a
 * sale, and the actual print — so what you set is what comes out of the printer.
 *
 * Printing works by pushing the chosen paper width into a CSS variable that the
 * @media print block in index.css reads.
 */

const PAPER = {
  '58mm': { width: '58mm', pad: '2mm', screen: 210 },
  '80mm': { width: '80mm', pad: '4mm', screen: 300 },
  a4: { width: '210mm', pad: '12mm', screen: 620 },
};

export default function Receipt({ data, preview = false }) {
  const b = data?.business || {};
  const s = data?.sale || {};
  const gift = data?.gift;

  const paper = PAPER[b.paper || b.receipt_paper || '80mm'] || PAPER['80mm'];
  const fontSize = Number(b.font_size || b.receipt_font_size || 12);
  const isSheet = (b.paper || b.receipt_paper) === 'a4';

  // hand the print stylesheet the sizes the user picked
  useEffect(() => {
    if (preview) return;
    const root = document.documentElement;
    root.style.setProperty('--receipt-width', paper.width);
    root.style.setProperty('--receipt-pad', paper.pad);
    root.style.setProperty('--receipt-font', `${fontSize}px`);
  }, [preview, paper.width, paper.pad, fontSize]);

  if (!data) return null;

  const logo = b.logo_url;
  const logoWidth = Number(b.logo_width_mm || 30);
  const amended = Number(s.edit_count || 0) > 0;

  return (
    <div
      id={preview ? undefined : 'receipt'}
      className="font-mono text-slate-900 bg-white mx-auto"
      style={{
        fontSize: `${fontSize}px`,
        lineHeight: 1.35,
        width: `${paper.screen}px`,
        maxWidth: '100%',
      }}
    >
      <div className={isSheet ? 'flex items-start gap-4 mb-3' : 'text-center mb-2'}>
        {logo && (
          <img src={logo} alt=""
            className={isSheet ? 'shrink-0' : 'mx-auto mb-1.5'}
            style={{ width: `${logoWidth * 3.78}px`, maxWidth: '70%', objectFit: 'contain' }} />
        )}
        <div className={isSheet ? 'flex-1 min-w-0' : ''}>
          <p className="font-bold uppercase" style={{ fontSize: `${fontSize + 2}px` }}>
            {b.legal_name || b.name}
          </p>
          {b.address && <p style={{ fontSize: `${fontSize - 1}px` }}>{b.address}</p>}
          {b.phone && <p style={{ fontSize: `${fontSize - 1}px` }}>{b.phone}</p>}
          {b.email && <p style={{ fontSize: `${fontSize - 1}px` }}>{b.email}</p>}
          <div className="flex gap-3 justify-center flex-wrap" style={{ fontSize: `${fontSize - 1}px` }}>
            {b.tin && <span>TIN: {b.tin}</span>}
            {b.rc_number && <span>RC: {b.rc_number}</span>}
          </div>
        </div>
      </div>

      <Divider />

      <div className="flex justify-between" style={{ fontSize: `${fontSize - 1}px` }}>
        <span>{s.invoice_no}</span>
        <span>{dateTime(s.created_at)}</span>
      </div>
      <div className="flex justify-between" style={{ fontSize: `${fontSize - 1}px` }}>
        <span>Served by {s.cashier_name || '—'}</span>
        <span>{s.location_name || ''}</span>
      </div>
      {s.customer_name && (
        <p style={{ fontSize: `${fontSize - 1}px` }}>Customer: {s.customer_name}</p>
      )}

      {gift && <p className="text-center mt-1 font-bold">*** GIFT RECEIPT ***</p>}
      {data.offline && <p className="text-center mt-1 font-bold">*** SAVED OFFLINE — WILL SYNC ***</p>}
      {amended && (
        <p className="text-center mt-1 font-bold">
          *** AMENDED COPY — REVISION {s.edit_count} ***
        </p>
      )}

      <Divider />

      <table className="w-full">
        <tbody>
          {(s.items || []).map((i, idx) => (
            <tr key={idx} className="align-top">
              <td className="pr-1 py-0.5">
                <div>{i.product_name}</div>
                <div className="text-slate-600" style={{ fontSize: `${fontSize - 2}px` }}>
                  {i.variant_label}{i.sku ? ` · ${i.sku}` : ''}
                </div>
                {i.units?.length > 0 && (
                  <div className="text-slate-500 break-all" style={{ fontSize: `${fontSize - 3}px` }}>
                    {i.units.map((u) => u.readable || u.epc).join(', ')}
                  </div>
                )}
                <div style={{ fontSize: `${fontSize - 2}px` }}>
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
        {s.subtotal != null && <Line label="Subtotal" value={money(s.subtotal)} />}
        {Number(s.discount_amount) > 0 && <Line label="Discount" value={`− ${money(s.discount_amount)}`} />}
        {s.tax_amount != null && (() => {
          // A basket can mix rates — a standard-rated pair of shoes with a
          // zero-rated item. One "VAT @ 7.5%" line would then be a false
          // statement on a tax document, so break it down whenever the lines
          // actually carry more than one rate.
          const bands = new Map();
          (s.items || []).forEach((i) => {
            const rate = Number(i.tax_rate ?? b.vat_rate);
            const prev = bands.get(rate) || { net: 0, tax: 0 };
            const tax = Number(i.tax_amount || 0);
            bands.set(rate, {
              net: prev.net + (Number(i.line_total || 0) - (b.prices_include_vat ? tax : 0)),
              tax: prev.tax + tax,
            });
          });
          const rows = [...bands.entries()].sort((a, c) => c[0] - a[0]);
          const suffix = b.prices_include_vat ? ' (incl.)' : '';

          if (rows.length <= 1) {
            const rate = rows.length ? rows[0][0] : Number(b.vat_rate);
            return <Line label={`VAT @ ${Number(rate).toFixed(rate % 1 ? 2 : 1)}%${suffix}`}
              value={money(s.tax_amount)} />;
          }
          return (
            <>
              {rows.map(([rate, v]) => (
                <Line key={rate}
                  label={rate === 0
                    ? `Zero-rated${suffix} on ${money(v.net)}`
                    : `VAT @ ${Number(rate).toFixed(rate % 1 ? 2 : 1)}%${suffix} on ${money(v.net)}`}
                  value={money(v.tax)} />
              ))}
              <Line label="Total VAT" value={money(s.tax_amount)} />
            </>
          );
        })()}
        {s.total != null && <Line label="TOTAL" value={money(s.total)} bold />}
      </dl>

      {!gift && (s.payments || []).length > 0 && (
        <>
          <Divider />
          {s.payments.map((p, i) => (
            <Line key={i} label={labelize(p.method)} value={money(p.amount)} />
          ))}
          {Number(s.change_due) > 0 && <Line label="Change" value={money(s.change_due)} />}
          {Number(s.balance_due) > 0 && <Line label="Balance due" value={money(s.balance_due)} bold />}
        </>
      )}

      {!gift && Number(s.points_earned) > 0 && (
        <p className="mt-1" style={{ fontSize: `${fontSize - 1}px` }}>
          Loyalty points earned: {num(s.points_earned)}
        </p>
      )}

      <Divider />

      <p className="text-center mt-1 whitespace-pre-line" style={{ fontSize: `${fontSize - 1}px` }}>
        {b.footer}
      </p>
      {s.invoice_seq && (
        <p className="text-center text-slate-500 mt-1" style={{ fontSize: `${fontSize - 3}px` }}>
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
