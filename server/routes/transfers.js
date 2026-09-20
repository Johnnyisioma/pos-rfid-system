import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, num, int, paging, nextRef } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { allocateUnits, moveStock, setUnitStatus } from '../services/inventory.js';
import { normalizeEpc, isEpcHex } from '../services/epc.js';

/**
 * Turn whatever the handheld sent into the units it refers to.
 *
 * Accepts an EPC or one of our printed labels, in any of the shapes a reader
 * emits them in. Anything that resolves to nothing comes back in `unknown`
 * rather than being dropped, because "four tags in that box are not in the
 * system" is the single most useful thing a receiving clerk can be told.
 */
async function resolveCodes(c, codes) {
  const cleaned = [...new Set(
    (codes || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!cleaned.length) return { units: [], unknown: [] };

  const epcs = cleaned.map(normalizeEpc).filter(isEpcHex);
  const labels = cleaned.filter((x) => !isEpcHex(normalizeEpc(x)));

  const { rows } = await c.query(
    `SELECT su.*, v.sku AS variant_sku, v.size, v.color, p.name AS product_name
       FROM stock_units su
       JOIN product_variants v ON v.id=su.variant_id
       JOIN products p ON p.id=v.product_id
      WHERE su.epc = ANY($1::text[]) OR su.epc_readable = ANY($2::text[])`,
    [epcs, labels.map((l) => l.toUpperCase())]);

  const found = new Set();
  rows.forEach((u) => { found.add(u.epc); found.add(String(u.epc_readable).toUpperCase()); });
  const unknown = cleaned.filter((raw) => {
    const n = normalizeEpc(raw);
    return !found.has(n) && !found.has(raw.toUpperCase());
  });
  return { units: rows, unknown };
}

const r = Router();

async function loadTransfer(id) {
  const t = await one(
    `SELECT t.*, fl.name AS from_location_name, fl.code AS from_code,
            tl.name AS to_location_name, tl.code AS to_code,
            u.name AS created_by_name, ru.name AS received_by_name
       FROM transfers t
       JOIN locations fl ON fl.id=t.from_location_id
       JOIN locations tl ON tl.id=t.to_location_id
       LEFT JOIN users u ON u.id=t.created_by
       LEFT JOIN users ru ON ru.id=t.received_by WHERE t.id=$1`, [id]);
  if (!t) return null;
  t.items = await many(
    `SELECT ti.*, v.sku, v.size, v.color, p.name AS product_name
       FROM transfer_items ti JOIN product_variants v ON v.id=ti.variant_id
       JOIN products p ON p.id=v.product_id WHERE ti.transfer_id=$1 ORDER BY ti.id`, [id]);
  t.units = await many(
    `SELECT tu.unit_id, tu.received, su.epc, su.epc_readable, su.variant_id, su.status,
            p.name AS product_name, v.size, v.color
       FROM transfer_units tu JOIN stock_units su ON su.id=tu.unit_id
       JOIN product_variants v ON v.id=su.variant_id JOIN products p ON p.id=v.product_id
      WHERE tu.transfer_id=$1 ORDER BY p.name`, [id]);
  return t;
}

r.get('/', h(async (req, res) => {
  const { limit, offset, page } = paging(req, 30);
  const locationId = req.query.location_id === 'all' ? null : int(req.query.location_id, req.locationId);
  const rows = await many(
    `SELECT t.*, fl.name AS from_location_name, tl.name AS to_location_name,
            (SELECT COALESCE(SUM(quantity),0) FROM transfer_items i WHERE i.transfer_id=t.id) AS total_qty,
            (SELECT COALESCE(SUM(received_quantity),0) FROM transfer_items i WHERE i.transfer_id=t.id) AS received_qty
       FROM transfers t
       JOIN locations fl ON fl.id=t.from_location_id
       JOIN locations tl ON tl.id=t.to_location_id
      WHERE ($1::int IS NULL OR t.from_location_id=$1 OR t.to_location_id=$1)
        AND ($2='' OR t.status=$2)
      ORDER BY t.created_at DESC LIMIT ${limit} OFFSET ${offset}`, [locationId, str(req.query.status)]);
  res.json({ data: rows, page, limit });
}));

r.get('/:id(\\d+)', h(async (req, res) => {
  const t = await loadTransfer(req.params.id);
  if (!t) throw notFound('Transfer not found');
  res.json(t);
}));

/** Create and (optionally) dispatch a transfer. Units move to `in_transit`. */
r.post('/', requirePerm('transfers.write'), h(async (req, res) => {
  const from = int(req.body.from_location_id, req.locationId);
  const to = int(req.body.to_location_id);
  if (!to) throw bad('Choose a destination location');
  if (from === to) throw bad('Source and destination must be different');
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw bad('Add at least one item');
  const dispatch = req.body.dispatch !== false;

  const out = await tx(async (c) => {
    const ref = await nextRef(c, 'transfers', 'TRF');
    const { rows } = await c.query(
      `INSERT INTO transfers (ref, from_location_id, to_location_id, status, notes, created_by, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [ref, from, to, dispatch ? 'in_transit' : 'draft', str(req.body.notes), req.user.id,
       dispatch ? new Date() : null]);
    const transfer = rows[0];
    const movedUnits = [];

    for (const it of items) {
      const variantId = int(it.variant_id);
      const qty = Math.round(num(it.quantity, 0));
      if (!variantId || qty <= 0) continue;

      const { rows: inv } = await c.query(
        'SELECT COALESCE(quantity,0) AS q FROM inventory WHERE variant_id=$1 AND location_id=$2',
        [variantId, from]);
      const have = inv.length ? Number(inv[0].q) : 0;
      if (have < qty) throw bad(`Only ${have} available at the source location for that item`);

      await c.query('INSERT INTO transfer_items (transfer_id, variant_id, quantity) VALUES ($1,$2,$3)',
        [transfer.id, variantId, qty]);

      if (dispatch) {
        const units = await allocateUnits(c, {
          variantId, locationId: from, quantity: qty,
          preferredUnitIds: (it.unit_ids || []).map(Number).filter(Boolean),
        });
        await setUnitStatus(c, units.map((u) => u.id), 'in_transit');
        for (const u of units) {
          await c.query('INSERT INTO transfer_units (transfer_id, unit_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [transfer.id, u.id]);
        }
        movedUnits.push(...units);
        await moveStock(c, {
          variantId, locationId: from, delta: -qty, type: 'transfer_out',
          referenceType: 'transfer', referenceId: transfer.id, reason: `Transfer ${ref} to location ${to}`,
          userId: req.user.id });
      }
    }
    return { transfer, movedUnits };
  });

  await audit(req, 'create', 'transfer', out.transfer.id, {
    ref: out.transfer.ref, from, to, units: out.movedUnits.length });
  res.status(201).json(await loadTransfer(out.transfer.id));
}));

r.post('/:id(\\d+)/dispatch', requirePerm('transfers.write'), h(async (req, res) => {
  const out = await tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM transfers WHERE id=$1 FOR UPDATE', [req.params.id]);
    const t = rows[0];
    if (!t) throw notFound('Transfer not found');
    if (t.status !== 'draft') throw bad('Only draft transfers can be dispatched');
    const { rows: items } = await c.query('SELECT * FROM transfer_items WHERE transfer_id=$1', [t.id]);
    let moved = 0;
    for (const it of items) {
      const qty = Math.round(Number(it.quantity));
      const units = await allocateUnits(c, { variantId: it.variant_id, locationId: t.from_location_id, quantity: qty });
      await setUnitStatus(c, units.map((u) => u.id), 'in_transit');
      for (const u of units) {
        await c.query('INSERT INTO transfer_units (transfer_id, unit_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [t.id, u.id]);
      }
      moved += units.length;
      await moveStock(c, {
        variantId: it.variant_id, locationId: t.from_location_id, delta: -qty, type: 'transfer_out',
        referenceType: 'transfer', referenceId: t.id, reason: `Transfer ${t.ref}`, userId: req.user.id });
    }
    await c.query("UPDATE transfers SET status='in_transit', sent_at=now() WHERE id=$1", [t.id]);
    return { t, moved };
  });
  await audit(req, 'dispatch', 'transfer', req.params.id, { units: out.moved });
  res.json(await loadTransfer(req.params.id));
}));

/**
 * Receive at the destination branch.
 *
 * Two ways in, and the difference matters:
 *
 *   by quantity   "six pairs arrived" — the system picks which six units of
 *                 that variant to land, because nobody scanned anything.
 *   by scan       the handheld swept the box. Now the system knows exactly
 *                 which units are physically here, and — more importantly —
 *                 which ones on the manifest are NOT.
 *
 * The second is the whole point of per-unit tags. A quantity receive can only
 * ever tell you the count matched; a scan receive tells you that the count
 * matched *and the contents did*, which is a different claim when a box has
 * been opened somewhere between two branches.
 *
 * Either way this is one transaction. A half-received transfer with stock
 * landed at the destination and still marked in transit at the source is the
 * kind of thing that takes a day to unpick.
 */
r.post('/:id(\\d+)/receive', requirePerm('transfers.write'), h(async (req, res) => {
  const lines = Array.isArray(req.body.items) ? req.body.items : null;
  const scanned = Array.isArray(req.body.epcs) ? req.body.epcs
    : Array.isArray(req.body.codes) ? req.body.codes : [];

  if (scanned.length) return receiveByScan(req, res, scanned);

  const out = await tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM transfers WHERE id=$1 FOR UPDATE', [req.params.id]);
    const t = rows[0];
    if (!t) throw notFound('Transfer not found');
    if (t.status !== 'in_transit') throw bad('Only transfers that are in transit can be received');

    const { rows: items } = await c.query('SELECT * FROM transfer_items WHERE transfer_id=$1 FOR UPDATE', [t.id]);
    const received = [];

    for (const it of items) {
      const requested = lines
        ? Math.round(num(lines.find((l) => int(l.item_id) === it.id)?.quantity, 0))
        : Math.round(Number(it.quantity) - Number(it.received_quantity));
      if (requested <= 0) continue;
      const outstanding = Number(it.quantity) - Number(it.received_quantity);
      if (requested > outstanding + 0.001) throw bad('Cannot receive more than was sent');

      const { rows: units } = await c.query(
        `SELECT tu.unit_id FROM transfer_units tu JOIN stock_units su ON su.id=tu.unit_id
          WHERE tu.transfer_id=$1 AND NOT tu.received AND su.variant_id=$2 LIMIT $3`,
        [t.id, it.variant_id, requested]);
      const unitIds = units.map((u) => u.unit_id);
      if (unitIds.length) {
        await c.query(
          `UPDATE stock_units SET status='in_stock', location_id=$2, last_seen_at=now()
            WHERE id = ANY($1::bigint[])`, [unitIds, t.to_location_id]);
        await c.query('UPDATE transfer_units SET received=TRUE WHERE transfer_id=$1 AND unit_id = ANY($2::bigint[])',
          [t.id, unitIds]);
      }
      await c.query('UPDATE transfer_items SET received_quantity = received_quantity + $2 WHERE id=$1',
        [it.id, requested]);
      await moveStock(c, {
        variantId: it.variant_id, locationId: t.to_location_id, delta: requested, type: 'transfer_in',
        referenceType: 'transfer', referenceId: t.id, reason: `Received on ${t.ref}`, userId: req.user.id });
      received.push({ variant_id: it.variant_id, quantity: requested, units: unitIds.length });
    }

    const { rows: totals } = await c.query(
      'SELECT COALESCE(SUM(quantity),0) AS sent, COALESCE(SUM(received_quantity),0) AS got FROM transfer_items WHERE transfer_id=$1',
      [t.id]);
    const complete = Number(totals[0].got) >= Number(totals[0].sent);
    if (complete) {
      await c.query("UPDATE transfers SET status='received', received_at=now(), received_by=$2 WHERE id=$1",
        [t.id, req.user.id]);
    }
    return { t, received, complete };
  });

  await audit(req, 'receive', 'transfer', req.params.id, { lines: out.received.length, complete: out.complete });
  res.json(await loadTransfer(req.params.id));
}));

/**
 * Receive exactly what was scanned, and say plainly what is missing.
 *
 * Nothing is landed unless the whole set is processed, and a unit that belongs
 * to a different transfer is refused rather than quietly absorbed — absorbing
 * it would leave the other transfer permanently short with no record of where
 * its stock went.
 */
async function receiveByScan(req, res, codes) {
  const out = await tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM transfers WHERE id=$1 FOR UPDATE', [req.params.id]);
    const t = rows[0];
    if (!t) throw notFound('Transfer not found');
    if (t.status !== 'in_transit') throw bad('Only transfers that are in transit can be received');

    const { units, unknown } = await resolveCodes(c, codes);

    const { rows: manifest } = await c.query(
      `SELECT tu.unit_id, tu.received, su.variant_id
         FROM transfer_units tu JOIN stock_units su ON su.id=tu.unit_id
        WHERE tu.transfer_id=$1 FOR UPDATE`, [t.id]);
    const onManifest = new Map(manifest.map((m) => [Number(m.unit_id), m]));

    const accept = [];
    const already = [];
    const elsewhere = [];
    for (const u of units) {
      const m = onManifest.get(Number(u.id));
      if (!m) { elsewhere.push(u); continue; }
      if (m.received) { already.push(u); continue; }
      accept.push(u);
    }

    // Land the accepted units and move the aggregate figures with them.
    const perVariant = new Map();
    for (const u of accept) {
      perVariant.set(u.variant_id, (perVariant.get(u.variant_id) || 0) + 1);
    }

    if (accept.length) {
      const ids = accept.map((u) => u.id);
      await c.query(
        `UPDATE stock_units SET status='in_stock', location_id=$2, last_seen_at=now()
          WHERE id = ANY($1::bigint[])`, [ids, t.to_location_id]);
      await c.query(
        'UPDATE transfer_units SET received=TRUE WHERE transfer_id=$1 AND unit_id = ANY($2::bigint[])',
        [t.id, ids]);

      for (const [variantId, qty] of perVariant) {
        await c.query(
          `UPDATE transfer_items SET received_quantity = received_quantity + $3
            WHERE transfer_id=$1 AND variant_id=$2`, [t.id, variantId, qty]);
        await moveStock(c, {
          variantId, locationId: t.to_location_id, delta: qty, type: 'transfer_in',
          referenceType: 'transfer', referenceId: t.id,
          reason: `Scanned in on ${t.ref}`, userId: req.user.id });
      }

      // Every scan is a sighting, which is what makes "where was this last
      // seen" answerable weeks later.
      await c.query(
        `INSERT INTO tag_sightings (epc, unit_id, location_id, context, user_id)
         SELECT su.epc, su.id, $2, 'transfer', $3 FROM stock_units su
          WHERE su.id = ANY($1::bigint[])`,
        [ids, t.to_location_id, req.user?.id || null]);
    }

    // What the manifest says should be in the box and was not scanned.
    const stillOut = manifest.filter((m) => !m.received
      && !accept.some((u) => Number(u.id) === Number(m.unit_id)));
    const { rows: shortfall } = stillOut.length
      ? await c.query(
        `SELECT su.id, su.epc, su.epc_readable, p.name AS product_name, v.size, v.color
           FROM stock_units su
           JOIN product_variants v ON v.id=su.variant_id
           JOIN products p ON p.id=v.product_id
          WHERE su.id = ANY($1::bigint[]) ORDER BY p.name`,
        [stillOut.map((m) => m.unit_id)])
      : { rows: [] };

    const { rows: totals } = await c.query(
      `SELECT COALESCE(SUM(quantity),0) AS sent, COALESCE(SUM(received_quantity),0) AS got
         FROM transfer_items WHERE transfer_id=$1`, [t.id]);
    const complete = Number(totals[0].got) >= Number(totals[0].sent);
    if (complete) {
      await c.query(
        "UPDATE transfers SET status='received', received_at=now(), received_by=$2 WHERE id=$1",
        [t.id, req.user.id]);
    }

    return {
      t, complete,
      summary: {
        scanned: codes.length,
        received: accept.length,
        already_received: already.length,
        not_on_this_transfer: elsewhere.map((u) => ({
          epc: u.epc, product_name: u.product_name,
          note: 'This unit is not on this transfer. Check the box it came from.' })),
        unknown_tags: unknown,
        missing: shortfall,
      },
    };
  });

  await audit(req, 'receive_by_scan', 'transfer', req.params.id, {
    received: out.summary.received, missing: out.summary.missing.length, complete: out.complete });

  const transfer = await loadTransfer(req.params.id);
  res.json({ ...transfer, summary: out.summary });
}

/**
 * Create a transfer from a sweep.
 *
 * The dispatching branch puts the box on the counter, reads it, and sends. No
 * picking from a list, no typing quantities — the manifest IS what is in the
 * box, because it was built by reading what is in the box.
 */
r.post('/from-scan', requirePerm('transfers.write'), h(async (req, res) => {
  const from = int(req.body.from_location_id, req.locationId);
  const to = int(req.body.to_location_id);
  if (!to) throw bad('Choose a destination location');
  if (from === to) throw bad('Source and destination must be different');
  const codes = Array.isArray(req.body.codes) ? req.body.codes
    : Array.isArray(req.body.epcs) ? req.body.epcs : [];
  if (!codes.length) throw bad('Scan at least one tag');

  const out = await tx(async (c) => {
    const { units, unknown } = await resolveCodes(c, codes);

    const sendable = [];
    const rejected = [];
    for (const u of units) {
      if (u.status !== 'in_stock') {
        rejected.push({ epc: u.epc, product_name: u.product_name,
          note: `That unit reads as "${u.status}", so it is not available to send.` });
      } else if (Number(u.location_id) !== Number(from)) {
        rejected.push({ epc: u.epc, product_name: u.product_name,
          note: 'That unit is booked to a different branch. Receive it here first.' });
      } else {
        sendable.push(u);
      }
    }
    if (!sendable.length) {
      throw bad('None of those tags can be sent from this branch. '
        + `${unknown.length} unknown, ${rejected.length} unavailable.`);
    }

    const ref = await nextRef(c, 'transfers', 'TRF');
    const { rows } = await c.query(
      `INSERT INTO transfers (ref, from_location_id, to_location_id, status, notes, created_by, sent_at)
       VALUES ($1,$2,$3,'in_transit',$4,$5,now()) RETURNING *`,
      [ref, from, to, str(req.body.notes), req.user.id]);
    const transfer = rows[0];

    const perVariant = new Map();
    for (const u of sendable) perVariant.set(u.variant_id, (perVariant.get(u.variant_id) || 0) + 1);

    for (const [variantId, qty] of perVariant) {
      await c.query('INSERT INTO transfer_items (transfer_id, variant_id, quantity) VALUES ($1,$2,$3)',
        [transfer.id, variantId, qty]);
      await moveStock(c, {
        variantId, locationId: from, delta: -qty, type: 'transfer_out',
        referenceType: 'transfer', referenceId: transfer.id,
        reason: `Scanned out on ${ref}`, userId: req.user.id });
    }

    const ids = sendable.map((u) => u.id);
    await setUnitStatus(c, ids, 'in_transit');
    await c.query(
      `INSERT INTO transfer_units (transfer_id, unit_id)
       SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING`, [transfer.id, ids]);
    await c.query(
      `INSERT INTO tag_sightings (epc, unit_id, location_id, context, user_id)
       SELECT su.epc, su.id, $2, 'transfer', $3 FROM stock_units su
        WHERE su.id = ANY($1::bigint[])`, [ids, from, req.user?.id || null]);

    return { transfer, sent: sendable.length, rejected, unknown };
  });

  await audit(req, 'create_from_scan', 'transfer', out.transfer.id, {
    ref: out.transfer.ref, units: out.sent, rejected: out.rejected.length });

  const transfer = await loadTransfer(out.transfer.id);
  res.status(201).json({
    ...transfer,
    summary: { sent: out.sent, rejected: out.rejected, unknown_tags: out.unknown },
  });
}));

r.post('/:id(\\d+)/cancel', requirePerm('transfers.write'), h(async (req, res) => {
  const out = await tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM transfers WHERE id=$1 FOR UPDATE', [req.params.id]);
    const t = rows[0];
    if (!t) throw notFound('Transfer not found');
    if (t.status === 'received') throw bad('A completed transfer cannot be cancelled');
    if (t.status === 'in_transit') {
      const { rows: units } = await c.query(
        'SELECT unit_id FROM transfer_units WHERE transfer_id=$1 AND NOT received', [t.id]);
      const ids = units.map((u) => u.unit_id);
      if (ids.length) {
        await c.query(
          `UPDATE stock_units SET status='in_stock', location_id=$2 WHERE id = ANY($1::bigint[])`,
          [ids, t.from_location_id]);
      }
      const { rows: items } = await c.query('SELECT * FROM transfer_items WHERE transfer_id=$1', [t.id]);
      for (const it of items) {
        const back = Number(it.quantity) - Number(it.received_quantity);
        if (back > 0) {
          await moveStock(c, {
            variantId: it.variant_id, locationId: t.from_location_id, delta: back, type: 'transfer_in',
            referenceType: 'transfer', referenceId: t.id, reason: `Transfer ${t.ref} cancelled`, userId: req.user.id });
        }
      }
    }
    await c.query("UPDATE transfers SET status='cancelled' WHERE id=$1", [t.id]);
    return t;
  });
  await audit(req, 'cancel', 'transfer', out.id, {});
  res.json({ ok: true });
}));

export default r;
