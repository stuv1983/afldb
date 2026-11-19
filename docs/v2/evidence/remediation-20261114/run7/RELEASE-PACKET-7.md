# Release packet 7: D-365-W wording and AFLDB-ISSUE-366 tooling (attended production release)

Prepared 2026-11-19 (Thursday) by Claude. **Preparation only:** nothing in this packet contacted production, promoted, restarted or ran
a production P10. Approval to execute is the single statement in §11. Records: DEV qualification in `DEV-QUALIFICATION.md`; blocks in
`sitting/` (manifest `SHA256SUMS`, repository-root-relative paths).

## 0. The decision

Release **`0a308e2a046b85b376f362ec18098a3eb9a31086`** to production in one attended window. This is an application release only:
- player pages show "Results not loaded" for a `pending` Brownlow season (D-365-W);
- the serving checkout gains the ISSUE-366 release-check option and successor tooling.

No migration, dependency, configuration or data change is involved, and **no B1a step**. Rollback is to the release production serves today (§8).

## 1. Pins

| Item | Value | Status |
|---|---|---|
| Candidate `CAND` | `0a308e2a046b85b376f362ec18098a3eb9a31086` (= `origin/main` at preparation; local HEAD equal) | verified 2026-11-19 |
| Release id prefix | `0a308e2a046b-` (release.mjs: 12 hex + build suffix) | |
| Serving release (expected) | `a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5`, revision `a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5` | last record 2026-11-18 (`run6r/sitting-a1-exec-20261118/README.md` §2); **re-read at P1** |
| `previous` (expected) | `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` | same record; re-read at P1 |
| Serving checkout (expected) | `/home/arm/projects/afldb`, branch `main`, HEAD `a2e6ea99`, porcelain empty | A1 P2 fast-forwarded it to `a2e6ea99`; re-read at P1 |
| **Rollback target after S5** | **`a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5`** (becomes `previous` at promote) | subject to P1 |
| `PREP` | the records-only commit that publishes this packet (sole parent `CAND`; every `CAND..PREP` path under `docs/` or the three trackers). Its full SHA is named in §11 at approval. **PREP pins the reviewed procedure** (this packet, `SHA256SUMS`, the blocks); it is **never built or served**: P2 fast-forwards the serving checkout to `CAND` exactly, and P3 builds `--revision CAND` | P1 and P2 refuse any other remote state |
| Reviewed delta `a2e6ea99..CAND` | 114 paths; `git diff --raw --no-abbrev --no-renames` sha256 `d106757c44e75206c24b88ae1f949b495e1edf03a8afd118f914c91ac74183b5` | checked by P2 (rehearsed on Linux Git, §3) |
| Node / workers | v22.23.2; `AFLDB_WORKERS` read at P1 | |

## 2. Delta review (`a2e6ea99..0a308e2a`, 9 commits, 114 paths)

