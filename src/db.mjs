import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pool;

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
        ? { rejectUnauthorized: false }
        : undefined,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

export async function query(text, params = []) {
  return getPool().query(text, params);
}

export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate() {
  const schemaPath = path.resolve(__dirname, '../db/schema.sql');
  const schema = await fs.readFile(schemaPath, 'utf8');
  await getPool().query(schema);
}

export async function closeDb() {
  if (pool) await pool.end();
  pool = undefined;
}
