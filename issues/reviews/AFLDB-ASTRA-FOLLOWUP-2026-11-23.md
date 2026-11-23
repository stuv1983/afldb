# Astra follow-up evidence, 23 November 2026

Review record `fd2b21b1a55f21ada671fb49af1620c1f5b71abe` is a direct child of the reviewed implementation
`c154f36bb9a2a9b8ba5db507eb1748fa6f716622`. The fixes in `2bec8060487816c21c143ee8e3dd924a74e30eae`
were committed in a separate worktree based on the review record. The systemd timestamp correction is
`b48a2c5e1925e0a1dfa148b14203577df120b0a4`. The Wednesday runbook pins this latter code commit.

## ISSUE-352 installation on streamanator

The checked installer from `c154f36bb9a2a9b8ba5db507eb1748fa6f716622` exited **0** at **2026-11-23 11:20:29 AEDT**.
All six staged files checked against Astra's pins. Arm could read the cron journal. Cron version was `3.0pl1-184ubuntu2`.
The marked 03:10 entry was active and the complete crontab digest matched before and after. The installer retained
`/home/arm/afldb-ops/afldb-offhost-pull-daily.sh.pre-352-20261123T002029Z`.

| Installed file | SHA-256 |
|---|---|
| `afldb-offhost-pull-daily.sh` | `2ebac1c09b07e6b3bc1e060d7645efdbb1c2c7f169b5cfafd4e7f77508716e24` |
| `scheduled-pull-evidence.sh` | `d7574254997ba28dd1f750b7bcdc6f90c0a421b88ba6bb02aa104bd671b8572e` |
| `offhost-pull.sh` | `a3775aea879b1d9ce05d0e96482e66d24c69deb62cf38e8fc0407c0d2653dc2b` |

The prior pair check exited 1 (old wrapper and absent verifier). The post-install pair check exited 0. The initial r3 cron
check returned 1 with `INSTALLED` and `PRECONDITIONS FAIL`: Monday's dump had a verifying sidecar and marker, and the
first-copy restore log lacked a PASS for that dump.

**Owner-approved attended restore, 11:35:12–11:35:34 AEDT.** Verified both the dump bytes and exact named sidecar for
`afldb_prod-20261123-022145.dump` against SHA-256 `3818c759ff2a5cd7405578995795738427b45c403d7bbf40748514e532d38fe1`.
The fresh PostgreSQL cluster listened only on its private Unix socket. `pg_restore` exited 0 with empty stderr. Checks
passed for ledger 118, 130 seasons through 2026, 17,056 matches, 13,365 players, 695,499 player-match rows, and 183
2026 Brownlow rows totalling 1,242 votes. The cluster was stopped and the disposable workspace removed. The prior
first-copy log was preserved and the checked attended PASS recorded in the active log. At **11:35:35 AEDT**, both
post-install checks exited 0, and the cron check confirmed the same crontab and next dispatch on Tuesday 24 November
at 03:10 AEDT.

Monday's independent result remains **copy verified, scheduled origin unproven**. Tuesday's scheduled copy and
Wednesday's verification-service restore require their own evidence.

## Named regression results

| Finding | Result |
|---|---|
| **368**, AFLW replacement race | PostgreSQL 16, socket-only cluster, two real connections and the actual loader under the import role. Both revisions initially loaded 121 rows across eleven seasons. The writer inserted the 2027 generation and explicitly observed itself in the loader's `pg_blocking_pids` before committing. The reviewed loader exited 0, removing 2027 from staging and the six public views. The fixed loader exited 1 and retained identical row snapshots across all eight staging tables and six public views. A complete twelve-season replacement exited 0 when the test advanced the independent inventory. The staging contract passed 54/54. |
| **352**, rollback reporting | Rejected the second rename and then blocked removal of the newly installed verifier. The installer returned 5, the pair check reported partial installation and the old wrapper bytes survived. Normal rollback returned 4 and restored the original absent verifier. Scheduled-origin suite 139/139, core timestamp and retention 42/42. |
| **351/352**, Wednesday production sidecar and restore attribution | Selector 42/42. Correct digest under the wrong basename refused; binary-mode sidecar with exact basename accepted. Collector accepted the verification service record and ignored a manual session record. A later restore overwriting the state for another dump, a later overwrite naming the same dump, a duplicate journal completion and changed dump bytes all failed. UTC-normalised timer dispatch, service start and service exit parsing passed against actual DEV systemd output and the fixtures. |
| **351**, Wednesday process and functional workers | Process and Sunday checks 31/31; ordinals 3/4, duplicate ordinal and missing worker rejected. Functional script checks 27/27. The printed F-4b command ran the staged real CLI over loopback: workers 1 and 2 exited 0. Workers 3 and 4, duplicate 1, and worker 2 plus an anonymous reply each exited 1. |
| **362**, numeric trace values | Real supervisor plus loopback stub: route classification preserved while the synthetic numeric path value was absent from all supervisor/worker output. Release and revalidation Vitest suites 168 passed, 0 failed, including the missing clustered worker identity regression. |
| **348**, historic DraftGuru acquisitions | Reviewed-pin and link-only contracts passed. Real August validate-only passed under the corroborated digest (5,057 persons, 6,810 picks). Changed August parsed rows failed. September direct import refused before reading the acquisition. November raw-page cases were skipped because the raw files were absent from this fixture run. |
| **351/352**, pinned operator commands | Executed the printed archive command and staging/hash block, 14/14 raw Git blobs matched. Ran the printed A-1 and A-4 on a synthetic 25 November cron dispatch with all three verifier arguments. Printed A-2 and F-2 reached their production host guards on DEV. Functional F-4b used the printed path and arguments against loopback workers. Both public smoke commands passed against fixture responses. Production facts, the raw-head acceptance and attended actions require the real sitting. |

Repository typecheck generated route types and stopped at TS2307 in `tests/issue333-coach-row-selector.test.ts:14`.
The referenced `docs/v2/evidence/issue333-o2-20261104/scripts/coach-row-selector.mjs` is absent from both the reviewed
implementation and the fix. The focused TypeScript suites passed.

The earlier independent schema-only comparison found **490 identical named failures** across its base and tip.
The names and causes of the earlier **476** remain unknown. These targeted tests make no claim about either broader baseline.

**Push holds. Application release holds. Wednesday reboot remains NO-GO** until Wednesday's own overnight backup,
attributable 03:10 off-host copy, separate attributable verification-service restore, and attended recovery evidence.

## Addendum, 23 November 2026 (fix branch `codex/astra-fix-20261123`; the text above is unchanged)

The typecheck paragraph above says the referenced `coach-row-selector.mjs` is absent. The test imports `.mjs` on purpose and TypeScript's bundler resolution maps it to the tracked `coach-row-selector.mts`, which is present in `91c04159` (and in `c154f36b` and `2bec8060`). From fresh exports of `91c04159` on Windows and on streamanator, `npm run typecheck` exits 0; deleting only the `.mts` reproduces the quoted TS2307 exactly. ISSUE-333 stays resolved. Details, the qualification results and the one test-only repair (the AFLW race test's hard-coded `/tmp/afldb-astra-*` guard) are in [AFLDB-ASTRA-FIX-2026-11-23](AFLDB-ASTRA-FIX-2026-11-23.md).
