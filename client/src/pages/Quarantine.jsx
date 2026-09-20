import { useCallback, useEffect, useState } from 'react';
import {
  ShieldAlert, Radio, Square, CheckCircle2, PackageX, Wrench, Undo2, Truck, AlertTriangle,
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { num, dateTime, variantLabel } from '../lib/format.js';
import { Card, Loading, Empty, Badge, Modal, useToast, Field, Spinner, Stat, Tabs, FeatureOff } from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useRfidScan } from '../lib/useRfidScan.jsx';
import { useTabParam } from '../lib/useTabParam.js';

/**
 * Quarantine.
 *
 * A damaged shoe is neither stock nor shrinkage. Left in stock the till will
 * cheerfully sell it; written off on the spot, the supplier claim goes with
 * it. So it sits here: out of the sellable figure, still a real unit with its
 * history intact, waiting for somebody to decide.
 *
 * Built around the reader because that is where the item is — on the floor, in
 * somebody's hand — not at a desk with its paperwork.
 */
const REASONS = [
  { key: 'damaged', label: 'Damaged' },
  { key: 'wrong_item', label: 'Wrong item sent' },
  { key: 'customer_return', label: 'Came back from a customer' },
  { key: 'supplier_fault', label: 'Supplier fault' },
  { key: 'other', label: 'Something else' },
];

const OUTCOMES = [
  { key: 'returned_to_stock', label: 'Back in stock', icon: Undo2,
    hint: 'Nothing wrong with it after all.' },
  { key: 'repaired', label: 'Repaired', icon: Wrench,
    hint: 'Fixed and sellable again.' },
  { key: 'returned_to_vendor', label: 'Back to the supplier', icon: Truck,
    hint: 'Leaves stock against a supplier claim.' },
  { key: 'written_off', label: 'Written off', icon: PackageX,
    hint: 'A loss. Shows up in the shrinkage report.' },
];

