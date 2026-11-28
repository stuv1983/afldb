# AFLDB-ISSUE-375 · Migration status accepts an unknown applied migration

**Release record, 23 November 2026 (late).** Published: `origin/main` = `17822b29e6de2b6248cd7ada4221800fd81e0003` (owner-approved fast-forward from `ae51cd8d`; `git ls-remote` 21:29 AEDT). Not deployed: production serves `7d92042fd110-XWruOm_9nLCSMY8nGPqYU`. Independent review is complete ([re-review](../reviews/AFLDB-RE-REVIEW-2026-11-23.md)). Astra's final verdict, on 69538980: application READY FOR ATTENDED APPLICATION RELEASE, technically; push HOLD only on the ISSUE-368 race harness, addressed by `bd50bde8`/`635d4df2`, tests only. Current state: Fix published in `17822b29`. The independent re-review verified it. Remaining: no technical criterion; resolve on the owner's confirmation. Release packet: [runbook](../../docs/v2/evidence/release-17822b29-20261124/RUNBOOK.md).

**Open · Medium · 22 November 2026.** Recorded production revision and candidate, operator tools at review target `b445ba7f`.

Inserted one extra ledger row in a new disposable copy of the migrated test database. Status returned 0 with “0 pending”. Apply returned 0 with “schema is up to date”. The checksum loop walks only local files. Operators using the direct commands miss a newer or divergent database. The earlier status-only DDL fix remains effective.

Source anchors — `tools/db/migrate.ts:293,303,313; tools/db/migration-safety.ts:167`.

## Correction and acceptance

Detect applied names absent from the checkout before reporting success or applying anything. Reuse the existing reverse comparison. Exercise both modes against an extra fixture ledger row and assert nonzero and unchanged catalog.

[Independent review](../reviews/AFLDB-FULL-REVIEW-2026-11-22.md)

## Local fix status

**Local fix, 23 November 2026 (`78c47c14`; published 23 Nov in `17822b29`; independent re-review complete, see the release record above).** `migrate.ts` reuses `compareAppliedMigrations`' reverse comparison and exits 1 naming each unknown applied migration in both status and apply modes before anything is applied; apply reads the ledger before creating it. On a copy with an extra ledger row the unfixed tool exited 0 ("0 pending", "schema is up to date"); on the fix both exit 1 and the catalog fingerprint and ledger count (119) are unchanged; a fresh empty target still reports 118 pending and applies. Record: ../reviews/AFLDB-FULL-REVIEW-2026-11-22-FIXES.md

## Resolution, 27 November 2026

**RESOLVED 2026-11-27 on the owner's confirmation.** It is an operator-tooling fix: published, with nothing to run on production.
- **Fix:** `78c47c14`, published in `17822b29`.
- **Evidence:** the fix-record harness above, and the independent re-review ([AFLDB-RE-REVIEW-2026-11-23](../reviews/AFLDB-RE-REVIEW-2026-11-23.md)). Status and apply exited 0/0 on base and 1/1 on the fix, naming the unknown migration. The 119-row ledger's ordered name and checksum fingerprint was unchanged, and the refusal precedes ledger bootstrap and DDL.
- **Coverage:** that re-review examined `c154f36b`. On 2026-11-27, `git diff --stat c154f36b 17822b29 -- tools/db …` (the same command as ISSUE-374) printed nothing.
- **Residual:** none.
