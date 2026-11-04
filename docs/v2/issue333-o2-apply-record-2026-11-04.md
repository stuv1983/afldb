# ISSUE-333 (O1) and O2: production apply record (2026-11-04)

**Status: APPLIED AND VERIFIED (both). ISSUE-333 RESOLVED 2026-11-04 under the owner's amended visibility criterion (section 10): the corrected figures were observed through the public routes; worker-by-worker attribution stays unmeasured and is an accepted, disclosed limitation.** O1 (436 `match_coaches` rows) and O2 (36 `data_issues` resolutions) were each applied once on
production under the owner's consolidated approval and ended `COMMITTED_VERIFIED` with an independent `state` verdict `PLANNED RESULT PRESENT`. Nothing else was
changed: no push, deployment, restart, schema/grant/credential/timer/setting change, provider request, manual settle, WSL access or cleanup.
(Superseded within the day: the sections below are written in time order; sections 6 and 8 describe the state before the second probe, and section 10 records the closure.) Approval and plans: `docs/v2/issue333-o2-consolidated-approval-2026-11-04.md`.
Evidence: `docs/v2/evidence/issue333-o2-20261104/prod-apply/` and `scripts/` (sha256 in `SHA256SUMS-postapply`).

## 1. Authority and window

- Owner approval message received 2026-11-04 (first tool action of the session logged at 03:08:07Z; the harness did not log the message instant itself). Window: receipt to
  90 minutes later, capped at 2026-11-04T17:00:00Z and every earlier expiry. Approval files were therefore given `expiresAt` **2026-11-04T04:35:00Z**, which is 86 minutes
  after that first logged instant and so inside 90 minutes of any receipt at or after 03:05:00Z. Plan expiries (2026-11-05T02:16:51Z O1, 02:17:15Z O2) and the 24 hour
  backup freshness were not the binding limits. Host (Melbourne) time at the applies was 14:14 and 14:15, far from the 04:15-05:30 no-apply window.
- Execution revision `50ed6e4f4a697160ef263ade293792363e52e975`; target `afldb_prod`, system identifier `7674454702926115004`, database OID `66668`.
- Backup `issue333-o2-20261104T021037Z`: dump sha256 `e77c307d...826d`, restore evidence sha256 `07e1f694...c6f1` (both re-hashed on the host before applying).
- Approvals written by Claude on the owner's behalf with the corrected wrapper: O1 plan `4de5368c7b4dfff00550b5ec60bb8596d1e84804534a94d0b7f6836a3dbc515e`,
  core.tar `9a989fdc...b080`; O2 plan `c29d148d17af1cdc94ecae547a8026365dee5ade66def278dba9b49a84f7ea03`, resolution `canonical_apply_not_needed`, ids 41 to 76.
  Each was read back from disk and matched the plan and the instruction on operation, target, revision, digest and expiry (`prod-apply/approval-*.json`).

## 2. Prerequisites

1. **Wrapper defect fixed.** The committed wrapper (sha256 `ae456bdce6c7af5794909bd75b77e5123b5e278026cd18b71019e2ff1af551c2`) ignored the exit status of the approval-file
   step and fell through to `step DONE` with exit 0 (reproduced: with the evidence directory missing the original returned rc 0 and printed `== DONE`). Revision 2 (sha256
   **`f1d810eef585b5170fbb8deea274a4db67c3decfb6418a8e702b3f88bae0970f`**, 7,933 bytes, 0 CR) now: validates the expiry, writes the approval to a temporary file and links it into place
   (atomic and exclusive), stops with the child's nonzero status on any failure, reads the file back against the plan and arguments, and lets `state-*` take an
   expectation (`any|baseline|present`) so a BASELINE verdict can no longer pass as applied. `apply-*` now prints that exit 0 is not the final verdict.
