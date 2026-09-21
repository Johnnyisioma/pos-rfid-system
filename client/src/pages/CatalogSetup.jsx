import { useCallback, useEffect, useState } from 'react';
import {
  Ruler, Layers, MapPin, CalendarClock, Tags, Plus, Radio, Square, Save, Boxes,
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, num, date } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, useToast, Field, Spinner, Tabs, Stat,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTabParam } from '../lib/useTabParam.js';
import { useRfidScan } from '../lib/useRfidScan.jsx';

/**
 * Catalogue setup — the reference data the ERP catalogue features hang off:
 * units, price tiers, bin locations, lots and label templates.
 *
 * These are owner-curated lists, not day-to-day screens, so they live together
 * behind one menu rather than scattered through the app.
 */
export default function CatalogSetup() {
  const { can, feature } = useAuth();
  const [tab, setTab] = useTabParam('units');
  const tabs = [
    { value: 'units', label: 'Units' },
    { value: 'tiers', label: 'Price tiers' },
    { value: 'bins', label: 'Bin locations' },
    { value: 'labels', label: 'Label templates' },
  ];
  if (feature('warranties') || true) tabs.push({ value: 'lots', label: 'Lots & expiry' });

  return (
    <>
      <PageHeader title="Catalogue setup"
        subtitle="Units, price tiers, shelf locations, lots and label templates" />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'units' && <Units can={can} />}
      {tab === 'tiers' && <Tiers can={can} />}
      {tab === 'bins' && <Bins can={can} />}
      {tab === 'labels' && <Labels can={can} />}
      {tab === 'lots' && <Lots can={can} />}
    </>
  );
}

/* ───────────────────────── units ───────────────────────── */
function Units({ can }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api.get('/api/catalog-ext/units?all=1').then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    try {
      if (form.id) await api.put(`/api/catalog-ext/units/${form.id}`, form);
      else await api.post('/api/catalog-ext/units', form);
      toast.success('Unit saved'); setEditing(null); load();
    } catch (e) { toast.error(e.message); }
  };
  if (!rows) return <Loading />;
  return (
    <Card bodyClass="p-0" title="Units of measure"
      subtitle="A sub-unit converts to a base — a Box of 12 Pairs is one Box tag over twelve pair tags"
      actions={can('products.write') && (
        <button className="btn-primary text-xs" onClick={() => setEditing({ allow_decimal: false })}>
          <Plus size={14} /> New unit
        </button>)}>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Name</th><th>Short</th><th>Decimals</th><th>Converts to</th><th /></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className={u.is_active ? '' : 'opacity-50'}>
                <td className="font-medium">{u.name}</td>
                <td className="font-mono text-xs">{u.short_name}</td>
                <td>{u.allow_decimal ? 'Yes' : 'No'}</td>
                <td className="text-sm text-slate-600">
                  {u.base_unit_name ? `${num(u.base_multiple)} × ${u.base_unit_name}` : 'Base unit'}
                </td>
                <td className="text-right">{can('products.write') && (
                  <button className="btn-ghost text-xs" onClick={() => setEditing(u)}>Edit</button>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <UnitModal unit={editing} units={rows} onClose={() => setEditing(null)} onSave={save} />}
    </Card>
  );
}

