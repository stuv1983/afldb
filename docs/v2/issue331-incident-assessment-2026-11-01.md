# ISSUE-331 bounded incident assessment (2026-11-01)

Status: **assessment complete; cause of the deletions UNKNOWN; initiators NOT attributed. Closed 2026-11-01 on owner disposition (section 5): recovered, cause unestablished, uncertainty explicitly accepted.**
It separates what the records demonstrate from what they only suggest, and ends with the recorded owner disposition.

Scope and method. Read-only, metadata and log inspection of the three named roots only: `D:\tmp\afldb-v2-pg16` (isolated PostgreSQL
root), `D:\afldb-v2-rehearsal-20261020` (frozen WSL rehearsal store) and the WSL export copy
`AFLDB-V2-BrownlowExport-20261028` (base `C:\afldb-v2-brownlow-export-20261028`). Nothing was mounted, started, hashed, modified,
re-pinned or re-credentialled. No forensic tool was installed and no drive was scanned. Sources, all local and narrowly filtered:
`Microsoft-Windows-VHDMP-Operational`, `System` (boot/shutdown/power/time), `Microsoft-Windows-Ntfs/Operational` (hourly free-space
summaries; the elevated USN journal was not available, the shell is not elevated), `Microsoft-Windows-Windows Defender/Operational`,
`Application`, the WSL registration keys, file metadata, the user's PowerShell history filtered on the named paths, the Recycle Bin,
and this project's Claude Code session transcripts filtered on delete/`wsl` commands. All times are local (AEDT, UTC+11) unless
marked Z. The Codex tooling's own session records were deliberately not read (outside the named roots).

## 1. Demonstrated facts

**F1. The frozen original was attached read-write and written to on 2026-10-31.**
The VHDMP log records `D:/afldb-v2-rehearsal-20261020\ext4.vhdx` and `C:\afldb-v2-brownlow-export-20261028\ext4.vhdx` surfaced
into one WSL utility VM (VM ID `b1d52a47-8355-4e83-830d-d7cb47219bbe`; handle `ReadOnly = false`, `WriteDepth = 1`) at **10:36:55**
(original) and **10:36:58** (copy). No detach event for either is logged afterwards. The hourly I/O summaries for the original show
**19.19 GB written** (15.44 GB to 11:36, 2.38 GB to 12:36, 1.37 GB to 19:37) and 30.49 GB read (mostly 25.86 GB in the hour to
12:36). The copy shows 0.69 GB read and 0.02 GB written in the first hour and nothing after. Earlier attach windows for the same
disks are the documented ones: original 2026-10-26 10:02-10:15, copy 2026-10-28 14:39-16:38.
Consequence: the size and mtime change of `ext4.vhdx` (37,885,050,880 to 47,045,410,816 bytes, +9,160,359,936; mtime 2026-10-31
20:33:45) is explained mechanically by a writable WSL session on that day. It is no longer an unexplained drift in kind; **who or what
started that session is not recorded in any log examined.**

**F2. The machine was hard-reset that evening.**
`System` records an unexpected shutdown with last-alive timestamp 20:09:47, an OS start at 20:36:50, a second unexpected shutdown
at 20:37:19 (Kernel-Power 41, `BugcheckCode` 0, i.e. not a bugcheck; the second carries a power-button timestamp of 20:37:28) and
an OS start at 20:37:54. The original's last write (20:33:45) falls inside that unclean-shutdown window with the disk still attached
and no logged detach. The disk was not checked after the resets, so its internal filesystem state is unknown.

**F3. The export copy's base directory was removed by file deletion, not by WSL unregistration, between about 00:38 and 01:29 on 2026-11-01.**
The registration key still exists (`BasePath \\?\C:\afldb-v2-brownlow-export-20261028`, `State 1`); `wsl --unregister` would have
removed it. The base existed when documented on 2026-10-28 and was still attached with logged I/O at 11:36 on 2026-10-31; a
`Test-Path` on it returned **False at 01:29** on 2026-11-01 (session transcript, 2026-10-31T14:29Z). The NTFS hourly summary for `C:` to 01:38 shows available space between 34.72 GB and 75.14 GB, a
40.42 GB swing; the recorded size of the copy's disk is 40,905,998,336 bytes. That is consistent with the file's removal in the
00:38-01:38 interval; it is a correlation, not a proof. The user's PowerShell history contains no command naming the path, and the
Recycle Bin is empty (a disk this size would bypass it, so that is weak evidence).

