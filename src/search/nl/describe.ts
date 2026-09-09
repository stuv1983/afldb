/**
 * Headline and interpretation text for a natural-language answer.
 *
 * DB-free, like the rest of src/search/nl: the grain compilers in
 * db/queries/nl/*.ts produce the payload, this turns it into the two
 * lines a reader actually sees, and NlAnswerSection.tsx renders them.
 * Split out of db/queries/nl/answer.ts so the wording rules -- above all
 * the tie handling below -- can be unit-tested without a database.
 */
import { GRID_BUILDERS } from '@/search/grid-solver-spec';
import {
  afterSirenRequiresMatchLink, coachWinPctQualifierNote, isCrossDomainPlan, isRelationshipPlan, NL_METRICS,
  type NlQueryPlan,
} from '@/search/nl/plan';
import type {
  NlAfterSirenEventRow, NlAfterSirenPlayerRow, NlAnswerPayload, NlClubSeasonRow, NlCoachRecordRow,
  NlPlayerCareerRow, NlPlayerGameRow, NlPlayerSeasonRow,
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
    || (plan.grain === 'team_match' && payload.kind === 'team_aggregate')
    // "How many coaches has Richmond had" is answered as a count, not as
    // a row list -- the one shape whose payload kind is deliberately not
    // its grain's name.
    || (plan.grain === 'coach_record' && payload.kind === 'count')
    // Two payload shapes plus the shared count, because an event list and
    // a kicker leaderboard are genuinely different answers.
    || (plan.grain === 'after_siren'
        && (payload.kind === 'after_siren_event' || payload.kind === 'after_siren_player'
            || payload.kind === 'count'));
  if (!compatible) {
    throw new Error(`NL payload kind "${payload.kind}" is incompatible with plan grain "${plan.grain}".`);
  }
  if (payload.kind === 'player_career') {
    return describePlayerCareerAnswer(plan, payload.lead, payload.rows, payload.total);
  }
  if (payload.kind === 'player_game') {
    return describePlayerGameAnswer(plan, payload.lead, payload.rows, payload.total);
  }
  if (payload.kind === 'player_season') {
    return describePlayerSeasonAnswer(plan, payload.lead, payload.rows, payload.total);
  }
  if (payload.kind === 'team_match') {
    return describeTeamMatchAnswer(plan, payload.lead, payload.rows);
  }
  if (payload.kind === 'team_aggregate') {
    return describeTeamAggregateAnswer(plan, payload.rows, payload.total);
  }
  if (payload.kind === 'head_to_head') {
    return describeHeadToHeadAnswer(plan, payload.row);
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
  if (payload.kind === 'coach_record') {
    return describeCoachRecordAnswer(plan, payload.lead, payload.rows, payload.total);
  }
  if (payload.kind === 'after_siren_event') {
    return describeAfterSirenEventAnswer(plan, payload.lead, payload.total);
  }
  if (payload.kind === 'after_siren_player') {
    return describeAfterSirenPlayerAnswer(plan, payload.lead, payload.rows, payload.total);
  }
  if (payload.kind === 'count') {
    // The one payload kind two grains share, so it must ask which one it
    // is answering for: "71 kicks after the siren" is not "71 coaches".
    if (plan.grain === 'after_siren') {
      return {
        headline: `${payload.value.toLocaleString('en-AU')} ${payload.value === 1 ? 'kick' : 'kicks'} after the siren`,
        interpretation: `${afterSirenReading(plan)}${afterSirenScopeSuffix(plan)}.`,
      };
    }
    return {
      headline: `${payload.value.toLocaleString('en-AU')} ${payload.value === 1 ? 'coach' : 'coaches'}`,
      interpretation: `${coachSubject(plan)}${coachSeasonSuffix(plan)}.`,
    };
  }
  return { headline: 'Results', interpretation: '' };
}

const COMPARE_WORDS = {
  gte: 'at least', lte: 'at most', gt: 'more than', lt: 'fewer than', eq: 'exactly',
} as const;

function describeHeadToHeadAnswer(
  plan: NlQueryPlan,
  row: Extract<NlAnswerPayload, { kind: 'head_to_head' }>['row'],
): { headline: string; interpretation: string } {
  if (!row) return { headline: 'No matching clubs found', interpretation: '' };
  const matchup = `${row.clubAName} v ${row.clubBName}`;
  const kind = plan.headToHead!.kind;
  if (kind === 'draw_count') {
    return {
      headline: `${row.draws.toLocaleString('en-AU')} ${row.draws === 1 ? 'draw' : 'draws'}`,
      interpretation: `${matchup}, across ${row.total.toLocaleString('en-AU')} matches.`,
    };
  }
  if (kind === 'last_draw') {
    if (row.lastDrawMatchId === null) {
      return { headline: 'No drawn match found', interpretation: matchup };
    }
    const round = row.lastDrawRoundType
      ? ` ${row.lastDrawRoundType.replace(/_/g, ' ')}${row.lastDrawRoundNumber ? ` ${row.lastDrawRoundNumber}` : ''}`
      : '';
    return {
      headline: `Last draw: ${matchup}`,
      interpretation: `${row.lastDrawSeason ?? 'Season not recorded'}${round}.`,
    };
  }
  if (kind === 'compare_wins') {
    const leader = row.clubAWins === row.clubBWins
      ? `${row.clubAName} and ${row.clubBName} are level`
      : `${row.clubAWins > row.clubBWins ? row.clubAName : row.clubBName} has won more`;
    return {
      headline: `${leader} — ${row.clubAWins.toLocaleString('en-AU')} to ${row.clubBWins.toLocaleString('en-AU')}`,
      interpretation: `${row.clubAName} wins first; ${row.draws.toLocaleString('en-AU')} draws from ${row.total.toLocaleString('en-AU')} matches.`,
    };
  }
  return {
    headline: `${row.clubAName} ${row.clubAWins.toLocaleString('en-AU')}–${row.clubBWins.toLocaleString('en-AU')} ${row.clubBName}`,
    interpretation: `${row.draws.toLocaleString('en-AU')} draws; ${row.total.toLocaleString('en-AU')} matches.`,
  };
}

function rankWord(plan: NlQueryPlan): 'Highest' | 'Lowest' {
  return plan.agg.kind === 'min' ? 'Lowest' : 'Highest';
}

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
      ? `Top ${plan.agg.n} ${rankWord(plan).toLowerCase()} matches by ${metricLabel}.`
      : `${rankWord(plan)} ${metricLabel}.`,
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
      ? `Top ${plan.agg.n} ${rankWord(plan).toLowerCase()} club seasons by ${metricLabel}.`
      : `${rankWord(plan)} ${metricLabel}.`,
  };
}

