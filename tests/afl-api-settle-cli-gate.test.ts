/**
 * AFLDB-ISSUE-228 follow-up (2026-09-21) — CLI-boundary coverage for the
 * fail-closed AFL API ingestion gate at the three settle CLI entry points:
 * `runAflApiSettleCli`, `runAflApiFixturesSettleCli`, `runAflApiBrownlowSettleCli`.
 *
 * Prior coverage (`afl-api-ingestion-control.test.ts`, `afl-api-match.test.ts`,
 * `afl-api-brownlow-acquire.test.ts`) proves the gate primitives and the
 * ACQUIRE-side CLI wrappers; nothing previously drove these three SETTLE
 * wrappers themselves, so deleting, inverting or misplacing the gate inside
 * any of them could still pass the whole suite. This file closes that gap.
 *
 * DB-free / network-free by construction: `deps.sql` is always either
 * unused (a refusal must happen before it is read at all) or a
 * `SqlStubTouched` proxy that throws the instant anything touches it —
 * proving structurally, not just by inspection, that a refusal happens
 * BEFORE the settle DB path opens, and that an enabled/permissive gate
 * genuinely reaches that DB path (while never completing a real write,
 * since the stub never performs real I/O). Every snapshot this file settles
 * is a zero-unit/zero-vote degenerate snapshot built in a scratch project
 * root, using COPIES of the real tracked `data/reference/*.json` so the
 * registry/identities parse exactly as production does.
 */
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type postgres from 'postgres';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import { AflApiBrownlowFixtureIdentityRequiredError, BROWNLOW_ENABLE_ENV } from '@/lib/acquisition/afl-api-brownlow';
import {
  AFL_API_FIXTURE_ACQUISITION_KIND,
  resolveAflApiMatchViaFixtureObservation,
} from '@/lib/acquisition/afl-api-fixture-identity';
import {
  DISABLED_AFL_API_INGESTION_CONTROLS,
  readAflApiIngestionControls,
  type AflApiIngestionControls,
} from '@/lib/acquisition/afl-api-ingestion-control';
import { runAflApiBrownlowSettleCli } from '../tools/current-season/settle-afl-api-brownlow';
import { runAflApiFixturesSettleCli } from '../tools/current-season/settle-afl-api-fixtures';
import { runAflApiSettleCli } from '../tools/current-season/settle-afl-api';

// I244-F006: only the fixture-observation RESOLVER is replaced (used solely by
// the fixture-identity describe block at the end of this file; every other
// test here settles zero vote sets and never reaches it). All other exports of
// the module stay real.
vi.mock('@/lib/acquisition/afl-api-fixture-identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/acquisition/afl-api-fixture-identity')>()),
  resolveAflApiMatchViaFixtureObservation: vi.fn(),
}));

const REPO_ROOT = join(__dirname, '..');
const REFERENCE_FILES =['source-families.json', 'afl-api-identities.json', 'seasons.json'] as const;
const SEASON = 2026;

const ENABLED_CONTROLS: AflApiIngestionControls = { currentSeasonEnabled: true, brownlowAdminEnabled: false };

// ---------------------------------------------------------------------------
// A "touched" sql stub. `postgres.Sql` is both called as a tagged template
// (`sql\`...\``) AND carries methods (`.begin`, `.end`, ...) — the proxy
// below throws `SqlStubTouched` the instant EITHER form of use is
// attempted, so any code path that reaches a real settle write is caught
// before it can do one, without this file ever opening a real connection.
// ---------------------------------------------------------------------------

class SqlStubTouched extends Error {
  constructor(detail: string) {
    super(`sql stub touched: ${detail}`);
    this.name = 'SqlStubTouched';
  }
}

function makeSqlStub(): { sql: postgres.Sql; touched: { value: boolean } } {
  const touched = { value: false };
  const mark = (detail: string): never => {
    touched.value = true;
    throw new SqlStubTouched(detail);
  };
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then' || prop === 'constructor' || prop === Symbol.toPrimitive) return undefined;
      return mark(`property '${String(prop)}'`);
    },
    apply() {
      return mark('called as a tagged template');
    },
  };
  const sql = new Proxy(function sqlStub() {}, handler) as unknown as postgres.Sql;
  return { sql, touched };
}

