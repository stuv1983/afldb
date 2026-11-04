# ISSUE-333 (O1) and O2: production apply record (2026-11-04)

**Status: APPLIED AND VERIFIED (both). Public visibility PARTLY MEASURED (section 8); two specific criteria remain unmet, so ISSUE-333 stays open.** O1 (436 `match_coaches` rows) and O2 (36 `data_issues` resolutions) were each applied once on
production under the owner's consolidated approval and ended `COMMITTED_VERIFIED` with an independent `state` verdict `PLANNED RESULT PRESENT`. Nothing else was
changed: no push, deployment, restart, schema/grant/credential/timer/setting change, provider request, manual settle, WSL access or cleanup.
ISSUE-333 stays **open** on one specific limitation (section 6). Approval and plans: `docs/v2/issue333-o2-consolidated-approval-2026-11-04.md`.
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
| Time-to-visibility of the public coach and club pages measured per page and worker | **NOT met: unmeasured behind the beta gate (section 5)** |

Therefore ISSUE-333 is **not resolved**. The data defect is corrected and verified; the open remainder is the visibility measurement.

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

The token has expired. Completing (2) needs a new probe with a corrected row selector (and, for (1), either an owner-approved temporary `AFLDB_TRACE_REQUESTS=on` with a restart, or an owner-accepted statement that two-worker coverage is shown by the evidence above). Neither was authorised, so none was done.

## 9. The two modified `prod-plans` text files

`git status` showed `prod-plans/prod-plans.txt` and `prod-plans/prod-prep.txt` modified from before this work. Their working-tree bytes are LF with no CR and are **byte-identical to the committed blobs** (sha256 `cf118d805d7d54d5...` and `efc52b7d9efafcbe...`, equal to `SHA256SUMS`; `git diff` empty; blob `6f45063f` for prod-plans). The "modification" was a stale index stat entry (recorded size 3,367 bytes against 3,344 in the file), left by an earlier CRLF working copy. No retained change existed; `git add` refreshed the index entry and the status cleared with nothing staged. Nothing was discarded.