function describePlayerGameAnswer(
  plan: NlQueryPlan,
  lead: NlPlayerGameRow | null,
  rows: NlPlayerGameRow[],
  total: number,
): { headline: string; interpretation: string } {
  if (!lead) return { headline: 'No matching performance found', interpretation: '' };
  const metricLabel = (plan.metric ?? '').replace(/_/g, ' ');
  // A metric threshold is a qualifying list, never a leader: the headline
  // is the count, and the interpretation restates the applied bound.
  if (plan.metricCondition) {
    const bound = `${COMPARE_WORDS[plan.metricCondition.op]} ${plan.metricCondition.value.toLocaleString('en-AU')}`;
    if (plan.mode === 'sum') {
      return {
        headline: `${total.toLocaleString('en-AU')} ${total === 1 ? 'player qualifies' : 'players qualify'}`,
        interpretation: `Total ${metricLabel} ${bound} across the matches in scope.`,
      };
    }
    return {
      headline: `${total.toLocaleString('en-AU')} qualifying ${total === 1 ? 'performance' : 'performances'}`,
      interpretation: `Single-game ${metricLabel} ${bound}.`,
    };
  }
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
      ? `Top ${plan.agg.n} ${rankWord(plan).toLowerCase()} single-game performances.`
      : `${rankWord(plan)} single-game performance.`,
  };
}

