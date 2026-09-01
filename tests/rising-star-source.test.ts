import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * AFLDB-ISSUE-112 Rising Star slice (phase 4, §20). DB-free
 * parser/validation coverage for tools/migration/rising_star.py, in the
 * tests/captaincies-source mould: every case writes a small variant file
 * and drives the real Python checker as a subprocess — no database, no
 * import_awards.py run.
 *
 * Like captaincies, Rising Star preserves a stable source_record_id (the
 * manifest source_key, a 24-hex-character digest) and reloads on
 * (source_id, source_record_id); it is not re-minted. `club` / `opponent`
 * are the canonical clubs.name for the era identity and are re-resolved by
 * the loader's season-aware ClubResolver; one row has no club and three
 * have no opponent. `stat_line` is the exact FootyWire statistic object,
 * an integer-valued JSON object whose keys are a subset of STAT_KEYS; the
 * parser rejects malformed or wrongly-shaped JSON rather than coercing it,
 * and never infers a stat_line for the three rows that lack one.
 */
const repositoryRoot = process.cwd();
const checker = resolve(repositoryRoot, 'tools/migration/rising_star.py');
const canonicalCsv = resolve(repositoryRoot, 'data/awards/rising-star.csv');
const importAwards = resolve(repositoryRoot, 'tools/migration/import_awards.py');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'afldb-rising-star-'));
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
// The real manifest has commas and double quotes inside the quoted
// stat_line JSON cell, so a plain split(',') would corrupt those rows.

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

// Column order: source_key,season,round_number,club,opponent,player,
// player_id,link_status,is_winner,is_ineligible,ineligible_reason,votes,
// stat_line,source_citation
const COL = {
  sourceKey: 0, season: 1, roundNumber: 2, club: 3, opponent: 4, player: 5,
  playerId: 6, linkStatus: 7, isWinner: 8, isIneligible: 9,
  ineligibleReason: 10, votes: 11, statLine: 12, sourceCitation: 13,
};

const HEADER =
  'source_key,season,round_number,club,opponent,player,player_id,link_status,'
  + 'is_winner,is_ineligible,ineligible_reason,votes,stat_line,source_citation';

// Minimal, self-contained valid rows for negative tests whose error fires
// during per-row validation — before the 766-row completeness check ever
// runs, so these variants deliberately do not total 766. The source_key is
// a well-formed 24-hex digest; a second row uses a strictly-greater one.
// The stat_line cell carries commas and quotes and must stay CSV-quoted.
const VALID_ROW = stringifyCsvLine([
  '0000000000000000000000aa', '2000', '5', 'Carlton', 'Geelong',
  'Test Player', '1', 'unique', 'false', 'false', '', '',
  '{"goals": 1, "kicks": 10}', 'footywire',
]);
const VALID_ROW_2 = stringifyCsvLine([
  '0000000000000000000000bb', '2001', '6', 'Essendon', 'Hawthorn',
  'Other Player', '2', 'unique', 'false', 'false', '', '',
  '{"goals": 0, "kicks": 8}', 'footywire',
]);

