import { useCallback, useEffect, useState } from 'react';
import {
  Percent, Plus, TrendingUp, TrendingDown, Banknote, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, num, dateTime } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, useToast, Field, Spinner, Stat, Tabs, Pagination, FeatureOff,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTabParam } from '../lib/useTabParam.js';

/**
 * Sales-rep commission.
 *
 * Shown as a ledger rather than a total, because the total on its own is the
 * number people argue about. Earned, clawed back and paid are three separate
 * facts, and a rep asking "why is it less than last month" is asking which of
 * the three moved.
 */
export default function Commissions() {
  const { feature, settings } = useAuth();
  const [tab, setTab] = useTabParam('ledger');

  // Wait for the settings to arrive before deciding. feature() answers "on"
  // while it does not yet know, which is right for the menu — better than the
  // whole sidebar flickering — but here it would fire a request the server is
  // about to refuse.
  if (!settings) return <Loading />;

  // The menu already hides this, and the API refuses it. A bookmarked URL
  // still lands here, and an empty page with a 403 in the console looks like a
  // fault rather than a setting somebody chose.
  if (!feature('commissions')) {
    return <FeatureOff title="Commission" 
      hint="Turn it on, set a rule, and the till starts asking who served the customer." />;
  }

  return (
    <>
      <PageHeader title="Commission"
        subtitle="What each rep has earned, what came back with a return, and what has been paid" />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'ledger', label: 'Ledger' },
        { value: 'rules', label: 'Rules' },
      ]} />
      {tab === 'ledger' ? <Ledger /> : <Rules />}
    </>
  );
}

