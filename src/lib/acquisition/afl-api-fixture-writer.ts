/**
 * AFLDB V2 Launch F — the AFL API FIXTURE WRITER (AFLDB-ISSUE-229 B2 writer, V2-GAP-008).
 *
 *   immutable snapshot -> validation -> STAGING -> IDENTITY RESOLUTION -> RECONCILIATION
 *     -> TRANSACTIONAL PROMOTION
 *
 * The first two steps are the CLI's (`tools/current-season/settle-afl-api-fixture-schedule.ts`:
 * manifest sha256 verification, season seal, ingestion gate) and the stage is
 * `stageAflApiFixtureFeed` (pure). This module takes a stage and, in ONE transaction under the
 * per-season fixture advisory lock that the admin contract also takes:
 *   1. resolves every club (`clubs.legacy_club_hist`) and venue (`venues.legacy_name`, the D-229-5
 *      condition 2 database half) the stage names; a miss refuses, nothing is ever created;
 *   2. reconciles against the season's existing `fixtures` rows, as the season will stand AFTER
 *      the run, with the source-agnostic I-1 / I-2 rules (D-229-4) and I-3 for a new row;
 *   3. writes only if nothing refused. Any refusal anywhere writes nothing at all (not even the
 *      import batch). A run with no change writes nothing either, so a replay is idempotent.
 *
 * Unconfirmed fixtures (owner decision 2026-11-01, migration 118). A PLACEHOLDER record is written as status
 * `scheduled` with `confirmation = 'unconfirmed'`. A side that is a provider label (ladder position, bracket
 * reference) has a NULL club id and carries the label in `home_placeholder` / `away_placeholder`; it is never a club.
 * A placeholder venue is NULL (venue TBC) and leaves the date and time NULL. When the provider later confirms the
 * fixture (a confirmed status for the same provider id) the SAME row is updated in place (action `confirmed`);
 * a confirmed row never regresses to unconfirmed (`confirmation_regressed`) and never changes clubs.
 *
 * Ownership (D-229-4, D-229-6, D-229-7, D-229-8a). The writer touches only rows it owns:
 * `source_id = afl_api` with `source_record_id = <provider match id>`. A manual or other-source
 * row is never merged, updated or overwritten; colliding with one refuses. No `data_overrides`,
 * `data_edits`, `canonical_applications` or `staging.source_records` row is written; provenance is
 * `fixtures.import_batch_id` -> `import_batches` (tool, snapshot label, manifest sha256). The
 * `fixture_key` of a new row is a fresh random UUID; the durable identity is the provider id.
 *
 * No absence sweep (D-229-8): a provider row that leaves a later feed is reported, never touched.
 *
 * It lives here, not in `@afldb/acquisition`: that package's index stays free of SQL and writers
 * (tests/v2-acquisition-pipeline.test.ts (f)); its pure lifecycle and staging feed this module.
 */
import { randomUUID } from 'node:crypto';

import type { SqlExecutor, TransactionalSqlExecutor } from '@afldb/db';

import { FIXTURE_SEASON_LOCK_NAMESPACE } from '@/lib/fixtures/spec';

import type { AflApiFixtureProjection, AflApiFixtureStage, AflApiFixtureTransition } from '@afldb/acquisition';

export const AFL_API_FIXTURE_SOURCE_KEY = 'afl_api';

export type AflApiFixtureWriterRefusalCode =
  | 'stage_refused'
  | 'club_unresolved'
  | 'venue_unresolved'
  | 'club_identity_changed'
  | 'void_row_reobserved'
  | 'lifecycle_target_missing'
  | 'foreign_owned_collision'
  | 'fixture_identity_collision'
  | 'club_already_scheduled'
  | 'already_played'
  | 'confirmation_regressed'
  | 'completed_unconfirmed_fixture';

export type AflApiFixtureWriterRefusal = { providerId: string | null; code: AflApiFixtureWriterRefusalCode; detail: string };

export type AflApiFixtureActionKind =
  | 'created' | 'rescheduled' | 'reinstated' | 'postponed' | 'cancelled' | 'abandoned'
  | 'confirmed' | 'unchanged' | 'completed_retained';

