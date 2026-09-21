import { useCallback, useEffect, useState } from 'react';
import {
  FileText, MessageSquare, Settings2, ScrollText, Plus, Star, Trash2, Send, Check,
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, dateTime, labelize } from '../lib/format.js';
import {
  Card, Loading, Empty, Badge, Modal, Pagination, useToast, Field, Spinner, Tabs,
} from '../components/ui.jsx';
import { PageHeader } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTabParam } from '../lib/useTabParam.js';

/**
 * Documents & communications — design the receipt/invoice a customer sees,
 * write the messages the shop sends, and watch what actually went out.
 */
export default function Documents() {
  const { can } = useAuth();
  const [tab, setTab] = useTabParam('layouts');
  return (
    <>
      <PageHeader title="Documents & messages"
        subtitle="Invoice and receipt designer, message templates and the delivery log" />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: 'layouts', label: 'Invoice designer' },
        { value: 'templates', label: 'Message templates' },
        { value: 'settings', label: 'Delivery settings' },
        { value: 'log', label: 'Message log' },
      ]} />
      {tab === 'layouts' && <Layouts can={can} />}
      {tab === 'templates' && <Templates can={can} />}
      {tab === 'settings' && <NotifSettings can={can} />}
      {tab === 'log' && <MessageLog />}
    </>
  );
}

/* ───────────────────────── invoice designer ───────────────────────── */
const TOGGLES = [
  ['show_logo', 'Logo'], ['show_customer', 'Customer block'], ['show_tax', 'VAT line'],
  ['show_payment', 'Payment breakdown'], ['show_qr', 'e-Invoice QR'],
  ['show_signature', 'Signature lines'], ['show_barcode', 'Barcode'],
];

