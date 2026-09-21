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
  afterEach, describe, expect, it,
} from 'vitest';

import { BROWNLOW_ENABLE_ENV } from '@/lib/acquisition/afl-api-brownlow';
import { AFL_API_FIXTURE_ACQUISITION_KIND } from '@/lib/acquisition/afl-api-fixture-identity';
import {
  DISABLED_AFL_API_INGESTION_CONTROLS,
  readAflApiIngestionControls,
  type AflApiIngestionControls,
} from '@/lib/acquisition/afl-api-ingestion-control';
import { runAflApiBrownlowSettleCli } from '../tools/current-season/settle-afl-api-brownlow';
import { runAflApiFixturesSettleCli } from '../tools/current-season/settle-afl-api-fixtures';
import { runAflApiSettleCli } from '../tools/current-season/settle-afl-api';

const REPO_ROOT = join(__dirname, '..');
const REFERENCE_FILES = ['source-families.json', 'afl-api-identities.json', 'seasons.json'] as const;
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

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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
});
