import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * AFLDB-ISSUE-112 club best-and-fairest slice (phase 6, §22). DB-free
 * parser/validation coverage for tools/migration/club_best_and_fairest.py,
 * in the tests/all-australian-source mould: every negative case writes a
 * small variant file and drives the real Python checker as a subprocess —
 * no database, no import_awards.py run.
 *
 * The family has two tracked files — a 752-row winners manifest and a
 * 19-row award-definitions manifest — that must also agree with each other
 * (each definition's declared span == its winners' min/max season). Unlike
 * the earlier slices it carries legitimately-tied seasons (25 of them), so
 * the parser must NOT enforce (award_slug, season) uniqueness while still
 * catching a genuine duplicate under (award_slug, season, player).
 */
const repositoryRoot = process.cwd();
const checker = resolve(repositoryRoot, 'tools/migration/club_best_and_fairest.py');
const winnersCsv = resolve(repositoryRoot, 'data/awards/club-best-and-fairest.csv');
const definitionsCsv = resolve(
  repositoryRoot, 'data/awards/club-best-and-fairest-definitions.csv',
);
const importAwards = resolve(repositoryRoot, 'tools/migration/import_awards.py');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'afldb-club-bf-'));
const winnerLines = readFileSync(winnersCsv, 'utf8').trimEnd().split(/\r?\n/);
const definitionLines = readFileSync(definitionsCsv, 'utf8').trimEnd().split(/\r?\n/);
let variantNumber = 0;

