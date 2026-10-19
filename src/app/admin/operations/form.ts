import type { AwardProposalFileDefaults, AwardProposalFileFormat, ProposalSourceKind } from '@afldb/admin';

import type { OperationFailure } from '@/lib/admin/operations-centre';

import type { OperationsActionState } from './action-state';

/**
 * Strict FormData parsing for the operations-centre Server Actions (AFLDB V2 Stage 5, plan D9).
 *
 * Pure SHAPE checks only — integers, lengths, enumerations. Everything that depends on the
 * database or the seal (does the proposal exist, is the season sealed, is the note long enough for
 * a sealed season) is decided by the service inside its transaction and comes back as a typed code.
 *
 * Lives beside the actions, not in them: a `'use server'` module may export only async functions,
 * so synchronous helpers cannot be exported from `actions.ts` and still be unit-tested. This module
 * carries no `server-only` and no value import of a server module (the type imports are erased), so
 * a Client Component may import it.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_NOTE = 2000;
/** The largest offline proposal file accepted (characters of text). The parser also caps rows. */
export const MAX_PROPOSAL_FILE_CHARS = 1_048_576;
const MAX_URL = 2000;

const fail = <T>(error: string): Parsed<T> => ({ ok: false, error });

function text(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : '';
}

/** A positive whole number written as digits only (no sign, no decimal, no exponent). */
export function parseProposalId(value: FormDataEntryValue | null): Parsed<number> {
  const raw = text(value).trim();
  if (!/^\d{1,9}$/.test(raw) || Number(raw) <= 0) return fail('A proposal id is a positive whole number.');
  return { ok: true, value: Number(raw) };
}

/** A four-digit season, 1897 to 2100 (the range the services accept). */
export function parseSeason(value: FormDataEntryValue | null): Parsed<number> {
  const raw = text(value).trim();
  if (!/^\d{4}$/.test(raw)) return fail('Enter the season as a four-digit year.');
  const season = Number(raw);
  if (season < 1897 || season > 2100) return fail('The season must be from 1897 to 2100.');
  return { ok: true, value: season };
}

/** An optional free-text note, trimmed; blank is `null`; longer than 2000 characters is refused. */
export function parseOptionalNote(value: FormDataEntryValue | null): Parsed<string | null> {
  const raw = text(value).trim();
  if (raw.length > MAX_NOTE) return fail(`The note is longer than ${MAX_NOTE} characters.`);
  return { ok: true, value: raw === '' ? null : raw };
}

/** A required note, trimmed, 1 to 2000 characters. Length floors for a seal or a rejection are the service's. */
export function parseRequiredNote(value: FormDataEntryValue | null): Parsed<string> {
  const parsed = parseOptionalNote(value);
  if (!parsed.ok) return parsed;
  if (parsed.value === null) return fail('A note is required.');
  return { ok: true, value: parsed.value };
}

/** An HTML checkbox posts nothing when clear and `on` / `true` / `1` when set. Anything else is false. */
export function parseChecked(value: FormDataEntryValue | null): boolean {
  const raw = text(value);
  return raw === 'on' || raw === 'true' || raw === '1';
}

export function parseFileFormat(value: FormDataEntryValue | null): Parsed<AwardProposalFileFormat> {
  const raw = text(value);
  return raw === 'json' || raw === 'csv' ? { ok: true, value: raw } : fail('The file format must be json or csv.');
}

/** A file may claim only these two kinds; `manual_entry` belongs to the editor (curated-awards-file.ts). */
export function parseFileSourceKind(value: FormDataEntryValue | null): Parsed<ProposalSourceKind | null> {
  const raw = text(value);
  if (raw === '') return { ok: true, value: null };
  return raw === 'offline_file' || raw === 'wikipedia_offline_file'
    ? { ok: true, value: raw }
    : fail('The source kind must be offline_file or wikipedia_offline_file.');
}