| Class | Paths | Effect at release |
|---|---|---|
| **Application** | `src/lib/format.ts` (only) | `formatBrownlow` / `brownlowStatusNote`, `pending` only: "Not yet awarded" → "Results not loaded"; tooltip → "Brownlow Medal results for this season have not been loaded yet." Sole caller: the BV cell of the player season-by-season table (`src/app/players/[slug]/page.tsx:612-613`). "No medal", `0`, "Not recorded" and `—` unchanged. |
| **Installed release tooling** (runs from the serving checkout after S2) | `deploy/release.mjs`, `deploy/post-install-check.sh` | `release.mjs`: only `status` changes. It adds `--confirm-restart-invocation <InvocationID>`, an owner restart attestation bound to one systemd invocation, and `status-pass` records it for audit. `build`, `host-gate`, `promote`, `rollback` and `verify` are unchanged. `post-install-check.sh` forwards the same option to its nested `status --expect`. The old call forms are unchanged. |
| **Operational scripts shipped, not invoked** | `tools/v2/b1a-successor/{capture,repair,recover,reverse}.mts`, `db.ts`, `lib.ts`, `sitting/{p3c-baseline,p5-dryrun,p6-commit,r1-state}.sh` | Land in the checkout with the fast-forward; **none is run in this release**. The successor B1a procedure needs its own owner approval (`tools/v2/b1a-successor/README.md`). **The completed B1a repair is not replayed:** no block in this packet writes to the database; P1 only reads the 2026 statuses. |
| **Successor blocks invoked as release checks** | `sitting/p9-s7s8-checks.sh` (S7/S8), `sitting/p10-pages.sh` (S9b, `after` only), `sitting/r2-rollback.sh` (rollback only) | Sent from the workstation (blob-equal to `CAND`, §10). Read-only except R2 `links`. |
| Tests | `tests/format.test.ts`, `tests/b1a-successor-lib.test.ts`, `tests/deploy-release.test.ts`, `tests/integration/b1a-successor.test.ts`, `tests/integration/leaked-fixtures.ts`, `tests/e2e/journeys.spec.ts` | not shipped behaviour |
| Documentation and records | `docs/deployment.md`, `issues/closed/AFLDB-ISSUE-366.md`, the three trackers, 86 added files under `docs/v2/evidence/` (packet 6/6R records) | none |
| **Absent** (checked) | `src/db/migrations/`, `package.json`, `package-lock.json`, `next.config.ts`, `.env.example`, `deploy/afldb.service`, `deploy/server-cluster.mjs`, `deploy/Caddyfile.production`, `tools/build/` | no migration (head stays 118), no dependency, configuration, unit, supervisor or proxy change |

**ISR consequence.** `release.mjs build` extracts `CAND` from Git into a fresh workspace, runs `npm ci` and `next build` against the
production `.env`, then installs the bundle as a new release with its own (empty) ISR cache directory (`release.mjs:1073-1083`, `:1627-1628`). The
previous release's regenerated entries are **not** carried over. The prerendered player pages (the 500 most viewed) are rendered at
build time from production data that are already `pending` (B1a, 18 Nov). They therefore already carry the new wording. Every other player page renders
on its first request under the new code. The restart clears each worker's memory. **No 3600 s wait is expected**, unlike packet 6 §7,
where the data changed under an existing cache.

## 3. Qualification: what already covers the candidate, and what was run now

