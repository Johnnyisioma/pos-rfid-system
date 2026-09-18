import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Radio, Printer, Search, Tag, CheckSquare, Square, Copy, Cpu, ScanLine,
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, num, dateTime, prettyEpc, labelize } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, Pagination, useToast, Stat, Spinner, Field,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import ExportButtons from '../components/ExportButtons.jsx';

export default function RfidUnits() {
  const { can, locationId } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [overview, setOverview] = useState(null);
  const [filters, setFilters] = useState({
    q: '', status: params.get('status') || 'in_stock',
    encoded: params.get('encoded') || '', location_id: '',
    variant_id: params.get('variant_id') || '', product_id: params.get('product_id') || '',
  });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]);
  const [detail, setDetail] = useState(null);
  const [encodeResult, setEncodeResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setData(null);
    setData(await api.get(`/api/rfid/units${qs({
      ...filters,
      location_id: filters.location_id === 'all' ? 'all' : locationId,
      page, limit: 30,
    })}`).catch(() => ({ data: [] })));
  }, [filters, page, locationId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/api/rfid/overview').then(setOverview).catch(() => {}); }, [locationId]);
  useEffect(() => { setPage(1); setSelected([]); }, [filters]);

  const encodeSelected = async () => {
    if (!selected.length) return;
    setBusy(true);
    try {
      const res = await api.post('/api/rfid/encode-batch', { unit_ids: selected });
      setEncodeResult(res);
      setSelected([]);
      load();
      toast.success(`${res.printed} tag(s) encoded`);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Tagged units"
        subtitle="One row per physical item — each with its own unique RFID EPC"
        actions={
          <>
            <Link to="/rfid/scan" className="btn-secondary"><ScanLine size={16} /> Scan</Link>
            <ExportButtons report="units" title="Tagged units" filename="rfid-units" />
          </>
        } />

      {overview && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
          <Stat label="In stock" value={num(overview.counts.in_stock)} icon={Radio} />
          <Stat label="Awaiting tag" value={num(overview.counts.awaiting_encoding)} icon={Tag}
            tone={overview.counts.awaiting_encoding > 0 ? 'warn' : 'default'} />
          <Stat label="Sold" value={num(overview.counts.sold)} />
          <Stat label="In transit" value={num(overview.counts.in_transit)} />
          <Stat label="Scans (24h)" value={num(overview.scans_24h)} icon={ScanLine} />
        </div>
      )}

      <Card bodyClass="p-0">
        <div className="p-4 flex flex-wrap gap-2 border-b border-slate-100">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search EPC, label, product or SKU…"
              value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
          </div>
          <select className="input w-auto" value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Any status</option>
            {['in_stock', 'sold', 'in_transit', 'reserved', 'damaged', 'lost', 'returned']
              .map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
          </select>
          <select className="input w-auto" value={filters.encoded}
            onChange={(e) => setFilters((f) => ({ ...f, encoded: e.target.value }))}>
            <option value="">Tag: any</option>
            <option value="true">Encoded</option>
            <option value="false">Not encoded yet</option>
          </select>
          <select className="input w-auto" value={filters.location_id}
            onChange={(e) => setFilters((f) => ({ ...f, location_id: e.target.value }))}>
            <option value="">This shop</option>
            <option value="all">All shops</option>
          </select>
          {can('rfid.encode') && selected.length > 0 && (
            <button className="btn-primary" onClick={encodeSelected} disabled={busy}>
              {busy ? <Spinner /> : <Printer size={16} />} Encode {selected.length} tag(s)
            </button>
          )}
        </div>

        {!data ? <Loading /> : data.data.length === 0 ? (
          <Empty title="No tagged units match" icon={Radio}
            hint="Units are created automatically when you receive stock or import opening quantities." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    {can('rfid.encode') && (
                      <th className="w-10">
                        <button onClick={() => setSelected(selected.length ? [] : data.data.map((u) => u.id))}
                          className="text-slate-400 hover:text-brand-600">
                          {selected.length ? <CheckSquare size={16} className="text-brand-600" /> : <Square size={16} />}
                        </button>
                      </th>
                    )}
                    <th>EPC</th><th>Product</th><th>Location</th><th>Status</th>
                    <th>Tag</th><th className="text-right">Cost</th><th>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((u) => (
                    <tr key={u.id}>
                      {can('rfid.encode') && (
                        <td>
                          <button onClick={() => setSelected((s) =>
                            s.includes(u.id) ? s.filter((x) => x !== u.id) : [...s, u.id])}
                            className="text-slate-400 hover:text-brand-600">
                            {selected.includes(u.id)
                              ? <CheckSquare size={16} className="text-brand-600" /> : <Square size={16} />}
                          </button>
                        </td>
                      )}
                      <td>
                        <button onClick={() => setDetail(u.id)}
                          className="font-mono text-xs text-brand-700 hover:underline">{u.epc}</button>
                        <div className="font-mono text-[10px] text-slate-400">{u.epc_readable}</div>
                      </td>
                      <td>
                        <div className="font-medium text-slate-800">{u.product_name}</div>
                        <div className="text-xs text-slate-500">
                          {[u.size, u.color].filter(Boolean).join(' / ')} · <span className="font-mono">{u.variant_sku}</span>
                        </div>
                      </td>
                      <td className="text-slate-600">{u.location_name || '—'}</td>
                      <td><Badge status={u.status} /></td>
                      <td>
                        {u.tag_encoded
                          ? <Badge status="found">Encoded</Badge>
                          : <Badge status="unexpected">Pending</Badge>}
                      </td>
                      <td className="text-right tabular-nums">{money(u.cost_price)}</td>
                      <td className="text-xs text-slate-500 whitespace-nowrap">{dateTime(u.received_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>

      {detail && <UnitDetail id={detail} onClose={() => setDetail(null)} onChanged={load} />}

      {encodeResult && (
        <Modal open onClose={() => setEncodeResult(null)} title="Encoding results" size="lg"
          subtitle="The exact ZPL for this unit — what a Zebra printer receives when one is connected"
          footer={<button className="btn-primary" onClick={() => setEncodeResult(null)}>Close</button>}>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {encodeResult.results.map((r) => (
              <div key={r.unit_id} className="rounded-lg ring-1 ring-slate-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs">{r.epc || `unit ${r.unit_id}`}</span>
                  <Badge status={r.status === 'failed' ? 'unknown' : 'found'}>
                    {r.status === 'failed' ? r.error : labelize(r.status)}
                  </Badge>
                </div>
                {r.zpl && <pre className="text-[10px] bg-slate-900 text-slate-100 rounded p-2 overflow-x-auto">{r.zpl}</pre>}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

function UnitDetail({ id, onClose, onChanged }) {
  const toast = useToast();
  const { can } = useAuth();
  const [unit, setUnit] = useState(null);
  const [zpl, setZpl] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get(`/api/rfid/units/${id}`).then(setUnit).catch((e) => toast.error(e.message)); }, [id]); // eslint-disable-line

  const encode = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/api/rfid/units/${id}/encode`, {});
      setZpl(res);
      onChanged?.();
      toast.success(res.message);
      setUnit((u) => ({ ...u, tag_encoded: true }));
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  if (!unit) return <Modal open onClose={onClose} title="Unit"><Loading /></Modal>;

  return (
    <Modal open onClose={onClose} size="lg" title={unit.product_name}
      subtitle={`${[unit.size, unit.color].filter(Boolean).join(' / ') || 'Default'} · unit #${unit.serial}`}
      footer={
        <>
          <Badge status={unit.status} className="mr-auto" />
          {can('rfid.encode') && (
            <button className="btn-primary" onClick={encode} disabled={busy}>
              {busy ? <Spinner /> : <Printer size={16} />} {unit.tag_encoded ? 'Re-encode tag' : 'Encode tag'}
            </button>
          )}
        </>
      }>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <p className="label">EPC (96-bit, hex)</p>
          <div className="flex items-center gap-2">
            <code className="font-mono text-sm bg-slate-100 rounded px-2 py-1 flex-1 break-all">
              {prettyEpc(unit.epc)}
            </code>
            <button className="btn-ghost p-2" title="Copy"
              onClick={() => { navigator.clipboard?.writeText(unit.epc); toast.info('EPC copied'); }}>
              <Copy size={15} />
            </button>
          </div>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label="Human label" value={<span className="font-mono">{unit.epc_readable}</span>} />
            <Row label="Company prefix" value={<span className="font-mono">{unit.epc_parts?.companyPrefix}</span>} />
            <Row label="Variant code" value={<span className="font-mono">{unit.epc_parts?.variantId}</span>} />
            <Row label="Unit serial" value={<span className="font-mono">{unit.epc_parts?.serial}</span>} />
            <Row label="Base64 (reader SDKs)" value={<span className="font-mono text-xs break-all">{unit.epc_base64}</span>} />
          </dl>
        </div>

        <div>
          <dl className="space-y-1.5 text-sm">
            <Row label="SKU" value={<span className="font-mono">{unit.variant_sku}</span>} />
            <Row label="Location" value={unit.location_name || '—'} />
            <Row label="Status" value={labelize(unit.status)} />
            <Row label="Tag encoded" value={unit.tag_encoded ? dateTime(unit.encoded_at) : 'Not yet'} />
            <Row label="Received" value={dateTime(unit.received_at)} />
            <Row label="Last seen" value={unit.last_seen_at ? dateTime(unit.last_seen_at) : 'Never scanned'} />
            <Row label="Sold" value={unit.sold_at ? dateTime(unit.sold_at) : '—'} />
            <Row label="Cost" value={money(unit.cost_price)} />
            <Row label="Selling price" value={money(unit.selling_price)} />
            <Row label="Source" value={unit.source_ref || '—'} />
          </dl>

          {unit.print_jobs?.length > 0 && (
            <div className="mt-4">
              <p className="label">Recent print jobs</p>
              <ul className="text-xs text-slate-600 space-y-1">
                {unit.print_jobs.map((j) => (
                  <li key={j.id} className="flex justify-between">
                    <span>{labelize(j.status)}{j.error ? ` — ${j.error}` : ''}</span>
                    <span className="text-slate-400">{dateTime(j.created_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {zpl && (
        <div className="mt-4">
          <p className="label flex items-center gap-1.5"><Cpu size={13} /> ZPL sent to {zpl.device.name} ({zpl.device.driver})</p>
          <pre className="text-[11px] bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto">{zpl.zpl}</pre>
          <p className="text-xs text-slate-500 mt-2">{zpl.message}</p>
        </div>
      )}
    </Modal>
  );
}

const Row = ({ label, value }) => (
  <div className="flex justify-between gap-3">
    <dt className="text-slate-500 shrink-0">{label}</dt>
    <dd className="text-slate-800 text-right min-w-0">{value}</dd>
  </div>
);
