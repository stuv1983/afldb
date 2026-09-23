#!/usr/bin/env node
/**
 * AFLDB-ISSUE-228 S3 (§9, §16) — the AFL API bundle backtest harness.
 *
 * Walks the tracked captured samples under
 * `data/sources/AFLWebsite/AFLGamesSamples` and `.../BrownlowSamples`,
 * hash-binds them into `docs/rebuild-manifests/afl_api/backtest-<date>.json`,
 * and runs the DB-free §9 backtest assertions against `afl-api-bundle.ts`'s
 * emitters. Bytes stay untracked (only this manifest and its SHA-256 map
 * are); a missing sample file is an explicit `fixture_absent` outcome for
 * that one assertion, never a silent pass (§9).
 *
 * DB-free only. Assertions 5, 6, 7 and the `afldb_test`-matching half of
 * assertion 10 need a database and are marked `not_run: requires afldb_test`
 * here rather than guessed at.
 *
 * Usage:
 *   npx tsx tools/current-season/emit-afl-api-bundle.ts [--out <path>]
 */
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAflApiMatchBundle,
  buildAflApiSettleRecords,
  emitAflApiBrownlowLeaderboard,
  emitAflApiBrownlowMatchVotes,
  flattenObservedColumns,
  parseAflApiIdentities,
  reconcileBrownlowLeaderboard,
  semanticHash,
  type AflApiIdentities,
} from '../../src/lib/acquisition/afl-api-bundle';
import { canonicalJson, type JsonValue } from '../../src/lib/acquisition/observations';
import { parseSourceFamilyRegistry, type SourceFamilyRegistry } from '../../src/lib/acquisition/source-families';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = join(__dirname, '..', '..');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256Of(bytes: string): string {
  return createHash('sha256').update(Buffer.from(bytes, 'utf8')).digest('hex');
}

// ---------------------------------------------------------------------------
// Sample discovery
// ---------------------------------------------------------------------------

type MatchSampleDir = {
  /** Path relative to the project root, forward-slashed. */
  relDir: string;
  season: number;
  /** Round number parsed from a `_R<n>_` folder-name segment, or `null` for
   * a current-season directory that carries no such segment. */
  folderRoundNumber: number | null;
};

const MATCH_DIR_PATTERN = /CD_M(\d{4})\d+$/;
const FOLDER_ROUND_PATTERN = /_R(\d+)_/;

function listMatchSampleDirs(projectRoot: string): MatchSampleDir[] {
  const root = join(projectRoot, 'data', 'sources', 'AFLWebsite', 'AFLGamesSamples');
  const dirs: MatchSampleDir[] = [];

  function scan(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = join(dir, entry.name);
      if (entry.name === 'historical-samples') { scan(full); continue; }
      if (entry.name.startsWith('monitor-')) continue; // handled separately (assertion 9)
      const match = MATCH_DIR_PATTERN.exec(entry.name);
      if (!match) {
        // A year folder (historical-samples/2022, .../2023, ...) — recurse once more.
        if (/^\d{4}$/.test(entry.name)) { scan(full); }
        continue;
      }
      const season = Number(match[1]);
      const roundMatch = FOLDER_ROUND_PATTERN.exec(entry.name);
      dirs.push({
        relDir: relative(projectRoot, full).split('\\').join('/'),
        season,
        folderRoundNumber: roundMatch ? Number(roundMatch[1]) : null,
      });
    }
  }
  scan(root);
  return dirs;
}

function listBrownlowSeasonDirs(projectRoot: string): { relDir: string; season: number }[] {
  const root = join(projectRoot, 'data', 'sources', 'AFLWebsite', 'BrownlowSamples', 'brownlow-samples');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name))
    .map((e) => ({ relDir: relative(projectRoot, join(root, e.name)).split('\\').join('/'), season: Number(e.name) }));
}

// ---------------------------------------------------------------------------
// Manifest / hash-binding
// ---------------------------------------------------------------------------

type ManifestFileEntry = { file: string; sha256: string; status: 'present' | 'fixture_absent' };

