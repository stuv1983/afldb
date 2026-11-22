# Independent AFLDB code review · 22 November 2026

**HOLD the two streamanator helpers. HOLD publication of b445ba7f. Wednesday reboot status is NO-GO.** A successful overnight copy can fail the scheduled-origin check even with intact bytes and complete wrapper output. The build also published a synthetic unaccepted Brownlow winner. Separate release, database and evidence-tool findings follow in severity order.

Reviewed object `b445ba7f1442130b0a7f3980f5c93c563d7b3a44`. Direct parent `bc3fef3de375259d49001e7a9a478624832703a8` contains Sol’s implementation. Its parent `0f4accf76d6525b04aacdcee548f27add0daa8d5` is the previous review **baseline**. That object's own commit records an alarm acknowledgement. The earlier repository-wide report is [the 21 November review](AFLDB-FULL-REVIEW-2026-11-21.md). All four adjacent Git ancestry checks returned 0, in order from recorded production `7d92042fd11010eaa20966e2f49ae7a93e286568`, through Sunday PREP `ae51cd8d913a7523dd89fb638279e7f910054b79`, the previous baseline, the tested fix and the target. Production attribution below means the code is present at the recorded serving revision. Current live symptoms require separate observation.

Opened Sunday 22 November. The Monday 23 November addendum records direct observations after the scheduled dispatch.

## Findings

### High · AFLDB-ISSUE-368 · AFLW replacement can remove a missing season

Recorded production revision and candidate. `tools/aflw/parse_aflw.py:625,663; tools/aflw/load_staging.py:370,387,452; src/db/migrations/026_aflw_read_model.sql:76`.

The parser continues past an absent season and glob-selects available player pages. Counts and digests can agree within that reduced generation. The loader truncates eight staging tables before copying it. A previously visible season can disappear from the season view and its public route. The candidate’s one-season test generation produced zero validation failures and eight recorded truncations against its recording connection. No real staging replacement was performed.

**Correction and regression.** Require the expected season and required page inventory before admitting a replacement. Remove a whole season, then one season’s players page from a valid multi-season fixture. Both loads must refuse before connection and preserve the published rows.

### High · AFLDB-ISSUE-367 · Brownlow year page publishes unaccepted votes

Recorded production application and candidate. `src/app/brownlow/[year]/page.tsx:20,34,55,80; src/app/sitemap.ts:138; src/db/queries/brownlow-readiness.ts:5`.

On a fresh, migrated fixture with one stored 27-vote winner and no acceptance, the built /brownlow/2026 returned 200 and named Review Fixture as winner in its metadata. The season page returned 200 and omitted that name. The raw year query also feeds the ranking and winner heading. The sitemap and static params enumerate raw years. The earlier round/match fix and Sunday’s 371/372 acceptance stand.

**Correction and regression.** Use the shared accepted-row selector for year enumeration and ranking. Assert pending, accepted, corrected, explicitly inapplicable and empty HTML, metadata and sitemap against season, match and player projections. Preserve historical complete years.

### High · AFLDB-ISSUE-374 · Direct test-target maintenance can operate on a misconfigured database

Recorded production revision and candidate, operator tools. `tools/db/migrate.ts:141,199,276,322; tools/db/privileges.ts:95,116`.

The direct db:migrate:test and db:privileges:test scripts select an environment variable by target name. A nonempty DSN for another writable database passes that selection. Test migration mode skips the shared-target branch guard and bootstraps/applies DDL. The privilege launcher hands the same destination to the grant script. The rebuild orchestrator’s separate checks do not protect direct npm calls. Actual consequences depend on the connecting role’s rights. Confirmed by source, no non-test database contacted.

**Correction and regression.** Validate the target-specific database identity before the first write, including current_database() on the connection used for the operation. Keep the explicit code_test_db contract. Test a mismatched synthetic DSN and assert zero DDL/grant calls, then a permitted isolated target.

### High · AFLDB-ISSUE-352 · Scheduled transfer proof rejects a genuine cron dispatch

