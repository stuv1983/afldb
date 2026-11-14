# Remediation run 2, scope `admin`: A-05 and B-05

Branch `claude/rem2-admin-20261114` from `e8666c17`. Host workspace `/mnt/ssd/afldb-rem2-admin-20261114`, PostgreSQL port
55655 (loopback app port 55675 for the visual run only, stopped), databases `afldb_v2_rem2admin*_test`, template restored
from the approved snapshot (size and sha256 verified, ledger 118). Raw files below are committed LF copies (the host
originals contain no CR); host hashes in `SHA256SUMS.host`.

## A-05 (ISSUE-353 addendum): legacy round votes with `match_id` NULL — VALIDATED, FIXED

### What those rows are (contract)
- `brownlow_round_votes` is keyed `UNIQUE (season, player_id, round_number)` (migration 005); `match_id` was added nullable by
  migration 094 (`:56`, `:103`): "NULL = not resolved (no line-up row for the player in that round, or more than one); never
  guessed. Fuzzy matching by name, date or club is not used anywhere".
- The one attribution rule (094 s27.5, `src/db/queries/brownlow-round-vote-match-backfill.ts`, ISSUE-263 importer): the unique
  home-and-away match of that season and round in which the player has a `player_match_stats` row. No name, date, club or ordering.
- Snapshot (`a05-measure.txt`): 330,383 round rows, **9,522 with NULL `match_id`, all season 2026** (the 2026 backfill is excluded
  by D-V2-BROWNLOW-MATCH-BACKFILL-1; `docs/v2/brownlow-round-vote-match-backfill-2026-10-20.md`). Of these **621 are positive**, 0
  are NULL-vote, and **all 621 resolve to exactly one home-and-away line-up row** (0 ambiguous, 0 with no line-up row). So they are
  season + round + player keyed, attributable by the existing rule, and a removal of that line-up row would orphan them.
  The mirror `player_match_stats.brownlow_votes` is NULL ("not recorded") for all of 2026, so the review's suggested mirror test
  alone would not have protected them.

### Fix (`143149ce`)
`matchSheetDependentsRefusalFor` also reads `brownlow_round_votes` rows with `match_id IS NULL`, `votes > 0`, the match's season,
`round_type = 'home_and_away'` and `round_number`, and the player's own id; they are reported as a distinct fact
("N Brownlow votes in round R with no match link (unresolved)") with the same "Resolve it in Brownlow administration" pointer.
Nothing is attributed, updated or written (source pin in the unit suite forbids INSERT/UPDATE/DELETE in the read); a zero or NULL
(not recorded) vote never blocks; `remove`, `club_change` and `return_to_source` share the helper.

### Newly protected on the snapshot (`a05-measure.txt`)
695,499 line-up rows. Already protected by `match_id`: 22,239. **Newly protected by the NULL-match rule: 621 line-up rows (all 2026).**
Not protected, by decision: a positive mirror alone, **1,247 line-up rows, all 1931-1934** (324, 294, 306, 323) where round facts are not held.
Reason: the Match Sheet does not write the mirror (ISSUE-155 s27.15), Brownlow administration has no round facts for those seasons, so
a refusal would name a place where it can never be cleared. Owner decision O-A05-1 below.

### Tests (`tests/match-sheet.test.ts` unit, `tests/integration/data-editor.test.ts` integration), red then green
- Red on the unfixed `src` (`a05-red.txt`): unit "refuses a positive round vote that has no match link" received the text without the
  NULL-match player; source pin received `''`; integration "refuses removing or re-clubbing a player whose only vote is a NULL-match_id
  round row" failed `AssertionError: expected true to be false` (the removal succeeded).
- Green (`a05-green.txt`): unit 6 passed (the ISSUE-353 group); integration ISSUE-353 group 7 passed. Controls: zero, NULL-vote and
  other-round NULL rows do not block; the unlinked row is unchanged after the refusal; dependent-free players remain removable.

## B-05 (ISSUE-362 addendum): admin below the current epoch — VALIDATED, FIXED (by a sign-in-page path)

### Contract
`src/middleware.ts` (comment at the beta gate), `src/lib/auth/session.ts` `setAdminSessionCookie`, ISSUE-362 SEC-2 and
`docs/admin-and-beta.md` s3: admin claims are minted at the epoch current at sign-in and held to it **only at the beta door**;
`/admin` never applies `minEpoch` (it re-checks the database session). So after a bump a below-epoch admin keeps `/admin` and is
sent to `/beta` on public pages; documented as "until they sign out and in again, or redeem a beta code".

### Fix (`cf8ec23a`)
`adminClaimBelowBetaEpoch()` (`session.ts`) is true only for a validly signed, unexpired admin claim with `epoch < betaEpoch()` while
the gate is on and the epoch is a valid integer. `src/app/admin/login/page.tsx` shows the sign-in form with a notice instead of
redirecting when `getAdminUser()` (the database session) is live and that helper is true; otherwise unchanged (redirect to `/admin`).
- Never re-minted from the old claim; the page imports nothing that signs or mints. The only way to a current cookie is `adminLogin`
  (password + TOTP + new session row), unchanged.
