/**
 * AFLDB-ISSUE-105 — the driver-boundary type for `import_batches.id`.
 *
 * `import_batches.id` is `bigint ... GENERATED ALWAYS AS IDENTITY`
 * (migration 001). postgres.js renders `int8` as its decimal TEXT rather than
 * risk a lossy `Number`, so an uncast `RETURNING id` is a JavaScript **string**
 * at runtime. Several call sites declared it `number`, which was a lie the
 * compiler could not catch: the value was only ever passed back into SQL, so
 * nothing misbehaved, but any arithmetic, strict comparison or number-keyed
 * lookup on it would have failed silently. The ISSUE-099 integration suite hit
 * exactly that and worked around it with `Number(result.batchId)`.
 *
 * The convention is therefore: **an import batch id is an opaque identifier,
 * carried as the decimal text PostgreSQL emitted.** It is never narrowed to a
 * JavaScript number and the column is never cast to `int` in SQL — a bigint
 * identity column outlives `Number.MAX_SAFE_INTEGER`, and `int` would trade a
 * typing bug for an overflow. Nothing in this repository does arithmetic on a
 * batch id; it is inserted, compared for equality and printed.
 *
 * This is deliberately a local convention for one column family, not a
 * repository-wide bigint abstraction. It lives beside `jsonb.ts` for the same
 * reason that module exists: a driver-representation rule belongs in one
 * unit-testable place rather than being rediscovered per call site.
 */

declare const IMPORT_BATCH_ID: unique symbol;

/**
 * An `import_batches.id`, exactly as postgres.js delivers it.
 *
 * Branded so a bare `string` — a source key, a family name, a scope key —
 * cannot drift into a batch-id parameter, and so a `number` cannot either.
 * Values are produced only by {@link asImportBatchId}, at the one boundary
 * where the driver hands the id back.
 */
export type ImportBatchId = string & { readonly [IMPORT_BATCH_ID]: true };

/** Decimal text with no sign, no leading zero and no exponent. */
const DECIMAL_IDENTITY = /^[1-9][0-9]*$/;

/**
 * Decode one `RETURNING id` from `import_batches`.
 *
 * Fail-closed on anything that is not the driver's decimal text. That is the
 * point: if the client is ever configured to parse `int8` (postgres.js
 * `types: { bigint: ... }`), or a caller reintroduces an `::int` cast, or a
 * `Number()` slips in, this throws at the boundary instead of letting a
 * silently different representation travel on.
 *
 * Identity values start at 1, so a leading zero or a `0` is rejected too:
 * PostgreSQL never emits either for `int8`, and tolerating them would allow
 * two spellings of one id to compare unequal.
 */
export function asImportBatchId(value: unknown): ImportBatchId {
  if (typeof value !== 'string' || !DECIMAL_IDENTITY.test(value)) {
    // Quoted only for a string, so leading/trailing space is visible. Anything
    // else goes through String(): JSON.stringify throws on the bigint a
    // `types: { bigint: ... }` client would hand back, and this must report
    // that case rather than fail while describing it.
    const shown = typeof value === 'string' ? JSON.stringify(value) : String(value);
    throw new Error(
      'import_batches.id must arrive as the decimal text postgres.js returns for bigint; '
      + `got ${typeof value} ${shown}. Do not cast the column to int and do `
      + 'not narrow it with Number(): it is a bigint identity column and both are lossy.',
    );
  }
  return value as ImportBatchId;
}
