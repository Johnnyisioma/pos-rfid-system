import { useEffect, useState, useCallback } from 'react';
import { ShieldCheck, Search } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { dateTime, labelize, daysAgo, today } from '../lib/format.js';
import { Card, Loading, Empty, Badge, Pagination, Modal } from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';

const ACTION_TONE = {
  create: 'found', update: 'unexpected', delete: 'unknown', login: 'open',
  receive: 'found', adjust: 'unexpected', encode_tag: 'found', reconcile: 'found',
  cancel: 'unknown', payment: 'found', import: 'found', sync: 'open',
};

export default function AuditLog() {
  const [data, setData] = useState(null);
  const [facets, setFacets] = useState({ actions: [], entities: [], users: [] });
  const [filters, setFilters] = useState({ q: '', action: '', entity_type: '', user_id: '', from: daysAgo(30), to: today() });
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setData(null);
    setData(await api.get(`/api/audit${qs({ ...filters, page, limit: 50 })}`).catch(() => ({ data: [] })));
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/api/audit/facets').then(setFacets).catch(() => {}); }, []);
  useEffect(() => { setPage(1); }, [filters]);

  return (
    <>
      <PageHeader title="Audit log"
        subtitle="Who created, changed or deleted what — and when" />

      <Card bodyClass="p-0">
        <div className="p-4 flex flex-wrap gap-2 border-b border-slate-100">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search user, entity or details…" value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
          </div>
          <select className="input w-auto" value={filters.action}
            onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}>
            <option value="">All actions</option>
            {facets.actions.map((a) => <option key={a} value={a}>{labelize(a)}</option>)}
          </select>
          <select className="input w-auto" value={filters.entity_type}
            onChange={(e) => setFilters((f) => ({ ...f, entity_type: e.target.value }))}>
            <option value="">All record types</option>
            {facets.entities.map((e) => <option key={e} value={e}>{labelize(e)}</option>)}
          </select>
          <select className="input w-auto" value={filters.user_id}
            onChange={(e) => setFilters((f) => ({ ...f, user_id: e.target.value }))}>
            <option value="">All staff</option>
            {facets.users.map((u) => <option key={u.user_id} value={u.user_id}>{u.user_name}</option>)}
          </select>
          <input type="date" className="input w-auto" value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
          <input type="date" className="input w-auto" value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </div>

        {!data ? <Loading /> : data.data.length === 0 ? (
          <Empty title="Nothing logged in this range" icon={ShieldCheck} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>When</th><th>Staff</th><th>Action</th><th>Record</th>
                  <th>Location</th><th>Details</th></tr></thead>
                <tbody>
                  {data.data.map((a) => (
                    <tr key={a.id} className="cursor-pointer" onClick={() => setDetail(a)}>
                      <td className="text-xs text-slate-500 whitespace-nowrap">{dateTime(a.created_at)}</td>
                      <td className="font-medium text-slate-800">{a.user_name || 'System'}</td>
                      <td><Badge status={ACTION_TONE[a.action] || 'draft'}>{labelize(a.action)}</Badge></td>
                      <td className="text-slate-600">
                        {labelize(a.entity_type)}{a.entity_id ? <span className="text-slate-400"> #{a.entity_id}</span> : ''}
                      </td>
                      <td className="text-slate-600 text-sm">{a.location_name || '—'}</td>
                      <td className="text-xs text-slate-500 max-w-md truncate">
                        {summarise(a.details)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      {detail && (
        <Modal open onClose={() => setDetail(null)} size="sm"
          title={`${labelize(detail.action)} — ${labelize(detail.entity_type)}`}
          subtitle={`${detail.user_name || 'System'} · ${dateTime(detail.created_at)}`}
          footer={<button className="btn-primary" onClick={() => setDetail(null)}>Close</button>}>
          <dl className="text-sm space-y-1.5 mb-3">
            <Row label="Record id" value={detail.entity_id || '—'} />
            <Row label="Location" value={detail.location_name || '—'} />
            <Row label="IP address" value={detail.ip || '—'} />
          </dl>
          <p className="label">Details</p>
          <pre className="text-[11px] bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto">
            {JSON.stringify(detail.details, null, 2)}
          </pre>
        </Modal>
      )}
    </>
  );
}

const Row = ({ label, value }) => (
  <div className="flex justify-between"><dt className="text-slate-500">{label}</dt><dd>{value}</dd></div>
);

function summarise(details) {
  if (!details || typeof details !== 'object') return '—';
  const entries = Object.entries(details);
  if (!entries.length) return '—';
  return entries.slice(0, 4).map(([k, v]) =>
    `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
}
