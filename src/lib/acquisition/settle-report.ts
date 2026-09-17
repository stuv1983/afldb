/**
 * AFLDB-ISSUE-122 §9.3 / S6 — the AFL Tables settle exception report.
 *
 * Strictly read-only. It offers no path to accept, resolve or retire
 * anything: every mutation in this subsystem happens inside the settle
 * transaction, on evidence, and a report is not evidence.
 *
 * The report answers one question for the operator: WHAT NEEDS ATTENTION?
 * That is harder than listing the pending queue, because §5.2 deliberately
 * leaves a pending `promotion_candidates` row in place when the record it was
 * raised for later applies cleanly (the `AFLDB-ISSUE-099` F7 invariant — the
 * machine never retires a candidate and never fabricates an admin decision).
 * The queue is therefore the EXCEPTION SURFACE, not a backlog, and this
 * report splits it in two:
 *
 *   - **active** — a pending candidate whose record has not applied at or
 *     after the version the candidate cites. Somebody has to act.
 *   - **moot** — a pending candidate whose `(record, target)` has since been
 *     applied by the automatic path at the same or a later
 *     `source_version_seq`. Retained as history under F7; nothing to do.
 *
 * Unresolved identities are the ACTIVE pending candidates carrying the
 * `unresolved_identity` verb, enriched with the §9.3 context: the payload the
 * candidate's own evidence version cites (from the observation spine, which
 * is immutable), the exact reason from the `import_rejections` row the settle
 * wrote when it refused the record, and whether the canonical match itself
 * landed. The candidate, not the rejection, is the durable exception: a
 * record whose payload never moves is `unchanged` at gate 4 on every later
 * run (§9.3), so no further rejection row is written while it stays
 * unresolved — the rejection records the refusal once, the pending candidate
 * carries it until it is resolved or applied. Every pending candidate
 * appears exactly once: an active `unresolved_identity` one under
 * unresolved records, every other active one under candidates, and every
 * moot one under moot.
 *
 * Reuses existing infrastructure only: `promotion_candidates`,
 * `import_rejections`, `data_issues`, `canonical_applications`,
 * `staging.source_record_versions`, `staging.source_payloads`. No new
 * table, no new admin UI.
 */
import type postgres from 'postgres';

import { asImportBatchId, type ImportBatchId } from '../import-batch-id';

import type { JsonValue } from './observations';
import {
  CANONICAL_APPLY_ISSUE_OWNER,
  CANONICAL_APPLY_ISSUE_TYPE,
  MATCH_TARGET_TABLES,
  SETTLE_ISSUE_OWNER,
  SETTLE_ISSUE_TYPE,
  SETTLE_SOURCE_KEY,
} from './settle-afltables';

type Db = postgres.Sql;

/** The `import_batches.tool` value the settle stamps on every batch it opens. */
export const SETTLE_BATCH_TOOL = 'settle-afltables.ts';

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

export type SettleReportBatch = {
  /** AFLDB-ISSUE-105: the driver's decimal text, never a number. */
  batchId: ImportBatchId;
  completedAt: string | null;
  recordsRead: number;
  recordsRejected: number;
};

/** One unresolved record, with the §9.3 context. */
export type UnresolvedRecordException = {
  sourceKey: string;
  /** The contract family (`match` or `player_match_stats`). */
  family: string;
  externalRecordId: string;
  /** The evidence version the pending candidate cites. */
  sourceVersionSeq: number;
  /** The bundle projection's `match_key`, byte-identical to `matches.match_key`. */
  matchKey: string | null;
  season: number | null;
  roundCode: string | null;
  /** Display payload only — never an identity (source-families.json). */
  playerName: string | null;
  /** The AFL Tables profile URL path, the sole proven player identity in season. */
  profileUrl: string | null;
  /** The raw club string the source published the player under. */
  clubRaw: string | null;
  /** The canonical target the rejection was recorded against. */
  targetTable: string;
  /** Exactly the reason the settle recorded. */
  reason: string;
  /** Whether a canonical `matches` row exists for `matchKey` right now. */
  canonicalMatchApplied: boolean;
  canonicalMatchId: number | null;
};

