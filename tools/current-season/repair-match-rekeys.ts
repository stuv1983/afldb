/**
 * AFLDB-ISSUE-131 §8 — the supervised remediation for matches ALREADY made
 * stale by the rekey defect.
 *
 * The §5.3/§5.4 fix stops the defect from happening again. It does not, by
 * itself, reach a row that went stale before it shipped: the settle only ever
 * looks at what the CURRENT bundle publishes, and a fixture whose live identity
 * already has a canonical row is one the settle must refuse (`rekey_would_merge`)
 * rather than repair. This tool is the operator-run counterpart, and it is
 * deliberately narrow.
 *
 * THE RULES IT IS BUILT AGAINST
 *
 *   1. **Dry run by default.** `--apply` must be explicit. Without it nothing
 *      is written, at all, on any path.
 *   2. **The restricted role.** It opens `AFLDB_IMPORT_DATABASE_URL` — the same
 *      `afldb_import` the settle uses — rather than an owner or superuser DSN,
 *      and the resolved database name is printed before anything else happens.
 *
 *      Be precise about what that buys: the guarantee that `matches` is never
 *      DELETEd or TRUNCATEd here is BEHAVIOURAL, not structural. This file
 *      contains no DELETE and no TRUNCATE on any path — rule 3 below — and
 *      ISSUE-099 obligation O1 (`tests/integration/settle-afltables.test.ts`,
 *      *"sends no DELETE and no TRUNCATE at all"*) proves the same of the
 *      settle path by asserting on the statements actually issued. The role is
 *      the blast-radius limit, not the proof; `privileges.sql` is what decides
 *      which DML `afldb_import` actually holds, and this issue changes no
 *      grant.
 *   3. **No ad-hoc DELETE, ever.** Every repair is an UPDATE that PRESERVES
 *      `matches.id`, so every child row and every provenance reference stays
 *      exactly where it is. Nothing is moved, nothing is reinserted.
 *   4. **One identity rule.** The candidate search is
 *      `findRetiredMatchIdentities()` — the SAME predicate the settle applies,
 *      imported rather than restated. Only the proof of retirement differs:
 *      the settle proves it from the bundle it is holding, this tool reads
 *      `staging.source_records.absent_since`, which the sweep wrote and which
 *      §19 only ever writes inside a proven-complete enumeration.
 *   5. **Ambiguity refuses, and two populated canonical rows are never
 *      merged.** There is no force flag.
 *   6. **The plan is fixed before it is applied.** `--apply` re-derives the
 *      whole plan inside the transaction and aborts if its hash differs from
 *      the plan that was printed, so a retry against changed data cannot
 *      silently do something else.
 *   7. **Every mutation writes its `canonical_applications` row in the same
 *      savepoint**, exactly as the settle does.
 *   8. **Acceptance is a diff, not a claim.** The validation block is printed
 *      before and after, so the operator compares numbers rather than trusting
 *      a success message.
 *
 * THE ONE ASSUMPTION, AND IT IS PROVEN PER FIXTURE (§3.6)
 *
 * The tool must know the `match_key` a live source record would be written
 * under, and — unlike the settle — it has no bundle projection to read it
 * from. `matches.source_record_id` holds two incompatible conventions:
 * historical rows carry an AFL Tables game id, and rows written by the
 * ISSUE-122 settle carry the five-part key string, which IS the
 * `external_record_id` (`import_fitzroy_core.py:1221-1224`, `:1615`).
 *
 * So the rendering is never guessed. Where the live identity already has a
 * canonical row, finding it on that key IS the proof. Where it does not — the
 * one case this tool writes in — the RETIRED row it is about to rekey must
 * itself satisfy `match_key = source_record_id`, which proves that row was
 * written by this settle under this convention, by the same emitter that
 * produced the live record. A fixture that fails that check is REFUSED
 * (`identity_convention_unproven`) and reported, never repaired. The column is
 * never normalised.
 *
 * Usage:
 *
 *   tsx tools/current-season/repair-match-rekeys.ts --season 2026
 *   tsx tools/current-season/repair-match-rekeys.ts --season 2026 --apply --plan-hash <hash>
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { asImportBatchId, type ImportBatchId } from '../../src/lib/import-batch-id';
import {
  carryMatchOverrides,
  findRetiredMatchIdentities,
} from '../../src/lib/acquisition/match-rekey';
import { canonicalJson, type JsonValue } from '../../src/lib/acquisition/observations';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = join(__dirname, '..', '..');

/** The source this tool repairs, and the only one it will ever touch. */
const SOURCE_KEY = 'afltables';
/** The contract family, as `staging.source_records.family` stores it. */
const MATCH_FAMILY = 'match';

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