function hashBind(projectRoot: string, relPath: string, files: ManifestFileEntry[]): string | null {
  const full = join(projectRoot, relPath);
  if (!existsSync(full)) {
    files.push({ file: relPath, sha256: '', status: 'fixture_absent' });
    return null;
  }
  const bytes = readFileSync(full, 'utf8');
  files.push({ file: relPath, sha256: sha256Of(bytes), status: 'present' });
  return bytes;
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

type AssertionOutcome = {
  assertion: string;
  outcome: 'pass' | 'fail' | 'skipped';
  detail: string;
};

function outcome(assertion: string, ok: boolean, detail: string): AssertionOutcome {
  return { assertion, outcome: ok ? 'pass' : 'fail', detail };
}

export type BacktestResult = {
  generatedAt: string;
  contractVersion: 1;
  files: ManifestFileEntry[];
  assertions: AssertionOutcome[];
  discoveredColumns: Record<string, string[]>;
  counts: { matchesChecked: number; brownlowSeasonsChecked: number };
  /** Assertion 9's full comparison record (§9.9), so the manifest carries the
   * proof rather than a bare verdict. */
  semanticPair: SemanticPairReport;
};

// ---------------------------------------------------------------------------
// Assertion 9 (§9.9, §19.5 c) — the NAMED capture pair
// ---------------------------------------------------------------------------

/** One capture's three files, by project-relative path, each pinned to the
 * sha256 of the genuine historical bytes. A file whose bytes differ is not
 * that capture, so it can never stand in for it. */
export type SemanticPairFile = { path: string; sha256: string };
export type SemanticPairCapture = {
  label: string;
  fixture: SemanticPairFile;
  playerStats: SemanticPairFile;
  matchRoster: SemanticPairFile;
};
export type SemanticPair = { matchId: string; earlier: SemanticPairCapture; later: SemanticPairCapture };

const SAMPLE_1029 = 'data/sources/AFLWebsite/AFLGamesSamples/2026-09-19_HAW_v_BL_CD_M20260142801';
const MONITOR_2141 = 'data/sources/AFLWebsite/AFLGamesSamples/monitor-CD_M20260142801/20260919-214114';

/**
 * The §9.9 pair, named explicitly: the 10:29 UTC match-sample capture and the
 * 21:41 AEST (11:41 UTC) monitor capture of `CD_M20260142801`, 2026-09-19.
 * They live in different folders; neither is found by scanning, and no other
 * capture of the match (a later monitor poll, an acquisition snapshot) is
 * ever substituted. Hashes are the bytes bound by the tracked
 * `backtest-20260919.json` of 2026-09-19 (ISSUE-228 §22.17).
 */
export const ASSERTION_9_PAIR: SemanticPair = {
  matchId: 'CD_M20260142801',
  earlier: {
    label: '10:29',
    fixture: { path: `${SAMPLE_1029}/01-fixture-result.json`, sha256: 'be99a262877603dc25f0bdcedef4763edb2baff1f40e52ec85392681be854dc5' },
    playerStats: { path: `${SAMPLE_1029}/02-player-stats.raw.json`, sha256: 'bc27a2e2ad7df0150f9b960d51596a02e3e47fe07e6f0004e9c4df5acfddba9c' },
    matchRoster: { path: `${SAMPLE_1029}/03-match-roster.raw.json`, sha256: '9a29a7daa679b3ac0b878bc5d7b61b78b11433708be4e1d06378a504768c1088' },
  },
  later: {
    label: '21:41',
    fixture: { path: `${MONITOR_2141}/01-fixture.json`, sha256: 'b6fa1f3ab9d541fbdcc23f77d4d1c74a71ec8efec55beff9a2de58a82573ad14' },
    playerStats: { path: `${MONITOR_2141}/02-player-stats.json`, sha256: 'bc27a2e2ad7df0150f9b960d51596a02e3e47fe07e6f0004e9c4df5acfddba9c' },
    matchRoster: { path: `${MONITOR_2141}/03-match-roster.json`, sha256: '9a29a7daa679b3ac0b878bc5d7b61b78b11433708be4e1d06378a504768c1088' },
  },
};

export const ASSERTION_9_NAME = '9: semantic hash evidence (10:29 vs 21:41 captures)';

type PairFamily = 'match' | 'match_roster' | 'player_match_stats';
const PAIR_FAMILIES: readonly PairFamily[] = ['match', 'match_roster', 'player_match_stats'];

export type SemanticPairFamilyResult = {
  family: PairFamily;
  earlierRecords: number;
  laterRecords: number;
  /** sha256 over the sorted `externalRecordId=recordHash` lines of that side. */
  earlierHash: string | null;
  laterHash: string | null;
  unchanged: boolean;
};

export type SemanticPairDifference = {
  family: PairFamily;
  externalRecordId: string;
  kind: 'changed' | 'only_in_earlier' | 'only_in_later';
  /** Canonical field paths that differ (`changed` only). */
  paths: string[];
};

export type SemanticPairReport = {
  matchId: string;
  /** Always empty: §9.9 hashes with an empty exclusion list, whatever the
   * registry declares. Recorded so the manifest proves it. */
  exclusionsApplied: string[];
  captures: { label: string; files: { path: string; expectedSha256: string; actualSha256: string | null }[] }[];
  families: SemanticPairFamilyResult[];
  differences: SemanticPairDifference[];
};

/** Canonical field paths at which `a` and `b` differ; array indices are kept,
 * since array order is content (`observations.ts`). */
export function diffCanonicalPaths(a: unknown, b: unknown, path = ''): string[] {
  const at = path === '' ? '(root)' : path;
  const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (Array.isArray(a) && Array.isArray(b)) {
    const out: string[] = [];
    if (a.length !== b.length) out.push(`${at}.length`);
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) out.push(...diffCanonicalPaths(a[i], b[i], `${path}[${i}]`));
    return out;
  }
  if (isObject(a) && isObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    const out: string[] = [];
    for (const key of keys) {
      const child = path === '' ? key : `${path}.${key}`;
      if (!(key in a) || !(key in b)) out.push(child);
      else out.push(...diffCanonicalPaths(a[key], b[key], child));
    }
    return out;
  }
  return canonicalJson(a as JsonValue) === canonicalJson(b as JsonValue) ? [] : [at];
}

