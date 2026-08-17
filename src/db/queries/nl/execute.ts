import 'server-only';

import { answerClubSeason } from '@/db/queries/nl/club-season';
import { answerPlayerCareer } from '@/db/queries/nl/player-career';
import { answerPlayerGame } from '@/db/queries/nl/player-game';
import { answerPlayerSeason } from '@/db/queries/nl/player-season';
import { answerTeamMatch } from '@/db/queries/nl/team-match';
import { NL_LIMITS, type NlQueryPlan } from '@/search/nl/plan';
import type { NlAnswerPayload } from '@/search/nl/answer-types';

/**
 * Dispatches a VALIDATED plan to its grain's compiler. This is the one
 * function a future LLM fallback (see plan.ts's header comment) would
 * call: anything that produces a plan passing validatePlan reaches SQL
 * only through here, and only through one of the grain compilers below,
 * never directly. All five grains now have a compiler.
 */
export async function executePlan(plan: NlQueryPlan): Promise<NlAnswerPayload> {
  const limit = plan.agg.kind === 'top_n' || plan.agg.kind === 'list' ? NL_LIMITS.maxListRows : NL_LIMITS.maxTiedRows;
  const cappedLimit = Math.min(plan.limit, limit);

  switch (plan.grain) {
    case 'player_career':
      return answerPlayerCareer(plan, cappedLimit);
    case 'player_game':
      return answerPlayerGame(plan, cappedLimit);
    case 'player_season':
      return answerPlayerSeason(plan, cappedLimit);
    case 'team_match':
      return answerTeamMatch(plan, cappedLimit);
    case 'club_season':
      return answerClubSeason(plan, cappedLimit);
  }
}
