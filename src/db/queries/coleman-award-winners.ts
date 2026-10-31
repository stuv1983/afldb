// db | Coleman derived award winners projection port production SQL
// Soft size threshold: 500 LOC. Run `phaneslight loc-check` if uncertain.
import 'server-only';

import { nativeTransactionOf, type SqlExecutor } from '@afldb/db';
import {
  COLEMAN_AWARD_SLUG,
  ColemanProjectionRefusal,
  planColemanProjection,
  previewOfColemanProjection,
  type ColemanDerivation,
  type ColemanPlannedRow,
  type ColemanProjectionAction,
  type ColemanProjectionPort,
  type ColemanProjectionPreview,
  type ColemanProjectionRequest,
  type ColemanProjectionResult,
  type ColemanStoredRow,
  type ColemanWinnerRowValues,
} from '@afldb/derived';

import {
  awardWinnerEntityKey,
  awardWinnerLineageIdentity,
  awardWinnerPaths,
  recomputeAwardSpan,
} from '@/db/queries/admin-awards';
import { recordDataEdit } from '@/db/queries/audit-log';

/**
 * The production Coleman projection port (AFLDB V2 Launch F, stream F-D; ADR 0015): publishes a
 * derived Coleman result into the canonical `award_winners` table, INSIDE the publisher's
 * transaction (`publishColemanResult(executor, request, { projection })`), after the ledger step.
 *
 * WHAT IT WRITES, and nothing else:
 *  - `award_winners` rows: INSERT (a new derived winner), UPDATE of the loader's column tuple (a
 *    corrected goal fact moved a value), UPDATE status 'void' (a winner the corrected facts no
 *    longer support). A row whose full tuple already equals the derivation is left UNTOUCHED
 *    (including `updated_at`): `retained`.
 *  - one `data_edits` row per inserted, updated or voided row (the AFLDB-ISSUE-027 audit contract),
 *    carrying the provenance (the ledger row, the versions, the input checksum, the evidence).
 *  - `awards.first_season/last_season` via the existing `recomputeAwardSpan`, when a row changed.
 *  - one `derived_award_projections` provenance row (migration 114): written for the first
 *    projection of a ledger result and for every projection that changes a row; an idempotent
 *    rerun (nothing changed, a projection already recorded for that result) writes NOTHING.
 *
 * NO `data_overrides` row is written for a derived row. The offline loader
 * (`tools/migration/import_awards.py`, `import_coleman`) re-derives the same rows from the same
 * facts under the same keys and values on every run, so the row is reproduced after a rebuild
 * without an override. An override would instead LOCK the row against the next re-derivation, so the
 * existence of one is a refusal (`admin_override_present`), not something to write.
 *
 * IDEMPOTENCY KEY: `(source_id of the contract source, source_record_id = coleman:<season>:<profile
 * path>)`, the loader's own key, backed by `award_winners_source_uq` (migration 042). Rerunning a
 * publication therefore cannot duplicate a winner.
 *
 * Every refusal throws {@link ColemanProjectionRefusal}; the publisher's transaction rolls back
 * (ledger row included) and the caller receives a typed refusal. A non-refusal error propagates and
 * rolls back as well.
 *
 * `preview` runs the same loader and the same pure planner without writing a byte.
 */

/** The data_edits field group of a projection write. */
export const COLEMAN_PROJECTION_FIELD_GROUP = 'coleman_derived_publication';

export interface ColemanAwardWinnerProjectionPort extends ColemanProjectionPort {
  /** What projecting would do, read-only (no write, no audit). */
  preview(executor: SqlExecutor, derivation: ColemanDerivation): Promise<ColemanProjectionPreview>;
}

/* ------------------------------------------------------------------ *
 * Loading (shared by the preview and the write)
 * ------------------------------------------------------------------ */

