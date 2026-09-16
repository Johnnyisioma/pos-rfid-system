/**
 * EPC service — the single place where an EPC is created, parsed or resolved.
 *
 * Requirement: every PHYSICAL unit of stock gets its own unique EPC, so two
 * identical shoes (same product, same size, same colour) are two distinct tags
 * and both are counted on a scan.
 *
 * Encoding: 96-bit EPC rendered as 24 uppercase hex characters (SGTIN-96 shaped
 * so real Zebra/UHF hardware accepts it without change):
 *
 *   ┌──────────┬───────────────┬───────────────┐
 *   │ 4 hex    │ 10 hex        │ 10 hex        │
 *   │ company  │ variant id    │ unit serial   │
 *   │ prefix   │ (SKU code)    │ (per variant) │
 *   └──────────┴───────────────┴───────────────┘
 *
 * Swapping in a different corporate numbering scheme later means changing only
 * this file — nothing else in the system builds or reads an EPC by hand.
 */

export const EPC_HEX_LENGTH = 24;
const PREFIX_LEN = 4;
const VARIANT_LEN = 10;
const SERIAL_LEN = 10;

export const MAX_VARIANT_ID = 16 ** VARIANT_LEN - 1;
export const MAX_SERIAL = 16 ** SERIAL_LEN - 1;

function hex(n, len) {
  return Number(n).toString(16).toUpperCase().padStart(len, '0');
}

export function sanitizeCompanyPrefix(prefix) {
  const clean = String(prefix || '3035').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return (clean || '3035').slice(0, PREFIX_LEN).padStart(PREFIX_LEN, '0');
}

/** Build the 24-hex EPC for one physical unit. */
export function buildEpc({ companyPrefix = '3035', variantId, serial }) {
  if (!Number.isFinite(Number(variantId)) || Number(variantId) < 0)
    throw new Error('buildEpc: variantId required');
  if (!Number.isFinite(Number(serial)) || Number(serial) < 0)
    throw new Error('buildEpc: serial required');
  if (Number(variantId) > MAX_VARIANT_ID) throw new Error('buildEpc: variantId out of range');
  if (Number(serial) > MAX_SERIAL) throw new Error('buildEpc: serial out of range');
  return (
    sanitizeCompanyPrefix(companyPrefix) +
    hex(variantId, VARIANT_LEN) +
    hex(serial, SERIAL_LEN)
  );
}

/** Human-facing label printed next to the tag, e.g. NK-AM90-42-BLK-000007 */
export function buildReadable(sku, serial) {
  return `${sku}-${String(serial).padStart(6, '0')}`;
}

/**
 * Normalise anything a scanner, a person or a CSV might hand us.
 * Handheld UHF readers commonly emit "30 35 00 00 …" or "epc:3035…".
 */
export function normalizeEpc(input) {
  if (input === null || input === undefined) return '';
  let s = String(input).trim();
  s = s.replace(/^epc[:=]/i, '');
  s = s.replace(/[\s:\-_.]/g, '');
  return s.toUpperCase();
}

export function isEpcHex(value) {
  const s = normalizeEpc(value);
  return s.length === EPC_HEX_LENGTH && /^[0-9A-F]+$/.test(s);
}

/** Decode an EPC back into its parts. Returns null if it isn't our format. */
export function parseEpc(value) {
  const s = normalizeEpc(value);
  if (!isEpcHex(s)) return null;
  return {
    epc: s,
    companyPrefix: s.slice(0, PREFIX_LEN),
    variantId: parseInt(s.slice(PREFIX_LEN, PREFIX_LEN + VARIANT_LEN), 16),
    serial: parseInt(s.slice(PREFIX_LEN + VARIANT_LEN), 16),
  };
}

/** EPC as the 4 x 24-bit words some reader SDKs expect. */
export function toWords(value) {
  const s = normalizeEpc(value);
  return s.match(/.{1,4}/g) || [];
}

/** Base64 form used by a few Android reader SDKs. */
export function toBase64(value) {
  const s = normalizeEpc(value);
  return Buffer.from(s, 'hex').toString('base64');
}

export function fromBase64(b64) {
  try {
    return Buffer.from(String(b64), 'base64').toString('hex').toUpperCase();
  } catch {
    return '';
  }
}
