/**
 * AFLDB-ISSUE-127 — the settle run's result, from the structured source.
 *
 * `AFLDB-ISSUE-122`'s settle already records every run: it opens an
 * `import_batches` row inside the run's transaction and, on the way out,
 * stamps it `completed` with the whole counter set in `validation_result`
 * (`src/lib/acquisition/settle-afltables.ts:1772-1876`). That row is the
 * repository's own structured record of a run, so the admin surface reads it
 * rather than scraping human-oriented journal text.
 *
 * Read-only, on the app pool (`afldb_app`, SELECT-only). `import_batches` has
 * been app-readable since migration 039 seeded the registry, so this needs no
 * new grant and no new table. The importing DSN is never touched — unlike
 * `getCurrentSeasonReport()`, which opens `AFLDB_IMPORT_DATABASE_URL` and so
 * cannot work from the web service at all (that DSN is stripped by
 * `deploy/afldb.service`).
 *
 * A dry run leaves nothing here: `--dry-run` throws `SettleDryRunRollback` and
 * the rollback discards the batch row with everything else. Every row this
 * module can see was an apply.
 */
import 'server-only';

import {
  assessSourceCompleteness,
  type SourceCompletenessVerdict,
} from '@/lib/acquisition/source-completeness';

import { sql } from '@/db/client';

/** The `import_batches.tool` value the settle stamps on every batch it opens. */
export const SETTLE_BATCH_TOOL = 'settle-afltables.ts';

/**
 * The counters worth putting in front of an operator, extracted by name from
 * `validation_result`.
 *
 * A whitelist rather than a pass-through of the jsonb: `SettleCounters` is an
 * internal shape that will grow, and an admin surface should show what it
 * means to show rather than whatever the last change to the settle happened
 * to add.
 */
export type SettleRunCounters = {
  /**
   * AFLDB-ISSUE-128 — the snapshot coverage counters, whitelisted for the
   * same reason the canonical ones are. They were already written to
   * `validation_result` by every ISSUE-122 run; nothing but this projection
   * was missing, which is exactly why a run could drop 94 source rows and
   * still present an operator with a clean result table.
   */
  snapshotMatches: number;
  snapshotPlayerMatchRows: number;
  /** Enumerated records that did not project. */
  snapshotRejections: number;
  /** Acquired rows whose presence AFLDB could not represent at all. */
  snapshotUnkeyedRejections: number;
  /** Scopes not proven complete, so not absence-swept. */
  absenceSweepSkipped: number;

  canonicalRowsInserted: number;
  canonicalRowsUpdated: number;
  canonicalApplicationsLogged: number;
  canonicalApplyRefusals: number;
  canonicalApplyFailures: number;
  /** The four `unresolvedIdentity*` counters, summed (§9.3's exception surface). */
  unresolvedIdentity: number;
  /** `source_disagreement`: advisory only — it never blocks a canonical write (§10). */
  advisoryDisagreement: number;
  /** 1 when the season-scoped derived recompute ran, 0 when no canonical row moved. */
  derivedRecomputeRuns: number;
  derivedRecomputePlayers: number;
};

export type SettleRunRecord = {
  /** AFLDB-ISSUE-105: `import_batches.id` is bigint — decimal text, never a number. */
  batchId: string;
  /** The snapshot label, parsed from the batch note. The run identifier. */
  snapshotLabel: string | null;
  season: number | null;
  /** The `import_status` enum: running | completed | failed | rolled_back. */
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  recordsRead: number;
  recordsRejected: number;
  /** Null when the run did not reach the counter stamp — i.e. it did not finish. */
  counters: SettleRunCounters | null;
  /**
   * AFLDB-ISSUE-128. Derived from the counters above, never stored: the
   * verdict is a reading of a run, so an older batch row gets today's reading
   * rather than the reading whichever build happened to write it.
   * `unknown` when `counters` is null.
   */
  sourceCompleteness: SourceCompletenessVerdict;
};

/**
 * `runSettleAfltables()` writes the note as
 * `AFLDB-ISSUE-099 settle; snapshot=<label>; season=<year>; mode=<apply|dry-run>`.
 * Parsed rather than joined against, so this query needs no `sources` read.
 */
