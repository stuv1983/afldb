import {
  PROPOSAL_STATUSES,
  type ProposalRecord,
  type ProposalStatus,
} from '@afldb/admin';
import { BROWNLOW_ELIGIBILITY_RULES, type BrownlowEligibilityRule } from '@afldb/derived';
import {
  COVERAGE_FAMILIES,
  COVERAGE_FAMILY_LABELS,
  COVERAGE_STATUSES,
  type CoverageEntry,
  type CoverageFamily,
  type CoverageStatus,
  type SealedSeasons,
  type SeasonRegistry,
} from '@afldb/domain';

import type { AflApiFindingSection } from '@/db/queries/afl-api-settle-findings';
import type { SettleRunRecord } from '@/db/queries/settle-runs';
import { hasCapability, type Capability, type CapabilityViewer } from '@/lib/auth/capabilities';
import { parseSeason } from '@/lib/params';

/**
 * The pure view models of the operations centre (AFLDB V2 Stage 5, plan D9, ADR 0009).
 *
 * Everything here is a plain function of plain data: no hooks, no database, no `server-only`
 * module imports (only erased type imports), so the page loaders can build these from live reads
 * and the capture/contract tests can build them from SYNTHETIC props. Nothing here decides who may
 * see a link beyond `hasCapability`, and a link left out is furniture, never the boundary: every
 * destination calls its own `requireCapability`.
 */

/* ------------------------------------------------------------------ *
 * A read that may have failed
 * ------------------------------------------------------------------ */

/** One independently failing read: a failure becomes an inline notice, never a thrown page. */
export type Loaded<T> = { ok: true; value: T } | { ok: false; error: string; code?: string };

export const loadedOk = <T>(value: T): Loaded<T> => ({ ok: true, value });
export const loadedFail = <T>(error: string, code?: string): Loaded<T> => ({
  ok: false,
  error,
  ...(code === undefined ? {} : { code }),
});

export { formatInstant } from './format';

/* ------------------------------------------------------------------ *
 * Data health: the coverage registry
 * ------------------------------------------------------------------ */

export const COVERAGE_STATUS_LABELS: Readonly<Record<CoverageStatus, string>> = {
  api_verified: 'API verified',
  api_partial: 'API partial',
  historical_baseline: 'Historical baseline',
  manual_curated: 'Manual curated',
  unsupported: 'Unsupported',
};

export type CoverageStatusCounts = Record<CoverageStatus, number>;

export type CoverageFamilyRow = {
  family: CoverageFamily;
  label: string;
  /** Seasons covered by each status (a season counts once per entry it falls in). */
  byStatus: CoverageStatusCounts;
  total: number;
  from: number | null;
  through: number | null;
};

export type CoverageHealth = {
  entryCount: number;
  rows: CoverageFamilyRow[];
  /** Family-seasons per status across every family. */
  totals: { byStatus: CoverageStatusCounts; total: number };
  /** The earliest and latest season any entry of that status covers; null when none does. */
  spans: Record<CoverageStatus, { from: number; through: number } | null>;
};

const emptyCounts = (): CoverageStatusCounts => Object.fromEntries(
  COVERAGE_STATUSES.map((status) => [status, 0]),
) as CoverageStatusCounts;

/** Counts per status overall and per family, and the season span of each status. Pure. */
export function summariseCoverage(registry: readonly CoverageEntry[]): CoverageHealth {
  const totals = emptyCounts();
  const spans: Record<CoverageStatus, { from: number; through: number } | null> = Object.fromEntries(
    COVERAGE_STATUSES.map((status) => [status, null]),
  ) as Record<CoverageStatus, { from: number; through: number } | null>;

  const rows = COVERAGE_FAMILIES.map((family): CoverageFamilyRow => {
    const byStatus = emptyCounts();
    let from: number | null = null;
    let through: number | null = null;
    for (const entry of registry) {
      if (entry.family !== family) continue;
      const seasons = entry.through - entry.from + 1;
      byStatus[entry.status] += seasons;
      totals[entry.status] += seasons;
      from = from === null ? entry.from : Math.min(from, entry.from);
      through = through === null ? entry.through : Math.max(through, entry.through);
      const span = spans[entry.status];
      spans[entry.status] = span === null
        ? { from: entry.from, through: entry.through }
        : { from: Math.min(span.from, entry.from), through: Math.max(span.through, entry.through) };
    }
    return {
      family,
      label: COVERAGE_FAMILY_LABELS[family],
      byStatus,
      total: COVERAGE_STATUSES.reduce((sum, status) => sum + byStatus[status], 0),
      from,
      through,
    };
  });

  return {
    entryCount: registry.length,
    rows,
    totals: { byStatus: totals, total: COVERAGE_STATUSES.reduce((sum, status) => sum + totals[status], 0) },
    spans,
  };
}

