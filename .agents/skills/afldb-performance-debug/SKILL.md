---
name: afldb-performance-debug
description: Diagnose and fix AFLDB performance, intermittent hydration, concurrency, slow query, rendering latency, worker/pool saturation, stress-corpus instability, memory/CPU, or issues that appear only under sustained or varied load. Use when isolated reproduction passes but real sweeps or concurrent traffic fail.
---

# AFLDB Performance and Intermittent Failure Debugging

Optimise only after identifying the constrained resource or failing transition.

## Guardrails

- Work only in the local working copy.
- Inspect before editing.
- Do not run Git commands unless explicitly requested.
- Do not load-test production unless the user explicitly requests and controls it.
- Do not remove correctness checks or timeouts just to improve throughput.
- Do not increase worker/pool limits blindly.

## Preserve the real workload

Characterise the failure by:

- request mix and variety;
- concurrency;
- duration;
- worker count;
- database pool size;
- query shape;
- browser versus direct parser/compiler path;
- cold versus warm state;
- failure percentage and clustering.

If repeated identical requests pass but a varied sustained sweep fails, treat variety/duration/process interaction as part of the reproduction.

## Instrument the first failing boundary

Capture only evidence needed to distinguish:

- server render mismatch;
- browser hydration/commit;
- parser/compiler;
- slow SQL/statement timeout;
- pool exhaustion;
- process/worker restart;
- memory pressure;
- stale cache/revalidation;
- network/proxy timeout.

For hydration faults, capture raw server HTML for the failing request and a clean control of the same question/route when possible.

## SQL performance

Before adding indexes:

- inspect predicates, joins, grouping, and ordering;
- verify cardinality and row explosion;
- use `EXPLAIN (ANALYZE, BUFFERS)` only on a safe non-production target or with explicit approval;
- check whether a query bug is creating unnecessary work.

Do not add an index as a substitute for fixing incorrect grain or a multiplying join.

## Runtime capacity

AFLDB uses multiple Next.js workers and per-worker PostgreSQL pools. Consider total possible connections as workers × pool max plus other roles/services. Tune only with measured evidence.

## Validate

Compare before/after using the same workload and report:

- correctness;
- latency distribution, not only average;
- failure count/rate;
- resource or query evidence;
- whether the original intermittent signature disappeared.

Do not call an intermittent issue fixed after a small clean sample.