2. **Every phase exercised with mocked commands** (`scripts/mock-wrapper-test-i333-o2.sh`, result `prod-apply/wrapper-mock-test-result.txt`): 34 checks, 0 failures. Covered:
   approval success, existing approval refused and unchanged, bad or past or plan-exceeding expiry, empty reference, creation failure; state present/baseline/other/
   undetermined/refusal with every expectation (a BASELINE verdict with expectation `present` exits 7 although the tool exits 0); apply with no approval, inside the window, with a
   running settle unit, and tool exit codes 0 to 5 propagated; DSNs reach the child by environment only and never argv or output; host, user, revision, dirty-tree, plan-file
   guards. The only transformation of the wrapper under test was the `/home/arm` path prefix (diffed identical after reversal). The mock is not a production run.
3. **Frozen bytes preserved.** No tool, writer, ceremony or plan file changed. The transported wrapper was hash-verified on the host (`sha256sum -c` OK, `bash -n` OK, original kept as
   `in/prod-apply-i333-o2.sh.orig-ae456bdc`). The ops checkout was clean at the revision, and each ceremony's own `tool_hashes` preflight passed at apply time.
4. **Revalidation before applying** (read-only, 03:13:24Z to 03:13:27Z): core.tar, restore evidence, dump and the backup directory sums verified; both plan files equal the repository
   copies; no settle unit active; `state` for both plans returned `STATE BASELINE` with the expectation check matched.

## 3. Applies

| Step | UTC | Result |
|---|---|---|
| O1 apply | commit 03:14:48Z (batch 83) | `COMMITTED_VERIFIED (exit 0)`, writer: `inserted 436`, `batchId 83`. `prod-apply/apply-i333-20261104T031411Z.json` |
| O1 state | 03:15:31Z | `STATE PLANNED RESULT PRESENT (exactly the reviewed 436 assignments were added)`, verdict matched |
| O2 apply | commit 03:15:45Z | `COMMITTED_VERIFIED (exit 0)`, writer: `updated 36`. `prod-apply/apply-o2-20261104T031543Z.json` |
| O2 state | 03:15:45Z | `STATE PLANNED RESULT PRESENT (exactly the 36 findings are resolved)`, verdict matched |

No refusal, retry, reversal or restore occurred.

## 4. Measured production outcome (read-only, 03:17:24Z, reproduced 03:22:39Z; `prod-apply/postapply-verify.txt`)

