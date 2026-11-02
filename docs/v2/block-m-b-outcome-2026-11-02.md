# Block M-b outcome (first 2027 fixture window), 2026-11-02

**Status: APPLIED TO PRODUCTION AND VERIFIED.** 218 fixtures for the 2027 season were created by the bounded window (exit 0 CLEAR), the acquisition switch was restored to an explicit boolean `false` and verified, and the independent read-back passed. Package: [block-m-execution-package-2026-11-02.md](block-m-execution-package-2026-11-02.md) section 8. Evidence: [`evidence/block-m-b-20261102/`](evidence/block-m-b-20261102/). Preceded by the [M-a outcome](block-m-a-outcome-2026-11-02.md).

**ISSUE-229 stays OPEN** (acquisition remains disabled; no timer or recurring ingestion exists; the rest of its tracked scope is unchanged). **No Brownlow, timer, grant or restart action was taken.**

## 1. Authority and binding

| Item | Value |
|---|---|
| Approval | the owner's M-b approval of 2026-11-02 (written in the session) |
| Execution revision | `ea98a35f20610e75c18e698bc0d9fe084c3c783d` (R; the docs-only M-a outcome commit `4f7ef1c9` does not replace it; the production checkout stayed at R, clean) |
| Serving release | `ea98a35f2061--vY0EFS0DdR-TiPkxTZz6`, MainPID 3268373, before and after the window |
| Target | `afldb_prod`, `afldb-prod` localhost:5432, system identifier `7674454702926115004`, OID `66668` |
| Snapshot | `afl-api-2027-2026-11-01-012026`: feed sha256 `21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d`, manifest sha256 `63fc997403d5fb4edee2698e98e53e61d04c01ef35ebac1a965a8e8420d179e4` (both re-hashed on the workstation and on the host) |
| Decision reference | `D-MB-20261102 approved first production 2027 fixture ingestion` (identical in the window, the audit rows and `readback-b`) |

## 2. What ran (UTC)

| Step | Time | Result |
|---|---|---|
| Pinned-state `pre` (ledger 118) | 02:22:41 | `PRE PASS`: checkout R clean, every writer unit inactive or absent, serving release `ea98a35f2061--…`, ledger 118 digest `573594e9…af57`, `fixtures_rows=0 matches_rows=17056 switch_raw=(absent)` |
| S1 stage | 02:22:57 | snapshot copied to `/home/arm/projects/afldb/data/sources/afl_api/fixtures/afl-api-2027-2026-11-01-012026` (Git-ignored; checkout still clean); `WINDOW-STAGE PASS`; manifest sha256 equals the approved value |
| S2 backup | 02:23:08 | `/home/arm/backups/afldb/blockm-b-20261102T022308Z`: dump sha256 `c2d7ad3e1d3df46e9fc03fc7618f5dd256f09ea16ab3d37fd0896ab7b2ece7f9`, 29,839,675 bytes, toc 1,651, `RESULT PASS` (11 s) |
| Private copies and restore verification | 02:23 to 02:24 | workstation `D:\tmp\blockm-b-private` (ACL: the operator account only) and streamanator `…/in/prod-mb/` (700/600), hashes equal at each hop; guarded disposable `afldb_v2_blockm_mb_rst_test`: `pg_restore` exit 0, 0 stderr lines, ledger 118, digest `573594e9…af57`, 17,056 matches, 0 fixtures; DEV services unchanged (PIDs 1162113, 1504) |
| S3 check-only | 02:24:53 | `FIXTURE WINDOW CLEAR`, exit 0, nothing written, no watchdog; `preconditions.json` `problems: []`, AFL API and Brownlow units inactive or not found, `absentUnitsAreNotProof: true` (the tool inventoried processes itself) |
| **S4 window** | 02:25:20 to 02:25:27 | run `fxw-2026-11-02T022520565Z-3270427`: watchdog proven ready (deadline 02:42:22), switch ON 02:25:23.455, dry-run `created=218` (exit 0), apply `created=218` (exit 0) at 02:25:26.882, **switch OFF and verified 02:25:26.968 (1 attempt)**, `WINDOW EXIT 0` / `FIXTURE WINDOW CLEAR`. The window held the switch on for 3.5 s |
| S5 `readback-b` | 02:25:40 | `READBACK-B PASS` (below) |

## 3. Independent read-back (afldb_backup, read-only)

| Fact | Required | Observed |
|---|---|---|
| fixtures total \| confirmed \| unconfirmed \| label participants \| null venue \| null date-time \| unconfirmed with a date or time \| batches \| not scheduled | `218\|135\|83\|11\|10\|83\|0\|1\|0` | `218\|135\|83\|11\|10\|83\|0\|1\|0` |
| import batch (`settle-afl-api-fixture-schedule.ts`) | 1 completed, 218 read / 218 inserted / 0 updated / 0 rejected | `1\|completed\|218\|218\|0\|0`; all 218 fixtures attributed to it |
| switch `acquisition.afl_api_current_season_enabled` | explicit boolean false | `boolean:false` (before the window the key was absent; the window wrote `false`) |
| audit rows for the decision | one ON and one OFF of one run | `2:2:1` (2 rows, 2 via `afl-api-fixture-window`, 1 distinct run) |
| `matches` | unchanged 17,056 | 17,056 |
| ledger | 118, digest `573594e9…af57` | equal |
| serving state | unchanged | `NEW_SERVING`, MainPID 3268373, health ok |