function describePlayerSeasonAnswer(
  plan: NlQueryPlan,
  lead: NlPlayerSeasonRow | null,
  rows: NlPlayerSeasonRow[],
  total: number,
): { headline: string; interpretation: string } {
  if (!lead) return { headline: 'No matching season found', interpretation: '' };
  const metricLabel = (plan.metric ?? '').replace(/_/g, ' ');
  if (plan.metricCondition) {
    const bound = `${COMPARE_WORDS[plan.metricCondition.op]} ${plan.metricCondition.value.toLocaleString('en-AU')}`;
    return {
      headline: `${total.toLocaleString('en-AU')} qualifying ${total === 1 ? 'player-season' : 'player-seasons'}`,
      interpretation: `Season ${metricLabel} ${bound}.`,
    };
  }
  const labels = dedupeByIdentity(rows, lead.value, (r) => r.playerId, (r) => r.displayName);
  const { subject, tied } = tiedSubject(labels);
  return {
    headline: `${subject} — ${lead.value.toLocaleString('en-AU')} ${metricLabel} (${lead.season})${tied ? ', tied' : ''}`,
    interpretation: plan.agg.kind === 'top_n'
      ? `Top ${plan.agg.n} ${rankWord(plan).toLowerCase()} player-seasons by ${metricLabel}.`
      : `${rankWord(plan)} single season by ${metricLabel}.`,
  };
}

// -------------------------------------------------------------- coaching

/**
 * Which of the four coaching questions was answered, said out loud. A
 * whole coaching career and a record at one club are different numbers for
 * the same person -- Damien Hardwick coached 307 games at Richmond and
 * more than that in total -- so "Damien Hardwick's coaching record" and
 * "Damien Hardwick's record at Richmond" must never produce the same
 * sentence.
 */
function coachSubject(plan: NlQueryPlan): string {
  if (plan.coach && plan.scope.clubFor) return `${plan.coach.name}'s record at ${plan.scope.clubFor.name} only`;
  if (plan.coach) return `${plan.coach.name}'s whole coaching career, across every club`;
  if (plan.scope.clubFor) return `Every coach of ${plan.scope.clubFor.name}`;
  return 'Every coach recorded';
}

function coachSeasonSuffix(plan: NlQueryPlan): string {
  const { seasonMin, seasonMax } = plan.scope;
  if (seasonMin === undefined && seasonMax === undefined) return '';
  if (seasonMin !== undefined && seasonMin === seasonMax) return `, ${seasonMin}`;
  if (seasonMin !== undefined && seasonMax !== undefined) return `, ${seasonMin}\u2013${seasonMax}`;
  return seasonMin !== undefined ? `, from ${seasonMin}` : `, up to ${seasonMax}`;
}

function coachMetricLabel(metric: string): string {
  return (NL_METRICS.coach_record[metric]?.label ?? metric).toLowerCase();
}

function coachMetricValue(metric: string, value: number): string {
  return metric === 'win_pct' ? `${value.toFixed(2)}%` : value.toLocaleString('en-AU');
}

/**
 * A tenure is never rendered as a continuous run. Jack Titus coached
 * Richmond in 1937 and again in 1965: "coached from 1937 to 1965" would be
 * a 28-year fiction. The span is shown with the seasons count beside it,
 * and the words are "seasons in charge".
 */
function coachTenure(row: NlCoachRecordRow): string {
  const seasons = `${row.seasons.toLocaleString('en-AU')} ${row.seasons === 1 ? 'season' : 'seasons'} in charge`;
  return `${seasons}, ${row.firstSeason}\u2013${row.lastSeason}`;
}

/** "Damien Hardwick — 307 games, 170-6-131", the record itself as the headline. */
function coachRecordHeadline(row: NlCoachRecordRow): string {
  const record = `${row.wins}\u2013${row.draws}\u2013${row.losses}`;
  return `${row.displayName} \u2014 ${row.games.toLocaleString('en-AU')} games, ${record}`;
}