| Fact | Before (probe 01:29Z) | After |
|---|---|---|
| `match_coaches` | 32,034 | **32,470** |
| 2026 `match_coaches` | 0 | **436** (batch 83, source 10, matches 17056 to 17274) |
| 2026 sides without a coach | 436 | **0** |
| rows with `import_batch_id` null or at most 82 | 32,034 | **32,034** (pre-existing rows; the ceremony's full-row baseline re-proof also held) |
| `coaches` | 386 | 386 |
| `import_batches` / max id | 75 / 82 | 76 / 83 (`add_match_coaches_2026.py`, completed, inserted 436) |
| `import_rejections` | 681 | 681 |
| Josh Carr (coach 243) rows | 0 | **23** (all new) |
| Josh Fraser (coach 293) rows | 0 | **16** (all new) |
| Distinct coaches in 2026 | n/a | 20 |
| `data_issues` total / open | 40 / 40 | 40 / **4** |
| ids 41 to 76 | open | **36 resolved**, one `resolved_at` (2026-11-04 14:15:45.048261+11), `resolution = canonical_apply_not_needed`, 0 still open, all `foreign_source_owner` |
| other four findings (ids 1 to 4) | open | **unchanged**, still open, no resolution |

Through the application queries (`src/db/queries/coaches.ts` run from the ops checkout as `afldb_app`, SELECT-only): **Josh Carr 23 games (W7 D0 L16, Port Adelaide 2026)**,
**Josh Fraser 16 games (W12 D1 L3, 1 final, Carlton 2026)**; `listCoaches` 386 rows, 32,470 games in total, digest `2da45fca2b597cb8...` (`prod-apply/figures-postapply-20261104*.json`).
The 36 canonical rows of the O2 findings remain `afltables`-owned and untouched.

## 5. Public visibility: what was and was not measured

- Application routes: `/coaches` is `revalidate = 3600`; `/clubs/[slug]` is `revalidate = 86400`; `/coaches/[slug]` is `force-dynamic`. Production runs `deploy/server-cluster.mjs` with **2 workers**
  (pids 3326572 and 3326573, up since 2026-11-03 08:48 AEDT).
- **The whole site is behind the beta gate**: an anonymous request to any of these paths is `307` to `/beta` (on the public host and on the loopback app), and a 307 never renders the page,
  so no worker, no response body and no timestamped sample of any coach or club page could be obtained. The `x-afldb-worker`/`x-afldb-pid` response headers that would identify the worker
  were therefore never observed. **No cookie was minted, forged or replayed**; the gate is an access control and no invite code or cookie was supplied.
- On-disk ISR entries of the served tree (03:20:35Z and 03:22:41Z): `coaches.html` last written 2026-11-04 09:36:01 AEDT, **before** the O1 commit (14:14:48), so it holds pre-change content; the
  `clubs/port-adelaide` and `clubs/carlton` entries date from the build (2026-11-03 08:40 AEDT). Nothing has regenerated them since the apply (no gated request has reached those routes).
  This is a file-system observation, not a visibility deadline: no time-to-visibility is inferred from `s-maxage`/`stale-while-revalidate`.
- **Exact dependency to close it:** a beta cookie for an allowlisted address (the owner's magic link, or the owner's explicit authorisation to mint a probe cookie on the host as the DEV note
  `dev-beta-gate-breaks-isr-measurement` describes), then repeated gated GETs of `/coaches`, `/coaches/josh-carr-243`, `/coaches/josh-fraser-293`, `/clubs/port-adelaide` and `/clubs/carlton`
  recording status, `x-afldb-worker`, `x-afldb-pid`, `x-afldb-build` and the Carr/Fraser figures with timestamps, until both worker pids have been observed returning the new figures (or
  the observation is declared incomplete).

## 6. ISSUE-333 resolution criteria

| Criterion | State |
|---|---|
| Owner approval of plan `4de5368c...515e` | Met |
| One apply ending COMMITTED_VERIFIED | Met |
| `state` reports PLANNED RESULT PRESENT | Met |
| Read-only 2026 count is 436 | Met |
| Time-to-visibility of the public coach and club pages measured per page and worker | **Not met as originally written** (unmeasured behind the beta gate, section 5; worker identity never observable). **Replaced by the owner's amended criterion (section 10): the corrected figures observed through the public routes, worker-by-worker attribution accepted as an unmeasured, disclosed limitation. Met on that criterion.** |

At the time of the apply ISSUE-333 was not resolved: the data defect was corrected and verified and the open remainder was the visibility measurement. **It was resolved later on 2026-11-04 under the owner's amended visibility criterion; see section 10.**

## 7. Recovery limits (accepted by the owner, unchanged)

The backup `issue333-o2-20261104T021037Z` was not used. No reversal exists for either operation by design; both were additive (O1) or a 36-row update to two columns (O2), and the
restore-verified dump remains the retained recovery reference. The ops workspace, plans, approvals and apply evidence under `/home/arm/ops/issue333-o2-50ed6e4f/` were preserved.

## 8. Public visibility probe (owner-authorised beta-admission cookie), 2026-11-04

**Authority and scope.** The owner authorised ONE temporary beta-admission probe cookie (beta admission only; not admin, not impersonation of the owner), read-only GETs of five pages, normal ISR regeneration from those requests, and nothing else (no data write, forced revalidation, cache deletion, restart, deployment, setting change or second token). No existing beta session was available to Claude, so one `kind='beta'` claim was minted with the repository's `signClaim` (`src/lib/auth/tokens.ts`, byte-identical to the serving build's since `a0b1080f`) inside one process on the production host, from the serving process's own `AFLDB_SESSION_SECRET` and `AFLDB_BETA_EPOCH` (read from `/proc/<main pid>/environ`, those two keys only). Subject `issue333-readonly-probe-20261104`, kind `beta`, epoch 1, **created 2026-11-04T04:23:57.070Z, expires 05:18:57Z** (55 minutes). The secret and token stayed in that process's memory: not printed, not in argv, no cookie file, no screenshot or trace; the committed evidence JSON contains no cookie (searched). The cookie was sent only to `beta.afldb.com` over TLS, no redirect was followed, and no admin claim, database session, allowlist change, magic link, epoch change or gate change occurred. The process exited at 05:17:22Z; the ops checkout stayed clean.

