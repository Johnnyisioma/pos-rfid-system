import { useEffect, useState, useCallback } from 'react';
import { Save, Plus, MapPin, Users, Tag, Layers, Building2, Trash2, Calculator } from 'lucide-react';
import { api } from '../lib/api.js';
import { money, labelize, dateTime } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, useToast, Field, Tabs, Spinner, ConfirmButton,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';

export default function Settings() {
  const [tab, setTab] = useState('business');
  const { can } = useAuth();
  return (
    <>
      <PageHeader title="Settings" subtitle="Business details, locations, staff and catalogue options" />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'business', label: 'Business' },
        { value: 'locations', label: 'Locations' },
        { value: 'registers', label: 'Registers' },
        { value: 'users', label: 'Staff & roles' },
        { value: 'catalog', label: 'Catalogue options' },
        { value: 'account', label: 'My account' },
      ]} />
      {tab === 'business' && <Business />}
      {tab === 'locations' && <Locations />}
      {tab === 'registers' && <Registers />}
      {tab === 'users' && <Staff />}
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
