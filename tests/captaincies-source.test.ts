import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * AFLDB-ISSUE-112 captaincies slice (phase 3, §19). DB-free
 * parser/validation coverage for tools/migration/captaincies.py, in the
 * tests/hall-of-fame-source mould: every case writes a small variant file
 * and drives the real Python checker as a subprocess — no database, no
 * import_awards.py run.
 *
 * Unlike the honour-teams and Hall of Fame slices, captaincies preserves a
 * stable source_record_id (the manifest source_key, a 24-hex-character
 * digest) and reloads on (source_id, source_record_id); it is not
 * re-minted. `club` is the canonical clubs.name for the era identity and is
 * re-resolved by the loader's season-aware ClubResolver.
 */
const repositoryRoot = process.cwd();
const checker = resolve(repositoryRoot, 'tools/migration/captaincies.py');
const canonicalCsv = resolve(repositoryRoot, 'data/awards/captaincies.csv');
const importAwards = resolve(repositoryRoot, 'tools/migration/import_awards.py');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'afldb-captaincies-'));
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
// The real manifest has commas inside quoted note fields ("1942, 1946, 1949
// and 1950 premiership captain"), so a plain split(',') would corrupt those
// rows.

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

// Column order: source_key,season,club,player,player_id,link_status,role,
// period,note,source_citation
const COL = {
  sourceKey: 0, season: 1, club: 2, player: 3, playerId: 4, linkStatus: 5,
  role: 6, period: 7, note: 8, sourceCitation: 9,
};

const HEADER =
  'source_key,season,club,player,player_id,link_status,role,period,note,source_citation';

// Minimal, self-contained valid rows for negative tests whose error fires
// during per-row validation — before the 1,375-row completeness check ever
// runs, so these variants deliberately do not total 1,375. The source_key
// is a well-formed 24-hex digest; a second row uses a strictly-greater one.
const VALID_ROW =
  '0000000000000000000000aa,2000,Carlton,Test Captain,1,unique,Captain,1999-2001,,wikipedia';
const VALID_ROW_2 =
  '0000000000000000000000bb,2001,Essendon,Other Captain,2,unique,Captain,2001-2002,,wikipedia';

