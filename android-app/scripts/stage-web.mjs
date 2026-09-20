/**
 * Build the web app for Android and copy it into this shell.
 *
 * Capacitor wants one folder of static files. The POS client is that, built
 * with POS_TARGET=android so asset paths come out relative — absolute paths
 * would send the WebView looking for files at the root of the device.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shell = path.resolve(here, '..');
const repo = path.resolve(shell, '..');
const client = path.join(repo, 'client');
const dist = path.join(client, 'dist');
const www = path.join(shell, 'www');

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, POS_TARGET: 'android' } });

if (!fs.existsSync(path.join(client, 'node_modules'))) {
  console.log('[android] installing client dependencies');
  run('npm install --no-audit --no-fund', client);
}

console.log('[android] building the web app (POS_TARGET=android)');
run('npm run build', client);

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('[android] the client build produced no index.html — stopping here');
  process.exit(1);
}

fs.rmSync(www, { recursive: true, force: true });
fs.cpSync(dist, www, { recursive: true });

// The service worker belongs to the PWA. Inside the APK the bundle is already
// local, and a second cache layer only creates a way for the app to serve
// yesterday's JavaScript after an update.
for (const stale of ['sw.js', 'service-worker.js']) {
  const p = path.join(www, stale);
  if (fs.existsSync(p)) fs.rmSync(p);
}

console.log(`[android] staged ${fs.readdirSync(www).length} entries into www/`);
