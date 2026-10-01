# AFLDB-ISSUE-232 — AFL API operational wiring: systemd timers, Brownlow scheduled settle and admin status

**Status:** Open. **Severity:** Medium. **Opened:** 2026-09-23 (ISSUE-228 §22.18 E items 2–3,
§22.20 rows 2–3 and part B). **This runbook:** created 2026-09-26 in the bulk successor pass on
`opus/afl-api-successors-229-234` (base `main` `2e587415`). Passes 1–2 are merged and on `main`
(DEV and PROD ran `1111ab19`, which contains them, for ISSUE-220). Pass 3 (§3b, 2026-10-01) was
made on `sonnet/issue-232` from `c64fade4`; it is implemented and DB-free validated, and pending
DEV operator acceptance (§7).

**Current state (2026-10-01, pass 3):** items 2–4 are implemented and DB-free validated. Item 1
(host installation) and item 4's visual acceptance are operator-run (§7) and not done on any host.
The DEV acceptance in §7 includes a mandatory dry-run rehearsal before the first applying run.

**State after pass 1:** **BLOCKED ON OPERATOR DECISION** (D-232-1, D-232-3). Item 4 (admin
status) is **IMPLEMENTED / NEEDS DEV OPERATOR ACCEPTANCE** (`VISUAL: UNVERIFIED`). Item 1 (host
installation) is operator-run and has not been done on any host.

**State after pass 2 (2026-09-26; since merged):**
- **Decisions recorded (operator, 2026-09-26):**
  - **D-232-1 = B.** The scheduled Brownlow wrapper passes `--use-fixture-identity`. This is the
    **operator-approved reversal of ISSUE-244 §40**, which kept the wrapper fail-closed
    ("ACCEPTABLE FAIL-CLOSED FOR F006").
  - **Ordering = O1.** The wrapper itself runs `--fixtures-only` acquire → fixtures settle →
    Brownlow acquire → Brownlow settle. It does not rely on the daily match timer or on systemd
    `After=`/`Requires=`.
  - **D-232-3 = KEEP.** No automatic `revalidateSeason()`, and no permanent
    `AFLDB_REVALIDATE_SECRET`/`URL` on any host in this pass.
- Items 2 + 3: **IMPLEMENTED / DB-FREE VALIDATED** (§3a). Not installed, not enabled, not run on
  any host.
- Item 4: unchanged, still `VISUAL: UNVERIFIED` until DEV deployment.
- Item 1: still operator-run (§7).

---

## 1. Scope items and where each stands

| # | Item | State | Remaining |
|---|---|---|---|
| 1 | Install and enable both AFL API timers (DEV, then production) | Not done; operator-run | §7 on DEV (with the §7 D rehearsal), then production |
| 2 | Brownlow wrapper `--use-fixture-identity` policy | **Implemented** (D-232-1 = B, §3a) | Nothing beyond item 1 |
| 3 | Match chain before Brownlow chain | **Implemented** (O1, §3a) | Nothing beyond item 1 |
| 4 | `/admin/current-season` shows the AFL API units | **Implemented** (§4; "not installed" state §3b) | DEV visual acceptance (§7 B) |
| 5 | Automatic `revalidateSeason()` after an AFL API settle | **Decided: keep** (D-232-3, §6); no change | None |
| — | "Start now" trigger for the AFL API units | Deferred (§5) | Not needed for scheduled operation |
| — | Unit credential boundary | **Fixed** (§3b) | Nothing beyond item 1 |

## 2. D-232-1 — the Brownlow wrapper flag (operator decision; reverses ISSUE-244 §40 if B)

Facts, from code (`tools/current-season/settle-afl-api-brownlow.ts:300-371`,
`src/lib/acquisition/afl-api-brownlow.ts:430-477`,
`src/lib/acquisition/afl-api-fixture-identity.ts:300-341`):
- A vote set resolves its `CD_M…` from a typed `staging.afl_api_match` row. That row exists only
  for a match the AFL API settle **plans**, meaning `afl_api`-owned or new. A match that merely
  corroborates an AFL Tables-owned row never gets one (ISSUE-244 F006 contract).
- Without the flag, if any vote set needs the fixture fallback, a `--dry-run`/`--apply` run
  throws `AflApiBrownlowFixtureIdentityRequiredError` **before its transaction opens**. It writes
  nothing and exits non-zero.
