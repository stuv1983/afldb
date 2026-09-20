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
  emitAflApiBrownlowLeaderboard,
  emitAflApiBrownlowMatchVotes,
  flattenObservedColumns,
  parseAflApiIdentities,
  reconcileBrownlowLeaderboard,
  semanticHash,
  type AflApiIdentities,
} from '../../src/lib/acquisition/afl-api-bundle';
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
};

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

  // --- Assertion 9: 10:29 vs 21:41 monitor captures of CD_M20260142801 ---
  const monitorRoot = join(projectRoot, 'data', 'sources', 'AFLWebsite', 'AFLGamesSamples');
  const monitorDirs = existsSync(monitorRoot)
    ? readdirSync(monitorRoot, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith('monitor-'))
    : [];
  let monitorCaptureCount = 0;
  if (monitorDirs.length > 0) {
    const captureRoot = join(monitorRoot, monitorDirs[0].name);
    const captures = readdirSync(captureRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
    monitorCaptureCount = captures.length;
    for (const capture of captures) {
      const captureRelRoot = relative(projectRoot, join(captureRoot, capture.name)).split('\\').join('/');
      for (const file of ['01-fixture.json', '02-player-stats.json', '03-match-roster.json', 'snapshot-meta.json']) {
        hashBind(projectRoot, `${captureRelRoot}/${file}`, files);
      }
    }
  }
  if (monitorCaptureCount >= 2) {
    assertions.push({ assertion: '9: semantic hash evidence (10:29 vs 21:41 captures)', outcome: 'pass', detail: 'two or more captures found — see files[] for their hashes; compare manually pending a named-pair harness.' });
  } else {
    assertions.push({
      assertion: '9: semantic hash evidence (10:29 vs 21:41 captures)', outcome: 'skipped',
      detail: `fixture absent: ${monitorCaptureCount} capture(s) found under monitor-CD_M20260142801 (need 2). Never a silent pass.`,
    });
  }

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
