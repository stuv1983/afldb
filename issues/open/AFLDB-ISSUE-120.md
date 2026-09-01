# AFLDB-ISSUE-120 — Public-surface abuse hardening before launch: NL /search has no rate limit; two minor input-robustness gaps

- **Status:** Open
- **Created:** 2026-08-31 (full-codebase review)
- **Severity:** Medium (primary finding); the two secondary findings are Low
- **Area:** Security / Production reliability / NL search / Telemetry

## 1. Problem statement

Three related public-surface findings from the 2026-08-31 full-codebase security review.
All were verified in current `main` source. None is exploitable **today** in a way that
compromises data, but the primary finding becomes a real abuse vector the moment the beta
gate is removed for public launch.

### F1 (MEDIUM, primary) — the NL `/search` pipeline has no rate limit

- `src/app/search/page.tsx:71` — every GET with `q` runs `globalSearch` → NL
  canonicalise/parse/plan/compile/execute → one `nl_search_log` INSERT
  (`src/db/queries/nl/log.ts:138`, `after()`-deferred, with a correlated-subquery
  parent-search lookup).
- Every comparable public surface is limited: `/api/search/autocomplete` 60/min per IP
  (`route.ts:14`), the search feedback action 12/15 min
  (`src/app/search/feedback-action.ts:16`), `/api/health-event` 120/min per IP. The NL
  branch itself has **no** `RateLimiter`.
- Exposure today: `middleware.ts:117` keeps `/search` behind the beta gate
  (`AFLDB_BETA_GATE`), so only admitted users reach it. This is why the finding is a
  credible risk, not a live defect.
- Trigger once the gate is off: a single anonymous source loops `GET /search?q=<varied>`
  → unbounded `nl_search_log` growth and DB pool pressure from potentially heavy NL
  aggregate SQL. Per-row cost is bounded (question sliced to 200 chars; log failures are
  swallowed by design), but row **count** and query cost are not.

### F2 (LOW) — `/api/health-event` buffers an unbounded request body

- `src/app/api/health-event/route.ts:64` uses `await request.json()` with no size cap.
- The early-access route solved exactly this with `readBounded` plus a Caddy
  `request_body max_size 32KB` block, but the Caddy cap covers only that path
  (`deploy/Caddyfile.production:132`); `/api/health-event` is public and pre-beta-gate.
- All fields are truncated before insert (`src/db/queries/app-health.ts:83-93`) and the
  120/min-per-IP limiter bounds frequency, so the residual is transient memory per
  oversized body — hardening, not a data risk.

### F3 (LOW) — two prototype-key lookups can 500 on crafted input

- `src/db/queries/records.ts:159` — `CAREER_COLUMNS[category]` with `category` from the
  URL; `src/db/queries/aflw.ts:786-793` — `AFLW_MATCH_OUTCOME_FILTERS[outcome]`.
- A key like `constructor` returns a truthy inherited function, passes the `if (!column)`
  guard, and reaches `sql.unsafe` as fixed native-code stringification → SQL syntax error
  → 500 instead of a clean empty/404 response. **Not injection** — the text is never
  attacker-controlled SQL. `records.ts:130` already does it right with
  `Object.hasOwn(RECORD_CATEGORIES, …)`.

## 2. Evidence

2026-08-31 review, direct source inspection (agent-assisted, key claims independently
re-verified): no `RateLimiter` import anywhere under `src/app/search/` except the feedback
action; `request.json()` confirmed at `health-event/route.ts:64`; `CAREER_COLUMNS` is a
plain object literal indexed without `Object.hasOwn`. The same review confirmed the
**clean** baseline these sit against: all ~90 `sql.unsafe` sites in `src/db/queries`
resolve from module-constant allowlists with bound values; every admin server action and
route handler carries its own authz guard; no hardcoded secrets in `src/` or `deploy/`.

## 3. Root cause

The NL search pipeline was built and operated entirely behind the beta gate, so per-IP
limiting was never needed; the launch precondition was simply never recorded anywhere.
F2/F3 are ordinary hardening omissions on low-traffic paths.

## 4. Required invariant

Before `AFLDB_BETA_GATE` is disabled (public launch), every unauthenticated request path
that executes non-trivial SQL or writes a row must be per-IP rate limited, and every
unauthenticated body-accepting route must bound its body size before buffering.