describe('canonical captaincies source (AFLDB-ISSUE-112 phase 3)', () => {
  it('contains the complete, machine-checkable G0-measured bootstrap', () => {
    const result = runChecker();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.payload).toMatchObject({
      ok: true,
      row_count: 1375,
      linked_count: 1375,
      unlinked_count: 0,
      season_min: 1897,
      season_max: 2026,
      distinct_seasons: 130,
      distinct_clubs: 18,
      notes_present: 178,
      roles: { Captain: 1375 },
    });
  });

  it('preserves representative source rows verbatim, including a resolved link and a quoted note', () => {
    const csv = canonicalLines.join('\n');
    // A resolved link_status row that also carries a note.
    expect(csv).toContain(
      '066e8905ca84a59c1efd8e65,1939,Richmond,Percy Bentley,2546,resolved,Captain,'
        + '1932–1940,1932 Premiership Captain1934 Premiership Captain,wikipedia',
    );
    // A note containing commas — must be preserved through CSV quoting.
    expect(csv).toContain(
      '03cdc0dbd81294951fe6f0fb,1946,Essendon,Dick Reynolds,3578,unique,Captain,'
        + '1939–1950,"1942, 1946, 1949 and 1950 premiership captain",wikipedia',
    );
    // The first row in deterministic (source_key ascending) order.
    expect(csv).toContain(
      '0038312095ebd09b9311daf3,2015,Greater Western Sydney,Callan Ward,11677,unique,'
        + 'Captain,2012–2019 (co-captain),,wikipedia',
    );
  });

  it('every row is source-granularity wikipedia provenance, not a page citation', () => {
    for (const line of canonicalLines.slice(1)) {
      const cells = parseCsvLine(line);
      expect(cells[COL.sourceCitation]).toBe('wikipedia');
    }
  });

  it('carries the source_record_id verbatim as source_key — 24 hex chars, strictly ascending', () => {
    const keys = canonicalLines.slice(1).map((line) => parseCsvLine(line)[COL.sourceKey]);
    expect(keys).toHaveLength(1375);
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{24}$/);
    expect(new Set(keys).size).toBe(1375);
    const ascending = [...keys].sort();
    expect(keys).toEqual(ascending);
  });

  it('rejects a malformed header', () => {
    const lines = [...canonicalLines];
    lines[0] = lines[0].replace('source_key', 'record_key');
    expectRejected(lines, /invalid header/);
  });

  it('rejects a source_key that is not a 24-hex digest', () => {
    const row = replaceCell(VALID_ROW, COL.sourceKey, 'captaincy:carlton:2000');
    expectRejected([HEADER, row], /invalid source_key 'captaincy:carlton:2000'/);
  });

  it('rejects source_key rows out of deterministic (ascending) order', () => {
    const first = replaceCell(VALID_ROW, COL.sourceKey, '0000000000000000000000bb');
    const second = replaceCell(
      replaceCell(VALID_ROW, COL.sourceKey, '0000000000000000000000aa'),
      COL.player, 'Second Captain',
    );
    expectRejected([HEADER, first, second], /out of deterministic order/);
  });

  it('rejects a duplicate source_key', () => {
    const second = replaceCell(VALID_ROW, COL.player, 'Different Captain');
    expectRejected([HEADER, VALID_ROW, second], /duplicate source_key/);
  });

  it('rejects a duplicate natural identity (season, club, player, role)', () => {
    const second = replaceCell(VALID_ROW, COL.sourceKey, '0000000000000000000000bb');
    expectRejected([HEADER, VALID_ROW, second], /duplicate natural identity/);
  });

  it('rejects a season outside the declared coverage', () => {
    const row = replaceCell(VALID_ROW, COL.season, '1850');
    expectRejected([HEADER, row], /season 1850 is outside the declared range 1897-2026/);
  });

  it('rejects an unknown club', () => {
    const row = replaceCell(VALID_ROW, COL.club, 'Fitzroy');
    expectRejected([HEADER, row], /unknown club 'Fitzroy'/);
  });

  it('rejects a role outside the declared vocabulary', () => {
    const row = replaceCell(VALID_ROW, COL.role, 'Vice-captain');
    expectRejected([HEADER, row], /invalid role 'Vice-captain'/);
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
    const row = replaceCell(VALID_ROW, COL.sourceCitation, 'footywire');
    expectRejected([HEADER, row], /source_citation 'footywire' is not an authorised value/);
  });

  it('rejects a missing required field (empty period)', () => {
    const row = replaceCell(VALID_ROW, COL.period, '');
    expectRejected([HEADER, row], /period is required/);
  });

  it('rejects a player field with leading or trailing whitespace', () => {
    const row = replaceCell(VALID_ROW, COL.player, ' Test Captain');
    expectRejected([HEADER, row], /player has leading or trailing whitespace/);
  });

  it('rejects a total row count short of the declared 1375', () => {
    // Dropping only the final row keeps every remaining row's ordering
    // valid, so this reaches the completeness check rather than an earlier
    // per-row rule.
    expectRejected(canonicalLines.slice(0, -1), /expected 1375 captaincy rows, got 1374/);
  });
});

describe('captaincies group is legacy-SQLite-free (AFLDB-ISSUE-112 phase 3)', () => {
  const source = readFileSync(importAwards, 'utf8');

  it('lists captaincies in LEGACY_FREE_GROUPS', () => {
    const block = source.slice(
      source.indexOf('LEGACY_FREE_GROUPS = {'),
      source.indexOf('LEGACY_FREE_GROUPS = {') + 200,
    );
    expect(block).toContain('"captaincies"');
  });

  it('records the captaincies import_batch against wikipedia provenance', () => {
    expect(source).toContain('"captaincies": "wikipedia"');
  });

  it('no longer threads a legacy SQLite handle through import_captaincies', () => {
    expect(source).toContain(
      'def import_captaincies(pg, rep: Reporter, batch, clubs: ClubResolver,',
    );
    expect(source).not.toContain('def import_captaincies(pg, lite');
  });
});
