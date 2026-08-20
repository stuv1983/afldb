export type AdminQuarterScoreInput = {
  goals?: number | null;
  behinds?: number | null;
  points?: number | null;
};

export type AdminMatchNumericInput = {
  homeGoals?: number | null;
  homeBehinds?: number | null;
  homeScore?: number | null;
  awayGoals?: number | null;
  awayBehinds?: number | null;
  awayScore?: number | null;
  attendance?: number | null;
  homeQuarters?: Record<number, AdminQuarterScoreInput> | null;
  awayQuarters?: Record<number, AdminQuarterScoreInput> | null;
};

const MAX_SCORE_COMPONENT = 500;
const MAX_SCORE = 4_000;
const MAX_ATTENDANCE = 2_147_483_647;

function validateInteger(
  label: string,
  value: number | null | undefined,
  max: number,
): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > max) {
    return `${label} must be a whole number from 0 to ${max}.`;
  }
  return null;
}

function validateScore(
  side: 'Home' | 'Away',
  goals: number | null | undefined,
  behinds: number | null | undefined,
  score: number | null | undefined,
): string | null {
  for (const [label, value, max] of [
    [`${side} goals`, goals, MAX_SCORE_COMPONENT],
    [`${side} behinds`, behinds, MAX_SCORE_COMPONENT],
    [`${side} total score`, score, MAX_SCORE],
  ] as const) {
    const error = validateInteger(label, value, max);
    if (error) return error;
  }

  const hasGoals = goals !== null && goals !== undefined;
  const hasBehinds = behinds !== null && behinds !== undefined;
  const hasScore = score !== null && score !== undefined;
  if (!hasScore && !(hasGoals && hasBehinds)) {
    return `${side} score requires both goals and behinds, or an explicit total score.`;
  }
  if (hasGoals && hasBehinds && hasScore && score !== goals * 6 + behinds) {
    return `${side} total score must equal goals × 6 plus behinds.`;
  }
  return null;
}

/** Validate all client-controlled numeric fields before a match insert. */
export function validateAdminMatchNumbers(input: AdminMatchNumericInput): string | null {
  const homeError = validateScore('Home', input.homeGoals, input.homeBehinds, input.homeScore);
  if (homeError) return homeError;
  const awayError = validateScore('Away', input.awayGoals, input.awayBehinds, input.awayScore);
  if (awayError) return awayError;

  const attendanceError = validateInteger('Attendance', input.attendance, MAX_ATTENDANCE);
  if (attendanceError) return attendanceError;

  for (const [side, periods] of [
    ['Home', input.homeQuarters],
    ['Away', input.awayQuarters],
  ] as const) {
    if (!periods) continue;
    for (let period = 1; period <= 4; period += 1) {
      const score = periods[period];
      if (!score) continue;
      for (const [label, value, max] of [
        [`${side} Q${period} goals`, score.goals, MAX_SCORE_COMPONENT],
        [`${side} Q${period} behinds`, score.behinds, MAX_SCORE_COMPONENT],
        [`${side} Q${period} points`, score.points, MAX_SCORE],
      ] as const) {
        const error = validateInteger(label, value, max);
        if (error) return error;
      }
      if (
        score.goals != null
        && score.behinds != null
        && score.points != null
        && score.points !== score.goals * 6 + score.behinds
      ) {
        return `${side} Q${period} points must equal goals × 6 plus behinds.`;
      }
    }
  }

  return null;
}
