# Release packet 7, revision 3 (R7R3): ISSUE-370, the publishable 2026 Brownlow and the D-370-W pending wording

Prepared 2026-11-21 (Saturday) by Claude, at the owner's instruction to continue AFLDB-ISSUE-370 through a release-ready packet.
**Preparation only:** nothing in this packet contacted production. It supersedes packet 7R2, which the owner held at P3 on 2026-11-21
(`../run7r2/sitting-exec-20261121/README.md` §3). That approval covered a different candidate and different acceptance
criteria, and does not carry over. Packet 7R2's blocks pin `a3c8c67c` and **must not be sent**.

## 0. The decision

In one attended window:
1. **Release `c8d4202a4cb3cf0ccdd1cad01e1227a1610c2d76`** (`CAND`). It carries everything 7R2 carried (packet 7 + ISSUE-367/368/369/352),
   plus ISSUE-370:
   - **D-370-W wording** (owner-approved 2026-11-21). A pending Brownlow in a completed season reads **"Awaiting verification"**, with
     the tooltip "AFLDB has not yet verified and published the Brownlow results for this season."
   - In an unfinished season it reads "Not yet available".
   - No text claims the medal has or has not been awarded.
   - The release also ships the guarded attachment tool. It has no migration, dependency, configuration or unit change.
2. **Attach the official 2026 count** already stored on production at the legacy round grain, using the shipped tool:
   - 9,522 round rows linked to their 207 matches;
   - 9,522 match-mirror cells filled (621 positive, 1,242 votes);
   - one sealed audit row.

   Before this, a verified backup, a read-only plan whose digest the owner reviews, and a dry run. The attachment alone changes
   nothing the public sees.
3. **The owner publishes 2026** as Super Admin at `/admin/brownlow/2026`, with the D-370-1 ineligible list. This is the step that
   makes 2026 public:
   - season totals;
   - the winner, Nick Daicos 47;
   - "Recorded ineligible" markers;
   - per-round and per-match votes;
   - `/brownlow/2026`.
4. **Live acceptance.** Database facts, loopback page checks and Playwright checks in the owner's browser. Production acceptance
   stays open until the corrected behaviour is observed on the live site.

## 1. Pins

| Item | Value |
|---|---|
| Candidate `CAND` (tested commit) | **`c8d4202a4cb3cf0ccdd1cad01e1227a1610c2d76`**. Parent chain `c8d4202a` (seal-inventory test fix) → `9626bce1` (7R2 sitting transcripts) → `f2741235` (ISSUE-370 code, tests, records) → `4484a6d0` (7R2 packet, records) → `a3c8c67c` (= `origin/main` today) |
| Release id prefix | `c8d4202a4cb3-` (P3b/P4 refuse any other, including the 7R2 artefact) |
| `PREP` | the records-only commit that adds this packet (sole parent `CAND`; every `CAND..PREP` path under `docs/` or the three trackers). Pins the procedure; never built or served |
| Serving release (expected at P1) | `current` → `a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5`; `previous` → `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` (unchanged by 7R2, which stopped before P4) |
| Serving checkout (expected at P1) | `/home/arm/projects/afldb` on `main`, clean, at **`a3c8c67c`** (7R2 P2 fast-forwarded it; harmless, since the release tree is what is served). P1/P2 also accept `a2e6ea99` |
| Built, never-promoted 7R2 artefact | `a3c8c67cc98f-JFf9-hXYa6xoigu5Tw4Hg` (BUILD_ID `JFf9-hXYa6xoigu5Tw4Hg`, 13,002 files, log `/home/arm/r7-build-20261121T020057Z.log`). **Disposition: left in place, never promoted.** P1 records whether it is present. Removing it is a separate owner housekeeping decision; this packet never deletes a release |
| Reviewed delta `a2e6ea99..CAND` | 186 paths, 21 commits; raw-listing sha256 `34987c85c84edb304a6f6335cfb6a81357f77a2ab5f1bc6a0d1a5efd2faae0dc` |
| Reviewed delta `a3c8c67c..CAND` | 44 paths: **10 code/test paths** (§2), plus records; raw-listing sha256 `9778c156072d3580e41637552e9ea9c62d9d15c6659b2903eaa8d5850287c0bb` |
| Absent from the delta (P2 re-checks) | `src/db/migrations/`, `package.json`, `package-lock.json`, `next.config.ts`, `deploy/afldb.service`, `deploy/server-cluster.mjs` |
| Production database identity | `afldb_prod`, OID 66668, system identifier 7674454702926115004 (as B1a/6R). D2 `target` and A1 refuse anything else |
| Expected attachment plan | rows 9,522; positive 621; votes 1,242; matches 207/207; attach 9,522; mirror 9,522; digest **`100c112f400a492906cbc2a5c3886243c15d412eb62f84d50f17c63ae1f76aa7`** (computed by the same tool on a copy of the 18 Nov production dump; a different digest on production is a STOP for the owner, not a pass) |
| Node / workers | v22.23.2; `AFLDB_WORKERS` read at P1 |

