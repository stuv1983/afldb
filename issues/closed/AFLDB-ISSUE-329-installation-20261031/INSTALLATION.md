# AFLDB-ISSUE-329 — production installation package (2026-10-31)

Status: **ready for owner review; nothing here has run on production or DEV.** ISSUE-329 stays
*implemented and validated locally, production installation pending* until the live acceptance in §6
is evidenced. Production is unchanged at `9ed9c9dd3e84682c43e96c46e98974b245eb54ed` (`BUILD_ID`
`QNEHXAtU53TzUjj0Mb7mv`). Design and earlier proof: [`../AFLDB-ISSUE-329.md`](../AFLDB-ISSUE-329.md).

The package has two parts, each with its own approval:

- **Part A (§3): install the route.** Git integration and push, a fast-forward of the production
  checkout, adoption of production's existing known-good bundle, the drop-in, **one restart**, and
  the checks. **No build.**
- **Part B (§4): the first build through the route.** It is owner-paced, approved separately, and
  run only after Part A passes.

## 1. Candidate

`CANDIDATE` is the commit on `codex/issue329-release` that adds this file. A commit cannot contain
its own hash, so the approval request names it. Derive it and check it with:

```bash
git log -1 --format=%H codex/issue329-release -- issues/open/AFLDB-ISSUE-329-installation-20261031/INSTALLATION.md
git diff --name-only 6790983ab3d3ae5292ad8a311c203e2584bd04a5 "$CAND"   # only issues/, docs/ and Markdown paths
```

**Ancestry (verified 2026-10-31).**
- `main` = `origin/main` = production = `9ed9c9dd`. It is a `--no-ff` merge with parents `ff100dc2` and
  `df50fb0a`.
- `v2/rebuild` (`f44f62a5`) does **not** contain `9ed9c9dd`; its merge base with main is `df50fb0a`.
  Production therefore cannot fast-forward to `v2/rebuild`.
