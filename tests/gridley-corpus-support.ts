/**
 * AFLDB-ISSUE-118 / AFLDB-ISSUE-222 -- the pure, database-free parts of the Gridley corpus
 * suite (tests/integration/gridley-corpus.test.ts), extracted so their behaviour can be pinned
 * by tests/gridley-compat.test.ts without a connection.
 *
 * 1. Player resolution for Gridley's player-valued criteria (teammate / Grand Final opponent),
 *    with the tracked debut-season overrides for ambiguous names.
 * 2. Draft-finding triage (ISSUE-222 §6.3 item 4): for a draft-criterion cell where Gridley and
 *    AFLDB disagree on a linked player, name the cause from AFLDB's OWN linked draft rows --
 *    unlinked / a linked row that satisfies the axis / a non-national pick inside a national
 *    range / linked rows none of which match. The triage is EVIDENCE appended to the finding's
 *    detail; it never changes the finding's category. Reclassification is an operator decision.
 * 3. AFLDB-ISSUE-225 §19 (operator decisions D4-D6): the teammates semantic-contract rule and
 *    the tracked known-answer adjudications (data/players/gridley-known-answer-adjudications.csv),
 *    each classified `adjudicated key disagreement`; the evidence re-derivation that makes a
 *    record STALE; and the criterion-pair guard read from Gridley's own answer key.
 */
import { resolveDraftKind, type GridAxisState } from '@/search/grid-solver-spec';
import { normalisePlayerName, type GridleyPlayerRef } from '@/search/gridley-compat';
import { KNOWN_ANSWER_EVIDENCE_KIND, type GridleyKnownAnswerAdjudication } from './gridley-known-answer-adjudications';

export type PlayerRow = {
  id: number; displayName: string; givenName: string | null; surname: string | null;
  debutSeason: number | null; finalSeason: number | null;
};

/**
 * Ambiguous Gridley names settled by the debut season recorded here, each one checked against
 * Gridley's own answer key for that player's teammate cells (ISSUE-118 §Stage 2).
 */
export const PLAYER_OVERRIDES: Record<string, { name: string; debutSeason: number }> = {
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
  // West Coast one 3. Sydney's Sam Reid (2010): 109 of 135 against Sydney.
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
  // 2026 debutants: present only on a database whose PLAYER REGISTER holds a 2026 debut.
  // A database can carry 2026 matches (max(season) = 2026) while its players still end at the
  // accepted 2025 baseline (AFLDB-ISSUE-224: a post-baseline debutant has no afltables
  // registration yet); the resolver reports that as a gap of the register, not as a bad override.
  'willem-duursma-teammate-13491': { name: 'Willem Duursma', debutSeason: 2026 },
  'jagga-smith-teammate-13333': { name: 'Jagga Smith', debutSeason: 2026 },
};

/** The latest debut season any player on this database holds: the register's horizon. */
export function playerRegisterHorizon(players: readonly PlayerRow[]): number {
  let max = 0;
  for (const p of players) if (p.debutSeason !== null && p.debutSeason > max) max = p.debutSeason;
  return max;
}

/**
 * Resolves a Gridley player reference to an AFLDB player id by normalised full name; ambiguous
 * names are settled by the override's debut season.
 *
 * A missing override target is a GAP (`gapLog`, later a probed `dataset gap`) only when the
 * database provably cannot hold the player: the debut season lies beyond the match horizon
 * (`maxSeason`) or beyond the player register's horizon (no player at all debuted that late)
 * AND no player of that name exists. A namesake with another debut, or a register that does
 * reach the season, is an unresolved reference (`unresolvedLog`) and fails the suite.
 */
