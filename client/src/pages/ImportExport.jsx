import { useState } from 'react';
import { Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle, FileDown } from 'lucide-react';
import { api } from '../lib/api.js';
import { num } from '../lib/format.js';
import { Card, useToast, Empty, Spinner, Badge } from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';

export default function ImportExport() {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [validation, setValidation] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const pick = (f) => { setFile(f); setValidation(null); setResult(null); };

  const validate = async () => {
    if (!file) return;
    setBusy(true); setResult(null);
    try { setValidation(await api.upload('/api/io/products/validate', file)); }
    catch (e) {
      if (e.body?.errors) setValidation(e.body);
      else toast.error(e.message);
    }
    finally { setBusy(false); }
  };

  const doImport = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await api.upload('/api/io/products/import', file);
      setResult(res);
      setValidation(null);
      toast.success(`Imported ${res.products} new products and ${res.units} tagged units`);
    } catch (e) {
      if (e.body?.errors) { setValidation({ ...e.body, ok: false }); toast.error(e.body.message || e.message); }
      else toast.error(e.message);
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Import & export"
        subtitle="Move your catalogue in and out as CSV or Excel — variants included" />

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Import products" subtitle="Rows sharing a product SKU become one product with several variants">
          <ol className="text-sm text-slate-600 space-y-2 mb-4 list-decimal list-inside">
            <li>Download the template and fill it in.</li>
            <li>Upload it here and press <strong>Check file</strong> — nothing is written yet.</li>
            <li>Fix anything flagged, then press <strong>Import</strong>.</li>
          </ol>

          <div className="flex flex-wrap gap-2 mb-4">
            <button className="btn-secondary"
              onClick={() => api.download('/api/io/products/template?format=xlsx', 'product-import-template.xlsx')}>
              <FileDown size={16} /> Excel template
            </button>
            <button className="btn-secondary"
              onClick={() => api.download('/api/io/products/template?format=csv', 'product-import-template.csv')}>
              <FileDown size={16} /> CSV template
            </button>
          </div>

          <label className="block border-2 border-dashed border-slate-300 rounded-xl p-6 text-center
                            cursor-pointer hover:border-brand-400 hover:bg-brand-50/40 transition">
            <input type="file" className="hidden" accept=".csv,.xlsx,.xls"
              onChange={(e) => pick(e.target.files[0])} />
            <FileSpreadsheet size={26} className="mx-auto text-slate-400 mb-2" />
            <p className="text-sm font-medium text-slate-700">
              {file ? file.name : 'Choose a CSV or Excel file'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {file ? `${(file.size / 1024).toFixed(0)} KB — click to change` : 'or drag it onto this box'}
            </p>
          </label>

          <div className="flex gap-2 mt-4">
            <button className="btn-secondary flex-1" onClick={validate} disabled={!file || busy}>
              {busy ? <Spinner /> : <CheckCircle2 size={16} />} Check file
            </button>
            <button className="btn-primary flex-1" onClick={doImport}
              disabled={!file || busy || (validation && !validation.ok)}>
              <Upload size={16} /> Import
            </button>
          </div>

          {validation && (
            <div className="mt-4">
              {validation.ok ? (
                <div className="rounded-lg bg-emerald-50 ring-1 ring-emerald-200 p-3">
                  <p className="text-sm font-medium text-emerald-900 flex items-center gap-2">
                    <CheckCircle2 size={16} /> File looks good
                  </p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs text-emerald-900">
                    <Row label="Rows" value={num(validation.summary.rows)} />
                    <Row label="Products" value={num(validation.summary.products)} />
                    <Row label="Variants" value={num(validation.summary.variants)} />
                    <Row label="New products" value={num(validation.summary.new_products)} />
                    <Row label="Existing updated" value={num(validation.summary.updated_products)} />
                    <Row label="RFID units to create" value={num(validation.summary.units_to_create)} />
                  </dl>
                  {validation.preview?.length > 0 && (
                    <div className="mt-3 text-xs">
                      <p className="font-medium text-emerald-900 mb-1">First few products</p>
                      <ul className="space-y-0.5 text-emerald-800">
                        {validation.preview.map((p, i) => (
                          <li key={i}>
                            {p.name} — {p.variants} variant(s), {p.opening_units} opening unit(s)
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg bg-rose-50 ring-1 ring-rose-200 p-3">
                  <p className="text-sm font-medium text-rose-900 flex items-center gap-2">
                    <AlertTriangle size={16} /> {validation.error_count} problem(s) — nothing was imported
                  </p>
                  <div className="mt-2 max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-rose-900/70 text-left">
                          <th className="py-1 pr-2">Row</th><th className="py-1 pr-2">Column</th><th className="py-1">Problem</th>
                        </tr>
                      </thead>
                      <tbody className="text-rose-900">
                        {validation.errors.map((e, i) => (
                          <tr key={i} className="border-t border-rose-100">
                            <td className="py-1 pr-2 tabular-nums">{e.row}</td>
                            <td className="py-1 pr-2 font-mono">{e.field}</td>
                            <td className="py-1">{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {result && (
            <div className="mt-4 rounded-lg bg-brand-50 ring-1 ring-brand-200 p-3 text-sm text-brand-900">
              <p className="font-medium flex items-center gap-2"><CheckCircle2 size={16} /> Import complete</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs">
                <Row label="New products" value={num(result.products)} />
                <Row label="Products updated" value={num(result.updated)} />
                <Row label="New variants" value={num(result.variants)} />
                <Row label="RFID units created" value={num(result.units)} />
              </dl>
              <p className="text-xs mt-2">
                Every opening-stock unit received its own unique EPC and is waiting in the tag queue.
              </p>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Export the catalogue"
            subtitle="Every product and variant, with stock and value per location">
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary"
                onClick={() => api.download('/api/io/products/export?format=xlsx')}>
                <Download size={16} /> Excel (.xlsx)
              </button>
              <button className="btn-secondary"
                onClick={() => api.download('/api/io/products/export?format=csv')}>
                <Download size={16} /> CSV
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              The export uses the same column names as the import template, so you can export,
              edit in Excel, and re-import to make bulk changes.
            </p>
          </Card>

          <Card title="Other exports">
            <div className="grid sm:grid-cols-2 gap-2">
              {[
                ['inventory', 'Stock levels'],
                ['low-stock', 'Low stock & reorder'],
                ['units', 'RFID unit register'],
                ['sales', 'Sales'],
                ['customers', 'Customers'],
                ['expenses', 'Expenses'],
              ].map(([key, label]) => (
                <button key={key} className="btn-secondary justify-start"
                  onClick={() => api.download(`/api/reports/export/${key}?format=xlsx`)}>
                  <Download size={15} /> {label}
                </button>
              ))}
            </div>
          </Card>

          <Card title="Column reference" bodyClass="p-0">
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Column</th><th>Notes</th></tr></thead>
                <tbody className="text-xs">
                  {[
                    ['product_name', 'Required.'],
                    ['product_sku', 'Blank = auto-generate. Reusing an existing SKU updates that product.'],
                    ['type', 'single / variable / bundle. Defaults to variable when size or colour is filled.'],
                    ['brand, category, sub_category', 'Created automatically if new.'],
                    ['size, color', 'Leave both blank for a single product.'],
                    ['variant_sku', 'Blank = PRODUCTSKU-SIZE-COLOUR.'],
                    ['cost_price, selling_price', 'Numbers only — no ₦ and no thousands separators.'],
                    ['opening_stock', 'Whole number. Each unit gets its own RFID EPC.'],
                    ['location_code', 'Which shop the opening stock lands in.'],
                    ['tax_rate, reorder_point, track_rfid', 'Optional — sensible defaults are applied.'],
                  ].map(([c, n]) => (
                    <tr key={c}><td className="font-mono">{c}</td><td className="text-slate-600">{n}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

const Row = ({ label, value }) => (
  <div className="flex justify-between gap-2">
    <dt>{label}</dt><dd className="font-medium tabular-nums">{value}</dd>
  </div>
);
