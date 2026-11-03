# V2-GAP-029 — S2 applied and accepted; S3 prepared (3 Nov 2026)

**GAP-029 remains open.** S1 and S2 are applied to production and technically accepted. S3 is prepared (read-only plan, own fresh backup) and **not approved or applied**. S4 is untouched.

Execution revision for everything below: **R = `f05a2e78fdd0d90824789ab81ee2d2e4ffe3ab8f`** (local `main`, unpushed; production checkout still `d00e07e3`, untouched). Predecessor: `docs/v2/gap-029-s1-outcome-and-s2-preparation-2026-11-03.md`.

## 1. S2 — measured outcome

| Item | Value |
|---|---|
| Approval | Owner D2-PROD, received **2026-11-03T08:17:12Z**; recorded window **08:17:12Z – 09:17:12Z** (60 min; shorter than the 2026-11-04T07:30:00Z cap). Approval file written 08:17:27Z. |
| Revalidation before approving | run.json revision, plan digest, dump and restore-evidence hashes, class GENUINE_PRODUCTION; plan, manifest, target, backup.json, child.json, restore-evidence.json and dump hashes all match the approved values; no executable bytes changed since R (only two `.diff` evidence files differ under `tools/`). |
| Run / plan | `S2-20261103T080332Z`, plan `fc39483a2fa8217265a472681c71a9bf3eb80bdd865f51ccb56c4d714ec8d9c3` |
| Gates (wrapper) | MANIFEST VERIFY PASS; CAPTURE CHECK PASS (dump `de596efd…c524`, ledger 118); APPROVAL CHECK PASS; no conflicting writer, migration or dump process; `afldb.service` active, MainPID 3326560 |
| Apply | one detached apply, single attempt, 08:17:38Z–08:17:45Z. Tool exit 0; **`OUTCOME COMMITTED_VERIFIED`**; wrapper exit 0; post-run probe **PLANNED RESULT PRESENT** |
| Report | `COMMITTED_VERIFIED`, exit 0, committed true, no notes; tool log sha256 `8dc8d8378d1c918c45e6b9d84a333498c45cae0b02d3b51ea8d548a04659b404` |
| Acceptance | **`ACCEPTED stage=S2`** at 08:17:57Z; "STATE PLANNED RESULT PRESENT (the gate's VERIFY passes)" |

Scope as planned: DraftGuru link-only promotion through `gap029-draft-link-production.py` (own transaction), label `annual-html-20260826`; expected after-state `a186c592cffeffa1…`, bridged 3559 (3562 bridges, 1495 withheld). Limits of this evidence: the verification is the importer/gate's own read-back plus the wrapper's state probe; I ran no additional ad-hoc SQL. No ANALYZE. Nothing retried, restored or rolled back. The AFL API timer was enabled throughout; the wrapper's pre-apply writer check found no conflicting process.

Evidence: `docs/v2/evidence/gap029-s2-apply-20261103/`.

## 2. S3 — preparation result

Order gate passed ("S2 accepted: b0be3dedbc19fba1"). Same pinned checkout, profile and restore workspace.

| Item | Value |
|---|---|
| Run | `S3-20261103T081918Z` (workstation `D:\tmp\gap029-prod\runs\S3-20261103T081918Z`) |
| Preflight | identity `afldb_prod` OID 66668, system id 7674454702926115004, ledger 118; no conflicting writer |
| Actor-1 viability (read-only) | `auth_users.id 1`: super_admin, enabled, enrolled, non-fixture e-mail; **enabled Super Admin count = 1**. Owner e-mail comparison "unchecked" (as in S1/S2). The plan notes **"actor 1 is asserted only at apply"** — the stage tool re-checks inside the apply transaction. |
| Fresh backup (taken after S2) | captured 2026-11-03T08:19:19Z, 30,134,346 bytes, sha256 **`628749cea9b74b67677e227ddc2e2026c83ec5b596935e6cf1fd3780dc624a54`** |
| Restore (streamanator, isolated cluster 127.0.0.1:55493) | `afldb_v2_gap029_s3_20261103_081918_rst_test`; `pg_restore` exit 0, 0 stderr lines, ledger 118, 1651 TOC entries; DEV services unchanged (MainPIDs 1677 / 1536) |
| `restore-evidence.json` sha256 | `cb511373512cce28212ff98fa57a1a1576abc35365126902b253e454c323e14c` |
| `backup.json` sha256 | `ed7fd456d9e6e6af7482bb33ff2744da9d166952989c563d21595019415452fd` |
| `plan.json` / `manifest.json` sha256 | `3b2eb4d18640931fce1ff3537d9bd93ec3202e1d51e0df94de1908c2f3314738` / `4cd97d6ce1b67e8e976ed2e4bc1ad61ea8054f67865113605c3a8629825a6985` |
| **Plan digest** | **`cca95f3ad992a1c4807afbc107d79ab6ef277aa71a5e44190d23dfcef65435f0`** |
| State against the plan | `BASELINE` (8 to insert, 0 already present) |
| Plan expiry / approval limit | plan expires 2026-11-04T08:20:21Z; **an approval must expire before `2026-11-04T07:59:19Z`**; apply also refuses with under 20 min of backup freshness left |

