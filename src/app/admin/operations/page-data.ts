import 'server-only';

import type { ProposalHistory, ProposalRecord } from '@afldb/admin';
import type { BrownlowReconciliationReport } from '@afldb/derived';
import type { BrownlowStagingEvidence } from '@/db/queries/brownlow-reconciliation-inputs';
import {
  COVERAGE_REGISTRY,
  isSealedSeason,
  sealedSeasonsFrom,
  type CoverageEntry,
  type SeasonRegistry,
} from '@afldb/domain';

import type {
  BrownlowDeterminationView,
  ColemanPublicationView,
  OperationResult,
} from '@/lib/admin/operations-centre';
import type { AdminUser } from '@/lib/auth/session';

import {
  AFL_API_UNIT_ROWS,
  PENDING_COUNT_LIMIT,
  curatedLinksFor,
  inspectionLinksFor,
  loadedFail,
  loadedOk,
  sealedSeasonsView,
  summarisePending,
  summariseCoverage,
  unitRowView,
  type BrownlowQuery,
  type CoverageHealth,
  type Loaded,
  type OperationsLink,
  type PendingProposals,
  type QueueFilter,
  type SealedSeasonsView,
  type UnitRowView,
  type UnitStatusLike,
} from './views';

/**
 * The reads behind the operations-centre pages (AFLDB V2 Stage 5, plan D9).
 *
 * EVERY read is wrapped: one failing read becomes an inline notice for its own section and never
 * takes the page, or any other section, down. The pages call their capability guard FIRST and these
 * loaders after it; each loader is itself only a reader (the mutations are the Server Actions under
 * `awards/` and `coleman/`).
 *
 * The slow or environment-bound dependencies (the settle status, the season registry, the
 * operations-centre callers) are reached through `deps`, whose defaults import them LAZILY. That
 * keeps this module importable without a database and lets `tests/v2-admin-operations-ui.test.ts`
 * prove the isolation with fakes.
 *
 * Failure text is deliberately generic: a thrown error's message is logged on the server and never
 * rendered (it can carry a filesystem path or SQL detail). A typed refusal from an operations-centre
 * caller already carries words written for people and is passed through with its code.
 */

type OperationsApi = typeof import('@/lib/admin/operations-centre');

type UnitTable = Record<'afl_api' | 'afl_api_brownlow' | 'afltables', UnitStatusLike>;

export type PageDeps = {
  coverageRegistry: () => readonly CoverageEntry[];
  loadSeasonRegistry: () => Promise<SeasonRegistry>;
  readUnitTable: () => Promise<UnitTable>;
  readAflTablesRun: () => Promise<UnitStatusLike>;
  operations: () => Promise<Pick<
    OperationsApi,
    | 'listCuratedQueue'
    | 'readCuratedHistory'
    | 'listColemanPublicationsForAdmin'
    | 'reconcileBrownlowSeasonForAdmin'
    | 'determineBrownlowSeasonForAdmin'
  >>;
};

const defaultDeps: PageDeps = {
  coverageRegistry: () => COVERAGE_REGISTRY,
  loadSeasonRegistry: async () => (await import('@/lib/seasons/sealed-seasons')).loadSeasonRegistry(),
  readUnitTable: async () => (await import('@/lib/acquisition/settle-status')).readSettleUnitTableStatus(),
  readAflTablesRun: async () => (await import('@/lib/acquisition/settle-status')).readSettleRunStatus(),
  operations: () => import('@/lib/admin/operations-centre'),
};

const resolve = (deps?: Partial<PageDeps>): PageDeps => ({ ...defaultDeps, ...deps });

/**
 * Launch F: the AFL Tables settle is retired in V2, so the trigger library's "install the polkit
 * rule" sentence is the wrong advice here; an unconfigured trigger (`configured: false` from
 * readSettleRunStatus) is the retired state.
 */
export const AFL_TABLES_UNIT_NOT_READ =
  'Not read here: the on-demand trigger is retired. On the host, '
  + 'tools/v2/cutover-preflight.ts legacy-writers reports whether the timer can still run.';

export function retiredAflTablesStatus(status: UnitStatusLike & { configured?: boolean }): UnitStatusLike {
  return status.configured === false && status.unit === null
    ? { ...status, unitError: AFL_TABLES_UNIT_NOT_READ }
    : status;
}

export const COVERAGE_UNAVAILABLE = 'The coverage registry could not be summarised.';
export const SEASON_REGISTRY_UNAVAILABLE =
  'The season registry (data/reference/seasons.json) could not be read or is not valid. '
  + 'The seal fails closed: approvals and publications into sealed seasons are refused while this is so.';