## 5. Minimum implementation scope

1. **F1:** add a per-IP `RateLimiter` (reuse `src/lib/auth/rate-limit.ts`) on the NL
   branch of the search page (or inside `globalSearch`'s NL entry) — generous enough for
   real interactive use (e.g. 30/min), returning the existing "try again" UI path, never
   a 500. Do not limit admitted-admin traffic differently unless trivial.
2. **F2:** apply the early-access route's `readBounded` pattern (or add a Caddy
   `request_body` cap for `/api/health-event`) at 32KB.
3. **F3:** switch the two lookups to `Object.hasOwn` guards matching `records.ts:130`.

## 6. Non-goals

- No change to NL semantics, telemetry schema, or `nl_search_log` retention.
- No global middleware rate limiting; per-route only, matching existing patterns.
- No change to the beta gate itself.
- Does not block ISSUE-110's NL semantic work or its large-scale validation runs
  (those run authenticated/internal).

## 7. Regression tests and positive controls

- Unit: limiter denial path returns the friendly UI state, not a throw; an allowed
  request under the threshold still answers (positive control).
- F3: `GET /records/constructor` (and the AFLW outcome equivalent) returns the clean
  empty/404 behaviour; an existing valid category still returns rows (positive control).
- F2: oversized body → 4xx without buffering; a normal health event still inserts.
- Note: the per-worker (non-shared) limiter map is documented and acceptable at current
  scale — do not build distributed limiting for this issue.

## 8. DB / migration / performance implications

None. No schema change, no migration, no privilege change. Rate limiting slightly
reduces worst-case DB load; no steady-state performance effect.

## 9. Operator validation

After implementation on dev: loop >limit NL searches from one IP and confirm the
friendly limit response plus no further `nl_search_log` rows for that IP within the
window; confirm normal browsing is unaffected.

## 10. Safety constraints

- The limiter must fail open on internal errors (search availability outranks limiting).
- Never let a limiter or body-cap failure turn a successful search into a 500 — same
  principle as `logNlSearch`'s swallow-on-failure contract.

## 11. Exact next action

Implement F1 (the launch-blocking item) in a focused session: add the per-IP limiter to
the NL search entry with its unit tests, then F2/F3 as small follow-on edits in the same
pass. Verify with the operator validation in §9. This issue should be closed or
explicitly re-adjudicated before any decision to disable `AFLDB_BETA_GATE` in production.

## 12. F1 implementation checkpoint ? complete

Completed 2026-09-01 on branch `codex/issue-120`.

### Implementation

The public AFL/VFL NL `/search` path now has a per-worker, per-IP limiter before
`globalSearch()` is invoked.

- new boundary: `src/app/search/rate-limit.ts`;
- reuses `src/lib/auth/rate-limit.ts`;
- budget: 30 requests per 60 seconds per IP;
- missing client IP uses the existing-style shared `ip:unknown` bucket;
- denied requests return a typed `rate_limited` state before `globalSearch()`,
  so they do not execute the NL pipeline or create the deferred
  `nl_search_log` write;
- limiter/IP-resolution exceptions are logged and fail open, preserving search
  availability per ?10;
- `src/app/search/page.tsx` renders a friendly
  "Too many searches / Please try again shortly." state;
- AFLW search is unchanged and is not charged against this NL limiter;
- no NL semantics, telemetry schema, beta gate, migration or privilege changes.

### Validation

Operator-run:

    npx tsc --noEmit
    PASS

    npx vitest run tests/search-rate-limit.test.ts
    6/6 passed

The focused suite proves:

- an allowed request executes its search exactly once;
- an over-limit request never executes its search;
- requests are keyed by client IP;
- the unknown-IP fallback is deterministic;
- failure while resolving the IP fails open;
- failure inside `RateLimiter.check()` also fails open;
- the configured budget is exactly 30 per 60,000 ms.

The expected stderr emitted by the two fail-open tests is the production diagnostic
log from the caught limiter failures, not a test failure.

### Remaining ISSUE-120 work

F2 and F3 remain unimplemented.

Exact next action: checkpoint F1 in Git, then implement F2 ? bound
`/api/health-event` request bodies to 32KB before JSON parsing, preserving the
normal health-event positive path.
