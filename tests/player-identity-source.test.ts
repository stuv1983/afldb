import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * AFLDB-ISSUE-112 §24.5 — the rebuild-stability fix.
 *
 * Every awards/honours manifest carries a `player_id` taken verbatim from the
 * legacy-loaded bootstrap source. That integer is NOT a target-database id:
 * the canonical rebuild re-seeds `players.id`, and the disagreement is total.
 * Measured 2026-09-02 against a canonically rebuilt `afldb_test`: 0 of 12,392
 * ids present in both databases denoted the same footballer, and 5,141 of the
 * 5,194 manifest links would have been silently attached to a different
 * player by the loaders' old "does a row with this id exist?" guard.
 *
 * `data/awards/player-identity.csv` is the bridge to the identity the rebuild
 * does preserve — the AFL Tables profile URL. These cases cover the parser;
 * the resolver's fail-closed behaviour is asserted against the real database
 * in tests/integration/awards-reload-links.test.ts.
 */
const repositoryRoot = process.cwd();
const checker = resolve(repositoryRoot, 'tools/migration/player_identity.py');
const canonicalCsv = resolve(repositoryRoot, 'data/awards/player-identity.csv');
const importAwards = resolve(repositoryRoot, 'tools/migration/import_awards.py');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'afldb-player-identity-'));
const canonicalLines = readFileSync(canonicalCsv, 'utf8').trimEnd().split(/\r?\n/);
let variantNumber = 0;

