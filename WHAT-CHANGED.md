# Update — receipt logo & sizing, amendable receipts, grouped menu

Drop these files over the top of the existing repository, keeping the folder
structure exactly as it is here. Nothing else needs to change; Railway rebuilds
and redeploys on the push, and the new database columns are added automatically
on the next boot.

## Files in this archive

| File | Change |
|---|---|
| `server/db/schema.sql` | **new columns** — receipt font/paper/logo width, the edit window, the amendment trail on `sales`, and the `sale_revisions` table. Added as idempotent `ALTER TABLE … IF NOT EXISTS`, so it upgrades your live database in place without touching existing data. |
| `server/routes/sales.js` | the amendment engine: `PUT /api/sales/:id`, `GET /api/sales/:id/editable`, `GET /api/sales/:id/revisions`, plus the logo and print sizing on the receipt payload. |
| `server/routes/settings.js` | the new settings fields are accepted by `PUT /api/settings`. |
| `client/src/components/Layout.jsx` | the grouped, collapsible sidebar. |
| `client/src/components/Receipt.jsx` | logo, chosen font size, chosen paper width, amended marker. |
| `client/src/index.css` | the print stylesheet now reads the paper size and font size you set. |
| `client/src/lib/useTabParam.js` | **new** — keeps the open tab in the URL so the sidebar can link to a sub-page. |
| `client/src/pages/Settings.jsx` | the new **Receipt & invoice** tab: logo upload, print size, edit window, live preview. |
| `client/src/pages/SaleDetail.jsx` | the **Edit sale** button, the amendment form and the before/after history. |
| `client/src/pages/POS.jsx` | the offline receipt carries the logo and sizing too. |
| `client/src/pages/Inventory.jsx`, `Purchases.jsx`, `Customers.jsx`, `Reports.jsx`, `Returns.jsx` | tabs read from the URL, so sidebar links land on the right one. |
| `scripts/e2e.js` | 18 new API checks covering amendments and receipt settings (97 total). |
| `scripts/ui-check.mjs` | the browser pass now covers 34 screens and sub-tabs. |
| `README.md` | documents all of the above. |

## After it deploys

1. **Settings → Receipt & invoice** — upload your logo, set the paper size and
   font size. The preview on the right is exactly what prints.
2. The edit window defaults to **30 days**. Set it to `0` to switch off editing
   of issued receipts entirely.
3. Only Administrators and Managers can edit an issued receipt. Cashiers cannot,
   and the API refuses them even if the button were reachable.

## One thing to decide

Altering an issued VAT invoice may require a credit note under Nigerian rules
rather than an in-place edit. The system keeps a full evidence trail either way
— every version, who changed it, when and why — but how you are expected to
correct invoices is a question for your tax adviser.
