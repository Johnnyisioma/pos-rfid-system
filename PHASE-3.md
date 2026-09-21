# Version 6 — Phase 3: Purchasing & Double-Entry Accounting

Phase 3 gives the shop a real set of books. Every sale, purchase, expense and
supplier return now posts itself to a double-entry ledger, so the balance sheet
and the profit & loss are read out of the same journal rather than recomputed —
they cannot disagree. It also adds the two purchasing controls a growing shop
needs: requisitions before purchase orders, and debit notes for supplier
returns.

All green: **304 API tests, 77 UI screens, 62 empty-shop screens, both Android
bridges — 0 failed.** The ledger reconciles under test: trial balance balances,
and assets = liabilities + equity to the cent after every posting.

---

## 1. Double-entry accounting

- **Chart of accounts** — the five roots (assets, liabilities, equity, income,
  expenses) seeded with the accounts a retailer needs (cash, bank, receivable,
  inventory, payable, VAT payable, sales, COGS, operating expenses, …). Rename
  freely; the seeded system accounts can't be deleted. Add your own.
- **The journal** — every entry is balanced (debits = credits) or it doesn't
  post, full stop. Sales, purchases, expenses and returns write their entries
  automatically, tagged to their source so they can be traced and reposted.
- **Auto-posting** wired into the live flows:
  - *Sale* → Dr Cash/Bank/Receivable · Cr Sales income · Cr VAT payable, and
    Dr COGS · Cr Inventory. Split across tender types automatically.
  - *Goods received* → Dr Inventory · Cr Accounts payable.
  - *Expense* → Dr Operating expense · Cr Cash/Bank.
  - *Supplier return (debit note)* → Dr Accounts payable · Cr Inventory.
  - *Customer refund* → Dr Sales returns · Cr Cash.
- **Manual journal entries** for corrections, opening balances and accruals —
  the form refuses to post until it balances.
- **Statements straight from the ledger**: trial balance (with the "balanced"
  proof), balance sheet (assets = liabilities + equity), and a date-ranged
  profit & loss. Contra accounts (e.g. Sales returns) are handled correctly, so
  a return reduces income rather than inflating it.

If accounting is ever left unset, posting is skipped quietly — a shop can still
sell on day one.

## 2. Purchase requisitions

The ask-before-you-order control. A clerk raises a requisition for stock a
branch is low on; a manager approves (or rejects with a reason); and an approved
requisition **converts to a draft purchase order in one click**, carrying its
lines and estimated costs. Nobody commits the shop's money to a supplier without
a second signature.

## 3. Debit notes (combined with purchase returns)

A purchase return now *is* a debit note: sending goods back debits the supplier
(they owe you), gets its own **DN number**, and can be **settled** when the
supplier credits you — partially or in full, with the outstanding balance
tracked. Surfaced in Purchases → Purchase returns / debit notes.

## 4. Recurring expenses

Rent, salaries, subscriptions — bills on a schedule (weekly / monthly /
quarterly / yearly). **Run due** turns every template whose date has arrived
into a real expense (which books to the ledger like any other) and rolls the
schedule forward. Nothing posts on its own without someone pressing the button.

## 5. Granular tax groups

Combine two or more tax rates into one selectable tax (VAT + a state levy, say),
whose rate is the sum of its members. Under Settings → Tax rates.

---

## What still needs you

1. **Push the source tree** so Railway redeploys — the schema and the seeded
   chart of accounts apply themselves on boot.
2. The Phase 2/3 ERP features ship **off by default** where they have a toggle
   (Sales orders, Warranties, Price tiers). Accounting, Requisitions, Debit
   notes and Recurring expenses are always on and gated only by permissions —
   the **Accounting** menu needs the *balance sheet* permission, and posting
   manual entries or editing the chart needs the new *accounts.journal*
   permission (grant it to the roles that should have it under Staff →
   Permissions).
3. Still pending from before: delete `pos-rfid-system_4.zip` from the repo root,
   remove the unused `pos-rfid-web` Railway service, and wipe demo data.

## Tests

```
npm test                 304 API checks         0 failed
npm run check:ui          77 screens            0 problems
npm run check:empty       62 screens, blank DB  0 problems
npm run check:native      Android bridges       PASS (both shells)
npm run check             build-time refs       clean
```
