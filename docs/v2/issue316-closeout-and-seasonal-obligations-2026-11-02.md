# ISSUE-316: delivered cutover, continuing seasonal obligations, and the owner close-out decision (2026-11-02)

**Status: PREPARED. Nothing here grants an operation, closes ISSUE-316, or claims a future acceptance.** Production was not changed by anything in this document or the work behind it (read-only checks as `arm`; copies of helper scripts into `/home/arm`). Companion records: [C5 activation record](block-c-c5-activation-record-2026-11-02.md), [D-316-12 UI release approval](d31612-ui-release-approval-2026-11-02.md), runbook `issues/open/AFLDB-ISSUE-316.md` section 7 (C-steps) and section 8 (decisions).

## 1. What is delivered, and what continues

| Part | State | Evidence |
|---|---|---|
| C0, C1 DEV approval and rehearsal | Done (historical) | earlier records |
| C2 close 2026, retire AFL Tables in one write (D-316-1) | Done; accepted | register `retired`; timer disabled (A-AFLT, 2026-10-31) |
| C3 AFL API units installed inert (D-316-2) | Done; accepted | [C3 outcome](block-c-c3-outcome-2026-11-02.md) |
| C4 2027 registered, C4b rehearsal (D-316-13) | Done; C4b r2 accepted as the PASS record (season-feed-only) | [C4b r2 outcome](block-c-c4b-r2-outcome-2026-11-02.md) |
| **C5 cutover go (D-316-4)** | **Activation accepted** 2026-11-02; match timer enabled, next elapse 2026-11-03 05:01:47 AEDT | activation record |
| **First scheduled run** | **NOT YET OBSERVED** (section 5) | pending read-only command |
| D-316-12 admin wording and deployment docs | **Done locally** (`6d41dd3a`); **not deployed** | approval in the UI release document |
| C6 debutant routine | Future, per round from Opening Round; **D-316-5 undecided** | section 3.1 |
| C7 first-concluded-round acceptance | Future; **owner criteria not yet approved** (proposal in 3.2) | section 3.2 |
| C8 Brownlow 2027 count window | Future; timer disabled, gates unset; **D-316-7 undecided** | section 3.3 |
| C9 ownership replay / AFL API baseline | Future, due before the 2027 rollover; **D-316-6 successor not yet opened** (proposal in 3.4) | section 3.4 |
| D-316-8 attendance, -9 coaches, -10 revalidation vs ISR lag, -11 on-demand Start | **Undecided** (3.5) | section 3.5 |

The first 2027 match is 2027-03-17T00:00Z per the retained feed (11:00 AEDT). Every gate below keeps its own timing.

## 2. The process-count discrepancy (reviewed)

The 10:24:17Z `timer` failure (`settle/acquire processes = 1`) and its 10:24:44Z passing re-run are preserved unchanged in the activation record and `step5-*.txt`. **Reproduced read-only on `afldb-prod` at 10:44:11Z and 10:44:38Z** (`followup-selfmatch-repro-prod-readonly*.txt`): a shell whose own argv carries `afldb-settle-afl-api.timer` is the only match of the old `pgrep -f` pattern (pid 3305658, `bash /home/arm/c5-selfmatch-repro-20261102.sh afldb-settle-afl-api.timer`), the old helper r2 prints `processes = [1]` and fails, and the fixed helper r3 prints `[0]` and passes. The self-match is therefore a **reproduced helper defect**, no longer only an inference; the original 10:24:17Z matched process itself was never inspected.

Fix (local, `c5-observe-r3.sh` + `c5-proc-guard.sh`, not weakened): every process naming a settle or acquire tool still counts, except the helper itself, its unbroken chain of **wrapper** ancestors (bash, sh, ssh, sshd, sudo and similar) and its own forks with identical argv. A writer that launched the helper (a `node` ancestor), a sibling started by the same operator command, a child with different argv and a systemd-started wrapper are all still counted. Tests: `c5-proc-guard-test.sh` 17/17 (the old behaviour reproduced as a naive count of 1; transport excluded; seven genuine-writer shapes detected). A real-process spawn test (`c5-proc-guard-live-test.sh`) is written but **not run**: the DEV host refused SSH and a production spawn is out of scope. Instead the guard was run over the **real production `ps` table** with the transport (count 0) and with one injected text line naming a writer (detected, `<INJECTED TEST LINE>`; no process was started).

