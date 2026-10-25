# Retained owner authority — 2026-10-24

Source: the owner's current ISSUE-316 instruction in this Codex conversation, headed
“Accept the independent review NO-GO.” This file is a retained excerpt, not an invented
approval number. Its SHA-256 is the concrete approval reference in binding.json and the
linked audit record. The full instruction remains in the conversation.

> This is an execution-package deficiency. It does not overturn:
>
> - the accepted canonical Fiorini correction;
> - the completed canonical/derived read-only verification;
> - the adjudication that audit row 94 is missing only its required note;
> - U4 Route B.
>
> U3 remains unconfirmed.

> Codex is authorised to create, locally and without touching production, a new exact metadata-repair execution package.

> The repair transaction may perform only the two previously approved logical changes:
>
> 1. populate the currently NULL note of `data_edits.id = 94` with the exact retained owner-approved text;
> 2. append one linked audit record documenting that metadata repair.

> Do not invent an audit actor or approval identifier.

> If the second independent review returns GO with no stopping finding, and the exact reviewed artefact hashes still match, Codex is authorised to continue without another owner round-trip.
>
> Sequence:
>
> 1. verify package hashes;
> 2. run production read-only preflight;
> 3. if every gate passes, execute the exact reviewed metadata-only transaction once;
> 4. run the exact reviewed post-check;
> 5. retain all evidence and hashes;
> 6. update ISSUE-316 tracking.

> Do not edit the SQL after review. Any executable change invalidates the GO and requires re-review.

> If execution is ambiguous, fails, rolls back unexpectedly, or any postcondition fails:
>
> - do not retry;
> - do not improvise;
> - preserve state/evidence;
> - return for owner adjudication.

Stopping rule: any CRIT/HIGH, or any MED affecting target isolation, actor/approval
attribution, atomicity, rollback, audit integrity or protected-data safety, stops.

No census, seal/rollover, successor activation, production apply, deployment, rebuild or
push. U4 Route B. Brownlow untouched. Overall production readiness remains NO-GO.

## Current F-004 ruling — 2026-10-24

Retained excerpt from the current owner instruction headed “Accept F-004 as a valid stopping MED finding.”

> Do not execute the frozen metadata-repair-v2 package.
> Create a new metadata-repair package revision derived from the frozen v2 package.
> The permitted implementation change is narrowly scoped to transaction/lock ordering and the tests/evidence needed to prove it.
> Do not broaden the metadata write set.
> The logical repair remains exactly: fill data_edits.id = 94.note with the already authorised 967-character value; append exactly one linked metadata-repair audit record.
> Authority 93 and all canonical/derived data remain immutable under this repair.
> BEGIN SERIALIZABLE; transaction-local non-reading settings; complete deterministic protected locks; only then identity/schema/guards/before-state; exact two writes; locked assertions; COMMIT; independent read-only postcommit verification.
> If the new review returns GO with no stopping finding: verify the reviewed package hashes; run the production read-only preflight; execute the exact reviewed package once if preflight passes; run the exact postcheck; retain evidence; confirm U3 if all required postconditions pass. No further owner approval is needed for those steps.
> Do not execute if any reviewed executable byte changes after GO.
> If a production guard fails, execution is ambiguous, the transaction does not commit cleanly, or any postcondition fails: do not retry; preserve the observed state; return for owner adjudication.
> CRIT/HIGH STOP; MED affecting isolation, atomicity, audit integrity, target scope, rollback or canonical-data safety STOP.
> U4 remains Route B. Brownlow remains untouched. Production remains NO-GO. No census, successor activation, production apply, deployment, rebuild, seal/rollover execution or push is authorised.

This excerpt supplements the prior authority above; the complete current instruction remains in the conversation.

## Current F-005 owner scope clarification — 2026-10-25

Retained current owner instruction; full instruction remains in the conversation.