- With the flag, the fallback is SELECT-only. It reads the match family's spine head for that
  `CD_M`, re-parses it, and resolves `(season, home, away, exact venue-local date)` to an
  **existing** `matches` row. 0 rows → `unknown_match`, more than 1 → `fixture_identity_ambiguous`,
  no observation → `no_fixture_observation` → `unknown_match`. It never creates, re-owns or
  rewrites a match. The flag is consulted only for a vote set with no typed row, so
  `afl_api`-owned matches keep the provider-id-first path and its
  `provider_identity_contradiction` HALT.

| | **A — keep the wrapper fail-closed (ISSUE-244 §40 stands)** | **B — add `--use-fixture-identity` unconditionally to the wrapper's settle line** |
|---|---|---|
| Season whose matches are AFL Tables-owned (2026: all of them) | Every enabled firing (every 5 min) refuses before writing, exit 1, `AFLDB_SETTLE_FAILURE`, unit `failed`. The scheduled chain can never write a vote. The completed count stays an operator invocation with the flag, as it was for 2026. | Each vote set resolves by fixture identity to the AFL Tables-owned match. Votes apply to `brownlow_round_votes` through `applyCanonicalUnit()` only. The match row is untouched. |
| `afl_api`-owned or new match | Unchanged (typed row, provider-id path) | Unchanged (the flag is not consulted) |
| No fixture observation yet for a `CD_M` | Refuses (whole run) | That vote set is refused `unknown_match` and recorded as a data issue. Other sets apply. A re-settle after the observation exists fills it. |
| Ambiguous fixture identity (two canonical rows on one season/clubs/date) | Refuses (whole run) | That set is refused `fixture_identity_ambiguous`. Nothing is guessed. |
| Residual risk | None; the unit is simply inert | The fallback has no provider-id contradiction check of its own. It relies on the uniqueness it enforces (INFO, ISSUE-228 §22.20 B.4). |
| Record required | None | This runbook plus `issues.md`, recorded as the operator's reversal of ISSUE-244 §40 |

**Recommendation (unchanged from ISSUE-228 §22.20 B.5):** B, once timers are wired. It must be
the operator's decision. This pass did **not** edit `deploy/afldb-settle-afl-api-brownlow.sh`.

## 3. Item 3 — ordering the match chain before the Brownlow chain

Today the match timer runs daily at 05:00 and the Brownlow timer every 5 minutes, with no
ordering. Relying on the match chain to persist fixture observations is weaker than it looks:
- `afldb-settle-afl-api.sh` runs `settle-afl-api.ts … --require-complete-source`. An incomplete
  source (for example one unresolved player identity) rolls back the **whole** transaction, so
  no match-family observation from that night persists.
- The chain acquires only `CONCLUDED` matches.

Options:
- **O1 (recommended under B):** the Brownlow wrapper refreshes fixture identity itself as step 1.
  It runs `acquire-afl-api.ts --season <S> --fixtures-only`, then `settle-afl-api-fixtures.ts
  --label <L> --apply`, then the Brownlow acquisition and settle. The fixtures-only settle's
  only write is the match family's spine observation (`persistAflApiFixtureObservations()`). No
  CFS token is needed, and it has no ordering dependency on the match timer. Cost: one season-feed
  fetch and one `import_batches` row per firing, mostly head-touches. The unit's
  `ReadWritePaths` must add `data/sources/afl_api/fixtures`.
- **O2:** rely on the match timer, and document that the Brownlow window opens only after a
  clean nightly match settle. This is fragile, for the reason above.
- **O3:** systemd `After=`/`Requires=`. `After=` orders only jobs queued together; it cannot make
  a 5-minute timer wait for a daily one. Not useful.

Under A, none of this matters, because the Brownlow unit cannot write for an AFL Tables-owned
season. So O1 is implemented together with D-232-1 = B, not before it.

## 3a. Pass 2 — D-232-1 = B + O1, implemented

**Wrapper** `deploy/afldb-settle-afl-api-brownlow.sh`, one run, failing closed:

```
[1/4] acquire-afl-api.ts --season <S> --fixtures-only        -> fixtures_label (parsed from its own first line)
[2/4] settle-afl-api-fixtures.ts --label <fixtures_label> --apply
[3/4] acquire-afl-api-brownlow.ts --season <S>               -> label (parsed from its own first line)
[4/4] settle-afl-api-brownlow.ts --label <label> --apply --auto-apply --use-fixture-identity
```

Every handoff was proven before editing:

| Handoff | Evidence |
|---|---|
| Step 1 writes `data/sources/afl_api/fixtures/<label>/` | `acquire-afl-api.ts` `runAcquisition()` (`fixturesOnly ? 'fixtures' : 'matches'`) |
| Step 1's first line is `…, label <L> [--fixtures-only: …]`, and the wrapper's `sed` recovers `<L>` exactly, collision suffix included | new test in `tests/afl-api-match.test.ts` that runs the wrapper's own `sed` expression (read from the script) against the tool's own log |
| Step 2 reads `data/sources/afl_api/fixtures/<label>/`, re-verifies hashes, and refuses a non-`--fixtures-only` manifest | `settle-afl-api-fixtures.ts` `snapshotRootOf()`, `verifyManifest()` |
| Step 2's only write is the match-family spine observation plus its batch | `persistAflApiFixtureObservations()`; existing source-contract tests |
| Step 4 accepts `--use-fixture-identity` | `settle-afl-api-brownlow.ts` `KNOWN_FLAGS` |
| Labels never cross | `fixtures_label` vs `label`, separate captures, each checked non-empty |
| Failure propagation | `set -eu`; each acquire has an explicit `|| exit 1` that prints its output; the two settles run bare under `set -e`; the EXIT trap prints `AFLDB_SETTLE_FAILURE season=<S> exit=<n>`; `AFLDB_SETTLE_SUCCESS` only after step 4 |

**Defect found and fixed on the way (would have been a credential regression):**
`settle-afl-api-fixtures.ts` kept a private `loadEnv()` that ignored `AFLDB_SKIP_DOTENV`. Run
under the systemd wrapper, it would have reopened `.env` and restored every credential the unit's
`UnsetEnvironment=` strips (I244-F029). It now imports the shared `tools/current-season/load-env.ts`
and is in the F029 "one loader" source-contract list.

**Unit** `deploy/afldb-settle-afl-api-brownlow.service`: comments updated to the four-step chain
and the decisions. **`ReadWritePaths=` is unchanged, by evidence.** The existing grant is
`/home/arm/projects/afldb/data/sources/afl_api`, which already covers both `fixtures/<label>` and
`brownlow/<label>`. A narrower per-subtree grant would make the unit fail to start until each
directory existed. The old comment claiming the Brownlow grant "does not overlap" the match unit's
was wrong, and is corrected. No `After=`/`Requires=`/`Wants=` on the match unit was added.
`TimeoutStartSec=180` is unchanged (< the 5-minute period); watch the first DEV run's duration.

**Consequences the operator should know before enabling the timer:**
1. **Two switches now gate the Brownlow chain.** Steps 1–2 read the AFL API current-season
   ingestion switch (`site_settings`) as well as the Brownlow switches. With it off, step 1 refuses
   and the unit fails visibly. It never falls through to a Brownlow settle without fresh identity.
2. **Per firing:** one extra public season-feed GET, one `data/sources/afl_api/fixtures/<label>/`
   snapshot (the feed plus one `fixture.json` per CONCLUDED match), and one `import_batches` row,
   mostly head-touches. Every 5 minutes during the count window, that is about 12 snapshots and
   batches an hour. Retention/cleanup of `fixtures/` snapshots is not automated (the same as
   `matches/` and `brownlow/` today).
3. A fixture **build failure** in step 2 is logged and does not fail the run (the tool's
   established contract). That match's vote set then refuses `unknown_match` in step 4 and is
   recorded as a data issue, while the other sets apply.
4. Revalidation unchanged (D-232-3): the script calls nothing, and the unit still strips
   `AFLDB_REVALIDATE_SECRET`.

**Tests (DB-free):** `tests/afl-api-ingestion-safety.test.ts` gains 7 wrapper/unit source-contract
tests (step order, exactly four Node invocations, label handoffs, failure propagation, no
revalidation, no systemd ordering, the `ReadWritePaths=` coverage, the timeout bound) plus the
fixtures CLI in the F029 loader list. `tests/afl-api-match.test.ts` gains the label-parse handoff
test. `sh -n` on both wrappers: see the pass-2 validation.

