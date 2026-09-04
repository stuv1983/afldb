# AFLDB-ISSUE-116 — The Data QA page/count shape consumes the whole result set

**Status: RESOLVED 2026-09-04.** Implemented and validated on `claude/issue-116-query-builder`
in `D:\dev\afldb-issue-116`. Both proven anchors are under the existing 1,000 ms T-C11 target
with no timeout raised, no index added and no schema or migration change.
**Severity:** Low — Admin tooling / Data QA / Query performance
**Area:** `src/db/queries/query-builder.ts` (`runQueryBuilder`)
**Branch / worktree:** `claude/issue-116-query-builder` — `D:\dev\afldb-issue-116`
**Base commit:** `fde0851`
**Migration:** none. No schema, privilege, index or `AFLDB_STATEMENT_TIMEOUT_MS` change.
**Related:** `AFLDB-ISSUE-115` (found it; its `player_match_stats` related-card exclusion is
**not** reopened here — see §9); `AFLDB-ISSUE-112` §32.9 (the `players`-anchor evidence);
`AFLDB-ISSUE-103` (the same Nested Loop over `Materialize` pathology under this anchor).

---

## 1. Target

`runQueryBuilder` emitted the page and its total as ONE statement:

```sql
SELECT <display columns>, count(*) OVER () AS "__total"
  FROM <anchor from>
 WHERE <compiled cards>
 ORDER BY <sort>
 LIMIT 50 OFFSET n
```

The planner costs that as a fast-start ordered walk, but a window aggregate cannot emit its
first row until it has consumed every qualifying row, so the `LIMIT` bought nothing. Fix the
page/count shape so a normal paged Data QA query stops after `LIMIT`, preserving filtering,
sort, pagination and exact-total semantics, bound parameters, catalogue-only identifiers and
the existing timeout.

---

## 2. Environment and baseline reproduction

| Item | Value |
|---|---|
| Target | `afldb_test` as `afldb_owner`, `AFLDB_TEST_DATABASE_URL` → `127.0.0.1:55432`, SSH tunnel to `streamanator:5432` |
| Server | PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) |
| `AFLDB_STATEMENT_TIMEOUT_MS` | 5000 — never raised |
| Worktree deps | `npm ci` in this worktree (no cross-worktree `node_modules` junction) |
| Row counts | `player_match_stats` 685,471; `players` 13,273; `matches` 16,838; `clubs` 24 |
| Harness | `tests/integration/query-builder.test.ts`, T-C11 cost gate, `BOUND_MS = 1000` |

**Tunnel latency matters to every number below.** 20 consecutive `SELECT 1` statements over
this tunnel measure **min 58.2 / median 63.6 / max 69.3 ms**. Every measurement in this runbook
is an end-to-end `runQueryBuilder` call, so each *additional statement* a shape issues costs
~60 ms of transport that does not exist in production, where the application and PostgreSQL
share a host. That is why §6 counts round trips, not just server time.

### 2.1 Baseline (pre-change, T-C11, `HEAD = fde0851`)

```
    47.1 ms  total=  13273  players (anchor alone)
    61.7 ms  total=  16838  matches (anchor alone)
  1144.5 ms  total= 685471  player_match_stats (anchor alone)          <-- ISSUE-116 case A
   654.8 ms  total=    317  players x player.match_stats EXISTS goals>=8
   535.1 ms  total=  12956  players x player.match_stats NOT EXISTS goals>=8
   482.9 ms  total=    317  player_career_stats x player.match_stats EXISTS goals>=8
   578.7 ms  total=  12954  player_career_stats x player.match_stats NOT EXISTS goals>=8
   753.4 ms  total=      0  matches x match.player_stats EXISTS club_is_participant IS FALSE
   382.0 ms  total=  16838  matches x match.player_stats NOT EXISTS club_is_participant IS FALSE
   200.2 ms  total=   7241  matches x match.player_stats EXISTS disposals>=30
   210.7 ms  total=   9597  matches x match.player_stats NOT EXISTS disposals>=30
    47.4 ms  total=  13273  players x player.draft_picks NOT EXISTS link_status=unique
  1073.4 ms  total=  12852  players x player.captaincies NOT EXISTS ...  <-- ISSUE-116 case B
```

Both documented anchors reproduce: **case A 1144.5 ms** (issue records 1056–1072 ms and an
`EXPLAIN ANALYZE` of 1441 ms) and **case B 1073.4 ms** (issue records 1081/1095/1100 ms), the
latter RED against `BOUND_MS`.