function describeCoachRecordAnswer(
  plan: NlQueryPlan,
  lead: NlCoachRecordRow | null,
  rows: NlCoachRecordRow[],
  total: number,
): { headline: string; interpretation: string } {
  const where = `${coachSubject(plan)}${coachSeasonSuffix(plan)}`;
  if (!lead) return { headline: 'No matching coaching record found', interpretation: `${where}.` };

  // No metric named: the qualifying set IS the answer. One named coach
  // gets their record; a club gets the roll of everyone who has coached it.
  if (!plan.metric) {
    if (plan.coach) {
      return { headline: coachRecordHeadline(lead), interpretation: `${where}: ${coachTenure(lead)}.` };
    }
    return {
      headline: `${total.toLocaleString('en-AU')} ${total === 1 ? 'coach' : 'coaches'}`,
      interpretation: `${where}.`,
    };
  }

  const metricLabel = coachMetricLabel(plan.metric);

  // A threshold lists every qualifier; it never ranks one.
  if (plan.metricCondition) {
    const bound = `${COMPARE_WORDS[plan.metricCondition.op]} ${plan.metricCondition.value.toLocaleString('en-AU')}`;
    return {
      headline: `${total.toLocaleString('en-AU')} ${total === 1 ? 'coach qualifies' : 'coaches qualify'}`,
      interpretation: `${where}, with ${metricLabel} ${bound}.`,
    };
  }

  const labels = dedupeByIdentity(rows, lead.value, (r) => r.coachId, (r) => r.displayName);
  const { subject, tied } = tiedSubject(labels);
  const value = coachMetricValue(plan.metric, lead.value ?? 0);
  // The win-percentage qualifier is never left implicit: without it the
  // board reads as wrong to anyone expecting an all-time great rather than
  // the 57-game leader it actually names.
  const qualifier = plan.metric === 'win_pct' && plan.coachQualifier
    ? ` ${coachWinPctQualifierNote(plan.agg.kind, plan.coachQualifier.minGames)}`
    : '';
  const ranked = plan.agg.kind === 'top_n'
    ? `Top ${plan.agg.n} by coaching ${metricLabel}.`
    : `${rankWord(plan)} coaching ${metricLabel}.`;
  return {
    headline: `${subject} \u2014 ${value} ${metricLabel}${tied ? ' (tied)' : ''}`,
    interpretation: `${ranked} ${where}.${qualifier}`,
  };
}


// ------------------------------------------------------- after the siren

/**
 * The applied dimensions, in words, so "a goal after the siren" and "a
 * goal after the siren to win" are visibly different answers on the page
 * -- 71 events and 62 events, and the reader must be able to see which
 * one they were given.
 *
 * An ABSENT kickScored is stated out loud too: "kicks after the siren" is
 * every recorded event including the misses, which is easy to read as
 * only the ones that scored.
 */
function afterSirenReading(plan: NlQueryPlan): string {
  const siren = plan.afterSiren;
  const parts: string[] = [];
  parts.push(
    siren?.kickScored === 'goal' ? 'Kicks after the siren that kicked a goal'
      : siren?.kickScored === 'behind' ? 'Kicks after the siren that kicked a behind'
      : siren?.kickScored === 'none' ? 'Kicks after the siren that scored nothing'
      : 'Every recorded kick after the siren, including the misses',
  );
  if (siren?.kickEffect === 'won') parts.push('and won the match');
  if (siren?.kickEffect === 'drew') parts.push('and levelled the scores');
  if (siren?.kickEffect === 'none') parts.push('which did not change the result');
  if (siren?.kickerResult) {
    const word = siren.kickerResult === 'win' ? 'won' : siren.kickerResult === 'draw' ? 'drew' : 'lost';
    parts.push(`in a match their side ${word}`);
  }
  return parts.join(' ');
}

