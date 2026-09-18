import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { X, Loader2, Inbox, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { statusColor, labelize } from '../lib/format.js';

/* ---------------- toasts ---------------- */
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = 'info', ttl = 4000) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
  }, []);
  const value = {
    toast: push,
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error', 6000),
    info: (m) => push(m, 'info'),
  };
  const icons = { success: CheckCircle2, error: AlertTriangle, info: Info };
  const tones = {
    success: 'bg-emerald-600', error: 'bg-rose-600', info: 'bg-slate-800',
  };
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-[92vw] sm:max-w-sm">
        {toasts.map((t) => {
          const Icon = icons[t.tone] || Info;
          return (
            <div key={t.id}
              className={`${tones[t.tone]} text-white rounded-xl px-4 py-3 shadow-lg flex items-start gap-2.5 text-sm animate-[fadeIn_.15s_ease-out]`}>
              <Icon size={18} className="shrink-0 mt-0.5" />
              <span className="flex-1">{t.message}</span>
              <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
                className="opacity-70 hover:opacity-100"><X size={16} /></button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext) || { toast: () => {}, success: () => {}, error: () => {}, info: () => {} };

/* ---------------- primitives ---------------- */
export const Spinner = ({ className = '' }) => (
  <Loader2 className={`animate-spin ${className}`} size={18} />
);

export function Loading({ label = 'Loading…', className = '' }) {
  return (
    <div className={`flex items-center justify-center gap-2 py-12 text-slate-500 text-sm ${className}`}>
      <Spinner /> {label}
    </div>
  );
}

export function Empty({ title = 'Nothing here yet', hint, icon: Icon = Inbox, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
      <div className="rounded-full bg-slate-100 p-3 mb-3"><Icon size={22} className="text-slate-400" /></div>
      <p className="font-medium text-slate-700">{title}</p>
      {hint && <p className="text-sm text-slate-500 mt-1 max-w-md">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Badge({ children, status, className = '' }) {
  return (
    <span className={`badge ${status ? statusColor(status) : 'bg-slate-100 text-slate-700'} ${className}`}>
      {children ?? labelize(status)}
    </span>
  );
}

export function Card({ title, subtitle, actions, children, className = '', bodyClass = 'p-4' }) {
  return (
    <div className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
          <div>
            {title && <h3 className="font-semibold text-slate-800">{title}</h3>}
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </div>
  );
}

export function Stat({ label, value, sub, tone = 'default', icon: Icon }) {
  const tones = {
    default: 'text-slate-900', good: 'text-emerald-600', bad: 'text-rose-600', warn: 'text-amber-600',
  };
  return (
    <div className="card p-4 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide min-w-0">{label}</p>
        {Icon && <Icon size={16} className="text-slate-400 shrink-0" />}
      </div>
      <p className={`mt-2 text-xl sm:text-2xl font-semibold tabular-nums break-words ${tones[tone]}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-slate-500 mt-1 break-words">{sub}</p>}
    </div>
  );
}

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);

  if (!open) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative w-full ${sizes[size]} bg-white rounded-t-2xl sm:rounded-2xl shadow-xl
                       max-h-[92vh] flex flex-col`}>
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn-ghost -mr-2 -mt-1 p-2"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
        {footer && <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 rounded-b-2xl
                                   flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmButton({ onConfirm, children, message = 'Are you sure?', className = 'btn-danger' }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={armed ? 'btn-danger' : className}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
    >
      {armed ? message : children}
    </button>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      {children}
      {hint && !error && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
      {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, className = '' }) {
  return (
    <div className={`flex gap-1 border-b border-slate-200 overflow-x-auto ${className}`}>
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={`px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
            value === t.value
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          {t.label}
          {t.count !== undefined && (
            <span className="ml-1.5 text-xs rounded-full bg-slate-100 px-1.5 py-0.5">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, limit, total, onPage }) {
  const pages = Math.max(1, Math.ceil((total || 0) / (limit || 1)));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-600">
      <span>Page {page} of {pages}{total ? ` · ${total} records` : ''}</span>
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button className="btn-secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

/**
 * Input that behaves like a barcode/RFID wedge.
 *
 * Submitting on Enter alone is not enough. A SEUIC handheld in Focus mode
 * delivers a read through InputMethodManager.setCommitText — the browser gets
 * one `input` event with the whole code and NO Enter, because the terminator is
 * a separate setting that ships off. Waiting for Enter leaves the code sitting
 * in the box while the operator wonders why nothing happened.
 *
 * So a read is finished by either an Enter or a short pause. The pause is long
 * enough that a person typing a code by hand still gets to finish the word, and
 * short enough to feel instant after a trigger pull.
 */
const SCAN_IDLE_MS = 350;

export function ScanInput({
  onScan, placeholder = 'Scan a tag, or type a code', autoFocus = true, className = '',
  idleSubmit = true,
}) {
  const ref = useRef(null);
  const idle = useRef(null);
  const [value, setValue] = useState('');

  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  useEffect(() => () => clearTimeout(idle.current), []);

  const submit = (raw) => {
    clearTimeout(idle.current);
    const v = String(raw ?? '').trim();
    if (!v) return;
    onScan(v);
    setValue('');
    ref.current?.focus();
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(value); }}
      className={`flex gap-2 ${className}`}>
      <input ref={ref} value={value}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          clearTimeout(idle.current);
          // A committed read arrives complete in one event; a person typing
          // keeps going. Either way, a pause means "that's the whole code".
          if (idleSubmit && next.trim()) idle.current = setTimeout(() => submit(next), SCAN_IDLE_MS);
        }}
        className="input font-mono" placeholder={placeholder} autoComplete="off" />
      <button type="submit" className="btn-primary">Scan</button>
    </form>
  );
}
