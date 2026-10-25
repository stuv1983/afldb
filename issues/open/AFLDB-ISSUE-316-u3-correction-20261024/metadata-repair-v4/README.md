# ISSUE-316 U3 metadata repair v4

Derived narrowly from frozen v3; v2/v3 must not execute. F-005 is **Resolved by
owner scope clarification, subject to v4 proving detection and isolation under
the revised contract.** U3 remains unconfirmed until execution and clean postcheck.
U4 Route B; Brownlow untouched; overall production NO-GO.

## Exact write and binding contract

The unchanged repair-body.sql makes exactly two logical metadata writes: guarded
NULL-to-note UPDATE of data_edits 94.note, then one linked audit INSERT. Note is
967 UTF-8 bytes/characters; SHA-256
3d2d25ea4919dcdc1cfd8fcaa1b2ede6941e10ab0d07404fa0e2279fcc33621d.
No optional relation is created, dropped or referenced by these writes; correctness
does not depend on optional absence. Authority93, original audit fields/other rows
and all existing protected canonical/derived/Brownlow data remain immutable.

binding.json retains every audit94/authority93 column, exact timestamps, actor 1 /
stuart.villanti@gmail.com / super_admin. ACTOR-EVIDENCE.json binds the earlier live
account evidence. OWNER-RULING.md adds the current instruction to prior authority;
its exact new hash/reference is checked literally and bound in the audit. No actor
or approval number is invented. Identity, actor, approval, note hash, full target,
authority, schema/constraints/triggers/rules/RLS/privileges and canonical/baseline
guards repeat inside the locked transaction. No form submission or Match Sheet Save.

## Operational gate

The owner authorises no migration/deployment/apply/schema work during this repair.
Immediately before psql, operational-host.sh checks afldb-prod/arm identity, known
migration/deployment/apply processes and relevant queued systemd jobs. It prints
only PID/process names, never command arguments. Inside read-only preflight,
operational-guard.sql refuses known DDL, idle open transactions, incompatible
schema-related locks and prepared transactions on the target database.
migration-guard.sql requires exactly 110 expected migration names and checksums
(bounded raw/LF/CRLF representations). Expected version 110 is established by
docs/v2/issue316-production-readiness-decision-2026-10-24.md section 7; this is not
a fresh production observation. A different version refuses, never migrates.

These are bounded read-only stop/go observations, not future-DDL exclusion or proof
of another person's uncommunicated intentions. Detection means do not execute.
The migration ledger is SHARE locked before the first repair read, rechecked and
fingerprinted. No schema/deployment work is authorised by this package.

## Locks, optional observations and postcommit

Read-only preflight records presence and schema state of both named optional
Brownlow relations. BEGIN SERIALIZABLE, literal settings and complete plain locks
precede the first repair SQL read. data_edits uses SHARE ROW EXCLUSIVE; auth_users,
all 25 inherited required relations, preflight-present optional relations and the
migration ledger use SHARE. Both catalog locks are removed. Two-second per-lock,
ten-minute statement and two-minute idle transaction timeouts remain.

Preflight optional booleans select only plain locks. After locks, independent
held-lock coverage checks every currently existing optional relation before data
reads. Newly appeared/unlocked relations refuse. Current optional presence/schema
is recorded inside the transaction, and preflight-to-locked-state equality plus
final assertions detect earlier changes. Existing writers wait/are detected before
writes; writers arriving after locks are excluded until the transaction ends.
No claim makes absent optional relations globally immutable through COMMIT.

All existing protected tables retain full logical row fingerprints, NULLs and
multiplicity. This is the inherited preservation proof, not a production source/
eligibility census. Actor fingerprints use safe identity fields only. Optional
schema observations include relation identity/kind, columns, defaults, indexes,
triggers, rules and constraints; volatile relation statistics are excluded.

Fresh REPEATABLE READ READ ONLY postcheck independently verifies exact note/hash,
target's other fields, exact linked audit/actor/approval/review binding, all other
audit rows, authority93 and every pre-existing protected relation's data. A newly
appeared unrelated optional table is observed for schema, without reading its rows.

Only successful assertions, unchanged environment, ordered markers and exit 0 give
PASS and u3_confirmable=true. Then confirm U3 under previously approved wording:
**2026 is complete, and no further 2026 AFL API settle is needed or will be done only
through an audited correction.** Proceed only to the next readiness decision.

