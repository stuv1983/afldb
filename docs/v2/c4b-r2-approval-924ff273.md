# ISSUE-316 C4b rerun: the filled approval for N = `924ff273` (prepared 2026-11-02; NOT GRANTED; nothing pushed or run on production)

This file is a local commit **after** the pinned package commit `N`; it is not part of `N` and is not pushed with it. Governing document: [c4b-gate-fix-rollout-and-rerun-2026-11-02.md](c4b-gate-fix-rollout-and-rerun-2026-11-02.md) (the procedure sections are as committed at `N`; section 4 was corrected afterwards, by a later local docs-only commit, with the measured feed comparison and is informational only). The scripts it names are the bytes at `N` under `docs/v2/evidence/c4b-fix-r2-20261102/`.

| Item | Value |
|---|---|
| `N` (pinned package commit, and the exact revision to push) | `924ff273261834e4112e3f41b61ceeab55427534` |
| `F` (the gate fix, ancestor of `N`) | `b08c83070d4a08bdb3bd492983abf2acb1b10547` |
| Production checkout now / `origin/main` now | `ea98a35f20610e75c18e698bc0d9fe084c3c783d` (read-only `git ls-remote` on 2026-11-02 confirmed `origin/main`) |
| Static delta check at `N` | `STATIC DELTA CHECK PASS` (re-run after the comparison record; also when piped from `git show N:…` the way D1 runs it; negative controls FAIL as required) |
| Executable delta `ea98a35f..N` | `tools/current-season/afl-api-c4b-rehearsal.ts`, `tools/current-season/settle-afl-api.ts` (one keyword), `tools/v2/c4b-isolated-e2e.mts`, `tests/afl-api-cutover.test.ts`. Nothing under `src`, `packages`, `deploy`, `data`, dependencies, lockfile or config |
| Script bytes (sha256 prefix, LF) | `run.sh` `e079945a…`, `rollout.sh` `96fb09e7…`, `static-delta-check.sh` `bdaebd2e…` (identical at `N` and at the later local commits) |
| Evidence directory for the rerun | `/home/arm/backups/afldb/c4b-924ff273-r2` (must not exist; the first, `c4b-ea98a35f-r1`, is preserved) |
| Evidence reviewer | Stuart |

## Measured feed comparison (read-only copy, offline; no provider request)

Retained pin `21fd12e7…c84d` (266,389 bytes) against the first run's live capture `1a51317b…7ced` (266,461 bytes, verified). Match ids 218 / 218, **0 added, 0 removed**; status **0 changes**; dates and times **0**; teams **0**; rounds **0**; structural **0**; meta identical. **Exactly four leaves differ, all `venue.name`**, same venue (`CD_V200`, id 4, abbreviation `UTAS`): `"UTAS Stadium"` becomes `"University of Tasmania Stadium"` on `CD_M20270140807`, `CD_M20270141103`, `CD_M20270141805`, `CD_M20270142107` (4 x 18 = the 72 bytes). Venues are resolved by `providerId`, so the rename reaches no mapping, readiness result or canonical row. Detail and code references: section 4 of the governing document; report: `evidence/c4b-fix-r2-20261102/live-feed-comparison.json`.

## Push of exactly N (Windows Git Bash, owner)

Pushes the explicit object, never `HEAD`. It refuses unless the object exists, is a commit, is the intended hash, is a fast-forward of what origin has, and the package bytes are as pinned. Local commits after `N` (this file, the comparison record) are not pushed.

```bash
( set -euo pipefail
  N=924ff273261834e4112e3f41b61ceeab55427534
  OLD=ea98a35f20610e75c18e698bc0d9fe084c3c783d
  cd /d/dev/afldb
  [ "$(git rev-parse --verify "$N^{commit}")" = "$N" ]                       # the object exists and is exactly N
  echo "local HEAD is $(git rev-parse HEAD) (informational: the push below uses N, not HEAD)"
  git merge-base --is-ancestor "$OLD" "$N"                                    # N descends from what production has: a fast-forward
  [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$OLD" ]            # nobody pushed since; origin/main is still ea98a35f
  [ "$(git show "$N:docs/v2/evidence/c4b-fix-r2-20261102/run.sh" | sha256sum | cut -c1-8)" = e079945a ]
  [ "$(git show "$N:docs/v2/evidence/c4b-fix-r2-20261102/rollout.sh" | sha256sum | cut -c1-8)" = 96fb09e7 ]
  [ "$(git show "$N:docs/v2/evidence/c4b-fix-r2-20261102/static-delta-check.sh" | sha256sum | cut -c1-8)" = bdaebd2e ]
  bash docs/v2/evidence/c4b-fix-r2-20261102/static-delta-check.sh "$N" | tail -1   # must print STATIC DELTA CHECK PASS
  git push origin "$N:refs/heads/main"                                        # fast-forward only: no --force
  [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$N" ]
  echo "PUSHED $N" )
```

If any line fails the subshell stops before the push; nothing is changed. A non-fast-forward is refused by Git itself.

## The approval (copy and send; `Stuart` is already filled in)