- `codex/issue329-release` was created at `9ed9c9dd`. It merges `v2/rebuild` with `--no-ff` as
  `6790983ab3d3ae5292ad8a311c203e2584bd04a5` (parents `9ed9c9dd`, `f44f62a5`; tree
  `b1d95b24c6e53317458229e04f1b3b35b39c2ccf`, identical to `f44f62a5`'s tree).
- `CANDIDATE` is that merge plus this verification record. `9ed9c9dd` is an ancestor, so `main`
  fast-forwards. `origin/v2/rebuild` (`d3286d92`) is also an ancestor.
- Local `main` and `v2/rebuild` are unchanged.

**Code delta against production** (everything else is documentation):

| Path | Change |
|---|---|
| `deploy/release.mjs` | new: the release route |
| `deploy/afldb.service.d/release-route.conf` | new: the production drop-in |
| `deploy/server-cluster.mjs` | +17 lines: the never-fatal identity journal line |
| `next.config.ts` | +14 lines: `typescript.ignoreBuildErrors` only for `AFLDB_BUILD_TYPECHECK=off-host` |
| `tsconfig.json` | excludes `docs/v2/evidence` |
| `tests/deploy-release.test.ts` | new |

There are no migrations between `9ed9c9dd` and `CANDIDATE`, and no `package.json` or
`package-lock.json` change.

**File hashes at `CANDIDATE`** (`preflight.sh` re-checks them with `git show`):

| File | SHA-256 |
|---|---|
| `deploy/release.mjs` | `f5a24a71e5cdef24f9b7aeba428c7c89e02353fa5f123da12ea37b94514e6b4b` |
| `deploy/afldb.service.d/release-route.conf` | `14942fc53421ff60eddb738b338e7a3db38a22429839fb4eabd8978edea1f5ff` |
| `deploy/server-cluster.mjs` | `d82f24c48e2bc310857826e8fecc2e5ad90381ec3267c0d1ddba5ae19a822865` |
| `deploy/afldb.service` (unchanged) | `a3444840e0bd5f94ea05ea4b01508e0e8209d65ae452be665c1049c6b34e149a` |
| `tools/build/env-in-standalone.mjs` | `99ed47c6d673e6dd1f9c789097be202e704162edcc98623e7182bac9d58635c2` |
| `package-lock.json` | `984b44221f8f72560c7b58f1f8642427cc6ece03d30623a7e2e45d1df23d8e86` |
| production manifest `standalone-manifest.sha256` | `b8a0c6d33b9fd623185b2b2e08fd9b041b973602db82e93eefae520b4b556a29` (12,994 files, 0 symlinks) |

This package's own files are listed in [`SHA256SUMS`](SHA256SUMS).

## 2. Evidence (2026-10-31, workstation and isolated Linux only)

All evidence is in [`evidence/`](evidence/). No application build was run for this verification.
Both releases used are existing artifacts, identified below.

**Off-host type-check (E1).** [`typecheck.log`](evidence/typecheck.log):
- Input: a `git archive` of merge `6790983a` (tree `b1d95b24…`) on WSL Ubuntu 24.04, Node v22.21.0,
  npm 10.9.4.
- `npm ci` exited 0 in 7 s.
- **`npm run typecheck` (`next typegen && tsc --noEmit`) exited 0 in 39 s.**
- `tests/deploy-release.test.ts` passed **25/25**, including the Linux route cases, and
  `tests/deploy-web-unit.test.ts` passed **31/31**.

`CANDIDATE` differs from `6790983a` only in this record (§1 check), so the result covers it.
Reusing earlier evidence was not needed.

**Final real-systemd proof F0–F7 (E2).** [`proof.log`](evidence/proof.log),
[`journal-F.txt`](evidence/journal-F.txt), [`probe-restart-B.txt`](evidence/probe-restart-B.txt).
It closes the stated proof gap: S1–S7 had run with the pre-review `release.mjs` (`c61fbfee…`).

Setup:
- systemd 255, run from the candidate tree's `release.mjs` (`f5a24a71…`).
- The unit was generated from `deploy/afldb.service`, retargeted only for user, paths, Node and the
  PostgreSQL dependency.
- **The drop-in was installed as a real drop-in file**: `DropInPaths` showed it, and
  `WorkingDirectory` and `ReadWritePaths` merged as designed.
- Database: isolated PostgreSQL 16 on loopback port 55461.

| # | Step | Result |
|---|---|---|
| F1 | adopt release A by its recorded manifest | `ADOPTED 5bf6942f475d-gC9Y3ew1t8MqKAeq01-8D` (2,935 files hash-checked); `verify` PASS |
| F3 | start through the route | `status --expect` PASS (process cwd in A; own `_buildManifest.js` 200; health ok/ok). The journal logged the identity line. The CSS asset and `_buildManifest.js` were 200 and their served bytes equal the release's files |
| F4 | filesystem restrictions, inside the service's mount namespace | own release `.next/cache`: writable by the service user. Every other probe was `EROFS`, **even for root**: the checkout, beside `.env`, the release root, replacing `current`, `/etc`, `/usr` and other home paths. `PrivateTmp` is isolated |
| F5 | promote release B (no rebuild); restart | `verify` B PASS. `status` FAILed before the restart, as designed (process, 404, 200). After the restart, `status --expect` B PASS, A's BUILD_ID 404, journal identity line B, assets byte-identical |
| F6 | roll back to A without rebuilding; restart | 0.2 s; `builds/` unchanged (no workspace, so no build, `npm` or Git). After the restart, `status --expect` A PASS and B's BUILD_ID 404. `verify` A and B PASS after serving |
| F7 | cleanup | test unit and temporary `.env` removed; root and logs kept |

**Production-format manifest (E3).** [`adopt-format.log`](evidence/adopt-format.log):
- Production's manifest came from the pinned `artifact-manifest.mjs` (`ea37a7e7…`), not `sha256sum`.
- A manifest written by that script over bundle A has the same entries as A's `sha256sum` manifest.
- `adopt` from it: PASS, then `verify` PASS.
- A wrong `--expect-build-id` refuses and sets no link.

**Package dress rehearsal R0–R9 (E4).** [`rehearsal.log`](evidence/rehearsal.log). This package's
`preflight.sh` and `post-install-check.sh` ran unmodified, with only environment overrides. One of
those overrides is `PUBLIC=http://127.0.0.1:3100`, so the TLS and Caddy path was not rehearsed. Stage
13 already curled `https://beta.afldb.com` from the host. The script's journal-unverified branch was
not exercised either: the rehearsal user could read the journal. The
sequence started from production's **present** layout: the unit without the drop-in, serving the
in-place bundle from the checkout.

| # | Step | Result |
|---|---|---|
| R1 | preflight install | PREFLIGHT PASS |
| R2 | adopt, verify | PASS |
| R3 | drop-in, restart, check | POST-INSTALL CHECK PASS |
| R4 | §3 A6 back-out | serving in place from the checkout again (`release in-place`) |
| R5 | re-install, check | PASS |
| R6 | preflight build | PASS |
| R7 | promote, check | PASS |
| R8 | rollback, check | PASS |
| R8b | the start-limit hazard (O2) reproduced deliberately | the check refuses a stopped unit; `reset-failed` + `start` recovered it; PASS |

The first attempt ([`rehearsal-attempt1-start-limit.log`](evidence/rehearsal-attempt1-start-limit.log))
restarted without pacing and hit O2 on its sixth start. That is why §3 paces restarts.
A second, paced attempt passed with the scripts as they stood before the focused review
([`rehearsal-attempt2-prereview-scripts.log`](evidence/rehearsal-attempt2-prereview-scripts.log)).
`rehearsal.log` is the re-run with the final, committed scripts.

**Artifact identities** ([`artifact-identities.txt`](evidence/artifact-identities.txt)). Both are reused, not rebuilt:
- **A** is the in-place bundle of the earlier S1 step: proof-tree revision `5bf6942f`, BUILD_ID
  `gC9Y3ew1t8MqKAeq01-8D`, manifest `41e14531…` (2,935 files). It was re-checked with
  `sha256sum -c` before use. It stands in for production's in-place bundle.
- **B** is release m7: `1a95a5c3b730-o-bFsiDenQy8syPTbRMwz`, manifest `2d2b2f37…` (2,936 files).
  - The final tool built it and ran V1–V7 on it at 00:27Z, with the beta gate on and the smoke
    authenticated.
  - Its source `1a95a5c3` is blob-identical to `44251c1f` in every non-Markdown file. The only other
    difference is the exec bit on three files with identical blobs.
  - It was copied with `cp -a`, renamed into `releases/`, and passed `verify` against its manifest
    before promotion.

**Observations.** None is an ISSUE-329 defect, and none was investigated further.
- **O1. A restart takes about 5 s.** On SIGTERM, Next's workers exit with **code** 143, not by
  signal. `deploy/server-cluster.mjs`'s shutdown test (`signal === 'SIGTERM'`) misses them and
  respawns them, until the primary's 5 s exit timer fires and systemd SIGKILLs the rest.
  - Measured (`probe-restart-B.txt`): `systemctl restart` returned after 5.0 s. Health was refused
    for about 1.2 s, the old release answered for about 3.7 s, then health was refused for about
    0.3 s more.
  - Through Caddy, the two refused windows surface as 502s. The respawned workers are SIGKILLed at
    +5 s, possibly mid-request.
  - This is unchanged since `9ed9c9dd`. Production restarts behave the same today.
- **O2. Start limit.** The unit allows 5 starts per 120 s (`StartLimitBurst`, ISSUE-124). Manual and
  automatic restarts both count. A sixth start leaves the service **stopped** with `start-limit-hit`.
- **O3. Same CSS bytes.** Identical source gives identical CSS and `_buildManifest.js` bytes in A and
  B. Release identity therefore rests on the BUILD_ID URL (200 or 404), the process's working
  directory and the journal line, not on asset names.

## 3. Part A — install the route (owner window; no build)

**Rules for the whole window.**
- Read every output back before the next step.
- **Pacing: wait at least 30 s after one start of `afldb` before the next restart.** The 5-starts
  limit counts manual restarts (O2).
- Automatic restarts (`Restart=always`, `RestartSec=5`) count toward the limit as well.
- If any `systemctl restart` reports `start-limit-hit`, the service is stopped:
  - If the service started healthily since the last change, run
    `sudo systemctl reset-failed afldb && sudo systemctl start afldb` at once, then run the check in A5.
  - If there has been **no healthy start since A4**, the drop-in itself is failing. Use A6, not
    `reset-failed`.
- Nothing in Part A builds, runs `npm`, migrates, edits `.env`, touches Caddy, or changes the writers.

Shorthand, set in every shell used, both workstation and host. `CAND` is the full 40-hex
`CANDIDATE` from the approval request:

```bash
CAND=<40-hex CANDIDATE from the approval>
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node
PKG=issues/open/AFLDB-ISSUE-329-installation-20261031
```

Every host step runs in `/home/arm/projects/afldb` (`cd` there first in any new shell).

**A0. Git integration and push** (workstation, operator; `D:\dev\afldbV2`):

```bash
git fetch origin
git rev-parse origin/main                                   # must be 9ed9c9dd3e84682c43e96c46e98974b245eb54ed, else STOP
git rev-parse codex/issue329-release                        # must equal $CAND
git merge-base --is-ancestor origin/main codex/issue329-release && echo FAST-FORWARD-OK
git push origin codex/issue329-release
git push origin codex/issue329-release:main                 # fast-forward; a rejection is a STOP, never --force
git ls-remote origin refs/heads/main                        # must print $CAND
```

Local `main` and `v2/rebuild` are left alone here. Updating them, and pushing `v2/rebuild`
(a fast-forward from `d3286d92`), is a separate operator choice.

**A1. Preflight** (production, as `arm`, in `/home/arm/projects/afldb`; read-only):

```bash
cd /home/arm/projects/afldb && git fetch origin main
git cat-file -e "$CAND^{commit}" && echo CANDIDATE-PRESENT || echo "STOP: candidate not fetched"
git show "$CAND:$PKG/preflight.sh" > ~/r329-preflight.sh && bash ~/r329-preflight.sh install "$CAND"   # must end PREFLIGHT PASS (install)
```

The script is read from the candidate commit because the checkout is still at `9ed9c9dd`. If
nothing prints, `git show` failed: STOP.

It checks:
- the user, and HEAD at `9ed9c9dd`;
- a fast-forward to `CANDIDATE`, and a clean porcelain;
- that `CANDIDATE` differs from the typechecked tree only in documentation, with no migrations;
- the file hashes, and the pinned Node;
- that `afldb` is active, has no drop-in, and serves in place from the checkout;
- the in-place BUILD_ID `QNEHXAtU53TzUjj0Mb7mv`, and the manifest hash, 12,994 files, 0 symlinks;
- that `/home/arm/afldb-releases` is absent or empty;
- **at least 6 GB free disk and at least 800 MB `MemAvailable`**. It also prints `free`, swap and
  `MemoryCurrent`.

It also reports whether `arm` can read the journal; see A5.

**A2. Fast-forward the checkout** (Git only; `.next` is untracked and is not touched):

```bash
git merge --ff-only "$CAND" && git rev-parse HEAD && git status --porcelain | wc -l   # $CAND, 0
cat .next/standalone/.next/BUILD_ID                                                      # QNEHXAtU53TzUjj0Mb7mv
```

The running service is unaffected. If it restarts before A4 (for example after a crash), it runs the
candidate's `deploy/server-cluster.mjs` over the same in-place bundle. That case is proven in R4,
where the journal logged `release in-place revision unknown`.

**A3. Adopt production's known-good bundle** (no restart; writes about 0.81 GB):

```bash
$N deploy/release.mjs adopt --checkout /home/arm/projects/afldb \
  --revision 9ed9c9dd3e84682c43e96c46e98974b245eb54ed --afldb-env production \
  --expect-build-id QNEHXAtU53TzUjj0Mb7mv \
  --from-manifest /home/arm/backups/afldb/release-v2-20261030T210000Z/standalone-manifest.sha256
$N deploy/release.mjs verify 9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv
$N deploy/release.mjs status --no-live
```

Expected output:
- `ADOPTED 9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv (12995 files; 12994 files from …)`. That is 12,994
  bundle files plus the supervisor. It is fewer if the server has deleted recorded ISR pages; those
  are left to regenerate and are counted in the trailing note. It ends with `current set`.
- Then `VERIFY PASS`, and `STATUS PASS` with `--no-live`.

Refusals:
- `… is being rewritten by the server; retry` means the server was regenerating a page: wait 10 s and
  run the same command again.
- Any other refusal is a STOP. Nothing serving has changed.

The adopted supervisor comes from `9ed9c9dd` and predates the identity line, so this release logs
none.

**A4. Install the drop-in and restart** (owner sudo):

```bash
sudo install -D -o root -g root -m 0644 /home/arm/projects/afldb/deploy/afldb.service.d/release-route.conf \
  /etc/systemd/system/afldb.service.d/release-route.conf
sha256sum /etc/systemd/system/afldb.service.d/release-route.conf     # 14942fc53421ff60eddb738b338e7a3db38a22429839fb4eabd8978edea1f5ff
sudo systemctl daemon-reload
systemctl show afldb -p DropInPaths -p WorkingDirectory -p ReadWritePaths   # systemd prints these in its own order:
#   WorkingDirectory=/home/arm/afldb-releases/current
#   ReadWritePaths=/home/arm/afldb-releases/releases -/var/www/afldb-soon
#   DropInPaths=/etc/systemd/system/afldb.service.d/release-route.conf
sudo systemctl restart afldb                                          # returns after about 5 s (O1)
```

If `systemctl show` differs **before** the restart, remove the file and `daemon-reload`. That
restores the state before A4 with no restart.

**A5. Post-install checks.**

```bash
cd /home/arm/projects/afldb
bash $PKG/post-install-check.sh 9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv   # must end POST-INSTALL CHECK PASS …
```

The script checks:
- `status --expect`, and health plus the BUILD_ID's `_buildManifest.js` through `127.0.0.1:3100` and
  `https://beta.afldb.com`;
- the pages `/ /beta /players /matches /seasons /clubs /records /search /admin/operations`, following
  redirects. With the beta gate on, anonymous requests land on `/beta` or `/admin/login`, so the
  pages behind the gate are covered only by the Playwright smoke;
- every CSS and JS asset those pages reference: 200, the right type, and bytes identical to the
  release's files;
- that `POST /api/admin/email-intake` returns 410;
- the journal since the start: a primary line, and 0 `error|fatal|unhandled` lines.

On a pass, `status --expect` appends a `status-pass` line to `/home/arm/afldb-releases/events.log`.
That is the script's only write, and Part B's preflight needs it.

If `arm` cannot read the journal, that is not an application failure. The script then ends with
`POST-INSTALL CHECK PASS … (journal unverified …)` and prints two `sudo journalctl` commands. The
owner runs them: the first must show the `[afldb] primary` line, and the second must print 0. Only a
FAIL from the script, or a non-zero error count, triggers A6.

Filesystem restrictions on the host (owner sudo; each must print `Read-only file system`):

```bash
P=$(systemctl show -p MainPID --value afldb)
sudo nsenter -t "$P" -m touch /home/arm/projects/afldb/.r329-probe
sudo nsenter -t "$P" -m touch /home/arm/afldb-releases/.r329-probe
```

If either `touch` succeeds, that is a STOP. First remove the file with
`sudo rm -f /home/arm/projects/afldb/.r329-probe /home/arm/afldb-releases/.r329-probe`, because a
left-over probe dirties the checkout for every later preflight. Then back out with A6.

**Playwright smoke** (workstation; the owner signs in; headed Chromium; read-only navigation). Use
the Stage 13 script, with a **new** output directory:

```bash
cd D:\dev\afldbV2
node docs/v2/evidence/production-execution-20261030/session-20261030T210000Z/session-scripts/live-accept.mjs <new-empty-evidence-dir>
```

PASS requires these in `results.json`:
- `public-home-past-beta-gate`;
- `ops-authenticated-content` and `ops-admin-navigation`;
- `ops-static-and-console`;
- `ops-desktop-no-overflow`, `ops-mobile-no-overflow` and `ops-mobile-content`;
- each `public-page <href>` and its `no-overflow` check.

The script has two known false failures, both documented in the execution record (§3) as its own
assertions:
- `ops-no-mutation-controls` fails on the Sign-out form.
- A `public-page` check can fail only because `staticSeen` is 0: in-app navigation reused assets that
  were already loaded. Its `badStatic` and `consoleErrors` must still be empty.

Any non-empty `badStatic` or `consoleErrors` is a FAIL.

**A6. Back-out of Part A** (before any promotion; owner sudo):

```bash
sudo rm /etc/systemd/system/afldb.service.d/release-route.conf
sudo rmdir /etc/systemd/system/afldb.service.d 2>/dev/null || true   # removes the directory only if it is empty
sudo systemctl daemon-reload
sudo systemctl restart afldb                                          # 30 s after the last start
P=$(systemctl show -p MainPID --value afldb); readlink /proc/$P/cwd   # /home/arm/projects/afldb
curl -s http://127.0.0.1:3100/api/health                              # status ok, database ok
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/_next/static/QNEHXAtU53TzUjj0Mb7mv/_buildManifest.js   # 200
```

The journal then logs `serving build QNEHXAtU53TzUjj0Mb7mv release in-place revision unknown` (R4).
- This back-out is valid **only while the checkout's `.next/standalone` is intact**: BUILD_ID
  `QNEHXAtU53TzUjj0Mb7mv`, and no in-place build since.
- The checkout may stay at `$CAND`. Moving it back is a separate Git decision.
- The release root is inert without the drop-in.
- After any promotion (Part B), back out with `rollback` instead.

**Part A passes** when A5's check (and, if it reports the journal unverified, the owner's two
journal commands) and the Playwright smoke pass. The issue is then *route installed,
first route build pending*. It is not resolved.

