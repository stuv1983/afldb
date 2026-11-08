# AFLDB-ISSUE-343 — Fixture ingestion entry points check admission on a different database from their writer

**Status: RESOLVED 2026-11-08, scoped to the local working tree (uncommitted).** A real A/B qualification on two disposable databases of an isolated loopback cluster on streamanator found no failing case.
- **Both fixture CLIs:** a mismatch refuses with A and B byte-identical, sequences included; disabled, unreadable and unset controls refuse; the sealed season refuses; validate-only opens no connection; dry-run and apply on the matching target write to A only.
- **Brownlow wrapper:** it refuses at step 2 on a mismatch, before any fixture-staging write.

Evidence: `docs/v2/evidence/open-issues-closure-20261108/ev343/`; record: the ISSUE-343 entry in `issues.md`. Historical status follows.

**Earlier status: implemented locally 2026-11-08 (uncommitted), awaiting user-executed verification.** Both fixture CLIs prove control/writer identity on the writer client (`proveAflApiIngestionPreflight`) before the first write. Unit matrix: `tests/afl-api-ingestion-safety.test.ts`. Still outstanding: the two-disposable-database A/B qualification, including the Brownlow wrapper path. Opened 2026-11-08. **Severity: Medium.** Area: Ingestion controls and database identity.

This review authorizes documentation only. The sequence below is a proposal, not authorization to implement or operate any environment. [Detailed ledger](../../issues.md#afldb-issue-343).

Review baseline: branch claude/issue-339-deploy-preflight, HEAD 5cba6846ddfcfd5d7a3fd29e14bc8877099d9656, 2026-11-08. These source paths are unchanged from the locally recorded published origin/main 7fabc6e51c5c53c4b6f6fe345f21191d9184660b; this is not a fresh remote or production verification. Evidence is source-established, with no new executable reproduction. Graph tools were unavailable; exact source and caller searches were used. See [review handoff](AFLDB-ISSUE-339.md#repository-review-handoff-2026-11-08) for coverage and limits.

## Affected behavior and exact evidence

- tools/current-season/settle-afl-api-fixture-schedule.ts:175-190 checks controls, then opens AFLDB_IMPORT_DATABASE_URL; :193 calls the canonical fixture writer.
- tools/current-season/settle-afl-api-fixtures.ts:158-161 creates its importer client; :243-263 checks the seal and separate controls, then :270-303 begins staging writes.
- src/lib/acquisition/afl-api-ingestion-control.ts:84-106 reads the controls through DATABASE_URL.
- src/lib/acquisition/afl-api-ingestion-safety.ts:25-35 and :43-102 provides the live control/writer identity proof; tools/current-season/settle-afl-api.ts:453-468 uses it, unlike these two entry points.
- package.json:47-48 exposes the fixture commands; deploy/afldb-settle-afl-api-brownlow.sh:175-177 invokes fixture staging before the later Brownlow settle guard.

## Trigger, prerequisites and impact

DATABASE_URL points at database A with ingestion enabled while AFLDB_IMPORT_DATABASE_URL points at database B, where ingestion is disabled. A valid unsealed-season snapshot reaches either fixture CLI. The control read on A allows the write to B. The schedule CLI can change canonical fixtures; the other CLI writes its batch/observation staging records.

The intended database-local ingestion gate is bypassed by configuration mismatch through alternate entry points. The season seal and transactions do not bind the admission decision to the writer database. This requires misconfiguration; no unauthenticated network exploit or live mismatch is established.

## Root cause, callers and smallest viable fix

Two newer fixture entry points repeat the enabled-switch check but omit the existing control/writer identity proof used by the main match and Brownlow writers.

Apply the established control/writer proof before the first write-capable transaction in both CLIs. Preserve separate roles, validate-only without connections, sealed-season refusal order and fail-closed control-read errors. Avoid a cosmetic DSN string equality check: roles may differ while the database must agree.

## Implementation sequence and dependencies

1. Extend the existing safety tests to enumerate both fixture CLIs as well as the two original writers. Add an injected identity mismatch case at each actual entry boundary.
2. Wire the existing safety helper or equivalent shared admission helper before any batch/canonical write, with owned-client cleanup on refusal.
3. Exercise one matching-identity success and mismatched/disabled/read-failure refusals for each command; verify the Brownlow wrapper cannot write fixture staging before the refusal.

No dependency on ISSUE-332's future seasonal owner decisions. Reuse the existing identity contract first; same database names on different clusters require a separate identity-contract decision if that topology is supported.

## Focused reproduction and regression checks

Extend tests/afl-api-ingestion-safety.test.ts (its :185-220 boundary checks cover only the original main/Brownlow entry points), tests/integration/v2-fixture-writer.test.ts and tests/integration/settle-afl-api-fixtures.test.ts as appropriate. Use disposable databases A/B and sentinel rows; mismatched gate/writer must record zero batches, observations and canonical changes. Validate-only still opens zero clients.

These checks are proposed for a later authorized implementation phase; none was executed during this review. Existing evidence does not establish an incident on DEV or production.

## Measurable acceptance criteria

Both real fixture command paths refuse a mismatched gate/writer identity before any write, refuse unreadable/disabled controls, retain sealed historical protection, and succeed with enabled controls on the matching target.

## Failure handling and recovery

Refusal must leave all records unchanged and close clients. If a previously misrouted run is suspected, inspect batch/source provenance under a separately authorized scope; never bulk-delete or auto-replay canonical data.

## Duplicate and decision review

ISSUE-244 F005/F016 addressed the two original writers, while ISSUE-229's switch decisions concern bounded operational enabling. These uncovered fixture callers are a distinct remaining gap; accepted seasonal and source limitations are unchanged.
