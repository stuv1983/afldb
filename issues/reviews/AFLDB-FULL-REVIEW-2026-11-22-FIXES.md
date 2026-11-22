# Fixes for the 22 November 2026 independent review · local record, 23 November 2026

This is the response record. It does not replace or amend [the original report](AFLDB-FULL-REVIEW-2026-11-22.md), which stays as the record of what was found, nor Sunday's four original P6 NOT OK ticks and narrow waiver, which stay as the record of what happened.

**Everything here is local.** Branch `claude/review-fixes-20261123`, created from the review commit `a77dacb0` (reviewed candidate `b445ba7f`, recorded production application `7d92042fd110`). Nothing is pushed, installed, deployed or rebooted. No production, DEV application data or crontab was touched. The review worktree, the backlog worktrees and the dirty `D:\dev\afldb` checkout were not modified. No commit carries an AI attribution trailer.

## 1. One row per finding

"Regression evidence" is what failed on the reviewed code and what passes now. Where the evidence was produced by the delegated implementer (marked **I**) I re-ran the committed test files green on the final tree (section 3) but did not repeat each red demonstration; the rest I produced myself (**M**).

| Issue | Fix commit(s) | Regression evidence | Remaining acceptance work |
|---|---|---|---|
| **352** scheduled-origin proof, helper install | `88be90f0` (helpers), `059e8e49` (runbook, pins) | **M** `t-352-scheduled-origin.sh` 134/0 on streamanator: observed command-only cron journal format as fixture; three outcomes (exit 1 / 10 / 0); same-minute manual run, failed cron then manual retry, stale evidence, unreadable journal, wrong dump or hash, active hold, partial installation. Installer precondition failure now exits nonzero and the working backup path is preserved. `t-sunday-review.sh` 29/0 and `t-offhost-stamp.sh` 42/0 still pass | Owner approval to install. Read-only confirmation on streamanator that the installed crontab and the journal agree with the fixtures (formats were taken from Monday's observation, not re-read). **A real disposable cron dispatch was not run** (editing the live crontab was not authorised); Tuesday 24 Nov 03:10 is the first live proof. Monday's finding stands: `afldb_prod-20261123-022145.dump` off-host verified, scheduled origin unproven |
| **352** unchecked backup-state writes | `489615d2`, typing fix `0cef6e7d` | **M** `tests/deploy-web-unit.test.ts`: unwritable backup and verification records keep the prior record and markers, then a clean retry succeeds; 14 pass, and the same cases fail 5 against the reviewed scripts | Reaches production only through an approved release of `tools/maintenance/` |
| **352** encoded backup password | `489615d2` | **M** real `backup.sh` against a stub `pg_dump` with synthetic encoded, plain, backslash and malformed passwords: decoded once into `PGPASSWORD`, never in argv or output; reviewed script left it encoded | Same release; then rotate the credential only after it. Decision needed on whether the production password contains a percent-encoded character |
| **352** R6 pre-check selector | `ce48f8bd` | **M** `t-352-preverify-selector.sh` 27/0; the old first-match selector picks the decoy dump in the fixture, the new one refuses; Wednesday's restore-verification dump is kept distinct | Run Wednesday from the pinned file (`4ca7dd47`) |
| **351** missing executable 2/2 step | `c261232e` | **M** `t-352-revalidate-accept.sh` 25/0: passes only on exit 0 with two distinct ordinals; STOP on 1/2, INCOMPLETE, repeated ordinal, other count, no output, non-zero exit or another season | Wednesday still needs its own backup, attributable off-host pull, restore verification and the attended recovery checks, and a real F-4b run from the R6 boot |
| **362** raw URL under tracing | `3afdf767` | **M** `tests/deploy-release.test.ts` runs the real `server-cluster.mjs`: a synthetic sentinel in path, query and fragment is absent from all output; the reviewed file logs it | Release; keep tracing off by default. Retention plan and the 7 Jan 2027 disposal review unchanged and separately approved |
| **367** Brownlow year publication | `2ebfb2da` | **I** reviewed code: 6 of 17 failed. **M** seeded run: `brownlow-pending-projection` 8/8 on base, **17/17** on tip | Re-review; release; production observation. Open question: whether `revalidatePath` evicts a cached 404 when a year is first published (worst case up to the 3600 s revalidate window); not tested on a built server |
| **368** AFLW replacement coverage | `d4c4d760` | **I** populated disposable DB: the unfixed loader dropped the omitted season (`aflw.seasons` 11 to 10); on the fix omitted season, missing player seasons and header-only input exit 1 before connecting with per-table counts and the `aflw.seasons` checksum unchanged. Contract scenario 10: 54 checks | **Owner decision** (section 5). Re-review; no AFLW load is authorised by this work |
| **374** direct test-target guard | `51040bbe` | **I** real second writable database went from 1 relation to 185 under the unfixed `migrate`/`privileges` (also via a `dbname=` redirect); on the fix both exit 1 and the database fingerprint is unchanged; a permitted `_test` target still migrates (118) and grants. **M** `db-test-rebuild` 1161 pass (+4); `database.test.ts` +4 pass | Re-review. `dev` and `prod` targets deliberately unchanged |
| **375** unknown applied migration | `78c47c14` | **I** extra ledger row: unfixed status and apply exit 0; fixed both exit 1 with catalog and ledger count unchanged. **M** included in the `database.test.ts` result above | Re-review |
| **376** profile invalidation | `805c55fd` | **I** two-worker production-build run with the real `replaceAwardWinner`/`fanOutAwardSeasons`: season-only fan-out left stale profiles on the owning workers; on the fix both players were invalidated on both workers. **M** `settle-season-revalidation` 107 pass (+10), `v2-coleman-projection` 48 pass (+6) | The authenticated `/admin/awards/revalidate` route was not exercised end to end; a correction with no season stays acting-worker-only (LOW); the Brownlow publication action's own fan-out carries no player paths (INFO) |
| **348** parsed-row digest | `1d3b3f19` | **I** with only the sidecar `final_url` changed `--validate-only` passed (rc 0) on the unfixed importer and is refused (rc 1) on the fix; a pin without a digest fails closed. `draftguru-import.test.ts` 47 pass, unchanged skips | **Owner decision** (section 5). Real-data section skipped (raw pages are not on the host). January refresh/re-seal and the 12 Jan production load stay separately approved |
| **377** recall test passes without data | `0eb61367` | **I** unfixed file passed vacuously on an empty migrated database. **M** `player-matching` 20 pass, 3 skipped with an explicit reason, the same 4 failures as the base | Re-review. LOW: other early returns remain elsewhere in the file |

All thirteen issues named in the review remain **open**: the local fixes are not published, deployed or accepted in production. 367 and 368 stay reopened; 374 to 377 are open with a fixed-locally note. The open list recomputed from the records is unchanged: 332, 348, 350, 351, 352, 357, 362, 367, 368, 374, 375, 376, 377.

## 2. Commits (oldest first, above `a77dacb0`)

`88be90f0` `059e8e49` (352 helpers and pins) · `489615d2` (352 backup) · `ce48f8bd` (352 pre-check) · `c261232e` (351) · `3afdf767` (362) · `51040bbe` (374) · `78c47c14` (375) · `1d3b3f19` (348) · `d4c4d760` (368) · `2ebfb2da` (367) · `0eb61367` (377) · `805c55fd` (376) · `4ca7dd47` (runbook pins for the later code, code commit `3afdf767`) · `0cef6e7d` (type fix for the 352 password test). The tracker and this record follow in a documentation commit; the exact re-review tip is the head of the branch and is stated in the hand-off.

## 3. Verification (streamanator, disposable workspaces, Node 22.23.2, isolated PostgreSQL 16)

Base `a77dacb0` and tip `805c55fd` were each extracted whole, built with `npm ci --offline`, given their own loopback cluster, one migrated `_test` database (118 migrations, privileges applied, synthetic credentials) and run under identical conditions.

| Check | Base | Tip |
|---|---|---|
| `npm run typecheck` | exit 0 | exit 0 after `0cef6e7d`. **At `805c55fd` it exited 2** (TS2769 in the new password test) and the build failed with it; found by this comparison and fixed |
| `npm run lint:gate` | exit 0, 338 errors in 43 files (ratchet baseline) | exit 0, 338 in 43, unchanged |
| `npm run build` | not run | exit 0 against a migrated disposable database (a placeholder DSN fails on both trees because `/brownlow/[year]` static params read the database at build time) |
| Full `vitest run` (unit plus integration, JSON reporter) | exit 1; 14,591 passed, 476 failed, 1,044 skipped | exit 1; **14,622 passed, 476 failed, 1,056 skipped** |
| Failing sets compared by file and full test name | | **0 new failures, 0 fixes; identical 476 failing tests**; vitest reports 76 failing files on both (47 with failing assertions, the rest failing in setup) |
| Seeded subset (one `afltables` source row added; Brownlow, eligibility, database, player-matching and SEO files, one file at a time) | 137 passed, 31 failed | 151 passed, 31 failed; 0 new failures |
| Shell harnesses on the tip tree | | `t-352-scheduled-origin` 134/0, `t-sunday-review` 29/0, `t-offhost-stamp` 42/0, `t-352-preverify-selector` 27/0, `t-352-revalidate-accept` 25/0 |
| Focused files (passed, base to tip) | | `db-test-rebuild` 1157 to 1161; `database` 32 to 36; `settle-season-revalidation` 97 to 107; `v2-coleman-projection` 42 to 48; `deploy-release` 59 to 60; `deploy-web-unit` 40 to 45; `reference-data` 71 to 71 |

The 476 failures common to both trees are environment gaps and are not caused by the fixes: the fresh database has no reference data (clubs, players, seasons and so on) so integration files fail or skip in setup (for example `data-editor`, `release-gates`, `nl-answers-*`, 26 in `database.test.ts`, 4 in `player-matching.test.ts`, 1 in `v2-brownlow-eligibility.test.ts`), plus the known missing DraftGuru B1 sample and fitzRoy CSV inputs in the unit set.

## 4. Coverage gaps

- No Playwright, NL stress or populated-data integration run; the integration files that need real reference data or the `afltables` source with more fixtures stay skipped or failing identically on both trees.
- No production, DEV application, real AFLW page or DraftGuru raw-page contact. Real-data section 5 of the DraftGuru contract was skipped.
- The authenticated `/admin/awards/revalidate` route and the Next 404 eviction behaviour (367) were not exercised end to end.
- No real cron dispatch; helper behaviour rests on the observed Monday journal format, the fixtures above and a real process-tree `ps` test.
- The delegated implementer's red demonstrations were not repeated by me; the committed tests were re-run green on the final tree.

## 5. Owner decisions needed

1. **368.** Confirm the committed eleven-key `EXPECTED_SEASON_KEYS` as the authoritative AFLW coverage (no command-line override; a new season such as 2027 needs a reviewed edit and belongs on the rollover checklist), and whether to add the deferred in-transaction check that the staged seasons are a subset of the replacement before truncation.
2. **348.** Historical labels `annual-html-20260826` and `annual-html-20260902` have no reviewed `parsed_rows_sha256` pin, so the new comparison covers only the pinned live label. Pin those digests (nothing was invented or re-pinned) or accept the gap.
3. **352.** Approve installation of the two helpers only after reviewing `88be90f0`, `059e8e49` and `4ca7dd47`; confirm whether the production backup password contains a percent-encoded character before the backup release.
4. **367.** Accept up to the 3600 s revalidate window for a newly published year, or ask for a built-server check.

## 6. Readiness, kept separate

- **Helper install.** Not installed. Needs review of the pinned bytes, the read-only host confirmations in section 1 and your approval. Tuesday 24 Nov 03:10 AEDT will run whatever is installed at that time (the reviewed pair is not installed); without an approved install, the scheduled run cannot prove its origin.
- **Repository push.** Not pushed. Ready for review and your push approval; the branch is local only.
- **Wednesday reboot.** Still **NO-GO** until every live gate passes. This work adds F-4b (executable 2/2 revalidation) and the corrected pre-check. Wednesday still needs its own overnight backup, an attributable off-host pull, the 03:36:35 restore verification and the attended recovery checks; none of Monday's or Sunday's evidence substitutes for them.
