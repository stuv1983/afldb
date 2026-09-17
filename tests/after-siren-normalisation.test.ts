/**
 * AFLDB-ISSUE-118 §23.33 after-the-siren kicks: the normalisation rules of
 * tools/migration/after_siren.py, exercised on synthetic table exports through the
 * interpreter the way tests/sibling-reconciliation.test.ts exercises family_siblings.py.
 * No database.
 *
 * The rules under test:
 *   - a file's name decides its table (goal/behind × win/draw, missed opportunity) and
 *     whether it is the premiership-season table or the "other competitions" one;
 *   - the source's final score is parsed kicker-first, its goals.behinds must add to its
 *     points, and the separator must agree with the margin; a row whose arithmetic fails
 *     is kept only with a score_arithmetic adjudication;
 *   - what the kick scored, what it did to the result, and the kicker's result are
 *     derived and cross-checked against the table: a goal to win is a 1–6 point win, a
 *     behind to win a 1 point win, a draw is level, a miss is a loss or a draw;
 *   - a footnote on the score needs a siren adjudication (Shuey: end_of_extra_time is a
 *     goal to win; King: end_of_regulation is the only way a miss sits in a win); an empty
 *     Ref. needs a citation adjudication; every adjudication must be needed;
 *   - the repeat marker "(2)" is stripped from the name, never treated as a person;
 *   - the same event in two files refuses; output order is deterministic.
 *
 * The last block reads the TRACKED artefact and proves its counts from the artefact itself,
 * then regenerates it from the raw exports (when they are present) and compares the bytes.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseCsvRows } from '../tools/db/rebuild-test';

const repositoryRoot = join(__dirname, '..');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

type Row = Record<string, string>;
type Adj = { key: string; event_key: string; field: string; value: string; evidence?: string; decided_on?: string };
type Result = { ok: true; rows: Row[] } | { ok: false; error: string };

const GOAL_WIN = 'Players_to_have_kicked_a_goal_to_win_a_match_after_the_final_siren.csv';
const GOAL_WIN_OTHER = 'Players_to_have_kicked_a_goal_to_win_a_match_after_the_final_siren_1.csv';
const BEHIND_WIN = 'Players_to_have_kicked_a_behind_to_win_a_match_after_the_final_siren.csv';
const GOAL_DRAW = 'Players_to_have_kicked_a_goal_to_draw_a_match_after_the_final_siren.csv';
const BEHIND_DRAW = 'Players_to_have_kicked_a_behind_to_draw_a_match_after_the_final_siren.csv';
const MISSED = 'Players_to_have_missed_an_opportunity_to_win_or_draw_a_match_after_the_final_siren.csv';

const STD = 'Player,Club,Opponent,Rd.,Year,Final score,Ref.\n';
const OTHER = 'Player,Club,Opponent,Competition,Rd.,Year,Final score,Ref.\n';
const MISS = 'Player,Team,Opponent,Rd.,Year,Final score,Outcome,Ref.\n';

function normalise(files: Record<string, string>, adjudications: Adj[] = []): Result {
  const script = `
import json, sys, tempfile
from pathlib import Path
sys.path.insert(0, 'tools/migration')
import after_siren as m
data = json.loads(sys.stdin.read())
try:
    with tempfile.TemporaryDirectory() as d:
        for name, text in data['files'].items():
            (Path(d) / name).write_text(text, encoding='utf-8', newline='\\n')
        sources = m.read_sources(Path(d))
    adj = [m.Adjudication(a['key'], a['event_key'], a['field'], a['value'], a.get('evidence', 'e'), a.get('decided_on', '2026-09-05')) for a in data['adjudications']]
    rows = m.normalise(sources, adj)
    print(json.dumps({'ok': True, 'rows': rows}))
except m.AfterSirenSourceError as e:
    print(json.dumps({'ok': False, 'error': str(e)}))
`;
  const proc = spawnSync(python, ['-c', script], { cwd: repositoryRoot, input: JSON.stringify({ files, adjudications }), encoding: 'utf8' });
  if (proc.status !== 0) throw new Error(`python exited ${proc.status}: ${proc.stderr}`);
  return JSON.parse(proc.stdout) as Result;
}

function rows(r: Result): Row[] {
  if (!r.ok) throw new Error(r.error);
  return r.rows;
}

const pick = (r: Row) => `${r.event_key} ${r.kick_scored}/${r.kick_effect}/${r.kicker_result} ${r.siren} m${r.margin} ${r.competition} prem=${r.premiership_season}`;

describe('after_siren.py normalisation', () => {
  it('classifies each file by its name and derives scored / effect / result per table', () => {
    const out = rows(normalise({
      [GOAL_WIN]: STD + 'Billy Schmidt,St Kilda,Carlton,15,1913,10.10 (70) d. 11.3 (69),[3]\n',
      [BEHIND_WIN]: STD + 'Ken Newland,Geelong,Collingwood,20,1972,17.10 (112) d. 17.9 (111),[70]\n',
      [GOAL_DRAW]: STD + 'Ron Baggott,Melbourne,Collingwood,16,1935,10.19 (79) drew 11.13 (79),[62]\n',
      [BEHIND_DRAW]: STD + 'Gerry Donnelly,North Melbourne,Hawthorn,13,1926,10.10 (70) drew 10.10 (70),[74]\n',
      [MISSED]: MISS
        + 'George Holden,Fitzroy,Collingwood,17,1915,8.11 (59) lost to 8.13 (61),Behind,[77]\n'
        + 'Robert Scott,Geelong,Sydney,6,1988,16.15 (111) lost to 17.12 (114),Behind (hit the goal post),[88]\n'
        + 'Alex Jesaulenko,Carlton,Richmond,SF,1972,8.13 (61) drew 8.13 (61),No score (fell short),[85]\n'
        + 'Fred Metcalf,North Melbourne,Geelong,3,1927,8.5 (53) lost to 7.13 (55),No score (out on the full),[78]\n',
    }));
    expect(out.map(pick)).toEqual([
      '1913-vfl-afl-15-st-kilda-billy-schmidt goal/won/win final m1 VFL/AFL prem=true',
      '1915-vfl-afl-17-fitzroy-george-holden behind/none/loss final m-2 VFL/AFL prem=true',
      '1926-vfl-afl-13-north-melbourne-gerry-donnelly behind/drew/draw final m0 VFL/AFL prem=true',
      '1927-vfl-afl-3-north-melbourne-fred-metcalf none/none/loss final m-2 VFL/AFL prem=true',
      '1935-vfl-afl-16-melbourne-ron-baggott goal/drew/draw final m0 VFL/AFL prem=true',
      '1972-vfl-afl-20-geelong-ken-newland behind/won/win final m1 VFL/AFL prem=true',
      '1972-vfl-afl-SF-carlton-alex-jesaulenko none/none/draw final m0 VFL/AFL prem=true',
      '1988-vfl-afl-6-geelong-robert-scott behind/none/loss final m-3 VFL/AFL prem=true',
    ]);
    const byKey = Object.fromEntries(out.map((r) => [r.event_key, r]));
    expect(byKey['1988-vfl-afl-6-geelong-robert-scott'].shot_detail).toBe('hit the goal post');
    expect(byKey['1927-vfl-afl-3-north-melbourne-fred-metcalf'].shot_detail).toBe('out on the full');
    expect(byKey['1972-vfl-afl-SF-carlton-alex-jesaulenko']).toMatchObject({ round_kind: 'final', round_code: 'SF', shot_detail: 'fell short' });
    expect(byKey['1913-vfl-afl-15-st-kilda-billy-schmidt']).toMatchObject({
      source_file: GOAL_WIN, source_table: 'Players to have kicked a goal to win a match after the final siren', source_line: '2',
      kicker_score_raw: '10.10 (70)', opponent_score_raw: '11.3 (69)', kicker_points: '70', opponent_points: '69', cited: 'true', ref_raw: '[3]',
    });
  });

  it('keeps other-competition rows with their competition, supergoal notation and no premiership flag', () => {
    const out = rows(normalise({
      [GOAL_WIN_OTHER]: OTHER
        + 'Jack Riewoldt,Richmond,Hawthorn,NAB Cup,3,2013,0.13.7 (85) d. 0.13.6 (84)[c],[124]\n'
        + 'Kerry Good,North Melbourne,Collingwood,Escort Championships,GF,1980,8.9 (57) d. 7.12 (54),[123]\n',
    }));
    expect(out.map(pick)).toEqual([
      '1980-escort-championships-GF-north-melbourne-kerry-good goal/won/win final m3 Escort Championships prem=false',
      '2013-nab-cup-3-richmond-jack-riewoldt goal/won/win final m1 NAB Cup prem=false',
    ]);
    expect(out[1]).toMatchObject({ supergoal_scoring: 'true', score_footnote_raw: '[c]', source_table: 'Players to have kicked a goal to win a match after the final siren (other competitions)' });
    expect(out[0].supergoal_scoring).toBe('false');
    // Supergoal arithmetic is 9/6/1 and only under [c].
    expect(normalise({ [GOAL_WIN_OTHER]: OTHER + 'A B,Richmond,Hawthorn,NAB Cup,3,2013,1.13.7 (85) d. 0.13.6 (84)[c],[1]\n' })).toMatchObject({ ok: false, error: expect.stringMatching(/needs a score_arithmetic|do not add to the points/) });
    expect(normalise({ [GOAL_WIN_OTHER]: OTHER + 'A B,Richmond,Hawthorn,NAB Cup,3,2013,0.13.7 (85) d. 0.13.6 (84),[1]\n' })).toMatchObject({ ok: false, error: expect.stringMatching(/supergoal notation without the \[c\]/) });
    expect(normalise({ [GOAL_WIN_OTHER]: OTHER + 'A B,Richmond,Hawthorn,VFL/AFL,3,2013,13.7 (85) d. 13.6 (84),[1]\n' })).toMatchObject({ ok: false, error: expect.stringMatching(/other-competitions table carrying the premiership competition/) });
  });

  it('refuses a score that does not add up, a separator that disagrees with the margin, and a category that disagrees with the scores', () => {
    const bad = (file: string, header: string, line: string) => normalise({ [file]: header + line + '\n' });
    expect(bad(GOAL_WIN, STD, 'A B,Geelong,Carlton,1,2000,10.10 (71) d. 11.3 (69),[1]')).toMatchObject({ ok: false, error: expect.stringMatching(/do not add to the points/) });
    expect(bad(GOAL_WIN, STD, 'A B,Geelong,Carlton,1,2000,10.10 (70) lost to 11.3 (69),[1]')).toMatchObject({ ok: false, error: expect.stringMatching(/separator 'lost to' disagrees/) });
    expect(bad(GOAL_WIN, STD, 'A B,Geelong,Carlton,1,2000,10.10 (70) drew 11.3 (69),[1]')).toMatchObject({ ok: false, error: expect.stringMatching(/separator 'drew' disagrees/) });
    expect(bad(GOAL_WIN, STD, 'A B,Geelong,Carlton,1,2000,12.10 (82) d. 11.3 (69),[1]')).toMatchObject({ ok: false, error: expect.stringMatching(/cannot turn the result with a 13-point margin/) });
    expect(bad(BEHIND_WIN, STD, 'A B,Geelong,Carlton,1,2000,10.10 (70) d. 11.2 (68),[1]')).toMatchObject({ ok: false, error: expect.stringMatching(/a behind cannot turn the result with a 2-point margin/) });
    expect(bad(GOAL_DRAW, STD, 'A B,Geelong,Carlton,1,2000,10.10 (70) d. 11.3 (69),[1]')).toMatchObject({ ok: false, error: expect.stringMatching(/a kick to draw in a win/) });
    expect(bad(MISSED, MISS, 'A B,Geelong,Carlton,1,2000,10.10 (70) d. 11.3 (69),Behind,[1]')).toMatchObject({ ok: false, error: expect.stringMatching(/missed opportunity in a win .* needs an end_of_regulation siren adjudication/) });
    expect(bad(MISSED, MISS, 'A B,Geelong,Carlton,1,2000,10.10 (70) drew 11.4 (70),Behind,[1]')).toMatchObject({ ok: false, error: expect.stringMatching(/a behind that left the scores level would have drawn/) });
    expect(bad(MISSED, MISS, 'A B,Geelong,Carlton,1,2000,10.10 (70) lost to 11.5 (71),Rushed,[1]')).toMatchObject({ ok: false, error: expect.stringMatching(/unrecognised Outcome 'Rushed'/) });
    expect(bad(GOAL_WIN, STD, 'A B,Geelong,Carlton,R1,2000,10.10 (70) d. 11.3 (69),[1]')).toMatchObject({ ok: false, error: expect.stringMatching(/unrecognised round 'R1'/) });
    expect(bad(GOAL_WIN, STD, 'A B,Geelong,Carlton,1,2000,10.10 (70) d. 11.3 (69),ref')).toMatchObject({ ok: false, error: expect.stringMatching(/unreadable Ref\./) });
    expect(normalise({ 'Something_else.csv': STD })).toMatchObject({ ok: false, error: expect.stringMatching(/no after-siren table exports/) });
    expect(normalise({ [GOAL_WIN]: MISS + 'A B,Geelong,Carlton,1,2000,10.10 (70) d. 11.3 (69),Behind,[1]\n' })).toMatchObject({ ok: false, error: expect.stringMatching(/unexpected columns \['Outcome'\]/) });
  });

  it('Shuey 2017: the [a] footnote is refused without an adjudication and is a goal to win after the extra-time siren with one', () => {
    const file = { [GOAL_WIN]: STD + 'Luke Shuey,West Coast,Port Adelaide,EF,2017,12.6 (78) d. 10.16 (76)[a],[47]\n' };
    expect(normalise(file)).toMatchObject({ ok: false, error: expect.stringMatching(/footnote \[a\] on 2017-vfl-afl-EF-west-coast-luke-shuey needs a siren adjudication/) });
    const adj: Adj = { key: 'adj-1', event_key: '2017-vfl-afl-EF-west-coast-luke-shuey', field: 'siren', value: 'end_of_extra_time', evidence: 'After extra time.' };
    const [row] = rows(normalise(file, [adj]));
    expect(pick(row)).toBe('2017-vfl-afl-EF-west-coast-luke-shuey goal/won/win end_of_extra_time m2 VFL/AFL prem=true');
    expect(row).toMatchObject({ score_footnote_raw: '[a]', adjudication_keys: 'adj-1', note: 'siren: After extra time.' });
    // A siren adjudication on a row without a footnote is stale and refuses.
    expect(normalise({ [GOAL_WIN]: STD + 'Luke Shuey,West Coast,Port Adelaide,EF,2017,12.6 (78) d. 10.16 (76),[47]\n' }, [adj])).toMatchObject({ ok: false, error: expect.stringMatching(/adjudication adj-1 is not needed/) });
    // A decisive kick cannot have preceded extra time.
    expect(normalise(file, [{ ...adj, value: 'end_of_regulation' }])).toMatchObject({ ok: false, error: expect.stringMatching(/cannot have preceded extra time/) });
  });

  it('King 1994: a miss in a 23-point win is refused until the end_of_regulation adjudication types it as a miss with no effect', () => {
    const file = { [MISSED]: MISS + 'David King,North Melbourne,Hawthorn,QF,1994,15.24 (114) d. 13.13 (91)[b],No score (fell short),[92]\n' };
    expect(normalise(file)).toMatchObject({ ok: false, error: expect.stringMatching(/needs a siren adjudication/) });
    const adj: Adj = { key: 'adj-2', event_key: '1994-vfl-afl-QF-north-melbourne-david-king', field: 'siren', value: 'end_of_regulation', evidence: 'scores level at the end of regular time; 3.5 to nil in extra time' };
    const [row] = rows(normalise(file, [adj]));
    expect(pick(row)).toBe('1994-vfl-afl-QF-north-melbourne-david-king none/none/win end_of_regulation m23 VFL/AFL prem=true');
    expect(row).toMatchObject({ shot_detail: 'fell short', score_footnote_raw: '[b]', outcome_raw: 'No score (fell short)' });
    // The footnote alone does not license a win: adjudicating it as the final siren still refuses.
    expect(normalise(file, [{ ...adj, value: 'final' }])).toMatchObject({ ok: false, error: expect.stringMatching(/missed opportunity in a win/) });
  });

  it('an uncited row needs a citation adjudication, and a score that does not add up needs a score_arithmetic one; both are recorded, neither may be stale', () => {
    const zurhaar = STD + 'Cameron Zurhaar,North Melbourne,Gold Coast,11,2026,17.9 (111) d. 16.9 (105),\n';
    expect(normalise({ [GOAL_WIN]: zurhaar })).toMatchObject({ ok: false, error: expect.stringMatching(/has no Ref\. and no citation adjudication/) });
    const cite: Adj = { key: 'adj-3', event_key: '2026-vfl-afl-11-north-melbourne-cameron-zurhaar', field: 'citation', value: 'uncited', evidence: 'empty Ref. in the export' };
    const [z] = rows(normalise({ [GOAL_WIN]: zurhaar }, [cite]));
    expect(z).toMatchObject({ cited: 'false', ref_raw: '', kick_scored: 'goal', kick_effect: 'won', adjudication_keys: 'adj-3' });
    expect(normalise({ [GOAL_WIN]: zurhaar.replace(',\n', ',[1]\n') }, [cite])).toMatchObject({ ok: false, error: expect.stringMatching(/adj-3 is not needed .* is cited/) });

    const hickey = STD + 'Harry Hickey,Footscray,Carlton,18,1944,12.7 (89) d. 13.10 (88),[69]\n';
    expect(normalise({ [BEHIND_WIN]: hickey })).toMatchObject({ ok: false, error: expect.stringMatching(/goals\.behinds do not add to the points/) });
    const arith: Adj = { key: 'adj-4', event_key: '1944-vfl-afl-18-footscray-harry-hickey', field: 'score_arithmetic', value: 'points_as_written', evidence: '12.7 is 79, not 89' };
    const [h] = rows(normalise({ [BEHIND_WIN]: hickey }, [arith]));
    expect(h).toMatchObject({ kicker_points: '89', margin: '1', kick_scored: 'behind', kick_effect: 'won', kicker_score_raw: '12.7 (89)', adjudication_keys: 'adj-4' });
    expect(normalise({ [BEHIND_WIN]: hickey.replace('12.7 (89)', '13.11 (89)') }, [arith])).toMatchObject({ ok: false, error: expect.stringMatching(/adj-4 is not needed .* adds up/) });
    // An adjudication naming no row at all is stale too.
    expect(normalise({ [BEHIND_WIN]: hickey }, [arith, { ...cite, key: 'adj-9' }])).toMatchObject({ ok: false, error: expect.stringMatching(/adjudications not needed by any row: adj-9/) });
  });

  it('strips the repeat marker from the name, refuses the same event in two files, and orders deterministically', () => {
    const out = rows(normalise({
      [GOAL_WIN]: STD
        + 'Barry Hall (2),Sydney,Brisbane Lions,3,2005,13.9 (87) d. 11.15 (81),[37]\n'
        + 'Barry Hall,St Kilda,Hawthorn,22,2001,13.11 (89) d. 13.9 (87),[31]\n'
        + 'Gary Buckenara,Hawthorn,Melbourne,PF,1987,11.14 (80) d. 10.18 (78),[24]\n'
        + 'Stephen Kernahan,Carlton,North Melbourne,22,1987,20.9 (129) d. 19.11 (125),[23]\n'
        + 'Alastair Clarkson,North Melbourne,Melbourne,15,1987,16.16 (112) d. 15.20 (110),[22]\n',
      [GOAL_WIN_OTHER]: OTHER + 'Ed Langdon,Fremantle,Collingwood,JLT Community Series,3,2017,1.11.12 (87) d. 1.12.4 (85)[c],[125]\n',
      [GOAL_DRAW]: STD + 'Mitch McGovern,Adelaide,Collingwood,19,2017,16.7 (103) drew 15.13 (103),[67]\n',
    }));
    expect(out.map((r) => r.event_key)).toEqual([
      '1987-vfl-afl-15-north-melbourne-alastair-clarkson',
      '1987-vfl-afl-22-carlton-stephen-kernahan',
      '1987-vfl-afl-PF-hawthorn-gary-buckenara',
      '2001-vfl-afl-22-st-kilda-barry-hall',
      '2005-vfl-afl-3-sydney-barry-hall',
      '2017-vfl-afl-19-adelaide-mitch-mcgovern',
      '2017-jlt-community-series-3-fremantle-ed-langdon',
    ]);
    const hall2 = out.find((r) => r.event_key === '2005-vfl-afl-3-sydney-barry-hall')!;
    expect(hall2).toMatchObject({ player_name_raw: 'Barry Hall (2)', player_name: 'Barry Hall', note: 'article repeat marker (2) stripped from the name cell' });
    expect(normalise({
      [GOAL_WIN]: STD + 'Tom Hawkins,Geelong,Hawthorn,19,2012,18.10 (118) d. 17.15 (117),[41]\n',
      [BEHIND_WIN]: STD + 'Tom Hawkins,Geelong,Hawthorn,19,2012,18.10 (118) d. 17.15 (117),[41]\n',
    })).toMatchObject({ ok: false, error: expect.stringMatching(/duplicate event 2012-vfl-afl-19-geelong-tom-hawkins/) });
  });

  it('the tracked artefact carries the recorded counts, its adjudications are exactly the four, and it regenerates byte-identically', () => {
    const artefactPath = join(repositoryRoot, 'data', 'records', 'after-siren-events.csv');
    const text = readFileSync(artefactPath, 'utf8');
    expect(text).not.toContain('\r');
    const table = parseCsvRows(text);
    const header = table[0];
    const data = table.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
    const count = (pred: (r: Row) => boolean) => data.filter(pred).length;
    const prem = (r: Row) => r.premiership_season === 'true';
    expect(data.length).toBe(126);
    expect(count((r) => r.kick_scored === 'goal' && r.kick_effect === 'won')).toBe(62);
    expect(count((r) => r.kick_scored === 'behind' && r.kick_effect === 'won')).toBe(6);
    expect(count((r) => r.kick_scored === 'goal' && r.kick_effect === 'drew')).toBe(9);
    expect(count((r) => r.kick_scored === 'behind' && r.kick_effect === 'drew')).toBe(3);
    expect(count((r) => r.kick_effect === 'none')).toBe(46);
    expect(count((r) => !prem(r))).toBe(5);
    expect(data.filter((r) => !prem(r)).map((r) => `${r.season} ${r.competition}`)).toEqual([
      '1980 Escort Championships', '2011 NAB Cup', '2013 NAB Cup', '2013 NAB Cup', '2017 JLT Community Series',
    ]);
    // The set a "won after the siren" criterion will later select: 64 events, 62 players.
    const winners = data.filter((r) => prem(r) && r.kick_scored !== 'none' && r.kick_effect === 'won');
    expect(winners.length).toBe(64);
    expect(new Set(winners.map((r) => r.player_name)).size).toBe(62);
    expect(new Set(data.map((r) => r.event_key)).size).toBe(data.length);
    expect(data.map((r) => r.event_key)).toEqual([...data].sort((a, b) => Number(a.season) - Number(b.season) || 0).map((r) => r.event_key));
    expect(data.filter((r) => r.adjudication_keys).map((r) => `${r.adjudication_keys} ${r.event_key} ${r.siren} cited=${r.cited}`)).toEqual([
      'asr-adj-004 1944-vfl-afl-18-footscray-harry-hickey final cited=true',
      'asr-adj-002 1994-vfl-afl-QF-north-melbourne-david-king end_of_regulation cited=true',
      'asr-adj-001 2017-vfl-afl-EF-west-coast-luke-shuey end_of_extra_time cited=true',
      'asr-adj-003 2026-vfl-afl-11-north-melbourne-cameron-zurhaar final cited=false',
    ]);
    expect(count((r) => r.player_name_raw !== r.player_name)).toBe(2);
    const provenance = JSON.parse(readFileSync(join(repositoryRoot, 'data', 'records', 'after-siren-events.source.json'), 'utf8'));
    expect(provenance.wikipedia_title).toBe('List of kicks after the siren in the VFL/AFL');
    expect(provenance.export_revision_id).toBeNull();
    expect(provenance.inspected_revision_id).toBe('1371785656');
    expect(provenance.raw_rows).toBe(126);
    expect(provenance.measures.premiership_season_scored_and_won).toBe(64);
    expect(provenance.measures.premiership_season_scored_and_won_players).toBe(62);

    // Regeneration is byte-identical whenever the raw exports are in this checkout (they are
    // untracked, so a CI checkout skips this line and the shape assertions above still hold).
    if (existsSync(join(repositoryRoot, 'data', 'records', 'after-siren', GOAL_WIN))) {
      const proc = spawnSync(python, ['tools/migration/after_siren.py', 'normalize', '--check', '--quiet'], { cwd: repositoryRoot, encoding: 'utf8' });
      expect(proc.status, proc.stderr).toBe(0);
      expect(proc.stdout).toMatch(/exactly the regeneration/);
    }
  });
});

/**
 * The loader's identity rules (AFLDB-ISSUE-118 §23.34). `resolve_match` and
 * `resolve_player` read a `Canon`, so they are driven here against a fake one
 * built from fixture rows: the real rule code runs, no database is touched.
 */
