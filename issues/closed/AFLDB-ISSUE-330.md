# AFLDB-ISSUE-330 — release candidate and deployment package

Status: **RESOLVED 2026-10-31: deployed and live-accepted** under the owner's approval of §4 (§5).
Production serves `ad245d602f6f-m0M8pf121326vNSo2B759` (revision `ad245d602f6f0776c1fd86b66fef4f177fe63276`,
`BUILD_ID` `m0M8pf121326vNSo2B759`) through the ISSUE-329 release route. `61a95f7397da-JYIBkYn8ynPgYMn1e5nK-`
is retained as `previous`, the rollback target, and `9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv` stays retained.
§1–§4 are kept as approved; links in them that name `issues/open/` now resolve under `issues/closed/`.

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

## 5. Production deployment and live acceptance (2026-10-31)

Window: T0 **18:59:49 AEDT (07:59:49Z)**, promotion cut-off T0+20, hard end T0+45 (19:44:49 AEDT). Promotion
began at T0+6; acceptance passed at T0+12. Evidence: [`AFLDB-ISSUE-330-evidence/live/`](AFLDB-ISSUE-330-evidence/live/)
(host scripts under `scripts/`; console captures had their UTF-8 `…`/`§` mis-decoding by the Windows console
repaired, nothing else changed).

| Step | Result |
|---|---|
| Identities | `ad245d60` and package tip `65c02ecc` (child of `ad245d60`) verified; their difference is `issues/` and Markdown only; no migrations from `61a95f73` |
| D0 | `origin/main` read `61a95f73`; atomic fast-forward push, no force: `main` and `codex/issue329-release` `61a95f73..65c02ecc`; both read back `65c02ecc` |
| D1 | checkout `61a95f73` → `65c02ecc` by `git merge --ff-only`, porcelain 0; `STATUS PASS 61a95f7397da-JYIBkYn8ynPgYMn1e5nK-`; drop-in active, serving `current`; no lock; port 3199 free; rollback target has its `status-pass`; MemAvailable **2,866 MB** (floor 2,100), free disk **55 GB** (floor 6) |
| D2 | in `tmux`, `build --revision ad245d60… --afldb-env production --typecheck off-host` with the recorded evidence: `npm ci` 17 s; `next build` 227 s, min MemAvailable 1,274 MB, peak RSS 1,721 MB; V1–V5 passed; boot smoke health ok, `_buildManifest.js` 200, CSS 200, `/` `/players` `/clubs` `/seasons` 200 (beta claim); **`RELEASE READY ad245d602f6f-m0M8pf121326vNSo2B759`** (12,995 files, manifest `9a0bdd6d…`). Live health 200 throughout |
| D3 | promote 08:05:43Z (`previous` → `61a95f7397da-JYIBkYn8ynPgYMn1e5nK-`); owner `sudo systemctl restart afldb`, active 19:06:29 AEDT, `NRestarts=0`; **`STATUS PASS`**; **`POST-INSTALL CHECK PASS`** with the previous `JYIBkYn8ynPgYMn1e5nK-` 404 at the origin on loopback and cache-busted (`BYPASS`), its plain public URL reported as one `CACHE` line (old Cloudflare HIT), 8/8 assets byte-identical, email-intake 410, 0 journal error lines; journal `serving build m0M8pf121326vNSo2B759 release ad245d602f6f-m0M8pf121326vNSo2B759 revision ad245d60…` |
| D4 | [`live-accept-330.mjs`](AFLDB-ISSUE-330-evidence/live-accept-330.mjs), headed Chromium, owner sign-in (visible role Super Admin): **PASS 13/13**. Desktop 1440×900 and mobile 390×844: row 1 Scott Pendlebury 442; page 1 descends 442 → 325 (50 rows); Riley Onley and Fred Rodriguez absent; no 0-game row; no document overflow; 12 and 11 static assets, 0 bad, 0 console errors. Screenshots inspected: the consent banner sits mid-capture because it is fixed-position in a full-page screenshot |
| D5 | not used |

**Checkout vs running build.** The serving checkout is at `65c02ecc29f93cec8410e01c91f4fc293002b774` (the package
tip, documentation-only over the build revision). The running release is `ad245d602f6f-m0M8pf121326vNSo2B759`, built
from revision `ad245d602f6f0776c1fd86b66fef4f177fe63276`, `BUILD_ID` `m0M8pf121326vNSo2B759`.

**Retention.** Nothing was deleted: releases `ad245d60…` (current), `61a95f73…` (previous, rollback target) and
`9ed9c9dd…`; the checkout's in-place bundle; manifests; backups; the build workspace `builds/20261031T080059Z-ad245d602f6f-d2fffb`
with its logs; the host console log `/home/arm/afldb-issue330-D2-build.log` and its launcher. Backup retention review:
no earlier than 2026-11-30.

**Not claimed.** Other list surfaces were not audited. The pending `?_rsc=` prefetch observation is unchanged and is
not registered as a defect.