interface StoredSqlRow {
  id: number | string;
  awardId: number | string;
  season: number | string | null;
  status: string;
  sourceKey: string | null;
  sourceRecordId: string | null;
  playerId: number | string | null;
  playerNameRaw: string;
  linkStatus: string;
  candidateCount: number | string;
  clubId: number | string | null;
  clubNameRaw: string | null;
  votes: string | null;
  position: string | null;
  isCaptain: boolean;
  isViceCaptain: boolean;
  note: string | null;
}

interface LoadedProjectionState {
  readonly awardId: number;
  readonly sourceId: number;
  readonly sourceKey: string;
  readonly stored: ColemanStoredRow[];
  readonly displayNames: Record<string, string>;
  readonly overriddenEntityKeys: Set<string>;
}

function numberOrNull(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

async function loadProjectionState(
  executor: SqlExecutor,
  derivation: ColemanDerivation,
): Promise<LoadedProjectionState> {
  const season = derivation.season;
  const sourceKey = derivation.inputs.contract.sourceKey;

  const awards = await executor.query<{ id: number | string }>(
    'SELECT id::int AS id FROM awards WHERE slug = $1', [COLEMAN_AWARD_SLUG],
  );
  if (awards.length === 0) {
    throw new ColemanProjectionRefusal(
      'award_definition_missing',
      `Refused: there is no '${COLEMAN_AWARD_SLUG}' award definition to attach the winners to; nothing was written.`,
    );
  }
  const awardId = Number(awards[0].id);

  const sources = await executor.query<{ id: number | string }>(
    'SELECT id::int AS id FROM sources WHERE key = $1', [sourceKey],
  );
  if (sources.length === 0) {
    throw new ColemanProjectionRefusal(
      'source_missing',
      `Refused: the contract source '${sourceKey}' is not configured, so derived rows cannot be attributed; nothing was written.`,
    );
  }
  const sourceId = Number(sources[0].id);

  const rows = await executor.query<StoredSqlRow>(
    `SELECT w.id::int AS id, w.award_id::int AS "awardId", w.season::int AS season, w.status,
            s.key AS "sourceKey", w.source_record_id AS "sourceRecordId",
            w.player_id::int AS "playerId", w.player_name_raw AS "playerNameRaw",
            w.link_status_value::text AS "linkStatus", w.candidate_count::int AS "candidateCount",
            w.club_id::int AS "clubId", w.club_name_raw AS "clubNameRaw", w.votes::text AS votes,
            w.position AS position, w.is_captain AS "isCaptain", w.is_vice_captain AS "isViceCaptain",
            w.note AS note
       FROM award_winners w
       LEFT JOIN sources s ON s.id = w.source_id
      WHERE (w.award_id = $1::int AND w.season = $2::int)
         OR (w.source_id = $3::int AND w.source_record_id = ANY($4::text[]))
      ORDER BY w.id`,
    [awardId, season, sourceId, derivation.winners.map((winner) => winner.key)],
  );
  const stored: ColemanStoredRow[] = rows.map((row) => ({
    id: Number(row.id),
    awardId: Number(row.awardId),
    season: numberOrNull(row.season),
    status: row.status,
    sourceKey: row.sourceKey,
    sourceRecordId: row.sourceRecordId,
    playerId: numberOrNull(row.playerId),
    playerNameRaw: row.playerNameRaw,
    linkStatus: row.linkStatus,
    candidateCount: Number(row.candidateCount),
    clubId: numberOrNull(row.clubId),
    clubNameRaw: row.clubNameRaw,
    votes: row.votes,
    position: row.position,
    isCaptain: row.isCaptain,
    isViceCaptain: row.isViceCaptain,
    note: row.note,
  }));

  // The canonical display name of every derived winner (never the source spelling, never a guess).
  const playerIds = derivation.winners.map((winner) => Number(winner.playerId));
  const names = await executor.query<{ id: number | string; displayName: string }>(
    'SELECT id::int AS id, display_name AS "displayName" FROM players WHERE id = ANY($1::int[])',
    [playerIds],
  );
  const displayNames: Record<string, string> = {};
  for (const name of names) displayNames[String(Number(name.id))] = name.displayName;

  // Administrator overrides the loader replays: a data_overrides row for the entity key, or a human
  // player-link decision on the row. Either one means a publication must not rewrite the row.
  const entityKeys = new Set<string>(derivation.winners.map((winner) => awardWinnerEntityKey(sourceKey, winner.key)));
  for (const row of stored) {
    if (row.sourceKey !== null && row.sourceRecordId !== null) {
      entityKeys.add(awardWinnerEntityKey(row.sourceKey, row.sourceRecordId));
    }
  }
  const overriddenEntityKeys = new Set<string>();
  const overrides = await executor.query<{ entityKey: string }>(
    `SELECT DISTINCT entity_key AS "entityKey" FROM data_overrides
      WHERE entity_type = 'award_winners' AND entity_key = ANY($1::text[])`,
    [[...entityKeys]],
  );
  for (const override of overrides) overriddenEntityKeys.add(override.entityKey);
  const rowIds = stored.map((row) => row.id);
  const decisions = await executor.query<{ targetId: number | string }>(
    `SELECT DISTINCT target_id::int AS "targetId" FROM player_link_resolutions
      WHERE target_table = 'award_winners' AND target_id = ANY($1::int[])`,
    [rowIds],
  );
  const decided = new Set(decisions.map((decision) => Number(decision.targetId)));
  for (const row of stored) {
    if (decided.has(row.id) && row.sourceKey !== null && row.sourceRecordId !== null) {
      overriddenEntityKeys.add(awardWinnerEntityKey(row.sourceKey, row.sourceRecordId));
    }
  }

  return { awardId, sourceId, sourceKey, stored, displayNames, overriddenEntityKeys };
}

function planFor(derivation: ColemanDerivation, state: LoadedProjectionState) {
  return planColemanProjection({
    derivation,
    awardId: state.awardId,
    sourceKey: state.sourceKey,
    displayNames: state.displayNames,
    stored: state.stored,
    overriddenEntityKeys: state.overriddenEntityKeys,
    entityKeyOf: (sourceRecordId) => awardWinnerEntityKey(state.sourceKey, sourceRecordId),
  });
}

/* ------------------------------------------------------------------ *
 * Applying a plan
 * ------------------------------------------------------------------ */

function snapshot(values: ColemanWinnerRowValues | null): Record<string, unknown> {
  if (values === null) return {};
  return {
    player_id: values.playerId,
    player_name_raw: values.playerNameRaw,
    link_status_value: values.linkStatus,
    candidate_count: values.candidateCount,
    club_id: values.clubId,
    club_name_raw: values.clubNameRaw,
    votes: values.votes,
    position: values.position,
    is_captain: values.isCaptain,
    is_vice_captain: values.isViceCaptain,
    note: values.note,
  };
}

async function insertRow(
  tx: SqlExecutor,
  state: LoadedProjectionState,
  season: number,
  row: ColemanPlannedRow,
): Promise<number> {
  const v = row.after as ColemanWinnerRowValues;
  const inserted = await tx.query<{ id: number | string }>(
    `INSERT INTO award_winners (
       award_id, season, player_id, player_name_raw, link_status_value, candidate_count,
       club_id, club_name_raw, votes, position, is_captain, is_vice_captain, note,
       status, source_id, source_record_id, import_batch_id)
     VALUES ($1::int, $2::smallint, $3::int, $4, $5::link_status, $6::smallint,
             $7::int, $8, $9::numeric, $10, $11::boolean, $12::boolean, $13,
             'active', $14::smallint, $15, NULL)
     RETURNING id::int AS id`,
    [state.awardId, season, v.playerId, v.playerNameRaw, v.linkStatus, v.candidateCount,
      v.clubId, v.clubNameRaw, v.votes, v.position, v.isCaptain, v.isViceCaptain, v.note,
      state.sourceId, row.key],
  );
  return Number(inserted[0].id);
}

async function updateRow(tx: SqlExecutor, row: ColemanPlannedRow): Promise<void> {
  const v = row.after as ColemanWinnerRowValues;
  const updated = await tx.query<{ id: number | string }>(
    `UPDATE award_winners
        SET player_id = $2::int, player_name_raw = $3, link_status_value = $4::link_status,
            candidate_count = $5::smallint, club_id = $6::int, club_name_raw = $7,
            votes = $8::numeric, position = $9, is_captain = $10::boolean,
            is_vice_captain = $11::boolean, note = $12, updated_at = now()
      WHERE id = $1::int AND status = 'active'
      RETURNING id::int AS id`,
    [row.awardWinnerId, v.playerId, v.playerNameRaw, v.linkStatus, v.candidateCount,
      v.clubId, v.clubNameRaw, v.votes, v.position, v.isCaptain, v.isViceCaptain, v.note],
  );
  if (updated.length !== 1) {
    throw new Error(`Coleman projection: award_winners row ${row.awardWinnerId} was not active when it was updated`);
  }
}

async function voidRow(tx: SqlExecutor, row: ColemanPlannedRow, reason: string): Promise<void> {
  const voided = await tx.query<{ id: number | string }>(
    `UPDATE award_winners
        SET status = 'void', status_reason = $2, updated_at = now()
      WHERE id = $1::int AND status = 'active'
      RETURNING id::int AS id`,
    [row.awardWinnerId, reason],
  );
  if (voided.length !== 1) {
    throw new Error(`Coleman projection: award_winners row ${row.awardWinnerId} was not active when it was voided`);
  }
}

/** Public pages the changed rows can move: the union over each row's before and after values. */
async function revalidationPaths(
  tx: SqlExecutor,
  season: number,
  changed: readonly ColemanPlannedRow[],
): Promise<string[]> {
  if (changed.length === 0) return [];
  const playerIds = new Set<number>();
  const clubIds = new Set<number>();
  for (const row of changed) {
    for (const values of [row.before, row.after]) {
      if (values === null) continue;
      if (values.playerId !== null) playerIds.add(values.playerId);
      if (values.clubId !== null) clubIds.add(values.clubId);
    }
  }
  const players = await tx.query<{ id: number | string; slug: string }>(
    'SELECT id::int AS id, slug FROM players WHERE id = ANY($1::int[])', [[...playerIds]],
  );
  const clubs = await tx.query<{ id: number | string; slug: string }>(
    'SELECT id::int AS id, slug FROM clubs WHERE id = ANY($1::int[])', [[...clubIds]],
  );
  const playerSlugs = new Map(players.map((p) => [Number(p.id), p.slug]));
  const clubSlugs = new Map(clubs.map((c) => [Number(c.id), c.slug]));
  const paths = new Set<string>();
  for (const row of changed) {
    for (const values of [row.before, row.after]) {
      if (values === null) continue;
      for (const path of awardWinnerPaths({
        awardSlug: COLEMAN_AWARD_SLUG,
        season,
        playerId: values.playerId,
        playerSlug: values.playerId === null ? null : playerSlugs.get(values.playerId) ?? null,
        clubSlug: values.clubId === null ? null : clubSlugs.get(values.clubId) ?? null,
      })) paths.add(path);
    }
  }
  return [...paths];
}

async function project(tx: SqlExecutor, request: ColemanProjectionRequest): Promise<ColemanProjectionResult> {
  const native = nativeTransactionOf(tx);
  if (!native) {
    // Refuse rather than write outside the publication's transaction or without its audit helpers.
    throw new ColemanProjectionRefusal(
      'projection_unavailable',
      'Refused: the Coleman projection needs the postgres.js transaction executor made by withAwardProposalExecutor(); nothing was written.',
    );
  }
  const { derivation, derivedAwardResultId, ledgerOutcome, audit, publishedBy } = request;
  const season = derivation.season;
  const state = await loadProjectionState(tx, derivation);
  const plan = planFor(derivation, state);
  if (!plan.ok) {
    throw new ColemanProjectionRefusal(plan.refusal.code, plan.refusal.message, plan.refusal.subjects);
  }

  const provenance = {
    derived_award_result_id: derivedAwardResultId,
    ledger_outcome: ledgerOutcome,
    method_version: derivation.methodVersion,
    derivation_version: derivation.derivationVersion,
    input_checksum: derivation.inputChecksum,
    evidence_ref: audit.evidenceRef,
    workflow: audit.workflow,
  };
  const voidReason = `Coleman derivation ${derivation.derivationVersion} (method_version ${derivation.methodVersion}, `
    + `input ${derivation.inputChecksum.slice(0, 12)}) no longer supports this winner for ${season}; `
    + `derived_award_results #${derivedAwardResultId}`;

  const actions: ColemanProjectionAction[] = [];
  const changed: ColemanPlannedRow[] = [];
  for (const row of plan.planned) {
    let awardWinnerId = row.awardWinnerId;
    if (row.action === 'retained') {
      actions.push({ entityKey: row.entityKey, action: 'retained', awardWinnerId });
      continue;
    }
    if (row.action === 'inserted') awardWinnerId = await insertRow(tx, state, season, row);
    else if (row.action === 'updated') await updateRow(tx, row);
    else await voidRow(tx, row, voidReason);

    await recordDataEdit(native, {
      tableName: 'award_winners',
      rowId: awardWinnerId as number,
      fieldGroup: COLEMAN_PROJECTION_FIELD_GROUP,
      oldValues: row.action === 'inserted' ? {} : { ...snapshot(row.before), status: 'active' },
      newValues: {
        action: row.action,
        entity_key: row.entityKey,
        lineage_identity: awardWinnerLineageIdentity(state.sourceKey, row.key),
        season,
        ...(row.action === 'voided' ? { status: 'void', status_reason: voidReason } : { ...snapshot(row.after), status: 'active' }),
        changed_fields: row.changedFields,
        ...provenance,
      },
      adminUserId: publishedBy,
      note: audit.note,
      // Already decided by the Coleman publisher's own seal (derived_award_publication); the
      // editor seal re-checks the same note and records the same workflow.
      sealWorkflow: audit.workflow,
      seal: { kind: 'row' },
    });
    actions.push({ entityKey: row.entityKey, action: row.action, awardWinnerId });
    changed.push({ ...row, awardWinnerId });
  }
  if (changed.length > 0) await recomputeAwardSpan(native, state.awardId);

  const changedCount = changed.length;
  const retainedCount = plan.counts.retained;
  const existing = await tx.query<{ id: number | string }>(
    'SELECT id::int AS id FROM derived_award_projections WHERE derived_award_result_id = $1::bigint LIMIT 1',
    [derivedAwardResultId],
  );
  let projectionId: number | null = null;
  if (existing.length === 0 || changedCount > 0) {
    const recorded = await tx.query<{ id: number | string }>(
      `INSERT INTO derived_award_projections
         (derived_award_result_id, award_slug, season, projected_by, actions,
          changed_count, retained_count, correction)
       VALUES ($1::bigint, $2, $3::int, $4::int, $5::text::jsonb, $6::int, $7::int, $8::text::jsonb)
       RETURNING id::int AS id`,
      [derivedAwardResultId, COLEMAN_AWARD_SLUG, season, publishedBy, JSON.stringify(actions),
        changedCount, retainedCount, JSON.stringify(audit)],
    );
    projectionId = Number(recorded[0].id);
  }

  return {
    projectionId,
    actions,
    counts: plan.counts,
    changedCount,
    revalidatePaths: await revalidationPaths(tx, season, changed),
  };
}

async function preview(executor: SqlExecutor, derivation: ColemanDerivation): Promise<ColemanProjectionPreview> {
  try {
    const state = await loadProjectionState(executor, derivation);
    return previewOfColemanProjection(planFor(derivation, state));
  } catch (error) {
    if (error instanceof ColemanProjectionRefusal) {
      return { ok: false, refusal: { code: error.code, message: error.message, subjects: error.subjects } };
    }
    throw error;
  }
}

/** The production port. `publishColemanSeason` passes it on every publication (a unit test pins that). */
export const colemanAwardWinnerProjection: ColemanAwardWinnerProjectionPort = { project, preview };
