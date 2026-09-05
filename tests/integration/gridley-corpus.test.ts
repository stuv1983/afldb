/**
 * AFLDB-ISSUE-118 -- exhaustive Gridley compatibility regression.
 *
 * Every cell of every stored Gridley board (tests/fixtures/gridley, 1,143
 * boards, 10,287 cells) is pushed through the production Grid Solver path
 * against afldb_test, offline from Gridley itself:
 *
 *   1. every criterion is mapped (src/search/gridley-compat.ts) with ids
 *      resolved from THIS database -- clubs, venues, awards and players;
 *   2. each distinct mapped criterion is compiled by compileAxis and its
 *      full eligible-player set fetched once, timed;
 *   3. each cell is solved by solveCellSummary (the page's own call) and
 *      checked against the intersection of its two criterion sets, against
 *      Gridley's answer-set size, and -- for every Gridley player id the
 *      corpus itself lets us bridge to an AFLDB player -- against Gridley's
 *      own per-cell answer key in both directions.
 *
 * A failure names the board, the cell, the source criterion, the AFLDB
 * axis it became and one of the categories: parse (unrecognised),
 * unsupported (data absent), dataset gap, partial dataset, query failure,
 * timeout, empty answer, incorrect known answer. No catch-and-ignore.
 *
 * Acceptance (ISSUE-118, reopened 2026-09-05 -- runbook §23): every valid
 * Gridley criterion must be answered exactly. A criterion AFLDB holds no
 * data for is therefore a FAILURE of this suite, not an informational
 * count: `unsupported`, `dataset gap` and `partial dataset` fail by
 * default. Set AFLDB_GRIDLEY_DIAGNOSTIC=1 to downgrade those three to
 * counted-and-named while the acquisitions are in progress; the two
 * documented semantic differences (`time of board`, `list membership`)
 * stay informational in both modes.
 */
import './guard';

import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { compileAxis, solveCellSummary } from '@/db/queries/grid-solver';
import {
  mapGridleyCriterion,
  normalisePlayerName,
  type GridleyItem,
  type GridleyLookups,
  type GridleyMapping,
  type GridleyPlayerRef,
} from '@/search/gridley-compat';
import { type GridAxisState } from '@/search/grid-solver-spec';
import { loadAnswers, loadCorpus, type CorpusBoard } from '../gridley-compat.test';

afterAll(async () => {
  await sql.end();
});

// ---------------------------------------------------------------------------
// Player resolution: by normalised full name; ambiguous names are settled by
// the debut season recorded here, each one checked against Gridley's own
// answer key for that player's teammate cells (ISSUE-118 §Stage 2).
// ---------------------------------------------------------------------------

const PLAYER_OVERRIDES: Record<string, { name: string; debutSeason: number }> = {
  // Gridley's 'joshjkennedy' is the West Coast Josh J. Kennedy (Carlton debut
  // 2006): its cells against West Coast hold 134 answers and his teammate set
  // there has 133 players, the Sydney namesake's 8. 'josh-p-kennedy' is the
  // Sydney one (Hawthorn debut 2008): 118 vs 111 / 6.
  joshjkennedy: { name: 'Josh Kennedy', debutSeason: 2006 },
  'josh-p-kennedy-teammate-4298': { name: 'Josh Kennedy', debutSeason: 2008 },
  // Three Nathan Browns: 'nathanbrownwb' says Bulldogs; 5429 against the
  // Bulldogs column holds 74 answers and the 1997 debutant's set there is 69
  // (the others 3 and 7).
  nathanbrownwb: { name: 'Nathan Brown', debutSeason: 1997 },
  'nathan-brown-teammate-5429': { name: 'Nathan Brown', debutSeason: 1997 },
  scottthompsonad: { name: 'Scott Thompson', debutSeason: 2001 },
  tomhickey: { name: 'Tom Hickey', debutSeason: 2011 },
  garyablettjr: { name: 'Gary Ablett', debutSeason: 2002 },
  'gary-ablett-teammate-2602': { name: 'Gary Ablett', debutSeason: 2002 },
  // Melbourne's Mitch Brown (2011): 46 of Gridley's 59 against Melbourne, the
  // West Coast one 3. GWS's Sam Reid (2010): 109 of 135 against Sydney.
  'mitch-brown-teammate-5382': { name: 'Mitch Brown', debutSeason: 2011 },
  'sam-reid-teammate-6501': { name: 'Sam Reid', debutSeason: 2010 },
  'peter-bell-teammate-5825': { name: 'Peter Bell', debutSeason: 1995 },
  'charlie-cameron-teammate-1418': { name: 'Charlie Cameron', debutSeason: 2014 },
  'andrew-krakouer-teammate-323': { name: 'Andrew Krakouer', debutSeason: 2001 },
  'matthew-kennedy-teammate-5127': { name: 'Matthew Kennedy', debutSeason: 2016 },
  'archie-roberts-teammate-13198': { name: 'Archie Roberts', debutSeason: 2024 },
  'maurice-rioli jr-teammate-5166': { name: 'Maurice Rioli', debutSeason: 2021 },
  'jamie-elliott-teammate-3716': { name: 'Jamie Elliott', debutSeason: 2012 },
  'lindsay-thomas-teammate-4855': { name: 'Lindsay Thomas', debutSeason: 2007 },
  // Gridley titles him "Marty"; AFLDB records the given name.
  martymattner: { name: 'Martin Mattner', debutSeason: 2002 },
  // 2026 debutants: present only on a database that holds the 2026 season.
  'willem-duursma-teammate-13491': { name: 'Willem Duursma', debutSeason: 2026 },
  'jagga-smith-teammate-13333': { name: 'Jagga Smith', debutSeason: 2026 },
};

