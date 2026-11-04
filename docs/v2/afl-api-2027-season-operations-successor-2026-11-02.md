# AFL API 2027 season operations: the operating record for AFLDB-ISSUE-332 (opened 2026-11-02; consolidated 2026-11-04)

**Status: OPEN. Prepared obligations, not decisions.** Nothing here is accepted, decided or executed. This is the one place that names every seasonal obligation, its date, its state, the recommendation and what each choice costs. Detail lives in the documents it points to; it does not restate them. The ledger entry is `AFLDB-ISSUE-332` in `issues.md`; the close-out reasoning is [issue316-closeout-and-seasonal-obligations-2026-11-02.md](issue316-closeout-and-seasonal-obligations-2026-11-02.md) section 3 and the recommendations are [post-release-closeout-2026-11-04.md](post-release-closeout-2026-11-04.md) sections 4, 7 and 9.

**Owner position (2026-11-04, O4/O6, verbatim):** "Keep the seasonal decisions dated and pending. Do not silently approve their recommendations or implement a new ownership policy." Every recommendation below is therefore a **recommendation only**. Only D-316-11 (not pursued, 2026-11-02) is decided. ISSUE-316 is resolved ("cutover delivered", 2026-11-03); the first two scheduled nights succeeded (batches 78 and 82, empty, exit 0). Nothing below is unfinished rebuild work: each item is a future-dated obligation of the delivered cutover, and ISSUE-332 stays open until each has been decided and, where an acceptance is named, accepted at its own date.

**Dates.** Opening Round's first match is **2027-03-17T00:00Z = 11:00 AEDT** (daylight saving ends 2027-04-04, so AEDT applies). The nightly AFL API timer fires **05:00 to 05:15 AEDT**. For 2027 the feed's rounds 1 to 24 map to canonical rounds 1 to 24 with **no Opening Round offset** (2026 has one), 25 `WF` is `wildcard_final`, 26 `QE` is split by `finals_match_label` ([issue229-b2-2027-feed-check-2026-11-01.md](issue229-b2-2027-feed-check-2026-11-01.md)). Use the feed's own round code with `c7-observe --round`.

## 1. Decision and gate register

