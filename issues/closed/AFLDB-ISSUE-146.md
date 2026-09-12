# AFLDB-ISSUE-146 — code_test_db rebuild target

Status: Resolved (2026-09-07) — merged to main (62e9536); first real code_test_db rehearsal
passed final validation 85/85 after a bounded host-bootstrap fix (see issues.md).

## Merge readiness

<!-- afldb-merge-readiness
{"status":"ready","hardBlockers":[],"expectedFiles":[".env.example","CHANGELOG.md","IssuesIndex.md","docs/deployment.md","issues.md","package.json","tests/db-test-rebuild.test.ts","tools/db/migrate.ts","tools/db/privileges.ts","tools/db/rebuild-test.ts","tools/maintenance/00_install_postgres.sh","issues/open/AFLDB-ISSUE-146.md"],"validation":["npx vitest run tests/db-test-rebuild.test.ts — PASS: 285/285","npm run typecheck — PASS","CLI --plan smoke for code_test_db and afldb_test — PASS","git diff --check / conflict-marker / encoding audit — PASS","ESLint findings reproduced identically on main and none occur in ISSUE-146 hunks"]}
-->