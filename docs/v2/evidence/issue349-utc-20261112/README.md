# ISSUE-349: UTC connection qualification (2026-11-12)

Local executable candidate: a25306f930015acef602bcc60d76613bdcc3d466,
branch codex/issue349-utc. Owner authorised local implementation and qualification.
Production use and publication of this executable change remain separately gated.

Both clients in tools/v2/issue336-predraft-insert-production.ts pin the startup
TimeZone to Etc/UTC. The read-only client keeps default_transaction_read_only=true.
Startup parameters apply to every newly established connection, including reconnects.
The writer passes its transaction to recordDataEdit, so its audit writes use that same session.

## Qualification scope

Fresh disposable workspace: /mnt/ssd/afldb-i349-20261112 on streamanator.
The previous tool (595dc394) and the candidate each use a new pair of isolated clusters.
The simulated production database's default is Australia/Melbourne; the restore cluster
is Etc/UTC. Both start from the approved 2026-11-04 production snapshot.
Before changing the simulation database default, qualify.sh checks its exact data directory.
All captures, assembly, plans and applies here are SIMULATION evidence.
No live production or DEV database is changed.

The existing I336 simulation runner is adapted only for revision and fresh paths.
The red run must reproduce baseline drift; the green run must prepare a plan, exercise
approval and stage refusals, apply with COMMITTED_VERIFIED, report, verify state and accept,
then refuse repeat operations. Full logs are retained beside this README.
## Results

- Focused Linux unit suite: 85/85 PASS (unit.log).
- Typecheck: PASS, no diagnostics (typecheck.log); the set -e harness advanced only after exit 0.
- Red, previous tool 595dc394: baseline drift refusal at planning, wrapper exit 6.
- Green, fixed a25306f9: capture, restore, sealed assembly and plan PASS.
- Six pre-approval refusals: exits 3, 6, 20, 2, 2, 2; state remained BASELINE.
- Apply COMMITTED_VERIFIED, report/state PASS, ACCEPTED stage=I336.
- Picks 6818 -> 6853 (+35); persons 5057 -> 5088 (+31); 35 audit rows on 35 picks by actor 1.
- Three repeat-operation refusals: exit 21; capture count stayed one.
- Final state PLANNED RESULT PRESENT. Ledger remained 118.
- Both simulation clusters stopped; ports 55493/55494 closed.
- Logs scanned against generated role passwords: zero matches.

The green plan digest is simulation-only and is not an OD-4 input.
Prepared pack hash is recorded in pack.sha256.
No application rebuild or browser rerun is needed: this changes only ops-client startup settings;
the full Linux capture-to-accept simulation exercises those connections against real PostgreSQL.

## Production next step

Do not reuse I336-20261112T010605Z: its revision and baseline evidence belong to the old tool.
Review and approve publication/use of the qualified ops revision first, then approve a fresh
D-336-2 capture, restore, assembly and read-only plan at that revision.
The application release remains pinned to c1c4b22e; an ops pack does not change the serving application.
No OD-4 apply statement can be populated until that fresh production plan exists.