export type RepairArgs = {
  season: number;
  apply: boolean;
  /** Required with `--apply`: the hash of the plan the operator reviewed. */
  planHash: string | null;
  acknowledgeCompletedSeason: boolean;
};

const KNOWN_FLAGS = new Set([
  '--season', '--apply', '--dry-run', '--plan-hash', '--acknowledge-completed-season',
]);

function valueFor(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

export function parseRepairArgs(argv: readonly string[]): RepairArgs {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--') && !KNOWN_FLAGS.has(arg)) {
      throw new Error(`Unknown flag '${arg}'.`);
    }
    if (arg === '--season' || arg === '--plan-hash') i += 1;
  }
  if (argv.includes('--apply') && argv.includes('--dry-run')) {
    throw new Error('--apply and --dry-run are mutually exclusive; choose one.');
  }
  const raw = valueFor(argv, '--season');
  if (!raw) throw new Error('--season <year> is required; this tool never guesses a season.');
  const season = Number(raw);
  if (!Number.isInteger(season) || season < 1897 || season > 2200) {
    throw new Error(`--season '${raw}' is not a plausible season year.`);
  }
  const apply = argv.includes('--apply');
  const planHash = valueFor(argv, '--plan-hash');
  if (apply && !planHash) {
    throw new Error(
      '--apply requires --plan-hash <hash>, the hash printed by the dry run you reviewed. '
      + 'The plan is re-derived inside the transaction and must still match it.',
    );
  }
  return {
    season,
    apply,
    planHash,
    acknowledgeCompletedSeason: argv.includes('--acknowledge-completed-season'),
  };
}

/* ------------------------------------------------------------------ *
 * The plan
 * ------------------------------------------------------------------ */

/** The child rows that would be orphaned by anything other than a rekey in place. */
export type ChildCounts = {
  playerMatchStats: number;
  periodScores: number;
  achievements: number;
  periodStats: number;
  lineups: number;
  providerClaims: number;
  derivedClubRefs: number;
};

export type CanonicalRowFacts = {
  id: number;
  matchKey: string;
  roundCode: string;
  roundType: string;
  matchDate: string;
  sourceRecordId: string | null;
  children: ChildCounts;
};

export type RepairAction = 'rekey_in_place' | 'report_only' | 'refuse';

export type RepairPlanEntry = {
  /** The source record the feed still publishes for this fixture. */
  externalRecordId: string;
  sourceVersionSeq: number;
  /** The rendering that record is written under; see the header's §3.6 proof. */
  matchKey: string;
  season: number;
  matchDate: string;
  homeClubId: number;
  awayClubId: number;
  roundCode: string;
  roundNumber: number | null;
  roundType: string;
  isFinal: boolean;
  /** The canonical row already on the live rendering, if there is one. */
  live: CanonicalRowFacts | null;
  /** Canonical rows under a retired rendering of the SAME fixture. */
  stale: readonly CanonicalRowFacts[];
  action: RepairAction;
  refusal: string | null;
  reason: string;
};

export type RepairValidation = {
  duplicateFixtureGroupsInSeason: number;
  duplicateFixtureGroupsAllSeasons: number;
  wildcardFinalMatches: number;
  finalsSeriesMatches: number;
  clubSeasonsFinalsPlayedSum: number | null;
  finalsAccountingBalanced: boolean;
};

