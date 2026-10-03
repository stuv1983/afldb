/**
 * AFLDB-ISSUE-257 D-257-7 rollback guard (read-only).
 *
 *   npx tsx tools/db/issue257-rollback-guard.ts --target dev|test|code-test|prod
 *
 * Migration 110 admits `player_match_stats` to `data_overrides.entity_type`. An application
 * older than ISSUE-257 treats that entity as unrepresentable, and re-adding migration 102's
 * narrow CHECK validates existing rows. So:
 *
 *   - zero `player_match_stats` rows (active OR inactive): rollback is permitted, in this order:
 *     restore the narrow CHECK first (the migration 110 reversal), then the old application;
 *   - one or more: the old application is NOT a supported rollback target. Roll forward only.
 *
 * This tool runs exactly one read-only count (plus the constraint definition, for the report)
 * inside a READ ONLY transaction and exits:
 *
 *   0  PERMITTED  (zero rows)
 *   2  REFUSED    (one or more rows, or an unreadable answer)
 *   1  error      (bad arguments, missing connection variable, connection failure)
 *
 * It never writes, never changes the CHECK and never deletes a record: deciding to discard a
 * human decision is not a rollback step. The connection string is read from the environment
 * variable the migration runner uses for the same target (never from the command line), with
 * `.env` loaded as `tools/db/migrate.ts` loads it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

/** The same target -> variable map as `tools/db/migrate.ts`. */
export const ROLLBACK_GUARD_TARGETS = {
  dev: 'AFLDB_OWNER_DATABASE_URL',
  test: 'AFLDB_TEST_DATABASE_URL',
  'code-test': 'AFLDB_CODE_TEST_DATABASE_URL',
  prod: 'AFLDB_PROD_DATABASE_URL',
} as const;

export type RollbackGuardTarget = keyof typeof ROLLBACK_GUARD_TARGETS;

/** The D-257-7 count: every row, active or not. Read-only. */
export const ROLLBACK_GUARD_COUNT_SQL = `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE is_active)::int AS active
  FROM public.data_overrides
 WHERE entity_type = 'player_match_stats'`;

/** The live entity_type CHECK, reported (not decided on). */
export const ROLLBACK_GUARD_CHECK_SQL = `SELECT pg_get_constraintdef(c.oid) AS def
  FROM pg_constraint c
 WHERE c.conrelid = 'public.data_overrides'::regclass
   AND c.conname = 'data_overrides_entity_type_check'`;

export type RollbackGuardVerdict = {
  permitted: boolean;
  exitCode: 0 | 2;
  lines: string[];
};

/**
 * Pure verdict. `total`/`active` are the count row; `checkDef` the constraint definition
 * (null when absent). Anything that is not a non-negative integer total refuses.
 */
export function rollbackGuardVerdict(input: {
  total: unknown;
  active: unknown;
  checkDef: string | null;
}): RollbackGuardVerdict {
  const admits = input.checkDef === null ? 'unreadable'
    : /'player_match_stats'/.test(input.checkDef) ? 'admits player_match_stats (migration 110, State B)'
      : 'does not admit player_match_stats (State A)';
  const lines = [`data_overrides_entity_type_check: ${admits}`];
  const total = input.total;
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
    lines.push(`REFUSED: the player_match_stats count is unreadable (${String(total)}); fail closed.`);
    return { permitted: false, exitCode: 2, lines };
  }
  const active = typeof input.active === 'number' && Number.isInteger(input.active) ? input.active : null;
  lines.push(`data_overrides rows with entity_type = 'player_match_stats': ${total} (active ${active ?? 'unreadable'})`);
  if (total > 0) {
    lines.push('REFUSED (D-257-7): at least one player_match_stats authority record exists, active or not.'
      + ' The application older than AFLDB-ISSUE-257 is not a supported rollback target. Roll forward only;'
      + ' do not delete records to make this pass.');
    return { permitted: false, exitCode: 2, lines };
  }
  lines.push('PERMITTED (D-257-7): no player_match_stats record exists. Restore the narrow CHECK FIRST'
    + ' (the migration 110 reversal), then roll the application back.');
  return { permitted: true, exitCode: 0, lines };
}

/** Parse `--target <name>`; a missing or unknown target is an error, never a default. */
export function parseRollbackGuardTarget(argv: readonly string[]): RollbackGuardTarget | { error: string } {
  const i = argv.indexOf('--target');
  const name = i === -1 ? undefined : argv[i + 1];
  if (!name) return { error: `--target is required (${Object.keys(ROLLBACK_GUARD_TARGETS).join(', ')})` };
  if (!Object.hasOwn(ROLLBACK_GUARD_TARGETS, name)) return { error: `unknown target '${name}'` };
  return name as RollbackGuardTarget;
}

function loadEnv(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  let contents: string;
  try {
    contents = readFileSync(join(root, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const name = key.trim();
    if (!process.env[name]) process.env[name] = rest.join('=').trim();
  }
}

async function main(): Promise<number> {
  const target = parseRollbackGuardTarget(process.argv.slice(2));
  if (typeof target !== 'string') {
    console.error(`ERROR: ${target.error}`);
    return 1;
  }
  loadEnv();
  const variable = ROLLBACK_GUARD_TARGETS[target];
  const dsn = process.env[variable];
  if (!dsn) {
    console.error(`ERROR: ${variable} is not set (target '${target}').`);
    return 1;
  }
  const sql = postgres(dsn, { max: 1, onnotice: () => {} });
  try {
    const result = await sql.begin('read only', async (tx) => {
      const [db] = await tx<{ db: string }[]>`SELECT current_database() AS db`;
      const [count] = await tx.unsafe<{ total: unknown; active: unknown }[]>(ROLLBACK_GUARD_COUNT_SQL);
      const checks = await tx.unsafe<{ def: string }[]>(ROLLBACK_GUARD_CHECK_SQL);
      return { db: db.db, count, checkDef: checks.length === 1 ? checks[0].def : null };
    });
    const verdict = rollbackGuardVerdict({
      total: result.count?.total, active: result.count?.active, checkDef: result.checkDef,
    });
    console.log(`AFLDB-ISSUE-257 rollback guard -> ${target} (database ${result.db})`);
    for (const line of verdict.lines) console.log(`  ${line}`);
    return verdict.exitCode;
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && /issue257-rollback-guard\.ts$/.test(process.argv[1])) {
  main().then((code) => process.exit(code), (err) => {
    console.error(err);
    process.exit(1);
  });
}
