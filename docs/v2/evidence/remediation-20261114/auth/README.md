# Remediation 2026-11-14 — auth scope (ISSUE-362 SEC-1/SEC-2, ISSUE-364 lint)

Branch `claude/rem-auth-20261114` (base `5035ed96`). Host workspace
`/mnt/ssd/afldb-rem-auth-20261114` (checkout `cand`, isolated Caddy binaries `caddy-bin/`, probe output `probe-out/`,
raw logs `evidence-raw/`). No database was needed (no PostgreSQL cluster started, port 55618 unused); every listener was
an isolated Caddy on 127.0.0.1:3410/3412 and a Node stub on 127.0.0.1:3411, all stopped. Production and DEV were not
read. The DEV host's live Caddy admin endpoint (127.0.0.1:2019) was never contacted: every Caddy run used a config
whose adapted JSON has `"admin":{"disabled":true}` (the probes refuse to start otherwise and print the proof), and
only `adapt`, `validate` and `run --config` were used.

## Binaries (user-local, nothing installed)

| Binary | Version | sha256 |
|---|---|---|
| `caddy-bin/caddy-2.11.4` (production's version) | v2.11.4 h1:XKxkMTgNSizEvKG6QHue6cAsFOteU2qA61w2tKkCWi0= | `b7105518e3ed1c0761f232e44fc09345535533c9cb0abf0e12809416c7ac64d9` (tarball sha512 checked against the release's `caddy_2.11.4_checksums.txt`) |
| `caddy-bin/caddy-system` (copy of the host's `/usr/bin/caddy`, the review's version) | v2.11.9 | `a563843e11cbce39c557bd429ebb787d56f49d51d9bbb3292cd9b36b37a60cdf` |

## SEC-1 — Caddy access logs record tokens (VALIDATED, AMENDED: two further paths found)

Validated on both versions with `probes/caddy-redaction-probe.sh` (a sed-rewritten copy of the real
`deploy/Caddyfile.production` in front of a stub upstream; probe secrets are fake sentinels). Unfixed file:
`raw/caddy-prod/probe-out-before-*.txt` — the magic-link token, the invite token, the search text, a Referer carrying the
invite token and a Referer carrying a search query are all in `afldb-access.log`, the apex query in `afldb-apex.log`.

Amendments to the review:

1. **Referer** is logged in full. Browsers send the full same-origin URL on every asset request the invite page makes, so
   `/_next/static/...` requests logged `Referer: https://beta.afldb.com/admin/invite/<token>`. Not in the review.
2. **Caddy's default log (stderr, so the journal) also carries the URI.** When the upstream is down (every release
   restart) Caddy writes an ERROR record containing the whole request (`"uri":"/beta/verify?token=..."`,
   logger `http.log.error.log0`); that never passes through the per-site `log`. Reproduced on 2.11.4 and 2.11.9
   (`before-*` stderr). Likewise the `www` redirect block, which has no `log`, is written to the default log.
3. The review cites `deploy/Caddyfile.production:194-201` for the apex block; it is lines 198-205 at the reviewed revision.
   The apex proxies no token route, but its query strings were logged; it shares the fix so every log keeps one policy.

Fix (`db9f07c2`): one `(afldb_log_format)` snippet — a `format filter` wrapping `json` with `request>uri multi_regexp`
(`^/admin/invite/[^/?#]+` -> `/admin/invite/REDACTED`; `\?.*$` -> empty) and `request>headers>Referer regexp`
(`^(https?://[^/?#]+).*$` -> origin + `/`) — imported by every site `log` and by a new global `log` (the default log).
The snippet is defined before the global block because a global block cannot import a later snippet (`File to import not
found` otherwise; seen during development). Both Caddyfiles carry it; the false comments are replaced.
`format filter`, `multi_regexp`, `regexp` exist in 2.11.4 (`caddy list-modules`, and the runs below are 2.11.4).

Proof (after, both versions): `raw/caddy-prod/probe-out-after-*.txt` — every sentinel count is 0 in both site logs
and in Caddy's stderr, including the upstream-down error record (`"uri":"/beta/verify"`); logged URIs are
`/beta/verify`, `/admin/invite/REDACTED`, `/search`; Referer is `https://beta.afldb.com/`; Cookie stays `REDACTED`.
Routing unchanged: `raw/caddy-prod/routing-{before,after}-*.txt` (status line, headers minus Date, body sha256 for 15
requests, including forged `X-Forwarded-For`/`X-Real-IP`/`Forwarded` handling, health `no-store`, apex static/404, the
32 KB early-access cap (413), `www` 301 redirect and the 502) are byte-identical on 2.11.4 and 2.11.9
(`diff` exit 0). `caddy adapt` of the unmodified file: rc 0 on both versions (only the existing "Unnecessary header_up"
warnings). `caddy validate` of the rewritten copy: `Valid configuration` on both. Development file: same result
(`raw/caddy-dev/`). The stub saw the unmodified request line (`/beta/verify?token=...`) upstream: only the log changed.
Hashes of the inputs: `raw/sha256-inputs-and-binaries.txt`; `Caddyfile.production` after = `89145cbd…55e3`,
`Caddyfile` after = `e3ec57e7…86e5`.

