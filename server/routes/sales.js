import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import {
  h, bad, notFound, forbidden, str, num, int, bool, paging, nextInvoiceNo, getSettings, money,
} from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { can } from '../lib/permissions.js';
import { audit } from '../lib/audit.js';
import { computeTotals } from '../services/pricing.js';
import { allocateUnits, markUnitsSold, setUnitStatus, moveStock, bundleComponents } from '../services/inventory.js';
import { many as manyRows } from '../db/index.js';
import { normalizeEpc } from '../services/epc.js';
import { resolveAccountId } from '../services/accounts.js';
import { accrueForSale, clawbackForReturn } from '../services/commission.js';
import { postSale, postSalesReturn } from '../services/autopost.js';
import { queueSaleNotification } from '../services/notify.js';

const r = Router();

/* ------------------------------------------------------------------ */
/*  Core sale creation — shared by the till, quotations and offline sync */
/* ------------------------------------------------------------------ */
export async function createSale(c, body, ctx) {
  const { user, locationId, settings } = ctx;
  const status = ['completed', 'held', 'draft', 'quotation', 'layaway'].includes(body.status)
    ? body.status : 'completed';
  const saleType = status === 'quotation' ? 'quotation' : status === 'layaway' ? 'layaway' : 'sale';
  const affectsStock = status === 'completed' || status === 'layaway';

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) throw bad('The cart is empty');

  // ---- resolve prices, tax rates and costs from the database (never trust the client) ----
  const lines = [];
  for (const it of rawItems) {
    const variantId = int(it.variant_id);
    if (!variantId) throw bad('Every line needs a variant_id');
    const { rows } = await c.query(
      `SELECT v.id, v.sku, v.size, v.color, v.cost_price,
              COALESCE(lp.selling_price, v.selling_price) AS price,
              p.name, p.tax_rate, p.type
         FROM product_variants v
         JOIN products p ON p.id=v.product_id
         LEFT JOIN location_prices lp ON lp.variant_id=v.id AND lp.location_id=$2
        WHERE v.id=$1`, [variantId, locationId]);
    if (!rows.length) throw bad(`Product variant ${variantId} not found`);
    const v = rows[0];
    const qty = num(it.quantity, 1);
    if (qty <= 0) throw bad(`Quantity must be greater than zero for ${v.name}`);

    let unitPrice = num(it.unit_price, Number(v.price));
    if (unitPrice < 0) throw bad('Price cannot be negative');

    lines.push({
      variant_id: v.id, product_name: v.name, sku: v.sku, product_type: v.type,
      variant_label: [v.size, v.color].filter(Boolean).join(' / '),
      quantity: qty, unit_price: unitPrice,
      discount_amount: num(it.discount_amount, 0),
      discount_percent: num(it.discount_percent, 0),
      tax_rate: num(it.tax_rate, Number(v.tax_rate)),
      cost_price: Number(v.cost_price),
      unit_ids: Array.isArray(it.unit_ids) ? it.unit_ids.map(Number).filter(Boolean) : [],
      epcs: Array.isArray(it.epcs) ? it.epcs : [],
    });
  }

  // ---- customer group discount ----
  let customer = null;
  if (body.customer_id) {
    const { rows } = await c.query(
      `SELECT cu.*, g.discount_percent AS group_discount, g.name AS group_name
         FROM customers cu LEFT JOIN customer_groups g ON g.id=cu.group_id WHERE cu.id=$1`,
      [int(body.customer_id)]);
    customer = rows[0] || null;
  }

  const cartDiscount = {
    type: body.discount?.type === 'percent' ? 'percent' : 'fixed',
    value: num(body.discount?.value, 0),
  };
  if (customer?.group_discount > 0 && !cartDiscount.value) {
    cartDiscount.type = 'percent';
    cartDiscount.value = Number(customer.group_discount);
  }

  // ---- discount permission ceiling ----
  const totalsPreview = computeTotals(lines, cartDiscount, settings);
  const maxPct = user.role === 'admin' || user.role === 'manager' ? 100 : Number(user.max_discount_percent || 0);
  const effectivePct = totalsPreview.subtotal > 0
    ? (totalsPreview.discount_amount / totalsPreview.subtotal) * 100 : 0;
  if (effectivePct > maxPct + 0.001) {
    throw forbidden(
      `That discount is ${effectivePct.toFixed(1)}% — your limit is ${maxPct}%. Ask a manager to approve it.`);
  }

  const totals = totalsPreview;

  // ---- loyalty redemption ----
  let pointsRedeemed = 0;
  let pointsValue = 0;
  if (num(body.points_redeem, 0) > 0) {
    if (!customer) throw bad('Select a customer before redeeming points');
    const available = Number(customer.loyalty_points);
    pointsRedeemed = Math.min(num(body.points_redeem, 0), available);
    pointsValue = money(pointsRedeemed * Number(settings.loyalty_point_value));
    if (pointsValue > totals.total) {
      pointsValue = totals.total;
      pointsRedeemed = Math.ceil(pointsValue / Number(settings.loyalty_point_value));
    }
  }

  // ---- payments ----
  const payments = (Array.isArray(body.payments) ? body.payments : [])
    .map((p) => ({ method: str(p.method, 'cash'), amount: money(num(p.amount, 0)), reference: str(p.reference) }))
    .filter((p) => p.amount > 0);
  if (pointsValue > 0) payments.push({ method: 'points', amount: pointsValue, reference: `${pointsRedeemed} pts` });

  const storeCreditUsed = payments.filter((p) => p.method === 'store_credit').reduce((s, p) => s + p.amount, 0);
  if (storeCreditUsed > 0) {
    if (!customer) throw bad('Select a customer to use store credit');
    if (storeCreditUsed > Number(customer.store_credit) + 0.001)
      throw bad(`Store credit available is ${customer.store_credit}, cannot take ${storeCreditUsed}`);
  }

  const paid = money(payments.reduce((s, p) => s + p.amount, 0));
  const isCredit = bool(body.is_credit) || paid < totals.total - 0.001;
  let changeDue = 0;
  let balanceDue = 0;

  if (affectsStock) {
    if (paid >= totals.total) {
      const cashPaid = payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
      changeDue = money(Math.min(paid - totals.total, cashPaid));
    } else {
      balanceDue = money(totals.total - paid);
      if (status === 'completed' && !bool(body.is_credit) && status !== 'layaway') {
        // an under-payment on a normal sale is only allowed as an explicit credit sale
        throw bad(`Payment is short by ${balanceDue}. Mark it as a credit sale or collect the balance.`);
      }
      if (!customer) throw bad('Credit sales need a customer on file');

      // A customer blocked for overdue debt cannot take more credit until they
      // pay. This is the auto-blocking half of payment terms.
      if (customer.credit_blocked) {
        throw bad(`${customer.name} is blocked from credit${customer.credit_block_reason ? ` — ${customer.credit_block_reason}` : ''}. Collect the balance first.`);
      }
      const newBalance = Number(customer.balance) + balanceDue;
      if (Number(customer.credit_limit) > 0 && newBalance > Number(customer.credit_limit))
        throw bad(`This would put ${customer.name} at ${newBalance.toFixed(2)}, over their ${customer.credit_limit} credit limit`);
    }
  }

  // ---- stock check + unit allocation ----
  const allocations = [];
  if (affectsStock) {
    for (const line of lines) {
      const deductions = line.product_type === 'bundle'
        ? (await bundleComponents(c, line.variant_id)).map((b) => ({
            variantId: b.variant_id, qty: Number(b.quantity) * line.quantity }))
        : [{ variantId: line.variant_id, qty: line.quantity }];

      for (const d of deductions) {
        const { rows } = await c.query(
          'SELECT COALESCE(quantity,0) AS q FROM inventory WHERE variant_id=$1 AND location_id=$2',
          [d.variantId, locationId]);
        const have = rows.length ? Number(rows[0].q) : 0;
        if (have < d.qty && !bool(body.allow_oversell))
          throw bad(`Not enough stock for ${line.product_name} ${line.variant_label} — ${have} left at this location`);
      }

      // Units scanned at the till take priority over FIFO picks.
      let preferred = [...line.unit_ids];
      if (line.epcs.length) {
        const { rows } = await c.query(
          'SELECT id FROM stock_units WHERE epc = ANY($1::text[]) AND variant_id=$2',
          [line.epcs.map(normalizeEpc), line.variant_id]);
        preferred.push(...rows.map((x) => x.id));
      }
      const units = line.product_type === 'bundle'
        ? []
        : await allocateUnits(c, {
            variantId: line.variant_id, locationId, quantity: Math.round(line.quantity),
            preferredUnitIds: preferred,
          });
      allocations.push({ line, units, deductions });
    }
  }

  // ---- register session ----
  let sessionId = int(body.register_session_id) || null;
  if (!sessionId && affectsStock) {
    const { rows } = await c.query(
      "SELECT id FROM register_sessions WHERE user_id=$1 AND location_id=$2 AND status='open' ORDER BY id DESC LIMIT 1",
      [user.id, locationId]);
    sessionId = rows[0]?.id || null;
  }

  // ---- invoice number (sequential + unbroken) ----
  let invoice = { invoice_no: null, invoice_seq: null };
  if (status === 'completed' || status === 'layaway') invoice = await nextInvoiceNo(c);
  else if (status === 'quotation') invoice = { invoice_no: `QTE-${Date.now().toString(36).toUpperCase()}`, invoice_seq: null };

  const pointsEarned =
    settings.loyalty_enabled && customer && status === 'completed'
      ? Math.floor(totals.total / Number(settings.loyalty_earn_per || 1000))
      : 0;

  const { rows: saleRows } = await c.query(
    `INSERT INTO sales (invoice_no, invoice_seq, location_id, user_id, customer_id, register_session_id,
                        sale_type, status, subtotal, discount_amount, discount_type, discount_value,
                        tax_amount, total, cost_total, amount_paid, change_due, balance_due, is_credit,
                        points_earned, points_redeemed, note, hold_label, client_uuid, sales_rep_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
     RETURNING *`,
    [invoice.invoice_no, invoice.invoice_seq, locationId, user.id, customer?.id || null, sessionId,
     saleType, status, totals.subtotal, totals.discount_amount, cartDiscount.type, cartDiscount.value,
     totals.tax_amount, totals.total, totals.cost_total, paid, changeDue, balanceDue, isCredit && balanceDue > 0,
     pointsEarned, pointsRedeemed, str(body.note), str(body.hold_label) || null,
     str(body.client_uuid) || null,
     // Whoever served the customer, which is not always whoever is logged into
     // the till — one person often rings up what another person sold.
     int(body.sales_rep_id, null) || null]);
  const sale = saleRows[0];

  // Payment terms: a credit sale gets a due date from the customer's term, so
  // the aged-debt report and the auto-block sweep know when it turned overdue.
  if (isCredit && balanceDue > 0 && customer && Number(customer.payment_term_days) > 0) {
    await c.query(
      "UPDATE sales SET due_date = CURRENT_DATE + ($2 || ' days')::interval WHERE id=$1",
      [sale.id, String(customer.payment_term_days)]);
  }

  // ---- line items + unit links + stock movements ----
  for (let i = 0; i < totals.lines.length; i++) {
    const l = totals.lines[i];
    const { rows: itemRows } = await c.query(
      `INSERT INTO sale_items (sale_id, variant_id, product_name, variant_label, sku, quantity,
                               unit_price, discount_amount, tax_rate, tax_amount, line_total, cost_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [sale.id, l.variant_id, l.product_name, l.variant_label, l.sku, l.quantity,
       l.unit_price, l.discount_amount, l.tax_rate, l.tax_amount, l.line_total, l.cost_price]);
    const itemId = itemRows[0].id;

    if (affectsStock) {
      const alloc = allocations.find((a) => a.line.variant_id === l.variant_id && !a.consumed);
      if (alloc) {
        alloc.consumed = true;
        for (const u of alloc.units) {
          await c.query('INSERT INTO sale_item_units (sale_item_id, unit_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [itemId, u.id]);
        }
        if (status === 'layaway') {
          await setUnitStatus(c, alloc.units.map((u) => u.id), 'reserved');
        } else {
          await markUnitsSold(c, alloc.units.map((u) => u.id), sale.id);
        }
        for (const d of alloc.deductions) {
          await moveStock(c, {
            variantId: d.variantId, locationId, delta: -d.qty, type: 'sale',
            referenceType: 'sale', referenceId: sale.id, userId: user.id,
            reason: status === 'layaway' ? 'Layaway reservation' : null,
          });
        }
      }
    }
  }

  // ---- payments ----
  for (const p of payments) {
    const accountId = await resolveAccountId(c, p.method, p.account_id);
    await c.query(
      `INSERT INTO payments (sale_id, method, amount, reference, user_id, account_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [sale.id, p.method, p.amount, p.reference || null, user.id, accountId]);
  }

  // ---- customer ledgers ----
  if (customer) {
    if (storeCreditUsed > 0) {
      await c.query('UPDATE customers SET store_credit = store_credit - $2 WHERE id=$1', [customer.id, storeCreditUsed]);
      await c.query(
        `INSERT INTO store_credit_ledger (customer_id, amount, type, reference, user_id)
         VALUES ($1,$2,'redeem',$3,$4)`, [customer.id, -storeCreditUsed, sale.invoice_no, user.id]);
    }
    if (balanceDue > 0) {
      await c.query('UPDATE customers SET balance = balance + $2 WHERE id=$1', [customer.id, balanceDue]);
    }
    if (pointsRedeemed > 0) {
      await c.query('UPDATE customers SET loyalty_points = loyalty_points - $2 WHERE id=$1', [customer.id, pointsRedeemed]);
      await c.query(`INSERT INTO loyalty_ledger (customer_id, points, type, sale_id) VALUES ($1,$2,'redeem',$3)`,
        [customer.id, -pointsRedeemed, sale.id]);
    }
    if (pointsEarned > 0) {
      await c.query('UPDATE customers SET loyalty_points = loyalty_points + $2 WHERE id=$1', [customer.id, pointsEarned]);
      await c.query(`INSERT INTO loyalty_ledger (customer_id, points, type, sale_id) VALUES ($1,$2,'earn',$3)`,
        [customer.id, pointsEarned, sale.id]);
    }
  }

  /*
    Commission, inside the same transaction as the sale.

    A follow-up job would be simpler and would eventually pay somebody for a
    sale that was rolled back. Doing it here means the commission row and the
    sale it is for are true together or neither exists.
  */
  if (status === 'completed' || status === 'layaway') {
    const repId = int(body.sales_rep_id, null) || null;
    if (repId) {
      try {
        await accrueForSale(c, { saleId: sale.id, repId });
      } catch (e) {
        // A misconfigured commission rule must never stop a shop selling.
        console.error('[commission] accrual failed for sale', sale.id, e.message);
      }
    }
  }

  /*
    Warranty registration, in the same transaction.

    Every sold unit whose product carries a warranty policy gets its clock
    started here, keyed to the exact EPC. A claim later is checked against the
    tag, not a paper receipt. One INSERT...SELECT so it costs nothing when no
    product has a warranty.
  */
  if (status === 'completed') {
    try {
      await c.query(
        `INSERT INTO warranty_registrations
           (unit_id, variant_id, warranty_id, sale_id, customer_id, epc, starts_at, expires_at)
         SELECT su.id, su.variant_id, p.warranty_id, $1, $2, su.epc, CURRENT_DATE,
                CURRENT_DATE + (w.duration || ' ' || w.duration_unit)::interval
           FROM sale_item_units siu
           JOIN sale_items si ON si.id=siu.sale_item_id
           JOIN stock_units su ON su.id=siu.unit_id
           JOIN product_variants v ON v.id=su.variant_id
           JOIN products p ON p.id=v.product_id
           JOIN warranties w ON w.id=p.warranty_id
          WHERE si.sale_id=$1 AND p.warranty_id IS NOT NULL`,
        [sale.id, customer?.id || null]);
    } catch (e) {
      console.error('[warranty] registration failed for sale', sale.id, e.message);
    }

    // Book the sale to the ledger in the same transaction (revenue, VAT, COGS).
    try { await postSale(c, sale.id); }
    catch (e) { console.error('[ledger] sale posting failed', sale.id, e.message); }
  }

  return sale;
}


