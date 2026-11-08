# Pre-closure IssuesIndex.md sections — ISSUE-338, ISSUE-341, ISSUE-342 (preserved verbatim, 2026-11-08)

Removed from `IssuesIndex.md` when the three issues were resolved on 2026-11-08 (open-issues closure run). Records: their `issues.md` entries and runbooks in `issues/closed/`.

### AFLDB-ISSUE-338 — DraftGuru operator-review contract's byte-identical rerun check is time-dependent

- **Severity / area:** Low; test tooling only.
- **State:** Open, opened 2026-11-06. Observed once at `8b024098` (checks 11a and 11c); 0 of 5 reruns failed. Not fixed.
- **Key files:** `tools/rebuild/draftguru/review_bridge_operator.py:1424` (`review_completed_utc: utc_now()`), `tests/python/draftguru_bridge_operator_review_contract.py:466-469`.
- **Next action:** test clock frozen locally 2026-11-08 (test-only, not yet executed); user runs `python3 tests/python/draftguru_bridge_operator_review_contract.py` and `npx vitest run tests/draftguru-acquisition.test.ts -t "operator-adjudication review tool"` on Linux; close on pass. [Playbook](issues/open/AFLDB-ISSUE-338.md).

### AFLDB-ISSUE-341 — Restore target validation can accept a DSN that connects to the source database

- **Severity / area:** Medium; Database restore and wrong-target safety.
- **State:** Open; **implemented locally 2026-11-08, not yet executed** — strict owner-DSN contract, libpq routing unset, in-session identity assertion before every write in `tools/maintenance/restore-test.sh`.
- **Key evidence:** tools/maintenance/restore-test.sh:45-56 replaces the URL path with afldb_restore_test but preserves the query; :65 checks only the path.
- **Next action:** stub harness passed 24/24 on streamanator on 2026-11-08. Still needed: a separately authorised two-disposable-database sentinel qualification. [Playbook](issues/open/AFLDB-ISSUE-341.md).

### AFLDB-ISSUE-342 — Restore verification can certify an abnormal pg_restore termination

- **Severity / area:** Medium; Backup proof and restore failure status.
- **State:** Open; **implemented locally 2026-11-08, not yet executed** — only exit 0, or exit 1 with known extension-owner errors and a matching closing summary, can reach parity/marker.
- **Key evidence:** tools/maintenance/restore-test.sh:144-154 captures pg_restore exit status.
- **Next action:** stub harness passed 24/24 on 2026-11-08. Still needed: authorised disposable fault injection once 341 qualifies. [Playbook](issues/open/AFLDB-ISSUE-342.md).

