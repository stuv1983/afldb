# AFLDB-ISSUE-330 — release candidate and deployment package

Status: **candidate ready locally; NOT pushed, NOT deployed.** Push, `main` advancement and the
production deployment each need the owner's explicit approval. Production is unchanged: it serves
`61a95f7397da-JYIBkYn8ynPgYMn1e5nK-` (revision `61a95f7397dacc49fe919ca99cffa00379d612bf`) through the
ISSUE-329 release route, with `9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv` retained as previous.

## 1. Candidate

| | |
|---|---|
| **Candidate (build revision)** | `ad245d602f6f0776c1fd86b66fef4f177fe63276`, tree `89bd5b80ca163be6083d018a6af82d8b8f587c35` |
| Chain from production | `61a95f73` → `32694f14` (players sort fix) → `4bfe183e` (ISSUE-329 closure records) → `ad245d60` (maintenance) → the commit that adds this package (documentation only) |
| Code against production | `src/db/queries/players.ts`, `deploy/post-install-check.sh` (new), `deploy/release.mjs` (one comment), tests, docs |
| Migrations against production | **none** (`git diff --name-only 61a95f73 ad245d60 -- src/db/migrations` is empty) |

Contents:
1. **Players sort fix** (`32694f14`): `listPlayers()` orders the sort column `NULLS LAST` (and the
   premierships `c.games` tie-break), so career-less listed players no longer head descending sorts.
