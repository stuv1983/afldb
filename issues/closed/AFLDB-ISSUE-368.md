# AFLDB-ISSUE-368 · AFLW replacement integrity

**Open · High · 21 November 2026.** At `b82a6b04`, a structurally empty replacement can clear the staging dataset backing the public AFLW views. A second read of the input files after validation also allows the committed generation to differ from the checked generation.

## Implementation and acceptance

1. Capture the pre-fix database-free result with the header-only command in the [closeout review](../reviews/AFLDB-FULL-REVIEW-2026-11-21.md). Keep the exit code, row count and commit.
2. Define the required nonempty competition, fixture and played-match inputs from the source contract. Allow legitimate zero-row optional tables, including the parser issue list. Emit every expected CSV into a fresh generation, with headers and a completeness manifest.
3. In the loader, verify headers, manifest, checksums, counts and cross-table relationships before connecting for replacement. Bind COPY to the verified generation. Keep the truncate and complete replacement in one transaction.
4. In a fresh disposable seeded database on streamanator, record staging and public view fingerprints. Exercise an all-header delivery, an omitted core table, a stale optional file, and input changed between validation and copy. Each rejected case must preserve the starting data. Exercise a valid delivery with zero parser issues, a repeated delivery, and a failed COPY with rollback.
5. Retain revision, red/green results, counts and before/after fingerprints. Close after the normal parser-to-loader entry point and public views satisfy these checks.

Source anchors are `tools/aflw/parse_aflw.py:93`, `tools/aflw/load_staging.py:99`, `:210`, `:238`, `:240`, `:282` and `src/db/migrations/026_aflw_read_model.sql:80`. No production reload is required to verify this fix.

## Resolution, 21 November 2026 (local, not published)

**Resolved** by `dc96ae6f` on `claude/closeout-20261121`. Qualified red/green on streamanator; see
[QUALIFICATION.md](../../docs/v2/evidence/closeout-20261121/QUALIFICATION.md).

1. **Pre-fix result.** At `b82a6b04` the header-only command exits 0 ("0 rows across 8 tables are safe to load"). On a
   disposable database the old loader committed header-only input: staging 0 rows, all 9 public views 0 rows.
2. **Required inputs.** Every staging table except `issues` must have rows; each season's fixture and played counts
   must equal its fixtures; played fixtures and matches must be the same set; every match needs player statistics for
   both teams. The parser writes all eight files plus `manifest.json` last, after deleting the previous manifest.
3. **Loader.** Manifest, checksums, headers, row counts and cross-table rules are verified before connecting; COPY uses
   the verified in-memory rows; truncate and reload stay in one transaction. `--seal` adopts one pre-manifest parse.
4. **Database proof** (isolated cluster, import-role loads, content fingerprints of 8 staging tables and 9 views; the
   `issues.id` identity column is excluded because `TRUNCATE` does not restart it): all-header delivery with and
   without manifest, omitted core table and stale optional file each refused with data unchanged; input changed after
   validation loads exactly the verified rows; zero-issue generation loads; repeated delivery identical; a COPY failure
   (`ladders.played = 'not-a-number'`, which passes the Python checks) rolls back. 12/12.
5. **Limits.** The parser did not run on the raw scrape, which is on neither machine. Its new write path was
   exercised with the 51,018 real rows and zero issues, and the loader accepted the output. DEV's parsed extract
   (15 Aug) has no manifest: run `load_staging.py --seal` once, or re-parse, before its next `--load`.
