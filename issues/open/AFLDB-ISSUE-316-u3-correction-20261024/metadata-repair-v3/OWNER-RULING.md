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