**What was requested.** 1,680 ordinary public-host GETs (336 per page, bursts of two, 1.5 s apart, one round every ~2.5 minutes from 04:23:57Z to 05:16:20Z, about 0.5 requests/s) plus an explicitly labelled loopback diagnostic of 80 GETs (16 per page, 05:16:20Z to 05:17:09Z). **This was more than the gentle pacing intended**: the stop condition required worker identifiers the server never sends, so it ran every round. All 1,760 responses were HTTP 200; 0 errors. Evidence: `prod-apply/visibility-beta-probe-20261104.json` (every request: time, status, selected headers, body size, extracted rows).

**Observed on the public host (these are observations, not inferences):**

| Page | Old content last seen | New figures first seen | Then |
|---|---|---|---|
| `/coaches` | 04:23:57.077Z and 04:23:57.094Z, both `x-nextjs-cache: STALE`, Carr and Fraser `0` | **04:23:58.810Z** (`HIT`): Josh Carr `2026 / 23`, Josh Fraser `2026 / 16` | 334 of 334 later responses show them |
| `/clubs/carlton` | 04:24:48.468Z and 04:24:48.469Z, `STALE`, no 2026 coach row | **04:24:50.328Z** (`HIT`): Josh Fraser `2026, 16 games, 12 W, 1 D, 3 L, 78.1` | 334 of 334 later responses |
| `/coaches/josh-carr-243` (force-dynamic) | none (no regeneration involved) | first request **04:24:09.884Z**: Port Adelaide `2026`, `23` games, `7 - 16 - 0`, `30.4` | identical in 336 of 336 responses |
| `/coaches/josh-fraser-293` (force-dynamic) | none | first request **04:24:22.817Z**: Carlton `2026`, `16` games, `12 - 3 - 1`, `78.1` | identical in 336 of 336 responses |
| `/clubs/port-adelaide` | 04:24:35.800Z and 04:24:35.801Z, `STALE`, body 393,154 bytes | body grew to 394,106/394,149 bytes from **04:24:37.414Z** (`HIT`), the same growth pattern as Carlton | **the coach row itself was not captured** (see below) |

"First seen" is the first time the probe saw it, not the regeneration time, which is unknown (it lies between the last stale and the first fresh response of each page, about 1.7 s for `/coaches` and 1.9 s for Carlton). The probe's own checks wrongly reported the three non-ISR-matching pages as failures: the career tables render wins, losses and draws in one cell (`7 - 16 - 0`), which the check did not expect, and the Port Adelaide check read the first row containing "Josh Carr", which is the 2000-2010 *player* (`2000-2010, 124, 65`). The recorded `seen` rows above are what the pages actually showed. The ISR window from the apply (03:14:48Z) to first fresh content was at least 1 hour 9 minutes on `/coaches` and `/clubs/carlton` (until then no request had rendered them: anonymous requests are redirected by the gate).

**Supporting diagnostics, labelled, NOT visibility evidence:** (a) the regenerated on-disk entry `clubs/port-adelaide.html` (written 04:24:36Z) contains the row `Josh Carr | 2026 | 23 | 7 | 0 | 16 | 30.4`, and `clubs/carlton.html` the Fraser row (`prod-apply/isr-disk-diagnostic.txt`); (b) the loopback diagnostic returned the new figures on `/coaches` and `/clubs/carlton` (its checks have the same defect elsewhere); (c) on both club pages the 334 fresh responses split into exactly two body-size variants of 167 each (394,106/394,149 and 1,528,135/1,528,178), alternating, consistent with two worker caches that both regenerated, but this is an inference from byte counts.

