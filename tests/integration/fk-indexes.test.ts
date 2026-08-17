/**
 * Every foreign key is either indexed or deliberately exempt.
 *
 * PostgreSQL indexes a PRIMARY KEY and a UNIQUE constraint for you and
 * never a foreign key's referencing column. Migration 041 swept the schema
 * on that basis; migration 047 then added two FK columns and neither was
 * covered, because it landed after the sweep rather than before it, and
 * migration 050 caught them up by hand. That is twice the same miss found
 * by reading rather than by failing, and nothing in the suite would have
 * caught a third.
 *
 * This is that check. It interrogates pg_catalog rather than asserting a
 * list of index names, so it covers indexes nobody thought to write down
 * and fails on a foreign key nobody thought to index -- including one
 * added by a migration written years from now.
 *
 * Two things make an index count, and both matter:
 *
 *   * The FK's referencing columns must be the LEADING columns of the
 *     index. A composite index serves a leading-column lookup, which is
 *     why captaincies.club_id needs nothing of its own (041 says so in
 *     its own comment), but the same index does nothing for a column
 *     sitting second.
 *
 *   * A partial index counts only when the referential probe implies its
 *     predicate. The probe behind a parent-side delete is `WHERE col = $1`
 *     with no mention of anything else, so `WHERE col IS NOT NULL` is
 *     usable and `WHERE link_status = 'unique'` is not -- the distinction
 *     migration 044 section 3 exists to fix, here enforced rather than
 *     re-argued. `WHERE is_recorded` on stat_availability's season index
 *     is the same shape and is correctly not counted below.
 *
 * @see src/db/migrations/041_fk_indexes_and_dead_indexes.sql
 * @see src/db/migrations/044_schema_integrity.sql section 3 and 6(b)
 * @see src/db/migrations/050_nl_search_fk_indexes.sql
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';

afterAll(async () => {
  await sql.end();
});

/**
 * Parent tables whose children need no foreign-key index, keyed by the
 * reason -- which is always a property of the PARENT, because the cost an
 * FK index avoids is the scan of the child that a parent-side delete
 * forces. No row-by-row delete, no scan, no index worth its writes.
 *
 * Registering a parent here exempts every foreign key pointing at it,
 * present and future. That is deliberate: "nothing deletes a season" is
 * true of the seasons table itself, not of each table that happens to
 * reference it, and re-litigating it per child would be noise. A foreign
 * key to any OTHER table must be indexed, which is what makes a new
 * reference to auth_users or nl_search_log fail here rather than ship.
 *
 * Every claim below was checked against the importers rather than assumed:
 * `truncate()` in tools/migration/common.py issues TRUNCATE ... CASCADE,
 * which empties children wholesale and performs no per-row referential
 * check at all.
 */
const DELETE_FREE_PARENTS: Record<string, string> = {
  // Migration 044 section 6(b) states this outright for the provenance
  // quartet: import_batches and sources are append-only, and no read path
  // filters 694K player_match_stats rows by batch. That comment names the
  // condition under which it expires -- "an index becomes necessary the day
  // old batches are pruned" -- so a pruning job must delete this entry as
  // well as write the DELETE, and this test is what will remind it to.
  import_batches: 'append-only; nothing deletes a batch (migration 044 §6(b))',
  sources: 'append-only; nothing deletes a source (migration 044 §6(b))',

  // 130 rows, one per season, rebuilt by truncate(pg, "seasons") in
  // import_legacy_afl.py. Thirteen foreign keys point here -- every
  // first_season/last_season span in the schema -- and indexing all of
  // them would be thirteen indexes maintained for a delete that has never
  // run and would be a data-loss incident if it did.
  seasons: 'reloaded by TRUNCATE ... CASCADE; a season is never deleted row-by-row',

  // truncate(pg, "clubs", "club_aliases"). The lineage model is why no
  // club row is ever deleted individually: a rename becomes a second
  // identity under the same organization_id and a merger is recorded as a
  // link, so club identities accumulate rather than disappear.
  clubs: 'reloaded by TRUNCATE ... CASCADE; identities accumulate, never deleted',

  // truncate(pg, "matches", "match_period_scores"). player_clubs holds the
  // only two references (first_match_id, last_match_id) and both are
  // derived columns the importer rewrites in the same run.
  matches: 'reloaded by TRUNCATE ... CASCADE; no per-row match delete exists',

  // The one parent that IS deleted row-by-row: import_legacy_afl.py runs
  // `DELETE FROM club_organizations` on a legacy reload, and both
  // relations FKs are ON DELETE CASCADE (migration 021). It is exempt
  // anyway because the line immediately above it empties the child first
  // -- `DELETE FROM club_organization_relations`, then the parent -- so
  // the cascade fires against an already-empty table. This one rests on
  // the order of two statements rather than on a property of the data;
  // if that ordering ever changes, index to_organization_id instead of
  // editing this note.
  club_organizations: 'importer empties club_organization_relations before deleting it',
};

