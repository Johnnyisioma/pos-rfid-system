# Version 5 — what changed, and what I changed about your spec

Read this first. The short version: **everything in the V5 list is built and
tested, except that I did not run your SQL.** Section 2 explains why, and what
I did instead. Section 5 is the APK build you asked to be ready for.

---

## 1. The one decision I made without asking

Your spec's schema was written as **SQLite** — `TEXT PRIMARY KEY`, `REAL`,
`DATETIME DEFAULT CURRENT_TIMESTAMP`, `BOOLEAN DEFAULT 0` — against a blank
database. The system you are running is **PostgreSQL 16** with integer keys,
`NUMERIC(14,2)` money and `TIMESTAMPTZ`, and it is holding a shop's sales,
transfers and stock counts.

Running that DDL literally would have dropped every foreign key and taken your
data with it. So V5 is **mapped onto what is already there**:

| your spec called it | what it actually is | why |
|---|---|---|
| `rfid_tags` | `stock_units` | Already one row per physical item, already carrying sale history, transfers and stock-take scans. A second tag table would have been a duplicate of the thing that already works. Exposed as a **`rfid_tags` view** so anything written against your names still runs. |
| `register_shifts` | `register_sessions`, extended | Same table, eleven new columns for the blind count and X/Z reports. Also exposed as a **`register_shifts` view**. |
| `locations`, `products`, `product_variants` | already exist | Re-declaring them with `TEXT` keys would have broken every foreign key pointing at them. |

Everything genuinely new got a real table: `tag_batches`, `tag_sightings`,
`user_permissions`, `feature_flags`, `commission_rules`, `commission_entries`,
`stock_holds`, `quarantine_items`, `layaway_plans`, `layaway_instalments`,
`receipt_deliveries`, `register_cash_movements`, `register_reports`.

Every statement is idempotent, so it applies on every boot without touching
live data. It has been applied and re-applied against a database with 1,600
units and 800 sales in it.

**Your "License Plate" model is exactly what this already did** — an EPC
identifies one physical item and says nothing about what that item is. V5 adds
the provenance: whether a plate was minted here or came off a factory tag, how
many bits it carries, who paired it and when.

---

## 2. The Android app (sections 1A–1C)

**There are two, and the APK you have is the second one.**

`android-app/` is the Capacitor project — the one to open in Android Studio,
and the better long-term home. It also cannot be built anywhere that cannot
reach `dl.google.com` and `maven.google.com`, because the Android Gradle
Plugin, the platform SDK, androidx and Capacitor's own artifacts all live
there. That is exactly the situation I am in, so it builds on your machine and
not on mine.

`android-native/` is a plain WebView app with the same bridge, compiled
against the platform `android.jar` with `javac`, `dx`, `aapt` and `apksigner`
— all of which Debian and Ubuntu package. No Gradle, no Capacitor, no
androidx, no Google mirror. **That is the APK attached**: signed, verified,
about 28 KB.

It loads your live site rather than bundling a copy of the web app, which
means deploying to Railway updates every handheld at once. No rebuilding, no
reinstalling, nothing to go stale.

Both are real and both are tested. `android-native/README.md` and
`android-app/README.md` cover each.

**What I found by decompiling `UHF.apk`** (`com.seuic.uhftool` v1.6.22), which
changed the design:

- The broadcast action and extra key in your spec are correct:
  `com.android.server.scannerservice.broadcast` / `scannerdata`.
- **The device ships on Broadcast mode, not Focus** (`sendmode` defaults to 1).
  So out of the box the browser build receives nothing at all, and it looks
  like the reader is broken. That is almost certainly what you were seeing.
- Focus mode sends through a hidden `InputMethodManager.setCommitText`, which
  fires **no key events and no Enter**. Any page waiting for an Enter waits
  forever.
- `com.android.uhf.startscan` and `com.android.uhf.stopscan` exist. **The POS
  can start and stop the radio.** Your spec did not ask for this and it is the
  single biggest thing the APK buys you: a stock take becomes "press Sweep and
  walk the aisles" instead of an hour of holding a trigger.