### 2.2 The mechanism, isolated in `psql`

| Shape | Case A (`player_match_stats` alone) | Case B (`players` × captaincies `NOT EXISTS`) |
|---|---|---|
| Current: `count(*) OVER ()` + `ORDER BY` + `LIMIT 50` | **2502.6 ms** | **1253.8 ms** |
| Page only (no window), same `ORDER BY … LIMIT 50` | **11.4 ms** | **9.4 ms** |
| Count only (no `ORDER BY`, no `LIMIT`) | **182.5 ms** | **8.3 ms** |

`EXPLAIN (ANALYZE, BUFFERS)` for case A confirms the issue's account exactly:

- current shape — `Limit (cost=1.15..8.93 rows=50) (actual time=1510.265..1510.290 rows=50)`,
  `Buffers: shared hit=115466 read=477, temp read=3401 written=3692`, **Execution Time 1518.0 ms**;
- page only — `Limit (cost=1.15..8.31 rows=50) (actual time=0.041..0.312 rows=50)`,
  **Execution Time 0.456 ms**, no temp;
- count only — **Execution Time 233.8 ms**.

Case B: current shape 2451.7 ms; page only 10.6 ms; count only 6.1 ms
(`Aggregate (actual time=6.030..6.032)`).

The paged query no longer needs to consume the entire qualifying relation solely to produce the
total, which was the required proof.

---

## 3. Chosen shape

One transaction, up to two statements:

```
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY
  SELECT <display columns> FROM <from> WHERE <where> ORDER BY <sort> LIMIT 50 OFFSET n
  -- if the page proves its own total, stop here
  SET LOCAL jit = off
  SELECT count(*)::text FROM <from> WHERE <where>
COMMIT
```

Three decisions, each measured rather than assumed.

### 3.1 The page query drops `count(*) OVER ()`; the count query drops `ORDER BY`

§2.2. The page keeps its fast-start ordered plan and really does stop after 50 rows; the count
runs unordered and unlimited, which is the shape an aggregate is good at — an order it cannot
observe would only add a sort.

### 3.2 A short page proves its own total, so the second statement is usually not issued

If `LIMIT 50` returns fewer than 50 rows, the ordered set was exhausted, so the total is exactly
`offset + rows.length`. That is arithmetic, not an estimate. The one short page that proves
nothing is an **empty page at a non-zero offset** — `OFFSET` may have skipped past the end of a
large result set — so there the count still runs.

This is not an optimisation of convenience. Without it the split *doubles* the cost of any
query that matches nothing, because a page with nothing to find cannot stop early and the same
full scan would then be paid for twice. Measured on the naive two-statement version:

- `matches x match.player_stats EXISTS club_is_participant IS FALSE` (total 0): **753.4 ms →
  1533.4 ms**, a regression on a case that was green;
- `players x 4 related player.match_stats cards`: also RED (see §3.3).

With the short-circuit the first of those returns to a single statement.

### 3.3 `SET LOCAL jit = off` before the count — the one deviation in this work

Splitting made `players x 4 related player.match_stats cards` **1427.1 ms**, against ~250 ms for
the old single statement. That is *not* the split being wrong; the cause is PostgreSQL JIT.

In `psql`, for that predicate over `players`:

| Statement | Time |
|---|---|
| `count(*)` (no `LIMIT`) | 1228.7 ms |
| `count(*)` (no `LIMIT`), `SET jit = off` | **75.6 ms** |
| page query `ORDER BY … LIMIT 50` | 69.2 ms |
| old combined `count(*) OVER () … LIMIT 50` | 82.3 ms |

`EXPLAIN` explains it: `Aggregate (cost=5782960.93..5782960.94)` with

```
JIT:
  Functions: 104
  Options: Inlining true, Optimization true, Expressions true, Deforming true
```

The count has no `LIMIT`, so its **estimated** cost carries the whole relation — 5.8M, past
`jit_above_cost` 100000 *and* `jit_optimize_above_cost` 500000 — and PostgreSQL compiles 104
functions with inlining and optimisation before executing 75 ms of work. Confirmed not to be
the scan method: `enable_seqscan = off` still measured 1046 ms; and confirmed to be
`LIMIT`-driven, since *every* unlimited variant of the same predicate cost ~1.1 s (bare rows
1228.6 ms, ordered rows 1096.9 ms, `count(*)` 1086.9 ms, even `count(*) OVER ()` with no
`ORDER BY`/`LIMIT` 1089.4 ms) while every `LIMIT 50` variant cost ~85 ms. The pre-116 shape
never paid this precisely because its `LIMIT` kept the estimate tiny.

