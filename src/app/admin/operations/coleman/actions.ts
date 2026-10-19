'use server';

import { compareColemanSeason, publishColemanSeason, type ColemanPublicationResult } from '@/lib/admin/operations-centre';
import { requireCapability } from '@/lib/auth/session';

import type { ColemanActionState } from '../action-state';
import { failureState, invalidInputState, parseChecked, parseRequiredNote, parseSeason } from '../form';

/**
 * The Coleman Medal Server Actions (AFLDB V2 Stage 5, plan D9; ADR 0006; V2-GAP-021).
 *
 * `compareColemanSeasonAction` is READ-ONLY (`data.awards.read`, so a plain Admin may run it): it
 * derives the season from the database and compares it with the stored Coleman `award_winners`
 * rows and the current publication. `publishColemanSeasonAction` writes (`data.awards.edit`, Super
 * Admin only): one append-only `derived_award_results` row through the season seal, as an audited
 * correction AND projects the derived winners into the canonical `award_winners` table in the same
 * transaction (ADR 0015). The compare action previews that projection read-only.
 *
 * The guard is the FIRST awaited statement of each action; the caller checks the capability again.
 * NO `revalidatePath` (it hangs the client from a Server Action): the result carries the
 * server-computed public `revalidatePaths`, and the CLIENT posts them to `/admin/awards/revalidate`
 * after the action succeeds, exactly as `src/app/admin/awards/submit-helper.ts` does.
 *
 * Form fields: `season` (four digits), `settled` (checkbox: the operator's attestation that every
 * promotion and settle for the season has concluded), and, for publish, `note` (the reason,
 * 20..2000 characters, recorded in the audited correction).
 */

export async function compareColemanSeasonAction(
  _previous: ColemanActionState,
  formData: FormData,
): Promise<ColemanActionState> {
  const admin = await requireCapability('data.awards.read');

  const season = parseSeason(formData.get('season'));
  if (!season.ok) return invalidInputState({ season: season.error });

  const result = await compareColemanSeason(admin, { season: season.value, settled: parseChecked(formData.get('settled')) });
  if (!result.ok) return failureState(result);
  return { ok: true, comparison: result.comparison };
}

export async function publishColemanSeasonAction(
  _previous: ColemanActionState,
  formData: FormData,
): Promise<ColemanActionState> {
  const admin = await requireCapability('data.awards.edit');

  const fieldErrors: Record<string, string> = {};
  const season = parseSeason(formData.get('season'));
  if (!season.ok) fieldErrors.season = season.error;
  const note = parseRequiredNote(formData.get('note'));
  if (!note.ok) fieldErrors.note = note.error;
  if (!season.ok || !note.ok) return invalidInputState(fieldErrors);

  const result = await publishColemanSeason(admin, {
    season: season.value,
    settled: parseChecked(formData.get('settled')),
    note: note.value,
  });
  if (!result.ok) return failureState(result);

  const { auditWarning } = result;
  const publication: ColemanPublicationResult = {
    outcome: result.outcome,
    id: result.id,
    supersededId: result.supersededId,
    season: result.season,
    methodVersion: result.methodVersion,
    derivationVersion: result.derivationVersion,
    inputChecksum: result.inputChecksum,
    winnerKeys: result.winnerKeys,
    evidenceRef: result.evidenceRef,
    projection: result.projection,
    revalidatePaths: result.revalidatePaths,
  };
  return {
    ok: true,
    message: publishMessage(publication),
    publication,
    revalidatePaths: result.revalidatePaths,
    ...(auditWarning === undefined ? {} : { auditWarning }),
  };
}

/** The operator-facing sentence for a successful publication (ledger outcome, then the winners table). */
function publishMessage(publication: ColemanPublicationResult): string {
  const { counts, provenanceOnly, alreadyProjected } = publication.projection;
  const ledger = publication.outcome === 'unchanged'
    ? 'The derivation ledger already matched this derivation.'
    : publication.outcome === 'superseded'
      ? 'Published. The previous ledger row for this season was superseded.'
      : 'Published.';
  const winners = alreadyProjected
    ? 'Nothing changed: the winners were already published from this derivation.'
    : provenanceOnly
      ? `The stored winners already matched, so no award_winners row changed; the provenance was recorded (${counts.retained} retained).`
      : `award_winners: ${counts.inserted} inserted, ${counts.updated} updated, ${counts.voided} voided, ${counts.retained} retained.`;
  return `${ledger} ${winners}`;
}
