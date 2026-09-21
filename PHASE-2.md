# Version 6 — Phase 2: Advanced Sales, Services & Warranties

Phase 1 gave the catalogue its depth (tiered prices, sub-units, bin locations,
lots, labels) and wired it to RFID. Phase 2 is the **selling** half of the ERP:
promises before the sale, credit terms and blocking, chargeable services, and
warranties that are checked against the tag rather than a paper receipt.

Everything below is built, migrated and green: **285 API tests, 70 UI screens,
53 empty-shop screens, both Android bridges — 0 failed.**

---

## 1. Sales orders & shipments

A **sales order** is a promise, not a sale. The customer has committed to these
lines — maybe some are on backorder — but no stock moves and no invoice number
is burned until it is fulfilled at the till.

- Create an order for a customer (or walk-in), with a due date and per-line
  prices. The line editor flags a quantity that exceeds stock as a **backorder**
  rather than refusing it.
- Fulfil it in parts. Recording 1 of 3 moves the order to **partial**; the rest
  moves it to **fulfilled**. A fulfilled order can no longer be cancelled.
- **Shipments** track the physical delivery — carrier, tracking number, address
  — against an order or a completed sale, and advance pending → packed → shipped
  → delivered, stamping `shipped_at` / `delivered_at` as they go.

Menu: **Sell → Sales orders**, **Sell → Shipments** (behind the *Sales orders*
feature toggle).

## 2. Credit terms & Net-30 auto-blocking

- A customer now carries **payment terms in days**. A credit sale to a Net-30
  customer falls due 30 days later (`sales.due_date`).
- **Block credit** on a customer with a reason — the till refuses further credit
  sales while blocked, and the reason shows on their profile and in the audit
  log. Unblocking is one click.
- **Enforce terms** (Customers list) sweeps every account: anyone with an
  invoice past its due date is auto-blocked; anyone who has since cleared their
  balance is unblocked. It reports how many of each it touched.

## 3. Services

A **service type** is a charge that isn't a product — delivery, engraving,
repair, alteration — as a fixed amount or a percent of the sale, taxable or
exempt. Managed under **Sell → Services & warranties → Service types**.

## 4. Warranties × RFID (the payoff)

- Define a **warranty policy** (duration + unit) and attach it to a product in
  the editor.
- When a tagged unit of that product is sold, the sale **registers the warranty
  to that exact EPC** in the same transaction — start date and expiry computed
  from the policy.
- **Warranty check**: scan a returned item and the system says whether it is
  still covered, until when, and which invoice it came off — keyed to the
  serial, so it works even when the customer has lost the receipt. Wired into
  the standalone check screen *and* into the Returns flow, where it can load the
  original invoice with one click.

## 5. Cash denomination counting

Closing the till can now be counted **by denomination** — a tally of ₦1000
down to ₦1 that sums to the counted figure — instead of guessing a total. The
breakdown is stored with the shift. The blind count still holds: the expected
figure is withheld at the API until the count is submitted.

---

## What still needs you

Same as after Phase 1 — the new work has to reach Railway the same way:

1. **Push the source tree** (unzip and upload the files inside, not the zip) so
   Railway redeploys. The schema applies itself on boot.
2. The Phase 2 features ship **off by default** — turn on *Sales orders*,
   *Product warranties* and *Selling price tiers* under **Settings → Features**
   for the footwear shop. They never touch the restaurant module.
3. Still pending from before: delete `pos-rfid-system_4.zip` from the repo root;
   the unused `pos-rfid-web` Railway service; and wipe the demo data after
   testing.

## Tests

```
npm test                 285 API checks         0 failed
npm run check:ui          70 screens            0 problems
npm run check:empty       53 screens, blank DB  0 problems
npm run check:native      Android bridges       PASS (both shells)
npm run check             build-time refs       clean
```