export type AflApiFixtureAction = {
  providerId: string;
  kind: AflApiFixtureActionKind;
  /** Column -> [before, after] for every column the action changes. */
  changes: Readonly<Record<string, readonly [unknown, unknown]>>;
};

export type AflApiFixtureSettleOutcome = {
  status: 'refused' | 'no_changes' | 'dry_run' | 'applied';
  refusals: readonly AflApiFixtureWriterRefusal[];
  actions: readonly AflApiFixtureAction[];
  /** Provider-owned rows of this season the feed did not mention: reported, never touched (D-229-8). */
  unmentionedOwnedRows: readonly string[];
  batchId: string | null;
};

export type AflApiFixtureProvenance = { tool: string; snapshotLabel: string; manifestSha256: string };

type FixtureState = {
  id: number | null;
  sourceKey: string;
  sourceRecordId: string;
  roundCode: string;
  roundNumber: number | null;
  roundType: string;
  matchDate: string | null;
  matchTime: string | null;
  venueId: number | null;
  venueRaw: string | null;
  /** NULL only for an unconfirmed fixture whose side is a provider label (migration 118). */
  homeClubId: number | null;
  awayClubId: number | null;
  homePlaceholder: string | null;
  awayPlaceholder: string | null;
  confirmation: string;
  status: string;
  statusReason: string | null;
};

const WRITABLE: readonly (keyof FixtureState)[] = [
  'roundCode', 'roundNumber', 'roundType', 'matchDate', 'matchTime', 'venueId', 'venueRaw', 'status', 'statusReason',
  'homeClubId', 'awayClubId', 'homePlaceholder', 'awayPlaceholder', 'confirmation',
];
const COLUMN: Record<string, string> = {
  roundCode: 'round_code', roundNumber: 'round_number', roundType: 'round_type', matchDate: 'match_date',
  matchTime: 'match_time', venueId: 'venue_id', venueRaw: 'venue_raw', status: 'status', statusReason: 'status_reason',
  homeClubId: 'home_club_id', awayClubId: 'away_club_id', homePlaceholder: 'home_placeholder',
  awayPlaceholder: 'away_placeholder', confirmation: 'confirmation',
};

class DryRunRollback extends Error {
  constructor() { super('afl_api fixture settle dry-run: rolling back deliberately'); this.name = 'DryRunRollback'; }
}

async function loadSeasonFixtures(tx: SqlExecutor, season: number): Promise<FixtureState[]> {
  return tx.query<FixtureState>(
    `SELECT f.id::int AS "id", s.key AS "sourceKey", f.source_record_id AS "sourceRecordId",
            f.round_code AS "roundCode", f.round_number::int AS "roundNumber", f.round_type::text AS "roundType",
            f.match_date::text AS "matchDate", f.match_time AS "matchTime", f.venue_id::int AS "venueId",
            f.venue_raw AS "venueRaw", f.home_club_id::int AS "homeClubId", f.away_club_id::int AS "awayClubId",
            f.home_placeholder AS "homePlaceholder", f.away_placeholder AS "awayPlaceholder",
            f.confirmation AS "confirmation", f.status AS "status", f.status_reason AS "statusReason"
       FROM fixtures f JOIN sources s ON s.id = f.source_id
      WHERE f.season = $1::smallint
      ORDER BY f.id`,
    [season],
  );
}

function differences(before: FixtureState, after: FixtureState): Record<string, readonly [unknown, unknown]> {
  const changes: Record<string, readonly [unknown, unknown]> = {};
  for (const key of WRITABLE) if (before[key] !== after[key]) changes[COLUMN[key]] = [before[key], after[key]];
  return changes;
}

function transitionReason(transition: AflApiFixtureTransition): string | null {
  if (transition.kind === 'cancelled') return `AFL API status ${transition.providerStatus} (provider match ${transition.providerId})`;
  if (transition.kind === 'abandoned') return `abandoned: AFL API status ${transition.providerStatus} (provider match ${transition.providerId})`;
  return null;
}

/**
 * Resolves, reconciles and (unless refused or unchanged) promotes one stage in one transaction.
 * `mode: 'dry-run'` executes every write against real constraints and privileges, then rolls back.
 */
