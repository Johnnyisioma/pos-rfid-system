# Version 6 — Phase 4: Documents, Invoice Designer & Notifications

Phase 4 is the last of the four. It gives the shop control over the paper a
customer sees, the messages it sends them, and the files it keeps against a
transaction. With it, the Super ERP is complete.

All green: **321 API tests, 81 UI screens, 66 empty-shop screens, both Android
bridges — 0 failed.**

---

## 1. Invoice & receipt designer

- **Layouts** for each document type — receipt, invoice, quotation, delivery
  note — with a **live preview** that renders a real sale as you edit.
- Design controls: paper size (58/80mm thermal or A4), accent colour, logo,
  header/sub-header/footer, terms text, and toggles for the customer block,
  VAT line, payment breakdown, signature lines and barcode.
- **e-Invoice QR** — turn it on and each rendered document carries a scannable
  QR (generated server-side as inline SVG, no external service) that opens the
  verified receipt.
- One default per document type; "Print styled invoice / receipt" on any sale
  renders it through the chosen layout, ready to print on any device.

## 2. Notification engine (WhatsApp / SMS / Email)

- **Message templates** per event and channel, with placeholders
  (`{name} {invoice} {total} {balance} {link} {shop}`) filled at send time.
- **Provider-agnostic and free on day one**: WhatsApp works immediately through
  a `wa.me` link that opens the shop's own WhatsApp with the message written and
  a login-free receipt link attached — no gateway, no per-message cost. SMS and
  email carry the same link, and a shop that has a gateway points the settings
  at it later with no code change.
- **Auto-on-sale**: optionally queue a receipt message on every sale that has a
  contactable customer.
- **Message log** — every attempt is recorded (queued / sent / failed) so "did
  the customer get their receipt?" has an answer, with a one-tap link to open
  or re-open the message.

## 3. Document attachments & notes

- Attach a **file** (a signed delivery note, a supplier's invoice photo, a
  warranty card scan) or a **note** to any transaction — a sale, a purchase, an
  expense. Shown on the sale page, downloadable, removable.
- Files are stored with the record and streamed back with their real type; the
  list never ships the file bytes, only metadata.

---

## What still needs you

1. **Push the source tree** so Railway redeploys — the schema, the default
   layouts and the message templates seed themselves on boot.
2. New dependency: `qrcode` (for the e-invoice QR) is in `dependencies`; a
   normal install picks it up.
3. The Documents menu is gated by permissions — the designer, templates and
   delivery settings need *settings* permissions; the message log needs
   *sales.read*.
4. Everything from before still applies: delete `pos-rfid-system_4.zip` from the
   repo root, remove the unused `pos-rfid-web` Railway service, and wipe demo
   data after testing (the shipped zip is built from a fresh demo DB — reset it
   or wipe it before going live).

## Tests

```
npm test                 321 API checks         0 failed
npm run check:ui          81 screens            0 problems
npm run check:empty       66 screens, blank DB  0 problems
npm run check:native      Android bridges       PASS (both shells)
npm run check             build-time refs       clean
```