type FakeMatch = { id: number; season: number; round_code: string; home_org: number; away_org: number; home_club: number; away_club: number; home_score: number; away_score: number };
type FakePms = { match_id: number; player_id: number; club_org: number; name: string; goals: number | null; behinds: number | null; debut: number | null };
type Fixture = {
  orgs: Record<string, number[]>;
  clubOrgs: Record<string, number>;
  matches?: FakeMatch[];
  participants?: FakePms[];
  matchSeasons?: number[];
  openingRoundSeasons?: number[];
};
type Resolved = {
  match_id: number | null; match_method: string | null; club_id: number | null; opponent_club_id: number | null;
  player_id: number | null; link_status: string; candidate_count: number; player_method: string | null;
  score_check: string; notes: string | null;
};
type ResolveResult = { ok: true; resolved: Resolved } | { ok: false; error: string };

const FAKE_CANON = `
class FakeCursor:
    def __init__(self, fx):
        self.fx, self.result = fx, []
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def execute(self, sql, params=()):
        if 'FROM matches m' in sql:
            season, code, ko, oo, oo2, ko2 = params
            self.result = [(m['id'], m['home_org'], m['home_club'], m['away_club'], m['home_score'], m['away_score'])
                           for m in self.fx.get('matches', [])
                           if m['season'] == season and m['round_code'].upper() == code
                           and {m['home_org'], m['away_org']} == {ko, oo}]
        elif 'JOIN matches m ON m.id = pms.match_id' in sql:
            # club-season participation fallback: player_match_stats + matches,
            # NOT the derived player_club_season_stats (empty when this loader
            # runs as a rebuild stage before the derived stage).
            name, season, org = params
            season_matches = {mm['id'] for mm in self.fx.get('matches', []) if mm['season'] == season}
            self.result = sorted({(p['player_id'], None, None, p['debut'])
                                  for p in self.fx.get('participants', [])
                                  if p['match_id'] in season_matches and p['club_org'] == org and p['name'] == name})
        elif 'player_match_stats' in sql:
            club_id, match_id, name = params
            org = self.fx['clubOrgs'][str(club_id)]
            self.result = [(p['player_id'], p['goals'], p['behinds'], p['debut'])
                           for p in self.fx.get('participants', [])
                           if p['match_id'] == match_id and p['club_org'] == org and p['name'] == name]
        else:
            raise AssertionError('unexpected query: ' + sql)
    def fetchall(self): return self.result
    def fetchone(self): return self.result[0] if self.result else None

class FakePg:
    def __init__(self, fx): self.fx = fx
    def cursor(self): return FakeCursor(self.fx)

class FakeCanon:
    def __init__(self, fx):
        self.fx, self.pg = fx, FakePg(fx)
        self.match_seasons = set(fx.get('matchSeasons') or [])
        self.opening_round_seasons = set(fx.get('openingRoundSeasons') or [])
    def organisation(self, club_raw):
        found = self.fx['orgs'].get(club_raw, [])
        if len(found) != 1:
            raise m.AfterSirenSourceError(
                "club %r resolves to %d club organisations on this database" % (club_raw, len(found)))
        return found[0]
    def era_club(self, org, season):
        for cid, o in self.fx['clubOrgs'].items():
            if o == org:
                return int(cid)
        return None
`;