export async function settleAflApiFixtureStage(
  db: TransactionalSqlExecutor,
  input: {
    stage: AflApiFixtureStage;
    mode: 'apply' | 'dry-run';
    provenance: AflApiFixtureProvenance;
    mintFixtureKey?: () => string;
  },
): Promise<AflApiFixtureSettleOutcome> {
  const { stage } = input;
  if (stage.refused.length > 0) {
    return {
      status: 'refused',
      refusals: stage.refused.flatMap((r) => r.refusals.map((x) => ({
        providerId: r.providerId, code: 'stage_refused' as const, detail: `[${r.providerStatus ?? '?'}] ${x.code}: ${x.detail}`,
      }))),
      actions: [], unmentionedOwnedRows: [], batchId: null,
    };
  }
  const mint = input.mintFixtureKey ?? randomUUID;
  // Mutated in place: a binding reassigned inside the opaque transaction closure would be narrowed to
  // `null` at the read below (the same shape settle-afl-api-fixtures.ts uses for its counters).
  const box: { outcome: AflApiFixtureSettleOutcome | null } = { outcome: null };

  try {
    await db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [FIXTURE_SEASON_LOCK_NAMESPACE, stage.season]);
      const [source] = await tx.query<{ id: number }>('SELECT id::int AS id FROM sources WHERE key = $1', [AFL_API_FIXTURE_SOURCE_KEY]);
      if (!source) throw new Error(`sources.key = '${AFL_API_FIXTURE_SOURCE_KEY}' has no row (expected from migration 077).`);

      const refusals: AflApiFixtureWriterRefusal[] = [];
      const refuse = (providerId: string | null, code: AflApiFixtureWriterRefusalCode, detail: string) => {
        refusals.push({ providerId, code, detail });
      };

      // ---- 1. identity resolution (map-only; a miss refuses, nothing is created) ----
      const hists = [...new Set([
        ...stage.scheduled.flatMap((p) => [p.homeClubHist, p.awayClubHist]),
        ...stage.transitions.flatMap((t) => [t.homeClubHist, t.awayClubHist]),
      ].filter((h): h is string => h !== null))];
      const clubRows = hists.length === 0 ? [] : await tx.query<{ hist: string; id: number }>(
        'SELECT legacy_club_hist AS hist, id::int AS id FROM clubs WHERE legacy_club_hist = ANY($1::text[])', [hists],
      );
      const clubByHist = new Map(clubRows.map((row) => [row.hist, row.id]));
      const legacyNames = [...new Set(stage.scheduled.map((p) => p.venueLegacyName).filter((n): n is string => n !== null))];
      const venueRows = legacyNames.length === 0 ? [] : await tx.query<{ legacyName: string; id: number; canonicalName: string }>(
        `SELECT legacy_name AS "legacyName", id::int AS id, canonical_name AS "canonicalName"
           FROM venues WHERE legacy_name = ANY($1::text[])`, [legacyNames],
      );
      const venueByLegacy = new Map(venueRows.map((row) => [row.legacyName, row]));

      // A side that is a provider label (hist null) resolves to a NULL club id by contract; a real side that misses refuses.
      const clubsOf = (providerId: string, homeHist: string | null, awayHist: string | null): [number | null, number | null] | null => {
        const home = homeHist === null ? null : clubByHist.get(homeHist);
        const away = awayHist === null ? null : clubByHist.get(awayHist);
        if (home === undefined) refuse(providerId, 'club_unresolved', `clubs.legacy_club_hist has no row for '${homeHist}' (home).`);
        if (away === undefined) refuse(providerId, 'club_unresolved', `clubs.legacy_club_hist has no row for '${awayHist}' (away).`);
        return home === undefined || away === undefined ? null : [home, away];
      };

      // ---- 2. reconciliation against the season as it will stand after this run ----
      const existing = await loadSeasonFixtures(tx, stage.season);
      const owned = new Map(existing.filter((r) => r.sourceKey === AFL_API_FIXTURE_SOURCE_KEY).map((r) => [r.sourceRecordId, r]));
      const final = new Map<FixtureState, FixtureState>(existing.map((r) => [r, r]));
      const planned: { providerId: string; kind: AflApiFixtureActionKind; before: FixtureState | null; after: FixtureState }[] = [];
      const actions: AflApiFixtureAction[] = [];

      const plan = (providerId: string, kind: AflApiFixtureActionKind, before: FixtureState | null, after: FixtureState) => {
        if (before !== null) {
          final.set(before, after);
          const changes = differences(before, after);
          if (Object.keys(changes).length === 0) { actions.push({ providerId, kind: 'unchanged', changes }); return; }
          planned.push({ providerId, kind, before, after });
          actions.push({ providerId, kind, changes });
        } else {
          final.set(after, after);
          planned.push({ providerId, kind, before: null, after });
          actions.push({ providerId, kind, changes: {} });
        }
      };

      function planScheduled(p: AflApiFixtureProjection): void {
        const id = p.identity.sourceRecordId;
        const clubs = clubsOf(id, p.homeClubHist, p.awayClubHist);
        // A declared placeholder venue is an unresolved venue (NULL id and NULL name), never a venue row.
        const venue = p.venueIsPlaceholder
          ? null
          : venueByLegacy.get(p.venueLegacyName ?? '');
        if (venue === undefined) {
          refuse(id, 'venue_unresolved', `venues.legacy_name has no row for '${p.venueLegacyName}' (provider venue ${p.venueProviderId}).`);
        }
        if (clubs === null || venue === undefined) return;
        const own = owned.get(id) ?? null;
        // Participants are immutable once confirmed. An UNCONFIRMED provider row may resolve its labels to clubs (or have
        // them re-labelled) when the provider confirms the fixture; a confirmed row never changes clubs and never regresses.
        if (own !== null && own.confirmation === 'confirmed' && p.confirmation === 'unconfirmed') {
          refuse(id, 'confirmation_regressed',
            `Provider match ${id} is held as confirmed but is now observed with status ${p.providerStatus} (unconfirmed). Never regressed automatically.`);
          return;
        }
        // A side that already holds a club never changes to another club or back to a label, confirmed or not; only a side
        // still holding a label (club NULL) may be resolved to a club.
        const sideChanged = (held: number | null, observed: number | null): boolean => held !== null && held !== observed;
        if (own !== null && (sideChanged(own.homeClubId, clubs[0]) || sideChanged(own.awayClubId, clubs[1]))) {
          refuse(id, 'club_identity_changed',
            `Provider match ${id} now names clubs ${clubs[0] ?? 'label'} v ${clubs[1] ?? 'label'}; the fixture holds ${own.homeClubId ?? 'label'} v ${own.awayClubId ?? 'label'}. A held club is never rewritten.`);
          return;
        }
        if (own !== null && own.status === 'void') {
          refuse(id, 'void_row_reobserved', `Provider match ${id} is held as void; a provider row is never voided by the writer.`);
          return;
        }
        const after: FixtureState = {
          id: own?.id ?? null, sourceKey: AFL_API_FIXTURE_SOURCE_KEY, sourceRecordId: id,
          roundCode: p.round.roundCode, roundNumber: p.round.roundNumber, roundType: p.round.roundType,
          matchDate: p.matchDate, matchTime: p.matchTime, venueId: venue === null ? null : venue.id,
          venueRaw: venue === null ? null : venue.canonicalName,
          homeClubId: clubs[0], awayClubId: clubs[1], homePlaceholder: p.homePlaceholderLabel, awayPlaceholder: p.awayPlaceholderLabel,
          confirmation: p.confirmation, status: 'scheduled', statusReason: null,
        };
        const kind: AflApiFixtureActionKind = own === null ? 'created'
          : own.status === 'cancelled' ? 'reinstated'
            : own.confirmation === 'unconfirmed' && p.confirmation === 'confirmed' ? 'confirmed' : 'rescheduled';
        plan(id, kind, own, after);
      }

      function planTransition(t: AflApiFixtureTransition): void {
        const own = owned.get(t.providerId) ?? null;
        if (own === null) {
          refuse(t.providerId, 'lifecycle_target_missing',
            `${t.providerStatus} names provider match ${t.providerId}, which has no AFL API fixture; a transition never creates one.`);
          return;
        }
        const clubs = clubsOf(t.providerId, t.homeClubHist, t.awayClubHist);
        if (clubs === null) return;
        if (own.homeClubId !== clubs[0] || own.awayClubId !== clubs[1]) {
          refuse(t.providerId, 'club_identity_changed', `${t.providerStatus} for ${t.providerId} names different clubs from its fixture.`);
          return;
        }
        if (own.status === 'void') {
          refuse(t.providerId, 'void_row_reobserved', `Provider match ${t.providerId} is held as void.`);
          return;
        }
        const after: FixtureState = t.kind === 'postponed'
          ? { ...own, matchDate: null, matchTime: null, status: 'scheduled', statusReason: null }
          : { ...own, status: 'cancelled', statusReason: transitionReason(t) };
        plan(t.providerId, t.kind, own, after);
      }

      for (const p of stage.scheduled) planScheduled(p);
      for (const t of stage.transitions) planTransition(t);
      for (const id of stage.completed) {
        const own = owned.get(id);
        if (own === undefined) continue;
        // A fixture still unconfirmed (possibly holding label participants) must not be left behind by a result: the game
        // was played with clubs this writer never resolved. Fail closed so it is reviewed, never silently retained.
        if (own.confirmation === 'unconfirmed') {
          refuse(id, 'completed_unconfirmed_fixture',
            `Provider match ${id} is CONCLUDED but its fixture is still unconfirmed (${own.homeClubId === null || own.awayClubId === null ? 'label participant' : 'real clubs'}); resolve the fixture before the result is retained.`);
          continue;
        }
        actions.push({ providerId: id, kind: 'completed_retained', changes: {} });
      }

      // I-1 / I-2 (source-agnostic, D-229-4) over the final state; I-3 for a new row.
      const finalRows = [...final.values()];
      for (const row of planned) {
        if (row.after.status !== 'scheduled') continue;
        for (const other of finalRows) {
          if (other === row.after || other.status !== 'scheduled' || other.roundCode !== row.after.roundCode) continue;
          // A side that is a provider label has no club to collide on: only real clubs take part in I-1 / I-2.
          const clubs = [row.after.homeClubId, row.after.awayClubId].filter((c): c is number => c !== null);
          const otherClubs = [other.homeClubId, other.awayClubId].filter((c): c is number => c !== null);
          if (clubs.length === 0 || otherClubs.length === 0) continue;
          const samePair = clubs.length === 2 && otherClubs.length === 2
            && clubs.includes(other.homeClubId as number) && clubs.includes(other.awayClubId as number);
          if (samePair) {
            refuse(row.providerId, other.sourceKey === AFL_API_FIXTURE_SOURCE_KEY ? 'fixture_identity_collision' : 'foreign_owned_collision',
              `Round ${row.after.roundCode} already holds this pair as ${other.sourceKey}:${other.sourceRecordId}; never merged.`);
          } else if (otherClubs.some((c) => clubs.includes(c))) {
            refuse(row.providerId, 'club_already_scheduled',
              `A club of provider match ${row.providerId} already has ${other.sourceKey}:${other.sourceRecordId} in round ${row.after.roundCode}.`);
          }
        }
        if ((row.before === null || row.before.homeClubId === null || row.before.awayClubId === null)
            && row.after.homeClubId !== null && row.after.awayClubId !== null) {
          const [played] = await tx.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM matches
              WHERE season = $1::smallint AND round_code = $2
                AND ((home_club_id = $3 AND away_club_id = $4) OR (home_club_id = $4 AND away_club_id = $3))`,
            [stage.season, row.after.roundCode, row.after.homeClubId, row.after.awayClubId],
          );
          if (played.n > 0) refuse(row.providerId, 'already_played', `Round ${row.after.roundCode} already holds this game as a result.`);
        }
      }

      const mentioned = new Set([
        ...stage.scheduled.map((p) => p.identity.sourceRecordId), ...stage.transitions.map((t) => t.providerId),
        ...stage.completed, ...stage.deferred.map((d) => d.providerId).filter((id): id is string => id !== null),
      ]);
      const unmentionedOwnedRows = [...owned.keys()].filter((id) => !mentioned.has(id)).sort();
      actions.sort((a, b) => a.providerId.localeCompare(b.providerId));

      if (refusals.length > 0) {
        box.outcome = { status: 'refused', refusals, actions: [], unmentionedOwnedRows, batchId: null };
        return;
      }
      if (planned.length === 0) {
        box.outcome = { status: 'no_changes', refusals: [], actions, unmentionedOwnedRows, batchId: null };
        return;
      }

      // ---- 3. transactional promotion ----
      const counts = { created: planned.filter((p) => p.before === null).length, updated: planned.filter((p) => p.before !== null).length };
      const [batch] = await tx.query<{ id: string }>(
        `INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
         VALUES ($1, $2, 'fixtures', $3, $4) RETURNING id::text AS id`,
        [source.id, input.provenance.tool, stage.scheduled.length + stage.transitions.length + stage.completed.length + stage.deferred.length,
          `AFLDB-ISSUE-229 fixture settle; snapshot=${input.provenance.snapshotLabel}; manifest_sha256=${input.provenance.manifestSha256}; `
          + `season=${stage.season}; mode=${input.mode}`],
      );
      for (const row of planned) {
        const a = row.after;
        if (row.before === null) {
          await tx.query(
            `INSERT INTO fixtures (fixture_key, season, round_code, round_number, round_type, match_date, match_time,
                                   venue_id, venue_raw, home_club_id, away_club_id, status, status_reason,
                                   source_id, source_record_id, import_batch_id, confirmation, home_placeholder, away_placeholder)
             VALUES ($1, $2::smallint, $3, $4::smallint, $5::round_type, $6::date, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::bigint,
                     $17, $18, $19)`,
            [mint(), stage.season, a.roundCode, a.roundNumber, a.roundType, a.matchDate, a.matchTime, a.venueId, a.venueRaw,
              a.homeClubId, a.awayClubId, a.status, a.statusReason, source.id, a.sourceRecordId, batch.id,
              a.confirmation, a.homePlaceholder, a.awayPlaceholder],
          );
        } else {
          const updated = await tx.query<{ id: number }>(
            `UPDATE fixtures
                SET round_code = $2, round_number = $3::smallint, round_type = $4::round_type, match_date = $5::date,
                    match_time = $6, venue_id = $7, venue_raw = $8, status = $9, status_reason = $10,
                    import_batch_id = $11::bigint, home_club_id = $14, away_club_id = $15, home_placeholder = $16,
                    away_placeholder = $17, confirmation = $18, updated_at = now()
              WHERE id = $1 AND source_id = $12 AND source_record_id = $13
              RETURNING id::int AS id`,
            [row.before.id, a.roundCode, a.roundNumber, a.roundType, a.matchDate, a.matchTime, a.venueId, a.venueRaw,
              a.status, a.statusReason, batch.id, source.id, a.sourceRecordId,
              a.homeClubId, a.awayClubId, a.homePlaceholder, a.awayPlaceholder, a.confirmation],
          );
          if (updated.length !== 1) throw new Error(`Fixture for ${row.providerId} changed owner during the settle; rolled back.`);
        }
      }
      const closed = await tx.query<{ id: string }>(
        `UPDATE import_batches
            SET completed_at = clock_timestamp(), status = 'completed', records_inserted = $2, records_updated = $3,
                records_rejected = 0, validation_result = $4::text::jsonb
          WHERE id = $1::bigint AND status = 'running' RETURNING id::text AS id`,
        [batch.id, counts.created, counts.updated, JSON.stringify({ statusCounts: stage.statusCounts, actions: actions.map((x) => x.kind) })],
      );
      if (closed.length !== 1) throw new Error(`Cannot finalise import batch ${batch.id}.`);

      box.outcome = { status: input.mode === 'apply' ? 'applied' : 'dry_run', refusals: [], actions, unmentionedOwnedRows, batchId: batch.id };
      if (input.mode === 'dry-run') throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  const result = box.outcome;
  if (result === null) throw new Error('fixture settle produced no outcome');
  return result.status === 'dry_run' ? { ...result, batchId: null } : result;
}
