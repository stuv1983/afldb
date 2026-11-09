# AFLDB-ISSUE-342 — Restore verification can certify an abnormal pg_restore termination

**Status: RESOLVED 2026-11-08; fix published 2026-11-09 in `532dcd77` (`origin/main` `c5959bbf..ae28bd70`; not deployed; evidence carried forward, `docs/v2/evidence/open-issues-closure-20261108/b2b5-publish/`).** Fault injection on the ISSUE-341 cluster: **20 passed, 0 failed**.
- A real `--jobs=4` restore was held at its first post-data `CREATE INDEX` by an advisory-lock event trigger. All nine parity values already matched at that point.
- pg_restore was then SIGKILLed. The wrapper exited 1 ("exit status 137"), reached no parity check, and left **no proof marker**. The prior candidate was cleared, and the witness index was absent.
- The control restore without the barrier succeeded.

Evidence: `docs/v2/evidence/open-issues-closure-20261108/ev342/`; record: the ISSUE-342 entry in `issues.md`. Non-blocking owner follow-up: ratify the compatibility exception, or choose strict exit-0. Historical status follows.

**Earlier status: implemented locally 2026-11-08 (uncommitted), awaiting user-executed verification.** Option chosen: the narrowly proven compatibility exception. Accepted outcomes are exit 0 with no error lines, or exit 1 where every error is a known extension-owner error and pg_restore's closing `errors ignored on restore: N` summary matches their count. Every other outcome fails before parity and leaves no marker. Stub harness: `bash tests/restore-test.test.sh`. Still to do: authorised disposable fault injection after ISSUE-341 qualifies. Opened 2026-11-08. **Severity: Medium.** Area: Backup proof and restore failure status.

This review authorizes documentation only. The sequence below is a proposal, not authorization to implement or operate any environment. [Detailed ledger](../../issues.md#afldb-issue-342).

Review baseline: branch claude/issue-339-deploy-preflight, HEAD 5cba6846ddfcfd5d7a3fd29e14bc8877099d9656, 2026-11-08. These source paths are unchanged from the locally recorded published origin/main 7fabc6e51c5c53c4b6f6fe345f21191d9184660b; this is not a fresh remote or production verification. Evidence is source-established, with no new executable reproduction. Graph tools were unavailable; exact source and caller searches were used. See [review handoff](AFLDB-ISSUE-339.md#repository-review-handoff-2026-11-08) for coverage and limits.

## Affected behavior and exact evidence

- tools/maintenance/restore-test.sh:144-154 captures pg_restore exit status.
- :156-167 fails only on non-filtered log text; :169-173 treats every nonzero exit as tolerated extension errors when that text is empty.
- :196-204 checks nine row counts/sums, not completion of all post-data definitions.
- :206-211 writes afldb.restore_test.v1 sha256=... and announces the backup proven when those checks pass.

## Trigger, prerequisites and impact

pg_restore terminates abnormally (for example exit 137) with empty or only filtered output after loading the counted data but before completing post-data constraints/indexes. The aggregate checks can match even though the process did not finish. The acceptance of any nonzero exit with empty log is established by source; the particular kill timing and incomplete-schema witness still require disposable fault injection.

A partial restore can acquire the same proof marker consumed by downstream backup/promotion checks as a complete restore. This is false assurance rather than evidence that any existing retained backup is defective.

## Root cause, callers and smallest viable fix

Absence of unexpected text is treated as positive proof of a successful/tolerated process completion. The exit status is reported but never used to reject an abnormal termination.

Require successful completion. Prefer avoiding known benign extension ownership commands and requiring exit 0; otherwise explicitly accept only the normal documented error status with positively identified, bounded benign errors and independent completion evidence. Never accept signal exits, empty-log nonzero exits or an arbitrary warning-only failure. Keep the proof marker absent on every failure.

## Implementation sequence and dependencies

1. Design an exit/status matrix for zero, known extension errors, unknown errors, 137, missing executable and truncated/empty logs. Add a focused restore entry harness alongside ISSUE-341.
2. Implement strict completion classification; do not widen text suppression. Record failure before parity/marker creation.
3. After ISSUE-341 is qualified, fault-inject a disposable restore after data load and before final schema work; verify incomplete output cannot be certified.

Shares the restore harness with ISSUE-341; target safety must be implemented/qualified first. Owner chooses strict exit-zero command selection or the narrowly proven compatibility exception.

## Focused reproduction and regression checks

Stub pg_restore and psql to make all nine parity values match while injecting nonzero exits; assert no proof comment and nonzero wrapper status. Qualify a real small disposable dump including post-data constraints/indexes. Existing ledger evidence for legitimate extension-owner errors explains the exception, but does not test arbitrary process failure.

These checks are proposed for a later authorized implementation phase; none was executed during this review. Existing evidence does not establish an incident on DEV or production.

## Measurable acceptance criteria

Every abnormal or unexplained nonzero pg_restore exit fails the wrapper and produces no restore proof marker, even with matching aggregates. A complete restore still succeeds; any retained benign exception has exact positive evidence and a regression case.

## Failure handling and recovery

Clear a prior candidate marker before starting, leave it absent on failure, and stop downstream use of that candidate. Re-run only on a disposable target after correcting the cause. Do not delete or invalidate private retained backups based solely on this source finding; live evidence review is an owner decision.

## Duplicate and decision review

ISSUE-250 covers binding proof to a dump and preserving post-snapshot writes; it does not authorize ignored abnormal exits. No matching open issue found.