// ---------------------------------------------------------------------------
// Scratch project roots — a temp dir carrying only the one snapshot under
// test, plus COPIES of the real tracked reference files so the registry and
// identities parse exactly as production does. Nothing is ever written
// under the real repository's own `data/` tree.
// ---------------------------------------------------------------------------

const scratchDirs: string[] = [];
const originalControlDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (originalControlDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalControlDatabaseUrl;
});

function makeProjectRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(root);
  mkdirSync(join(root, 'data', 'reference'), { recursive: true });
  for (const name of REFERENCE_FILES) {
    writeFileSync(join(root, 'data', 'reference', name), readFileSync(join(REPO_ROOT, 'data', 'reference', name)));
  }
  return root;
}

describe('runAflApiSettleCli — AFLDB-ISSUE-228 follow-up settle-CLI gate coverage', () => {
  function setupSnapshot(): { projectRoot: string; label: string } {
    const projectRoot = makeProjectRoot('afldb-issue-228-settle-gate-');
    const label = 'gate-test-snapshot';
    const snapshotDir = join(projectRoot, 'data', 'sources', 'afl_api', 'matches', label);
    mkdirSync(snapshotDir, { recursive: true });
    writeFileSync(join(snapshotDir, 'manifest.json'), JSON.stringify({
      source_key: 'afl_api', acquisition_kind: 'afl_api_match_snapshot', season: SEASON, files: [],
    }));
    return { projectRoot, label };
  }

  it.each(['--dry-run', '--apply'])('%s refuses before the settle DB path opens when disabled', async (flag) => {
    const { projectRoot, label } = setupSnapshot();
    const { sql, touched } = makeSqlStub();

    await expect(runAflApiSettleCli(
      ['--label', label, flag],
      { projectRoot, sql, ingestionControls: DISABLED_AFL_API_INGESTION_CONTROLS },
    )).rejects.toThrow(/current-season ingestion is disabled/);

    expect(touched.value).toBe(false);
  });

  it('--validate-only remains allowed while disabled and never opens the settle DB path', async () => {
    const { projectRoot, label } = setupSnapshot();
    const { sql, touched } = makeSqlStub();

    const outcome = await runAflApiSettleCli(
      ['--label', label, '--validate-only'],
      { projectRoot, sql, ingestionControls: DISABLED_AFL_API_INGESTION_CONTROLS },
    );

    expect(outcome.result).toBeNull();
    expect(touched.value).toBe(false);
  });

  it('--report remains allowed while disabled (read-only diagnostics, §F)', async () => {
    const { projectRoot, label } = setupSnapshot();
    const { sql, touched } = makeSqlStub();

    // The ingestion-disabled refusal must NOT fire for --report. Rejecting
    // with the stub's DISTINCT error (rather than resolving cleanly, which
    // this snapshot's own DB-dependent report step cannot do here) proves
    // the gate was bypassed as designed, not merely that nothing happened.
    await expect(runAflApiSettleCli(
      ['--label', label, '--report'],
      { projectRoot, sql, ingestionControls: DISABLED_AFL_API_INGESTION_CONTROLS },
    )).rejects.toThrow(SqlStubTouched);

    expect(touched.value).toBe(true);
  });

  it.each(['--dry-run', '--apply'])('%s reaches the settle DB path once enabled (gate permits progression)', async (flag) => {
    const { projectRoot, label } = setupSnapshot();
    const { sql, touched } = makeSqlStub();

    await expect(runAflApiSettleCli(
      ['--label', label, flag],
      { projectRoot, sql, ingestionControls: ENABLED_CONTROLS },
    )).rejects.toThrow(SqlStubTouched);

    expect(touched.value).toBe(true);
  });

  it('fail-closed: the real disabled-by-unreadable-settings result still refuses --dry-run', async () => {
    const { projectRoot, label } = setupSnapshot();
    const { sql, touched } = makeSqlStub();

    // DATABASE_URL is deliberately absent from this explicit env map — the
    // exact fail-closed path `afl-api-ingestion-control.test.ts` proves at
    // the primitive level. Feeding its REAL output into the CLI wrapper
    // (rather than a hand-built disabled object) proves the wrapper itself
    // receives and honours that fail-closed result.
    const controls = await readAflApiIngestionControls({});
    expect(controls).toEqual(DISABLED_AFL_API_INGESTION_CONTROLS);

    await expect(runAflApiSettleCli(
      ['--label', label, '--dry-run'],
      { projectRoot, sql, ingestionControls: controls },
    )).rejects.toThrow(/current-season ingestion is disabled/);

    expect(touched.value).toBe(false);
  });

  it('fails real control preflight before the normal settle can touch its writer', async () => {
    const { projectRoot, label } = setupSnapshot();
    const { sql, touched } = makeSqlStub();
    delete process.env.DATABASE_URL;

    await expect(runAflApiSettleCli(
      ['--label', label, '--dry-run'],
      { projectRoot, sql },
    )).rejects.toThrow('DATABASE_URL is not configured for the control database');

    expect(touched.value).toBe(false);
  });
});

