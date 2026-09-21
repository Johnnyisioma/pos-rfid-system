import { useEffect, useState, useMemo, useCallback } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Package, Boxes, Radio, ScanLine, ClipboardCheck, Search,
  Truck, Users, Receipt, RotateCcw, Calculator, Wallet, BarChart3, Settings as Cog,
  ShieldCheck, Menu, X, LogOut, MapPin, ChevronDown, ChevronRight, WifiOff, CloudUpload,
  Printer, FileSpreadsheet, ArrowLeftRight, Tags, Tag, Plus, List, FolderTree, Layers,
  TrendingUp, FileText, Store, UserCog, Building2, Percent, Landmark, Bell, PauseCircle,
  FileClock, PiggyBank, SlidersHorizontal, Coins, AlertTriangle, Users2, ScrollText, Keyboard,
  ShieldAlert, Percent as PercentIcon, Clock, Ruler, ClipboardList, Send, Wrench,
  BookOpen, ListTree, Scale, MessageSquare, Settings2,
} from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { initOffline, flushQueue } from '../lib/offline.js';
import { useToast, Modal } from './ui.jsx';
import { api } from '../lib/api.js';
import { money, num, ago } from '../lib/format.js';

/**
 * Sidebar navigation.
 *
 * Ordered the way a shop floor actually reaches for things: admin at the very
 * top where a cashier never looks, the daily transaction modules through the
 * middle, setup at the bottom. Long dropdowns are split into labelled blocks
 * rather than a dozen equal rows — twelve flat items is where a menu stops
 * being scannable. Where a document type has both, "add" comes before "list".
 */
const DIV = (label) => ({ type: 'divider', label });

