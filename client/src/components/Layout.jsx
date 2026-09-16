import { useEffect, useState, useMemo } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Package, Boxes, Radio, ScanLine, ClipboardCheck, Search,
  Truck, Users, Receipt, RotateCcw, Calculator, Wallet, BarChart3, Settings as Cog,
  ShieldCheck, Menu, X, LogOut, MapPin, ChevronDown, ChevronRight, WifiOff, CloudUpload,
  Printer, FileSpreadsheet, ArrowLeftRight, Tags, Plus, List, FolderTree, Layers,
  TrendingUp, FileText, Store, UserCog, Building2, Percent,
} from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { initOffline, flushQueue } from '../lib/offline.js';
import { useToast } from './ui.jsx';

/**
 * Sidebar navigation.
 *
 * Each area is a collapsible parent that opens onto its own pages, rather than
 * one long flat list. A group opens automatically when you are inside it, and
 * whatever you open by hand is remembered between visits.
 *
 * Sub-items that are tabs within a page carry `?tab=` — see useTabParam.
 */
const NAV = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/', end: true, perm: 'reports.read' },

  { label: 'Sell', icon: ShoppingCart, perm: 'sales.read', children: [
    { label: 'Point of Sale', to: '/pos', icon: ShoppingCart, perm: 'sales.create' },
    { label: 'All sales', to: '/sales', icon: Receipt, perm: 'sales.read' },
    { label: 'Unpaid invoices', to: '/sales?credit=true', icon: FileText, perm: 'sales.read' },
    { label: 'Returns & exchanges', to: '/returns?tab=new', icon: RotateCcw, perm: 'returns.read' },
    { label: 'Return history', to: '/returns?tab=history', icon: List, perm: 'returns.read' },
    { label: 'Cash register', to: '/register', icon: Calculator, perm: 'register.open' },
  ]},

  { label: 'Products', icon: Package, perm: 'products.read', children: [
    { label: 'All products', to: '/products', icon: List, perm: 'products.read' },
    { label: 'Add product', to: '/products/new', icon: Plus, perm: 'products.write' },
    { label: 'Categories & brands', to: '/settings?tab=catalog', icon: FolderTree, perm: 'products.write' },
    { label: 'Variation templates', to: '/settings?tab=catalog', icon: Layers, perm: 'products.write' },
    { label: 'Import / export', to: '/import-export', icon: FileSpreadsheet, perm: 'products.write' },
  ]},

  { label: 'Stock', icon: Boxes, perm: 'inventory.read', children: [
    { label: 'Stock levels', to: '/inventory?tab=levels', icon: Boxes, perm: 'inventory.read' },
    { label: 'Low stock', to: '/inventory?tab=low', icon: TrendingUp, perm: 'inventory.read' },
    { label: 'Stock adjustments', to: '/inventory?tab=adjustments', icon: Percent, perm: 'inventory.read' },
    { label: 'Movement ledger', to: '/inventory?tab=movements', icon: List, perm: 'inventory.read' },
    { label: 'Stock valuation', to: '/inventory?tab=valuation', icon: BarChart3, perm: 'inventory.read' },
    { label: 'Transfers', to: '/transfers', icon: ArrowLeftRight, perm: 'transfers.read' },
  ]},

  { label: 'Purchases', icon: Truck, perm: 'purchases.read', children: [
    { label: 'Purchase orders', to: '/purchases?tab=orders', icon: List, perm: 'purchases.read' },
    { label: 'Suppliers', to: '/purchases?tab=suppliers', icon: Store, perm: 'suppliers.read' },
    { label: 'Reorder suggestions', to: '/purchases?tab=reorder', icon: TrendingUp, perm: 'purchases.read' },
  ]},

  { label: 'RFID', icon: Radio, perm: 'rfid.scan', children: [
    { label: 'Tagged units', to: '/rfid', icon: Radio, perm: 'rfid.scan' },
    { label: 'Tags to encode', to: '/rfid?encoded=false', icon: Printer, perm: 'rfid.encode' },
    { label: 'Scan simulator', to: '/rfid/scan', icon: ScanLine, perm: 'rfid.scan' },
    { label: 'Stock take', to: '/rfid/stock-take', icon: ClipboardCheck, perm: 'rfid.stocktake' },
    { label: 'Find an item', to: '/rfid/find', icon: Search, perm: 'rfid.find' },
  ]},

  { label: 'Contacts', icon: Users, perm: 'customers.read', children: [
    { label: 'Customers', to: '/customers?tab=customers', icon: Users, perm: 'customers.read' },
    { label: 'Customer groups', to: '/customers?tab=groups', icon: Tags, perm: 'customers.read' },
  ]},

  { label: 'Expenses', icon: Wallet, perm: 'expenses.read', children: [
    { label: 'All expenses', to: '/expenses', icon: List, perm: 'expenses.read' },
    { label: 'Expense categories', to: '/settings?tab=catalog', icon: FolderTree, perm: 'expenses.write' },
  ]},

  { label: 'Reports', icon: BarChart3, perm: 'reports.read', children: [
    { label: 'Sales report', to: '/reports?tab=sales', icon: TrendingUp, perm: 'reports.read' },
    { label: 'Product performance', to: '/reports?tab=products', icon: Package, perm: 'reports.read' },
    { label: 'Profit & loss', to: '/reports?tab=pl', icon: BarChart3, perm: 'reports.read' },
    { label: 'VAT report', to: '/reports?tab=tax', icon: FileText, perm: 'reports.read' },
  ]},

  { label: 'Settings', icon: Cog, perm: 'settings.read', children: [
    { label: 'Business settings', to: '/settings?tab=business', icon: Building2, perm: 'settings.read' },
    { label: 'Receipt & invoice', to: '/settings?tab=receipt', icon: Receipt, perm: 'settings.read' },
    { label: 'Business locations', to: '/settings?tab=locations', icon: MapPin, perm: 'settings.read' },
    { label: 'Registers', to: '/settings?tab=registers', icon: Calculator, perm: 'settings.read' },
    { label: 'Staff & roles', to: '/settings?tab=users', icon: UserCog, perm: 'users.read' },
    { label: 'Hardware', to: '/devices', icon: Printer, perm: 'settings.read' },
    { label: 'Audit log', to: '/audit', icon: ShieldCheck, perm: 'audit.read' },
  ]},
];

