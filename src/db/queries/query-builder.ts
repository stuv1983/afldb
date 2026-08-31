import 'server-only';

import { sql } from '@/db/client';
import { escapeLike } from '@/lib/like';
import {
  OPERATORS_BY_KIND, QB_LIMITS, QUERYABLE_TABLES, domainColumns, relationshipForCard,
  type CardGroup, type CardSpec, type ColumnDef, type ConditionSpec, type QueryBuilderState,
  type RelationshipDef,
} from '@/search/query-builder-spec';

/**
 * Compile a validated query-builder specification to parameterised SQL
 * and run it.
 *
 * Runs through the same `sql` client advanced-search.ts and every public
 * page use -- the `afldb_app` role, read-only by database grant and (as
 * of migration 031) unable to even SELECT the auth/submission tables.
 * That gives this admin tool the same "even a compiler bug can only
 * read statistics" backstop the reference's read-only SQLite connection
 * gave query_builder.py, as an actual database privilege rather than an
 * application-level promise.
 *
 * `sql.unsafe` is used only for fragments that came from
 * QUERYABLE_TABLES/RELATIONSHIPS/OPERATORS_BY_KIND -- fixed catalogue
 * entries, never a request value -- exactly the rule advanced-search.ts
 * already follows. Every value (numbers, text, dates) is bound as a query
 * parameter, inside a related-domain subquery as much as outside it.
 *
 * ISSUE-115 -- multi-domain cards. Every card compiles to ONE scalar
 * boolean on the anchor row: an anchor-domain card is the pre-115
 * predicate through the unchanged path; a related-domain card is a
 * correlated `EXISTS` / `NOT EXISTS` over its relationship's subquery
 * (compileRelatedCard). Because the compiler NEVER adds a relation to the
 * anchor's FROM, the row set is exactly the anchor relation's rows,
 * multiplication is impossible, and no DISTINCT is required -- none may
 * be added. A DISTINCT appearing in this compiler in future is evidence
 * that the column-ownership invariant (runbook §3, §6.6) was broken.
 * Likewise no aggregate and no matched-row count (§6.7): V1 asks only
 * "is there such a row" / "is there no such row".
 *
 * No separate bound-parameter budget (the reference's ParamBag total):
 * QB_LIMITS already caps cards x conditions-per-card at 48, each
 * condition contributing at most two parameters, so the structural caps
 * enforced below already bound the total tightly enough that a second
 * counter would be ceremony, not protection.
 */

type SqlFragment = ReturnType<typeof sql>;

function coerceNumber(value: string | number, integer: boolean): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error('That value must be a number.');
  if (integer && !Number.isInteger(n)) throw new Error('That value must be a whole number.');
  return n;
}

function parseIsoDate(value: string | number): string {
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Dates must be entered as YYYY-MM-DD.');
  return text;
}

const DATE_OP_SQL: Record<string, string> = {
  on: '=', before: '<', after: '>', 'on or before': '<=', 'on or after': '>=',
};

/**
 * One condition -> one parameterised predicate, or null when the
 * condition is still mid-edit (a chosen column with no value yet) --
 * mirrors compile_condition in the reference: a half-built condition
 * filters nothing rather than erroring per keystroke.
 *
 * `columns` is the catalogue of the CARD's domain (domainColumns): the
 * anchor's own columns for an anchor-domain card, the relationship's
 * `r_`-aliased columns for a related-domain card. A column from any other
 * domain is therefore unknown here and rejected, whichever card it is in.
 */
