#!/usr/bin/env node
/**
 * AFLDB-ISSUE-228 S9 — the FULL-SEASON AFL API player-identity evidence emitter.
 *
 * A thin CLI over pieces that already exist and are already validated:
 *
 *   acquired snapshot (manifest re-hash)      afl-api-snapshot.ts        (S6, shared)
 *     -> buildAflApiSettleBundle()            settle-afl-api.ts          (S3/S6-B/S6-C)
 *     -> buildAflApiMatchIdentity()           afl-api-match-identity.ts  (S6, §6.1/§6.2/§11.1)
 *     -> resolveAflApiMatch()                 afl-api-match-resolver.ts  (S6-D1, §6.1)
 *     -> canonical player_match_stats         READ-ONLY, afldb_dev
 *     -> buildAflApiPlayerEvidence()          afl-api-player-evidence.ts (S9, pure)
 *     -> report / evidence artefact
 *
 * NOTHING in this file re-derives a match date, a timezone, a round, a team
 * identity or a statistic: every one of those comes from the emitters above.
 * There is no second Python builder and no second timezone implementation.
 *
 * SAFETY.
 *   - It never writes to any database. The connection is opened with
 *     `default_transaction_read_only=on` as a STARTUP parameter (so a
 *     reconnect cannot silently lose it), and the live session's own
 *     `current_database()` / `transaction_read_only` /
 *     `default_transaction_read_only` are proven before any evidence
 *     statement runs. Any database other than `afldb_dev` is refused.
 *     (The `afldb_test`-native sibling, `emit-afl-api-player-bridge-test.ts`,
 *     reuses this body with its OWN pinned target; neither entry point can
 *     select the other's database.)
 *   - It never accepts a DSN on argv. The DSN comes from
 *     `AFLDB_DEV_DATABASE_URL` only — deliberately not the importer's
 *     elevated write role and not the migration schema owner.
 *   - It never writes under `data/sources/`, and never overwrites an existing
 *     `--out` target whose content differs.
 *   - There is no PROD target, path or environment variable anywhere in this
 *     file, and none can be supplied from the command line.
 *
 * Usage:
 *   npm run emit:afl-api-player-bridge -- --label <snapshot> --validate-only
 *   npm run emit:afl-api-player-bridge -- --label <snapshot> --out <path>
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import {
  parseAflApiIdentities,
  type AflApiIdentities,
  type AflApiMatchBundle,
} from '../../src/lib/acquisition/afl-api-bundle';
import {
  AflApiMatchIdentityError,
  buildAflApiMatchIdentity,
  resolveAflApiSourceId,
} from '../../src/lib/acquisition/afl-api-match-identity';
import { resolveAflApiMatch } from '../../src/lib/acquisition/afl-api-match-resolver';
import {
  AFL_API_DEV_EVIDENCE_TARGET,
  AFL_API_SEASON_EVIDENCE_MATCH_METHOD,
  AGREEMENT_STAT_COLUMNS,
  CORE_STAT_COLUMNS,
  EXISTING_CLAIM_COMPARISON_UNPROVED,
  MIN_MATCHES_FOR_LINK,
  MIN_SINGLE_MATCH_AGREEMENT,
  assertAflApiEvidenceDsnFor,
  assertAflApiEvidenceSessionFor,
  type AflApiEvidenceTarget,
  buildAflApiPlayerEvidence,
  checkAflApiSnapshotCensus,
  compareAflApiExistingClaims,
  readAflApiObservedPlayerNames,
  type AflApiCanonicalEvidenceRow,
  type AflApiEvidenceStatColumn,
  type AflApiMatchEvidenceInput,
  type AflApiPlayerEvidenceResult,
  type AflApiProviderEvidenceRow,
  type AflApiSnapshotCensusExpectation,
} from '../../src/lib/acquisition/afl-api-player-evidence';
import {
  aflApiSnapshotManifestSha256,
  aflApiSnapshotRoot,
  aflApiUnitSourcesFrom,
  verifyAflApiSnapshotManifest,
} from '../../src/lib/acquisition/afl-api-snapshot';
import { NO_MATCH_REKEY_SCOPE } from '../../src/lib/acquisition/match-rekey';
import {
  buildAflApiSettleBundle,
  SETTLE_SOURCE_KEY,
  type AflApiSettleBundle,
} from '../../src/lib/acquisition/settle-afl-api';
import { parseSourceFamilyRegistry } from '../../src/lib/acquisition/source-families';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = join(__dirname, '..', '..');

export const TOOL = 'tools/current-season/emit-afl-api-player-bridge.ts';
export const TOOL_VERSION = '1.0.0';

/**
 * One pinned emitter target: the evidence database (from the CLOSED list in
 * `afl-api-player-evidence.ts`), the tool path recorded in the artefact, and
 * the session's application_name. Each CLI entry point passes exactly one of
 * these in code — the DEV one below, or the `afldb_test` one in
 * `emit-afl-api-player-bridge-test.ts` — and none is selectable from argv.
 */
export type AflApiPlayerBridgeEmitterTarget = {
  readonly evidence: AflApiEvidenceTarget;
  readonly tool: string;
  readonly applicationName: string;
};

