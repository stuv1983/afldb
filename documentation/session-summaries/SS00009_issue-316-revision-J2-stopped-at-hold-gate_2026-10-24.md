<!-- DOC: Step session summary for AFLDB-ISSUE-316 revision J2: F-J01 fix, re-pin, native policy re-derivation and review, F-J03 harness, stopped at the hold gate -->
<!-- DOC-SCOPE: PhanesLight working memory; AFLDB issues.md / IssuesIndex.md remain authoritative -->

# SS00009 — AFLDB-ISSUE-316 revision J2: F-J01 fixed and re-pinned, native policy re-derived and reviewed, harness hardened; stopped at the hold gate (2026-10-24)

Fourth orchestrator of run `i316J-20261024` (predecessors SS00006–SS00008), under owner ruling set 4 (J-08).
Returns are in `.phaneslight/returns/i316J-20261024/`:
- J-09: plan
- J-10: plan review, GO-WITH-CHANGES
- J-11: native policy review, ACCEPT-WITH-CONDITIONS
- J-12: closure, clean

The package is `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-J2-20261023T2346Z/` (`PROPOSAL_J2.md`; `HASHES.sha256` has 116 entries). Scratch work is in `D:/tmp/afldb-i316-J2-20261023T2317Z/`.

Production NO-GO. There was no push, deploy, apply, activation, census or populated-database contact.

## State: handover

**Done**
- Ruling 2 (F-J01): fixed in `876dadbf`.
  - Tests: affected file 1119 passed / 3 skipped; full DB-free 11,278 / 0 / 27 and 11,327 / 0 / 27; tsc 0; changed-line ESLint 0.
  - Regression proof: 8 of the new tests fail against the old code.
  - Closure: no drift and no API change.
- Re-pin (not pin-only): J2-pinned `85b5f05a…`.
  - Simulated commit 1 is `a1e16e67`, and commit 2′ is `87da1563` on `i316/J2-post-transition-on-876dadbf`.
  - The local pinned dry run passes.
- Ruling 1: native policy and record re-derived in the new root `/home/arm/afldb-i316-J2-native-20261023T2317Z`: policy `a8e586e0…`, record `82e25a10…`.
  - The comparison is exactly the permitted set (auditor path, libz 2.2 → 2.3).
  - The review accepted it with conditions C1–C6. C3 and C4 are met in the harness; C1, C2, C5 and C6 come at run time.
- Ruling 3 (F-J03): new harness.
  - `stage/` holds the gated driver, controls and criteria; the self-test passes 15/15.
  - `rbstage2/` holds the rebuild stage, and `hold/` the apply and restore scripts.
  - All three are staged and hash-verified on the host:
    - `/home/arm/afldb-i316-J2-stage-20261023T2317Z/{dryrun,rbstage2}`;
    - `/home/arm/afldb-i316-J2-hold-20261023T2317Z`.
- Packages J, I, H and G and the credential-incident record are byte-unchanged.
- Tracking was updated (issues.md, IssuesIndex.md, CHANGELOG.md, `docs/deployment.md` F-207) and committed separately.

**Outstanding (by plan step)**
- **S8 (owner gate)**
  - The owner applies the hold:
    `ssh -t arm@10.0.40.100 "sha256sum /home/arm/afldb-i316-J2-hold-20261023T2317Z/j2-hold-apply.sh && sudo bash /home/arm/afldb-i316-J2-hold-20261023T2317Z/j2-hold-apply.sh /home/arm/afldb-i316-J2-hold-20261023T2317Z"`
  - Expected digest: `de40408b14ec0f24c62b34aafac74f831e92deb4b8b90241b70f614addc026b8`.
  - The run must end `HOLD APPLIED`.
- **S9**
  - Run `bash /home/arm/afldb-i316-J2-stage-20261023T2317Z/dryrun/j2-drive.sh /home/arm/afldb-i316-J2-stage-20261023T2317Z/dryrun <UTC>`.
  - Its own steps re-check the pins, the policy match and the hold. The exit code is the criteria verdict.
- **S10 (only if S9 exits 0)**
  - `rb2-prepare.sh <rbstage2> <results-dir> <UTC>`
  - `rb2-bootstrap.sh <root> afldb_v2_rb_i316_revision_j2_test <rbstage2>`
  - `rb2-launch.sh <root> <db> <rbstage2>`
  - then `rb2-after.sh`, `rb-post.sh`, `rb-shutdown.sh` and `rb-collect.sh`
  - The root is `/mnt/ssd/afldb-i316-rb-J2-<UTC>`, on port 55787.
  - Never rerun: `REBUILD-ATTEMPT-CONSUMED` blocks a second launch.
- **S11**
  - The owner restores the hold: `sudo bash …/j2-hold-restore.sh …`.
  - Then: ISSUE-323 and ISSUE-324 closure per §5 if the rebuild proves their boundaries, package the evidence, and do a tracking commit.

**Open items**
- F-301 LOW: the comparator self-test negatives are incomplete; the verdict is unaffected.
- INFO, recorded and creating no work:
  - F-302: the hold simulation now parses `Remv` as well as `Inst`.
  - F-303: on-demand upgrade services stay enabled and honour holds; the process match now uses the full command line.
  - F-401 / F-210: the real-symlink test has not been run on Linux. Remote test execution was not authorised; the owner may authorise `npx vitest run tests/db-test-rebuild.test.ts -t "real symbolic links"` on DEV.
  - F-402: no defect found.

**Model substitution**
- The pinned reviewer model was unreachable three times (HTTP 500, 529, 529) for the native-policy review.
- J-11 ran on the next model down for that review only. It is recorded in J-11; no `pinned:project` entry, because it does not outlive the step.

**Harness corrections made after review**
- The apt process detection had a false positive: `unattended-upgrade-shutdown --wait-for-signal` matched under the 15-character comm truncation. It now matches the full command line.
- The hold simulation counts `Remv` lines (F-302).
- Both changes were re-hashed and re-staged.

**Resumption point:** S8. Nothing on the host needs cleanup. No root, cluster, port or database was created for the dry run or the rebuild.
