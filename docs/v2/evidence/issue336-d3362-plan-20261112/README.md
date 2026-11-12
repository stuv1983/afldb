# D-336-2 Steps A–D at the ISSUE-349 ops pin (2026-11-12): PLAN COMPLETE, stopped before approval

Contract: `docs/v2/issue349-d3362-preparation-2026-11-12.md` (the `docs/v2/issue336-d3362-approval-packet-2026-11-11.md` §4 direct
route with R, OPS and the tarball replaced), under the owner's fresh A+B and C+D approval of 2026-11-12. The ISSUE-349 fix range
`595dc394..ae47f94f` was published by fast-forward first (remote re-read: `origin/main` = `ae47f94fae15c6361598f8bd3bd82f10e62550af`).
**No database write, restart, timer, application or configuration change. E+F (OD-4) is not approved.** The failed morning run
`I336-20261112T010605Z` (old pin `c1c4b22e`) and its capture are preserved unchanged; this run did not reuse them.

| Item | Value |
|---|---|
| Ops revision R | `a25306f930015acef602bcc60d76613bdcc3d466` |
| OPS | `/home/arm/ops/gap029-stages/a25306f9` (new, mode 700) |
| Tarball | streamanator `/mnt/ssd/afldb-i349-20261112/green-pack/pack-a25306f9/cand.tar.gz`, sha256 `48f43dc840a6f97e0b24b588ff50cd04463521eb6377c94f1a3527780d353685` |
| RUN | `I336-20261112T025001Z` |
| Capture | `/home/arm/backups/afldb/gap029-I336-20261112T025001Z` (mode 700) |
| **Backup (dump) sha256** | **`0d517f5a3db7ccb887615df2c3fa3f136918f5dd4941df939e7e1a8d843a34c6`**, 29,953,917 bytes, 1,651 TOC entries, captured 2026-11-12T02:50:02.929Z |
| Restore workspace | streamanator `/mnt/ssd/afldb-i336-prod-20261112T025043Z` (cluster stopped) |
| **Plan digest** | **`afa26158781c0538166302be05d440a79af9ab805f8143f218c5cf804e90f608`** |
| Plan file sha256 | `3c7580acf30d036e642813a054857f3b0d05607eb99703d13d16c710a94cbaed` |
| Manifest sha256 | `636d83ea9c40d5657ab1b2185b9f93ebc68e07aa9bc6359ab3228abaf2f60710` |
| Plan expiry | 2026-11-13T02:52:02.953Z; approvals must expire before **2026-11-13T02:30:02.929Z** (13:30 AEDT) |

| Step | Time (UTC) | Result | Output |
|---|---|---|---|
| A pack check | 02:47 | streamanator: tarball sha256 equal; extracted to a temporary directory: HEAD = R, dirty 0, tracked 5,801, two `TimeZone: 'Etc/UTC'` pins; temporary directory removed | `scripts/packcheck.sh` |
| A upload | 02:48 | Workstation copy sha256 equal; OPS did not exist; uploaded, sha256 equal on production; previous run directory present | `stepA-upload.txt` |
| A prep | 02:49:34–02:49:41 | `DONE prep`: pinned checkout at R, tracked 5,801, dirty 0; production checkout unchanged (`c1c4b22e`, 0 status lines); profile production, GENUINE_PRODUCTION, profile sha256 `9bee98b5…8170` (unchanged) | `stepA-prep.txt` |
| B preflight | 02:49:51 | `PREFLIGHT_OK`: `afldb_prod` OID 66668, system 7674454702926115004, ledger 118; actor 1 super_admin enabled and enrolled; 1 enabled Super Admin; no writer | `stepB-preflight.txt` |
| B capture (once) | 02:50:01–02:50:16 | `CAPTURE_COMPLETE`. `pg_dump` exit 0, 0 stderr bytes; ledger digest `573594e9…af57` before and after; writers unchanged; `TARGET_SHA256 5b0a54ee…79b9` (equal to the morning run) | `stepB-capture.txt`, `target.json` |
| C copy | 02:50 | Workstation `sha256sum -c` 6/6 OK; streamanator `sha256sum -c` OK | |
| C workspace | 02:50:43 | `RESTORE_WORKSPACE_READY` at R; setup script byte-identical to the old pin's | `stepC-setup.txt` |
| C restore + assembly | 02:51:18–02:51:37 | `ASSEMBLY_COMPLETE stage=I336 class=GENUINE_PRODUCTION`. `pg_restore` exit 0, 0 stderr lines; restore evidence sha256 `c44872bd…8b53` (118 ledger rows, 1,651 entries); sealed `backup.json` sha256 `632b1032…eb0f`, `baselineDigest 6a5c7dfd…21ae`. No `WARN port still listening`; port 55493 closed; DEV services unchanged | `stepC-assemble.txt`, `backup.json`, `restore-evidence.json` |
| D upload | 02:51 | `backup.json`, `restore-evidence.json` in the run directory, sha256 equal | `stepD-upload.txt` |
| **D plan** | 02:52:00–02:52:05 | **`PLAN_COMPLETE`**, exit 0: 35 to insert, 31 new persons, 0 already present; `STATE BASELINE` (re-verifies the plan digest); manifest written | `stepD-plan.txt`, `plan.json`, `manifest.json` |

The sealed `baselineDigest` equals the UTC digest the morning's read-only diagnosis computed on production (`6a5c7dfd…21ae`), and the
plan's live-baseline check now passes against it: the ISSUE-349 fix works on the `Australia/Melbourne` production server.
`plan` printed a harmless coreutils warning (`cp: warning: behavior of -n is non-portable`).

## Proposed OD-4 window (not approved)

Constraints: approval expiry before 2026-11-13T02:30:02Z; window at most 90 minutes (packet §4 Step E); the only active production timer,
`afldb-settle-afl-api.timer`, fires at 05:00 AEDT plus up to 15 minutes (next 2026-11-13 05:13:06 AEDT).

- **Proposed:** 2026-11-12 16:00–17:30 AEDT (`2026-11-12T05:00:00Z`–`2026-11-12T06:30:00Z`).
- **Fallback:** 2026-11-13 09:00–10:30 AEDT (`2026-11-12T22:00:00Z`–`2026-11-12T23:30:00Z`), after the nightly settle.

After 13:30 AEDT on 2026-11-13 this capture can no longer be approved; a new capture, assembly and plan would be needed.