describe('canonical Rising Star source (AFLDB-ISSUE-112 phase 4)', () => {
  it('contains the complete, machine-checkable G0-measured bootstrap', () => {
    const result = runChecker();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.payload).toMatchObject({
      ok: true,
      row_count: 766,
      linked_count: 766,
      unlinked_count: 0,
      season_min: 1993,
      season_max: 2026,
      distinct_seasons: 34,
      winners: 33,
      ineligible: 9,
      stat_line_present: 763,
      null_club: 1,
      null_opponent: 3,
      link_status: { resolved: 87, unique: 679 },
    });
  });

  it('preserves representative source rows verbatim — a winner, an ineligible row, and the null-club / null-opponent rows', () => {
    const csv = canonicalLines.join('\n');
    // The one row with no club (Michael Gardiner, 1997) — still has an
    // opponent and a stat_line.
    expect(csv).toContain(
      '91f274ba89461c84a6b2aeab,1997,19,,St Kilda,Michael Gardiner,1056,resolved,false,false,,,',
    );
    // A row with no opponent and no stat_line (Jake Neade, 2013).
    expect(csv).toContain(
      'eb92521199120b4260861d6f,2013,13,Port Adelaide,,Jake Neade,12151,unique,false,false,,,,footywire',
    );
    // An ineligible row carries its free-text reason and is never a winner.
    expect(csv).toContain(
      '15eaa9831c9699505ff3f6a5,2024,5,West Coast,Richmond,Harley Reid,13111,unique,false,true,'
        + 'Ineligible to win the Rising Star due to suspension.,,',
    );
    // The first row in deterministic (source_key ascending) order.
    expect(csv).toContain(
      '001777a0faa59ba117929aea,1999,4,Melbourne,Hawthorn,Troy Longmuir,543,unique,false,false,,,',
    );
  });

  it('every row is source-granularity footywire provenance, not a page citation', () => {
    for (const line of canonicalLines.slice(1)) {
      const cells = parseCsvLine(line);
      expect(cells[COL.sourceCitation]).toBe('footywire');
    }
  });

  it('carries the source_record_id verbatim as source_key — 24 hex chars, strictly ascending, unique', () => {
    const keys = canonicalLines.slice(1).map((line) => parseCsvLine(line)[COL.sourceKey]);
    expect(keys).toHaveLength(766);
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{24}$/);
    expect(new Set(keys).size).toBe(766);
    expect(keys).toEqual([...keys].sort());
  });

  it('every stat_line in the canonical file is an integer-valued object keyed within STAT_KEYS', () => {
    const STAT_KEYS = new Set([
      'kicks', 'handballs', 'disposals', 'marks', 'goals', 'behinds',
      'tackles', 'hitouts', 'frees_for', 'frees_against', 'supercoach',
      'afl_fantasy',
    ]);
    let present = 0;
    let empty = 0;
    for (const line of canonicalLines.slice(1)) {
      const cell = parseCsvLine(line)[COL.statLine];
      if (cell === '') {
        empty += 1;
        continue;
      }
      present += 1;
      const parsed = JSON.parse(cell) as Record<string, unknown>;
      expect(typeof parsed).toBe('object');
      for (const [key, value] of Object.entries(parsed)) {
        expect(STAT_KEYS.has(key)).toBe(true);
        expect(Number.isInteger(value)).toBe(true);
      }
    }
    expect(present).toBe(763);
    expect(empty).toBe(3);
  });

  it('rejects a malformed header', () => {
    const lines = [...canonicalLines];
    lines[0] = lines[0].replace('source_key', 'record_key');
    expectRejected(lines, /invalid header/);
  });

  it('rejects a source_key that is not a 24-hex digest', () => {
    const row = replaceCell(VALID_ROW, COL.sourceKey, 'risingstar:2000:R5');
    expectRejected([HEADER, row], /invalid source_key 'risingstar:2000:R5'/);
  });

  it('rejects source_key rows out of deterministic (ascending) order', () => {
    const first = replaceCell(VALID_ROW, COL.sourceKey, '0000000000000000000000bb');
    const second = replaceCell(
      replaceCell(VALID_ROW, COL.sourceKey, '0000000000000000000000aa'),
      COL.player, 'Second Player',
    );
    expectRejected([HEADER, first, second], /out of deterministic order/);
  });

  it('rejects a duplicate source_key', () => {
    const second = replaceCell(VALID_ROW, COL.player, 'Different Player');
    expectRejected([HEADER, VALID_ROW, second], /duplicate source_key/);
  });

  it('rejects a duplicate natural identity (season, player)', () => {
    const second = replaceCell(VALID_ROW, COL.sourceKey, '0000000000000000000000bb');
    expectRejected([HEADER, VALID_ROW, second], /duplicate natural identity/);
  });

  it('rejects a season outside the declared coverage', () => {
    const row = replaceCell(VALID_ROW, COL.season, '1980');
    expectRejected([HEADER, row], /season 1980 is outside the declared range 1993-2026/);
  });

  it('rejects a round_number outside the declared 0-24 range', () => {
    const row = replaceCell(VALID_ROW, COL.roundNumber, '30');
    expectRejected([HEADER, row], /round_number 30 is outside the declared range 0-24/);
  });

  it('rejects an unknown club', () => {
    const row = replaceCell(VALID_ROW, COL.club, 'Tasmania');
    expectRejected([HEADER, row], /unknown club 'Tasmania'/);
  });

  it('rejects an unknown opponent', () => {
    const row = replaceCell(VALID_ROW, COL.opponent, 'Tasmania');
    expectRejected([HEADER, row], /unknown opponent 'Tasmania'/);
  });

  it('rejects an invalid link_status', () => {
    const row = replaceCell(VALID_ROW, COL.linkStatus, 'confirmed');
    expectRejected([HEADER, row], /invalid link_status 'confirmed'/);
  });

  it('rejects link_status unique/resolved without a player_id', () => {
    const row = replaceCell(replaceCell(VALID_ROW, COL.linkStatus, 'unique'), COL.playerId, '');
    expectRejected([HEADER, row], /link_status 'unique' requires player_id/);
  });

  it('rejects an unmatched row that still carries a player_id', () => {
    const row = replaceCell(VALID_ROW, COL.linkStatus, 'unmatched');
    expectRejected([HEADER, row], /link_status 'unmatched' must not carry player_id/);
  });

  it('rejects a source_citation that is not the decided source-granularity value', () => {
    const row = replaceCell(VALID_ROW, COL.sourceCitation, 'wikipedia');
    expectRejected([HEADER, row], /source_citation 'wikipedia' is not an authorised value/);
  });

  it('rejects a missing required field (empty round_number)', () => {
    const row = replaceCell(VALID_ROW, COL.roundNumber, '');
    expectRejected([HEADER, row], /round_number is required/);
  });

  it('rejects a player field with leading or trailing whitespace', () => {
    const row = replaceCell(VALID_ROW, COL.player, ' Test Player');
    expectRejected([HEADER, row], /player has leading or trailing whitespace/);
  });

  it('rejects malformed JSON in stat_line', () => {
    const row = replaceCell(VALID_ROW, COL.statLine, '{"goals": 1, "kicks":}');
    expectRejected([HEADER, row], /stat_line is not valid JSON/);
  });

  it('rejects a stat_line that is not a JSON object', () => {
    const row = replaceCell(VALID_ROW, COL.statLine, '[1, 2, 3]');
    expectRejected([HEADER, row], /stat_line must be a JSON object/);
  });

  it('rejects a stat_line with an unknown key', () => {
    const row = replaceCell(VALID_ROW, COL.statLine, '{"goals": 1, "clangers": 3}');
    expectRejected([HEADER, row], /stat_line has unknown key\(s\) \['clangers'\]/);
  });

  it('rejects a stat_line with a non-integer value', () => {
    const row = replaceCell(VALID_ROW, COL.statLine, '{"goals": 1.5}');
    expectRejected([HEADER, row], /stat_line\['goals'\] must be an integer/);
  });

  it('rejects an ineligible row with no reason', () => {
    const row = replaceCell(VALID_ROW, COL.isIneligible, 'true');
    expectRejected([HEADER, row], /is_ineligible is true but ineligible_reason is empty/);
  });

  it('rejects an ineligible_reason on a row that is not flagged ineligible', () => {
    const row = replaceCell(VALID_ROW, COL.ineligibleReason, 'Suspended.');
    expectRejected([HEADER, row], /ineligible_reason is set but is_ineligible is false/);
  });

  it('rejects a votes value (not expected for Rising Star nominations)', () => {
    const row = replaceCell(VALID_ROW, COL.votes, '4');
    expectRejected([HEADER, row], /votes is not expected for Rising Star nominations/);
  });

  it('rejects a row that is both a winner and ineligible', () => {
    const row = replaceCell(
      replaceCell(VALID_ROW, COL.isWinner, 'true'),
      COL.isIneligible, 'true',
    );
    // ineligible_reason is still empty, so the ineligible-reason rule could
    // also fire; supply a reason so the winner/ineligible conflict is what
    // trips.
    const withReason = replaceCell(row, COL.ineligibleReason, 'Suspended.');
    expectRejected([HEADER, withReason], /cannot be both is_winner and is_ineligible/);
  });

  it('rejects a total row count short of the declared 766', () => {
    // Dropping only the final row keeps every remaining row's ordering
    // valid, so this reaches the completeness check rather than an earlier
    // per-row rule.
    expectRejected(canonicalLines.slice(0, -1), /expected 766 Rising Star rows, got 765/);
  });
});