describe('runAflApiFixturesSettleCli — AFLDB-ISSUE-228 follow-up settle-CLI gate coverage', () => {
  function setupSnapshot(): { projectRoot: string; label: string } {
    const projectRoot = makeProjectRoot('afldb-issue-228-fixtures-gate-');
    const label = 'gate-test-fixtures-snapshot';
    const snapshotDir = join(projectRoot, 'data', 'sources', 'afl_api', 'fixtures', label);
    mkdirSync(snapshotDir, { recursive: true });
    writeFileSync(join(snapshotDir, 'manifest.json'), JSON.stringify({
      source_key: 'afl_api', acquisition_kind: AFL_API_FIXTURE_ACQUISITION_KIND, season: SEASON, files: [],
    }));
    return { projectRoot, label };
  }

  it.each(['--dry-run', '--apply'])('%s refuses before DB mutation when disabled', async (flag) => {
    const { projectRoot, label } = setupSnapshot();
    const { sql, touched } = makeSqlStub();

    await expect(runAflApiFixturesSettleCli(
      ['--label', label, flag],
      { projectRoot, sql, ingestionControls: DISABLED_AFL_API_INGESTION_CONTROLS },
    )).rejects.toThrow(/current-season ingestion is disabled/);

    expect(touched.value).toBe(false);
  });

  it('--validate-only remains allowed while disabled and never opens the settle DB path', async () => {
    const { projectRoot, label } = setupSnapshot();
    const { sql, touched } = makeSqlStub();

    const outcome = await runAflApiFixturesSettleCli(
      ['--label', label, '--validate-only'],
      { projectRoot, sql, ingestionControls: DISABLED_AFL_API_INGESTION_CONTROLS },
    );

    expect(outcome.counters).toBeNull();
    expect(outcome.batchId).toBeNull();
    expect(touched.value).toBe(false);
  });

  it.each(['--dry-run', '--apply'])('%s reaches the settle DB path once enabled (gate permits progression)', async (flag) => {
    const { projectRoot, label } = setupSnapshot();
    const { sql, touched } = makeSqlStub();

    await expect(runAflApiFixturesSettleCli(
      ['--label', label, flag],
      { projectRoot, sql, ingestionControls: ENABLED_CONTROLS },
    )).rejects.toThrow(SqlStubTouched);

    expect(touched.value).toBe(true);
  });
});

