import 'server-only';

import type { TransactionalSqlExecutor } from '@afldb/db';

/**
 * The open AFL API settle refusals and findings, for the operations centre (V2-GAP-025). READ-ONLY,
 * over the `SqlExecutor` port, so the same SQL runs on the postgres.js import connection in
 * production and on in-memory PGlite in tests.
 *
 * WHERE A REFUSAL LIVES. `canonical_applications` is the append-only ledger of writes that HAPPENED
 * (verb insert/update/delete); a refused or rolled-back canonical application leaves no row there.
 * The settle records it instead as one open `data_issues` finding per target under the shared
 * `canonical_apply_failed` type and `AFLDB-ISSUE-122` owner stamp, narrowed to this source by
 * `details.source_key` (`recordApplyOutcomeFindings()` / `draftApplyRefusalIssue()` in
 * `settle-core.ts`; the rolled-back failure branch in `settle-afl-api.ts`). So:
 *
 *  - `refusals`: open `canonical_apply_failed` findings owned by `AFLDB-ISSUE-122` with
 *    `source_key = 'afl_api'` (AFL Tables' findings share type and owner and are excluded);
 *  - `findings`: every other open finding the two AFL API settle CLIs own
 *    (`settle-afl-api.ts`, `settle-afl-api-brownlow.ts`) with `source_key = 'afl_api'`: corroboration
 *    disagreements, match identity refusals, unmapped venues, period-score contradictions, match
 *    absences and Brownlow vote-set refusals.
 *
 * WHAT IS RETURNED. Bounded, named columns only: the id, type, severity, first detection, the
 * writer's own description (truncated), the record and target identity, the machine refusal or
 * reason code and the NAMES of the fields involved. Never `details` itself, never the failure
 * `error` text (it can carry SQL detail), never proposed values, conflicting values or a payload.
 *
 * ORDER AND PAGING. Newest first by `data_issues.id`, which is unique and never changes (a refresh
 * updates the open row in place), with a keyset cursor (`before`), so a page never repeats or skips
 * a row because another row was inserted meanwhile. The counts and the page are read in ONE
 * repeatable-read, READ ONLY transaction, so they describe the same snapshot and nothing can be
 * written through it.
 */

export const AFL_API_FINDINGS_SOURCE_KEY = 'afl_api';
/** `CANONICAL_APPLY_ISSUE_TYPE` / `CANONICAL_APPLY_ISSUE_OWNER` (`settle-shared.ts`), restated so this module stays light. */
export const AFL_API_REFUSAL_ISSUE_TYPE = 'canonical_apply_failed';
export const AFL_API_REFUSAL_ISSUE_OWNER = 'AFLDB-ISSUE-122';
/** The `details.owner` stamps of the two AFL API settle CLIs (`settle-afl-api.ts`, `afl-api-brownlow.ts`). */
export const AFL_API_SETTLE_FINDING_OWNERS = ['settle-afl-api.ts', 'settle-afl-api-brownlow.ts'] as const;

export const AFL_API_FINDING_SECTIONS = ['refusals', 'findings'] as const;
export type AflApiFindingSection = (typeof AFL_API_FINDING_SECTIONS)[number];

export const AFL_API_FINDINGS_PAGE_SIZE = 50;
export const AFL_API_FINDING_DESCRIPTION_LIMIT = 500;
export const AFL_API_FINDING_FIELD_LIMIT = 20;

/** A `data_issues.id` as decimal text: a positive bigint, never a JS number. */
export function isAflApiFindingCursor(value: string): boolean {
  return /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}

export type AflApiFindingRow = {
  /** `data_issues.id` as decimal text. */
  id: string;
  issueType: string;
  severity: string;
  /** First detection, UTC (`YYYY-MM-DDTHH:MM:SSZ`); a refresh does not move it. */
  detectedAt: string;
  entityType: string;
  description: string;
  descriptionTruncated: boolean;
  family: string | null;
  externalRecordId: string | null;
  targetTable: string | null;
  /** `details.refusal`, else `details.reason`; null when the writer recorded neither (a rolled-back failure). */
  reason: string | null;
  matchKey: string | null;
  /** Field NAMES only, at most {@link AFL_API_FINDING_FIELD_LIMIT}. */
  fields: string[];
  fieldsOmitted: number;
};

export type AflApiFindingCounts = { total: number; bySeverity: Record<string, number> };

export type AflApiFindingsPage = {
  section: AflApiFindingSection;
  /** The cursor this page was read after, or null for the newest page. */
  before: string | null;
  rows: AflApiFindingRow[];
  /** The cursor of the next (older) page, or null when this is the last. */
  nextBefore: string | null;
  pageSize: number;
  counts: Record<AflApiFindingSection, AflApiFindingCounts>;
};

/* Constant SQL only: no caller value is ever interpolated into the text. */
const REFUSAL_PREDICATE = `d.issue_type = $2 AND d.details->>'owner' = $3`;
const FINDING_PREDICATE = `d.details->>'owner' IN ($2, $3)`;

