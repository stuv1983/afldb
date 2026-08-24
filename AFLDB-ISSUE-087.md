# AFLDB-ISSUE-087 — release-candidate validation and main promotion runbook

> **Status: APPROVED — UNEXECUTED.**
> This is the authoritative execution contract for validating release candidate
> `0a862557bad9ad1a6abc2522a90038a779847fed` and promoting `origin/main` to it.
> No step in this runbook has been executed. It is executed by the user in a
> fresh implementation session, one checkpoint at a time.

| Fact | Value |
|---|---|
| `CANDIDATE_SHA` | **`0a862557bad9ad1a6abc2522a90038a779847fed`** |
| short | `0a86255` |
| Candidate subject | `fix(import): scope award and honours reload ownership` |
| Candidate date | 2026-08-23 12:01:23 +1000 |
| Production checkout baseline | `a32a0a1abacbf49a979343094b28c7983ebbea33` (migration **057**) |
| `origin/main` at authoring | `9be7f26d37579104d633e1f0af647cb635ff100e` (migration **061**) |
| Candidate migration high-water mark | **070** |
| Deployment delta | **87** commits (Range A 32 + Range B 55) |
| Verdict at authoring | **REQUIRES VALIDATION** |
| Axis-2 `E` established | **None** |
| `AFLDB-ISSUE-084` | **HALTed at P0.2**, unchanged, not advanced by this runbook |

`0a86255` resolved uniquely to `CANDIDATE_SHA` by read-only `git rev-parse`
and `git rev-parse --disambiguate`. **Every Git operation in this runbook uses
the full 40-character `CANDIDATE_SHA`.** The short form appears only for
readability. The candidate's identity is its SHA — never a `dev~N` position.

---

## 0. Scope, ownership and relationship to ISSUE-084

### 0.1 What this runbook does and does not do

**Does:** validate the candidate, gather production read-only evidence, and — on
explicit user approval at R9 — fast-forward `origin/main` to `CANDIDATE_SHA`.

**Does not:** deploy to production. Production deployment remains
`AFLDB-ISSUE-084`, which stays **HALTed at P0.2** throughout and is not advanced
by any gate here.

### 0.2 Borrowing from ISSUE-084

- **Permitted:** reusing an ISSUE-084 *reviewed command, SQL envelope or
  transport* as a safe mechanism, because it has already been reviewed.
- **Not permitted:** executing or advancing any ISSUE-084 **phase**.

Reusing the ISSUE-084 §3 read-only SQL envelope, or the P0.4 Caddyfile command,
is **transport reuse**. It does not execute P0.4, does not advance ISSUE-084 past
P0.2, and the resulting evidence **belongs to ISSUE-087**. This applies to every
production-touching gate: **D3, D5, D8, D12**.

`AFLDB-ISSUE-084.md` is frozen. This runbook does not modify it and does not fix
its `<TARGET_SHA>`.

### 0.3 Execution ownership

**The user executes. Claude/Fable analyses returned evidence and advances one
checkpoint at a time.**

| Action | Owner |
|---|---|
| Shell commands | **User** |
| Git commands (including the R9 promotion) | **User** |
| Tests, typecheck, build | **User** |
| SQL / `psql` | **User** |
| SSH, service and deployment actions | **User** |
| Package-manager commands (`npm ci`, `npm run …`) | **User** |
| Repository inspection, editing, evidence analysis | **Claude** |

Claude gives the smallest exact command that proves the next required fact, waits
for the output, extracts the relevant evidence, and only then gives the next
command. Claude does not execute shell, Git, test, build, SQL, SSH or deployment
commands.

---

## 1. Gate set D1–D15 — the validation contract

Common definitions. **Candidate code** = the detached worktree at
`CANDIDATE_SHA`. **`_test`** = `AFLDB_TEST_DATABASE_URL`, whose database name
ends `_test`. **Production read-only** = the ISSUE-084 §3 envelope used as
transport only, evidence owned by ISSUE-087, ISSUE-084 not advanced. Every
"HALT/FAIL" enters the §2 classification before any verdict is drawn.

