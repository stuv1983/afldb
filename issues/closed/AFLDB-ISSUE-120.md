# AFLDB-ISSUE-120 — Public-surface abuse hardening before launch: NL /search has no rate limit; two minor input-robustness gaps

- **Status:** Resolved 2026-09-01 — static/unit closure (§12–§15); dev live end-to-end acceptance (§16)
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

Fulfilled on dev 2026-09-01 — evidence in §16. This must be run through an
authenticated beta browser session against the site origin
(`http://10.0.40.100:8090/search?q=…`); an unauthenticated request to the app
origin is 307-redirected by the beta gate before the NL rate-limit boundary
executes and does **not** validate F1 (§16.1).

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

## 13. F2 implementation checkpoint ? complete

Completed 2026-09-01 on branch `codex/issue-120`.

### Implementation

`/api/health-event` now bounds request bodies to 32 KiB before JSON parsing.

- reuses the early-access route's streaming `readBounded` pattern;
- checks an honest oversized `Content-Length` immediately;
- independently enforces the same limit while reading the stream, so chunked
  or dishonest requests cannot force the whole body to be buffered first;
- oversized input returns HTTP 413;
- malformed in-bound JSON continues to return HTTP 400;
- normal valid health-event handling is otherwise unchanged;
- no schema, migration, privilege or Caddy changes were required.

### Validation

Operator-run:

    npx vitest run tests/health-event-route.test.ts
    3/3 passed

The focused suite proves:

- an oversized body is rejected with 413 and never reaches `logAppHealthEvent()`;
- the streaming limit still rejects oversized input when no Content-Length is present;
- a normal valid event retains the existing 204 response and write path.

### Remaining ISSUE-120 work

F3 remains unimplemented.

Exact next action: checkpoint F2 in Git, then harden the two prototype-key lookups
with `Object.hasOwn` guards and focused positive/negative controls.

## 14. F3 implementation checkpoint ? complete

Completed 2026-09-01 on branch `codex/issue-120`.

### Implementation

Request-derived catalogue keys are now checked with `Object.hasOwn` before indexing:

- `getCareerRecord()` rejects inherited Object.prototype keys before selecting a SQL column;
- `runAflwMatchSearch()` ignores inherited keys passed as AFLW match outcomes;
- valid registered career categories and AFLW outcomes retain their existing behaviour.

This prevents crafted values such as `constructor` from resolving through the prototype chain and reaching malformed SQL construction.

### Validation

Operator-run:

    npx vitest run tests/catalogue-lookups.test.ts tests/aflw-match-outcome-guard.test.ts
    10/10 passed

    npx tsc --noEmit
    passed

    git diff --check
    passed

Regression coverage proves inherited keys are rejected while registered catalogue values remain accepted.

### ISSUE-120 implementation status

All three findings are implemented:

- F1 ? NL search per-IP rate limiting: complete.
- F2 ? /api/health-event 32 KiB streaming body cap: complete.
- F3 ? request-derived prototype-key hardening: complete.

Exact next action: commit F3, then perform ISSUE-120 final closeout validation and move the runbook to issues/closed.

## 15. Final validation and closure

Resolved 2026-09-01.

### Final validation

Operator-run:

    npx vitest run       tests/search-rate-limit.test.ts       tests/health-event-route.test.ts       tests/catalogue-lookups.test.ts       tests/aflw-match-outcome-guard.test.ts

Result:

    4 test files passed
    19/19 tests passed

The two stderr messages in the search-rate-limit suite are intentional assertions
of the fail-open contract when IP resolution or the limiter itself throws.

Additional validation:

    npx tsc --noEmit
    passed

    git diff --check
    passed

    git status --short
    clean

### Resolution

F1, F2 and F3 are complete.

- Public NL search now has a generous per-IP limiter and a friendly denial path.
- Limiter/internal IP-resolution failures fail open rather than turning valid searches into 500s.
- /api/health-event now enforces a 32 KiB streaming request-body cap before JSON parsing.
- Oversized health-event bodies return 413 and do not reach the write path.
- Request-derived career-record and AFLW outcome catalogue keys now require own-property membership.
- Crafted prototype keys such as constructor no longer reach malformed query construction.
- No schema, migration, privilege, beta-gate or NL-semantics changes were made.

ISSUE-120 is resolved.

> **Scope of this checkpoint:** §12–§15 record unit, typecheck and static-analysis
> evidence only. The §9 operator validation — a real over-limit loop against the
> deployed `/search` page plus a telemetry check — had **not** been performed at
> the time of this closure. It was completed on dev on 2026-09-01 and is recorded
> in §16; §12–§15 are left unchanged as the earlier static-closure checkpoints.