function emptyChildren(): ChildCounts {
  return {
    playerMatchStats: 0, periodScores: 0, achievements: 0,
    periodStats: 0, lineups: 0, providerClaims: 0, derivedClubRefs: 0,
  };
}

function hasChildren(counts: ChildCounts): boolean {
  return Object.values(counts).some((value) => value > 0);
}

/**
 * The plan hash. Covers exactly what the operator reviewed — the fixtures, the
 * canonical ids on each side, and the action chosen — and nothing volatile.
 */
export function hashPlan(plan: readonly RepairPlanEntry[]): string {
  const shape = plan.map((entry) => ({
    external_record_id: entry.externalRecordId,
    match_key: entry.matchKey,
    live_id: entry.live?.id ?? null,
    stale_ids: entry.stale.map((row) => row.id),
    action: entry.action,
  }));
  return createHash('sha256')
    .update(canonicalJson(shape as unknown as JsonValue))
    .digest('hex');
}

async function sourceIdOf(sql: Sql | Tx): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    SELECT id::int AS id FROM sources WHERE key = ${SOURCE_KEY}
  `;
  if (!row) throw new Error(`No sources row for '${SOURCE_KEY}'; nothing to repair.`);
  return row.id;
}

/**
 * §3.6, reported rather than assumed: how many of the season's AFL Tables-owned
 * canonical rows do NOT carry the settle's identity convention. Informational —
 * the binding check is per fixture, in `derivePlan()`.
 */
async function offConventionRows(
  sql: Sql | Tx, season: number, sourceId: number,
): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
      FROM matches
     WHERE season = ${season} AND source_id = ${sourceId}
       AND (source_record_id IS NULL OR source_record_id <> match_key)
  `;
  return row?.n ?? 0;
}

async function childCountsOf(sql: Sql | Tx, matchId: number): Promise<ChildCounts> {
  const [row] = await sql<ChildCounts[]>`
    SELECT
      (SELECT count(*)::int FROM player_match_stats s WHERE s.match_id = ${matchId})
        AS "playerMatchStats",
      (SELECT count(*)::int FROM match_period_scores p WHERE p.match_id = ${matchId})
        AS "periodScores",
      (SELECT count(*)::int FROM player_achievements a WHERE a.match_id = ${matchId})
        AS "achievements",
      (SELECT count(*)::int FROM player_match_period_stats q WHERE q.match_id = ${matchId})
        AS "periodStats",
      (SELECT count(*)::int FROM staging.afl_api_lineup l WHERE l.match_id = ${matchId})
        AS "lineups",
      (SELECT count(*)::int FROM staging.external_current_matches e
        WHERE e.local_match_id = ${matchId}) AS "providerClaims",
      -- AFLDB-ISSUE-131 §5.5 named this as player_career_stats; the
      -- first_match_id / last_match_id pair at 007_derived_stats.sql:135-136
      -- is on player_clubs. Corrected here against the live schema.
      (SELECT count(*)::int FROM player_clubs c
        WHERE c.first_match_id = ${matchId} OR c.last_match_id = ${matchId})
        AS "derivedClubRefs"
  `;
  return row ?? emptyChildren();
}

async function canonicalFactsOf(
  sql: Sql | Tx, matchId: number,
): Promise<CanonicalRowFacts | null> {
  const [row] = await sql<{
    id: number; matchKey: string; roundCode: string; roundType: string;
    matchDate: string; sourceRecordId: string | null;
  }[]>`
    SELECT id::int AS id, match_key AS "matchKey", round_code AS "roundCode",
           round_type::text AS "roundType", match_date::text AS "matchDate",
           source_record_id AS "sourceRecordId"
      FROM matches WHERE id = ${matchId}
  `;
  if (!row) return null;
  return { ...row, children: await childCountsOf(sql, matchId) };
}

/**
 * Derive the plan. Read-only, and run twice: once for the operator to review,
 * once inside the `--apply` transaction so the hash can be compared.
 */
