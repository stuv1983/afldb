'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  OPERATORS_BY_KIND, QB_LIMITS, QUERYABLE_TABLES, TABLE_KEYS,
  changeAnchor, describeCard, domainColumns, emptyCard, emptyState,
  relationshipForCard, relationshipsForAnchor, serializeQueryState, setCardDomain, setCardQuantifier,
  type CardGroup, type CardQuantifier, type ColumnDef, type ColumnKind, type ConditionSpec,
  type QueryBuilderState,
} from '@/search/query-builder-spec';

/**
 * The card-based builder: pick what the results are (the anchor), then
 * within each card pick the domain it filters -- the anchor's own row or
 * a related domain reachable from it -- and add column/operator/value
 * conditions. Conditions inside a card combine with that card's own ALL
 * (AND) / ANY (OR) rule; a related card also says whether it matches when
 * there is at least one such related row or none at all; and each card
 * after the first says how it joins the cards before it. All state lives
 * here until "Search" pushes it into the URL as one `q` token, so a
 * shared link reproduces exactly the query that was built. The state
 * transitions themselves are the pure functions in query-builder-spec.
 */
export function QueryBuilderForm({ initialState }: { initialState: QueryBuilderState }) {
  const router = useRouter();
  const [state, setState] = useState<QueryBuilderState>(initialState);

  function changeTable(key: string) {
    setState((prev) => changeAnchor(prev, key));
  }

  function addCondition(cardIndex: number, condition: ConditionSpec) {
    setState((prev) => {
      const cards = prev.cards.map((group, i): CardGroup => (
        i !== cardIndex ? group : {
          ...group,
          card: { ...group.card, conditions: [...group.card.conditions, condition] },
        }
      ));
      return { ...prev, cards };
    });
  }

  function removeCondition(cardIndex: number, condIndex: number) {
    setState((prev) => ({
      ...prev,
      cards: prev.cards.map((group, i): CardGroup => (
        i !== cardIndex ? group : {
          ...group,
          card: { ...group.card, conditions: group.card.conditions.filter((_, j) => j !== condIndex) },
        }
      )),
    }));
  }

  function setCardMatch(cardIndex: number, match: 'AND' | 'OR') {
    setState((prev) => ({
      ...prev,
      cards: prev.cards.map((group, i): CardGroup => (
        i !== cardIndex ? group : { ...group, card: { ...group.card, match } }
      )),
    }));
  }

  function setCardJoin(cardIndex: number, join: 'AND' | 'OR') {
    setState((prev) => ({
      ...prev,
      cards: prev.cards.map((group, i): CardGroup => (i !== cardIndex ? group : { ...group, join })),
    }));
  }

  function setDomain(cardIndex: number, domain: string) {
    setState((prev) => setCardDomain(prev, cardIndex, domain));
  }

  function setQuantifier(cardIndex: number, quantifier: CardQuantifier) {
    setState((prev) => setCardQuantifier(prev, cardIndex, quantifier));
  }

  function addCard() {
    if (state.cards.length >= QB_LIMITS.maxCards) return;
    setState((prev) => ({ ...prev, cards: [...prev.cards, emptyCard()] }));
  }

  function removeCard(cardIndex: number) {
    setState((prev) => (
      prev.cards.length <= 1 ? prev : { ...prev, cards: prev.cards.filter((_, i) => i !== cardIndex) }
    ));
  }

  function runSearch() {
    router.push(`/admin/query-builder?q=${serializeQueryState({ ...state, page: 1 })}`);
  }

  function reset() {
    setState(emptyState(state.table));
    router.push('/admin/query-builder');
  }

  // A related card with no conditions is a complete question ("has / has no
  // such row"), so it counts as something to search for; an anchor card
  // with no conditions filters nothing, as before.
  const canSearch = state.cards.some((g) => g.card.conditions.length > 0 || g.card.domain !== undefined);
  const relatedCount = state.cards.filter((g) => g.card.domain !== undefined).length;

  return (
    <div style={{ display: 'grid', gap: '0.85rem' }}>
      <label style={{ maxWidth: '20rem' }}>
        Results are
        <select value={state.table} onChange={(e) => changeTable(e.target.value)}>
          {TABLE_KEYS.map((key) => (
            <option key={key} value={key}>{QUERYABLE_TABLES[key].label}</option>
          ))}
        </select>
      </label>
      <p className="section-note" style={{ margin: 0 }}>
        Each result row is one {QUERYABLE_TABLES[state.table].label} row, showing that table&apos;s
        columns. Changing this starts a new question.
      </p>

      {state.cards.map((group, i) => (
        <Card
          key={i}
          index={i}
          group={group}
          anchorKey={state.table}
          isFirst={i === 0}
          canRemove={state.cards.length > 1}
          canGoRelated={group.card.domain !== undefined || relatedCount < QB_LIMITS.maxRelatedCards}
          onAddCondition={(condition) => addCondition(i, condition)}
          onRemoveCondition={(condIndex) => removeCondition(i, condIndex)}
          onSetMatch={(match) => setCardMatch(i, match)}
          onSetJoin={(join) => setCardJoin(i, join)}
          onSetDomain={(domain) => setDomain(i, domain)}
          onSetQuantifier={(quantifier) => setQuantifier(i, quantifier)}
          onRemoveCard={() => removeCard(i)}
        />
      ))}

      <div>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={addCard}
          disabled={state.cards.length >= QB_LIMITS.maxCards}
        >
          + Add card
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button className="btn" type="button" onClick={runSearch} disabled={!canSearch}>
          Search
        </button>
        <button className="btn btn-secondary" type="button" onClick={reset}>
          Reset
        </button>
      </div>
    </div>
  );
}