export function parseSettleBatchNote(
  notes: string | null,
): { snapshotLabel: string | null; season: number | null } {
  if (notes === null) return { snapshotLabel: null, season: null };
  const label = /snapshot=([^;]+)/.exec(notes);
  const season = /season=(\d{4})/.exec(notes);
  return {
    snapshotLabel: label === null ? null : label[1].trim(),
    season: season === null ? null : Number(season[1]),
  };
}

function counterOf(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Project the whitelisted counters out of `validation_result`.
 *
 * postgres.js decodes jsonb for us, so this receives an object rather than
 * text. A run that failed before the stamp has `validation_result` NULL, and
 * that is reported as "no counters" rather than as a run of zeroes — the two
 * are different facts and an operator must not confuse them.
 */
export function extractSettleCounters(validationResult: unknown): SettleRunCounters | null {
  if (validationResult === null || typeof validationResult !== 'object') return null;
  const raw = validationResult as Record<string, unknown>;
  return {
    snapshotMatches: counterOf(raw, 'snapshotMatches'),
    snapshotPlayerMatchRows: counterOf(raw, 'snapshotPlayerMatchRows'),
    snapshotRejections: counterOf(raw, 'snapshotRejections'),
    snapshotUnkeyedRejections: counterOf(raw, 'snapshotUnkeyedRejections'),
    absenceSweepSkipped: counterOf(raw, 'absenceSweepSkipped'),
    canonicalRowsInserted: counterOf(raw, 'canonicalRowsInserted'),
    canonicalRowsUpdated: counterOf(raw, 'canonicalRowsUpdated'),
    canonicalApplicationsLogged: counterOf(raw, 'canonicalApplicationsLogged'),
    canonicalApplyRefusals: counterOf(raw, 'canonicalApplyRefusals'),
    canonicalApplyFailures: counterOf(raw, 'canonicalApplyFailures'),
    unresolvedIdentity:
      counterOf(raw, 'unresolvedIdentityPlayer')
      + counterOf(raw, 'unresolvedIdentityClub')
      + counterOf(raw, 'unresolvedIdentityVenue')
      + counterOf(raw, 'unresolvedIdentityMatch'),
    advisoryDisagreement: counterOf(raw, 'advisoryDisagreement'),
    derivedRecomputeRuns: counterOf(raw, 'derivedRecomputeRuns'),
    derivedRecomputePlayers: counterOf(raw, 'derivedRecomputePlayers'),
  };
}

type BatchRow = {
  id: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  recordsRead: number;
  recordsRejected: number;
  notes: string | null;
  validationResult: unknown;
};

/**
 * The newest settle batch, whatever its status.
 *
 * Deliberately NOT filtered to `status = 'completed'` the way
 * `settle-report.ts`'s `latestBatchOf()` is. That function answers "what is
 * the settled state of the season"; this one answers "what happened to the
 * last run", and a run that ended `failed` is precisely what an operator who
 * just pressed the button needs to see.
 *
 * `ORDER BY id DESC` rather than by timestamp: the id is a monotonic identity
 * column, so it orders runs even when two start in the same millisecond.
 */
export async function getLatestSettleRun(): Promise<SettleRunRecord | null> {
  const [row] = await sql<BatchRow[]>`
    SELECT id::text                  AS id,
           status::text              AS status,
           started_at::text          AS "startedAt",
           completed_at::text        AS "completedAt",
           records_read::int         AS "recordsRead",
           records_rejected::int     AS "recordsRejected",
           notes                     AS notes,
           validation_result         AS "validationResult"
      FROM import_batches
     WHERE tool = ${SETTLE_BATCH_TOOL}
     ORDER BY id DESC
     LIMIT 1
  `;
  if (!row) return null;

  const { snapshotLabel, season } = parseSettleBatchNote(row.notes);
  const counters = extractSettleCounters(row.validationResult);
  return {
    batchId: row.id,
    snapshotLabel,
    season,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    recordsRead: row.recordsRead,
    recordsRejected: row.recordsRejected,
    counters,
    sourceCompleteness: assessSourceCompleteness(counters),
  };
}