## 4. Part B — first build through the route (separate approval; owner-paced)

**B0. Preflight and capacity** (as `arm`, read-only):

```bash
cd /home/arm/projects/afldb
bash $PKG/preflight.sh build "$CAND"     # must end PREFLIGHT PASS (build)
free -m; systemctl show -p MemoryCurrent afldb; df -h /home/arm
```

The preflight requires:
- the drop-in active, with the service serving `current`;
- the adopted release retained, with a recorded `status-pass`;
- no lock, and smoke port 3199 free;
- **at least 6 GB free disk**;
- **at least 2,100 MB `MemAvailable`**, the tool's admission floor for `--typecheck off-host`.

The tool re-checks admission itself. The build's guard kills only the build below 384 MB.

**Insufficient memory is a STOP, never a workaround:**
- **Do not** add or enable swap.
- **Do not** stop or restart the service to free memory.
- **Do not** lower `--require-available-mb`, `--min-available-mb` or `--require-free-gb`, and do not
  change the heap.

Report the figures. The owner then decides on runbook §7 options 2–3 as a new decision. A guard
abort is the same case: an ordinary failed build, with the serving release untouched.

**B1. Build** (run inside `tmux` or `screen` if available: a dropped session sends SIGHUP, which ends
the build safely with exit 130):