**Unmet criteria (specific):**
1. **Worker identity was not observable.** Production runs `deploy/server-cluster.mjs` with two workers (pids 3326572 and 3326573), but the `x-afldb-worker`/`x-afldb-pid`/`x-afldb-build` headers are emitted only when `AFLDB_TRACE_REQUESTS=on`, which production does not set; enabling it needs a setting change and restart, which are not authorised. No response could be attributed to a worker, so "the expected data on both production workers for each page" is **not demonstrated**, only suggested by (c).
2. **`/clubs/port-adelaide`: the coach row was not read from a public response.** Only the body growth (+952 bytes) and the on-disk diagnostic support it.

The token has expired. Completing (2) needs a new probe with a corrected row selector (and, for (1), either an owner-approved temporary `AFLDB_TRACE_REQUESTS=on` with a restart, or an owner-accepted statement that two-worker coverage is shown by the evidence above). Neither was authorised, so none was done. **Update (same day, later): point 2 was closed by the second bounded probe and point 1 was accepted by the owner as a disclosed limitation; see section 10.**

## 9. The two modified `prod-plans` text files

`git status` showed `prod-plans/prod-plans.txt` and `prod-plans/prod-prep.txt` modified from before this work. Their working-tree bytes are LF with no CR and are **byte-identical to the committed blobs** (sha256 `cf118d805d7d54d5...` and `efc52b7d9efafcbe...`, equal to `SHA256SUMS`; `git diff` empty; blob `6f45063f` for prod-plans). The "modification" was a stale index stat entry (recorded size 3,367 bytes against 3,344 in the file), left by an earlier CRLF working copy. No retained change existed; `git add` refreshed the index entry and the status cleared with nothing staged. Nothing was discarded.

## 10. Second bounded probe (-r2), the owner's amended visibility criterion and the closure of ISSUE-333, 2026-11-04

**Owner amendment.** The visibility criterion is amended to require *the corrected figures observed through the public routes*. Worker-by-worker attribution remains unmeasured and is accepted as a disclosed limitation. The body-size variants do **not** prove worker coverage and are not claimed to. No tracing setting, restart or deployment was authorised. The four pages in section 8 (`/coaches`, `/clubs/carlton`, `/coaches/josh-carr-243`, `/coaches/josh-fraser-293`) already satisfied their route-level checks; their evidence is preserved unchanged and was not repeated. One second, narrowly bounded beta probe was authorised for `/clubs/port-adelaide` only.

**Selector corrected and tested before any token existed.** `scripts/coach-row-selector.mts` finds the coaching table by its caption (`Every coach of <club>, with their record for the club`, as rendered by `src/components/ClubCoachRecords.tsx`) and its seven headers (`Coach, Span, Games, W, D, L, Win %`), then the one row inside that table whose anchor `href` is exactly `/coaches/josh-carr-243`, and reads each value by header name. It refuses (never guesses) when there is no such table, more than one, no such row, more than one, or the row has the wrong number of cells. It therefore cannot read the 2000-2010 *player* row or the 2004 row of another table. Test: `tests/issue333-coach-row-selector.test.ts`, 12 cases (good fixture; player-row decoy; reordered columns; mismatching values; W/D/L swapped; ambiguous row; ambiguous table; absent row; absent table or renamed caption; wrong cell count; look-alike href; and the markup the real `ClubCoachRecords` component server-renders), run before the probe: 12 passed. The probe also ran the selector's built-in self-test as its first act, before reading any key or creating any token.

