import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * AFLDB-ISSUE-112 honour-teams slice (§15.4). DB-free parser/validation
 * coverage for tools/migration/honour_teams.py, in the tests/under-22-source
 * mould: every case writes a small variant file and drives the real Python
 * checker as a subprocess — no database, no import_awards.py run.
 */
const repositoryRoot = process.cwd();
const checker = resolve(repositoryRoot, 'tools/migration/honour_teams.py');
const canonicalCsv = resolve(repositoryRoot, 'data/awards/honour-teams.csv');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'afldb-honour-teams-'));
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
// The real manifest has commas inside quoted fields (club lists such as
// "Geelong, West Adelaide"), so a plain split(',') would corrupt those rows.

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

// Column order: source_key,team_name,player,position,role,club,sort_order,
// player_id,link_status,note,source_citation
const COL = {
  sourceKey: 0, teamName: 1, player: 2, position: 3, role: 4, club: 5,
  sortOrder: 6, playerId: 7, linkStatus: 8, note: 9, sourceCitation: 10,
};

// A minimal, self-contained valid row used for negative tests whose error
// fires during per-row validation — before the 113-row completeness check
// ever runs, so these variants deliberately do not need to total 113.
const HEADER =
  'source_key,team_name,player,position,role,club,sort_order,player_id,link_status,note,source_citation';
const VALID_LINKED_ROW =
  'honourteam:greek-team-of-the-century:1,Greek Team of the Century,Test Player,Back,,Test Club,0,1,unique,,wikipedia';
const VALID_UNLINKED_ROW =
  'honourteam:greek-team-of-the-century:1,Greek Team of the Century,Test Player,Back,,Test Club,0,,unmatched,,wikipedia';

