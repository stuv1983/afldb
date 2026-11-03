# V2-GAP-029 — S3 applied and accepted; S4 prepared (3 Nov 2026)

**GAP-029 remains open.** S1, S2 and S3 are applied to production and technically accepted. S4 is prepared (read-only plan, own fresh backup) and **not approved or applied**.

Execution revision for everything below: **R = `f05a2e78fdd0d90824789ab81ee2d2e4ffe3ab8f`** (local `main`, unpushed; production checkout still `d00e07e3`, untouched). Predecessor: `docs/v2/gap-029-s2-outcome-and-s3-preparation-2026-11-03.md`.

## 1. S3 — measured outcome

| Item | Value |
|---|---|
| Approval | Owner D3-PROD received before 2026-11-03T08:59:09Z (first revalidation command). Recorded window **08:59:10Z – 09:59:10Z** (60 min; shorter than the 2026-11-04T07:45:00Z cap). Approval written 08:59:50Z. Consumed. |
| Revalidation before approving | `run.json` revision, plan digest, dump / `backup.json` / `restore-evidence.json` / `plan.json` / `manifest.json` hashes all equal the approved values; class GENUINE_PRODUCTION; `git diff f05a2e78..HEAD` over `tools/`, `src/`, `package.json` touches only two `.diff` evidence files; plan lists exactly the eight selections, all `to insert`, Rischitelli and Gibbs `pickNumberEvidence: secondary`. |
| Run / plan | `S3-20261103T081918Z`, plan `cca95f3ad992a1c4807afbc107d79ab6ef277aa71a5e44190d23dfcef65435f0` |
| Gates (wrapper) | MANIFEST VERIFY PASS; CAPTURE CHECK PASS (dump `628749ce…4a54`, ledger 118); APPROVAL CHECK PASS; no conflicting writer, migration or dump process; `afldb.service` active, MainPID 3326560 |
| Apply | one detached apply, single attempt, 09:00:02Z–09:00:07Z. Tool exit 0; **`OUTCOME COMMITTED_VERIFIED`**; wrapper exit 0; post-run probe **PLANNED RESULT PRESENT** |
| Report | `COMMITTED_VERIFIED`, exit 0, committed true, no notes; tool log sha256 `3ce7c9edfe8876ff49afe46567239f1ea24e57b75dff5bf1c174547394daac7b` (the report was run once for the record; the connection did not drop) |
| Acceptance | **`ACCEPTED stage=S3`** at 09:00:17Z; "Read-only verification: 8/8 selections present" |

Actor `auth_users.id 1` was re-proved by the stage tool inside the apply transaction (as implemented; the log is on the production host at `/home/arm/ops/gap029-stages/f05a2e78/runs/S3-20261103T081918Z/logs/apply-1.log`; I did not extract it separately). Selections applied: Schneider 54 (St Kilda 2014), Henderson 35 (Geelong 2019), Davis 3 (GWS 2022), Reid 11 (Sydney 2023), Taylor 10 (Sydney 2021), Seedsman 21 (Adelaide 2022), Rischitelli 2 (Gold Coast 2018, secondary), Gibbs 1 (Adelaide 2020, secondary).

Limits of this evidence: verification is the tool's own read-back plus the wrapper's state probe and `verify`; I ran no ad-hoc SQL and did not separately inspect the `data_overrides` / `data_edits` rows or correction notes (the tool owns them and the plan carries the exact notes). No ANALYZE. Nothing retried, restored or rolled back. The AFL API timer was enabled throughout.

Evidence: `docs/v2/evidence/gap029-s3-apply-20261103/`.

## 2. S4 — preparation result

Order gate passed ("S3 accepted: 5b91bdb275e25e8f"). Same pinned checkout, profile and restore workspace.

| Item | Value |
|---|---|
| Run | `S4-20261103T090149Z` (workstation `D:\tmp\gap029-prod\runs\S4-20261103T090149Z`) |
| Preflight | identity `afldb_prod` OID 66668, system id 7674454702926115004, ledger 118; no conflicting writer; the read-only actor-1 check also ran (still super_admin, enabled, enrolled; enabled Super Admin count 1) although S4 needs no actor |
| Fresh backup (taken after S3 accepted) | captured 2026-11-03T09:01:50Z, 30,140,902 bytes, 1651 TOC entries, sha256 **`e589566bc5caa2759d87f17d685e90452e5fb20f1611f78f4eaa62ea4f34da04`** |
| Restore (streamanator, isolated cluster) | `afldb_v2_gap029_s4_20261103_090149_rst_test`; `pg_restore` exit 0, 0 stderr lines, ledger 118; DEV services unchanged (MainPIDs 1677 / 1536) |
| `restore-evidence.json` sha256 | `195fbf3f6f5cb96ff1425b8f5212470fa2b88946e2b809094361a9c7f11b3640` |
| `backup.json` / `plan.json` / `manifest.json` sha256 | `5f00cb3dfb8146f9cf684df0294bf491c49d9300919ad20e4a7f0df3c19f017d` / `c34210649e45e1ab215724b44e6d6c1347624c5b054289e2dd7fd06abda87812` / `53b8a9c863075c7a724716448a07082a8a3b717f64d27a9ab7078de10b5e3fae` |
| **Plan digest** | **`ef98fa113e0f139074ec0488000b39ba79c5ee0ea5db466628b29b6f5b2fe69d`** |
| State against the plan | `BASELINE` (plan not applied) |
| Plan expiry / approval limit | plan expires 2026-11-04T09:02:49Z; **an approval must expire before `2026-11-04T08:41:50Z`** (24 h backup limit minus 20 min) |

