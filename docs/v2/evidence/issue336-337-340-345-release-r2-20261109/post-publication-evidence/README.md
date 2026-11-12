# r2 package: pre- and post-publication evidence (run 7, 2026-11-09)

Produced in run 7 and kept uncommitted in `D:\dev\afldb-i336-packet-r2` (`post-publication-evidence-UNCOMMITTED/`) until this records commit
(OD-6, 2026-11-11). The files are byte-identical copies; `SHA256SUMS` covers them.

| File | What it is | Result |
|---|---|---|
| `pkg-a.sh.txt` | Pre-publication harness: fresh clone of GitHub `origin/main` plus the candidate bundle; r2 static check with negative controls N1–N8; merge readiness in operator layout; fast-forward rehearsal | |
| `pre-publication.txt` | Its output | 17 passed, 2 failed: N5 and N6 failed through a harness defect (N5's edit did not commit and its dirty `package.json` leaked into N6), not a check defect |
| `pkg-a2.sh.txt`, `pre-publication-n5n6-rerun.txt` | N5 and N6 re-run, each from a forced, cleaned checkout | 2 passed, 0 failed |
| `merge-ready-336.txt` | `merge:ready --issue 336` | READY, 0 blockers, 1 warning (runbook readiness metadata) |
| `preflight-merge.txt` | `preflight --mode merge` | READY, 0 blockers, 1 warning (`.env` absent in the clone) |
| `pkg-b.sh.txt`, `offline-d0d1.txt` | Offline rehearsal of the published packet's W0, D0 and D1 blocks (PKG's own bytes) against a local bare repository: A origin/main = PKG, B origin/main moved past PKG, C wrong PKG | 22 passed, 0 failed |

The production run of the package is recorded in `../../issue336-337-340-345-release-execution-20261111/execution-record.md`.
