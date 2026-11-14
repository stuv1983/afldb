# Rollover remediation (2026-11-14): ISSUE-350 season opening and ISSUE-332 preparation

Branch `claude/rem-rollover-20261114` (base `5035ed96`, review of `origin/main` `de640826`). Written by the rollover worker under the owner's run authorisation
(`AGENT-PROTOCOL.md`, `RUN-PLAN.md` `## rollover`, `PLAN-REVIEW.md` O-1 to O-10 and R-1 to R-6). Nothing here was pushed, merged, deployed, restarted or written to
any production or DEV database. The two live reads (production, DEV) were SELECT-only inside `READ ONLY` transactions and are listed in section 7.

This README is the evidence map and the approval-packet pins. The authoritative text is the code and the raw logs it names. A number is quoted only where a
log in this directory (or the host path named beside it) shows it.

## 1. Verdicts

| Finding | Verdict | Evidence |
|---|---|---|
| ING-1 (ISSUE-350): production has no 2027 `seasons` row and the AFL API settle never creates one | **Validated** | Source: `runSettleAflApi` (`src/lib/acquisition/settle-afl-api.ts`) never ensures a season row; `createMatch` does (`src/db/queries/match-admin.ts:203-210`) but then refuses clubs whose `afldb_identity_for_season(org, season)` is NULL (:212-223). The only routine creator is `tools/migration/load_reference_data.py` (`load_seasons` :220-240, `load_clubs` :244-280); `tools/db/rollover-season.ts` edits tracked files only. Live (section 7): production seasons stop at 2026, 18 current clubs hold `last_season` 2026, none is open. Reproduction: section 6, run A on the unfixed base fails `23503 afl_api_match_season_fkey`. |
| OPS-4 (ISSUE-332): a failed nightly is neither retried nor alerted | **Validated** | `deploy/afldb-settle-afl-api.service` has no `OnFailure=`; the wrapper only echoes `AFLDB_SETTLE_FAILURE` to the journal, which `arm` cannot read (operating record section 3). |

## 2. What defines the 2027 row (the contract), and what the operation derives from it

The tracked contract already says 2027 (applied by `c7e17da2`, the ISSUE-316 rollover): `data/reference/seasons.json` `last_season` 2027, `in_progress_seasons` [2027],
`season_notes` {"2027": ...}, `league_eras`; `data/reference/clubs.json` has the identities with `last_season` null (the open era of a current club). A freshly loaded
database derives, in `load_reference_data.py`:

- `seasons`: `year`, `league` (from `league_eras`), `status` (`in_progress` for a year in `in_progress_seasons`), `notes` (from `season_notes`). Every measured column (`first_match_date`,
  `last_match_date`, `match_count`, `club_count`, `data_through_date`, `source_built_at`, `last_loaded_round`, `completed_at`) stays NULL; no date is invented.
- `clubs.last_season`: an identity whose `clubs.json` `last_season` is null takes `seasons.json` `last_season`. Closed identities keep theirs. `first_season` is never touched.
- `club_organizations.last_season` = max over members; `is_active` = (max over members = max(`seasons.year`)), which is already true for every open organisation before and after.

`src/lib/rollover/season-opening.ts` derives exactly that from the two tracked files (`expectedOpening`) and refuses anything the contract does not state
(a year other than `last_season`, a year not in progress, a register in which a no-`last_season` identity is not a current club).

## 3. What was built

