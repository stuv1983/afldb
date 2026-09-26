/**
 * AFLDB-ISSUE-231 — ROLLBACK-ONLY code_test_db rehearsal of the retired-identity rekey that the
 * season enumeration scopes (residual 1) and of the D-231-3 absence lifecycle (residual 2), against
 * real PostgreSQL.
 *
 *     AFLDB_CODE_TEST_DATABASE_URL=<owner DSN naming code_test_db> \
 *     AFLDB_CODE_TEST_IMPORT_DATABASE_URL=<afldb_import DSN naming code_test_db> \
 *       npx tsx tools/db/afl-api-season-rekey-rehearsal.ts run --acknowledge code_test_db
 *     ... residue      (read-only census of the fixture namespace; expect all zero)
 *
 * ROLLBACK-ONLY. Every scenario runs inside ONE outer transaction on the import connection that
 * is always rolled back, so nothing is ever committed. The settle is the real exported
 * `runSettleAflApi()` and the acknowledgement the real exported `acknowledgeAflApiMatchAbsence()`;
 * each `sql.begin()` they issue is served by a SAVEPOINT of that outer transaction
 * (`savepointSql()`). That is exactly the D-231-3 boundary under test: the settle's HALT is a
 * ROLLBACK TO SAVEPOINT, and the durable absence finding written AFTER it is a second, separate
 * savepoint that is RELEASED, so the finding is visible to the rest of the scenario while the
 * halted settle left nothing. No committed subtransaction is needed to prove the lifecycle, so
 * none is used. Every decision is made by the real exported functions; nothing here re-implements
 * one. Sequences advanced inside a rolled-back transaction stay advanced (PostgreSQL never winds
 * a sequence back); that is the one known exception to "zero residue", and code_test_db is the
 * disposable rehearsal database.
 *
 * FIXTURES. The tracked 2026 unit (`tests/fixtures/afl_api/match/01-…03-…`) renamed onto
 * `CD_M2026231R*` provider ids and moved onto June 2026 dates (AEST, UTC+10, so the §11.1
 * local-time cross-check still proves the date), in the home-and-away rounds api Rd 1/Rd 2. Every
 * season feed is the retained 2026 feed (`tests/fixtures/afl_api/seasons/00-season-matches-2026.raw.json`,
 * a sanitised derivative of the captured response 9c358984…75ee, sha256 4f8235e0…babb) with the
 * scenario's listed records appended, so its envelope is the
 * measured one; an "incomplete" feed is the same text with `numEntries` off by one
 * (`pagination_mismatch`). The "old" afl_api-owned rows are seeded THROUGH THE REAL WRITER (a first
 * settle with no feed), never inserted by hand.
 *
 * SCENARIOS (ISSUE-231 runbook §6a, extended for D-231-3 in §4b):
 *   S1  complete feed, old afl_api-owned CD_M absent, new CD_M on the same fixture: the resolver
 *       reaches retired_identity; the unacknowledged settle now HALTs on exactly that absence.
 *   S2  the same with the feed NOT retained (incomplete): the F030 `possible_existing_match`
 *       refusal; no rekey, no write to the old row, no second row, no absence finding.
 *   S3  two retired candidates: HALT + two findings; both acknowledged; then `rekey_ambiguous`,
 *       neither candidate touched, no new row.
 *   S4  first disappearance: HALT, the settle leaves zero state, exactly one keyed open finding in
 *       the separate transaction, no stamp; a repeat halts again without a duplicate and keeps the
 *       first detection.
 *   S5  acknowledgement: validate-only writes nothing; the wrong --acknowledge database refuses;
 *       apply stamps absent_since = first detection and resolves the finding; nothing canonical.
 *   S6  the next settle proceeds: retired_identity reached, identity withheld (F010), provider id
 *       still the old one, no second row, absent_since kept.
 *   S7  reappearance: (a) an acknowledged absence listed again (not selected) clears absent_since;
 *       (b) an UNACKNOWLEDGED finding listed again closes `source_reappeared`, no stamp ever made.
 *   S8  stale acknowledgement: the supplied complete feed lists the id again -> refused, no write.
 *   S9  a second disappearance after S7(a)'s real reappearance: HALT + a NEW open finding; the
 *       resolved history whitelists nothing.
 *   S10 an incomplete feed cannot stamp, clear, acknowledge or open an absence finding.
 *   Zero namespace residue is proved before the run and after every scenario.
 *
 * TARGET. code_test_db ONLY (`resolveRehearsalDsns`, the ISSUE-237 fixture's guard, plus a
 * `current_database()` check inside every transaction). DEV, PROD and afldb_test are never
 * contacted. No DSN is printed.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres, { type Sql, type TransactionSql } from 'postgres';

import { parseAflApiIdentities, type AflApiIdentities } from '../../src/lib/acquisition/afl-api-bundle';
import {
  AFL_API_MATCH_ABSENCE_ACTOR_NOTE,
  AFL_API_MATCH_ABSENCE_HALT_REASON,
  AFL_API_MATCH_ABSENCE_ISSUE_TYPE,
  AFL_API_MATCH_ABSENCE_RESOLUTION,
  AflApiMatchAbsenceAckRefused,
  acknowledgeAflApiMatchAbsence,
  aflApiMatchAbsenceIssueKey,
  type AflApiMatchAbsenceAckOutcome,
} from '../../src/lib/acquisition/afl-api-match-absence';
import { buildAflApiMatchIdentity, resolveAflApiSourceId } from '../../src/lib/acquisition/afl-api-match-identity';
import { resolveAflApiMatch } from '../../src/lib/acquisition/afl-api-match-resolver';
import {
  aflApiMatchRekeyScope,
  assessAflApiSeasonEnumeration,
  type AflApiSeasonEnumeration,
} from '../../src/lib/acquisition/afl-api-season-enumeration';
import { findPlausibleCanonicalFixtures } from '../../src/lib/acquisition/match-rekey';
import {
  buildAflApiSettleBundle,
  runSettleAflApi,
  type AflApiSettleBundle,
  type AflApiSettleRunResult,
  type AflApiSettleUnitSource,
} from '../../src/lib/acquisition/settle-afl-api';
import { parseSourceFamilyRegistry, type SourceFamilyRegistry } from '../../src/lib/acquisition/source-families';
import { REHEARSAL_IMPORT_ENV, REHEARSAL_OWNER_ENV, resolveRehearsalDsns } from '../migration/afl_api_identity_rebuild_rehearsal_fixture';
import { redact } from './psql';

const PROJECT_ROOT = join(__dirname, '..', '..');

export const REKEY_REHEARSAL = {
  database: 'code_test_db',
  season: 2026,
  scopeKey: 'season=2026',
  compSeasonProviderId: 'CD_S2026014',
  providerPrefix: 'CD_M2026231R',
  providerLike: 'CD_M2026231R%',
  labelPrefix: 'issue231-rekey-rehearsal',
} as const;

/** Provider ids, dates and api round numbers per role. Two ids never share a (round, date). */
export const REKEY_CASES = {
  // S1/S2/S4–S10: OLD at (Rd 1, 06-02); NEW one date step later at (Rd 1, 06-03).
  old: { providerId: `${REKEY_REHEARSAL.providerPrefix}OLD`, date: '2026-06-02', apiRound: 1 },
  new: { providerId: `${REKEY_REHEARSAL.providerPrefix}NEW`, date: '2026-06-03', apiRound: 1 },
  // S3: NEW differs from A by date only and from B by round only; A and B differ in both, so the
  // real writer's own F030 guard lets the second seed through.
  ambiguousA: { providerId: `${REKEY_REHEARSAL.providerPrefix}AMA`, date: '2026-06-09', apiRound: 1 },
  ambiguousB: { providerId: `${REKEY_REHEARSAL.providerPrefix}AMB`, date: '2026-06-10', apiRound: 2 },
  ambiguousNew: { providerId: `${REKEY_REHEARSAL.providerPrefix}AMN`, date: '2026-06-10', apiRound: 1 },
} as const;

