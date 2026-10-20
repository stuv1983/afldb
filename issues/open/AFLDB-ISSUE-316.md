# AFLDB-ISSUE-316 — AFL API cutover: retire AFL Tables network acquisition

**Status:** Open (2026-10-18). Preparation only. Local, reversible implementation on branch
`opus/afl-api-cutover` (worktree `D:\dev\afldb-afl-api-cutover`, base `ff100dc2`), uncommitted.
Nothing has been deployed, committed, merged or pushed, and no host was contacted.

**Owner instruction (2026-10-18):** a change of direction. AFL Tables acceptance work stops. The goal
is to remove AFL Tables network calls and use the AFL API for game and Brownlow data. PROD's existing
AFL Tables timer keeps running until its replacement is ready. B1 stays in force. No PROD or DEV
change, live write, timer change, deployment, source-ownership change or cleanup is authorised by
this preparation.

**Severity:** Medium (architecture / data acquisition). **Area:** `deploy/afldb-settle-afltables.*`,
`tools/rebuild/fitzroy/`, `tools/rebuild/afltables/`, `src/lib/acquisition/`, `tools/current-season/`,
season rollover and rebuild.

This runbook reuses existing evidence and does not repeat completed investigations. The sources are
cited inline. ISSUE-238 (`issues.md`) already recorded this destination as unallocated work: "making
the AFL API the automated primary source and retiring AFL Tables (not implemented …)".

---

## 1. What this session did

| Item | Result |
|---|---|
| Windows task `\AFLDB-T6-N1-Watcher-20261019` (one-time 04:18 19 Oct, launcher `D:\tmp\prod-release-20261018-p5-t0\t6\handoff\Run-Watcher-N1.ps1 -Route scheduled-task`) | Identity verified from the action path and trigger. Definition exported before the change (sha256 `351aa15e…09b1b4`). **Disabled**, not deleted. Never run (LastTaskResult 267011). Record: `D:\tmp\prod-release-20261018-p5-t0\t6\withdrawn-20261018\WITHDRAWAL-T6-WATCHER-N1-N2-20261018.md`. |
| Claude session reminder | `CronList`: no jobs. The earlier session cron 49329246 had already been deleted. |
| T6 watcher and N1/N2 capture instructions | **Withdrawn.** The owner is not asked to run them. All T0–T6 evidence, the supplementary grader and the bundle are preserved unchanged. |
| AFL Tables-only work | No new watchers, graders, review packs or acceptance tests. |
| Local implementation | §6: one switch for AFL Tables network fetching, bounded by `last_season` and wired into every fetch path; the season rollover retires it in the same write; a DB-free readiness report that judges the season feed's venue, team and round coverage. 80 new tests. |
| Independent review | Round 1, one read-only reviewer: 1 HIGH (C2 ordering), 3 MED, 3 LOW. Round 2, three owner findings (rollover not enforcing C2, D1 placed where it must refuse, readiness blind to venues). All addressed in the code or this runbook; §10. |

## 2. Inventory: every AFL Tables network call

Only three scripts contact afltables.com. Everything else that mentions AFL Tables reads data
already stored.

| # | Network call | Data | Reached by | Kind |
|---|---|---|---|---|
| A1 | `tools/rebuild/fitzroy/acquire_core.R` `fetch_player_stats_afltables(season)` | Player-match stats, profile URL/DOB, `Brownlow.Votes` | **Nightly** `afldb-settle-afltables.timer` (04:30 + up to 15 min) → `.service` → `deploy/afldb-settle-afltables.sh` step 1; **Super Admin "start now"** `SettleRunPanel` → `startSettleRunAction` → `startSettleRun()` → `systemctl start afldb-settle-afltables.service` (needs `AFLDB_SETTLE_TRIGGER=systemd` and the polkit rule); manual `Rscript … --acquire/--probe` | scheduled, admin, manual |
| A2 | `acquire_core.R` `fetch_results_afltables(from:to)` | Match results/scores | Same as A1 (in-season required dataset) | scheduled, admin, manual |
| A3 | `acquire_core.R` `fetch_player_details_afltables()` | Player bios / club register | Full-history acquisition only (`--datasets` incl. `player_details`); not allowed in season | manual / rebuild / **rollover** |
| A4 | `acquire_core.R` `fetch_ladder_afltables(season)` | Ladder witness | `--datasets ladder` (operator); `validate_ladder_witness.py` and `rebuild-test.ts` only print the command | manual / **rollover** |
| A5 | `acquire_core.R --probe` | Schema probe sample | Manual only | manual |
| B1 | `tools/rebuild/afltables/acquire_club_lists.R` `httr::GET` (robots.txt + 21 club pages) | DOB + profile href per club | Manual only; `rebuild-test.ts` prints a hint | manual / rebuild |
| B2 | `tools/rebuild/afltables/acquire_coaches.py` `urllib.request.urlopen` (robots.txt, index, every coach page) | Coaches and coach-player links | Manual only; `rebuild-test.ts` prints a hint | manual / rebuild |

How fitzRoy reaches the site: completed seasons come from fitzRoy's cached afldata release (GitHub),
and the newest season is scraped live from afltables.com (`fitzroy-contract.json` comment).

**Live today on PROD:** A1 and A2, every night, while `data/reference/seasons.json`
`in_progress_seasons` is `[2026]`. The 2026 season has finished, but the register still lists it, so the
timer keeps fetching through the off-season. Nothing in the repository enables that timer;
`tools/maintenance/01_setup_service.sh` enables only `afldb`, so it was enabled by hand.

**No automatic fallback exists from the AFL API to AFL Tables.**
- `deploy/afldb-settle-afl-api{,-brownlow}.sh` run only Node tools whose requests go to `*.afl.com.au`
  (`src/lib/acquisition/afl-api-client.ts`).
- The Brownlow `--use-fixture-identity` "fallback" is a SELECT-only lookup of existing `matches` rows.
- `deploy/afldb-settle-afltables.service` says outright: "There is no automatic fallback authority".
- `npm run db:test:rebuild`, `tools/db/rollover-season.ts` and every `package.json` script spawn only
  readers of stored files.
- `acquire_lineups.R` and `acquire_rosters.R` use fitzRoy's **AFL.com.au** functions, not AFL Tables.

**Stored-data readers (not network, not gated):**
- In-season settle: `tools/current-season/settle-afltables.ts` and `src/lib/acquisition/settle-*.ts`
  (they read an existing snapshot label).
- Importers: `import_fitzroy_core.py`, `enrich_birth_dates_afltables.py`, `import_match_coaches.py`,
  `enrich_heights.py`, `rebuild_derived.py`, `validate_ladder_witness.py`, `import_legacy_afl.py`.
- Brownlow artefact builders and loaders.
- DraftGuru review tools: `webbrowser.open` on operator click only.
- `common.py` and `src/db/queries/*`: URL strings and DB lookups only.

## 3. Game and Brownlow data: AFL Tables vs AFL API

| Data | AFL Tables (today) | AFL API | Gap |
|---|---|---|---|
| Season, round, round type, finals | yes | yes, via per-season round tables `round_vocabularies.afl_api_<Y>` (2022–2026 only) | **2027 table absent** |
| Match date / time | yes; `match_time` free text | yes, if local start time + venue timezone are proved, else `unproved_match_date`; `match_time` `HH:MM` | format change |
| Venue | yes; a NULL venue still applies | 17 mapped venue ids (`afl-api-identities.json`; every 2026 venue is mapped); an unmapped venue blocks auto-apply, so a new 2027 venue needs an id first | **partial** |
| Clubs, goals, behinds, score, result, margin | yes | yes | — |
| **Attendance** | yes | **no field in any feed** (ISSUE-228 §2.3). Only enriched from `staging.afltables_match` or entered by a Super Admin | **GAP** |
| Period scores | cumulative Q1–Q4 | per-period increments → cumulative, cross-checked; ISSUE-276 guard; only on `afl_api`-owned matches | — |
| Player 21 stats, jumper, club | yes | yes (whole-number floats) | — |
| `career_game_no` | yes (derived-owned) | NULL (`gamesPlayed` null); recompute owns it | — |
| **New players, DOB, height** | operator-run fitzRoy `players` group, `player_details` | **none**. The player bridge joins to existing (AFL Tables-owned) stat rows; otherwise a Super Admin creates the player (Data Editor) and adjudicates the `CD_I` id at `/admin/player-links/afl-api` (refusal T7 accepts "one administrator-created identity") | **GAP** |
| **Coaches / `match_coaches`** | fitzRoy `Coach` column + coaches snapshot | **none** | **GAP** |
| Brownlow per-match votes | NA in season | yes, live-count chain (ISSUE-232), with `match_id`; all-or-none per match | — |
| Brownlow season totals | legacy artefact | builder exists but needs an AFL Tables profile path for every recipient (`build_brownlow_season_artefact_from_afl_api.py`) | **dependency** |
| Umpires, weather, lineups | not stored | raw / staging only | — |
| Fixtures | none | none (ISSUE-229, blocked on B2) | not a regression |

**Behaviour differences after the switch:**
- **Completeness.** AFL Tables checks after commit. AFL API `--require-complete-source` rolls the whole
  night back for one unbridged player (`settle-afl-api.ts`).
- **Revalidation.** Of the settle paths only the AFL Tables CLI calls `revalidateSeason` (the admin
  Brownlow actions also do). The AFL API units deliberately
  unset `AFLDB_REVALIDATE_SECRET` (**D-232-3**: no automatic revalidation), so public season pages lag
  by up to their ISR hour.
- **Match Sheet authority keys** are `afltables:<path>` or `manual_admin_edit:<token>`. An
  administrator-created 2027 player uses the token form. This is not exercised on an `afl_api`-owned
  match yet.

**Historical coverage:**
- AFL API identities and round tables cover 2022–2026.
- 2012–2021 are listed "historicalUnregistered" (ISSUE-233) and are never proposed.
- AFL Tables 1897–2026 history stays stored, read-only data.
- Neither settle touches a completed season (gate E2).

## 4. Why PROD still depends on AFL Tables, and what blocks the replacement

1. **The AFL API units have never been installed on PROD.** The ISSUE-265 C0 capture shows
   `afldb-settle-afl-api{,-brownlow}` `LoadState=not-found` and no `acquisition.%` site setting
   (`issues/closed/AFLDB-ISSUE-265.md`). p5 installed code only.
2. **Installing them was never authorised.** ISSUE-232: "PROD (no unit installed, none authorised)".
   `blockers.md` R21 is DEFERRED, and no decision ID exists.
3. **Ownership.** Every 2026 match is `afltables`-owned. Q1/Q7 (ISSUE-228 §0.1): the AFL API
   corroborates and never re-owns; no transfer rule or tool exists. DEV's AFL API nightly therefore
   writes nothing canonical (64 `foreign_source_owner` refusals, 218 corroborated; ISSUE-274 §33.10).
4. **Rollover and rebuild are built on an AFL Tables baseline.**
   - Rollover (`src/lib/rollover/season-rollover.ts`, ISSUE-101) needs a newly acquired fitzRoy
     full-history candidate plus a ladder witness, i.e. calls A1–A4.
   - The rebuild replays the accepted AFL Tables baseline.
   - D-233-3: a rebuild, rollover or promotion check refuses any completed season that holds
     `afl_api`-owned matches, with no override. Ownership replay is "intentionally unimplemented".
5. **2027 is not registered.** No `seasons.2027` identity, no `afl_api_2027` round table, and
   `in_progress_seasons` is `[2026]`.
6. **Identity bootstrap.** The stat-vector player bridge needs AFL Tables stat rows for the same match.
   Without them every new `CD_I` id needs a manual Super Admin registration and adjudication, and one
   miss rolls back the whole AFL API night.
7. **Operations.**
   - The on-demand trigger and the polkit rule cover AFL Tables only; an AFL API trigger is deferred
     (ISSUE-232 §5).
   - `docs/deployment.md` §7d says "Not installed or enabled on any host yet", which is stale for DEV.
   - There is no PROD install procedure beyond ISSUE-232 §7.

## 5. Fallbacks that could fetch AFL Tables silently after cutover

| Path | Could it fetch after cutover? | Control |
|---|---|---|
| `afldb-settle-afltables.timer` (enabled by hand) | **Yes**: nightly, while a season is in progress | Code: the rollover (C2) retires the switch, so the unit is a no-op, exit 0 + `AFLDB_AFLTABLES_RETIRED`; a register past `last_season` with the switch still active fails the unit, exit 1 + `AFLDB_AFLTABLES_OUT_OF_BOUNDS`. Host: `systemctl disable --now` (optional at C2, mandatory by C5) |
| Super Admin "start now" | **Yes**, if the trigger env and polkit rule are present | Code: `startSettleRun()` returns `unavailable` before any `systemctl` call (audited as `current_season.settle_triggered`, outcome `unavailable`). Host: remove `/etc/polkit-1/rules.d/*afldb-settle-afltables*` |
| Manual `acquire_core.R` (`--acquire`, `--probe`, full history, ladder) | Yes, if run | Code: refuses before fitzRoy loads |
| Manual `acquire_club_lists.R` | Yes, if run | Code: refuses before httr loads |
| Manual `acquire_coaches.py` | Yes, if run | Code: refuses before the contract is read |
| **Rollover / rebuild "re-acquire" hints** | Only if an operator follows them; the tools themselves never fetch | They go through `acquire_core.R` / the R and Python scripts above, so all are refused |
| AFL API units | No: no AFL Tables code path | — |

## 6. Local implementation (branch `opus/afl-api-cutover`, uncommitted)

**The switch: `data/reference/afltables-network.json`** (new, LF, 2-space JSON:
`{"status":"active", "last_season":2026, "decision":null, "changed_at":null}`).
- AFL Tables may be fetched only when `status` is `active`, `last_season` is an integer-valued JSON number
  (`2026` and `2026.0` alike, see "The number contract" below), and no season in
  `data/reference/seasons.json` `in_progress_seasons` is later than `last_season`. It ships `active` /
  `2026` with `[2026]` in progress, which is why this branch alone changes no live behaviour.
- **Retired**: `status` `retired`, a missing file, unreadable JSON, any other status, or no integer
  `last_season`. Every network path refuses; the settle unit exits 0 with `AFLDB_AFLTABLES_RETIRED`.
- **Out of bounds**: `active`, but an in-progress season is later than `last_season`, or the register is
  unreadable. This is the state a rollover to `[2027]` would create if the switch stayed active. Every path
  refuses, and the settle unit **fails** (exit 1, `AFLDB_AFLTABLES_OUT_OF_BOUNDS`), so a misconfiguration
  is loud, never a quiet nightly success.
- The one rule is implemented in the shell, both R scripts, Python and TypeScript, and each is tested
  against the same cases.
