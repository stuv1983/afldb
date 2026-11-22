# AFLDB-ISSUE-376 · Award correction fan-out omits cached player profiles

**Open · Medium · 22 November 2026.** Recorded production application and candidate at review target `b445ba7f`.

A winner replacement generates old and new player paths. The handling worker invalidates all admitted paths. The cross-worker request derives only season and Brownlow paths. A second worker with a warm profile can continue displaying the prior winner until profile regeneration. Source-confirmed invalidation gap. The exact duration and a two-worker stale profile response were not measured. Sunday’s separate season-page acceptance remains recorded.

Source anchors — `src/db/queries/admin-awards.ts:900,1900; src/app/admin/awards/revalidate/route.ts:26; src/app/api/internal/revalidate-season/route.ts:102; src/app/players/[slug]/page.tsx:55`.

## Correction and acceptance

Invalidate the bounded, server-derived affected player paths on each worker. Warm both profiles on two labelled workers, replace the synthetic winner, and verify fresh requests to each worker reflect both removals and additions.

[Independent review](../reviews/AFLDB-FULL-REVIEW-2026-11-22.md)
