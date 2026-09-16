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
  const searchHit = r.body[0];

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

  const importCsv = [
    'product_name,product_sku,type,brand,category,sub_category,size,color,cost_price,selling_price,opening_stock,location_code',
    'E2E Import Shoe,E2E-IMP-1,variable,TestBrand,Footwear,Sneakers,42,Blue,8000,17000,2,LAG',
    'E2E Import Shoe,E2E-IMP-1,variable,TestBrand,Footwear,Sneakers,43,Blue,8000,17000,1,LAG',
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
