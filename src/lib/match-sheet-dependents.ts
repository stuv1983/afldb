/**
 * AFLDB-ISSUE-353: the facts that hang off a player's line-up row (`player_match_stats`) and
 * must not be left naming a non-participant, and the refusal text for the Match Sheet paths
 * that would remove the row (`saveMatchSheet` remove, `returnMatchSheetToSource`
 * `withdraw_delete_row`) or move it to another club (`saveMatchSheet` club change).
 *
 * Pure: the database reads live in `src/db/queries/match-sheet.ts`. The refusal follows the
 * shape `deleteMatch` already uses for the same families (what is carried, why it blocks, where
 * to resolve it first), and always ends with "Nothing was saved." because the caller throws it
 * inside the save transaction.
 *
 * Deliberately NOT a dependent: a published Brownlow zero. 298,622 of the 320,861 line-up rows
 * the production snapshot holds in 1984-2025 carry one; a zero adds nothing to season or career
 * totals, so refusing it would make the Match Sheet unable to remove anybody from those matches.
 * Only a vote above zero, a Brownlow vote-entry naming the player, and a curated special record
 * block. `player_match_period_stats` is not checked (owner decision, ISSUE-353): the table has no
 * writer and holds no rows.
 */

export type MatchSheetDependentAction = 'remove' | 'club_change' | 'return_to_source';

export type MatchSheetDependents = {
  matchId: number;
  season: number;
  roundCode: string;
  /** `brownlow_round_votes` rows of this match with `votes > 0` (a published zero is not a dependent). */
  brownlowVotes: ReadonlyArray<{ playerId: number; votes: number }>;
  /**
   * AFLDB-ISSUE-353 review A-05: positive `brownlow_round_votes` rows whose `match_id` is NULL (migration 094
   * keeps the column nullable for a row no match was resolved for; the production snapshot holds 621 positive
   * ones, all season 2026) but whose own (season, round, player) key is this match's season and home-and-away
   * round. The row names no match, yet it is the vote the player's line-up row in this round carries, so
   * deleting that row would orphan it exactly as deleting a match-linked vote would. Never attributed to a
   * match by this module (nothing is written); only used to refuse. Optional: absent means none.
   */
  unlinkedBrownlowVotes?: ReadonlyArray<{ playerId: number; votes: number; roundNumber: number }>;
  /** The match's `brownlow_vote_entry_state` row (draft or final), per slot a named player holds. */
  voteEntries: ReadonlyArray<{ playerId: number; status: string; slot: 3 | 2 | 1 }>;
  /** `player_achievements` (first-kick-goal) and `after_siren_kicks` rows naming the player in this match. */
  specialRecords: ReadonlyArray<{
    playerId: number;
    family: 'first-kick-goal' | 'after-the-siren';
    recordId: string | null;
    rowId: number;
    status: string;
  }>;
};

/** True when no player has a dependent. */
function empty(d: MatchSheetDependents): boolean {
  return d.brownlowVotes.length === 0 && (d.unlinkedBrownlowVotes ?? []).length === 0
    && d.voteEntries.length === 0 && d.specialRecords.length === 0;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The refusal for `action`, or `null` when none of the dependents hangs off a player. `names` maps
 * player id to display name (an id with no name is shown as the id alone).
 */
export function matchSheetDependentsRefusal(
  action: MatchSheetDependentAction,
  names: ReadonlyMap<number, string>,
  dependents: MatchSheetDependents,
): string | null {
  if (empty(dependents)) return null;
  const unlinked = dependents.unlinkedBrownlowVotes ?? [];

  const playerIds = [...new Set([
    ...dependents.brownlowVotes.map((v) => v.playerId),
    ...unlinked.map((v) => v.playerId),
    ...dependents.voteEntries.map((e) => e.playerId),
    ...dependents.specialRecords.map((r) => r.playerId),
  ])].sort((a, b) => a - b);

  const who = (id: number) => {
    const name = names.get(id);
    return name ? `${name} (player #${id})` : `player #${id}`;
  };

  const sentences = playerIds.map((id) => {
    const parts: string[] = [];
    for (const v of dependents.brownlowVotes.filter((x) => x.playerId === id)) {
      parts.push(`${v.votes} Brownlow ${plural(v.votes, 'vote', 'votes')} in this match`);
    }
    for (const v of unlinked.filter((x) => x.playerId === id)) {
      parts.push(
        `${v.votes} Brownlow ${plural(v.votes, 'vote', 'votes')} in round ${v.roundNumber} with no match link (unresolved)`,
      );
    }
    for (const e of dependents.voteEntries.filter((x) => x.playerId === id)) {
      parts.push(
        `a Brownlow vote entry (${e.status}) naming them for ${e.slot} ${plural(e.slot, 'vote', 'votes')}`,
      );
    }
    for (const r of dependents.specialRecords.filter((x) => x.playerId === id)) {
      parts.push(
        `${r.family} record ${r.recordId ?? `#${r.rowId}`}${r.status === 'void' ? ' (already suppressed)' : ''}`,
      );
    }
    return `${who(id)} carries ${parts.join(', ')}`;
  });

  const match = `match #${dependents.matchId}`;
  const lead =
    action === 'remove'
      ? `Cannot remove a player from the Match Sheet of ${match}: `
      : action === 'club_change'
        ? `Cannot change a player's club in the Match Sheet of ${match}: `
        : `Cannot return a player to source in ${match}, which would delete their line-up row: `;
  const consequence =
    action === 'club_change'
      ? 'Changing the club would leave that record attributed to a club the player did not play for in this match.'
      : 'Deleting the line-up row would leave that record naming a non-participant.';

  const where: string[] = [];
  if (dependents.brownlowVotes.length > 0 || unlinked.length > 0 || dependents.voteEntries.length > 0) {
    where.push(`Brownlow administration (/admin/brownlow/${dependents.season}/${dependents.roundCode})`);
  }
  const families = [...new Set(dependents.specialRecords.map((r) => r.family))].sort();
  if (families.length > 0) {
    where.push(`Special records (${families.map((f) => `/admin/records/${f}`).join(', ')})`);
  }

  const count = dependents.brownlowVotes.length + unlinked.length
    + dependents.voteEntries.length + dependents.specialRecords.length;
  return `${lead}${sentences.join('; ')}. ${consequence} Nothing was saved. `
    + `Resolve ${count === 1 ? 'it' : 'them'} in ${where.join(' and ')} first.`;
}