export async function derivePlan(
  sql: Sql | Tx, season: number, sourceId: number,
): Promise<RepairPlanEntry[]> {
  // Every identity the feed STILL publishes for this season, with the typed
  // projection the last settle wrote for it. `absent_since IS NULL` is the
  // sweep's durable statement that the source has not retired it.
  const published = await sql<{
    externalRecordId: string; sourceVersionSeq: number;
    roundCode: string; roundNumber: number | null; roundType: string; isFinal: boolean;
    matchDate: string; homeClubId: number; awayClubId: number;
  }[]>`
    SELECT r.external_record_id AS "externalRecordId",
           r.current_version_seq::int AS "sourceVersionSeq",
           p.round_code AS "roundCode", p.round_number::int AS "roundNumber",
           p.round_type::text AS "roundType", p.is_final AS "isFinal",
           p.match_date::text AS "matchDate",
           p.home_club_id::int AS "homeClubId", p.away_club_id::int AS "awayClubId"
      FROM staging.source_records r
      JOIN staging.afltables_match p
        ON p.source_id = r.source_id AND p.family = r.family
       AND p.external_record_id = r.external_record_id
     WHERE r.source_id = ${sourceId} AND r.family = ${MATCH_FAMILY}
       AND r.absent_since IS NULL
       AND p.season = ${season}
     ORDER BY p.match_date, r.external_record_id
  `;

  const plan: RepairPlanEntry[] = [];
  for (const record of published) {
    // The convention proved above: the live rendering IS the record id.
    const matchKey = record.externalRecordId;
    const retired = await findRetiredMatchIdentities(
      sql,
      {
        season,
        sourceId,
        family: MATCH_FAMILY,
        matchKey,
        roundCode: record.roundCode,
        matchDate: record.matchDate,
        homeClubId: record.homeClubId,
        awayClubId: record.awayClubId,
      },
      { kind: 'absent_observation' },
    );
    if (retired.length === 0) continue;

    const [liveRow] = await sql<{ id: number }[]>`
      SELECT id::int AS id FROM matches WHERE match_key = ${matchKey}
    `;
    const live = liveRow ? await canonicalFactsOf(sql, liveRow.id) : null;
    const stale: CanonicalRowFacts[] = [];
    for (const candidate of retired) {
      const facts = await canonicalFactsOf(sql, candidate.id);
      if (facts) stale.push(facts);
    }

    let action: RepairAction;
    let refusal: string | null = null;
    let reason: string;
    if (stale.length !== retired.length) {
      // A candidate the search returned but `canonicalFactsOf()` could not
      // read. Nothing here may proceed on a partial view of the fixture, and
      // an unreadable candidate is evidence to refuse on, never to index past.
      action = 'refuse';
      refusal = 'rekey_candidate_unreadable';
      reason = `${retired.length} retired canonical row(s) were matched but only `
        + `${stale.length} could be read back; the fixture is not fully described.`;
    } else if (stale.length > 1) {
      action = 'refuse';
      refusal = 'rekey_ambiguous';
      reason = `${stale.length} retired canonical rows could each be this fixture; `
        + 'no automatic answer exists.';
    } else if (live === null && stale[0].sourceRecordId !== stale[0].matchKey) {
      // §3.6. The rendering this record would be written under is not proven
      // for this fixture, and the tool does not guess one.
      action = 'refuse';
      refusal = 'identity_convention_unproven';
      reason = `the retired row cites '${stale[0].sourceRecordId ?? 'nothing'}' but is keyed `
        + `'${stale[0].matchKey}', so this tool cannot prove which rendering the live record `
        + 'belongs under.';
    } else if (live === null) {
      action = 'rekey_in_place';
      reason = 'the live identity has no canonical row, so the retired row is rekeyed forward '
        + 'onto it and keeps its id, its children and its provenance.';
    } else if (!hasChildren(stale[0].children)) {
      action = 'report_only';
      reason = 'the retired row carries no dependent data, but retiring an empty row needs a '
        + 'DELETE this role does not hold and must not hold. Reported for a separate, '
        + 'supervised decision.';
    } else {
      action = 'refuse';
      refusal = 'rekey_would_merge';
      reason = 'both canonical rows carry dependent data. Two populated canonical graphs are '
        + 'never merged automatically.';
    }

    plan.push({
      externalRecordId: record.externalRecordId,
      sourceVersionSeq: record.sourceVersionSeq,
      matchKey,
      season,
      matchDate: record.matchDate,
      homeClubId: record.homeClubId,
      awayClubId: record.awayClubId,
      roundCode: record.roundCode,
      roundNumber: record.roundNumber,
      roundType: record.roundType,
      isFinal: record.isFinal,
      live,
      stale,
      action,
      refusal,
      reason,
    });
  }
  return plan;
}

