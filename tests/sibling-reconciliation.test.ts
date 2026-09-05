/**
 * AFLDB-ISSUE-118 §23.31 family F (siblings): the identity and pairing rules of
 * tools/migration/family_siblings.py, exercised on synthetic rows through the
 * interpreter the way tests/father-son-reconciliation.test.ts exercises father_son.py.
 * No database.
 *
 * The rules under test:
 *   - a person is the unique same-name player (Sr./Jr. suffix rule), narrowed by the
 *     listed VFL/AFL clubs when any is one, then by the Wikipedia title's birth year
 *     only when every candidate has a birth year; listed clubs all outside the VFL/AFL
 *     mean unlinked whatever the name matches;
 *   - more than one candidate stays ambiguous and UNLINKED unless a tracked adjudication
 *     decides it; every adjudication must be needed and used (a stale one refuses);
 *   - the pair is ordered deterministically and a reversed source ordering is one pair;
 *     two people resolving to the same profile refuse (self-pair); a family listed twice
 *     merges into one pair with the merged key recorded;
 *   - the canonical label states what is evidenced: brothers from the export's own
 *     label or sentence, sisters from the sentence, brothers/twin brothers when both
 *     people are canonical (men's competition) players, else the export's label;
 *   - the accepted artefact's shape is checked offline.
 *
 * The last block reads the TRACKED artefact and proves the reconciliation counts the
 * runbook records, derived from the artefact itself: never a magic number typed here.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseCsvRows } from '../tools/db/rebuild-test';

const repositoryRoot = join(__dirname, '..');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

type Cand = { player_id: number; profile: string; display_name: string; debut_season: number | null; games: number | null; birth_year: number | null; club_games: Record<string, number> };
type Member = { id: string; name: string; url?: string; clubs?: string; legacy_status?: string; legacy_id?: string; family?: string };
type Sup = { supplement_key: string; family_key?: string; person_a_name: string; person_a_profile: string; person_b_name: string; person_b_profile: string; relationship_label?: string; evidence?: string; decided_on?: string };
type Row = { id: string; a: string; a_role?: string; b: string; b_role?: string; label?: string; evidence?: string; family?: string };
type Adj = { source_member_id: string; member_name?: string; afltables_profile: string | null; evidence?: string; decided_on?: string };
type Result = { ok: true; rows: Record<string, string>[] } | { ok: false; error: string };

function run(script: string, payload: object): string {
  const proc = spawnSync(python, ['-c', script], { cwd: repositoryRoot, input: JSON.stringify(payload), encoding: 'utf8' });
  if (proc.status !== 0) throw new Error(`python exited ${proc.status}: ${proc.stderr}`);
  return proc.stdout;
}

const key = (n: number) => n.toString(16).padStart(24, '0');

function normalise(members: Member[], rows: Row[], candidates: Cand[], adjudications: Adj[] = [], supplements: Sup[] = [], orgs = ['geelong', 'hawthorn', 'essendon', 'carlton', 'sydney', 'brisbane-lions', 'fitzroy']): Result {
  const script = `
import json, sys
sys.path.insert(0, 'tools/migration')
import family_siblings as m
data = json.loads(sys.stdin.read())
roster = m.Roster(m.Candidate(c['player_id'], c['profile'], c['display_name'], None, None, c['debut_season'], c['games'], c['birth_year'], c['club_games']) for c in data['candidates'])
members = {x['id']: m.Member(x['id'], x.get('family', 'f-0001'), 'F', x['name'], x.get('url', ''), x.get('clubs', ''), x.get('legacy_id', ''), x.get('legacy_status', 'unique'), '') for x in data['members']}
rows = [m.SiblingRow(i + 2, r['id'], r.get('family', 'f-0001'), 'F', r['a'], members[r['a']].name, r.get('a_role', 'sibling'), r['b'], members[r['b']].name, r.get('b_role', 'sibling'), r.get('label', 'siblings/brothers'), r.get('evidence', 'A and B were brothers.'), 'prose_rule', 'high', 'u', '1') for i, r in enumerate(data['rows'])]
adj = [m.Adjudication(a['source_member_id'], a.get('member_name', ''), a.get('afltables_profile'), a.get('evidence', 'e'), a.get('decided_on', '2026-09-05')) for a in data['adjudications']]
sup = [m.Supplement(x['supplement_key'], x.get('family_key', 'f-0001'), 'F', x['person_a_name'], x['person_a_profile'], x['person_b_name'], x['person_b_profile'], x.get('relationship_label', 'brothers'), x.get('evidence', 'A is the brother of B.'), x.get('decided_on', '2026-09-05')) for x in data['supplements']]
try:
    out = m.normalise_rows(rows, members, roster, set(data['orgs']), adj, sup)
except m.SiblingSourceError as exc:
    print(json.dumps({'ok': False, 'error': str(exc)})); sys.exit(0)
print(json.dumps({'ok': True, 'rows': out}))
`;
  return JSON.parse(run(script, { members, rows, candidates, adjudications, supplements, orgs })) as Result;
}

function readArtefact(text: string): { ok: true; measures: Record<string, number> } | { ok: false; error: string } {
  const script = `
import json, sys, tempfile, pathlib
sys.path.insert(0, 'tools/migration')
import family_siblings as m
text = json.loads(sys.stdin.read())['text']
p = pathlib.Path(tempfile.mkdtemp()) / 'a.csv'
p.write_text(text, encoding='utf-8', newline='')
try:
    rows = m.read_artefact(p)
except m.SiblingSourceError as exc:
    print(json.dumps({'ok': False, 'error': str(exc)})); sys.exit(0)
print(json.dumps({'ok': True, 'measures': m.artefact_measures(rows)}))
`;
  return JSON.parse(run(script, { text }));
}

function helpers(): { clubs: Record<string, string[]>; born: Record<string, number | null>; labels: string[] } {
  const script = `
import json, sys
sys.path.insert(0, 'tools/migration')
import family_siblings as m
d = json.loads(sys.stdin.read())
print(json.dumps({'clubs': {v: m.parse_clubs(v) for v in d['clubs']}, 'born': {v: m.born_year(v) for v in d['urls']},
                  'labels': [m.canonical_label(*a) for a in d['labels']]}))
`;
  return JSON.parse(run(script, {
    clubs: ['Perth , Swan Districts & East Perth', 'Hawthorn / Geelong', 'Footscray', 'West Torrens , Fitzroy and Brisbane', 'Sydney Swans', ''],
    urls: ['https://en.wikipedia.org/wiki/Alan_Richardson_(footballer,_born_1940)', 'https://en.wikipedia.org/wiki/Mark_Williams_(Australian_footballer_born_1958)',
      'https://en.wikipedia.org/wiki/Jock_O%27Brien_(footballer,_born_1909)', 'https://en.wikipedia.org/wiki/Ron_Evans', ''],
    labels: [['siblings/brothers', 'Bob and Jim were brothers.', false], ['twins', 'Paul and Simon are twins.', true], ['twins', 'Breann and Celine are twins.', false],
      ['twins', 'All four were brothers (Adam and Troy were twins).', false], ['siblings', 'Darcie, Fleur and Giselle are sisters.', false],
      ['siblings', 'Hannah is the older sister of Rachelle.', false], ['siblings', 'Gemma and Joel are siblings.', false], ['siblings', 'Zac and Noah are siblings.', true]],
  }));
}

const cand = (id: number, name: string, debut: number, games: number, born: number | null, clubs: Record<string, number>, profile = `players/X/${name.replace(/[^A-Za-z]/g, '_')}${id}.html`): Cand =>
  ({ player_id: id, profile, display_name: name, debut_season: debut, games, birth_year: born, club_games: clubs });

const gary = cand(1, 'Gary Ablett', 1982, 248, 1961, { hawthorn: 6, geelong: 242 }, 'players/G/Gary_Ablett0.html');
const garyJr = cand(2, 'Gary Ablett', 2002, 357, 1984, { geelong: 357 }, 'players/G/Gary_Ablett1.html');
const geoff = cand(3, 'Geoff Ablett', 1975, 202, 1955, { hawthorn: 202 }, 'players/G/Geoff_Ablett.html');
const kevin = cand(4, 'Kevin Ablett', 1980, 22, 1958, { hawthorn: 22 }, 'players/K/Kevin_Ablett.html');
const roster = [gary, garyJr, geoff, kevin];
const M = (id: number, name: string, extra: Partial<Member> = {}): Member => ({ id: key(id), name, ...extra });

describe('family_siblings.py helpers', () => {
  it('splits listed clubs on the export\'s separators, maps organisation spellings, and reads the title birth year', () => {
    const h = helpers();
    expect(h.clubs).toEqual({
      'Perth , Swan Districts & East Perth': ['perth', 'swan-districts', 'east-perth'],
      'Hawthorn / Geelong': ['hawthorn', 'geelong'],
      'Footscray': ['western-bulldogs'],
      'West Torrens , Fitzroy and Brisbane': ['west-torrens', 'fitzroy', 'brisbane-lions'],
      'Sydney Swans': ['sydney'],
      '': [],
    });
    expect(h.born).toEqual({
      'https://en.wikipedia.org/wiki/Alan_Richardson_(footballer,_born_1940)': 1940,
      'https://en.wikipedia.org/wiki/Mark_Williams_(Australian_footballer_born_1958)': 1958,
      'https://en.wikipedia.org/wiki/Jock_O%27Brien_(footballer,_born_1909)': 1909,
      'https://en.wikipedia.org/wiki/Ron_Evans': null,
      '': null,
    });
  });

  it('labels what the source evidences: brothers, twin brothers, sisters, else the export\'s label', () => {
    expect(helpers().labels).toEqual(['brothers', 'twin brothers', 'twins', 'twin brothers', 'sisters', 'sisters', 'siblings', 'brothers']);
  });
});

describe('family_siblings.py resolution rules', () => {
  const members = [M(1, 'Gary Ablett Sr', { clubs: 'Hawthorn / Geelong' }), M(2, 'Geoff Ablett'), M(3, 'Kevin Ablett')];
  const rows: Row[] = [
    { id: key(11), a: key(1), a_role: 'brother', b: key(2), evidence: 'Gary is the brother of Geoff and Kevin.' },
    { id: key(12), a: key(3), b: key(1), a_role: 'sibling', b_role: 'brother', evidence: 'Gary is the brother of Geoff and Kevin.' },
  ];

  it('resolves by name, suffix and listed club; orders each pair deterministically with roles travelling', () => {
    const res = normalise(members, rows, roster);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => [r.source_key, r.person_a_name, r.person_a_role, r.person_a_profile, r.person_a_link, r.person_b_name, r.person_b_role, r.person_b_profile, r.relationship_label])).toEqual([
      [key(11), 'Gary Ablett Sr', 'brother', 'players/G/Gary_Ablett0.html', 'unique', 'Geoff Ablett', 'sibling', 'players/G/Geoff_Ablett.html', 'brothers'],
      [key(12), 'Gary Ablett Sr', 'brother', 'players/G/Gary_Ablett0.html', 'unique', 'Kevin Ablett', 'sibling', 'players/K/Kevin_Ablett.html', 'brothers'],
    ]);
    expect(res.rows[0].person_a_note).toBe('name, sr. suffix, played for a listed club (hawthorn, geelong)');
    expect(res.rows[0].person_a_legacy).toBe('unique');
  });

  it('a same-name pair narrows by the listed club, then by the title birth year only when every candidate is dated', () => {
    const byClub = normalise([M(1, 'Gary Ablett', { clubs: 'Hawthorn' }), M(2, 'Geoff Ablett')], [{ id: key(11), a: key(1), b: key(2) }], roster);
    expect(byClub.ok).toBe(true);
    if (byClub.ok) expect([byClub.rows[0].person_a_profile, byClub.rows[0].person_a_note]).toEqual(['players/G/Gary_Ablett0.html', 'name, played for a listed club (hawthorn)']);
    const byYear = normalise([M(1, 'Gary Ablett', { url: 'https://en.wikipedia.org/wiki/Gary_Ablett_(footballer,_born_1984)' }), M(2, 'Geoff Ablett')], [{ id: key(11), a: key(1), b: key(2) }], roster);
    expect(byYear.ok).toBe(true);
    if (byYear.ok) expect([byYear.rows[0].person_a_profile, byYear.rows[0].person_a_note]).toEqual(['players/G/Gary_Ablett1.html', 'name, Wikipedia title birth year 1984']);
    const undated = normalise([M(1, 'Gary Ablett', { url: 'https://en.wikipedia.org/wiki/Gary_Ablett_(footballer,_born_1984)' }), M(2, 'Geoff Ablett')], [{ id: key(11), a: key(1), b: key(2) }],
      [{ ...gary, birth_year: null }, garyJr, geoff]);
    expect(undated.ok).toBe(true);
    if (undated.ok) expect([undated.rows[0].person_a_profile, undated.rows[0].person_a_link, undated.rows[0].person_a_note]).toEqual(['', 'ambiguous', expect.stringMatching(/^candidates: players\/G\/Gary_Ablett0\.html \(debut 1982, born \?, 248 games\), players\/G\/Gary_Ablett1\.html/)]);
    expect(undated.ok && undated.rows[0].relationship_label).toBe('brothers'); // the sentence says brothers; the link does not decide the label
  });

  it('listed clubs all outside the VFL/AFL are unlinked whatever the name matches; no candidate is unmatched', () => {
    const outside = normalise([M(1, 'Geoff Ablett', { clubs: 'Perth , Swan Districts' }), M(2, 'Kevin Ablett')], [{ id: key(11), a: key(1), b: key(2) }], roster);
    expect(outside.ok).toBe(true);
    if (outside.ok) expect([outside.rows[0].person_a_link, outside.rows[0].person_a_note, outside.rows[0].person_a_profile]).toEqual(['unmatched', 'listed clubs are not VFL/AFL clubs (Perth , Swan Districts)', '']);
    const nobody = normalise([M(1, 'Nathan Ablett'), M(2, 'Kevin Ablett')], [{ id: key(11), a: key(1), b: key(2), label: 'siblings', evidence: 'Nathan and Kevin are siblings.' }], roster);
    expect(nobody.ok).toBe(true);
    if (nobody.ok) expect([nobody.rows[0].person_a_link, nobody.rows[0].person_a_note, nobody.rows[0].relationship_label]).toEqual(['unmatched', 'no VFL/AFL player of that name', 'siblings']);
    // The pair is ordered by person key ('name:…' for an unlinked person, the profile path for a linked one):
    // the unlinked Nathan sorts before Kevin's profile path, whichever way the export wrote them.
    if (nobody.ok) expect([nobody.rows[0].person_a_name, nobody.rows[0].person_b_name, nobody.rows[0].person_b_link]).toEqual(['Nathan Ablett', 'Kevin Ablett', 'unique']);
  });

  it('an adjudication decides an ambiguous member, must be needed, and an explicit unlinked one is honoured', () => {
    const members2 = [M(1, 'Gary Ablett'), M(2, 'Geoff Ablett')];
    const row: Row[] = [{ id: key(11), a: key(1), b: key(2) }];
    const linked = normalise(members2, row, roster, [{ source_member_id: key(1), afltables_profile: 'players/G/Gary_Ablett0.html', evidence: 'Wikipedia Gary Ablett Sr' }]);
    expect(linked.ok).toBe(true);
    if (linked.ok) expect([linked.rows[0].person_a_link, linked.rows[0].person_a_profile, linked.rows[0].person_a_note]).toEqual(['resolved', 'players/G/Gary_Ablett0.html', 'adjudicated (2026-09-05): Wikipedia Gary Ablett Sr']);
    const unlinked = normalise(members2, row, roster, [{ source_member_id: key(1), afltables_profile: null, evidence: 'no source ties them' }]);
    expect(unlinked.ok).toBe(true);
    if (unlinked.ok) expect([unlinked.rows[0].person_a_link, unlinked.rows[0].person_a_profile, unlinked.rows[0].relationship_label]).toEqual(['unmatched', '', 'brothers']);
    expect(normalise(members2, row, roster, [{ source_member_id: key(2), afltables_profile: 'players/G/Geoff_Ablett.html' }]))
      .toEqual({ ok: false, error: expect.stringMatching(/Geoff Ablett' resolves by rule to players\/G\/Geoff_Ablett\.html; the adjudication is stale/) });
    expect(normalise(members2, row, roster, [{ source_member_id: key(9), member_name: 'Nobody', afltables_profile: null }]))
      .toEqual({ ok: false, error: expect.stringMatching(/applied to no sibling member.*Nobody/) });
  });

  it('a supplement adds an explicitly evidenced pair the export lacks; a stale or non-identity supplement refuses', () => {
    // Absence of an export row is unknown coverage, never a negative: Gary Jr and Nathan are
    // brothers on their own articles' words, admitted only through the supplement.
    const members2 = [M(1, 'Geoff Ablett'), M(2, 'Kevin Ablett')];
    const row: Row[] = [{ id: key(11), a: key(1), b: key(2) }];
    const nathan = cand(5, 'Nathan Ablett', 2005, 34, 1985, { geelong: 32, 'gold-coast': 2 }, 'players/N/Nathan_Ablett.html');
    const sup: Sup = { supplement_key: 'afldb-sibling-supplement:001', family_key: 'ablett-0004', person_a_name: 'Nathan Ablett', person_a_profile: 'players/N/Nathan_Ablett.html',
      person_b_name: 'Gary Ablett Jr', person_b_profile: 'players/G/Gary_Ablett1.html', evidence: 'Wikipedia: the younger brother of Gary Ablett Jr' };
    const res = normalise(members2, row, [...roster, nathan], [], [sup]);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (res.ok) {
      expect(res.rows).toHaveLength(2);
      const added = res.rows.find((r) => r.source_key === sup.supplement_key)!;
      expect([added.person_a_name, added.person_a_profile, added.person_a_link, added.person_b_name, added.person_b_profile, added.person_b_link, added.relationship_label, added.source_label, added.extraction_method])
        .toEqual(['Gary Ablett Jr', 'players/G/Gary_Ablett1.html', 'resolved', 'Nathan Ablett', 'players/N/Nathan_Ablett.html', 'resolved', 'brothers', 'supplement', 'adjudication']);
      expect(added.person_a_note).toBe('supplement (2026-09-05): Wikipedia: the younger brother of Gary Ablett Jr');
    }
    expect(normalise(members2, row, roster, [], [sup])).toEqual({ ok: false, error: expect.stringMatching(/players\/N\/Nathan_Ablett\.html is not a canonical identity/) });
    const stale: Sup = { ...sup, person_a_name: 'Geoff Ablett', person_a_profile: 'players/G/Geoff_Ablett.html', person_b_name: 'Kevin Ablett', person_b_profile: 'players/K/Kevin_Ablett.html' };
    expect(normalise(members2, row, roster, [], [stale])).toEqual({ ok: false, error: expect.stringMatching(/the export already carries the pair.*the supplement is stale/) });
  });

  it('two people who both resolve to canonical players are brothers whatever the export called them; the men\'s competition decides', () => {
    const twins = normalise([M(1, 'Geoff Ablett'), M(2, 'Kevin Ablett')], [{ id: key(11), a: key(1), b: key(2), label: 'twins', evidence: 'Geoff and Kevin are twins.' }], roster);
    expect(twins.ok && twins.rows[0].relationship_label).toBe('twin brothers');
    const siblings = normalise([M(1, 'Geoff Ablett'), M(2, 'Kevin Ablett')], [{ id: key(11), a: key(1), b: key(2), label: 'siblings', evidence: 'Geoff and Kevin are siblings.' }], roster);
    expect(siblings.ok && siblings.rows[0].relationship_label).toBe('brothers');
    const sisters = normalise([M(1, 'Darcie Nobody'), M(2, 'Fleur Nobody')], [{ id: key(11), a: key(1), b: key(2), label: 'siblings', evidence: 'Darcie and Fleur are sisters.' }], roster);
    expect(sisters.ok && [sisters.rows[0].relationship_label, sisters.rows[0].person_a_link, sisters.rows[0].person_b_link]).toEqual(['sisters', 'unmatched', 'unmatched']);
  });

  it('refuses a self-pair, merges a family listed twice into one pair, and refuses two unlinked namesake pairs', () => {
    const self = normalise([M(1, 'Gary Ablett Sr'), M(2, 'Gary Ablett Sr')], [{ id: key(11), a: key(1), b: key(2) }], roster);
    expect(self).toEqual({ ok: false, error: expect.stringMatching(/both people resolve to players\/G\/Gary_Ablett0\.html \(a self-pair\)/) });
    const twice = normalise(
      [M(1, 'Geoff Ablett'), M(2, 'Kevin Ablett'), M(3, 'Geoff Ablett', { family: 'ablett-0002' }), M(4, 'Kevin Ablett', { family: 'ablett-0002' })],
      [{ id: key(12), a: key(4), b: key(3), family: 'ablett-0002' }, { id: key(11), a: key(1), b: key(2) }], roster);
    expect(twice.ok, JSON.stringify(twice)).toBe(true);
    if (twice.ok) {
      expect(twice.rows).toHaveLength(1);
      // Kept: the first row in (family_key, source_key) order; the other's key is recorded.
      expect([twice.rows[0].source_key, twice.rows[0].family_key, twice.rows[0].also_source_keys]).toEqual([key(12), 'ablett-0002', key(11)]);
    }
    const namesakes = normalise([M(1, 'A Nobody'), M(2, 'B Nobody'), M(3, 'A Nobody'), M(4, 'B Nobody')],
      [{ id: key(11), a: key(1), b: key(2) }, { id: key(12), a: key(3), b: key(4) }], roster);
    expect(namesakes).toEqual({ ok: false, error: expect.stringMatching(/appears twice/) });
  });
});

describe('family_siblings.py accepted artefact', () => {
  const header = 'source_key,family_key,family_name,person_a_name,person_a_role,person_a_wikipedia,person_a_clubs,person_a_legacy,person_a_profile,person_a_link,person_a_note,'
    + 'person_b_name,person_b_role,person_b_wikipedia,person_b_clubs,person_b_legacy,person_b_profile,person_b_link,person_b_note,relationship_label,source_label,evidence,extraction_method,source_revision_id,also_source_keys\n';
  const line = (k: string, aName: string, a: string, aLink: string, bName: string, b: string, bLink: string, label = 'brothers', source = 'siblings/brothers', evidence = 'A and B were brothers.', also = '') =>
    `${k},ablett-0004,Ablett,${aName},brother,u,,unique:1,${a},${aLink},"n, note",${bName},sibling,u,,unmatched,${b},${bLink},note,${label},${source},"${evidence}",prose_rule,1,${also}\n`;
  const good = header
    + line(key(1), 'Gary Ablett Sr', 'players/G/Gary_Ablett0.html', 'unique', 'Geoff Ablett', 'players/G/Geoff_Ablett.html', 'unique')
    + line(key(2), 'Nathan Ablett', '', 'unmatched', 'Kevin Ablett', 'players/K/Kevin_Ablett.html', 'resolved', 'siblings', 'siblings', 'Kevin and Nathan are siblings.', key(3))
    + line('afldb-sibling-supplement:001', 'Gary Ablett Jr', 'players/G/Gary_Ablett1.html', 'resolved', 'Nathan Ablett', 'players/N/Nathan_Ablett.html', 'resolved', 'brothers', 'supplement', 'the younger brother of Gary Ablett Jr');

  it('accepts a well-formed artefact and measures it', () => {
    expect(readArtefact(good)).toEqual({ ok: true, measures: {
      pairs: 3, pairs_both_linked: 2, pairs_one_linked: 1, pairs_unlinked: 0, brother_pairs_linked: 2, players_with_brother: 4,
      unlinked_sides: 1, ambiguous_sides: 0, adjudicated_sides: 0, merged_duplicate_rows: 1, supplement_pairs: 1,
    } });
  });

  it('refuses a status that disagrees with its profile, a duplicate or unordered pair, a self-pair, a repeated key and an unevidenced brothers label', () => {
    expect(readArtefact(header + line(key(1), 'Gary Ablett Sr', '', 'unique', 'Geoff Ablett', 'players/G/Geoff_Ablett.html', 'unique'))).toEqual({ ok: false, error: expect.stringMatching(/person_a_link unique disagrees with profile ''/) });
    expect(readArtefact(header + line(key(1), 'Gary Ablett Sr', 'players/G/Gary_Ablett0.html', 'ambiguous', 'Geoff Ablett', 'players/G/Geoff_Ablett.html', 'unique'))).toEqual({ ok: false, error: expect.stringMatching(/person_a_link ambiguous disagrees/) });
    expect(readArtefact(header + line(key(1), 'Geoff Ablett', 'players/G/Geoff_Ablett.html', 'unique', 'Gary Ablett Sr', 'players/G/Gary_Ablett0.html', 'unique'))).toEqual({ ok: false, error: expect.stringMatching(/not in canonical order/) });
    expect(readArtefact(header + line(key(1), 'Gary Ablett Sr', 'players/G/Gary_Ablett0.html', 'unique', 'Gary Ablett Sr', 'players/G/Gary_Ablett0.html', 'unique'))).toEqual({ ok: false, error: expect.stringMatching(/self-pair/) });
    expect(readArtefact(good.replace(key(2), key(1)))).toEqual({ ok: false, error: expect.stringMatching(/duplicate source_key/) });
    const dupPair = header
      + line(key(1), 'Gary Ablett Sr', 'players/G/Gary_Ablett0.html', 'unique', 'Geoff Ablett', 'players/G/Geoff_Ablett.html', 'unique')
      + line(key(2), 'Gary Ablett Sr', 'players/G/Gary_Ablett0.html', 'unique', 'Geoff Ablett', 'players/G/Geoff_Ablett.html', 'unique');
    expect(readArtefact(dupPair)).toEqual({ ok: false, error: expect.stringMatching(/appears twice/) });
    expect(readArtefact(good.replace(key(3), key(1)))).toEqual({ ok: false, error: expect.stringMatching(/also_source_keys.*malformed or repeated/) });
    expect(readArtefact(header + line(key(1), 'Nathan Ablett', '', 'unmatched', 'Kevin Ablett', 'players/K/Kevin_Ablett.html', 'unique', 'brothers', 'siblings', 'Kevin and Nathan are siblings.')))
      .toEqual({ ok: false, error: expect.stringMatching(/brothers label without brother evidence or two linked players/) });
    expect(readArtefact(header + line('afldb-sibling-supplement:001', 'Nathan Ablett', '', 'unmatched', 'Kevin Ablett', 'players/K/Kevin_Ablett.html', 'resolved', 'brothers', 'supplement', 'brother')))
      .toEqual({ ok: false, error: expect.stringMatching(/a supplement pair must link both people as resolved/) });
    expect(readArtefact(header + line(key(1), 'Gary Ablett Jr', 'players/G/Gary_Ablett1.html', 'resolved', 'Nathan Ablett', 'players/N/Nathan_Ablett.html', 'resolved', 'brothers', 'supplement', 'brother')))
      .toEqual({ ok: false, error: expect.stringMatching(/source_key .* malformed/) });
    expect(readArtefact(header)).toEqual({ ok: false, error: expect.stringMatching(/no data rows/) });
    expect(readArtefact('a,b\n1,2\n')).toEqual({ ok: false, error: expect.stringMatching(/columns/) });
  });

  it('the tracked artefact validates offline, its adjudications are exactly the eight recorded, its supplements are the fourteen evidenced pairs, and its reconciliation counts hold', () => {
    const proc = spawnSync(python, ['tools/migration/family_siblings.py', 'load', '--validate-only'], { cwd: repositoryRoot, encoding: 'utf8' });
    expect(proc.status, proc.stderr).toBe(0);
    expect(proc.stdout).toMatch(/498 sibling pairs, shape verified; provenance revision 1365040810/);
    // Every supplement is a pair the export lacks (its prose rule saw only "X is the father of
    // A and B", or missed the family note), admitted on the people's own articles' words.
    // Absence of an export row is unknown coverage, never a negative.
    const supplements = parseCsvRows(readFileSync(join(repositoryRoot, 'data', 'players', 'sibling-supplements.csv'), 'utf8')).slice(1);
    expect(supplements.map((r) => `${r[0].split(':')[1]} ${r[4]} ~ ${r[6]} (${r[7]})`)).toEqual([
      '001 players/G/Gary_Ablett1.html ~ players/N/Nathan_Ablett.html (brothers)',
      '002 players/A/Angus_Brayshaw.html ~ players/A/Andrew_Brayshaw.html (brothers)',
      '003 players/A/Angus_Brayshaw.html ~ players/H/Hamish_Brayshaw.html (brothers)',
      '004 players/B/Brad_Ottens.html ~ players/L/Luke_Ottens.html (brothers)',
      '005 players/C/Cameron_Mooney.html ~ players/J/Jason_Mooney.html (brothers)',
      '006 players/D/Darryl_Wakelin.html ~ players/S/Shane_Wakelin.html (twin brothers)',
      '007 players/J/Joe_Daniher.html ~ players/D/Darcy_Daniher.html (brothers)',
      '008 players/K/Kane_Cornes.html ~ players/C/Chad_Cornes.html (brothers)',
      '009 players/L/Luke_Ball.html ~ players/M/Matthew_Ball.html (brothers)',
      '010 players/P/Peter_Burgoyne.html ~ players/S/Shaun_Burgoyne.html (brothers)',
      '011 players/S/Sam_Reid2.html ~ players/B/Ben_Reid.html (brothers)',
      '012 players/T/Travis_Cloke.html ~ players/J/Jason_Cloke.html (brothers)',
      '013 players/T/Travis_Cloke.html ~ players/C/Cameron_Cloke.html (brothers)',
      '014 players/J/Jake_Kelly.html ~ players/W/Will_Kelly.html (brothers)',
    ]);
    for (const r of supplements) expect(r[8], r[0]).toMatch(/\bbrothers?\b/); // each quotes a sentence that says brother
    expect(supplements[0][8]).toMatch(/younger brother of Gary Ablett Jr/);
    const adjudications = parseCsvRows(readFileSync(join(repositoryRoot, 'data', 'players', 'sibling-adjudications.csv'), 'utf8')).slice(1);
    expect(adjudications.map((r) => `${r[1]} -> ${r[2]}`)).toEqual([
      'Alwyn Davey -> players/A/Alwyn_Davey0.html',
      'Ron Evans -> players/R/Ron_Evans1.html',
      'John Gill -> players/J/John_Gill1.html',
      'Andrew L. Krakouer -> players/A/Andrew_Krakouer0.html',
      'Bert Lucas -> players/B/Bert_Lucas0.html',
      'Jack Malone -> players/J/Jack_Malone1.html',
      'Frank Murphy -> players/F/Frank_Murphy0.html',
      'Ian Nankervis -> players/I/Ian_Nankervis0.html',
    ]);
    for (const r of adjudications) expect(r[3]).toMatch(/born \d{4}|born 1905/); // every adjudication cites a birth date
    const rows = parseCsvRows(readFileSync(join(repositoryRoot, 'data', 'players', 'sibling-relationships.csv'), 'utf8'));
    const header = rows[0];
    const col = (n: string) => header.indexOf(n);
    const data = rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
    const provenance = JSON.parse(readFileSync(join(repositoryRoot, 'data', 'players', 'sibling-relationships.source.json'), 'utf8'));
    expect(col('person_a_profile')).toBeGreaterThan(0);
    // Derived from the artefact, compared with the provenance's own measures and the source counts.
    const linked = data.filter((r) => r.person_a_profile && r.person_b_profile);
    const brothers = linked.filter((r) => r.relationship_label === 'brothers' || r.relationship_label === 'twin brothers');
    const measures = {
      pairs: data.length,
      pairs_both_linked: linked.length,
      pairs_one_linked: data.filter((r) => Boolean(r.person_a_profile) !== Boolean(r.person_b_profile)).length,
      pairs_unlinked: data.filter((r) => !r.person_a_profile && !r.person_b_profile).length,
      brother_pairs_linked: brothers.length,
      players_with_brother: new Set(brothers.flatMap((r) => [r.person_a_profile, r.person_b_profile])).size,
      unlinked_sides: data.reduce((n, r) => n + (r.person_a_profile ? 0 : 1) + (r.person_b_profile ? 0 : 1), 0),
      ambiguous_sides: data.filter((r) => r.person_a_link === 'ambiguous').length + data.filter((r) => r.person_b_link === 'ambiguous').length,
      adjudicated_sides: data.filter((r) => /adjudicated/.test(r.person_a_note)).length + data.filter((r) => /adjudicated/.test(r.person_b_note)).length,
      merged_duplicate_rows: data.reduce((n, r) => n + r.also_source_keys.split(/\s+/).filter(Boolean).length, 0),
      supplement_pairs: data.filter((r) => r.source_label === 'supplement').length,
    };
    expect(provenance.measures).toEqual(measures);
    expect(provenance.raw_relationship_types.sibling).toBe(provenance.raw_sibling_rows);
    expect(measures.supplement_pairs).toBe(supplements.length);
    expect(measures.pairs + measures.merged_duplicate_rows - measures.supplement_pairs).toBe(provenance.raw_sibling_rows);
    expect(measures.ambiguous_sides).toBe(0);              // every ambiguity was adjudicated on evidence
    expect(measures.adjudicated_sides).toBeGreaterThanOrEqual(adjudications.length);
    // No self-pair, no duplicate canonical pair, every pair in canonical order, no fuzzy link.
    const pairs = new Set<string>();
    for (const r of data) {
      expect(r.person_a_profile === '' || r.person_a_profile !== r.person_b_profile, r.source_key).toBe(true);
      const k = `${r.person_a_profile || `name:${r.person_a_name}`}|${r.person_b_profile || `name:${r.person_b_name}`}`;
      expect(pairs.has(k), k).toBe(false);
      pairs.add(k);
      for (const s of ['a', 'b']) {
        const link = r[`person_${s}_link`];
        const note = r[`person_${s}_note`];
        if (link === 'unique') expect(note, r.source_key).toMatch(/^name(, sr\. suffix| jr\. suffix)?(, played for a listed club \([^)]+\))?(, Wikipedia title birth year \d{4})?$/);
        if (link === 'resolved') expect(note, r.source_key).toMatch(/^(adjudicated|supplement) \(\d{4}-\d{2}-\d{2}\): /);
        expect(['unique', 'resolved', 'unmatched'].includes(link), r.source_key).toBe(true);
      }
      // A brothers label is evidenced by the source label, the sentence, or two linked players — never by a name.
      if (r.relationship_label === 'brothers' || r.relationship_label === 'twin brothers') {
        expect(r.source_label === 'siblings/brothers' || /\bbrothers?\b/i.test(r.evidence) || (r.person_a_profile !== '' && r.person_b_profile !== ''), r.source_key).toBe(true);
      }
      if (r.relationship_label === 'sisters') expect(r.person_a_profile + r.person_b_profile, r.source_key).toBe('');
    }
  });
});
