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
- [Signing in for the first time](#signing-in-for-the-first-time)
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

# 3. create the schema and the first-run skeleton
npm run reset          # = migrate --fresh + bootstrap

# 4. build the front end and start
npm run build
npm start
```

The admin password is generated and **printed once** in the startup output. Write it down,
then open <http://localhost:3000> and sign in.

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
| `npm run bootstrap` | creates the first-run skeleton (safe to re-run) |
| `npm run reset` | fresh schema + bootstrap — an empty shop, ready for your stock |
| `npm run check` | undefined component references |
| `npm test` | end-to-end API test suite (needs the server running) |
| `npm run fixtures` | **test data only** — see below |
| `npm run reset:test` | fresh schema + bootstrap + fixtures, for running the suites |

#### A note on the fixtures

The automated suites need a shop with history to assert against, so
`scripts/demo-fixtures.js` can build one: products, stock, sixty days of sales, customers,
suppliers, expenses. It is **test tooling, not application code** — nothing in the server
imports it, it refuses to run without `ALLOW_DEMO_DATA=1`, and it refuses again if the
database already contains completed sales.

A live install never creates a single invented row. Delete that file if you would rather
not have the capability in the tree at all.

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
   | `ADMIN_EMAIL` | optional — your login. Defaults to `admin@example.com` |
   | `ADMIN_PASSWORD` | optional — set one, or read the generated one from the deploy logs |

5. Open the app service → **Settings → Networking → Generate Domain**.

Railway builds with `npm install && npm run build` and starts with `npm start`. On first
boot the server creates its own schema, then a location, a register, an admin login and
the reference lists — **no sample products, stock, sales or customers, ever**. If you did
not set `ADMIN_PASSWORD`, the generated one is printed once in the deploy logs.
`/api/health` is the health check.

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

You are starting from an empty shop. In order:

1. **Sign in** with the admin login from the deploy logs, then **Settings → My account**
   and change the password.
2. **Settings → Business** — your trading name, TIN, RC number, address, phone, VAT rate.
3. **Settings → Locations** — rename "Main Shop", and add your other branches.
4. **Settings → Staff** — add your people and give them the narrowest role that works.
5. **Payment Accounts** — add your bank account and your Opay/Moniepoint wallet, then set
   the tender defaults so each payment lands in the right place by itself.
6. **Products** — add your catalogue, or import it from a spreadsheet under
   **Products → Import / export**.
7. **Purchases → Add purchase order**, then receive it. That is what creates stock and
   mints a code for every individual pair.
8. **RFID → Tag stock** — bind a pre-encoded label to each unit (no printer needed), or
   **RFID → Devices** to add a Zebra printer and print your own.

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

**You may not need an RFID printer at all.** The designed flow is that this system mints a
96-bit EPC and a Zebra RFID printer writes it onto the inlay. The printer is the most
expensive part of an RFID setup. The alternative — **RFID → Tag stock** — is the inverse:
buy plain pre-encoded UHF labels (every one already carries a unique factory EPC), stick
one on the item, pull the trigger, and that tag becomes that unit's identity. The per-unit
tracking is identical; two of the same shoe in the same size are still two different tags.
A tag already bound to another unit is refused rather than moved. Buy the printer only if
you want your own numbering on the inlay, or the product name and price printed on the
same label.

EPC length is **not** assumed to be 96-bit. Factory-encoded inlays commonly ship with
128-bit EPCs (32 hex characters) and 64-bit exists too; all are accepted and resolve to
the right unit.

#### SEUIC handhelds (Lenvii and other rebadges) — confirmed settings

Verified by decompiling the device's own `com.seuic.uhftool` app, not guessed:

| Setting | Where | Value | Why |
|---|---|---|---|
| **Send Mode** | UHF → Settings | **Focus** | `sendmode` 0 = Focus, 1 = Broadcast. Broadcast fires an Android intent (`com.android.server.scannerservice.broadcast`, data in the `scannerdata` extra) that a web page cannot receive. **Ships set to Broadcast.** |
| Region | UHF → Parameter → Basic param | **ETSI 865–868** | Ships on FCC 902–928. Nigeria is 865.6–867.6 MHz at 2 W ERP. |
| Power | UHF → Parameter | **~25 dBm** | Ships at 33 dBm (2 W). Full power reads the next aisle and ruins a count. |
| Region (data) | UHF → Settings | **EPC** | Already correct. TID would send the chip serial instead of your code. |
| Data start / length | UHF → Settings | **0 / 0** | Already correct. Non-zero silently truncates every read. |
| Prefix / Suffix | UHF → Settings | **empty** | Anything here is prepended or appended to every code. |
| Booted start | UHF → Settings | **ON** | Otherwise staff must open the UHF app before the trigger does anything. |

**Focus mode delivers a read as a text commit, not as keystrokes.** The app calls the
vendor's hidden `InputMethodManager.setCommitText`, so the browser receives one `input`
event carrying the whole code — no per-character key events, and **no Enter**: the
terminator is a separate setting (`endchar_on_emu`) that ships off, and the interval
character only separates one tag from the next.

Every scan surface here handles that: a read is finished by an Enter **or** a short pause,
and the till picks up a tag committed into its ordinary search box without anyone opening a
scan dialog first. `scripts/commit-delivery-check.mjs` proves it using Playwright's
`insertText`, which fires exactly the same events `setCommitText` does.

**Set the radio region first.** Nigeria's RAIN RFID allocation is **865.6–867.6 MHz at
2 W ERP (ETSI)**. These handhelds usually ship set to the Chinese or US band, where read
range is poor and you are transmitting outside your allocation. Set the reader to ETSI
865–868 and start around 20–25 dBm — full power in a small shop reads tags from the next
aisle, which ruins a count.

**If it does not read, use the Reader test.** **RFID → Reader test** records the raw
keystrokes, their timing and their terminator before the system tries to interpret
anything, and names the fault. The three ways a reader fails look identical on a normal
scan box — nothing happens — but need completely different fixes:

| What the page says | What to change |
|---|---|
| Nothing arrives | The reader is not sending to the focused field — on SEUIC, **Send Mode is still Broadcast**. |
| Delivery: Commit, no terminator | Normal for SEUIC Focus mode. Nothing to fix. |
| Wrong length | The reader is sending TID, not the EPC memory bank. |
| Right format, no match | The reader is fine — those tags are not registered here yet. |

**Copy diagnostics** puts a pasteable report on the clipboard.

**Continuous / inventory mode.** Set the reader to continuous (not single-shot) so holding
the trigger keeps reading. Stock Take Mode is built for exactly that stream:

- Re-reads of a tag already counted are dropped **in the browser** — a tag read two hundred
  times costs one network call, not two hundred.
- New tags are batched and posted every 400ms, so a sweep is a handful of requests rather
  than a request per read.
- The capture field is uncontrolled and accepts reads with or without a Return suffix, so
  no characters are lost to a reader typing a 24-character EPC in a few milliseconds.
- The count lives on the server, one row per (count, EPC). Let go of the trigger, lock the
  handheld, close the app, come back tomorrow — reopening resumes the same count. Nothing
  needs restarting.
- `scripts/sweep-check.mjs` proves it: 300 reads of 20 unique tags arrive as 20 codes in
  2 requests, with nothing dropped.

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

A count also accepts the **printed barcode** on the label, not just the RFID tag — both
name the same individual unit, and scanning one after the other never counts it twice. So
a barcode-only count works if a reader has no keyboard output, or if one tag will not read.

**Nothing is simulated.** If no printer is configured, or the one configured cannot be
reached, printing fails and says so — a unit is never marked as tagged unless a device
actually accepted the label. You can still inspect the exact ZPL for any unit before a
printer exists; it simply is not reported as printed.

---

## Signing in for the first time

There are no built-in accounts and no default password. On first boot the server creates a
single administrator and **prints its password once** in the startup output:

```
  ┌──────────────────────────────────────────────────────────
  │  FIRST-RUN ADMIN LOGIN — shown once, write it down now
  │    email:    admin@example.com
  │    password: 7f3k-9qxa-2mld-p0vv
  └──────────────────────────────────────────────────────────
```

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the first boot if you would rather choose
them. Change the password under **Settings → My account**, then add your staff under
**Settings → Staff** and give each the narrowest role that lets them do their job
(**Settings → Roles & permissions** shows exactly what each one can reach).

---

## Project layout

```
.
├── server/
│   ├── index.js              Express app, static PWA hosting, boot-time migration
│   ├── db/
│   │   ├── schema.sql        full PostgreSQL schema
│   │   ├── migrate.js        applies the schema (--fresh to drop first)
│   │   ├── bootstrap.js      first-run skeleton — no sample data, ever
│   │   └── index.js          pool, query helpers, transaction wrapper
│   ├── services/
│   │   ├── epc.js            the ONLY place an EPC is built or parsed
│   │   ├── hardware.js       Zebra ZPL + reader adapters (TCP / HTTP agent)
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
    ├── ui-check.mjs          headless browser pass over every screen
    ├── sweep-check.mjs       continuous UHF sweep against Stock Take Mode
    ├── reader-test-check.mjs reader fault modes vs. the diagnosis given
    ├── commit-delivery-check.mjs  the SEUIC text-commit delivery, end to end
    ├── check-refs.mjs        undefined component references, before they ship
    ├── empty-state-check.mjs every screen on a brand-new, empty shop
    └── demo-fixtures.js      TEST DATA ONLY — never loaded by the server
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
| Tag binding | `GET /rfid/untagged`, `POST /rfid/units/:id/assign-tag`, `POST /rfid/units/:id/unassign-tag` |
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
npm run check              # undefined component references (runs inside npm run build too)
npm test                   # 183 end-to-end API checks
# the visual checks drive a real browser:
npm i -D playwright && npx playwright install chromium

node scripts/ui-check.mjs --shots   # every screen in a headless browser
node scripts/sweep-check.mjs        # a continuous UHF sweep against the handheld screen
node scripts/reader-test-check.mjs  # every reader fault mode, and the diagnosis given
node scripts/commit-delivery-check.mjs  # SEUIC-style commit delivery on every scan surface

# and against a brand-new empty shop:
npm run reset && npm start
ADMIN_PASS=… node scripts/empty-state-check.mjs
```

Playwright is deliberately not a dependency — it pulls a browser with it, and Railway
installs dev dependencies during a build. The API suite needs no browser.

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

It also covers the continuous-sweep case directly: that re-reading the same tags forty times
over adds nothing to the count, that scanner formatting (lowercase, spaced, colon-separated)
still matches the same units, and that the printed label counts as the same unit as its chip.

The suite is re-runnable: run it twice against the same database and it still reports zero failures.

It also covers binding a pre-encoded tag: that a 128-bit factory EPC binds, resolves and
sells like a minted one, that a tag already in use is refused rather than moved, and that
unbinding returns the unit to the queue.

`scripts/sweep-check.mjs` drives the handheld screen in a real browser with a 300-read
stream and asserts what reaches the server — it is what caught reads being stranded in the
send queue at the end of a sweep.

`scripts/check-refs.mjs` runs as part of `npm run build` and catches an undefined component
reference — writing `icon: Tag` when only `Tags` was imported. That is not a syntax error,
not a bundler error, and builds perfectly; it fails at runtime and, in a shared layout,
white-screens the whole app.

`scripts/empty-state-check.mjs` walks all 44 screens on a database holding nothing but the
bootstrap skeleton. Every screen in this system was built against a database full of
history; a real first day has none, and an empty array is the classic way a fresh install
greets its owner with a crash.

The UI pass visits all 54 screens and sub-tabs at desktop and phone widths, completes a real sale,
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
