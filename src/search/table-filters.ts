/**
 * Declarative filters for the tables on list pages.
 *
 * Every table on the site is a collection someone will want to narrow, and
 * before this each page grew its own ad-hoc pair of inputs. This module is
 * the one description of a filter: a page declares fields, `TableFilters`
 * renders them, `parseFilterValues` validates the URL, and the page maps
 * the result onto its own typed query options.
 *
 * Security model is the same one `advanced-spec.ts` states: user input
 * never becomes SQL. A field key is looked up in the page's own fixed list,
 * select values are checked against the allowlist the page supplied, and
 * numbers are clamped to the field's declared bounds. Values reach the
 * database only as bound query parameters.
 *
 * Shared by Server Components and the query layer, so it stays free of
 * server-only imports.
 */

import { clampBound, firstValue, invertedRangeError } from '@/lib/params';

export type SelectOption = { value: string; label: string };

type FieldBase = {
  key: string;
  label: string;
  /** Fieldset to render under. Fields with no group render ungrouped. */
  group?: string;
  help?: string;
};

/** A numeric `min`/`max` pair, read from `<key>_min` and `<key>_max`. */
export type RangeField = FieldBase & {
  kind: 'range';
  min: number;
  max: number;
};

export type TextField = FieldBase & {
  kind: 'text';
  placeholder?: string;
  maxLength?: number;
};

export type SelectField = FieldBase & {
  kind: 'select';
  options: SelectOption[];
  /** Label for the empty option. Omit to make the field mandatory-looking. */
  anyLabel?: string;
};

/** A `<select multiple>`; the URL carries the key repeated. */
export type MultiSelectField = FieldBase & {
  kind: 'multi';
  options: SelectOption[];
  max: number;
};

export type FilterField = RangeField | TextField | SelectField | MultiSelectField;

export type RangeValue = { min?: number; max?: number };

export type FilterValues = {
  range: Record<string, RangeValue>;
  text: Record<string, string>;
  select: Record<string, string>;
  multi: Record<string, string[]>;
  /** Ranges whose minimum exceeded their maximum, reported not applied. */
  errors: string[];
  /** How many filters are actually narrowing the table. */
  active: number;
};

export const MAX_TEXT_LENGTH = 100;

function all(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Read a URL query string into validated values.
 *
 * Out-of-range numbers are clamped and unknown select values are dropped
 * rather than erroring, so a hand-edited or stale link still renders a
 * sensible table. A minimum above its maximum is the one case reported: it
 * cannot be honoured and silently dropping it would show an unfiltered
 * table under a filter the reader believes is applied.
 */
export function parseFilterValues(
  fields: readonly FilterField[],
  params: Record<string, string | string[] | undefined>,
): FilterValues {
  const values: FilterValues = {
    range: {}, text: {}, select: {}, multi: {}, errors: [], active: 0,
  };

  for (const field of fields) {
    switch (field.kind) {
      case 'range': {
        const { value: min } = clampBound(
          firstValue(params[`${field.key}_min`]), field.min, field.max,
        );
        const { value: max } = clampBound(
          firstValue(params[`${field.key}_max`]), field.min, field.max,
        );
        if (min === undefined && max === undefined) break;
        if (min !== undefined && max !== undefined && min > max) {
          values.errors.push(invertedRangeError(field.label, min, max));
          break;
        }
        values.range[field.key] = { min, max };
        values.active += 1;
        break;
      }
      case 'text': {
        const raw = firstValue(params[field.key])?.trim() ?? '';
        if (!raw) break;
        values.text[field.key] = raw.slice(0, field.maxLength ?? MAX_TEXT_LENGTH);
        values.active += 1;
        break;
      }
      case 'select': {
        const raw = firstValue(params[field.key])?.trim() ?? '';
        if (!raw) break;
        if (!field.options.some((option) => option.value === raw)) break;
        values.select[field.key] = raw;
        values.active += 1;
        break;
      }
      case 'multi': {
        const allowed = all(params[field.key])
          .map((value) => value.trim())
          .filter((value) => field.options.some((option) => option.value === value))
          .slice(0, field.max);
        if (allowed.length === 0) break;
        values.multi[field.key] = allowed;
        values.active += 1;
        break;
      }
    }
  }

  return values;
}

/** The value a control should show: what ran, not what was typed. */
export function fieldValue(
  values: FilterValues,
  field: FilterField,
  bound?: 'min' | 'max',
): string {
  switch (field.kind) {
    case 'range': {
      const value = values.range[field.key]?.[bound ?? 'min'];
      return value === undefined ? '' : String(value);
    }
    case 'text': return values.text[field.key] ?? '';
    case 'select': return values.select[field.key] ?? '';
    case 'multi': return '';
  }
}

/**
 * Rebuild the query string, for pagination links and shareable URLs.
 *
 * Page is deliberately not carried: every caller either sets it itself or
 * means page one, and a filter change that kept the old page number would
 * land the reader past the end of a smaller result set.
 */
export function filterQueryParams(
  fields: readonly FilterField[],
  values: FilterValues,
): Record<string, string | string[] | undefined> {
  const params: Record<string, string | string[] | undefined> = {};
  for (const field of fields) {
    switch (field.kind) {
      case 'range': {
        const range = values.range[field.key];
        if (range?.min !== undefined) params[`${field.key}_min`] = String(range.min);
        if (range?.max !== undefined) params[`${field.key}_max`] = String(range.max);
        break;
      }
      case 'text':
        if (values.text[field.key]) params[field.key] = values.text[field.key];
        break;
      case 'select':
        if (values.select[field.key]) params[field.key] = values.select[field.key];
        break;
      case 'multi':
        if (values.multi[field.key]?.length) params[field.key] = values.multi[field.key];
        break;
    }
  }
  return params;
}

/**
 * Array-aware encoding, the one place a repeated parameter is written.
 *
 * A multi-select carries its key once per selected value, so anything
 * building a URL by hand risks keeping only the first — which turns a
 * two-club filter into a one-club filter the moment the reader re-sorts.
 */
export function toSearchParams(
  params: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) search.append(key, item);
    else search.set(key, value);
  }
  return search;
}

