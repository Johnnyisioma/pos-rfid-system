/**
 * Commission accrual.
 *
 * Called from inside the sale and return transactions, so a commission row can
 * never exist for a sale that was rolled back, and a clawback can never be
 * missed because the return succeeded and a follow-up job did not.
 *
 * Rules are matched most-specific-first: a rule naming this person beats a
 * general one, and a rule naming this product beats one naming its category.
 * Only ONE rule pays per line — stacking them is how a 5% scheme quietly
 * becomes 17%.
 */
import { money } from '../lib/util.js';

const SCOPE_RANK = { product: 3, brand: 2, category: 1, all: 0 };

async function activeRules(client) {
  const { rows } = await client.query(
    'SELECT * FROM commission_rules WHERE is_active ORDER BY id');
  return rows;
}

/** The single best rule for one sold line, or null. */
function pickRule(rules, { userId, productId, categoryId, brandId }) {
  const candidates = rules.filter((r) => {
    if (r.user_id && Number(r.user_id) !== Number(userId)) return false;
    if (r.scope === 'product') return Number(r.scope_id) === Number(productId);
    if (r.scope === 'category') return Number(r.scope_id) === Number(categoryId);
    if (r.scope === 'brand') return Number(r.scope_id) === Number(brandId);
    return true;
  });
  if (!candidates.length) return null;
  // Most specific scope wins; among equals, a personal rule beats a general one.
  candidates.sort((a, b) => (SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope])
    || ((b.user_id ? 1 : 0) - (a.user_id ? 1 : 0))
    || (b.id - a.id));
  return candidates[0];
}

function amountFor(rule, { revenue, cost, quantity }) {
  if (rule.basis === 'unit') return money(Number(rule.rate) * Number(quantity));
  const base = rule.basis === 'profit' ? Number(revenue) - Number(cost) : Number(revenue);
  if (base <= 0) return 0;      // no commission on a loss-making line
  return money(base * (Number(rule.rate) / 100));
}

/**
 * Accrue commission for a completed sale.
 * Safe to call for every sale — it does nothing when there is no rep or no rule.
 */
export async function accrueForSale(client, { saleId, repId }) {
  if (!saleId || !repId) return { amount: 0, lines: 0 };

  const rules = await activeRules(client);
  if (!rules.length) return { amount: 0, lines: 0 };

  const { rows: lines } = await client.query(
    `SELECT si.id, si.quantity, si.line_total, si.cost_price, si.variant_id,
            p.id AS product_id, p.category_id, p.brand_id
       FROM sale_items si
       LEFT JOIN product_variants v ON v.id=si.variant_id
       LEFT JOIN products p ON p.id=v.product_id
      WHERE si.sale_id=$1`, [saleId]);

  let total = 0;
  let counted = 0;
  let usedRule = null;
  let basis = 0;

  for (const line of lines) {
    const rule = pickRule(rules, {
      userId: repId, productId: line.product_id,
      categoryId: line.category_id, brandId: line.brand_id });
    if (!rule) continue;
    const revenue = Number(line.line_total);
    const cost = Number(line.cost_price) * Number(line.quantity);
    const amount = amountFor(rule, { revenue, cost, quantity: line.quantity });
    if (amount <= 0) continue;
    total += amount;
    basis += rule.basis === 'profit' ? revenue - cost : revenue;
    counted += 1;
    usedRule = usedRule || rule;
  }

  if (total <= 0) return { amount: 0, lines: 0 };

  // One row per sale rather than per line: a rep reconciling their month wants
  // "invoice 1043 earned ₦1,250", not eleven rows adding up to it.
  await client.query(
    `INSERT INTO commission_entries
       (user_id, sale_id, rule_id, basis_amount, amount, kind, period)
     VALUES ($1,$2,$3,$4,$5,'earned',CURRENT_DATE)`,
    [repId, saleId, usedRule?.id || null, money(basis), money(total)]);

  return { amount: money(total), lines: counted };
}

/**
 * Claw back the share of a sale's commission that has been returned.
 *
 * Proportional to value refunded rather than recalculated from the rules,
 * because the rules may have changed since the sale and the rep was paid under
 * the old ones. What was earned on that sale is a fact; what it would be worth
 * today is not the question.
 */
export async function clawbackForReturn(client, { returnId, saleId, refundAmount }) {
  if (!saleId || !returnId) return { amount: 0 };

  const { rows: earned } = await client.query(
    `SELECT user_id, COALESCE(SUM(amount),0) AS amount
       FROM commission_entries
      WHERE sale_id=$1 AND kind='earned' GROUP BY user_id`, [saleId]);
  if (!earned.length) return { amount: 0 };

  const { rows: sales } = await client.query('SELECT total FROM sales WHERE id=$1', [saleId]);
  const saleTotal = Number(sales[0]?.total || 0);
  if (saleTotal <= 0) return { amount: 0 };

  const share = Math.min(1, Number(refundAmount) / saleTotal);
  let clawed = 0;

  for (const row of earned) {
    // Never claw back more than is left un-clawed on this sale.
    const { rows: already } = await client.query(
      `SELECT COALESCE(SUM(-amount),0) AS taken FROM commission_entries
        WHERE sale_id=$1 AND user_id=$2 AND kind='clawback'`, [saleId, row.user_id]);
    const remaining = Number(row.amount) - Number(already[0].taken);
    if (remaining <= 0) continue;

    const amount = money(Math.min(remaining, Number(row.amount) * share));
    if (amount <= 0) continue;

    await client.query(
      `INSERT INTO commission_entries
         (user_id, sale_id, return_id, amount, kind, note, period)
       VALUES ($1,$2,$3,$4,'clawback',$5,CURRENT_DATE)`,
      [row.user_id, saleId, returnId, -amount,
       `${Math.round(share * 100)}% of the sale was refunded`]);
    clawed += amount;
  }

  return { amount: money(clawed) };
}
