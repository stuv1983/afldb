# AFLDB V2 — historical baseline manifest specification

Status: Stage 2 (2026-10-19). Format `afldb.v2.historical-baseline-manifest`, format version 1,
spec version 1. Implemented by `packages/domain/src/historical-manifest.ts` (spec, sealed rule,
validation, comparator; pure), `packages/db/src/historical-manifest-producer.ts` (producer) and
`tools/v2/historical-manifest.ts` (CLI). Tested by `tests/v2-historical-manifest.test.ts` with
synthetic fixtures only. **The producer has never been run against any database.**

## 1. Purpose

A manifest is a compact, content-free fingerprint of the sealed historical baseline
(`docs/v2/historical-baseline.md`): per table and per season, a row count and three sha256
digests. Two manifests taken at different times, or from a source and a restored or promoted
copy, are compared offline to prove that no sealed season changed, or to list exactly which
table-seasons did so that reconciliation can explain them.

It complements, and does not replace, the existing whole-database tooling: `tools/db/catalog-fingerprint.ts`
(schema) and `tools/db/fingerprint-tier2.ts` (whole-table multiset digests, `afldb_test` only).
The manifest differs in three ways: it is season-grained (open-season movement cannot mask a
sealed change), it digests facts apart from provenance metadata (a reload that re-stamps
`import_batch_id` is distinguishable from a changed fact), and it keys rows by natural keys so a
rebuild that renumbers surrogate ids still compares.

## 2. Covered tables (`HISTORICAL_TABLES`)

| Table | Kind | Season from | Ordered key | `id` |
|---|---|---|---|---|
| `seasons` | fact | `year` | `year` | — |
| `matches` | fact | `season` | `match_key` | fact |
| `match_period_scores` | fact | `matches.season` | `matches.match_key`, `club_id`, `period` | — |
| `player_match_stats` | fact | `matches.season` | `matches.match_key`, `player_id` | surrogate, excluded |
| `player_match_period_stats` | fact | `matches.season` | `matches.match_key`, `player_id`, `period` | surrogate, excluded |
| `match_coaches` | fact | `matches.season` | `matches.match_key`, `club_id` | — |
| `brownlow_round_votes` | fact | `season` | `season`, `player_id`, `round_number` | surrogate, excluded |
| `brownlow_season_votes` | fact | `season` | `season`, `player_id` | surrogate, excluded |
| `brownlow_season_authority` | fact | `season` | `season` | — |
| `club_seasons` | fact | `season` | `season`, `club_id` | surrogate, excluded |
| `captaincies` | fact | `season` | `season`, `club_id`, `player_id`, `id` | fact |
| `award_winners` | fact | `season` (nullable) | `award_id`, `season`, `id` | fact |
| `award_nominations` | fact | `season` | `award_id`, `season`, `id` | fact |
| `draft_picks` | fact | `draft_year` | `draft_year`, `id` | fact |
| `father_son_selections` | fact | `draft_year` | `draft_year`, `id` | fact |
| `player_achievements` | fact | `season` | `season`, `id` | fact |
| `after_siren_kicks` | fact | `season` | `season`, `id` | fact |
| `season_list_members` | fact | `season` | `season`, `player_id` | fact |
| `club_leadership` | fact | `season` | `season`, `id` | fact |
| `clubs`, `club_aliases`, `venues`, `venue_aliases`, `players`, `player_name_aliases`, `external_identities`, `draft_persons`, `player_relationships`, `awards`, `coaches`, `hall_of_fame`, `honour_team_members` | reference | — (one bucket) | `id` | fact |

`id` is treated as a fact wherever it is a stable identity that audit rows (`data_edits.row_id`)
or other tables reference, and excluded only where it is a `GENERATED ALWAYS` identity that a
rebuild renumbers and nothing durable references. Draft tables bucket by `draft_year`. A test
checks every table, key column and season column against the migrations.

## 3. Sealed seasons

`sealed = { from: first_season, through: the last season not in progress, open: [] }`, read
from `data/reference/seasons.json` (today 1897-2025; 2026 is in progress). A season is sealed
once the rollover removes it from `in_progress_seasons`. A season inside the range that is still
in progress is listed in `open`. A fact row whose season is NULL (possible in `award_winners`)
is undated history and its bucket is **sealed**. Reference tables have no season and are never
"sealed"; they are compared under their own rules (section 6).

The `seasons` table is digested whole, including its measured and status columns (match and
club counts, first/last match dates, `status`, `data_through_date`, `completed_at`, ...). A
re-measurement of a sealed season therefore reports `FACTS_CHANGED`: deliberately conservative,
and reconciled like any other change.

## 4. Digest recipe (per table, per season bucket)

