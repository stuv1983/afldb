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
 *
 * AFLDB-ISSUE-244 I244-F006 — MATCH-IDENTITY CONTRACT.
 * `staging.afl_api_match` is a typed projection of the matches the AFL API
 * match settle PLANS (`afl_api`-owned or new). It is NOT a mirror of every
 * provider match: a match that merely corroborates an existing foreign-owned
 * canonical match (e.g. an `afltables`-owned home-and-away match) has no
 * typed row by design. Such a Brownlow vote set resolves only through
 * `--use-fixture-identity` (canonical fixture identity, SELECT-only). Before
 * any write, this CLI measures which of the snapshot's vote sets need that
 * fallback (`assessAflApiBrownlowMatchIdentityCoverage()`, from the Brownlow
 * records themselves — never from a source-vs-staging row count) and, when
 * some do and the flag is absent:
 *
 *   --validate-only  no connection is opened, so coverage is not assessed.
 *   --observe-only   ADVISORY only (log lines): it never attempts a canonical
 *                    write and its spine observations do not depend on match
 *                    identity, so the affected sets are simply counted refused.
 *   --dry-run / --apply (with or without --auto-apply, and with the default
 *   no-mode-flag dry run)
 *                    REFUSE before the import batch or any observation is
 *                    written. `--apply` without `--auto-apply` still commits
 *                    typed projections plus a data_issues/import_rejections
 *                    row per refused vote set; `--dry-run` is the rehearsal of
 *                    `--apply` and must fail the same way.
 *   --allow-completed-season-backtest
 *                    changes nothing here: its `afldb_test` proof runs first,
 *                    and the identity requirement then applies as above.
 *
 * The flag is never switched on implicitly.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { proveAflApiIngestionPreflight } from '../../src/lib/acquisition/afl-api-ingestion-safety';
import {
  BROWNLOW_ENABLE_ENV,
  AflApiBrownlowFixtureIdentityRequiredError,
  assessAflApiBrownlowMatchIdentityCoverage,
  describeAflApiBrownlowFixtureIdentityRequirement,
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
import {
  combineAflApiBrownlowGates,
  type AflApiIngestionControls,
} from '../../src/lib/acquisition/afl-api-ingestion-control';
import { SETTING_KEYS } from '../../src/lib/site-settings';
// I244-F029: the shared loader, which honours AFLDB_SKIP_DOTENV so a variable
// this unit's `UnsetEnvironment=` stripped is not read straight back in.
import { loadEnv } from './load-env';

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
   * default and NEVER enabled implicitly; an operator must ask for it
   * explicitly. I244-F006: a write-capable run whose snapshot needs it and
   * lacks it refuses before any write (see the module doc header). */
  useFixtureIdentity: boolean;
  /** §10 follow-up (2026-09-20): see the module doc header. Off by default. */
  allowCompletedSeasonBacktest: boolean;
};

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
    'staleRecipientsDemoted', 'voteSetsNoOp', 'voteSetsApplyFailed', 'coverageRecomputeRuns',
  ]);
  group('Data issues', ['dataIssuesOpened', 'dataIssuesRefreshed']);
  group('Leaderboard reconciliation', ['leaderboardPlayersCompared', 'leaderboardMismatches']);
  return lines;
}

