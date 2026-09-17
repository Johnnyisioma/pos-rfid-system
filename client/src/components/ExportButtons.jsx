/**
 * One toolbar, three ways out of a list: CSV, Excel, and paper.
 *
 * Two modes, and the difference matters:
 *
 *  - `report="sales"` hands the job to the server, which re-runs the query
 *    with no LIMIT. You get every row, not the 50 currently on screen.
 *  - `rows` + `columns` builds the file in the browser from what is already
 *    loaded. Right for screens the server has no export target for.
 *
 * Printing always happens in the browser, in a throwaway window. The app's
 * own print stylesheet exists to make a receipt come out of a 80mm thermal
 * printer and hides everything that is not #receipt — so a list printed in
 * this document would come out blank. A separate window has no such
 * stylesheet, and gets a clean A4 table instead.
 */
import { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Printer, ChevronDown } from 'lucide-react';
import { api, qs, getLocationId } from '../lib/api.js';
import { useToast } from './ui.jsx';

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const cell = (row, col) => {
  const raw = typeof col.value === 'function' ? col.value(row) : row[col.key];
  return col.format ? col.format(raw, row) : raw;
};

/** Excel-safe CSV: quote everything, and defuse formula injection. */
function toCsv(columns, rows) {
  const quote = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [columns.map((c) => quote(c.label)).join(',')];
  rows.forEach((r) => lines.push(columns.map((c) => quote(cell(r, c))).join(',')));
  return `﻿${lines.join('\r\n')}`;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Excel opens an HTML table saved as .xls without complaining, which keeps a
 * spreadsheet writer out of the client bundle. Server-backed exports get a
 * real .xlsx; this is the fallback for client-side data only.
 */
function toExcelHtml(title, columns, rows) {
  const head = columns.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const body = rows.map((r) =>
    `<tr>${columns.map((c) => `<td>${esc(cell(r, c))}</td>`).join('')}</tr>`).join('');
  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">
    <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
    <x:Name>${esc(title).slice(0, 31)}</x:Name><x:WorksheetOptions><x:DisplayGridlines/>
    </x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
    </head><body><table border="1"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

function printTable({ title, subtitle, columns, rows, business }) {
  const win = window.open('', '_blank', 'width=1024,height=768');
  if (!win) return false;

  const head = columns.map((c) =>
    `<th class="${c.align === 'right' ? 'r' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows.map((r) =>
    `<tr>${columns.map((c) =>
      `<td class="${c.align === 'right' ? 'r' : ''}">${esc(cell(r, c))}</td>`).join('')}</tr>`).join('');

  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font: 11px/1.4 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color:#0f172a; margin:0; }
    header { border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 12px; }
    .biz { font-size: 15px; font-weight: 700; }
    h1 { font-size: 13px; margin: 6px 0 2px; }
    .sub, .meta { color: #64748b; font-size: 10px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 5px 6px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; font-size: 10px; text-transform: uppercase;
         letter-spacing: .03em; color: #475569; border-bottom: 1px solid #cbd5e1; }
    td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
    tbody tr:nth-child(even) td { background: #f8fafc; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    footer { margin-top: 10px; color:#94a3b8; font-size: 9px;
             display:flex; justify-content:space-between; }
  </style></head><body>
  <header>
    <div class="biz">${esc(business?.name || 'Report')}</div>
    <h1>${esc(title)}</h1>
    ${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}
    <div class="meta">${rows.length} row${rows.length === 1 ? '' : 's'} · printed ${
      new Date().toLocaleString('en-NG')}</div>
  </header>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  <footer><span>${esc(business?.name || '')}</span><span>${esc(title)}</span></footer>
  </body></html>`);
  win.document.close();
  win.focus();
  // Give the new document a tick to lay out before the print dialog measures it.
  setTimeout(() => { win.print(); }, 250);
  return true;
}

export default function ExportButtons({
  report,            // server-side export target, e.g. "sales"
  params,            // extra query params for the server export (from/to/…)
  filename,          // base name, defaults to the report or a slug of the title
  title = 'Export',
  subtitle,
  columns = [],
  rows = [],
  business,
  disabled,
  className = '',
  compact = false,   // icon-only trigger, for tight toolbars
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc2 = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc2);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc2);
    };
  }, [open]);

  const base = filename || report ||
    title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
  const stamp = new Date().toISOString().slice(0, 10);
  const nothing = !report && rows.length === 0;

  const run = async (kind) => {
    setOpen(false);
    if (nothing) { toast.info('Nothing to export yet'); return; }
    setBusy(kind);
    try {
      if (kind === 'print') {
        if (!printTable({ title, subtitle, columns, rows, business })) {
          toast.error('Your browser blocked the print window. Allow pop-ups for this site.');
        }
        return;
      }
      if (report) {
        const q = qs({ format: kind, location_id: getLocationId() || undefined, ...(params || {}) });
        await api.download(`/api/reports/export/${report}${q}`,
          `${base}-${stamp}.${kind === 'csv' ? 'csv' : 'xlsx'}`);
        toast.success(`${kind === 'csv' ? 'CSV' : 'Excel'} file downloaded`);
        return;
      }
      if (kind === 'csv') {
        download(new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' }),
          `${base}-${stamp}.csv`);
      } else {
        download(new Blob([toExcelHtml(title, columns, rows)], { type: 'application/vnd.ms-excel' }),
          `${base}-${stamp}.xls`);
      }
      toast.success(`${rows.length} rows exported`);
    } catch (e) {
      toast.error(e.message || 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  const ITEMS = [
    { kind: 'csv', icon: FileText, label: 'CSV', hint: 'Opens anywhere, including Google Sheets' },
    { kind: 'xlsx', icon: FileSpreadsheet, label: 'Excel', hint: 'Formatted workbook' },
    { kind: 'print', icon: Printer, label: 'Print', hint: 'A4 table, ready for paper or PDF' },
  ];

  return (
    <div className={`relative no-print ${className}`} ref={box}>
      <button type="button" className="btn-secondary" disabled={disabled}
        aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>
        <Download size={16} />
        {!compact && <span>Export</span>}
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="menu"
          className="absolute right-0 z-30 mt-1 w-60 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {ITEMS.map((it) => (
            <button key={it.kind} type="button" role="menuitem" disabled={busy === it.kind}
              onClick={() => run(it.kind)}
              className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50">
              <it.icon size={15} className="mt-0.5 shrink-0 text-slate-500" />
              <span className="min-w-0">
                <span className="block text-sm text-slate-800">{it.label}</span>
                <span className="block text-xs text-slate-500">{it.hint}</span>
              </span>
            </button>
          ))}
          {report && (
            <p className="border-t border-slate-100 px-3 pt-1.5 pb-1 text-[11px] text-slate-400">
              Exports every matching row, not just this page.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export { printTable, toCsv };
