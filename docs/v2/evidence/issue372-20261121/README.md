# AFLDB-ISSUE-372: ISR 404 → 200 inventory, invalidation reach and options (21 November 2026)

**Verdict.** No remaining ISSUE-371-class defect in `src/`: no `revalidatePath()` call pairs a type with a concrete dynamic
path, and none passes a route pattern without a type. A repository-wide source guard now fails the unit suite if either
form is reintroduced (§4). The broader cross-worker gap is real but narrow, and it needs an owner decision (§5). ISSUE-372
cannot close until that decision is made.

Analysis was done from source at `2efb81dc` plus the framework at `node_modules/next` 16.3.1. There was no production
contact and no change to DEV's `afldb.service`. The mechanism is in `docs/v2/evidence/issue371-20261121/README.md` §3.

## 1. Framework facts this rests on (read off the installed package)

| Fact | Where |
|---|---|
| `revalidatePath(p, type)` expires `_N_T_<p>/<type>`. `revalidatePath(p)` expires `_N_T_<p>` and only warns for a pattern | `next/dist/server/web/spec-extension/revalidate.js:86-106` |
| A cached page carries `_N_T_/layout`, `<prefix>/layout` per segment of its **route file**, `<route>/page`, and its concrete pathname | `next/dist/server/lib/implicit-tags.js:15-41, 56-70` |
| Invalidation lives in each worker's own memory (`tagsManifest` and an in-memory LRU in front of the file cache) | `src/lib/acquisition/season-revalidation.ts` header (ISSUE-134) |
| A worker that did not write an on-demand entry treats it as stale after 1 s and regenerates it in the background. A stale **404** regenerated that way persists the not-found `<head>` over a correct 200 body | ISSUE-371 README §3 |

So a 404 → 200 transition is safe only on a worker whose cache was explicitly invalidated before its next request for
that path. Any other worker serves the 404 once, then a 200 with title "Page not found | AFLDB" and `noindex`. That lasts
until its own ISR window lapses: **1 h** for `revalidate = 3600` routes, **24 h** for `revalidate = 86400` routes. The body
is always correct.

## 2. Which routes can go 404 → 200

The ISR routes are the `page.tsx` files with `export const revalidate`. A route can go 404 → 200 only if it has a dynamic
segment, `dynamicParams` left at its default (none sets it), and a `notFound()` that depends on database rows. Every
`force-dynamic` route is out of scope because nothing is cached. That covers `/draft/[year]`, all of `/aflw/**`,
`/coaches/[slug]`, `/players/[slug]/matches`, `/venues/[slug]/matches` and every admin page. Static ISR routes (`/`,
`/aflw`, `/awards`, `/coaches`, `/records`, `/records/*`) have no 404 state.

| Route | Window | `notFound()` on missing rows | Realistic 404 → 200 event | URL predictable before it exists? |
|---|---|---|---|---|
| `/seasons/[year]` | 1 h | `page.tsx:89,92` (no `seasons` row) | **2027 `seasons` row created (ISSUE-350)** | **Yes**: `/seasons/2027` is guessable and linked by habit |
| `/brownlow/[year]` | 1 h | `page.tsx:78,81` (no season votes) | First publication of a season | **Yes**. Closed by ISSUE-371 |
| `/awards/[slug]/[season]` | **24 h** | `page.tsx:75,79,89` (no winners or nominations) | A season's award first recorded (Coleman publication, awards admin) | **Yes**, e.g. `/awards/coleman-medal/2027` |
| `/players/[slug]` | 1 h | `page.tsx:162,165` | New player row: AFL API settle player bridge (debutant), admin create-and-link | Low: the id is minted at insert, so nothing links it before it exists |
| `/matches/[id]` | 1 h | `page.tsx:83,86` | New match row: AFL API settle, admin match create | Low: internal sequential id |
| `/venues/[slug]` | 24 h | `page.tsx:115,118` | New venue | Low: slug plus id |
| `/clubs/[slug]` | 24 h | `page.tsx:100,103` | New club identity (for example a future licence) | Medium: guessable slug; rare, owner-run event |
| `/awards/[slug]` | 24 h | `page.tsx:76` | New award definition | Low; rare |
| `/honour-teams/[slug]` | 24 h | `page.tsx:49,52` | New honour team | Low; rare |
| `/records/[category]` | 1 h | `page.tsx:92` (definition is code, not rows) | None at runtime; only a deploy changes it | n/a |

