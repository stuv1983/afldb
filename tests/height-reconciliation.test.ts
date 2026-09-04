/**
 * AFLDB-ISSUE-118 Stage H2: the register -> profile-URL reconciliation in
 * tools/migration/enrich_heights.py is pure Python, so it is exercised here
 * on synthetic rows through the interpreter, the way the source parsers are
 * (tests/all-australian-source.test.ts). No database, no snapshot.
 *
 * The rule under test: a register row maps when exactly one (url, club)
 * aggregate shares its club, games, goals and exact season set AND carries
 * the same name as the source spells it. Everything else fails closed.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = join(__dirname, '..');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

type Result = { status: string; url: string | null; height: number | null; candidates: string[]; jumper: boolean | null };

const stat = (url: string, first: string, surname: string, team: string, season: number, goals = 0, jumper = '') => (
  { url, 'First.name': first, Surname: surname, Player: `${first} ${surname}`, 'Playing.for': team, Season: String(season), Goals: String(goals), 'Jumper.No.': jumper }
);
const reg = (player: string, team: string, games: number, goals: number, seasons: string, ht = '180cm', jumper = '', cap = '1') => (
  { Player: player, Team: team, Cap: cap, '#': jumper, HT: ht, Games: String(games), Goals: String(goals), Seasons: seasons }
);

function reconcile(register: object[], stats: object[]): Result[] {
  const script = `
import json, sys
sys.path.insert(0, 'tools/migration')
import enrich_heights as e
data = json.loads(sys.stdin.read())
teams = {r['Team'] for r in data['register']}
aggs = e.aggregate_stats(data['stats'], teams)
out = []
for r in e.reconcile(data['register'], aggs):
    out.append({'status': r.status, 'url': r.url, 'height': r.height_cm, 'candidates': r.candidates, 'jumper': r.jumper_corroborated})
print(json.dumps(out))
`;
  const result = spawnSync(python, ['-c', script], { cwd: repositoryRoot, encoding: 'utf8', input: JSON.stringify({ register, stats }) });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout) as Result[];
}

describe('enrich_heights reconciliation', () => {
  const U = (n: string) => `https://afltables.com/afl/stats/players/X/${n}.html`;

  it('maps on club + games + goals + exact season set + the source name', () => {
    const stats = [
      stat(U('Rod_Jameson'), 'Rod', 'Jameson', 'Adelaide', 1991, 3, '35'),
      stat(U('Rod_Jameson'), 'Rod', 'Jameson', 'Adelaide', 1991, 0, '35'),
      stat(U('Rod_Jameson'), 'Rod', 'Jameson', 'Adelaide', 1993, 2, '35'),
    ];
    const [r] = reconcile([reg('Rod Jameson', 'Adelaide', 3, 5, '1991,  1993', '185cm', '35')], stats);
    expect(r).toEqual({ status: 'mapped', url: U('Rod_Jameson'), height: 185, candidates: [U('Rod_Jameson')], jumper: true });
  });

  it('folds the renamed clubs into the register club, and refuses an unknown one', () => {
    const [r] = reconcile([reg('Kevin Murray', 'Sydney', 1, 0, '1960')], [stat(U('Kevin_Murray'), 'Kevin', 'Murray', 'South Melbourne', 1960)]);
    expect(r.status).toBe('mapped');
    expect(() => reconcile([reg('A B', 'Sydney', 1, 0, '1960')], [stat(U('A_B'), 'A', 'B', 'Swans', 1960)])).toThrow(/not a register club/);
  });

  it('fails closed when the facts fit but the name is spelled differently', () => {
    const [r] = reconcile([reg('Steven Icke', 'Melbourne', 1, 0, '1982')], [stat(U('Stephen_Icke'), 'Stephen', 'Icke', 'Melbourne', 1982)]);
    expect(r.status).toBe('name_mismatch');
    expect(r.url).toBeNull();
    expect(r.candidates).toEqual([U('Stephen_Icke')]);
  });

  it('separates two same-name players at one club by their facts, and refuses when it cannot', () => {
    const stats = [
      stat(U('Peter_Brown1'), 'Peter', 'Brown', 'Carlton', 1970, 4),
      stat(U('Peter_Brown2'), 'Peter', 'Brown', 'Carlton', 1970, 0),
    ];
    const [a, b] = reconcile([reg('Peter Brown', 'Carlton', 1, 4, '1970', '190cm'), reg('Peter Brown', 'Carlton', 1, 0, '1970', '175cm', '', '2')], stats);
    expect([a.url, b.url]).toEqual([U('Peter_Brown1'), U('Peter_Brown2')]);
    // Identical facts and name: nobody is chosen.
    const twins = [stat(U('Jim_Stewart1'), 'Jim', 'Stewart', 'St Kilda', 1905), stat(U('Jim_Stewart2'), 'Jim', 'Stewart', 'St Kilda', 1905)];
    const [c] = reconcile([reg('Jim Stewart', 'St Kilda', 1, 0, '1905')], twins);
    expect(c.status).toBe('ambiguous');
    expect(c.candidates).toHaveLength(2);
  });

  it('is unmatched when a game count differs (a current player without the in-season rows)', () => {
    const [r] = reconcile([reg('Taylor Walker', 'Adelaide', 2, 0, '2025-2026')], [stat(U('Taylor_Walker'), 'Taylor', 'Walker', 'Adelaide', 2025)]);
    expect(r.status).toBe('unmatched');
    expect(r.candidates).toEqual([]);
  });

  it('keeps an unknown or implausible height as null without affecting identity', () => {
    const stats = [stat(U('A_B'), 'A', 'B', 'Carlton', 2000)];
    const [blank, silly, jumperless] = reconcile([
      reg('A B', 'Carlton', 1, 0, '2000', ''),
      reg('A B', 'Carlton', 1, 0, '2000', '90cm'),
      reg('A B', 'Carlton', 1, 0, '2000', '200cm', '7'),
    ], stats);
    expect(blank).toMatchObject({ status: 'mapped', height: null });
    expect(silly).toMatchObject({ status: 'mapped', height: null });
    // The register lists a guernsey the match rows never recorded: informational only.
    expect(jumperless).toMatchObject({ status: 'mapped', height: 200, jumper: null });
  });
});
