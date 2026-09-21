/**
 * Documents — the invoice/receipt layout designer, the renderer that turns a
 * sale into a printable page from a chosen layout, and file attachments on
 * transactions (a signed delivery note, a supplier's invoice photo, a warranty
 * card scan).
 */
import { Router } from 'express';
import multer from 'multer';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, int, bool, getSettings } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { loadSale } from './sales.js';
import { renderInvoice } from '../services/invoice-render.js';
import { receiptLink } from '../services/notify.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

/* ═══════════════════ invoice / receipt layouts ═══════════════════ */
const LAYOUT_FIELDS = [
  'name', 'doc_type', 'header_text', 'sub_header', 'footer_text', 'terms_text',
  'show_logo', 'show_tax', 'show_barcode', 'show_qr', 'show_signature',
  'show_customer', 'show_payment', 'paper', 'logo_url', 'accent_color', 'is_active',
];

r.get('/layouts', requirePerm('settings.read'), h(async (req, res) => {
  const rows = await many(
    `SELECT * FROM invoice_layouts WHERE ($1='' OR doc_type=$1) ORDER BY doc_type, is_default DESC, name`,
    [str(req.query.doc_type)]);
  res.json(rows);
}));

r.get('/layouts/:id(\\d+)', requirePerm('settings.read'), h(async (req, res) => {
  const row = await one('SELECT * FROM invoice_layouts WHERE id=$1', [req.params.id]);
  if (!row) throw notFound('Layout not found');
  res.json(row);
}));

function layoutValues(body) {
  const b = body || {};
  const bools = ['show_logo', 'show_tax', 'show_barcode', 'show_qr', 'show_signature', 'show_customer', 'show_payment', 'is_active'];
  const out = {};
  for (const f of LAYOUT_FIELDS) {
    if (!(f in b)) continue;
    out[f] = bools.includes(f) ? bool(b[f]) : str(b[f]);
  }
  return out;
}

