# ISSUE-316 apply decision package — corrected State B sequence (2026-10-27)

**Status (2026-10-27T05:00:14Z / 16:00 AEDT): EXECUTED under owner approval D-316-APPLY-B-20261027 (window 04:50–06:45Z; B latest start 06:15Z; E1 06:35Z). A, B, C, E1, E2 and F all PASS (04:52:41–05:00:14Z); EXEC is in validated inactive State B at isolated binding commit `06e882277644731d665c148970b96ab214f42701`.** §5 was run unchanged except its time bounds; frozen helpers were not modified (d5-drive.sh's 02:00–04:00Z guard was not run; its unchanged control scripts were called directly). Evidence: `streamanator:/home/arm/afldb-i316-readiness-D-20261027T0200Z/apply-B` (`APPLY-B-CLOSING.sha256`, 85 files, `cb7b4f7e8f1f2cca0615315b5c1f711c80a14cc83e5a05adfcfa523ba3c14caa`); local copy `.local-release/issue316-readiness-20261027/apply-B-evidence/`. No activation or deactivation `--apply`, repository commit, push, deployment, rebuild, migration or production write. Production NO-GO; activation and release remain separately governed.

**Earlier status (2026-10-27T03:43:08Z / 14:43 AEDT): latest-start cutoff 03:40:00Z PASSED with no apply approved or started; the time-bound authority in §5 has lapsed unused.** Readiness proof and this reviewed package are retained unchanged apart from this line. Re-use needs an owner decision on a new execution window on the same UTC date (D unchanged), with §5's time bounds replaced. Production NO-GO.

**Original status: PREPARED FOR OWNER DECISION. Nothing here has run.**
Focused independent review (fresh context, read-only, ≈02:55–03:10Z): **GO, no CRIT/HIGH**. One MED (E2 runtime/env
pinning) and LOW wording items were applied to §5 below.
Readiness proof (02:00:02–02:15:06Z) is retained unchanged: `.local-release/issue316-readiness-20261027/day-D-evidence/decision/RESULT.md`.
Execution authority is limited to the approved window **2026-10-27 02:00–04:00 UTC (13:00–15:00 AEDT)**.

## 1. Why the first package was wrong

`tools/db/successor-activation.ts` (unchanged since P) binds `HEAD` exactly to the authority's `head_commit`
(`src/lib/rollover/successor-activation.ts:226`) before it classifies the tree or runs the State B/C validators.
The frozen activate authority (`activate-authority.PROPOSED.json`, `1d133580…f65f`) binds
`06e882277644731d665c148970b96ab214f42701`. After an uncommitted apply, `HEAD` is still P, so the tool refuses
before validating anything. An expected refusal is not State B validation and is withdrawn.

## 2. Facts established read-only (local Git inspection, 2026-10-27 ≈02:50Z)

- `06e88227…` (from the package's `simulations/bundle-repo.git`, 273-byte object):
  `tree a8ce0f34c48766e03c7f4443d53520c494a9e64e`, `parent def676517da3955aa18db3606785463aac464188`,
  author and committer `AFLDB Proposal <proposal@afldb.invalid> 1793066400 +0000` (2026-10-27T02:00:00Z),
  message `ISSUE-316 proposed State B — SIMULATION ONLY` plus one trailing LF.
- `git diff --name-status P a8ce0f34` is exactly eight entries: six `M` (afltables-network, fitzroy-accepted-baselines,
  seasons, afl-api-contract, afltables-contract, fitzroy-contract) and two `A` (the c2-2026 core and ladder manifests).
  `stat-availability.json` and `tools/db/rebuild-test.ts` are identical to P.
- Every changed blob in `a8ce0f34` equals `git hash-object --no-filters` of the package's `finals/` file (the seven
  approved finals) or `inputs/` manifest, so a tree written from the actual applied bytes equals `a8ce0f34` exactly when
  the apply wrote the pinned finals.
- P's `.gitignore` (unchanged at current HEAD) does not ignore the two manifests.
- A commit SHA covers tree, parent, author, committer and message. E1 writes the tree from the **actual** applied
  index and requires it to equal `a8ce0f34` (the tree binding). It then builds the commit from that written tree with
  the reviewed metadata and requires `06e88227…` (the metadata binding). Any difference stops E1 before `HEAD` moves.
  No new authority is needed. Because P's `.gitattributes` normalises line endings, byte identity of the working tree
  is proven separately by C1, A3 and the tool's own working-tree classification.
- The day-D native policy (`dc7b585d…`) lists `/usr/bin/dash`, `/usr/bin/python3.12` and `/usr/bin/ss` but **not
  `/usr/bin/git`**. The activation tool runs `git rev-parse` and `git merge-base`, so under that `LD_AUDIT` it is expected
  to refuse at the native closure. The planner (`rollover-season.ts`) runs no git.

## 3. Minimal corrected sequence (all in `EXEC=/home/arm/afldb-i316-readiness-D-20261027T0200Z/exec`)

1. **Pre-apply checks** (unchanged from the first package): window/time, native controls, source integrity, census
   identity, residue, baseline git status and copies of the seven paths.
2. **Apply**: the identical enforced day-D command plus `--apply`.
3. **State B checks before the commit**: seven finals, git status = baseline + exactly six ` M`, `rebuild-test.ts`
   unchanged, table `{}`, 1622 constant, no residue.
4. **Isolated binding commit (new decision E1)**: stage the eight changed paths from the applied bytes, require
   `git write-tree` = `a8ce0f34…`, create the commit with `git commit-tree` and the reviewed metadata, require
   `06e88227…`, and move only a detached `HEAD` with an old-value guard. Local only; never pushed; not repository commit 1.
5. **Activation dry run (decision E2)**: the unchanged tool, frozen authority and frozen change set, without `--apply`,
   with the DSN scrub but without `LD_AUDIT` (git is outside the day-D policy). This validates the actual applied
   working-tree bytes as State B, the projected C (1,640 rows, 91 checks, active pin, tuple) and the inactive refusal.
6. **State B checks after**: tree/HEAD equality, clean tracked state, native policy re-match, no residue, read-only
   production health, closing manifest. The checkout stays at State B.

No new authority, no regenerated artefact and no change to any frozen original. The owner-approval prompt is §5.

## 4. Fallback (not prepared, not recommended within the window)

An honestly dated commit plus a **newly bound** activation authority (only `head_commit` changed, precomputable
offline with deterministic metadata). That is a new authority artefact needing generation, independent review and
owner binding; it cannot be completed safely before 04:00Z today.

## 5. Owner-approval prompt

```text
ISSUE-316 owner approval — APPLY + isolated State B binding commit + State B validation
(proposed id D-316-APPLY-B-20261027)

What this is. The apply writes only the disposable mode-700 checkout
streamanator:/home/arm/afldb-i316-readiness-D-20261027T0200Z/exec (EXEC). It installs the 2026 successor reference
documents (seals 2026, retires AFL Tables in the reference state) and leaves the successor INACTIVE
(tools/db/rebuild-test.ts unwritten). It does not deploy, touch the production checkout or service, or read or
write any production database. Activation, repository commits, push and deployment remain separate decisions.

Time bound. Only inside 2026-10-27 02:00–04:00 UTC (13:00–15:00 AEDT). Do not start step B after 03:40:00Z.
If any step cannot finish by 04:00:00Z, stop at the next safe point (never inside the apply), leave EXEC as is and
return for a new window decision. Census age and timer schedules do not extend this bound.

Identities. P def676517da3955aa18db3606785463aac464188; H 79eb1212bbb03aa64f078807f09c3d643e5ea867;
A e91fae88765c5d6d74d4b2c61ee2c4d599fe5d26; change set d55875cbfa686ac47511eca2e2ac7026cfadefd1fd4e7ab1b31c322f7359644b;
tuple a78d36ee7e689b7bb5978335bff5e6bdd54f368572df5f2f01d10caf35a373aa; native policy
dc7b585d1ea3351c5000e26ec399ba95e2651367a93cf65abe9350aae5b9ccd2; record e7d9eb9e7519bb08351a23c2abdbc2d6bf6f393bec9c6e6f3ab20e5cf4f16d68;
auditor 32d5f6feee08d1e89ffd63ac507e0605e050dbfca3ad4d70ce185eb49490956a; activate authority
1d133580f526131cf31136df042b372047b170e9925db525a21ef80c5658f65f; deactivate authority
fc45063484cfd6a07b0c716345898399298d2cc62d6b4c406846f554b96dee8c (not used).

A. Pre-apply checks (read-only; any failure = STOP, preserve, return):
 A1. UTC now is inside the bound above.
 A2. The unchanged d5-drive.sh pre-gate controls, each exit 0 and each negative control non-zero: runtime-pins
     (node 3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327; auditor 32d5f6fe…, mode 444),
     policy-match (251 entries, 0 drift), runtime-check, enforcement-control, layout-recheck
     (esbuild e1698a3d5c6c0798fee4fd3b5cc816651f460c63d390a7a26ea4beb0b1884100), exec-head.
 A3. HEAD = P; 0 tracked changes; 2,687 tracked blobs equal P; full-root inventory equals the post-dry-run
     inventory; transition-change-set.json d55875cb…; rebuild-test.ts 320960e482699e33afb112f8a765d711bd21c6c032ce464d5f18d39d8956ccc8;
     both authority files at the hashes above; the seven base pins at their P values; manifests
     02bbcf932ef71d411c5d5077ae85000ebdbc0896323cf3f57c0e9fa417cf9988 (core) and
     65c299072afb35f1b0ddce50c9c72728e03bcd1580d676ca63eaaafb86047c34 (ladder); .git/hooks holds only *.sample files.
 A4. The same three census files and hashes: b1a6f3982a66d9888258784746959339a1bdf12874309ee23a6e41b05301d893 (afldb_prod),
     66037e8be9095066d8a1168c1630321a12bd0d1a9482279a9fbe4100ee6c94c0 (afldb_dev),
     1ae06bca1e2321f48c71075d1b3a79f8daf404dea54d5cc051c0714a7dcfb74a (afldb_test). No new census.
 A5. No .rollover-transaction.json, tools/db/rebuild-test.ts.activation-tmp or *.rollover-tmp. Never clean one up.
 A6. Retain the baseline `git status --porcelain --untracked-files=all` (it must list both manifests as ??),
     the full-root inventory and byte copies of the seven paths in the evidence root.

B. Apply. The identical day-D enforced command (d5-run.sh argv, LD_AUDIT + policy dc7b585d…, DSN variables
   removed) plus ` --apply` as the last argument, run from d7-apply.sh = d5-run.sh with only that change, its hash
   and diff recorded first. Required: exit 0; "All three pre-apply gates PASSED"; 1622 -> 1640; renumbered 4;
   91 checks; "final_sha256 pins match this plan for every file"; "WROTE 7 files"; "INSTALLED and INACTIVE";
   the activation projection (tuple a78d36ee…, inactive 320960e4…, active ab734947…); 0 native REFUSED lines.

C. State B checks before the binding commit (any failure = STOP):
 C1. The seven paths hash to their finals:
     data/reference/afltables-network.json 04e2a269559cbc09a590e22e46207cd199d78eb60dbdc49c605bb2e724d3b897
     tools/rebuild/afl_api/afl-api-contract.json 1453fffaa50dee67c369967ef397c666c180241978f5ffb22c842255af5f5148
     tools/rebuild/afltables/afltables-contract.json ca4291cb19963d83734e94e1dda36e6d27d2abef32491e4cac27e79dfc3ca60f
     data/reference/fitzroy-accepted-baselines.json 0d4f7b3067112d8cf7fb3acc97b73ffb909b51cee09d8c4f59c326beb7e4f05f
     data/reference/seasons.json 1368e9b100788fd67d2f378830445df424591368536c22473b11add62be629b0
     tools/rebuild/fitzroy/fitzroy-contract.json 4e98a4c96b57011937f78c5dbd2c7cfd50d4cd65b270d11279173b9dbda3edd5
     data/reference/stat-availability.json e2900084ebd7e9505239b82aef8f8665fcf7939e7b84b94b13e110fa6cfcc2b8
 C2. git status = A6 baseline plus exactly six " M" lines (all C1 paths except stat-availability, rewritten with
     identical bytes); the full-root inventory differs from A6 only on those six lines; HEAD still P.
 C3. tools/db/rebuild-test.ts byte-identical at 320960e4…; successor table '{}'; CLUB_SEASONS_EXPECTED rows 1622.
 C4. No residue (as A5).

E1. Isolated State B binding commit (EXEC only; local; never pushed; not repository commit 1). The commit
    deliberately reuses the reviewed simulated B commit metadata so the frozen authority binds without
    regeneration; its message and author are that reviewed simulation identity, not an authorship claim:
    git add -- the six changed paths, data/reference/stat-availability.json and both c2-2026 manifests
    require `git diff --cached --name-status P` = exactly the eight entries (six M, two A)
    T=$(git write-tree); require "$T" = a8ce0f34c48766e03c7f4443d53520c494a9e64e
    printf 'ISSUE-316 proposed State B \342\200\224 SIMULATION ONLY\n' > <evidence>/b-commit-msg.txt
    GIT_AUTHOR_NAME='AFLDB Proposal' GIT_AUTHOR_EMAIL=proposal@afldb.invalid GIT_AUTHOR_DATE='1793066400 +0000'
    GIT_COMMITTER_NAME='AFLDB Proposal' GIT_COMMITTER_EMAIL=proposal@afldb.invalid GIT_COMMITTER_DATE='1793066400 +0000'
      git commit-tree --no-gpg-sign "$T" -p def676517da3955aa18db3606785463aac464188 -F <evidence>/b-commit-msg.txt
    require output = 06e882277644731d665c148970b96ab214f42701 (else STOP; do not move HEAD)
    git update-ref --no-deref -m 'ISSUE-316 isolated State B binding' HEAD 06e882277644731d665c148970b96ab214f42701 def676517da3955aa18db3606785463aac464188
    require HEAD^{tree} = a8ce0f34…; `git diff --quiet HEAD --` exit 0; git status = A6 baseline minus the two
    manifest ?? lines; no other ref changed (source-P stays at P).

E2. Activation DRY RUN (no --apply) with the unchanged tool and frozen originals, NOT under LD_AUDIT, because
    /usr/bin/git is not in policy dc7b585d… and no new policy is authorised. Immediately before: runtime-pins
    (node 3517c2df…); record `readlink -f "$(command -v git)"`, `sha256sum` of that git and `git --version`;
    re-take the full-root inventory (d5-run.sh form: .git and node_modules excluded) as the E2 reference. Then:
    env -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL -u AFLDB_OWNER_DATABASE_URL -u AFLDB_BACKUP_DATABASE_URL
        -u LD_PRELOAD -u LD_LIBRARY_PATH -u LD_AUDIT
      /home/arm/.nvm/versions/node/v22.23.2/bin/node node_modules/tsx/dist/cli.mjs tools/db/successor-activation.ts
      --authority issues/open/AFLDB-ISSUE-316-dp-proposal-20261025/activate-authority.PROPOSED.json
      --transition-change-set issues/open/AFLDB-ISSUE-316-dp-proposal-20261025/transition-change-set.json
    Required, all of:
     - exit 0 and "DRY RUN — nothing was written";
     - the HEAD line shows 06e882277644731d665c148970b96ab214f42701 "(source def676517da3955aa18db3606785463aac464188 is an ancestor)";
       change set d55875cb…; tuple a78d36ee…; migrations 117, last 117_brownlow_provider_eligibility_unknown.sql,
       647c3fb39ca66a572664e1dae9028e4fad4d6b121226d6bdf208e6738af45f72;
     - the "state now" line reads "B applied, INACTIVE";
     - projected C: "activated state: the rebuild's validators resolve c2-2026-successor, club_seasons 1640,
       91 final-validation checks built (SQL not run)". The printed count must be 91; the tool does not assert it;
     - inactive validator refusal: "inactive state: the rebuild's validators refuse the installed profile
       (Unsupported ladder expectation)";
     - tools/db/rebuild-test.ts before 320960e4… table '{}', after ab734947… with exactly the tuple;
     - afterwards rebuild-test.ts still 320960e4…, the full-root inventory equal to the E2 reference, no .activation-tmp.

F. State B checks after (any failure = STOP):
 F1. policy-match and layout-recheck against dc7b585d… pass.
 F2. No residue (as A5); HEAD 06e88227…; tracked tree clean against HEAD.
 F3. Read-only production health by file and service reads only, no database query: deployed ref
     ff100dc2b8da8523f550ef45a9eaa3ef96d9d840, BUILD_ID vcxM_SyDxFCP0sj9n9W1t, no rollover journal, afldb.service active.
 F4. Closing evidence manifest retained. EXEC stays in State B at the binding commit.
 State B is never described as having passed a successor database rebuild or the 91 SQL checks.

Stop and recovery (decision §6/§8). STOP on any failed check, native drift, pin or hash mismatch, pending
journal or temp file, date other than D, time bound reached, or unexpected REFUSED.
- If the planner refuses before writing, confirm zero tracked writes and return.
- If the apply is interrupted (journal present), preserve the journal and the seven paths, classify the state as
  all-new, all-old or mixed, and return for my recovery decision. Never recover activation through the journal.
- Do not start E1 after 03:50:00Z. Stopping between commit-tree and update-ref is a safe point.
- If any E1 check fails (diff --cached, write-tree or SHA), do not move HEAD; preserve the index as staged and
  the evidence, and return. If E2 or F fails after HEAD moved, leave HEAD at 06e88227…; restoring HEAD to P
  needs a separate decision.
- F1's layout-recheck covers the clean-install node_modules layout. Any failure there is a STOP, whatever its cause.
- If State B fails, STOP and return. Never commit a mixed state. Discarding EXEC needs a separate decision.

Not approved: activation or deactivation with --apply, any commit other than E1 in EXEC, repository commits or merges, push, new or regenerated
authority, new native policy, new census, package holds or timer changes, deployment, rebuild, migrations, any
production write, Brownlow work, or discarding EXEC.
```
