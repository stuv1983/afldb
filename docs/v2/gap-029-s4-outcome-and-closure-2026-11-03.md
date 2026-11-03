# V2-GAP-029 — S4 applied, fresh final verification, and closure (3 Nov 2026)

**V2-GAP-029 is CLOSED locally under the existing D5 criterion.** All four production stages (S1–S4) are applied and technically accepted, and the fresh post-S4 final verification met every condition the owner set. Nothing was pushed, deployed, built, restarted, granted or cleaned up. Execution revision for everything here: **R = `f05a2e78fdd0d90824789ab81ee2d2e4ffe3ab8f`** (the production ops checkout is pinned to it; the serving checkout is untouched). Predecessor: `docs/v2/gap-029-s3-outcome-and-s4-preparation-2026-11-03.md`.

## 1. What changed where (three different things)

| Layer | State |
|---|---|
| **Production data** (`afldb_prod`, OID 66668, system id 7674454702926115004) | Changed by this GAP across S1–S4 (and the earlier Block L labels): S1 seven co-captain rows (batch 79); S2 the DraftGuru link-only promotion; S3 eight audited rookie selections with their overrides and correction notes; S4 one sibling relationship (batch 81). Each stage applied once through its guarded tool, with its own restore-verified backup. |
| **Local policy / reference / tooling files** | In this repository, **committed locally and not pushed**: the Webster eligibility file and the approved Lyons, Webster and sibling decisions, the guarded stage tools, the evidence. Production does not read them; they are the corpus acceptance policy. |
| **Serving application** | **Unchanged by this GAP.** `afldb.service` was `active` with MainPID 3326560 at the S3 and S4 applies and `active` at the final capture. No deployment, build or restart occurred. Three identities, not to be conflated: (1) `d00e07e3…` is the production **operator checkout** revision (`/home/arm/projects/afldb`), which GAP-029 left untouched. (2) `QNEHXAtU53TzUjj0Mb7mv` was read from that checkout's `.next/BUILD_ID`; it is **not evidence of the running release** (it is the id of the retained deep release `9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv`, as already corrected in `docs/v2/gap-029-block-l-execution-ready-2026-11-02.md`). (3) The **previously verified serving release** is `a0b1080f5b98-B8kdpO6PO1tUCHus0j1za`, application revision `a0b1080f5b98aee7191894c138be27bb524c7b1b`. That identity is attributed to the existing D-316-12 deployment evidence (`docs/v2/evidence/d31612-release-execution-20261103/execution-record.md`); it was **not freshly verified during GAP-029**. |

## 2. S4 — approval and apply

| Item | Value |
|---|---|
| Owner approval (D4-PROD) | Received in this session after 09:04:11Z (the last write of the previous session's notes) and before 09:07:40Z (the first clock reading here). Recorded window **2026-11-03T09:07:40Z – 10:04:00Z**, i.e. no more than 60 minutes after any possible receipt and far inside the 2026-11-04T08:30:00Z cap (and the plan's 08:41:50Z limit). Statement recorded as `approval-statement-20261103T090824209Z.txt`. Not transferable; consumed. |
| Revalidation before approving | `run.json` revision, plan digest `ef98fa11…69d`, and the sha256 of the dump (`e589566b…a04`), `backup.json` (`5f00cb3d…`), `restore-evidence.json` (`195fbf3f…`), `plan.json` (`c3421064…`) and `manifest.json` (`53b8a9c8…`) all equal the approved values; class GENUINE_PRODUCTION. `git diff f05a2e78..HEAD` over `tools/`, `src/`, `package.json` touches only two `.diff` evidence files. The plan names exactly one new pair (6937 / 9714, key `siblings:afldb-sibling-supplement:015`), 498 → 499 rows, `importBatchesBefore` 73, artefact `b1f0ff4e…d318`, loader `6f1ce059…fd42`, expected content digest `d6fceb33…12ec`. Backup captured 09:01:50Z (7 minutes old), plan expiry 2026-11-04T09:02:49Z. S3 accepted (`ACCEPTED stage=S3` 09:00:17Z). |
| Wrapper gates at apply | MANIFEST VERIFY PASS; CAPTURE CHECK PASS (ledger 118); APPROVAL CHECK PASS; no conflicting writer, migration or dump process; app active, MainPID 3326560. |
| Apply | **One** detached apply, 09:08:35Z–09:08:38Z. Tool exit 0, **`OUTCOME COMMITTED_VERIFIED`**, wrapper exit 0, post-run probe **PLANNED RESULT PRESENT**. The session did not drop, so `report` was not needed and nothing was retried. |
| Acceptance | **`ACCEPTED stage=S4`** at 09:08:47Z ("exactly the reviewed pair was added"). |

