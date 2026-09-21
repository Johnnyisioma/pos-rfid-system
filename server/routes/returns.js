import { Router } from 'express';
import { many, one, tx } from '../db/index.js';
import { h, bad, notFound, str, num, int, bool, paging, nextRef, money, getSettings } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { clawbackForReturn } from '../services/commission.js';
import { postSalesReturn } from '../services/autopost.js';
import { moveStock, receiveUnits } from '../services/inventory.js';
import { createSale, loadSale } from './sales.js';
import { resolveAccountId } from '../services/accounts.js';

const r = Router();

/**
 * Returns, refunds and exchanges.
 * - With a receipt: lines are matched to the original sale items.
 * - Without a receipt: `variant_id` lines are accepted and refunded as store credit
 *   (configurable per request) at the current selling price.
 */
r.post('/', requirePerm('returns.create'), h(async (req, res) => {
  const settings = await getSettings();
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw bad('Select at least one item to return');
  const type = req.body.type === 'exchange' ? 'exchange' : 'refund';
  const refundMethod = str(req.body.refund_method, 'cash');
  const reason = str(req.body.reason).trim();
  if (!reason) throw bad('A reason is required for every return');

  const out = await tx(async (c) => {
    const ref = await nextRef(c, 'sale_returns', 'RET');
    const originalId = int(req.body.original_sale_id) || null;
    let original = null;
    if (originalId) {
      const { rows } = await c.query('SELECT * FROM sales WHERE id=$1 FOR UPDATE', [originalId]);
      original = rows[0];
      if (!original) throw notFound('Original sale not found');
    }
    const customerId = int(req.body.customer_id) || original?.customer_id || null;

    const { rows: retRows } = await c.query(
      `INSERT INTO sale_returns (ref, original_sale_id, location_id, customer_id, user_id, type, refund_method, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [ref, originalId, req.locationId, customerId, req.user.id, type, refundMethod, reason]);
    const ret = retRows[0];

    let totalRefund = 0;

    for (const it of items) {
      const qty = num(it.quantity, 1);
      if (qty <= 0) continue;
      const restock = it.restock === undefined ? true : bool(it.restock);
      let variantId = int(it.variant_id) || null;
      let unitPrice = num(it.unit_price, 0);
      let saleItemId = int(it.sale_item_id) || null;
      let taxRate = num(it.tax_rate, Number(settings.vat_rate));

      if (saleItemId) {
        const { rows } = await c.query('SELECT * FROM sale_items WHERE id=$1 AND sale_id=$2 FOR UPDATE',
          [saleItemId, originalId]);
        const si = rows[0];
        if (!si) throw bad('That line is not part of the original sale');
        const remaining = Number(si.quantity) - Number(si.returned_quantity);
        if (qty > remaining + 0.001)
          throw bad(`Only ${remaining} of ${si.product_name} remain returnable on that receipt`);
        variantId = si.variant_id;
        taxRate = Number(si.tax_rate);
        // refund the amount actually paid for that line, discounts included
        unitPrice = Number(si.line_total) / Number(si.quantity);
        await c.query('UPDATE sale_items SET returned_quantity = returned_quantity + $2 WHERE id=$1',
          [saleItemId, qty]);
      } else {
        if (!variantId) throw bad('Returns without a receipt need a product');
        if (!unitPrice) {
          const { rows } = await c.query(
            `SELECT COALESCE(lp.selling_price, v.selling_price) AS price, p.tax_rate
               FROM product_variants v JOIN products p ON p.id=v.product_id
               LEFT JOIN location_prices lp ON lp.variant_id=v.id AND lp.location_id=$2
              WHERE v.id=$1`, [variantId, req.locationId]);
          if (!rows.length) throw bad('Product not found');
          unitPrice = Number(rows[0].price);
          taxRate = Number(rows[0].tax_rate);
        }
      }

      const refundAmount = money(unitPrice * qty);
      totalRefund = money(totalRefund + refundAmount);

      // put the physical unit(s) back
      let unitId = null;
      if (restock) {
        const scannedUnitIds = (Array.isArray(it.unit_ids) ? it.unit_ids : []).map(Number).filter(Boolean);
        let restocked = 0;
        if (scannedUnitIds.length) {
          const { rows } = await c.query(
            `UPDATE stock_units SET status='in_stock', location_id=$2, sale_id=NULL, sold_at=NULL, last_seen_at=now()
              WHERE id = ANY($1::bigint[]) RETURNING id`, [scannedUnitIds, req.locationId]);
          restocked = rows.length;
          unitId = rows[0]?.id || null;
        } else if (saleItemId) {
          const { rows } = await c.query(
            `UPDATE stock_units SET status='in_stock', location_id=$3, sale_id=NULL, sold_at=NULL, last_seen_at=now()
              WHERE id IN (SELECT unit_id FROM sale_item_units WHERE sale_item_id=$1
                           AND unit_id IN (SELECT id FROM stock_units WHERE status='sold') LIMIT $2)
              RETURNING id`, [saleItemId, Math.round(qty), req.locationId]);
          restocked = rows.length;
          unitId = rows[0]?.id || null;
        }
        // No tagged unit to revive (no-receipt return) — mint fresh units so the
        // item is trackable again.
        if (restocked < Math.round(qty)) {
          const missing = Math.round(qty) - restocked;
          const fresh = await receiveUnits(c, {
            variantId, locationId: req.locationId, quantity: missing,
            costPrice: 0, companyPrefix: settings.epc_company_prefix,
            referenceType: 'return', referenceId: ret.id, sourceRef: ref,
            userId: req.user.id, type: 'return', reason: `Return ${ref}`,
          });
          unitId = unitId || fresh[0]?.id || null;
          if (restocked > 0) {
            await moveStock(c, { variantId, locationId: req.locationId, delta: restocked,
              type: 'return', referenceType: 'return', referenceId: ret.id, reason, userId: req.user.id });
          }
        } else {
          await moveStock(c, { variantId, locationId: req.locationId, delta: qty,
            type: 'return', referenceType: 'return', referenceId: ret.id, reason, userId: req.user.id });
        }
      }

      await c.query(
        `INSERT INTO sale_return_items (return_id, sale_item_id, variant_id, quantity, unit_price, refund_amount, restock, unit_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [ret.id, saleItemId, variantId, qty, unitPrice, refundAmount, restock, unitId]);
    }

    // ---- settle the money ----
    let exchangeSale = null;
    let netDue = 0;
    if (type === 'exchange' && Array.isArray(req.body.exchange_items) && req.body.exchange_items.length) {
      exchangeSale = await createSale(c, {
        ...req.body.exchange_sale,
        items: req.body.exchange_items,
        customer_id: customerId,
        payments: req.body.exchange_payments || [],
        status: 'completed',
        allow_oversell: false,
        note: `Exchange against ${ref}`,
        allow_short: true,
      }, { user: req.user, locationId: req.locationId, settings });
      netDue = money(Number(exchangeSale.total) - totalRefund);
      await c.query('UPDATE sale_returns SET exchange_sale_id=$2 WHERE id=$1', [ret.id, exchangeSale.id]);
    }

    const creditBack = type === 'exchange' ? Math.max(0, -netDue) : totalRefund;

    if (creditBack > 0) {
      if (refundMethod === 'store_credit') {
        if (!customerId) throw bad('Store credit refunds need a customer on file');
        await c.query('UPDATE customers SET store_credit = store_credit + $2 WHERE id=$1', [customerId, creditBack]);
        await c.query(
          `INSERT INTO store_credit_ledger (customer_id, amount, type, reference, user_id)
           VALUES ($1,$2,'refund',$3,$4)`, [customerId, creditBack, ref, req.user.id]);
      } else if (refundMethod === 'account_credit' && customerId) {
        await c.query('UPDATE customers SET balance = GREATEST(0, balance - $2) WHERE id=$1', [customerId, creditBack]);
      } else if (originalId) {
        const method = refundMethod === 'cash' ? 'cash' : refundMethod;
        const accountId = await resolveAccountId(c, method, req.body.account_id);
        await c.query(
          `INSERT INTO payments (sale_id, method, amount, reference, user_id, account_id)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [originalId, method, -creditBack, ref, req.user.id, accountId]);
      }
    }

    await c.query('UPDATE sale_returns SET total_refund=$2 WHERE id=$1', [ret.id, totalRefund]);

    // reverse loyalty points proportionally
    if (original && customerId && Number(original.points_earned) > 0 && Number(original.total) > 0) {
      const back = Math.floor((Number(original.points_earned) * totalRefund) / Number(original.total));
      if (back > 0) {
        await c.query('UPDATE customers SET loyalty_points = GREATEST(0, loyalty_points - $2) WHERE id=$1',
          [customerId, back]);
        await c.query(`INSERT INTO loyalty_ledger (customer_id, points, type, sale_id) VALUES ($1,$2,'return',$3)`,
          [customerId, -back, original.id]);
      }
    }

    if (original) {
      const { rows: remaining } = await c.query(
        `SELECT COALESCE(SUM(quantity - returned_quantity),0) AS left_qty FROM sale_items WHERE sale_id=$1`,
        [original.id]);
      const fully = Number(remaining[0].left_qty) <= 0.001;
      await c.query('UPDATE sales SET status=$2, updated_at=now() WHERE id=$1',
        [original.id, fully ? 'refunded' : 'partially_refunded']);

      /*
        Commission clawback.

        This is the half every commission scheme forgets. The rep is paid on
        the sale; the customer brings the shoes back three weeks later; unless
        something writes the negative row here, that money is gone and nobody
        notices until the year-end.
      */
      try {
        await clawbackForReturn(c, {
          returnId: ret.id, saleId: original.id, refundAmount: totalRefund });
      } catch (e) {
        console.error('[commission] clawback failed for return', ret.id, e.message);
      }
    }

    // Book the refund to the ledger (Dr Sales returns, Cr Cash).
    try {
      await postSalesReturn(c, ret.id, totalRefund,
        { locationId: ret.location_id, userId: req.user.id, ref: ret.ref });
    } catch (e) { console.error('[ledger] return posting failed', ret.id, e.message); }

    return { ret, totalRefund, exchangeSale, netDue };
  });

  await audit(req, 'create', 'return', out.ret.id, {
    ref: out.ret.ref, type, refund: out.totalRefund, reason });
  res.status(201).json({
    ok: true, ref: out.ret.ref, return_id: out.ret.id,
    total_refund: out.totalRefund,
    exchange_sale: out.exchangeSale ? await loadSale(out.exchangeSale.id) : null,
    net_due: out.netDue,
  });
}));

r.get('/', h(async (req, res) => {
  const { limit, offset, page } = paging(req, 30);
  const rows = await many(
    `SELECT sr.*, l.name AS location_name, u.name AS user_name, c.name AS customer_name,
            s.invoice_no AS original_invoice,
            (SELECT COUNT(*) FROM sale_return_items i WHERE i.return_id=sr.id) AS line_count
       FROM sale_returns sr
       JOIN locations l ON l.id=sr.location_id
       LEFT JOIN users u ON u.id=sr.user_id
       LEFT JOIN customers c ON c.id=sr.customer_id
       LEFT JOIN sales s ON s.id=sr.original_sale_id
      WHERE ($1::int IS NULL OR sr.location_id=$1)
      ORDER BY sr.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [req.query.location_id === 'all' ? null : int(req.query.location_id, req.locationId)]);
  res.json({ data: rows, page, limit });
}));

r.get('/:id', h(async (req, res) => {
  const ret = await one(
    `SELECT sr.*, l.name AS location_name, u.name AS user_name, c.name AS customer_name,
            s.invoice_no AS original_invoice
       FROM sale_returns sr JOIN locations l ON l.id=sr.location_id
       LEFT JOIN users u ON u.id=sr.user_id LEFT JOIN customers c ON c.id=sr.customer_id
       LEFT JOIN sales s ON s.id=sr.original_sale_id WHERE sr.id=$1`, [req.params.id]);
  if (!ret) throw notFound('Return not found');
  ret.items = await many(
    `SELECT ri.*, p.name AS product_name, v.sku, v.size, v.color, su.epc, su.epc_readable
       FROM sale_return_items ri
       LEFT JOIN product_variants v ON v.id=ri.variant_id
       LEFT JOIN products p ON p.id=v.product_id
       LEFT JOIN stock_units su ON su.id=ri.unit_id
      WHERE ri.return_id=$1`, [req.params.id]);
  res.json(ret);
}));

/** Look up a receipt for the returns screen. */
r.get('/lookup/:invoice', h(async (req, res) => {
  const sale = await one('SELECT id FROM sales WHERE invoice_no ILIKE $1', [str(req.params.invoice).trim()]);
  if (!sale) throw notFound('No sale found with that invoice number');
  res.json(await loadSale(sale.id));
}));

export default r;