export type RekeyCase = (typeof REKEY_CASES)[keyof typeof REKEY_CASES];

function readJson(...parts: string[]): unknown {
  return JSON.parse(readFileSync(join(PROJECT_ROOT, ...parts), 'utf8'));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * One unit's three payloads, renamed onto the case's provider id, date and H&A round. The same
 * renames the ISSUE-228 integration suite proves (`unitSourceFor`, `toHomeAndAwayRound`): both
 * halves of the local time move together, and `venueLocalStartTime` is added so the date is proved.
 */
export function rekeyRehearsalUnitSource(spec: RekeyCase): AflApiSettleUnitSource {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const fixture = clone(readJson('tests', 'fixtures', 'afl_api', 'match', '01-fixture-result.json')) as Record<string, any>;
  const roster = clone(readJson('tests', 'fixtures', 'afl_api', 'match', '03-match-roster.raw.json')) as Record<string, any>;
  const stats = clone(readJson('tests', 'fixtures', 'afl_api', 'match', '02-player-stats.raw.json')) as Record<string, any>;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  fixture.providerId = spec.providerId;
  fixture.utcStartTime = `${spec.date}T07:15:00.000+0000`;
  fixture.round = {
    ...fixture.round, abbreviation: `Rd ${spec.apiRound}`, name: `Round ${spec.apiRound}`, roundNumber: spec.apiRound,
  };
  roster.match.matchId = spec.providerId;
  roster.match.venueLocalStartTime = `${spec.date}T17:15:00`;
  roster.matchRoster.matchId = spec.providerId;
  roster.matchRoster.roundNumber = spec.apiRound;
  roster.matchRoster.homeTeam.matchId = spec.providerId;
  roster.matchRoster.awayTeam.matchId = spec.providerId;
  roster.recentMatchScores[0].matchId = spec.providerId;
  return { fixtureRaw: fixture, rosterRaw: roster, playerStatsRaw: stats };
}

/**
 * The authentic 2026 season feed text with `listed` appended. Complete by default (`numEntries`
 * raised to match); `incomplete` leaves it one short, which the real parser reads as
 * `pagination_mismatch`. It never lists a namespace id that is not in `listed`.
 */
export function rekeyRehearsalSeasonFeedText(
  listed: readonly AflApiSettleUnitSource[], options: { incomplete?: boolean } = {},
): string {
  const feed = readJson('tests', 'fixtures', 'afl_api', 'seasons', '00-season-matches-2026.raw.json') as {
    meta: { pagination: { numEntries: number } }; matches: unknown[];
  };
  feed.matches.push(...listed.map((source) => source.fixtureRaw));
  feed.meta.pagination.numEntries = feed.matches.length + (options.incomplete ? 1 : 0);
  return JSON.stringify(feed);
}

export function rekeyRehearsalEnumeration(feedText: string): AflApiSeasonEnumeration {
  return assessAflApiSeasonEnumeration(feedText, {
    season: REKEY_REHEARSAL.season, compSeasonProviderId: REKEY_REHEARSAL.compSeasonProviderId,
  });
}

/** The COMPLETE feed listing `incoming` (and never a seeded "old" id). */
export function rekeyRehearsalSeasonFeed(incoming: readonly AflApiSettleUnitSource[]): AflApiSeasonEnumeration {
  return rekeyRehearsalEnumeration(rekeyRehearsalSeasonFeedText(incoming));
}

export function rekeyRehearsalReferences(): { registry: SourceFamilyRegistry; identities: AflApiIdentities } {
  return {
    registry: parseSourceFamilyRegistry(readJson('data', 'reference', 'source-families.json')),
    identities: parseAflApiIdentities(readJson('data', 'reference', 'afl-api-identities.json')),
  };
}

export function rekeyRehearsalBundle(
  label: string, sources: readonly AflApiSettleUnitSource[], seasonFeed?: AflApiSeasonEnumeration,
): AflApiSettleBundle {
  const { registry, identities } = rekeyRehearsalReferences();
  const bundle = buildAflApiSettleBundle({
    season: REKEY_REHEARSAL.season, snapshotLabel: `${REKEY_REHEARSAL.labelPrefix}-${label}`,
    sources, registry, identities, seasonFeed,
  });
  if (bundle.buildFailures.length > 0) {
    throw new RehearsalRefused(`fixture unit failed to build: ${JSON.stringify(bundle.buildFailures)}`);
  }
  return bundle;
}

class RehearsalRefused extends Error {}
class ScenarioRollback extends Error {
  constructor() { super('AFLDB-ISSUE-231 rehearsal scenario: rolling back deliberately'); this.name = 'ScenarioRollback'; }
}

/**
 * The outer transaction, presented as the `postgres.Sql` the settle and the acknowledgement
 * expect. Both only ever call `sql.begin(fn)`; here each opens a savepoint instead, so their
 * commits stay inside the outer transaction this harness always rolls back.
 */
export function savepointSql(outer: TransactionSql): Sql {
  return {
    begin: (fn: (tx: TransactionSql) => unknown) => outer.savepoint(fn as never),
  } as unknown as Sql;
}

type Check = { name: string; pass: boolean; detail: string };
type CheckFn = (name: string, pass: boolean, detail?: string) => void;
type Db = Sql | TransactionSql;

async function assertCodeTestDb(tx: Db): Promise<void> {
  const [{ database }] = await tx<{ database: string }[]>`SELECT current_database() AS database`;
  if (database !== REKEY_REHEARSAL.database) throw new RehearsalRefused(`connected to '${database}', not code_test_db`);
}

/** Every row the namespace can reach. All zero before the run and after every scenario. */
async function census(sql: Db): Promise<Record<string, number>> {
  const [row] = await sql<Record<string, number>[]>`
    SELECT
      (SELECT count(*)::int FROM matches WHERE source_record_id LIKE ${REKEY_REHEARSAL.providerLike}) AS matches,
      (SELECT count(*)::int FROM staging.source_records WHERE external_record_id LIKE ${REKEY_REHEARSAL.providerLike}) AS spine,
      (SELECT count(*)::int FROM staging.source_records WHERE external_record_id LIKE ${REKEY_REHEARSAL.providerLike}
          AND absent_since IS NOT NULL) AS "spineAbsent",
      (SELECT count(*)::int FROM staging.source_record_versions WHERE external_record_id LIKE ${REKEY_REHEARSAL.providerLike}) AS versions,
      (SELECT count(*)::int FROM staging.afl_api_match WHERE external_record_id LIKE ${REKEY_REHEARSAL.providerLike}) AS "matchProjection",
      (SELECT count(*)::int FROM player_match_stats WHERE source_record_id LIKE ${`${REKEY_REHEARSAL.providerPrefix}%|%`}) AS "playerStats",
      (SELECT count(*)::int FROM canonical_applications WHERE external_record_id LIKE ${REKEY_REHEARSAL.providerLike}) AS ledger,
      (SELECT count(*)::int FROM promotion_candidates WHERE external_record_id LIKE ${REKEY_REHEARSAL.providerLike}) AS candidates,
      (SELECT count(*)::int FROM data_issues WHERE issue_key LIKE ${`%${REKEY_REHEARSAL.providerPrefix}%`}) AS findings,
      (SELECT count(*)::int FROM import_batches WHERE notes LIKE ${`%snapshot=${REKEY_REHEARSAL.labelPrefix}-%`}) AS batches
  `;
  return row;
}

/** The census with the absence findings split out, for "the halted settle left nothing" comparisons. */
async function ordinaryState(tx: TransactionSql): Promise<Record<string, number>> {
  const all = await census(tx);
  const [{ absence }] = await tx<{ absence: number }[]>`
    SELECT count(*)::int AS absence FROM data_issues
     WHERE issue_type = ${AFL_API_MATCH_ABSENCE_ISSUE_TYPE} AND issue_key LIKE ${`%${REKEY_REHEARSAL.providerPrefix}%`}
  `;
  return { ...all, findings: all.findings - absence };
}

type MatchRow = { id: number; sourceId: number | null; sourceRecordId: string | null; matchDate: string; roundCode: string; matchKey: string };

async function matchesOf(tx: TransactionSql, providerIds: readonly string[]): Promise<MatchRow[]> {
  const rows = await tx<MatchRow[]>`
    SELECT id::int AS id, source_id::int AS "sourceId", source_record_id AS "sourceRecordId",
           to_char(match_date, 'YYYY-MM-DD') AS "matchDate", round_code AS "roundCode", match_key AS "matchKey"
      FROM matches WHERE source_record_id = ANY (${[...providerIds]}::text[]) ORDER BY id
  `;
  return [...rows];
}

type FindingRow = {
  id: string; issueType: string; open: boolean; resolution: string | null; detectedAt: string;
  details: Record<string, unknown>;
};

async function findingsOf(tx: TransactionSql, issueKey: string): Promise<FindingRow[]> {
  const rows = await tx<FindingRow[]>`
    SELECT id::text AS id, issue_type AS "issueType", resolved_at IS NULL AS open, resolution,
           detected_at::text AS "detectedAt", details
      FROM data_issues WHERE issue_key = ${issueKey} ORDER BY id
  `;
  return [...rows];
}

const absenceKey = (providerId: string) => aflApiMatchAbsenceIssueKey(REKEY_REHEARSAL.scopeKey, providerId);

/** `absent_since` of one namespace spine row: null when unstamped, undefined when there is no row. */
async function absentSinceOf(tx: TransactionSql, providerId: string): Promise<{ absentSince: string | null; equals: (iso: string) => Promise<boolean> } | undefined> {
  const [row] = await tx<{ absentSince: string | null }[]>`
    SELECT absent_since::text AS "absentSince" FROM staging.source_records
     WHERE family = 'match' AND external_record_id = ${providerId}
  `;
  if (!row) return undefined;
  return {
    absentSince: row.absentSince,
    equals: async (iso: string) => {
      const [{ eq }] = await tx<{ eq: boolean }[]>`
        SELECT absent_since = ${iso}::timestamptz AS eq FROM staging.source_records
         WHERE family = 'match' AND external_record_id = ${providerId}
      `;
      return eq === true;
    },
  };
}

async function settle(
  outer: TransactionSql, bundle: AflApiSettleBundle, observedAt?: string,
): Promise<AflApiSettleRunResult> {
  const { registry } = rekeyRehearsalReferences();
  return runSettleAflApi(savepointSql(outer), {
    bundle, registry, apply: true, autoApply: true, inProgressSeasons: [REKEY_REHEARSAL.season], observedAt,
  });
}

/** The real acknowledgement core, against a rehearsal feed text (the CLI's manifest step is file-only). */
async function acknowledge(
  outer: TransactionSql,
  input: { providerId: string; findingId: string; feedText: string; apply: boolean; database?: string; label: string },
): Promise<AflApiMatchAbsenceAckOutcome | AflApiMatchAbsenceAckRefused> {
  try {
    return await acknowledgeAflApiMatchAbsence(savepointSql(outer), {
      season: REKEY_REHEARSAL.season,
      compSeasonProviderId: REKEY_REHEARSAL.compSeasonProviderId,
      externalRecordId: input.providerId,
      findingId: input.findingId,
      snapshotLabel: `${REKEY_REHEARSAL.labelPrefix}-${input.label}`,
      seasonFeedText: input.feedText,
      seasonFeedSha256: createHash('sha256').update(input.feedText, 'utf8').digest('hex'),
      apply: input.apply,
      acknowledgeDatabase: input.apply ? (input.database ?? REKEY_REHEARSAL.database) : null,
    });
  } catch (error) {
    if (error instanceof AflApiMatchAbsenceAckRefused) return error;
    throw error;
  }
}

/** Seed one afl_api-owned canonical match through the real writer (no feed: the unchanged default path). */
async function seedThroughWriter(outer: TransactionSql, spec: RekeyCase): Promise<MatchRow> {
  const result = await settle(outer, rekeyRehearsalBundle(`seed-${spec.providerId}`, [rekeyRehearsalUnitSource(spec)]));
  const [row] = await matchesOf(outer, [spec.providerId]);
  if (!result.applied || result.halt !== null || row === undefined) {
    throw new RehearsalRefused(`seeding ${spec.providerId} through the writer did not create an afl_api-owned match: `
      + JSON.stringify({ applied: result.applied, halt: result.halt, counters: result.counters }));
  }
  return row;
}

async function identityOf(tx: TransactionSql, bundle: AflApiSettleBundle) {
  const sourceId = await resolveAflApiSourceId(tx);
  return buildAflApiMatchIdentity(tx, sourceId, bundle.units[0].bundle);
}

const isAbsenceHalt = (result: AflApiSettleRunResult, ids: readonly string[]) =>
  !result.applied && result.batchId === null && result.halt?.reason === AFL_API_MATCH_ABSENCE_HALT_REASON
  && JSON.stringify(result.halt.detail.newlyAbsent) === JSON.stringify([...ids].sort());

/**
 * Seed OLD, then settle a complete feed that omits it: the first-disappearance HALT and its one
 * finding. Shared by S4–S10; S4 is where each of its properties is asserted.
 */
async function haltOnOld(outer: TransactionSql, label: string): Promise<{ old: MatchRow; result: AflApiSettleRunResult; finding: FindingRow; observedAt: string }> {
  const old = await seedThroughWriter(outer, REKEY_CASES.old);
  const incoming = rekeyRehearsalUnitSource(REKEY_CASES.new);
  const observedAt = new Date().toISOString();
  const result = await settle(outer, rekeyRehearsalBundle(label, [incoming], rekeyRehearsalSeasonFeed([incoming])), observedAt);
  const [finding] = (await findingsOf(outer, absenceKey(REKEY_CASES.old.providerId))).filter((row) => row.open);
  if (!isAbsenceHalt(result, [REKEY_CASES.old.providerId]) || finding === undefined) {
    throw new RehearsalRefused(`${label}: the first disappearance did not HALT with one open finding: ${JSON.stringify(result.halt)}`);
  }
  return { old, result, finding, observedAt };
}

/** Run `body` in one outer transaction that is ALWAYS rolled back, then prove zero residue. */
async function rollbackOnly(
  importer: Sql, owner: Sql, name: string, check: CheckFn,
  body: (outer: TransactionSql) => Promise<void>,
): Promise<void> {
  try {
    await importer.begin(async (outer) => {
      await assertCodeTestDb(outer);
      await body(outer);
      throw new ScenarioRollback();
    });
  } catch (error) {
    if (!(error instanceof ScenarioRollback)) throw error;
  }
  const residue = await census(owner);
  check(`${name}: zero namespace residue after the rollback`, Object.values(residue).every((n) => n === 0), JSON.stringify(residue));
}

async function run(): Promise<number> {
  const dsns = resolveRehearsalDsns(process.env, { allowOwnerImportDsn: process.argv.includes('--allow-owner-import-dsn') });
  const owner = postgres(dsns.ownerDsn, { max: 1, onnotice: () => {}, connection: { application_name: 'afldb-issue231-rehearsal' } });
  const importer = dsns.importIsOwner ? owner
    : postgres(dsns.importDsn, { max: 1, onnotice: () => {}, connection: { application_name: 'afldb-issue231-rehearsal-import' } });
  const checks: Check[] = [];
  const check: CheckFn = (name, pass, detail = '') => {
    checks.push({ name, pass, detail });
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const OLD = REKEY_CASES.old.providerId;
  const NEW = REKEY_CASES.new.providerId;
  try {
    // ---- Preconditions (read-only) --------------------------------------------------------
    await assertCodeTestDb(owner);
    const residue0 = await census(owner);
    if (Object.values(residue0).some((n) => n !== 0)) {
      throw new RehearsalRefused(`namespace residue before the run: ${JSON.stringify(residue0)}`);
    }
    console.log(`namespace residue before the run: ${JSON.stringify(residue0)}`);
    await importer.begin('read only', async (tx) => {
      await assertCodeTestDb(tx);
      // No real canonical row may already be a plausible neighbour of any synthetic fixture: if one
      // were, the writer's own F030 guard would refuse the seeds and the scenarios would prove
      // something else. Refuse rather than silently rehearse a different case.
      for (const spec of Object.values(REKEY_CASES)) {
        const identity = await identityOf(tx, rekeyRehearsalBundle(`preflight-${spec.providerId}`, [rekeyRehearsalUnitSource(spec)]));
        const neighbours = await findPlausibleCanonicalFixtures(tx, identity);
        const [{ keyHits }] = await tx<{ keyHits: number }[]>`SELECT count(*)::int AS "keyHits" FROM matches WHERE match_key = ${identity.matchKey}`;
        if (neighbours.length > 0 || keyHits > 0) {
          throw new RehearsalRefused(`${spec.providerId} (${identity.matchKey}) already has canonical neighbours `
            + `${JSON.stringify(neighbours.map((n) => n.matchKey))} / ${keyHits} key hit(s); choose other rehearsal dates.`);
        }
      }
      // D-231-3: the sweep reads the WHOLE season=2026 afl_api match scope. A pre-existing,
      // unstamped row outside the namespace that the authentic feed does not list would make
      // every complete-feed settle HALT for a reason this harness did not stage.
      const listed = new Set(rekeyRehearsalSeasonFeed([]).providerMatchIds);
      const sourceId = await resolveAflApiSourceId(tx);
      const foreign = await tx<{ id: string }[]>`
        SELECT external_record_id AS id FROM staging.source_records
         WHERE source_id = ${sourceId} AND family = 'match' AND scope_key = ${REKEY_REHEARSAL.scopeKey}
           AND absent_since IS NULL AND external_record_id NOT LIKE ${REKEY_REHEARSAL.providerLike}
      `;
      const confounding = foreign.map((row) => row.id).filter((id) => !listed.has(id));
      if (confounding.length > 0) {
        throw new RehearsalRefused(`code_test_db already holds ${confounding.length} unstamped afl_api ${REKEY_REHEARSAL.scopeKey} `
          + `match record(s) the authentic feed omits (first: ${confounding.slice(0, 3).join(', ')}); every complete-feed `
          + 'settle would HALT on them. Rehearse on a baseline without them.');
      }
    });
    console.log(`AFLDB-ISSUE-231 code_test_db rekey + absence rehearsal, rollback-only (import role: ${dsns.importIsOwner ? 'OWNER (explicitly allowed)' : 'afldb_import'})`);

    // ---- S1: complete feed -> retired_identity is reachable; unacknowledged, the settle HALTs --
    await rollbackOnly(importer, owner, 'S1', check, async (outer) => {
      const old = await seedThroughWriter(outer, REKEY_CASES.old);
      const aflApiSourceId = await resolveAflApiSourceId(outer);
      check('S1 seed: the old row is afl_api-owned under the old provider id', old.sourceId === aflApiSourceId
        && old.sourceRecordId === OLD && old.matchDate === REKEY_CASES.old.date, JSON.stringify(old));

      const incoming = rekeyRehearsalUnitSource(REKEY_CASES.new);
      const feed = rekeyRehearsalSeasonFeed([incoming]);
      const scope = aflApiMatchRekeyScope(feed);
      check('S1 feed: complete, lists the new id and not the old one', feed.complete
        && scope.publishedRecordIds.includes(NEW) && !scope.publishedRecordIds.includes(OLD),
        `${feed.providerMatchIds.length} ids; gaps ${JSON.stringify(feed.gaps)}`);
      const bundle = rekeyRehearsalBundle('s1', [incoming], feed);

      const resolution = await resolveAflApiMatch(outer, await identityOf(outer, bundle), { kind: 'run_enumeration', scope });
      check('S1 resolution: retired_identity onto the old row', resolution.outcome === 'resolved'
        && resolution.via === 'retired_identity' && resolution.targetId === old.id, JSON.stringify(resolution));

      // D-231-3 supersedes the pass-2 expectation ("applies with no HALT"): the retirement is a
      // disappearance, and an unacknowledged one halts. The applied rekey is S6.
      const result = await settle(outer, bundle);
      check('S1 settle: HALTs on exactly the unacknowledged absence of the old id', isAbsenceHalt(result, [OLD]),
        JSON.stringify({ halt: result.halt, applied: result.applied }));
      check('S1: the old row untouched and no second row', JSON.stringify(await matchesOf(outer, [OLD, NEW])) === JSON.stringify([old]));
    });

    // ---- S2: incomplete feed -> no rekey, the F030 refusal -----------------------------------
    await rollbackOnly(importer, owner, 'S2', check, async (outer) => {
      const old = await seedThroughWriter(outer, REKEY_CASES.old);
      const incoming = rekeyRehearsalUnitSource(REKEY_CASES.new);
      const bundle = rekeyRehearsalBundle('s2', [incoming]); // no feed retained: incomplete
      check('S2 feed: incomplete (season_feed_not_in_snapshot)', !bundle.seasonFeed.complete,
        JSON.stringify(bundle.seasonFeed.gaps.map((g) => g.reason)));
      const resolution = await resolveAflApiMatch(outer, await identityOf(outer, bundle), {
        kind: 'run_enumeration', scope: aflApiMatchRekeyScope(bundle.seasonFeed),
      });
      check('S2 resolution: unresolved (nothing proven retired)', resolution.outcome === 'unresolved', JSON.stringify(resolution));
      const before = await matchesOf(outer, [OLD]);
      const result = await settle(outer, bundle);
      check('S2 settle: applied, no HALT, the match record refused as unresolved identity', result.applied && result.halt === null
        && result.counters.unresolvedIdentityMatch === 1 && result.counters.canonicalRowsInserted === 0,
        JSON.stringify({ unresolved: result.counters.unresolvedIdentityMatch, inserted: result.counters.canonicalRowsInserted }));
      const refusal = await findingsOf(outer, `afl_api|match|${NEW}|matches`);
      check('S2: the refusal is possible_existing_match naming the old row', refusal.length === 1
        && refusal[0].details.reason === 'possible_existing_match'
        && JSON.stringify(refusal[0].details.candidates ?? []).includes(`"match_id":${old.id}`),
        JSON.stringify(refusal.map((f) => f.details.reason)));
      check('S2: the old row is untouched and no second row exists',
        JSON.stringify(await matchesOf(outer, [OLD, NEW])) === JSON.stringify(before));
      check('S2: no absence finding and no stamp (an incomplete feed decides nothing)',
        (await findingsOf(outer, absenceKey(OLD))).length === 0 && (await absentSinceOf(outer, OLD))?.absentSince === null);
    });

    // ---- S3: two retired candidates -> HALT, acknowledge both, then rekey_ambiguous ----------
    await rollbackOnly(importer, owner, 'S3', check, async (outer) => {
      const a = await seedThroughWriter(outer, REKEY_CASES.ambiguousA);
      const b = await seedThroughWriter(outer, REKEY_CASES.ambiguousB);
      const incoming = rekeyRehearsalUnitSource(REKEY_CASES.ambiguousNew);
      const feedText = rekeyRehearsalSeasonFeedText([incoming]);
      const feed = rekeyRehearsalEnumeration(feedText);
      const bundle = rekeyRehearsalBundle('s3', [incoming], feed);
      const resolution = await resolveAflApiMatch(outer, await identityOf(outer, bundle), {
        kind: 'run_enumeration', scope: aflApiMatchRekeyScope(feed),
      });
      check('S3 resolution: rekey_ambiguous naming both seeded rows', resolution.outcome === 'refused'
        && resolution.reason === 'rekey_ambiguous' && [...resolution.candidateIds].sort().join() === [a.id, b.id].sort().join(),
        JSON.stringify(resolution));
      const before = await matchesOf(outer, [REKEY_CASES.ambiguousA.providerId, REKEY_CASES.ambiguousB.providerId]);

      const halted = await settle(outer, bundle);
      check('S3 settle 1: HALTs on both unacknowledged absences',
        isAbsenceHalt(halted, [REKEY_CASES.ambiguousA.providerId, REKEY_CASES.ambiguousB.providerId]), JSON.stringify(halted.halt));
      for (const spec of [REKEY_CASES.ambiguousA, REKEY_CASES.ambiguousB]) {
        const [finding] = (await findingsOf(outer, absenceKey(spec.providerId))).filter((row) => row.open);
        const outcome = finding === undefined ? null
          : await acknowledge(outer, { providerId: spec.providerId, findingId: finding.id, feedText, apply: true, label: 's3-ack' });
        check(`S3: ${spec.providerId} acknowledged`, outcome !== null && !(outcome instanceof Error) && outcome.applied,
          outcome instanceof Error ? outcome.message : JSON.stringify(outcome));
      }

      const result = await settle(outer, bundle);
      check('S3 settle 2: applied, no HALT, no canonical insert', result.applied && result.halt === null
        && result.counters.canonicalRowsInserted === 0, JSON.stringify({ halt: result.halt, inserted: result.counters.canonicalRowsInserted }));
      const refusal = await findingsOf(outer, `afl_api|match|${REKEY_CASES.ambiguousNew.providerId}|matches`);
      check('S3: one rekey_ambiguous refusal finding recorded for the incoming record', refusal.length === 1
        && refusal[0].details.reason === 'rekey_ambiguous',
        JSON.stringify(refusal.map((f) => ({ type: f.issueType, reason: f.details.reason }))));
      check('S3: both candidates untouched and no new row', JSON.stringify(await matchesOf(outer, [
        REKEY_CASES.ambiguousA.providerId, REKEY_CASES.ambiguousB.providerId, REKEY_CASES.ambiguousNew.providerId,
      ])) === JSON.stringify(before));
    });

    // ---- S4 -> S5 -> S6: the lifecycle, in one outer transaction ------------------------------
    await rollbackOnly(importer, owner, 'S4-S6', check, async (outer) => {
      // S4: the first disappearance, unacknowledged.
      const old = await seedThroughWriter(outer, REKEY_CASES.old);
      const incoming = rekeyRehearsalUnitSource(REKEY_CASES.new);
      const feedText = rekeyRehearsalSeasonFeedText([incoming]);
      const bundle = rekeyRehearsalBundle('s4', [incoming], rekeyRehearsalEnumeration(feedText));
      const stateBefore = await ordinaryState(outer);
      const t1 = new Date().toISOString();
      const first = await settle(outer, bundle, t1);
      check('S4 settle: HALT afl_api_match_absence naming exactly the old id; nothing applied, no batch id',
        isAbsenceHalt(first, [OLD]), JSON.stringify({ halt: first.halt, applied: first.applied, batchId: first.batchId }));
      check('S4: the ordinary settle transaction left zero state (every non-absence census value unchanged)',
        JSON.stringify(await ordinaryState(outer)) === JSON.stringify(stateBefore),
        JSON.stringify({ before: stateBefore, after: await ordinaryState(outer) }));
      check('S4: the separate transaction opened exactly the old id', JSON.stringify(first.absenceFindings)
        === JSON.stringify({ opened: [OLD], alreadyOpen: [], notRecorded: [] }), JSON.stringify(first.absenceFindings));
      const opened = await findingsOf(outer, absenceKey(OLD));
      check('S4: exactly one keyed open finding, carrying source/family/scope/id, the feed binding and first detection',
        opened.length === 1 && opened[0].open && opened[0].issueType === AFL_API_MATCH_ABSENCE_ISSUE_TYPE
          && opened[0].details.source_key === 'afl_api' && opened[0].details.family === 'match'
          && opened[0].details.scope_key === REKEY_REHEARSAL.scopeKey && opened[0].details.external_record_id === OLD
          && opened[0].details.first_detected_at === t1
          && opened[0].details.first_detected_snapshot_label === `${REKEY_REHEARSAL.labelPrefix}-s4`
          && typeof opened[0].details.first_detected_season_feed_sha256 === 'string'
          && opened[0].details.tolerance === 0,
        JSON.stringify(opened.map((f) => ({ open: f.open, details: f.details }))));
      check('S4: no absent_since stamp', (await absentSinceOf(outer, OLD))?.absentSince === null);

      const t2 = new Date(Date.parse(t1) + 1000).toISOString();
      const repeat = await settle(outer, bundle, t2);
      const afterRepeat = await findingsOf(outer, absenceKey(OLD));
      check('S4 repeat: halts again', isAbsenceHalt(repeat, [OLD]), JSON.stringify(repeat.halt));
      check('S4 repeat: no duplicate, the first detection kept', JSON.stringify(repeat.absenceFindings)
        === JSON.stringify({ opened: [], alreadyOpen: [OLD], notRecorded: [] })
        && afterRepeat.length === 1 && afterRepeat[0].id === opened[0].id
        && afterRepeat[0].details.first_detected_at === t1 && afterRepeat[0].detectedAt === opened[0].detectedAt,
        JSON.stringify(afterRepeat.map((f) => ({ id: f.id, first: f.details.first_detected_at }))));
      check('S4 repeat: still zero ordinary state', JSON.stringify(await ordinaryState(outer)) === JSON.stringify(stateBefore));

      // S5: acknowledgement.
      const findingId = opened[0].id;
      const matchesBefore = await matchesOf(outer, [OLD, NEW]);
      const validate = await acknowledge(outer, { providerId: OLD, findingId, feedText, apply: false, label: 's5' });
      const afterValidate = await findingsOf(outer, absenceKey(OLD));
      check('S5 validate-only: proves, reports absent_since = first detection, writes nothing',
        !(validate instanceof Error) && !validate.applied && validate.absentSince === t1
          && afterValidate.length === 1 && afterValidate[0].open
          && (await absentSinceOf(outer, OLD))?.absentSince === null
          && JSON.stringify(await ordinaryState(outer)) === JSON.stringify(stateBefore),
        validate instanceof Error ? validate.message : JSON.stringify(validate));
      const wrongDb = await acknowledge(outer, { providerId: OLD, findingId, feedText, apply: true, database: 'afldb_dev', label: 's5' });
      check('S5 apply naming another database: refused, no write', wrongDb instanceof AflApiMatchAbsenceAckRefused
        && (await findingsOf(outer, absenceKey(OLD)))[0].open && (await absentSinceOf(outer, OLD))?.absentSince === null,
        wrongDb instanceof Error ? wrongDb.message : 'not refused');
      const ack = await acknowledge(outer, { providerId: OLD, findingId, feedText, apply: true, label: 's5' });
      const resolved = await findingsOf(outer, absenceKey(OLD));
      const stamp = await absentSinceOf(outer, OLD);
      check('S5 apply: absent_since = the finding\'s first detection', !(ack instanceof Error) && ack.applied
        && stamp !== undefined && await stamp.equals(t1), ack instanceof Error ? ack.message : JSON.stringify({ ack, stamp: stamp?.absentSince }));
      check('S5 apply: the finding is resolved source_absence_acknowledged',
        resolved.length === 1 && !resolved[0].open && resolved[0].resolution === AFL_API_MATCH_ABSENCE_RESOLUTION.acknowledged,
        JSON.stringify(resolved.map((f) => ({ open: f.open, resolution: f.resolution }))));
      // D-231-3 actor decision (c): the PostgreSQL role is the DATABASE actor, labelled as such.
      const [{ role, resolvedAt }] = await outer<{ role: string; resolvedAt: string }[]>`
        SELECT current_user AS role,
               (SELECT resolved_at::text FROM data_issues WHERE id = ${findingId}) AS "resolvedAt"`;
      const record = (resolved[0]?.details.acknowledgement ?? {}) as Record<string, unknown>;
      check('S5 apply: the acknowledgement record names the database actor (the role), not a person', record.database_actor === role
        && record.database_actor_kind === 'postgresql_role' && record.actor_note === AFL_API_MATCH_ABSENCE_ACTOR_NOTE
        && record.database === REKEY_REHEARSAL.database && record.tool === 'acknowledge-afl-api-match-absence.ts'
        && record.finding_id === findingId && record.issue_key === absenceKey(OLD) && record.season === REKEY_REHEARSAL.season
        && record.external_record_id === OLD && record.proved_by_snapshot_label === `${REKEY_REHEARSAL.labelPrefix}-s5`
        && typeof record.proved_by_season_feed_sha256 === 'string' && record.first_detected_at === t1
        && record.absent_since === t1 && record.resolution === AFL_API_MATCH_ABSENCE_RESOLUTION.acknowledged
        && typeof record.acknowledged_at === 'string' && Date.parse(String(record.acknowledged_at)) === Date.parse(resolvedAt)
        && !('operator' in record), JSON.stringify(record));
      const firstDetection = (details: Record<string, unknown>) => {
        const { acknowledgement: _ack, ...rest } = details;
        void _ack;
        return JSON.stringify(rest);
      };
      check('S5 apply: every first-detection key is unchanged (only `acknowledgement` was added)',
        firstDetection(resolved[0].details) === firstDetection(opened[0].details) && resolved[0].detectedAt === opened[0].detectedAt);
      check('S5 apply: no canonical mutation', JSON.stringify(await matchesOf(outer, [OLD, NEW])) === JSON.stringify(matchesBefore)
        && (await ordinaryState(outer)).ledger === stateBefore.ledger);

      // S6: the next complete-feed settle proceeds and reaches retired_identity.
      const resolution = await resolveAflApiMatch(outer, await identityOf(outer, bundle), {
        kind: 'run_enumeration', scope: aflApiMatchRekeyScope(bundle.seasonFeed),
      });
      check('S6 resolution: retired_identity onto the old row', resolution.outcome === 'resolved'
        && resolution.via === 'retired_identity' && resolution.targetId === old.id, JSON.stringify(resolution));
      const result = await settle(outer, bundle);
      check('S6 settle: applied, no HALT, no new absence finding', result.applied && result.halt === null
        && result.absenceFindings === null && (await findingsOf(outer, absenceKey(OLD))).every((f) => !f.open),
        JSON.stringify({ halt: result.halt, rollback: result.rollbackReason }));
      const rows = await matchesOf(outer, [OLD, NEW]);
      check('S6: exactly one matches row, still the old provider link, date and match_key (identity withheld)',
        rows.length === 1 && rows[0].id === old.id && rows[0].sourceRecordId === OLD
          && rows[0].matchDate === REKEY_CASES.old.date && rows[0].matchKey === old.matchKey, JSON.stringify(rows));
      const [{ newKeyRows }] = await outer<{ newKeyRows: number }[]>`
        SELECT count(*)::int AS "newKeyRows" FROM matches WHERE match_key = ${(await identityOf(outer, bundle)).matchKey}`;
      check('S6: no second matches row under the new rendering', newKeyRows === 0, String(newKeyRows));
      const withheld = await findingsOf(outer, `afl_api|apply|match|${NEW}|matches:identity`);
      check('S6: the identity-bearing difference is withheld as one open finding', withheld.length === 1 && withheld[0].open,
        JSON.stringify(withheld.map((f) => ({ type: f.issueType, open: f.open }))));
      check('S6: the acknowledged absence stays stamped (still absent, not newly absent)',
        (await (await absentSinceOf(outer, OLD))?.equals(t1)) === true);
      console.log(`       S6 counters: ${JSON.stringify(result.counters)}`);
    });

    // ---- S7(a) reappearance of an acknowledged absence, then S9 a new episode -----------------
    await rollbackOnly(importer, owner, 'S7a-S9', check, async (outer) => {
      const { finding } = await haltOnOld(outer, 's7a');
      const oldSource = rekeyRehearsalUnitSource(REKEY_CASES.old);
      const newSource = rekeyRehearsalUnitSource(REKEY_CASES.new);
      const omitting = rekeyRehearsalSeasonFeedText([newSource]);
      const ack = await acknowledge(outer, { providerId: OLD, findingId: finding.id, feedText: omitting, apply: true, label: 's7a-ack' });
      check('S7a setup: acknowledged and stamped', !(ack instanceof Error) && ack.applied
        && (await absentSinceOf(outer, OLD))?.absentSince !== null, ack instanceof Error ? ack.message : '');

      // Listed again but NOT selected: a bundle with no units, only the feed.
      const listing = rekeyRehearsalEnumeration(rekeyRehearsalSeasonFeedText([oldSource, newSource]));
      const back = await settle(outer, rekeyRehearsalBundle('s7a', [], listing));
      // `>= 1`, not `=== 1`: the sweep covers the whole scope, and a pre-existing stamped row outside
      // the namespace that the authentic feed lists would be cleared (and rolled back) too.
      check('S7a settle: applied, no HALT, the reappearance counted', back.applied && back.halt === null
        && back.counters.observationsReappeared >= 1, JSON.stringify({ halt: back.halt, reappeared: back.counters.observationsReappeared }));
      check('S7a: absent_since cleared although the run did not select the match',
        (await absentSinceOf(outer, OLD))?.absentSince === null);

      // S9: it disappears again.
      const again = await settle(outer, rekeyRehearsalBundle('s9', [newSource], rekeyRehearsalEnumeration(omitting)));
      const history = await findingsOf(outer, absenceKey(OLD));
      check('S9: the second disappearance HALTs again', isAbsenceHalt(again, [OLD]), JSON.stringify(again.halt));
      check('S9: a NEW open finding; the acknowledged one stays resolved and whitelists nothing',
        JSON.stringify(again.absenceFindings) === JSON.stringify({ opened: [OLD], alreadyOpen: [], notRecorded: [] })
          && history.length === 2 && history[0].id === finding.id && !history[0].open
          && history[0].resolution === AFL_API_MATCH_ABSENCE_RESOLUTION.acknowledged
          && history[1].open && history[1].id !== finding.id,
        JSON.stringify(history.map((f) => ({ id: f.id, open: f.open, resolution: f.resolution }))));
      check('S9: no stamp for the new episode', (await absentSinceOf(outer, OLD))?.absentSince === null);
    });

    // ---- S7(b) an UNACKNOWLEDGED finding whose id reappears -----------------------------------
    await rollbackOnly(importer, owner, 'S7b', check, async (outer) => {
      const { finding } = await haltOnOld(outer, 's7b');
      const listing = rekeyRehearsalEnumeration(rekeyRehearsalSeasonFeedText([
        rekeyRehearsalUnitSource(REKEY_CASES.old), rekeyRehearsalUnitSource(REKEY_CASES.new),
      ]));
      const back = await settle(outer, rekeyRehearsalBundle('s7b', [], listing));
      const history = await findingsOf(outer, absenceKey(OLD));
      check('S7b settle: applied, no HALT (the reappeared id no longer blocks)', back.applied && back.halt === null,
        JSON.stringify(back.halt));
      check('S7b: the finding closed source_reappeared', history.length === 1 && history[0].id === finding.id
        && !history[0].open && history[0].resolution === AFL_API_MATCH_ABSENCE_RESOLUTION.reappeared,
        JSON.stringify(history.map((f) => ({ open: f.open, resolution: f.resolution }))));
      check('S7b: no absent_since stamp was ever made', (await absentSinceOf(outer, OLD))?.absentSince === null);
    });

    // ---- S8 stale acknowledgement -------------------------------------------------------------
    await rollbackOnly(importer, owner, 'S8', check, async (outer) => {
      const { finding } = await haltOnOld(outer, 's8');
      const listingText = rekeyRehearsalSeasonFeedText([
        rekeyRehearsalUnitSource(REKEY_CASES.old), rekeyRehearsalUnitSource(REKEY_CASES.new),
      ]);
      for (const apply of [false, true]) {
        const outcome = await acknowledge(outer, { providerId: OLD, findingId: finding.id, feedText: listingText, apply, label: 's8' });
        const after = await findingsOf(outer, absenceKey(OLD));
        check(`S8 ${apply ? 'apply' : 'validate-only'}: a complete feed listing the id again is refused, no write`,
          outcome instanceof AflApiMatchAbsenceAckRefused && /lists 'CD_M2026231ROLD' again/.test(outcome.message)
            && after.length === 1 && after[0].open && (await absentSinceOf(outer, OLD))?.absentSince === null,
          outcome instanceof Error ? outcome.message : 'not refused');
      }
    });

    // ---- S10 an incomplete feed decides nothing -----------------------------------------------
    await rollbackOnly(importer, owner, 'S10', check, async (outer) => {
      const { finding } = await haltOnOld(outer, 's10');
      const newSource = rekeyRehearsalUnitSource(REKEY_CASES.new);
      const incompleteOmitting = rekeyRehearsalSeasonFeedText([newSource], { incomplete: true });
      check('S10 feed: the parser reads it incomplete (pagination_mismatch)',
        JSON.stringify(rekeyRehearsalEnumeration(incompleteOmitting).gaps.map((g) => g.reason)) === '["pagination_mismatch"]');

      const refused = await acknowledge(outer, { providerId: OLD, findingId: finding.id, feedText: incompleteOmitting, apply: true, label: 's10' });
      check('S10: cannot acknowledge against an incomplete feed', refused instanceof AflApiMatchAbsenceAckRefused
        && /not complete/.test(refused.message) && (await findingsOf(outer, absenceKey(OLD)))[0].open
        && (await absentSinceOf(outer, OLD))?.absentSince === null, refused instanceof Error ? refused.message : 'not refused');

      const quiet = await settle(outer, rekeyRehearsalBundle('s10-omit', [], rekeyRehearsalEnumeration(incompleteOmitting)));
      check('S10: cannot stamp or open a finding: an incomplete feed omitting the id settles with no HALT',
        quiet.applied && quiet.halt === null && quiet.absenceFindings === null
          && (await findingsOf(outer, absenceKey(OLD))).length === 1 && (await absentSinceOf(outer, OLD))?.absentSince === null,
        JSON.stringify(quiet.halt));

      const ack = await acknowledge(outer, {
        providerId: OLD, findingId: finding.id, feedText: rekeyRehearsalSeasonFeedText([newSource]), apply: true, label: 's10-ack',
      });
      const incompleteListing = rekeyRehearsalEnumeration(rekeyRehearsalSeasonFeedText(
        [rekeyRehearsalUnitSource(REKEY_CASES.old), newSource], { incomplete: true },
      ));
      const listed = await settle(outer, rekeyRehearsalBundle('s10-list', [], incompleteListing));
      check('S10: cannot clear: an incomplete feed listing the stamped id leaves absent_since in place',
        !(ack instanceof Error) && ack.applied && listed.applied && listed.halt === null
          && (await absentSinceOf(outer, OLD))?.absentSince !== null && listed.counters.observationsReappeared === 0,
        ack instanceof Error ? ack.message : JSON.stringify(listed.halt));
    });
  } finally {
    if (importer !== owner) await importer.end({ timeout: 5 });
    await owner.end({ timeout: 5 });
  }
  const failed = checks.filter((c) => !c.pass);
  console.log(`\nAFLDB-ISSUE-231 code_test_db rekey + absence rehearsal: ${checks.length - failed.length}/${checks.length} checks PASS`);
  return failed.length === 0 ? 0 : 1;
}

async function residueOnly(): Promise<number> {
  const dsns = resolveRehearsalDsns(process.env, { allowOwnerImportDsn: true });
  const owner = postgres(dsns.ownerDsn, { max: 1, onnotice: () => {} });
  try {
    await assertCodeTestDb(owner);
    const residue = await census(owner);
    console.log(`namespace residue: ${JSON.stringify(residue)}`);
    return Object.values(residue).every((n) => n === 0) ? 0 : 1;
  } finally {
    await owner.end({ timeout: 5 });
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'run') {
    const acknowledged = rest.includes('--acknowledge') && rest[rest.indexOf('--acknowledge') + 1] === REKEY_REHEARSAL.database;
    if (!acknowledged) throw new RehearsalRefused(`run needs --acknowledge ${REKEY_REHEARSAL.database}.`);
    return run();
  }
  if (command === 'residue') return residueOnly();
  throw new RehearsalRefused(`usage: run --acknowledge code_test_db [--allow-owner-import-dsn] | residue `
    + `(needs ${REHEARSAL_OWNER_ENV}; ${REHEARSAL_IMPORT_ENV} or --allow-owner-import-dsn)`);
}

if (process.argv[1] && /afl-api-season-rekey-rehearsal\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(`REFUSED: ${redact((error as Error).message)}`);
      process.exit(1);
    });
}