| File | Purpose |
|---|---|
| `src/lib/rollover/season-opening.ts` (new) | Pure contract, SELECT-only reader (`readOpeningFacts`), three-valued classifier (absent -> change, equal -> nothing, different -> REFUSE; **no `ON CONFLICT`**), bounded writer, canonical surface digest, and `transitionProblems` (the in-transaction proof). |
| `tools/v2/issue350-season-open-production.ts` (new) | The reviewed operation, I336 pattern: `describe`, `baseline`, `plan`, `apply`, `verify`, `state`; stage `I350`, operation `issue350-season-open`. One transaction as `afldb_import`, `LOCK TABLE seasons, clubs, club_organizations IN SHARE ROW EXCLUSIVE MODE`, baseline re-read in the transaction (drift refuses), writes, one audit `import_batches` row, then the proof; any problem rolls the transaction back. Every connection pins `TimeZone=Etc/UTC`. |
| `tools/v2/season-opening-check.ts` (new) | The read-only ISSUE-332 gate check. Exit 0 OPEN, 10 NOT_OPEN, 11 REFUSED, 2 usage/helper error. One `READ ONLY` `REPEATABLE READ` transaction, `TimeZone` pinned and asserted, optional identity assertion (`--expect-database/--expect-oid/--expect-sysid`) before any other read. |
| `src/lib/acquisition/settle-afl-api.ts` | The settle HALTs `season_row_missing` before any write when the run has units to write and the season has no `seasons` row (section 4). |
| `tools/v2/gap029-assemble-restore-evidence.ts`, `tools/v2/gap029-ops-lib.ts`, `tools/v2/gap029-ops/{prod-stage,capture-prod-stage,restore-assemble-host}.sh` | Stage `I350` in the production-stage ceremony, so the sealed, restore-verified backup evidence and the owner approval work exactly as for I336. |
| `deploy/afldb-settle-failure@.service`, `deploy/afldb-settle-failure-notify.sh`, `deploy/afldb-settle-afl-api.service.d/on-failure.conf` | ISSUE-332 failure notifier (section 9). Prepared, not installed. |

## 4. The settle decision (evidence-based)

Decision: **pre-check and fail fast; never create a season row silently.** The nightly runs as the narrow `afldb_import` role with a deliberate credential boundary; a row that
changes `afldb_season_list_clubs`/`afldb_identity_for_season` and every `max(year)` consumer (section 5) is a reviewed, owner-approved operation, not a side effect of a nightly.

`runSettleAflApi` now reads `SELECT year FROM seasons WHERE year = $1` inside the settle transaction, after `loadRefs` and before the `import_batches` INSERT, **only when
`bundle.units.length > 0`**. Absent -> `AflApiSettleHalt('season_row_missing', { season, units, remedy })`: the existing HALT path rolls back, nothing is written, the CLI prints
`HALT: season_row_missing` and exits 1, and no absence finding is recorded. A run with no units (every off-season night, which succeeds on production today without the row)
never reads the season, so the off-season nightly is unchanged (proved in section 6, run N, and by the stub test `a run with no units never reads the season`).

**Line shift (review O-10).** `src/lib/acquisition/settle-afl-api.ts` gains 4 lines at about line 347 (the exported `AFL_API_SEASON_ROW_MISSING_HALT_REASON`) and 14 lines inside
`runSettleAflApi` before the `import_batches` INSERT (about line 2003). `tests/v2-acquisition-pipeline.test.ts:372-375` compares `docs/v2/architecture.md` section 9 with the
rendered stage map, which embeds source line numbers; that document must be regenerated at integration (the orchestrator). This is expected to be the one red test in section 5.

## 5. Public and admin effect of opening the season (review O-4)

Run `q-public-effects.sql` before and after on the same database (section 6 shows the diff on a snapshot copy). The readers it reproduces:

| Reader | What changes when the 2027 row exists |
|---|---|
| `src/app/page.tsx:55-66`, `src/db/queries/overview.ts:34-45` | Home totals: `seasons` +1 and `lastSeason` 2026 -> 2027. |
| `src/db/queries/seasons.ts:213` (`getSeasonBounds`) | The season picker ceiling becomes 2027: `/seasons/2027` becomes a valid season page with no matches. |
| `src/db/queries/admin-fixtures.ts:218`, `admin-season-lists.ts:212` | The administrable season ceiling becomes 2027 (fixtures and season lists for 2027 become editable in the admin). |
| `src/db/queries/db-health.ts:46` | The health card `seasonMax` becomes 2027. |
| `src/db/queries/club-comparison.ts:1744` (`SEASON_COLUMNS`) | 2027 appears as a selectable comparison season, provisional (`status <> 'complete'`). |
| `src/db/queries/player-derived.ts:737-758` | Brownlow coverage labels for a season in progress read `pending`; this only matters for 2027 rows a recompute creates. |
| migration 096 `afldb_season_list_clubs` | The arm switches on `max(year)`: proved unchanged for 2026 and 2027 by the in-transaction proof. |

**Timing recommendation (owner decision D-350-1, below):** the row has visible effects (a 2027 season page with no matches, a 2027 comparison option, 2027 in the admin
season-list ceiling), so open it when 2027 should become visible, and no later than the last scheduled nightly before the first concluded match. The settle fires at 05:00
Melbourne after a match concludes (Opening Round is 2027-03-17 in the operating record, so the earliest affected run is the morning after its first match); opening it **at least a week before Opening Round** leaves time to
discover and correct a problem before the first night that matters, and leaves the whole off-season with 2026 as the visible season. Opening it now is also safe (the rehearsal
shows no change to any 2026 or earlier identity or list) but exposes empty 2027 surfaces for four months.

## 6. Rehearsal results (disposable isolated cluster only)

Where: DEV host `streamanator`, workspace `/mnt/ssd/afldb-rem-rollover-20261114`, isolated PostgreSQL 16 cluster on `127.0.0.1:55619` (guarded by `tools/v2/isolated-pg.ts`; database names end in `_test`),
every database a copy of the template `afldb_v2_remrollover_tmpl_test` (production snapshot of 2026-11-04, ledger 118; its surface digest equals the live production digest of section 7, so the
snapshot is a faithful pre-opening state for these tables). No production or DEV database was written. Raw logs: `$W/evidence/q3/` (the final script run) and the per-phase directories under `$W/evidence/`
(`red`, `green-a`, `open-a`, `green-c`, `offseason`, `tz-b`, `reverse`); their sha256 values are in the hand-back report. Driver: `rehearse350.sh`; inner flow: `rehearse-opening.inner.sh`.

