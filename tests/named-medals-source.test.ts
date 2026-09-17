import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * AFLDB-ISSUE-112 named-medals slice (phase 7, §23) — the last family.
 * DB-free parser/validation coverage for tools/migration/named_medals.py,
 * in the tests/club-best-and-fairest-source mould: every negative case
 * writes a small variant file and drives the real Python checker as a
 * subprocess — no database, no import_awards.py run.
 *
 * The family has two tracked files — a 979-row winners manifest and a
 * 17-row award-definitions manifest — that must agree with each other
 * (each definition's declared span == its winners' min/max season). It
 * carries legitimately-tied seasons (the Brownlow Medal alone has six),
 * two footballers named "Josh Kennedy" in one 2013 selection, and the
 * Brownlow medallist's winning vote tally on 53 rows and nowhere else.
 */
const repositoryRoot = process.cwd();
const checker = resolve(repositoryRoot, 'tools/migration/named_medals.py');
const winnersCsv = resolve(repositoryRoot, 'data/awards/named-medals.csv');
const definitionsCsv = resolve(
  repositoryRoot, 'data/awards/named-medals-definitions.csv',
);
const importAwards = resolve(repositoryRoot, 'tools/migration/import_awards.py');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'afldb-named-medals-'));
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

// Definitions column order: slug,name,category,competition,first_season,
// last_season
const D = {
  slug: 0, name: 1, category: 2, competition: 3, firstSeason: 4, lastSeason: 5,
};
const DEFINITIONS_HEADER =
  'slug,name,category,competition,first_season,last_season';

// Minimal valid winner rows for negative tests whose error fires during
// per-row validation — before the 979-row completeness check runs, so these
// variants deliberately do not total 979. The second key is strictly
// greater. magarey-medal is a plain (non-Brownlow, votes-free) award.
const W1 = 'magarey-medal:2000:1,magarey-medal,2000,Adelaide,Test Player,1,unique,1,,Recruited from Somewhere,draftguru';
const W2 = 'magarey-medal:2000:2,magarey-medal,2000,Carlton,Other Player,2,unique,1,,Recruited from Elsewhere,draftguru';
// A valid Brownlow row: carries a votes tally and no note.
const B1 = 'brownlow-medal:2000:1,brownlow-medal,2000,Carlton,Test Player,1,unique,1,25.00,,draftguru';

