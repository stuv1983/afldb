import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * AFLDB-ISSUE-127 — DB-free Server Action and boundary tests for the Super
 * Admin on-demand AFL Tables refresh.
 *
 * AFLDB V2 Stage 5 (V2-GAP-013) RETIRED the two controls this file used to
 * drive: the AFL Tables settle trigger and the Squiggle/Kali refresh. Their
 * server actions now refuse, so the action tests below prove the refusal and
 * that the old behaviour is never reached (every legacy library is a mock
 * here, asserted to be uncalled). The pure systemd parse, the batch
 * projection, the unit-table and AFL API panel tests are unchanged.
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
  runCurrentSeasonAdminAction,
  setAflApiCurrentSeasonIngestionAction,
  startSettleRunAction,
} from '@/app/admin/current-season/actions';
import {
  AFL_API_SETTLE_UNIT_ROWS,
  AflApiSettleUnitsPanel,
  UNIT_NOT_INSTALLED,
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
  loadState: 'loaded',
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
 * AFLDB V2 Stage 5 (V2-GAP-013, legacy-disposition L5/L6): the AFL Tables
 * settle trigger and the Squiggle/Kali refresh are RETIRED. Both server
 * actions keep their name and their guard (the first awaited statement) and
 * REFUSE; neither ever reaches the host boundary or the importer library.
 * ------------------------------------------------------------------ */

const errorOf = (state: unknown) => (state as { error?: string }).error;

/** What a stale `useActionState` client posts: (previous state, form data). The action declares neither. */
const staleRefresh = runCurrentSeasonAdminAction as unknown as (
  previous: object, form: FormData,
) => ReturnType<typeof runCurrentSeasonAdminAction>;

function manualRefreshForm(): FormData {
  const form = new FormData();
  form.set('mode', 'manual');
  form.set('source', 'kali');
  form.set('year', '2026');
  form.set('apply', 'on');
  form.set('insertMissingMatches', 'on');
  form.set('force', 'on');
  return form;
}

describe('authorization: the guard is unchanged and still comes first', () => {
  it('lets a super admin reach the typed refusal of the settle trigger, and nothing behind it', async () => {
    const state = await startSettleRunAction();

    expect(mocks.requireCapability).toHaveBeenCalledOnce();
    expect(mocks.requireCapability).toHaveBeenCalledWith('acquisition.currentSeason');
    expect(state).toMatchObject({
      refused: true, code: 'legacy_retired', surface: 'admin.afltables_settle_trigger',
    });
    expect(errorOf(state)).toMatch(/retired/i);
    expect(errorOf(state)).toMatch(/AFL API/);
    expect(mocks.startSettleRun).not.toHaveBeenCalled();
  });

  it('stops an ordinary admin at the guard, before the refusal and its audit row', async () => {
    // requireCapability('acquisition.currentSeason') redirects a plain
    // admin, which in Next is a throw.
    mocks.requireCapability.mockRejectedValue(new Error('NEXT_REDIRECT /admin'));

    await expect(startSettleRunAction()).rejects.toThrow('NEXT_REDIRECT');
    await expect(staleRefresh({}, manualRefreshForm())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.startSettleRun).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('stops an unauthenticated visitor at the guard, before the refusal and its audit row', async () => {
    mocks.requireCapability.mockRejectedValue(new Error('NEXT_REDIRECT /admin/login'));

    await expect(startSettleRunAction()).rejects.toThrow('NEXT_REDIRECT');
    await expect(staleRefresh({}, manualRefreshForm())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.startSettleRun).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('guards the status refresh with the same super-admin check', async () => {
    mocks.requireCapability.mockRejectedValue(new Error('NEXT_REDIRECT /admin'));

    await expect(refreshSettleRunStatusAction()).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.readSettleRunStatus).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * No arbitrary arguments, and nothing behind the refusal
 * ------------------------------------------------------------------ */

describe('no arbitrary arguments, and nothing behind the refusal', () => {
  /**
   * Neither the settle trigger nor the status refresh declares a parameter, so
   * there is no season, label, path, source, force or bypass value a caller
   * could supply, and no `FormData` for a crafted field to ride in on.
   */
  it('declares no parameters on the settle trigger, the Squiggle/Kali refresh or the status refresh', () => {
    expect(startSettleRunAction.length).toBe(0);
    expect(runCurrentSeasonAdminAction.length).toBe(0);
    expect(refreshSettleRunStatusAction.length).toBe(0);
  });

  it('never calls the host boundary, reads no batch and consults no systemd state', async () => {
    const state = await startSettleRunAction();

    expect(state).toMatchObject({ refused: true });
    expect(mocks.startSettleRun).not.toHaveBeenCalled();
    expect(mocks.getLatestSettleRun).not.toHaveBeenCalled();
    expect(mocks.readSettleRunStatus).not.toHaveBeenCalled();
    expect(mocks.authSql).not.toHaveBeenCalled();
  });

  it('refuses the same way whatever the host boundary would have answered', async () => {
    for (const answer of [
      { outcome: 'started' },
      { outcome: 'unavailable', reason: 'On-demand refresh is not enabled on this host.' },
      { outcome: 'error', reason: 'Failed to start afldb-settle-afltables.service: Access denied' },
    ]) {
      mocks.startSettleRun.mockResolvedValue(answer);
      const state = await startSettleRunAction();
      expect(state).toMatchObject({ refused: true, code: 'legacy_retired' });
    }
    expect(mocks.startSettleRun).not.toHaveBeenCalled();
  });

  it('refuses the Squiggle/Kali refresh and report, and never reaches the importer library', async () => {
    const source = await import('@/lib/external-afl/current-season-import');

    const refreshed = await staleRefresh({}, manualRefreshForm());
    const reportForm = new FormData();
    reportForm.set('mode', 'report');
    reportForm.set('year', '2026');
    const reported = await staleRefresh({}, reportForm);

    expect(refreshed).toMatchObject({ refused: true, code: 'legacy_retired', surface: 'admin.squiggle_kali_refresh' });
    expect(reported).toMatchObject({ refused: true, code: 'legacy_retired', surface: 'admin.squiggle_kali_refresh' });
    expect(errorOf(refreshed)).toMatch(/retired/i);
    // Every importer entry point is a mock here, and none was called, whatever the form said
    // (apply, insertMissingMatches and force were all on).
    expect(vi.mocked(source.runCurrentSeasonRefresh)).not.toHaveBeenCalled();
    expect(vi.mocked(source.getCurrentSeasonReport)).not.toHaveBeenCalled();
    expect(vi.mocked(source.parseCurrentSeasonSources)).not.toHaveBeenCalled();
    expect(vi.mocked(source.validateCurrentSeasonYear)).not.toHaveBeenCalled();
    expect(mocks.authSql).not.toHaveBeenCalled();
  });

  it('returns the status on a refresh and asserts no correlation of its own', async () => {
    const state = await refreshSettleRunStatusAction();

    expect(state.outcome).toBe('status');
    expect(state.status).toEqual(STATUS);
    // A refresh asserts no start correlation, and a read is not an action:
    // it writes no audit row.
    expect(state.batchIdAtStart).toBeUndefined();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe('the systemd unit-state mapping is pure and unchanged', () => {
  it('treats every non-idle systemd state as running', () => {
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
 * Audit: one row per authorised refusal, best effort, no secrets
 * ------------------------------------------------------------------ */

describe('audit', () => {
  it('records the actor, the retired surface and the export that was called', async () => {
    await startSettleRunAction();

    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(
      'admin.legacy_retired_refused',
      { surface: 'admin.afltables_settle_trigger', export: 'startSettleRunAction' },
      { userId: SUPER_ADMIN.id, label: SUPER_ADMIN.email },
    );
  });

  it('writes one row for the Squiggle/Kali refusal too, under its own surface', async () => {
    await staleRefresh({}, manualRefreshForm());

    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(
      'admin.legacy_retired_refused',
      { surface: 'admin.squiggle_kali_refresh', export: 'runCurrentSeasonAdminAction' },
      { userId: SUPER_ADMIN.id, label: SUPER_ADMIN.email },
    );
  });

  it('puts only the two fixed keys in the audit detail', async () => {
    await startSettleRunAction();

    const [, detail] = mocks.audit.mock.calls[0];
    expect(Object.keys(detail).sort()).toEqual(['export', 'surface']);
  });

  it('still refuses when the audit write fails, and says so on the server log only', async () => {
    mocks.audit.mockRejectedValue(new Error('audit insert failed'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const state = await startSettleRunAction();

    expect(state).toMatchObject({ refused: true, code: 'legacy_retired' });
    expect(JSON.stringify(state)).not.toContain('audit insert failed');
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it('never puts a credential or an environment value in the audit detail or the refusal', async () => {
    const state = await startSettleRunAction();

    const serialised = JSON.stringify([mocks.audit.mock.calls[0][1], state]);
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

  // AFLDB-ISSUE-232: LoadState is reported beside, never folded into, the phase.
  it.each([
    ['inactive', 'idle'],
    ['activating', 'running'],
    ['failed', 'failed'],
  ] as const)('an installed unit (LoadState=loaded) in ActiveState=%s keeps phase %s', (activeState, phase) => {
    const state = parseUnitShow(`LoadState=loaded\nActiveState=${activeState}\n`);
    expect(state.loadState).toBe('loaded');
    expect(state.phase).toBe(phase);
  });

  it('reports an uninstalled unit as LoadState=not-found, which systemd pairs with inactive', () => {
    const state = parseUnitShow('LoadState=not-found\nActiveState=inactive\nSubState=dead\nResult=success\n');
    expect(state.loadState).toBe('not-found');
    // The phase alone would say idle; that is why the panel reads loadState.
    expect(state.phase).toBe('idle');
  });

  it('leaves loadState empty when systemd does not report it, and never passes other properties through', () => {
    const state = parseUnitShow('ActiveState=inactive\nEnvironment=AFLDB_IMPORT_DATABASE_URL=postgres://x\n');
    expect(state.loadState).toBe('');
    expect(JSON.stringify(state)).not.toMatch(/postgres:\/\/|DATABASE_URL|Environment/);
  });

  it('asks systemd for LoadState, while startSettleRun() still names only the AFL Tables unit', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/acquisition/settle-trigger.ts'), 'utf8');
    expect(source).toContain("'--property=LoadState',");
    expect(source).toContain("const START_ARGV: readonly string[] = ['start', '--no-block', SETTLE_UNIT] as const;");
    // The only start argv is the fixed AFL Tables one; no other unit can be started.
    expect(source.match(/'start'/g)).toHaveLength(1);
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

  it('says "Not installed on this host." for LoadState=not-found, never "Idle"', () => {
    const notInstalled = {
      ...IDLE_UNIT, loadState: 'not-found', result: 'success', exitStatus: null,
      activeEnterTimestamp: '', inactiveEnterTimestamp: '',
    };
    const html = render({
      units: {
        ...UNITS,
        afl_api: { unit: notInstalled, unitError: null, latestRun: null, latestRunError: null },
        afl_api_brownlow: { unit: notInstalled, unitError: null, latestRun: null, latestRunError: null },
      } as unknown as Units,
      error: null,
    });
    expect(UNIT_NOT_INSTALLED).toBe('Not installed on this host.');
    expect(html.split(UNIT_NOT_INSTALLED)).toHaveLength(3);
    expect(html).not.toContain('Idle');
    expect(html).not.toContain('inactive');
    // The batch half is still reported on its own.
    expect(html).toContain('No batch recorded yet.');
  });

  it('keeps the ordinary phase text for an installed (LoadState=loaded) unit', () => {
    const html = render({
      units: {
        ...UNITS,
        afl_api_brownlow: { unit: IDLE_UNIT, unitError: null, latestRun: null, latestRunError: null },
      } as unknown as Units,
      error: null,
    });
    expect(html).toContain('Idle');
    expect(html).toContain('last finished Wed 2026-09-03 05:14:02 AEST');
    expect(html).not.toContain(UNIT_NOT_INSTALLED);
  });

  it('renders no credential or environment text, whatever the unit state', () => {
    const html = render({ units: UNITS, error: null });
    expect(html).not.toMatch(/postgres:\/\/|DATABASE_URL|Environment|SECRET|PASSWORD/);
  });

  it('is read-only: no client code, no action, no control', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/admin/current-season/AflApiSettleUnitsPanel.tsx'), 'utf8',
    );
    expect(source).not.toContain("'use client'");
    expect(source).not.toContain("'use server'");
    expect(source).not.toContain('./actions');
    expect(source).not.toMatch(/<button|<form|<input|<select|<textarea|onClick|useState|startSettleRun/);
    const html = render({ units: UNITS, error: null });
    expect(html).not.toMatch(/<button|<form|<input|<select|<textarea/);
  });

  it('is read on the page inside its own try, so a failure cannot take the page down', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/app/admin/current-season/page.tsx'), 'utf8');
    expect(page).toMatch(/try \{\s*aflApiUnits = await readSettleUnitTableStatus\(\);/);
    expect(page).toContain('<AflApiSettleUnitsPanel units={aflApiUnits} error={aflApiUnitsError} />');
  });
});

/* ------------------------------------------------------------------ *
 * AFLDB V2 Stage 5 — the retired controls are gone from the page and the
 * action module, and cannot quietly come back.
 *
 * Supersedes the AFLDB-ISSUE-127/128 assertions that read the AFL Tables
 * settle panel and the Squiggle/Kali controls: those components are removed
 * (docs/v2/legacy-disposition.md L5, L6), so what is pinned now is their
 * absence and the truthful replacement text. The structural guards that no
 * admin file imports the legacy libraries again live in
 * tests/v2-module-boundaries.test.ts.
 * ------------------------------------------------------------------ */

describe('AFLDB V2 Stage 5 — the current-season admin surface after the retirement', () => {
  const readSource = (relative: string) =>
    readFileSync(resolve(process.cwd(), relative), 'utf8').replace(/\r\n/g, '\n');
  const page = readSource('src/app/admin/current-season/page.tsx');
  const actions = readSource('src/app/admin/current-season/actions.ts');
  const query = readSource('src/db/queries/settle-runs.ts');

  it('keeps the settle batch projection that the AFL API units still use', () => {
    // Derived on read, so a batch row written before ISSUE-128 existed still
    // gets today's reading rather than none at all.
    expect(query).toContain('assessSourceCompleteness(counters)');
    expect(query).toContain('sourceCompleteness: SourceCompletenessVerdict');
    for (const counter of [
      'snapshotMatches', 'snapshotPlayerMatchRows', 'snapshotRejections',
      'snapshotUnkeyedRejections', 'absenceSweepSkipped',
    ]) {
      expect(query).toContain(`${counter}: counterOf(raw, '${counter}')`);
    }
  });

  it('renders neither the AFL Tables trigger panel nor the Squiggle/Kali controls', () => {
    expect(page).not.toMatch(/SettleRunPanel|CurrentSeasonControls|CurrentSeasonReportTable/);
    expect(page).not.toContain('current-season-import');
    expect(page).not.toContain('getCurrentSeasonReport');
    expect(page).not.toContain('Deprecated fallback diagnostics');
    expect(page).toContain('<AflApiIngestionControls initialView={ingestionView} />');
    expect(page).toContain('<AflApiSettleUnitsPanel units={aflApiUnits} error={aflApiUnitsError} />');
    for (const gone of [
      'src/app/admin/current-season/SettleRunPanel.tsx',
      'src/app/admin/current-season/CurrentSeasonControls.tsx',
    ]) {
      expect(() => readSource(gone), gone).toThrow();
    }
  });

  it('states the AFL Tables position truthfully: still on the host behind ISSUE-316, not started or stopped by V2', () => {
    expect(page).toContain('AFLDB-ISSUE-316');
    expect(page).toContain('D-316-1');
    expect(page).toContain('D-316-4');
    expect(page).not.toContain('D-316-2'); // plan section 7 R-042
    expect(page).toContain('neither starts nor');
    expect(page).toContain('retired');
    // The wording the observed ISSUE-128 defect displayed must not return.
    expect(page).not.toContain('Auto update uses Kali');
    expect(page).not.toContain('is the primary and only automatic');
  });

  it('keeps the guard on the page, and the actions module free of the legacy libraries', () => {
    expect(page).toContain("await requireCapability('acquisition.currentSeason');");
    expect(actions).not.toMatch(/current-season-import|settle-trigger|external-afl/);
    expect(actions).not.toContain('startSettleRun(');
    expect(actions).not.toContain('runCurrentSeasonRefresh');
    // The fallback providers have no write path of any kind from this module.
    expect(actions).not.toContain('insertMissingMatches');
  });

  it('refuses through the shared helper, after the guard, in both retired actions', () => {
    for (const [name, surface] of [
      ['runCurrentSeasonAdminAction', 'admin.squiggle_kali_refresh'],
      ['startSettleRunAction', 'admin.afltables_settle_trigger'],
    ] as const) {
      const body = actions.slice(actions.indexOf(`export async function ${name}(`));
      const guard = body.indexOf("await requireCapability('acquisition.currentSeason')");
      const refusal = body.indexOf(`refuseRetiredAdminAction('${surface}'`);
      expect(guard, name).toBeGreaterThan(-1);
      expect(refusal, name).toBeGreaterThan(guard);
    }
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
