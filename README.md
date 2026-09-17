# Multi-Location Retail POS + RFID Inventory

A complete point-of-sale and stock-control system for a multi-branch retail business,
built around one idea: **every physical unit of stock carries its own RFID tag**, so two
identical pairs of the same shoe in the same size are two distinct, individually tracked
items — and a scan counts both.

Runs as an installable PWA on a counter PC, a tablet, an Android phone, or an
Android-based handheld RFID scanner. Works offline and syncs when the connection returns.

---

## Contents

- [What it does](#what-it-does)
- [The menu](#the-menu)
- [Money: payment accounts](#money-payment-accounts)
- [Purchase returns](#purchase-returns)
- [Tax rates](#tax-rates)
- [Roles and permissions](#roles-and-permissions)
- [How the RFID side works](#how-the-rfid-side-works)
- [Running it locally](#running-it-locally)
- [Deploying to Railway](#deploying-to-railway)
- [Connecting real hardware](#connecting-real-hardware)
- [Demo logins](#demo-logins)
- [Project layout](#project-layout)
- [API reference](#api-reference)
- [Tests](#tests)
- [Backups](#backups)
- [Notes and limitations](#notes-and-limitations)

---

## What it does

**Selling**
- Fast search by name, SKU or barcode; tap a size/colour to add it to the cart
- RFID scanning at the till — scan the tag, the exact unit joins the sale
- Cash, card, bank transfer, mobile money, store credit and loyalty points, including split payments
- Park a sale and resume it later; quotations; layaway with a deposit
- Credit sales with per-customer credit limits and balance tracking
- Line and whole-cart discounts, with a per-cashier discount ceiling enforced server-side
- Returns, refunds and exchanges — with or without the original receipt
- On-screen and printable receipts — 58 mm, 80 mm or A4, with your logo, at a font size you choose
- A gift receipt that hides prices
- Managers can amend an issued receipt within a configurable window, with a full before/after trail
- Till open/close with expected-versus-counted cash reconciliation

**Stock**
- Products with size/colour variant matrices, bundles/kits, and reusable variation templates
- CSV and Excel import with a downloadable template, a dry-run validator and row-level error reporting
- CSV and Excel export of the whole catalogue, including per-location stock and value
- Bulk edit, duplication, and per-location price overrides
- Suppliers, purchase orders and goods receiving
- Stock adjustments with a mandatory reason
- Multi-location stock, transfers with an in-transit stage and a receive confirmation
- Low-stock alerts and reorder suggestions

**RFID**
- A unique EPC minted for every physical unit the moment it enters stock
- Tag encoding that produces the exact ZPL a Zebra printer needs (simulated until one is connected)
- A scan simulator that accepts anything a handheld would send
- RFID stock take: bulk scan, then reconcile found / missing / unexpected / wrong-branch
- Find-an-item: given a product and size, see exactly which units exist and where
- A full-screen Stock Take Mode built for handheld use

- Purchase returns — damaged or wrong deliveries go back to the supplier under their own status,
  so supplier faults never show up in your shrinkage figures

**Money**
- Payment accounts: the till, the bank account, the Opay/Moniepoint wallet, the card terminal's
  settlement account — each with its own running balance and movement history
- Tender mapping, so cash lands in the till and a transfer lands in the bank without a cashier
  ever choosing
- Per-product tax rates alongside the business VAT rate, with a per-rate breakdown on the receipt
- Expenses by category, location and the account they were paid from

**Business**
- Customers, groups with standing discounts, loyalty points, store credit, account balances
- Dashboards, best sellers, slow movers, dead stock, sales by staff/location/category
- Profit and loss, inventory valuation and potential profit
- Z report for end-of-day cash-up, money in and out, payment by age, supplier and customer
  balances, purchase versus sale, and a shrinkage report grouped by reason and by who authorised it
- Nigeria VAT at a configurable rate, shown separately, with the business TIN on every invoice
  and sequential unbroken invoice numbering
- Every list exports to CSV, Excel or a clean A4 printout
- Audit log of who created, changed or deleted what
- Grouped, collapsible sidebar — each area opens onto its own pages, and every sub-page is a real
  URL you can bookmark or link to
- A calculator, an alerts bell and today's takings in the top bar

---

## The menu

The sidebar follows the shape people already know from Ultimate POS, so a manager who has used
one can find things here without being taught:

| Group | What is inside |
|---|---|
| **Dashboard** | The day at a glance |
| **User Management** | Staff, roles and permissions |
| **Contacts** | Customers, customer groups, suppliers |
| **Products** | All products, add product, import/export, print RFID tags, categories and brands, variation templates, tax rates |
| **Purchases** | Add purchase order, list purchases, purchase returns, reorder suggestions |
| **Sell** | New sale, all sales, held sales, drafts, quotations, layaway, unpaid invoices, returns, register |
| **Stock Transfers** | Add transfer, list transfers |
| **Stock** | Stock on hand, adjustments, low stock, valuation, stock take |
| **RFID** | Tagged units, scan simulator, stock take, find an item, devices |
| **Expenses** | Add expense, list expenses, expense categories |
| **Payment Accounts** | List accounts, money in and out |
| **Reports** | Grouped by Money / Stock / People / Audit |
| **Settings** | Business, receipt and invoice, locations, registers, staff, roles, tax rates, catalogue options |

Two conventions worth knowing. Inside a long group, **add-something comes before list-something**,
because the thing you came to do is usually the thing you came to do. And **Stock Take Mode** sits
in its own zone at the bottom, walled off from everything else — it takes the whole screen and is
meant for a handheld, so it should be hard to hit by accident.

Every entry is a real URL. `/sales?status=held`, `/reports?tab=z`, `/settings?tab=taxes` — bookmark
them, put them on a tablet's home screen, or send one to a colleague.

---

## Money: payment accounts

A register session tracks one cash drawer for one shift. Payment accounts are the other half: where
the money actually ends up. Without them a transfer payment goes into the sale and then vanishes,
and nothing reconciles at the end of the month.

Set up an account per real place money sits — **Payment Accounts → New account**:

- **Cash / till** — the drawer
- **Bank account** — your GTBank, Zenith, whichever
- **Mobile money wallet** — Opay, Moniepoint, PalmPay
- **Card terminal settlement** — where your POS terminal pays out

Then **Tender defaults** maps each payment method to an account once, and every sale from then on
routes itself. A cashier is never asked.

An account's balance is `opening balance + payments in − expenses out`, and opening it shows every
movement with the invoice or expense reference behind it.

One deliberate behaviour: **an unmapped tender is left unassigned rather than swept into the default
account.** It would be easy to dump an unmapped transfer into the cash till, but then the drawer
would never reconcile and nobody would notice the bank account was never set up. Instead the money
shows as "Unassigned" in **Reports → Money in & out**, with a link to the mapping screen.

Deleting an account that has money against it deactivates it instead. History stays intact.

---

## Purchase returns

When a delivery arrives damaged, faulty or simply wrong, **Purchases → Purchase returns → Record
return** sends it back properly rather than adjusting the stock away.

The difference matters. A stock adjustment is how you record *your* loss — theft, breakage,
miscounts. Putting a supplier's bad delivery through the same door inflates your shrinkage figure
and hides the fact that one supplier keeps sending damaged goods. So a purchase return:

- takes the actual tagged units out under their own status, `returned_supplier`
- keeps the cost on the supplier's account and drops what you owe them by the return value
- records the supplier's credit note number against it
- appears in its own report and export, and **never** in the shrinkage report

You cannot return more than you hold, and a reason is required on every one.

---

## Tax rates

Most of the catalogue is standard-rated at 7.5%, but not all of it. A single global rate means
exempt lines get taxed quietly and the VAT return is wrong.

**Settings → Tax rates** holds named rates; **the product form** assigns one. A product with no
rate assigned falls back to the business VAT rate in **Settings → Business**.

A basket that mixes rates prints a breakdown per rate on the receipt rather than one misleading
"VAT @ 7.5%" line — which, on a tax document, would be a false statement.

Rates already used by a product are deactivated rather than deleted, so historical invoices keep
showing the rate that was actually charged.

---

## Roles and permissions

**Settings → Roles & permissions** shows exactly what each role may reach, straight from what the
server enforces — no guessing, and no discovering it the day a cashier voids yesterday's sales.

The four roles are **Administrator**, **Manager**, **Cashier** and **Inventory Staff**.

They are defined in `server/lib/permissions.js` rather than in a database table, and the screen is
read-only on purpose: a permission set that can be edited from the admin screen is a permission set
that anyone reaching that screen can widen. To change what a role may do, edit that file and
redeploy — the change then applies everywhere at once, including the API, not just the buttons the
UI happens to hide.

---

## Editing an issued receipt

Mistakes at the till are normal: the wrong size gets scanned, a discount is forgotten, a customer
adds a pair on the way out. Rather than force a return-and-resell, an Administrator or Manager can
amend the receipt directly — **Sales → open the invoice → Edit sale**.

What the system guarantees while you do it:

| | |
|---|---|
| **The invoice number never changes** | A VAT invoice sequence has to stay unbroken, so an amendment updates the document in place rather than issuing a new number. |
| **Every version is kept** | Each edit writes a revision with the full before/after — lines, quantities, prices, totals and the exact RFID tags on each side. Nothing is overwritten silently. |
| **Stock stays honest** | The tagged units on the original sale go back on the shelf, then units are re-allocated against the new lines. The movement ledger records both halves. |
| **Prices come from the catalogue** | Line prices are re-read from the database on save, so the edit screen cannot invent a price. |
| **The customer's ledger follows** | Balance owed, loyalty points and change due are all recalculated from the new total. |
| **The receipt says so** | A reprint is marked `*** AMENDED COPY — REVISION n ***`. |

Guard rails: only roles with `sales.edit` (Administrator, Manager) can do it; the window is set in
**Settings → Receipt & invoice** and defaults to 30 days — set it to `0` to switch the feature off;
a reason is required; and a sale that already has a return against it is refused, because unwinding
both at once is how ledgers get corrupted. Process another return instead.

> Altering an issued VAT invoice may still require a credit note under Nigerian rules. The system
> keeps the evidence trail either way — ask your tax adviser how corrections should be handled for
> your business.

## How the RFID side works

Most stock systems track *SKUs*: "we have 4 of this shoe in size 42". This one tracks
*units*: four rows, four EPCs, four independent life stories. That is what makes a bulk
RFID sweep meaningful — the reader sees four tags and the system can say which four.

### The EPC

Every unit gets a 96-bit EPC rendered as 24 hex characters, shaped so real UHF hardware
accepts it unchanged:

```
┌──────────┬───────────────┬───────────────┐
│ 4 hex    │ 10 hex        │ 10 hex        │
│ company  │ variant id    │ unit serial   │
│ prefix   │ (the SKU)     │ (per variant) │
└──────────┴───────────────┴───────────────┘

3035 0000000042 0000000007
└─┬┘ └────┬───┘ └────┬───┘
  │       │          └── 7th unit ever received of this variant
  │       └───────────── product variant #42
  └───────────────────── your company prefix (Settings → EPC company prefix)
```

Alongside it, a human-readable label is printed on the tag —
`MF-0001-42-BLACK-000007` — so staff can read a tag without a scanner.

`server/services/epc.js` is the only place an EPC is built, parsed or normalised.
Changing to a different numbering scheme means editing that one file.

### Where units are created

| Event | What happens |
|---|---|
| Goods received against a purchase order | one unit + EPC per item received |
| Direct stock receipt | one unit + EPC per item |
| Positive stock adjustment | one unit + EPC per item added |
| CSV/Excel import with `opening_stock` | one unit + EPC per opening item |
| Return restocked without a matching tag | a fresh unit + EPC so the item stays trackable |

Units never lose their identity: selling marks them `sold`, a return revives the *same*
unit rather than issuing a new tag, a transfer moves them through `in_transit`, and a
stock-take shortage marks them `lost`.

### Scanning

Anything a reader might send is normalised — raw hex, spaced hex (`3035 0000 …`),
`epc:3035…`, the printed label, a SKU, or a barcode. Unknown tags are recorded rather
than silently dropped, because "a tag we don't recognise" is itself useful information
during a count.

---

## Running it locally

**Requirements:** Node.js 20+ and PostgreSQL 14+.

```bash
# 1. install
npm install

# 2. point it at a database
cp .env.example .env
#    edit DATABASE_URL and JWT_SECRET

# 3. create the schema and load demo data
npm run reset          # = migrate --fresh + seed

# 4. build the front end and start
npm run build
npm start
```

Open <http://localhost:3000> and sign in with one of the [demo logins](#demo-logins).

### Working on the code

```bash
npm run dev:server     # API on :3000, restarts on change
npm run dev:client     # Vite dev server on :5173, proxies /api to :3000
```

### Useful scripts

| Command | What it does |
|---|---|
| `npm run migrate` | applies the schema (safe to re-run) |
| `npm run migrate -- --fresh` | **drops everything** and recreates the schema |
| `npm run seed` | loads the demo catalogue and 60 days of sample sales |
| `npm run reset` | fresh schema + seed |
| `npm test` | end-to-end API test suite (needs the server running) |

---

## Deploying to Railway

The app is a single service: one Node process serves both the API and the built PWA.

### Option A — from GitHub (recommended)

1. Push this folder to a new GitHub repository.

   ```bash
   git init
   git add .
   git commit -m "Retail POS + RFID inventory system"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
   git push -u origin main
   ```

2. On [railway.app](https://railway.app): **New Project → Deploy from GitHub repo**, and pick the repo.

3. In the same project: **New → Database → Add PostgreSQL**.

4. Open the app service → **Variables**, and add:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway resolves the reference) |
   | `JWT_SECRET` | a long random string |
   | `SEED_ON_BOOT` | `true` for a demo, `false` for real stock |

5. Open the app service → **Settings → Networking → Generate Domain**.

Railway builds with `npm install && npm run build` and starts with `npm start`. On first
boot the server creates its own schema and, if the database is empty and `SEED_ON_BOOT`
is not `false`, loads the demo data. `/api/health` is the health check.

### Option B — from your terminal with the Railway CLI

```bash
npm i -g @railway/cli
railway login
railway init
railway add --database postgres
railway variables --set "JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
railway up
railway domain
```

### After the first deploy

1. Sign in as the admin account.
2. **Settings → Business** — replace the placeholder name, TIN, address and phone.
3. **Settings → Staff** — change every demo password, and delete the accounts you don't need.
4. **Settings → Locations** — rename the two demo branches, or add your own.
5. When you're ready for real stock, set `SEED_ON_BOOT=false` and clear the demo data.

### Free tier

Railway's free/trial allowance covers a small Node service and a Postgres instance
comfortably for testing. Plans and allowances change — check Railway's current pricing
page before relying on it for a live shop, and note that a sleeping free service takes a
few seconds to wake on the first request.

---

## Connecting real hardware

Nothing in the app needs to change. Both the printer and the reader sit behind adapters
in `server/services/hardware.js`.

### Zebra RFID printer (ZD500R and similar)

1. Put the printer on the shop network; note its IP from a printed configuration label.
2. Load RFID label stock and run the printer's tag calibration once.
3. In the app: **Hardware → Add device**
   - Kind: *RFID print + encode*
   - Driver: *Zebra ZPL over TCP*
   - Host: the printer's IP, Port: `9100`
4. Press **Test** — a label prints and its tag is encoded.

The ZPL the system sends:

```zpl
^XA
^RS8,,,3                 ; Gen2, 3 write retries
^RFW,H,1,2,1^FD{EPC}^FS  ; write the unique EPC into the inlay
^RFR,H,1,2,1^FN0^FS      ; read it back to verify
^FO20,20^A0N,34,34^FD{product name}^FS
^FO20,190^BY2^BCN,90,Y,N,N^FD{human label}^FS
^XZ
```

If the printer is only reachable on the shop LAN, use the `http_agent` driver and run a
small forwarder there instead.

### Handheld UHF reader (Android)

Install the app on the handheld from its browser ("Add to home screen").

- **Keyboard-wedge readers** (most of them) need no setup at all: the scan boxes and
  Stock Take Mode accept their input directly.
- **SDK-driven readers** post batches to the API:

  ```http
  POST /api/rfid/scan-events
  Authorization: Bearer <staff token>
  X-Location-Id: 1

  { "epcs": ["3035…01", "3035…02"], "context": "stock_take", "stock_take_id": 7 }
  ```

  The endpoint accepts the payload shapes the common SDKs produce: `epcs`, `tags`,
  a single `epc`, or a whitespace-separated `data` string.

Until hardware is attached, everything runs in mock mode: the exact ZPL is generated and
stored so you can inspect it, but nothing is transmitted. **The EPCs you generate today
stay valid** — when the printer arrives, those same codes get written onto physical inlays.

---

## Demo logins

Password for all of them: `password123`

| Email | Role | Can do |
|---|---|---|
| `admin@millzee.test` | Administrator | everything, all locations |
| `manager@millzee.test` | Manager | all operations, reports, staff; no discount limit |
| `cashier@millzee.test` | Cashier (Lagos) | sell, return, till, customers; discounts capped at 5% |
| `cashier2@millzee.test` | Cashier (Umunede) | same, at the other branch |
| `stock@millzee.test` | Inventory staff | products, stock, purchasing, transfers, RFID; no checkout |

**Change these before the system touches real money.**

---

## Project layout

```
.
├── server/
│   ├── index.js              Express app, static PWA hosting, boot-time migration
│   ├── db/
│   │   ├── schema.sql        full PostgreSQL schema
│   │   ├── migrate.js        applies the schema (--fresh to drop first)
│   │   ├── seed.js           realistic demo data
│   │   └── index.js          pool, query helpers, transaction wrapper
│   ├── services/
│   │   ├── epc.js            the ONLY place an EPC is built or parsed
│   │   ├── hardware.js       Zebra ZPL + reader adapters (mock / TCP / HTTP agent)
│   │   ├── accounts.js       decides which payment account a tender lands in
│   │   ├── inventory.js      unit creation, allocation, stock movement ledger
│   │   └── pricing.js        VAT and discount engine, shared with the offline client
│   ├── routes/               one file per area of the API
│   ├── middleware/auth.js    JWT auth, role permissions, location scoping
│   └── lib/                  permissions map, audit log, shared helpers
├── client/
│   ├── public/               manifest, service worker, icons
│   └── src/
│       ├── pages/            one file per screen
│       ├── components/       layout, UI primitives, charts, receipt, export toolbar
│       └── lib/              API client, auth context, offline queue, formatting, tab URLs
└── scripts/
    ├── e2e.js                end-to-end API tests
    └── ui-check.mjs          headless browser pass over every screen
```

### Architecture notes

- **Multi-tenant from day one.** Every product, sale, stock record and movement is scoped
  to a `location_id`, even with a single shop. Adding branch three is a settings change.
- **Two stock layers kept in step.** `inventory` holds the fast aggregate per
  (variant, location); `stock_units` holds one row per physical item. Every function that
  moves stock updates both plus the `stock_movements` ledger, inside one transaction.
- **The server never trusts client prices.** Prices, tax rates and costs are re-read from
  the database on every sale; the client's arithmetic is only for display.
- **Offline sales are idempotent.** Each queued sale carries a `client_uuid`, so replaying
  the queue can never double-post.
- **Invoice numbers are allocated under a row lock**, so two tills can't take the same one
  and the sequence stays unbroken.

---

## API reference

All endpoints are under `/api`. Everything except `/api/auth/login` and `/api/health`
needs `Authorization: Bearer <token>`; the active branch is passed as `X-Location-Id`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password` |
| Products | `GET/POST /products`, `GET/PUT/DELETE /products/:id`, `GET /products/search`, `POST /products/:id/duplicate`, `POST /products/bulk`, `PUT /products/variants/:id/location-price` |
| Import/export | `GET /io/products/template`, `POST /io/products/validate`, `POST /io/products/import`, `GET /io/products/export` |
| Inventory | `GET /inventory/levels`, `/low-stock`, `/availability/:variantId`, `/movements`, `/valuation`; `POST /inventory/receive`, `/adjustments` |
| RFID | `GET /rfid/units`, `/units/:id`, `/units/:id/zpl`, `/find`, `/overview`, `/scan-events`; `POST /rfid/units/:id/encode`, `/encode-batch`, `/resolve`, `/scan-events`, `/simulate-sweep`, `/stock-takes`, `/stock-takes/:id/scan`, `/stock-takes/:id/reconcile` |
| Sales | `GET/POST /sales`, `GET /sales/:id`, `/sales/:id/receipt`, `/sales/held`, `POST /sales/:id/payments` |
| Amendments | `PUT /sales/:id` (amend an issued receipt), `GET /sales/:id/editable`, `GET /sales/:id/revisions` |
| Returns | `GET/POST /returns`, `GET /returns/:id`, `/returns/lookup/:invoice` |
| Purchases | `GET/POST /purchases`, `PUT /purchases/:id`, `POST /purchases/:id/receive`, `/cancel`, `GET /purchases/suggestions/reorder` |
| Purchase returns | `GET/POST /purchases/returns`, `GET /purchases/returns/:id` |
| Payment accounts | `GET/POST /accounts`, `GET/PUT/DELETE /accounts/:id`, `PUT /accounts/method-defaults` |
| Tax rates | `POST /catalog/tax-rates`, `PUT/DELETE /catalog/tax-rates/:id` (rates also come back on `GET /catalog`) |
| Roles | `GET /users/roles` — the permission matrix the server actually enforces |
| Transfers | `GET/POST /transfers`, `POST /transfers/:id/dispatch`, `/receive`, `/cancel` |
| Customers | `GET/POST /customers`, `PUT /customers/:id`, `POST /customers/:id/payments`, `/store-credit`, `/loyalty` |
| Registers | `GET /registers`, `POST /registers/:id/open`, `GET /registers/sessions/current`, `POST /registers/sessions/:id/close` |
| Reports | `GET /reports/dashboard`, `/sales`, `/products`, `/profit-loss`, `/tax`, `/today`, `/alerts`, `/z-report`, `/payments`, `/payment-by-age`, `/contacts-balance`, `/purchase-sale`, `/stock-adjustments`, `/export/:report` |
| Admin | `/settings`, `/locations`, `/users`, `/catalog`, `/devices`, `/audit`, `/expenses` |
| Offline | `GET /sync/snapshot`, `POST /sync/sales` |

---

## Tests

```bash
npm start                  # in one terminal
npm test                   # 155 end-to-end API checks
node scripts/ui-check.mjs --shots   # every screen in a headless browser
```

The API suite covers the things that would hurt most if they broke: that two identical
items resolve to two different units, that oversell is blocked, that invoice numbers stay
sequential, that a cashier can't exceed their discount ceiling, that a replayed offline
sale isn't duplicated, that a bad import is rejected wholesale, that returns put the right physical
unit back on the shelf, and — for amendments — that the invoice number survives, the stock delta is
exact, a cashier is refused, and the window actually closes.

It also covers the newer ground: that a payment routes itself to the account its tender is mapped
to, that an *un*mapped tender stays visibly unassigned instead of being swept into the till, that an
account holding money is deactivated rather than deleted, that a zero-rated product really is taxed
at zero in a mixed basket, that returning goods to a supplier drops stock by exactly the right
amount and never lands in the shrinkage report, that the aged-debt buckets add up to the total, and
that the Z report's expected cash reconciles.

The suite is re-runnable: run it twice against the same database and it still reports zero failures.

The UI pass visits all 52 screens and sub-tabs at desktop and phone widths, completes a real sale,
opens every sidebar group, **follows every sidebar link and fails if any of them falls through to
the catch-all redirect** — the classic symptom of a menu rewritten ahead of its pages — checks the
calculator and the export menu open, and fails on any console error, failed request, blank screen or
horizontal overflow.

---

## Backups

Railway takes its own Postgres snapshots, but keep your own copy too:

```bash
# one-off
pg_dump "$DATABASE_URL" --no-owner --format=custom > backup-$(date +%F).dump

# restore
pg_restore --clean --no-owner --dbname "$DATABASE_URL" backup-2026-09-16.dump
```

A nightly cron on any machine that can reach the database is enough:

```cron
0 2 * * * pg_dump "$DATABASE_URL" --format=custom > /backups/pos-$(date +\%F).dump
```

The catalogue can also be exported to Excel at any time from **Products → Export**, which
is a useful human-readable second copy.

---

## Notes and limitations

- **Tax.** The VAT rate is configurable and defaults to 7.5%. Rates, thresholds and
  e-invoicing timelines change — confirm your obligations with a tax adviser before
  relying on this for a live, revenue-generating business.
- **E-invoicing.** Not implemented. Invoice data *is* stored in the structured shape a
  FIRS UBL submission needs (see any sale → "View e-invoice payload"), so adding a
  submission integration is a mapping job rather than a redesign.
- **PDF reports.** Every list exports to CSV, Excel or a print view; for a PDF, use the
  browser's print-to-PDF from that print view. Receipts and the Z report print separately
  from the list printouts — receipts are styled for 58/80 mm thermal paper, list printouts
  and the Z report come out as A4.
- **Roles are fixed in code**, not editable in the app — see
  [Roles and permissions](#roles-and-permissions) for why, and how to change them.
- **Units of measure and price groups** are not implemented: everything sells in the unit
  set on the product, and per-location price overrides cover the pricing case. Sales
  orders/shipments, scheduled discounts, standalone barcode-label printing, notification
  templates, contact import, commission agents and warranties are also not implemented.
- **Offline mode** covers selling: the catalogue, prices, stock and customers are cached,
  and sales made offline queue locally and sync automatically. Stock-takes, receiving and
  reports need a connection.
- **Product images** are referenced by URL rather than uploaded; point them at any host you like.
  The company logo is different — it is uploaded in **Settings → Receipt & invoice**, scaled down in
  the browser and stored in the database, so it survives Railway redeploys without a volume.
- **Bundles** deduct their components' stock but are not themselves RFID-tagged, since a
  kit is not a single physical unit.
