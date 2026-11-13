# Remediation run 2026-11-14 — plan review (afldb-reviewer)

Reviewed: `RUN-PLAN.md`, `AGENT-PROTOCOL.md`, review report §1–§6, `issues.md` entries 348/350–354/358, and source
on disk at `D:\dev\afldb-rem-20261114` (`tools/maintenance/backup.sh`, `restore-test.sh`, `deploy/release.mjs:1000-1100`,
`tools/rebuild/draftguru/import_draftguru.py`, `tools/v2/issue336-predraft-insert-production.ts:370-430`,
`tools/migration/load_reference_data.py:220-275`, migrations 017/096, `src/db/queries/match-sheet.ts:150-265`,
`match-admin.ts:464-549`, `tests/v2-acquisition-pipeline.test.ts:366-376`, `tools/db/rollover-season.ts` header).
Nothing was executed. No CRIT. Six HIGH, all closable by forwarding the amendment before the agent leaves its
read-only phase; none needs a new owner decision. Items marked "verify first" are things I could not confirm from the
repository and the agent must establish before acting.

Grades: HIGH = can cross an owner limit or corrupt/falsify data as briefed; MED = wrong evidence, integration breakage
or a gap that would be reported complete on a feeling; LOW = note only, no work required.

## Run-wide (orchestrator)

- **R-1 MED — heavy jobs share the DEV host with no arbitration.** Three `next build`s (answers, routes, perf), a
  possible `afldb_test` rebuild (pins), 12,000-question parse+execute (nl), Gridley (answers) and an 8-client load
  (perf) can overlap and starve DEV's `afldb.service`/PostgreSQL. Require one host-wide `flock` (for example
  `/mnt/ssd/afldb-rem-heavy.lock`) around each of those jobs, run them under `nice -n 19 ionice -c3`, check `free -g`
  and `df -h /mnt/ssd` first, and keep them out of the window in which DEV's own timers run (read with
  `systemctl list-timers`, do not assume).
- **R-2 MED — no run-level proof that DEV was not disturbed.** Record DEV `afldb` MainPID/`ActiveEnterTimestamp`,
  `postgresql@16-main` MainPID and listeners on 5432 before the first agent job and after the last cluster stops; the
  review did this (1732 / 1531 unchanged), the plan does not.
- **R-3 MED — HTTP ports are unassigned.** Only PostgreSQL ports are allocated; `next start`, Playwright and Caddy
  need listeners too, and two agents on the same default port will probe each other's build. Assign each build scope
  an app port (for example DB port + 1000), bind `127.0.0.1` only, and have every probe record the BUILD_ID it hit.
- **R-4 MED — new integration assertions must be oracle-independent.** The snapshot (2026-11-04 production) and a
  rebuilt `afldb_test` disagree by design (review §3.1: 42 such failures). No scope may add a literal count taken from
  the snapshot (for example clearances `178`, `hasBrother 660`) to a suite whose home oracle is the rebuilt database;
  assert a seeded subject or a relational invariant instead, and state per new test which oracle it holds on.
- **R-5 MED — the architecture stage map goes stale again at integration.** `tests/v2-acquisition-pipeline.test.ts:372-375`
  compares `docs/v2/architecture.md` §9 with `renderAflApiStageMap(diskReader)`, which is derived from export line
  numbers in `src/lib/acquisition/settle-afl-api.ts` and its peers. `pins` fixes it in step 1; any later scope that
  shifts those lines (`rollover`'s settle pre-check is the obvious one) re-breaks it. Regenerate the map once at
  step 6 after all merges, and run that test file as an integration gate.
- **R-6 MED — no migration may be added by any scope.** Nothing in the plan needs one; a numbered migration would move
  the ledger off 118, invalidate every snapshot template and collide across scopes. If a scope believes it needs one,
  it stops and reports (migration and `db:privileges` precede code, ISSUE-027).
- **R-7 LOW — uncommitted work in `D:\dev\afldb` overlaps this run's files** (`src/db/queries/admin-draft.ts`,
  `tests/integration/admin-draft.test.ts`, `src/lib/auth/session.ts`, `audience.ts`, `tests/auth.test.ts`,
  `tools/maintenance/restore-test.sh`, `tests/afl-api-ingestion-safety.test.ts`, `tests/gap029-ops.test.ts`,
  `docs/v2/afl-api-2027-season-operations-successor-2026-11-02.md`). Name the overlap in the approval packet so the
  owner expects conflicts; no agent touches that tree.

