import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Users, Star, Wallet, CreditCard, Tag } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, num, date } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, Pagination, useToast, Field, Tabs, Stat,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import ExportButtons from '../components/ExportButtons.jsx';
import { useTabParam } from '../lib/useTabParam.js';

export default function Customers() {
  const [tab, setTab] = useTabParam('customers');
  return (
    <>
      <PageHeader title="Customers" subtitle="Profiles, groups, loyalty points and account balances" />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'customers', label: 'Customers' },
        { value: 'groups', label: 'Groups & pricing' },
      ]} />
      {tab === 'customers' ? <CustomerList /> : <Groups />}
    </>
  );
}

function CustomerList() {
  const { can } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [groupId, setGroupId] = useState('');
  const [owing, setOwing] = useState('');
  const [page, setPage] = useState(1);
  const [groups, setGroups] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setData(null);
    setData(await api.get(`/api/customers${qs({ q, group_id: groupId, owing, page, limit: 30 })}`)
      .catch(() => ({ data: [] })));
  }, [q, groupId, owing, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/api/catalog').then((c) => setGroups(c.customerGroups)).catch(() => {}); }, []);
  useEffect(() => { setPage(1); }, [q, groupId, owing]);

  const save = async (form) => {
    try {
      if (form.id) await api.put(`/api/customers/${form.id}`, form);
      else await api.post('/api/customers', form);
      toast.success('Customer saved');
      setEditing(null);
      load();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <>
      <Card bodyClass="p-0">
        <div className="p-4 flex flex-wrap gap-2 border-b border-slate-100">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search name, phone or email…" value={q}
              onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input w-auto" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">All groups</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select className="input w-auto" value={owing} onChange={(e) => setOwing(e.target.value)}>
            <option value="">Any balance</option>
            <option value="true">Owing money</option>
            <option value="false">Settled</option>
          </select>
          <ExportButtons report="customers" title="Customers" />
          {can('customers.write') && (
            <button className="btn-primary" onClick={() => setEditing({})}><Plus size={16} /> New customer</button>
          )}
        </div>

        {!data ? <Loading /> : data.data.length === 0 ? (
          <Empty title="No customers yet" icon={Users}
            hint="Add customers at the till to track purchase history, credit and loyalty." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Customer</th><th>Group</th><th className="text-right">Orders</th>
                  <th className="text-right">Lifetime value</th><th className="text-right">Points</th>
                  <th className="text-right">Store credit</th><th className="text-right">Owes</th>
                  <th>Last purchase</th></tr></thead>
                <tbody>
                  {data.data.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link to={`/customers/${c.id}`} className="font-medium text-slate-800 hover:text-brand-700">
                          {c.name}
                        </Link>
                        <div className="text-xs text-slate-500">{c.phone || c.email || '—'}</div>
                      </td>
                      <td>{c.group_name ? <Badge>{c.group_name}</Badge> : '—'}</td>
                      <td className="text-right tabular-nums">{num(c.order_count)}</td>
                      <td className="text-right tabular-nums">{money(c.lifetime_value)}</td>
                      <td className="text-right tabular-nums">{num(c.loyalty_points)}</td>
                      <td className="text-right tabular-nums">{money(c.store_credit)}</td>
                      <td className={`text-right tabular-nums ${Number(c.balance) > 0 ? 'text-amber-700 font-medium' : ''}`}>
                        {money(c.balance)}
                      </td>
                      <td className="text-xs text-slate-500 whitespace-nowrap">{date(c.last_purchase_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      {editing && (
        <CustomerModal customer={editing} groups={groups} onClose={() => setEditing(null)} onSave={save} />
      )}
    </>
  );
}

export function CustomerModal({ customer, groups, onClose, onSave }) {
  const [form, setForm] = useState({
    name: '', phone: '', email: '', address: '', group_id: '', credit_limit: 0, notes: '', ...customer,
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title={customer.id ? 'Edit customer' : 'New customer'} size="sm"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave(form)}>Save</button></>}>
      <div className="space-y-3">
        <Field label="Name"><input className="input" value={form.name} onChange={set('name')} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><input className="input" value={form.phone || ''} onChange={set('phone')} /></Field>
          <Field label="Email"><input className="input" value={form.email || ''} onChange={set('email')} /></Field>
        </div>
        <Field label="Address"><input className="input" value={form.address || ''} onChange={set('address')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Group">
            <select className="input" value={form.group_id || ''} onChange={set('group_id')}>
              <option value="">—</option>
              {(groups || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          <Field label="Credit limit" hint="0 = no credit allowed">
            <input type="number" className="input" value={form.credit_limit} onChange={set('credit_limit')} />
          </Field>
        </div>
        <Field label="Notes"><textarea className="input" rows="2" value={form.notes || ''} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

function Groups() {
  const { can } = useAuth();
  const toast = useToast();
  const [groups, setGroups] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = () => api.get('/api/catalog').then((c) => setGroups(c.customerGroups)).catch(() => setGroups([]));
  useEffect(() => { load(); }, []);

  const save = async (form) => {
    try {
      if (form.id) await api.put(`/api/catalog/customer-groups/${form.id}`, form);
      else await api.post('/api/catalog/customer-groups', form);
      toast.success('Group saved');
      setEditing(null);
      load();
    } catch (e) { toast.error(e.message); }
  };

  if (!groups) return <Loading />;
  return (
    <>
      <Card bodyClass="p-0"
        actions={can('customers.write') && (
          <button className="btn-primary text-xs" onClick={() => setEditing({ discount_percent: 0 })}>
            <Plus size={14} /> New group
          </button>
        )}
        title="Customer groups" subtitle="A group discount is applied automatically at the till">
        {groups.length === 0 ? <Empty title="No groups yet" icon={Tag} /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Group</th><th className="text-right">Standing discount</th><th>Notes</th><th></th></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td className="font-medium">{g.name}</td>
                    <td className="text-right tabular-nums">{Number(g.discount_percent)}%</td>
                    <td className="text-slate-600">{g.notes || '—'}</td>
                    <td className="text-right">
                      {can('customers.write') && (
                        <button className="btn-ghost text-xs" onClick={() => setEditing(g)}>Edit</button>
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
        <Modal open onClose={() => setEditing(null)} title={editing.id ? 'Edit group' : 'New group'} size="sm"
          footer={<><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" onClick={() => save(editing)}>Save</button></>}>
          <div className="space-y-3">
            <Field label="Name">
              <input className="input" value={editing.name || ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Standing discount (%)">
              <input type="number" className="input" value={editing.discount_percent}
                onChange={(e) => setEditing({ ...editing, discount_percent: e.target.value })} />
            </Field>
            <Field label="Notes">
              <input className="input" value={editing.notes || ''}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}