Local candidate helper pair and evidence runbook. `docs/v2/evidence/backlog-20261121/kits/scheduled-pull-evidence.sh:13,21,30; kits/afldb-offhost-pull-daily.sh:16; a1a2-20261124/dry-tests-20261122g/t-sunday-review.sh:17 (last two paths relative to the same evidence directory)`.

The verifier matches the entire crontab line inside CMD. One readable hourly arm dispatch on streamanator contained no schedule prefix. Both r3 callers exited 1 on that command-only record shape with otherwise valid evidence. The success fixture manufactures the schedule prefix and independently invents matching PIDs. Debian cron normally logs the child about to exec the job shell. The wrapper finds a process still named cron, which can be its supervisor instead. Historical PID reuse also yields ambiguous BEGIN because the PID search precedes the date restriction. Monday and Wednesday can therefore lose proof even when the transfer succeeded.

**Correction and regression.** Match only the command portion, correlate the dispatch PID to the actual invocation process lineage in the dispatch window, and bind END and VERIFIED to that unique run. Validate the target cron’s PID/log mode with a sanitized host-format fixture. Exercise same-minute manual success, failed scheduled run followed by successful retry, reused PID on another date, unreadable journal and partial installation. Keep SHA, marker and hold gates.

### Medium · AFLDB-ISSUE-352 · Backup unit clears a failure after a failed evidence write

Recorded production operations revision and candidate. `tools/maintenance/scheduled-backup.sh:92,145,154,165`.

A synthetic successful backup with an unwritable state destination (temporary path occupied by a directory) logged the write error and “backup ok”, returned 0 and removed FAILED-backup. Verify has the same unchecked write before clearing markers. Systemd can report success while status uses a stale record. This observation concerns the state receipt. The synthetic dump was created.

**Correction and regression.** Require each state write and rename to succeed before clearing failure markers or logging success. Run backup and verify fixtures with each state destination unavailable, assert nonzero, preserve prior state and failure marker, then retry successfully.

### Medium · AFLDB-ISSUE-348 · DraftGuru importer trusts the stored parsed-row digest

Local candidate reviewed-acquisition contract. `tools/rebuild/draftguru/import_draftguru.py:343,1412; tools/rebuild/draftguru/parse_draft_snapshot.py:94,402,454`.

The importer checks a manifest digest against the reviewed pin, rehashes the raw HTML, then reparses. Its import path does not compare the fresh row digest. An altered HTTP sidecar final_url changes row provenance without changing raw HTML or population counts. The sealed January driver adds transfer-byte checks, narrowing exposure for that specific procedure. Direct importer validation lacks the invariant. No January load has occurred.

**Correction and regression.** Compare parsed_rows_digest of the exact in-memory rows to the reviewed pin before preparing writes. Change only a synthetic final_url while retaining the reviewed manifest and HTML. Require --validate-only to fail.

### Medium · AFLDB-ISSUE-375 · Migration status accepts an unknown applied migration

Recorded production revision and candidate, operator tools. `tools/db/migrate.ts:293,303,313; tools/db/migration-safety.ts:167`.

Inserted one extra ledger row in a new disposable copy of the migrated test database. Status returned 0 with “0 pending”. Apply returned 0 with “schema is up to date”. The checksum loop walks only local files. Operators using the direct commands miss a newer or divergent database. The earlier status-only DDL fix remains effective.

**Correction and regression.** Detect applied names absent from the checkout before reporting success or applying anything. Reuse the existing reverse comparison. Exercise both modes against an extra fixture ledger row and assert nonzero and unchanged catalog.

### Medium · AFLDB-ISSUE-376 · Award correction fan-out omits cached player profiles

Recorded production application and candidate. `src/db/queries/admin-awards.ts:900,1900; src/app/admin/awards/revalidate/route.ts:26; src/app/api/internal/revalidate-season/route.ts:102; src/app/players/[slug]/page.tsx:55`.

A winner replacement generates old and new player paths. The handling worker invalidates all admitted paths. The cross-worker request derives only season and Brownlow paths. A second worker with a warm profile can continue displaying the prior winner until profile regeneration. Source-confirmed invalidation gap. The precise stale interval and a two-worker stale profile response were not measured. Sunday’s separate season-page acceptance remains recorded.

