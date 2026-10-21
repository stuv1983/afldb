# ISSUE-316 local reconciliation and C0/C1 approval — 2026-10-21

**Latest: amended D-DEV-316-C1-APP-1 continuation approved; steps 3–6 passed. PAUSED at
step 7 for owner database creation (2026-10-21). No deployed DEV C1 acceptance yet.**

**Owner approved D-V2-316-C0C1-1 and D-DEV-316-C1-REFUSALS-1 (2026-10-21); the approved DEV
shell subset ran and PASSED 4/4. Full C0/C1 is NOT complete: deployed DEV app/audit acceptance
and C2 remain pending. Production NO-GO.**
The local preparation below involved no host access, acquisition, shared database writes,
deployment, rollover, season changes, timer/service changes, pushes, subagents or new worktrees.
The accepted fresh archive rehearsal, Brownlow implementation, builds and rollback exercises were
not repeated. Later operations are the filesystem-only DEV shell subset and the stopped
DEV application preparation attempt, each recorded below with its limits.

## Amended continuation — owner database creation checkpoint (2026-10-21)

Owner approval and exact amendment, verbatim:

> The owner approves the amended continuation of D-DEV-316-C1-APP-1.
>
> Resume the existing DEV attempt using one agent. Do not rebuild or replace the approved archive.
>
> The owner permits this one documented symbolic link:
>
> kit/node_modules/tsx/node_modules/.bin/esbuild
> → ../esbuild/bin/esbuild
>
> Before extraction, verify that:
>
> - It is the only symbolic link.
> - Its lexical and fully resolved target remain inside the approved package.
> - Its target exists as an ordinary packaged file.
> - No link chain, hard link, absolute member path, traversal entry or pre-existing filesystem link can redirect extraction outside the approved directory.
>
> Reject any other unexpected link or entry.
>
> The owner also permits reuse of the retained candidate root and uploaded archive, without overwriting existing files.
>
> All other restrictions and acceptance criteria remain unchanged.

**Baseline:** `v2/rebuild` HEAD `636b74ea190a9f362510f9c3bb74fa5f86a324a6` exactly;
remotes empty, only pre-existing untracked `.codex/` preserved. One agent, no subagents,
builds, local suites, package edits, re-upload, installation, cleanup or production access.
WSL reports no running distributions and was never started.

**Resume checks PASS:** `arm@10.0.40.100:22`, hostname `streamanator`, x86_64,
Node v22.23.2, 80,559,512 KiB free before extraction. Retained root contained exactly
`incoming` and the approved ordinary archive, with no extracted package/config/dump/run
directory. Candidate database absent (read-only catalog query); port 3201 free.
Local/remote archive 113,830,430 bytes, exact approved SHA-256
`c829da087f65a3a8145ad07db8d7d649bb7f93f8b293d66f85547cd375e40b0e`.

**Amended membership PASS:** 18,309 members, 13,210 regular files (including the manifest),
exactly one permitted symbolic link, zero hard links or unexpected/special/absolute/traversal/
duplicate/environment entries. Every member ancestor is a directory; `/`, `/home`, `/home/arm`,
root and incoming checked with lstat as ordinary directories, no pre-existing package path.
Lexical and fully resolved link target:
`afldb-v2-dev-candidate-fffef96f/kit/node_modules/tsx/node_modules/esbuild/bin/esbuild`.
Target is an ordinary packaged file, no link chain; resolved path stays inside the approved
package. Extracted link target reverified. Source metadata pins `fffef96fb079bfa975109fa2fdcf5552b51e5946`,
source archive SHA `c7b755b5…ce5cb6`, executable-source digest `fc12b4dd…69f0d`,
build ID `WkKKyr7KAoFmMb5QyM4MQ`. Both ops scripts match reviewed repository hashes.

**Extraction/hash verification PASS:** initial GNU tar invocation rejected incompatible
`--keep-old-files --no-overwrite-dir` before extraction (exit 2). Confirmed package still
absent; used supported `--keep-old-files` alone, extraction exit 0. No content overwritten,
gate relaxed or package altered. Independent `sha256sum -c FILES.sha256` and reviewed
`dev-candidate.sh verify` both passed **13,209/13,209**. Preflight passed with 77,831 MiB free,
exact Node/build ID, free port and absent candidate database.

