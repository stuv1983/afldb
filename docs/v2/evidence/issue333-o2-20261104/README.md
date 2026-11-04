# Evidence: ISSUE-333 (O1) and O2, 2026-11-04

These files support `docs/v2/issue333-o2-consolidated-approval-2026-11-04.md`.

**Nothing in this folder applied anything to production.** The only production write was the backup directory that `scripts/capture-prod-issue333-o2.sh` created. All other production access was read-only.

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
| `scripts/prod-apply-i333-o2.sh` | The owner-run apply wrapper, placed in production ops `in/` with sha256 `ae456bdc...51c2`. It was **not run, not reviewed and not rehearsed**. It only calls the rehearsed ceremonies, which fail closed. |

- **Measured rehearsal result:** 18 of 18 scenarios passed (see section 5 of the approval doc).
- **Not measured:** production time-to-visibility, either recovery, and the owner wrapper.

`SHA256SUMS` in this folder covers every other file here.
