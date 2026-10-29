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

/*
 * AFLDB-ISSUE-159 §1.3 / §5.3 — the manual coach identity namespace.
 *
 * coaches.afltables_coach_path and coaches.name_key are both NOT NULL UNIQUE
 * (087:38,41), and the importer's coach upsert conflicts on the PATH ALONE. So a
 * manually created coach holding the real "Surname, Given" string would raise a
 * unique violation on a NON-target constraint the first time AFL Tables published
 * a page for that person -- which is not an upsert, it aborts the whole nightly
 * batch. Migration 095 removes that class of failure by construction rather than
 * by convention, and these tests are what keep it structural.
 */
describe('the manual coach identity namespace (migration 095)', () => {
  const migration = readFileSync(
    join(repositoryRoot, 'src', 'db', 'migrations', '095_coach_admin_overrides.sql'), 'utf8',
  ).replace(/\r\n/g, '\n');
  /**
   * The migration's STATEMENTS, with every `--` comment line stripped. The
   * prohibitions below are about what the migration does, not about which words
   * its commentary is allowed to contain — it explains at length what it
   * deliberately does not do, and that explanation must not fail its own test.
   */
  const statements = migration.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  const contract = JSON.parse(readFileSync(join(repositoryRoot, 'tools', 'rebuild', 'afltables', 'afltables-contract.json'), 'utf8'));
  const label: string = contract.coaches.accepted_snapshot.label;
  const snapshotRoot = join(repositoryRoot, 'data', 'sources', 'afltables', 'coaches', label, 'parsed');

  /** The two CHECKs, as PostgreSQL will enforce them, evaluated in JS. */
  const pathNamespaceOk = (path: string) =>
    path.startsWith('coaches/') || path.startsWith('manual:');
  const manualIdentityOk = (path: string, nameKey: string) =>
    path.startsWith('manual:') === nameKey.startsWith('manual:');

  it('declares both CHECKs, on the right columns, in the right shape', () => {
    expect(migration).toMatch(
      /ADD CONSTRAINT coaches_path_namespace_ck\s*\n\s*CHECK \(afltables_coach_path LIKE 'coaches\/%' OR afltables_coach_path LIKE 'manual:%'\)/,
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT coaches_manual_identity_ck\s*\n\s*CHECK \(\(afltables_coach_path LIKE 'manual:%'\) = \(name_key LIKE 'manual:%'\)\)/,
    );
    // Forward-only, and 087 is not edited: no column added, none relaxed, and
    // coaches_link_ck is not widened (D-3).
    expect(statements).not.toMatch(/DROP NOT NULL|DROP COLUMN|ADD COLUMN|CREATE TABLE/i);
    expect(statements).not.toMatch(/coaches_link_ck/);
    expect(statements).not.toMatch(/DROP CONSTRAINT coaches_/);
  });

  it('accepts a minted manual identity and refuses every half-namespaced shape', () => {
    const token = '01JBQ2Z4M7F3K8W6YV5N9RTPQD';
    expect(pathNamespaceOk(`manual:${token}`)).toBe(true);
    expect(manualIdentityOk(`manual:${token}`, `manual:${token}`)).toBe(true);

    // The batch-aborting shape: a manual path carrying a real index string.
    expect(manualIdentityOk(`manual:${token}`, 'Fagan, Chris')).toBe(false);
    // And its mirror: a real page path carrying a manual name_key.
    expect(manualIdentityOk('coaches/Chris_Fagan0.html', `manual:${token}`)).toBe(false);
    // An identity from neither namespace is not an identity.
    for (const path of ['', 'Fagan, Chris', 'players/C/Chris_Fagan0.html', 'coaches', 'manual', 'MANUAL:x']) {
      expect(pathNamespaceOk(path), path).toBe(false);
    }
  });

  it('cannot collide with any real AFL Tables coach identity in the tracked snapshot', () => {
    const pages = readFileSync(join(snapshotRoot, 'coach_pages.csv'), 'utf8').split('\n').filter(Boolean);
    const header = pages[0].split(',');
    const paths = pages.slice(1).map((line) => line.split(',')[header.indexOf('coach_path')]);
    expect(paths.length).toBe(contract.coaches.accepted_snapshot.measured.coaches);
    expect(paths.length).toBeGreaterThan(380);

    for (const path of paths) {
      // Every real path is in the sourced namespace, so both CHECKs hold for
      // every existing row -- the precondition the migration's ALTER needs.
      expect(path.startsWith('coaches/'), path).toBe(true);
      expect(path.startsWith('manual:'), path).toBe(false);
      expect(pathNamespaceOk(path), path).toBe(true);
    }

    // And the index strings the per-match Coach column joins on are "Surname,
    // Given" -- a shape that can never equal 'manual:<token>'.
    const indexRows = readFileSync(join(snapshotRoot, 'coaches_index.csv'), 'utf8').split('\n').filter(Boolean);
    expect(indexRows[0].split(',')).toEqual(contract.coaches.index_columns);
    expect(indexRows[0].startsWith('name_raw,')).toBe(true);
    // name_raw is the leading column and is quoted precisely because it contains
    // a comma -- it is "Surname, Given".
    const nameKeys = indexRows.slice(1).map((line) => /^"([^"]*)"/.exec(line)?.[1]);
    expect(nameKeys.length).toBe(paths.length);
    for (const nameKey of nameKeys) {
      expect(nameKey, String(nameKey)).toBeDefined();
      // The shape itself is the collision-freedom argument: a ':' -namespaced
      // token is not a "Surname, Given" string and never can be.
      expect(nameKey, nameKey).toMatch(/^[^,]+, .+$/);
      expect(nameKey!.startsWith('manual:'), nameKey).toBe(false);
      expect(manualIdentityOk('coaches/x.html', nameKey!), nameKey).toBe(true);
    }
  });

  it('introduces no merge, no supersession and no delete path for a coach', () => {
    // AFLDB-ISSUE-159 §13 / S-3. A manual coach that later gains an AFL Tables
    // identity is P9-class identity lifecycle work, reported and stopped. Stage 1
    // delivers duplicate PREVENTION only -- and the row must never be deletable,
    // because its data_edits rows carry its id and an id that resolves to nothing
    // stops the promotion.
    expect(statements).not.toMatch(/superseded_by|\bmerge\b/i);
    expect(statements).not.toMatch(/DELETE FROM coaches|ON DELETE CASCADE/i);
    // The prose says so too, deliberately — this is a reported stop, not an omission.
    expect(migration).toContain('P9-class identity');
    const replay = readFileSync(join(repositoryRoot, 'tools', 'migration', 'common.py'), 'utf8');
    const coachesBranch = replay.slice(
      replay.indexOf('elif table == "coaches":'), replay.indexOf('elif table == "match_coaches":'),
    );
    expect(coachesBranch.length).toBeGreaterThan(0);
    expect(coachesBranch).not.toMatch(/DELETE FROM|superseded/i);
  });
});