## 2. Delta review: what is new since 7R2 (`a3c8c67c..CAND`)

| Class | Paths | Effect |
|---|---|---|
| **Application** | `src/lib/format.ts`, `src/app/players/[slug]/page.tsx` | D-370-W. `formatBrownlow`/`brownlowStatusNote` take the season status; a pending cell reads "Awaiting verification" (complete season) or "Not yet available" (otherwise). Accepted and not-applicable cells are unchanged |
| **Operator tool, shipped, run only in D2–D4/R1** | `src/db/queries/brownlow-season-attachment.ts`, `tools/v2/brownlow-season-attach.ts` | `plan` (read-only digest), `apply`/`reverse` (dry run by default; `--commit` writes). They require the reviewed digest, the target identity proof, an actor and a note. Each runs one locked transaction, reuses `applyRoundVoteMatchBackfill`, fills the mirror only where it is NULL, proves totals unchanged and writes a sealed audit row. The reversal is exact until publication and refuses afterwards. Not imported by any page |
| Tests | `tests/format.test.ts`, `tests/e2e/journeys.spec.ts`, `tests/integration/brownlow-season-attachment.test.ts`, `tests/integration/brownlow-fixture.ts`, `tests/integration/leaked-fixtures.ts`, `tests/v2-season-seal.test.ts` | not shipped behaviour. The seal-inventory change classifies the attachment module as `governed` (like `brownlow-round-vote-match-backfill.ts`) and raises the sealed `recordDataEdit` call-site count from 55 to 57 (its apply and reverse) |
| Records | trackers, ISSUE-370 runbook and evidence, the 7R2 packet and its P0–P3b sitting record | none |

**The "eight byte-identical files" versus nine paths, reconciled.**
- **What the earlier claim covered.** It concerned the first nine code/test paths: four application/tool files and five tests. Before
  this revision, eight of them were hash-compared equal to the DEV copy that ran the tests. The ninth, `tests/e2e/journeys.spec.ts`,
  was edited after that sync: it was re-synced and lint/type-checked, but not run. Several of the nine have changed since (D-370-W).
  That comparison is therefore **superseded**.
- **What qualification found.** Qualifying the first candidate, `9626bce1`, as an exact Git checkout exposed a tenth path that had
  to change. `tests/v2-season-seal.test.ts` (the V2-GAP-006 writer and seal-call inventory) failed 2 tests on the new writer: a
  regression in that candidate, invisible to the file-by-file comparison.
- **The fix and the current verification.** `c8d4202a` fixes it as a test-only commit; the shipped tree is identical to `9626bce1`'s.
  `DEV-QUALIFICATION.md` verifies `CAND` = `c8d4202a` itself: a Git checkout of the exact commit, 0 porcelain lines, and
  `git diff a3c8c67c CAND` = the ten code/test paths above. All ten are exercised there, including the e2e journey.