function resolveOne(row: Row, fixture: Fixture): ResolveResult {
  const script = `
import json, sys
sys.path.insert(0, 'tools/migration')
import after_siren as m
data = json.loads(sys.stdin.read())
fx = data['fixture']
${FAKE_CANON}
try:
    canon = FakeCanon(fx)
    res = m.resolve_rows(canon, [data['row']])[0]
    print(json.dumps({'ok': True, 'resolved': {
        'match_id': res.match_id, 'match_method': res.match_method, 'club_id': res.club_id,
        'opponent_club_id': res.opponent_club_id, 'player_id': res.player_id,
        'link_status': res.link_status, 'candidate_count': res.candidate_count,
        'player_method': res.player_method, 'score_check': res.score_check, 'notes': m.row_notes(res)}}))
except m.AfterSirenSourceError as e:
    print(json.dumps({'ok': False, 'error': str(e)}))
`;
  const proc = spawnSync(python, ['-c', script], { cwd: repositoryRoot, input: JSON.stringify({ row, fixture }), encoding: 'utf8' });
  if (proc.status !== 0) throw new Error(`python exited ${proc.status}: ${proc.stderr}`);
  return JSON.parse(proc.stdout) as ResolveResult;
}

function ok(r: ResolveResult): Resolved {
  if (!r.ok) throw new Error(r.error);
  return r.resolved;
}

