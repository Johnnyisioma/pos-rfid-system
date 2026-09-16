import { useEffect, useState, useCallback } from 'react';
import { Calculator, Lock, Unlock, Printer, Banknote } from 'lucide-react';
import { api } from '../lib/api.js';
import { money, num, dateTime, labelize } from '../lib/format.js';
import { Card, Loading, Empty, Badge, Modal, useToast, Field, Stat, Spinner } from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';

export default function Register() {
  const { locationId, location, user, can } = useAuth();
  const toast = useToast();
  const [registers, setRegisters] = useState(null);
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [opening, setOpening] = useState(null);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [regs, cur, hist] = await Promise.all([
      api.get('/api/registers').catch(() => []),
      api.get('/api/registers/sessions/current').catch(() => null),
      api.get('/api/registers/sessions').catch(() => []),
    ]);
    setRegisters(regs); setCurrent(cur); setHistory(hist);
  }, [locationId]);

  useEffect(() => { load(); }, [load]);

  const open = async (registerId, cash, notes) => {
    setBusy(true);
    try {
      await api.post(`/api/registers/${registerId}/open`, { opening_cash: Number(cash), notes });
      toast.success('Register opened');
      setOpening(null);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const close = async (counted, notes) => {
    setBusy(true);
    try {
      const res = await api.post(`/api/registers/sessions/${current.id}/close`, {
        counted_cash: Number(counted), notes });
      const diff = Number(res.difference);
      toast[diff === 0 ? 'success' : 'info'](
        diff === 0 ? 'Till balanced exactly' :
          `${diff > 0 ? 'Over' : 'Short'} by ${money(Math.abs(diff))}`);
      setClosing(false);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  if (!registers) return <Loading />;

  return (
    <>
      <PageHeader title="Cash register"
        subtitle={`Open and close the till at ${location?.name || 'this shop'}, and reconcile the cash`} />

      {current ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <Stat label="Opening float" value={money(current.opening_cash)} icon={Banknote} />
            <Stat label="Cash taken" value={money(current.cash_in)} />
            <Stat label="Expected in drawer" value={money(current.expected_cash)} tone="good" />
            <Stat label="Sales this shift" value={money(current.sales.total)}
              sub={`${num(current.sales.count)} orders`} />
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <Card title={`${current.register_name} — open`} className="lg:col-span-1"
              subtitle={`Opened ${dateTime(current.opened_at)} by ${current.user_name}`}>
              <dl className="text-sm space-y-1.5">
                <Row label="Opening float" value={money(current.opening_cash)} />
                <Row label="Cash payments" value={money(current.cash_in)} />
                <Row label="Change given" value={`− ${money(current.sales.change_given)}`} />
                <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold">
                  <dt>Expected cash</dt><dd className="tabular-nums">{money(current.expected_cash)}</dd>
                </div>
                <Row label="Refunds issued" value={money(current.refunds.total)} muted />
                <Row label="Discounts given" value={money(current.sales.discounts)} muted />
                <Row label="VAT collected" value={money(current.sales.tax)} muted />
              </dl>
              {can('register.close') && (
                <button className="btn-primary w-full mt-4" onClick={() => setClosing(true)}>
                  <Lock size={16} /> Close the till
                </button>
              )}
            </Card>

            <Card title="Takings by payment method" className="lg:col-span-2" bodyClass="p-0">
              {current.by_method.length === 0 ? <Empty title="No payments taken yet this shift" /> : (
                <table className="data">
                  <thead><tr><th>Method</th><th className="text-right">Transactions</th>
                    <th className="text-right">Amount</th></tr></thead>
                  <tbody>
                    {current.by_method.map((m) => (
                      <tr key={m.method}>
                        <td><Badge>{labelize(m.method)}</Badge></td>
                        <td className="text-right tabular-nums">{num(m.count)}</td>
                        <td className="text-right tabular-nums font-medium">{money(m.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      ) : (
        <Card title="No open session">
          <p className="text-sm text-slate-600 mb-4">
            Open a register to start taking payments. Sales are linked to the open session so the
            end-of-shift reconciliation adds up.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {registers.map((r) => (
              <div key={r.id} className="rounded-xl ring-1 ring-slate-200 p-4">
                <p className="font-medium text-slate-800">{r.name}</p>
                <p className="text-xs text-slate-500 mb-3">{r.location_name}</p>
                {r.open_session ? (
                  <Badge status="open">
                    In use by {r.open_session.user_name}
                  </Badge>
                ) : can('register.open') ? (
                  <button className="btn-primary w-full" onClick={() => setOpening(r)}>
                    <Unlock size={15} /> Open
                  </button>
                ) : <Badge>Closed</Badge>}
              </div>
            ))}
            {registers.length === 0 && (
              <p className="text-sm text-slate-500">No registers configured — add one under Settings.</p>
            )}
          </div>
        </Card>
      )}

      <Card title="Recent shifts" className="mt-4" bodyClass="p-0">
        {history.length === 0 ? <Empty title="No shifts recorded yet" icon={Calculator} /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Register</th><th>Staff</th><th>Opened</th><th>Closed</th>
                <th className="text-right">Float</th><th className="text-right">Expected</th>
                <th className="text-right">Counted</th><th className="text-right">Difference</th></tr></thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">{s.register_name}</td>
                    <td className="text-slate-600">{s.user_name || '—'}</td>
                    <td className="text-xs text-slate-500 whitespace-nowrap">{dateTime(s.opened_at)}</td>
                    <td className="text-xs text-slate-500 whitespace-nowrap">
                      {s.closed_at ? dateTime(s.closed_at) : <Badge status="open">Open</Badge>}
                    </td>
                    <td className="text-right tabular-nums">{money(s.opening_cash)}</td>
                    <td className="text-right tabular-nums">{s.expected_cash == null ? '—' : money(s.expected_cash)}</td>
                    <td className="text-right tabular-nums">{s.counted_cash == null ? '—' : money(s.counted_cash)}</td>
                    <td className={`text-right tabular-nums font-medium ${
                      s.difference == null ? '' : Number(s.difference) === 0 ? 'text-emerald-600'
                        : Number(s.difference) < 0 ? 'text-rose-600' : 'text-amber-600'}`}>
                      {s.difference == null ? '—' : `${Number(s.difference) > 0 ? '+' : ''}${money(s.difference)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {opening && <OpenModal register={opening} busy={busy} onClose={() => setOpening(null)}
        onSubmit={(cash, notes) => open(opening.id, cash, notes)} />}
      {closing && current && <CloseModal session={current} busy={busy}
        onClose={() => setClosing(false)} onSubmit={close} />}
    </>
  );
}

const Row = ({ label, value, muted }) => (
  <div className={`flex justify-between ${muted ? 'text-slate-500' : 'text-slate-700'}`}>
    <dt>{label}</dt><dd className="tabular-nums">{value}</dd>
  </div>
);

function OpenModal({ register, onClose, onSubmit, busy }) {
  const [cash, setCash] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <Modal open onClose={onClose} title={`Open ${register.name}`} size="sm"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={() => onSubmit(cash || 0, notes)}>
          {busy ? <Spinner /> : <Unlock size={16} />} Open till
        </button></>}>
      <Field label="Opening cash float" hint="Count the drawer before you start serving.">
        <input type="number" className="input" value={cash} autoFocus
          onChange={(e) => setCash(e.target.value)} placeholder="0" />
      </Field>
      <Field label="Notes" className="mt-3">
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}

function CloseModal({ session, onClose, onSubmit, busy }) {
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const diff = counted === '' ? null : Number(counted) - Number(session.expected_cash);
  return (
    <Modal open onClose={onClose} title="Close the till" size="sm"
      subtitle={`${session.register_name} · opened ${dateTime(session.opened_at)}`}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || counted === ''} onClick={() => onSubmit(counted, notes)}>
          {busy ? <Spinner /> : <Lock size={16} />} Close & reconcile
        </button></>}>
      <dl className="text-sm space-y-1.5 mb-4 rounded-lg bg-slate-50 p-3">
        <Row label="Opening float" value={money(session.opening_cash)} />
        <Row label="Cash taken" value={money(session.cash_in)} />
        <Row label="Change given" value={`− ${money(session.sales.change_given)}`} />
        <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold">
          <dt>Expected in drawer</dt><dd className="tabular-nums">{money(session.expected_cash)}</dd>
        </div>
      </dl>

      <Field label="Cash actually counted">
        <input type="number" className="input text-lg" value={counted} autoFocus
          onChange={(e) => setCounted(e.target.value)} placeholder="0" />
      </Field>

      {diff !== null && (
        <div className={`mt-3 rounded-lg p-3 text-sm ${
          diff === 0 ? 'bg-emerald-50 text-emerald-900'
            : diff < 0 ? 'bg-rose-50 text-rose-900' : 'bg-amber-50 text-amber-900'}`}>
          {diff === 0 ? 'The till balances exactly.'
            : `${diff > 0 ? 'Over' : 'Short'} by ${money(Math.abs(diff))} — add a note explaining why.`}
        </div>
      )}

      <Field label="Notes" className="mt-3">
        <textarea className="input" rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}