function afterSirenScopeSuffix(plan: NlQueryPlan): string {
  const bits: string[] = [];
  if (plan.player) bits.push(`by ${plan.player.name}`);
  if (plan.scope.clubFor) bits.push(`for ${plan.scope.clubFor.name}`);
  if (plan.scope.clubAgainst) bits.push(`against ${plan.scope.clubAgainst.name}`);
  if (plan.scope.matchType) bits.push(`in ${plan.scope.matchType.replace(/_/g, ' ')} matches`);
  const { seasonMin, seasonMax } = plan.scope;
  if (seasonMin !== undefined && seasonMin === seasonMax) bits.push(`in ${seasonMin}`);
  else if (seasonMin !== undefined && seasonMax !== undefined) bits.push(`, ${seasonMin}\u2013${seasonMax}`);
  else if (seasonMin !== undefined) bits.push(`from ${seasonMin}`);
  else if (seasonMax !== undefined) bits.push(`up to ${seasonMax}`);
  return bits.length > 0 ? `, ${bits.join(' ')}` : '';
}

function afterSirenEventSubject(row: NlAfterSirenEventRow): string {
  return `${row.playerName} \u2014 ${row.clubName} v ${row.opponentName}, ${row.season}`;
}

function describeAfterSirenEventAnswer(
  plan: NlQueryPlan,
  lead: NlAfterSirenEventRow | null,
  total: number,
): { headline: string; interpretation: string } {
  const reading = `${afterSirenReading(plan)}${afterSirenScopeSuffix(plan)}.`;
  // An empty result is an HONEST ANSWER, not a decline: "after the siren
  // in a Grand Final" has no rows because no VFL/AFL Grand Final
  // after-siren event exists, which is a fact worth stating plainly.
  if (!lead) return { headline: 'No recorded kick after the siren matches', interpretation: reading };

  if (plan.afterSiren?.occurrence) {
    const when = plan.afterSiren.occurrence === 'first' ? 'The first' : 'The most recent';
    return {
      headline: afterSirenEventSubject(lead),
      interpretation: `${when} of them. ${reading}`,
    };
  }
  return {
    headline: `${total.toLocaleString('en-AU')} ${total === 1 ? 'kick' : 'kicks'} after the siren`,
    interpretation: reading,
  };
}

function describeAfterSirenPlayerAnswer(
  plan: NlQueryPlan,
  lead: NlAfterSirenPlayerRow | null,
  rows: NlAfterSirenPlayerRow[],
  total: number,
): { headline: string; interpretation: string } {
  const reading = `${afterSirenReading(plan)}${afterSirenScopeSuffix(plan)}.`;
  if (!lead) return { headline: 'No player matches', interpretation: reading };

  // A threshold lists every qualifier; it never ranks one. The measured
  // ceiling is 2, so "3 or more goals after the siren" is an honest empty
  // result rather than a decline -- the question is well formed and the
  // answer is nobody.
  if (plan.metricCondition) {
    const bound = `${COMPARE_WORDS[plan.metricCondition.op]} ${plan.metricCondition.value.toLocaleString('en-AU')}`;
    return {
      headline: `${total.toLocaleString('en-AU')} ${total === 1 ? 'player qualifies' : 'players qualify'}`,
      interpretation: `${reading} Counted ${bound} per player.`,
    };
  }

  // Every superlative in this family is a tie -- the measured maxima are
  // 2 kicks, 2 goals and 2 winning kicks -- so an answer that names one
  // player is wrong by construction.
  const labels = dedupeByIdentity(rows, lead.value, (r) => r.playerId, (r) => r.displayName);
  const { subject, tied } = tiedSubject(labels);
  const noun = lead.value === 1 ? 'kick' : 'kicks';
  return {
    headline: `${subject} \u2014 ${lead.value.toLocaleString('en-AU')} ${noun} after the siren${tied ? ' (tied)' : ''}`,
    interpretation: plan.agg.kind === 'top_n' ? `Top ${plan.agg.n}. ${reading}` : reading,
  };
}

/**
 * Caveats an answer must carry that come from the ANSWER rather than from
 * the parse -- what the ownership rules excluded, counted over the same
 * filtered set at answer time and never hard-coded.
 *
 * Returns [] for every other grain, so answer.ts can call it
 * unconditionally.
 */
