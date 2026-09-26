import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * AFLDB-ISSUE-127 — DB-free Server Action and boundary tests for the Super
 * Admin on-demand AFL Tables refresh.
 *
 * A new file rather than an extension of tests/current-season-import.test.ts:
 * the module-level vi.mock() calls this suite needs apply to a whole file, and
 * pushing them into that 4,000-line suite would rewrite its boundaries. It
 * follows tests/admin-nl-search-actions.test.ts, which is this repository's
 * established home for DB-free Server Action contract tests.
 *
 * THE HOST BOUNDARY IS MOCKED. Nothing here launches systemd, R, Python or
 * fitzRoy. What is proven is the contract around that boundary: who may
 * invoke it, that it takes no arguments, that a concurrent run is refused,
 * that the status mapping is safe, and that an audit row is written.
 */

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  audit: vi.fn(),
  startSettleRun: vi.fn(),
  readSettleRunStatus: vi.fn(),
  getLatestSettleRun: vi.fn(),
  authSql: vi.fn(),
}));

vi.mock('@/db/authClient', () => ({
  authSql: mocks.authSql,
}));

vi.mock('@/lib/auth/session', () => ({
  // acquisition.currentSeason (super-admin-only) since AFLDB-ISSUE-158.
  requireCapability: mocks.requireCapability,
  audit: mocks.audit,
}));

// Partial: the pure parsers below are the real ones, and only the one
// function that would spawn a child process is replaced. Nothing in this file
// ever reaches execFile.
vi.mock('@/lib/acquisition/settle-trigger', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/acquisition/settle-trigger')>(),
  startSettleRun: mocks.startSettleRun,
}));

vi.mock('@/lib/acquisition/settle-status', () => ({
  readSettleRunStatus: mocks.readSettleRunStatus,
}));

// The fallback half of the page is not under test here and must not open a
// database or reach Squiggle/Kali when the module is imported.
vi.mock('@/lib/external-afl/current-season-import', () => ({
  getCurrentSeasonReport: vi.fn(),
  parseCurrentSeasonSources: vi.fn(),
  runCurrentSeasonRefresh: vi.fn(),
  validateCurrentSeasonYear: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// The pure projection helpers live beside the query that uses them, so
// importing them pulls in the app pool. This suite touches no database: the
// pool is stubbed and the one function that would use it is replaced.
vi.mock('@/db/client', () => ({ sql: vi.fn() }));
vi.mock('@/db/queries/settle-runs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/db/queries/settle-runs')>(),
  getLatestSettleRun: mocks.getLatestSettleRun,
}));

import {
  readAflApiIngestionAdminView,
  refreshSettleRunStatusAction,
  setAflApiCurrentSeasonIngestionAction,
  startSettleRunAction,
} from '@/app/admin/current-season/actions';
import {
  AFL_API_SETTLE_UNIT_ROWS,
  AflApiSettleUnitsPanel,
} from '@/app/admin/current-season/AflApiSettleUnitsPanel';
import { SETTING_KEYS } from '@/lib/site-settings';
import {
  extractSettleCounters,
  parseSettleBatchNote,
  SETTLE_BATCH_TOOL,
  SETTLE_BATCH_TOOLS,
} from '@/db/queries/settle-runs';
import {
  parseUnitShow,
  SETTLE_UNIT,
  SETTLE_UNITS,
  summariseFailure,
  unitPhaseOf,
} from '@/lib/acquisition/settle-trigger';

const SUPER_ADMIN = { id: 7, email: 'super@example.test' };

const IDLE_UNIT = {
  phase: 'idle' as const,
  activeState: 'inactive',
  subState: 'dead',
  result: 'success',
  exitStatus: 0,
  activeEnterTimestamp: 'Wed 2026-09-03 04:30:12 AEST',
  inactiveEnterTimestamp: 'Wed 2026-09-03 05:14:02 AEST',
};