/** An artefact row; only the fields a test varies need naming. */
function event(over: Row = {}): Row {
  const base: Row = {
    event_key: '1990-vfl-afl-5-carlton-jane-doe', season: '1990', competition: 'VFL/AFL',
    premiership_season: 'true', round_raw: '5', round_code: '5', round_kind: 'home_and_away',
    player_name_raw: 'Jane Doe', player_name: 'Jane Doe', club_raw: 'Carlton', opponent_raw: 'Essendon',
    kick_scored: 'goal', kick_effect: 'won', shot_detail: '', kicker_result: 'win', siren: 'final',
    kicker_score_raw: '10.10 (70)', opponent_score_raw: '10.9 (69)', kicker_points: '70',
    opponent_points: '69', margin: '1', supergoal_scoring: 'false', score_footnote_raw: '',
    outcome_raw: '', ref_raw: '[1]', cited: 'true', adjudication_keys: '',
    source_file: 'f.csv', source_table: 't', source_line: '2', note: '',
  };
  return { ...base, ...over };
}

/** Carlton (org 1, era club 101) beat Essendon (org 2, era club 102) by a point in round 5. */
const CARLTON_ESSENDON: Fixture = {
  orgs: { Carlton: [1], Essendon: [2] },
  clubOrgs: { 101: 1, 102: 2 },
  matchSeasons: [1990],
  matches: [{ id: 900, season: 1990, round_code: '5', home_org: 1, away_org: 2, home_club: 101, away_club: 102, home_score: 70, away_score: 69 }],
  participants: [{ match_id: 900, player_id: 55, club_org: 1, name: 'jane doe', goals: 3, behinds: 1, debut: 1988 }],
};

