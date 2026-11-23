# AFLDB-ISSUE-376 · Award correction fan-out omits cached player profiles

**Release record, 23 November 2026 (late).** Published: `origin/main` = `17822b29e6de2b6248cd7ada4221800fd81e0003` (owner-approved fast-forward from `ae51cd8d`; `git ls-remote` 21:29 AEDT). Not deployed: production serves `7d92042fd110-XWruOm_9nLCSMY8nGPqYU`. Independent review is complete ([re-review](issues/reviews/AFLDB-RE-REVIEW-2026-11-23.md)). Astra's final verdict, on 69538980: application READY FOR ATTENDED APPLICATION RELEASE, technically; push HOLD only on the ISSUE-368 race harness, addressed by `bd50bde8`/`635d4df2`, tests only. Current state: Fix published in `17822b29`, not deployed. Independent review: the authenticated `POST /admin/awards/revalidate` answered 200, and both workers' first requests were MISS with the medal moved from old player 79 to new player 80. Remaining: production release acceptance. No production award change is in the release, so the live check covers only the unchanged season-only fan-out. LOW: unseasoned corrections and other publication flows stay acting-worker-only. Release packet: [runbook](docs/v2/evidence/release-17822b29-20261124/RUNBOOK.md).

**Open · Medium · 22 November 2026.** Recorded production application and candidate at review target `b445ba7f`.

A winner replacement generates old and new player paths. The handling worker invalidates all admitted paths. The cross-worker request derives only season and Brownlow paths. A second worker with a warm profile can continue displaying the prior winner until profile regeneration. Source-confirmed invalidation gap. The exact duration and a two-worker stale profile response were not measured. Sunday’s separate season-page acceptance remains recorded.

Source anchors — `src/db/queries/admin-awards.ts:900,1900; src/app/admin/awards/revalidate/route.ts:26; src/app/api/internal/revalidate-season/route.ts:102; src/app/players/[slug]/page.tsx:55`.

## Correction and acceptance

Invalidate the bounded, server-derived affected player paths on each worker. Warm both profiles on two labelled workers, replace the synthetic winner, and verify fresh requests to each worker reflect both removals and additions.

[Independent review](../reviews/AFLDB-FULL-REVIEW-2026-11-22.md)

## Local fix status

**Local fix, 23 November 2026 (`805c55fd`; published 23 Nov in `17822b29`, not deployed; independent re-review complete, see the release record above).** The cross-worker revalidation request optionally carries up to six canonical `/players/<slug>-<id>` paths; the internal route refuses the whole request (400, nothing invalidated) on any non-canonical entry; the award fan-out derives them from the server-admitted paths and retries them with the next season until every worker acknowledged. Two-worker run on a production build with the real replacement: with a season-only fan-out the owning workers kept the stale profiles (old winner `HIT`, new winner `HIT:none`); on the fix both profiles were invalidated on both workers and fresh requests reflected the removal and addition. Not exercised: the authenticated `/admin/awards/revalidate` route end to end; a correction with no season stays acting-worker-only (LOW). Record: ../reviews/AFLDB-FULL-REVIEW-2026-11-22-FIXES.md