## 3b. Pass 3 (2026-10-01) — pre-install audit and hardening

Audit of `main` `c64fade4`: D-232-1 = B, O1 and D-232-3 are intact in the wrapper, unit and CLIs;
`settle-afl-api-fixtures.ts` uses the shared loader; the panel is read-only and uses
`SETTLE_UNITS`/`SETTLE_BATCH_TOOLS`. Four things needed correcting before §7.

**1. Credential boundary (MED, fixed).** Both AFL API units' `UnsetEnvironment=` predated the
ISSUE-224/251 DSN census that ISSUE-220 brought into `afldb.service`. They let through
`AFLDB_TEST_IMPORT_`, `AFLDB_TEST_AUTH_`, `AFLDB_CODE_TEST_`, `AFLDB_CODE_TEST_IMPORT_`,
`AFLDB_DEV_IMPORT_`, `AFLDB_PROD_IMPORT_` and `AFLDB_PROD_AUTH_DATABASE_URL`, plus
`AFLDB_INTAKE_IMAP_USER`/`_PASSWORD` and `KALI_AFL_API_KEY`. No test covered the settle units'
lists. Now:
- each unit keeps exactly two DSNs, `DATABASE_URL` and `AFLDB_IMPORT_DATABASE_URL`, and denies
  every other `*_DATABASE_URL` `.env.example` defines, commented maintenance DSNs included;
- each denies every credential the chain does not use: session, SMTP user/password, e-mail
  intake secret, IMAP user/password, revalidation secret, Kali API key;
- non-secret settings are kept: the AFL API base URLs, the outbound User-Agent and, for the
  Brownlow unit, the deployment gate `AFLDB_AFL_API_BROWNLOW_ENABLED`;
- `tests/afl-api-ingestion-safety.test.ts` ("AFL API unit credential boundary") derives the DSN
  names and every credential-shaped name (`_SECRET`, `_PASSWORD`, `_API_KEY`, `_USER`) from
  `.env.example` on each run, so a future addition there fails until both units deny it. Against
  the pre-pass units it fails on 10 names each.

**Out of scope, recorded for a separate decision:** `deploy/afldb-settle-afltables.service` has the
same drift (no `AFLDB_TEST_IMPORT_`/`TEST_AUTH_`/`CODE_TEST_*`/`DEV_IMPORT_`/`PROD_IMPORT_`/
`PROD_AUTH_DATABASE_URL`, no IMAP or Kali names). It is installed on both hosts and is not an
ISSUE-232 unit, so it was not changed.

**2. Uninstalled units read as idle (fixed, item 4).** `systemctl show` on a unit that is not
installed exits 0 with `LoadState=not-found` and `ActiveState=inactive`; the panel showed "Idle
(inactive)". `settle-trigger.ts` now also requests `LoadState` and parses it into
`SettleUnitState.loadState`; `phase` is unchanged, so `startSettleRun()` (still the AFL Tables unit
only) and `SettleRunPanel` behave as before. The AFL API panel shows **"Not installed on this
host."** for `not-found`. Visual Evidence Mandate: declared `/admin/current-season`, 1280 px and
390 px, states not-installed / installed-idle / installed-failed; after apply
**`VISUAL: UNVERIFIED`** until §7 B.