- **The number contract (final pre-commit audit, 2026-10-19).** `last_season` and every
  `in_progress_seasons` entry must be a finite, integer-valued JSON number. `2026`, `2026.0` and `2.026e3`
  are the same value to the shell gate (its embedded Python), both R gates, the Python gate and the TypeScript
  parser. A boolean, string, null, fraction or non-finite number (`1e999`; `NaN` and `Infinity` are not
  valid JSON but Python reads them) is not a season: as `last_season` it makes the switch `retired`, in the
  register it makes an active switch `out_of_bounds`. Comparison and out-of-bounds behaviour are unchanged.
  Before this change the Python gates (`acquire_coaches.py` and the shell's embedded Python) read `2026.0`
  as retired while R and TypeScript read it as active, and the R gates read `1e999` as `Inf`, which every
  season satisfies; the Python gates now accept an integer-valued float and the R gates also require
  `is.finite`. Retirement, a missing switch and a malformed switch still refuse.
- Stored-data readers are not gated.
- Retirement is written by the rollover itself (below). Re-activating AFL Tables for a later season
  means editing **both** `status` and `last_season`. Once that season has matches, that is an ownership
  decision (§7, Recovery).

**The rollover retires the switch in the same write (2026-10-18 review round 2, finding 1).**
`tools/db/rollover-season.ts` now requires `--afltables-retirement-decision`, and only the decision
registered for the season being completed authorises it: exactly `D-316-1` for 2026
(`AFLTABLES_RETIREMENT_DECISIONS`; review round 3, finding 1). In stage 1, before any validator is spawned,
it refuses unless the switch reads `active` against the current register, `last_season` equals `--season`,
**and** the decision is that registered one. `--apply` writes the switch `retired` (`decision`,
`changed_at` = `--rollover-date`, `last_season` kept) **before** the five rollover files.

| Layer | Where | What it stops |
|---|---|---|
| Acquisition gates | shell, `acquire_core.R`, `acquire_club_lists.R`, `acquire_coaches.py` | The final full-history acquisition can only run while the switch is active and bounded to 2026 |
| Rollover planner | `src/lib/rollover/afltables-network-retirement.ts`, called by the CLI before gate 1 | A rollover from a retired, unbounded or wrongly bounded switch; a rollover without the owner decision, or naming any decision other than the registered one (`D-316-1` for 2026); a second rollover after retirement (names D-316-6) |
| Write order | `rollover-season.ts --apply` | An interrupted apply leaves AFL Tables retired with `[2026]` (nothing fetches), never active with `[2027]` |
| Tracked-file invariant | `tests/afl-api-cutover.test.ts` | A commit carrying `[2027]` without the retirement (hand edit, partial revert) fails the suite |
| Run-time bound | every gate, including `startSettleRun()` | The same commit, if deployed anyway, cannot fetch: out of bounds, refused, and the unit fails loudly |

| File | Change |
|---|---|
| `data/reference/afltables-network.json` | New: the switch, `last_season` bound, contract in `$comment` |
| `deploy/afldb-settle-afltables.sh` | Gate after `cd "$PROJECT_ROOT"`, before the R runtime, the season and acquisition: retired → `AFLDB_AFLTABLES_RETIRED`, exit 0; out of bounds → `AFLDB_AFLTABLES_OUT_OF_BOUNDS`, exit 1; an interpreter that cannot run → exit 1 |
| `tools/rebuild/fitzroy/acquire_core.R` | Gate after the jsonlite check, before fitzRoy is required or attached; a missing switch names the working directory |
| `tools/rebuild/afltables/acquire_club_lists.R` | jsonlite check, then the gate, before `library(httr)` |
| `tools/rebuild/afltables/acquire_coaches.py` | `afltables_network_status(REPO_ROOT)` (three-valued); refuses with `Terminal` before the contract is read |
| `src/lib/acquisition/afltables-network.ts` | New: `parseAfltablesNetworkStatus(control, seasons)` (fail closed, three-valued), `afltablesNetworkStatus()` (static imports of both files), refusal texts |
| `src/lib/acquisition/settle-trigger.ts` | `startSettleRun()` refuses a retired or out-of-bounds switch with `{outcome:'unavailable', reason}` before any `systemctl` |
| `src/lib/rollover/afltables-network-retirement.ts` | New, pure: `parseAfltablesRetirementDecision()` (syntax; the flag given twice is refused), `planAfltablesNetworkRetirement()`, `AFLTABLES_RETIREMENT_DECISIONS` (2026 → `D-316-1`, exact match) |
| `tools/db/rollover-season.ts` | Requires the decision flag; plans the retirement after `planSuccessorContract` and before gate 1; writes the switch first on `--apply`; prints it in the plan |
| `src/lib/acquisition/afl-api-cutover-readiness.ts` | New, pure: seven checks (below) |
| `tools/current-season/afl-api-cutover-readiness.ts` | New CLI: `--season Y --season-feed <00-season-matches.json>`; exit 0 REPOSITORY READY / 1 NOT READY / 2 usage or unreadable feed; prints host checks and, only when `venue_coverage` passed completely, the venues SQL; runs none |
| `tools/current-season/afl-api-c4b-rehearsal.ts` | New CLI for C4b (§7): the D1 rehearsal as one command that restores `acquisition.afl_api_current_season_enabled` to off on every exit path, with a detached watchdog that must prove itself ready (a run-bound, PID-bound readiness marker; no setting write until it does) and `--restore-only`; never enables a unit or timer and never applies. Never run on Linux, PostgreSQL or PROD (its tests have run, DB-free, on Windows) |
| `tests/afl-api-cutover.test.ts` | New, 421 tests as last run (419 passed, 2 POSIX-only skipped; executed 2026-10-19 after follow-up 8 under proven isolation, see "Follow-up 8 validation"). Follow-up 8 added 115 (the number contract: 23 cases through the TypeScript parser, both R gates, the Python gate and the shell gate). Follow-up 7 (306: 304 passed, 2 skipped) replaced follow-up 6's 4 cleanup tests with 13 and rewired the two process-owning `afterAll` hooks to `teardownRegisteredProcesses`. The earlier 293 (291 passed) is superseded history |

**Readiness (2026-10-18 review round 2, finding 3).** `assessAflApiCutoverReadiness()` now judges the
season's own matches feed, not just the tracked maps:

| Check | PASS means | At settle, a miss would |
|---|---|---|
| `in_progress_season` | `seasons.json` is exactly `[Y]` | refuse the run |
| `season_identity` | `afl-api-identities.json seasons.Y` exists | refuse the run |
| `round_vocabulary` | `round_vocabularies.afl_api_Y` declared | HALT |
| `season_feed` | the supplied feed is a **complete** ISSUE-231 enumeration of the registered `CD_S` (pagination, count, page 0 of 1, not empty, no foreign season, no duplicate); its sha256 is printed | — (no feed, malformed or incomplete = FAIL) |
| `venue_coverage` | every entry's `venue.providerId` is in `venues` | refuse that match (I244-F003) |
| `team_coverage` | every home and away `team.providerId` is in `teams` | HALT the night |
| `round_coverage` | every entry translates through `afl_api_Y` | HALT the night |

- No feed, or a feed that fails `season_feed`, makes all three coverage checks FAIL as "Unproved".
- A malformed entry (no venue or team provider id) is a FAIL, never skipped.
- A pre-season feed may hold placeholder entries (for example a finals slot with no team). Those fail
  closed and need review; they are not waived.
- The verdict now reads `REPOSITORY READY … This is NOT the cutover go (D-316-4)`. The database half of
  venue coverage (a `venues` row for every mapped `legacy_name`) is printed as a read-only SQL count for the
  operator.
- That SQL is all or nothing (review round 3, finding 3). The names are published only when
  `venue_coverage` passes for every entry. A malformed or unmapped venue, wherever it falls in the feed,
  gives NOT READY and no SQL, so an `expect N` can never be met by a partial list.
- Coverage is as of the feed's bytes, so §7 re-runs it at C4, C4b and C5.

**Tests: `tests/afl-api-cutover.test.ts`, last executed 2026-10-19 on the Windows workstation (after the final pre-commit audit, follow-up 8, under proven isolation): 419 passed plus 2 POSIX-only skipped, 421 total.** The seven-suite regression set read 829 passed plus 2 skipped, 831. Superseded history, kept where it records what a given follow-up added: 304 + 2 = 306 and the seven-suite 714 + 2 = 716 (follow-up 7, executed before the number-contract tests were added); 291 + 2 = 293 and 701 + 2 = 703 (follow-up 5); the unexecuted 295 + 2 prediction of follow-up 6; 149 after review round 3, 247 and 270; and the seven-suite 559, 618, 626, 657 and 680.
- Real `Rscript` 4.6.1, `python` 3.12 and Git `sh` run the gate code in temporary trees that hold only a
  switch and a register, so an `active` run stops on the first missing file and nothing can reach the
  network.
- Each script is tested retired / missing / garbage / unbounded → retired marker, beyond (`[2027]` with an
  active switch bounded to 2026) → out-of-bounds marker (the shell exits 1 and reaches no step), and active →
  passes the gate. A shell run whose Python cannot start fails, not retires.
- `parseAfltablesNetworkStatus` has 21 table cases. `startSettleRun()` is tested with a mocked `execFile`
  and mocked switch and register: retired, unbounded, malformed and out of bounds never spawn `systemctl`;
  active and bounded is unchanged.
- The rollover retirement: the decision flag, the planned bytes from the tracked switch (keys, comment,
  `last_season` kept; CRLF kept), refusals for retired, unbounded, garbage, wrongly bounded and
  out-of-bounds starts, the 2027 rollover refused naming D-316-6, and the CLI's order (decision parsed first,
  retirement planned before gate 1, switch written after every gate and before the other files).
- The tracked-file invariant, and the switch's serialisation equal to what the rollover writes.
- Readiness: 2026 with the authentic 2026 feed passes all seven checks (218 matches, 17 venues); no feed,
  an unmapped venue, a missing venue id, an unmapped team, an untranslatable round, a truncated feed, a
  foreign-season entry, no pagination and non-JSON each fail; a synthetic registered 2027 with its own feed
  passes, and the 2026 feed against the 2027 registration does not; CLI exit codes 0/1/2.
- Round 3, the retirement decision: exactly `D-316-1` authorises 2026 and is recorded in the retired switch;
  nine malformed values are refused by the parser and by the planner; eight well-formed but unrelated ids
  (`D-316-2`, `D-316-13`, `D-316-10`, `D-316-1a`, `D-316-1-1`, `D-999-1`, `D-233-3`, `D-316`) are refused by the
  planner; the flag given twice is refused; a season with no registered decision refuses even `D-316-1`.
- Round 3, venue evidence: a failure after mapped venues (unmapped last entry, missing provider id, a
  non-object venue, unmapped midway) gives NOT READY, no names and no venues SQL, from the library and the
  CLI; the SQL is produced only from a passing `venue_coverage` and names every venue.
- Round 3, the C4b tool over injected effects: the success order; an acquisition failure, a settle failure, a
  throw and a missing label (early exit); SIGINT, SIGTERM and SIGHUP; an interrupt between the steps and a
  second signal during the restore; the deadline; a turn-on write that fails after committing; two
  restoration failures giving exit 3 with no marker; thirteen preconditions refusing with no write; the
  HALT criteria (inserted, updated, no report, incomplete feed, a BEFORE/AFTER difference, another setting
  changed, a timer enabled AFTER, readiness NOT READY); strict arguments with exactly `D-316-13`; the steps'
  narrowed environment; read-only `systemctl` verbs and no `--apply` in the source; `--restore-only`; the
  watchdog standing down, restoring after a dead parent or the deadline, and giving up with exit 3.
- Round 3 follow-up, the watchdog startup handshake (§7): the readiness decision table (absent, exact, another
  run, wrong watchdog PID, wrong parent PID, a string PID, wrong kind, missing or unparseable timestamp,
  truncated JSON, empty, non-object); the bounded wait (a matching marker from a running watchdog; a marker
  from a watchdog that then exited; a timeout; a PID that exits before readiness; five bad markers refused at
  once; an unreadable marker; a failed launch; a failed stand-down write that neither hides the refusal nor
  skips the stop); eight refusal cases through the rehearsal, each exit 2 with zero setting writes and no step
  started; a matching handshake followed by the existing success order and by a failing step still restored;
  the watchdog's own startup (readiness published naming the run, its PID and the parent; an unreadable
  setting or an unusable evidence directory exits 2 with nothing published and no driver text; a parent
  already gone goes straight to the restore; a dead parent and a passed deadline after a successful startup
  still restore; a stand-down request writes nothing); strict watchdog arguments including `--run-id`; and,
  **over the real production adapter** (real `spawn`, real files, real `process.kill` liveness, with a
  stand-in command in place of the watchdog because the real one needs a database): readiness accepted and
  the process left running; exit before readiness; a silent watchdog timing out and being stopped; another
  run, a wrong watchdog PID, a wrong parent PID and a malformed marker each refused with the process stopped
  and the evidence left in place; a stale marker refused before anything starts; a command that cannot start;
  the atomic publish (no leftovers, never overwrites); the stand-down reader; and the tsx loader command run
  for real, showing the spawned PID is the script's own `process.pid`. The tool source is also asserted to
  contain no deletion call. Round 3 follow-up 2, post-spawn failure (§7): over fake effects, post-spawn work
  that throws (stood down and stopped before any readiness wait), a readiness log that throws after readiness
  was proved, and a failing log, stand-down write and stop together never replacing the refusal (an
  unconfirmed stop is reported); through the rehearsal, exit 2 with zero setting writes; and, over the real
  adapter with a **real spawned** stand-in, a `watchdog.pid` write that fails (a directory in its place), a
  failed stand-down write (a pre-existing marker) that does not prevent termination, a start log that
  throws, and the same failure through the rehearsal with no acquisition or settle step; each confirms
  the exact child ended and that `process.kill` was only the signal-0 liveness probe. A scratch negative
  control (the `afterLaunch` call moved out of its protected sequence) failed 7 of those 8 tests; the
  survivor is **"a readiness log that fails after the watchdog proved itself is post-spawn work too: stood
  down and stopped"**, which was outside the mutated path: its failure is injected into the log call made
  *after* readiness is proved, in the second protected step, and `afterLaunch` does not throw in it, so
  breaking `afterLaunch` cannot affect it. It guards that second step separately; see "Round 3 follow-up 3"
  for the control re-run (follow-up 4 replaces the earlier record). Round 3 follow-up 3 adds 31 tests (247 in the suite): a readiness
  wait whose liveness probe, clock (first or later call) or sleep throws or rejects, with and without a
  failing stand-down write, stop and log, and through the rehearsal as exit 2 with zero setting writes and no
  step; child-exit accounting over a fake child (a `kill()` error while the child runs is not a confirmed
  stop; an undeliverable SIGTERM then a SIGKILL that ends the child is confirmed by the exit; a genuine exit
  by event, exit code or signal code is reported stopped and never signalled); and evidence that cannot be
  written (three pre-write refusals and a total write failure stay exit 2, an unsaved BEFORE record refuses
  before the watchdog, an unwritable `result.json` turns a CLEAR into a HALT and leaves a HALT as 1 and an
  unverified restoration as 3, each of `acquire.log`, `settle-dry-run.log`, `after.json`, `readiness.txt` and
  the restore-verified marker makes a HALT with the setting still restored, and a throwing log changes
  nothing). Round 3 follow-up 4 adds 23 tests (270 in the suite at that point; superseded history, see the current totals above): the watchdog with an unwritable evidence
  directory (failed restoration then a later successful one, the final give-up exit 3, a first-time success, and a
  throwing log, each with the retry count and the evidence-attempt count asserted and no driver text logged);
  an unconfirmed acquire or settle step (a HALT naming it, the setting restored, no later step, and still exit 3
  when the restore itself cannot be verified); a `systemctl` or readiness dependency that throws after the
  restore (exit 1, setting off, recorded, no driver text, also with `result.json` unwritable) and a `systemctl`
  that throws before any write (exit 2, no write, no step); `runChildStep` over a fake child (an `error` event
  after the process exists is not completion, an `error` with no PID resolves as could-not-start, a throwing
  starter, an undeliverable SIGTERM followed by a SIGKILL that ends the child, an abort neither signal can
  deliver reported `unconfirmed`, a SIGTERM that suffices sends nothing more, an exited child is never
  signalled, an abort already raised) and over a **real** process (output and exit code, and an abort that ends
  it with the process verified gone); and `main()` setup failures (an evidence path that is a file gives 2, or 3
  for `--restore-only`; a non-empty directory, a missing watchdog directory and bad arguments stay 2; nothing is
  written). The production effects that remain **not** exercised: the real watchdog
  process end to end (PostgreSQL reads and writes as `afldb_auth`/`afldb_app`), signal delivery under an SSH
  session, and the Linux `node --import <tsx loader>` start on the host. No database or host was touched.