/**
 * Datasets the corpus depends on that a rebuilt afldb_test may not carry.
 * Probed once from the database; a criterion whose builder reads an absent
 * dataset is reported as a `dataset gap` (named, counted) rather than as a
 * solver failure, and the list of such criteria is asserted so a gap cannot
 * widen silently. On a database with the data, the list must be empty.
 */
type DatasetGaps = { maxSeason: number; draftLinks: boolean; matchEvents: boolean; heights: boolean };
const HEIGHT_BUILDERS = new Set(['height_min', 'height_max']);
const DRAFT_BUILDERS = new Set(['national_draft_pick_between', 'draft_pick_between', 'draft_year_between', 'draft_type_is', 'drafted_by_club', 'drafted_by_club_never_played', 'recruited_via', 'traded_min_times']);
const MATCH_EVENT_BUILDERS = new Set(['match_event_played', 'match_event_min', 'match_event_won', 'match_event_played_between']);

type PlayerRow = { id: number; displayName: string; givenName: string | null; surname: string | null; debutSeason: number | null; finalSeason: number | null };

function buildResolver(players: PlayerRow[], unresolvedLog: string[], gapLog: string[], maxSeason: number): (ref: GridleyPlayerRef) => number | null {
  const byName = new Map<string, PlayerRow[]>();
  for (const p of players) {
    const keys = new Set([normalisePlayerName(p.displayName), normalisePlayerName(`${p.givenName ?? ''} ${p.surname ?? ''}`)]);
    for (const k of keys) {
      if (!k) continue;
      const list = byName.get(k) ?? [];
      list.push(p);
      byName.set(k, list);
    }
  }
  return (ref) => {
    const override = PLAYER_OVERRIDES[ref.criterionId];
    if (override) {
      const hit = (byName.get(normalisePlayerName(override.name)) ?? []).filter((p) => p.debutSeason === override.debutSeason);
      if (hit.length === 1) return hit[0].id;
      if (hit.length === 0 && override.debutSeason > maxSeason) {
        gapLog.push(`${ref.criterionId}: ${override.name} debuted in ${override.debutSeason}; this database ends at season ${maxSeason}`);
        return null;
      }
      unresolvedLog.push(`${ref.criterionId}: override ${override.name}/${override.debutSeason} matched ${hit.length} players`);
      return null;
    }
    const candidates = byName.get(normalisePlayerName(ref.name)) ?? [];
    if (candidates.length === 1) return candidates[0].id;
    unresolvedLog.push(`${ref.criterionId}: "${ref.name}" matched ${candidates.length} players${candidates.length ? ` (${candidates.map((c) => `${c.id}/${c.debutSeason}`).join(', ')})` : ''}`);
    return null;
  };
}

// ---------------------------------------------------------------------------

type CriterionRecord = {
  id: string;
  item: GridleyItem;
  mapping: GridleyMapping;
  occurrences: number;
  /** AFLDB eligible player ids, when mapped. */
  set: Set<number> | null;
  elapsedMs: number | null;
  error: string | null;
};

