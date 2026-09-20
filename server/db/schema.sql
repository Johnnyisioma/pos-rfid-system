-- ============================================================
--  Multi-Location Retail POS + RFID Inventory System
--  PostgreSQL schema
--  Every stock/sale/movement row is scoped to a location_id.
-- ============================================================

CREATE TABLE IF NOT EXISTS business_settings (
  id                  INT PRIMARY KEY DEFAULT 1,
  name                TEXT NOT NULL DEFAULT 'My Business',
  legal_name          TEXT DEFAULT '',
  tin                 TEXT DEFAULT '',
  rc_number           TEXT DEFAULT '',
  address             TEXT DEFAULT '',
  phone               TEXT DEFAULT '',
  email               TEXT DEFAULT '',
  currency            TEXT NOT NULL DEFAULT 'NGN',
  currency_symbol     TEXT NOT NULL DEFAULT '₦',
  vat_rate            NUMERIC(6,3) NOT NULL DEFAULT 7.5,
  prices_include_vat  BOOLEAN NOT NULL DEFAULT TRUE,
  invoice_prefix      TEXT NOT NULL DEFAULT 'INV',
  invoice_next        BIGINT NOT NULL DEFAULT 1,
  sku_prefix          TEXT NOT NULL DEFAULT 'SKU',
  epc_company_prefix  TEXT NOT NULL DEFAULT '3035',
  receipt_footer      TEXT DEFAULT 'Thank you for your patronage.',
  logo_url            TEXT DEFAULT '',
  loyalty_earn_per    NUMERIC(12,2) NOT NULL DEFAULT 1000,  -- spend this much -> 1 point
  loyalty_point_value NUMERIC(12,2) NOT NULL DEFAULT 10,    -- 1 point worth this much
  loyalty_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  low_stock_default   INT NOT NULL DEFAULT 3,
  fiscal_country      TEXT NOT NULL DEFAULT 'NG',
  einvoice_scheme     TEXT NOT NULL DEFAULT 'FIRS-UBL-3.0',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS locations (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  address     TEXT DEFAULT '',
  phone       TEXT DEFAULT '',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','manager','cashier','inventory')),
  phone         TEXT DEFAULT '',
  max_discount_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_locations (
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, location_id)
);

-- ---------- catalog ----------
CREATE TABLE IF NOT EXISTS brands (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INT REFERENCES categories(id) ON DELETE SET NULL,
  UNIQUE (name, parent_id)
);

CREATE TABLE IF NOT EXISTS variation_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  axis TEXT NOT NULL CHECK (axis IN ('size','color')),
  values_json JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  amount_due NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  sku           TEXT NOT NULL UNIQUE,
  type          TEXT NOT NULL DEFAULT 'single' CHECK (type IN ('single','variable','bundle')),
  brand_id      INT REFERENCES brands(id) ON DELETE SET NULL,
  category_id   INT REFERENCES categories(id) ON DELETE SET NULL,
  sub_category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  unit          TEXT NOT NULL DEFAULT 'pair',
  description   TEXT DEFAULT '',
  image_url     TEXT DEFAULT '',
  tax_rate      NUMERIC(6,3) NOT NULL DEFAULT 7.5,
  reorder_point INT NOT NULL DEFAULT 3,
  track_rfid    BOOLEAN NOT NULL DEFAULT TRUE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    INT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_variants (
  id            SERIAL PRIMARY KEY,
  product_id    INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku           TEXT NOT NULL UNIQUE,
  barcode       TEXT,
  size          TEXT,
  color         TEXT,
  cost_price    NUMERIC(14,2) NOT NULL DEFAULT 0,
  selling_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  reorder_point INT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_variants_barcode ON product_variants(barcode);

CREATE TABLE IF NOT EXISTS bundle_items (
  id SERIAL PRIMARY KEY,
  bundle_variant_id INT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  component_variant_id INT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS location_prices (
  id SERIAL PRIMARY KEY,
  variant_id  INT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  location_id INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  selling_price NUMERIC(14,2) NOT NULL,
  UNIQUE (variant_id, location_id)
);

-- ---------- inventory ----------
CREATE TABLE IF NOT EXISTS inventory (
  variant_id  INT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  location_id INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  quantity    NUMERIC(14,3) NOT NULL DEFAULT 0,
  reorder_point INT,
  PRIMARY KEY (variant_id, location_id)
);

-- One row per PHYSICAL unit. Two identical shoes = two rows = two EPCs.
CREATE TABLE IF NOT EXISTS stock_units (
  id           BIGSERIAL PRIMARY KEY,
  epc          TEXT NOT NULL UNIQUE,
  epc_readable TEXT NOT NULL,
  variant_id   INT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  location_id  INT REFERENCES locations(id) ON DELETE SET NULL,
  serial       BIGINT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'in_stock'
               CHECK (status IN ('in_stock','sold','in_transit','damaged','lost','returned','reserved')),
  cost_price   NUMERIC(14,2) NOT NULL DEFAULT 0,
  tag_encoded  BOOLEAN NOT NULL DEFAULT FALSE,
  encoded_at   TIMESTAMPTZ,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sold_at      TIMESTAMPTZ,
  sale_id      BIGINT,
  last_seen_at TIMESTAMPTZ,
  source_ref   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_units_variant ON stock_units(variant_id);
CREATE INDEX IF NOT EXISTS idx_units_location_status ON stock_units(location_id, status);

CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGSERIAL PRIMARY KEY,
  variant_id  INT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  location_id INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  unit_id     BIGINT REFERENCES stock_units(id) ON DELETE SET NULL,
  type        TEXT NOT NULL,     -- purchase|sale|return|adjustment|transfer_out|transfer_in|opening|stock_take
  quantity    NUMERIC(14,3) NOT NULL,
  balance_after NUMERIC(14,3),
  reference_type TEXT,
  reference_id   BIGINT,
  reason      TEXT,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_movements_created ON stock_movements(created_at DESC);

-- ---------- purchasing ----------
CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  po_number   TEXT NOT NULL UNIQUE,
  supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL,
  location_id INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','partial','received','cancelled')),
  order_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  notes       TEXT DEFAULT '',
  subtotal    NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  total       NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id SERIAL PRIMARY KEY,
  po_id      INT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  variant_id INT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity   NUMERIC(14,3) NOT NULL,
  received_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  unit_cost  NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id SERIAL PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  location_id INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  notes TEXT DEFAULT '',
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_adjustment_items (
  id SERIAL PRIMARY KEY,
  adjustment_id INT NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
  variant_id INT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity_change NUMERIC(14,3) NOT NULL,
  unit_id BIGINT REFERENCES stock_units(id) ON DELETE SET NULL
);

-- ---------- transfers ----------
CREATE TABLE IF NOT EXISTS transfers (
  id SERIAL PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  from_location_id INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  to_location_id   INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_transit','received','cancelled')),
  notes TEXT DEFAULT '',
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  received_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transfer_items (
  id SERIAL PRIMARY KEY,
  transfer_id INT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  variant_id  INT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity    NUMERIC(14,3) NOT NULL,
  received_quantity NUMERIC(14,3) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transfer_units (
  transfer_id INT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  unit_id BIGINT NOT NULL REFERENCES stock_units(id) ON DELETE CASCADE,
  received BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (transfer_id, unit_id)
);

-- ---------- customers ----------
CREATE TABLE IF NOT EXISTS customer_groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  discount_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
  notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT DEFAULT '',
  group_id INT REFERENCES customer_groups(id) ON DELETE SET NULL,
  credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,       -- owed by customer
  store_credit NUMERIC(14,2) NOT NULL DEFAULT 0,
  loyalty_points NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS store_credit_ledger (
  id BIGSERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL,
  type TEXT NOT NULL,
  reference TEXT,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id BIGSERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  points NUMERIC(14,2) NOT NULL,
  type TEXT NOT NULL,
  sale_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- register / till ----------
CREATE TABLE IF NOT EXISTS registers (
  id SERIAL PRIMARY KEY,
  location_id INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS register_sessions (
  id SERIAL PRIMARY KEY,
  register_id INT NOT NULL REFERENCES registers(id) ON DELETE CASCADE,
  location_id INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_cash NUMERIC(14,2) NOT NULL DEFAULT 0,
  counted_cash NUMERIC(14,2),
  expected_cash NUMERIC(14,2),
  difference NUMERIC(14,2),
  notes TEXT DEFAULT '',
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

-- ---------- sales ----------
CREATE TABLE IF NOT EXISTS sales (
  id BIGSERIAL PRIMARY KEY,
  invoice_no TEXT UNIQUE,
  invoice_seq BIGINT,
  location_id INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
  register_session_id INT REFERENCES register_sessions(id) ON DELETE SET NULL,
  sale_type TEXT NOT NULL DEFAULT 'sale' CHECK (sale_type IN ('sale','quotation','layaway')),
  status TEXT NOT NULL DEFAULT 'completed'
         CHECK (status IN ('completed','held','draft','quotation','refunded','partially_refunded','cancelled','layaway')),
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_type TEXT DEFAULT 'fixed',
  discount_value NUMERIC(14,2) DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  change_due NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_due NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_credit BOOLEAN NOT NULL DEFAULT FALSE,
  points_earned NUMERIC(14,2) NOT NULL DEFAULT 0,
  points_redeemed NUMERIC(14,2) NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  hold_label TEXT,
  client_uuid TEXT UNIQUE,        -- offline idempotency key
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_location_status ON sales(location_id, status);

CREATE TABLE IF NOT EXISTS sale_items (
  id BIGSERIAL PRIMARY KEY,
  sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  variant_id INT REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  variant_label TEXT DEFAULT '',
  sku TEXT,
  quantity NUMERIC(14,3) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(6,3) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL,
  cost_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  returned_quantity NUMERIC(14,3) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sale_item_units (
  sale_item_id BIGINT NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
  unit_id BIGINT NOT NULL REFERENCES stock_units(id) ON DELETE CASCADE,
  PRIMARY KEY (sale_item_id, unit_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  sale_id BIGINT REFERENCES sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('cash','card','transfer','mobile_money','store_credit','credit','points')),
  amount NUMERIC(14,2) NOT NULL,
  reference TEXT,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sale_returns (
  id BIGSERIAL PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  original_sale_id BIGINT REFERENCES sales(id) ON DELETE SET NULL,
  exchange_sale_id BIGINT REFERENCES sales(id) ON DELETE SET NULL,
  location_id INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'refund' CHECK (type IN ('refund','exchange')),
  total_refund NUMERIC(14,2) NOT NULL DEFAULT 0,
  refund_method TEXT NOT NULL DEFAULT 'cash',
  reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sale_return_items (
  id BIGSERIAL PRIMARY KEY,
  return_id BIGINT NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_item_id BIGINT REFERENCES sale_items(id) ON DELETE SET NULL,
  variant_id INT REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity NUMERIC(14,3) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  refund_amount NUMERIC(14,2) NOT NULL,
  restock BOOLEAN NOT NULL DEFAULT TRUE,
  unit_id BIGINT REFERENCES stock_units(id) ON DELETE SET NULL
);

-- ---------- stock take (RFID cycle count) ----------
CREATE TABLE IF NOT EXISTS stock_takes (
  id SERIAL PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  location_id INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'full',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reconciled','cancelled')),
  notes TEXT DEFAULT '',
  started_by INT REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  expected_count INT DEFAULT 0,
  found_count INT DEFAULT 0,
  missing_count INT DEFAULT 0,
  unexpected_count INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_take_scans (
  id BIGSERIAL PRIMARY KEY,
  stock_take_id INT NOT NULL REFERENCES stock_takes(id) ON DELETE CASCADE,
  epc TEXT NOT NULL,
  unit_id BIGINT REFERENCES stock_units(id) ON DELETE SET NULL,
  result TEXT NOT NULL,   -- found|unexpected|unknown|duplicate|wrong_location
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stock_take_id, epc)
);

-- ---------- finance ----------
CREATE TABLE IF NOT EXISTS expense_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  location_id INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  category_id INT REFERENCES expense_categories(id) ON DELETE SET NULL,
  amount NUMERIC(14,2) NOT NULL,
  note TEXT DEFAULT '',
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- audit ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT,
  action TEXT NOT NULL,           -- create|update|delete|login|void|...
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  location_id INT,
  details JSONB DEFAULT '{}',
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

-- ---------- hardware / device registry ----------
CREATE TABLE IF NOT EXISTS devices (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('rfid_printer','rfid_reader','barcode_printer','receipt_printer')),
  location_id INT REFERENCES locations(id) ON DELETE SET NULL,
  driver TEXT NOT NULL DEFAULT 'zebra_zpl_tcp',  -- zebra_zpl_tcp | http_agent | keyboard_wedge | http_post
  host TEXT,
  port INT DEFAULT 9100,
  config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS print_jobs (
  id BIGSERIAL PRIMARY KEY,
  device_id INT REFERENCES devices(id) ON DELETE SET NULL,
  unit_id BIGINT REFERENCES stock_units(id) ON DELETE SET NULL,
  epc TEXT,
  payload TEXT,             -- the exact ZPL sent to the printer
  status TEXT NOT NULL DEFAULT 'queued',  -- queued|sent|failed
  error TEXT,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scan_events (
  id BIGSERIAL PRIMARY KEY,
  epc TEXT NOT NULL,
  unit_id BIGINT REFERENCES stock_units(id) ON DELETE SET NULL,
  location_id INT REFERENCES locations(id) ON DELETE SET NULL,
  device_id INT REFERENCES devices(id) ON DELETE SET NULL,
  context TEXT NOT NULL DEFAULT 'lookup',  -- lookup|checkout|stock_take|receive|find
  rssi NUMERIC(8,2),
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scan_events_created ON scan_events(created_at DESC);

INSERT INTO business_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ============================================================
--  Incremental upgrades
--  CREATE TABLE IF NOT EXISTS never adds columns to a table that
--  already exists, so every change after the first release is an
--  idempotent ALTER here. schema.sql runs on every boot.
-- ============================================================

-- Receipt appearance + the window in which a sale may still be amended
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS receipt_font_size  INT     NOT NULL DEFAULT 12;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS receipt_paper      TEXT    NOT NULL DEFAULT '80mm';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS receipt_show_logo  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS logo_width_mm      INT     NOT NULL DEFAULT 30;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS sale_edit_window_days INT  NOT NULL DEFAULT 30;

-- Amendment trail on a sale
ALTER TABLE sales ADD COLUMN IF NOT EXISTS edited_at  TIMESTAMPTZ;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS edited_by  INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS edit_count INT NOT NULL DEFAULT 0;

-- Full before/after snapshot of every amendment, kept forever
CREATE TABLE IF NOT EXISTS sale_revisions (
  id          BIGSERIAL PRIMARY KEY,
  sale_id     BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  revision    INT NOT NULL,
  reason      TEXT NOT NULL,
  before_json JSONB NOT NULL,
  after_json  JSONB NOT NULL,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  user_name   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sale_revisions_sale ON sale_revisions(sale_id);

-- ============================================================
--  Tranche A — trading core
--  Payment accounts, multiple tax rates, purchase returns.
-- ============================================================

-- A4 · Where money actually lands: the till, a bank account, an Opay or
--      Moniepoint wallet, a POS terminal's settlement account.
CREATE TABLE IF NOT EXISTS payment_accounts (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'bank'
                  CHECK (type IN ('cash','bank','mobile_money','card_terminal','other')),
  account_number  TEXT DEFAULT '',
  bank_name       TEXT DEFAULT '',
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  location_id     INT REFERENCES locations(id) ON DELETE SET NULL,
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS account_id INT REFERENCES payment_accounts(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS account_id INT REFERENCES payment_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_payments_account ON payments(account_id);

-- Which account a tender type defaults to, so a cashier never has to choose.
CREATE TABLE IF NOT EXISTS payment_method_accounts (
  method      TEXT PRIMARY KEY,
  account_id  INT REFERENCES payment_accounts(id) ON DELETE SET NULL
);

-- A5 · A supermarket rings VAT-able and exempt lines on the same receipt.
CREATE TABLE IF NOT EXISTS tax_rates (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  rate       NUMERIC(6,3) NOT NULL DEFAULT 0,
  is_exempt  BOOLEAN NOT NULL DEFAULT FALSE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_rate_id INT REFERENCES tax_rates(id) ON DELETE SET NULL;

-- A1 · Sending bad goods back to the supplier. Without this, damage leaves as a
--      stock adjustment and quietly becomes shrinkage.
CREATE TABLE IF NOT EXISTS purchase_returns (
  id            SERIAL PRIMARY KEY,
  ref           TEXT NOT NULL UNIQUE,
  po_id         INT REFERENCES purchase_orders(id) ON DELETE SET NULL,
  supplier_id   INT REFERENCES suppliers(id) ON DELETE SET NULL,
  location_id   INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL,
  notes         TEXT DEFAULT '',
  total         NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit_note   TEXT DEFAULT '',
  user_id       INT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_return_items (
  id          BIGSERIAL PRIMARY KEY,
  return_id   INT NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  variant_id  INT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity    NUMERIC(14,3) NOT NULL,
  unit_cost   NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total  NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchase_return_units (
  return_id INT NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  unit_id   BIGINT NOT NULL REFERENCES stock_units(id) ON DELETE CASCADE,
  PRIMARY KEY (return_id, unit_id)
);

-- a unit sent back to the supplier leaves stock without becoming shrinkage
ALTER TABLE stock_units DROP CONSTRAINT IF EXISTS stock_units_status_check;
ALTER TABLE stock_units ADD CONSTRAINT stock_units_status_check
  CHECK (status IN ('in_stock','sold','in_transit','damaged','lost','returned','reserved','returned_supplier'));

-- seed the two tax rates every Nigerian retailer needs
INSERT INTO tax_rates (name, rate, is_exempt, is_default)
SELECT 'VAT 7.5%', 7.5, FALSE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM tax_rates);
INSERT INTO tax_rates (name, rate, is_exempt, is_default)
SELECT 'VAT exempt', 0, TRUE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM tax_rates WHERE is_exempt);

-- and a till account so a cash payment has somewhere to land from day one
INSERT INTO payment_accounts (name, type, is_default)
SELECT 'Cash till', 'cash', TRUE
WHERE NOT EXISTS (SELECT 1 FROM payment_accounts);

-- Map cash to that till, and nothing else. Transfers, cards and wallets stay
-- unmapped on purpose: the shop's bank and Opay accounts are its own to add,
-- and an unassigned transfer is visible in the Money in & out report, whereas
-- a transfer quietly banked into the cash till is not.
INSERT INTO payment_method_accounts (method, account_id)
SELECT 'cash', id FROM payment_accounts
 WHERE type = 'cash' AND is_default
   AND NOT EXISTS (SELECT 1 FROM payment_method_accounts)
 ORDER BY id LIMIT 1;


-- ═══════════════════════════════════════════════════════════════════════════
--  VERSION 5
--
--  The V5 specification was written as SQLite DDL (TEXT primary keys, REAL,
--  DATETIME, BOOLEAN DEFAULT 0) against a blank database. This system is
--  PostgreSQL 16 with integer keys, NUMERIC(14,2) money and TIMESTAMPTZ, and
--  it is already holding a shop's real sales, transfers and stock counts.
--
--  Running that DDL literally would have dropped every foreign key and taken
--  the data with it. So V5 is mapped onto what is here instead:
--
--    spec table        what it actually is here
--    ──────────────    ───────────────────────────────────────────────────
--    rfid_tags         stock_units — already one row per physical item, with
--                      sales history, transfers and stock-take scans hanging
--                      off it. Exposed below as a VIEW under the spec's name.
--    register_shifts   register_sessions, extended with the blind-count and
--                      X/Z-report columns. Also exposed as a VIEW.
--    locations         already exists, SERIAL not TEXT
--    products          already exists, with product_variants beneath it
--
--  Everything genuinely new gets a real table. Every statement is idempotent,
--  so this file stays safe to run on every boot.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------- the licence-plate model ----------
-- An EPC is a licence plate: it identifies ONE physical item and says nothing
-- about what that item is. Everything else is looked up from it. These columns
-- record where a plate came from, because a factory-encoded 128-bit tag and one
-- this system minted behave differently when reprinting or auditing.
ALTER TABLE stock_units ADD COLUMN IF NOT EXISTS epc_bits      INT;
ALTER TABLE stock_units ADD COLUMN IF NOT EXISTS minted_by_us  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE stock_units ADD COLUMN IF NOT EXISTS tag_source    TEXT NOT NULL DEFAULT 'minted'
  CHECK (tag_source IN ('minted','factory','manual','imported'));
ALTER TABLE stock_units ADD COLUMN IF NOT EXISTS paired_at     TIMESTAMPTZ;
ALTER TABLE stock_units ADD COLUMN IF NOT EXISTS paired_by     INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE stock_units ADD COLUMN IF NOT EXISTS quarantine_reason TEXT;
ALTER TABLE stock_units ADD COLUMN IF NOT EXISTS held_for_sale_id BIGINT;
UPDATE stock_units SET epc_bits = length(epc) * 4 WHERE epc_bits IS NULL;

-- A unit can now sit in quarantine awaiting a decision, or be held for a
-- customer at another branch, without leaving stock or being counted as sold.
ALTER TABLE stock_units DROP CONSTRAINT IF EXISTS stock_units_status_check;
ALTER TABLE stock_units ADD CONSTRAINT stock_units_status_check
  CHECK (status IN ('in_stock','sold','in_transit','damaged','lost','returned',
                    'reserved','returned_supplier','quarantined','held'));

-- Every plate ever seen, including ones that turned up on a sweep and belong to
-- nothing. Reading an unknown tag is information, not an error.
CREATE TABLE IF NOT EXISTS tag_sightings (
  id           BIGSERIAL PRIMARY KEY,
  epc          TEXT NOT NULL,
  unit_id      BIGINT REFERENCES stock_units(id) ON DELETE SET NULL,
  location_id  INT REFERENCES locations(id) ON DELETE SET NULL,
  device_id    INT REFERENCES devices(id) ON DELETE SET NULL,
  context      TEXT NOT NULL DEFAULT 'sweep',   -- sweep|checkout|transfer|stock_take|provision|lookup
  rssi         INT,
  user_id      INT REFERENCES users(id) ON DELETE SET NULL,
  seen_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sightings_epc  ON tag_sightings(epc);
CREATE INDEX IF NOT EXISTS idx_sightings_seen ON tag_sightings(seen_at DESC);

-- A provisioning run: "I am about to pair 40 blank labels to this variant."
CREATE TABLE IF NOT EXISTS tag_batches (
  id          SERIAL PRIMARY KEY,
  ref         TEXT NOT NULL UNIQUE,
  variant_id  INT REFERENCES product_variants(id) ON DELETE SET NULL,
  location_id INT REFERENCES locations(id) ON DELETE SET NULL,
  mode        TEXT NOT NULL DEFAULT 'pair' CHECK (mode IN ('pair','mint','import')),
  planned     INT NOT NULL DEFAULT 0,
  provisioned INT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  notes       TEXT DEFAULT '',
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at   TIMESTAMPTZ
);
ALTER TABLE stock_units ADD COLUMN IF NOT EXISTS tag_batch_id INT REFERENCES tag_batches(id) ON DELETE SET NULL;

-- The spec's rfid_tags table, as a view. Anything written against the spec's
-- names keeps working; there is still exactly one row per physical item.
CREATE OR REPLACE VIEW rfid_tags AS
  SELECT u.epc              AS epc,
         u.id               AS unit_id,
         u.variant_id       AS variant_id,
         u.location_id      AS location_id,
         u.status           AS status,
         u.epc_readable     AS license_plate,
         u.epc_bits         AS bits,
         u.tag_source       AS source,
         u.minted_by_us     AS minted_by_us,
         u.cost_price       AS cost_price,
         u.received_at      AS received_at,
         u.last_seen_at     AS last_seen_at,
         u.sold_at          AS sold_at,
         u.sale_id          AS sale_id
    FROM stock_units u;

-- ---------- shifts: blind cash-out, X and Z reports ----------
ALTER TABLE register_sessions ADD COLUMN IF NOT EXISTS blind_count      BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE register_sessions ADD COLUMN IF NOT EXISTS counted_at       TIMESTAMPTZ;
ALTER TABLE register_sessions ADD COLUMN IF NOT EXISTS counted_by       INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE register_sessions ADD COLUMN IF NOT EXISTS denominations    JSONB;
ALTER TABLE register_sessions ADD COLUMN IF NOT EXISTS variance_reason  TEXT;
ALTER TABLE register_sessions ADD COLUMN IF NOT EXISTS approved_by      INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE register_sessions ADD COLUMN IF NOT EXISTS approved_at      TIMESTAMPTZ;
ALTER TABLE register_sessions ADD COLUMN IF NOT EXISTS z_number         BIGINT;
ALTER TABLE register_sessions ADD COLUMN IF NOT EXISTS cash_in          NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE register_sessions ADD COLUMN IF NOT EXISTS cash_out         NUMERIC(14,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE VIEW register_shifts AS
  SELECT s.id, s.register_id, s.location_id, s.user_id, s.status,
         s.opening_cash, s.counted_cash, s.expected_cash, s.difference,
         s.blind_count, s.z_number, s.opened_at, s.closed_at
    FROM register_sessions s;

-- Cash movements that are not sales: a float top-up, a payout, a drop to safe.
CREATE TABLE IF NOT EXISTS register_cash_movements (
  id          BIGSERIAL PRIMARY KEY,
  session_id  INT NOT NULL REFERENCES register_sessions(id) ON DELETE CASCADE,
  direction   TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reason      TEXT NOT NULL DEFAULT '',
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- An X report is a snapshot taken mid-shift; a Z report is the one at close.
-- Both are stored because "what did the till say at 4pm" is a question that
-- gets asked after the fact, and a re-computed answer is not the same answer.
CREATE TABLE IF NOT EXISTS register_reports (
  id          BIGSERIAL PRIMARY KEY,
  session_id  INT NOT NULL REFERENCES register_sessions(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('X','Z')),
  seq         BIGINT,
  payload     JSONB NOT NULL,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reg_reports_session ON register_reports(session_id, created_at DESC);

-- ---------- granular permissions ----------
-- Roles stay as presets. These are the exceptions on top of them, which is how
-- a real shop works: the senior cashier may void a sale, the junior may not,
-- and neither of them is a manager.
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  effect     TEXT NOT NULL DEFAULT 'grant' CHECK (effect IN ('grant','deny')),
  granted_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission)
);

-- Whole areas a shop simply does not use. Off here means gone from the menu,
-- not greyed out, and the API refuses it too.
CREATE TABLE IF NOT EXISTS feature_flags (
  id          SERIAL PRIMARY KEY,
  key         TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  location_id INT REFERENCES locations(id) ON DELETE CASCADE,
  updated_by  INT REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- An earlier shape of this table made `key` the primary key, which allowed
-- exactly one row per feature and therefore no per-branch exceptions. Move it
-- across if that is what is in the database.
ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS id SERIAL;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'feature_flags_pkey'
       AND conrelid = 'feature_flags'::regclass
       AND (SELECT array_agg(attname::text ORDER BY attname) FROM pg_attribute
             WHERE attrelid = conrelid AND attnum = ANY(conkey)) = ARRAY['key']::text[]
  ) THEN
    ALTER TABLE feature_flags DROP CONSTRAINT feature_flags_pkey;
    ALTER TABLE feature_flags ADD PRIMARY KEY (id);
  END IF;
END $$;

-- One row per key business-wide, and at most one per key per branch. A plain
-- UNIQUE(key, location_id) would not do it: in SQL two NULLs are not equal, so
-- the business-wide row could be inserted over and over.
CREATE UNIQUE INDEX IF NOT EXISTS uq_feature_flags_scope
  ON feature_flags (key, COALESCE(location_id, 0));

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_sales_rep   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active      BOOLEAN NOT NULL DEFAULT TRUE;

-- ---------- sales-rep commission ----------
CREATE TABLE IF NOT EXISTS commission_rules (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all','category','brand','product')),
  scope_id    INT,
  basis       TEXT NOT NULL DEFAULT 'revenue' CHECK (basis IN ('revenue','profit','unit')),
  rate        NUMERIC(8,3) NOT NULL DEFAULT 0,   -- percent, or naira per unit when basis='unit'
  user_id     INT REFERENCES users(id) ON DELETE CASCADE,  -- NULL = applies to every rep
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per earning or clawback. A return does not edit the original row;
-- it writes a negative one, so the ledger explains itself.
CREATE TABLE IF NOT EXISTS commission_entries (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sale_id     BIGINT REFERENCES sales(id) ON DELETE SET NULL,
  return_id   BIGINT REFERENCES sale_returns(id) ON DELETE SET NULL,
  rule_id     INT REFERENCES commission_rules(id) ON DELETE SET NULL,
  basis_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount      NUMERIC(14,2) NOT NULL DEFAULT 0,   -- negative on a clawback
  kind        TEXT NOT NULL DEFAULT 'earned' CHECK (kind IN ('earned','clawback','adjustment','paid')),
  period      DATE,
  note        TEXT DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commission_user ON commission_entries(user_id, created_at DESC);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS sales_rep_id INT REFERENCES users(id) ON DELETE SET NULL;

-- ---------- customer credit and layaway ----------
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit   NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_blocked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS whatsapp       TEXT;

CREATE TABLE IF NOT EXISTS layaway_plans (
  id           SERIAL PRIMARY KEY,
  sale_id      BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  customer_id  INT REFERENCES customers(id) ON DELETE SET NULL,
  deposit      NUMERIC(14,2) NOT NULL DEFAULT 0,
  instalments  INT NOT NULL DEFAULT 1,
  every_days   INT NOT NULL DEFAULT 30,
  due_date     DATE,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled','defaulted')),
  created_by   INT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS layaway_instalments (
  id         SERIAL PRIMARY KEY,
  plan_id    INT NOT NULL REFERENCES layaway_plans(id) ON DELETE CASCADE,
  seq        INT NOT NULL,
  due_date   DATE NOT NULL,
  amount     NUMERIC(14,2) NOT NULL,
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_at    TIMESTAMPTZ,
  UNIQUE (plan_id, seq)
);

-- ---------- cross-branch holds ----------
-- "They have it at Ikeja" is only useful if you can stop someone else selling
-- it in the four hours it takes to get there.
CREATE TABLE IF NOT EXISTS stock_holds (
  id          SERIAL PRIMARY KEY,
  ref         TEXT NOT NULL UNIQUE,
  variant_id  INT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  unit_id     BIGINT REFERENCES stock_units(id) ON DELETE SET NULL,
  location_id INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  quantity    NUMERIC(14,3) NOT NULL DEFAULT 1,
  customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
  for_location_id INT REFERENCES locations(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','collected','released','expired','transferred')),
  note        TEXT DEFAULT '',
  expires_at  TIMESTAMPTZ,
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_holds_variant ON stock_holds(variant_id, status);

-- ---------- quarantine / return to vendor ----------
CREATE TABLE IF NOT EXISTS quarantine_items (
  id          BIGSERIAL PRIMARY KEY,
  unit_id     BIGINT REFERENCES stock_units(id) ON DELETE SET NULL,
  variant_id  INT REFERENCES product_variants(id) ON DELETE SET NULL,
  location_id INT REFERENCES locations(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL,        -- damaged|wrong_item|customer_return|supplier_fault|other
  detail      TEXT DEFAULT '',
  outcome     TEXT NOT NULL DEFAULT 'pending'
              CHECK (outcome IN ('pending','returned_to_stock','returned_to_vendor','written_off','repaired')),
  purchase_return_id INT REFERENCES purchase_returns(id) ON DELETE SET NULL,
  photo_url   TEXT,
  raised_by   INT REFERENCES users(id) ON DELETE SET NULL,
  resolved_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- ---------- digital receipts ----------
CREATE TABLE IF NOT EXISTS receipt_deliveries (
  id         BIGSERIAL PRIMARY KEY,
  sale_id    BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  channel    TEXT NOT NULL CHECK (channel IN ('whatsapp','sms','email','link','print')),
  address    TEXT,
  token      TEXT UNIQUE,
  status     TEXT NOT NULL DEFAULT 'prepared'
             CHECK (status IN ('prepared','opened','sent','failed')),
  opened_at  TIMESTAMPTZ,
  user_id    INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_receipt_deliv_sale ON receipt_deliveries(sale_id);

-- ---------- the Android app ----------
-- A handheld is a device the shop owns, not a browser session. Recording it
-- means a stock count can say which gun it came from, and a lost handheld can
-- be cut off without changing anyone's password.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS platform      TEXT;      -- android|web|printer
ALTER TABLE devices ADD COLUMN IF NOT EXISTS app_version   TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS android_id    TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_seen_at  TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS reader_model  TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS rf_power      INT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS rf_region     TEXT;

-- Defaults for a Nigerian shop: RAIN RFID here is 865.6–867.6 MHz at 2 W ERP
-- (the ETSI band). The handheld ships configured for FCC 902–928 MHz, which is
-- someone else's spectrum. This is the value the app pushes to the reader.
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS rfid_region    TEXT NOT NULL DEFAULT 'ETSI_NG';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS rfid_power     INT  NOT NULL DEFAULT 26;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS public_base_url TEXT;

-- ---------- deadstock ----------
-- Nothing new to store: age is received_at, movement is stock_movements. The
-- view exists so the report is one query rather than a page of joins.
CREATE OR REPLACE VIEW deadstock_units AS
  SELECT u.id, u.epc, u.epc_readable, u.variant_id, u.location_id, u.cost_price,
         u.received_at,
         GREATEST(0, DATE_PART('day', now() - u.received_at))::INT AS days_held,
         u.last_seen_at
    FROM stock_units u
   WHERE u.status = 'in_stock';
