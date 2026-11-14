# Run 3, scope `rebuild` — the standard isolated historical rebuild

Worktree `D:\dev\afldb-rem3-rebuild`, branch `claude/rem3-rebuild-20261114`, base and rebuild revision **R = `6d5388ea5305e73b0420fbccfa7b0cea4fe75927`**
(no code, pin, contract, label or expectation was changed; the only commit on this branch is this evidence directory).
Host `streamanator`, workspace `W=/mnt/ssd/afldb-rem3-rebuild-20261114`, cluster `/mnt/ssd/afldb-rem3-rebuild-20261114-pg`, port **55672**,
target database **`afldb_v2_rb_rem3_test`**. Authority: the owner's 2026-11-14 per-task authorisation (`AGENT-BRIEF-COMMON-3.md`).

## 1. Outcome

**PASS.** `tools/db/rebuild-test.ts --target isolated` ran all 30 stages to `Rebuild complete.`, exit 0, in 571 s
(`2026-11-14T10:16:56Z` to `10:26:27Z`, under `flock /mnt/ssd/afldb-rem3-base/heavy.lock`, detached, PID 2179099).
**FINAL VALIDATION PASSED: 91 checks** (`final-validation.txt`; every line `value (expected value)`, none differing). The first attempt was
the only attempt; there was no retry, no stage failure and no refusal.

