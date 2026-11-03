# V2-GAP-029 — S1 applied and accepted; S2 prepared (3 Nov 2026)

**GAP-029 remains open.** S1 is applied to production and technically accepted. S2 is prepared (read-only plan, own fresh backup) and **not approved or applied**. S3 and S4 are untouched.

Execution revision for everything below: **R = `f05a2e78fdd0d90824789ab81ee2d2e4ffe3ab8f`** (local `main`, unpushed; production checkout still `d00e07e3`, untouched). Predecessor: `docs/v2/gap-029-s1-production-handoff-2026-11-03.md`.

## 1. S1 — measured outcome

| Item | Value |
|---|---|
| Approval | Owner D1-PROD, received **2026-11-03T08:00:45Z**; recorded window **08:00:45Z – 09:00:45Z** (60 min; shorter than the 2026-11-04T07:00:00Z cap). Approval file written 08:01:22Z. |
| Scope pins verified before approving | R is an ancestor of HEAD; all 11 wrapper blob hashes at R match the handoff table; plan, manifest, target, dump, backup.json and restore-evidence.json hashes match the approved values; tarball `a88b1afb…53f4` per `run.json`. |
| Run / plan | `S1-20261103T074434Z`, plan digest `e5a7a0396c5f8d37a6748779c41bffda9564943e24a93409e60cf4eabc4eefb2`, evidence class GENUINE_PRODUCTION |
| Gates (wrapper) | MANIFEST VERIFY PASS; CAPTURE CHECK PASS (dump `409b21a2…1ded`, ledger 118); APPROVAL CHECK PASS; no conflicting writer, migration or dump process; `afldb.service` active (MainPID 3326560) |
| Apply | one detached apply, single attempt, 08:01:31Z–08:01:33Z. Tool exit 0; **`OUTCOME COMMITTED_VERIFIED`**; wrapper exit 0; post-run state probe **PLANNED RESULT PRESENT** |
| Report | recorded outcome `COMMITTED_VERIFIED`, exit 0, committed true, no notes; tool log sha256 `65bf8ba6dab195c9262bc33f9a246d30d8a12b69a82f8fd6fedba07d570e69e0` |
| Acceptance | `ACCEPTANCE RECORDED for S1` / **`ACCEPTED stage=S1`** at 08:01:52Z; state "PLANNED RESULT PRESENT (every reviewed row is present)" |
| Planned change | 1 `import_batches` row + 7 `captaincies` rows (Melbourne 2008 Bruce and McDonald; Gold Coast 2017–2018 May; Gold Coast 2019–2021 Witts). Nothing updated or deleted by design. |

Limits of this evidence: the per-row read-back is the stage tool's own verification and the wrapper's state probe; I did not run an additional ad-hoc SQL count. No ANALYZE was run (no grant is authorised). Nothing was retried, restored or rolled back.

Evidence (scoped, no production data): `docs/v2/evidence/gap029-s1-apply-20261103/` (apply, report and accept session logs, approval statement, run/plan/manifest/target).

## 2. S2 — preparation result

Order gate passed ("S1 accepted: b27aea625a3d5fa2"). Same pinned checkout, same profile, same restore workspace.

