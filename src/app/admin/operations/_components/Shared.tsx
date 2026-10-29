import type { ReactNode } from 'react';

import type { OperationsActionState } from '../action-state';
import type { Loaded } from '../views';

/**
 * Presentational building blocks shared by every operations-centre section (AFLDB V2 Stage 5,
 * plan D9). Props in, markup out: no hooks, no `server-only`, no data access, so each section can be
 * rendered with `react-dom/server` from SYNTHETIC props (tests/fixtures/v2/operations-centre).
 * Class names are the existing `src/styles/globals.css` ones; this adds no CSS.
 */

/** A failed read, inline: the rest of the page is unaffected. */
export function LoadFailure({ what, error, code }: { what: string; error: string; code?: string }) {
  return (
    <p className="notice" role="alert" data-load-failure="true">
      <strong>{what} could not be loaded.</strong> {error}
      {code !== undefined && <> <span className="mono">({code})</span></>}
    </p>
  );
}

/** One titled section whose body is built from a read that may have failed. */
export function LoadedSection<T>({
  id, title, intro, what, loaded, children,
}: {
  id: string;
  title: string;
  intro?: ReactNode;
  what: string;
  loaded: Loaded<T>;
  children: (value: T) => ReactNode;
}) {
  return (
    <section className="section" id={id} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{title}</h2>
      {intro !== undefined && <p className="section-note">{intro}</p>}
      {loaded.ok
        ? children(loaded.value)
        : <LoadFailure what={what} error={loaded.error} code={loaded.code} />}
    </section>
  );
}

/** A section with no read behind it. */
export function PlainSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="section" id={id} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{title}</h2>
      {children}
    </section>
  );
}

/** The result of the last submit: outcome, codes, validation issues and any audit warning. */
export function ActionOutcome({ state }: { state: OperationsActionState }) {
  const hasContent = state.ok === true || state.error !== undefined || state.message !== undefined
    || state.auditWarning !== undefined;
  return (
    <div aria-live="polite" data-action-outcome={state.ok === true ? 'ok' : state.error !== undefined ? 'refused' : 'idle'}>
      {hasContent && state.ok === true && (
        <p className="notice" role="status">{state.message ?? 'Done.'}</p>
      )}
      {state.error !== undefined && (
        <p className="notice" role="alert">
          {state.error}
          {state.code !== undefined && <> <span className="mono">({state.code}{state.derivationCode === undefined ? '' : `: ${state.derivationCode}`})</span></>}
        </p>
      )}
      {state.issues !== undefined && state.issues.length > 0 && (
        <ul className="ruled-list" aria-label="Validation issues">
          {state.issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`}>
              <span className={issue.severity === 'error' ? 'badge badge-danger' : 'badge badge-warn'}>{issue.severity}</span>{' '}
              <span className="mono">{issue.code}</span>
              {issue.field !== undefined && <> on <span className="mono">{issue.field}</span></>}: {issue.message}
            </li>
          ))}
        </ul>
      )}
      {state.auditWarning !== undefined && (
        <p className="notice" role="alert">
          <strong>Audit warning.</strong> {state.auditWarning}
        </p>
      )}
    </div>
  );
}

/** The error text under one form field, if the last submit refused it. */
export function FieldError({ state, name }: { state: OperationsActionState; name: string }) {
  const message = state.fieldErrors?.[name];
  if (message === undefined) return null;
  // A span, not a paragraph: fields sit inside paragraphs, and a <p> may not nest in a <p>.
  return <span className="muted" role="alert" style={{ display: 'block', margin: '0.25rem 0 0', fontSize: '0.8125rem' }} data-field-error={name}>{message}</span>;
}
