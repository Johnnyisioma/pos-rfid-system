import { useEffect, useState } from 'react';
import { Server, CheckCircle2, AlertTriangle, Loader2, Wifi } from 'lucide-react';
import { Field } from '../components/ui.jsx';
import { getServerUrl, setServerUrl, probeServer } from '../lib/platform.js';

/**
 * First launch of the Android app: where is the shop's server?
 *
 * The browser never sees this — there the app is already being served by the
 * server it talks to. The APK is different: the page comes out of the phone, so
 * until someone types an address the app has nobody to ask.
 *
 * It refuses to save an address until /api/health has answered from it. An app
 * that accepts a typo and then fails on every screen afterwards is worse than
 * one that says "no answer from that address" while the person is still stood
 * there able to fix it.
 */
export default function ServerSetup({ onReady }) {
  const [value, setValue] = useState(getServerUrl());
  const [state, setState] = useState('idle');   // idle | testing | ok | error
  const [error, setError] = useState('');
  const [health, setHealth] = useState(null);

  useEffect(() => { setState('idle'); setError(''); }, [value]);

  const test = async (save) => {
    setState('testing');
    setError('');
    try {
      const res = await probeServer(value);
      setHealth(res.health);
      setState('ok');
      if (save) {
        setServerUrl(res.base);
        // A full reload is the honest way to re-enter the app with a different
        // API origin: every cached response and in-flight request belonged to
        // the old one.
        setTimeout(() => (onReady ? onReady(res.base) : window.location.reload()), 600);
      }
    } catch (e) {
      setState('error');
      setError(e.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 grid place-items-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-brand-600 grid place-items-center mx-auto mb-3">
            <Server size={26} className="text-white" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Connect to your shop</h1>
          <p className="text-sm text-slate-500 mt-1">
            Type the web address you use for the POS on a computer. You only do this once.
          </p>
        </div>

        <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-5 space-y-4">
          <Field label="Server address"
            hint="For example pos-rfid-system.up.railway.app, or 192.168.1.20:3000 on a shop network">
            <input className="input" autoFocus autoCapitalize="none" autoCorrect="off"
              inputMode="url" spellCheck="false" placeholder="your-shop.up.railway.app"
              value={value} onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') test(true); }} />
          </Field>

          {state === 'error' && (
            <div className="rounded-xl bg-rose-50 ring-1 ring-rose-200 p-3 flex gap-2.5">
              <AlertTriangle size={18} className="text-rose-600 shrink-0 mt-0.5" />
              <p className="text-sm text-rose-800">{error}</p>
            </div>
          )}
          {state === 'ok' && (
            <div className="rounded-xl bg-emerald-50 ring-1 ring-emerald-200 p-3 flex gap-2.5">
              <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-sm text-emerald-800">
                <p className="font-medium">Connected.</p>
                {health?.time && (
                  <p className="text-emerald-700/80 text-xs mt-0.5">
                    Server clock: {new Date(health.time).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button className="btn-secondary flex-1" disabled={!value || state === 'testing'}
              onClick={() => test(false)}>
              {state === 'testing' ? <Loader2 size={16} className="animate-spin" /> : <Wifi size={16} />}
              Test
            </button>
            <button className="btn-primary flex-1" disabled={!value || state === 'testing'}
              onClick={() => test(true)}>
              Save and continue
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-400 text-center mt-4 leading-relaxed">
          Wrong address later? Settings → Device has it, and the app will ask again if the
          server ever stops answering.
        </p>
      </div>
    </div>
  );
}
