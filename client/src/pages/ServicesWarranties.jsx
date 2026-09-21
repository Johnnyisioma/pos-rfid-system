import { useCallback, useEffect, useState } from 'react';
import {
  Wrench, ShieldCheck, ScanLine, Plus, Radio, Square, CheckCircle2, XCircle,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { money, date } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, useToast, Field, Spinner, Tabs, ScanInput,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTabParam } from '../lib/useTabParam.js';
import { useRfidScan } from '../lib/useRfidScan.jsx';

/**
 * Services, warranty policies and warranty lookup — Phase 2 setup data plus the
 * warranty × RFID payoff: scan a returned item and the exact serial tells you
 * whether it is still covered, no receipt required.
 */
export default function ServicesWarranties() {
  const { can, feature } = useAuth();
  const [tab, setTab] = useTabParam('services');
  const tabs = [
    { value: 'services', label: 'Service types' },
    { value: 'warranties', label: 'Warranty policies' },
    { value: 'check', label: 'Warranty check' },
  ];
  return (
    <>
      <PageHeader title="Services & warranties"
        subtitle="Chargeable services, warranty policies and coverage lookup by tag" />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'services' && <Services can={can} />}
      {tab === 'warranties' && <Warranties can={can} />}
      {tab === 'check' && <WarrantyCheck />}
    </>
  );
}

/* ───────────────────────── service types ───────────────────────── */
function Services({ can }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api.get('/api/svc/services?all=1').then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    try {
      if (form.id) await api.put(`/api/svc/services/${form.id}`, form);
      else await api.post('/api/svc/services', form);
      toast.success('Service saved'); setEditing(null); load();
    } catch (e) { toast.error(e.message); }
  };
  if (!rows) return <Loading />;
  return (
    <Card bodyClass="p-0" title="Service types"
      subtitle="A charge that isn't a product — delivery, engraving, repair, alteration"
      actions={can('products.write') && (
        <button className="btn-primary text-xs" onClick={() => setEditing({ charge_type: 'fixed', taxable: true })}>
          <Plus size={14} /> New service</button>)}>
      {rows.length === 0
        ? <Empty icon={Wrench} title="No services yet"
            hint="Add delivery, engraving or alteration charges to bill alongside a sale." />
        : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Service</th><th>Charge</th><th>Tax</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">{s.name}</td>
                    <td>{s.charge_type === 'percent' ? `${Number(s.charge_value)}%` : money(s.charge_value)}</td>
                    <td>{s.taxable ? 'Taxable' : 'Exempt'}</td>
                    <td><Badge status={s.is_active ? 'success' : 'muted'}>{s.is_active ? 'active' : 'off'}</Badge></td>
                    <td className="text-right">{can('products.write') && (
                      <button className="btn-ghost text-xs" onClick={() => setEditing(s)}>Edit</button>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>)}
      {editing && <ServiceModal row={editing} onClose={() => setEditing(null)} onSave={save} />}
    </Card>
  );
}

function ServiceModal({ row, onClose, onSave }) {
  const [f, setF] = useState({ taxable: true, is_active: true, charge_type: 'fixed', charge_value: 0, ...row });
  return (
    <Modal open onClose={onClose} size="sm" title={row.id ? 'Edit service' : 'New service'}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave(f)}>Save</button></>}>
      <div className="space-y-3">
        <Field label="Name"><input className="input" value={f.name || ''}
          onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Delivery" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Charge type">
            <select className="input" value={f.charge_type}
              onChange={(e) => setF({ ...f, charge_type: e.target.value })}>
              <option value="fixed">Fixed amount</option>
              <option value="percent">% of sale</option>
            </select>
          </Field>
          <Field label={f.charge_type === 'percent' ? 'Percent' : 'Amount'}>
            <input type="number" className="input" value={f.charge_value}
              onChange={(e) => setF({ ...f, charge_value: e.target.value })} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!f.taxable}
            onChange={(e) => setF({ ...f, taxable: e.target.checked })} /> Taxable</label>
        {row.id && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!f.is_active}
              onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Active</label>)}
      </div>
    </Modal>
  );
}

/* ───────────────────────── warranty policies ───────────────────────── */
function Warranties({ can }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api.get('/api/svc/warranties?all=1').then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    try {
      if (form.id) await api.put(`/api/svc/warranties/${form.id}`, form);
      else await api.post('/api/svc/warranties', form);
      toast.success('Warranty saved'); setEditing(null); load();
    } catch (e) { toast.error(e.message); }
  };
  if (!rows) return <Loading />;
  return (
    <Card bodyClass="p-0" title="Warranty policies"
      subtitle="Attach a policy to a product; it registers to each unit's serial when sold"
      actions={can('products.write') && (
        <button className="btn-primary text-xs" onClick={() => setEditing({ duration: 6, duration_unit: 'months' })}>
          <Plus size={14} /> New policy</button>)}>
      {rows.length === 0
        ? <Empty icon={ShieldCheck} title="No warranty policies"
            hint="Define a coverage period, then set it on a product in the editor." />
        : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Policy</th><th>Duration</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id}>
                    <td><div className="font-medium">{w.name}</div>
                      {w.description && <div className="text-xs text-slate-500">{w.description}</div>}</td>
                    <td>{w.duration} {w.duration_unit}</td>
                    <td><Badge status={w.is_active ? 'success' : 'muted'}>{w.is_active ? 'active' : 'off'}</Badge></td>
                    <td className="text-right">{can('products.write') && (
                      <button className="btn-ghost text-xs" onClick={() => setEditing(w)}>Edit</button>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>)}
      {editing && <WarrantyModal row={editing} onClose={() => setEditing(null)} onSave={save} />}
    </Card>
  );
}