Residuals (not fixed, stated): response `Location` headers are still logged (`resp_headers`); the app only redirects
to `/beta?from=<pathname>` and `/`, and the `www` redirect repeats the query of a request that never reached the app.
Log files written before the install still contain tokens (see owner decision O-1). The app itself (journal) is not
covered: with no SMTP relay it prints the magic link (`docs/admin-and-beta.md` §3) — out of scope, existing documented behaviour.

Test: `tests/settle-season-revalidation.test.ts` (the existing Caddyfile source-contract home), 3 `it.each` x 2 files:
the snippet exists with the rules, every `log` block and the global default log import it, and the false claims are gone.
Red on `5035ed96` code: 6 failures (`expected '' to contain 'format filter'`, `not to match /^\s*format json\s*$/m`,
`not to match /(Query strings stay out of the logs|Do not log query strings):/`) — `raw/vitest/red-sec1-sec2-unfixed.txt`.

## SEC-2 — admin claim passes the beta gate without epoch (VALIDATED)

`src/middleware.ts` verified the admin cookie with no `minEpoch`, and `setAdminSessionCookie` always minted `epoch: 1`
(`session.ts`), so the kill switch never reached it. Fix (`e6c2910c`): mint at `betaEpoch()` and verify with
`{ kind: 'admin', minEpoch }` at the beta gate **only** (the `/admin` door, `adminCookieToken`, `destroyAdminSession` are
unchanged, so `/admin` keeps working on the database session). Chosen over shortening the TTL (does not honour the
kill switch) and over a DB check (middleware is edge, no DB). Effect and residual:

- With `AFLDB_BETA_EPOCH` unset/1 nothing changes (existing epoch-1 cookies still pass).
- After a bump, an admin holding a pre-bump cookie is **not** logged out: `/admin` and `/admin/login` work (login
  redirects an authenticated admin to `/admin`; `/beta` is a public path), there is no redirect loop. On public pages
  they are sent to `/beta` until they sign out and in again (that re-mints at the new epoch) or redeem a beta code. So
  every admin must re-authenticate once **only to regain public-page access through the admin claim**.
- Residual (documented in the middleware comment and `docs/admin-and-beta.md`): within one epoch the beta gate cannot see
  an individual admin revocation; the claim opens public pages (nothing under `/admin`) until it expires, at most 12 h.
  To cut it sooner bump `AFLDB_BETA_EPOCH` (also drops beta admissions) or rotate `AFLDB_SESSION_SECRET` (drops all cookies).
- No Next 16 middleware rename (`middleware.ts` kept). Edge-safe: only `tokens.ts` helpers.
- Local tools that mint admin claims (`tools/v2/*.mts`) still mint `epoch: 1`; only relevant to a local run with a
  non-default `AFLDB_BETA_EPOCH`. Not changed.

Tests: `tests/auth.test.ts` new describe (6 tests; the `next/headers` mock gained a `set` that records cookies).
Red on unfixed source: `expected 200 to be 307` (stale admin claim admitted after the bump) and `expected null not
to be null` (new cookie not at the current epoch); the other four (current-epoch admitted, legacy cookie with unset epoch
admitted, `/admin` + `/admin/login` + `/beta` reachable, unset epoch mints 1) pass before and after as regression guards.

## ISSUE-364 lint

Source of the numbers: the review's `evidence/lint.json` (607 errors / 149 warnings): `issues/` 226, `docs/v2` 37 (all under
`docs/v2/evidence/`), `.phaneslight` 12, `src` 17, `tests` 276, `tools` 39.

