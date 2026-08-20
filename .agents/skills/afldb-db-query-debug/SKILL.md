---
name: afldb-db-query-debug
description: Diagnose and fix AFLDB PostgreSQL query-layer defects in `src/db/queries`, parameterised SQL, filtering, grouping, aggregation, joins, ordering, pagination, record leaderboards, or database-backed application logic. Use when the database contains the expected data but the application query returns wrong, missing, duplicated, unstable, or slow results.
---

# AFLDB PostgreSQL Query Debugging

Treat PostgreSQL query logic and application semantics as separate from migration/import logic.

## Guardrails

- Work only in the local working copy.
- Inspect before editing.
- Do not run Git commands unless explicitly requested.
- Keep production read-only and do not use production owner/import credentials.
- Do not modify `tools/migration/**` or any `*.py` file unless explicitly requested.
- Do not apply schema migrations unless the user explicitly asks for schema work.
- Keep SQL parameterised; never interpolate user input into SQL text.

## Establish ground truth

1. Read the caller and the query implementation.
2. Identify the expected row grain:
   - player;
   - player-season;
   - player-match;
   - club;
   - club-season;
   - match;
   - team-match;
   - award/draft/honour row.
3. Write or inspect a minimal SQL query that answers the concrete failing example.
4. Compare:
   - authoritative base rows;
   - intermediate joins/CTEs;
   - final query output;
   - application transformation/rendering.

Do not change SQL until the first stage where the result diverges is identified.

## High-risk SQL patterns

Check specifically for:

- one-to-many joins multiplying aggregates;
- filtering after aggregation when it belongs before, or vice versa;
- `HAVING` versus `WHERE` mistakes;
- `COUNT(*)` versus counting a nullable/meaningful column;
- left joins accidentally turned into inner joins by `WHERE`;
- club organisation versus historical club identity confusion;
- season/round/finals predicates applied to the wrong relation;
- home/away orientation causing duplicated or missing team-match rows;
- ambiguous `OR` precedence;
- ties lost through `LIMIT 1`;
- unstable results because `ORDER BY` is incomplete;
- pagination before de-duplication;
- text aliases or `unaccent`/`pg_trgm` matching broadening the candidate set unexpectedly.

## AFLDB statistical invariants

Preserve these rules:

- `NULL` means not recorded; it is not zero.
- Brownlow season/career totals come from the authoritative season-level source, not incomplete player-match votes.
- Historical club identities remain historically explicit; do not rewrite them into modern identities.
- Stable numeric player IDs own player identity; names do not.
- Tied records include every holder sharing the value.

## Patch and test

- Prefer a local query correction over downstream filtering in TypeScript.
- Preserve query typing and parameterisation.
- Add a regression example for the exact failing case plus one neighbouring case that protects against overfitting.
- For aggregate bugs, test ties and zero/NULL behaviour.
- For club/season bugs, include a historical-identity case when relevant.

Run integration tests only against `AFLDB_TEST_DATABASE_URL` and preserve the `_test` database safety boundary.