const NAV = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/', end: true, perm: 'reports.read' },

  { label: 'User Management', icon: UserCog, perm: 'users.read', children: [
    { label: 'Staff', to: '/settings?tab=users', icon: Users },
    { label: 'Roles & permissions', to: '/settings?tab=roles', icon: ShieldCheck },
  ]},

  { label: 'Contacts', icon: Users2, perm: 'customers.read', feature: 'customers', children: [
    { label: 'Customers', to: '/customers?tab=customers', icon: Users },
    { label: 'Customer groups', to: '/customers?tab=groups', icon: Tags },
    { label: 'Suppliers', to: '/purchases?tab=suppliers', icon: Store, perm: 'suppliers.read' },
  ]},

  { label: 'Products', icon: Package, perm: 'products.read', children: [
    { label: 'All products', to: '/products', icon: List },
    { label: 'Add product', to: '/products/new', icon: Plus, perm: 'products.write' },
    DIV('Bulk actions'),
    { label: 'Import / export', to: '/import-export', icon: FileSpreadsheet, perm: 'products.write' },
    { label: 'Print RFID tags', to: '/rfid?encoded=false', icon: Printer, perm: 'rfid.encode' },
    DIV('Taxonomy'),
    { label: 'Categories & brands', to: '/settings?tab=catalog', icon: FolderTree, perm: 'products.write' },
    { label: 'Variation templates', to: '/settings?tab=catalog', icon: Layers, perm: 'products.write' },
    { label: 'Units & price tiers', to: '/catalog-setup?tab=units', icon: Ruler, perm: 'products.write' },
    { label: 'Bin locations', to: '/catalog-setup?tab=bins', icon: MapPin, perm: 'products.write' },
    { label: 'Label templates', to: '/catalog-setup?tab=labels', icon: Tags, perm: 'products.write' },
    { label: 'Tax rates', to: '/settings?tab=taxes', icon: Percent, perm: 'settings.read' },
  ]},

  { label: 'Purchases', icon: Truck, perm: 'purchases.read', feature: 'purchases', children: [
    { label: 'Requisitions', to: '/requisitions', icon: ClipboardCheck, perm: 'purchases.read' },
    { label: 'Add purchase order', to: '/purchases?tab=new', icon: Plus, perm: 'purchases.write' },
    { label: 'List purchases', to: '/purchases?tab=orders', icon: List },
    { label: 'Purchase returns / debit notes', to: '/purchases?tab=returns', icon: RotateCcw },
    DIV(),
    { label: 'Reorder suggestions', to: '/purchases?tab=reorder', icon: TrendingUp },
  ]},

  { label: 'Sell', icon: ShoppingCart, perm: 'sales.read', children: [
    { label: 'Point of Sale', to: '/pos', icon: ShoppingCart, perm: 'sales.create' },
    { label: 'All sales', to: '/sales', icon: Receipt },
    { label: 'Sales orders', to: '/sales-orders?tab=orders', icon: ClipboardList, perm: 'sales_orders.read', feature: 'sales_orders' },
    { label: 'Shipments', to: '/sales-orders?tab=shipments', icon: Send, perm: 'shipments.read', feature: 'sales_orders' },
    DIV('Open documents'),
    { label: 'Held sales', to: '/sales?status=held', icon: PauseCircle },
    { label: 'Drafts', to: '/sales?status=draft', icon: FileClock },
    { label: 'Quotations', to: '/sales?status=quotation', icon: FileText },
    { label: 'Layaway', to: '/sales?sale_type=layaway', icon: PiggyBank, feature: 'credit' },
    { label: 'Unpaid invoices', to: '/sales?credit=true', icon: Coins, feature: 'credit' },
    DIV(),
    { label: 'New return', to: '/returns?tab=new', icon: RotateCcw, perm: 'returns.create' },
    { label: 'Sell returns', to: '/returns?tab=history', icon: List, perm: 'returns.read' },
    { label: 'Services & warranties', to: '/services?tab=services', icon: Wrench, perm: 'products.read', feature: 'warranties' },
    { label: 'Cash register', to: '/register', icon: Calculator, perm: 'register.open' },
  ]},

  { label: 'Stock Transfers', icon: ArrowLeftRight, perm: 'transfers.read', feature: 'transfers', children: [
    { label: 'Add transfer', to: '/transfers?new=1', icon: Plus, perm: 'transfers.write' },
    { label: 'List transfers', to: '/transfers', icon: List },
  ]},

  { label: 'Stock', icon: Boxes, perm: 'inventory.read', children: [
    { label: 'Stock levels', to: '/inventory?tab=levels', icon: Boxes },
    { label: 'Low stock', to: '/inventory?tab=low', icon: AlertTriangle },
    DIV('Adjustments'),
    { label: 'Stock adjustments', to: '/inventory?tab=adjustments', icon: SlidersHorizontal },
    { label: 'Movement ledger', to: '/inventory?tab=movements', icon: ScrollText },
    { label: 'Stock valuation', to: '/inventory?tab=valuation', icon: BarChart3 },
  ]},

  { label: 'RFID', icon: Radio, perm: 'rfid.scan', feature: 'rfid', children: [
    { label: 'Tagged units', to: '/rfid', icon: Radio },
    { label: 'Tags to encode', to: '/rfid?encoded=false', icon: Printer, perm: 'rfid.encode' },
    { label: 'Tag stock', to: '/rfid/tag-stock', icon: Tag, perm: 'rfid.encode' },
    { label: 'Quarantine', to: '/rfid/quarantine', icon: ShieldAlert, perm: 'quarantine.write', feature: 'quarantine' },
    DIV(),
    { label: 'Tag lookup', to: '/rfid/lookup', icon: ScanLine },
    { label: 'Reader test', to: '/rfid/reader-test', icon: Keyboard },
    { label: 'Stock take', to: '/rfid/stock-take', icon: ClipboardCheck, perm: 'rfid.stocktake' },
    { label: 'Find an item', to: '/rfid/find', icon: Search, perm: 'rfid.find' },
  ]},

  { label: 'Commission', icon: PercentIcon, perm: 'commissions.read', feature: 'commissions', children: [
    { label: 'Commission ledger', to: '/commissions?tab=ledger', icon: Coins },
    { label: 'Commission rules', to: '/commissions?tab=rules', icon: PercentIcon, perm: 'commissions.write' },
  ] },

  { label: 'Expenses', icon: Wallet, perm: 'expenses.read', feature: 'expenses', children: [
    { label: 'Add expense', to: '/expenses?new=1', icon: Plus, perm: 'expenses.write' },
    { label: 'List expenses', to: '/expenses?tab=list', icon: List },
    { label: 'Recurring expenses', to: '/expenses?tab=recurring', icon: Clock, perm: 'expenses.write' },
    { label: 'Expense categories', to: '/settings?tab=catalog', icon: FolderTree, perm: 'expenses.write' },
  ]},

  { label: 'Payment Accounts', icon: Landmark, perm: 'reports.read', feature: 'accounts', children: [
    { label: 'List accounts', to: '/accounts', icon: Landmark },
    { label: 'Money in & out', to: '/reports?tab=payments', icon: Coins },
  ]},

  { label: 'Accounting', icon: BookOpen, perm: 'accounts.balance_sheet', children: [
    { label: 'Chart of accounts', to: '/accounting?tab=coa', icon: ListTree },
    { label: 'Journal', to: '/accounting?tab=journal', icon: BookOpen },
    { label: 'Trial balance', to: '/accounting?tab=trial', icon: Scale },
    { label: 'Balance sheet', to: '/accounting?tab=balance', icon: Building2 },
    { label: 'Profit & loss', to: '/accounting?tab=pl', icon: TrendingUp },
    { label: 'Tax groups', to: '/settings?tab=taxes', icon: Percent, perm: 'settings.read' },
  ]},

  { label: 'Documents & Messages', icon: FileText, perm: 'sales.read', children: [
    { label: 'Invoice designer', to: '/documents?tab=layouts', icon: FileText, perm: 'settings.read' },
    { label: 'Message templates', to: '/documents?tab=templates', icon: MessageSquare, perm: 'settings.read' },
    { label: 'Delivery settings', to: '/documents?tab=settings', icon: Settings2, perm: 'settings.write' },
    { label: 'Message log', to: '/documents?tab=log', icon: ScrollText },
  ]},

  { label: 'Reports', icon: BarChart3, perm: 'reports.read', children: [
    DIV('Money'),
    { label: 'Profit & loss', to: '/reports?tab=pl', icon: BarChart3 },
    { label: 'Z report', to: '/reports?tab=z', icon: Receipt },
    { label: 'Payments', to: '/reports?tab=payments', icon: Coins },
    { label: 'Payment by age', to: '/reports?tab=aging', icon: FileClock },
    { label: 'Purchase & sale', to: '/reports?tab=purchase-sale', icon: TrendingUp },
    DIV('Stock'),
    { label: 'Sales report', to: '/reports?tab=sales', icon: TrendingUp },
    { label: 'Product performance', to: '/reports?tab=products', icon: Package },
    { label: 'Shrinkage', to: '/reports?tab=shrinkage', icon: AlertTriangle },
    DIV('People'),
    { label: 'Supplier & customer', to: '/reports?tab=contacts', icon: Users2 },
    DIV('Audit'),
    { label: 'VAT report', to: '/reports?tab=tax', icon: FileText },
    { label: 'Activity log', to: '/audit', icon: ShieldCheck, perm: 'audit.read' },
  ]},

  { label: 'Settings', icon: Cog, perm: 'settings.read', children: [
    { label: 'Business settings', to: '/settings?tab=business', icon: Building2 },
    { label: 'Receipt & invoice', to: '/settings?tab=receipt', icon: Receipt },
    { label: 'Business locations', to: '/settings?tab=locations', icon: MapPin },
    { label: 'Registers', to: '/settings?tab=registers', icon: Calculator },
    { label: 'Tax rates', to: '/settings?tab=taxes', icon: Percent },
    { label: 'Payment accounts', to: '/accounts', icon: Landmark },
    { label: 'Hardware', to: '/devices', icon: Printer },
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
  const { can, feature } = useAuth();
  const children = (group.children || []).filter(
    (c) => c.type === 'divider'
      || ((!c.perm || can(c.perm)) && (!c.feature || feature(c.feature))));

  const isChildActive = (child) => {
    if (child.type === 'divider') return false;
    const [path, queryPart] = child.to.split('?');
    if (path !== currentPath) return false;
    if (!queryPart) return !currentSearch || !/(^|[?&])(tab|status|credit|encoded|sale_type|new)=/.test(currentSearch);
    return queryPart.split('&').every((pair) => currentSearch.includes(pair));
  };

  const groupActive = children.some(isChildActive);
  const isOpen = openGroups[group.label] ?? groupActive;
  const realChildren = children.filter((c) => c.type !== 'divider');
  if (!realChildren.length) return null;

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
          {children.map((child, i) =>
            child.type === 'divider' ? (
              <div key={`d${i}`} className="pt-2 pb-0.5">
                {child.label
                  ? <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-2.5">
                      {child.label}
                    </p>
                  : <div className="border-t border-slate-700/60 mx-2.5" />}
              </div>
            ) : (
              <Link key={child.label + child.to} to={child.to}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
                  isChildActive(child)
                    ? 'bg-brand-600 text-white font-medium'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
                {child.icon && <child.icon size={14} className="shrink-0 opacity-80" />}
                <span className="truncate">{child.label}</span>
              </Link>
            )
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- top bar widgets ---------------- */

function CalculatorWidget({ open, onClose }) {
  const [expr, setExpr] = useState('');
  const [result, setResult] = useState('');

  const press = (key) => {
    if (key === 'C') { setExpr(''); setResult(''); return; }
    if (key === '←') { setExpr((e) => e.slice(0, -1)); return; }
    if (key === '=') {
      try {
        if (!/^[0-9+\-*/.() %]*$/.test(expr)) throw new Error('bad');
        // eslint-disable-next-line no-new-func
        const value = Function(`"use strict"; return (${expr.replace(/%/g, '/100')})`)();
        setResult(Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '—');
      } catch { setResult('—'); }
      return;
    }
    setExpr((e) => e + key);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (/^[0-9+\-*/.]$/.test(e.key)) press(e.key);
      else if (e.key === 'Enter') press('=');
      else if (e.key === 'Backspace') press('←');
      else if (e.key.toLowerCase() === 'c') press('C');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, expr]); // eslint-disable-line

  return (
    <Modal open={open} onClose={onClose} title="Calculator" size="sm">
      <div className="rounded-lg bg-slate-900 text-white p-4 mb-3 text-right">
        <p className="font-mono text-sm text-slate-400 min-h-[20px] break-all">{expr || '0'}</p>
        <p className="font-mono text-3xl font-semibold tabular-nums">{result || '—'}</p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '%', '+'].map((k) => (
          <button key={k} onClick={() => press(k)}
            className="btn-secondary py-3 text-base font-medium">{k}</button>
        ))}
        <button onClick={() => press('C')} className="btn-secondary py-3">C</button>
        <button onClick={() => press('←')} className="btn-secondary py-3">←</button>
        <button onClick={() => press('=')} className="btn-primary py-3 col-span-2">=</button>
      </div>
    </Modal>
  );
}

function NotificationBell() {
  const { locationId } = useAuth();
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    api.get('/api/reports/alerts').then(setData).catch(() => {});
  }, [locationId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 120000);
    return () => clearInterval(t);
  }, [load]);

  const count = data?.count || 0;

  return (
    <div className="relative">
      <button onClick={() => { setOpen((o) => !o); load(); }}
        className="btn-ghost p-2 relative" title="Alerts">
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute top-0.5 right-0.5 h-4 min-w-[16px] px-1 rounded-full bg-rose-600
                           text-white text-[10px] font-semibold grid place-items-center">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-80 max-w-[92vw] rounded-xl bg-white shadow-xl
                          ring-1 ring-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100">
              <p className="font-semibold text-sm text-slate-800">Needs attention</p>
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
              {!data ? (
                <p className="p-4 text-sm text-slate-500">Loading…</p>
              ) : count === 0 ? (
                <p className="p-4 text-sm text-slate-500">Nothing needs attention right now.</p>
              ) : (
                <>
                  {data.tags_pending > 0 && (
                    <Link to="/rfid?encoded=false" onClick={() => setOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50">
                      <Printer size={15} className="text-amber-600 shrink-0" />
                      <span className="text-sm text-slate-700">
                        {num(data.tags_pending)} unit{data.tags_pending === 1 ? '' : 's'} waiting for an RFID tag
                      </span>
                    </Link>
                  )}
                  {data.low_stock.map((s) => (
                    <Link key={`s${s.variant_id}`} to={`/products/${s.product_id}`}
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-slate-50">
                      <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                      <span className="text-sm text-slate-700 min-w-0">
                        <span className="font-medium">{s.product_name}</span>{' '}
                        <span className="text-slate-500">
                          {[s.size, s.color].filter(Boolean).join(' / ')}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {num(s.quantity)} left · reorder at {num(s.reorder_point)}
                        </span>
                      </span>
                    </Link>
                  ))}
                  {data.unpaid.map((u) => (
                    <Link key={`u${u.id}`} to={`/sales/${u.id}`} onClick={() => setOpen(false)}
                      className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-slate-50">
                      <Coins size={15} className="text-rose-600 shrink-0 mt-0.5" />
                      <span className="text-sm text-slate-700 min-w-0">
                        <span className="font-medium">{money(u.balance_due)}</span> owed by {u.customer}
                        <span className="block text-xs text-slate-500">
                          {u.invoice_no} · {u.age_days} day{Number(u.age_days) === 1 ? '' : 's'} old
                        </span>
                      </span>
                    </Link>
                  ))}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TodaysProfit() {
  const { locationId } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    const load = () => api.get('/api/reports/today').then(setData).catch(() => {});
    load();
    const t = setInterval(load, 180000);
    return () => clearInterval(t);
  }, [locationId]);

  if (!data) return null;
  return (
    <Link to="/reports?tab=pl"
      className="hidden md:flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-1.5
                 ring-1 ring-emerald-200 hover:bg-emerald-100 transition-colors">
      <TrendingUp size={14} className="text-emerald-700 shrink-0" />
      <span className="text-xs text-emerald-900">
        <span className="opacity-70">Today</span>{' '}
        <span className="font-semibold tabular-nums">{money(data.gross_profit)}</span>
      </span>
    </Link>
  );
}

/* ---------------- shell ---------------- */

export default function Layout() {
  const { user, logout, can, feature } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [net, setNet] = useState({ online: navigator.onLine, queued: 0 });
  const [calcOpen, setCalcOpen] = useState(false);
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

  // A menu entry has to pass both gates: the person is allowed to use it, and
  // the shop has that part of the system switched on. A group whose children
  // have all been filtered out is dropped too — an empty dropdown is worse
  // than no dropdown.
  const visible = useMemo(() => NAV.filter((g) => {
    if (g.perm && !can(g.perm)) return false;
    if (g.feature && !feature(g.feature)) return false;
    if (!g.children) return true;
    return g.children.some((c) => c.type !== 'divider'
      && (!c.perm || can(c.perm)) && (!c.feature || feature(c.feature)));
  }), [can, feature]);

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

      {/* optional / hardware zone, walled off at the bottom so the core menu never grows */}
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
          <div className="flex items-center gap-2 px-4 h-14">
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

            {/* the owner's glance — hidden from the cashier role */}
            {can('reports.read') && can('settings.read') && user?.role !== 'cashier' && <TodaysProfit />}

            <button onClick={() => setCalcOpen(true)} className="btn-ghost p-2" title="Calculator">
              <Calculator size={18} />
            </button>
            <NotificationBell />

            <button onClick={() => navigate('/pos')} className="btn-primary">
              <ShoppingCart size={16} /> <span className="hidden sm:inline">New sale</span>
            </button>
          </div>
        </header>

        <main className="p-4 sm:p-6 max-w-[1600px] mx-auto">
          <Outlet context={{ net }} />
        </main>
      </div>

      <CalculatorWidget open={calcOpen} onClose={() => setCalcOpen(false)} />
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