const RUN = {
  batchId: '731',
  snapshotLabel: 'settle-2026-09-02-1958',
  season: 2026,
  status: 'completed',
  startedAt: '2026-09-02 19:58:00+10',
  completedAt: '2026-09-02 20:59:41+10',
  recordsRead: 9729,
  recordsRejected: 0,
  counters: {
    canonicalRowsInserted: 10582,
    canonicalRowsUpdated: 0,
    canonicalApplicationsLogged: 9133,
    canonicalApplyRefusals: 0,
    canonicalApplyFailures: 0,
    unresolvedIdentity: 0,
    advisoryDisagreement: 0,
    derivedRecomputeRuns: 1,
    derivedRecomputePlayers: 812,
  },
};

const STATUS = {
  configured: true,
  unitError: null,
  unit: IDLE_UNIT,
  latestRun: RUN,
  latestRunError: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCapability.mockResolvedValue(SUPER_ADMIN);
  mocks.audit.mockResolvedValue(undefined);
  mocks.readSettleRunStatus.mockResolvedValue(STATUS);
  mocks.getLatestSettleRun.mockResolvedValue(RUN);
  mocks.startSettleRun.mockResolvedValue({ outcome: 'started' });
});

/* ------------------------------------------------------------------ *
 * Authorization
 * ------------------------------------------------------------------ */

