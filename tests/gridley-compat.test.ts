/**
 * AFLDB-ISSUE-118 -- the Gridley corpus is classified exhaustively and
 * offline: every one of the 6,858 criterion occurrences on the 1,143 stored
 * boards resolves to an AFLDB Grid Solver axis, the freebie, or an explicit
 * data-absent reason. Nothing is unrecognised and nothing is silently
 * excluded. The database-backed half (does the solver actually answer each
 * cell?) is tests/integration/gridley-corpus.test.ts.
 *
 * Lookups are stubbed here with fixed ids: the point of this suite is the
 * mapping and the denominator, not the ids.
 */
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GRID_BUILDERS, isAxisComplete } from '@/search/grid-solver-spec';
import {
  GRIDLEY_CLUB_CODES,
  GRIDLEY_RULES,
  mapGridleyCriterion,
  normalisePlayerName,
  type GridleyItem,
  type GridleyLookups,
  type GridleyMapping,
} from '@/search/gridley-compat';

const FIXTURES = join(__dirname, 'fixtures', 'gridley');

export type CorpusBoard = {
  board: number;
  date: string;
  rows: [GridleyItem, GridleyItem, GridleyItem];
  cols: [GridleyItem, GridleyItem, GridleyItem];
  answerCounts: number[][];
};

export function loadCorpus(): CorpusBoard[] {
  const corpus = JSON.parse(readFileSync(join(FIXTURES, 'corpus.json'), 'utf8')) as { boards: CorpusBoard[] };
  return corpus.boards;
}

export function loadAnswers(): Record<string, number[][][]> {
  return JSON.parse(gunzipSync(readFileSync(join(FIXTURES, 'corpus-answers.json.gz'))).toString('utf8'));
}

const STUB_LOOKUPS: GridleyLookups = {
  clubs: Object.fromEntries([...new Set(Object.values(GRIDLEY_CLUB_CODES).map((c) => c.slug)), 'brisbane-bears'].map((slug, i) => [slug, 100 + i])),
  venues: Object.fromEntries(['Melbourne Cricket Ground', 'Docklands', 'Kardinia Park', 'Gabba', 'Sydney Cricket Ground', 'Adelaide Oval', 'Bellerive Oval', 'Jiangwan Stadium'].map((v, i) => [v, 200 + i])),
  awards: Object.fromEntries(['all-australian', 'rising-star', 'norm-smith-medal', 'coleman', 'aflpa-mvp',
    'anzac-medal', 'showdown-medal', 'glendinning-allan-medal', 'brett-kirk-medal', 'marcus-ashcroft-medal',
    'goal-of-the-year', 'mark-of-the-year'].map((a, i) => [a, 300 + i])),
  resolvePlayer: (ref) => (ref.gridleyPlayerId ?? 9000 + ref.name.length),
  resolveCoach: (ref) => 7000 + ref.name.length,
};

type Occurrence = { board: number; orientation: 'row' | 'col'; position: number; item: GridleyItem; mapping: GridleyMapping };

function classifyCorpus(boards: CorpusBoard[]): Occurrence[] {
  const out: Occurrence[] = [];
  for (const b of boards) {
    b.rows.forEach((item, position) => out.push({ board: b.board, orientation: 'row', position, item, mapping: mapGridleyCriterion(item, STUB_LOOKUPS) }));
    b.cols.forEach((item, position) => out.push({ board: b.board, orientation: 'col', position, item, mapping: mapGridleyCriterion(item, STUB_LOOKUPS) }));
  }
  return out;
}

