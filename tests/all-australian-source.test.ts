import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * AFLDB-ISSUE-112 All-Australian slice (phase 5, §21). DB-free
 * parser/validation coverage for tools/migration/all_australian.py, in the
 * tests/rising-star-source mould: every case writes a small variant file
 * and drives the real Python checker as a subprocess — no database, no
 * import_awards.py run.
 *
 * All-Australian differs from the earlier slices in three ways worth
 * exercising: it carries TWO provenance sources per family (draftguru 906 /
 * wikipedia 252) that must never be flattened and whose source_citation is
 * per-row source-granularity; it targets award_winners and preserves the
 * database source_record_id verbatim as source_key (aa:<season>:<n> for
 * draftguru, aah:<season>:<...> for wikipedia); and it carries
 * legitimately-duplicated (season, player) rows by design — the 1984
 * carnival club/state dual selections and the 2016 pair of different
 * footballers both named "Josh Kennedy" — so the parser must NOT enforce
 * (season, player) uniqueness while still catching a genuine
 * duplicate-fact under (season, player, club).
 */
const repositoryRoot = process.cwd();
const checker = resolve(repositoryRoot, 'tools/migration/all_australian.py');
const canonicalCsv = resolve(repositoryRoot, 'data/awards/all-australian.csv');
const importAwards = resolve(repositoryRoot, 'tools/migration/import_awards.py');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'afldb-all-australian-'));
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
  const result = spawnSync(python, args, { cwd: repositoryRoot, encoding: 'utf8' });
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

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i <= line.length) {
    let cell = '';
    if (line[i] === '"') {
      i += 1;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') { cell += '"'; i += 2; continue; }
          i += 1;
          break;
        }
        cell += line[i];
        i += 1;
      }
    } else {
      while (i < line.length && line[i] !== ',') { cell += line[i]; i += 1; }
    }
    cells.push(cell);
    if (line[i] === ',') { i += 1; continue; }
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

// Column order: source_key,source,season,club,player,player_id,link_status,
// candidate_count,position,is_captain,is_vice_captain,note,votes,source_citation
const COL = {
  sourceKey: 0, source: 1, season: 2, club: 3, player: 4, playerId: 5,
  linkStatus: 6, candidateCount: 7, position: 8, isCaptain: 9,
  isViceCaptain: 10, note: 11, votes: 12, sourceCitation: 13,
};

const HEADER =
  'source_key,source,season,club,player,player_id,link_status,candidate_count,'
  + 'position,is_captain,is_vice_captain,note,votes,source_citation';

// Minimal, self-contained valid rows for negative tests whose error fires
// during per-row validation — before the 1,158-row completeness check ever
// runs, so these variants deliberately do not total 1,158. One draftguru,
// one wikipedia; the second draftguru key is strictly greater.
const DG_ROW = stringifyCsvLine([
  'aa:2000:1', 'draftguru', '2000', 'Carlton', 'Test Player', '1', 'unique',
  '1', 'C', 'false', 'false', '1 time All-Australian', '', 'draftguru',
]);
const DG_ROW_2 = stringifyCsvLine([
  'aa:2000:2', 'draftguru', '2000', 'Essendon', 'Other Player', '2', 'unique',
  '1', 'W', 'false', 'false', '1 time All-Australian', '', 'draftguru',
]);
const WIKI_ROW = stringifyCsvLine([
  'aah:1970:Test Player:Carlton', 'wikipedia', '1970', 'Carlton',
  'Test Player', '3', 'resolved', '1', '', 'false', 'false', '', '', 'wikipedia',
]);

