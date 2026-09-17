import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * AFLDB-ISSUE-112 closeout (§24). DB-free parser/validation coverage for the
 * Rising Star family's SECOND tracked file,
 * data/awards/rising-star-winners.csv — the 33 `award_winners` rows for the
 * `rising-star` award.
 *
 * These are a different record from the 33 `is_winner` nominations: a
 * different table, a different reload key, and a different provenance
 * (`draftguru`, the legacy award scrape, not FootyWire). They were the LAST
 * winner rows the legacy `awards` group still owned, which is why its
 * `build_winners()` was not the no-op the earlier slices recorded. Excluding
 * them there and loading them here is what makes that reload genuinely match
 * nothing.
 *
 * `validate_family` cross-checks the two files on **player identity**, not
 * name text: the DraftGuru and FootyWire spellings legitimately differ on
 * five of the thirty-three seasons (measured read-only against afldb_dev —
 * player_id and club_id agree on all 33, the raw name on 28).
 */
const repositoryRoot = process.cwd();
const checker = resolve(repositoryRoot, 'tools/migration/rising_star.py');
const canonicalCsv = resolve(repositoryRoot, 'data/awards/rising-star-winners.csv');
const importAwards = resolve(repositoryRoot, 'tools/migration/import_awards.py');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'afldb-rs-winners-'));
const canonicalLines = readFileSync(canonicalCsv, 'utf8').trimEnd().split(/\r?\n/);
let variantNumber = 0;