export default function Quarantine() {
  const toast = useToast();
  const { can, location, feature, settings } = useAuth();
  const [tab, setTab] = useTabParam('pending');
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [resolving, setResolving] = useState(null);

  const load = useCallback(async () => {
    // Hooks run before the feature check below can return, so the guard has to
    // be here too — otherwise a bookmarked URL fires a request the server is
    // going to refuse, and the console fills with 403s for a setting.
    if (!settings || !feature('quarantine')) return;
    try {
      setData(await api.get(`/api/quarantine${qs({ outcome: tab === 'all' ? '' : tab })}`));
    } catch { setData({ data: [], totals: {} }); }
  }, [tab, feature, settings]);
  useEffect(() => { load(); }, [load]);

  if (!settings) return <Loading />;
  if (!feature('quarantine')) {
    return <FeatureOff title="Quarantine"
      hint="Damaged and disputed items are going straight to a stock adjustment instead." />;
  }
  if (!data) return <Loading />;

  return (
    <>
      <PageHeader title="Quarantine"
        subtitle="Items pulled out of sellable stock until somebody decides what happens to them"
        actions={can('quarantine.write') && (
          <button className="btn-primary" onClick={() => setAdding(true)}>
            <ShieldAlert size={16} /> Quarantine an item
          </button>
        )} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Stat label="Waiting for a decision" value={num(data.totals?.pending || 0)}
          icon={ShieldAlert} tone={data.totals?.pending ? 'warn' : 'default'} sub={location?.name} />
        <Stat label="All time" value={num(data.totals?.total || 0)} />
      </div>

      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'pending', label: 'Waiting' },
        { value: 'returned_to_stock', label: 'Back in stock' },
        { value: 'returned_to_vendor', label: 'To supplier' },
        { value: 'written_off', label: 'Written off' },
        { value: 'all', label: 'Everything' },
      ]} />

      <Card bodyClass="p-0">
        {data.data.length === 0 ? (
          <Empty title="Nothing here" icon={CheckCircle2}
            hint={tab === 'pending'
              ? 'No items are waiting for a decision.'
              : 'Nothing has been dealt with this way yet.'} />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th>Item</th><th>Tag</th><th>Reason</th><th>Raised</th><th>Outcome</th><th />
              </tr></thead>
              <tbody>
                {data.data.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <p className="font-medium text-slate-800">{q.product_name}</p>
                      <p className="text-xs text-slate-500">
                        {variantLabel(q)} · {q.variant_sku}
                      </p>
                      {q.detail && <p className="text-xs text-slate-400 mt-0.5">{q.detail}</p>}
                    </td>
                    <td className="font-mono text-xs">{q.epc_readable || '—'}</td>
                    <td><Badge>{REASONS.find((x) => x.key === q.reason)?.label || q.reason}</Badge></td>
                    <td className="text-xs text-slate-500 whitespace-nowrap">
                      {dateTime(q.created_at)}<br />
                      <span className="text-slate-400">{q.raised_by_name}</span>
                    </td>
                    <td>
                      {q.outcome === 'pending'
                        ? <Badge status="held">Waiting</Badge>
                        : <Badge status="completed">
                            {OUTCOMES.find((x) => x.key === q.outcome)?.label || q.outcome}
                          </Badge>}
                    </td>
                    <td className="text-right">
                      {q.outcome === 'pending' && can('quarantine.write') && (
                        <button className="btn-ghost text-xs" onClick={() => setResolving(q)}>
                          Decide
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {adding && <AddToQuarantine onClose={() => setAdding(false)}
        onDone={() => { setAdding(false); load(); }} />}
      {resolving && <ResolveModal item={resolving} onClose={() => setResolving(null)}
        onDone={() => { setResolving(null); load(); }} />}
    </>
  );
}

function AddToQuarantine({ onClose, onDone }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('damaged');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);

  const scan = useRfidScan((c) => setCode(c), { dedupeMs: 500, tagsOnly: true });

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/api/quarantine', { epc: code.trim(), reason, detail });
      toast.success('Item quarantined — it is out of sellable stock');
      onDone();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} size="sm" title="Quarantine an item"
      subtitle="It stops being sellable straight away, and the stock figure comes down with it"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !code.trim()}>
            {busy ? <Spinner /> : <ShieldAlert size={16} />} Quarantine
          </button>
        </>
      }>
      <scan.CaptureField />

      <Field label="Tag" hint="Pull the trigger, or type the code from the label">
        <input className="input font-mono" autoFocus value={code}
          onChange={(e) => setCode(e.target.value)} placeholder="Scan the item" />
      </Field>

      {scan.native && (
        <button onClick={scan.toggle}
          className={`${scan.scanning ? 'btn-danger' : 'btn-secondary'} w-full mt-2`}>
          {scan.scanning ? <><Square size={16} /> Stop reading</> : <><Radio size={16} /> Read a tag</>}
        </button>
      )}

      <Field label="What is wrong with it" className="mt-3">
        <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
          {REASONS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
      </Field>
      <Field label="Detail" hint="What a manager would need to know next week" className="mt-3">
        <textarea className="input" rows={2} value={detail}
          onChange={(e) => setDetail(e.target.value)} placeholder="Sole split on the left shoe" />
      </Field>
    </Modal>
  );
}

function ResolveModal({ item, onClose, onDone }) {
  const toast = useToast();
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/api/quarantine/${item.id}/resolve`, { outcome, note });
      toast.success('Recorded');
      onDone();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} size="sm"
      title={`${item.product_name}`}
      subtitle={`${variantLabel(item)} · ${item.epc_readable || 'no tag'}`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !outcome}>
            {busy ? <Spinner /> : null} Record decision
          </button>
        </>
      }>
      <div className="space-y-2">
        {OUTCOMES.map((o) => {
          const Icon = o.icon;
          return (
            <button key={o.key} onClick={() => setOutcome(o.key)}
              className={`w-full text-left rounded-xl ring-1 p-3 flex items-start gap-3 ${
                outcome === o.key
                  ? 'ring-brand-400 bg-brand-50'
                  : 'ring-slate-200 hover:bg-slate-50'}`}>
              <Icon size={18} className="mt-0.5 shrink-0 text-slate-600" />
              <div>
                <p className="font-medium text-slate-800 text-sm">{o.label}</p>
                <p className="text-xs text-slate-500">{o.hint}</p>
              </div>
            </button>
          );
        })}
      </div>
      <Field label="Note" className="mt-3">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Optional — added to the history" />
      </Field>
      {outcome === 'written_off' && (
        <p className="text-xs text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-lg p-2.5 mt-3 flex gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          A write-off is a loss against this branch. If the supplier will take it back, choose that
          instead — it can still be written off later if they refuse.
        </p>
      )}
    </Modal>
  );
}