function Layouts({ can }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const [sampleSale, setSampleSale] = useState(null);

  const load = useCallback(() => api.get('/api/documents/layouts').then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/api/sales?limit=1').then((r) => setSampleSale(r.data?.[0]?.id || null)).catch(() => {}); }, []);

  const setDefault = async (id) => {
    try { await api.post(`/api/documents/layouts/${id}/default`, {}); toast.success('Set as default'); load(); }
    catch (e) { toast.error(e.message); }
  };
  const remove = async (id) => {
    if (!window.confirm('Delete this layout?')) return;
    try { await api.del(`/api/documents/layouts/${id}`); toast.success('Deleted'); load(); }
    catch (e) { toast.error(e.message); }
  };
  const preview = async (id) => {
    try {
      const r = await api.get(`/api/documents/render/sale/${sampleSale}?layout_id=${id}&format=json`);
      const w = window.open('', '_blank');
      if (w) { w.document.open(); w.document.write(r.html); w.document.close(); }
    } catch (e) { toast.error(e.message); }
  };
  if (!rows) return <Loading />;
  return (
    <>
      <div className="flex mb-3">
        {can('settings.write') && (
          <button className="btn-primary ml-auto text-sm"
            onClick={() => setEditing({ doc_type: 'receipt', paper: '80mm', accent_color: '#0f172a',
              show_logo: true, show_tax: true, show_customer: true, show_payment: true })}>
            <Plus size={14} /> New layout</button>)}
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.length === 0 && <Empty icon={FileText} title="No layouts" />}
        {rows.map((l) => (
          <Card key={l.id} bodyClass="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">{l.name}</div>
                <div className="text-xs text-slate-500 uppercase">{l.doc_type} · {l.paper}</div>
              </div>
              {l.is_default && <Badge status="success"><Star size={11} /> default</Badge>}
            </div>
            <div className="flex flex-wrap gap-1 mt-3">
              {TOGGLES.filter(([k]) => l[k]).map(([k, lbl]) => <Badge key={k} status="default">{lbl}</Badge>)}
            </div>
            <div className="flex gap-2 mt-4">
              {can('settings.write') && <button className="btn-secondary text-xs" onClick={() => setEditing(l)}>Edit</button>}
              {sampleSale && <button className="btn-ghost text-xs" onClick={() => preview(l.id)}>Preview</button>}
              {can('settings.write') && !l.is_default && (<>
                <button className="btn-ghost text-xs" onClick={() => setDefault(l.id)}>Make default</button>
                <button className="btn-ghost p-1.5 text-rose-600 ml-auto" onClick={() => remove(l.id)}><Trash2 size={14} /></button>
              </>)}
            </div>
          </Card>
        ))}
      </div>
      {editing && <LayoutEditor row={editing} sampleSale={sampleSale}
        onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
    </>
  );
}

function LayoutEditor({ row, sampleSale, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ ...row });
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  // live preview: save-less render by posting the draft is overkill; instead
  // preview the saved version, and refresh after save.
  const refreshPreview = useCallback(async (id) => {
    if (!sampleSale || !id) return;
    try {
      const r = await api.get(`/api/documents/render/sale/${sampleSale}?layout_id=${id}&format=json`);
      setPreview(r.html);
    } catch { setPreview(''); }
  }, [sampleSale]);
  useEffect(() => { if (row.id) refreshPreview(row.id); }, [row.id, refreshPreview]);

  const save = async () => {
    setBusy(true);
    try {
      const saved = f.id
        ? await api.put(`/api/documents/layouts/${f.id}`, f)
        : await api.post('/api/documents/layouts', f);
      toast.success('Layout saved');
      setF(saved);
      refreshPreview(saved.id);
      if (!row.id) onDone();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} size="xl" title={row.id ? 'Edit layout' : 'New layout'}
      footer={<><button className="btn-secondary" onClick={onClose}>Close</button>
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : null} Save</button></>}>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name"><input className="input" value={f.name || ''}
              onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
            <Field label="Document type">
              <select className="input" value={f.doc_type} onChange={(e) => set('doc_type', e.target.value)}>
                {['receipt', 'invoice', 'quotation', 'delivery'].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Paper">
              <select className="input" value={f.paper} onChange={(e) => set('paper', e.target.value)}>
                <option value="80mm">80mm thermal</option>
                <option value="58mm">58mm thermal</option>
                <option value="A4">A4</option>
              </select>
            </Field>
            <Field label="Accent colour">
              <input type="color" className="input h-10 p-1" value={f.accent_color || '#0f172a'}
                onChange={(e) => set('accent_color', e.target.value)} />
            </Field>
          </div>
          <Field label="Header (business name line)"><input className="input" value={f.header_text || ''}
            onChange={(e) => set('header_text', e.target.value)} placeholder="Leave blank to use business name" /></Field>
          <Field label="Sub-header"><input className="input" value={f.sub_header || ''}
            onChange={(e) => set('sub_header', e.target.value)} placeholder="RC number, slogan…" /></Field>
          <Field label="Logo URL"><input className="input" value={f.logo_url || ''}
            onChange={(e) => set('logo_url', e.target.value)} placeholder="https://… (or set in Settings)" /></Field>
          <Field label="Footer"><input className="input" value={f.footer_text || ''}
            onChange={(e) => set('footer_text', e.target.value)} /></Field>
          <Field label="Terms / notes"><textarea className="input" rows="2" value={f.terms_text || ''}
            onChange={(e) => set('terms_text', e.target.value)} placeholder="Returns policy, payment terms…" /></Field>
          <div className="flex flex-wrap gap-3">
            {TOGGLES.map(([k, lbl]) => (
              <label key={k} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={!!f[k]} onChange={(e) => set(k, e.target.checked)} /> {lbl}</label>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Live preview</div>
          {preview
            ? <iframe title="preview" srcDoc={preview}
                className="w-full h-[520px] rounded-lg ring-1 ring-slate-200 bg-white" />
            : <div className="h-[520px] rounded-lg ring-1 ring-slate-200 grid place-items-center text-sm text-slate-400 text-center px-4">
                {sampleSale ? 'Save to see the preview' : 'Record a sale first to preview a layout'}</div>}
        </div>
      </div>
    </Modal>
  );
}

/* ───────────────────────── message templates ───────────────────────── */
function Templates({ can }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api.get('/api/notifications/templates').then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    try {
      if (form.id) await api.put(`/api/notifications/templates/${form.id}`, form);
      else await api.post('/api/notifications/templates', form);
      toast.success('Template saved'); setEditing(null); load();
    } catch (e) { toast.error(e.message); }
  };
  if (!rows) return <Loading />;
  return (
    <Card bodyClass="p-0" title="Message templates"
      subtitle="Placeholders: {name} {invoice} {total} {balance} {link} {shop}"
      actions={can('settings.write') && (
        <button className="btn-primary text-xs" onClick={() => setEditing({ channel: 'whatsapp', key: 'sale_complete' })}>
          <Plus size={14} /> New template</button>)}>
      {rows.length === 0 ? <Empty icon={MessageSquare} title="No templates" /> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Event</th><th>Channel</th><th>Message</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="font-mono text-xs">{t.key}</td>
                  <td><Badge status="default">{t.channel}</Badge></td>
                  <td className="text-sm text-slate-600 max-w-md truncate">{t.body}</td>
                  <td><Badge status={t.is_active ? 'success' : 'muted'}>{t.is_active ? 'on' : 'off'}</Badge></td>
                  <td className="text-right">{can('settings.write') &&
                    <button className="btn-ghost text-xs" onClick={() => setEditing(t)}>Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>)}
      {editing && (
        <Modal open onClose={() => setEditing(null)} size="md"
          title={editing.id ? 'Edit template' : 'New template'}
          footer={<><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" onClick={() => save(editing)}>Save</button></>}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Event key"><input className="input font-mono" value={editing.key || ''}
                disabled={!!editing.id}
                onChange={(e) => setEditing({ ...editing, key: e.target.value })} placeholder="sale_complete" /></Field>
              <Field label="Channel">
                <select className="input" value={editing.channel} disabled={!!editing.id}
                  onChange={(e) => setEditing({ ...editing, channel: e.target.value })}>
                  {['whatsapp', 'sms', 'email'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            </div>
            {editing.channel === 'email' && (
              <Field label="Subject"><input className="input" value={editing.subject || ''}
                onChange={(e) => setEditing({ ...editing, subject: e.target.value })} /></Field>)}
            <Field label="Message body" hint="{name} {invoice} {total} {balance} {link} {shop}">
              <textarea className="input font-mono text-sm" rows="5" value={editing.body || ''}
                onChange={(e) => setEditing({ ...editing, body: e.target.value })} /></Field>
            {editing.id && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.is_active !== false}
                  onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> Active</label>)}
          </div>
        </Modal>)}
    </Card>
  );
}

/* ───────────────────────── delivery settings ───────────────────────── */
function NotifSettings({ can }) {
  const toast = useToast();
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/api/notifications/settings').then(setS).catch(() => setS({})); }, []);
  const save = async () => {
    setBusy(true);
    try { await api.put('/api/notifications/settings', s); toast.success('Saved'); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  if (!s) return <Loading />;
  const set = (k, v) => setS((p) => ({ ...p, [k]: v }));
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="Channels">
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!s.whatsapp_enabled} onChange={(e) => set('whatsapp_enabled', e.target.checked)} />
            WhatsApp <span className="text-xs text-slate-500">— works now, no account needed (wa.me links)</span></label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!s.sms_enabled} onChange={(e) => set('sms_enabled', e.target.checked)} />
            SMS <span className="text-xs text-slate-500">— needs a gateway below</span></label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!s.email_enabled} onChange={(e) => set('email_enabled', e.target.checked)} />
            Email</label>
          <div className="border-t border-slate-100 pt-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={!!s.auto_on_sale} onChange={(e) => set('auto_on_sale', e.target.checked)} />
              Automatically queue a receipt message on every sale</label>
            <p className="text-xs text-slate-500 mt-1">Only for sales with a customer who has a phone or email on file.</p>
          </div>
        </div>
      </Card>
      <Card title="SMS / Email provider" subtitle="Optional — leave blank to use WhatsApp links only">
        <div className="space-y-3">
          <Field label="SMS gateway URL"><input className="input" value={s.sms_gateway_url || ''}
            onChange={(e) => set('sms_gateway_url', e.target.value)} placeholder="https://api.provider.com/send" /></Field>
          <Field label="SMS sender ID"><input className="input" value={s.sms_sender_id || ''}
            onChange={(e) => set('sms_sender_id', e.target.value)} placeholder="MYSHOP" /></Field>
          <Field label="Email from address"><input className="input" value={s.email_from || ''}
            onChange={(e) => set('email_from', e.target.value)} placeholder="shop@example.com" /></Field>
          {can('settings.write') && (
            <button className="btn-primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : null} Save settings</button>)}
        </div>
      </Card>
    </div>
  );
}

/* ───────────────────────── message log ───────────────────────── */
function MessageLog() {
  const [data, setData] = useState(null);
  const [channel, setChannel] = useState('');
  const [page, setPage] = useState(1);
  const load = useCallback(() => api.get(`/api/notifications/log${qs({ channel, page, limit: 40 })}`)
    .then(setData).catch(() => setData({ data: [] })), [channel, page]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <Loading />;
  return (
    <>
      <div className="flex gap-2 mb-3">
        <select className="input w-auto text-sm" value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }}>
          <option value="">All channels</option>
          {['whatsapp', 'sms', 'email'].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <Card bodyClass="p-0">
        {data.data.length === 0 ? <Empty icon={ScrollText} title="Nothing sent yet"
          hint="Receipts and reminders you send show here." /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>When</th><th>Channel</th><th>To</th><th>Message</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {data.data.map((n) => (
                  <tr key={n.id}>
                    <td className="text-xs text-slate-500 whitespace-nowrap">{dateTime(n.created_at)}</td>
                    <td><Badge status="default">{n.channel}</Badge></td>
                    <td className="text-sm">{n.customer_name || n.recipient || '—'}</td>
                    <td className="text-sm text-slate-600 max-w-xs truncate">{n.body}</td>
                    <td><Badge status={n.status === 'sent' ? 'success' : n.status === 'failed' ? 'danger' : 'warning'}>
                      {n.status}</Badge></td>
                    <td className="text-right">{n.link &&
                      <a className="btn-ghost text-xs" href={n.link} target="_blank" rel="noreferrer">Open</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>)}
        <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
      </Card>
    </>
  );
}