function Ledger() {
  const toast = useToast();
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [range, setRange] = useState({ from: '', to: '' });
  const [paying, setPaying] = useState(null);

  const load = useCallback(async () => {
    try { setData(await api.get(`/api/commissions${qs({ page, ...range })}`)); }
    catch { setData({ data: [], summary: [] }); }
  }, [page, range]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <Loading />;

  const owed = data.summary.reduce((s, x) => s + Number(x.owed), 0);

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Outstanding to reps" value={money(owed)} icon={Banknote}
          tone={owed > 0 ? 'warn' : 'good'} />
        <Stat label="Earned"
          value={money(data.summary.reduce((s, x) => s + Number(x.earned), 0))} tone="good" />
        <Stat label="Clawed back"
          value={money(data.summary.reduce((s, x) => s + Number(x.clawed_back), 0))} tone="bad" />
        <Stat label="Paid out"
          value={money(-data.summary.reduce((s, x) => s + Number(x.paid), 0))} />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <input type="date" className="input w-auto" value={range.from}
          onChange={(e) => { setRange((r) => ({ ...r, from: e.target.value })); setPage(1); }} />
        <input type="date" className="input w-auto" value={range.to}
          onChange={(e) => { setRange((r) => ({ ...r, to: e.target.value })); setPage(1); }} />
        {(range.from || range.to) && (
          <button className="btn-ghost text-xs" onClick={() => { setRange({ from: '', to: '' }); setPage(1); }}>
            Clear
          </button>
        )}
      </div>

      <Card className="mb-4" bodyClass="p-0" title="By person">
        {data.summary.length === 0 ? (
          <Empty title="Nothing earned yet" icon={Percent}
            hint="Set a rule, then name a rep when ringing up a sale." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Rep</th><th className="text-right">Earned</th>
                <th className="text-right">Clawed back</th><th className="text-right">Paid</th>
                <th className="text-right">Owed</th><th /></tr></thead>
              <tbody>
                {data.summary.map((s) => (
                  <tr key={s.user_id}>
                    <td className="font-medium">{s.user_name}</td>
                    <td className="text-right tabular-nums text-emerald-700">{money(s.earned)}</td>
                    <td className="text-right tabular-nums text-rose-700">{money(s.clawed_back)}</td>
                    <td className="text-right tabular-nums text-slate-500">{money(-s.paid)}</td>
                    <td className="text-right tabular-nums font-semibold">{money(s.owed)}</td>
                    <td className="text-right">
                      {can('commissions.write') && Number(s.owed) > 0 && (
                        <button className="btn-ghost text-xs" onClick={() => setPaying(s)}>
                          Pay out
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card bodyClass="p-0" title="Every movement"
        subtitle="A return writes a negative row rather than editing the original — that is what makes this explainable">
        {data.data.length === 0 ? (
          <Empty title="No entries" icon={Percent} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>When</th><th>Rep</th><th>Reference</th><th>Rule</th>
                  <th className="text-right">On</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {data.data.map((e) => (
                    <tr key={e.id}>
                      <td className="text-xs text-slate-500 whitespace-nowrap">{dateTime(e.created_at)}</td>
                      <td>{e.user_name}</td>
                      <td className="text-xs">
                        {e.invoice_no && <span className="font-mono">{e.invoice_no}</span>}
                        {e.return_ref && <span className="font-mono text-rose-600"> {e.return_ref}</span>}
                        {!e.invoice_no && !e.return_ref && <span className="text-slate-400">—</span>}
                      </td>
                      <td className="text-xs text-slate-500">{e.rule_name || '—'}</td>
                      <td className="text-right tabular-nums text-slate-500">{money(e.basis_amount)}</td>
                      <td className={`text-right tabular-nums font-medium ${
                        Number(e.amount) < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {Number(e.amount) < 0
                          ? <TrendingDown size={12} className="inline mr-1 -mt-0.5" />
                          : <TrendingUp size={12} className="inline mr-1 -mt-0.5" />}
                        {money(e.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} limit={data.limit} total={null} onPage={setPage} />
          </>
        )}
      </Card>

      {paying && (
        <PayoutModal row={paying} onClose={() => setPaying(null)}
          onDone={() => { setPaying(null); load(); }} />
      )}
    </>
  );
}

function PayoutModal({ row, onClose, onDone }) {
  const toast = useToast();
  const [amount, setAmount] = useState(String(Number(row.owed)));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/api/commissions/pay',
        { user_id: row.user_id, amount: Number(amount), note });
      toast.success(`Paid ${money(amount)} to ${row.user_name}`);
      onDone();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} size="sm" title={`Pay ${row.user_name}`}
      subtitle={`${money(row.owed)} outstanding`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !(Number(amount) > 0)}>
            {busy ? <Spinner /> : <Banknote size={16} />} Record payout
          </button>
        </>
      }>
      <Field label="Amount"><input className="input" type="number" autoFocus value={amount}
        onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Note" className="mt-3"><input className="input" value={note}
        onChange={(e) => setNote(e.target.value)} placeholder="September payout" /></Field>
      <p className="text-xs text-slate-500 mt-3">
        This records the payment against the ledger. It does not move money — put the cash
        through Expenses if it came out of the till.
      </p>
    </Modal>
  );
}

function Rules() {
  const toast = useToast();
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = () => api.get('/api/commissions/rules').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const toggle = async (rule) => {
    try {
      await api.put(`/api/commissions/rules/${rule.id}`, { is_active: !rule.is_active });
      load();
    } catch (e) { toast.error(e.message); }
  };

  if (!rows) return <Loading />;

  return (
    <>
      <Card bodyClass="p-0" title="Rules"
        subtitle="Only one rule pays per line — the most specific match wins, so schemes cannot stack"
        actions={can('commissions.write') && (
          <button className="btn-primary text-xs" onClick={() => setAdding(true)}>
            <Plus size={14} /> New rule
          </button>
        )}>
        {rows.length === 0 ? (
          <Empty title="No rules yet" icon={Percent}
            hint="Nothing accrues until there is a rule to accrue against." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Name</th><th>Applies to</th><th>Basis</th>
                <th className="text-right">Rate</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{r.name}</td>
                    <td className="text-sm text-slate-600">
                      {r.user_name ? `${r.user_name} only` : 'Every rep'}
                      {r.scope !== 'all' && <span className="text-slate-400"> · {r.scope}</span>}
                    </td>
                    <td><Badge>{r.basis}</Badge></td>
                    <td className="text-right tabular-nums">
                      {r.basis === 'unit' ? money(r.rate) : `${Number(r.rate)}%`}
                    </td>
                    <td><Badge status={r.is_active ? 'completed' : 'cancelled'}>
                      {r.is_active ? 'Active' : 'Off'}</Badge></td>
                    <td className="text-right">
                      {can('commissions.write') && (
                        <button className="btn-ghost text-xs" onClick={() => toggle(r)}>
                          {r.is_active
                            ? <><ToggleRight size={14} /> Turn off</>
                            : <><ToggleLeft size={14} /> Turn on</>}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {adding && <RuleModal onClose={() => setAdding(false)}
        onDone={() => { setAdding(false); load(); }} />}
    </>
  );
}

function RuleModal({ onClose, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', basis: 'revenue', rate: '', user_id: '' });
  const [staff, setStaff] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/api/users').then(setStaff).catch(() => setStaff([])); }, []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/api/commissions/rules', {
        ...form, rate: Number(form.rate), user_id: form.user_id || null });
      toast.success('Rule saved');
      onDone();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} size="sm" title="New commission rule"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !(Number(form.rate) > 0)}>
            {busy ? <Spinner /> : null} Save rule
          </button>
        </>
      }>
      <Field label="Name"><input className="input" autoFocus value={form.name}
        onChange={(e) => set({ name: e.target.value })} placeholder="Standard 5%" /></Field>

      <Field label="Paid on" className="mt-3"
        hint="Profit is the honest one — a 10% discount should not cost the shop 10% and still pay full commission">
        <select className="input" value={form.basis} onChange={(e) => set({ basis: e.target.value })}>
          <option value="revenue">Revenue — a share of the line total</option>
          <option value="profit">Profit — a share of what the line actually made</option>
          <option value="unit">Per item sold — a flat amount each</option>
        </select>
      </Field>

      <Field label={form.basis === 'unit' ? 'Amount per item' : 'Percentage'} className="mt-3">
        <input className="input" type="number" value={form.rate}
          onChange={(e) => set({ rate: e.target.value })}
          placeholder={form.basis === 'unit' ? '500' : '5'} />
      </Field>

      <Field label="Who it applies to" className="mt-3">
        <select className="input" value={form.user_id} onChange={(e) => set({ user_id: e.target.value })}>
          <option value="">Every rep</option>
          {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </Field>
    </Modal>
  );
}
