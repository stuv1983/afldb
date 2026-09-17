import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * AFLDB-ISSUE-112 Hall of Fame slice (phase 2, §18). DB-free
 * parser/validation coverage for tools/migration/hall_of_fame.py, in the
 * tests/honour-teams-source mould: every case writes a small variant file
 * and drives the real Python checker as a subprocess — no database, no
 * import_awards.py run.
 */
const repositoryRoot = process.cwd();
const checker = resolve(repositoryRoot, 'tools/migration/hall_of_fame.py');
const canonicalCsv = resolve(repositoryRoot, 'data/awards/hall-of-fame.csv');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'afldb-hall-of-fame-'));
const canonicalLines = readFileSync(canonicalCsv, 'utf8').trimEnd().split(/\r?\n/);
let variantNumber = 0;

afterAll(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

type CheckResult = {
  status: number | null;
  payload: Record<string, unknown>;
  stderr: string;
};

function runChecker(csvPath?: string): CheckResult {
  const args = [checker];
  if (csvPath) args.push('--csv', csvPath);
  const result = spawnSync(python, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    payload: JSON.parse(result.stdout.trim()) as Record<string, unknown>,
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

// --- Quote-aware CSV cell helpers -----------------------------------------
// The real manifest has commas inside quoted fields (career spans such as
// "1920-1928, 1929", club lists, note lines), so a plain split(',') would
// corrupt those rows.

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i <= line.length) {
    let cell = '';
    if (line[i] === '"') {
      i += 1;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            cell += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        cell += line[i];
        i += 1;
      }
    } else {
      while (i < line.length && line[i] !== ',') {
        cell += line[i];
        i += 1;
      }
    }
    cells.push(cell);
    if (line[i] === ',') {
      i += 1;
      continue;
    }
    break;
  }
  return cells;
}