**Expected changes (exactly):** 8 manual rookie selections in `draft_picks` through the audited editor as actor `auth_users.id 1`, each with its `data_overrides` and `data_edits` audit row: pick 54 Adam Schneider, 35 Lachie Henderson, 3 Phil Davis, 11 Sam Reid, 10 Lewis Taylor, 21 Paul Seedsman, 2 Michael Rischitelli, 1 Bryce Gibbs.

### S3 apply approval for review (D3-PROD) — populated except the window

> I approve D3-PROD: apply, once, to afldb_prod (database OID 66668, system identifier 7674454702926115004) the digest-pinned S3 plan cca95f3ad992a1c4807afbc107d79ab6ef277aa71a5e44190d23dfcef65435f0 (eight manual rookie selections (draft_picks via the audited editor)), at execution revision f05a2e78fdd0d90824789ab81ee2d2e4ffe3ab8f, after this stage's own fresh restore-verified backup 628749cea9b74b67677e227ddc2e2026c83ec5b596935e6cf1fd3780dc624a54 (restore evidence cb511373512cce28212ff98fa57a1a1576abc35365126902b253e454c323e14c; evidence class GENUINE_PRODUCTION). Exactly the eight manual rookie selections named in the plan, through the audited editor path as actor auth_users.id 1, my active, fully enrolled Super Admin. Nothing else. No retry and no automatic restore. Window: from `<START>` until `<EXPIRY, not later than 2026-11-04T07:59:19Z>`.

Owner commands after approval (workstation `D:\dev\afldb`, Windows OpenSSH; Git Bash needs `MSYS_NO_PATHCONV=1`):

```text
node --import tsx tools/v2/gap029-stage.ts approve --run-dir D:\tmp\gap029-prod\runs\S3-20261103T081918Z --digest cca95f3ad992a1c4807afbc107d79ab6ef277aa71a5e44190d23dfcef65435f0 --expires <ISO-8601 UTC ending in Z, <= 2026-11-04T07:59:00Z> --not-before <START>
node --import tsx tools/v2/gap029-stage.ts apply   --run-dir D:\tmp\gap029-prod\runs\S3-20261103T081918Z
node --import tsx tools/v2/gap029-stage.ts report  --run-dir D:\tmp\gap029-prod\runs\S3-20261103T081918Z   (only if the apply session drops)
node --import tsx tools/v2/gap029-stage.ts accept  --run-dir D:\tmp\gap029-prod\runs\S3-20261103T081918Z
```

Evidence (scoped): `docs/v2/evidence/gap029-s3-prep-20261103/`. The dump, `backup.json` and `restore-evidence.json` stay private (workstation run dir; production `/home/arm/backups/afldb/gap029-S3-20261103T081918Z`; streamanator `/mnt/ssd/afldb-v2-gap029-prod-20261103/evidence-private/s3_20261103_081918`).

## 3. Housekeeping

Retained, not cleaned: S1–S3 backups, restores and evidence on all three machines; the 16 GB simulation directory on streamanator (owner may delete). No push, production checkout update, deployment, build, restart, timer/switch change, grant or WSL access occurred. `.codex/` untouched. AFL Tables timer disabled, AFL API match timer enabled, as before.