describe('canonical named-medals source (AFLDB-ISSUE-112 phase 7)', () => {
  it('contains the complete, machine-checkable G0-measured bootstrap', () => {
    const result = runChecker();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.payload).toMatchObject({
      ok: true,
      winner_count: 1307,
      definition_count: 24,
      linked_count: 1191,
      unlinked_count: 116,
      votes_present: 53,
      note_present: 1109,
      null_club: 299,
      season_min: 1970,
      season_max: 2025,
      distinct_seasons: 56,
      distinct_awards: 24,
      link_status: {
        implausible: 10, resolved: 812, unique: 379, unmatched: 106,
      },
    });
  });

  it('preserves representative winner rows verbatim', () => {
    const csv = winnerLines.join('\n');
    // First row in deterministic (source_key ascending) order.
    expect(csv).toContain(
      'aflca-best-young-player:2003:1,aflca-best-young-player,2003,West Coast,Chris Judd,1122,resolved,1,,Recruited from East Sandringham / Caulfield Grammar / Sandringham U18,draftguru',
    );
    // A Brownlow medallist row: a votes tally, no note, no club era split.
    expect(csv).toContain(
      'brownlow-medal:1980:482,brownlow-medal,1980,Western Bulldogs,Kelvin Templeton,2210,unique,1,23.00,,draftguru',
    );
    // An unlinked state-league row: no player_id, no club, no votes.
    expect(csv).toContain(
      'sandover-medal:2024:1014,sandover-medal,2024,,Callan England,,unmatched,0,,Recruited from Wembley Downs JFC / Hale School / Claremont,draftguru',
    );
    // National Draft Pick #1 — the one draft_pick award.
    expect(csv).toContain(
      'national-draft-pick-1:1982:1770,national-draft-pick-1,1982,Western Bulldogs,Andrew Purser,2088,resolved,1,,B&F : 1984,draftguru',
    );
  });

  it('keeps a tied Brownlow season as distinct winner rows, not a duplicate', () => {
    // 2003 had three medallists.
    const brownlow2003 = winnerLines.filter(
      (line) => line.startsWith('brownlow-medal:2003:'),
    );
    expect(brownlow2003).toHaveLength(3);
    const players = brownlow2003.map((line) => parseCsvLine(line)[W.player]).sort();
    expect(players).toEqual(['Adam Goodes', 'Mark Ricciuto', 'Nathan Buckley']);
    // Every tied Brownlow row still carries its own votes tally.
    for (const line of brownlow2003) {
      expect(parseCsvLine(line)[W.votes]).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('keeps two same-named winners in one selection as distinct rows', () => {
    // The 2013 All-Australian 40-Man Squad lists two different "Josh
    // Kennedy"s — (award_slug, season, player) collides but the club does
    // not, so the parser must accept them.
    const kennedys = winnerLines
      .filter((line) => line.startsWith('all-australian-squad:2013:'))
      .map(parseCsvLine)
      .filter((cells) => cells[W.player] === 'Josh Kennedy');
    expect(kennedys).toHaveLength(2);
    expect(new Set(kennedys.map((cells) => cells[W.club])).size).toBe(2);
  });

  it('carries the source_record_id verbatim as source_key — namespaced per award, strictly ascending, unique', () => {
    const rows = winnerLines.slice(1).map(parseCsvLine);
    const keys = rows.map((cells) => cells[W.sourceKey]);
    expect(keys).toHaveLength(1307);
    expect(new Set(keys).size).toBe(1307);
    expect(keys).toEqual([...keys].sort());
    for (const cells of rows) {
      const key = cells[W.sourceKey];
      const match = key.match(/^([a-z0-9-]+):(\d{4}):\d+$/);
      expect(match, `${key} must match <slug>:<season>:<n>`).not.toBeNull();
      expect(match![1]).toBe(cells[W.awardSlug]);
      expect(match![2]).toBe(cells[W.season]);
    }
  });

  it('records a votes tally only on Brownlow rows, and those carry no note', () => {
    for (const line of winnerLines.slice(1)) {
      const cells = parseCsvLine(line);
      expect(['draftguru', 'wikipedia']).toContain(cells[W.sourceCitation]);
      if (cells[W.awardSlug] === 'brownlow-medal') {
        expect(cells[W.votes]).toMatch(/^\d+\.\d{2}$/);
        expect(cells[W.note]).toBe('');
      } else {
        expect(cells[W.votes]).toBe('');
      }
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
    expect(spans.size).toBe(24);
    for (const [slug, [first, last]] of spans) {
      const def = defBySlug.get(slug);
      expect(def, `${slug} must have a definition`).toBeDefined();
      expect(Number(def![D.firstSeason])).toBe(first);
      expect(Number(def![D.lastSeason])).toBe(last);
    }
  });

  it('carries National Draft Pick #1 as a draft_pick with no competition', () => {
    const ndp = definitionLines.slice(1).map(parseCsvLine)
      .find((cells) => cells[D.slug] === 'national-draft-pick-1');
    expect(ndp).toBeDefined();
    expect(ndp![D.category]).toBe('draft_pick');
    expect(ndp![D.competition]).toBe('');
  });

  it('rejects a malformed winners header', () => {
    const lines = [...winnerLines];
    lines[0] = lines[0].replace('source_key', 'record_key');
    expectWinnersRejected(lines, /invalid header/);
  });

  it('rejects an unknown award_slug', () => {
    const row = replaceCell(
      replaceCell(W1, W.awardSlug, 'tassie-medal'),
      W.sourceKey, 'tassie-medal:2000:1',
    );
    expectWinnersRejected([WINNERS_HEADER, row], /unknown award_slug 'tassie-medal'/);
  });

  it('rejects a source_key that is not <slug>:<season>:<n>', () => {
    const row = replaceCell(W1, W.sourceKey, 'magarey-2000-1');
    expectWinnersRejected([WINNERS_HEADER, row], /invalid source_key 'magarey-2000-1'/);
  });

  it('rejects a source_key whose award prefix disagrees with award_slug', () => {
    const row = replaceCell(W1, W.sourceKey, 'sandover-medal:2000:1');
    expectWinnersRejected(
      [WINNERS_HEADER, row],
      /source_key 'sandover-medal:2000:1' names award 'sandover-medal' but award_slug is 'magarey-medal'/,
    );
  });

  it("rejects a source_key whose embedded season disagrees with the row's season", () => {
    const row = replaceCell(W1, W.sourceKey, 'magarey-medal:1999:1');
    expectWinnersRejected([WINNERS_HEADER, row], /embeds season 1999 but the row's season is 2000/);
  });

  it('rejects source_key rows out of deterministic (ascending) order', () => {
    const second = replaceCell(W2, W.sourceKey, 'magarey-medal:2000:0');
    expectWinnersRejected([WINNERS_HEADER, W1, second], /out of deterministic order/);
  });

  it('rejects a duplicate source_key', () => {
    const dup = replaceCell(W1, W.player, 'Different Name');
    expectWinnersRejected([WINNERS_HEADER, W1, dup], /duplicate source_key 'magarey-medal:2000:1'/);
  });

  it('rejects a duplicate (award_slug, season, player, club) natural identity', () => {
    const twin = replaceCell(replaceCell(W2, W.player, 'Test Player'), W.club, 'Adelaide');
    expectWinnersRejected(
      [WINNERS_HEADER, W1, twin],
      /duplicate natural identity \(award_slug, season, player, club\)/,
    );
  });

  it('does NOT reject two winners of the same award and season (a tied year)', () => {
    const result = runChecker({ csv: writeVariant([WINNERS_HEADER, W1, W2]) });
    expect(result.payload.ok).toBe(false);
    expect(result.payload.error).toEqual(
      expect.stringMatching(/expected 1307 named-medal winner rows, got 2/),
    );
    expect(result.payload.error).not.toEqual(
      expect.stringMatching(/duplicate natural identity/),
    );
  });

  it('does NOT reject two same-named winners in one selection who differ by club', () => {
    const kennedyA = 'all-australian-squad:2013:1,all-australian-squad,2013,Sydney,Josh Kennedy,1,unique,1,,,draftguru';
    const kennedyB = 'all-australian-squad:2013:2,all-australian-squad,2013,West Coast,Josh Kennedy,2,unique,1,,,draftguru';
    const result = runChecker({ csv: writeVariant([WINNERS_HEADER, kennedyA, kennedyB]) });
    expect(result.payload.ok).toBe(false);
    expect(result.payload.error).toEqual(
      expect.stringMatching(/expected 1307 named-medal winner rows, got 2/),
    );
    expect(result.payload.error).not.toEqual(
      expect.stringMatching(/duplicate natural identity/),
    );
  });

  it('rejects a season outside the declared 1970-2025 range', () => {
    const row = replaceCell(
      replaceCell(W1, W.season, '1969'), W.sourceKey, 'magarey-medal:1969:1',
    );
    expectWinnersRejected([WINNERS_HEADER, row], /season 1969 is outside the declared range 1970-2025/);
  });

  it('rejects an unknown club', () => {
    const row = replaceCell(W1, W.club, 'Barcelona');
    expectWinnersRejected([WINNERS_HEADER, row], /unknown club 'Barcelona'/);
  });

  it('accepts an empty club (a winner with no AFL career)', () => {
    const row = replaceCell(replaceCell(W1, W.club, ''), W.playerId, '');
    const linkless = replaceCell(row, W.linkStatus, 'unmatched');
    const result = runChecker({ csv: writeVariant([WINNERS_HEADER, linkless]) });
    expect(result.payload.ok).toBe(false);
    expect(result.payload.error).toEqual(
      expect.stringMatching(/expected 1307 named-medal winner rows, got 1/),
    );
    expect(result.payload.error).not.toEqual(expect.stringMatching(/club/));
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

  it('rejects a votes value on a non-Brownlow award', () => {
    const row = replaceCell(W1, W.votes, '25.00');
    expectWinnersRejected([WINNERS_HEADER, row], /votes is only recorded for 'brownlow-medal'/);
  });

  it('rejects a Brownlow row with no votes tally', () => {
    const row = replaceCell(B1, W.votes, '');
    expectWinnersRejected([WINNERS_HEADER, row], /a 'brownlow-medal' row must carry its winning votes tally/);
  });

  it('rejects a Brownlow row that also carries a note', () => {
    const row = replaceCell(B1, W.note, 'Recruited from somewhere');
    expectWinnersRejected([WINNERS_HEADER, row], /a 'brownlow-medal' row must not carry a note/);
  });

  it('rejects a votes value that is not the measured NN.NN shape', () => {
    const row = replaceCell(B1, W.votes, '25');
    expectWinnersRejected([WINNERS_HEADER, row], /votes '25' is not of the measured form 'NN.NN'/);
  });

  it('rejects a source_citation outside the declared vocabulary', () => {
    const row = replaceCell(W1, W.sourceCitation, 'footywire');
    expectWinnersRejected([WINNERS_HEADER, row], /source_citation 'footywire' must be one of/);
  });

  it('rejects a note with a leading space', () => {
    const row = replaceCell(W1, W.note, ' Recruited from somewhere');
    expectWinnersRejected([WINNERS_HEADER, row], /note has leading or trailing whitespace/);
  });

  it('rejects a truncated winners file (row count short of 1307)', () => {
    expectWinnersRejected([WINNERS_HEADER, W1, W2], /expected 1307 named-medal winner rows, got 2/);
  });

  it('rejects a winners file missing an award entirely', () => {
    const lines = winnerLines.filter((line) => !line.startsWith('gary-ayres-award:'));
    expectWinnersRejected(lines, /expected 1307 named-medal winner rows, got 1297/);
  });

  // ---- definitions file ----

  it('rejects a malformed definitions header', () => {
    const lines = [...definitionLines];
    lines[0] = lines[0].replace('first_season', 'start_season');
    expectDefinitionsRejected(lines, /invalid definitions header/);
  });

  it('rejects a definitions row with a category outside {award, draft_pick}', () => {
    const lines = [...definitionLines];
    lines[1] = replaceCell(lines[1], D.category, 'club_best_and_fairest');
    expectDefinitionsRejected(lines, /category 'club_best_and_fairest' must be one of/);
  });

  it('rejects malformed season bounds (first > last)', () => {
    const lines = [...definitionLines];
    lines[1] = replaceCell(replaceCell(lines[1], D.firstSeason, '2020'), D.lastSeason, '2000');
    expectDefinitionsRejected(lines, /malformed season bounds 2020-2000/);
  });

  it('rejects a duplicate definitions slug', () => {
    const lines = [
      definitionLines[0], definitionLines[1], definitionLines[2],
      definitionLines[1], ...definitionLines.slice(3),
    ];
    expectDefinitionsRejected(
      lines,
      /duplicate slug 'aflca-best-young-player'|out of deterministic order/,
    );
  });

  it('rejects a definitions file missing one of the 24 named-medal awards', () => {
    const lines = definitionLines.filter((line) => !line.startsWith('gary-ayres-award,'));
    expectDefinitionsRejected(lines, /missing \['gary-ayres-award'\]/);
  });

  it('rejects a definition whose declared span disagrees with its winners (validate_family)', () => {
    const lines = [...definitionLines];
    // brownlow-medal is 1980-2025 in the real winners; claim 1981-2025.
    const idx = lines.findIndex((line) => line.startsWith('brownlow-medal,'));
    lines[idx] = replaceCell(lines[idx], D.firstSeason, '1981');
    const result = runChecker({ definitions: writeVariant(lines) });
    expect(result.status).toBe(1);
    expect(result.payload.ok).toBe(false);
    expect(result.payload.error).toEqual(
      expect.stringMatching(/award 'brownlow-medal' definition span 1981-2025 does not match its winners' 1980-2025/),
    );
  });
});

describe('named_medals group is legacy-SQLite-free (AFLDB-ISSUE-112 phase 7)', () => {
  const source = readFileSync(importAwards, 'utf8');

  it('lists named_medals in LEGACY_FREE_GROUPS and records its batch against draftguru', () => {
    const block = source.slice(
      source.indexOf('LEGACY_FREE_GROUPS = {'),
      source.indexOf('LEGACY_FREE_GROUPS = {') + 320,
    );
    expect(block).toContain('"named_medals"');
    expect(source).toContain('"named_medals": "draftguru"');
  });

  it('dispatches import_named_medals, reading both tracked manifests', () => {
    expect(source).toContain('elif key == "named_medals":');
    expect(source).toContain('import_named_medals(pg, rep, batch, clubs, sources,');
    expect(source).toContain('definitions = load_named_medals_definitions()');
    expect(source).toContain('winners = load_named_medals()');
    expect(source).toContain('validate_named_medals_family(winners, definitions)');
  });

  it('does not force the legacy awards group as a named_medals prerequisite, but a full awards refresh still reloads it', () => {
    const block = source.slice(
      source.indexOf('GROUP_REQUIRES = {'),
      source.indexOf('GROUP_REQUIRES = {') + 300,
    );
    expect(block).not.toMatch(/^\s*"named_medals":/m);
    expect(block).toContain(
      '"awards": {"all_australian", "under_22", "rising_star", "club_bf", "named_medals"}',
    );
  });

  it('reloads the 24 definitions on slug (scoped to those slugs) and the winners on (source_id, source_record_id)', () => {
    const body = source.slice(
      source.indexOf('def import_named_medals('),
      source.indexOf('# Group: AFLPA 22 Under 22'),
    );
    expect(body).toContain('pg, "awards", ["slug"]');
    expect(body).toContain('scope_column="slug", scope_values=[d.slug for d in definitions]');
    expect(body).toContain('pg, "award_winners", ["source_id", "source_record_id"]');
    expect(body).toContain('scope_column="award_id", scope_values=named_medal_award_ids');
    expect(body).toContain('scopes=[("source_id", sorted(source_ids.values()), False)]');
    expect(body).toContain('target_table="award_winners"');
  });

  it('takes the 17 named-medal awards out of the legacy awards group\'s winner scope, definitions untouched', () => {
    const legacyAwardsLoader = source.slice(
      source.indexOf('def import_awards('),
      source.indexOf('# Group: All-Australian'),
    );
    // The shared definition build and its slug-scoped reload are untouched —
    // the named-medal (and bf-*) entries still flow through
    // build_definitions(), so the legacy group keeps its remaining job of
    // creating the all-australian / rising-star / coleman definitions.
    expect(legacyAwardsLoader).toMatch(
      /reload_keyed\([\s\S]*?"awards", \["slug"\][\s\S]*?scope_column="slug", scope_values=\[UNDER_22_SLUG\], scope_exclude=True/,
    );
    // The winner reload now also excludes the named-medal awards, by slug.
    expect(legacyAwardsLoader).toContain(
      'award_ids[slug] for slug in NAMED_MEDAL_SLUGS if slug in award_ids',
    );
    expect(legacyAwardsLoader).toMatch(
      /reload_keyed\([\s\S]*?"award_winners", \["source_id", "source_record_id"\][\s\S]*?scope_column="award_id", scope_values=other_group_awards, scope_exclude=True/,
    );
  });
});
