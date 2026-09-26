/**
 * AFLDB-ISSUE-231 D-231-3 (operator decision 2026-09-26, option A) — the
 * `afl_api` match-family absence sweep: detect, refuse, and leave a durable
 * finding that only a human acknowledgement clears.
 *
 * THE CONTRACT
 *
 *   - D-231-1 stays exactly 0 (`AFL_API_ABSENCE_TOLERANCE`). Any provider id
 *     that leaves an otherwise COMPLETE season enumeration while its spine row
 *     is not yet stamped absent HALTs the settle, and the settle transaction
 *     rolls back in full: no canonical write, no spine stamp, no candidate, no
 *     batch row survives it.
 *   - The refusal itself must outlive that rollback, so AFTER it, and only for
 *     this halt, `recordAflApiMatchAbsenceFindings()` opens ONE `data_issues`
 *     finding per missing provider id in its own import-role transaction. It
 *     writes nothing else. No other settle failure is moved out of the settle
 *     transaction.
 *   - The finding is keyed (`aflApiMatchAbsenceIssueKey()`) through the existing
 *     `uq_data_issues_open_by_key` dedup. A repeated detection of the same
 *     unacknowledged absence inserts nothing (`ON CONFLICT … DO NOTHING`), so the
 *     first-detection provenance is never overwritten, and the settle halts
 *     again.
 *   - `acknowledgeAflApiMatchAbsence()` (CLI:
 *     `tools/current-season/acknowledge-afl-api-match-absence.ts`) is the only
 *     path that stamps `staging.source_records.absent_since` for this family. It
 *     re-proves the finding, the spine row and a complete retained feed that
 *     still omits the id, then stamps the finding's first-detected time and
 *     resolves that one finding, in one transaction. Canonical rows,
 *     `source_record_id` and every other finding are untouched; it rekeys nothing.
 *   - Once stamped, the id is `stillAbsent`, not `newlyAbsent`, so the next
 *     complete-feed settle proceeds, and the retired-identity search it already
 *     runs (residual 1) becomes reachable under every existing ambiguity and
 *     F010 withholding rule.
 *   - D-231-2: an id a complete feed lists again has `absent_since` cleared,
 *     selected by the CONCLUDED filter or not. An UNACKNOWLEDGED finding whose
 *     id is listed again is resolved `source_reappeared` and no stamp is ever
 *     made. A later disappearance is a new episode: the spine row is unstamped
 *     and the old finding is resolved, so a NEW finding opens and the settle
 *     halts again. Resolved history is never an allowlist.
 *   - An incomplete enumeration decides nothing: it cannot stamp, clear,
 *     acknowledge, or open a finding.
 *
 * ACTOR (D-231-3 actor decision, option c). The acknowledgement records the
 * PostgreSQL role that ran it (`current_user`) as the DATABASE ACTOR, beside
 * the database, the tool, the finding, the proving feed and the time. The
 * database actor is operational attribution, not authenticated human identity:
 * the role is shared (`afldb_import`), so it never names a person, and no
 * `--operator` flag, actor column or attribution-only `import_batches` row
 * exists. A future authenticated Admin Centre acknowledgement may add human
 * attribution; it is out of scope here.
 */
import type postgres from 'postgres';

import {
  AFL_API_ABSENCE_TOLERANCE,
  assessAflApiSeasonEnumeration,
  planAflApiAbsenceSweep,
  type AflApiAbsencePlan,
  type AflApiSeasonEnumeration,
} from './afl-api-season-enumeration';

type Tx = postgres.TransactionSql;

export const AFL_API_MATCH_ABSENCE_ISSUE_TYPE = 'afl_api_match_absence';
/** The settle opens the finding and is the owner every resolver scopes on. */
export const AFL_API_MATCH_ABSENCE_ISSUE_OWNER = 'settle-afl-api.ts';
export const AFL_API_MATCH_ABSENCE_HALT_REASON = 'afl_api_match_absence';
export const AFL_API_MATCH_ABSENCE_ACK_TOOL = 'acknowledge-afl-api-match-absence.ts';