**Authority and handling (all kept).** One `kind='beta'` claim, beta admission only (no admin claim, no impersonation), minted with `signClaim` inside one process on the production host from the serving process's own `AFLDB_SESSION_SECRET` and `AFLDB_BETA_EPOCH` (those two keys only), held in memory, never printed, never in argv, no cookie file, sent only to `beta.afldb.com` over TLS, no redirect followed, no loopback request, no dependence on any `x-afldb-*` header, no renewal. Subject `issue333-readonly-probe-20261104-r2`, **created 2026-11-04T05:34:08.102Z, expires 05:40:08Z (6 minutes)**, created only after the selector and the request limits had been validated. Limits in force: at most 10 GETs, at least 5 s between starts (scheduled 5.5 s), 15 s request timeout, 2 minute overall deadline, stop immediately on the expected row. The three non-secret files were copied to the ops workspace `in/` and hash-compared with the local copies (selector `af4dc158...c440`, probe `0d83e65c...4812`, wrapper `12014cab...d4b5`); the ops checkout stayed clean (0 status lines).

**Result: the expected row was observed on request 1 of a permitted 10, and the probe stopped immediately.** `GET https://beta.afldb.com/clubs/port-adelaide`, started 2026-11-04T05:34:08.107Z, received 05:34:08.204Z (97 ms), response `Date: Wed, 04 Nov 2026 05:34:08 GMT`:

| Item | Value |
|---|---|
| HTTP status | 200 |
| `x-nextjs-cache` / `x-nextjs-prerender` | `HIT` / `1` |
| `cache-control` | `s-maxage=86400, stale-while-revalidate=31449600` |
| `cf-cache-status` | `DYNAMIC` |
| Body | 395,385 bytes, sha256 `11e26492...87b0` |
| Coaching table headers | `Coach, Span, Games, W, D, L, Win %` |
| **Extracted row** | **`Josh Carr / 2026 / 23 / 7 / 0 / 16 / 30.4`**: Josh Carr, 2026, 23 games, 7 wins, 0 draws, 16 losses (every compared column equal to the expectation) |

Evidence: `prod-apply/visibility-beta-probe-r2-20261104.json` (one request record; no cookie or key; searched). Total public GETs of this probe: **1**. The probe process exited 0 at 05:34:08Z; the token expired at 05:40:08Z and nothing was minted afterwards. (Body sizes here are bytes; the first probe's sizes in section 8 were JavaScript string lengths, so the two series are not comparable.)

**Preserved disclosures (unchanged by this probe).**
1. The first probe's selectors failed (they read the 2000-2010 player row and expected W/D/L in separate cells), and it sent **1,680 public and 80 loopback GETs, more than the gentle pacing intended**, because its stop condition depended on headers the server never sends (section 8). The -r2 probe made 1 GET.
2. **The exact ISR regeneration times are unknown.** The first probe bounds each only between the last `STALE` and the first fresh response of that page (about 1.7 s for `/coaches`, 1.9 s for `/clubs/carlton`; for `/clubs/port-adelaide` between 04:24:35.801Z and 04:24:37.414Z on body-growth evidence). Nothing here is a visibility deadline.
3. **Worker coverage is not demonstrated.** No response in either probe could be attributed to a worker, and this probe's single response does not say which worker served it. The alternating body-size variants of the first probe are consistent with two worker caches but are an inference from byte counts and are **not** claimed as proof. The owner accepted this as a disclosed limitation.
4. The O1 and O2 outcomes (sections 3 and 4), the original evidence and the recovery limits (section 7) are unchanged.

**Resolution of ISSUE-333.** On the owner's amended criterion every item is met: owner approval of plan `4de5368c...515e`; one COMMITTED_VERIFIED apply with `state` PLANNED RESULT PRESENT; the read-only 2026 count of 436; and the corrected figures observed through the public routes (`/coaches` first seen 04:23:58.810Z, `/clubs/carlton` 04:24:50.328Z, `/coaches/josh-carr-243` 04:24:09.884Z and `/coaches/josh-fraser-293` 04:24:22.817Z, each as a first-seen time and not a regeneration time, and the `/clubs/port-adelaide` coaching row at 05:34:08.204Z). **ISSUE-333 is resolved 2026-11-04.** Not done and not authorised by this closure: any tracing setting, restart, deployment, production data write, provider request, timer or setting change, WSL access or cleanup. ISSUE-332's future obligations (C6 to C9 and D-316-5 to D-316-11 with their gates) are unchanged and it remains open.
