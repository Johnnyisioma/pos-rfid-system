import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardCheck, Play, CheckCircle2, AlertTriangle, XCircle, MapPin, ScanLine, Trash2,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { num, money, dateTime, pct, labelize } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, useToast, ScanInput, Stat, Spinner, Tabs, ConfirmButton,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';

export default function StockTake() {
  const { locationId, location, can } = useAuth();
  const toast = useToast();
  const [list, setList] = useState(null);
  const [current, setCurrent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [bulk, setBulk] = useState('');
  const [tab, setTab] = useState('missing');
  const [reconciling, setReconciling] = useState(false);

  const loadList = useCallback(() =>
    api.get('/api/rfid/stock-takes').then(setList).catch(() => setList([])), []);
  const openTake = useCallback((id) =>
    api.get(`/api/rfid/stock-takes/${id}`).then(setCurrent).catch((e) => toast.error(e.message)), []); // eslint-disable-line

  useEffect(() => { loadList(); }, [loadList, locationId]);
  useEffect(() => {
    if (!list) return;
    const open = list.find((t) => t.status === 'open' && t.location_id === locationId);
    if (open && !current) openTake(open.id);
  }, [list, locationId]); // eslint-disable-line

  const start = async () => {
    setBusy(true);
    try {
      const t = await api.post('/api/rfid/stock-takes', { location_id: locationId });
      await openTake(t.id);
      loadList();
      toast.success(t.resumed ? 'Resumed the open count' : `Count ${t.ref} started`);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const scan = async (codes) => {
    if (!current) return;
    try {
      const res = await api.post(`/api/rfid/stock-takes/${current.id}/scan`, { codes });
      await openTake(current.id);
      const s = res.summary;
      toast.success(`${s.added} new · ${s.duplicates} repeat · ${s.unknown} unknown`);
    } catch (e) { toast.error(e.message); }
  };

  const reconcile = async (opts) => {
    setBusy(true);
    try {
      const res = await api.post(`/api/rfid/stock-takes/${current.id}/reconcile`, opts);
      toast.success(`Count closed — ${res.wroteOff} written off, ${res.moved} relocated`);
      setReconciling(false);
      setCurrent(null);
      loadList();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  if (!list) return <Loading />;

  return (
    <>
      <PageHeader title="RFID stock take"
        subtitle={`Cycle count at ${location?.name || 'this shop'} — scan everything on the floor, then reconcile`}
        actions={
          <>
            <Link to="/stock-take-mode" className="btn-secondary"><ScanLine size={16} /> Handheld mode</Link>
            {can('rfid.stocktake') && !current && (
              <button className="btn-primary" onClick={start} disabled={busy}>
                {busy ? <Spinner /> : <Play size={16} />} Start a count
              </button>
            )}
          </>
        } />

      {current ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
            <Stat label="Expected" value={num(current.expected_count)} />
            <Stat label="Found" value={num(current.found.length)} tone="good" />
            <Stat label="Missing" value={num(current.missing.length)}
              tone={current.missing.length ? 'bad' : 'default'} />
            <Stat label="Unexpected" value={num(current.unexpected.length)}
              tone={current.unexpected.length ? 'warn' : 'default'} />
            <Stat label="Accuracy" value={pct(current.accuracy)}
              tone={current.accuracy >= 98 ? 'good' : current.accuracy >= 90 ? 'warn' : 'bad'} />
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="space-y-4">
              <Card title={current.ref} subtitle={`Started ${dateTime(current.started_at)} by ${current.started_by_name || '—'}`}>
                <ScanInput onScan={(code) => scan([code])} placeholder="Scan a tag…" />
                <div className="mt-3">
                  <textarea className="input font-mono text-xs" rows="4" value={bulk}
                    onChange={(e) => setBulk(e.target.value)}
                    placeholder="…or paste a batch of EPCs from the handheld" />
                  <div className="flex gap-2 mt-2">
                    <button className="btn-primary flex-1" disabled={!bulk.trim()}
                      onClick={() => { scan(bulk.split(/[\s,;]+/).filter(Boolean)); setBulk(''); }}>
                      Add batch
                    </button>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
                  {can('rfid.stocktake') && (
                    <>
                      <button className="btn-primary w-full" onClick={() => setReconciling(true)}>
                        <CheckCircle2 size={16} /> Reconcile & close
                      </button>
                      <ConfirmButton className="btn-secondary w-full" message="Cancel this count?"
                        onConfirm={async () => {
                          await api.post(`/api/rfid/stock-takes/${current.id}/cancel`, {});
                          setCurrent(null); loadList(); toast.info('Count cancelled');
                        }}>
                        Cancel count
                      </ConfirmButton>
                    </>
                  )}
                </div>
              </Card>
            </div>

            <div className="lg:col-span-2">
              <Card bodyClass="p-0">
                <Tabs value={tab} onChange={setTab} className="px-4 pt-2" tabs={[
                  { value: 'missing', label: 'Missing', count: current.missing.length },
                  { value: 'unexpected', label: 'Unexpected', count: current.unexpected.length },
                  { value: 'found', label: 'Found', count: current.found.length },
                ]} />

                {tab === 'missing' && (
                  current.missing.length === 0
                    ? <Empty title="Nothing missing" icon={CheckCircle2}
                        hint="Every unit the system expects has been scanned." />
                    : <div className="table-wrap">
                        <table className="data">
                          <thead><tr><th>Tag</th><th>Product</th><th>Variant</th>
                            <th className="text-right">Cost</th><th>Received</th></tr></thead>
                          <tbody>
                            {current.missing.map((m) => (
                              <tr key={m.unit_id}>
                                <td className="font-mono text-xs">{m.epc_readable}</td>
                                <td className="font-medium text-slate-800">{m.product_name}</td>
                                <td className="text-slate-600">{[m.size, m.color].filter(Boolean).join(' / ') || '—'}</td>
                                <td className="text-right tabular-nums">{money(m.cost_price)}</td>
                                <td className="text-xs text-slate-500">{dateTime(m.received_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                )}

                {tab === 'unexpected' && (
                  current.unexpected.length === 0
                    ? <Empty title="No surprises" icon={CheckCircle2} />
                    : <div className="table-wrap">
                        <table className="data">
                          <thead><tr><th>Scanned EPC</th><th>Result</th><th>Product</th><th>Belongs to</th></tr></thead>
                          <tbody>
                            {current.unexpected.map((s) => (
                              <tr key={s.id}>
                                <td className="font-mono text-xs">{s.epc}</td>
                                <td><Badge status={s.result} /></td>
                                <td>{s.product_name || <span className="text-slate-400">Not in this system</span>}</td>
                                <td className="text-slate-600">{s.unit_location || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                )}

                {tab === 'found' && (
                  current.found.length === 0
                    ? <Empty title="Nothing scanned yet" icon={ScanLine} />
                    : <div className="table-wrap max-h-[28rem] overflow-y-auto">
                        <table className="data">
                          <thead><tr><th>Tag</th><th>Product</th><th>Variant</th><th>Scanned</th></tr></thead>
                          <tbody>
                            {current.found.map((s) => (
                              <tr key={s.id}>
                                <td className="font-mono text-xs">{s.epc_readable || s.epc}</td>
                                <td className="font-medium text-slate-800">{s.product_name}</td>
                                <td className="text-slate-600">{[s.size, s.color].filter(Boolean).join(' / ') || '—'}</td>
                                <td className="text-xs text-slate-500">{dateTime(s.scanned_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                )}
              </Card>
            </div>
          </div>
        </>
      ) : (
        <Card bodyClass="p-0">
          {list.length === 0 ? (
            <Empty title="No counts recorded yet" icon={ClipboardCheck}
              hint="Start a count, walk the floor with the handheld, then reconcile what was and wasn't found." />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Reference</th><th>Location</th><th>Status</th>
                  <th className="text-right">Expected</th><th className="text-right">Found</th>
                  <th className="text-right">Missing</th><th>Started</th><th></th></tr></thead>
                <tbody>
                  {list.map((t) => (
                    <tr key={t.id}>
                      <td className="font-mono text-xs font-medium text-brand-700">{t.ref}</td>
                      <td>{t.location_name}</td>
                      <td><Badge status={t.status} /></td>
                      <td className="text-right tabular-nums">{num(t.expected_count)}</td>
                      <td className="text-right tabular-nums">{num(t.found_count)}</td>
                      <td className="text-right tabular-nums">{num(t.missing_count)}</td>
                      <td className="text-xs text-slate-500 whitespace-nowrap">{dateTime(t.started_at)}</td>
                      <td className="text-right">
                        <button className="btn-ghost text-xs" onClick={() => openTake(t.id)}>Open</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {reconciling && current && (
        <ReconcileModal take={current} busy={busy} onClose={() => setReconciling(false)} onConfirm={reconcile} />
      )}
    </>
  );
}

function ReconcileModal({ take, onClose, onConfirm, busy }) {
  const [writeOff, setWriteOff] = useState(true);
  const [moveStrays, setMoveStrays] = useState(true);
  const strays = take.unexpected.filter((s) => s.result === 'wrong_location').length;
  const missingValue = take.missing.reduce((s, m) => s + Number(m.cost_price || 0), 0);

  return (
    <Modal open onClose={onClose} title="Reconcile the count" size="sm"
      subtitle={`${take.ref} · ${take.missing.length} missing, ${strays} found from another branch`}
      footer={<><button className="btn-secondary" onClick={onClose}>Back</button>
        <button className="btn-primary" disabled={busy}
          onClick={() => onConfirm({ write_off_missing: writeOff, move_strays: moveStrays })}>
          {busy ? <Spinner /> : <CheckCircle2 size={16} />} Close the count
        </button></>}>
      <div className="space-y-3">
        <label className="flex items-start gap-3 rounded-lg ring-1 ring-slate-200 p-3">
          <input type="checkbox" checked={writeOff} onChange={(e) => setWriteOff(e.target.checked)}
            className="rounded border-slate-300 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-slate-800">
              Write off {take.missing.length} missing unit(s)
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Marks them lost, reduces stock and records an adjustment worth {money(missingValue)} at cost.
              Leave unticked to investigate first.
            </p>
          </div>
        </label>

        <label className="flex items-start gap-3 rounded-lg ring-1 ring-slate-200 p-3">
          <input type="checkbox" checked={moveStrays} onChange={(e) => setMoveStrays(e.target.checked)}
            className="rounded border-slate-300 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
              <MapPin size={14} /> Relocate {strays} unit(s) found here but recorded elsewhere
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Moves them to this shop and adjusts both branches' stock.
            </p>
          </div>
        </label>

        {take.unexpected.some((s) => s.result === 'unknown') && (
          <p className="text-xs text-amber-800 bg-amber-50 rounded-lg p-3 flex gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            Some scanned tags are not registered in this system at all. They are recorded on the count
            but no stock is changed — check whether they belong to another store.
          </p>
        )}
      </div>
    </Modal>
  );
}
