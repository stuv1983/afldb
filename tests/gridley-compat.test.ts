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

import { GRID_BUILDERS, isAxisComplete, resolveDraftKind } from '@/search/grid-solver-spec';
import {
  GRIDLEY_CLUB_CODES,
  GRIDLEY_RULES,
  mapGridleyCriterion,
  normalisePlayerName,
  type GridleyItem,
  type GridleyLookups,
  type GridleyMapping,
} from '@/search/gridley-compat';
import { buildResolver, nationalPickKeyDisagreement, rookieSourceCoverageGap, triageDraftFinding, type LinkedDraftRow, type PlayerRow } from './gridley-corpus-support';
import { loadRookieRelistingOutcomes, type RookieRelistingOutcome } from './rookie-relisting-outcomes';

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
      mappedOccurrences: 6831,
      mappedDistinct: 831,
      freebieOccurrences: 1,
      dataAbsentOccurrences: 26,
      dataAbsentDistinct: 7,
    });
    // Tracked debt, not a pass: ISSUE-118's acceptance is zero data-absent
    // valid criteria (issues/closed/AFLDB-ISSUE-118.md §23). The exact figure
    // is pinned so it only ever moves deliberately, and the integration
    // corpus run fails while it is above zero.
    expect(distinct(absentList)).toBeLessThanOrEqual(7);
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
    // data, not about the solver: see issues/closed/AFLDB-ISSUE-118.md §Stage 2.
    expect(rows.map(([id, r]) => `${id} [${r.occurrences}]`)).toEqual([
      'season2024player [14]',
      'intrulesplayer [5]',
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

  it('keys a no-break-space name exactly like its ASCII spelling (AFLDB-ISSUE-222 corpus triage)', () => {
    // DraftGuru renders every player name with U+00A0 ("Jagga Smith"; a cp850 console shows
    // it as "JaggaáSmith"). The strip of non-[a-z0-9 ] characters used to delete the NBSP and
    // fuse the tokens into "jaggasmith", so a register holding such a name could never match a
    // Gridley title. Every Unicode space is folded to an ordinary space first.
    expect(normalisePlayerName('Jagga Smith')).toBe('jagga smith');
    expect(normalisePlayerName('Jagga Smith')).toBe(normalisePlayerName('JAGGA SMITH'));
    expect(normalisePlayerName('Willem Duursma')).toBe('willem duursma');
    expect(normalisePlayerName('  Sam \t De Koning ')).toBe('sam de koning');
  });

  it('draft criteria name a draft_kind, and both father-son criteria read the tracked list (AFLDB-ISSUE-221)', () => {
    expect(map('pick1', 'PICK 1', 'NATIONAL DRAFT')).toMatchObject({ axis: { builder: 'national_draft_pick_between', params: { from: '1', to: '1' } } });
    expect(map('picktop5', 'TOP 5', 'DRAFT PICK')).toMatchObject({ axis: { builder: 'national_draft_pick_between', params: { from: '1', to: '5' } } });
    expect(map('picktop10', 'TOP 10', 'DRAFT PICK')).toMatchObject({ axis: { builder: 'national_draft_pick_between', params: { from: '1', to: '10' } } });
    // draft_kind values, never the source's raw draft_type label, which spells
    // the national draft two ways ('National' / 'National Draft').
    expect(map('pickrookie', 'ROOKIE', 'DRAFT PICK')).toMatchObject({ axis: { builder: 'draft_type_is', params: { draftType: 'rookie' } } });
    expect(map('freeagent1', 'FREE AGENT', 'SIGNING')).toMatchObject({ axis: { builder: 'draft_type_is', params: { draftType: 'free_agency' } } });
    expect(map('traded1', 'TRADED', '1+ TIMES')).toMatchObject({ axis: { builder: 'traded_min_times', params: { times: '1' } } });
    // The son and the father of a father_son_selections row: the fully linked
    // tracked list, not draft_picks.signing_kind, which needs a pick-to-player
    // link the database holds for 5 of 6,810 rows.
    expect(map('fatherson', 'FATHER SON PICK', 'SINCE 1986')).toMatchObject({ axis: { builder: 'father_son_selection', params: {} } });
    expect(map('fathersonfather', 'FATHER OF', 'A FATHER-SON PICK')).toMatchObject({ axis: { builder: 'father_son_father', params: {} } });
    // Every draftType a rule binds is a kind the compiler resolves.
    for (const [id, rule] of Object.entries(GRIDLEY_RULES)) {
      const mapping = map(id, rule.titles[0]);
      if (mapping.status === 'mapped' && mapping.axis.builder === 'draft_type_is') {
        expect(resolveDraftKind(mapping.axis.params.draftType), id).not.toBeNull();
      }
    }
  });
});