export type AflApiBrownlowSettleCliDeps = {
  projectRoot?: string;
  sql?: postgres.Sql;
  log?: (line: string) => void;
  /** Test-only escape hatch for the §D two-key admin gate below; production always reads the database. */
  ingestionControls?: AflApiIngestionControls;
};
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

  // AFLDB-ISSUE-228 follow-up (§D two-key safety) — BOTH the outer
  // deployment gate and the inner super-admin DB switch must be true. A
  // test-only control override preserves the existing no-connection gate test.
  const deploymentGateEnabled = isAflApiBrownlowEnabled(process.env);
  const overriddenGate = deps.ingestionControls
    ? combineAflApiBrownlowGates(deploymentGateEnabled, deps.ingestionControls.brownlowAdminEnabled)
    : null;
  if (overriddenGate && !overriddenGate.effectiveEnabled) {
    throw new Error(
      'Brownlow settle is disabled outside the live count window (§10, §D two-key safety): '
      + `deployment gate (${BROWNLOW_ENABLE_ENV}) is ${deploymentGateEnabled ? 'enabled' : 'disabled'}, `
      + `super-admin setting (site_settings '${SETTING_KEYS.aflApiBrownlowEnabled}') is `
      + `${deps.ingestionControls!.brownlowAdminEnabled ? 'enabled' : 'disabled'}. Both must be enabled.`,
    );
  }

  const seasons = readJson(join(projectRoot, 'data', 'reference', 'seasons.json')) as { in_progress_seasons?: unknown };
  const inProgressSeasons = Array.isArray(seasons.in_progress_seasons)
    ? seasons.in_progress_seasons.filter((year): year is number => typeof year === 'number')
    : [];

  // The identities map is needed to USE the fallback (flag) and, since
  // I244-F006, to MEASURE whether the snapshot needs it (any vote set at all).
  // A zero-vote snapshot never reads it unless the flag asks for it.
  const fixtureIdentityFallbackCandidate: AflApiFixtureIdentityFallback | undefined =
    args.useFixtureIdentity || snapshot.matchVotes.length > 0
      ? {
        registry,
        identities: parseAflApiIdentities(
          readJson(join(projectRoot, 'data', 'reference', 'afl-api-identities.json')),
        ),
      }
      : undefined;
  let fixtureIdentityFallback: AflApiFixtureIdentityFallback | undefined;
  if (args.useFixtureIdentity) {
    fixtureIdentityFallback = fixtureIdentityFallbackCandidate;
    log(
      '--use-fixture-identity: a vote set with no typed staging.afl_api_match row (the expected state for '
      + 'a match that only corroborates a foreign-owned canonical match) will be retried against the '
      + 'fixture-only observation spine before being refused unknown_match.',
    );
  }

  const ownsClient = deps.sql === undefined;
  const sql = deps.sql ?? createImportClient();
  try {
    const preflight = deps.ingestionControls
      ? null
      : await proveAflApiIngestionPreflight(sql);
    const ingestionControls = deps.ingestionControls ?? preflight!.controls;
    const gate = combineAflApiBrownlowGates(deploymentGateEnabled, ingestionControls.brownlowAdminEnabled);
    if (!gate.effectiveEnabled) {
      throw new Error(
        'Brownlow settle is disabled outside the live count window (§10, §D two-key safety): '
        + `deployment gate (${BROWNLOW_ENABLE_ENV}) is ${deploymentGateEnabled ? 'enabled' : 'disabled'}, `
        + `super-admin setting (site_settings '${SETTING_KEYS.aflApiBrownlowEnabled}') is `
        + `${ingestionControls.brownlowAdminEnabled ? 'enabled' : 'disabled'}. Both must be enabled.`,
      );
    }
    if (preflight) {
      log(`AFL API Brownlow ingestion preflight: control database = ${preflight.control.database}, `
        + `writer database = ${preflight.writer.database}.`);
    }

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

    // I244-F006: read-only, BEFORE the run opens its transaction (no import
    // batch, observation, projection, data_issues or rejection exists yet).
    // Skipped when the operator already passed --use-fixture-identity, and
    // when there is nothing to resolve.
    if (!args.useFixtureIdentity && fixtureIdentityFallbackCandidate) {
      const coverage = await assessAflApiBrownlowMatchIdentityCoverage(
        sql, snapshot.matchVotes, fixtureIdentityFallbackCandidate,
      );
      if (coverage.fixtureIdentityRequired.length > 0) {
        if (!args.observeOnly) {
          throw new AflApiBrownlowFixtureIdentityRequiredError(args.apply ? 'apply' : 'dry-run', coverage);
        }
        log('');
        log(
          `ADVISORY (--observe-only): ${describeAflApiBrownlowFixtureIdentityRequirement(coverage)} `
          + 'Without --use-fixture-identity those vote sets are counted refused as unknown_match below. '
          + 'A --dry-run or --apply run would refuse before any write; re-run with --use-fixture-identity '
          + 'if canonical fixture identity is the intended fallback.',
        );
      }
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

    // §10 / I244-F006: `unknown_match` means neither identity path could
    // resolve this vote set's `CD_M…`. The Brownlow feed itself carries no
    // home/away/date, so a match is identified either by a typed
    // `staging.afl_api_match` row (written ONLY for a match the AFL API settle
    // plans — afl_api-owned or new; a match that merely corroborates a
    // foreign-owned canonical match never gets one, by design) or, with
    // --use-fixture-identity, by its match-family spine observation against
    // the existing canonical `matches` row. Both need the match family
    // acquired and settled (`settle-afl-api.ts --apply`, or a --fixtures-only
    // snapshot via `settle-afl-api-fixtures.ts --apply`) so that observation
    // exists. Running `settle-afl-api.ts` does NOT create a typed row for a
    // corroborated match.
    const unknownMatchCount = result.counters.voteSetsRefused.unknown_match ?? 0;
    if (unknownMatchCount > 0) {
      log('');
      log(
        `${unknownMatchCount} vote set(s) refused as 'unknown_match': no typed staging.afl_api_match row exists `
        + 'for that provider match id'
        + (args.useFixtureIdentity
          ? ', and the fixture-identity fallback found no unique canonical match for it (no match-family '
            + 'observation, or no canonical match with that season/clubs/date).'
          : ', and --use-fixture-identity was not supplied.')
        + " Ensure the match family for this season is acquired and settled ('settle-afl-api.ts --label "
        + "<snapshot> --apply', or a --fixtures-only snapshot with 'settle-afl-api-fixtures.ts --apply') "
        + 'so its match observation exists, then re-run. A match that only corroborates a foreign-owned '
        + 'canonical match never receives a typed staging.afl_api_match row; it resolves only via '
        + '--use-fixture-identity.',
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
        + `already up to date, ${result.counters.voteSetsApplyFailed} vote set(s) rolled back on write failure, `
        + `${result.counters.voteSetsRefused.match_identity_conflict ?? 0} vote set(s) refused for `
        + 'match_identity_conflict (nothing written; see data_issues).'
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
