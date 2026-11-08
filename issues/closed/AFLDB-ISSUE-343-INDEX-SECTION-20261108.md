# Pre-closure IssuesIndex.md section — ISSUE-343 (preserved verbatim, 2026-11-08)

Removed from `IssuesIndex.md` when ISSUE-343 was resolved on 2026-11-08 (open-issues closure run). Record: its `issues.md` entry and `issues/closed/AFLDB-ISSUE-343.md`.

### AFLDB-ISSUE-343 — Fixture ingestion entry points check admission on a different database from their writer

- **Severity / area:** Medium; Ingestion controls and database identity.
- **State:** Open; **implemented locally 2026-11-08, not yet executed** — both fixture CLIs run `proveAflApiIngestionPreflight` on the writer client before the first write.
- **Key evidence:** tools/current-season/settle-afl-api-fixture-schedule.ts:175-190 checks controls, then opens AFLDB_IMPORT_DATABASE_URL; :193 calls the canonical fixture writer.
- **Next action:** unit suites passed on 2026-11-08 (184 + 81 + 80). Still needed: the two-disposable-DB A/B qualification (incl. Brownlow wrapper path). [Playbook](issues/open/AFLDB-ISSUE-343.md).