2. **Maintained post-install checker** `deploy/post-install-check.sh` (`ad245d60`), the successor of
   the frozen ISSUE-329 package checker (which is unchanged):
   - the previous BUILD_ID (default: the retained `previous` release's) must answer 404 **at the
     origin**: on loopback, and through the public endpoint with a cache-busting query;
   - a plain public 200 for it with `cf-cache-status: HIT` is reported as a separate `CACHE` line and
     is not a failure; any other 200 fails;
   - the current BUILD_ID, health and every CSS/JS asset of the key pages are still checked through
     the public endpoint, assets against the release's own bytes; `status --expect`, health, asset
     and journal failures still fail.
3. **Maintenance corrections** (`ad245d60`): `deploy/release.mjs` and `tests/deploy-release.test.ts`
   now name `issues/closed/AFLDB-ISSUE-329.md`. `docs/v2/rollback-runbook.md` §4.1/§4.4 (gate R4):
   `release.mjs rollback` → restart → `status --expect <PREV id>` → post-install check, replacing the
   `x-afldb-build` header gate. `docs/deployment.md` §3a documents the checker.

## 2. Review of the players sort fix (2026-10-31, independent read-only review)

Verdict **approve**; no finding at MED or above.
- The five sort columns are `NOT NULL` in `player_career_stats` (`007_derived_stats.sql:65-71,92`), so a
  NULL arises only from the LEFT JOIN miss. `NULLS LAST` moves only career-less players; a real 0 from
  an existing row keeps its numeric position in both directions.
- Tie-breaks are unchanged (`p.sort_name ASC` last; premierships keeps `c.games` second; the added
  `NULLS LAST` there is redundant but harmless). The `name`, `debut` and `final_game` branches are
  byte-identical to the parent.
- Ascending is unchanged: PostgreSQL already sorts NULL last under `ASC`. Career-less players stay at
  the end of an ascending list, rendered `0` by `COALESCE` (pre-existing, not introduced here).
- LOW: the `(col DESC)` indexes do not match `DESC NULLS LAST`, but `count(*) OVER ()` already forces a
  full sort, so there is no plan regression. LOW: the test has no real-zero or ascending case;
  optional hardening only, given the schema argument.

## 3. Checks

| Check | Result |
|---|---|
| PostgreSQL regression (reused, accepted) | isolated `afldb_v2_i330_test`: **5 failed** without the fix, **5 passed** with it. Not rerun: `src/` and `tests/integration/` are byte-identical between `32694f14` and `ad245d60` |
| Off-host type-check of the exact candidate | `git archive` of `ad245d60` on WSL Ubuntu 24.04.5, Node v22.21.0: `npm ci` exit 0; **`npm run typecheck` exit 0 in 41 s**; `package-lock.json` `984b4422…` as in ISSUE-329 E1. [`AFLDB-ISSUE-330-evidence/typecheck.log`](AFLDB-ISSUE-330-evidence/typecheck.log) |
| `tests/deploy-release.test.ts`, Linux | **33/33**, including the Linux route cases and the 8 checker controls (same log) |
| `tests/deploy-release.test.ts`, Windows workstation | 21 passed, 12 skipped (the Linux-only route block) |
| Checker controls bite | two deliberate mutations (cache HIT counted as a failure; loopback check disabled) turned 2 and 1 controls red; the script was restored byte for byte |
| `eslint` on the changed TypeScript/JS | 0 errors; 3 pre-existing warnings, none on changed lines |

Not rerun, by instruction: the ISSUE-329 systemd proof, rebuilds, screenshots and installation.

## 4. Deployment sequence (route installed by ISSUE-329)

`C=ad245d602f6f0776c1fd86b66fef4f177fe63276`. `R` = the commit that adds this package, a
documentation-only child of `C`. Rollback target: **`61a95f7397da-JYIBkYn8ynPgYMn1e5nK-`** (status PASS
recorded at ISSUE-329 B2).

**D0. Push (owner, workstation).** `origin/main` must be `61a95f73`. Fast-forward only, no force:
`git push origin <R>:main`.

**D1. Pre-checks (arm, read-only apart from the checkout fast-forward).**

```bash
cd /home/arm/projects/afldb
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node
git fetch origin && git merge --ff-only origin/main      # HEAD 61a95f73 -> R; the in-place .next is untracked and untouched
git rev-parse HEAD; git status --porcelain                # R; empty
git diff --name-only 61a95f7397dacc49fe919ca99cffa00379d612bf ad245d602f6f0776c1fd86b66fef4f177fe63276 -- src/db/migrations   # empty
$N deploy/release.mjs status                              # current 61a95f7397da-JYIBkYn8ynPgYMn1e5nK-, STATUS PASS
ls /home/arm/afldb-releases/*.lock 2>/dev/null            # nothing
free -m; df -h /home/arm; systemctl show -p MemoryCurrent afldb
```

At least **2,100 MB `MemAvailable`** and **6 GB free disk** (the tool re-checks both). Short of either
is a STOP: no swap, no service stop, no lowered threshold.

**D2. Build** (inside `tmux`):

```bash
$N deploy/release.mjs build --checkout /home/arm/projects/afldb --revision ad245d602f6f0776c1fd86b66fef4f177fe63276 \
  --afldb-env production --typecheck off-host --smoke-paths /players,/clubs,/seasons \
  --typecheck-evidence "npm run typecheck exit 0 (next typegen && tsc --noEmit) on Linux (WSL Ubuntu 24.04.5, node v22.21.0) for git archive of ad245d60 (tree 89bd5b80); 2026-10-31; issues/open/AFLDB-ISSUE-330-evidence/typecheck.log"
```

Expect `RELEASE READY ad245d602f6f-<BUILD_ID>`; call it `NEW_ID`. Any `REFUSED` or failure is a STOP
with `current` and `previous` untouched.

**D3. Promote, restart, check:**

```bash
$N deploy/release.mjs promote NEW_ID          # previous becomes 61a95f7397da-JYIBkYn8ynPgYMn1e5nK-
sudo systemctl restart afldb                  # owner; at least 30 s after the last start
$N deploy/release.mjs status --expect NEW_ID
bash deploy/post-install-check.sh NEW_ID      # proves JYIBkYn8ynPgYMn1e5nK- absent at the origin
```

The journal must log `serving build <BUILD_ID> release NEW_ID revision ad245d60…`. A `CACHE` line for
`JYIBkYn8ynPgYMn1e5nK-` is an old Cloudflare copy and does not fail the check; every `FAIL` does.

**D4. Live acceptance of the fix.** Signed in at `https://beta.afldb.com/players?sort=games`: row 1 is
the 442-game leader, page 1 descends, and no 0-game row is on it (Riley Onley and Fred Rodriguez,
the career-less players in the original evidence, are absent).

**D5. Rollback on any failed gate** (no build, `npm` or Git):

```bash
$N deploy/release.mjs rollback                # current -> 61a95f7397da-JYIBkYn8ynPgYMn1e5nK-; previous -> NEW_ID
sudo systemctl restart afldb                  # owner; at least 30 s after the last start
$N deploy/release.mjs status --expect 61a95f7397da-JYIBkYn8ynPgYMn1e5nK-
bash deploy/post-install-check.sh 61a95f7397da-JYIBkYn8ynPgYMn1e5nK-
```

**Stop conditions:** a rejected push or `origin/main` other than `61a95f73`; a non-fast-forward
checkout; any migration in the diff; insufficient memory or disk; any `REFUSED`; a failed
`status --expect` or post-install `FAIL`; D4 not as stated (then D5).

**Retention.** Nothing is deleted: both earlier releases (`9ed9c9dd…` and `61a95f73…`), the checkout's
in-place bundle, manifests, backups and build logs stay. Backup retention review: no earlier than
2026-11-30.
