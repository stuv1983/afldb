# ISSUE-316 local reconciliation and proposed C0/C1 approval — 2026-10-21

**Local preparation complete; owner amendment and DEV execution pending. Production NO-GO.**
No host access, acquisition, shared database writes, deployment, rollover, season changes,
timer/service changes, pushes, subagents or new worktrees occurred. The accepted fresh archive
rehearsal, Brownlow implementation, builds and rollback exercises were not repeated.

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

## Proposed owner amendment D-V2-316-C0C1-1 — NOT APPROVED

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

Proposed decision **D-DEV-316-C1-REFUSALS-1**, only after amendment approval:

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
