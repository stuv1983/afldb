/**
 * AFLDB-ISSUE-100 L3B2 — persist `afl_api.lineup` observations and maintain
 * the typed `staging.afl_api_lineup` projection.
 *
 * The flow is exactly the ISSUE-099 one, reused rather than reinvented:
 *
 *   emitted bundle -> migration-074 observation/version spine
 *                  -> staging.afl_api_lineup (migration 077)
 *
 * `persistSourceObservation()` from `observation-store.ts` is the ONLY spine
 * writer used here; there is no second observation system. The typed row is
 * then upserted and linked to the exact `version_seq` the spine just settled
 * on, read back out of PostgreSQL rather than assumed.
 *
 * STAGING-ONLY. Announced is not played. Nothing here writes `players`,
 * `matches`, `player_match_stats` or any other canonical table, creates a
 * promotion candidate, or opens a `data_issues` row: `afl_api.lineup` is
 * `promotion_policy: never` and this module has no code path that could
 * promote anything.
 *
 * THREE INVARIANTS THIS MODULE OWNS, because the schema cannot express them:
 *
 *   1. SOURCE OWNERSHIP. `source_id` is resolved internally from the literal
 *      key `'afl_api'` and is never a parameter. A caller cannot supply one,
 *      and persistence refuses when that key has no `sources` row. Migration
 *      077's `family = 'lineup'` CHECK pins the other half of the pair.
 *   2. NO ABSENCE. `markMissingObservationsAbsent()` is never imported or
 *      called, `absent_since` is never written, and no flag exists that could
 *      turn either on. Row-grain completeness is not contractually
 *      established, so every enumeration is `complete: false` and a missing
 *      player row means nothing.
 *   3. NO DELETE, NO TRUNCATE. The projection is maintained by keyed upsert
 *      alone. `afldb_import` holds DELETE and TRUNCATE on the whole staging
 *      schema from `privileges.sql`, so the guarantee is this code's, not the
 *      grant's — holding a privilege is not permission to use it.
 */
import postgres from 'postgres';

import { asImportBatchId, type ImportBatchId } from '../import-batch-id';

import {
  persistSourceObservation,
  type SourceObservation,
} from './observation-store';
import {
  resolveSourceId,
  type JsonValue,
} from './observations';
import {
  LINEUP_FAMILY,
  LINEUP_SOURCE_KEY,
  type LineupBundle,
  type LineupBundleRecord,
} from './lineup-bundle';
import {
  assertProjectableColumns,
  type SourceFamilyContract,
} from './source-families';

export class LineupStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LineupStoreError';
  }
}

function fail(message: string): never {
  throw new LineupStoreError(message);
}

type Tx = postgres.TransactionSql;

/** Names this pass in `import_batches.tool`, following ISSUE-099's convention. */
export const LINEUP_TOOL = 'lineup-store.ts';
/** The one table this pass projects into. */
export const LINEUP_TARGET_TABLE = 'staging.afl_api_lineup';

export type LineupCounters = {
  recordsRead: number;
  versionsInserted: number;
  headsRefreshed: number;
  projectionsInserted: number;
  projectionsUpdated: number;
  /** Always 0. Present so the report states it rather than implying it. */
  observationsMarkedAbsent: number;
  canonicalRowsWritten: number;
  matchIdsResolved: number;
  clubIdsResolved: number;
  playerIdsResolved: number;
};

export type LineupPersistResult = {
  /**
   * The batch this run opened, as the driver delivered it (AFLDB-ISSUE-105):
   * opaque decimal text, never a JavaScript number.
   */
  batchId: ImportBatchId;
  counters: LineupCounters;
};

/* ------------------------------------------------------------------ *
 * The typed projection — pure
 * ------------------------------------------------------------------ */

/**
 * One `staging.afl_api_lineup` row, derived from one bundle record.
 *
 * Canonical `match_id`, `club_id` and `player_id` are absent from this type on
 * purpose: L3B2 resolves none of them, so there is no field to set wrongly.
 * See `enrichment` in the module report — all three stay NULL, which migration
 * 077 permits by design.
 */
export type LineupProjection = {
  externalRecordId: string;
  scopeKey: string;
  providerMatchId: string;
  providerTeamId: string;
  providerPlayerId: string;
  status: string;
  teamStatus: string;
  roundName: string | null;
  teamType: string | null;
  position: string | null;
  jumperNumber: string | null;
  teamNameRaw: string | null;
  teamAbbrRaw: string | null;
  teamNicknameRaw: string | null;
};

