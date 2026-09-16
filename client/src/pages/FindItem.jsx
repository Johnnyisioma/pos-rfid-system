import { useState } from 'react';
import { Search, MapPin, Radio, ArrowRightLeft, PackageSearch } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { num, dateTime, ago, variantLabel } from '../lib/format.js';
import { Card, Empty, Badge, Loading, useToast } from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';

export default function FindItem() {
  const { locationId, location } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);

  const search = async (e) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setBusy(true); setRows(null);
    try { setRows(await api.get(`/api/rfid/find${qs({ q: q.trim() })}`)); }
    catch (err) { toast.error(err.message); setRows([]); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Find an item"
        subtitle="A customer wants size 42 in black — where exactly is it?" />

      <Card className="mb-4">
        <form onSubmit={search} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-10 py-3" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Product name, SKU — e.g. “Oxford” or “MF-0001-42-BLACK”" />
          </div>
          <button className="btn-primary px-6">Find</button>
        </form>
      </Card>

      {busy && <Loading label="Looking…" />}

      {rows && rows.length === 0 && (
        <Empty title="Nothing matches that search" icon={PackageSearch}
          hint="Try a shorter term — part of the product name usually works best." />
      )}

      <div className="space-y-4">
        {rows?.map((v) => {
          const here = v.units.filter((u) => u.status === 'in_stock' && u.location_id === locationId);
          const elsewhere = v.units.filter((u) => u.location_id !== locationId && u.status === 'in_stock');
          const transit = v.units.filter((u) => u.status === 'in_transit');
          return (
            <Card key={v.id}
              title={v.product_name}
              subtitle={`${variantLabel(v)} · ${v.sku}`}
              actions={
                <Badge status={here.length ? 'in_stock' : elsewhere.length ? 'in_transit' : 'lost'}>
                  {here.length ? `${here.length} here` : elsewhere.length ? 'Other branch only' : 'None available'}
                </Badge>
              }>
              {v.units.length === 0 ? (
                <p className="text-sm text-slate-500">No physical units are in stock for this variant.</p>
              ) : (
                <>
                  {here.length > 0 && (
                    <Section icon={MapPin} title={`In ${location?.name}`} tone="text-emerald-700">
                      <UnitTable units={here} />
                    </Section>
                  )}
                  {elsewhere.length > 0 && (
                    <Section icon={ArrowRightLeft} title="At another branch" tone="text-amber-700">
                      <p className="text-xs text-slate-500 mb-2">
                        Raise a stock transfer to bring one over, or send the customer to that shop.
                      </p>
                      <UnitTable units={elsewhere} showLocation />
                    </Section>
                  )}
                  {transit.length > 0 && (
                    <Section icon={Radio} title="In transit" tone="text-slate-600">
                      <UnitTable units={transit} showLocation />
                    </Section>
                  )}
                </>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}

function Section({ icon: Icon, title, tone, children }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className={`text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-1.5 ${tone}`}>
        <Icon size={13} /> {title}
      </p>
      {children}
    </div>
  );
}

function UnitTable({ units, showLocation }) {
  return (
    <div className="rounded-lg ring-1 ring-slate-200 overflow-hidden">
      <table className="data">
        <thead>
          <tr>
            <th>Tag label</th><th>EPC</th>
            {showLocation && <th>Location</th>}
            <th>Status</th><th>Last seen</th><th>Received</th>
          </tr>
        </thead>
        <tbody>
          {units.map((u) => (
            <tr key={u.id}>
              <td className="font-mono text-xs font-medium">{u.epc_readable}</td>
              <td className="font-mono text-[11px] text-slate-500">{u.epc}</td>
              {showLocation && <td>{u.location_name}</td>}
              <td><Badge status={u.status} /></td>
              <td className="text-xs text-slate-500">{u.last_seen_at ? ago(u.last_seen_at) : 'never scanned'}</td>
              <td className="text-xs text-slate-500 whitespace-nowrap">{dateTime(u.received_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