/* ------------------------------------------------------------------ *
 * Sealed seasons
 * ------------------------------------------------------------------ */

export type SealedSeasonsView = {
  from: number;
  through: number;
  /** Seasons inside the range that are still open (in progress), so NOT sealed. */
  open: number[];
  /** `in_progress_seasons` as the registry lists it. */
  inProgress: number[];
  /** Seasons that are sealed: the range less the open ones. */
  sealedCount: number;
  lastSeason: number;
};

export function sealedSeasonsView(registry: SeasonRegistry, sealed: SealedSeasons): SealedSeasonsView {
  return {
    from: sealed.from,
    through: sealed.through,
    open: [...sealed.open],
    inProgress: [...registry.in_progress_seasons].sort((a, b) => a - b),
    sealedCount: sealed.through - sealed.from + 1 - sealed.open.length,
    lastSeason: registry.last_season,
  };
}

/* ------------------------------------------------------------------ *
 * Acquisition runs (read-only status)
 * ------------------------------------------------------------------ */

/** The structural subset of `SettleUnitStatus` / `SettleRunStatus` the status rows read. */
export type UnitStatusLike = {
  unit: {
    loadState: string;
    phase: string;
    activeState: string;
    result: string;
    inactiveEnterTimestamp: string;
  } | null;
  unitError: string | null;
  latestRun: Pick<
    SettleRunRecord,
    'batchId' | 'snapshotLabel' | 'season' | 'status' | 'completedAt' | 'recordsRead' | 'recordsRejected'
  > | null;
  latestRunError: string | null;
};

export type UnitRowView = {
  key: string;
  label: string;
  /** What the systemd unit is doing now. */
  service: string;
  /** True when `service` is an explanation of why there is no state (shown muted). */
  serviceMuted: boolean;
  /** The newest committed batch, in words. */
  batch: string;
  /** True when `batch` explains a failure or an absence rather than describing a batch. */
  batchMuted: boolean;
};

const PHASE_TEXT: Record<string, string> = {
  running: 'Running',
  idle: 'Idle',
  failed: 'Last run failed',
  unknown: 'Unknown',
};

export const UNIT_NOT_INSTALLED_TEXT = 'Not installed on this host.';
export const BATCH_UNREADABLE_TEXT = 'The latest committed batch could not be read (see the server log).';

/** One status row. Starts nothing; shows what systemd says and what the newest committed batch is. */
export function unitRowView(key: string, label: string, status: UnitStatusLike): UnitRowView {
  let service: string;
  let serviceMuted = false;
  const unit = status.unit;
  if (unit === null) {
    service = status.unitError ?? 'Service state is not available on this host.';
    serviceMuted = true;
  } else if (unit.loadState === 'not-found') {
    service = UNIT_NOT_INSTALLED_TEXT;
    serviceMuted = true;
  } else {
    service = PHASE_TEXT[unit.phase] ?? PHASE_TEXT.unknown;
    if (unit.activeState !== '') service += ` (${unit.activeState})`;
    if (unit.result !== '' && unit.result !== 'success') service += `, result ${unit.result}`;
    if (unit.phase !== 'running' && unit.inactiveEnterTimestamp !== '') service += `, last finished ${unit.inactiveEnterTimestamp}`;
  }

  let batch: string;
  let batchMuted = false;
  if (status.latestRunError !== null) {
    batch = BATCH_UNREADABLE_TEXT;
    batchMuted = true;
  } else if (status.latestRun === null) {
    batch = 'No batch recorded yet.';
    batchMuted = true;
  } else {
    const run = status.latestRun;
    const parts = [`Batch ${run.batchId}, status ${run.status}`];
    if (run.snapshotLabel !== null) parts.push(`snapshot ${run.snapshotLabel}`);
    if (run.season !== null) parts.push(`season ${run.season}`);
    if (run.completedAt !== null) parts.push(`completed ${run.completedAt}`);
    batch = `${parts.join(', ')}. ${run.recordsRead} records read, ${run.recordsRejected} rejected.`;
  }

  return { key, label, service, serviceMuted, batch, batchMuted };
}

