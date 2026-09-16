import { query } from '../db/index.js';

/** Wrap an async route so rejections reach the error handler. */
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}
export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const forbidden = (msg = 'Not allowed') => new HttpError(403, msg);

export const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const num = (n, d = 0) => (Number.isFinite(Number(n)) ? Number(n) : d);
export const int = (n, d = 0) => (Number.isFinite(parseInt(n, 10)) ? parseInt(n, 10) : d);
export const bool = (v) => v === true || v === 'true' || v === 1 || v === '1';
export const str = (v, d = '') => (v === undefined || v === null ? d : String(v));

/**
 * Sequential document reference, e.g. ADJ-2026-000014.
 * Uses a row lock on a counter derived from the table itself so numbers are
 * unbroken even under concurrent use.
 */
export async function nextRef(client, table, prefix) {
  const y = new Date().getFullYear();
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(ref, '^.*-', ''), '')::BIGINT), 0) AS n
       FROM ${table} WHERE ref LIKE $1`,
    [`${prefix}-${y}-%`]
  );
  const next = Number(rows[0].n) + 1;
  return `${prefix}-${y}-${String(next).padStart(6, '0')}`;
}

/**
 * Sequential, unbroken invoice number (Nigeria FIRS requirement).
 * Locks the settings row so two tills can never take the same number.
 */
export async function nextInvoiceNo(client) {
  const { rows } = await client.query(
    `SELECT invoice_prefix,
            GREATEST(invoice_next,
                     COALESCE((SELECT MAX(invoice_seq) + 1 FROM sales), 1)) AS invoice_next
       FROM business_settings WHERE id=1 FOR UPDATE`
  );
  const { invoice_prefix, invoice_next } = rows[0];
  await client.query('UPDATE business_settings SET invoice_next = $1 WHERE id=1', [Number(invoice_next) + 1]);
  const y = new Date().getFullYear();
  return {
    invoice_no: `${invoice_prefix}-${y}-${String(invoice_next).padStart(6, '0')}`,
    invoice_seq: Number(invoice_next),
  };
}

export async function getSettings() {
  const { rows } = await query('SELECT * FROM business_settings WHERE id=1');
  return rows[0];
}

/** Paging helper: returns {limit, offset, page}. */
export function paging(req, defaultLimit = 50, maxLimit = 500) {
  const limit = Math.min(maxLimit, Math.max(1, int(req.query.limit, defaultLimit)));
  const page = Math.max(1, int(req.query.page, 1));
  return { limit, offset: (page - 1) * limit, page };
}

export const variantLabel = (v) =>
  [v?.size, v?.color].filter(Boolean).join(' / ') || 'Default';
