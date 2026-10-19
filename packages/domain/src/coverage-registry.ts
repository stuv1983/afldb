/**
 * AFLDB V2 Stage 3 — the evidence-backed coverage registry (plan D11, ADR 0011,
 * docs/v2/adr/0011-coverage-registry.md; owner instruction "Treat API coverage honestly").
 *
 * For every season and data family it records ONE honest status, and every claim is tied to
 * committed evidence: a stored fixture, a test, a reference file or a document. A season is never
 * labelled API-rebuildable without a stored fixture AND a test; a sealed season is never labelled
 * `api_*` without a stored fixture; an open season can never be `historical_baseline`.
 *
 * Pure: no filesystem, no IO, no database. File contents reach `checkCoverageEvidence` through an
 * injected reader, so the registry can be checked offline and the checker can be tested with
 * synthetic registries. The matrix document docs/v2/coverage-matrix.md is GENERATED from this
 * registry by tools/v2/coverage-matrix.ts and compared with it in tests/v2-coverage-registry.test.ts.
 */
import { isSealedSeason, sealedSeasonsFrom, type SealedSeasons, type SeasonRegistry } from './historical-manifest';

export const COVERAGE_STATUSES = [
  'api_verified',
  'api_partial',
  'historical_baseline',
  'manual_curated',
  'unsupported',
] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

export const COVERAGE_FAMILIES = ['fixtures', 'results', 'match_stats', 'player_stats', 'brownlow'] as const;
export type CoverageFamily = (typeof COVERAGE_FAMILIES)[number];

export const COVERAGE_EVIDENCE_KINDS = ['stored_fixture', 'test', 'reference', 'document'] as const;
export type CoverageEvidenceKind = (typeof COVERAGE_EVIDENCE_KINDS)[number];

export interface CoverageEvidence {
  readonly kind: CoverageEvidenceKind;
  /** Repository-relative POSIX path. */
  readonly path: string;
  /**
   * Verbatim text that must occur in that file. For kind `test` it is the exact test title as
   * written inside `it(`, `test(` or `describe(` (the title starts directly after the quote).
   */
  readonly anchor: string;
}

export interface CoverageEntry {
  readonly family: CoverageFamily;
  readonly from: number;
  readonly through: number;
  readonly status: CoverageStatus;
  readonly evidence: readonly CoverageEvidence[];
  readonly note: string;
}

/** One-line meaning of each status, rendered into the generated matrix. */
export const COVERAGE_STATUS_DEFINITIONS: Readonly<Record<CoverageStatus, string>> = {
  api_verified:
    'The AFL API contract for this family is proven on a stored fixture by a committed test. Both are cited.',
  api_partial:
    'Some of the family is proven on stored fixtures; the note names the limitation. Not API-rebuildable.',
  historical_baseline:
    'Sealed AFLDB history (docs/v2/historical-baseline.md). No committed AFL API fixture and test reproduces it; it is never deleted or rewritten because the API cannot reproduce it.',
  manual_curated:
    'Maintained by a reviewed manual or curated workflow, with evidence. None today (curated awards are Stage 4, plan D8).',
  unsupported:
    'The data does not exist (for example the award was not given) or cannot be supported; the evidence says why.',
};

export const COVERAGE_FAMILY_LABELS: Readonly<Record<CoverageFamily, string>> = {
  fixtures: 'Fixtures (the match schedule and its states)',
  results: 'Results (final scores and match outcome)',
  match_stats: 'Match statistics (team totals and period scores)',
  player_stats: 'Player statistics (per player per match)',
  brownlow: 'Brownlow Medal (season totals, round and match votes)',
};

// ---------------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------------

const fixtureEvidence = (path: string, anchor: string): CoverageEvidence => ({ kind: 'stored_fixture', path, anchor });
const testEvidence = (path: string, anchor: string): CoverageEvidence => ({ kind: 'test', path, anchor });
const referenceEvidence = (path: string, anchor: string): CoverageEvidence => ({ kind: 'reference', path, anchor });
const documentEvidence = (path: string, anchor: string): CoverageEvidence => ({ kind: 'document', path, anchor });