describe('runAflApiBrownlowSettleCli — AFLDB-ISSUE-228 follow-up two-key settle-CLI gate coverage', () => {
  // `isAflApiBrownlowEnabled()` reads `process.env` directly inside the CLI
  // (no injection point exists for the deployment half of the two-key
  // gate), so this describe block owns that one ambient mutation and always
  // restores it.
  const originalDeploymentEnv = process.env[BROWNLOW_ENABLE_ENV];
  afterEach(() => {
    if (originalDeploymentEnv === undefined) delete process.env[BROWNLOW_ENABLE_ENV];
    else process.env[BROWNLOW_ENABLE_ENV] = originalDeploymentEnv;
  });

  function setDeploymentGate(enabled: boolean): void {
    if (enabled) process.env[BROWNLOW_ENABLE_ENV] = 'true';
    else delete process.env[BROWNLOW_ENABLE_ENV];
  }

  function setupSnapshot(): { projectRoot: string; label: string } {
    const projectRoot = makeProjectRoot('afldb-issue-228-brownlow-gate-');
    const label = 'gate-test-brownlow-snapshot';
    const snapshotDir = join(projectRoot, 'data', 'sources', 'afl_api', 'brownlow', label);
    mkdirSync(snapshotDir, { recursive: true });
    writeFileSync(join(snapshotDir, 'manifest.json'), JSON.stringify({
      source_key: 'afl_api', season: SEASON, files: [],
    }));
    // §10 pre-count publication: an empty `matchVotes`/`leaderboard` is a
    // VALID "nothing published yet" state for this family, not a malformed
    // source — `emitAflApiBrownlowMatchVotes`/`emitAflApiBrownlowLeaderboard`
    // skip the required-column gate entirely when the collection is empty.
    writeFileSync(
      join(snapshotDir, '01-brownlow-season.raw.json'),
      JSON.stringify({ seasonId: 'CD_S2026014', status: 'IN_PROGRESS', matchVotes: [] }),
    );
    writeFileSync(
      join(snapshotDir, '02-brownlow-leaderboard.raw.json'),
      JSON.stringify({
        seasonId: 'CD_S2026014', status: 'IN_PROGRESS', teamFilter: null, leaderboard: [],
      }),
    );
    return { projectRoot, label };
  }

  const REFUSED_COMBOS: readonly { name: string; deployment: boolean; admin: boolean }[] = [
    { name: 'deployment=false, admin=false', deployment: false, admin: false },
    { name: 'deployment=true, admin=false', deployment: true, admin: false },
    { name: 'deployment=false, admin=true', deployment: false, admin: true },
  ];

  for (const combo of REFUSED_COMBOS) {
    it(`--dry-run refuses before DB mutation when ${combo.name}`, async () => {
      const { projectRoot, label } = setupSnapshot();
      setDeploymentGate(combo.deployment);
      const { sql, touched } = makeSqlStub();

      await expect(runAflApiBrownlowSettleCli(
        ['--label', label, '--dry-run'],
        { projectRoot, sql, ingestionControls: { currentSeasonEnabled: false, brownlowAdminEnabled: combo.admin } },
      )).rejects.toThrow(/two-key safety/);

      expect(touched.value).toBe(false);
    });
  }

  it('--apply refuses before DB mutation when both gates are off', async () => {
    const { projectRoot, label } = setupSnapshot();
    setDeploymentGate(false);
    const { sql, touched } = makeSqlStub();

    await expect(runAflApiBrownlowSettleCli(
      ['--label', label, '--apply'],
      { projectRoot, sql, ingestionControls: { currentSeasonEnabled: false, brownlowAdminEnabled: false } },
    )).rejects.toThrow(/two-key safety/);

    expect(touched.value).toBe(false);
  });

  it('--observe-only refuses before it can persist spine observations when both gates are off', async () => {
    const { projectRoot, label } = setupSnapshot();
    setDeploymentGate(false);
    const { sql, touched } = makeSqlStub();

    await expect(runAflApiBrownlowSettleCli(
      ['--label', label, '--observe-only'],
      { projectRoot, sql, ingestionControls: { currentSeasonEnabled: false, brownlowAdminEnabled: false } },
    )).rejects.toThrow(/two-key safety/);

    expect(touched.value).toBe(false);
  });

  it('--validate-only remains allowed regardless of gate state', async () => {
    const { projectRoot, label } = setupSnapshot();
    setDeploymentGate(false);
    const { sql, touched } = makeSqlStub();

    const outcome = await runAflApiBrownlowSettleCli(
      ['--label', label, '--validate-only'],
      { projectRoot, sql, ingestionControls: { currentSeasonEnabled: false, brownlowAdminEnabled: false } },
    );

    expect(outcome.result).toBeNull();
    expect(touched.value).toBe(false);
  });

  it.each(['--dry-run', '--apply', '--observe-only'])(
    '%s reaches the settle DB path once BOTH gates are on (gate permits progression)',
    async (flag) => {
      const { projectRoot, label } = setupSnapshot();
      setDeploymentGate(true);
      const { sql, touched } = makeSqlStub();

      await expect(runAflApiBrownlowSettleCli(
        ['--label', label, flag],
        { projectRoot, sql, ingestionControls: { currentSeasonEnabled: false, brownlowAdminEnabled: true } },
      )).rejects.toThrow(SqlStubTouched);

      expect(touched.value).toBe(true);
    },
  );

  it('fails real control preflight before the Brownlow settle can touch its writer', async () => {
    const { projectRoot, label } = setupSnapshot();
    setDeploymentGate(true);
    const { sql, touched } = makeSqlStub();
    delete process.env.DATABASE_URL;

    await expect(runAflApiBrownlowSettleCli(
      ['--label', label, '--dry-run'],
      { projectRoot, sql },
    )).rejects.toThrow('DATABASE_URL is not configured for the control database');

    expect(touched.value).toBe(false);
  });
});