export type CandidateException = {
  candidateId: string;
  family: string;
  externalRecordId: string;
  sourceVersionSeq: number;
  verb: string;
  targetTable: string;
  targetId: number | null;
  createdAt: string;
  /** The newest ledger version for the same `(record, target)`, if any. */
  latestAppliedVersionSeq: number | null;
  status: 'active' | 'moot';
};

export type OpenFinding = {
  issueType: string;
  issueKey: string;
  severity: string;
  detectedAt: string;
  description: string;
};

export type SettleExceptionReport = {
  sourceKey: string;
  season: number;
  /** The newest completed settle batch for the season, or null before any. */
  latestBatch: SettleReportBatch | null;
  /** Active: the pending `unresolved_identity` candidates, with their context. */
  unresolvedRecords: UnresolvedRecordException[];
  /**
   * The rest of the pending queue, classified. `active` excludes the
   * `unresolved_identity` candidates listed above; `moot` holds every moot
   * candidate whatever its verb.
   */
  candidates: { active: CandidateException[]; moot: CandidateException[] };
  /** Active: open `canonical_apply_failed` findings this issue owns. */
  applyFailures: OpenFinding[];
  /** Active: open `source_disagreement` findings ISSUE-099 owns. */
  disagreements: OpenFinding[];
  /** True when a findings list was cut at `OPEN_FINDING_LIMIT`. */
  findingsTruncated: boolean;
};

/** How many open findings of each kind the report lists before summarising. */
export const OPEN_FINDING_LIMIT = 20;

/* ------------------------------------------------------------------ *
 * Pure classification
 * ------------------------------------------------------------------ */

/**
 * §5.2 — whether a pending candidate is still an exception.
 *
 * A candidate cites the exact evidence version it was raised from. If the
 * automatic path has since applied the same `(record, target)` at that
 * version or a later one, the proposal the candidate carries is either
 * already canonical (the §9.3 retry lands at the SAME version) or superseded
 * by a newer one — `evaluateAcceptance` would refuse it as `stale_review`
 * either way. It is retained, unretired, and moot. Anything else is active:
 * nothing has landed for it, or what landed predates the disagreement.
 */
export function classifyCandidate(
  candidateVersionSeq: number, latestAppliedVersionSeq: number | null,
): 'active' | 'moot' {
  if (latestAppliedVersionSeq === null) return 'active';
  return latestAppliedVersionSeq >= candidateVersionSeq ? 'moot' : 'active';
}

/** The verb `recordOutcome()` gives a candidate refused for identity. */
export const UNRESOLVED_IDENTITY_VERB = 'unresolved_identity';

/** The reason reported when no rejection row survives for a candidate. */
export const REASON_NOT_RETAINED = 'unresolved identity (the rejection row was not retained)';

/**
 * `import_rejections.reason` is written as `<target_table>: <reason>` by
 * `recordOutcome()`. Split it back; a reason with no such prefix is reported
 * verbatim against an unknown target rather than dropped.
 */
export function splitRejectionReason(reason: string): { targetTable: string; reason: string } {
  const match = /^([a-z_]+): (.*)$/s.exec(reason);
  if (match === null) return { targetTable: 'unknown', reason };
  return { targetTable: match[1], reason: match[2] };
}

/** Whether a target belongs to the match family (§7.1: its record id IS the match key). */
export function isMatchFamilyTarget(targetTable: string): boolean {
  return (MATCH_TARGET_TABLES as readonly string[]).includes(targetTable);
}

