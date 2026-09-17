import { useEffect, useState, useCallback } from 'react';
import {
  Landmark, Plus, Wallet, Smartphone, CreditCard, Building2, Trash2, ArrowDownLeft,
  ArrowUpRight, Settings2,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { money, num, dateTime, labelize } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, useToast, Field, Stat, Spinner, ConfirmButton,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';

const TYPE_ICON = {
  cash: Wallet, bank: Building2, mobile_money: Smartphone,
  card_terminal: CreditCard, other: Landmark,
};

const TENDERS = ['cash', 'transfer', 'card', 'mobile_money', 'store_credit'];

export default function Accounts() {
  const { can, locations } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [mapping, setMapping] = useState(false);

  const load = useCallback(() =>
    api.get('/api/accounts').then(setData).catch(() => setData({ accounts: [], method_defaults: [] })), []);
  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    try {
      if (form.id) await api.put(`/api/accounts/${form.id}`, form);
      else await api.post('/api/accounts', form);
      toast.success('Account saved');
      setEditing(null);
      load();
    } catch (e) { toast.error(e.message); }
  };

  if (!data) return <Loading />;

  // Scope every tile to the same set. Totalling balances over active accounts
  // while totalling money in and out over all of them makes the three numbers
  // describe different businesses.
  const active = data.accounts.filter((a) => a.is_active);
  const totalBalance = active.reduce((s, a) => s + Number(a.balance), 0);
  const retired = data.accounts.length - active.length;

  return (
    <>
      <PageHeader title="Payment accounts"
        subtitle="Where the money actually lands — the till, the bank, Opay, Moniepoint, a POS terminal"
        actions={can('settings.write') && (
          <>
            <button className="btn-secondary" onClick={() => setMapping(true)}>
              <Settings2 size={16} /> Tender defaults
            </button>
            <button className="btn-primary" onClick={() => setEditing({ type: 'bank' })}>
              <Plus size={16} /> New account
            </button>
          </>
        )} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Total across accounts" value={money(totalBalance)} icon={Landmark}
          sub="Active accounts only" />
        <Stat label="Active accounts" value={num(active.length)}
          sub={retired > 0 ? `${retired} retired` : undefined} />
        <Stat label="Money in"
          value={money(active.reduce((s, a) => s + Number(a.money_in), 0))} tone="good" />
        <Stat label="Money out"
          value={money(active.reduce((s, a) => s + Number(a.money_out), 0))} tone="warn" />
      </div>

      {data.accounts.length === 0 ? (
        <Card><Empty title="No accounts yet" icon={Landmark}
          hint="Add a till, a bank account and your Opay or Moniepoint wallet so every payment has somewhere to land." /></Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.accounts.map((a) => {
            const Icon = TYPE_ICON[a.type] || Landmark;
            return (
              <Card key={a.id} className={a.is_active ? '' : 'opacity-60'}>
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-slate-100 grid place-items-center shrink-0">
                    <Icon size={19} className="text-slate-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <button onClick={() => setDetail(a.id)}
                      className="font-medium text-slate-800 hover:text-brand-700 truncate block text-left">
                      {a.name}
                    </button>
                    <p className="text-xs text-slate-500">{labelize(a.type)}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {a.is_default && <Badge status="found">Default</Badge>}
                      {a.location_name && <Badge>{a.location_name}</Badge>}
                      {!a.is_active && <Badge status="cancelled">Inactive</Badge>}
                    </div>
                    {a.account_number && (
                      <p className="text-xs font-mono text-slate-500 mt-1.5">
                        {a.bank_name} {a.account_number}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="text-2xl font-semibold tabular-nums text-slate-900">{money(a.balance)}</p>
                  <div className="flex gap-4 mt-1 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <ArrowDownLeft size={12} className="text-emerald-600" /> {money(a.money_in)}
                    </span>
                    <span className="flex items-center gap-1">
                      <ArrowUpRight size={12} className="text-rose-600" /> {money(a.money_out)}
                    </span>
                  </div>
                </div>

                {can('settings.write') && (
                  <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                    <button className="btn-secondary text-xs flex-1" onClick={() => setDetail(a.id)}>
                      Movements
                    </button>
                    <button className="btn-secondary text-xs" onClick={() => setEditing(a)}>Edit</button>
                    <ConfirmButton className="btn-ghost p-2 text-rose-600" message="Remove?"
                      onConfirm={async () => {
                        const res = await api.del(`/api/accounts/${a.id}`);
                        toast.success(res.message || 'Account removed');
                        load();
                      }}>
                      <Trash2 size={14} />
                    </ConfirmButton>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <AccountModal account={editing} locations={locations}
          onClose={() => setEditing(null)} onSave={save} />
      )}
      {detail && <AccountDetail id={detail} onClose={() => setDetail(null)} />}
      {mapping && (
        <MappingModal accounts={data.accounts} current={data.method_defaults}
          onClose={() => setMapping(false)}
          onSaved={() => { setMapping(false); load(); }} />
      )}
    </>
  );
}

function AccountModal({ account, locations, onClose, onSave }) {
  const [form, setForm] = useState({
    name: '', type: 'bank', account_number: '', bank_name: '',
    opening_balance: 0, location_id: '', is_default: false, notes: '', ...account,
  });
  const set = (k) => (e) =>
    setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <Modal open onClose={onClose} title={account.id ? 'Edit account' : 'New payment account'} size="sm"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave(form)}>Save</button></>}>
      <div className="space-y-3">
        <Field label="Account name" hint="What staff will call it — “Cash till”, “GTBank current”, “Moniepoint”">
          <input className="input" value={form.name} onChange={set('name')} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className="input" value={form.type} onChange={set('type')}>
              <option value="cash">Cash / till</option>
              <option value="bank">Bank account</option>
              <option value="mobile_money">Mobile money wallet</option>
              <option value="card_terminal">Card terminal settlement</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Location" hint="Leave blank if it serves every shop">
            <select className="input" value={form.location_id || ''} onChange={set('location_id')}>
              <option value="">All locations</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
        </div>
        {form.type !== 'cash' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bank / provider">
              <input className="input" value={form.bank_name || ''} onChange={set('bank_name')} />
            </Field>
            <Field label="Account number">
              <input className="input font-mono" value={form.account_number || ''}
                onChange={set('account_number')} />
            </Field>
          </div>
        )}
        <Field label="Opening balance"
          hint="What is in it today. Every payment and expense is added to this.">
          <input type="number" className="input" value={form.opening_balance}
            onChange={set('opening_balance')} />
        </Field>
        <Field label="Notes">
          <input className="input" value={form.notes || ''} onChange={set('notes')} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="rounded border-slate-300"
            checked={!!form.is_default} onChange={set('is_default')} />
          Default account for payments with no other mapping
        </label>
      </div>
    </Modal>
  );
}

function AccountDetail({ id, onClose }) {
  const [account, setAccount] = useState(null);
  useEffect(() => { api.get(`/api/accounts/${id}`).then(setAccount).catch(() => {}); }, [id]);

  if (!account) return <Modal open onClose={onClose} title="Account"><Loading /></Modal>;

  return (
    <Modal open onClose={onClose} size="lg" title={account.name}
      subtitle={`${labelize(account.type)}${account.bank_name ? ` · ${account.bank_name}` : ''}`}
      footer={<button className="btn-primary" onClick={onClose}>Close</button>}>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label="Balance" value={money(account.balance)} />
        <Stat label="Money in" value={money(account.money_in)} tone="good" />
        <Stat label="Money out" value={money(account.money_out)} tone="warn" />
      </div>

      {account.recent?.length === 0 ? (
        <Empty title="No movements yet" hint="Payments and expenses assigned to this account appear here." />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>When</th><th>Type</th><th>Document</th><th>Reference</th>
              <th>By</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {account.recent.map((m) => (
                <tr key={`${m.kind}-${m.id}`}>
                  <td className="text-xs text-slate-500 whitespace-nowrap">{dateTime(m.created_at)}</td>
                  <td><Badge>{labelize(m.method)}</Badge></td>
                  <td className="font-mono text-xs">{m.document || '—'}</td>
                  <td className="text-xs text-slate-500">{m.reference || '—'}</td>
                  <td className="text-sm text-slate-600">{m.user_name || '—'}</td>
                  <td className={`text-right tabular-nums font-medium ${
                    Number(m.amount) < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {money(m.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function MappingModal({ accounts, current, onClose, onSaved }) {
  const toast = useToast();
  const [map, setMap] = useState(() => {
    const m = {};
    TENDERS.forEach((t) => {
      m[t] = current.find((c) => c.method === t)?.account_id || '';
    });
    return m;
  });

  const save = async () => {
    try {
      await api.put('/api/accounts/method-defaults', { mapping: map });
      toast.success('Tender defaults saved');
      onSaved();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <Modal open onClose={onClose} title="Where each tender lands" size="sm"
      subtitle="A cashier never has to choose — the payment goes to the right account automatically."
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save}>Save</button></>}>
      <div className="space-y-3">
        {TENDERS.map((t) => (
          <Field key={t} label={labelize(t)}>
            <select className="input" value={map[t]}
              onChange={(e) => setMap({ ...map, [t]: e.target.value })}>
              <option value="">Use the default account</option>
              {accounts.filter((a) => a.is_active).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
        ))}
      </div>
    </Modal>
  );
}