**ISR consequence.** A new build starts with an empty page cache. Pages prerendered at build time read production data then (2026
pending), so the pending wording is served from the first request. After publication, the publish action revalidates `/brownlow`,
`/brownlow/2026`, `/seasons/2026` and the player, club and record pages, but **not match pages**. The cluster keeps a cache per
worker. The binding published checks therefore run **at least 65 minutes after publication** (revalidate = 3600 s), after a warm-up.

## 3. Qualification

- **`DEV-QUALIFICATION.md`** (this folder): the exact `CAND` on streamanator against the **accepted, fully rebuilt** source-only
  database (fresh copies per suite), covering:
  - typecheck, lint gate and unit tests;
  - the Brownlow integration suites;
  - a production build;
  - the changed Playwright journey on a completed-pending season and on a **synthetic unfinished season**.

  **Result: QUALIFIED.** The changed journey passed 2/2 on each season state. All 14 Brownlow integration suites passed except the
  two that need dedicated archive clones, which fail identically on BASE `a3c8c67c`. The 7 unit failures and the 18 full-journeys-file
  failures also fail on BASE (byte-verified tree, same database), so `CAND` introduces 0 new failures. Note 3 there records a DEV-only
  incident: the harness restarted DEV's `afldb.service` three times. That harness has been corrected.
- **`dev/BLOCKS-SELFTEST.md`**: every 7R3 data and page block, run unchanged on a disposable copy of the 18 Nov production dump in
  production's current state, in production order. It also covers the D1v backup proof and the reversal boundary.
- The rehearsal and rendered before/after already recorded in `issues/open/AFLDB-ISSUE-370.md` §7 carry over. Their code is
  unchanged except for the wording.

## 4. Read-only checks that establish the state (P0, P1)

**P0 (workstation, before any SSH):**
- `git ls-remote origin refs/heads/main` returns exactly `PREP`;
- the local checkout is at `PREP` and clean in `docs/v2/evidence/remediation-20261114/run7r3/`;
- `sha256sum -c docs/v2/evidence/remediation-20261114/run7r3/SHA256SUMS` passes from the repository root;
- `SHA256SUMS` itself hashes to the approved value (§10).

**P1 (`r7r3-p1-precheck.sh PREP`, read-only):**
- current/previous links as §1, and the checkout at `a3c8c67c` (or `a2e6ea99`);
- `origin/main` = `PREP`; no release lock;
- the 7R2 artefact recorded;
- `release.mjs status` and `verify` of the serving release;
- no settle, apt, writer, dump or attach process;
- memory, disk and port 3199;
- beta gate on (epoch 1); the import DSN line present (value not read); node v22.23.2;
- in one read-only snapshot, **the 2026 state this packet is written for**:
  - player seasons `pending|669|0`;
  - season `complete`;
  - round grain `9522|621|1242|0` (rows, positive, votes, attached);
  - no season rows, unpublished, no match mirror.

**Any difference is a STOP**, with nothing changed. A changed 2026 state means the plan no longer fits, and the owner decides.

## 5. Sequence (AEDT targets for a 10:00 start; who; pass / stop)

**Transport** (as A1/R7):
- `tr -d '\r' < <block> | C:/Windows/System32/OpenSSH/ssh.exe afldb bash -s -- <args>`;
- **one connection per step, no automatic retries, no rapid reconnects**.

`STAMP` = UTC at P0 (`YYYYMMDDTHHMMSSZ`). Data directory: `/home/arm/r7r3-data-<STAMP>` (0700). Backup: `/home/arm/backups/afldb-r7r3-<STAMP>`.

### Part A: application release (as 7R2, with the new pins and checks)