JIT earns its compile time on multi-second analytical scans. Nothing in this tool is allowed to
run that long — `AFLDB_STATEMENT_TIMEOUT_MS` caps every statement at 5 s and the tool targets
under 1 s — so here it can only lose. It is issued as `SET LOCAL` **inside the transaction**, so
it cannot leak onto the pooled connection, and **only on the path that actually runs a count**:
issuing it unconditionally cost one extra round trip on the common path and pushed
`matches x match.player_stats EXISTS club_is_participant IS FALSE` to 1001.3 ms, RED by 1.3 ms.

**This is a deviation to note:** the fix is not purely a query-shape change. It is not on the
forbidden list (no timeout raise, no index, no schema, no migration) and it is
transaction-local, but it is a server-behaviour setting and is recorded here as such.

### 3.4 Both statements share one snapshot

`REPEATABLE READ READ ONLY`. Under the default READ COMMITTED each statement takes its own
snapshot, so a concurrent import could let the total describe a different relation from the
page; one repeatable-read snapshot restores exactly the atomicity the single window-aggregate
query had. `READ ONLY` also states in the transaction what the `afldb_app` grant already
enforces, and the transaction is what makes `SET LOCAL` safe on a pooled connection.

`postgres.js` `begin(options, fn)` passes the options through
`options.replace(/[^a-z ]/ig, '')`, so a space-separated (never comma-separated) mode list
survives verbatim. `.begin()` is already the established idiom in this repository
(`src/db/queries/*-admin.ts`, `src/app/admin/**/actions.ts`).

### 3.5 Both statements share ONE compiled `where` fragment — verified safe

Inspected in the installed driver rather than assumed. `node_modules/postgres/src/types.js`:

```js
function fragment(q, parameters, types, options) {
  q.fragment = true
  return stringify(q, q.strings[0], q.args[0], parameters, types, options)
}
```

A nested query is only **read** — its strings and args — and its values are pushed into the
**enclosing** statement's parameter array. The same fragment therefore yields independently
bound parameters in each statement and is never consumed or mutated. Sharing it is stronger
than compiling twice: the count and the page cannot drift, because they are the same predicate
object.

### 3.6 Rejected alternatives

| Alternative | Why not |
|---|---|
| Concurrent page + count on two pooled connections | Halves wall clock but gives the two statements different snapshots; §3.4's guarantee is cheaper to keep than to argue away, and the short-circuit already removes the second statement from the common path. |
| Bounded or estimated count | Breaks the exact-total constraint. Also does not help: a `LIMIT` above the row estimate does not lower the planner's cost estimate, so it would not even dodge §3.3's JIT. |
| Widening the T-C11 bound for the regressed cases | The harness permits it with recorded evidence, but here it would paper over a regression this work caused. Fixed instead. |
| `count(*)` over an ordered sub-select | Measured 1124.6 ms — the planner discards an `ORDER BY` feeding an aggregate, so it buys nothing. |
| `SET jit = off` without `SET LOCAL` / without a transaction | Leaks onto the pooled connection and affects every other query the app runs. |

---

## 4. What is preserved

| Property | How |
|---|---|
| Filtering semantics | `compileCards` is untouched; the identical compiled fragment is the `WHERE` of both statements (§3.5). |
| Sort semantics | The page statement keeps `ORDER BY ${sortColumn}` verbatim from the same catalogue expression. |
| Pagination semantics | Same `QB_LIMITS.defaultPageSize` / `maxPage` clamp, same `LIMIT … OFFSET …`. |
| Exact total | `count(*)`, or arithmetic on an exhausted page (§3.2). Never bounded, never estimated. |
| Bound user parameters | Every value still binds, in the count statement as much as the page statement — T-E4 proves the count path specifically. |
| Catalogue-only identifiers | `sql.unsafe` still only ever receives `QUERYABLE_TABLES` / `RELATIONSHIPS` / `OPERATORS_BY_KIND` text. |
| Timeout behaviour | `AFLDB_STATEMENT_TIMEOUT_MS` unchanged at 5000; it is a connection parameter and applies per statement inside the transaction exactly as before. |
| Related-card quantifier semantics | `compileRelatedCard` untouched. |
| Response contract | `QueryBuilderResult { rows, total, columns }` unchanged; `src/app/admin/query-builder/page.tsx` unchanged. |

