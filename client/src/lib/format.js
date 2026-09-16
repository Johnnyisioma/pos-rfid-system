let symbol = '₦';
export const setCurrencySymbol = (s) => { symbol = s || '₦'; };
export const currencySymbol = () => symbol;

export const money = (n, withSymbol = true) => {
  const v = Number(n || 0);
  const s = v.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return withSymbol ? `${symbol}${s}` : s;
};

export const compactMoney = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1_000_000) return `${symbol}${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${symbol}${(v / 1_000).toFixed(0)}k`;
  return `${symbol}${v.toFixed(0)}`;
};

export const num = (n, dp = 0) =>
  Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const pct = (n) => `${Number(n || 0).toFixed(1)}%`;

export const date = (d) => (d ? new Date(d).toLocaleDateString('en-NG',
  { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

export const dateTime = (d) => (d ? new Date(d).toLocaleString('en-NG',
  { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export const time = (d) => (d ? new Date(d).toLocaleTimeString('en-NG',
  { hour: '2-digit', minute: '2-digit' }) : '—');

export const ago = (d) => {
  if (!d) return '—';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`;
  return date(d);
};

export const today = () => new Date().toISOString().slice(0, 10);
export const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export const variantLabel = (v) =>
  [v?.size, v?.color].filter(Boolean).join(' / ') || 'Default';

/** Split an EPC into 4-char groups so it can be read aloud / checked by eye. */
export const prettyEpc = (epc) => (epc || '').match(/.{1,4}/g)?.join(' ') || '';

export const statusColor = (s) => ({
  in_stock: 'bg-emerald-100 text-emerald-800',
  sold: 'bg-slate-200 text-slate-700',
  in_transit: 'bg-amber-100 text-amber-800',
  reserved: 'bg-violet-100 text-violet-800',
  damaged: 'bg-rose-100 text-rose-800',
  lost: 'bg-rose-100 text-rose-800',
  returned: 'bg-sky-100 text-sky-800',
  completed: 'bg-emerald-100 text-emerald-800',
  held: 'bg-amber-100 text-amber-800',
  draft: 'bg-slate-200 text-slate-700',
  quotation: 'bg-sky-100 text-sky-800',
  layaway: 'bg-violet-100 text-violet-800',
  refunded: 'bg-rose-100 text-rose-800',
  partially_refunded: 'bg-orange-100 text-orange-800',
  cancelled: 'bg-slate-200 text-slate-600',
  ordered: 'bg-sky-100 text-sky-800',
  partial: 'bg-amber-100 text-amber-800',
  received: 'bg-emerald-100 text-emerald-800',
  open: 'bg-sky-100 text-sky-800',
  reconciled: 'bg-emerald-100 text-emerald-800',
  found: 'bg-emerald-100 text-emerald-800',
  unexpected: 'bg-amber-100 text-amber-800',
  unknown: 'bg-rose-100 text-rose-800',
  wrong_location: 'bg-orange-100 text-orange-800',
}[s] || 'bg-slate-100 text-slate-700');

export const labelize = (s) =>
  String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
