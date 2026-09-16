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
- On-screen and printable 80 mm receipts, plus a gift receipt that hides prices
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

**Business**
- Customers, groups with standing discounts, loyalty points, store credit, account balances
- Expenses by category and location
- Dashboards, best sellers, slow movers, dead stock, sales by staff/location/category
- Profit and loss, inventory valuation and potential profit
- Nigeria VAT at a configurable rate, shown separately, with the business TIN on every invoice
  and sequential unbroken invoice numbering
- Audit log of who created, changed or deleted what

---

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
│   │   ├── inventory.js      unit creation, allocation, stock movement ledger
│   │   └── pricing.js        VAT and discount engine, shared with the offline client
│   ├── routes/               one file per area of the API
│   ├── middleware/auth.js    JWT auth, role permissions, location scoping
│   └── lib/                  permissions map, audit log, shared helpers
├── client/
│   ├── public/               manifest, service worker, icons
│   └── src/
│       ├── pages/            one file per screen
│       ├── components/       layout, UI primitives, charts, receipt
│       └── lib/              API client, auth context, offline queue, formatting
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
| Returns | `GET/POST /returns`, `GET /returns/:id`, `/returns/lookup/:invoice` |
| Purchases | `GET/POST /purchases`, `PUT /purchases/:id`, `POST /purchases/:id/receive`, `/cancel`, `GET /purchases/suggestions/reorder` |
| Transfers | `GET/POST /transfers`, `POST /transfers/:id/dispatch`, `/receive`, `/cancel` |
| Customers | `GET/POST /customers`, `PUT /customers/:id`, `POST /customers/:id/payments`, `/store-credit`, `/loyalty` |
| Registers | `GET /registers`, `POST /registers/:id/open`, `GET /registers/sessions/current`, `POST /registers/sessions/:id/close` |
| Reports | `GET /reports/dashboard`, `/sales`, `/products`, `/profit-loss`, `/tax`, `/export/:report` |
| Admin | `/settings`, `/locations`, `/users`, `/catalog`, `/devices`, `/audit`, `/expenses` |
| Offline | `GET /sync/snapshot`, `POST /sync/sales` |

---

## Tests

```bash
npm start                  # in one terminal
npm test                   # 79 end-to-end API checks
node scripts/ui-check.mjs --shots   # every screen in a headless browser
```

The API suite covers the things that would hurt most if they broke: that two identical
items resolve to two different units, that oversell is blocked, that invoice numbers stay
sequential, that a cashier can't exceed their discount ceiling, that a replayed offline
sale isn't duplicated, that a bad import is rejected wholesale, and that returns put the
right physical unit back on the shelf.

The UI pass visits all 22 screens at desktop and phone widths, completes a real sale, and
fails on any console error, failed request, blank screen or horizontal overflow.

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
- **PDF reports.** Reports export to Excel and CSV. For PDF, use the browser's
  print-to-PDF — receipts are styled for 80 mm thermal paper and print correctly.
- **Offline mode** covers selling: the catalogue, prices, stock and customers are cached,
  and sales made offline queue locally and sync automatically. Stock-takes, receiving and
  reports need a connection.
- **Images** are referenced by URL rather than uploaded; point them at any host you like.
- **Bundles** deduct their components' stock but are not themselves RFID-tagged, since a
  kit is not a single physical unit.
