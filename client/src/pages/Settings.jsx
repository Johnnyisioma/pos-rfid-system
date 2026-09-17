import { useEffect, useState, useCallback } from 'react';
import {
  Save, Plus, MapPin, Users, Tag, Layers, Building2, Trash2, Calculator,
  Upload, ImageOff, Receipt as ReceiptIcon, Info, Percent, ShieldCheck, Lock, Check, Minus,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { money, labelize, dateTime } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, useToast, Field, Tabs, Spinner, ConfirmButton,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import Receipt from '../components/Receipt.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTabParam } from '../lib/useTabParam.js';

export default function Settings() {
  const [tab, setTab] = useTabParam('business');
  const { can } = useAuth();
  return (
    <>
      <PageHeader title="Settings" subtitle="Business details, locations, staff and catalogue options" />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'business', label: 'Business' },
        { value: 'receipt', label: 'Receipt & invoice' },
        { value: 'locations', label: 'Locations' },
        { value: 'registers', label: 'Registers' },
        { value: 'users', label: 'Staff' },
        { value: 'roles', label: 'Roles & permissions' },
        { value: 'taxes', label: 'Tax rates' },
        { value: 'catalog', label: 'Catalogue options' },
        { value: 'account', label: 'My account' },
      ]} />
      {tab === 'business' && <Business />}
      {tab === 'receipt' && <ReceiptSettings />}
      {tab === 'locations' && <Locations />}
      {tab === 'registers' && <Registers />}
      {tab === 'users' && <Staff />}
      {tab === 'roles' && <RolesMatrix />}
      {tab === 'taxes' && <TaxRates />}
      {tab === 'catalog' && <CatalogOptions />}
      {tab === 'account' && <Account />}
    </>
  );
}

/* ---------------- business ---------------- */
function Business() {
  const { settings, reloadSettings, can } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (settings) setForm(settings); }, [settings]);
  if (!form) return <Loading />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/api/settings', form);
      await reloadSettings();
      toast.success('Settings saved');
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="Business identity" subtitle="Printed on every receipt and invoice">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Trading name"><input className="input" value={form.name} onChange={set('name')} /></Field>
          <Field label="Legal name"><input className="input" value={form.legal_name || ''} onChange={set('legal_name')} /></Field>
          <Field label="Tax identification number (TIN)">
            <input className="input" value={form.tin || ''} onChange={set('tin')} />
          </Field>
          <Field label="RC number"><input className="input" value={form.rc_number || ''} onChange={set('rc_number')} /></Field>
          <Field label="Phone"><input className="input" value={form.phone || ''} onChange={set('phone')} /></Field>
          <Field label="Email"><input className="input" value={form.email || ''} onChange={set('email')} /></Field>
          <Field label="Address" className="sm:col-span-2">
            <input className="input" value={form.address || ''} onChange={set('address')} />
          </Field>
          <Field label="Receipt footer" className="sm:col-span-2">
            <textarea className="input" rows="2" value={form.receipt_footer || ''} onChange={set('receipt_footer')} />
          </Field>
        </div>
      </Card>

      <div className="space-y-4">
        <Card title="Tax & invoicing">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="VAT rate (%)">
              <input type="number" step="0.1" className="input" value={form.vat_rate} onChange={set('vat_rate')} />
            </Field>
            <Field label="Invoice prefix">
              <input className="input" value={form.invoice_prefix} onChange={set('invoice_prefix')} />
            </Field>
            <Field label="Currency code">
              <input className="input" value={form.currency} onChange={set('currency')} />
            </Field>
            <Field label="Currency symbol">
              <input className="input" value={form.currency_symbol} onChange={set('currency_symbol')} />
            </Field>
            <Field label="E-invoice scheme" className="sm:col-span-2"
              hint="Recorded on every invoice payload so a future FIRS submission is a mapping job, not a redesign.">
              <input className="input" value={form.einvoice_scheme || ''} onChange={set('einvoice_scheme')} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 mt-3">
            <input type="checkbox" className="rounded border-slate-300"
              checked={!!form.prices_include_vat} onChange={set('prices_include_vat')} />
            Shelf prices already include VAT (normal for Nigerian retail)
          </label>
          <p className="text-xs text-slate-500 mt-2">
            VAT rules change — confirm the current rate and your filing obligations with a tax adviser
            before relying on this for a live business.
          </p>
        </Card>

        <Card title="Stock & loyalty">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="SKU prefix"><input className="input" value={form.sku_prefix} onChange={set('sku_prefix')} /></Field>
            <Field label="EPC company prefix" hint="4 hex characters at the front of every RFID tag">
              <input className="input font-mono" maxLength={4} value={form.epc_company_prefix}
                onChange={set('epc_company_prefix')} />
            </Field>
            <Field label="Default reorder point">
              <input type="number" className="input" value={form.low_stock_default} onChange={set('low_stock_default')} />
            </Field>
            <Field label="Spend per loyalty point">
              <input type="number" className="input" value={form.loyalty_earn_per} onChange={set('loyalty_earn_per')} />
            </Field>
            <Field label="Value of one point">
              <input type="number" className="input" value={form.loyalty_point_value} onChange={set('loyalty_point_value')} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 mt-3">
            <input type="checkbox" className="rounded border-slate-300"
              checked={!!form.loyalty_enabled} onChange={set('loyalty_enabled')} />
            Loyalty points enabled
          </label>
        </Card>

        {can('settings.write') && (
          <button className="btn-primary w-full" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : <Save size={16} />} Save settings
          </button>
        )}
      </div>
    </div>
  );
}