## hostops (351, 352, 364 node_modules)

- **H-1 HIGH — `backup.sh` and `restore-test.sh` default into DEV's real backup directory and source `./.env`.**
  `backup.sh:21,40,77-78` and `restore-test.sh:18,33` source `.env` from the current directory (after the caller's
  environment, so it wins) and default to `$HOME/backups/afldb`, which on streamanator is DEV's live backup store;
  `backup.sh` also `chmod 700`s and prunes there. Every rehearsal invocation must pass an explicit directory under
  `$W` (`--dir` / `AFLDB_BACKUP_DIR`), set `AFLDB_BACKUP_DATABASE_URL` / `AFLDB_OWNER_DATABASE_URL` to the port-55620
  cluster explicitly, run from a directory proven to contain no `.env`, and log the resolved target before each run.
- **H-2 HIGH — `restore-test.sh` writes to a fixed database name, `afldb_restore_test` (`:41`).** It will restore into
  that name on whatever host:port the DSN names; pointed at 5432 it overwrites a database on the DEV cluster. Create
  `afldb_restore_test` on the isolated cluster only (an explicit exception to the protocol's `afldb_v2_rem*_test`
  naming rule, to be recorded) and assert the port in the evidence. Verify first that `isolated-pg create-db` accepts
  that name; if it does not, report rather than work around it on another cluster.
- **H-3 HIGH — `deploy/release.mjs` acts on the real unit and root unless told otherwise.** `serviceRelease`
  (`:1010-1015`) runs `systemctl show … opts.unit`, and `promote`/`rollback` (`:1046,1079`) switch links under
  `opts.root`. On streamanator every invocation, tests included, must pass `--root` under `$W` and `--pid` or
  `--no-live`; never run `promote`, `rollback` or `status --expect` against a default root on either host.
- **H-4 MED — backup/restore "units and timer" rehearsal must not register anything with systemd on DEV.**
  `systemd-analyze verify` on files under `$W` and direct script invocation only; no `systemctl --user
  enable/start/daemon-reload`, no file under `~/.config/systemd`, no `loginctl enable-linger`. The brief says this for
  `rollover` but not for `hostops`.
- **H-5 MED — production probes must be file and `systemctl show` reads only.** Do not execute `needrestart`,
  `unattended-upgrade` (even `--dry-run`) or `apt-get`; their non-root behaviour is not established from this
  repository. "Which services needrestart would restart" is answered from its configuration and stated as inferred.
- **H-6 MED — the `rollback --to` ledger check must not make rollback impossible.** `rollback` is the emergency path
  and today needs no database. A hard refusal when the database is unreachable turns an outage into a stuck release;
  make the check refuse only on a proven incompatibility, degrade to an explicit acknowledged override otherwise, and
  test the database-down case. The same applies to any "attended" flag: existing packets and docs call the current
  CLI, so list every caller that changes (`docs/deployment.md:222-235`, `docs/production-cutover.md:88`, the r2 packet
  as errata only).
- **H-7 MED — a hard `node_modules` lock check in the nightly wrapper is a new way to lose every night silently**
  (ISSUE-332 has no alerting yet). Prefer `release.mjs status` or a warn-and-record step; if it must refuse in
  `deploy/afldb-settle-afl-api.sh`, prove zero false positives against a real `npm ci` tree and run the suites that
  pin that wrapper's text.
- **H-8 MED — do not edit `tools/maintenance/backup.sh` or `restore-test.sh`.** `tests/db-promotion-check.test.ts`
  (being re-pinned by `pins`, TST-2) and `tests/restore-test.test.sh` pin their text; wrap them from new units instead.
- **H-9 LOW — missing from the brief relative to review §1.2:** the systemd rehearsal that demonstrates the
  promote-to-restart window cannot run on DEV without disturbing it; record it as "not rehearsed under systemd", not
  as covered by unit tests.

## pins (358, 363 TST-5/TST-6)