afterAll(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

type CheckResult = {
  status: number | null;
  payload: Record<string, unknown>;
  stderr: string;
};

function runChecker(opts: { csv?: string; definitions?: string } = {}): CheckResult {
  const args = [checker];
  if (opts.csv) args.push('--csv', opts.csv);
  if (opts.definitions) args.push('--definitions', opts.definitions);
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

function expectWinnersRejected(lines: string[], errorPattern: RegExp): void {
  const result = runChecker({ csv: writeVariant(lines) });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('');
  expect(result.payload.ok).toBe(false);
  expect(result.payload.error).toEqual(expect.stringMatching(errorPattern));
}

function expectDefinitionsRejected(lines: string[], errorPattern: RegExp): void {
  const result = runChecker({ definitions: writeVariant(lines) });
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

// Winners column order: source_key,award_slug,season,club,player,player_id,
// link_status,candidate_count,votes,note,source_citation
const W = {
  sourceKey: 0, awardSlug: 1, season: 2, club: 3, player: 4, playerId: 5,
  linkStatus: 6, candidateCount: 7, votes: 8, note: 9, sourceCitation: 10,
};
const WINNERS_HEADER =
  'source_key,award_slug,season,club,player,player_id,link_status,'
  + 'candidate_count,votes,note,source_citation';

// Definitions column order: slug,name,category,club,first_season,last_season,
// source_citation
const D = {
  slug: 0, name: 1, category: 2, club: 3, firstSeason: 4, lastSeason: 5,
  sourceCitation: 6,
};
const DEFINITIONS_HEADER =
  'slug,name,category,club,first_season,last_season,source_citation';

// Minimal valid winner rows for negative tests whose error fires during
// per-row validation — before the 752-row completeness check runs, so these
// variants deliberately do not total 752. The second key is strictly
// greater.
const W1 = 'bf-carlton:2000:1,bf-carlton,2000,Carlton,Test Player,1,unique,1,,,draftguru';
const W2 = 'bf-carlton:2000:2,bf-carlton,2000,Carlton,Other Player,2,unique,1,,,draftguru';

describe('canonical club best-and-fairest source (AFLDB-ISSUE-112 phase 6)', () => {
  it('contains the complete, machine-checkable G0-measured bootstrap', () => {
    const result = runChecker();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.payload).toMatchObject({
      ok: true,
      winner_count: 752,
      definition_count: 19,
      linked_count: 744,
      unlinked_count: 8,
      season_min: 1980,
      season_max: 2025,
      distinct_seasons: 46,
      distinct_awards: 19,
      note_present: 684,
      link_status: {
        implausible: 4, resolved: 590, unique: 154, unmatched: 4,
      },
    });
  });

  it('preserves representative winner rows verbatim', () => {
    const csv = winnerLines.join('\n');
    // First row in deterministic (source_key ascending) order.
    expect(csv).toContain(
      'bf-adelaide:1991:1017,bf-adelaide,1991,Adelaide,Mark Mickan,1308,resolved,1,,Recruited from Renmark / West Adelaide,draftguru',
    );
    // An unlinked row: no player_id, an unresolved link_status, no note.
    expect(csv).toContain(
      'bf-melbourne:1988:1423,bf-melbourne,1988,Melbourne,Steven O\'Dwyer,,unmatched,0,,,draftguru',
    );
    // The last row.
    expect(csv).toContain(
      'bf-western-bulldogs:2025:1768,bf-western-bulldogs,2025,Western Bulldogs,Ed Richards,12605,resolved,1,,Recruited from Hawthorn Citizens / Carey Grammar / Oakleigh U18,draftguru',
    );
  });

  it('keeps a tied season as two distinct winner rows, not a duplicate', () => {
    const csv = winnerLines.join('\n');
    expect(csv).toContain(
      'bf-adelaide:2003:1029,bf-adelaide,2003,Adelaide,Mark Ricciuto,4,resolved,1,,',
    );
    expect(csv).toContain(
      'bf-adelaide:2003:1030,bf-adelaide,2003,Adelaide,Tyson Edwards,34,resolved,1,,',
    );
    // The 2015 Brisbane award had four winners.
    const brisbane2015 = winnerLines.filter(
      (line) => line.startsWith('bf-brisbane:2015:'),
    );
    expect(brisbane2015).toHaveLength(4);
  });

  it('carries the source_record_id verbatim as source_key — namespaced per award, strictly ascending, unique', () => {
    const rows = winnerLines.slice(1).map(parseCsvLine);
    const keys = rows.map((cells) => cells[W.sourceKey]);
    expect(keys).toHaveLength(752);
    expect(new Set(keys).size).toBe(752);
    expect(keys).toEqual([...keys].sort());
    for (const cells of rows) {
      const key = cells[W.sourceKey];
      const match = key.match(/^(bf-[a-z0-9-]+):(\d{4}):\d+$/);
      expect(match, `${key} must match bf-<slug>:<season>:<n>`).not.toBeNull();
      expect(match![1]).toBe(cells[W.awardSlug]);
      expect(match![2]).toBe(cells[W.season]);
    }
  });

  it('every winner row is draftguru with no votes', () => {
    for (const line of winnerLines.slice(1)) {
      const cells = parseCsvLine(line);
      expect(cells[W.sourceCitation]).toBe('draftguru');
      expect(cells[W.votes]).toBe('');
    }
  });

  it('every winner award_slug has a definition whose declared span matches', () => {
    const defBySlug = new Map(
      definitionLines.slice(1).map(parseCsvLine).map(
        (cells) => [cells[D.slug], cells],
      ),
    );
    const spans = new Map<string, [number, number]>();
    for (const line of winnerLines.slice(1)) {
      const cells = parseCsvLine(line);
      const season = Number(cells[W.season]);
      const [low, high] = spans.get(cells[W.awardSlug]) ?? [season, season];
      spans.set(cells[W.awardSlug], [Math.min(low, season), Math.max(high, season)]);
    }
    expect(spans.size).toBe(19);
    for (const [slug, [first, last]] of spans) {
      const def = defBySlug.get(slug);
      expect(def, `${slug} must have a definition`).toBeDefined();
      expect(Number(def![D.firstSeason])).toBe(first);
      expect(Number(def![D.lastSeason])).toBe(last);
    }
  });

  it('rejects a malformed winners header', () => {
    const lines = [...winnerLines];
    lines[0] = lines[0].replace('source_key', 'record_key');
    expectWinnersRejected(lines, /invalid header/);
  });

  it('rejects an unknown award_slug', () => {
    const row = replaceCell(
      replaceCell(W1, W.awardSlug, 'bf-tasmania'),
      W.sourceKey, 'bf-tasmania:2000:1',
    );
    expectWinnersRejected([WINNERS_HEADER, row], /unknown award_slug 'bf-tasmania'/);
  });

  it('rejects a source_key that is not bf-<slug>:<season>:<n>', () => {
    const row = replaceCell(W1, W.sourceKey, 'carlton-2000-1');
    expectWinnersRejected([WINNERS_HEADER, row], /invalid source_key 'carlton-2000-1'/);
  });

  it('rejects a source_key whose award prefix disagrees with award_slug', () => {
    const row = replaceCell(W1, W.sourceKey, 'bf-essendon:2000:1');
    expectWinnersRejected(
      [WINNERS_HEADER, row],
      /source_key 'bf-essendon:2000:1' names award 'bf-essendon' but award_slug is 'bf-carlton'/,
    );
  });

  it("rejects a source_key whose embedded season disagrees with the row's season", () => {
    const row = replaceCell(W1, W.sourceKey, 'bf-carlton:1999:1');
    expectWinnersRejected([WINNERS_HEADER, row], /embeds season 1999 but the row's season is 2000/);
  });

  it('rejects source_key rows out of deterministic (ascending) order', () => {
    const second = replaceCell(W2, W.sourceKey, 'bf-carlton:2000:0');
    expectWinnersRejected([WINNERS_HEADER, W1, second], /out of deterministic order/);
  });

  it('rejects a duplicate source_key', () => {
    const dup = replaceCell(W1, W.player, 'Different Name');
    expectWinnersRejected([WINNERS_HEADER, W1, dup], /duplicate source_key 'bf-carlton:2000:1'/);
  });

  it('rejects a duplicate (award_slug, season, player) natural identity', () => {
    const twin = replaceCell(W2, W.player, 'Test Player');
    expectWinnersRejected(
      [WINNERS_HEADER, W1, twin],
      /duplicate natural identity \(award_slug, season, player\)/,
    );
  });

  it('does NOT reject two winners of the same award and season (a tied year)', () => {
    // Same award + season, different players and keys — the tied-season
    // shape. This passes per-row validation; it only fails the 752-row
    // completeness gate, proving the natural-key guard let it by.
    const result = runChecker({ csv: writeVariant([WINNERS_HEADER, W1, W2]) });
    expect(result.payload.ok).toBe(false);
    expect(result.payload.error).toEqual(
      expect.stringMatching(/expected 752 club best-and-fairest winner rows, got 2/),
    );
    expect(result.payload.error).not.toEqual(
      expect.stringMatching(/duplicate natural identity/),
    );
  });

  it('rejects a season outside the declared 1980-2025 range', () => {
    const row = replaceCell(
      replaceCell(W1, W.season, '1975'), W.sourceKey, 'bf-carlton:1975:1',
    );
    expectWinnersRejected([WINNERS_HEADER, row], /season 1975 is outside the declared range 1980-2025/);
  });

  it('rejects an unknown club', () => {
    const row = replaceCell(W1, W.club, 'Barcelona');
    expectWinnersRejected([WINNERS_HEADER, row], /unknown club 'Barcelona'/);
  });

  it('rejects an invalid link_status', () => {
    const row = replaceCell(W1, W.linkStatus, 'guessed');
    expectWinnersRejected([WINNERS_HEADER, row], /invalid link_status 'guessed'/);
  });

  it('rejects a linked status with no player_id', () => {
    const row = replaceCell(W1, W.playerId, '');
    expectWinnersRejected([WINNERS_HEADER, row], /link_status 'unique' requires player_id/);
  });

  it('rejects a non-linked status that carries a player_id', () => {
    const row = replaceCell(W1, W.linkStatus, 'unmatched');
    expectWinnersRejected([WINNERS_HEADER, row], /link_status 'unmatched' must not carry player_id/);
  });

  it('rejects a candidate_count outside the plausible range', () => {
    const row = replaceCell(W1, W.candidateCount, '42');
    expectWinnersRejected([WINNERS_HEADER, row], /candidate_count 42 is outside the plausible range/);
  });

  it('rejects a votes value', () => {
    const row = replaceCell(W1, W.votes, '7');
    expectWinnersRejected([WINNERS_HEADER, row], /votes is not expected for club best-and-fairest winners/);
  });

  it('rejects a source_citation other than draftguru', () => {
    const row = replaceCell(W1, W.sourceCitation, 'wikipedia');
    expectWinnersRejected([WINNERS_HEADER, row], /source_citation 'wikipedia' must be 'draftguru'/);
  });

  it('rejects a note with a leading space', () => {
    const row = replaceCell(W1, W.note, ' Recruited from somewhere');
    expectWinnersRejected([WINNERS_HEADER, row], /note has leading or trailing whitespace/);
  });

  it('rejects a truncated winners file (row count short of 752)', () => {
    expectWinnersRejected([WINNERS_HEADER, W1, W2], /expected 752 club best-and-fairest winner rows, got 2/);
  });

  it('rejects a winners file missing an award entirely', () => {
    const lines = winnerLines.filter((line) => !line.startsWith('bf-fitzroy:'));
    expectWinnersRejected(lines, /expected 752 club best-and-fairest winner rows, got 735/);
  });

  // ---- definitions file ----

  it('rejects a malformed definitions header', () => {
    const lines = [...definitionLines];
    lines[0] = lines[0].replace('first_season', 'start_season');
    expectDefinitionsRejected(lines, /invalid definitions header/);
  });

  it('rejects a definitions row with a wrong category', () => {
    const lines = [...definitionLines];
    lines[1] = replaceCell(lines[1], D.category, 'award');
    expectDefinitionsRejected(lines, /category 'award' must be 'club_best_and_fairest'/);
  });

  it('rejects malformed season bounds (first > last)', () => {
    const lines = [...definitionLines];
    lines[1] = replaceCell(replaceCell(lines[1], D.firstSeason, '2020'), D.lastSeason, '2000');
    expectDefinitionsRejected(lines, /malformed season bounds 2020-2000/);
  });

  it('rejects a duplicate definitions slug', () => {
    // Re-add bf-adelaide (line 1) after bf-carlton (line 2) so the row order
    // is still ascending up to the repeat: the duplicate is what trips.
    const lines = [
      definitionLines[0], definitionLines[1], definitionLines[2],
      definitionLines[1], ...definitionLines.slice(3),
    ];
    expectDefinitionsRejected(lines, /duplicate slug 'bf-adelaide'|out of deterministic order/);
  });

  it('rejects a definitions file missing one of the 19 bf-* awards', () => {
    const lines = definitionLines.filter((line) => !line.startsWith('bf-fitzroy,'));
    expectDefinitionsRejected(lines, /missing \['bf-fitzroy'\]/);
  });

  it('rejects a definition whose declared span disagrees with its winners (validate_family)', () => {
    const lines = [...definitionLines];
    // bf-carlton is 1980-2025 in the real winners; claim 1981-2025.
    const idx = lines.findIndex((line) => line.startsWith('bf-carlton,'));
    lines[idx] = replaceCell(lines[idx], D.firstSeason, '1981');
    const result = runChecker({ definitions: writeVariant(lines) });
    expect(result.status).toBe(1);
    expect(result.payload.ok).toBe(false);
    expect(result.payload.error).toEqual(
      expect.stringMatching(/award 'bf-carlton' definition span 1981-2025 does not match its winners' 1980-2025/),
    );
  });
});

describe('club_bf group is legacy-SQLite-free (AFLDB-ISSUE-112 phase 6)', () => {
  const source = readFileSync(importAwards, 'utf8');

  it('lists club_bf in LEGACY_FREE_GROUPS and records its batch against draftguru', () => {
    const block = source.slice(
      source.indexOf('LEGACY_FREE_GROUPS = {'),
      source.indexOf('LEGACY_FREE_GROUPS = {') + 280,
    );
    expect(block).toContain('"club_bf"');
    expect(source).toContain('"club_bf": "draftguru"');
  });

  it('dispatches import_club_best_and_fairest, reading both tracked manifests', () => {
    expect(source).toContain('elif key == "club_bf":');
    expect(source).toContain(
      'import_club_best_and_fairest(pg, rep, batch, clubs, sources,',
    );
    expect(source).toContain('definitions = load_club_best_and_fairest_definitions()');
    expect(source).toContain('winners = load_club_best_and_fairest()');
    expect(source).toContain('validate_club_best_and_fairest_family(winners, definitions)');
  });

  it('does not force the legacy awards group as a club_bf prerequisite, but a full awards refresh still reloads it', () => {
    const block = source.slice(
      source.indexOf('GROUP_REQUIRES = {'),
      source.indexOf('GROUP_REQUIRES = {') + 260,
    );
    expect(block).not.toMatch(/^\s*"club_bf":/m);
    expect(block).toContain(
      '"awards": {"all_australian", "under_22", "rising_star", "club_bf", "named_medals"}',
    );
  });

  it('reloads the 19 definitions on slug (scoped to those slugs) and the winners on (source_id, source_record_id)', () => {
    const body = source.slice(
      source.indexOf('def import_club_best_and_fairest('),
      source.indexOf('# Group: AFLPA 22 Under 22'),
    );
    expect(body).toContain('pg, "awards", ["slug"]');
    expect(body).toContain('scope_column="slug", scope_values=[d.slug for d in definitions]');
    expect(body).toContain('pg, "award_winners", ["source_id", "source_record_id"]');
    expect(body).toContain('scope_column="award_id", scope_values=bf_award_ids');
    expect(body).toContain('scopes=[("source_id", [source_id], False)]');
    expect(body).toContain('target_table="award_winners"');
  });

  it('takes the 19 bf-* awards out of the legacy awards group\'s winner scope', () => {
    const legacyAwardsLoader = source.slice(
      source.indexOf('def import_awards('),
      source.indexOf('# Group: club best-and-fairest'),
    );
    // The named-medal definition build and its slug-scoped reload are
    // untouched — bf-* entries still flow through build_definitions().
    expect(legacyAwardsLoader).toMatch(
      /reload_keyed\([\s\S]*?"awards", \["slug"\][\s\S]*?scope_column="slug", scope_values=\[UNDER_22_SLUG\], scope_exclude=True/,
    );
    // But the winner reload now also excludes the club_best_and_fairest awards.
    expect(legacyAwardsLoader).toContain(
      "entry[\"category\"] == \"club_best_and_fairest\"",
    );
    expect(legacyAwardsLoader).toMatch(
      /reload_keyed\([\s\S]*?"award_winners", \["source_id", "source_record_id"\][\s\S]*?scope_column="award_id", scope_values=other_group_awards, scope_exclude=True/,
    );
  });
});
