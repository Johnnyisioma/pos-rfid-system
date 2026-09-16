import { useEffect, useState, useCallback } from 'react';
import { Printer, Radio, Plus, Trash2, Zap, Cpu, ScanLine, Receipt } from 'lucide-react';
import { api } from '../lib/api.js';
import { dateTime, labelize, ago } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, useToast, Field, Tabs, Spinner, ConfirmButton,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';

const KIND_ICON = {
  rfid_printer: Printer, rfid_reader: Radio, barcode_printer: Printer, receipt_printer: Receipt,
};

const DRIVERS = [
  { value: 'mock', label: 'Mock (no hardware attached)',
    note: 'Generates and stores the exact ZPL, but sends nothing. Use this until the printer is on site.' },
  { value: 'zebra_zpl_tcp', label: 'Zebra ZPL over TCP (port 9100)',
    note: 'Direct socket to a network Zebra printer — ZD500R, ZT411, ZD621R and similar.' },
  { value: 'http_agent', label: 'HTTP print agent',
    note: 'For a printer only reachable on the shop LAN: a small local agent forwards the ZPL.' },
];

export default function Devices() {
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('devices');
  const [rows, setRows] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [editing, setEditing] = useState(null);
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setRows(await api.get('/api/devices').catch(() => []));
    setJobs(await api.get('/api/devices/print-jobs').catch(() => []));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    try {
      if (form.id) await api.put(`/api/devices/${form.id}`, form);
      else await api.post('/api/devices', form);
      toast.success('Device saved');
      setEditing(null);
      load();
    } catch (e) { toast.error(e.message); }
  };

  const runTest = async (d) => {
    setBusy(true);
    try {
      const res = await api.post(`/api/devices/${d.id}/test`, {});
      setTest({ device: d, ...res });
      load();
    } catch (e) {
      setTest({ device: d, ok: false, error: e.body?.error || e.message, zpl: e.body?.zpl });
    } finally { setBusy(false); }
  };

  if (!rows) return <Loading />;

  return (
    <>
      <PageHeader title="Hardware"
        subtitle="RFID printers and readers — mock today, real devices whenever you are ready"
        actions={can('devices.write') && (
          <button className="btn-primary" onClick={() => setEditing({ kind: 'rfid_printer', driver: 'mock', port: 9100 })}>
            <Plus size={16} /> Add device
          </button>
        )} />

      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'devices', label: 'Devices', count: rows.length },
        { value: 'jobs', label: 'Print jobs', count: jobs.length },
        { value: 'guide', label: 'Connecting real hardware' },
      ]} />

      {tab === 'devices' && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.length === 0 ? <Empty title="No devices registered" icon={Printer} /> :
            rows.map((d) => {
              const Icon = KIND_ICON[d.kind] || Cpu;
              return (
                <Card key={d.id}>
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-lg bg-slate-100 grid place-items-center shrink-0">
                      <Icon size={19} className="text-slate-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-800 truncate">{d.name}</p>
                      <p className="text-xs text-slate-500">{labelize(d.kind)}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <Badge status={d.driver === 'mock' ? 'unexpected' : 'found'}>
                          {d.driver === 'mock' ? 'Mock mode' : labelize(d.driver)}
                        </Badge>
                        {d.location_name && <Badge>{d.location_name}</Badge>}
                        {!d.is_active && <Badge status="cancelled">Disabled</Badge>}
                      </div>
                      {d.host && (
                        <p className="text-xs font-mono text-slate-500 mt-1.5">{d.host}:{d.port}</p>
                      )}
                      <p className="text-[11px] text-slate-400 mt-1">
                        {d.last_used_at ? `Last used ${ago(d.last_used_at)}` : 'Never used'}
                      </p>
                    </div>
                  </div>
                  {can('devices.write') && (
                    <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                      <button className="btn-secondary text-xs flex-1" onClick={() => runTest(d)} disabled={busy}>
                        {busy ? <Spinner /> : <Zap size={14} />} Test
                      </button>
                      <button className="btn-secondary text-xs" onClick={() => setEditing(d)}>Edit</button>
                      <ConfirmButton className="btn-ghost p-2 text-rose-600" message="Remove?"
                        onConfirm={async () => { await api.del(`/api/devices/${d.id}`); load(); }}>
                        <Trash2 size={14} />
                      </ConfirmButton>
                    </div>
                  )}
                </Card>
              );
            })}
        </div>
      )}

      {tab === 'jobs' && (
        <Card bodyClass="p-0">
          {jobs.length === 0 ? <Empty title="No print jobs yet" icon={Printer} /> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>EPC</th><th>Label</th><th>Product</th><th>Device</th>
                  <th>Status</th><th>By</th><th>When</th></tr></thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id}>
                      <td className="font-mono text-xs">{j.epc}</td>
                      <td className="font-mono text-xs text-slate-500">{j.epc_readable || '—'}</td>
                      <td>{j.product_name || '—'}</td>
                      <td className="text-slate-600">{j.device_name || 'Mock printer'}</td>
                      <td>
                        <Badge status={j.status === 'failed' ? 'unknown' : j.status === 'sent' ? 'found' : 'unexpected'}>
                          {labelize(j.status)}
                        </Badge>
                        {j.error && <div className="text-xs text-rose-600 mt-0.5">{j.error}</div>}
                      </td>
                      <td className="text-slate-600 text-sm">{j.user_name || '—'}</td>
                      <td className="text-xs text-slate-500 whitespace-nowrap">{dateTime(j.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'guide' && <Guide />}

      {editing && <DeviceModal device={editing} onClose={() => setEditing(null)} onSave={save} />}

      {test && (
        <Modal open onClose={() => setTest(null)} title={`Test — ${test.device.name}`} size="lg"
          footer={<button className="btn-primary" onClick={() => setTest(null)}>Close</button>}>
          <div className={`rounded-lg p-3 mb-3 text-sm ${test.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900'}`}>
            {test.ok ? (
              <>
                <p className="font-medium">{labelize(test.status)} via {test.transport}</p>
                <p className="text-xs mt-1">{test.detail}</p>
              </>
            ) : <p className="font-medium">{test.error}</p>}
          </div>
          {test.zpl && (
            <>
              <p className="label">ZPL payload</p>
              <pre className="text-[11px] bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto">{test.zpl}</pre>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

function DeviceModal({ device, onClose, onSave }) {
  const { locations, locationId } = useAuth();
  const [form, setForm] = useState({
    name: '', kind: 'rfid_printer', driver: 'mock', host: '', port: 9100,
    location_id: locationId, config: {}, ...device,
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const driver = DRIVERS.find((d) => d.value === form.driver);

  return (
    <Modal open onClose={onClose} title={device.id ? 'Edit device' : 'Add a device'} size="sm"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave(form)}>Save</button></>}>
      <div className="space-y-3">
        <Field label="Name"><input className="input" value={form.name} onChange={set('name')} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            <select className="input" value={form.kind} onChange={set('kind')} disabled={!!device.id}>
              <option value="rfid_printer">RFID print + encode</option>
              <option value="rfid_reader">RFID reader</option>
              <option value="barcode_printer">Barcode printer</option>
              <option value="receipt_printer">Receipt printer</option>
            </select>
          </Field>
          <Field label="Location">
            <select className="input" value={form.location_id || ''} onChange={set('location_id')}>
              <option value="">Any</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Driver" hint={driver?.note}>
          <select className="input" value={form.driver} onChange={set('driver')}>
            {DRIVERS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </Field>
        {form.driver === 'zebra_zpl_tcp' && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Printer IP" className="col-span-2">
              <input className="input font-mono" value={form.host || ''} onChange={set('host')}
                placeholder="192.168.1.50" />
            </Field>
            <Field label="Port"><input type="number" className="input" value={form.port} onChange={set('port')} /></Field>
          </div>
        )}
        {form.driver === 'http_agent' && (
          <Field label="Agent URL">
            <input className="input font-mono" value={form.config?.url || ''}
              onChange={(e) => setForm({ ...form, config: { ...form.config, url: e.target.value } })}
              placeholder="http://192.168.1.10:8080/print" />
          </Field>
        )}
        {device.id && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="rounded border-slate-300" checked={form.is_active !== false}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Active
          </label>
        )}
      </div>
    </Modal>
  );
}

function Guide() {
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="Zebra RFID printer (ZD500R class)">
        <ol className="text-sm text-slate-600 space-y-3 list-decimal list-inside">
          <li>Put the printer on the shop network and note its IP address (print a config label to see it).</li>
          <li>Load RFID label stock and run the printer's tag calibration once.</li>
          <li>Here, add a device with kind <strong>RFID print + encode</strong>, driver{' '}
            <strong>Zebra ZPL over TCP</strong>, host = the printer's IP, port <strong>9100</strong>.</li>
          <li>Press <strong>Test</strong> — a test label prints and the tag is encoded.</li>
          <li>Nothing else changes: encoding a unit from the RFID screen now writes a real tag.</li>
        </ol>
        <div className="mt-4">
          <p className="label">The ZPL the system sends</p>
          <pre className="text-[11px] bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto">{`^XA
^RS8,,,3                 ; Gen2, 3 write retries
^RFW,H,1,2,1^FD{EPC}^FS  ; encode the unique EPC
^RFR,H,1,2,1^FN0^FS      ; read back to verify
^FO20,20^A0N,34,34^FD{product}^FS
^FO20,190^BY2^BCN,90,Y,N,N^FD{label}^FS
^XZ`}</pre>
        </div>
      </Card>

      <Card title="Handheld UHF reader (Android)">
        <ol className="text-sm text-slate-600 space-y-3 list-decimal list-inside">
          <li>Install this app on the handheld from its browser — "Add to home screen" makes it a full PWA.</li>
          <li>
            If the reader works as a <strong>keyboard wedge</strong> (most do), nothing else is needed:
            Stock Take Mode and the scan boxes accept its input directly.
          </li>
          <li>
            For SDK-driven readers, have the companion app POST batches to{' '}
            <code className="text-xs bg-slate-100 px-1 rounded">/api/rfid/scan-events</code>:
            <pre className="text-[11px] bg-slate-900 text-slate-100 rounded-lg p-3 mt-2 overflow-x-auto">{`POST /api/rfid/scan-events
Authorization: Bearer <staff token>
X-Location-Id: 1

{ "epcs": ["3035…01", "3035…02"],
  "context": "stock_take",
  "stock_take_id": 7 }`}</pre>
          </li>
          <li>
            Payload shapes from the common SDKs are handled — <code className="text-xs">epcs</code>,{' '}
            <code className="text-xs">tags</code>, a single <code className="text-xs">epc</code>, or a
            whitespace-separated <code className="text-xs">data</code> string.
          </li>
        </ol>
      </Card>

      <Card title="Why switching modes is safe" className="lg:col-span-2">
        <p className="text-sm text-slate-600">
          Every EPC in the system is created, parsed and resolved in a single service, and every
          hardware call goes through one adapter. Mock mode and live mode take exactly the same code
          path — the only difference is whether the ZPL is written to a socket or stored for you to
          inspect. That means the tags you generate today stay valid when the printer arrives: the same
          EPCs simply get written onto physical inlays.
        </p>
      </Card>
    </div>
  );
}