- The door is unchanged: a below-epoch claim still cannot pass it (loopback run proves it). B-01 unchanged: a malformed epoch offers
  nothing (helper false; the door 503s for everyone; signing in again would change nothing).
- No redirect loop: a current-epoch admin on `/admin/login` is still sent to `/admin`.

### Tests (`tests/auth.test.ts`), red then green
Red (`b05-red.txt`): 3 failed — `TypeError: adminClaimBelowBetaEpoch is not a function` (x2) and `NEXT_REDIRECT /admin` for the page.
Green (`b05-green.txt`): 223 passed. Cases: flag only for a valid below-epoch admin claim (not tampered / expired / beta-kind / no
cookie); nothing when the gate is off or the epoch malformed; form + reason for a live below-epoch session; redirect for a current-epoch
admin, an unset epoch and (plain form, no notice) a below-epoch claim whose database session is gone; the action source still does
verifyPassword + verifyTotpStep + issueLoginSessionInTransaction and the page has no minting call.

### Visual evidence (UI text added)
Declared before capture: viewports 1280x800 and 390x844; states: (1) signed-in admin below the current epoch on `/admin/login`
(notice + form), (2) signed-out control (plain form, no notice). Production build (`next build --webpack`, BUILD_ID
`qCfBXeDA9NXb3oVyQpcKY`, loopback, beta gate on) at `cf8ec23a`, real sign-in through the form at epoch 1, server restarted at
epoch 2 (`b05-e2e.txt`, `visual/phase1-results.json`, `visual/phase2-results.json`: 1 + 11 checks PASS, 0 FAIL). Sequence proven end to end:
epoch-1 admin passes the public door -> after the bump `/players` goes to `/beta?from=%2Fplayers`, `/admin` 200, `/admin/login`
shows notice + form -> fresh sign-in through the form -> `/players` 200 -> `/admin/login` redirects to `/admin`; signed-out
control keeps the plain form and the `/beta` redirect. Images: `visual/B05-reauth-{desktop,mobile}.png`,
`visual/B05-signedout-{desktop,mobile}.png`. Assessment (manual, separate from the automated checks): the notice is legible and
sits between the subtitle and the form at both sizes; no horizontal overflow (automated check); the full-page captures show the
fixed consent banner and the mobile bottom nav overlaid mid-page, which is a full-page-capture artefact of fixed elements, not layout.
The admin side navigation (with Sign out) appears around the form because the visitor is signed in; that is the existing admin layout.
Capture-script lesson recorded: the first attempts clicked the layout's Sign out button (first `button[type=submit]`); the final
script scopes the click to the form with the authenticator input. No product defect.

## Residuals and owner decisions
- **Old session row (LOW):** a fresh sign-in leaves the earlier `auth_sessions` row unrevoked until its 12 h expiry. Consequence: two
  live rows for one admin; the old cookie is overwritten in that browser, so only a copy elsewhere could use it. Protection: 12 h TTL;
  password change and deactivation revoke all sessions. Operator action: none. Alternative: revoke the prior row in the credential
  transaction (a change to `admin-credentials.ts`, outside this scope and a policy decision). Recommended: leave.
- **O-A05-1 (owner):** protect line-ups with a positive mirror and no round row (1,247, 1931-1934)? Options: (a) leave (recommended;
  no place to clear it), (b) refuse and add a clearing path first. Exact change for (b): one more `SELECT` on
  `player_match_stats.brownlow_votes > 0` in `matchSheetDependentsRefusalFor` plus an admin path that clears it.
- **Doc update needed (file not in this scope, `docs/admin-and-beta.md` s3 lines ~432-436):** replace "is sent to `/beta` on public pages
  until they sign out and in again, or redeem a beta code" with "... until they sign in again (the sign-in page shows the form to a
  signed-in admin whose cookie is below the current epoch) or redeem a beta code".
- **DEV `AFLDB_BETA_EPOCH` value: UNVERIFIED** (not read, by instruction). The release note should say: on any host whose epoch is above
  1, admins must sign in again once to browse public pages; production reads 1 (read-only check 2026-11-14), so no effect at deploy.
- **Scope note:** `src/lib/match-sheet-dependents.ts` (the pure refusal wording module for the same ISSUE-353 behaviour) is not in the
  P2-07 ownership list; edited because the new fact needs its own wording. No other scope owns it.

## Files changed (vs `e8666c17`)
`src/db/queries/match-sheet.ts`, `src/lib/match-sheet-dependents.ts`, `src/lib/auth/session.ts`, `src/app/admin/login/page.tsx`,
`tests/match-sheet.test.ts`, `tests/integration/data-editor.test.ts`, `tests/auth.test.ts`, and this directory.