| Evidence | Revision | Covers | Source |
|---|---|---|---|
| ISSUE-366 qualification | `9fc1a526` + the 21 ISSUE-366 files (= `b9c045fe` code) | successor tooling and release-check option: unit 88/88 (`b1a-successor-lib` 29, `deploy-release` 59), integration 14/14 on real PostgreSQL, `tsc --strict` on `.mts`, typecheck, eslint | `issues.md` ISSUE-366 Resolution |
| D-365-W focused checks (review run) | working tree = `b51f963c` code | `tests/format.test.ts` + `tests/b1a-successor-lib.test.ts` 86/86, `bash -n` | `issues.md` ISSUE-365 D-365-W |
| D-365-W rendered cell (earlier, before the review) | working tree = `b51f963c` code, `next dev` | 2026 `pending` cell "Results not loaded" with the exact title, 0 / "Not recorded" / "No medal" distinct | same; **not repeated as such**, superseded by §3 row below |
| **Fresh DEV qualification (this packet)** | **exact tree of `0a308e2a`** (10,110 blobs verified against Git) | `npm ci` rc 0; **typecheck rc 0** (P3's off-host evidence); lint gate at baseline 338/43; focused release suites **145/145**; integration `b1a-successor` **14/14**; **production `npm run build` rc 0**; standalone production server, beta gate on: 2026 `pending` cell "Results not loaded" with the exact title (desktop and mobile DOM); **16 DEV samples of one synthetic player** (`pat-pending-990366`), each judged by the successor P10 per-sample rule, 0 bad; separately on DEV, anonymous 307, `/seasons/2026` 200, `/brownlow/2026` 404. These DEV samples are **not** the production P10 run (64 samples over four production players plus three controls, §7.2), which has not happened. P2 Git rehearsal (6 cases) and stub rehearsals of P1/P3b/P4/P8/S9 | `DEV-QUALIFICATION.md` §2, §4 |
| Full unit suite (same run) | exact tree | **rc 1.** Of 217 files: 207 passed, 1 skipped, 9 failed (86 tests). The retained record does not name the skipped file; the raw log stays in the DEV workspace `evidence/`. The 9 failures come from the host environment: the system Python lacks `psycopg` (79 tests), and gitignored source data is absent from a Git archive (7 tests). None of these files is in the delta | `DEV-QUALIFICATION.md` §2.4 |
| Re-run of the 9 failing files with the DEV venv Python | exact tree **and** `a2e6ea99` | 7 of the 9 files pass. 2 files (7 tests) fail on absent gitignored data, **with identical failing-test lists at both revisions**. This is not a full-suite pass | `DEV-QUALIFICATION.md` §2.5 |
| Focused passing checks | exact tree | release suites `format` + `b1a-successor-lib` + `deploy-release` **145/145**; integration `b1a-successor` **14/14** (real PostgreSQL); `bash -n` rc 0 | `DEV-QUALIFICATION.md` §2.6–2.8 |

**Not covered anywhere (limitations):**
- The Playwright e2e journeys need a full-data database. A read-only DEV database probe was not authorised.
- `tests/integration/brownlow-pending-coverage.test.ts` needs seeded club identities and did not run on the schema-only database. Its subject is not in the delta (run 4 qualified it on both full-data bases).
- The mobile BV cell is DOM-verified but off-screen in the captured image: the season table scrolls horizontally, as before D-365-W.
- `release.mjs build`, `host-gate` and `promote` were not run end to end off production. They are unchanged since `a2e6ea99`, which they released on 18 Nov.
- P1, P3b, P4, P8 and S9 were rehearsed against stub programs only, and P3 with `bash -n` only. They need the production host or the public site. The rehearsal fixed two block defects before the manifest was written (`DEV-QUALIFICATION.md` §4).
- The production P10 sample selection reads production player ids.

## 4. Read-only checks that establish the serving state at the window (P0, P1)

P0 (workstation, before any SSH):
1. `git ls-remote origin refs/heads/main` returns exactly `PREP`.
2. The local checkout is at `PREP` with no diff in the files below.
3. `sha256sum -c docs/v2/evidence/remediation-20261114/run7/SHA256SUMS`, run from the repository root.
4. `SHA256SUMS` itself hashes to the value approved in §11.

P1 (`r7-p1-precheck.sh PREP`, production, read-only) checks:
- `current` and `previous` as §1, and the checkout as §1;
- `origin/main` = `PREP`;
- no release lock;
- `release.mjs status` and `verify a2e6ea9995a4-…`;
- settle unit inactive, with its next run printed; apt services and processes idle;
- no settle, import, rebuild, dump or B1a process;
- MemAvailable at least 2,100 MB, at least 6 GB free, port 3199 free;
- beta gate on with epoch 1, `AFLDB_WORKERS` and `PORT` printed;
- node v22.23.2;
- the systemd state;
- one read-only `REPEATABLE READ` transaction through the backup role: all 2026 `player_season_stats` rows `pending` with NULL votes, the row count printed (669 at B1a), and the 2026 season status.

**Any difference is a STOP before S2** with nothing changed. A changed 2026 status means the acceptance in §7 no longer fits, and the owner decides.

## 5. Sequence (AEDT targets for a 10:00 start; who; pass / stop)

Transport is as in A1 (`run6r/sitting-a1/SITTING.md` §3):
- Production: `C:/Windows/System32/OpenSSH/ssh.exe afldb`.
- Each block: `tr -d '\r' < <block> | ssh afldb bash -s -- <args>`.
- **One connection per step, no automatic retries, no rapid reconnects** (the host's own IPS has blocked rapid SSH before).

`STAMP` = UTC at P0.

| # | ~AEDT | Step | Who | Pass / stop |
|---|---|---|---|---|
| P0 | 10:00 | workstation pins (§4) | Claude | any mismatch: STOP |
| P1 | 10:02 | `r7-p1-precheck.sh PREP` (S1, read-only) | Claude | `P1 RESULT PASS`; else STOP, nothing changed |
| P2 | 10:08 | `r7-p2-ff.sh PREP` (S2: ff to `CAND` exactly) | Claude | `P2 RESULT PASS`. `STOP unexpected remote drift` or a path outside docs/trackers: STOP (owner decides). The checkout at `CAND` does not change what is served; P2 may be re-run once (accepts a start HEAD of `CAND`). |
| P3 | 10:10 | `r7-p3-build.sh`, then `r7-p3b-build-check.sh <LOG>` (S3) | Claude | `P3b RESULT BUILD PASS <NEW_ID>` and its `BUILD_ID`. A failure leaves production on `a2e6ea99`; retry at most once in the window, only if the cause is understood and needs no code or data change |
| — | 10:25 | **OWNER present, ready to restart; browser readiness (§6.1)** | **Owner** | |
| P4 | 10:27 | `r7-p4-gate-promote.sh NEW_ID` (S4 host-gate, S5 promote `--attended`) | Claude | `P4 RESULT PROMOTED`. Gate refusal: wait and re-run P4, never `--skip-host-gate`. Promote REFUSED: links unchanged, end as an S3 failure |
| S6 | 10:28 | **OWNER: `sudo systemctl restart afldb`** | **Owner** | unit active (§6.3 only on `start-limit-hit`) |
| P9 | 10:30 | successor `p9-s7s8-checks.sh NEW_ID` (S7, S8) | Claude | `P9 RESULT S7+S8 PASS`. On the apt-coincidence signature, the owner attests that restart by its InvocationID and P9 is re-run as `p9-s7s8-checks.sh NEW_ID <InvocationID>`; that attestation covers S7 and S8 alike. `UNVERIFIED journal` → owner journal lines (§6.4). Any other FAIL → rollback (§8) |
| S9 | 10:35 | workstation `bash r7-s9-public-smoke.sh <BUILD_ID>` | Claude | `S9 RESULT PASS`; 5xx or the 503 gate message → rollback |
| P10 | 10:37 | successor `p10-pages.sh after` (S9b, §7) | Claude | `P10 RESULT after PASS (64 samples, 3 controls)`; otherwise §7.3 |
| — | 10:40 | **OWNER: signed-in browser observation (§6.2)**, recorded separately | **Owner** | |
| P8 | 10:42 | `r7-p8-observe.sh NEW_ID <first P10 player>` in the background (31 min) | Claude | `P8 RESULT OBSERVATION PASS (4 ticks)`; crash restarts or errors → rollback |
| — | 11:15 | records: sitting record, trackers, CHANGELOG; records-only commit, fast-forward publication after reviewing the delta | Claude | |
| — | –12:00 | reserve for recovery | | |

## 6. Owner-only actions (exact)

1. **Before P4 (browser readiness).** In your own admitted browser, open `https://beta.afldb.com/players/scott-pendlebury-11724`
   and confirm it renders, not the `/beta` sign-in page. If your browser relies on an admin session, sign in at the start of the window.
   Before promotion the 2026 BV cell still reads "Not yet awarded".
2. **After P10.** Reload that page and hover the 2026 BV cell. Report:
   - the text, which should be "Results not loaded";
   - the tooltip, which should be "Brownlow Medal results for this season have not been loaded yet.";
   - whether the row shows "In progress" (it should not: 2026 is complete).

   Claude records this as the owner's observation, separate from the automated P10 verdict, and never as a P10 pass. On a
   phone, scroll the season table sideways: the BV column is the last one and starts off-screen.
3. **S6, right after P4 prints `PROMOTED`:** `sudo systemctl restart afldb`. Then tell Claude, and give the new InvocationID
   (`systemctl show afldb -p InvocationID`) if you want it attested.
4. Only if the unit is not active and `Result=start-limit-hit`: `sudo systemctl reset-failed afldb && sudo systemctl start afldb`.
5. Only if P9 prints `UNVERIFIED journal` (it prints the exact `--since` value). Both checks must hold:
   - `sudo journalctl -u afldb --since "<ActiveEnterTimestamp>" -o cat | grep -E '\[afldb\] (primary|serving build)'` must name the new BUILD_ID and release;
   - `sudo journalctl -u afldb --since "<ActiveEnterTimestamp>" -o cat | grep -ciE 'error|fatal|unhandled'` must print 0.
6. **Rollback only:** `sudo systemctl restart afldb` after R2 `links` prints `LINKS ROLLED BACK`.

## 7. D-365-W acceptance

1. **What must be true.** The 2026 row's BV cell on a 2026 player page (no pre-1924 or 1942–45 season, where "No medal" is
   legitimate) reads **"Results not loaded"** with the exact title **"Brownlow Medal results for this season have not been loaded
   yet."**. The page carries neither "No medal" nor the interim "Not yet awarded" / "…still in progress; the Brownlow Medal has not been
   awarded" text. The 2026 row has no "In progress" badge.
2. **Automated (P10 `after`, only once `CAND` is serving, i.e. after P9 PASS).** The successor block chooses four eligible players
   read-only (Pendlebury first, two more, one 2026 debutant). It warms each with 12 requests, then takes 16 samples per player
   (64 in all), counting both labels and both tooltips of each state. A sample is bad unless it is 200, has the D-365-W label and
   tooltip, and has neither "No medal" nor the interim wording. The three controls are part of the verdict:
   - an anonymous `/players/<A>` is 307 to `/beta?from=%2Fplayers%2F<A>`;
   - `/seasons/2026` is 200 with the no-votes text;
   - `/brownlow/2026` is 404.

   The `P10 VERDICT` JSON line is retained. `manual-browser NOT-RECORDED` is printed by design.
3. **If P10 fails on the player samples.** Cache is not expected to be the cause (§2). Check in this order (read-only):
   - (a) Confirm `current` → `NEW_ID` and S7 PASS.
   - (b) Check the on-disk entry:
     `ls -l --time-style=full-iso /home/arm/afldb-releases/current/.next/standalone/.next/server/app/players/<slug>-<id>.html`
     and `grep -o 'Results not loaded\|Not yet awarded\|No medal' …`.
   - (c) If the entry says "No medal" or the interim wording, it is not cache: re-run P1's read-only 2026 query and STOP. No data step is authorised.
   - (d) Otherwise warm again, wait 5 minutes, and run P10 once more.

   A second failure goes to the owner. It is not a rollback trigger by itself: the site serves correctly, but acceptance is open.
   The controls failing (anonymous 200, a 5xx) are rollback triggers under §8.
4. **Owner observation (§6.2)** is recorded separately, with time and viewport, as `OWNER-BROWSER: …`. Without it, the record says
   `OWNER-BROWSER: NOT CONFIRMED`.

## 8. Stop conditions, rollback and recovery

- **Before S5** (P0–P4 up to `PROMOTED`): any STOP leaves production serving `a2e6ea99`. Nothing was switched, no rollback is needed.
  A fast-forwarded checkout at `CAND` is harmless: `current` is unchanged, and the next sitting's P2 accepts it.
- **Rollback triggers (after S5)**, as B1-RUNBOOK §3:
  - the unit is not active after one `reset-failed`;
  - S7 FAIL, other than the apt coincidence resolved by the owner's InvocationID attestation;
  - S8 FAIL, other than CACHE or an unverified journal;
  - S9 5xx or the 503 gate message;
  - journal errors;
  - crash restarts or a not-OK tick during P8;
  - a P10 control failure that shows the site misbehaving (anonymous 200, a 5xx).
- **Application rollback (R2, successor block):**
  1. Claude: `r2-rollback.sh links a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5`.
  2. **Owner:** `sudo systemctl restart afldb`.
  3. Claude: `r2-rollback.sh verify a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5 [<InvocationID if attested>]`, expecting `R2 RESULT ROLLBACK VERIFIED`.

  `rollback` without `--ledger-head` reports "compatibility not checked". Both revisions have migration head 118, so nothing is lost.

  After a rollback, player pages show the interim wording again (that release's own cache). The checkout stays at `CAND`, which `a2e6ea99` serves happily: the release tree, not the checkout, is served.
- **Never in this release:** a database reversal, a restore, any B1a or successor-B1a block, `--skip-host-gate`, `--strict`, or a restart by Claude.
  A release failure does **not** authorise a database reversal or restore. Each is a separate owner decision.
- **AFLDB-ISSUE-351** host-policy decisions (unattended upgrades, restart policy) stay out of scope. This release only uses the existing
  attended-restart path and the per-invocation attestation.
- **Historical records:** nothing under `run6/`, `run6r/` (including the A1 blocks and their `SHA256SUMS`) is used or changed.
  The A1 blocks pin `a2e6ea99`/`c1c4b22e` and must not be sent.

## 9. Evidence to retain

- **Workstation transcript excerpts:** P0 output, every block's RESULT line, the `P10 VERDICT` JSON line, the S9 lines, and the `NEW_ID`/`BUILD_ID`.
- **On the host:**
  - the build log `/home/arm/r7-build-<ts>.log`;
  - `events.log` entries (`build`, `promote`, `status-pass` with `restartConfirmation`, any `rollback`);
  - the P8 log, copied to the workstation.
- **Record:** `run7/sitting-exec-<date>/README.md` with the owner's statements verbatim (approval, restart time, InvocationID if attested, browser observation), then the trackers and CHANGELOG.
- **What is not retained:** cookies and secrets. The blocks remove their temporary files.

## 10. Block manifest

`SHA256SUMS` (repository-root-relative paths, LF bytes) covers:
- the seven `run7/sitting/` blocks;
- the three successor blocks used, `tools/v2/b1a-successor/sitting/{p9-s7s8-checks,p10-pages,r2-rollback}.sh`, blob-equal to `CAND`.

Re-check each before sending. Never send a block from `run6r/`.

## 11. Approval statement (proposed)

> **Approval R7:** "I approve the attended production release of `0a308e2a046b85b376f362ec18098a3eb9a31086` per release packet 7
> (`docs/v2/evidence/remediation-20261114/run7/RELEASE-PACKET-7.md`, `SHA256SUMS` sha256
> `c8c189fc22744aa2b20041aa53f79b9315e9f920e1fd815ce334551f572b9e43`, `origin/main` pin `PREP` = `<commit that publishes the packet>`)
> on **Friday 20 November 2026, 10:00–12:00 AEDT**. `PREP` pins the reviewed procedure; the serving checkout and the build target
> `0a308e2a046b85b376f362ec18098a3eb9a31086` exactly.
>
> Claude runs, over Windows OpenSSH, one connection per step:
> - P0–P2: the read-only pre-check, then the fast-forward of the serving checkout to `0a308e2a` exactly;
> - P3: `release.mjs build --typecheck off-host` with the run7 DEV evidence;
> - P4: `host-gate` and `promote --attended`;
> - then the S7/S8 checks, the public smoke, the P10 `after` page checks and the 30-minute observation.
>
> I perform `sudo systemctl restart afldb` myself, attest its InvocationID only if S7 shows the apt coincidence, and report my signed-in browser observation of the 2026 BV cell.
>
> On a packet 7 §8 trigger, roll back to `a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5`, with my restart.
>
> No database write, reversal, restore or B1a step.
>
> Afterwards, record the outcome in a records-only commit and publish it by fast-forward.
>
> Stop if P1 reads anything other than packet 7 §4 expects."

## 12. Unresolved prerequisites

1. **Publish this packet.** A records-only commit whose sole parent is `0a308e2a`, published by fast-forward, fixes `PREP`, which the
   approval must name. Once it is on `origin/main`, `PREP` = `0a308e2a` is no longer possible, because P1 and P2 require `origin/main`
   to equal `PREP` exactly. The sent block bytes are then on `main`.
2. **Owner approval R7**, with the window (the proposal is Fri 20 Nov 10:00–12:00 AEDT), and owner availability for S6 and the browser
   observation.
3. **At the window:** P1 must read the recorded serving state (§1, §4). Anything else is a STOP, and the packet is revised.
4. **Settle timing:** P1 prints the settle timer's next run. If it falls inside the window, start after it has finished.
5. **ISSUE-351 host policy** stays open and separate. If S7 hits the apt coincidence, the owner's per-invocation attestation is the
   only route.

Not prerequisites:
- The DEV workspaces `/mnt/ssd/afldb-rel7-20261119` (this packet) and `/mnt/ssd/afldb-d365w-20261119` stay in place until the owner decides; both clusters are stopped.
- B1a, its backup, reversal and restore are not part of this release.
