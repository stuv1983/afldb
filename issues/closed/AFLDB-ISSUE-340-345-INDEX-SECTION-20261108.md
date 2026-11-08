# AFLDB-ISSUE-340 and AFLDB-ISSUE-345 — pre-closure IssuesIndex sections (preserved verbatim)

Removed from `IssuesIndex.md` on 2026-11-08 when both issues were resolved: owner accepted, committed as `8ef4ae1b` (340) and `65984ab2` (345), published by fast-forward of `origin/main` to `c1c4b22e`. Authoritative record: `issues.md`.

### AFLDB-ISSUE-340 — Credential rotation races with old-credential requests and session creation

- **Severity / area:** High; Authentication and administrator lifecycle.
- **State:** Open; **implemented locally 2026-11-08, not yet executed** — row-locked snapshot design (no migration) in `src/db/queries/admin-credentials.ts`; login, own change and manager reset moved to it; cookie set after commit.
- **Key evidence:** src/app/admin/login/actions.ts:43-57 reads credentials and verifies them outside a transaction; :70-76 claims only the TOTP step, without comparing the verified credentials; :82-83 creates the session later.
- **Next action:** committed locally as `8ef4ae1b` on Branch A `claude/issue-340-345-336` (base `7fabc6e5`). Re-verified at `c1c4b22e` in a fresh streamanator clone on 2026-11-08 (run 2): `admin-lifecycle` 50/50 on an isolated `_test` database at ledger 118, typecheck clean. Close after owner acceptance and push/merge of Branch A. The exact closure edits are prepared for review in packet P-340 of `issues/open/OPEN-ISSUES-CLOSURE-RUN-20261108.md` (2026-11-08). [Playbook](issues/open/AFLDB-ISSUE-340.md).

### AFLDB-ISSUE-345 — Restricted Grid Solver omits the forced password-change gate

- **Severity / area:** Low; Configurable audience access control.
- **State:** Open; **implemented locally 2026-11-08, not yet executed** — `requireAudience` routes non-public audiences through `requireUploader()`.
- **Key evidence:** src/lib/auth/audience.ts:24-30 returns immediately for public and otherwise checks getAdminUser plus role only.
- **Next action:** committed locally as `65984ab2` on Branch A. Re-verified at `c1c4b22e` (run 2): `tests/auth.test.ts` 211/211, typecheck clean. Close after owner acceptance and push/merge of Branch A. The exact closure edits are prepared for review in packet P-345 of `issues/open/OPEN-ISSUES-CLOSURE-RUN-20261108.md` (2026-11-08). [Playbook](issues/open/AFLDB-ISSUE-345.md).
