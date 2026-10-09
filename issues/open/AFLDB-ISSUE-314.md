# AFLDB-ISSUE-314 — `prepare-promotion-source --apply` checks `--record-out` only after committing its writes

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** database tooling / production promotion preparation.
- **Key file:** `tools/db/prepare-promotion-source.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-049; partition note R6b-F02).
- **Classification:** code-proven.

## 1. Summary

The only existence check for `--record-out` is the final `writeFileSync(…, { flag: 'wx' })`, which runs after every apply step has committed to `afldb_test`. A pre-existing path therefore leaves a prepared source with no preparation record. `--phase source` requires that record, and the tool's own wording says an unrecorded prepared source must be rebuilt.

## 2. Evidence

- `tools/db/prepare-promotion-source.ts:145-191` (argument parsing checks presence only), `:596-657` (apply steps commit), `:708` (`wx` write) and `:725-728` (raw error, exit 1).
- `tools/db/promotion-check.ts:771-784` (requires `--preparation-record`).
- Contrast: the refuse-before-connect pattern in `promotion-check.ts:3938, :3961, :3988-3990, :2897` and `afl-api-ownership-census.ts:116-118`.

## 3. Trigger

`npm run db:promotion:prepare-source -- --apply --record-out <existing path>`.

## 4. Expected invariant

Refuse before any connection is opened.

## 5. Actual behaviour

All writes commit, the record write fails, and the operator is left at a dead end (a fresh `db:test:rebuild` of about 21 minutes, plus preparation).

## 6. First wrong layer

`prepare-promotion-source.ts:708` (the late check).

## 7. Impact

An operational dead end caused by a path typo. No corruption.

## 8. Reproduction / witness

Not executed. The tests and the ISSUE-252 rehearsal inject `writeRecord`, so neither exercises the default path.

## 9. Disproof attempts

`existsSync` is used only for inputs (`:257, :289, :378`).

## 10. Existing-issue search

ISSUE-252 (resolved); `record-out` appears only in usage lines. Classification: **new**.

## 11. Scope

The output-path pre-check.

## 12. Out of scope

The preparation steps themselves.

## 13. Proposed fix boundary

`existsSync(resolve(args.recordOut))` refusal right after `parsePrepareArgs`.

## 14. Proposed validation

DB-free vitest case in `tests/db-promotion-check.test.ts`: an existing path with a `prove` dependency that throws if reached must reject before `prove` is called.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation.