function compileCondition(
  columns: Record<string, ColumnDef>, domainKey: string, spec: ConditionSpec,
): SqlFragment | null {
  const col = columns[spec.column];
  if (!col) throw new Error(`Unknown column "${spec.column}" for table "${domainKey}".`);
  const ops = OPERATORS_BY_KIND[col.kind];
  if (!ops.includes(spec.op)) {
    throw new Error(`"${spec.op}" is not a valid operator for ${col.label}.`);
  }
  const column = sql.unsafe(col.column);

  if (spec.op === 'is null') return sql`${column} IS NULL`;
  if (spec.op === 'is not null') return sql`${column} IS NOT NULL`;

  if (col.kind === 'boolean') {
    return spec.op === 'is true' ? sql`${column} IS TRUE` : sql`${column} IS FALSE`;
  }

  if (col.kind === 'integer' || col.kind === 'float') {
    const integer = col.kind === 'integer';
    if (spec.op === 'between') {
      if (spec.lo === undefined || spec.hi === undefined) return null;
      const lo = coerceNumber(spec.lo, integer);
      const hi = coerceNumber(spec.hi, integer);
      return sql`${column} BETWEEN ${Math.min(lo, hi)} AND ${Math.max(lo, hi)}`;
    }
    if (spec.value === undefined) return null;
    const value = coerceNumber(spec.value, integer);
    // spec.op is one of NUMERIC_OPS ('=', '!=', '>', '>=', '<', '<=') --
    // valid SQL operators verbatim, checked against that fixed list above.
    return sql`${column} ${sql.unsafe(spec.op)} ${value}`;
  }

  if (col.kind === 'date') {
    if (spec.op === 'between') {
      if (spec.lo === undefined || spec.hi === undefined) return null;
      const lo = parseIsoDate(spec.lo);
      const hi = parseIsoDate(spec.hi);
      const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
      return sql`${column} BETWEEN ${a} AND ${b}`;
    }
    if (spec.value === undefined) return null;
    const date = parseIsoDate(spec.value);
    const opSql = DATE_OP_SQL[spec.op];
    if (!opSql) throw new Error(`Unsupported date operator: ${spec.op}`);
    return sql`${column} ${sql.unsafe(opSql)} ${date}`;
  }

  // text
  if (spec.value === undefined) return null;
  const text = String(spec.value).slice(0, 500);
  if (spec.op === 'equals') return sql`${column} = ${text}`;
  if (spec.op === 'contains') return sql`${column} ILIKE ${`%${escapeLike(text)}%`} ESCAPE '\\'`;
  if (spec.op === 'starts with') return sql`${column} ILIKE ${`${escapeLike(text)}%`} ESCAPE '\\'`;
  if (spec.op === 'ends with') return sql`${column} ILIKE ${`%${escapeLike(text)}`} ESCAPE '\\'`;
  throw new Error(`Unsupported text operator: ${spec.op}`);
}

/**
 * One card's conditions AND/OR-ed together, parenthesised as a unit.
 *
 * `domainKey` is the anchor key for an anchor-domain card (the pre-115
 * path, unchanged) or the relationship key for a related-domain card, in
 * which case the predicate is built for use INSIDE that relationship's
 * correlated subquery -- `match` then applies within one related row.
 */
function compileCard(
  columns: Record<string, ColumnDef>, domainKey: string, card: CardSpec,
): SqlFragment | null {
  const parts = card.conditions
    .map((cond) => compileCondition(columns, domainKey, cond))
    .filter((f): f is SqlFragment => f !== null);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];

  let acc = parts[0];
  for (let i = 1; i < parts.length; i++) {
    acc = card.match === 'OR' ? sql`${acc} OR ${parts[i]}` : sql`${acc} AND ${parts[i]}`;
  }
  return sql`(${acc})`;
}

/**
 * A related-domain card -> one correlated `EXISTS` / `NOT EXISTS` on the
 * anchor row (runbook §6.1), the idiom advanced-search.ts already uses for
 * its club filter:
 *
 *   [NOT] EXISTS (SELECT 1 FROM <subqueryFrom> WHERE <correlation> [AND <cardPredicate>])
 *
 * `subqueryFrom` and `correlation` are fixed RELATIONSHIPS catalogue text
 * (`r_` aliases only, so nothing inside can shadow the anchor row); every
 * condition value is still a bound parameter. One rule for every
 * cardinality -- a 1:1 relationship is not special-cased as a join (§6.3).
 *
 * Unlike an anchor-domain card, an empty related card is NOT "filters
 * nothing": with no conditions it is the complete question "has at least
 * one related row" / "has no related row at all" (§6.2), which is exactly
 * what the missing-row QA cases need. Missing-row questions are always
 * `NOT EXISTS`, never a nullable LEFT JOIN ... IS NULL (§6.8).
 */
function compileRelatedCard(rel: RelationshipDef, card: CardSpec): SqlFragment {
  const predicate = compileCard(rel.columns, rel.key, card);
  const body = predicate === null
    ? sql`SELECT 1 FROM ${sql.unsafe(rel.subqueryFrom)} WHERE ${sql.unsafe(rel.correlation)}`
    : sql`SELECT 1 FROM ${sql.unsafe(rel.subqueryFrom)} WHERE ${sql.unsafe(rel.correlation)} AND ${predicate}`;
  return card.quantifier === 'none' ? sql`NOT EXISTS (${body})` : sql`EXISTS (${body})`;
}

/**
 * Anchor/related dispatch for one card, deciding which of the two
 * compilation paths applies. Fails closed, independently of parse-level
 * validation, on anything domainColumns/relationshipForCard cannot
 * resolve: an unknown domain, a domain unreachable from this anchor's
 * subjects, or a self-equivalent domain (T-C6, T-C12).
 *
 * A card with no `domain` (every card in a pre-115 token) or whose domain
 * IS the anchor provably takes the anchor path: it never consults the
 * relationship catalogue and its SQL is byte-identical to pre-115.
 */