> Accept F-005 as a valid finding against the v3 proof contract.
> Do not execute frozen v3. Keep v2 and v3 frozen.
> Resolved by owner scope clarification, subject to v4 proving detection and isolation under the revised contract.
> The metadata repair owns exactly the guarded NULL-to-approved-note change of data_edits.id = 94.note and creation of exactly one linked metadata-repair audit record.
> Its proof covers those two writes, audit row 94, authority 93, every existing protected canonical/derived/Brownlow relation, all existing relations read/depended upon, and relations whose modification could invalidate the guards.
> It does not own non-existence of an unrelated optional table absent when repair begins. Do not claim catalog locks prevent all concurrent CREATE operations or add broad locks for that purpose.
> Record optional existence at preflight and inside the locked transaction. Lock/protect existing optional relations before protected reads; record absent ones without requiring global immutability. The repair must not create/drop them, reference them in its writes, or depend on absence for correctness.
> Immediately before execution, read-only operational checks must show no authorised migration/deployment/apply, no known active production DDL, and the expected pre-repair migration/schema version. Schema work means do not execute.
> Postcommit optional presence/schema drift is CONCURRENT_SCHEMA_DRIFT. Independently verify the exact two writes and protected existing data. Do not retry or reverse; keep U3 unconfirmed and return for owner adjudication. Unrelated CREATE beyond final assertions is not an isolation failure of the two writes.
> Retain inherited v3 validation, real PostgreSQL early-DDL rollback and final-assertion/pre-COMMIT optional CREATE synchronization, exact two-write/authority/protected-state proofs, drift detection, no false U3 PASS and no automatic retry/reversal.
> Freeze v4; fresh-context exact-byte independent review must close F-001 through F-004 and implement this clarification. CRIT/HIGH STOP; MED affecting actual atomicity, isolation, existing data, actor/audit integrity or rollback STOP. Inability to globally exclude unrelated absent-table creation alone is not a blocker if drift detection works.
> If validation passes and review GO with no stopping finding: verify exact reviewed hashes, production read-only preflight with no active authorised migration/deployment/DDL, execute exact repair once, exact postcheck. Clean state confirms U3 under previously approved wording and proceeds to next readiness decision. Drift only keeps U3 unconfirmed, no retry/reversal. Any protected/canonical/audit failure stops for owner adjudication.
> No census, seal/rollover, successor activation, production apply, deployment, rebuild or push. U4 Route B; Brownlow untouched; production NO-GO.

## Current v5 transport/principal ruling — 2026-10-25

Retained current owner instruction headed “Accept the unprivileged operational observation as PASS.”
It was given to Claude Code in this session. Its text names “Codex” as the executing agent; Claude Code
is the agent executing it here. The audit record names the actual execution operator. The full instruction
remains in the conversation.