function textOf(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function integerOf(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/**
 * The display name the source published, from the payload columns
 * `source-families.json` declares as display-only. Never an identity.
 */
export function playerNameOf(payload: Readonly<Record<string, JsonValue>>): string | null {
  const full = textOf(payload.player_name);
  if (full !== null) return full;
  const parts = [textOf(payload.first_name), textOf(payload.surname)].filter(
    (part): part is string => part !== null,
  );
  return parts.length > 0 ? parts.join(' ') : null;
}

/* ------------------------------------------------------------------ *
 * Building the report
 * ------------------------------------------------------------------ */

async function sourceIdOf(db: Db, sourceKey: string): Promise<number> {
  const [row] = await db<{ id: number }[]>`SELECT id::int AS id FROM sources WHERE key = ${sourceKey}`;
  if (!row) throw new Error(`Source '${sourceKey}' has no sources row.`);
  return row.id;
}

async function latestBatchOf(
  db: Db, sourceId: number, season: number,
): Promise<SettleReportBatch | null> {
  // The batch note is written by `runSettleAfltables()` as
  // `...; season=<year>; mode=<apply|dry-run>`. A dry run's batch row is
  // rolled back, so every persisted batch here was an apply.
  const [row] = await db<{
    id: string; completedAt: string | null; recordsRead: number; recordsRejected: number;
  }[]>`
    SELECT id::text AS id, completed_at::text AS "completedAt",
           records_read::int AS "recordsRead", records_rejected::int AS "recordsRejected"
      FROM import_batches
     WHERE source_id = ${sourceId}
       AND tool = ${SETTLE_BATCH_TOOL}
       AND status = 'completed'
       AND notes LIKE ${`%season=${season};%`}
     -- QUALIFIED, and it has to be. A bare ORDER BY id binds to the OUTPUT
     -- alias (id::text AS id) in PostgreSQL, not to the bigint column, so the
     -- newest batch was sorted as TEXT and '963' sorted above '1062'. The
     -- report then named a stale batch, and only once the id crossed a
     -- digit-count boundary, which is why it survived until AFLDB-ISSUE-131's
     -- tests pushed the test sequence past 1000. Found there, fixed here.
     ORDER BY import_batches.id DESC
     LIMIT 1
  `;
  if (!row) return null;
  return {
    batchId: asImportBatchId(row.id),
    completedAt: row.completedAt,
    recordsRead: row.recordsRead,
    recordsRejected: row.recordsRejected,
  };
}

type PendingCandidateRow = Omit<CandidateException, 'status'>;

/** Every pending candidate for the source and season, with its latest applied version. */
async function pendingCandidatesOf(
  db: Db, sourceId: number, season: number,
): Promise<PendingCandidateRow[]> {
  const rows = await db<PendingCandidateRow[]>`
    SELECT c.id::text AS "candidateId", c.family, c.external_record_id AS "externalRecordId",
           c.source_version_seq::int AS "sourceVersionSeq", c.verb,
           c.target_table AS "targetTable", c.target_id::int AS "targetId",
           c.created_at::text AS "createdAt",
           applied.latest::int AS "latestAppliedVersionSeq"
      FROM promotion_candidates c
      LEFT JOIN LATERAL (
        SELECT max(a.source_version_seq) AS latest
          FROM canonical_applications a
         WHERE a.source_id = c.source_id AND a.family = c.family
           AND a.external_record_id = c.external_record_id
           AND a.target_table = c.target_table
      ) applied ON true
     WHERE c.source_id = ${sourceId} AND c.season = ${season} AND c.status = 'pending'
     ORDER BY c.external_record_id, c.target_table
  `;
  return [...rows];
}

/**
 * The §9.3 context for one active `unresolved_identity` candidate: the
 * payload its own evidence version cites, the reason the settle recorded, and
 * whether the canonical match landed.
 */
async function unresolvedRecordOf(
  db: Db, sourceId: number, sourceKey: string, candidate: PendingCandidateRow,
): Promise<UnresolvedRecordException> {
  const [version] = await db<{ payload: Record<string, JsonValue> }[]>`
    SELECT p.raw_payload AS payload
      FROM staging.source_record_versions v
      JOIN staging.source_payloads p
        ON p.source_id = v.source_id AND p.family = v.family
       AND p.payload_hash = v.payload_hash
     WHERE v.source_id = ${sourceId} AND v.family = ${candidate.family}
       AND v.external_record_id = ${candidate.externalRecordId}
       AND v.version_seq = ${candidate.sourceVersionSeq}
  `;
  const payload = version?.payload ?? {};
  const isMatch = isMatchFamilyTarget(candidate.targetTable);
  // §7.1: a match record's external id IS its match_key; a player record
  // names its match in the payload.
  const matchKey = isMatch ? candidate.externalRecordId : textOf(payload.match_key);

  // The newest rejection row the settle wrote for this record and target —
  // written when the record was first refused and again whenever its payload
  // changes, never on an unchanged rerun.
  const [rejection] = await db<{ reason: string }[]>`
    SELECT reason FROM import_rejections
     WHERE source_record_id = ${candidate.externalRecordId}
       AND reason LIKE ${`${candidate.targetTable}: %`}
     ORDER BY id DESC
     LIMIT 1
  `;
  const [match] = matchKey === null
    ? []
    : await db<{ id: number }[]>`
        SELECT id::int AS id FROM matches WHERE match_key = ${matchKey}
      `;

  return {
    sourceKey,
    family: candidate.family,
    externalRecordId: candidate.externalRecordId,
    sourceVersionSeq: candidate.sourceVersionSeq,
    matchKey,
    season: integerOf(payload.season),
    roundCode: textOf(payload.round_code),
    playerName: isMatch ? null : playerNameOf(payload),
    profileUrl: isMatch ? null : textOf(payload.url),
    clubRaw: isMatch ? null : textOf(payload.playing_for_raw),
    targetTable: candidate.targetTable,
    reason: rejection === undefined
      ? REASON_NOT_RETAINED
      : splitRejectionReason(rejection.reason).reason,
    canonicalMatchApplied: match !== undefined,
    canonicalMatchId: match?.id ?? null,
  };
}

async function openFindingsOf(
  db: Db, issueType: string, owner: string,
): Promise<{ findings: OpenFinding[]; truncated: boolean }> {
  // Not season-scoped: `data_issues` carries no season, and inferring one
  // from a record id would be a guess. Ownership keeps it to the findings
  // these two writers actually wrote.
  const rows = await db<OpenFinding[]>`
    SELECT d.issue_type AS "issueType", d.issue_key AS "issueKey",
           d.severity::text AS severity,
           to_char(d.detected_at, 'YYYY-MM-DD') AS "detectedAt", d.description
      FROM data_issues d
     WHERE d.issue_type = ${issueType}
       AND d.resolved_at IS NULL
       AND d.details->>'owner' = ${owner}
     ORDER BY d.severity DESC, d.issue_key
     LIMIT ${OPEN_FINDING_LIMIT + 1}
  `;
  return {
    findings: [...rows].slice(0, OPEN_FINDING_LIMIT),
    truncated: rows.length > OPEN_FINDING_LIMIT,
  };
}

/**
 * Build the report for one source and season. Read-only; safe on any
 * connection, inside or outside a transaction.
 */
export async function buildSettleExceptionReport(
  db: Db, input: { season: number; sourceKey?: string },
): Promise<SettleExceptionReport> {
  const sourceKey = input.sourceKey ?? SETTLE_SOURCE_KEY;
  const sourceId = await sourceIdOf(db, sourceKey);
  const latestBatch = await latestBatchOf(db, sourceId, input.season);

  const unresolvedRecords: UnresolvedRecordException[] = [];
  const candidates = { active: [] as CandidateException[], moot: [] as CandidateException[] };
  for (const row of await pendingCandidatesOf(db, sourceId, input.season)) {
    const status = classifyCandidate(row.sourceVersionSeq, row.latestAppliedVersionSeq);
    if (status === 'moot') {
      candidates.moot.push({ ...row, status });
    } else if (row.verb === UNRESOLVED_IDENTITY_VERB) {
      unresolvedRecords.push(await unresolvedRecordOf(db, sourceId, sourceKey, row));
    } else {
      candidates.active.push({ ...row, status });
    }
  }

  const failures = await openFindingsOf(db, CANONICAL_APPLY_ISSUE_TYPE, CANONICAL_APPLY_ISSUE_OWNER);
  const disagreements = await openFindingsOf(db, SETTLE_ISSUE_TYPE, SETTLE_ISSUE_OWNER);
  return {
    sourceKey,
    season: input.season,
    latestBatch,
    unresolvedRecords,
    candidates,
    applyFailures: failures.findings,
    disagreements: disagreements.findings,
    findingsTruncated: failures.truncated || disagreements.truncated,
  };
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function countBy<T>(rows: readonly T[], keyOf: (row: T) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(keyOf(row), (counts.get(keyOf(row)) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** The report as terminal lines. Pure; the caller decides where they go. */
export function renderSettleExceptionReport(report: SettleExceptionReport): string[] {
  const lines: string[] = [];
  const activeCount = report.unresolvedRecords.length
    + report.candidates.active.length
    + report.applyFailures.length
    + report.disagreements.length;

  lines.push('');
  lines.push(`AFL Tables settle exceptions — ${report.sourceKey}, season ${report.season}`);
  if (report.latestBatch === null) {
    lines.push('  No completed settle batch for this season yet.');
  } else {
    lines.push(
      `  Latest completed batch ${report.latestBatch.batchId}`
      + ` (${report.latestBatch.completedAt ?? 'completion time unknown'}):`
      + ` ${report.latestBatch.recordsRead} records read,`
      + ` ${report.latestBatch.recordsRejected} rejection rows.`,
    );
  }

  lines.push('');
  lines.push(`ACTIVE — requires attention (${activeCount})`);

  lines.push('');
  lines.push(`  Unresolved identities (${report.unresolvedRecords.length})`);
  if (report.unresolvedRecords.length === 0) lines.push('    (none)');
  for (const row of report.unresolvedRecords) {
    lines.push(
      `    ${row.family} '${row.externalRecordId}'`
      + ` v${row.sourceVersionSeq} -> ${row.targetTable}: ${row.reason}`,
    );
    const context: string[] = [];
    if (row.playerName !== null) context.push(`player ${row.playerName}`);
    if (row.profileUrl !== null) context.push(`profile ${row.profileUrl}`);
    if (row.clubRaw !== null) context.push(`club ${row.clubRaw}`);
    if (row.season !== null) context.push(`season ${row.season}`);
    if (row.roundCode !== null) context.push(`round ${row.roundCode}`);
    if (context.length > 0) lines.push(`      ${context.join(' · ')}`);
    lines.push(
      `      match ${row.matchKey ?? '(unknown)'}: `
      + (row.canonicalMatchApplied
        ? `canonical (matches.id ${row.canonicalMatchId})`
        : 'NOT canonical'),
    );
  }

  lines.push('');
  lines.push(`  Other pending candidates still open (${report.candidates.active.length})`);
  if (report.candidates.active.length === 0) lines.push('    (none)');
  for (const [key, n] of countBy(report.candidates.active, (c) => `${c.targetTable} / ${c.verb}`)) {
    lines.push(`    ${key}: ${n}`);
  }
  for (const c of report.candidates.active) {
    lines.push(
      `    #${c.candidateId} ${c.family} '${c.externalRecordId}' v${c.sourceVersionSeq}`
      + ` -> ${c.targetTable} (${c.verb})`
      + (c.latestAppliedVersionSeq === null
        ? ', never applied'
        : `, last applied v${c.latestAppliedVersionSeq}`),
    );
  }

  lines.push('');
  lines.push(`  Open canonical apply failures (${report.applyFailures.length})`);
  if (report.applyFailures.length === 0) lines.push('    (none)');
  for (const f of report.applyFailures) {
    lines.push(`    [${f.severity}] ${f.issueKey} — first detected ${f.detectedAt}`);
    lines.push(`        ${f.description}`);
  }

  lines.push('');
  lines.push(`  Open source disagreements (${report.disagreements.length})`);
  if (report.disagreements.length === 0) lines.push('    (none)');
  for (const f of report.disagreements) {
    lines.push(`    [${f.severity}] ${f.issueKey} — first detected ${f.detectedAt}`);
    lines.push(`        ${f.description}`);
  }
  if (report.findingsTruncated) {
    lines.push(
      `    … more than ${OPEN_FINDING_LIMIT} open; query data_issues directly for the full list.`,
    );
  }

  lines.push('');
  lines.push(
    `MOOT — pending candidates whose record has since applied (${report.candidates.moot.length});`
    + ' retained as history under AFLDB-ISSUE-099 F7, nothing to do',
  );
  if (report.candidates.moot.length === 0) lines.push('    (none)');
  for (const [key, n] of countBy(report.candidates.moot, (c) => `${c.targetTable} / ${c.verb}`)) {
    lines.push(`    ${key}: ${n}`);
  }
  for (const c of report.candidates.moot) {
    lines.push(
      `    #${c.candidateId} ${c.family} '${c.externalRecordId}' v${c.sourceVersionSeq}`
      + ` -> ${c.targetTable} (${c.verb}), applied v${c.latestAppliedVersionSeq}`,
    );
  }

  return lines;
}
