import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const fresh = process.argv.includes('--fresh');
  if (fresh) {
    console.log('[migrate] dropping public schema (--fresh)');
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[migrate] schema applied');
  await pool.end();
}

run().catch((e) => {
  console.error('[migrate] failed:', e.message);
  process.exit(1);
});
