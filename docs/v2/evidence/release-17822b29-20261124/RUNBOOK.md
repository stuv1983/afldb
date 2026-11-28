# Attended application release of 17822b29 to production — Tuesday 24 November 2026 (PREPARED; NOT APPROVED; NOT EXECUTED)

| Item | Value |
|---|---|
| Application build target (fixed) | `CAND = 17822b29e6de2b6248cd7ada4221800fd81e0003`, published as `origin/main` on 23 Nov 2026 (owner-approved fast-forward from `ae51cd8d`, 33 commits; `git ls-remote` = CAND at 21:29 AEDT). Build CAND even if `origin/main` (PREP) advances: PREP only has to descend from CAND. |
| Serving now, rollback target | `7d92042fd110-XWruOm_9nLCSMY8nGPqYU` (revision `7d92042fd11010eaa20966e2f49ae7a93e286568`, BUILD_ID `XWruOm_9nLCSMY8nGPqYU`), accepted Sunday 22 Nov; InvocationID `342040625f6d4012a35d598dfbf9afe6`; previous link `c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC` ([Sunday record](../backlog-20261121/SITTING-A1-A2-20261122.md)) |
| Script revision (immutable) | `SCRIPT_REV = 58e35ce8805e9f559d3dd1008606f90efb84fbab` |
| Script manifest | `scripts/SHA256SUMS`, SHA-256 `b4e9e584ea47bfc3080cb7f336d50a417b4595a8b06beda93522eb6a0702d87c` (12 files, §0) |
| Window | **Proposed Tue 24 Nov 10:30–12:30 AEDT** (the asked-for 11:00–12:30 is too short for the worst case, §2). **Promotion cutoff 11:30, restart cutoff 11:35.** |
| Rehearsal | Clean export of SCRIPT_REV, streamanator, **87 passed, 0 failed** ([REHEARSAL.md](rehearsal/REHEARSAL.md)) |
| Out of scope | `.env`, schema, database, award and Brownlow data changes; publishing this prep commit; Wednesday's reboot (R6, separate approval, §8) |

