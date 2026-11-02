# ISSUE-316 C4b rerun: the filled approval for N = `924ff273` (prepared 2026-11-02; NOT GRANTED; nothing pushed or run on production)

This file is a local commit **after** the pinned package commit `N`; it is not part of `N` and is not pushed with it. Governing document: [c4b-gate-fix-rollout-and-rerun-2026-11-02.md](c4b-gate-fix-rollout-and-rerun-2026-11-02.md) (committed at `N`). The scripts it names are the bytes at `N` under `docs/v2/evidence/c4b-fix-r2-20261102/`.

| Item | Value |
|---|---|
| `N` (pinned package commit) | `924ff273261834e4112e3f41b61ceeab55427534` |
| `F` (the gate fix, ancestor of `N`) | `b08c83070d4a08bdb3bd492983abf2acb1b10547` |
| Production checkout now / `origin/main` now | `ea98a35f20610e75c18e698bc0d9fe084c3c783d` (read-only `git ls-remote` on 2026-11-02 confirmed `origin/main`) |
| Static delta check at `N` | `STATIC DELTA CHECK PASS`, also when piped from `git show N:…` the way D1 runs it; negative controls FAIL as required |
| Executable delta `ea98a35f..N` | `tools/current-season/afl-api-c4b-rehearsal.ts`, `tools/current-season/settle-afl-api.ts` (one keyword), `tools/v2/c4b-isolated-e2e.mts`, `tests/afl-api-cutover.test.ts`. Nothing under `src`, `packages`, `deploy`, `data`, dependencies, lockfile or config |
| Script bytes (sha256 prefix, LF) | `run.sh` `e079945a…`, `rollout.sh` `96fb09e7…`, `static-delta-check.sh` `bdaebd2e…` |
| Evidence directory for the rerun | `/home/arm/backups/afldb/c4b-924ff273-r2` (must not exist; the first, `c4b-ea98a35f-r1`, is preserved) |

## The approval (copy, fill `<name>`, send)

```text
I approve the ISSUE-316 C4b gate-fix rollout and a fresh run, as written in
docs/v2/c4b-gate-fix-rollout-and-rerun-2026-11-02.md, at N=924ff273261834e4112e3f41b61ceeab55427534:
 (1) I will push exactly N to origin/main (fast-forward from ea98a35f20610e75c18e698bc0d9fe084c3c783d);
 (2) Claude may run, as arm over SSH on afldb-prod without sudo, rollout.sh pa, d1 and d2 exactly as written, which fast-forward the
     checkout /home/arm/projects/afldb from ea98a35f20610e75c18e698bc0d9fe084c3c783d to N (a checkout-only update: no build, no promotion,
     no restart; serving release ea98a35f2061--vY0EFS0DdR-TiPkxTZz6 untouched), and rollout.sh r1 only after a failed d2;
 (3) I grant D-316-13 afresh: run the C4b D1 rehearsal for season 2027 on afldb-prod at revision
     924ff273261834e4112e3f41b61ceeab55427534 with the evidence directory /home/arm/backups/afldb/c4b-924ff273-r2, reviewed by <name>;
     I am attending. Claude may run run.sh step-a, launch and step-c exactly as written; launch starts the tool ONCE. The first D-316-13
     grant is consumed (its run ended HALT; evidence c4b-ea98a35f-r1 stays).
Claude must not: start the tool a second time under any result, run it with --apply, change the switch other than through the tool, use
sudo, restart or reload any unit, enable or start any timer, edit .env, touch the release root, a grant, a backup or the first evidence
directory or snapshot, make any provider request outside the tool's own, push anything, or continue past a failed check. This does not grant
D-316-4 (C5) or any other decision.
```

## Order once granted

```text
W0   Claude (workstation)   bash docs/v2/evidence/c4b-fix-r2-20261102/static-delta-check.sh 924ff273261834e4112e3f41b61ceeab55427534
D0   Owner (workstation)    git push origin 924ff273261834e4112e3f41b61ceeab55427534:refs/heads/main
                            git ls-remote origin refs/heads/main     # must print 924ff273...
P-A  Claude over SSH        bash rollout.sh pa 924ff273261834e4112e3f41b61ceeab55427534   # on ea98a35f, before D1 the checkout still has the old scripts:
                                                                                       # scp the scripts from N's bytes (git show) to the host first, run by path
D1   Claude over SSH        bash rollout.sh d1 924ff273...     (fetch, origin/main == N, static check from N's bytes, ff-only)
D2   Claude over SSH        bash rollout.sh d2 924ff273...
A    Claude over SSH        bash run.sh step-a 924ff273... /home/arm/backups/afldb/c4b-924ff273-r2     # must end STEP-A PASS (C4B-PRE PASS inside)
RUN  Claude over SSH        bash run.sh launch 924ff273... /home/arm/backups/afldb/c4b-924ff273-r2     # probes node in tmux, then starts the tool ONCE
C    Claude over SSH        bash run.sh step-c 924ff273... /home/arm/backups/afldb/c4b-924ff273-r2     # read-only
```

Before D1 the production checkout does not yet contain these scripts, so P-A is run from copies taken out of `N` on the workstation (`git show N:docs/v2/evidence/c4b-fix-r2-20261102/rollout.sh > …`, `scp`, run by path), exactly as the GAP-006 rollout did; after D1 the checkout holds them and the pinned bytes are checked. `run.sh` and `rollout.sh` refuse anything that is not `afldb-prod` as `arm` (the launcher alone has a `--probe-only` mode, refused on production, that never starts the tool).

The reviewer named in the grant records the C4b verdict from the evidence directory. A `CLEAR` still does not approve C5.
