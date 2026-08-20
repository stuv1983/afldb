/**
 * Headline and interpretation text for a natural-language answer.
 *
 * DB-free, like the rest of src/search/nl: the grain compilers in
 * db/queries/nl/*.ts produce the payload, this turns it into the two
 * lines a reader actually sees, and NlAnswerSection.tsx renders them.
 * Split out of db/queries/nl/answer.ts so the wording rules -- above all
 * the tie handling below -- can be unit-tested without a database.
 */
import type { NlQueryPlan } from '@/search/nl/plan';
import type {
  NlAnswerPayload, NlClubSeasonRow, NlPlayerCareerRow, NlPlayerGameRow, NlPlayerSeasonRow,
  NlTeamAggregateRow, NlTeamMatchRow, NlTeamStreakRow,
} from '@/search/nl/answer-types';


/**
 * "Gordon Coventry" for a clean leader, or a tie-aware subject when more
 * than one row shares the lead value: "Gordon Coventry and Gary Ablett
 * Snr" for two, "Gordon Coventry and 2 others" for more. Every grain's
 * SQL already returns every row tied at the lead rank (rank() with no
 * PARTITION BY, WHERE rnk <= rankCutoff) -- this only decides how many
 * of their labels the headline itself names, and whether it marks the
 * answer as tied at all.
 *
 * `labels` must already be deduplicated by the caller (one label per
 * distinct record holder) -- see dedupeByIdentity below. Order is
 * preserved, so pass labels in the same order the row query already
 * ranks them.
 */
export function tiedSubject(labels: string[]): { subject: string; tied: boolean } {
  if (labels.length <= 1) return { subject: labels[0] ?? '', tied: false };
  if (labels.length === 2) return { subject: `${labels[0]} and ${labels[1]}`, tied: true };
  const rest = labels.length - 1;
  return { subject: `${labels[0]} and ${rest} other${rest === 1 ? '' : 's'}`, tied: true };
}

/**
 * Every row sharing the lead's value, reduced to one label per distinct
 * record holder (`identity`) in first-seen order.
 *
 * Dedup matters because the SAME player/club can legitimately appear
 * twice in a tied set -- e.g. a player who kicked the record number of
 * goals in two different matches. Without this, that reads as "Gordon
 * Coventry and Gordon Coventry", which looks like a bug rather than the
 * (correct, if slightly unusual) fact that one player set the record
 * twice.
 */
export function dedupeByIdentity<T extends { value: number | null }>(
  rows: T[],
  leadValue: number | null,
  identity: (row: T) => number | string,
  label: (row: T) => string,
): string[] {
  const seen = new Set<number | string>();
  const labels: string[] = [];
  for (const row of rows) {
    if (row.value !== leadValue) continue;
    const key = identity(row);
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label(row));
  }
  return labels;
}

export function describeAnswer(plan: NlQueryPlan, payload: NlAnswerPayload): { headline: string; interpretation: string } {
  const compatible = payload.kind === plan.grain
    || (plan.grain === 'team_match' && payload.kind === 'team_aggregate');
  if (!compatible) {
    throw new Error(`NL payload kind "${payload.kind}" is incompatible with plan grain "${plan.grain}".`);
  }
  if (payload.kind === 'player_career') {
    return describePlayerCareerAnswer(plan, payload.lead, payload.rows, payload.total);
  }
  if (payload.kind === 'player_game') {
    return describePlayerGameAnswer(plan, payload.lead, payload.rows);
  }
  if (payload.kind === 'player_season') {
    return describePlayerSeasonAnswer(plan, payload.lead, payload.rows);
  }
  if (payload.kind === 'team_match') {
    return describeTeamMatchAnswer(plan, payload.lead, payload.rows);
  }
  if (payload.kind === 'team_aggregate') {
    return describeTeamAggregateAnswer(plan, payload.rows, payload.total);
  }
  if (payload.kind === 'team_streak') {
    return describeTeamStreakAnswer(plan, payload.lead, payload.rows);
  }
  if (payload.kind === 'club_season') {
    return describeClubSeasonAnswer(plan, payload.lead, payload.rows, payload.total);
  }
  if (payload.kind === 'achievement_summary') {
    return describeAchievementSummaryAnswer(payload);
  }
  return { headline: 'Results', interpretation: '' };
}

const COMPARE_WORDS = {
  gte: 'at least', lte: 'at most', gt: 'more than', lt: 'fewer than', eq: 'exactly',
} as const;

