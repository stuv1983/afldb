/**
 * AFLDB-ISSUE-155 Phase C1 — the pure rules of Brownlow vote administration.
 *
 * Everything here is a decision that can be made without a database: is
 * this selection legal, is this transition legal, has the canonical
 * picture moved under us, and what season rows does a set of match facts
 * imply. `src/db/queries/admin-brownlow.ts` owns the transactions; this
 * file owns the reasoning they apply, so the rules are unit-testable
 * without a connection and cannot drift between the four transactions.
 *
 * No `server-only`, no `@/db` import, no I/O. `node:crypto` is the one
 * dependency and is used for a digest, not for secrecy.
 *
 * THE CENTRAL FACT ABOUT THE DATA (preflight P1, §27.20).
 * `brownlow_round_votes` is a DENSE participation record, not a sparse
 * poll record: 320,861 rows across 1984-2025, of which 298,622 carry a
 * published zero — about 40 per match, against 6 votes. A zero row means
 * "this player played this round and polled nothing", which is a source
 * fact in its own right and has `played = true`. Every rule below is
 * written so that no such row is ever destroyed: a match is finalised by
 * CLAIMING its rows and DEMOTING the non-selected to zero, never by
 * deleting them, and a void withdraws the vote value (`votes = NULL`,
 * the shape migration 005's own CHECK provides for) rather than
 * asserting the false fact that everybody polled zero.
 *
 * Equally, nothing here manufactures density that an era does not have.
 * The settle only ever proposes a row where the source published a vote
 * (`canonical-apply.ts::writeBrownlowRoundVotes`), so a current-season or
 * pre-1984 match may legitimately end up carrying only three rows. That
 * is not incompleteness, and inventing forty zero rows to make it look
 * dense would be fabricating history the coverage authority says was
 * never collected.
 */
import { createHash } from 'node:crypto';

import { MANUAL_ATTENDANCE_SOURCE_KEY } from '@/lib/acquisition/manual-authority';

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

/**
 * A complete line-up is at least this many rows for EACH club (§27.6).
 *
 * Preflight P8 measured all 16,327 home-and-away matches from 1897 to
 * 2026: the smallest side observed is 17, and every one of the seven
 * matches under 18 is a 2026 current-season import whose opponent has
 * 19-22 rows (P8b) — an unfinished import, not a legitimate short side.
 * The threshold therefore stays at 18 and those seven refuse
 * finalisation until the line-up is repaired. Lowering it to 17 to make
 * them pass would let an unfinished import be finalised as though it
 * were a complete match.
 */
export const MIN_CLUB_LINEUP_ROWS = 18;

/** `brownlow_vote_entry_state.last_reason` is `length <= 500` (migration 094). */
export const REASON_MAX_LENGTH = 500;
/** Short enough to type, long enough to mean something (§27.7). */
export const REASON_MIN_LENGTH = 3;

/**
 * The provenance key a manual Brownlow decision writes.
 *
 * Imported rather than repeated: this is the same `sources` key the
 * acquisition subsystem already treats as "a human decided this", and
 * the settle's foreign-ownership refusal keys off it. The constant's
 * name is historical (attendance was the first manual field); the value
 * is the general one. `tests/brownlow-entry.test.ts` pins the equality
 * so a rename cannot quietly split them.
 */
export const BROWNLOW_MANUAL_SOURCE_KEY = MANUAL_ATTENDANCE_SOURCE_KEY;

/** `source_record_id` for a canonical round row written by a finalisation. */
export function entrySourceRecordId(matchId: number, revision: number): string {
  return `entry:${matchId}:r${revision}`;
}

/** `source_record_id` for a season row written by a publication. */
export function publishSourceRecordId(season: number, revision: number): string {
  return `publish:${season}:r${revision}`;
}

/* ------------------------------------------------------------------ *
 * Refusals
 * ------------------------------------------------------------------ */

/**
 * Every way a Brownlow mutation can decline. These are business
 * outcomes, not exceptions: the transactions return them, never throw
 * them, so a refusal leaves the transaction free to roll back cleanly
 * and the Server Action free to re-render the form with what the user
 * typed still in it.
 */