describe('canonical All-Australian source (AFLDB-ISSUE-112 phase 5)', () => {
  it('contains the complete, machine-checkable G0-measured bootstrap', () => {
    const result = runChecker();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.payload).toMatchObject({
      ok: true,
      row_count: 1158,
      linked_count: 1078,
      unlinked_count: 80,
      season_min: 1953,
      season_max: 2025,
      distinct_seasons: 53,
      by_source: { draftguru: 906, wikipedia: 252 },
      position_present: 760,
      note_present: 906,
      captains: 34,
      vice_captains: 21,
      null_club: 50,
      link_status: {
        ambiguous: 4, implausible: 9, resolved: 918, unique: 160, unmatched: 67,
      },
    });
  });

  it('preserves representative source rows verbatim', () => {
    const csv = canonicalLines.join('\n');
    // First row in deterministic (source_key ascending) order — a draftguru
    // row with no club (one of the 50 pre-1989 rows the detailed table left
    // clubless).
    expect(csv).toContain(
      'aa:1979:1,draftguru,1979,,Brian Peake,2063,resolved,1,,false,false,1 time All-Australian,,draftguru',
    );
    // An unlinked row carries no player_id and an unresolved link_status.
    expect(csv).toContain(
      'aa:1979:13,draftguru,1979,,Kym Hodgeman,,implausible,1,,false,false,1 time All-Australian,,draftguru',
    );
    // The captain of the 1991 team.
    expect(csv).toContain(
      'aa:1991:162,draftguru,1991,Fitzroy,Paul Roos,985,resolved,1,CHB,true,false,4 time All-Australian,,draftguru',
    );
    // A wikipedia carnival-era row: no position, no captaincy, no note.
    expect(csv).toContain(
      'aah:1990:Tony Shaw:Collingwood,wikipedia,1990,Collingwood,Tony Shaw,1166,resolved,1,,false,false,,,wikipedia',
    );
  });

  it('keeps the 1984 club/state dual selections as distinct rows', () => {
    const csv = canonicalLines.join('\n');
    // Ross Glendinning appears once under North Melbourne and once under the
    // WA state side — same player_id, different club, different source_key,
    // the "*" carnival marker preserved inside the wikipedia key.
    expect(csv).toContain(
      'aah:1984:Ross Glendinning:North Melbourne,wikipedia,1984,North Melbourne,Ross Glendinning,1757,resolved,1,,false,false,,,wikipedia',
    );
    expect(csv).toContain(
      'aah:1984:Ross Glendinning*:WA,wikipedia,1984,WA,Ross Glendinning,1757,resolved,1,,false,false,,,wikipedia',
    );
  });

  it('keeps the 2016 Josh Kennedy same-name pair as two distinct footballers', () => {
    const csv = canonicalLines.join('\n');
    expect(csv).toContain(
      'aa:2016:698,draftguru,2016,Sydney,Josh Kennedy,11672,resolved,2,C,false,false,3 time All-Australian,,draftguru',
    );
    expect(csv).toContain(
      'aa:2016:699,draftguru,2016,West Coast,Josh Kennedy,4169,resolved,2,FF,false,false,2 time All-Australian,,draftguru',
    );
  });

  it('has exactly ten legitimately-duplicated (season, player) pairs, all distinguished by club', () => {
    const rows = canonicalLines.slice(1).map(parseCsvLine);
    const byPair = new Map<string, string[]>();
    for (const cells of rows) {
      const pair = `${cells[COL.season]}|${cells[COL.player]}`;
      const clubs = byPair.get(pair) ?? [];
      clubs.push(cells[COL.club]);
      byPair.set(pair, clubs);
    }
    const dupPairs = [...byPair.entries()].filter(([, clubs]) => clubs.length > 1);
    expect(dupPairs).toHaveLength(10);
    // Nine are 1984, one is 2016 (Josh Kennedy).
    expect(dupPairs.filter(([pair]) => pair.startsWith('1984|'))).toHaveLength(9);
    expect(dupPairs.filter(([pair]) => pair.startsWith('2016|'))).toHaveLength(1);
    // Every duplicated pair is fully separated by club.
    for (const [, clubs] of dupPairs) {
      expect(new Set(clubs).size).toBe(clubs.length);
    }
  });

  it('per row: source_citation equals source, and only draftguru/wikipedia appear', () => {
    for (const line of canonicalLines.slice(1)) {
      const cells = parseCsvLine(line);
      expect(['draftguru', 'wikipedia']).toContain(cells[COL.source]);
      expect(cells[COL.sourceCitation]).toBe(cells[COL.source]);
    }
  });

  it('carries the source_record_id verbatim as source_key — prefixed per source, strictly ascending, unique', () => {
    const rows = canonicalLines.slice(1).map(parseCsvLine);
    const keys = rows.map((cells) => cells[COL.sourceKey]);
    expect(keys).toHaveLength(1158);
    expect(new Set(keys).size).toBe(1158);
    expect(keys).toEqual([...keys].sort());
    for (const cells of rows) {
      const key = cells[COL.sourceKey];
      if (cells[COL.source] === 'draftguru') {
        expect(key).toMatch(/^aa:\d{4}:\d+$/);
      } else {
        expect(key).toMatch(/^aah:\d{4}:.+$/);
      }
      expect(key.match(/^aa[h]?:(\d{4}):/)![1]).toBe(cells[COL.season]);
    }
  });

  it('position, captaincy and the "N time" note are draftguru-only', () => {
    for (const line of canonicalLines.slice(1)) {
      const cells = parseCsvLine(line);
      const isDraftguru = cells[COL.source] === 'draftguru';
      if (cells[COL.position] !== '') expect(isDraftguru).toBe(true);
      if (cells[COL.isCaptain] === 'true' || cells[COL.isViceCaptain] === 'true') {
        expect(isDraftguru).toBe(true);
      }
      if (isDraftguru) {
        expect(cells[COL.note]).toMatch(/^[1-9][0-9]* time All-Australian$/);
      } else {
        expect(cells[COL.note]).toBe('');
      }
      expect(cells[COL.votes]).toBe('');
    }
  });

  it('rejects a malformed header', () => {
    const lines = [...canonicalLines];
    lines[0] = lines[0].replace('source_key', 'record_key');
    expectRejected(lines, /invalid header/);
  });

  it('rejects an unknown source value', () => {
    const row = replaceCell(
      replaceCell(DG_ROW, COL.source, 'wikipedia_aa'),
      COL.sourceCitation, 'wikipedia_aa',
    );
    expectRejected([HEADER, row], /unknown source 'wikipedia_aa'/);
  });

  it('rejects a source_citation that does not equal the row source', () => {
    const row = replaceCell(DG_ROW, COL.sourceCitation, 'wikipedia');
    expectRejected([HEADER, row], /source_citation 'wikipedia' must equal the row's source 'draftguru'/);
  });

  it('rejects a draftguru source_key that is not aa:<season>:<n>', () => {
    const row = replaceCell(DG_ROW, COL.sourceKey, 'allaustralian:2000:1:2');
    expectRejected([HEADER, row], /invalid source_key 'allaustralian:2000:1:2' for source 'draftguru'/);
  });

  it("rejects a source_key whose embedded season disagrees with the row's season", () => {
    const row = replaceCell(DG_ROW, COL.sourceKey, 'aa:1999:1');
    expectRejected([HEADER, row], /embeds season 1999 but the row's season is 2000/);
  });

  it('rejects a wikipedia row carrying an aa: draftguru key', () => {
    const row = replaceCell(WIKI_ROW, COL.sourceKey, 'aa:1970:5');
    expectRejected([HEADER, row], /invalid source_key 'aa:1970:5' for source 'wikipedia'/);
  });

  it('rejects source_key rows out of deterministic (ascending) order', () => {
    const second = replaceCell(DG_ROW_2, COL.sourceKey, 'aa:2000:0');
    expectRejected([HEADER, DG_ROW, second], /out of deterministic order/);
  });

  it('rejects a duplicate source_key', () => {
    const dup = replaceCell(DG_ROW, COL.player, 'Different Name');
    expectRejected([HEADER, DG_ROW, dup], /duplicate source_key 'aa:2000:1'/);
  });

  it('rejects a duplicate (season, player, club) natural identity', () => {
    const twin = replaceCell(DG_ROW_2, COL.player, 'Test Player');
    // Same season + player + club as DG_ROW, different source_key.
    const collide = replaceCell(twin, COL.club, 'Carlton');
    expectRejected([HEADER, DG_ROW, collide], /duplicate natural identity \(season, player, club\)/);
  });

  it('does NOT reject a (season, player) pair that differs by club', () => {
    // Two rows, same season + player, different club — the Josh Kennedy /
    // 1984 shape. This passes per-row validation; it only fails the
    // 1,158-row completeness gate, proving the natural-key guard let it by.
    const kennedyA = DG_ROW; // aa:2000:1 Carlton Test Player
    const kennedyB = replaceCell(DG_ROW_2, COL.player, 'Test Player'); // aa:2000:2 Essendon Test Player
    const result = runChecker(writeVariant([HEADER, kennedyA, kennedyB]));
    expect(result.payload.ok).toBe(false);
    expect(result.payload.error).toEqual(expect.stringMatching(/expected 1158 All-Australian rows/));
    expect(result.payload.error).not.toEqual(expect.stringMatching(/duplicate natural identity/));
  });

  it('rejects a season outside the declared 1953-2025 range', () => {
    const row = replaceCell(replaceCell(DG_ROW, COL.season, '2030'), COL.sourceKey, 'aa:2030:1');
    expectRejected([HEADER, row], /season 2030 is outside the declared range 1953-2025/);
  });

  it('rejects an unknown club', () => {
    const row = replaceCell(DG_ROW, COL.club, 'Barcelona');
    expectRejected([HEADER, row], /unknown club 'Barcelona'/);
  });

  it('rejects an invalid link_status', () => {
    const row = replaceCell(DG_ROW, COL.linkStatus, 'guessed');
    expectRejected([HEADER, row], /invalid link_status 'guessed'/);
  });

  it('rejects a linked status with no player_id', () => {
    const row = replaceCell(DG_ROW, COL.playerId, '');
    expectRejected([HEADER, row], /link_status 'unique' requires player_id/);
  });

  it('rejects a non-linked status that carries a player_id', () => {
    const row = replaceCell(DG_ROW, COL.linkStatus, 'unmatched');
    expectRejected([HEADER, row], /link_status 'unmatched' must not carry player_id/);
  });

  it('rejects a candidate_count outside the plausible range', () => {
    const row = replaceCell(DG_ROW, COL.candidateCount, '42');
    expectRejected([HEADER, row], /candidate_count 42 is outside the plausible range/);
  });

  it('rejects a position on a wikipedia row', () => {
    const row = replaceCell(WIKI_ROW, COL.position, 'FF');
    expectRejected([HEADER, row], /position 'FF' on a 'wikipedia' row/);
  });

  it('rejects an unknown position on a draftguru row', () => {
    const row = replaceCell(DG_ROW, COL.position, 'QB');
    expectRejected([HEADER, row], /unknown position 'QB'/);
  });

  it('rejects a captaincy flag on a wikipedia row', () => {
    const row = replaceCell(WIKI_ROW, COL.isCaptain, 'true');
    expectRejected([HEADER, row], /captaincy flag on a 'wikipedia' row/);
  });

  it('rejects a row that is both captain and vice-captain', () => {
    const row = replaceCell(replaceCell(DG_ROW, COL.isCaptain, 'true'), COL.isViceCaptain, 'true');
    expectRejected([HEADER, row], /cannot be both is_captain and is_vice_captain/);
  });

  it('rejects a draftguru row with no note', () => {
    const row = replaceCell(DG_ROW, COL.note, '');
    expectRejected([HEADER, row], /a draftguru row must carry a 'N time All-Australian' note/);
  });

  it('rejects a draftguru note that is not of the "N time" form', () => {
    const row = replaceCell(DG_ROW, COL.note, 'best on ground');
    expectRejected([HEADER, row], /note 'best on ground' is not of the form 'N time All-Australian'/);
  });

  it('rejects a wikipedia row that carries a note', () => {
    const row = replaceCell(WIKI_ROW, COL.note, '1 time All-Australian');
    expectRejected([HEADER, row], /a 'wikipedia' row must not carry a note/);
  });

  it('rejects a votes value', () => {
    const row = replaceCell(DG_ROW, COL.votes, '7');
    expectRejected([HEADER, row], /votes is not expected for All-Australian selections/);
  });

  it('rejects a truncated file (row count short of 1,158)', () => {
    expectRejected([HEADER, DG_ROW, DG_ROW_2, WIKI_ROW], /expected 1158 All-Australian rows, got 3/);
  });

  it('rejects a file whose source split is wrong', () => {
    // Flip one canonical wikipedia row to draftguru — count stays 1,158 but
    // the 906/252 split breaks (and the aah: key no longer matches the source).
    const lines = [...canonicalLines];
    const idx = lines.findIndex((line) => line.startsWith('aah:1990:Tony Shaw'));
    lines[idx] = replaceCell(replaceCell(lines[idx], COL.source, 'draftguru'), COL.sourceCitation, 'draftguru');
    expectRejected(lines, /invalid source_key 'aah:1990:Tony Shaw:Collingwood' for source 'draftguru'/);
  });
});

describe('all_australian group is legacy-SQLite-free (AFLDB-ISSUE-112 phase 5)', () => {
  const source = readFileSync(importAwards, 'utf8');

  it('lists all_australian in LEGACY_FREE_GROUPS', () => {
    const block = source.slice(
      source.indexOf('LEGACY_FREE_GROUPS = {'),
      source.indexOf('LEGACY_FREE_GROUPS = {') + 200,
    );
    expect(block).toContain('"all_australian"');
  });

  it('records the all_australian import_batch against draftguru, its majority source', () => {
    expect(source).toContain('"all_australian": "draftguru"');
  });

  it('no longer threads a legacy SQLite handle or person_links through import_all_australian', () => {
    expect(source).toContain(
      'def import_all_australian(pg, rep: Reporter, batch, clubs: ClubResolver,',
    );
    expect(source).not.toContain('def import_all_australian(pg, lite');
    expect(source).toContain('import_all_australian(pg, rep, batch, clubs, sources,');
    expect(source).toContain('rows = load_all_australian()');
  });

  it('no longer forces the legacy awards group as an all_australian prerequisite', () => {
    const block = source.slice(
      source.indexOf('GROUP_REQUIRES = {'),
      source.indexOf('GROUP_REQUIRES = {') + 220,
    );
    expect(block).not.toContain('"all_australian": {"awards"}');
    // The reverse direction stays: a full awards refresh still reloads it.
    expect(block).toContain('"awards": {"all_australian", "under_22", "rising_star"}');
  });

  it('keeps a fail-loud guard for the missing award definition', () => {
    expect(source).toContain(
      'the all-australian award definition is missing; ',
    );
  });

  it('keeps the reload key, column list and ownership scope byte-identical', () => {
    const body = source.slice(
      source.indexOf('def import_all_australian('),
      source.indexOf('def import_all_australian(') + 6000,
    );
    expect(body).toContain('pg, "award_winners", ["source_id", "source_record_id"]');
    expect(body).toContain('scope_column="award_id", scope_values=[award_id]');
    expect(body).toContain('scopes=[("source_id", [draftguru_id, wikipedia_id], False)]');
  });
});
