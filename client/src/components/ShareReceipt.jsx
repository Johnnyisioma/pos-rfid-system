import { useEffect, useState } from 'react';
import {
  MessageCircle, Smartphone, Mail, Link2, Copy, Check, Send, AlertTriangle,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { Modal, Field, Spinner, useToast } from './ui.jsx';

/**
 * Send a customer their receipt.
 *
 * Deliberately not an SMS gateway. The shop's phone already has WhatsApp on
 * it and the customer is standing at the counter, so what actually works is a
 * wa.me link that opens the chat with the message already written — no API
 * key, no per-message cost, no account to keep topped up, and it works on the
 * first day rather than after a procurement conversation.
 *
 * The receipt itself lives behind a one-off token, so the link is safe to hand
 * to somebody who has no login and shows them that sale and nothing else.
 */
const CHANNELS = [
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle,
    hint: 'Opens the chat with the message written' },
  { key: 'sms', label: 'Text message', icon: Smartphone, hint: 'Opens your phone’s messages app' },
  { key: 'email', label: 'Email', icon: Mail, hint: 'Opens your mail app' },
  { key: 'link', label: 'Just the link', icon: Link2, hint: 'Copy it and send it however you like' },
];

export default function ShareReceipt({ sale, open, onClose }) {
  const toast = useToast();
  const [channel, setChannel] = useState('whatsapp');
  const [address, setAddress] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setCopied(false);
    setAddress(sale?.customer_whatsapp || sale?.customer_phone || '');
  }, [open, sale]);

  const prepare = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/api/receipts/${sale.id}/share`, { channel, address });
      setResult(res);
      // Open it straight away — the customer is standing there, and a modal
      // that says "now press this other button" is a modal nobody finishes.
      if (channel !== 'link' && res.share_url) window.open(res.share_url, '_blank');
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { toast.error('Could not copy — select the link and copy it by hand.'); }
  };

  const needsAddress = channel !== 'link';

  return (
    <Modal open={open} onClose={onClose} size="sm"
      title="Send the receipt"
      subtitle={sale?.invoice_no}
      footer={
        result ? (
          <>
            <button className="btn-secondary mr-auto" onClick={() => setResult(null)}>
              Send another way
            </button>
            <button className="btn-primary" onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={prepare}
              disabled={busy || (needsAddress && !address.trim())}>
              {busy ? <Spinner /> : <Send size={16} />} Send
            </button>
          </>
        )
      }>
      {result ? (
        <div className="space-y-3">
          <div className="rounded-xl bg-emerald-50 ring-1 ring-emerald-200 p-3 text-sm text-emerald-900">
            {channel === 'link'
              ? 'Link ready.'
              : 'Your messaging app should have opened with the message ready to send.'}
          </div>
          <Field label="The customer's link"
            hint="Anyone with this link can see this one receipt. It shows nothing else.">
            <div className="flex gap-2">
              <input className="input font-mono text-xs" readOnly value={result.link}
                onFocus={(e) => e.target.select()} />
              <button className="btn-secondary shrink-0" onClick={copy}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </Field>
          {channel !== 'link' && result.share_url && (
            <a href={result.share_url} target="_blank" rel="noreferrer"
              className="btn-secondary w-full justify-center">
              Open it again
            </a>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {CHANNELS.map((c) => {
              const Icon = c.icon;
              return (
                <button key={c.key} onClick={() => setChannel(c.key)}
                  className={`rounded-xl ring-1 p-3 text-left ${
                    channel === c.key ? 'ring-brand-400 bg-brand-50' : 'ring-slate-200 hover:bg-slate-50'}`}>
                  <Icon size={18} className="text-slate-600 mb-1" />
                  <p className="text-sm font-medium text-slate-800">{c.label}</p>
                  <p className="text-[11px] text-slate-500 leading-tight">{c.hint}</p>
                </button>
              );
            })}
          </div>

          {needsAddress && (
            <Field label={channel === 'email' ? 'Email address' : 'Phone number'}
              hint={channel === 'whatsapp'
                ? 'A local number like 08031234567 is fine — it is converted for WhatsApp'
                : undefined}>
              <input className="input" value={address} autoFocus
                inputMode={channel === 'email' ? 'email' : 'tel'}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={channel === 'email' ? 'customer@example.com' : '08031234567'} />
            </Field>
          )}

          {channel === 'whatsapp' && !address.trim() && (
            <p className="text-xs text-slate-500 flex gap-2 mt-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-500" />
              No number on file for this customer. Type theirs in — it is not saved to their record
              from here.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