/* ------------------------------------------------------------------ */
/*  Amending an already-issued sale                                     */
/* ------------------------------------------------------------------ */

/**
 * Re-read every line from the database so an amendment can never be used to
 * invent a price. Mirrors the resolution step in createSale.
 */
async function resolveLines(c, rawItems, locationId, settings) {
  const lines = [];
  for (const it of rawItems) {
    const variantId = int(it.variant_id);
    if (!variantId) throw bad('Every line needs a product');
    const { rows } = await c.query(
      `SELECT v.id, v.sku, v.size, v.color, v.cost_price,
              COALESCE(lp.selling_price, v.selling_price) AS price,
              p.name, p.tax_rate, p.type
         FROM product_variants v
         JOIN products p ON p.id=v.product_id
         LEFT JOIN location_prices lp ON lp.variant_id=v.id AND lp.location_id=$2
        WHERE v.id=$1`, [variantId, locationId]);
    if (!rows.length) throw bad(`Product variant ${variantId} not found`);
    const v = rows[0];
    const qty = num(it.quantity, 1);
    if (qty <= 0) throw bad(`Quantity must be greater than zero for ${v.name}`);
    lines.push({
      variant_id: v.id, product_name: v.name, sku: v.sku, product_type: v.type,
      variant_label: [v.size, v.color].filter(Boolean).join(' / '),
      quantity: qty,
      unit_price: num(it.unit_price, Number(v.price)),
      discount_amount: num(it.discount_amount, 0),
      tax_rate: num(it.tax_rate, Number(v.tax_rate)),
      cost_price: Number(v.cost_price),
    });
  }
  return lines;
}

