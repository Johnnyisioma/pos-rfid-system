import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen, Scale, Building2, TrendingUp, Plus, Trash2, ListTree, FileText,
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, date, today } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, useToast, Field, Spinner, Tabs, Stat,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTabParam } from '../lib/useTabParam.js';

/**
 * Accounting — the chart of accounts, the journal, and the three statements
 * that come straight out of the ledger. Every sale, purchase and expense has
 * already posted itself here, so these screens read the books rather than
 * recomputing them.
 */
export default function Accounting() {
  const { can } = useAuth();
  const [tab, setTab] = useTabParam('coa');
  const tabs = [
    { value: 'coa', label: 'Chart of accounts' },
    { value: 'journal', label: 'Journal' },
    { value: 'trial', label: 'Trial balance' },
    { value: 'balance', label: 'Balance sheet' },
    { value: 'pl', label: 'Profit & loss' },
  ];
  return (
    <>
      <PageHeader title="Accounting"
        subtitle="Double-entry ledger — chart of accounts, journal and financial statements" />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'coa' && <ChartOfAccounts can={can} />}
      {tab === 'journal' && <Journal can={can} />}
      {tab === 'trial' && <TrialBalance />}
      {tab === 'balance' && <BalanceSheet />}
      {tab === 'pl' && <ProfitLoss />}
    </>
  );
}

const TYPE_TONE = { asset: 'info', liability: 'warning', equity: 'default', income: 'success', expense: 'danger' };

/* ───────────────────────── chart of accounts ───────────────────────── */
function ChartOfAccounts({ can }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api.get('/api/accounting/accounts?all=1').then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    try {
      if (form.id) await api.put(`/api/accounting/accounts/${form.id}`, form);
      else await api.post('/api/accounting/accounts', form);
      toast.success('Account saved'); setEditing(null); load();
    } catch (e) { toast.error(e.message); }
  };
  if (!rows) return <Loading />;
  const groups = ['asset', 'liability', 'equity', 'income', 'expense'];
  return (
    <Card bodyClass="p-0" title="Chart of accounts"
      subtitle="The five roots of the ledger. Rename freely; the seeded system accounts cannot be deleted."
      actions={can('accounts.journal') && (
        <button className="btn-primary text-xs" onClick={() => setEditing({ type: 'expense' })}>
          <Plus size={14} /> New account</button>)}>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Code</th><th>Account</th><th>Type</th>
            <th className="text-right">Balance</th><th></th></tr></thead>
          <tbody>
            {groups.map((g) => {
              const inGroup = rows.filter((a) => a.type === g);
              if (!inGroup.length) return null;
              return (
                <>
                  <tr key={g} className="bg-slate-50"><td colSpan={5}
                    className="text-xs font-semibold uppercase tracking-wide text-slate-500 py-1.5">{g}</td></tr>
                  {inGroup.map((a) => (
                    <tr key={a.id} className={a.is_active ? '' : 'opacity-50'}>
                      <td className="font-mono text-sm">{a.code}</td>
                      <td>{a.name}{a.is_system && <Badge className="ml-2" status="default">system</Badge>}</td>
                      <td><Badge status={TYPE_TONE[a.type]}>{a.type}</Badge></td>
                      <td className="text-right tabular-nums">{money(a.balance)}</td>
                      <td className="text-right">{can('accounts.journal') && (
                        <button className="btn-ghost text-xs" onClick={() => setEditing(a)}>Edit</button>)}</td>
                    </tr>
                  ))}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
      {editing && <AccountModal row={editing} onClose={() => setEditing(null)} onSave={save} />}
    </Card>
  );
}

function AccountModal({ row, onClose, onSave }) {
  const [f, setF] = useState({ type: 'expense', is_active: true, ...row });
  return (
    <Modal open onClose={onClose} size="sm" title={row.id ? 'Edit account' : 'New account'}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave(f)}>Save</button></>}>
      <div className="space-y-3">
        {!row.id && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code"><input className="input font-mono" value={f.code || ''}
              onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="6100" autoFocus /></Field>
            <Field label="Type">
              <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                {['asset', 'liability', 'equity', 'income', 'expense'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>)}
        <Field label="Name"><input className="input" value={f.name || ''}
          onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Transport" /></Field>
        <Field label="Description"><input className="input" value={f.description || ''}
          onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        {row.id && !row.is_system && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!f.is_active}
              onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Active</label>)}
      </div>
    </Modal>
  );
}