export const DEV_EMITTER_TARGET: AflApiPlayerBridgeEmitterTarget = Object.freeze({
  evidence: AFL_API_DEV_EVIDENCE_TARGET,
  tool: TOOL,
  applicationName: 'afldb-emit-afl-api-player-bridge',
});

/** Tracked repository inputs this evidence depends on, SHA-pinned into the
 * artefact. The acquired snapshot is NOT pinned file by file — it is hundreds
 * of untracked payloads; its `manifest.json` already hash-binds every one of
 * them, so the artefact records the label plus that manifest's own sha256. */
const TRACKED_INPUTS = [
  join('data', 'reference', 'source-families.json'),
  join('data', 'reference', 'afl-api-identities.json'),
] as const;

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

export type EmitAflApiPlayerBridgeArgs = {
  label: string;
  validateOnly: boolean;
  out: string | null;
  expectedCensus: AflApiSnapshotCensusExpectation | null;
  compareArtefacts: readonly string[];
};

const KNOWN_FLAGS = new Set([
  '--label', '--validate-only', '--out',
  '--expect-matches', '--expect-rows', '--expect-providers',
  '--compare-artefact',
]);
const VALUE_FLAGS = new Set([
  '--label', '--out', '--expect-matches', '--expect-rows', '--expect-providers', '--compare-artefact',
]);

function valueFor(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function intFor(argv: readonly string[], flag: string): number | null {
  const raw = valueFor(argv, flag);
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) throw new Error(`${flag} must be a non-negative integer; got '${raw}'.`);
  return Number(raw);
}

export function parseEmitAflApiPlayerBridgeArgs(argv: readonly string[]): EmitAflApiPlayerBridgeArgs {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--') && !KNOWN_FLAGS.has(arg)) throw new Error(`Unknown flag '${arg}'.`);
    if (VALUE_FLAGS.has(arg)) i += 1;
  }
  const label = valueFor(argv, '--label');
  if (!label) throw new Error('--label <snapshot> is required.');

  const validateOnly = argv.includes('--validate-only');
  const out = valueFor(argv, '--out');
  if (argv.includes('--out') && (out === null || out.startsWith('--'))) {
    throw new Error('--out needs a path.');
  }
  if (validateOnly && out !== null) {
    throw new Error('--validate-only and --out are mutually exclusive; choose one.');
  }
  if (!validateOnly && out === null) {
    throw new Error('Pass either --validate-only or --out <path>. There is no implicit output path.');
  }

  const expectMatches = intFor(argv, '--expect-matches');
  const expectRows = intFor(argv, '--expect-rows');
  const expectProviders = intFor(argv, '--expect-providers');
  const supplied = [expectMatches, expectRows, expectProviders].filter((v) => v !== null).length;
  if (supplied !== 0 && supplied !== 3) {
    throw new Error(
      '--expect-matches, --expect-rows and --expect-providers are an all-or-nothing acceptance '
      + 'gate for one snapshot; supply all three or none.',
    );
  }

  const compareArtefacts: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--compare-artefact') continue;
    const path = argv[i + 1];
    if (!path || path.startsWith('--')) throw new Error('--compare-artefact needs a path.');
    compareArtefacts.push(path);
    i += 1;
  }

  return {
    label,
    validateOnly,
    out,
    expectedCensus: supplied === 3
      ? {
        matches: expectMatches as number,
        playerMatchRows: expectRows as number,
        distinctProviderPlayers: expectProviders as number,
      }
      : null,
    compareArtefacts,
  };
}

/* ------------------------------------------------------------------ *
 * Offline loading (no connection is open at any point in this section)
 * ------------------------------------------------------------------ */