**Steps 4–6 PASS:** source guard at 2026-10-21T00:45:39Z: ledger 110, last
`110_match_sheet_player_match_stats_authority.sql`; audit 1,073/max id 1,099; refused rows 0;
users 4; active sessions 0; matches 17,056; players 13,365; player_match_stats 695,499;
import_batches 62. Created only approved new mode-700 config/evidence/recovery/run dirs;
generated app.env/ops.env, each mode 600, without exposing values.

Fresh read-only backup as `afldb_backup`:
`/home/arm/issue316-v2-candidate-20261021/recovery/afldb_dev-20261021T004611Z.dump`,
**39,023,717 bytes**, SHA-256
`e271172fd338869c9097cc26c81baf7715887d50947a1e0df35328ae62f58c32`,
**1,549 TOC entries**. Before/after source count files byte-identical; dump hash rechecked OK.
Additional read-only source check: contiguous 001–110, **110/110 migration checksums match**
the packaged files under the runner's existing raw/LF/CRLF policy, zero drift, pending exactly
111–117; zero refusal rows, zero synthetic users and synthetic actor audit rows, zero source
default ACLs. No source database/schema write occurred. No aggregate source-count movement
was observed during the dump; ordinary concurrent V1 traffic need not be inferred.

**Checkpoint 2026-10-21T00:47:12Z:** candidate database absent, no pid file, port 3201 free;
candidate never started. No restore, migration, privileges, positive action or negative controls
run yet. **C1 acceptance PENDING. Only current blocker is owner CREATE DATABASE at step 7.**

Owner runs in their own interactive terminal (sudo password, if prompted, stays with owner):

```powershell
ssh -t dev "sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres"
```

Then exactly:

```sql
CREATE DATABASE afldb_dev_v2_candidate_test OWNER afldb_owner TEMPLATE template0
  ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8';
\q
```

After owner confirms creation, verify database identity, owner, encoding/locale and emptiness,
then resume original step 8. Do not rerun absence-dependent preflight/layout/envgen/dump.
Restore/migrations 111–117/privileges/action/audit/negative controls/original preservation/
shutdown acceptance remain required. C2 and all later authority are unchanged and separate.

**Evidence retained:** DEV root `/home/arm/issue316-v2-candidate-20261021/`, with archive,
extracted package, secure config, backup/hash, TOC and source counts; new local evidence at
`C:\Users\stuar\AppData\Local\Temp\claude\D--dev-afldbV2\77258a0a-3c50-46b6-b25d-0084ebe15f04\scratchpad\dev-app-continuation-20261021\`.
Includes `membership.json`, inspection code, verification/preflight/config-names/dump logs,
`source-preservation-checkpoint.json`, `handoff-status.txt`, WSL status and `remote-evidence/`
containing the copied secrets-free source counts/TOC. No config secrets or database dump copied
to the repository or printed. Earlier stopped-attempt record remains below as history.

## DEV application attempt — stopped at archive gate (2026-10-21)

Owner approval, verbatim:

> I explicitly approves D-DEV-316-C1-APP-1 exactly as specified in:
> docs/v2/issue316-dev-app-check-plan-2026-10-21.md §5, steps 0–15, and §9.
> Use one agent. Execute that approved DEV candidate check and record the result.

The owner additionally required the existing C: archive, WSL stopped, no rebuild/install/
cleanup, no package substitution or modification, no relaxed gates, no subagents, local
evidence on C:, retention on failure, and small explicit-path local commits with empty remotes.
Passwordless sudo was limited to the exact reviewed CREATE DATABASE statement; otherwise
database creation must be owner-run. The full approved decision wording remains in plan §9.

**Repository baseline:** branch `v2/rebuild`, HEAD
`e7be840372cebd951d472216a83df4feecbe9da4`, matching the expected HEAD. Remotes empty;
only pre-existing untracked `.codex/`, preserved. No executable edits or local suites/builds/
fixtures; no subagents. The sandbox could not resolve `dev` because it could not access the
user SSH config; elevated execution of the same approved baseline then used existing credentials.
No automatic classifier rejection occurred. Initial WSL enumeration was sandbox-denied;
elevated final enumeration reported no running distributions. WSL was never started.

**Measured steps 0–2:** SSH alias `dev` resolved to `arm@10.0.40.100:22`; remote hostname
`streamanator`, user `arm`, architecture `x86_64`, Node `v22.23.2` at the reviewed nvm path.
Candidate root absent, port 3201 free, available DEV disk **80,671,028 KiB** (minimum
6,291,456 KiB). `sudo -n true` unavailable (no interactive password attempted).
Created only the mode-700 root `/home/arm/issue316-v2-candidate-20261021` and its mode-700
`incoming` directory, then transferred the existing documented C: archive once.
Local and remote size **113,830,430 bytes**, SHA-256
`c829da087f65a3a8145ad07db8d7d649bb7f93f8b293d66f85547cd375e40b0e` — exact match.
This pins the approved artifact attributed to source `fffef96fb079bfa975109fa2fdcf5552b51e5946`
and build `WkKKyr7KAoFmMb5QyM4MQ`; internal source/build metadata was not independently
read back because the membership gate stopped execution first.

**Step 3: STOP.** Read-only tar inspection found **18,309 members, 13,210 regular files,
and one symlink**:

```text
afldb-v2-dev-candidate-fffef96f/kit/node_modules/tsx/node_modules/.bin/esbuild
  -> ../esbuild/bin/esbuild