export function buildResolver(
  players: readonly PlayerRow[], unresolvedLog: string[], gapLog: string[], maxSeason: number,
  overrides: Record<string, { name: string; debutSeason: number }> = PLAYER_OVERRIDES,
): (ref: GridleyPlayerRef) => number | null {
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
  const registerHorizon = playerRegisterHorizon(players);
  return (ref) => {
    const override = overrides[ref.criterionId];
    if (override) {
      const key = normalisePlayerName(override.name);
      const namesakes = byName.get(key) ?? [];
      const hit = namesakes.filter((p) => p.debutSeason === override.debutSeason);
      if (hit.length === 1) return hit[0].id;
      if (hit.length === 0 && override.debutSeason > maxSeason) {
        gapLog.push(`${ref.criterionId}: ${override.name} debuted in ${override.debutSeason}; this database ends at season ${maxSeason}`);
        return null;
      }
      if (hit.length === 0 && namesakes.length === 0 && override.debutSeason > registerHorizon) {
        gapLog.push(`${ref.criterionId}: ${override.name} debuted in ${override.debutSeason}; no player on this database debuted after season ${registerHorizon} (the player register ends at the accepted baseline; a post-baseline debutant is unregistered -- AFLDB-ISSUE-224)`);
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

export type CoachRow = { id: number; displayName: string };

/**
 * Coach resolution: by normalised full name against coaches.display_name (the AFL
 * Tables coach-page person). Exactly one hit resolves; the eight Gridley coaches are
 * unique names on the index. On a database with no coaches loaded every coach
 * criterion is a dataset gap, never a guess.
 */
export function buildCoachResolver(coaches: readonly CoachRow[], unresolvedLog: string[], gapLog: string[]): (ref: { criterionId: string; name: string }) => number | null {
  const byName = new Map<string, CoachRow[]>();
  for (const c of coaches) {
    const k = normalisePlayerName(c.displayName);
    byName.set(k, [...(byName.get(k) ?? []), c]);
  }
  return (ref) => {
    if (coaches.length === 0) {
      gapLog.push(`${ref.criterionId}: this database holds no coaches`);
      return null;
    }
    const candidates = byName.get(normalisePlayerName(ref.name)) ?? [];
    if (candidates.length === 1) return candidates[0].id;
    unresolvedLog.push(`${ref.criterionId}: coach "${ref.name}" matched ${candidates.length} coaches`);
    return null;
  };
}

/**
 * The corpus suite's two builder-shaped `list membership` arms (ISSUE-118), shared so the
 * AFLDB-ISSUE-225 acceptance probe classifies them identically:
 *   - LIST_MEMBERSHIP_LACKING_BUILDER: Gridley lists, and every axis lacking the player is one of
 *     these (Gridley counts list membership; AFLDB counts games played);
 *   - CLUB_COUNT_BUILDER: a club-count criterion, either direction (Gridley's text counts a
 *     trade-period move to a club the player never played for).
 */
export const LIST_MEMBERSHIP_LACKING_BUILDER = /^(played_(for_club|in_decade)|teammate_of|wooden_spoon_season|minor_premiership_season|coached_by)$/;
export const CLUB_COUNT_BUILDER = /^(one_club_player|multi_club_player|clubs_played_min)/;

// ---------------------------------------------------------------------------
// Draft-finding triage (AFLDB-ISSUE-222 §6.3 item 4)
// ---------------------------------------------------------------------------

/** One trusted-linked draft_picks row of a player (link_status_value unique/resolved). */
export type LinkedDraftRow = { draftYear: number; draftKind: string | null; pickNumber: number | null; club: string | null };

export type DraftTriageCause =
  /** the player has no trusted-linked draft row at all: a linkage gap (bridge / ISSUE-224 registration), never Gridley's key */
  | 'unlinked'
  /** a linked row satisfies the axis: AFLDB should list the player -- a builder or classification defect if it does not */
  | 'satisfied'
  /** national_draft_pick_between: a linked NON-national row's pick is inside the range (Gridley counts it as a national pick; AFLDB's source records another event kind) */
  | 'non_national_pick_in_range'
  /** linked rows exist and none satisfies the axis: the linked source carries no such event for this person (source coverage, or Gridley's key) */
  | 'no_linked_row_matches'
  /** a builder this triage does not read */
  | 'unassessed';

export function describeDraftRows(rows: readonly LinkedDraftRow[]): string {
  if (rows.length === 0) return 'no trusted-linked draft row';
  return [...rows]
    .sort((a, b) => a.draftYear - b.draftYear || (a.pickNumber ?? 0) - (b.pickNumber ?? 0))
    .map((r) => `${r.draftYear} ${r.draftKind ?? 'kind?'}${r.pickNumber !== null ? ` pick ${r.pickNumber}` : ''}${r.club ? ` (${r.club})` : ''}`)
    .join('; ');
}

function range(axis: GridAxisState): [number, number] {
  const lo = Number(axis.params.from);
  const hi = Number(axis.params.to);
  return lo <= hi ? [lo, hi] : [hi, lo];
}

/**
 * Names the cause of a draft-criterion disagreement from the player's linked rows. Pure: the
 * caller supplies the rows (the suite reads them once from draft_picks, trusted links only).
 */
export function triageDraftFinding(rows: readonly LinkedDraftRow[], axis: GridAxisState): { cause: DraftTriageCause; evidence: string } {
  const listed = `linked draft rows: ${describeDraftRows(rows)}`;
  if (rows.length === 0) return { cause: 'unlinked', evidence: listed };
  switch (axis.builder) {
    case 'national_draft_pick_between': {
      const [lo, hi] = range(axis);
      const inRange = rows.filter((r) => r.pickNumber !== null && r.pickNumber >= lo && r.pickNumber <= hi);
      if (inRange.some((r) => r.draftKind === 'national')) return { cause: 'satisfied', evidence: `a linked national pick ${lo}-${hi} exists; ${listed}` };
      if (inRange.length > 0) {
        return { cause: 'non_national_pick_in_range', evidence: `no linked national pick ${lo}-${hi}, but ${describeDraftRows(inRange)} is inside the range under another event kind; ${listed}` };
      }
      return { cause: 'no_linked_row_matches', evidence: `no linked pick ${lo}-${hi} of any kind; ${listed}` };
    }
    case 'draft_pick_between': {
      const [lo, hi] = range(axis);
      const ok = rows.some((r) => r.pickNumber !== null && r.pickNumber >= lo && r.pickNumber <= hi);
      return ok ? { cause: 'satisfied', evidence: `a linked pick ${lo}-${hi} exists; ${listed}` }
        : { cause: 'no_linked_row_matches', evidence: `no linked pick ${lo}-${hi}; ${listed}` };
    }
    case 'draft_type_is': {
      const kind = resolveDraftKind(axis.params.draftType ?? '');
      const ok = kind !== null && rows.some((r) => r.draftKind === kind);
      return ok ? { cause: 'satisfied', evidence: `a linked ${kind} row exists; ${listed}` }
        : { cause: 'no_linked_row_matches', evidence: `the linked source carries no ${kind ?? axis.params.draftType} event for this person; ${listed}` };
    }
    case 'traded_min_times': {
      const n = Number(axis.params.times);
      const trades = rows.filter((r) => r.draftKind === 'trade').length;
      return trades >= n ? { cause: 'satisfied', evidence: `${trades} linked trade row(s); ${listed}` }
        : { cause: 'no_linked_row_matches', evidence: `${trades} linked trade row(s), ${n} required; ${listed}` };
    }
    default:
      return { cause: 'unassessed', evidence: listed };
  }
}

/**
 * AFLDB-ISSUE-222 §11.19.12, operator decision D1 (2026-09-19, approved narrowly). A
 * `national_draft_pick_between` cell where Gridley lists a linked player AFLDB omits, and the
 * player's ONLY trusted-linked pick inside the range is a non-national event (Brad Crouch's 2011
 * Mini-Draft pick 2 against Gridley's "top 10 pick in the National Draft"), is Gridley's own key
 * counting another event kind as a National Draft selection. Returns the evidence sentence for
 * an `external source disagreement` finding, or null when the rule does not apply: any other
 * builder, a satisfied range (a real national pick: AFLDB must list him), no pick in range at all
 * (nothing evidences Gridley's answer), or an unlinked player (a linkage matter). The national
 * semantics of the builder are untouched and no player is named.
 */
export function nationalPickKeyDisagreement(rows: readonly LinkedDraftRow[], axis: GridAxisState): string | null {
  if (axis.builder !== 'national_draft_pick_between') return null;
  const t = triageDraftFinding(rows, axis);
  if (t.cause !== 'non_national_pick_in_range') return null;
  const [lo, hi] = range(axis);
  return `Gridley's key counts a non-national selection as a National Draft pick ${lo}-${hi} (AFLDB-ISSUE-222 §11.19.12 D1): ${t.evidence}`;
}

/** The one field of tests/rookie-relisting-outcomes.ts this pure function reads. */
export type RookieRelistingVerdict = { verdict: string; eventYear: number; eventClub: string; pick: number; evidence: string; reference: string };

/**
 * AFLDB-ISSUE-222 §11.19.12/§11.19.13, operator decision D2. A `draft_type_is(rookie)`
 * cell where Gridley lists a linked player AFLDB omits, the player's linked DraftGuru
 * rows carry no Rookie event (triage `no_linked_row_matches`), AND that exact player has
 * a reviewed, independently-sourced `gridley_supported` outcome recorded in the tracked
 * artefact (never a name or id hard-coded here). Returns the evidence sentence for a
 * `source coverage gap` finding, or null for every other case: any other builder or draft
 * kind, a player with no recorded outcome, an outcome that is not `gridley_supported`
 * (`draftguru_supported` / `undetermined` record review history, not a reclassification),
 * a satisfied or non-national-pick-in-range cause (not this rule's shape), or an unlinked
 * player (`unlinked` is a linkage matter, never a source gap). There is no rule here that
 * fires from `no_linked_row_matches` alone -- only from a specific reviewed outcome.
 */
export function rookieSourceCoverageGap(
  rows: readonly LinkedDraftRow[], axis: GridAxisState, outcome: RookieRelistingVerdict | undefined,
): string | null {
  if (!outcome || outcome.verdict !== 'gridley_supported') return null;
  if (axis.builder !== 'draft_type_is') return null;
  if (resolveDraftKind(axis.params.draftType ?? '') !== 'rookie') return null;
  const t = triageDraftFinding(rows, axis);
  if (t.cause !== 'no_linked_row_matches') return null;
  return `an independent source confirms a Rookie Draft selection DraftGuru's linked page omits (${outcome.reference}): pick ${outcome.pick} (${outcome.eventClub}, ${outcome.eventYear}); ${outcome.evidence}`;
}

// ---------------------------------------------------------------------------
// Gridley compatibility adjudication (AFLDB-ISSUE-225 §19, operator decisions D4-D6)
// ---------------------------------------------------------------------------

/**
 * The first season Gridley's teammates criteria count LIST co-membership. Its own text: "Includes
 * teammates they didn't play in a game with. For seasons 2000 and prior, both players must have
 * played in at least 1 game in the same season."
 */
export const TEAMMATE_LIST_ERA_FIRST_SEASON = 2001;

/**
 * AFLDB-ISSUE-225 §19.1, operator decision D5: the teammates semantic contract. Gridley counts a
 * teammate any player on the same club LIST in a season after 2000; AFLDB's career_teammates_min
 * counts players who PLAYED for the same club in the same season (migration 096: AFLDB holds no
 * historical lists). List teammates are a superset of played teammates, so the difference can
 * only run one way. Returns the evidence sentence for an `adjudicated key disagreement`, or null
 * unless every guard holds:
 *   - Gridley lists the player and AFLDB omits him (never the reverse);
 *   - the only axis lacking him is career_teammates_min (a mixed lacking set stays open);
 *   - his career reaches the list era (final season 2001 or later).
 * No player is named and no id is read; the played-teammate count is evidence, not a guard.
 */
export function teammateListMembership(input: {
  inGridley: boolean; inAfldb: boolean; lackingBuilders: readonly string[];
  finalSeason: number | null; threshold: number; playedTeammates: number;
}): string | null {
  if (!input.inGridley || input.inAfldb) return null;
  if (input.lackingBuilders.length !== 1 || input.lackingBuilders[0] !== 'career_teammates_min') return null;
  if (input.finalSeason === null || input.finalSeason < TEAMMATE_LIST_ERA_FIRST_SEASON) return null;
  return `semantic contract (AFLDB-ISSUE-225 §19.1 D5): Gridley's teammate count includes list co-members after 2000; `
    + `AFLDB's career_teammates_min counts players who played for the same club in the same season and computes `
    + `${input.playedTeammates} played teammates against the threshold ${input.threshold} (final season ${input.finalSeason})`;
}

/** The AFLDB facts a known-answer adjudication can be decided on, read by the corpus suite for one player. */
export type KnownAnswerFacts = {
  /** Games per merged organization (the `_incl_merged` builders' fold), by club_organizations.slug. */
  organizationGames: readonly { slug: string; games: number }[];
  /** Every trusted (unique/resolved) captaincies row, by clubs.name. */
  trustedCaptaincies: readonly { club: string; season: number }[];
};

/** Derives the `afldb_evidence` string of one evidence kind from the database facts: `<kind>:<token>;...`, tokens sorted. */
export function knownAnswerEvidence(kind: 'organization_games' | 'trusted_captaincies', facts: KnownAnswerFacts): string {
  const tokens = kind === 'organization_games'
    ? facts.organizationGames.map((r) => `${r.slug}=${r.games}`)
    : facts.trustedCaptaincies.map((r) => `${r.club}=${r.season}`);
  return `${kind}:${[...tokens].sort().join(';')}`;
}

/**
 * Why a tracked known-answer adjudication does NOT apply to the player as the database now holds
 * him, or null when it applies: the AFLDB fact it was decided on must be exactly what the database
 * holds now. A changed game count, an added or missing captaincy row -- anything -- is STALE.
 */
export function knownAnswerEvidenceStaleness(
  adj: Pick<GridleyKnownAnswerAdjudication, 'gridleyCriterion' | 'afldbEvidence'>, facts: KnownAnswerFacts,
): string | null {
  const kind = KNOWN_ANSWER_EVIDENCE_KIND[adj.gridleyCriterion];
  if (!kind) return `no evidence kind is declared for ${adj.gridleyCriterion}`;
  const now = knownAnswerEvidence(kind, facts);
  return now === adj.afldbEvidence ? null : `AFLDB now holds ${now}, adjudicated on ${adj.afldbEvidence}`;
}

/**
 * Gridley player id + criterion id -> every cell (`board:row-col`) whose answer key LISTS that
 * player under that criterion, paired with anything. Read from Gridley's own frozen key only, for
 * the given (bridged) players.
 */
export function buildCriterionListingIndex(
  boards: readonly { board: number; rows: readonly { id: string }[]; cols: readonly { id: string }[] }[],
  answers: Record<string, number[][][]>,
  gids: ReadonlySet<number>,
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const b of boards) {
    const key = answers[String(b.board)];
    if (!key) continue;
    b.rows.forEach((row, r) => b.cols.forEach((col, c) => {
      for (const gid of key[r]?.[c] ?? []) {
        if (!gids.has(gid)) continue;
        for (const criterion of new Set([row.id, col.id])) {
          const k = `${gid}|${criterion}`;
          const set = index.get(k) ?? new Set<string>();
          set.add(`${b.board}:${r}-${c}`);
          index.set(k, set);
        }
      }
    }));
  }
  return index;
}

/**
 * AFLDB-ISSUE-225 D10: Gridley's own key independently lists this player under `criterion` in some
 * cell other than this one (`board`, `cell` = `row-col`).
 */
export function criterionListedElsewhere(
  index: ReadonlyMap<string, ReadonlySet<string>>, gid: number, criterion: string, board: number, cell: string,
): boolean {
  const cells = index.get(`${gid}|${criterion}`);
  return cells !== undefined && [...cells].some((x) => x !== `${board}:${cell}`);
}

export type KnownAnswerRecord = Pick<GridleyKnownAnswerAdjudication,
  'gridleyCriterion' | 'direction' | 'verdict' | 'afldbEvidence' | 'independentEvidence' | 'decidedOn' | 'reference'> & {
  /** knownAnswerEvidenceStaleness against this database, computed once by the suite. */
  stale: string | null;
};

/**
 * AFLDB-ISSUE-225 §19.2, operator decisions D4/D6. Classifies one known-answer disagreement of one
 * bridged player against that player's tracked adjudication records. A record applies only when:
 *   - its direction is this cell's (`gridley_lists`: Gridley lists, AFLDB omits; `gridley_omits`:
 *     the reverse) and its criterion is one of the cell's two axes;
 *   - for `gridley_lists`, that criterion is the ONLY axis lacking the player (a second lacking
 *     axis is a separate disagreement the record does not explain);
 *   - for `gridley_key_inconsistent` (operator decision D10, 2026-10-01; one record, Cameron
 *     Bruce's): AFLDB lists the player on BOTH axes (so it proves the record's criterion and the
 *     other criterion X), and Gridley's own frozen key independently lists the player under that
 *     exact X somewhere else in the corpus (`gridleyListsElsewhere`). The key therefore accepts him
 *     for X, so its omission of this cell can only be about the record's criterion. An X the key
 *     never accepts for him stays a genuine disagreement. (This replaces the narrower §19.2
 *     same-pair guard, which admitted 26 of the 37 cells this shape covers.)
 * A record that applies but whose AFLDB evidence no longer matches the database is reported STALE
 * (the cell stays `incorrect known answer`). Null means no record applies: the cell is untouched.
 * A player with no record can never be adjudicated; there is no rule here keyed on a criterion alone.
 */
export function knownAnswerAdjudication(input: {
  records: readonly KnownAnswerRecord[];
  axisCriteria: readonly string[];
  lackingCriteria: readonly string[];
  inGridley: boolean; inAfldb: boolean;
  /** Whether Gridley's frozen key lists this player under `criterion` in another cell of the corpus. */
  gridleyListsElsewhere: (criterion: string) => boolean;
}): { outcome: 'adjudicated' | 'stale'; detail: string } | null {
  if (input.inGridley === input.inAfldb) return null;
  const direction = input.inGridley ? 'gridley_lists' : 'gridley_omits';
  for (const rec of input.records) {
    if (rec.direction !== direction || !input.axisCriteria.includes(rec.gridleyCriterion)) continue;
    if (direction === 'gridley_lists' && !(input.lackingCriteria.length === 1 && input.lackingCriteria[0] === rec.gridleyCriterion)) continue;
    let guard = '';
    if (rec.verdict === 'gridley_key_inconsistent') {
      const others = input.axisCriteria.filter((c) => c !== rec.gridleyCriterion);
      if (!input.inAfldb || others.length !== 1 || !input.gridleyListsElsewhere(others[0])) continue;
      guard = ` [D10 guard: AFLDB satisfies ${others[0]}, and Gridley's key lists him under ${others[0]} elsewhere in the corpus]`;
    }
    if (rec.stale !== null) {
      return { outcome: 'stale', detail: `adjudication of ${rec.gridleyCriterion} (${rec.decidedOn}, ${rec.reference}) is STALE: ${rec.stale}` };
    }
    return {
      outcome: 'adjudicated',
      detail: `${rec.verdict} on ${rec.gridleyCriterion} (${rec.decidedOn}, ${rec.reference})${guard}: AFLDB ${rec.afldbEvidence}; independent: ${rec.independentEvidence}`,
    };
  }
  return null;
}