**Expected change (exactly):** add the single sibling key `siblings:afldb-sibling-supplement:015` — Jeremy McGovern (player 6937) / Mitch McGovern (player 9714) — through `family_siblings.py load`, artefact sha256 `b1f0ff4ed0bfcf23b53fc8e0007c08ffee636cfd7077b39c3d07aa3b842bd318` (499 rows; loader sha256 `6f1ce059…fd42`). Before: 498 sibling rows, content digest `e2239be8…`, full-row digest `c3e629ce…`; `import_batches` 73 before (expect one new row, 74). Expected content digest after: `d6fceb338d5f37e8fdef18443da696c52225db9caa80cedb9261e401aea212ec`. The plan proved 1 new pair, 0 changed, 0 stale.

**Why existing relationships are preserved.** The loader upserts every artefact row and deletes any stored row not in the artefact. The plan proves (a) all 498 existing rows already equal their artefact rows, so the upsert is a no-op that leaves `import_batch_id` alone, and (b) no stored sibling row is absent from the artefact. The apply then checks all pre-existing rows byte-identical (every column), exactly one new row, one new `import_batches` row, and the content digest equal to the digest rehearsed on the production-equal clone.

**Importer-owned transaction and recovery limits.** The loader owns its commits and offers no dry run or pre-commit hook, so no check can run inside its transaction; safety rests on the plan's immediate pre-write proof. The loader commits the batch and sibling rows, *then* writes `validation_result` in a second commit, so a non-zero loader exit can follow a COMMIT: only the independent read-only probe decides. Possible outcomes: REFUSED_BEFORE_MUTATION, ROLLED_BACK (proved by fresh session), COMMITTED_VERIFIED / NOTHING_WRITTEN, COMMITTED_VERIFICATION_FAILED, COMMITTED_VERIFICATION_UNAVAILABLE, OUTCOME_UNDETERMINED. After any committed outcome nothing is retried, reversed or restored automatically; restoring backup `e589566b…` would discard every production write made after it was taken and is a separate owner decision.

### S4 apply approval for review (D4-PROD) — populated except the window

> I approve D4-PROD: apply, once, to afldb_prod (database OID 66668, system identifier 7674454702926115004) the digest-pinned S4 plan ef98fa113e0f139074ec0488000b39ba79c5ee0ea5db466628b29b6f5b2fe69d (one sibling pair (McGovern)), at execution revision f05a2e78fdd0d90824789ab81ee2d2e4ffe3ab8f, after this stage's own fresh restore-verified backup e589566bc5caa2759d87f17d685e90452e5fb20f1611f78f4eaa62ea4f34da04 (restore evidence 195fbf3f6f5cb96ff1425b8f5212470fa2b88946e2b809094361a9c7f11b3640; evidence class GENUINE_PRODUCTION). Exactly the sibling key afldb-sibling-supplement:015 through family_siblings.py load, artefact b1f0ff4ed0bfcf23b53fc8e0007c08ffee636cfd7077b39c3d07aa3b842bd318, expecting content digest d6fceb338d5f37e8fdef18443da696c52225db9caa80cedb9261e401aea212ec. I accept the same recovery limit as S2. Nothing else. No retry and no automatic restore. Window: from `<START>` until `<EXPIRY, not later than 2026-11-04T08:41:00Z>`.

Owner commands after approval (workstation `D:\dev\afldb`; Git Bash needs `MSYS_NO_PATHCONV=1`):

```text
node --import tsx tools/v2/gap029-stage.ts approve --run-dir D:\tmp\gap029-prod\runs\S4-20261103T090149Z --digest ef98fa113e0f139074ec0488000b39ba79c5ee0ea5db466628b29b6f5b2fe69d --expires <ISO-8601 UTC ending in Z, <= 2026-11-04T08:41:00Z> --not-before <START>
node --import tsx tools/v2/gap029-stage.ts apply   --run-dir D:\tmp\gap029-prod\runs\S4-20261103T090149Z
node --import tsx tools/v2/gap029-stage.ts report  --run-dir D:\tmp\gap029-prod\runs\S4-20261103T090149Z   (only if the apply session drops)
node --import tsx tools/v2/gap029-stage.ts accept  --run-dir D:\tmp\gap029-prod\runs\S4-20261103T090149Z
```

Evidence (scoped): `docs/v2/evidence/gap029-s4-prep-20261103/`. The dump, `backup.json` and `restore-evidence.json` stay private (workstation run dir; production `/home/arm/backups/afldb/gap029-S4-20261103T090149Z`; streamanator workspace).

## 3. Housekeeping

Retained, not cleaned: S1–S4 backups, restores and evidence on all three machines. No push, production checkout update, deployment, build, restart, timer/switch change, grant or WSL access occurred. `.codex/` untouched. AFL Tables timer disabled, AFL API match timer enabled, as before. GAP-029 stays open until S4 is applied and accepted and the owner closes it.