export const AFL_API_MATCH_ABSENCE_RESOLUTION = {
  /** A human acknowledged the disappearance; `absent_since` was stamped. */
  acknowledged: 'source_absence_acknowledged',
  /** A complete feed listed the id again before anyone acknowledged it. */
  reappeared: 'source_reappeared',
} as const;

const SOURCE_KEY = 'afl_api';
const MATCH_FAMILY = 'match';

/** `afl_api|match|<scope>|<provider id>|absence`: source, family, scope and record, all four. */
export function aflApiMatchAbsenceIssueKey(scopeKey: string, externalRecordId: string): string {
  if (!scopeKey || !externalRecordId) {
    throw new Error('An afl_api absence finding key needs both the scope and the provider id.');
  }
  return [SOURCE_KEY, MATCH_FAMILY, scopeKey, externalRecordId, 'absence'].join('|');
}

/** What the halted settle observed, carried out of its rolled-back transaction. */
export type AflApiMatchAbsenceDetection = {
  sourceId: number;
  season: number;
  scopeKey: string;
  compSeasonProviderId: string;
  snapshotLabel: string;
  seasonFeedSha256: string | null;
  seasonFeedMatches: number;
  /** The halted run's observation clock; becomes `absent_since` on acknowledgement. */
  observedAt: string;
  plan: AflApiAbsencePlan;
};

export type AflApiMatchAbsenceSweepOutcome =
  | { kind: 'not_applicable' }
  | { kind: 'halt'; detection: AflApiMatchAbsenceDetection }
  | { kind: 'swept'; plan: AflApiAbsencePlan; cleared: number; findingsResolved: number };

/**
 * Inside the settle transaction, before any unit is settled. Decides with
 * `planAflApiAbsenceSweep()` (id-list semantics, DB-free); on a halt it writes
 * NOTHING and returns the detection for the caller to throw. Otherwise it
 * applies D-231-2 and closes unacknowledged findings whose id is listed again.
 * Those writes belong to the settle transaction and roll back with it.
 */
export async function sweepAflApiMatchAbsence(
  tx: Tx,
  input: {
    sourceId: number; enumeration: AflApiSeasonEnumeration; snapshotLabel: string; observedAt: string;
  },
): Promise<AflApiMatchAbsenceSweepOutcome> {
  const { enumeration } = input;
  if (!enumeration.complete) return { kind: 'not_applicable' };

  const spine = await tx<{ externalRecordId: string; absentSince: string | null }[]>`
    SELECT external_record_id AS "externalRecordId", absent_since::text AS "absentSince"
      FROM staging.source_records
     WHERE source_id = ${input.sourceId} AND family = ${MATCH_FAMILY} AND scope_key = ${enumeration.scopeKey}
  `;
  const plan = planAflApiAbsenceSweep(enumeration, spine);
  if (plan.exceedsTolerance) {
    return {
      kind: 'halt',
      detection: {
        sourceId: input.sourceId,
        season: enumeration.season,
        scopeKey: enumeration.scopeKey,
        compSeasonProviderId: enumeration.compSeasonProviderId,
        snapshotLabel: input.snapshotLabel,
        seasonFeedSha256: enumeration.sourceSha256,
        seasonFeedMatches: enumeration.providerMatchIds.length,
        observedAt: input.observedAt,
        plan,
      },
    };
  }

  let cleared = 0;
  if (plan.reappeared.length > 0) {
    const rows = await tx`
      UPDATE staging.source_records SET absent_since = NULL
       WHERE source_id = ${input.sourceId} AND family = ${MATCH_FAMILY} AND scope_key = ${enumeration.scopeKey}
         AND external_record_id = ANY (${[...plan.reappeared]}::text[])
         AND absent_since IS NOT NULL
      RETURNING external_record_id
    `;
    cleared = rows.length;
  }

  const reappearance = {
    observed_at: input.observedAt,
    snapshot_label: input.snapshotLabel,
    season_feed_sha256: enumeration.sourceSha256,
  };
  const resolved = await tx`
    UPDATE data_issues
       SET resolved_at = now(),
           resolution = ${AFL_API_MATCH_ABSENCE_RESOLUTION.reappeared},
           details = details || jsonb_build_object('reappearance', ${tx.json(reappearance as never)}::jsonb)
     WHERE issue_type = ${AFL_API_MATCH_ABSENCE_ISSUE_TYPE}
       AND resolved_at IS NULL
       AND details->>'owner' = ${AFL_API_MATCH_ABSENCE_ISSUE_OWNER}
       AND details->>'source_key' = ${SOURCE_KEY}
       AND details->>'family' = ${MATCH_FAMILY}
       AND details->>'scope_key' = ${enumeration.scopeKey}
       AND details->>'external_record_id' = ANY (${[...enumeration.providerMatchIds]}::text[])
    RETURNING id
  `;
  return { kind: 'swept', plan, cleared, findingsResolved: resolved.length };
}

