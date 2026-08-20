import { describe, expect, it } from 'vitest';

import {
  addPlayerToLineup,
  removePlayerFromLineup,
  replaceClubLineup,
  type LineupEditorState,
  type LineupPlayerIdentity,
} from '@/lib/match-lineup-editor';

type TestPlayer = LineupPlayerIdentity;

function player(
  playerId: number,
  clubId: number,
  editorOrder: number,
): TestPlayer {
  return {
    playerId,
    clubId,
    editorOrder,
    displayName: `Player ${playerId}`,
  };
}

function initialState(): LineupEditorState<TestPlayer> {
  return {
    players: [
      player(1, 10, 0),
      player(2, 10, 1),
      player(3, 20, 0),
      player(4, 20, 1),
    ],
    removedPlayerIds: [],
    vacancies: [],
  };
}

describe('match lineup substitution state', () => {
  it('turns an away-player removal into an away replacement slot', () => {
    const removed = removePlayerFromLineup(initialState(), 3);

    expect(removed.players.map((entry) => entry.playerId)).toEqual([1, 2, 4]);
    expect(removed.removedPlayerIds).toEqual([3]);
    expect(removed.vacancies).toEqual([{
      clubId: 20,
      editorOrder: 0,
      removedPlayerId: 3,
      removedPlayerName: 'Player 3',
    }]);

    const replacement = addPlayerToLineup(removed, player(5, 20, 99), 3);
    expect(replacement.added).toBe(true);
    expect(replacement.state.players.filter((entry) => entry.clubId === 10)).toHaveLength(2);
    expect(replacement.state.players.filter((entry) => entry.clubId === 20)).toHaveLength(2);
    expect(replacement.state.players.find((entry) => entry.playerId === 5)?.editorOrder).toBe(0);
    expect(replacement.state.vacancies).toEqual([]);
  });

  it('supports two consecutive substitutions without changing teams', () => {
    const firstRemoval = removePlayerFromLineup(initialState(), 1);
    const secondRemoval = removePlayerFromLineup(firstRemoval, 2);

    expect(secondRemoval.vacancies).toHaveLength(2);
    expect(secondRemoval.vacancies.every((vacancy) => vacancy.clubId === 10)).toBe(true);

    const firstReplacement = addPlayerToLineup(secondRemoval, player(5, 10, 99), 1);
    const secondReplacement = addPlayerToLineup(firstReplacement.state, player(6, 10, 99), 2);

    expect(secondReplacement.added).toBe(true);
    expect(secondReplacement.state.players.filter((entry) => entry.clubId === 10))
      .toEqual([player(5, 10, 0), player(6, 10, 1)]);
    expect(secondReplacement.state.removedPlayerIds).toEqual([1, 2]);
    expect(secondReplacement.state.vacancies).toEqual([]);
  });

  it('does not consume a replacement slot for a duplicate or wrong-team addition', () => {
    const removed = removePlayerFromLineup(initialState(), 3);

    const duplicate = addPlayerToLineup(removed, player(4, 20, 99), 3);
    expect(duplicate.added).toBe(false);
    expect(duplicate.state).toBe(removed);

    const wrongTeam = addPlayerToLineup(removed, player(5, 10, 99), 3);
    expect(wrongTeam.added).toBe(false);
    expect(wrongTeam.state).toBe(removed);
  });

  it('cancels deletion bookkeeping when the same player is re-added', () => {
    const removed = removePlayerFromLineup(initialState(), 1);
    const restored = addPlayerToLineup(removed, player(1, 10, 99), 1);

    expect(restored.added).toBe(true);
    expect(restored.state.removedPlayerIds).toEqual([]);
    expect(restored.state.vacancies).toEqual([]);
  });

  it('resets only the selected club when the previous lineup is loaded again', () => {
    const removed = removePlayerFromLineup(initialState(), 1);
    const reloaded = replaceClubLineup(removed, 10, [
      player(1, 10, 0),
      player(5, 10, 1),
    ]);

    expect(reloaded.players.filter((entry) => entry.clubId === 10))
      .toEqual([player(1, 10, 0), player(5, 10, 1)]);
    expect(reloaded.players.filter((entry) => entry.clubId === 20))
      .toEqual([player(3, 20, 0), player(4, 20, 1)]);
    expect(reloaded.removedPlayerIds).toEqual([2]);
    expect(reloaded.vacancies).toEqual([]);
  });
});