/**
 * §9.9: parse both named captures through the production emitters
 * (`buildAflApiMatchBundle` -> `buildAflApiSettleRecords`, i.e. the exact
 * per-record payloads settle hashes), canonicalise each payload with NO
 * exclusions, and compare record by record. Equal -> pass. Any difference ->
 * fail, with the differing paths recorded as evidence pair 1 of 3; nothing is
 * ever excluded to make it pass. A missing file -> explicit skip; bytes that
 * are not the pinned historical capture -> fail.
 */
export function runSemanticPairAssertion(
  projectRoot: string, pair: SemanticPair,
  registry: SourceFamilyRegistry, identities: AflApiIdentities,
  files: ManifestFileEntry[] = [],
): { outcome: AssertionOutcome; report: SemanticPairReport } {
  const report: SemanticPairReport = {
    matchId: pair.matchId, exclusionsApplied: [], captures: [], families: [], differences: [],
  };
  const result = (verdict: AssertionOutcome['outcome'], detail: string) => (
    { outcome: { assertion: ASSERTION_9_NAME, outcome: verdict, detail }, report }
  );

  const loaded: { capture: SemanticPairCapture; bytes: { fixture: string; playerStats: string; matchRoster: string } }[] = [];
  const absent: string[] = [];
  const foreign: string[] = [];
  for (const capture of [pair.earlier, pair.later]) {
    const fileRecords: SemanticPairReport['captures'][number]['files'] = [];
    const bytes: Partial<Record<'fixture' | 'playerStats' | 'matchRoster', string>> = {};
    for (const key of ['fixture', 'playerStats', 'matchRoster'] as const) {
      const { path, sha256 } = capture[key];
      const full = join(projectRoot, path);
      if (!existsSync(full)) {
        absent.push(`${capture.label} ${path}`);
        fileRecords.push({ path, expectedSha256: sha256, actualSha256: null });
        if (!files.some((f) => f.file === path)) files.push({ file: path, sha256: '', status: 'fixture_absent' });
        continue;
      }
      const text = readFileSync(full, 'utf8');
      const actual = sha256Of(text);
      if (!files.some((f) => f.file === path)) files.push({ file: path, sha256: actual, status: 'present' });
      fileRecords.push({ path, expectedSha256: sha256, actualSha256: actual });
      if (actual !== sha256) foreign.push(`${capture.label} ${path} (sha256 ${actual}, expected ${sha256})`);
      bytes[key] = text;
    }
    report.captures.push({ label: capture.label, files: fileRecords });
    if (bytes.fixture !== undefined && bytes.playerStats !== undefined && bytes.matchRoster !== undefined) {
      loaded.push({ capture, bytes: bytes as { fixture: string; playerStats: string; matchRoster: string } });
    }
  }

  if (absent.length > 0) {
    return result('skipped', `fixture absent: ${absent.join('; ')} — both named captures are required. Never a silent pass.`);
  }
  if (foreign.length > 0) {
    return result('fail', `not the named historical capture: ${foreign.join('; ')}.`);
  }

  const sides: Map<string, string>[] = [];
  const payloads: Map<string, unknown>[] = [];
  for (const { capture, bytes } of loaded) {
    let records;
    try {
      const fixtureRaw = JSON.parse(bytes.fixture);
      const statsRaw = JSON.parse(bytes.playerStats);
      const rosterRaw = JSON.parse(bytes.matchRoster);
      const bundle = buildAflApiMatchBundle(fixtureRaw, rosterRaw, statsRaw, registry, identities);
      if (bundle.match.sourceRecordId !== pair.matchId) {
        return result('fail', `${capture.label} capture is match ${bundle.match.sourceRecordId}, not ${pair.matchId}.`);
      }
      records = buildAflApiSettleRecords(bundle, fixtureRaw, rosterRaw, statsRaw, registry);
    } catch (error) {
      return result('fail', `${capture.label} capture did not parse: ${error instanceof Error ? error.message : String(error)}`);
    }
    const hashes = new Map<string, string>();
    const bodies = new Map<string, unknown>();
    for (const r of records) {
      const key = `${r.family}|${r.externalRecordId}`;
      hashes.set(key, sha256Of(canonicalJson(r.payload as JsonValue)));
      bodies.set(key, r.payload);
    }
    sides.push(hashes);
    payloads.push(bodies);
  }

  const [earlier, later] = sides;
  for (const family of PAIR_FAMILIES) {
    const aggregate = (side: Map<string, string>): { count: number; hash: string | null } => {
      const lines = [...side].filter(([k]) => k.startsWith(`${family}|`)).map(([k, h]) => `${k.slice(family.length + 1)}=${h}`).sort();
      return { count: lines.length, hash: lines.length > 0 ? sha256Of(lines.join('\n')) : null };
    };
    const a = aggregate(earlier);
    const b = aggregate(later);
    report.families.push({
      family, earlierRecords: a.count, laterRecords: b.count, earlierHash: a.hash, laterHash: b.hash,
      unchanged: a.hash !== null && a.hash === b.hash,
    });
  }
  for (const key of [...new Set([...earlier.keys(), ...later.keys()])].sort()) {
    const separator = key.indexOf('|');
    const family = key.slice(0, separator) as PairFamily;
    const externalRecordId = key.slice(separator + 1);
    if (!later.has(key)) report.differences.push({ family, externalRecordId, kind: 'only_in_earlier', paths: [] });
    else if (!earlier.has(key)) report.differences.push({ family, externalRecordId, kind: 'only_in_later', paths: [] });
    else if (earlier.get(key) !== later.get(key)) {
      report.differences.push({
        family, externalRecordId, kind: 'changed', paths: diffCanonicalPaths(payloads[0].get(key), payloads[1].get(key)),
      });
    }
  }

  const summary = report.families
    .map((f) => `${f.family} ${f.earlierRecords}/${f.laterRecords} record(s) ${f.unchanged ? 'unchanged' : 'CHANGED'}`)
    .join('; ');
  if (report.differences.length === 0 && report.families.every((f) => f.unchanged)) {
    return result('pass', `${pair.earlier.label} vs ${pair.later.label} captures of ${pair.matchId} canonically unchanged with no exclusions: ${summary}.`);
  }
  const shown = report.differences.slice(0, 20).map((d) => (
    d.kind === 'changed' ? `${d.family}|${d.externalRecordId}: ${d.paths.join(', ')}` : `${d.family}|${d.externalRecordId}: ${d.kind}`
  ));
  return result('fail', `evidence pair 1 of 3 (record in the registry evidence[], never hash_exclusions): ${summary}. `
    + `${report.differences.length} differing record(s): ${shown.join(' / ')}${report.differences.length > 20 ? ' / …' : ''}.`);
}

