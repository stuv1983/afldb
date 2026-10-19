'use server';

import {
  approveCurated,
  createCuratedFromFile,
  rejectCurated,
  validateCurated,
} from '@/lib/admin/operations-centre';
import { requireCapability } from '@/lib/auth/session';

import type { CuratedActionState } from '../action-state';
import {
  failureState,
  invalidInputState,
  parseCreateForm,
  parseOptionalNote,
  parseProposalId,
} from '../form';

/**
 * The curated-award Server Actions (AFLDB V2 Stage 5, plan D9; ADR 0008 "What Stage 5 must wire").
 *
 * Each action asserts `data.awards.edit` (Super Admin only) as its FIRST awaited statement — a
 * hidden button is furniture, a direct POST reaches that line either way (tests/auth.test.ts holds
 * the guard-first contract). The decision is then made by one operations-centre caller
 * (`src/lib/admin/operations-centre.ts`), which checks the capability again, runs the service in one
 * transaction and writes the best-effort activity-trail row.
 *
 * NO `revalidatePath` here: it hangs the client from inside a Server Action. Nothing on these pages
 * is cached; the client refreshes the route after a successful action.
 *
 * FormData in, a serialisable {@link CuratedActionState} out (`useActionState` shape).
 */

/** The proposal id and optional decision note every decision form posts. */
function decisionFields(formData: FormData):
{ ok: true; proposalId: number; decisionNote: string | null } | { ok: false; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  const proposalId = parseProposalId(formData.get('proposalId'));
  if (!proposalId.ok) fieldErrors.proposalId = proposalId.error;
  const decisionNote = parseOptionalNote(formData.get('decisionNote'));
  if (!decisionNote.ok) fieldErrors.decisionNote = decisionNote.error;
  if (!proposalId.ok || !decisionNote.ok) return { ok: false, fieldErrors };
  return { ok: true, proposalId: proposalId.value, decisionNote: decisionNote.value };
}

export async function createCuratedProposalsAction(
  _previous: CuratedActionState,
  formData: FormData,
): Promise<CuratedActionState> {
  const admin = await requireCapability('data.awards.edit');

  const parsed = await parseCreateForm(formData);
  if (!parsed.ok) return invalidInputState(parsed.fieldErrors);

  const result = await createCuratedFromFile(admin, parsed.value);
  if (!result.ok) return failureState(result);
  return {
    ok: true,
    message: `Created ${result.count} proposal${result.count === 1 ? '' : 's'}. Nothing was validated or approved.`,
    proposals: result.proposals,
    ...(result.auditWarning === undefined ? {} : { auditWarning: result.auditWarning }),
  };
}

export async function validateCuratedProposalAction(
  _previous: CuratedActionState,
  formData: FormData,
): Promise<CuratedActionState> {
  const admin = await requireCapability('data.awards.edit');

  const fields = decisionFields(formData);
  if (!fields.ok) return invalidInputState(fields.fieldErrors);

  const result = await validateCurated(admin, { proposalId: fields.proposalId, decisionNote: fields.decisionNote });
  if (!result.ok) return failureState(result);
  return {
    ok: true,
    message: result.validation === 'validated'
      ? 'The proposal validated. It can now be approved.'
      : 'The proposal did not validate. Review the issues, then revise or reject it.',
    proposal: result.proposal,
    validation: result.validation,
    ...(result.auditWarning === undefined ? {} : { auditWarning: result.auditWarning }),
  };
}

export async function approveCuratedProposalAction(
  _previous: CuratedActionState,
  formData: FormData,
): Promise<CuratedActionState> {
  const admin = await requireCapability('data.awards.edit');

  const fields = decisionFields(formData);
  if (!fields.ok) return invalidInputState(fields.fieldErrors);

  const result = await approveCurated(admin, { proposalId: fields.proposalId, decisionNote: fields.decisionNote });
  if (!result.ok) return failureState(result);
  return {
    ok: true,
    message: result.sealedSeason
      ? 'Approved as an audited correction of a sealed season. The award winner now exists.'
      : 'Approved. The award winner now exists.',
    proposal: result.proposal,
    entityKey: result.entityKey,
    sealedSeason: result.sealedSeason,
    ...(result.auditWarning === undefined ? {} : { auditWarning: result.auditWarning }),
  };
}

export async function rejectCuratedProposalAction(
  _previous: CuratedActionState,
  formData: FormData,
): Promise<CuratedActionState> {
  const admin = await requireCapability('data.awards.edit');

  const fields = decisionFields(formData);
  if (!fields.ok) return invalidInputState(fields.fieldErrors);

  const result = await rejectCurated(admin, { proposalId: fields.proposalId, decisionNote: fields.decisionNote });
  if (!result.ok) return failureState(result);
  return {
    ok: true,
    message: 'Rejected. The reason is kept in the decision ledger.',
    proposal: result.proposal,
    ...(result.auditWarning === undefined ? {} : { auditWarning: result.auditWarning }),
  };
}