- **P-1 HIGH — the rebuild target must be proven before any rebuild runs.** `db:test:rebuild` is destructive and the
  DEV cluster on 5432 holds a real `afldb_test`. Before the first invocation, print the resolved host, port and
  database from the tool's own resolution and require port 55611; never inherit `AFLDB_TEST_DATABASE_URL` or any
  `.env`. Verify first whether the rebuild accepts a non-`afldb_test` name (review §3.1 records a "rebuild-target-name
  environment refusal"); if it insists on `afldb_test`, that name may exist only on the isolated cluster. If this
  cannot be shown, stop at "preflight passes the pin check".
- **P-2 MED — define "provenance established" before the pin moves.** It needs both a recorded owner decision naming
  the McGovern pair (GAP-029 D4) and the row's presence in the production snapshot; a commit message alone is not
  provenance. Otherwise present both options and leave the pin untouched (owner decision 5 in review §6).
- **P-3 MED — `nl-answers-relationships.test.ts:52` (658 vs 660).** Derive the value from the rebuild input (CSV pair
  delta) and state which oracle that suite holds on; do not re-pin it to the snapshot merely because the snapshot
  says 660 (R-4).
- **P-4 MED — the new "recompute every pin" test will go red when another scope edits a pinned input.** List the
  pinned files in the report so the orchestrator can check them against every scope's file list at integration.
- **P-5 MED — shared file with `draftguru`.** Both scopes wire Python contracts into the same Vitest wrapper(s) under
  `tests/python`; `pins` owns the wrapper, `draftguru` adds only a new contract file and names the one-line wiring for
  the orchestrator to apply.
- **P-6 LOW — the rebuild is an R-1 heavy job;** take the lock.

## draftguru (348)

- **D-1 HIGH — compute the delete/rewrite set with `reload_keyed`'s own key semantics, not a re-implementation.**
  The 35 audited picks were inserted with `pick_number NULL` (`issue336-predraft-insert-production.ts:401-407`);
  SQL and Python disagree on NULL equality, so a hand-written subset test can say "subset" while `reload_keyed`
  (`import_draftguru.py:1481-1486`) deletes, or the reverse. Use the same `PICK_KEY` matching the reload uses
  (ideally a plan produced by the same code path) and add a test with a NULL key component.
- **D-2 HIGH — the guard must run before anything can be written.** Place it before `apply_authority`
  (`:1418-1422`, which can mint player seeds) and before `import_batch` opens (`:1401`), on a read-only statement, so a
  refusal leaves no `import_batches` row either; the docstring at `:193` says a dry run does leave something behind.
  The acceptance check is a whole-surface before/after digest (`draft_picks`, `draft_persons`,
  `external_identities`, `import_batches`, `players`, `data_edits`, `data_overrides`) that is equal after a refused
  normal run and a refused `--dry-run`, plus a non-zero exit in both.
- **D-3 MED — `--acknowledge-population-drop` must not satisfy the new guard.** It already exists (`:1550`) and feeds
  only the `external_identities` check (`:843-848`); test that passing it changes nothing about the refusal.
- **D-4 MED — the discriminator must be the audit trail, and the fixture must be the real shape.** Key "audited" on
  `data_edits` rows for `draft_picks` (the I336 tool writes one per pick through `recordDataEdit`, `:409-412`) and
  active `data_overrides`; persons are protected through their picks. Seed the synthetic rows with the column shape
  the I336 tool writes, not an invented one. `draftguru` has no production grant, so ask the orchestrator for one
  aggregate from a granted scope: the discriminator selects exactly 35 picks and 31 persons on production.
- **D-5 MED — renumbering is a rewrite.** The I336 persons carry `dg_person_id` past the stored maximum and a note
  that the next full reload renumbers them (`:385,397`), and `run_import` defers that unique constraint (`:1426-1427`).
  Treat any change to an audited person's `dg_person_id` as a rewrite the guard refuses, and say in the
  reconciliation-input design how a retained audited person keeps or receives its rank.
- **D-6 MED — out of scope, say so.** Do not edit `EXPECTED_ROWS`/`EXPECTED_PERSONS`, `draftguru-contract.json`,
  `DRAFTGURU_EXPECTED` in `tools/db/rebuild-test.ts` (owned by `pins`) or the bridge constants; the re-baseline belongs
  to the acquisition. Run every existing `tests/python/draftguru_*` AST contract after the change (they pin statement
  shapes in this file), and put the database case in `tests/integration/draftguru-import.test.ts`.

## rollover (350, 332 preparation)

- **O-1 HIGH — `ON CONFLICT DO NOTHING` is not idempotency here.** It would accept a 2027 row that already exists with
  the wrong league or status and report success. Plan must classify three states: absent (insert), present and equal
  to the expected row (no-op), present and different (refuse). Expected values come from `data/reference/seasons.json`
  exactly as `load_seasons` derives them (`load_reference_data.py:220-238`: `year, league, status, notes`, measured
  columns left NULL); refuse if the tracked file does not cover the year. No date is written.
- **O-2 HIGH — bound the club update by the reference register, and prove history did not move.** The contract is
  `load_clubs` (`:246,268-269`): an identity whose `clubs.json` `last_season` is null gets `seasons.json`
  `last_season`. Update only identities that are open in `clubs.json` and currently hold `year - 1`; refuse if the
  database's current set differs from the register's; never touch `first_season`, any closed identity or
  `club_seasons`; hard-code no "18". Acceptance: `afldb_identity_for_season(org, s)` for every organisation and every
  season up to 2026 is byte-identical before and after, it is non-NULL for 2027 for exactly the register's open
  identities, and `afldb_season_list_clubs(2026)` and `(2027)` return the same sets before and after (migration 096's
  forward arm switches on `max(year)`, so 2026 moves to the `club_seasons` arm).
- **O-3 MED — the digest must be time-zone independent and rehearsed that way.** ISSUE-349 is this exact failure:
  production runs `Australia/Melbourne`, isolated clusters `Etc/UTC`. Pin the session time zone on every connection
  and run one rehearsal against a non-UTC cluster, or the packet's "expected before-state digest" will refuse on
  production.
- **O-4 MED — the public effect of the row is unstated.** `max(year) FROM seasons` drives `src/app/page.tsx:65`,
  `src/db/queries/overview.ts:42`, `seasons.ts:213`, `admin-fixtures.ts:218`, `admin-season-lists.ts:212` and
  `db-health.ts:46`; `in_progress` drives provisional and pending labels (`club-comparison.ts:1751`,
  `player-derived.ts:737-758`). The packet must list what changes on public pages the day the row lands (it bears on
  the owner's timing decision), with those queries run before and after on the rehearsal copy.
- **O-5 MED — rehearse the off-season nightly.** After the apply, the nightly options with no concluded 2027 match
  must end in a clean no-op, not a new failure; the plan only rehearses run A reaching the completeness gate.
- **O-6 MED — rehearse under the role production will use.** Establish which role runs the tool and that it holds
  INSERT on `seasons` and UPDATE on `clubs` (`isolated-pg roles`); a privilege refusal on the night wastes the approval.
- **O-7 MED — the snapshot is the correct oracle for this scope, and only the snapshot.** A rebuilt database already
  has 2027 and masks the defect; the tool is an operation, not a migration (R-6), and must not edit
  `data/reference/*.json` (rebuild pins, P-4).
- **O-8 MED — the DEV read contradicts protocol §4.** §6 gives the production pattern only, and §4 forbids touching
  `/home/arm/projects/afldb`, where DEV's DSN lives. State the one permitted route: a script that reads the DSN
  without printing it, connects with the application read role, sets `default_transaction_read_only`, asserts the
  database identity first, and returns aggregates.
- **O-9 MED — the notifier must not send mail or become live by deploy.** Rehearse with a stub transport only and
  never read DEV's mailer secrets. Ship `OnFailure=` as a separate drop-in that no existing installer or sync path
  copies (verify first which paths install `deploy/*.service`), so a later deploy cannot activate it ahead of its own
  approval; the packet sequences notifier unit before drop-in.
- **O-10 MED — a settle pre-check edits `settle-afl-api.ts`:** see R-5, and name the line shift in the report. Put the
  ISSUE-332 gate text in the scope README as proposed wording; the operations successor doc has uncommitted owner
  edits elsewhere (R-7).

## admin (353, 354)

- **A-1 MED — key the Brownlow refusal on the player's own rows, and decide the match-level state explicitly.**
  `deleteMatch` reads `brownlow_vote_entry_state` per match (`match-admin.ts:464-466`). Copying that into a per-player
  removal either refuses every removal in every match that has an entry state (blocking the legitimate
  "replace a wrongly identified player" correction for a player with no votes) or misses the case. Test both a voted
  player (refused, votes unchanged) and an unvoted player in the same match, and present the match-level rule as a
  stated choice.
- **A-2 MED — "under the existing locks" needs proof.** The Match Sheet locks `matches` and `player_match_stats`
  (`match-sheet.ts:153,179`). Verify first that Brownlow vote entry and special-record creation take the same match
  lock; if they do not, the check races a concurrent insert, and the report must say so rather than claim closure.
- **A-3 MED — the refusal must be actionable,** naming where to clear each dependent as `deleteMatch` does
  (`:471-473,542-547`), and the suite must still show that a player with no dependents is removable (no over-refusal).
- **A-4 MED — 354: starting from `{}` overwrites the retired payload.** Before changing the upsert, confirm the
  retired values stay recoverable from `data_edits`; if they do not, that is a finding to report, not something to
  fix by keeping the merge.
- **A-5 MED — `data-edits.ts:265-288` is the shared editor path.** Enumerate its callers and run every data-editor
  integration suite they reach, not only the coach and draft suites.
- **A-6 LOW — period stats** stay an owner decision, as briefed.

## auth (362, 364 lint)

- **U-1 HIGH — Caddy's admin endpoint is host-global.** `caddy reload`, `caddy stop` and a `caddy run` with the
  default admin address talk to `localhost:2019`; if DEV's Caddy listens there, that is a live configuration change on
  DEV. Use an isolated config with `admin off` (or a unique loopback admin address), `caddy validate` and
  `caddy run --config` under `$W` only, unprivileged ports from R-3, and never `reload`/`stop`.
- **U-2 MED — SEC-2 must not lock administrators out.** A claim issued before the change carries no epoch; test that a
  legacy cookie with a still-valid database session lands on a working sign-in path with no redirect loop, and state
  that every admin re-authenticates once at deploy. Do not fold in the Next 16 `middleware` rename.
- **U-3 MED — the 17 `src/` lint fixes cross other scopes' files.** List the files first; any file in another scope's
  edit set is left for the orchestrator to apply after merge. A `react-hooks/set-state-in-effect` fix changes render
  behaviour and carries the visual-evidence obligation; without it, mark `VISUAL: UNVERIFIED`.

## nl (356, 360 SRCH-5/7, 359 SRCH-6)

- **N-1 MED — pass counts cannot see this change.** "least" moving from max to min still "passes". Run the corpus on
  the unfixed checkout on the same database copy, then diff parse and plan per question, and classify every changed
  question as intended or not; totals alone are not an acceptance check.
- **N-2 LOW — the corpus run is an R-1 heavy job;** take the lock.

## answers (355, 360 FE-4, Gridley)

- **W-1 MED — the clearances case must not pin `178`.** Assert that no returned player-season has a NULL total and
  that the result equals the guarded reference query on the same database (R-4).
- **W-2 LOW — build, Gridley and Playwright are R-1/R-3 jobs.**

## routes (357, 359 FE-2/FE-3, 360 FE-7, 364 sitemap)

- **T-1 MED — `parseEntitySlug` and `parseSeason` are shared helpers.** Enumerate every caller (admin routes, API
  routes, generated links) before tightening them, and prove that no link the application itself emits now redirects
  or 404s; the sitemap crawl (4,785 URLs) on the new build is the natural check.
- **T-2 LOW — if `src/app/players/page.tsx` is edited,** coordinate with `perf` (the past-the-end redirect lives in
  that page).

## perf (361)

- **F-1 MED — timings taken while ten other agents load the host are not evidence.** Take the EXPLAIN and the
  8-client load under the R-1 lock, before and after in the same session, and report the host load beside each number.

## tests (363 TST-4/7/8/9)

- **S-1 MED — beta-action tests must not send mail.** `requestMagicLink` reaches the mailer; use the suite's stub
  transport and assert no outbound connection is attempted.
- **S-2 LOW — seeded subjects (TST-4)** must hold on both oracles (R-4); that is already the brief's intent.

## Not planned, relative to the review (for the packet, no work implied)

- The unverified leads in review §2 are deliberately out of scope; say so in the packet.
- ISSUE-351's doc amendments have no named owner in the file-ownership list; assign `docs/deployment.md` and
  `docs/production-cutover.md` to `hostops`.
- The ledger's wrong assumption at `issues.md` ~24912 (ISSUE-350) is the orchestrator's to correct.
