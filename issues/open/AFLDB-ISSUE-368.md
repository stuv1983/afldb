# AFLDB-ISSUE-368 · AFLW replacement can remove a missing season

**Reopened · High · 22 November 2026.** Recorded production revision and candidate at review target `b445ba7f`.

The parser continues past an absent season and glob-selects available player pages. Counts and digests can agree within that reduced generation. The loader truncates eight staging tables before copying it. A previously visible season can disappear from the season view and its public route. The candidate’s one-season test generation produced zero validation failures and eight recorded truncations against its recording connection. No real staging replacement was performed.

Source anchors — `tools/aflw/parse_aflw.py:625,663; tools/aflw/load_staging.py:370,387,452; src/db/migrations/026_aflw_read_model.sql:76`.

## Correction and acceptance

Require the expected season and required page inventory before admitting a replacement. Remove a whole season, then one season’s players page from a valid multi-season fixture. Both loads must refuse before connection and preserve the published rows.

[Independent review](../reviews/AFLDB-FULL-REVIEW-2026-11-22.md) · [Earlier closed scope](../closed/AFLDB-ISSUE-368.md)