**Regression suites, unchanged:**
- **Executed (2026-10-19, after follow-up 8, under proven isolation; the current result):** 829 passed and 2
  skipped, 831 in all, across seven suites (`admin-current-season-settle` 58, `fitzroy-acquisition` 23,
  `coaches` 12, `club-list-sources` 8, `afl-api-ingestion-safety` 166, `season-rollover` 143 and the new suite,
  which alone is 419 passed and 2 POSIX-only skipped, 421). The figures were read from the runs, not
  predicted. The exact commands and the isolation evidence are in "Follow-up 8 validation" below.
- *Superseded, executed after follow-up 7 (2026-10-19):* 714 passed and 2 skipped, 716 across the same seven suites,
  with the new suite alone 304 passed and 2 skipped, 306. It predates follow-up 8's 115 number-contract tests
  (304 + 115 = 419; 714 + 115 = 829). Its prediction (follow-up 7's 13 tests replaced follow-up 6's 4) had matched
  exactly, and its commands and isolation evidence are in "Follow-up 7 validation".
- *Superseded, executed after follow-up 5 (2026-10-18):* 701 passed and 2 skipped, 703, with the new suite alone
  291 passed and 2 skipped, 293. It predates follow-up 6 and 7's cleanup rewrite.
- *Superseded history, not the current result:* 680/680 after the follow-up 4 fixes (the new suite alone
  270/270; 247 before follow-up 4, plus 23); 657/657 after the readiness-wait, child-exit and evidence-write
  fixes; 626/626 after the post-spawn cleanup fix; 618/618 after the handshake; 559/559 before it.
- `node node_modules/typescript/bin/tsc --noEmit -p .` exit 0 (the whole tree).
- ESLint exit 0 on the eight new and changed TypeScript files.
- Not run: the full suite, DB-backed integration, `npm run build`, Linux, the rollover CLI end to end
  (it needs a real full-history candidate), and the C4b tool against any database or host.

**Readiness today:** `node node_modules/tsx/dist/cli.mjs tools/current-season/afl-api-cutover-readiness.ts
--season 2027` → NOT READY on all seven (`[2026]`; no `seasons.2027`; no `afl_api_2027`; no feed). Switch:
active, bounded to 2026. `--season 2026 --season-feed tests/fixtures/afl_api/seasons/00-season-matches-2026.raw.json`
→ REPOSITORY READY.

## 7. Cutover procedure (smallest concrete path)

**V2 reconciliation, 2026-10-21:** all 19 source handoff files match the preserved snapshot and
were already imported by `c9cca86db2fd60ec42fa777906a2cf2a291d5e4e`; intentional V2 runtime
refusal/quarantine is preserved. Original C0/C1 below remain the historical contract. The
[V2 approval package](../../docs/v2/issue316-c0-c1-approval-2026-10-21.md) proposes an explicit
owner amendment and an exact hashed, filesystem-only DEV shell-refusal artifact. Neither is
approved or executed on DEV. Full C0/C1 and C2 remain pending; D-316-13 remains unavailable
before deployed C4. No acquiring DEV control is claimed from local fixture checks.

**Shape: cut over at the season boundary, not mid-season.** 2026 stays `afltables`-owned forever as
stored history, and 2027 is `afl_api`-owned from its first match. No row is re-owned, so Q1 and Q7
stand, and no ownership-transfer tool is needed for the cutover itself.

**Roll-forward point:** the first `afl_api` canonical write of a 2027 match. AFL Tables cannot take that
row back (`foreign_source_owner`), so recovery after it is forward-fix on the AFL API path. Nothing before
C5 creates one: C4b is a dry run, and before Opening Round the match nightly selects no concluded match.

**No AFL API timer is enabled before C5, and C5 requires a recorded C4b PASS. The Brownlow timer waits
for C8: it is neither enabled nor active at C3, C4, C4b or C5, and ISSUE-232 §7 E1's "permanently enabled"
(a DEV decision) does not apply on PROD.**

| Step | What | Who / authority | Readiness / acceptance |
|---|---|---|---|
| C0 | Review and merge this branch (switch `active`, bounded to 2026: no behaviour change); DEV sync | Owner commit/merge; DEV deploy per WORKFLOW | Tests above re-run on Linux; DEV unit run still acquires |
| C1 | **DEV rehearsal of retirement**, from a DEV worktree, running that worktree's script directly: `AFLDB_PROJECT_ROOT=<wt> sh <wt>/deploy/afldb-settle-afltables.sh` (the unit's `ExecStart` is the main checkout, so `systemctl start` would test the wrong file). Two cases: switch `retired`; and switch `active` / 2026 with that worktree's `seasons.json` at `[2027]`. Click "start now" **only** on an app built from the `retired` tree (the app reads the switch at build time); an `active` build really starts the unit and fetches | Owner authorises (DEV) | Retired: `AFLDB_AFLTABLES_RETIRED`, exit 0, no `[1/3]`. Out of bounds: `AFLDB_AFLTABLES_OUT_OF_BOUNDS`, exit 1, no `[1/3]`. Admin result `unavailable` with one audit row. No new `data/sources/afltables/fitzroy_core/settle-*` label |
| C2 | **Close 2026 and retire AFL Tables in one write.** (1) The final fitzRoy full-history acquisition and ladder witness, while the switch is `active` / 2026 (every acquisition gate requires it). (2) The D-233-3 census evidence. (3) `rollover-season.ts … --afltables-retirement-decision D-316-1` dry run, then `--apply --acknowledge-season-complete`: it refuses unless the switch is `active` / 2026, and writes the switch `retired` first, then the five rollover files. (4) One reviewed commit holding all six files. (5) Deploy **with a rebuild** (the app's copy of the switch is build-time). Optionally `systemctl disable --now afldb-settle-afltables.timer` at the same time (belt and braces; mandatory by C5) | **D-316-1** | The tool's own gates. The commit diff shows `status` `retired`, `decision` `D-316-1`, `in_progress_seasons` `[2027]`. After deploy: the next nightly logs `AFLDB_AFLTABLES_RETIRED` and exits 0 (or the timer is disabled); readiness INFO `afltables_network: retired`; no AFL Tables snapshot label newer than the rollover's |
| C3 | **Install the AFL API units on PROD as inert units**: ISSUE-232 §7 **C only** (`sh -n`, install the four unit files, `daemon-reload`, `systemd-analyze verify`, hash pairing). No service is started and no timer is enabled. `acquisition.afl_api_current_season_enabled` stays off and `AFLDB_AFL_API_BROWNLOW_ENABLED` stays absent. The Brownlow timer is **not** enabled here (ISSUE-232 §7 E1's "permanently enabled" is superseded for PROD; it is first enabled at C8). D1 and E are **not** run here: with the setting off, acquisition and settle refuse by design, and 2027 is not registered yet. Independent of C2; after C0 | **D-316-2** | `systemctl show afldb-settle-afl-api{,-brownlow}.service -p LoadState,ActiveState` = `loaded`, `inactive` for each service; `systemctl is-enabled afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer` = `disabled` twice **and** `systemctl is-active` for the same two timers = `inactive` twice (the Brownlow timer neither enabled nor active); repository and installed hashes pair; the read-only `acquisition.%` query shows the setting off |
| C4 | **Register 2027** once the authentic 2027 season feed is published: `discover-afl-api-seasons.ts` proposal → D-233-2 load of `seasons.2027`; an evidence-backed `afl_api_2027` round table; venue ids for every 2027 venue; the feed retained as evidence (ISSUE-229 B2 uses the same feed). Reviewed commit; deploy with a rebuild | Repository changes, reviewed (**D-316-3**) | `afl-api-cutover-readiness.ts --season 2027 --season-feed <retained 2027 feed>` → REPOSITORY READY, all seven checks; the printed `venues` SQL, run read-only on PROD, returns the expected count |
| C4b | **D1 rehearsal on PROD**, after C4 is deployed and before C5 and Opening Round, as one command (`afl-api-c4b-rehearsal.ts`) that restores the setting however the run ends. See the procedure below | **D-316-13** | The tool exits 0: every automated HALT criterion clear, the setting off and verified, both AFL API timers still disabled, BEFORE and AFTER records identical. The reviewer then records the C4b PASS from its evidence directory |
| C5 | **Cutover go**, before the first 2027 match, only with a C4b PASS record: re-run readiness on the newest retained feed; on the host `systemctl disable --now afldb-settle-afltables.timer` (if not already), remove the polkit rule, enable `acquisition.afl_api_current_season_enabled`, enable `afldb-settle-afl-api.timer` (the match timer only); update the admin panel wording and button (D-316-12) | **D-316-4** (go), operator host actions | Readiness REPOSITORY READY and switch `retired`; `systemctl is-enabled afldb-settle-afltables.timer` = disabled; the Brownlow timer still disabled; keep `AFLDB_SETTLE_TRIGGER=systemd` (it also gates the AFL API status panel's reads) |
| C6 | **Debutant routine** for each round: register new players in the Data Editor and adjudicate their `CD_I` ids before the nightly, or the completeness gate rolls the night back | **D-316-5** (accept, or change the gate) | Nightly exit 0; zero `unresolvedIdentityPlayer` |
| C7 | **Acceptance** (first 2027 round): `afl_api`-owned inserts for every concluded match; period scores (ISSUE-276 guard reachable); derived recompute ran; zero AFL Tables requests (retired, timer disabled, no new AFL Tables snapshot labels); the ISSUE-274/275 code paths now exercised on `afl_api` rows | Owner criteria to approve | Owner records the criteria in advance |
| C8 | **Brownlow 2027** (count week): ISSUE-232 §7 E and the count-window chain with `AFLDB_AFL_API_BROWNLOW_ENABLED` and the window setting; the Brownlow timer is enabled here for the first time; match identity now by provider id; season totals need **D-316-7** | Owner opens the window | ISSUE-232 E-procedure checks |
| C9 | **Before the 2027 rollover (about October 2027):** an ownership-replay / AFL API-baseline design for rebuild, rollover and promotion (D-233-3). The rollover tool now refuses a retired switch and names D-316-6 | **D-316-6**, a successor issue | The 2027 rollover cannot run without it |

### C4b. D1 rehearsal (PROD; one operator-run command)

This reuses ISSUE-232 §7 D1 for a pre-season 2027. It runs as **one reviewed command**,
`tools/current-season/afl-api-c4b-rehearsal.ts`, instead of a manual on / acquire / dry run / off sequence,
so that a failure, an interruption or a lost session cannot leave the setting on (2026-10-18 review round 3,
finding 2). The setting is on only inside that command's run and is turned off again **whatever the
result**. It is turned on for real only at C5. Both AFL API timers stay disabled throughout: the tool runs
`systemctl is-enabled` and `is-active` only.

**Preconditions.** There are two kinds, and the tool proves only the first.

*Machine-enforced, before the first write to the setting.* The tool checks these itself, read-only, and
refuses (exit 2) on any surprise:
- C2's repository state: `in_progress_seasons` is `[2027]` (the rollover's write), and the AFL Tables switch is
  explicitly `retired`.
- C3's installed, inert units: both AFL API timers `disabled` / `inactive` and both services `inactive`, read
  with `systemctl is-enabled` / `is-active` only (a unit that is not installed fails, as does a run in progress).
- The setting is off: `acquisition.afl_api_current_season_enabled` is absent or exactly `false` on the
  connection that writes it, and off on the control path the CLIs read; both connections name the same live
  database.
- The AFL API unit's `UnsetEnvironment=` list is readable (it is the steps' environment).
- The BEFORE record can be read and saved, and the watchdog **proves itself ready** (the startup handshake
  below). A watchdog that only received a PID is not armed.

*Owner / operator preconditions, not machine-enforced.* The operator confirms these before running it. The
tool does not prove them, and a wrong answer is not a refusal:
- **C4 is deployed.** The 2027 registration is a reviewed commit on the host's checkout: the `seasons.2027`
  identity in `data/reference/afl-api-identities.json`, the `afl_api_2027` round table, every 2027 venue id
  and the retained feed. The tool does not read the identities file or the round table before it turns the
  setting on.
- Readiness on the host's checkout is REPOSITORY READY on the newest retained 2027 feed. (The tool evaluates
  readiness only after the run, against the feed it has just acquired.)
- No 2027 match has started. (The BEFORE and AFTER records count 2027 matches and any change is a HALT, but a
  non-zero count before the run is not a refusal.)