export type AflApiMatchAbsenceFindingsOutcome = {
  /** A new open finding was inserted for these ids (first detection of this episode). */
  opened: readonly string[];
  /** An open finding already existed; nothing was written, first detection preserved. */
  alreadyOpen: readonly string[];
  /** The spine row moved (gone, re-scoped or stamped) between the rollback and this write. */
  notRecorded: readonly string[];
};

/**
 * The ONE write that survives an absence HALT, in its own transaction on the
 * settle's own import-role client, opened only after the settle transaction
 * has rolled back. It inserts at most one open finding per newly absent id and
 * touches nothing else. Each insert re-reads the spine row, so a row that was
 * acknowledged or re-scoped meanwhile is reported, never mis-recorded.
 */
export async function recordAflApiMatchAbsenceFindings(
  sql: postgres.Sql, detection: AflApiMatchAbsenceDetection,
): Promise<AflApiMatchAbsenceFindingsOutcome> {
  const opened: string[] = [];
  const alreadyOpen: string[] = [];
  const notRecorded: string[] = [];
  await sql.begin(async (tx) => {
    for (const externalRecordId of detection.plan.newlyAbsent) {
      const issueKey = aflApiMatchAbsenceIssueKey(detection.scopeKey, externalRecordId);
      const details = {
        owner: AFL_API_MATCH_ABSENCE_ISSUE_OWNER,
        source_key: SOURCE_KEY,
        family: MATCH_FAMILY,
        season: detection.season,
        scope_key: detection.scopeKey,
        external_record_id: externalRecordId,
        comp_season_provider_id: detection.compSeasonProviderId,
        first_detected_at: detection.observedAt,
        first_detected_snapshot_label: detection.snapshotLabel,
        first_detected_season_feed_sha256: detection.seasonFeedSha256,
        first_detected_season_feed_matches: detection.seasonFeedMatches,
        halt_reason: AFL_API_MATCH_ABSENCE_HALT_REASON,
        tolerance: AFL_API_ABSENCE_TOLERANCE,
        reason: 'D-231-1 tolerance 0: the provider id is missing from a complete season feed and is not '
          + 'acknowledged, so the settle HALTed and rolled back in full. Acknowledge with '
          + `${AFL_API_MATCH_ABSENCE_ACK_TOOL} once a human has confirmed the disappearance.`,
        issue: 'AFLDB-ISSUE-231 D-231-3',
      };
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO data_issues (entity_type, entity_id, issue_type, issue_key, severity, description, details)
        SELECT 'matches',
               (SELECT m.id FROM matches m
                 WHERE m.source_id = ${detection.sourceId} AND m.source_record_id = sr.external_record_id
                 ORDER BY m.id LIMIT 1),
               ${AFL_API_MATCH_ABSENCE_ISSUE_TYPE}, ${issueKey}, 'error',
               ${`afl_api match '${externalRecordId}' is missing from the complete ${detection.scopeKey} feed `
                 + `(${detection.compSeasonProviderId}). The settle halted; nothing was written. `
                 + 'A human must acknowledge the disappearance before the season settles again.'},
               ${tx.json(details as never)}::jsonb
                 || jsonb_build_object('spine_first_seen_at', sr.first_seen_at, 'spine_last_seen_at', sr.last_seen_at)
          FROM staging.source_records sr
         WHERE sr.source_id = ${detection.sourceId} AND sr.family = ${MATCH_FAMILY}
           AND sr.external_record_id = ${externalRecordId} AND sr.scope_key = ${detection.scopeKey}
           AND sr.absent_since IS NULL
        ON CONFLICT (issue_type, issue_key) WHERE issue_key IS NOT NULL AND resolved_at IS NULL
          DO NOTHING
        RETURNING id::text AS id
      `;
      if (row) {
        opened.push(externalRecordId);
        continue;
      }
      const [open] = await tx<{ id: string }[]>`
        SELECT id::text AS id FROM data_issues
         WHERE issue_type = ${AFL_API_MATCH_ABSENCE_ISSUE_TYPE} AND issue_key = ${issueKey} AND resolved_at IS NULL
      `;
      (open ? alreadyOpen : notRecorded).push(externalRecordId);
    }
  });
  return { opened, alreadyOpen, notRecorded };
}

/* ------------------------------------------------------------------ *
 * Acknowledgement (the CLI's core; validate-only unless `apply`)
 * ------------------------------------------------------------------ */

export type AflApiMatchAbsenceAckInput = {
  season: number;
  compSeasonProviderId: string;
  externalRecordId: string;
  findingId: string;
  /** The retained snapshot whose feed is offered as the still-current proof. */
  snapshotLabel: string;
  /** That feed's text, already hash-verified against its manifest by the caller. */
  seasonFeedText: string;
  /** The manifest's sha256 for that feed; must equal the hash of `seasonFeedText`. */
  seasonFeedSha256: string;
  apply: boolean;
  /** Required with `apply`: must equal the live `current_database()`. */
  acknowledgeDatabase: string | null;
};

export type AflApiMatchAbsenceAckOutcome = {
  database: string;
  role: string;
  findingId: string;
  issueKey: string;
  /** The value `absent_since` is (or would be) stamped with: the finding's first detection. */
  absentSince: string;
  spineFirstSeenAt: string;
  applied: boolean;
};

export class AflApiMatchAbsenceAckRefused extends Error {
  constructor(message: string) {
    super(`Acknowledgement refused: ${message} Nothing was written.`);
    this.name = 'AflApiMatchAbsenceAckRefused';
  }
}

class ValidateOnlyRollback extends Error {
  constructor(readonly outcome: AflApiMatchAbsenceAckOutcome) {
    super('afl_api absence acknowledgement: validate-only, rolling back deliberately');
  }
}

function refuse(message: string): never {
  throw new AflApiMatchAbsenceAckRefused(message);
}

/**
 * DB-free half: the offered feed must be the verified bytes, complete by the
 * SAME completeness parser the settle uses, for the named season, and must
 * still omit the id. A stale finding alone never suffices.
 */
export function proveAflApiMatchAbsenceFeed(
  input: Pick<AflApiMatchAbsenceAckInput,
    'season' | 'compSeasonProviderId' | 'externalRecordId' | 'seasonFeedText' | 'seasonFeedSha256'>,
): AflApiSeasonEnumeration {
  const enumeration = assessAflApiSeasonEnumeration(input.seasonFeedText, {
    season: input.season, compSeasonProviderId: input.compSeasonProviderId,
  });
  if (enumeration.sourceSha256 !== input.seasonFeedSha256) {
    refuse(`the season feed text hashes to ${enumeration.sourceSha256}, not the manifest's ${input.seasonFeedSha256}.`);
  }
  if (!enumeration.complete) {
    refuse(`the retained season feed is not complete (${enumeration.gaps.map((gap) => gap.reason).join(', ')}), `
      + 'so it cannot prove the provider id is absent.');
  }
  if (enumeration.providerMatchIds.includes(input.externalRecordId)) {
    refuse(`the complete season feed lists '${input.externalRecordId}' again. It is not absent; the next settle `
      + 'resolves its finding as source_reappeared.');
  }
  return enumeration;
}

/** The wording the D-231-3 actor decision requires on every acknowledgement record. */
export const AFL_API_MATCH_ABSENCE_ACTOR_NOTE =
  'database actor is operational attribution, not authenticated human identity';

/**
 * The bounded `details.acknowledgement` object an applied acknowledgement adds
 * to its finding (the SQL adds `acknowledged_at`). Pure, so its shape is
 * tested DB-free. It never carries a human name: `database_actor` is the
 * PostgreSQL role, labelled as such.
 */
export function aflApiMatchAbsenceAcknowledgementRecord(input: {
  databaseActor: string; database: string; findingId: string; issueKey: string;
  season: number; externalRecordId: string; snapshotLabel: string;
  seasonFeedSha256: string; seasonFeedMatches: number; firstDetectedAt: string;
}): Record<string, string | number> {
  return {
    database_actor: input.databaseActor,
    database_actor_kind: 'postgresql_role',
    actor_note: AFL_API_MATCH_ABSENCE_ACTOR_NOTE,
    database: input.database,
    tool: AFL_API_MATCH_ABSENCE_ACK_TOOL,
    finding_id: input.findingId,
    issue_key: input.issueKey,
    season: input.season,
    external_record_id: input.externalRecordId,
    proved_by_snapshot_label: input.snapshotLabel,
    proved_by_season_feed_sha256: input.seasonFeedSha256,
    proved_by_season_feed_matches: input.seasonFeedMatches,
    first_detected_at: input.firstDetectedAt,
    absent_since: input.firstDetectedAt,
    resolution: AFL_API_MATCH_ABSENCE_RESOLUTION.acknowledged,
  };
}

/**
 * Re-prove everything inside one transaction, then (only with `apply`) stamp
 * `absent_since` and resolve that one finding. Validate-only runs the same
 * reads and rolls back, so it writes nothing on any path.
 */
export async function acknowledgeAflApiMatchAbsence(
  sql: postgres.Sql, input: AflApiMatchAbsenceAckInput,
): Promise<AflApiMatchAbsenceAckOutcome> {
  if (!/^[1-9][0-9]*$/.test(input.findingId)) refuse(`finding id '${input.findingId}' is not a data_issues id.`);
  const enumeration = proveAflApiMatchAbsenceFeed(input);
  const scopeKey = enumeration.scopeKey;
  const issueKey = aflApiMatchAbsenceIssueKey(scopeKey, input.externalRecordId);

  try {
    return await sql.begin(async (tx) => {
      const [identity] = await tx<{ database: string; role: string }[]>`
        SELECT current_database() AS database, current_user AS role
      `;
      if (input.apply && identity.database !== input.acknowledgeDatabase) {
        refuse(`connected to '${identity.database}', but --acknowledge names '${input.acknowledgeDatabase ?? ''}'.`);
      }
      const [source] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = ${SOURCE_KEY}`;
      if (!source) refuse("sources has no 'afl_api' row.");

      const lock = input.apply ? tx`FOR UPDATE` : tx``;
      const [finding] = await tx<{
        issueType: string; issueKey: string | null; open: boolean; details: Record<string, unknown> | null;
      }[]>`
        SELECT issue_type AS "issueType", issue_key AS "issueKey", resolved_at IS NULL AS open, details
          FROM data_issues WHERE id = ${input.findingId} ${lock}
      `;
      if (!finding) refuse(`data_issues ${input.findingId} does not exist.`);
      const details = finding.details ?? {};
      if (finding.issueType !== AFL_API_MATCH_ABSENCE_ISSUE_TYPE || finding.issueKey !== issueKey
        || details.owner !== AFL_API_MATCH_ABSENCE_ISSUE_OWNER || details.source_key !== SOURCE_KEY
        || details.family !== MATCH_FAMILY || details.scope_key !== scopeKey
        || details.external_record_id !== input.externalRecordId) {
        refuse(`data_issues ${input.findingId} is not the ISSUE-231 absence finding for `
          + `${SOURCE_KEY}/${MATCH_FAMILY} ${scopeKey} '${input.externalRecordId}' (key ${finding.issueKey ?? 'none'}).`);
      }
      if (!finding.open) refuse(`data_issues ${input.findingId} is already resolved.`);
      const firstDetectedAt = details.first_detected_at;
      if (typeof firstDetectedAt !== 'string' || Number.isNaN(Date.parse(firstDetectedAt))) {
        refuse(`data_issues ${input.findingId} carries no readable first_detected_at.`);
      }

      const [spine] = await tx<{ scopeKey: string; absent: boolean; firstSeenAt: string; invariantHolds: boolean }[]>`
        SELECT scope_key AS "scopeKey", absent_since IS NOT NULL AS absent, first_seen_at::text AS "firstSeenAt",
               ${firstDetectedAt}::timestamptz >= first_seen_at AS "invariantHolds"
          FROM staging.source_records
         WHERE source_id = ${source.id} AND family = ${MATCH_FAMILY} AND external_record_id = ${input.externalRecordId}
         ${lock}
      `;
      if (!spine) refuse(`staging.source_records has no afl_api match row '${input.externalRecordId}'.`);
      if (spine.scopeKey !== scopeKey) {
        refuse(`the spine row is in scope '${spine.scopeKey}', not '${scopeKey}'.`);
      }
      if (spine.absent) refuse(`the spine row is already stamped absent_since.`);
      if (!spine.invariantHolds) {
        refuse(`first_detected_at ${firstDetectedAt} precedes the spine row's first_seen_at ${spine.firstSeenAt} `
          + '(source_records_absent_ck).');
      }

      const outcome: AflApiMatchAbsenceAckOutcome = {
        database: identity.database, role: identity.role, findingId: input.findingId, issueKey,
        absentSince: firstDetectedAt, spineFirstSeenAt: spine.firstSeenAt, applied: false,
      };
      if (!input.apply) throw new ValidateOnlyRollback(outcome);

      const stamped = await tx`
        UPDATE staging.source_records SET absent_since = ${firstDetectedAt}::timestamptz
         WHERE source_id = ${source.id} AND family = ${MATCH_FAMILY}
           AND external_record_id = ${input.externalRecordId} AND scope_key = ${scopeKey}
           AND absent_since IS NULL
        RETURNING external_record_id
      `;
      if (stamped.length !== 1) refuse('the spine row changed under the lock.');
      const acknowledgement = aflApiMatchAbsenceAcknowledgementRecord({
        databaseActor: identity.role,
        database: identity.database,
        findingId: input.findingId,
        issueKey,
        season: input.season,
        externalRecordId: input.externalRecordId,
        snapshotLabel: input.snapshotLabel,
        seasonFeedSha256: input.seasonFeedSha256,
        seasonFeedMatches: enumeration.providerMatchIds.length,
        firstDetectedAt,
      });
      // Only the `acknowledgement` key is added: `details || {acknowledgement}` leaves every
      // first-detection key byte-identical. `acknowledged_at` is the transaction's now(), the same
      // instant as `resolved_at`.
      const resolved = await tx`
        UPDATE data_issues
           SET resolved_at = now(),
               resolution = ${AFL_API_MATCH_ABSENCE_RESOLUTION.acknowledged},
               details = details || jsonb_build_object(
                 'acknowledgement', ${tx.json(acknowledgement as never)}::jsonb || jsonb_build_object('acknowledged_at', now()))
         WHERE id = ${input.findingId} AND resolved_at IS NULL
           AND issue_type = ${AFL_API_MATCH_ABSENCE_ISSUE_TYPE} AND issue_key = ${issueKey}
           AND details->>'owner' = ${AFL_API_MATCH_ABSENCE_ISSUE_OWNER}
        RETURNING id
      `;
      if (resolved.length !== 1) refuse('the finding changed under the lock.');
      return { ...outcome, applied: true };
    });
  } catch (error) {
    if (error instanceof ValidateOnlyRollback) return error.outcome;
    throw error;
  }
}
