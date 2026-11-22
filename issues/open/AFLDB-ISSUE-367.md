# AFLDB-ISSUE-367 · Brownlow year page publishes unaccepted votes

**Reopened · High · 22 November 2026.** Recorded production application and candidate at review target `b445ba7f`.

On a fresh, migrated fixture with one stored 27-vote winner and no acceptance, the built /brownlow/2026 returned 200 and named Review Fixture as winner in its metadata. The season page returned 200 and omitted that name. The raw year query also feeds the ranking and winner heading. The sitemap and static params enumerate raw years. The earlier round/match fix and Sunday’s 371/372 acceptance stand.

Source anchors — `src/app/brownlow/[year]/page.tsx:20,34,55,80; src/app/sitemap.ts:138; src/db/queries/brownlow-readiness.ts:5`.

## Correction and acceptance

Use the shared accepted-row selector for year enumeration and ranking. Assert pending, accepted, corrected, explicitly inapplicable and empty HTML, metadata and sitemap against season, match and player projections. Preserve historical complete years.

[Independent review](../reviews/AFLDB-FULL-REVIEW-2026-11-22.md)
