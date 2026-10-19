import { BROWNLOW_ELIGIBILITY_VERDICTS, type BrownlowEligibilityVerdict } from '@afldb/derived';

import type { OperationFailure } from '@/lib/admin/operations-centre';

import { failureState, type Parsed } from '../form';

import type { BrownlowEligibilityActionState } from './action-state';

/**
 * Strict FormData parsing for the Brownlow eligibility decision (AFLDB V2 Launch F F-D).
 *
 * Pure SHAPE checks only. Whether the player exists, holds a durable identity, polled votes, whether
 * the decision is stale and whether the season is sealed are decided by the service inside its
 * transaction and come back as typed codes. Lives beside the action, not in it: a `'use server'`
 * module may export only async functions, so synchronous helpers cannot be exported from
 * `actions.ts` and still be unit-tested. No `server-only` and no value import of a server module.
 */

export const CITATION_MAX_LENGTH = 2000;
/** Mirrors `BROWNLOW_DECISION_NOTE_MIN_LENGTH` / `_MAX_LENGTH` (src/db/queries/brownlow-eligibility.ts); drift-tested. */
export const DECISION_NOTE_MIN_LENGTH = 20;
export const DECISION_NOTE_MAX_LENGTH = 2000;

const fail = <T>(error: string): Parsed<T> => ({ ok: false, error });

function text(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : '';
}

/** A positive whole number written as digits only. */
export function parseBrownlowPlayerId(value: FormDataEntryValue | null): Parsed<number> {
  const raw = text(value).trim();
  if (!/^\d{1,9}$/.test(raw) || Number(raw) <= 0) return fail('A player id is a positive whole number.');
  return { ok: true, value: Number(raw) };
}

export function parseBrownlowVerdict(value: FormDataEntryValue | null): Parsed<BrownlowEligibilityVerdict> {
  const raw = text(value);
  return (BROWNLOW_ELIGIBILITY_VERDICTS as readonly string[]).includes(raw)
    ? { ok: true, value: raw as BrownlowEligibilityVerdict }
    : fail('Choose whether the player was eligible or ineligible.');
}

export function parseBrownlowCitation(value: FormDataEntryValue | null): Parsed<string> {
  const raw = text(value).trim();
  if (raw === '') return fail('Cite the source of the ruling: a URL or a reference.');
  if (raw.length > CITATION_MAX_LENGTH) return fail(`The citation is longer than ${CITATION_MAX_LENGTH} characters.`);
  return { ok: true, value: raw };
}

export function parseBrownlowDecisionNote(value: FormDataEntryValue | null): Parsed<string> {
  const raw = text(value).trim();
  if (raw.length < DECISION_NOTE_MIN_LENGTH) {
    return fail(`Write at least ${DECISION_NOTE_MIN_LENGTH} characters explaining the ruling.`);
  }
  if (raw.length > DECISION_NOTE_MAX_LENGTH) return fail(`The note is longer than ${DECISION_NOTE_MAX_LENGTH} characters.`);
  return { ok: true, value: raw };
}

/** The decision the administrator saw as current: blank means none; digits mean that decision id. */
export function parseExpectedDecisionId(value: FormDataEntryValue | null): Parsed<number | null> {
  const raw = text(value).trim();
  if (raw === '') return { ok: true, value: null };
  if (!/^\d{1,9}$/.test(raw) || Number(raw) <= 0) return fail('The expected decision id is invalid; reload the page.');
  return { ok: true, value: Number(raw) };
}

/** A typed refusal as the state `useActionState` renders, with the Brownlow field mapping and the player echoed. */
export function brownlowFailureState(failure: OperationFailure, playerId: number): BrownlowEligibilityActionState {
  const base = failureState(failure);
  const fieldErrors: Record<string, string> = { ...(base.fieldErrors ?? {}) };
  if (failure.code === 'citation_required') fieldErrors.citation = failure.error;
  if (failure.code === 'note_invalid' || failure.code === 'correction_invalid') fieldErrors.note = failure.error;
  return {
    ...base,
    playerId,
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
  };
}
