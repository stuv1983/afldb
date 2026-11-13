import { firstValue } from '@/lib/params';
import { decodePlanToken, isNlMatchType, validatePlan, type NlQueryPlan } from './plan';

export type QualifyingMatchesRequest = {
  rawPlan: NlQueryPlan;
  clubParam: string;
};

const INT4_MAX = 2_147_483_647;

function isInt4(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= -INT4_MAX && value <= INT4_MAX;
}

function isOptionalInt4(value: unknown): boolean {
  return value === undefined || isInt4(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalClubRef(value: unknown): boolean {
  return value === undefined || (isPlainObject(value) && isInt4(value.organizationId));
}

/**
 * AFLDB-ISSUE-359 (SRCH-6). A plan token is attacker-shaped JSON. validatePlan
 * reads fields it assumes exist (a missing `scope` threw a TypeError, a page
 * 500) and never type-checks the scope values it passes on, so a string
 * `seasonMin` reached PostgreSQL and failed there (22P02, also a 500). Values
 * were always bound parameters, so this was never injection; it is a shape
 * gate so a crafted token is refused up front as a bad request.
 *
 * Checks exactly the fields the drill-down compiler reads (team-match.ts
 * scopeClauses and answerTeamAggregateDrilldown), plus the containers
 * validatePlan dereferences.
 */
function hasWellFormedShape(plan: unknown): plan is NlQueryPlan {
  if (!isPlainObject(plan)) return false;
  if (!isPlainObject(plan.scope) || !isPlainObject(plan.agg)) return false;
  if (!Array.isArray(plan.careerConditions) || !Array.isArray(plan.careerPredicates)
    || !Array.isArray(plan.clubSeasonConditions)) return false;

  const scope = plan.scope;
  if (!isOptionalInt4(scope.seasonMin) || !isOptionalInt4(scope.seasonMax) || !isOptionalInt4(scope.roundNumber)) {
    return false;
  }
  if (scope.matchType !== undefined && !(typeof scope.matchType === 'string' && isNlMatchType(scope.matchType))) {
    return false;
  }
  if (!isOptionalClubRef(scope.clubFor) || !isOptionalClubRef(scope.clubAgainst)) return false;
  if (scope.matchup !== undefined) {
    if (!isPlainObject(scope.matchup) || !isOptionalClubRef(scope.matchup.clubA) || !isOptionalClubRef(scope.matchup.clubB)
      || scope.matchup.clubA === undefined || scope.matchup.clubB === undefined) return false;
  }
  if (scope.venue !== undefined && !(isPlainObject(scope.venue) && isInt4(scope.venue.id))) return false;
  return true;
}

/**
 * Validates a drill-down request, ensuring it is a well-formed team_aggregate plan
 * and that it contains no semantics the destination SQL compiler cannot reproduce.
 * Returns the parsed plan and club slug on success, or an error reason string on failure.
 * Never throws: a crafted token is an error reason, not a server error.
 */
export function validateQualifyingMatchesRequest(
  tokenParam: string | string[] | undefined,
  clubParamRaw: string | string[] | undefined
): QualifyingMatchesRequest | { error: string } {
  const token = firstValue(tokenParam);
  const clubParam = firstValue(clubParamRaw);

  if (!token || !clubParam || !/^[a-z0-9-]+$/.test(clubParam)) {
    return { error: 'invalid_params' };
  }

  const rawPlan = decodePlanToken(token);
  if (!rawPlan) {
    return { error: 'invalid_token' };
  }

  if (!hasWellFormedShape(rawPlan)) {
    return { error: 'invalid_plan' };
  }

  let validation: ReturnType<typeof validatePlan>;
  try {
    validation = validatePlan(rawPlan);
  } catch {
    return { error: 'invalid_plan' };
  }
  if ('error' in validation) {
    return { error: 'invalid_plan' };
  }

  // ONLY support team_aggregate (i.e. team_match with havingClause)
  if (rawPlan.grain !== 'team_match' || !rawPlan.havingClause) {
    return { error: 'wrong_grain' };
  }

  // Fail-closed compatibility check: prevent silent semantic broadening.
  // resultFilter is permitted by validatePlan on team_match, but our drilldown compiler
  // does not translate it. Reject it here to guarantee exactness.
  if (rawPlan.resultFilter !== undefined) {
    return { error: 'unsupported_result_filter' };
  }

  return { rawPlan, clubParam };
}
