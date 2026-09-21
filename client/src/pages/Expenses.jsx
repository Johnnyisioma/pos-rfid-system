import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Wallet, Trash2, Clock, RefreshCw } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, num, date, daysAgo, today } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, Pagination, useToast, Field, Stat, ConfirmButton, Spinner, Tabs,
} from '../components/ui.jsx';
import { RankedBarChart } from '../components/charts.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTabParam } from '../lib/useTabParam.js';
import ExportButtons from '../components/ExportButtons.jsx';

export default function Expenses() {
  const { can, locationId, locations } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useTabParam('list');
  const toast = useToast();
  const [data, setData] = useState(null);
  const [categories, setCategories] = useState([]);
  const [range, setRange] = useState({ from: daysAgo(60), to: today(), category_id: '', location_id: '' });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setData(null);
    setData(await api.get(`/api/expenses${qs({ ...range, page, limit: 30 })}`).catch(() => ({ data: [] })));
  }, [range, page, locationId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/api/catalog').then((c) => setCategories(c.expenseCategories)).catch(() => {}); }, []);
  useEffect(() => { setPage(1); }, [range]);

  // "Add expense" in the sidebar arrives as ?new=1 — open the form once and
  // clear the flag so a refresh does not pop it up again.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    if (can('expenses.write')) setEditing({ expense_date: today() });
    setParams(new URLSearchParams(), { replace: true });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (form) => {
    try {
      if (form.id) await api.put(`/api/expenses/${form.id}`, form);
      else await api.post('/api/expenses', form);
      toast.success('Expense saved');
      setEditing(null);
      load();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <>
      <PageHeader title="Expenses" subtitle="Running costs by category and location"
        actions={
          <>
            <ExportButtons report="expenses" title="Expenses" params={range} />
            {can('expenses.write') && (
              <button className="btn-primary" onClick={() => setEditing({ expense_date: today() })}>
                <Plus size={16} /> Record expense
              </button>
            )}
          </>
        } />

      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'list', label: 'Expenses' },
        { value: 'recurring', label: 'Recurring' },
      ]} />

      {tab === 'recurring' && <Recurring can={can} categories={categories} locations={locations}
        defaultLocation={locationId} />}

      {tab === 'list' && (<>
      {data?.totals && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          <Stat label="Total in range" value={money(data.totals.total)} icon={Wallet} />
          <Stat label="Entries" value={num(data.totals.count)} />
          <Stat label="Largest category"
            value={data.by_category[0]?.category || '—'}
            sub={data.by_category[0] ? money(data.by_category[0].total) : ''} />
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="By category" className="lg:col-span-1">
          {data?.by_category?.length ? (
            <RankedBarChart height={Math.max(200, data.by_category.length * 32)}
              data={data.by_category.map((c) => ({ label: c.category, value: Number(c.total) }))} />
          ) : <Empty title="No expenses in range" />}
        </Card>

        <Card className="lg:col-span-2" bodyClass="p-0">
          <div className="p-4 flex flex-wrap gap-2 border-b border-slate-100">
            <input type="date" className="input w-auto" value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            <input type="date" className="input w-auto" value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
            <select className="input w-auto" value={range.category_id}
              onChange={(e) => setRange((r) => ({ ...r, category_id: e.target.value }))}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="input w-auto" value={range.location_id}
              onChange={(e) => setRange((r) => ({ ...r, location_id: e.target.value }))}>
              <option value="">This shop</option>
              <option value="all">All shops</option>
            </select>
          </div>

          {!data ? <Loading /> : data.data.length === 0 ? (
            <Empty title="No expenses recorded in this range" icon={Wallet} />
          ) : (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Reference</th><th>Date</th><th>Category</th><th>Location</th>
                    <th>Note</th><th className="text-right">Amount</th><th></th></tr></thead>
                  <tbody>
                    {data.data.map((e) => (
                      <tr key={e.id}>
                        <td className="font-mono text-xs">{e.ref}</td>
                        <td className="whitespace-nowrap">{date(e.expense_date)}</td>
                        <td>{e.category_name || '—'}</td>
                        <td className="text-slate-600">{e.location_name}</td>
                        <td className="text-slate-600 text-sm">{e.note || '—'}</td>
                        <td className="text-right tabular-nums font-medium">{money(e.amount)}</td>
                        <td className="text-right whitespace-nowrap">
                          {can('expenses.write') && (
                            <>
                              <button className="btn-ghost text-xs" onClick={() => setEditing(e)}>Edit</button>
                              <ConfirmButton className="btn-ghost p-2 text-rose-600" message="Delete?"
                                onConfirm={async () => {
                                  await api.del(`/api/expenses/${e.id}`); toast.success('Deleted'); load();
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
              </div>
              <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
            </>
          )}
        </Card>
      </div>
      </>)}

      {editing && (
        <ExpenseModal expense={editing} categories={categories} locations={locations}
          defaultLocation={locationId} onClose={() => setEditing(null)} onSave={save} />
      )}
    </>
  );
}

const CADENCES = ['weekly', 'monthly', 'quarterly', 'yearly'];

function Recurring({ can, categories, locations, defaultLocation }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const [running, setRunning] = useState(false);
  const load = useCallback(() => api.get('/api/expenses/recurring/all?all=1').then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    try {
      if (form.id) await api.put(`/api/expenses/recurring/${form.id}`, form);
      else await api.post('/api/expenses/recurring', form);
      toast.success('Saved'); setEditing(null); load();
    } catch (e) { toast.error(e.message); }
  };
  const runDue = async () => {
    setRunning(true);
    try {
      const r = await api.post('/api/expenses/recurring/run', {});
      toast.success(r.generated ? `Generated ${r.generated} expense(s)` : 'Nothing due right now');
      load();
    } catch (e) { toast.error(e.message); }
    finally { setRunning(false); }
  };

  if (!rows) return <Loading />;
  const dueCount = rows.filter((re) => re.is_active && new Date(re.next_due) <= new Date()).length;
  return (
    <Card bodyClass="p-0" title="Recurring expenses"
      subtitle="Rent, salaries and subscriptions. Run when due turns every schedule that has arrived into a real expense."
      actions={can('expenses.write') && (
        <div className="flex gap-2">
          <button className="btn-secondary text-xs" onClick={runDue} disabled={running}>
            {running ? <Spinner /> : <RefreshCw size={14} />} Run due{dueCount ? ` (${dueCount})` : ''}</button>
          <button className="btn-primary text-xs" onClick={() => setEditing({ cadence: 'monthly', next_due: today() })}>
            <Plus size={14} /> New</button>
        </div>)}>
      {rows.length === 0
        ? <Empty icon={Clock} title="No recurring expenses"
            hint="Add rent or salaries so they book themselves each period." />
        : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Name</th><th>Category</th><th>Cadence</th>
                <th>Next due</th><th className="text-right">Amount</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((re) => {
                  const due = re.is_active && new Date(re.next_due) <= new Date();
                  return (
                    <tr key={re.id} className={re.is_active ? '' : 'opacity-50'}>
                      <td className="font-medium">{re.name}</td>
                      <td className="text-slate-600">{re.category_name || '—'}</td>
                      <td>{re.cadence}</td>
                      <td className={due ? 'text-amber-700 font-medium' : ''}>{date(re.next_due)}</td>
                      <td className="text-right tabular-nums">{money(re.amount)}</td>
                      <td>{due ? <Badge status="warning">due</Badge>
                        : re.is_active ? <Badge status="success">active</Badge> : <Badge status="muted">off</Badge>}</td>
                      <td className="text-right">{can('expenses.write') && (
                        <button className="btn-ghost text-xs" onClick={() => setEditing(re)}>Edit</button>)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>)}
      {editing && (
        <Modal open onClose={() => setEditing(null)} size="sm"
          title={editing.id ? 'Edit recurring expense' : 'New recurring expense'}
          footer={<><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" onClick={() => save(editing)}>Save</button></>}>
          <div className="space-y-3">
            <Field label="Name"><input className="input" value={editing.name || ''}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Shop rent" autoFocus /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount"><input type="number" className="input" value={editing.amount || ''}
                onChange={(e) => setEditing({ ...editing, amount: e.target.value })} /></Field>
              <Field label="Cadence">
                <select className="input" value={editing.cadence}
                  onChange={(e) => setEditing({ ...editing, cadence: e.target.value })}>
                  {CADENCES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <select className="input" value={editing.category_id || ''}
                  onChange={(e) => setEditing({ ...editing, category_id: e.target.value })}>
                  <option value="">—</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Next due"><input type="date" className="input"
                value={String(editing.next_due || '').slice(0, 10)}
                onChange={(e) => setEditing({ ...editing, next_due: e.target.value })} /></Field>
            </div>
            <Field label="Branch">
              <select className="input" value={editing.location_id || defaultLocation}
                onChange={(e) => setEditing({ ...editing, location_id: e.target.value })}>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
            {editing.id && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.is_active !== false}
                  onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> Active</label>)}
          </div>
        </Modal>)}
    </Card>
  );
}

function ExpenseModal({ expense, categories, locations, defaultLocation, onClose, onSave }) {
  const [form, setForm] = useState({
    amount: '', note: '', category_id: '', location_id: defaultLocation,
    expense_date: today(), ...expense,
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title={expense.id ? 'Edit expense' : 'Record an expense'} size="sm"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave(form)}>Save</button></>}>
      <div className="space-y-3">
        <Field label="Amount">
          <input type="number" className="input" value={form.amount} onChange={set('amount')} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select className="input" value={form.category_id || ''} onChange={set('category_id')}>
              <option value="">—</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" className="input" value={String(form.expense_date).slice(0, 10)}
              onChange={set('expense_date')} />
          </Field>
        </div>
        <Field label="Location">
          <select className="input" value={form.location_id} onChange={set('location_id')}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Note">
          <input className="input" value={form.note || ''} onChange={set('note')} />
        </Field>
      </div>
    </Modal>
  );
}
