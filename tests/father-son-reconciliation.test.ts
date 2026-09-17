/**
 * AFLDB-ISSUE-118 §23.29 family F: the identity rules of tools/migration/father_son.py,
 * exercised on synthetic rows through the interpreter the way
 * tests/coach-reconciliation.test.ts exercises import_match_coaches. No database.
 *
 * The rules under test:
 *   - a son is the unique same-name player who debuted within the window after the
 *     selection AND played for the drafting club's lineage; a father the unique same-name
 *     player who debuted at least FATHER_LEAD seasons before AND played for the lineage;
 *   - Sr./Jr. choose the earliest/latest debut among same-name candidates;
 *   - a son with the list's own 0 games and no candidate is a non-player (unmatched); a
 *     father with a state-league/administrator annotation and no candidate likewise;
 *   - everything else refuses unless a tracked adjudication decides it, and every
 *     adjudication must be needed and used exactly once (stale ones refuse);
 *   - the accepted artefact's shape is checked offline: link statuses must agree with
 *     their profile paths, keys are unique, pairs appear once.
 *
 * The last block reads the TRACKED artefact and adjudication set and proves the
 * adjudications that were made are exactly the seven recorded in the runbook.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = join(__dirname, '..');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

type Cand = { player_id: number; profile: string; display_name: string; given_name?: string | null; surname?: string | null; debut_season: number | null; games: number | null; club_games: Record<string, number> };
type Raw = { line?: number; year: number; drafted_player: string; club: string; father: string; selection?: string; games?: string; father_games?: string };
type Adj = { role: 'son' | 'father'; draft_year: number; club: string; name_raw: string; afltables_profile: string | null; evidence?: string; decided_on?: string };
type Result = { ok: true; rows: Record<string, string>[] } | { ok: false; error: string };

function run(script: string, payload: object): string {
  const proc = spawnSync(python, ['-c', script], { cwd: repositoryRoot, input: JSON.stringify(payload), encoding: 'utf8' });
  if (proc.status !== 0) throw new Error(`python exited ${proc.status}: ${proc.stderr}`);
  return proc.stdout;
}

function normalise(raw: Raw[], candidates: Cand[], adjudications: Adj[] = []): Result {
  const script = `
import json, sys
sys.path.insert(0, 'tools/migration')
import father_son as m
data = json.loads(sys.stdin.read())
roster = m.Roster(m.Candidate(c['player_id'], c['profile'], c['display_name'], c.get('given_name'), c.get('surname'), c['debut_season'], c['games'], c['club_games']) for c in data['candidates'])
raw = [m.RawRow(r.get('line', i + 2), r['year'], r['drafted_player'], r['club'], r['father'], r.get('selection', ''), r.get('games', ''), r.get('father_games', '')) for i, r in enumerate(data['raw'])]
adj = [m.Adjudication(a['role'], a['draft_year'], a['club'], a['name_raw'], a.get('afltables_profile'), a.get('evidence', 'e'), a.get('decided_on', '2026-09-05')) for a in data['adjudications']]
try:
    rows = m.normalise_rows(raw, roster, adj, None)
except m.FatherSonSourceError as exc:
    print(json.dumps({'ok': False, 'error': str(exc)})); sys.exit(0)
print(json.dumps({'ok': True, 'rows': rows}))
`;
  return JSON.parse(run(script, { raw, candidates, adjudications })) as Result;
}

function readArtefact(text: string): { ok: true; measures: Record<string, number> } | { ok: false; error: string } {
  const script = `
import json, sys, tempfile, pathlib
sys.path.insert(0, 'tools/migration')
import father_son as m
text = json.loads(sys.stdin.read())['text']
p = pathlib.Path(tempfile.mkdtemp()) / 'a.csv'
p.write_text(text, encoding='utf-8', newline='')
try:
    rows = m.read_artefact(p)
except m.FatherSonSourceError as exc:
    print(json.dumps({'ok': False, 'error': str(exc)})); sys.exit(0)
print(json.dumps({'ok': True, 'measures': m.artefact_measures(rows)}))
`;
  return JSON.parse(run(script, { text }));
}

function names(values: string[]): Record<string, [string, string | null]> {
  const script = `
import json, sys
sys.path.insert(0, 'tools/migration')
import father_son as m
print(json.dumps({v: list(m.normalise_name(v)) for v in json.loads(sys.stdin.read())}))
`;
  return JSON.parse(run(script, values));
}

const geelong = (id: number, name: string, debut: number, games: number, profile = `players/X/${name.replace(/[^A-Za-z]/g, '_')}${id}.html`): Cand =>
  ({ player_id: id, profile, display_name: name, debut_season: debut, games, club_games: { geelong: games } });

const ablettSr = geelong(1, 'Gary Ablett', 1982, 248, 'players/G/Gary_Ablett0.html');
const ablettJr = geelong(2, 'Gary Ablett', 2002, 357, 'players/G/Gary_Ablett1.html');
const nathan = geelong(3, 'Nathan Ablett', 2005, 34, 'players/N/Nathan_Ablett.html');
const roster = [ablettSr, ablettJr, nathan];

describe('father_son.py name normalisation', () => {
  it('strips the listed marker, punctuation, middle initials and the generational suffix', () => {
    expect(names(['Gary Ablett, Sr.', 'Gary Ablett, Jr.', 'Maurice Rioli, Snr.', 'Alwyn Davey Jr.', 'Jesse W. Smith', 'Tom Liberatore^', 'John Kennedy Jr.', "Ernie Hug, Sr."])).toEqual({
      'Gary Ablett, Sr.': ['gary ablett', 'sr'],
      'Gary Ablett, Jr.': ['gary ablett', 'jr'],
      'Maurice Rioli, Snr.': ['maurice rioli', 'sr'],
      'Alwyn Davey Jr.': ['alwyn davey', 'jr'],
      'Jesse W. Smith': ['jesse smith', null],
      'Tom Liberatore^': ['tom liberatore', null],
      'John Kennedy Jr.': ['john kennedy', 'jr'],
      "Ernie Hug, Sr.": ['ernie hug', 'sr'],
    });
  });
});

describe('father_son.py resolution rules', () => {
  const row2001: Raw = { year: 2001, drafted_player: 'Gary Ablett, Jr.', club: 'Geelong', father: 'Gary Ablett, Sr.', selection: '40', games: '247', father_games: '242' };
  const row2004: Raw = { year: 2004, drafted_player: 'Nathan Ablett', club: 'Geelong', father: 'Gary Ablett, Sr.', selection: '48', games: '32', father_games: '242' };

  it('resolves son and father by name, era window and club lineage, with the suffix rule deciding same-name pairs', () => {
    const res = normalise([row2001, row2004], roster);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => [r.source_key, r.competition, r.selection_pick, r.drafted_profile, r.drafted_link, r.father_profile, r.father_link])).toEqual([
      ['wikipedia-father-son-rule:2001:01', 'national', '40', 'players/G/Gary_Ablett1.html', 'unique', 'players/G/Gary_Ablett0.html', 'unique'],
      ['wikipedia-father-son-rule:2004:01', 'national', '48', 'players/N/Nathan_Ablett.html', 'unique', 'players/G/Gary_Ablett0.html', 'unique'],
    ]);
    // Games figures are corroboration, reported in the note, never used to choose.
    expect(res.rows[0].father_note).toMatch(/games differ/);       // 242 is the Geelong-only figure; the synthetic career is 248 in total and 248 at Geelong
    expect(res.rows[1].drafted_note).toMatch(/games differ/);
  });

  it('classifies pre-draft and rookie selections from the list\'s own pick column', () => {
    const res = normalise([
      { ...row2001, selection: '' },
      { ...row2004, selection: '48 (rookie)' },
    ], roster);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => [r.competition, r.selection_pick])).toEqual([['pre-draft', ''], ['rookie', '48']]);
  });

  it('a son with 0 listed games and no candidate is a non-player; one with games needs an adjudication', () => {
    const none = normalise([{ year: 2003, drafted_player: 'Brayden Shaw', club: 'Geelong', father: 'Gary Ablett', games: '0', father_games: '242' }], roster);
    expect(none.ok).toBe(true);
    if (none.ok) expect([none.rows[0].drafted_link, none.rows[0].drafted_profile, none.rows[0].drafted_note]).toEqual(['unmatched', '', 'never played a VFL/AFL match (list: 0 games)']);
    const some = normalise([{ year: 2003, drafted_player: 'Brad Campbell', club: 'Geelong', father: 'Gary Ablett', games: '1', father_games: '242' }], roster);
    expect(some).toEqual({ ok: false, error: expect.stringMatching(/son 'Brad Campbell'.*has no candidate.*adjudication is required/) });
  });

  it('a father with a state-league or administrator annotation and no candidate is unlinked; a plain games figure needs an adjudication', () => {
    const state = normalise([{ year: 2004, drafted_player: 'Nathan Ablett', club: 'Geelong', father: 'Noel Morton', games: '32', father_games: '171 (Claremont)' }], roster);
    expect(state.ok).toBe(true);
    if (state.ok) expect([state.rows[0].father_link, state.rows[0].father_note]).toEqual(['unmatched', 'no VFL/AFL career (list: 171 (Claremont))']);
    const admin = normalise([{ year: 2004, drafted_player: 'Nathan Ablett', club: 'Geelong', father: 'Garry Fletcher', games: '32', father_games: 'N/A (Administrator)' }], roster);
    expect(admin.ok).toBe(true);
    const plain = normalise([{ year: 2004, drafted_player: 'Nathan Ablett', club: 'Geelong', father: 'Billy Brownless', games: '32', father_games: '198' }], roster);
    expect(plain).toEqual({ ok: false, error: expect.stringMatching(/father 'Billy Brownless'.*reports '198' VFL\/AFL games; an adjudication is required/) });
  });

  it('a father who matches by name and era but never played for the club\'s lineage refuses without an adjudication, and an explicit unlinked adjudication is honoured', () => {
    const peake = { ...geelong(9, 'Brian Peake', 1981, 66), club_games: { geelong: 66 } };
    const raw: Raw = { year: 2003, drafted_player: 'Nathan Ablett', club: 'Fremantle', father: 'Brian Peake', games: '32', father_games: '305 (East Fremantle)' };
    const fremantleSon = { ...nathan, club_games: { fremantle: 34 } };
    expect(normalise([raw], [peake, fremantleSon])).toEqual({ ok: false, error: expect.stringMatching(/matches by name and era only.*never played for the club's lineage/) });
    const linked = normalise([raw], [peake, fremantleSon], [{ role: 'father', draft_year: 2003, club: 'Fremantle', name_raw: 'Brian Peake', afltables_profile: peake.profile, evidence: 'Wikipedia Brett Peake' }]);
    expect(linked.ok).toBe(true);
    if (linked.ok) expect([linked.rows[0].father_link, linked.rows[0].father_profile, linked.rows[0].father_note]).toEqual(['resolved', peake.profile, expect.stringMatching(/^adjudicated \(2026-09-05\): Wikipedia Brett Peake/)]);
    const unlinked = normalise([raw], [peake, fremantleSon], [{ role: 'father', draft_year: 2003, club: 'Fremantle', name_raw: 'Brian Peake', afltables_profile: null, evidence: 'no source ties them' }]);
    expect(unlinked.ok).toBe(true);
    if (unlinked.ok) expect([unlinked.rows[0].father_link, unlinked.rows[0].father_profile]).toEqual(['unmatched', '']);
  });

  it('the Brisbane Lions lineage admits Fitzroy and Bears games; no other organisation borrows', () => {
    const brown = { player_id: 20, profile: 'players/B/Brian_Brown.html', display_name: 'Brian Brown', debut_season: 1970, games: 51, club_games: { fitzroy: 51 } };
    const jonathan = { player_id: 21, profile: 'players/J/Jonathan_Brown.html', display_name: 'Jonathan Brown', debut_season: 2000, games: 256, club_games: { 'brisbane-lions': 256 } };
    const ok = normalise([{ year: 1999, drafted_player: 'Jonathan Brown', club: 'Brisbane Lions', father: 'Brian Brown', games: '256', father_games: '51 (Fitzroy)' }], [brown, jonathan]);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect([ok.rows[0].father_link, ok.rows[0].father_note]).toEqual(['unique', expect.stringMatching(/games corroborated/)]);
    const geelongSon = { ...jonathan, club_games: { geelong: 256 } };
    const refused = normalise([{ year: 1999, drafted_player: 'Jonathan Brown', club: 'Geelong', father: 'Brian Brown', games: '256', father_games: '51 (Fitzroy)' }], [brown, geelongSon]);
    expect(refused).toEqual({ ok: false, error: expect.stringMatching(/never played for the club's lineage/) });
  });

  it('refuses an ambiguous son, a stale adjudication, an unused adjudication and a repeated pair', () => {
    const twin = { ...ablettJr, player_id: 4, profile: 'players/G/Gary_Ablett2.html' };
    expect(normalise([row2001], [...roster, twin])).toEqual({ ok: false, error: expect.stringMatching(/son 'Gary Ablett, Jr\.'.*is ambiguous: players\/G\/Gary_Ablett1\.html.*players\/G\/Gary_Ablett2\.html/) });
    expect(normalise([row2001], roster, [{ role: 'son', draft_year: 2001, club: 'Geelong', name_raw: 'Gary Ablett, Jr.', afltables_profile: 'players/G/Gary_Ablett1.html' }]))
      .toEqual({ ok: false, error: expect.stringMatching(/resolves by rule to players\/G\/Gary_Ablett1\.html; the adjudication is stale/) });
    expect(normalise([row2001], roster, [{ role: 'father', draft_year: 1999, club: 'Geelong', name_raw: 'Nobody', afltables_profile: null }]))
      .toEqual({ ok: false, error: expect.stringMatching(/applied to no row.*father Nobody Geelong 1999/) });
    expect(normalise([row2001, { ...row2001, line: 9 }], roster)).toEqual({ ok: false, error: expect.stringMatching(/appears twice/) });
  });
});

describe('father_son.py accepted artefact', () => {
  const header = 'source_key,draft_year,competition,selection_pick,selection_raw,club,drafted_player,drafted_games_reported,drafted_profile,drafted_link,drafted_note,father,father_games_reported,father_profile,father_link,father_note\n';
  const line = (key: string, comp: string, pick: string, son: string, sonLink: string, father: string, fatherLink: string, sonName = 'Gary Ablett, Jr.') =>
    `${key},${key.split(':')[1]},${comp},${pick},${pick},Geelong,"${sonName}",247,${son},${sonLink},"n, note",Gary Ablett,242,${father},${fatherLink},note\n`;
  const good = header
    + line('wikipedia-father-son-rule:2001:01', 'national', '40', 'players/G/Gary_Ablett1.html', 'unique', 'players/G/Gary_Ablett0.html', 'unique')
    + line('wikipedia-father-son-rule:2004:01', 'pre-draft', '', '', 'unmatched', 'players/G/Gary_Ablett0.html', 'resolved', 'Nathan Ablett');

  it('accepts a well-formed artefact and measures it', () => {
    expect(readArtefact(good)).toEqual({ ok: true, measures: { selections: 2, sons_linked: 1, fathers_linked: 2, distinct_fathers_linked: 1, distinct_sons_linked: 1 } });
  });

  it('refuses a status that disagrees with its profile, a duplicate key, a repeated pair, a pre-draft pick and a bad competition', () => {
    expect(readArtefact(header + line('wikipedia-father-son-rule:2001:01', 'national', '40', '', 'unique', 'players/G/Gary_Ablett0.html', 'unique'))).toEqual({ ok: false, error: expect.stringMatching(/drafted_link unique disagrees with profile ''/) });
    expect(readArtefact(header + line('wikipedia-father-son-rule:2001:01', 'national', '40', 'players/G/Gary_Ablett1.html', 'unmatched', 'players/G/Gary_Ablett0.html', 'unique'))).toEqual({ ok: false, error: expect.stringMatching(/drafted_link unmatched disagrees/) });
    const dupKey = good.replace('wikipedia-father-son-rule:2004:01,2004', 'wikipedia-father-son-rule:2001:01,2001');
    expect(readArtefact(dupKey)).toEqual({ ok: false, error: expect.stringMatching(/duplicate source_key/) });
    const dupPair = header
      + line('wikipedia-father-son-rule:2001:01', 'national', '40', 'players/G/Gary_Ablett1.html', 'unique', 'players/G/Gary_Ablett0.html', 'unique')
      + line('wikipedia-father-son-rule:2001:02', 'national', '41', 'players/G/Gary_Ablett1.html', 'unique', 'players/G/Gary_Ablett0.html', 'unique');
    expect(readArtefact(dupPair)).toEqual({ ok: false, error: expect.stringMatching(/appears twice/) });
    expect(readArtefact(header + line('wikipedia-father-son-rule:2001:01', 'pre-draft', '40', 'players/G/Gary_Ablett1.html', 'unique', 'players/G/Gary_Ablett0.html', 'unique'))).toEqual({ ok: false, error: expect.stringMatching(/pre-draft rows have no pick/) });
    expect(readArtefact(header + line('wikipedia-father-son-rule:2001:01', 'trade', '40', 'players/G/Gary_Ablett1.html', 'unique', 'players/G/Gary_Ablett0.html', 'unique'))).toEqual({ ok: false, error: expect.stringMatching(/competition 'trade'/) });
    expect(readArtefact(header)).toEqual({ ok: false, error: expect.stringMatching(/no data rows/) });
    expect(readArtefact('a,b\n1,2\n')).toEqual({ ok: false, error: expect.stringMatching(/columns/) });
  });

  it('the tracked artefact validates offline through the loader, and its adjudications are exactly the seven recorded', () => {
    const proc = spawnSync(python, ['tools/migration/father_son.py', 'load', '--validate-only'], { cwd: repositoryRoot, encoding: 'utf8' });
    expect(proc.status, proc.stderr).toBe(0);
    expect(proc.stdout).toMatch(/127 selections, shape verified; provenance revision 1370239415/);
    const adjudications = readFileSync(join(repositoryRoot, 'data', 'players', 'father-son-adjudications.csv'), 'utf8')
      .split(/\r?\n/).filter((l) => l.trim() !== '').slice(1).map((l) => l.split(',').slice(0, 4).join(','));
    expect(adjudications).toEqual([
      'son,1992,Melbourne,Brad Campbell',
      'father,2018,Geelong,Billy Brownless',
      'father,1989,West Coast,John McIntosh',
      'father,1995,West Coast,Bryan Cousins',
      'father,2002,Port Adelaide,Russell Ebert',
      'father,2003,Fremantle,Brian Peake',
      'father,1999,Brisbane Lions,Peter Morrison',
    ]);
    const artefact = readFileSync(join(repositoryRoot, 'data', 'players', 'father-son-selections.csv'), 'utf8');
    const adjudicated = artefact.split(/\r?\n/).filter((l) => /adjudicated/.test(l));
    expect(adjudicated).toHaveLength(7);
    // Peter Morrison is the one explicit non-link: adjudicated AND unmatched.
    expect(adjudicated.filter((l) => /Peter Morrison/.test(l) && /,unmatched,"adjudicated unlinked/.test(l))).toHaveLength(1);
  });
});
