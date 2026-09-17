/**
 * RFID routes — EPC encoding, tag printing, scanning, stock-take and find-item.
 * Hardware calls all funnel through services/hardware.js, so connecting a real
 * Zebra printer or handheld reader is a configuration change, not a rewrite.
 */
import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, int, num, paging, nextRef, getSettings } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { normalizeEpc, parseEpc, isEpcHex, isMintedEpc, epcBits, toWords, toBase64 } from '../services/epc.js';
import { buildZpl, sendToPrinter, parseReaderPayload, simulateSweep } from '../services/hardware.js';
import { setUnitStatus } from '../services/inventory.js';

const r = Router();

const UNIT_SELECT = `
  SELECT su.*, v.sku AS variant_sku, v.size, v.color, v.selling_price, v.cost_price AS variant_cost,
         p.id AS product_id, p.name AS product_name, p.image_url, p.unit AS uom,
         l.name AS location_name, l.code AS location_code
    FROM stock_units su
    JOIN product_variants v ON v.id=su.variant_id
    JOIN products p ON p.id=v.product_id
    LEFT JOIN locations l ON l.id=su.location_id`;


/* ------------------------------------------------------------------ */
/*  Binding a pre-encoded tag to a unit                                */
/* ------------------------------------------------------------------ */

/**
 * The other way round from printing.
 *
 * The designed flow is: this system mints a 96-bit EPC, a Zebra RFID printer
 * writes it onto the inlay. That needs an RFID printer, which most small shops
 * do not have and do not need — plain pre-encoded UHF labels are cheap, and
 * every one already carries a unique factory EPC.
 *
 * So this is the inverse: stick a tag on the shoe, read it with the handheld,
 * and bind whatever EPC that tag already holds to this unit. The unit keeps its
 * human-readable label and its history; only the code the antenna will hear
 * changes. Same per-unit identity, no printer.
 */
r.get('/untagged', h(async (req, res) => {
  const locationId = req.query.location_id === 'all'
    ? null : (int(req.query.location_id, req.locationId) || null);
  const { limit, offset, page } = paging(req, 50);
  const rows = await many(
    `${UNIT_SELECT}
      WHERE su.status = 'in_stock' AND NOT su.tag_encoded
        AND ($1::int IS NULL OR su.location_id = $1)
      ORDER BY p.name, v.size, su.serial
      LIMIT ${limit} OFFSET ${offset}`, [locationId]);
  const total = await one(
    `SELECT COUNT(*)::int AS n FROM stock_units su
      WHERE su.status='in_stock' AND NOT su.tag_encoded
        AND ($1::int IS NULL OR su.location_id=$1)`, [locationId]);
  res.json({ data: rows, page, limit, total: total.n });
}));

r.post('/units/:id/assign-tag', requirePerm('rfid.encode'), h(async (req, res) => {
  const epc = normalizeEpc(req.body.epc);
  if (!epc) throw bad('Scan a tag first');
  if (!isEpcHex(epc))
    throw bad(`"${epc}" is not a usable EPC. Expected hex, ${epcBits(epc)} bits read.`);

  const unit = await one(`${UNIT_SELECT} WHERE su.id=$1`, [req.params.id]);
  if (!unit) throw notFound('Unit not found');
  if (unit.status !== 'in_stock')
    throw bad(`That unit is ${unit.status}, so it should not be re-tagged.`);

  // Refuse to move a tag that is already doing a job elsewhere. Silently
  // stealing it would leave the other unit unfindable and the count wrong.
  const clash = await one(
    `${UNIT_SELECT} WHERE su.epc=$1 AND su.id <> $2`, [epc, req.params.id]);
  if (clash) {
    throw bad(
      `That tag is already on ${clash.product_name} ${[clash.size, clash.color].filter(Boolean).join(' / ')}`
      + ` (${clash.epc_readable}, ${clash.status}). Use a different tag.`);
  }

  const previous = unit.epc;
  const updated = await one(
    `UPDATE stock_units
        SET epc=$2, tag_encoded=TRUE, encoded_at=now(), last_seen_at=now()
      WHERE id=$1 RETURNING *`, [req.params.id, epc]);

  await audit(req, 'assign_tag', 'stock_unit', unit.id, {
    readable: unit.epc_readable, from: previous, to: epc, bits: epcBits(epc) });

  res.json({
    ok: true,
    unit: { ...unit, ...updated },
    previous_epc: previous,
    bits: epcBits(epc),
    minted_by_us: isMintedEpc(epc),
    message: `${unit.product_name} ${[unit.size, unit.color].filter(Boolean).join(' / ')} is now on tag ${epc}`,
  });
}));

