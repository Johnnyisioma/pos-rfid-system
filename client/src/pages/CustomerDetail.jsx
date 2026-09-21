import { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, Star, Wallet, CreditCard, Receipt, Plus, Minus, Radio, Square, Ban, ShieldCheck, Clock,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { money, num, date, dateTime, labelize } from '../lib/format.js';
import { Card, Loading, Empty, Badge, Stat, Modal, useToast, Field, Tabs } from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useRfidScan } from '../lib/useRfidScan.jsx';
import { CustomerModal } from './Customers.jsx';

export default function CustomerDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const [c, setC] = useState(null);
  const [groups, setGroups] = useState([]);
  const [tab, setTab] = useState('sales');
  const [modal, setModal] = useState(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() =>
    api.get(`/api/customers/${id}`).then(setC).catch((e) => toast.error(e.message)), [id]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/api/catalog').then((x) => setGroups(x.customerGroups)).catch(() => {}); }, []);

  if (!c) return <Loading />;

  const action = async (path, body, message) => {
    try {
      await api.post(`/api/customers/${id}/${path}`, body);
      toast.success(message);
      setModal(null);
      load();
    } catch (e) { toast.error(e.message); }
  };

  const unblock = async () => {
    try {
      await api.post(`/api/customers/${id}/credit-block`, { blocked: false });
      toast.success('Credit unblocked'); load();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <>
      <PageHeader title={c.name}
        subtitle={[c.phone, c.email, c.group_name].filter(Boolean).join(' · ') || 'No contact details'}
        actions={
          <>
            <Link to="/customers" className="btn-secondary"><ArrowLeft size={16} /> Back</Link>
            {can('customers.write') && (
              <>
                <button className="btn-secondary" onClick={() => setEditing(true)}>Edit</button>
                <button className="btn-secondary" onClick={() => setModal('card')}>
                  <Radio size={16} /> {c.rfid_card_epc ? 'Card linked' : 'Link card'}
                </button>
                {Number(c.balance) > 0 && (
                  <button className="btn-primary" onClick={() => setModal('payment')}>
                    <CreditCard size={16} /> Take payment
                  </button>
                )}
                {can('customers.credit') && (
                  c.credit_blocked ? (
                    <button className="btn-secondary" onClick={() => unblock()}>
                      <ShieldCheck size={16} /> Unblock credit
                    </button>
                  ) : (
                    <button className="btn-secondary" onClick={() => setModal('block')}>
                      <Ban size={16} /> Block credit
                    </button>
                  )
                )}
              </>
            )}
          </>
        } />

      {c.credit_blocked && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-rose-50 ring-1 ring-rose-200 px-4 py-3 text-sm text-rose-800">
          <Ban size={16} />
          <span className="font-medium">Credit blocked.</span>
          <span>{c.credit_block_reason || 'This customer cannot buy on credit until cleared.'}</span>
        </div>
      )}
      {!c.credit_blocked && Number(c.payment_term_days) > 0 && (
        <div className="mb-4 flex items-center gap-2 text-xs text-slate-500">
          <Clock size={13} /> Credit sales are Net-{c.payment_term_days}: due {c.payment_term_days} days after purchase.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Lifetime value"
          value={money(c.sales.reduce((s, x) => s + Number(x.total), 0))}
          sub={`${c.sales.length} orders`} icon={Receipt} />
        <Stat label="Loyalty points" value={num(c.loyalty_points)} icon={Star} />
        <Stat label="Store credit" value={money(c.store_credit)} icon={Wallet} />
        <Stat label="Owes" value={money(c.balance)} icon={CreditCard}
          tone={Number(c.balance) > 0 ? 'warn' : 'default'}
          sub={Number(c.credit_limit) > 0 ? `Limit ${money(c.credit_limit)}` : 'No credit limit set'} />
      </div>

      {can('customers.write') && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button className="btn-secondary" onClick={() => setModal('credit')}>
            <Wallet size={15} /> Adjust store credit
          </button>
          <button className="btn-secondary" onClick={() => setModal('points')}>
            <Star size={15} /> Adjust loyalty points
          </button>
        </div>
      )}

      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'sales', label: 'Purchases', count: c.sales.length },
        { value: 'products', label: 'What they buy' },
        { value: 'loyalty', label: 'Loyalty history', count: c.loyalty.length },
        { value: 'credit', label: 'Store credit history', count: c.store_credit_history.length },
      ]} />

      <Card bodyClass="p-0">
        {tab === 'sales' && (c.sales.length === 0 ? <Empty title="No purchases yet" /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Invoice</th><th>Location</th><th className="text-right">Items</th>
                <th className="text-right">Total</th><th className="text-right">Balance</th>
                <th>Status</th><th>Date</th></tr></thead>
              <tbody>
                {c.sales.map((s) => (
                  <tr key={s.id}>
                    <td><Link to={`/sales/${s.id}`} className="font-mono text-xs text-brand-700 hover:underline">
                      {s.invoice_no}</Link></td>
                    <td className="text-slate-600">{s.location_name}</td>
                    <td className="text-right tabular-nums">{num(s.item_count)}</td>
                    <td className="text-right tabular-nums">{money(s.total)}</td>
                    <td className={`text-right tabular-nums ${Number(s.balance_due) > 0 ? 'text-amber-700' : ''}`}>
                      {money(s.balance_due)}
                    </td>
                    <td><Badge status={s.status} /></td>
                    <td className="text-xs text-slate-500 whitespace-nowrap">{dateTime(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {tab === 'products' && (c.top_products.length === 0 ? <Empty title="Nothing purchased yet" /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Product</th><th>Variant</th><th className="text-right">Units</th>
                <th className="text-right">Spent</th></tr></thead>
              <tbody>
                {c.top_products.map((p, i) => (
                  <tr key={i}>
                    <td className="font-medium text-slate-800">{p.product_name}</td>
                    <td className="text-slate-600">{p.variant_label || '—'}</td>
                    <td className="text-right tabular-nums">{num(p.qty)}</td>
                    <td className="text-right tabular-nums">{money(p.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {tab === 'loyalty' && (c.loyalty.length === 0 ? <Empty title="No points activity" icon={Star} /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>When</th><th>Type</th><th className="text-right">Points</th></tr></thead>
              <tbody>
                {c.loyalty.map((l) => (
                  <tr key={l.id}>
                    <td className="text-xs text-slate-500">{dateTime(l.created_at)}</td>
                    <td><Badge>{labelize(l.type)}</Badge></td>
                    <td className={`text-right tabular-nums font-medium ${Number(l.points) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {Number(l.points) > 0 ? '+' : ''}{num(l.points)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {tab === 'credit' && (c.store_credit_history.length === 0 ? <Empty title="No store credit activity" icon={Wallet} /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>When</th><th>Type</th><th>Reference</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {c.store_credit_history.map((l) => (
                  <tr key={l.id}>
                    <td className="text-xs text-slate-500">{dateTime(l.created_at)}</td>
                    <td><Badge>{labelize(l.type)}</Badge></td>
                    <td className="text-slate-600 text-xs">{l.reference || '—'}</td>
                    <td className={`text-right tabular-nums font-medium ${Number(l.amount) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {Number(l.amount) > 0 ? '+' : ''}{money(l.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Card>

      {editing && (
        <CustomerModal customer={c} groups={groups} onClose={() => setEditing(false)}
          onSave={async (form) => {
            try { await api.put(`/api/customers/${id}`, form); toast.success('Saved'); setEditing(false); load(); }
            catch (e) { toast.error(e.message); }
          }} />
      )}

      {modal === 'card' && (
        <CardModal customer={c} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />
      )}

      {modal === 'block' && (
        <BlockModal customer={c} onClose={() => setModal(null)}
          onSubmit={(reason) => action('credit-block', { blocked: true, reason }, 'Credit blocked')} />
      )}

      {modal && modal !== 'card' && modal !== 'block' && (
        <AdjustModal kind={modal} customer={c} onClose={() => setModal(null)}
          onSubmit={(body) => {
            if (modal === 'payment') return action('payments', body, 'Payment recorded');
            if (modal === 'credit') return action('store-credit', body, 'Store credit updated');
            return action('loyalty', body, 'Points updated');
          }} />
      )}
    </>
  );
}

function BlockModal({ customer, onClose, onSubmit }) {
  const [reason, setReason] = useState('');
  return (
    <Modal open onClose={onClose} size="sm" title="Block credit" subtitle={customer.name}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-danger" onClick={() => onSubmit(reason)}>
          <Ban size={15} /> Block</button></>}>
      <p className="text-sm text-slate-600 mb-3">
        While blocked, this customer's credit sales are refused at the till. Existing balances are unaffected.
      </p>
      <Field label="Reason" hint="Shown on the customer and in the audit log">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Overdue invoice, disputed balance…" autoFocus />
      </Field>
    </Modal>
  );
}

function AdjustModal({ kind, customer, onClose, onSubmit }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reason, setReason] = useState('');

  const titles = {
    payment: 'Take a payment against the account',
    credit: 'Adjust store credit',
    points: 'Adjust loyalty points',
  };

  return (
    <Modal open onClose={onClose} title={titles[kind]} size="sm"
      subtitle={customer.name}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onSubmit(
          kind === 'payment' ? { amount: Number(amount), method, reference: reason }
            : kind === 'credit' ? { amount: Number(amount), reason }
              : { points: Number(amount) }
        )}>Confirm</button></>}>
      <div className="space-y-3">
        <Field label={kind === 'points' ? 'Points (negative to deduct)' : 'Amount (negative to deduct)'}>
          <input type="number" className="input" value={amount} autoFocus
            onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {kind === 'payment' && (
          <>
            <Field label="Method">
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                {['cash', 'transfer', 'card', 'mobile_money'].map((m) =>
                  <option key={m} value={m}>{labelize(m)}</option>)}
              </select>
            </Field>
            <p className="text-xs text-slate-500">
              The payment is applied to their oldest unpaid invoices first. Outstanding: {money(customer.balance)}
            </p>
          </>
        )}
        {kind === 'credit' && (
          <Field label="Reason">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. goodwill gesture" />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/**
 * Link a membership card to this customer.
 *
 * The card is an EPC like any tag. Once bound, scanning it at the till pulls
 * this customer — loyalty, credit, block status — before the first item rings
 * up. That is the sales half of the RFID synergy.
 */
function CardModal({ customer, onClose, onDone }) {
  const toast = useToast();
  const [epc, setEpc] = useState(customer.rfid_card_epc || '');
  const [busy, setBusy] = useState(false);
  const scan = useRfidScan((c) => setEpc(c), { dedupeMs: 500, tagsOnly: true });

  const save = async (value) => {
    setBusy(true);
    try {
      await api.post(`/api/customers/${customer.id}/card`, { epc: value });
      toast.success(value ? 'Card linked' : 'Card removed');
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} size="sm" title="Membership card"
      subtitle={customer.name}
      footer={
        <>
          {customer.rfid_card_epc && (
            <button className="btn-secondary mr-auto text-rose-600" onClick={() => save('')} disabled={busy}>
              Remove card
            </button>
          )}
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => save(epc.trim())} disabled={busy || !epc.trim()}>
            Link card
          </button>
        </>
      }>
      <scan.CaptureField />
      <Field label="Card code" hint="Pull the trigger on the card, or type the number">
        <input className="input font-mono" autoFocus value={epc}
          onChange={(e) => setEpc(e.target.value)} placeholder="Scan the membership card" />
      </Field>
      {scan.native && (
        <button onClick={scan.toggle} className={`${scan.scanning ? 'btn-danger' : 'btn-secondary'} w-full mt-2`}>
          {scan.scanning ? <><Square size={16} /> Stop reading</> : <><Radio size={16} /> Read a card</>}
        </button>
      )}
      <p className="text-xs text-slate-500 mt-3">
        Anyone who scans this card at the counter pulls up {customer.name} automatically.
      </p>
    </Modal>
  );
}