function loadEnv(projectRoot: string): void {
  let contents: string;
  try {
    contents = readFileSync(join(projectRoot, '.env'), 'utf8');
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

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export type LoadedSnapshot = {
  bundle: AflApiSettleBundle;
  snapshotDir: string;
  snapshotManifestSha256: string;
  /** Match directories the manifest itself names — the snapshot's own census,
   * independent of whether each one's bundle built. */
  snapshotMatches: number;
  snapshotPlayerMatchRows: number;
  snapshotDistinctProviderPlayers: number;
  /** `playerStatsRaw` per unit, for the validation-only observed names. */
  observedNamesByMatch: ReadonlyMap<string, ReturnType<typeof readAflApiObservedPlayerNames>>;
};

function loadSnapshot(projectRoot: string, label: string): LoadedSnapshot {
  const snapshotDir = join(aflApiSnapshotRoot(projectRoot), label);
  const { manifest, files } = verifyAflApiSnapshotManifest(snapshotDir);
  const season = manifest.season;
  if (typeof season !== 'number') throw new Error('manifest.json carries no numeric season.');

  const registry = parseSourceFamilyRegistry(
    readJson(join(projectRoot, 'data', 'reference', 'source-families.json')),
  );
  const identities: AflApiIdentities = parseAflApiIdentities(
    readJson(join(projectRoot, 'data', 'reference', 'afl-api-identities.json')),
  );

  const sources = aflApiUnitSourcesFrom(snapshotDir, files);
  const bundle = buildAflApiSettleBundle({ season, snapshotLabel: label, sources, registry, identities });

  const observedNamesByMatch = new Map<string, ReturnType<typeof readAflApiObservedPlayerNames>>();
  for (const source of sources) {
    const providerId = (source.fixtureRaw as { providerId?: unknown } | null)?.providerId;
    if (typeof providerId !== 'string') continue;
    observedNamesByMatch.set(providerId, readAflApiObservedPlayerNames(source.playerStatsRaw));
  }

  const providerPlayerIds = new Set<string>();
  let snapshotPlayerMatchRows = 0;
  for (const unit of bundle.units) {
    for (const row of unit.bundle.playerStats) {
      snapshotPlayerMatchRows += 1;
      providerPlayerIds.add(row.providerPlayerId);
    }
  }

  return {
    bundle,
    snapshotDir,
    snapshotManifestSha256: aflApiSnapshotManifestSha256(snapshotDir),
    snapshotMatches: sources.length,
    snapshotPlayerMatchRows,
    snapshotDistinctProviderPlayers: providerPlayerIds.size,
    observedNamesByMatch,
  };
}

/* ------------------------------------------------------------------ *
 * Read-only DEV evidence
 * ------------------------------------------------------------------ */

function createReadOnlyEvidenceClient(target: AflApiPlayerBridgeEmitterTarget): postgres.Sql {
  const dsn = assertAflApiEvidenceDsnFor(target.evidence, process.env[target.evidence.dsnEnv]);
  return postgres(dsn, {
    max: 1,
    idle_timeout: 0,
    connect_timeout: 15,
    onnotice: () => {},
    transform: { undefined: null },
    connection: {
      application_name: target.applicationName,
      // STARTUP parameters, not a `SET` issued after connecting: a reconnect
      // inside the pool cannot silently come back writable. The live session
      // is still proven afterwards — this is the mechanism, not the proof.
      default_transaction_read_only: true,
      TimeZone: 'UTC',
    },
  });
}

async function proveReadOnlyEvidenceSession(
  sql: postgres.Sql, target: AflApiPlayerBridgeEmitterTarget,
): Promise<{ database: string; role: string }> {
  const [row] = await sql<{
    currentDatabase: string; currentRole: string;
    transactionReadOnly: string; defaultTransactionReadOnly: string;
  }[]>`
    SELECT current_database() AS "currentDatabase",
           current_user AS "currentRole",
           current_setting('transaction_read_only') AS "transactionReadOnly",
           current_setting('default_transaction_read_only') AS "defaultTransactionReadOnly"
  `;
  assertAflApiEvidenceSessionFor(target.evidence, {
    currentDatabase: row?.currentDatabase,
    transactionReadOnly: row?.transactionReadOnly,
    defaultTransactionReadOnly: row?.defaultTransactionReadOnly,
  });
  return { database: row.currentDatabase, role: row.currentRole };
}

type CanonicalPmsRow = {
  playerId: number; clubId: number; jumperNumber: string | null; surname: string | null;
  kicks: number | null; handballs: number | null; marks: number | null; tackles: number | null;
  goals: number | null; behinds: number | null; hitouts: number | null;
  freesFor: number | null; freesAgainst: number | null; inside50s: number | null;
  clearances: number | null; rebounds: number | null; goalAssists: number | null;
  contested: number | null; uncontested: number | null; contestedMarks: number | null;
  marksInside50: number | null; onePercenters: number | null; bounces: number | null;
  clangers: number | null;
};

/** One read per resolved canonical match. SELECT only. */
async function readCanonicalPlayerMatchStats(
  sql: postgres.Sql, matchId: number,
): Promise<AflApiCanonicalEvidenceRow[]> {
  const rows = await sql<CanonicalPmsRow[]>`
    SELECT pms.player_id       AS "playerId",
           pms.club_id         AS "clubId",
           pms.jumper_number   AS "jumperNumber",
           p.surname           AS "surname",
           pms.kicks           AS "kicks",
           pms.handballs       AS "handballs",
           pms.marks           AS "marks",
           pms.tackles         AS "tackles",
           pms.goals           AS "goals",
           pms.behinds         AS "behinds",
           pms.hitouts         AS "hitouts",
           pms.frees_for       AS "freesFor",
           pms.frees_against   AS "freesAgainst",
           pms.inside_50s      AS "inside50s",
           pms.clearances      AS "clearances",
           pms.rebounds        AS "rebounds",
           pms.goal_assists    AS "goalAssists",
           pms.contested       AS "contested",
           pms.uncontested     AS "uncontested",
           pms.contested_marks AS "contestedMarks",
           pms.marks_inside_50 AS "marksInside50",
           pms.one_percenters  AS "onePercenters",
           pms.bounces         AS "bounces",
           pms.clangers        AS "clangers"
      FROM player_match_stats pms
      JOIN players p ON p.id = pms.player_id
     WHERE pms.match_id = ${matchId}
  `;
  return rows.map((row) => ({
    playerId: row.playerId,
    clubId: row.clubId,
    jumperNumberRaw: row.jumperNumber,
    surname: row.surname,
    stats: statsOf(row),
  }));
}

function statsOf(row: CanonicalPmsRow): Record<AflApiEvidenceStatColumn, number | null> {
  return {
    kicks: row.kicks, handballs: row.handballs, marks: row.marks, tackles: row.tackles,
    goals: row.goals, behinds: row.behinds, hitouts: row.hitouts,
    frees_for: row.freesFor, frees_against: row.freesAgainst, inside_50s: row.inside50s,
    clearances: row.clearances, rebounds: row.rebounds, goal_assists: row.goalAssists,
    contested: row.contested, uncontested: row.uncontested, contested_marks: row.contestedMarks,
    marks_inside_50: row.marksInside50, one_percenters: row.onePercenters,
    bounces: row.bounces, clangers: row.clangers,
  };
}

/**
 * The AFL API projection carries the SAME facts under camelCase names
 * (§11.3's field-mapping table). An explicit map, never a same-name lookup —
 * the identical hazard `settle-afl-api.ts`'s `aflApiPlayerStatValues()`
 * documents.
 */
function providerStatsOf(
  row: AflApiMatchBundle['playerStats'][number],
): Record<AflApiEvidenceStatColumn, number | null> {
  return {
    kicks: row.kicks, handballs: row.handballs, marks: row.marks, tackles: row.tackles,
    goals: row.goals, behinds: row.behinds, hitouts: row.hitouts,
    frees_for: row.freesFor, frees_against: row.freesAgainst, inside_50s: row.inside50s,
    clearances: row.clearances, rebounds: row.rebounds, goal_assists: row.goalAssists,
    contested: row.contested, uncontested: row.uncontested, contested_marks: row.contestedMarks,
    marks_inside_50: row.marksInside50, one_percenters: row.onePercenters,
    bounces: row.bounces, clangers: row.clangers,
  };
}

/**
 * Build one match's evidence input. Match identity/resolution is delegated
 * entirely to the S6 modules; this function only decides how to REPORT the
 * outcome, and never creates or mutates anything.
 *
 * Exported for the DB-free deferral tests: a deferred unit returns before
 * `sql` is touched at all, so the deferral contract can be proved without a
 * connection.
 */
export async function matchEvidenceInputFor(
  sql: postgres.Sql, sourceId: number, snapshot: LoadedSnapshot,
  unit: AflApiSettleBundle['units'][number],
): Promise<AflApiMatchEvidenceInput> {
  const bundle = unit.bundle;
  const providerMatchId = bundle.match.sourceRecordId;
  const observedNames = snapshot.observedNamesByMatch.get(providerMatchId);

  const providerRowsFor = (clubOf: (providerTeamId: string) => number | null): AflApiProviderEvidenceRow[] =>
    bundle.playerStats.map((row) => {
      const name = observedNames?.get(row.providerPlayerId);
      return {
        providerMatchId,
        providerPlayerId: row.providerPlayerId,
        clubId: clubOf(row.providerTeamId),
        jumperNumber: row.jumperNumber,
        observedGivenName: name?.givenName ?? null,
        observedSurname: name?.surname ?? null,
        stats: providerStatsOf(row),
      };
    });

  const unresolved = (reason: string): AflApiMatchEvidenceInput => ({
    providerMatchId,
    canonicalMatchId: null,
    unresolvedReason: reason,
    providerRows: providerRowsFor(() => null),
    canonicalRows: [],
  });

  // §7.3 (T3): a unit whose PLAYER-MATCH-STAT records the settle path defers
  // contributes no identity evidence here either. That is exactly
  // `buildAflApiSettleRecords()`'s own `rosterOrMatchDeferral` rule — a
  // non-CONCLUDED fixture (`matchDeferral`, the wider fact, which defers the
  // whole unit) OR a CONCLUDED fixture whose roster is not yet CONCLUDED
  // (`rosterDeferral`, which defers the roster and stat side only). Either one
  // means the provider's stat rows are not yet promotable, so they must not
  // become identity evidence. Reported, never silently included.
  const deferral = bundle.matchDeferral ?? bundle.rosterDeferral;
  if (deferral !== null) {
    return unresolved(`deferred(${deferral.reason})`);
  }

  let identity: Awaited<ReturnType<typeof buildAflApiMatchIdentity>>;
  try {
    identity = await buildAflApiMatchIdentity(sql, sourceId, bundle);
  } catch (error) {
    if (error instanceof AflApiMatchIdentityError) return unresolved(error.code);
    throw error;
  }

  const resolution = await resolveAflApiMatch(
    sql, identity, { kind: 'run_enumeration', scope: NO_MATCH_REKEY_SCOPE },
  );
  if (resolution.outcome === 'unresolved') return unresolved('no_canonical_match');
  if (resolution.outcome === 'refused') {
    return unresolved(`${resolution.reason}(${resolution.candidateIds.join(',')})`);
  }
  if (resolution.outcome === 'halt') {
    // Never silently absorbed: a provider-identity contradiction is reported
    // as this match's own refusal reason. This tool writes nothing, so it has
    // no run to halt — it reports and keeps classifying every other match.
    return unresolved(`provider_identity_contradiction(matches.id=${resolution.targetId})`);
  }

  const clubOf = (providerTeamId: string): number | null => {
    if (providerTeamId === bundle.match.homeTeamProviderId) return identity.homeClubId;
    if (providerTeamId === bundle.match.awayTeamProviderId) return identity.awayClubId;
    return null;
  };

  return {
    providerMatchId,
    canonicalMatchId: resolution.targetId,
    unresolvedReason: null,
    providerRows: providerRowsFor(clubOf),
    canonicalRows: await readCanonicalPlayerMatchStats(sql, resolution.targetId),
  };
}

/* ------------------------------------------------------------------ *
 * Existing-artefact overlap (provider-id sets only)
 * ------------------------------------------------------------------ */

function linkedProviderIdsOf(artefactPath: string): string[] {
  const artefact = readJson(artefactPath) as { providers?: Record<string, { disposition?: unknown }> };
  const providers = artefact.providers ?? {};
  return Object.entries(providers)
    .filter(([, row]) => row?.disposition === 'linked')
    .map(([providerId]) => providerId);
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

function counterLine(label: string, value: number): string {
  return `${label.padEnd(46)} ${String(value).padStart(9)}`;
}

export function renderEvidenceReport(
  snapshot: { matches: number; playerMatchRows: number; distinctProviderPlayers: number; buildFailures: number },
  result: AflApiPlayerEvidenceResult,
): string[] {
  const c = result.counters;
  const lines: string[] = [
    '',
    counterLine('SNAPSHOT_MATCHES', snapshot.matches),
    counterLine('SNAPSHOT_PLAYER_MATCH_ROWS', snapshot.playerMatchRows),
    counterLine('SNAPSHOT_DISTINCT_PROVIDER_PLAYERS', snapshot.distinctProviderPlayers),
    '',
    counterLine('BUNDLE_BUILD_FAILURES', snapshot.buildFailures),
    '',
    counterLine('CANONICAL_MATCHES_RESOLVED', c.canonicalMatchesResolved),
    counterLine('CANONICAL_MATCHES_UNRESOLVED', c.canonicalMatchesUnresolved),
    '',
    counterLine('CANONICAL_PMS_ROWS_READ', c.canonicalPmsRowsRead),
    '',
    counterLine('PROVIDERS_LINKED', c.providersLinked),
    counterLine('PROVIDERS_UNRESOLVED', c.providersUnresolved),
    counterLine('PROVIDERS_CONTRADICTORY', c.providersContradictory),
    '',
    counterLine('PLAYER_MATCH_ROWS_COVERED_BY_LINKED_PROVIDERS', c.playerMatchRowsCoveredByLinkedProviders),
    counterLine('PLAYER_MATCH_ROWS_UNCOVERED', c.playerMatchRowsUncovered),
    '',
    counterLine('DUPLICATE_CANONICAL_JUMPER_KEYS', c.duplicateCanonicalJumperKeys),
    counterLine('NONSTANDARD_CANONICAL_JUMPERS', c.nonstandardCanonicalJumpers),
    counterLine('ALL_ZERO_SINGLE_MATCH_WITHHELD', c.allZeroSingleMatchWithheld),
  ];

  if (c.matchesRefusedDuplicateJumperKey > 0) {
    lines.push('', `MATCHES REFUSED FOR A DUPLICATE CANONICAL JUMPER KEY (${c.matchesRefusedDuplicateJumperKey}):`);
    for (const match of result.matches) {
      if (match.resolution !== 'refused_duplicate_jumper_key') continue;
      lines.push(`  ${match.providerMatchId} (matches.id=${match.canonicalMatchId}) ${match.reason}`);
    }
  }

  if (c.nonstandardCanonicalJumpers > 0) {
    lines.push('', 'NONSTANDARD CANONICAL JUMPER NUMBERS (reported, never silently skipped):');
    for (const match of result.matches) {
      for (const entry of match.nonstandardJumpers) {
        lines.push(
          `  ${match.providerMatchId} players.id=${entry.playerId} club_id=${entry.clubId} `
          + `jumper_number=${JSON.stringify(entry.raw)}`,
        );
      }
    }
  }

  const unresolvedMatches = result.matches.filter((m) => m.resolution === 'unresolved');
  if (unresolvedMatches.length > 0) {
    lines.push('', `UNRESOLVED CANONICAL MATCHES (${unresolvedMatches.length}):`);
    for (const match of unresolvedMatches) {
      lines.push(`  ${match.providerMatchId}  ${match.reason}`);
    }
  }

  const unresolvedProviders = result.providers.filter((p) => p.disposition === 'unresolved');
  lines.push('', `UNRESOLVED PROVIDERS (${unresolvedProviders.length}):`);
  lines.push(
    `  ${'provider_id'.padEnd(14)} ${'observed_name'.padEnd(28)} `
    + `${'rows'.padStart(5)} ${'hits'.padStart(5)}  reason`,
  );
  for (const provider of unresolvedProviders) {
    lines.push(
      `  ${provider.providerId.padEnd(14)} ${(provider.observedName ?? '(no name)').padEnd(28)} `
      + `${String(provider.snapshotRowCount).padStart(5)} `
      + `${String(provider.matchedEvidenceCount).padStart(5)}  ${provider.reason ?? ''}`,
    );
  }

  const contradictory = result.providers.filter((p) => p.disposition === 'contradictory');
  lines.push('', `CONTRADICTORY PROVIDERS (${contradictory.length}):`);
  for (const provider of contradictory) {
    lines.push(
      `  ${provider.providerId} ${provider.observedName ?? '(no name)'} — ${provider.reason ?? ''}`,
    );
    for (const candidate of provider.competingCandidates) {
      lines.push(
        `      candidate players.id=${candidate.canonicalPlayerId} `
        + `via [${candidate.providerMatchIds.join(', ')}] `
        + `claimed by [${candidate.competingProviderIds.join(', ')}]`,
      );
    }
    for (const hit of provider.matches) {
      lines.push(
        `      evidence ${hit.providerMatchId} -> players.id=${hit.canonicalPlayerId} `
        + `(${hit.agreeingStatCount} agreeing stats`
        + `${hit.allZeroCoreVector ? ', ALL-ZERO core vector' : ''})`,
      );
    }
  }

  return lines;
}

/* ------------------------------------------------------------------ *
 * Artefact
 * ------------------------------------------------------------------ */

export function buildEvidenceArtefact(input: {
  season: number;
  snapshotLabel: string;
  snapshotManifestSha256: string;
  builtFromDatabase: string;
  snapshotCensus: { matches: number; playerMatchRows: number; distinctProviderPlayers: number };
  expectedCensus: AflApiSnapshotCensusExpectation | null;
  buildFailures: AflApiSettleBundle['buildFailures'];
  inputs: readonly { file: string; sha256: string }[];
  result: AflApiPlayerEvidenceResult;
  existingArtefactOverlap: unknown;
  generatedUtc: string;
  /** The emitting CLI's own path; the DEV emitter's when omitted. */
  tool?: string;
}): Record<string, unknown> {
  const providers: Record<string, unknown> = {};
  for (const provider of input.result.providers) {
    const row: Record<string, unknown> = {
      disposition: provider.disposition,
      reason: provider.reason,
      observed_name: provider.observedName,
      snapshot_row_count: provider.snapshotRowCount,
      matched_evidence_count: provider.matchedEvidenceCount,
      matches: provider.matches.map((hit) => ({
        provider_match_id: hit.providerMatchId,
        canonical_player_id: hit.canonicalPlayerId,
        agreeing_stat_count: hit.agreeingStatCount,
        all_zero_core_vector: hit.allZeroCoreVector,
      })),
      unmatched: provider.unmatched.map((miss) => `${miss.providerMatchId}:${miss.reason}`),
    };
    if (provider.disposition === 'linked') {
      row.candidate_player_id = provider.candidatePlayerId;
      row.canonical_surname = provider.canonicalSurname;
      row.evidence_summary = provider.evidenceSummary;
    }
    if (provider.disposition === 'contradictory') {
      row.competing_candidates = provider.competingCandidates.map((candidate) => ({
        canonical_player_id: candidate.canonicalPlayerId,
        provider_match_ids: candidate.providerMatchIds,
        competing_provider_ids: candidate.competingProviderIds,
      }));
    }
    providers[provider.providerId] = row;
  }

  return {
    tool: input.tool ?? TOOL,
    tool_version: TOOL_VERSION,
    generated_utc: input.generatedUtc,
    source_key: SETTLE_SOURCE_KEY,
    match_method: AFL_API_SEASON_EVIDENCE_MATCH_METHOD,
    season: input.season,
    built_from_database: input.builtFromDatabase,
    read_only: true,
    snapshot_label: input.snapshotLabel,
    snapshot_manifest_sha256: input.snapshotManifestSha256,
    existing_claim_comparison: EXISTING_CLAIM_COMPARISON_UNPROVED,
    core_stat_columns: [...CORE_STAT_COLUMNS],
    agreement_stat_columns: [...AGREEMENT_STAT_COLUMNS],
    acceptance_rule: {
      min_matches_for_link: MIN_MATCHES_FOR_LINK,
      min_single_match_agreement: MIN_SINGLE_MATCH_AGREEMENT,
      all_zero_single_match_vector_withheld: true,
      duplicate_canonical_jumper_key_refuses_match: true,
      surname_equality_is_validation_only: true,
      name_based_candidate_discovery: false,
    },
    inputs: input.inputs.map((entry) => ({ file: entry.file, sha256: entry.sha256 })),
    snapshot_census: {
      matches: input.snapshotCensus.matches,
      player_match_rows: input.snapshotCensus.playerMatchRows,
      distinct_provider_players: input.snapshotCensus.distinctProviderPlayers,
      expected: input.expectedCensus === null ? null : {
        matches: input.expectedCensus.matches,
        player_match_rows: input.expectedCensus.playerMatchRows,
        distinct_provider_players: input.expectedCensus.distinctProviderPlayers,
      },
    },
    build_failures: input.buildFailures.map((failure) => ({
      provider_match_id: failure.providerMatchId, error: failure.error,
    })),
    counts: input.result.counters,
    matches_processed: input.result.matches.map((match) => ({
      provider_match_id: match.providerMatchId,
      canonical_match_id: match.canonicalMatchId,
      resolution: match.resolution,
      reason: match.reason,
      canonical_rows_read: match.canonicalRowsRead,
      duplicate_jumper_keys: match.duplicateJumperKeys,
      nonstandard_jumpers: match.nonstandardJumpers.map((entry) => ({
        player_id: entry.playerId, club_id: entry.clubId, jumper_number: entry.raw,
      })),
    })),
    providers,
    existing_artefact_overlap: input.existingArtefactOverlap,
  };
}

/**
 * Deterministic serialisation: object keys sorted recursively, array order
 * preserved (every array this artefact carries is already sorted on a stable
 * key by the evidence engine). A `JSON.stringify` replacer ARRAY would filter
 * keys at every nesting level, not just the top one — deliberately not used.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortKeysDeep(source[key]);
    return out;
  }
  return value;
}

/**
 * Never a silent overwrite, and never a write under `data/sources/`. Identical
 * content except the generated timestamp is a no-op; any real difference is a
 * hard refusal. The established `build_afl_api_player_bridge.py` convention.
 */
export function writeArtefact(
  outPath: string, artefact: Record<string, unknown>, log: (line: string) => void,
): void {
  const serialised = `${JSON.stringify(sortKeysDeep(artefact), null, 2)}\n`;
  if (existsSync(outPath)) {
    const existing = readJson(outPath) as Record<string, unknown>;
    const strip = (value: Record<string, unknown>): unknown => {
      const { generated_utc: _ignored, ...rest } = value;
      return sortKeysDeep(rest);
    };
    if (JSON.stringify(strip(existing)) === JSON.stringify(strip(artefact))) {
      log(`${outPath} already exists and is identical (except generated_utc) — not rewritten.`);
      return;
    }
    throw new Error(
      `REFUSED: ${outPath} already exists with DIFFERENT content. Use a new --out path, or remove `
      + 'the stale one deliberately. Nothing was written.',
    );
  }
  writeFileSync(outPath, serialised, 'utf8');
  log(`Wrote ${outPath}`);
}

/**
 * `true` where the filesystem folds case, so `data\Sources\x.json` and
 * `data\sources\x.json` are the SAME directory. Windows is the editing
 * workstation and macOS's default APFS is case-insensitive too; Linux (the
 * supported runtime) is not, and there `data/Sources/` is a genuinely
 * different directory that this guard must not refuse.
 */
export const PATH_COMPARISON_IS_CASE_INSENSITIVE =
  process.platform === 'win32' || process.platform === 'darwin';

/**
 * `data/sources/` holds immutable acquired evidence and is never written to.
 * The comparison is on RESOLVED filesystem paths (so `.\data\sources\x.json`,
 * a relative path and an absolute one all collapse to the same thing), and is
 * case-folded where the filesystem itself folds case — otherwise
 * `data/Sources/foo.json` would slip past on Windows.
 *
 * A legitimate sibling such as `data/source-output/` or `data/reference/` is
 * unaffected: the match requires the forbidden directory exactly, or the
 * platform path separator immediately after it.
 */
export function assertNotUnderDataSources(projectRoot: string, outPath: string): void {
  const fold = (value: string): string =>
    (PATH_COMPARISON_IS_CASE_INSENSITIVE ? value.toLowerCase() : value);
  const forbidden = fold(resolve(join(projectRoot, 'data', 'sources')));
  const resolved = fold(resolve(outPath));
  if (resolved === forbidden || resolved.startsWith(forbidden + sep)) {
    throw new Error(
      `REFUSED: --out '${outPath}' is under data/sources/, which this tool never writes to. `
      + 'Acquired snapshots are immutable evidence.',
    );
  }
}

/* ------------------------------------------------------------------ *
 * The CLI
 * ------------------------------------------------------------------ */

export type EmitAflApiPlayerBridgeDeps = {
  projectRoot?: string;
  sql?: postgres.Sql;
  log?: (line: string) => void;
  now?: () => Date;
};

export type EmitAflApiPlayerBridgeOutcome = {
  args: EmitAflApiPlayerBridgeArgs;
  result: AflApiPlayerEvidenceResult;
  artefact: Record<string, unknown>;
  censusOk: boolean;
};

/** The DEV emitter: pinned to `afldb_dev` in code, exactly as before. */
export async function runEmitAflApiPlayerBridgeCli(
  argv: readonly string[], deps: EmitAflApiPlayerBridgeDeps = {},
): Promise<EmitAflApiPlayerBridgeOutcome> {
  return runEmitAflApiPlayerBridgeFor(DEV_EMITTER_TARGET, argv, deps);
}

/**
 * The shared body behind every pinned entry point. The target is a code
 * constant supplied by the entry point, never parsed from `argv`; the DSN is
 * read only from that target's own environment variable, and the live
 * session is proven against that target's own database before any evidence
 * statement runs.
 */
export async function runEmitAflApiPlayerBridgeFor(
  target: AflApiPlayerBridgeEmitterTarget,
  argv: readonly string[], deps: EmitAflApiPlayerBridgeDeps = {},
): Promise<EmitAflApiPlayerBridgeOutcome> {
  const projectRoot = deps.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const log = deps.log ?? ((line: string) => console.log(line));
  const args = parseEmitAflApiPlayerBridgeArgs(argv);
  if (args.out !== null) assertNotUnderDataSources(projectRoot, args.out);

  // ---- offline: manifest re-hash, bundle build, snapshot census gate.
  const snapshot = loadSnapshot(projectRoot, args.label);
  log(
    `Bundle v${snapshot.bundle.bundleContractVersion} '${snapshot.bundle.snapshotLabel}' `
    + `(season ${snapshot.bundle.season}): ${snapshot.bundle.units.length} match unit(s) built, `
    + `${snapshot.bundle.buildFailures.length} build failure(s).`,
  );
  for (const failure of snapshot.bundle.buildFailures) {
    log(`  BUILD FAILURE ${failure.providerMatchId ?? '(unknown match)'}: ${failure.error}`);
  }
  log(`Snapshot manifest sha256: ${snapshot.snapshotManifestSha256}`);

  const observedCensus = {
    matches: snapshot.snapshotMatches,
    playerMatchRows: snapshot.snapshotPlayerMatchRows,
    distinctProviderPlayers: snapshot.snapshotDistinctProviderPlayers,
  };
  const census = checkAflApiSnapshotCensus(observedCensus, args.expectedCensus);
  if (!census.ok) {
    throw new Error(
      'STOP: the acceptance snapshot census does not match what this run was told to expect. '
      + `No connection was opened and nothing was written.\n  ${census.mismatches.join('\n  ')}`,
    );
  }

  // ---- read-only evidence from the pinned target.
  const ownsClient = deps.sql === undefined;
  const sql = deps.sql ?? createReadOnlyEvidenceClient(target);
  const evidence = await (async (): Promise<{
    result: AflApiPlayerEvidenceResult; builtFromDatabase: string;
  }> => {
    try {
      const proof = await proveReadOnlyEvidenceSession(sql, target);
      log(
        `Read-only session proven: current_database()='${proof.database}', role='${proof.role}', `
        + 'transaction_read_only=on, default_transaction_read_only=on.',
      );

      const sourceId = await resolveAflApiSourceId(sql);
      const matchInputs: AflApiMatchEvidenceInput[] = [];
      for (const unit of snapshot.bundle.units) {
        matchInputs.push(await matchEvidenceInputFor(sql, sourceId, snapshot, unit));
      }
      return { result: buildAflApiPlayerEvidence(matchInputs), builtFromDatabase: proof.database };
    } finally {
      if (ownsClient) await sql.end({ timeout: 5 });
    }
  })();
  const { result, builtFromDatabase } = evidence;

  for (const line of renderEvidenceReport(
    { ...observedCensus, buildFailures: snapshot.bundle.buildFailures.length }, result,
  )) log(line);

  // ---- overlap with previously accepted artefacts (provider-id sets only).
  let existingArtefactOverlap: unknown = null;
  if (args.compareArtefacts.length > 0) {
    const existing = new Set<string>();
    for (const path of args.compareArtefacts) {
      for (const providerId of linkedProviderIdsOf(path)) existing.add(providerId);
    }
    const comparison = compareAflApiExistingClaims(result.providers, [...existing]);
    existingArtefactOverlap = {
      artefacts: [...args.compareArtefacts],
      id_parity: comparison.idParity,
      existing_linked_providers: comparison.existingLinkedProviders,
      both_linked: comparison.bothLinked,
      newly_linked: comparison.newlyLinked,
      existing_only: comparison.existingOnly,
      existing_linked_now_contradictory: comparison.existingLinkedNowContradictory,
    };
    log('');
    log('OVERLAP WITH THE PREVIOUSLY ACCEPTED ARTEFACT(S) — provider-id sets only:');
    log(counterLine('  EXISTING_LINKED_PROVIDERS', comparison.existingLinkedProviders));
    log(counterLine('  BOTH_LINKED', comparison.bothLinked));
    log(counterLine('  NEWLY_LINKED_BY_THIS_EVIDENCE', comparison.newlyLinked));
    log(counterLine('  EXISTING_ONLY', comparison.existingOnly.length));
    log(counterLine('  EXISTING_LINKED_NOW_CONTRADICTORY', comparison.existingLinkedNowContradictory.length));
    log(`  existing_claim_comparison = ${comparison.idParity}`);
    log(
      '  (Numeric candidate_player_id equality across databases is NOT compared: '
      + 'players.id parity between afldb_test and afldb_dev has not been proven, so an equal id would not '
      + 'be corroboration and an unequal id would not be a contradiction.)',
    );
  }

  const artefact = buildEvidenceArtefact({
    season: snapshot.bundle.season,
    snapshotLabel: snapshot.bundle.snapshotLabel,
    snapshotManifestSha256: snapshot.snapshotManifestSha256,
    builtFromDatabase,
    snapshotCensus: observedCensus,
    expectedCensus: args.expectedCensus,
    buildFailures: snapshot.bundle.buildFailures,
    inputs: TRACKED_INPUTS.map((rel) => ({
      file: rel.split(sep).join('/'),
      sha256: sha256File(join(projectRoot, rel)),
    })),
    result,
    existingArtefactOverlap,
    generatedUtc: (deps.now?.() ?? new Date()).toISOString(),
    tool: target.tool,
  });

  if (args.out === null) {
    log('');
    log('--validate-only: evidence computed and reported. No artefact was written.');
  } else {
    writeArtefact(args.out, artefact, log);
  }

  return { args, result, artefact, censusOk: census.ok };
}

async function main(): Promise<void> {
  loadEnv(DEFAULT_PROJECT_ROOT);
  await runEmitAflApiPlayerBridgeCli(process.argv.slice(2));
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
