import 'server-only';

import { answerAchievementSummary } from '@/db/queries/nl/achievement-summary';
import { answerClubSeason } from '@/db/queries/nl/club-season';
import { answerHeadToHead } from '@/db/queries/nl/head-to-head';
import { answerPlayerCareer } from '@/db/queries/nl/player-career';
import { answerPlayerGame } from '@/db/queries/nl/player-game';
import { answerPlayerSeason } from '@/db/queries/nl/player-season';
import { answerTeamMatch } from '@/db/queries/nl/team-match';
import { answerTeamStreak } from '@/db/queries/nl/team-streak';
import { NL_LIMITS, type NlQueryPlan } from '@/search/nl/plan';
import type { NlAnswerPayload } from '@/search/nl/answer-types';

/**
 * Dispatches a VALIDATED plan to its grain's compiler. This is the one
 * function a future LLM fallback (see plan.ts's header comment) would
 * call: anything that produces a plan passing validatePlan reaches SQL
 * only through here, and only through one of the grain compilers below,
 * never directly. Every grain has a compiler.
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
    case 'head_to_head':
      return answerHeadToHead(plan);
    case 'team_streak':
      return answerTeamStreak(plan, cappedLimit);
    case 'club_season':
      return answerClubSeason(plan, cappedLimit);
    case 'achievement_summary':
      // Groups, not rows: the limit above caps a player list and has no
      // meaning for a per-club or per-decade count, which is bounded by
      // how many clubs and decades exist.
      return answerAchievementSummary(plan);
  }
}
