# ISSUE-316 metadata repair v4 — isolated validation and freeze

## Current execution disposition — 2026-10-25 Sydney

- **V4 production execution authorised; STOP before preflight (2026-10-25 Sydney; current).**
  Final frozen-byte/review/runtime verification PASS (40 manifest members; eight external evidence pins;
  manifest 829fc30a…848ecf84; decision 39e71a77…04a913a2; report c36dc24a…2374712).
  Separate fail-closed operational observation at 2026-10-24T20:07:59Z confirmed afldb-prod / arm, then
  `sudo -n ps` failed: `sudo: a password is required` (SSH exit 1). No process-clear inference;
  systemd/session checks not reached. No retry/workaround, production DB connection, frozen preflight,
  wrapper/transaction invocation, ATTEMPT.json or production write. Attempt unconsumed. U3 unconfirmed;
  U4 Route B; Brownlow untouched; production NO-GO. Next: owner resolves/adjudicates the failed
  noninteractive read-only observation privilege gate; later resumption repeats all pre-execution gates.
  [Full execution stop evidence](metadata-repair-v4-production-20261024T200631Z/REPORT.md).

The validation-only statements below describe the previous task. The later owner authority
allowed one conditional production execution; its separate operational gate failed before preflight.


**Synthetic PostgreSQL validation and cleanup PASS. Exact v4 frozen; fresh-context
independent review GO, zero stopping findings, one LOW observation retained. No production contact, attempt or
write. U3 unconfirmed; U4 Route B; Brownlow untouched; production NO-GO.**

## Authority and boundary

The owner's current 2026-10-25 instruction explicitly authorises transfer of only
the synthetic v4 validation dependencies to arm@10.0.40.100 (streamanator), a fresh
private PostgreSQL16 cluster, isolated Unix socket/port, synthetic fixture data,
focused concurrency/rollback/drift validation, evidence retention and clean stop.
After success it requires final freeze and fresh-context independent review.
This task authorises no production connection/preflight/repair, shared database,
production credential/environment/service access, census, migration/apply,
seal/rollover, successor activation, deployment, rebuild or push. Historical
conditional production instructions do not expand this validation-only task.

F-005 remains accepted against v3's former contract and is classified **Resolved
by owner scope clarification, subject to v4 proving detection and isolation under
the revised contract.** V2/v3 stay frozen and unexecuted. The accepted Fiorini
correction and completed reconciliation stand. No repair is attempted here.

## Candidate and harness-only preparation

All 39 candidate members verified against candidate manifest
`e840cd79a74ca20f523b0dfab10f9c86407f248f493ca229e12b146d09e0c021`.
All 46 frozen v3 derivation members had been verified in the preceding preparation
(v3 manifest `5bf642882f29731c2db95558ac12779fd97a83ccfacf3cfe36e66700ce54034d`).
The write body and exact 967-character note remain unchanged: one guarded note
UPDATE and one linked audit INSERT, actor/full target/authority bindings retained.
Existing protected relations lock before the working snapshot. No catalog locks
or optional-absence exclusion claim. Optional schema is observed internally and
postcommit; drift blocks U3 without retry/reversal. Operational checks are bounded
observations and the expected migration ledger is 110 entries; no migration runs.

The original remote transport selected broad file suffixes. Before any successful
transfer it was narrowed to an explicit 19-member transitive-dependency allowlist;
run.cjs, production host tooling and unrelated live/retained evidence are excluded.
Both ends retain per-member SHA-256 inventory. Harness evidence collection now
returns report, inventory, server log, cluster-command records and cleanup report.
Cleanup checks exact private pg_ctl status, PID-file absence, postmaster PID absence,
empty private socket directory and no private PostgreSQL processes. Every SQL file
and every database-test assertion is byte-equal to the candidate. No production
executable semantics changed. Original harness/candidate and parent record/checksums
are preserved in [preparation evidence](metadata-repair-v4-validation-preparation-20261024T195111Z/).

## Retained transport history

Earlier v4 failed-transfer records inside the package were preserved without edit;
those attempts never ran a remote bootstrap. The original automatic approval review
rejection is historical and was addressed by the owner's explicit destination and
transfer approval in this turn.

A new default-sandbox attempt was also denied at SSH socket creation (exit 1,
Permission denied), with no remote bootstrap. It remains in
[failed attempt](metadata-repair-v4-validation-rsfO5W/PG-TRANSPORT.json).
The authorised escalated retry exited 0. No test was weakened or skipped.

## Real PostgreSQL evidence

[Successful evidence](metadata-repair-v4-validation-2dLUSk/PG-VALIDATION.json),
[transfer inventory](metadata-repair-v4-validation-2dLUSk/TRANSFER-INVENTORY.json),
[cleanup](metadata-repair-v4-validation-2dLUSk/PG-CLEANUP.json).

- Host/user: streamanator/arm, identity-gated by the bootstrap. PostgreSQL
  16.15 (Ubuntu 16.15-0ubuntu0.24.04.1). Completion 2026-10-24T19:52:50.977Z
  (2026-10-25 Sydney). Remote package `/tmp/i316-f004-package-dtPWjl`.
