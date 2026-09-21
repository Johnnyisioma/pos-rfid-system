/**
 * The double-entry ledger — Phase 3's spine.
 *
 * Every financial event (a sale, a purchase, an expense, a supplier return)
 * posts one balanced journal entry: total debits equal total credits, always.
 * A balance sheet and a P&L are then just sums over journal_lines grouped by
 * account type — never recomputed from the sales or expenses tables, so they
 * cannot disagree with each other.
 *
 * The engine never hard-codes an account id. It looks each one up by a stable
 * mapping key (cash, ar, sales_income, cogs, …) via account_mappings, seeded in
 * bootstrap. A shop can re-point "sales_income" at a different account and every
 * future posting follows, with no code change.
 */
import { many, one } from '../db/index.js';
import { nextRef } from '../lib/util.js';

const R2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Resolve a mapping key (or a raw account id) to a COA account id. */
export async function accountId(client, keyOrId) {
  if (typeof keyOrId === 'number') return keyOrId;
  const { rows } = await client.query(
    'SELECT account_id FROM account_mappings WHERE mapping_key=$1', [keyOrId]);
  if (!rows.length || !rows[0].account_id) {
    throw new Error(`No account mapped for "${keyOrId}" — seed the chart of accounts.`);
  }
  return rows[0].account_id;
}

/**
 * Post a balanced entry inside an existing transaction.
 *
 * lines: [{ account: <key|id>, debit?, credit?, memo? }]
 * Debits and credits must balance to the cent, or the whole thing throws and
 * the surrounding transaction rolls back — a ledger that can go out of balance
 * is not a ledger.
 */
export async function postEntry(client, {
  memo = '', source_type = 'manual', source_id = null, location_id = null,
  entry_date = null, created_by = null, lines = [],
}) {
  const resolved = [];
  let debits = 0;
  let credits = 0;
  for (const l of lines) {
    const debit = R2(l.debit);
    const credit = R2(l.credit);
    if (debit === 0 && credit === 0) continue;
    if (debit < 0 || credit < 0) throw new Error('Journal amounts cannot be negative.');
    resolved.push({ account_id: await accountId(client, l.account), debit, credit, memo: l.memo || '' });
    debits = R2(debits + debit);
    credits = R2(credits + credit);
  }
  if (!resolved.length) return null;               // nothing to post (e.g. a zero sale)
  if (debits !== credits) {
    throw new Error(`Journal entry does not balance: debits ${debits} ≠ credits ${credits}.`);
  }

  const ref = await nextRef(client, 'journal_entries', 'JE');
  const { rows } = await client.query(
    `INSERT INTO journal_entries (ref, entry_date, memo, source_type, source_id, location_id, created_by)
     VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6, $7) RETURNING id, ref`,
    [ref, entry_date, memo, source_type, source_id, location_id, created_by]);
  const entry = rows[0];
  for (const l of resolved) {
    await client.query(
      'INSERT INTO journal_lines (entry_id, account_id, debit, credit, memo) VALUES ($1,$2,$3,$4,$5)',
      [entry.id, l.account_id, l.debit, l.credit, l.memo]);
  }
  return entry;
}

/** Remove any entries previously posted for a source — used before reposting. */
export async function reverseSource(client, source_type, source_id) {
  await client.query('DELETE FROM journal_entries WHERE source_type=$1 AND source_id=$2',
    [source_type, source_id]);
}

/* ═══════════════════ reports straight from the ledger ═══════════════════ */

/**
 * Trial balance: every account with its net debit/credit. The grand totals
 * must be equal — the single number that proves the books are sound.
 */
export async function trialBalance({ upto = null } = {}) {
  const rows = await many(
    `SELECT a.id, a.code, a.name, a.type, a.normal_balance,
            COALESCE(SUM(jl.debit),0)  AS debit,
            COALESCE(SUM(jl.credit),0) AS credit
       FROM chart_of_accounts a
       LEFT JOIN journal_lines jl ON jl.account_id=a.id
       LEFT JOIN journal_entries je ON je.id=jl.entry_id
        AND ($1::date IS NULL OR je.entry_date <= $1)
      GROUP BY a.id
      ORDER BY a.code`, [upto]);
  const accounts = rows.map((a) => {
    const bal = Number(a.debit) - Number(a.credit);
    return {
      ...a, debit: Number(a.debit), credit: Number(a.credit),
      // present each account on its normal side
      balance: a.normal_balance === 'debit' ? bal : -bal,
    };
  });
  const totalDebit = R2(accounts.reduce((s, a) => s + a.debit, 0));
  const totalCredit = R2(accounts.reduce((s, a) => s + a.credit, 0));
  return { accounts, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

/**
 * The signed balance of an account for the STATEMENTS, by its type's natural
 * side — not by normal_balance. This is what makes a contra account behave: a
 * "Sales returns" account is income-typed but debit-natured, so on the income
 * statement its debit balance correctly REDUCES income rather than adding to it.
 */
const typedBalance = (a) =>
  (a.type === 'asset' || a.type === 'expense') ? R2(a.debit - a.credit) : R2(a.credit - a.debit);

/** Balance sheet: assets = liabilities + equity (+ current-period earnings). */
export async function balanceSheet({ upto = null } = {}) {
  const tb = await trialBalance({ upto });
  const withBal = tb.accounts.map((a) => ({ ...a, balance: typedBalance(a) }));
  const byType = (t) => withBal.filter((a) => a.type === t && a.balance !== 0);
  const sum = (arr) => R2(arr.reduce((s, a) => s + a.balance, 0));

  const assets = byType('asset');
  const liabilities = byType('liability');
  const equity = byType('equity');
  const income = sum(withBal.filter((a) => a.type === 'income'));
  const expense = sum(withBal.filter((a) => a.type === 'expense'));
  const netProfit = R2(income - expense);   // flows into equity until closed

  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = R2(sum(equity) + netProfit);
  return {
    assets, liabilities, equity,
    totalAssets, totalLiabilities, totalEquity,
    netProfit,
    balanced: totalAssets === R2(totalLiabilities + totalEquity),
  };
}

/** Income statement (P&L) over a date range, straight from the ledger. */
export async function incomeStatement({ from = null, to = null } = {}) {
  const rows = await many(
    `SELECT a.id, a.code, a.name, a.type,
            COALESCE(SUM(jl.credit - jl.debit),0) AS amount
       FROM chart_of_accounts a
       LEFT JOIN journal_lines jl ON jl.account_id=a.id
       LEFT JOIN journal_entries je ON je.id=jl.entry_id
        AND ($1::date IS NULL OR je.entry_date >= $1)
        AND ($2::date IS NULL OR je.entry_date <= $2)
      WHERE a.type IN ('income','expense')
      GROUP BY a.id
      ORDER BY a.code`, [from, to]);
  const income = rows.filter((r) => r.type === 'income')
    .map((r) => ({ ...r, amount: Number(r.amount) }));
  const expense = rows.filter((r) => r.type === 'expense')
    .map((r) => ({ ...r, amount: -Number(r.amount) }));   // expenses show positive
  const totalIncome = R2(income.reduce((s, r) => s + r.amount, 0));
  const totalExpense = R2(expense.reduce((s, r) => s + r.amount, 0));
  return { income, expense, totalIncome, totalExpense, netProfit: R2(totalIncome - totalExpense) };
}