/** The AFL API units, in the order the page shows them. */
export const AFL_API_UNIT_ROWS: readonly { key: 'afl_api' | 'afl_api_brownlow'; label: string }[] = [
  { key: 'afl_api', label: 'AFL API match and player statistics settle' },
  { key: 'afl_api_brownlow', label: 'AFL API Brownlow votes settle' },
];

/* ------------------------------------------------------------------ *
 * Links, gated by the capability that already protects each destination
 * ------------------------------------------------------------------ */

export type OperationsLink = { href: string; label: string; description: string; capability: Capability };

const INSPECTION_LINKS: readonly OperationsLink[] = [
  { href: '/admin/audit', label: 'Audit trail', description: 'Who did what, and the before and after of every manual data edit. Read-only.', capability: 'operations.audit.read' },
  { href: '/admin/db-health', label: 'Database health', description: 'Connection and table health of the application database. Read-only.', capability: 'operations.dbHealth' },
  { href: '/admin/app-health', label: 'Application health', description: 'The running application: runtime, build and dependencies. Read-only.', capability: 'operations.appHealth' },
  { href: '/admin/query-builder', label: 'Data QA search', description: 'Typed, allowlisted queries over the statistical record for quality checks. Read-only.', capability: 'operations.queryBuilder' },
  { href: '/admin/player-links', label: 'Unresolved identities (player links)', description: 'Provider and source identities that are not yet linked to a stable player id.', capability: 'data.playerLinks' },
  { href: '/admin/brownlow', label: 'Brownlow administration', description: 'Match-by-match Brownlow votes: drafts, finalise and publish.', capability: 'data.brownlow.read' },
  { href: '/admin/current-season', label: 'Current season', description: 'AFL API ingestion controls and settle unit status for the current season.', capability: 'acquisition.currentSeason' },
  { href: '/admin/operations/afl-api-refusals', label: 'AFL API settle refusals', description: 'Open refused canonical applications and open findings of the AFL API settles. Read-only.', capability: 'operations.centre.read' },
];

const CURATED_LINKS: readonly OperationsLink[] = [
  { href: '/admin/operations/awards', label: 'Award proposals', description: 'The curated proposal queue: create from a local file, validate, approve or reject. Every decision is audited.', capability: 'data.awards.read' },
  { href: '/admin/operations/coleman', label: 'Coleman Medal derivation', description: 'Derive a sealed season from the database, compare it with the stored winners and publish it as an audited record.', capability: 'data.awards.read' },
  { href: '/admin/operations/brownlow', label: 'Brownlow reconciliation', description: 'Compare staged AFL API Brownlow votes with the stored totals. Read-only.', capability: 'data.brownlow.read' },
  { href: '/admin/awards', label: 'Awards & honours editor', description: 'Correct, void, reinstate or replace a published award record, with its history.', capability: 'data.awards.read' },
];

const visible = (links: readonly OperationsLink[], viewer: CapabilityViewer): OperationsLink[] => (
  links.filter((link) => hasCapability(viewer, link.capability))
);

/** The inspection shortcuts this viewer holds the capability for (and no others). */
export const inspectionLinksFor = (viewer: CapabilityViewer): OperationsLink[] => visible(INSPECTION_LINKS, viewer);

/** The curated-award and derived-result destinations this viewer holds the capability for. */
export const curatedLinksFor = (viewer: CapabilityViewer): OperationsLink[] => visible(CURATED_LINKS, viewer);

/* ------------------------------------------------------------------ *
 * Award proposals
 * ------------------------------------------------------------------ */