```

The initial strict membership predicate also flagged the ordinary top-level directory
`afldb-v2-dev-candidate-fffef96f` because tarfile omits its trailing slash; that directory is
not itself a hazard. The actual symlink contradicts plan §2's explicit “no symlinks”
description. The approved hash matches, so this is an artifact-description contradiction,
not observed transfer corruption. No claim is made that the relative link escapes the package.
No gate was relaxed, package altered, extraction attempted, or packaged script executed.
Full `FILES.sha256` verification was not reached. The 13,210 regular-file count is not
asserted to be a manifest mismatch (the manifest itself is also a regular file).

**Unreached steps 4–14:** source ledger/checksum and candidate-database absence checks,
layout/configuration, dump, CREATE DATABASE, restore, migrations, privileges, startup,
refusal/audit and negative controls were **not run**. No synthetic users/sessions or audit
writes were made. No database connection was made by this attempt; consequently original
`afldb_dev` ledger 110 and absence of synthetic records were not independently reverified.
No original DB/app/unit/timer/Caddy writes occurred. Ordinary concurrent V1 activity was
neither measured nor attributed to this operation; aggregate host disk movement is not DB
preservation evidence. DEV disk at final readback was 80,559,336 KiB available.

**Final state, 2026-10-21T00:17:36Z:** read-only checks confirmed no extracted package, no
candidate config or run directory, and **port 3201 free**. The candidate never started, so
shutdown was unnecessary. No dump or candidate database was created by this operation.
The uploaded archive and root/incoming directory are retained; no cleanup.

**Evidence:** raw archive inventory/stop and final DEV readback are retained on C: at
`C:\Users\stuar\AppData\Local\Temp\claude\D--dev-afldbV2\77258a0a-3c50-46b6-b25d-0084ebe15f04\scratchpad\dev-app-execution-20261021\`
(`archive-membership-stop.txt`, `final-dev-readonly.txt`, `wsl-running.txt`), with this
sanitised record in Git. Remote retained archive:
`/home/arm/issue316-v2-candidate-20261021/incoming/afldb-v2-dev-candidate-fffef96f.tar.gz`.

**Acceptance: NOT PASSED.** Exact next prerequisite: owner review of this matching-hash
artifact's symlink versus the approved no-symlinks contract, then an explicitly reviewed
continuation accounting for the now-existing retained root/archive. The original absent-root
sequence cannot be rerun unchanged. This record does not authorize continuation, replacement,
rebuild or cleanup. If continuation reaches database creation, passwordless sudo is unavailable;
the owner must run the exact plan §5 step 7 CREATE DATABASE statement. C0/C1 remains incomplete;
C2 still separately requires D-316-1, the reviewed historical acquisition artifact and the
freeze/recovery/ownership/ladder/validator prerequisites recorded below. ISSUE-316 remains open;
production NO-GO and later writer authorities unchanged.

## Owner approvals and DEV results (2026-10-21)

**Provenance.** The owner explicitly approved both decisions "exactly as specified" in this
document (owner instruction of 2026-10-21; the wording is the block quotes in the two sections
below, unchanged). Recorded:

- **D-V2-316-C0C1-1 — approved.** Accurate scope: normal V2 runtime continues refusing legacy
  acquisition; pinned historical and V2 launcher refusal fixtures replace the acquiring C0
  control and do not demonstrate active acquisition; active historical acquisition remains a
  separately authorised C2 prerequisite; full deployed DEV app/audit acceptance remains pending;
  no API writer, setting, timer, rollover or production operation is approved; D-316-13 remains
  unavailable before deployed C4.
- **D-DEV-316-C1-REFUSALS-1 — approved and executed.** This is the C1 shell subset only.

**Target (DEV, measured).** SSH alias `dev` (`~/.ssh/config`: `Host dev streamanator`,
`arm@10.0.40.100`, port 22) reported hostname `streamanator`, user `arm` (uid 1000), address
`10.0.40.100`, Linux 6.8.0-147-generic, at 2026-10-21T08:31:58+11:00. The production alias
`afldb` / 209.38.87.252 was not used. No sudo, no database connection.

**Artifact.** Local and remote (`/home/arm/issue316-c1-refusals-20261021.tar`, copied by `scp`
once; the first attempt at remote verification was a client-side quoting error, and a second
was declined by the automatic permission classifier; the archive was not re-uploaded or
altered): 40,960 bytes, SHA-256
`99ec19b1c6f4cfbd9f7429211955cba05a7c80783e5e8804f194eb20b2483b00` — matches. Remote `tar -tvf`:
exactly four ordinary files (`-rw-------`), no links, no unsafe paths: `historical.sh` 12,476 B,
`v2.sh` 13,170 B, `rehearse.sh` 2,079 B, `checksums.sha256` 230 B. Member hashes equal the table
below (`sha256sum -c checksums.sha256`: `historical.sh`, `v2.sh`, `rehearse.sh` all OK; local
extract also matched, `checksums.sha256` itself `c88a41fa…595cd7`).

**Procedure.** Both destinations confirmed absent immediately before creation;
`mkdir -m 700 /home/arm/issue316-c1-review-20261021`; `tar -xf … -C` that directory; checksums
verified; then, from that directory, exactly:

```sh
/usr/bin/env -i PATH=/usr/bin:/bin AFLDB_PYTHON=/usr/bin/python3 \
  /bin/sh ./rehearse.sh /home/arm/issue316-c1-review-20261021 \
  /home/arm/issue316-c1-review-20261021/results