/* ───────────────────────── journal ───────────────────────── */
function Journal({ can }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [posting, setPosting] = useState(false);
  const load = useCallback(() => api.get('/api/accounting/journal?limit=100').then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <Loading />;
  return (
    <>
      <div className="flex mb-3">
        {can('accounts.journal') && (
          <button className="btn-primary ml-auto text-sm" onClick={() => setPosting(true)}>
            <Plus size={14} /> Manual entry</button>)}
      </div>
      <Card bodyClass="p-0">
        {rows.length === 0
          ? <Empty icon={BookOpen} title="No journal entries yet"
              hint="Sales, purchases and expenses post here automatically." />
          : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Entry</th><th>Date</th><th>Memo</th><th>Source</th>
                  <th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} className="cursor-pointer" onClick={() => setOpen(e.id)}>
                      <td className="font-mono text-sm">{e.ref}</td>
                      <td className="text-sm">{date(e.entry_date)}</td>
                      <td className="text-sm">{e.memo}</td>
                      <td><Badge status="default">{e.source_type}</Badge></td>
                      <td className="text-right tabular-nums">{money(e.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>)}
      </Card>
      {open && <EntryDetail id={open} onClose={() => setOpen(null)} />}
      {posting && <ManualEntry onClose={() => setPosting(false)}
        onDone={() => { setPosting(false); load(); }} />}
    </>
  );
}

function EntryDetail({ id, onClose }) {
  const [e, setE] = useState(null);
  useEffect(() => { api.get(`/api/accounting/journal/${id}`).then(setE).catch(() => {}); }, [id]);
  return (
    <Modal open onClose={onClose} size="md" title={e ? e.ref : 'Entry'}
      subtitle={e ? `${date(e.entry_date)} · ${e.memo}` : ''}>
      {!e ? <Loading /> : (
        <div className="rounded-lg ring-1 ring-slate-200 overflow-hidden">
          <table className="data">
            <thead><tr><th>Account</th><th className="text-right">Debit</th>
              <th className="text-right">Credit</th></tr></thead>
            <tbody>
              {e.lines.map((l) => (
                <tr key={l.id}>
                  <td><span className="font-mono text-xs text-slate-500">{l.code}</span> {l.account_name}</td>
                  <td className="text-right tabular-nums">{Number(l.debit) ? money(l.debit) : ''}</td>
                  <td className="text-right tabular-nums">{Number(l.credit) ? money(l.credit) : ''}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td>Total</td>
                <td className="text-right tabular-nums">{money(e.lines.reduce((s, l) => s + Number(l.debit), 0))}</td>
                <td className="text-right tabular-nums">{money(e.lines.reduce((s, l) => s + Number(l.credit), 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function ManualEntry({ onClose, onDone }) {
  const toast = useToast();
  const [accounts, setAccounts] = useState([]);
  const [memo, setMemo] = useState('');
  const [entryDate, setEntryDate] = useState(today());
  const [lines, setLines] = useState([{ account_id: '', debit: '', credit: '' }, { account_id: '', debit: '', credit: '' }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/api/accounting/accounts').then(setAccounts).catch(() => {}); }, []);
  const setLine = (i, patch) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const totalDr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = totalDr > 0 && Math.abs(totalDr - totalCr) < 0.005;

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/api/accounting/journal', {
        memo, entry_date: entryDate,
        lines: lines.filter((l) => l.account_id && (Number(l.debit) || Number(l.credit))),
      });
      toast.success('Entry posted'); onDone();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} size="lg" title="Manual journal entry"
      footer={<>
        <span className={`mr-auto text-sm ${balanced ? 'text-emerald-700' : 'text-slate-500'}`}>
          Dr {money(totalDr)} · Cr {money(totalCr)} {balanced ? '· balanced' : '· must balance'}</span>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy || !balanced}>
          {busy ? <Spinner /> : null} Post</button></>}>
      <div className="grid sm:grid-cols-3 gap-3 mb-3">
        <Field label="Date"><input type="date" className="input" value={entryDate}
          onChange={(e) => setEntryDate(e.target.value)} /></Field>
        <Field label="Memo" className="sm:col-span-2"><input className="input" value={memo}
          onChange={(e) => setMemo(e.target.value)} placeholder="What this entry is for" /></Field>
      </div>
      <div className="rounded-lg ring-1 ring-slate-200 overflow-hidden">
        <table className="data">
          <thead><tr><th>Account</th><th className="text-right w-32">Debit</th>
            <th className="text-right w-32">Credit</th><th className="w-8"></th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <select className="input py-1" value={l.account_id}
                    onChange={(e) => setLine(i, { account_id: e.target.value })}>
                    <option value="">—</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                  </select>
                </td>
                <td><input type="number" className="input py-1 text-right" value={l.debit}
                  onChange={(e) => setLine(i, { debit: e.target.value, credit: '' })} /></td>
                <td><input type="number" className="input py-1 text-right" value={l.credit}
                  onChange={(e) => setLine(i, { credit: e.target.value, debit: '' })} /></td>
                <td>{lines.length > 2 && <button className="btn-ghost p-1 text-rose-600"
                  onClick={() => setLines((p) => p.filter((_, x) => x !== i))}><Trash2 size={13} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn-ghost text-xs mt-2"
        onClick={() => setLines((p) => [...p, { account_id: '', debit: '', credit: '' }])}>
        <Plus size={13} /> Add line</button>
    </Modal>
  );
}

/* ───────────────────────── trial balance ───────────────────────── */
function TrialBalance() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/api/accounting/trial-balance').then(setData).catch(() => setData(null)); }, []);
  if (!data) return <Loading />;
  return (
    <Card bodyClass="p-0" title="Trial balance"
      subtitle="Every account on its normal side. The two totals being equal is the proof the books are sound.">
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Code</th><th>Account</th>
            <th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
          <tbody>
            {data.accounts.filter((a) => a.debit || a.credit).map((a) => (
              <tr key={a.id}>
                <td className="font-mono text-sm">{a.code}</td>
                <td>{a.name}</td>
                <td className="text-right tabular-nums">{a.debit ? money(a.debit) : ''}</td>
                <td className="text-right tabular-nums">{a.credit ? money(a.credit) : ''}</td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-semibold">
              <td colSpan={2}>Total {data.balanced
                ? <Badge status="success" className="ml-2">balanced</Badge>
                : <Badge status="danger" className="ml-2">out of balance</Badge>}</td>
              <td className="text-right tabular-nums">{money(data.totalDebit)}</td>
              <td className="text-right tabular-nums">{money(data.totalCredit)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ───────────────────────── balance sheet ───────────────────────── */
function BalanceSheet() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/api/accounting/balance-sheet').then(setData).catch(() => setData(null)); }, []);
  if (!data) return <Loading />;
  const Section = ({ title, rows, total }) => (
    <Card title={title} bodyClass="p-0">
      <div className="table-wrap">
        <table className="data">
          <tbody>
            {rows.length === 0 && <tr><td className="text-slate-400 text-sm">Nothing yet</td><td></td></tr>}
            {rows.map((a) => (
              <tr key={a.id}><td>{a.name}</td>
                <td className="text-right tabular-nums">{money(a.balance)}</td></tr>
            ))}
            <tr className="bg-slate-50 font-semibold"><td>{title} total</td>
              <td className="text-right tabular-nums">{money(total)}</td></tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Total assets" value={money(data.totalAssets)} icon={Building2} />
        <Stat label="Liabilities" value={money(data.totalLiabilities)} />
        <Stat label="Equity" value={money(data.totalEquity)} />
        <Stat label="Net profit" value={money(data.netProfit)}
          tone={data.netProfit >= 0 ? 'default' : 'warn'} icon={TrendingUp} />
      </div>
      {!data.balanced && (
        <div className="mb-4 rounded-lg bg-rose-50 ring-1 ring-rose-200 px-4 py-2 text-sm text-rose-800">
          Assets do not equal liabilities plus equity — the ledger is out of balance.
        </div>)}
      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Assets" rows={data.assets} total={data.totalAssets} />
        <div className="space-y-4">
          <Section title="Liabilities" rows={data.liabilities} total={data.totalLiabilities} />
          <Section title="Equity (incl. period profit)" rows={data.equity} total={data.totalEquity} />
        </div>
      </div>
    </>
  );
}

/* ───────────────────────── profit & loss ───────────────────────── */
function ProfitLoss() {
  const [range, setRange] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    api.get(`/api/accounting/income-statement${qs(range)}`).then(setData).catch(() => setData(null));
  }, [range]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <Field label="From"><input type="date" className="input" value={range.from}
          onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></Field>
        <Field label="To"><input type="date" className="input" value={range.to}
          onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></Field>
      </div>
      {!data ? <Loading /> : (
        <>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <Stat label="Income" value={money(data.totalIncome)} tone="good" />
            <Stat label="Expenses" value={money(data.totalExpense)} />
            <Stat label="Net profit" value={money(data.netProfit)}
              tone={data.netProfit >= 0 ? 'good' : 'warn'} />
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Income" bodyClass="p-0">
              <PlTable rows={data.income} total={data.totalIncome} />
            </Card>
            <Card title="Expenses" bodyClass="p-0">
              <PlTable rows={data.expense} total={data.totalExpense} />
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function PlTable({ rows, total }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <tbody>
          {rows.filter((r) => r.amount).length === 0 && (
            <tr><td className="text-slate-400 text-sm">Nothing in this period</td><td></td></tr>)}
          {rows.filter((r) => r.amount).map((r) => (
            <tr key={r.id}><td><span className="font-mono text-xs text-slate-500">{r.code}</span> {r.name}</td>
              <td className="text-right tabular-nums">{money(r.amount)}</td></tr>
          ))}
          <tr className="bg-slate-50 font-semibold"><td>Total</td>
            <td className="text-right tabular-nums">{money(total)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