```bash
$N deploy/release.mjs build --checkout /home/arm/projects/afldb --revision "$CAND" --afldb-env production \
  --typecheck off-host --smoke-paths /players,/clubs,/seasons \
  --typecheck-evidence "npm run typecheck exit 0 (next typegen && tsc --noEmit) on Linux (WSL Ubuntu 24.04, node v22.21.0) for git archive of merge 6790983a (tree b1d95b24); $CAND differs only in issues/ records; 2026-10-31; issues/open/AFLDB-ISSUE-329-installation-20261031/evidence/typecheck.log"
```

- The expected result is `RELEASE READY <CANDIDATE12>-<BUILD_ID>`; call it `NEW_ID`. The build log
  records memory figures for each phase.
- Any `REFUSED` is a STOP. `current`, `previous` and the serving process are unchanged.
- A failed workspace keeps its logs under `builds/`. Its `node_modules` is removed.

**B2. Promote, restart, check:**

```bash
$N deploy/release.mjs promote NEW_ID
sudo systemctl restart afldb                                     # 30 s after the last start
bash $PKG/post-install-check.sh NEW_ID QNEHXAtU53TzUjj0Mb7mv       # also checks that the old BUILD_ID returns 404
```

Then run the Playwright smoke as in A5. The journal must log
`serving build <BUILD_ID> release NEW_ID revision $CAND`.

