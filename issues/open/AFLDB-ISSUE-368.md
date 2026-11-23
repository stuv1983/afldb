# AFLDB-ISSUE-368 · AFLW replacement can remove a missing season

**Reopened · High · 22 November 2026.** Recorded production revision and candidate at review target `b445ba7f`.

The parser continues past an absent season and glob-selects available player pages. Counts and digests can agree within that reduced generation. The loader truncates eight staging tables before copying it. A previously visible season can disappear from the season view and its public route. The candidate’s one-season test generation produced zero validation failures and eight recorded truncations against its recording connection. No real staging replacement was performed.

Source anchors — `tools/aflw/parse_aflw.py:625,663; tools/aflw/load_staging.py:370,387,452; src/db/migrations/026_aflw_read_model.sql:76`.

## Correction and acceptance

Require the expected season and required page inventory before admitting a replacement. Remove a whole season, then one season’s players page from a valid multi-season fixture. Both loads must refuse before connection and preserve the published rows.

[Independent review](../reviews/AFLDB-FULL-REVIEW-2026-11-22.md) · [Earlier closed scope](../closed/AFLDB-ISSUE-368.md)

## Fix-branch qualification, 23 November 2026

`tests/python/aflw_staging_race.py` guarded its target with `host.startswith("/tmp/afldb-astra-")`, so only Astra's own temporary cluster could run it. The guard became "absolute Unix-socket directory and a `*_test` database" as a DSN-text `assert`; Astra found that insufficient (see the next section). On a fresh PG16 socket cluster the reviewed `c154f36b` loader erased the committed 2027 season (reproduced); the candidate loader exited 1 and preserved all staging rows and six public views; a complete replacement succeeded; staging contract 54/54. No loader code changed. Invocation: the file's docstring. Record: [fix-branch record](../reviews/AFLDB-ASTRA-FIX-2026-11-23.md).

## Push-blocker fix, 23 November 2026

Astra held the push of `69538980`: the race test checked a parsed DSN with an `assert` (removed by `python -O`) and neither the writer nor the separately launched loader verified its own live connection. Fixed in `bd50bde80ce18ad0bba89c6207c845f32f5a5d6b` (local, not published; four files under `tests/python/`, **no application code changed**): the writer and every connection the child loader opens now check `current_database()` against the intended `*_test` database and the Unix-socket transport on the connection itself, before first use, with explicit checks that exit 3 under normal Python and `python -O`. Refusals proved independently for the writer and the loader (TCP to a `_test` database, socket to an unsuffixed database, actual database differing from intended, normal and `-O`; protected rows unchanged from an independent connection; a negative control shows the old launcher writes over TCP). The valid two-connection race on a socket-only cluster passed on that SHA: the writer blocked the loader, the stale replacement exited 1 preserving all rows, the complete twelve-season replacement exited 0. Record: [push-blocker record](../reviews/AFLDB-ASTRA-PUSH-BLOCKER-2026-11-23.md). Awaiting Astra's push verdict.

## Local fix status

**Local fix, 23 November 2026 (`d4c4d760`; local, not published; this entry stays open pending Astra's re-review).** `EXPECTED_SEASON_KEYS` (the committed eleven-key inventory) is the independent evidence: `constraint_failures` (run for `--check`, `--load` and `--seal` before connecting or truncating) requires every expected season, no season outside it, and ladder and player-season rows for every season with played fixtures; the parser refuses a raw scrape missing or carrying an unlisted page and a season that parses to no fixtures. Populated disposable database (eleven synthetic seasons, 121 rows): omitted season, missing player seasons and header-only inputs each exit 1 with per-table counts and the `aflw.seasons` checksum unchanged; the unfixed loader dropped the omitted season (11 to 10 rows). Contract scenario 10, 54 checks. Owner decision: confirm the committed list as authoritative (no command-line override; 2027 needs a reviewed edit and belongs on the rollover checklist) and whether to add the deferred in-transaction subset check. Record: ../reviews/AFLDB-FULL-REVIEW-2026-11-22-FIXES.md

**Astra follow-up, 23 November 2026.** Local replacement locks staging before reading season keys, preserves the independent inventory check and refuses to omit any existing season. PG16 reproduced the loss on c154f36b and proved full preservation and a successful complete replacement on the fix. Keep open for Astra; advance the inventory through reviewed seasonal rollover. Tested code `2bec8060487816c21c143ee8e3dd924a74e30eae`. [Named PostgreSQL evidence](../reviews/AFLDB-ASTRA-FOLLOWUP-2026-11-23.md).