export const RUN_STATUS_UNAVAILABLE = 'The run status could not be read (see the server log).';
export const READ_UNAVAILABLE = 'This read failed unexpectedly (see the server log). Nothing was changed.';

/** Run one read; a throw is logged and becomes a generic failure. */
async function guarded<T>(label: string, failure: string, work: () => Promise<T> | T): Promise<Loaded<T>> {
  try {
    return loadedOk(await work());
  } catch (error) {
    console.error(`Operations centre: ${label} failed`, error);
    return loadedFail(failure);
  }
}

type Api = Awaited<ReturnType<PageDeps['operations']>>;

/** Run a read that goes through the operations-centre callers; a throw is logged and generic. */
async function viaOperations<T>(deps: PageDeps, label: string, work: (api: Api) => Promise<Loaded<T>>): Promise<Loaded<T>> {
  try {
    return await work(await deps.operations());
  } catch (error) {
    console.error(`Operations centre: ${label} failed`, error);
    return loadedFail(READ_UNAVAILABLE);
  }
}

/** A caller's result as a `Loaded`: a typed refusal keeps its own words and code. */
function fromResult<T extends object, U>(result: OperationResult<T>, pick: (value: T) => U): Loaded<U> {
  return result.ok ? loadedOk(pick(result)) : loadedFail(result.error, result.code);
}

/* ------------------------------------------------------------------ *
 * /admin/operations
 * ------------------------------------------------------------------ */

export type OperationsOverview = {
  coverage: Loaded<CoverageHealth>;
  seasons: Loaded<SealedSeasonsView>;
  aflApiRuns: Loaded<UnitRowView[]>;
  aflTablesRun: Loaded<UnitRowView>;
  curatedLinks: OperationsLink[];
  /** Null when the viewer does not hold `data.awards.read`: the count is then not read at all. */
  pending: Loaded<PendingProposals> | null;
  inspectionLinks: OperationsLink[];
};

export async function loadOperationsOverview(
  admin: AdminUser,
  overrides?: Partial<PageDeps>,
): Promise<OperationsOverview> {
  const deps = resolve(overrides);
  const viewer = { role: admin.role, canManageAdmins: admin.canManageAdmins };
  const curatedLinks = curatedLinksFor(viewer);
  const canReadAwards = curatedLinks.some((link) => link.capability === 'data.awards.read');

  const [coverage, seasons, unitTable, aflTables, pending] = await Promise.all([
    guarded('coverage summary', COVERAGE_UNAVAILABLE, () => summariseCoverage(deps.coverageRegistry())),
    guarded('season registry', SEASON_REGISTRY_UNAVAILABLE, async () => {
      const registry = await deps.loadSeasonRegistry();
      return sealedSeasonsView(registry, sealedSeasonsFrom(registry));
    }),
    guarded('AFL API run status', RUN_STATUS_UNAVAILABLE, async () => {
      const table = await deps.readUnitTable();
      return AFL_API_UNIT_ROWS.map((row) => unitRowView(row.key, row.label, table[row.key]));
    }),
    guarded('AFL Tables run status', RUN_STATUS_UNAVAILABLE, async () => (
      unitRowView('afltables', 'AFL Tables nightly settle (host timer)', retiredAflTablesStatus(await deps.readAflTablesRun()))
    )),
    canReadAwards
      ? guarded('pending proposal count', READ_UNAVAILABLE, async () => {
        const api = await deps.operations();
        const result = await api.listCuratedQueue(admin, { limit: PENDING_COUNT_LIMIT });
        if (!result.ok) throw new Error(`the proposal queue was refused: ${result.code}`);
        return summarisePending(result.proposals);
      })
      : Promise.resolve(null),
  ]);

  return {
    coverage,
    seasons,
    aflApiRuns: unitTable,
    aflTablesRun: aflTables,
    curatedLinks,
    pending,
    inspectionLinks: inspectionLinksFor(viewer),
  };
}

/* ------------------------------------------------------------------ *
 * /admin/operations/awards
 * ------------------------------------------------------------------ */

/** How many proposals the queue page asks for; it says so when the list is full. */
export const QUEUE_PAGE_LIMIT = 200;

export async function loadAwardsQueue(
  admin: AdminUser,
  filter: QueueFilter,
  overrides?: Partial<PageDeps>,
): Promise<Loaded<ProposalRecord[]>> {
  const deps = resolve(overrides);
  return viaOperations(deps, 'proposal queue', async (api) => fromResult(
    await api.listCuratedQueue(admin, {
      ...(filter === 'all' ? {} : { status: filter }),
      includeSuperseded: filter === 'superseded',
      limit: QUEUE_PAGE_LIMIT,
    }),
    (value) => value.proposals,
  ));
}