## 3. Which invalidations reach them

| Writer | Call | Reaches | Workers |
|---|---|---|---|
| **AFL API nightly settle** (`deploy/afldb-settle-afl-api.sh`, the only enabled match/stats settle on production) | **none**. D-232-3 = keep: no automatic `revalidateSeason()`, and the unit unsets `AFLDB_REVALIDATE_SECRET` (`deploy/afldb-settle-afl-api.service:47-57`) | nothing | none. Pages refresh by ISR window only |
| AFL API Brownlow chain (`deploy/afldb-settle-afl-api-brownlow.sh:57`) | none (D-232-3) | nothing | none |
| AFL Tables settle (`tools/current-season/settle-afltables.ts:302-311`) | `revalidateSeason()` fan-out | `/seasons/<y>`, `/brownlow/<y>` | all, if configured. **Retired and timer disabled on production** (`docs/deployment.md:942-946`) |
| Brownlow finalise/correct/publish (`src/app/admin/brownlow/actions.ts:128-146, 298-306`) | concrete `/seasons/<y>`, `/brownlow/<y>`, `/matches/<id>`; patterns `/players/[slug]`, `/clubs/[slug]`, `/records/[category]`; `fanOutSeason()` | as listed | acting worker; `/seasons/<y>` and `/brownlow/<y>` on **all** workers only when the web service has `AFLDB_REVALIDATE_URL`/`SECRET` |
| `POST /api/internal/revalidate-season` (`route.ts:181-184`) | `/seasons/<y>`, `/brownlow/<y>` | as listed | the worker that answers; the caller loops until every ordinal answered |
| Admin awards/Coleman/operations (`/admin/awards/revalidate`, `src/lib/admin/revalidate-route.ts:31-36`) | concrete allowlisted paths incl. `/awards/<slug>/<season>`, `/players/<slug>-<id>`, `/clubs/<slug>` | as listed | acting worker only |
| Admin coaches, draft, records, season-lists revalidate routes | concrete allowlisted paths (same helper) | as listed | acting worker only |
| `/admin/operations/brownlow/revalidate` (`route.ts:7-10`) | `/brownlow`; patterns `/brownlow/[year]`, `/players/[slug]`, `/clubs/[slug]`, `/seasons/[year]`, `/records/[category]` | every page of those routes | acting worker only |
| Player links (`src/app/admin/player-links/public-link-pages.ts:15-23`, `actions.ts:296-298`) | patterns for awards, clubs, honour teams, seasons; `/hall-of-fame`, `/draft`, `/players` (force-dynamic pages, so no-ops), `/records/first-kick-goal` | as listed | acting worker only |
| Data editor, settings, content (`'/', 'layout'`) | root layout tag = every cached page | everything | acting worker only |

## 4. The ISSUE-371 bug class: none remains, and a guard now holds that

The audit covered every `revalidatePath(` in `src/`: 59 calls, all parsed.
- **Typed calls.** Each one names an existing route pattern (`/players/[slug]`), an existing static route (`/brownlow`,
  `/admin/brownlow`), or a layout prefix (`/`, `/admin/nl-search`). The only identifier argument
  (`/admin/operations/brownlow/revalidate/route.ts:9`) iterates a literal array of patterns.
- **Untyped calls.** Each one is a concrete path or a variable carrying a concrete path. The variables are the
  allowlisted request paths in `revalidate-route.ts:35` and the season paths in `revalidate-season/route.ts:184`. No
  untyped call passes a pattern.

