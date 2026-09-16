import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool, types } = pg;

// Return NUMERIC as JS number (safe for retail-scale money values).
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // int8

const connectionString =
  process.env.DATABASE_URL ||
  'postgres://postgres:postgres@127.0.0.1:5433/posrfid';

const needsSsl =
  /sslmode=require/.test(connectionString) ||
  (process.env.PGSSL === 'true');

export const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  max: parseInt(process.env.PG_POOL_MAX || '10', 10),
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => console.error('[db] idle client error', err.message));

export const query = (text, params) => pool.query(text, params);

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
}

export async function many(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

/** Run fn inside a transaction; rolls back on throw. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