| Gate | Subsystem / risk | Commits | Unresolved risk | Environment | Exact validation action | Exact PASS | Exact HALT / FAIL | Consequence |
|---|---|---|---|---|---|---|---|---|
| **D1** | ~24 rewritten public routes, no route coverage | `6b7c66e`, `3f5b6e7`, `421f833`, `d341f8c`, `d756d24`, `6aed326`, `eab78dd`, `acbda04`, `bc3db11` | `3f5b6e7` proves one regression already shipped | candidate code + `afldb_dev` | R6.1–R6.4 | `journeys.spec.ts` green on desktop + mobile **and** every D1b row's status **and** landmark | Any non-200 (bar the intended 404), missing landmark, any journey failure | **§2 classification.** Render/route defect ⇒ REJECT + successor. Stale tracked expectation ⇒ successor. **Dev-data drift with correct rendering ⇒ environment repair, SHA unchanged** |
| **D2** | NL public runtime, PARSER_VERSION 13→25 | 14 NL commits incl. `9be7f26`, `cc56025`, `dc7bbfa`, `cdc65ed`, `abe9888`, `8835186`, `ee5977e`, `867ccd6`, `32c89e5`, `9b5749c`, `6fa96cb` | Answer wording and decline behaviour changed; ISSUE-071 open | D2a candidate code; D2b + `_test` | R4 (D2a) and R5-c (D2b) | Every named file green | Any failure | **§2 classification.** Parser/plan/describe defect ⇒ REJECT + successor. `_test` below 070, missing grants or a corpus-path problem ⇒ environment repair, SHA unchanged |
| **D3** | Frontend theme | `d5243ba` | ISSUE-077 live only once a non-default theme is set; ISSUE-072 fails at the candidate | production read-only + ledger | R1-b block D3 | No `site.frontend_theme` row, **or** value `"classic"` | Value is `modern` / `editorial` / `data-dense` / `minimal` | PASS ⇒ **tracked defect limitation** (ISSUE-077) + standing prohibition on setting any other theme. FAIL ⇒ the defect is manifesting, so promotion requires **either** an explicitly approved production prerequisite restoring `classic` through the reviewed `/admin/settings` path with the read-only D3 check **re-run successfully** (previous value captured, rollback defined), **or** ISSUE-077 fixed in a reviewed successor candidate that restarts the applicable candidate validation. **A decision alone is not sufficient** |
| **D4** | Hydration / feedback, ISSUE-068 H7 | `6da70d0`, `924ad69`, `49c100c` | F4: `924ad69` matches the H7 experiment, but the diagnostic build was **never proven live** and H7 was **never validated** | candidate build + `afldb_dev` + ledger | R4 boundary suites **plus** the bounded 1,440-question run in R6.6 | Both feedback suites green; **and** hydration error rate **< 5.0 %** (**< 72 errors at `NL_UI_LIMIT=1440`**); **and** no candidate-attributable page crash or fatal browser failure; **and** no new systematic non-hydration failure class | A suite failure; rate **≥ 5.0 %** (≥ 72); a candidate-attributable crash / fatal browser failure; a new systematic failure class; **or any claim that ISSUE-068 is resolved** | **Tracked defect limitation** (ISSUE-068 stays **open**). A gross-regression ceiling only: passing proves **nothing** about H7. HALT ⇒ §2 classification |
| **D5** | Grid Solver exposure, ISSUE-076 | `607fa27`, `9e3472f`, `c1dae5b` | Timeout crash publicly reachable **iff** audience is `"public"` | production read-only **and** candidate code | R1-b block D5; R6.5 | Prod value absent / `super_admin` / `admin` / `contributor`; **and** candidate response consistent with the dev value | Prod value `"public"` ⇒ **deployment-configuration E**. Candidate response inconsistent with the dev value ⇒ candidate-intrinsic HALT | PASS ⇒ **tracked defect limitation** (ISSUE-076) + standing prohibition on widening. Prod `"public"` ⇒ **approved production prerequisite** (§1.2) **or** successor candidate. Wiring failure ⇒ **REJECT** |
| **D6** | Six root scratch `.ts` files inside `tsc --noEmit` scope | `607fa27`, `6b7c66e`, `9c1cf71`, `2048dd0`, `d5243ba` | F1: `tsconfig.json:21-22` includes `**/*.ts` and excludes only `node_modules`; `d5243ba` neutered one file by renaming `.ts`→`.txt` rather than deleting it | candidate code, **files present** | R3 step H — `npm run typecheck` | Exit 0, no diagnostics | Any diagnostic | **Diagnostic caused by tracked candidate source ⇒ successor-SHA protocol immediately** (§2.2). Diagnostic caused by a broken install / Node version / missing env ⇒ environment repair, SHA unchanged, re-run |
| **D7** | Current-season ingestion, outbound network | `fb170b7`, `5449719`, `0160d66`, `7f59bfe`, `d17199b`, `a091fed`, `c67ba66` | Outbound fetch (Squiggle/Kali) + match writes | operator confirmation + `_test` | Operator states whether the droplet permits egress to those hosts **or** accepts the feature is inert; `tests/current-season-import.test.ts` in R5-d | Either answer recorded **and** the suite green | Suite failure; **or** a `deploy/` unit is found that invokes `current-season:update` | **Verified operational disposition.** Established: `requireSuperAdmin()` at `actions.ts:30`, and `deploy/` contains only `afldb.service`, `afldb-email-intake.{service,timer}`, both Caddyfiles, `server-cluster.mjs`, `sync-dev.ps1`, `coming-soon/` — **no unit invokes the importer** |
| **D8** | Deploy config drift | `3ae20fe`, `bc3db11` | Live `/etc/caddy/Caddyfile` derives from `a32a0a1`; the candidate changes `deploy/Caddyfile.production` | production read-only | R1-a — **complete file capture and bounded full diff** | The reviewed complete diff shows no change to site blocks, matchers/handles, reverse-proxy targets, redirects, roots, or relevant header/TLS/routing directives that alters **which hostname serves the application or where it is proxied** | Any such difference; or the complete file cannot be read | **HALT — promotion readiness fails.** Any required Caddy change is an **explicit production prerequisite needing separate user approval and a defined rollback**, never performed during validation |
| **D9** | Public suggestion affordance | `577a21b` | Admin affordance gated on a public component | candidate code (**inspection complete**) + `_test` | §1.1 record + `tests/auth.test.ts`, `tests/rate-limit.test.ts` in R4 | Both suites green | A suite failure, or later evidence that privilege derives from client-supplied state | **PASS — accepted** |
| **D10** | Apex static | `bc3db11` | `deploy/coming-soon/*` changed; the apex serves `/var/www/afldb-soon` | operator confirmation | Operator confirms the apex is updated **manually**, not by deployment | Confirmed manual | Deployment is found to write `/var/www/afldb-soon` | **Verified operational disposition** — apex content ships in the repo but does not reach the apex on promotion |
| **D11** | R1 — `player_match_period_stats` ships empty and unpopulatable | `cc56025` (migration 062) | If reached, `player-career.ts:54` renders `count(...) = 0` as zero, breaking "not recorded ≠ 0" | candidate code **only** | The existing `tests/nl-plan.test.ts:182-183` assertion, executed inside D2a | That assertion green | It fails | **PASS.** Never satisfied by a live production NL request — production runs `a32a0a1`, and a public NL request writes `nl_search_log` telemetry |
| **D12** | R2 — `match_period_scores` population in production | `cc56025` | Pre-existing table (migration 003); if empty, the team-match period feature is inert in production while green on dev | production read-only | R1-b block D12 | `period_rows > 0` ⇒ **PASS**, production holds period data | The query cannot be run | `period_rows = 0` ⇒ **verified operational disposition**, feature inert, recorded — **no new issue solely because the table is empty**. In both cases the candidate's NULL handling must be green in D2b. **No production-vs-dev completeness threshold applies** (§1.3) |
| **D13** | Admin data-editor writing statistical tables | `efe328a`, `28a1759`, `b7b7992`, `fab58bf`, `ec1e266`, `a99436c`, `9965189`, `0c4e248`, `e0e8fd8`, `fad579d`, `c283e98`, `3ff3cf0` | Open ISSUE-086, ISSUE-082 | candidate code + `_test` + ledger | R5-a | Every named suite green **and** the interaction stated: **ISSUE-084 runs no reload, so ISSUE-086 cannot fire during the rollout** | Any suite failure | **§2 classification.** Mutation/privilege defect ⇒ REJECT + successor. Missing 066 grants or `_test` below 070 ⇒ environment repair, SHA unchanged. PASS ⇒ ISSUE-086/082 as **tracked defect limitations** |
| **D14** | 22 Under 22 importer | `c1dae5b` | Importer ships but its data load is **out of ISSUE-084 scope**; ISSUE-054 is Windows-only | **Linux** `_test` + ledger | R5-d | `tests/under-22-importer.test.ts` **7/7 green on Linux**, `under-22-source` green, **and** the prohibition recorded: deployed, **must not be executed** | Any failure on Linux | **§2 classification.** A CRLF / line-ending / fixture-path problem in the validation checkout is an **environment** problem, SHA unchanged — that is exactly ISSUE-054's mechanism. A genuine parser defect ⇒ successor. PASS ⇒ **tracked defect limitation** (ISSUE-054) |
| **D15** | Admin confidence matching, bulk approve | `88c2681`, `0bf8da4`, `875da6b`, `2e6b8db`, `87620a2`, `8e605da`, `e88adb7`, `fdd30a9`, `a0cd23b` | ISSUE-082 — `confirmUnlinked` takes no lock; bulk approve enlarges the stale-form window | candidate code + `_test` + ledger | R5-b | Every named suite green **and** the prohibition recorded: **bulk approve must not be used until ISSUE-082 is fixed** | Any suite failure | **§2 classification**; PASS ⇒ ISSUE-082 as a **tracked defect limitation** |

### 1.1 D9 — established by inspection

`src/app/player-link-suggestion-action.ts:50-53`:

```ts
export async function isSuperAdminAction(): Promise<boolean> {
  const user = await getAdminUser();
  return user?.role === 'super_admin';
}
```

| Requirement | Evidence |
|---|---|
| Server-side evaluation | `'use server'` at file line 1; the module imports `@/lib/auth/session`, which is `server-only` |
| Session/database authority | Sole input is `getAdminUser()`; the function takes **no parameters at all** |
| No client-supplied privilege | No argument, no `formData`, no header read, no cookie read |
| Minimum response | Returns `boolean` — no role string, no user id, no session detail |

F3 stands: `577a21b` did **not** introduce the anonymous suggestion write path.
`src/app/player-link-suggestion-action.ts:9-25` documents an anonymous,
IP-rate-limited (12 / 15 min) design that pre-dates the candidate; `useAdmin.ts`
is the new file and consumes only this boolean.

### 1.2 D3 and D5 — settings keys, shapes, defaults and semantics

**Theme (D3).**

| Fact | Value | Source |
|---|---|---|
| Key | **`site.frontend_theme`** | `src/lib/site-settings.ts:49` |
| Column type | `value jsonb NOT NULL` | `src/db/migrations/034_site_settings.sql:21-26` |
| Persisted shape | a **JSON string**, e.g. `"classic"` | `src/app/admin/settings/actions.ts:108` |
| Supported values | `classic` \| `modern` \| `editorial` \| `data-dense` \| `minimal` | `src/lib/site-settings.ts:568-576` |
| Default | **`classic`** (`DEFAULT_SITE_THEME`) | `src/lib/site-settings.ts:578` |
| Absent row | `byKey.has(...)` false ⇒ default | `src/lib/site-settings.ts:694-696` |
| Unrecognised value | allowlisted by `parseSiteTheme` ⇒ `classic` | `src/lib/site-settings.ts:580-584` |
| Read path | public pool `afldb_app` | `src/db/queries/site-settings.ts:34-36` |