**Correction and regression.** Invalidate the bounded, server-derived affected player paths on each worker. Warm both profiles on two labelled workers, replace the synthetic winner, and verify fresh requests to each worker reflect both removals and additions.

### Medium · AFLDB-ISSUE-351 · Wednesday functional 2/2 check lacks an executable acceptance step

Local R6 instructions. `docs/v2/evidence/backlog-20261121/ATTENDED-PLAN-R6-20261125.md:224,226,422`.

The amendment requires functional revalidation. F-2 checks process configuration, and the F-4 command block runs release status, post-install and raw heads. None invokes the season revalidation CLI. An operator following the blocks can finish without recording a post-boot acknowledgement from both workers. The separate CLI reached both workers in two requests on this review’s disposable cluster.

**Correction and regression.** Put the attended revalidate-season.ts --season 2026 command and explicit requirement for two distinct worker ordinals in F-4 with its owner/write scope. Require failure/1-of-2 to stop acceptance. Capture fresh evidence after reboot.

### Medium · AFLDB-ISSUE-362 · Optional request tracing logs unredacted URLs

Recorded production application and candidate, tracing disabled in Sunday’s record. `deploy/server-cluster.mjs:147,196; deploy/Caddyfile.production:67`.

With AFLDB_TRACE_REQUESTS=on the Node supervisor logs req.url on response completion. Sensitive request paths or query values can reach the service journal independently of the Caddy access-log filter. Sunday recorded tracing off. The review found conditional exposure in the code and saw no live token.

**Correction and regression.** Log the route class or a sanitized path and omit query data from this sink. Run a synthetic diagnostic request and assert the test sentinel is absent from the captured trace. Preserve the existing retained-log disposal decision.

### Medium · AFLDB-ISSUE-377 · Player matching recall test passes without measuring recall

Recorded production revision and candidate, test-only. `tests/integration/player-matching.test.ts:243,259,394`.

The known-link recall test returns successfully below 20 trusted links before candidate retrieval or the 95% assertion. A similar return drops conflict coverage. Empty fixtures or a broken evidence query can make the tests green. The earlier apostrophe regression exercised a different assertion. The selected recall test returned 0 and counted one pass on the empty migrated database.

**Correction and regression.** Seed sufficient known synthetic identities for a mandatory recall/control test. Make empirical corpus unavailability an explicit skip with a reason. Assert a deliberately empty result fails the seeded control.

### Medium · AFLDB-ISSUE-352 · Encoded passwords stop scheduled backups

Recorded production operations revision and candidate. `tools/maintenance/backup.sh:29,32,95`. The password scrubber copies the URI-encoded password into PGPASSWORD. A percent-encoded character in a valid backup credential therefore changes the password presented to PostgreSQL. In a DEV fixture, the real backup entry point called a fake pg_dump with a synthetic encoded at-sign. The shim confirmed the value failed the decoded-password check and backup exited 1. No connection was made. Reuse the validated decode/refusal behaviour in restore-test.sh. Exercise encoded and ordinary synthetic passwords while asserting no password enters argv or logs.

## Scheduled transfer and restore evidence

**Monday 23 November live follow-up, 05:06 AEDT.** The deadline elapsed during this review. As arm on streamanator, the 03:10 minute had exactly one dispatch for the daily wrapper, at **03:10:01 AEDT**, CRON PID **3729645**, with the command only. The installed wrapper digest was `1aa242f2627488a08b771851cb1e1ae94f1acc5b704c15b3f57b3a17718855bb`. The proposed verifier was absent. The old log recorded rc=0, one newly verified dump, zero pending and zero failed. The retained `afldb_prod-20261123-022145.dump` rehashed to **3818c759ff2a5cd7405578995795738427b45c403d7bbf40748514e532d38fe1**, matching its named sidecar. The marker existed and there was no hold. **Off-host verification succeeded.** The old log has no dispatch PID/run-ID link. Independent production-service identity and checksum remain owner evidence. A manual retry cannot retrospectively supply either missing link.

For the owner on production, the exact read-only comparison for Monday is below. Confirm the unit’s scheduled operation named the 022145 file and succeeded, and compare both full hashes with the above value. This can corroborate the next-nightly data criterion. It cannot reconstruct an absent wrapper invocation ID.

