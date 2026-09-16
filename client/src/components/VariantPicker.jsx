import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, num, variantLabel } from '../lib/format.js';

/** Type-ahead product/variant selector used by receiving, adjustments, POs and transfers. */
export default function VariantPicker({ onPick, placeholder = 'Search a product to add…', autoFocus }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (!term) { setRows([]); return; }
    let live = true;
    const t = setTimeout(() => {
      api.get(`/api/products/search${qs({ q: term })}`)
        .then((r) => live && (setRows(r), setOpen(true)))
        .catch(() => {});
    }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  return (
    <div className="relative">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input className="input pl-9" placeholder={placeholder} value={q} autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)} onFocus={() => rows.length && setOpen(true)} />
      {open && rows.length > 0 && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-lg bg-white shadow-lg ring-1 ring-slate-200">
            {rows.map((v) => (
              <button key={v.variant_id}
                onClick={() => { onPick(v); setQ(''); setRows([]); setOpen(false); }}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 truncate">{v.name}</p>
                  <p className="text-xs text-slate-500">
                    {variantLabel(v)} · <span className="font-mono">{v.sku}</span>
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm tabular-nums">{money(v.price)}</p>
                  <p className="text-xs text-slate-500 tabular-nums">{num(v.stock)} on hand</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