- Fresh cluster `/tmp/i316-f004-pg-8AEBh2/data`, cluster_name i316-f004-private;
  database i316_f004_test; listen_addresses empty, private Unix socket, port 55864,
  server address NULL. No existing cluster/database was connected to or modified.
- **10/10 database cases plus static ordering PASS**: pre-existing Brownlow writer
  commits while repair waits and fresh guard refuses with zero metadata writes;
  bounded two-second lock timeout; all protected/optional writers and guarded
  existing-table DDL blocked after locks; audit INSERT failure rolls note back;
  exact repair/postcheck and repeated-repair refusal; Brownlow/data drift detection;
  extra-audit detection; early optional DDL detection and rollback; late optional
  CREATE after ALL final assertions before COMMIT; active DDL/version refusal.
- The synchronized late CREATE commits independently, then exact repair commits.
  Fresh postcheck independently asserts exact note/audit, authority93, and existing
  protected state, returns CONCURRENT_SCHEMA_DRIFT, leaves U3 blocked and performs
  no retry/reversal. Repeated read-only observation leaves the two audit rows intact.
- Cleanup PASS at 19:52:51.363Z: private postmaster 884459 exited, pg_ctl reports
  stopped, no postmaster.pid, no socket/lock, remaining private process list empty.
  Stopped data directory and logs remain only as dedicated validation evidence.
- Returned remote inventory equals submitted inventory; all 19 hashes equal current
  frozen package sources. Transport stdout/stderr hashes verified. Server log,
  initdb/start/create/stop command outputs, inventory and reports are retained locally.

Limits: fixture shapes only; production-only identity intentionally excluded and
psql directives expanded for known optional presence. This proves the focused
shared SQL concurrency contract, not live-production schema/transport acceptance.
Retained PGlite19/19, wrapper14/14 and static results predate this turn; unchanged
SQL/wrapper did not require rerun. No application build or broad suite was run.

## Final freeze and independent review

The [40-member final manifest](metadata-repair-v4/MANIFEST.json) SHA-256 is:

`829fc30ae553106baa2281710bb7ba5c9288ccd331c0e846e18ed408848ecf84`

[VALIDATION-EVIDENCE.json](metadata-repair-v4/VALIDATION-EVIDENCE.json) is a manifest
member and pins all eight successful evidence files, including the real late-DDL
timing case, cleanup and transferred file inventory. No frozen member may change
after this point. Review decision/report remain separately pinned to avoid cycles.
A fresh-context afldb-closure independent reviewer was commissioned with no parent
conversation, the exact manifest pin, revised F-005 contract, prior F-001–F-004
reviews, real PostgreSQL evidence and current validation-only limits. Its result
returned **GO, zero stopping findings**. It independently verified package and external
evidence hashes, unchanged SQL, prior-finding dispositions, proof boundaries, isolation
and cleanup. CRIT/HIGH STOP; MED affecting actual atomicity/isolation,
existing-data safety, actor/audit integrity or rollback STOP. Global exclusion of
unrelated absent-table creation alone is not a blocker when detection works.

No production connection/preflight/execution will occur in this validation-only
task even if the package review returns GO. U3 remains unconfirmed. U4 Route B;
Brownlow untouched; overall production remains NO-GO. No Python or tools/migration
file changed; no Git command. Issue remains OPEN. Index, Open Issues row, runbook,
blocker register and Unreleased changelog are synchronised for this milestone.

## Fresh independent review retained

[Exact review](metadata-repair-v4/REVIEW.md): 8,365 UTF-8 bytes, SHA-256
`c36dc24a0d4fac7f5aa5374e7a5b0a6ed7f9442334cad390a4cf078322374712`.
[Decision](metadata-repair-v4/REVIEW.json) SHA-256
`39e71a77aa6e26127369647ab2f09a9c25f53af3567567372dc1d86e04a913a2`.
Both are separately pinned; the reviewed manifest and all 40 members remain unchanged.
F-001 through F-004 are closed as originally stated; F-005 resolved under the revised
owner contract with bounded detection/isolation evidence verified. This GO concerns
the artifact only. It releases no production or readiness gate.

**F-006 LOW, non-stopping, retained in ISSUE-316:** operational-host.sh:7-10 lacks
pipeline failure propagation, so a failing sudo/ps producer followed by successful
awk/systemctl could emit the host-gate PASS without a successful process observation.
Source-derived; not experimentally reproduced. Separate SQL guards/complete relation
locks remain; reviewer established no actual atomicity/isolation/existing-data/actor/
audit/rollback defect. Disposition: retain the LOW observation, no change to frozen
bytes in this validation-only task. Any later executable correction is a new candidate
requiring regenerated hashes and fresh independent review. No separate unrelated
issue or fix is opened; the finding remains tracked here and in the detailed ledger.

Validation/freeze/review milestone complete. Production untouched; U3 unconfirmed;
U4 Route B; Brownlow untouched; production NO-GO. No production next step was run.