/** A payload value that must be a present, non-blank string. */
function requiredString(
  payload: Readonly<Record<string, JsonValue>>, column: string, recordId: string,
): string {
  const value = payload[column];
  if (typeof value !== 'string' || value.trim() === '') {
    fail(
      `Lineup record '${recordId}' has no usable '${column}': migration 077 requires it `
      + `NOT NULL, and ${value === undefined ? 'the column is absent'
        : value === null ? 'the value is null' : `the value is ${typeof value}`}.`,
    );
  }
  return value;
}

/**
 * An optional string. A column the provider omitted and a column present with
 * NA both project to NULL here — the DISTINCTION between them is preserved
 * where it belongs, in the immutable observation payload, and the typed
 * projection is deliberately narrower than the payload.
 */
function optionalString(
  payload: Readonly<Record<string, JsonValue>>, column: string,
): string | null {
  const value = payload[column];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    fail(`Lineup column '${column}' must be a string, found ${typeof value}.`);
  }
  return value;
}

/**
 * `player.playerJumperNumber` -> `jumper_number`.
 *
 * The source emits an integer and migration 077's column is deliberately
 * `text`, matching `player_match_stats` and `staging_aflw.player_match_stats`
 * — a jumper number identifies rather than counts, and keeping the domain
 * identical is what lets an announced-versus-played reconciliation compare
 * without a cast. This is the obvious lossless representation of that integer
 * and nothing more: no padding, no sentinel, and NULL only where the source
 * supplied nothing.
 *
 * A value outside the column's `^[1-9][0-9]*$` domain REFUSES the record
 * rather than being nulled — inventing a NULL would erase a real source value
 * and hide a provider change behind a silent gap.
 */
function jumperNumber(
  payload: Readonly<Record<string, JsonValue>>, recordId: string,
): string | null {
  const value = payload['player.playerJumperNumber'];
  if (value === undefined || value === null) return null;
  const text = typeof value === 'number' && Number.isInteger(value)
    ? String(value)
    : typeof value === 'string' ? value : null;
  if (text === null) {
    fail(
      `Lineup record '${recordId}' has a non-integer jumper number `
      + `(${typeof value}); refusing rather than inventing a NULL.`,
    );
  }
  if (!/^[1-9][0-9]*$/.test(text)) {
    fail(
      `Lineup record '${recordId}' has jumper number '${text}', outside the `
      + 'afl_api_lineup_jumper_ck domain. Refusing rather than nulling a real value.',
    );
  }
  return text;
}

/**
 * Derive the typed projection from one bundle record. Pure and DB-free.
 *
 * `lateChanges` and `player.captain` are deliberately NOT read here. Neither
 * has a typed column: `lateChanges` is team-grain free text that must never be
 * parsed or name-matched, and `player.captain` was measured FALSE for 572 of
 * 572 rows and carries no captain signal. Both stay exactly as the provider
 * sent them in the observation payload.
 */