/*
 * AFLDB-ISSUE-319 (owner decision 2026-10-23: "Require raw-to-parsed coach replay inside
 * preflight"). `import_match_coaches.py --require-raw-bundle` reads the contract-pinned raw
 * tar in memory, refuses anything but exactly the manifest's raw files, replays the
 * acquisition's own parser (tools/rebuild/afltables/coach_snapshot_parser.py, moved out of the
 * quarantined adapter, not copied) and refuses unless the rendered CSV bytes equal the
 * manifest digests and the very bytes the loader parses into its rows.
 *
 * The controls are the retained prototype's nine (C:/tmp/afldb-c2-REHEARSAL-V3-15e43562-
 * 20261023T0017Z/source-evidence-319/raw-replay-preflight/), including its corrected
 * same-size member flip (the prototype's first version appended a byte, which tarfile
 * truncated back to the declared size: a void control, kept on record there), plus the
 * index/page/parser/pin cases the implementation adds. Each fixture is generated here, so
 * the deeper layer, not the bundle digest, must catch each defect.
 */
const RAW_REPLAY_SCRIPT = String.raw`
import copy, gzip, hashlib, io, json, sys, tarfile, tempfile
from pathlib import Path
sys.path.insert(0, 'tools/migration')
import import_match_coaches as m
import coach_snapshot_parser as p

real = json.loads(Path('tools/rebuild/afltables/afltables-contract.json').read_text(encoding='utf-8'))['coaches']
sha = lambda b: hashlib.sha256(b).hexdigest()
LABEL = 'coaches-29990101'

def index_html(coaches):
    head = ''.join(f'<th>{h}</th>' for h in real['index_required_header'])
    rows = ''.join(f'<tr><td><a href="{href}">{name}</a></td>' + '<td>1</td>' * (len(real['index_required_header']) - 1) + '</tr>'
                   for name, href, _d in coaches)
    return f'<html><table><tr><th></th><th>Home &amp; Away</th></tr><tr>{head}</tr>{rows}</table></html>'.encode()

def page_html(display, profile, h1=True):
    link = f'<a href="../{profile}">Player Stats</a>' if profile else ''
    title = f'<h1>{display}</h1>' if h1 else ''
    return (f'<html>{title}<b>Born:</b> 1-Jan-1950 (x)<br>{link}<table><tr><th colspan=3>Games Coached</th></tr>'
            '<tr><td>1</td><td>a</td></tr><tr><td>2</td><td>b</td></tr></table></html>').encode()

COACHES = [('One, Alpha', 'Alpha_One.html', 'Alpha One'), ('Two, Beta', 'Beta_Two.html', 'Beta Two'),
           ('Fontaine, Allan La', 'Allan_La Fontaine.html', 'Allan La Fontaine')]
PROFILES = {'Alpha_One.html': 'players/A/Alpha_One.html', 'Beta_Two.html': '', 'Allan_La Fontaine.html': ''}

def reg(name, data):
    t = tarfile.TarInfo(name); t.size = len(data); t.mode = 0o644; t.mtime = 0
    return (t, data)

def special(name, kind, link=''):
    t = tarfile.TarInfo(name); t.type = kind; t.linkname = link; t.mtime = 0
    return (t, None)

def tar_of(members, directory=True):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w', format=tarfile.PAX_FORMAT) as tf:
        if directory:
            d = tarfile.TarInfo('raw'); d.type = tarfile.DIRTYPE; d.mode = 0o755; d.mtime = 0
            tf.addfile(d)
        for t, data in members:
            tf.addfile(t, io.BytesIO(data) if data is not None else None)
    return buf.getvalue()

def fixture(raw_index=None, pages=None):
    """Raw bytes, the parsed CSVs the adapter's parser writes from them, and a matching manifest."""
    raw_index = raw_index if raw_index is not None else index_html(COACHES)
    pages = pages if pages is not None else {href: page_html(d, PROFILES[href]) for _n, href, d in COACHES}
    rows = p.parse_index(raw_index.decode(), real)
    parsed_pages = []
    for r in rows:
        pg = p.parse_page(pages[r['coach_href']].decode(), r['coach_path'])
        pg['raw_sha256'] = sha(pages[r['coach_href']])
        parsed_pages.append(pg)
    parsed = {'coaches_index': p.render_csv(real['index_columns'], rows), 'coach_pages': p.render_csv(real['page_columns'], parsed_pages)}
    manifest = {'family': real['family'], 'contract_coaches_version': real['contract_coaches_version'],
                'index': {'raw_filename': 'raw/coaches_idx.html', 'raw_sha256': sha(raw_index)},
                'parsed': [{'dataset': k, 'filename': f'parsed/{k}.csv', 'sha256': sha(v), 'row_count': len(rows)} for k, v in parsed.items()],
                'files': [{'coach_path': f'coaches/{href}', 'raw_filename': f'raw/{href}', 'raw_sha256': sha(b)} for href, b in pages.items()],
                'pages_acquired': len(pages), 'coaches_indexed': len(rows)}
    members = [reg('raw/coaches_idx.html', raw_index)] + [reg(f'raw/{href}', b) for href, b in pages.items()]
    return manifest, parsed, members

def run(manifest, parsed, members=None, tar_bytes=None, pin_over=None, drop_pin=False, no_bundle=False, direct=None):
    root = Path(tempfile.mkdtemp(prefix='afldb-raw-replay-'))
    m.SNAPSHOT_ROOT, m.MANIFEST_ROOT = root / 'snap', root / 'man'
    snap = m.SNAPSHOT_ROOT / LABEL
    (snap / 'parsed').mkdir(parents=True)
    m.MANIFEST_ROOT.mkdir()
    (m.MANIFEST_ROOT / f'{LABEL}.json').write_text(json.dumps(manifest), encoding='utf-8')
    for k, v in parsed.items():
        (snap / 'parsed' / f'{k}.csv').write_bytes(v)
    data = tar_bytes if tar_bytes is not None else tar_of(members)
    if not no_bundle:
        (snap / 'fixture-raw.tar').write_bytes(data)
    contract = copy.deepcopy(real)
    contract['accepted_snapshot'] = {'label': LABEL, 'raw_bundle': {
        'filename': 'fixture-raw.tar', 'sha256': sha(data), 'bytes': len(data), 'members': 1 + len(manifest['files'])}}
    contract['accepted_snapshot']['raw_bundle'].update(pin_over or {})
    if drop_pin:
        del contract['accepted_snapshot']['raw_bundle']
    try:
        if direct is not None:
            return {'ok': True, 'state': m.replay_raw_bundle(LABEL, contract, manifest, direct, snap)}
        _manifest, index, pages, state = m.verify_coaches_snapshot(LABEL, contract, True)
        return {'ok': True, 'state': state, 'rows': len(index), 'pages': [r['coach_path'] for r in pages]}
    except m.RawReplayRefused as exc:
        return {'ok': False, 'error': f'REFUSED: {exc}'}
    except SystemExit as exc:
        return {'ok': False, 'error': str(exc)}

out = {}
man, parsed, members = fixture()
idx, first = members[0], members[1]
out['control_unchanged'] = run(man, parsed, members)
good = tar_of(members)
flipped = bytearray(good)
flipped[len(flipped) // 2] ^= 1
out['bundle_flipped_not_rebound'] = run(man, parsed, tar_bytes=bytes(flipped), pin_over={'sha256': sha(good)})
t, b = first
out['member_bytes_changed'] = run(man, parsed, [idx, reg(t.name, b[:20] + bytes([b[20] ^ 1]) + b[21:])] + members[2:])
out['member_missing'] = run(man, parsed, [idx] + members[2:])
out['member_extra'] = run(man, parsed, members + [reg('raw/Extra_Coach.html', b'<h1>x</h1>')])
out['member_duplicate'] = run(man, parsed, members + [first])
out['member_symlink'] = run(man, parsed, [idx, special(t.name, tarfile.SYMTYPE, '/etc/passwd')] + members[2:])
out['member_hardlink'] = run(man, parsed, [idx, special(t.name, tarfile.LNKTYPE, 'raw/coaches_idx.html')] + members[2:])
out['member_outside_raw'] = run(man, parsed, members + [reg('../escape.html', b'x')])
out['member_absolute'] = run(man, parsed, members + [reg('/etc/escape.html', b'x')])
out['extra_directory'] = run(man, parsed, members + [special('raw/sub', tarfile.DIRTYPE)])
out['index_missing'] = run(man, parsed, members[1:])
altered = dict(parsed)
altered['coach_pages'] = parsed['coach_pages'] + b'coaches/X.html,X,,,,0,0\n'
out['run_parsed_input_altered'] = run(man, altered, members)
out['run_parsed_differs_from_replay'] = run(man, parsed, members,
                                            direct={**parsed, 'coach_pages': parsed['coach_pages'].replace(b'Beta Two', b'Beta Too')})
# The raw index names a third page that the manifest, the bundle and the parsed files all lack.
two = {href: page_html(d, PROFILES[href]) for _n, href, d in COACHES[:2]}
man2, parsed2, members2 = fixture(index_html(COACHES[:2]), two)
grown = index_html(COACHES)
man2['index']['raw_sha256'] = sha(grown)
out['index_names_absent_page'] = run(man2, parsed2, [reg('raw/coaches_idx.html', grown)] + members2[1:])
# The adapter's own parser raises (a page without <h1>); the manifest binds those bytes, so only the parser can refuse.
# The parsed row's raw_sha256 and the manifest's parsed digest are rewritten too: a first version
# left them stale, so the loader's existing row/manifest check refused first (a void control).
bad = page_html('Beta Two', '', h1=False)
old_sha = next(f['raw_sha256'] for f in man['files'] if f['raw_filename'] == 'raw/Beta_Two.html')
man3, parsed3 = copy.deepcopy(man), dict(parsed)
parsed3['coach_pages'] = parsed['coach_pages'].replace(old_sha.encode(), sha(bad).encode())
for f in man3['files']:
    if f['raw_filename'] == 'raw/Beta_Two.html':
        f['raw_sha256'] = sha(bad)
for e in man3['parsed']:
    if e['dataset'] == 'coach_pages':
        e['sha256'] = sha(parsed3['coach_pages'])
out['adapter_parser_raises'] = run(man3, parsed3, [x if x[0].name != 'raw/Beta_Two.html' else reg('raw/Beta_Two.html', bad) for x in members])
out['bundle_absent'] = run(man, parsed, members, no_bundle=True)
out['pin_absent'] = run(man, parsed, members, drop_pin=True)
out['pin_member_count_wrong'] = run(man, parsed, members, pin_over={'members': 3})
out['pin_unsafe_filename'] = run(man, parsed, members, pin_over={'filename': '../fixture-raw.tar'})
out['pin_leading_dash'] = run(man, parsed, members, pin_over={'filename': '-fixture.tar'})
out['bundle_compressed'] = run(man, parsed, tar_bytes=gzip.compress(good, mtime=0))
out['bundle_not_tar'] = run(man, parsed, tar_bytes=b'not a tar' * 100)
print(json.dumps(out))
`;

