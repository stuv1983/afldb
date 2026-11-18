# B1a successor procedure (AFLDB-ISSUE-366)

Living tools and instructions for any **future** run of the 2026 Brownlow player-season status repair (ISSUE-365 B1a) and
its release checks. They succeed the packet 6R artifacts and the A1 sitting blocks, which remain unchanged historical
evidence under `docs/v2/evidence/remediation-20261114/run6r/`. Nothing here is approved for production by being
committed: every sitting needs its own owner approval, pinned revisions and block manifest, as on 18 November.

The rules that governed the 18 November sitting still apply to any successor sitting:

- every stop rule stops the sitting; P6 runs **once** and is **never** retried, automatically or otherwise;
- only the owner restarts the service or restarts a stopped sitting;
- a failed release permits only the approved **application** rollback (R2);
- the database reversal (`reverse.mts`) and a whole-database restore each need a **separate** owner decision.

## Tools

| File | Role |
|---|---|
| `lib.ts` | Pure logic: attempt identity, the v2 capture format, baseline binding, state classification, the recovery decision. |
| `db.ts` | Every fingerprint expression, once; output settings pinned; the liveness probe. |
| `capture.mts` | Read-only v2 capture (P3c BEFORE baseline, P6 acceptance AFTER with `--compare`). |
| `repair.mts` | The runner. Same scope, locks and outcome codes as packet 6R, plus `--attempt` and the bound baseline. |
| `recover.mts` | Interrupted-commit recovery (R1 `probe`). Read-only. |
| `reverse.mts` | Guarded reversal, row-content guards, `--commit` only with `--approval-ref`. |
| `sitting/*.sh` | Successor blocks P3c, P5, P6, R1, P9, P10, R2 (`tr -d '\r' < block \| ssh afldb bash -s -- args`). |

The v2 capture keeps every packet 6R line (`identity`, `pss2026`, `ids2026`, `cov2026`, `inputs2026`, H1, H2, H3 with its
count, `na_cov`, `na_pss`) and adds `format`, `sitting`, `schema` and five row-content fingerprints
(`fp_season2026`, `fp_medal2026`, `fp_authority2026`, `fp_entry2026`, `fp_round2026`): `count|md5` of each whole row as
JSON in bytewise order, `0|-` for none. A packet 6R capture is refused by every successor tool.

## What changed, by ISSUE-366 item

1. **Interrupted commit recovery.** `repair.mts` prints `LAUNCH` (attempt, pid) before it connects, runs as
   `application_name = 'afldb-b1a <STAMP>-commit-1'` and holds the repair advisory lock `(365, 2026)` for its whole
   transaction. `p6-commit.sh` records `ATTEMPT-START` (its own pid and start time), `RUNNER-PID` and `RUNNER-EXIT`, and
   runs the runner under `nohup`. `recover.mts` advances only when the runner process (by attempt token), the block
   (by pid and start time), every backend of the attempt and the advisory lock are all shown terminal, **then** takes a
   fresh snapshot, **then** checks again, and only if the records agree with each other and the state is exactly the
   pinned original or exactly its repaired image. `r1-state.sh probe` exits with that verdict: 0 committed, 10 not
   committed, anything else STOP.
2. **Pre-write baseline drift.** `p3c-baseline.sh` writes the sitting's v2 BEFORE capture and its sha256. P5 and P6 pass
   that file and hash to the runner, which recaptures every line under its locks and refuses before the first UPDATE
   unless all lines are equal. After the UPDATE the in-transaction recapture must be the exact repaired image, and P6's
   independent acceptance AFTER must classify as `repaired`.
3. **Same-count reversal drift.** `reverse.mts` requires the state to be exactly the repaired image of the approved v2
   capture (which includes the content fingerprints), under the same locks, before its UPDATE, and the post-state to be
   the BEFORE capture exactly. Commit mode also needs `--approval-ref`.
4. **P10 verification.** `p10-pages.sh` keeps the four-player, 16-sample loop and adds the three controls to the
   verdict, each on its own `P10 CHECK` line and in the `P10 VERDICT` JSON line. Any failure: `P10 RESULT … FAIL`, exit 1.
   The signed-in browser check stays a separate manual result (`manual-browser NOT-RECORDED`). The `after` text is the
   D-365-W `pending` wording ("Results not loaded" with the title "Brownlow Medal results for this season have not been
   loaded yet."), not the interim ISSUE-365 "Not yet awarded": `after` therefore needs a serving release that contains
   D-365-W, and every sample fails against one that does not. Each sample also rejects wording of the other state even
   when the expected text is present: `after` fails on "No medal" or its tooltip and on the interim label or tooltip;
   `baseline` requires "No medal" and its tooltip and fails on either pending label or tooltip (D-365-W or interim).
5. **S7/S8 restart confirmation (with AFLDB-ISSUE-351).** `release.mjs status --confirm-restart-invocation <InvocationID>`
   accepts the owner's confirmation for that invocation only, and `post-install-check.sh` passes the same option to its
   own `status --expect`. `p9-s7s8-checks.sh <NEW_ID> [<InvocationID>]` and `r2-rollback.sh verify <OLD_ID>
   [<InvocationID>]` carry it to both. The unbound `--confirm-attended-restart` flag of `status` is unchanged.

## Successor sequence (the parts that differ from the A1 sitting)

| Step | Block | Pass | Otherwise |
|---|---|---|---|
| P3 | dump, sha256, header and DB-free 2026 proof as A1 P3 (no runner installation into the checkout: the tools are tracked) | dump verified | B1a abandoned: R1 `probe` |
| P3c | `p3c-baseline.sh STAMP` | `P3c RESULT BASELINE PASS` | B1a abandoned: R1 `probe` |
| P5 | `p5-dryrun.sh STAMP VERDICT-PASS <dump sha256>` | `P5 RESULT DRY-RUN PASS` | no commit: R1 `probe` |
| P6 | `p6-commit.sh STAMP` once | `P6 RESULT COMMITTED EXACT`, exit 0 → S3 | R1 `probe` |
| R1 | `r1-state.sh STAMP probe` | exit 0 → S3 as committed; exit 10 → S3, B1a abandoned | STOP before S3 |
| P9 | `p9-s7s8-checks.sh NEW_ID [InvocationID]` | `P9 RESULT S7+S8 PASS` | R2 per packet 6R §4.3 |
| P10 | `p10-pages.sh after` | `P10 RESULT after PASS (64 samples, 3 controls)` | per PUBLIC-CHECKS §3; data wrong → R1, STOP |
| R2 | `r2-rollback.sh links OLD_ID`, owner restart, `r2-rollback.sh verify OLD_ID [InvocationID]` | `R2 RESULT ROLLBACK VERIFIED` | owner |

A STOP from R1 because the attempt is still live may be followed by R1 again once it has ended. That is the only repeat;
nothing re-runs P6.

## Tests

- `tests/b1a-successor-lib.test.ts`: capture parsing, baseline binding, state classification, the recovery decision
  table modelled on the historical R1 cases, and the P9, P10 and R1 blocks run against stub programs.
- `tests/integration/b1a-successor.test.ts`: real PostgreSQL, in a disposable schema created and dropped per case:
  the paused-writer visibility race (COMMIT and ROLLBACK), live and unconfirmed attempts, failed probes, baseline drift
  in H1, H2, H3 and an input, the clean control, and same-count reversal drift.
- `tests/deploy-release.test.ts`: the invocation-bound confirmation in `auditActivation`, `status` and
  `post-install-check.sh`.