/** Undo a binding — puts the unit back in the untagged queue. */
r.post('/units/:id/unassign-tag', requirePerm('rfid.encode'), h(async (req, res) => {
  const unit = await one('SELECT * FROM stock_units WHERE id=$1', [req.params.id]);
  if (!unit) throw notFound('Unit not found');
  await query('UPDATE stock_units SET tag_encoded=FALSE, encoded_at=NULL WHERE id=$1', [req.params.id]);
  await audit(req, 'unassign_tag', 'stock_unit', unit.id, { epc: unit.epc });
  res.json({ ok: true, message: 'Unit is back in the untagged list. Its code is unchanged.' });
}));

/* ---------------- unit registry ---------------- */
r.get('/units', h(async (req, res) => {
  const { limit, offset, page } = paging(req, 50);
  const params = [];
  const where = ['TRUE'];
  const add = (sql, v) => { params.push(v); where.push(sql.replace(/\?/g, `$${params.length}`)); };
  if (req.query.location_id && req.query.location_id !== 'all') add('su.location_id = ?', int(req.query.location_id));
  if (req.query.status) add('su.status = ?', str(req.query.status));
  if (req.query.variant_id) add('su.variant_id = ?', int(req.query.variant_id));
  if (req.query.product_id) add('p.id = ?', int(req.query.product_id));
  if (req.query.encoded === 'false') where.push('NOT su.tag_encoded');
  if (req.query.encoded === 'true') where.push('su.tag_encoded');
  if (req.query.q) add('(su.epc ILIKE ? OR su.epc_readable ILIKE ? OR p.name ILIKE ? OR v.sku ILIKE ?)', `%${req.query.q}%`);

  const rows = await many(
    `${UNIT_SELECT} WHERE ${where.join(' AND ')} ORDER BY su.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  const total = await one(
    `SELECT COUNT(*)::int AS n FROM stock_units su
       JOIN product_variants v ON v.id=su.variant_id JOIN products p ON p.id=v.product_id
      WHERE ${where.join(' AND ')}`, params);
  res.json({ data: rows, page, limit, total: total.n });
}));

r.get('/units/:id', h(async (req, res) => {
  const unit = await one(`${UNIT_SELECT} WHERE su.id=$1`, [req.params.id]);
  if (!unit) throw notFound('Unit not found');
  unit.epc_parts = parseEpc(unit.epc);
  unit.epc_words = toWords(unit.epc);
  unit.epc_base64 = toBase64(unit.epc);
  unit.print_jobs = await many(
    'SELECT id, status, created_at, error, device_id FROM print_jobs WHERE unit_id=$1 ORDER BY id DESC LIMIT 10',
    [unit.id]);
  res.json(unit);
}));

/* ---------------- encode + print ---------------- */
async function encodeUnit(req, unitId, deviceId, copies) {
  const settings = await getSettings();
  const unit = await one(`${UNIT_SELECT} WHERE su.id=$1`, [unitId]);
  if (!unit) throw notFound(`Unit ${unitId} not found`);
  const device = deviceId
    ? await one('SELECT * FROM devices WHERE id=$1 AND kind=$2', [deviceId, 'rfid_printer'])
    : await one(`SELECT * FROM devices WHERE kind='rfid_printer' AND is_active
                  ORDER BY (location_id = $1) DESC NULLS LAST, id LIMIT 1`, [req.locationId]);

  const zpl = buildZpl({
    epc: unit.epc,
    readable: unit.epc_readable,
    productName: unit.product_name,
    variantLabel: [unit.size, unit.color].filter(Boolean).join(' / '),
    sku: unit.variant_sku,
    price: Number(unit.selling_price).toLocaleString('en-NG'),
    currency: settings.currency_symbol,
    copies,
  });

  let outcome;
  try {
    outcome = await sendToPrinter(device, zpl);
  } catch (err) {
    await query(
      `INSERT INTO print_jobs (device_id,unit_id,epc,payload,status,error,user_id)
       VALUES ($1,$2,$3,$4,'failed',$5,$6)`,
      [device?.id || null, unit.id, unit.epc, zpl, err.message, req.user.id]);
    throw bad(`Printer error: ${err.message}`);
  }

  const job = await one(
    `INSERT INTO print_jobs (device_id,unit_id,epc,payload,status,user_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [device?.id || null, unit.id, unit.epc, zpl, outcome.status, req.user.id]);

  await query('UPDATE stock_units SET tag_encoded=TRUE, encoded_at=now() WHERE id=$1', [unit.id]);
  if (device) await query('UPDATE devices SET last_used_at=now() WHERE id=$1', [device.id]);

  return { unit, zpl, job, device: device || { id: null, name: 'Mock printer', driver: 'mock' }, outcome };
}

r.post('/units/:id/encode', requirePerm('rfid.encode'), h(async (req, res) => {
  const out = await encodeUnit(req, int(req.params.id), int(req.body.device_id) || null, int(req.body.copies, 1));
  await audit(req, 'encode_tag', 'stock_unit', out.unit.id, { epc: out.unit.epc, mode: out.outcome.status });
  res.json({
    ok: true,
    epc: out.unit.epc,
    epc_readable: out.unit.epc_readable,
    zpl: out.zpl,
    status: out.outcome.status,
    transport: out.outcome.transport,
    message: out.outcome.detail,
    device: { id: out.device.id, name: out.device.name, driver: out.device.driver },
    job_id: out.job.id,
  });
}));

r.post('/encode-batch', requirePerm('rfid.encode'), h(async (req, res) => {
  const ids = (req.body.unit_ids || []).map(Number).filter(Boolean);
  if (!ids.length) throw bad('Select at least one unit');
  const results = [];
  for (const id of ids) {
    try {
      const out = await encodeUnit(req, id, int(req.body.device_id) || null, 1);
      results.push({ unit_id: id, epc: out.unit.epc, status: out.outcome.status, zpl: out.zpl });
    } catch (err) {
      results.push({ unit_id: id, status: 'failed', error: err.message });
    }
  }
  await audit(req, 'encode_tag_batch', 'stock_unit', ids.join(','), { count: ids.length });
  res.json({ ok: true, results, printed: results.filter((x) => x.status !== 'failed').length });
}));

/** Preview the exact ZPL without marking the tag as encoded. */
r.get('/units/:id/zpl', h(async (req, res) => {
  const settings = await getSettings();
  const unit = await one(`${UNIT_SELECT} WHERE su.id=$1`, [req.params.id]);
  if (!unit) throw notFound('Unit not found');
  res.type('text/plain').send(buildZpl({
    epc: unit.epc, readable: unit.epc_readable, productName: unit.product_name,
    variantLabel: [unit.size, unit.color].filter(Boolean).join(' / '),
    sku: unit.variant_sku, price: Number(unit.selling_price).toLocaleString('en-NG'),
    currency: settings.currency_symbol,
  }));
}));

/* ---------------- resolve a scanned code ---------------- */
async function resolveOne(epcRaw, { locationId = null, context = 'lookup', userId = null, deviceId = null, rssi = null }) {
  const epc = normalizeEpc(epcRaw);
  const parts = parseEpc(epc);

  // A scanner may also feed a barcode or the human-readable label.
  let unit = await one(`${UNIT_SELECT} WHERE su.epc=$1`, [epc]);
  if (!unit) unit = await one(`${UNIT_SELECT} WHERE upper(su.epc_readable)=$1`, [String(epcRaw).trim().toUpperCase()]);

  let fallbackVariant = null;
  if (!unit) {
    fallbackVariant = await one(
      `SELECT v.id AS variant_id, v.sku, v.size, v.color, p.name AS product_name, p.id AS product_id
         FROM product_variants v JOIN products p ON p.id=v.product_id
        WHERE upper(v.sku)=$1 OR v.barcode=$2 LIMIT 1`,
      [String(epcRaw).trim().toUpperCase(), String(epcRaw).trim()]);
  }

  await query(
    `INSERT INTO scan_events (epc, unit_id, location_id, device_id, context, rssi, resolved, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [epc || String(epcRaw), unit?.id || null, locationId, deviceId, context, rssi, !!unit, userId]);

  if (unit) await query('UPDATE stock_units SET last_seen_at=now() WHERE id=$1', [unit.id]);

  return {
    input: String(epcRaw),
    epc,
    valid_format: isEpcHex(epc),
    parts,
    resolved: !!unit,
    unit: unit || null,
    matched_variant: fallbackVariant,
    match_type: unit ? 'unit' : fallbackVariant ? 'variant_only' : 'none',
    message: unit
      ? `Resolved to ${unit.product_name} (${[unit.size, unit.color].filter(Boolean).join(' / ') || 'default'}) — unit #${unit.serial}, status ${unit.status}`
      : fallbackVariant
        ? 'That code matches a product/SKU but not an individual tagged unit.'
        : 'No unit found for that code. It may belong to another system or the tag is not registered here.',
  };
}

r.post('/resolve', h(async (req, res) => {
  const codes = Array.isArray(req.body.codes)
    ? req.body.codes
    : String(req.body.code || '').split(/[\s,;\n\r]+/).filter(Boolean);
  if (!codes.length) throw bad('Enter at least one code');
  const results = [];
  for (const code of codes.slice(0, 2000)) {
    results.push(await resolveOne(code, {
      locationId: req.locationId, context: str(req.body.context, 'lookup'), userId: req.user.id,
    }));
  }
  res.json({ count: results.length, resolved: results.filter((x) => x.resolved).length, results });
}));

/** Endpoint a real handheld reader (or its companion app) posts reads to. */
r.post('/scan-events', h(async (req, res) => {
  const reads = parseReaderPayload(req.body);
  if (!reads.length) throw bad('No EPCs in payload');
  const context = str(req.body.context, 'lookup');
  const deviceId = int(req.body.device_id) || null;
  const stockTakeId = int(req.body.stock_take_id) || null;

  const results = [];
  for (const read of reads.slice(0, 5000)) {
    const resolved = await resolveOne(read.epc, {
      locationId: req.locationId, context, userId: req.user.id, deviceId, rssi: read.rssi,
    });
    results.push(resolved);
  }

  if (stockTakeId) {
    const applied = await applyScansToStockTake(stockTakeId, reads.map((x) => x.epc), req);
    return res.json({ ok: true, count: results.length, stock_take: applied });
  }
  res.json({ ok: true, count: results.length, resolved: results.filter((x) => x.resolved).length, results });
}));

r.get('/scan-events', h(async (req, res) => {
  const { limit } = paging(req, 50, 200);
  const rows = await many(
    `SELECT se.*, su.epc_readable, p.name AS product_name, v.size, v.color, u.name AS user_name
       FROM scan_events se
       LEFT JOIN stock_units su ON su.id=se.unit_id
       LEFT JOIN product_variants v ON v.id=su.variant_id
       LEFT JOIN products p ON p.id=v.product_id
       LEFT JOIN users u ON u.id=se.user_id
      ORDER BY se.id DESC LIMIT ${limit}`);
  res.json(rows);
}));

/** Generate a realistic mock sweep for demos (uses real EPCs at the location). */
r.post('/simulate-sweep', h(async (req, res) => {
  const locationId = int(req.body.location_id, req.locationId);
  const size = int(req.body.size, 25);
  const includeMissingRate = num(req.body.missing_rate, 0.1);
  const units = await many(
    `SELECT epc FROM stock_units WHERE location_id=$1 AND status='in_stock' ORDER BY random() LIMIT $2`,
    [locationId, size]);
  let epcs = units.map((u) => u.epc);
  // drop a few to emulate tags the reader could not see
  epcs = epcs.filter(() => Math.random() > includeMissingRate);
  // and add a stray from another location, if one exists
  if (req.body.include_stray !== false) {
    const stray = await one(
      `SELECT epc FROM stock_units WHERE location_id IS DISTINCT FROM $1 AND status='in_stock' ORDER BY random() LIMIT 1`,
      [locationId]);
    if (stray) epcs.push(stray.epc);
  }
  res.json({ reads: simulateSweep(epcs), unique: epcs.length });
}));

/* ---------------- find item ---------------- */
r.get('/find', h(async (req, res) => {
  const variantId = int(req.query.variant_id) || null;
  const q = str(req.query.q).trim();
  if (!variantId && !q) throw bad('Give a variant_id or a search term');

  const variants = variantId
    ? await many(
        `SELECT v.id, v.sku, v.size, v.color, p.name AS product_name, p.id AS product_id
           FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=$1`, [variantId])
    : await many(
        `SELECT v.id, v.sku, v.size, v.color, p.name AS product_name, p.id AS product_id
           FROM product_variants v JOIN products p ON p.id=v.product_id
          WHERE p.name ILIKE $1 OR v.sku ILIKE $1 OR p.sku ILIKE $1
          ORDER BY p.name, v.size LIMIT 25`, [`%${q}%`]);

  const out = [];
  for (const v of variants) {
    const units = await many(
      `SELECT su.id, su.epc, su.epc_readable, su.status, su.location_id, su.last_seen_at, su.received_at,
              l.name AS location_name, l.code AS location_code
         FROM stock_units su LEFT JOIN locations l ON l.id=su.location_id
        WHERE su.variant_id=$1 AND su.status IN ('in_stock','in_transit','reserved')
        ORDER BY (su.location_id = $2) DESC, su.received_at ASC`,
      [v.id, req.locationId]);
    out.push({
      ...v,
      total_available: units.filter((u) => u.status === 'in_stock').length,
      here: units.filter((u) => u.status === 'in_stock' && u.location_id === req.locationId).length,
      units,
    });
  }
  res.json(out);
}));

/* ---------------- stock take / cycle count ---------------- */
r.post('/stock-takes', requirePerm('rfid.stocktake'), h(async (req, res) => {
  const locationId = int(req.body.location_id, req.locationId);
  const scope = str(req.body.scope, 'full');
  const open = await one("SELECT * FROM stock_takes WHERE location_id=$1 AND status='open'", [locationId]);
  if (open) return res.json({ ...open, resumed: true });

  const take = await tx(async (c) => {
    const ref = await nextRef(c, 'stock_takes', 'STK');
    const expected = await c.query(
      "SELECT COUNT(*)::int AS n FROM stock_units WHERE location_id=$1 AND status='in_stock'", [locationId]);
    const { rows } = await c.query(
      `INSERT INTO stock_takes (ref,location_id,scope,status,notes,started_by,expected_count)
       VALUES ($1,$2,$3,'open',$4,$5,$6) RETURNING *`,
      [ref, locationId, scope, str(req.body.notes), req.user.id, expected.rows[0].n]);
    return rows[0];
  });
  await audit(req, 'start', 'stock_take', take.id, { ref: take.ref, expected: take.expected_count });
  res.status(201).json(take);
}));

async function applyScansToStockTake(stockTakeId, codes, req) {
  const take = await one('SELECT * FROM stock_takes WHERE id=$1', [stockTakeId]);
  if (!take) throw notFound('Stock take not found');
  if (take.status !== 'open') throw bad('That stock take is already closed');

  // `results` carries one entry per code so the handheld can render its live
  // feed straight from this response. Without it the client had to re-fetch the
  // whole stock take after every read, which a continuous sweep turns into a
  // request storm.
  const summary = { added: 0, duplicates: 0, unknown: 0, wrong_location: 0, found: 0, results: [] };
  for (const raw of codes) {
    const epc = normalizeEpc(raw);
    const label = String(raw).trim().toUpperCase();
    if (!epc && !label) continue;

    // A count may come in as the RFID EPC, or — if the reader is in barcode
    // mode, or a tag is unreadable and someone types the label — as the
    // human-readable code printed on the same label. Both name the same
    // physical unit, so both have to resolve, or a barcode-driven count would
    // silently record every single item as an unknown tag.
    const UNIT_BY = `SELECT su.*, p.name AS product_name, v.size, v.color, v.sku
                       FROM stock_units su
                       JOIN product_variants v ON v.id=su.variant_id
                       JOIN products p ON p.id=v.product_id`;
    let unit = epc ? await one(`${UNIT_BY} WHERE su.epc=$1`, [epc]) : null;
    if (!unit) unit = await one(`${UNIT_BY} WHERE upper(su.epc_readable)=$1`, [label]);

    // Dedupe on the unit's real EPC once we know it, so scanning the barcode
    // and then reading the tag does not count the same pair twice.
    const key = unit?.epc || epc || label;
    let result = 'unknown';
    if (unit) {
      if (unit.location_id === take.location_id && unit.status === 'in_stock') result = 'found';
      else if (unit.location_id === take.location_id) result = 'unexpected';
      else result = 'wrong_location';
    }
    const ins = await query(
      `INSERT INTO stock_take_scans (stock_take_id, epc, unit_id, result)
       VALUES ($1,$2,$3,$4) ON CONFLICT (stock_take_id, epc) DO NOTHING RETURNING id`,
      [stockTakeId, key, unit?.id || null, result]);
    summary.results.push({
      code: String(raw),
      epc: key,
      result: ins.rowCount ? result : 'duplicate',
      product_name: unit?.product_name || null,
      variant: unit ? [unit.size, unit.color].filter(Boolean).join(' / ') : null,
      sku: unit?.sku || null,
    });
    if (!ins.rowCount) { summary.duplicates += 1; continue; }
    summary.added += 1;
    if (result === 'found') summary.found += 1;
    if (result === 'unknown') summary.unknown += 1;
    if (result === 'wrong_location') summary.wrong_location += 1;
    if (unit) await query('UPDATE stock_units SET last_seen_at=now() WHERE id=$1', [unit.id]);
    await query(
      `INSERT INTO scan_events (epc, unit_id, location_id, context, resolved, user_id)
       VALUES ($1,$2,$3,'stock_take',$4,$5)`,
      [key, unit?.id || null, take.location_id, !!unit, req.user.id]);
  }
  await refreshStockTakeCounts(stockTakeId);
  return { ...summary, stock_take_id: stockTakeId };
}

async function refreshStockTakeCounts(id) {
  await query(
    `UPDATE stock_takes st SET
       found_count = (SELECT COUNT(*) FROM stock_take_scans s WHERE s.stock_take_id=st.id AND s.result='found'),
       unexpected_count = (SELECT COUNT(*) FROM stock_take_scans s WHERE s.stock_take_id=st.id AND s.result IN ('unexpected','unknown','wrong_location')),
       missing_count = GREATEST(0, st.expected_count -
         (SELECT COUNT(*) FROM stock_take_scans s WHERE s.stock_take_id=st.id AND s.result='found'))
     WHERE st.id=$1`, [id]);
}

r.post('/stock-takes/:id/scan', requirePerm('rfid.stocktake'), h(async (req, res) => {
  const codes = Array.isArray(req.body.codes)
    ? req.body.codes
    : String(req.body.codes || req.body.code || '').split(/[\s,;\n\r]+/).filter(Boolean);
  if (!codes.length) throw bad('Nothing scanned');
  const summary = await applyScansToStockTake(int(req.params.id), codes, req);
  // expected_count is snapshotted when the count starts — deliberately not
  // recomputed here, or the target would move under the person counting.
  const take = await one('SELECT * FROM stock_takes WHERE id=$1', [req.params.id]);
  res.json({ ok: true, summary, stock_take: take });
}));

r.get('/stock-takes', h(async (req, res) => {
  const rows = await many(
    `SELECT st.*, l.name AS location_name, u.name AS started_by_name
       FROM stock_takes st JOIN locations l ON l.id=st.location_id
       LEFT JOIN users u ON u.id=st.started_by
      ORDER BY st.id DESC LIMIT 50`);
  res.json(rows);
}));

r.get('/stock-takes/:id', h(async (req, res) => {
  const take = await one(
    `SELECT st.*, l.name AS location_name, u.name AS started_by_name
       FROM stock_takes st JOIN locations l ON l.id=st.location_id
       LEFT JOIN users u ON u.id=st.started_by WHERE st.id=$1`, [req.params.id]);
  if (!take) throw notFound('Stock take not found');

  const scanned = await many(
    `SELECT s.*, su.epc_readable, su.variant_id, p.name AS product_name, v.size, v.color, v.sku,
            l.name AS unit_location
       FROM stock_take_scans s
       LEFT JOIN stock_units su ON su.id=s.unit_id
       LEFT JOIN product_variants v ON v.id=su.variant_id
       LEFT JOIN products p ON p.id=v.product_id
       LEFT JOIN locations l ON l.id=su.location_id
      WHERE s.stock_take_id=$1 ORDER BY s.id DESC`, [req.params.id]);

  const missing = await many(
    `SELECT su.id AS unit_id, su.epc, su.epc_readable, su.variant_id, su.received_at,
            p.name AS product_name, v.size, v.color, v.sku, v.cost_price
       FROM stock_units su
       JOIN product_variants v ON v.id=su.variant_id
       JOIN products p ON p.id=v.product_id
      WHERE su.location_id=$1 AND su.status='in_stock'
        AND su.id NOT IN (SELECT COALESCE(unit_id,0) FROM stock_take_scans WHERE stock_take_id=$2)
      ORDER BY p.name, v.size`, [take.location_id, take.id]);

  res.json({
    ...take,
    scans: scanned,
    found: scanned.filter((s) => s.result === 'found'),
    unexpected: scanned.filter((s) => s.result !== 'found'),
    missing,
    accuracy: take.expected_count
      ? Math.round(((take.expected_count - missing.length) / take.expected_count) * 1000) / 10
      : 100,
  });
}));

/** Close the count and optionally write off what was never found. */
r.post('/stock-takes/:id/reconcile', requirePerm('rfid.stocktake'), h(async (req, res) => {
  const id = int(req.params.id);
  const writeOff = req.body.write_off_missing !== false;
  const moveStrays = req.body.move_strays !== false;

  const result = await tx(async (c) => {
    const { rows: takes } = await c.query('SELECT * FROM stock_takes WHERE id=$1 FOR UPDATE', [id]);
    const take = takes[0];
    if (!take) throw notFound('Stock take not found');
    if (take.status !== 'open') throw bad('Already reconciled');

    const { rows: missing } = await c.query(
      `SELECT su.* FROM stock_units su
        WHERE su.location_id=$1 AND su.status='in_stock'
          AND su.id NOT IN (SELECT COALESCE(unit_id,0) FROM stock_take_scans WHERE stock_take_id=$2)`,
      [take.location_id, id]);

    let wroteOff = 0;
    if (writeOff && missing.length) {
      const ref = await nextRef(c, 'stock_adjustments', 'ADJ');
      const { rows: adjRows } = await c.query(
        `INSERT INTO stock_adjustments (ref,location_id,reason,notes,user_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [ref, take.location_id, 'Stock take shortage',
         `Units not found during ${take.ref}`, req.user.id]);
      const adj = adjRows[0];
      const byVariant = new Map();
      for (const u of missing) byVariant.set(u.variant_id, (byVariant.get(u.variant_id) || 0) + 1);
      await c.query("UPDATE stock_units SET status='lost', last_seen_at=now() WHERE id = ANY($1::bigint[])",
        [missing.map((u) => u.id)]);
      for (const u of missing) {
        await c.query(
          'INSERT INTO stock_adjustment_items (adjustment_id,variant_id,quantity_change,unit_id) VALUES ($1,$2,-1,$3)',
          [adj.id, u.variant_id, u.id]);
      }
      for (const [variantId, qty] of byVariant) {
        const { rows: inv } = await c.query(
          `INSERT INTO inventory (variant_id,location_id,quantity) VALUES ($1,$2,$3)
           ON CONFLICT (variant_id,location_id) DO UPDATE SET quantity = inventory.quantity - $4
           RETURNING quantity`, [variantId, take.location_id, -qty, qty]);
        await c.query(
          `INSERT INTO stock_movements (variant_id,location_id,type,quantity,balance_after,reference_type,reference_id,reason,user_id)
           VALUES ($1,$2,'stock_take',$3,$4,'stock_take',$5,$6,$7)`,
          [variantId, take.location_id, -qty, Number(inv[0].quantity), id, 'Stock take shortage', req.user.id]);
      }
      wroteOff = missing.length;
    }

    let moved = 0;
    if (moveStrays) {
      const { rows: strays } = await c.query(
        `SELECT s.unit_id, su.variant_id, su.location_id AS old_location
           FROM stock_take_scans s JOIN stock_units su ON su.id=s.unit_id
          WHERE s.stock_take_id=$1 AND s.result='wrong_location'`, [id]);
      for (const s of strays) {
        await c.query(
          "UPDATE stock_units SET location_id=$2, status='in_stock', last_seen_at=now() WHERE id=$1",
          [s.unit_id, take.location_id]);
        if (s.old_location) {
          await c.query(
            `UPDATE inventory SET quantity = quantity - 1 WHERE variant_id=$1 AND location_id=$2`,
            [s.variant_id, s.old_location]);
          await c.query(
            `INSERT INTO stock_movements (variant_id,location_id,type,quantity,reference_type,reference_id,reason,user_id)
             VALUES ($1,$2,'transfer_out',-1,'stock_take',$3,'Found at another branch during stock take',$4)`,
            [s.variant_id, s.old_location, id, req.user.id]);
        }
        await c.query(
          `INSERT INTO inventory (variant_id,location_id,quantity) VALUES ($1,$2,1)
           ON CONFLICT (variant_id,location_id) DO UPDATE SET quantity = inventory.quantity + 1`,
          [s.variant_id, take.location_id]);
        await c.query(
          `INSERT INTO stock_movements (variant_id,location_id,type,quantity,reference_type,reference_id,reason,user_id)
           VALUES ($1,$2,'transfer_in',1,'stock_take',$3,'Relocated by stock take',$4)`,
          [s.variant_id, take.location_id, id, req.user.id]);
        moved += 1;
      }
    }

    await c.query(
      `UPDATE stock_takes SET status='reconciled', completed_at=now(), missing_count=$2 WHERE id=$1`,
      [id, missing.length]);
    return { wroteOff, moved, missing: missing.length, take };
  });

  await refreshStockTakeCounts(id);
  await audit(req, 'reconcile', 'stock_take', id, result);
  res.json({ ok: true, ...result });
}));

r.post('/stock-takes/:id/cancel', requirePerm('rfid.stocktake'), h(async (req, res) => {
  await query("UPDATE stock_takes SET status='cancelled', completed_at=now() WHERE id=$1 AND status='open'", [req.params.id]);
  await audit(req, 'cancel', 'stock_take', req.params.id);
  res.json({ ok: true });
}));

/* ---------------- dashboard tiles ---------------- */
r.get('/overview', h(async (req, res) => {
  const locationId = req.locationId;
  const counts = await one(
    `SELECT
       COUNT(*) FILTER (WHERE status='in_stock') AS in_stock,
       COUNT(*) FILTER (WHERE status='in_stock' AND NOT tag_encoded) AS awaiting_encoding,
       COUNT(*) FILTER (WHERE status='sold') AS sold,
       COUNT(*) FILTER (WHERE status='in_transit') AS in_transit,
       COUNT(*) FILTER (WHERE status='lost') AS lost,
       COUNT(*) AS total
     FROM stock_units WHERE location_id=$1 OR $1 IS NULL`, [locationId]);
  const recentScans = await one(
    "SELECT COUNT(*)::int AS n FROM scan_events WHERE created_at > now() - interval '24 hours'");
  const devices = await many('SELECT id,name,kind,driver,host,port,is_active,last_used_at FROM devices ORDER BY kind, name');
  const openTake = await one("SELECT * FROM stock_takes WHERE location_id=$1 AND status='open'", [locationId]);
  res.json({ counts, scans_24h: recentScans.n, devices, open_stock_take: openTake });
}));

export default r;