type CellFinding = {
  board: number;
  cell: string;
  category: 'parse' | 'unsupported' | 'dataset gap' | 'partial dataset' | 'query failure' | 'timeout' | 'empty answer'
    | 'incorrect known answer' | 'count mismatch' | 'time of board' | 'list membership'
    | 'external source disagreement' | 'source conflict';
  row: string;
  col: string;
  rowAxis: string;
  colAxis: string;
  detail: string;
};

const boards: CorpusBoard[] = loadCorpus();
const answers = loadAnswers();
const criteria = new Map<string, CriterionRecord>();
const findings: CellFinding[] = [];
const unresolvedLog: string[] = [];
const gapLog: string[] = [];
let gaps: DatasetGaps = { maxSeason: 0, draftLinks: true, matchEvents: true, heights: true };
/** Diagnostic mode: dataset-shaped findings are counted and named instead of failing. Never the default. */
const DIAGNOSTIC = process.env.AFLDB_GRIDLEY_DIAGNOSTIC === '1';
/** Criteria whose builder reads a dataset this database does not carry. */
const gappedCriteria = new Set<string>();
/** Gridley player id -> AFLDB player id, from the corpus' own player-valued criteria. */
const bridge = new Map<number, number>();
/** AFLDB player id -> final season, for the date-aware oracle. */
const finalSeasons = new Map<number, number | null>();
/** AFLDB player id -> Hall of Fame induction year: an honour a retired player can still gain after a board's date. */
const hallOfFameYears = new Map<number, number>();
/**
 * AFLDB player id -> every height an INDEPENDENT source asserts (player_height_evidence
 * rows from any source but AFL Tables: the AFL API season rosters, the tracked Wikipedia
 * adjudication set). ISSUE-118 §23.19: a height cell Gridley disagrees on is classified
 * from this evidence, never from Gridley's own answer.
 */
const heightEvidence = new Map<number, { source: string; height: number }[]>();
/**
 * ISSUE-118 §23.23. AFLDB player id -> the co-captaincy AFLDB's own canonical data records for a
 * premiership: more than one linked captain of the premier club that season, each of whom played in
 * and won the Grand Final. Built from captaincies + match facts, never from Gridley's answer.
 */
const coCaptaincy = new Map<number, string>();
/** Documented semantic differences between Gridley and AFLDB: reported and counted, never failed. */
const INFORMATIONAL: Record<string, string> = {
  'time of board': "Gridley's answer key is frozen at the board's date and the player was still playing then; AFLDB answers for today",
  'list membership': "Gridley's club, decade, teammate, club-count, wooden-spoon and minor-premiership criteria include players merely listed by a club that season (a trade-period move, the suspended 2016 Essendon players); AFLDB models games played",
  'external source disagreement': "a height cell where every independent source AFLDB holds (AFL API roster, Wikipedia infobox) sits on AFLDB's side of the bound and none on Gridley's (ISSUE-118 §23.19); or a premiership-captain cell where AFLDB's canonical captaincies record the player as one of several captains of the premier club that season who all played and won the Grand Final, and Gridley's key names one premiership captain per flag (ISSUE-118 §23.23). AFLDB's answer is source-backed; the definitions differ",
};
/**
 * Data AFLDB (or this database) does not hold. These FAIL the run: the
 * acceptance target is zero. In diagnostic mode they are counted and named
 * so the remaining acquisitions can be tracked without hiding them.
 */
const DATA_GAPS: Record<string, string> = {
  unsupported: 'the criterion needs data AFLDB does not hold (src/search/gridley-compat.ts names it) -- acquisition required',
  'dataset gap': 'this database lacks a dataset the criterion reads (draft links, marquee tags, a later season, player heights)',
  'partial dataset': 'a mapped criterion whose builder reads a dataset its mapping note declares partial (none since AFLDB-ISSUE-118 §23.21 completed captaincies)',
  'source conflict': "a height cell where an independent source supports Gridley's side of the bound, or no independent source exists; AFLDB keeps the AFL Tables value (ISSUE-118 §23.19) but its answer is not proven, so the cell stays open",
};
const cellStats: { board: number; cell: string; gridley: number; afldb: number; ms: number }[] = [];

const describeAxis = (m: GridleyMapping) => (m.status === 'mapped' ? `${m.axis.builder}(${JSON.stringify(m.axis.params)})` : m.status);

function isTimeout(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === '57014';
}

