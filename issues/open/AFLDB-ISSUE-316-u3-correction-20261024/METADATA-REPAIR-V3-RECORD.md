# ISSUE-316 metadata repair v3 — F-004 revision

**NO-GO: new F-005 MED stopping DDL-isolation finding. No production connection, attempt or write.**

The owner accepts F-004 as a stopping MED isolation/proof-ordering finding. It does
not imply proposed repair DML changes canonical, derived or Brownlow data. The
original Fiorini canonical correction and completed reconciliation remain accepted.
V2 remains frozen NO-GO evidence and was not executed. U3 remains unconfirmed; U4
Route B; Brownlow untouched; overall production remains NO-GO.

## Exact package

[New package](metadata-repair-v3/README.md), derived from all 24 verified v2 manifest
members. Frozen v3 manifest SHA-256:

`5bf642882f29731c2db95558ac12779fd97a83ccfacf3cfe36e66700ce54034d` (46 members).

The permitted persistent DML is unchanged byte-for-byte in repair-body.sql: exactly
one guarded note UPDATE and one linked audit INSERT. Exact note remains 967 bytes/
characters, SHA-256 3d2d25ea4919dcdc1cfd8fcaa1b2ede6941e10ab0d07404fa0e2279fcc33621d.
Authority93 and original target fields remain fully bound. Current F-004 authority
is appended to OWNER-RULING.md, rehashed into binding.json and checked literally.

The repair BEGINs SERIALIZABLE, emits a client marker, sets five literal local
settings and obtains plain deterministic locks before identity or any guard. The
dynamic DO lock block is removed. Protected inventory remains all 25 required plus
two optional relations. data_edits uses SHARE ROW EXCLUSIVE, protected/actor tables
SHARE. pg_class/pg_namespace SHARE locks additionally block newly started optional
relation/schema DDL; this briefly affects unrelated DDL too, under the same 2s
per-lock timeout. Post-lock held-lock coverage and every material preflight guard
repeat internally. All eight stage markers are required in order by the wrapper.

[Statement semantics and catalog-DDL limit](metadata-repair-v3/SEMANTICS.md) cite
PostgreSQL 16 source and documentation. An already-executed optional CREATE can
commit despite the catalog locks; the measured in-transaction fingerprint assertion
then detects it and rolls back both metadata writes. This is disclosed for
independent adjudication against the DDL exclusion requirement, not waived by tests.

## Validation

- Exact-prefix/static inventory/mode/marker check PASS.
- Original 16 PGlite semantic/atomicity cases PASS against v3; no concurrency claim.
- Real PostgreSQL 16.15 isolated validation: 10/10 case expectations PASS (one static,
  nine real scenarios). Active Brownlow writer observed waiting from a third session,
  then committed: post-lock guard refused and note/audit remained untouched. Separate
  active writer exceeded 2s lock timeout (2,429ms case total), refusing before writes.
- INSERT/UPDATE/DELETE lock probes on every existing protected relation, audit and
  actor locks, guarded relation/schema DDL and absent-optional creation probes refuse
  while repair locks are held. Exact audit INSERT failure rolls note back; second
  execution refuses; Brownlow and extra audit postcheck mutations are detected.
- The pre-existing optional CREATE timing case is explicitly measured and disclosed
  above: in-transaction assertion refusal/metadata rollback, not exclusion of its commit.
- Private cluster /tmp/i316-f004-pg-UpmlC7, i316_f004_test, private Unix socket, no TCP
  listener. Stopped cleanly; synthetic data/logs retained. Remote test package:
  /tmp/i316-f004-package-UaeATe. No shared DEV/test/prod data or rebuild tooling.
- Four preliminary validation attempts are retained. Two hit the harness 120s
  budget with unindexed fixtures; their private clusters were explicitly stopped.
  Fixture-only indexes/statistics and cleanup/error reporting were improved. A third
  exposed the missing assumed catalog wait; a fourth showed the actual precommit
  assertion refusal rather than the hypothesised committed repair. Those two
  clusters stopped via finally. The final runner asserts the observed rollback.
  These exploratory failures never ran the production wrapper.
- Frozen wrapper syntax check PASS and exact-pin verify PACKAGE_HASHES_PASS.

## Review and execution gate

Fresh-context /root/metadata_review_v3 independently returns **NO-GO**, new **F-005
MED stopping**. Original F-004 protected-DML snapshot ordering and prior
F-001/F-002/F-003 remain closed. The reviewer independently rehashed all 46 v3
members and all 24 v2 members, replayed all 16 PGlite cases without overwriting
frozen evidence, checked static ordering and passed 10 mocked wrapper controls.

Derived F-005 interleaving: B executes CREATE for an optional absent relation but
leaves its transaction open. A obtains its locks and completes its final protected
snapshot/assertions while B is invisible. B commits, then A commits. The already-
executed DDL does not retain the catalog lock that A conflicts with; its commit is
not excluded. A has no remaining catalog/data check before COMMIT. The fresh
postcheck may detect the new optional relation only after the metadata commit.
This final-boundary interleaving was derived, not experimentally replayed. The
retained real case proves the underlying commit-through-lock behaviour and only
the earlier timing where in-transaction assertions still roll back the metadata.

This is an isolation/exclusion defect, not evidence that repair DML itself writes
Brownlow/canonical/derived data. No reviewed executable byte changed. No production
preflight, attempt marker, transaction, postcheck, retry or repair occurred.
[Independent report](metadata-repair-v3/REVIEW.md);
[machine gate](metadata-repair-v3/REVIEW.json). Exact independent report SHA-256:
`a96c576e9939fd2d832a03155f965b8fe1ff4faf9033d39a4b2a0c48fa0e52a4`; decision SHA-256:
`c976840f33d8b8be5fcb422efe40fbf111cfc7640d855e681bf9813c3b7f4d1f`.

The owner stopping rule applies. **Next: owner adjudication of F-005.** No further
package revision or production action is inferred. U3 remains unconfirmed.

Only GO with zero stopping findings and unchanged exact hashes activates the
owner-authorised once-only production read-only preflight, repair and postcheck.
Any guard/transport/commit/postcheck failure or ambiguity means STOP_NO_RETRY and
owner adjudication. Overall production rollout is still NO-GO. No census, successor
activation, production rollover/apply, deployment, rebuild or push is authorised.

No Python or tools/migration file changed; no Git command executed.

## Tracking and inventory

ISSUE-316 remains OPEN. Detailed ledger/Open Issues row, IssuesIndex.md, the runbook,
blockers.md and CHANGELOG.md reflect this retained NO-GO. No duplicate issue was
created. [Complete changed-file inventory](SESSION-FILES.metadata-repair-v3.json).
The preceding parent evidence index is preserved as SHA256SUMS.before-metadata-repair-v3.
The refreshed SHA256SUMS covers the new package, review, record and inventory.