| # | ~AEDT | Step | Who | Pass / stop |
|---|---|---|---|---|
| P0 | 10:00 | workstation pins (§4) | Claude | any mismatch: STOP |
| P1 | 10:02 | `r7r3-p1-precheck.sh PREP` | Claude | `P1 RESULT PASS`; else STOP, nothing changed |
| P2 | 10:08 | `r7r3-p2-ff.sh PREP` (checkout ff to `CAND`) | Claude | `P2 RESULT PASS`. Remote drift or a non-records `CAND..PREP` path: STOP. Re-runnable once |
| P3 | 10:10 | `r7r3-p3-build.sh`, then `r7r3-p3b-build-check.sh <LOG>` | Claude | `P3b RESULT BUILD PASS <NEW_ID>` + `BUILD_ID`. Failure leaves production on `a2e6ea99`; one retry only if the cause is understood and needs no code or data change |
| — | 10:25 | **OWNER present, ready to restart; browser readiness (§6.1)** | **Owner** | |
| P4 | 10:27 | `r7r3-p4-gate-promote.sh NEW_ID` | Claude | `P4 RESULT PROMOTED`. Gate refusal: wait and re-run, never `--skip-host-gate` |
| S6 | 10:28 | **OWNER: `sudo systemctl restart afldb`** | **Owner** | unit active |
| P9 | 10:30 | successor `p9-s7s8-checks.sh NEW_ID [InvocationID]` (unchanged, prefix-agnostic) | Claude | `P9 RESULT S7+S8 PASS`; any other FAIL → rollback (§8) |
| S9 | 10:35 | workstation `bash r7r3-s9-public-smoke.sh <BUILD_ID>` | Claude | `S9 RESULT PASS`; 5xx or the 503 gate message → rollback |
| P10a | 10:37 | `r7r3-p10-brownlow.sh pending` | Claude | `P10 RESULT pending PASS (11 pages x 8 samples, anon control)` (§7.1) |
| A3a | 10:40 | Playwright MCP in the owner's browser: `r7r3-a3-browser-checks.js` with `MODE='pending'` | Claude + **Owner** (signed in) | `pass: true`; recorded as `OWNER-BROWSER-A3 pending`, separately from P10 |
| P8 | 10:42 | `r7r3-p8-observe.sh NEW_ID scott-pendlebury-11724` in the background (31 min) | Claude | `P8 RESULT OBSERVATION PASS (4 ticks)`; crash restarts or errors → rollback. **Must end before publication** |

### Part B: the 2026 attachment (during P8; no public change)

