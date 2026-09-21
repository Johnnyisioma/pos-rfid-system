/**
 * Notifications — templates, provider settings, the send/queue action and the
 * log. The heavy lifting is in services/notify.js; this is the door to it.
 */
import { Router } from 'express';
import { many, one, query } from '../db/index.js';
import { h, bad, notFound, str, int, bool, paging } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { queueSaleNotification } from '../services/notify.js';

const r = Router();

/* ═══════════════════ templates ═══════════════════ */
r.get('/templates', requirePerm('settings.read'), h(async (req, res) => {
  res.json(await many('SELECT * FROM notification_templates ORDER BY key, channel'));
}));

r.post('/templates', requirePerm('settings.write'), h(async (req, res) => {
  const key = str(req.body.key).trim();
  const channel = ['whatsapp', 'sms', 'email'].includes(str(req.body.channel)) ? req.body.channel : 'whatsapp';
  if (!key) throw bad('A template needs a key (event).');
  const row = await one(
    `INSERT INTO notification_templates (key, channel, subject, body, is_active)
     VALUES ($1,$2,$3,$4,TRUE)
     ON CONFLICT (key, channel) DO UPDATE SET subject=EXCLUDED.subject, body=EXCLUDED.body
     RETURNING *`, [key, channel, str(req.body.subject), str(req.body.body)]);
  await audit(req, 'save', 'notification_template', row.id, { key, channel });
  res.json(row);
}));

r.put('/templates/:id(\\d+)', requirePerm('settings.write'), h(async (req, res) => {
  const row = await one(
    `UPDATE notification_templates SET subject=COALESCE($2,subject), body=COALESCE($3,body),
            is_active=COALESCE($4,is_active) WHERE id=$1 RETURNING *`,
    [req.params.id, req.body.subject ?? null, req.body.body ?? null,
     'is_active' in req.body ? bool(req.body.is_active) : null]);
  if (!row) throw notFound('Template not found');
  res.json(row);
}));

/* ═══════════════════ provider settings ═══════════════════ */
r.get('/settings', requirePerm('settings.read'), h(async (req, res) => {
  const row = await one('SELECT * FROM notification_settings WHERE id=1');
  res.json(row || {});
}));

r.put('/settings', requirePerm('settings.write'), h(async (req, res) => {
  const b = req.body || {};
  const row = await one(
    `UPDATE notification_settings SET
        whatsapp_enabled=COALESCE($1,whatsapp_enabled),
        sms_enabled=COALESCE($2,sms_enabled),
        email_enabled=COALESCE($3,email_enabled),
        sms_gateway_url=COALESCE($4,sms_gateway_url),
        sms_sender_id=COALESCE($5,sms_sender_id),
        email_from=COALESCE($6,email_from),
        auto_on_sale=COALESCE($7,auto_on_sale),
        updated_at=now()
      WHERE id=1 RETURNING *`,
    ['whatsapp_enabled' in b ? bool(b.whatsapp_enabled) : null,
     'sms_enabled' in b ? bool(b.sms_enabled) : null,
     'email_enabled' in b ? bool(b.email_enabled) : null,
     b.sms_gateway_url ?? null, b.sms_sender_id ?? null, b.email_from ?? null,
     'auto_on_sale' in b ? bool(b.auto_on_sale) : null]);
  await audit(req, 'update', 'notification_settings', 1, {});
  res.json(row);
}));

/* ═══════════════════ send / queue ═══════════════════ */
/** Queue a notification for a sale on a channel. Returns the log row, whose
 *  `link` the UI opens to actually deliver it (wa.me / sms: / mailto:). */
r.post('/send', requirePerm('sales.read'), h(async (req, res) => {
  const saleId = int(req.body.sale_id);
  if (!saleId) throw bad('Which sale?');
  const channel = ['whatsapp', 'sms', 'email'].includes(str(req.body.channel)) ? req.body.channel : 'whatsapp';
  const row = await queueSaleNotification({
    saleId, key: str(req.body.key) || 'sale_complete', channel,
    address: str(req.body.address) || null, userId: req.user.id, req });
  await audit(req, 'queue', 'notification', row.id, { channel, sale: saleId });
  res.status(201).json(row);
}));

/** Mark a queued notification as actually sent (after the shop opened the link). */
r.post('/:id(\\d+)/sent', requirePerm('sales.read'), h(async (req, res) => {
  const row = await one(
    "UPDATE notification_log SET status='sent', sent_at=now() WHERE id=$1 RETURNING *", [req.params.id]);
  if (!row) throw notFound('Not found');
  res.json(row);
}));

/* ═══════════════════ log ═══════════════════ */
r.get('/log', requirePerm('sales.read'), h(async (req, res) => {
  const { limit, offset, page } = paging(req, 40);
  const rows = await many(
    `SELECT nl.*, c.name AS customer_name, u.name AS created_by_name
       FROM notification_log nl
       LEFT JOIN customers c ON c.id=nl.customer_id
       LEFT JOIN users u ON u.id=nl.created_by
      WHERE ($1='' OR nl.channel=$1) AND ($2='' OR nl.status=$2)
      ORDER BY nl.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [str(req.query.channel), str(req.query.status)]);
  res.json({ data: rows, page, limit });
}));

r.get('/log/for/:entityType/:entityId(\\d+)', requirePerm('sales.read'), h(async (req, res) => {
  res.json(await many(
    `SELECT * FROM notification_log WHERE entity_type=$1 AND entity_id=$2 ORDER BY created_at DESC`,
    [req.params.entityType, req.params.entityId]));
}));

export default r;
