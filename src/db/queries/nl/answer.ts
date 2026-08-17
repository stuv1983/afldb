import 'server-only';

import { executePlan } from '@/db/queries/nl/execute';
import { buildNlParseContext } from '@/db/queries/nl/resolve';
import {
  BROWNLOW_GAME_VOTE_NOTE,
  describePlan,
  encodePlanToken,
  NL_COVERAGE,
  validatePlan,
  type NlQueryPlan,
} from '@/search/nl/plan';
import { parseNlQuestion } from '@/search/nl/parser';
import type {
  NlAnswer, NlAnswerPayload, NlPlayerCareerRow, NlPlayerGameRow, NlPlayerSeasonRow,
} from '@/search/nl/answer-types';

/**
 * Parse and answer a natural-language question end to end: question ->
 * parseNlQuestion -> validatePlan (defence in depth, even though the
 * parser just built this plan) -> executePlan -> a rendered NlAnswer, or
 * null when there is nothing to show (the question wasn't recognised,
 * confidence was too low, or the recognised plan matched no rows -- the
 * same "fall through to ordinary search, no empty-state panel" rule
 * db/queries/search.ts's answerPlayerQuestion/answerClubQuestion
 * already follow).
 *
 * Every failure mode degrades to null rather than throwing: a reader's
 * ordinary player/club/venue results must never be lost because the
 * question-answering layer hit a bug.
 */
export async function answerNlQuestion(question: string): Promise<NlAnswer | null> {
  try {
    const ctx = await buildNlParseContext();
    const parsed = await parseNlQuestion(question, ctx);

    if (parsed.status === 'unanswerable') {
      return {
        headline: 'AFLDB can’t answer this yet',
        interpretation: parsed.topic,
        caveats: [],
        coverageNote: null,
        explain: [parsed.reason],
        planToken: null,
        payload: { kind: 'unanswerable', topic: parsed.topic, reason: parsed.reason },
      };
    }

    if (parsed.status === 'none') return null;

    const validated = validatePlan(parsed.plan);
    if ('error' in validated) {
      // The parser's own plan failed defence-in-depth validation --
      // most commonly an era-coverage rejection ("tackles weren't
      // recorded before 1987"), which is a genuine, useful answer in
      // its own right, not a bug to hide.
      return {
        headline: 'AFLDB can’t answer this',
        interpretation: validated.error,
        caveats: [],
        coverageNote: null,
        explain: [validated.error],
        planToken: null,
        payload: { kind: 'unanswerable', topic: question, reason: validated.error },
      };
    }

    const payload = await executePlan(validated);
    if (payloadTotal(payload) === 0) return null;

    return buildAnswer(validated, payload, parsed.report.notes);
  } catch (error) {
    console.error('natural-language question could not be answered', error);
    return null;
  }
}

function payloadTotal(payload: NlAnswerPayload): number {
  switch (payload.kind) {
    case 'player_game': case 'player_career': case 'player_season':
    case 'team_match': case 'club_season':
      return payload.total;
    case 'count':
      return 1;
    case 'unanswerable':
      return 0;
  }
}

function buildAnswer(plan: NlQueryPlan, payload: NlAnswerPayload, notes: string[]): NlAnswer {
  // Per-game Brownlow votes have their own coverage gap (1935-1983 missing
  // entirely, and never recorded for finals at all) that NL_COVERAGE's
  // single-firstSeason shape can't express -- a fixed note, the same one
  // grid-solver-adjacent code already carries, rather than a misleading
  // "recorded since 1931".
  const coverageNote = plan.grain === 'player_game' && plan.metric === 'brownlow_votes'
    ? BROWNLOW_GAME_VOTE_NOTE
    : plan.metric ? (NL_COVERAGE[plan.metric]?.note ?? null) : null;
  const { headline, interpretation } = describeAnswer(plan, payload);

  return {
    headline,
    interpretation,
    caveats: notes,
    coverageNote,
    explain: describePlan(plan),
    planToken: encodePlanToken(plan),
    payload,
  };
}

function describeAnswer(plan: NlQueryPlan, payload: NlAnswerPayload): { headline: string; interpretation: string } {
  if (payload.kind === 'player_career') {
    return describePlayerCareerAnswer(plan, payload.lead, payload.total);
  }
  if (payload.kind === 'player_game') {
    return describePlayerGameAnswer(plan, payload.lead);
  }
  if (payload.kind === 'player_season') {
    return describePlayerSeasonAnswer(plan, payload.lead);
  }
  return { headline: 'Results', interpretation: '' };
}

function describePlayerGameAnswer(
  plan: NlQueryPlan,
  lead: NlPlayerGameRow | null,
): { headline: string; interpretation: string } {
  if (!lead) return { headline: 'No matching performance found', interpretation: '' };
  const metricLabel = (plan.metric ?? '').replace(/_/g, ' ');
  if (lead.games !== null) {
    // Sum mode: a scoped career total, no single match to name.
    return {
      headline: `${lead.playerName} — ${lead.value.toLocaleString('en-AU')} ${metricLabel}`,
      interpretation: `Total across ${lead.games.toLocaleString('en-AU')} ${lead.games === 1 ? 'game' : 'games'} in scope.`,
    };
  }
  return {
    headline: `${lead.playerName} — ${lead.value.toLocaleString('en-AU')} ${metricLabel}`,
    interpretation: plan.agg.kind === 'top_n'
      ? `Top ${plan.agg.n} single-game performances.`
      : 'Highest single-game performance.',
  };
}

function describePlayerSeasonAnswer(
  plan: NlQueryPlan,
  lead: NlPlayerSeasonRow | null,
): { headline: string; interpretation: string } {
  if (!lead) return { headline: 'No matching season found', interpretation: '' };
  const metricLabel = (plan.metric ?? '').replace(/_/g, ' ');
  return {
    headline: `${lead.displayName} — ${lead.value.toLocaleString('en-AU')} ${metricLabel} (${lead.season})`,
    interpretation: plan.agg.kind === 'top_n'
      ? `Top ${plan.agg.n} player-seasons by ${metricLabel}.`
      : `Highest single season by ${metricLabel}.`,
  };
}

function describePlayerCareerAnswer(
  plan: NlQueryPlan,
  lead: NlPlayerCareerRow | null,
  total: number,
): { headline: string; interpretation: string } {
  if (!plan.metric || lead === null || lead.value === null) {
    return {
      headline: `${total.toLocaleString('en-AU')} ${total === 1 ? 'player matches' : 'players match'}`,
      interpretation: 'Players meeting every condition asked for.',
    };
  }
  const metricLabel = plan.metric.replace(/_/g, ' ');
  return {
    headline: `${lead.displayName} — ${lead.value.toLocaleString('en-AU')} ${metricLabel}`,
    interpretation: plan.agg.kind === 'top_n'
      ? `Top ${plan.agg.n} by career ${metricLabel}.`
      : `Highest career ${metricLabel}.`,
  };
}
