import { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, Plus, Trash2, FileText, StickyNote, Download } from 'lucide-react';
import { api, url as apiUrl, getToken } from '../lib/api.js';
import { dateTime } from '../lib/format.js';
import { Card, Empty, Spinner, useToast } from './ui.jsx';

/**
 * Notes and file attachments on any record (a sale, a purchase, an expense).
 * A signed delivery note, a supplier's invoice photo, a "customer wants it
 * gift-wrapped" note — all kept with the transaction they belong to.
 */
export default function Attachments({ entityType, entityId, canWrite = true }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(() => api.get(`/api/documents/attachments/${entityType}/${entityId}`)
    .then(setRows).catch(() => setRows([])), [entityType, entityId]);
  useEffect(() => { load(); }, [load]);

  const addNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try { await api.post(`/api/documents/attachments/${entityType}/${entityId}`, { body: note }); setNote(''); load(); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      await api.upload(`/api/documents/attachments/${entityType}/${entityId}`, file);
      toast.success('Attached'); load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const remove = async (id) => {
    try { await api.del(`/api/documents/attachments/${id}`); load(); }
    catch (e) { toast.error(e.message); }
  };

  // A file download needs the auth header, so fetch as a blob rather than a bare link.
  const download = async (a) => {
    try {
      const res = await fetch(apiUrl(`/api/documents/attachments/${a.id}/file`),
        { headers: { Authorization: `Bearer ${getToken()}` } });
      const blob = await res.blob();
      const u = URL.createObjectURL(blob);
      const el = document.createElement('a');
      el.href = u; el.download = a.file_name || 'file'; document.body.appendChild(el); el.click(); el.remove();
      setTimeout(() => URL.revokeObjectURL(u), 2000);
    } catch (e) { toast.error(e.message); }
  };

  return (
    <Card title="Notes & attachments" bodyClass="p-4">
      {!rows ? <Spinner /> : rows.length === 0
        ? <Empty icon={Paperclip} title="Nothing attached" hint="Add a note or attach a file below." />
        : (
          <div className="space-y-2">
            {rows.map((a) => (
              <div key={a.id} className="flex items-start gap-2 rounded-lg ring-1 ring-slate-200 px-3 py-2">
                {a.kind === 'document' ? <FileText size={15} className="text-slate-400 mt-0.5" />
                  : <StickyNote size={15} className="text-slate-400 mt-0.5" />}
                <div className="min-w-0 flex-1">
                  {a.kind === 'document'
                    ? <button className="text-sm font-medium text-brand-700 hover:underline text-left"
                        onClick={() => download(a)}>{a.file_name}</button>
                    : <div className="text-sm">{a.body}</div>}
                  {a.title && <div className="text-xs text-slate-500">{a.title}</div>}
                  <div className="text-xs text-slate-400">{dateTime(a.created_at)}
                    {a.file_size ? ` · ${(a.file_size / 1024).toFixed(0)} KB` : ''}</div>
                </div>
                {a.kind === 'document' && <button className="btn-ghost p-1 text-slate-400" onClick={() => download(a)}>
                  <Download size={14} /></button>}
                {canWrite && <button className="btn-ghost p-1 text-rose-600" onClick={() => remove(a.id)}>
                  <Trash2 size={14} /></button>}
              </div>
            ))}
          </div>)}

      {canWrite && (
        <div className="mt-3 flex items-center gap-2">
          <input className="input text-sm flex-1" placeholder="Add a note…" value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addNote()} />
          <button className="btn-secondary text-xs" onClick={addNote} disabled={busy}><Plus size={14} /></button>
          <input ref={fileRef} type="file" className="hidden"
            onChange={(e) => upload(e.target.files?.[0])} />
          <button className="btn-secondary text-xs" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Paperclip size={14} /> File</button>
        </div>)}
    </Card>
  );
}