/** One foreign key and whether a usable index covers it. */
type ForeignKey = {
  child: string;
  parent: string;
  cols: string;
  covered: boolean;
};

async function foreignKeys(): Promise<ForeignKey[]> {
  return sql<ForeignKey[]>`
    WITH fk AS (
      SELECT con.oid AS conoid,
             rel.relname AS child,
             ref.relname AS parent,
             con.conrelid,
             con.conkey
        FROM pg_constraint con
        JOIN pg_class rel   ON rel.oid = con.conrelid
        JOIN pg_class ref   ON ref.oid = con.confrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
       WHERE con.contype = 'f'
         AND n.nspname = 'public'
         AND rel.relkind IN ('r', 'p')
    ),
    fkcols AS (
      -- cols is for the failure message; notnull_pred is the exact text
      -- pg_get_expr renders for a WHERE col IS NOT NULL predicate, which
      -- is how a usable partial index is recognised below.
      SELECT f.conoid,
             string_agg(a.attname, ', ' ORDER BY x.ord) AS cols,
             '(' || string_agg(a.attname || ' IS NOT NULL', ') AND (' ORDER BY x.ord)
                 || ')' AS notnull_pred
        FROM fk f
       CROSS JOIN LATERAL unnest(f.conkey) WITH ORDINALITY AS x(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = f.conrelid AND a.attnum = x.attnum
       GROUP BY f.conoid
    )
    SELECT f.child, f.parent, fc.cols,
           EXISTS (
             SELECT 1
               FROM pg_index i
              WHERE i.indrelid = f.conrelid
                AND i.indisvalid AND i.indislive
                -- Key columns only: an INCLUDE payload is not searchable.
                AND i.indnkeyatts >= cardinality(f.conkey)
                -- The FK columns are the leading key columns, in any order:
                -- the probe is equality on every one of them, so order
                -- between them does not matter. indkey is an int2vector,
                -- rendered as a space-separated list to be sliced.
                AND (SELECT array_agg(k ORDER BY k)
                       FROM unnest((string_to_array(i.indkey::text, ' ')::smallint[])
                                   [1:cardinality(f.conkey)]) k)
                  = (SELECT array_agg(k ORDER BY k) FROM unnest(f.conkey) k)
                AND (i.indpred IS NULL
                     OR pg_get_expr(i.indpred, i.indrelid) = fc.notnull_pred)
           ) AS covered
      FROM fk f
      JOIN fkcols fc ON fc.conoid = f.conoid
     ORDER BY f.child, fc.cols
  `;
}

describe('foreign-key index coverage', () => {
  it('indexes every foreign key whose parent can be deleted from', async () => {
    const fks = await foreignKeys();

    // Without this the assertion below passes green on a database where
    // the query matched nothing at all -- a stale test database, or a
    // catalogue query broken by a PostgreSQL upgrade.
    expect(
      fks.length,
      'no foreign keys found in `public`; run npm run db:migrate:test',
    ).toBeGreaterThan(50);

    const unindexed = fks
      .filter((fk) => !fk.covered && !(fk.parent in DELETE_FREE_PARENTS))
      .map((fk) => `${fk.child}(${fk.cols}) -> ${fk.parent}`);

    expect(
      unindexed,
      'These foreign keys have no index the referential check can use, so '
      + 'deleting a parent row sequentially scans the child. Add one in a '
      + 'migration -- `CREATE INDEX ... WHERE col IS NOT NULL`, the shape '
      + 'migration 041 established -- or, if the parent is genuinely never '
      + 'deleted from, add it to DELETE_FREE_PARENTS with the reason.',
    ).toEqual([]);
  });

  it('keeps the exemption list free of entries that no longer apply', async () => {
    // The counterweight, and the same drift check privileges.test.ts runs
    // against its registries: an exemption that stops being load-bearing
    // is a claim nobody is checking any more. If every foreign key to a
    // parent has since been indexed, or the table itself is gone, the
    // entry should go rather than sit here implying a decision.
    const fks = await foreignKeys();
    const stale = Object.keys(DELETE_FREE_PARENTS)
      .filter((parent) => !fks.some((fk) => fk.parent === parent && !fk.covered));

    expect(
      stale,
      'DELETE_FREE_PARENTS names parents that no longer have an unindexed '
      + 'foreign key pointing at them. Remove them: the exemption is spent.',
    ).toEqual([]);
  });
});