export function projectLineupRecord(record: LineupBundleRecord): LineupProjection {
  if (record.family !== LINEUP_FAMILY) {
    fail(`Record '${record.external_record_id}' is family '${record.family}', not lineup.`);
  }
  const payload = record.payload;
  const id = record.external_record_id;

  const providerMatchId = requiredString(payload, 'providerId', id);
  const providerTeamId = requiredString(payload, 'teamId', id);
  const providerPlayerId = requiredString(payload, 'player.playerId', id);

  // Migration 077's afl_api_lineup_external_record_id_ck asserts exactly this
  // in the database. Checking it here too means a mismatch is a named refusal
  // rather than an opaque constraint violation.
  const composed = `${providerMatchId}|${providerTeamId}|${providerPlayerId}`;
  if (composed !== id) {
    fail(
      `Lineup record id '${id}' does not equal its own provider components `
      + `('${composed}'). Refusing: the external key encoding is the row identity.`,
    );
  }

  return {
    externalRecordId: id,
    scopeKey: record.scope_key,
    providerMatchId,
    providerTeamId,
    providerPlayerId,
    status: requiredString(payload, 'status', id),
    teamStatus: requiredString(payload, 'teamStatus', id),
    roundName: optionalString(payload, 'round.name'),
    teamType: optionalString(payload, 'teamType'),
    position: optionalString(payload, 'position'),
    jumperNumber: jumperNumber(payload, id),
    teamNameRaw: optionalString(payload, 'teamName'),
    teamAbbrRaw: optionalString(payload, 'teamAbbr'),
    teamNicknameRaw: optionalString(payload, 'teamNickname'),
  };
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

/**
 * The bundle envelope this pass will accept.
 *
 * Fail-closed at the read boundary: a bundle naming another source, another
 * family, or a shape the family contract does not declare is refused before
 * any database work. This is the executable half of invariant 1 — the schema
 * can pin `family = 'lineup'` but cannot pin the source.
 */
export function assertPersistableLineupBundle(
  bundle: LineupBundle, contract: SourceFamilyContract,
): void {
  if (contract.sourceKey !== LINEUP_SOURCE_KEY || contract.family !== LINEUP_FAMILY) {
    fail(`This pass persists ${LINEUP_SOURCE_KEY}/${LINEUP_FAMILY} only.`);
  }
  if (bundle.source_key !== LINEUP_SOURCE_KEY) {
    fail(
      `Bundle names source '${bundle.source_key}', not '${LINEUP_SOURCE_KEY}'. `
      + 'Refusing: another source\'s observation is never projected into '
      + `${LINEUP_TARGET_TABLE}.`,
    );
  }
  if (!Number.isInteger(bundle.season) || !Number.isInteger(bundle.round_number)) {
    fail('Bundle must carry an integer season and round_number.');
  }
  for (const record of bundle.records) {
    if (record.family !== LINEUP_FAMILY) {
      fail(
        `Record '${record.external_record_id}' is family '${record.family}'. `
        + `Refusing: only ${LINEUP_FAMILY} records reach ${LINEUP_TARGET_TABLE}.`,
      );
    }
    // The S1 projection gate, re-run at the persistence boundary: an
    // undeclared column or a missing required one refuses here too.
    assertProjectableColumns(contract, record.observed_columns);
  }
  // Absence stays disabled by contract, not by omission. A bundle claiming a
  // complete enumeration for this family is a contradiction and refuses.
  for (const enumeration of bundle.enumerations) {
    if (enumeration.complete !== false) {
      fail(
        `Enumeration for scope '${enumeration.scope_key}' claims completeness. `
        + 'afl_api.lineup row-grain completeness is not established and absence '
        + 'sweeping is disabled for this family.',
      );
    }
  }
}

/** The head `version_seq` PostgreSQL settled on for one external record. */
async function currentVersionSeq(
  tx: Tx, sourceId: number, externalRecordId: string,
): Promise<number> {
  const [row] = await tx<{ versionSeq: number }[]>`
    SELECT current_version_seq AS "versionSeq"
      FROM staging.source_records
     WHERE source_id = ${sourceId}
       AND family = ${LINEUP_FAMILY}
       AND external_record_id = ${externalRecordId}
  `;
  if (row === undefined) {
    fail(
      `No source_records head for '${externalRecordId}' after persisting it. `
      + 'Refusing to link a typed projection to a version that does not exist.',
    );
  }
  return row.versionSeq;
}

/**
 * Upsert one typed projection, keyed on the source observation identity.
 *
 * `ON CONFLICT ... DO UPDATE`, exactly as migration 076's projections are
 * maintained. There is no delete-and-reload path: the typed row is the LATEST
 * view of an immutable versioned history, so it is moved forward in place and
 * the history it points at is never rewritten.
 *
 * Returns whether a row was created, which is how the caller distinguishes a
 * first projection from a revision without a second query.
 */
async function upsertProjection(
  tx: Tx,
  sourceId: number,
  versionSeq: number,
  season: number,
  roundNumber: number,
  projection: LineupProjection,
  batchId: ImportBatchId,
): Promise<'inserted' | 'updated'> {
  const [row] = await tx<{ inserted: boolean }[]>`
    INSERT INTO staging.afl_api_lineup (
      source_id, family, external_record_id, version_seq,
      provider_match_id, provider_team_id, provider_player_id,
      season, round_number, round_name,
      status, team_status,
      team_type, position, jumper_number,
      team_name_raw, team_abbr_raw, team_nickname_raw,
      projected_by_batch_id
    ) VALUES (
      ${sourceId}, ${LINEUP_FAMILY}, ${projection.externalRecordId}, ${versionSeq},
      ${projection.providerMatchId}, ${projection.providerTeamId},
      ${projection.providerPlayerId},
      ${season}, ${roundNumber}, ${projection.roundName},
      ${projection.status}, ${projection.teamStatus},
      ${projection.teamType}, ${projection.position}, ${projection.jumperNumber},
      ${projection.teamNameRaw}, ${projection.teamAbbrRaw}, ${projection.teamNicknameRaw},
      ${batchId}
    )
    ON CONFLICT (source_id, family, external_record_id) DO UPDATE SET
      version_seq = EXCLUDED.version_seq,
      provider_match_id = EXCLUDED.provider_match_id,
      provider_team_id = EXCLUDED.provider_team_id,
      provider_player_id = EXCLUDED.provider_player_id,
      season = EXCLUDED.season,
      round_number = EXCLUDED.round_number,
      round_name = EXCLUDED.round_name,
      status = EXCLUDED.status,
      team_status = EXCLUDED.team_status,
      team_type = EXCLUDED.team_type,
      position = EXCLUDED.position,
      jumper_number = EXCLUDED.jumper_number,
      team_name_raw = EXCLUDED.team_name_raw,
      team_abbr_raw = EXCLUDED.team_abbr_raw,
      team_nickname_raw = EXCLUDED.team_nickname_raw,
      projected_by_batch_id = EXCLUDED.projected_by_batch_id,
      projected_at = now()
    RETURNING (xmax = 0) AS inserted
  `;
  return row.inserted ? 'inserted' : 'updated';
}

export type LineupPersistOptions = {
  /** Overrides the observation timestamp. Tests pin it; production omits it. */
  observedAt?: string;
};

/**
 * Persist one emitted lineup bundle.
 *
 * ONE `sql.begin`, mirroring ISSUE-099's settle envelope: the `import_batches`
 * row, every spine version and every typed projection commit together or not
 * at all, so a typed row can never claim a source version that was not
 * successfully persisted.
 *
 * NOTE THE SIGNATURE: there is no `sourceId` parameter, and there is no
 * options field that could become one. The id is resolved inside the
 * transaction from the literal key and refuses when absent.
 */
export async function persistLineupBundle(
  sql: postgres.Sql,
  bundle: LineupBundle,
  contract: SourceFamilyContract,
  options: LineupPersistOptions = {},
): Promise<LineupPersistResult> {
  assertPersistableLineupBundle(bundle, contract);
  const observedAt = options.observedAt ?? new Date().toISOString();

  const counters: LineupCounters = {
    recordsRead: bundle.records.length,
    versionsInserted: 0,
    headsRefreshed: 0,
    projectionsInserted: 0,
    projectionsUpdated: 0,
    // Absence sweeping is disabled for this family; this is a statement, not
    // a running total.
    observationsMarkedAbsent: 0,
    // L3B2 writes no canonical row of any kind.
    canonicalRowsWritten: 0,
    // No approved deterministic provider-id path exists for any of the three,
    // so all three stay NULL and these stay 0. See the module report.
    matchIdsResolved: 0,
    clubIdsResolved: 0,
    playerIdsResolved: 0,
  };

  // AFLDB-ISSUE-105: the id is produced inside the transaction and returned
  // from it, so there is no sentinel to fall back to. A run that never
  // reaches the INSERT never yields a batch id at all.
  const batchId = await sql.begin(async (tx) => {
    // INVARIANT 1. Resolved here, from the literal key, inside the
    // transaction. `resolveSourceId` throws when the key has no row.
    const sources = await tx<{ id: number; key: string }[]>`SELECT id, key FROM sources`;
    const sourceId = resolveSourceId(
      new Map(sources.map((row) => [row.key, row.id])), LINEUP_SOURCE_KEY,
    );

    const [batch] = await tx<{ id: string }[]>`
      INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
      VALUES (${sourceId}, ${LINEUP_TOOL}, ${LINEUP_TARGET_TABLE},
              ${bundle.records.length},
              ${`AFLDB-ISSUE-100 lineup staging; snapshot=${bundle.snapshot_label}; `
                + `season=${bundle.season}; round=${bundle.round_number}`})
      RETURNING id
    `;
    // The column is bigint, so the driver hands it back as decimal text.
    // Decoded once, here, and opaque from this point on.
    const runBatchId = asImportBatchId(batch.id);

    for (const record of bundle.records) {
      const projection = projectLineupRecord(record);

      const observation: SourceObservation = {
        contract,
        sourceId,
        externalRecordId: record.external_record_id,
        scopeKey: record.scope_key,
        payload: record.payload,
      };
      // The spine decides whether this is a new version or an unchanged head.
      // Identical content refreshes the head and writes no version, which is
      // what makes a repeated import idempotent.
      const action = await persistSourceObservation(tx, observation, runBatchId, observedAt);
      if (action === 'version_inserted') counters.versionsInserted += 1;
      else counters.headsRefreshed += 1;

      // Read the settled head back out of PostgreSQL rather than inferring it,
      // so the typed row names the version the database actually holds.
      const versionSeq = await currentVersionSeq(tx, sourceId, record.external_record_id);

      const outcome = await upsertProjection(
        tx, sourceId, versionSeq, bundle.season, bundle.round_number, projection, runBatchId,
      );
      if (outcome === 'inserted') counters.projectionsInserted += 1;
      else counters.projectionsUpdated += 1;
    }

    // `records_rejected` must equal the number of import_rejections rows for
    // the batch (migration 001). This pass writes none: a record that cannot
    // project refuses the whole transaction rather than being recorded as a
    // rejection, so the two are consistent at 0.
    await tx`
      UPDATE import_batches
         SET records_inserted = ${counters.projectionsInserted},
             records_updated  = ${counters.projectionsUpdated},
             records_rejected = 0,
             completed_at = now(),
             status = 'completed'
       WHERE id = ${runBatchId}
    `;

    return runBatchId;
  });

  return { batchId, counters };
}
