'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  OPERATORS_BY_KIND, QB_LIMITS, QUERYABLE_TABLES, TABLE_KEYS,
  emptyState, serializeQueryState,
  type CardGroup, type ColumnKind, type ConditionSpec, type QueryBuilderState, type TableDef,
} from '@/search/query-builder-spec';

/**
 * The card-based builder: pick a table, then within each card pick a
 * column, set its operator and value, and add it -- conditions inside a
 * card combine with that card's own ALL (AND) / ANY (OR) rule, and each
 * card after the first says how it joins the cards before it. All state
 * lives here until "Search" pushes it into the URL as one `q` token, so
 * a shared link reproduces exactly the query that was built.
 */
export function QueryBuilderForm({ initialState }: { initialState: QueryBuilderState }) {
  const router = useRouter();
  const [state, setState] = useState<QueryBuilderState>(initialState);
  const table = QUERYABLE_TABLES[state.table];

  function changeTable(key: string) {
    setState(emptyState(key));
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

  function addCard() {
    if (state.cards.length >= QB_LIMITS.maxCards) return;
    setState((prev) => ({
      ...prev,
      cards: [...prev.cards, { join: 'AND', card: { match: 'AND', conditions: [] } }],
    }));
  }

  function removeCard(cardIndex: number) {
    setState((prev) => (
      prev.cards.length <= 1 ? prev : { ...prev, cards: prev.cards.filter((_, i) => i !== cardIndex) }
    ));
  }

  function runSearch() {
    // eslint-disable-next-line no-console -- temporary diagnostic, removed before merge
    console.log('DIAG runSearch state', JSON.stringify(state));
    router.push(`/admin/query-builder?q=${serializeQueryState({ ...state, page: 1 })}`);
  }

  function reset() {
    setState(emptyState(state.table));
    router.push('/admin/query-builder');
  }

  const canSearch = state.cards.some((g) => g.card.conditions.length > 0);

  return (
    <div style={{ display: 'grid', gap: '0.85rem' }}>
      <label style={{ maxWidth: '20rem' }}>
        Table
        <select value={state.table} onChange={(e) => changeTable(e.target.value)}>
          {TABLE_KEYS.map((key) => (
            <option key={key} value={key}>{QUERYABLE_TABLES[key].label}</option>
          ))}
        </select>
      </label>

      {state.cards.map((group, i) => (
        <Card
          key={i}
          index={i}
          group={group}
          table={table}
          isFirst={i === 0}
          canRemove={state.cards.length > 1}
          onAddCondition={(condition) => addCondition(i, condition)}
          onRemoveCondition={(condIndex) => removeCondition(i, condIndex)}
          onSetMatch={(match) => setCardMatch(i, match)}
          onSetJoin={(join) => setCardJoin(i, join)}
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
  index, group, table, isFirst, canRemove,
  onAddCondition, onRemoveCondition, onSetMatch, onSetJoin, onRemoveCard,
}: {
  index: number;
  group: CardGroup;
  table: TableDef;
  isFirst: boolean;
  canRemove: boolean;
  onAddCondition: (condition: ConditionSpec) => void;
  onRemoveCondition: (condIndex: number) => void;
  onSetMatch: (match: 'AND' | 'OR') => void;
  onSetJoin: (join: 'AND' | 'OR') => void;
  onRemoveCard: () => void;
}) {
  const columnKeys = Object.keys(table.columns);
  const [column, setColumn] = useState(columnKeys[0]);
  const col = table.columns[column] ?? table.columns[columnKeys[0]];
  const ops = OPERATORS_BY_KIND[col.kind];
  const [op, setOp] = useState<string>(ops[0]);
  const [value, setValue] = useState('');
  const [lo, setLo] = useState('');
  const [hi, setHi] = useState('');

  function pickColumn(key: string) {
    setColumn(key);
    const kind = table.columns[key].kind;
    setOp(OPERATORS_BY_KIND[kind][0]);
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
        <span>Card {index + 1}</span>
        {canRemove && (
          <button className="btn btn-secondary" type="button" onClick={onRemoveCard} style={{ padding: '0.1rem 0.5rem' }}>
            Remove card
          </button>
        )}
      </legend>

      {group.card.conditions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.6rem' }}>
          {group.card.conditions.map((condition, i) => (
            <span key={i} className="badge" style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center' }}>
              {describeCondition(table, condition)}
              <button
                type="button"
                aria-label={`Remove condition: ${describeCondition(table, condition)}`}
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
                <option key={key} value={key}>{table.columns[key].label}</option>
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

function describeCondition(table: TableDef, condition: ConditionSpec): string {
  const col = table.columns[condition.column];
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