| # | Check | Observed |
|---|---|---|
| 1 | **Red**: a nightly-shaped settle for season 2027 (1 unit, no 2027 row) on the UNFIXED base `de640826` | threw `23503 afl_api_match_season_fkey` on `staging.afl_api_match`; `matchesAfter` 0, `batchesRetained` 0 (`red/run-a.out`) |
| 2 | **Green**: the same settle on the fixed candidate | `applied` false, `halt.reason` `season_row_missing` with the remedy text, `canonicalRowsInserted` 0, `matchesAfter` 0, `batchesRetained` 0 (`green-a/run-a.out`) |
| 3 | Before the opening (clone a) | `season-opening-check.ts` exit 10 `NOT_OPEN`, 18 open identities, `afldb_season_list_clubs` 18/18, surface digest `de1f574b...` (equal to production) |
| 4 | `plan` then `apply` (rehearsal, writer `afldb_import`) | plan "NOT_OPEN: season row to insert, 18 clubs and 18 organisations to update"; apply `COMMITTED_VERIFIED`: `seasonInserted` true, `clubsUpdated` 18, `orgsUpdated` 18, one audit batch; `verify` 0 problems; `state` "PLANNED RESULT PRESENT" |
| 5 | After the opening | check exit 0 `OPEN`, `identityResolvedForYear` 18, lists still 18/18, surface digest `803bd836...` |
| 6 | Second `plan` and `apply` on the opened database | plan "OPEN: 0 clubs and 0 organisations to update"; apply `NOTHING_WRITTEN` (exit 0); digest unchanged. `baseline` without `--rehearsal` on a clone is refused by design |
| 7 | Public and admin effect (`q-public-effects.sql`, `open-a/public-diff.txt`) | home `seasons` 130 -> 131 and `lastSeason` 2026 -> 2027; season bounds, admin ceiling and db-health `seasonMax` 2026 -> 2027; the 2027 row is `VFL/AFL`, `AFL`, `in_progress`, with every measured column NULL; clubs and organisations holding `last_season` 2027: 0 -> 18; `identity_2027_resolved` 0 -> 18; `season_list_2026` and `season_list_2027` and `identity_history_2026` rows identical before and after |
| 8 | After the opening, the same nightly-shaped settle (green-c) | gets past the season foreign key and the canonical write, then the harness fixture (a preliminary-final match, no home-and-away match in the season) is refused by `recomputeClubSeasons: no canonical home-and-away matches for season 2027; refusing to rebuild club_seasons from nothing`, `matchesAfter` 0. This proves the `23503` is gone; it does **not** prove a successful nightly, because the shared fixture is not a home-and-away round |
| 9 | The off-season nightly after the opening (zero units, complete season feed) | `applied` true, no halt, completeness `complete`, one committed no-op batch (76 -> 77). The no-units path never reads `seasons` (stub test), so it is also unchanged on a database without the row |
| 10 | O-3 time zone: clone b with the database default set to `Australia/Melbourne` (production's host zone) | same plan, apply, verify and check outcomes; `tz-proof` digest is identical under the pinned `Etc/UTC` session, an unpinned Melbourne session and a Melbourne-defaulted helper, before (`de1f574b...`) and after (`803bd836...`) |
| 11 | O-6 writer role | the apply ran as `afldb_import` on the clone; the granted privilege set on the five relations of the clone's three roles (30 grants: `afldb_import` 20, `afldb_app` 5, `afldb_backup` 5) is identical to production's (section 7) |
| 12 | Reversal (`reverse-opening.sql`) | dry run on clone a: "reversed: 18 clubs, 18 organisations, 1 seasons row", ROLLED BACK; on clone b: dry run, then `COMMITTED`, then check exit 10 `NOT_OPEN` with surface digest `de1f574b...` again (back to the baseline). The refusal with dependents was **not** exercised in the final run (clone a held no dependent row after row 8 rolled back); the mechanism is the foreign keys onto `seasons(year)` named in the file header |
| 13 | Integration `afl-api-c7-observation.test.ts` (3 database shapes) | snapshot copy 6/6, schema-only database 6/6, opened clone 6/6. Oracles: the real tracked `seasons.json`/`clubs.json` for the two clone shapes (production-like or already-open, the test restores production's pre-opening state inside its rolled-back transaction); a stated synthetic world (3 identities, a previous season, `club_seasons` rows) for the schema-only shape. No snapshot-derived literal count is asserted (R-4) |
| 14 | Unit suites (`season-rollover`, `afl-api-ingestion-safety`, `gap029-assembly`, `gap029-ops`, `v2-season-seal`, `v2-acquisition-pipeline`, `deploy-web-unit`) | all pass except the one expected line-shift failure of section 4 (`v2-acquisition-pipeline` (e), the rendered stage map) |

Harness corrections made on the way (test and evidence code only, each a separate commit): the schema-only synthetic world first failed `club_organizations_first_season_fkey` and then
`afldb_season_list_clubs(previous) changed` because the historical arm needs a `club_seasons` row (now a stated precondition, section 7); the repro generator now removes the exact keyed rows and the
label-scoped batches a snapshot copy or an earlier mode leaves behind (the real `afl_api` identity row for the fixture player exists on a production copy).

## 7. Live read-only facts, 2026-11-14 (production and DEV), and the pins

Both reads ran the same esbuild artifact (`live-checks/prod-facts.bundle.mjs`, sha256 `9a57e289a08c8af0cf89e8c4546039a9a87fba010dcfa4c1a58ef8947ca5028a`; source
`prod-facts-entry.mts`), as `afldb_backup`, in one `READ ONLY` transaction with `TimeZone=Etc/UTC`, aggregates and ids only (no row content, no DSN, no dump). Raw results:
`live-checks/prod-facts-20261114.json`, `live-checks/dev-facts-20261114.json`; the wrappers that carried them are `live-checks/*-facts-header.sh`.

| Pin | Production `afldb_prod` | DEV `afldb_dev` |
|---|---|---|
| identity | OID 66668, sysid 7674454702926115004, read-only on, TZ `Etc/UTC`, ledger 118 (`118_fixtures_unconfirmed_participants.sql`) | OID 202860, sysid 7673872117032104869, port 5432, ledger 118. DEV identity is asserted by database name only; OID and sysid are recorded, not previously reviewed |
| verdict | `NOT_OPEN`, `seasonRow` change | `NOT_OPEN` |
| open identities | 18 (club ids 1, 3, 4, 5, 6, 9, 10, 11, 12, 13, 15, 16, 17, 18, 20, 21, 23, 24; all `last_season` 2026); 18 clubs and 18 organisations to change | same |
| seasons | max year 2026; 2025 and 2026 `complete`; 2026 `match_count` 218; `identityResolvedForYear` 0; `afldb_season_list_clubs` 2026 and 2027 both list 18 | same |
| dependents of a 2027 row | `matches` 0 for 2027; none of the 32 foreign keys onto `seasons(year)` holds a 2027 row; `fixtures` has 218 rows for 2027 (no foreign key) | `fixtures` 3 rows for 2027 |
| `import_batches` | 86 rows, max id 93 | 86 rows, max id 153 |
| **surface digest** (`seasons`, `clubs`, `club_organizations`, `afldb_season_list_clubs` for the two years; deliberately excludes `import_batches`) | `de1f574beadbd52ce6a1c02f37adc9754a126c859dfd335728c06447c5464a1c`, identical on two reads | identical to production |
| `afldb_import` privileges | SELECT, INSERT, UPDATE, DELETE on `seasons`, `clubs`, `club_organizations`, `import_batches`, `sources` (20 privileges); `afldb_app` and `afldb_backup` hold SELECT only | same 20 privileges |

The digest excludes `import_batches` because the nightly writes a batch row every night; it would drift between the plan and the apply for a reason that has nothing to do with the
opening. The plan therefore **re-baselines at plan time**: the digest above is the 2026-11-14 pin, not the value to approve. The apply re-reads the baseline inside the write
transaction and refuses on any difference from the plan's baseline.

**Precondition surfaced by the rehearsal.** `afldb_season_list_clubs(previous year)` switches from the "current identities" arm to the "historical" arm when a newer season row
appears, and the historical arm requires a `club_seasons` row per club for that year. Production holds them (the list returns 18 before and after in the rehearsal), and the in-transaction
proof (`transitionProblems`) rolls the opening back if the list for either year would change. The synthetic-world test needed a `club_seasons` row for exactly this reason.

## 8. Production procedure (owner-driven; nothing in this branch runs it)

Roles and files: the tool reads as `afldb_backup` (`AFLDB_GAP029_DSN`) and writes as `afldb_import` (`AFLDB_GAP029_WRITE_DSN`); `prod-stage.sh load_dsns` takes both from the credential
channel and never prints them. The ceremony is the I336 one, stage `I350`, on the production host from a clean checkout pinned at the frozen revision `R` (40 hex):

1. `bash prod-stage.sh prep R <tar sha256>` (upload and pin the checkout).
2. `bash prod-stage.sh preflight R I350` (order gate, exclusivity, live identity and ledger).
3. `bash prod-stage.sh capture R I350` (one fresh pre-change backup; run name `I350-<UTC stamp>`).
4. Restore the dump on an isolated cluster and assemble the sealed evidence with `restore-assemble-host.sh` (`STAGE=I350`, the stage runs `baseline --rehearsal` against the restore).
5. `bash prod-stage.sh plan R I350 RUN` (read-only plan: classifies the live state against `seasons.json` and `clubs.json`, seals a digest, writes the manifest and summary).
6. The owner reviews the summary (`INSERT 1 seasons row ... UPDATE clubs.last_season ... one audit import_batches row; nothing else`) and the plan digest, then
   `bash prod-stage.sh approve R I350 RUN <DIGEST> <STATEMENT_FILE> <EXPIRES> [NOT_BEFORE]`: the approval is written only if the typed digest is this plan's digest and the statement names D-350-1 and the digest.
7. `bash prod-stage.sh apply R I350 RUN`: gates, approval, ONE detached apply, post-run state probe, outcome report. No retry, no automatic restore.
8. `bash prod-stage.sh accept R I350 RUN` (read-only: outcome, state, `verify`), then `node --import tsx tools/v2/season-opening-check.ts --dsn-env AFLDB_BACKUP_DATABASE_URL
   --expect-database afldb_prod --expect-oid 66668 --expect-sysid 7674454702926115004` must exit 0 (`OPEN`).

Outcomes and exit codes are `gap029-common.ts`'s (`COMMITTED_VERIFIED`, `NOTHING_WRITTEN`, `ROLLED_BACK`, `OUTCOME_UNDETERMINED`). A second apply on an opened database is the proven no-op (section 6).
The apply refuses without a clean `HEAD`, a fresh backup (age-bound by the plan expiry), verified restore evidence and an approval pinned to the digest.

## 9. ISSUE-332: failed-nightly notification, the gate wording, and the operator runbook

**Prepared, not installed.** Nothing in this branch changes the live `afldb-settle-afl-api.service`, its `.sh` wrapper or any installer. The three new files are independent of every
installer and sync path (a test asserts no installer references them). Owner-run install, in this order (the drop-in names the template; with the template absent systemd only warns):

```
sudo install -m 644 -o root -g root deploy/afldb-settle-failure@.service /etc/systemd/system/afldb-settle-failure@.service
sudo install -d -m 755 /etc/systemd/system/afldb-settle-afl-api.service.d
sudo install -m 644 -o root -g root deploy/afldb-settle-afl-api.service.d/on-failure.conf /etc/systemd/system/afldb-settle-afl-api.service.d/on-failure.conf
sudo systemctl daemon-reload
```

Removal: delete the drop-in and `daemon-reload`. The notifier validates its instance against the two settle units, writes `/var/lib/afldb-settle-failure/<unit>.failed` atomically and appends one line
to `failures.log`; it opens no database, reads no credential and sends nothing by itself. `AFLDB_FAILURE_TRANSPORT` (an executable called with the marker path) is the owner's later wiring
point for a mail relay or webhook; the application mailer is not reused because the settle units drop every SMTP credential (ISSUE-232). It is a notifier, not a retry: the nightly still has no Start
control (operating record section 3, D-316-11) and `arm` cannot read the journal without the owner's `sudo`.

`systemd-analyze verify` (user-level, systemd 255, on the host; log `evidence/systemd-verify.out` on the host workspace, summarised here): the instance of the notifier template
and the settle unit with the drop-in both verify with no warning; a control copy of the notifier with `PrivateNetwork` misspelled warns `Unknown key name 'PrivateNetwrk'`, so the verifier does
read these files. A negative control with the template absent produced no warning at this systemd version (the missing `OnFailure=` target is only reported at activation), which is
why the install order above is stated and not left to the verifier.

**Proposed ISSUE-332 gate wording** (to be added to the ledger entry and the operating record section 10 by the orchestrator; this branch does not edit them):

> G0 (before Opening Round, by 2027-03-10): the 2027 season is open in the production database. Evidence: `node --import tsx tools/v2/season-opening-check.ts --dsn-env AFLDB_BACKUP_DATABASE_URL
> --expect-database afldb_prod --expect-oid 66668 --expect-sysid 7674454702926115004 --json` exits 0 (`OPEN`), or the owner-approved I350 run's accepted outcome. Exit 10 (`NOT_OPEN`) on or after 2027-03-10 blocks the
> Opening Round gate; exit 11 (`REFUSED`) is a stop. G1 and G2 may not be signed while G0 is unsatisfied, because without the season row the first concluded round fails `season_row_missing` (settle HALT).
> G0b (owner decision D-332-1): the failure notifier is installed (above) and a transport is configured, or the owner records that the manual per-round check of section 3 of the operating record stands in for it.

**Operator runbook for a failed nightly** (as `arm`, no sudo unless stated):

1. Marker: `ls -l /var/lib/afldb-settle-failure/` and `cat /var/lib/afldb-settle-failure/afldb-settle-afl-api.failed` (only after the owner installs the notifier). Stale once a later run succeeded.
2. Unit state: `systemctl show -p Result,ExecMainStatus,ActiveExitTimestamp afldb-settle-afl-api.service`.
3. Reason (owner sudo, `arm` is not in `adm` or `systemd-journal`): `sudo journalctl -u afldb-settle-afl-api.service --since yesterday --no-pager | grep -E 'AFLDB_SETTLE_FAILURE|HALT|REFUSED|ERROR|FAILED'`.
4. Database view: `c7-observe.ts --season 2027 --since <ISO instant of the first night of the round> --json` (`NO_BATCH` = the run did not happen or refused and rolled back).
5. `HALT: season_row_missing` -> the season is not open: run the opening operation (section 8, owner approval), then wait for the next scheduled 05:00 run. Never start a manual settle.
6. `require_complete_source` / `unresolved identity` -> the C6 debutant routine (operating record section 3).

## 10. Recovery of an opening

`reverse-opening.sql` is an owner-run, single-transaction, count-bounded reversal (as `afldb_owner`, through `run-sql.mjs` or `psql --single-transaction`); it is **not** an application path and
nothing invokes it. Use it only when no row depends on the new season. It restores exactly `clubs.last_season`, `club_organizations.last_season` for the planned ids and then deletes the `seasons` row; the
foreign keys onto `seasons(year)` refuse the delete if anything depends on the row (the intended "dependents present, do not reverse" signal), and the audit `import_batches` row is history and stays.
The two id lists in the file are the 2026-11-14 production values and must be re-checked against the approved plan's `changes.clubIds` and `changes.orgIds` before any use. Rehearsal: section 6.

## 11. Owner decisions

| # | Decision | Options | Recommendation | Exact change if approved | Recovery |
|---|---|---|---|---|---|
| D-350-1 | Open the 2027 season in production, and when | (a) now; (b) at least a week before Opening Round 2027-03-17 and after approvals; (c) not at all | **(b)** | One run of the I350 ceremony (section 8): 1 `seasons` row, `last_season` 2027 on 18 clubs and 18 organisations, 1 audit `import_batches` row | `reverse-opening.sql` while no row depends on 2027; after that, a reviewed correction |
| D-350-2 | Settle behaviour when the season row is missing | (a) HALT `season_row_missing` (this branch); (b) let the nightly create the row | **(a)** | Already in code, reaching production only with a normal release | Revert the 18-line settle change |
| D-332-1 | Install the failure notifier, and choose a transport | install now / install later / manual per-round check only | install the template and drop-in (section 9) and wire a transport the owner already operates | The four `sudo` commands in section 9 | Delete the drop-in and `daemon-reload` |

## 12. Proposed ledger and changelog text (the orchestrator integrates; this branch edits neither file)

**ISSUE-350 (open, High, until the opening is applied and the gate passes).** Root cause: the AFL API settle never creates a `seasons` row and nothing but `load_reference_data.py` (a full reload)
does; production seasons end at 2026 and every current club identity ends at 2026, so the first concluded 2027 match would fail `afl_api_match_season_fkey` (rehearsal run A). Fix in this branch: the audited
`issue350-season-open` operation (stage I350, the I336 ceremony), the read-only `season-opening-check.ts`, and the settle `season_row_missing` HALT. Validation: section 6 of this README. Remaining: owner
decision D-350-1, the production run, the check exit 0, and the regenerated stage map (see below).

**ISSUE-332 (stays open).** Add row G0 and G0b (section 9) and record the notifier as prepared, not installed.

CHANGELOG Unreleased lines:

- Added the audited season-opening operation (`tools/v2/issue350-season-open-production.ts`, ceremony stage I350, `src/lib/rollover/season-opening.ts`) and the read-only `tools/v2/season-opening-check.ts` (ISSUE-350).
- The AFL API settle now HALTs `season_row_missing` before any write when a run has units for a season that has no `seasons` row (ISSUE-350); off-season runs without units are unchanged.
- Prepared (not installed) a failure notifier for the nightly settle: `deploy/afldb-settle-failure@.service`, `deploy/afldb-settle-failure-notify.sh`, `deploy/afldb-settle-afl-api.service.d/on-failure.conf` (ISSUE-332).

**Integration items the orchestrator must handle:** (1) regenerate `docs/v2/architecture.md` section 9 (stage map line numbers) so `tests/v2-acquisition-pipeline.test.ts` section (e) passes (section 4); (2) `tools/v2/gap029-ops/prod-stage.sh` is
edited here (stage allowlist) and the owner has unrelated uncommitted edits to it in `D:\dev\afldb`, so expect a merge conflict to resolve by hand; (3) the ledger entries above.

## 13. Out-of-scope observations (not acted on)

- `afldb_season_list_clubs` switches arm on `max(seasons.year)`, so inserting any later season row changes the list for earlier years unless `club_seasons` exist for them (section 7).
- The nightly writes `import_batches` rows (hence the digest excludes that table).
- A leftover 2071 fixture season in a shared test database would fail the production-like test's `max(year)` check by design (message names it).
- `data_edits.table_name` has a CHECK that excludes `seasons` and `clubs`, so `recordDataEdit` cannot audit this operation; an `import_batches` audit row is used instead.
- V2-GAP-036's test requires that no module outside `src/lib/rollover/` imports it; satisfied (the settle only names the tool in a string).
- The snapshot-copy harness (`repro/gen350.py`) deletes the real `afl_api` identity row for the fixture's home-side player from the disposable copy; it never runs against a database that is not an isolated `_test` clone.

## 14. Every file changed by this branch

Application and tools: `src/lib/rollover/season-opening.ts` (new), `src/lib/acquisition/settle-afl-api.ts`, `tools/v2/issue350-season-open-production.ts` (new), `tools/v2/season-opening-check.ts` (new),
`tools/v2/gap029-assemble-restore-evidence.ts`, `tools/v2/gap029-ops-lib.ts`, `tools/v2/gap029-ops/prod-stage.sh`, `tools/v2/gap029-ops/capture-prod-stage.sh`, `tools/v2/gap029-ops/restore-assemble-host.sh`.
Deploy: `deploy/afldb-settle-failure@.service`, `deploy/afldb-settle-failure-notify.sh`, `deploy/afldb-settle-afl-api.service.d/on-failure.conf` (all new).
Tests: `tests/season-rollover.test.ts`, `tests/afl-api-ingestion-safety.test.ts`, `tests/gap029-assembly.test.ts`, `tests/gap029-ops.test.ts`, `tests/integration/afl-api-c7-observation.test.ts`.
Evidence: everything under `docs/v2/evidence/remediation-20261114/rollover/`. No migration, no ledger, index, changelog, or `CLAUDE.md` edit.