/**
 * The capped-list disclosure (AFLDB-ISSUE-152 D20), said in the answer's
 * own sentence rather than left to the table's footer. Shared verbatim by
 * the Phase D relationship answers and the Phase F cross-domain answers,
 * so a reader is never silently shown 100 of 365 rows.
 */
function cappedListCaveat(plan: NlQueryPlan, payload: NlAnswerPayload): string | null {
  if (payload.kind !== 'player_career' || plan.metric !== null) return null;
  if (payload.total <= payload.rows.length) return null;
  return `${payload.total.toLocaleString('en-AU')} players qualify. This answer lists the first `
    + `${payload.rows.length.toLocaleString('en-AU')} of them, most games first; it is not the whole list.`;
}

export function answerCaveats(plan: NlQueryPlan, payload: NlAnswerPayload): string[] {
  // AFLDB-ISSUE-152 Phase D. Two boundaries a relationship answer must
  // state in its own sentence. The first is always true: the source is a
  // tracked, cited export in which both sides of a relationship may be
  // unlinked, and an unlinked side is a NAME, never an identity, so it is
  // counted nowhere. The second is the list cap, said out loud rather
  // than left to the table's own footer -- a question that matches 658
  // players and shows 100 of them must say so in the answer itself.
  if (isRelationshipPlan(plan)) {
    const caveats = [
      'AFLDB\'s family relationships come from a tracked, cited list of football families. '
      + 'A relative it has not linked to a player is a name only, and is counted nowhere here.',
    ];
    const capped = cappedListCaveat(plan, payload);
    if (capped) caveats.push(capped);
    return caveats;
  }
  // AFLDB-ISSUE-152 Phase F. A cross-domain answer carries the SAME cap
  // contract, from the same helper, so there is one disclosure rule and
  // not two: 365 players both played and coached, the list shows 100, and
  // the answer sentence itself says so. No completeness caveat is
  // invented alongside it -- per-season coaching completeness is
  // unmeasured, and a claim in either direction would be one AFLDB cannot
  // support.
  if (isCrossDomainPlan(plan)) {
    const capped = cappedListCaveat(plan, payload);
    return capped ? [capped] : [];
  }
  if (plan.grain !== 'after_siren') return [];
  const caveats: string[] = [
    // ALWAYS, on every after-siren answer (operator decision D12). The 1913
    // coverage floor alone would imply a completeness this family does not
    // have: it is a curated list of individual events, not a sweep of every
    // siren ever sounded.
    'AFLDB\'s after-the-siren record is a curated, cited list of individual events, '
    + 'not a systematic record of every kick after every siren.',
  ];
  const excluded = payload.kind === 'after_siren_event' || payload.kind === 'after_siren_player'
    ? payload.excluded
    : null;
  if (!excluded) return caveats;

  if (plan.afterSiren?.subject === 'player' && excluded.noPlayerLink > 0) {
    caveats.push(
      `${excluded.noPlayerLink.toLocaleString('en-AU')} of the recorded kicks in scope `
      + 'are not linked to a player and are not counted here.',
    );
  }
  if (afterSirenRequiresMatchLink(plan) && excluded.noMatchLink > 0) {
    caveats.push(
      `${excluded.noMatchLink.toLocaleString('en-AU')} recorded ${excluded.noMatchLink === 1 ? 'kick has' : 'kicks have'} `
      + 'no match link, so they cannot be ordered or scoped to a match type and are left out.',
    );
  }
  return caveats;
}

/**
 * The one boundary a first-kick-goal answer must state in its own
 * sentence (AFLDB-ISSUE-152 §17.6): the record is a curated, cited list,
 * and NL counts only the rows linked to a canonical player, so the answer
 * is deliberately a subset of what /records/first-kick-goal displays.
 * Not an answerCaveats entry -- that helper is after-siren only.
 */
