# F-229-SWITCH: the bounded fixture window (2026-11-01)

**Status: IMPLEMENTED AND REHEARSED LOCALLY. NOT RUN ON PRODUCTION. The ingestion switch was not toggled anywhere except inside disposable `afldb_v2_*_test` databases.** This approves nothing by itself: running the tool is the first fixture apply (block M3 of the [master sequence](master-execution-sequence-2026-11-01.md)) and needs that block's own approval.

## 1. The problem and why no transaction-scoped route exists

`tools/current-season/settle-afl-api-fixture-schedule.ts` refuses `--dry-run` and `--apply` unless `site_settings` `acquisition.afl_api_current_season_enabled` reads true. The gate reads it through `readAflApiIngestionControls` on a **separate** `afldb_app` connection, fail-closed. An enable made inside the writer's own transaction is uncommitted and therefore invisible to that connection, so the only ways to use a transaction-scoped enable would be a bypass flag in the settle CLI or a second, committed write by another path. A bypass flag weakens the contract that "no write happens unless the committed switch says so", and is not added. The existing, proven mechanism is the C4b bounded window (preconditions, BEFORE record, detached watchdog with a proven handshake, three-layer restore). The new tool reuses those exact primitives and adds what a window that **writes** needs.

## 2. The tool

`tools/current-season/afl-api-fixture-window.ts`:

```
node --import tsx tools/current-season/afl-api-fixture-window.ts \
  --label <fixtures-only-snapshot> --expect-initial absent|false --expect-created <N> \
  --expect-feed-sha256 <64 hex> --decision "<owner approval reference, 20+ chars>" \
  --evidence-dir <new or empty dir> [--max-minutes 5-60, default 15] [--check-only]
node --import tsx tools/current-season/afl-api-fixture-window.ts --restore-only --evidence-dir <dir>
```

Sequence: `--check-only` proves every precondition and writes nothing. A run does: offline `--validate-only` (no connection) -> preconditions -> BEFORE record -> single-window advisory lock -> watchdog armed **and proven ready** -> switch ON (audited) -> real `--dry-run` must report `Outcome: dry_run` and exactly `Actions: created=<N>`, rolled back, row counts unchanged -> inventory, switch state and audit trail re-checked -> real `--apply` must report `Outcome: applied` and exactly `created=<N>` -> switch OFF, verified on the writer and the control path -> AFTER record, fixtures = BEFORE + N, canonical matches unchanged, audit reconciliation -> `transition.json`.

### 2.1 Preconditions (exit 2 on any, nothing written)

* **Expected initial state, exactly.** `--expect-initial absent|false` must equal the stored state after normalisation. Production holds `absent`. The admin toggle's double-encoded JSON string (`"\"false\""`) and a real boolean both normalise to `false` (the application's own reading); `true`, a number or any other text refuses. The **raw** stored text is recorded in `before.json`.
* **Pinned feed.** The snapshot's `00-season-matches.json` sha256 must equal the approved value.
* **AFL Tables switch retired** (`parseAfltablesNetworkStatus`), so the AFL Tables settle cannot be a concurrent writer.
* **Absent units are not proof.** The four AFL API unit states are recorded exactly as read; `not-found` is recorded as `absentUnitsAreNotProof` and is never counted as safety. The independent inventory below carries the weight.
* **Inventory of other writers, every source recorded.** (a) every `.timer`/`.service` unit file in the systemd directories whose text names a switch consumer, with its enabled/active state (so a differently named timer is found); (b) `systemctl list-timers`, active services and unit-file rows; (c) the invoking user's crontab, `/etc/crontab`, `/etc/cron.d`; (d) `atq`; (e) the process table; (f) the database: any other session as `afldb_import` or `afldb_owner` (the writing roles). A source that **cannot be read** refuses ("it proves nothing"); a mechanism confirmed not installed is recorded, not counted. The consumer set is `acquire-afl-api`, `discover-afl-api-seasons`, `settle-afl-api-fixture-schedule`, `settle-afl-api-fixtures`, `settle-afl-api` and the two Brownlow CLIs (pattern `CONSUMER_PATTERN`).
* **One window at a time.** A session-level advisory lock on a dedicated connection; it dies with the process, and a second window or tool holding it refuses.
* **Registry of switch consumers with a drift test.** `SWITCH_REFERENCES` lists every non-test file that reads the switch (admin toggle and page, reader, safety module, `site-settings`, the seven writer CLIs, the two units, promotion tooling). `tests/afl-api-cutover.test.ts` fails when the repository's referencing files and the registry differ, so a new entry point cannot appear without this protocol being re-read. (Writing the registry found two CLIs and a page the first draft had missed.)

### 2.2 During the window

The inventory, the switch state (must still be `true`) and the audit trail are re-checked **before the apply**. A new writer, a changed switch, or **any** `current_season.afl_api_ingestion_set` row not carrying this run's id (a concurrent Super Admin toggle) stops the apply; the run HALTs and restores. After the window, every audit row since BEFORE must be this run's: exactly one ON then one OFF, carrying the decision reference.

### 2.3 Restoration (the C4b loop, `restoreSettingOff`)

