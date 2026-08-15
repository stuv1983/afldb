import Link from 'next/link';

import {
  type FilterField,
  type FilterValues,
  type SelectOption,
  fieldValue,
} from '@/search/table-filters';

/**
 * The advanced-search panel that belongs to one table.
 *
 * Rendered inside that table's `CollapsibleTable`, so it is a `<details>`
 * within a `<details>`: opening a table reveals its filters, and the
 * filters themselves stay folded away until someone wants them. It starts
 * open only when a filter is already applied, so arriving on a shared link
 * shows why the table is narrowed without the reader hunting for it.
 *
 * A plain GET form, which is what makes every filtered table a shareable
 * URL and keeps this a Server Component. There is no Apply-on-change
 * behaviour to lose without JavaScript.
 */
export function TableFilters({
  action,
  fields,
  values,
  title = 'Advanced search',
  groups,
  sort,
  hidden,
  submitLabel = 'Apply filters',
  defaultOpen,
}: {
  action: string;
  fields: readonly FilterField[];
  values: FilterValues;
  title?: string;
  /** Fieldset legends, keyed by the `group` a field declares. */
  groups?: Record<string, string>;
  sort?: { name: string; label: string; value: string; options: SelectOption[] };
  /**
   * Parameters the form must carry through, such as a search sentinel or,
   * where two panels share one URL, the other panel's applied filters —
   * a GET form submits only its own inputs, so anything not repeated here
   * is dropped from the query string when this panel is applied.
   */
  hidden?: Record<string, string | string[] | undefined>;
  submitLabel?: string;
  defaultOpen?: boolean;
}) {
  const ungrouped = fields.filter((field) => !field.group);
  const groupKeys: string[] = [];
  for (const field of fields) {
    if (field.group && !groupKeys.includes(field.group)) groupKeys.push(field.group);
  }

  const open = defaultOpen ?? values.active > 0;
  const note = values.active === 0
    ? 'All rows'
    : `${values.active} filter${values.active === 1 ? '' : 's'} applied`;

  return (
    <details className="filter-details" open={open}>
      <summary>
        <span className="filter-details-title">{title}</span>
        <span className="filter-details-note">{note}</span>
      </summary>

      <form method="get" action={action}>
        {Object.entries(hidden ?? {}).flatMap(([name, value]) => {
          if (value === undefined) return [];
          const items = Array.isArray(value) ? value : [value];
          return items.map((item, i) => (
            <input key={`${name}-${i}`} type="hidden" name={name} value={item} />
          ));
        })}

        {ungrouped.length > 0 && (
          <div className="filter-grid">
            {ungrouped.map((field) => <Field key={field.key} field={field} values={values} />)}
          </div>
        )}

        {groupKeys.map((group) => (
          <fieldset key={group} className="filter-group">
            <legend>{groups?.[group] ?? group}</legend>
            <div className="filter-grid">
              {fields
                .filter((field) => field.group === group)
                .map((field) => <Field key={field.key} field={field} values={values} />)}
            </div>
          </fieldset>
        ))}

        {sort && (
          <div className="filter-grid">
            <div>
              <label htmlFor={`${action}-${sort.name}`}>{sort.label}</label>
              <select id={`${action}-${sort.name}`} name={sort.name} defaultValue={sort.value}>
                {sort.options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="filter-actions">
          <button className="btn" type="submit">{submitLabel}</button>
          <Link className="btn btn-secondary" href={action}>Reset</Link>
        </div>
      </form>
    </details>
  );
}

function Field({ field, values }: { field: FilterField; values: FilterValues }) {
  const help = field.help && <div className="filter-help">{field.help}</div>;

  if (field.kind === 'range') {
    return (
      <div>
        <label htmlFor={`${field.key}_min`}>{field.label}</label>
        <div className="filter-range">
          <input
            id={`${field.key}_min`}
            name={`${field.key}_min`}
            type="number"
            inputMode="numeric"
            step={1}
            placeholder="min"
            min={field.min}
            max={field.max}
            defaultValue={fieldValue(values, field, 'min')}
            aria-label={`${field.label} minimum`}
          />
          <input
            id={`${field.key}_max`}
            name={`${field.key}_max`}
            type="number"
            inputMode="numeric"
            step={1}
            placeholder="max"
            min={field.min}
            max={field.max}
            defaultValue={fieldValue(values, field, 'max')}
            aria-label={`${field.label} maximum`}
          />
        </div>
        {help}
      </div>
    );
  }

  if (field.kind === 'text') {
    return (
      <div>
        <label htmlFor={field.key}>{field.label}</label>
        <input
          id={field.key}
          name={field.key}
          type="search"
          placeholder={field.placeholder}
          maxLength={field.maxLength ?? 100}
          defaultValue={fieldValue(values, field)}
        />
        {help}
      </div>
    );
  }

  if (field.kind === 'select') {
    return (
      <div>
        <label htmlFor={field.key}>{field.label}</label>
        <select id={field.key} name={field.key} defaultValue={fieldValue(values, field)}>
          <option value="">{field.anyLabel ?? 'Any'}</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {help}
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={field.key}>{field.label}</label>
      <select
        id={field.key}
        name={field.key}
        multiple
        size={6}
        defaultValue={values.multi[field.key] ?? []}
      >
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {help ?? (
        <div className="filter-help">
          Select up to {field.max}. Leave empty for any.
        </div>
      )}
    </div>
  );
}