describe('Gridley corpus fixture', () => {
  const boards = loadCorpus();

  it('is the complete stored history: 1,143 boards, 6,858 criterion occurrences, 839 distinct criteria', () => {
    expect(boards).toHaveLength(1143);
    expect(boards[0]).toMatchObject({ board: 1, date: '2023-07-17' });
    expect(boards.at(-1)).toMatchObject({ board: 1143, date: '2026-09-01' });
    const items = boards.flatMap((b) => [...b.rows, ...b.cols]);
    expect(items).toHaveLength(6858);
    expect(new Set(items.map((i) => i.id)).size).toBe(839);
    // Board numbers are dense and dates are one per day (Gridley's level = days since 2023-07-16).
    boards.forEach((b, i) => expect(b.board).toBe(i + 1));
  });

  it('carries a non-empty answer key for every one of the 10,287 cells', () => {
    const answers = loadAnswers();
    let cells = 0;
    let entries = 0;
    for (const b of boards) {
      const key = answers[String(b.board)];
      expect(key, `board ${b.board}`).toHaveLength(3);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          cells++;
          expect(key[r][c].length, `board ${b.board} cell ${r}-${c}`).toBe(b.answerCounts[r][c]);
          expect(key[r][c].length, `board ${b.board} cell ${r}-${c}`).toBeGreaterThan(0);
          entries += key[r][c].length;
          for (let i = 1; i < key[r][c].length; i++) expect(key[r][c][i]).toBeGreaterThan(key[r][c][i - 1]);
        }
      }
    }
    expect(cells).toBe(10287);
    expect(entries).toBe(1512436);
  });
});