All inside one `REPEATABLE READ READ ONLY` transaction, with `TimeZone=UTC`,
`DateStyle='ISO, YMD'`, `IntervalStyle=postgres`, `extra_float_digits=1`, `bytea_output=hex`
and `search_path=pg_catalog` pinned by `SET LOCAL`:

- `k` = `jsonb_build_array(<key columns>)::text`
- `f` = `(to_jsonb(row) - <excluded columns>)::text`, where excluded = metadata columns, a
  surrogate `id`, and any column not in the pinned list (section 5). jsonb orders object keys
  itself, so physical column order is irrelevant.
- `p` = `jsonb_build_object(<metadata columns>)::text`, metadata being whichever of
  `source_id`, `source_record_id`, `import_batch_id`, `imported_at`, `created_at`, `updated_at`
  the table has.
- `rows` = `count(*)`; `keyDigest`, `factDigest`, `metadataDigest` = `sha256` of the
  newline-joined `k`, `f`, `p` values, each list ordered by `(k, f)` under `COLLATE "C"`.
  Ordering by content as well as key makes the digest deterministic even where the key is not
  unique.

Only the four results per bucket leave the server. `FROM ONLY` excludes inheritance children.

## 5. Format

```json
{
  "format": "afldb.v2.historical-baseline-manifest",
  "formatVersion": 1,
  "specVersion": 1,
  "status": "complete",
  "producedAt": "<ISO-8601>",
  "source": { "database": "<name>", "serverVersion": "<version>", "readOnlySource": false,
              "transaction": "repeatable read, read only, rolled back" },
  "sealed": { "from": 1897, "through": 2025, "open": [] },
  "pinnedTo": null,
  "tables": [
    { "table": "matches", "kind": "fact", "season": "row.season", "key": ["row.match_key"],
      "factColumns": ["..."], "metadataColumns": ["..."], "excludedColumns": ["..."],
      "buckets": [ { "season": 2025, "sealed": true, "rows": 0, "keyDigest": "<sha256>",
                     "factDigest": "<sha256>", "metadataDigest": "<sha256 or null>" } ] }
  ]
}
```

No host, port, role, connection string or row value is recorded. A bucket exists only for a
season with rows; the comparator reads a missing bucket as zero rows. `factColumns` lists the
digested columns, so a later additive migration (a new column) is detected rather than silently
changing every digest. `--pin-columns <earlier manifest>` re-produces with the earlier fact
column list (refusing if any of those columns no longer exists), which makes the two comparable
again; `pinnedTo` records it.

## 6. Comparison rules (`compareManifests`)

Both inputs must be complete, valid manifests (otherwise exit 2). The verdict covers the seasons
sealed in **both** manifests.

| Finding | Severity | When |
|---|---|---|
| `ROWS_CHANGED`, `KEYS_CHANGED`, `FACTS_CHANGED` | violation | a sealed bucket differs |
| `TABLE_MISSING` | violation | a table in the before manifest is absent after |
| `REFERENCE_ROWS_DECREASED` | violation | a reference table lost rows |
| `FACT_COLUMNS_CHANGED`, `KEY_DEFINITION_CHANGED`, `SEASON_DEFINITION_CHANGED`, `KIND_CHANGED` | unverified | the table's definitions differ, so its digests prove nothing |
| `SEALED_RANGE_DIFFERS` | info, or unverified when no season is sealed in both | the sealed ranges differ |
| `METADATA_CHANGED` | review | a sealed bucket's facts and keys match but provenance was re-stamped |
| `REFERENCE_CHANGED` | review | reference rows grew or were edited |
| `METADATA_COLUMNS_CHANGED`, `SPEC_VERSION_DIFFERS` | review | |
| `OPEN_SEASON_CHANGED`, `TABLE_ADDED` | info | expected movement |

Verdict `sealed-scope-identical` (exit 0) only when there is no violation, unverified or review
finding; otherwise `reconciliation-required` (exit 1). The JSON report
(`afldb.v2.historical-baseline-comparison`) carries every finding.

## 7. Commands (for a later, authorised run; none has been run)

```text
# offline, any time
npx tsx tools/v2/historical-manifest.ts compare <before.json> <after.json> --out <report.json>

# reads a _test database read-only
npx tsx tools/v2/historical-manifest.ts produce --dsn-env <VARIABLE> --out <manifest.json>

# reads a NON-test database read-only: both flags are required, and owner authority for the run
npx tsx tools/v2/historical-manifest.ts produce --dsn-env <VARIABLE> --out <manifest.json> \
    --read-only-source --i-understand-this-reads-a-non-test-database
```

The DSN is read only from the variable named by `--dsn-env` (never `DATABASE_URL` implicitly)
and is never printed. The producer refuses inside a test process. Output files are created
exclusively and never overwritten. Exit 2 means refused or failed, and nothing was written to
any database in any case: the session is read-only, the transaction is read-only and it is
always rolled back.