describe('rising_star group is legacy-SQLite-free (AFLDB-ISSUE-112 phase 4)', () => {
  const source = readFileSync(importAwards, 'utf8');

  it('lists rising_star in LEGACY_FREE_GROUPS', () => {
    const block = source.slice(
      source.indexOf('LEGACY_FREE_GROUPS = {'),
      source.indexOf('LEGACY_FREE_GROUPS = {') + 240,
    );
    expect(block).toContain('"rising_star"');
  });

  it('records the rising_star import_batch against footywire provenance', () => {
    expect(source).toContain('"rising_star": "footywire"');
  });

  it('no longer threads a legacy SQLite handle through import_rising_star', () => {
    expect(source).toContain(
      'def import_rising_star(pg, rep: Reporter, batch, clubs: ClubResolver,',
    );
    expect(source).not.toContain('def import_rising_star(pg, lite');
    expect(source).toContain('import_rising_star(pg, rep, batch, clubs, sources,');
  });

  it('no longer forces the legacy awards group as a rising_star prerequisite', () => {
    const block = source.slice(
      source.indexOf('GROUP_REQUIRES = {'),
      source.indexOf('GROUP_REQUIRES = {') + 220,
    );
    expect(block).not.toContain('"rising_star": {"awards"}');
    // The reverse direction stays: a full awards refresh still reloads it.
    expect(block).toContain('"awards": {"all_australian", "under_22", "rising_star", "club_bf", "named_medals"}');
  });
});
