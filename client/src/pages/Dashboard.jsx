import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, Receipt, Boxes, AlertTriangle, Radio, CreditCard, Users, ArrowRight, Tag,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { money, compactMoney, num, pct, labelize } from '../lib/format.js';
import { Card, Stat, Loading, Empty, Badge } from '../components/ui.jsx';
import { TrendChart, RankedBarChart } from '../components/charts.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';

export default function Dashboard() {
  const { location, locationId } = useAuth();
  const [data, setData] = useState(null);
  const [scope, setScope] = useState('location');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setData(null);
    api.get(`/api/reports/dashboard${scope === 'all' ? '?location_id=all' : ''}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [scope, locationId]);

  if (error) return <Empty title="Could not load the dashboard" hint={error} icon={AlertTriangle} />;
  if (!data) return <Loading label="Crunching today's numbers…" />;

  const t = data.today;
  const m = data.month;
  const margin = m.revenue > 0 ? (Number(m.gross_profit) / Number(m.revenue)) * 100 : 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={scope === 'all' ? 'All locations' : location?.name}
        actions={
          <div className="flex rounded-lg ring-1 ring-slate-300 overflow-hidden bg-white">
            {[['location', 'This shop'], ['all', 'All shops']].map(([v, l]) => (
              <button key={v} onClick={() => setScope(v)}
                className={`px-3 py-2 text-sm font-medium ${scope === v ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                {l}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Sales today" value={money(t.revenue)} icon={TrendingUp}
          sub={`${num(t.orders)} order${Number(t.orders) === 1 ? '' : 's'} · avg ${compactMoney(t.average_order)}`} />
        <Stat label="This month" value={money(m.revenue)} icon={Receipt}
          sub={`${num(m.orders)} orders`} />
        <Stat label="Gross profit (month)" value={money(m.gross_profit)} tone="good" icon={TrendingUp}
          sub={`${pct(margin)} margin · VAT ${compactMoney(m.tax)}`} />
        <Stat label="Stock at cost" value={money(data.inventory.cost_value)} icon={Boxes}
          sub={`${num(data.inventory.units)} units on hand`} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Link to="/inventory?low=true" className="block">
          <Stat label="Low stock lines" value={num(data.low_stock_count)}
            tone={data.low_stock_count > 0 ? 'warn' : 'default'} icon={AlertTriangle}
            sub="At or below reorder point" />
        </Link>
        <Link to="/rfid?encoded=false" className="block">
          <Stat label="Tags to encode" value={num(data.rfid.awaiting_tag)}
            tone={data.rfid.awaiting_tag > 0 ? 'warn' : 'default'} icon={Tag}
            sub={`${num(data.rfid.tagged_in_stock)} units tracked`} />
        </Link>
        <Link to="/transfers" className="block">
          <Stat label="In transit" value={num(data.rfid.in_transit)} icon={Radio}
            sub="Units between branches" />
        </Link>
        <Link to="/sales?credit=true" className="block">
          <Stat label="Owed by customers" value={money(data.open_credit.amount)}
            tone={Number(data.open_credit.amount) > 0 ? 'warn' : 'default'} icon={CreditCard}
            sub={`${num(data.open_credit.invoices)} open invoices`} />
        </Link>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <Card className="lg:col-span-2" title="Revenue, last 30 days"
          subtitle={scope === 'all' ? 'All locations combined' : location?.name}>
          <TrendChart data={data.trend} />
        </Card>

        <Card title="Payment methods" subtitle="This month">
          {data.by_payment.length ? (
            <RankedBarChart height={240}
              data={data.by_payment.map((p) => ({ label: labelize(p.method), value: Number(p.amount) }))} />
          ) : <Empty title="No payments yet this month" icon={CreditCard} />}
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Best sellers" subtitle="This month, by units"
          actions={<Link to="/reports" className="btn-ghost text-xs">Reports <ArrowRight size={13} /></Link>}>
          {data.top_products.length ? (
            <div className="space-y-2">
              {data.top_products.map((p, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-5 text-xs font-semibold text-slate-400 tabular-nums">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">{p.product_name}</p>
                    <p className="text-xs text-slate-500 truncate">{p.variant_label || p.sku}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums">{num(p.qty)}</p>
                    <p className="text-xs text-slate-500 tabular-nums">{compactMoney(p.revenue)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty title="No sales yet this month" />}
        </Card>

        <Card title="By location" subtitle="This month">
          {data.by_location.length ? (
            <div className="space-y-3">
              {data.by_location.map((l) => (
                <div key={l.id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-slate-700">{l.name}</span>
                    <span className="tabular-nums text-slate-600">{money(l.revenue)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-brand-500"
                      style={{ width: `${Math.min(100, (Number(l.revenue) / Math.max(1, Number(data.by_location[0].revenue))) * 100)}%` }} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {num(l.orders)} orders · profit {compactMoney(l.profit)}
                  </p>
                </div>
              ))}
            </div>
          ) : <Empty title="No location data" />}
        </Card>

        <Card title="Top staff" subtitle="This month, by revenue" >
          {data.by_staff.length ? (
            <div className="space-y-2">
              {data.by_staff.map((s) => (
                <div key={s.id} className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-slate-100 grid place-items-center text-xs font-semibold text-slate-600 shrink-0">
                    {s.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">{s.name}</p>
                    <Badge className="mt-0.5">{labelize(s.role)}</Badge>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums">{compactMoney(s.revenue)}</p>
                    <p className="text-xs text-slate-500 tabular-nums">{num(s.orders)} orders</p>
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty title="No staff sales yet" icon={Users} />}
        </Card>
      </div>
    </>
  );
}