const MATCH_TEST = 'tests/afl-api-match.test.ts';
const COMPSEASONS = 'tests/fixtures/afl_api/seasons/00-compseasons.raw.json';
const FEED_2026 = 'tests/fixtures/afl_api/seasons/00-season-matches-2026.raw.json';
const FEED_2026_ANCHOR = '"providerId":"CD_S2026014","name":"2026 Toyota AFL Premiership"';
const MATCH_FIXTURE = 'tests/fixtures/afl_api/match/01-fixture-result.json';
const STATS_FIXTURE = 'tests/fixtures/afl_api/match/02-player-stats.raw.json';
const ROSTER_FIXTURE = 'tests/fixtures/afl_api/match/03-match-roster.raw.json';
const SCHEDULED_SLICE = 'tests/fixtures/afl_api/match/04-season-feed-scheduled.raw-slice.json';
const UNCONFIRMED_SLICE = 'tests/fixtures/afl_api/match/05-season-feed-unconfirmed-teams.raw-slice.json';
const BROWNLOW_ROUND_FIXTURE = 'tests/fixtures/afl_api/brownlow/01-brownlow-season-round.json';
const BROWNLOW_LEADERBOARD_FIXTURE = 'tests/fixtures/afl_api/brownlow/02-brownlow-leaderboard-sample.json';
const IDENTITIES = 'data/reference/afl-api-identities.json';
const SOURCE_FAMILIES = 'data/reference/source-families.json';
const STAT_AVAILABILITY = 'data/reference/stat-availability.json';

/** Every historical_baseline entry cites the definition of the sealed baseline. */
const BASELINE = documentEvidence('docs/v2/historical-baseline.md', 'The AFL API does not redefine it.');

const BASELINE_NOTE =
  'Sealed AFLDB history held in PostgreSQL. No committed AFL API fixture and test reproduces this season, so it is not API-rebuildable.';

/**
 * The coverage claims. Anything not listed as api_verified or api_partial is NOT API-rebuildable.
 * Update this list, then run `npx tsx tools/v2/coverage-matrix.ts --write`, in the same change.
 */