| Item | Value |
|---|---|
| Run | `S2-20261103T080332Z` (workstation `D:\tmp\gap029-prod\runs\S2-20261103T080332Z`) |
| Preflight | identity `afldb_prod` OID 66668, system id 7674454702926115004, ledger 118; actor `auth_users.id 1` super_admin, sole enabled Super Admin; no conflicting writer |
| Fresh backup (taken after S1) | captured 2026-11-03T08:03:33Z, 30,090,314 bytes, sha256 **`de596efd59994d7d9e3592bfac77a74e685bfcd7b7f2fdcf6fb52da49cc8f524`** (a different file from S1's backup) |
| Restore (streamanator, isolated cluster 127.0.0.1:55493) | `afldb_v2_gap029_s2_20261103_080332_rst_test`; DEV services unchanged before and after (MainPIDs 1677 / 1536) |
| `restore-evidence.json` sha256 | `80c0f74b5a8ab77a5a3469c3cdf0aed87f38340b84e1e8660821bb3bb267c826` |
| `backup.json` sha256 | `93b650b7a8cb2ae6a533c1794ec2142b5aa4d9e82afbdf823597c3b867c160fc` |
| `child.json` sha256 | `d6251609b12f48ad1c48a8bd33482820e606e123f9b12fa16a3769e6b7f15d6e` |
| `plan.json` / `manifest.json` sha256 | `9c90a4a021f13577fe29f63fbbcba33cb269fa2d97a3b1caa9d1cb41fc05f401` / `c056e16c60f3844bbd552254d5b9d7c0422ded70e30e314f2dccb3a98fe3b29d` |
| **Plan digest** | **`fc39483a2fa8217265a472681c71a9bf3eb80bdd865f51ccb56c4d714ec8d9c3`** |
| State against the plan | `BASELINE` (not applied) |
| Plan expiry / approval limit | plan expires 2026-11-04T08:04:33Z; **an approval must expire before `2026-11-04T07:43:33Z`**; apply also refuses with under 20 min of backup freshness left |

**What S2 would do:** DraftGuru link-only promotion — the `draft_picks` link columns only, through the unmodified importer `gap029-draft-link-production.py` in its **own transaction**, label `annual-html-20260826`. Expected after-state `a186c592cffeffa1…`; counts bridges 3562, withheld 1495 (1493 `U-no-href`, 2 `different_person_wrong_href`), expected bridged 3559, decided persons in bridge: Matt Rendell, Nathan Fyfe, Ryan O'Keefe. Write set: `draft_persons` (player_id, link_status, match_method, confidence_notes, is_matching_backlog), `draft_picks` (player_id, link_status_value, match_method, confidence_notes), `external_identities` (player_id, status, match_method).

**Different risk profile from S1 (owner should read this before approving):** the importer commits in its own transaction, so a failure mid-write may be reported as `OUTCOME_UNDETERMINED`, and recovery is an owner-decided restore from the S2 backup. The statement below carries that acceptance explicitly.

### S2 apply approval for review (D2-PROD) — populated except the window

> I approve D2-PROD: apply, once, to afldb_prod (database OID 66668, system identifier 7674454702926115004) the digest-pinned S2 plan fc39483a2fa8217265a472681c71a9bf3eb80bdd865f51ccb56c4d714ec8d9c3 (DraftGuru link-only promotion (draft_picks links)), at execution revision f05a2e78fdd0d90824789ab81ee2d2e4ffe3ab8f, after this stage's own fresh restore-verified backup de596efd59994d7d9e3592bfac77a74e685bfcd7b7f2fdcf6fb52da49cc8f524 (restore evidence 80c0f74b5a8ab77a5a3469c3cdf0aed87f38340b84e1e8660821bb3bb267c826; evidence class GENUINE_PRODUCTION). Through gap029-draft-link-production.py with child sha256 d6251609b12f48ad1c48a8bd33482820e606e123f9b12fa16a3769e6b7f15d6e and label annual-html-20260826. I accept that the importer commits in its own transaction, that a failure mid-write may be reported as OUTCOME_UNDETERMINED, and that recovery is an owner-decided restore. Nothing else. No retry and no automatic restore. Window: from `<START>` until `<EXPIRY, not later than 2026-11-04T07:43:33Z>`.

Owner commands after approval (workstation `D:\dev\afldb`, Windows OpenSSH):

```text
node --import tsx tools/v2/gap029-stage.ts approve --run-dir D:\tmp\gap029-prod\runs\S2-20261103T080332Z --digest fc39483a2fa8217265a472681c71a9bf3eb80bdd865f51ccb56c4d714ec8d9c3 --expires <ISO-8601 UTC ending in Z, <= 2026-11-04T07:43:00Z> --not-before <START>
node --import tsx tools/v2/gap029-stage.ts apply   --run-dir D:\tmp\gap029-prod\runs\S2-20261103T080332Z
node --import tsx tools/v2/gap029-stage.ts report  --run-dir D:\tmp\gap029-prod\runs\S2-20261103T080332Z   (only if the apply session drops)
node --import tsx tools/v2/gap029-stage.ts accept  --run-dir D:\tmp\gap029-prod\runs\S2-20261103T080332Z
```

Evidence (scoped): `docs/v2/evidence/gap029-s2-prep-20261103/` (prepare log, plan, manifest, run, target, statement template). The dump, `backup.json`, `restore-evidence.json` and `child.json` stay private (workstation run dir; production `/home/arm/backups/afldb/gap029-S2-20261103T080332Z`; streamanator `/mnt/ssd/afldb-v2-gap029-prod-20261103/evidence-private/s2_20261103_080332`).

## 3. Correction: the two settle timers (documentation only; nothing changed)

The S1 handoff wrote that the "settle timer" was "inactive/disabled as before". That wording was ambiguous. Measured by the S1 and S2 preflights (read-only `systemctl`):

| Unit | State |
|---|---|
| `afldb-settle-afltables.timer` (AFL Tables) | **inactive, disabled** — AFL Tables settling is OFF |
| `afldb-settle-afl-api.timer` (AFL API match timer) | **active, enabled** — ON |
| `afldb-settle-afl-api-brownlow.timer` | inactive, disabled |

Neither timer was changed by this work. Note the AFL API timer being enabled is why every stage's wrapper checks for a conflicting writer/settle process immediately before apply; the S1 apply and S2 preflight both found none.

## 4. Housekeeping

Retained, not cleaned: S1 and S2 backups, restores and evidence on all three machines; the 16 GB simulation directory on streamanator (owner may delete). No push, production checkout update, deployment, build, restart, timer/switch change, grant or WSL access occurred. `.codex/` untouched.