> Accept the unprivileged operational observation as PASS.
> Accept that frozen v4 cannot safely be invoked on production under the current host privilege model.
> Do not create or modify a sudoers / NOPASSWD rule for this repair. Do not invoke frozen v4.
> The v4 production execution attempt remains unconsumed.
> The blocker is now classified as a production transport/privilege-binding defect, not a database-repair or operational-readiness failure.
> The following remain valid: v4 SQL semantics; v4 real-PostgreSQL validation; v4 independent-review GO; F-001 through F-005 closure; the accepted canonical Fiorini correction; the completed canonical/derived verification; the passed replacement operational observation.
> F-006 is also now concretely demonstrated: the frozen internal `sudo -n ps | ...` host check can fail open; the separately reviewed replacement observation compensates for that operational check; however, the frozen production execution path independently requires `sudo -n -u postgres`, which cannot be compensated for externally.
> Do not: add a NOPASSWD sudo rule; edit sudoers; grant `arm` PostgreSQL superuser/owner privileges; expose a postgres password; add a new production database credential; weaken peer authentication; change PostgreSQL authentication merely for ISSUE-316.
> Create a separately named and separately hash-bound metadata-repair-v5 package. V2, v3 and v4 remain frozen evidence and must not be edited.
> V5 should preserve the already reviewed metadata-repair semantics as closely as possible. The permitted substantive change is the execution transport / database principal binding, plus controls directly required by that change. Do not redesign the actual repair.
> The logical write set remains exactly: 1. `data_edits.id = 94.note` NULL → exact approved 967-character note; 2. exactly one linked metadata-repair audit record.
> Required note SHA-256 remains: `3d2d25ea4919dcdc1cfd8fcaa1b2ede6941e10ab0d07404fa0e2279fcc33621d`. Authority 93 remains immutable. Canonical/derived/Brownlow data remain immutable.
> Before selecting the v5 database principal, perform a narrowly scoped read-only discovery using existing access only. Do not print or retain credentials. Do not test write capability by writing production data. Use catalog privilege functions / ACL inspection and existing configuration evidence.
> Prefer an already-existing least-privileged role that currently has exactly the capabilities needed by the normal audited admin application path. Do not select `postgres` merely because v4 used it. Do not use a broader role if an existing narrower role is available. If no existing suitable role exists, STOP. Return for owner adjudication. Do not create a role or grant privileges automatically.
> Replace the v4 requirement `session_user = postgres` with an exact binding to the selected existing production principal. Bind enough facts to prevent substitution, including as applicable: `current_database() = afldb_prod`; database OID `66668`; system identifier `7674454702926115004`; exact `session_user`; exact `current_user`; expected role membership/non-membership; expected relevant table privileges; expected ownership state; expected migration/schema state. The package must refuse if those facts change. Do not implement generic “any role with UPDATE privilege” acceptance. The principal must be explicitly pinned.
> Use an existing credential/connection mechanism already authorised for that principal. The credential must not appear: in command-line arguments; process listings; retained logs; package files; evidence manifests. Prefer the project's established protected credential mechanism. Do not invent a temporary plaintext DSN.
> The single production execution attempt should not be consumed merely because local transport prerequisites fail before a database transaction can be submitted. Require: 1. package/review pins verified; 2. operational observation PASS; 3. transport prerequisites validated without writing; 4. database identity connection established; 5. read-only production preflight PASS; 6. immediately before invoking the write-capable transaction, persist the single-use execution marker; 7. invoke the reviewed transaction once. Once the write transaction is invoked, the attempt is consumed regardless of its outcome. Do not permit automatic retry after that boundary. This change must itself be reviewed.
> Retain the new unprivileged observation approach for v5. Do not restore the frozen v4 `sudo -n ps` pipeline. The observation must remain: no sudo; producer exit status checked separately; full process visibility validated; database activity observed read-only; deployment/service state checked; fail closed on inadequate visibility. Run a fresh observation immediately before the eventual v5 production execution.
> Run all inherited v4 validation against v5: all metadata SQL/failure cases remain green; real PostgreSQL concurrency/F-004 tests remain green; F-005 `CONCURRENT_SCHEMA_DRIFT` behaviour remains green; audit INSERT failure rolls back the note update; repeat execution refuses; exact actor/approval binding remains correct; protected canonical/Brownlow data remain unchanged.
> Add transport-specific tests proving: 1. expected pinned role accepted; 2. wrong session user refused; 3. wrong current user refused; 4. unexpected privilege/ownership state refused; 5. missing credential/connection prerequisite stops before attempt consumption; 6. transport failure before write invocation does not consume the attempt; 7. after write invocation, a failure does consume the attempt; 8. credential values never enter argv/log/evidence. Use a fresh private PostgreSQL cluster for real transport/role semantics where necessary. No shared DEV/test/prod database.
> Freeze the exact v5 bytes and commission a fresh-context review. The reviewer must explicitly compare v4 → v5 and confirm that the change is limited to: transport; principal/identity binding; attempt-marker boundary; replacement operational observation integration; tests/evidence required by those changes. The reviewer must also prove that the two-write SQL semantics and protected-data contract have not been weakened.
> Stopping rule: CRIT/HIGH: STOP; MED affecting credential safety, privilege scope, identity binding, attempt semantics, atomicity, target isolation or protected-data safety: STOP; LOW/INFO may be accepted if they do not broaden scope.
> If a suitable existing production role is identified without grants; v5 validation passes; independent review returns GO with no stopping finding; exact reviewed hashes verify; then continue without another owner approval: 1. fresh unprivileged production operational observation; 2. v5 transport prerequisite check; 3. exact read-only preflight; 4. create the attempt marker at the reviewed boundary; 5. invoke the repair transaction once; 6. run postcommit verification; 7. confirm U3 if clean.
> If any discovery shows that a new role, grant, sudo rule, authentication change or new credential is required, STOP and return for owner adjudication.
> U3 remains unconfirmed. U4 remains Route B. Brownlow remains untouched. No census. No seal/rollover execution. No successor activation. No production apply. No deployment. No rebuild. No push. Production remains NO-GO.