| # | ~AEDT | Step | Who | Pass / stop |
|---|---|---|---|---|
| D1 | 10:43 | `r7r3-d1-backup.sh STAMP` (dump, sha256, header, DB-free 2026 proof, parity) | Claude | `D1 RESULT DUMP CAPTURED … (unproven until D1v)` |
| A1a | 10:46 | `r7r3-a1-facts.sh STAMP before` | Claude | `A1 RESULT before PASS` (writes `facts-before.txt`) |
| D2 | 10:47 | `r7r3-d2-attach.sh STAMP target`, then `… plan` | Claude | `D RESULT target PASS` (identity `afldb_prod|66668|7674454702926115004`; prints `ACTOR-CANDIDATE` ids); `D RESULT plan PASS digest=100c112f…76aa7`. Another digest: STOP |
| D1v | 10:50 | copy the dump, `.sha256`, `parity-prod.txt` and `facts-before.txt` to a new 0700 directory on streamanator, staged through `D:\tmp\afldb-r7r3-<STAMP>\` (deleted afterwards), as 6R §5.4; then `dev/r7r3-dv-restore-verify.sh <dir> <sha256> <bytes> <digest>` | Claude | `VERDICT PASS backup proven by a fresh disposable restore`: restore clean, parity equal, facts equal on every line but identity, **plan on the backup has production's digest**, dry run passes. A FAIL: no D3/D4 in this window |
| — | 11:05 | **OWNER: digest review (§6.3).** Claude shows the D2 PLAN line, the plan-file sha256, D1v's verdict and the target summary. The owner states the digest and the actor id | **Owner** | stated digest = D2 digest |
| D3 | 11:08 | `r7r3-d2-attach.sh STAMP dry <digest> <actor>` | Claude | `D RESULT dry PASS` (`APPLY DRY-RUN (rolled back) … attached=9522 mirrored=9522 unattached_after=0 mirror_after=9522`) |
| D4 | 11:10 | `r7r3-d2-attach.sh STAMP commit <digest> <actor>` | Claude | `D RESULT commit PASS` (`APPLY COMMITTED … audit=<id>`). A FAIL: run A1 `attached` and read §8.2 before anything else |
| A1b | 11:11 | `r7r3-a1-facts.sh STAMP attached` | Claude | `A1 RESULT attached PASS`: 207 linked matches, each exactly one 3/2/1 set; mirror 9,522 cells / 621 positive / 1,242 votes; round = match per player and per cell; still unpublished; every other season's fingerprints unchanged |
| P10b | 11:13 | `r7r3-p10-brownlow.sh pending` again | Claude | `P10 RESULT pending PASS`: the attachment is not public |
| — | 11:14 | P8 ends | | `P8 RESULT OBSERVATION PASS` required before publication |

### Part C: publication and live acceptance

| # | ~AEDT | Step | Who | Pass / stop |
|---|---|---|---|---|
| PUB | 11:15 | **OWNER publishes 2026 (§6.4)** at `https://beta.afldb.com/admin/brownlow/2026`, with the D-370-1 list and a note | **Owner** | "Published 2026 (revision …)" |
| A1c | 11:18 | `r7r3-a1-facts.sh STAMP published <N>` (N = number of D-370-1 ids) | Claude | `A1 RESULT published PASS`: 183 season rows, 1,242 votes, 1 winner (Nick Daicos 47), N ineligible; 669 player seasons `complete` with 1,242 votes; three coverage rows `complete`; published. Round = match = season totals (0 differences each way); other seasons unchanged |
| P10c | 11:20 | `r7r3-p10-brownlow.sh published <slug-ids>` (early, **informational**: the cache is per worker) | Claude | recorded; not binding |
| P10d | **≥ 12:20** (publication + 65 min) | `r7r3-p10-brownlow.sh published <slug-ids>` (**binding**) | Claude | `P10 RESULT published PASS` (§7.2). One FAIL: warm-up, wait 10 minutes, run once more. A second FAIL goes to the owner (not a rollback trigger by itself) |
| A3b | 12:25 | Playwright MCP in the owner's browser: `r7r3-a3-browser-checks.js` with `MODE='published'`, `INELIGIBLE=[…]` | Claude + **Owner** | `pass: true`, recorded as `OWNER-BROWSER-A3 published`; plus the owner's own look at Pendlebury's 2026 row (§6.5) |
| — | 12:35 | records: sitting record, trackers, CHANGELOG; records-only commit; fast-forward publication after reviewing the delta | Claude | |
| — | –13:30 | reserve | | |

## 6. Owner-only actions (exact)

1. **Before P4: browser readiness.**
   - In your own admitted browser, open `https://beta.afldb.com/players/scott-pendlebury-11724` and confirm it renders (not `/beta`).
     If the Playwright MCP browser is used for A3, sign in there too.
   - Before promotion the 2026 BV cell reads "Not yet awarded". That is the serving release's interim text, expected until P4.
2. **S6, right after P4 prints `PROMOTED`:** `sudo systemctl restart afldb`. Tell Claude, and give the InvocationID if you want it
   attested.
   - Only if the unit is not active with `start-limit-hit`: `sudo systemctl reset-failed afldb && sudo systemctl start afldb`.
3. **Digest review (before D3).** Read back the 64-hex digest from the D2 PLAN line and confirm the actor id (your `auth_users` id
   from the `ACTOR-CANDIDATE` lines). Claude sends D3/D4 only with the digest and actor you state.