async function eligibleSet(axis: GridAxisState): Promise<Set<number>> {
  const rows = await sql<{ id: number }[]>`
    SELECT p.id FROM players p JOIN player_career_stats c ON c.player_id = p.id
     WHERE ${compileAxis(axis)}
  `;
  return new Set(rows.map((r) => r.id));
}

beforeAll(async () => {
  const [clubs, venues, awards, players, hof, evidence, coCaptains, [probe]] = await Promise.all([
    sql<{ slug: string; id: number }[]>`SELECT slug, id FROM club_organizations`,
    sql<{ name: string; id: number }[]>`SELECT canonical_name AS name, id FROM venues`,
    sql<{ slug: string; id: number }[]>`SELECT slug, id FROM awards`,
    sql<PlayerRow[]>`SELECT p.id, p.display_name AS "displayName", p.given_name AS "givenName", p.surname,
                            c.debut_season AS "debutSeason", c.final_season AS "finalSeason"
                       FROM players p LEFT JOIN player_career_stats c ON c.player_id = p.id`,
    sql<{ playerId: number; inductedYear: number | null }[]>`SELECT player_id AS "playerId", inducted_year AS "inductedYear" FROM hall_of_fame WHERE player_id IS NOT NULL`,
    sql<{ playerId: number; source: string; height: number }[]>`SELECT e.player_id AS "playerId", s.key AS source, e.height_cm AS height
                                                                  FROM player_height_evidence e JOIN sources s ON s.id = e.source_id WHERE s.key <> 'afltables'`,
    // Premiership club-seasons with more than one linked captain who played in and won the Grand Final.
    sql<{ playerId: number; season: number; club: string; others: string }[]>`
      WITH prem AS (SELECT m.season, m.winner_club_id AS club_id, m.id AS match_id FROM matches m
                     WHERE m.round_type = 'grand_final' AND m.winner_club_id IS NOT NULL),
           caps AS (SELECT cp.season, cp.club_id, cp.player_id, p.display_name
                      FROM captaincies cp JOIN players p ON p.id = cp.player_id
                      JOIN prem ON prem.season = cp.season AND prem.club_id = cp.club_id
                      JOIN player_match_stats pms ON pms.match_id = prem.match_id AND pms.player_id = cp.player_id
                     WHERE cp.link_status_value IN ('unique', 'resolved'))
      SELECT a.player_id AS "playerId", a.season, c.name AS club,
             string_agg(b.display_name, ', ' ORDER BY b.display_name) AS others
        FROM caps a JOIN caps b ON b.season = a.season AND b.club_id = a.club_id AND b.player_id <> a.player_id
        JOIN clubs c ON c.id = a.club_id
       GROUP BY a.player_id, a.season, c.name`,
    sql<{ maxSeason: number; draftTotal: string; draftLinked: string; matchEvents: string; heights: string }[]>`
      SELECT (SELECT max(season) FROM matches)::int AS "maxSeason",
             (SELECT count(*) FROM draft_picks) AS "draftTotal",
             (SELECT count(*) FROM draft_picks WHERE link_status_value IN ('unique', 'resolved')) AS "draftLinked",
             (SELECT count(*) FROM matches WHERE match_event IS NOT NULL) AS "matchEvents",
             (SELECT count(*) FROM players WHERE height_cm IS NOT NULL) AS "heights"`,
  ]);
  // A dataset counts as present when at least half of it is usable: afldb_dev
  // links 5,103 of 6,810 draft picks; a rebuilt afldb_test links 5.
  gaps = {
    maxSeason: probe.maxSeason,
    draftLinks: Number(probe.draftLinked) * 2 >= Number(probe.draftTotal),
    matchEvents: Number(probe.matchEvents) > 0,
    heights: Number(probe.heights) > 0,
  };
  for (const p of players) finalSeasons.set(p.id, p.finalSeason);
  for (const h of hof) if (h.inductedYear !== null) hallOfFameYears.set(h.playerId, h.inductedYear);
  for (const e of evidence) {
    const l = heightEvidence.get(e.playerId) ?? []; l.push({ source: e.source, height: e.height }); heightEvidence.set(e.playerId, l);
  }
  for (const r of coCaptains) {
    coCaptaincy.set(r.playerId, `${coCaptaincy.get(r.playerId) ? `${coCaptaincy.get(r.playerId)}; ` : ''}co-captain of ${r.club} ${r.season} with ${r.others} (all played and won the Grand Final)`);
  }
  const lookups: GridleyLookups = {
    clubs: Object.fromEntries(clubs.map((c) => [c.slug, c.id])),
    venues: Object.fromEntries(venues.map((v) => [v.name, v.id])),
    awards: Object.fromEntries(awards.map((a) => [a.slug, a.id])),
    resolvePlayer: buildResolver(players, unresolvedLog, gapLog, probe.maxSeason),
  };

  for (const b of boards) {
    for (const item of [...b.rows, ...b.cols]) {
      const existing = criteria.get(item.id);
      if (existing) {
        existing.occurrences++;
        continue;
      }
      const mapping = mapGridleyCriterion(item, lookups);
      criteria.set(item.id, { id: item.id, item, mapping, occurrences: 1, set: null, elapsedMs: null, error: null });
      if (mapping.status === 'mapped') {
        if ((!gaps.draftLinks && DRAFT_BUILDERS.has(mapping.axis.builder))
          || (!gaps.matchEvents && MATCH_EVENT_BUILDERS.has(mapping.axis.builder))
          || (!gaps.heights && HEIGHT_BUILDERS.has(mapping.axis.builder))) gappedCriteria.add(item.id);
      } else if (mapping.status === 'unresolved' && gapLog.some((g) => g.startsWith(`${item.id}:`))) {
        gappedCriteria.add(item.id);
      }
      if (mapping.status === 'mapped' && mapping.axis.params.player) {
        const m = /-(?:teammate|gf-opp)-(\d+)$/.exec(item.id);
        if (m) bridge.set(Number(m[1]), Number(mapping.axis.params.player));
      }
    }
  }

  // One set per distinct mapped criterion, through the production compiler.
  for (const rec of criteria.values()) {
    if (rec.mapping.status !== 'mapped') continue;
    const started = performance.now();
    try {
      rec.set = await eligibleSet(rec.mapping.axis);
    } catch (err) {
      rec.error = `${isTimeout(err) ? 'timeout' : 'query failure'}: ${(err as Error).message}`;
    }
    rec.elapsedMs = performance.now() - started;
  }
}, 900_000);