const pageSql = (predicate: string): string => `
  SELECT d.id::text AS id,
         d.issue_type AS "issueType",
         d.severity::text AS severity,
         to_char(d.detected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "detectedAt",
         d.entity_type AS "entityType",
         left(d.description, ${AFL_API_FINDING_DESCRIPTION_LIMIT}) AS description,
         length(d.description) > ${AFL_API_FINDING_DESCRIPTION_LIMIT} AS "descriptionTruncated",
         d.details->>'family' AS family,
         COALESCE(d.details->>'external_record_id', d.details->>'provider_match_id') AS "externalRecordId",
         d.details->>'target_table' AS "targetTable",
         COALESCE(d.details->>'refusal', d.details->>'reason') AS reason,
         d.details->>'match_key' AS "matchKey",
         CASE WHEN jsonb_typeof(d.details->'fields') = 'array' THEN d.details->'fields' ELSE '[]'::jsonb END AS fields
    FROM data_issues d
   WHERE d.resolved_at IS NULL
     AND d.details->>'source_key' = $1
     AND (${predicate})
     AND ($4::bigint IS NULL OR d.id < $4::bigint)
   ORDER BY d.id DESC
   LIMIT $5`;

const COUNTS_SQL = `
  SELECT CASE WHEN d.issue_type = $2 AND d.details->>'owner' = $3 THEN 'refusals' ELSE 'findings' END AS section,
         d.severity::text AS severity,
         count(*)::int AS count
    FROM data_issues d
   WHERE d.resolved_at IS NULL
     AND d.details->>'source_key' = $1
     AND ((d.issue_type = $2 AND d.details->>'owner' = $3) OR d.details->>'owner' IN ($4, $5))
   GROUP BY 1, 2`;

type RawRow = Omit<AflApiFindingRow, 'fields' | 'fieldsOmitted'> & { fields: unknown };

function projectRow(raw: RawRow): AflApiFindingRow {
  const names = (Array.isArray(raw.fields) ? raw.fields : []).filter((name): name is string => typeof name === 'string');
  return {
    id: String(raw.id),
    issueType: raw.issueType,
    severity: raw.severity,
    detectedAt: raw.detectedAt,
    entityType: raw.entityType,
    description: raw.description,
    descriptionTruncated: raw.descriptionTruncated === true,
    family: raw.family ?? null,
    externalRecordId: raw.externalRecordId ?? null,
    targetTable: raw.targetTable ?? null,
    reason: raw.reason ?? null,
    matchKey: raw.matchKey ?? null,
    fields: names.slice(0, AFL_API_FINDING_FIELD_LIMIT),
    fieldsOmitted: Math.max(0, names.length - AFL_API_FINDING_FIELD_LIMIT),
  };
}

/**
 * One page of one section, with both sections' counts. The caller validates `section` and `before`
 * (the operations-centre caller does); this throws on an invalid value rather than guessing.
 */
export async function readAflApiSettleFindings(
  executor: TransactionalSqlExecutor,
  input: { section: AflApiFindingSection; before: string | null; pageSize?: number },
): Promise<AflApiFindingsPage> {
  if (!(AFL_API_FINDING_SECTIONS as readonly string[]).includes(input.section)) {
    throw new Error(`unknown AFL API findings section: ${String(input.section)}`);
  }
  if (input.before !== null && !isAflApiFindingCursor(input.before)) {
    throw new Error('the AFL API findings cursor must be a positive integer id');
  }
  const pageSize = input.pageSize ?? AFL_API_FINDINGS_PAGE_SIZE;
  const [owner1, owner2] = AFL_API_SETTLE_FINDING_OWNERS;

  return executor.transaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const countRows = await tx.query<{ section: string; severity: string; count: number }>(COUNTS_SQL, [
      AFL_API_FINDINGS_SOURCE_KEY, AFL_API_REFUSAL_ISSUE_TYPE, AFL_API_REFUSAL_ISSUE_OWNER, owner1, owner2,
    ]);
    const pageParams = input.section === 'refusals'
      ? [AFL_API_FINDINGS_SOURCE_KEY, AFL_API_REFUSAL_ISSUE_TYPE, AFL_API_REFUSAL_ISSUE_OWNER]
      : [AFL_API_FINDINGS_SOURCE_KEY, owner1, owner2];
    const raw = await tx.query<RawRow>(
      pageSql(input.section === 'refusals' ? REFUSAL_PREDICATE : FINDING_PREDICATE),
      [...pageParams, input.before, pageSize + 1],
    );

    const counts: Record<AflApiFindingSection, AflApiFindingCounts> = {
      refusals: { total: 0, bySeverity: {} },
      findings: { total: 0, bySeverity: {} },
    };
    for (const row of countRows) {
      const bucket = counts[row.section as AflApiFindingSection];
      const n = Number(row.count);
      bucket.total += n;
      bucket.bySeverity[row.severity] = (bucket.bySeverity[row.severity] ?? 0) + n;
    }

    const rows = raw.slice(0, pageSize).map(projectRow);
    return {
      section: input.section,
      before: input.before,
      rows,
      nextBefore: raw.length > pageSize ? rows[rows.length - 1].id : null,
      pageSize,
      counts,
    };
  });
}
