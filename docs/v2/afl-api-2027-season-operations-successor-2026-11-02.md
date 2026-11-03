# AFL API 2027 season operations: successor of ISSUE-316 (AFLDB-ISSUE-332), 2026-11-02

**Status: OPEN. Prepared obligations, not decisions.** Nothing here is accepted, decided or executed. The owner chose Option A of [issue316-closeout-and-seasonal-obligations-2026-11-02.md](issue316-closeout-and-seasonal-obligations-2026-11-02.md) section 4 on three conditions; this document is condition (c). It **preserves** obligations and gates; it does not manufacture a completed acceptance, choose a C9 design, or authorise Brownlow activation. Ledger entry: `AFLDB-ISSUE-332` in `issues.md`.

**Update 2026-11-04:** the first two nights were observed (both succeeded, empty batches 78 and 82), ISSUE-316 was resolved, and recommendations with a dated gate calendar (every future item marked SCHEDULED) are in [post-release-closeout-2026-11-04.md](post-release-closeout-2026-11-04.md) section 4. The "First night not yet observed" and "closure eligibility UNMET" cells below are historical. Nothing is decided.

## 1. Timeline of gates (AEDT unless stated; the dates are the runbook's, not new commitments)

| When | Obligation | Owner decision needed | State today |
|---|---|---|---|
| **Now, each night** | Retained-batch behaviour of the enabled match timer is recorded as it actually happens (about 130 empty-effect rows expected until Opening Round) | Whether it is acceptable, after the first night | First night **not yet observed** |
| **Before Opening Round (first match 2027-03-17T00:00Z)** | C7 criteria approved in advance (8 proposed, close-out doc 3.2) | Approve or amend | Not approved |
| Before Opening Round | D-316-8 attendance, D-316-9 coaches | Choose | Undecided |
| Before the first concluded round | D-316-10 revalidation vs ISR lag (decides C7 criterion 8) | Choose | Undecided |
| Each round from Opening Round | C6 debutant routine: register each new player and adjudicate their `CD_I` id before the nightly; one miss delays that whole night, nothing is retained | D-316-5: accept manual, or change whole-night rollback to per-unit refusal (code change, not prepared) | Undecided; runbook default (accept manual, review after round 2) noted only |
| After round 2 | D-316-5 review | Re-decide | n/a |
| After the first concluded round (March 2027) | C7 acceptance, by the owner against the approved criteria | Accept or not | Future |
| By June 2027 | C9 / D-316-6: decide among options A (replay retained snapshots), B (sealed ownership conversion), C (sealed marker) | Choose; **no option is chosen** | Open |
| Before September 2027 | D-316-7 Brownlow season totals without AFL Tables profile paths; C8 count window (owner's act) | Choose; **no Brownlow activation authorised** | Open; timer disabled, gate absent |
| Before the 2027 rollover (about October 2027) | C9 delivered and reviewed (the census and `rollover-season.ts` refusals bind when 2027 completes) | n/a | Open |
| n/a | D-316-11 on-demand Start | **Not pursued** | Closed as not pursued |

## 2. Instruments that exist now (implemented, qualified, NOT observed in production)

- **C7 observer** `tools/v2/c7-observe.ts` over `src/lib/acquisition/afl-api-c7-observation.ts`. Read-only (one `read only` transaction, SELECTs, rolled back; no provider request, no unit start). It distinguishes five outcomes and never records an acceptance:

| Verdict | Exit | Meaning |
|---|---|---|
| `NO_BATCH` | 13 | No `settle-afl-api.ts` batch retained since the given instant: the run did not happen or refused and rolled back. The database cannot say which. |
| `NO_CONCLUDED_MATCHES` | 10 | A completed batch exists and the retained feed shows no CONCLUDED match and no canonical `afl_api` match. Expected before the first round concludes; not a failure. |
| `INCOMPLETE_ACQUISITION` | 11 | Feed not proven complete, fewer canonical matches than CONCLUDED, or settled matches missing quarter rows or a side's statistics. |
| `FAILED_PROCESSING` | 12 | A non-completed batch, a refusal or failure counter, AFL Tables batches after the cutover, a failed unit, contradictory counts, or no derived recompute. |
| `MEASURED_CRITERIA_MET` | 0 | The measurable criteria held. It always lists what it could not measure (criterion 8, ISR window; the host-side parts of 1 and 7). The owner accepts. |

- Usage (future; **not run against production, no acceptance simulated**): `node --import tsx tools/v2/c7-observe.ts --season 2027 --since <ISO instant> [--round <code> --expected-concluded <n>] [--unit-result success --unit-exec-status 0] [--dsn-env DATABASE_URL] [--json]`. The DSN is read from the named environment variable and never printed.
- Qualification actually run: classifier and parser unit tests; the reader's SQL against a real PostgreSQL 16 isolated cluster on Linux in a rolled-back transaction (3/3); a `read only` transaction refuses a write. Records: [d31612-linux-qualification-2026-11-02.md](d31612-linux-qualification-2026-11-02.md).
- **Process guard** (`docs/v2/evidence/c5-prep-20261102/c5-proc-guard.sh`): table test 17/17 and the real-process test PASS on Linux (record above).

## 3. ISSUE-316 closure eligibility

| Condition (owner) | State |
|---|---|
| (a) First scheduled run observed and assessed | **UNMET**: fires 2026-11-03 05:00 to 05:15 AEDT; a best-effort session-bound check is scheduled for 05:23; the durable check is `bash /home/arm/c5-observe-20261102-r3.sh first-night 924ff273261834e4112e3f41b61ceeab55427534` as `arm` at or after 05:15 |
| (b) D-316-12 deployed and visually verified | **UNMET**: implemented locally, Linux-qualified, release approval prepared (not granted), live page `VISUAL: UNVERIFIED` |
| (c) One named successor holding C6 to C9 and D-316-5 to D-316-11 with gates | **MET** by this document and `AFLDB-ISSUE-332` |

ISSUE-316 stays **OPEN**. Resolving it as "cutover delivered" with a pointer to AFLDB-ISSUE-332 becomes eligible only when (a) and (b) are met and the owner records it.
