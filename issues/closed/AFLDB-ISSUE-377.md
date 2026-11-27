# AFLDB-ISSUE-377 · Player matching recall test passes without measuring recall

**Release record, 23 November 2026 (late).** Published: `origin/main` = `17822b29e6de2b6248cd7ada4221800fd81e0003` (owner-approved fast-forward from `ae51cd8d`; `git ls-remote` 21:29 AEDT). Not deployed: production serves `7d92042fd110-XWruOm_9nLCSMY8nGPqYU`. Independent review is complete ([re-review](../reviews/AFLDB-RE-REVIEW-2026-11-23.md)). Astra's final verdict, on 69538980: application READY FOR ATTENDED APPLICATION RELEASE, technically; push HOLD only on the ISSUE-368 race harness, addressed by `bd50bde8`/`635d4df2`, tests only. Current state: Fix (test-only) published in `17822b29`. The independent re-review verified it. Remaining: no technical criterion; resolve on the owner's confirmation. LOW: other silent early returns remain elsewhere in the file. Release packet: [runbook](../../docs/v2/evidence/release-17822b29-20261124/RUNBOOK.md).

**Open · Medium · 22 November 2026.** Recorded production revision and candidate, test-only at review target `b445ba7f`.

The known-link recall test returns successfully below 20 trusted links before candidate retrieval or the 95% assertion. A similar return drops conflict coverage. Empty fixtures or a broken evidence query can make the tests green. The earlier apostrophe regression exercised a different assertion.

Source anchors — `tests/integration/player-matching.test.ts:243,259,394`.

## Correction and acceptance

Seed sufficient known synthetic identities for a mandatory recall/control test. Make empirical corpus unavailability an explicit skip with a reason. Assert a deliberately empty result fails the seeded control.

[Independent review](../reviews/AFLDB-FULL-REVIEW-2026-11-22.md)

## Local fix status

**Local fix, 23 November 2026 (`0eb61367`; test-only; published 23 Nov in `17822b29`; independent re-review complete, see the release record above).** Mandatory seeded cases (24 synthetic players with resolved award and honour-team links read back through `fetchSourceEvidence`) for recall, honour-team self-collision and no-contradiction, with controls proving an empty result and sub-floor recall fail and a rival honour-team source must conflict; the empirical variants keep their thresholds and `ctx.skip` with an explicit reason when the corpus is unavailable. The unfixed file passed vacuously on an empty migrated database. LOW: other silent early returns remain in the file outside the cited lines. Record: ../reviews/AFLDB-FULL-REVIEW-2026-11-22-FIXES.md

## Resolution, 27 November 2026

**RESOLVED 2026-11-27 on the owner's confirmation.** The fix is test-only and published.
- **Fix:** `0eb61367`, published in `17822b29`.
- **Evidence:** the unfixed file passed vacuously on an empty migrated database. The independent re-review ([AFLDB-RE-REVIEW-2026-11-23](../reviews/AFLDB-RE-REVIEW-2026-11-23.md)) found all four selected mandatory cases passed and the three empirical cases skipped explicitly, so the mandatory tests now execute their assertions.
- **Coverage:** that re-review examined `c154f36b`. On 2026-11-27, `git diff --stat c154f36b 17822b29 -- … tests/integration/player-matching.test.ts …` (the same command as ISSUE-374) printed nothing.
- **Owner-accepted LOW residual, no new issue:** seven silent early returns on empty results remain in the non-recall extraction and shape tests of `tests/integration/player-matching.test.ts`, at lines 245, 284, 562, 585, 605, 615 and 617 as of `17822b29`. Five check `rows.length === 0`; line 562 checks `kangaroos.length === 0` and line 617 checks `withText.length === 0`.
- **Not in scope:** empirical recall on the production player population remains unmeasured.