/* ---------------- receipt & invoice ---------------- */

/** Shrink an uploaded logo in the browser so it fits comfortably in the database. */
function fileToLogoDataUrl(file, maxWidth = 500) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('That file is not an image'));
    if (file.size > 4 * 1024 * 1024) return reject(new Error('Pick an image under 4 MB'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That image could not be decoded'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        // white behind the logo so a transparent PNG still prints on thermal paper
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const SAMPLE_SALE = {
  invoice_no: 'INV-2026-000123', invoice_seq: 123, created_at: new Date().toISOString(),
  cashier_name: 'Bola Adeyemi', location_name: 'Lagos Main Store', customer_name: 'Adaeze Nwosu',
  subtotal: 71800, discount_amount: 1800, tax_amount: 4883.72, total: 70000,
  amount_paid: 80000, change_due: 10000, balance_due: 0, points_earned: 70,
  items: [
    { product_name: 'Marconi Classic Oxford', variant_label: '42 / Black', sku: 'MF-0001-42-BLACK',
      quantity: 1, unit_price: 38900, discount_amount: 0, line_total: 38900, tax_amount: 2713.95,
      units: [{ readable: 'MF-0001-42-BLACK-000007' }] },
    { product_name: 'Lagos Sun Slide', variant_label: '42 / Brown', sku: 'MF-0006-42-BROWN',
      quantity: 2, unit_price: 16450, discount_amount: 1800, line_total: 31100, tax_amount: 2169.77,
      units: [{ readable: 'MF-0006-42-BROWN-000011' }, { readable: 'MF-0006-42-BROWN-000012' }] },
  ],
  payments: [{ method: 'cash', amount: 80000 }],
};

function ReceiptSettings() {
  const { settings, reloadSettings, can } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (settings) setForm(settings); }, [settings]);
  if (!form) return <Loading />;
  const set = (k) => (e) =>
    setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const pickLogo = async (file) => {
    if (!file) return;
    try {
      const dataUrl = await fileToLogoDataUrl(file);
      setForm((f) => ({ ...f, logo_url: dataUrl }));
      toast.info('Logo loaded — press Save to keep it');
    } catch (err) { toast.error(err.message); }
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/api/settings', form);
      await reloadSettings();
      toast.success('Receipt settings saved');
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const previewData = {
    business: {
      name: form.name, legal_name: form.legal_name, tin: form.tin, rc_number: form.rc_number,
      address: form.address, phone: form.phone, email: form.email,
      logo_url: form.receipt_show_logo ? form.logo_url : '',
      logo_width_mm: form.logo_width_mm,
      footer: form.receipt_footer, currency_symbol: form.currency_symbol,
      vat_rate: form.vat_rate, prices_include_vat: form.prices_include_vat,
      font_size: form.receipt_font_size, paper: form.receipt_paper,
    },
    sale: SAMPLE_SALE,
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="space-y-4">
        <Card title="Company logo" subtitle="Printed at the top of every receipt and invoice">
          <div className="flex items-start gap-4">
            <div className="h-24 w-24 rounded-lg ring-1 ring-slate-200 grid place-items-center bg-slate-50 shrink-0 overflow-hidden">
              {form.logo_url
                ? <img src={form.logo_url} alt="Company logo" className="max-h-full max-w-full object-contain" />
                : <ImageOff size={22} className="text-slate-300" />}
            </div>
            <div className="flex-1 min-w-0">
              <label className="btn-secondary cursor-pointer inline-flex">
                <Upload size={15} /> {form.logo_url ? 'Replace logo' : 'Upload logo'}
                <input type="file" accept="image/*" className="hidden"
                  onChange={(e) => pickLogo(e.target.files[0])} />
              </label>
              {form.logo_url && (
                <button className="btn-ghost text-xs text-rose-600 ml-2"
                  onClick={() => setForm({ ...form, logo_url: '' })}>Remove</button>
              )}
              <p className="text-xs text-slate-500 mt-2">
                PNG or JPG. It is scaled down and stored in the database, so it survives every
                redeploy — no file server to keep running.
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            <Field label="Printed logo width (mm)"
              hint="30mm suits an 80mm till roll">
              <input type="number" min="10" max="70" className="input"
                value={form.logo_width_mm} onChange={set('logo_width_mm')} />
            </Field>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="rounded border-slate-300"
                  checked={!!form.receipt_show_logo} onChange={set('receipt_show_logo')} />
                Show the logo on receipts
              </label>
            </div>
          </div>
        </Card>

        <Card title="Print size" subtitle="How the receipt is laid out when printed">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Paper size">
              <select className="input" value={form.receipt_paper} onChange={set('receipt_paper')}>
                <option value="58mm">58 mm till roll (narrow)</option>
                <option value="80mm">80 mm till roll (standard)</option>
                <option value="a4">A4 / A5 invoice sheet</option>
              </select>
            </Field>
            <Field label="Font size" hint="Bigger text is easier to read but uses more paper">
              <select className="input" value={form.receipt_font_size} onChange={set('receipt_font_size')}>
                <option value="9">9 — very small</option>
                <option value="10">10 — small</option>
                <option value="11">11</option>
                <option value="12">12 — default</option>
                <option value="13">13</option>
                <option value="14">14 — large</option>
                <option value="16">16 — extra large</option>
              </select>
            </Field>
          </div>
        </Card>

        <Card title="Editing issued receipts">
          <Field label="Managers may edit a receipt for this many days after it is issued"
            hint="Set to 0 to stop issued receipts being edited at all.">
            <input type="number" min="0" max="365" className="input"
              value={form.sale_edit_window_days} onChange={set('sale_edit_window_days')} />
          </Field>
          <div className="mt-3 rounded-lg bg-amber-50 ring-1 ring-amber-200 p-3 text-xs text-amber-900 flex gap-2">
            <Info size={14} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Only Administrators and Managers can edit an issued receipt.</p>
              <p className="mt-1">
                The invoice number never changes, every version is kept, and the receipt is marked as
                amended. Altering an issued VAT invoice may still require a credit note under Nigerian
                rules — check with your tax adviser how you should handle corrections.
              </p>
            </div>
          </div>
        </Card>

        {can('settings.write') && (
          <button className="btn-primary w-full" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : <Save size={16} />} Save receipt settings
          </button>
        )}
      </div>

      <Card title="Live preview" subtitle="Sample data — this is exactly how it prints"
        className="lg:sticky lg:top-[4.5rem] self-start">
        <div className="bg-slate-100 rounded-lg p-4 flex justify-center overflow-x-auto">
          <div className="bg-white shadow-sm p-3">
            <Receipt data={previewData} preview />
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- locations ---------------- */
function Locations() {
  const { can } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = () => api.get('/api/locations').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const save = async (form) => {
    try {
      if (form.id) await api.put(`/api/locations/${form.id}`, form);
      else await api.post('/api/locations', form);
      toast.success('Location saved');
      setEditing(null);
      load();
    } catch (e) { toast.error(e.message); }
  };

  if (!rows) return <Loading />;
  return (
    <>
      <Card bodyClass="p-0" title="Shop locations"
        subtitle="Every product, sale and stock record is scoped to a location"
        actions={can('settings.write') && (
          <button className="btn-primary text-xs" onClick={() => setEditing({})}><Plus size={14} /> Add location</button>
        )}>
        {rows.length === 0 ? <Empty title="No locations" icon={MapPin} /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Name</th><th>Code</th><th>Address</th><th>Phone</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td className="font-medium">{l.name}</td>
                    <td className="font-mono text-xs">{l.code}</td>
                    <td className="text-slate-600 text-sm">{l.address || '—'}</td>
                    <td className="text-slate-600 text-sm">{l.phone || '—'}</td>
                    <td><Badge status={l.is_active ? 'completed' : 'cancelled'}>
                      {l.is_active ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="text-right">
                      {can('settings.write') && (
                        <button className="btn-ghost text-xs" onClick={() => setEditing(l)}>Edit</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? 'Edit location' : 'New location'} size="sm"
          footer={<><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" onClick={() => save(editing)}>Save</button></>}>
          <div className="space-y-3">
            <Field label="Name"><input className="input" value={editing.name || ''} autoFocus
              onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Short code" hint="Used on SKUs, exports and transfers, e.g. LAG">
              <input className="input font-mono uppercase" value={editing.code || ''} disabled={!!editing.id}
                onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Address"><input className="input" value={editing.address || ''}
              onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={editing.phone || ''}
              onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
            {editing.id && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="rounded border-slate-300" checked={editing.is_active !== false}
                  onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
                Active
              </label>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------------- registers ---------------- */
function Registers() {
  const { can, locationId, locations } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [name, setName] = useState('');

  const load = () => api.get('/api/registers').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [locationId]);

  const add = async () => {
    if (!name.trim()) return;
    try {
      await api.post('/api/registers', { name, location_id: locationId });
      toast.success('Register added'); setName(''); load();
    } catch (e) { toast.error(e.message); }
  };

  if (!rows) return <Loading />;
  return (
    <Card title="Registers at this location" bodyClass="p-0"
      subtitle="Each till has its own open/close cycle and cash reconciliation">
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Register</th><th>Location</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.name}</td>
                <td className="text-slate-600">{r.location_name}</td>
                <td>{r.open_session
                  ? <Badge status="open">Open — {r.open_session.user_name}</Badge>
                  : <Badge>Closed</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {can('settings.write') && (
        <div className="p-4 border-t border-slate-100 flex gap-2">
          <input className="input flex-1" placeholder="New register name, e.g. Counter 2" value={name}
            onChange={(e) => setName(e.target.value)} />
          <button className="btn-primary" onClick={add}><Plus size={16} /> Add</button>
        </div>
      )}
    </Card>
  );
}

/* ---------------- staff ---------------- */
const ROLE_NOTES = {
  admin: 'Everything, including settings, staff and every location.',
  manager: 'Everything operational plus reports and staff — no limit on discounts.',
  cashier: 'Sell, take returns, manage the till and customers. Discounts capped.',
  inventory: 'Products, stock, purchasing, transfers and RFID — no checkout.',
};

function Staff() {
  const { can, locations } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = () => api.get('/api/users').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const save = async (form) => {
    try {
      if (form.id) await api.put(`/api/users/${form.id}`, form);
      else await api.post('/api/users', form);
      toast.success('Staff member saved');
      setEditing(null);
      load();
    } catch (e) { toast.error(e.message); }
  };

  if (!rows) return <Loading />;
  return (
    <>
      <Card bodyClass="p-0" title="Staff accounts"
        actions={can('users.write') && (
          <button className="btn-primary text-xs" onClick={() => setEditing({ role: 'cashier', location_ids: [] })}>
            <Plus size={14} /> Add staff
          </button>
        )}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Locations</th>
              <th className="text-right">Max discount</th><th>Status</th><th>Last login</th><th></th></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium">{u.name}</td>
                  <td className="text-slate-600 text-sm">{u.email}</td>
                  <td><Badge>{labelize(u.role)}</Badge></td>
                  <td className="text-slate-600 text-xs">
                    {u.locations.length ? u.locations.map((l) => l.name).join(', ') : '—'}
                  </td>
                  <td className="text-right tabular-nums">{Number(u.max_discount_percent)}%</td>
                  <td><Badge status={u.is_active ? 'completed' : 'cancelled'}>
                    {u.is_active ? 'Active' : 'Disabled'}</Badge></td>
                  <td className="text-xs text-slate-500 whitespace-nowrap">
                    {u.last_login_at ? dateTime(u.last_login_at) : 'never'}
                  </td>
                  <td className="text-right">
                    {can('users.write') && (
                      <button className="btn-ghost text-xs"
                        onClick={() => setEditing({ ...u, location_ids: u.locations.map((l) => l.id) })}>
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-4" title="What each role can do">
        <dl className="grid sm:grid-cols-2 gap-3 text-sm">
          {Object.entries(ROLE_NOTES).map(([role, note]) => (
            <div key={role} className="rounded-lg ring-1 ring-slate-200 p-3">
              <dt className="font-medium text-slate-800">{labelize(role)}</dt>
              <dd className="text-slate-600 text-xs mt-1">{note}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? 'Edit staff member' : 'New staff member'}
          size="sm"
          footer={<><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" onClick={() => save(editing)}>Save</button></>}>
          <div className="space-y-3">
            <Field label="Name"><input className="input" value={editing.name || ''} autoFocus
              onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Email"><input className="input" type="email" value={editing.email || ''}
              disabled={!!editing.id}
              onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
            <Field label={editing.id ? 'New password (leave blank to keep)' : 'Password'}>
              <input className="input" type="password" value={editing.password || ''}
                onChange={(e) => setEditing({ ...editing, password: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Role">
                <select className="input" value={editing.role}
                  onChange={(e) => setEditing({ ...editing, role: e.target.value })}>
                  {Object.keys(ROLE_NOTES).map((r) => <option key={r} value={r}>{labelize(r)}</option>)}
                </select>
              </Field>
              <Field label="Max discount %">
                <input type="number" className="input" value={editing.max_discount_percent ?? 0}
                  onChange={(e) => setEditing({ ...editing, max_discount_percent: e.target.value })} />
              </Field>
            </div>
            <Field label="Locations" hint="Admins always have access to every location.">
              <div className="space-y-1.5">
                {locations.map((l) => (
                  <label key={l.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" className="rounded border-slate-300"
                      checked={(editing.location_ids || []).includes(l.id)}
                      onChange={(e) => setEditing({
                        ...editing,
                        location_ids: e.target.checked
                          ? [...(editing.location_ids || []), l.id]
                          : (editing.location_ids || []).filter((x) => x !== l.id),
                      })} />
                    {l.name}
                  </label>
                ))}
              </div>
            </Field>
            {editing.id && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="rounded border-slate-300" checked={editing.is_active !== false}
                  onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
                Active
              </label>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------------- catalogue options ---------------- */
function CatalogOptions() {
  const { can } = useAuth();
  const toast = useToast();
  const [c, setC] = useState(null);
  const [tplModal, setTplModal] = useState(null);
  const [newBrand, setNewBrand] = useState('');
  const [newCat, setNewCat] = useState({ name: '', parent_id: '' });
  const [newExp, setNewExp] = useState('');

  const load = useCallback(() => api.get('/api/catalog').then(setC).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  if (!c) return <Loading />;

  const post = async (path, body, msg) => {
    try { await api.post(path, body); toast.success(msg); load(); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="Variation templates" subtitle="Reusable size and colour sets used by the matrix generator"
        actions={can('products.write') && (
          <button className="btn-primary text-xs" onClick={() => setTplModal({ axis: 'size', values: '' })}>
            <Plus size={14} /> New template
          </button>
        )} bodyClass="p-0">
        {c.templates.length === 0 ? <Empty title="No templates yet" icon={Layers} /> : (
          <table className="data">
            <thead><tr><th>Name</th><th>Axis</th><th>Values</th><th></th></tr></thead>
            <tbody>
              {c.templates.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium">{t.name}</td>
                  <td><Badge>{t.axis}</Badge></td>
                  <td className="text-slate-600 text-xs">{(t.values_json || []).join(', ')}</td>
                  <td className="text-right">
                    {can('products.write') && (
                      <ConfirmButton className="btn-ghost p-2 text-rose-600" message="Delete?"
                        onConfirm={async () => { await api.del(`/api/catalog/templates/${t.id}`); load(); }}>
                        <Trash2 size={14} />
                      </ConfirmButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Brands" bodyClass="p-0">
        <div className="max-h-64 overflow-y-auto">
          <table className="data">
            <tbody>
              {c.brands.map((b) => <tr key={b.id}><td>{b.name}</td></tr>)}
            </tbody>
          </table>
        </div>
        {can('products.write') && (
          <div className="p-4 border-t border-slate-100 flex gap-2">
            <input className="input flex-1" placeholder="New brand" value={newBrand}
              onChange={(e) => setNewBrand(e.target.value)} />
            <button className="btn-primary" onClick={() => { post('/api/catalog/brands', { name: newBrand }, 'Brand added'); setNewBrand(''); }}>
              <Plus size={16} />
            </button>
          </div>
        )}
      </Card>

      <Card title="Categories" bodyClass="p-0">
        <div className="max-h-64 overflow-y-auto">
          <table className="data">
            <tbody>
              {c.categories.map((cat) => (
                <tr key={cat.id}>
                  <td>{cat.parent_name && <span className="text-slate-400">{cat.parent_name} › </span>}{cat.name}</td>
                  <td className="text-right">
                    {can('products.write') && (
                      <ConfirmButton className="btn-ghost p-2 text-rose-600" message="Delete?"
                        onConfirm={async () => { await api.del(`/api/catalog/categories/${cat.id}`); load(); }}>
                        <Trash2 size={14} />
                      </ConfirmButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {can('products.write') && (
          <div className="p-4 border-t border-slate-100 flex gap-2">
            <input className="input flex-1" placeholder="New category" value={newCat.name}
              onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} />
            <select className="input w-40" value={newCat.parent_id}
              onChange={(e) => setNewCat({ ...newCat, parent_id: e.target.value })}>
              <option value="">Top level</option>
              {c.categories.filter((x) => !x.parent_id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <button className="btn-primary"
              onClick={() => { post('/api/catalog/categories', newCat, 'Category added'); setNewCat({ name: '', parent_id: '' }); }}>
              <Plus size={16} />
            </button>
          </div>
        )}
      </Card>

      <Card title="Expense categories" bodyClass="p-0">
        <div className="max-h-64 overflow-y-auto">
          <table className="data">
            <tbody>{c.expenseCategories.map((e) => <tr key={e.id}><td>{e.name}</td></tr>)}</tbody>
          </table>
        </div>
        {can('expenses.write') && (
          <div className="p-4 border-t border-slate-100 flex gap-2">
            <input className="input flex-1" placeholder="New expense category" value={newExp}
              onChange={(e) => setNewExp(e.target.value)} />
            <button className="btn-primary"
              onClick={() => { post('/api/catalog/expense-categories', { name: newExp }, 'Added'); setNewExp(''); }}>
              <Plus size={16} />
            </button>
          </div>
        )}
      </Card>

      {tplModal && (
        <Modal open onClose={() => setTplModal(null)} title="New variation template" size="sm"
          footer={<><button className="btn-secondary" onClick={() => setTplModal(null)}>Cancel</button>
            <button className="btn-primary" onClick={async () => {
              await post('/api/catalog/templates', {
                name: tplModal.name, axis: tplModal.axis,
                values: tplModal.values.split(',').map((x) => x.trim()).filter(Boolean),
              }, 'Template saved');
              setTplModal(null);
            }}>Save</button></>}>
          <div className="space-y-3">
            <Field label="Name"><input className="input" value={tplModal.name || ''} autoFocus
              onChange={(e) => setTplModal({ ...tplModal, name: e.target.value })} /></Field>
            <Field label="Axis">
              <select className="input" value={tplModal.axis}
                onChange={(e) => setTplModal({ ...tplModal, axis: e.target.value })}>
                <option value="size">Size</option>
                <option value="color">Colour</option>
              </select>
            </Field>
            <Field label="Values (comma separated)">
              <input className="input" value={tplModal.values}
                onChange={(e) => setTplModal({ ...tplModal, values: e.target.value })}
                placeholder="40, 41, 42, 43" />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- my account ---------------- */
function Account() {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [busy, setBusy] = useState(false);

  const change = async () => {
    if (form.new_password !== form.confirm) return toast.error('The new passwords do not match');
    setBusy(true);
    try {
      await api.post('/api/auth/change-password', form);
      toast.success('Password changed');
      setForm({ current_password: '', new_password: '', confirm: '' });
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="Signed in as">
        <dl className="text-sm space-y-2">
          <div className="flex justify-between"><dt className="text-slate-500">Name</dt><dd>{user.name}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Email</dt><dd>{user.email}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Role</dt><dd>{labelize(user.role)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Discount ceiling</dt>
            <dd>{Number(user.max_discount_percent)}%</dd></div>
        </dl>
      </Card>
      <Card title="Change password">
        <div className="space-y-3">
          <Field label="Current password">
            <input type="password" className="input" value={form.current_password}
              onChange={(e) => setForm({ ...form, current_password: e.target.value })} />
          </Field>
          <Field label="New password">
            <input type="password" className="input" value={form.new_password}
              onChange={(e) => setForm({ ...form, new_password: e.target.value })} />
          </Field>
          <Field label="Confirm new password">
            <input type="password" className="input" value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
          </Field>
          <button className="btn-primary w-full" onClick={change} disabled={busy}>
            {busy ? <Spinner /> : <Save size={16} />} Update password
          </button>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- tax rates ---------------- */
/**
 * Most of a Nigerian shoe shop's catalogue is standard-rated at 7.5%, but not
 * all of it — and a single global rate means the exempt lines get taxed
 * quietly and the VAT return is wrong. A rate per product fixes that; the
 * business-wide rate stays as the fallback for anything unassigned.
 */
function TaxRates() {
  const { can, settings } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() =>
    api.get('/api/catalog').then((c) => setRows(c.taxRates || [])).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    try {
      if (form.id) await api.put(`/api/catalog/tax-rates/${form.id}`, form);
      else await api.post('/api/catalog/tax-rates', form);
      toast.success('Tax rate saved');
      setEditing(null);
      load();
    } catch (e) { toast.error(e.message); }
  };

  if (!rows) return <Loading />;

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2" bodyClass="p-0" title="Tax rates"
        subtitle="Assign one to a product and its VAT is worked out at that rate instead of the business default"
        actions={can('settings.write') && (
          <button className="btn-primary text-xs" onClick={() => setEditing({ rate: 7.5 })}>
            <Plus size={14} /> New rate
          </button>
        )}>
        {rows.length === 0 ? (
          <Empty title="No tax rates yet" icon={Percent}
            hint={`Everything is taxed at the business rate of ${settings?.vat_rate || 7.5}%.`} />
        ) : (
          <table className="data">
            <thead><tr><th>Name</th><th className="text-right">Rate</th><th>Flags</th><th></th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium text-slate-800">{t.name}</td>
                  <td className="text-right tabular-nums font-medium">{Number(t.rate).toFixed(2)}%</td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {t.is_default && <Badge status="found">Default</Badge>}
                      {t.is_exempt && <Badge>Exempt / zero-rated</Badge>}
                      {!t.is_active && <Badge status="cancelled">Inactive</Badge>}
                    </div>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {can('settings.write') && (
                      <>
                        <button className="btn-ghost text-xs" onClick={() => setEditing(t)}>Edit</button>
                        <ConfirmButton className="btn-ghost p-1.5 text-rose-600" message="Remove this rate?"
                          onConfirm={async () => {
                            const res = await api.del(`/api/catalog/tax-rates/${t.id}`);
                            toast.success(res.message || 'Tax rate removed');
                            load();
                          }}>
                          <Trash2 size={14} />
                        </ConfirmButton>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="How this is applied">
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            A product with no rate assigned uses the business VAT rate, currently{' '}
            <strong className="text-slate-800">{settings?.vat_rate ?? 7.5}%</strong>.
          </p>
          <p>
            Prices {settings?.prices_include_vat ? 'include' : 'exclude'} VAT, so the tax on a line is
            worked out {settings?.prices_include_vat
              ? 'by extracting it from the shelf price'
              : 'by adding it on top of the shelf price'}.
          </p>
          <p>
            Receipts show a VAT breakdown per rate, so a basket mixing a standard-rated pair of shoes
            with a zero-rated item prints both lines and totals correctly.
          </p>
          <p className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 rounded-lg p-2.5">
            <Info size={14} className="mt-0.5 shrink-0" />
            Rates already used by a product are deactivated rather than deleted, so historical invoices
            keep showing the rate that was actually charged.
          </p>
        </div>
      </Card>

      {editing && (
        <Modal open onClose={() => setEditing(null)} size="sm"
          title={editing.id ? 'Edit tax rate' : 'New tax rate'}
          footer={<><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" onClick={() => save(editing)}>Save</button></>}>
          <div className="space-y-3">
            <Field label="Name" hint="What it will be called on the product form — “VAT 7.5%”, “Zero-rated”">
              <input className="input" autoFocus value={editing.name || ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Rate (%)" hint="Enter 0 for an exempt or zero-rated item">
              <input type="number" step="0.01" min="0" max="100" className="input"
                value={editing.rate ?? 0}
                onChange={(e) => setEditing({ ...editing, rate: e.target.value })} />
            </Field>
            {editing.id && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="rounded border-slate-300"
                  checked={!!editing.is_default}
                  onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })} />
                Offer this rate first on new products
              </label>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- roles & permissions ---------------- */
/**
 * Read-only on purpose. Roles live in the server's code, not in a table,
 * because a permission set that can be edited from the admin screen is a
 * permission set that anyone reaching that screen can widen. This page shows
 * exactly what the server enforces so nobody has to guess — or discover it
 * when a cashier can suddenly void yesterday's sales.
 */
const ROLE_DETAIL = {
  admin: 'Everything, including settings, staff and the audit log. Keep this to one or two people.',
  manager: 'Runs a shop day to day: stock, purchases, staff, reports, and amending an issued invoice.',
  cashier: 'Sells, takes returns and runs the register. Cannot change prices, stock counts or settings.',
  inventory: 'Receives goods, tags units, counts stock and moves it between shops. No till access.',
};

// labelize() would render these as "Rfid" and "Pos".
const AREA_LABELS = { rfid: 'RFID', pos: 'POS', vat: 'VAT' };

function RolesMatrix() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/api/users/roles').then(setData).catch(() => setData(null)); }, []);

  if (!data) return <Loading />;

  const cellFor = (value) => {
    if (value === 'full') return <Check size={15} className="text-emerald-600 mx-auto" />;
    if (value === 'none') return <Minus size={15} className="text-slate-300 mx-auto" />;
    return <span className="text-[11px] text-slate-600">{value}</span>;
  };

  return (
    <>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {data.roles.map((r) => (
          <Card key={r.role} bodyClass="p-4">
            <div className="flex items-start gap-2">
              <div className="h-9 w-9 rounded-lg bg-slate-100 grid place-items-center shrink-0">
                {r.is_superuser ? <ShieldCheck size={17} className="text-brand-600" />
                  : <Users size={17} className="text-slate-500" />}
              </div>
              <div className="min-w-0">
                <p className="font-medium text-slate-800">{r.label}</p>
                <p className="text-xs text-slate-500 font-mono">{r.role}</p>
              </div>
            </div>
            <p className="text-xs text-slate-600 mt-2.5 leading-relaxed">{ROLE_DETAIL[r.role]}</p>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              <Badge status={r.active_users > 0 ? 'completed' : undefined}>
                {r.active_users} active
              </Badge>
              {r.users !== r.active_users && <Badge>{r.users - r.active_users} disabled</Badge>}
              {r.is_superuser && <Badge status="found">Full access</Badge>}
            </div>
          </Card>
        ))}
      </div>

      <Card bodyClass="p-0" title="What each role can reach"
        subtitle="Exactly as the server enforces it — a tick is full access to that area">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Area</th>
                {data.roles.map((r) => <th key={r.role} className="text-center">{r.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.areas.map((area) => (
                <tr key={area}>
                  <td className="font-medium text-slate-700">
                    {AREA_LABELS[area] || labelize(area)}
                  </td>
                  {data.roles.map((r) => (
                    <td key={r.role} className="text-center">{cellFor(r.areas[area])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-start gap-2 px-4 py-3 border-t border-slate-100">
          <Lock size={14} className="mt-0.5 shrink-0 text-slate-400" />
          <p className="text-xs text-slate-500 leading-relaxed">
            Roles are fixed in the server rather than editable here, so nobody can widen their own
            access from inside the app. To change what a role may do, edit{' '}
            <code className="font-mono text-[11px] text-slate-600 bg-slate-100 rounded px-1 py-0.5">
              server/lib/permissions.js
            </code>{' '}
            and redeploy — the change then applies everywhere at once, including the API.
          </p>
        </div>
      </Card>
    </>
  );
}
