#!/usr/bin/env node
/**
 * AFLDB-ISSUE-228 S7 (§10, §17) — the afl_api Brownlow settle CLI.
 *
 * Mirrors `settle-afl-api.ts`'s contract (§17): every offline verification
 * (manifest re-hash, registry parse, bundle-record emission) happens BEFORE
 * any database connection opens; review-first is not applicable here (no
 * promotion_candidates queue exists for Brownlow, see
 * `afl-api-brownlow.ts`'s module doc) — the two switches that matter are
 * `--auto-apply` (attempt the canonical write at all) and `--observe-only`
 * (§10: fetch/parse/validate/log, never a promotion write, regardless of the
 * other flags).
 *
 *   --validate-only            manifest re-hash + registry + record parse;
 *                               no connection opened, no §10 enable check.
 *   --observe-only             spine observations only; no canonical write.
 *   --dry-run [--auto-apply]   the full write path, rolled back.
 *   --apply [--auto-apply]     the operational path.
 *   --allow-completed-season-backtest
 *                               §10 follow-up (2026-09-20): a narrow,
 *                               `afldb_test`-only bypass of E2
 *                               (`season_not_in_progress`, canonical-apply.ts)
 *                               for a historical completed-season Brownlow
 *                               backtest, for the brownlow_round_votes write
 *                               ONLY — every other gate (identity, ownership,
 *                               vote-set atomicity, round translation, finals
 *                               exclusion, ...) is unaffected. The connected
 *                               database is proved LIVE via
 *                               `current_database()` (never the DSN string or
 *                               a hostname guess); any database other than
 *                               `afldb_test` HARD REFUSES before any
 *                               canonical write. Harmless without
 *                               `--apply`/`--auto-apply` — nothing is ever
 *                               written in that case, so the flag has no
 *                               effect.
 *
 * §10 "Operational enablement": every mode past `--validate-only` refuses
 * unless `AFLDB_AFL_API_BROWNLOW_ENABLED=true` is set.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import {
  BROWNLOW_ENABLE_ENV,
  isAflApiBrownlowEnabled,
  requireAflApiBrownlowBacktestDatabase,
  runSettleAflApiBrownlow,
  type AflApiBrownlowCompletedSeasonBacktestAuthority,
  type AflApiBrownlowSettleCounters,
  type AflApiBrownlowSettleRunResult,
  type AflApiFixtureIdentityFallback,
} from '../../src/lib/acquisition/afl-api-brownlow';
import {
  emitAflApiBrownlowLeaderboard,
  emitAflApiBrownlowMatchVotes,
  parseAflApiIdentities,
  type AflApiBrownlowLeaderboardRecord,
  type AflApiBrownlowMatchVoteRecord,
} from '../../src/lib/acquisition/afl-api-bundle';
import { parseSourceFamilyRegistry, type SourceFamilyRegistry } from '../../src/lib/acquisition/source-families';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = join(__dirname, '..', '..');

function snapshotRootOf(projectRoot: string): string {
  return join(projectRoot, 'data', 'sources', 'afl_api', 'brownlow');
}

export type AflApiBrownlowSettleCliArgs = {
  label: string;
  apply: boolean;
  autoApply: boolean;
  observeOnly: boolean;
  validateOnly: boolean;
  /** S7 follow-up (2026-09-20): opt in to the fixture-only identity
   * fallback (§ "fixture-only Brownlow identity prerequisite"). Off by
   * default — omitting it keeps this CLI's behaviour byte-identical to
   * before the fallback existed; an operator must ask for it explicitly. */
  useFixtureIdentity: boolean;
  /** §10 follow-up (2026-09-20): see the module doc header. Off by default. */
  allowCompletedSeasonBacktest: boolean;
};