function curatedRecordNote(plan: NlQueryPlan): string {
  const curated = plan.careerPredicates.some((axis) => axis.builder.startsWith('first_kick_goal'));
  return curated
    ? ' AFLDB\'s first-kick-goal record is a curated, cited list; rows it has not linked to a player are not counted.'
    : '';
}

/**
 * AFLDB-ISSUE-152 Phase D wording (§22.6). A relationship answer names
 * the relationship, always: "Players meeting every condition asked for"
 * is true of every career list ever returned and tells a reader nothing
 * about which relationship they were shown. The phrases below are the
 * ONLY wording these answers use, and each says which relationship, in
 * which direction, and -- where the builder requires it -- that the
 * relative themselves played.
 *
 * Deliberately not "family": what a football family IS remains an open
 * question (AFLDB-ISSUE-153), and the word would claim an answer to it.
 */
const RELATIONSHIP_WITH_PHRASE: Record<string, string> = {
  has_brother: 'a brother who played VFL/AFL',
  has_afl_father: 'a father who played VFL/AFL',
  has_afl_son: 'a son who played VFL/AFL',
  has_afl_parent_or_child: 'a parent or child who played VFL/AFL',
};

const RELATIONSHIP_OF_NOUN: Record<string, string> = {
  brother_of_player: 'Brothers',
  father_of_player: 'Fathers',
  son_of_player: 'Sons',
};

/** Yes/no wording for a pinned player, in the same relationship vocabulary. */
const RELATIONSHIP_PINNED_PHRASE: Record<string, { yes: string; no: string }> = {
  has_brother: { yes: 'has a brother who played VFL/AFL', no: 'has no recorded brother who played VFL/AFL' },
  has_afl_father: { yes: 'has a father who played VFL/AFL', no: 'has no recorded father who played VFL/AFL' },
  has_afl_son: { yes: 'has a son who played VFL/AFL', no: 'has no recorded son who played VFL/AFL' },
  has_afl_parent_or_child: {
    yes: 'has a parent or child who played VFL/AFL',
    no: 'has no recorded parent or child who played VFL/AFL',
  },
  father_son_father: {
    yes: 'had a son selected under the father–son rule',
    no: 'had no son selected under the father–son rule',
  },
};

/**
 * The answer's subject, as a sentence-leading phrase: "Brothers of Brent
 * Harvey", "Players with a brother who played VFL/AFL", "Players whose
 * son was selected under the father-son rule". Null when the plan carries
 * no relationship, which is every pre-Phase-D answer.
 */
/**
 * AFLDB-ISSUE-152 Phase F. The cross-domain answer's subject, as a
 * sentence-leading phrase. Truthful "also" wording only: the word
 * "later" appears in no branch of this function and in no Phase F
 * constant, because AFLDB does not own the order of the two careers
 * (D9/F-D2) and a sentence that implies it would claim a fact the SQL
 * never checked.
 *
 * Both clubs are always named, each on its own side of the sentence,
 * from the references the plan carries beside the builders' bound ids.
 */
function crossDomainSubjectPhrase(plan: NlQueryPlan): string | null {
  if (plan.crossDomainClubs) {
    return `Players who played for ${plan.crossDomainClubs.played.name} `
      + `and also coached ${plan.crossDomainClubs.coached.name}`;
  }
  if (plan.careerPredicates.some((axis) => axis.builder === 'has_coached')) {
    return 'Players who played VFL/AFL and also coached';
  }
  return null;
}

function relationshipSubjectPhrase(plan: NlQueryPlan): string | null {
  const ofAxis = plan.careerPredicates.find((axis) => RELATIONSHIP_OF_NOUN[axis.builder]);
  if (ofAxis && plan.relationshipSubject) {
    return `${RELATIONSHIP_OF_NOUN[ofAxis.builder]} of ${plan.relationshipSubject.name}`;
  }
  const withPhrases = plan.careerPredicates
    .map((axis) => RELATIONSHIP_WITH_PHRASE[axis.builder])
    .filter((phrase): phrase is string => phrase !== undefined);
  const fatherSonFather = plan.careerPredicates.some((axis) => axis.builder === 'father_son_father');
  const clauses: string[] = [];
  if (withPhrases.length > 0) clauses.push(`with ${withPhrases.join(' and ')}`);
  if (fatherSonFather) clauses.push('whose son was selected under the father–son rule');
  if (clauses.length === 0) return null;
  return `Players ${clauses.join(', ')}`;
}

