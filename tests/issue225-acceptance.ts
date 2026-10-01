/**
 * AFLDB-ISSUE-225 (operator decisions D10, D11) -- the pure, database-free core of the ISSUE-225
 * acceptance population, shared by the read-only DEV acceptance probe
 * (tools/validation/issue225-dev-acceptance-probe.ts) and its DB-free pins
 * (tests/gridley-compat.test.ts).
 *
 * It is NOT a second corpus runner. It defines exactly the cells ISSUE-225 must prove at a 2026
 * horizon, each with the one classification that passes:
 *   - the 20 census `captain` cells (Gridley lists Bruce/May; after S1 AFLDB agrees);
 *   - the 15 census teammate cells (the D5 semantic contract);
 *   - the Swallow and Shiel census cells (their tracked `gridley_key_error` records);
 *   - every `captain` cell whose frozen key OMITS Cameron Bruce, which S1 can turn into a reverse
 *     disagreement: adjudicated exactly where the D10 evidence rule holds, `list membership` where
 *     the corpus suite's club-count arm takes the cell first, agreement everywhere else.
 *
 * `classifyIssue225Cell` mirrors the order of the corpus suite's classification chain
 * (tests/integration/gridley-corpus.test.ts) for the arms this population can reach, through the
 * same shared helpers. A disagreement on a builder whose corpus arm is NOT mirrored here is
 * `incorrect known answer` (fail closed), never guessed.
 */
import {
  buildCriterionListingIndex, CLUB_COUNT_BUILDER, criterionListedElsewhere, knownAnswerAdjudication, LIST_MEMBERSHIP_LACKING_BUILDER,
  teammateListMembership, type KnownAnswerRecord,
} from './gridley-corpus-support';

/** Gridley player ids (the ids its own teammate criteria embed). */
export const ISSUE225_GIDS = { BRUCE: 1350, MAY: 6788, SWALLOW: 2012, SHIEL: 2269 } as const;

/** The 2026-09-19 census (runbook §2): [board, cell, Gridley player id]. */
export const CAPTAIN_CENSUS: readonly (readonly [number, string, number])[] = [
  [908, '0-1', 1350], [919, '0-1', 1350], [919, '0-2', 1350], [923, '0-0', 1350], [938, '2-1', 1350], [938, '2-2', 6788],
  [948, '0-1', 1350], [988, '2-0', 1350], [988, '2-0', 6788], [988, '2-2', 6788], [1005, '0-1', 1350], [1005, '0-1', 6788],
  [1111, '2-1', 6788], [1111, '2-2', 6788], [1140, '2-0', 1350], [1140, '2-0', 6788], [1140, '2-1', 1350], [1140, '2-1', 6788],
  [1140, '2-2', 1350], [1140, '2-2', 6788],
];
export const TEAMMATE_CENSUS: readonly (readonly [number, string, number])[] = [
  [993, '0-1', 379], [1024, '0-0', 1359], [1024, '0-0', 3211], [1024, '0-0', 41], [1024, '0-0', 6173], [1024, '0-0', 1141],
  [1024, '0-0', 4287], [1024, '0-0', 1846], [1024, '0-1', 1130], [1024, '0-1', 3211], [1024, '0-1', 1128], [1024, '0-2', 1130],
  [1024, '0-2', 1141], [1024, '0-2', 3507], [1024, '0-2', 1846],
];
export const GAMES_CENSUS: readonly (readonly [number, string, number])[] = [[938, '0-1', 2012], [967, '0-2', 2269]];

export type Issue225Group = 'captain census' | 'teammate census' | 'games census' | 'bruce reverse';
export type Issue225Category = 'agreement' | 'time of board' | 'list membership' | 'adjudicated key disagreement' | 'incorrect known answer';

export type Issue225Cell = {
  group: Issue225Group; board: number; date: string; cell: string; row: string; col: string; gid: number;
  /** The only classification that passes. */
  expected: Issue225Category;
};

type Board = { board: number; date: string; rows: readonly { id: string }[]; cols: readonly { id: string }[] };

/**
 * The exact ISSUE-225 population from the frozen corpus and key. `builderOf` returns a criterion's
 * mapped builder, or null when it is not mapped (an `unsupported` criterion: the corpus never
 * compares known answers on such a cell, so it is excluded and counted). Throws when a census cell
 * is no longer a Gridley-listed cell on its criterion: an expected ISSUE-225 cell missing.
 */
