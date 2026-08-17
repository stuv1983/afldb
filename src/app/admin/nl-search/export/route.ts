import {
  getNlFailureBreakdown,
  getReformulations,
  getTopPlans,
  getTopUnsupportedTerms,
  getUnsupportedTopics,
  listNlSearchesForExport,
  parseNlLogPeriod,
} from '@/db/queries/nl-search-log';
import { audit, requireSuperAdmin } from '@/lib/auth/session';
import { csvResponse, toCsv } from '@/lib/csv';

export const dynamic = 'force-dynamic';

/**
 * CSV export of the natural-language search telemetry, for offline
 * analysis -- reading a few hundred real questions in a spreadsheet is a
 * far better way to spot a vocabulary gap than paging through a web table.
 *
 * A Route Handler rather than a Server Action because the response is a
 * file download: actions return data to the calling component, they cannot
 * set Content-Disposition.
 *
 * Super-admin only, twice over: middleware requires an admin cookie to
 * reach anything under /admin, and requireSuperAdmin then re-checks the
 * session against the database, where it can be revoked. That matters more
 * here than on most admin pages, because this endpoint hands over raw
 * reader-typed questions in bulk rather than a screenful at a time -- and
 * the export is audited for the same reason.
 *
 * `dataset` is matched against a fixed map of builders. An unknown value
 * is a 400, never a fallback to the largest export.
 */

const DATASETS = {
  /** Everything, one row per search: the richest input for analysis. */
  searches: async (days: number) => {
    const rows = await listNlSearchesForExport(days);
    return toCsv([
      'id', 'at', 'question', 'outcome', 'failureReason', 'topic',
      'grain', 'metric', 'confidence',
      'tokenRatio', 'playerCertainty', 'structuralPenalty', 'unresolvedPenalty',
      'unsupportedTerms', 'entityResolution', 'plan', 'planHash',
      'resultCount', 'durationMs', 'parserVersion',
      'sessionId', 'parentSearchId',
      'reviewStatus', 'reviewCategory', 'reviewNotes',
    ] as const, rows);
  },

  /** Just the failures, same shape -- the working set for a triage session. */
  problems: async (days: number) => {
    const rows = (await listNlSearchesForExport(days)).filter((r) => r.failureReason !== null);
    return toCsv([
      'id', 'at', 'question', 'outcome', 'failureReason', 'topic',
      'grain', 'metric', 'confidence',
      'tokenRatio', 'playerCertainty', 'structuralPenalty', 'unresolvedPenalty',
      'unsupportedTerms', 'resultCount', 'durationMs',
      'reviewStatus', 'reviewCategory', 'reviewNotes',
    ] as const, rows);
  },

  terms: async (days: number) => {
    const rows = await getTopUnsupportedTerms(days, 1000);
    return toCsv(['term', 'count', 'example', 'exampleId'] as const, rows);
  },

  topics: async (days: number) => {
    const rows = await getUnsupportedTopics(days);
    return toCsv(['topic', 'count'] as const, rows);
  },

  reasons: async (days: number) => {
    const rows = await getNlFailureBreakdown(days);
    return toCsv(['failureReason', 'count', 'outstanding'] as const, rows);
  },

  reformulations: async (days: number) => {
    const rows = await getReformulations(days, 1000);
    return toCsv([
      'parentId', 'parentQuestion', 'parentOutcome',
      'id', 'question', 'outcome', 'secondsApart',
    ] as const, rows);
  },

  plans: async (days: number) => {
    const rows = await getTopPlans(days, 1000);
    return toCsv([
      'planHash', 'searches', 'distinctQuestions', 'grain', 'metric', 'example', 'exampleId',
    ] as const, rows);
  },
} as const;

// Not exported: a Route Handler module may only export the HTTP verbs and
// Next's own route config, so anything else here stays module-private.
type NlExportDataset = keyof typeof DATASETS;
const DATASET_NAMES = Object.keys(DATASETS) as NlExportDataset[];

function isDataset(value: string): value is NlExportDataset {
  return Object.prototype.hasOwnProperty.call(DATASETS, value);
}

export async function GET(request: Request) {
  const admin = await requireSuperAdmin();

  const url = new URL(request.url);
  const dataset = url.searchParams.get('dataset') ?? 'searches';
  if (!isDataset(dataset)) {
    return new Response(`Unknown dataset. One of: ${DATASET_NAMES.join(', ')}`, { status: 400 });
  }
  const days = parseNlLogPeriod(url.searchParams.get('days') ?? undefined);

  const csv = await DATASETS[dataset](days);

  await audit('nl_search.exported', { dataset, days }, { userId: admin.id, label: admin.email });

  const stamp = new Date().toISOString().slice(0, 10);
  return csvResponse(`afldb-nl-${dataset}-${days}d-${stamp}.csv`, csv);
}
