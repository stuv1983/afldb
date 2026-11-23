# AFLDB-ISSUE-368 · AFLW replacement can remove a missing season

**Reopened · High · 22 November 2026.** Recorded production revision and candidate at review target `b445ba7f`.

The parser continues past an absent season and glob-selects available player pages. Counts and digests can agree within that reduced generation. The loader truncates eight staging tables before copying it. A previously visible season can disappear from the season view and its public route. The candidate’s one-season test generation produced zero validation failures and eight recorded truncations against its recording connection. No real staging replacement was performed.

Source anchors — `tools/aflw/parse_aflw.py:625,663; tools/aflw/load_staging.py:370,387,452; src/db/migrations/026_aflw_read_model.sql:76`.

## Correction and acceptance

Require the expected season and required page inventory before admitting a replacement. Remove a whole season, then one season’s players page from a valid multi-season fixture. Both loads must refuse before connection and preserve the published rows.

[Independent review](../reviews/AFLDB-FULL-REVIEW-2026-11-22.md) · [Earlier closed scope](../closed/AFLDB-ISSUE-368.md)

## Local fix status

**Local fix, 23 November 2026 (`d4c4d760`; local, not published; this entry stays open pending Astra's re-review).** `EXPECTED_SEASON_KEYS` (the committed eleven-key inventory) is the independent evidence: `constraint_failures` (run for `--check`, `--load` and `--seal` before connecting or truncating) requires every expected season, no season outside it, and ladder and player-season rows for every season with played fixtures; the parser refuses a raw scrape missing or carrying an unlisted page and a season that parses to no fixtures. Populated disposable database (eleven synthetic seasons, 121 rows): omitted season, missing player seasons and header-only inputs each exit 1 with per-table counts and the `aflw.seasons` checksum unchanged; the unfixed loader dropped the omitted season (11 to 10 rows). Contract scenario 10, 54 checks. Owner decision: confirm the committed list as authoritative (no command-line override; 2027 needs a reviewed edit and belongs on the rollover checklist) and whether to add the deferred in-transaction subset check. Record: ../reviews/AFLDB-FULL-REVIEW-2026-11-22-FIXES.md

**Astra follow-up, 23 November 2026.** Local replacement locks staging before reading season keys, preserves the independent inventory check and refuses to omit any existing season. PG16 reproduced the loss on c154f36b and proved full preservation and a successful complete replacement on the fix. Keep open for Astra; advance the inventory through reviewed seasonal rollover. Tested code `2bec8060487816c21c143ee8e3dd924a74e30eae`. [Named PostgreSQL evidence](../reviews/AFLDB-ASTRA-FOLLOWUP-2026-11-23.md).
