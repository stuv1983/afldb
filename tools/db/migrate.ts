/**
 * AFLDB migration runner.
 *
 *   npm run db:migrate            apply pending migrations to afldb_dev
 *   npm run db:migrate:test       apply pending migrations to afldb_test
 *   npm run db:status             show applied / pending without changing anything
 *
 * Migrations are plain .sql files in src/db/migrations, applied in filename
 * order. Each runs inside a transaction, so a failure leaves the database on
 * the last good migration rather than half-applied.
 *
 * Applied migrations are recorded in afldb_meta.schema_migrations along with a
 * SHA-256 checksum. Editing an already-applied migration is refused: schema
 * changes must be made by adding a new migration.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import {
  computeChecksumRepresentations,
  matchesStoredChecksum,
  type MigrationChecksumRepresentations,
} from './migration-checksum';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const MIGRATIONS_DIR = join(PROJECT_ROOT, 'src', 'db', 'migrations');

/**
 * Load .env, as the Python tooling does.
 *
 * Without this the documented `npm run db:migrate` could only work if the
 * caller had already exported the DSN, so the command in the deployment
 * guide failed on a clean shell. An already-set variable always wins, so
 * `AFLDB_MIGRATE_TARGET=prod` with an exported DSN still overrides .env.
 */
function loadEnv(): void {
  let contents: string;
  try {
    contents = readFileSync(join(PROJECT_ROOT, '.env'), 'utf8');
  } catch {
    return; // Absent in CI; variables are expected to be set already.
  }
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const name = key.trim();
    if (!process.env[name]) process.env[name] = rest.join('=').trim();
  }
}

loadEnv();

const statusOnly = process.argv.includes('--status');

/**
 * Every target is named explicitly.
 *
 * The previous form treated anything that was not 'test' as 'dev', so
 * AFLDB_MIGRATE_TARGET=prod — the command the cutover plan documented —
 * silently migrated development instead. An unrecognised target is now a
 * refusal, because guessing which database to alter is the one thing a
 * migration runner must never do.
 */
const TARGETS = {
  dev: 'AFLDB_OWNER_DATABASE_URL',
  test: 'AFLDB_TEST_DATABASE_URL',
  prod: 'AFLDB_PROD_DATABASE_URL',
} as const;

type Target = keyof typeof TARGETS;

/**
 * `--target <name>` exists so the package scripts do not have to set the target
 * through a shell env assignment (AFLDB-ISSUE-093 §H11 F1).
 *
 * `AFLDB_MIGRATE_TARGET=test tsx tools/db/migrate.ts` is POSIX-only, and npm on
 * Windows runs package scripts under cmd.exe, where it fails outright with
 * "'AFLDB_MIGRATE_TARGET' is not recognized …". That made the MIGRATIONS stage of
 * `npm run db:test:rebuild` unrunnable on a Windows host — one stage AFTER the
 * destructive reset had already emptied the database.
 *
 * The environment variable remains supported and unchanged for every documented
 * invocation that already uses it. When both are supplied they must AGREE: silently
 * preferring one over the other is exactly the "guess which database to alter"
 * failure the explicit-target rule above exists to prevent.
 */
const targetFlagIndex = process.argv.indexOf('--target');
const targetFlag = targetFlagIndex === -1 ? undefined : process.argv[targetFlagIndex + 1];

if (targetFlagIndex !== -1 && !targetFlag) {
  console.error('ERROR: --target needs a target name.'
    + `\n       Valid targets: ${Object.keys(TARGETS).join(', ')}.`);
  process.exit(1);
}

const envTarget = process.env.AFLDB_MIGRATE_TARGET;

if (targetFlag && envTarget && targetFlag !== envTarget) {
  console.error(
    `ERROR: --target '${targetFlag}' and AFLDB_MIGRATE_TARGET '${envTarget}' disagree.`
    + '\n       Supply one, or make them identical.',
  );
  process.exit(1);
}

const requested = targetFlag ?? envTarget ?? 'dev';

if (!Object.hasOwn(TARGETS, requested)) {
  console.error(
    `ERROR: unknown migration target '${requested}'.`
    + `\n       Valid targets: ${Object.keys(TARGETS).join(', ')}.`,
  );
  process.exit(1);
}

const target = requested as Target;
const variable = TARGETS[target];
const connectionString = process.env[variable];

if (!connectionString) {
  console.error(`ERROR: ${variable} is not set (target '${target}').`);
  process.exit(1);
}

/** Redact credentials before any logging. */
function safeTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.username}@${u.hostname}:${u.port}${u.pathname}`;
  } catch {
    return '<unparseable connection string>';
  }
}

type Migration = { name: string; sql: string; reps: MigrationChecksumRepresentations };

function loadMigrations(): Migration[] {
  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  } catch {
    console.error(`ERROR: migrations directory not found: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }
  return files
    .sort()
    .map((name) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
      return { name, sql, reps: computeChecksumRepresentations(sql) };
    });
}

async function main() {
  const sql = postgres(connectionString!, { max: 1, onnotice: () => {} });

  try {
    await sql.unsafe(`
      CREATE SCHEMA IF NOT EXISTS afldb_meta;
      CREATE TABLE IF NOT EXISTS afldb_meta.schema_migrations (
        name        text        PRIMARY KEY,
        checksum    text        NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now(),
        duration_ms integer     NOT NULL
      );
    `);

    const applied = await sql<{ name: string; checksum: string }[]>`
      SELECT name, checksum FROM afldb_meta.schema_migrations
    `;
    const appliedByName = new Map(applied.map((r) => [r.name, r.checksum]));
    const migrations = loadMigrations();

    console.log(`AFLDB migrations -> ${target} (${safeTarget(connectionString!)})`);
    console.log(`  ${migrations.length} migration file(s), ${applied.length} already applied\n`);

    // Refuse to run if an already-applied migration has been edited.
    const drifted = migrations.filter(
      (m) => appliedByName.has(m.name) && !matchesStoredChecksum(appliedByName.get(m.name)!, m.reps),
    );
    if (drifted.length > 0) {
      console.error('ERROR: these applied migrations have been modified since they ran:');
      for (const m of drifted) console.error(`  - ${m.name}`);
      console.error('\nAdd a new migration instead of editing an applied one.');
      process.exit(1);
    }

    const pending = migrations.filter((m) => !appliedByName.has(m.name));

    if (statusOnly) {
      for (const m of migrations) {
        console.log(`  ${appliedByName.has(m.name) ? 'applied' : 'PENDING'}  ${m.name}`);
      }
      console.log(`\n${pending.length} pending.`);
      return;
    }

    if (pending.length === 0) {
      console.log('Nothing to apply — schema is up to date.');
      return;
    }

    for (const m of pending) {
      const started = Date.now();
      process.stdout.write(`  applying ${m.name} ... `);
      try {
        // begin() rolls back automatically if the migration throws.
        await sql.begin(async (tx) => {
          await tx.unsafe(m.sql);
          await tx`
            INSERT INTO afldb_meta.schema_migrations (name, checksum, duration_ms)
            VALUES (${m.name}, ${m.reps.canonicalLf}, ${Date.now() - started})
          `;
        });
        console.log(`ok (${Date.now() - started} ms)`);
      } catch (err) {
        console.log('FAILED');
        console.error(`\n${m.name} failed and was rolled back:\n`);
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
      }
    }

    console.log(`\nApplied ${pending.length} migration(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
