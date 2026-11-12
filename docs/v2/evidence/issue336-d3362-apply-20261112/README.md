# D-336-2 Steps E+F on production (2026-11-12): COMMITTED_VERIFIED and ACCEPTED

Contract: the owner's OD-4 approval of 2026-11-12, which applies once the I336 plan
`afa26158781c0538166302be05d440a79af9ab805f8143f218c5cf804e90f608` to `afldb_prod` (OID 66668, system identifier
7674454702926115004). It uses run `I336-20261112T025001Z`, ops revision `a25306f930015acef602bcc60d76613bdcc3d466` and backup sha256
`0d517f5a3db7ccb887615df2c3fa3f136918f5dd4941df939e7e1a8d843a34c6`. Window **16:00–17:30 AEDT, 2026-11-12
(05:00:00Z–06:30:00Z)**. Procedure: `docs/v2/issue336-d3362-approval-packet-2026-11-11.md` §4, Steps E and F, with R and OPS replaced
as in `docs/v2/issue349-d3362-preparation-2026-11-12.md`. Plan evidence: `docs/v2/evidence/issue336-d3362-plan-20261112/README.md`.

Each step was one SSH session. `scripts/common.sh` refused anything outside the window, using the production host's own clock. The
apply ran once; nothing was retried.

| Step | Time (UTC) | Result | Output |
|---|---|---|---|
| E1 recheck | 05:00:21 | No approval or apply lock yet. Ops checkout clean at R. Run-file sha256s equal to the plan record. `PREFLIGHT_OK`: identity `afldb_prod` OID 66668, system 7674454702926115004, ledger 118; actor 1 super_admin enabled and enrolled; 1 enabled Super Admin; no conflicting writer. Plan summary: digest, revision, target and backup equal; backup limit 2026-11-13T02:30:02Z. `STATE BASELINE` | `output/e1.txt` |
| E2 approve | 05:00:32–05:00:33 | The statement was generated from the plan (window text above). `MANIFEST VERIFY PASS`. `APPROVAL WRITTEN … window 05:00:00Z .. 06:30:00Z` | `output/e2.txt`, `run/approval-statement.txt`, `run/approval.json` |
| **F1 apply (once)** | 05:00:42–05:00:48 | Gates passed: manifest, capture, approval and no conflicting writer. App active, MainPID 3666648. **`WRAPPER OUTCOME COMMITTED_VERIFIED (exit 0)`**; post-run probe `PLANNED RESULT PRESENT`. Tool result: written 35, new persons 31, every pick sealed `audited_correction`; picks 6819–6853, audit ids from 169 | `output/f1.txt`, `run/apply-out-1.json`, `run/outcome.json`, `run/apply-1.log`, `run/apply-wrapper.log` |
| F2 report + state | 05:01:00 | Recorded outcome `COMMITTED_VERIFIED` (exit 0); `STATE PLANNED RESULT PRESENT` | `output/f2.txt` |
| F3 accept | 05:01:10–05:01:13 | `MANIFEST VERIFY PASS`; `STATE PLANNED RESULT PRESENT`; read-only verify: 35/35 present, pre-existing rows unchanged, `draft_picks` 6,853, 35 audit rows. **`ACCEPTED stage=I336 run=I336-20261112T025001Z`** | `output/f3.txt`, `run/I336.json`, `run/verify-out-1.json`, `run/state-out-5.json` |
| Independent read-only check | ~05:03 | `transaction_read_only on`: `draft_picks` 6,853 (6,818 + 35), `draft_persons` 5,088 (5,057 + 31), new pick ids 6819–6853 = 35 rows, 35 `data_edits` rows on those picks (35 distinct picks), all by `admin_user_id = 1`; draft `data_overrides` still 8. Ops checkout clean. `afldb.service` active, MainPID 3666648, NRestarts 0; timer schedule unchanged | `output/post.txt`, `scripts/postcheck.sh` |

Two earlier attempts of the independent check failed at parse or relation lookup: the first named a nonexistent ledger table, and the second
had a sed-damaged SQL. Both were read-only transactions on a diagnostic script, not the stage tooling. The script was rewritten, and the third
run is the one recorded.

**Nothing else changed:** no restart, deploy, timer or configuration change, and no other database write. The `ANALYZE` is left to
autovacuum (the wrapper has no grant).

## Still open under ISSUE-336 (packet §4 Step G, read-only)

- Reconcile against the owner CSVs (expected 5,966 = 5,966 for 1991–2025 DraftGuru rows).
- Check the pages `/draft/2008`, `/draft/2025` and `/draft/2009?view=pre-draft` at desktop and mobile. Production is beta-gated, so this needs the
  owner's sign-in through the headed runner. The pages may serve ISR-cached HTML until it is revalidated.