export const COVERAGE_REGISTRY: readonly CoverageEntry[] = [
  // --- fixtures ---------------------------------------------------------------------------------
  {
    family: 'fixtures', from: 1897, through: 2021, status: 'historical_baseline',
    evidence: [
      BASELINE,
      fixtureEvidence(COMPSEASONS, '"providerId":"CD_S2012014"'),
      fixtureEvidence(COMPSEASONS, '"providerId":"CD_S2021014"'),
    ],
    note: 'Sealed baseline. 2012-2021 appear only in the provider compseasons listing and are unregistered (not in data/reference/afl-api-identities.json, no round vocabulary, no fixture or match snapshot).',
  },
  {
    family: 'fixtures', from: 2022, through: 2025, status: 'historical_baseline',
    evidence: [
      BASELINE,
      referenceEvidence(IDENTITIES, '"2022": { "compSeasonId": 43, "providerId": "CD_S2022014" }'),
      referenceEvidence(IDENTITIES, '"2025": { "compSeasonId": 73, "providerId": "CD_S2025014" }'),
      referenceEvidence(SOURCE_FAMILIES, '"afl_api_2022": {'),
      referenceEvidence(SOURCE_FAMILIES, '"afl_api_2025": {'),
    ],
    note: 'Sealed baseline. The seasons are registered with a round vocabulary declared, but no match or fixture snapshot is committed, so they are not API-verified.',
  },
  {
    family: 'fixtures', from: 2026, through: 2026, status: 'api_partial',
    evidence: [
      fixtureEvidence(FEED_2026, FEED_2026_ANCHOR),
      fixtureEvidence(SCHEDULED_SLICE, '"status":"SCHEDULED"'),
      fixtureEvidence(UNCONFIRMED_SLICE, '"status":"UNCONFIRMED_TEAMS"'),
      testEvidence(MATCH_TEST, 'the real 2026 feed is complete: 218 ids, statuses CONCLUDED 217 and SCHEDULED 1, verbatim'),
      testEvidence(MATCH_TEST, 'AFLDB-ISSUE-229: today\\\'s match contract refuses that real SCHEDULED record as a build failure'),
      testEvidence(MATCH_TEST, 'AFLDB-ISSUE-229: today\\\'s match contract refuses the real UNCONFIRMED_TEAMS record as a build failure'),
    ],
    note: 'Concluded matches only. The stored feed lists 218 matches, but today\'s match contract refuses the SCHEDULED and UNCONFIRMED_TEAMS records (no score block); the pre-match fixture projection is unbuilt (AFLDB-ISSUE-229 B2 open).',
  },

  // --- results ----------------------------------------------------------------------------------
  {
    family: 'results', from: 1897, through: 2025, status: 'historical_baseline',
    evidence: [BASELINE],
    note: BASELINE_NOTE,
  },
  {
    family: 'results', from: 2026, through: 2026, status: 'api_verified',
    evidence: [
      fixtureEvidence(MATCH_FIXTURE, '"providerId": "CD_M20260142801"'),
      fixtureEvidence(FEED_2026, FEED_2026_ANCHOR),
      testEvidence(MATCH_TEST, 'projects the fixture-result sample into a typed match record'),
      testEvidence(MATCH_TEST, 'the real 2026 feed is complete: 218 ids, statuses CONCLUDED 217 and SCHEDULED 1, verbatim'),
    ],
    note: 'Evidence is one concluded match (CD_M20260142801) projected through the match contract from a stored fixture, plus the stored 2026 season feed proven complete (218 entries; 217 CONCLUDED, 1 SCHEDULED).',
  },

  // --- match_stats ------------------------------------------------------------------------------
  {
    family: 'match_stats', from: 1897, through: 2025, status: 'historical_baseline',
    evidence: [BASELINE],
    note: BASELINE_NOTE,
  },
  {
    family: 'match_stats', from: 2026, through: 2026, status: 'api_partial',
    evidence: [
      fixtureEvidence(ROSTER_FIXTURE, '"matchId": "CD_M20260142801"'),
      testEvidence(MATCH_TEST, 'selects the recentMatchScores entry matching the requested match, never entry 0 blindly'),
      testEvidence(MATCH_TEST, 'periodScores is null (never fabricated) when the match is absent from recentMatchScores'),
    ],
    note: 'Period scores only, from the match roster recentMatchScores. No team-totals fixture is committed.',
  },

  // --- player_stats -----------------------------------------------------------------------------
  {
    family: 'player_stats', from: 1897, through: 2025, status: 'historical_baseline',
    evidence: [BASELINE],
    note: BASELINE_NOTE,
  },
  {
    family: 'player_stats', from: 2026, through: 2026, status: 'api_partial',
    evidence: [
      fixtureEvidence(STATS_FIXTURE, '"playerId": "CD_I297354"'),
      testEvidence(MATCH_TEST, 'projects both sides, reading playerStats.player.playerJumperNumber (never the position-bearing copy)'),
      testEvidence(MATCH_TEST, 'the match, player_match_stats and brownlow fixtures project with no undeclared column'),
    ],
    note: 'Limitation: the evidence is one stored player-statistics sample (two sides) projected through the player_match_stats emitter; no whole-season player-statistics capture is committed, and the sample carries no match or season id (the match is paired by the test). Graded api_partial, not api_verified, by the orchestrator (Launch B, plan section 7).',
  },

  // --- brownlow ---------------------------------------------------------------------------------
  {
    family: 'brownlow', from: 1897, through: 1923, status: 'unsupported',
    evidence: [
      referenceEvidence(STAT_AVAILABILITY, '"stat_key": "brownlow_season_total", "coverage": "not_applicable", "first_season": 1897, "last_season": 1923'),
      referenceEvidence(STAT_AVAILABILITY, 'no medal in 1897-1923 and the 1942-1945 war years'),
      documentEvidence('docs/data-dictionary.md', 'scraped from AFL Tables, 1924–2025'),
    ],
    note: 'The Brownlow Medal was not awarded before 1924; nothing to collect.',
  },
  {
    family: 'brownlow', from: 1924, through: 1941, status: 'historical_baseline',
    evidence: [BASELINE, documentEvidence('docs/architecture.md', 'season totals run 1924–2025 bar the war years')],
    note: 'Sealed baseline (season totals). Round votes exist only from 1984 (docs/architecture.md).',
  },
  {
    family: 'brownlow', from: 1942, through: 1945, status: 'unsupported',
    evidence: [
      referenceEvidence(STAT_AVAILABILITY, '"stat_key": "brownlow_season_total", "coverage": "not_applicable", "first_season": 1942, "last_season": 1945'),
      referenceEvidence(STAT_AVAILABILITY, 'no medal in 1897-1923 and the 1942-1945 war years'),
    ],
    note: 'The war years 1942-1945: no medal was awarded; nothing to collect.',
  },
  {
    family: 'brownlow', from: 1946, through: 2025, status: 'historical_baseline',
    evidence: [
      BASELINE,
      documentEvidence('docs/architecture.md', 'season totals run 1924–2025 bar the war years'),
      documentEvidence('docs/acquisition/AFLDB-2026-API-ACQUISITION.md', 'Result (operator-proven COMPLETE, 2026-09-21)'),
    ],
    note: 'Sealed baseline. A 2022-2025 AFL API Brownlow backtest is documented as an operator run, but no committed artefact reproduces it, so those seasons are not API-verified.',
  },
  {
    family: 'brownlow', from: 2026, through: 2026, status: 'api_partial',
    evidence: [
      fixtureEvidence(BROWNLOW_ROUND_FIXTURE, '"seasonId": "CD_S2026014"'),
      fixtureEvidence(BROWNLOW_LEADERBOARD_FIXTURE, '"seasonId": "CD_S2026014"'),
      testEvidence(MATCH_TEST, 'projects a valid one-match, exactly-3-row {3,2,1} vote set'),
      testEvidence(MATCH_TEST, 'reconciles cleanly when match votes and leaderboard totals agree'),
      referenceEvidence(STAT_AVAILABILITY, '"stat_key": "brownlow_season_total", "coverage": "pending"'),
    ],
    note: 'The vote-set and leaderboard contract is tested on stored mid-season samples (status IN_PROGRESS); the 2026 count is not complete (Brownlow pending).',
  },
];