function loadEnv(projectRoot: string): void {
  let contents: string;
  try {
    contents = readFileSync(join(projectRoot, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const name = key.trim();
    if (!process.env[name]) process.env[name] = rest.join('=').trim();
  }
}

function valueFor(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

const KNOWN_FLAGS = new Set([
  '--label', '--apply', '--dry-run', '--auto-apply', '--observe-only', '--validate-only',
  '--use-fixture-identity', '--allow-completed-season-backtest',
]);

export function parseAflApiBrownlowSettleArgs(argv: readonly string[]): AflApiBrownlowSettleCliArgs {
  const label = valueFor(argv, '--label');
  if (!label) throw new Error('--label <snapshot> is required.');
  const modeFlags = ['--apply', '--dry-run', '--validate-only'].filter((flag) => argv.includes(flag));
  if (modeFlags.length > 1) throw new Error(`${modeFlags.join(' and ')} are mutually exclusive; choose one.`);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--') && !KNOWN_FLAGS.has(arg)) throw new Error(`Unknown flag '${arg}'.`);
    if (arg === '--label') i += 1;
  }
  return {
    label,
    apply: argv.includes('--apply'),
    autoApply: argv.includes('--auto-apply'),
    observeOnly: argv.includes('--observe-only'),
    validateOnly: argv.includes('--validate-only'),
    useFixtureIdentity: argv.includes('--use-fixture-identity'),
    allowCompletedSeasonBacktest: argv.includes('--allow-completed-season-backtest'),
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

type ManifestFile = { file: string; sha256: string };

function verifyManifest(snapshotDir: string): { manifest: Record<string, unknown>; files: readonly ManifestFile[] } {
  const manifestPath = join(snapshotDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`No manifest.json under ${snapshotDir} — the Brownlow acquisition did not complete.`);
  }
  const manifest = readJson(manifestPath) as { source_key?: unknown; files?: unknown };
  if (manifest.source_key !== 'afl_api') {
    throw new Error(`manifest.json names source_key '${String(manifest.source_key)}', expected 'afl_api'.`);
  }
  const files = Array.isArray(manifest.files) ? (manifest.files as ManifestFile[]) : [];
  for (const entry of files) {
    const full = join(snapshotDir, entry.file);
    if (!existsSync(full)) throw new Error(`Manifest names '${entry.file}' but it is not on disk.`);
    const actual = createHash('sha256').update(readFileSync(full)).digest('hex');
    if (actual !== entry.sha256) {
      throw new Error(`'${entry.file}' has changed since acquisition (sha256 mismatch) — refusing to settle it.`);
    }
  }
  return { manifest: manifest as Record<string, unknown>, files };
}

function createImportClient(): postgres.Sql {
  const dsn = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!dsn) throw new Error('AFLDB_IMPORT_DATABASE_URL is not set.');
  return postgres(dsn, { max: 1, onnotice: () => {}, transform: { undefined: null } });
}

export type LoadedBrownlowSnapshot = {
  season: number;
  matchVotes: readonly AflApiBrownlowMatchVoteRecord[];
  leaderboard: readonly AflApiBrownlowLeaderboardRecord[];
  leaderboardStatus: string | null;
};

function loadSnapshot(projectRoot: string, label: string, registry: SourceFamilyRegistry): LoadedBrownlowSnapshot {
  const snapshotDir = join(snapshotRootOf(projectRoot), label);
  const { manifest } = verifyManifest(snapshotDir);
  const season = manifest.season;
  if (typeof season !== 'number') throw new Error('manifest.json carries no numeric season.');

  const seasonRaw = readJson(join(snapshotDir, '01-brownlow-season.raw.json'));
  const leaderboardRaw = readJson(join(snapshotDir, '02-brownlow-leaderboard.raw.json'));

  const { records: matchVotes } = emitAflApiBrownlowMatchVotes(seasonRaw, registry);
  const { records: leaderboard, observation } = emitAflApiBrownlowLeaderboard(leaderboardRaw, registry);
  const leaderboardStatus = typeof (observation as { status?: unknown } | null)?.status === 'string'
    ? (observation as { status: string }).status
    : null;

  return {
    season, matchVotes, leaderboard, leaderboardStatus,
  };
}

function counterLines(counters: AflApiBrownlowSettleCounters): string[] {
  const lines: string[] = [];
  const group = (title: string, keys: readonly (keyof AflApiBrownlowSettleCounters)[]): void => {
    lines.push('', title);
    for (const key of keys) {
      const value = counters[key];
      lines.push(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
    }
  };
  group('Vote sets', [
    'voteSetsSeen', 'voteSetsPlanned', 'voteSetsWouldAutoApply', 'voteSetsRefused', 'voteSetsRescheduledRound',
  ]);
  group('Observation', ['observationsSeen', 'payloadsCreated', 'versionsAppended', 'observationsUnchanged']);
  group('Canonical', [
    'canonicalRowsInserted', 'canonicalRowsUpdated', 'canonicalApplicationsLogged',
    'voteSetsNoOp', 'voteSetsApplyFailed',
  ]);
  group('Data issues', ['dataIssuesOpened', 'dataIssuesRefreshed']);
  group('Leaderboard reconciliation', ['leaderboardPlayersCompared', 'leaderboardMismatches']);
  return lines;
}

export type AflApiBrownlowSettleCliDeps = { projectRoot?: string; sql?: postgres.Sql; log?: (line: string) => void };
export type AflApiBrownlowSettleCliOutcome = {
  args: AflApiBrownlowSettleCliArgs;
  result: AflApiBrownlowSettleRunResult | null;
};

export async function runAflApiBrownlowSettleCli(
  argv: readonly string[], deps: AflApiBrownlowSettleCliDeps = {},
): Promise<AflApiBrownlowSettleCliOutcome> {
  const projectRoot = deps.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const log = deps.log ?? ((line: string) => console.log(line));
  const args = parseAflApiBrownlowSettleArgs(argv);

  const registry = parseSourceFamilyRegistry(readJson(join(projectRoot, 'data', 'reference', 'source-families.json')));
  const snapshot = loadSnapshot(projectRoot, args.label, registry);
  log(
    `Brownlow snapshot '${args.label}' (season ${snapshot.season}): ${snapshot.matchVotes.length} match vote-set(s), `
    + `${snapshot.leaderboard.length} leaderboard entr(y/ies), leaderboard status = ${snapshot.leaderboardStatus ?? '(none)'}.`,
  );

  if (args.validateOnly) {
    log('');
    log('--validate-only: manifest, registry and record parse verified. No connection opened.');
    return { args, result: null };
  }

  if (!isAflApiBrownlowEnabled(process.env)) {
    throw new Error(
      `Brownlow settle is disabled by default outside the live count window (§10). `
      + `Set ${BROWNLOW_ENABLE_ENV}=true to run it.`,
    );
  }

  const seasons = readJson(join(projectRoot, 'data', 'reference', 'seasons.json')) as { in_progress_seasons?: unknown };
  const inProgressSeasons = Array.isArray(seasons.in_progress_seasons)
    ? seasons.in_progress_seasons.filter((year): year is number => typeof year === 'number')
    : [];

  let fixtureIdentityFallback: AflApiFixtureIdentityFallback | undefined;
  if (args.useFixtureIdentity) {
    const identities = parseAflApiIdentities(
      readJson(join(projectRoot, 'data', 'reference', 'afl-api-identities.json')),
    );
    fixtureIdentityFallback = { registry, identities };
    log(
      '--use-fixture-identity: a vote set with no staging.afl_api_match row will be retried '
      + 'against the fixture-only observation spine before being refused unknown_match.',
    );
  }

  const ownsClient = deps.sql === undefined;
  const sql = deps.sql ?? createImportClient();
  try {
    let completedSeasonBacktestAuthority: AflApiBrownlowCompletedSeasonBacktestAuthority | undefined;
    if (args.allowCompletedSeasonBacktest) {
      // Live current_database() proof — never the DSN string, never a
      // hostname guess (§10 follow-up doc header). Throws before any
      // canonical write for anything other than afldb_test.
      completedSeasonBacktestAuthority = await requireAflApiBrownlowBacktestDatabase(sql);
      log('');
      log('COMPLETED-SEASON BROWNLOW BACKTEST');
      log(`database: ${completedSeasonBacktestAuthority.verifiedDatabase}`);
      log('season-in-progress gate bypass authorised for this Brownlow run only');
    }

    const result = await runSettleAflApiBrownlow(sql, {
      registry,
      season: snapshot.season,
      matchVotes: snapshot.matchVotes,
      leaderboard: snapshot.leaderboard,
      leaderboardStatus: snapshot.leaderboardStatus,
      inProgressSeasons,
      apply: args.apply,
      autoApply: args.autoApply,
      observeOnly: args.observeOnly,
      fixtureIdentityFallback,
      completedSeasonBacktestAuthority,
    });

    if (result.halt) {
      log('');
      log(`HALT: ${result.halt.reason} — ${JSON.stringify(result.halt.detail)}`);
      log('The whole run was rolled back, including the import_batches row. Nothing was written.');
      return { args, result };
    }

    for (const line of counterLines(result.counters)) log(line);

    // §10: `unknown_match` means this vote set's `CD_M…` has no
    // `staging.afl_api_match` row (migration 103) yet — the Brownlow feed
    // itself carries no home/away/date to resolve a match from (module doc,
    // `afl-api-brownlow.ts`). This is an ordinary, expected sequencing gap,
    // never a resolver defect: run `settle-afl-api.ts --label <snapshot>
    // --apply` for this match's season FIRST (no `--auto-apply` is needed —
    // an already afltables-owned match only needs to be corroborated, which
    // still writes the staging projection), then re-run this settle.
    const unknownMatchCount = result.counters.voteSetsRefused.unknown_match ?? 0;
    if (unknownMatchCount > 0) {
      log('');
      log(
        `${unknownMatchCount} vote set(s) refused as 'unknown_match': the match family's own `
        + "staging.afl_api_match projection has no row for that provider match id yet. Run "
        + "'tools/current-season/settle-afl-api.ts --label <snapshot> --apply' for this season "
        + 'BEFORE the Brownlow settle, then re-run (§10). If a full match/roster/stats acquisition '
        + "is not available for every match (e.g. simulator coverage), acquire a --fixtures-only "
        + "snapshot, settle it with 'settle-afl-api-fixtures.ts --apply', and re-run THIS command "
        + 'with --use-fixture-identity.',
      );
    }

    log('');
    if (result.reconciliation.mismatches.length > 0) {
      log(
        `Leaderboard reconciliation: ${result.reconciliation.mismatches.length} mismatch(es) `
        + `(${result.reconciliation.blocking ? 'BLOCKING — leaderboard status CONCLUDED' : 'advisory — count still in progress'}).`,
      );
      for (const m of result.reconciliation.mismatches) {
        log(`  ${m.providerPlayerId}: reconstructed ${m.reconstructedTotal} vs leaderboard ${m.leaderboardTotal}`);
      }
    } else {
      log(`Leaderboard reconciliation: ${result.reconciliation.compared} player(s) compared, 0 mismatches.`);
    }

    log('');
    if (args.observeOnly) {
      log('--observe-only: spine observations persisted; no canonical write was attempted.');
    } else if (!result.applied) {
      log(
        'Dry run. The full write path executed against real constraints and privileges, then the whole '
        + `transaction was rolled back. Re-run with --apply${args.autoApply ? ' --auto-apply' : ''} to keep it.`,
      );
    } else {
      log(
        `Applied as import batch ${result.batchId}: ${result.counters.canonicalRowsInserted} canonical row(s) `
        + `inserted, ${result.counters.canonicalRowsUpdated} updated, ${result.counters.voteSetsNoOp} vote set(s) `
        + `already up to date, ${result.counters.voteSetsApplyFailed} vote set(s) rolled back on write failure.`
        + (args.autoApply ? '' : ' No canonical row was written: the automatic path runs only with --auto-apply.'),
      );
    }
    return { args, result };
  } finally {
    if (ownsClient) await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  loadEnv(DEFAULT_PROJECT_ROOT);
  const outcome = await runAflApiBrownlowSettleCli(process.argv.slice(2));
  if (outcome.result?.halt) {
    process.exitCode = 1;
    return;
  }
  if (outcome.result?.reconciliation.blocking) {
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
