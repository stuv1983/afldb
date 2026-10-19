/**
 * AFLDB V2 Stage 3 (docs/v2/plan.md §3 D1) — offline snapshot replay
 * (packages/acquisition/src/replay.ts).
 *
 * NOT EXECUTED HERE: transactional preservation on PostgreSQL (a failed or rolled-back promotion
 * leaves no partial write). There is no database in this suite; that proof is a V2-GAP recorded
 * by the orchestrator. What IS proved, DB-free, on a real hash-bound snapshot built from the
 * COMMITTED provider fixtures (tests/fixtures/afl_api/match/01-,02-,03-):
 *  - replaying the same snapshot twice yields an identical plan digest and a deep-equal bundle;
 *  - a byte-identical copy elsewhere (different directory name) yields the identical digest and
 *    manifest hash;
 *  - the replay equals the PRODUCTION loader `loadAflApiSettleBundle(projectRoot, label)` on the
 *    same scratch project: no drift between replay and what the settle CLI would propose;
 *  - one tampered byte refuses with a sha256 mismatch, before any bundle is built;
 *  - a unit that fails validation (SYNTHETIC: an undeclared column, manifest re-hashed so the
 *    snapshot is internally consistent) is a build failure and proposes nothing, while the good
 *    unit's proposals are unchanged;
 *  - after a full rollback every durable counter reads zero and the plan/refusal facts survive.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  AFL_API_COUNTER_KEYS,
  aflApiPlanDigest,
  parseAflApiIdentities,
  parseSourceFamilyRegistry,
  replayAflApiSnapshot,
} from '@afldb/acquisition';
import {
  buildAflApiSettleBundle,
  normaliseAflApiCountersAfterFullRollback,
  type AflApiSettleCounters,
} from '@/lib/acquisition/settle-afl-api';
import { loadAflApiSettleBundle } from '../tools/current-season/settle-afl-api';
import {
  FIXTURE_MATCH_ID,
  committedUnit,
  makeScratchDir,
  makeScratchProject,
  referenceJson,
  sha256Of,
  undeclaredColumnUnit,
  writeSnapshot,
} from './afl-api-snapshot-fixture';

const registry = parseSourceFamilyRegistry(referenceJson('source-families.json'));
const identities = parseAflApiIdentities(referenceJson('afl-api-identities.json'));
const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(label: string, units = [committedUnit()]): { projectRoot: string; snapshotDir: string } {
  const made = makeScratchProject(label, units);
  scratch.push(made.projectRoot);
  return made;
}

function replay(snapshotDir: string, snapshotLabel?: string) {
  return replayAflApiSnapshot({ snapshotDir, registry, identities, buildBundle: buildAflApiSettleBundle, snapshotLabel });
}

function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const source = join(from, name);
    if (statSync(source).isDirectory()) copyTree(source, join(to, name));
    else copyFileSync(source, join(to, name));
  }
}

describe('replayAflApiSnapshot — determinism', () => {
  it('replays the committed fixture trio into one validated unit, with a 64-hex digest and manifest hash', () => {
    const { snapshotDir } = project('replay-basic');
    const result = replay(snapshotDir);
    expect(result.bundle.season).toBe(2026);
    expect(result.bundle.snapshotLabel).toBe('replay-basic');
    expect(result.bundle.buildFailures).toEqual([]);
    expect(result.bundle.units).toHaveLength(1);
    expect(result.bundle.units[0].bundle.match.sourceRecordId).toBe(FIXTURE_MATCH_ID);
    expect(result.bundle.units[0].settleRecords.length).toBeGreaterThan(0);
    expect(result.planDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.manifestSha256).toBe(sha256Of(readFileSync(join(snapshotDir, 'manifest.json'))));
    // No season feed was retained, so the assessment is the incomplete default: it authorises nothing.
    expect(result.bundle.seasonFeed.complete).toBe(false);
    expect(result.planDigest).toBe(aflApiPlanDigest(result.bundle));
  });

  it('two replays of the same snapshot give an identical plan digest and a deep-equal bundle', () => {
    const { snapshotDir } = project('replay-twice');
    const a = replay(snapshotDir);
    const b = replay(snapshotDir);
    expect(b.planDigest).toBe(a.planDigest);
    expect(b.manifestSha256).toBe(a.manifestSha256);
    expect(b.bundle).toEqual(a.bundle);
  });

  it('a byte-identical copy elsewhere (other directory name) gives the identical digest and manifest hash', () => {
    const { snapshotDir } = project('replay-original');
    const elsewhere = makeScratchDir('afldb-v2-replay-copy-');
    scratch.push(elsewhere);
    const copy = join(elsewhere, 'a-completely-different-name');
    copyTree(snapshotDir, copy);
    const original = replay(snapshotDir);
    const copied = replay(copy);
    expect(copied.planDigest).toBe(original.planDigest);
    expect(copied.manifestSha256).toBe(original.manifestSha256);
    expect(copied.bundle.snapshotLabel).toBe('a-completely-different-name');
    expect({ ...copied.bundle, snapshotLabel: '' }).toEqual({ ...original.bundle, snapshotLabel: '' });
  });

  it('a different set of provider bytes gives a different digest (the digest is not constant)', () => {
    const base = project('replay-base');
    const other = project('replay-other', [committedUnit(), undeclaredColumnUnit()]);
    expect(replay(other.snapshotDir).planDigest).not.toBe(replay(base.snapshotDir).planDigest);
  });
});

describe('replayAflApiSnapshot — equal to the production loader', () => {
  it('equals loadAflApiSettleBundle(projectRoot, label) on the same scratch project (one unit)', () => {
    const { projectRoot, snapshotDir } = project('replay-parity');
    const replayed = replay(snapshotDir);
    const loaded = loadAflApiSettleBundle(projectRoot, 'replay-parity');
    expect(replayed.bundle).toEqual(loaded.bundle);
    expect(aflApiPlanDigest(loaded.bundle)).toBe(replayed.planDigest);
  });

  it('equals the production loader when a unit fails to build (two units, one SYNTHETIC invalid)', () => {
    const { projectRoot, snapshotDir } = project('replay-parity-bad', [committedUnit(), undeclaredColumnUnit()]);
    const replayed = replay(snapshotDir);
    const loaded = loadAflApiSettleBundle(projectRoot, 'replay-parity-bad');
    expect(replayed.bundle).toEqual(loaded.bundle);
    expect(replayed.bundle.buildFailures).toHaveLength(1);
  });
});

describe('replayAflApiSnapshot — refusals', () => {
  it('refuses one tampered byte with a sha256 mismatch, before any bundle is built', () => {
    const { snapshotDir } = project('replay-tamper');
    const target = join(snapshotDir, FIXTURE_MATCH_ID, 'player-stats.json');
    const bytes = readFileSync(target);
    bytes[bytes.length - 2] = bytes[bytes.length - 2] === 0x20 ? 0x21 : 0x20;
    writeFileSync(target, bytes);
    let built = false;
    expect(() => replayAflApiSnapshot({
      snapshotDir, registry, identities, buildBundle: (input) => { built = true; return buildAflApiSettleBundle(input); },
    })).toThrow(/sha256 mismatch/);
    expect(built).toBe(false);
  });

  it('refuses a snapshot with no manifest', () => {
    const dir = makeScratchDir('afldb-v2-replay-nomanifest-');
    scratch.push(dir);
    expect(() => replay(dir)).toThrow(/No manifest\.json/);
  });

  it('refuses a manifest with no numeric season', () => {
    const dir = makeScratchDir('afldb-v2-replay-noseason-');
    scratch.push(dir);
    writeSnapshot(dir, [committedUnit()]);
    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.season = '2026';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => replay(dir)).toThrow(/no numeric season/);
  });

  it('a unit listing a file the manifest does not hash refuses the whole snapshot (nothing partial)', () => {
    const { snapshotDir } = project('replay-unverified');
    const manifestPath = join(snapshotDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { files: { file: string }[] };
    manifest.files = manifest.files.filter((f) => !f.file.endsWith('player-stats.json'));
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => replay(snapshotDir)).toThrow(/not fully verified by the manifest/);
  });
});

describe('replayAflApiSnapshot — a validation failure proposes nothing for that unit', () => {
  it('a SYNTHETIC undeclared column in one unit is a build failure; the good unit is unchanged', () => {
    const good = replay(project('replay-good-only').snapshotDir);
    const mixed = replay(project('replay-mixed', [committedUnit(), undeclaredColumnUnit()]).snapshotDir);

    expect(mixed.bundle.buildFailures).toHaveLength(1);
    expect(mixed.bundle.buildFailures[0].providerMatchId).toBe('CD_M20260142802');
    expect(mixed.bundle.buildFailures[0].error).toMatch(/undeclared column/);
    expect(mixed.bundle.units.map((u) => u.bundle.match.sourceRecordId)).toEqual([FIXTURE_MATCH_ID]);
    // Nothing was proposed for the failed unit...
    const proposed = mixed.bundle.units.flatMap((u) => u.settleRecords.map((r) => r.externalRecordId));
    expect(proposed.some((id) => id.includes('CD_M20260142802'))).toBe(false);
    // ...and the good unit's proposals are exactly what they were without the bad neighbour.
    expect(mixed.bundle.units[0].settleRecords).toEqual(good.bundle.units[0].settleRecords);
    // The failure is part of the plan, so the digest moves.
    expect(mixed.planDigest).not.toBe(good.planDigest);
  });

  it('when the only unit is invalid there are no units and no proposed records at all', () => {
    const only = replay(project('replay-only-bad', [undeclaredColumnUnit(FIXTURE_MATCH_ID)]).snapshotDir);
    expect(only.bundle.units).toEqual([]);
    expect(only.bundle.buildFailures).toHaveLength(1);
    expect(only.bundle.buildFailures[0].error).toMatch(/undeclared column/);
  });
});

describe('normaliseAflApiCountersAfterFullRollback', () => {
  // The durable-counter contract of settle-afl-api.ts FULL_ROLLBACK_DURABLE_COUNTERS, pinned here.
  const DURABLE = [
    'payloadsCreated', 'versionsAppended', 'observationsCorrected', 'observationsHistoryOnly',
    'observationsMarkedAbsent', 'observationsReappeared', 'projectionRowsWritten', 'candidatesCreated',
    'candidatesRefreshed', 'dataIssuesOpened', 'dataIssuesRefreshed', 'dataIssuesResolved',
    'canonicalRowsInserted', 'canonicalRowsUpdated', 'canonicalApplicationsLogged',
    'attendanceEnrichmentsApplied', 'derivedRecomputeRuns', 'derivedRecomputePlayers',
  ] as const;

  function sevens(): AflApiSettleCounters {
    const counters: Record<string, unknown> = {};
    for (const key of AFL_API_COUNTER_KEYS) {
      counters[key] = key === 'recordsDeferred' || key === 'seasonFeedStatusCounts' ? { x: 7 } : 7;
    }
    return counters as unknown as AflApiSettleCounters;
  }

  it('zeroes every durable counter and keeps the plan, identity and refusal facts', () => {
    const counters = sevens();
    normaliseAflApiCountersAfterFullRollback(counters);
    for (const key of DURABLE) expect(counters[key], key).toBe(0);
    const kept = AFL_API_COUNTER_KEYS.filter((key) => !(DURABLE as readonly string[]).includes(key));
    expect(kept.length).toBeGreaterThan(0);
    for (const key of kept) {
      expect(counters[key], key).toEqual(key === 'recordsDeferred' || key === 'seasonFeedStatusCounts' ? { x: 7 } : 7);
    }
    for (const key of ['snapshotMatches', 'unresolvedIdentityMatch', 'canonicalApplyRefusals', 'observationsSeen']) {
      expect(counters[key as keyof AflApiSettleCounters], key).toBe(7);
    }
  });
});