export function coverageFor(
  registry: readonly CoverageEntry[],
  season: number,
  family: CoverageFamily,
): CoverageEntry | null {
  return registry.find((entry) => entry.family === family && season >= entry.from && season <= entry.through) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

const isStatus = (value: unknown): value is CoverageStatus =>
  typeof value === 'string' && (COVERAGE_STATUSES as readonly string[]).includes(value);
const isFamily = (value: unknown): value is CoverageFamily =>
  typeof value === 'string' && (COVERAGE_FAMILIES as readonly string[]).includes(value);
const isEvidenceKind = (value: unknown): value is CoverageEvidenceKind =>
  typeof value === 'string' && (COVERAGE_EVIDENCE_KINDS as readonly string[]).includes(value);

/** Repository-relative POSIX: no drive, no leading slash, no backslash, no empty or dot segments. */
function isRepoRelativePosix(path: unknown): path is string {
  return typeof path === 'string'
    && path.length > 0
    && !path.includes('\\')
    && !path.startsWith('/')
    && !/^[A-Za-z]:/.test(path)
    && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

const labelOf = (entry: CoverageEntry): string => `${String(entry.family)} ${String(entry.from)}-${String(entry.through)}`;

/**
 * Problems with a registry (empty = valid) against the season registry. Per family the entries
 * must cover first_season..last_season exactly once; each status carries its evidence rule.
 */
export function validateCoverageRegistry(registry: readonly CoverageEntry[], seasons: SeasonRegistry): string[] {
  const problems: string[] = [];
  let sealed: SealedSeasons;
  try {
    sealed = sealedSeasonsFrom(seasons);
  } catch (error) {
    return [`season registry: ${error instanceof Error ? error.message : String(error)}`];
  }
  const first = seasons.first_season;
  const last = seasons.last_season;

  for (const entry of registry) {
    const label = labelOf(entry);
    const rangeOk = Number.isInteger(entry.from) && Number.isInteger(entry.through) && entry.from <= entry.through;
    if (!isFamily(entry.family)) problems.push(`${label}: unknown family`);
    if (!isStatus(entry.status)) problems.push(`${label}: unknown status ${String(entry.status)}`);
    if (!rangeOk) problems.push(`${label}: from and through must be integers with from <= through`);
    if (typeof entry.note !== 'string' || entry.note.trim() === '') problems.push(`${label}: a non-empty note is required`);

    const evidence = Array.isArray(entry.evidence) ? entry.evidence : [];
    if (!Array.isArray(entry.evidence)) problems.push(`${label}: evidence must be a list`);
    for (const item of evidence) {
      if (!isEvidenceKind(item.kind)) problems.push(`${label}: unknown evidence kind ${String(item.kind)}`);
      if (!isRepoRelativePosix(item.path)) problems.push(`${label}: evidence path must be repository-relative POSIX: ${String(item.path)}`);
      if (typeof item.anchor !== 'string' || item.anchor === '') problems.push(`${label}: evidence anchor must be non-empty (${String(item.path)})`);
    }
    const count = (kind: CoverageEvidenceKind) => evidence.filter((item) => item.kind === kind).length;

    if (rangeOk && isStatus(entry.status)) {
      const inRange = (test: (season: number) => boolean): number[] => {
        const found: number[] = [];
        for (let season = Math.max(entry.from, first); season <= Math.min(entry.through, last); season += 1) if (test(season)) found.push(season);
        return found;
      };
      const isSealed = (season: number) => isSealedSeason(sealed, season);
      switch (entry.status) {
        case 'api_verified':
          if (count('stored_fixture') < 1) problems.push(`${label}: api_verified requires at least one stored_fixture evidence`);
          if (count('test') < 1) problems.push(`${label}: api_verified requires at least one test evidence`);
          break;
        case 'api_partial':
          if (evidence.length < 1) problems.push(`${label}: api_partial requires at least one evidence`);
          break;
        case 'historical_baseline': {
          const open = inRange((season) => !isSealed(season));
          if (open.length > 0) problems.push(`${label}: historical_baseline is only for sealed seasons; not sealed: ${open.join(', ')}`);
          break;
        }
        case 'manual_curated':
        case 'unsupported':
          if (evidence.length < 1) problems.push(`${label}: ${entry.status} requires at least one evidence`);
          break;
      }
      if ((entry.status === 'api_verified' || entry.status === 'api_partial') && count('stored_fixture') < 1) {
        const sealedHere = inRange(isSealed);
        if (sealedHere.length > 0) {
          problems.push(`${label}: ${entry.status} for sealed season(s) ${sealedHere.join(', ')} requires a stored_fixture evidence`);
        }
      }
    }
  }

  for (const family of COVERAGE_FAMILIES) {
    const entries = registry
      .filter((entry) => entry.family === family && Number.isInteger(entry.from) && Number.isInteger(entry.through) && entry.from <= entry.through)
      .slice()
      .sort((a, b) => a.from - b.from || a.through - b.through);
    let cursor = first;
    for (const entry of entries) {
      if (entry.from < first || entry.through > last) {
        problems.push(`${family} ${entry.from}-${entry.through}: outside the season range ${first}-${last}`);
        continue;
      }
      if (entry.from > cursor) problems.push(`${family}: gap, seasons ${cursor}-${entry.from - 1} have no entry`);
      else if (entry.from < cursor) problems.push(`${family}: overlap, season(s) ${entry.from}-${Math.min(entry.through, cursor - 1)} are covered more than once`);
      cursor = Math.max(cursor, entry.through + 1);
    }
    if (cursor <= last) problems.push(`${family}: gap, seasons ${cursor}-${last} have no entry`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Evidence check
// ---------------------------------------------------------------------------------------------

const TEST_TITLE_OPEN = /\b(?:it|test|describe)(?:\.[A-Za-z]+)*\(\s*$/;

/** Whether the anchor occurs as the start of a quoted title directly inside it(/test(/describe(. */
function anchorIsTestTitle(content: string, anchor: string): boolean {
  let from = 0;
  for (;;) {
    const at = content.indexOf(anchor, from);
    if (at < 0) return false;
    const quote = at > 0 ? content[at - 1] : '';
    if ((quote === '\'' || quote === '"' || quote === '`') && TEST_TITLE_OPEN.test(content.slice(Math.max(0, at - 81), at - 1))) {
      return true;
    }
    from = at + 1;
  }
}

/**
 * Problems found when every evidence file is read: it must exist, contain its anchor verbatim,
 * and, for a test, hold the anchor as a test title. `readFile` returns the file text or null.
 */
export function checkCoverageEvidence(
  registry: readonly CoverageEntry[],
  readFile: (path: string) => string | null,
): string[] {
  const problems: string[] = [];
  const cache = new Map<string, string | null>();
  const read = (path: string): string | null => {
    if (!cache.has(path)) cache.set(path, readFile(path));
    return cache.get(path) ?? null;
  };
  for (const entry of registry) {
    for (const item of entry.evidence) {
      const label = `${labelOf(entry)}: ${item.kind} ${item.path}`;
      const content = read(item.path);
      if (content === null) {
        problems.push(`${label}: evidence file not found`);
      } else if (!content.includes(item.anchor)) {
        problems.push(`${label}: anchor not found: ${item.anchor}`);
      } else if (item.kind === 'test' && !anchorIsTestTitle(content, item.anchor)) {
        problems.push(`${label}: anchor is not a test title (it(/test(/describe( ...): ${item.anchor}`);
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// The generated matrix
// ---------------------------------------------------------------------------------------------

/** A markdown code span whose fence cannot be closed early by backticks in the text. */
function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

const tableCell = (text: string): string => text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');

const KIND_LABEL: Readonly<Record<CoverageEvidenceKind, string>> = {
  stored_fixture: 'fixture',
  test: 'test',
  reference: 'reference',
  document: 'document',
};

const rangeLabel = (entry: CoverageEntry): string => (entry.from === entry.through ? String(entry.from) : `${entry.from}-${entry.through}`);

/** Deterministic markdown for docs/v2/coverage-matrix.md. Ends with exactly one newline. */
export function renderCoverageMatrix(registry: readonly CoverageEntry[], seasons: SeasonRegistry): string {
  const sealed = sealedSeasonsFrom(seasons);
  const totalSeasons = seasons.last_season - seasons.first_season + 1;
  const cells = new Map<CoverageFamily, Map<CoverageStatus, number>>();
  for (const family of COVERAGE_FAMILIES) cells.set(family, new Map(COVERAGE_STATUSES.map((status) => [status, 0] as const)));
  for (const entry of registry) {
    const row = cells.get(entry.family);
    if (row) row.set(entry.status, (row.get(entry.status) ?? 0) + (entry.through - entry.from + 1));
  }
  const cellCount = (family: CoverageFamily, status: CoverageStatus): number => cells.get(family)?.get(status) ?? 0;
  const statusTotal = (status: CoverageStatus): number => COVERAGE_FAMILIES.reduce((sum, family) => sum + cellCount(family, status), 0);

  const out: string[] = [];
  out.push('# AFLDB V2 — API coverage matrix');
  out.push('');
  out.push('> GENERATED by `tools/v2/coverage-matrix.ts` from `packages/domain/src/coverage-registry.ts`. Never hand-edit.');
  out.push('> Change the registry, then run `npx tsx tools/v2/coverage-matrix.ts --write`; `--check` fails when this file is stale.');
  out.push('');
  out.push('Plan decision D11, ADR 0011 (`docs/v2/adr/0011-coverage-registry.md`). Every claim below is tied to a');
  out.push('stored fixture, a test, a reference file or a document, and `tests/v2-coverage-registry.test.ts` proves each');
  out.push('cited file exists and contains its anchor. A season is **API-rebuildable only where it is `api_verified`**;');
  out.push('everything else is not, and no historical record is deleted because the API cannot reproduce it.');
  out.push('');
  out.push(`Seasons covered: ${seasons.first_season}-${seasons.last_season} (${totalSeasons} seasons). `
    + `Sealed: ${sealed.from}-${sealed.through}${sealed.open.length ? ` (open inside the range: ${sealed.open.join(', ')})` : ''}. `
    + `In progress: ${seasons.in_progress_seasons.length ? seasons.in_progress_seasons.join(', ') : 'none'}.`);
  out.push('');
  out.push('## Status definitions');
  out.push('');
  out.push('| Status | Meaning |');
  out.push('|---|---|');
  for (const status of COVERAGE_STATUSES) out.push(`| \`${status}\` | ${tableCell(COVERAGE_STATUS_DEFINITIONS[status])} |`);
  out.push('');
  out.push('## Summary (season-family cells)');
  out.push('');
  out.push(`One cell is one season of one family; ${COVERAGE_FAMILIES.length} families x ${totalSeasons} seasons = ${COVERAGE_FAMILIES.length * totalSeasons} cells.`);
  out.push('');
  out.push(`| Status | ${COVERAGE_FAMILIES.map((family) => `\`${family}\``).join(' | ')} | Total |`);
  out.push(`|---|${COVERAGE_FAMILIES.map(() => '---:').join('|')}|---:|`);
  for (const status of COVERAGE_STATUSES) {
    out.push(`| \`${status}\` | ${COVERAGE_FAMILIES.map((family) => String(cellCount(family, status))).join(' | ')} | ${statusTotal(status)} |`);
  }
  out.push(`| **All** | ${COVERAGE_FAMILIES.map((family) => String(COVERAGE_STATUSES.reduce((sum, status) => sum + cellCount(family, status), 0))).join(' | ')} | ${COVERAGE_STATUSES.reduce((sum, status) => sum + statusTotal(status), 0)} |`);

  for (const family of COVERAGE_FAMILIES) {
    out.push('');
    out.push(`## ${COVERAGE_FAMILY_LABELS[family]}`);
    out.push('');
    out.push(`Family key: \`${family}\`.`);
    out.push('');
    out.push('| Seasons | Status | Evidence | Note |');
    out.push('|---|---|---|---|');
    const entries = registry.filter((entry) => entry.family === family).slice().sort((a, b) => a.from - b.from);
    for (const entry of entries) {
      const evidence = entry.evidence
        .map((item) => `${KIND_LABEL[item.kind]}: ${codeSpan(item.path)} — ${codeSpan(item.anchor)}`)
        .join('<br>');
      out.push(`| ${rangeLabel(entry)} | \`${entry.status}\` | ${tableCell(evidence || '(none)')} | ${tableCell(entry.note)} |`);
    }
  }
  out.push('');
  return out.join('\n');
}
