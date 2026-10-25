# ISSUE-316 exact metadata-repair package — second pass

**NO-GO: F-004 MED stops execution. No production connection or write occurred.**

The owner accepted the prior execution-package NO-GO and authorised local construction, disposable validation
and a fresh independent review, with autonomous metadata-only execution conditional on GO. The accepted
canonical Fiorini correction, completed canonical/derived verification and missing-note adjudication stand.
U3 remains unconfirmed; U4 Route B; Brownlow untouched; overall production readiness NO-GO.

## Package and validation

[Package instructions and executable inventory](metadata-repair-v2/README.md). New package contains executable
production preflight, transaction, postcheck and one-attempt wrapper; separately retained exact note; full
audit94/authority93 guards; actual delegated actor and current owner instruction references; protected/audit
fingerprints; hash manifest; schema/convention evidence; prior findings; disposable validation runner/results.

- Frozen MANIFEST.json: `4315cc6b205d948e35a68209cfe32323aa9bcb3abc3fd63831dd151da68f88c0` (24 members).
- Exact stored note input: 967 UTF-8 bytes/characters, SHA-256
  `3d2d25ea4919dcdc1cfd8fcaa1b2ede6941e10ab0d07404fa0e2279fcc33621d`; no trailing newline.
- Local disposable PGlite validation: **16/16 PASS**. Exact shared SQL, excluding the separately refused
  production-only identity artifact, ran against synthetic protected relation shapes and the target audit schema.
  Includes happy path, non-NULL/wrong/missing target, failed audit INSERT rolling note update back, wrong
  actor/approval, repeat refusal, authority/input/canonical drift and changed Brownlow/extra audit detection.
- Wrapper syntax check: exit 0. Correct manifest pin: PACKAGE_HASHES_PASS. Substituted all-zero pin: refused.
- These checks do **not** prove the newly identified concurrent-writer interleaving. No Linux/live-schema/transport
  acceptance is claimed. No dependency installation or production access was needed.

## Independent second pass

Fresh-context reviewer `/root/metadata_review_v2`, role afldb-reviewer, received exact executables/inputs,
schema/audit definitions, prior NO-GO findings and manifest pin.
[Independent report](metadata-repair-v2/REVIEW.md); [machine-readable gate](metadata-repair-v2/REVIEW.json).
The reviewer independently rehashed all 24 members and note/evidence bindings, replayed all 16 local cases
without modifying frozen validation output, and passed nine additional in-memory mocked wrapper cases (no SSH).
Prior F-001/F-002/F-003 are closed as originally stated; F-004 is the new stopping isolation defect.

- REVIEW.md SHA-256: `3eaacf8ea63c6580730229d6e89c808fb7f7de135a3dfe2027d6f2dc6235543c`.
- REVIEW.json SHA-256: `54a1c52d8a9683a8639dcc367ccec852e81362e5f3ad28cfa5daa0872a193571`.

**New F-004 MED:** repair.sql runs identity.sql before locks.sql. The SERIALIZABLE snapshot can therefore
precede the protected-table SHARE locks. A separate writer may commit a protected/Brownlow row change in
that interval; the repair compares its older snapshot with preflight, commits the two metadata writes, then
the fresh read-only postcheck detects the protected drift. No serialization cycle is required. This is a
precommit isolation-gate defect, not evidence that the repair itself writes Brownlow/canonical data.
The existing before-BEGIN drift fixture does not exercise this concurrent interleaving.

The owner explicitly stops any MED affecting target isolation or protected-data safety. The GO condition
was not met; the autonomous production execution authority therefore did not activate. Frozen executables
remain unchanged. No attempt marker, production preflight, transaction, postcheck, retry or repair occurred.
No canonical state, authority93, Brownlow state or application/Git/deployment state was changed.

**Next: owner adjudication of F-004.** A further local ordering/isolation correction and concurrency-focused
validation would require a newly hash-bound package and independent review. No such change/re-review or
production action is inferred from this stopping verdict. U3 confirmation and preparation of the next
unresolved production-readiness decision remain conditional on successful repair and all postconditions.

## Tracking and files

ISSUE-316 remains OPEN. IssuesIndex.md, the issues.md Open Issues table and detailed entry, the ISSUE-316
runbook, blockers.md and CHANGELOG.md reflect the retained package and second-pass stopping result.
No duplicate product defect was created. Protected Python and tools/migration files changed: none.
The original proposal, owner note, first review and raw correction evidence remain unchanged.

[Complete changed-file inventory](SESSION-FILES.metadata-repair-v2.json) lists every repository file changed
in this continuation. The prior evidence manifest is retained as SHA256SUMS.before-metadata-repair-v2;
the new parent SHA256SUMS covers this record, inventory, frozen package and independent review artifacts.