If optional schema/presence differs while metadata/existing-data assertions pass,
postcheck emits CONCURRENT_SCHEMA_DRIFT and u3_confirmable=false, with no clean
verification marker. Wrapper records metadata_verified=true and returns for owner
adjudication. U3 stays unconfirmed; no retry or reversal. Late unrelated CREATE
does not make the exact committed repair corrupt or its two writes non-atomic.
An existing protected-data/audit/canonical failure or ambiguous transport/COMMIT
is STOP_NO_RETRY. Missing acknowledgement never proves rollback. A failed INSERT
may consume a sequence value; never reset it or delete audit history.

## Current validation-only standing

The owner's 2026-10-25 transfer approval authorises synthetic validation on
arm@10.0.40.100 (streamanator), evidence retention, final freeze and fresh review.
It does not authorise a production connection/preflight or repair in this task.
U3 remains unconfirmed; U4 Route B; Brownlow untouched; production NO-GO.

## Freeze and execution

MANIFEST.json binds every retained executable/input/validation artifact. Review
and report are separately pinned to avoid circular hashes. run.cjs requires exact
manifest/runtime bytes and independent GO with zero stopping findings. Exclusive
ATTEMPT.json is created before SSH; it forbids any second launch, even after failure.
Only after validated, frozen, fresh exact-byte review GO:

```
node issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v4/run.cjs verify REVIEWED_MANIFEST_HASH
node issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v4/run.cjs execute REVIEWED_MANIFEST_HASH REVIEWED_DECISION_HASH
```

Use literal reviewer pins, never regenerate a manifest to pass an old GO. Fixed
SSH afldb / arm / sudo postgres / afldb_prod; SQL as stdin to psql -X with cleared
environment and ON_ERROR_STOP. DB OID66668/systemID7674454702926115004 remain bound.
No DSN/application env/grants/remote package installation. Remote installed system
platform remains trusted infrastructure, as in v3. Submitted SQL, stdout/stderr,
outcome and hashes are retained under execution/. No executable edits after GO.

## Validation and limits

validate-order.cjs checks exact prefix/inventory/modes/markers. validate.cjs retains
16 PGlite semantic/rollback cases; production identity separately must refuse the
fixture. validate-wrapper.cjs mocks transport in memory, including clean/drift/failure
outcomes and no retry/reversal. Neither PGlite nor mocks prove concurrency.

validate-remote.cjs transfers synthetic validation/package inputs to streamanator
and runs validate-pg.cjs on a fresh private Unix-socket PostgreSQL16 cluster, no TCP,
dedicated _test database. No shared DEV/test/prod connection, rebuild or run.cjs.
Transfer uses an explicit 19-member synthetic-dependency allowlist; run.cjs,
production host tooling and unrelated retained evidence are excluded. Inventory
and SHA-256 values are retained at both ends. Data/logs remain and cluster stops
in finally; cleanup verifies status, PID absence, empty socket directory and no
remaining private PostgreSQL process. Inherited tests remain except the
withdrawn absent-creation exclusion is replaced by the owner's timing outcomes.
Test-only synchronization splits exact expanded SQL after all assertions before
COMMIT, creates an optional table in another session, then commits repair and runs
the real postcheck: exact repair/authority/existing-data assertions pass but drift
blocks U3. Earlier visible DDL still rolls both writes back. Production SQL has no
test hook, wait or identity override.

Real PostgreSQL 16.15 validation passed on streamanator at
2026-10-24T19:52:50Z (2026-10-25 Sydney): 10 database cases plus static ordering.
Both early-DDL rollback and optional CREATE after every final assertion before
COMMIT passed, including exact repair, immutable authority/existing protected
data and CONCURRENT_SCHEMA_DRIFT. Cleanup PASS at 19:52:51Z; stopped data/logs
retained. VALIDATION-EVIDENCE.json pins the external evidence and transfer hashes.
Harness-only changes narrowed transport and strengthened evidence/cleanup;
every SQL file and all database-test assertions remain unchanged from the candidate.

Fresh review must verify F-001 through F-004 closed and this clarification exactly.
CRIT/HIGH STOP; MED affecting actual atomicity/isolation, existing-data safety,
actor/audit integrity or rollback STOP. Global exclusion of unrelated absent-table
creation alone is not a blocker where required drift detection works.

No census, seal/rollover, successor activation, production apply, deployment,
rebuild or push. Production remains NO-GO regardless of metadata-only success.