**B3. Roll back from the retained artifact** (on any failed gate; no build, `npm` or Git):

```bash
$N deploy/release.mjs rollback                                   # current -> 9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv
sudo systemctl restart afldb                                     # 30 s after the last start
bash $PKG/post-install-check.sh 9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv <NEW_BUILD_ID>
```

`rollback --to <id>` targets any retained release. A mistaken rollback is reversed the same way.

## 5. Stop conditions (all parts)

STOP and report, changing nothing further, on any of these:
- the preflight does not end PASS;
- `origin/main` is not `9ed9c9dd` at A0, or a push is rejected;
- the manifest hash differs from `b8a0c6d3…`;
- the in-place BUILD_ID is not `QNEHXAtU53TzUjj0Mb7mv`;
- the release root already has content;
- another drop-in is already present;
- a `release.mjs` `REFUSED` other than the documented retry;
- `systemctl show` differs from A4's expectation;
- a post-install check FAILs (A6 or B3 then applies);
- insufficient memory or disk (§4 B0: no swap, no service stop, no lowered threshold);
- a Playwright static-asset or console failure.

## 6. Live acceptance (what closes ISSUE-329)

Resolve ISSUE-329 only with production evidence of all of these:
1. Part A PASS: the A3 output, A4's `systemctl show`, A5 PASS and the Playwright smoke.
2. B1 `RELEASE READY` with its memory figures, then B2 PASS. The site's assets answered throughout
   the build.