- The AFL Tables timer is disabled or logs `AFLDB_AFLTABLES_RETIRED`. (The tool proves the switch is
  `retired`, not the timer's state.)

*If an owner / operator precondition is wrong, the failure arrives late.* In particular, if the season's
registration is absent from what is deployed, the tool cannot see it beforehand: acquisition refuses only
**after the setting has been temporarily enabled** (`acquire-afl-api.ts` throws "No compSeasonId declared for
season 2027 in data/reference/afl-api-identities.json"; a missing round table is a settle HALT), the
rehearsal HALTs (exit 1), and restoration is still required and is verified like any other. That is a wasted
run in a new evidence directory, never a pass.

**D-316-13 must not be granted or used before C4 is deployed.** The command line does not independently
prove all C4 prerequisites, so the decision is procedurally unavailable until C4 is deployed and the operator
has confirmed readiness on the host.

**Command** (on the host, from the checkout, as the deploy user; `.env` supplies `DATABASE_URL`,
`AFLDB_IMPORT_DATABASE_URL` and `AFLDB_AUTH_DATABASE_URL`; every run gets a new, empty evidence directory):

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
node node_modules/tsx/dist/cli.mjs tools/current-season/afl-api-c4b-rehearsal.ts \
  --season 2027 --decision D-316-13 --evidence-dir ~/backups/afldb/c4b-$STAMP
echo "exit $?"
```

**What it does, in order.**
1. BEFORE record (`before.json`): the count of 2027 matches, the count of `afl_api`-owned matches, and every
   `acquisition.%` setting, in one read-only transaction.
2. Starts a detached watchdog (`watchdog.pid`) and **waits for it to prove readiness** (`watchdog-ready.json`,
   below). Any other outcome refuses with exit 2 here, before step 3.
3. Turns the setting on, as `afldb_auth` with an `auth_audit_log` row in the same transaction (the admin
   toggle's own write path), and logs the time.
4. `acquire-afl-api.ts --season 2027` (AFL API network; writes snapshot files only, under
   `data/sources/afl_api/matches/<label>/`, manifest last). Output in `acquire.log`.
5. `settle-afl-api.ts --label "$L" --dry-run --auto-apply --require-complete-source`, with `$L` parsed as
   the unit script parses it. Output in `settle-dry-run.log`.
6. **Turns the setting off and verifies it**: exactly `false` as stored, and off on the control path. Up to
   three attempts. Logs the time and writes `restore-verified.json`.
7. Re-checks both timers, takes the AFTER record (`after.json`), and runs readiness against the acquisition's
   own `00-season-matches.json` (`readiness.txt`).
8. Applies the HALT criteria below and writes `result.json`. `run.log` holds every line.

Steps 4 and 5 run with the AFL API unit's `UnsetEnvironment=` list removed and `AFLDB_SKIP_DOTENV=1`, so
they hold the credentials the timer-run unit would, and not the auth DSN.

**How the setting gets back to off.**

| How the run ends | What restores the setting |
|---|---|
| Success, a failed or refused step, a thrown error, no label (early exit) | The tool's `finally`: write `false`, then verify (step 6) |
| Ctrl-C, SIGTERM, or SIGHUP (a lost SSH session) | Caught. The running step is stopped (SIGTERM, then SIGKILL after 10 s), then the same `finally` runs. A further signal does not interrupt the restore |
| The `--max-minutes` deadline (default 30, 5 to 120) | As an interruption |
| SIGKILL, an OOM kill, a crash of the tool | The watchdog, which was proven ready before the setting was turned on. Once the tool's process has gone without `restore-verified.json`, or the deadline plus two minutes has passed, it writes `false`, verifies it and records `watchdog-result.json` (a failure to write that record never stops the retries; the watchdog is detached with `stdio: ignore`, so see Remaining risks for what is and is not recorded then). It retries every 30 s and gives up an hour later |
| A host reboot while the setting is on | Nothing automatic. No AFL API timer is enabled, so nothing runs. Run `--restore-only` first after the reboot |

**Exit codes.** 0 = every automated HALT criterion clear. 1 = HALT; the setting is restored and verified.
2 = refused before any write (this includes a setup failure such as an unusable `--evidence-dir`). 3 =
**restoration not verified: the setting may still be on**; it is also the code for an error that escapes the
run itself, and for a `--restore-only` setup failure, because the setting's state is then not proved. On 3, at once:

```bash
node node_modules/tsx/dist/cli.mjs tools/current-season/afl-api-c4b-rehearsal.ts \
  --restore-only --evidence-dir <the same evidence directory>
```

**Evidence that cannot be written.** A file the tool cannot write never changes which exit code the run ends
with and never escapes as an unhandled rejection. A refusal stays **2** (the reasons are kept and logged;
`result.json` may then be absent, and the outcome carries an `evidenceError`) and an unverified restoration
stays **3**. A BEFORE record that cannot be saved is a refusal (2) before the watchdog and any setting write.
Once the setting is on, a failure to write `acquire.log`, `settle-dry-run.log`, `restore-verified.json`,
`after.json` or `readiness.txt` stops any further step, still restores and verifies the setting, and ends as
a **HALT (1)**; a run that would otherwise be CLEAR but cannot write `result.json` is also a **HALT (1)**, never
0, because C4b requires reviewable evidence. A lost log line changes nothing. If `restore-verified.json`
cannot be written the setting is still verified off, so the watchdog finds it already `false` and writes
nothing. The watchdog's own `watchdog-result.json` is evidence only: when it cannot be written the failure is
reported and the restore retries carry on, and the watchdog's outcome (0 restored, 3 after the give-up) is
decided by the restore alone.

**Steps that cannot be confirmed stopped, and dependencies that throw.** Once an acquire or settle process
exists, only its own exit ends the step; a `ChildProcess` `error` event (for example a signal that could not be
delivered) is not proof of it. Each step is started as `node --import <tsx loader> <script>` (the watchdog's
pattern, through the same `stepCommand` helper; no `tsx` CLI wrapper), so the PID and `ChildProcess` handle that
are monitored and signalled are the script's own. An abort sends SIGTERM, then SIGKILL after 10 s, through the
child handle only; a child that has still not exited 10 s after the SIGKILL is reported `unconfirmed`, and the
run ends as a **HALT (1)** naming the step ("<script> could not be confirmed stopped; it may still be running
(check the host for a stray <script> process)"). A step that ends by signal is also a HALT. The setting is
restored and verified before the result is returned (the order is restore, then `restore-verified.json`, then
`result.json`), and no later step starts, so the settle never follows an acquire that failed or could not be
confirmed stopped. **Pipes:** on every terminal path of a step (a normal close, an exit followed by the 5 s
drain deadline, an unconfirmed termination, a spawn that produced no process, a throw while setting the step
up) both output pipes are destroyed and the child handle is unref'd, so a descendant that still holds the
inherited descriptors cannot keep the C4b parent alive once the result exists; output is kept up to the drain
deadline, and a process that cannot be shown to have ended is never reported stopped. The operator should
then check the host for a stray `acquire-afl-api.ts` or `settle-afl-api.ts` process. A `systemctl` check that
throws before any write is a refusal (2); after the restore, a `systemctl` check or the readiness evaluation
that throws is a HALT reason (1) with the verified-off setting untouched, and is recorded in `result.json`
where that is writable.

**Watchdog startup handshake (the guarantee behind "armed").** A child PID proves only that a process was
created: it can exit during startup, and the setting would then be on with nothing to restore it if the tool
died. So the tool does not write the setting until the watchdog proves itself ready:
- The watchdog (`node --import <tsx loader> … --watchdog`, no wrapper process, so the PID the tool spawned
  is the watchdog's own `process.pid`; the acquire and settle steps use the same command shape since
  follow-up 5) parses its arguments (`--parent-pid`, `--deadline`, `--evidence-dir`
  and a well-formed `--run-id` are all required; a missing evidence directory is a startup failure, never
  created), builds its production dependencies, **reads the setting on both connection paths** (the writer
  and the CLIs' control path, the same two reads a restore needs, so its credentials and database work),
  checks the **parent is alive**, and only then publishes `watchdog-ready.json`: a temp file, read back
  (which proves the evidence directory is writable and readable), then an atomic rename. It never overwrites
  an existing marker and deletes nothing.
- The marker is `{kind, runId, watchdogPid, parentPid, at}`. The tool accepts it only if the kind is right,
  the run id equals this run's, `watchdogPid` equals the PID it spawned, `parentPid` equals its own PID, the
  timestamp parses, **and the watchdog process is still running** when the marker is read (the marker is read
  first and liveness second, so a watchdog that published and then exited is not ready).
- It refuses with **exit 2, before any setting write or acquisition step**, on: no marker within 45 s; the
  watchdog exiting before publishing; a marker that already exists before the watchdog starts (stale; refused
  before anything is started); a marker for another run; a wrong watchdog PID or parent PID; malformed or
  unreadable marker evidence (refused at once, not waited out); a failed spawn; **any failure after the
  process exists** (detaching, writing `watchdog.pid`, the start or readiness log), which stands that child
  down and stops it exactly as a missing marker does; or any watchdog startup error (the watchdog then exits
  2 and publishes nothing).
- A watchdog left from a refused startup is **stood down**: the tool writes `watchdog-stand-down.json` (run
  id and PID; exclusive create, never overwritten), which the watchdog honours before any restore write, then
  signals the child handle it started (SIGTERM, then SIGKILL after about 2 s; an already-exited child is never
  signalled, so a reused PID is safe) and logs whether it confirmed the stop. A stop is **confirmed only by an
  actual exit** (the child's `exit` event, or an exit or signal code on the handle): an `error` event, such as
  a `kill()` that could not deliver its signal, is not proof the child ended, so it is logged `NOT confirmed
  stopped` while the child may still be running and it still honours the stand-down marker. A rejected or
  throwing readiness wait (liveness probe, clock or sleep) is a refusal like any other: the original
  refusal survives, the stand-down is attempted and that exact child is stopped. This matters because a leftover
  watchdog that outlived a refused startup would otherwise write `false` (and an audit row) when its parent
  ended. The handle is kept the instant `spawn` returns and nothing fallible sits between the two; every
  later step runs inside the cleanup-protected sequence, so a failed stand-down write, a failed log or a failed
  `watchdog.pid` write neither skips the stop nor replaces the refusal, and an unconfirmed stop is logged.
  Nothing is deleted: refused-startup evidence (a bad marker, the stand-down marker, `watchdog.pid`)
  stays in the evidence directory for the C4b record.
- Not covered: a watchdog that dies **after** it was proven ready (an OOM kill, an operator `kill`), including
  in the milliseconds before the setting is written. There is no heartbeat. Its effect is exactly the
  "watchdog killed together with its parent" case in §10 (the `finally`, the signal handlers and the deadline
  still restore; `--restore-only` is the recovery).

Then confirm read-only that the setting is `false` (the `acquisition.%` host check, §6). `--restore-only`
writes nothing when the setting already reads exactly `false`. The preflight refuses to start while the
setting is on, so a leftover is never silently reused.

**HALT (C5 is blocked) on any of these.** The tool applies each one automatically, after the setting is off:
- `canonicalRowsInserted` > 0 or `canonicalRowsUpdated` > 0 in the dry-run report. Before Opening Round
  nothing is concluded, so nothing should even be planned. A missing counter line is a HALT, not a zero.
- The source-completeness check refuses (the settle exits non-zero under `--require-complete-source`).
- The `Season feed (AFLDB-ISSUE-231 …)` evidence is absent or incomplete (`seasonFeedComplete` not `true`).
- Any readiness FAIL against the acquired feed, including venue, team or round coverage.
- Any difference between the BEFORE and AFTER records apart from the setting's own audit trail. The toggled
  setting may only go from absent or `false` to exactly `false`.
- Either AFL API timer not `disabled` / `inactive` after the run.
- Any error, interruption, deadline or non-zero step exit.
- Any required evidence file the tool could not write (`acquire.log`, `settle-dry-run.log`, `after.json`,
  `readiness.txt`, `restore-verified.json`, `result.json`): a CLEAR needs its evidence.
- Restoration not verified (exit 3).

The operator also HALTs on anything in the evidence directory the tool did not anticipate.

**Failure restoration.**
- On exit 1 the tool has already restored and verified the setting. On exit 3 it has not: run
  `--restore-only` as above. Either way, confirm read-only that the setting is off and that both AFL API
  timers are still `disabled`.
- Keep the snapshot directory and the evidence directory; delete neither.
- If the AFTER record shows any canonical change, stop everything and escalate. A `--dry-run` must not write,
  so any change is a defect, and the next step is decided by the owner, not by this runbook.
- Return the evidence directory for review. C5 stays blocked until a C4b rerun passes, in a new evidence
  directory.

**The C4b PASS record.** Exit 0 is not the PASS. The reviewer records the C4b PASS against the evidence
directory (`result.json` CLEAR, `before.json`, `after.json` and the logs); C5 requires that record.

**Limitation.** Before Opening Round this proves the acquisition, the feed's completeness and coverage, and
the settle path over zero concluded matches. The concluded-match write path is first exercised at C7.

**Recovery:**
- **An interrupted C2 apply** leaves the switch already `retired`, so nothing fetches, while the other files
  may be old or new. Git is the recovery boundary: restore the touched files to the last commit and re-run.
  Never commit a partial set.
- **Undoing C2 after deploy, before any 2027 match:** revert the whole rollover commit. That restores
  `[2026]` and `active` / 2026 together. Never revert the switch alone: an active switch with `[2027]` is out
  of bounds and every gate refuses.
- **Pausing the cutover before any 2027 match:** turn the setting off and disable the AFL API timer. AFL
  Tables stays retired, so nothing fetches and nothing is lost.
- **Choosing AFL Tables for 2027 instead** means editing the switch to `active` **and** `last_season` 2027
  (a reviewed commit with an owner decision), re-enabling the AFL Tables timer and keeping the AFL API
  setting off. Before the first 2027 match that loses nothing, but it hands 2027 ownership to AFL Tables: it
  inserts every 2027 match as it is played (`canonical-apply.ts` `new_target`), and the AFL API then only
  corroborates.
- **Once 2027 AFL API matches exist, a flip back is itself an ownership decision.** The AFL Tables settle
  refuses `afl_api`-owned matches (`foreign_source_owner`), but it inserts every 2027 match with no row yet.
  Those rows become `afltables`-owned and the AFL API is refused on them for good, with no transfer tool. Do
  not flip back without a recorded owner decision naming the window and the matches it may claim. The
  default is to stay on the AFL API and fix forward.

## 8. Decisions needed (none exists yet)

| ID | Decision | Recommendation |
|---|---|---|
| D-316-1 | Authorise **one final AFL Tables full-history acquisition** (with the switch `active` / 2026) and the 2026 rollover that **retires AFL Tables in the same write**, `rollover-season.ts … --afltables-retirement-decision D-316-1` (C2). The tool accepts exactly `D-316-1` for the 2026 rollover (`AFLTABLES_RETIREMENT_DECISIONS`) and refuses any other id; a later re-activation of the switch must register its own decision in its reviewed commit. The earlier option (b), keeping the switch active until C5, is withdrawn: the tooling now refuses to produce `[2027]` with an active switch | Authorise: the established rollover path, and the last planned AFL Tables request. Disabling the AFL Tables timer at C2 as well is optional (the operator's choice at deploy time; mandatory by C5). Exact wording below |
| D-316-2 | Authorise installing the AFL API units on PROD as **inert units** (C3: ISSUE-232 §7 C only; nothing started, no timer, setting off, Brownlow environment absent). D1 moves to C4b and E to C8. C3's acceptance checks `is-enabled` (`disabled`) **and** `is-active` (`inactive`) for both timers and `inactive` for both services; the Brownlow timer stays disabled until C8 | Yes, in the off-season, after C0. Exact wording below |
| D-316-3 | Evidence bar for the `afl_api_2027` round table and new venue ids | The same bar as 2026 (§6.4 of ISSUE-228: authentic feed, per-round rows), plus readiness REPOSITORY READY on the retained feed and the `venues` SQL count on PROD |
| D-316-4 | The go/no-go for C5, with its acceptance criteria (C7) | Set the criteria now, before Opening Round 2027; require the C4b PASS record |
| D-316-5 | Debutants: accept manual registration and adjudication before each nightly, or change AFL API completeness from whole-night rollback to per-unit refusal | Accept manual for 2027 Opening Round; review after round 2 |
| D-316-6 | Ownership replay / AFL API baseline for rebuild, rollover and promotion (D-233-3) | Open a successor issue now; it is due before the 2027 rollover, which the tool now refuses without it |
| D-316-7 | Brownlow season totals without AFL Tables profile paths | Successor to ISSUE-232; due before September 2027 |
| D-316-8 | **Attendance** with no API source: accept NULL/`not_collected`, Super Admin entry, or another source | Owner's choice. NULL is the honest default (NULL ≠ 0) |
| D-316-9 | **Coaches / `match_coaches`** for 2027: admin entry, or accept the gap | Owner's choice |
| D-316-10 | Reverse **D-232-3** (let the AFL API units revalidate season pages, which means keeping `AFLDB_REVALIDATE_SECRET` in their environment), or accept ISR lag | Owner's choice; the mechanism exists (ISSUE-134) |
| D-316-11 | An on-demand "start now" for the AFL API unit (polkit rule + `startSettleRun` generalisation), deferred in ISSUE-232 §5 | Optional; not needed for the cutover |
| D-316-12 | `docs/deployment.md` §7d and the AFL Tables sections, and the admin current-season panel (it still says AFL Tables is authoritative, and its Start button ignores the switch, so each click after retirement writes one `unavailable` audit row), updated at C5 | Yes, as part of C5; the panel change is a UI change and carries the visual-evidence obligation |
| D-316-13 | Authorise the **C4b D1 rehearsal window** on PROD: runs of `afl-api-c4b-rehearsal.ts --season 2027 --decision D-316-13` (the tool accepts exactly `D-316-13`). The setting is on only inside a run and is restored to off by the tool on success, failure, interruption or deadline, and by its watchdog if the tool is killed (the watchdog must prove itself ready before the setting is turned on; a watchdog that does not is a refusal, exit 2, with no write, and is stood down); no timer is enabled; the HALT criteria and restoration above apply; `--restore-only` is authorised whenever the tool exits 3 or after a reboot during a run | Decide once C4 is deployed; before Opening Round. **Procedurally unavailable until C4 is deployed and the operator has confirmed readiness on the host: the CLI does not independently prove all C4 prerequisites (§7 C4b), so the decision must not be granted or used earlier.** A rerun after a HALT (exit 1) or an unverified restoration (exit 3) needs a fresh owner approval. The tool has never run against a database or host, so its first real run is C4b itself. Exact wording below |

### Proposed owner wording (copy-ready; no placeholders)

Each block matches the §7 step it authorises and nothing more. The owner may change any of it.

**D-316-1** (C2): "For the 2026 season only, I authorise: (1) one final AFL Tables full-history acquisition and
ladder witness, run while `data/reference/afltables-network.json` is `active` with `last_season` 2026; (2) the
D-233-3 census evidence; (3) a rollover dry run and then `rollover-season.ts --apply
--acknowledge-season-complete --afltables-retirement-decision D-316-1`, which writes the AFL Tables switch
`retired` first and then the five rollover files (`in_progress_seasons` becomes `[2027]`); (4) one reviewed
commit holding all six files; and (5) its deployment with a rebuild. I also authorise the operator to run
`systemctl disable --now afldb-settle-afltables.timer` when that commit is deployed, if the operator chooses to.
If they do not, the timer is a successful no-op (`AFLDB_AFLTABLES_RETIRED`, exit 0) until it is disabled, and
it must be disabled before C5. This decision authorises nothing else: not installing the AFL API units
(D-316-2), not the C4b rehearsal (D-316-13), not the cutover go (D-316-4), and not any change to B1."

**D-316-2** (C3): "I authorise installing the four AFL API unit files on PROD as inert units, exactly ISSUE-232
§7 C: `sh -n` on the two scripts, install the four files, `daemon-reload`, `systemd-analyze verify` and the
repository / installed hash pairing. No service is started and no timer is enabled;
`acquisition.afl_api_current_season_enabled` stays off and `AFLDB_AFL_API_BROWNLOW_ENABLED` stays absent. The
install is accepted only if both services are `loaded` and `inactive` and both timers are `disabled`
(`systemctl is-enabled`) and `inactive` (`systemctl is-active`). The Brownlow timer is not enabled until C8. This
does not authorise D1, ISSUE-232 section E, the C4b rehearsal or any timer."

**D-316-13** (C4b; not to be granted or used before C4 is deployed): "C4 is deployed and the operator has
confirmed that readiness is REPOSITORY READY on the host's checkout against the retained 2027 feed. I authorise
runs of `afl-api-c4b-rehearsal.ts --season 2027 --decision D-316-13` on PROD, each in a new empty evidence
directory, and `--restore-only` whenever a run exits 3 or after a reboot during a run. The tool enables no
timer. After a HALT (exit 1) or an exit 3, no further rehearsal run is authorised until I approve it afresh. An
exit 0 is evidence for the C4b record, not the PASS, and it does not authorise C5."

## 9. Open issues against this destination

Classification only. No requirement is waived and nothing is closed. Existing criteria and history are
preserved in each issue.

| Issue | Class | What survives / note |
|---|---|---|
| 229 fixture ingestion | Required | Core to the AFL API path; B2 is the same 2027 feed as C4 |
| 266 e-mail intake | Required (source-independent) | — |
| 267 / 269 override replay | Required | D-REL-A267 pending. "Preflight expected to FAIL on settle manifests" refers to the AFL Tables manifests (R7) |
| 268 blank attendance | Required | **More relevant**: attendance becomes Super Admin / legacy-intake only (D-316-8) |
| 270 invite takeover | Required | — |
| 271 / 272 legacy `match_results` | Required | Legacy intake, source-independent |
| 273 validation concurrency | Required | — |
| 274 settle row lock | Mixed | Code fix and DEV evidence survive (DEV nights were AFL API runs). The proposed PROD route "installed + counted AFL Tables nights" is withdrawn with T6; PROD acceptance now needs the AFL API unit (C3/C7) |
| 275 period scores under refused match | Mixed | DEV night (afl_api), State B (O-2) and census survive. The "two counted AFL Tables nights" wording of proposed D-REL-A275 is withdrawn; the `afl_api` refusal branch becomes reachable on PROD only after C3 |
| 276 period-score contradiction guard | Required | Reachable only once `afl_api` owns matches (C5) |
| 279 sitemap | Required (source-independent) | — |

**Tied solely to the retiring path (withdrawn 18 Oct, history preserved):**
- The PROD counted-AFL Tables-night plan and the T6 watcher, N1 and N2.
- The K1 check scoped by D-REL-K1-SCOPE (ISSUE-294's AFL Tables nightly batch timestamps), as a
  counted-night criterion.

**B1** (ISSUE-265 D-PROD-3, Match Sheet player-statistic corrections paused) **stays in force**. Lifting
it is the owner's separate decision, and this issue does not change it.

**Stale wording, not edited:** "after the ISSUE-265 hold" in 268, 270, 273 and 274 §33.6 predates the
18 Oct installation.

## 10. Independent review (2026-10-18)

A read-only reviewer re-derived the inventory, the gaps and the procedure from the code.

**Confirmed:** §2, §3 (except the two wording points below), §4 and §5. No missed AFL Tables call
site was found, and the tests have no false positives.

| Grade | Finding | Disposition |
|---|---|---|
| HIGH | C2 claimed the rollover leaves `in_progress_seasons: []`; it writes `[2027]` and refuses `[]`, so the nightly would fetch 2027 from C2 to C5 | C2 now stops AFL Tables in the same change (D-316-1 (a)/(b)); C4 and C5 corrected. Superseded by round 2: (a) is machine-enforced and (b) is withdrawn |
| MED | The C1 rehearsal ran the main checkout's script via `systemctl`, and a "start now" click on an `active` build would really fetch | C1 rewritten: run the worktree script directly; click only on a build from the `retired` tree |
| MED | The shell gate turned a broken Python into a quiet `retired` success | Fixed: an interpreter failure exits 1; new test |
| MED | Recovery omitted that a flip back lets AFL Tables insert, and so own, unplayed-until-then 2027 matches | Recovery rewritten; a flip back needs an owner decision |
| LOW | The R gates reported "retired" when run outside the repository root, or when jsonlite was missing | Fixed: the message names the working directory; jsonlite is checked first in `acquire_club_lists.R` |
| LOW | The admin panel ignores the switch | Recorded under D-316-12 (UI, visual evidence owed); not changed here |
| LOW | The readiness tests read the tracked register and would break at the rollover; no broken-interpreter test | Fixed: register fixtures; new test |
| INFO | Two wording points: the source of the "no automatic fallback authority" quote, and the admin Brownlow `revalidateSeason` call | Corrected in §2 and §3 |

### Round 2 (2026-10-18, owner findings on the uncommitted branch)

| Finding | Disposition |
|---|---|
| 1. C2 said the rollover and the retirement must happen together, but `rollover-season.ts` neither enforced nor applied the switch | **Machine-enforced (§6).** The switch carries `last_season`; every gate refuses an active switch behind the register, and the shell unit fails loudly. The rollover requires `--afltables-retirement-decision`, refuses before gate 1 unless the switch is `active` and bounded to `--season`, and writes it `retired` first. A tracked-file invariant test fails on `[2027]` with an active switch. Option (b) of D-316-1 is withdrawn |
| 2. C3 ran ISSUE-232 D1 with the setting off (acquisition and settle refuse) and before 2027 was registered (C4) | **C3 is inert installation only** (ISSUE-232 §7 C). The D1 rehearsal is the new **C4b**, after C4 and before C5, with an explicit on/rehearse/off sequence, HALT criteria, unconditional restoration and BEFORE/AFTER records (new D-316-13). No AFL API timer before C5; C5 needs the C4b PASS; the Brownlow timer waits for C8 (ISSUE-232 E moves there) |
| 3. Readiness could report READY without proving every provider venue in the 2027 feed is mapped | **Feed-derived coverage added (§6):** `season_feed` (complete ISSUE-231 enumeration of the registered `CD_S`), `venue_coverage`, `team_coverage`, `round_coverage`. No, malformed or incomplete evidence fails every coverage check. The verdict reads `REPOSITORY READY … NOT the cutover go`; the `venues` rows are printed as a read-only SQL count |

**Self-review of the resulting diff (ordering and recovery).**
- Write order: the switch is written after every gate has passed and `--apply` is confirmed, and before the
  other five files, so no interrupted state can fetch 2027. A test pins the order.
- Deploy order: the rollover commit carries both changes, so no deploy can hold `[2027]` with an active
  switch. A hand-split commit is out of bounds and refuses everywhere.
- The app's copy of both files is build-time. A host that pulls without rebuilding still runs the shell gate,
  which re-reads both at run time. C2 and C5 deploy with a rebuild.
- The rollover tool's new refusal of a retired switch also blocks the 2027 rollover. That is intended, and
  it names D-316-6.
- Not proved here: the rollover CLI end to end (it needs a real full-history candidate, so only its planner
  and the source order are tested), and Linux behaviour.

### Round 3 (2026-10-18, owner findings on the uncommitted branch)

| Finding | Disposition |
|---|---|
| 1. `--afltables-retirement-decision` accepted any well-formed `D-*` id, so an unrelated decision could authorise retirement | **Exact (§6).** `AFLTABLES_RETIREMENT_DECISIONS` registers the authorising decision per completed season (2026: `D-316-1`), and the planner refuses any other value before gate 1. The parser still checks syntax and now refuses the flag given twice. The retired switch records the decision. **Design note:** the flag was generic on purpose, because the switch can be re-activated for a later season (§7, Recovery). Exact enforcement keeps that: the re-activation commit registers its own season and decision. No documented contract changed: §7 and D-316-1 already named `D-316-1` |
| 2. C4b's manual on / acquire / dry run / off sequence could leave the setting on after a failure, an interruption or an early exit | **One command (§6, §7 C4b).** `afl-api-c4b-rehearsal.ts` restores the setting in a `finally`, catches SIGINT, SIGTERM and SIGHUP, has a deadline, and arms a detached watchdog that restores it if the tool is killed. Exit 3 and `--restore-only` cover a restore that cannot be verified. BEFORE/AFTER evidence, the HALT criteria (now applied by the tool) and the recorded C4b PASS before C5 are kept; both AFL API timers stay disabled; D-316-13 updated. Not executed at the time; superseded for the tests (executed 2026-10-19, see "Follow-up 8 validation"); the tool itself has never run on Linux, PostgreSQL or PROD |
| 3. Readiness could print a venues SQL check built from the venues mapped before a malformed or unmapped entry | **All or nothing (§6).** `venue_coverage` collects names locally and publishes them only on a complete pass, `feedVenueLegacyNames` is empty unless that check passed, and the CLI's `venueRowsCheck()` takes the whole readiness and returns nothing unless `venue_coverage` passed. Tested with failures after mapped venues |

**Round 3 follow-up (2026-10-18, owner finding on the uncommitted branch).** `armWatchdog()` treated receipt of
a child PID as proof that the watchdog was armed. The child could receive a PID and then exit during startup,
after which the tool could turn the setting on with no functioning watchdog. **Fixed (§7, "Watchdog startup
handshake").** The watchdog now publishes a run-bound, PID-bound readiness marker only after it has parsed its
arguments, read the setting on both paths, confirmed the evidence directory is writable and readable and
confirmed the parent is alive; the tool writes the setting only after a matching marker from a still-running
watchdog, within 45 s. A PID alone, a stale or other-run marker, a wrong watchdog or parent PID, malformed
evidence, an early exit, a timeout or any startup error is exit 2 before any write, and a leftover watchdog is
stood down. The `finally`, signal handling, deadline, restoration verification, `--restore-only`, read-only
`systemctl` and no-`--apply` rules are unchanged. Not executed at the time; superseded for the tests (executed 2026-10-19, see "Follow-up 7 validation" and "Follow-up 8 validation"). The C4b tool itself has never run on Linux, PostgreSQL or PROD.

**Round 3 follow-up 2 (2026-10-18).** `launch()` did the `watchdog.pid` write and the start log after the
spawn but before returning its handle, so a failure there left a running watchdog the cleanup could neither
stop nor stand down. **Fixed (§7):** `launch()` returns the exact handle immediately after `spawn`, and the PID
record, detach and logs run in a new `afterLaunch` step inside the protected sequence. Not executed at the time; superseded for the tests (executed 2026-10-19, see "Follow-up 7 validation" and "Follow-up 8 validation"). The C4b tool itself has never run on Linux, PostgreSQL or PROD.

**Round 3 follow-up 3 (2026-10-18, remaining informational audit items).** Fixed in the C4b tool. Not executed at the time; superseded for the tests (executed 2026-10-19, see "Follow-up 7 validation" and "Follow-up 8 validation"). The C4b tool itself has never run on Linux, PostgreSQL or PROD.
1. *Rejected readiness wait.* `armWatchdogWithHandshake` already converted a rejection from `awaitWatchdogReady`
   into a refusal, but nothing tested it. New tests make `watchdogAlive`, `now` (first and later call) and
   `sleep` throw or reject, and prove the refusal text survives with no driver text, the stand-down is
   attempted, the exact child is stopped (also with a failing stand-down write, stop and log), and through the
   rehearsal the run exits 2 with zero setting writes and no acquisition or settle step. No source change.
2. *Child-exit accounting.* The adapter set its `exited` flag on any `error` event, so a `kill()` that could
   not deliver its signal was reported as `stopped` while the child still ran. The `error` listener now only
   exists to avoid an unhandled event; confirmation needs the child's `exit` event or an exit or signal code
   on the handle. A handle-based `kill` is still used only while the child has not exited, so a reused PID is
   never signalled. `armWatchdogProcess` takes optional `spawnProcess` and `stopPollMs` for the tests.
3. *Evidence writes.* `finish()` wrote `result.json` unguarded, so a failure there turned a pre-write refusal
   into an unhandled rejection (an accidental exit 1). Every evidence write in the rehearsal is now guarded (the watchdog's own result file followed in follow-up 4) (see "Evidence that
   cannot be written" in §7): refusals stay 2, an unverified restoration stays 3, and a CLEAR whose evidence
   is missing is a HALT. Writing `before.json` is now a refusal point before the watchdog. Logging is
   fail-safe.
4. *Negative-control record.* **Superseded by follow-up 4 item 5.** The control figures first recorded here
   (7 failed / 240 passed, and the 2, 7 and 12 counts) cannot be tied to specific bytes: the "originals" hash
   file was written before the final source edits, so it does not show the bytes the controls ran against.
   They are withdrawn as evidence and replaced by controls re-run on the current bytes.

**Round 3 follow-up 4 (2026-10-18, audit of the follow-up 3 branch).** Fixed in the C4b tool. Not executed at the time; superseded for the tests (executed 2026-10-19, see "Follow-up 7 validation" and "Follow-up 8 validation"). The C4b tool itself has never run on Linux, PostgreSQL or PROD.
1. *Watchdog evidence.* `watchdog-result.json` was written unguarded between the restore and the
   `if (r.verified)` test, so after three failed restores an unwritable evidence directory ended the watchdog
   by unhandled rejection and skipped the 30 s retry loop. The write is now guarded: a failure is logged
   (`watchdog-result.json could not be written: …`, error code only) and the outcome depends on the restore
   alone, with the retries and the give-up unchanged. The watchdog's log calls are guarded too.
2. *Step completion.* The acquire/settle runner resolved the step on any `ChildProcess` `error` event, so a
   `kill()` that could not deliver its signal was reported as an ended step while the child might still run.
   It is now `runChildStep`: only the child's own `exit`/`close` (or an exit or signal code on the handle) ends a
   step; an `error` event resolves it only when no process exists (no PID); a spawn that throws is a step that
   could not start; an abort signals through the handle only and never an exited child; a child that is still
   not exited after SIGTERM, a 10 s grace, SIGKILL and 10 s is `unconfirmed`, with its pipes released. The
   rehearsal turns `unconfirmed` into a named HALT, restores the setting as usual and starts no later step.
   An exited child whose output pipes a grandchild holds open is resolved 5 s after the exit. **Corrected by
   follow-up 5 item 2:** the statement as first written implied the pipes were then released, but only the
   `unconfirmed` path destroyed them; the 5 s path resolved the step and left them open, so a surviving
   descendant could have kept the C4b parent alive. Every terminal path now releases them.
3. *Dependencies and exit codes.* The AFTER `systemctl` check and the readiness evaluation are guarded (HALT
   reasons, not rejections); the same `systemctl` calls in the preconditions are guarded (a refusal);
   `main()` is exported and returns 2 for a setup failure (3 for `--restore-only`) and 3 for an error that
   escapes the run, so no exit code comes from an unhandled rejection. The 3 for an error escaping the run is
   not itself covered by a test (only the setup failures are).
4. *Tracking.* The stale "149 new tests" in the `issues.md` table is now 270. `IssuesIndex.md`, `issues.md`,
   `CHANGELOG.md` and this runbook agreed at that point: 270 tests in the new suite, 680 across the seven suites
   (superseded history; the current totals are under "Tests" and "Regression suites" above).
5. *Negative-control provenance.* One command hashed `tools/current-season/afl-api-c4b-rehearsal.ts` and
   `tests/afl-api-cutover.test.ts` (sha256 `941e57d93d2adee5cc77f573b3b7d273c3fad1fb8b115539b6d72585c6030827`
   and `f02aa2324a69004dab0104a682eda23966dfe7cc3842f962ee7989d79e41d78d`; the full digests were recomputed on
   2026-10-18 before the follow-up 5 edits, and the files on disk then matched the recorded prefixes, so they
   are the bytes those controls ran against), copied them to scratch files
   `tools/current-season/zz-mut-tool.ts` and `tests/zz-mut.test.ts`, applied one mutation per run to the scratch
   tool only, ran the scratch test, deleted both scratch files, and re-hashed the two real files: byte-identical.
   Results on those bytes: the earlier `afterLaunch`-outside-the-protected-sequence mutation: 7 failed, 263
   passed, and the named survivor ("a readiness log that fails after the watchdog proved itself…") passed, so it
   is outside the mutated path; the watchdog evidence write left unguarded: 4 failed (the four new watchdog
   tests); an `error` event counted as step completion: 3 failed (the error-after-spawn test and the two abort
   tests); `unconfirmed` handled as a plain end: 3 failed; the AFTER `systemctl` catch rethrown: 1 failed; the
   readiness catch rethrown: 2 failed; the precondition `systemctl` catches rethrown: 1 failed; the `main()`
   setup catch rethrown: 1 failed. Each mutation failed only the tests written for it.
6. *Line endings.* Not normalised. Each changed or new file is internally one style with exactly one final
   newline and no trailing whitespace on added lines (checked after this change). The worktree copy of
   `issues.md` has LF working-copy endings, while the repository checks files out as CRLF
   (`core.autocrlf=true`; the main checkout's copy is CRLF), so Git prints "LF will be replaced by CRLF the next
   time Git touches it" for that file. That is a working-copy/checkout difference, not mixed endings within the
   file, and the diff of it is limited to the intended hunks. The new files are LF and
   `tests/afl-api-cutover.test.ts` is CRLF; all are normalised by the index on `git add`. `git diff --check`
   is clean.

Still valid when written (follow-up 4): the tool has not been run, and nothing was committed, staged, deployed or contacted. The tool itself still has not run on Linux, PostgreSQL or PROD; its tests have since been executed, DB-free, on Windows ("Follow-up 7 validation", "Follow-up 8 validation").

**Round 3 follow-up 5 (2026-10-18, audit of the follow-up 4 branch: F1 and the related documentation and test
gaps).** Fixed in the C4b tool and its tests. Not executed at the time; superseded for the tests (executed 2026-10-19, see "Follow-up 7 validation" and "Follow-up 8 validation"). The C4b tool itself has never run on Linux, PostgreSQL or PROD.
1. *Wrapper process (F1).* Acquire and settle were started as `node tsx/dist/cli.mjs <script>`. The tsx CLI runs
   the script in a second process, so the PID and `ChildProcess` handle the runner monitored and signalled were
   the wrapper's: a SIGTERM, a SIGKILL or an `unconfirmed` verdict described the wrapper, not the script. Both
   steps now start as `node --import <tsx loader> <script> <args>` through `stepCommand` (new, with
   `tsxLoaderArgs`; `watchdogCommand` is now built on it, so the watchdog and the steps share one command shape).
   The narrowed environment, working directory, arguments and output capture are unchanged. Proved over a real
   process: the script's own `process.pid` equals the PID the runner spawned, and the control run through the tsx
   CLI reports a different PID (the wrapper's). A source assertion fails if either command goes back to the CLI.
2. *Pipe release.* `finish()` now calls `releasePipes()` (destroy stdout and stderr, each in its own `try`, then
   unref the handle) so every terminal path releases them: a normal close, an exit followed by the drain
   deadline, an unconfirmed termination, a spawn that produced no process, and a throw while setting the step up
   after the spawn. For that last case the tool SIGKILLs through the handle unless the handle already shows an
   exit (an exited child is never signalled), and reports the step stopped only if the handle shows it, else
   `unconfirmed`. Output is kept up to the drain deadline. Proved by a real separate Node process that runs the
   runner against a detached descendant holding the inherited pipes (it lives 25 s): the process ended by itself
   with its result in under 5 s while the descendant was still running. Output arriving after the drain deadline
   from such a descendant is dropped.
3. *Rehearsal safety (tests; one wording change).* A step ended by signal, or unconfirmed, HALTs (exit 1; exit 3
   if the restore is unverified); the setting is restored, the marker written and only then `result.json`; the
   settle never starts after an acquire that ended by signal or could not be confirmed stopped. The unconfirmed
   reason now reads "<script> could not be confirmed stopped; it may still be running (check the host for a
   stray <script> process)": "after the abort" was dropped because a setup throw is also unconfirmed, and the
   operator follow-up is stated in `result.json` itself.
4. *Tests.* The new suite is, at follow-up 5, 293 tests (291 pass, 2 are POSIX-only and skip on Windows), 23 more than 270; follow-up 6 adds 4 (unrun; follow-up 7 replaced them with 13, executed 2026-10-19).
   Pipe release on each terminal path over a fake child; SIGTERM honoured (confirmed by the exit), SIGTERM
   delivered but ignored then SIGKILL, SIGKILL after an undeliverable SIGTERM, and unconfirmed termination; the
   setup-throw cases; the direct-loader PID proof and its tsx CLI control; the surviving-descendant process;
   rehearsal ordering (restore before `result.json`) for signal-ended and unconfirmed steps, also over the real
   runner with a fake child and with a real process stopped by the deadline; and retry timing: restoration backs
   off 2 s then 4 s with no sleep after the last attempt, the watchdog polls every 5 s, and a failed round waits
   30 s (`[2000, 4000, 30000, 2000, 4000]` to the give-up). The two POSIX-only tests (a real process that ignores
   SIGTERM then SIGKILL, and a real SIGTERM) were **not run** here; a Windows `kill()` cannot be made to ignore a
   signal, so SIGKILL escalation is exercised there only over the fake child.
5. *Negative controls, on the final bytes.* One command per control mutated the real tool in place, ran the new
   suite, restored the original from memory, and finally re-hashed (no scratch files). Final sha256, tool
   `c5713cb059a223369787c95981c822a237ec4eb3fefba9440407b3a86ef1ab54`, test
   `7a9e1b18be7825eae653a0b2edc3625c2c6928216757eaaa197915be97b09f8b`; both were identical after the controls.
   Unmutated 291 passed, 2 skipped. `finish()` not releasing pipes: 11 failed (including the descendant process);
   `releasePipes` not destroying: 11 failed; not unref'ing: 10 failed; the setup-throw path signalling an exited
   child: 1 failed; the setup-throw path reporting stopped: 1 failed; restore backoff 1 s not 2 s: 3 failed;
   watchdog cycle 5 s not 30 s: 2 failed; steps back on the tsx CLI: 1 failed (the source assertion); `unconfirmed`
   handled as a plain end: 7 failed. Each failed only tests written for it.
6. *Documentation.* The pipe and termination descriptions in this section and in §7 are corrected (the follow-up 4
   statement that an exited child's pipes were released after the drain was wrong, and is marked in place). The
   claim that an unwritable watchdog evidence directory is logged to `run.log` and the console was wrong and is
   corrected under Remaining risks. The negative-control provenance of follow-up 4 now carries full digests. Both
   unguarded production-clock calls are recorded under Remaining risks.
7. *Isolation.* The new runs used `TEMP`, `TMP` and `TMPDIR` set to `.next/c4b-run-tmp` inside the worktree
   (git-ignored), `vitest run --no-cache`, `tsc --incremental false` and `eslint --no-cache`; the test sandboxes
   and the tsx transform cache therefore fell there too. The worktree's `node_modules` is a junction to the main
   checkout, and **one write did go through it**: Vitest's config loader (Vite) bundles `vitest.config.mts` into
   `node_modules/.vite-temp` and deletes the bundle again, so each Vitest run touched the main checkout's
   `node_modules/.vite-temp` (an empty directory created on 2026-10-03; its modification time moved to the start
   of the last run, 19:41:39 AEDT, and it holds no file). Vitest's own results cache
   (`node_modules/.vite/vitest/…/results.json`) was not written (`--no-cache`; its time is still 19:07:19), `tsc`
   used `--incremental false` and left `tsconfig.tsbuildinfo` as it was, and the main checkout's `git status` was
   identical before and after. A later run can avoid the `.vite-temp` write with Vitest's `--configLoader runner`
   (in memory); that option was not tried here, so it is not confirmed.
8. *Line endings.* Unchanged: the tool is LF and the test file CRLF, each uniform with its final newline.

**Round 3 follow-up 6 (2026-10-18, final F1 audit: two LOW findings).** Test and documentation only; no
production code changed; the new tests were **not run** at the time (see the isolation note; the cleanup was rewritten
in follow-up 7 and executed under proven isolation, see "Follow-up 7 validation").
1. *Stale totals.* The current-state references to 149/149, 270/270 and 680/680 were replaced by the then-last executed
   result (291 passed plus 2 POSIX-only skipped, 293; seven suites 701 passed plus 2 skipped, 703). The older
   counts that remain are labelled superseded history. `issues.md` and `IssuesIndex.md` carry the same figures;
   `CHANGELOG.md` states no test counts for this issue.
2. *Unsafe PID cleanup in tests (mechanics superseded by follow-up 7: the per-PID 5 s wait and the helper-level
   tests described here and in item 3 no longer exist).* Two `afterAll` blocks sent `SIGKILL` to PIDs recorded from a file or a log
   line, after the original processes might have exited and been reaped, so a recycled number could have been
   hit. No test now signals a bare PID. The watchdog stand-in and the detached descendant end themselves: on a
   run-bound shutdown file (its content must equal the process's own run id or per-test token, so another run's
   token does nothing), or at their own 20 s and 25 s deadlines at the latest. Cleanup writes the tokens, then
   waits at most 5 s per PID using the signal-0 probe, which only reads. A PID still present after the bound is
   reported, never signalled. Termination of anything a test owns stays on its own `ChildProcess` handle (the
   adapter's post-spawn tests assert that only signal 0 reaches `process.kill`).
3. *New tests (4, in the adapter block).* An exited and reaped PID is only probed; a PID that now looks occupied
   by an unrelated process is waited for within the bound (200 ms in the test) and never signalled; a live
   stand-in is untouched by another run's token and ends with exit code 0 and no signal code on its run's token,
   with only signal-0 calls observed; and a source guard fails if the file ever calls `process.kill` with a
   named signal on a bare PID.
4. *Checks.* `tsc --noEmit -p .` exit 0 (a first run found two implicit-any parameters in the new helper, fixed);
   ESLint `--no-cache` on the test file exit 0. **Vitest was not run at the time (superseded: it was run under proven isolation in follow-up 7)**: `node_modules` is a junction to the main
   checkout, and the config loader writes `node_modules/.vite-temp` through it (the follow-up 5 isolation note),
   so isolation inside the worktree could not be guaranteed. The expected next result is 295 passed plus 2
   skipped, 297, which is a prediction and not a validation (superseded by follow-up 7). At the time neither the new
   tests nor the rewritten fixtures had been executed (superseded: executed 2026-10-19, "Follow-up 7 validation"),
   and the negative controls were not repeated.

**Round 3 follow-up 7 (2026-10-19, final read-only review: F1–F4, and the documentation and totals items).** Test
and documentation only; no production code changed; **none of the new or rewritten tests had been run when this
follow-up was written** (they were executed afterwards, see "Follow-up 7 validation"). The
review text for F5 and F6 was not available to this session; they were read as the documentation, totals and
token-binding corrections, which are items 5 and 6 below.
1. *One named cleanup (F1).* Both process-owning `afterAll` hooks (the watchdog adapter block and the
   `runChildStep` block) are now `afterAll(() => teardownRegisteredProcesses(registry))`: the promise is returned,
   so a failure fails the hook and cannot be discarded. The contract, in order: (a) every registered sandbox's own
   run token is written to its shutdown file **before any wait**; (b) PIDs are recovered at teardown, so the test
   body's own registration is not required; (c) **one shared deadline** (5 s) covers all PIDs together, each probed
   with signal 0 only, where `ESRCH` is the only proof of absence and `EPERM` or any other error leaves the PID
   unconfirmed; (d) a process the test owns through its exact `ChildProcess` handle, still running at the
   deadline, is ended through that handle (one further shared 2 s), and a handle that has already exited is neither
   probed nor signalled; (e) any PID left fails the hook with `pid N (alive|unconfirmed), run token T, evidence D`
   per PID, and that sandbox's directory and shutdown file stay on disk; a sandbox is deleted only once all of its
   PIDs are confirmed gone. No terminating signal is ever sent to a bare PID.
2. *Discovery after early failures (F2).* Each sandbox is registered (`registerSandbox`: directory, evidence
   directory, unique token, shutdown file, PID-file and report lists) **before** anything is spawned. At teardown
   the PIDs come from the run-bound `watchdog.pid`, from a descendant's own PID file (the detached descendant now
   writes `grandchild.pid` as its first act), from the `GRANDCHILD <pid>` line of a report, from PIDs the test
   registered, and from owned handles. The adapter's post-spawn tests register a PID from the log the moment
   `watchdog started: pid N` (or `NOT confirmed stopped`) is produced, before the caller's log runs, so a log that
   throws cannot lose it. The descendant test parses its report inside `try`/`finally`.
3. *The real teardown path is tested (F3).* The old helper-level tests are gone; 13 tests call
   `teardownRegisteredProcesses` itself, each on its own registry so a deliberate failure leaves nothing for the
   suite hook: unique tokens per sandbox; a cooperative shutdown (fixture exits 0, sandbox removed, only signal 0
   seen); a fixture that ignores its token (the failure names PID, token and evidence directory, nothing deleted,
   the shutdown file holds the token, and after the test ends the process itself the same teardown confirms and
   deletes); PID recovery from `watchdog.pid` for a watchdog the test never registered; PID recovery from a report;
   four sandboxes sharing one 400 ms deadline (elapsed between about 350 ms and 1 s, not four times 400 ms) with
   every token written before the first probe; `EPERM` unconfirmed and failing, then `ESRCH` confirming; a reaped
   PID only probed; an exited handle neither probed nor signalled; a still-running owned handle ended through the
   handle with no `process.kill` signal; a PID that looks occupied by another process reported and never
   signalled; and a source tripwire (supplementary: exactly two hooks of that form, no named signal to a bare PID).
4. *Wrong-token test without timing (F4).* The stand-in writes `stand-in.polling` (its sandbox's token) only after
   its poll is running, and `stand-in.seen` with each different shutdown-file content it read. The test waits for
   the marker, writes **another sandbox's** token, waits until `stand-in.seen` shows that token was read (so it was
   seen and ignored, not merely unobserved), asserts the process still runs, then writes its own token and awaits
   the exit (code 0, no signal code). Marker, token, shutdown file and process evidence all live in that
   sandbox's directory.
5. *Unique per-test tokens.* The shared `run-real` value is gone. Every sandbox's token is
   `c4b-arm-<uuid>` (or `c4b-step-<uuid>` for the runner block), used as the stand-in's run id, the adapter's
   `runId` and the cleanup token, so a stale file or process from another test cannot satisfy it. The earlier
   follow-up 6 statement that tokens were "per-test" described a shared constant for the adapter block; it is
   corrected here.
6. *Totals.* As written at the time: executed 291 passed plus 2 skipped, 293 (new suite) and 701 plus 2, 703
   (seven suites); predicted, unexecuted: 304 plus 2, 306 and 714 plus 2, 716. **Superseded: both predictions
   were executed on 2026-10-19 and matched exactly** (see "Follow-up 7 validation"); 291+2 and 701+2 are now
   history. `CHANGELOG.md` states no counts.
7. *Checks.* `tsc --noEmit --incremental false -p .` exit 0 (whole tree); ESLint `--no-cache` on
   `tests/afl-api-cutover.test.ts`, the only changed TypeScript file, exit 0. Measured by byte count, the test
   file, this runbook, `issues.md` and `IssuesIndex.md` are uniformly LF with a final newline and no trailing
   whitespace added (`issues.md` has two trailing-whitespace lines that predate this change, in sections unrelated to this issue); the tracked files'
   diffs against the index are small, so no edit converted endings. The production tool was not edited and is
   uniformly LF (1357 lines). Follow-up 5 item 8 recorded the test file as CRLF; on disk it is LF, and because
   the file is untracked its earlier state cannot be shown. Nothing is staged, the working-tree status is
   identical to before and the untracked set is unchanged. The main checkout's git status and
   `node_modules/.vite-temp`, `.vite` and `tsconfig.tsbuildinfo` metadata were identical before and after.
8. *Vitest not run (as written at the time; superseded).* Reading Vitest 4.1.10 shows `--no-cache` leaves its
   results cache path unset and the fs module cache defaults off, so `--no-cache --configLoader runner` and a
   redirected `TEMP`/`TMP` should write nothing beneath the junction, but that was a reading of the source, not an
   observation, and the 13 new tests spawn real processes. Isolation was therefore not proven and the suite was
   not run. It was run afterwards under proven isolation; see the next section.

**Follow-up 7 validation (2026-10-19, executed under proven isolation).** The figures in this section are follow-up 7's, taken before follow-up 8 added the number-contract tests; the current totals are in "Follow-up 8 validation". No production code, Git state, database,
host or timer was touched; the production tool's bytes are unchanged. Only this runbook, `issues.md` and
`IssuesIndex.md` were edited, after both runs passed.
1. *Isolation, established before running (from the installed source, Vitest 4.1.10 with its nested Vite 8.2.1).*
   `vitest.config.mts` is unchanged. Vite's default `bundle` config loader writes the bundled config to
   `node_modules/.vite-temp` (`loadConfigFromBundledFile`); `--configLoader runner` loads it through
   `runnerImport`, in memory, with `cacheDir` set to the process cwd and no temp file. Vitest's results cache path
   is set only when `resolved.cache` is truthy, and `--no-cache` leaves it `false`, so `results.json` is neither
   read nor written; the fs module cache defaults off (`experimental.fsModuleCache ?? false`); the dependency
   optimizer is switched off for the node environment. No `.env` exists in the worktree and no `AFLDB_*`/`DATABASE*`
   variable is set, so `tests/setup.ts` configures no database and the run is DB-free. All temporary files were
   made under `artifacts/f7-validation/tmp` (run 1) and `tmp2` (run 2 and the stability runs), inside the worktree
   (git-ignored by `/artifacts/`), with `TEMP` and `TMP` set to them.
2. *Commands (Git Bash, from the worktree root; `$S` is `D:\dev\afldb-afl-api-cutover\artifacts\f7-validation`).*
   Run 1: `TEMP=$S\tmp TMP=$S\tmp node node_modules/vitest/vitest.mjs run tests/afl-api-cutover.test.ts --no-cache
   --configLoader runner --reporter=verbose --reporter=json --outputFile.json=$S\run1.json`. Run 2: the same with
   `TEMP`/`TMP` at `$S\tmp2` and the seven files `tests/admin-current-season-settle.test.ts`,
   `tests/fitzroy-acquisition.test.ts`, `tests/coaches.test.ts`, `tests/club-list-sources.test.ts`,
   `tests/afl-api-ingestion-safety.test.ts`, `tests/season-rollover.test.ts`, `tests/afl-api-cutover.test.ts`.
   Stability: five further runs of the new file with `-t "share one bounded deadline|does not stop the stand-in"`
   and the same flags. Each invocation exited 0.
3. *Isolation evidence.* `snap.ps1` (in the same directory) recorded a 56,103-line snapshot: the main checkout's
   `git --no-optional-locks status --porcelain=v1 --untracked-files=all --ignored`; existence, recursive metadata and
   SHA-256 of `D:\dev\afldb\node_modules\.vite-temp` (an empty directory created 2026-10-03; last modified
   2026-10-18 19:41:39 AEDT, 08:41:39 UTC, the follow-up 5 run, so not moved by follow-up 7's runs; ticks
   `639279096999978894` in the saved snapshot), of `.vite` (a directory modified 2026-10-03 21:54:17 AEST, ticks
   `639266252575691211`, holding one file, `vitest/da39a3ee…/results.json`, 22,641 bytes, modified 2026-10-18
   19:07:19 AEDT, SHA-256 `AF7BB103…CC481FB`) and of `D:\dev\afldb\tsconfig.tsbuildinfo`
   (453,974 bytes, SHA-256 `7AA52739…F64104CE`, modified 2026-10-15 19:46:59 AEDT); the same paths through the worktree (the `node_modules` junction
   resolves to the main checkout's, so those entries are the same files); the worktree's own `tsconfig.tsbuildinfo`
   and git status; and name, size and modification time of every file in the main checkout outside `.git`, `.next`
   and `node_modules`, plus the top levels of `node_modules` and `.next`. Two baselines taken back to back were
   identical (the snapshot is stable without a run). The snapshots taken after run 1, after run 2 and after the
   stability runs are each **byte-identical to the baseline** (`Compare-Object` 0 differences; file hash
   `154E96FA0AF656CC…` for all four). The main checkout was not written. After each run the scratch `TEMP` held only
   tsx's own transform cache (`tsx-stuar`), which shows the redirection worked; no `c4b-*` sandbox remained.
4. *Results.* Run 1: 1 file, **304 passed and 2 skipped, 306** (the 2 skips are the POSIX-only SIGTERM/SIGKILL
   tests). Run 2: 7 files, **714 passed and 2 skipped, 716** (admin-current-season-settle 58, fitzroy-acquisition
   23, coaches 12, club-list-sources 8, afl-api-ingestion-safety 166, season-rollover 143, afl-api-cutover
   304 plus 2 skipped). Both match the predictions made in follow-up 7.
5. *Review of the output.* (a) Both real `afterAll` hooks (`tests/afl-api-cutover.test.ts` lines 1840 and 2716) are
   `afterAll(() => teardownRegisteredProcesses(...))` and the source tripwire test asserts exactly two of that form;
   no hook failure was reported in either run, and every sandbox they own was removed from `TEMP` afterwards. That
   is observed effect, not a direct hook trace. (b) The 13 `teardownRegisteredProcesses` tests ran and passed;
   none is skipped (the only skips are the 2 POSIX-only). (c) The shared-deadline test (four sandboxes, 400 ms
   deadline, elapsed asserted between 350 ms and 1 s) took 444 ms in run 1, 429 ms in run 2 and 420–433 ms in
   five filtered reruns, well inside the bound; it did not flake in seven observations. (d) The ignored-token
   fixture test passed: the teardown failed naming the PID, run token and evidence directory, nothing was deleted,
   the shutdown file held the token, and after the test ended the process through its handle the same teardown
   confirmed it and deleted. (e) The PID-file recovery (`watchdog.pid`) and report recovery tests ran and passed.
   (f) The `EPERM` unconfirmed, reaped-PID-only-probed, exited-handle-not-signalled, still-running-owned-handle-
   ended-through-the-handle and no-bare-PID-signal tests ran and passed. (g) The wrong-token test passed in 164–188
   ms in seven observations; its source waits for the stand-in's `polling` marker and for `stand-in.seen` to show
   the other sandbox's token before asserting the process still runs.
6. *Not covered by this run.* Linux (the 2 POSIX-only skips did not run), the real watchdog end to end against
   PostgreSQL, signal delivery under an SSH session, and the full suite, DB-backed integration and
   `npm run build`. The negative controls of earlier follow-ups were not repeated.

**Round 3 follow-up 8 (2026-10-19, final pre-commit audit: seven findings).** Documentation and the gates; the
C4b tool changed by one diagnostic string and nothing else. Nothing was committed, staged, deployed or
contacted, and no database, host, timer, C4b run or mutation control was touched or run.
1. *Current validation summaries.* The `issues.md` Open Issues row still read "293 new tests as last run, plus 4
   cleanup-safety tests added since and not yet run", and the ISSUE-316 Validation bullet called both 304 + 2 and
   701 + 2 the last executed result. All four places now carry one set of totals, read from the follow-up 8
   runs: the new suite 419 passed + 2 skipped = 421 and the seven suites 829 + 2 = 831. 304 + 2 = 306 and
   714 + 2 = 716 (follow-up 7) and 701 + 2 = 703 (follow-up 5) are labelled superseded history. The audit named
   306 and 716 as the current figures; they were right for the tree before finding 5, and finding 5's 115 new
   tests moved them. `issues.md` (row and entry), `IssuesIndex.md` and this runbook agree.
2. *Validation evidence date.* "Follow-up 7 validation" item 3 gave `.vite-temp`'s modification date as
   2026-10-03, which is its creation date (21:54:16 AEST). The saved snapshot (`artifacts/f7-validation/baseline-0.txt`)
   records ticks 639279096999978894 = 2026-10-18 08:41:39.997 UTC = 19:41:39 AEDT, which is the follow-up 5
   run, so follow-up 7's runs did not move it. `.vite` keeps its own, different dates (the directory
   2026-10-03 21:54:17 AEST; its one file 2026-10-18 19:07:19 AEDT). Corrected in place. The conclusion is
   unchanged: every before/after snapshot matched, and follow-up 8's did too.
3. *Historical "Not executed".* Each surviving statement (the round 3 table row, follow-ups 2 to 5, follow-up 6
   item 4, the "Still valid" line, and `issues.md`) now says it was true at the time and is superseded for the
   tests. The current statement is kept and made explicit everywhere it could be misread (§6 file table, §11,
   `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`): **the C4b tool itself has never run on Linux, PostgreSQL or
   PROD**; its tests have run, DB-free, on Windows.
4. *C4 enforcement.* No database or production-code precondition was added. §7 C4b "Preconditions" now separates
   what the tool enforces before the first setting write (C2's repository state, C3's inert installed units,
   the setting off on both paths on one database, the unit's `UnsetEnvironment=`, the saved BEFORE record, the
   proven watchdog) from what the owner / operator checks (C4 deployed, the season's registration, readiness on
   the retained feed, no 2027 match started, the AFL Tables timer). Registration lives in tracked files
   (`seasons.2027` in `data/reference/afl-api-identities.json`, the `afl_api_2027` round table), not in the
   database, and the tool does not read them before it turns the setting on. If it is absent, acquisition
   refuses after the setting is temporarily enabled, the rehearsal HALTs, and restoration is still required and
   verified. D-316-13 must not be granted or used before C4, and the CLI is not described as proving all C4
   prerequisites. The diagnostic "(C4 not deployed?)" on the `in_progress_seasons` check was misleading, because
   the C2 rollover writes that register; it now reads "(the C2 rollover writes this register: C2 not
   deployed?)". It is text in a refusal reason; no behaviour changed. The tool's sha256 is now
   `65550c3f2ce70758bfa8338ed1fdc2e6e52117613c47f26a2f1770e6593a8485` (1357 lines, as before); follow-up 5's
   `c5713cb0…ab54` is the history of the bytes its controls ran against.
5. *`last_season: 2026.0`.* The contract is a finite, integer-valued JSON number (§6, "The number contract"),
   which is what the R and TypeScript gates already did for `2026.0`. The two Python gates now follow it, and
   writing the cross-language cases found one more divergence, fixed in both R gates: R read `1e999` as `Inf`
   and accepted it, so a `last_season` of `1e999` bounded every season; the R gates now also require
   `is.finite`. TypeScript already conformed (`Number.isInteger`). Retirement, a missing switch and a malformed
   switch still refuse, and comparison and out-of-bounds behaviour are unchanged. 23 cases through five gates
   (the TypeScript parser, `acquire_core.R`, `acquire_club_lists.R`, `acquire_coaches.py` and the shell script) add
   115 tests. No mutation control was run this round (not authorised); that the old Python test rejects
   `2026.0` is by inspection of `type(last) is not int`, and the new cases would show it as `retired` against an
   expected `active`.
6. *Brownlow timer policy.* ISSUE-232 §7 accepted-order item 8, the E1 policy paragraph and section E now say
   that "permanently enabled" was the DEV decision and is superseded for PROD: the Brownlow timer stays
   disabled until C8, section E is DEV-only, and section C's PROD acceptance adds `is-enabled` and `is-active`
   for both timers. `docs/deployment.md` gets a one-sentence note at its policy paragraph (its table row and the
   timer unit's comment are left; the document is rewritten at C5, D-316-12). §7's preamble, C3 and D-316-2
   name the same checks.
7. *Decision wording.* The runbook held no copy-ready owner wording, and no bracketed yes-or-no placeholder exists in
   any file of this worktree (searched); it was in the proposed text offered to the owner. §8 now carries the
   proposed wording for D-316-1, D-316-2 and D-316-13, with no placeholders. D-316-1 follows the C2 sequence
   (final acquisition and ladder witness; the D-233-3 census; rollover dry run then apply with the decision
   flag; one reviewed commit of six files; deploy with a rebuild; the timer disable at the operator's
   discretion, mandatory before C5). D-316-2 is the inert ISSUE-232 §7 C installation only. D-316-13 is
   unavailable before C4, and a rerun after a HALT or an exit 3 needs fresh approval.

**Follow-up 8 validation (2026-10-19, executed under proven isolation).** No Git state, database, host, timer or
C4b run was touched, and no mutation control was run. The code and test edits were made first; the documents were
edited after both Vitest runs.
1. *Files changed this round.* Code: `tools/rebuild/afltables/acquire_coaches.py`, `deploy/afldb-settle-afltables.sh`
   (its embedded Python gate and header comment), `tools/rebuild/fitzroy/acquire_core.R`,
   `tools/rebuild/afltables/acquire_club_lists.R`, `tools/current-season/afl-api-c4b-rehearsal.ts` (one diagnostic
   string). Test: `tests/afl-api-cutover.test.ts` (115 new tests, and the register-diagnostic expectation tightened).
   Documents: this runbook, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`, `issues/closed/AFLDB-ISSUE-232.md` and
   `docs/deployment.md`. `src/lib/acquisition/afltables-network.ts` was read and needed no change.
2. *Commands (PowerShell, from the worktree root; `$S` is `D:\dev\afldb-afl-api-cutover\artifacts\f8-validation`, git-ignored
   by `/artifacts/`).* Run 1: `TEMP` and `TMP` set to `$S\tmp`; `node node_modules/vitest/vitest.mjs run
   tests/afl-api-cutover.test.ts --no-cache --configLoader runner --reporter=default --reporter=json
   --outputFile.json=$S\run1.json`. Run 2: `TEMP` and `TMP` set to `$S\tmp2`, the same flags, and the seven files
   `tests/admin-current-season-settle.test.ts`, `tests/fitzroy-acquisition.test.ts`, `tests/coaches.test.ts`,
   `tests/club-list-sources.test.ts`, `tests/afl-api-ingestion-safety.test.ts`, `tests/season-rollover.test.ts` and
   `tests/afl-api-cutover.test.ts`. Typecheck: `node node_modules/typescript/bin/tsc --noEmit --incremental false -p .`.
   Lint: `node node_modules/eslint/bin/eslint.js --no-cache` on the eight new and changed TypeScript files
   (`src/lib/acquisition/settle-trigger.ts`, `afl-api-cutover-readiness.ts`, `afltables-network.ts`,
   `src/lib/rollover/afltables-network-retirement.ts`, `tools/db/rollover-season.ts`,
   `tools/current-season/afl-api-cutover-readiness.ts`, `afl-api-c4b-rehearsal.ts` and the test file). Every
   invocation exited 0.
3. *Isolation evidence.* The follow-up 7 `snap.ps1` (copied beside the new evidence) recorded the same 56,103-line
   snapshot: the main checkout's `git status --porcelain=v1 --untracked-files=all --ignored`, existence, recursive
   metadata and SHA-256 of `node_modules\.vite-temp`, `.vite` and `tsconfig.tsbuildinfo` (and the same paths through
   the worktree's junction), the worktree's own `tsconfig.tsbuildinfo` and git status, and name, size and
   modification time of every file in the main checkout outside `.git`, `.next` and `node_modules`, plus the top
   levels of `node_modules` and `.next`. Two baselines taken back to back were identical, and equal to
   follow-up 7's baseline (file hash `154E96FA0AF656CC…`), so nothing in the main checkout changed between the
   two rounds. The snapshot taken after both Vitest runs was identical to the baseline (`Compare-Object`: 0
   differences). The snapshot taken after `tsc` and ESLint differed in exactly two lines, both in the worktree's
   own git status: ` M docs/deployment.md` and ` M issues/closed/AFLDB-ISSUE-232.md`, the two tracked files this
   round edited on purpose; the main-checkout sections (56,085 lines, including `.vite-temp` at ticks
   `639279096999978894`, `.vite` and `tsconfig.tsbuildinfo`) had 0 differences. After each run the scratch
   `TEMP` held only tsx's own transform cache (`tsx-stuar`), and no `afltables-network-*` or `c4b-*` sandbox remained.
4. *Results.* Run 1: 1 file, **419 passed and 2 skipped, 421** (the 2 skips are the same POSIX-only
   SIGTERM/SIGKILL tests). Run 2: 7 files, **829 passed and 2 skipped, 831** (admin-current-season-settle 58,
   fitzroy-acquisition 23, coaches 12, club-list-sources 8, afl-api-ingestion-safety 166, season-rollover 143,
   afl-api-cutover 419 plus 2 skipped; 58 + 23 + 12 + 8 + 166 + 143 + 419 = 829). The new suite grew by 115 = 23
   cases x 5 gates (the TypeScript parser, `acquire_core.R`, `acquire_club_lists.R`, `acquire_coaches.py` and the
   shell script), on top of follow-up 7's 304 passed. `tsc` exit 0 and ESLint exit 0.
5. *The new cases.* `2026`, `2026.0`, `2.026e3` (all active); a `2026.0` bound with `[2027]`, `[2027.0]` and
   `[2026, 2027.0]` (out of bounds); a fractional, boolean, string, null or `1e999` season in the register (out of
   bounds); a fractional, boolean, string, null, `1e999`, `NaN` or `Infinity` `last_season` (retired); and a retired
   switch with `2026.0` (retired). All five gates agree on every case. The Windows run exercised real
   `Rscript` 4.6.1, Python 3.12 and Git's `sh`.
6. *Not covered by this run.* Linux (the 2 POSIX-only skips did not run), the real watchdog and the C4b tool
   against PostgreSQL or a host, the full suite, DB-backed integration, `npm run build`, and the negative
   controls (no mutation control was run this round).
7. *Hygiene.* `git diff --check` clean. Every changed and new file is uniformly one line-ending style with exactly
   one final newline and no added trailing whitespace: LF for `issues.md`, `IssuesIndex.md`, this runbook, the
   test file, the tool and the other new files; CRLF for the tracked files that were already CRLF in the
   worktree (`CHANGELOG.md`, the shell script, both R scripts, `acquire_coaches.py`, `settle-trigger.ts`,
   `rollover-season.ts`, `docs/deployment.md`, `issues/closed/AFLDB-ISSUE-232.md`); the edits kept each file's own
   style. Nothing is staged, and the untracked set is unchanged (the status differs from the start of the
   round only by the two newly modified tracked files above).

**Remaining risks after round 3.**
- The C4 prerequisites are owner / operator-checked, not machine-enforced (§7 C4b "Preconditions"): the tool
  does not read the season's registration before it turns the setting on, so a missing registration costs a
  HALTed run (with the setting restored), not a refusal. D-316-13 is the control: it must not be granted or
  used before C4 is deployed, and a rerun after a HALT needs fresh approval.
- The follow-up 7 cleanup and its 13 tests are now **executed and passing** on Windows under proven isolation
  (304+2 and 714+2 then; 419+2 and 829+2 after follow-up 8). The residual risk is narrower: the shared-deadline test bounds elapsed time (about 350 ms to
  1 s for a 400 ms deadline) and could flake on a heavily loaded host (seven observations at 420–444 ms, none
  near the bound); the others wait on files the stand-in writes, not on time. The Linux-only paths still have not
  run.
- A PID recovered from a file after its process has exited and been reaped may have been reused. The teardown
  then waits out the deadline and fails closed, naming the PID and keeping the evidence; it never signals it.
  The probability is small but not zero, and the failure is loud rather than harmful.
- A detached descendant that has not yet written its PID file when the teardown reads the files is not
  recovered. It still ends itself on its token or at its own 25 s deadline, and the sandbox would already have
  been deleted, so its late write fails harmlessly.
- Windows reports an inaccessible live process as `EPERM`; the teardown treats it as unconfirmed and fails.
  That is the safe reading but would show as a failed hook on a host with such a PID in the test's range.
- The child-exit tests (the watchdog adapter and `runChildStep`) use a fake child for the undeliverable-signal
  path, because a real process cannot be made to refuse a signal; the real-`spawn` paths are covered by the
  existing adapter tests and by two `runChildStep` tests over a real process. On a real host
  `kill()` can still fail (for example EPERM), in which case the stop is now reported honestly as unconfirmed
  and the child relies on the stand-down marker.
- The exit codes for unwritable evidence are tested over injected effects, not against a real full or
  read-only disk. `result.json` is the last file written, so a disk that fills mid-run is most likely to cost
  exactly that file: the run then reports HALT (1) with the setting restored, and the operator must treat
  the missing `result.json` as no C4b record.
- Dependencies are guarded where they matter for the setting: `systemctl` and readiness (follow-up 4),
  evidence writes, logging and every database call in the restore. `main()` turns any remaining error that
  escapes the run into exit 3 with a `--restore-only` instruction; that last catch is deliberately **not
  covered by a test**: reaching it needs an injection seam that exists for no other purpose, and the paths into
  it are the two clock calls below. It is conservative (exit 3 is never a CLEAR) and is kept documented rather
  than tested.
- Two `deps.now()` calls in `runC4bRehearsal` are unguarded: the `OFF at …` log line in the `finally` after a
  verified restore, and the deadline computation (`deps.now().getTime() + maxMinutes`) before the watchdog is
  armed. The production clock is `new Date()`, which cannot throw, so neither needs a safety fix. If one did
  throw, it would escape to `main()` and end as exit 3: the log-line one after the setting is already verified
  off and `restore-verified.json` is written (no `result.json`; `--restore-only` then writes nothing), and the
  deadline one before the watchdog and any setting write (nothing to restore). The `ON at …` log line is inside
  the step `try` (a HALT, restored as usual), and the `result.json` timestamp is inside its own `try`. The
  watchdog's loop reads the same production clock.
- A step reported `unconfirmed` may still be running (a signal that cannot be delivered to the tool's own child
  is not expected on a normal host). The run HALTs with the setting restored, but the operator must look for a
  stray `acquire-afl-api.ts` or `settle-afl-api.ts` process; its snapshot-file writes are not rolled back, and a
  `--dry-run` settle writes no canonical row.
- If the evidence directory is unwritable at the moment a watchdog has to act, its restore still happens, but
  nothing it logs survives: the watchdog is detached with `stdio: 'ignore'` (so the console goes nowhere) and
  its `run.log` append fails in the same directory, and `watchdog-result.json` is absent. (This replaces an
  earlier statement that the restore was logged to `run.log` and the console.) The durable record is the
  database: the restore's write inserts an `auth_audit_log` row in the same transaction
  (`current_season.afl_api_ingestion_set`, `actor_label` `afl-api-c4b-rehearsal`, detail `via`
  `afl-api-c4b-watchdog`, `step` `watchdog`, the run id, the reason and the attempt). A watchdog that finds the
  setting already exactly `false` writes nothing, so there is then no row and the operator relies on reading the
  setting.
- The acquire and settle scripts have not been run under the direct `node --import <tsx loader>` command (that
  would reach a database or the network); the unit script still uses the tsx CLI. The loader is the part of the
  CLI that compiles TypeScript, and a real script ran under it in the PID test, so a failure is not expected;
  it would show as a step exit at C4b, a HALT with the setting restored.
- The two POSIX-only real-process tests did not run on this Windows workstation (see follow-up 5 item 4). On
  Windows a descendant started without `detached` is killed with its parent's job object, so the
  surviving-descendant test starts it detached, as a real survivor would be.
- The C4b tool's production effects are only partly tested here: PostgreSQL writes as `afldb_auth`, signal
  delivery under an SSH session, and the real watchdog process end to end. The handshake and the spawn,
  file and liveness mechanics are tested over the real production adapter with a stand-in command; the rest
  is tested over injected effects. A real run is first possible at C4b.
- The handshake proves the watchdog was healthy when it published, not that it stays so: a watchdog that dies
  afterwards (before or during the rehearsal) is not detected. The consequence is the case below.
- If `node --import <tsx loader>` ever ran the watchdog under a different PID from the one spawned, the tool
  would refuse every run at the handshake (exit 2, no write): the failure is closed, and it would show at the
  first C4b attempt, before anything is written.
- The watchdog does not survive a host reboot, and a watchdog killed together with its parent, or killed after
  it was proven ready, cannot act. These leave the setting on with no timer enabled, so nothing runs;
  `--restore-only` and the preflight's refusal to start while the setting is on are the recovery.
- The watchdog's "parent alive" check is `kill(pid, 0)`; a reused PID inside the window would only delay its
  restore until the deadline.
- The record queries assume `matches.source_id` and `sources.key` and that `afldb_app` can read both, as
  the ISSUE-232 §7 A query does. A failure there refuses before any write.

## 11. Not done here

- No commit, merge, push, deployment, host contact, timer change or source-ownership change.
- No final AFL Tables acquisition and no rollover: the switch is still `active` / 2026 and `seasons.json`
  is unchanged.
- No database command.
- Main stays frozen, and its uncommitted `CHANGELOG.md`, `IssuesIndex.md` and `blockers.md` edits were
  not touched.
- No full suite, integration suite, build or Linux run.
- The C4b tool has not been run anywhere, against any database or host.
- No visual change (the admin panel text is unchanged; a retired refusal reuses the existing
  `unavailable` rendering), so no screenshots are owed.
