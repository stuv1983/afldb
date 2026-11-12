# ISSUE-336/337/340/345 release: execution record (11–12 Nov 2026)

Contract: [issue336-337-340-345-release-approval-r2-2026-11-09.md](../../issue336-337-340-345-release-approval-r2-2026-11-09.md) sections 5 to 8, with the owner's acceptance amendment **D4-A** (below).

**Outcome: ACCEPTED on 12 Nov 2026, under the owner's re-approved verification window (11:00–14:00 AEDT).** Production serves
`c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` (revision `c1c4b22ee15007111eab66f6d354e0b9ecbb2ade`, BUILD_ID `bTVyci1eHVcKvSKDVZl_x`).
The only rollback target is still `0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN`.

**The original acceptance deadline was missed.** D3c, D4-A, D4-P and D4-V all passed within 2 minutes of the restart on 11 Nov, but the owner's D4-O
signed-in checks were not completed by 18:08:51 AEDT. The r2 rule ("D4 not complete and passing within 60 minutes of D3b: recover") was not acted on:
recovery R3 needs the owner's restart, and none was given. The release kept serving overnight. The owner then approved a new verification and
acceptance window. Every check was re-run in that window, and the owner's D4-O checks are recorded as **late evidence, not as meeting the original deadline**.

## Approvals as received

- **OD-1 (owner, 11 Nov):** window 15:30–18:30 AEDT on 2026-11-11. Fast-forward the production checkout to R, build with the off-host typecheck and
  unchanged guards, promote and restart per r2 §§5–8. Sole rollback target `0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN`. The owner runs sudo, the restart and
  the D4-O checks; Claude runs the rest as `arm` without sudo. No schema migration, database write, D-336-2/D-336-3 operation, timer/settings/`.env`
  change, Brownlow operation or manual settle. ISSUE-344 is outside this release.
- **D4-A (owner, 11 Nov, before D3a):** production runs with `AFLDB_BETA_GATE=on`, so r2 §7's three anonymous loopback `200` GETs cannot pass.
  - Keep `verify NEW_ID`, the NEW_SERVING probe and both bundle-literal checks.
  - The three anonymous paths (`/draft`, `/draft/2025`, `/draft/2014?view=rookie`) must each return the 307 beta-gate redirect. The D2 boot smoke
    (`/draft` 200 under a beta claim) is supporting evidence.
  - **D4-P:** after the restart, authenticated 200s and rendered-page checks for the three paths on the live public site, through the approved
    headed Playwright runner with normal sign-in and a dedicated session. Desktop 1280-wide and mobile 390-wide screenshots are D4-V. Verify category
    separation, category-specific pick numbering and no page errors.
  - Authenticated acceptance must be ready before D3a. The beta gate stays on. D4-P, D4-V and D4-O within 60 minutes of D3b and before 18:30 AEDT.
  - The application revision is unchanged.
- **New window (owner, 12 Nov):** 11:00–14:00 AEDT on 2026-11-12, for verification and acceptance of the already deployed release. Recheck identity,
  health, D3c, D4-A, D4-P and D4-V. Record the owner's 10:30 AEDT admin sign-in and sign-out as late D4-O evidence; the temporary-password check was not
  exercised. No additional deployment, restart, rollback, database write or configuration change.

## Transport

- Each production phase ran as one Windows OpenSSH session (`ssh.exe -o BatchMode=yes afldb 'bash -s' < run-*.sh`), each script being `vars.sh`
  followed by the phase block (`scripts/`). Git Bash's own `ssh` is refused (`Permission denied (publickey)`).
- The first P-A attempt and the first 12 Nov probe failed with `Permission denied (publickey)` because the workstation ssh-agent had no key loaded.
  Nothing ran on production in either attempt; the owner reloaded the key each time.
- D2 ran in tmux session `i336d2` on production (`/home/arm/i336-rel-d2-run.sh`, wrapper log `/home/arm/i336-rel-d2-wrapper-20261111T051033Z.log`).
- The headed runner ran on the workstation with a portable Node v22.23.2 (official zip, SHA-256 checked against `SHASUMS256.txt`) and the repository's
  Playwright 1.62.1 (`D:\dev\afldb\node_modules`), whose Chromium 1234 was installed with `playwright-core install chromium`. The workstation had no Node.

## Results