**Guard (new, in the existing ISR-invalidation contract suite).** `tests/settle-season-revalidation.test.ts`, describe
"AFLDB-ISSUE-371/372 — every revalidatePath call names a tag a page carries". It scans `src/**/*.ts(x)` with comments
stripped and asserts:
1. Every `revalidatePath(` occurrence is parsed, and there are more than 40 of them, so the scan is not vacuous.
2. A typed call resolves to a route file: `page` needs `src/app<path>/page.tsx`, and `layout` needs a page at or under
   the prefix. A template literal with an interpolation plus a type is refused outright. That is the ISSUE-371 form.
3. No pattern is passed without a type.
4. Next still appends the type, read off `node_modules/next/dist/server/web/spec-extension/revalidate.js`.

Red/green: see §6.

## 5. Owner decision: the cross-worker gap

**The gap.** Only `/seasons/<y>` and `/brownlow/<y>` have an all-worker path (the fan-out), and only when the web
service is configured for it. Every other 404 → 200 transition reaches at most the acting worker, and the nightly AFL API
settle reaches no worker. The exposure is a wrong `<head>` (title "Page not found", `noindex`) over a correct body for one
ISR window on each worker that was not invalidated. There is no data effect.

| Option | What it takes | Covers | Cost and risk |
|---|---|---|---|
| **A. Accept one window, plus two operational guards** | (1) The ISSUE-350 runbook gains one step: after creating the 2027 `seasons` row, post the existing fan-out for 2027 (`revalidateSeason`, as the Brownlow action does). (2) Confirm, read-only, that production's web service sets `AFLDB_REVALIDATE_URL`/`SECRET`. Without them the ISSUE-371 publish fan-out is acting-worker only (ISSUE-371 README §6) | `/seasons/2027`, the one high-likelihood case not already covered, and `/brownlow/<y>` | No code. Residual: debutant players, new matches and venues (low likelihood: the URL is minted at insert), plus `/awards/<slug>/<season>` on first publication of a season (up to 24 h on non-acting workers) |
| B. Extend the season fan-out to award-season pages | `revalidate-season` also expires `/awards/[slug]/[season]` (pattern, every worker; the input stays an integer year). Coleman/awards publication calls `revalidateSeason()` after commit as the Brownlow action does | A, plus award seasons | Small code change in a secret-gated route; every award-season page re-renders once per worker on next request. Needs the production revalidation env from A(2) |
| C. General fan-out, including the nightly | The route takes a fixed enum of patterns (players, matches, venues, seasons). The AFL API settle posts it after commit | Everything | **Reverses D-232-3** and puts the revalidation secret back on the settle unit. Every cached player/match page re-renders lazily after each nightly that changed rows |
| D. Stop caching 404s for these routes | `force-dynamic`, or `dynamicParams = false` | Everything | Rejected: `dynamicParams = false` 404s every unprerendered page, and `force-dynamic` costs about 1.5-2 s per request (comments at `players/[slug]/page.tsx:52-70`) |

**Recommendation: A now. Take B only if the owner wants award-season pages covered before the 2027 awards.** C is not
proportionate to a Low, head-only, one-window defect, and it reopens a recorded owner decision.

**Consequence of A.** ISSUE-372 is closed as an accepted residual. These still show "Page not found" / `noindex` for at
most one window on a worker that was not invalidated:
- a player or match page someone requested before its row existed;
- a first-published award season (up to 24 h).

A deploy or restart clears it, as does the next window. The guard in §4 keeps the ISSUE-371 form from returning.

**Can ISSUE-372 close?** Not yet. It closes on the owner choosing A (with the two guards done or recorded as runbook
steps), or after B or C is implemented and verified.

## 6. Verification

Unit runs were on the DEV host from the follow-up branch: `tests/settle-season-revalidation.test.ts`, with the guard
block run on its own.
- **Green at the branch tip:** the guard passes.
- **Red with the pre-ISSUE-371 `src/app/admin/brownlow/actions.ts`** (from `40fb1c68`, overlaid temporarily and then
  restored): the guard fails and names the concrete-path calls.

Counts are in `docs/v2/evidence/backlog-20261121/TIP-VERIFICATION.md` §C.