```

Started and finished 2026-10-21T08:35:31+11:00 (same second). **Overall runner exit 0**, printing
"PASS: four shell refusals; no acquisition tools, R fragment, Node settle or database
credentials in fixtures." and "Not deployed DEV C1 acceptance; no active historical acquisition
control was run."

| Case | Fixture | Exit | Marker | `result.log` SHA-256 |
|---|---|---|---|---|
| `historical-retired` | `retired`/2026, in progress `[2026]` | **0** (expected 0) | `AFLDB_AFLTABLES_RETIRED` | `161c685c…c355` |
| `historical-beyond` | `active`/2026, in progress `[2027]` | **1** (expected 1) | `AFLDB_AFLTABLES_OUT_OF_BOUNDS` | `30cee544…a8d6d0` |
| `v2-retired` | same as historical-retired | **0** | `AFLDB_AFLTABLES_RETIRED` | `161c685c…c355` |
| `v2-beyond` | same as historical-beyond | **1** | `AFLDB_AFLTABLES_OUT_OF_BOUNDS` | `30cee544…a8d6d0` |

Identical per-case log, exit-code, switch and register hashes between the historical and V2
launchers (each pair byte-identical). Every log shows only the refusal message: no `[1/3]`, no
snapshot label, no R/Node/acquisition output. No unexpected exit, marker or write was seen.
The runner and result files are the only things written, under the new directory.

**Evidence (DEV, retained, no cleanup).** `/home/arm/issue316-c1-refusals-20261021.tar` and
`/home/arm/issue316-c1-review-20261021/` (mode 700; the four extracted files plus `results/<case>/`
with `data/reference/{afltables-network,seasons}.json`, `result.log`, `exit-code.txt`).

**Limits — what this does not show.**
- This is the C1 shell subset only. No active historical acquisition control ran, so the
  original C0 acquiring criterion is replaced (D-V2-316-C0C1-1), not satisfied.
- No deployed application or audit behaviour was verified (no `legacy_retired` refusal, no
  `admin.legacy_retired_refused` audit row).
- No process, packet or write monitoring beyond the runner's own checks was run; the structural
  reachability result is not network-capture evidence.
- No database, service, timer, setting, rollover or production state was changed.

**Exact remaining prerequisite for deployed DEV app/audit acceptance:** a separately approved,
source/artifact-pinned V2 DEV application installation (DEV identity/schema and recovery
reviewed first), then one authorised Super Admin stale-action request returning
`{refused:true, code:'legacy_retired', surface:'admin.afltables_settle_trigger'}` with one
`admin.legacy_retired_refused` `auth_audit_log` row, per "Remaining DEV C0/C1 and C2
prerequisites" below. C2 remains separate (D-316-1).

## Exact source and reconciliation

Initial V2 branch/HEAD: `v2/rebuild`, `23d6f9f54a06a6fa1108043b394def4a54a9d210`.
Local integration commit: `40a1427ec9594d167e35a8229a485cdcea96c912` (the later documentation commit pins this identifier and updates tracking;
neither is a host installation or owner acceptance).
Remotes empty; pre-existing untracked `.codex/` preserved.

Read-only source `D:\dev\afldb-afl-api-cutover`: HEAD
`ff100dc2b8da8523f550ef45a9eaa3ef96d9d840`; its 11 tracked modifications and eight untracked
handoff files match the preserved status. All **19/19** source SHA-256 values match
`D:\tmp\afldbV2-source-snapshot-20261019\sha256-worktree.txt`; both snapshot-manifest hashes
and all eight preserved untracked copies verify. All 19 files were already incorporated in
`c9cca86db2fd60ec42fa777906a2cf2a291d5e4e`, with identical content after CRLF→LF normalization.
No merge is needed. No merge into the original main repository is proposed.

Disposition below is content-based; unchanged content may have different physical line endings.
The [machine-readable comparison](evidence/issue316-handoff-reconciliation-2026-10-21.json)
retains original hashes and import evidence. Current-session tracking additions are explicit below.

| Carried path | Disposition in V2 |
|---|---|
| `CHANGELOG.md` | Intentionally superseded: retained handoff history plus V2 changes and this reconciliation. |
| `IssuesIndex.md` | Intentionally superseded: V2 issue state; current C0/C1 next action corrected here. |
| `data/reference/afltables-network.json` | Intentionally superseded comment paths name quarantine; operational values still active / 2026 / null decision/date. No retirement performed. |
| `deploy/afldb-settle-afltables.sh` | Intentionally superseded by `aeea63d1`: original gates retained; independent V2 refusal before label/acquisition/settle. |
| `docs/deployment.md` | Preserved unchanged in content. Historical host instructions do not override V2 approval gates. |
| `issues.md` | Intentionally superseded by subsequent issue records; this ISSUE-316 state updated without closing it. |
| `issues/closed/AFLDB-ISSUE-232.md` | Preserved unchanged in content; PROD Brownlow-timer restrictions retained. |
| `issues/open/AFLDB-ISSUE-316.md` | Original handoff preserved unchanged in content; this session adds a pending V2 amendment link, retaining original C0–C9 authority. |
| `src/lib/acquisition/afl-api-cutover-readiness.ts` | Preserved unchanged. |
| `src/lib/acquisition/afltables-network.ts` | Preserved unchanged. |
| `src/lib/acquisition/settle-trigger.ts` | Preserved unchanged in content; V2 admin action no longer imports/calls its start function. Status-reading consumers remain. |
| `src/lib/rollover/afltables-network-retirement.ts` | Preserved unchanged; exact D-316-1 enforcement retained. |
| `tests/afl-api-cutover.test.ts` | Intentionally superseded: acquisition gate tests follow quarantine; this session adds bounded-active V2 refusal regression. |
| `tools/current-season/afl-api-c4b-rehearsal.ts` | Preserved unchanged; D-316-13 remains unavailable before deployed C4. |
| `tools/current-season/afl-api-cutover-readiness.ts` | Preserved unchanged. |
| `tools/db/rollover-season.ts` | Preserved unchanged in content; still required for separately authorised C2. |
| `tools/rebuild/afltables/acquire_club_lists.R` | Intentionally superseded by refusal stub (`7ca4b4f2`); implementation quarantined with added historical-use comment, gates retained. |
| `tools/rebuild/afltables/acquire_coaches.py` | Intentionally superseded by refusal stub; quarantined implementation changes only repository-root depth 3→5, gates retained. |
| `tools/rebuild/fitzroy/acquire_core.R` | Intentionally superseded by refusal stub; quarantined implementation adds historical-use comment, gates retained. |

No missing handoff implementation or conflicting merge was found. The genuine omission was an
unreconciled approval contract: original C0 promises active DEV acquisition while V2 refuses it.
The still-required historical maintenance artifact and C2 inputs are prerequisites, not missing V2
runtime features. Existing deployment/legacy-disposition historical narratives are not acquisition authority.

## Owner amendment D-V2-316-C0C1-1 — APPROVED 2026-10-21 (wording as originally proposed)

> For the V2 release only, I approve replacing ISSUE-316 C0's “switch active, bounded to 2026:
> no behaviour change; DEV unit run still acquires” criterion with: the ISSUE-316 handoff is
> incorporated in the pinned local V2 integration commit; the switch remains bounded to 2026,
> while normal V2 runtime continues refusing legacy acquisition. Linux focused cutover checks
> and the pinned historical and V2 launcher refusal fixtures replace the acquiring DEV-unit
> control. They do not demonstrate active acquisition. Active historical acquisition capability
> remains an explicit C2 prerequisite and requires separate D-316-1 authority and a reviewed
> execution artifact before use. No legacy acquisition is restored to V2 runtime.
>
> For C1, the shell cases run the reviewed launchers directly with isolated fixture roots;
> systemctl must not start the main-checkout unit. A later, separately approved V2 DEV app
> installation verifies the authorised stale action's `legacy_retired` refusal and one
> best-effort `admin.legacy_retired_refused` audit row, rather than the historical
> `outcome: unavailable` contract. Full DEV C1 remains pending until that deployed check is
> recorded. No API writer, setting, timer, acquisition, rollover or production operation is
> authorised by this amendment. D-316-13 remains unavailable until C4 is deployed.

This amendment changes an acceptance criterion and must be explicitly approved. Original C0/C1
are not declared satisfied by local tests. If the owner retains the acquiring C0 control instead,
stop: a separately reviewed historical DEV acquisition operation is necessary, with actual AFL
Tables requests, new snapshot/manifest files, and potentially canonical/staging/ledger writes if
the entire original unit runs. This package authorises none of those effects.

## Smallest next DEV operation — shell refusal subset only

Decision **D-DEV-316-C1-REFUSALS-1** (approved and executed 2026-10-21, after the amendment):

> I authorise transfer of the exact 40,960-byte `issue316-c1-refusals-20261021.tar`, SHA-256
> `99ec19b1c6f4cfbd9f7429211955cba05a7c80783e5e8804f194eb20b2483b00`, to DEV, extraction
> into the new `/home/arm/issue316-c1-review-20261021` directory, and the fixture command below
> as `arm`. This authorises filesystem-only preparation and four direct shell refusal runs;
> no checkout/service deployment, systemctl start, database connection, acquisition or setting
> change. Retain all evidence. This is the C1 shell subset, not full C0/C1 acceptance.

Local artifact:
`D:\dev\afldbV2\.local-release\issue316\issue316-c1-refusals-20261021.tar`.
It contains exactly `historical.sh`, `v2.sh`, `rehearse.sh`, `checksums.sha256` (ordinary files;
no environment, dependency tree, acquisition implementation or database credentials).

| File | SHA-256 (LF bytes) |
|---|---|
| `historical.sh` | `737ee74aa6279f30baa1ec61d569efbd659ab21034f6f720115978ef8169062f` |
| `v2.sh` | `e84262243b307fb620875ca1c826782ebd385b2f9f673fe1d9f2a3f88f9a48a8` |
| `rehearse.sh` | `cfa0a58dbd4d324e219687243bb410f369335e5a0b1707459f2d64057d77a978` |

`historical.sh` is the original reviewed launcher exported from
`c9cca86db2fd60ec42fa777906a2cf2a291d5e4e:deploy/afldb-settle-afltables.sh`, not the current
main checkout's service. Its LF hash differs from the original CRLF snapshot hash
`b26d16b5…e80d` only because of line endings; normalized content was verified equal.
`v2.sh` is the current V2 launcher; `rehearse.sh` is
[`tools/v2/issue316-c1-refusals.sh`](../../tools/v2/issue316-c1-refusals.sh).

After the approved transfer to `/home/arm/issue316-c1-refusals-20261021.tar`, run on DEV only:

```sh
set -eu
cd /home/arm
printf '%s  %s\n' \
  99ec19b1c6f4cfbd9f7429211955cba05a7c80783e5e8804f194eb20b2483b00 \
  issue316-c1-refusals-20261021.tar | sha256sum -c -