describe('runAflApiBrownlowSettleCli — AFLDB-ISSUE-244 I244-F006 fixture-identity contract', () => {
  // `staging.afl_api_match` holds only the matches the AFL API settle PLANS; a
  // match that merely corroborates a foreign-owned canonical match has no typed
  // row and resolves only through `--use-fixture-identity`. These tests drive
  // the REAL CLI + REAL coverage assessment; only the SQL connection and the
  // fixture-observation resolver are stand-ins. "Reached the write boundary"
  // = the run called `sql.begin` (the stub throws there), i.e. the CLI let the
  // run start; "refused" = the F006 error, thrown before `sql.begin`.
  class WriteBoundaryReached extends Error {}

  const originalDeploymentEnv = process.env[BROWNLOW_ENABLE_ENV];
  const resolveViaFixture = vi.mocked(resolveAflApiMatchViaFixtureObservation);
  const CONTROLS: AflApiIngestionControls = { currentSeasonEnabled: false, brownlowAdminEnabled: true };

  beforeEach(() => {
    process.env[BROWNLOW_ENABLE_ENV] = 'true';
    resolveViaFixture.mockReset();
    resolveViaFixture.mockImplementation(async (_sql, _sourceId, providerMatchId) => (
      providerMatchId.startsWith('CD_M_CORROBORATED')
        ? { outcome: 'resolved', matchId: 9001, isFinal: false, season: SEASON }
        : { outcome: 'refused', reason: 'no_fixture_observation' }
    ));
  });
  afterEach(() => {
    if (originalDeploymentEnv === undefined) delete process.env[BROWNLOW_ENABLE_ENV];
    else process.env[BROWNLOW_ENABLE_ENV] = originalDeploymentEnv;
  });

  function setupVoteSnapshot(providerMatchIds: readonly string[]): { projectRoot: string; label: string } {
    const projectRoot = makeProjectRoot('afldb-issue-244-f006-');
    const label = 'f006-brownlow-snapshot';
    const snapshotDir = join(projectRoot, 'data', 'sources', 'afl_api', 'brownlow', label);
    mkdirSync(snapshotDir, { recursive: true });
    writeFileSync(join(snapshotDir, 'manifest.json'), JSON.stringify({ source_key: 'afl_api', season: SEASON, files: [] }));
    const votes = [3, 2, 1].map((value, i) => ({
      player: { playerId: `CD_I${i + 1}` }, team: { teamId: 'CD_T10' }, votes: value, eligible: true,
    }));
    writeFileSync(
      join(snapshotDir, '01-brownlow-season.raw.json'),
      JSON.stringify({
        seasonId: 'CD_S2026014',
        status: 'IN_PROGRESS',
        matchVotes: providerMatchIds.map((matchId) => ({ matchId, roundNumber: 5, votes })),
      }),
    );
    writeFileSync(
      join(snapshotDir, '02-brownlow-leaderboard.raw.json'),
      JSON.stringify({
        seasonId: 'CD_S2026014', status: 'IN_PROGRESS', teamFilter: null, leaderboard: [],
      }),
    );
    return { projectRoot, label };
  }

  /** `typedProviderIds` are the provider match ids that HAVE a typed
   * `staging.afl_api_match` row; every other id has none. */
  function makeIdentitySql(typedProviderIds: readonly string[], databaseName = 'afldb_test') {
    const state = { writeBoundaryReached: false, queries: 0 };
    const fn = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
      state.queries += 1;
      const text = strings.join('?');
      if (/current_database\(\)/.test(text)) return [{ name: databaseName }];
      if (/FROM sources\s+WHERE key = 'afl_api'/.test(text)) return [{ id: 7 }];
      if (/FROM staging\.afl_api_match/.test(text)) {
        return typedProviderIds.includes(String(values[1]))
          ? [{
            season: SEASON, roundCode: '5', matchDate: '2026-04-11', homeClubId: 1, awayClubId: 2, isFinal: false,
          }]
          : [];
      }
      if (/round_number AS "roundNumber" FROM matches/.test(text)) return [{ roundNumber: 5 }];
      throw new Error(`unexpected query in the F006 identity stub: ${text}`);
    };
    const begin = async (): Promise<never> => {
      state.writeBoundaryReached = true;
      throw new WriteBoundaryReached('the run was allowed to start');
    };
    return { sql: Object.assign(fn, { begin }) as unknown as postgres.Sql, state };
  }

  const REFUSED_MODES: readonly { flags: readonly string[]; mode: 'apply' | 'dry-run' }[] = [
    { flags: ['--apply', '--auto-apply'], mode: 'apply' },
    { flags: ['--apply'], mode: 'apply' },
    { flags: ['--dry-run', '--auto-apply'], mode: 'dry-run' },
    { flags: ['--dry-run'], mode: 'dry-run' },
    { flags: [], mode: 'dry-run' },
  ];

  for (const { flags, mode } of REFUSED_MODES) {
    it(`refuses before any write (${mode}) when a vote set is resolvable only via fixture identity and the flag is absent: [${flags.join(' ') || 'no mode flag'}]`, async () => {
      const { projectRoot, label } = setupVoteSnapshot(['CD_M_TYPED', 'CD_M_CORROBORATED_1', 'CD_M_CORROBORATED_2']);
      const { sql, state } = makeIdentitySql(['CD_M_TYPED']);

      const error = await runAflApiBrownlowSettleCli(
        ['--label', label, ...flags], { projectRoot, sql, ingestionControls: CONTROLS },
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AflApiBrownlowFixtureIdentityRequiredError);
      const refusal = error as AflApiBrownlowFixtureIdentityRequiredError;
      expect(refusal.mode).toBe(mode);
      expect(refusal.coverage).toMatchObject({
        voteSetsChecked: 3, withStagedIdentity: 1, unresolvableEvenWithFixtureIdentity: 0,
      });
      expect(refusal.coverage.fixtureIdentityRequired).toEqual(['CD_M_CORROBORATED_1', 'CD_M_CORROBORATED_2']);
      expect(refusal.message).toContain('--use-fixture-identity');
      expect(state.writeBoundaryReached).toBe(false);
    });
  }

  it('with --use-fixture-identity the same snapshot is allowed to start (the fallback is explicit, and the CLI proceeds to its normal stages)', async () => {
    const { projectRoot, label } = setupVoteSnapshot(['CD_M_TYPED', 'CD_M_CORROBORATED_1']);
    const { sql, state } = makeIdentitySql(['CD_M_TYPED']);
    const lines: string[] = [];

    await expect(runAflApiBrownlowSettleCli(
      ['--label', label, '--apply', '--auto-apply', '--use-fixture-identity'],
      { projectRoot, sql, ingestionControls: CONTROLS, log: (line) => lines.push(line) },
    )).rejects.toThrow(WriteBoundaryReached);

    expect(state.writeBoundaryReached).toBe(true);
    expect(lines.join('\n')).toContain('--use-fixture-identity:');
  });

  it('an ordinary staged snapshot still starts without the flag: no unnecessary refusal, and the fallback is never consulted', async () => {
    const { projectRoot, label } = setupVoteSnapshot(['CD_M_TYPED_1', 'CD_M_TYPED_2']);
    const { sql, state } = makeIdentitySql(['CD_M_TYPED_1', 'CD_M_TYPED_2']);

    await expect(runAflApiBrownlowSettleCli(
      ['--label', label, '--apply', '--auto-apply'], { projectRoot, sql, ingestionControls: CONTROLS },
    )).rejects.toThrow(WriteBoundaryReached);

    expect(state.writeBoundaryReached).toBe(true);
    expect(resolveViaFixture).not.toHaveBeenCalled();
  });

  it('vote sets that even the fixture path cannot resolve keep their ordinary per-set refusal: no flag-required refusal', async () => {
    const { projectRoot, label } = setupVoteSnapshot(['CD_M_NO_OBSERVATION']);
    const { sql, state } = makeIdentitySql([]);

    await expect(runAflApiBrownlowSettleCli(
      ['--label', label, '--apply', '--auto-apply'], { projectRoot, sql, ingestionControls: CONTROLS },
    )).rejects.toThrow(WriteBoundaryReached);

    expect(state.writeBoundaryReached).toBe(true);
  });

  it('--observe-only without the flag is advisory only: it logs the requirement and still starts', async () => {
    const { projectRoot, label } = setupVoteSnapshot(['CD_M_CORROBORATED_1']);
    const { sql, state } = makeIdentitySql([]);
    const lines: string[] = [];

    await expect(runAflApiBrownlowSettleCli(
      ['--label', label, '--observe-only', '--apply'],
      { projectRoot, sql, ingestionControls: CONTROLS, log: (line) => lines.push(line) },
    )).rejects.toThrow(WriteBoundaryReached);

    expect(state.writeBoundaryReached).toBe(true);
    const output = lines.join('\n');
    expect(output).toContain('ADVISORY (--observe-only)');
    expect(output).toContain('--use-fixture-identity');
    expect(output).toContain('expected by design');
  });

  it('--validate-only opens no connection and does not assess fixture identity', async () => {
    const { projectRoot, label } = setupVoteSnapshot(['CD_M_CORROBORATED_1']);
    const { sql, state } = makeIdentitySql([]);

    const outcome = await runAflApiBrownlowSettleCli(
      ['--label', label, '--validate-only'], { projectRoot, sql, ingestionControls: CONTROLS },
    );

    expect(outcome.result).toBeNull();
    expect(state.queries).toBe(0);
    expect(resolveViaFixture).not.toHaveBeenCalled();
  });

  it('does not weaken the completed-season backtest proof: a non-afldb_test database is refused for THAT reason, before fixture identity is assessed', async () => {
    const { projectRoot, label } = setupVoteSnapshot(['CD_M_CORROBORATED_1']);
    const { sql, state } = makeIdentitySql([], 'afldb_prod');

    const error = await runAflApiBrownlowSettleCli(
      ['--label', label, '--apply', '--auto-apply', '--allow-completed-season-backtest'],
      { projectRoot, sql, ingestionControls: CONTROLS },
    ).catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(AflApiBrownlowFixtureIdentityRequiredError);
    expect((error as Error).message).toMatch(/afldb_prod/);
    expect(resolveViaFixture).not.toHaveBeenCalled();
    expect(state.writeBoundaryReached).toBe(false);
  });

  it('the backtest authority does not bypass the identity requirement on afldb_test', async () => {
    const { projectRoot, label } = setupVoteSnapshot(['CD_M_CORROBORATED_1']);
    const { sql, state } = makeIdentitySql([], 'afldb_test');

    const error = await runAflApiBrownlowSettleCli(
      ['--label', label, '--apply', '--auto-apply', '--allow-completed-season-backtest'],
      { projectRoot, sql, ingestionControls: CONTROLS },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AflApiBrownlowFixtureIdentityRequiredError);
    expect(state.writeBoundaryReached).toBe(false);
  });
});
