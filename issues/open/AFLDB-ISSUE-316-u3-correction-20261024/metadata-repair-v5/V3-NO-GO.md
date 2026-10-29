# ISSUE-316 metadata-repair-v3 — independent execution-gate review

<!-- DOC: Independent review of the exact frozen ISSUE-316 metadata-only repair package. -->
<!-- DOC: Reviewer /root/metadata_review_v3; 2026-10-25; report and decision only. -->

**NO-GO: one stopping MED finding, F-005. Do not execute this package.**

Duty: independent execution-gate escalation review of the replacement for frozen v2.
The original F-004 protected-DML snapshot-order failure is closed. A separate DDL
isolation gap stops this revision. The accepted Fiorini correction stands. U3
remains unconfirmed; U4 remains Route B; Brownlow is untouched; overall production
readiness remains NO-GO. No production connection or repair was attempted.

## F-005 — MED, stopping: optional CREATE can commit after the final assertion

Locations: locks.sql:3, locks.sql:31-35, repair.sql:29-33, snapshot.sql:16-22,
validate-pg.cjs:148-159, PG-VALIDATION.json:3.

The catalog SHARE locks do not exclude the commit of an optional-table CREATE
statement that has already finished in another uncommitted transaction. The
package expressly records this limitation, and its retained PostgreSQL test proves
that the other transaction can COMMIT while those locks are held. Catalog lookup
is detection at a point in time; it does not reserve an absent relation against an
already-finished CREATE's later commit.

Concrete failure interleaving, derived from the executable and the retained real
PostgreSQL result (the after-final-assert timing was NOT experimentally reproduced
by this reviewer):

1. Read-only preflight sees public.brownlow_eligibility_decisions absent and records
   that absence. Session B then runs BEGIN and CREATE TABLE for that exact optional
   protected relation, finishes CREATE, and leaves its transaction uncommitted.
2. Session A starts the reviewed SERIALIZABLE repair and acquires pg_class and
   pg_namespace SHARE locks and every selected relation lock. B has already
   released the conflicting catalog relation lock; A need not wait for B's commit.
   The preflight optional flag is false, so A never locks B's relation.
3. While B remains uncommitted, A's held-lock guard and before snapshot see the
   optional relation absent. A performs its two authorised metadata writes. Its
   final snapshot and assert-post finish while B remains uncommitted; protected
   equality passes.
4. After repair.sql:30 finishes, but before A executes COMMIT at line 33, B
   commits. No subsequent catalog/preservation read precedes A's COMMIT and no
   conflicting held relation lock prevents B's commit. A can commit its repaired
   note and linked audit with the protected optional schema changed.
5. The fresh postcheck detects the newly present relation after the metadata
   writes have committed. This leaves a committed repair requiring adjudication,
   instead of the required exclusion or precommit refusal/rollback.

This does not allege a Brownlow DML write by the repair or loss of note/audit
atomicity. It fails the owner's required exclusion of guarded-schema DDL through
COMMIT and affects isolation/protected-data safety. It therefore stops under
OWNER-RULING.md:62-66 and the commissioned DDL-exclusion requirement.

The retained test at validate-pg.cjs:148-159 commits B immediately after A's
before-state/guards and BEFORE repair-body, then expects the later assertion to
fail. Its measured rollback is valid for that timing. It does not exercise B
committing after A's final snapshot/assertion. Its PASS cannot establish exclusion
of all already-executed DDL commits. SEMANTICS.md accurately discloses the limit;
that disclosure is not an owner waiver.

PostgreSQL 16 source independently corroborates the mechanism:
[heap.c, heap_create_with_catalog](https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/catalog/heap.c)
closes the pg_class descriptor with RowExclusiveLock, releasing that catalog lock,
while retaining the newly created relation's own lock to transaction end. This
supports the retained experiment; the later failure schedule above is an inference.

### Required disposition and smallest missing acceptance check

Return F-005 to the owner/orchestrator. Preserve every v3 executable and input.
No safe replacement DDL barrier has been established by this review. Another final
fingerprint, SERIALIZABLE alone, or an advisory lock without proven cooperation is
not an exclusion barrier. A new revision must demonstrate that an already-executed,
still-uncommitted guarded CREATE is drained/refused before metadata writes or
cannot commit through the repair's final COMMIT boundary.

Affected future artifacts are locks.sql / lock-assert.sql / repair.sql as the
selected barrier requires, validate-pg.cjs, and corresponding semantics, evidence
and new manifest. Keep the write body, target/note/actor/approval binding and
protected inventory unchanged. This is a correction plan, not authority to alter
these frozen files or broaden production writes. Stronger global/catalog barriers
can block unrelated DDL or deadlock; retain bounded refusal and prove the selected
barrier on PostgreSQL rather than assuming a stronger lock mode suffices.

The smallest missing regression extends the existing two-session CREATE fixture:
keep B's CREATE uncommitted; run A through its last snapshot and assert-post; attempt
B COMMIT before A COMMIT; then finish A and the independent postcheck. Required:
B cannot change guarded schema inside the repair interval, or A refuses before
metadata COMMIT with note 94 still NULL and no new repair audit. A committed repair
followed only by postcheck detection fails. Test both optional tables and retain
the absent/present, DML, timeout and rollback controls. Rehash and obtain a new
independent execution-gate review. v3 remains NO-GO.

## Prior findings independently adjudicated

