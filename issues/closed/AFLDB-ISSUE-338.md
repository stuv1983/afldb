# AFLDB-ISSUE-338 — Time-dependent DraftGuru finalize contract

**Status: RESOLVED 2026-11-08; test-only fix published 2026-11-09 in `d3d38025` (`origin/main` `c5959bbf..ae28bd70`; recorded evidence carried forward, `docs/v2/evidence/open-issues-closure-20261108/b2b5-publish/`).** Verified on streamanator in a fresh workspace: Python contract 229 PASS / 0 FAIL (11a–11k included), focused Vitest 1 passed / 166 skipped. Evidence `docs/v2/evidence/open-issues-closure-20261108/` (`i338-*.log`); record: the ISSUE-338 entry in `issues.md`. Historical status follows.

**Earlier status: implemented locally 2026-11-08 (test-only, uncommitted), awaiting user-executed verification.** `tool.utc_now` is frozen around the byte-identity reruns and restored in `finally`. New checks 11e–11k cover clock restoration and the deliberate different-time case. **Severity: Low.** Test tooling only. Existing issue opened 2026-11-06; review update 2026-11-08. [Detailed ledger](../../issues.md#afldb-issue-338).

Review baseline: branch claude/issue-339-deploy-preflight, HEAD 5cba6846ddfcfd5d7a3fd29e14bc8877099d9656, 2026-11-08. These source paths are unchanged from the locally recorded published origin/main 7fabc6e51c5c53c4b6f6fe345f21191d9184660b; this is not a fresh remote or production verification. Evidence is source-established, with no new executable reproduction. Graph tools were unavailable; exact source and caller searches were used. See [review handoff](AFLDB-ISSUE-339.md#repository-review-handoff-2026-11-08) for coverage and limits.

## Evidence and behavior

- tools/rebuild/draftguru/review_bridge_operator.py:1424 calls utc_now() for review_completed_utc.
- tests/python/draftguru_bridge_operator_review_contract.py:456 and :461 calls finalize twice; :466-469 demands byte-identical JSON, CSV and Markdown.
- Existing ISSUE-338 ledger reproduction: checks 11a/11c failed once at 8b024098 on streamanator; CSV passed; five reruns passed. This review read that record and source, not the private/raw host artifacts, and did not rerun it.

Trigger: two otherwise identical finalize calls straddle a second boundary. The legitimate completion timestamp changes JSON/Markdown. The test treats that timestamp as deterministic output; product data and provenance need not be corrupt. Affected caller: tests/draftguru-acquisition.test.ts runs the Python contract.

## Smallest fix and sequence

1. Extend the existing contract with an explicit clock arrangement at the test boundary. Prefer freezing the tool's clock only around the two byte-identity calls, restoring it afterwards even on failure.
2. Preserve whole-byte comparisons for JSON/CSV/Markdown with identical time and inputs. Add a deliberate different-time case proving the completion timestamp remains truthful while stable content/digests remain equal; normalize only that known field if comparing across times.
3. Run the existing Python contract and its enclosing focused Vitest case on the approved disposable Linux workspace. No broad corpus or product timestamp change is needed.

No schema or operational dependency. Owner input only if the product timestamp contract itself is proposed to change; that is outside this test-only fix. Closed ISSUE-222's bridge generated_utc behavior remains unchanged.

## Acceptance and recovery

The identical-input/time case is deterministically byte-identical regardless of wall-clock boundaries; the different-time case explicitly expects the new timestamp and preserves all substantive byte/digest checks. JSON and Markdown content mutations must still fail the contract. No sleeps or probabilistic repeated passing runs count as proof. On test failure, retain the failure and restore patched clock state; do not weaken checks, rewrite retained artifacts or change production completion timestamps. A test-only patch can be reverted without data recovery.

No implementation or tests executed in this review.
