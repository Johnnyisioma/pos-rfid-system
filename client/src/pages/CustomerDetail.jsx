import { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Star, Wallet, CreditCard, Receipt, Plus, Minus } from 'lucide-react';
import { api } from '../lib/api.js';
import { money, num, date, dateTime, labelize } from '../lib/format.js';
import { Card, Loading, Empty, Badge, Stat, Modal, useToast, Field, Tabs } from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
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
                {Number(c.balance) > 0 && (
                  <button className="btn-primary" onClick={() => setModal('payment')}>
                    <CreditCard size={16} /> Take payment
                  </button>
                )}
              </>
            )}
          </>
        } />

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

      {modal && (
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
