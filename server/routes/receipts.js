/**
 * Digital receipts — WhatsApp, SMS, and a link.
 *
 * Deliberately NOT an SMS gateway integration. A Nigerian shop's phone already
 * has WhatsApp on it and the customer is standing right there, so the thing
 * that actually works is a wa.me link that opens the chat with the message
 * already written. No API key, no per-message cost, no account to keep topped
 * up, and it works the first day rather than after a procurement conversation.
 *
 * The receipt itself lives behind an unguessable token so the link can be sent
 * to a customer who has no login. The token is per-delivery, so revoking one
 * does not break the others, and it reveals only that one sale.
 */
import crypto from 'crypto';
import { Router } from 'express';
import { many, one, query } from '../db/index.js';
import { h, bad, notFound, str, int, getSettings } from '../lib/util.js';
import { requirePerm, requireFeature } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const r = Router();

/** A phone number the way WhatsApp wants it: digits, country code, no plus. */
export function toWhatsAppNumber(raw, countryCode = '234') {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  // 08031234567 → 2348031234567. Nigerian mobile numbers are written with a
  // leading zero locally and never sent that way.
  if (digits.startsWith('0')) digits = countryCode + digits.slice(1);
  else if (digits.startsWith(countryCode)) { /* already international */ }
  else if (digits.length <= 10) digits = countryCode + digits;
  return digits;
}

r.use(requireFeature('digital_receipts'));

/**
 * Prepare a receipt to send.
 *
 * Returns the link and a pre-written message. The till opens it; nothing is
 * sent from the server, so nothing can silently fail in the background.
 */
r.post('/:saleId(\\d+)/share', requirePerm('sales.read'), h(async (req, res) => {
  const saleId = int(req.params.saleId);
  const channel = str(req.body.channel) || 'whatsapp';
  if (!['whatsapp', 'sms', 'email', 'link'].includes(channel))
    throw bad('Channel must be whatsapp, sms, email or link.');

  const sale = await one(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone,
            c.whatsapp AS customer_whatsapp, c.email AS customer_email,
            l.name AS location_name
       FROM sales s
       LEFT JOIN customers c ON c.id=s.customer_id
       LEFT JOIN locations l ON l.id=s.location_id
      WHERE s.id=$1`, [saleId]);
  if (!sale) throw notFound('Sale not found');

  const settings = await getSettings();
  const address = str(req.body.address)
    || (channel === 'email' ? sale.customer_email
      : sale.customer_whatsapp || sale.customer_phone) || '';
  if (channel !== 'link' && !address) {
    throw bad('No number or address on file for that customer. Type one in.');
  }

  // 32 bytes of randomness. Guessing one is not a thing that happens; the
  // point is that the link is safe to hand to a customer.
  const token = crypto.randomBytes(24).toString('base64url');

  const delivery = await one(
    `INSERT INTO receipt_deliveries (sale_id, channel, address, token, user_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [saleId, channel, address || null, token, req.user.id]);

  // The public URL the shop is reachable on. Falls back to the request's own
  // host, which is right in every case except a reverse proxy the shop has
  // not told us about — hence the setting.
  const base = (settings.public_base_url || '').replace(/\/+$/, '')
    || `${req.protocol}://${req.get('host')}`;
  const link = `${base}/r/${token}`;

  const money = (n) => `${settings.currency_symbol || '₦'}${Number(n).toLocaleString('en-NG',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const message = [
    `Thank you for shopping at ${settings.name || 'our shop'}.`,
    `Receipt ${sale.invoice_no} — ${money(sale.total)}`,
    '',
    link,
  ].join('\n');

  const waNumber = toWhatsAppNumber(address, '234');
  const share = {
    whatsapp: waNumber ? `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}` : null,
    sms: address ? `sms:${address}?body=${encodeURIComponent(message)}` : null,
    email: address
      ? `mailto:${address}?subject=${encodeURIComponent(`Receipt ${sale.invoice_no}`)}&body=${encodeURIComponent(message)}`
      : null,
    link,
  };

  await audit(req, 'share_receipt', 'sale', saleId, { channel, address });
  res.status(201).json({ delivery, link, message, share, share_url: share[channel] || link });
}));

r.get('/:saleId(\\d+)/deliveries', requirePerm('sales.read'), h(async (req, res) => {
  const rows = await many(
    `SELECT rd.*, u.name AS user_name FROM receipt_deliveries rd
       LEFT JOIN users u ON u.id=rd.user_id
      WHERE rd.sale_id=$1 ORDER BY rd.created_at DESC`, [int(req.params.saleId)]);
  // Never hand the tokens back out in a list — a screenshot of a sale's
  // history should not be a set of working links.
  res.json(rows.map(({ token, ...rest }) => rest));
}));

export default r;

/**
 * The public receipt page, mounted OUTSIDE the authenticated API.
 *
 * Read-only, one sale, no session. Everything a customer needs to check what
 * they were charged, and nothing else.
 */
export function publicReceiptRouter() {
  const pub = Router();

  pub.get('/:token', h(async (req, res) => {
    const token = String(req.params.token || '');
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw notFound('No such receipt');

    const delivery = await one('SELECT * FROM receipt_deliveries WHERE token=$1', [token]);
    if (!delivery) throw notFound('No such receipt');

    const sale = await one(
      `SELECT s.id, s.invoice_no, s.created_at, s.subtotal, s.discount_amount,
              s.tax_amount, s.total, s.amount_paid, s.change_due, s.balance_due,
              l.name AS location_name, l.address AS location_address, l.phone AS location_phone,
              c.name AS customer_name
         FROM sales s
         LEFT JOIN locations l ON l.id=s.location_id
         LEFT JOIN customers c ON c.id=s.customer_id
        WHERE s.id=$1`, [delivery.sale_id]);
    if (!sale) throw notFound('No such receipt');

    const items = await many(
      `SELECT product_name, variant_label, quantity, unit_price, discount_amount, line_total
         FROM sale_items WHERE sale_id=$1 ORDER BY id`, [sale.id]);
    const payments = await many(
      'SELECT method, amount FROM payments WHERE sale_id=$1 ORDER BY id', [sale.id]);

    const settings = await getSettings();

    // First open is worth recording: it is the difference between "I sent it"
    // and "they got it", which is the only question anyone asks about a
    // receipt that has gone missing.
    if (!delivery.opened_at) {
      await query(
        "UPDATE receipt_deliveries SET opened_at=now(), status='opened' WHERE id=$1",
        [delivery.id]).catch(() => {});
    }

    res.json({
      sale, items, payments,
      business: {
        name: settings.name, address: settings.address, phone: settings.phone,
        tin: settings.tin, logo_url: settings.receipt_show_logo ? settings.logo_url : null,
        currency_symbol: settings.currency_symbol,
        footer: settings.receipt_footer,
      },
    });
  }));

  return pub;
}
