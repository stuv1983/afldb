import { firstValue } from '@/lib/params';
import { decodePlanToken, validatePlan, type NlQueryPlan } from './plan';

export type QualifyingMatchesRequest = {
  rawPlan: NlQueryPlan;
  clubParam: string;
};

/**
 * Validates a drill-down request, ensuring it is a well-formed team_aggregate plan
 * and that it contains no semantics the destination SQL compiler cannot reproduce.
 * Returns the parsed plan and club slug on success, or an error reason string on failure.
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

  const validation = validatePlan(rawPlan);
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
