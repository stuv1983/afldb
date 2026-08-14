/**
 * Test setup.
 *
 * Integration tests run against `afldb_test`, never `afldb_dev`. The
 * DATABASE_URL used by src/db/client.ts is redirected here so that a
 * test can never write to, or be misled by, the development database.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env without adding a dotenv dependency.
try {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (!process.env[key.trim()]) process.env[key.trim()] = rest.join('=').trim();
  }
} catch {
  // .env is absent in CI; variables are expected to be set already.
}

if (!process.env.AFLDB_TEST_DATABASE_URL) {
  throw new Error('AFLDB_TEST_DATABASE_URL must be set to run integration tests.');
}

if (/afldb_dev/.test(process.env.AFLDB_TEST_DATABASE_URL)) {
  throw new Error('AFLDB_TEST_DATABASE_URL points at afldb_dev; refusing to run.');
}

// Everything imported from src/db/client.ts now targets afldb_test.
process.env.DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;
