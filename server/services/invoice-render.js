/**
 * Render a sale to a printable HTML document from a stored layout.
 *
 * One function serves the 80mm thermal receipt and the A4 invoice — the layout
 * decides paper size, which blocks show, the letterhead, colours and whether an
 * e-invoice QR is printed. The output is self-contained HTML (inline styles, an
 * inline SVG QR) so it prints from any browser and needs nothing external.
 */
import QRCode from 'qrcode';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const fmt = (n, sym) => `${sym || '₦'}${Number(n || 0).toLocaleString('en-NG',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** layout: an invoice_layouts row. sale: loadSale() shape. settings: business. */
export async function renderInvoice({ sale, layout, settings, link = '' }) {
  const sym = settings.currency_symbol || '₦';
  const a4 = layout.paper === 'A4';
  const accent = layout.accent_color || '#0f172a';
  const width = a4 ? '210mm' : '80mm';
  const pad = a4 ? '18mm' : '4mm';
  const fs = a4 ? '13px' : '12px';

  let qr = '';
  if (layout.show_qr && link) {
    try { qr = await QRCode.toString(link, { type: 'svg', margin: 0, width: a4 ? 96 : 76 }); }
    catch { qr = ''; }
  }

  const logo = (layout.show_logo && (layout.logo_url || settings.logo_url))
    ? `<img src="${esc(layout.logo_url || settings.logo_url)}" style="max-height:${a4 ? 64 : 44}px;max-width:60%" />` : '';

  const itemsRows = (sale.items || []).map((it) => `
    <tr>
      <td style="padding:2px 0">${esc(it.product_name)}${it.variant_label ? `<div style="color:#64748b;font-size:.85em">${esc(it.variant_label)}</div>` : ''}</td>
      <td style="text-align:right;white-space:nowrap">${Number(it.quantity)}×</td>
      <td style="text-align:right;white-space:nowrap">${fmt(it.unit_price, sym)}</td>
      <td style="text-align:right;white-space:nowrap">${fmt(it.line_total, sym)}</td>
    </tr>`).join('');

  const payRows = layout.show_payment && (sale.payments || []).length
    ? `<div style="margin-top:6px">${sale.payments.map((p) =>
        `<div style="display:flex;justify-content:space-between"><span style="text-transform:capitalize">${esc(p.method.replace('_', ' '))}</span><span>${fmt(p.amount, sym)}</span></div>`).join('')}</div>`
    : '';

  const customer = layout.show_customer && sale.customer_name
    ? `<div style="margin:8px 0;font-size:.95em">
         <div style="color:#64748b">Bill to</div>
         <div style="font-weight:600">${esc(sale.customer_name)}</div>
         ${sale.customer_phone ? `<div>${esc(sale.customer_phone)}</div>` : ''}
         ${sale.customer_address ? `<div>${esc(sale.customer_address)}</div>` : ''}
       </div>` : '';

  const docLabel = { receipt: 'RECEIPT', invoice: 'INVOICE', quotation: 'QUOTATION', delivery: 'DELIVERY NOTE' }[layout.doc_type] || 'RECEIPT';

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(docLabel)} ${esc(sale.invoice_no || '')}</title>
<style>
  @page { size: ${a4 ? 'A4' : '80mm auto'}; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: ${a4 ? 'Arial, Helvetica, sans-serif' : 'ui-monospace, "Courier New", monospace'};
         font-size:${fs}; color:#0f172a; margin:0; }
  .doc { width:${width}; max-width:100%; margin:0 auto; padding:${pad}; }
  table.items { width:100%; border-collapse:collapse; }
  table.items th { text-align:left; border-bottom:1px solid ${accent}; padding:3px 0; font-size:.85em; color:#475569; }
  .tot { display:flex; justify-content:space-between; padding:2px 0; }
  .tot.grand { font-weight:700; border-top:2px solid ${accent}; margin-top:4px; padding-top:6px; font-size:1.15em; }
  .muted { color:#64748b; }
  @media print { .noprint { display:none; } }
</style></head>
<body><div class="doc">
  <div style="text-align:center">
    ${logo}
    <div style="font-weight:700;font-size:1.25em;color:${accent}">${esc(layout.header_text || settings.name || 'My Shop')}</div>
    ${settings.address ? `<div class="muted" style="font-size:.9em">${esc(settings.address)}</div>` : ''}
    ${settings.phone ? `<div class="muted" style="font-size:.9em">${esc(settings.phone)}${settings.tin ? ` · TIN ${esc(settings.tin)}` : ''}</div>` : ''}
    ${layout.sub_header ? `<div class="muted" style="font-size:.9em">${esc(layout.sub_header)}</div>` : ''}
  </div>

  <div style="text-align:center;letter-spacing:2px;margin:8px 0;color:${accent};font-weight:700">${docLabel}</div>

  <div style="display:flex;justify-content:space-between;font-size:.92em">
    <div><span class="muted">No.</span> ${esc(sale.invoice_no || '')}</div>
    <div><span class="muted">Date</span> ${new Date(sale.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</div>
  </div>
  ${sale.cashier_name ? `<div style="font-size:.9em"><span class="muted">Served by</span> ${esc(sale.cashier_name)}</div>` : ''}

  ${customer}

  <table class="items" style="margin-top:8px">
    <thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${itemsRows}</tbody>
  </table>

  <div style="margin-top:8px">
    <div class="tot"><span class="muted">Subtotal</span><span>${fmt(sale.subtotal, sym)}</span></div>
    ${Number(sale.discount_amount) ? `<div class="tot"><span class="muted">Discount</span><span>− ${fmt(sale.discount_amount, sym)}</span></div>` : ''}
    ${layout.show_tax && Number(sale.tax_amount) ? `<div class="tot"><span class="muted">VAT</span><span>${fmt(sale.tax_amount, sym)}</span></div>` : ''}
    <div class="tot grand"><span>Total</span><span>${fmt(sale.total, sym)}</span></div>
    ${Number(sale.balance_due) ? `<div class="tot"><span class="muted">Balance due</span><span>${fmt(sale.balance_due, sym)}</span></div>` : ''}
  </div>
  ${payRows}

  ${qr ? `<div style="text-align:center;margin-top:12px">${qr}<div class="muted" style="font-size:.8em;margin-top:2px">Scan to verify</div></div>` : ''}

  ${layout.terms_text ? `<div class="muted" style="font-size:.85em;margin-top:10px;white-space:pre-wrap">${esc(layout.terms_text)}</div>` : ''}
  ${layout.show_signature ? `<div style="margin-top:26px;display:flex;justify-content:space-between;font-size:.85em">
     <div style="border-top:1px solid #94a3b8;padding-top:2px;width:45%">Customer</div>
     <div style="border-top:1px solid #94a3b8;padding-top:2px;width:45%;text-align:right">For ${esc(settings.name || 'the shop')}</div></div>` : ''}

  <div style="text-align:center;margin-top:12px" class="muted">${esc(layout.footer_text || 'Thank you')}</div>

  <div class="noprint" style="text-align:center;margin-top:16px">
    <button onclick="window.print()" style="padding:8px 20px;border:0;border-radius:8px;background:${accent};color:#fff;font-size:14px;cursor:pointer">Print</button>
  </div>
</div></body></html>`;
}