function describeTeamAggregateAnswer(
  plan: NlQueryPlan,
  rows: NlTeamAggregateRow[],
  total: number,
): { headline: string; interpretation: string } {
  const having = plan.havingClause!;
  const margin = plan.matchFilter
    ? `, counting only ${plan.matchFilter.metric.replace(/_/g, ' ')} ${COMPARE_WORDS[plan.matchFilter.op]} ${plan.matchFilter.value}`
    : '';
  return {
    headline: `${total.toLocaleString('en-AU')} ${total === 1 ? 'club qualifies' : 'clubs qualify'}`,
    interpretation: `Clubs with ${COMPARE_WORDS[having.op]} ${having.value} ${having.metric}${margin}.`,
  };
}

function describeTeamStreakAnswer(
  plan: NlQueryPlan,
  lead: NlTeamStreakRow | null,
  rows: NlTeamStreakRow[],
): { headline: string; interpretation: string } {
  if (!lead) return { headline: 'No matching streak found', interpretation: '' };
  const seen = new Set<number>();
  const labels: string[] = [];
  for (const row of rows) {
    if (row.streakLength !== lead.streakLength || seen.has(row.clubId)) continue;
    seen.add(row.clubId);
    labels.push(row.clubName);
  }
  const { subject, tied } = tiedSubject(labels);
  const kind = plan.streakDefinition?.kind ?? 'result';
  return {
    headline: `${subject} \u2014 ${lead.streakLength.toLocaleString('en-AU')}-match ${kind} streak${tied ? ' (tied)' : ''}`,
    interpretation: plan.agg.kind === 'top_n'
      ? `Top ${plan.agg.n} ${kind} streaks.`
      : `Longest ${kind} streak.`,
  };
}

function describeAchievementSummaryAnswer(
  payload: Extract<NlAnswerPayload, { kind: 'achievement_summary' }>,
): { headline: string; interpretation: string } {
  const { rows, groupBy, achievementLabel, total } = payload;
  const held = `${total.toLocaleString('en-AU')} recorded ${total === 1 ? 'player' : 'players'}`;

  if (rows.length === 0) {
    return { headline: 'No matching records found', interpretation: `${achievementLabel}: ${held}.` };
  }

  // "Which clubs have never..." is a list, not a ranking: every row is
  // equally an answer, so naming a leader would be meaningless.
  if (groupBy === 'club' && rows.every((r) => r.value === 0)) {
    const names = rows.map((r) => r.label);
    const shown = names.length <= 4 ? names.join(', ') : `${names.slice(0, 4).join(', ')} and ${names.length - 4} more`;
    return {
      headline: `${rows.length} ${rows.length === 1 ? 'club has' : 'clubs have'} never had one — ${shown}`,
      interpretation: `${achievementLabel}. Measured across ${held}.`,
    };
  }

  if (groupBy === 'occurrence') {
    const names = rows.map((r) => r.label);
    return {
      headline: names.length === 1 ? names[0] : `${names.join(', ')} (tied)`,
      interpretation: `${achievementLabel}. Measured across ${held}.`,
    };
  }

  // A distribution's headline names the leader, and says so when the top
  // count is shared rather than presenting one of several as the answer.
  // Found by max value, not position: by_club and by_season arrive
  // count-descending but by_decade is chronological, and rows[0] of a
  // chronological table is the 1890s, not the leader.
  const top = rows.reduce((best, r) => (r.value > best.value ? r : best), rows[0]);
  const tiedWith = rows.filter((r) => r.value === top.value);
  const leader = tiedWith.length > 1
    ? `${tiedWith.map((r) => r.label).join(', ')} — ${top.value.toLocaleString('en-AU')} each (tied)`
    : `${top.label} — ${top.value.toLocaleString('en-AU')}`;
  const noun = groupBy === 'club' ? 'club' : groupBy === 'decade' ? 'decade' : 'season';

  return {
    headline: leader,
    interpretation: `${achievementLabel}, by ${noun}. Measured across ${held}.`,
  };
}

function describeTeamMatchAnswer(
  plan: NlQueryPlan,
  lead: NlTeamMatchRow | null,
  rows: NlTeamMatchRow[],
): { headline: string; interpretation: string } {
  if (!lead) return { headline: 'No matching match found', interpretation: '' };
  const metricLabel = (plan.metric ?? '').replace(/_/g, ' ');
  // Identity is the match itself, not the club: "Richmond's biggest win"
  // can legitimately be tied by two DIFFERENT Richmond matches, and each
  // is its own record, not a duplicate of the other.
  const labels = dedupeByIdentity(
    rows, lead.value,
    (r) => r.matchId,
    (r) => `${r.clubName} vs ${r.opponentName} (${r.season})`,
  );
  const { subject, tied } = tiedSubject(labels);
  return {
    headline: `${subject} — ${lead.value.toLocaleString('en-AU')} ${metricLabel}${tied ? ' (tied)' : ''}`,
    interpretation: plan.agg.kind === 'top_n'
      ? `Top ${plan.agg.n} matches by ${metricLabel}.`
      : `Highest ${metricLabel}.`,
  };
}