function quoteCsvCell(value: string): string {
  return /["\n,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function stringifyCsvLine(cells: string[]): string {
  return cells.map(quoteCsvCell).join(',');
}

function replaceCell(line: string, index: number, value: string): string {
  const cells = parseCsvLine(line);
  cells[index] = value;
  return stringifyCsvLine(cells);
}

// Column order: source_key,name,inducted_year,category,is_legend,legend_year,
// club,state,playing_career,removed_year,player_id,link_status,note,source_citation
const COL = {
  sourceKey: 0, name: 1, inductedYear: 2, category: 3, isLegend: 4,
  legendYear: 5, club: 6, state: 7, playingCareer: 8, removedYear: 9,
  playerId: 10, linkStatus: 11, note: 12, sourceCitation: 13,
};

const HEADER = canonicalLines[0];

// Minimal, self-contained valid rows for negative tests whose error fires
// during per-row validation — before the 343-row completeness check ever
// runs, so these variants deliberately do not total 343.
const VALID_LINKED_ROW =
  'hof:1,Test Person,1996,player,false,,Test Club,Victoria,1990-2000,,1,unique,,wikipedia';
const VALID_UNLINKED_ROW =
  'hof:1,Test Person,1996,player,false,,,,,,,unmatched,no player with this name,wikipedia';

describe('canonical Hall of Fame source (AFLDB-ISSUE-112 phase 2)', () => {
  it('contains the complete, machine-checkable G0-measured bootstrap', () => {
    const result = runChecker();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.payload).toMatchObject({
      ok: true,
      row_count: 343,
      legend_count: 34,
      linked_count: 246,
      unlinked_count: 97,
      null_inducted_year_count: 45,
      inducted_year_min: 1996,
      inducted_year_max: 2026,
      categories: {
        administrator: 16, coach: 13, legend: 3, media: 11,
        pioneer: 7, player: 276, removed: 2, umpire: 15,
      },
    });
  });

  it('preserves representative source rows verbatim, including the explicit link decisions', () => {
    const csv = canonicalLines.join('\n');
    // John Kennedy Sr — one of the five hall_of_fame player_link_resolutions
    // decisions (§18 extraction, all action='linked', player 1893). The
    // dated coaching row and the undated Legend row are two distinct
    // natural keys for the same person; both must round-trip.
    expect(csv).toContain(
      'hof:64,John Kennedy Sr,1996,coach,false,,Hawthorn | North Melbourne,,,,'
        + '1893,resolved,John Kennedy (1979-1991); John Kennedy (1950-1959),wikipedia',
    );
    expect(csv).toContain(
      'hof:327,John Kennedy Sr.,,legend,true,2020,,,,,'
        + '1893,resolved,John Kennedy (1979-1991); John Kennedy (1950-1959),wikipedia',
    );
    // An undated (NULL inducted_year), name-only row — link_status must
    // never carry a player_id.
    expect(csv).toContain(
      'hof:299,Alf Brown,,media,false,,"print, Victoria",,,,,'
        + 'unmatched,no player with this name,wikipedia',
    );
  });

  it('every row is source-granularity wikipedia provenance, not a page citation', () => {
    for (const line of canonicalLines.slice(1)) {
      const cells = parseCsvLine(line);
      expect(cells[COL.sourceCitation]).toBe('wikipedia');
    }
  });

  it('rejects a malformed header', () => {
    const lines = [...canonicalLines];
    lines[0] = lines[0].replace('source_key', 'record_key');
    expectRejected(lines, /invalid header/);
  });

  it('rejects an unknown category', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.category, 'trainer');
    expectRejected([HEADER, row], /unknown category 'trainer'/);
  });

  it('rejects an invalid link_status', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.linkStatus, 'confirmed');
    expectRejected([HEADER, row], /invalid link_status 'confirmed'/);
  });

  it('rejects an is_legend value that is not true or false', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.isLegend, 'yes');
    expectRejected([HEADER, row], /is_legend must be 'true' or 'false'/);
  });

  it('rejects a source_citation that is not the decided source-granularity value', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.sourceCitation, 'footywire');
    expectRejected([HEADER, row], /source_citation 'footywire' is not an authorised value/);
  });

  it('rejects a source_citation naming a per-row page (no such value is decided)', () => {
    const row = replaceCell(
      VALID_LINKED_ROW,
      COL.sourceCitation,
      'https://en.wikipedia.org/wiki/Australian_Football_Hall_of_Fame',
    );
    expectRejected([HEADER, row], /source_citation .* is not an authorised value/);
  });

  it('rejects link_status unique/resolved without a player_id', () => {
    const row = replaceCell(VALID_UNLINKED_ROW, COL.linkStatus, 'unique');
    expectRejected([HEADER, row], /link_status 'unique' requires player_id/);
  });

  it('rejects an ambiguous/unmatched/implausible row that still carries a player_id', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.linkStatus, 'ambiguous');
    expectRejected([HEADER, row], /link_status 'ambiguous' must not carry player_id/);
  });

  it('rejects is_legend true with no legend_year', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.isLegend, 'true');
    expectRejected([HEADER, row], /is_legend is true but legend_year is empty/);
  });

  it('rejects a legend_year set while is_legend is false', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.legendYear, '2005');
    expectRejected([HEADER, row], /legend_year 2005 is set but is_legend is false/);
  });

  it('rejects a removed_year without category=removed', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.removedYear, '2020');
    expectRejected([HEADER, row], /removed_year and category='removed' must agree/);
  });

  it('rejects category=removed without a removed_year', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.category, 'removed');
    expectRejected([HEADER, row], /removed_year and category='removed' must agree/);
  });

  it('rejects an inducted_year outside the declared coverage', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.inductedYear, '1900');
    expectRejected([HEADER, row], /inducted_year 1900 is outside the declared range 1996-2026/);
  });

  it('rejects a malformed source_key', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.sourceKey, 'hof-1');
    expectRejected([HEADER, row], /invalid source_key 'hof-1'/);
  });

  it('rejects a source_key seq that skips ahead of the deterministic order', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.sourceKey, 'hof:2');
    expectRejected([HEADER, row], /source_key seq 2 is out of sequence \(expected 1\)/);
  });

  it('rejects a duplicate source_key', () => {
    const second = replaceCell(
      replaceCell(VALID_LINKED_ROW, COL.name, 'Zzz Later'),
      COL.playerId,
      '2',
    );
    // Both rows mint hof:1; the running seq counter would also flag the
    // second occurrence, but the duplicate check fires first.
    expectRejected([HEADER, VALID_LINKED_ROW, second], /duplicate source_key 'hof:1'/);
  });

  it('rejects a duplicate natural identity (name, inducted_year)', () => {
    const first = VALID_LINKED_ROW;
    const second = replaceCell(
      replaceCell(VALID_LINKED_ROW, COL.sourceKey, 'hof:2'),
      COL.playerId,
      '2',
    );
    expectRejected([HEADER, first, second], /duplicate natural identity/);
  });

  it('rejects rows out of deterministic name order within an inducted_year', () => {
    const first = replaceCell(VALID_LINKED_ROW, COL.name, 'Bravo Person');
    const second = replaceCell(
      replaceCell(
        replaceCell(VALID_LINKED_ROW, COL.sourceKey, 'hof:2'),
        COL.name,
        'Alpha Person',
      ),
      COL.playerId,
      '2',
    );
    expectRejected([HEADER, first, second], /out of deterministic order within inducted_year 1996/);
  });

  it('rejects a dated row that follows an undated row', () => {
    const undated = replaceCell(VALID_UNLINKED_ROW, COL.inductedYear, '');
    const dated = replaceCell(
      replaceCell(
        replaceCell(VALID_LINKED_ROW, COL.sourceKey, 'hof:2'),
        COL.name,
        'Zzz Later',
      ),
      COL.playerId,
      '2',
    );
    expectRejected([HEADER, undated, dated], /a dated row follows an undated row/);
  });

  it('rejects inducted_year running backwards across groups', () => {
    const later = replaceCell(VALID_LINKED_ROW, COL.inductedYear, '2000');
    const earlier = replaceCell(
      replaceCell(
        replaceCell(VALID_LINKED_ROW, COL.sourceKey, 'hof:2'),
        COL.inductedYear,
        '1996',
      ),
      COL.playerId,
      '2',
    );
    expectRejected([HEADER, later, earlier], /inducted_year 1996 is out of order/);
  });

  it('rejects a total row count short of the declared 343', () => {
    // Dropping only the final row keeps every remaining row's seq/order
    // valid, so this reaches the completeness check rather than an earlier
    // per-row rule.
    expectRejected(canonicalLines.slice(0, -1), /expected 343 Hall of Fame rows, got 342/);
  });
});