Run on success, a refused or failed step, an error, SIGINT/SIGTERM/SIGHUP, the deadline, and (via the detached C4b watchdog this tool arms) the **death of the window process**. Three attempts; the value written is a real boolean `false`; it is verified on the writer and on the control path. A start of `absent` therefore ends as an explicit `false` row (accepted by C4b and by the application's reader; recorded in `transition.json`, not hidden). Exit codes: 0 CLEAR; 1 HALT (restored and verified); 2 refused before any write; 3 RESTORATION NOT VERIFIED (run `--restore-only`; the switch is honestly reported as possibly still on). A CLEAR whose `result.json` cannot be written becomes a HALT.

## 3. Rehearsal (disposable ledger-118 clone of the verified production backup, real everything except host facts)

REAL: the tool; the switch writer and its audit rows; the control-path reader; the session advisory lock; the database-session inventory (including a real second connection as `afldb_import`); the detached watchdog **process** (killed-parent case included); and the production CLI `settle-afl-api-fixture-schedule.ts` itself (`--validate-only`, `--dry-run`, `--apply`) reading the retained authentic 2027 snapshot (`afl-api-2027-2026-11-01-012026`, feed sha256 `21fd12e7…c84d`). SIMULATED (and listed in each report): `systemctl` answers, the cron/at/process rows (no systemd or cron on the workstation; foreign entries are injected where a scenario needs one), and step failures in the scenarios that name them.

`tools/v2/fixture-window-isolated-e2e.mts`, **46/46 checks on Linux (streamanator, Node v22.23.2, revision `e0f6c7bc`) and 46/46 on Windows**; the first Windows runs went 41/45 and 44/45 and found two real defects, both fixed before this count (below).

| Scenario | Result |
|---|---|
| `--check-only` on a clean host | CLEAR, nothing written (no audit row, no watchdog, setting still absent); absent units flagged "not proof" |
| Expected initial state | `--expect-initial false` against absent, a stored `true`, and an unrecognised value are each REFUSED (exit 2), nothing written |
| Other writers | a cron line, an `at` job, a running consumer process, a differently named startable timer, an unreadable inventory source, an enabled AFL API timer, a **real second connection as `afldb_import`**, and a second window holding the lock: each REFUSED (exit 2), nothing written, no watchdog; after the lock holder disconnects, `--check-only` is CLEAR again |
| Dry-run mismatch (approved 217, real dry-run says `created=218`) | HALT (exit 1); the apply never ran; fixtures 0; switch restored to boolean `false`; audit on then off; evidence complete |
| Real dry-run clean, apply fails | HALT, restored, fixtures unchanged |
| A foreign switch-audit row appears mid-window (a concurrent toggle) | HALT naming the concurrent toggle; **the apply is not started**; restored |
| SIGINT / deadline during a step | step stopped, restored, HALT, fixtures unchanged |
| Transient restore failure (twice) | third attempt restores and verifies |
| Permanent restore failure | exit 3 RESTORATION NOT VERIFIED, switch honestly `true`, no restore marker; `--restore-only` recovers to `false` |
| **Window process hard-killed with the switch ON** | the real detached watchdog (a different live process, armed and handshaken before the switch went on) turns it OFF by itself; audit on (window) then off (watchdog); fixtures untouched |
| **Success from `absent`** | CLEAR; real dry-run and real apply each `created=218`; fixtures 0 → 218; matches unchanged; switch restored to boolean `false` and the control path off; exactly one ON and one OFF audit row carrying the decision; `transition.json` events `switch-on, dry-run, apply, switch-off`; the watchdog stood down by itself |
| Replay from the admin-written shape (the double-encoded string `"false"` as the initial state) | accepted as `false`; the real dry-run reports `no_changes`, so HALT; apply never runs; fixtures stay 218; the switch ends as the canonical boolean |
| Control: the unmodified settle CLI with the switch off | refuses `--dry-run` and writes nothing |

**Defects found by the rehearsal and fixed:** (1) the precondition compared the raw stored text, so the admin toggle's double-encoded `"false"` was refused as an initial state; the unit harness had hidden it by normalising, and now returns raw text so a test catches it. (2) The first draft of the consumer registry missed the two Brownlow CLIs, both units and the admin page; the drift test found them. (3) The inventory first classified a unit by its name only, which would miss a differently named timer; it now reads every systemd unit file's text and its enabled/active state. (4) `list-timers --all` listed inert installed timers as findings, so it is now the active list only. The Linux run additionally showed the real inventory refusing on a host with live consumer timers (the intended behaviour), and the driver was changed to simulate host facts on every OS.

## 4. Approval statement for the switch window (inside block M3; the owner writes it)

"I approve the bounded fixture window at revision R: run `afl-api-fixture-window.ts` on snapshot `afl-api-2027-2026-11-01-012026` (feed sha256 `21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d`) with `--expect-initial absent --expect-created 218`, deadline 15 minutes, evidence in a new directory outside the checkout. The switch must be restored to false and verified before anything else happens. This does not approve leaving acquisition enabled, any timer, or any other write."

Before the window, the operator runs `--check-only` on the host and reads its `preconditions.json`: every unit state, every inventory row, and the "absent units are not proof" flag. **Not provable off the host:** the real systemd, cron and `at` content; the live `.env`; other operators' shells. The inventory narrows those risks; the audit reconciliation and the advisory lock detect the rest after the fact, and the owner confirming no other operator is working is still a human step.

## 5. Limits stated plainly

* If the window process **and** the watchdog both die with the switch on, the switch stays on until `--restore-only` (or the admin toggle). The watchdog is a separate process started with a proven handshake, which is why a parent kill was rehearsed rather than assumed.
* A replay of the same snapshot after success is refused at the dry-run (`no_changes` is not `created=N`); that is the intended idempotence check, not a failure of the tool.
* The tool adds no bypass to the settle CLI and changes no application code path.
