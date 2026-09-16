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
import syncRoutes from './routes/sync.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(compression());
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
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
app.use('/api/sync', syncRoutes);

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
 * Demo data takes a while to build, so it runs after the server is already
 * listening: a fresh deploy answers its health check straight away and the
 * sample catalogue appears a few seconds later. Set SEED_ON_BOOT=false to
 * skip it entirely.
 */
async function seedIfEmpty() {
  if (process.env.SEED_ON_BOOT === 'false') return;
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n > 0) return;
  console.log('[pos] empty database - loading demo data in the background');
  await import('./db/seed.js');
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
      seedIfEmpty().catch((err) => console.error('[pos] seed failed:', err.message));
    });
  });

const shutdown = () => pool.end().finally(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