describe('after_siren.py match resolution', () => {
  it('keys on season, round and both club organisations, and takes the clubs from the match', () => {
    const r = ok(resolveOne(event(), CARLTON_ESSENDON));
    expect(r.match_id).toBe(900);
    expect(r.match_method).toBe('round_exact');
    expect([r.club_id, r.opponent_club_id]).toEqual([101, 102]);
    expect(r.notes).toContain('resolved on the round the source states');
  });

  it('reads the kicker first whichever side of the fixture the club was on', () => {
    const away = { ...CARLTON_ESSENDON, matches: [{ ...CARLTON_ESSENDON.matches![0], home_org: 2, away_org: 1, home_club: 102, away_club: 101, home_score: 69, away_score: 70 }] };
    const r = ok(resolveOne(event(), away));
    expect(r.match_id).toBe(900);
    expect([r.club_id, r.opponent_club_id]).toEqual([101, 102]);
  });

  it("separates a drawn final from its replay on the source's own points", () => {
    const finals: Fixture = {
      ...CARLTON_ESSENDON, matchSeasons: [1972],
      matches: [
        { id: 1, season: 1972, round_code: 'SF', home_org: 1, away_org: 2, home_club: 101, away_club: 102, home_score: 61, away_score: 61 },
        { id: 2, season: 1972, round_code: 'SF', home_org: 1, away_org: 2, home_club: 101, away_club: 102, home_score: 69, away_score: 110 },
      ],
      participants: [{ match_id: 1, player_id: 55, club_org: 1, name: 'jane doe', goals: 2, behinds: 0, debut: 1968 }],
    };
    const drawn = event({ season: '1972', round_raw: 'SF', round_code: 'SF', round_kind: 'final', kick_effect: 'drew', kicker_result: 'draw', kicker_score_raw: '9.7 (61)', opponent_score_raw: '9.7 (61)', kicker_points: '61', opponent_points: '61', margin: '0' });
    expect(ok(resolveOne(drawn, finals)).match_id).toBe(1);
  });

  it('retries one round higher only in a season shaped by an Opening Round', () => {
    const opening: Fixture = {
      ...CARLTON_ESSENDON, matchSeasons: [2024], openingRoundSeasons: [2024],
      matches: [{ id: 7, season: 2024, round_code: '6', home_org: 1, away_org: 2, home_club: 101, away_club: 102, home_score: 70, away_score: 69 }],
      participants: [{ match_id: 7, player_id: 55, club_org: 1, name: 'jane doe', goals: 1, behinds: 0, debut: 2020 }],
    };
    const row = event({ season: '2024' });
    const r = ok(resolveOne(row, opening));
    expect(r.match_id).toBe(7);
    expect(r.match_method).toBe('opening_round_offset');
    expect(r.notes).toContain('one round higher');
    // The same fixture without the Opening-Round shape refuses rather than shifting.
    const strict = { ...opening, openingRoundSeasons: [] };
    expect(resolveOne(row, strict)).toMatchObject({ ok: false });
  });

  it('leaves match_id NULL for a season this database does not carry, and says so', () => {
    const r = ok(resolveOne(event({ season: '2026', event_key: 'e-2026' }), { ...CARLTON_ESSENDON, matchSeasons: [1990] }));
    expect(r.match_id).toBeNull();
    expect(r.notes).toContain('2026 is not in this database');
    expect(r.club_id).not.toBeNull();       // the era rule still names the clubs
    expect(r.link_status).toBe('unmatched'); // and nothing invents a kicker
  });

  it('leaves match_id NULL for another competition without ever looking for one', () => {
    const other = event({ competition: 'NAB Cup', premiership_season: 'false', season: '2013' });
    // The kicker still links by club-season participation: a premiership-season
    // player_match_stats row for that club in 2013 (the derived summary is not read).
    const r = ok(resolveOne(other, {
      ...CARLTON_ESSENDON, matchSeasons: [2013],
      matches: [{ id: 2013001, season: 2013, round_code: '5', home_org: 1, away_org: 2, home_club: 101, away_club: 102, home_score: 80, away_score: 70 }],
      participants: [{ match_id: 2013001, player_id: 55, club_org: 1, name: 'jane doe', goals: 2, behinds: 1, debut: 2010 }],
    }));
    expect(r.match_id).toBeNull();
    expect(r.notes).toContain('not a premiership-season fixture (NAB Cup)');
    expect(r.player_id).toBe(55);
    expect(r.player_method).toBe('club_season_participation');
  });

  it('refuses a season it carries whose fixture it cannot find', () => {
    const r = resolveOne(event({ round_raw: '9', round_code: '9' }), CARLTON_ESSENDON);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain('no 1990 match between Carlton and Essendon');
  });

  it("refuses a fixture whose score disagrees with the source's", () => {
    const wrong = { ...CARLTON_ESSENDON, matches: [{ ...CARLTON_ESSENDON.matches![0], home_score: 71 }] };
    const r = resolveOne(event(), wrong);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain('0 agreeing with');
  });

  it('refuses a club name that is not exactly one organisation', () => {
    const r = resolveOne(event(), { ...CARLTON_ESSENDON, orgs: { Carlton: [1, 3], Essendon: [2] } });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain('resolves to 2 club organisations');
  });
});

