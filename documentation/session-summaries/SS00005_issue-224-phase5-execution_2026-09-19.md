<!-- DOC: Step session summary for AFLDB-ISSUE-224 Phase 5 execution -->
<!-- DOC-SCOPE: PhanesLight working memory; AFLDB issues.md / IssuesIndex.md remain authoritative -->

# SS00005 — AFLDB-ISSUE-224 Phase 5 execution (2026-09-19)

**Agent:** primary session (Sonnet 5, high effort). No PhanesLight agent spawned — this was a single
bounded read-only execution task against an already-approved runbook phase, not a 5+ step plan launch
and not a multi-subsystem investigation, so CLAUDE.md §1's zero-subagents default applied and was
followed.
**Worktree:** `D:\dev\afldb-issue-224`. **Branch:** `sonnet/issue-224`.

**Task:** execute AFLDB-ISSUE-224 Phase 5 (read-only, `afldb_test`) against a new v3 source-evidence
parent, under explicit operator approval scoped to steps 5.1–5.3, with a hard boundary of no mutation,
no staging, no commit, no production.

## Boundary held

Operator-authorised shell/Python execution was used **only** for the three named read-only steps plus
one bounded diagnostic probe. No `.env` was modified. No git command was run (no staging, no commit,
no `git add -A`). No production target was touched. No credential or full DSN was printed, echoed, or
persisted — the DSN was extracted inside a single Python process from the main checkout's `.env`
(worktree has none), corrected in-memory from port 5432 to the tunnel's 55432, and passed only via
`os.environ` to a child process; verified afterwards that hygiene check 7.1 of `validate_person_bridge_child.py`
("no DSN, absolute path, DATABASE_URL name, credential or secret appears") passed against the produced
child file. Phase 6 (mutation) was not authorised and did not run.

## What was run (all operator-approved, all read-only)

1. A bounded psycopg probe: `default_transaction_read_only=on` requested and re-verified server-side,
   REPEATABLE READ, 5s statement timeout, unconditional rollback + close. PASS.
2. Phase 5.1 — `export_person_bridge.py --resolve-against afldb_test --parent <v3 parent> --out
   data/reference/draftguru-person-bridge-20260918-v3.afldb_test.json`. One rolled-back read-only
   transaction. Result independently re-hashed and confirmed to match the tool's own report.
3. Phase 5.2 — `validate_person_bridge_child.py --target test` (offline) against the new child.
4. Phase 5.3 — `bridge_import_gate.py plan --target test` against the new child/parent.

## Outcome

**5.1 COMPLETE/PASS.** `bridges=3470 parent_bridges=3562 withheld=1587`, sha256
`94aeac74422bea17dbb14913d480055991db4ac79546a2860383e669b5bbdac4`. Exactly the predicted +2/-2 delta
against the v2 child, matching the two-person (Laidley/Capuano) correction recorded offline in
`bridge-v3-reconciliation-issue224-20260919-v1.json`.

**5.2 and 5.3 BLOCKED BY STALE V2 PINS**, not by any defect in the v3 export. `validate_person_bridge_child.py`
reported 7 FAILs, all traced to hard-coded v2 constants (parent hash, provenance, population counts,
the 7-entry corrected-identity transition map); every failure names only Laidley/Capuano, and every
schema/partition/uniqueness/sort/hygiene check passed. `bridge_import_gate.py plan --target test`
refused **before opening any database connection** (`child count bridges is 3470, expected 3468`) —
its `EXPECTED_CHILD_COUNTS` constant has no CLI override.

**Phase 5 status recorded as BLOCKED**, not complete, per the operator's explicit classification.
Evidence written into `issues/open/AFLDB-ISSUE-224.md` (new Phase 5 execution record, after the Phase
5 plan table) and `issues.md` (dated addendum under the existing AFLDB-ISSUE-224 entry).

## New issue opened

**AFLDB-ISSUE-227** (Low, reusable-tooling) — the two validation tools' v2-pinned lineage constants,
with an itemised, additive-only proposed fix (new v3 constants alongside the retained v1/v2 ones, so
the frozen `draftguru_bridge_v2_contract.py` history stays provable) and two disclosed out-of-scope
dependencies: committing the now-untracked v3 test child as a fixture (a Git action, operator-reserved)
and a new additive `draftguru_bridge_v3_contract.py` test rather than editing the v2 one. **Proposal
only — no file edited.** Full detail: `issues/open/AFLDB-ISSUE-227.md`. Recorded in `issues.md`
(new entry) and `IssuesIndex.md` (new entry; open-issue count 4 → 5).

## Disclosed drift

None observed this session (no subagent search commands were run, so the unquoted-shell-redirection
drift pattern recorded in SS00004 did not recur).

## Files changed

Created: `data/reference/draftguru-person-bridge-20260918-v3.afldb_test.json` (Phase 5.1 export
output — data, read-only-derived, untracked); `issues/open/AFLDB-ISSUE-227.md`; this summary.
Modified: `issues/open/AFLDB-ISSUE-224.md` (status bullet + Phase 5 execution record), `issues.md`
(ISSUE-224 addendum + new ISSUE-227 entry), `IssuesIndex.md` (new ISSUE-227 entry + ISSUE-224 Phase 5
bullet).
**No source, test, tool, migration, or immutable reference-data (v1/v2/v3 parent) file was touched.**
Nothing staged, committed, pushed, merged or deployed; Git remains operator-owned per CLAUDE.md §12.

## Next

Operator to review `issues/open/AFLDB-ISSUE-227.md` §2 (itemised constant changes) and §4 (open
question: move the default pinned lineage to v3, or keep v2 default with v3 by explicit flag only)
before any implementation pass. Once approved and implemented, re-run AFLDB-ISSUE-224 Phase 5.2/5.3
against the v3 child to confirm a clean pass, then continue with AFLDB-ISSUE-224's own operator
decisions (D-1/D-1a/D-2/D-4), which this session did not touch.
