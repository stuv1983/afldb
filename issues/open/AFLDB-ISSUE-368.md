# AFLDB-ISSUE-368 · AFLW replacement integrity

**Open · High · 21 November 2026.** At `b82a6b04`, a structurally empty replacement can clear the staging dataset backing the public AFLW views. A second read of the input files after validation also allows the committed generation to differ from the checked generation.

## Implementation and acceptance

1. Capture the pre-fix database-free result with the header-only command in the [closeout review](../reviews/AFLDB-FULL-REVIEW-2026-11-21.md). Keep the exit code, row count and commit.
2. Define the required nonempty competition, fixture and played-match inputs from the source contract. Allow legitimate zero-row optional tables, including the parser issue list. Emit every expected CSV into a fresh generation, with headers and a completeness manifest.
3. In the loader, verify headers, manifest, checksums, counts and cross-table relationships before connecting for replacement. Bind COPY to the verified generation. Keep the truncate and complete replacement in one transaction.
4. In a fresh disposable seeded database on streamanator, record staging and public view fingerprints. Exercise an all-header delivery, an omitted core table, a stale optional file, and input changed between validation and copy. Each rejected case must preserve the starting data. Exercise a valid delivery with zero parser issues, a repeated delivery, and a failed COPY with rollback.
5. Retain revision, red/green results, counts and before/after fingerprints. Close after the normal parser-to-loader entry point and public views satisfy these checks.

Source anchors are `tools/aflw/parse_aflw.py:93`, `tools/aflw/load_staging.py:99`, `:210`, `:238`, `:240`, `:282` and `src/db/migrations/026_aflw_read_model.sql:80`. No production reload is required to verify this fix.
