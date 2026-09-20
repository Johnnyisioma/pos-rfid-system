import { Router } from 'express';
import XLSX from 'xlsx';
import { many, one } from '../db/index.js';
import { h, str, int, num } from '../lib/util.js';

const r = Router();

/** Resolve the location filter: a specific id, or null for "all locations". */
function loc(req) {
  if (req.query.location_id === 'all') return null;
  return int(req.query.location_id, req.locationId) || null;
}
function range(req) {
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const from = req.query.from ||
    new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

const SALE_STATUSES = "('completed','partially_refunded','refunded')";

/* ---------------- dashboard ---------------- */
r.get('/dashboard', h(async (req, res) => {
  const locationId = loc(req);
  const p = [locationId];

  const period = async (interval) => one(
    `SELECT COUNT(*)::int AS orders, COALESCE(SUM(total),0) AS revenue,
            COALESCE(SUM(tax_amount),0) AS tax, COALESCE(SUM(cost_total),0) AS cost,
            COALESCE(SUM(total - tax_amount - cost_total),0) AS gross_profit,
            COALESCE(AVG(total),0) AS average_order
       FROM sales
      WHERE status IN ${SALE_STATUSES}
        AND ($1::int IS NULL OR location_id=$1)
        AND created_at >= date_trunc('${interval}', now())`, p);

  const [today, week, month, year] = await Promise.all([
    period('day'), period('week'), period('month'), period('year'),
  ]);

  const trend = await many(
    `SELECT to_char(d.day,'YYYY-MM-DD') AS date,
            COALESCE(s.orders,0)::int AS orders,
            COALESCE(s.revenue,0) AS revenue,
            COALESCE(s.profit,0) AS profit
       FROM generate_series(current_date - interval '29 days', current_date, interval '1 day') d(day)
       LEFT JOIN (
         SELECT date_trunc('day', created_at) AS day, COUNT(*) AS orders,
                SUM(total) AS revenue, SUM(total - tax_amount - cost_total) AS profit
           FROM sales WHERE status IN ${SALE_STATUSES} AND ($1::int IS NULL OR location_id=$1)
            AND created_at >= current_date - interval '29 days'
          GROUP BY 1
       ) s ON s.day = d.day
      ORDER BY d.day`, p);

  const byLocation = await many(
    `SELECT l.id, l.name, COUNT(s.id)::int AS orders, COALESCE(SUM(s.total),0) AS revenue,
            COALESCE(SUM(s.total - s.tax_amount - s.cost_total),0) AS profit
       FROM locations l
       LEFT JOIN sales s ON s.location_id=l.id AND s.status IN ${SALE_STATUSES}
            AND s.created_at >= date_trunc('month', now())
      WHERE l.is_active GROUP BY l.id, l.name ORDER BY revenue DESC`);

  const byStaff = await many(
    `SELECT u.id, u.name, u.role, COUNT(s.id)::int AS orders, COALESCE(SUM(s.total),0) AS revenue
       FROM users u
       JOIN sales s ON s.user_id=u.id AND s.status IN ${SALE_STATUSES}
            AND s.created_at >= date_trunc('month', now())
            AND ($1::int IS NULL OR s.location_id=$1)
      GROUP BY u.id, u.name, u.role ORDER BY revenue DESC LIMIT 10`, p);

  const byPayment = await many(
    `SELECT pm.method, COALESCE(SUM(pm.amount),0) AS amount, COUNT(*)::int AS count
       FROM payments pm JOIN sales s ON s.id=pm.sale_id
      WHERE s.status IN ${SALE_STATUSES} AND ($1::int IS NULL OR s.location_id=$1)
        AND s.created_at >= date_trunc('month', now())
      GROUP BY pm.method ORDER BY amount DESC`, p);

  const topProducts = await many(
    `SELECT si.product_name, si.variant_label, si.sku,
            SUM(si.quantity) AS qty, SUM(si.line_total) AS revenue
       FROM sale_items si JOIN sales s ON s.id=si.sale_id
      WHERE s.status IN ${SALE_STATUSES} AND ($1::int IS NULL OR s.location_id=$1)
        AND s.created_at >= date_trunc('month', now())
      GROUP BY 1,2,3 ORDER BY qty DESC LIMIT 8`, p);

  const inventory = await one(
    `SELECT COALESCE(SUM(i.quantity),0) AS units,
            COALESCE(SUM(i.quantity * v.cost_price),0) AS cost_value,
            COALESCE(SUM(i.quantity * v.selling_price),0) AS retail_value
       FROM inventory i JOIN product_variants v ON v.id=i.variant_id
      WHERE i.quantity > 0 AND ($1::int IS NULL OR i.location_id=$1)`, p);

  const lowStock = await one(
    `SELECT COUNT(*)::int AS n FROM inventory i
       JOIN product_variants v ON v.id=i.variant_id JOIN products p ON p.id=v.product_id
      WHERE p.is_active AND v.is_active AND ($1::int IS NULL OR i.location_id=$1)
        AND i.quantity <= COALESCE(i.reorder_point, v.reorder_point, p.reorder_point, 0)`, p);

  const rfid = await one(
    `SELECT COUNT(*) FILTER (WHERE status='in_stock') AS tagged_in_stock,
            COUNT(*) FILTER (WHERE status='in_stock' AND NOT tag_encoded) AS awaiting_tag,
            COUNT(*) FILTER (WHERE status='in_transit') AS in_transit
       FROM stock_units WHERE ($1::int IS NULL OR location_id=$1)`, p);

  const openCredit = await one(
    `SELECT COALESCE(SUM(balance_due),0) AS amount, COUNT(*)::int AS invoices
       FROM sales WHERE balance_due > 0 AND ($1::int IS NULL OR location_id=$1)`, p);

  res.json({
    today, week, month, year, trend,
    by_location: byLocation, by_staff: byStaff, by_payment: byPayment,
    top_products: topProducts, inventory, low_stock_count: lowStock.n,
    rfid, open_credit: openCredit,
  });
}));

/* ---------------- sales report ---------------- */
r.get('/sales', h(async (req, res) => {
  const locationId = loc(req);
  const { from, to } = range(req);
  const groupBy = ['day', 'week', 'month', 'location', 'staff', 'category', 'payment'].includes(req.query.group_by)
    ? req.query.group_by : 'day';
  const p = [locationId, from, to];

  const base = `FROM sales s WHERE s.status IN ${SALE_STATUSES}
      AND ($1::int IS NULL OR s.location_id=$1)
      AND s.created_at >= $2::date AND s.created_at < ($3::date + interval '1 day')`;

  let rows;
  if (['day', 'week', 'month'].includes(groupBy)) {
    rows = await many(
      `SELECT to_char(date_trunc('${groupBy}', s.created_at),'YYYY-MM-DD') AS label,
              COUNT(*)::int AS orders, SUM(s.total) AS revenue, SUM(s.tax_amount) AS tax,
              SUM(s.discount_amount) AS discounts, SUM(s.cost_total) AS cost,
              SUM(s.total - s.tax_amount - s.cost_total) AS gross_profit
         ${base} GROUP BY 1 ORDER BY 1`, p);
  } else if (groupBy === 'location') {
    rows = await many(
      `SELECT l.name AS label, COUNT(*)::int AS orders, SUM(s.total) AS revenue,
              SUM(s.tax_amount) AS tax, SUM(s.discount_amount) AS discounts, SUM(s.cost_total) AS cost,
              SUM(s.total - s.tax_amount - s.cost_total) AS gross_profit
         FROM sales s JOIN locations l ON l.id=s.location_id
        WHERE s.status IN ${SALE_STATUSES} AND ($1::int IS NULL OR s.location_id=$1)
          AND s.created_at >= $2::date AND s.created_at < ($3::date + interval '1 day')
        GROUP BY 1 ORDER BY revenue DESC`, p);
  } else if (groupBy === 'staff') {
    rows = await many(
      `SELECT COALESCE(u.name,'Unknown') AS label, COUNT(*)::int AS orders, SUM(s.total) AS revenue,
              SUM(s.tax_amount) AS tax, SUM(s.discount_amount) AS discounts, SUM(s.cost_total) AS cost,
              SUM(s.total - s.tax_amount - s.cost_total) AS gross_profit
         FROM sales s LEFT JOIN users u ON u.id=s.user_id
        WHERE s.status IN ${SALE_STATUSES} AND ($1::int IS NULL OR s.location_id=$1)
          AND s.created_at >= $2::date AND s.created_at < ($3::date + interval '1 day')
        GROUP BY 1 ORDER BY revenue DESC`, p);
  } else if (groupBy === 'category') {
    rows = await many(
      `SELECT COALESCE(c.name,'Uncategorised') AS label, COUNT(DISTINCT s.id)::int AS orders,
              SUM(si.line_total) AS revenue, SUM(si.tax_amount) AS tax,
              SUM(si.discount_amount) AS discounts, SUM(si.cost_price*si.quantity) AS cost,
              SUM(si.line_total - si.tax_amount - si.cost_price*si.quantity) AS gross_profit
         FROM sale_items si JOIN sales s ON s.id=si.sale_id
         LEFT JOIN product_variants v ON v.id=si.variant_id
         LEFT JOIN products pr ON pr.id=v.product_id
         LEFT JOIN categories c ON c.id=pr.category_id
        WHERE s.status IN ${SALE_STATUSES} AND ($1::int IS NULL OR s.location_id=$1)
          AND s.created_at >= $2::date AND s.created_at < ($3::date + interval '1 day')
        GROUP BY 1 ORDER BY revenue DESC`, p);
  } else {
    rows = await many(
      `SELECT pm.method AS label, COUNT(*)::int AS orders, SUM(pm.amount) AS revenue,
              0 AS tax, 0 AS discounts, 0 AS cost, 0 AS gross_profit
         FROM payments pm JOIN sales s ON s.id=pm.sale_id
        WHERE s.status IN ${SALE_STATUSES} AND ($1::int IS NULL OR s.location_id=$1)
          AND s.created_at >= $2::date AND s.created_at < ($3::date + interval '1 day')
        GROUP BY 1 ORDER BY revenue DESC`, p);
  }

  const totals = await one(
    `SELECT COUNT(*)::int AS orders, COALESCE(SUM(s.total),0) AS revenue,
            COALESCE(SUM(s.tax_amount),0) AS tax, COALESCE(SUM(s.discount_amount),0) AS discounts,
            COALESCE(SUM(s.cost_total),0) AS cost,
            COALESCE(SUM(s.total - s.tax_amount - s.cost_total),0) AS gross_profit,
            COALESCE(AVG(s.total),0) AS average_order
       ${base}`, p);

  res.json({ from, to, group_by: groupBy, rows, totals });
}));

/* ---------------- product performance ---------------- */
r.get('/products', h(async (req, res) => {
  const locationId = loc(req);
  const { from, to } = range(req);
  const sort = req.query.sort === 'slow' ? 'ASC' : 'DESC';
  const rows = await many(
    `SELECT si.product_name, si.variant_label, si.sku, si.variant_id,
            SUM(si.quantity) AS qty_sold,
            SUM(si.line_total) AS revenue,
            SUM(si.cost_price * si.quantity) AS cost,
            SUM(si.line_total - si.tax_amount - si.cost_price*si.quantity) AS gross_profit,
            COUNT(DISTINCT si.sale_id)::int AS orders,
            COALESCE((SELECT SUM(i.quantity) FROM inventory i
                       WHERE i.variant_id=si.variant_id AND ($1::int IS NULL OR i.location_id=$1)),0) AS on_hand
       FROM sale_items si JOIN sales s ON s.id=si.sale_id
      WHERE s.status IN ${SALE_STATUSES} AND ($1::int IS NULL OR s.location_id=$1)
        AND s.created_at >= $2::date AND s.created_at < ($3::date + interval '1 day')
      GROUP BY 1,2,3,4 ORDER BY qty_sold ${sort} LIMIT 100`, [locationId, from, to]);

  // Stock that has not moved at all in the window — the real "slow movers".
  const noSales = await many(
    `SELECT p.name AS product_name, v.sku, v.size, v.color, v.id AS variant_id,
            COALESCE(SUM(i.quantity),0) AS on_hand,
            COALESCE(SUM(i.quantity * v.cost_price),0) AS tied_up_cost,
            (SELECT MAX(s2.created_at) FROM sale_items si2 JOIN sales s2 ON s2.id=si2.sale_id
              WHERE si2.variant_id=v.id) AS last_sold_at
       FROM product_variants v
       JOIN products p ON p.id=v.product_id
       LEFT JOIN inventory i ON i.variant_id=v.id AND ($1::int IS NULL OR i.location_id=$1)
      WHERE p.is_active AND v.is_active
        AND v.id NOT IN (
          SELECT si.variant_id FROM sale_items si JOIN sales s ON s.id=si.sale_id
           WHERE si.variant_id IS NOT NULL AND s.status IN ${SALE_STATUSES}
             AND s.created_at >= $2::date AND s.created_at < ($3::date + interval '1 day'))
      GROUP BY p.name, v.sku, v.size, v.color, v.id
     HAVING COALESCE(SUM(i.quantity),0) > 0
      ORDER BY tied_up_cost DESC LIMIT 100`, [locationId, from, to]);

  const bySize = await many(
    `SELECT COALESCE(v.size,'—') AS size, SUM(si.quantity) AS qty, SUM(si.line_total) AS revenue
       FROM sale_items si JOIN sales s ON s.id=si.sale_id
       JOIN product_variants v ON v.id=si.variant_id
      WHERE s.status IN ${SALE_STATUSES} AND ($1::int IS NULL OR s.location_id=$1)
        AND s.created_at >= $2::date AND s.created_at < ($3::date + interval '1 day')
      GROUP BY 1 ORDER BY qty DESC`, [locationId, from, to]);

  res.json({ from, to, rows, no_sales: noSales, by_size: bySize });
}));

/* ---------------- profit & loss ---------------- */
r.get('/profit-loss', h(async (req, res) => {
  const locationId = loc(req);
  const { from, to } = range(req);
  const p = [locationId, from, to];

  const sales = await one(
    `SELECT COALESCE(SUM(total),0) AS gross_sales, COALESCE(SUM(tax_amount),0) AS vat_collected,
            COALESCE(SUM(discount_amount),0) AS discounts, COALESCE(SUM(cost_total),0) AS cogs,
            COUNT(*)::int AS orders
       FROM sales WHERE status IN ${SALE_STATUSES} AND ($1::int IS NULL OR location_id=$1)
         AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')`, p);

  const refunds = await one(
    `SELECT COALESCE(SUM(total_refund),0) AS refunds, COUNT(*)::int AS count
       FROM sale_returns WHERE ($1::int IS NULL OR location_id=$1)
         AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')`, p);

  const expenses = await many(
    `SELECT COALESCE(ec.name,'Uncategorised') AS category, SUM(e.amount) AS amount
       FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id
      WHERE ($1::int IS NULL OR e.location_id=$1)
        AND e.expense_date >= $2::date AND e.expense_date <= $3::date
      GROUP BY 1 ORDER BY amount DESC`, p);

  const expenseTotal = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const netSales = Number(sales.gross_sales) - Number(refunds.refunds);
  const netExVat = netSales - Number(sales.vat_collected);
  const grossProfit = netExVat - Number(sales.cogs);

  const byDay = await many(
    `SELECT to_char(d.day,'YYYY-MM-DD') AS date,
            COALESCE(s.revenue,0) AS revenue, COALESCE(s.cogs,0) AS cogs,
            COALESCE(s.revenue,0) - COALESCE(s.tax,0) - COALESCE(s.cogs,0) AS gross_profit,
            COALESCE(e.expenses,0) AS expenses
       FROM generate_series($2::date, $3::date, interval '1 day') d(day)
       LEFT JOIN (SELECT date_trunc('day',created_at) AS day, SUM(total) AS revenue,
                         SUM(cost_total) AS cogs, SUM(tax_amount) AS tax
                    FROM sales WHERE status IN ${SALE_STATUSES} AND ($1::int IS NULL OR location_id=$1)
                   GROUP BY 1) s ON s.day=d.day
       LEFT JOIN (SELECT expense_date AS day, SUM(amount) AS expenses FROM expenses
                   WHERE ($1::int IS NULL OR location_id=$1) GROUP BY 1) e ON e.day=d.day
      ORDER BY d.day`, p);

  res.json({
    from, to,
    sales: { ...sales, refunds: Number(refunds.refunds), refund_count: refunds.count },
    net_sales: netSales,
    net_sales_excl_vat: netExVat,
    cogs: Number(sales.cogs),
    gross_profit: grossProfit,
    gross_margin_percent: netExVat > 0 ? Math.round((grossProfit / netExVat) * 1000) / 10 : 0,
    expenses, expense_total: expenseTotal,
    net_profit: grossProfit - expenseTotal,
    by_day: byDay,
  });
}));

/* ---------------- VAT / tax summary ---------------- */
r.get('/tax', h(async (req, res) => {
  const locationId = loc(req);
  const { from, to } = range(req);
  const rows = await many(
    `SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS period,
            COUNT(*)::int AS invoices,
            MIN(invoice_no) AS first_invoice, MAX(invoice_no) AS last_invoice,
            SUM(total) AS gross, SUM(tax_amount) AS vat, SUM(total - tax_amount) AS net
       FROM sales WHERE status IN ${SALE_STATUSES} AND ($1::int IS NULL OR location_id=$1)
         AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')
       GROUP BY 1 ORDER BY 1`, [locationId, from, to]);
  // Sequence integrity check — FIRS requires unbroken invoice numbering.
  const gaps = await one(
    `WITH seq AS (SELECT invoice_seq, LAG(invoice_seq) OVER (ORDER BY invoice_seq) AS prev
                    FROM sales WHERE invoice_seq IS NOT NULL)
     SELECT COUNT(*)::int AS gaps FROM seq WHERE prev IS NOT NULL AND invoice_seq <> prev + 1`);
  res.json({ from, to, rows, invoice_sequence_gaps: gaps.gaps });
}));


/* ---------------- top-bar feeds ---------------- */

/**
 * Today's profit for the top bar. Deliberately tiny — the full dashboard query
 * is far too heavy to sit behind a number that refreshes every few minutes.
 * Permission-gated at the UI so a cashier never sees it.
 */
r.get('/today', h(async (req, res) => {
  const locationId = loc(req);
  const row = await one(
    `SELECT COUNT(*)::int AS orders,
            COALESCE(SUM(total),0) AS revenue,
            COALESCE(SUM(total - tax_amount - cost_total),0) AS gross_profit
       FROM sales
      WHERE status IN ${SALE_STATUSES}
        AND ($1::int IS NULL OR location_id=$1)
        AND created_at >= date_trunc('day', now())`, [locationId]);
  res.json(row);
}));

/** What the notification bell shows: the two things that actually need action. */
r.get('/alerts', h(async (req, res) => {
  const locationId = loc(req);
  const lowStock = await many(
    `SELECT v.id AS variant_id, p.id AS product_id, p.name AS product_name,
            v.size, v.color, COALESCE(i.quantity,0) AS quantity,
            COALESCE(i.reorder_point, v.reorder_point, p.reorder_point, 0) AS reorder_point
       FROM inventory i
       JOIN product_variants v ON v.id=i.variant_id
       JOIN products p ON p.id=v.product_id
      WHERE p.is_active AND v.is_active
        AND ($1::int IS NULL OR i.location_id=$1)
        AND COALESCE(i.quantity,0) <= COALESCE(i.reorder_point, v.reorder_point, p.reorder_point, 0)
      ORDER BY COALESCE(i.quantity,0) ASC LIMIT 20`, [locationId]);

  const unpaid = await many(
    `SELECT s.id, s.invoice_no, s.balance_due, s.created_at,
            COALESCE(c.name,'Walk-in') AS customer,
            (CURRENT_DATE - s.created_at::date) AS age_days
       FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
      WHERE s.balance_due > 0 AND ($1::int IS NULL OR s.location_id=$1)
      ORDER BY age_days DESC LIMIT 20`, [locationId]);

  const tagsPending = await one(
    `SELECT COUNT(*)::int AS n FROM stock_units
      WHERE status='in_stock' AND NOT tag_encoded AND ($1::int IS NULL OR location_id=$1)`,
    [locationId]);

  res.json({
    low_stock: lowStock,
    unpaid,
    tags_pending: tagsPending.n,
    count: lowStock.length + unpaid.length + (tagsPending.n > 0 ? 1 : 0),
  });
}));

/* ---------------- C1 · aged receivables ---------------- */
r.get('/payment-by-age', h(async (req, res) => {
  const locationId = loc(req);
  const rows = await many(
    `SELECT s.id, s.invoice_no, s.created_at, s.total, s.amount_paid, s.balance_due,
            COALESCE(c.name,'Walk-in') AS customer, c.id AS customer_id, c.phone,
            l.name AS location_name,
            (CURRENT_DATE - s.created_at::date) AS age_days,
            CASE
              WHEN (CURRENT_DATE - s.created_at::date) <= 30 THEN 'current'
              WHEN (CURRENT_DATE - s.created_at::date) <= 60 THEN 'd31_60'
              WHEN (CURRENT_DATE - s.created_at::date) <= 90 THEN 'd61_90'
              ELSE 'over_90'
            END AS bucket
       FROM sales s
       LEFT JOIN customers c ON c.id=s.customer_id
       JOIN locations l ON l.id=s.location_id
      WHERE s.balance_due > 0 AND ($1::int IS NULL OR s.location_id=$1)
      ORDER BY (CURRENT_DATE - s.created_at::date) DESC`, [locationId]);

  const buckets = { current: 0, d31_60: 0, d61_90: 0, over_90: 0 };
  rows.forEach((x) => { buckets[x.bucket] += Number(x.balance_due); });

  const byCustomer = {};
  rows.forEach((x) => {
    const key = x.customer_id || 'walkin';
    byCustomer[key] ||= {
      customer_id: x.customer_id, customer: x.customer, phone: x.phone,
      current: 0, d31_60: 0, d61_90: 0, over_90: 0, total: 0, invoices: 0,
      oldest_days: 0,
    };
    const b = byCustomer[key];
    b[x.bucket] += Number(x.balance_due);
    b.total += Number(x.balance_due);
    b.invoices += 1;
    b.oldest_days = Math.max(b.oldest_days, Number(x.age_days));
  });

  res.json({
    buckets,
    total: Object.values(buckets).reduce((a, b) => a + b, 0),
    by_customer: Object.values(byCustomer).sort((a, b) => b.total - a.total),
    invoices: rows,
  });
}));

/* ---------------- C2 · supplier & customer ---------------- */
r.get('/contacts-balance', h(async (req, res) => {
  const receivables = await many(
    `SELECT c.id, c.name, c.phone, g.name AS group_name, c.balance, c.credit_limit,
            c.store_credit, c.loyalty_points,
            (SELECT COUNT(*) FROM sales s WHERE s.customer_id=c.id AND s.balance_due > 0) AS open_invoices,
            (SELECT COALESCE(SUM(total),0) FROM sales s WHERE s.customer_id=c.id) AS lifetime_value
       FROM customers c LEFT JOIN customer_groups g ON g.id=c.group_id
      WHERE c.balance > 0 OR c.store_credit > 0
      ORDER BY c.balance DESC`);
  const payables = await many(
    `SELECT s.id, s.name, s.phone, s.contact_person,
            COALESCE(SUM(po.total - po.amount_paid) FILTER (
              WHERE po.status IN ('ordered','partial','received')), 0) AS outstanding,
            COALESCE(SUM(po.total) FILTER (
              WHERE po.status IN ('ordered','partial','received')), 0) AS purchased,
            (SELECT COALESCE(SUM(pr.total),0) FROM purchase_returns pr WHERE pr.supplier_id=s.id) AS returned
       FROM suppliers s LEFT JOIN purchase_orders po ON po.supplier_id=s.id
      GROUP BY s.id ORDER BY outstanding DESC`);
  res.json({
    receivables,
    payables,
    total_receivable: receivables.reduce((a, b) => a + Number(b.balance), 0),
    total_payable: payables.reduce((a, b) => a + Number(b.outstanding), 0),
    total_store_credit: receivables.reduce((a, b) => a + Number(b.store_credit), 0),
  });
}));

/* ---------------- C3 · purchase vs sale ---------------- */
r.get('/purchase-sale', h(async (req, res) => {
  const locationId = loc(req);
  const { from, to } = range(req);
  const p = [locationId, from, to];

  const sales = await one(
    `SELECT COUNT(*)::int AS orders, COALESCE(SUM(total),0) AS gross,
            COALESCE(SUM(tax_amount),0) AS tax, COALESCE(SUM(cost_total),0) AS cost
       FROM sales WHERE status IN ${SALE_STATUSES} AND ($1::int IS NULL OR location_id=$1)
         AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')`, p);
  const sellReturns = await one(
    `SELECT COALESCE(SUM(total_refund),0) AS total, COUNT(*)::int AS count
       FROM sale_returns WHERE ($1::int IS NULL OR location_id=$1)
         AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')`, p);
  const purchases = await one(
    `SELECT COUNT(*)::int AS orders, COALESCE(SUM(total),0) AS total,
            COALESCE(SUM(amount_paid),0) AS paid
       FROM purchase_orders
      WHERE status IN ('ordered','partial','received') AND ($1::int IS NULL OR location_id=$1)
        AND order_date >= $2::date AND order_date <= $3::date`, p);
  const purchaseReturns = await one(
    `SELECT COALESCE(SUM(total),0) AS total, COUNT(*)::int AS count
       FROM purchase_returns WHERE ($1::int IS NULL OR location_id=$1)
         AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')`, p);

  const netSales = Number(sales.gross) - Number(sellReturns.total);
  const netPurchases = Number(purchases.total) - Number(purchaseReturns.total);
  const margin = netSales - Number(sales.tax) - Number(sales.cost);

  res.json({
    from, to,
    sales: { ...sales, returns: Number(sellReturns.total), return_count: sellReturns.count, net: netSales },
    purchases: { ...purchases, returns: Number(purchaseReturns.total),
      return_count: purchaseReturns.count, net: netPurchases },
    gross_margin: margin,
    margin_percent: netSales - Number(sales.tax) > 0
      ? Math.round((margin / (netSales - Number(sales.tax))) * 1000) / 10 : 0,
  });
}));

/* ---------------- C4 · money in and out ---------------- */
r.get('/payments', h(async (req, res) => {
  const locationId = loc(req);
  const { from, to } = range(req);
  const p = [locationId, from, to];

  const sellByMethod = await many(
    `SELECT pm.method, COUNT(*)::int AS count, COALESCE(SUM(pm.amount),0) AS amount
       FROM payments pm JOIN sales s ON s.id=pm.sale_id
      WHERE ($1::int IS NULL OR s.location_id=$1)
        AND pm.created_at >= $2::date AND pm.created_at < ($3::date + interval '1 day')
      GROUP BY pm.method ORDER BY amount DESC`, p);
  const sellByAccount = await many(
    `SELECT COALESCE(a.name,'Unassigned') AS account, a.type,
            COUNT(*)::int AS count, COALESCE(SUM(pm.amount),0) AS amount
       FROM payments pm
       JOIN sales s ON s.id=pm.sale_id
       LEFT JOIN payment_accounts a ON a.id=pm.account_id
      WHERE ($1::int IS NULL OR s.location_id=$1)
        AND pm.created_at >= $2::date AND pm.created_at < ($3::date + interval '1 day')
      GROUP BY 1,2 ORDER BY amount DESC`, p);
  const purchasePayments = await many(
    `SELECT COALESCE(s.name,'No supplier') AS supplier, COUNT(*)::int AS orders,
            COALESCE(SUM(po.amount_paid),0) AS paid,
            COALESCE(SUM(po.total - po.amount_paid),0) AS outstanding
       FROM purchase_orders po LEFT JOIN suppliers s ON s.id=po.supplier_id
      WHERE po.status IN ('ordered','partial','received') AND ($1::int IS NULL OR po.location_id=$1)
        AND po.order_date >= $2::date AND po.order_date <= $3::date
      GROUP BY 1 ORDER BY paid DESC`, p);
  const expenseByAccount = await many(
    `SELECT COALESCE(a.name,'Unassigned') AS account, COUNT(*)::int AS count,
            COALESCE(SUM(e.amount),0) AS amount
       FROM expenses e LEFT JOIN payment_accounts a ON a.id=e.account_id
      WHERE ($1::int IS NULL OR e.location_id=$1)
        AND e.expense_date >= $2::date AND e.expense_date <= $3::date
      GROUP BY 1 ORDER BY amount DESC`, p);

  res.json({
    from, to,
    sell_by_method: sellByMethod,
    sell_by_account: sellByAccount,
    purchase_payments: purchasePayments,
    expense_by_account: expenseByAccount,
    money_in: sellByMethod.reduce((a, b) => a + Number(b.amount), 0),
    money_out: expenseByAccount.reduce((a, b) => a + Number(b.amount), 0),
  });
}));

/* ---------------- C5 · Z report ---------------- */
r.get('/z-report', h(async (req, res) => {
  const locationId = loc(req);
  const sessionId = int(req.query.session_id) || null;
  const day = str(req.query.date) || new Date().toISOString().slice(0, 10);

  const scope = sessionId
    ? { where: 's.register_session_id = $1', params: [sessionId] }
    : { where: `($1::int IS NULL OR s.location_id=$1)
                AND s.created_at >= $2::date AND s.created_at < ($2::date + interval '1 day')`,
        params: [locationId, day] };

  const header = sessionId
    ? await one(
        `SELECT rs.*, rg.name AS register_name, l.name AS location_name, u.name AS user_name
           FROM register_sessions rs
           JOIN registers rg ON rg.id=rs.register_id
           JOIN locations l ON l.id=rs.location_id
           LEFT JOIN users u ON u.id=rs.user_id WHERE rs.id=$1`, [sessionId])
    : null;

  const totals = await one(
    `SELECT COUNT(*)::int AS transactions, COALESCE(SUM(s.total),0) AS gross,
            COALESCE(SUM(s.tax_amount),0) AS tax, COALESCE(SUM(s.discount_amount),0) AS discounts,
            COALESCE(SUM(s.cost_total),0) AS cost, COALESCE(SUM(s.change_due),0) AS change_given,
            COALESCE(AVG(s.total),0) AS average
       FROM sales s WHERE s.status IN ${SALE_STATUSES} AND ${scope.where}`, scope.params);

  const tenders = await many(
    `SELECT pm.method, COUNT(*)::int AS count, COALESCE(SUM(pm.amount),0) AS amount
       FROM payments pm JOIN sales s ON s.id=pm.sale_id
      WHERE s.status IN ${SALE_STATUSES} AND ${scope.where}
      GROUP BY pm.method ORDER BY amount DESC`, scope.params);

  const refunds = await one(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(sr.total_refund),0) AS amount
       FROM sale_returns sr JOIN sales s ON s.id=sr.original_sale_id
      WHERE ${scope.where}`, scope.params);

  const amendments = await one(
    `SELECT COUNT(*)::int AS count FROM sales s
      WHERE s.edit_count > 0 AND ${scope.where}`, scope.params);

  const byStaff = await many(
    `SELECT COALESCE(u.name,'Unknown') AS staff, COUNT(*)::int AS transactions,
            COALESCE(SUM(s.total),0) AS amount
       FROM sales s LEFT JOIN users u ON u.id=s.user_id
      WHERE s.status IN ${SALE_STATUSES} AND ${scope.where}
      GROUP BY 1 ORDER BY amount DESC`, scope.params);

  const cashIn = Number(tenders.find((t) => t.method === 'cash')?.amount || 0);
  const expected = header
    ? Number(header.opening_cash) + cashIn - Number(totals.change_given)
    : cashIn - Number(totals.change_given);

  res.json({
    scope: sessionId ? 'session' : 'day',
    date: day,
    session: header,
    totals,
    tenders,
    refunds,
    amendments: amendments.count,
    by_staff: byStaff,
    cash: {
      opening: header ? Number(header.opening_cash) : 0,
      taken: cashIn,
      change_given: Number(totals.change_given),
      expected,
      counted: header?.counted_cash == null ? null : Number(header.counted_cash),
      variance: header?.difference == null ? null : Number(header.difference),
    },
    net_sales: Number(totals.gross) - Number(refunds.amount),
  });
}));

/* ---------------- C6 · stock adjustments / shrinkage ---------------- */
r.get('/stock-adjustments', h(async (req, res) => {
  const locationId = loc(req);
  const { from, to } = range(req);
  const p = [locationId, from, to];

  const byReason = await many(
    `SELECT a.reason, COUNT(DISTINCT a.id)::int AS adjustments,
            COALESCE(SUM(i.quantity_change),0) AS net_units,
            COALESCE(SUM(CASE WHEN i.quantity_change < 0
                 THEN -i.quantity_change * v.cost_price ELSE 0 END),0) AS loss_value,
            COALESCE(SUM(CASE WHEN i.quantity_change > 0
                 THEN i.quantity_change * v.cost_price ELSE 0 END),0) AS gain_value
       FROM stock_adjustments a
       JOIN stock_adjustment_items i ON i.adjustment_id=a.id
       JOIN product_variants v ON v.id=i.variant_id
      WHERE ($1::int IS NULL OR a.location_id=$1)
        AND a.created_at >= $2::date AND a.created_at < ($3::date + interval '1 day')
      GROUP BY a.reason ORDER BY loss_value DESC`, p);

  const byUser = await many(
    `SELECT COALESCE(u.name,'System') AS authorised_by, COUNT(DISTINCT a.id)::int AS adjustments,
            COALESCE(SUM(CASE WHEN i.quantity_change < 0
                 THEN -i.quantity_change * v.cost_price ELSE 0 END),0) AS loss_value
       FROM stock_adjustments a
       JOIN stock_adjustment_items i ON i.adjustment_id=a.id
       JOIN product_variants v ON v.id=i.variant_id
       LEFT JOIN users u ON u.id=a.user_id
      WHERE ($1::int IS NULL OR a.location_id=$1)
        AND a.created_at >= $2::date AND a.created_at < ($3::date + interval '1 day')
      GROUP BY 1 ORDER BY loss_value DESC`, p);

  const byProduct = await many(
    `SELECT p.name AS product_name, v.sku, v.size, v.color,
            COALESCE(SUM(-i.quantity_change),0) AS units_lost,
            COALESCE(SUM(CASE WHEN i.quantity_change < 0
                 THEN -i.quantity_change * v.cost_price ELSE 0 END),0) AS loss_value
       FROM stock_adjustments a
       JOIN stock_adjustment_items i ON i.adjustment_id=a.id
       JOIN product_variants v ON v.id=i.variant_id
       JOIN products p ON p.id=v.product_id
      WHERE ($1::int IS NULL OR a.location_id=$1)
        AND i.quantity_change < 0
        AND a.created_at >= $2::date AND a.created_at < ($3::date + interval '1 day')
      GROUP BY 1,2,3,4 ORDER BY loss_value DESC LIMIT 50`, p);

  const trend = await many(
    `SELECT to_char(date_trunc('week', a.created_at),'YYYY-MM-DD') AS week,
            COALESCE(SUM(CASE WHEN i.quantity_change < 0
                 THEN -i.quantity_change * v.cost_price ELSE 0 END),0) AS loss_value
       FROM stock_adjustments a
       JOIN stock_adjustment_items i ON i.adjustment_id=a.id
       JOIN product_variants v ON v.id=i.variant_id
      WHERE ($1::int IS NULL OR a.location_id=$1)
        AND a.created_at >= $2::date AND a.created_at < ($3::date + interval '1 day')
      GROUP BY 1 ORDER BY 1`, p);

  res.json({
    from, to, by_reason: byReason, by_user: byUser, by_product: byProduct, trend,
    total_loss: byReason.reduce((a, b) => a + Number(b.loss_value), 0),
    total_gain: byReason.reduce((a, b) => a + Number(b.gain_value), 0),
  });
}));

/* ---------------- generic export ---------------- */
/**
 * Deadstock ageing.
 *
 * Not "what is not selling" — that is a sales report and every system has one.
 * This is "what money is sitting on the shelf, and for how long", which is the
 * question that decides whether to discount, transfer, or stop reordering.
 *
 * Age is measured from when each individual unit was received, which is only
 * possible because there is a row per unit: a variant restocked every month
 * would otherwise look young forever, while the three pairs from January sit
 * there unnoticed.
 */
r.get('/deadstock', h(async (req, res) => {
  const locationId = req.query.location_id === 'all'
    ? null : int(req.query.location_id, req.locationId);
  const minDays = Math.max(0, int(req.query.min_days, 60));

  const rows = await many(
    `SELECT p.id AS product_id, p.name AS product_name, v.id AS variant_id, v.sku,
            v.size, v.color, l.name AS location_name, l.id AS location_id,
            COUNT(*)::int                       AS units,
            COALESCE(SUM(d.cost_price),0)       AS tied_up,
            MIN(d.received_at)                  AS oldest_received,
            MAX(d.days_held)                    AS max_days,
            ROUND(AVG(d.days_held))::int        AS avg_days,
            MAX(d.last_seen_at)                 AS last_seen,
            (SELECT MAX(s.created_at) FROM sale_items si
               JOIN sales s ON s.id=si.sale_id
              WHERE si.variant_id = v.id
                AND s.status IN ('completed','partially_refunded')) AS last_sold_at
       FROM deadstock_units d
       JOIN product_variants v ON v.id=d.variant_id
       JOIN products p ON p.id=v.product_id
       LEFT JOIN locations l ON l.id=d.location_id
      WHERE d.days_held >= $1
        AND ($2::int IS NULL OR d.location_id = $2)
      GROUP BY p.id, p.name, v.id, v.sku, v.size, v.color, l.name, l.id
      ORDER BY tied_up DESC, max_days DESC
      LIMIT 500`, [minDays, locationId]);

  // Buckets, because "₦1.4m is older than six months" is the sentence that
  // makes somebody act, and a 500-row table is not.
  const buckets = [
    { key: '0-30',   label: 'Under a month', from: 0,   to: 30 },
    { key: '31-60',  label: '1–2 months',    from: 31,  to: 60 },
    { key: '61-90',  label: '2–3 months',    from: 61,  to: 90 },
    { key: '91-180', label: '3–6 months',    from: 91,  to: 180 },
    { key: '181-365', label: '6–12 months',  from: 181, to: 365 },
    { key: '365+',   label: 'Over a year',   from: 366, to: 100000 },
  ];
  const ageing = await many(
    `SELECT CASE
              WHEN d.days_held <= 30  THEN '0-30'
              WHEN d.days_held <= 60  THEN '31-60'
              WHEN d.days_held <= 90  THEN '61-90'
              WHEN d.days_held <= 180 THEN '91-180'
              WHEN d.days_held <= 365 THEN '181-365'
              ELSE '365+' END          AS bucket,
            COUNT(*)::int              AS units,
            COALESCE(SUM(d.cost_price),0) AS tied_up
       FROM deadstock_units d
      WHERE ($1::int IS NULL OR d.location_id = $1)
      GROUP BY bucket`, [locationId]);
  const byBucket = Object.fromEntries(ageing.map((a) => [a.bucket, a]));

  const totals = await one(
    `SELECT COUNT(*)::int AS units, COALESCE(SUM(cost_price),0) AS tied_up
       FROM deadstock_units WHERE ($1::int IS NULL OR location_id = $1)`, [locationId]);

  res.json({
    min_days: minDays,
    rows,
    totals,
    ageing: buckets.map((b) => ({
      ...b,
      units: byBucket[b.key]?.units || 0,
      tied_up: Number(byBucket[b.key]?.tied_up || 0),
    })),
  });
}));

r.get('/export/:report', h(async (req, res) => {
  const report = str(req.params.report);
  const format = str(req.query.format, 'xlsx');
  const locationId = loc(req);
  const { from, to } = range(req);
  let rows = [];
  let sheetName = 'Report';

  if (report === 'sales') {
    rows = await many(
      `SELECT s.invoice_no, to_char(s.created_at,'YYYY-MM-DD HH24:MI') AS date, l.name AS location,
              u.name AS cashier, COALESCE(c.name,'Walk-in') AS customer, s.status,
              s.subtotal, s.discount_amount, s.tax_amount, s.total, s.amount_paid, s.balance_due,
              s.cost_total, (s.total - s.tax_amount - s.cost_total) AS gross_profit
         FROM sales s JOIN locations l ON l.id=s.location_id
         LEFT JOIN users u ON u.id=s.user_id LEFT JOIN customers c ON c.id=s.customer_id
        WHERE s.status IN ${SALE_STATUSES} AND ($1::int IS NULL OR s.location_id=$1)
          AND s.created_at >= $2::date AND s.created_at < ($3::date + interval '1 day')
        ORDER BY s.created_at DESC`, [locationId, from, to]);
    sheetName = 'Sales';
  } else if (report === 'inventory') {
    rows = await many(
      `SELECT p.name AS product, v.sku, v.size, v.color, l.name AS location,
              i.quantity AS on_hand, COALESCE(i.reorder_point, v.reorder_point, p.reorder_point,0) AS reorder_point,
              v.cost_price, v.selling_price, (i.quantity*v.cost_price) AS stock_value_cost,
              (i.quantity*v.selling_price) AS stock_value_retail,
              (SELECT COUNT(*) FROM stock_units su WHERE su.variant_id=v.id AND su.location_id=l.id AND su.status='in_stock') AS tagged_units
         FROM inventory i JOIN product_variants v ON v.id=i.variant_id
         JOIN products p ON p.id=v.product_id JOIN locations l ON l.id=i.location_id
        WHERE ($1::int IS NULL OR i.location_id=$1) ORDER BY p.name, v.size`, [locationId]);
    sheetName = 'Inventory';
  } else if (report === 'low-stock') {
    rows = await many(
      `SELECT p.name AS product, v.sku, v.size, v.color, l.name AS location, i.quantity AS on_hand,
              COALESCE(i.reorder_point, v.reorder_point, p.reorder_point,0) AS reorder_point,
              GREATEST(1, COALESCE(i.reorder_point, v.reorder_point, p.reorder_point,0)*2 - i.quantity) AS suggested_order,
              v.cost_price
         FROM inventory i JOIN product_variants v ON v.id=i.variant_id
         JOIN products p ON p.id=v.product_id JOIN locations l ON l.id=i.location_id
        WHERE p.is_active AND v.is_active AND ($1::int IS NULL OR i.location_id=$1)
          AND i.quantity <= COALESCE(i.reorder_point, v.reorder_point, p.reorder_point,0)
        ORDER BY p.name`, [locationId]);
    sheetName = 'Low stock';
  } else if (report === 'units') {
    rows = await many(
      `SELECT su.epc, su.epc_readable, p.name AS product, v.sku, v.size, v.color,
              l.name AS location, su.status, su.tag_encoded,
              to_char(su.received_at,'YYYY-MM-DD') AS received,
              to_char(su.sold_at,'YYYY-MM-DD') AS sold, su.cost_price
         FROM stock_units su JOIN product_variants v ON v.id=su.variant_id
         JOIN products p ON p.id=v.product_id LEFT JOIN locations l ON l.id=su.location_id
        WHERE ($1::int IS NULL OR su.location_id=$1) ORDER BY su.id DESC LIMIT 20000`, [locationId]);
    sheetName = 'RFID units';
  } else if (report === 'expenses') {
    rows = await many(
      `SELECT e.ref, e.expense_date, COALESCE(ec.name,'Uncategorised') AS category,
              l.name AS location, e.amount, e.note, u.name AS recorded_by
         FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id
         JOIN locations l ON l.id=e.location_id LEFT JOIN users u ON u.id=e.user_id
        WHERE ($1::int IS NULL OR e.location_id=$1)
          AND e.expense_date >= $2::date AND e.expense_date <= $3::date
        ORDER BY e.expense_date DESC`, [locationId, from, to]);
    sheetName = 'Expenses';
  } else if (report === 'aged-receivables') {
    rows = await many(
      `SELECT s.invoice_no, COALESCE(c.name,'Walk-in') AS customer, c.phone,
              to_char(s.created_at,'YYYY-MM-DD') AS invoice_date,
              (CURRENT_DATE - s.created_at::date) AS days_outstanding,
              s.total, s.amount_paid, s.balance_due, l.name AS location
         FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
         JOIN locations l ON l.id=s.location_id
        WHERE s.balance_due > 0 AND ($1::int IS NULL OR s.location_id=$1)
        ORDER BY days_outstanding DESC`, [locationId]);
    sheetName = 'Aged receivables';
  } else if (report === 'purchase-returns') {
    rows = await many(
      `SELECT pr.ref, to_char(pr.created_at,'YYYY-MM-DD') AS date,
              COALESCE(s.name,'—') AS supplier, po.po_number, l.name AS location,
              pr.reason, pr.total, pr.credit_note, u.name AS recorded_by
         FROM purchase_returns pr
         LEFT JOIN suppliers s ON s.id=pr.supplier_id
         LEFT JOIN purchase_orders po ON po.id=pr.po_id
         JOIN locations l ON l.id=pr.location_id
         LEFT JOIN users u ON u.id=pr.user_id
        WHERE ($1::int IS NULL OR pr.location_id=$1)
          AND pr.created_at >= $2::date AND pr.created_at < ($3::date + interval '1 day')
        ORDER BY pr.created_at DESC`, [locationId, from, to]);
    sheetName = 'Purchase returns';
  } else if (report === 'customers') {
    rows = await many(
      `SELECT c.name, c.phone, c.email, g.name AS group_name, c.loyalty_points, c.store_credit,
              c.balance, c.credit_limit,
              (SELECT COUNT(*) FROM sales s WHERE s.customer_id=c.id AND s.status='completed') AS orders,
              (SELECT COALESCE(SUM(total),0) FROM sales s WHERE s.customer_id=c.id) AS lifetime_value
         FROM customers c LEFT JOIN customer_groups g ON g.id=c.group_id ORDER BY lifetime_value DESC`);
    sheetName = 'Customers';
  } else {
    return res.status(400).json({ error: `Unknown report "${report}"` });
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  const filename = `${report}-${from}-to-${to}`;
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(XLSX.utils.sheet_to_csv(ws));
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  res.send(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
}));

export default r;
