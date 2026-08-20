export type LineupPlayerIdentity = {
  playerId: number;
  clubId: number;
  displayName: string;
  editorOrder: number;
};

export type LineupVacancy = {
  clubId: number;
  editorOrder: number;
  removedPlayerId: number;
  removedPlayerName: string;
};

export type LineupEditorState<T extends LineupPlayerIdentity> = {
  players: T[];
  removedPlayerIds: number[];
  vacancies: LineupVacancy[];
};

export function removePlayerFromLineup<T extends LineupPlayerIdentity>(
  state: LineupEditorState<T>,
  playerId: number,
): LineupEditorState<T> {
  const removedPlayer = state.players.find((player) => player.playerId === playerId);
  if (!removedPlayer) return state;

  const alreadyVacant = state.vacancies.some(
    (vacancy) => vacancy.removedPlayerId === removedPlayer.playerId,
  );

  return {
    players: state.players.filter((player) => player.playerId !== playerId),
    removedPlayerIds: Array.from(new Set([...state.removedPlayerIds, playerId])),
    vacancies: alreadyVacant
      ? state.vacancies
      : [
          ...state.vacancies,
          {
            clubId: removedPlayer.clubId,
            editorOrder: removedPlayer.editorOrder,
            removedPlayerId: removedPlayer.playerId,
            removedPlayerName: removedPlayer.displayName,
          },
        ],
  };
}

export function addPlayerToLineup<T extends LineupPlayerIdentity>(
  state: LineupEditorState<T>,
  player: T,
  vacancyRemovedPlayerId?: number,
): { state: LineupEditorState<T>; added: boolean } {
  if (state.players.some((existing) => existing.playerId === player.playerId)) {
    return { state, added: false };
  }

  const vacancyIndex = vacancyRemovedPlayerId === undefined
    ? state.vacancies.findIndex((vacancy) => vacancy.clubId === player.clubId)
    : state.vacancies.findIndex(
        (vacancy) => vacancy.removedPlayerId === vacancyRemovedPlayerId
          && vacancy.clubId === player.clubId,
      );

  if (vacancyRemovedPlayerId !== undefined && vacancyIndex < 0) {
    return { state, added: false };
  }

  const vacancy = vacancyIndex >= 0 ? state.vacancies[vacancyIndex] : null;
  const nextPlayer = vacancy
    ? { ...player, editorOrder: vacancy.editorOrder }
    : player;

  return {
    added: true,
    state: {
      players: [...state.players, nextPlayer],
      removedPlayerIds: state.removedPlayerIds.filter((id) => id !== player.playerId),
      vacancies: vacancyIndex < 0
        ? state.vacancies
        : state.vacancies.filter((_, index) => index !== vacancyIndex),
    },
  };
}

export function replaceClubLineup<T extends LineupPlayerIdentity>(
  state: LineupEditorState<T>,
  clubId: number,
  replacementPlayers: T[],
): LineupEditorState<T> {
  const replacementIds = new Set(replacementPlayers.map((player) => player.playerId));
  const displacedIds = state.players
    .filter((player) => player.clubId === clubId && !replacementIds.has(player.playerId))
    .map((player) => player.playerId);

  return {
    players: [
      ...state.players.filter((player) => player.clubId !== clubId),
      ...replacementPlayers,
    ],
    removedPlayerIds: Array.from(new Set([
      ...state.removedPlayerIds.filter((id) => !replacementIds.has(id)),
      ...displacedIds,
    ])),
    vacancies: state.vacancies.filter((vacancy) => vacancy.clubId !== clubId),
  };
}
