# AFLDB-ISSUE-367 · Brownlow year page publishes unaccepted votes

**Reopened · High · 22 November 2026.** Recorded production application and candidate at review target `b445ba7f`.

On a fresh, migrated fixture with one stored 27-vote winner and no acceptance, the built /brownlow/2026 returned 200 and named Review Fixture as winner in its metadata. The season page returned 200 and omitted that name. The raw year query also feeds the ranking and winner heading. The sitemap and static params enumerate raw years. The earlier round/match fix and Sunday’s 371/372 acceptance stand.

Source anchors — `src/app/brownlow/[year]/page.tsx:20,34,55,80; src/app/sitemap.ts:138; src/db/queries/brownlow-readiness.ts:5`.

## Correction and acceptance

Use the shared accepted-row selector for year enumeration and ranking. Assert pending, accepted, corrected, explicitly inapplicable and empty HTML, metadata and sitemap against season, match and player projections. Preserve historical complete years.

[Independent review](../reviews/AFLDB-FULL-REVIEW-2026-11-22.md)

## Local fix status

**Local fix, 23 November 2026 (`2ebfb2da`; local, not published or deployed; this entry stays open pending Astra's re-review).** New `getBrownlowSeasonCount` and `getPublishedBrownlowSeasons` over the shared `acceptedBrownlowRowsSql()` selector drive static params, metadata, ranking and winner heading and the sitemap. Regression `tests/integration/brownlow-pending-projection.test.ts`: on the unfixed code 6 of 17 failed (metadata named the pending winner, sitemap and static params listed the year, the page resolved); on the fix 17/17 pass, covering hidden (no rows, partial and unpublished, pending, not-applicable and published) and visible (historical complete year, accepted by publication, corrected 20→21 matching the season projection) cases. Earlier round/match fix and Sunday's 371/372 acceptance are untouched. Record: ../reviews/AFLDB-FULL-REVIEW-2026-11-22-FIXES.md
