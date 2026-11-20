# Closeout qualification, 21 November 2026 (ISSUE-352, 367, 368, 369)

**Scope.** Local fixes on branch `claude/closeout-20261121` (worktree `D:/dev/afldb-close-20261121`), based on
`b82a6b04` (= live `origin/main` = PREP of release packet 7). Nothing pushed, deployed or run against DEV or production.

| Commit | Content |
|---|---|
| `dcede379` | The five 21 Nov review records, unchanged from `D:/dev/afldb-rem-20261114` (originals retained there) |
| `dc96ae6f` | ISSUE-368 AFLW generation manifest, loader verification, contract |
| `35bbc67f` | ISSUE-352 durable off-host retention hold, extended fixture |
| `295c55c4` | ISSUE-367 public per-match Brownlow gate; ISSUE-369 read-only status |
| `467cd243` | ISSUE-369 test fix (`relkind::text`); **executable tree qualified** |
| `24940377` | ISSUE-352 doc line (`docs/backup-restore.md`) |

**Environment.** streamanator, disposable workspace `/mnt/ssd/afldb-close-20261121` (git-archive exports; own
`node_modules`; isolated PostgreSQL 16 cluster on 127.0.0.1:55669, stopped afterwards), node v22.23.2. RED = `b82a6b04`
with the new tests overlaid. GREEN = `295c55c4` export, then `tests/integration/database.test.ts` replaced by the
`467cd243` blob (`edb3842f`, verified with `git hash-object`) for the rerun. The AFLW proof used a copy of DEV's
read-only parsed extract (8 CSVs, 51,018 rows, dated 15 Aug). Raw logs stay in that workspace; summaries are beside
this file.

## Results

| Check | RED (`b82a6b04`) | GREEN |
|---|---|---|
| 368 review command, header-only files | rc 0, "safe to load" | rc 1, manifest refusal |
| 368 contract `tests/python/aflw_staging_contract.py` | — | 34/34 (also via `reference-data.test.ts`) |
| 368 DB proof (import role loads, owner fingerprints of 8 staging tables and 9 public views) | base loader commits header-only input: staging 0 rows, views 0 rows | 12/12: all-header (with and without manifest), omitted core table and stale optional file refused with staging and views unchanged; changed-after-validation loads the verified rows; zero-issue generation loads; repeated delivery identical; failed COPY rolls back |
| 352 second unchanged pull after a flood alert | exit 0, removed all three protected dumps | exit 1 twice, nothing removed; after the operator lifts the hold, normal retention prunes the oldest |
| 367 integration (seeded season toggled complete/pending) | pending season leaked 3 round-vote rows | accepted: round, match, log (incl. `bv` sort), head-to-head, NL game grain all show votes; pending: all withheld/NULL, admin raw view intact |
| 367 unit (match-log select and `bv` sort) | fails | passes |
| 369 empty target, owner status | rc 0, created `afldb_meta` (2 relations) | rc 0, catalog unchanged (0 relations), "118 pending" |
| 369 empty target, read-only session | rc 1 `cannot execute CREATE SCHEMA in a read-only transaction` | rc 0, catalog unchanged |
| 369 apply from empty | — | 118 applied, then 0 pending |
| 369 populated, read-only session (integration) | fails | passes, catalog identical |
| typecheck / lint gate | — | pass / pass at the 338 ratchet baseline (no new errors) |
| full unit (`--exclude tests/integration/**`) | same 7 tests in the same 2 files fail | 214 files passed, 2 failed, 1 skipped; 12,328 tests passed, 7 failed |

The 7 unit failures (`draftguru-acquisition`, `fitzroy-core-import`) need gitignored local fixtures absent from a
git-archive tree and fail identically at base. Two harness defects were found and fixed during the run (a `"char"`
concatenation in the catalog probe; the AFLW fingerprint included `staging_aflw.issues.id`, an identity column that
`TRUNCATE` does not restart), and the affected steps were rerun.

## Limits

- No rendered-page capture for 367: **VISUAL: UNVERIFIED**. The queries are proven; the match page's BV column hides
  itself when every value is NULL (existing behaviour).
- NL: only the `player_game` `brownlow_votes` predicate changed; the NL corpus and stress runs were not rerun.
- 368: the parser itself was not run on the scrape (the raw HTML corpus is on neither machine). Its new write path
  was exercised on the workstation with a stub `bs4`, real rows and zero issues; the loader accepted the result.
- Integration ran on a schema-only isolated database with a minimal seed, not the full `afldb_test` dataset.
- No DEV or production acceptance. Publication, DEV deployment and production release need separate owner approval.