Recovery limit as approved: the loader owns its commits (no dry run, no pre-commit hook). Nothing was restored, reversed or retried. Evidence: `docs/v2/evidence/gap029-s4-apply-20261103/`.

## 3. Fresh final verification

**Capture.** The stage wrapper correctly refuses a capture for an accepted stage, so the reviewed `capture-prod-stage.sh` was run directly through `final-capture-prod.sh`, a script derived from the wrapper's capture phase whose only substitutions are listed in its header (a positive "S1–S4 all accepted" gate in place of the order gate; no actor check; no plan). It ran from the pinned checkout over one SSH connection, read-only on the database. Backup `afldb_prod-20261103T091009Z.dump`, captured 09:10:09Z, 30,141,851 bytes, sha256 **`3a4f17c169ea23019465602df1f3c47e84798214424ea1f081fb2df6d94be4d0`**, 1651 TOC entries, ledger 118; CAPTURE CHECK PASS and TARGET CHECK PASS; `target.json` sha256 `5b0a54ee…a3b9`. Production host directory `/home/arm/backups/afldb/gap029-S4-20261103T091009Z` (the "S4" there is only the capture script's naming argument).

**Transfer and restore.** Copied privately to the streamanator workspace (hash-verified on both sides) and restored into the guarded isolated database `afldb_v2_gap029_final_20261103_091009_rst_test` (ledger 118, DEV services unchanged: afldb.service and postgresql@16-main.service, state and MainPID, before and after). **Evidence binding:** `restore-evidence.json` sha256 `adc155af12dfd715a598527fd63d9e8a0561dbd4e549635bd593035f89a77cff` is generated by the assembler from the restored database and binds the dump sha256 above, the production target identity (`afldb_prod`, OID 66668, system id 7674454702926115004), revision R, and the restore target. `binding.txt` records the LF-normalised sha256 and git blob id of every stage tool, the corpus test, the release policy, and the Lyons, Webster, rookie and adjudication data files, all at R.

**Targeted read-only checks** (`final-verify-sql.mjs`, `final-verify-py.py`; read-only sessions, SELECTs only):

| Stage | Result |
|---|---|
| S1 | 7/7 co-captain rows match the plan field for field (season, club, player, role, period, note), all in import batch 79; `captaincies` total 1,781 (1,774 + 7), natural keys unique. |
| S2 | The gate's own `after_state`, `picks_after` and `newly_linked` hashes on the final restore equal the production S2 plan's; **`draft_persons` (5,057) and `external_identities` (19,319) are byte-identical to the post-S2 restore**; 5,221 of 6,818 draft picks are linked. See §3.1 for the one check that did not pass as first written. |
| S3 | All eight selections present with the reviewed pick, club, kind, `Rookie` type, detail and source `manual_admin_edit` (`draft_picks` ids 6811–6818); eight active `data_overrides` (ids 158–165) naming actor 1; eight `data_edits` correction notes (ids 161–168) with the exact reviewed text, one per player, actor 1 only; `draft_picks` total 6,818 (6,810 + 8). |
| S4 | 499 sibling rows, 498 pre-existing; exactly one new row (Jeremy McGovern 6937 / Mitch McGovern 9714) in its own batch 81; **content digest `d6fceb338d5f…12ec` equals the rehearsed digest**; the 498 pre-existing rows' full-row digest `c3e629ce…2470` equals the pre-S4 backup (byte-identical, every column). `import_batches` 73 → 74. |
| Persistence | Captaincies, draft persons, external identities, draft picks, draft overrides, data edits and the 498 siblings are **identical between the post-S3 restore (taken 09:01) and the final restore**, i.e. S4 changed only the sibling table and `import_batches`. S3 left the S1/S2 surfaces untouched (post-S3 equals post-S2 restore). |

### 3.1 The one check that failed first, and why it does not count against S2