## 16. Post-closure dev live acceptance — F1 end-to-end, F2 413 (2026-09-01)

Performed against deployed dev commit `21d7c60` ("Merge AFLDB-ISSUE-120 public
surface hardening"). F1 and F2 now have true end-to-end live acceptance. §12–§15
remain the earlier static/unit closure checkpoints and are unchanged.

### 16.1 The first live F1 attempt was invalid — the requests never reached the NL search path

The initial attempt sent requests directly to the app origin:

    http://127.0.0.1:3100/search?q=Who%20has%20played%20the%20most%20games%3F

- 140 requests; tally `normal=140`, `limited=0`, `errors=0` — the limiter appeared
  never to trigger.

Investigation proved these requests never reached `src/app/search/page.tsx`:

- a direct `curl` of that URL returned:

      HTTP/1.1 307 Temporary Redirect
      location: http://10.0.40.100:8090/beta?from=%2Fsearch

- the service request trace showed `status=307 method=GET url=/search?q=Who...`;
- the beta gate (`middleware.ts:117`) intercepts unauthenticated requests **before**
  `runNlSearchWithRateLimit()` executes, so the NL branch and its per-IP limiter
  were never exercised;
- the test client (`urllib`) silently followed the 307, so every "normal" HTTP 200
  in the 140-request tally was a redirected hit on the beta landing page, not a
  search response.

The 140-request run therefore proves nothing about F1 and is retained here only as
the record of an invalid methodology. Any earlier reading of it as a passing F1
live test is withdrawn.

### 16.2 Correct F1 live methodology — authenticated beta browser session

F1 was then validated from a real beta-authenticated browser session against the
site origin (through the beta gate, not around it):

    http://10.0.40.100:8090/search?q=Who%20has%20played%20the%20most%20games%3F

- browser `fetch` loop; `credentials: same-origin`, `cache: no-store`;
- requests routed through the authenticated normal site path so they reach
  `src/app/search/page.tsx` → `runNlSearchWithRateLimit()`;
- denial detected by the response body marker `Too many searches`.

### 16.3 F1 live result — denied exactly at the configured threshold

- requests 1–30: HTTP 200, `limited=false`;
- request 31: HTTP 200, `limited=true`;
- final tally: `limitedAt: 31`, `hits: {4: 31}`.

This confirms end-to-end that:

- the requests reached the real `/search` page and executed the NL rate-limit boundary;
- limiter state persisted in a single worker (worker 4) across the loop;
- the 31st request in the window was denied at exactly the configured
  30-requests / 60-seconds budget;
- the friendly denial path is HTTP 200 with body text `Too many searches`, never a
  500 — matching §10 and the §7 friendly-UI positive control.

### 16.4 F1 telemetry acceptance — the denied request wrote no row

Verified read-only via `AFLDB_OWNER_DATABASE_URL`. `nl_search_log` columns used:
`at`, `question`.

    SELECT
      COUNT(*) AS matching_rows,
      MIN(at)  AS first_seen,
      MAX(at)  AS last_seen
    FROM nl_search_log
    WHERE question = 'Who has played the most games?'
      AND at >= NOW() - INTERVAL '10 minutes';

Result:

    matching_rows = 30
    first_seen    = 2026-09-01 18:49:35.616095+10
    last_seen     = 2026-09-01 18:49:44.079766+10

Exactly 30 rows for 31 requests: the denied 31st request returned before
`globalSearch()` and created no `nl_search_log` row, confirming the §5 / §7
invariant that a limited request does not execute the NL pipeline or its deferred
telemetry write.

### 16.5 F2 live acceptance — oversized body rejected with 413

An oversized `POST /api/health-event` on deployed dev returned **HTTP 413**,
confirming the §13 32 KiB streaming body cap on the live service.

### 16.6 Instrumentation hygiene

Temporary diagnostic instrumentation used during the 16.1 investigation was **never
committed**: it was removed from the running dev checkout, and dev was rebuilt and
restarted cleanly afterwards. Post-restart dev health:

    {"status":"ok","database":"ok","latencyMs":29}

No implementation, test, schema or database change resulted from this
live-acceptance work.

### 16.7 Status after live acceptance

- **F1** — per-IP NL `/search` rate limit: **dev live end-to-end acceptance complete**
  (16.2–16.4).
- **F2** — `/api/health-event` 32 KiB body cap: **dev live acceptance complete** (16.5).
- **F3** — prototype-key hardening: unit negative/positive controls in §14; not part
  of this live-acceptance pass and unchanged.

ISSUE-120 remains resolved; this section adds the live acceptance that §12–§15 did
not include.