export function issue225Population(
  boards: readonly Board[], answers: Record<string, number[][][]>, builderOf: (criterionId: string) => string | null,
): { cells: Issue225Cell[]; excluded: { board: number; cell: string; criterion: string }[] } {
  const byBoard = new Map(boards.map((b) => [b.board, b]));
  const cells: Issue225Cell[] = [];
  const at = (board: number, cell: string) => {
    const b = byBoard.get(board);
    const [r, c] = cell.split('-').map(Number);
    if (!b || !b.rows[r] || !b.cols[c]) throw new Error(`expected ISSUE-225 cell missing: board #${board} has no cell ${cell}`);
    return { b, r, c, row: b.rows[r].id, col: b.cols[c].id, key: answers[String(board)]?.[r]?.[c] ?? [] };
  };
  const census = (group: Issue225Group, list: readonly (readonly [number, string, number])[], criterion: RegExp, expected: Issue225Category) => {
    for (const [board, cell, gid] of list) {
      const x = at(board, cell);
      if (![x.row, x.col].some((id) => criterion.test(id)) || !x.key.includes(gid)) {
        throw new Error(`expected ISSUE-225 cell missing: #${board} ${cell} (${x.row} x ${x.col}) is not a Gridley-listed ${criterion} cell for ${gid}`);
      }
      cells.push({ group, board, date: x.b.date, cell, row: x.row, col: x.col, gid, expected });
    }
  };
  census('captain census', CAPTAIN_CENSUS, /^captain$/, 'agreement');
  census('teammate census', TEAMMATE_CENSUS, /^teammates-(100|150)$/, 'adjudicated key disagreement');
  census('games census', GAMES_CENSUS, /^(games250sameclub|games100clubs2)$/, 'adjudicated key disagreement');

  const { BRUCE } = ISSUE225_GIDS;
  const listing = buildCriterionListingIndex(boards, answers, new Set([BRUCE]));
  const excluded: { board: number; cell: string; criterion: string }[] = [];
  for (const b of boards) {
    b.rows.forEach((row, r) => b.cols.forEach((col, c) => {
      if (row.id !== 'captain' && col.id !== 'captain') return;
      if ((answers[String(b.board)]?.[r]?.[c] ?? []).includes(BRUCE)) return;
      const cell = `${r}-${c}`;
      const other = row.id === 'captain' ? col.id : row.id;
      const builder = builderOf(other);
      if (builder === null) { excluded.push({ board: b.board, cell, criterion: other }); return; }
      // D10 condition 4: does the frozen key independently accept Bruce under `other`?
      const accepted = criterionListedElsewhere(listing, BRUCE, other, b.board, cell);
      const expected: Issue225Category = !accepted ? 'agreement' : CLUB_COUNT_BUILDER.test(builder) ? 'list membership' : 'adjudicated key disagreement';
      cells.push({ group: 'bruce reverse', board: b.board, date: b.date, cell, row: row.id, col: col.id, gid: BRUCE, expected });
    }));
  }
  return { cells, excluded };
}

/** Builders whose corpus arm is not mirrored by classifyIssue225Cell: a disagreement on one fails closed. */
const UNMIRRORED_BUILDER = /^(hall_of_fame_player|premiership_captain|has_brother|height_min|height_max|national_draft_pick_between|draft_pick_between|draft_year_between|draft_type_is|drafted_by_club|drafted_by_club_never_played|recruited_via|traded_min_times)$/;

/**
 * Classifies one ISSUE-225 cell for one player, in the corpus suite's order: agreement; `time of
 * board`; the lacking-builder `list membership` arm; the D5 teammates arm; the club-count arm; the
 * tracked known-answer adjudication (D4/D10; a STALE record stays `incorrect known answer`).
 */
export function classifyIssue225Cell(input: {
  inGridley: boolean;
  axisCriteria: readonly [string, string];
  axisBuilders: readonly [string, string];
  /** AFLDB eligibility of the player on each axis. */
  axisHas: readonly [boolean, boolean];
  finalSeason: number | null; boardYear: number; maxSeason: number;
  records: readonly KnownAnswerRecord[] | undefined;
  gridleyListsElsewhere: (criterion: string) => boolean;
  playedTeammates: number;
  /** career_teammates_min's `x` when an axis is that builder. */
  teammateThreshold: number | null;
}): { category: Issue225Category; detail: string } {
  const { inGridley, axisCriteria, axisBuilders, axisHas } = input;
  const inAfldb = axisHas[0] && axisHas[1];
  const lackingIdx = inAfldb ? [] : [0, 1].filter((i) => !axisHas[i]);
  const head = `Gridley ${inGridley ? 'lists' : 'omits'}, AFLDB ${inAfldb ? 'lists' : 'omits'}${lackingIdx.length ? ` (missing from ${lackingIdx.map((i) => axisCriteria[i]).join('+')})` : ''}`;
  if (inGridley === inAfldb) return { category: 'agreement', detail: head };
  const { finalSeason, boardYear, maxSeason } = input;
  if (finalSeason === null || finalSeason >= boardYear || boardYear > maxSeason) {
    return { category: 'time of board', detail: `${head}; final season ${finalSeason ?? 'NULL'}, board ${boardYear}, horizon ${maxSeason}` };
  }
  if (inGridley && lackingIdx.length > 0 && lackingIdx.every((i) => LIST_MEMBERSHIP_LACKING_BUILDER.test(axisBuilders[i]))) {
    return { category: 'list membership', detail: head };
  }
  if (axisBuilders.includes('career_teammates_min') && input.teammateThreshold !== null) {
    const rule = teammateListMembership({
      inGridley, inAfldb, lackingBuilders: lackingIdx.map((i) => axisBuilders[i]), finalSeason,
      threshold: input.teammateThreshold, playedTeammates: input.playedTeammates,
    });
    if (rule !== null) return { category: 'adjudicated key disagreement', detail: `${head}; ${rule}` };
  }
  if (axisBuilders.some((b) => CLUB_COUNT_BUILDER.test(b))) return { category: 'list membership', detail: head };
  const unmirrored = axisBuilders.find((b) => UNMIRRORED_BUILDER.test(b));
  if (unmirrored) return { category: 'incorrect known answer', detail: `${head}; ${unmirrored} is outside the ISSUE-225 probe's mirrored arms` };
  if (input.records) {
    const adjudication = knownAnswerAdjudication({
      records: input.records, axisCriteria, lackingCriteria: lackingIdx.map((i) => axisCriteria[i]),
      inGridley, inAfldb, gridleyListsElsewhere: input.gridleyListsElsewhere,
    });
    if (adjudication !== null) {
      return { category: adjudication.outcome === 'adjudicated' ? 'adjudicated key disagreement' : 'incorrect known answer', detail: `${head}; ${adjudication.detail}` };
    }
  }
  return { category: 'incorrect known answer', detail: head };
}