/*
 * AFLDB-ISSUE-222 §6.3 — the corpus suite's pure helpers (tests/gridley-corpus-support.ts),
 * pinned DB-free against the exact shapes the 2026-09-19 afldb_test corpus run produced
 * (report sha256 7f14ff2c…): two 2026 debutants the player register does not hold although the
 * database carries 2026 matches, a mini-draft pick Gridley counts as a national top-10 pick,
 * and eight rookie re-listings the linked DraftGuru pages do not carry.
 */
describe('Gridley corpus support (AFLDB-ISSUE-222)', () => {
  const player = (id: number, displayName: string, debutSeason: number | null, finalSeason: number | null = debutSeason): PlayerRow => {
    const [givenName, ...rest] = displayName.split(' ');
    return { id, displayName, givenName, surname: rest.join(' '), debutSeason, finalSeason };
  };
  const ref = (criterionId: string, name: string) => ({ criterionId, name, gridleyPlayerId: null, champId: null });
  // A register that ends at the accepted 2025 baseline.
  const register2025 = [player(1, 'Alpha One', 1999, 2010), player(2, 'Josh Kennedy', 2006, 2022), player(3, 'Beta Two', 2025)];

  it('resolver: a 2026 override with no namesake is a REGISTER gap when no player debuted after 2025, even though the database holds 2026 matches', () => {
    const unresolved: string[] = [];
    const gaps: string[] = [];
    const resolve = buildResolver(register2025, unresolved, gaps, 2026);
    expect(resolve(ref('jagga-smith-teammate-13333', 'JAGGA SMITH'))).toBeNull();
    expect(resolve(ref('willem-duursma-teammate-13491', 'WILLEM DUURSMA'))).toBeNull();
    expect(unresolved).toEqual([]);
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toMatch(/^jagga-smith-teammate-13333: Jagga Smith debuted in 2026; no player on this database debuted after season 2025 .*AFLDB-ISSUE-224/);
    expect(gaps[1]).toMatch(/^willem-duursma-teammate-13491: Willem Duursma debuted in 2026; no player on this database debuted after season 2025/);
  });

  it('resolver: the match-horizon gap is unchanged when the database itself ends before the debut', () => {
    const unresolved: string[] = [];
    const gaps: string[] = [];
    buildResolver(register2025, unresolved, gaps, 2025)(ref('jagga-smith-teammate-13333', 'JAGGA SMITH'));
    expect(unresolved).toEqual([]);
    expect(gaps).toEqual(['jagga-smith-teammate-13333: Jagga Smith debuted in 2026; this database ends at season 2025']);
  });

  it('resolver: once the register holds a 2026 debut, a missing 2026 override is UNRESOLVED (a fault, not a gap)', () => {
    const unresolved: string[] = [];
    const gaps: string[] = [];
    const resolve = buildResolver([...register2025, player(4, 'Gamma Three', 2026)], unresolved, gaps, 2026);
    expect(resolve(ref('jagga-smith-teammate-13333', 'JAGGA SMITH'))).toBeNull();
    expect(gaps).toEqual([]);
    expect(unresolved).toEqual(['jagga-smith-teammate-13333: override Jagga Smith/2026 matched 0 players']);
  });

  it('resolver: a namesake with another debut season is never a gap', () => {
    const unresolved: string[] = [];
    const gaps: string[] = [];
    const resolve = buildResolver(register2025, unresolved, gaps, 2026, { 'x-teammate-1': { name: 'Josh Kennedy', debutSeason: 2026 } });
    expect(resolve(ref('x-teammate-1', 'JOSH KENNEDY'))).toBeNull();
    expect(gaps).toEqual([]);
    expect(unresolved).toEqual(['x-teammate-1: override Josh Kennedy/2026 matched 0 players']);
  });

  it('resolver: an override that hits exactly one debut resolves; a plain name resolves only when unique', () => {
    const unresolved: string[] = [];
    const gaps: string[] = [];
    const two = [...register2025, player(5, 'Josh Kennedy', 2008, 2020)];
    const resolve = buildResolver(two, unresolved, gaps, 2026);
    expect(resolve(ref('josh-p-kennedy-teammate-4298', 'JOSH KENNEDY'))).toBe(5);
    expect(resolve(ref('joshjkennedy', 'JOSH KENNEDY'))).toBe(2);
    expect(resolve(ref('alpha-one-teammate-9', 'ALPHA ONE'))).toBe(1);
    expect(resolve(ref('some-josh-kennedy-teammate-7', 'JOSH KENNEDY'))).toBeNull();
    expect(unresolved).toEqual(['some-josh-kennedy-teammate-7: "JOSH KENNEDY" matched 2 players (2/2006, 5/2008)']);
    expect(gaps).toEqual([]);
  });

  // The linked DraftGuru rows of the players behind the 2026-09-19 draft findings
  // (data/sources/draftguru/annual-html-20260826/parsed/rows.jsonl, bridged persons).
  const crouch: LinkedDraftRow[] = [
    { draftYear: 2011, draftKind: 'mini_draft', pickNumber: 2, club: 'Adelaide' },
    { draftYear: 2020, draftKind: 'free_agency', pickNumber: null, club: 'St Kilda' },
  ];
  const henderson: LinkedDraftRow[] = [
    { draftYear: 2007, draftKind: 'national', pickNumber: 8, club: 'Brisbane Lions' },
    { draftYear: 2009, draftKind: 'trade', pickNumber: null, club: 'Carlton' },
    { draftYear: 2015, draftKind: 'trade', pickNumber: null, club: 'Geelong' },
  ];
  const gwsSamReid: LinkedDraftRow[] = [
    { draftYear: 2007, draftKind: 'national', pickNumber: 35, club: 'Western Bulldogs' },
    { draftYear: 2011, draftKind: 'pre_draft', pickNumber: null, club: 'Greater Western Sydney' },
    { draftYear: 2015, draftKind: 'rookie', pickNumber: 8, club: 'Greater Western Sydney' },
  ];
  const top10 = { builder: 'national_draft_pick_between', params: { from: '1', to: '10' } };
  const rookie = { builder: 'draft_type_is', params: { draftType: 'rookie' } };

  it('triage: Brad Crouch (afldb 2054) -- a 2011 Mini-Draft pick 2 is inside TOP 5 / TOP 10 but is not a national pick', () => {
    expect(triageDraftFinding(crouch, top10)).toEqual({
      cause: 'non_national_pick_in_range',
      evidence: 'no linked national pick 1-10, but 2011 mini_draft pick 2 (Adelaide) is inside the range under another event kind; linked draft rows: 2011 mini_draft pick 2 (Adelaide); 2020 free_agency (St Kilda)',
    });
    expect(triageDraftFinding(crouch, { builder: 'national_draft_pick_between', params: { from: '1', to: '5' } }).cause).toBe('non_national_pick_in_range');
    // PICK 1 is simply not held, of any kind; the any-kind builder is satisfied.
    expect(triageDraftFinding(crouch, { builder: 'national_draft_pick_between', params: { from: '1', to: '1' } }).cause).toBe('no_linked_row_matches');
    expect(triageDraftFinding(crouch, { builder: 'draft_pick_between', params: { from: '1', to: '10' } }).cause).toBe('satisfied');
    expect(triageDraftFinding(crouch, { builder: 'draft_type_is', params: { draftType: 'Mini-Draft' } }).cause).toBe('satisfied');
  });

  it('triage: Lachie Henderson (afldb 8350) -- the linked DraftGuru page carries no Rookie event, so pickrookie has nothing to read', () => {
    expect(triageDraftFinding(henderson, rookie)).toEqual({
      cause: 'no_linked_row_matches',
      evidence: 'the linked source carries no rookie event for this person; linked draft rows: 2007 national pick 8 (Brisbane Lions); 2009 trade (Carlton); 2015 trade (Geelong)',
    });
    expect(triageDraftFinding(henderson, top10).cause).toBe('satisfied');
    expect(triageDraftFinding(henderson, { builder: 'traded_min_times', params: { times: '1' } }).cause).toBe('satisfied');
    expect(triageDraftFinding(henderson, { builder: 'traded_min_times', params: { times: '3' } }).cause).toBe('no_linked_row_matches');
    expect(triageDraftFinding(crouch, { builder: 'traded_min_times', params: { times: '1' } }).cause).toBe('no_linked_row_matches');
  });

  it('triage: a late-career rookie re-listing the source DOES carry satisfies pickrookie (GWS Sam Reid, 2015 Rookie pick 8)', () => {
    expect(triageDraftFinding(gwsSamReid, rookie).cause).toBe('satisfied');
    // His only pick inside 1-10 is that rookie pick 8: not a national pick.
    expect(triageDraftFinding(gwsSamReid, top10).cause).toBe('non_national_pick_in_range');
    expect(triageDraftFinding(gwsSamReid, { builder: 'national_draft_pick_between', params: { from: '30', to: '40' } }).cause).toBe('satisfied');
  });

  it('D1 (§11.19.12): the national-pick key disagreement fires only for a non-national pick inside a national range', () => {
    // Crouch: TOP 5 and TOP 10 are Gridley's key counting the 2011 mini-draft; PICK 1 has no evidence.
    expect(nationalPickKeyDisagreement(crouch, top10)).toBe(
      "Gridley's key counts a non-national selection as a National Draft pick 1-10 (AFLDB-ISSUE-222 §11.19.12 D1): no linked national pick 1-10, but 2011 mini_draft pick 2 (Adelaide) is inside the range under another event kind; linked draft rows: 2011 mini_draft pick 2 (Adelaide); 2020 free_agency (St Kilda)",
    );
    expect(nationalPickKeyDisagreement(crouch, { builder: 'national_draft_pick_between', params: { from: '5', to: '1' } })).toMatch(/^Gridley's key counts a non-national selection as a National Draft pick 1-5 /);
    expect(nationalPickKeyDisagreement(crouch, { builder: 'national_draft_pick_between', params: { from: '1', to: '1' } })).toBeNull();
    // A real national pick inside the range: AFLDB must list him, so no disagreement is claimed.
    expect(nationalPickKeyDisagreement(henderson, top10)).toBeNull();
    // Unlinked: a linkage matter, never Gridley's key.
    expect(nationalPickKeyDisagreement([], top10)).toBeNull();
    // Not a national-range builder: the rule does not reach pickrookie or the any-kind range.
    expect(nationalPickKeyDisagreement(crouch, rookie)).toBeNull();
    expect(nationalPickKeyDisagreement(crouch, { builder: 'draft_pick_between', params: { from: '1', to: '10' } })).toBeNull();
    // The national semantics of the builder are untouched: TOP 10 still maps national-only.
    expect(mapGridleyCriterion({ id: 'picktop10', title: 'TOP 10', subtitle: 'DRAFT PICK', description: null, type: null }, STUB_LOOKUPS))
      .toMatchObject({ axis: { builder: 'national_draft_pick_between', params: { from: '1', to: '10' } } });
  });

  it('triage: no linked row at all is a linkage gap, never a source or key finding; an unread builder is unassessed', () => {
    expect(triageDraftFinding([], top10)).toEqual({ cause: 'unlinked', evidence: 'linked draft rows: no trusted-linked draft row' });
    expect(triageDraftFinding([], rookie).cause).toBe('unlinked');
    expect(triageDraftFinding(henderson, { builder: 'drafted_by_club', params: { club: '4' } }).cause).toBe('unassessed');
  });

  // AFLDB-ISSUE-222 §11.19.12/§11.19.13, operator decision D2: the tracked, independently-sourced
  // review of the eight pickrookie disagreements (data/players/rookie-relisting-outcomes.csv).
  const hendersonOutcome: RookieRelistingOutcome = {
    afltablesProfile: 'players/L/Lachie_Henderson.html', player: 'Lachie Henderson', eventYear: 2019,
    eventClub: 'Geelong', pick: 35, evidenceStrength: 'primary', verdict: 'gridley_supported',
    evidence: "geelongcats.com.au: 'Pick 35, Rookie Draft, Geelong Football Club'",
    decidedOn: '2026-09-19', reference: 'AFLDB-ISSUE-222 §11.19.13 D2',
  };

  it('D2 (§11.19.12/§11.19.13): a reviewed gridley_supported outcome classifies its pickrookie cell as a source coverage gap', () => {
    expect(rookieSourceCoverageGap(henderson, rookie, hendersonOutcome)).toBe(
      "an independent source confirms a Rookie Draft selection DraftGuru's linked page omits (AFLDB-ISSUE-222 §11.19.13 D2): pick 35 (Geelong, 2019); geelongcats.com.au: 'Pick 35, Rookie Draft, Geelong Football Club'",
    );
  });

  it('D2: a player with no reviewed outcome is never reclassified, even with the identical no_linked_row_matches cause -- there is no general rule', () => {
    expect(rookieSourceCoverageGap(henderson, rookie, undefined)).toBeNull();
    expect(rookieSourceCoverageGap(crouch, rookie, undefined)).toBeNull();
  });

  it('D2: a draftguru_supported or undetermined verdict records review history but never reclassifies a cell', () => {
    expect(rookieSourceCoverageGap(henderson, rookie, { ...hendersonOutcome, verdict: 'draftguru_supported' })).toBeNull();
    expect(rookieSourceCoverageGap(henderson, rookie, { ...hendersonOutcome, verdict: 'undetermined' })).toBeNull();
  });

  it('D2: the outcome is read only for the pickrookie (draft_type_is rookie) axis; another builder is unaffected', () => {
    expect(rookieSourceCoverageGap(henderson, top10, hendersonOutcome)).toBeNull();
    expect(rookieSourceCoverageGap(henderson, { builder: 'draft_type_is', params: { draftType: 'Trade' } }, hendersonOutcome)).toBeNull();
    expect(rookieSourceCoverageGap(henderson, { builder: 'traded_min_times', params: { times: '1' } }, hendersonOutcome)).toBeNull();
  });

  it('D2: an unlinked player is unaffected even under a matching outcome -- a linkage matter, never a source gap', () => {
    expect(rookieSourceCoverageGap([], rookie, hendersonOutcome)).toBeNull();
  });

  it('D2 and D1 do not interfere: D1 stays national-only, D2 stays rookie-only, and a satisfied cause blocks either rule', () => {
    // Crouch is not reviewed for D2; D1 still fires for his national range, independent of D2.
    expect(rookieSourceCoverageGap(crouch, rookie, undefined)).toBeNull();
    expect(nationalPickKeyDisagreement(crouch, top10)).not.toBeNull();
    expect(rookieSourceCoverageGap(crouch, top10, undefined)).toBeNull();
    // Henderson's real national pick means neither rule has anything to say about top10.
    expect(nationalPickKeyDisagreement(henderson, top10)).toBeNull();
    expect(rookieSourceCoverageGap(henderson, top10, hendersonOutcome)).toBeNull();
    // A satisfied rookie cause (GWS Sam Reid's own real rookie row) blocks D2 even under an
    // (unrealistic, but probative) matching outcome: the rule reads the triage cause, not identity.
    expect(rookieSourceCoverageGap(gwsSamReid, rookie, hendersonOutcome)).toBeNull();
  });

  it('D2: every row of the real tracked artefact is recognised by the classifier (data/players/rookie-relisting-outcomes.csv)', () => {
    const outcomes = loadRookieRelistingOutcomes();
    expect(outcomes).toHaveLength(8);
    const noRookieRow: LinkedDraftRow[] = [{ draftYear: 2001, draftKind: 'national', pickNumber: 1, club: 'Some Club' }];
    for (const outcome of outcomes) {
      expect(outcome.verdict).toBe('gridley_supported');
      expect(rookieSourceCoverageGap(noRookieRow, rookie, outcome)).toContain(outcome.reference);
      expect(rookieSourceCoverageGap(noRookieRow, rookie, outcome)).toContain(`pick ${outcome.pick}`);
    }
  });
});