r.post('/layouts', requirePerm('settings.write'), h(async (req, res) => {
  const v = layoutValues(req.body);
  if (!v.name) throw bad('Name the layout.');
  const cols = Object.keys(v);
  const row = await one(
    `INSERT INTO invoice_layouts (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
    cols.map((c) => v[c]));
  await audit(req, 'create', 'invoice_layout', row.id, { name: v.name });
  res.status(201).json(row);
}));

r.put('/layouts/:id(\\d+)', requirePerm('settings.write'), h(async (req, res) => {
  const v = layoutValues(req.body);
  const cols = Object.keys(v);
  if (!cols.length) throw bad('Nothing to update.');
  const row = await one(
    `UPDATE invoice_layouts SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING *`,
    [req.params.id, ...cols.map((c) => v[c])]);
  if (!row) throw notFound('Layout not found');
  await audit(req, 'update', 'invoice_layout', row.id, {});
  res.json(row);
}));

/** Make this the default for its document type (only one default per type). */
r.post('/layouts/:id(\\d+)/default', requirePerm('settings.write'), h(async (req, res) => {
  const out = await tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM invoice_layouts WHERE id=$1', [req.params.id]);
    if (!rows.length) throw notFound('Layout not found');
    await c.query('UPDATE invoice_layouts SET is_default=FALSE WHERE doc_type=$1', [rows[0].doc_type]);
    await c.query('UPDATE invoice_layouts SET is_default=TRUE WHERE id=$1', [req.params.id]);
    return rows[0];
  });
  res.json({ ok: true, doc_type: out.doc_type });
}));

r.delete('/layouts/:id(\\d+)', requirePerm('settings.write'), h(async (req, res) => {
  const row = await one('SELECT is_default FROM invoice_layouts WHERE id=$1', [req.params.id]);
  if (!row) throw notFound('Layout not found');
  if (row.is_default) throw bad('Make another layout the default before deleting this one.');
  await query('DELETE FROM invoice_layouts WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

/* ═══════════════════ render a sale ═══════════════════ */
/** GET .../render/sale/123?layout_id=2 → printable HTML. layout_id optional. */
r.get('/render/sale/:saleId(\\d+)', requirePerm('sales.read'), h(async (req, res) => {
  const sale = await loadSale(int(req.params.saleId));
  if (!sale) throw notFound('Sale not found');
  const settings = await getSettings();
  const docType = str(req.query.doc_type) || (Number(sale.balance_due) > 0 ? 'invoice' : 'receipt');
  let layout = req.query.layout_id
    ? await one('SELECT * FROM invoice_layouts WHERE id=$1', [int(req.query.layout_id)])
    : await one('SELECT * FROM invoice_layouts WHERE doc_type=$1 AND is_default ORDER BY id LIMIT 1', [docType]);
  if (!layout) layout = await one('SELECT * FROM invoice_layouts ORDER BY is_default DESC, id LIMIT 1');
  if (!layout) throw bad('No invoice layout is set up yet.');

  let link = '';
  if (layout.show_qr) {
    try { link = await receiptLink(sale.id, { channel: 'link', userId: req.user.id, req }); } catch { /* no link */ }
  }
  const html = await renderInvoice({ sale, layout, settings, link });
  if (str(req.query.format) === 'json') return res.json({ html, layout_id: layout.id });
  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
}));

/* ═══════════════════ attachments & notes on transactions ═══════════════════ */
const ENTITY_PERM = {
  sale: 'sales.read', purchase: 'purchases.read', expense: 'expenses.read',
  purchase_return: 'purchases.read', customer: 'customers.read', product: 'products.read',
};

r.get('/attachments/:entityType/:entityId(\\d+)', h(async (req, res) => {
  // list is metadata only — never ship every file's data URL in a list
  res.json(await many(
    `SELECT id, entity_type, entity_id, kind, title, body, file_name, content_type, file_size,
            created_by, created_at,
            (file_data IS NOT NULL) AS has_file
       FROM transaction_documents WHERE entity_type=$1 AND entity_id=$2 ORDER BY created_at DESC`,
    [req.params.entityType, req.params.entityId]));
}));

r.get('/attachments/:id(\\d+)/file', h(async (req, res) => {
  const row = await one('SELECT * FROM transaction_documents WHERE id=$1', [req.params.id]);
  if (!row || !row.file_data) throw notFound('No file');
  // stored as a data URL; stream it back as the real bytes
  const m = /^data:([^;]+);base64,(.*)$/s.exec(row.file_data);
  if (!m) throw bad('Corrupt file record');
  res.set('Content-Type', m[1] || row.content_type || 'application/octet-stream');
  res.set('Content-Disposition', `inline; filename="${(row.file_name || 'file').replace(/"/g, '')}"`);
  res.send(Buffer.from(m[2], 'base64'));
}));

r.post('/attachments/:entityType/:entityId(\\d+)', upload.single('file'), h(async (req, res) => {
  const entityType = req.params.entityType;
  const perm = ENTITY_PERM[entityType];
  if (!perm) throw bad('Unknown record type.');
  // reuse the read permission's write sibling where sensible; require at least read
  if (!req.user.permissions?.includes(perm) && !req.user.permissions?.includes(perm.replace('.read', '.write'))
      && req.user.role !== 'admin') throw bad('Not allowed to attach to this record.');

  const kind = req.file ? 'document' : 'note';
  let fileData = null; let fileName = null; let contentType = null; let fileSize = 0;
  if (req.file) {
    fileName = req.file.originalname;
    contentType = req.file.mimetype || 'application/octet-stream';
    fileSize = req.file.size;
    fileData = `data:${contentType};base64,${req.file.buffer.toString('base64')}`;
  }
  if (kind === 'note' && !str(req.body.body) && !str(req.body.title)) throw bad('Add a note or a file.');

  const row = await one(
    `INSERT INTO transaction_documents
       (entity_type, entity_id, kind, title, body, file_name, file_data, content_type, file_size, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, entity_type, entity_id, kind, title, body, file_name, content_type, file_size, created_at`,
    [entityType, int(req.params.entityId), kind, str(req.body.title), str(req.body.body),
     fileName, fileData, contentType, fileSize, req.user.id]);
  await audit(req, 'attach', entityType, int(req.params.entityId), { kind, file: fileName });
  res.status(201).json(row);
}));

r.delete('/attachments/:id(\\d+)', h(async (req, res) => {
  await query('DELETE FROM transaction_documents WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

export default r;
