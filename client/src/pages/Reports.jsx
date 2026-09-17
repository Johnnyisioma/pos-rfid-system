import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Download, BarChart3, TrendingUp, TrendingDown, Receipt, FileCheck2, Coins, FileClock,
  Users2, AlertTriangle, ShieldCheck, Printer,
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, compactMoney, num, pct, date, dateTime, daysAgo, today, labelize } from '../lib/format.js';
import { Card, Loading, Empty, Badge, Stat, Tabs, useToast } from '../components/ui.jsx';
import { MultiLineChart, RankedBarChart, CountBarChart } from '../components/charts.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTabParam } from '../lib/useTabParam.js';
import ExportButtons, { printTable } from '../components/ExportButtons.jsx';

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
        { value: 'purchase-sale', label: 'Purchase & sale' },
        { value: 'payments', label: 'Money in & out' },
        { value: 'aging', label: 'Payment by age' },
        { value: 'contacts', label: 'Supplier & customer' },
        { value: 'shrinkage', label: 'Shrinkage' },
        { value: 'z', label: 'Z report' },
        { value: 'tax', label: 'VAT' },
      ]} />
      {tab === 'sales' && <SalesReport range={range} locationId={locationId} />}
      {tab === 'products' && <ProductsReport range={range} locationId={locationId} />}
      {tab === 'pl' && <ProfitLoss range={range} locationId={locationId} />}
      {tab === 'purchase-sale' && <PurchaseVsSale range={range} locationId={locationId} />}
      {tab === 'payments' && <PaymentsReport range={range} locationId={locationId} />}
      {tab === 'aging' && <AgingReport locationId={locationId} />}
      {tab === 'contacts' && <ContactsBalance />}
      {tab === 'shrinkage' && <ShrinkageReport range={range} locationId={locationId} />}
      {tab === 'z' && <ZReport locationId={locationId} />}
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
            <ExportButtons report="sales" title="Sales report" params={range}
              subtitle={`${date(range.from)} — ${date(range.to)}`} />
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

/* ---------------- C3 · purchase vs sale ---------------- */
/**
 * The one page an owner checks when the bank balance feels wrong: what went
 * out to suppliers against what came back in over the counter, both net of
 * returns. Gross purchases against gross sales flatters a bad month.
 */
function PurchaseVsSale({ range, locationId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    setData(null);
    api.get(`/api/reports/purchase-sale${qs(range)}`).then(setData).catch(() => setData(null));
  }, [range, locationId]);

  if (!data) return <Loading />;
  const bars = [
    { label: 'Net purchases', value: Number(data.purchases.net) },
    { label: 'Net sales', value: Number(data.sales.net) },
    { label: 'Gross margin', value: Number(data.gross_margin) },
  ];

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Net purchases" value={money(data.purchases.net)} icon={TrendingDown}
          sub={`${num(data.purchases.orders)} order(s), ${money(data.purchases.returns)} returned`} />
        <Stat label="Net sales" value={money(data.sales.net)} icon={TrendingUp}
          sub={`${num(data.sales.orders)} sale(s), ${money(data.sales.returns)} refunded`} />
        <Stat label="Gross margin" value={money(data.gross_margin)} tone="good"
          sub={`${pct(data.margin_percent)} of net sales excl. VAT`} />
        <Stat label="Still owed to suppliers"
          value={money(Number(data.purchases.total) - Number(data.purchases.paid))} tone="warn" />
      </div>

      <Card className="mb-4" title="Money out against money in"
        subtitle="Both figures are net of returns, which is the only fair comparison">
        <RankedBarChart height={220} data={bars} />
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Purchases" bodyClass="p-0">
          <table className="data">
            <tbody>
              <PLRow label="Purchase orders raised" value={data.purchases.total} />
              <PLRow label="Less returns to supplier" value={-data.purchases.returns} muted />
              <PLRow label="Net purchases" value={data.purchases.net} bold />
              <PLRow label="Paid so far" value={data.purchases.paid} muted />
              <PLRow label="Outstanding"
                value={Number(data.purchases.total) - Number(data.purchases.paid)}
                bold tone="text-amber-700" />
            </tbody>
          </table>
        </Card>
        <Card title="Sales" bodyClass="p-0">
          <table className="data">
            <tbody>
              <PLRow label="Gross sales" value={data.sales.gross} />
              <PLRow label="Less refunds" value={-data.sales.returns} muted />
              <PLRow label="Net sales" value={data.sales.net} bold />
              <PLRow label="Less VAT collected" value={-data.sales.tax} muted />
              <PLRow label="Less cost of goods" value={-data.sales.cost} muted />
              <PLRow label="Gross margin" value={data.gross_margin} bold tone="text-emerald-700" />
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}

