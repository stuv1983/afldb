# D-336-2 Steps A–D on production (2026-11-12): STOPPED at the plan (AFLDB-ISSUE-349)

Contract: `docs/v2/issue336-d3362-approval-packet-2026-11-11.md` §4 with the prepared tarball, under the owner's A+B and C+D approvals,
run after the r2 application release was accepted (2026-11-12). **No database write. E+F was not reached and is not approved.**

| Step | Time (UTC) | Result | Output |
|---|---|---|---|
| A tarball | 01:04 | Prepared tarball fetched from streamanator `/mnt/ssd/afldb-i336-simpack-20261111/pack-c1c4b22e/cand.tar.gz`: sha256 `3160b9d3…5b8a` (pinned) | |
| A upload | 01:04 | `/home/arm/ops/gap029-stages/c1c4b22e/in/cand.tar.gz` (new directory, mode 700), sha256 equal on production | `stepA-upload.txt` |
| A prep | 01:05:03–01:05:10 | `DONE prep`: pinned checkout at R `c1c4b22e`, 4,998 tracked, dirty 0; production checkout unchanged (R, 0 status lines); profile production, class GENUINE_PRODUCTION | `stepA-prep.txt` |
| B preflight | 01:05:38 | `PREFLIGHT_OK`: `afldb_prod` OID 66668, system 7674454702926115004, ledger 118; actor 1 super_admin enabled and enrolled; 1 enabled Super Admin; no writer | `stepB-preflight.txt` |
| B capture | 01:06:05–01:06:17 | `CAPTURE_COMPLETE`, RUN `I336-20261112T010605Z`. `pg_dump` exit 0, 0 stderr, 11 s; **dump sha256 `d61c7865cbea14e3e3f86a975b5e5d716fcd729d9965fa2f1c52afd81163fbcc`**, 29,953,917 bytes, 1,651 TOC entries; ledger digest equal before and after; writers unchanged. Capture `/home/arm/backups/afldb/gap029-I336-20261112T010605Z` (mode 700). `TARGET_SHA256 5b0a54ee…79b9` | `stepB-capture.txt`, `target.json` |
| C copy | 01:06–01:07 | Workstation copy `sha256sum -c` OK; streamanator copy `sha256sum -c` OK | |
| C workspace | 01:07:13 | `RESTORE_WORKSPACE_READY /mnt/ssd/afldb-i336-prod-20261112T010713Z` at R | |
| C restore + assembly | 01:07–01:08 | `ASSEMBLY_COMPLETE stage=I336 class=GENUINE_PRODUCTION`. `pg_restore` exit 0, 0 stderr; restore evidence sha256 `1a3a26f3…b5c1b5` (118 ledger rows, 1,651 entries); sealed `backup.json` sha256 `065940c4…8c03`, `baselineDigest 6a5c7dfd…21ae`, import batches 84. No `WARN port still listening`; port 55493 closed afterwards | `stepC-assemble.txt`, `backup.json`, `restore-evidence.json` |
| D upload | 01:08 | `backup.json` and `restore-evidence.json` in the run directory, sha256 equal | `stepD-plan.txt` |
| **D plan** | 01:08:36 | **REFUSED, exit 6:** `ISSUE-336 insert refused: baseline drift: the restored backup no longer matches the live target`. "nothing was written to the database"; no plan file | `stepD-plan.txt`, `stepD-plan-log.txt` |

## Diagnosis (read-only, 01:1x UTC)

`scripts/tzdiag.mts` recomputes the tool's `surfaceDigest` (`tools/v2/issue336-predraft-insert-production.ts:199-205`) on production, in one
read-only repeatable-read transaction (`transaction_read_only on`), first in the session's default time zone and then after
`SET LOCAL TIME ZONE 'Etc/UTC'`. Output `output/tzdiag-prod.txt`:

| | default (`Australia/Melbourne`) | `Etc/UTC` |
|---|---|---|
| surface digest | `b6679e30…c656` | **`6a5c7dfd…21ae` = the restored backup's `baselineDigest`** |
| `draft_picks` 6,818 rows | `37cc6436…` | `37cc6436…` |
| `draft_persons` 5,057 rows | `fd49dc7e…` | `fd49dc7e…` |
| `data_overrides` (draft_picks) 8 rows | `4c434488…` | `7ed62239…` |

Production's data equals the backup; import batches 84 on both sides. The digest renders `data_overrides.created_at`/`updated_at`
(`timestamptz`) through `to_jsonb(t)::text`, which follows the session `TimeZone`. Production's server time zone is `Australia/Melbourne`; the
isolated restore cluster is created with `timezone = 'Etc/UTC'` (`tools/v2/isolated-pg.ts:228`); the tool sets no session time zone. The
2026-11-11 simulation ran both sides on UTC clusters, so it could not see this. **Every production I336 plan refuses the same way at R.**

## State left

- Production: no database write. The pinned ops checkout and run directory `/home/arm/ops/gap029-stages/c1c4b22e/runs/I336-20261112T010605Z`
  (no plan file) and the capture directory are retained (mode 700). The diagnostic script is at `/home/arm/i336-tzdiag-20261112/` (no credential).
- The capture is fresh for 24 h (`MAX_AGE_MS`), until about 2026-11-13T01:06Z.
- streamanator: `/mnt/ssd/afldb-i336-prod-20261112T010713Z` (cluster stopped) and `/mnt/ssd/afldb-i336-simpack-20261111` retained.

Tracked as **AFLDB-ISSUE-349**.
