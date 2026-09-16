/**
 * Pricing + VAT engine. Kept separate so the checkout, quotations, returns and
 * the offline client all compute totals the same way.
 *
 * Nigeria: VAT is shown as its own line on the invoice. Boutique shelf prices
 * are normally VAT-inclusive, so `prices_include_vat` defaults to true and the
 * tax is backed out of the price rather than added on top.
 */
import { money, num } from '../lib/util.js';

export function lineTax(amount, rate, inclusive) {
  const r = num(rate, 0);
  if (!r) return 0;
  return inclusive
    ? money((amount * r) / (100 + r))
    : money((amount * r) / 100);
}

/**
 * @param lines [{quantity, unit_price, discount_amount, tax_rate, cost_price}]
 * @param cartDiscount {type:'fixed'|'percent', value}
 */
export function computeTotals(lines, cartDiscount, settings) {
  const inclusive = settings.prices_include_vat !== false;

  const priced = lines.map((l) => {
    const qty = num(l.quantity, 0);
    const gross = money(num(l.unit_price, 0) * qty);
    const lineDiscount = money(
      num(l.discount_amount, 0) ||
      (num(l.discount_percent, 0) ? (gross * num(l.discount_percent, 0)) / 100 : 0)
    );
    return { ...l, quantity: qty, gross, lineDiscount, net: money(gross - lineDiscount) };
  });

  const netSum = priced.reduce((s, l) => s + l.net, 0);

  let cartDiscountAmount = 0;
  if (cartDiscount && num(cartDiscount.value, 0) > 0) {
    cartDiscountAmount =
      cartDiscount.type === 'percent'
        ? money((netSum * num(cartDiscount.value, 0)) / 100)
        : money(Math.min(num(cartDiscount.value, 0), netSum));
  }

  // spread the cart discount across lines so per-line VAT stays correct
  let allocated = 0;
  const finalLines = priced.map((l, i) => {
    let share =
      netSum > 0 ? money((cartDiscountAmount * l.net) / netSum) : 0;
    if (i === priced.length - 1) share = money(cartDiscountAmount - allocated);
    allocated = money(allocated + share);
    const net = money(l.net - share);
    const tax = lineTax(net, l.tax_rate, inclusive);
    return {
      ...l,
      discount_amount: money(l.lineDiscount + share),
      line_total: inclusive ? net : money(net + tax),
      net_excl_tax: inclusive ? money(net - tax) : net,
      tax_amount: tax,
    };
  });

  const taxTotal = money(finalLines.reduce((s, l) => s + l.tax_amount, 0));
  const subtotalExclTax = money(finalLines.reduce((s, l) => s + l.net_excl_tax, 0));
  const total = money(finalLines.reduce((s, l) => s + l.line_total, 0));
  const costTotal = money(
    finalLines.reduce((s, l) => s + num(l.cost_price, 0) * l.quantity, 0)
  );

  return {
    lines: finalLines,
    subtotal: money(priced.reduce((s, l) => s + l.gross, 0)),
    subtotal_excl_tax: subtotalExclTax,
    line_discounts: money(priced.reduce((s, l) => s + l.lineDiscount, 0)),
    cart_discount: cartDiscountAmount,
    discount_amount: money(
      priced.reduce((s, l) => s + l.lineDiscount, 0) + cartDiscountAmount
    ),
    tax_amount: taxTotal,
    total,
    cost_total: costTotal,
    gross_profit: money(total - taxTotal - costTotal),
    prices_include_vat: inclusive,
  };
}
