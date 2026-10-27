# ISSUE-316 successor activation decision package (2026-10-27)

**Status: PREPARED FOR OWNER DECISION. Nothing here has run.** Prepared ≈05:30Z (16:30 AEDT) by native inspection and
read-only Git only (local repository and the package's `simulations/bundle-repo.git`). No host or database access,
activation, deactivation, commit, push, deployment, rebuild or authority change. Production NO-GO.
Independent review: see §8.

Basis: State B applied and validated under D-316-APPLY-B-20261027 (A, B, C, E1, E2, F all PASS, 04:52:41–05:00:14Z;
`APPLY-B-CLOSING.sha256` `cb7b4f7e…`; local copy `.local-release/issue316-readiness-20261027/apply-B-evidence/`).
None of readiness, apply, E1 or State B validation is repeated here. Accepted J2 rebuild evidence (167/167, inputs
264/264) is preserved and no rebuild is requested.

## 1. Facts established for this decision

| Item | Value | Source |
|---|---|---|
| EXEC | `streamanator:/home/arm/afldb-i316-readiness-D-20261027T0200Z/exec`, detached HEAD `06e882277644731d665c148970b96ab214f42701` (tree `a8ce0f34…`, parent P) | E1/E2/F evidence |
| Activate authority | `1d133580f526131cf31136df042b372047b170e9925db525a21ef80c5658f65f`; `head_commit` `06e88227…`; action `activate`; label `D-316-ACT-20261027-PROPOSED` (a frozen label, not the owner approval) | `activate-authority.PROPOSED.json` |
| Deactivate authority | `fc45063484cfd6a07b0c716345898399298d2cc62d6b4c406846f554b96dee8c`; **`head_commit` `75df67dbed56ecd2d3906d561bbdafd53fff9f12`** (simulated State C), not `06e88227…` | `deactivate-authority.PROPOSED.json` |
| Change set / tuple / migrations | `d55875cbfa686ac47511eca2e2ac7026cfadefd1fd4e7ab1b31c322f7359644b` / `a78d36ee7e689b7bb5978335bff5e6bdd54f368572df5f2f01d10caf35a373aa` / 117, last `117_brownlow_provider_eligibility_unknown.sql`, `647c3fb39ca66a572664e1dae9028e4fad4d6b121226d6bdf208e6738af45f72` | both authorities, E2 log |
| `tools/db/rebuild-test.ts` | inactive `320960e482699e33afb112f8a765d711bd21c6c032ce464d5f18d39d8956ccc8` (blob `5d7240baab1a60b7bd6a2dac7111cb97b818361f`); active `ab7349470d5de859e83763fb8b9b07c9d4fce1db817046dc3e8a741f65bc3338` (blob `11308f06ca3e80621b628edf70e74390e22c8e36`); mode 100644; `text=auto eol=lf`, 0 CR | re-hashed today from the bundle blobs |
| Simulated C commit | `75df67db…` = tree `4d520565cbe6269cfc9ddc0951a10b8cab44e4cc`, parent `06e88227…`, author/committer `AFLDB Proposal <proposal@afldb.invalid> 1793066400 +0000`, message `ISSUE-316 proposed State C — SIMULATION ONLY` + LF (em dash `\342\200\224`), 273 bytes; `diff --numstat 06e88227 75df67db` = `1 1 tools/db/rebuild-test.ts` only | bundle refs `proposed-B`, `proposed-C`, `source-P` |
| Activation tool | `tools/db/successor-activation.ts` `d2e8f73cde13caafae5b55f894a3f74d031367581c492dfc4ce65f183419026e`, unchanged since P | E2 `inputs.sha256` |
| E2 runtime | node `/home/arm/.nvm/versions/node/v22.23.2/bin/node` `3517c2df…`; git `/usr/bin/git` `eb54b535467e0975c1284d4c4d08eea779aeb248a5d34b02e2ee171382e22201` 2.43.0; E2 full-root inventory 2,980 files, `bafb7da0ed2788561a1dc2923fa7e7b31ad757ba2b5cda9eeb2afea9e2bcdc63` (= F = C inventory) | E2.log, d7-F.sh |
| Native policy | `dc7b585d…` (251 entries), auditor `32d5f6fe…`, record `e7d9eb9e…`, esbuild `e1698a3d…`; **`/usr/bin/git` not listed** | APPLY-DECISION §2 |

### What `--apply` does (code read: `tools/db/successor-activation.ts:159-200`, `src/lib/rollover/successor-activation.ts:226-382`)

Every invocation runs, before any write, exactly the E2 judgement: pending journal/staging refusal → authority ↔
change-set/tuple binding → `git rev-parse` HEAD = `head_commit` and `git merge-base --is-ancestor` P → migration set →
byte classification (every change-set pin, register/network rollover date, rebuild-test.ts = one of the two pins, each
re-derived from the other) → the rebuild's own validators over the activated (must resolve the profile, 1640) and
inactive (must refuse) states. `--apply` then writes `tools/db/rebuild-test.ts.activation-tmp`, reads it back,
re-runs the commit, migration and classification binding, re-checks `rebuild-test.ts` is still the judged bytes,
renames the staging file over `rebuild-test.ts`, and reads it back. Tool writes within EXEC: `tools/db/rebuild-test.ts`
only (new inode; mode from the umask, which Git ignores for a non-executable file). The operator's own `git status`
and `git add` refresh `.git/index`; tsx may write its transform cache under `os.tmpdir()`, outside EXEC (as in E2). The staging file is transient; a kill
between write and rename can leave it, and every later invocation then refuses until it is removed. No fsync.
After the rename it prints `WROTE tools/db/rebuild-test.ts only. Commit it alone, so that reverting that commit is the
deactivation route.` No database, migration, rebuild, census or network.

A second activation reaches classification and both validator proofs, then refuses with `The successor is ALREADY
ACTIVE` (exit 2). That refusal is therefore a valid read-only post-write proof while HEAD is still `06e88227…`.

### Deactivation binding (the recovery constraint)

The frozen deactivate authority binds HEAD `75df67db…`. With HEAD at `06e88227…` (where activation leaves it) the
tool refuses at `assertCommitBinding` before classifying anything (`HEAD is 06e88227…, but the authority is bound to
75df67db…`). **Deactivation through the frozen authority is impossible unless an isolated State C binding commit
recreates `75df67db…` exactly** — the E1 technique, one level up: stage only `rebuild-test.ts`, require `write-tree`
= `4d520565…`, `commit-tree` with the simulated metadata = `75df67db…`, then move detached HEAD under an old-value
guard. That is a new owner decision (ACT-C). It is not assumed to work: a deactivation **dry run** (ACT-R) against
the real HEAD proves the binding, the C classification and the validators before the window closes. Without ACT-C the
only recovery is the Git byte restore of the one file (RC1), and any honestly dated commit would need a regenerated
deactivate authority (new artefact, review and binding; not prepared).

Any later commit on EXEC (including a future repository commit 1) moves HEAD away from `75df67db…` and voids the
frozen deactivate authority's HEAD binding; a deactivation after that needs a regenerated authority.

## 2. LD_AUDIT treatment (decision ACT-L)

Under `LD_AUDIT` with policy `dc7b585d…`, the tool's `execFileSync('git', …)` targets `/usr/bin/git`, which is not a
bound object. The auditor's exec hook fails such an exec with EACCES (`tools/v2/native-audit/afldb-native-audit.c:22-28`);
if the exec were not intercepted, the git child would inherit `LD_AUDIT` and `la_objopen` would refuse its unbound
main executable with exit 127 (`:17-19`, `:27`). Code reading only, never observed for this tool. Either way `gitBinding`
(`tools/db/successor-activation.ts:166`) would throw before any write, so an enforced activation
cannot run without a new policy. E2's approval covered an unenforced **read-only** run; it does not cover a write.

| Option | Effect | Recommendation |
|---|---|---|
| **L1 — unenforced write, explicit** | E2's exact environment plus `--apply`; compensating controls below | **Recommended**, as a named owner decision |
| L2 — new native policy adding `/usr/bin/git` and its closure | new policy derivation, independent review, binding; not prepared | Not for a one-file deterministic write |
| L3 — enforced attempt anyway | refuses at git exec (inferred); proves nothing | No |

L1 compensating controls: tool unchanged since P; node and git byte-identical to E2; git's shared libraries (`ldd
/usr/bin/git` with each sha256) equal before and after; DSN and `LD_*` scrubbed;
runtime-pins, policy-match (251/0) and layout-recheck pass immediately **before and after** the write (bound native
files and `node_modules` layout unchanged around it); full-root inventory equal to E2 before, and after differing on
exactly one line; result byte-equal to the reviewed pin (`ab734947…` = blob `11308f06…`). **Residual risk accepted by
ACT-L:** native code mapped by the node or git process during the ≈3 s run is not enforced; a transient substitution
that leaves no file trace would not be detected. The written bytes are fully verified either way.

## 3. Timers and execution window

Current clock at preparation: 2026-10-27T05:29:55Z (`git var GIT_COMMITTER_IDENT`, workstation clock).
Streamanator timers last read at day-D opening (02:00Z, `d0-discover.log:64-69`); **not rechecked since**, so V0
re-reads them and narrows the window. As read then (UTC):

| Timer | Next | Relevance |
|---|---|---|
| `afldb-settle-afl-api-brownlow.timer` | every 5 min | DEV service; does not touch EXEC; ran throughout day-D and apply-B; record only |
| **`apt-auto-upgrade.timer`** | **2026-10-27 06:58:26Z** | can change native libraries → policy drift; binding constraint |
| `apt-daily.timer` | 15:15:31Z | |
| `apt-auto-reboot-if-required.timer` | 16:00:00Z | |
| `afldb-settle-afl-api.timer` | 18:07:48Z | |
| `apt-daily-upgrade.timer` | 19:27:16Z | |
| PROD `afldb-settle-afltables.timer` (afldb-prod) | 17:30:14Z (F3 read 04:59:30Z) | not touched; no PROD access in this decision |

- **W1 (preferred):** from approval until **06:45:00Z** (17:45 AEDT). V2 (`--apply`) latest start **06:25:00Z**; V5
  latest start **06:33:00Z**; V6 latest start **06:38:00Z**. 13 min clear of 06:58:26Z.
- **W2 (only if W1 is missed):** **07:30:00–14:45:00Z** (18:30 AEDT 27 Oct – 01:45 AEDT 28 Oct), same UTC date D.
  Opens only if V0 shows `apt-auto-upgrade.service` LAST after 06:58Z, unit inactive with `Result=success`, no
  apt/dpkg/unattended-upgrade process, and V1 policy-match 251/0 drift. Any drift → STOP (a new policy is not
  authorised). V2 latest start 14:15:00Z; V5 14:23:00Z; V6 14:28:00Z; done by 14:45:00Z.
- In either window, if V0 shows any apt-* timer NEXT earlier than window end + 10 min, the window end becomes that
  NEXT − 10 min and the latest starts move back by the same amount. Census age and timers never extend a bound.

The full sequence is a few minutes (E2 took 7 s; inventories and policy checks dominate).

## 4. Sequence (all on streamanator, cwd EXEC unless stated; evidence root `$EV/activate-C`, new, mode 700)

`EV=/home/arm/afldb-i316-readiness-D-20261027T0200Z; S=$EV/stage; AB=$EV/apply-B; O=$EV/activate-C`.
Control scripts are the unchanged `$S/j2-*.sh` exactly as `d7-F.sh` calls them.

- **V0 window and timers (read-only).** UTC inside the approved window; `systemctl list-timers --all --no-pager`;
  `systemctl show apt-auto-upgrade.service -p ActiveState,Result,ExecMainStartTimestamp`; no running `apt`, `dpkg`
  or `unattended-upgrade` process; record and apply §3's narrowing rule.
- **V1 pre-activation integrity (drift checks only; no revalidation).** `j2-runtime-pins.sh` OK; `j2-policy-match.sh`
  `entries checked: 251; drifted or missing: 0`; `j2-layout-recheck.sh` exit 0; `readlink -f "$(command -v git)"`,
  its sha256 and `git --version` byte-equal to `$AB/E2/git-identity.txt`; HEAD = `06e88227…`, detached;
  `git for-each-ref` equal to `$AB/pre/refs.A6`; `git status --porcelain --untracked-files=all` equal to
  `$AB/E1/git-status.E1`; tracked tree clean against HEAD and index equal to HEAD (`git diff --cached --quiet`);
  `ldd /usr/bin/git` with each resolved library's sha256 recorded as `$O/git-libs.V1`; `.git/hooks` only `*.sample`; the four input hashes equal
  `$AB/E2/inputs.sha256` (plus the deactivate authority at `fc450634…`); tool blob at HEAD = at P; full-root inventory
  (`d7-F.sh` form) **cmp-equal to `$AB/E2/exec.E2-reference.sha256`** (2,980 files, `bafb7da0…`), kept as
  `$O/exec.V1.sha256`; no residue (`*.rollover-tmp`, `*.activation-tmp`, `.rollover-transaction.json`); record
  `umask` and `stat -c '%a %i' tools/db/rebuild-test.ts`; copy `rebuild-test.ts` to `$O/rebuild-test.inactive.ts`
  and require `320960e4…`.
- **V2 activation (the one write).** The E2 command, byte for byte, plus ` --apply` as the last argument, stdout and
  stderr both captured:
  ```
  L=$O/activation-apply.log
  env -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL -u AFLDB_OWNER_DATABASE_URL -u AFLDB_BACKUP_DATABASE_URL \
      -u LD_PRELOAD -u LD_LIBRARY_PATH -u LD_AUDIT \
    /home/arm/.nvm/versions/node/v22.23.2/bin/node node_modules/tsx/dist/cli.mjs tools/db/successor-activation.ts \
    --authority issues/open/AFLDB-ISSUE-316-dp-proposal-20261025/activate-authority.PROPOSED.json \
    --transition-change-set issues/open/AFLDB-ISSUE-316-dp-proposal-20261025/transition-change-set.json --apply > "$L" 2>&1
  rc=$?; echo "exit=$rc" >> "$L"; echo "end_utc=$(date -u +%FT%TZ)" >> "$L"
  ```
  Required: exit 0; output lines 2–16 of `$AB/E2/activation-dryrun.log` reproduced exactly except the header reads
  `AFLDB-ISSUE-316 — successor ACTIVATE APPLY`; then a blank line and `WROTE tools/db/rebuild-test.ts only. Commit it
  alone, so that reverting that commit is the deactivation route.`; no `REFUSED`; no `DRY RUN` line. (A refusal is
  stderr, exit 2; any other error is uncaught, exit 1.)
- **V3 immediate integrity/runtime checks.** `rebuild-test.ts` sha256 `ab734947…` and `git hash-object` =
  `11308f06…`; no `.activation-tmp`; HEAD still `06e88227…`; refs equal to V1; `git --version`/git sha256 equal to
  V1; git libraries equal to `$O/git-libs.V1`; `j2-runtime-pins.sh`, `j2-policy-match.sh` (251/0) and
  `j2-layout-recheck.sh` pass again.
- **V4 post-activation proofs.**
  - Only that file changed: full-root inventory vs `$O/exec.V1.sha256` differs on exactly one line,
    `./tools/db/rebuild-test.ts` `320960e4…` → `ab734947…` (2,980 lines both); `git status --porcelain
    --untracked-files=all`, compared as sorted sets, = V1 status plus exactly ` M tools/db/rebuild-test.ts`;
    index still equal to HEAD (`git diff --cached --quiet`); `git diff --name-only HEAD` =
    that path only; `git diff --numstat HEAD` = `1 1 tools/db/rebuild-test.ts`; `git diff --summary HEAD` empty
    (no mode change).
  - Tuple correct: line 1191 of `rebuild-test.ts` is `export const SUCCESSOR_LADDER_TUPLES_JSON = '<table>';`
    where `<table>` is byte-equal to the `after` table in `$AB/E2/activation-dryrun.log` line 15; tuple
    `a78d36ee…` printed by V2.
  - Projected state validates on the written bytes: the unchanged activate **dry run** (E2 command, no `--apply`,
    `> "$O/activate-recheck.log" 2>&1`) exits 2 with `SUCCESSOR ACTIVATION REFUSED` / `The successor is ALREADY ACTIVE`, which the tool reaches only after
    the HEAD, change-set, migration and byte classification and both validator proofs pass; then inventory unchanged
    and no `.activation-tmp`. (V6 prints the same proofs in full.)
  - No residue.
- **V5 isolated State C binding commit (decision ACT-C; local only; never pushed; not repository commit 1).**
  ```
  record `env | grep '^GIT_'` (must be empty) to $O/V5-git-env.txt
  git add -- tools/db/rebuild-test.ts
  require `git diff --cached --name-status HEAD` = exactly "M\ttools/db/rebuild-test.ts"
  T=$(git write-tree); require "$T" = 4d520565cbe6269cfc9ddc0951a10b8cab44e4cc
  printf 'ISSUE-316 proposed State C \342\200\224 SIMULATION ONLY\n' > $O/c-commit-msg.txt
  GIT_AUTHOR_NAME='AFLDB Proposal' GIT_AUTHOR_EMAIL=proposal@afldb.invalid GIT_AUTHOR_DATE='1793066400 +0000'
  GIT_COMMITTER_NAME='AFLDB Proposal' GIT_COMMITTER_EMAIL=proposal@afldb.invalid GIT_COMMITTER_DATE='1793066400 +0000'
    git commit-tree --no-gpg-sign "$T" -p 06e882277644731d665c148970b96ab214f42701 -F $O/c-commit-msg.txt
  require output = 75df67dbed56ecd2d3906d561bbdafd53fff9f12 (else STOP; do not move HEAD)
  require UTC now < window end (else STOP here; a safe point)
  git update-ref --no-deref -m 'ISSUE-316 isolated State C binding' HEAD 75df67dbed56ecd2d3906d561bbdafd53fff9f12 06e882277644731d665c148970b96ab214f42701
  ```
  Require `HEAD^{tree}` = `4d520565…`; `git diff --quiet HEAD --`; status = V1 status (the ` M` line gone); refs
  equal to V1 (only HEAD moved; `source-P` at P). The metadata deliberately reuses the reviewed simulation identity
  so the frozen deactivate authority binds; it is not an authorship claim.
- **V6 deactivation DRY RUN (decision ACT-R; no `--apply`; unenforced as E2).** The V2 environment and tool with
  `--authority issues/open/AFLDB-ISSUE-316-dp-proposal-20261025/deactivate-authority.PROPOSED.json` and the same change
  set, no `--apply`, `> "$O/deactivate-dryrun.log" 2>&1` with `exit=`/`end_utc=` appended. Required: exit 0; `successor DEACTIVATE DRY RUN`; decision `D-316-DEACT-20261027-PROPOSED`;
  HEAD `75df67db… (source def67651… is an ancestor)`; change set `d55875cb…`; tuple `a78d36ee…`; migrations 117 /
  `647c3fb3…`; `state now C activated`; both validator proof lines (c2-2026-successor, club_seasons 1640, 91 checks
  built; inactive refusal); `before ab734947…` with the tuple table, `after 320960e4…  table '{}'`; `state after
  B/D applied, INACTIVE`; `DRY RUN — nothing was written`. Afterwards inventory equal to V4's, no `.activation-tmp`,
  HEAD `75df67db…`.
- **V7 closing.** policy-match, layout-recheck, runtime-pins; V4/native listing unchanged since `$AB/pre` (as
  `d7-F.sh`); no residue; HEAD `75df67db…`, tracked tree clean; refs as V5; `rebuild-test.ts` `ab734947…`;
  closing manifest `$O/ACTIVATE-C-CLOSING.sha256`. EXEC rests in State C at the isolated binding commit. Never
  described as having passed a successor database rebuild or the 91 SQL checks.

## 5. Recovery

| Point | State | Action |
|---|---|---|
| V0/V1 fails | nothing written | STOP, return |
| V2 refuses or exits non-zero, no `WROTE`, `rebuild-test.ts` `320960e4…` | nothing written | require inventory = V1, no `.activation-tmp`; return. No retry. |
| V2 exits non-zero (or no `WROTE`) but `rebuild-test.ts` is `ab734947…`, no staging file (crash after the rename) | activated, uncommitted | treat as the "`ab734947…` written but another check fails" row. |
| V2 killed, `.activation-tmp` present | `rebuild-test.ts` should still be `320960e4…` | verify; preserve the staging file (never delete); return. Every later invocation refuses until a decision removes it. |
| `rebuild-test.ts` holds **neither** pin (failed post-write verification) | HEAD `06e88227…`, index = HEAD | **RC1** (pre-authorised, only this case, only before V5): `git checkout HEAD -- tools/db/rebuild-test.ts`; require `320960e4…` (HEAD's blob `5d7240ba…`), index = HEAD, inventory = V1, status = V1; return. The deactivate authority cannot bind here. |
| `ab734947…` written but another V3/V4 check fails (other path changed, drift, wrong status) | activated, uncommitted, HEAD `06e88227…` | STOP; leave as is; do not run V5; return. Deactivation needs ACT-C first or a regenerated authority; the RC1 command for a correct write is a separate decision. |
| V5 fails before `update-ref` (`diff --cached`, `write-tree`, SHA or window) | HEAD `06e88227…`, index holds the active blob `11308f06…` | do not move HEAD; leave index staged; preserve; return. The frozen deactivate authority cannot bind without HEAD `75df67db…`. Recovery (separate decision): `git checkout HEAD -- tools/db/rebuild-test.ts` (restores index **and** worktree from HEAD; a plain `git checkout --` would restore the staged active bytes), or a regenerated authority. Stopping between `commit-tree` and `update-ref` is a safe point (an unreferenced object). |
| V5 post-`update-ref` checks or V6 fail | HEAD `75df67db…` | leave HEAD; STOP; return. Deactivation is then **not proven**. The Git route (separate decision): guarded `git update-ref --no-deref HEAD 06e88227… 75df67db…`, then `git checkout HEAD -- tools/db/rebuild-test.ts`, requiring `320960e4…` and index = HEAD. |
| All PASS | State C at `75df67db…` | Deactivation `--apply` remains a separate decision; it would write `rebuild-test.ts` back to `320960e4…` under HEAD `75df67db…` (state D). |

Never recover through the rollover journal; never discard EXEC; never commit a mixed state.

## 6. What this does not prove

The 91 SQL checks of the activated state on a database and any successor rebuild; production behaviour; Brownlow.
Accepted J2 rebuild evidence stands. Production release stays NO-GO; release, repository commits, push and deployment
remain separate decisions.

## 7. Owner-approval prompt

```text
ISSUE-316 owner approval — SUCCESSOR ACTIVATION + isolated State C binding commit + deactivation dry run
(proposed id D-316-ACT-C-20261027)

What this is. One write by the unchanged activation tool in the disposable mode-700 checkout
streamanator:/home/arm/afldb-i316-readiness-D-20261027T0200Z/exec (EXEC): tools/db/rebuild-test.ts from inactive
320960e482699e33afb112f8a765d711bd21c6c032ce464d5f18d39d8956ccc8 to active
ab7349470d5de859e83763fb8b9b07c9d4fce1db817046dc3e8a741f65bc3338. Then a local-only binding commit and a
read-only deactivation dry run that proves recovery binds. No database, migration, rebuild, census, deployment,
push, production checkout, production service or production database. Production release stays NO-GO.
Package: issues/open/AFLDB-ISSUE-316-activation-decision-20261027/ACTIVATION-DECISION.md §4 (V0–V7) and §5.

Permissions granted (each explicit; anything not listed is not approved):
 ACT-H  SSH to streamanator as arm; read-only commands in EXEC and $EV (timers, process list, hashes, git
        read-only, the unchanged $S/j2-runtime-pins.sh, j2-policy-match.sh, j2-layout-recheck.sh, j2-listing.sh);
        create the new evidence directory $EV/activate-C (mode 700, must not exist) and its scripts and logs.
 ACT-W  Run tools/db/successor-activation.ts --apply once (V2), with the frozen activate authority and change set.
 ACT-L  Run V2 WITHOUT LD_AUDIT. /usr/bin/git is outside native policy dc7b585d…, so an enforced run cannot
        reach the write. I accept the residual risk: native code in the node/git processes during the run is
        not enforced. Compensating controls are V1/V3: identical node, git and git libraries; policy-match
        251/0 and layout-recheck before and after; inventory exact; bytes verified. E2's read-only exception is
        not relied on.
 ACT-C  The isolated State C binding commit V5 in EXEC only: git add of tools/db/rebuild-test.ts, write-tree =
        4d520565cbe6269cfc9ddc0951a10b8cab44e4cc, commit-tree with the reviewed simulation metadata =
        75df67dbed56ecd2d3906d561bbdafd53fff9f12, guarded update-ref of detached HEAD 06e88227… → 75df67db….
        Local; never pushed; not repository commit 1; the metadata is the simulation identity, not authorship.
 ACT-R  Read-only DRY RUN (no --apply) of the same tool with the frozen deactivate authority (V6), unenforced
        as E2, to prove the recovery binding.
 RC1    Only if rebuild-test.ts holds neither pin after V2 and before V5: git checkout HEAD --
        tools/db/rebuild-test.ts, then verify 320960e4…, index = HEAD, inventory = V1.

Identities. EXEC HEAD 06e882277644731d665c148970b96ab214f42701 (tree a8ce0f34c48766e03c7f4443d53520c494a9e64e,
parent P def676517da3955aa18db3606785463aac464188). Activate authority
1d133580f526131cf31136df042b372047b170e9925db525a21ef80c5658f65f (head_commit 06e88227…); deactivate authority
fc45063484cfd6a07b0c716345898399298d2cc62d6b4c406846f554b96dee8c (head_commit 75df67db…); change set
d55875cbfa686ac47511eca2e2ac7026cfadefd1fd4e7ab1b31c322f7359644b; tuple
a78d36ee7e689b7bb5978335bff5e6bdd54f368572df5f2f01d10caf35a373aa; migrations 117 /
647c3fb39ca66a572664e1dae9028e4fad4d6b121226d6bdf208e6738af45f72; tool d2e8f73cde13caafae5b55f894a3f74d031367581c492dfc4ce65f183419026e;
node 3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327; git /usr/bin/git
eb54b535467e0975c1284d4c4d08eea779aeb248a5d34b02e2ee171382e22201 2.43.0; policy dc7b585d…; E2 inventory 2,980 files
bafb7da0ed2788561a1dc2923fa7e7b31ad757ba2b5cda9eeb2afea9e2bcdc63; active blob 11308f06ca3e80621b628edf70e74390e22c8e36.

Time bound (UTC date 2026-10-27 only). W1: from approval to 06:45:00Z; V2 latest start 06:25:00Z, V5 06:33:00Z,
V6 06:38:00Z (apt-auto-upgrade.timer was due 06:58:26Z at the 02:00Z read). If W1 is missed, W2: 07:30:00–14:45:00Z;
V2 latest 14:15:00Z, V5 14:23:00Z, V6 14:28:00Z. W2 opens only if apt-auto-upgrade has run and finished
(Result=success), no apt/dpkg/unattended-upgrade process runs, and policy-match is 251/0. V0 re-reads the timers.
If any apt-* NEXT falls before window end + 10 min, the end and the latest starts move back accordingly. Stop at the
next safe point when a bound is reached; census age and timers never extend it.

Sequence (any failure = STOP, preserve, return):
 V0 Window and timer re-read.
 V1 Drift checks only, no revalidation: runtime-pins, policy-match 251/0, layout-recheck; git path, sha256, version
    and libraries recorded; HEAD 06e88227… detached; refs = apply-B/pre/refs.A6; status = apply-B/E1/git-status.E1;
    index = HEAD; .git/hooks only *.sample; inputs = apply-B/E2/inputs.sha256 plus the deactivate authority;
    inventory cmp-equal to the E2 reference; no residue; byte copy of rebuild-test.ts (320960e4…).
 V2 The successful E2 command plus --apply, stdout+stderr captured:
    env -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL -u AFLDB_OWNER_DATABASE_URL -u AFLDB_BACKUP_DATABASE_URL
        -u LD_PRELOAD -u LD_LIBRARY_PATH -u LD_AUDIT
      /home/arm/.nvm/versions/node/v22.23.2/bin/node node_modules/tsx/dist/cli.mjs tools/db/successor-activation.ts
      --authority issues/open/AFLDB-ISSUE-316-dp-proposal-20261025/activate-authority.PROPOSED.json
      --transition-change-set issues/open/AFLDB-ISSUE-316-dp-proposal-20261025/transition-change-set.json --apply
    Required: exit 0. E2 output lines 2–16 reproduced exactly, except that the header reads
    "successor ACTIVATE APPLY". Then "WROTE tools/db/rebuild-test.ts only. …". No REFUSED.
 V3 rebuild-test.ts ab734947… and git hash-object 11308f06…; no .activation-tmp; HEAD and refs unchanged;
    git identity and libraries unchanged; runtime-pins, policy-match 251/0 and layout-recheck pass again.
 V4 Inventory differs from V1 on exactly ./tools/db/rebuild-test.ts 320960e4…→ab734947…. Status (sorted) =
    V1 + " M tools/db/rebuild-test.ts". Index = HEAD. diff --numstat HEAD = "1 1 tools/db/rebuild-test.ts".
    No mode change. Line 1191 table byte-equal to the E2 "after" table. The activate dry run now refuses
    "ALREADY ACTIVE" (exit 2), which it reaches only after binding, classification and both validators pass.
    No residue.
 V5 ACT-C commit as above. Before it, no GIT_* variables are set. Window re-checked before update-ref.
    Afterwards HEAD^{tree} = 4d520565…, tracked tree clean, refs unchanged.
 V6 ACT-R deactivation dry run: exit 0; HEAD 75df67db… (P ancestor); state now C activated; both validator
    proofs (c2-2026-successor, 1640, 91 checks built); before ab734947… → after 320960e4… '{}'; nothing
    written.
 V7 Closing: controls pass, listings unchanged, no residue, HEAD 75df67db…, tracked tree clean,
    $EV/activate-C/ACTIVATE-C-CLOSING.sha256. EXEC rests in State C at the isolated binding commit.

Recovery. Follow §5 of the package, with these rules:
 - Nothing written → return.
 - A staging file present → preserve it, never delete it.
 - Neither pin → RC1.
 - Correct bytes but another check fails → leave as is and do not run V5.
 - V5 fails before update-ref → do not move HEAD and leave the index staged. The frozen deactivate authority
   binds only HEAD 75df67db…; any restore is a separate decision and uses git checkout HEAD --.
 - V5 fails after update-ref, or V6 fails → leave HEAD at 75df67db… and return.
 A later commit on EXEC voids the deactivate authority's HEAD binding.

Not proven by this: the 91 SQL checks of the activated state and any successor database rebuild. Accepted J2
rebuild evidence stands, and no rebuild is requested.

Not approved: deactivation --apply; any commit other than V5; repository commits or merges; push; new or
regenerated authority; new native policy; new census; package holds or timer changes; deployment; rebuild;
migrations; any production access or write; Brownlow work; deleting a staging or journal file; discarding EXEC.
```

## 8. Independent review

One fresh-context read-only review (code, authorities, bundle objects via read-only Git, apply-B evidence, timers),
about 4 minutes, shortly after 05:30Z: **GO, no CRIT/HIGH.** It verified the V2 command equals `d7-E2.sh:28-32` plus `--apply`, the apply
output path, the ALREADY ACTIVE ordering, the `75df67db…` object (273 bytes, tree, parent, metadata, message bytes),
the one-line `5d7240ba…`→`11308f06…` diff, `.gitattributes` `* text=auto eol=lf`, both authority hashes and the
timer conversions. Applied: **MED-1** (after V5's `git add` the index holds the active blob, so a plain
`git checkout --` would not restore; every restore is now `git checkout HEAD --` with index = HEAD); LOW-1 (stdout
and stderr captured with `exit=`); LOW-2 (exit non-zero after the rename); LOW-3 (V5 post-checks row); LOW-4
(`GIT_*` env and a window re-check before `update-ref`); LOW-5 (git library hashes); LOW-6 (W2 latest starts);
INFO wording (tool writes within EXEC; sorted status comparison; second LD_AUDIT refusal path).