function compileOneCard(anchorKey: string, card: CardSpec): SqlFragment | null {
  const isAnchorCard = card.domain === undefined || card.domain === anchorKey;
  if (isAnchorCard) {
    if (card.quantifier === 'none') {
      throw new Error('Only a related-domain card may ask for "no such row".');
    }
    const columns = domainColumns(anchorKey, undefined);
    if (!columns) throw new Error(`Unknown table: ${anchorKey}`);
    return compileCard(columns, anchorKey, card);
  }
  const rel = relationshipForCard(anchorKey, card.domain);
  if (!rel) {
    throw new Error(`Domain "${card.domain}" cannot be queried from "${anchorKey}".`);
  }
  return compileRelatedCard(rel, card);
}

/**
 * Every card, each joined to the accumulated result by its own AND/OR.
 *
 * The accumulator is parenthesised at every step, because the spec says a
 * card joins the ACCUMULATED result of those before it -- a left fold,
 * ((A op B) op C). Without the parentheses SQL's own precedence applies
 * instead, and cards "A, OR B, AND C" compile to `A OR B AND C`, which
 * PostgreSQL reads as `A OR (B AND C)`: a different question, silently
 * answered with different rows. The card itself needs no wrapping --
 * compileCard already parenthesises anything with more than one condition,
 * and a single condition is atomic.
 *
 * ISSUE-115 changes nothing here beyond dispatching each card on its
 * domain (compileOneCard): a related card is one scalar `[NOT] EXISTS`
 * boolean on the anchor row, so it sits in the operand position of the
 * identical left fold, and mixing domains changes nothing about the
 * fold, the FROM clause, the row count or the total (§6.5, §7).
 */
function compileCards(tableKey: string, cardGroups: CardGroup[]): SqlFragment {
  let relatedCards = 0;
  let acc: SqlFragment | null = null;
  for (const group of cardGroups) {
    if (group.card.conditions.length > QB_LIMITS.maxConditionsPerCard) {
      throw new Error(`A card may hold at most ${QB_LIMITS.maxConditionsPerCard} conditions.`);
    }
    if (group.card.domain !== undefined && group.card.domain !== tableKey) {
      relatedCards += 1;
      if (relatedCards > QB_LIMITS.maxRelatedCards) {
        throw new Error(`A query may hold at most ${QB_LIMITS.maxRelatedCards} related-domain cards.`);
      }
    }
    const compiled = compileOneCard(tableKey, group.card);
    if (!compiled) continue; // an empty/half-built ANCHOR card filters nothing (a related card is never null)
    acc = acc === null
      ? compiled
      : (group.join === 'OR' ? sql`(${acc}) OR ${compiled}` : sql`(${acc}) AND ${compiled}`);
  }
  return acc ?? sql`TRUE`;
}

export type QueryBuilderResult = {
  rows: Record<string, unknown>[];
  total: number;
  columns: string[];
};

export async function runQueryBuilder(state: QueryBuilderState): Promise<QueryBuilderResult> {
  const table = QUERYABLE_TABLES[state.table];
  if (!table) throw new Error(`Unknown table: ${state.table}`);
  if (state.cards.length > QB_LIMITS.maxCards) {
    throw new Error(`A query may hold at most ${QB_LIMITS.maxCards} cards.`);
  }

  const where = compileCards(state.table, state.cards);

  // Display columns and the sort expression come only from this table's
  // own catalogue entry -- safe to splice as one fixed fragment, the
  // same trust level as advanced-search.ts's `sql.unsafe(SORTS[...].sql)`.
  const selectList = table.displayColumns
    .map((key) => `${table.columns[key].column} AS "${key}"`)
    .join(', ');
  const sortColumn = (state.sort && table.columns[state.sort]?.column) || table.defaultSort;

  const page = Number.isSafeInteger(state.page) && state.page >= 1
    ? Math.min(state.page, QB_LIMITS.maxPage) : 1;
  const offset = (page - 1) * QB_LIMITS.defaultPageSize;

  const rows = await sql<(Record<string, unknown> & { __total: string })[]>`
    SELECT ${sql.unsafe(selectList)}, count(*) OVER () AS "__total"
      FROM ${sql.unsafe(table.from)}
     WHERE ${where}
     ORDER BY ${sql.unsafe(sortColumn)}
     LIMIT ${QB_LIMITS.defaultPageSize} OFFSET ${offset}
  `;

  const total = rows.length > 0 ? Number(rows[0].__total) : 0;
  return {
    rows: rows.map(({ __total: _total, ...rest }) => rest),
    total,
    columns: table.displayColumns,
  };
}