/* ------------------------------------------------------------------ *
 * /admin/operations/awards/[id]
 * ------------------------------------------------------------------ */

export type ProposalPageData = {
  history: ProposalHistory;
  /** The revision whose id the URL named. */
  current: ProposalRecord;
  /** The newest revision of the same proposal (differs from `current` when it was superseded). */
  latest: ProposalRecord;
  /** True/false when the season registry could be read; null when it could not (it fails closed). */
  sealedSeason: boolean | null;
};

export async function loadProposalPage(
  admin: AdminUser,
  proposalId: number,
  overrides?: Partial<PageDeps>,
): Promise<Loaded<ProposalPageData>> {
  const deps = resolve(overrides);
  const read = await viaOperations(deps, 'proposal history', async (api) => fromResult(
    await api.readCuratedHistory(admin, { proposalId }),
    (value) => value.history,
  ));
  if (!read.ok) return loadedFail(read.error, read.code);

  const history = read.value;
  const current = history.revisions.find((revision) => revision.id === proposalId);
  const latest = history.revisions.at(-1);
  if (current === undefined || latest === undefined) {
    return loadedFail(`Proposal ${proposalId} could not be found in its own history.`, 'not_found');
  }

  let sealedSeason: boolean | null = null;
  try {
    sealedSeason = isSealedSeason(sealedSeasonsFrom(await deps.loadSeasonRegistry()), latest.season);
  } catch (error) {
    console.error('Operations centre: season registry failed', error);
  }
  return loadedOk({ history, current, latest, sealedSeason });
}

/* ------------------------------------------------------------------ *
 * /admin/operations/coleman
 * ------------------------------------------------------------------ */

export type ColemanPageData = {
  publications: Loaded<ColemanPublicationView[]>;
  sealed: Loaded<SealedSeasonsView>;
};

export async function loadColemanPage(
  admin: AdminUser,
  overrides?: Partial<PageDeps>,
): Promise<ColemanPageData> {
  const deps = resolve(overrides);
  const [publications, sealed] = await Promise.all([
    viaOperations(deps, 'Coleman publications', async (api) => fromResult(
      await api.listColemanPublicationsForAdmin(admin),
      (value) => value.publications,
    )),
    guarded('season registry', SEASON_REGISTRY_UNAVAILABLE, async () => {
      const registry = await deps.loadSeasonRegistry();
      return sealedSeasonsView(registry, sealedSeasonsFrom(registry));
    }),
  ]);
  return { publications, sealed };
}

/* ------------------------------------------------------------------ *
 * /admin/operations/brownlow
 * ------------------------------------------------------------------ */

/** The reconciliation report with what the staged leaderboard and the provider-team mapping contributed. */
export type BrownlowReportEvidence = {
  report: BrownlowReconciliationReport;
  /** `null` when the operations service supplied none. */
  staging: BrownlowStagingEvidence | null;
};

/** The reconciliation of the chosen season, or null while no season is chosen. */
export async function loadBrownlowReport(
  admin: AdminUser,
  query: BrownlowQuery,
  overrides?: Partial<PageDeps>,
): Promise<Loaded<BrownlowReportEvidence> | null> {
  if (query.season === null) return null;
  const deps = resolve(overrides);
  const season = query.season;
  return viaOperations(deps, 'Brownlow reconciliation', async (api) => fromResult(
    await api.reconcileBrownlowSeasonForAdmin(admin, { season, eligibilityRule: query.rule }),
    (value) => ({ report: value.report, staging: value.staging ?? null }),
  ));
}

/**
 * The eligibility-aware medal determination of the chosen season (Launch F F-D; ADR 0014), or null
 * while no season is chosen. READ-ONLY (`data.brownlow.read`). The raw leaderboard, the status and
 * the evidence behind it come back as one JSON-safe view.
 */
export async function loadBrownlowDetermination(
  admin: AdminUser,
  query: BrownlowQuery,
  overrides?: Partial<PageDeps>,
): Promise<Loaded<BrownlowDeterminationView> | null> {
  if (query.season === null) return null;
  const deps = resolve(overrides);
  const season = query.season;
  return viaOperations(deps, 'Brownlow determination', async (api) => fromResult(
    await api.determineBrownlowSeasonForAdmin(admin, { season }),
    (value) => value.view,
  ));
}
