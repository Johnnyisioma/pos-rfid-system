import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Search, Plus, Minus, Trash2, ScanLine, User, PauseCircle, PlayCircle, Percent,
  CreditCard, Banknote, Smartphone, Landmark, Wallet, Gift, Receipt as ReceiptIcon,
  X, Check, WifiOff, FileText, Star, PackageSearch, Send,
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { money, num, variantLabel, labelize } from '../lib/format.js';
import { Card, Modal, Loading, Empty, Badge, useToast, Field, Spinner, ScanInput } from '../components/ui.jsx';
import { useRfidScan } from '../lib/useRfidScan.jsx';
import ShareReceipt from '../components/ShareReceipt.jsx';
import { useAuth } from '../lib/auth.jsx';
import { queueSale, uuid, refreshSnapshot, loadSnapshot } from '../lib/offline.js';
import Receipt from '../components/Receipt.jsx';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'transfer', label: 'Bank transfer', icon: Landmark },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'mobile_money', label: 'Mobile money', icon: Smartphone },
  { value: 'store_credit', label: 'Store credit', icon: Wallet },
];

export default function POS() {
  const { settings, locationId, user, feature } = useAuth();
  const toast = useToast();
  const searchRef = useRef(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [snapshot, setSnapshot] = useState(null);

  const [cart, setCart] = useState([]);
  const [customer, setCustomer] = useState(null);
  // Who SERVED the customer, which is not always who is at the keyboard — one
  // person often rings up what another person sold, and commission follows the
  // person who sold it.
  const [salesRep, setSalesRep] = useState(null);
  const [reps, setReps] = useState([]);
  const [sharing, setSharing] = useState(false);
  const [cartDiscount, setCartDiscount] = useState({ type: 'percent', value: 0 });
  const [note, setNote] = useState('');

  const [showPay, setShowPay] = useState(false);
  const [showCustomers, setShowCustomers] = useState(false);
  const [showHeld, setShowHeld] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);

  const vatRate = Number(settings?.vat_rate ?? 7.5);
  const inclusive = settings?.prices_include_vat !== false;

  /* ---------- catalog snapshot for offline use ---------- */
  useEffect(() => {
    refreshSnapshot().then(setSnapshot).catch(() => loadSnapshot().then(setSnapshot));
  }, [locationId]);

  /* ---------- search ---------- */
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); return; }
    let live = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const rows = await api.get(`/api/products/search${qs({ q })}`);
        if (live) setResults(rows);
      } catch {
        // offline: search the cached snapshot
        const local = (snapshot?.variants || []).filter((v) =>
          `${v.name} ${v.sku} ${v.barcode || ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
        if (live) setResults(local);
      } finally { if (live) setSearching(false); }
    }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [query, snapshot]);

  /* ---------- cart maths (mirrors the server's pricing engine) ---------- */
  const totals = useMemo(() => {
    const priced = cart.map((l) => {
      const gross = round2(l.unit_price * l.quantity);
      const lineDiscount = round2(l.discount_amount || 0);
      return { ...l, gross, net: round2(gross - lineDiscount) };
    });
    const netSum = priced.reduce((s, l) => s + l.net, 0);
    const cartOff = cartDiscount.value > 0
      ? (cartDiscount.type === 'percent'
        ? round2((netSum * cartDiscount.value) / 100)
        : round2(Math.min(cartDiscount.value, netSum)))
      : 0;

    let allocated = 0;
    const lines = priced.map((l, i) => {
      let share = netSum > 0 ? round2((cartOff * l.net) / netSum) : 0;
      if (i === priced.length - 1) share = round2(cartOff - allocated);
      allocated = round2(allocated + share);
      const net = round2(l.net - share);
      const rate = l.tax_rate ?? vatRate;
      const tax = rate ? (inclusive ? round2((net * rate) / (100 + rate)) : round2((net * rate) / 100)) : 0;
      return { ...l, final_discount: round2((l.discount_amount || 0) + share), line_total: inclusive ? net : round2(net + tax), tax };
    });

    const total = round2(lines.reduce((s, l) => s + l.line_total, 0));
    const tax = round2(lines.reduce((s, l) => s + l.tax, 0));
    const subtotal = round2(priced.reduce((s, l) => s + l.gross, 0));
    const discount = round2(priced.reduce((s, l) => s + (l.discount_amount || 0), 0) + cartOff);
    return { lines, subtotal, discount, tax, total, itemCount: cart.reduce((s, l) => s + l.quantity, 0) };
  }, [cart, cartDiscount, vatRate, inclusive]);

  /* ---------- cart actions ---------- */
  const addToCart = useCallback((v, opts = {}) => {
    if (!v) return;
    setCart((prev) => {
      const key = v.variant_id ?? v.id;
      const existing = prev.find((l) => l.variant_id === key && !opts.forceNew);
      if (existing && !opts.epc) {
        return prev.map((l) => l === existing ? { ...l, quantity: l.quantity + (opts.quantity || 1) } : l);
      }
      if (existing && opts.epc) {
        if ((existing.epcs || []).includes(opts.epc)) return prev; // already scanned
        return prev.map((l) => l === existing
          ? { ...l, quantity: l.quantity + 1, epcs: [...(l.epcs || []), opts.epc] } : l);
      }
      return [...prev, {
        variant_id: key,
        product_name: v.name || v.product_name,
        variant_label: variantLabel(v),
        sku: v.sku,
        unit_price: Number(v.price ?? v.selling_price ?? 0),
        tax_rate: Number(v.tax_rate ?? vatRate),
        stock: Number(v.stock ?? 0),
        quantity: opts.quantity || 1,
        discount_amount: 0,
        epcs: opts.epc ? [opts.epc] : [],
      }];
    });
    setQuery('');
    setResults([]);
    searchRef.current?.focus();
  }, [vatRate]);

  const setLine = (i, patch) =>
    setCart((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i) => setCart((prev) => prev.filter((_, idx) => idx !== i));
  const clearCart = () => { setCart([]); setCustomer(null); setCartDiscount({ type: 'percent', value: 0 }); setNote(''); };

  /* ---------- scanning ---------- */
  /**
   * Does this look like a tag, rather than something a person typed?
   *
   * At the till the focused field is the product search box, and a handheld in
   * Focus mode commits its read straight into it — the operator never opens a
   * scan dialog first. Searched as text, an EPC matches no product name or SKU
   * and the cashier just sees "nothing found". So a scan-shaped code is routed
   * to the tag resolver instead.
   *
   * The test is deliberately narrow: an even-length hex string of at least 16
   * characters (64-bit and up), or the printed label format. Nothing a person
   * would plausibly type to search for a shoe.
   */
  const looksLikeTag = (raw) => {
    const v = String(raw).trim();
    const hex = v.replace(/^epc[:=]/i, '').replace(/[\s:\-_.]/g, '');
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length >= 16 && hex.length % 2 === 0) return true;
    return /^[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{4,}$/i.test(v);
  };

  const handleScan = async (code) => {
    try {
      const res = await api.post('/api/rfid/resolve', { codes: [code], context: 'checkout' });
      const hit = res.results[0];
      if (hit.resolved) {
        const u = hit.unit;
        if (u.status !== 'in_stock') {
          toast.error(`That tag reads as "${labelize(u.status)}" — it is not available to sell.`);
          return;
        }
        if (u.location_id !== locationId) {
          toast.error(`That unit is at ${u.location_name}, not this shop.`);
          return;
        }
        addToCart({
          variant_id: u.variant_id, name: u.product_name, size: u.size, color: u.color,
          sku: u.variant_sku, price: u.selling_price, tax_rate: vatRate, stock: 1,
        }, { epc: u.epc });
        toast.success(`Added ${u.product_name} — unit #${u.serial}`);
        return;
      }
      if (hit.matched_variant) {
        const rows = await api.get(`/api/products/search${qs({ q: hit.matched_variant.sku })}`);
        const match = rows.find((r) => r.variant_id === hit.matched_variant.variant_id) || rows[0];
        if (match) { addToCart(match); toast.info('Matched by SKU / barcode (no individual tag).'); return; }
      }
      toast.error(hit.message);
    } catch (err) {
      toast.error(err.message);
    }
  };

  /**
   * Sweep-to-cart.
   *
   * On the APK the reader talks to this screen directly, so a customer can put
   * a basket on the counter and the whole basket goes into the cart in one
   * sweep — which is the thing RFID is actually for at a till, and the thing a
   * barcode scanner cannot do.
   *
   * dedupeMs is deliberately long: a tag sitting in the antenna's field is read
   * dozens of times a second, and each of those reads is the same shoe.
   * tagsOnly keeps a stray keypress out of the cart.
   *
   * keepFocus is off because the product search box owns focus on this screen;
   * in a browser a committed read lands there and is intercepted in its
   * onChange, which is the path that has always worked.
   */
  const scan = useRfidScan(handleScan, {
    dedupeMs: 8000,
    tagsOnly: true,
    keepFocus: false,
  });

  /* ---------- completing the sale ---------- */
  // Only loaded when the shop actually runs commission, so a shop that does
  // not gets no extra request and no extra control on the till.
  useEffect(() => {
    if (!feature('commissions')) return;
    api.get('/api/users')
      .then((rows) => {
        const list = (rows || []).filter((u) => u.is_active);
        setReps(list);
        // Default to whoever is logged in — the common case is that the person
        // at the till is the person who sold it.
        setSalesRep((cur) => cur ?? (list.some((u) => u.id === user?.id) ? String(user.id) : null));
      })
      .catch(() => setReps([]));
  }, [feature, user?.id]);

  const submitSale = async ({ payments, status = 'completed', pointsRedeem = 0, isCredit = false }) => {
    setBusy(true);
    const clientUuid = uuid();
    const payload = {
      client_uuid: clientUuid,
      location_id: locationId,
      customer_id: customer?.id || null,
      sales_rep_id: salesRep ? Number(salesRep) : null,
      items: cart.map((l) => ({
        variant_id: l.variant_id, quantity: l.quantity, unit_price: l.unit_price,
        discount_amount: l.discount_amount || 0, epcs: l.epcs || [],
      })),
      discount: cartDiscount,
      payments,
      points_redeem: pointsRedeem,
      is_credit: isCredit,
      status,
      note,
    };
    try {
      const sale = await api.post('/api/sales', payload);
      setShowPay(false);
      if (status === 'completed' || status === 'layaway') {
        const full = await api.get(`/api/sales/${sale.id}/receipt`);
        setReceipt(full);
      } else {
        toast.success(status === 'held' ? 'Sale parked' : 'Quotation saved');
      }
      clearCart();
      return sale;
    } catch (err) {
      const offline = !navigator.onLine || /Failed to fetch|NetworkError|fetch failed/i.test(err.message);
      if (offline && status === 'completed') {
        await queueSale(payload);
        setShowPay(false);
        setReceipt(offlineReceipt(payload, totals, settings, customer, user, clientUuid));
        clearCart();
        toast.info('No connection — the sale is saved on this device and will sync automatically.');
        return null;
      }
      toast.error(err.message);
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const resumeHeld = async (sale) => {
    const full = await api.get(`/api/sales/${sale.id}`);
    setCart(full.items.map((i) => ({
      variant_id: i.variant_id, product_name: i.product_name, variant_label: i.variant_label,
      sku: i.sku, unit_price: Number(i.unit_price), tax_rate: Number(i.tax_rate),
      quantity: Number(i.quantity), discount_amount: Number(i.discount_amount), epcs: [],
    })));
    if (full.customer_id) setCustomer({ id: full.customer_id, name: full.customer_name });
    setNote(full.note || '');
    await api.del(`/api/sales/${sale.id}`);
    setShowHeld(false);
    toast.success('Parked sale reopened');
  };

  return (
    <div className="grid lg:grid-cols-[1fr_400px] gap-4 -m-4 sm:-m-6 p-4 sm:p-6 min-h-[calc(100vh-3.5rem)]">
      <scan.CaptureField />
      {/* ---------------- catalog side ---------------- */}
      <div className="flex flex-col gap-4 min-w-0">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input ref={searchRef} value={query}
              onChange={(e) => {
                const next = e.target.value;
                setQuery(next);
                // A committed tag read arrives here whole, in one event, with no
                // Enter behind it. Take it straight to the resolver.
                if (looksLikeTag(next)) { setQuery(''); setResults([]); handleScan(next.trim()); }
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const v = query.trim();
                if (v) { setQuery(''); setResults([]); handleScan(v); }
              }}
              className="input pl-10 py-3 text-base" autoFocus
              placeholder="Search, or pull the trigger to scan a tag" />
            {query && (
              <button onClick={() => { setQuery(''); setResults([]); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            )}
          </div>
          {scan.native ? (
            <button onClick={scan.toggle}
              className={`px-4 rounded-xl font-medium flex items-center gap-2 ${
                scan.scanning
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'btn-secondary'}`}
              title="Read every tag on the counter into the cart">
              <ScanLine size={18} className={scan.scanning ? 'animate-pulse' : ''} />
              <span className="hidden sm:inline">{scan.scanning ? 'Sweeping' : 'Sweep'}</span>
            </button>
          ) : (
            <button onClick={() => setShowScan(true)} className="btn-secondary px-4" title="Scan an RFID tag">
              <ScanLine size={18} /> <span className="hidden sm:inline">Scan</span>
            </button>
          )}
          <button onClick={() => setShowHeld(true)} className="btn-secondary px-4" title="Parked sales">
            <PlayCircle size={18} /> <span className="hidden sm:inline">Parked</span>
          </button>
        </div>

        <div className="flex-1">
          {searching && !results.length ? <Loading label="Searching…" /> :
            results.length ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                {results.map((v) => (
                  <button key={v.variant_id} onClick={() => addToCart(v)}
                    disabled={Number(v.stock) <= 0}
                    className="card p-3 text-left hover:ring-brand-400 hover:shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed">
                    <p className="font-medium text-sm text-slate-800 line-clamp-2 leading-snug">{v.name}</p>
                    <p className="text-xs text-slate-500 mt-1">{variantLabel(v)}</p>
                    <p className="text-[11px] text-slate-400 font-mono truncate">{v.sku}</p>
                    <div className="flex items-end justify-between mt-2">
                      <span className="font-semibold text-slate-900">{money(v.price)}</span>
                      <span className={`badge ${Number(v.stock) > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                        {num(v.stock)} left
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : query ? (
              <Empty title={`Nothing matches “${query}”`} icon={PackageSearch}
                hint="Try part of the product name, the SKU, or scan the tag." />
            ) : (
              <QuickPicks snapshot={snapshot} onPick={addToCart} />
            )}
        </div>
      </div>

      {/* ---------------- cart side ---------------- */}
      <div className="lg:sticky lg:top-[4.5rem] lg:self-start flex flex-col card overflow-hidden lg:max-h-[calc(100vh-6rem)]">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
          <button onClick={() => setShowCustomers(true)}
            className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-brand-700 min-w-0">
            <User size={16} className="shrink-0" />
            <span className="truncate">{customer ? customer.name : 'Walk-in customer'}</span>
          </button>
          {cart.length > 0 && (
            <button onClick={clearCart} className="btn-ghost text-xs text-rose-600 px-2">Clear</button>
          )}
        </div>

        {feature('commissions') && reps.length > 0 && (
          <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-2">
            <Percent size={13} className="text-slate-400 shrink-0" />
            <select className="input py-1 text-xs border-0 bg-transparent px-0 focus:ring-0"
              value={salesRep || ''} onChange={(e) => setSalesRep(e.target.value || null)}>
              <option value="">No sales rep on this sale</option>
              {reps.map((u) => <option key={u.id} value={u.id}>Sold by {u.name}</option>)}
            </select>
          </div>
        )}

        {customer && (
          <div className="px-4 py-2 bg-brand-50 text-xs text-brand-900 flex flex-wrap gap-x-4 gap-y-1 border-b border-brand-100">
            {Number(customer.loyalty_points) > 0 && (
              <span className="flex items-center gap-1"><Star size={12} /> {num(customer.loyalty_points)} points</span>
            )}
            {Number(customer.store_credit) > 0 && <span>Credit {money(customer.store_credit)}</span>}
            {Number(customer.balance) > 0 && <span className="text-amber-800">Owes {money(customer.balance)}</span>}
            <button onClick={() => setCustomer(null)} className="ml-auto underline">remove</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-[180px]">
          {cart.length === 0 ? (
            <Empty title="Cart is empty" hint="Search for a product or scan an RFID tag to begin." icon={ReceiptIcon} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {cart.map((l, i) => (
                <li key={i} className="p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 leading-snug">{l.product_name}</p>
                      <p className="text-xs text-slate-500">{l.variant_label} · {money(l.unit_price)}</p>
                      {l.epcs?.length > 0 && (
                        <p className="text-[10px] text-emerald-700 font-mono mt-0.5">
                          {l.epcs.length} tag{l.epcs.length > 1 ? 's' : ''} scanned
                        </p>
                      )}
                    </div>
                    <button onClick={() => removeLine(i)} className="text-slate-400 hover:text-rose-600 p-1">
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex items-center rounded-lg ring-1 ring-slate-300">
                      <button onClick={() => setLine(i, { quantity: Math.max(1, l.quantity - 1) })}
                        className="px-2.5 py-1.5 text-slate-600 hover:bg-slate-50"><Minus size={14} /></button>
                      <input type="number" value={l.quantity} min="1"
                        onChange={(e) => setLine(i, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                        className="w-12 text-center text-sm border-0 focus:ring-0 p-0 tabular-nums" />
                      <button onClick={() => setLine(i, { quantity: l.quantity + 1 })}
                        className="px-2.5 py-1.5 text-slate-600 hover:bg-slate-50"><Plus size={14} /></button>
                    </div>
                    <div className="relative flex-1">
                      <Percent size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="number" placeholder="Discount" value={l.discount_amount || ''}
                        onChange={(e) => setLine(i, { discount_amount: Number(e.target.value) || 0 })}
                        className="input py-1.5 pl-7 text-xs" title="Line discount amount" />
                    </div>
                    <span className="text-sm font-semibold tabular-nums w-20 text-right">
                      {money(totals.lines[i]?.line_total ?? 0)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-slate-100 p-4 space-y-2 bg-slate-50">
          <div className="flex gap-2">
            <select value={cartDiscount.type} onChange={(e) => setCartDiscount((d) => ({ ...d, type: e.target.value }))}
              className="input py-1.5 text-xs w-24">
              <option value="percent">%</option>
              <option value="fixed">Amount</option>
            </select>
            <input type="number" placeholder="Whole-cart discount" value={cartDiscount.value || ''}
              onChange={(e) => setCartDiscount((d) => ({ ...d, value: Number(e.target.value) || 0 }))}
              className="input py-1.5 text-xs flex-1" />
          </div>

          <dl className="text-sm space-y-1 pt-1">
            <Row label={`Subtotal (${num(totals.itemCount)} item${totals.itemCount === 1 ? '' : 's'})`} value={money(totals.subtotal)} />
            {totals.discount > 0 && <Row label="Discount" value={`− ${money(totals.discount)}`} tone="text-emerald-700" />}
            <Row label={`VAT ${vatRate}%${inclusive ? ' (included)' : ''}`} value={money(totals.tax)} muted />
            <div className="flex justify-between pt-2 border-t border-slate-200 text-base font-semibold">
              <dt>Total</dt><dd className="tabular-nums">{money(totals.total)}</dd>
            </div>
          </dl>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button className="btn-secondary" disabled={!cart.length || busy}
              onClick={() => submitSale({ payments: [], status: 'held' })}>
              <PauseCircle size={16} /> Park
            </button>
            <button className="btn-secondary" disabled={!cart.length || busy}
              onClick={() => submitSale({ payments: [], status: 'quotation' })}>
              <FileText size={16} /> Quote
            </button>
          </div>
          <button className="btn-primary w-full btn-lg" disabled={!cart.length || busy}
            onClick={() => setShowPay(true)}>
            {busy ? <Spinner /> : <Check size={18} />} Charge {money(totals.total)}
          </button>
        </div>
      </div>

      <PaymentModal open={showPay} onClose={() => setShowPay(false)} totals={totals}
        customer={customer} settings={settings} onSubmit={submitSale} busy={busy} />

      <CustomerModal open={showCustomers} onClose={() => setShowCustomers(false)}
        onPick={(c) => { setCustomer(c); setShowCustomers(false); }} />

      <HeldModal open={showHeld} onClose={() => setShowHeld(false)} onResume={resumeHeld} />

      <Modal open={showScan} onClose={() => setShowScan(false)} title="Scan an RFID tag or barcode"
        subtitle="You can also just pull the trigger on the main screen — a read is picked up there automatically."
        size="sm">
        <ScanInput onScan={(code) => handleScan(code)} />
        <p className="text-xs text-slate-500 mt-3">
          Each physical unit carries its own EPC, so scanning two identical pairs adds both.
        </p>
      </Modal>

      {receipt && (
        <Modal open onClose={() => setReceipt(null)} title="Sale complete" size="sm"
          footer={
            <>
              <button className="btn-secondary" onClick={() => window.print()}>
                <ReceiptIcon size={16} /> Print
              </button>
              <button className="btn-secondary" onClick={() => setReceipt({ ...receipt, gift: !receipt.gift })}>
                <Gift size={16} /> {receipt.gift ? 'Show prices' : 'Gift receipt'}
              </button>
              {feature('digital_receipts') && receipt.sale?.id && (
                <button className="btn-secondary" onClick={() => setSharing(true)}>
                  <Send size={16} /> Send
                </button>
              )}
              <button className="btn-primary" onClick={() => setReceipt(null)}>Done</button>
            </>
          }>
          <Receipt data={receipt} />
        </Modal>
      )}

      {receipt?.sale?.id && (
        <ShareReceipt open={sharing} onClose={() => setSharing(false)}
          sale={{ ...receipt.sale, customer_phone: customer?.phone, customer_whatsapp: customer?.whatsapp }} />
      )}
    </div>
  );
}

/* ---------------- helpers ---------------- */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function Row({ label, value, muted, tone }) {
  return (
    <div className={`flex justify-between ${muted ? 'text-slate-500' : 'text-slate-700'} ${tone || ''}`}>
      <dt>{label}</dt><dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function QuickPicks({ snapshot, onPick }) {
  const items = (snapshot?.variants || []).filter((v) => Number(v.stock) > 0).slice(0, 24);
  if (!items.length) return <Empty title="Start typing to find a product" icon={Search}
    hint="Or press Scan to read an RFID tag." />;
  return (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">In stock here</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
        {items.map((v) => (
          <button key={v.variant_id} onClick={() => onPick(v)}
            className="card p-3 text-left hover:ring-brand-400 hover:shadow-md transition">
            <p className="font-medium text-sm text-slate-800 line-clamp-2 leading-snug">{v.name}</p>
            <p className="text-xs text-slate-500 mt-1">{variantLabel(v)}</p>
            <div className="flex items-end justify-between mt-2">
              <span className="font-semibold text-slate-900">{money(v.price)}</span>
              <span className="badge bg-emerald-100 text-emerald-800">{num(v.stock)}</span>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

function PaymentModal({ open, onClose, totals, customer, settings, onSubmit, busy }) {
  const [rows, setRows] = useState([{ method: 'cash', amount: '', reference: '' }]);
  const [points, setPoints] = useState(0);
  const [layaway, setLayaway] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (open) { setRows([{ method: 'cash', amount: String(totals.total), reference: '' }]); setPoints(0); setLayaway(false); }
  }, [open, totals.total]);

  const pointValue = Number(settings?.loyalty_point_value || 0);
  const pointsCash = round2(points * pointValue);
  const paid = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) + pointsCash);
  const due = round2(totals.total - paid);
  const change = due < 0 ? round2(-due) : 0;

  const setRow = (i, patch) => setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const finish = async (asCredit) => {
    const payments = rows
      .filter((r) => Number(r.amount) > 0)
      .map((r) => ({ method: r.method, amount: Number(r.amount), reference: r.reference }));
    if (!payments.length && !points && !asCredit && !layaway) {
      toast.error('Enter at least one payment.'); return;
    }
    try {
      await onSubmit({
        payments,
        pointsRedeem: points,
        isCredit: asCredit || layaway,
        status: layaway ? 'layaway' : 'completed',
      });
    } catch { /* toast shown upstream */ }
  };

  return (
    <Modal open={open} onClose={onClose} title="Take payment"
      subtitle={`${money(totals.total)} due${customer ? ` · ${customer.name}` : ''}`} size="sm"
      footer={
        <>
          {customer && (
            <button className="btn-secondary" disabled={busy} onClick={() => finish(true)}>
              Credit sale
            </button>
          )}
          <button className="btn-primary" disabled={busy || (due > 0.009 && !layaway)} onClick={() => finish(false)}>
            {busy ? <Spinner /> : <Check size={16} />}
            {layaway ? 'Start layaway' : change > 0 ? `Complete · change ${money(change)}` : 'Complete sale'}
          </button>
        </>
      }>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2 items-start">
            <select value={r.method} onChange={(e) => setRow(i, { method: e.target.value })}
              className="input w-40">
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <input type="number" className="input flex-1" placeholder="Amount" value={r.amount}
              onChange={(e) => setRow(i, { amount: e.target.value })} />
            {rows.length > 1 && (
              <button onClick={() => setRows((p) => p.filter((_, x) => x !== i))}
                className="btn-ghost p-2 text-rose-600"><X size={16} /></button>
            )}
          </div>
        ))}
        {rows.some((r) => ['transfer', 'card', 'mobile_money'].includes(r.method)) && (
          <input className="input" placeholder="Payment reference (optional)"
            value={rows[0].reference} onChange={(e) => setRow(0, { reference: e.target.value })} />
        )}

        <div className="flex gap-2">
          <button className="btn-secondary text-xs"
            onClick={() => setRows((p) => [...p, { method: 'transfer', amount: String(Math.max(0, due)), reference: '' }])}>
            <Plus size={14} /> Split payment
          </button>
          <button className="btn-secondary text-xs"
            onClick={() => setRow(0, { amount: String(totals.total) })}>Exact</button>
          {[1000, 2000, 5000, 10000].map((q) => (
            <button key={q} className="btn-secondary text-xs px-2"
              onClick={() => setRow(0, { amount: String((Number(rows[0].amount) || 0) + q) })}>
              +{q / 1000}k
            </button>
          ))}
        </div>

        {customer && Number(customer.loyalty_points) > 0 && pointValue > 0 && (
          <Field label={`Redeem loyalty points (${num(customer.loyalty_points)} available, worth ${money(pointValue)} each)`}>
            <input type="number" className="input" value={points || ''} min="0"
              max={customer.loyalty_points}
              onChange={(e) => setPoints(Math.min(Number(e.target.value) || 0, Number(customer.loyalty_points)))} />
          </Field>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={layaway} onChange={(e) => setLayaway(e.target.checked)}
            className="rounded border-slate-300" disabled={!customer} />
          Layaway — hold the goods against a deposit{!customer && ' (needs a customer)'}
        </label>

        <div className="rounded-lg bg-slate-50 p-3 text-sm space-y-1">
          <Row label="Total" value={money(totals.total)} />
          <Row label="Paid" value={money(paid)} />
          {change > 0
            ? <Row label="Change" value={money(change)} tone="text-emerald-700 font-medium" />
            : due > 0 && <Row label="Balance due" value={money(due)} tone="text-amber-700 font-medium" />}
        </div>
      </div>
    </Modal>
  );
}

function CustomerModal({ open, onClose, onPick }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '' });
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    api.get(`/api/customers${qs({ q, limit: 25 })}`).then((r) => setRows(r.data)).catch(() => {});
  }, [q, open]);

  const create = async () => {
    if (!form.name.trim()) return toast.error('Name is required');
    try {
      const c = await api.post('/api/customers', form);
      toast.success('Customer added');
      onPick(c);
    } catch (e) { toast.error(e.message); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Choose a customer" size="sm">
      {creating ? (
        <div className="space-y-3">
          <Field label="Name"><input className="input" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
          <Field label="Phone"><input className="input" value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={() => setCreating(false)}>Back</button>
            <button className="btn-primary flex-1" onClick={create}>Add & select</button>
          </div>
        </div>
      ) : (
        <>
          <input className="input mb-3" placeholder="Search by name or phone…" value={q}
            onChange={(e) => setQ(e.target.value)} autoFocus />
          <button className="btn-secondary w-full mb-3" onClick={() => setCreating(true)}>
            <Plus size={16} /> New customer
          </button>
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            <button onClick={() => onPick(null)} className="w-full text-left py-2.5 hover:bg-slate-50 px-2 rounded-lg">
              <span className="text-sm font-medium text-slate-700">Walk-in customer</span>
            </button>
            {rows.map((c) => (
              <button key={c.id} onClick={() => onPick(c)}
                className="w-full text-left py-2.5 px-2 hover:bg-slate-50 rounded-lg">
                <div className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.phone || 'No phone'} {c.group_name && `· ${c.group_name}`}</p>
                  </div>
                  <div className="text-right text-xs shrink-0">
                    {Number(c.loyalty_points) > 0 && <p className="text-brand-700">{num(c.loyalty_points)} pts</p>}
                    {Number(c.balance) > 0 && <p className="text-amber-700">owes {money(c.balance)}</p>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

function HeldModal({ open, onClose, onResume }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!open) return;
    setRows(null);
    api.get('/api/sales/held').then(setRows).catch(() => setRows([]));
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Parked sales" size="sm">
      {!rows ? <Loading /> : rows.length === 0 ? (
        <Empty title="Nothing parked" hint="Park a sale to free the till for the next customer." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((s) => (
            <li key={s.id} className="py-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 truncate">
                  {s.hold_label || `Parked #${s.id}`}
                </p>
                <p className="text-xs text-slate-500">
                  {s.item_count} items · {money(s.total)} · {s.customer_name || 'Walk-in'}
                </p>
              </div>
              <button className="btn-primary text-xs" onClick={() => onResume(s)}>Resume</button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Build a printable receipt locally when the sale was queued offline. */
function offlineReceipt(payload, totals, settings, customer, user, clientUuid) {
  return {
    business: {
      name: settings?.name, legal_name: settings?.legal_name, tin: settings?.tin,
      rc_number: settings?.rc_number,
      address: settings?.address, phone: settings?.phone, email: settings?.email,
      footer: settings?.receipt_footer, currency_symbol: settings?.currency_symbol,
      vat_rate: settings?.vat_rate, prices_include_vat: settings?.prices_include_vat,
      logo_url: settings?.receipt_show_logo ? settings?.logo_url : '',
      logo_width_mm: settings?.logo_width_mm,
      font_size: settings?.receipt_font_size,
      paper: settings?.receipt_paper,
    },
    offline: true,
    sale: {
      invoice_no: `OFFLINE-${clientUuid.slice(0, 8).toUpperCase()}`,
      created_at: new Date().toISOString(),
      cashier_name: user?.name,
      customer_name: customer?.name,
      subtotal: totals.subtotal, discount_amount: totals.discount,
      tax_amount: totals.tax, total: totals.total,
      amount_paid: payload.payments.reduce((s, p) => s + p.amount, 0),
      change_due: Math.max(0, payload.payments.reduce((s, p) => s + p.amount, 0) - totals.total),
      balance_due: 0,
      items: totals.lines.map((l) => ({
        product_name: l.product_name, variant_label: l.variant_label, sku: l.sku,
        quantity: l.quantity, unit_price: l.unit_price, line_total: l.line_total,
        tax_amount: l.tax, discount_amount: l.final_discount, units: [],
      })),
      payments: payload.payments,
    },
  };
}