/* ------------------------------------------------------------------ *
 * Validation (§8.8)
 * ------------------------------------------------------------------ */

export async function readValidation(
  sql: Sql | Tx, season: number,
): Promise<RepairValidation> {
  const [inSeason] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (
      SELECT 1 FROM matches WHERE season = ${season}
       GROUP BY season, match_date, home_club_id, away_club_id HAVING count(*) > 1
    ) v
  `;
  const [allSeasons] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (
      SELECT 1 FROM matches
       GROUP BY season, match_date, home_club_id, away_club_id HAVING count(*) > 1
    ) v
  `;
  const [wildcard] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM matches
     WHERE season = ${season} AND round_type = 'wildcard_final'
  `;
  const [finals] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM matches
     WHERE season = ${season} AND is_finals_series
  `;
  const [clubs] = await sql<{ total: number | null }[]>`
    SELECT sum(finals_played)::int AS total FROM club_seasons WHERE season = ${season}
  `;
  const clubSeasonsFinalsPlayedSum = clubs?.total ?? null;
  return {
    duplicateFixtureGroupsInSeason: inSeason?.n ?? 0,
    duplicateFixtureGroupsAllSeasons: allSeasons?.n ?? 0,
    wildcardFinalMatches: wildcard?.n ?? 0,
    finalsSeriesMatches: finals?.n ?? 0,
    clubSeasonsFinalsPlayedSum,
    // A Wildcard Final is a final and is NOT finals series (ISSUE-129), so the
    // club-side finals tally must still be exactly two per finals-series match.
    finalsAccountingBalanced: clubSeasonsFinalsPlayedSum === null
      ? false
      : clubSeasonsFinalsPlayedSum === 2 * (finals?.n ?? 0),
  };
}

