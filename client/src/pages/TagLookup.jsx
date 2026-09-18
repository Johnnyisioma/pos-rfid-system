import { useEffect, useState } from 'react';
import { ScanLine, Radio, Trash2, CheckCircle2, XCircle, Info } from 'lucide-react';
import { api } from '../lib/api.js';
import { money, num, prettyEpc, dateTime, labelize, ago } from '../lib/format.js';
import { Card, Empty, Badge, useToast, ScanInput, Loading, Field, Spinner } from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';

export default function TagLookup() {
  const toast = useToast();
  const { locationId } = useAuth();
  const [results, setResults] = useState([]);
  const [bulk, setBulk] = useState('');
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState([]);

  const loadRecent = () => api.get('/api/rfid/scan-events?limit=15').then(setRecent).catch(() => {});
  useEffect(() => { loadRecent(); }, [locationId]);


  const scan = async (codes) => {
    setBusy(true);
    try {
      const res = await api.post('/api/rfid/resolve', { codes, context: 'lookup' });
      setResults((p) => [...res.results, ...p].slice(0, 200));
      loadRecent();
      const hit = res.resolved;
      if (hit === res.count) toast.success(`${hit} tag(s) resolved`);
      else toast.info(`${hit} of ${res.count} resolved`);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Tag lookup"
        subtitle="Scan, type or paste a code and see exactly which unit it is" />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card title="Single lookup"
            subtitle="Pull the trigger with this page open, or type a code by hand if a tag will not read">
            <ScanInput onScan={(code) => scan([code])} />
            <p className="text-xs text-slate-500 mt-3">
              Formats accepted: raw hex, spaced hex (<code>3035 0000 …</code>), <code>epc:3035…</code>,
              the printed label, a SKU, or a barcode.
            </p>
          </Card>

          <Card title="Bulk paste" subtitle="Paste many codes — one per line, or separated by commas/spaces">
            <textarea className="input font-mono text-xs" rows="5" value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              placeholder={'3035000000000A0000000001\n3035000000000A0000000002'} />
            <div className="flex gap-2 mt-2">
              <button className="btn-primary" disabled={!bulk.trim() || busy}
                onClick={() => { scan(bulk.split(/[\s,;]+/).filter(Boolean)); setBulk(''); }}>
                <ScanLine size={16} /> Resolve all
              </button>
              <button className="btn-secondary" onClick={() => setBulk('')}>Clear</button>
            </div>
          </Card>

          <Card title={`Results (${results.length})`} bodyClass="p-0"
            actions={results.length > 0 && (
              <button className="btn-ghost text-xs" onClick={() => setResults([])}>
                <Trash2 size={14} /> Clear
              </button>
            )}>
            {results.length === 0 ? (
              <Empty title="Scan something to see how the system resolves it" icon={Radio}
                hint="Two identical products have different EPCs, so both are counted separately." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {results.map((r, i) => (
                  <li key={i} className="p-4">
                    <div className="flex items-start gap-3">
                      {r.resolved
                        ? <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                        : r.matched_variant
                          ? <Info size={18} className="text-amber-600 shrink-0 mt-0.5" />
                          : <XCircle size={18} className="text-rose-600 shrink-0 mt-0.5" />}
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs text-slate-500 break-all">{prettyEpc(r.epc) || r.input}</p>
                        {r.resolved ? (
                          <>
                            <p className="text-sm font-medium text-slate-800 mt-0.5">{r.unit.product_name}</p>
                            <p className="text-xs text-slate-600">
                              {[r.unit.size, r.unit.color].filter(Boolean).join(' / ') || 'Default'} ·{' '}
                              <span className="font-mono">{r.unit.variant_sku}</span> · {money(r.unit.selling_price)}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                              <Badge status={r.unit.status} />
                              <Badge>{r.unit.location_name || 'No location'}</Badge>
                              <Badge>Unit #{r.unit.serial}</Badge>
                              {r.unit.tag_encoded ? <Badge status="found">Tag encoded</Badge>
                                : <Badge status="unexpected">Tag pending</Badge>}
                            </div>
                          </>
                        ) : (
                          <p className="text-sm text-slate-700 mt-0.5">{r.message}</p>
                        )}
                        {r.parts && (
                          <p className="text-[11px] text-slate-400 mt-1">
                            prefix {r.parts.companyPrefix} · variant {r.parts.variantId} · serial {r.parts.serial}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="How real hardware plugs in">
            <ol className="text-sm text-slate-600 space-y-2.5 list-decimal list-inside">
              <li>
                <strong>Handheld reader.</strong> Its companion app posts reads to{' '}
                <code className="text-xs bg-slate-100 px-1 rounded">POST /api/rfid/scan-events</code>{' '}
                as <code className="text-xs">{'{epcs:[…]}'}</code>. Keyboard-wedge readers work with no setup at all —
                they simply type into the box on the left.
              </li>
              <li>
                <strong>Zebra printer.</strong> Register it under Hardware with driver{' '}
                <code className="text-xs bg-slate-100 px-1 rounded">zebra_zpl_tcp</code>, host = printer IP,
                port 9100. The ZPL you can inspect for any unit then goes down that socket.
              </li>
              <li>
                <strong>Nothing else changes.</strong> Every EPC is built and read in one service, so the
                rest of the system never needs to know which mode you are in.
              </li>
            </ol>
          </Card>

          <Card title="Recent scans" bodyClass="p-0">
            {recent.length === 0 ? <Empty title="No scans recorded yet" /> : (
              <ul className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                {recent.map((s) => (
                  <li key={s.id} className="px-4 py-2.5">
                    <div className="flex justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] text-slate-500 truncate">{s.epc}</p>
                        <p className="text-sm text-slate-800 truncate">
                          {s.product_name || <span className="text-rose-600">Unrecognised tag</span>}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge>{labelize(s.context)}</Badge>
                        <p className="text-[11px] text-slate-400 mt-0.5">{ago(s.created_at)}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