const OPEN_KEY = 'pos.nav.open';

function LocationPicker() {
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

function NavGroup({ group, currentPath, currentSearch, openGroups, toggle }) {
  const { can } = useAuth();
  const children = (group.children || []).filter((c) => !c.perm || can(c.perm));

  const isChildActive = (child) => {
    const [path, query] = child.to.split('?');
    if (path !== currentPath) return false;
    if (!query) {
      // a bare path is active only when no sub-tab/filter is selected
      return !currentSearch || !/(^|&)(tab|credit|encoded)=/.test(currentSearch);
    }
    return currentSearch.includes(query);
  };

  const groupActive = children.some(isChildActive);
  const isOpen = openGroups[group.label] ?? groupActive;

  if (!children.length) return null;

  return (
    <div>
      <button onClick={() => toggle(group.label, !isOpen)}
        className={`nav-link w-full justify-between ${groupActive && !isOpen ? 'text-white' : ''}`}>
        <span className="flex items-center gap-2.5 min-w-0">
          <group.icon size={16} className="shrink-0" />
          <span className="truncate">{group.label}</span>
        </span>
        {isOpen ? <ChevronDown size={14} className="opacity-60 shrink-0" />
          : <ChevronRight size={14} className="opacity-60 shrink-0" />}
      </button>

      {isOpen && (
        <div className="mt-0.5 ml-3 pl-3 border-l border-slate-700/70 space-y-0.5">
          {children.map((child) => (
            <Link key={child.label + child.to} to={child.to}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
                isChildActive(child)
                  ? 'bg-brand-600 text-white font-medium'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
              {child.icon && <child.icon size={14} className="shrink-0 opacity-80" />}
              <span className="truncate">{child.label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout, can } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [net, setNet] = useState({ online: navigator.onLine, queued: 0 });
  const [openGroups, setOpenGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'); } catch { return {}; }
  });
  const loc = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => { setMobileOpen(false); }, [loc.pathname, loc.search]);
  useEffect(() => initOffline(setNet), []);

  const toggle = (label, open) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [label]: open };
      try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  };

  const sync = async () => {
    const res = await flushQueue();
    if (res.synced) toast.success(`${res.synced} offline sale(s) synced`);
    else if (res.error) toast.error(res.error);
    else toast.info('Nothing waiting to sync');
  };

  const visible = useMemo(
    () => NAV.filter((g) => !g.perm || can(g.perm)), [can]);

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

      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {visible.map((group) =>
          group.children ? (
            <NavGroup key={group.label} group={group} currentPath={loc.pathname}
              currentSearch={loc.search} openGroups={openGroups} toggle={toggle} />
          ) : (
            <NavLink key={group.label} to={group.to} end={group.end}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <group.icon size={16} className="shrink-0" />
              <span className="truncate">{group.label}</span>
            </NavLink>
          )
        )}
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
          <button onClick={logout} title="Sign out"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
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
