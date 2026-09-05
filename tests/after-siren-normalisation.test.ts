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