4. **Publication (after A1b, P10b and P8 PASS).** At `https://beta.afldb.com/admin/brownlow/2026`, signed in as Super Admin:
   - Expect "complete", 207/207 matches and no blockers.
   - Open "Ineligible players (0 marked)" and tick **exactly** the D-370-1 players: under the proposal, the 14 names and vote counts in
     `docs/v2/evidence/remediation-20261114/run7r3/D-370-1-eligibility-2026.md` §3. Confirm the heading then reads "(14 marked)".
   - Enter a note of at least 20 characters, for example "2026 official count, attached under release 7R3; ineligible list D-370-1".
   - Publish, then tell Claude the time.
5. **After P10d.** Hover Pendlebury's 2026 BV cell (it should read **5**, with no tooltip) and open `/brownlow/2026`. Report what you
   see. This is recorded as `OWNER-BROWSER: …`, separately from every automated result.
6. **Rollback only:** `sudo systemctl restart afldb` after R2 `links` prints `LINKS ROLLED BACK`.

## 7. Acceptance (phase-specific)

These replace the obsolete 7R2 expectations: D-365-W "Results not loaded", the season page's no-votes text as a pass condition, and
`/brownlow/2026` = 404 as a permanent expectation.

### 7.1 Pending: after promotion, and again after the attachment (P10a, P10b, A3a)

- **Player cells.** Pendlebury (`scott-pendlebury-11724`) and Daicos (`nick-daicos-9910`) 2026 BV cells read "Awaiting verification",
  titled "AFLDB has not yet verified and published the Brownlow results for this season.". Neither page contains:
  - "Not yet awarded";
  - "Results not loaded";
  - "No medal";
  - "has been awarded";
  - the D-365-W tooltip.
- **Game logs.** The 2026 game logs have a BV column with no vote (sum 0).
- **Matches.** 17247 (R8) and 17151 (R21) show no BV for Pendlebury.
- **Season.** `/seasons/2026` is 200, with no round-vote block and with "No votes recorded for 2026".
- **Brownlow pages.** `/brownlow` has no 2026 entry; `/brownlow/2026` is 404.
- **2025 control.** Pendlebury 2025 = 2; Daicos 2025 = 32; `/brownlow/2025` won by Matt Rowell (39), with Daicos 32 and Pendlebury 2;
  match 16677 shows 3 polled players.
- **Anonymous control.** An anonymous `/players/scott-pendlebury-11724` is 307 to `/beta?from=%2Fplayers%2Fscott-pendlebury-11724`.
- **Sampling.** Every page is warmed 8 times and sampled 8 times, and every sample must pass.

### 7.2 Published: after the owner's publication, binding at ≥ 65 minutes (P10d, A3b, with A1c)

- **Database (A1c).** 207 linked matches; 621 positive allocations; 1,242 votes. Round, match and season totals agree for every player
  (0 differences each way) and per match cell. 183 season rows, 1 winner (Nick Daicos 47), N ineligible. 669 player seasons complete.
  Coverage complete. Every other season byte-identical to `before`.
- **Pendlebury.** 2026 cell **5**. Game log: R8 = 3 and R21 = 2, sum 5. Match 17247 shows BV 3 and match 17151 shows BV 2.
- **Daicos.** 2026 cell **47**; game-log sum 47.
- **Season page.** `/seasons/2026` has 25 round-vote blocks, Pendlebury's round votes [3, 2], and no no-votes text.
- **`/brownlow`.** Lists 2026 (Nick Daicos, Collingwood, 47) with a link to `/brownlow/2026`.
- **`/brownlow/2026`.** 200, "Won by Nick Daicos with 47 votes", winner badge on Daicos, Bailey Smith 36, Marcus Bontempelli 34,
  Scott Pendlebury 5. The rows marked "Recorded ineligible" are **exactly** the D-370-1 list.
- **2025 control and anonymous control.** As in §7.1, unchanged.

### 7.3 What closes ISSUE-370

ISSUE-370 closes only when all of these pass and the owner's own observation (§6.5) is recorded:
- A1c;
- P10d;
- A3b.