export type BrownlowRefusalCode =
  | 'not_found'
  | 'not_home_and_away'
  | 'season_not_polled'
  | 'not_participant'
  | 'duplicate_player'
  | 'incomplete'
  | 'participants_incomplete'
  | 'already_final'
  | 'not_final'
  | 'stale'
  | 'invalid'
  | 'season_incomplete'
  | 'forbidden'
  | 'db_error';

export type BrownlowRefusal = {
  ok: false;
  code: BrownlowRefusalCode;
  message: string;
};

export type BrownlowOutcome<T> = { ok: true; value: T } | BrownlowRefusal;

/**
 * The sentence a user sees. Written to say what happened and what to do
 * next, because these surface in an admin form where the reader is
 * mid-task and has no access to the code.
 */
const REFUSAL_MESSAGES: Record<BrownlowRefusalCode, string> = {
  not_found:
    'That match no longer exists.',
  not_home_and_away:
    'Brownlow votes are polled in home-and-away matches only; finals carry no votes.',
  season_not_polled:
    'No Brownlow Medal was awarded for that season, so it has no votes to record.',
  not_participant:
    'Every selected player must have a line-up row in this match.',
  duplicate_player:
    'The 3, 2 and 1 votes must go to three different players.',
  incomplete:
    'Finalising a match needs all three of the 3, 2 and 1 votes.',
  participants_incomplete:
    'This match does not have a complete line-up yet, so its votes cannot be '
    + 'finalised. Repair the line-up on the match sheet first.',
  already_final:
    'This match has already been decided. Use Correct to change it.',
  not_final:
    'This match has not been finalised, so there is nothing to correct.',
  stale:
    'Someone else changed this match while you were editing it. '
    + 'Reload to see the current state, then try again.',
  invalid:
    'That submission is not valid.',
  season_incomplete:
    'A season can only be published once every home-and-away match has been '
    + 'finalised or voided and no vote row is left unattached to a match.',
  forbidden:
    'You do not have permission to do that.',
  db_error:
    'The change could not be saved and nothing was written. Please try again.',
};

/**
 * Build a refusal, optionally appending a sentence of specifics.
 *
 * The detail carries counts and names the operator needs ("Carlton has
 * 14 of 18"); the base message carries the rule. Keeping them separate
 * means the base sentences stay assertable in tests while the details
 * stay free to be as concrete as the caller can make them.
 */
export function brownlowRefusal(
  code: BrownlowRefusalCode,
  detail?: string,
): BrownlowRefusal {
  const base = REFUSAL_MESSAGES[code];
  return { ok: false, code, message: detail ? `${base} ${detail}` : base };
}