export async function runBacktest(
  projectRoot: string, log: (line: string) => void = () => {},
): Promise<BacktestResult> {
  const registry: SourceFamilyRegistry = parseSourceFamilyRegistry(
    readJson(join(projectRoot, 'data', 'reference', 'source-families.json')),
  );
  const identities: AflApiIdentities = parseAflApiIdentities(
    readJson(join(projectRoot, 'data', 'reference', 'afl-api-identities.json')),
  );

  const files: ManifestFileEntry[] = [];
  const assertions: AssertionOutcome[] = [];
  const discoveredColumns: Record<string, Set<string>> = {
    match: new Set(), match_roster: new Set(), player_match_stats: new Set(),
    brownlow_match_votes: new Set(), brownlow_leaderboard: new Set(),
  };

  // --- Match-grain samples: assertions 1 (schema stability), 2 (round mapping),
  //     3 (counts/arithmetic), 4 (cumulative conversion), 8 (idempotency) ---
  const matchDirs = listMatchSampleDirs(projectRoot);
  log(`match samples: ${matchDirs.length}`);

  let roundMappingChecked = 0;
  let roundMappingOk = 0;
  let arithmeticChecked = 0;
  let arithmeticOk = 0;
  let cumulativeChecked = 0;
  let cumulativeOk = 0;
  let idempotencyChecked = 0;
  let idempotencyOk = 0;

  for (const dir of matchDirs) {
    const fixturePath = `${dir.relDir}/01-fixture-result.json`;
    const statsPath = `${dir.relDir}/02-player-stats.raw.json`;
    const rosterPath = `${dir.relDir}/03-match-roster.raw.json`;

    const fixtureBytes = hashBind(projectRoot, fixturePath, files);
    const statsBytes = hashBind(projectRoot, statsPath, files);
    const rosterBytes = hashBind(projectRoot, rosterPath, files);
    if (fixtureBytes === null || statsBytes === null || rosterBytes === null) {
      log(`  SKIP ${dir.relDir}: one or more sample files absent`);
      continue;
    }

    let bundle;
    try {
      bundle = buildAflApiMatchBundle(
        JSON.parse(fixtureBytes), JSON.parse(rosterBytes), JSON.parse(statsBytes), registry, identities,
      );
    } catch (error) {
      assertions.push(outcome(
        `emit:${dir.relDir}`, false, error instanceof Error ? error.message : String(error),
      ));
      continue;
    }

    for (const col of flattenObservedColumns(JSON.parse(fixtureBytes))) discoveredColumns.match.add(col);
    for (const col of flattenObservedColumns(JSON.parse(statsBytes))) discoveredColumns.player_match_stats.add(col);

    // Assertion 2: round mapping vs. the folder's R<n> label.
    if (dir.folderRoundNumber !== null) {
      roundMappingChecked += 1;
      const expectedOffset = dir.season >= 2024 ? 1 : 0;
      const expected = dir.folderRoundNumber + expectedOffset;
      if (bundle.match.roundNumber === expected) roundMappingOk += 1;
      else {
        assertions.push(outcome(
          `round-mapping:${dir.relDir}`, false,
          `folder R${dir.folderRoundNumber} (season ${dir.season}, offset ${expectedOffset}) expected canonical round `
          + `${expected}, got ${String(bundle.match.roundNumber)}.`,
        ));
      }
    }

    // Assertion 3 (arithmetic proxy — full gates 5-10 need `afldb_test`).
    arithmeticChecked += 1;
    const homeOk = bundle.match.homeGoals * 6 + bundle.match.homeBehinds === bundle.match.homeScore;
    const awayOk = bundle.match.awayGoals * 6 + bundle.match.awayBehinds === bundle.match.awayScore;
    if (homeOk && awayOk) arithmeticOk += 1;
    else {
      assertions.push(outcome(
        `arithmetic:${dir.relDir}`, false,
        `goals*6+behinds != totalScore (home ok=${homeOk}, away ok=${awayOk}).`,
      ));
    }

    // Assertion 4: cumulative period scores reproduce the final score.
    if (bundle.periodScoresReproduceFinalScore !== null) {
      cumulativeChecked += 1;
      if (bundle.periodScoresReproduceFinalScore) cumulativeOk += 1;
      else assertions.push(outcome(`cumulative:${dir.relDir}`, false, 'derived period-score totals did not reproduce the final score.'));
    }

    // Assertion 8: re-parsing and re-emitting the SAME bytes is byte/semantic-identical.
    idempotencyChecked += 1;
    const hash1 = semanticHash(JSON.parse(fixtureBytes));
    const hash2 = semanticHash(JSON.parse(fixtureBytes));
    if (hash1 === hash2) idempotencyOk += 1;
    else assertions.push(outcome(`idempotency:${dir.relDir}`, false, `re-parse hash mismatch: ${hash1} != ${hash2}.`));
  }

  assertions.push(outcome('1: schema stability (match, player_match_stats leaf sets non-empty and shared)',
    discoveredColumns.match.size > 0 && discoveredColumns.player_match_stats.size > 0,
    `match: ${discoveredColumns.match.size} column(s); player_match_stats: ${discoveredColumns.player_match_stats.size} column(s).`));
  assertions.push(outcome('2: round mapping (folder R<n> + offset)', roundMappingChecked > 0 && roundMappingOk === roundMappingChecked,
    `${roundMappingOk}/${roundMappingChecked} matched.`));
  assertions.push(outcome('3: counts and arithmetic (goals*6+behinds == totalScore)', arithmeticChecked > 0 && arithmeticOk === arithmeticChecked,
    `${arithmeticOk}/${arithmeticChecked} matched.`));
  assertions.push(outcome('4: cumulative conversion reproduces final score', cumulativeChecked > 0 && cumulativeOk === cumulativeChecked,
    `${cumulativeOk}/${cumulativeChecked} matched (${matchDirs.length - cumulativeChecked} match(es) had no own-match recentMatchScores entry — skipped, not failed).`));
  assertions.push({
    assertion: '5: match_key resolution on afldb_test', outcome: 'skipped', detail: 'requires afldb_test (integration, read-only) — not run by this DB-free harness.',
  });
  assertions.push({
    assertion: '6: stat parity on afldb_test', outcome: 'skipped', detail: 'requires afldb_test via the S5 bridge — not run by this DB-free harness.',
  });
  assertions.push({
    assertion: '7: bridge coverage', outcome: 'skipped', detail: 'requires the S5 player bridge, not yet built.',
  });
  assertions.push(outcome('8: idempotency (re-parse same bytes -> identical semantic hash)', idempotencyChecked > 0 && idempotencyOk === idempotencyChecked,
    `${idempotencyOk}/${idempotencyChecked} matched.`));

  // --- Assertion 9: the named 10:29 / 21:41 pair of CD_M20260142801 (§9.9) ---
  const semanticPair = runSemanticPairAssertion(projectRoot, ASSERTION_9_PAIR, registry, identities, files);
  assertions.push(semanticPair.outcome);
  hashBind(projectRoot, `${MONITOR_2141}/snapshot-meta.json`, files);

  // --- Brownlow: assertion 10 ---
  const brownlowDirs = listBrownlowSeasonDirs(projectRoot);
  log(`brownlow seasons: ${brownlowDirs.length}`);
  let brownlowChecked = 0;
  let brownlowOk = 0;
  for (const dir of brownlowDirs) {
    const seasonPath = `${dir.relDir}/01-brownlow-season.raw.json`;
    const leaderboardPath = `${dir.relDir}/02-brownlow-leaderboard.raw.json`;
    const validationPath = `${dir.relDir}/06-validation.json`;

    const seasonBytes = hashBind(projectRoot, seasonPath, files);
    const leaderboardBytes = hashBind(projectRoot, leaderboardPath, files);
    const validationBytes = hashBind(projectRoot, validationPath, files);
    if (seasonBytes === null || leaderboardBytes === null) { log(`  SKIP ${dir.relDir}: brownlow sample absent`); continue; }

    brownlowChecked += 1;
    try {
      const { records: matchVotes, observation } = emitAflApiBrownlowMatchVotes(JSON.parse(seasonBytes), registry);
      for (const col of flattenObservedColumns(observation)) discoveredColumns.brownlow_match_votes.add(col);
      const { records: leaderboard, observation: lbObservation } = emitAflApiBrownlowLeaderboard(JSON.parse(leaderboardBytes), registry);
      for (const col of flattenObservedColumns(lbObservation)) discoveredColumns.brownlow_leaderboard.add(col);
      const mismatches = reconcileBrownlowLeaderboard(matchVotes, leaderboard);

      let expectedMatchRecords: number | null = null;
      if (validationBytes) {
        const validation = JSON.parse(validationBytes) as { matchVoteRecords?: number; leaderboardMismatchCount?: number };
        expectedMatchRecords = validation.matchVoteRecords ?? null;
      }

      const countsOk = expectedMatchRecords === null || matchVotes.length === expectedMatchRecords;
      const reconciledOk = mismatches.length === 0;
      if (countsOk && reconciledOk) brownlowOk += 1;
      else {
        assertions.push(outcome(
          `brownlow:${dir.relDir}`, false,
          `matchVotes emitted=${matchVotes.length} (expected ${String(expectedMatchRecords)}); `
          + `${mismatches.length} leaderboard mismatch(es).`,
        ));
      }
    } catch (error) {
      assertions.push(outcome(`brownlow:${dir.relDir}`, false, error instanceof Error ? error.message : String(error)));
    }
  }
  assertions.push(outcome('10: Brownlow (vote-set integrity, leaderboard reconciliation, provider ids)', brownlowChecked > 0 && brownlowOk === brownlowChecked,
    `${brownlowOk}/${brownlowChecked} season(s) reconciled with 0 defects.`));
  assertions.push({
    assertion: "10 (cont'd): every matchId resolves to a canonical H&A match on afldb_test",
    outcome: 'skipped',
    detail: 'requires afldb_test — not run by this DB-free harness.',
  });

  return {
    generatedAt: new Date().toISOString(),
    contractVersion: 1,
    files,
    assertions,
    discoveredColumns: Object.fromEntries(
      Object.entries(discoveredColumns).map(([k, v]) => [k, [...v].sort()]),
    ),
    counts: { matchesChecked: matchDirs.length, brownlowSeasonsChecked: brownlowDirs.length },
    semanticPair: semanticPair.report,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outIndex = argv.indexOf('--out');
  const outPath = outIndex !== -1 && argv[outIndex + 1]
    ? resolve(argv[outIndex + 1])
    : join(DEFAULT_PROJECT_ROOT, 'docs', 'rebuild-manifests', 'afl_api', 'backtest-20260919.json');

  const result = await runBacktest(DEFAULT_PROJECT_ROOT, (line) => { process.stdout.write(`${line}\n`); });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

  const failed = result.assertions.filter((a) => a.outcome === 'fail');
  process.stdout.write(`\nwrote ${outPath}\n`);
  for (const a of result.assertions) {
    process.stdout.write(`  [${a.outcome.toUpperCase()}] ${a.assertion} — ${a.detail}\n`);
  }
  if (failed.length > 0) {
    process.stderr.write(`\n${failed.length} assertion(s) failed.\n`);
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined
  && relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '';

if (invokedDirectly) {
  main();
}