function Card({
  index, group, anchorKey, isFirst, canRemove, canGoRelated,
  onAddCondition, onRemoveCondition, onSetMatch, onSetJoin, onSetDomain, onSetQuantifier, onRemoveCard,
}: {
  index: number;
  group: CardGroup;
  anchorKey: string;
  isFirst: boolean;
  canRemove: boolean;
  /** False when the related-card limit is already used up by OTHER cards. */
  canGoRelated: boolean;
  onAddCondition: (condition: ConditionSpec) => void;
  onRemoveCondition: (condIndex: number) => void;
  onSetMatch: (match: 'AND' | 'OR') => void;
  onSetJoin: (join: 'AND' | 'OR') => void;
  onSetDomain: (domain: string) => void;
  onSetQuantifier: (quantifier: CardQuantifier) => void;
  onRemoveCard: () => void;
}) {
  const anchor = QUERYABLE_TABLES[anchorKey];
  const rel = relationshipForCard(anchorKey, group.card.domain);
  const related = relationshipsForAnchor(anchorKey);
  // Same helper the compiler resolves against; falls back to the anchor's
  // own columns only for a domain the helper rejects, which the UI cannot build.
  const columns = domainColumns(anchorKey, group.card.domain) ?? anchor.columns;
  const columnKeys = Object.keys(columns);
  const [column, setColumn] = useState(columnKeys[0]);
  const col = columns[column] ?? columns[columnKeys[0]];
  const ops = OPERATORS_BY_KIND[col.kind];
  const [op, setOp] = useState<string>(ops[0]);
  const [value, setValue] = useState('');
  const [lo, setLo] = useState('');
  const [hi, setHi] = useState('');

  function pickColumn(key: string) {
    setColumn(key);
    const kind = columns[key].kind;
    setOp(OPERATORS_BY_KIND[kind][0]);
    setValue(''); setLo(''); setHi('');
  }

  /**
   * Changing the domain clears the card's conditions (setCardDomain does
   * that) AND resets this component's local column/operator/value state,
   * which otherwise would still name a column of the old domain.
   */
  function pickDomain(domain: string) {
    onSetDomain(domain);
    const nextColumns = domainColumns(anchorKey, domain === anchorKey ? undefined : domain) ?? anchor.columns;
    const firstKey = Object.keys(nextColumns)[0];
    setColumn(firstKey);
    setOp(OPERATORS_BY_KIND[nextColumns[firstKey].kind][0]);
    setValue(''); setLo(''); setHi('');
  }

  function add() {
    const needsValue = !['is null', 'is not null', 'is true', 'is false'].includes(op);
    const isBetween = op === 'between';
    if (needsValue && !isBetween && value.trim() === '') return;
    if (isBetween && (lo.trim() === '' || hi.trim() === '')) return;

    const condition: ConditionSpec = { column, op };
    if (isBetween) { condition.lo = coerceInput(col.kind, lo); condition.hi = coerceInput(col.kind, hi); }
    else if (needsValue) { condition.value = coerceInput(col.kind, value); }

    onAddCondition(condition);
    setValue(''); setLo(''); setHi('');
  }

  return (
    <fieldset style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
      padding: '0.75rem 1rem 1rem',
    }}>
      <legend style={{ fontWeight: 650, fontSize: '0.85rem', padding: '0 0.35rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        {!isFirst && (
          <select
            aria-label={`How card ${index + 1} joins the cards before it`}
            value={group.join}
            onChange={(e) => onSetJoin(e.target.value as 'AND' | 'OR')}
          >
            <option value="AND">AND</option>
            <option value="OR">OR</option>
          </select>
        )}
        <span>{describeCard(anchorKey, group.card, index)}</span>
        {canRemove && (
          <button className="btn btn-secondary" type="button" onClick={onRemoveCard} style={{ padding: '0.1rem 0.5rem' }}>
            Remove card
          </button>
        )}
      </legend>

      <label style={{ display: 'block', marginBottom: '0.5rem', maxWidth: '20rem' }}>
        Filter on
        <select value={group.card.domain ?? anchorKey} onChange={(e) => pickDomain(e.target.value)}>
          <optgroup label="This row">
            <option value={anchorKey}>This {anchor.label} row</option>
          </optgroup>
          {related.length > 0 && (
            <optgroup label="Related">
              {related.map((r) => (
                <option key={r.key} value={r.key} disabled={!canGoRelated}>{r.label}</option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      {!canGoRelated && (
        <p className="section-note" style={{ margin: '0 0 0.5rem' }}>
          At most {QB_LIMITS.maxRelatedCards} cards can filter on a related domain.
        </p>
      )}

      {rel && (
        <>
          <p className="section-note" style={{ margin: '0 0 0.5rem' }}>
            {rel.hint} Conditions below apply within one related row; use a second card for a
            different related row. A condition on a value that is not recorded never matches, so
            &ldquo;there is no such row&rdquo; includes rows where that value is missing — use
            &ldquo;is null&rdquo; / &ldquo;is not null&rdquo; to ask about missing values directly.
          </p>
          <label style={{ display: 'block', marginBottom: '0.5rem', maxWidth: '20rem' }}>
            This card matches when
            <select
              value={group.card.quantifier ?? 'any'}
              onChange={(e) => onSetQuantifier(e.target.value as CardQuantifier)}
            >
              <option value="any">there is at least one such row</option>
              <option value="none">there is no such row</option>
            </select>
          </label>
        </>
      )}

      {group.card.conditions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.6rem' }}>
          {group.card.conditions.map((condition, i) => (
            <span key={i} className="badge" style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center' }}>
              {describeCondition(columns, condition)}
              <button
                type="button"
                aria-label={`Remove condition: ${describeCondition(columns, condition)}`}
                onClick={() => onRemoveCondition(i)}
                style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {group.card.conditions.length > 1 && (
        <label style={{ display: 'block', marginBottom: '0.5rem', maxWidth: '16rem' }}>
          Match
          <select value={group.card.match} onChange={(e) => onSetMatch(e.target.value as 'AND' | 'OR')}>
            <option value="AND">ALL of these (AND)</option>
            <option value="OR">ANY of these (OR)</option>
          </select>
        </label>
      )}

      {group.card.conditions.length < QB_LIMITS.maxConditionsPerCard && (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>
            Column
            <select value={column} onChange={(e) => pickColumn(e.target.value)}>
              {columnKeys.map((key) => (
                <option key={key} value={key}>{columns[key].label}</option>
              ))}
            </select>
          </label>
          <label>
            Operator
            <select value={op} onChange={(e) => setOp(e.target.value)}>
              {ops.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <ValueInputs kind={col.kind} op={op} value={value} lo={lo} hi={hi}
            onValue={setValue} onLo={setLo} onHi={setHi} />
          <button className="btn btn-secondary" type="button" onClick={add}>
            Add condition
          </button>
        </div>
      )}
    </fieldset>
  );
}

function ValueInputs({
  kind, op, value, lo, hi, onValue, onLo, onHi,
}: {
  kind: ColumnKind; op: string; value: string; lo: string; hi: string;
  onValue: (v: string) => void; onLo: (v: string) => void; onHi: (v: string) => void;
}) {
  if (op === 'is null' || op === 'is not null' || kind === 'boolean') return null;

  const inputType = kind === 'date' ? 'date' : (kind === 'integer' || kind === 'float') ? 'number' : 'text';

  if (op === 'between') {
    return (
      <>
        <label>
          From
          <input type={inputType} value={lo} onChange={(e) => onLo(e.target.value)} />
        </label>
        <label>
          To
          <input type={inputType} value={hi} onChange={(e) => onHi(e.target.value)} />
        </label>
      </>
    );
  }

  return (
    <label>
      Value
      <input type={inputType} value={value} onChange={(e) => onValue(e.target.value)} />
    </label>
  );
}

function coerceInput(kind: ColumnKind, raw: string): string | number {
  if (kind === 'integer' || kind === 'float') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  return raw;
}

function describeCondition(columns: Record<string, ColumnDef>, condition: ConditionSpec): string {
  const col = columns[condition.column];
  const label = col?.label ?? condition.column;
  switch (condition.op) {
    case 'is null': return `${label} is missing`;
    case 'is not null': return `${label} is present`;
    case 'is true': return `${label} is true`;
    case 'is false': return `${label} is false`;
    case 'between': return `${label} between ${condition.lo} and ${condition.hi}`;
    default: return `${label} ${condition.op} ${condition.value}`;
  }
}