**3. Documentation corrected** (this runbook, `docs/deployment.md` §7d,
`docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §14.7):
- Brownlow timer policy is **E1** (operator decision 2026-10-01; §7 C);
- only the environment gate is an early no-op; the open/close order is in §7 E;
- O1 does not depend on the daily match timer;
- the match chain is two Node steps, the Brownlow chain four;
- AFL API units are started with `sudo systemctl start …`. The polkit rule
  (`deploy/afldb-settle-afltables-trigger.rules`) lets `arm` start only
  `afldb-settle-afltables.service`, so `sudo -u arm systemctl start` for these units asks for
  authentication;
- the credential-boundary wording matches item 1.

**4. The match unit is not inert today.** `data/reference/seasons.json` still lists 2026 in
progress, so the unit does a full 2026 CONCLUDED acquire and auto-apply. DEV has no AFL Tables
timer; a 2026 match missing from `afldb_dev` would be inserted as an `afl_api`-owned match. That
would break ISSUE-233's zero-`afl_api`-owned DEV census and later trip its D-233-3 refusal. §7 D
therefore requires a dry-run rehearsal and halt criteria before the first applying run.

Validation: DB-free only (pass-3 report). No host, unit, `.env`, `site_settings` or database was
touched.

## 4. Item 4 — admin status (implemented this pass)

- **N** `src/app/admin/current-season/AflApiSettleUnitsPanel.tsx` is a server component with
  no client code, no action and no control. It renders the two AFL API rows of the existing
  `readSettleUnitTableStatus()` (`settle-status.ts`): the systemd state (phase, `ActiveState`,
  non-success `Result`, last finished), or its bounded unavailability reason, beside the newest
  `import_batches` row for that tool (batch id, status, snapshot label, season, completed,
  records read/rejected), or an alert if that read failed. Unit names come from `SETTLE_UNITS`,
  never a second copy. The AFL Tables row stays with `SettleRunPanel`.
- **M** `src/app/admin/current-season/page.tsx` reads `readSettleUnitTableStatus()` inside its
  own `try`, like the page's other reads, and renders the panel below `SettleRunPanel`.
- **Not added:** a counter projection for AFL API batches. `getLatestSettleRun()` still returns
  `counters: null` for the two `afl_api` tools (its documented follow-up), so no completeness
  verdict is shown for them.
- **Visual Evidence Mandate.** Declared before apply: `/admin/current-season`, desktop 1280 px and
  phone 390 px; states host-unprovisioned + no batch, unit readable + batch, batch read failing;
  no reference design; existing `section`/`table-wrap`/`mono` classes. After apply:
  **`VISUAL: UNVERIFIED`**. The page is Super Admin-gated and needs a database and systemd;
  Playwright capture was not attempted. Structural proof is 7 DB-free `renderToStaticMarkup` and
  source tests in `tests/admin-current-season-settle.test.ts`. **User eyeball request:** after the
  next DEV sync, open `/admin/current-season` as a Super Admin at both widths. Confirm the
  "AFL API scheduled settles" table appears below the AFL Tables panel, and shows each unit's
  systemd reason ("On-demand refresh is not enabled on this host." unless
  `AFLDB_SETTLE_TRIGGER=systemd`; with it, "Not installed on this host." until §7 C, since pass 3)
  and its latest batch. The exact checklist is §7 B.

## 5. The "start now" trigger (deferred, recorded)

`startSettleRun()` starts only `afldb-settle-afltables.service`, authorised by one polkit rule
scoped to one unit (`deploy/afldb-settle-afltables-trigger.rules`). Extending it means one more
rule per unit plus an action per unit. That widens the web service's host authority, needs its
own security review, and adds nothing to scheduled operation. It is not done. Revisit only if an
operator asks for on-demand AFL API runs.

## 6. D-232-3 — automatic `revalidateSeason()` after an AFL API settle (operator decision)

ISSUE-228 §22.8 B / §22.9: S8 deliberately kept `settle-afl-api.ts` free of revalidation. Its
unit strips `AFLDB_REVALIDATE_SECRET`, and the S9 smoke used a manual call ("reading 2").
- **Keep (today):** an unattended AFL API settle reaches `/seasons/<year>` only after the 1-hour
  ISR window. No code change.
- **Wire it ("reading 1"):** port `settle-afltables.ts`'s post-commit `maybeRevalidate()` shape
  into `settle-afl-api.ts`. It must be inert unless both `AFLDB_REVALIDATE_URL` (loopback) and
  `AFLDB_REVALIDATE_SECRET` are set. Also remove `AFLDB_REVALIDATE_SECRET` from the unit's
  `UnsetEnvironment=`, and install both variables **permanently** on the host (on DEV they have
  only ever been set for time-boxed tests, ISSUE-134 §10.5/§12.8). Reverses a recorded S8
  decision.

Nothing in the Brownlow path needs this: votes are not rendered through the season page's ISR.

## 7. DEV acceptance (operator-run; not executed)

DEV first; each part separately authorised; production only after DEV passes and operator
sign-off. **Not yet started:** the pass-3 changes (§3b) are not on DEV. DEV currently runs
`1111ab19`, whose unit files still carry the old deny list and whose panel still says "Idle" for an
uninstalled unit. Nothing in A–E may be run against that revision.

Accepted order:
1. The operator commits and merges the ISSUE-232 pass-3 changes.
2. Sync current `main` to DEV (`deploy/sync-dev.ps1`: build and restart).
3. **A**, read-only before-state, against the deployed source and the still-uninstalled AFL API
   units.
4. **B**, visual acceptance.
5. **C**, install the four unit files; no timer enabled.
6. **D1**, the mandatory match dry-run rehearsal.
7. Only if D1 proves zero canonical inserts and updates and a complete source: **D2–D4**, run the
   match service, then enable the match timer.
8. **E**, enable the Brownlow timer permanently, with `AFLDB_AFL_API_BROWNLOW_ENABLED` still unset,
   and prove the no-op path.

Run as `arm` in `~/projects/afldb` unless a line says `sudo`. Every check is names, counts or
states only; never print `.env` values.

**Brownlow timer policy (E1, operator decision 2026-10-01).** Once installed,
`afldb-settle-afl-api-brownlow.timer` stays **permanently enabled**. Outside the count window
`AFLDB_AFL_API_BROWNLOW_ENABLED` is unset (not `true`). The wrapper checks that first and exits 0
before reading `seasons.json`, the network or the database. Every firing is then a successful
no-op. It is not enabled "at the next count"; E2 (leave it disabled until then) is rejected.

### A. Read-only before-state

```bash
git rev-parse HEAD; git status --short | head
# the synced source must contain pass 3 (expect 1, 1, 1); otherwise STOP and sync first
grep -c 'AFLDB_PROD_AUTH_DATABASE_URL' deploy/afldb-settle-afl-api.service deploy/afldb-settle-afl-api-brownlow.service
grep -c "'--property=LoadState'" src/lib/acquisition/settle-trigger.ts
ls -l /etc/systemd/system/afldb-settle-afl-api* 2>&1
systemctl list-unit-files 'afldb-settle-afl-api*' --no-pager
systemctl list-timers --all --no-pager | grep -i afldb
systemctl show afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service -p Id,LoadState,ActiveState
test -x /home/arm/.nvm/versions/node/v22.23.2/bin/node && echo node-ok; test -x /usr/bin/python3 && echo py-ok
test -f node_modules/tsx/dist/cli.mjs && echo tsx-ok
ls -ld data/sources/afl_api data/sources/afl_api/* 2>&1
python3 -c "import json;print(json.load(open('data/reference/seasons.json'))['in_progress_seasons'])"
grep -c '^AFLDB_AFL_API_BROWNLOW_ENABLED=' .env; grep -c '^AFLDB_SETTLE_TRIGGER=systemd$' .env
# credential NAMES that would reach the units: expect exactly DATABASE_URL and AFLDB_IMPORT_DATABASE_URL
for u in afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service; do echo "== $u"
  comm -23 <(grep -oE '^[A-Z0-9_]+=' .env | tr -d = | sort -u) \
           <(sed -n 's/^UnsetEnvironment=//p' deploy/$u | tr ' ' '\n' | sort -u) \
    | grep -E 'DATABASE_URL|SECRET|PASSWORD|TOKEN|_KEY|_USER$'; done
( set -a; . ./.env; set +a; psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN READ ONLY;
SELECT current_database(), current_user;
SELECT key, value FROM site_settings
 WHERE key IN ('acquisition.afl_api_current_season_enabled','acquisition.afl_api_brownlow_enabled');
SELECT m.season, count(*) AS afl_api_owned FROM matches m JOIN sources s ON s.id = m.source_id
 WHERE s.key = 'afl_api' GROUP BY 1 ORDER BY 1;
SELECT count(*) AS matches_2026, count(*) FILTER (WHERE is_final) AS finals_2026 FROM matches WHERE season = 2026;
SELECT tool, count(*), max(id) AS latest_id, max(completed_at) AS latest_completed FROM import_batches
 WHERE tool IN ('settle-afl-api.ts','settle-afl-api-fixtures.ts','settle-afl-api-brownlow.ts') GROUP BY tool;
ROLLBACK;
SQL
)
```

Expected: no unit files or timers; `LoadState=not-found` for both; `afl_api_owned` returns no rows
(ISSUE-233 pass 5); `in_progress_seasons` is `[2026]`; Brownlow gate count 0. Record the outputs.

### B. `/admin/current-season` visual acceptance (item 4)

Super Admin, `http://10.0.40.100:8090/admin/current-season`, at about 1280 px and about 390 px:
- "AFL API scheduled settles" is the section directly after the AFL Tables settle panel;
- two rows, "Match and player statistics" (`afldb-settle-afl-api.service`) and "Brownlow votes"
  (`afldb-settle-afl-api-brownlow.service`);
- service column: "On-demand refresh is not enabled on this host." if `AFLDB_SETTLE_TRIGGER` is
  not `systemd`; otherwise, before C, **"Not installed on this host."** for each unit A showed as
  `LoadState=not-found`. "Idle" there means the deployed build predates pass 3: stop and re-sync;
- batch column: "Batch N, status …", "No batch recorded yet." or an alert line;
- no control in the section, no page-wide horizontal scroll. Console check, expect
  `[<AFL Tables heading>, 0, false]`:

```js
const s=[...document.querySelectorAll('section')].find(x=>x.querySelector('h2')?.textContent==='AFL API scheduled settles');
[s.previousElementSibling?.querySelector('h2')?.textContent, s.querySelectorAll('button,form,input,select,textarea').length, document.documentElement.scrollWidth>innerWidth]
```

Capture both widths. Item 4 stays `VISUAL: UNVERIFIED` until then.

### C. Install the units (no timer enabled yet)

```bash
sh -n deploy/afldb-settle-afl-api.sh && sh -n deploy/afldb-settle-afl-api-brownlow.sh && echo sh-ok
sudo install -m 0644 -o root -g root deploy/afldb-settle-afl-api.service deploy/afldb-settle-afl-api.timer \
  deploy/afldb-settle-afl-api-brownlow.service deploy/afldb-settle-afl-api-brownlow.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/afldb-settle-afl-api.service /etc/systemd/system/afldb-settle-afl-api-brownlow.service
sha256sum deploy/afldb-settle-afl-api*.service deploy/afldb-settle-afl-api*.timer /etc/systemd/system/afldb-settle-afl-api*
systemctl show afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service -p Id,LoadState,ActiveState,UnitFileState
```

Expected: repository and installed hashes pair up; both `LoadState=loaded`, `inactive`. Reload the
panel: both rows leave "Not installed" (when `AFLDB_SETTLE_TRIGGER=systemd`).

### D. Match unit: mandatory rehearsal, then the first observed run

**Do not start the match unit or enable its timer until D1 passes.** 2026 is still in progress
(§3b item 4). A new `afl_api`-owned canonical match on DEV would break ISSUE-233's
zero-`afl_api`-owned census and later trip its D-233-3 protection.

D0. The AFL API current-season switch must be enabled (A shows it). Changing it is a site-settings
change and needs its own approval.

D1. Rehearsal. The acquire writes snapshot files only; `--dry-run` rolls the settle back.

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
npx tsx tools/current-season/acquire-afl-api.ts --season 2026 2>&1 | tee ~/i232-acquire.log
L=$(sed -n 's/.*, label \([A-Za-z0-9_-]*\).*/\1/p' ~/i232-acquire.log | head -n1); echo "$L"
npx tsx tools/current-season/settle-afl-api.ts --label "$L" --dry-run --auto-apply --require-complete-source 2>&1 | tee ~/i232-dryrun.log
```

**HALT, before any `systemctl start`, if any of:**
- `canonicalRowsInserted` > 0;
- `canonicalRowsUpdated` > 0;
- the source-completeness check refuses (`--require-complete-source`);
- the `Season feed (AFLDB-ISSUE-231 …)` completeness evidence is absent from the output.

The unit is not safe to start or enable until D1 passes. On a halt, return the output for review.

D2. First observed run (root; the polkit rule does not cover this unit). For a `Type=oneshot`
unit, `systemctl start` blocks until the run ends (up to `TimeoutStartSec=3600`) and exits non-zero
if it failed. Follow the journal in a second terminal, started first:

```bash
journalctl -u afldb-settle-afl-api -f      # terminal 2, until AFLDB_SETTLE_SUCCESS or AFLDB_SETTLE_FAILURE
sudo systemctl start afldb-settle-afl-api.service; echo "start exit=$?"   # terminal 1
systemctl show afldb-settle-afl-api.service -p Result,ExecMainStatus,InactiveEnterTimestamp
```

D3. Re-run A's SQL: `afl_api_owned` must still return no rows. The panel's match row shows the new
batch.

D4. Only then: `sudo systemctl enable --now afldb-settle-afl-api.timer && systemctl list-timers
afldb-settle-afl-api.timer --no-pager`.

### E. Brownlow unit outside the count window (E1)

`AFLDB_AFL_API_BROWNLOW_ENABLED` stays unset. Do not run the full chain now: it would write 2026
votes into `afldb_dev`, which needs its own decision.

```bash
sudo systemctl enable --now afldb-settle-afl-api-brownlow.timer
sudo systemctl start afldb-settle-afl-api-brownlow.service
journalctl -u afldb-settle-afl-api-brownlow -n 20 --no-pager   # "...is not 'true' ... Nothing to do."
systemctl show afldb-settle-afl-api-brownlow.service -p Result,ExecMainStatus   # success / 0
ls data/sources/afl_api/fixtures 2>/dev/null | tail -3                          # no new snapshot
```

**Opening and closing the count window (later, not part of this acceptance).** Only the
environment gate is an early no-op. With `AFLDB_AFL_API_BROWNLOW_ENABLED=true` but the Brownlow
`site_settings` switch off, O1 steps 1–2 still run and write before the Brownlow acquisition
refuses, and the unit fails every 5 minutes. So:
- **Open:** (a) the AFL API current-season switch is on; (b) turn the Brownlow `site_settings`
  switch on; (c) only then set `AFLDB_AFL_API_BROWNLOW_ENABLED=true` in `.env`. The oneshot unit
  re-reads `.env` at each firing; no reload is needed.
- **Close:** (a) first remove or clear `AFLDB_AFL_API_BROWNLOW_ENABLED`; (b) then turn the
  Brownlow `site_settings` switch off if wanted.

The first real full-chain firing is observed at the 2027 count (or in a separately authorised
rehearsal).

### F. Out of season

Once a rollover leaves `seasons.json` with no in-progress season, the match unit exits 0 with "no
in-progress season … nothing to settle". That is not the state today (§3b item 4).

## 8. Files changed (this pass, for this issue)

- **N** `src/app/admin/current-season/AflApiSettleUnitsPanel.tsx`
- **M** `src/app/admin/current-season/page.tsx`, `src/lib/acquisition/settle-status.ts` (doc
  comment)
- **M** `tests/admin-current-season-settle.test.ts` (+7 tests; 49 passed)

No deploy file, unit, `.env` or host was touched.

Pass 2:
- **M** `deploy/afldb-settle-afl-api-brownlow.sh` (four-step O1 chain, `--use-fixture-identity`)
- **M** `deploy/afldb-settle-afl-api-brownlow.service` (comments only; directives unchanged)
- **M** `tools/current-season/settle-afl-api-fixtures.ts` (shared F029 loader)
- **M** `tests/afl-api-ingestion-safety.test.ts`, `tests/afl-api-match.test.ts`
- **M** `docs/deployment.md` (the Brownlow wrapper paragraph)

No unit was installed or enabled, and no host, `.env` or database was touched.

Pass 3 (§3b):
- **M** `deploy/afldb-settle-afl-api.service`, `deploy/afldb-settle-afl-api-brownlow.service`
  (`UnsetEnvironment=` and its comment)
- **M** `src/lib/acquisition/settle-trigger.ts` (`LoadState`), `src/app/admin/current-season/AflApiSettleUnitsPanel.tsx`
  ("Not installed on this host.")
- **M** `tests/afl-api-ingestion-safety.test.ts`, `tests/admin-current-season-settle.test.ts`
- **M** this runbook, `docs/deployment.md` §7d, `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §14.7,
  `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`

No unit was installed or enabled, and no host, `.env`, `site_settings` or database was touched.
