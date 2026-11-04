# Evidence: ISSUE-333 (O1) and O2, 2026-11-04

These files support `docs/v2/issue333-o2-consolidated-approval-2026-11-04.md`.

**Everything above the `prod-apply/` row records preparation only; nothing in it applied anything to production.** The preparation's only production write was the backup directory that `scripts/capture-prod-issue333-o2.sh` created. **O1 and O2 were then applied once each on 2026-11-04 (03:14:48Z and 03:15:45Z); see `prod-apply/` and `docs/v2/issue333-o2-apply-record-2026-11-04.md`.**

- **Tool revision R:** `50ed6e4f4a697160ef263ade293792363e52e975` (local commit, not pushed).
- **Production ops checkout:** `/home/arm/ops/issue333-o2-50ed6e4f/cand`, clean at R.

| Path | What it is |
|---|---|
| `prod-readonly/probe-20261104T0129Z.txt` | Read-only production probe before any work: 2026 coach gap and the O2 rows (53 of 53 fields equal). |
| `f002-stage-fold-workstation.txt` | The real `stage_core` and `read_source` chain run DB-free on core.tar (season2026Groups 436; 32,470 assignments). |
| `backup/capture.txt` | Backup capture log for `/home/arm/backups/afldb/issue333-o2-20261104T021037Z`. The ledger was unchanged across the capture. |
| `backup/SHA256SUMS` | The backup directory's own sums, copied from production; the dump sha is `e77c307d...826d`. |
| `backup/afldb_prod-20261104T021037Z.provenance.json` | The backup provenance. |
| `backup/restore-evidence.json` | Restore verification on the guarded streamanator cluster (`afldb_v2_i333o2_b20261104t021037z_rst_test`). |
| `backup/backup-I333.json`, `backup/backup-O2.json` | Machine-assembled sealed stage evidence, produced by `tools/v2/gap029-assemble-restore-evidence.ts` stages I333 and O2. |
| `prod-plans/prod-prep.txt` | Production ops checkout preparation at R. |
| `prod-plans/prod-plans.txt` | Read-only production plans. O1: `4de5368c...515e`, expires 2026-11-05T02:16:51Z. O2: `c29d148d...ea03`, expires 2026-11-05T02:17:15Z. |
| `prod-plans/plan-*.json`, `prod-plans/target-i333.json` | The plan documents the owner's approval binds. They are copies; the originals are in the production ops evidence directory. |
| `rehearsal/rehearsal-<n>.txt` | Run logs on fresh clones of the restored backup. Run 1: all 18 scenarios. Runs 2 and 3: the two killed-writer scenarios after harness fixes. |
| `rehearsal/rehearsal-<n>/<scenario>.txt` and `<scenario>/` | Per-scenario logs, mode outputs (`*.out`), outcome JSON, digests and Carr/Fraser figures. Plans and staging were omitted for size. Writer logs are redacted by the tools. |
| `scripts/` | The derived capture, ops, workspace, restore and assembly, rehearsal harness, figures and probe scripts. See the next table for the owner wrapper. |
| `scripts/prod-apply-i333-o2.sh` | The apply wrapper. The original (sha256 `ae456bdc...51c2`, preparation) ignored a failed approval-file step. **Revision 2 (sha256 `f1d810ee...970f`) is what ran**; the `SHA256SUMS` entry below is the original and is left as written. |
| `scripts/mock-wrapper-test-i333-o2.sh`, `prod-apply/wrapper-mock-test-result.txt` | The mocked exercise of every wrapper phase: 34 checks, 0 failures; reproduces the original defect. |
| `scripts/postapply-verify-i333-o2.sh`, `scripts/visibility-probe-i333-o2.sh` | Read-only post-apply verification (psql as `afldb_backup`, application-query figures as `afldb_app`) and the visibility probe (process, file-system and anonymous HTTP status only; mints no cookie). |
| `scripts/visibility-beta-probe.mts`, `scripts/visibility-beta-probe-run.sh`, `scripts/probe-env-check.sh`, `scripts/isr-disk-diagnostic.sh`, `prod-apply/visibility-beta-probe-20261104.json`, `prod-apply/isr-disk-diagnostic.txt` | The owner-authorised beta-cookie visibility probe (token and key never recorded; the JSON holds request times, status, selected headers, sizes and extracted rows), the presence-only environment check and the on-disk ISR diagnostic. Results: apply record sections 8 and 9. |
| `prod-apply/` | Approvals, apply and state JSON, writer logs, post-apply verification and visibility-probe outputs, and the application-query figures. Sums: `SHA256SUMS-postapply`. |

- **Measured rehearsal result:** 18 of 18 scenarios passed (see section 5 of the approval doc).
- **Second bounded probe (-r2) and closure, 2026-11-04 (apply record section 10):** `scripts/coach-row-selector.mts` (corrected, tested selector; unit test `tests/issue333-coach-row-selector.test.ts`), `scripts/visibility-beta-probe-r2.mts`, `scripts/visibility-beta-probe-r2-run.sh` and `prod-apply/visibility-beta-probe-r2-20261104.json` (one request: `/clubs/port-adelaide`, HTTP 200, row `Josh Carr | 2026 | 23 | 7 | 0 | 16 | 30.4` at 05:34:08.204Z; no cookie or key in the file). ISSUE-333 resolved under the owner's amended visibility criterion.
- **Not measured (accepted by the owner as a disclosed limitation):** worker-by-worker attribution of any response (apply record sections 8 and 10), the exact ISR regeneration times, and either recovery.

`SHA256SUMS` covers the preparation files; `SHA256SUMS-postapply` covers the post-apply files and the revised wrapper.
