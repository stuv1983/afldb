import 'server-only';

import { answerPlayerCareer } from '@/db/queries/nl/player-career';
import { NL_LIMITS, type NlQueryPlan } from '@/search/nl/plan';
import type { NlAnswerPayload } from '@/search/nl/answer-types';

/**
 * Dispatches a VALIDATED plan to its grain's compiler. This is the one
 * function a future LLM fallback (see plan.ts's header comment) would
 * call: anything that produces a plan passing validatePlan reaches SQL
 * only through here, and only through one of the grain compilers below,
 * never directly.
 *
 * player_game, player_season, team_match and club_season land in later
 * phases (C and D); until then they throw a named error execute callers
 * -- answer.ts -- catch and degrade from, the same "no compiler yet"
 * shape query-builder.ts and grid-solver.ts already use for an
 * unrecognised builder.
 */
export async function executePlan(plan: NlQueryPlan): Promise<NlAnswerPayload> {
  const limit = plan.agg.kind === 'top_n' || plan.agg.kind === 'list' ? NL_LIMITS.maxListRows : NL_LIMITS.maxTiedRows;
  const cappedLimit = Math.min(plan.limit, limit);

  switch (plan.grain) {
    case 'player_career':
      return answerPlayerCareer(plan, cappedLimit);
    case 'player_game':
      throw new Error(`Grain "${plan.grain}" has no compiler yet.`);
    case 'player_season':
      throw new Error(`Grain "${plan.grain}" has no compiler yet.`);
    case 'team_match':
      throw new Error(`Grain "${plan.grain}" has no compiler yet.`);
    case 'club_season':
      throw new Error(`Grain "${plan.grain}" has no compiler yet.`);
  }
}
