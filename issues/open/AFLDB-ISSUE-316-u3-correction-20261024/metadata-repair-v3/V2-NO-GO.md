# ISSUE-316 metadata repair v2 — independent execution-gate review

<!-- DOC: Independent review of the frozen ISSUE-316 metadata-only repair package. -->
<!-- DOC: Reviewer /root/metadata_review_v2; 2026-10-24; report and decision only. -->

**NO-GO: one stopping MED finding, F-004. No production connection or write occurred.**

Reviewer: fresh independent agent `/root/metadata_review_v2`, role `afldb-reviewer`.
Duty: HIGH-risk execution-gate escalation / second review of the executable package,
including independent disposition of prior F-001, F-002 and F-003. No expected verdict
was assumed. Only this report and `REVIEW.json` were authored; every executable and
input remains frozen. No recursive agents, Git, deployment or application actions.

## F-004 — MED, stopping: preservation locks follow snapshot acquisition

Locations: `repair.sql:2`, `repair.sql:5`, `repair.sql:8`, `repair.sql:17`;
`identity.sql:2`, `identity.sql:6`; `locks.sql:2`; `assert-post.sql:28`.

The SERIALIZABLE transaction executes `identity.sql` before acquiring the audit and
protected-table locks. Its DO block/catalog reads establish the transaction snapshot.
Acquiring SHARE locks afterward does not refresh that snapshot. Consequently the
comment in `locks.sql:2-3` that locking precedes the snapshot's first data read does
not hold for the assembled executable.

Concrete failure interleaving:

1. Read-only preflight retains protected fingerprints for state S0.
2. Repair starts SERIALIZABLE and runs its identity block, establishing snapshot S0.
3. Another transaction updates an existing protected Brownlow row and commits S1
   before the repair obtains that relation's SHARE lock. The writer need not read
   or write any audit row. A lock obtained immediately after the commit succeeds.
4. Repair obtains its locks, but its canonical queries and fingerprints still read
   S0. The comparison with the preflight passes. It fills note 94 and inserts its
   linked audit; its precommit protected comparison also sees S0 and passes.
5. The metadata transaction can commit. A one-way serializable dependency from
   repair to the writer is not by itself an SSI cycle that requires an abort.
6. Fresh postcheck reads S1 and refuses the protected fingerprint comparison,
   after the metadata repair has already committed.

This is not a claim that this SQL writes Brownlow or that the note/audit INSERT
ceases to be atomic. Failed precommit checks and INSERT failures still roll both
metadata writes back. The failure is that protected drift occurring before lock
acquisition can bypass the intended precommit isolation gate and be detected only
after commit. It leaves a committed repair requiring owner adjudication where the
package claims preflight-to-repair drift will refuse before committing. The owner's
stopping rule explicitly includes MED affecting isolation/protected-data safety.

The existing drift fixture (`validate.cjs:108-110`) commits its change before repair
BEGIN. It therefore does not exercise this interleaving. The simultaneous-session
interleaving was derived from the executable ordering and PostgreSQL snapshot/SSI
semantics; it was not reproduced with two live PostgreSQL sessions in this review.
PGlite's single-backend fixture evidence must not be presented as that reproduction.

### Smallest correction plan — for owner adjudication, not applied

- In a new reviewed package, change `repair.sql` / `locks.sql` so the data used by
  the full-row, canonical and preservation checks is acquired after all relevant
  locks. Do not merely move the identity include past the existing dynamic DO:
  that DO can itself establish a SERIALIZABLE snapshot before completing its locks.
  One bounded option is READ COMMITTED with the existing held audit/protected and
  actor locks acquired before all guarded reads; alternatively demonstrate an
  ordering that truly takes every required lock before SERIALIZABLE snapshot
  acquisition. Preserve the production identity checks and all comparison guards.
- Extend disposable validation with a two-session PostgreSQL interleaving case;
  update the affected README claim and validation evidence. Its smallest acceptance
  is: pause repair after its first snapshot-acquiring statement, commit a protected
  Brownlow-row change in session B, then resume repair. Required outcome: refusal
  before metadata COMMIT, note 94 still NULL, and no repair-audit row. If locks were
  already acquired, B must instead be blocked/refused until A completes. There must
  be no successful metadata commit followed only by postcheck detection.
- Exact minimal database-semantic reproducer for that new disposable two-session
  test (not production; use a dedicated `_test` database): create and seed an isolated
  `i316_snapshot_review(k integer PRIMARY KEY, v integer)` row `(1,0)`. Session A:
  `BEGIN ISOLATION LEVEL SERIALIZABLE; SELECT count(*) FROM pg_catalog.pg_database;`.
  Session B: `UPDATE i316_snapshot_review SET v=1 WHERE k=1;` and commit. Session A:
  `LOCK TABLE i316_snapshot_review IN SHARE MODE; SELECT v FROM i316_snapshot_review
  WHERE k=1; COMMIT;`. The old value demonstrates why later SHARE locks cannot fix
  the snapshot. The package-level test must additionally assert rollback of the
  note and audit, rather than stopping at this minimal semantic demonstration.
- Risk of changing isolation/order: removing SERIALIZABLE without preserving all
  locks could weaken concurrency protection. Verify full inventory locking,
  optional-relation handling, actor lock, fresh guards and rollback assertions in
  the replacement package. Rehash and independently re-review it. Do not change
  these frozen inputs, retry execution or substitute a new manifest under this review.

## Prior findings independently adjudicated