function describeClubSeasonAnswer(
  plan: NlQueryPlan,
  lead: NlClubSeasonRow | null,
  rows: NlClubSeasonRow[],
  total: number,
): { headline: string; interpretation: string } {
  if (!plan.metric || lead === null || lead.value === null) {
    return {
      headline: `${total.toLocaleString('en-AU')} ${total === 1 ? 'club season matches' : 'club seasons match'}`,
      interpretation: 'Club seasons meeting every condition asked for.',
    };
  }
  const metricLabel = plan.metric.replace(/_/g, ' ');
  // AFL percentage is conventionally shown to one decimal; every other
  // club_season metric (wins/losses/draws) is a whole number of games.
  const formattedValue = plan.metric === 'percentage' ? lead.value.toFixed(1) : lead.value.toLocaleString('en-AU');
  // Identity is the season, not the club: the same club can hold the
  // record in two different years, and each year is a distinct answer.
  const labels = dedupeByIdentity(
    rows, lead.value,
    (r) => `${r.clubId}-${r.season}`,
    (r) => `${r.clubName} (${r.season})`,
  );
  const { subject, tied } = tiedSubject(labels);
  return {
    headline: `${subject} — ${formattedValue} ${metricLabel}${tied ? ' (tied)' : ''}`,
    interpretation: plan.agg.kind === 'top_n'
      ? `Top ${plan.agg.n} club seasons by ${metricLabel}.`
      : `Highest ${metricLabel}.`,
  };
}

function describePlayerGameAnswer(
  plan: NlQueryPlan,
  lead: NlPlayerGameRow | null,
  rows: NlPlayerGameRow[],
): { headline: string; interpretation: string } {
  if (!lead) return { headline: 'No matching performance found', interpretation: '' };
  const metricLabel = (plan.metric ?? '').replace(/_/g, ' ');
  // Identity is the player: two rows for the same player at the lead
  // value are the same record held twice, not two different holders.
  const labels = dedupeByIdentity(rows, lead.value, (r) => r.playerId, (r) => r.playerName);
  const { subject, tied } = tiedSubject(labels);
  if (lead.games !== null) {
    // Sum mode: a scoped career total, no single match to name.
    return {
      headline: `${subject} — ${lead.value.toLocaleString('en-AU')} ${metricLabel}${tied ? ' (tied)' : ''}`,
      interpretation: `Total across ${lead.games.toLocaleString('en-AU')} ${lead.games === 1 ? 'game' : 'games'} in scope.`,
    };
  }
  return {
    headline: `${subject} — ${lead.value.toLocaleString('en-AU')} ${metricLabel}${tied ? ' (tied)' : ''}`,
    interpretation: plan.agg.kind === 'top_n'
      ? `Top ${plan.agg.n} single-game performances.`
      : 'Highest single-game performance.',
  };
}

function describePlayerSeasonAnswer(
  plan: NlQueryPlan,
  lead: NlPlayerSeasonRow | null,
  rows: NlPlayerSeasonRow[],
): { headline: string; interpretation: string } {
  if (!lead) return { headline: 'No matching season found', interpretation: '' };
  const metricLabel = (plan.metric ?? '').replace(/_/g, ' ');
  const labels = dedupeByIdentity(rows, lead.value, (r) => r.playerId, (r) => r.displayName);
  const { subject, tied } = tiedSubject(labels);
  return {
    headline: `${subject} — ${lead.value.toLocaleString('en-AU')} ${metricLabel} (${lead.season})${tied ? ', tied' : ''}`,
    interpretation: plan.agg.kind === 'top_n'
      ? `Top ${plan.agg.n} player-seasons by ${metricLabel}.`
      : `Highest single season by ${metricLabel}.`,
  };
}

function describePlayerCareerAnswer(
  plan: NlQueryPlan,
  lead: NlPlayerCareerRow | null,
  rows: NlPlayerCareerRow[],
  total: number,
): { headline: string; interpretation: string } {
  if (!plan.metric || lead === null || lead.value === null) {
    return {
      headline: `${total.toLocaleString('en-AU')} ${total === 1 ? 'player matches' : 'players match'}`,
      interpretation: 'Players meeting every condition asked for.',
    };
  }
  const metricLabel = plan.metric.replace(/_/g, ' ');
  const labels = dedupeByIdentity(rows, lead.value, (r) => r.playerId, (r) => r.displayName);
  const { subject, tied } = tiedSubject(labels);
  return {
    headline: `${subject} — ${lead.value.toLocaleString('en-AU')} ${metricLabel}${tied ? ' (tied)' : ''}`,
    interpretation: plan.agg.kind === 'top_n'
      ? `Top ${plan.agg.n} by career ${metricLabel}.`
      : `Highest career ${metricLabel}.`,
  };
}
