import type { Consequences } from '../consequences';

/**
 * The D9 action card: what a mutation will change, the affected season or records, the validation
 * state, whether it is reversible, the acting user and the resulting audit entries, shown BEFORE the
 * form is submitted (AFLDB V2 Stage 5, plan D9, ADR 0009; owner instruction "Each action must show").
 *
 * PURE and presentational: no hooks, no data access. It renders a {@link Consequences} value built
 * by `describeConsequences` (consequences.ts), so every sentence is testable without a browser and
 * a Client Component form can embed it.
 */
export function ActionConsequences({ consequences }: { consequences: Consequences }) {
  const c = consequences;
  return (
    <div className="notice" role="note" aria-label={`Consequences: ${c.title}`} data-consequences={c.kind}>
      <p style={{ margin: 0 }}><strong>Before you submit: {c.title}</strong></p>
      <dl className="audit-kv" style={{ margin: '0.6rem 0 0' }}>
        <dt>Will change</dt>
        <dd>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {c.changes.map((change) => <li key={change}>{change}</li>)}
          </ul>
        </dd>
        <dt>Affects</dt>
        <dd>{c.affected}</dd>
        <dt>Validation</dt>
        <dd>{c.validationState}</dd>
        <dt>Reversible</dt>
        <dd>
          <span className={c.reversible ? 'badge' : 'badge badge-warn'}>{c.reversible ? 'Reversible' : 'Not reversible'}</span>
          {' '}{c.reversibility}
        </dd>
        <dt>Acting user</dt>
        <dd>{c.actingUser}</dd>
        <dt>Audit entries</dt>
        <dd>
          {c.audit.durable}
          {' '}{c.audit.activity}
          {' '}
          <span className="mono">{c.audit.activityActions.join(' · ')}</span>
        </dd>
      </dl>
    </div>
  );
}