```sh
journalctl -u afldb-backup.service --since '2026-11-23 02:20:00 Australia/Melbourne' --until '2026-11-23 03:10:00 Australia/Melbourne' --no-pager
cd /home/arm/backups/afldb-scheduled && sha256sum afldb_prod-20261123-022145.dump && cat afldb_prod-20261123-022145.dump.sha256
```


The installed schedule in the sitting is daily at 03:10 Melbourne time. The installer compares the exact marker and job in arm’s crontab. The daily wrapper serializes pulls with flock, records a UTC BEGIN and runs the pinned core pull with a timeout. Core rsync copies new files, checks new dump bytes against a named sidecar, reads the archive directory and creates a verified marker. Its durable hold prevents normal pruning on the next unchanged run. The wrapper rehashes retained dumps too, records VERIFIED rows by run ID and writes END with its internal result. END records the transfer/verification result before alarm delivery. The wrapper’s final failure exit may instead be 1, 3 or 4 depending on delivery. A failed lock acquisition precedes BEGIN.

The observer takes the production overnight basename and full digest as inputs. It checks a Melbourne date and 02:20–02:30 basename, the marked crontab pair, one journal dispatch in the 03:10 minute, one matching BEGIN, one END by 03:45 with rc=0, one matching VERIFIED within that invocation, a nonempty retained dump, named sidecar, marker, no hold and a fresh matching SHA. The r3 and R6 callers both propagate verifier failure. A checksum alone cannot identify the invoker. A failed scheduled END remains a failed transfer/verification even if a later retry succeeds. If the bytes and sidecar agree but the dispatch or attribution is unavailable, record **copy verified, scheduled origin unproven**. If the wrapper has no evidence about the transfer, record its outcome as unknown.

The production pre-check at `r6-pre-verify.sh:126` selects the first matching 02:2x/02:3x filename and compares its rehash with the sidecar's first field. Multiple files in that window can select the wrong one. For 352 require the backup service invocation’s actual dump basename/full checksum, unambiguous correspondence to the sidecar and a matching off-host pair. Change the selector to refuse ambiguity and test an additional same-window dump. The later verification service creates a separate dump.