tar -tf issue316-c1-refusals-20261021.tar
# STOP unless exactly the four ordinary files listed above; target must not exist.
mkdir -m 700 /home/arm/issue316-c1-review-20261021
tar -xf issue316-c1-refusals-20261021.tar -C /home/arm/issue316-c1-review-20261021
cd /home/arm/issue316-c1-review-20261021
sha256sum -c checksums.sha256
/usr/bin/env -i PATH=/usr/bin:/bin AFLDB_PYTHON=/usr/bin/python3 \
  /bin/sh ./rehearse.sh /home/arm/issue316-c1-review-20261021 \
  /home/arm/issue316-c1-review-20261021/results
```

The runner creates a new output directory, refusing an existing one, and exactly four bare
fixtures. Each has only its switch and season register; `AFLDB_PROJECT_ROOT` points there.
It invokes the archived script paths directly. Retirement (`retired`, 2026) must print
`AFLDB_AFLTABLES_RETIRED`, exit **0**. Active / last_season 2026 / in-progress `[2027]` must
print `AFLDB_AFLTABLES_OUT_OF_BOUNDS`, exit **1**. Each run must have no `[1/3]`, snapshot label,
R runtime, acquisition implementation or Node settle. Overall runner exit **0** means four
refusals passed; any mismatch stops with exit **1** (usage/interpreter errors **2**).

Effects: local DEV fixture/log files only, including `result.log` and `exit-code.txt` per case.
Zero acquisition requests, zero DB connections/writes/audit rows, zero service/timer changes.
There is **no active historical acquisition control** in this package. These structural
reachability checks are not packet capture or evidence that the deployed service uses these bytes.

Recovery: stop on hash/path mismatch, pre-existing target, missing interpreter, unexpected exit,
missing marker, `[1/3]`, a source label, or any unexpected process/write/network activity. Do not
retry with relaxed checks. Retain the directory, archive and logs; no shared state needs undoing.
No cleanup, rollback, setting change or timer operation is part of this procedure.

## Remaining DEV C0/C1 and C2 prerequisites

Full DEV C0/C1 additionally needs a separately approved source/artifact-pinned V2 DEV install
and Linux focused checks. Target the DEV V2 application and its DEV database only, never the
original main checkout's AFL Tables service. Review serving artifact, DEV identity/schema and
recovery prerequisites before drafting its exact deployment commands; no DEV identity was
measured in this local session and no build is fabricated. No switch/season change is needed
for the V2 admin refusal, which is unconditional after its capability guard. Use an authorised
Super Admin stale-action request, not an active historical app's “start now” control.
Expected response: `{refused:true, code:'legacy_retired', surface:'admin.afltables_settle_trigger'}`;
one best-effort `auth_audit_log` row with action `admin.legacy_retired_refused`, detail
`{surface:'admin.afltables_settle_trigger', export:'startSettleRunAction'}` and attributed actor.
No systemctl start or acquisition. Audit failure is logged and still refuses; a missing expected
row blocks that acceptance. Unauthorised callers fail the guard with no refusal audit.
Retain DEV before/after evidence. Recovery uses the separately approved previous app artifact;
do not re-enable legacy triggers. This broader operation is not the next approval requested.

C2 remains separate D-316-1 authority plus the release plan's coordinated freeze/recovery/A-AFLT
approvals. A candidate historical maintenance source is the **complete pinned c9cca86d archive**,
which includes the reviewed bounded acquisition/rollover implementation, not an unqualified
production ff100dc2 checkout or the V2 acquisition stubs. Its full execution artifact,
dependencies, exact acquisition command/labels, output locations and target must be separately
reviewed before use. Do not install it as V2 runtime or wire it to a normal timer/admin control.
The quarantined V2 R implementation is also historical evidence, not automatic C2 authorisation.

Still required: final full-history acquisition plus ladder witness; fresh D-233-3 ownership census
for the relevant databases; reviewed successor ladder coverage, stat availability, accepted
corrections, expected club-season count, retirement status and rollover date; all three real
validator gates; dry-run review then authorised apply. The switch must be active / 2026 before
acquisition and retired first in the six-file rollover write with exact D-316-1; reviewed commit
and affected checks/rebuild afterwards. No dates, labels or counts are invented here. C2 acquisition
writes snapshots/manifests and contacts AFL Tables; rollover writes repository reference state.
Any database validation/rebuild or broader release write needs its own explicit reviewed target
and authority. Do not invoke V2's old acquisition stub and treat its refusal as C2 success.
The release plan keeps C2 before installation of quarantined V2. Future AFL API activation remains
C4 registration → C4b under D-316-13 only after deployed C4 → C5 under D-316-4; Brownlow C8 separately.

## Local verification and limits

- Focused four-suite run: **669 passed / 2 POSIX-only skipped / 0 failed (671 total)**.
  Suites: cutover, season rollover, admin current-season refusal/audit, V2 module boundaries.
- New regression reaches V2's active/bounded refusal with an R environment fragment present;
  no acquisition/Node implementation exists in its fixture. Existing audit tests use mocks.
- Direct historical/V2 retired and out-of-bounds fixtures: **4/4 passed**, zero network/DB paths;
  [retained results](evidence/issue316-local-refusals-2026-10-21.json).
- Exact packaged runner: **4/4 passed** under Windows Git Bash; `sh -n` passed. Reusing its output
  directory refuses without overwrite. This is not Linux or deployed DEV C1 acceptance.
- TypeScript `--noEmit --incremental false` and changed-test ESLint passed.
- Initial sandbox run: 664 pass, 5 fail, 2 skip; child `tsx` processes hit Windows
  `uv_os_get_passwd ENOMEM`. Identical authorised focused rerun outside that restriction passed;
  no assertion was weakened. No build, archive rehearsal, rollback exercise or C4b tool run.

The five accepted migration/staging decisions remain unchanged. ISSUE-316 stays open. The next
review is the exact amendment and filesystem-only DEV shell operation above, not blanket cutover approval.

## Files changed in this local preparation

- `tests/afl-api-cutover.test.ts`
- `tools/v2/issue316-c1-refusals.sh`
- `docs/v2/evidence/issue316-handoff-reconciliation-2026-10-21.json`
- `docs/v2/evidence/issue316-local-refusals-2026-10-21.json`
- `docs/v2/issue316-c0-c1-approval-2026-10-21.md`
- `docs/v2/production-release-plan-2026-10-21.md`
- `docs/v2/progress.md`
- `issues/open/AFLDB-ISSUE-316.md`
- `issues.md` (ISSUE-316 entry and Open Issues row only)
- `IssuesIndex.md` (ISSUE-316 only)
- `CHANGELOG.md` (Unreleased)

The ignored `.local-release/issue316/` holds the exact approval archive and local fixtures;
it is retained outside Git. No original worktree, recovery archive, backup or restricted
rehearsal evidence was changed.
