# AFLDB-ISSUE-068 — Intermittent React hydration errors during NL UI sweeps

- **Status:** Open
- **Severity:** Medium
- **Area:** UI / Hydration / Framework runtime
- **Found:** 2026-08-21
- **Closeout updated:** 2026-08-29
- **Depends on:** `AFLDB-ISSUE-107` — Next.js 16 framework/runtime upgrade
- **Preserved A/B evidence:** `D:\dev\afldb-issue-068-ab2-evidence`

## Current finding

**H9 is CONFIRMED at the owning-layer level.** The strongest conclusion justified by the
matched experiment is:

> The ISSUE-068 React #418 defect is owned by the Next 15.5.23 framework dependency
> closure/runtime/client/serving path. A matched substitution with the Next 16.3.1 closure
> eliminates the defect across two independent 1,440-load passes.

This finding does **not** identify a specific Next.js internal function, a specific upstream
commit or bug, or the `next` package alone as causal. The experiment substituted the
framework dependency closure and runtime/serving path as a unit.

React and ReactDOM resolved to 19.2.8 on both sides. Their versions therefore do not explain
the A/B difference.

## Completed matched A/B

The repeated A/B used the same application source and semantic workload while substituting
the framework closure. Per-load `x-afldb-build` capture proved every response was served by
the intended build.

| Runtime | Build ID | Pass | Loads | Hydration/client errors | Violations |
|---|---|---:|---:|---:|---:|
| Next 15.5.23 | `oroK-9PaBQoMFamvJGRqB` | 1 | 1,440 / 1,440 | 73 | 0 |
| Next 15.5.23 | `oroK-9PaBQoMFamvJGRqB` | 2 | 1,440 / 1,440 | 62 | 0 |
| Next 16.3.1 | `5RU_F0rm5IyuiVwKX9XHi` | 1 | 1,440 / 1,440 | 0 | 0 |
| Next 16.3.1 | `5RU_F0rm5IyuiVwKX9XHi` | 2 | 1,440 / 1,440 | 0 | 0 |

All four runs produced the identical semantic result:

| Measure | Result |
|---|---:|
| Pass | 1,238 |
| Fail | 202 |
| Unscored | 0 |
| Answered | 1,238 |
| Unanswerable | 43 |
| Absent | 159 |
| HTTP error | 0 |
| Page error | 0 |
| Metamorphic disagreements | 0 |

The semantic failures are held constant across the experiment. They are not evidence that
the Next 16 candidate changed search behaviour.

## Serving-path caveat

Next 16 materially changes the segment-cache/prefetch serving format. The experiment therefore
does not distinguish an internal hydration correction from elimination of the defect through
the changed framework serving path. That is why the conclusion is intentionally bounded to
the framework dependency closure/runtime/client/serving path.

## Authentication stderr

`AFLDB_AUTH_DATABASE_URL` was unset on both sides. The resulting authentication stderr is
shared, non-causal telemetry noise for ISSUE-068:

- both runtimes completed 1,440 / 1,440 loads;
- `http_error = 0` and `page_error = 0` on every run;
- Next 15's excess telemetry tracks its hydration failures; and
- Next 16 completed both passes with zero hydration/client errors.

Do not alter authentication telemetry under ISSUE-068.

## Implementation ownership

`AFLDB-ISSUE-107` owns implementation and deployment of the proven Next 16 framework closure.
No framework upgrade is part of this ISSUE-068 closeout. Earlier application-level diagnostic
changes remain investigation lineage; none proved a complete hydration fix.

## Single residual before closure

ISSUE-068 remains **Open** with exactly one residual: deployed Linux-dev acceptance of the
ISSUE-107 upgrade.

1. Deploy the proven Next 16 framework closure to the real Linux development runtime.
2. Prove the intended build is live via `x-afldb-build`.
3. Run one comparable 1,440-row acceptance sweep on deployed Linux development with the
   established worker/concurrency controls unchanged.
4. Close ISSUE-068 only if:
   - there are zero unexplained hydration/client errors;
   - the semantic result does not regress from 1,238 / 202 / 0; and
   - worker/concurrency controls are not reduced.

Discovery of an exact internal Next.js line or upstream commit is not a closure requirement.
If any acceptance condition fails, keep ISSUE-068 and ISSUE-107 open, preserve the evidence,
and investigate the concrete regression without suppressing errors or lowering concurrency.

## Evidence preservation

The authoritative evidence is preserved outside this worktree at
`D:\dev\afldb-issue-068-ab2-evidence`. The packaged second Next 16 run is at
`D:\dev\afldb-issue-068-ab2-evidence\runtime\next16-pass2`. These paths are read-only evidence
for closeout purposes and must not be modified or deleted.
