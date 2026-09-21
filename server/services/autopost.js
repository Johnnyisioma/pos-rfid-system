/**
 * Auto-posting — the bridge from operations to the ledger.
 *
 * A sale, a goods receipt, an expense and a supplier return each map to a
 * standard journal entry. These functions run inside the SAME transaction that
 * creates the record, so either both the operation and its bookkeeping land, or
 * neither does. Every entry is tagged with its source, so it can be found,
 * reversed and reposted (see reverseSource) without guessing.
 *
 * If accounting is not set up (no mapped accounts), posting is skipped quietly
 * rather than blocking a sale — a shop must be able to sell on day one.
 */
import { postEntry, reverseSource } from './ledger.js';

const R2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Which asset account a tender lands in.
const METHOD_ACCOUNT = {
  cash: 'cash', card: 'bank', transfer: 'bank', mobile_money: 'bank',
  store_credit: 'cash', points: 'cash',
};

async function ledgerReady(c) {
  const { rows } = await c.query("SELECT 1 FROM account_mappings WHERE mapping_key='sales_income' AND account_id IS NOT NULL");
  return rows.length > 0;
}

/**
 * A completed sale:
 *   Dr Cash/Bank (paid)          Dr AR (unpaid)
 *      Cr Sales income (net)     Cr VAT payable (tax)
 *   Dr COGS (cost)               Cr Inventory (cost)
 */
export async function postSale(c, saleId) {
  if (!(await ledgerReady(c))) return;
  const { rows } = await c.query('SELECT * FROM sales WHERE id=$1', [saleId]);
  const s = rows[0];
  if (!s || s.status !== 'completed') return;
  await reverseSource(c, 'sale', saleId);

  const total = R2(s.total);
  const tax = R2(s.tax_amount);
  const net = R2(total - tax);
  const balance = R2(s.balance_due);
  const paid = R2(total - balance);
  const cost = R2(s.cost_total);
  if (total === 0 && cost === 0) return;

  const lines = [];
  // Assets received: split the paid portion across tender accounts, scaled so
  // it sums exactly to `paid` (payment rows may include change or overpayment).
  const { rows: pays } = await c.query(
    "SELECT method, COALESCE(SUM(amount),0) AS amt FROM payments WHERE sale_id=$1 GROUP BY method", [saleId]);
  const tender = pays.filter((p) => METHOD_ACCOUNT[p.method]);
  const tenderTotal = R2(tender.reduce((t, p) => t + Number(p.amt), 0));
  if (paid > 0 && tenderTotal > 0) {
    const byAcct = {};
    for (const p of tender) {
      const acct = METHOD_ACCOUNT[p.method];
      byAcct[acct] = R2((byAcct[acct] || 0) + Number(p.amt) / tenderTotal * paid);
    }
    for (const [acct, amt] of Object.entries(byAcct)) if (amt > 0) lines.push({ account: acct, debit: amt });
  } else if (paid > 0) {
    lines.push({ account: 'cash', debit: paid });
  }
  if (balance > 0) lines.push({ account: 'ar', debit: balance, memo: s.invoice_no });
  if (net > 0) lines.push({ account: 'sales_income', credit: net });
  if (tax > 0) lines.push({ account: 'vat_payable', credit: tax });
  // rounding guard: force the revenue side to match the asset side to the cent
  const dr = R2(lines.filter((l) => l.debit).reduce((t, l) => t + l.debit, 0));
  const cr = R2(lines.filter((l) => l.credit).reduce((t, l) => t + l.credit, 0));
  if (dr !== cr && net > 0) lines.find((l) => l.credit && l.account === 'sales_income').credit = R2(net + (dr - cr));

  if (cost > 0) { lines.push({ account: 'cogs', debit: cost }); lines.push({ account: 'inventory', credit: cost }); }

  await postEntry(c, {
    memo: `Sale ${s.invoice_no || saleId}`, source_type: 'sale', source_id: Number(saleId),
    location_id: s.location_id, entry_date: s.created_at, created_by: s.user_id, lines,
  });
}

/** Goods received into stock: Dr Inventory, Cr Accounts payable. */
export async function postPurchaseReceipt(c, poId, value, { locationId = null, userId = null, memo = '' } = {}) {
  if (!(await ledgerReady(c))) return;
  const amount = R2(value);
  if (amount <= 0) return;
  await postEntry(c, {
    memo: memo || `Goods received (PO ${poId})`, source_type: 'purchase', source_id: Number(poId),
    location_id: locationId, created_by: userId,
    lines: [{ account: 'inventory', debit: amount }, { account: 'ap', credit: amount }],
  });
}

/** An expense: Dr Operating expense, Cr Cash/Bank. */
export async function postExpense(c, expenseId) {
  if (!(await ledgerReady(c))) return;
  const { rows } = await c.query(
    `SELECT e.*, pa.type AS account_type FROM expenses e
       LEFT JOIN payment_accounts pa ON pa.id=e.account_id WHERE e.id=$1`, [expenseId]);
  const e = rows[0];
  if (!e) return;
  const amount = R2(e.amount);
  if (amount <= 0) return;
  await reverseSource(c, 'expense', expenseId);
  const asset = e.account_type === 'cash' || !e.account_type ? 'cash' : 'bank';
  await postEntry(c, {
    memo: `Expense ${e.ref}`, source_type: 'expense', source_id: Number(expenseId),
    location_id: e.location_id, entry_date: e.expense_date, created_by: e.user_id,
    lines: [{ account: 'expense', debit: amount }, { account: asset, credit: amount }],
  });
}

/** A supplier return / debit note: Dr Accounts payable, Cr Inventory. */
export async function postPurchaseReturn(c, returnId) {
  if (!(await ledgerReady(c))) return;
  const { rows } = await c.query('SELECT * FROM purchase_returns WHERE id=$1', [returnId]);
  const pr = rows[0];
  if (!pr) return;
  const amount = R2(pr.total);
  if (amount <= 0) return;
  await reverseSource(c, 'purchase_return', returnId);
  await postEntry(c, {
    memo: `Debit note ${pr.debit_note_no || pr.ref}`, source_type: 'purchase_return', source_id: Number(returnId),
    location_id: pr.location_id, created_by: pr.user_id,
    lines: [{ account: 'ap', debit: amount }, { account: 'inventory', credit: amount }],
  });
}

/** A customer refund: Dr Sales returns, Cr Cash. */
export async function postSalesReturn(c, returnId, amount, { locationId = null, userId = null, ref = '' } = {}) {
  if (!(await ledgerReady(c))) return;
  const amt = R2(amount);
  if (amt <= 0) return;
  await postEntry(c, {
    memo: `Refund ${ref}`, source_type: 'sales_return', source_id: Number(returnId),
    location_id: locationId, created_by: userId,
    lines: [{ account: 'sales_returns', debit: amt }, { account: 'cash', credit: amt }],
  });
}