**Independent cases.** On streamanator (cron 3.0pl1-184ubuntu2), one readable existing hourly arm CMD contained the command without its minute field. Both candidate observers returned 1 on a normalized command-only synthetic dispatch with the intended dump and a successful END. Sol’s schedule-prefixed fixture returned 0. The ordinary cron implementation logs the job before it execs the shell. PID-logging modes can change the record shape. A nearest process still named cron is insufficient to establish the contract on this host. [Debian cron job dispatch implementation](https://sources.debian.org/src/cron/3.0pl1-162/do_command.c/#L265)

| Input through disposable entry points | Exit / observation |
|---|---|
| Same-minute manual BEGIN alone, no matching scheduled ancestry | 1 |
| Distinct manual success in the scheduled minute, alongside the suite's attributed successful run | 0, selected only the scheduled run |
| Prior-day BEGIN with the same recycled PID, otherwise valid evidence for today | 1, false ambiguity |
| Scheduled END failed, later manual END succeeded | 1 |
| Other day's dispatch, wrong production SHA, changed dump, missing marker, active hold, ambiguous dispatch | 1 each |
| Unreadable journal export | 1 |
| Wrapper staged without verifier | R6 caller 127. Installer check printed PRECONDITIONS FAIL and returned 0 |
| Fake scheduled transfer with the suite's matching PID and schedule-prefixed CMD | 0 |
| Job-shell command text with the same otherwise-good evidence | R6 1, r3 1 |

The installation amendment’s two independent `install` commands can leave a mixed pair. It instructs the owner to read the pin/installed/precondition messages. Checking only shell status will miss partial installation. Before issuing a replacement pair, verify every staged and installed digest, use a versioned pair with a single activation step or a checked rollback, and make a failed precondition machine-detectable. No installation is justified by the current pins.

**Read-only owner preflight for a corrected pair.** No owner command can clear the current source defect. Following a correction, on streamanator as arm, verify the exact marked line and command-only journal form. Limit output to the named job, and retain a readable dated journal export if access is restricted.

```sh
crontab -l | grep -A1 '^# AFLDB-A2-r3'
dpkg-query -W cron
journalctl -t CRON -o short-iso --no-pager --since '24 hours ago' | grep -F 'afldb-settle-check.sh' | tail -1
sha256sum /home/arm/afldb-ops/{afldb-offhost-pull-daily.sh,scheduled-pull-evidence.sh,offhost-pull.sh}
```

Run the last command in Bash. Check staged Git-archive bytes against independently published corrected pins as well. Require an actual dispatch/job-shell PID link under the installed cron mode. A historical hourly CMD establishes command shape only. At the due time retain the dated dispatch, run ID and full transfer chain before marking 352 observed.

**Pins and Sunday.** Both Git objects matched all 14 rows of [BLOB-PINS.md](../../docs/v2/evidence/backlog-20261121/sunday-review-20261122/BLOB-PINS.md), hashing raw subprocess stdout bytes with SHA-256. These include unchanged dependencies, both test harnesses, the wrapper `6403871ecb1073c2f1a4086bf41fea002c2de7c0178dd8862098ea54d2265da3`, observer `2e42d307de1b63dda8f8e34322effc8747e4bc3c177245f0cc891f18777b0999` and core `a3775aea879b1d9ce05d0e96482e66d24c69deb62cf38e8fc0407c0d2653dc2b`.

Read separately from test fixtures, the retained first-copy restore log names `afldb_prod-20261122-150505.dump`, records pg_restore exit 0, zero stderr lines and FIRSTCOPY RESULT RESTORE PASS. Its retained sidecar and an independent fresh rehash both gave `b3fd21c3e24f0b3fe3a5fdddea3c6c00f258b4bb5dd887dda5139406ffe5c588`. The original restore log binds the basename; the digest comes from the named sidecar and current bytes. Sunday also had an attended 150327 backup. The sitting preserves four original P6 NOT OK ticks, the waiver narrowly covering the embedded not-found text, and acceptance of 371/372. Sunday’s separate functional result was 2/2. [Sitting evidence](../../docs/v2/evidence/backlog-20261121/SITTING-A1-A2-20261122.md)

## Inventory and depth of review

The target contains **10,417 tracked paths**. Git tree and blob reads provided the inventory. No codebase graph tool or coverage generation was available. The snapshot-wide pass read source-format files across every top-level directory, compiled the application, and syntax-checked all **610 shell** and **146 Python** files. These are mechanical checks. The table identifies the narrower caller chains examined for semantics.

| Subsystem and real entry points | Source inspected or exercised | Material limits |
|---|---|---|
| Public application, 748 files under src, including 114 page modules and 20 route handlers | App Router year pages, season/round, match and player query gates, player honours, sitemap and metadata, search audience handling, award refresh route and internal per-worker endpoint. Real production build and two-worker server. | Many routes and shared components received type/build/test coverage only. Historical all-player totals, full Gridley/NL corpus, all match states and mobile journeys lack a new data-backed sweep. |
| Authentication and admin | Login action to transactional TOTP/session issuance, hashed token/session lookup and capability checks, beta POST redemption, award mutation path validation, server-side audit and upload handlers. Disposable admin lifecycle, audit and upload suites used fixture accounts. | No live account, external email, full MFA journey or concurrent browser publication exercise. Server-action timing and every form’s double-submit behaviour were not individually verified. |
| Database, data ownership and ingestion | All 118 migrations applied to a fresh PG16 database. Read status/apply/privileges, coverage predicates and historical query projections. AFLW parser to verified generation, truncate/copy and public views. DraftGuru raw pins, parsed-row provenance and sealed operator wrapper. AFL API timer to acquire/settle, season boundaries, identity resolution, completeness and transaction/finalization. | Synthetic schema and small fixtures. The full historical rebuild, January acquisition/load, canonical source archives and production identity population were outside these fixtures. |
| Tooling, packages and search | 349 tools, six packages with 41 files covering acquisition, admin, DB, derived, domain and testing. Reviewed public search and Grid audience entry points, fixture guards, per-file DB setup/cleanup, migration safety, build/standalone packaging, test discovery and lint gate. | Bulk parser/compiler branches, historical rebuild recipes and telemetry tooling received inventory, static checks and applicable unit coverage. No exhaustive semantic read of every function. |
| Deployment and recovery | 51 deploy files. Traced exact revision extraction, manifest/build identity, current/previous switching, rollback ledger check, post-install/journal checks, process supervision, Caddy path/log filters, failure transport, scheduled backup/restore, off-host pull, cron observers, R6 and first-copy evidence. | No production connection, promotion, rollback, mail delivery test, GRUB change, console trial, service interruption or live restore. Historical records remain separately identified. |
| Operator scripts in documentation | 7,551 docs files, including 7,303 under docs/v2/evidence and 542 shell scripts under docs. Checked active A1/A2/R6, cron install/observe and sealed I348 control paths. Older executable evidence was included in the tracked source/syntax pass. | Historical fixture drivers, reviewed plans, run output and generated reports are distinct from current operating instructions. Most archived scripts were inventoried and parsed only. |
| Tests and non-runtime material | 446 tests paths including 116 integration-directory files. Examined Vitest, Playwright, test DSN policy and cleanup, evidence harnesses and known-link assertions. Inventory also includes issues (952), documentation (84), data (73), legacy/offline (9), public (12), agent/tool configuration and root files. | Archived reports and generated JSON/hashes, static images, lockfiles, recorded SQL/output and superseded migration/rehearsal material were inventoried. No tracked node_modules or conventionally named vendor tree. External packages were installed from the lockfile. No tracked GitHub Actions workflow was found at the target. |

The earlier November reviews supply historical evidence for the rebuild, release and populated qualification. This review independently inspected older code and exercised new synthetic cases. A complete inventory and repository-wide automated checks do not establish an individual manual semantic review of every first-party file.

## Verification on streamanator

[Captured DEV assertion names, statuses and suite summaries](AFLDB-FULL-REVIEW-2026-11-22-RESULTS.txt).

Private extraction from Git, Node 22.23.2, offline npm ci (427 packages), one isolated PG16 cluster with separate test databases and unused loopback ports. Historical restore evidence was read separately. Test connections used synthetic credentials generated for the disposable cluster. Tests did not use retained dumps.

| Check | Result |
|---|---|
| Sol’s behavioural suite | 29 passed, exit 0. Independent extension with seven command-only, journal, partial-installation, same-minute and recycled-PID checks reached 36 passed, exit 0. The green original harness omits the observed cron format. |
| Timestamp suite on current pull | 42 passed, exit 0 |
| Corrected timestamp suite on pre-fix pull from d6b983b5 | 20 passed, 22 failed, exit 1. Independent blob SHA-256 ea48205a02e6383c2fe87a9e896afed422ff44834231270cbd22dc78c305de9b. All three reported totals reproduced. |
| Worker configuration and functional delivery | The actual R6 process-check function found the disposable primary and both release workers, ordinals 1 and 2, with exactly one nonempty URL and secret in each. Exit 0. Separate CLI returned 0 with 2/2, ordinals 2 and 1, two requests. Production observations for this review are limited to the Sunday sitting record. |
| P6 | Both expected HTML titles passed despite the RSC/script text “Page not found”. Missing, wrong and unterminated titles each exited 1. |
| Production build / typecheck | Both supported npm scripts exited 0. Build used the migrated synthetic database. |
| Lint | Raw npm run lint exited 1 on target and previous baseline, 338 errors and 145 warnings each. Candidate lint:gate exited 0 at 338 errors in 43 files. The ratchet allows that debt. |
| Unit | Final DB-free run with the documented interpreter exited 1: 12,380 passed, seven failed and 31 skipped across 217 files (214 passed, two failed, one skipped). The first DB-free run without the documented Python interpreter had 86 failures. All nine failing files rerun on each pinned revision reproduced the same 86 named failures. With the documented Python environment the two equivalent focused runs each had seven failures, 496 passes and three skips, with identical failing tests. |
| Integration | Six-file run exited 1. Admin lifecycle 50/50, auth audit JSONB 8/8 and admin upload 3/3. Brownlow settlement stopped before test bodies on the schema-only DB (missing afltables source). Teardown also complained about uninitialized canonical clubs. The baseline reproduced both errors. After synthetic source, season and two club rows were added, target and base both passed 3/21 and failed the same 18 cases; the expected canonical match projections were absent. DraftGuru import and populated pending-Brownlow suites were gated/skipped. |
| Empty-fixture negative control | Player-matching known-player recall on a clean migrated DB returned 0, one test passed. The test returned before its assertion (377). |
| Browser | Three responsive navigation tests passed against the actual standalone build on a new loopback port, desktop Chromium project, exit 0. The selected tests exercise phone and wide viewports. |
| Public publication controls | With synthetic winner rows, the award year and season agreed for accepted 2020 and historical 1950. The award year named the winner for pending 2022 and explicitly inapplicable 2021, while the season withheld it. Empty 2023 returned award 404 and season 200. The canonical player page returned 200 and its Brownlow table contained only accepted 2020 and historical 1950. Match pages returned 200 throughout and displayed the BV column only for the accepted season with recorded match votes. Pending and inapplicable match votes stayed hidden, as did genuine historical NULL. After changing the accepted count from 21 to 29 and running the CLI, both workers acknowledged and the award page’s metadata showed 29. The extra pending 2026 check confirmed the winner in page metadata. |

The remaining unit failures comprise the frozen DraftGuru B1 sample and its accepted Stage A/bridge input, and the fitzRoy 1909 and 2025 source CSVs. Relevant missing paths include `data/sources/draftguru/person-html-20260826/sample.json` and `data/sources/afltables/fitzroy_core/full-history-20260902/player_stats_{1909,2025}.csv`. The initial environment also lacked psycopg. A Brownlow sample read failed in that first run. Baseline equality establishes the measured result in this environment, not correctness of those features. Full populated integration, admin-nav, telemetry-clear, NL stress and full public/mobile Playwright suites did not run. No baseline equivalence is asserted for unexecuted suites.

## Owner decisions and issue reconciliation

**Installation — HOLD.** The Git-blob pins match. However, the cron contract fails on the host’s command format. A successful manual pull can supply recovery bytes; it cannot satisfy 352’s scheduled-run criterion. Monday’s dispatch and off-host bytes were observed. Its invocation attribution is unproven, and the independent production check for next-nightly-within-25-hours is outstanding.

**Push of exact b445ba7f — HOLD.** It directs immediate installation of a verifier that rejects a genuine dispatch, and its green release fixture repeats the mismatch. Before recommending publication, correct the job text/PID/date correlation, test the pair across a partial install and re-pin the actual tested bytes. The public Brownlow, AFLW replacement and direct test-target safety findings are independent high-severity release risks already present at the recorded production revision. The review branch records evidence only.

**Wednesday 25 November — NO-GO.** Before reboot the owner needs Wednesday’s successful overnight production backup unit plus the exact basename/full SHA, an attributable 03:10 off-host run for those bytes, and separate 03:36:35 restore-service success with the restore database comment matching that service’s dump. Capture current release and build, boot and invocation IDs, services/workers, pre-check and head baseline, free space, the data recovery decision and snapshot completion evidence per the runbook, today’s recovery-console login, running 137 and installed 149, GRUB configuration and tested fallback checks, timer quiescence, idle apt and the attended time cutoff. Uncertain recovery keeps the gate closed. After reboot require the new boot/invocation IDs, expected kernel, service/DB/Caddy health, restored timers and GRUB defaults, release identity, public heads, process-level configuration and a separate successful 2/2 revalidation. Sunday’s waiver applied to its four recorded ticks. [Wednesday gates](../../docs/v2/evidence/backlog-20261121/ATTENDED-PLAN-R6-20261125.md)

The target’s authoritative Open Issues table and index agreed on 332, 348, 350, 351, 352, 357 and 362. Reviewed the ledger headings, individual files and current sitting before assigning IDs. This branch updates 348, 351, 352 and 362, reopens 367 and 368 for uncovered paths, and adds 374–377. The earlier 368 resolution remains linked as historical evidence. Fourteen pins, fixture totals and target revision are preserved. No implementation, production or installation change accompanies this report.
