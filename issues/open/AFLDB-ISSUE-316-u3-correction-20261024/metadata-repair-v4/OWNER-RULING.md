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