function WarrantyModal({ row, onClose, onSave }) {
  const [f, setF] = useState({ is_active: true, duration: 6, duration_unit: 'months', ...row });
  return (
    <Modal open onClose={onClose} size="sm" title={row.id ? 'Edit policy' : 'New warranty policy'}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave(f)}>Save</button></>}>
      <div className="space-y-3">
        <Field label="Name"><input className="input" value={f.name || ''}
          onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="6-month manufacturer" autoFocus /></Field>
        <Field label="Description"><input className="input" value={f.description || ''}
          onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Covers manufacturing defects" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration"><input type="number" min="0" className="input" value={f.duration}
            onChange={(e) => setF({ ...f, duration: e.target.value })} /></Field>
          <Field label="Unit">
            <select className="input" value={f.duration_unit}
              onChange={(e) => setF({ ...f, duration_unit: e.target.value })}>
              {['days', 'months', 'years'].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
        </div>
        {row.id && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!f.is_active}
              onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Active</label>)}
      </div>
    </Modal>
  );
}

/* ───────────────────────── warranty check by tag ───────────────────────── */
function WarrantyCheck() {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async (epc) => {
    const code = String(epc || '').trim();
    if (!code) return;
    setBusy(true);
    try {
      const r = await api.get(`/api/svc/warranty-check/${encodeURIComponent(code)}`);
      setResult(r);
    } catch (e) {
      setResult({ registered: false, epc: code, error: e.message });
    } finally { setBusy(false); }
  }, []);

  const scan = useRfidScan(check, { dedupeMs: 2000, tagsOnly: true });

  return (
    <Card title="Warranty check"
      subtitle="Scan a returned item's tag to see whether it is still covered — no receipt needed">
      <scan.CaptureField />
      <div className="flex items-center gap-2 mb-4">
        <ScanInput onScan={check} placeholder="Scan or type an EPC…" className="flex-1" />
        {scan.native && (
          <button className={scan.scanning ? 'btn-danger' : 'btn-secondary'} onClick={scan.toggle}>
            {scan.scanning ? <Square size={14} /> : <Radio size={14} />}
            {scan.scanning ? 'Stop' : 'Reader'}</button>)}
      </div>

      {busy && <Loading label="Checking…" />}

      {!busy && result && (
        result.registered ? (
          <div className={`rounded-xl p-4 ring-1 ${result.active
            ? 'bg-emerald-50 ring-emerald-200' : 'bg-rose-50 ring-rose-200'}`}>
            <div className="flex items-center gap-2 mb-3">
              {result.active
                ? <CheckCircle2 className="text-emerald-600" size={22} />
                : <XCircle className="text-rose-600" size={22} />}
              <span className={`text-lg font-semibold ${result.active ? 'text-emerald-800' : 'text-rose-800'}`}>
                {result.active ? 'Under warranty' : 'Warranty expired'}</span>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              <dt className="text-slate-500">Item</dt><dd>{result.product_name || '—'}</dd>
              <dt className="text-slate-500">Policy</dt><dd>{result.warranty_name || '—'}</dd>
              <dt className="text-slate-500">Sold on</dt><dd>{result.registered_at ? date(result.registered_at) : '—'}</dd>
              <dt className="text-slate-500">Covered until</dt>
              <dd className={result.active ? '' : 'text-rose-700 font-medium'}>
                {result.expires_at ? date(result.expires_at) : 'no expiry'}</dd>
              {result.invoice_no && (<><dt className="text-slate-500">Invoice</dt><dd>{result.invoice_no}</dd></>)}
              <dt className="text-slate-500">Tag</dt><dd className="font-mono text-xs">{result.epc}</dd>
            </dl>
          </div>
        ) : (
          <div className="rounded-xl p-4 bg-slate-50 ring-1 ring-slate-200 text-center">
            <ScanLine className="mx-auto text-slate-400 mb-2" size={24} />
            <div className="font-medium text-slate-700">No warranty on record</div>
            <div className="text-sm text-slate-500 mt-1">
              This tag <span className="font-mono">{result.epc}</span> has no registered warranty.</div>
            {result.error && <div className="text-xs text-rose-600 mt-1">{result.error}</div>}
          </div>
        )
      )}

      {!busy && !result && (
        <Empty icon={ScanLine} title="Scan a tag to begin"
          hint="Coverage is keyed to the serial, so it works even without the receipt." />)}
    </Card>
  );
}