export const PROPOSAL_STATUS_LABELS: Readonly<Record<ProposalStatus, string>> = {
  proposed: 'Proposed',
  validated: 'Validated',
  validation_failed: 'Validation failed',
  approved: 'Approved',
  rejected: 'Rejected',
  superseded: 'Superseded',
};

const PENDING: readonly ProposalStatus[] = ['proposed', 'validated', 'validation_failed'];
export const isPendingStatus = (status: ProposalStatus): boolean => PENDING.includes(status);

export type QueueFilter = 'all' | ProposalStatus;

/** `?status=` -> a filter; anything unknown (or repeated) is the default. */
export function parseQueueFilter(value: string | string[] | undefined): QueueFilter {
  const text = typeof value === 'string' ? value : undefined;
  return (PROPOSAL_STATUSES as readonly string[]).includes(text ?? '') ? (text as ProposalStatus) : 'all';
}

export type PendingProposals = { count: number; atLeast: boolean };

/** The largest queue the overview reads to count undecided proposals. */
export const PENDING_COUNT_LIMIT = 500;

export function summarisePending(proposals: readonly Pick<ProposalRecord, 'status'>[]): PendingProposals {
  return {
    count: proposals.filter((proposal) => isPendingStatus(proposal.status)).length,
    atLeast: proposals.length >= PENDING_COUNT_LIMIT,
  };
}

/** `/admin/operations/awards/<id>` */
export const proposalHref = (id: number): string => `/admin/operations/awards/${id}`;

/** A strict positive integer id from a route segment, else null. */
export function parseRouteId(value: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/* ------------------------------------------------------------------ *
 * AFL API settle refusals (V2-GAP-025)
 * ------------------------------------------------------------------ */

export const AFL_API_FINDINGS_HREF = '/admin/operations/afl-api-refusals';

export const AFL_API_FINDING_SECTION_LABELS: Readonly<Record<AflApiFindingSection, string>> = {
  refusals: 'Refused canonical applications',
  findings: 'Open settle findings',
};

export type AflApiFindingsQuery = { section: AflApiFindingSection; before: string | null; cursorError: string | null };

/** `?section=findings&before=123`. An unknown section is the default; a bad cursor is reported, never guessed. */
export function parseAflApiFindingsQuery(params: Record<string, string | string[] | undefined>): AflApiFindingsQuery {
  const section: AflApiFindingSection = params.section === 'findings' ? 'findings' : 'refusals';
  const rawBefore = typeof params.before === 'string' ? params.before : '';
  if (rawBefore === '') return { section, before: null, cursorError: null };
  return /^[1-9]\d{0,18}$/.test(rawBefore) && BigInt(rawBefore) <= 9223372036854775807n
    ? { section, before: rawBefore, cursorError: null }
    : { section, before: null, cursorError: 'The page cursor was not a valid id, so the newest page is shown.' };
}

export function aflApiFindingsHref(section: AflApiFindingSection, before: string | null = null): string {
  const query = new URLSearchParams({ section });
  if (before !== null) query.set('before', before);
  return `${AFL_API_FINDINGS_HREF}?${query.toString()}`;
}

/* ------------------------------------------------------------------ *
 * Brownlow query
 * ------------------------------------------------------------------ */

export type BrownlowQuery = { season: number | null; rule: BrownlowEligibilityRule; seasonError: string | null };

/** `?season=2024&rule=unrecorded`. A bad season is reported, never guessed. */
export function parseBrownlowQuery(params: Record<string, string | string[] | undefined>): BrownlowQuery {
  const rawSeason = typeof params.season === 'string' ? params.season.trim() : '';
  const rawRule = typeof params.rule === 'string' ? params.rule : '';
  const rule = (BROWNLOW_ELIGIBILITY_RULES as readonly string[]).includes(rawRule)
    ? (rawRule as BrownlowEligibilityRule)
    : 'unrecorded';
  if (rawSeason === '') return { season: null, rule, seasonError: null };
  const season = parseSeason(rawSeason);
  return season === undefined
    ? { season: null, rule, seasonError: 'The season must be a whole year from 1897 to 2100.' }
    : { season, rule, seasonError: null };
}
