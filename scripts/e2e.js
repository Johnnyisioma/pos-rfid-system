/**
 * End-to-end API test. Run against a seeded database with the server up:
 *   BASE=http://localhost:3000 node scripts/e2e.js
 */
const BASE = process.env.BASE || 'http://localhost:3000';
let token = null;
let locationId = null;
let pass = 0, fail = 0;
const results = [];

function ok(name, cond, extra = '') {
  if (cond) { pass++; results.push(`  PASS  ${name}`); }
  else { fail++; results.push(`  FAIL  ${name} ${extra}`); }
}

async function api(method, path, body, raw = false) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(locationId ? { 'X-Location-Id': String(locationId) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 200) }; }
  return { status: res.status, body: json };
}

async function upload(path, csv, filename = 'file.csv') {
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), filename);
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'X-Location-Id': String(locationId) },
    body: fd,
  });
  return { status: res.status, body: await res.json() };
}

const todayStr = () => new Date().toISOString().slice(0, 10);
const daysAgoStr = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function run() {
  console.log(`\nRunning end-to-end tests against ${BASE}\n${'-'.repeat(64)}`);

  // --- auth ---
  let r = await api('POST', '/api/auth/login', { email: 'admin@millzee.test', password: 'password123' });
  ok('login as admin', r.status === 200 && !!r.body.token, JSON.stringify(r.body).slice(0, 120));
  token = r.body.token;
  const lagosId = r.body.locations.find((l) => l.code === 'LAG').id;
  const umuId = r.body.locations.find((l) => l.code === 'UMU').id;
  locationId = lagosId;

  r = await api('POST', '/api/auth/login', { email: 'admin@millzee.test', password: 'wrong' });
  ok('wrong password rejected', r.status === 401);

  r = await api('GET', '/api/auth/me');
  ok('me returns user + permissions', r.body.user?.role === 'admin' && Array.isArray(r.body.user.permissions));

  // --- catalog ---
  r = await api('GET', '/api/products?limit=5');
  ok('list products', r.body.data?.length === 5 && r.body.total > 10);

  r = await api('GET', '/api/products/search?q=oxford');
  ok('POS variant search', Array.isArray(r.body) && r.body.length > 0);
  ok('search puts sellable stock first',
    r.body.length < 2 || Number(r.body[0].stock) >= Number(r.body[r.body.length - 1].stock),
    JSON.stringify(r.body.map((x) => x.stock)));
  // Later tests sell this three times over, so it has to be a line with real
  // stock at THIS location — picking row 0 blind makes the suite depend on
  // where the seed happened to land its inventory.
  const searchHit = r.body.find((x) => Number(x.stock) >= 4) || r.body[0];

  r = await api('POST', '/api/products', {
    name: 'E2E Test Sandal', type: 'variable', unit: 'pair', tax_rate: 7.5, reorder_point: 2,
    variants: [
      { size: '41', color: 'Black', cost_price: 5000, selling_price: 11000 },
      { size: '42', color: 'Black', cost_price: 5000, selling_price: 11000 },
      { size: '42', color: 'Brown', cost_price: 5000, selling_price: 11500 },
    ],
  });
  ok('create variable product', r.status === 201 && r.body.variants?.length === 3, JSON.stringify(r.body).slice(0, 150));
  const testProduct = r.body;
  const v41 = testProduct.variants.find((v) => v.size === '41');
  ok('auto-generated variant SKUs', testProduct.variants.every((v) => v.sku && v.sku.includes(testProduct.sku)));

  // --- receive stock => unique EPC per physical unit ---
  r = await api('POST', '/api/inventory/receive', {
    location_id: lagosId,
    reason: 'E2E opening stock',
    items: [{ variant_id: v41.id, quantity: 3, cost_price: 5000 }],
  });
  ok('receive 3 units', r.status === 201 && r.body.units_created === 3, JSON.stringify(r.body).slice(0, 150));
  const units = r.body.units;
  const epcs = units.map((u) => u.epc);
  ok('every unit has a distinct EPC', new Set(epcs).size === 3);
  ok('EPC is 24 hex chars', epcs.every((e) => /^[0-9A-F]{24}$/.test(e)));

  // --- the core requirement ---
  r = await api('POST', '/api/rfid/resolve', { codes: [epcs[0], epcs[1]] });
  ok('two identical items resolve to two different units',
    r.body.resolved === 2 &&
    r.body.results[0].unit.id !== r.body.results[1].unit.id &&
    r.body.results[0].unit.variant_id === r.body.results[1].unit.variant_id,
    JSON.stringify(r.body).slice(0, 200));

  r = await api('POST', '/api/rfid/resolve', { codes: ['DEADBEEFDEADBEEFDEADBEEF'] });
  ok('unknown EPC reported as unresolved', r.body.resolved === 0 && r.body.results[0].valid_format === true);

  r = await api('POST', '/api/rfid/resolve', { codes: [epcs[0].match(/.{1,4}/g).join(' ')] });
  ok('spaced scanner input normalises', r.body.resolved === 1);

  // --- encode a tag (mock Zebra) ---
  r = await api('POST', `/api/rfid/units/${units[0].id}/encode`, {});
  ok('encode tag returns ZPL', r.status === 200 && r.body.zpl?.includes('^RFW,H'), JSON.stringify(r.body).slice(0, 120));
  ok('ZPL carries the exact EPC', r.body.zpl?.includes(epcs[0]));
  ok('mock mode is reported', r.body.status === 'simulated');

  // --- checkout ---
  r = await api('GET', '/api/registers');
  const register = r.body.find((x) => !x.open_session) || r.body[0];
  r = await api('POST', `/api/registers/${register.id}/open`, { opening_cash: 20000 });
  ok('open register session', r.status === 201 || (r.status === 400 && /open session/.test(r.body.error)),
    JSON.stringify(r.body).slice(0, 120));

  r = await api('POST', '/api/sales', {
    items: [
      { variant_id: v41.id, quantity: 1, epcs: [epcs[0]] },
      { variant_id: searchHit.variant_id, quantity: 1 },
    ],
    payments: [{ method: 'cash', amount: 100000 }],
    status: 'completed',
  });
  ok('complete a sale', r.status === 201 && !!r.body.invoice_no, JSON.stringify(r.body).slice(0, 200));
  const sale = r.body;
  ok('VAT separated on the invoice', Number(sale.tax_amount) > 0);
  ok('change calculated', Number(sale.change_due) > 0);
  ok('scanned unit linked to the sale line',
    sale.items?.some((i) => i.units.some((u) => u.epc === epcs[0])));

  r = await api('POST', '/api/rfid/resolve', { codes: [epcs[0]] });
  ok('sold unit now reads as sold', r.body.results[0].unit?.status === 'sold');

  r = await api('POST', '/api/sales', {
    items: [{ variant_id: v41.id, quantity: 1 }],
    payments: [{ method: 'transfer', amount: 11000, reference: 'TRF-E2E' }],
  });
  const sale2 = r.body;
  ok('invoice numbers are sequential', Number(sale2.invoice_seq) === Number(sale.invoice_seq) + 1,
    `${sale.invoice_seq} -> ${sale2.invoice_seq}`);

  r = await api('POST', '/api/sales', {
    items: [{ variant_id: v41.id, quantity: 999 }],
    payments: [{ method: 'cash', amount: 99999999 }],
  });
  ok('oversell blocked', r.status === 400 && /Not enough stock/.test(r.body.error || ''));

  r = await api('POST', '/api/sales', {
    items: [{ variant_id: searchHit.variant_id, quantity: 1 }],
    status: 'held', hold_label: 'E2E hold',
  });
  ok('park a sale', r.status === 201 && r.body.status === 'held');
  const held = r.body;
  r = await api('GET', '/api/sales/held');
  ok('held sale appears in the list', r.body.some((s) => s.id === held.id));
  r = await api('DELETE', `/api/sales/${held.id}`);
  ok('delete held sale', r.body.ok === true);

  r = await api('GET', `/api/sales/${sale.id}/receipt`);
  ok('receipt includes business TIN', !!r.body.business?.tin);
  ok('e-invoice structure present', Array.isArray(r.body.einvoice?.lines) && r.body.einvoice.lines.length > 0);
  r = await api('GET', `/api/sales/${sale.id}/receipt?gift=true`);
  ok('gift receipt hides prices', r.body.sale?.total === null, JSON.stringify(r.body).slice(0,160));

  // --- return ---
  r = await api('POST', '/api/returns', {
    original_sale_id: sale.id,
    reason: 'E2E wrong size',
    refund_method: 'cash',
    items: [{ sale_item_id: sale.items[0].id, quantity: 1, restock: true }],
  });
  ok('process a refund', r.status === 201 && Number(r.body.total_refund) > 0, JSON.stringify(r.body).slice(0, 150));
  r = await api('POST', '/api/rfid/resolve', { codes: [epcs[0]] });
  ok('returned unit is back in stock', r.body.results[0].unit?.status === 'in_stock');

  // --- permissions ---
  const adminToken = token;
  r = await api('POST', '/api/auth/login', { email: 'cashier@millzee.test', password: 'password123' });
  token = r.body.token;
  r = await api('POST', '/api/sales', {
    items: [{ variant_id: searchHit.variant_id, quantity: 1 }],
    discount: { type: 'percent', value: 40 },
    payments: [{ method: 'cash', amount: 1000000 }],
  });
  ok('cashier blocked from over-limit discount', r.status === 403 && /limit/.test(r.body.error || ''),
    JSON.stringify(r.body).slice(0, 150));
  r = await api('POST', '/api/products', { name: 'Cashier should not create this', variants: [{ selling_price: 1 }] });
  ok('cashier cannot create products', r.status === 403);
  token = adminToken;

  // --- transfer between branches ---
  r = await api('POST', '/api/transfers', {
    from_location_id: lagosId, to_location_id: umuId, dispatch: true,
    items: [{ variant_id: v41.id, quantity: 1 }],
    notes: 'E2E transfer',
  });
  ok('create + dispatch transfer', r.status === 201 && r.body.status === 'in_transit', JSON.stringify(r.body).slice(0, 150));
  const transfer = r.body;
  ok('units marked in transit', transfer.units?.length === 1 && transfer.units[0].status === 'in_transit');
  r = await api('POST', `/api/transfers/${transfer.id}/receive`, {});
  ok('receive transfer at destination', r.body.status === 'received');
  r = await api('GET', `/api/inventory/availability/${v41.id}`);
  ok('cross-location availability visible', r.body.find((x) => x.location_id === umuId)?.quantity >= 1);

  // --- stock take ---
  r = await api('POST', '/api/rfid/stock-takes', { location_id: lagosId, scope: 'full' });
  ok('start stock take', (r.status === 201 || r.status === 200) && !!r.body.id, JSON.stringify(r.body).slice(0, 120));
  const take = r.body;
  r = await api('POST', '/api/rfid/simulate-sweep', { location_id: lagosId, size: 30 });
  ok('simulated sweep returns reads', Array.isArray(r.body.reads) && r.body.reads.length > 0);
  const sweep = r.body.reads.map((x) => x.epc);
  r = await api('POST', `/api/rfid/stock-takes/${take.id}/scan`, { codes: [...sweep, 'AAAAAAAAAAAAAAAAAAAAAAAA'] });
  ok('bulk scan recorded', r.body.summary.added > 0, JSON.stringify(r.body.summary));
  ok('duplicate reads de-duplicated', r.body.summary.duplicates > 0 || sweep.length === new Set(sweep).size);
  ok('unknown tag flagged', r.body.summary.unknown >= 1);
  r = await api('GET', `/api/rfid/stock-takes/${take.id}`);
  ok('reconciliation view lists missing units', Array.isArray(r.body.missing) && r.body.missing.length > 0);
  ok('accuracy calculated', typeof r.body.accuracy === 'number');
  r = await api('POST', `/api/rfid/stock-takes/${take.id}/reconcile`, { write_off_missing: false, move_strays: false });
  ok('reconcile closes the count', r.body.ok === true);

  r = await api('GET', `/api/rfid/find?variant_id=${v41.id}`);
  ok('find item lists units and locations', Array.isArray(r.body) && r.body[0].units.length > 0);

  // --- purchase order + receiving ---
  r = await api('GET', '/api/suppliers');
  const supplier = r.body.data[0];
  r = await api('POST', '/api/purchases', {
    supplier_id: supplier.id, location_id: lagosId, status: 'ordered',
    items: [{ variant_id: v41.id, quantity: 5, unit_cost: 5200 }],
  });
  ok('create purchase order', r.status === 201 && !!r.body.po_number, JSON.stringify(r.body).slice(0, 150));
  const po = r.body;
  r = await api('POST', `/api/purchases/${po.id}/receive`, {
    items: [{ item_id: po.items[0].id, quantity: 5, unit_cost: 5200 }],
  });
  ok('goods receiving mints EPC units', r.body.units_created === 5 && r.body.status === 'received');
  ok('received units all have unique EPCs', new Set((r.body.units || []).map((u) => u.epc)).size === 5);
  r = await api('POST', `/api/purchases/${po.id}/receive`, {
    items: [{ item_id: po.items[0].id, quantity: 1 }],
  });
  ok('over-receiving blocked', r.status === 400);

  // --- stock adjustment ---
  r = await api('POST', '/api/inventory/adjustments', {
    items: [{ variant_id: v41.id, quantity_change: -1 }],
  });
  ok('adjustment without reason rejected', r.status === 400 && /reason/i.test(r.body.error || ''));
  r = await api('POST', '/api/inventory/adjustments', {
    reason: 'Damaged in store', items: [{ variant_id: v41.id, quantity_change: -1 }],
  });
  ok('adjustment with reason accepted', r.status === 201);

  // --- customers, loyalty, credit ---
  r = await api('POST', '/api/customers', { name: 'E2E Customer', phone: '08099999999', credit_limit: 100000 });
  ok('create customer', r.status === 201);
  const customer = r.body;
  r = await api('POST', '/api/sales', {
    customer_id: customer.id,
    items: [{ variant_id: v41.id, quantity: 1 }],
    payments: [{ method: 'cash', amount: 2000 }],
    is_credit: true,
  });
  ok('credit sale creates a balance', r.status === 201 && Number(r.body.balance_due) > 0, JSON.stringify(r.body).slice(0, 150));
  r = await api('POST', `/api/customers/${customer.id}/payments`, { amount: 100000, method: 'transfer' });
  ok('account payment clears the balance', Number(r.body.customer?.balance) === 0, JSON.stringify(r.body).slice(0, 150));

  // --- offline sync idempotency ---
  const uuid = `e2e-${Date.now()}`;
  const payload = {
    sales: [{
      client_uuid: uuid, location_id: lagosId,
      items: [{ variant_id: v41.id, quantity: 1 }],
      payments: [{ method: 'cash', amount: 20000 }],
      status: 'completed',
    }],
  };
  r = await api('POST', '/api/sync/sales', payload);
  ok('offline sale syncs', r.body.synced === 1, JSON.stringify(r.body).slice(0, 180));
  r = await api('POST', '/api/sync/sales', payload);
  ok('replayed sale is not duplicated', r.body.duplicates === 1 && r.body.synced === 0);

  r = await api('GET', '/api/sync/snapshot');
  ok('offline snapshot has catalog + customers', r.body.variants?.length > 0 && Array.isArray(r.body.customers));

  // --- import / export ---
  const res = await fetch(`${BASE}/api/io/products/template?format=csv`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Location-Id': String(locationId) } });
  const csv = await res.text();
  ok('CSV template downloads', res.status === 200 && csv.includes('product_name'));

  // Unique per run: the importer correctly UPDATES a product it already knows,
  // so a fixed SKU would make this assertion fail on the second run against the
  // same database and look like a regression.
  const impSku = `E2E-IMP-${Date.now().toString(36).toUpperCase()}`;
  const importCsv = [
    'product_name,product_sku,type,brand,category,sub_category,size,color,cost_price,selling_price,opening_stock,location_code',
    `E2E Import Shoe ${impSku},${impSku},variable,TestBrand,Footwear,Sneakers,42,Blue,8000,17000,2,LAG`,
    `E2E Import Shoe ${impSku},${impSku},variable,TestBrand,Footwear,Sneakers,43,Blue,8000,17000,1,LAG`,
  ].join('\n');
  let up = await upload('/api/io/products/validate', importCsv, 'import.csv');
  ok('import validation passes clean file', up.body.ok === true && up.body.summary.variants === 2,
    JSON.stringify(up.body).slice(0, 200));

  const badCsv = [
    'product_name,selling_price,size,opening_stock,location_code',
    ',5000,42,1,LAG',
    'Bad Row Product,notanumber,42,1,ZZZ',
  ].join('\n');
  up = await upload('/api/io/products/validate', badCsv, 'bad.csv');
  ok('import validation reports row-level errors',
    up.body.ok === false && up.body.errors.some((e) => e.field === 'product_name') &&
    up.body.errors.some((e) => e.field === 'location_code'), JSON.stringify(up.body.errors).slice(0, 220));

  up = await upload('/api/io/products/import', importCsv, 'import.csv');
  ok('import creates product, variants and tagged units',
    up.body.ok === true && up.body.products === 1 && up.body.variants === 2 && up.body.units === 3,
    JSON.stringify(up.body).slice(0, 200));

  up = await upload('/api/io/products/import', badCsv, 'bad.csv');
  ok('bad import is rejected wholesale', up.status === 422);

  const res2 = await fetch(`${BASE}/api/io/products/export?format=csv`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Location-Id': String(locationId) } });
  const exportCsv = await res2.text();
  ok('catalog export includes per-location stock',
    exportCsv.includes('stock_LAG') && exportCsv.includes('E2E Import Shoe'));


  // --- receipt settings: logo, font size, paper ---
  const originalSettings = (await api('GET', '/api/settings')).body;
  const tinyLogo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  r = await api('PUT', '/api/settings', {
    logo_url: tinyLogo, receipt_show_logo: true, receipt_font_size: 14,
    receipt_paper: '58mm', logo_width_mm: 25,
  });
  ok('receipt settings save', r.status === 200 && r.body.receipt_font_size === 14 &&
    r.body.receipt_paper === '58mm' && r.body.logo_url === tinyLogo,
    JSON.stringify({ f: r.body.receipt_font_size, p: r.body.receipt_paper }).slice(0, 120));

  // --- amending an issued receipt ---
  r = await api('POST', '/api/sales', {
    items: [{ variant_id: v41.id, quantity: 2 }],
    payments: [{ method: 'cash', amount: 30000 }],
  });
  const amendable = r.body;
  ok('sale created for amendment', r.status === 201 && !!amendable.invoice_no,
    JSON.stringify(r.body).slice(0, 140));

  r = await api('GET', `/api/sales/${amendable.id}/editable`);
  ok('a fresh sale is editable', r.body.editable === true && r.body.window_days > 0,
    JSON.stringify(r.body).slice(0, 140));

  const stockBefore = (await api('GET', `/api/inventory/availability/${v41.id}`))
    .body.find((x) => x.location_id === lagosId)?.quantity;

  r = await api('PUT', `/api/sales/${amendable.id}`, {
    items: [{ variant_id: v41.id, quantity: 1 }],
    reason: 'E2E — customer put one pair back',
  });
  const amended = r.body;
  ok('amend an issued receipt', r.status === 200 && Number(amended.edit_count) === 1,
    JSON.stringify(r.body).slice(0, 180));
  ok('invoice number survives the amendment', amended.invoice_no === amendable.invoice_no,
    `${amendable.invoice_no} -> ${amended.invoice_no}`);
  ok('amended total recalculated', Number(amended.total) < Number(amendable.total));
  ok('overpayment becomes change due', Number(amended.change_due) > 0 || Number(amended.balance_due) === 0);

  const stockAfter = (await api('GET', `/api/inventory/availability/${v41.id}`))
    .body.find((x) => x.location_id === lagosId)?.quantity;
  ok('the returned pair went back on the shelf', Number(stockAfter) === Number(stockBefore) + 1,
    `${stockBefore} -> ${stockAfter}`);

  r = await api('GET', `/api/sales/${amendable.id}/revisions`);
  const rev = r.body[0];
  ok('revision recorded with before and after', r.body.length === 1 &&
    rev.before_json.items[0].quantity === 2 && rev.after_json.items[0].quantity === 1,
    JSON.stringify(r.body).slice(0, 200));
  ok('revision keeps the reason and who did it',
    /customer put one pair back/i.test(rev.reason) && !!rev.user_name);

  r = await api('PUT', `/api/sales/${amendable.id}`, {
    items: [{ variant_id: v41.id, quantity: 1 }],
  });
  ok('amendment without a reason is refused', r.status === 400 && /reason/i.test(r.body.error || ''));

  // a cashier must not be able to rewrite an issued receipt
  const adminToken2 = token;
  r = await api('POST', '/api/auth/login', { email: 'cashier@millzee.test', password: 'password123' });
  token = r.body.token;
  r = await api('PUT', `/api/sales/${amendable.id}`, {
    items: [{ variant_id: v41.id, quantity: 5 }], reason: 'should not be allowed',
  });
  ok('cashier cannot amend an issued receipt', r.status === 403, JSON.stringify(r.body).slice(0, 140));
  r = await api('GET', `/api/sales/${amendable.id}/editable`);
  ok('editable says why the cashier is blocked',
    r.body.editable === false && r.body.reasons.some((x) => /role/i.test(x)),
    JSON.stringify(r.body).slice(0, 160));
  token = adminToken2;

  // the window closes
  await api('PUT', '/api/settings', { sale_edit_window_days: 0 });
  r = await api('GET', `/api/sales/${amendable.id}/editable`);
  ok('a zero-day window blocks editing', r.body.editable === false &&
    r.body.reasons.some((x) => /days old/i.test(x)), JSON.stringify(r.body).slice(0, 160));
  r = await api('PUT', `/api/sales/${amendable.id}`, {
    items: [{ variant_id: v41.id, quantity: 1 }], reason: 'outside the window',
  });
  ok('amendment outside the window is refused', r.status === 403, JSON.stringify(r.body).slice(0, 140));
  await api('PUT', '/api/settings', { sale_edit_window_days: 30 });

  // a sale with a return against it is off limits
  r = await api('GET', `/api/sales/${sale.id}/editable`);
  ok('a sale with a return cannot be amended', r.body.editable === false &&
    r.body.reasons.some((x) => /return/i.test(x)), JSON.stringify(r.body).slice(0, 180));

  r = await api('GET', `/api/sales/${amendable.id}/receipt`);
  ok('receipt carries the logo and print sizing',
    r.body.business.logo_url === tinyLogo && Number(r.body.business.font_size) === 14 &&
    r.body.business.paper === '58mm', JSON.stringify(r.body.business).slice(0, 200));
  ok('amended receipt is marked as such', Number(r.body.sale.edit_count) === 1);

  await api('PUT', '/api/settings', {
    receipt_font_size: originalSettings.receipt_font_size,
    receipt_paper: originalSettings.receipt_paper,
    logo_url: originalSettings.logo_url || '',
  });

  // --- reports ---
  r = await api('GET', '/api/reports/dashboard');
  ok('dashboard report', r.body.month?.revenue > 0 && Array.isArray(r.body.trend));
  r = await api('GET', '/api/reports/sales?group_by=staff');
  ok('sales by staff', Array.isArray(r.body.rows) && r.body.rows.length > 0);
  r = await api('GET', '/api/reports/products?sort=fast');
  ok('best sellers + slow movers', Array.isArray(r.body.rows) && Array.isArray(r.body.no_sales));
  ok('size breakdown present', Array.isArray(r.body.by_size) && r.body.by_size.length > 0);
  r = await api('GET', '/api/reports/profit-loss');
  ok('profit & loss computes net profit', typeof r.body.net_profit === 'number');
  r = await api('GET', '/api/reports/tax');
  ok('VAT report with sequence check', Array.isArray(r.body.rows) && typeof r.body.invoice_sequence_gaps === 'number');
  r = await api('GET', '/api/inventory/valuation');
  ok('inventory valuation + potential profit',
    Number(r.body.summary.cost_value) > 0 && typeof r.body.summary.potential_profit === 'number');
  r = await api('GET', '/api/inventory/low-stock');
  ok('low stock list', Array.isArray(r.body));

  const res3 = await fetch(`${BASE}/api/reports/export/inventory?format=csv`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Location-Id': String(locationId) } });
  ok('inventory report exports to CSV', res3.status === 200);

  // --- register close ---
  r = await api('GET', '/api/registers/sessions/current');
  if (r.body?.id) {
    const expected = Number(r.body.expected_cash);
    r = await api('POST', `/api/registers/sessions/${r.body.id}/close`, { counted_cash: expected - 500 });
    ok('close register with a short count', Number(r.body.difference) === -500, JSON.stringify(r.body).slice(0, 150));
  } else ok('close register with a short count', false, 'no open session for this user');

  // --- expenses ---
  r = await api('POST', '/api/expenses', { amount: 15000, note: 'E2E generator fuel' });
  ok('record expense', r.status === 201);

  // --- audit log ---
  r = await api('GET', '/api/audit?limit=20');
  ok('audit log records actions', r.body.data?.length > 0 && r.body.data.some((a) => a.action === 'create'));

  // --- devices ---
  r = await api('GET', '/api/devices');
  ok('devices registered', r.body.length >= 2);
  const printer = r.body.find((d) => d.kind === 'rfid_printer');
  r = await api('POST', `/api/devices/${printer.id}/test`, {});
  ok('printer test label works in mock mode', r.body.ok === true && r.body.zpl.includes('^RFW'));


  /* ================================================================ */
  /*  Payment accounts, purchase returns, tax rates and the new       */
  /*  management reports added in the menu-rework tranche.            */
  /* ================================================================ */

  // --- payment accounts ---
  r = await api('POST', '/api/accounts', {
    name: 'E2E Cash Till', type: 'cash', opening_balance: 50000, is_default: true,
  });
  ok('create a payment account', r.status === 201 && r.body.id, JSON.stringify(r.body).slice(0, 150));
  const till = r.body;

  r = await api('POST', '/api/accounts', {
    name: 'E2E Moniepoint', type: 'mobile_money', bank_name: 'Moniepoint',
    account_number: '8100000000', opening_balance: 0,
  });
  ok('a second account does not inherit default', r.status === 201 && r.body.is_default === false);
  const wallet = r.body;

  r = await api('GET', '/api/accounts');
  ok('account list carries a computed balance',
    r.body.accounts.some((a) => a.id === till.id && Number(a.balance) >= 50000),
    JSON.stringify(r.body.accounts?.slice(0, 2)).slice(0, 200));

  r = await api('PUT', '/api/accounts/method-defaults', {
    mapping: { cash: till.id, transfer: wallet.id, card: '' },
  });
  ok('tender defaults saved', r.status === 200 && r.body.some((m) => m.method === 'cash'),
    JSON.stringify(r.body).slice(0, 150));

  // A payment taken after the mapping exists should land in the mapped account
  // on its own — a cashier is never asked to choose.
  r = await api('POST', '/api/sales', {
    items: [{ variant_id: searchHit.variant_id, quantity: 1 }],
    payments: [{ method: 'cash', amount: 60000 }],
    status: 'completed',
  });
  const mappedSale = r.body;
  ok('sale completes with tender mapping in place', r.status === 201, JSON.stringify(r.body).slice(0, 150));

  r = await api('GET', `/api/accounts/${till.id}`);
  ok('payment routed to the mapped account without being told',
    Number(r.body.money_in) > 0 && r.body.recent.some((m) => m.document === mappedSale.invoice_no),
    JSON.stringify({ in: r.body.money_in, n: r.body.recent?.length }));
  ok('account balance = opening + in - out',
    Math.abs(Number(r.body.balance) - (50000 + Number(r.body.money_in) - Number(r.body.money_out))) < 0.01);

  // A tender with no mapping must NOT be swept into the default cash till —
  // it would corrupt the drawer figure and hide that the bank account was
  // never set up. It should stay unassigned and visible in the report.
  r = await api('PUT', '/api/accounts/method-defaults', { mapping: { card: '' } });
  ok('a mapping can be cleared', r.status === 200);
  r = await api('POST', '/api/sales', {
    items: [{ variant_id: searchHit.variant_id, quantity: 1 }],
    payments: [{ method: 'card', amount: 300000 }],
    status: 'completed',
  });
  const cardSale = r.body;
  ok('an unmapped card payment still completes the sale', r.status === 201,
    JSON.stringify(r.body).slice(0, 150));
  r = await api('GET', `/api/accounts/${till.id}`);
  ok('an unmapped card payment is not swept into the cash till',
    !r.body.recent.some((m) => m.document === cardSale.invoice_no),
    JSON.stringify(r.body.recent?.slice(0, 2)).slice(0, 180));

  r = await api('GET', `/api/reports/payments?from=${daysAgoStr(1)}&to=${todayStr()}`);
  ok('the unassigned money is surfaced rather than hidden',
    r.body.sell_by_account.some((a) => a.account === 'Unassigned'),
    JSON.stringify(r.body.sell_by_account).slice(0, 180));

  r = await api('DELETE', `/api/accounts/${till.id}`);
  ok('an account with money against it is deactivated, not deleted',
    r.body.deactivated === true, JSON.stringify(r.body).slice(0, 150));

  r = await api('DELETE', `/api/accounts/${wallet.id}`);
  ok('an unused account deletes cleanly', r.body.deleted === true, JSON.stringify(r.body).slice(0, 120));

  // --- tax rates ---
  r = await api('POST', '/api/catalog/tax-rates', { name: 'E2E Zero-rated', rate: 0 });
  ok('create a zero-rated tax rate', r.status === 201 && r.body.is_exempt === true,
    JSON.stringify(r.body).slice(0, 150));
  const zeroRate = r.body;

  r = await api('POST', '/api/catalog/tax-rates', { name: 'E2E Standard', rate: 7.5 });
  ok('a non-zero rate is not marked exempt', r.status === 201 && r.body.is_exempt === false);
  const stdRate = r.body;

  r = await api('POST', '/api/catalog/tax-rates', { name: 'E2E Bad', rate: 150 });
  ok('an impossible rate is refused', r.status === 400, JSON.stringify(r.body).slice(0, 120));

  r = await api('GET', '/api/catalog');
  ok('tax rates reach the product form', (r.body.taxRates || []).some((t) => t.id === zeroRate.id));

  // A product carrying the zero rate must actually be taxed at zero.
  r = await api('POST', '/api/products', {
    name: 'E2E Exempt Item', type: 'single', unit: 'piece',
    tax_rate: 0, tax_rate_id: zeroRate.id, reorder_point: 1,
    variants: [{ size: '', color: '', cost_price: 1000, selling_price: 5000 }],
  });
  ok('product saves against a named tax rate', r.status === 201 && r.body.tax_rate_id === zeroRate.id,
    JSON.stringify(r.body).slice(0, 150));
  const exemptProduct = r.body;
  const exemptVariant = exemptProduct.variants[0];

  r = await api('GET', `/api/products/${exemptProduct.id}`);
  ok('the rate name comes back with the product', r.body.tax_rate_name === 'E2E Zero-rated',
    String(r.body.tax_rate_name));

  await api('POST', '/api/inventory/receive', {
    location_id: locationId, reason: 'E2E exempt stock',
    items: [{ variant_id: exemptVariant.id, quantity: 2, cost_price: 1000 }],
  });

  r = await api('POST', '/api/sales', {
    items: [
      { variant_id: exemptVariant.id, quantity: 1 },
      { variant_id: searchHit.variant_id, quantity: 1 },
    ],
    payments: [{ method: 'cash', amount: 200000 }],
    status: 'completed',
  });
  ok('a mixed-rate basket completes', r.status === 201, JSON.stringify(r.body).slice(0, 200));
  const mixedSale = r.body;

  r = await api('GET', `/api/sales/${mixedSale.id}`);
  const exemptLine = r.body.items.find((i) => i.variant_id === exemptVariant.id);
  const taxedLine = r.body.items.find((i) => i.variant_id === searchHit.variant_id);
  ok('the exempt line carries no VAT',
    Number(exemptLine?.tax_amount) === 0 && Number(exemptLine?.tax_rate) === 0,
    JSON.stringify(exemptLine).slice(0, 150));
  ok('the standard line still carries VAT', Number(taxedLine?.tax_amount) > 0);
  ok('the two lines sit at different rates',
    Number(exemptLine?.tax_rate) !== Number(taxedLine?.tax_rate),
    `${exemptLine?.tax_rate} vs ${taxedLine?.tax_rate}`);

  r = await api('DELETE', `/api/catalog/tax-rates/${stdRate.id}`);
  ok('an unused tax rate deletes', r.body.ok === true);
  r = await api('DELETE', `/api/catalog/tax-rates/${zeroRate.id}`);
  ok('a tax rate in use is deactivated, not deleted', r.body.deactivated === true,
    JSON.stringify(r.body).slice(0, 150));

  // --- purchase returns ---
  r = await api('GET', '/api/purchases/returns');
  ok('the returns list is not read as a purchase order id', r.status === 200 && Array.isArray(r.body.data),
    JSON.stringify(r.body).slice(0, 120));
  const returnsBefore = r.body.total;

  r = await api('GET', '/api/suppliers?limit=1');
  const returnSupplier = r.body.data[0];

  r = await api('POST', '/api/inventory/receive', {
    location_id: locationId, reason: 'E2E stock to send back',
    items: [{ variant_id: v41.id, quantity: 2, cost_price: 5000 }],
  });
  const returnableUnits = r.body.units;

  const stockOf = async (variantId) => {
    const res = await api('GET', `/api/products/${testProduct.id}`);
    return Number(res.body.variants?.find((x) => x.id === variantId)?.stock ?? 0);
  };
  const beforeQty = await stockOf(v41.id);

  r = await api('POST', '/api/purchases/returns', {
    supplier_id: returnSupplier.id, location_id: locationId,
    reason: 'Damaged in transit', credit_note: 'CN-E2E-1',
    items: [{ variant_id: v41.id, quantity: 2, unit_cost: 5000,
      unit_ids: returnableUnits.map((u) => u.id) }],
  });
  ok('record a purchase return', r.status === 201 && r.body.ref?.startsWith('PRT'),
    JSON.stringify(r.body).slice(0, 150));
  ok('the return is valued at cost', Number(r.body.total) === 10000, String(r.body.total));
  const purchaseReturn = r.body;

  r = await api('POST', '/api/purchases/returns', {
    supplier_id: returnSupplier.id, reason: '',
    items: [{ variant_id: v41.id, quantity: 1 }],
  });
  ok('a return without a reason is refused', r.status === 400, JSON.stringify(r.body).slice(0, 120));

  r = await api('POST', '/api/purchases/returns', {
    supplier_id: returnSupplier.id, reason: 'Faulty / defective',
    items: [{ variant_id: v41.id, quantity: 9999 }],
  });
  ok('returning more than you hold is refused', r.status === 400, JSON.stringify(r.body).slice(0, 140));

  const afterQty = await stockOf(v41.id);
  ok('stock drops by exactly what went back', beforeQty - afterQty === 2, `${beforeQty} -> ${afterQty}`);

  r = await api('GET', `/api/purchases/returns/${purchaseReturn.id}`);
  ok('the return records which physical units left', r.body.units?.length === 2,
    JSON.stringify(r.body.units).slice(0, 150));
  ok('returned units are no longer sellable',
    r.body.units.every((u) => returnableUnits.some((x) => x.id === u.id)));

  r = await api('GET', `/api/rfid/units?variant_id=${v41.id}&status=returned_supplier`);
  ok('returned units carry their own status, not "damaged"',
    (r.body.data || []).length >= 2, JSON.stringify(r.body).slice(0, 140));

  // Shrinkage must not absorb supplier damage — that is the whole point.
  r = await api('GET', `/api/reports/stock-adjustments${'?from=' + daysAgoStr(1) + '&to=' + todayStr()}`);
  const shrinkReasons = (r.body.by_reason || []).map((x) => x.reason);
  ok('a supplier return is not counted as shrinkage',
    !shrinkReasons.some((x) => /returned to supplier/i.test(String(x))),
    JSON.stringify(shrinkReasons).slice(0, 150));

  r = await api('GET', '/api/purchases/returns');
  ok('the new return shows in the list', r.body.total === returnsBefore + 1,
    `${returnsBefore} -> ${r.body.total}`);

  r = await api('GET', `/api/reports/export/purchase-returns?format=csv&from=${daysAgoStr(1)}&to=${todayStr()}`, null, true);
  const prCsv = await r.text();
  ok('purchase returns export to CSV', r.status === 200 && prCsv.includes('PRT'), prCsv.slice(0, 80));

  // --- new management reports ---
  r = await api('GET', '/api/reports/today');
  ok('today strip reports a figure', r.status === 200 && r.body.revenue !== undefined,
    JSON.stringify(r.body).slice(0, 150));

  r = await api('GET', '/api/reports/alerts');
  ok('alerts endpoint answers',
    r.status === 200 && Array.isArray(r.body.low_stock) && Array.isArray(r.body.unpaid)
    && typeof r.body.count === 'number',
    JSON.stringify(r.body).slice(0, 150));
  ok('the alert badge count matches what is listed',
    r.body.count === r.body.low_stock.length + r.body.unpaid.length + (r.body.tags_pending > 0 ? 1 : 0),
    JSON.stringify({ c: r.body.count, l: r.body.low_stock.length, u: r.body.unpaid.length }));

  r = await api('GET', '/api/reports/payment-by-age');
  ok('payment by age buckets the debt',
    r.body.buckets && ['current', 'd31_60', 'd61_90', 'over_90'].every((k) => k in r.body.buckets),
    JSON.stringify(r.body.buckets));
  ok('the buckets add up to the total',
    Math.abs(Object.values(r.body.buckets).reduce((a, b) => a + Number(b), 0) - Number(r.body.total)) < 0.01);
  ok('aging is grouped by customer as well as invoice', Array.isArray(r.body.by_customer));

  r = await api('GET', '/api/reports/contacts-balance');
  ok('supplier & customer balances answer',
    Array.isArray(r.body.receivables) && Array.isArray(r.body.payables),
    JSON.stringify(r.body).slice(0, 150));
  ok('the supplier return shows against the supplier',
    r.body.payables.some((x) => x.id === returnSupplier.id && Number(x.returned) > 0),
    JSON.stringify(r.body.payables.find((x) => x.id === returnSupplier.id)).slice(0, 150));

  r = await api('GET', `/api/reports/purchase-sale?from=${daysAgoStr(30)}&to=${todayStr()}`);
  ok('purchase vs sale nets off returns on both sides',
    Number(r.body.sales.net) === Number(r.body.sales.gross) - Number(r.body.sales.returns) &&
    Number(r.body.purchases.net) === Number(r.body.purchases.total) - Number(r.body.purchases.returns),
    JSON.stringify(r.body).slice(0, 200));

  r = await api('GET', `/api/reports/payments?from=${daysAgoStr(30)}&to=${todayStr()}`);
  ok('money in & out splits by method and by account',
    Array.isArray(r.body.sell_by_method) && Array.isArray(r.body.sell_by_account),
    JSON.stringify(r.body).slice(0, 150));
  ok('money in equals the sum of the tender lines',
    Math.abs(r.body.sell_by_method.reduce((a, b) => a + Number(b.amount), 0) - Number(r.body.money_in)) < 0.01);

  r = await api('GET', `/api/reports/z-report?date=${todayStr()}`);
  ok('Z report answers for the day', r.status === 200 && r.body.totals,
    JSON.stringify(r.body).slice(0, 150));
  ok('Z report reconciles expected cash',
    Math.abs(Number(r.body.cash.expected) -
      (Number(r.body.cash.opening) + Number(r.body.cash.taken) - Number(r.body.cash.change_given))) < 0.01,
    JSON.stringify(r.body.cash));
  ok('Z report counts amendments separately', typeof r.body.amendments === 'number');

  r = await api('GET', `/api/reports/stock-adjustments?from=${daysAgoStr(90)}&to=${todayStr()}`);
  ok('shrinkage report groups by reason and by who authorised it',
    Array.isArray(r.body.by_reason) && Array.isArray(r.body.by_user),
    JSON.stringify(r.body).slice(0, 150));

  r = await api('GET', `/api/reports/export/aged-receivables?format=csv`, null, true);
  ok('aged receivables export to CSV', r.status === 200);

  // --- role matrix ---
  r = await api('GET', '/api/users/roles');
  ok('the role matrix is published', r.status === 200 && r.body.roles?.length >= 4,
    JSON.stringify(r.body).slice(0, 150));
  const adminRole = r.body.roles.find((x) => x.role === 'admin');
  const cashierRole = r.body.roles.find((x) => x.role === 'cashier');
  ok('admin is reported as a superuser', adminRole?.is_superuser === true);
  ok('a cashier has no settings write access',
    cashierRole?.areas?.settings && !/write/.test(cashierRole.areas.settings),
    String(cashierRole?.areas?.settings));
  ok('the matrix counts who holds each role', typeof cashierRole?.users === 'number');

  console.log(results.join('\n'));
  console.log('-'.repeat(64));
  console.log(`${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => {
  console.log(results.join('\n'));
  console.error('\nE2E crashed after the tests above:', e.message);
  process.exit(1);
});