`before.json`: fixtures 0, matches 17,056, switch absent; `after.json`: fixtures 218, matches 17,056, switch `false`; `restore-verified.json` and `transition-trimmed.json` (events: switch-on, dry-run exit 0, apply exit 0, switch-off verified) are in the evidence directory. The full `transition.json` and `preconditions.json` (105 KB of host process inventory) stay on the host in `/home/arm/blockm-b-20261102T022239Z-run/` and `…-check/`.

## 4. Visual inspection of `/admin/fixtures` (production, headed Playwright, owner signed in; read-only)

No form was submitted, no credential, cookie or storage was read or saved, and the browser was closed afterwards. The 2027 route returned the table of 218 rows read from the rendered page.

| Check | Observed |
|---|---|
| `/admin/fixtures` season table | 2027 NEXT SEASON: 218 fixtures, 30 rounds, 0 played, TBC date/time/venue **83 / 83 / 10**, 0 cancelled |
| `/admin/fixtures/2027` rows (counted from the rendered table) | 218 rows: **135 CONFIRMED, 83 UNCONFIRMED**; 11 rows with a label participant (`TBC (Winner of PF1)`, `TBC (Lowest-ranked WF Winner)`, `TBC (1st)` and similar); 10 `Venue: TBC`; 83 `Date: TBC`; 0 unconfirmed rows with a date; 0 played; 0 not-scheduled |
| Label fixture detail | `/admin/fixtures/2027/<id>` for `TBC (Winner of PF1) v TBC (Winner of PF2)` renders (HTTP page, not 404): date and time TBC, venue Melbourne Cricket Ground, UNCONFIRMED, importer-managed read-only notice |
| Desktop 1440 px | table columns readable; label participants muted; UNCONFIRMED badge; no horizontal page overflow |
| Mobile 390 px (375 px viewport) | each fixture becomes a card (date, venue, status, confirmation "· provider-managed", played, View); no horizontal page overflow |
| Diagnostics | 2027: INFO only (83 unconfirmed, 218 scheduled, bye or incomplete-round notes for rounds 11 to 15 and the finals). 2026: WARNING "218 played match(es) in this season have no fixture" (2026 has 0 fixtures; **not changed by M-b**: 2026 had no fixtures before the window either; the season page listed it as "1 TO REVIEW") |

Screenshots: `admin-fixtures-desktop-top.png`, `admin-fixtures-2027-desktop-labels.png`, `admin-fixtures-2027-mobile-top.png`, `admin-fixtures-2027-mobile-labels.png`, `admin-fixture-label-detail-desktop.png`. A full-page capture (18,710 px tall) was discarded as unreadable and because it showed the signed-in account. **Not visually inspected:** dark mode, tablet width, any state other than the one listed.

## 5. Rollback position now (binding wording, package section 10)

A code-only rollback to `fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy` keeps the public pages and the 135 confirmed fixtures working, **but** the previous admin does not show the 83 unconfirmed fixtures and the 11 label-participant fixtures are invisible to it (their detail page returns 404). No data is lost. It is **not a full-fidelity rollback**. The full-fidelity routes (the pre-M-a backup `blockm-a-20261102T014742Z`, which discards every write since its capture, or the schema-undo script) each need their own owner approval and are not authorised. Nothing was rolled back.

## 6. Earlier Brownlow baselines are unsuitable as current evidence

*Corrected 2026-11-02 ([record](block-b-b0-preparation-2026-11-02.md) section 10): M-a changed the ledger to 118; M-b did not (the ledger was 118 before and after this window). The earlier backups remain valid retained recovery archives; they are unsuitable as current Brownlow baseline evidence, not invalid backups.*

Per the master sequence (section 3), every Brownlow baseline, backup and restore evidence taken **before** this window is unsuitable as current Brownlow baseline evidence and must be retaken immediately before its own `plan`. Tables the Brownlow baseline hashes that this window changed: `import_batches` (+1 completed fixture batch), `site_settings` (absent to an explicit boolean `false`), `auth_audit_log` (+2: the ON and OFF rows) and `fixtures` (+218). (`afldb_meta.schema_migrations` moved 117 to 118 in M-a, before this window, and did not move in it.) Block L's earlier change to `data_edits`/`data_overrides` was already in force. The restored-copy baselines of the Block B rehearsal are disposable-clone evidence and were never production baselines, and no production Brownlow baseline, backup, plan or approval exists yet. Block B's own rule already re-takes the baseline in every stage (S2 to S6, a fresh backup per stage). The two M backups (`blockm-a-…`, `blockm-b-…`) are **not** Brownlow baselines and must not be offered as such. Retained evidence of any Block B/C artefact that predates 2026-11-02T02:25:27Z should be treated as stale.

## 7. Disclosures

* Left on the host, outside Git, nothing cleaned up: `/home/arm/blockm-*.sh` step scripts and `.out` logs, `/home/arm/blockm-snap-20261102T022239Z`, the M-b run and check evidence directories, `/home/arm/blockm-varsb.sh`, and the staged snapshot under the checkout (Git-ignored). On streamanator `/tmp/rvrunb.sh`, `/tmp/rvm-R.sh`, `/tmp/blockm-rv-mb.log` remain (the log is copied to the evidence directory).
* All backups are retained: `blockm-a-20261102T014742Z` (ledger 117), `blockm-b-20261102T022308Z` (ledger 118, **taken immediately before the window, so it is also the restore point for "the window never ran"**), the Block L backup and older ones.
* The switch was ON for about 3.5 s; every AFL API unit was inactive or absent throughout; the watchdog was never needed.
* One tool call earlier in the session (M-a) hung once on SSH; none in M-b.