> **Correction — 27 November 2026 (PROPOSED; Astra re-review required; not approved; this packet cannot run as it stands).**
> The 24 Nov sitting ended deferred ([record](SITTING-20261124.md)); its approval is spent, and the table above, §0 and §10 still
> describe the packet that sitting used: scripts at `58e35ce8`, manifest `b4e9e584…` (kept as
> [`orig-aa33f0fc/release-scripts-SHA256SUMS`](../backlog-20261121/r6-20261125/review-fixes-r4-20261127/orig-aa33f0fc/release-scripts-SHA256SUMS);
> the old bytes are `git show 58e35ce8805e9f559d3dd1008606f90efb84fbab:<path>`). Three scripts were then corrected after
> Astra's review of draft PR 5, at revision `a203c927d24bbd0b2bf4f67b3ddb2865a0fee0d3` (manifest `744e52ca…`), and G0 again after her review of
> `f92d6e29`, at revision `5553ecaf922d27a82da1d8f9a63633bb2883372d` (r5, manifest `14f0f89f…`), and G0 once more after her review of `624bf721`, at revision
> `937c7d437b1fbe96a5102fa3db0011c7d751a48d` (r6, manifest `9c4b6ca6…`). G0's bytes changed again, in a comment only, at revision
> `5c2c2280e4688a063a5f943512e4460e250b1135` (r7). `scripts/SHA256SUMS` now has SHA-256 `52900a0e2102ec09820b037babe4c327ff63ac72236f9c4a80b84f1f54b06b59`:
>
> * **G0 (`r1-g0-dump.sh`)**: the scheduled dump must be attributable to the backup **timer's dispatch** and to the one
>   successful service invocation it started; a successful start inside 02:20–02:31 alone is not enough (the same rule as R6 A-2).
>   **r5:** that invocation must also carry its origin, one `trigger:` journal line naming `afldb-backup.timer` with the timer's
>   `LastTriggerUSec` in microseconds, written only by the **prospective** `tools/maintenance/scheduled-backup.sh` (not installed on
>   production). **Until the owner installs it, G0 STOPs with `scheduled origin unproven` and prints no `OFFHOST-COMPARE`, by design**;
>   a manual backup never counts ([r5 record](../backlog-20261121/r6-20261125/review-fixes-r5-20261127/README.md)).
>   **r6 (28 Nov 2026), superseding that r5 origin rule:** the `trigger:` line came from arm's own checkout, so arm could forge it.
>   G0 now reads origin ONLY from a root record, `/var/lib/afldb-backup-attest/<invocation>.attest`. A root-owned writer
>   (`/usr/local/libexec/afldb/afldb-backup-attest`, a full-privilege `ExecStartPost` drop-in) writes it while the run's start job is live.
>   The record also binds the dump's name and full sha256 (hashed as arm), and G0 prints `OFFHOST-COMPARE` only for that dump.
>   At run time G0 verifies the writer's and the drop-in's pinned digests, the loaded unit, the helpers, the record and every parent directory.
>   **Open (owner decision):** G0 itself runs as arm, so arm's login environment can still forge its printed verdict; closing that needs a non-arm verifier.
>   `scheduled-backup.sh` stays at the production bytes. The writer is installed by a separate owner procedure outside the production checkout,
>   so P1/P2's clean-tree checks are unaffected. **Until it is installed, G0 STOPs with `scheduled origin unproven`, by design**
>   ([r6 record](../backlog-20261121/r6-20261125/review-fixes-r6-20261128/README.md)).
>   **r7 (28 Nov 2026), superseding the r6 origin rule and the arm-run G0 verdict (PROPOSED; independent review pending; nothing installed).**
>   (1) **G1:** the nightly dump is produced by the system account `afldb-backup`, not arm. A root `ExecStartPost` hashes its own copy,
>   writes a root seal and only then publishes the copy. G0 reads origin and dump only through `sealed_origin`, which uses PID 1, the
>   seal and the root-published copy re-hashed in full. (2) **G2: the GO evidence is the owner path only.** Stu runs
>   `afldb-verify-call.sh g0 <date>` on his workstation with his own verify key. It reaches the root-owned forced-command verifier on
>   production (G0a) and then on streamanator (G0b), and G0b gets the dump and sha256 only from the authenticated G0a RESULT line.
>   **A verdict printed by an arm-run script is no longer GO evidence**: `r1-g0-dump.sh` or `r6-offhost-verify.sh` over arm's ssh. arm's
>   login environment can forge it, which the r7 rehearsal reproduced as the contrast in scenario d. §4's G0 row and §4.1 are changed in
>   place, and §4.1a lists the installation preconditions. `r1-g0-dump.sh` changed in a comment only: MED-3 is a deterministic
>   substitution, not a race. A future approval statement (§10) must name Stu's owner-path G0 instead of a G0 that Claude runs as arm.
>   Until both installs are done and a sealed 02:20 run exists for the gate date, G0 STOPs, by design
>   ([r7 record](../backlog-20261121/r6-20261125/review-fixes-r7-20261128/README.md)).
> * **P4 (`r1-p4-gate-promote.sh`, `deploy/release.mjs`)**: the 11:30 cutoff is enforced by `release.mjs promote --not-after`
>   immediately before the link switch, after all validation, and P4 first requires `host-gate --not-after` to print the line
>   proving the tool enforces it (§2). **P4 therefore STOPs against a checkout whose `deploy/release.mjs` lacks the option,
>   which includes `17822b29` itself.** A future sitting must run P4 from a checkout that contains this change, under a new pin.
> * **P6 and the owner's journal check (`r1-p6-observe.sh`, §4.2)**: a successful query with zero `err` entries, not a line count.
>   A tick may still report `unreadable` (arm may not see the journal), so P6 prints a `P6 JOURNAL …` line saying how many ticks
>   read it: **P6 is complete only with the owner's `JOURNAL PASS rc=0 entries=0` line in the record.**
>
> The dated gates are unchanged on purpose (P4's cutoff is still 24 Nov 11:30; G0 accepts 24–29 Nov). A re-run needs a new date
> and pin, Astra's PASS at that review commit, a new owner approval and that day's evidence. Record:
> [review-fixes-r4-20261127/README.md](../backlog-20261121/r6-20261125/review-fixes-r4-20261127/README.md).

Every production step except G0 is a pinned script piped over **one SSH connection** as arm (`tr -d '\r' < <script> | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- <args>`). Since r7, G0 is Stu's owner-path call (§4.1). Claude runs the others only under the owner's approval statement (§10). The owner runs only the `sudo` lines and the browser check. **r8:** arm's SSH connection carries only these unprivileged pinned
scripts. Every privileged line (the §4.2 restart and journal reads, the §6 rollback restart, every §4.1a step) runs in the admin
session of [OWNER-PROCEDURE.md](../backlog-20261121/r6-20261125/review-fixes-r8-20261128/OWNER-PROCEDURE.md):
`afldb-admin`'s own SSH login with its own key, whose `sudo` asks for the admin's password. It may also run in that procedure's admin
root session, or at the console logged in as root. It never runs in an arm session, and a console login as arm does not count.
Without that path the privileged lines have no qualifying session. Never open a new connection at minute :16–:18 (streamanator's r2 check connects then): 10:16–10:18, 11:16–11:18 and 12:16–12:18. Never print `.env` values: names and counts only.

## 0. Staging (workstation Git Bash, before 10:30)

Stage once, verify, and use only the staged copies:

```bash
REV=58e35ce8805e9f559d3dd1008606f90efb84fbab
R=docs/v2/evidence/release-17822b29-20261124
O=docs/v2/evidence/backlog-20261121/r6-20261125/r6-offhost-verify.sh
git -C /d/dev/afldb archive --format=tar --output=/tmp/afldb-r1-20261124.tar "$REV" "$R/scripts" "$O"
ST=$(mktemp -d /tmp/afldb-r1-20261124.XXXXXX)
tar -xf /tmp/afldb-r1-20261124.tar -C "$ST"
cd "$ST/$R/scripts" && sha256sum -c SHA256SUMS
sha256sum SHA256SUMS
sha256sum "$ST/$O"
```

STOP unless all 12 lines say `OK`, the manifest digest is `b4e9e584ea47bfc3080cb7f336d50a417b4595a8b06beda93522eb6a0702d87c`, and `r6-offhost-verify.sh` is `429eec29acf254179c3b7ae7d6489a6c695981fd90996c5c2ce1301314bcc18c` (byte-identical to R6's reviewed pin). This exact sequence was run on 23 Nov 22:02 AEDT (REHEARSAL.md §1).

| File | SHA-256 |
|---|---|
| `r1-g0-dump.sh` | `3103c908302ea4c3a6422c64593069c0a8b0d3342d53205e9a536e86e295f5df` |
| `r1-p1-precheck.sh` | `95adf6290446275b41b721a319b082e9fdcf4feb61ba8788c4bbc33c367d89b9` |
| `r1-p2-ff.sh` | `d3dfe89318ae07ffc43aa0de6c8190c42e8d8a80815217932d1b1682ceb8ffc9` |
| `r1-p3-build.sh` | `14e1c25fa0ff7ce5daaafc57518e101829c689c4bd94ed75c6bb01d29f7cb0ae` |
| `r1-p3b-build-check.sh` | `5e51be60dbae2cc2e64a78315e5b312ad6038e9cbe5443751212ab93d9ac8e0c` |
| `r1-p4-gate-promote.sh` | `437a1d4eee5f778348117bef65eb71972d6a0c1691db563573ac75075ddfa9df` |
| `r1-p5-accept.sh` | `13a7a8a61d4b8c77b19c5ea5133f0fd7ef505ac1a263222494356ed86ede8523` |
| `r1-p6-observe.sh` | `1c0f27bf46ab1e7ab690ccdf4c3700fc60594b14540252a28817044de17d8b8a` |
| `r1-rawhead.sh` | `29cb4dfa4e85b1d48b3288675ef0eb2175e2b019fdebb7baff595153bc757576` |
| `r1-rollback.sh` | `d9e2e32a25d3adc3aa58a040c764ad2e7d19da64f0ff65d502e5494da70ba1b7` |
| `r1-s9-public-smoke.sh` | `ea85c56a6ed2fc7f9628adc6828d3d352f4507e8d11b4735c5c51e03c4c61bba` |
| `r1-browser.cjs` | `ed3ac6d1fc8427d2692fe5103dd5caa96a34008b7c5a385b616867c00a01af7c` |

Supervisor and unit pins (SHA-256 of the Git blob bytes, LF; `deploy/server-cluster.mjs` is `text eol=lf` in `.gitattributes`):

| Object | SHA-256 |
|---|---|
| `7d92042f:deploy/server-cluster.mjs` (SUP_OLD, rollback) | `d82f24c48e2bc310857826e8fecc2e5ad90381ec3267c0d1ddba5ae19a822865` |
| `17822b29:deploy/server-cluster.mjs` (SUP_NEW) | `4e8ea9b5be9cda02a6d1e7251a68ab95887be9a2bf055e67ed03703d1ff81a17` |
| `deploy/afldb.service.d/release-route.conf` (both revisions) | `14942fc53421ff60eddb738b338e7a3db38a22429839fb4eabd8978edea1f5ff` |
| `deploy/afldb.service` (both revisions) | `a3444840e0bd5f94ea05ea4b01508e0e8209d65ae452be665c1049c6b34e149a` |

## 1. Review and release record

* **Astra's final written verdict** (independent review of `6953898083f184e9624996dc97b74884e5262250`, isolated checkout, `review-evidence/review.md`, 23 Nov 17:34 AEDT): "**Application at that SHA — READY FOR ATTENDED APPLICATION RELEASE, technically.** The actual loader preserved the concurrent season, R6 acceptance checks passed, the candidate produced a standalone release build, and the matched suite added zero failures." The **push of 69538980 was HOLD** only for the ISSUE-368 race test harness. **Wednesday's reboot keeps its independent NO-GO.**
* The harness finding is addressed by `bd50bde8` and `635d4df2` (tests/python only), recorded in [the push-blocker record](../../../../issues/reviews/AFLDB-ASTRA-PUSH-BLOCKER-2026-11-23.md). 17822b29 adds records only. The owner approved and published the push.
* **No written independent verdict on 17822b29 itself is on file.** The release case does not depend on one, because the application tree is unchanged: `69538980..17822b29` touches records and `tests/python` only. The application tree of CAND minus records and `tests/python` equals 69538980's (`ls-tree` digest `a8c3623f…ab7c`). P2 re-proves both facts on the host before any change.
* **Earlier re-review** ([AFLDB-RE-REVIEW-2026-11-23](../../../../issues/reviews/AFLDB-RE-REVIEW-2026-11-23.md), of c154f36b):
  * **367:** matched 17-case regression, base 6/17 against candidate 17/17. Once a pending year was published, both workers' first revisit answered 200/MISS and the second answered HIT. In Astra's words, "no measured basis for a one-hour stale-404 allowance".
  * **376:** the authenticated `POST /admin/awards/revalidate` answered 200. On both workers the first request was MISS, with the medal moved from player 79 to player 80. Unseasoned corrections and other publication flows remain outside the observed case (LOW).
  * Also verified: 374, 375, 377 and 348.
* **What the release changes in what is served** (7d92042f..CAND: 206 paths, 38 of them outside records; no migration, dependency, Next config, unit or drop-in change):
  * `src/app/brownlow/[year]/page.tsx`, `src/app/sitemap.ts` and `src/db/queries/brownlow.ts` (367). The page, metadata, static params and sitemap read accepted votes only.
  * `src/app/api/internal/revalidate-season/route.ts`, `src/lib/admin/award-season-fanout.ts` and `src/lib/acquisition/season-revalidation.ts` (376). Player paths are added to the worker-wide fan-out. The season-only body is unchanged.
  * `deploy/server-cluster.mjs` (362), the trace route class. It is inert while `AFLDB_TRACE_REQUESTS` is unset; P1 records the count.
* **The checkout tools change with P2:**
  * `tools/maintenance/revalidate-season.ts` adds `--checkout-env`.
  * `backup.sh` and `scheduled-backup.sh` (352) now percent-decode the backup password and fail closed on state writes. P1 proves the decoding is a no-op for the live credential.
  * `tools/db/*` (374/375), `tools/aflw/*` (368) and the DraftGuru tools (348) also change. None runs during the release.

## 2. Window, cutoffs and timing (Tue 24 Nov, AEDT)

Budgets, with worst-case values:

| Step | Budget |
|---|---|
| G0 | 5 |
| P1 | 4 |
| raw-head baseline | 2 |
| P2 | 2 |
| P3 build | 25 worst; about 5 on Sunday |
| P3b | 2 |
| P4 | 2 |
| Owner restart and InvocationID | 1 |
| P5 and raw-head check | 6 |
| P6 full observation | 31, plus the owner's journal count 2 = 33 |
| Rollback complete | 15: links 1, restart 2, verify 4, raw-head 2, S9 1, margin 5 |

**Backwards from 12:30:**

| Latest time | Event | How it is derived |
|---|---|---|
| 12:15 | Rollback start | 12:30 − 15 |
| 12:15 | End of P6 and the journal count | Last P6 tick about 12:12, journal count 12:13–12:15 |
| 11:42 | P6 start | 12:15 − 33 |
| 11:36 | Acceptance start | 11:42 − 6 |
| **11:35** | **Restart cutoff**: the owner issues `sudo systemctl restart afldb` (r8: in the admin session) no later than this | 11:36 − 1 |
| **11:30** | **Promotion cutoff**: P4 refuses after it. Promotion is permitted up to and including 11:30:00.000 and refused from 1 ms later. P4 checks it at its start, requires `release.mjs host-gate --not-after` to state that the tool enforces it, and `release.mjs promote --not-after` checks it again after all validation, immediately before the links move. A refusal moves no link and writes no event | 11:35 − 2 (P4) − 3 (handover margin) |

**The asked-for 11:00–12:30 does not fit the worst case.** From 11:00, the steps before promotion take 5+4+2+2+25+2 = 40 minutes in the worst case. Promotion would come at 11:40, past the 11:30 cutoff: the release would defer with nothing served changed. It fits only with a build near Sunday's 5 minutes (promotion about 11:21), which leaves 9 minutes of slack for everything.

**Proposed: 10:30–12:30.** 10:30–11:12 is pre-stage, which changes nothing served: G0, P1, the baseline, P2, P3 and P3b. Promotion follows as soon as P3b passes and the owner is at the terminal, at the latest by 11:30.

| | Promote | Restart | P6 ends | Done or rollback by |
|---|---|---|---|---|
| Typical (5-minute build) | ≈10:52 | ≈10:55 | ≈11:34 | 11:36, with 54 min spare |
| Worst case | ≤11:14 | ≤11:17 | ≤11:56 | 12:13 |

If P3b has not passed by **11:30**, stop: production stays unchanged, and the built release directory stays unpromoted and harmless.

## 3. Where systemd loads `deploy/server-cluster.mjs`, and how promotion and rollback pick its bytes

1. **The base unit** is `deploy/afldb.service`, installed as the unit's FragmentPath:
   * `WorkingDirectory=/home/arm/projects/afldb`, which is the checkout;
   * `EnvironmentFile=/home/arm/projects/afldb/.env`;
   * `ExecStart=/home/arm/.nvm/versions/node/v22.23.2/bin/node deploy/server-cluster.mjs`.

   That ExecStart path is **relative**. On its own, this unit would run the checkout's supervisor and the checkout's `.next/standalone`.
2. **The production drop-in** is `/etc/systemd/system/afldb.service.d/release-route.conf` (`deploy/afldb.service.d/release-route.conf`, ISSUE-329). It overrides `WorkingDirectory=/home/arm/afldb-releases/current`.

   systemd resolves that symlink **once, when the service starts**. The relative `deploy/server-cluster.mjs` then names `<release>/deploy/server-cluster.mjs`. That file imports `../.next/standalone/server.js` relative to itself, and logs `[afldb] serving build <BUILD_ID> release <id> revision <rev>` from `../release.json`.

   Workers are forked by the primary and inherit its cwd. A crash re-fork therefore stays in the release the primary started in. The checkout's supervisor is never loaded while the drop-in is in place.
3. **Each release carries its revision's own supervisor bytes.**

   `release.mjs build --revision CAND` extracts CAND with `git archive` and copies **CAND's** `deploy/server-cluster.mjs` into the release (`deploy/release.mjs:1097`). `MANIFEST.sha256` pins the file, and `release.mjs verify` refuses drift.
   * **Promotion** renames `current` to `releases/17822b29e6de-<BUILD_ID>` (rename(2)). Nothing served changes until the owner's restart. The restart then starts the 17822b29 supervisor (`4e8ea9b5…`) inside that release.
   * **Rollback** renames `current` back to `releases/7d92042fd110-XWruOm_9nLCSMY8nGPqYU`. The next restart starts the retained 7d92042f supervisor (`d82f24c4…`).

   In both cases the checkout's copy is irrelevant. After P2 it is the 17822b29 blob in either outcome.
4. **The scripts prove the route instead of assuming it.**

   | Script | What it proves |
   |---|---|
   | P1 `service_route` | The loaded `DropInPaths` include `release-route.conf`; effective `WorkingDirectory` = `/home/arm/afldb-releases/current`; ExecStart argv = `<node> deploy/server-cluster.mjs`. It prints the FragmentPath and drop-in SHA-256 against the repository files. |
   | P1 `serving_identity` | The primary's `/proc/<pid>/cwd` is the real 7d92042f release directory. The supervisor file there has SUP_OLD. There are exactly two workers, in that release, with `AFLDB_WORKER_ID` 1 and 2 and `AFLDB_WORKER_COUNT` 2. |
   | P3b | The new release's supervisor equals SUP_NEW and is pinned in its MANIFEST. |
   | P5 and rollback verify | The same identity check, with SUP_NEW or SUP_OLD respectively. |

   **If the drop-in is missing, P1 STOPs.** In that state the service would run the checkout, and neither promotion nor rollback would select the intended bytes.
5. **Rehearsed** (REHEARSAL.md §3). The rehearsal used a systemd user unit of exactly this shape, running the real 7d92042f and 17822b29 supervisor blobs over a stub server, with promotion and rollback done by the real `release.mjs`:
   * promotion left the old supervisor serving until the restart;
   * a killed worker re-forked inside the old release;
   * the restart served the new bytes, and rollback plus restart served the old bytes again;
   * removing the drop-in made the service run the checkout, and P1's route and identity checks both refused that state.

## 4. Procedure

Claude runs each line from the staged `scripts/` directory (`cd "$ST/$R/scripts"`), with `S='C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb'`. Every script prints PASS/STOP lines and a `RESULT` line. Any STOP before P4 means: production unchanged, the release is deferred, and the owner decides.

| Time (latest) | Step | Command | PASS line |
|---|---|---|---|
| 10:30 | **G0** (r7 owner path, read-only, **Stu runs it on the workstation**: G0a scheduled dump on production, then G0b on the **qualified** off-host endpoint), then **r9 acceptance**. r9: no endpoint is qualified today, so G0 STOPs and the release stops before P2 | `bash "$V7/afldb-verify-call.sh" g0 2026-11-24 > "$AC/g0.txt" 2>&1; echo $? > "$AC/g0.exit"; cat "$AC/g0.txt"`, then `bash "$R9/accept/afldb-gate-accept.sh" --gate release-g0 --owner-checks "$AC/afldb-r9-4.4.txt" --reverify "$AC/afldb-r9-4.5.txt" --version "$AC/afldb-r9-4.6.txt" --verdict "$AC/g0.txt" --verdict-exit "$(cat "$AC/g0.exit")"` (`$V7`, `$R9`, `$AC`: §4.1a; the inputs: OWNER-PROCEDURE 4.4–4.6, saved immediately before the call: the verdict ≤ 3 h after them, the check ≤ 1 h after the verdict, same production boot) | **only** a final line beginning `GATE ACCEPT RELEASE-G0 GO transport=production`, exit 0. That GO contains the wrapper's `OWNER VERDICT G0 PASS transport=production … date=2026-11-24 invocation=<INV> dump=<D> sha256=<SHA> dispatch=<scheduled\|catch-up> … offhost=<host> … dispatch-at=… received-at=… complete-at=… received-sha256=<SHA> rehash-sha256=<SHA> qualification=pinned qual-sha256=<pin>` with exit 0; record `<D>`, `<SHA>`, `dispatch=`, `offhost=` and `qual-sha256=`. `qualification=none\|refused\|FIXTURE`, a "possession only" reason, a G0 PASS whose acceptance is NO-GO, and any Phase 3 output are **not** GO evidence |
| — | *superseded by r7, information only:* `tr -d '\r' < r1-g0-dump.sh \| $S bash -s -- 2026-11-24` (G0a as arm) and `r6-offhost-verify.sh` over arm's ssh to streamanator (G0b as arm) | as before | their `G0 PROD RESULT PASS` / `R6 OFFHOST RESULT PASS` lines are **not GO evidence** |
| 10:35 | **P1** serving release and route (read-only) | `tr -d '\r' < r1-p1-precheck.sh \| $S bash -s -- <PREP>` | `P1 RESULT PASS`; note `UNACCEPTED_YEARS` |
| 10:39 | **Baseline** raw head (writes `/home/arm/r1-rawhead-baseline.json` only) | `tr -d '\r' < r1-rawhead.sh \| $S bash -s -- baseline <UNACCEPTED_YEARS>` | `RAWHEAD RESULT baseline PASS` |
| 10:41 | **P2** fast-forward to CAND exactly (checkout only) | `tr -d '\r' < r1-p2-ff.sh \| $S bash -s -- <PREP>` | `P2 RESULT PASS` |
| 10:43 | **P3** build in tmux (builds and releases only) | `tr -d '\r' < r1-p3-build.sh \| $S bash -s` | `P3 build finished` + `LOG …` |
| — | **P3b** (read-only) | `tr -d '\r' < r1-p3b-build-check.sh \| MSYS_NO_PATHCONV=1 $S bash -s -- <LOG>` | `P3b RESULT BUILD PASS <NEW_ID>` + `BUILD_ID <NEW_BUILD>` |
| **≤11:30** | **P4** host gate + promote (owner present) | `tr -d '\r' < r1-p4-gate-promote.sh \| $S bash -s -- <NEW_ID>` | `P4 RESULT PROMOTED` |
| **≤11:35** | **Restart** (owner, §4.2) | | InvocationID reported |
| +1 | **P5** acceptance | `tr -d '\r' < r1-p5-accept.sh \| $S bash -s -- <NEW_ID> <INV>` | `P5 RESULT ACCEPT PASS (1-4)` |
| +3 | **Raw-head check** | `tr -d '\r' < r1-rawhead.sh \| $S bash -s -- check <UNACCEPTED_YEARS>` | `RAWHEAD RESULT check PASS`; `R6-NOTE …` recorded |
| +5 | **P6** observation, one connection, ≈31 min, in the background | `tr -d '\r' < r1-p6-observe.sh \| $S bash -s -- <NEW_ID> <INV>` | `P6 RESULT OBSERVATION PASS (4 ticks)` |
| during P6 | **S9** public smoke (workstation) | `bash r1-s9-public-smoke.sh <NEW_BUILD> XWruOm_9nLCSMY8nGPqYU` | `S9 RESULT PASS` |
| during P6 | **B** signed-in browser (owner, §4.3) | | `VERDICT PASS n/n`, screenshots |
| end of P6 | Owner journal check (§4.2) | | `JOURNAL PASS rc=0 entries=0` |

### 4.1 G0, the 03:10 backup gate (it must PASS before P2)

**r9 (28 Nov 2026): G0 passes only on `GATE ACCEPT RELEASE-G0 GO transport=production` (exit 0) from `$R9/accept/afldb-gate-accept.sh`.**
That GO requires all of: (a) the OWNER-PROCEDURE 4.4 owner checks, `OWNER CHECKS RESULT PASS` with B1, B2 and B3 PASS; (b) the 4.5
re-verification of both installs, with arm out of `sudo`; (c) a 4.6 version check made after them, with production and the
qualified off-host endpoint PASS; (d) the wrapper's `OWNER VERDICT G0 PASS transport=production` with exit 0, made after (c), naming
the same off-host endpoint and qualification, at most 3 h after each of (a) and (b) (the older counts), from the same production boot, and checked at most 1 h
later. *(r7 text, now the wrapper's half:)* G0 passes only on
`OWNER VERDICT G0 PASS transport=production` with wrapper exit 0. The wrapper accepts a
verifier answer only when it meets every condition below. Anything else is `OWNER VERDICT G0 STOP … step=G0a|G0b reason=…`:
* the answer has exactly one `AFLDB-VERIFY RESULT` line, and it is the last line;
* the RESULT line carries this call's nonce, the pinned bundle digest and the expected host (`afldb-prod` for G0a; for G0b, r9: the pinned qualified endpoint's `host=`, never `streamanator`, R9-F-12);
* its `at=` is within 300 s of the workstation's clock;
* its `exit=` equals the ssh exit status, and PASS ⇔ 0;
* every argument field equals the request.

What a PASS proves, as far as the r7 rehearsal on real systemd 255 shows ([r7 record](../backlog-20261121/r6-20261125/review-fixes-r7-20261128/README.md)):

1. **G0a, the scheduled dispatch** (production, `sealed_origin`):
   * exactly one root seal records a start job of `afldb-backup.service` that `afldb-backup.timer` created, with its dispatch
     (= the timer's `LastTriggerUSec`) inside the gate date's 02:20–02:31 window;
   * the unit did not stop or fail between the dispatch and the run, and no other run was sealed in the window;
   * the run exited 0 as `afldb-backup` under the pinned code, drop-in and effective unit, and PID 1's `Result=success`.

   A start by hand never counts. A `Persistent=` catch-up or an attended re-arm counts only when systemd genuinely dispatched it inside
   the window. It is printed as `DISPATCH catch-up <delay> s after timer activation` and carried as `dispatch=catch-up`, so the record must
   name it.
2. **G0a, the dump.** `/var/lib/afldb-backup/published/<D>` is root:afldb-backup-read 0440 with link count 1. Its full re-hash equals the
   seal's `dump_sha256` (root's hash of its own copy before publication) and the root sidecar. arm cannot write, rename, replace or
   signal anything in this chain (rehearsed: every attempt EACCES/EPERM).
3. **G0b, the off-host copy** (r9: only on the **qualified** endpoint named by the owner's pin `$R9/offhost/QUALIFIED-ENDPOINT`, per
   `QUALIFY-OFFHOST.md`; streamanator is refused, because its arm is in sudo, docker and lxd; the verifier port of
   `r6-offhost-verify.sh` and `scheduled-pull-evidence.sh`):
   * the endpoint's host key equals the pin's: it is checked against the owner's known_hosts before the call, and ssh accepts only
     that key;
   * root re-hashes the copy of `<D>` at check time to `<SHA>` from the authenticated G0a line (`rehash-sha256=`);
   * the 03:10 cron dispatch is taken from journald only with `_UID=0` (a `logger` line cannot match), in [03:10, 03:11)
     (`dispatch-at=`);
   * the invocation linked to that dispatch VERIFIED `<D>` with `<SHA>` (`received-at=`, `received-sha256=`) and ended with rc=0 within
     35 minutes (`complete-at=`).

   The only PASS is exit 0 (`SCHEDULED-COPY-VERIFIED`) with all five fields consistent. A matching copy without the dispatch or the
   completion is "possession only" and STOPs. With no pin, streamanator's answer is printed as information only and G0 STOPs
   (`qualification=none`). The pull log lineage, the sidecar and the `.verified-` marker remain data that the endpoint's pull account
   produces; the endpoint's independence rests on the owner's qualification record.

A PASS does **not** prove:
* that the database content is honest (arm holds the owner DSN);
* production's sshd configuration, its host key or the `-F none` production transport (the rehearsal used a ProxyCommand transport,
  printed as `transport=rehearsal`);
* the off-host rsync from production (a fixture in the rehearsal);
* that the off-host endpoint is independent beyond what its qualification record establishes (QUALIFY-OFFHOST §5).

*Pre-r7 text, kept for the record: it describes the superseded arm-run G0a/G0b.* G0 needs **positive** evidence of all three of the following:

1. **The scheduled dispatch.** On production, G0a requires `afldb-backup.service` to have started today in 02:20–02:31 with `Result=success` and `ExecMainStatus=0`. That is the timer's run, the same one-shot unit as R6 A-1. On streamanator, the reviewed verifier (`scheduled-pull-evidence.sh`, installed bytes `d7574254…` = the 17822b29 kit) links the 03:10 copy to the `afldb-offhost-pull.timer` dispatch.
2. **The wrapper invocation.** The verifier requires the wrapper invocation that this dispatch started to be recorded with its lineage, and to have completed successfully.
3. **A matching off-host dump.** G0a requires exactly one `afldb_prod-20261124-02[23]*.dump`, with a re-hash equal to its one-line sidecar, and exactly one `backup ok: <that name> … sha256 <first 16 hex>` in that service's journal. (`pick_overnight_dump` is byte-identical to the reviewed R6 copy, which the rehearsal checked.) G0b's verifier then requires the streamanator copy to hash to that same SHA-256.

Only **exit 0** (`SCHEDULED-COPY-VERIFIED`) passes. Every other result has the same action: **STOP before P2.** Production stays untouched, the release is deferred, the owner decides, and the result goes in the sitting record:

* **failed:** exit 1, `COPY-FAILED`;
* **unattributable:** exit 10, `COPY-VERIFIED-ORIGIN-UNPROVEN` (the result Monday 23 Nov returns: REHEARSAL.md §2);
* **missing:** no dump, no journal line, an ambiguous window, exit 2 or 127, or a G0a FAIL.

r9: every result other than `GATE ACCEPT RELEASE-G0 GO transport=production` (exit 0) has the same action, **STOP before P2**. That
covers every `OWNER VERDICT G0 STOP`: G0a `scheduled origin unproven: <reason>` (before installation `0 seals … in the window`), G0b
exit 10 or 1, no qualified off-host endpoint (today's state), "possession only", and a refused or unauthenticated answer. It also
covers a G0 PASS whose acceptance is NO-GO: owner checks BLOCKED or stale (more than 3 h before the verdict) or from another boot, a re-verification missing or saved before
Phase 4, a version check missing or made before them, or a verdict made before the version check. A Phase 3 install or VERSION PASS
is never GO evidence (OWNER-PROCEDURE 3.13).

A retry cannot supply the missing scheduled evidence. An attended copy would need its own approval and would not satisfy ISSUE-352. The release may be rescheduled after a day whose 03:10 evidence passes. The owner may also decide to release without this gate, but that is a separate explicit decision and is not covered by §10.

### 4.1a r7 installation preconditions (all met before the qualifying 02:20 backup; outside the release checkout)

The qualifying backup is the 02:20 run of the gate date. Complete these before it starts, in this order:
* outside 02:15–02:50;
* as root reached by a path that does **not** pass through arm's login (R7 independent review round 1, **F1**). r8 defines that path
  in [OWNER-PROCEDURE.md](../backlog-20261121/r6-20261125/review-fixes-r8-20261128/OWNER-PROCEDURE.md): the console logged in
  **as root** (Phase 0), or the admin root session of `afldb-admin` with its own key and password (Phase 1), checked read-only
  (Phase 2) before any install. A console login as arm does not qualify. `sudo` typed in an arm SSH session does not qualify: a
  hostile arm login environment (`~/.bashrc`, `~/.profile`, PATH, an alias or function named `sudo`) can capture or reuse that root,
  and then neither G1 (sealed backup) nor G2 (owner verifier) holds. No such path exists on production today; creating it is a
  host-account change that needs the owner's approval, and production `sudoers` has not been checked. Every later root action (the
  `sudo -u postgres` steps, every root step of this runbook and of the plan) must use the same path. Until then MED-2 and MED-3
  stay OPEN;
* from root-owned staging directories outside `/home` that hold a `git archive` of the R7 tested revision `7d69302007568d3141a567c8eba89e4ee473c9a6` (review round 1).
  ~~**r8:** the revision becomes `12e46305bf6b3ab063ffd7a2e8daf481eedfb8f3`, and the digests below become `e3a68821c6f97ec7a5775cbf845b4018198556f44d29e89ceb6ff0c4e2672e7d`,
  `49e0fa7c84a549ba5153cec9d94c2fa2ca91d89aff34458dd9dc2fa9a4f13901` and `58fceba650dcd25ede0e55b25bfcb8a8236c3a4fe6ae6ebd94535832bbd506c8`.~~
  **r9 (supersedes r8's pins):** the revision is `@@R9_REV@@`; backup `e3a68821c6f97ec7a5775cbf845b4018198556f44d29e89ceb6ff0c4e2672e7d` (unchanged), verify packet `@@VERIFY_SUMS@@`, bundle `@@BUNDLE_SHA@@`, owner checks `70d05b10b4b1898e978550e113c9fefa06dd873c585e7d3445bf73b0fb8b648f` (unchanged), phase4 `@@PHASE4_SUMS@@`, acceptance `@@ACCEPT_SUMS@@` (OWNER-PROCEDURE §0). The r8 wrapper has no off-host qualification rule: never use it.
  * The archive is made in the owner's **workstation** clone and hashed there, carried over the admin path, and re-verified in the
    admin root session against the workstation value.
  * Never copy bytes from arm's checkout, never run git as root in it, and never read an expected digest from a file on production.
  * Both installers refuse a root session that descends from arm (`REFUSED: root session descends from arm`).

None of them writes `/home/arm/projects/afldb`, so P1/P2's clean-tree checks are unchanged. Production's checkout keeps
`scheduled-backup.sh` `234fca6a…`: the verifier ports `status` itself, and the repository's opt-in `7e2b470a…` is not needed there.

1. **Production, sealed backup** ([R7 backup README](../backlog-20261121/r6-20261125/review-fixes-r7-20261128/backup/README.md) §5).
   * Preconditions: the base `afldb-backup.service` and `.timer` are root-owned copies, not links into the checkout; the r6 attest
     drop-in is not installed; `/usr/share/zoneinfo/Australia/Melbourne` is a root-owned regular file.
   * Check `backup/SHA256SUMS` = `d0023d10…`, then run `sha256sum -c`.
   * Run `install-backup.sh <staging>` as root.
   * Add the `pg_ident.conf` line `afldbbackup afldb-backup afldb_backup` and the `pg_hba.conf` line
     `local afldb_prod afldb_backup peer map=afldbbackup` before any broader `local` line, then run `SELECT pg_reload_conf()`.
   * Run `verify-backup-install.sh` as root, and as arm in a **new** login. Both must print `BACKUP INSTALL RESULT PASS`. **r8:**
     both runs are made from the admin root session: `verify-backup-install.sh`, then `verify-backup-install.sh --as-arm`. Root drops
     to arm via `setpriv … --reset-env`, `bash --noprofile --norc` and stdin `/dev/null`, so there is no arm login. The pg edits and
     the reload (`runuser -u postgres`) run in the same session.
2. **Production, verifier** ([R7 verify README](../backlog-20261121/r6-20261125/review-fixes-r7-20261128/verify/README.md) §8, §10).
   * Preconditions: step 1 is done, because the verifier joins `afldb-backup-read`. The host has `/usr/bin/python3.12`, group
     `systemd-journal` and `/usr/lib/postgresql/16/bin/psql`, and `sshd_config` starts with `Include /etc/ssh/sshd_config.d/*.conf`.
     Stu's workstation has a NEW key pair `~/.ssh/afldb_verify`, never arm's key.
   * Check `verify/SHA256SUMS` = `221b254a…`.
   * Run `install-verify.sh --role prod --key <staging>/afldb_verify.pub`.
   * As postgres, apply `verifier-db.sql`, add the two `pg-auth-lines.txt` lines above the first other `local` line, and reload.
   * Run `verify-verify-install.sh --role prod` as root.
   * r8: all of step 2 runs in the admin root session; "as postgres" is `runuser -u postgres` there, and `afldb_verify.pub` travels
     over the admin path and is fingerprint-checked against the workstation.
3. **The qualified off-host endpoint** (owner, root there through its own admin path; `$R9/offhost/QUALIFY-OFFHOST.md` §2–§4). r9:
   * streamanator is **not** the off-host endpoint. Its arm is in `docker`, `lxd` and `sudo`, all root-equivalent (OWNER-PROCEDURE
     §8), and the wrapper refuses to qualify it, so a G0B answer from it is printed as information only and G0 STOPs. Until the owner
     commits a pin for an independent endpoint, G0 STOPs. *(r8 text, withdrawn: the option to accept `G0B PASS` as attested by a
     host arm controls.)*
   * The pull-source change is an unprivileged edit of arm's own files, with no root step.
   * Run `install-verify.sh --role offhost --key …`, then `verify-verify-install.sh --role offhost`.
   * The off-host pull source becomes `<prod>:/var/lib/afldb-backup/published/` (`offhost-pull.sh` unchanged).
4. **Workstation.** `V7` is a fresh `git archive` export of
   `docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r7-20261128/verify` at `7d69302007568d3141a567c8eba89e4ee473c9a6`.
   * Run `sha256sum -c SHA256SUMS` in it. The wrapper's pinned bundle digest is ~~`df3457cc…`~~ (r7) ~~`58fceba650dcd25ede0e55b25bfcb8a8236c3a4fe6ae6ebd94535832bbd506c8` at
     `12e46305bf6b3ab063ffd7a2e8daf481eedfb8f3`~~ (r8, superseded); r9: `@@BUNDLE_SHA@@` at `@@R9_REV@@`, in the owner's own clone.
   * Run `bash "$V7/afldb-verify-call.sh" version`. It must print `OWNER VERDICT VERSION PASS` for `afldb-prod` (role prod) and for
     the qualified endpoint (`role=offhost … qualification=pinned qual-sha256=<pin>`). Without a pin the off-host line is
     `STOP … no qualified off-host endpoint`, with exit 1. r9: this call is an installation diagnostic; the gate evidence is
     OWNER-PROCEDURE 4.4–4.6 and `GATE ACCEPT` (§4.1).
   * r9: `V7` is the `git archive` export of `$R7/verify` **and** `$R9/offhost` (the wrapper reads the pin at
     `../../review-fixes-r9-20261128/offhost/QUALIFIED-ENDPOINT` relative to itself; without it G0 STOPs), at the r9 tested revision
     in the owner's own clone. `R9=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r9-20261128` in that clone, and
     `AC=~/afldb-r9-accept` holds the saved OWNER-PROCEDURE 4.4–4.6 outputs and gate calls.

Until all four are done and a sealed timer run exists for the gate date, G0 STOPs, by design. Rollback: R7 backup README §6.

### 4.2 Owner blocks (short lines, one per line)

Restart, after P4 and no later than 11:35. It also applies after a rollback's `links`. r8: type this block and the journal lines
below in the admin session (OWNER-PROCEDURE), never in an arm session:

```
sudo systemctl restart afldb
systemctl show afldb -p InvocationID
sudo journalctl -u afldb -n 20 --no-pager | grep 'serving build'
```

Report the InvocationID, and the line `[afldb] serving build <NEW_BUILD> release <NEW_ID> revision 17822b29e6de2b6248cd7ada4221800fd81e0003` (after a rollback: `… XWruOm_9nLCSMY8nGPqYU release 7d92042fd110-XWruOm_9nLCSMY8nGPqYU revision 7d92042f…`). The owner attests that this InvocationID is their restart. P5 and the rollback verify bind to it.

At the end of P6 (arm cannot read the system journal), run the two lines P6 prints, in this order:

```
J=$(sudo journalctl -u afldb -p err --since "<since>" -q -o json --no-pager); R=$?
[ "$R" = 0 ] && [ -z "$J" ] && echo "JOURNAL PASS rc=0 entries=0" || echo "JOURNAL FAIL rc=$R entries=$(grep -c "^{" <<< "$J")"
```

The only passing answer is `JOURNAL PASS rc=0 entries=0`: sudo and journalctl exited 0 and returned no `afldb` entry at priority err or worse since `<since>` (the service's `ActiveEnterTimestamp`, which P6 fills in). `JOURNAL FAIL` gives the exit code and the number of entries (`-o json` prints one line per entry). A non-zero `rc` means the query itself failed (sudo refused, bad `--since`, journal unreadable) and proves nothing about the service. No verdict line is not a pass.

### 4.3 Signed-in browser check (owner, workstation Git Bash, during P6)

```
cd "$ST/$R/scripts"
"/c/Program Files/nodejs/node.exe" r1-browser.cjs <UNACCEPTED_YEARS>
```

A Chromium window opens on `/beta`; the owner signs in there. The runner then checks desktop 1280x800 and mobile 390x844:

* `/brownlow/2026` and `/seasons/2026` answer 200, are not bounced, and have the exact title, robots `noindex, nofollow` and no overflow or rendered error;
* `/brownlow/2026` shows `Won by Nick Daicos with 47 votes` and 14 `Recorded ineligible` badges;
* `/brownlow/2099` and each unaccepted year answer 404 with `Page not found | AFLDB`;
* there are no page or console errors;
* the anonymous 307 to `/beta?from=…` is preserved for both pages.

Screenshots and `result.json` go to `D:/dev/afldb/.local-r1-browser-20261124`, which is untracked. The session is then discarded.

Requirements: Playwright 1.62.1 from the primary checkout, and the workstation's Node v26.13.1. A tool failure prints `STOP` and exits 2. **Record `VISUAL: UNVERIFIED` with the reason; never pass it in prose.** Browser findings are a rollback trigger only when the raw-head or P5 checks agree; otherwise they go to the owner.

## 5. Acceptance for the actual release changes

| Requirement | Where | Expected |
|---|---|---|
| Release identity | P5 check 1 `status --expect NEW_ID --confirm-restart-invocation INV`; P5 check 2 `post-install-check.sh --confirm-restart-invocation INV NEW_ID XWruOm_9nLCSMY8nGPqYU`; the owner's journal line | PASS; the old build's `_buildManifest.js` 404 at the origin |
| InvocationID | P1 (Sunday's `342040…` before the change); P4 prints the unchanged ID; P5 (running = attested) | new ID ≠ Sunday's, NRestarts 0 |
| Worker ordinals 1 and 2 | P5 check 3 (`serving_identity`: primary in `releases/NEW_ID`, SUP_NEW, two workers, `AFLDB_WORKER_ID` {1,2}, count 2, names 1/1) | PASS |
| Functional 2/2 revalidation | P5 check 4: `revalidate-season.ts --season 2026`, exit 0, exactly one `REVALIDATED season 2026: 2/2 worker(s) reached (1,2)` | PASS (a FAIL here is not a rollback trigger by itself) |
| Public smoke | S9: health, `/` 307 `/beta`, `/players` and `/brownlow/2026` 307 with `from=`, admin 307 login, new build manifest 200, old build manifest 404, `/beta` 200 + `X-Robots-Tag: noindex, nofollow`, no "Beta gate is on but" | `S9 RESULT PASS` |
| Eight fresh connections each to `/brownlow/2026` and `/seasons/2026` | raw-head check (`agent:false`) | every sample 200; exactly one document `<title>`: `2026 Brownlow Medal — Winner, Votes & Leaderboard \| AFLDB` and `2026 AFL Season — Ladder, Results & Finals \| AFLDB`; robots `noindex, nofollow`; equal to the 7d92042f baseline; winner sentence and 14 badges on every Brownlow sample |
| Genuine 404 control | raw-head `/brownlow/2099` (4 samples: 404, `Page not found \| AFLDB`, no "Won by") and `/brownlow/02026` 404; browser `/brownlow/2099` | PASS |
| ISSUE-367 live control | each `UNACCEPTED_YEARS` season from P1 (votes stored, not accepted): baseline records the old answer; check requires 404 + not-found title + no winner | PASS, or `none` (§5.1) |
| Sitemap | raw-head: `/sitemap.xml` and `/sitemap/1.xml` 404 on both builds (withheld while the beta gate is on); `/robots.txt` 200 and byte-equal to the baseline; S9 records the anonymous codes | PASS |
| Signed-in observation | §4.3 | `VERDICT PASS`, or `VISUAL: UNVERIFIED` recorded |
| Stability | P6: 4 ticks, active, NRestarts 0, same InvocationID, cwd = release, health ok, both titles; owner journal check `JOURNAL PASS rc=0 entries=0` (§4.2) | PASS |

### 5.1 Cases with no live example use the existing test evidence

| Case | Evidence used |
|---|---|
| The accepted-only sitemap **content** | While the beta gate is on, `indexingEnabled()` is false and the sitemap is withheld, so it cannot be observed live. `tests/integration/brownlow-pending-projection.test.ts`: 17/17 on the fix, 6/17 on the unfixed code. Astra's matched 17-case copy (SHA-256 `82efebfb…`) failed 6/17 on base and passed 17/17 on the candidate. |
| Unaccepted years (pending, partial, unpublished, not-applicable, withdrawn) | Used when P1 prints `UNACCEPTED_YEARS none`: the same suite. |
| First-revisit freshness after publication | Astra's two-worker observation (200/MISS on each worker immediately after publication). **No production Brownlow publication is in this release.** |
| Award-correction fan-out to player profiles (376) | Astra's authenticated `POST /admin/awards/revalidate` observation. **No production award change is in this release.** The live P5 check exercises only the season-only body, which is unchanged. |
| 362 trace route class | Inert on production (`AFLDB_TRACE_REQUESTS` count recorded by P1). The real supervisor regression is on record. |

**Production award or Brownlow data changes are outside this release.** P1's read-only snapshot shows 2026 at published revision 3, with 183 rows, 1,242 votes and 14 ineligible, and the release leaves it so.

## 6. Rollback

Rollback triggers (decided with the owner):

* the unit is not active after the restart;
* P5 check 1, 2 or 3 fails;
* raw-head check failures on the 2026 pages or the genuine 404 controls;
* any S9 5xx/503 or the beta-gate 503 text;
* a P6 tick not OK;
* journal error lines that the owner judges release-caused.

**Not triggers by themselves:**

* a P5 check 4 failure (record it and take it to the owner; never "fix" it by restarting again);
* an ISSUE-367 live-control failure, because the old build serves those years too;
* a browser finding without raw-head or P5 corroboration.

Procedure (no data, checkout or `.env` change; about 15 min; start no later than 12:15):

1. `tr -d '\r' < r1-rollback.sh | $S bash -s -- links` gives `ROLLBACK RESULT LINKS SWITCHED`. It refuses unless `current` is a 17822b29e6de-* release. It runs `release.mjs rollback --attended --to 7d92042fd110-XWruOm_9nLCSMY8nGPqYU --ledger-head 118_fixtures_unconfirmed_participants.sql`, after which `current` is the 7d92042f release and `previous` is the 17822b29 one.
2. The owner runs the restart block of §4.2 (r8: in the admin session, never in an arm session) and reports the InvocationID and the `serving build XWruOm_9nLCSMY8nGPqYU release 7d92042fd110-…` line.
3. `tr -d '\r' < r1-rollback.sh | $S bash -s -- verify <INV> <NEW_BUILD>` gives `ROLLBACK RESULT VERIFIED (1-3)`:
   * status --expect the old id;
   * post-install-check, where the 17822b29 build must answer 404;
   * identity: the 7d92042f release, SUP_OLD, workers 1 and 2;
   * the season refresh 2/2 is recorded.
4. `tr -d '\r' < r1-rawhead.sh | $S bash -s -- check none` gives PASS against the same baseline. The 367 controls are left out.
5. `bash r1-s9-public-smoke.sh XWruOm_9nLCSMY8nGPqYU <NEW_BUILD>` gives PASS.
6. Optionally, P6 against `7d92042fd110-XWruOm_9nLCSMY8nGPqYU <INV>` if the window allows.

The checkout stays at 17822b29. This is harmless: the service runs the release tree, and P2 proved no migration, dependency or unit change. If the rollback verify fails, the site state is as printed and the owner decides. Do not attempt anything not listed here.

## 7. Recording

Record the following in `docs/v2/evidence/release-17822b29-20261124/SITTING-20261124.md`, as excerpts only:

* every RESULT line;
* G0's dump, SHA and verifier exit; r7: the whole `OWNER VERDICT G0 …` line, including `dispatch=`;
* the P1 identity block and `UNACCEPTED_YEARS`;
* the P2 path list;
* NEW_ID and NEW_BUILD;
* the InvocationIDs;
* the raw-head JSON summaries and `R6-NOTE`;
* S9, the browser verdict and the screenshot list;
* the P6 ticks and the journal count;
* any deviation, with its reason.

Never record a secret, a `.env` value or a cookie.

## 8. Wednesday R6 dependency

[ATTENDED-PLAN-R6-20261125.md](../backlog-20261121/ATTENDED-PLAN-R6-20261125.md) pins:

* archive `b48a2c5e` with 14 files, all byte-identical at 17822b29;
* `r6-pre-verify.sh:81`: CURRENT_ID for outcome `accepted` must match `^7d92042fd110-…`;
* `r6-post-verify.sh:81`: CURRENT_ID must match `7d92042fd110-…` or `c8d4202a…`.

R6 has **no BUILD_ID pin**. It checks the service state only generically: two workers, InvocationID new after the reboot, and `check_revalidation_processes` against `releases/$CUR`. Its raw-head check reuses Sunday's `a1-rawhead.sh` and `/home/arm/a1-rawhead-baseline.json`, which compare titles and robots only. Tuesday's raw-head check prints `R6-NOTE` when those differ. The rehearsal showed `none`, and the expected titles are unchanged.

| Tuesday outcome | Wednesday CURRENT_ID / outcome arg | Wednesday archive |
|---|---|---|
| **Released and accepted** | `17822b29e6de-<NEW_BUILD>` / `accepted`; previous `7d92042fd110-XWruOm…`; env 1/1; InvocationID = Tuesday's restart; SUP_NEW | **Needs the R6 amendment** (amendment section of the R6 plan: archive at SCRIPT_REV; two changed pins). It must be **independently reviewed before the reboot**. Without that review, R6 is NO-GO. |
| **Rolled back, verify PASS** | `7d92042fd110-XWruOm_9nLCSMY8nGPqYU` / `accepted`; previous `17822b29e6de-…` (info only); InvocationID = the rollback restart; SUP_OLD | Original `b48a2c5e` archive valid; amended archive also valid |
| **Deferred** (G0 or any STOP before P4) | Unchanged: `7d92042fd110-XWruOm…` / `accepted`; Sunday's InvocationID; checkout at 7d92042f (before P2) or 17822b29 (after P2); an unpromoted `17822b29e6de-*` directory may exist (harmless) | Original archive valid |
| Promoted but not restarted, rollback verify failed, or any unrecorded state | — | **NO-GO**; owner |

Every outcome after P2 means Wednesday's 02:21 backup and 03:36 verification are the **first production runs of the 17822b29 `backup.sh` and `scheduled-backup.sh`**. R6 runs those units from the checkout. P1 proved the credential decoding is a no-op, and the log formats R6 parses are unchanged.

**R6's own gates are preserved unchanged:**

* Wednesday's scheduled backup;
* the attributable 03:10 off-host pull (exit 0);
* the 03:36 verification restore matched to its service journal, state and database comment;
* the attended GRUB/recovery checks.

A failure of the new backup code fails those gates, and the reboot is NO-GO. Tuesday's G0 is not a substitute for any of them.

## 9. Rehearsal summary

See [rehearsal/REHEARSAL.md](rehearsal/REHEARSAL.md), which covers the clean export, sha256 checks, the printed transport lines reaching the host guard (exit 2, nothing written), Monday's verifier exit 10, and the full harness at 87/0. Production was not contacted at any point.

## 10. Owner approval statement (exact text required before any production step)

> I approve the attended application release of AFLDB candidate 17822b29e6de2b6248cd7ada4221800fd81e0003 to production on Tuesday 24 November 2026 between 10:30 and 12:30 AEDT, following docs/v2/evidence/release-17822b29-20261124/RUNBOOK.md at prep commit <PREP_SHA> with scripts at 58e35ce8805e9f559d3dd1008606f90efb84fbab (SHA256SUMS b4e9e584ea47bfc3080cb7f336d50a417b4595a8b06beda93522eb6a0702d87c), with origin/main pinned at <PREP> (which must descend from 17822b29). This authorises Claude to run, as arm over one SSH connection per step: G0 (read-only, production and streamanator), P1, the raw-head baseline, the fast-forward of /home/arm/projects/afldb from 7d92042f to 17822b29 exactly, the build, the post-build check, the host gate and promotion of the resulting 17822b29e6de-* release no later than 11:30, then after my own restart (no later than 11:35) the acceptance checks, the raw-head check, the 31-minute observation and the public smoke; and, on a rollback trigger, rollback to 7d92042fd110-XWruOm_9nLCSMY8nGPqYU, my second restart and its verification. I will run the restarts, the journal counts and the signed-in browser check myself. If G0 does not return exit 0, nothing after P1 runs and the release is deferred. This does not authorise any .env, schema, database, award or Brownlow data change, any other restart, publishing the prep commit, or Wednesday's reboot.

`<PREP_SHA>` is the local records commit that carries this runbook (reported with the packet; it need not be published). `<PREP>` is the `origin/main` tip the owner confirms at the start: 17822b29 unless it has advanced, and in every case a descendant of 17822b29. The build target stays 17822b29.