describe('authorization', () => {
  it('lets a super admin start the approved pipeline', async () => {
    const state = await startSettleRunAction();

    expect(mocks.requireCapability).toHaveBeenCalledOnce();
    expect(mocks.requireCapability).toHaveBeenCalledWith('acquisition.currentSeason');
    expect(mocks.startSettleRun).toHaveBeenCalledOnce();
    expect(state.outcome).toBe('started');
    expect(state.error).toBeUndefined();
  });

  it('stops an ordinary admin at the guard, before the host boundary', async () => {
    // requireCapability('acquisition.currentSeason') redirects a plain
    // admin, which in Next is a throw.
    mocks.requireCapability.mockRejectedValue(new Error('NEXT_REDIRECT /admin'));

    await expect(startSettleRunAction()).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.startSettleRun).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('stops an unauthenticated visitor at the guard, before the host boundary', async () => {
    mocks.requireCapability.mockRejectedValue(new Error('NEXT_REDIRECT /admin/login'));

    await expect(startSettleRunAction()).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.startSettleRun).not.toHaveBeenCalled();
  });

  it('guards the status refresh with the same super-admin check', async () => {
    mocks.requireCapability.mockRejectedValue(new Error('NEXT_REDIRECT /admin'));

    await expect(refreshSettleRunStatusAction()).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.readSettleRunStatus).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * No arbitrary arguments
 * ------------------------------------------------------------------ */

describe('no arbitrary arguments', () => {
  /**
   * The strongest available proof, and the reason the panel calls these
   * directly instead of binding them to a form: neither action declares a
   * parameter, so there is no season, label, path, source, force or bypass
   * value a caller could supply, and no `FormData` for a crafted field to
   * ride in on. TypeScript rejects an argument at compile time; this asserts
   * the same fact at runtime, where a `.bind()`-shaped call would show up.
   */
  it('declares no parameters on either action', () => {
    expect(startSettleRunAction.length).toBe(0);
    expect(refreshSettleRunStatusAction.length).toBe(0);
  });

  it('calls the host boundary with no arguments at all', async () => {
    const state = await startSettleRunAction();

    expect(state.outcome).toBe('started');
    expect(mocks.startSettleRun).toHaveBeenCalledExactlyOnceWith();
  });

  it('still starts when the pre-start batch read fails', async () => {
    mocks.getLatestSettleRun.mockRejectedValue(new Error('permission denied'));

    const state = await startSettleRunAction();

    expect(state.outcome).toBe('started');
    expect(state.batchIdAtStart).toBeNull();
    // The failure is not leaked into the audit detail or the operator message.
    expect(JSON.stringify(mocks.audit.mock.calls[0][1])).not.toContain('permission denied');
  });

  it('puts only the three fixed keys in the audit detail', async () => {
    await startSettleRunAction();

    const [, detail] = mocks.audit.mock.calls[0];
    expect(Object.keys(detail).sort()).toEqual(['batchIdAtStart', 'outcome', 'unit']);
  });
});

/* ------------------------------------------------------------------ *
 * Concurrency
 * ------------------------------------------------------------------ */

describe('concurrency', () => {
  it('refuses a second invocation while a run is active, rather than starting one', async () => {
    mocks.startSettleRun.mockResolvedValue({
      outcome: 'already-running',
      unit: { ...IDLE_UNIT, phase: 'running', activeState: 'activating', subState: 'start' },
    });

    const state = await startSettleRunAction();

    expect(state.outcome).toBe('already-running');
    expect(state.error).toBeUndefined();
    expect(state.message).toMatch(/already in progress/i);
    // The refusal is still an auditable attempt.
    expect(mocks.audit).toHaveBeenCalledOnce();
  });

  it('treats every non-idle systemd state as running, so no second start is offered', () => {
    expect(unitPhaseOf('activating')).toBe('running');
    expect(unitPhaseOf('active')).toBe('running');
    expect(unitPhaseOf('deactivating')).toBe('running');
    expect(unitPhaseOf('reloading')).toBe('running');
    expect(unitPhaseOf('inactive')).toBe('idle');
    expect(unitPhaseOf('failed')).toBe('failed');
    expect(unitPhaseOf('')).toBe('unknown');
  });
});

/* ------------------------------------------------------------------ *
 * Outcome mapping
 * ------------------------------------------------------------------ */

describe('outcome mapping', () => {
  it('maps an unconfigured host to unavailable, not to a failure', async () => {
    mocks.startSettleRun.mockResolvedValue({
      outcome: 'unavailable', reason: 'On-demand refresh is not enabled on this host.',
    });

    const state = await startSettleRunAction();

    expect(state.outcome).toBe('unavailable');
    expect(state.error).toBe('On-demand refresh is not enabled on this host.');
    expect(state.message).toBeUndefined();
  });

  it('maps a refused start to an error carrying only the bounded reason', async () => {
    mocks.startSettleRun.mockResolvedValue({
      outcome: 'error', reason: 'Failed to start afldb-settle-afltables.service: Access denied',
    });

    const state = await startSettleRunAction();

    expect(state.outcome).toBe('error');
    expect(state.error).toMatch(/Access denied/);
  });

  it('returns the status on a refresh and asserts no correlation of its own', async () => {
    const state = await refreshSettleRunStatusAction();

    expect(state.outcome).toBe('status');
    expect(state.status).toEqual(STATUS);
    // The correlation belongs to the start the panel performed; a refresh
    // must not be able to claim one.
    expect(state.batchIdAtStart).toBeUndefined();
    // A read is not an action: it writes no audit row.
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * Audit
 * ------------------------------------------------------------------ */

describe('audit', () => {
  it('records actor, action, unit, outcome and the safe run identifier', async () => {
    await startSettleRunAction();

    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(
      'current_season.settle_triggered',
      {
        unit: 'afldb-settle-afltables.service',
        outcome: 'started',
        batchIdAtStart: '731',
      },
      { userId: SUPER_ADMIN.id, label: SUPER_ADMIN.email },
    );
  });

  it('audits a failed start too, so a refused attempt still leaves a trail', async () => {
    mocks.startSettleRun.mockResolvedValue({ outcome: 'error', reason: 'Access denied' });

    await startSettleRunAction();

    const [action, detail] = mocks.audit.mock.calls[0];
    expect(action).toBe('current_season.settle_triggered');
    expect(detail.outcome).toBe('error');
  });

  it('never puts a credential or an environment value in the audit detail', async () => {
    await startSettleRunAction();

    const serialised = JSON.stringify(mocks.audit.mock.calls[0][1]);
    expect(serialised).not.toMatch(/postgres:\/\//);
    expect(serialised).not.toMatch(/DATABASE_URL/);
  });
});

/* ------------------------------------------------------------------ *
 * The systemd parse — pure, no child process
 * ------------------------------------------------------------------ */

describe('systemctl show parsing', () => {
  it('reads exactly the requested properties out of the Key=Value output', () => {
    const state = parseUnitShow([
      'ActiveState=activating',
      'SubState=start',
      'Result=success',
      'ExecMainStatus=0',
      'ActiveEnterTimestamp=',
      'InactiveEnterTimestamp=Wed 2026-09-03 05:14:02 AEST',
      '',
    ].join('\n'));

    expect(state.phase).toBe('running');
    expect(state.activeState).toBe('activating');
    expect(state.subState).toBe('start');
    expect(state.exitStatus).toBe(0);
    expect(state.inactiveEnterTimestamp).toBe('Wed 2026-09-03 05:14:02 AEST');
  });

  it('reports a never-run unit without inventing an exit status', () => {
    const state = parseUnitShow('ActiveState=inactive\nSubState=dead\nExecMainStatus=\n');

    expect(state.phase).toBe('idle');
    expect(state.exitStatus).toBeNull();
  });

  it('ignores properties it did not ask for', () => {
    const state = parseUnitShow('ActiveState=failed\nEnvironment=SECRET=hunter2\n');

    expect(state.phase).toBe('failed');
    expect(JSON.stringify(state)).not.toContain('hunter2');
  });
});

describe('failure summarising', () => {
  it('collapses child output to one bounded line', () => {
    const text = summariseFailure('Failed to start unit:\n  Access denied\n', '', 'fallback');
    expect(text).toBe('Failed to start unit: Access denied');
  });

  it('truncates rather than passing through an unbounded blob', () => {
    const text = summariseFailure('x'.repeat(5000), '', 'fallback');
    expect(text.length).toBeLessThanOrEqual(301);
    expect(text.endsWith('…')).toBe(true);
  });

  it('falls back to the caller sentence when the child said nothing', () => {
    expect(summariseFailure('  ', '', 'fallback')).toBe('fallback');
  });
});

/* ------------------------------------------------------------------ *
 * The structured result — pure projection, no database
 * ------------------------------------------------------------------ */

describe('settle batch projection', () => {
  it('recovers the snapshot label and season from the batch note', () => {
    expect(parseSettleBatchNote(
      'AFLDB-ISSUE-099 settle; snapshot=settle-2026-09-02-1958; season=2026; mode=apply',
    )).toEqual({ snapshotLabel: 'settle-2026-09-02-1958', season: 2026 });
  });

  it('reports an unparseable note as not recorded rather than guessing', () => {
    expect(parseSettleBatchNote(null)).toEqual({ snapshotLabel: null, season: null });
    expect(parseSettleBatchNote('something else')).toEqual({ snapshotLabel: null, season: null });
  });

  it('projects only the whitelisted counters and sums unresolved identity', () => {
    const counters = extractSettleCounters({
      snapshotMatches: 207,
      snapshotPlayerMatchRows: 9522,
      snapshotRejections: 0,
      snapshotUnkeyedRejections: 94,
      absenceSweepSkipped: 2,
      canonicalRowsInserted: 10582,
      canonicalRowsUpdated: 3,
      canonicalApplicationsLogged: 9133,
      canonicalApplyRefusals: 2,
      canonicalApplyFailures: 1,
      unresolvedIdentityPlayer: 4,
      unresolvedIdentityClub: 1,
      unresolvedIdentityVenue: 2,
      unresolvedIdentityMatch: 0,
      advisoryDisagreement: 5,
      derivedRecomputeRuns: 1,
      derivedRecomputePlayers: 812,
      // Not whitelisted, and must not survive into the admin surface.
      snapshotManifestPath: '/home/arm/projects/afldb/docs/rebuild-manifests/x.json',
    });

    expect(counters).toEqual({
      // AFLDB-ISSUE-128 added the snapshot coverage counters to the whitelist.
      // They were already in `validation_result`; only this projection was
      // missing, which is why 94 dropped source rows never reached an operator.
      snapshotMatches: 207,
      snapshotPlayerMatchRows: 9522,
      snapshotRejections: 0,
      snapshotUnkeyedRejections: 94,
      absenceSweepSkipped: 2,
      canonicalRowsInserted: 10582,
      canonicalRowsUpdated: 3,
      canonicalApplicationsLogged: 9133,
      canonicalApplyRefusals: 2,
      canonicalApplyFailures: 1,
      unresolvedIdentity: 7,
      advisoryDisagreement: 5,
      derivedRecomputeRuns: 1,
      derivedRecomputePlayers: 812,
    });
    expect(JSON.stringify(counters)).not.toContain('/home/arm');
  });

  it('distinguishes a run that recorded no counters from a run of zeroes', () => {
    expect(extractSettleCounters(null)).toBeNull();
    expect(extractSettleCounters(undefined)).toBeNull();
    expect(extractSettleCounters({})?.canonicalRowsInserted).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-228 S8 (§17) — the three-unit table, additive over the
 * ISSUE-127 single-unit contract above. DB-free: only the closed literal
 * maps are asserted, exactly as `deploy/afldb-settle-afl-api*.service`'s
 * `SyslogIdentifier=`/unit names and `settle-afl-api.ts:120` /
 * `afl-api-brownlow.ts:121`'s own `SETTLE_BATCH_TOOL` literals name them.
 * ------------------------------------------------------------------ */

describe('AFLDB-ISSUE-228 S8 — settle unit and batch-tool tables', () => {
  it('keeps the afltables key byte-identical to the pre-existing single unit', () => {
    expect(SETTLE_UNITS.afltables).toBe(SETTLE_UNIT);
    expect(SETTLE_BATCH_TOOLS.afltables).toBe(SETTLE_BATCH_TOOL);
  });

  it('names exactly the three units the S8 deploy files install', () => {
    expect(SETTLE_UNITS).toEqual({
      afltables: 'afldb-settle-afltables.service',
      afl_api: 'afldb-settle-afl-api.service',
      afl_api_brownlow: 'afldb-settle-afl-api-brownlow.service',
    });
  });

  it('names exactly the three import_batches.tool literals the settle CLIs stamp', () => {
    expect(SETTLE_BATCH_TOOLS).toEqual({
      afltables: 'settle-afltables.ts',
      afl_api: 'settle-afl-api.ts',
      afl_api_brownlow: 'settle-afl-api-brownlow.ts',
    });
  });
});

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-232 — the AFL API unit rows on the page
 * ------------------------------------------------------------------ */

describe('AFLDB-ISSUE-232 — AFL API settle units panel', () => {
  type PanelProps = Parameters<typeof AflApiSettleUnitsPanel>[0];
  // RUN above is the minimal shape the Server Action tests need, not a full
  // SettleRunRecord; the panel reads only the fields it carries.
  type Units = NonNullable<PanelProps['units']>;
  const UNREAD = {
    unit: null,
    unitError: 'On-demand refresh is not enabled on this host.',
    latestRun: null,
    latestRunError: null,
  };
  const UNITS = {
    afltables: { unit: IDLE_UNIT, unitError: null, latestRun: RUN, latestRunError: null },
    afl_api: {
      unit: { ...IDLE_UNIT, phase: 'failed' as const, activeState: 'failed', result: 'exit-code' },
      unitError: null,
      latestRun: { ...RUN, batchId: '2501', snapshotLabel: 'afl-api-2026-0926T0500Z', counters: null },
      latestRunError: null,
    },
    afl_api_brownlow: UNREAD,
  } as unknown as Units;

  const render = (props: PanelProps) => renderToStaticMarkup(createElement(AflApiSettleUnitsPanel, props));

  it('shows both AFL API units by their systemd names, and not the AFL Tables row', () => {
    const html = render({ units: UNITS, error: null });
    expect(html).toContain('afldb-settle-afl-api.service');
    expect(html).toContain('afldb-settle-afl-api-brownlow.service');
    expect(html).not.toContain('afldb-settle-afltables.service');
    expect(AFL_API_SETTLE_UNIT_ROWS.map((row) => row.key)).toEqual(['afl_api', 'afl_api_brownlow']);
  });

  it('reports the unit state and the latest batch as two separate facts', () => {
    const html = render({ units: UNITS, error: null });
    expect(html).toContain('Last run failed');
    expect(html).toContain('exit-code');
    expect(html).toContain('2501');
    expect(html).toContain('afl-api-2026-0926T0500Z');
    expect(html).toContain('the batch shown is the previous run');
  });

  it('passes an unreadable unit through as its own bounded reason and says no batch exists', () => {
    const html = render({ units: UNITS, error: null });
    expect(html).toContain('On-demand refresh is not enabled on this host.');
    expect(html).toContain('No batch recorded yet.');
  });

  it('shows a failed batch read as an alert rather than as an empty row', () => {
    const html = render({
      units: { ...UNITS, afl_api: { ...UNITS.afl_api, latestRun: null, latestRunError: 'permission denied' } },
      error: null,
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain('permission denied');
  });

  it('renders the page-level read failure instead of the table', () => {
    const html = render({ units: null, error: 'systemd unavailable' });
    expect(html).toContain('systemd unavailable');
    expect(html).not.toContain('<table');
  });

  it('is read-only: no client code, no action, no control', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/admin/current-season/AflApiSettleUnitsPanel.tsx'), 'utf8',
    );
    expect(source).not.toContain("'use client'");
    expect(source).not.toContain('./actions');
    expect(source).not.toMatch(/<button|<form|onClick/);
  });

  it('is read on the page inside its own try, so a failure cannot take the page down', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/app/admin/current-season/page.tsx'), 'utf8');
    expect(page).toMatch(/try \{\s*aflApiUnits = await readSettleUnitTableStatus\(\);/);
    expect(page).toContain('<AflApiSettleUnitsPanel units={aflApiUnits} error={aflApiUnitsError} />');
  });
});

/* ------------------------------------------------------------------ *
 * What ISSUE-127 must NOT have changed
 * ------------------------------------------------------------------ */

describe('unchanged contracts', () => {
  it('starts the one approved unit the nightly timer already starts', async () => {
    await startSettleRunAction();

    const [, detail] = mocks.audit.mock.calls[0];
    expect(detail.unit).toBe('afldb-settle-afltables.service');
  });

  it('the fallback action still refuses to insert canonical matches', async () => {
    // AFLDB-ISSUE-122 §11.2: Squiggle/Kali have no canonical writer, and
    // ISSUE-127 must not have reintroduced one. The Squiggle/Kali action
    // hardcodes insertMissingMatches = false with no input that can change it.
    const {
      runCurrentSeasonRefresh, validateCurrentSeasonYear, getCurrentSeasonReport,
      parseCurrentSeasonSources,
    } = await import('@/lib/external-afl/current-season-import');
    vi.mocked(validateCurrentSeasonYear).mockReturnValue(2026);
    vi.mocked(parseCurrentSeasonSources).mockReturnValue(['kali']);
    vi.mocked(getCurrentSeasonReport).mockResolvedValue({
      year: 2026, rows: [], incompleteSamples: [], unresolvedMatchSamples: [],
      unresolvedTeamSamples: [],
    } as never);
    vi.mocked(runCurrentSeasonRefresh).mockResolvedValue({
      applied: true, observationsStaged: 0, canonicalMatchesResolved: 0,
    } as never);

    const { runCurrentSeasonAdminAction } = await import('@/app/admin/current-season/actions');
    const form = new FormData();
    form.set('mode', 'manual');
    form.set('insertMissingMatches', 'on');
    form.set('force', 'on');
    await runCurrentSeasonAdminAction({}, form);

    expect(vi.mocked(runCurrentSeasonRefresh).mock.calls[0][0])
      .toMatchObject({ insertMissingMatches: false });
  });
});

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-128 — the admin surface must not present a dropped-rows
 * run as a clean one, and must name the real provider precedence.
 * ------------------------------------------------------------------ */

describe('AFLDB-ISSUE-128 — provider precedence and completeness on the admin surface', () => {
  const readSource = (relative: string) =>
    readFileSync(resolve(process.cwd(), relative), 'utf8');
  const page = readSource('src/app/admin/current-season/page.tsx');
  const controls = readSource('src/app/admin/current-season/CurrentSeasonControls.tsx');
  const panel = readSource('src/app/admin/current-season/SettleRunPanel.tsx');
  const actions = readSource('src/app/admin/current-season/actions.ts');
  const query = readSource('src/db/queries/settle-runs.ts');

  it('carries the completeness verdict beside the run, derived not stored', () => {
    // Derived on read, so a batch row written before ISSUE-128 existed still
    // gets today's reading rather than none at all.
    expect(query).toContain('assessSourceCompleteness(counters)');
    expect(query).toContain('sourceCompleteness: SourceCompletenessVerdict');
  });

  it('projects the snapshot coverage counters an operator needs to see', () => {
    for (const counter of [
      'snapshotMatches', 'snapshotPlayerMatchRows', 'snapshotRejections',
      'snapshotUnkeyedRejections', 'absenceSweepSkipped',
    ]) {
      expect(query).toContain(`${counter}: counterOf(raw, '${counter}')`);
      expect(panel).toContain(`counters.${counter}`);
    }
  });

  it('renders the verdict as a verdict, not as one more number in a table', () => {
    expect(panel).toContain('run.sourceCompleteness');
    expect(panel).toContain('Source INCOMPLETE');
    expect(panel).toContain("role=\"alert\"");
    expect(panel).toContain('Source completeness unknown');
  });

  it('names AFL Tables/fitzRoy as primary and Squiggle/Kali as deprecated fallback', () => {
    expect(page).toContain('AFL Tables, acquired via fitzRoy, is the primary');
    expect(page).toContain('only automatic');
    expect(page).toContain('no canonical-write authority');
    expect(page).toContain('Deprecated fallback diagnostics');
    // The exact wording the observed defect displayed.
    expect(page).not.toContain('Auto update uses Kali AFL Stats');
  });

  it('offers no automatic Squiggle/Kali path, by name or by shape', () => {
    expect(controls).not.toContain('Auto update from API');
    expect(controls).not.toContain('value="auto"');
    expect(controls).toContain('value="manual"');
    expect(actions).toContain("if (mode !== 'manual')");
    expect(actions).not.toContain("['kali'] as const");
  });

  it('does not offer AFL Tables in the fallback source list', () => {
    // Wiring fitzRoy into the Squiggle/Kali dispatcher would be a SECOND
    // canonical ingestion implementation inside Next.js. The fitzRoy control
    // is the settle panel, which starts the one approved chain.
    expect(controls).not.toMatch(/value="(afltables|fitzroy|afl_tables)"/);
    expect(page).toContain('AFL Tables itself is deliberately absent from the source list');
  });

  it('keeps the fallback providers non-writing', () => {
    // Unchanged by ISSUE-128, and asserted here so a wording change cannot
    // quietly travel with a behaviour change.
    expect(actions).toContain('const insertMissingMatches = false;');
    expect(actions).not.toMatch(/insertMissingMatches\s*[:=]\s*true/);
    expect(actions).not.toMatch(/insertMissingMatches\s*[:=]\s*formData/);
  });
});

/* ------------------------------------------------------------------ *
 * AFLDB-ISSUE-228 follow-up — AFL API ingestion switch persistence
 * ------------------------------------------------------------------ *
 * DEV acceptance defect: enabling the current-season switch showed
 * "enabled" immediately (the optimistic client update), but reverted to
 * "Disabled" on a hard refresh even though the row was written correctly.
 *
 * Root cause: `readAflApiIngestionAdminView()` compared the raw row value
 * with a bare `=== true`. jsonb arrives as raw TEXT on this project's
 * postgres.js client (`src/lib/site-settings.ts` `fromStore()`, and the
 * same documented hazard in `awards.ts`/`early-access.ts`/`site-content.ts`)
 * -- a stored `true` reads back as the STRING `'true'`, which `=== true`
 * can never match. `writeIngestionSwitch()` itself was always correct; only
 * this read-back was broken, and the fix is routing it through
 * `parseSiteSettings()` like every other admin settings read
 * (`getSiteSettingsForAdmin()`) instead of re-deriving its own comparison.
 *
 * These tests simulate that raw-text round trip explicitly, so a regression
 * back to a bare `=== true`/`=== 'true'` comparison fails here the same way
 * it failed on DEV, without needing a live database.
 */
describe('AFL API ingestion switch read-back (AFLDB-ISSUE-228 persistence defect)', () => {
  /**
   * Stands in for `site_settings`, storing each value as the raw jsonb TEXT
   * a real write produces (`JSON.stringify(enabled)`, e.g. the 4-character
   * string `"true"`) rather than a decoded JS boolean -- reproducing the
   * exact shape this project's postgres.js client hands back.
   */
  function mockSiteSettingsTable(initial: Record<string, string> = {}) {
    const rows = new Map<string, string>(Object.entries(initial));
    mocks.authSql.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join(' ');
      if (sql.includes('SELECT')) {
        const keys = values as string[];
        return Promise.resolve(
          keys.filter((key) => rows.has(key)).map((key) => ({ key, value: rows.get(key) })),
        );
      }
      if (sql.includes('INSERT')) {
        const [key, value] = values as [string, string, number];
        rows.set(key, value);
        return Promise.resolve([]);
      }
      throw new Error(`Unexpected authSql call in this test: ${sql}`);
    });
    return rows;
  }

  beforeEach(() => {
    mocks.authSql.mockReset();
  });

  it('reads a freshly-enabled switch back as enabled', async () => {
    mockSiteSettingsTable();

    const write = await setAflApiCurrentSeasonIngestionAction(true);
    expect(write.error).toBeUndefined();

    const view = await readAflApiIngestionAdminView();
    expect(view.currentSeasonEnabled).toBe(true);
  });

  it('reads an explicit disable back as disabled after having been enabled', async () => {
    mockSiteSettingsTable({ [SETTING_KEYS.aflApiCurrentSeasonEnabled]: 'true' });

    const write = await setAflApiCurrentSeasonIngestionAction(false);
    expect(write.error).toBeUndefined();

    const view = await readAflApiIngestionAdminView();
    expect(view.currentSeasonEnabled).toBe(false);
  });

  it('reads disabled when no row has ever been written (fail closed)', async () => {
    mockSiteSettingsTable();

    const view = await readAflApiIngestionAdminView();
    expect(view.currentSeasonEnabled).toBe(false);
    expect(view.brownlow.adminEnabled).toBe(false);
  });

  it('does not let an enabled current-season switch leak into the independent Brownlow admin flag', async () => {
    mockSiteSettingsTable({ [SETTING_KEYS.aflApiCurrentSeasonEnabled]: 'true' });

    const view = await readAflApiIngestionAdminView();
    expect(view.currentSeasonEnabled).toBe(true);
    expect(view.brownlow.adminEnabled).toBe(false);
  });
});