/**
 * Amend a completed sale in place.
 *
 * The invoice number, its sequence position and the original timestamp never
 * change — a VAT invoice sequence has to stay unbroken — so an amendment is
 * recorded as a revision with a full before/after snapshot rather than as a
 * new document. Stock is unwound line by line (the exact tagged units go back
 * on the shelf) and then re-allocated against the new lines.
 */
export async function amendSale(c, saleId, body, ctx) {
  const { user, settings } = ctx;

  const { rows: saleRows } = await c.query('SELECT * FROM sales WHERE id=$1 FOR UPDATE', [saleId]);
  const sale = saleRows[0];
  if (!sale) throw notFound('Sale not found');

  if (!['completed', 'layaway'].includes(sale.status))
    throw bad(`A sale with status "${sale.status}" cannot be amended.`);

  const { rows: returned } = await c.query(
    'SELECT COALESCE(SUM(returned_quantity),0) AS n FROM sale_items WHERE sale_id=$1', [saleId]);
  if (Number(returned[0].n) > 0)
    throw bad('This sale already has a return against it. Reverse the return first, or process another return instead of editing.');

  const windowDays = int(settings.sale_edit_window_days, 30);
  const ageDays = (Date.now() - new Date(sale.created_at).getTime()) / 86400000;
  if (ageDays > windowDays)
    throw forbidden(`This sale is ${Math.floor(ageDays)} days old. Sales can only be edited within ${windowDays} days of being issued.`);

  const reason = str(body.reason).trim();
  if (!reason) throw bad('Give a reason for the amendment — it is kept on the record.');

  const before = await loadSale(saleId);
  const locationId = sale.location_id;
  const allocatedTags = {};

  /* ---- 1. unwind the original lines ---- */
  const { rows: oldItems } = await c.query('SELECT * FROM sale_items WHERE sale_id=$1 ORDER BY id', [saleId]);
  for (const item of oldItems) {
    const { rows: unitRows } = await c.query(
      'SELECT unit_id FROM sale_item_units WHERE sale_item_id=$1', [item.id]);
    const unitIds = unitRows.map((u) => u.unit_id);
    if (unitIds.length) {
      await c.query(
        `UPDATE stock_units SET status='in_stock', location_id=$2, sale_id=NULL, sold_at=NULL,
                last_seen_at=now()
          WHERE id = ANY($1::bigint[])`, [unitIds, locationId]);
    }
    if (!item.variant_id) continue;
    const { rows: vt } = await c.query(
      `SELECT p.type FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=$1`,
      [item.variant_id]);
    const deductions = vt[0]?.type === 'bundle'
      ? (await bundleComponents(c, item.variant_id)).map((b) => ({
          variantId: b.variant_id, qty: Number(b.quantity) * Number(item.quantity) }))
      : [{ variantId: item.variant_id, qty: Number(item.quantity) }];
    for (const d of deductions) {
      await moveStock(c, {
        variantId: d.variantId, locationId, delta: d.qty, type: 'adjustment',
        referenceType: 'sale_amendment', referenceId: saleId,
        reason: `Amendment of ${sale.invoice_no}: original line reversed`, userId: user.id,
      });
    }
  }
  await c.query('DELETE FROM sale_items WHERE sale_id=$1', [saleId]);

  /* ---- 2. price the new lines ---- */
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) throw bad('An amended sale still needs at least one line. Process a full return instead.');
  const lines = await resolveLines(c, rawItems, locationId, settings);

  let customer = null;
  const newCustomerId = body.customer_id === null ? null : (int(body.customer_id) || sale.customer_id);
  if (newCustomerId) {
    const { rows } = await c.query(
      `SELECT cu.*, g.discount_percent AS group_discount FROM customers cu
         LEFT JOIN customer_groups g ON g.id=cu.group_id WHERE cu.id=$1`, [newCustomerId]);
    customer = rows[0] || null;
  }

  const cartDiscount = {
    type: body.discount?.type === 'percent' ? 'percent' : 'fixed',
    value: num(body.discount?.value, 0),
  };
  const totals = computeTotals(lines, cartDiscount, settings);

  const maxPct = user.role === 'admin' || user.role === 'manager' ? 100 : Number(user.max_discount_percent || 0);
  const effectivePct = totals.subtotal > 0 ? (totals.discount_amount / totals.subtotal) * 100 : 0;
  if (effectivePct > maxPct + 0.001)
    throw forbidden(`That discount is ${effectivePct.toFixed(1)}% — your limit is ${maxPct}%.`);

  /* ---- 3. re-allocate stock against the new lines ---- */
  for (const line of lines) {
    const deductions = line.product_type === 'bundle'
      ? (await bundleComponents(c, line.variant_id)).map((b) => ({
          variantId: b.variant_id, qty: Number(b.quantity) * line.quantity }))
      : [{ variantId: line.variant_id, qty: line.quantity }];
    for (const d of deductions) {
      const { rows } = await c.query(
        'SELECT COALESCE(quantity,0) AS q FROM inventory WHERE variant_id=$1 AND location_id=$2',
        [d.variantId, locationId]);
      const have = rows.length ? Number(rows[0].q) : 0;
      if (have < d.qty)
        throw bad(`Not enough stock for ${line.product_name} ${line.variant_label} — ${have} on hand after unwinding the original sale.`);
    }
    line._deductions = deductions;
  }

  for (let i = 0; i < totals.lines.length; i++) {
    const l = totals.lines[i];
    const { rows: itemRows } = await c.query(
      `INSERT INTO sale_items (sale_id, variant_id, product_name, variant_label, sku, quantity,
                               unit_price, discount_amount, tax_rate, tax_amount, line_total, cost_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [saleId, l.variant_id, l.product_name, l.variant_label, l.sku, l.quantity,
       l.unit_price, l.discount_amount, l.tax_rate, l.tax_amount, l.line_total, l.cost_price]);
    const itemId = itemRows[0].id;

    if (l.product_type !== 'bundle') {
      const units = await allocateUnits(c, {
        variantId: l.variant_id, locationId, quantity: Math.round(l.quantity),
        preferredUnitIds: Array.isArray(rawItems[i]?.unit_ids) ? rawItems[i].unit_ids.map(Number) : [],
      });
      for (const u of units) {
        await c.query('INSERT INTO sale_item_units (sale_item_id, unit_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [itemId, u.id]);
      }
      await markUnitsSold(c, units.map((u) => u.id), saleId);
      allocatedTags[i] = units.map((u) => u.epc_readable || u.epc);
    }
    for (const d of (lines[i]._deductions || [])) {
      await moveStock(c, {
        variantId: d.variantId, locationId, delta: -d.qty, type: 'sale',
        referenceType: 'sale_amendment', referenceId: saleId,
        reason: `Amendment of ${sale.invoice_no}`, userId: user.id,
      });
    }
  }

  /* ---- 4. money ---- */
  const paid = Number(sale.amount_paid);
  const balanceDue = Math.max(0, money(totals.total - paid));
  const changeDue = Math.max(0, money(paid - totals.total));

  const oldPoints = Number(sale.points_earned) || 0;
  const newPoints = settings.loyalty_enabled && customer && sale.status === 'completed'
    ? Math.floor(totals.total / Number(settings.loyalty_earn_per || 1000)) : 0;

  const { rows: updated } = await c.query(
    `UPDATE sales SET customer_id=$2, subtotal=$3, discount_amount=$4, discount_type=$5,
            discount_value=$6, tax_amount=$7, total=$8, cost_total=$9, balance_due=$10,
            change_due=$11, is_credit=$12, points_earned=$13, note=COALESCE($14, note),
            updated_at=now(), edited_at=now(), edited_by=$15, edit_count=edit_count+1
      WHERE id=$1 RETURNING *`,
    [saleId, customer?.id || null, totals.subtotal, totals.discount_amount, cartDiscount.type,
     cartDiscount.value, totals.tax_amount, totals.total, totals.cost_total, balanceDue,
     changeDue, balanceDue > 0, newPoints, body.note ?? null, user.id]);

  /* ---- 5. customer ledgers ---- */
  const oldBalance = Number(sale.balance_due) || 0;
  if (sale.customer_id && sale.customer_id !== (customer?.id || null) && oldBalance > 0) {
    await c.query('UPDATE customers SET balance = GREATEST(0, balance - $2) WHERE id=$1',
      [sale.customer_id, oldBalance]);
  }
  if (customer) {
    const delta = customer.id === sale.customer_id ? balanceDue - oldBalance : balanceDue;
    if (delta !== 0) {
      await c.query('UPDATE customers SET balance = GREATEST(0, balance + $2) WHERE id=$1',
        [customer.id, delta]);
    }
    const pointDelta = newPoints - (customer.id === sale.customer_id ? oldPoints : 0);
    if (pointDelta !== 0) {
      await c.query('UPDATE customers SET loyalty_points = GREATEST(0, loyalty_points + $2) WHERE id=$1',
        [customer.id, pointDelta]);
      await c.query(`INSERT INTO loyalty_ledger (customer_id, points, type, sale_id) VALUES ($1,$2,'amend',$3)`,
        [customer.id, pointDelta, saleId]);
    }
  } else if (sale.customer_id && oldPoints > 0) {
    await c.query('UPDATE customers SET loyalty_points = GREATEST(0, loyalty_points - $2) WHERE id=$1',
      [sale.customer_id, oldPoints]);
  }

  /* ---- 6. the permanent record ---- */
  const after = {
    invoice_no: updated[0].invoice_no,
    customer_name: customer?.name || null,
    subtotal: totals.subtotal,
    discount_amount: totals.discount_amount,
    tax_amount: totals.tax_amount,
    total: totals.total,
    amount_paid: paid,
    balance_due: balanceDue,
    items: totals.lines.map((l, i) => ({
      product_name: l.product_name, variant_label: l.variant_label, sku: l.sku,
      quantity: l.quantity, unit_price: l.unit_price, discount_amount: l.discount_amount,
      line_total: l.line_total,
      units: (allocatedTags[i] || []).map((t) => ({ readable: t })),
    })),
  };

  await c.query(
    `INSERT INTO sale_revisions (sale_id, revision, reason, before_json, after_json, user_id, user_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [saleId, Number(updated[0].edit_count), reason,
     JSON.stringify(snapshot(before)), JSON.stringify(snapshot(after)), user.id, user.name]);

  return { sale: updated[0], before, after };
}

/** Trim a loaded sale down to what is worth keeping in the revision log. */
function snapshot(sale) {
  if (!sale) return {};
  return {
    invoice_no: sale.invoice_no,
    customer: sale.customer_name || null,
    subtotal: Number(sale.subtotal),
    discount_amount: Number(sale.discount_amount),
    tax_amount: Number(sale.tax_amount),
    total: Number(sale.total),
    amount_paid: Number(sale.amount_paid),
    balance_due: Number(sale.balance_due),
    items: (sale.items || []).map((i) => ({
      product: i.product_name, variant: i.variant_label, sku: i.sku,
      quantity: Number(i.quantity), unit_price: Number(i.unit_price),
      discount: Number(i.discount_amount), line_total: Number(i.line_total),
      tags: (i.units || []).map((u) => u.readable || u.epc),
    })),
  };
}

r.put('/:id', requirePerm('sales.edit'), h(async (req, res) => {
  const settings = await getSettings();
  const out = await tx((c) => amendSale(c, int(req.params.id), req.body, { user: req.user, settings }));
  await audit(req, 'amend', 'sale', req.params.id, {
    invoice: out.sale.invoice_no,
    reason: str(req.body.reason),
    total_before: Number(out.before.total),
    total_after: Number(out.sale.total),
  });
  res.json(await loadSale(int(req.params.id)));
}));

/** Whether the signed-in user may still edit this sale, and why not. */
r.get('/:id/editable', h(async (req, res) => {
  const settings = await getSettings();
  const sale = await one('SELECT * FROM sales WHERE id=$1', [req.params.id]);
  if (!sale) throw notFound('Sale not found');
  const windowDays = int(settings.sale_edit_window_days, 30);
  const ageDays = (Date.now() - new Date(sale.created_at).getTime()) / 86400000;
  const returned = await one(
    'SELECT COALESCE(SUM(returned_quantity),0) AS n FROM sale_items WHERE sale_id=$1', [req.params.id]);

  const reasons = [];
  if (!can(req.user.role, 'sales.edit')) reasons.push('Your role cannot edit issued sales.');
  if (!['completed', 'layaway'].includes(sale.status)) reasons.push(`Status is "${sale.status}".`);
  if (Number(returned.n) > 0) reasons.push('A return has already been processed against it.');
  if (ageDays > windowDays) reasons.push(`It is ${Math.floor(ageDays)} days old; the limit is ${windowDays} days.`);

  res.json({
    editable: reasons.length === 0,
    reasons,
    window_days: windowDays,
    days_remaining: Math.max(0, Math.ceil(windowDays - ageDays)),
    edit_count: Number(sale.edit_count || 0),
  });
}));

r.get('/:id/revisions', h(async (req, res) => {
  const rows = await manyRows(
    `SELECT id, revision, reason, before_json, after_json, user_name, created_at
       FROM sale_revisions WHERE sale_id=$1 ORDER BY revision DESC`, [req.params.id]);
  res.json(rows);
}));

/* ------------------------------------------------------------------ */
r.post('/', requirePerm('sales.create'), h(async (req, res) => {
  const settings = await getSettings();
  if (req.body.client_uuid) {
    const dupe = await one('SELECT * FROM sales WHERE client_uuid=$1', [str(req.body.client_uuid)]);
    if (dupe) return res.status(200).json(await loadSale(dupe.id));
  }
  const sale = await tx((c) =>
    createSale(c, req.body, { user: req.user, locationId: req.locationId, settings }));
  await audit(req, 'create', 'sale', sale.id, {
    invoice: sale.invoice_no, total: sale.total, status: sale.status });

  // Phase 4: if the shop turned on auto notifications and the sale has a
  // contactable customer, queue a receipt message. Best-effort — a queue
  // failure never fails the sale.
  if (sale.status === 'completed' && sale.customer_id) {
    try {
      const ns = await one('SELECT * FROM notification_settings WHERE id=1');
      if (ns?.auto_on_sale) {
        const channel = ns.whatsapp_enabled ? 'whatsapp' : ns.sms_enabled ? 'sms' : ns.email_enabled ? 'email' : null;
        if (channel) await queueSaleNotification({ saleId: sale.id, key: 'sale_complete', channel, userId: req.user.id, req });
      }
    } catch (e) { console.error('[notify] auto sale notification failed', sale.id, e.message); }
  }

  res.status(201).json(await loadSale(sale.id));
}));

/* ---------------- read ---------------- */
export async function loadSale(id) {
  const sale = await one(
    `SELECT s.*, l.name AS location_name, l.code AS location_code, l.address AS location_address,
            l.phone AS location_phone, u.name AS cashier_name,
            c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
            c.address AS customer_address
       FROM sales s
       JOIN locations l ON l.id=s.location_id
       LEFT JOIN users u ON u.id=s.user_id
       LEFT JOIN customers c ON c.id=s.customer_id
      WHERE s.id=$1`, [id]);
  if (!sale) return null;
  sale.items = await many(
    `SELECT si.*, COALESCE(json_agg(json_build_object('id',su.id,'epc',su.epc,'readable',su.epc_readable))
              FILTER (WHERE su.id IS NOT NULL), '[]') AS units
       FROM sale_items si
       LEFT JOIN sale_item_units siu ON siu.sale_item_id=si.id
       LEFT JOIN stock_units su ON su.id=siu.unit_id
      WHERE si.sale_id=$1 GROUP BY si.id ORDER BY si.id`, [id]);
  sale.payments = await many('SELECT * FROM payments WHERE sale_id=$1 ORDER BY id', [id]);
  sale.returns = await many(
    `SELECT sr.*, u.name AS user_name FROM sale_returns sr
       LEFT JOIN users u ON u.id=sr.user_id WHERE sr.original_sale_id=$1 ORDER BY sr.id`, [id]);
  return sale;
}

r.get('/', h(async (req, res) => {
  const { limit, offset, page } = paging(req, 30);
  const params = [];
  const where = ['TRUE'];
  const add = (sql, v) => { params.push(v); where.push(sql.replace(/\?/g, `$${params.length}`)); };
  if (req.query.location_id !== 'all') add('s.location_id = ?', int(req.query.location_id, req.locationId));
  if (req.query.status) add('s.status = ?', str(req.query.status));
  if (req.query.sale_type) add('s.sale_type = ?', str(req.query.sale_type));
  if (req.query.customer_id) add('s.customer_id = ?', int(req.query.customer_id));
  if (req.query.user_id) add('s.user_id = ?', int(req.query.user_id));
  if (req.query.from) add('s.created_at >= ?::timestamptz', req.query.from);
  if (req.query.to) add('s.created_at < (?::date + interval \'1 day\')', req.query.to);
  if (req.query.q) add('(s.invoice_no ILIKE ? OR c.name ILIKE ? OR c.phone ILIKE ?)', `%${req.query.q}%`);
  if (req.query.credit === 'true') where.push('s.balance_due > 0');

  const rows = await many(
    `SELECT s.id, s.invoice_no, s.status, s.sale_type, s.total, s.amount_paid, s.balance_due,
            s.tax_amount, s.discount_amount, s.created_at, s.hold_label, s.cost_total,
            l.name AS location_name, u.name AS cashier_name, c.name AS customer_name,
            (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id=s.id) AS item_count
       FROM sales s
       JOIN locations l ON l.id=s.location_id
       LEFT JOIN users u ON u.id=s.user_id
       LEFT JOIN customers c ON c.id=s.customer_id
      WHERE ${where.join(' AND ')}
      ORDER BY s.created_at DESC, s.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  const totals = await one(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(s.total),0) AS sum_total,
            COALESCE(SUM(s.tax_amount),0) AS sum_tax
       FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
      WHERE ${where.join(' AND ')}`, params);
  res.json({ data: rows, page, limit, total: totals.n, sum_total: totals.sum_total, sum_tax: totals.sum_tax });
}));

r.get('/held', h(async (req, res) => {
  const rows = await many(
    `SELECT s.*, u.name AS cashier_name, c.name AS customer_name,
            (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id=s.id) AS item_count
       FROM sales s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN customers c ON c.id=s.customer_id
      WHERE s.status='held' AND s.location_id=$1 ORDER BY s.created_at DESC`, [req.locationId]);
  res.json(rows);
}));

r.get('/:id', h(async (req, res) => {
  const sale = await loadSale(req.params.id);
  if (!sale) throw notFound('Sale not found');
  sale.settings = await getSettings();
  res.json(sale);
}));

/* ---------------- resume / delete a held sale ---------------- */
r.post('/:id/resume', requirePerm('sales.create'), h(async (req, res) => {
  const sale = await loadSale(req.params.id);
  if (!sale) throw notFound('Sale not found');
  if (!['held', 'draft', 'quotation'].includes(sale.status)) throw bad('Only held sales, drafts and quotations can be resumed');
  res.json(sale);
}));

r.delete('/:id', requirePerm('sales.create'), h(async (req, res) => {
  const sale = await one('SELECT * FROM sales WHERE id=$1', [req.params.id]);
  if (!sale) throw notFound('Sale not found');
  if (!['held', 'draft', 'quotation'].includes(sale.status))
    throw bad('Completed sales cannot be deleted — process a return instead');
  await query('DELETE FROM sales WHERE id=$1', [sale.id]);
  await audit(req, 'delete', 'sale', sale.id, { status: sale.status });
  res.json({ ok: true });
}));

/* ---------------- take a payment against a credit/layaway sale ---------------- */
r.post('/:id/payments', requirePerm('sales.create'), h(async (req, res) => {
  const amount = money(num(req.body.amount, 0));
  if (amount <= 0) throw bad('Enter an amount greater than zero');
  const out = await tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM sales WHERE id=$1 FOR UPDATE', [req.params.id]);
    const sale = rows[0];
    if (!sale) throw notFound('Sale not found');
    if (Number(sale.balance_due) <= 0) throw bad('That sale is already fully paid');
    const applied = Math.min(amount, Number(sale.balance_due));

    const method = str(req.body.method, 'cash');
    const accountId = await resolveAccountId(c, method, req.body.account_id);
    await c.query(
      `INSERT INTO payments (sale_id, method, amount, reference, user_id, account_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [sale.id, method, applied, str(req.body.reference) || null, req.user.id, accountId]);
    const { rows: upd } = await c.query(
      `UPDATE sales SET amount_paid = amount_paid + $2, balance_due = balance_due - $2,
              is_credit = (balance_due - $2) > 0, updated_at=now()
        WHERE id=$1 RETURNING *`, [sale.id, applied]);
    if (sale.customer_id) {
      await c.query('UPDATE customers SET balance = GREATEST(0, balance - $2) WHERE id=$1',
        [sale.customer_id, applied]);
    }
    // A layaway that is now fully paid releases its reserved units.
    if (sale.sale_type === 'layaway' && Number(upd[0].balance_due) <= 0) {
      const { rows: units } = await c.query(
        `SELECT siu.unit_id FROM sale_item_units siu
           JOIN sale_items si ON si.id=siu.sale_item_id WHERE si.sale_id=$1`, [sale.id]);
      await c.query(
        `UPDATE stock_units SET status='sold', sold_at=now(), sale_id=$2 WHERE id = ANY($1::bigint[])`,
        [units.map((u) => u.unit_id), sale.id]);
      await c.query("UPDATE sales SET status='completed' WHERE id=$1", [sale.id]);
    }
    return upd[0];
  });
  await audit(req, 'payment', 'sale', req.params.id, { amount });
  res.json(await loadSale(req.params.id));
}));

/* ---------------- receipt payload (screen / print / email) ---------------- */
r.get('/:id/receipt', h(async (req, res) => {
  const sale = await loadSale(req.params.id);
  if (!sale) throw notFound('Sale not found');
  const settings = await getSettings();
  const gift = req.query.gift === 'true';
  res.json({
    business: {
      name: settings.name, legal_name: settings.legal_name, tin: settings.tin,
      rc_number: settings.rc_number, address: settings.address, phone: settings.phone,
      email: settings.email, footer: settings.receipt_footer,
      currency_symbol: settings.currency_symbol, vat_rate: settings.vat_rate,
      prices_include_vat: settings.prices_include_vat,
      logo_url: settings.receipt_show_logo ? settings.logo_url : '',
      logo_width_mm: settings.logo_width_mm,
      font_size: settings.receipt_font_size,
      paper: settings.receipt_paper,
    },
    sale: gift
      ? {
          ...sale,
          subtotal: null, total: null, tax_amount: null, discount_amount: null,
          amount_paid: null, change_due: null, balance_due: null,
          payments: [],
          items: sale.items.map((i) => ({ ...i, unit_price: null, line_total: null, tax_amount: null, discount_amount: null })),
        }
      : sale,
    gift,
    // Structured shape that a future FIRS e-invoice (UBL) mapping reads from.
    einvoice: {
      scheme: settings.einvoice_scheme,
      supplier: { name: settings.legal_name || settings.name, tin: settings.tin, address: settings.address },
      customer: sale.customer_name
        ? { name: sale.customer_name, phone: sale.customer_phone, address: sale.customer_address }
        : null,
      document: {
        id: sale.invoice_no, sequence: sale.invoice_seq, issue_date: sale.created_at,
        currency: settings.currency, type_code: '380',
      },
      lines: sale.items.map((i, idx) => ({
        id: idx + 1, sku: i.sku, name: i.product_name, variant: i.variant_label,
        quantity: Number(i.quantity), unit_price: Number(i.unit_price),
        line_extension_amount: Number(i.line_total) - Number(i.tax_amount),
        tax_percent: Number(i.tax_rate), tax_amount: Number(i.tax_amount),
      })),
      tax_total: Number(sale.tax_amount),
      payable_amount: Number(sale.total),
    },
  });
}));

export default r;
