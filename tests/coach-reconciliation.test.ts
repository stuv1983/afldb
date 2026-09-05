/**
 * AFLDB-ISSUE-118 Stage E2 (runbook §23.27): the identity rules of
 * tools/migration/import_match_coaches.py, exercised on synthetic rows through the
 * interpreter the way tests/height-reconciliation.test.ts exercises enrich_heights.
 * No database, no snapshot.
 *
 * The rules under test:
 *   - a coach is a person keyed by the AFL Tables coach page; the ONLY link to a
 *     players row is the page's Player Stats profile path resolved through the
 *     afltables identities (external_identities), never a name;
 *   - a page without a profile link is a coach-only person: player_id NULL,
 *     link_status 'unmatched', and no players row is fabricated;
 *   - the per-match Coach column joins the page by EXACT index string; one string
 *     per (match, club); anything else is refused.
 *
 * The last block reads the TRACKED parsed snapshot the contract pins and proves the
 * operator-supplied coach-only list (John Todd, Col Kinnear, John Cahill, Wayne
 * Brittain, Neil Craig, Brendan McCartney, Brendon Bolton) carries no player
 * profile on the source itself — the evidence the loader's NULL links rest on.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = join(__dirname, '..');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

type CoachRow = {
  path: string; nameKey: string; display: string; given: string | null; surname: string | null; dob: string | null;
  playerId: number | null; link: string; profile: string | null; games: number;
};
type Result = { ok: true; rows: CoachRow[]; linked: number; unlinked: number } | { ok: false; error: string };
type FoldResult = { ok: true; assignments: Record<string, string>; rowsRead: number; groups: number; blank: number; paths?: Record<string, string> }
  | { ok: false; error: string };

const index = (name: string, file: string) => ({ name_raw: name, coach_href: file, coach_path: `coaches/${file}` });
const page = (file: string, display: string, profile = '', born = '1-Jan-1950', games = 10) => (
  { coach_path: `coaches/${file}`, display_name: display, born_raw: born, player_href: profile ? `../${profile}` : '', profile_path: profile, games_coached: String(games), raw_sha256: 'x' }
);

function run(script: string, payload: object): string {
  const proc = spawnSync(python, ['-c', script], { cwd: repositoryRoot, input: JSON.stringify(payload), encoding: 'utf8' });
  if (proc.status !== 0) throw new Error(`python exited ${proc.status}: ${proc.stderr}`);
  return proc.stdout;
}

function buildCoaches(indexRows: object[], pages: object[], identity: Record<string, number>, folded: Record<string, string> = {}, corrections: object[] = []): Result {
  const script = `
import json, sys
sys.path.insert(0, 'tools/migration')
import import_match_coaches as m
data = json.loads(sys.stdin.read())
try:
    rows, linked, unlinked = m.build_coach_rows(data['index'], data['pages'], data['identity'], data['folded'], 9, 'test', data['corrections'])
except m.CoachIdentityError as exc:
    print(json.dumps({'ok': False, 'error': str(exc)})); sys.exit(0)
out = [{'path': r[0], 'nameKey': r[1], 'display': r[2], 'given': r[3], 'surname': r[4], 'dob': r[5].isoformat() if r[5] else None,
        'playerId': r[6], 'link': r[7], 'profile': r[8], 'games': r[9]} for r in rows]
print(json.dumps({'ok': True, 'rows': out, 'linked': linked, 'unlinked': unlinked}))
`;
  return JSON.parse(run(script, { index: indexRows, pages, identity, folded, corrections })) as Result;
}

function fold(rows: object[], indexRows: object[] | null = null): FoldResult {
  const script = `
import json, sys
sys.path.insert(0, 'tools/migration')
import import_match_coaches as m
from import_fitzroy_core import CLUBS_JSON, ClubResolver
data = json.loads(sys.stdin.read())
clubs = ClubResolver(json.loads(CLUBS_JSON.read_text(encoding='utf-8')), [])
records = [(f'row {i}', int(r['Season']), r) for i, r in enumerate(data['rows'], start=2)]
try:
    assignments, rows_read, groups, blank = m.fold_assignments(records, clubs)
    paths = m.resolve_coach_strings(assignments, data['index']) if data['index'] is not None else None
except m.CoachIdentityError as exc:
    print(json.dumps({'ok': False, 'error': str(exc)})); sys.exit(0)
print(json.dumps({'ok': True, 'assignments': {f'{k[0]}@{k[2]}': v for k, v in assignments.items()},
                  'rowsRead': rows_read, 'groups': groups, 'blank': blank, 'paths': paths}))
`;
  return JSON.parse(run(script, { rows, index: indexRows })) as FoldResult;
}

const stat = (season: number, round: string, date: string, home: string, away: string, playingFor: string, coach: string) => (
  { Season: String(season), Round: round, Date: date, 'Home.team': home, 'Away.team': away, 'Playing.for': playingFor, Coach: coach }
);

describe('import_match_coaches identity rules', () => {
  it('links a player/coach ONLY through the page profile path, and leaves a coach-only person unlinked with no player', () => {
    const r = buildCoaches(
      [index('Matthews, Leigh', 'Leigh_Matthews.html'), index('Fagan, Chris', 'Chris_Fagan.html')],
      [page('Leigh_Matthews.html', 'Leigh Matthews', 'players/L/Leigh_Matthews.html', '1-Mar-1952', 461),
       page('Chris_Fagan.html', 'Chris Fagan', '', '23-Jun-1961', 239)],
      { 'players/L/Leigh_Matthews.html': 4321 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.linked).toBe(1);
    expect(r.unlinked).toBe(1);
    expect(r.rows[0]).toMatchObject({ path: 'coaches/Leigh_Matthews.html', nameKey: 'Matthews, Leigh', display: 'Leigh Matthews',
      given: 'Leigh', surname: 'Matthews', dob: '1952-03-01', playerId: 4321, link: 'unique', profile: 'players/L/Leigh_Matthews.html', games: 461 });
    expect(r.rows[1]).toMatchObject({ path: 'coaches/Chris_Fagan.html', nameKey: 'Fagan, Chris', dob: '1961-06-23', playerId: null, link: 'unmatched', profile: null, games: 239 });
  });

  it('never binds an ambiguous name: the page profile decides which Ron Barassi, and a same-name player is no substitute for a profile', () => {
    const identity = { 'players/R/Ron_Barassi0.html': 100, 'players/R/Ron_Barassi1.html': 101 };
    const linked = buildCoaches([index('Barassi, Ron', 'Ron_Barassi0.html')],
      [page('Ron_Barassi0.html', 'Ron Barassi', 'players/R/Ron_Barassi0.html')], identity);
    expect(linked.ok && linked.rows[0].playerId).toBe(100);
    // Same rendered name, no profile link on the page: coach-only, even though two
    // players are called Ron Barassi.
    const noLink = buildCoaches([index('Barassi, Ron', 'Ron_Barassi0.html')],
      [page('Ron_Barassi0.html', 'Ron Barassi', '')], identity);
    expect(noLink.ok && noLink.rows[0]).toMatchObject({ playerId: null, link: 'unmatched' });
    // A profile the identities do not hold is a refusal, never a name match.
    const unknown = buildCoaches([index('Barassi, Ron', 'Ron_Barassi0.html')],
      [page('Ron_Barassi0.html', 'Ron Barassi', 'players/R/Ron_Barassi9.html')], identity);
    expect(unknown).toMatchObject({ ok: false, error: expect.stringMatching(/no canonical afltables identity.*Ron_Barassi9\.html/) });
  });

  it('folds a renumbered profile through the contract continuity rule, and refuses two pages on one player', () => {
    const folded = buildCoaches([index('Smith, Len', 'Len_Smith0.html')],
      [page('Len_Smith0.html', 'Len Smith', 'players/L/Len_Smith7.html')],
      { 'players/L/Len_Smith0.html': 55 }, { 'players/L/Len_Smith7.html': 'players/L/Len_Smith0.html' });
    expect(folded.ok && folded.rows[0]).toMatchObject({ playerId: 55, link: 'unique', profile: 'players/L/Len_Smith7.html' });
    const twice = buildCoaches([index('Smith, Len', 'Len_Smith0.html'), index('Smith, Leonard', 'Len_Smith1.html')],
      [page('Len_Smith0.html', 'Len Smith', 'players/L/Len_Smith0.html'), page('Len_Smith1.html', 'Leonard Smith', 'players/L/Len_Smith0.html')],
      { 'players/L/Len_Smith0.html': 55 });
    expect(twice).toMatchObject({ ok: false, error: expect.stringMatching(/two coach pages link the same player \[55\]/) });
  });

  it('applies a tracked profile-link correction by exact page and href, exactly once, and refuses a rule that no longer matches', () => {
    const rule = { id: 'r1', coach_path: 'coaches/Allan_La Fontaine.html', page_profile_path: 'players/A/Allan_La Fontaine.html', canonical_profile_path: 'players/A/Allan_La_Fontaine.html' };
    const identity = { 'players/A/Allan_La_Fontaine.html': 486 };
    const broken = [page('Allan_La Fontaine.html', 'Allan La Fontaine', 'players/A/Allan_La Fontaine.html')];
    const idx = [index('La Fontaine, Allan', 'Allan_La Fontaine.html')];
    expect(buildCoaches(idx, broken, identity)).toMatchObject({ ok: false, error: expect.stringMatching(/no canonical afltables identity/) });
    const fixed = buildCoaches(idx, broken, identity, {}, [rule]);
    expect(fixed.ok && fixed.rows[0]).toMatchObject({ playerId: 486, link: 'unique', profile: 'players/A/Allan_La_Fontaine.html' });
    // The page now prints the served href: the rule finds nothing and must be retired deliberately.
    const served = [page('Allan_La Fontaine.html', 'Allan La Fontaine', 'players/A/Allan_La_Fontaine.html')];
    expect(buildCoaches(idx, served, identity, {}, [rule])).toMatchObject({ ok: false, error: expect.stringMatching(/rule 'r1' applied to 0 pages/) });
    // A rule never reaches a different page, even one printing the same broken href.
    const other = [page('Bob_Rose.html', 'Bob Rose', 'players/A/Allan_La Fontaine.html')];
    expect(buildCoaches([index('Rose, Bob', 'Bob_Rose.html')], other, identity, {}, [rule])).toMatchObject({ ok: false });
  });

  it('keeps an unparseable or absent birth date as null without affecting identity', () => {
    const r = buildCoaches([index('Worrall, Jack', 'Jack_Worrall.html')], [page('Jack_Worrall.html', 'Jack Worrall', '', '')], {});
    expect(r.ok && r.rows[0]).toMatchObject({ dob: null, playerId: null, link: 'unmatched' });
  });
});

describe('import_match_coaches assignment folding', () => {
  const rows = [
    stat(2013, '11', '2013-06-08', 'Essendon', 'Brisbane Lions', 'Essendon', 'Goodwin, Simon'),
    stat(2013, '11', '2013-06-08', 'Essendon', 'Brisbane Lions', 'Essendon', 'Goodwin, Simon'),
    stat(2013, '11', '2013-06-08', 'Essendon', 'Brisbane Lions', 'Brisbane Lions', 'Voss, Michael'),
    stat(1920, '1', '1920-05-01', 'Fitzroy', 'St Kilda', 'Fitzroy', ''),
  ];

  it('yields one string per (match, club), keys the match exactly as the fitzRoy import does, and keeps a blank cell as a gap', () => {
    const r = fold(rows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ rowsRead: 4, groups: 3, blank: 1 });
    expect(r.assignments).toEqual({
      '2013|11|2013-06-08|Essendon|Brisbane Lions@Essendon': 'Goodwin, Simon',
      '2013|11|2013-06-08|Essendon|Brisbane Lions@Brisbane Lions': 'Voss, Michael',
    });
  });

  it('refuses two coach strings for one (match, club), and a club that is not in the match', () => {
    const two = fold([...rows, stat(2013, '11', '2013-06-08', 'Essendon', 'Brisbane Lions', 'Essendon', 'Hird, James')]);
    expect(two).toMatchObject({ ok: false, error: expect.stringMatching(/carry two coach strings.*Goodwin, Simon.*Hird, James/) });
    const stray = fold([stat(2013, '11', '2013-06-08', 'Essendon', 'Brisbane Lions', 'Carlton', 'Malthouse, Mick')]);
    expect(stray).toMatchObject({ ok: false, error: expect.stringMatching(/neither club of the match/) });
  });

  it('maps every string to a coach page by exact index name, and refuses any other string', () => {
    const idx = [index('Goodwin, Simon', 'Simon_Goodwin.html'), index('Voss, Michael', 'Michael_Voss.html')];
    const r = fold(rows, idx);
    expect(r.ok && r.paths).toEqual({ 'Goodwin, Simon': 'coaches/Simon_Goodwin.html', 'Voss, Michael': 'coaches/Michael_Voss.html' });
    const missing = fold(rows, [index('Goodwin, Simon', 'Simon_Goodwin.html'), index('Voss, Mick', 'Michael_Voss.html')]);
    expect(missing).toMatchObject({ ok: false, error: expect.stringMatching(/not exactly one index name: \['Voss, Michael'\]/) });
  });
});

describe('the tracked coaches snapshot (contract pin)', () => {
  const contract = JSON.parse(readFileSync(join(repositoryRoot, 'tools', 'rebuild', 'afltables', 'afltables-contract.json'), 'utf8'));
  const label: string | undefined = contract.coaches?.accepted_snapshot?.label;
  const pagesPath = label ? join(repositoryRoot, 'data', 'sources', 'afltables', 'coaches', label, 'parsed', 'coach_pages.csv') : '';

  // The operator-supplied coach-only list (ISSUE-118 Stage E2 brief): people who
  // coached in the VFL/AFL and never played a VFL/AFL match.
  const COACH_ONLY = ['coaches/John_Todd.html', 'coaches/Col_Kinnear.html', 'coaches/John_Cahill.html', 'coaches/Wayne_Brittain.html',
    'coaches/Neil_Craig.html', 'coaches/Brendan_McCartney.html', 'coaches/Brendon_Bolton.html', 'coaches/Chris_Fagan.html'];

  it('is pinned, tracked, and shows the known coach-only people with no player profile on the source', () => {
    expect(label).toMatch(/^coaches-\d{8}$/);
    expect(existsSync(pagesPath)).toBe(true);
    const lines = readFileSync(pagesPath, 'utf8').split('\n').filter(Boolean);
    const header = lines[0].split(',');
    expect(header).toEqual(contract.coaches.page_columns);
    const byPath = new Map<string, string[]>();
    for (const line of lines.slice(1)) {
      const cells = line.split(',');
      byPath.set(cells[0], cells);
    }
    for (const path of COACH_ONLY) {
      expect(byPath.has(path), path).toBe(true);
      expect(byPath.get(path)![header.indexOf('profile_path')], path).toBe('');
    }
    // And a player/coach carries the profile path external_identities holds.
    expect(byPath.get('coaches/Leigh_Matthews.html')![header.indexOf('profile_path')]).toMatch(/^players\/L\/Leigh_Matthews\d*\.html$/);
    expect(byPath.get('coaches/Ron_Barassi0.html')![header.indexOf('profile_path')]).toBe('players/R/Ron_Barassi0.html');
  });
});
