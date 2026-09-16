import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Tags, LogIn } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { Spinner } from '../components/ui.jsx';

const DEMO = [
  ['Administrator', 'admin@millzee.test'],
  ['Manager', 'manager@millzee.test'],
  ['Cashier', 'cashier@millzee.test'],
  ['Inventory staff', 'stock@millzee.test'],
];

export default function Login() {
  const { user, login, loading } = useAuth();
  const loc = useLocation();
  const [email, setEmail] = useState('admin@millzee.test');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to={loc.state?.from || '/'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await login(email.trim(), password); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <div className="h-11 w-11 rounded-xl bg-brand-600 grid place-items-center">
            <Tags size={22} className="text-white" />
          </div>
          <div>
            <p className="text-white font-semibold text-lg leading-tight">Retail POS</p>
            <p className="text-slate-400 text-xs">Multi-location · RFID inventory</p>
          </div>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl p-6 shadow-xl">
          <h1 className="text-lg font-semibold text-slate-900 mb-1">Sign in</h1>
          <p className="text-sm text-slate-500 mb-5">Use your staff account to open the till.</p>

          <label className="label">Email</label>
          <input className="input mb-3" type="email" value={email} autoComplete="username"
            onChange={(e) => setEmail(e.target.value)} required />

          <label className="label">Password</label>
          <input className="input" type="password" value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} required />

          {error && <p className="mt-3 text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</p>}

          <button className="btn-primary w-full mt-5 btn-lg" disabled={busy}>
            {busy ? <Spinner /> : <LogIn size={18} />} Sign in
          </button>
        </form>

        <div className="mt-5 bg-slate-800/60 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-300 mb-2">Demo accounts — password <code className="text-brand-300">password123</code></p>
          <div className="grid grid-cols-2 gap-1.5">
            {DEMO.map(([role, addr]) => (
              <button key={addr} type="button" onClick={() => { setEmail(addr); setPassword('password123'); }}
                className="text-left rounded-lg px-2.5 py-2 bg-slate-700/50 hover:bg-slate-700 transition-colors">
                <span className="block text-xs font-medium text-white">{role}</span>
                <span className="block text-[10px] text-slate-400 truncate">{addr}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