Production acceptance stays open until then.

## 8. Stop conditions, rollback and recovery

### 8.1 Application (Part A), as 7R2/packet 7 §8

- **Before S5** (P0–P4 up to `PROMOTED`): any STOP leaves production serving `a2e6ea99`. A checkout fast-forwarded to `CAND` is
  harmless.
- **Rollback triggers after S5:**
  - the unit is not active after one `reset-failed`;
  - S7/S8 FAIL (apt coincidence and unverified journal excepted, as before);
  - S9 5xx or the 503 gate message;
  - journal errors;
  - a P8 tick not OK;
  - a P10 control showing the site misbehaving (anonymous 200, a 5xx).
- **R2 sequence:**
  1. Claude: `r2-rollback.sh links a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5`.
  2. **Owner:** restart.
  3. Claude: `r2-rollback.sh verify a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5`.
- **An application rollback never touches data.**
  - Rolled back **before** publication: 2026 shows the old interim "Not yet awarded" again.
  - Rolled back **after** publication: `a2e6ea99` serves the published season correctly. It reads the same accepted tables; it lacks
    only D-370-W, which by then no longer applies to 2026.
- **A P10a/P10b player-cell failure is not a rollback trigger** while the controls pass. It goes to the owner, and **D3/D4 do not
  start** until it is understood.

### 8.2 Data, BEFORE publication: exact reversal (R1)

The attachment is reversible exactly, from the same reviewed export, **only while 2026 is unpublished**. Triggers:
- A1b fails;
- P10b shows a vote publicly;
- the owner decides not to publish in this window.

Steps:
1. `r7r3-d2-attach.sh STAMP reverse-dry <digest> <actor>` → `D RESULT reverse-dry PASS`
   (`REVERSE DRY-RUN … unattached_after=9522 mirror_after=0`).
2. `r7r3-d2-attach.sh STAMP reverse-commit <digest> <actor>` → `D RESULT reverse-commit PASS`.
3. `r7r3-a1-facts.sh STAMP reversed` → `A1 RESULT reversed PASS`: the `before` state, other seasons unchanged.

Leaving the attachment in place unpublished is also safe. Nothing public changes, and a later window can publish without
re-attaching. The reversal writes its own sealed audit row.

If D4 itself fails, the transaction rolled back. Run `A1 … attached` (it will FAIL showing the true state) before any decision.
Never re-run D4 without the owner.

### 8.3 Data, AFTER publication: the reversal no longer applies

`reverse` refuses with `already_published` (proven in the self-test). AFLDB has no "unpublish". In order of preference:

1. **Wrong ineligible list** (the likeliest correction). The owner re-publishes 2026 at `/admin/brownlow/2026` with the corrected
   list. This creates a new audited revision; votes, the winner and pages are otherwise unchanged. Then A1 `published <N'>` and P10
   `published <list'>` (A1 writes a new facts file per phase; for a second run, use a new STAMP data directory with `facts-before.txt`
   copied in).
2. **A wrong vote** (not expected: the attached votes are the official count, reconciled 1,242 = 207 × 6). The owner makes a Super
   Admin correction of the affected rows through the existing admin Brownlow tools, then re-publishes.
3. **Last resort: restore the D1 backup.** This is a separate owner decision and procedure (`docs/backup-restore.md`). It replaces the
   whole database with the D1 state and loses every write made after D1, including any settle or admin change. It needs the owner's
   restart and is never part of this approval.

### 8.4 Never in this window

- `--skip-host-gate`, `--strict`, or a restart by Claude.
- Any B1a or successor-B1a data block.
- `restore-test.sh` on production; a restore of any kind.
- Deleting a release, the backup or the data directory.
- Re-running D4.
- Publishing on the owner's behalf.

## 9. Evidence to retain, and what never enters Git

