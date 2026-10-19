'use server';

import { recordBrownlowEligibilityForAdmin } from '@/lib/admin/operations-centre';
import { requireCapability } from '@/lib/auth/session';

import { invalidInputState, parseSeason } from '../form';

import type { BrownlowEligibilityActionState } from './action-state';
import {
  brownlowFailureState,
  parseBrownlowCitation,
  parseBrownlowDecisionNote,
  parseBrownlowPlayerId,
  parseBrownlowVerdict,
  parseExpectedDecisionId,
} from './eligibility-form';

/**
 * The Brownlow eligibility Server Action (AFLDB V2 Launch F F-D; ADR 0014).
 *
 * `recordBrownlowEligibilityAction` writes (`data.brownlow.finalise`, Super Admin only): ONE
 * append-only `brownlow_eligibility_decisions` row (verdict, citation, note) in one transaction,
 * and returns the RECOMPUTED determination. It never changes a raw vote, the stored season table
 * or a staging row. The guard is the FIRST awaited statement; the caller checks the capability
 * again. NO `revalidatePath` (it hangs the client from a Server Action): the Client Component
 * refreshes the route.
 *
 * Form fields: `season` (four digits), `playerId`, `verdict` (eligible | ineligible), `citation`
 * (1..2000 characters), `note` (20..2000 characters) and `expectedCurrentDecisionId` (blank, or the
 * id of the decision the form was rendered against).
 */

export async function recordBrownlowEligibilityAction(
  _previous: BrownlowEligibilityActionState,
  formData: FormData,
): Promise<BrownlowEligibilityActionState> {
  const admin = await requireCapability('data.brownlow.finalise');

  const fieldErrors: Record<string, string> = {};
  const season = parseSeason(formData.get('season'));
  if (!season.ok) fieldErrors.season = season.error;
  const playerId = parseBrownlowPlayerId(formData.get('playerId'));
  if (!playerId.ok) fieldErrors.playerId = playerId.error;
  const verdict = parseBrownlowVerdict(formData.get('verdict'));
  if (!verdict.ok) fieldErrors.verdict = verdict.error;
  const citation = parseBrownlowCitation(formData.get('citation'));
  if (!citation.ok) fieldErrors.citation = citation.error;
  const note = parseBrownlowDecisionNote(formData.get('note'));
  if (!note.ok) fieldErrors.note = note.error;
  const expected = parseExpectedDecisionId(formData.get('expectedCurrentDecisionId'));
  if (!expected.ok) fieldErrors.expectedCurrentDecisionId = expected.error;
  if (!season.ok || !playerId.ok || !verdict.ok || !citation.ok || !note.ok || !expected.ok) {
    return { ...invalidInputState(fieldErrors), ...(playerId.ok ? { playerId: playerId.value } : {}) };
  }

  const result = await recordBrownlowEligibilityForAdmin(admin, {
    season: season.value,
    playerId: playerId.value,
    verdict: verdict.value,
    citation: citation.value,
    note: note.value,
    expectedCurrentDecisionId: expected.value,
  });
  if (!result.ok) return brownlowFailureState(result, playerId.value);

  const { decision, supersededId, determination, auditWarning } = result;
  const after = determination === null ? null : determination.determination;
  return {
    ok: true,
    playerId: playerId.value,
    message: `Decision #${decision.id} recorded: player ${decision.playerIdAtDecision} ruled ${decision.verdict} for ${decision.season}.${supersededId === null ? '' : ` It supersedes decision #${supersededId}.`}`,
    decision: {
      id: decision.id,
      season: decision.season,
      verdict: decision.verdict,
      basis: decision.basis,
      supersededId,
      decidedAt: decision.decidedAt,
    },
    determination: after === null
      ? null
      : {
        status: after.status,
        winners: after.winners,
        tie: after.tie,
        stillRequiringReview: after.playersRequiringReview.map((player) => player.playerId),
        inputChecksum: after.inputChecksum,
      },
    ...(result.recomputeError === undefined ? {} : { error: result.recomputeError, code: 'recompute_failed' }),
    ...(auditWarning === undefined ? {} : { auditWarning }),
  };
}