describe('after_siren.py player resolution', () => {
  it('links the one player of that name in the match for the kicker club', () => {
    const r = ok(resolveOne(event(), CARLTON_ESSENDON));
    expect(r.player_id).toBe(55);
    expect(r.link_status).toBe('unique');
    expect(r.candidate_count).toBe(1);
    expect(r.player_method).toBe('match_participation');
    expect(r.score_check).toBe('confirmed');
  });

  it('never reaches across to the opponent, and leaves the source spelling when nobody matches', () => {
    const opponentOnly = { ...CARLTON_ESSENDON, participants: [{ match_id: 900, player_id: 55, club_org: 2, name: 'jane doe', goals: 3, behinds: 1, debut: 1988 }] };
    const r = ok(resolveOne(event(), opponentOnly));
    expect(r.player_id).toBeNull();
    expect(r.link_status).toBe('unmatched');
    expect(r.candidate_count).toBe(0);
    expect(r.notes).toContain('no player of that name in that match');
  });

  it('leaves same-name team-mates ambiguous rather than picking one', () => {
    const two = { ...CARLTON_ESSENDON, participants: [
      { match_id: 900, player_id: 55, club_org: 1, name: 'jane doe', goals: 3, behinds: 1, debut: 1988 },
      { match_id: 900, player_id: 56, club_org: 1, name: 'jane doe', goals: 0, behinds: 0, debut: 1989 },
    ] };
    const r = ok(resolveOne(event(), two));
    expect(r.player_id).toBeNull();
    expect(r.link_status).toBe('ambiguous');
    expect(r.candidate_count).toBe(2);
  });

  it('separates same-name candidates by a generational suffix, and records that it did', () => {
    const two = { ...CARLTON_ESSENDON, participants: [
      { match_id: 900, player_id: 55, club_org: 1, name: 'jane doe', goals: 3, behinds: 1, debut: 1988 },
      { match_id: 900, player_id: 56, club_org: 1, name: 'jane doe', goals: 1, behinds: 0, debut: 1962 },
    ] };
    const senior = ok(resolveOne(event({ player_name: 'Jane Doe Sr.', player_name_raw: 'Jane Doe Sr.' }), two));
    expect(senior.player_id).toBe(56);
    expect(senior.link_status).toBe('resolved');
    expect(senior.candidate_count).toBe(2);
    expect(senior.notes).toContain('separated by the sr. suffix');
    expect(ok(resolveOne(event({ player_name: 'Jane Doe Jr.', player_name_raw: 'Jane Doe Jr.' }), two)).player_id).toBe(55);
  });
});