/**
 * The applied filters as a query string, plus whatever the caller adds.
 *
 * `extra` is where sort and page belong: `filterQueryParams` deliberately
 * omits both, and a caller that needs them should not rebuild the rest.
 */
export function filterSearchParams(
  fields: readonly FilterField[],
  values: FilterValues,
  extra: Record<string, string | string[] | undefined> = {},
): URLSearchParams {
  return toSearchParams({ ...filterQueryParams(fields, values), ...extra });
}

/**
 * "Games 100–200", "Games ≥ 100", "Games ≤ 200".
 *
 * Every filtered surface prints its ranges through this, so the summary
 * line above a table reads the same way whichever page produced it.
 */
export function describeRange(
  label: string,
  min: number | undefined,
  max: number | undefined,
): string {
  if (min !== undefined && max !== undefined) return `${label} ${min}–${max}`;
  if (min !== undefined) return `${label} ≥ ${min}`;
  return `${label} ≤ ${max}`;
}

/** One short phrase per applied filter, for the summary line above a table. */
export function describeFilters(
  fields: readonly FilterField[],
  values: FilterValues,
): string[] {
  const described: string[] = [];
  const labelFor = (field: SelectField | MultiSelectField, value: string) =>
    field.options.find((option) => option.value === value)?.label ?? value;

  for (const field of fields) {
    switch (field.kind) {
      case 'range': {
        const range = values.range[field.key];
        if (!range) break;
        described.push(describeRange(field.label, range.min, range.max));
        break;
      }
      case 'text':
        if (values.text[field.key]) {
          described.push(`${field.label}: “${values.text[field.key]}”`);
        }
        break;
      case 'select':
        if (values.select[field.key]) {
          described.push(`${field.label}: ${labelFor(field, values.select[field.key])}`);
        }
        break;
      case 'multi': {
        const selected = values.multi[field.key];
        if (selected?.length) {
          described.push(
            `${field.label}: ${selected.map((value) => labelFor(field, value)).join(', ')}`,
          );
        }
        break;
      }
    }
  }
  return described;
}

/** Options built from a plain list of strings, which most lookups are. */
export function optionsFrom(values: readonly string[]): SelectOption[] {
  return values.map((value) => ({ value, label: value }));
}

export function yearOptions(from: number, to: number): SelectOption[] {
  const options: SelectOption[] = [];
  for (let year = to; year >= from; year -= 1) {
    options.push({ value: String(year), label: String(year) });
  }
  return options;
}