### 4.1 The one deliberate semantic correction

`total` used to be read off the page's first row (`rows.length > 0 ? Number(rows[0].__total) : 0`),
so **a page past the end reported total 0**. `/admin/query-builder` renders that as
"0 rows match / No rows match" for a query with matches. The total is now the whole match count
on every page. This is a correction of the stated semantics ("N rows match"), not a change to
them, and it is what the operator's "empty result pages still return the correct total" requires.
It is pinned by T-E1.

---

## 5. RED / GREEN evidence

New `describe('query builder compiler -- page/total split (ISSUE-116)')` in
`tests/integration/query-builder.test.ts`, plus one tightened bound in the T-C11 gate.

| Case | Asserts | Pre-change | Post-change |
|---|---|---|---|
| **T-E1** | total is the whole match count on every page, including page 4 of a 110-row set | **RED** — `expected +0 to be 110` | GREEN |
| **T-E2** | pages 1–3 partition the ordered 110-row set exactly, in the same order as an independent ordered read, with no row repeated or skipped | GREEN (guard rail) | GREEN |
| **T-E3** | a related-domain `NOT EXISTS` total equals an independent SQL count, and the page is that set's ordered head | GREEN (guard rail) | GREEN |
| **T-E4** | the **count statement** binds its values — an injection-shaped `contains` value totals 0 both on page 1 (short-page path) and on page 2 (the path that must ask the count) | GREEN (guard rail) | GREEN |
| **T-C11** `player_match_stats (anchor alone)` | bound tightened from `CEILING_MS` (5000) to `BOUND_MS` (1000) | **RED at 1144.5 ms** | GREEN at 353.4 ms |
| **T-C11** `players x player.captaincies NOT EXISTS link_status=unique` | already at `BOUND_MS` | **RED at 1073.4 ms** | GREEN at 320.9 ms |

T-E2's exact slice assertions are safe because the 110-row set's default sort
(`c.games DESC, p.sort_name`) is a **total** order over it — verified in SQL that no
`(games, sort_name)` pair repeats within the set — so the page boundaries are deterministic
rather than tie-break-dependent. No test asserts a PostgreSQL plan node name.

---

## 6. After timings (T-C11, same tunnel, same `afldb_test`)

```
   299.5 ms  total=  13273  players (anchor alone)
   273.5 ms  total=  16838  matches (anchor alone)
   353.4 ms  total= 685471  player_match_stats (anchor alone)          <-- was 1144.5
   391.1 ms  total=    317  players x player.match_stats EXISTS goals>=8
   301.6 ms  total=  12956  players x player.match_stats NOT EXISTS goals>=8
   384.2 ms  total=    317  player_career_stats x player.match_stats EXISTS goals>=8
   332.4 ms  total=  12954  player_career_stats x player.match_stats NOT EXISTS goals>=8
   910.0 ms  total=      0  matches x match.player_stats EXISTS club_is_participant IS FALSE
   775.8 ms  total=  16838  matches x match.player_stats NOT EXISTS club_is_participant IS FALSE
   369.8 ms  total=   7241  matches x match.player_stats EXISTS disposals>=30
   399.0 ms  total=   9597  matches x match.player_stats NOT EXISTS disposals>=30
   287.7 ms  total=  13273  players x player.draft_picks NOT EXISTS link_status=unique
   320.9 ms  total=  12852  players x player.captaincies NOT EXISTS ...  <-- was 1073.4
   476.6 ms  total=   2462  players x 4 related player.match_stats cards
   333.7 ms  total=      9  player_career_stats x 2 anchor cards + 4 related cards
```

The 24-shape `anchor x relationship` sweep is green throughout at 171–453 ms.

### 6.1 Reading these numbers honestly

Two effects move in opposite directions.

1. **Server work falls sharply** where the window aggregate was the cost — case A's server time
   goes from ~1.44 s to 11.4 ms (page) + 182.5 ms (count).
2. **Transport cost rises** wherever the count statement is needed, because the shape issues up
   to five round trips (`BEGIN`, page, `SET LOCAL`, count, `COMMIT`) instead of one, at ~60 ms
   each **through the measurement tunnel only**. That is why cheap cases such as
   `players (anchor alone)` read 47.1 → 299.5 ms: the server work did not grow, the statement
   count did. In production, application and PostgreSQL share a host and these round trips are
   sub-millisecond.

