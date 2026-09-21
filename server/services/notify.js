/**
 * The notification engine — one place that turns an event and a template into a
 * message and records it, whatever the channel.
 *
 * It is deliberately provider-agnostic. WhatsApp works on day one with no
 * account, because a wa.me link opens the shop's own WhatsApp with the message
 * pre-written — no gateway, no per-message cost. SMS and email carry a link too,
 * and a shop that has a gateway can point the settings at it later without any
 * code change. Every attempt is written to notification_log so "did the customer
 * get their receipt?" has an answer.
 */
import crypto from 'crypto';
import { many, one, query } from '../db/index.js';
import { getSettings } from '../lib/util.js';
import { toWhatsAppNumber } from '../routes/receipts.js';

const fmtMoney = (n, sym) => `${sym || '₦'}${Number(n || 0).toLocaleString('en-NG',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Fill {name} {invoice} {total} {balance} {link} {shop} {phone} in a template. */
export function fillTemplate(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : ''));
}

/** A public, login-free receipt link for a sale (creates a delivery token). */
export async function receiptLink(saleId, { channel = 'link', address = null, userId = null, req = null } = {}) {
  const settings = await getSettings();
  const token = crypto.randomBytes(24).toString('base64url');
  await query(
    `INSERT INTO receipt_deliveries (sale_id, channel, address, token, user_id)
     VALUES ($1,$2,$3,$4,$5)`, [saleId, channel, address, token, userId]);
  const base = (settings.public_base_url || '').replace(/\/+$/, '')
    || (req ? `${req.protocol}://${req.get('host')}` : '');
  return `${base}/r/${token}`;
}

/**
 * Build a message for a sale from the stored template for (key, channel), fill
 * it, and record it in the log. Returns the log row including a `link` the UI
 * can open (wa.me / sms: / mailto:) — the actual "send" for WhatsApp is the
 * shop tapping that link, which is why the status starts at 'queued'.
 */
export async function queueSaleNotification({ saleId, key = 'sale_complete', channel = 'whatsapp',
  address = null, userId = null, req = null }) {
  const settings = await getSettings();
  const sym = settings.currency_symbol || '₦';
  const sale = await one(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
            c.id AS cust_id
       FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.id=$1`, [saleId]);
  if (!sale) throw new Error('Sale not found');

  const recipient = address
    || (channel === 'email' ? sale.customer_email : sale.customer_phone) || '';

  const tpl = await one('SELECT * FROM notification_templates WHERE key=$1 AND channel=$2 AND is_active',
    [key, channel]);
  const link = await receiptLink(saleId, { channel, address: recipient, userId, req });
  const vars = {
    name: sale.customer_name || 'there',
    invoice: sale.invoice_no || '',
    total: fmtMoney(sale.total, sym),
    balance: fmtMoney(sale.balance_due, sym),
    link, shop: settings.name || 'our shop', phone: settings.phone || '',
  };
  const subject = fillTemplate(tpl?.subject || `Receipt ${sale.invoice_no}`, vars);
  const body = fillTemplate(tpl?.body
    || 'Thank you for shopping at {shop}. Receipt {invoice} — {total}. {link}', vars);

  // The share link that actually delivers it.
  let shareLink = link;
  if (channel === 'whatsapp') {
    const wa = toWhatsAppNumber(recipient, '234');
    shareLink = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(body)}`
      : `https://wa.me/?text=${encodeURIComponent(body)}`;
  } else if (channel === 'sms') {
    shareLink = recipient ? `sms:${recipient}?body=${encodeURIComponent(body)}` : '';
  } else if (channel === 'email') {
    shareLink = recipient
      ? `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : '';
  }

  const row = await one(
    `INSERT INTO notification_log
       (channel, template_key, recipient, subject, body, status, link, entity_type, entity_id, customer_id, created_by)
     VALUES ($1,$2,$3,$4,$5,'queued',$6,'sale',$7,$8,$9) RETURNING *`,
    [channel, key, recipient, subject, body, shareLink, saleId, sale.cust_id || null, userId]);
  return row;
}
