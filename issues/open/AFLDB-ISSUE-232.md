# AFLDB-ISSUE-232 — AFL API operational wiring: systemd timers, Brownlow scheduled settle and admin status

**Status:** Open. **Severity:** Medium. **Opened:** 2026-09-23 (ISSUE-228 §22.18 E items 2–3,
§22.20 rows 2–3 and part B). **This runbook:** created 2026-09-26 in the bulk successor pass on
`opus/afl-api-successors-229-234` (base `main` `2e587415`). Uncommitted.

**State after pass 1:** **BLOCKED ON OPERATOR DECISION** (D-232-1, D-232-3). Item 4 (admin
status) is **IMPLEMENTED / NEEDS DEV OPERATOR ACCEPTANCE** (`VISUAL: UNVERIFIED`). Item 1 (host
installation) is operator-run and has not been done on any host.

**State after pass 2 (2026-09-26, uncommitted):**
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

| # | Item | State | Blocked by |
|---|---|---|---|
| 1 | Install and enable both AFL API timers (DEV, then production) | Not done; operator-run | D-232-1 (the Brownlow unit is useless without it) |
| 2 | Brownlow wrapper `--use-fixture-identity` policy | Not changed | **D-232-1** |
| 3 | Match chain before Brownlow chain | Designed (§3) | D-232-1 (the pre-step matters only under option B) |
| 4 | `/admin/current-season` shows the AFL API units | **Implemented** (§4) | DEV acceptance |
| 5 | Automatic `revalidateSeason()` after an AFL API settle | Not changed | **D-232-3** |
| — | "Start now" trigger for the AFL API units | Deferred (§5) | Not needed for scheduled operation |

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
  `AFLDB_SETTLE_TRIGGER=systemd`) and its latest batch.

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

## 7. Installation checklist (operator-run, not executed; after D-232-1)

DEV first, each step separately authorised:
1. Deploy the reviewed branch (`deploy/sync-dev.ps1`).
2. `sh -n deploy/afldb-settle-afl-api.sh deploy/afldb-settle-afl-api-brownlow.sh`.
3. The AFL API current-season ingestion switch is enabled on `/admin/current-season` (the settle
   CLI refuses before writing otherwise). `AFLDB_AFL_API_BROWNLOW_ENABLED` stays unset outside the
   count window.
4. Copy the four unit files to `/etc/systemd/system/`, `systemctl daemon-reload`, and enable
   `afldb-settle-afl-api.timer` only. Enable the Brownlow timer at the next count, with D-232-1
   applied.
5. First run under observation: `systemctl start afldb-settle-afl-api.service`, then
   `journalctl -u afldb-settle-afl-api -f` until `AFLDB_SETTLE_SUCCESS`. Confirm the new
   `Season feed …: complete` line (ISSUE-231) and the admin panel row (§4).
6. Out of season: `seasons.json` has no in-progress season, so the match unit exits 0 with
   "nothing to settle".

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