- **Workstation transcript excerpts:**
  - every block's RESULT line;
  - the P10 and A3 VERDICT JSON;
  - `NEW_ID`/`BUILD_ID`;
  - the D2 PLAN line, digest, plan-file sha256 and target summary (host:port, database, user, cluster, OID, system identifier);
  - the D4 audit id;
  - the A1 PASS/FAIL lines.
- **On production, 0700, never copied into Git:**
  - `/home/arm/backups/afldb-r7r3-<STAMP>/` (dump, `.sha256`, parity);
  - `/home/arm/r7r3-data-<STAMP>/` (`target.json`, `plan-2026.json`, the dry/apply result files, `facts-*.txt`).
- **On streamanator, 0700:** the D1v dump copy and its stopped cluster. These hold production data, including auth tables. The owner
  decides their removal.
- **Record:** `run7r3/sitting-exec-<date>/README.md`, holding:
  - the owner's statements verbatim (approval, restart, digest review, actor, the D-370-1 list, publication time);
  - excerpts only: no dump content, no DSN, no cookie, no secret.

## 10. Block manifest

`run7r3/SHA256SUMS` covers:
- the twelve `run7r3/sitting/` files;
- the two `run7r3/dev/` scripts;
- the two successor blocks reused unchanged: `tools/v2/b1a-successor/sitting/p9-s7s8-checks.sh` and `r2-rollback.sh`.

Paths are repository-root-relative, with LF bytes; check with `sha256sum -c` from the repository root. **Manifest sha256: `f74540053b3811653d34f871f461bd804e2352ca1db55be8e3a26e5716bb4abe`.** Never send a block from `run7/`,
`run7r2/`, `run6/` or `run6r/`. The successor `p10-pages.sh` is **not** used in 7R3.

## 11. Approval statement (proposed)

> **Approval R7R3:** "I approve publishing `PREP` (the records-only commit adding release packet 7R3) to `origin/main` by
> fast-forward, and the attended production release and data change of release packet 7R3
> (`docs/v2/evidence/remediation-20261114/run7r3/RELEASE-PACKET-7R3.md`, `SHA256SUMS` sha256 `f74540053b3811653d34f871f461bd804e2352ca1db55be8e3a26e5716bb4abe`, `origin/main` pin
> `PREP` = `<full SHA>`) on **`<day, date>`, `<start>`–`<end>` AEDT** (3½ hours).
>
> Part A: Claude releases `c8d4202a4cb3cf0ccdd1cad01e1227a1610c2d76` with the 7R3 blocks, one SSH connection per step (P0–P4, the
> S7/S8 checks, the public smoke, P10 pending, P8). I restart `afldb` myself after P4 and on any rollback.
>
> Part B: Claude takes the D1 backup, proves it by the D1v disposable restore on streamanator, plans the 2026 attachment read-only
> (expected rows 9,522, digest `100c112f…76aa7`), and, after I state the digest and my actor id, runs the dry run and then commits
> the attachment (D4). One commit only; no re-run without me. The reversal (R1) is authorised only before publication and only on a
> §8.2 trigger.
>
> Part C: I publish 2026 at `/admin/brownlow/2026` myself, with the D-370-1 list `<ids>`. Claude runs A1, the binding P10 at least
> 65 minutes later, and the A3 Playwright checks in my signed-in browser. I report my own observation.
>
> On a §8.1 trigger, roll back the application to `a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5` with my restart. No restore, no unpublish,
> no other data change.
>
> Afterwards, record the outcome in a records-only commit and publish it by fast-forward. Stop if P1 reads anything other than §4
> expects."

## 12. Open before approval

1. **D-370-1**, the 2026 ineligible list: the owner's decision (evidence and the smallest decision in
   `docs/v2/evidence/remediation-20261114/run7r3/D-370-1-eligibility-2026.md`).
2. **The window** (3½ hours, owner present throughout Part A's restart, the digest review and the publication).
3. **Publication of `PREP`** to `origin/main`, which carries `4484a6d0`, `f2741235`, `9626bce1` and `c8d4202a`: part of the approval above.
   Nothing is pushed before it.