/** An optional real calendar date written YYYY-MM-DD. */
export function parseOptionalDate(value: FormDataEntryValue | null): Parsed<string | null> {
  const raw = text(value).trim();
  if (raw === '') return { ok: true, value: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return fail('Enter the date as YYYY-MM-DD.');
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? { ok: true, value: raw } : fail('That is not a real date.');
}

function optionalShort(value: FormDataEntryValue | null, max: number, label: string): Parsed<string | null> {
  const raw = text(value).trim();
  if (raw.length > max) return fail(`${label} is longer than ${max} characters.`);
  return { ok: true, value: raw === '' ? null : raw };
}

export type CreateFormInput = {
  text: string;
  format: AwardProposalFileFormat;
  defaults: AwardProposalFileDefaults;
  decisionNote: string | null;
};

/**
 * The create form: exactly ONE of a `file` upload or pasted `text`, a `format`, optional file-level
 * defaults (`sourceKind`, `sourceUrl`, `citation`, `acquiredOn`) and an optional `decisionNote`.
 * Field errors are keyed by the form field name.
 */
export async function parseCreateForm(
  formData: FormData,
): Promise<{ ok: true; value: CreateFormInput } | { ok: false; fieldErrors: Record<string, string> }> {
  const fieldErrors: Record<string, string> = {};

  const format = parseFileFormat(formData.get('format'));
  if (!format.ok) fieldErrors.format = format.error;

  const upload = formData.get('file');
  const pasted = text(formData.get('text'));
  const hasUpload = typeof upload === 'object' && upload !== null && upload.size > 0;
  const hasPasted = pasted.trim() !== '';
  let body = '';
  if (hasUpload && hasPasted) {
    fieldErrors.file = 'Provide either a file or pasted text, not both.';
  } else if (!hasUpload && !hasPasted) {
    fieldErrors.file = 'Provide a proposal file or paste its text.';
  } else if (hasUpload) {
    const file = upload as File;
    if (file.size > MAX_PROPOSAL_FILE_CHARS) fieldErrors.file = 'The file is larger than 1 MiB.';
    else body = await file.text();
  } else {
    body = pasted;
  }
  if (body.length > MAX_PROPOSAL_FILE_CHARS) fieldErrors.file = 'The file is larger than 1 MiB.';

  const sourceKind = parseFileSourceKind(formData.get('sourceKind'));
  if (!sourceKind.ok) fieldErrors.sourceKind = sourceKind.error;
  const sourceUrl = optionalShort(formData.get('sourceUrl'), MAX_URL, 'The source URL');
  if (!sourceUrl.ok) fieldErrors.sourceUrl = sourceUrl.error;
  const citation = optionalShort(formData.get('citation'), MAX_NOTE, 'The citation');
  if (!citation.ok) fieldErrors.citation = citation.error;
  const acquiredOn = parseOptionalDate(formData.get('acquiredOn'));
  if (!acquiredOn.ok) fieldErrors.acquiredOn = acquiredOn.error;
  const decisionNote = parseOptionalNote(formData.get('decisionNote'));
  if (!decisionNote.ok) fieldErrors.decisionNote = decisionNote.error;

  if (Object.keys(fieldErrors).length > 0
    || !format.ok || !sourceKind.ok || !sourceUrl.ok || !citation.ok || !acquiredOn.ok || !decisionNote.ok) {
    return { ok: false, fieldErrors };
  }
  const defaults: AwardProposalFileDefaults = {
    ...(sourceKind.value === null ? {} : { sourceKind: sourceKind.value }),
    ...(sourceUrl.value === null ? {} : { sourceUrl: sourceUrl.value }),
    ...(citation.value === null ? {} : { citation: citation.value }),
    ...(acquiredOn.value === null ? {} : { acquiredOn: acquiredOn.value }),
  };
  return { ok: true, value: { text: body, format: format.value, defaults, decisionNote: decisionNote.value } };
}

/** A typed refusal, as the state `useActionState` renders. Field errors are keyed by form field name. */
export function failureState(failure: OperationFailure): OperationsActionState {
  const fieldErrors: Record<string, string> = {};
  if (failure.code === 'note_required' || failure.code === 'season_sealed_correction_invalid') {
    fieldErrors.decisionNote = failure.error;
  }
  if (failure.code === 'correction_invalid') fieldErrors.note = failure.error;
  if (failure.code === 'settled_required') fieldErrors.settled = failure.error;
  return {
    error: failure.error,
    code: failure.code,
    ...(failure.derivationCode === undefined ? {} : { derivationCode: failure.derivationCode }),
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
    ...(failure.issues === undefined ? {} : { issues: failure.issues }),
    ...(failure.auditWarning === undefined ? {} : { auditWarning: failure.auditWarning }),
  };
}

/** A refusal raised by the action's own parsing, before any service is called. */
export function invalidInputState(fieldErrors: Record<string, string>): OperationsActionState {
  return { error: 'Check the form and try again.', code: 'invalid_input', fieldErrors };
}
