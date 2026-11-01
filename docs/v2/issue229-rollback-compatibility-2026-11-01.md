# ISSUE-229: migration 118 and code-rollback compatibility (2026-11-01)

**Status: PROVEN ON DISPOSABLE COPIES ONLY. Nothing was executed on production.** Production ordering is unchanged: **migration first, compatible code second, first fixture apply only afterwards.** This record answers the question "is a code-only rollback safe once migration 118 is applied and fixture rows exist?" by behaviour, not by health checks.

## 1. Method

* Target: fresh guarded disposable databases (`afldb_v2_*_test`, loopback cluster) restored from the verified production backup `afldb_prod-20261031-084435.dump` (sha256 `3f5b5339…4730`; ledger 117, 17,056 matches, 0 fixtures).
* Migration 118 applied by the **real runner** (`tools/db/migrate.ts`), blob sha256 `49e59fcd96aa62142fb2da8141f926997582ef86502b37e22c4796f004498401`.
* The retained 218-record 2027 feed (`afl-api-2027-2026-11-01-012026`, sha256 `21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d`) applied by `settle-afl-api-fixture-schedule.ts`.
* Each revision was **built and served** on 127.0.0.1 against the same database, and driven by a headless Chromium with a local admin session (`tools/v2/issue229-rollback-probe.mts`). For every URL it records the HTTP status, whether the page rendered an application error and the visible heading; with `--mutate` it creates one **manual** fixture through the real admin form in a round that holds no provider row, and reads the row back. Server errors and application errors are counted. The reports are retained in `D:\tmp\afldb-issue229-rollback-20261101\` (each with screenshots).

## 2. Results

| Stage | Code | Schema | Fixture rows | Public | Admin | Manual create | Notes |
|---|---|---|---|---|---|---|---|
| A | candidate (new) | 118, **no ingestion** | 0 then manual only | 200 | 200 | works | zero server or application errors; the 404s on `/sitemap*` appear identically on every revision and stage and are not a regression |
| B | candidate (new) | 118, **218-record feed applied** | 221 | 200 | 200, all three row kinds listed with their confirmation state | works | zero errors |
| C | **previous revision** (`ad245d60`) | 118, **no ingestion** | manual only | 200 | 200 | works | the old code never names the new columns, so the schema step alone is harmless |
| D | **previous revision** (`ad245d60`) after the **feed was applied** | 118, 222 rows (83 unconfirmed, 11 label-participant) | 222 | 200 on 17 of the 18 URLs probed; the one non-200 is the label-row detail (404) | 200 for the index and the 2027 list | works (223rd row created and read back) | **the old admin list does not show the 11 label-participant rows and the label-row detail page is a 404**; no data is lost, no error page, no write damage |

Counts before and after each probe are in the reports; the matches table (17,056) and clubs (24) are unchanged by every stage.

## 3. What this establishes

1. **Schema 118 is backward compatible with the previous code** whether or not fixture rows exist (stages C and D): public pages, the admin index and the manual-create flow behave.
2. **A code-only rollback after the first apply is safe for availability and for the confirmed fixtures**, but it is **not full fidelity**: the previous admin cannot display the 11 fixtures whose participant is a provider label (their `home_club_id`/`away_club_id` is NULL, which the old inner joins drop) and cannot open one. The other 72 unconfirmed rows (real clubs on both sides) remain visible to it, but without a confirmation state, which the old code does not know. Nothing is mutated by that.
3. **Exact data-recovery route** if the owner needs the old behaviour back with a clean view: (a) the pre-M1 backup is the authoritative restore; (b) or remove the fixture rows of the single apply batch and then undo the schema using the rehearsed statements ([script](evidence/issue229-undo-118-rehearsal-2026-11-01.sql); drop the per-side CHECKs, restore NOT NULL on the club ids only while no NULL club row exists, drop the three added columns). The removal is by import batch, never by hand, and is a separate owner decision; this record does not authorise it.
4. **Revision identity.** Stages C and D used `ad245d60`, the code production ran until the GAP-006 release. Production now serves `fd48ace0` (release `fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy`), which was probed separately in section 4 with the same outcome.

## 4. The revision production serves now (`fd48ace0`)

`git diff ad245d60 fd48ace0 -- src/db/queries/admin-fixtures.ts` is two lines: a `seal: { kind: 'reference' }` argument on the two audit writes. Nothing else in the fixture query or action code differs, and `fd48ace0..affe9a2c` (the host checkout) touches no `src` file. **It was nevertheless probed directly.** `fd48ace0` was extracted with `git archive`, built (same lock file as `HEAD`, 15 s compile, standalone bundle verified) and served on 127.0.0.1:3913 against the populated schema-118 database (223 fixtures: 83 unconfirmed, 11 label-participant), then driven by the same probe with `--mutate` (`D:\tmp\afldb-issue229-rollback-20261101\fd48ace0-post-ingest-rollback\`). **Result identical to stage D:** 17 of 18 URLs return 200 with no application or server error (public home, season, players, player, match, clubs, club, venues, records; admin index, 2027 list, 2026 list, new-fixture form, data editor, audit trail, confirmed provider-row detail, unconfirmed real-club detail); the label-row detail is the one 404; the admin 2027 list reports **212** fixtures against **223** stored (the 11 label rows are invisible to this code, and only those); a manual fixture was created through the real form and read back (`confirmation` `confirmed`, source `manual_admin_edit`), taking the table from 223 to 224 with matches (17,056) and clubs (24) unchanged. So the statement in section 3 holds for the revision production serves now, by observation rather than by diff alone.

## 5. Production ordering, restated

M1 migration 118 (backup first) → M2 compatible code (`release.mjs rollback` is safe here because no fixture row exists) → M3 first fixture apply (needs the temporary ingestion switch, finding F-229-SWITCH in the [master sequence](master-execution-sequence-2026-11-01.md)). After M3, rollback means the code-only route above with its stated loss of visibility, or the data-recovery route; the owner chooses.