The tightest case is `matches x match.player_stats EXISTS club_is_participant IS FALSE` at
**910.0 ms** against 1000 ms. It short-circuits (total 0), so it is one server statement of
~690–750 ms — unchanged from the 753.4 ms baseline — plus `BEGIN`/`COMMIT` transport. Its bound
was not widened. If it ever flakes on this tunnel, this paragraph is the evidence that the cost
is transport, and the honest remedy is to measure on the host, not to widen the bound.

---

## 7. Files changed

| File | Change |
|---|---|
| `src/db/queries/query-builder.ts` | `runQueryBuilder` only: page and count split into two statements in one `REPEATABLE READ READ ONLY` transaction, short-page total derivation, `SET LOCAL jit = off` on the count path, shared `where`/`from` fragments. The compiler (`compileCondition` / `compileCard` / `compileRelatedCard` / `compileCards`) is untouched. |
| `tests/integration/query-builder.test.ts` | New `page/total split (ISSUE-116)` describe (T-E1–T-E4); `player_match_stats (anchor alone)` moved from `CEILING_MS` to `BOUND_MS` in the T-C11 gate, with the reason recorded in the comment. |

Bookkeeping: this runbook, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`.

---

## 8. Validation

| # | Command | Result |
|---|---|---|
| 1 | `npx vitest run tests/integration/query-builder.test.ts -t "ISSUE-116"` (pre-change) | **RED** — T-E1 `expected +0 to be 110` |
| 2 | `npx vitest run tests/integration/query-builder.test.ts -t "cost: the player_match_stats-target shapes"` (pre-change) | **RED** — captaincies 1073.4 ms; PMS anchor alone 1144.5 ms recorded |
| 3 | `npx vitest run tests/integration/query-builder.test.ts -t "cost:"` | **3/3 GREEN**, timings in §6 |
| 4 | `npm test -- tests/query-builder-spec.test.ts tests/integration/query-builder.test.ts` | **2 files, 51/51 tests**, 25.7 s |
| 5 | `npx tsc --noEmit` | clean |
| 6 | `npx eslint src/db/queries/query-builder.ts tests/integration/query-builder.test.ts` | clean |

Not claimed: no merge to `dev`/`main`, no deployment, no production or `afldb_dev` change, no
`afldb_test` mutation (every statement in this work is a read), no browser/E2E run.

---

## 9. Related cards under `player_match_stats` — NOT re-admitted

`QUERYABLE_TABLES.player_match_stats.subjects` stays `[]`. ISSUE-115's T-A1/T-B8 assert that
exactly and are unchanged.

Bounded evidence was gathered because the picture has clearly moved, and is recorded so the
future decision starts from measurement (raw SQL in `psql`, the new shape, `jit` off on counts):

| Shape under the `player_match_stats` anchor | Page | Count |
|---|---|---|
| `x player.career EXISTS games>=100` | 30.4 ms | 243.0 ms |
| `x player.career NOT EXISTS games>=100` | 9.2 ms | 100.6 ms |
| `x player.captaincies EXISTS` (bare) | 9.8 ms | 69.2 ms |

Against ISSUE-115 §20.5, where every relationship under this anchor measured 1.9–4.8 s and four
shapes hit the 5 s statement timeout, that is a large change. It is **not** sufficient to
re-admit:

- three of twenty-four shapes (twelve relationships × two quantifiers) were measured;
- they were measured as hand-written SQL, not end-to-end through `runQueryBuilder` and the
  T-C11 harness;
- ISSUE-115 §20.5 already shows that a fast anchor is *necessary but not sufficient* for the
  large-result shapes;
- re-admission means deliberately changing T-A1 and T-B8, which must be a decision, not a
  side effect of this issue.

**Recorded as a separate future decision.** Whoever takes it should re-run the full T-C11 gate
with `subjects` populated for this anchor and hold every one of the twenty-four shapes to
`BOUND_MS`. `AFLDB-ISSUE-115` is not reopened.

---

## 10. Next action

**None — ISSUE-116 is closed.** The work is committed on `claude/issue-116-query-builder` and
is **not merged**. Merge, deployment and any production verification are the operator's call.

Follow-ups recorded, not started:

1. Re-admitting related-domain cards under the `player_match_stats` anchor (§9).
2. If the T-C11 gate is ever run somewhere other than the 55432 tunnel, re-record §6 there —
   the transport component (§6.1) will largely disappear and the margins will widen.