function describePlayerCareerAnswer(
  plan: NlQueryPlan,
  lead: NlPlayerCareerRow | null,
  rows: NlPlayerCareerRow[],
  total: number,
): { headline: string; interpretation: string } {
  if (!plan.metric || lead === null || lead.value === null) {
    // AFLDB-ISSUE-152 Phase E (E-D1). "did Dustin Martin kick a goal with
    // his first kick" is a yes/no question about ONE player, and "1 player
    // matches" / "0 players match" is a poor way to answer it. Gated
    // narrowly to a pinned player with conditions and no ranking metric,
    // so every unpinned list keeps the count wording it has always had.
    if (plan.player && !plan.metric && plan.careerPredicates.length > 0) {
      // AFLDB-ISSUE-152 Phase D: a pinned relationship question answers in
      // the relationship's own words ("Brent Harvey has a brother who
      // played VFL/AFL"), not as a list of condition labels.
      const pinned = plan.careerPredicates
        .map((axis) => RELATIONSHIP_PINNED_PHRASE[axis.builder])
        .filter((phrase): phrase is { yes: string; no: string } => phrase !== undefined);
      if (pinned.length === plan.careerPredicates.length && pinned.length > 0) {
        const phrase = pinned.map((p) => (total > 0 ? p.yes : p.no)).join(' and ');
        return {
          headline: `${plan.player.name} — ${total > 0 ? 'yes' : 'no'}`,
          interpretation: `${plan.player.name} ${phrase}.`,
        };
      }
      const conditions = plan.careerPredicates
        .map((axis) => GRID_BUILDERS[axis.builder]?.label ?? axis.builder)
        .join('; ');
      return {
        headline: `${plan.player.name} — ${total > 0 ? 'yes' : 'no'}`,
        interpretation: `${plan.player.name} ${total > 0 ? 'meets' : 'does not meet'} `
          + `every condition asked for: ${conditions}.${curatedRecordNote(plan)}`,
      };
    }
    const relationship = relationshipSubjectPhrase(plan) ?? crossDomainSubjectPhrase(plan);
    return {
      headline: `${total.toLocaleString('en-AU')} ${total === 1 ? 'player matches' : 'players match'}`,
      interpretation: relationship
        ? `${relationship}.`
        : plan.scope.clubFor
        ? `Players matching every condition for ${plan.scope.clubFor.name}.`
        : 'Players meeting every condition asked for.',
    };
  }
  const metricLabel = plan.metric.replace(/_/g, ' ');
  const clubSuffix = plan.scope.clubFor ? ` for ${plan.scope.clubFor.name}` : '';
  // AFLDB-ISSUE-152 Phase D. A ranked relationship answer says what it
  // ranked WITHIN: "Most career games among players with a brother who
  // played VFL/AFL" is a different record from "most career games", and
  // the two must never read the same.
  const relationship = relationshipSubjectPhrase(plan) ?? crossDomainSubjectPhrase(plan);
  const among = relationship
    ? ` among ${relationship.charAt(0).toLowerCase()}${relationship.slice(1)}`
    : '';
  const labels = dedupeByIdentity(rows, lead.value, (r) => r.playerId, (r) => r.displayName);
  const { subject, tied } = tiedSubject(labels);
  return {
    headline: `${subject} — ${lead.value.toLocaleString('en-AU')} ${metricLabel}${tied ? ' (tied)' : ''}`,
    interpretation: plan.agg.kind === 'top_n'
      ? `Top ${plan.agg.n} ${rankWord(plan).toLowerCase()} by career ${metricLabel}${clubSuffix}${among}.`
      : `${rankWord(plan)} career ${metricLabel}${clubSuffix}${among}.`,
  };
}