3. The adopted release retained, with a recorded `status-pass` as the rollback target.

A deliberate production rollback is not required for closure; the rollback was proven in F6 and R8.
Until item 2 is evidenced, any production build must use the route. An in-place `npm run build` in
the checkout still destroys the in-place bundle that A6 depends on.

## 7. Retained artifacts and things that must not change

Do not delete or modify, pending a separate owner decision:
- the release `9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv`;
- the checkout's in-place `.next/standalone`;
- `/home/arm/backups/afldb/release-v2-20261030T210000Z/` (including the manifest);
- the workstation and streamanator backup copies.

Nothing deletes a release automatically. Out of scope throughout: the frozen EXEC/P/H records, `D:\dev\afldb`, ISSUE-327 (parked), `.env`, Caddy, the
writers, migrations and swap.

After installation, `docs/deployment.md` §3a and §11 govern production builds. The rollback runbook's
R4 header gate is replaced by `status --expect` in that runbook's next revision. The frozen execution
package keeps its in-place text as the record of what was approved then.

## 8. Approval requested

> Approve **Part A** of `issues/open/AFLDB-ISSUE-329-installation-20261031/INSTALLATION.md` at
> candidate `CANDIDATE`:
> - push `codex/issue329-release` and fast-forward `origin/main` from `9ed9c9dd` to `CANDIDATE`;
> - fast-forward the production checkout with Git only;
> - adopt the live bundle `QNEHXAtU53TzUjj0Mb7mv` against manifest `b8a0c6d3…` as
>   `9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv`;
> - install the drop-in with owner sudo, then one restart;
> - run the A5 checks and the Playwright smoke;
> - back out per A6 on any failed gate.
>
> No build, swap, `.env`, Caddy or migration change. Part B needs a separate approval.