describe('after_siren.py score confirmation', () => {
  const withScores = (goals: number | null, behinds: number | null): Fixture => ({
    ...CARLTON_ESSENDON,
    participants: [{ match_id: 900, player_id: 55, club_org: 1, name: 'jane doe', goals, behinds, debut: 1988 }],
  });

  it('confirms a goal against the kicker\'s own scoring line', () => {
    expect(ok(resolveOne(event(), withScores(2, 0))).score_check).toBe('confirmed');
  });

  it('treats an unrecorded statistic as unknown, never as zero', () => {
    const behindToWin = event({ kick_scored: 'behind', kicker_score_raw: '10.10 (70)', opponent_points: '69' });
    const r = ok(resolveOne(behindToWin, withScores(0, null)));
    expect(r.score_check).toBe('not_recorded');
    expect(r.player_id).toBe(55);
    expect(r.notes).toContain('records no behinds for anyone');
  });

  it('refuses a recorded zero, which contradicts the source', () => {
    const r = resolveOne(event(), withScores(0, 3));
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain('recorded with 0 goals');
  });

  it('checks nothing for a kick that scored nothing', () => {
    const missed = event({ kick_scored: 'none', kick_effect: 'none', kicker_result: 'loss', shot_detail: 'fell short', outcome_raw: 'No score (fell short)', kicker_points: '69', opponent_points: '70', kicker_score_raw: '10.9 (69)', opponent_score_raw: '10.10 (70)' });
    const missedFixture = { ...withScores(0, 0), matches: [{ ...CARLTON_ESSENDON.matches![0], home_score: 69, away_score: 70 }] };
    const r = ok(resolveOne(missed, missedFixture));
    expect(r.score_check).toBe('not_applicable');
    expect(r.player_id).toBe(55);
  });
});