| Finding | Disposition | Current source evidence |
|---|---|---|
| F-001 HIGH, missing executable transaction | CLOSED as originally stated | repair.sql, bound includes, run.cjs:64-71 supply the exact transaction and fail-closed client path. |
| F-002 HIGH, unbound actor/INSERT/approval | CLOSED | binding.json:3-10, checks.sql:9-16, repair-body.sql:7-27 bind actor 1, owner hash, Codex delegation, target 94, authority 93, match 17214 and manifest/review references. |
| F-003 MED, missing repair-specific postcheck | CLOSED as originally stated | postcheck.sql:2-12 and assert-post.sql:10-31 independently read exact metadata deltas, unrelated audits, authority and protected fingerprints. F-005 is separate. |
| F-004 MED, SERIALIZABLE snapshot before protected locks | CLOSED as originally stated | repair.sql:2-12 and locks.sql contain only BEGIN, literal non-reading SET LOCAL, plain locks and client controls before identity/guards. Retained real writer-before-lock and writer-after-lock cases exercise fresh drift refusal and DML exclusion. |

The PostgreSQL 16 [LOCK documentation](https://www.postgresql.org/docs/16/sql-lock.html)
requires locking before the first snapshot-setting data read for this SERIALIZABLE
use. Independent inspection of
[pquery.c, PlannedStmtRequiresSnapshot](https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/tcop/pquery.c)
and [analyze.c](https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/parser/analyze.c)
confirms transaction/LOCK/SET utility exemptions and distinguishes v2's DO.
The [lock conflict documentation](https://www.postgresql.org/docs/16/explicit-locking.html)
confirms SHARE versus DML and the self-exclusive writer mode for data_edits.
These sources support closing original F-004, not F-005's absent-object DDL gap.

## Independently verified package facts and checks

- Raw MANIFEST.json SHA-256:
  5bf642882f29731c2db95558ac12779fd97a83ccfacf3cfe36e66700ce54034d.
  All 46 members match. All 24 frozen v2 members match their own manifest.
  No executable was edited.
- The note equals the retained authorised file after removing exactly one framing
  LF: 967 bytes/characters, SHA-256
  3d2d25ea4919dcdc1cfd8fcaa1b2ede6941e10ab0d07404fa0e2279fcc33621d.
  Full edit94/authority93 equal retained investigation JSON after converting only
  the exact six-fractional-digit timestamps from +11:00 to UTC.
- Metadata/browser evidence hashes equal ACTOR-EVIDENCE.json. The browser records
  the existing email, Super admin role and original actor. OWNER-RULING.md supplies
  delegation, not an invented approval number. Live actor/full-row/NULL/approval/
  constraint/trigger/rule/RLS/privilege guards repeat after locks. Historical
  preflight cannot override them.
- Production identity requires afldb_prod, OID 66668, system identifier
  7674454702926115004 and postgres session/current role. The wrapper also requires
  afldb-prod/arm. SQL is psql stdin with -X, ON_ERROR_STOP, cleared remote environment
  and finite timeouts. No grants or automatic retry occur.
- All 25 required and two optional protected relations remain in the deterministic
  lock inventory, with added actor/catalog locks. Modes are SHARE for protected
  tables and SHARE ROW EXCLUSIVE for data_edits. Fingerprints include NULLs,
  multiplicity and every logical row column.
- The only explicit persistent DML is repair-body.sql:18-24: the guarded note UPDATE
  and one linked INSERT. Exceptions propagate. Assertions preserve original audit
  fields except the note, all unrelated audit rows, authority93 and protected data
  before/after COMMIT. Rollback sequence consumption is disclosed and never reset.
- Independently replayed all 16 PGlite cases successfully in a local VM, intercepting
  only the final VALIDATION.json write in memory. Frozen evidence was not replaced.
  PGlite is not concurrency proof.
- Independently executed validate-order's exact-prefix/inventory/marker assertions:
  PASS. Eight ordered runtime markers and preflight/postcheck payload requirements
  are present in run.cjs:75-85.
- Ten wrapper control-flow VM cases passed: ordered success, NO-GO, stopping
  finding, existing ATTEMPT, bad manifest pin, bad review pin, precommit-only output,
  missing postcheck, nonzero transport and marker disorder. Writes stayed in
  memory, transport was stubbed, and runtime-byte reads were simulated; this does
  not independently validate installed runtime binaries. No SSH was launched.
  Exclusive ATTEMPT creation precedes transport; failed review/hash gates never
  call transport. No ATTEMPT/execution artifact was created on disk.
- Retained real PostgreSQL 16.15 evidence has one static and nine database cases.
  Its source tests observable waiting, both DML timings, per-relation INSERT/
  UPDATE/DELETE exclusion, optional absent/present paths, roughly two-second lock
  refusal, failed audit INSERT rollback, repeat refusal and Brownlow/extra-audit
  postcheck detection. The late-DDL limitation is explicit.
- stdout/stderr hashes match PG-TRANSPORT.json; its base64 report is byte-equal to
  PG-VALIDATION.json. Final submitted executable hashes match frozen files. The
  transport record includes its own prior version as historical input. Four
  exploratory failures/timeouts remain retained, not erased or counted as passes.
  Final logs record the private cluster stopped.

## Limits and handback

Verify-tier bounded artifact review. Graph tools were not exposed: no project,
generation or coverage evidence exists; no exhaustive repository claim is made.
Source fallback covered package SQL/wrapper/test sources and linked actor/note/
schema evidence material to this decision. No recursive agents were used.
Retained PostgreSQL scenarios were read and their source/transport bindings checked,
not rerun by this reviewer. The final-gap interleaving is source-derived and
distinct from experimentally observed rollback at the earlier cut point.

No fresh production schema/ACL/state, live transport, runtime binary bytes or
production scan cost was measured. No Git, deployment, rebuild, repair, external
message or production connection occurred. Only REVIEW.md and REVIEW.json were
written. Report/decision hashes are separate to avoid circularity. The orchestrator
must retain this NO-GO and return F-005 for owner adjudication. No production rollout
gate is released.
