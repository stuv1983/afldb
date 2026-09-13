'use client';

import { useState } from 'react';

/**
 * The dirty-field tracking every awards correction panel shares
 * (AFLDB-ISSUE-165 §6.5).
 *
 * WHY THE PANEL TRACKS WHAT CHANGED, rather than the action comparing against
 * a fresh read. A correction to a source-owned row is stored as a
 * `data_overrides` DELTA, and key presence is its semantics: an absent key
 * leaves the source value alone, an explicit null clears it (§6.2). So "which
 * fields did the administrator actually edit" has to be answered by the thing
 * that watched them edit it. An action that instead diffed the submission
 * against a re-read would freeze whatever an importer had changed in between
 * — turning an unrelated concurrent reload into a permanent override.
 *
 * Everything is carried as a string or a boolean, exactly as a form field
 * carries it, so "unchanged" is a plain identity comparison against the value
 * the page rendered and never a parse-then-compare that could call `1.50` and
 * `1.5` different facts.
 */
export type CorrectionValue = string | boolean;

export type CorrectionDraft<T extends Record<string, CorrectionValue>> = {
  values: T;
  set: <K extends keyof T>(key: K, value: T[K]) => void;
  /** The keys whose current value differs from the one the page rendered. */
  changed: string[];
  reset: () => void;
};

export function useCorrectionDraft<T extends Record<string, CorrectionValue>>(
  initial: T,
): CorrectionDraft<T> {
  const [values, setValues] = useState<T>(initial);
  return {
    values,
    set: (key, value) => setValues((current) => ({ ...current, [key]: value })),
    changed: Object.keys(initial).filter((key) => values[key] !== initial[key]),
    reset: () => setValues(initial),
  };
}

/** A text value as the form holds it: null and undefined both read as empty. */
export function asText(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * The correction submission: the compare-and-swap pair, the changed-field
 * list, and ONLY the changed fields themselves.
 *
 * An unchecked checkbox posts the empty string rather than being omitted,
 * because for a changed boolean "off" is the new value, not an absence.
 */
export function correctionFormData<T extends Record<string, CorrectionValue>>(input: {
  rowId: number;
  expectedUpdatedAt: string;
  values: T;
  changed: string[];
  adminNote?: string;
}): FormData {
  const data = new FormData();
  data.set('rowId', String(input.rowId));
  data.set('expectedUpdatedAt', input.expectedUpdatedAt);
  data.set('changed', input.changed.join(','));
  for (const key of input.changed) {
    const value = input.values[key];
    data.set(key, typeof value === 'boolean' ? (value ? 'on' : '') : value);
  }
  if (input.adminNote) data.set('adminNote', input.adminNote);
  return data;
}
