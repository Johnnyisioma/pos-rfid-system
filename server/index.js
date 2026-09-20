import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { pool } from './db/index.js';
import { requireAuth } from './middleware/auth.js';

import authRoutes from './routes/auth.js';
import settingsRoutes from './routes/settings.js';
import locationRoutes from './routes/locations.js';
import userRoutes from './routes/users.js';
import catalogRoutes from './routes/catalog.js';
import productRoutes from './routes/products.js';
import importExportRoutes from './routes/import-export.js';
import inventoryRoutes from './routes/inventory.js';
import rfidRoutes from './routes/rfid.js';
import supplierRoutes from './routes/suppliers.js';
import purchaseRoutes from './routes/purchases.js';
import transferRoutes from './routes/transfers.js';
import customerRoutes from './routes/customers.js';
import saleRoutes from './routes/sales.js';
import returnRoutes from './routes/returns.js';
import registerRoutes from './routes/registers.js';
import expenseRoutes from './routes/expenses.js';
import reportRoutes from './routes/reports.js';
import auditRoutes from './routes/audit.js';
import deviceRoutes from './routes/devices.js';
import accountRoutes from './routes/accounts.js';
import syncRoutes from './routes/sync.js';
// v5
import quarantineRoutes from './routes/quarantine.js';
import commissionRoutes from './routes/commissions.js';
import holdRoutes from './routes/holds.js';
import receiptRoutes, { publicReceiptRouter } from './routes/receipts.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(compression());
/**
 * CORS.
 *
 * The web app is same-origin and needs none of this. The Android app does: its
 * pages are served from inside the APK, so every request it makes is
 * cross-origin from http://localhost or capacitor://localhost. Those two are
 * always allowed — they are the app itself, not a third-party site.
 *
 * Set CORS_ORIGIN to lock everything else down to a named list; left unset,
 * other origins are reflected, which is the right default while a shop is
 * still moving between a Railway URL and its own domain.
 */
const NATIVE_ORIGINS = [
  'capacitor://localhost', 'ionic://localhost',
  'http://localhost', 'https://localhost',
];
const allowList = (process.env.CORS_ORIGIN || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

app.use(cors({
  credentials: true,
  origin(origin, cb) {
    if (!origin) return cb(null, true);                    // curl, health checks, same-origin
    if (NATIVE_ORIGINS.includes(origin)) return cb(null, true);
    if (!allowList.length) return cb(null, true);
    return cb(allowList.includes(origin) ? null : new Error(`Origin ${origin} is not allowed`),
      allowList.includes(origin));
  },
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Location-Id', 'X-Device-Id', 'X-App-Version'],
  exposedHeaders: ['X-Invoice-No'],
}));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.get('/api/health', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT now() AS time');
    res.json({ ok: true, time: rows[0].time, version: '1.0.0' });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

// Public
app.use('/api/auth', authRoutes);

/*
  A customer's receipt link.

  Public on purpose and mounted above requireAuth: the person holding the link
  is a customer with no login, and the token in the URL is the only thing that
  grants it. It exposes one sale and nothing else.
*/
app.use('/api/r', publicReceiptRouter());

// Everything below needs a valid session
app.use('/api', requireAuth);
app.use('/api/settings', settingsRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/products', productRoutes);
app.use('/api/io', importExportRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/rfid', rfidRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/transfers', transferRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/returns', returnRoutes);
app.use('/api/registers', registerRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/quarantine', quarantineRoutes);
app.use('/api/commissions', commissionRoutes);
app.use('/api/holds', holdRoutes);
app.use('/api/receipts', receiptRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown endpoint' }));

// ---- static client (built PWA) ----
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('sw.js') || filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (/\.[0-9a-f]{8,}\./.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    })
  );
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
} else {
  app.get('/', (req, res) =>
    res.status(200).send('<h1>POS API is running</h1><p>Client not built yet. Run <code>npm run build</code>.</p>')
  );
}

// ---- error handler ----
app.use((err, req, res, next) => { // eslint-disable-line
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    error: err.message || 'Server error',
    ...(err.details ? { details: err.details } : {}),
  });
});

async function applySchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('[pos] schema ready');
}

/**
 * First-run setup. Creates only the real skeleton — a location, a register, an
 * admin login and the reference lists — never sample products, stock or sales.
 * Safe on every boot: each step is skipped when it already exists.
 */
async function runBootstrap() {
  const { bootstrap } = await import('./db/bootstrap.js');
  await bootstrap();
}

// Every statement in schema.sql is CREATE ... IF NOT EXISTS, so this is safe
// to run on every deploy.
applySchema()
  .catch((err) => {
    console.error('[pos] could not apply the schema:', err.message);
    console.error('[pos] check DATABASE_URL - the API will start but every request will fail');
  })
  .finally(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[pos] listening on :${PORT}`);
      runBootstrap().catch((err) => console.error('[pos] bootstrap failed:', err.message));
    });
  });

const shutdown = () => pool.end().finally(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