`classic` is the pre-`d5243ba` presentation; the other four are the only states
in which ISSUE-077 can manifest.

**Grid Solver audience (D5).** `requireAudience`
(`src/lib/auth/audience.ts:24-31`) returns immediately for `public` without
reading a cookie; every other value calls `getAdminUser()`, redirects a
signed-out visitor to `/admin/login`, and `notFound()`s a session ranking below
the threshold. Consumed at `src/app/grid-solver/page.tsx:54-55`.

| Fact | Value | Source |
|---|---|---|
| Key | **`grid_solver.audience`** | `src/lib/site-settings.ts:28` |
| Shape | JSON string in `jsonb` | migration 034 + `settings/actions.ts:98` |
| Values | `super_admin`, `admin`, `contributor`, **`public`** | `src/lib/site-settings.ts:240-259` |
| Default | **`super_admin`** | `src/lib/site-settings.ts:263` |
| Absent / unrecognised | ⇒ `super_admin` | `src/lib/site-settings.ts:265-269` |

The value names the **least privileged session admitted**. Only `"public"`
bypasses the session read, and it also makes `/search` link the solver
(`src/app/search/page.tsx:49-53`).

**If D5 returns `"public"`**, promotion is blocked until **one** of:

- **(i) an approved production prerequisite** — capture the existing value; set
  `"super_admin"` **through `/admin/settings` as a super admin** (never by direct
  SQL: the admin action is the reviewed write path and records `updated_by`);
  verify by re-running the R1-b read-only query **and** an anonymous
  `GET /grid-solver` on production returning a redirect to `/admin/login`;
  rollback = restore the captured value through the same form; **or**
- **(ii) ISSUE-076 fixed in a successor candidate.**

The setting is **never** changed as an unrecorded action.

### 1.3 D12 — the proven question only

The established D12/R2 question is: *is `match_period_scores` empty in
production, making the `cc56025` team-period feature inert?* Nothing wider.

| Production result | Adjudication |
|---|---|
| `period_rows > 0` | **PASS** the D12 population gate — production contains period data |
| `period_rows = 0` | **Verified operational disposition.** The table is pre-existing (migration 003), not created by this candidate; the period data was never loaded into `afldb_prod`, so the feature is inert there. Record explicitly. **No new issue solely because the table is empty** |

In **both** cases the candidate's missing-data / NULL handling must remain green
in D2b.

**No production-vs-dev coverage threshold is applied, because no repository
evidence defines one.** Verified at the candidate: `src/db/queries/nl/team-match.ts:27-28,37-38`
reads the table by **`LEFT JOIN`**, so absent rows yield `NULL` structurally
rather than a fabricated zero; `src/db/migrations/022_match_result_integrity.sql:62,69`
adds integrity constraints, not completeness constraints;
`tests/integration/release-gates.test.ts` contains **no** period-score gate; and
no test or source module asserts any coverage ratio. Dev counts captured in R3
step F are **diagnostic evidence only**.

### 1.4 D11 — resolved on existing coverage