describe('Gridley compatibility mapping -- exhaustive classification', () => {
  const boards = loadCorpus();
  const occurrences = classifyCorpus(boards);
  const byStatus = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    const list = byStatus.get(o.mapping.status) ?? [];
    list.push(o);
    byStatus.set(o.mapping.status, list);
  }
  const distinct = (list: Occurrence[] | undefined) => new Set((list ?? []).map((o) => o.item.id)).size;

  it('recognises every criterion occurrence (zero unrecognised, zero unresolved with stub lookups)', () => {
    const unrecognised = byStatus.get('unrecognised') ?? [];
    const unresolved = byStatus.get('unresolved') ?? [];
    expect(
      unrecognised.map((o) => `#${o.board} ${o.orientation}${o.position} ${o.item.id}: ${o.mapping.status === 'unrecognised' ? o.mapping.reason : ''}`),
    ).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  it('accounts for the whole denominator explicitly', () => {
    const mappedList = byStatus.get('mapped') ?? [];
    const absentList = byStatus.get('unsupported') ?? [];
    const freebieList = byStatus.get('freebie') ?? [];
    expect(mappedList.length + absentList.length + freebieList.length).toBe(6858);

    // The denominator this suite certifies. Update these together with the
    // corpus fixture or the rule table, never one without the other.
    expect({
      occurrences: occurrences.length,
      distinctCriteria: distinct(occurrences),
      mappedOccurrences: mappedList.length,
      mappedDistinct: distinct(mappedList),
      freebieOccurrences: freebieList.length,
      dataAbsentOccurrences: absentList.length,
      dataAbsentDistinct: distinct(absentList),
    }).toEqual({
      occurrences: 6858,
      distinctCriteria: 839,
      mappedOccurrences: 6827,
      mappedDistinct: 830,
      freebieOccurrences: 1,
      dataAbsentOccurrences: 30,
      dataAbsentDistinct: 8,
    });
    // Tracked debt, not a pass: ISSUE-118's acceptance is zero data-absent
    // valid criteria (issues/open/AFLDB-ISSUE-118.md §23). The exact figure
    // is pinned so it only ever moves deliberately, and the integration
    // corpus run fails while it is above zero.
    expect(distinct(absentList)).toBeLessThanOrEqual(8);
  });

  it('names every data-absent criterion with its reason', () => {
    const absentList = byStatus.get('unsupported') ?? [];
    const summary = new Map<string, { title: string; reason: string; occurrences: number }>();
    for (const o of absentList) {
      if (o.mapping.status !== 'unsupported') continue;
      const entry = summary.get(o.item.id) ?? { title: o.item.title, reason: o.mapping.reason, occurrences: 0 };
      entry.occurrences++;
      summary.set(o.item.id, entry);
    }
    const rows = [...summary.entries()].sort((a, b) => b[1].occurrences - a[1].occurrences || a[0].localeCompare(b[0]));
    // The complete list, largest first. Every entry is a fact about AFLDB's
    // data, not about the solver: see issues/open/AFLDB-ISSUE-118.md §Stage 2.
    expect(rows.map(([id, r]) => `${id} [${r.occurrences}]`)).toEqual([
      'season2024player [14]',
      'intrulesplayer [5]',
      'winaftersiren [4]',
      'irish [2]', 'recruitedByDodoro [2]',
      'nfl [1]', 'spoils5season [1]', 'tasmanian [1]',
    ]);
    for (const [, r] of rows) expect(r.reason.length).toBeGreaterThan(20);
  });

  it('maps every mapped occurrence to a complete axis on a real builder', () => {
    for (const o of occurrences) {
      if (o.mapping.status !== 'mapped') continue;
      expect(Object.hasOwn(GRID_BUILDERS, o.mapping.axis.builder), o.item.id).toBe(true);
      expect(isAxisComplete(o.mapping.axis), o.item.id).toBe(true);
    }
  });

  it('maps each criterion id to exactly one axis regardless of the board it appears on', () => {
    const seen = new Map<string, string>();
    for (const o of occurrences) {
      if (o.mapping.status !== 'mapped') continue;
      const key = JSON.stringify(o.mapping.axis);
      const prior = seen.get(o.item.id);
      if (prior) expect(key, o.item.id).toBe(prior);
      seen.set(o.item.id, key);
    }
  });

  it('refuses a criterion whose title no longer matches the rule it was written for', () => {
    const drifted: GridleyItem = { id: 'games100', title: '100+ GOALS', subtitle: 'CAREER', description: null, type: null };
    expect(mapGridleyCriterion(drifted, STUB_LOOKUPS)).toMatchObject({ status: 'unrecognised' });
    const unknown: GridleyItem = { id: 'no-such-criterion', title: 'X', subtitle: null, description: null, type: null };
    expect(mapGridleyCriterion(unknown, STUB_LOOKUPS)).toMatchObject({ status: 'unrecognised' });
  });

  it('has no rule that the corpus never uses', () => {
    const used = new Set(occurrences.map((o) => o.item.id));
    expect(Object.keys(GRIDLEY_RULES).filter((id) => !used.has(id))).toEqual([]);
  });
});

describe('Gridley semantics that are decided by arithmetic or lineage, not by loosening', () => {
  const map = (id: string, title: string, subtitle: string | null = null, type: string | null = null) => (
    mapGridleyCriterion({ id, title, subtitle, description: null, type }, STUB_LOOKUPS)
  );

  it('"less than 10 goals" is career_goals_max(9)', () => {
    expect(map('goalscareerlessthan10', 'LESS THAN 10 GOALS')).toMatchObject({ axis: { builder: 'career_goals_max', params: { goals: '9' } } });
  });

  it('Brisbane Lions includes Fitzroy and the Bears via the merger link; every other club stays at its organization', () => {
    expect(map('BL', 'Brisbane Lions')).toMatchObject({ axis: { builder: 'played_for_club_incl_merged' } });
    expect(map('WB', 'Western Bulldogs')).toMatchObject({ axis: { builder: 'played_for_club' } });
    expect(map('bears', 'BRISBANE')).toMatchObject({ axis: { builder: 'played_for_club', params: { club: String(STUB_LOOKUPS.clubs['brisbane-bears']) } } });
    expect(map('debut-team-brisbane', 'BRISBANE LIONS')).toMatchObject({ axis: { builder: 'debut_club_incl_merged' } });
  });

  it('keeps the All-Australian final team distinct from the 40-man squad, and repeats on distinct seasons', () => {
    // Gridley's "ALL AUSTRALIAN" is the selected team (1953-1988 carnivals,
    // 1982-1990 VFL Team of the Year, 1991+), never the squad; the squad
    // criterion is its own id. Neither goes through the generic award
    // dropdown any more, so the page offers each by name.
    expect(map('allAus1953', 'ALL AUSTRALIAN')).toMatchObject({ axis: { builder: 'all_australian_team', params: {} } });
    expect(map('allAus2x', '2x ALL AUSTRALIAN')).toMatchObject({ axis: { builder: 'all_australian_team_min_times', params: { times: '2' } } });
    expect(map('allAus3x', '3x ALL AUSTRALIAN')).toMatchObject({ axis: { builder: 'all_australian_team_min_times', params: { times: '3' } } });
    expect(map('allAus2010s', 'ALL AUSTRALIAN')).toMatchObject({ axis: { builder: 'all_australian_team_between_seasons', params: { from: '2010', to: '2019' } } });
    expect(map('allAusSquad2024', 'ALL-AUSTRALIAN SQUAD')).toMatchObject({ axis: { builder: 'all_australian_squad_in_season', params: { season: '2024' } } });
    for (const key of ['all_australian_team', 'all_australian_team_min_times', 'all_australian_team_between_seasons']) {
      expect(GRID_BUILDERS[key].label, key).toMatch(/final team/);
      expect(GRID_BUILDERS[key].label, key).not.toMatch(/squad/i);
    }
    for (const key of ['all_australian_squad_member', 'all_australian_squad_in_season']) {
      expect(GRID_BUILDERS[key].label, key).toMatch(/40-man squad/);
      expect(GRID_BUILDERS[key].label, key).not.toMatch(/final team/);
    }
  });

  it('maps height bounds exactly onto players.height_cm builders', () => {
    expect(map('height195', '195cm', 'OR TALLER')).toMatchObject({ axis: { builder: 'height_min', params: { cm: '195' } } });
    expect(map('height180', '180cm', 'OR SHORTER')).toMatchObject({ axis: { builder: 'height_max', params: { cm: '180' } } });
    // ISSUE-118 Stage D1: age on debut is derived from canonical dob + debut_date, never from Gridley's key.
    expect(map('debut22', '22+ YEARS OLD', 'ON DEBUT')).toMatchObject({ axis: { builder: 'age_on_debut_min', params: { years: '22' } } });
  });

  it('teammate criteria resolve through the id-embedded Gridley player id or the title', () => {
    expect(map('adam-treloar-teammate-44', 'ADAM TRELOAR', 'ADAM TRELOAR TEAMMATE', 'player'))
      .toMatchObject({ axis: { builder: 'teammate_of', params: { player: '44' } } });
    expect(map('joshjkennedy', 'JOSH KENNEDY', 'KENNEDY TEAMMATE', 'player'))
      .toMatchObject({ axis: { builder: 'teammate_of' } });
    expect(map('dustin-martin-gf-opp-2259', 'DUSTIN MARTIN', 'DEFEATED BY DUSTY IN A GF', 'player'))
      .toMatchObject({ axis: { builder: 'lost_grand_final_against', params: { player: '2259' } } });
    // ISSUE-118 Stage E2: coach criteria resolve to a coaches row (the AFL Tables
    // coach-page person), never to a player, and map onto match_coaches.
    expect(map('coachedByWorsfold', 'JOHN WORSFOLD', 'COACHED BY WORSFOLD', 'player'))
      .toMatchObject({ axis: { builder: 'coached_by', params: { coach: String(7000 + 'JOHN WORSFOLD'.length) } } });
    expect(map('premcoach', 'PREMIERSHIP', 'COACH')).toMatchObject({ axis: { builder: 'premiership_coach' } });
  });

  it('normalises names the way the resolver compares them', () => {
    expect(normalisePlayerName('GARY ABLETT JR')).toBe('gary ablett');
    expect(normalisePlayerName("Jaeger O'Meara")).toBe('jaeger omeara');
    expect(normalisePlayerName('JAEGER OMEARA')).toBe('jaeger omeara');
    expect(normalisePlayerName('Jason Horne-Francis')).toBe('jason hornefrancis');
    expect(normalisePlayerName('Sam De Koning')).toBe('sam de koning');
  });
});