**F4. The isolated root lost specific subtrees, not everything, with a precise time.**
Surviving under `dist\pgsql\bin` are exactly 13 files: `postgres.exe` and 12 DLLs (`icudt67`, `icuin67`, `icuuc67`,
`libcrypto-3-x64`, `libiconv-2`, `libintl-9`, `liblz4`, `libssl-3-x64`, `libwinpthread-1`, `libxml2`, `libzstd`, `zlib1`): the
executable image and libraries mapped by the running postmaster, which Windows will not delete. Everything else under `dist\pgsql`
(`lib`, `share`, `pg_ctl`, the other tools), plus `secrets\` and `download\`, is gone. `data\` and `logs\` are intact. The last
directory change in `dist\pgsql\bin` is **00:50:54** and the first logged failure is 00:51:04, ten seconds later. The pattern is
what a recursive delete of `secrets`, `download` and `dist` would leave when it is blocked only on in-use files.

**F5. No evidence found in the examined records for these explanations (each is excluded only to the extent stated).**
- Microsoft Defender: no evidence found in the examined records: **zero** detection, remediation or quarantine events (ids 1006-1009, 1116-1119) from 2026-10-26 to
  2026-11-01 03:00; only routine configuration-hash change notices.
- Storage faults: no evidence found in the examined records: no disk, volmgr or NTFS error events in the window; the one NTFS latency warning names an unrelated
  `chrome.exe` file.
- Disk exhaustion at the time of loss: this one the interval summary does rule out for 00:50: `D:` held at 2.45-3.9 GB available through 31 Oct, but the interval summary to 01:38 shows
  at least 62.8 GB available throughout, so `D:` was not full at 00:50.
- WSL unregistration of the copy (F3: the registration key still exists, so this one is excluded by the key's presence) and a Windows update/reboot at the time (no evidence found in the examined records: no boot events between 20:37:54 on 31 Oct and the
  assessment).
- This project's own Claude Code sessions: no evidence found in the examined records: seven transcripts covering 2026-10-31 21:59 to 2026-11-01 06:33 contain **no** delete,
  `--unregister` or `wsl --shutdown`/start command naming the three stores. Their deletes are `rm -rf /d/tmp/afldb-gap006-visual-20261031`
  (a scratch directory, 23:44) and repository evidence directories. One session started an integration run through
  `tools/v2/isolated-pg.ts` at 00:50:15, 39 seconds before the F4 directory change; the seven test files in that run contain no
  filesystem delete (their `child_process` use is Python `psycopg` probes), and `isolated-pg.ts`'s only unlink removes a
  pending-marker file. This is **adjacency without a mechanism**, recorded so it is not rediscovered as a lead.

**F6. Other documented retained locations are also absent, and `D:` was bulk-reclaimed.**
Absent now: `D:\tmp\afldb-v2-b1wsl-20261028` (WSL evidence copy, manifest `34cf4f8e...`), `D:\tmp\afldb-v2-i265b-20261028`,
`D:\tmp\afldb-v2-rebuild-capture`, and `D:\tmp\afldbV2-source-snapshot-20261019` (the 2026-10-19 preservation snapshot cited by
`docs/v2/baseline.md` and `final-report.md`; the 19 files themselves are in V2 commit `c9cca86d`, but the snapshot's status and
patch records are not). Present: `D:\tmp\afldb-gap006-brownlow-artifacts-20261101`, `D:\tmp\afldb-gap006-recovery-20261101`, the
original isolated root and the frozen rehearsal root. The NTFS summaries show `D:` free space rising by 60.51 GB (interval to
00:38) and 68.61 GB (interval to 01:38), about 129 GB in total, while the frozen disk (47 GB) remains. The 23:44 `rm -rf` of the
visual scratch directory lies inside the first interval and may account for part of it; **nothing in the records accounts for the
rest.**

## 2. Hypotheses (not demonstrated; do not treat as findings)

- **H1.** One space-reclamation clean-up, by an agent session or by hand, removed the export copy, several `D:\tmp` scratch and
  evidence directories, and the `secrets`/`download`/`dist` subtrees of the isolated root, while `D:` was nearly full. Supported by F3,
  F4, F6 and the free-space series; not supported by any record that names an actor.
- **H2.** A tool that enumerates registered WSL distributions started the 10:36 session (both disks attached within three seconds).
  Supported only by the timing.
- **H3.** The delete of F4 was a deliberate credential/binary clean-up of the isolated root (it removed `secrets\`). No evidence either way.
- H1-H3 are independent; any, all or none may hold. The attribution gap is **retained uncertainty**.

## 3. Integrity consequences (historical proof stays historical)

- The 2026-10-28 binding of the original (`ext4.vhdx` 37,885,050,880 bytes, mtime 2026-10-25T23:15:52Z, sha256 `589597c5...`)
  was true when recorded and is **historical only**. The original is now a **changed store**. It is not a baseline, must not be
  re-hashed and re-pinned as if it were the frozen artefact, and no gate or claim may rest on it.
- Results that previously depended on the frozen store were re-derived from independently verified inputs on 2026-11-01 (the
  Brownlow artefacts from DEV, consistent with the record but not a proven historical full-hash match; 8/8 isolated result). That
  limitation stands.
- The export copy is gone. Its exposed-credential problem (same passwords as the original, recorded 2026-10-28) is **not** resolved
  by its disappearance: the original and earlier transcripts still carry those passwords.
- The isolated root `D:\tmp\afldb-v2-pg16` is a **changed environment**. Its data directory was verified intact and identical to the
  cold backup and the recovery copy (manifest sha256 `b32809e8...b033`); that manifest, not the original root, is the reference.
- The preservation snapshot loss weakens, but does not remove, the provenance in `docs/v2/baseline.md`: the imported files are in
  Git; only the snapshot's capture-time status/patch records are unrecoverable.

## 4. Owner disposition (recommended; none is executed)

| ID | Decision | Recommendation |
|---|---|---|
| D-331-1 | Accept this assessment as the incident record: facts F1-F6, hypotheses H1-H3 unproven, cause UNKNOWN, no actor attributed | Accept. Further inquiry would need the Codex tool's own records or an elevated USN-journal read, both outside this assessment's authority |
| D-331-2 | Frozen original `AFLDB-V2-Rehearsal-20261020` | **Quarantine**: classify as CHANGED, never boot or hash it as evidence, keep it until you confirm nothing else needs its 2025 template or production-restore content (every artefact needed since has been re-obtained). Retirement (`wsl --unregister` and deleting the base) is yours to run later and is irreversible. Rotate the shared role passwords by retiring it rather than by editing it |
| D-331-3 | Dangling `AFLDB-V2-BrownlowExport-20261028` registration | Run `wsl --unregister AFLDB-V2-BrownlowExport-20261028` yourself. It has no disk, so nothing is lost; it removes a misleading registration |
| D-331-4 | Future use of the changed stores | The only sanctioned isolated environment is the verified recovery copy (or a new root built from the vendor binaries), referenced by manifest `b32809e8...b033`. The original root stays untouched; delete it when you no longer want the cold-backup comparison |
| D-331-5 | Closure | Either close ISSUE-331 as "cause unestablished, accepted by owner, with the retained uncertainty above" once D-331-1 to D-331-4 are recorded, or keep it open until an initiator is identified. Recommended: close on those terms |

Preventive measures worth considering (not implemented, not required for closure): keep the retained stores on a volume that is
never the scratch volume; make retained evidence read-only at the file level; alert on `D:` below 10 GB; treat an operation that
needs space as a prompt to ask rather than reclaim.

## 5. Owner disposition recorded 2026-11-01 (supersedes the recommendations in section 4)

| ID | Disposition |
|---|---|
| D-331-1 | **Accepted** as the incident record: cause UNKNOWN, no actor attributed. Negative findings are worded "no evidence found in the examined records" except where the evidence actually excludes a cause (section 1, F5 states which). |
| D-331-2 | The changed original stores (`D:\afldb-v2-rehearsal-20261020`, the original isolated root `D:\tmp\afldb-v2-pg16`) are **logically quarantined**: retained untouched, never booted, never used as a baseline, their changed bytes never hashed and re-pinned as evidence. |
| D-331-3 | **Deferred.** Nothing is unregistered or deleted. In particular `wsl --unregister AFLDB-V2-BrownlowExport-20261028` is not run. Physical cleanup is not a condition of closure. |
| D-331-4 | Future tests use the verified recovery environment (manifest `b32809e8...b033`) or fresh, uniquely credentialled environments. |
| D-331-5 | **ISSUE-331 closed** as recovered, cause unestablished, uncertainty explicitly accepted. |

Retained after closure (not resolved by it): the artefact-binding limitation (Brownlow inputs are consistent with the record, not a
proven historical full-hash match) and the separate exposed-credential follow-up (the shared role passwords remain in the original
store and earlier transcripts; the disappearance of the export copy does not resolve exposure, and retiring or rotating them is a
separate, owner-run step that this closure does not perform).

## 6. Reopening 2026-11-01 (evening): quarantined store used as a Linux runtime host

**This is a separate, later event. It does not explain, and must not be used to explain, the earlier disappearance, which stays
cause UNKNOWN (section 1, section 5 D-331-1).**

### 6.1 What happened (from the batch's own committed records)

The 2026-11-01 readiness batch ran its "isolated Linux qualification" **inside the quarantined distro**
`AFLDB-V2-Rehearsal-20261020`, in breach of D-331-2 ("never booted"). Source records: commit `151f7f00` (20:02:16 local) and
`docs/v2/master-execution-sequence-2026-11-01.md` section 8.1; driver fixes `ac6732c0` (19:30) and `f2e5540c` (20:00). They name
the workspace `/home/rehearsal/qual-20261101`, a new cluster on 127.0.0.1:55490 under `/home/rehearsal/qual-pg-20261101`, the
distro's own Linux `node_modules`, Node v22.21.0 and PostgreSQL 16 binaries taken from the distro, and evidence in
`/home/rehearsal/qual-evidence-20261101/`. The records also state that a first C4b run left an orphan victim process that was
killed by hand. The number and times of boots are **not independently recorded**: no Hyper-V compute or worker events exist for the
period, so only the file times below bound them.

### 6.2 Containment facts (read-only, Windows side, 2026-11-01 about 20:11 local)

| Item | Fact |
|---|---|
| Registration | `HKCU\...\Lxss\{0cb6e2c4-5caa-4c0b-ba1e-25953010be02}`, name `AFLDB-V2-Rehearsal-20261020`, BasePath `D:/afldb-v2-rehearsal-20261020` (forward-slash form as registered), State 1, Version 2, default uid 0 |
| Run state | **Stopped.** `wsl --list --running` reports no running distribution; no `wsl`, `wslhost`, `vmmem` or `vmwp` process exists (only `wslservice`, started 2026-10-31 20:38:06). Nothing needed stopping; nothing was started |
| Store files | `ext4.vhdx` 51,419,021,312 bytes, created 2026-10-20 10:54:15, **last write 2026-11-01 20:03:09 local** (09:03:09Z), NTFS file ID `0x000000000000000000040000005f50a6`; `previous-reviewed.tar` (117,606,400) and `v2-reviewed.tar` (207,329,280) and `shortcut.ico` are unchanged since 2026-10-20 |
| Change since the last record | ISSUE-331 recorded 47,045,410,816 bytes, last write 2026-10-31 20:33:45. The store grew by **4,373,610,496 bytes** and was last written about one minute after commit `151f7f00`, which is the expected flush at distro shutdown |
| Identity | Identified by registry GUID, BasePath, file ID, size and times. The VHDX was deliberately **not hashed** (D-331-2: changed bytes are never hashed and re-pinned as evidence); a background hash started during this check was stopped and its partial output deleted. Its bytes are a CHANGED store and not a baseline, as before |
| Export base | `C:\afldb-v2-brownlow-export-20261028` still absent; `AFLDB-V2-BrownlowExport-20261028` still registered (D-331-3 deferred); `D:\tmp\afldb-v2-pg16` still present |
| Not done | no boot, unregister, deletion, re-pin, repair or retention change |

Windows-side `node ... isolated-pg` processes (PIDs 19600, 37280, 34440) and their launching bash scripts belong to the earlier
rollback serving probes on the Windows recovery environment. They are not part of this breach and were left alone.

### 6.3 Integrity implications

- Everything run in the distro (typecheck, focused suites 557 passed, C4b 36/36, labels 24/24) used a **toolchain from a quarantined,
  changed store**: Node, the PostgreSQL binaries and `node_modules` were not re-verified from source. The lock-file hash and the
  production backup hash (`3f5b5339…4730`, re-hashed on Linux) were checked, so the **data input** is sound; the **executables** are
  unproven. The results are retained and not erased, but they are **nonconforming-environment results, not authorised release
  qualification**, and no approval block may cite them as such. They are replaced by the correct Linux qualification (this
  record's successor, master sequence section 8.2).
- The store gained about 4.37 GB of new content (a workspace, a cluster, restored production-backup data, evidence). The quarantine
  already treated it as CHANGED; it is now also **contaminated with a restored copy of production-derived data** and with whatever
  credentials the new cluster used. It must be handled as sensitive when the owner eventually retires it.
- The shared role passwords from the earlier exposure remain in that store; this event neither fixes nor worsens that finding, but it
  reinforces that the owner-run rotation/retirement step is still owed.
- Evidence left inside the distro (`/home/rehearsal/qual-evidence-20261101/`) is **not readable without booting**, so it was not
  retrieved and is not claimed. The conversation transcript of the breaching session is retained by the client and was not edited.

### 6.4 Disposition for this reopening

ISSUE-331 is **reopened** for this confirmed use. D-331-2 stands and is restated: the store is not to be booted again by any
session, including to retrieve logs. Retiring it (`wsl --unregister`, deleting the base) remains the owner's irreversible act, after
deciding whether `/home/rehearsal/qual-evidence-20261101/` should first be exported by an owner-run boot. All new qualification
uses fresh disposable workspaces on the DEV host `streamanator` (owner-authorised 2026-11-01).

## 7. Second breach 2026-11-03: the quarantined distro was started again (separate from sections 1-6)

**This is a separate, later event. It does not explain, and must not be used to explain, the earlier disappearance (cause UNKNOWN,
section 1 and D-331-1), and it is separate from the 2026-11-01 evening event in section 6.**

### 7.1 What happened

During the GAP-029 ordered-execution session of 2026-11-03, `AFLDB-V2-Rehearsal-20261020` was started **despite the explicit
prohibition** (D-331-2: never booted, by any session, for any purpose, including to retrieve logs). Four commands ran inside it
(`uname`, `node -v`, `python3 -V`, `ls /home`; that session recorded them in
`docs/v2/gap-029-ordered-execution-handoff-2026-11-03.md` section 9.2) and the session then reported the distro **stopped**. That
stop was the session's own report and was not independently verified at the time; it is not upgraded here. The number of starts is
not independently recorded.

### 7.2 Correction of a claim

The earlier session wrote that it "wrote nothing", implying the store was unchanged. **That claim is withdrawn.** Starting a
distro mounts the ext4 filesystem inside `ext4.vhdx`, replays its journal and runs init; mount counters, last-mount metadata,
orphan cleanup, logs and caches can change even when every command run inside is read-only. "The commands were read-only" does not
establish that the store did not change, and the store was never opened to check.

### 7.3 Containment facts (Windows-side metadata only, 2026-11-03 about 14:53 local)

Read-only `Get-Item` and `Get-Process`. No WSL command was executed; nothing was mounted, opened, hashed, exported, copied,
unregistered or deleted.

| Item | 2026-11-01 evening record (section 6.2) | 2026-11-03 check |
|---|---|---|
| `ext4.vhdx` size | 51,419,021,312 bytes | **51,433,701,376 bytes** (+14,680,064 = 14 MiB) |
| `ext4.vhdx` last write | 2026-11-01 20:03:09 | **2026-11-03 12:59:20** |
| Created | 2026-10-20 10:54:15 | 2026-10-20 10:54:15 |
| WSL VM processes | none (`wslservice` only) | none: no `wsl`, `wslhost`, `vmmem`, `vmwp`; `wslservice` PID 5356 only |

The quarantined store **did change** after the first breach record. That is consistent with this boot. It is not proof that this
boot was the only start since 2026-11-01 (no Hyper-V or WSL event log was read). The process check says the distro is not running
now; it says nothing about the interval.

### 7.4 Integrity implications and disposition

- The store remains a CHANGED, quarantined, never-a-baseline artefact, now with two recorded boots.
- What the four commands printed is not evidence of anything: the toolchain inside is unverified.
- No GAP-029 result depends on the store. Each Windows result keeps its labelled environment (handoff section 10).
- D-331-2 stands and is restated. The owner-run decisions already owed are unchanged and not taken: whether to export
  `/home/rehearsal/qual-evidence-20261101/` by an owner-run boot, retirement (`wsl --unregister`, deleting the base) and
  credential rotation.
- ISSUE-331 stays Open; the original disappearance stays cause UNKNOWN.
