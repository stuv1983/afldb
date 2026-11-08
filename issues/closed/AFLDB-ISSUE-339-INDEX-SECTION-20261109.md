# AFLDB-ISSUE-339 — pre-closure IssuesIndex section (preserved verbatim)

Removed from `IssuesIndex.md` on 2026-11-09 when the issue was resolved: replayed onto `origin/main` `c1c4b22e` without `48ff91c7`, published by fast-forward `c1c4b22e..8d122f62` (merged revision = tested commit `8d122f629df6a610ae4e95805e39583cc2ab8aaf`), not deployed. Record: `issues.md` → AFLDB-ISSUE-339 Resolution; runbook `issues/closed/AFLDB-ISSUE-339.md`.

### AFLDB-ISSUE-339 — DEV deployment (`sync-dev.ps1`) ran checkout, install, migration, build and restart with no enforced preflight

- **Severity / area:** Medium; deployment tooling.
- **State:** Open, opened 2026-11-07. The host-side deploy gate (`afldb_deploy_gate`; `-Phase assess|execute`; exit 0/40/41, revalidations 42–46; evidence under `/mnt/ssd/afldb/records/deploy-preflight/`) is on local branch `claude/issue-339-deploy-preflight`, unpushed.
  - Linux qualification 43/43.
  - A real read-only DEV assessment exited 40 on the stale 7 Nov backup and artifact.
  - Nothing deployed.
- **Key files:** `deploy/sync-dev.ps1`, `deploy/sync-dev-remote.sh`, `tests/sync-dev-static.test.ps1`, `tests/sync-dev-remote.test.sh`.
- **Next action:**
  - **review corrections A–D implemented locally 2026-11-08 and qualified:**
    - The Windows harness passed and exported both payloads.
    - The Linux harness passed **63/63** on streamanator, with all 22 generated-payload cases run, in a fresh `/mnt/ssd` workspace.
      - The first run was 62/1: the `R339-C` missing-decoder case was broken by a leaked `command()` test stub.
      - A test-only fix is local and uncommitted.
    - Next: owner review, then the commit, push and merge decision. [Playbook and review handoff](issues/open/AFLDB-ISSUE-339.md);
  - **W-339 write-mode rehearsal, 2026-11-08 run 2: 61/0** on B1 = local commit `549c5892`. G1/G2: the gate refused and no child ran. W1: the gated `117 -> 118` transition, the exact line in write mode and parity 118/118; B was unchanged. W2: the sanitized child wrote only A under hostile exports. N1: the old line was misdirected to B. Evidence: `docs/v2/evidence/open-issues-closure-20261108/w339/`. R339-A write-mode acceptance is met. Remaining: owner D1–D4 (including push/merge of Branch B) and R339-D's live-host argv measurement.
  - **R339-A status-mode target selection, 2026-11-08:** the real `migrate.ts` child was run in `--status` mode with the gate's exact migration line against two disposable databases, giving **25/0**.
    - Every configuration the gate admits writes only the assessed database.
    - Every configuration it refuses would have written the other database or failed in the real runner.
    - Write mode was observed via `--status`'s DDL, since Git is outside this run's authorisation.
    - Record: the ledger entry; the evidence is in `docs/v2/evidence/open-issues-closure-20261108/ev339/`. The owner decisions are in the packet in `issues/open/OPEN-ISSUES-CLOSURE-RUN-20261108.md`;
  - qualify those cases before any push/merge/deployment decision;
  - decide whether a standalone DEV `db:migrate` goes through the gate, and whether `preflight --mode deploy` accepts an approved transition;
  - the next DEV deploy needs a fresh verified backup and artifact.