afterAll(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

type CheckResult = {
  status: number | null;
  payload: Record<string, any>;
  stderr: string;
};

function runChecker(winnersPath?: string): CheckResult {
  const args = [checker];
  if (winnersPath) args.push('--winners', winnersPath);
  const result = spawnSync(python, args, { cwd: repositoryRoot, encoding: 'utf8' });
  if (result.error) throw result.error;
  return {
    status: result.status,
    payload: JSON.parse(result.stdout.trim()),
    stderr: result.stderr,
  };
}

function writeVariant(lines: string[]): string {
  variantNumber += 1;
  const path = join(temporaryDirectory, `variant-${variantNumber}.csv`);
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

function expectRejected(lines: string[], errorPattern: RegExp): void {
  const result = runChecker(writeVariant(lines));
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('');
  expect(result.payload.ok).toBe(false);
  expect(result.payload.error).toEqual(expect.stringMatching(errorPattern));
}

const header = canonicalLines[0].split(',');

function rowIndexForSeason(season: number): number {
  const seasonColumn = header.indexOf('season');
  const index = canonicalLines
    .slice(1)
    .findIndex((line) => line.split(',')[seasonColumn] === String(season));
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

function withCell(rowIndex: number, column: string, value: string): string[] {
  const columnIndex = header.indexOf(column);
  expect(columnIndex).toBeGreaterThanOrEqual(0);
  return canonicalLines.map((line, index) => {
    if (index !== rowIndex + 1) return line;
    const cells = line.split(',');
    cells[columnIndex] = value;
    return cells.join(',');
  });
}

describe('rising-star-winners manifest (AFLDB-ISSUE-112 §24)', () => {
  it('parses the canonical manifest and reports the measured shape', () => {
    const result = runChecker();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.payload.ok).toBe(true);
    expect(result.payload.winner_rows).toMatchObject({
      row_count: 33,
      distinct_seasons: 33,
      season_min: 1993,
      season_max: 2025,
      linked_count: 33,
      votes_present: 29,
      distinct_clubs: 16,
    });
  });

  it('is one winner row per decided season, none for the undecided 2026', () => {
    // The nominations file runs to 2026; the award for that season has not
    // been decided, so it has no winner row and must not acquire one.
    expect(canonicalLines.slice(1)).toHaveLength(33);
    expect(canonicalLines.join('\n')).not.toContain('rising-star:2026');
  });

  it('preserves the database source_record_id verbatim, never re-minted', () => {
    expect(canonicalLines[1].split(',')[0]).toBe('rising-star:1993:937');
    expect(canonicalLines.at(-1)!.split(',')[0]).toBe('rising-star:2025:969');
  });

  it('carries draftguru provenance, not the nominations’ footywire', () => {
    // The reload scope is keyed on source_id: getting this wrong would move
    // the ownership boundary (AFLDB-ISSUE-080).
    for (const line of canonicalLines.slice(1)) {
      expect(line.endsWith(',draftguru')).toBe(true);
    }
  });

  // --- refusals ------------------------------------------------------------

  it('refuses a changed header', () => {
    expectRejected(['source_key,season,club,player,player_id,link_status,votes,'
                    + 'source_citation', ...canonicalLines.slice(1)],
                   /invalid winners header/);
  });

  it('refuses a row with too many columns', () => {
    expectRejected([canonicalLines[0], `${canonicalLines[1]},extra`,
                    ...canonicalLines.slice(2)], /too many columns/);
  });

  it('refuses a missing required field', () => {
    expectRejected(withCell(0, 'player', ''), /player is required/);
  });

  it('refuses a source_key of the wrong shape', () => {
    expectRejected(withCell(0, 'source_key', 'rising-star-1993-937'),
                   /invalid source_key/);
  });

  it('refuses a source_key whose embedded season disagrees with the row', () => {
    expectRejected(withCell(0, 'source_key', 'rising-star:1992:937'),
                   /embeds season 1992 but the row's season is 1993/);
  });

  it('refuses a season outside the decided span', () => {
    expectRejected(withCell(rowIndexForSeason(2025), 'source_key',
                            'rising-star:2026:969')
                     .map((line, index) =>
                       index === rowIndexForSeason(2025) + 1
                         ? line.replace(',2025,', ',2026,') : line),
                   /outside the declared decided range/);
  });

  it('refuses an unknown club', () => {
    expectRejected(withCell(0, 'club', 'Brisbane Bears'), /unknown club/);
  });

  it('refuses an invalid link_status', () => {
    expectRejected(withCell(0, 'link_status', 'probably'), /invalid link_status/);
  });

  it('refuses a linked status with no player_id', () => {
    expectRejected(withCell(0, 'player_id', ''), /requires player_id/);
  });

  it('refuses a non-linked status carrying a player_id', () => {
    expectRejected(withCell(0, 'link_status', 'unmatched'),
                   /must not carry player_id/);
  });

  it('refuses an implausible candidate_count', () => {
    expectRejected(withCell(0, 'candidate_count', '42'),
                   /candidate_count 42 is outside/);
  });

  it('refuses a vote tally before the first season one was recorded', () => {
    expectRejected(withCell(rowIndexForSeason(1993), 'votes', '27.00'),
                   /no vote tally is recorded before 1997/);
  });

  it('refuses a missing vote tally after that season', () => {
    expectRejected(withCell(rowIndexForSeason(1997), 'votes', ''),
                   /must carry the winner's vote tally/);
  });

  it('refuses a vote tally that is not of the measured form', () => {
    expectRejected(withCell(rowIndexForSeason(1997), 'votes', '27'),
                   /not of the measured form/);
  });

  it('refuses the nominations’ footywire provenance on a winner row', () => {
    expectRejected(withCell(0, 'source_citation', 'footywire'),
                   /source_citation 'footywire' must be one of/);
  });

  it('refuses a duplicate source_key', () => {
    expectRejected([canonicalLines[0], canonicalLines[1], canonicalLines[1],
                    ...canonicalLines.slice(2)], /duplicate source_key/);
  });

  it('refuses rows out of deterministic order', () => {
    expectRejected([canonicalLines[0], canonicalLines[2], canonicalLines[1],
                    ...canonicalLines.slice(3)], /out of deterministic order/);
  });

  it('refuses a truncated file rather than loading a partial award history', () => {
    expectRejected(canonicalLines.slice(0, -1),
                   /expected 33 Rising Star winner rows, got 32/);
  });

  it('refuses a winner whose identity disagrees with the winning nomination', () => {
    // The cross-file check is the point: two independently curated files
    // asserting different people won the same season is a curation error, not
    // something to resolve silently at load time.
    expectRejected(withCell(0, 'player_id', '99999'),
                   /the winning nomination resolves to player .* but the winner row/);
  });

  it('accepts a spelling difference between the two sources', () => {
    // Five of the 33 seasons legitimately differ in name text between
    // DraftGuru and FootyWire. Identity, not text, is what must agree.
    const result = runChecker(writeVariant(withCell(0, 'player', 'N. Buckley')));
    expect(result.status).toBe(0);
    expect(result.payload.ok).toBe(true);
  });
});

describe('rising_star owns the last winner rows the legacy group held', () => {
  const source = readFileSync(importAwards, 'utf8');

  it('excludes the rising-star award from the legacy winner reload scope', () => {
    expect(source).toContain(
      'award_ids[slug] for slug in (UNDER_22_SLUG, ALL_AUSTRALIAN_SLUG, COLEMAN_SLUG,');
    expect(source).toContain('RISING_STAR_SLUG)');
  });

  it('loads the winners through the preserved reload key and ownership scope', () => {
    expect(source).toContain('load_rising_star_winners');
    expect(source).toContain('validate_rising_star_family(rows, winner_rows)');
    expect(source).toContain('scopes=[("source_id", [winner_source_id], False)],');
  });

  it('keeps the two halves of the family on their own provenance', () => {
    expect(source).toContain('source_id = require_source(sources, "footywire")');
    expect(source).toContain(
      'winner_source_id = require_source(sources, "draftguru")');
  });
});