/** The base sentence for a code, without any detail. Exposed for tests and the UI. */
export function brownlowRefusalMessage(code: BrownlowRefusalCode): string {
  return REFUSAL_MESSAGES[code];
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

/** A vote allocation. `null` means "not chosen yet", which only a draft may hold. */
export type BrownlowSelection = {
  three: number | null;
  two: number | null;
  one: number | null;
};

/** A selection that has survived `validateSelection` with `requireComplete`. */
export type CompleteBrownlowSelection = { three: number; two: number; one: number };

export const EMPTY_SELECTION: BrownlowSelection = { three: null, two: null, one: null };

function isPlayerId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Is this allocation legal against this match's line-up?
 *
 * Checked in the order §27.17 states: shape, then membership, then
 * distinctness, then completeness. The order is deliberate and pinned by
 * a test — a submission that is both a non-participant and a duplicate
 * should name the non-participant, because that is the error the
 * operator can actually see on screen.
 *
 * Drafts are validated too. A draft that holds a player who was never in
 * the match would become a finalisation the moment somebody pressed the
 * button, and the participant set is re-read under the match lock at
 * that point anyway (§27.6), so catching it early costs nothing and
 * spares the operator a refusal at the last step.
 */
export function validateSelection(
  selection: BrownlowSelection,
  participantIds: Iterable<number>,
  options: { requireComplete: boolean },
): BrownlowOutcome<BrownlowSelection> {
  const slots: ReadonlyArray<readonly [keyof BrownlowSelection, number | null]> = [
    ['three', selection.three],
    ['two', selection.two],
    ['one', selection.one],
  ];

  for (const [slot, value] of slots) {
    if (value !== null && !isPlayerId(value)) {
      return brownlowRefusal('invalid', `The ${slot}-vote selection is not a player.`);
    }
  }

  const participants = participantIds instanceof Set
    ? participantIds as Set<number>
    : new Set(participantIds);

  for (const [slot, value] of slots) {
    if (value !== null && !participants.has(value)) {
      return brownlowRefusal(
        'not_participant',
        `The ${slot}-vote player did not play in this match.`,
      );
    }
  }

  const chosen = slots.map(([, value]) => value).filter((v): v is number => v !== null);
  if (new Set(chosen).size !== chosen.length) {
    return brownlowRefusal('duplicate_player');
  }

  if (options.requireComplete && chosen.length !== 3) {
    return brownlowRefusal('incomplete');
  }

  return { ok: true, value: { three: selection.three, two: selection.two, one: selection.one } };
}

/** Narrow a validated selection to a complete one. Throws only on a caller bug. */
export function asCompleteSelection(selection: BrownlowSelection): CompleteBrownlowSelection {
  if (selection.three === null || selection.two === null || selection.one === null) {
    throw new Error('asCompleteSelection called on an incomplete selection');
  }
  return { three: selection.three, two: selection.two, one: selection.one };
}

/** The vote value a selection awards a player, or 0 for a non-selected participant. */
export function votesForPlayer(
  selection: CompleteBrownlowSelection,
  playerId: number,
): 0 | 1 | 2 | 3 {
  if (playerId === selection.three) return 3;
  if (playerId === selection.two) return 2;
  if (playerId === selection.one) return 1;
  return 0;
}

/* ------------------------------------------------------------------ *
 * Participants
 * ------------------------------------------------------------------ */

/** One line-up row, as §27.6 defines it: `player_match_stats`, nothing else. */
export type MatchParticipant = {
  playerId: number;
  clubId: number;
};

export type ParticipantAssessment = {
  complete: boolean;
  homeCount: number;
  awayCount: number;
  /** Line-up rows belonging to neither club of the match. Always 0 on measured data (P8). */
  foreignCount: number;
  threshold: number;
  /** A sentence naming what is short, for the refusal detail and the UI block. */
  shortfall: string | null;
};

/**
 * Is the line-up complete enough to finalise votes against?
 *
 * §27.6 defines completeness as at least 18 rows for each of the two
 * clubs. `foreignCount` is measured as well and blocks completeness:
 * preflight P8 found zero such rows across 16,327 matches, so this
 * refuses nothing that exists today, but a line-up carrying a row for a
 * third club is not a participant set anybody should be allowed to award
 * three votes from. This is one check stricter than §27.6's wording, and
 * deliberately so.
 */
export function assessParticipants(
  participants: readonly MatchParticipant[],
  homeClubId: number,
  awayClubId: number,
): ParticipantAssessment {
  let homeCount = 0;
  let awayCount = 0;
  let foreignCount = 0;
  for (const participant of participants) {
    if (participant.clubId === homeClubId) homeCount += 1;
    else if (participant.clubId === awayClubId) awayCount += 1;
    else foreignCount += 1;
  }

  const short: string[] = [];
  if (homeCount < MIN_CLUB_LINEUP_ROWS) {
    short.push(`the home line-up has ${homeCount} of ${MIN_CLUB_LINEUP_ROWS}`);
  }
  if (awayCount < MIN_CLUB_LINEUP_ROWS) {
    short.push(`the away line-up has ${awayCount} of ${MIN_CLUB_LINEUP_ROWS}`);
  }
  if (foreignCount > 0) {
    short.push(`${foreignCount} line-up row(s) belong to neither club`);
  }

  return {
    complete: short.length === 0,
    homeCount,
    awayCount,
    foreignCount,
    threshold: MIN_CLUB_LINEUP_ROWS,
    shortfall: short.length === 0 ? null : `Currently ${short.join(', ')}.`,
  };
}

/* ------------------------------------------------------------------ *
 * State machine
 * ------------------------------------------------------------------ */

export type BrownlowEntryStatus = 'draft' | 'final' | 'void';

/** `null` = no workflow row yet: never entered, or carrying imported facts only. */
export type BrownlowEntryState = BrownlowEntryStatus | null;

export type BrownlowAction = 'saveDraft' | 'finalise' | 'correct' | 'void';

/** Whether an action must carry a reason, given where it starts from (§27.7). */
export function reasonRequired(from: BrownlowEntryState, action: BrownlowAction): boolean {
  if (action === 'correct' || action === 'void') return true;
  // Bringing a voided match back to a decision reverses a reasoned
  // declaration, so it needs a reason of its own.
  if (action === 'finalise' && from === 'void') return true;
  return false;
}

/**
 * Is this transition legal (§27.7)?
 *
 * The one rule worth stating aloud: **`final -> draft` does not exist**.
 * A finalised match is public; reopening it into a draft would silently
 * withdraw a published fact with no audit of the withdrawal. Correction
 * is the only way to change a final match, and it is a direct, reasoned,
 * fully audited update. The UI's "reopen" is `correct` with the current
 * values preloaded.
 *
 * NOTE (reported to the operator, §27.7 vs §27.17): the §27.7 transition
 * table permits `void -> final` via `finaliseMatch`, while §27.17's
 * sketch of that transaction refuses both `final` and `void` at step 4.
 * §27.7 is the normative state machine and is followed here: a void can
 * be finalised, with a reason. Flipping to the stricter reading is a
 * one-line change to the `finalise` case below.
 */
export function checkTransition(
  from: BrownlowEntryState,
  action: BrownlowAction,
): BrownlowOutcome<{ to: BrownlowEntryStatus }> {
  switch (action) {
    case 'saveDraft':
      if (from === 'final' || from === 'void') {
        return brownlowRefusal('already_final');
      }
      return { ok: true, value: { to: 'draft' } };

    case 'finalise':
      if (from === 'final') return brownlowRefusal('already_final');
      return { ok: true, value: { to: 'final' } };

    case 'correct':
      if (from !== 'final') return brownlowRefusal('not_final');
      return { ok: true, value: { to: 'final' } };

    case 'void':
      if (from === 'void') return brownlowRefusal('already_final');
      return { ok: true, value: { to: 'void' } };

    default: {
      const exhaustive: never = action;
      throw new Error(`unhandled Brownlow action: ${String(exhaustive)}`);
    }
  }
}

/**
 * Trim and bound a correction/void reason.
 *
 * The upper bound matches the `last_reason` CHECK exactly, so a reason
 * that passes here cannot fail at the database and turn a business
 * refusal into a `db_error`.
 */
export function validateReason(
  reason: string | null | undefined,
  options: { required: boolean },
): BrownlowOutcome<string | null> {
  const trimmed = (reason ?? '').trim();
  if (trimmed === '') {
    if (options.required) {
      return brownlowRefusal('invalid', 'A reason is required for this change.');
    }
    return { ok: true, value: null };
  }
  if (trimmed.length < REASON_MIN_LENGTH) {
    return brownlowRefusal(
      'invalid',
      `A reason must be at least ${REASON_MIN_LENGTH} characters.`,
    );
  }
  if (trimmed.length > REASON_MAX_LENGTH) {
    return brownlowRefusal(
      'invalid',
      `A reason must be ${REASON_MAX_LENGTH} characters or fewer; that one is ${trimmed.length}.`,
    );
  }
  return { ok: true, value: trimmed };
}

/* ------------------------------------------------------------------ *
 * Canonical picture: fingerprint and completeness
 * ------------------------------------------------------------------ */

/** One `brownlow_round_votes` row, as the read model and the writer see it. */
export type CanonicalRoundRow = {
  playerId: number;
  /** `null` = played, no vote value recorded — what a void leaves behind. */
  votes: number | null;
  sourceId: number | null;
  matchId: number | null;
};

/**
 * The compare-and-set value that catches the canonical picture moving
 * between page render and submit (§27.14).
 *
 * Over POSITIVE rows only, and over the `(player_id, votes, source_id)`
 * triple. Zeros are excluded because they are the dense background —
 * including 40 unchanging rows per match would make the digest churn on
 * line-up edits that have nothing to do with votes. What this must catch
 * is a settle landing a vote, another Super Admin correcting the match,
 * or an operator repair; all three move a positive row.
 *
 * The caller supplies exactly the row set §27.14 defines: the match's
 * resolved rows PLUS the season/round rows still unattached to any match
 * whose player is a participant of this match. Those unresolved rows are
 * in scope precisely because finalisation is about to claim them.
 */
export function canonicalFingerprint(rows: readonly CanonicalRoundRow[]): string {
  const lines = rows
    .filter((row) => row.votes !== null && row.votes > 0)
    .map((row) => `${row.playerId}:${row.votes}:${row.sourceId ?? ''}`)
    .sort();
  return createHash('sha256').update(`${lines.join('\n')}\n`, 'utf8').digest('hex');
}

/**
 * What the canonical rows say about one match, ignoring workflow state.
 *
 * `complete` is the textbook poll: three distinct players holding
 * exactly 3, 2 and 1. Preflight P6 measured all 7,413 home-and-away
 * matches of 1984-2025 as `complete` on this definition with zero
 * exceptions, which is what lets imported source facts count as
 * complete without any workflow row existing (§27.9 `imported`).
 */
export type MatchAssignment = 'complete' | 'partial' | 'none';

export function classifyMatchAssignment(rows: readonly CanonicalRoundRow[]): MatchAssignment {
  const positive = rows.filter((row) => row.votes !== null && row.votes > 0);
  if (positive.length === 0) return 'none';
  const players = new Set(positive.map((row) => row.playerId));
  const values = new Set(positive.map((row) => row.votes as number));
  const total = positive.reduce((sum, row) => sum + (row.votes as number), 0);
  const complete = positive.length === 3
    && players.size === 3
    && values.size === 3
    && values.has(3) && values.has(2) && values.has(1)
    && total === 6;
  return complete ? 'complete' : 'partial';
}

/**
 * Is this match accounted for, for the purpose of season round coverage?
 *
 * Two ways to be accounted for, and only two (operator decision D1):
 *
 *   1. the canonical facts are a complete 3/2/1 — whether a Super Admin
 *      entered them or the source did. Requiring a workflow row here
 *      would demote all 42 seasons of imported data to `partial` on the
 *      day this ships, which is why imported completeness counts;
 *   2. a Super Admin has explicitly declared the match unpolled
 *      (`void`), with a reason, which is a decision rather than a gap.
 *
 * Everything else — no rows, a partial set, a draft — is unaccounted.
 * This is what stops one hand-entered 1950 match from flipping the whole
 * of 1950 to `complete`, which the migration-016 rule (`any row at all`)
 * would have done.
 */
export function isMatchAccounted(
  assignment: MatchAssignment,
  status: BrownlowEntryState,
): boolean {
  return status === 'void' || assignment === 'complete';
}

/** Season-grain round coverage, rolled up from per-match accounting (D1). */
export type RoundCoverage = 'complete' | 'partial' | 'none';

export function seasonRoundCoverage(counts: {
  expectedMatches: number;
  accountedMatches: number;
}): RoundCoverage {
  const { expectedMatches, accountedMatches } = counts;
  if (expectedMatches <= 0 || accountedMatches <= 0) return 'none';
  if (accountedMatches >= expectedMatches) return 'complete';
  return 'partial';
}

/**
 * Which authority a season's totals currently carry (§27.9).
 *
 * `none` — no `brownlow_season_votes` rows at all. `source` — rows the
 * artefact importer published. `manual` — rows this workflow derived.
 */
export type BrownlowSeasonAuthority = 'none' | 'source' | 'manual';

export type BrownlowSeasonStatus =
  | 'not_polled'
  | 'not_started'
  | 'in_progress'
  | 'entered'
  | 'published'
  | 'published_stale'
  | 'source_published';

/**
 * The one label a season list shows, from the counts and the authority
 * (§27.9). Pure, because the same reasoning has to hold for the season
 * list, the season page and any test, and because getting it wrong is
 * how a half-entered season comes to look finished.
 *
 * `accountedMatches` is the §27.9 `final + void + imported` — matches
 * whose facts are a complete 3/2/1 or which a Super Admin declared
 * unpolled — and `startedMatches` counts every match anyone has touched
 * or the source has partly filled, which is only ever used to separate
 * "nothing here yet" from "part-way through".
 */
export function seasonStatusLabel(input: {
  polled: boolean;
  expectedMatches: number;
  accountedMatches: number;
  startedMatches: number;
  authority: BrownlowSeasonAuthority;
  revision: number | null;
  publishedRevision: number | null;
}): BrownlowSeasonStatus {
  const {
    polled, expectedMatches, accountedMatches, startedMatches,
    authority, revision, publishedRevision,
  } = input;

  if (!polled) return 'not_polled';

  // Published is a statement about the season rows, and it outranks the
  // match counts: a published season whose match set has since moved is
  // `published_stale`, which is a different problem from an unfinished
  // one and needs a different fix (re-publish, not more entry).
  if (authority === 'manual' && publishedRevision !== null) {
    return publishedRevision === revision ? 'published' : 'published_stale';
  }

  const complete = expectedMatches > 0 && accountedMatches >= expectedMatches;
  if (complete) return 'entered';
  if (authority === 'source') return 'source_published';
  return startedMatches > 0 ? 'in_progress' : 'not_started';
}

/* ------------------------------------------------------------------ *
 * Season derivation
 * ------------------------------------------------------------------ */

/** One resolved round fact feeding a season total. Zero and NULL rows are ignored. */
export type SeasonRoundFact = {
  playerId: number;
  votes: number | null;
};

/**
 * One `brownlow_season_votes` row, as publication derives it. Provenance
 * (`source_id`, `source_record_id`) is attached by the transaction, not
 * here; `club_id` is deliberately absent because all 16,120 existing
 * artefact rows carry NULL (P4) and a manual row must be
 * indistinguishable in shape from a source one.
 */
export type DerivedSeasonRow = {
  playerId: number;
  votes: number;
  voteRank: number;
  /** `null` for an ineligible player: there is no rank among the eligible for them. */
  eligibleRank: number | null;
  isIneligible: boolean;
  isWinner: boolean;
  games: number;
  /**
   * NULL-for-zero, which is the artefact's own representation (P13j):
   * across 1984-2025 the stored counts equal the exact count of
   * canonical 3/2/1 match rows wherever they are populated
   * (`*_populated_and_wrong = 0`, aggregates identical), and every row
   * whose derived count is zero carries NULL rather than 0. A manual row
   * that stored 0 would be distinguishable from a source-published one,
   * so it stores NULL too. Read these with `COALESCE(col, 0)`.
   */
  threeVoteGames: number | null;
  twoVoteGames: number | null;
  oneVoteGames: number | null;
  /**
   * Always populated: a season row exists only for a player who polled,
   * so this is never zero and never NULL.
   */
  pollingGames: number;
  /**
   * `'unique'` for every manually published row (P10). `link_status`
   * describes how a SOURCE RECORD was linked to a player; a Super Admin
   * picks the player by primary key, which is the strongest link there
   * is. `resolved` describes a name that had to be disambiguated and
   * never applies to a hand-picked id.
   */
  linkStatusValue: 'unique';
};

/**
 * Competition ranking (1, 2, 2, 4) over a descending list of totals.
 *
 * CONVENTION — measured, not assumed. The artefact importer carries
 * these values through rather than deriving them, so the only way to
 * know the convention was to measure the 98 source-published seasons.
 * Preflight P13 did, over all 16,120 rows, and pinned four bindings this
 * function now reproduces:
 *
 *   - `voteRank` is COMPETITION rank (1, 2, 2, 4), not dense, and is
 *     ranked over ALL polled players including the ineligible: dense
 *     ranking disagreed on 15,590 rows, and re-ranking over the eligible
 *     alone disagreed on 636 (P13 c/d);
 *   - `eligibleRank` is competition rank among the eligible only, with
 *     zero disagreement over 16,117 rows (P13 e);
 *   - an ineligible player carries NULL `eligibleRank` — all three such
 *     rows do, and no eligible row does (P13 a/b);
 *   - `isWinner` means exactly `eligibleRank = 1`, with all 112 winner
 *     rows agreeing in both directions, so tied eligible leaders are all
 *     winners and share the rank (P13 f/g).
 */
function competitionRanks(sortedDescending: readonly number[]): number[] {
  const ranks: number[] = [];
  let currentRank = 0;
  let previous: number | null = null;
  sortedDescending.forEach((value, index) => {
    if (previous === null || value !== previous) {
      currentRank = index + 1;
      previous = value;
    }
    ranks.push(currentRank);
  });
  return ranks;
}

/**
 * Turn a season's resolved round facts into its published season rows
 * (§27.10 item 2).
 *
 * Sparse by construction: a row exists only where `votes > 0`, matching
 * the 16,120 artefact rows exactly (P4 measured zero zero-vote rows).
 * The dense zero rows of the round grain are the match-level
 * participation record and have no season-grain equivalent.
 *
 * `games` is home-and-away games only —
 * `player_season_stats.games - player_season_stats.finals` — which
 * preflight P13(i) proved equals the artefact's own `games` on all
 * 16,120 rows across all 98 seasons, where the all-games reading
 * disagrees on 6,507. A polled player with no `player_season_stats` row is refused
 * rather than defaulted: publishing a season with a fabricated games
 * count would be exactly the kind of quiet wrong answer this workflow
 * exists to prevent.
 */
export function deriveSeasonRows(input: {
  facts: readonly SeasonRoundFact[];
  ineligiblePlayerIds: readonly number[];
  /** `player_id` -> home-and-away games played that season. */
  homeAndAwayGames: ReadonlyMap<number, number>;
}): BrownlowOutcome<DerivedSeasonRow[]> {
  const { facts, ineligiblePlayerIds, homeAndAwayGames } = input;

  type Tally = {
    votes: number;
    three: number;
    two: number;
    one: number;
    polling: number;
  };
  const tallies = new Map<number, Tally>();

  for (const fact of facts) {
    const value = fact.votes;
    if (value === null || value <= 0) continue;
    if (!Number.isInteger(value) || value > 3) {
      return brownlowRefusal(
        'invalid',
        `A round fact for player ${fact.playerId} carries ${value} votes; only 1, 2 or 3 are possible.`,
      );
    }
    const tally = tallies.get(fact.playerId)
      ?? { votes: 0, three: 0, two: 0, one: 0, polling: 0 };
    tally.votes += value;
    tally.polling += 1;
    if (value === 3) tally.three += 1;
    else if (value === 2) tally.two += 1;
    else tally.one += 1;
    tallies.set(fact.playerId, tally);
  }

  const ineligible = new Set(ineligiblePlayerIds);
  for (const playerId of ineligible) {
    if (!tallies.has(playerId)) {
      return brownlowRefusal(
        'invalid',
        `Player ${playerId} is marked ineligible but polled no votes this season.`,
      );
    }
  }

  const missingGames = [...tallies.keys()]
    .filter((playerId) => !homeAndAwayGames.has(playerId))
    .sort((a, b) => a - b);
  if (missingGames.length > 0) {
    return brownlowRefusal(
      'invalid',
      `No season games record for polled player(s) ${missingGames.join(', ')}; `
      + 'the season cannot be published until their playing record is rebuilt.',
    );
  }

  // Deterministic order: votes descending, then player id, so a
  // re-publication of identical inputs produces identical rows.
  const ordered = [...tallies.entries()].sort(
    ([leftId, left], [rightId, right]) =>
      right.votes - left.votes || leftId - rightId,
  );

  const overallRanks = competitionRanks(ordered.map(([, tally]) => tally.votes));
  const eligibleOrdered = ordered.filter(([playerId]) => !ineligible.has(playerId));
  const eligibleRanks = competitionRanks(eligibleOrdered.map(([, tally]) => tally.votes));
  const eligibleRankByPlayer = new Map<number, number>(
    eligibleOrdered.map(([playerId], index) => [playerId, eligibleRanks[index]]),
  );

  const rows = ordered.map(([playerId, tally], index): DerivedSeasonRow => {
    const isIneligible = ineligible.has(playerId);
    const eligibleRank = isIneligible ? null : eligibleRankByPlayer.get(playerId) ?? null;
    return {
      playerId,
      votes: tally.votes,
      voteRank: overallRanks[index],
      eligibleRank,
      isIneligible,
      // A tie at the top produces two winners, which is the historical
      // truth in the seasons the artefact records as tied.
      isWinner: !isIneligible && eligibleRank === 1,
      games: homeAndAwayGames.get(playerId) as number,
      // NULL-for-zero: the artefact's representation, measured by P13j.
      threeVoteGames: tally.three > 0 ? tally.three : null,
      twoVoteGames: tally.two > 0 ? tally.two : null,
      oneVoteGames: tally.one > 0 ? tally.one : null,
      pollingGames: tally.polling,
      linkStatusValue: 'unique',
    };
  });

  return { ok: true, value: rows };
}
