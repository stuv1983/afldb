# AFLDB-ISSUE-375 · Migration status accepts an unknown applied migration

**Open · Medium · 22 November 2026.** Recorded production revision and candidate, operator tools at review target `b445ba7f`.

Inserted one extra ledger row in a new disposable copy of the migrated test database. Status returned 0 with “0 pending”. Apply returned 0 with “schema is up to date”. The checksum loop walks only local files. Operators using the direct commands miss a newer or divergent database. The earlier status-only DDL fix remains effective.

Source anchors — `tools/db/migrate.ts:293,303,313; tools/db/migration-safety.ts:167`.

## Correction and acceptance

Detect applied names absent from the checkout before reporting success or applying anything. Reuse the existing reverse comparison. Exercise both modes against an extra fixture ledger row and assert nonzero and unchanged catalog.

[Independent review](../reviews/AFLDB-FULL-REVIEW-2026-11-22.md)

## Local fix status

**Local fix, 23 November 2026 (`78c47c14`; local, not deployed; this entry stays open pending Astra's re-review).** `migrate.ts` reuses `compareAppliedMigrations`' reverse comparison and exits 1 naming each unknown applied migration in both status and apply modes before anything is applied; apply reads the ledger before creating it. On a copy with an extra ledger row the unfixed tool exited 0 ("0 pending", "schema is up to date"); on the fix both exit 1 and the catalog fingerprint and ledger count (119) are unchanged; a fresh empty target still reports 118 pending and applies. Record: ../reviews/AFLDB-FULL-REVIEW-2026-11-22-FIXES.md