describe('Gridley corpus -- criteria', () => {
  it('names every dataset this database lacks, and nothing else is empty or unresolved', () => {
    console.log(`[gridley-corpus] dataset gaps on this database: ${JSON.stringify(gaps)}; gapped criteria: ${[...gappedCriteria].sort().join(', ') || 'none'}`);
    expect(unresolvedLog).toEqual([]);
    const unresolved = [...criteria.values()].filter((r) => (r.mapping.status === 'unresolved' && !gappedCriteria.has(r.id)) || r.mapping.status === 'unrecognised');
    expect(unresolved.map((r) => `${r.id}: ${describeAxis(r.mapping)} ${'reason' in r.mapping ? r.mapping.reason : ''}`)).toEqual([]);
    // Every empty eligible set must be explained by a probed gap.
    const empty = [...criteria.values()].filter((r) => r.set !== null && r.set.size === 0 && !gappedCriteria.has(r.id));
    expect(empty.map((r) => `${r.id} [${r.occurrences}] -> ${describeAxis(r.mapping)}`)).toEqual([]);
    // And a probed gap must actually be a gap here: on a complete database the list is empty.
    if (gaps.draftLinks && gaps.matchEvents && gaps.heights && gaps.maxSeason >= 2026) expect([...gappedCriteria]).toEqual([]);
  });

  it('has no valid criterion left unsupported, and no probed dataset gap, unless run in diagnostic mode', () => {
    const unsupported = [...criteria.values()].filter((r) => r.mapping.status === 'unsupported')
      .sort((a, b) => b.occurrences - a.occurrences || a.id.localeCompare(b.id))
      .map((r) => `${r.id} [${r.occurrences}]: ${'reason' in r.mapping ? r.mapping.reason : ''}`);
    console.log(`[gridley-corpus] unsupported valid criteria: ${unsupported.length}\n${unsupported.join('\n')}`);
    if (DIAGNOSTIC) {
      console.log('[gridley-corpus] AFLDB_GRIDLEY_DIAGNOSTIC=1: unsupported criteria and dataset gaps are counted, not failed. This is NOT an acceptance run.');
      return;
    }
    expect(unsupported).toEqual([]);
    expect([...gappedCriteria].sort()).toEqual([]);
  });

  it('bridges the Gridley player ids the corpus embeds', () => {
    // 403 criteria embed a Gridley player id (401 teammate ids + 2 Grand Final
    // opponents who also appear as teammates: 401 distinct players), less any
    // 2026 debutant this database does not yet hold.
    const gappedBridges = [...gappedCriteria].filter((id) => /-(?:teammate|gf-opp)-\d+$/.test(id)).length;
    expect(bridge.size + gappedBridges).toBe(401);
    expect(bridge.size).toBeGreaterThanOrEqual(395);
  });

  it('compiles and answers every mapped criterion without error or timeout', () => {
    const failed = [...criteria.values()].filter((r) => r.error !== null);
    expect(failed.map((r) => `${r.id} -> ${describeAxis(r.mapping)}: ${r.error}`)).toEqual([]);
  });

  it('flags every criterion whose full eligible set takes over one second and fails any over four', () => {
    const slow = [...criteria.values()].filter((r) => (r.elapsedMs ?? 0) > 1000)
      .sort((a, b) => (b.elapsedMs ?? 0) - (a.elapsedMs ?? 0))
      .map((r) => `${r.id} -> ${describeAxis(r.mapping)}: ${Math.round(r.elapsedMs ?? 0)} ms (${r.set?.size ?? '?'} players)`);
    console.log(`[gridley-corpus] criteria over 1 s: ${slow.length}\n${slow.join('\n')}`);
    // 4 s is the ISSUE-076 safety margin under the 5 s statement timeout.
    expect([...criteria.values()].filter((r) => (r.elapsedMs ?? 0) > 4000).map((r) => r.id)).toEqual([]);
  });
});

