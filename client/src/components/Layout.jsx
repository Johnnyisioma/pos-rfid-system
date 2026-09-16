import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Package, Boxes, Radio, ScanLine, ClipboardCheck, Search,
  Truck, Users, Receipt, RotateCcw, Calculator, Wallet, BarChart3, Settings as Cog,
  ShieldCheck, Menu, X, LogOut, MapPin, ChevronDown, WifiOff, CloudUpload, Printer,
  FileSpreadsheet, ArrowLeftRight, Tags,
} from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { initOffline, flushQueue } from '../lib/offline.js';
import { useToast } from './ui.jsx';

const NAV = [
  { section: 'Sell', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, perm: 'reports.read' },
    { to: '/pos', label: 'Point of Sale', icon: ShoppingCart, perm: 'sales.create' },
    { to: '/sales', label: 'Sales & invoices', icon: Receipt, perm: 'sales.read' },
    { to: '/returns', label: 'Returns & exchanges', icon: RotateCcw, perm: 'returns.read' },
    { to: '/register', label: 'Cash register', icon: Calculator, perm: 'register.open' },
  ]},
  { section: 'Stock', items: [
    { to: '/products', label: 'Products', icon: Package, perm: 'products.read' },
    { to: '/import-export', label: 'Import / export', icon: FileSpreadsheet, perm: 'products.write' },
    { to: '/inventory', label: 'Stock levels', icon: Boxes, perm: 'inventory.read' },
    { to: '/purchases', label: 'Purchases', icon: Truck, perm: 'purchases.read' },
    { to: '/transfers', label: 'Transfers', icon: ArrowLeftRight, perm: 'transfers.read' },
  ]},
  { section: 'RFID', items: [
    { to: '/rfid', label: 'Tagged units', icon: Radio, perm: 'rfid.scan' },
    { to: '/rfid/scan', label: 'Scan simulator', icon: ScanLine, perm: 'rfid.scan' },
    { to: '/rfid/stock-take', label: 'Stock take', icon: ClipboardCheck, perm: 'rfid.stocktake' },
    { to: '/rfid/find', label: 'Find an item', icon: Search, perm: 'rfid.find' },
  ]},
  { section: 'Business', items: [
    { to: '/customers', label: 'Customers', icon: Users, perm: 'customers.read' },
    { to: '/expenses', label: 'Expenses', icon: Wallet, perm: 'expenses.read' },
    { to: '/reports', label: 'Reports', icon: BarChart3, perm: 'reports.read' },
  ]},
  { section: 'Admin', items: [
    { to: '/settings', label: 'Settings', icon: Cog, perm: 'settings.read' },
    { to: '/devices', label: 'Hardware', icon: Printer, perm: 'settings.read' },
    { to: '/audit', label: 'Audit log', icon: ShieldCheck, perm: 'audit.read' },
  ]},
];

function LocationPicker({ compact }) {
  const { locations, locationId, switchLocation } = useAuth();
  const [open, setOpen] = useState(false);
  const current = locations.find((l) => l.id === locationId);
  if (!locations.length) return null;
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg bg-slate-800/70 px-3 py-2 text-sm text-slate-100 hover:bg-slate-700 w-full">
        <MapPin size={15} className="text-brand-400 shrink-0" />
        <span className="truncate flex-1 text-left">{current?.name || 'Choose a shop'}</span>
        <ChevronDown size={14} className="opacity-60" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full rounded-lg bg-white shadow-lg ring-1 ring-slate-200 py-1">
            {locations.map((l) => (
              <button key={l.id}
                onClick={() => { switchLocation(l.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${
                  l.id === locationId ? 'text-brand-700 font-medium' : 'text-slate-700'}`}>
                {l.name} <span className="text-slate-400 text-xs">({l.code})</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout, can } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [net, setNet] = useState({ online: navigator.onLine, queued: 0 });
  const loc = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => { setMobileOpen(false); }, [loc.pathname]);
  useEffect(() => initOffline(setNet), []);

  const sync = async () => {
    const res = await flushQueue();
    if (res.synced) toast.success(`${res.synced} offline sale(s) synced`);
    else if (res.error) toast.error(res.error);
    else toast.info('Nothing waiting to sync');
  };

  const sidebar = (
    <div className="flex h-full flex-col bg-slate-900">
      <div className="px-4 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="h-8 w-8 rounded-lg bg-brand-600 grid place-items-center shrink-0">
            <Tags size={17} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm leading-tight truncate">Retail POS</p>
            <p className="text-slate-400 text-[11px] leading-tight">RFID inventory</p>
          </div>
        </div>
        <LocationPicker />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {NAV.map((group) => {
          const items = group.items.filter((i) => !i.perm || can(i.perm));
          if (!items.length) return null;
          return (
            <div key={group.section}>
              <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {group.section}
              </p>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end}
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <item.icon size={16} className="shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 p-3">
        <button onClick={() => navigate('/stock-take-mode')}
          className="w-full btn bg-emerald-600 text-white hover:bg-emerald-700 mb-2">
          <ScanLine size={16} /> Stock Take Mode
        </button>
        <div className="flex items-center gap-2 px-1">
          <div className="h-8 w-8 rounded-full bg-slate-700 grid place-items-center text-xs font-semibold text-white shrink-0">
            {user?.name?.split(' ').map((s) => s[0]).slice(0, 2).join('')}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white truncate leading-tight">{user?.name}</p>
            <p className="text-[11px] text-slate-400 capitalize leading-tight">{user?.role}</p>
          </div>
          <button onClick={logout} title="Sign out" className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100">
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-60 z-30">{sidebar}</aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setMobileOpen(false)} />
          <div className="relative w-64 h-full">{sidebar}</div>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-200">
          <div className="flex items-center gap-3 px-4 h-14">
            <button className="lg:hidden btn-ghost p-2" onClick={() => setMobileOpen(true)}>
              <Menu size={20} />
            </button>
            <div className="flex-1" />
            {!net.online && (
              <span className="badge bg-amber-100 text-amber-800 gap-1.5">
                <WifiOff size={13} /> Offline
              </span>
            )}
            {net.queued > 0 && (
              <button onClick={sync} className="badge bg-brand-100 text-brand-800 gap-1.5 hover:bg-brand-200">
                <CloudUpload size={13} /> {net.queued} to sync
              </button>
            )}
            <button onClick={() => navigate('/pos')} className="btn-primary">
              <ShoppingCart size={16} /> <span className="hidden sm:inline">New sale</span>
            </button>
          </div>
        </header>

        <main className="p-4 sm:p-6 max-w-[1600px] mx-auto">
          <Outlet context={{ net }} />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