| # | Topic | Gate (date) | State | Recommendation (not approved) | Consequence of the recommendation / of not deciding |
|---|---|---|---|---|---|
| 1 | **C6 / D-316-5 debutant handling** | Routine runs each round from 2027-03-17. **Review after round 2** (once round 2's matches have settled; the date follows the fixture, not a calendar day) | UNDECIDED (runbook default: accept manual, review after round 2) | Accept manual registration and adjudication; keep whole-night rollback | A debutant not registered and adjudicated before the 05:00 run delays that whole night's matches by one night; nothing is lost or retained wrongly. Per-unit refusal is a code change, not prepared and not recommended before round 2 evidence. See section 3. |
| 2 | **D-316-8 attendance** | before 2027-03-17 | UNDECIDED | NULL with `attendance_status = 'not_collected'` (NULL is not 0); no manual duty | 2027 matches show attendance "not recorded" and are excluded from attendance records until a source exists. Super Admin entry stays available later. |
| 3 | **D-316-9 coaches** | before 2027-03-17 (review after round 2) | UNDECIDED | Accept the gap at Opening Round; back-fill through `/admin/coaches` assignment overrides when wanted | 2027 coaching games lag until entered. 2026 coaches are done (ISSUE-333, resolved); this does not touch them. |
| 4 | **C7 criteria** | approve before 2027-03-17 | NOT APPROVED | Approve criteria 1 to 7 as written (section 4); restate 8 once #5 is chosen | Without approved criteria the first-round acceptance has nothing to be measured against. |
| 5 | **D-316-10 revalidation vs ISR** | before the first concluded round (week of 2027-03-17) | UNDECIDED | Accept ISR lag; do not give the nightly units `AFLDB_REVALIDATE_SECRET` | The lag is **unbounded by evidence** (section 5). No secret is added to an unattended unit. |
| 6 | **C7 acceptance** | after the first concluded round (March 2027) | FUTURE; no PASS exists | The owner's act against the approved criteria, using the observer (section 4) | Not claimed anywhere. |
| 7 | **C9 / D-316-6 ownership baseline** | choose **by 2027-06-30**; delivered and reviewed before the 2027 rollover (about October 2027) | NO OPTION CHOSEN; no ownership policy implemented | Option C (section 6) | If undecided, the D-233-3 census and `rollover-season.ts` refuse the 2027 completion, by design. |
| 8 | **D-316-7 Brownlow successor / C8 count window** | open the successor in June 2027; decision **before 2027-09-01**; the count window is the owner's act | UNDECIDED; **no Brownlow activation authorised** | Open "Brownlow season totals without AFL Tables profile paths" in June so the design is rehearsed before September | Timer stays disabled and the environment gate absent until the owner opens the window (section 7). |
| 9 | D-316-11 on-demand Start | n/a | **Decided: not pursued** (2026-11-02) | n/a | No Start control and no polkit rule. |
| 10 | Nightly empty batches | to 2027-03-16 | Observed (nights 1 and 2) | Accept as is (about 130 empty rows); do not pause the timer | No cleanup policy is invented. |

## 2. Instruments that exist now (implemented, qualified, not an acceptance)

- **C7 observer** `tools/v2/c7-observe.ts` over `src/lib/acquisition/afl-api-c7-observation.ts`. Read-only: one `read only` transaction, SELECTs, rolled back; no provider request, no unit start; the DSN is read from a named environment variable and never printed. It never records an acceptance.

| Verdict | Exit | Meaning |
|---|---|---|
| `NO_BATCH` | 13 | No `settle-afl-api.ts` batch retained since the given instant: the run did not happen or refused and rolled back. The database cannot say which; read the unit result and journal. |
| `NO_CONCLUDED_MATCHES` | 10 | A completed batch exists; the feed shows no CONCLUDED match and no canonical `afl_api` match. Expected before the first round concludes; not a failure. |
| `INCOMPLETE_ACQUISITION` | 11 | Feed not proven complete, fewer canonical matches than CONCLUDED, or settled matches lack quarter rows or a side's statistics. |
| `FAILED_PROCESSING` | 12 | A non-completed batch, a refusal or failure counter, AFL Tables batches after the cutover, a failed unit, contradictory counts, or no derived recompute. |
| `MEASURED_CRITERIA_MET` | 0 | Every measurable criterion held. It always lists what it could not measure. The owner accepts. |

- Usage: `node --import tsx tools/v2/c7-observe.ts --season 2027 --since <ISO instant> [--round <code> --expected-concluded <n>] [--unit-result success --unit-exec-status 0] [--dsn-env DATABASE_URL] [--json]` (`--round` requires `--expected-concluded`).
- **First run against production 2026-11-04: `NO_CONCLUDED_MATCHES`, exit 10, the expected pre-season baseline** (2 completed settle batches, 0 CONCLUDED, 0 canonical `afl_api` matches): a baseline, not an acceptance. Qualification: classifier and parser unit tests; the reader's SQL on a real PostgreSQL 16 isolated cluster in a rolled-back transaction (3/3); a `read only` transaction refuses a write ([d31612-linux-qualification-2026-11-02.md](d31612-linux-qualification-2026-11-02.md)).
- **Process guard** `docs/v2/evidence/c5-prep-20261102/c5-proc-guard.sh` (table test 17/17; real-process test PASS on Linux).

## 3. C6 debutant routine and the round-two review (row 1)

Each round from Opening Round, owner-run:

1. After 05:15 AEDT, as `arm`: `systemctl show -p Result,ExecMainStatus,ExecMainExitTimestamp afldb-settle-afl-api.service`.
2. Read-only observation: `c7-observe.ts --season 2027 --since <ISO instant of the first night of the round> --json`.
3. If the unit failed, read the reason with the owner's `sudo journalctl -u afldb-settle-afl-api.service --since yesterday --no-pager` (`arm` is not in `adm` or `systemd-journal`).
4. For each unresolved player: a Super Admin creates the player in the Data Editor, then adjudicates the `CD_I` id at `/admin/player-links/afl-api`.
5. Never start a manual settle (there is no Start control by design); the next 05:00 run applies the correction.

Why a miss costs a night: the settle runs `--apply --auto-apply --require-complete-source`; an unresolved player identity refuses the single settle transaction, so every match of that night waits one night and no row is retained. Acceptance of a night: exit 0 and `unresolvedIdentityPlayer` 0.

**Round-two review (the D-316-5 re-decision).** After round 2's matches have settled the owner reviews, from the retained batches: how many nights were delayed by an unregistered debutant, how many players needed adjudication, and the lead time available. The choice then is to keep manual registration or to commission the per-unit-refusal code change. **To confirm read-only in Opening Round and not assume:** whether a debutant's `CD_I` id is visible in the retained snapshot before the match concludes (if it is, registration can happen before the night rather than after a failure). **Standing note:** 36 converged `canonical_apply_failed` warnings were resolved in ISSUE-333 (O2); any warning that remains in a "requires attention" list from 2027 is new and should be read as such.

## 4. C7 criteria and first-concluded-round acceptance (rows 4 and 6)

Criteria proposed for approval (thresholds are the owner's; **not approved**), with what the observer can measure ([issue316-closeout-and-seasonal-obligations-2026-11-02.md](issue316-closeout-and-seasonal-obligations-2026-11-02.md) section 3.2):

| # | Criterion | Observer |
|---|---|---|
| 1 | Each night of the first round's week the scheduled unit ended `Result=success`, `ExecMainStatus=0` | Only when `--unit-result` and `--unit-exec-status` are supplied (read from systemd by the owner) |
| 2 | Every CONCLUDED match in the round has exactly one canonical `matches` row owned by `afl_api`, count equal to the retained feed's CONCLUDED count | Measured (`--round`, `--expected-concluded`) |
| 3 | Period scores exist for each such match; no period-score refusal | Measured |
| 4 | Player statistics exist for both sides of each match | Measured |
| 5 | The derived-data recompute ran | Measured |
| 6 | `unresolvedIdentityPlayer` and `unresolvedIdentityMatch` are 0; no `settle-afl-api.ts` batch is left not completed | Measured |
| 7 | Zero AFL Tables requests: register `retired`, timer disabled, no new AFL Tables snapshot label, no AFL Tables unit run | Batches measured; the register, timer and snapshot label are host-side and returned as not measured |
| 8 | The ISSUE-274/275 code paths were exercised on `afl_api` rows, and public season pages show the round within the window chosen in D-316-10 | **Not measurable by a database read**; cannot be checked until a window exists (section 5) |

**Acceptance procedure (future; not performed).** After the first round concludes: run the observer with `--round` and `--expected-concluded`, supply the unit result for each night, record the host-side parts of 1 and 7 from systemd and the register, check 8 by the public reads in section 5, and put all of it in front of the owner. `MEASURED_CRITERIA_MET` is evidence, not acceptance; acceptance is the owner's recorded act against the criteria they approved. Any other verdict is a finding to investigate, not something to retry around. If the criteria are not approved by 2027-03-17 the acceptance has no basis, and the record must say so rather than substitute the proposed set.

## 5. ISR and revalidation (row 5, and criterion 8)

- **Observed:** public pages answer `Cache-Control: s-maxage=3600, stale-while-revalidate=31532400` with `x-nextjs-cache` `HIT`/`STALE`/`MISS`; the ISSUE-333 correction was seen on the five public pages under the owner's amended criterion.
- **Unmeasured, and not to be claimed:** time to visibility for a changed row, regeneration timing, per-worker ISR cache behaviour (ISSUE-134: the caches are per worker) and stale-while-revalidate behaviour. The header is an observation, not a bound, so "accept ISR lag" accepts an **unmeasured, unbounded delay**, not "about an hour".
- **How the window is measured at the first concluded round** (prepared, bounded, read-only; nothing runs without the owner): production public pages are beta-gated, so a public read needs an owner-authorised, short-lived admission cookie. Use the bounded pattern of `docs/v2/evidence/issue333-o2-20261104/scripts/visibility-beta-probe-r2.mts` (read-only GETs, at most 10, at least 5 s apart, a 2-minute deadline, no forced revalidation, no secret printed or stored) against the round's season page and one match page, starting at the observer's `completed_at` for the batch that settled the round and repeated at the owner's chosen times. Record, for each read: start time, response `Date`, `x-nextjs-cache`, `age` and whether the new round is present. Only that record can set the window for criterion 8; until it exists criterion 8 stays "not measured".
- **Decision (D-316-10):** (a) accept the lag and record the measured window once known; or (b) give the nightly units `AFLDB_REVALIDATE_SECRET`, which puts a secret in an unattended unit and, because revalidation reaches one worker's cache, still would not prove cluster-wide invalidation. The choice is the owner's and must be made before the first concluded round even though the window can only be measured after it.

## 6. Ownership baseline and rollover (row 7)

- **Why it binds:** two guards refuse by design once 2027 completes: the D-233-3 census (`src/lib/rollover/afl-api-ownership-census.ts`, `tools/db/afl-api-ownership-census.ts`, consumed by `tools/db/rebuild-test.ts`, `tools/db/promotion-check.ts`, `tools/db/rollover-season.ts`) refuses a rebuild, rollover or promotion check for a completed season holding `afl_api`-owned matches, with no override; and `tools/db/rollover-season.ts` refuses a rollover after AFL Tables is retired (`src/lib/rollover/afltables-network-retirement.ts`).
- **Options (proposals only; none chosen):** **A** replay retained AFL API snapshots as the baseline during rebuild and promotion (rebuild comes to depend on retained snapshots); **B** a one-time sealed-season ownership conversion with an audit trail (changes `source_id` values and loses AFL Tables provenance); **C** an explicit sealed `afl_api` ownership marker the census recognises (no data rewrite, reversible; recommended as smallest to build and rehearse).
- **Acceptance if approved:** the census no longer refuses a completed season whose ownership is the declared `afl_api` baseline; the 2027 rollover runs end to end on an isolated rehearsal; the existing refusals stay in force for undeclared ownership; tests. Out of scope: any production data change and any change to the retirement register.
- **Selection and rollover timing:** the owner chooses by **2027-06-30**, leaving time to build and rehearse; the work is delivered and reviewed before the 2027 rollover (about October 2027). **No baseline is selected and no ownership policy is implemented**; that needs an issue opened on the owner's approval of the proposal. Nothing is built before then.

## 7. Brownlow successor and the count-window gates (row 8)

- **Preserved state (last observed 2026-11-04):** the Brownlow timer is disabled and inactive; `AFLDB_AFL_API_BROWNLOW_ENABLED` is absent from `.env`; there is no Brownlow switch row (admin control Disabled, deployment gate Disabled). **No Brownlow activation is authorised.** The match switch is now enabled and the Brownlow chain's first two steps read it, so once the Brownlow timer is ever enabled only its own two gates stand between it and writing.
- **Successor (D-316-7):** "Brownlow season totals without AFL Tables profile paths" (successor of ISSUE-232). Recommended opening: June 2027; decision before **2027-09-01**; scope and acceptance are to be drafted from ISSUE-232 section 7 E when the owner approves opening it. Nothing is built before then.
- **Count window (C8), the owner's act, in this order only:** open = (a) match switch on, (b) Brownlow admin switch on, (c) only then `AFLDB_AFL_API_BROWNLOW_ENABLED=true` in `.env` and the Brownlow timer enabled by the owner (sudo). Close = (a) remove or clear the environment gate first, (b) then switch the admin control off, then disable the timer. Never enable the timer with the environment gate set and the admin switch off: the chain would write and the unit would fail every 5 minutes.
- The first full-chain firing is the 2027 count, or a rehearsal the owner separately authorises (`blockers.md` R21).

## 8. Not authorised by this record

Any production mutation, provider request outside the enabled timer, manual settle, retry of an apply, Brownlow activation, cleanup of retained batches, deployment, grants, setting or timer change, restart, WSL access or acceptance of any criterion. Reading the retained batches with the observer is the only routine action, and it is read-only.