## 3. C6 to C9: actual requirements, operations, and what is undecided

### 3.1 C6 debutant routine (D-316-5, undecided)

Requirement (runbook C6): register each new player in the Data Editor and adjudicate their `CD_I` id at `/admin/player-links/afl-api` before the nightly, or the completeness gate rolls the night back (the settle runs `--apply --auto-apply --require-complete-source`; an unresolved player identity refuses the single settle transaction, so **one miss delays every match of that night by a night**; no row is retained). Acceptance: the nightly exits 0 and reports zero `unresolvedIdentityPlayer`.

Operating routine, each round from Opening Round:
1. **Next morning, after 05:15 AEDT** (the timer fires 05:00 to 05:15): `systemctl show -p Result,ExecMainStatus,ExecMainExitTimestamp afldb-settle-afl-api.service` as `arm`, and `bash /home/arm/c5-observe-20261102-r3.sh first-night 924ff273261834e4112e3f41b61ceeab55427534` (read-only; its journal window and `id > 75` filter are written for the first night, so for later nights use the systemd view and the batch listing, not its date window).
2. If the unit failed, read the reason with the owner's `sudo journalctl -u afldb-settle-afl-api.service --since yesterday --no-pager` (`arm` is not in `adm` or `systemd-journal` and sees only the tool's own lines).
3. For each unresolved player: a Super Admin creates the player in the Data Editor, then adjudicates the `CD_I` id at `/admin/player-links/afl-api`.
4. **There is no on-demand Start** (accepted design, section 3.5 D-316-11). The corrected data is picked up by the **next** 05:00 to 05:15 run. Do not start a manual settle.
5. Not yet known and to be confirmed read-only in Opening Round from the acquired snapshot: whether a debutant's `CD_I` id is visible before the match concludes (which would allow registering before the night rather than after a failure). Do not assume it.

Decision for the owner (D-316-5): accept manual registration and adjudication before each nightly, or change completeness from whole-night rollback to per-unit refusal (a code change; not prepared). Recorded default in the runbook: accept manual for Opening Round 2027 and review after round 2. **Not decided today.**

### 3.2 C7 acceptance of the first concluded round (criteria: owner to approve before Opening Round)

