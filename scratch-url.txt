import { DEFAULT_BOARD_STATE, serializeBoardState, GridBoardState } from './src/search/grid-solver-spec.js';

const state = {
  ...DEFAULT_BOARD_STATE,
  cols: [
    { builder: 'played_for_club', params: { club: '5' } }, // Essendon (assuming id 5, will need to check)
    { builder: 'single_game_stat_min', params: { stat: 'disposals', x: '30' } },
    { builder: 'played_in_decade', params: { decade: '2020' } },
  ],
  rows: [
    { builder: 'career_games_max', params: { games: '50' } },
    { builder: 'teammate_of', params: { player: '123' } }, // Archie Roberts id
    { builder: 'award_winner', params: { award: '99' } } // Rising Star id
  ]
};

console.log(serializeBoardState(state));