| Fact | Value |
|---|---|
| fitzRoy baseline actually used | **`c2-2026-final-core-v1`**, selected by the tool itself as the single `accepted` entry of `data/reference/fitzroy-accepted-baselines.json` (accepted 2026-10-27; `full-history-20260902` is `retired`). Printed as `ACCEPTED canonical full-history baseline`. `docs/v2/isolated-rebuild.md` section 3 still names `full-history-20260902` (its 2026-10-19 result); the register is the authority and was not edited. |
| Ladder witness | `c2-2026-final-ladder-v1` (130 files, 1,640 rows); `--compare` passed, `club_seasons_rows = 1640` |
| DraftGuru | `annual-html-20260826`, **no bridge dataset** (PRECHECK: 42 year pages, 5,057 persons, 6,810 picks); `draft_picks = 6810` (ids 1-6810), `draft_persons = 5057`; **no id in 6819-6853** (production's 35 D-336-2 inserts are absent) |
| Migration ledger head | `118_fixtures_unconfirmed_participants.sql`, 118 applied (equal to the production snapshot's ledger) |
| Core | matches 17,056; player_match_rows 695,499; players (validation, afltables profile identities) 13,363; `players` table rows 13,365 (see 6); clubs 24; seasons 131 (1897-2027, 1 in progress); venues 52 |
| Brownlow | `brownlow_season_rows` 16,120; votes total 79,113; winners 112; seasons 98 (1924-2025); `brownlow_round_vote_rows` 320,861 |
| Coleman | `coleman_rows` 47, `coleman_seasons` 47, first season 1980, 0 unlinked, 0 not derived from afltables |
| Awards and honours | all_australian 1,244; club_best_and_fairest 752; named_medals 1,307; under_22 330; rising_star nominations 766 / winners 33; hall_of_fame 343; captaincies 1,781; honour_team_members 113; award_definitions 46; 0 winners without a source |
| Enrichment | heights 12,579 (AFL API evidence 1,916, Wikipedia 84, 0 without evidence, 0 open conflicts); dob 13,347 (2 disagreeing with club lists, 0 conflicts); coaches 386 / match_coaches 32,470 / both-coach matches 16,035 |
| Families and records | father-son 127; siblings 499 pairs; after-siren 126; first-kick-goal 334 |
| Size | 345 MB (361,511,959 bytes), 83 public base tables, comment `afldb-v2-isolated-test` at rest |
| afl_api capture | census verdict `pass total=0`; capture 0/0/0 (no ledger table yet); reinstated 0; `bijection OK` |

Not production parity (nothing was compared with production); the stage banners in `rebuild-trimmed.txt` are the 30 stages in order.
`final-validation.txt` is the verbatim measured list.

## 2. Input inventory and provenance

PRECHECK and the pins need these gitignored inputs (everything else the stages read is tracked). The tracked pin for each is in
`inputs.tsv` with the full expected hash. Search order followed: DEV checkout `/home/arm/projects/afldb/data` (read-only), then retained
host workspaces. Every candidate was verified byte-for-byte against the TRACKED manifest/contract by `scripts/verify-inputs.mjs`
**before** copying (`inputs-precopy-dev.txt`, `inputs-precopy-i316pkg.txt`), copied into `$W/cand/data/` only, `chmod -R a-w`, and re-verified in
place (`inputs-postcopy.txt`, per-file `inputs-files.sha256`, 752 lines). Nothing was fabricated, regenerated, re-acquired, substituted or
fetched from the network; no source location was written.

| Input (label) | Tracked pin | Source used | DEV checkout | Verdict (before copy / after copy) |
|---|---|---|---|---|
| fitzRoy core `c2-2026-final-core-v1`, 132 files | register entry: manifest LF sha `02bbcf93…cf9988`, set hash `817d594e…7b7e` (re-derived from the manifest, equal), 729,288 rows | retained workspace `/mnt/ssd/afldb/workspaces/afldb-i316-rb-I-20261023T0905Z/package/data/sources/afltables/fitzroy_core/c2-2026-final-core-v1` (the ISSUE-316 C2 rehearsal package) | **absent** | VERIFIED 132/132 / VERIFIED 132/132 |
| Ladder witness `c2-2026-final-ladder-v1`, 130 files | fitzroy-contract `accepted_witness`: manifest LF sha `65c29907…7c34`, 1,640 rows | same retained package | **absent** | VERIFIED 130/130 / VERIFIED 130/130 |
| AFL API rosters `rosters-20260905`, 15 files | afl-api-contract `roster.accepted_snapshot`: `61aff99a…69a7` | DEV `/home/arm/projects/afldb/data/sources/afl_api/rosters/` | VERIFIED 15/15 | VERIFIED / VERIFIED |
| AFL Tables club lists `club-lists-20260905`, 21 raw + 21 parsed | afltables-contract `club_player_lists.accepted_snapshot`: `e6d5ae26…3941` | DEV | VERIFIED 42/42 | VERIFIED / VERIFIED |
| AFL Tables coaches `coaches-20260905` raw pages (386 + index) | afltables-contract `coaches.accepted_snapshot`: `3e78f473…8094`; `parsed/` (2 files) is tracked and was verified in place | DEV (`raw/` only copied) | VERIFIED 389/389 | VERIFIED / VERIFIED |
| Coaches raw bundle `coaches-20260905-raw.tar` (ISSUE-319) | `raw_bundle`: sha256 `24680695…1e4a`, 24,023,040 bytes, 387 members | same retained package | **absent** (loose pages only) | VERIFIED sha256 and bytes / VERIFIED |
| DraftGuru Stage A `annual-html-20260826`, 42 raw year pages | `docs/rebuild-manifests/draftguru/annual-html-20260826.json` (`source_urls[].sha256` over RAW bytes; the importer re-parses) | DEV | VERIFIED 42/42 | VERIFIED / VERIFIED |
| first-kick-goal extract `first-kick-goal.csv` (334 rows) | `first-kick-goal.source.json` `extract_sha256` `8f234f3b…a036` (CRLF-normalised) | DEV | VERIFIED | VERIFIED / VERIFIED |

Findings on the memory note (September: `club-lists-20260905`, `ladder-20260828`, `issue129-t7-20260903` not on the workstation): the current
contract pins the C2 pair `c2-2026-final-core-v1` / `c2-2026-final-ladder-v1`, not `ladder-20260828` or `issue129-t7-20260903`, and neither
`c2-2026-final-*` directory exists in the DEV checkout. They survive in the ISSUE-316 rehearsal package and verify exactly. `club-lists-20260905` is in DEV.
`D:\dev\afldbV2\data` and `D:\dev\afldb\data` were **not needed**; no file there was read (disclosure in 7).

Disclosed deviations (all benign, none changes an input byte):
1. The DEV `annual-html-20260826` directory was copied whole with `cp -r`: besides the 42 verified raw pages it holds `http/` and `parsed/` (48 files with
   **no manifest pin**). They are in the checkout, unverified, and unread by the importer (it re-parses the 42 raw pages: `snapshot : annual-html-20260826 (42 year pages, sha256 verified)`).
   The i316 package copy has the 42 raw pages only.
2. All manifest pins were compared after LF normalisation, the same rule as the tool's `manifestSha256`.

## 3. Plan

`plan.out`: `--target isolated --acknowledge-destroy afldb_v2_rb_rem3_test --plan` inside `isolated-pg run`, `AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python`,
`AFLDB_REBUILD_CAPTURE_ROOT=$W/capture-root` (a new directory outside the checkout). 30 stages, no bridge dataset (the bridge child can only be
exported from a rebuilt database, so the documented first rebuild is bridgeless; the child is the step after, section 5). `npm run db:test:rebuild` was never used.

## 4. Run

`scripts/rebuild-launch.sh` / `rebuild-inner.sh`: `setsid nohup`, the heavy lock, output to `$W/evidence/rebuild.out` (54,755 bytes, sha256
`ca121e6e0e5b756612ffe9727261e402afa2f80dfb7b555e9e53684ce3d931a4`, kept on the host; `rebuild-trimmed.txt` is the committed trim). PRECHECK exercised every validator
(fitzRoy `--require-accepted-baseline`, DraftGuru, ladder witness, Brownlow season, heights x3, birth dates, coaches with the mandatory raw replay `AFLDB-COACH-RAW-REPLAY VERIFIED`, father-son, siblings, after-siren, first-kick-goal) before
the destructive stage. Non-fatal importer warnings (unlinked honour rows, 33 unmapped club names kept raw) are the importers' documented censuses.

## 5. Shared artefacts for the next scope (`/mnt/ssd/afldb-rem3-base/rebuilt/`, read-only, `SHA256SUMS` there)

| File | Bytes | sha256 |
|---|---|---|
| `afldb_v2_rb_rem3-6d5388ea.dump` (`pg_dump -Fc`, PG 16.15, 1,658 TOC entries, as it rests: owners, ACLs, no `--create`) | 20,662,515 | `d8397aab92e3ce0cf2a640bb5daeac6594fb0e2c723dc410d82d8e718f165c63` |
| `afldb_v2_rb_rem3-draftguru-bridge-child-v3-6d5388ea.json` (`AFLDB_DRAFTGURU_BRIDGE`; parent `draftguru-person-bridge-20260918-v3.json`; 3,562 of 3,562 parent bridges register exactly once; 1,495 withheld) | 710,882 | `1200e702a6d3b637a50ab0fc61d8ede6cf0564ad18908a361bb0038b451b6e9d` |
| `restore-dump.mjs`, `afldb_v2_rb_rem3-6d5388ea.table-counts.tsv`, `RESTORE.md` | | `SHA256SUMS` |

The dump carries no `COMMENT ON DATABASE` (a `pg_dump` without `--create` omits it), so the isolated-pg marker comes from `create-db`; `RESTORE.md` says so and
gives the recipe (roles, `create-db`, `pg_restore --no-owner --no-comments -j 4`, post-restore checks, the bridge import).
**Recipe verified**: restored once into a second database of my cluster (`afldb_v2_rb_rem3_restore_test`): `pg_restore exit=0 seconds=5 stderrLines=0`,
`isolated-pg verify` printed `ISOLATED TARGET OK`, `list` showed it `marked`, ledger/draft/core probes identical (`probe-restored.json`), and the exact row count of all 83 public tables
identical to the source (`table-counts.diff` is empty). The documented bridge step was run on that copy only: `import_draftguru.py --label annual-html-20260826 --bridge <child>` exit 0,
persons 5,057 / picks 6,810, authority ledger 6 / bridge 3,559 / unmatched 1,493 / live_override 0, reload guard clear (`bridge-import-on-copy.out`).
The dump itself is the pristine bridgeless rebuild: a suite that derives expectations from the child (`draft-linkage`) must import it first, as `RESTORE.md` states.
Choice of parent: v3 is the current immutable parent (it supersedes v2, ISSUE-224); `docs/v2/isolated-rebuild.md` section 5 names the v2 parent, so the command for another parent is in `RESTORE.md`.

## 6. Observations for the owner and downstream scopes (all INFO/LOW; none blocks, none edits a pin)

* `players` table = 13,365 vs the validation's 13,363: ids 13364 (Fred Rodriguez) and 13365 (Riley Onley) are created by the DraftGuru stage via
  `draftguru_explicit_admin_decision` (their only identity); no match rows. Validation counts afltables-profile identities by design.
* The rebuilt database has `fixtures = 0`, no `afl_api` matches and a `seasons` row for 2027 (`131 rows, 1897-2027, 1 in progress`) from the tracked reference data;
  a suite expecting the production snapshot's fixtures or its missing 2027 season (ISSUE-350) will see different preconditions here.
* `docs/v2/isolated-rebuild.md` is stale in three places: section 3 names baseline `full-history-20260902` and 89 checks (now `c2-2026-final-core-v1` and 91), and section 5 names the v2 bridge parent.
  I did not edit it (outside scope).
* The September concern (club-lists / ladder / issue129 inputs absent) does not apply to the current pins: the C2 pair is satisfied by the retained i316 package, so keeping that
  workspace is now load-bearing for any future rebuild. The DEV checkout data lacks the `c2-2026-final-*` snapshots; my host search listing was capped at 60 lines, so other copies may exist.

## 7. Boundaries, incidents and state

Not touched: production host, DEV services/DB/port 5432/`/home/arm/projects/afldb` (read-only copies only), the shared `afldb_test`, ports 55432/55651/55660,
`sudo`, `wsl`, ISSUE-331 paths, `D:\afldb-retained`, any push. No `.env` anywhere in `$W` (`ls -a` of the checkout shows none; the tool loads `.env` from the working directory).

Incidents and disclosures:
* Early in the task I listed directory NAMES (no file read, no git, no writes) under `D:\dev\afldbV2\data\sources...` and `D:\dev\afldb\data\sources\afltables\fitzroy_core` while searching;
  the brief allows `D:\dev\afldb\data` only as a last resort and the host sources sufficed. Disclosed here.
* During the FITZROY stage I copied an untracked probe script into `$W/cand/.probe-rebuilt.mjs`, noticed it, and moved it out within about a minute. It was never executed
  then and nothing reads it; `git status --porcelain` was 0 before and after the run (recorded in `post1.sh`/`stop.out`). Probes that need `node_modules` were later placed
  temporarily the same way (`.probe-*.mjs`), run read-only (`default_transaction_read_only = on`) and removed; porcelain 0 each time.
* Two helper scripts I staged in the host `/tmp` (`rem3rb-setup1.sh`, `rem3rb-schema.mjs`) were removed at the end; they were mine and held no secret.

Final state: `isolated-pg stop` done (`server stopped`), no listener on 55672 (`stop.out`), `pgrep -u arm -af afldb-rem3-rebuild` empty on the re-check after the stop script ended (the first check inside `stop.out` lists only that script itself). Host checkout `HEAD=6d5388ea5305e73b0420fbccfa7b0cea4fe75927`, `git status --porcelain` empty. `du -sh`: `$W` 1.7 G, cluster root 1.5 G. Databases left in the stopped cluster:
`afldb_v2_rb_rem3_test` (the rebuild, marked, pristine apart from the read-only probes) and `afldb_v2_rb_rem3_restore_test` (the verification copy, with the bridge imported).

## 8. Files in this directory

`inputs.tsv`, `inputs-files.sha256`, `inputs-precopy-dev.txt`, `inputs-precopy-i316pkg.txt`, `inputs-postcopy.txt`, `plan.out`, `rebuild-trimmed.txt`, `final-validation.txt`,
`probe-rebuilt.json`, `probe-restored.json`, `table-counts-source.tsv`, `table-counts-restored.tsv`, `table-counts.diff`, `dump.out`, `dump.sha256`, `dump.toc.txt`, `bridge-export.out`,
`bridge-child.sha256`, `restore-verify.out`, `bridge-import-on-copy.out`, `listener.txt`, `stop.out`, `RESTORE.md` (copy), `scripts/` (every script run, LF), `SHA256SUMS`.
No production-derived rows: all values are counts and ids from a database built from retained public sources.
