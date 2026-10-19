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
 * correction. Neither touches `award_winners`.
 *
 * The guard is the FIRST awaited statement of each action; the caller checks the capability again.
 * NO `revalidatePath` (it hangs the client from a Server Action).
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
  };
  return {
    ok: true,
    message: result.outcome === 'unchanged'
      ? 'Nothing changed: the current publication already matches this derivation.'
      : result.outcome === 'superseded'
        ? 'Published. The previous publication for this season was superseded.'
        : 'Published.',
    publication,
    ...(auditWarning === undefined ? {} : { auditWarning }),
  };
}