function validationLines(title: string, validation: RepairValidation): string[] {
  return [
    '',
    title,
    `  duplicate fixture groups (season):     ${validation.duplicateFixtureGroupsInSeason}`,
    `  duplicate fixture groups (all seasons): ${validation.duplicateFixtureGroupsAllSeasons}`,
    `  wildcard_final matches:                ${validation.wildcardFinalMatches}`,
    `  finals-series matches:                 ${validation.finalsSeriesMatches}`,
    `  club_seasons finals_played sum:        ${validation.clubSeasonsFinalsPlayedSum ?? 'none'}`,
    `  finals accounting balanced:            ${validation.finalsAccountingBalanced}`,
  ];
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function childLine(counts: ChildCounts): string {
  return `pms=${counts.playerMatchStats} periods=${counts.periodScores} `
    + `achievements=${counts.achievements} periodStats=${counts.periodStats} `
    + `lineups=${counts.lineups} providerClaims=${counts.providerClaims} `
    + `derivedClubRefs=${counts.derivedClubRefs}`;
}

export function renderPlan(plan: readonly RepairPlanEntry[]): string[] {
  const lines: string[] = ['', `Plan (${plan.length} fixture(s) needing attention)`];
  if (plan.length === 0) {
    lines.push('  Nothing to repair: no canonical row sits under a retired identity of a '
      + 'fixture the source still publishes.');
    return lines;
  }
  for (const entry of plan) {
    lines.push('');
    lines.push(
      `  ${entry.matchDate}  clubs ${entry.homeClubId} v ${entry.awayClubId}  `
      + `-> ${entry.action.toUpperCase()}${entry.refusal ? ` (${entry.refusal})` : ''}`,
    );
    lines.push(`    live record   ${entry.externalRecordId} (v${entry.sourceVersionSeq})`);
    lines.push(
      `    live rendering ${entry.matchKey} — round ${entry.roundCode} `
      + `(${entry.roundType}${entry.isFinal ? ', final' : ''})`,
    );
    lines.push(entry.live === null
      ? '    live canonical row: NONE'
      : `    live canonical row: id ${entry.live.id} ${entry.live.matchKey} `
        + `[${childLine(entry.live.children)}]`);
    for (const row of entry.stale) {
      lines.push(
        `    retired canonical row: id ${row.id} ${row.matchKey} — round ${row.roundCode} `
        + `(${row.roundType}) ${row.matchDate} [${childLine(row.children)}]`,
      );
    }
    lines.push(`    why: ${entry.reason}`);
  }
  return lines;
}

/* ------------------------------------------------------------------ *
 * The apply
 * ------------------------------------------------------------------ */

/** What one fixture's savepoint concluded. */
type EntryOutcome = 'rekeyed' | 'override_conflict' | 'plan_moved';

/**
 * Rolls one fixture's savepoint back without failing the run, carrying the
 * reason out with it so the refusal is reported rather than swallowed.
 */
class RepairSavepointRollback extends Error {
  constructor(readonly outcome: EntryOutcome) {
    super(`repair savepoint rolled back: ${outcome}`);
  }
}

/** The identity fields a repair moves. Nothing else is touched. */
const REKEY_FIELDS = [
  'match_key', 'round_code', 'round_number', 'round_type', 'is_final', 'match_date',
] as const;

export type RepairOutcome = {
  args: RepairArgs;
  databaseName: string;
  plan: RepairPlanEntry[];
  planHash: string;
  before: RepairValidation;
  after: RepairValidation | null;
  rekeyed: number;
  refused: number;
  reportOnly: number;
  applied: boolean;
  batchId: ImportBatchId | null;
};

async function applyEntry(
  sp: Tx, entry: RepairPlanEntry, sourceId: number, batchId: ImportBatchId,
): Promise<EntryOutcome> {
  // Re-derived under the lock, inside this savepoint. Nothing from the plan
  // above is trusted as state; it is trusted only as the operator's consent.
  const retired = await findRetiredMatchIdentities(
    sp,
    {
      season: entry.season,
      sourceId,
      family: MATCH_FAMILY,
      matchKey: entry.matchKey,
      roundCode: entry.roundCode,
      matchDate: entry.matchDate,
      homeClubId: entry.homeClubId,
      awayClubId: entry.awayClubId,
    },
    { kind: 'absent_observation' },
    true,
  );
  if (retired.length !== 1 || retired[0].id !== entry.stale[0]?.id) return 'plan_moved';
  const [live] = await sp<{ id: number }[]>`
    SELECT id::int AS id FROM matches WHERE match_key = ${entry.matchKey}
  `;
  if (live) return 'plan_moved';

  const [current] = await sp<Record<string, unknown>[]>`
    SELECT match_key, round_code, round_number::int AS round_number,
           round_type::text AS round_type, is_final, match_date::text AS match_date
      FROM matches WHERE id = ${retired[0].id}
  `;
  if (!current) return 'plan_moved';

  // §5.7. The human decision moves first, so a conflict leaves this savepoint
  // with nothing written rather than a rekeyed row and an orphaned override.
  const carry = await carryMatchOverrides(sp, retired[0].matchKey, entry.matchKey);
  if ('conflict' in carry) return 'override_conflict';

  const next: Record<string, JsonValue> = {
    match_key: entry.matchKey,
    round_code: entry.roundCode,
    round_number: entry.roundNumber,
    round_type: entry.roundType,
    is_final: entry.isFinal,
    match_date: entry.matchDate,
  };
  const previousValues: Record<string, JsonValue> = {};
  const newValues: Record<string, JsonValue> = {};
  for (const field of REKEY_FIELDS) {
    const was = (current[field] ?? null) as JsonValue;
    if (was === next[field]) continue;
    previousValues[field] = was;
    newValues[field] = next[field];
  }
  if (Object.keys(newValues).length === 0) return 'plan_moved';

  await sp`
    UPDATE matches
       SET ${sp(next as never)},
           source_record_id = ${entry.externalRecordId},
           import_batch_id = ${batchId},
           imported_at = now()
     WHERE id = ${retired[0].id}
  `;
  // §8.7 / SC2. The audit row, in the SAME savepoint as the mutation, with the
  // retired rendering in `previous_values` and the live one in `new_values`.
  await sp`
    INSERT INTO canonical_applications (
      import_batch_id, source_id, family, external_record_id, source_version_seq,
      target_table, target_key, verb, previous_values, new_values
    ) VALUES (
      ${batchId}, ${sourceId}, ${MATCH_FAMILY}, ${entry.externalRecordId},
      ${entry.sourceVersionSeq}, 'matches',
      ${sp.json(JSON.parse(canonicalJson({ match_key: entry.matchKey })) as never)},
      'update',
      ${sp.json(JSON.parse(canonicalJson(previousValues as JsonValue)) as never)},
      ${sp.json(JSON.parse(canonicalJson(newValues as JsonValue)) as never)}
    )
  `;
  return 'rekeyed';
}

export type RepairDeps = {
  sql?: Sql;
  log?: (line: string) => void;
  projectRoot?: string;
};

export async function runRepairMatchRekeys(
  argv: readonly string[], deps: RepairDeps = {},
): Promise<RepairOutcome> {
  const projectRoot = deps.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const log = deps.log ?? ((line: string) => console.log(line));
  const args = parseRepairArgs(argv);

  // §8.2. Offline first: a season this pipeline does not own is refused before
  // any connection is opened.
  const seasons = JSON.parse(
    readFileSync(join(projectRoot, 'data', 'reference', 'seasons.json'), 'utf8'),
  ) as { in_progress_seasons?: unknown };
  const inProgress = Array.isArray(seasons.in_progress_seasons)
    ? seasons.in_progress_seasons.filter((year): year is number => typeof year === 'number')
    : [];
  if (!inProgress.includes(args.season) && !args.acknowledgeCompletedSeason) {
    throw new Error(
      `Season ${args.season} is not in seasons.json in_progress_seasons `
      + `(${inProgress.join(', ') || 'none'}). This tool repairs the in-season settle path; `
      + 'pass --acknowledge-completed-season only if you mean a completed season.',
    );
  }

  const ownsClient = deps.sql === undefined;
  const dsn = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (ownsClient && !dsn) throw new Error('AFLDB_IMPORT_DATABASE_URL is not set.');
  const sql = deps.sql ?? postgres(dsn as string, {
    max: 1, onnotice: () => {}, transform: { undefined: null },
  });

  try {
    const [dbRow] = await sql<{ name: string }[]>`SELECT current_database() AS name`;
    const databaseName = dbRow?.name ?? 'unknown';
    log(`repair-match-rekeys — database '${databaseName}', season ${args.season}, `
      + `${args.apply ? 'APPLY' : 'dry run'}.`);

    const sourceId = await sourceIdOf(sql);
    const offConvention = await offConventionRows(sql, args.season, sourceId);
    if (offConvention > 0) {
      log(
        `  Note: ${offConvention} AFL Tables-owned canonical row(s) in this season do not carry `
        + 'match_key = source_record_id (AFLDB-ISSUE-131 §3.6). Any fixture that depends on '
        + 'that convention to name a rendering is refused rather than repaired.',
      );
    }

    const before = await readValidation(sql, args.season);
    for (const line of validationLines('Validation BEFORE', before)) log(line);

    const plan = await derivePlan(sql, args.season, sourceId);
    for (const line of renderPlan(plan)) log(line);
    const planHash = hashPlan(plan);
    log('');
    log(`Plan hash: ${planHash}`);

    const rekeyable = plan.filter((entry) => entry.action === 'rekey_in_place');
    const refused = plan.filter((entry) => entry.action === 'refuse').length;
    const reportOnly = plan.filter((entry) => entry.action === 'report_only').length;

    if (!args.apply) {
      log('');
      log(
        `Dry run. Nothing was written. ${rekeyable.length} fixture(s) would be rekeyed in `
        + `place, ${reportOnly} reported only, ${refused} refused. Re-run with `
        + `--apply --plan-hash ${planHash} to commit exactly this plan.`,
      );
      return {
        args, databaseName, plan, planHash, before, after: null,
        rekeyed: 0, refused, reportOnly, applied: false, batchId: null,
      };
    }

    if (args.planHash !== planHash) {
      throw new Error(
        `Refusing to apply: the plan has changed since it was reviewed. Reviewed `
        + `${args.planHash}, current ${planHash}. Re-run the dry run and read the new plan.`,
      );
    }

    let rekeyed = 0;
    let batchId: ImportBatchId | null = null;
    /** Held until the transaction commits; see below. */
    const entryLines: string[] = [];
    await sql.begin(async (tx) => {
      // §8.6. The plan is re-derived INSIDE the transaction. A retry against
      // data that moved must abort, not quietly do something else.
      const confirmed = await derivePlan(tx, args.season, sourceId);
      const confirmedHash = hashPlan(confirmed);
      if (confirmedHash !== planHash) {
        throw new Error(
          `Refusing to apply: the plan changed between reading it and locking it `
          + `(${planHash} -> ${confirmedHash}). Nothing was written.`,
        );
      }

      const [batch] = await tx<{ id: string }[]>`
        INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
        VALUES (${sourceId}, 'repair-match-rekeys.ts', 'matches',
                ${confirmed.length},
                ${`AFLDB-ISSUE-131 §8 repair; season=${args.season}; plan=${planHash}`})
        RETURNING id
      `;
      batchId = asImportBatchId(batch.id);

      for (const entry of confirmed.filter((row) => row.action === 'rekey_in_place')) {
        // §8.6. Per-fixture savepoints, so one refusal does not abort the run.
        const outcome = await tx.savepoint<EntryOutcome>(async (scope) => {
          const result = await applyEntry(
            scope as Tx, entry, sourceId, batchId as ImportBatchId,
          );
          if (result !== 'rekeyed') throw new RepairSavepointRollback(result);
          return result;
        }).catch((error: unknown) => {
          if (error instanceof RepairSavepointRollback) return error.outcome;
          throw error;
        });
        if (outcome === 'rekeyed') {
          rekeyed += 1;
          entryLines.push(`  rekeyed match ${entry.stale[0]?.id} -> ${entry.matchKey}`);
        } else {
          entryLines.push(
            `  REFUSED ${entry.matchKey}: ${outcome === 'override_conflict'
              ? 'a live human override exists under both renderings'
              : 'the state moved under the lock'}. Nothing was written for it.`,
          );
        }
      }

      // §8.7. The batch row is CLOSED inside the same transaction that wrote
      // its mutations, exactly as `runSettleAfltables()` closes its own: a row
      // left `running` forever is indistinguishable from a crashed run, and
      // `ix_import_batches_status` keys on that value.
      await tx`
        UPDATE import_batches
           SET completed_at = now(), status = 'completed', records_rejected = 0
         WHERE id = ${batchId}
      `;
    });
    // Printed only now. Inside `sql.begin()` nothing is committed yet, so a
    // per-fixture success line there would claim a write that a later error
    // could still roll back.
    for (const line of entryLines) log(line);

    const after = await readValidation(sql, args.season);
    for (const line of validationLines('Validation AFTER', after)) log(line);
    log('');
    log(
      `Applied as import batch ${batchId}: ${rekeyed} fixture(s) rekeyed in place, `
      + `${reportOnly} reported only, ${refused} refused. No row was deleted.`,
    );
    return {
      args, databaseName, plan, planHash, before, after,
      rekeyed, refused, reportOnly, applied: true, batchId,
    };
  } finally {
    if (ownsClient) await sql.end({ timeout: 5 });
  }
}



async function main(): Promise<void> {
  await runRepairMatchRekeys(process.argv.slice(2));
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
