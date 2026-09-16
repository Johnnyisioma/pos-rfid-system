/**
 * Offline support for the till.
 *
 *  - `snapshot`      : catalog / prices / stock / customers cached in IndexedDB
 *                      so the POS screen still works with no connection.
 *  - `queue`         : sales completed offline, each stamped with a client_uuid
 *                      so replaying them can never create a duplicate.
 *  - `flushQueue()`  : posts the queue to /api/sync/sales when back online.
 */
import { api } from './api.js';

const DB_NAME = 'pos-offline';
const DB_VERSION = 1;
const STORE_QUEUE = 'sale_queue';
const STORE_CACHE = 'cache';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_QUEUE))
        db.createObjectStore(STORE_QUEUE, { keyPath: 'client_uuid' });
      if (!db.objectStoreNames.contains(STORE_CACHE))
        db.createObjectStore(STORE_CACHE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function withStore(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const os = tx.objectStore(store);
    const result = fn(os);
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
  });
}

export const uuid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/* ---------------- cached snapshot ---------------- */
export async function saveSnapshot(data) {
  return withStore(STORE_CACHE, 'readwrite', (os) =>
    os.put({ key: 'snapshot', data, saved_at: Date.now() }));
}

export async function loadSnapshot() {
  const row = await withStore(STORE_CACHE, 'readonly', (os) => os.get('snapshot'));
  return row?.data || null;
}

export async function refreshSnapshot() {
  try {
    const data = await api.get('/api/sync/snapshot');
    if (!data?._offline) await saveSnapshot(data);
    return data;
  } catch {
    return loadSnapshot();
  }
}

/* ---------------- offline sale queue ---------------- */
export async function queueSale(sale) {
  const record = { ...sale, client_uuid: sale.client_uuid || uuid(), queued_at: Date.now() };
  await withStore(STORE_QUEUE, 'readwrite', (os) => os.put(record));
  requestSync();
  return record;
}

export async function queuedSales() {
  return withStore(STORE_QUEUE, 'readonly', (os) => os.getAll());
}

export async function queueCount() {
  return withStore(STORE_QUEUE, 'readonly', (os) => os.count());
}

async function removeQueued(uuids) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    const os = tx.objectStore(STORE_QUEUE);
    uuids.forEach((u) => os.delete(u));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

let flushing = false;

export async function flushQueue() {
  if (flushing || !navigator.onLine) return { synced: 0, skipped: true };
  const sales = await queuedSales();
  if (!sales.length) return { synced: 0 };
  flushing = true;
  try {
    const res = await api.post('/api/sync/sales', { sales });
    const done = (res.results || [])
      .filter((r) => r.status === 'synced' || r.status === 'duplicate')
      .map((r) => r.client_uuid);
    if (done.length) await removeQueued(done);
    return res;
  } catch (err) {
    return { synced: 0, error: err.message };
  } finally {
    flushing = false;
  }
}

export function requestSync() {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready
      .then((reg) => reg.sync.register('flush-sales'))
      .catch(() => {});
  }
}

/* ---------------- wiring ---------------- */
export function initOffline(onChange) {
  const report = async () => {
    const count = await queueCount().catch(() => 0);
    onChange?.({ online: navigator.onLine, queued: count });
  };

  window.addEventListener('online', async () => { await flushQueue(); report(); });
  window.addEventListener('offline', report);
  navigator.serviceWorker?.addEventListener?.('message', async (e) => {
    if (e.data?.type === 'FLUSH_QUEUE') { await flushQueue(); report(); }
  });

  const timer = setInterval(async () => {
    if (navigator.onLine) {
      const before = await queueCount().catch(() => 0);
      if (before) await flushQueue();
    }
    report();
  }, 30000);

  report();
  return () => { clearInterval(timer); };
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) =>
      console.warn('Service worker registration failed:', err.message));
  });
}
