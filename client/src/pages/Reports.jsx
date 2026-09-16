import { useEffect, useState, useCallback } from 'react';
import { Download, BarChart3, TrendingUp, TrendingDown, Receipt, FileCheck2 } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, compactMoney, num, pct, date, daysAgo, today, labelize } from '../lib/format.js';
import { Card, Loading, Empty, Badge, Stat, Tabs, useToast } from '../components/ui.jsx';
import { MultiLineChart, RankedBarChart, CountBarChart } from '../components/charts.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTabParam } from '../lib/useTabParam.js';

export default function Reports() {
  const { locationId } = useAuth();
  const [tab, setTab] = useTabParam('sales');
  const [range, setRange] = useState({ from: daysAgo(29), to: today(), location_id: '' });

  const controls = (
    <div className="flex flex-wrap gap-2">
      <input type="date" className="input w-auto" value={range.from}
        onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
      <input type="date" className="input w-auto" value={range.to}
        onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
      <select className="input w-auto" value={range.location_id}
        onChange={(e) => setRange((r) => ({ ...r, location_id: e.target.value }))}>
        <option value="">This shop</option>
        <option value="all">All shops</option>
      </select>
      {[['7 days', 6], ['30 days', 29], ['90 days', 89]].map(([label, days]) => (
        <button key={label} className="btn-secondary text-xs"
          onClick={() => setRange((r) => ({ ...r, from: daysAgo(days), to: today() }))}>{label}</button>
      ))}
    </div>
  );

  return (
    <>
      <PageHeader title="Reports" subtitle="Sales, product performance, profitability and VAT"
        actions={controls} />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'sales', label: 'Sales' },
        { value: 'products', label: 'Products' },
        { value: 'pl', label: 'Profit & loss' },
        { value: 'tax', label: 'VAT' },
      ]} />
      {tab === 'sales' && <SalesReport range={range} locationId={locationId} />}
      {tab === 'products' && <ProductsReport range={range} locationId={locationId} />}
      {tab === 'pl' && <ProfitLoss range={range} locationId={locationId} />}
      {tab === 'tax' && <TaxReport range={range} locationId={locationId} />}
    </>
  );
}