type ReplayOutcome = { ok: true; state: string; rows?: number; pages?: string[] } | { ok: false; error: string };

describe('the mandatory coach raw replay (AFLDB-ISSUE-319)', () => {
  const results = JSON.parse(run(RAW_REPLAY_SCRIPT, {})) as Record<string, ReplayOutcome>;
  const refused = (key: string): string => {
    const r = results[key];
    expect(r, key).toBeDefined();
    expect(r.ok, `${key}: ${JSON.stringify(r)}`).toBe(false);
    return (r as { error: string }).error;
  };

  it('accepts the unchanged fixture and loads exactly the replayed rows (the tar-only space survives)', () => {
    const r = results.control_unchanged;
    expect(r).toMatchObject({ ok: true, rows: 3 });
    expect((r as { state: string }).state).toMatch(
      /^AFLDB-COACH-RAW-REPLAY VERIFIED: raw bundle fixture-raw\.tar sha256 [0-9a-f]{64} replayed \(4 members\)/);
    expect((r as { pages: string[] }).pages).toContain('coaches/Allan_La Fontaine.html');
  });

  it.each([
    ['bundle_flipped_not_rebound', /raw bundle bytes are not the pinned bundle/],
    ['member_bytes_changed', /1 raw members differ from the manifest, e\.g\. \['raw\/Alpha_One\.html'\]/],
    ['member_missing', /1 manifest raw files missing from the bundle, e\.g\. \['raw\/Alpha_One\.html'\]/],
    ['member_extra', /tar member not in the manifest 'raw\/Extra_Coach\.html'/],
    ['member_duplicate', /duplicate tar member 'raw\/Alpha_One\.html'/],
    ['member_symlink', /non-regular tar member 'raw\/Alpha_One\.html'/],
    ['member_hardlink', /non-regular tar member 'raw\/Alpha_One\.html'/],
    ['member_outside_raw', /tar member not in the manifest '\.\.\/escape\.html'/],
    ['member_absolute', /tar member not in the manifest '\/etc\/escape\.html'/],
    ['extra_directory', /non-regular tar member 'raw\/sub'/],
    ['index_missing', /1 manifest raw files missing from the bundle, e\.g\. \['raw\/coaches_idx\.html'\]/],
    ['index_names_absent_page', /the index names 'Allan_La Fontaine\.html', absent from the bundle/],
    ['adapter_parser_raises', /the acquisition parser refused the raw bytes: ERROR: coaches\/Beta_Two\.html: page has no <h1>/],
    ['run_parsed_differs_from_replay', /coach_pages: the parsed input this run loads differs from the raw replay/],
    ['bundle_absent', /the raw bundle fixture-raw\.tar is absent; raw replay is required/],
    ['pin_absent', /raw_bundle is absent or not exactly/],
    ['pin_member_count_wrong', /the manifest names 4 raw files, the pin says 3/],
    ['pin_unsafe_filename', /is not a plain \.tar file name/],
    ['pin_leading_dash', /'-fixture\.tar' is not a plain \.tar file name/],
    ['bundle_compressed', /the raw bundle is \d+ B, the pin says \d+ B|raw bundle bytes are not the pinned bundle|not a readable uncompressed tar/],
    ['bundle_not_tar', /not a readable uncompressed tar/],
  ])('%s: refuses (%s)', (key, message) => {
    const error = refused(key);
    expect(error).toMatch(message);
    // Through verify_coaches_snapshot, a refusal names the gate and that nothing was loaded.
    if (key !== 'run_parsed_differs_from_replay') expect(error).toMatch(/AFLDB-COACH-RAW-REPLAY REFUSED: .*; nothing was loaded$/);
  });

  it('a changed parsed CSV is refused before the replay by the manifest digest (the ninth prototype control)', () => {
    expect(refused('run_parsed_input_altered')).toMatch(/parsed\/coach_pages\.csv sha256 [0-9a-f]{12}… does not match the tracked manifest/);
  });

  it('tools/ never imports legacy/: the moved parser and the loader name no legacy path', () => {
    for (const rel of ['tools/rebuild/afltables/coach_snapshot_parser.py', 'tools/migration/import_match_coaches.py']) {
      const source = readFileSync(join(repositoryRoot, rel), 'utf8');
      expect(source, rel).not.toMatch(/^\s*(from|import)\s+[^\n]*legacy/m);
      expect(source, rel).not.toMatch(/sys\.path[^\n]*legacy/);
    }
    // The parser module is network- and file-free.
    expect(readFileSync(join(repositoryRoot, 'tools/rebuild/afltables/coach_snapshot_parser.py'), 'utf8'))
      .not.toMatch(/\bimport (urllib|socket|os|pathlib)\b|\bfrom (urllib|pathlib|os|http)\b|\bopen\(/);
  });
});

/*
 * Legacy compatibility and the genuine recovered bundle. The quarantined adapter now
 * imports the moved functions (the same objects), and its write_csv writes render_csv's
 * bytes, which equal what the adapter's original DictWriter-to-file code produced. On the
 * recovered 2026-09-05 bundle (gitignored; present at the contract's location wherever the
 * rebuild runs it) the moved parser regenerates the tracked parsed files byte for byte.
 */
const contractCoaches = JSON.parse(readFileSync(join(repositoryRoot, 'tools', 'rebuild', 'afltables', 'afltables-contract.json'), 'utf8')).coaches;
const genuineBundle = join(repositoryRoot, 'data', 'sources', 'afltables', 'coaches', contractCoaches.accepted_snapshot.label,
  contractCoaches.accepted_snapshot.raw_bundle.filename);

describe('coach parser move: legacy compatibility and acquisition-output equivalence', () => {
  it('the quarantined adapter runs the shared parser objects, and write_csv bytes are unchanged', () => {
    const script = String.raw`
import csv, importlib.util, json, sys, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('acq', 'legacy/offline/tools/rebuild/afltables/acquire_coaches.py')
acq = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acq)
import coach_snapshot_parser as p
same = all(getattr(acq, n) is getattr(p, n) for n in ('TableParser', 'Terminal', 'parse_html', 'normalise_profile_path',
                                                     'sha256_bytes', 'parse_index', 'parse_page', 'BORN_RE', 'PLAYER_STATS_RE'))
cols = ['a', 'b', 'c']
rows = [{'a': 'Smith, John', 'b': 'quote "x"', 'c': 'caf\u00e9 \u00fc'}, {'a': 'plain', 'b': ''}, {'a': ' lead', 'b': 'x,y', 'c': "z's"}]
d = Path(tempfile.mkdtemp())
acq.write_csv(d / 'new.csv', cols, rows)
# The adapter's original writer, verbatim (before AFLDB-ISSUE-319 moved it to render_csv).
with (d / 'old.csv').open('w', encoding='utf-8', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=cols, lineterminator='\n')
    w.writeheader()
    for r in rows:
        w.writerow({c: r.get(c, '') for c in cols})
print(json.dumps({'same': same, 'equal': (d / 'new.csv').read_bytes() == (d / 'old.csv').read_bytes() == p.render_csv(cols, rows)}))
`;
    expect(JSON.parse(run(script, {}))).toEqual({ same: true, equal: true });
  });

  it.skipIf(!existsSync(genuineBundle))('the recovered bundle replays to the tracked parsed files and the manifest (525ae887…, ec4959a4…)', () => {
    const script = String.raw`
import json, sys
sys.path.insert(0, 'tools/migration')
import import_match_coaches as m
contract = json.load(open('tools/rebuild/afltables/afltables-contract.json', encoding='utf-8'))['coaches']
label = contract['accepted_snapshot']['label']
_man, index, pages, state = m.verify_coaches_snapshot(label, contract, True)
print(json.dumps({'state': state, 'index': len(index), 'pages': len(pages)}))
`;
    const r = JSON.parse(run(script, {})) as { state: string; index: number; pages: number };
    expect(r).toMatchObject({ index: 386, pages: 386 });
    expect(r.state).toContain('AFLDB-COACH-RAW-REPLAY VERIFIED: raw bundle coaches-20260905-raw.tar sha256 '
      + '2468569067209ec3810b5bbcc45cb8d75c616f69517bac8531fbffa47c661e4a replayed (387 members)');
    expect(r.state).toContain('coaches_index 525ae8876786a2bb006f8be91fc29f860e12e765eb12316c5f9da9ed6ef142ef');
    expect(r.state).toContain('coach_pages ec4959a40fc56a6ff6e15b6a91a4bd81cc75326c507440cf98b4ed60f853113b');
  }, 60_000);
});