describe('after_siren.py artefact contract for the loader', () => {
  function refuse(mutate: string): string {
    const script = `
import json, sys, tempfile
from pathlib import Path
sys.path.insert(0, 'tools/migration')
import after_siren as m
text = Path('data/records/after-siren-events.csv').read_text(encoding='utf-8').replace('\\r\\n', '\\n')
lines = text.split('\\n')
${mutate}
with tempfile.TemporaryDirectory() as d:
    p = Path(d) / 'a.csv'
    p.write_text('\\n'.join(lines), encoding='utf-8', newline='\\n')
    try:
        m.read_artefact(p)
        print('ACCEPTED')
    except m.AfterSirenSourceError as e:
        print(str(e))
`;
    const proc = spawnSync(python, ['-c', script], { cwd: repositoryRoot, encoding: 'utf8' });
    if (proc.status !== 0) throw new Error(`python exited ${proc.status}: ${proc.stderr}`);
    return proc.stdout.trim();
  }

  it('refuses a header that is not the tracked shape', () => {
    expect(refuse("lines[0] = lines[0].replace('event_key', 'key')")).toContain('unexpected header');
  });

  it('refuses a duplicated event key', () => {
    expect(refuse('lines.insert(2, lines[1])')).toContain('duplicate event key');
  });

  it('refuses an unknown enum value', () => {
    expect(refuse("lines[1] = lines[1].replace(',goal,won,', ',punt,won,')")).toContain('unknown enum value');
  });

  it('refuses a premiership row of another competition', () => {
    expect(refuse("lines[1] = lines[1].replace(',VFL/AFL,true,', ',NAB Cup,true,')")).toContain('premiership row of competition');
  });

  it('accepts the tracked artefact through load --validate-only, and its provenance agrees', () => {
    const proc = spawnSync(python, ['tools/migration/after_siren.py', 'load', '--validate-only'], { cwd: repositoryRoot, encoding: 'utf8' });
    expect(proc.status, proc.stderr).toBe(0);
    expect(proc.stdout).toMatch(/126 events, shape verified/);
    expect(proc.stdout).toMatch(/done \(validate only\)/);
  });

  it('writes only columns migration 089 declares', () => {
    const sql = readFileSync(join(repositoryRoot, 'src', 'db', 'migrations', '089_after_siren_kicks.sql'), 'utf8');
    const body = sql.slice(sql.indexOf('CREATE TABLE after_siren_kicks'));
    const declared = new Set([...body.matchAll(/^\s{2}([a-z_]+)\s{2,}/gm)].map((m) => m[1]));
    const script = "import sys; sys.path.insert(0, 'tools/migration'); import after_siren as m; print(' '.join(m.WRITTEN_COLUMNS))";
    const proc = spawnSync(python, ['-c', script], { cwd: repositoryRoot, encoding: 'utf8' });
    expect(proc.status, proc.stderr).toBe(0);
    const written = proc.stdout.trim().split(' ');
    expect(written.length).toBeGreaterThan(20);
    expect(written.filter((c) => !declared.has(c))).toEqual([]);
  });
});
