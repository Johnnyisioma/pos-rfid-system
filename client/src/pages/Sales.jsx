import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Receipt, Download, Filter } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, num, dateTime, daysAgo, today } from '../lib/format.js';
import { Card, Loading, Empty, Badge, Pagination, Stat } from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';

export default function Sales() {
  const { locationId } = useAuth();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    q: '', status: '', from: daysAgo(30), to: today(),
    location_id: '', credit: params.get('credit') || '',
  });

  const load = useCallback(async () => {
    setData(null);
    setData(await api.get(`/api/sales${qs({ ...filters, page, limit: 30 })}`).catch(() => ({ data: [] })));
  }, [filters, page, locationId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [filters]);

  return (
    <>
      <PageHeader title="Sales & invoices"
        subtitle="Every completed sale, quotation, layaway and credit invoice"
        actions={
          <button className="btn-secondary"
            onClick={() => api.download(`/api/reports/export/sales${qs({ from: filters.from, to: filters.to, format: 'xlsx' })}`)}>
            <Download size={16} /> Export
          </button>
        } />

      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          <Stat label="Invoices in range" value={num(data.total)} />
          <Stat label="Revenue" value={money(data.sum_total)} />
          <Stat label="VAT collected" value={money(data.sum_tax)} />
        </div>
      )}

      <Card bodyClass="p-0">
        <div className="p-4 flex flex-wrap gap-2 border-b border-slate-100">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Invoice number or customer…" value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
          </div>
          <input type="date" className="input w-auto" value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
          <input type="date" className="input w-auto" value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
          <select className="input w-auto" value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">All statuses</option>
            {['completed', 'partially_refunded', 'refunded', 'held', 'quotation', 'layaway']
              .map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <select className="input w-auto" value={filters.location_id}
            onChange={(e) => setFilters((f) => ({ ...f, location_id: e.target.value }))}>
            <option value="">This shop</option>
            <option value="all">All shops</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-600 px-2">
            <input type="checkbox" className="rounded border-slate-300" checked={filters.credit === 'true'}
              onChange={(e) => setFilters((f) => ({ ...f, credit: e.target.checked ? 'true' : '' }))} />
            Unpaid only
          </label>
        </div>

        {!data ? <Loading /> : data.data.length === 0 ? (
          <Empty title="No sales in this range" icon={Receipt}
            hint="Widen the date range or clear the filters." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Invoice</th><th>Customer</th><th>Cashier</th><th>Location</th>
                  <th className="text-right">Items</th><th className="text-right">VAT</th>
                  <th className="text-right">Total</th><th className="text-right">Balance</th>
                  <th>Status</th><th>When</th></tr></thead>
                <tbody>
                  {data.data.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link to={`/sales/${s.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">
                          {s.invoice_no || `#${s.id}`}
                        </Link>
                      </td>
                      <td className="text-slate-700">{s.customer_name || <span className="text-slate-400">Walk-in</span>}</td>
                      <td className="text-slate-600 text-sm">{s.cashier_name || '—'}</td>
                      <td className="text-slate-600 text-sm">{s.location_name}</td>
                      <td className="text-right tabular-nums">{num(s.item_count)}</td>
                      <td className="text-right tabular-nums text-slate-500">{money(s.tax_amount)}</td>
                      <td className="text-right tabular-nums font-medium">{money(s.total)}</td>
                      <td className={`text-right tabular-nums ${Number(s.balance_due) > 0 ? 'text-amber-700 font-medium' : 'text-slate-400'}`}>
                        {Number(s.balance_due) > 0 ? money(s.balance_due) : '—'}
                      </td>
                      <td><Badge status={s.status} /></td>
                      <td className="text-xs text-slate-500 whitespace-nowrap">{dateTime(s.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