`src/search/nl/plan.ts:908-913` rejects **every** non-`FULL_MATCH` period split on
**any** grain other than `team_match`, in a single grain-generic branch. The
assertion already exists at `tests/nl-plan.test.ts:182-183` (`grain:
'player_season'`, `periodSplit: 'Q1'` ⇒ *"Quarter-by-quarter player statistics
are not currently available to rank."*). Because the guard keys only on
`grain !== 'team_match'`, that one assertion is representative of every player
grain.

**No gate in this runbook writes a test.** Adding one would modify tracked
candidate source and force a successor SHA under §2.2. A `player_match`-grain
variant is recorded as a follow-up for a future candidate.

### 1.5 D4 — the bounded hydration check

`tests/nl-ui/nl-stress.spec.ts` is *"the permanent reproducer for a
production-only React #418 hydration mismatch on /search, ~2-6% of loads"*, with
the hard-won constraint that failures *"have only ever reproduced under
SUSTAINED, VARIED corpus traffic"* — a repeated single question gave 0/400. A
bounded run therefore uses a **varied corpus slice**, never a repeated query.

`playwright.nl-stress.config.ts` has **no `webServer` block** and takes
`baseURL = AFLDB_E2E_BASE_URL ?? …`, so it can be pointed at the candidate
standalone server. The in-tree corpus
`tests/nl-ui/corpora/afldb-ui-questions-1440-real-user-v3-20260822.csv` supplies
1,440 real-user questions — roughly a twelfth of the excluded ~1-hour
12,000-question campaign.

| | Criterion |
|---|---|
| **PASS** | hydration error rate **< 5.0 %**; **and** no candidate-attributable page crash or fatal browser failure; **and** no new systematic non-hydration failure class |
| **HALT** | hydration error rate **≥ 5.0 %**; **or** a candidate-attributable page crash or fatal browser failure; **or** a new systematic failure class |

At `NL_UI_LIMIT=1440`, **5.0 % = 72 hydration errors**. The threshold is a fixed
count, not a comparison against any prior figure.

This is deliberately **only a gross-regression ceiling**. Passing it:

- does **not** prove H7 worked;
- does **not** resolve ISSUE-068;
- does **not** make the historical `3.29 % / 3.63 %` production figures
  candidate-validation evidence. Those were measured on **production running
  `a32a0a1`** — **pre-H7** code on different infrastructure — and the defect is
  documented **production-only**, so a low rate on a dev-hosted candidate build
  is the expected result regardless of H7. They are historical context and are
  **not an input to this gate**.

### 1.6 D1 — the bounded route matrix

`tests/e2e/journeys.spec.ts` is an existing 30-test route suite with real slugs
and real landmarks, run by `npm run test:e2e` against the **production standalone
build**. `CLAUDE.md` §10 requires extending the closest existing suite, so D1 is
that suite **plus** a bounded matrix for the routes it does not reach.

**Port hazard.** `playwright.config.ts` sets `reuseExistingServer: false` on
`127.0.0.1:3100`, and the dev service holds 3100. The candidate must **not**
displace it: run the standalone server on a spare port and set
`AFLDB_E2E_BASE_URL`, which disables the built-in `webServer`.

**D1a — the existing suite** (desktop + mobile), landmarks already in the file:

| Route | Representative parameter | Landmark |
|---|---|---|
| `/` | — | `h1` matching `/Every player\. Every game\./` |
| `/players` | `?page=999`; `?games_min=200&games_max=249&finals_min=16` | `h1 "Players"`; `.subtitle` "13,361 players"; "117 players" |
| `/players/[slug]` | `scott-pendlebury-4182`, `haydn-bunton-1466`, `bob-skilton-3702`, `max-gawn-11966`, `nobody-99999999` | heading "Scott Pendlebury"; em-dash for unrecorded; `.stat` 180 / "3× medallist"; "Not yet awarded"; **404** |
| `/seasons/[year]` | `1989`, `2026` | `h1 /1989 VFL Season/` + "Ladder" + "Grand Final"; `.notice` "Season in progress"/"provisional", no "Premiers:" |
| `/clubs`, `/clubs/[slug]` | `footscray`, `fitzroy` | "Season history" contains 1954 & 1925, **not** 2026; `.notice` "counted towards" + "Brisbane Lions" |
| `/records`, `/records/[category]` | `most-games` | `h1 "Most Games"` + link "Michael Tuck" |
| `/brownlow/[year]` | `2003` | `.subtitle` "Shared by" + three names |
| `/match-search`, `/matches/[id]` | `margin_max=3`, `16887` | `.section-note` "matches"; "Adelaide 103 defeated St Kilda 102" |
| `/aflw` | — | heading "AFLW is coming to AFLDB", 5× "Coming soon" |
| `/api/health`, `/robots.txt`, `/sitemap.xml` | — | `{status:'ok',database:'ok'}` with no DSN leakage; `Disallow: /` on non-production; sitemap segments non-empty |

Anonymous throughout; database `afldb_dev`; `AFLDB_ENV` must **not** be
`production`, or the `robots.txt` assertion inverts and fails for the wrong
reason.

**D1b — supplementary HTTP matrix**, nine routes `journeys.spec.ts` does not
reach, each touched by a named ride-along commit:

| # | Path | Commit | Expected | Landmark | PASS |
|---|---|---|---|---|---|
| 1 | `/search` | `bc3db11`, `ee5977e` | 200 | `<h1>Search</h1>` | status + landmark |
| 2 | `/seasons` | `6aed326` | 200 | `<h1>Seasons</h1>` + ≥ 100 `<tr` | both |
| 3 | `/awards` | `6aed326`, `acbda04` | 200 | `<h1>Awards and Honours</h1>` + `Representative teams` + `Competition awards` | all three |
| 4 | `/hall-of-fame` | `d341f8c`, `d756d24`, `6aed326` | 200 | `<h1>Australian Football Hall of Fame</h1>` + ≥ 20 `<tr` | both |
| 5 | `/honour-teams/<slug>` | `6aed326` | 200 | slug from the first `href="/honour-teams/…"` in row 3's body; non-empty `<h1>` + ≥ 10 `<tr` | both |
| 6 | `/brownlow` | `421f833` | 200 | `<h1>Brownlow Medal</h1>` + ≥ 20 `<tr` | both |
| 7 | `/draft` | `421f833` | 200 | `<h1>Draft</h1>` + ≥ 1 `href="/draft/` | both |
| 8 | `/draft/<year>` | `421f833`, **`3f5b6e7`** | 200 | most recent year linked from row 7; `<h1>… Draft</h1>` + `<caption` + ≥ 5 `<th` + ≥ 10 `<tr` | all four |
| 9 | `/venues` | `6b7c66e` | 200 | `<h1>Venues</h1>` + ≥ 20 `<tr` | both |

Row 8 exists because `3f5b6e7` was authored **solely** to fix a `SortableHeader`
regression on that exact page — the one route with proven regression history, and
absent from `journeys.spec.ts`. Cell-count equality beyond the `<th>`/`<tr>`
floors is not proven by D1; `tests/unit/sorting.test.ts` (R4) covers the sorting
primitive.

### 1.7 Test-file partition — 66 files, each exactly once

The candidate tree contains **66** files matching `tests/**/*.test.ts`:
R4 (28) + the separate `site-settings` invocation (1) + R5-a (10) + R5-b (4) +
R5-c (5) + R5-d (7) + R5-e (7) + R5-f (3, across three invocations) + R5-g (1) =
**66**. No candidate unit or integration test is omitted, and none runs twice.
**R2 step A2 re-derives the manifest inside the worktree from `CANDIDATE_SHA`
and reconciles it**, so the claim is re-proved at execution time.

Playwright specs are outside this partition by design: `tests/e2e/` (D1a),
`tests/nl-ui/` (D4 bounded run), and `tests/admin-nav/` — the last is **out of
scope, recorded not run**, since it needs an authenticated TOTP setup project and
no gate depends on it.

---

## 2. Failure semantics — HALT first, classify, then decide

**This governs every gate. No gate automatically declares a successor
candidate.**

### 2.1 The classification loop

```
unexpected failure
  → HALT the procedure
  → preserve evidence (output, artifacts, run tag, exit status)
  → DO NOT modify tracked candidate source
  → bounded diagnosis, only as far as needed to classify
  → adjudicate
```

| Classification | Verdict | Candidate SHA |
|---|---|---|
| **Candidate runtime/source defect** — the candidate's own code is wrong | **REJECT `CANDIDATE_SHA`**; successor candidate required | changes |
| **Candidate tracked-test defect** — the test is wrong and repairing it needs a repository edit | successor candidate required | changes |
| **Environment / validation-data / port / DB-bootstrap / harness problem**, candidate source unchanged | repair the **validation environment only**; re-prove the affected safety and provenance assumptions; re-run the affected gate | **unchanged** |
| **Unexplained** | remains **REQUIRES VALIDATION** | unchanged |

This matters most for **D1**: `journeys.spec.ts` asserts exact `afldb_dev` facts
— "13,361 players", "117 players", the 2026 provisional season, specific player
ids. **Dev-data drift is not, by itself, evidence that candidate source is
defective.** A count mismatch is diagnosed against the dev database first; if the
page renders correctly and only the datum moved, it is an environment /
validation-data problem and the candidate SHA does not change.

### 2.2 The successor-candidate protocol

Invoked only for the first two classifications, and for a D6 diagnostic
genuinely caused by tracked candidate source:

1. **HALT** validation of `CANDIDATE_SHA`; preserve evidence.
2. **Do not patch the disposable worktree and continue.**
3. Author a **reviewed successor commit outside** the worktree.
4. The **new SHA becomes the new candidate**.
5. Classify **only the new delta plus any affected assumptions**.
6. **Re-prove topology and provenance**, and **re-run all SHA-bound validation**.

Unchanged historical commits are **not** re-reviewed.

### 2.3 Two non-failing outcome classes

| | **A. Tracked defect limitation** | **B. Verified operational disposition** |
|---|---|---|
| What it is | A real defect that ships, knowingly | A demonstrated operational state that is not a defect |
| Issue ID | **Required** | **Not inherently required** |
| Signature | Must be bounded and matched exactly (§4) | Must be positively demonstrated, not assumed |
| Extra test | Must create **no new publicly reachable defect under the production configuration actually in force** | — |
| Here | ISSUE-076 (D5), ISSUE-077 (D3), ISSUE-082 (D15), ISSUE-086 (D13), ISSUE-054 (D14), ISSUE-068 (D4), ISSUE-072/073 (expected test failures) | D7 (feature inert: no `deploy/` unit invokes it), D10 (apex updated manually), D12 zero-row |

Nothing is labelled "accepted/tracked" unless something actually tracks it.

---

## 3. Ordered execution phases R0–R9

A HALT anywhere stops the procedure and enters §2. It is never worked around
inside the worktree.

### R0 — operator prerequisites and the external-automation gate
*Depends on: nothing. Blocks: everything.*

1. **External automation gate.** Native inspection has established: **no
   `.github/`, no `.gitlab-ci`, no `.circleci`, no `.husky`, and no active
   `.git/hooks`** in the candidate tree. That is **not sufficient**. The operator
   must additionally confirm and record:
   - GitHub → repo **Settings → Webhooks**: empty;
   - GitHub → **Actions** tab: no workflows on any branch;
   - GitHub → **Settings → Integrations / GitHub Apps** and **Deploy keys**:
     nothing with write access that reacts to `main`;
   - GitHub → **Settings → Rules / branch protection** on `main`;
   - on the droplet: `systemctl list-timers --all` and `crontab -l` +
     `/etc/cron.d` contain **no `git pull` or deploy poller**.

   **STOP:** if any of this is unknown, or if something does react to a push to
   `main`, the procedure halts before R9 and **`main` is not pushed**.
2. Confirm the Linux validation host, the `_test` database name, and that the dev
   service on port 3100 will **not** be stopped or displaced.
3. Confirm SSH to production is available and the home firewall's IPS has not
   blocked port 22 — a burst of SSH attempts has done this before; check it
   before concluding the droplet is down.

### R1 — production read-only evidence (D8, D5-prod, D3, D12), one SSH session
*Depends on: R0.3. Blocks: promotion, not candidate validation.*

Owned by **ISSUE-087**. The ISSUE-084 §3 envelope and P0.4 command are reused
**as reviewed transport only**: this does not execute or advance ISSUE-084 P0.4,
ISSUE-084 **remains HALTed at P0.2**, and all evidence belongs to ISSUE-087.

**R1-a — D8, the complete live Caddyfile.** The grep is retained only as a
summary; PASS requires the full comparison.

```bash
# summary (the reviewed P0.4 command, unchanged)
ssh afldb 'sudo grep -nE "^[a-z0-9.]+\.afldb\.com|^afldb\.com|reverse_proxy|root \*" /etc/caddy/Caddyfile'

# authoritative: complete file, captured read-only to a local artifact
ssh afldb 'sudo cat /etc/caddy/Caddyfile' > artifacts/issue-087/caddyfile.live.txt
```

Then a **bounded complete diff** against exactly
`<CANDIDATE_SHA>:deploy/Caddyfile.production`, reviewing every site block,
matcher/handle, reverse-proxy target, redirect, root, and relevant
header/TLS/routing directive. Expected shape from the ISSUE-084 record:
`beta.afldb.com → reverse_proxy 127.0.0.1:3100` carrying `health_uri /api/health`;
apex `afldb.com` serving `/var/www/afldb-soon` with only `/api/early-access*`
proxied; `www.afldb.com` a permanent redirect.

*Handling:* review the captured file for credentials (ACME email, any
`basic_auth` hash) before storing or quoting it; never paste a secret into the
ledger. **No production Caddyfile mutation occurs during validation.**

**R1-b — D3, D5 and D12 in one SQL file** inside the §3 envelope: identity gate
(`afldb_prod` + `afldb_owner` + both read-only settings),
`BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`, explicit
`ROLLBACK`, `PGOPTIONS="-c default_transaction_read_only=on"`, DSN via
`PG*`/`PGPASSWORD` so nothing reaches argv, and the reviewed parser
sha256-verified as
`eec7b211d96f4cb5eb39c9f99f75c826621ba8cecbfadee310401f4c4691a79f`.

```sql
\echo '== D3 + D5. site_settings — theme and grid-solver audience =='
SELECT key,
       jsonb_typeof(value) AS json_type,
       value::text         AS raw_value,
       updated_at
  FROM site_settings
 WHERE key IN ('site.frontend_theme', 'grid_solver.audience')
 ORDER BY key;
-- A key absent from this result is the documented "never configured" state and
-- resolves to its default: 'classic' and 'super_admin' respectively.

\echo '== D12. match_period_scores population =='
SELECT count(*)                                AS period_rows,
       count(DISTINCT match_id)                AS matches_with_period_rows,
       min(period)                             AS min_period,
       max(period)                             AS max_period,
       count(*) FILTER (WHERE points IS NULL)  AS null_points
  FROM match_period_scores;

SELECT count(*) AS total_matches FROM matches;   -- diagnostic context only
```

Every column is confirmed against the candidate schema
(`034_site_settings.sql:21-26`, `003_matches.sql:88-97`), so `ON_ERROR_STOP=1`
cannot abort the file on a column-name error.

**STOP conditions.** Identity gate fails ⇒ no application data is queried, halt.
D8 hostname/proxy change ⇒ halt. D5 `"public"` ⇒ **deployment-configuration E**:
R2–R8 may still establish the candidate's own soundness, but R9 cannot proceed.
D3 non-`classic` ⇒ the ISSUE-077 defect is **manifesting for real readers**, so
R9 cannot proceed on a decision alone: it requires either an **explicitly
approved production prerequisite** that restores `classic` through the reviewed
admin path with the read-only D3 check **re-run successfully**, or ISSUE-077
**fixed in a reviewed successor candidate** that restarts the applicable
candidate validation.

### R2 — candidate provenance and environment safety (steps A–D)
*Depends on: R0. Blocks: R3.* **No repository npm script runs in this phase.**

**A. Detached worktree and provenance.**

```bash
git worktree add --detach /tmp/afldb-release-0a86255 0a862557bad9ad1a6abc2522a90038a779847fed
```

Do **not** repoint `d:/dev/afldb`. Prove, from inside the worktree: the full
40-character SHA equals `CANDIDATE_SHA`; detached HEAD; empty
`git status --porcelain`; the `package-lock.json` blob id;
`git ls-tree -r --name-only HEAD -- src/db/migrations/` showing **058–070**; blob
ids for the six sensitive files (`tools/maintenance/privileges.sql`,
`tools/migration/common.py`, `tools/migration/import_awards.py`,
`tools/migration/import_draft.py`, `tools/records/import-first-kick-goal.ts`,
`src/db/queries/awards-admin.ts`); and that no file is taken from the dev-tip
worktree.

**A2. Test-manifest reconciliation.** From the worktree,
`git ls-tree -r --name-only HEAD -- tests/ | grep '\.test\.ts$' | sort` must
yield **exactly 66 files**, and that set must equal the union of R4, the separate
`site-settings` invocation, and R5-a…g, with no file appearing twice. **STOP** on
any difference — a file present at `CANDIDATE_SHA` but absent from the batches
would otherwise be silently unvalidated.

**B. Minimal environment.** Author `.env` in the worktree from `tests/setup.ts`
and `.env.example` **at `CANDIDATE_SHA`**. Do not copy variables merely because
they exist on the dev host. `AFLDB_ENV` must **not** be `production`.

**C. DSN parser.** Verify `scratchpad/afldb-dsn-parse.py` SHA-256 =
`eec7b211d96f4cb5eb39c9f99f75c826621ba8cecbfadee310401f4c4691a79f` on the
validation host. Its interface is
`afldb-dsn-parse.py --identity|--password <env-file> <var-name>`: `--identity`
prints only `role= host= port= dbname=`, `--password` prints only the decoded
password, and it never prints the raw URL.

**D. DSN identity / no-production gate — before `npm ci` and before every
database command.** Via `--identity`:

- `DATABASE_URL` → **`afldb_dev`** only
- `AFLDB_OWNER_DATABASE_URL` → **`afldb_dev`** only
- `AFLDB_TEST_DATABASE_URL` → database name **ends `_test`**
- **`AFLDB_PROD_DATABASE_URL` absent**; any production-owner DSN absent
- no validation command may resolve to `afldb_prod`

*Why:* `tools/db/migrate.ts:64-72` maps `AFLDB_MIGRATE_TARGET`
`dev → AFLDB_OWNER_DATABASE_URL`, `test → AFLDB_TEST_DATABASE_URL`,
**`prod → AFLDB_PROD_DATABASE_URL`**, defaults to `dev`, and refuses an unknown
target. With `AFLDB_PROD_DATABASE_URL` absent, the `prod` target cannot resolve
at all.

**STOP:** any provenance mismatch, any manifest difference, any non-empty
`git status --porcelain`, any DSN outside the allowlist.

### R3 — bootstrap, database reconciliation, and D6 (steps E–I)
*Depends on: R2 complete, including the DSN gate.*

**E. `npm ci`** in the worktree against the recorded `package-lock.json` blob.
The net `package.json` delta across the deployment range is two script entries
(`current-season:update`, `match:backtest`) and `package-lock.json` is unchanged
end-to-end; the frozen ISSUE-084 npm-ci skip criterion is **not met** because
`package.json` changed, but that concerns the *production* Phase-7 step and is
not decided here. **`npm ci` runs only after step D passes** — it is the first
command that could execute repository code.

**F. `db:status` on both permitted targets**, from the worktree:

```bash
AFLDB_MIGRATE_TARGET=test npm run db:status
npm run db:status                       # default target is 'dev'
```

Both must read high-water mark `070_import_reads_link_suggestions.sql` with no
checksum drift.

Capture the D12 **dev diagnostic** figures in the same phase, read-only. **No DSN
is passed in argv** — use the reviewed parser to move the password into
`PGPASSWORD` and the rest into `PG*`, then invoke `psql` with **no connection
argument**:

```bash
ENVFILE=/tmp/afldb-release-0a86255/.env
PARSER=scratchpad/afldb-dsn-parse.py     # SHA-256 verified in step C

set -- $("$PARSER" --identity "$ENVFILE" AFLDB_OWNER_DATABASE_URL)
export PGUSER="${1#role=}" PGHOST="${2#host=}" PGPORT="${3#port=}" PGDATABASE="${4#dbname=}"
export PGPASSWORD="$("$PARSER" --password "$ENVFILE" AFLDB_OWNER_DATABASE_URL)"

psql -X -P pager=off -c \
  "SELECT count(*) AS period_rows, count(DISTINCT match_id) AS matches_with_period_rows FROM match_period_scores;"
psql -X -P pager=off -c "SELECT count(*) AS total_matches FROM matches;"

unset PGPASSWORD
```

The same `--identity` output is the step-D gate evidence, so identity proof and
connection use one mechanism. These figures are **diagnostic evidence only** and
are **not** a D12 threshold.

**No-DSN-in-argv hygiene applies to every ISSUE-087-authored `psql`
invocation** — R1-b, R3 step F, R6.5, and the R6.6 pre-run tag check.

*One pre-existing exception, recorded not introduced:* the repository's own
privilege scripts are `psql "$AFLDB_OWNER_DATABASE_URL" …` and
`psql "$AFLDB_TEST_DATABASE_URL" …` (`package.json:15-16`), so **they** put the
DSN in argv. `AFLDB-ISSUE-084.md` already records this at its §6.1 / line 103.
Changing them would modify tracked candidate source and force a successor SHA, so
ISSUE-087 does not. Mitigation: they run only on the validation host, only
against `afldb_dev` / `afldb_test` as proven in step D, and never against
production — `AFLDB_PROD_DATABASE_URL` is absent, so no production DSN exists to
leak.

**G. Reconciliation, only if a permitted database is below 070.** This mutates a
database and therefore requires **explicit user approval before execution**.
Repository-supported operations only; `afldb_prod` is never a target and cannot
resolve.

| Target below 070 | Approved operation | Then |
|---|---|---|
| `afldb_test` | `npm run db:migrate:test` then `npm run db:privileges:test` | re-run `AFLDB_MIGRATE_TARGET=test npm run db:status` |
| **`afldb_dev`** | `npm run db:migrate` (default target `dev` → `AFLDB_OWNER_DATABASE_URL`, proven in step D to be `afldb_dev`) then `npm run db:privileges` | re-run `npm run db:status` |

The privileges run is **not optional** in either case: application read has been
fail-closed since migration 039, so a newly created public table is unreadable by
`afldb_app` until `privileges.sql` reconciles the grants — and ISSUE-027's own
ordering requires migration 066 followed by `db:privileges` before the code that
depends on it. Migrating `afldb_dev` also affects the running dev service; the
dev tip already expects 070, so this aligns rather than diverges, but the
operator confirms it before proceeding.

**STOP:** high-water mark still below 070 after reconciliation, any checksum
drift, or any target resolving outside the allowlist.

**H. D6 — `npm run typecheck`.** The first substantive candidate-**source**
validation. **STOP** on any diagnostic and classify per §2; a diagnostic caused
by tracked candidate source goes straight to §2.2.

**I.** Only now does expensive validation continue.

### R4 — deterministic suites (D9, D2a, D11)
*Depends on: R3 green.*

```bash
npm test -- \
  tests/nl-parser.test.ts tests/nl-plan.test.ts tests/nl-describe.test.ts \
  tests/nl-audit-acceptance.test.ts tests/nl-regression-corpus.test.ts \
  tests/nl-stress-corpus.test.ts tests/nl-stress-v2.test.ts \
  tests/nl-ui-corpus.test.ts tests/nl-expanded-ui-corpus-generator.test.ts \
  tests/query-intent.test.ts \
  tests/auth.test.ts tests/rate-limit.test.ts \
  tests/nl-answer-feedback-boundary.test.ts tests/nl-feedback.test.ts \
  tests/format.test.ts tests/seo.test.ts tests/table-filters.test.ts \
  tests/unit/sorting.test.ts tests/player-compare.test.ts \
  tests/advanced-spec.test.ts tests/query-builder-spec.test.ts \
  tests/catalogue-lookups.test.ts tests/csv.test.ts tests/like.test.ts \
  tests/indexing.test.ts tests/early-access-questions.test.ts \
  tests/submission-review-actions.test.ts tests/site-content.test.ts
```

D11 is proven by `tests/nl-plan.test.ts:182-183` inside this run.
`nl-expanded-ui-corpus-generator.test.ts` is the suite that **depends on the root
`tmp-generate-expanded-ui-corpus.mjs`**, so it is the one test that fails if the
scratch payload is removed.

Then, separately, so the expected ISSUE-072 failure cannot be confused with
anything else:

```bash
npm test -- tests/site-settings.test.ts
```

**Expected:** exactly the "supplies every default from an empty table" assertion
fails. **HALT:** a *different* assertion failing in that file.

### R5 — database suites, isolation-aware (D13, D15, D2b, D14, D7, residual)
*Depends on: R4 green, both databases at 070.*

**ISSUE-081 enforcement is by invocation.** `tests/integration/draft-lock.ts`
provides a PostgreSQL advisory mutex (`780_001`) taken by
`draft-reload-links.test.ts` and `release-gates.test.ts`, so **that** race is
already serialised in code. **`awards-reload-links.test.ts` and
`first-kick-goal-reload-links.test.ts` take no lock**, and
`release-gates.test.ts` asserts exact counts (5,057 draft people, 3,459 linked,
6,810 rows, 12,478 birth dates, 24 identities). Vitest runs files in parallel by
default, so each reload suite gets **its own invocation**, and the gates get a
fourth.

```bash
# R5-a  D13 — admin data-editor
npm test -- tests/admin-match-mutations.test.ts tests/admin-match-input.test.ts \
  tests/match-sheet.test.ts tests/match-lineup-editor.test.ts tests/match-spec.test.ts \
  tests/edit-spec.test.ts tests/awards-admin.test.ts tests/award-stat-line.test.ts \
  tests/integration/data-editor.test.ts tests/integration/privileges.test.ts

# R5-b  D15 — admin confidence matching
npm test -- tests/player-matching.test.ts tests/player-matching-describe.test.ts \
  tests/player-link-mutations.test.ts tests/integration/player-matching.test.ts

# R5-c  D2b — NL against PostgreSQL
npm test -- tests/integration/nl-answers.test.ts \
  tests/integration/nl-answers-game-season.test.ts \
  tests/integration/nl-answers-team-club.test.ts \
  tests/integration/nl-answer-boundary.test.ts tests/integration/nl-vocab.test.ts

# R5-d  D14 (Linux) + D5 solver specs + D7
npm test -- tests/under-22-importer.test.ts tests/under-22-source.test.ts \
  tests/grid-solver-spec.test.ts tests/grid-solver-under22.test.ts \
  tests/integration/grid-solver.test.ts tests/integration/grid-solver-investigation.test.ts \
  tests/current-season-import.test.ts

# R5-e  residual integration
npm test -- tests/integration/database.test.ts tests/integration/datasets.test.ts \
  tests/integration/db-health.test.ts tests/integration/email-intake.test.ts \
  tests/integration/query-builder.test.ts tests/integration/player-compare.test.ts \
  tests/integration/fk-indexes.test.ts

# R5-f  ISSUE-081 isolation — each reload suite in its OWN invocation, alone
npm test -- --no-file-parallelism \
  tests/integration/awards-reload-links.test.ts

npm test -- --no-file-parallelism \
  tests/integration/draft-reload-links.test.ts

npm test -- --no-file-parallelism \
  tests/integration/first-kick-goal-reload-links.test.ts

# R5-g  ISSUE-081 isolation — the gates, in their own invocation
npm test -- tests/integration/release-gates.test.ts
```

`tests/integration/fk-indexes.test.ts` sits in R5-e with its known ISSUE-073
failure. **STOP:** any failure whose signature is not in §4; classify per §2.

### R6 — build, route smoke, and the bounded hydration check (D1, D5-candidate, D4)
*Depends on: R5 green.*

1. `npm run build` in the worktree — also the only exercise of
   `tools/build/prepare-standalone.mjs`, modified by `3ae20fe`.
2. `PORT=3190 node .next/standalone/server.js &` — confirm the printed port; do
   **not** take 3100 from the dev service. Set `AFLDB_NL_RUN_TAG=accept` in this
   server's environment so step 6's run tag is honoured rather than logging as
   real traffic.
3. `AFLDB_E2E_BASE_URL=http://127.0.0.1:3190 npm run test:e2e` (D1a).
4. The nine-route D1b matrix (§1.6) against the same server.
5. **D5 candidate half:** read the dev value on `afldb_dev` through the same PG*
   session established in R3 step F (no DSN in argv) —
   `psql -X -P pager=off -c "SELECT value::text FROM site_settings WHERE key='grid_solver.audience';"`
   — then
   `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:3190/grid-solver`.
   Restrictive value ⇒ 307/302 to `/admin/login`; `"public"` ⇒ 200. The dev value
   is expected to be `public` (a deliberate dev-only widening), so a **200 on dev
   is not a finding**; the gate is consistency, which is what proves
   `requireAudience` is wired.
6. **D4 bounded hydration check** — the in-tree 1,440-question varied corpus,
   JavaScript **on**, against the candidate build:

   ```bash
   NL_UI_CORPUS=tests/nl-ui/corpora/afldb-ui-questions-1440-real-user-v3-20260822.csv \
   NL_UI_LIMIT=1440 NL_UI_BATCH=100 NL_UI_WORKERS=4 \
   NL_UI_RUN_TAG=issue-087-0a86255-<TIMESTAMP> \
   AFLDB_E2E_BASE_URL=http://127.0.0.1:3190 \
     npm run nl:ui
   ```

   Requires the `setup` project's beta-code auth (`AFLDB_E2E_BETA_CODE`).
   `NL_UI_FAST` must stay **unset**, or the hydration signal is lost.

   **Run tag, and no telemetry is ever deleted.** Generate a tag unique to this
   run, naming the issue, the candidate SHA and a timestamp — e.g.
   `issue-087-0a86255-20260823T1530Z`. **Before** the run, prove on `afldb_dev`
   (read-only, PG* session from R3 step F, no DSN in argv) that the tag is
   unused:

   ```bash
   psql -X -P pager=off -c \
     "SELECT count(*) FROM nl_search_log WHERE run_tag = 'issue-087-0a86255-<TIMESTAMP>';"
   # must return exactly 0 before the run proceeds
   ```

   **After** the run, query **only** that exact `run_tag`. Historical rows are
   retained untouched. **No `DELETE`, `TRUNCATE` or purge of `nl_search_log`
   forms any part of this runbook** — ISSUE-087 does not remove historical NL
   telemetry in order to run a validation.

   **PASS / HALT:** the fixed numeric criterion in §1.5 — rate **< 5.0 %**
   (**< 72 errors at 1,440**), no candidate-attributable crash or fatal browser
   failure, no new systematic failure class. A passing result proves **nothing**
   about H7 and does not close ISSUE-068.
7. Stop the standalone server.

**STOP:** any D1 failure ⇒ §2 classification (dev-data drift is an environment
problem, not a candidate defect). Any D5 inconsistency ⇒ REJECT. Hydration rate
**≥ 5.0 % (≥ 72 errors)**, a candidate-attributable crash / fatal browser
failure, or a new systematic failure class ⇒ §2 classification.

### R7 — open-issue and disposition adjudication
*Depends on: R1 and R6 evidence.*

Record, against §4, the disposition of ISSUE-054, 072, 073, 076, 081, 040, 083,
082, 086, 068 — separating **tracked defect limitations** from **verified
operational dispositions** per §2.3 — plus the standing prohibitions:

- **ISSUE-077** — do not set any `frontendTheme` other than `classic`.
- **ISSUE-076** — do not widen `grid_solver.audience` to `public`.
- **ISSUE-082** — do not use bulk approve.
- **ISSUE-054 / D14** — the 22 Under 22 importer is deployed and **must not be
  executed**; its data load is out of ISSUE-084 scope.
- **ISSUE-068** — stays **open**. F4 stands: `924ad69` matches the H7 experiment
  on component, hook and behaviour, but the expected diagnostic build was never
  proven live and H7 was never validated. The R6.6 result does not change this.
- **`revalidatePath` in `src/app/admin/current-season/actions.ts` (~L75-80)** —
  recorded as a **suspected, non-blocking interaction** only. *Established:* that
  file calls `revalidatePath` inside a server action, and prior-session evidence
  reported a Next 15.5 client hang involving `revalidatePath`-in-action. *Not
  established:* that this exact action is reproducibly affected at
  `CANDIDATE_SHA`. **No ledger issue is created from prior-session memory
  alone.** A separate issue may be proposed only on targeted current-candidate
  evidence, or an existing authoritative issue explicitly covering this exact
  path.
- **D12** — apply the §1.3 adjudication: `> 0` ⇒ PASS; `= 0` ⇒ verified
  operational disposition, feature inert, recorded. **No new issue is opened
  solely because the table is empty**, and no dev-comparison threshold applies.
- **D7 / D10** — operator answers recorded.

### R8 — topology re-proof and cleanup
*Depends on: R1–R7 resolved.*

**The candidate's identity is its SHA, not a position below a moving branch.**
`CANDIDATE_SHA == dev~1` is **not** an invariant and is not asserted.

Prove, at execution time:

1. the **expected current `origin/main` SHA** — `9be7f26d37579104d633e1f0af647cb635ff100e`
   as recorded at authoring; re-read and record whatever it actually is;
2. that `origin/main` **remains an ancestor** of `CANDIDATE_SHA`;
3. that `a32a0a1abacbf49a979343094b28c7983ebbea33` **remains an ancestor** of
   `CANDIDATE_SHA`;
4. that **`CANDIDATE_SHA` itself is unchanged** — the commit object resolves and
   its tree hash matches the value recorded in R2 step A;
5. that the **post-candidate delta** `CANDIDATE_SHA..origin/dev` is bounded,
   inspected commit by commit, and touches **only** these permitted paths:
   `IssuesIndex.md`, `issues.md`, `CHANGELOG.md`, `AFLDB-ISSUE-*.md`,
   `WORKFLOW.md`, `CLAUDE.md`, `README.md`, `docs/**/*.md`;
6. that **no** runtime, schema, importer, dependency, deployment or application
   source change appears after the candidate — specifically nothing under `src/`,
   `tools/`, `deploy/`, `tests/`, `package.json`, `package-lock.json`, any
   `*.config.*`, or `.env.example`.

**HALT and classify** if the post-candidate delta contains anything outside the
allowlist. It does not automatically invalidate `CANDIDATE_SHA` — it may mean the
candidate should be re-cut — but it must be adjudicated, not absorbed.

**Deterministic cleanup:** confirm the path is exactly the disposable worktree
(`git worktree list`); move evidence out first; remove the copied env file and
`node_modules` explicitly; `git status --porcelain` empty;
`git worktree remove /tmp/afldb-release-0a86255`; confirm it is gone.
**`--force` is not the mechanism** — if it seems necessary, **HALT** and
understand why.

### R9 — promotion checkpoint
*Depends on: R8 complete.*

**Prerequisites, all displayed together before anything is asked of the user:**

- candidate verdict **APPROVED AS RELEASE CANDIDATE** (§5);
- every production prerequisite cleared (D5 audience, D3 theme, D8 Caddyfile);
- R8 topology current;
- R0's external-automation state known and re-confirmed;
- the **exact `CANDIDATE_SHA`** displayed in full;
- the **exact current `origin/main` SHA** displayed in full.

Then **STOP and request explicit user approval for the Git promotion.** Approval
of this runbook is **not** approval to push.

Only after explicit approval, the user executes the exact fast-forward:

```bash
git push origin 0a862557bad9ad1a6abc2522a90038a779847fed:refs/heads/main
```

- a **normal** push — **no force, ever**;
- promotes `main` to **exactly `CANDIDATE_SHA`**;
- does **not** merge and does **not** promote the dev tip;
- if `origin/main` has moved unexpectedly the push **fails and the procedure
  HALTs** rather than overwriting it.

Then verify:

```bash
git ls-remote origin refs/heads/main     # must equal CANDIDATE_SHA
```

and confirm no external automation unexpectedly mutated production (re-check the
R0 signals and the production service state). Record **ISSUE-087 promotion
complete**.

**Production deployment does not occur inside ISSUE-087.** After a successful
`main` promotion:

- ISSUE-087 can close;
- **`AFLDB-ISSUE-084` remains a separate production deployment / data-integrity
  runbook**, still HALTed at P0.2;
- ISSUE-084 restarts from its required re-entry point with **fresh P0.1/P0.2
  evidence** and establishes `<TARGET_SHA>` on its own terms — it is **not**
  inherited from ISSUE-087.

**Nothing is pushed during validation.**

---

## 4. Expected failure signatures

An expected failure is acceptable **only** when its exact signature matches. Any
materially different failure HALTs and is classified under §2.

| Issue | Expected signature at the candidate | Unexpected ⇒ HALT |
|---|---|---|
| **054** | 4 failures in `tests/under-22-importer.test.ts` on **Windows only** — `between()` misses a 3-newline marker against a CRLF checkout. **Linux 7/7 green** | Any failure on **Linux** |
| **072** | `tests/site-settings.test.ts` — "supplies every default from an empty table" fails; the expected-defaults object is stale after `frontendTheme` (`d5243ba`) | A *different* assertion failing in that file |
| **073** | `tests/integration/fk-indexes.test.ts` fails on exactly `data_edits(admin_user_id)`, `player_link_resolutions(admin_user_id)`, `player_link_resolutions(player_id)`, `player_link_suggestions(resolved_by)`. Pre-existing (056/057) | More than those four FKs failing |
| **076** | Not a test failure. `won_final_at_venue` grids can hit SQLSTATE `57014` at ~5.05–5.14 s | Reproduction on a **public** (non-admin) request ⇒ D5 deployment-configuration `E` |
| **081** | `awards-reload-links.test.ts` and `release-gates.test.ts` have **never** been run together; the analogous draft race once produced 3,461 vs 3,459. Enforced here by R5-f / R5-g | Any count mismatch **when run isolated** |
| **040** | `npm run lint` maps to deprecated `next lint`; ESLint unconfigured ⇒ unusable | — do not gate |
| **083** | No failure expected — importers are tested as `afldb_owner`, so missing-grant defects are invisible. ISSUE-084 deploys but never runs them | — record only |
| **082** | No failure expected; latent stale-form window | — record only |
| **086** | No failure expected; ISSUE-084 runs no reload | — record only |
| **068** | Intermittent React #418 under production-style load. The R6.6 gate is a **fixed count**, not a comparison: **< 5.0 % (< 72 errors at 1,440)**. The historical 3.29 % / 3.63 % production figures are pre-H7 context only and are **not** an input | Rate **≥ 5.0 % (≥ 72)**, a candidate-attributable page crash / fatal browser failure, or a new systematic failure class |

---

## 5. Verdict rules

**APPROVED AS RELEASE CANDIDATE** — all of:

1. D6 clean, and **no tracked file under version control was modified** at any
   point during validation;
2. every gate D1–D15 reached PASS, a **tracked defect limitation** satisfying all
   three tests in §2.3, or a **verified operational disposition** positively
   demonstrated;
3. every observed failure matched an **exact** §4 signature, or was classified
   per §2 as an environment problem, repaired, and the affected gate re-run
   green;
4. D8's complete reviewed diff shows no change to which hostname serves the
   application or where it is proxied;
5. D5's production value is absent or restrictive — **or** the approved
   production prerequisite has been executed and verified with its rollback
   recorded;
6. D3's production value is absent or `classic`; **or**, if it was non-`classic`,
   an explicitly approved production prerequisite restored it to `classic`
   through the reviewed admin path and the read-only D3 check was **re-run
   successfully**; **or** ISSUE-077 was fixed in a reviewed successor candidate
   that restarted the applicable candidate validation. **A decision alone is not
   sufficient while the theme defect is manifesting;**
7. D12 is PASS (`period_rows > 0`) or a recorded verified operational
   disposition (`period_rows = 0`), with the candidate's NULL handling green in
   D2b;
8. R0's external-automation gate answered: **nothing reacts to a push to
   `main`**;
9. R8's six topology proofs passed and cleanup completed without `--force`.

**REQUIRES VALIDATION** — the state at authoring, and the state after any partial
run: one or more gates unexecuted, evidence pending, an operator confirmation
outstanding, or any **unexplained** failure under §2. Not a failure; not an
approval.

**REJECTED** — any candidate-intrinsic `E`: any failure classified under §2 as a
**candidate runtime/source defect** or a **candidate tracked-test defect**,
including D6 diagnostics genuinely caused by tracked candidate source; a D1
render/route defect or a stale tracked expectation in `journeys.spec.ts`;
D2 / D13 / D15 / D14(Linux) failures traced to candidate code or a candidate
test; D5's candidate-side response inconsistent with the configured audience; or
D9's server-side property found not to hold. Consequence: the §2.2 successor
protocol.

**Deployment-configuration `E` is a distinct, non-rejecting outcome.** D5
returning `"public"`, or D8 requiring a Caddy change, blocks **promotion** without
rejecting the candidate, because the code is valid under a supported restrictive
configuration. Cleared only by an explicitly approved production prerequisite
(existing value captured, new value specified, verification specified, rollback
specified) or by a successor candidate.

**No `E` may be hidden inside a limitation or a disposition.** A tracked defect
limitation requires an issue ID, a bounded matched signature, and **no new
publicly reachable defect under the production configuration actually in force**
— which is precisely why a `"public"` grid audience is an `E` and not
"ISSUE-076, tracked". A verified operational disposition requires positive
demonstration, not assumption.

---

## 6. Hard constraints held at authoring

- No candidate worktree created.
- No `npm ci`, typecheck, test, build, migration or privilege reconciliation run.
- No SQL, no SSH, no production check executed.
- No Git branch or `main` mutation; nothing pushed.
- No production mutation.
- `AFLDB-ISSUE-084.md` unchanged; ISSUE-084 remains HALTed at P0.2 and is not
  advanced by any gate here.
- No `<TARGET_SHA>` fixed inside ISSUE-084.
- No ledger issue created from prior-session memory alone.
- No historical NL telemetry deleted.

Execution begins in a fresh implementation session, per `WORKFLOW.md` §4.