function UnitModal({ unit, units, onClose, onSave }) {
  const [f, setF] = useState({
    id: unit.id, name: unit.name || '', short_name: unit.short_name || '',
    allow_decimal: !!unit.allow_decimal, base_unit_id: unit.base_unit_id || '',
    base_multiple: unit.base_multiple || '', is_active: unit.is_active !== false,
  });
  const set = (p) => setF((x) => ({ ...x, ...p }));
  return (
    <Modal open onClose={onClose} size="sm" title={unit.id ? 'Edit unit' : 'New unit'}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave(f)} disabled={!f.name || !f.short_name}>
          <Save size={16} /> Save</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Box" autoFocus /></Field>
        <Field label="Short"><input className="input" value={f.short_name} onChange={(e) => set({ short_name: e.target.value })} placeholder="box" /></Field>
      </div>
      <label className="flex items-center gap-2 mt-3 text-sm">
        <input type="checkbox" checked={f.allow_decimal} onChange={(e) => set({ allow_decimal: e.target.checked })} />
        Allow fractional quantities
      </label>
      <Field label="Converts to (base unit)" className="mt-3" hint="Leave blank if this is itself a base unit">
        <select className="input" value={f.base_unit_id} onChange={(e) => set({ base_unit_id: e.target.value })}>
          <option value="">— base unit —</option>
          {units.filter((u) => u.id !== f.id && !u.base_unit_id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </Field>
      {f.base_unit_id && (
        <Field label="How many base units in one?" className="mt-3">
          <input type="number" className="input" value={f.base_multiple} onChange={(e) => set({ base_multiple: e.target.value })} placeholder="12" />
        </Field>
      )}
    </Modal>
  );
}

/* ───────────────────────── price tiers ───────────────────────── */
function Tiers({ can }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api.get('/api/catalog-ext/price-groups?all=1').then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  const save = async (form) => {
    try {
      if (form.id) await api.put(`/api/catalog-ext/price-groups/${form.id}`, form);
      else await api.post('/api/catalog-ext/price-groups', form);
      toast.success('Tier saved'); setEditing(null); load();
    } catch (e) { toast.error(e.message); }
  };
  if (!rows) return <Loading />;
  return (
    <Card bodyClass="p-0" title="Selling price tiers"
      subtitle="Retail, wholesale, staff. A tag can carry its own tier, or the customer's group sets it — the till applies it automatically"
      actions={can('products.write') && (
        <button className="btn-primary text-xs" onClick={() => setEditing({})}><Plus size={14} /> New tier</button>)}>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Name</th><th>Notes</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id} className={g.is_active ? '' : 'opacity-50'}>
                <td className="font-medium">{g.name}</td>
                <td className="text-sm text-slate-600">{g.description || '—'}</td>
                <td><Badge status={g.is_active ? 'completed' : 'cancelled'}>{g.is_active ? 'Active' : 'Off'}</Badge></td>
                <td className="text-right">{can('products.write') && (
                  <button className="btn-ghost text-xs" onClick={() => setEditing(g)}>Edit</button>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 p-4">
        Set the actual prices per product on the product editor — each variant gets a price box per tier.
      </p>
      {editing && (
        <Modal open onClose={() => setEditing(null)} size="sm" title={editing.id ? 'Edit tier' : 'New tier'}
          footer={<><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" onClick={() => save(editing)} disabled={!editing.name}>Save</button></>}>
          <Field label="Name"><input className="input" autoFocus value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Wholesale" /></Field>
          <Field label="Notes" className="mt-3"><input className="input" value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
        </Modal>
      )}
    </Card>
  );
}

/* ───────────────────────── bin locations ───────────────────────── */
function Bins({ can }) {
  const toast = useToast();
  const { location } = useAuth();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const load = useCallback(() => api.get('/api/catalog-ext/bins').then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  const save = async (form) => {
    try {
      if (form.id) await api.put(`/api/catalog-ext/bins/${form.id}`, form);
      else await api.post('/api/catalog-ext/bins', form);
      toast.success('Location saved'); setEditing(null); load();
    } catch (e) { toast.error(e.message); }
  };
  if (!rows) return <Loading />;
  return (
    <>
      <Card bodyClass="p-0" title="Bin, shelf and rack locations"
        subtitle="Where stock physically sits, so a sweep can say a tag is in the wrong bin"
        actions={can('products.write') && (
          <button className="btn-primary text-xs" onClick={() => setEditing({})}><Plus size={14} /> New location</button>)}>
        {rows.length === 0 ? <Empty title="No shelf locations yet" icon={MapPin}
          hint="Add A-3-2 style labels for your racks and shelves." /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Label</th><th>Zone / Aisle / Rack / Shelf</th><th className="text-right">Units here</th><th /></tr></thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td className="font-mono font-medium">{b.label}</td>
                    <td className="text-sm text-slate-600">{[b.zone, b.aisle, b.rack, b.shelf, b.bin].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="text-right tabular-nums">{num(b.units)}</td>
                    <td className="text-right whitespace-nowrap">
                      {can('inventory.write') && <button className="btn-ghost text-xs" onClick={() => setAssigning(b)}>Fill by scan</button>}
                      {can('products.write') && <button className="btn-ghost text-xs" onClick={() => setEditing(b)}>Edit</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && (
        <Modal open onClose={() => setEditing(null)} size="sm" title={editing.id ? 'Edit location' : 'New location'}
          footer={<><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" onClick={() => save(editing)} disabled={!editing.label}>Save</button></>}>
          <Field label="Label" hint="What is written on the shelf edge, e.g. A-3-2">
            <input className="input font-mono" autoFocus value={editing.label || ''} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /></Field>
          <div className="grid grid-cols-3 gap-2 mt-3">
            {['rack', 'shelf', 'bin'].map((k) => (
              <Field key={k} label={k[0].toUpperCase() + k.slice(1)}>
                <input className="input" value={editing[k] || ''} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} /></Field>
            ))}
          </div>
        </Modal>
      )}
      {assigning && <FillBin bin={assigning} onClose={() => setAssigning(null)} onDone={() => { setAssigning(null); load(); }} />}
    </>
  );
}

function FillBin({ bin, onClose, onDone }) {
  const toast = useToast();
  const [codes, setCodes] = useState([]);
  const [busy, setBusy] = useState(false);
  const add = useCallback((c) => setCodes((x) => (x.includes(c) ? x : [...x, c])), []);
  const scan = useRfidScan(add, { dedupeMs: 2000, tagsOnly: true, enabled: true });
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/api/catalog-ext/bins/${bin.id}/assign`, { codes });
      toast.success(`${r.moved} unit(s) moved into ${bin.label}`); onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`Fill ${bin.label} by scan`}
      subtitle="Sweep the tags on this shelf; they get stamped with this location"
      footer={<><span className="mr-auto text-sm text-slate-500">{codes.length} read</span>
        <button className="btn-primary" onClick={submit} disabled={busy || !codes.length}>
          {busy ? <Spinner /> : <MapPin size={16} />} Move here</button></>}>
      <scan.CaptureField />
      {scan.native && (
        <button onClick={scan.toggle} className={`${scan.scanning ? 'btn-danger' : 'btn-secondary'} w-full mb-3`}>
          {scan.scanning ? <><Square size={16} /> Stop</> : <><Radio size={16} /> Read continuously</>}</button>)}
      {codes.length === 0 ? <Empty title="Nothing read yet" icon={Radio} hint="Sweep the shelf." />
        : <p className="text-sm text-slate-600">{codes.length} tag(s) ready to move.</p>}
    </Modal>
  );
}

/* ───────────────────────── label templates ───────────────────────── */
function Labels({ can }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api.get('/api/catalog-ext/label-templates').then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  const save = async (form) => {
    try {
      if (form.id) await api.put(`/api/catalog-ext/label-templates/${form.id}`, form);
      else await api.post('/api/catalog-ext/label-templates', form);
      toast.success('Template saved'); setEditing(null); load();
    } catch (e) { toast.error(e.message); }
  };
  if (!rows) return <Loading />;
  return (
    <Card bodyClass="p-0" title="Label templates"
      subtitle="Thermal label layouts for non-RFID legacy items — size, columns and what prints on each"
      actions={can('products.write') && (
        <button className="btn-primary text-xs" onClick={() => setEditing({ width_mm: 50, height_mm: 25, cols: 2, rows: 7, show_name: true, show_price: true, show_variant: true, barcode_type: 'CODE128' })}>
          <Plus size={14} /> New template</button>)}>
      {rows.length === 0 ? <Empty title="No templates yet" icon={Tags} hint="Create one to print barcode labels." /> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Size</th><th>Grid</th><th>Shows</th><th /></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium">{t.name}{t.is_default && <Badge className="ml-2">default</Badge>}</td>
                  <td className="text-sm">{num(t.width_mm)}×{num(t.height_mm)}mm</td>
                  <td className="text-sm">{t.cols}×{t.rows}</td>
                  <td className="text-xs text-slate-500">{[t.show_name && 'name', t.show_price && 'price', t.show_variant && 'variant'].filter(Boolean).join(', ')}</td>
                  <td className="text-right">{can('products.write') && <button className="btn-ghost text-xs" onClick={() => setEditing(t)}>Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <Modal open onClose={() => setEditing(null)} size="sm" title={editing.id ? 'Edit template' : 'New template'}
          footer={<><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" onClick={() => save(editing)} disabled={!editing.name}>Save</button></>}>
          <Field label="Name"><input className="input" autoFocus value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Shelf 50×25" /></Field>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Field label="Width mm"><input type="number" className="input" value={editing.width_mm} onChange={(e) => setEditing({ ...editing, width_mm: e.target.value })} /></Field>
            <Field label="Height mm"><input type="number" className="input" value={editing.height_mm} onChange={(e) => setEditing({ ...editing, height_mm: e.target.value })} /></Field>
            <Field label="Columns"><input type="number" className="input" value={editing.cols} onChange={(e) => setEditing({ ...editing, cols: e.target.value })} /></Field>
            <Field label="Rows"><input type="number" className="input" value={editing.rows} onChange={(e) => setEditing({ ...editing, rows: e.target.value })} /></Field>
          </div>
          <div className="flex flex-wrap gap-3 mt-3 text-sm">
            {['show_name', 'show_price', 'show_variant', 'show_business'].map((k) => (
              <label key={k} className="flex items-center gap-1.5">
                <input type="checkbox" checked={!!editing[k]} onChange={(e) => setEditing({ ...editing, [k]: e.target.checked })} />
                {k.replace('show_', '')}
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 mt-3 text-sm">
            <input type="checkbox" checked={!!editing.is_default} onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })} />
            Make this the default template
          </label>
        </Modal>
      )}
    </Card>
  );
}

/* ───────────────────────── lots & expiry ───────────────────────── */
function Lots({ can }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const load = useCallback(() => api.get('/api/catalog-ext/lots').then(setData).catch(() => setData({ data: [] })), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <Loading />;
  return (
    <Card bodyClass="p-0" title="Lots & expiry"
      subtitle="Batch and expiry tracking, linked to each tag. Dormant for footwear; used by supermarket and pharmacy shop types">
      {data.data.length === 0 ? <Empty title="No lots recorded" icon={CalendarClock}
        hint="Lots appear when you receive stock with a batch or expiry date. Turned on under the pharmacy/supermarket business type." /> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Product</th><th>Lot</th><th>Mfg</th><th>Expiry</th><th className="text-right">In stock</th></tr></thead>
            <tbody>
              {data.data.map((l) => (
                <tr key={l.id}>
                  <td className="font-medium">{l.product_name} <span className="text-slate-500 text-xs">{l.sku}</span></td>
                  <td className="font-mono text-xs">{l.lot_no}</td>
                  <td className="text-sm">{l.mfg_date ? date(l.mfg_date) : '—'}</td>
                  <td className="text-sm">{l.expiry_date ? date(l.expiry_date) : '—'}</td>
                  <td className="text-right tabular-nums">{num(l.in_stock)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