All four intent strings are user-editable in the UHF app, so the POS can
override them rather than requiring a shop to change them back. Six other
vendors' broadcasts (Chainway, Zebra DataWedge, Honeywell, Newland, Urovo,
iData) are listened for too.

**Also handled:**

- Dynamic API base URL, with a first-launch screen that asks for the shop's
  address once and refuses to save it until `/api/health` answers from it.
- `base: './'` — but only for the Android build (`POS_TARGET=android`). The web
  build keeps absolute paths, because relative ones break a deep route like
  `/products/41` in a browser.
- Hash routing in the app, path routing on the web, same source.
- CORS for `capacitor://localhost` and `http://localhost`.
- `usesCleartextTraffic` and mixed-content allowed, so a shop server on a LAN
  address works.
- The physical trigger key routed to JavaScript, with held-key repeats
  swallowed.
- **Region and power control.** Your handheld ships tuned for FCC 902–928 MHz.
  Nigeria's RAIN RFID allocation is **865.6–867.6 MHz at 2 W ERP** — the ETSI
  band. On the wrong band it is both outside its licence and bad at reading.
  RFID → Reader test now sets this.

`useRfidScan` is the one hook every scanning screen uses. Native broadcast in
either app, keyboard/commit capture in a browser, same callback either way —
the two bridges have completely different shapes (a synchronous
JavascriptInterface versus a promise-based Capacitor plugin) and the hook
normalises both.

---

## 3. Everything else in the list

| section | built | notes |
|---|---|---|
| Tag provisioning, manual pairing | ✅ | RFID → Tag stock, with a manual entry box for a tag the reader will not pick up |
| Batch provisioning | ✅ | Fix a product up front, then scan, scan, scan. Two stations can run the same batch safely — `FOR UPDATE SKIP LOCKED` hands each one a different unit |
| Instant RFID transfers | ✅ | "Scan a box" builds the manifest from what the reader hears, so it cannot disagree with what is in the box |
| Atomic receive | ✅ | Receiving by scan **names the units on the manifest that were not in the box** and leaves them in transit. A quantity receive can only say the count matched; this says the contents did |
| Dual-mode ingestion | ✅ | Scan units, or pick quantities. Both paths still supported |
| High-speed stock-take buffer | ✅ | Already there from V4 — browser-side dedupe, 400 ms batching, one vibration per batch. 300 reads → 20 codes in 2 requests, asserted by a test |
| RFID checkout | ✅ | Sweep a whole basket into the cart. Re-reads do not double-add |
| Multi-tender split payments | ✅ | Already there from V4 — cash, card, transfer, mobile money, store credit, points, in any combination |
| Blind cash-out | ✅ | **The expected figure is withheld at the API, not hidden in the interface.** A cashier's `/sessions/current` simply does not contain it. A till that shows the target before the count is not an audit, it is a target |
| X and Z reports | ✅ | Both stored rather than recomputed. Z numbers are sequential per branch and taken under a row lock, so two tills closing at once cannot both take Z-41 |
| Cash in/out of the drawer | ✅ | A payout with no reason is refused — an unexplained payout is the thing this exists to catch |
| Granular RBAC | ✅ | Role presets, then per-person exceptions. A **deny beats everything**, wildcard included |
| Permission presets | ✅ | Settings → Roles & permissions; per person under Staff → Permissions |
| Feature-toggle matrix | ✅ | Settings → Features. Off means gone from the menu **and refused by the API** |
| Sales-rep commission | ✅ | Revenue, profit or per-unit. One rule pays per line, most specific wins — schemes cannot stack |
| Clawbacks | ✅ | A return writes a negative row referencing the sale, inside the return's own transaction. Nothing is edited, so "why is my commission less" is answerable |
| Multi-branch visibility | ✅ | Per-branch availability, with holds subtracted from what is actually sellable |
| Holds | ✅ | Holds a specific tagged unit where possible, with an expiry |
| Customer credit | ✅ | Credit limits and a block flag on the customer |
| Layaway | ✅ | Plans and instalment schedules |
| WhatsApp / SMS receipts | ✅ | A `wa.me` link with the message pre-written, and a token URL the customer can open with no login. **Deliberately not an SMS gateway** — no API key, no per-message cost, works the first day |
| Deadstock ageing | ✅ | Aged **per physical unit** from when it was received. Ageing by variant makes a monthly-restocked line look young forever while January's three pairs sit unnoticed |
| Quarantine / RTV | ✅ | Out of sellable stock, still a real unit with its history. Four outcomes, all recorded |