- `eslint.config.mjs` ignores `issues/**` and `docs/**/evidence/**` (archived run evidence, kept byte-for-byte; 263 errors).
- `src/`: 17 errors listed (all in `src/`): eleven `react-hooks/set-state-in-effect` (`AdminNav`, `AdminSection`,
  `ClearTelemetryForm`, `SearchPlaceholderSettings` x2, `CoachOpponentHistoryClient`, `ConsentBanner`, `PlayerPicker`,
  `ReorderableSections`, `SearchBox` x2), five `no-explicit-any` (`SortableTable.tsx:19`, `lib/sorting.ts:9,10`,
  `db/queries/data-edits.ts:265,270`), one `react/no-unescaped-entities` (`NlAnswerFeedbackControls.tsx:83`).
  Fixed (`b9eac839`): the three `any` in `sorting.ts`/`SortableTable.tsx` (`unknown`, explicit date narrowing; compare
  logic untouched, `tests/unit/sorting.test.ts` green) and the entity (`don&apos;t`, identical text). **Not fixed:**
  `data-edits.ts` (owned by the admin scope's ISSUE-354 change: left for post-merge) and the eleven effect-driven
  setState errors: each is a localStorage-hydration or fetch/loading pattern whose proper rewrite changes render
  timing, needs visual evidence, and no build or visual capture was available (`VISUAL: UNVERIFIED` if changed).
  They are carried in the baseline.
- `tools/dev/lint-gate.ts` (`npm run lint:gate`): ratchet against `tools/dev/lint-baseline.json` (340 errors, 44 files:
  `src` 13, `tests` 276, `tools` 39, `.phaneslight` 12). A new error, a new file or a count above baseline fails; paid-down
  debt is reported; `--update` rewrites the baseline. Not wired into `preflight`/`merge:ready` (documented read-only,
  no test or lint execution) — wiring it into the operator's pre-merge step is a decision for the owner (O-2).
  Tests: `tests/workflow-preflight.test.ts` (4, DB-free). End-to-end red/green on the host: see below.

## Final qualification

Qualified checkout: host `/mnt/ssd/afldb-rem-auth-20261114/cand`, branch `rem-auth`, `git rev-parse HEAD` =
`b9eac839fc3ae8d414621e7e6139c4ee9eb72db7` (the last code commit; the only later commit is this README and its raw
evidence), `git status --porcelain` empty before and after (`raw/final/00-checkout.txt`, `90-checkout-after.txt`). Run
inside one `flock /mnt/ssd/afldb-rem-20261114-heavy.lock nice -n 10 ionice -c3` acquisition by
`probes/final-qualification.sh` (host copy sha256 `aed1352aac08797f568d05f43b5c9c4e1d1a883261bdbc774b446662df780179`).
Host originals: `/mnt/ssd/afldb-rem-auth-20261114/evidence-raw/final/` with sha256 (ANSI codes stripped in the repo copy
of `20-vitest.txt`):
`00` acf5cb5b…, `10-typecheck` fcc2e30d…, `20-vitest` a5834e2c…, `30-lint-gate` 5d01aae3…, `31-lint-gate-red` ce8c5c4c…,
`90` 93716581….

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx next typegen && npx tsc --noEmit` | exit 0 |
| Unit suites touching the changed files | `npx vitest run` on 26 files (`auth`, `settle-season-revalidation`, `workflow-preflight`, `beta-verify`, `unit/sorting`, `deploy-release`, `nl-answer-feedback-boundary`, `nl-feedback`, the `admin-*` action suites and the other suites importing `lib/auth/session`; list in `probes/final-qualification.sh`) | 26 files, 1143 tests passed |
| Lint gate green | `npx tsx tools/dev/lint-gate.ts` | `340 error(s) now; baseline allows 340. PASSED`, exit 0 |
| Lint gate red | same, after appending `export const lintGateProbe: any = 1;` to `src/lib/sorting.ts` (reverted; status clean after) | `341 now; REGRESSION: src/lib/sorting.ts: @typescript-eslint/no-explicit-any 0 -> 1. FAILED`, exit 1 |
| SEC-1/SEC-2 red | the new tests against the unfixed sources (iteration checkout, before copying the fix) | 8 failed (`raw/vitest/red-sec1-sec2-unfixed.txt`) |
| SEC-1 real Caddy | `probes/caddy-redaction-probe.sh`, `caddy-dev-redaction-probe.sh`, 2.11.4 and 2.11.9, before and after | see SEC-1; outputs in `raw/caddy-*` |

Not run: the whole unit gate and any integration suite (no database involved; other scopes own them), `next build`
(not allowed), visual capture (no rendered change: `don&apos;t` renders identically; no hook change). Everything
recorded here came from scripts in my own host workspace; the Caddy/lint/final scripts on the host were hash-checked
against my local copies after the run-wide scratchpad notice. The Caddy probe runs predate that notice but read only my
workspace inputs and their outputs name my own labels and paths.

Environmental notes: the heavy lock was contended (the lint baseline run waited 23 min for it); `npm ci` ran once at
setup before the lock rule reached me (16 s). The host's Caddy admin API was never contacted (see top).

## Owner decisions

- **O-1 (old logs).** Installing the new Caddyfile does not rewrite existing `/var/log/caddy/afldb-access.log*` /
  `afldb-apex.log*` (up to 6 files, 20 MiB each, `caddy:caddy 600`), which hold magic-link tokens (single use, stored
  hashed by the app) and invite tokens (7-day validity) logged so far. Options: (a) leave them (root/caddy-only);
  (b) after install, roll and securely delete the pre-fix files once no longer needed for operations (recommended:
  invite tokens within validity are the only live credential; check `auth_invites` expiry first). Recovery: none needed
  for (a); (b) is irreversible by design.
- **O-2 (lint gate wiring).** Recommendation: run `npm run lint:gate` in the operator's pre-merge step beside the
  typecheck. Wiring it into `preflight`/`merge:ready` changes their read-only contract; not done.
- **O-3 (install).** Packet step, not executed here: back up `/etc/caddy/Caddyfile`; copy `deploy/Caddyfile.production`;
  `sudo caddy validate --config /etc/caddy/Caddyfile`; `sudo systemctl reload caddy` (no restart); verify with a request to
  `https://beta.afldb.com/beta/verify?token=PROBE` that the newest log line shows `"uri":"/beta/verify"`. Recovery: restore
  the backup and reload. Before deploying SEC-2 check whether production sets `AFLDB_BETA_EPOCH` above 1
  (`systemctl show afldb -p Environment` / the env file): if so every current admin must sign in again for public-page access.