afterAll(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function runChecker(csvPath?: string) {
  const args = [checker];
  if (csvPath) args.push('--csv', csvPath);
  const result = spawnSync(python, args, { cwd: repositoryRoot, encoding: 'utf8' });
  if (result.error) throw result.error;
  return {
    status: result.status,
    payload: JSON.parse(result.stdout.trim()) as Record<string, any>,
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

function withCell(rowIndex: number, column: string, value: string): string[] {
  const columnIndex = canonicalLines[0].split(',').indexOf(column);
  expect(columnIndex).toBeGreaterThanOrEqual(0);
  return canonicalLines.map((line, index) => {
    if (index !== rowIndex + 1) return line;
    const cells = line.split(',');
    cells[columnIndex] = value;
    return cells.join(',');
  });
}

/** Quote-aware split: several manifests carry commas inside quoted cells. */
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

describe('awards player-identity census (AFLDB-ISSUE-112 §24.5)', () => {
  it('covers every distinct linked player_id the manifests reference', () => {
    const manifests = [
      'all-australian.csv', 'captaincies.csv', 'club-best-and-fairest.csv',
      'hall-of-fame.csv', 'honour-teams.csv', 'named-medals.csv',
      'rising-star.csv', 'rising-star-winners.csv',
    ];
    const referenced = new Set<string>();
    for (const file of manifests) {
      const text = readFileSync(resolve(repositoryRoot, 'data/awards', file), 'utf8');
      const lines = text.trimEnd().split(/\r?\n/);
      const column = lines[0].split(',').indexOf('player_id');
      expect(column).toBeGreaterThanOrEqual(0);
      for (const line of lines.slice(1)) {
        const value = parseCsvLine(line)[column];
        if (value && /^[0-9]+$/.test(value)) referenced.add(value);
      }
    }
    const censused = new Set(canonicalLines.slice(1).map((l) => l.split(',')[0]));
    const missing = [...referenced].filter((id) => !censused.has(id));
    // A manifest id with no census row is a hard loader refusal, so an
    // uncovered id is a broken rebuild, not a degraded one.
    expect(missing).toEqual([]);
    expect(censused.size).toBe(referenced.size);
  });

  it('parses and reports the measured coverage', () => {
    const result = runChecker();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.payload.ok).toBe(true);
    expect(result.payload.player_count).toBe(1745);
    expect(result.payload.with_identity).toBe(1727);
    expect(result.payload.without_identity).toBe(18);
  });

  it('enumerates the players with no rebuild-stable identity rather than hiding them', () => {
    // 18 players / 33 manifest rows. Their rows load UNLINKED and are reported
    // by the loader; re-linking them is a curator decision, not a parser rule.
    const listed = runChecker().payload.without_identity_players as
      Array<{ player_id: number; display_name: string }>;
    expect(listed).toHaveLength(18);
    expect(listed.map((p) => p.player_id)).toContain(2018);
    expect(listed.every((p) => p.display_name.length > 0)).toBe(true);
  });

  it('stores the identity as a normalised AFL Tables profile path, raw not hashed', () => {
    expect(canonicalLines[1].split(',')[2]).toMatch(/^players\/[A-Z]\/[^/]+\.html$/);
  });

  it('uses the tracked explicit DraftGuru decision for Matthew Rendell', () => {
    const decisions = JSON.parse(readFileSync(resolve(
      repositoryRoot, 'data/reference/draftguru-link-decisions.json'), 'utf8')) as {
      decisions: Array<{ player_url: string; target: null | { source: string; external_id: string } }>;
    };
    const decision = decisions.decisions.find(
      (row) => row.player_url === 'https://www.draftguru.com.au/players/matt_rendell/1');
    expect(decision?.target).toEqual({
      source: 'afltables', external_id: 'players/M/Matthew_Rendell.html',
    });

    const censusRow = canonicalLines.slice(1)
      .map((line) => line.split(','))
      .find((cells) => cells[0] === '1347');
    expect(censusRow).toEqual(['1347', 'Matthew Rendell', decision!.target!.external_id]);
  });

  // --- refusals ------------------------------------------------------------

  it('refuses a changed header', () => {
    expectRejected(['player_id,afltables_profile_url', ...canonicalLines.slice(1)],
                   /invalid header/);
  });

  it('refuses a row with too many columns', () => {
    expectRejected([canonicalLines[0], `${canonicalLines[1]},extra`,
                    ...canonicalLines.slice(2)], /too many columns/);
  });

  it('refuses a non-integer player_id', () => {
    expectRejected(withCell(0, 'player_id', 'four'),
                   /player_id must be a positive integer/);
  });

  it('refuses a missing display_name', () => {
    expectRejected(withCell(0, 'display_name', ''), /display_name is required/);
  });

  it('refuses a profile path that is not the normalised AFL Tables form', () => {
    expectRejected(withCell(0, 'afltables_profile_url',
                            'https://afltables.com/afl/stats/players/M/Mark.html'),
                   /is not a normalised AFL Tables profile path/);
  });

  it('refuses a duplicate player_id', () => {
    expectRejected([canonicalLines[0], canonicalLines[1], canonicalLines[1],
                    ...canonicalLines.slice(2)], /duplicate player_id/);
  });

  it('refuses rows out of deterministic order', () => {
    expectRejected([canonicalLines[0], canonicalLines[2], canonicalLines[1],
                    ...canonicalLines.slice(3)], /out of deterministic order/);
  });

  it('refuses two bootstrap ids claiming one profile', () => {
    // This would silently merge two awards populations onto one footballer.
    const secondUrl = canonicalLines[2].split(',')[2];
    expectRejected(withCell(0, 'afltables_profile_url', secondUrl),
                   /is already claimed by player_id/);
  });

  it('refuses a truncated census rather than resolving half the family', () => {
    expectRejected(canonicalLines.slice(0, -1), /expected 1745 censused players/);
  });

  it('refuses a census whose unlinkable population has changed', () => {
    const withoutUrl = canonicalLines.findIndex((line, index) =>
      index > 0 && line.split(',')[2] === '') - 1;
    expect(withoutUrl).toBeGreaterThanOrEqual(0);
    expectRejected(withCell(withoutUrl, 'afltables_profile_url',
                            'players/Z/Invented_Person.html'),
                   /expected 18 censused players with no rebuild-stable identity/);
  });
});

describe('the loaders resolve through the census and fail closed', () => {
  const source = readFileSync(importAwards, 'utf8');

  it('no longer keeps a bootstrap id merely because a row with it exists', () => {
    // The old guard. It protected nothing: every id existed in the rebuilt
    // database, so every link was kept and pointed at the wrong player.
    expect(source).not.toContain('valid_players');
    expect(source).not.toContain('if r.player_id in');
    expect(source).not.toContain('if w.player_id in');
  });

  it('resolves every family through PlayerResolver', () => {
    expect(source.split('players = PlayerResolver(pg)')).toHaveLength(8);
    // Eight call sites across seven loaders: the Rising Star group resolves
    // both its nominations and its winner rows.
    expect(source.split('players.resolve(')).toHaveLength(9);
  });

  it('refuses outright when a manifest id is not censused', () => {
    expect(source).toContain('is absent from data/awards/player-identity.csv');
    expect(source).toContain('this loader will not guess an');
  });

  it('never matches on a name and never falls back to the bootstrap id', () => {
    const resolver = source.slice(source.indexOf('class PlayerResolver:'),
                                  source.indexOf('# ---', source.indexOf('def report(')));
    expect(resolver).toContain("match_method = 'afltables_profile_url'");
    expect(resolver).toContain("ei.status IN ('unique', 'resolved')");
    expect(resolver).not.toContain('display_name =');
    expect(resolver).not.toContain('ILIKE');
    // The only value ever returned for a link is one the target database's own
    // external_identities produced.
    expect(resolver).toContain('return next(iter(candidates))');
  });

  it('reports every dropped link loudly instead of silently unlinking', () => {
    expect(source).toContain('def report(self, rep: Reporter, family: str)');
    expect(source.split('players.report(rep, ')).toHaveLength(8);
  });
});