Runbook C7 says "Owner records the criteria in advance" and D-316-4 says set them before Opening Round. **Proposed criteria for approval** (mine; not approved, thresholds are the owner's):
1. For each night of the first round's week, the scheduled unit ended `Result=success`, `ExecMainStatus=0`.
2. Every CONCLUDED match in the round has exactly one canonical `matches` row owned by source `afl_api` (count equals the retained feed's CONCLUDED count for that round).
3. Period scores exist for each such match and the ISSUE-276 guard was reachable (no period-score refusal).
4. Player statistics exist for both sides of each match.
5. The derived-data recompute ran (counter in the batch's `validation_result`).
6. `unresolvedIdentityPlayer` and `unresolvedIdentityMatch` are 0 on the retained batches; no `settle-afl-api.ts` batch is left not completed.
7. Zero AFL Tables requests: register `retired`, timer disabled, no new AFL Tables snapshot label, no AFL Tables unit run.
8. The ISSUE-274/275 code paths were exercised on `afl_api` rows (evidence in the counters), and public season pages show the round within the ISR window the owner chose in D-316-10.

**Preparation still owed (not done now, because it needs the schema and counters read, not guessed):** a read-only `c7-observe` helper with exact queries for 2 to 6, self-tested against a rehearsal database, before 2027-03-17. **Acceptance is future and is not claimed.**

### 3.3 C8 Brownlow 2027 (D-316-7 undecided; window is the owner's act)

Requirement (runbook C8): the count-week chain with `AFLDB_AFL_API_BROWNLOW_ENABLED` and the Brownlow admin switch, the Brownlow timer enabled **for the first time** here; season totals need D-316-7 (Brownlow season totals without AFL Tables profile paths; successor to ISSUE-232, **due before September 2027**).

Current preserved state: Brownlow timer disabled/inactive; `AFLDB_AFL_API_BROWNLOW_ENABLED` absent from `.env`; no Brownlow switch row (panel: admin control Disabled, deployment gate Disabled). Note that the Brownlow chain's steps 1 and 2 read the **match** switch too, which is now enabled, so once the Brownlow timer is ever enabled only its own two gates stand between it and writing.

Sequence when the owner opens the window (ISSUE-232 section 7 E; **nothing authorised now**): open = (a) match switch on, (b) Brownlow admin switch on, (c) only then `AFLDB_AFL_API_BROWNLOW_ENABLED=true` in `.env`, and the Brownlow timer enabled by the owner (sudo); close = (a) first remove or clear the environment gate, (b) then switch the admin control off, then disable the timer. Do not enable the Brownlow timer with the environment gate set and the admin switch off: steps 1 and 2 would write and the unit would fail every 5 minutes.

### 3.4 C9 ownership replay / AFL API baseline (D-316-6; successor proposal below)

Requirement (runbook C9, D-316-6): an ownership-replay or AFL API baseline design for rebuild, rollover and promotion, **due before the 2027 rollover (about October 2027)**. Today two guards refuse by design: the D-233-3 census refuses a rebuild, rollover or promotion check for any completed season holding `afl_api`-owned matches (no override), and `tools/db/rollover-season.ts` refuses a rollover after AFL Tables is retired (`src/lib/rollover/afltables-network-retirement.ts`, "refused, not worked around"). When 2027 completes, those refusals bind it.

**Scoped successor proposal (to approve; no ledger entry created, no ID assigned):** *"Ownership replay and AFL API baseline for rebuild, rollover and promotion."* Scope: choose and implement one of (A) replay retained AFL API snapshots as the baseline during rebuild and promotion, (B) a one-time sealed-season ownership conversion with an audit trail, (C) an explicit sealed `afl_api` ownership marker the census recognises. Out of scope: any production data change, any change to the retirement register. Acceptance: the census no longer refuses a completed season whose ownership is the declared `afl_api` baseline, the 2027 rollover runs end to end on an isolated rehearsal, the existing refusals stay in force for undeclared ownership, with tests. **Gate: delivered and reviewed before the 2027 rollover; decide the option by June 2027** so there is time to build and rehearse. Open the issue when the owner approves the proposal.

**D-316-7 successor (proposal, due before September 2027):** *"Brownlow season totals without AFL Tables profile paths."* Scope and acceptance to be drafted from ISSUE-232 section 7 E when the owner approves opening it; no work is done now.

### 3.5 D-316-8 to D-316-11 (owner choices, all undecided)

| Decision | Choice | Default noted in the runbook | Gate |
|---|---|---|---|
| D-316-8 attendance (no API source) | NULL / `not_collected`, Super Admin entry, or another source | NULL is the honest default (NULL is not 0) | before Opening Round |
| D-316-9 coaches / `match_coaches` for 2027 | admin entry, or accept the gap | owner's choice | before Opening Round |
| D-316-10 revalidation vs ISR lag | let the AFL API units revalidate (needs `AFLDB_REVALIDATE_SECRET` in their environment) or accept ISR lag | owner's choice | before the first concluded round (it determines C7 criterion 8) |
| D-316-11 on-demand Start | **not part of the accepted design**: the admin panel has no Start control and no polkit rule is installed | optional, not needed for the cutover | record "not pursued" |
| New: nightly retained batches | the run is expected (not observed) to retain one `import_batches` row per night with no canonical rows until 2027-03-17, about 130 rows; decide after the first night whether that is acceptable or whether the timer should be paused for the off-season | none | after the first-night observation |

## 4. Owner close-out decision (prepared; not recorded)

**The delivered cutover and the continuing obligations are different things.** The cutover (C0 to C5 plus D-316-12) can be accepted as delivered once the first night is observed and the UI correction is released or deliberately left local. The obligations in section 3 continue through 2027 and each keeps its own gate. ISSUE-316 must not be closed by dropping them. Owner options:

**Option A (recommended): close the cutover, carry the obligations in one named successor.** Conditions before anything is closed: (1) the first-night observation is recorded (section 5), (2) D-316-12 is deployed and visually verified, or the owner records that it stays local, (3) one successor tracking entry, *"AFL API 2027 season operations (successor of ISSUE-316)"*, is created holding C6, C7, C8, C9 and D-316-5 to -11 exactly as in section 3 with their gates and dates, (4) the owner records D-316-5, -8, -9, -10 and -11, or defers each to its stated gate. Then ISSUE-316 is resolved as "cutover delivered" and its entry points at the successor.

**Option B: keep ISSUE-316 open until C7 is accepted** (after the first concluded round, March 2027), with C6 to C9 tracked in it. Smaller ledger change, but the issue stays open for four months of seasonal work.

Wording to copy, if choosing A:

```text
I, Stuart, accept the AFL API cutover (ISSUE-316 C0 to C5, D-316-12) as delivered on the evidence in docs/v2/block-c-c5-activation-record-2026-11-02.md and the first-night observation of <date/time, class>. I do not close the seasonal obligations: C6, C7, C8, C9 and D-316-5 to D-316-11 pass unchanged, with their gates (Opening Round 2027-03-17; criteria before it; D-316-7 before September 2027; D-316-6 delivered before the 2027 rollover) to <successor issue>, which Claude is to open. Decisions now: D-316-5 <accept manual / change gate / defer to Opening Round>; D-316-8 <...>; D-316-9 <...>; D-316-10 <...>; D-316-11 not pursued.
Recorded: <date and time>.
```

**This session's recommendation in one line:** choose A after the first night passes; do not close anything before that.

## 5. First-night observation (pending; durable handoff)

The timer's observed next elapse is **Tue 2026-11-03 05:01:47 AEDT**; the run is a real `--apply` (two provider requests, then `settle-afl-api.ts --apply --auto-apply --require-complete-source`). **No monitor is running and no overnight wait is held.** At or after **05:15 AEDT**, as `arm`, read-only (authorised by Stuart):

```bash
bash /home/arm/c5-observe-20261102-r2.sh first-run 924ff273261834e4112e3f41b61ceeab55427534
bash /home/arm/c5-observe-20261102-r3.sh first-night 924ff273261834e4112e3f41b61ceeab55427534
```

`first-run` is the authorised pass/fail check (service `Result=success` and exit 0; at least one completed `settle-afl-api.ts` batch after id 75, none not completed; 0 canonical 2027 matches). `first-night` adds the actual invocation, the visible journal, the sequence, the newest batch's `validation_result`, canonical effects and the preserved configuration, and **classifies** without claiming PASS (dry-tested on the pre-run state: NO-RUN, sequence 77, `followup-first-night-phase-dry-test-prod-readonly.txt`). The r3 copy (`c5-observe-20261102-r3.sh`, `c5-proc-guard-20261102.sh`) is on the host.

| Class | How to tell | Meaning | Owner action |
|---|---|---|---|
| **Scheduled success** | `RAN, exit 0`; `first-run` PASS; one completed batch after 75 (expected, not yet observed); canonical 2027 matches 0 | the replacement ran | record it; the activation record then supports Option A |
| **Success without a retained batch** | `RAN, exit 0`, no batch, sequence unmoved or moved | `first-run` will FAIL on its batch check; this is the data view differing from the prediction, **not** a failed run | read the journal with sudo; record the real behaviour; decide whether the expectation was wrong |
| **No-run** | `NO-RUN` (LastTriggerUSec empty, no ExecMain start) | the timer has not fired yet, or checked before the window | re-observe after 05:20; if still empty, report; nothing to recover |
| **Failed run** | `RAN AND FAILED` (`Result` not success or exit not 0) | the single settle transaction rolled back; nothing committed from it | **do not retry or start a manual settle.** Owner reads the journal with sudo; decides between leaving the timer for the next night or the packaged rollback (activation record section 8, R5). Any batch the run committed is data, not rolled back |
| **Helper failure** | `HELPER-FAIL` or `QUERY FAILED` lines | access or helper problem, not evidence about the run | re-run once; report |

If this session is closed by then, the commands and table above are the handoff; nothing depends on this session.

## 6. Exact preserved state at the time of writing

Production untouched by this document's work: serving release `ea98a35f...`, MainPID 3303369 as at 21:28 AEDT, timer enabled with next elapse 05:01:47, Brownlow and AFL Tables timers disabled, `.env` 4096 bytes with one trigger line, the switch stored as the JSON string `"true"` (not rewritten). Preserved and untouched: backups, retained releases, frozen P/H/EXEC, the quarantine, `.codex/`, archived source work, parked ISSUE-327.