| Step | Time | Result |
|---|---|---|
| W0 | 11 Nov 15:42:55 AEDT | **PASS**: `STATIC DELTA CHECK PASS r2` (37 enumerated non-documentation files ship, 16 application source files; ISSUE-344's 4 source files are after R and not shipped; build inputs identical) |
| P-A | 16:09:34–16:09:41 | **PASS**. Details below |
| D0 | 16:10 | **PASS**: `origin/main` = PKG `12aa6e29d51099eb6d3fbc901bbe488c5dbd7ab3`; the `f32d44f0..c1c4b22e` range was reviewed and is the r2 package's |
| D1 | 16:10:03–16:10:09 | **PASS**: fetch `f32d44f0..12aa6e29`; STATIC DELTA CHECK PASS on production; fast-forward to R; HEAD = R, clean; STATUS PASS; STATE OLD_SERVING |
| D2 | 16:10:33–16:15:07 (tmux) | **PASS**. Details below |
| Gate probe | 16:18 | `.env` has `AFLDB_BETA_GATE=on` (count only); anonymous loopback `/draft`, `/draft/2025`, `/draft/2014?view=rookie` → 307 to `https://beta.afldb.com/beta?from=…`. Stopped for the owner; D4-A approved |
| D4-P readiness | 16:37–16:41:19 | Attempt 1 `validate-1` PASS 6/6 (16:39:16), closed for a runner fix (production sends no `x-afldb-build`); attempt 2 `validate-1` **PASS 6/6** at 16:41:19 |
| D3a | 16:41:37–16:41:42 | **PASS**: OLD_SERVING → `promote` → NEW_SELECTED_OLD_RUNNING; `previous` = OLD_ID |
| D3b (owner) | 17:08:51 | `sudo systemctl restart afldb`, returned without error |
| D3c | 17:09:28–17:09:32 | **PASS**. Details below |
| D4-A automated | 17:09:39 | **PASS** |
| D4-P / D4-V | 17:09:46–17:10:16 | **PASS 81/81**, 24 screenshots, HTTP smoke 36 routes 0 error markers |
| D4-O | by 18:08:51 | **not completed**: deadline missed (see above) |
| Recheck (new window) | 12 Nov 11:27:05 AEDT | identity unchanged, NEW_SERVING, overnight settle success. Details below |
| D3c (re-run) | 11:27:20 | **PASS** |
| D4-A automated (re-run) | 11:27:28 | **PASS** |
| D4-P / D4-V (re-run) | 11:52:36–11:53:06 | `validate-1` **PASS 6/6**; `accept-1` **PASS 81/81**, 24 screenshots, HTTP smoke 0 error markers |
| D4-O (owner, late) | 12 Nov 10:30 AEDT | owner-reported: the admin sign-in and sign-out checks were done; temporary-password check **not exercised on production** (its runtime proof is the Linux qualification, r2 §3). Late evidence, not evidence that the original deadline was met |

**P-A details** (`output/pa-20261111.txt`):
- `current` = OLD_ID (revision `0f251c2d…`), `previous` = OLD_PREV `a0b1080f5b98-B8kdpO6PO1tUCHus0j1za`; checkout `f32d44f0`; STATUS PASS.
- VERIFY PASS of OLD_ID (1,397 server-output files differ: ISR, allowed); STATE OLD_SERVING, MainPID 3427584.
- MemAvailable 2,762 MB; free disk 49,146,028 KB. Match timer next `Thu 2026-11-12 05:05:15 AEDT`; no afldb cron entries; tmux present; NEWFILE absent.

**D2 details** (`output/d2-and-gate-probe-20261111.txt`):
- Admission MemAvailable 2,773 MB of 3,915 MB, swap 0, free disk 46.9 GB. `npm ci` 16 s (min 1,893 MB, peak RSS 912 MB); build 229 s (min 1,189 MB, peak RSS 1,738 MB).
- Candidate passed V1–V5. Boot smoke on 127.0.0.1:3199 with a beta claim: health ok, `_buildManifest.js` 200, CSS 200, `/` `/players` `/clubs` `/seasons` `/draft` all 200.
- **`RELEASE READY c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`** (12,997 files, manifest `4437e7d6eebf…`); VERIFY PASS; links unmoved; OLD_SERVING.

**D3c details** (`output/d3c-d4-20261111.txt`):
- `POST-INSTALL CHECK PASS`: STATUS PASS; health ok through loopback and `https://beta.afldb.com`; the new build's `_buildManifest.js` 200 and the old one's 404
  (loopback, public, and cache-busted public with `cf-cache-status BYPASS`); 8 served assets byte-identical to the release's files; `/api/admin/email-intake` 410.
- Journal: start line `serving build bTVyci1eHVcKvSKDVZl_x release c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x revision c1c4b22ee150…` since 17:09:01 AEDT; 0 error lines; NRestarts 0.
- STATE NEW_SERVING, MainPID 3666648. `AFLDB_SETTLE_TRIGGER=systemd` count 1.
- `c5-observe timer PASS`: match timer enabled and active, next `Thu 2026-11-12 05:05:15 AEDT` (unchanged from P-A); Brownlow and AFL Tables timers disabled and inactive; no settle process; setting still true.

**D4-A automated details:** VERIFY PASS (12,997 files); NEW_SERVING; `Draft categories` and `Intl Schol` present in the new server bundle; the three anonymous
paths each `307 https://beta.afldb.com/beta?from=…`; `AFLDB_BETA_GATE=on` count 1; D2's `RELEASE READY` and `/draft 200 (beta claim)` lines found.

**D4-P / D4-V details** (`browser-20261111/`, `browser-20261112/`):
- Runner `scripts/prod-accept-headed.cjs`, derived from the DEV-approved `dev-deploy-20261106/runners/dev-accept-headed.cjs`. Changes: `BASE` required
  (`https://beta.afldb.com`); desktop 1280×800 (r2 §7); a `/draft/2014?view=rookie` page with its own check and screenshot; `accept` first confirms
  the new build serves (`/_next/static/bTVyci1eHVcKvSKDVZl_x/_buildManifest.js` 200, the `post-install-check` signal); `EXPECT_ALL_2021=141`, from
  production's draft export. Sign-in, in-memory session handling and every other check are unchanged. Cookie values were never read or stored.
- Sign-in: 11 Nov through `/beta` (cookie `afldb_beta`); 12 Nov through `/admin/login` (cookie `afldb_admin`). Both are the site's normal flows.
- Both runs: `/draft`, `/draft/2025`, `/draft/2014?view=rookie` 200 at 1280×800 and 390×844, no horizontal overflow, no page errors.
  Categories separated (2025 All grouped, each row labelled by category); 2014 Rookie: Rookie tab current, 50 rows on page 1 of 53, numbered within the
  Rookie draft from Pick 1 (Pick 3 has no row: a numbering gap in the data, not a release effect); 2025 Rookie and National each start at Pick 1;
  Father–Son, trades unnumbered, category pick sort, club filter, pagination, empty states, legacy `?type=Rookie`, player-page label, and the ISSUE-337
  Jake Long searches (space, NBSP, lower case) all pass.
- HTTP smoke (36 routes, authenticated): 0 error markers; the three Jake Long queries `jake_rows=2 empty_state=0`. Non-200s: `/seasons/2027`,
  `/honour-teams` (no index page) and `/sitemap.xml` (withheld under the beta gate) 404; `/advanced-search` 308. `/grid-solver` and `/admin` are 307
  with the beta session and 200 with the admin session. None of these routes changed in `f32d44f0..c1c4b22e`.
- Screenshots were inspected: the draft index states categories per year; 2014 Rookie and 2025 All render as above on both widths.
- `browser-20261111-attempt1/` is the closed first session (validate only).

**Recheck in the new window** (`output/recheck-probe-20261112.txt`, `output/d3c-d4-20261112.txt`):
- STATE NEW_SERVING; `current` = NEW_ID, `previous` = OLD_ID; MainPID 3666648 since 17:09:01 AEDT 11 Nov, NRestarts 0; 0 journal error lines.
- Production checkout HEAD = R, clean. `AFLDB_BETA_GATE=on` count 1.
- **The first nightly under the new release:** `afldb-settle-afl-api.service` 12 Nov 05:05:45–05:05:47 AEDT, `AFLDB_SETTLE_SUCCESS label=afl-api-2027-2026-11-11-180546`, Result success, exit 0. Next run `Fri 2026-11-13 05:13:06 AEDT`.
- The D3c journal check was re-anchored from "10 minutes ago" to the service start (`--since '2026-11-11 17:09:00'`); nothing else in D3c or D4-A changed.

## Not done (scope)

No schema migration, database write, D-336-2/D-336-3 step, timer, setting or `.env` change, Brownlow step, manual settle, rollback or second restart.
ISSUE-344 is not in this release.

## Files

- `output/`: the console output of every phase, unedited (W0's three lines copied from the session transcript).
- `scripts/`: `vars.sh` and each phase block as run; `recheck-probe-1112.sh`; `prod-accept-headed.cjs`.
- `browser-20261111/`, `browser-20261112/`: `auth.json`, `validate-1.json`, `accept-1.json`, `smoke-1.txt`, `screens-1/` (24 images), `runner-console.txt`.
- `SHA256SUMS`: every file in this folder.