| Prior finding | Disposition | Current executable evidence |
|---|---|---|
| F-001 HIGH: missing executable transaction | CLOSED as originally stated | `repair.sql:2-26`, its manifest-bound includes, and `run.cjs:64-71` supply executable guards, transaction, client failure handling and commit path. New F-004 prevents execution approval. |
| F-002 HIGH: unbound INSERT/actor/approval | CLOSED | `binding.json:3-10`, `checks.sql:9-16`, `repair-body.sql:7-27`, and wrapper review/owner hash checks bind account 1, delegated Codex execution, owner approval, old/new values, target 94, authority 93, parent match 17214 and review references. |
| F-003 MED: no executable repair-specific postcheck | CLOSED as originally stated | `postcheck.sql:2-11` and `assert-post.sql:10-31` implement a fresh read-only postcommit comparison of exact note, original target fields, receipt, exactly one new linked audit, all other audit rows, authority and protected fingerprints. F-004 separately identifies detection occurring too late for one precommit race. |

## Verified controls and evidence

- Independently recomputed raw manifest SHA-256:
  `4315cc6b205d948e35a68209cfe32323aa9bcb3abc3fd63831dd151da68f88c0`.
  All 24 members match their manifest hashes; no unmanifested input was present.
  `run.cjs verify` independently returned `PACKAGE_HASHES_PASS`, including actual
  local Node/OpenSSH runtime byte checks and exact note/owner binding checks.
- `note.txt` is exactly 967 UTF-8 bytes and 967 characters; SHA-256
  `3d2d25ea4919dcdc1cfd8fcaa1b2ede6941e10ab0d07404fa0e2279fcc33621d`.
  It equals the retained 968-byte original after removing exactly its one terminal
  LF, with no other normalization. Every edit94/authority93 column matches retained
  investigation JSON after exact six-digit fractional timestamp conversion to UTC.
- Actor evidence hashes independently match `ACTOR-EVIDENCE.json`: metadata
  `65d7d2f9b97c889969388b22de8531d7a9cdb1b3c7c7e83d39da2061df41ba48`;
  browser `db5e97556d912821df2ca0f37d538c8a057b3cd3f6872e77147ac201516fa71a`.
  The retained browser identifies account 1's email/role and attributed original
  edit; owner delegation is explicit. The new audit distinguishes that delegation
  from actual postgres database execution. No fictitious approval identifier appears.
- `identity.sql:4-8` requires afldb_prod, OID 66668, system identifier
  7674454702926115004 and postgres session/current user. The remote wrapper requires
  afldb-prod/arm before sudo. The fixed psql command uses a cleared environment,
  `-X`, ON_ERROR_STOP and finite timeouts; SQL is stdin, not shell source.
- `checks.sql:17-35` guards exact full target/authority rows, SQL NULL note, prior
  repair absence, unexpected triggers/rules/RLS/relation kind, exact audit
  constraints and identity column. Existing role privileges are checked without
  granting privileges. All-value comparisons include original actors/timestamps.
- `canonical-gates.sql:3-13` checks target absence, 10,028 2026 PMS/staging rows,
  Essendon/match 17214 count 23 and both baseline-key differences. These are
  executable production gates, not an assertion that fresh production checks ran.
- Snapshot and lock inventories independently match `protected.json`: all 25
  required relations plus both optional Brownlow relations, including authority,
  canonical/period/derived tables, player spans, import/application history,
  staging baseline/lineup/Brownlow and auth audit history. Actor fingerprints read
  safe identity fields only. Fingerprints preserve NULLs and row multiplicity.
- The only explicit persistent DML is `repair-body.sql:18-24`: one guarded note
  UPDATE and one linked audit INSERT, with cardinality assertions. No exception is
  swallowed. Sequence consumption on rollback is disclosed and is never reset.
  Fresh postcheck checks the repaired note/hash, receipt row, one additional audit
  and no changed/deleted unrelated audit row, authority and protected equality.
- Re-executed all 16 retained disposable PGlite cases successfully. The exact
  `validate.cjs` source ran in a local VM with only its final VALIDATION.json write
  intercepted in memory; the frozen retained evidence was not overwritten.
- Nine additional wrapper cases passed in a local VM with every mutation kept in
  memory and SSH replaced by a stub: GO/complete markers, NO-GO, stopping finding,
  review-pin mismatch, manifest-pin mismatch, second launch, nonzero transport,
  precommit-only output and missing postcheck. No actual SSH process was launched.
  The wrapper refuses retries via exclusive ATTEMPT creation and does not call
  transport for failed review/hash gates. A pass requires exit zero plus preflight,
  commit acknowledgement and postcheck markers.

## Limits and disposition

Reviewed all frozen package members from disk and specifically linked retained
metadata/browser/aggregate/postcheck/derived/note/proposal evidence. Verify-tier
bounded artifact review; no graph/index tools were exposed, so no graph project or
generation was available and no exhaustive repository claim is made. Current live
schema/ACL/state, Linux transport, lock contention, runtime costs and two-session
SSI behavior were not experimentally validated against production. Retained source
and synthetic fixtures do not replace those checks.

F-004 is a stopping isolation finding. `REVIEW.json` therefore says NO-GO with one
stopping finding and must prevent launch. Preserve this package and return for
owner adjudication. There is no approval to execute, modify or retry this package.
U3 remains unconfirmed; U4 remains Route B; Brownlow untouched; overall production
readiness remains NO-GO. The accepted canonical correction is not overturned.

Only `REVIEW.md` and `REVIEW.json` were created. They are deliberately outside the
frozen manifest. The report hash and decision-file hash are recorded separately
to avoid circular hashing.
