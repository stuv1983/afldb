'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { saveDataEdit, type DataEditState } from '@/app/admin/data-editor/actions';
import { EDITABLE_ENTITIES, type EditGroup } from '@/lib/edit/spec';

const INITIAL: DataEditState = {};

/**
 * One field group of one row: current values pre-filled, a note box,
 * and a Save that reports exactly what changed. Groups are separate
 * forms on purpose — a coupled set (a date and its confidence, four
 * score components) saves together, and everything else saves alone.
 */
function GroupForm({
  entityKey,
  rowId,
  group,
  values,
}: {
  entityKey: string;
  rowId: number;
  group: EditGroup;
  values: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(saveDataEdit, INITIAL);
  const entity = EDITABLE_ENTITIES[entityKey];

  return (
    <form
      action={formAction}
      style={{
        border: '1px solid var(--rule, rgba(128,128,128,0.3))',
        borderRadius: '6px',
        padding: '0.9rem 1rem',
        display: 'grid',
        gap: '0.6rem',
      }}
    >
      <input type="hidden" name="entity" value={entityKey} />
      <input type="hidden" name="rowId" value={rowId} />
      <input type="hidden" name="group" value={group.key} />

      <strong>{group.label}</strong>
      {group.help && <span className="muted" style={{ fontSize: '0.85rem' }}>{group.help}</span>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
        {group.fields.map((fieldKey) => {
          const field = entity.fields[fieldKey];
          const id = `${group.key}-${fieldKey}-${rowId}`;
          return (
            <label key={fieldKey} htmlFor={id} style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
              {field.label}
              {field.kind === 'enum' ? (
                <select id={id} name={fieldKey} defaultValue={values[fieldKey]}>
                  {field.nullable && <option value="">—</option>}
                  {field.enumValues?.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              ) : (
                <input
                  id={id}
                  name={fieldKey}
                  defaultValue={values[fieldKey]}
                  type={field.kind === 'integer' ? 'number' : field.kind === 'date' ? 'date' : 'text'}
                  min={field.min}
                  max={field.max}
                  maxLength={field.maxLength}
                  placeholder={field.nullable ? 'not recorded' : undefined}
                />
              )}
              {field.help && (
                <span className="muted" style={{ fontSize: '0.78rem', maxWidth: '28rem' }}>{field.help}</span>
              )}
            </label>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <input
          type="text"
          name="note"
          maxLength={2000}
          placeholder="Source / how this was verified (optional)"
          style={{ fontSize: '0.85rem', flexGrow: 1, maxWidth: '30rem' }}
        />
        <button type="submit" disabled={pending}>Save</button>
      </div>

      {state.error && <span className="muted" style={{ fontSize: '0.85rem' }}>{state.error}</span>}
      {state.message && <span style={{ fontSize: '0.85rem' }}>{state.message}</span>}
      {state.staleDerived && state.staleDerived.length > 0 && (
        <span className="badge badge-warn" style={{ justifySelf: 'start' }}>
          Derived tables now stale — run rebuild_derived.py ({state.staleDerived.join(', ')})
        </span>
      )}
    </form>
  );
}

export function EditorForm({
  entityKey,
  rowId,
  title,
  values,
}: {
  entityKey: string;
  rowId: number;
  title: string;
  values: Record<string, string>;
}) {
  const entity = EDITABLE_ENTITIES[entityKey];
  return (
    <section className="section" style={{ display: 'grid', gap: '0.9rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {entityKey === 'matches' && (
          <Link
            href={`/admin/data-editor?mode=match-sheet&id=${rowId}`}
            className="btn btn-primary"
            style={{ fontSize: '0.9rem' }}
          >
            Open Match Sheet Editor (Lineup & Stats) →
          </Link>
        )}
      </div>
      {Object.values(entity.groups).map((group) => (
        <GroupForm
          key={group.key}
          entityKey={entityKey}
          rowId={rowId}
          group={group}
          values={values}
        />
      ))}
    </section>
  );
}
