import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to prepare the test database');
}

const url = new URL(databaseUrl);
const isTestDatabase = url.pathname.includes('test') || url.hostname === 'localhost' || url.hostname === '127.0.0.1';

if (process.env.NODE_ENV !== 'test' || !isTestDatabase) {
  throw new Error('Refusing to reset database unless NODE_ENV=test and DATABASE_URL points to a test/local database');
}

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDir = join(rootDir, 'prisma', 'migrations');
const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();

try {
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.query('GRANT ALL ON SCHEMA public TO PUBLIC');

  const entries = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const entry of entries) {
    const sql = await readFile(join(migrationsDir, entry, 'migration.sql'), 'utf8');
    if (sql.trim()) {
      await client.query(sql);
    }
  }
} finally {
  client.release();
  await pool.end();
}