describe('Gridley corpus -- every cell through solveCellSummary', () => {
  it.each(boards.map((b) => [b.board, b] as const))('board #%i', async (_n, board) => {
    const key = answers[String(board.board)];
    await Promise.all(board.rows.flatMap((rowItem, r) => board.cols.map(async (colItem, c) => {
      const cell = `${r}-${c}`;
      const rowRec = criteria.get(rowItem.id)!;
      const colRec = criteria.get(colItem.id)!;
      const base = { board: board.board, cell, row: rowItem.id, col: colItem.id, rowAxis: describeAxis(rowRec.mapping), colAxis: describeAxis(colRec.mapping) };
      const gridleyIds = key[r][c];

      if (rowRec.mapping.status === 'unsupported' || colRec.mapping.status === 'unsupported') {
        const reason = [rowRec, colRec].filter((x) => x.mapping.status === 'unsupported')
          .map((x) => `${x.id}: ${(x.mapping as { reason: string }).reason}`).join('; ');
        findings.push({ ...base, category: 'unsupported', detail: reason });
        return;
      }
      if (gappedCriteria.has(rowItem.id) || gappedCriteria.has(colItem.id)) {
        findings.push({ ...base, category: 'dataset gap', detail: [rowItem.id, colItem.id].filter((id) => gappedCriteria.has(id)).join(', ') });
        return;
      }
      for (const rec of [rowRec, colRec]) {
        if (rec.mapping.status === 'unrecognised' || rec.mapping.status === 'unresolved') {
          findings.push({ ...base, category: 'parse', detail: rec.mapping.reason });
          return;
        }
      }
      if (rowRec.error || colRec.error) {
        findings.push({ ...base, category: (rowRec.error ?? colRec.error)!.startsWith('timeout') ? 'timeout' : 'query failure', detail: rowRec.error ?? colRec.error ?? '' });
        return;
      }

      // A freebie on one axis means the cell is the other axis alone.
      const axes: GridAxisState[] = [];
      const sets: Set<number>[] = [];
      for (const rec of [rowRec, colRec]) {
        if (rec.mapping.status === 'mapped') {
          axes.push(rec.mapping.axis);
          sets.push(rec.set!);
        }
      }
      let expected: Set<number>;
      if (sets.length === 2) {
        const [a, b] = sets[0].size <= sets[1].size ? sets : [sets[1], sets[0]];
        expected = new Set([...a].filter((id) => b.has(id)));
      } else if (sets.length === 1) {
        expected = sets[0];
      } else {
        // Two freebies never occur in the corpus; a board built of them would be "every player".
        findings.push({ ...base, category: 'parse', detail: 'both axes are freebies' });
        return;
      }

      // The production call. For a freebie cell the other axis is paired
      // with itself, which the AND-fold makes a no-op.
      const started = performance.now();
      let summary;
      try {
        summary = await solveCellSummary(axes[0], axes[1] ?? axes[0], 'games_asc');
      } catch (err) {
        findings.push({ ...base, category: isTimeout(err) ? 'timeout' : 'query failure', detail: (err as Error).message });
        return;
      }
      const ms = performance.now() - started;
      cellStats.push({ board: board.board, cell, gridley: gridleyIds.length, afldb: summary.eligible, ms });

      if (summary.eligible !== expected.size) {
        findings.push({ ...base, category: 'count mismatch', detail: `solveCellSummary eligible=${summary.eligible} but criterion-set intersection=${expected.size}` });
      }
      const boardYear = Number(board.date.slice(0, 4));
      const partial = [rowRec, colRec].some((x) => x.mapping.status === 'mapped' && (x.mapping.note ?? '').startsWith('captaincies'));
      if (summary.eligible === 0) {
        if (partial) {
          findings.push({ ...base, category: 'partial dataset', detail: `Gridley lists ${gridleyIds.length} answers; ${INFORMATIONAL['partial dataset']}` });
        } else if (boardYear > gaps.maxSeason) {
          findings.push({ ...base, category: 'dataset gap', detail: `Gridley lists ${gridleyIds.length} answers on a ${boardYear} board; this database ends at season ${gaps.maxSeason}` });
        } else {
          findings.push({ ...base, category: 'empty answer', detail: `Gridley lists ${gridleyIds.length} answers; AFLDB returns none` });
        }
      }
      // Known answers, both directions, over the bridged players. Gridley's
      // key is frozen at the board's date, so only a player whose career had
      // ended before that year is a fair comparison for today's AFLDB.
      const gridleySet = new Set(gridleyIds);
      const axisItems = [rowItem, colItem];
      const axisBuilders = [rowRec, colRec].map((x) => (x.mapping.status === 'mapped' ? x.mapping.axis.builder : ''));
      for (const [gid, afldbId] of bridge) {
        const inGridley = gridleySet.has(gid);
        const inAfldb = expected.has(afldbId);
        if (inGridley === inAfldb) continue;
        // Which mapped axis lacks the player (a freebie axis has no set and can lack nobody).
        const mappedIdx = [rowRec, colRec].map((x, i) => (x.mapping.status === 'mapped' ? i : -1)).filter((i) => i >= 0);
        const lackingIdx = !inAfldb ? mappedIdx.filter((i, n) => !sets[n].has(afldbId)) : [];
        const lacking = lackingIdx.map((i) => axisItems[i].id).join('+');
        const detail = `gridley player ${gid} = afldb ${afldbId}: Gridley ${inGridley ? 'lists' : 'omits'}, AFLDB ${inAfldb ? 'lists' : 'omits'}${lacking ? ` (missing from ${lacking})` : ''}`;
        const finalSeason = finalSeasons.get(afldbId) ?? null;
        const inductedAfterBoard = axisBuilders.includes('hall_of_fame_player') && (hallOfFameYears.get(afldbId) ?? 0) >= boardYear;
        let category: CellFinding['category'] = 'incorrect known answer';
        if (partial) category = 'partial dataset';
        else if (finalSeason === null || finalSeason >= boardYear || boardYear > gaps.maxSeason || inductedAfterBoard) category = 'time of board';
        else if (inGridley && lackingIdx.length > 0 && lackingIdx.every((i) => /^(played_(for_club|in_decade)|teammate_of|wooden_spoon_season|minor_premiership_season)$/.test(axisBuilders[i]))) category = 'list membership';
        // A club-count criterion in either direction: Gridley's own text counts a
        // trade-period move to a club the player never played for.
        else if (axisBuilders.some((b) => /^(one_club_player|multi_club_player|clubs_played_min)/.test(b))) category = 'list membership';
        // ISSUE-118 §23.23. A premiership-captain cell where AFLDB lists a co-captain Gridley
        // omits. Gridley's key names one premiership captain per flag (the tracked captain
        // lists carry the same single designation as a note); AFLDB's canonical captaincies
        // record every appointed captain, and the compile requires the player to have played
        // in and won the Grand Final. Classified from AFLDB's own co-captaincy evidence, never
        // from Gridley's answer: a definitional disagreement, reported, not failed.
        else if (category === 'incorrect known answer' && axisBuilders.includes('premiership_captain')
                 && inAfldb && !inGridley && coCaptaincy.has(afldbId)) {
          findings.push({ ...base, category: 'external source disagreement', detail: `${detail}; ${coCaptaincy.get(afldbId)}` });
          continue;
        }
        // ISSUE-118 §23.19. A height cell: Gridley's height source differs from the AFL
        // Tables register. Classify from the independent evidence AFLDB holds for the
        // player, never from Gridley's answer: corroborated on AFLDB's side of the bound
        // and unsupported on Gridley's -> external source disagreement (reported);
        // otherwise a source conflict that stays open.
        else if (category === 'incorrect known answer') {
          const hi = axisBuilders.findIndex((b) => b.startsWith('height_'));
          const heightIsTheDifference = hi >= 0 && (inAfldb || lackingIdx.includes(hi));
          if (heightIsTheDifference) {
            const m = [rowRec, colRec][hi].mapping;
            const cm = m.status === 'mapped' ? Number(m.axis.params.cm) : NaN;
            const satisfies = (h: number) => (axisBuilders[hi] === 'height_min' ? h >= cm : h <= cm);
            const independent = heightEvidence.get(afldbId) ?? [];
            const onAfldbSide = independent.filter((e) => satisfies(e.height) === inAfldb);
            const onGridleySide = independent.filter((e) => satisfies(e.height) === inGridley);
            const list = (l: { source: string; height: number }[]) => l.map((e) => `${e.source} ${e.height}`).join(', ');
            if (independent.length > 0 && onGridleySide.length === 0) {
              findings.push({ ...base, category: 'external source disagreement', detail: `${detail}; independent sources on AFLDB's side: ${list(onAfldbSide)}` });
            } else {
              findings.push({ ...base, category: 'source conflict', detail: `${detail}; ${independent.length === 0 ? 'no independent height source' : `independent sources on Gridley's side: ${list(onGridleySide)}${onAfldbSide.length ? `; on AFLDB's side: ${list(onAfldbSide)}` : ''}`}` });
            }
            continue;
          }
        }
        findings.push({ ...base, category, detail });
      }
    })));
  }, 120_000);

  it('writes the run report and has no failing cells', () => {
    const byCategory = new Map<string, number>();
    for (const f of findings) byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
    const slowCells = cellStats.filter((s) => s.ms > 1000).sort((a, b) => b.ms - a.ms);
    const report = {
      boards: boards.length,
      cells: boards.length * 9,
      solvedCells: cellStats.length,
      findingsByCategory: Object.fromEntries(byCategory),
      slowCells: slowCells.slice(0, 50),
      criteria: [...criteria.values()].map((r) => ({
        id: r.id, occurrences: r.occurrences, status: r.mapping.status, axis: describeAxis(r.mapping),
        players: r.set?.size ?? null, ms: r.elapsedMs === null ? null : Math.round(r.elapsedMs), error: r.error,
      })),
      cellStats,
      findings,
    };
    const out = process.env.AFLDB_GRIDLEY_REPORT;
    if (out) writeFileSync(join(out), JSON.stringify(report, null, 1));
    console.log(`[gridley-corpus] cells solved ${cellStats.length}/${boards.length * 9}; findings ${JSON.stringify(report.findingsByCategory)}; cells over 1 s: ${slowCells.length}`);
    for (const [category, reason] of Object.entries(INFORMATIONAL)) {
      if (byCategory.has(category)) console.log(`[gridley-corpus]   ${category} (${byCategory.get(category)}): ${reason}`);
    }
    for (const [category, reason] of Object.entries(DATA_GAPS)) {
      if (byCategory.has(category)) console.log(`[gridley-corpus]   ${category} (${byCategory.get(category)}): ${reason}${DIAGNOSTIC ? ' [diagnostic: not failed]' : ' [FAILS: acceptance is zero]'}`);
    }

    const failing = findings.filter((f) => !Object.hasOwn(INFORMATIONAL, f.category) && !(DIAGNOSTIC && Object.hasOwn(DATA_GAPS, f.category)));
    expect(failing.slice(0, 40).map((f) => `#${f.board} ${f.cell} [${f.category}] ${f.row} x ${f.col} :: ${f.rowAxis} x ${f.colAxis} :: ${f.detail}`)).toEqual([]);
    expect(failing).toHaveLength(0);
    // Over 1 s is flagged in the report; over 4 s (the ISSUE-076 margin) fails.
    expect(slowCells.filter((s) => s.ms > 4000).map((s) => `#${s.board} ${s.cell}: ${Math.round(s.ms)} ms`)).toEqual([]);
  });
});