/* ---------------- sales ---------------- */
function SalesReport({ range, locationId }) {
  const [groupBy, setGroupBy] = useState('day');
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    api.get(`/api/reports/sales${qs({ ...range, group_by: groupBy })}`)
      .then(setData).catch(() => setData(null));
  }, [range, groupBy, locationId]);

  if (!data) return <Loading />;
  const t = data.totals;
  const chartable = ['day', 'week', 'month'].includes(groupBy);

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
        <Stat label="Revenue" value={money(t.revenue)} />
        <Stat label="Orders" value={num(t.orders)} />
        <Stat label="Average order" value={money(t.average_order)} />
        <Stat label="Gross profit" value={money(t.gross_profit)} tone="good" />
        <Stat label="VAT collected" value={money(t.tax)} />
      </div>

      <Card className="mb-4" title={`Revenue and profit by ${groupBy}`}
        actions={
          <>
            <select className="input w-auto text-xs py-1.5" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              {['day', 'week', 'month', 'location', 'staff', 'category', 'payment'].map((g) =>
                <option key={g} value={g}>By {g}</option>)}
            </select>
            <button className="btn-secondary text-xs"
              onClick={() => api.download(`/api/reports/export/sales${qs({ ...range, format: 'xlsx' })}`)}>
              <Download size={14} /> Export
            </button>
          </>
        }>
        {data.rows.length === 0 ? <Empty title="No sales in this range" icon={Receipt} /> :
          chartable ? (
            <MultiLineChart data={data.rows} xKey="label" height={300}
              series={[{ key: 'revenue', label: 'Revenue' }, { key: 'gross_profit', label: 'Gross profit' }]} />
          ) : (
            <RankedBarChart height={Math.max(240, data.rows.length * 34)}
              data={data.rows.map((r) => ({ label: r.label, value: Number(r.revenue) }))} />
          )}
      </Card>

      <Card title="Detail" bodyClass="p-0">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{labelize(groupBy)}</th><th className="text-right">Orders</th>
              <th className="text-right">Revenue</th><th className="text-right">Discounts</th>
              <th className="text-right">VAT</th><th className="text-right">Cost</th>
              <th className="text-right">Gross profit</th><th className="text-right">Margin</th></tr></thead>
            <tbody>
              {data.rows.map((r, i) => {
                const net = Number(r.revenue) - Number(r.tax);
                return (
                  <tr key={i}>
                    <td className="font-medium">{labelize(r.label)}</td>
                    <td className="text-right tabular-nums">{num(r.orders)}</td>
                    <td className="text-right tabular-nums">{money(r.revenue)}</td>
                    <td className="text-right tabular-nums text-slate-500">{money(r.discounts)}</td>
                    <td className="text-right tabular-nums text-slate-500">{money(r.tax)}</td>
                    <td className="text-right tabular-nums text-slate-500">{money(r.cost)}</td>
                    <td className="text-right tabular-nums text-emerald-700">{money(r.gross_profit)}</td>
                    <td className="text-right tabular-nums">{net > 0 ? pct((Number(r.gross_profit) / net) * 100) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold bg-slate-50">
                <td>Total</td>
                <td className="text-right tabular-nums">{num(t.orders)}</td>
                <td className="text-right tabular-nums">{money(t.revenue)}</td>
                <td className="text-right tabular-nums">{money(t.discounts)}</td>
                <td className="text-right tabular-nums">{money(t.tax)}</td>
                <td className="text-right tabular-nums">{money(t.cost)}</td>
                <td className="text-right tabular-nums text-emerald-700">{money(t.gross_profit)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </>
  );
}

/* ---------------- products ---------------- */
function ProductsReport({ range, locationId }) {
  const [sort, setSort] = useState('fast');
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    api.get(`/api/reports/products${qs({ ...range, sort })}`).then(setData).catch(() => setData(null));
  }, [range, sort, locationId]);

  if (!data) return <Loading />;

  return (
    <>
      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Card title="Top sellers by units">
          {data.rows.length ? (
            <RankedBarChart height={320} valueFormat={(v) => num(v)}
              data={[...data.rows].sort((a, b) => b.qty_sold - a.qty_sold).slice(0, 10)
                .map((r) => ({ label: `${r.product_name} ${r.variant_label}`.slice(0, 28), value: Number(r.qty_sold) }))} />
          ) : <Empty title="No sales in this range" />}
        </Card>
        <Card title="Which sizes move fastest" subtitle="Units sold by size across all products">
          {data.by_size.length ? (
            <CountBarChart height={320}
              data={data.by_size.slice(0, 12).map((s) => ({ label: s.size, value: Number(s.qty) }))} />
          ) : <Empty title="No size data" />}
        </Card>
      </div>

      <Card className="mb-4" bodyClass="p-0"
        title="Product performance"
        actions={
          <select className="input w-auto text-xs py-1.5" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="fast">Best sellers first</option>
            <option value="slow">Slowest first</option>
          </select>
        }>
        {data.rows.length === 0 ? <Empty title="No sales in this range" icon={BarChart3} /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Product</th><th>Variant</th><th className="text-right">Units sold</th>
                <th className="text-right">Orders</th><th className="text-right">Revenue</th>
                <th className="text-right">Gross profit</th><th className="text-right">On hand</th></tr></thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="font-medium text-slate-800">{r.product_name}</td>
                    <td className="text-slate-600">{r.variant_label || '—'}</td>
                    <td className="text-right tabular-nums font-medium">{num(r.qty_sold)}</td>
                    <td className="text-right tabular-nums text-slate-500">{num(r.orders)}</td>
                    <td className="text-right tabular-nums">{money(r.revenue)}</td>
                    <td className="text-right tabular-nums text-emerald-700">{money(r.gross_profit)}</td>
                    <td className="text-right tabular-nums">{num(r.on_hand)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card bodyClass="p-0" title="Dead stock"
        subtitle="In stock but sold nothing in this range — cash tied up on the shelf">
        {data.no_sales.length === 0 ? (
          <Empty title="Everything in stock sold at least once" icon={TrendingUp} />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Product</th><th>Variant</th><th className="text-right">On hand</th>
                <th className="text-right">Tied-up cost</th><th>Last sold</th></tr></thead>
              <tbody>
                {data.no_sales.map((r) => (
                  <tr key={r.variant_id}>
                    <td className="font-medium text-slate-800">{r.product_name}</td>
                    <td className="text-slate-600">{[r.size, r.color].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="text-right tabular-nums">{num(r.on_hand)}</td>
                    <td className="text-right tabular-nums">{money(r.tied_up_cost)}</td>
                    <td className="text-xs text-slate-500">{r.last_sold_at ? date(r.last_sold_at) : 'never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/* ---------------- profit & loss ---------------- */
function ProfitLoss({ range, locationId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    setData(null);
    api.get(`/api/reports/profit-loss${qs(range)}`).then(setData).catch(() => setData(null));
  }, [range, locationId]);

  if (!data) return <Loading />;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Net sales" value={money(data.net_sales)} sub={`${money(data.sales.refunds)} refunded`} />
        <Stat label="Gross profit" value={money(data.gross_profit)} tone="good"
          sub={`${pct(data.gross_margin_percent)} margin`} />
        <Stat label="Expenses" value={money(data.expense_total)} tone="warn" />
        <Stat label="Net profit" value={money(data.net_profit)}
          tone={data.net_profit >= 0 ? 'good' : 'bad'} />
      </div>

      <Card className="mb-4" title="Revenue, cost and expenses by day">
        <MultiLineChart data={data.by_day} height={300}
          series={[{ key: 'revenue', label: 'Revenue' }, { key: 'gross_profit', label: 'Gross profit' }]} />
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Statement" bodyClass="p-0">
          <table className="data">
            <tbody>
              <PLRow label="Gross sales" value={data.sales.gross_sales} />
              <PLRow label="Less refunds" value={-data.sales.refunds} />
              <PLRow label="Net sales" value={data.net_sales} bold />
              <PLRow label="Less VAT collected" value={-data.sales.vat_collected} muted />
              <PLRow label="Net sales excluding VAT" value={data.net_sales_excl_vat} bold />
              <PLRow label="Cost of goods sold" value={-data.cogs} />
              <PLRow label="Gross profit" value={data.gross_profit} bold tone="text-emerald-700" />
              <PLRow label="Operating expenses" value={-data.expense_total} />
              <PLRow label="Net profit" value={data.net_profit} bold
                tone={data.net_profit >= 0 ? 'text-emerald-700' : 'text-rose-600'} />
            </tbody>
          </table>
          <p className="text-xs text-slate-500 px-4 py-3 border-t border-slate-100">
            VAT collected is shown separately because it is held on behalf of the tax authority, not income.
            Confirm your filing obligations with a tax adviser before relying on this for a return.
          </p>
        </Card>

        <Card title="Expenses by category">
          {data.expenses.length ? (
            <RankedBarChart height={Math.max(220, data.expenses.length * 32)}
              data={data.expenses.map((e) => ({ label: e.category, value: Number(e.amount) }))} />
          ) : <Empty title="No expenses in this range" />}
        </Card>
      </div>
    </>
  );
}

function PLRow({ label, value, bold, muted, tone }) {
  return (
    <tr className={bold ? 'font-semibold bg-slate-50' : ''}>
      <td className={muted ? 'text-slate-500' : ''}>{label}</td>
      <td className={`text-right tabular-nums ${tone || ''} ${Number(value) < 0 && !tone ? 'text-slate-600' : ''}`}>
        {money(value)}
      </td>
    </tr>
  );
}

/* ---------------- VAT ---------------- */
function TaxReport({ range, locationId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    setData(null);
    api.get(`/api/reports/tax${qs(range)}`).then(setData).catch(() => setData(null));
  }, [range, locationId]);

  if (!data) return <Loading />;
  const totalVat = data.rows.reduce((s, r) => s + Number(r.vat), 0);

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <Stat label="VAT collected in range" value={money(totalVat)} />
        <Stat label="Invoices issued" value={num(data.rows.reduce((s, r) => s + Number(r.invoices), 0))} />
        <Stat label="Sequence gaps" value={num(data.invoice_sequence_gaps)}
          tone={data.invoice_sequence_gaps > 0 ? 'bad' : 'good'}
          sub={data.invoice_sequence_gaps > 0 ? 'Investigate — numbering must be unbroken' : 'Numbering is unbroken'} />
      </div>

      <Card title="VAT by month" bodyClass="p-0">
        {data.rows.length === 0 ? <Empty title="No invoices in this range" icon={FileCheck2} /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Period</th><th className="text-right">Invoices</th>
                <th>First invoice</th><th>Last invoice</th>
                <th className="text-right">Net</th><th className="text-right">VAT</th>
                <th className="text-right">Gross</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.period}>
                    <td className="font-medium">{r.period}</td>
                    <td className="text-right tabular-nums">{num(r.invoices)}</td>
                    <td className="font-mono text-xs">{r.first_invoice}</td>
                    <td className="font-mono text-xs">{r.last_invoice}</td>
                    <td className="text-right tabular-nums">{money(r.net)}</td>
                    <td className="text-right tabular-nums font-medium">{money(r.vat)}</td>
                    <td className="text-right tabular-nums">{money(r.gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-500 px-4 py-3 border-t border-slate-100">
          Invoices are numbered sequentially without gaps and carry the business TIN and a separated VAT
          line. The invoice data is also stored in a structured shape so an e-invoicing integration can be
          added later without reworking the database.
        </p>
      </Card>
    </>
  );
}