/* ---------------- C4 · money in and out ---------------- */
function PaymentsReport({ range, locationId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    setData(null);
    api.get(`/api/reports/payments${qs(range)}`).then(setData).catch(() => setData(null));
  }, [range, locationId]);

  if (!data) return <Loading />;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Taken from customers" value={money(data.money_in)} tone="good" icon={Coins} />
        <Stat label="Paid out as expenses" value={money(data.money_out)} tone="warn" />
        <Stat label="Paid to suppliers"
          value={money(data.purchase_payments.reduce((s, r) => s + Number(r.paid), 0))} />
        <Stat label="Still owed to suppliers"
          value={money(data.purchase_payments.reduce((s, r) => s + Number(r.outstanding), 0))} tone="warn" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Card title="How customers paid" bodyClass="p-0"
          actions={<ExportButtons compact title="Payments by method" filename="payments-by-method"
            rows={data.sell_by_method} columns={[
              { key: 'method', label: 'Method', format: labelize },
              { key: 'count', label: 'Payments', align: 'right' },
              { key: 'amount', label: 'Amount', align: 'right', format: (v) => money(v) },
            ]} />}>
          {data.sell_by_method.length === 0 ? <Empty title="No payments in this range" icon={Coins} /> : (
            <table className="data">
              <thead><tr><th>Method</th><th className="text-right">Payments</th>
                <th className="text-right">Amount</th><th className="text-right">Share</th></tr></thead>
              <tbody>
                {data.sell_by_method.map((r) => (
                  <tr key={r.method}>
                    <td className="font-medium">{labelize(r.method)}</td>
                    <td className="text-right tabular-nums text-slate-500">{num(r.count)}</td>
                    <td className="text-right tabular-nums">{money(r.amount)}</td>
                    <td className="text-right tabular-nums text-slate-500">
                      {data.money_in > 0 ? pct((Number(r.amount) / data.money_in) * 100) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Where the money landed"
          subtitle="Anything showing as Unassigned has no payment account mapped yet" bodyClass="p-0">
          {data.sell_by_account.length === 0 ? <Empty title="No payments in this range" /> : (
            <>
              <table className="data">
                <thead><tr><th>Account</th><th>Type</th><th className="text-right">Payments</th>
                  <th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {data.sell_by_account.map((r, i) => (
                    <tr key={i}>
                      <td className="font-medium">{r.account}</td>
                      <td className="text-slate-500 text-sm">{r.type ? labelize(r.type) : '—'}</td>
                      <td className="text-right tabular-nums text-slate-500">{num(r.count)}</td>
                      <td className="text-right tabular-nums">{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.sell_by_account.some((r) => r.account === 'Unassigned') && (
                <p className="text-xs text-amber-800 bg-amber-50 px-4 py-2.5 border-t border-amber-100">
                  Some money has no account against it. Set the tender defaults on{' '}
                  <Link to="/accounts" className="underline font-medium">Payment accounts</Link> so it
                  reconciles by itself from now on.
                </p>
              )}
            </>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Paid to suppliers" bodyClass="p-0">
          {data.purchase_payments.length === 0 ? <Empty title="No supplier payments in this range" /> : (
            <table className="data">
              <thead><tr><th>Supplier</th><th className="text-right">Orders</th>
                <th className="text-right">Paid</th><th className="text-right">Outstanding</th></tr></thead>
              <tbody>
                {data.purchase_payments.map((r, i) => (
                  <tr key={i}>
                    <td className="font-medium">{r.supplier}</td>
                    <td className="text-right tabular-nums text-slate-500">{num(r.orders)}</td>
                    <td className="text-right tabular-nums">{money(r.paid)}</td>
                    <td className="text-right tabular-nums text-amber-700">{money(r.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Expenses by account" bodyClass="p-0">
          {data.expense_by_account.length === 0 ? <Empty title="No expenses in this range" /> : (
            <table className="data">
              <thead><tr><th>Account</th><th className="text-right">Entries</th>
                <th className="text-right">Amount</th></tr></thead>
              <tbody>
                {data.expense_by_account.map((r, i) => (
                  <tr key={i}>
                    <td className="font-medium">{r.account}</td>
                    <td className="text-right tabular-nums text-slate-500">{num(r.count)}</td>
                    <td className="text-right tabular-nums text-rose-700">{money(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}

/* ---------------- C1 · payment by age ---------------- */
const BUCKETS = [
  { key: 'current', label: 'Current (0–30 days)', tone: 'text-emerald-700' },
  { key: 'd31_60', label: '31–60 days', tone: 'text-amber-700' },
  { key: 'd61_90', label: '61–90 days', tone: 'text-orange-700' },
  { key: 'over_90', label: 'Over 90 days', tone: 'text-rose-700' },
];

function Aged({ value, tone = '' }) {
  const n = Number(value || 0);
  return (
    <td className={`text-right tabular-nums ${n > 0 ? tone : 'text-slate-300'}`}>
      {n > 0 ? money(n) : '—'}
    </td>
  );
}

function AgingReport({ locationId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    setData(null);
    api.get('/api/reports/payment-by-age').then(setData).catch(() => setData(null));
  }, [locationId]);

  if (!data) return <Loading />;

  const customerCols = [
    { key: 'customer', label: 'Customer' },
    { key: 'phone', label: 'Phone' },
    { key: 'invoices', label: 'Open invoices', align: 'right' },
    { key: 'current', label: 'Current', align: 'right', format: (v) => money(v) },
    { key: 'd31_60', label: '31–60', align: 'right', format: (v) => money(v) },
    { key: 'd61_90', label: '61–90', align: 'right', format: (v) => money(v) },
    { key: 'over_90', label: 'Over 90', align: 'right', format: (v) => money(v) },
    { key: 'total', label: 'Total owed', align: 'right', format: (v) => money(v) },
    { key: 'oldest_days', label: 'Oldest (days)', align: 'right' },
  ];

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
        <Stat label="Total owed to you" value={money(data.total)} icon={FileClock} />
        {BUCKETS.map((b) => (
          <Stat key={b.key} label={b.label} value={money(data.buckets[b.key])}
            tone={b.key === 'over_90' && data.buckets[b.key] > 0 ? 'bad'
              : b.key === 'current' ? 'good' : 'warn'} />
        ))}
      </div>

      {data.total === 0 ? (
        <Card><Empty title="Nobody owes you anything" icon={ShieldCheck}
          hint="Every invoice in the system is settled." /></Card>
      ) : (
        <>
          <Card className="mb-4" title="How the debt is aged">
            <RankedBarChart height={200}
              data={BUCKETS.map((b) => ({ label: b.label, value: Number(data.buckets[b.key]) }))} />
          </Card>

          <Card className="mb-4" bodyClass="p-0" title="Who owes what"
            actions={<ExportButtons title="Payment by age" filename="payment-by-age"
              rows={data.by_customer} columns={customerCols} />}>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Customer</th><th className="text-right">Invoices</th>
                  <th className="text-right">Current</th><th className="text-right">31–60</th>
                  <th className="text-right">61–90</th><th className="text-right">Over 90</th>
                  <th className="text-right">Total</th><th className="text-right">Oldest</th></tr></thead>
                <tbody>
                  {data.by_customer.map((c) => (
                    <tr key={c.customer_id || 'walkin'}>
                      <td>
                        {c.customer_id
                          ? <Link to={`/customers/${c.customer_id}`}
                              className="font-medium text-brand-700 hover:underline">{c.customer}</Link>
                          : <span className="font-medium text-slate-700">{c.customer}</span>}
                        {c.phone && <div className="text-xs text-slate-500">{c.phone}</div>}
                      </td>
                      <td className="text-right tabular-nums text-slate-500">{num(c.invoices)}</td>
                      {/* Colour only where there is money. A red em-dash in the
                          "over 90" column reads as an alarm for a customer who
                          owes nothing at that age. */}
                      <Aged value={c.current} />
                      <Aged value={c.d31_60} tone="text-amber-700" />
                      <Aged value={c.d61_90} tone="text-orange-700" />
                      <Aged value={c.over_90} tone="text-rose-700 font-medium" />
                      <td className="text-right tabular-nums font-semibold">{money(c.total)}</td>
                      <td className="text-right tabular-nums text-xs text-slate-500">{num(c.oldest_days)}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card bodyClass="p-0" title={`${data.invoices.length} unpaid invoice(s)`}
            subtitle="Oldest first — chase from the top"
            actions={<ExportButtons report="aged-receivables" title="Aged receivables" />}>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Invoice</th><th>Customer</th><th>Location</th><th>Date</th>
                  <th className="text-right">Age</th><th className="text-right">Total</th>
                  <th className="text-right">Paid</th><th className="text-right">Outstanding</th></tr></thead>
                <tbody>
                  {data.invoices.map((s) => (
                    <tr key={s.id}>
                      <td><Link to={`/sales/${s.id}`}
                        className="font-mono text-xs font-medium text-brand-700 hover:underline">
                        {s.invoice_no}</Link></td>
                      <td>{s.customer}</td>
                      <td className="text-slate-500 text-sm">{s.location_name}</td>
                      <td className="text-xs text-slate-500 whitespace-nowrap">{date(s.created_at)}</td>
                      <td className="text-right tabular-nums text-xs">
                        <Badge status={Number(s.age_days) > 90 ? 'cancelled'
                          : Number(s.age_days) > 30 ? 'partial' : 'completed'}>
                          {num(s.age_days)}d
                        </Badge>
                      </td>
                      <td className="text-right tabular-nums">{money(s.total)}</td>
                      <td className="text-right tabular-nums text-slate-500">{money(s.amount_paid)}</td>
                      <td className="text-right tabular-nums font-medium text-rose-700">{money(s.balance_due)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

/* ---------------- C2 · supplier & customer balances ---------------- */
function ContactsBalance() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/api/reports/contacts-balance').then(setData).catch(() => setData(null));
  }, []);

  if (!data) return <Loading />;
  const net = data.total_receivable - data.total_payable;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Owed to you" value={money(data.total_receivable)} icon={Users2} tone="good" />
        <Stat label="You owe suppliers" value={money(data.total_payable)} tone="warn" />
        <Stat label="Net position" value={money(net)} tone={net >= 0 ? 'good' : 'bad'} />
        <Stat label="Store credit issued" value={money(data.total_store_credit)}
          sub="A liability — customers can spend this" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card bodyClass="p-0" title="Customers who owe you"
          actions={<ExportButtons report="customers" title="Customers" />}>
          {data.receivables.length === 0 ? <Empty title="No customer balances" icon={ShieldCheck} /> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Customer</th><th>Group</th><th className="text-right">Open</th>
                  <th className="text-right">Owes</th><th className="text-right">Credit limit</th>
                  <th className="text-right">Store credit</th></tr></thead>
                <tbody>
                  {data.receivables.map((c) => {
                    const over = Number(c.credit_limit) > 0 && Number(c.balance) > Number(c.credit_limit);
                    return (
                      <tr key={c.id}>
                        <td>
                          <Link to={`/customers/${c.id}`}
                            className="font-medium text-brand-700 hover:underline">{c.name}</Link>
                          {c.phone && <div className="text-xs text-slate-500">{c.phone}</div>}
                        </td>
                        <td className="text-slate-500 text-sm">{c.group_name || '—'}</td>
                        <td className="text-right tabular-nums text-slate-500">{num(c.open_invoices)}</td>
                        <td className={`text-right tabular-nums font-medium ${over ? 'text-rose-700' : ''}`}>
                          {money(c.balance)}
                          {over && <div className="text-[11px] font-normal">over limit</div>}
                        </td>
                        <td className="text-right tabular-nums text-slate-500">
                          {Number(c.credit_limit) > 0 ? money(c.credit_limit) : '—'}</td>
                        <td className="text-right tabular-nums text-emerald-700">
                          {Number(c.store_credit) > 0 ? money(c.store_credit) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card bodyClass="p-0" title="Suppliers you owe">
          {data.payables.length === 0 ? <Empty title="No supplier balances" icon={ShieldCheck} /> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Supplier</th><th className="text-right">Purchased</th>
                  <th className="text-right">Returned</th><th className="text-right">Outstanding</th></tr></thead>
                <tbody>
                  {data.payables.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <div className="font-medium text-slate-800">{s.name}</div>
                        <div className="text-xs text-slate-500">{s.contact_person || s.phone || ''}</div>
                      </td>
                      <td className="text-right tabular-nums">{money(s.purchased)}</td>
                      <td className="text-right tabular-nums text-slate-500">
                        {Number(s.returned) > 0 ? money(s.returned) : '—'}</td>
                      <td className="text-right tabular-nums font-medium text-amber-700">
                        {money(s.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

/* ---------------- C6 · shrinkage ---------------- */
/**
 * Stock that left without being sold. Grouped by who authorised it as well as
 * by reason, because a single reason code used by one person again and again
 * is the pattern worth a conversation.
 */
function ShrinkageReport({ range, locationId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    setData(null);
    api.get(`/api/reports/stock-adjustments${qs(range)}`).then(setData).catch(() => setData(null));
  }, [range, locationId]);

  if (!data) return <Loading />;
  const net = data.total_loss - data.total_gain;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Stock written off" value={money(data.total_loss)} tone="bad" icon={AlertTriangle} />
        <Stat label="Stock found / added back" value={money(data.total_gain)} tone="good" />
        <Stat label="Net shrinkage" value={money(net)} tone={net > 0 ? 'bad' : 'good'} />
        <Stat label="Adjustment events"
          value={num(data.by_reason.reduce((s, r) => s + Number(r.adjustments), 0))} />
      </div>

      {data.by_reason.length === 0 ? (
        <Card><Empty title="No stock adjustments in this range" icon={ShieldCheck}
          hint="Nothing was written off — stock on the shelf matches stock in the system." /></Card>
      ) : (
        <>
          <div className="grid lg:grid-cols-2 gap-4 mb-4">
            <Card title="Loss by reason">
              <RankedBarChart height={Math.max(200, data.by_reason.length * 34)}
                data={data.by_reason.map((r) => ({
                  label: labelize(r.reason), value: Number(r.loss_value) }))} />
            </Card>
            <Card title="Loss by week" subtitle="A rising line is worth investigating before it compounds">
              {data.trend.length ? (
                <MultiLineChart data={data.trend} xKey="week" height={230}
                  series={[{ key: 'loss_value', label: 'Written off' }]} />
              ) : <Empty title="Not enough history yet" />}
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-4 mb-4">
            <Card bodyClass="p-0" title="By reason">
              <table className="data">
                <thead><tr><th>Reason</th><th className="text-right">Events</th>
                  <th className="text-right">Net units</th><th className="text-right">Written off</th>
                  <th className="text-right">Added back</th></tr></thead>
                <tbody>
                  {data.by_reason.map((r) => (
                    <tr key={r.reason}>
                      <td className="font-medium">{labelize(r.reason)}</td>
                      <td className="text-right tabular-nums text-slate-500">{num(r.adjustments)}</td>
                      <td className={`text-right tabular-nums ${
                        Number(r.net_units) < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {num(r.net_units)}</td>
                      <td className="text-right tabular-nums text-rose-700">{money(r.loss_value)}</td>
                      <td className="text-right tabular-nums text-emerald-700">
                        {Number(r.gain_value) > 0 ? money(r.gain_value) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card bodyClass="p-0" title="Who authorised it"
              subtitle="Not an accusation — a place to start asking">
              <table className="data">
                <thead><tr><th>Authorised by</th><th className="text-right">Adjustments</th>
                  <th className="text-right">Value written off</th></tr></thead>
                <tbody>
                  {data.by_user.map((u, i) => (
                    <tr key={i}>
                      <td className="font-medium">{u.authorised_by}</td>
                      <td className="text-right tabular-nums text-slate-500">{num(u.adjustments)}</td>
                      <td className="text-right tabular-nums text-rose-700">{money(u.loss_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <Card bodyClass="p-0" title="Worst-hit products"
            actions={<ExportButtons title="Shrinkage by product" filename="shrinkage"
              rows={data.by_product} columns={[
                { key: 'product_name', label: 'Product' },
                { key: 'sku', label: 'SKU' },
                { key: 'size', label: 'Size' },
                { key: 'color', label: 'Colour' },
                { key: 'units_lost', label: 'Units lost', align: 'right' },
                { key: 'loss_value', label: 'Value', align: 'right', format: (v) => money(v) },
              ]} />}>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Product</th><th>Variant</th><th>SKU</th>
                  <th className="text-right">Units lost</th><th className="text-right">Value</th></tr></thead>
                <tbody>
                  {data.by_product.map((p, i) => (
                    <tr key={i}>
                      <td className="font-medium text-slate-800">{p.product_name}</td>
                      <td className="text-slate-600">{[p.size, p.color].filter(Boolean).join(' / ') || '—'}</td>
                      <td className="font-mono text-xs text-slate-500">{p.sku}</td>
                      <td className="text-right tabular-nums">{num(p.units_lost)}</td>
                      <td className="text-right tabular-nums text-rose-700">{money(p.loss_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

/* ---------------- C5 · Z report ---------------- */
/**
 * The end-of-day slip. It answers one question before anyone goes home: does
 * the cash in the drawer match what the system says should be there. Printed
 * on its own rather than through the receipt stylesheet, so it comes out as
 * an A4 page a manager can sign.
 */
function ZReport({ locationId }) {
  const { settings } = useAuth();
  const [day, setDay] = useState(today());
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    api.get(`/api/reports/z-report${qs({ date: day })}`).then(setData).catch(() => setData(null));
  }, [day, locationId]);

  if (!data) return <Loading />;

  const variance = data.cash.counted == null ? null : Number(data.cash.variance);
  const rows = [
    ['Transactions', num(data.totals.transactions)],
    ['Gross takings', money(data.totals.gross)],
    ['Discounts given', money(data.totals.discounts)],
    ['VAT collected', money(data.totals.tax)],
    ['Cost of goods sold', money(data.totals.cost)],
    ['Refunds', `${money(data.refunds.amount)} (${num(data.refunds.count)})`],
    ['Invoices amended', num(data.amendments)],
    ['Net sales', money(data.net_sales)],
    ['Average sale', money(data.totals.average)],
  ];

  const print = () => printTable({
    title: `Z report — ${date(day)}`,
    subtitle: data.session
      ? `${data.session.register_name} · ${data.session.location_name} · ${data.session.user_name}`
      : 'All registers for the day',
    columns: [{ key: 'k', label: 'Item' }, { key: 'v', label: 'Value', align: 'right' }],
    rows: [
      ...rows.map(([k, v]) => ({ k, v })),
      { k: '—', v: '—' },
      ...data.tenders.map((t) => ({ k: `Tender · ${labelize(t.method)}`, v: money(t.amount) })),
      { k: '—', v: '—' },
      { k: 'Opening cash', v: money(data.cash.opening) },
      { k: 'Cash taken', v: money(data.cash.taken) },
      { k: 'Change given', v: money(data.cash.change_given) },
      { k: 'Expected in drawer', v: money(data.cash.expected) },
      { k: 'Counted', v: data.cash.counted == null ? 'not counted' : money(data.cash.counted) },
      { k: 'Variance', v: variance == null ? '—' : money(variance) },
    ],
    business: settings,
  });

  return (
    <>
      <Card className="mb-4" bodyClass="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-slate-600">Day</label>
          <input type="date" className="input w-auto" value={day} max={today()}
            onChange={(e) => setDay(e.target.value)} />
          <div className="flex-1" />
          <button className="btn-secondary" onClick={print}><Printer size={16} /> Print Z report</button>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Transactions" value={num(data.totals.transactions)} icon={Receipt} />
        <Stat label="Gross takings" value={money(data.totals.gross)} />
        <Stat label="Net of refunds" value={money(data.net_sales)} tone="good" />
        <Stat label="Expected in drawer" value={money(data.cash.expected)}
          sub={data.cash.counted == null ? 'Drawer not counted yet' : `Counted ${money(data.cash.counted)}`}
          tone={variance == null ? 'default' : Math.abs(variance) < 1 ? 'good' : 'bad'} />
      </div>

      {variance != null && Math.abs(variance) >= 1 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-rose-50 ring-1 ring-rose-200 p-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-600" />
          <p className="text-sm text-rose-900">
            The drawer is {money(Math.abs(variance))} {variance < 0 ? 'short' : 'over'}.
            Count again before closing, then check the cash sales and any change given.
          </p>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title={`Summary for ${date(day)}`} bodyClass="p-0">
          <table className="data">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}><td className="text-slate-600">{k}</td>
                  <td className="text-right tabular-nums font-medium">{v}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div className="space-y-4">
          <Card title="Tenders" bodyClass="p-0">
            {data.tenders.length === 0 ? <Empty title="No payments taken" /> : (
              <table className="data">
                <thead><tr><th>Method</th><th className="text-right">Count</th>
                  <th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {data.tenders.map((t) => (
                    <tr key={t.method}>
                      <td className="font-medium">{labelize(t.method)}</td>
                      <td className="text-right tabular-nums text-slate-500">{num(t.count)}</td>
                      <td className="text-right tabular-nums">{money(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Cash reconciliation" bodyClass="p-0">
            <table className="data">
              <tbody>
                <PLRow label="Opening float" value={data.cash.opening} />
                <PLRow label="Cash taken" value={data.cash.taken} />
                <PLRow label="Change given" value={-data.cash.change_given} muted />
                <PLRow label="Expected in drawer" value={data.cash.expected} bold />
                {data.cash.counted != null && (
                  <>
                    <PLRow label="Counted" value={data.cash.counted} />
                    <PLRow label="Variance" value={variance} bold
                      tone={Math.abs(variance) < 1 ? 'text-emerald-700' : 'text-rose-600'} />
                  </>
                )}
              </tbody>
            </table>
          </Card>

          {data.by_staff.length > 0 && (
            <Card title="By staff member" bodyClass="p-0">
              <table className="data">
                <thead><tr><th>Staff</th><th className="text-right">Transactions</th>
                  <th className="text-right">Takings</th></tr></thead>
                <tbody>
                  {data.by_staff.map((s, i) => (
                    <tr key={i}>
                      <td className="font-medium">{s.staff}</td>
                      <td className="text-right tabular-nums text-slate-500">{num(s.transactions)}</td>
                      <td className="text-right tabular-nums">{money(s.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