### Parent-variant editor with cascade

Built, but narrower than a rewrite. I checked the existing editor before
claiming it already cascaded — it did not. Prices were per-variant with no way
to set them together, which is where people stop and go back to the
spreadsheet when a shoe has forty sizes.

So the variants table now has a **Cost for all / Price for all** bar. It fills
every row at once, and — the part that matters — it counts the rows that
already disagree and offers to leave those alone, so the one size that really
does cost more survives. Nothing is written until you press Save; it only
fills the rows on screen.

I did not rebuild the whole editor around a parent record. That screen is what
your entire catalogue depends on, and replacing it wholesale to gain a
behaviour this bar already gives you is a bad trade. If the cascade rules you
have in mind are different — tax, supplier, reorder point flowing down too —
tell me and I will extend this bar rather than the screen.

---

## 4. Bugs found and fixed while building this

- **The scan hook buffered every read in two places at once** — the hidden
  capture field *and* a keystroke buffer — and emitted whichever wrote last,
  which was a single character. Every stock-take read was being silently
  dropped. Caught by the 300-read sweep test, not by looking.
- **`Layout()` called `feature()` without taking it from `useAuth()`.** Builds
  perfectly, white-screens the entire app at runtime. Same shape as the
  `icon: Tag` bug from V4 — so `check-refs.mjs` now catches this class too,
  scoped per component, and I verified it by reintroducing the bug.
- **`/api/transfers/:id/receive` accepted an `epcs` array and ignored it.** It
  has read that parameter since V4 and never used it.
- **A closing till with a variance needed no explanation.** A variance nobody
  has to explain is a variance nobody looks at.
- **A flaky test** asserting the product search sorts by stock descending. It
  sorts in-stock before out-of-stock, then alphabetically. The assertion passed
  or failed depending on where the seed put its inventory.

---

## 5. What still needs you

**The V4 update never reached Railway.** Your last attempt uploaded
`pos-rfid-system_4.zip` to the repository root as a single binary file — commit
`49dd2f28`, "Add files via upload". GitHub does not unpack a zip, so the source
tree never changed and Railway is still serving commit `f68c6e17` from 17
September. V5 is built on top of a V4 that was never deployed.

I cannot push to your repository: it is private and this session has no access
grant to it, and I will not handle your GitHub credentials. So the new zip has
to go up the way the source tree goes up — **unzip it locally, and upload the
files inside it, not the zip.**

Once that is done, Railway redeploys on its own and the schema applies on boot.

Three other things waiting on you from before:

1. `pos-rfid-system_4.zip` is still sitting in the repository root. Delete it.
2. The unused `pos-rfid-web` Railway service has never deployed and is holding
   two domains. Delete it, or tell me and I will.
3. The live database still holds the V4 demo data. You asked to wipe it after
   testing — it is still there, untouched.

---

## 6. Tests

```
npm test                     252 API checks          0 failed
npm run check:ui              60 screens             0 problems
npm run check:empty           49 screens, blank DB   0 problems
npm run check:sweep          300 reads → 2 requests  PASS
npm run check:commit          SEUIC commit delivery  PASS
npm run check:reader          every reader fault     PASS
npm run check:native          38 Android bridge checks  PASS  (both shells)
npm run check                 build-time reference check
```

The native check stands a fake bridge in front of the app — the same method
names and event shapes the Java sends — and drives the till, the stock take
and the diagnostics through it, twice: once shaped like the plain shell's
JavascriptInterface and once like the Capacitor plugin. Testing one is how the
other quietly stops working.

It cannot prove the Java compiles or that `com.seuic.uhftool` answers; only
your handheld can. It proves everything on this side of the bridge.