The first run's S2 gate `verify` against the production S2 plan failed two sub-checks, both about `baseline_sha256` (the other three hashes were equal), so the host script's overall result is `FAIL (1)`. This was a defect in how I applied the check, not in the data: `baseline_sha256` digests the non-link columns of the whole `draft_picks` surface, which S3 grew by eight rows *after* S2. A read-only follow-up (`final-s2-followup-host.sh`, same guarded ceremony) proved it: the gate `verify` passes **in full** against the production plan on the post-S2 restore; on the post-S3 restore the three hashes are equal and only `baseline_sha256` differs; and the 6,810 post-S2 `draft_picks` rows are an unchanged prefix of the final table, the only additions being the eight V2-GAP-029 selections. Both runs are retained unedited. The host script was not changed to hide the failure.

**Production-scope corpus** (`tests/integration/gridley-corpus.test.ts` at R, diagnostic mode, on the fresh restore, with the already-approved Lyons D-GAP029-D3 (11 cells), Webster D-GAP029-D4W (8 cells), 21 sibling-disagreement and rookie-source decisions): 10,287 cells, 10,209 solved. Report sha256 `640df638f535cd69eac7c9a914d4e3f53d4e72bbcc030e152882bc0cfbcf7e6a` (9.8 MB; stays on the host). Approved-policy conformance **PASS, 0 unapproved differences**; **0 incorrect known answers**; all three known-answer adjudications **current** (Bruce, Swallow, Shiel); strict parity retained at exactly **118 findings = 78 approved deferrals + 40 approved criterion disagreements** (0 data matches among the approved), nothing weakened or waived; scope counts match (draft picks 6,818, captaincies 1,781, 64 labelled matches); every data-gap flag true (data present), including `draftLinks`, which was the closed gate on production before S2.

**Exit codes, accurately.** The corpus test file exits **1 by design**: of 1,212 tests, 1,211 passed and one failed, `writes the run report and has no failing cells`, which in diagnostic mode asserts an empty strict-findings list and received the 40 approved criterion disagreements (the 21 sibling disagreements, 11 Lyons cells and 8 Webster cells that the passing policy tests enumerate). That is the accepted retained strict state, not a regression. The acceptance verdict comes from the reviewed `corpus-summary.mjs` (exit 0) and `final-corpus-checks.mjs` (exit 0). The host script's overall `FAIL (1)` comes from the S2 baseline check in §3.1 alone. Evidence: `docs/v2/evidence/gap029-final-verify-20261103/`.

## 4. D5 criterion

Existing D5: GAP-029 closes when D1-PROD (S1), D2-PROD with the rookie decision (S2, S3) and D4-PROD (S4) are applied and verified against the production-derived target and the Webster 8 are approved or resolved. Scored on the fresh production restore:

| Criterion | State |
|---|---|
| Production-scoped findings reproducibly enumerated | **Met** (this corpus run, report sha above, 118 strict findings fully classified). |
| Every finding corrected or covered by a specific recorded approval | **Met on production data**: 118 approved (78 deferrals, 40 criterion disagreements), 0 unapproved. |
| Unapproved and incorrect known answers zero | **Met**: 0 and 0. |
| Focused regressions pass; limitations disclosed | **Met** (qualification at R; §5). |

## 5. Limits, stated plainly

- Rischitelli and Gibbs pick numbers remain **secondary-sourced** (recorded as such in their audit rows). Strict parity stays failing at 118 by definition; closing GAP-029 does not make it pass.
- The S2 and S4 importers commit in their own transactions; the recovery limit applied to both and was not exercised.
- Evidence for S2 is the gate's own verification plus the persistence differential and §3.1; for the rest, the SELECT-only checks above. No ANALYZE was run (no grant is authorised).
- **No page-level check of the live site was made.** Landing and season pages are ISR-cached; the new data may take up to an hour per worker to appear and was not measured.
- The corpus runs on a restore of the production backup, not on production.
- The AFL API match timer stayed enabled and the AFL Tables timer disabled throughout; no timer or switch was touched.

## 6. Retained state (nothing cleaned up)

S1–S4 and final backups, restores and run directories on all three machines (`/home/arm/backups/afldb/gap029-S*-*`, `/home/arm/ops/gap029-stages/f05a2e78/`, `D:\tmp\gap029-prod\runs\`, streamanator `/mnt/ssd/afldb-v2-gap029-prod-20261103/` including the final restore database and `final_*` evidence directories). `.codex/` and unrelated work are untouched.

## 7. Push

Not pushed. Local `main` is ahead of `origin/main` (`69940488…`, as last fetched) by the GAP-029 commits; the guarded block in the hand-off message pins both the expected `origin/main` and the closing commit and refuses to push if either differs. Pushing carries only repository files (the §1 local policy/reference/tooling layer and records); it changes neither production data nor the serving application.