describe('canonical honour-teams source (AFLDB-ISSUE-112)', () => {
  it('contains the complete, machine-checkable G0-measured bootstrap', () => {
    const result = runChecker();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.payload).toMatchObject({
      ok: true,
      row_count: 113,
      team_count: 5,
      linked_count: 89,
      unlinked_count: 24,
      rows_per_team: {
        'AFL/VFL Team of the Century': 22,
        'Greek Team of the Century': 20,
        'Indigenous Team of the Century': 24,
        'Italian Team of the Century': 23,
        'Queensland Team of the 20th Century': 24,
      },
    });
  });

  it('preserves representative source rows verbatim, including the explicit link decision', () => {
    const csv = canonicalLines.join('\n');
    // Ted Whitten (id 232 in afldb_dev) — the one row with a
    // player_link_resolutions decision (§15.5 query 3).
    expect(csv).toContain(
      'honourteam:afl-vfl-team-of-the-century:6,AFL/VFL Team of the Century,'
        + 'Ted Whitten,Half back,Captain,Footscray,1,2268,resolved,'
        + '"Ted Whitten (1951-1970, 321g); Ted Whitten (1974-1982, 144g)",wikipedia',
    );
    // An unlinked row (link_status must never carry a player_id).
    expect(csv).toContain(
      'honourteam:indigenous-team-of-the-century:1,Indigenous Team of the Century,'
        + 'Bill Dempsey,Back,,West Perth,0,,unmatched,no player with this name,wikipedia',
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

  it('rejects an unknown team_name', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.teamName, 'Made Up Team of the Century');
    expectRejected([HEADER, row], /unknown team_name/);
  });

  it('rejects an invalid position', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.position, 'Ruck Rover');
    expectRejected([HEADER, row], /invalid position/);
  });

  it('rejects an invalid role', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.role, 'Emergency');
    expectRejected([HEADER, row], /invalid role/);
  });

  it('rejects an invalid link_status', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.linkStatus, 'confirmed');
    expectRejected([HEADER, row], /invalid link_status/);
  });

  it('rejects a source_citation that is not the decided source-granularity value', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.sourceCitation, 'footywire');
    expectRejected([HEADER, row], /source_citation 'footywire' is not an authorised value/);
  });

  it('rejects a source_citation naming a per-row page (no such value is decided)', () => {
    const row = replaceCell(
      VALID_LINKED_ROW,
      COL.sourceCitation,
      'https://en.wikipedia.org/wiki/Team_of_the_Century',
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

  it('rejects a malformed source_key', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.sourceKey, 'greek-team-of-the-century:1');
    expectRejected([HEADER, row], /invalid source_key/);
  });

  it("rejects a source_key whose slug doesn't match team_name", () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.sourceKey, 'honourteam:wrong-slug:1');
    expectRejected([HEADER, row], /source_key slug 'wrong-slug' does not match team_name/);
  });

  it('rejects a source_key seq that skips ahead of the deterministic order', () => {
    const row = replaceCell(VALID_LINKED_ROW, COL.sourceKey, 'honourteam:greek-team-of-the-century:2');
    expectRejected([HEADER, row], /source_key seq 2 is out of sequence/);
  });

  it('rejects a duplicate source_key', () => {
    const second = replaceCell(VALID_LINKED_ROW, COL.player, 'Second Player');
    // Both rows mint the same key; the same-team seq counter would also
    // flag the second occurrence, but the duplicate check fires first.
    expectRejected([HEADER, VALID_LINKED_ROW, second], /duplicate source_key/);
  });

  it('rejects a duplicate natural identity (team_name, player)', () => {
    const first = VALID_LINKED_ROW;
    const second = replaceCell(
      replaceCell(VALID_LINKED_ROW, COL.sourceKey, 'honourteam:greek-team-of-the-century:2'),
      COL.playerId,
      '2',
    );
    expectRejected([HEADER, first, second], /duplicate natural identity/);
  });

  it('rejects a duplicate linked identity (team_name, player_id) under different names', () => {
    const first = VALID_LINKED_ROW;
    const second = replaceCell(
      replaceCell(
        replaceCell(VALID_LINKED_ROW, COL.sourceKey, 'honourteam:greek-team-of-the-century:2'),
        COL.sortOrder,
        '1',
      ),
      COL.player,
      'A Different Name',
    );
    expectRejected([HEADER, first, second], /duplicate linked identity/);
  });

  it('rejects rows out of deterministic order within a team', () => {
    const first = replaceCell(VALID_LINKED_ROW, COL.sortOrder, '1');
    const second = replaceCell(
      replaceCell(
        replaceCell(VALID_LINKED_ROW, COL.sourceKey, 'honourteam:greek-team-of-the-century:2'),
        COL.sortOrder,
        '0',
      ),
      COL.playerId,
      '2',
    );
    expectRejected([HEADER, first, second], /out of deterministic order within/);
  });

  it('rejects team blocks presented out of team_name order', () => {
    const indigenous = replaceCell(VALID_LINKED_ROW, COL.teamName, 'Indigenous Team of the Century');
    const indigenousKeyed = replaceCell(indigenous, COL.sourceKey, 'honourteam:indigenous-team-of-the-century:1');
    const greek = replaceCell(
      replaceCell(VALID_LINKED_ROW, COL.playerId, '2'),
      COL.player,
      'Second Player',
    );
    expectRejected([HEADER, indigenousKeyed, greek], /out of deterministic order \(expected team_name ascending\)/);
  });

  it('rejects a total row count short of the declared 113', () => {
    // Dropping only the final row keeps every remaining row's seq/order
    // valid, so this is guaranteed to reach the completeness check rather
    // than an earlier per-row rule.
    expectRejected(canonicalLines.slice(0, -1), /expected 113 honour-team rows, got 112/);
  });

  it('rejects a team missing from the file entirely', () => {
    const header = canonicalLines[0];
    const withoutGreek = canonicalLines
      .slice(1)
      .filter((line) => !line.includes(',Greek Team of the Century,'));
    expectRejected([header, ...withoutGreek], /expected 113 honour-team rows, got 93/);
  });
});