```text
I approve the ISSUE-316 C4b gate-fix rollout and a fresh run, as written in
docs/v2/c4b-gate-fix-rollout-and-rerun-2026-11-02.md, at N=924ff273261834e4112e3f41b61ceeab55427534:
 (1) I will push exactly N to origin/main (fast-forward from ea98a35f20610e75c18e698bc0d9fe084c3c783d);
 (2) Claude may run, as arm over SSH on afldb-prod without sudo, rollout.sh pa, d1 and d2 exactly as written, which fast-forward the
     checkout /home/arm/projects/afldb from ea98a35f20610e75c18e698bc0d9fe084c3c783d to N (a checkout-only update: no build, no promotion,
     no restart; serving release ea98a35f2061--vY0EFS0DdR-TiPkxTZz6 untouched), and rollout.sh r1 only after a failed d2;
 (3) I grant D-316-13 afresh: run the C4b D1 rehearsal for season 2027 on afldb-prod at revision
     924ff273261834e4112e3f41b61ceeab55427534 with the evidence directory /home/arm/backups/afldb/c4b-924ff273-r2, reviewed by Stuart;
     I am attending. Claude may run run.sh step-a, launch and step-c exactly as written; launch starts the rehearsal ONCE. The first
     D-316-13 grant is consumed (its run ended HALT; evidence c4b-ea98a35f-r1 stays);
 (4) SWITCH RESTORATION (exit 3 only). If, and only if, the rehearsal ends with exit code 3 (RESTORATION NOT VERIFIED; the setting
     acquisition.afl_api_current_season_enabled may still be on), Claude is authorised to run, immediately and without waiting for me,
     as arm in /home/arm/projects/afldb, exactly this command and no other:
       /usr/bin/env PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:/usr/local/bin:/usr/bin:/bin \
         /home/arm/.nvm/versions/node/v22.23.2/bin/node node_modules/tsx/dist/cli.mjs tools/current-season/afl-api-c4b-rehearsal.ts \
         --restore-only --evidence-dir /home/arm/backups/afldb/c4b-924ff273-r2
     It may be run up to 3 times in total, stopping at the first run that ends 0 with "OFF, verified" (or "already reads false"), and
     must then be confirmed by run.sh step-c showing setting=[false]. This is the tool's recovery mode, NOT a second start of the
     rehearsal: it takes no --season or --decision, fetches nothing from the provider, rehearses nothing and writes only the one
     setting. If it still does not verify after 3 runs, or step-c shows any value other than false, Claude stops and reports to me at
     once; it does not edit the setting by any other route. This authority does not apply to exit 0, 1 or 2, and does not extend to any
     other result.
Claude must not: start the rehearsal a second time under any result (the restore-only command in (4) is the sole exception, and only
for exit 3), run it with --apply, change the switch other than through the tool, use sudo, restart or reload any unit, enable or start
any timer, edit .env, touch the release root, a grant, a backup or the first evidence directory or snapshot, make any provider request
outside the tool's own, push anything, or continue past a failed check. This does not grant D-316-4 (C5) or any other decision.
```

## Order once granted

```text
W0   Claude (workstation)   bash docs/v2/evidence/c4b-fix-r2-20261102/static-delta-check.sh 924ff273261834e4112e3f41b61ceeab55427534
D0   Owner (workstation)    the push block above (it ends by confirming git ls-remote origin refs/heads/main prints 924ff273...)
P-A  Claude over SSH        bash rollout.sh pa 924ff273261834e4112e3f41b61ceeab55427534   # on ea98a35f, before D1 the checkout still has the old scripts:
                                                                                       # scp the scripts from N's bytes (git show) to the host first, run by path
D1   Claude over SSH        bash rollout.sh d1 924ff273...     (fetch, origin/main == N, static check from N's bytes, ff-only)
D2   Claude over SSH        bash rollout.sh d2 924ff273...
A    Claude over SSH        bash run.sh step-a 924ff273... /home/arm/backups/afldb/c4b-924ff273-r2     # must end STEP-A PASS (C4B-PRE PASS inside)
RUN  Claude over SSH        bash run.sh launch 924ff273... /home/arm/backups/afldb/c4b-924ff273-r2     # probes node in tmux, then starts the tool ONCE
C    Claude over SSH        bash run.sh step-c 924ff273... /home/arm/backups/afldb/c4b-924ff273-r2     # read-only
```

Before D1 the production checkout does not yet contain these scripts, so P-A is run from copies taken out of `N` on the workstation (`git show N:docs/v2/evidence/c4b-fix-r2-20261102/rollout.sh > …`, `scp`, run by path), exactly as the GAP-006 rollout did; after D1 the checkout holds them and the pinned bytes are checked. `run.sh` and `rollout.sh` refuse anything that is not `afldb-prod` as `arm` (the launcher alone has a `--probe-only` mode, refused on production, that never starts the tool).

The reviewer named in the grant (Stuart) records the C4b verdict from the evidence directory. A `CLEAR` still does not approve C5.

## Coverage limitation (stated so that a CLEAR is not over-read)

The rerun is **season-feed-only**. The 2027 season has no `CONCLUDED` match before 2027-03-17, so it selects zero matches and exercises no `playerStats` or `matchRoster` request, no player-level row, no observation, no derived recompute and no apply path. A `CLEAR` proves: the gate agrees with the producer on production; the season feed is fetched and assessed complete; the dry run writes nothing canonical; the switch is turned on for the run, restored and verified; BEFORE equals AFTER; units and timers stay inert; readiness holds on the acquired feed. It does **not** verify match-level or player-level acquisition against production, and sustained provider rate behaviour is not observed (two requests: token and season feed). The venue relabel above is the only difference between the live feed and the pin.
