# AFLDB-ISSUE-068 — Intermittent React hydration errors during NL UI sweeps

- **Status:** **Resolved**
- **Severity:** Medium
- **Area:** UI / Hydration / Framework runtime
- **Found:** 2026-08-21
- **Resolved:** 2026-08-29
- **Closeout updated:** 2026-08-29
- **Resolved by:** `AFLDB-ISSUE-107` — Next.js 16 framework/runtime upgrade, deployed to Linux
  development and accepted at BUILD_ID `uZReW8G1XnsGnG5FNYY-I`
- **Preserved A/B evidence:** `D:\dev\afldb-issue-068-ab2-evidence`

## Resolution — 2026-08-29

> The React #418 hydration defect was owned by the Next 15.5.23 framework dependency
> closure/runtime/client/serving path. The Next 16.3.1 framework closure eliminated the defect
> in matched Windows A/B testing, and the result is now confirmed on the real Linux development
> deployment with a clean 1,440-load acceptance.

No exact internal Next.js function, commit or upstream bug ID is claimed, and none is required
for closure. Hydration forensics are complete; do not reopen them without new evidence of a
production-runtime defect.

**Root cause (to the owning layer):** the Next 15.5.23 framework dependency closure, runtime,
client and serving path — substituted as a unit. React and ReactDOM resolved to 19.2.8 on both
sides of the experiment and therefore explain nothing.

**Fix:** the bounded Next 15.5.23 → 16.3.1 framework/runtime upgrade implemented and deployed
by `AFLDB-ISSUE-107`, retaining React/ReactDOM 19.2.8 and Webpack.

**Validation:** two matched Windows A/B passes on Next 16.3.1 (0 and 0 hydration errors against
73 and 62 on Next 15.5.23), followed by the deployed Linux acceptance below — 1,440 / 1,440
observations, zero hydration errors, zero client errors, zero violations, at unchanged
4-worker concurrency, with every response bound to the intended build.

### Authoritative final evidence

| Item | Value |
|---|---|
| Live development service | `http://10.0.40.100:8090` |
| BUILD_ID | `uZReW8G1XnsGnG5FNYY-I` |
| Next.js | `16.3.1` |
| React / ReactDOM | `19.2.8` / `19.2.8` |
| Node | `v22.23.2` |
| Bundler | Webpack |
| `AFLDB_WORKERS` / `AFLDB_POOL_MAX` / `AFLDB_TRACE_REQUESTS` | `4` / `10` / `on` |
| Playwright workers | 4 |
| `afldb_dev` | 77/77 migrations |

| Final sweep measure | Result |
|---|---:|
| Observed | 1,440 / 1,440 |
| Hydration errors | 0 |
| Client errors | 0 |
| Violations | 0 |
| Metamorphic disagreements | 0 |
| HTTP errors | 0 |
| Page errors | 0 |
| Responses HTTP 200 | all |
| Observations carrying `uZReW8G1XnsGnG5FNYY-I` | all 1,440 |
| `hydration.untraced` | 0 |
| Hydration errors on every worker and RSC cut | 0 |
| Duration | ~3.4 minutes |

### Semantic result — improvement explicitly NOT attributed to Next 16

| | Original reference | Final run |
|---|---:|---:|
| Pass | 1,238 | 1,440 |
| Fail | 202 | 0 |
| Unscored | 0 | 0 |

**This improvement is not attributed to Next 16.** The final run used later application source
containing merged natural-language search work that the original A/B did not have; the A/B held
application source constant and swapped only the framework. ISSUE-068's relevant acceptance
criterion was **no semantic regression**, and that criterion was satisfied.

### Corpus note

The currently tracked corpus has 1,435 rows because five ambiguous questions were removed after
the original A/B. The complete original 1,440-row corpus was retained on the Linux development
host and was proven to be the correct superset: removing exactly the five later-deleted ids
reproduced the tracked 1,435-row corpus byte-for-byte. **No rows were fabricated and no
acceptance threshold was changed.**

### Related issues, all unaffected by this closure

`AFLDB-ISSUE-107` remains **Open** — `AFLDB-ISSUE-108` blocks its G2 database-integration gate.
`AFLDB-ISSUE-108` and `AFLDB-ISSUE-109` remain **Open** and separate.

## Original finding (retained as lineage)

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

## Single residual before closure — DISCHARGED 2026-08-29

ISSUE-068 had exactly one residual: deployed Linux-dev acceptance of the ISSUE-107 upgrade. It
was discharged on 2026-08-29 and the issue is now **Resolved**. The section is retained as the
record of what closure required.

Steps 1 and 2 are **done** as of 2026-08-29. ISSUE-107 deployed the proven closure to the real
Linux development runtime and proved the live build. The sweep must run against this build and
no other:

| Item | Value |
|---|---|
| Base URL | `http://10.0.40.100:8090` |
| **BUILD_ID / live `x-afldb-build`** | **`uZReW8G1XnsGnG5FNYY-I`** |
| Deployed commit | `be2a963` on `dev` |
| Next.js / React / ReactDOM | `16.3.1` / `19.2.8` / `19.2.8`, Webpack |
| Node (Linux) | `v22.23.2` |
| `AFLDB_WORKERS` / `AFLDB_POOL_MAX` / `AFLDB_TRACE_REQUESTS` | `4` / `10` / `on`, all proven live |
| Playwright workers | `4` — leave `NL_UI_WORKERS` unset |
| Beta session | `tests/nl-ui/.auth/state.json` on the host is current; otherwise set `AFLDB_E2E_BETA_CODE` |

ISSUE-107's own focused live validation on this build covered 17 routes — including `/search`
with a natural-language query — with **zero console, page and hydration errors**. That is
upgrade regression coverage, not this acceptance.

Two things to know before reading sweep output. `afldb_dev` is at 70/77 migrations
(`071`–`077` belong to other merged issues and touch no `/search` path), and `afldb_test` data
is stale under `AFLDB-ISSUE-108` — neither affects this sweep, which runs against `afldb_dev`
through the live service.

1. ~~Deploy the proven Next 16 framework closure to the real Linux development runtime.~~ Done.
2. ~~Prove the intended build is live via `x-afldb-build`.~~ Done — `uZReW8G1XnsGnG5FNYY-I`.
3. ~~Run one comparable 1,440-row acceptance sweep on deployed Linux development with the
   established worker/concurrency controls unchanged.~~ **Done 2026-08-29 — passed.** See
   *Deployed acceptance sweep* below.

## The corpus in the tracked tree is no longer 1,440 rows — resolved for this run

`tests/nl-ui/corpora/afldb-ui-questions-1440-real-user-v3-20260822.csv` at the deployed tip
`be2a963` holds **1,435** data rows, not 1,440. A commit merged between `73e6a7e` and `be2a963`
— not an ISSUE-107 commit — removed exactly five, and added none:

| Removed id | Question | Outcome in the Next 16 A/B pass |
|---|---|---|
| `user_1126` | Dustin Martin most games in a game | `answered` |
| `user_1144` | Scott Pendlebury most games in a game | `answered` |
| `user_1162` | Patrick Dangerfield most games in a game | `answered` |
| `user_1180` | Lance Franklin most games in a game | `answered` |
| `user_1198` | Gary Ablett Jr most games in a game | `absent` |

Established by comparing the current corpus against the 1,440 observation ids preserved in
`D:\dev\afldb-issue-068-ab2-evidence\runtime\next16-pass2\nl-ui-out`. The five are malformed
questions ("most games in a game"), so the removal reads as deliberate corpus hygiene.

**The stated acceptance therefore cannot be met as written.** A run against the committed corpus
can only observe 1,435/1,435, and its semantic totals cannot equal 1,238 / 202 for the arithmetic
reason that five questions no longer exist. In the A/B, `pass` equalled `answered`, so dropping
four `answered` and one `absent` gives the exactly derived matched expectation:

| Measure | A/B baseline (1,440) | Derived expectation (1,435) |
|---|---:|---:|
| Observed | 1,440 | 1,435 |
| Pass | 1,238 | 1,234 |
| Fail | 202 | 201 |
| Unscored | 0 | 0 |
| Answered | 1,238 | 1,234 |
| Unanswerable | 43 | 43 |
| Absent | 159 | 158 |
| HTTP error / page error | 0 / 0 | 0 / 0 |
| Violations, hydration and client errors | 0 | 0 |

**The full 1,440-row corpus was found intact on the development host** as an untracked artefact
of the original A/B runs, at `~/projects/afldb/afldb-ui-questions-1440-real-user-v3-20260822.csv`.
It was proven to be a clean superset before use: stripping exactly those five ids from it and
normalising line endings reproduces the committed corpus byte-for-byte
(`sha256 94b36b3e04825bd3…` on both sides). The acceptance therefore ran against the true 1,440
questions via `NL_UI_CORPUS`, and the derived 1,435-row expectation above was **not** needed. No
threshold was altered and no row was fabricated.

The tracked corpus is still short by five rows. That is a separate housekeeping question for
whichever issue removed them — the five are ambiguous ("most games in a game") and the current
parser answers them as career games, which is a reasonable reason to have dropped them.

## Deployed acceptance sweep — 2026-08-29 — PASSED

Run on the deployed Linux development service, JavaScript enabled, no retries, nothing
suppressed and no concurrency reduced.

| Parameter | Value |
|---|---|
| Base URL | `http://10.0.40.100:8090` |
| Build | `uZReW8G1XnsGnG5FNYY-I` — carried by **all 1,440** observations |
| Corpus | the full 1,440-question `real-user-v3-20260822` set |
| Workers | 4 (Playwright default; `NL_UI_WORKERS` unset) |
| DB pool | `AFLDB_POOL_MAX=10`, `AFLDB_WORKERS=4` |
| Tracing | `AFLDB_TRACE_REQUESTS=on` |
| Auth | existing saved beta session; `--no-deps` so no access code was redeemed |
| Run tag | `issue068-accept-uZReW8G1-20260829` |
| Duration | 3.4 minutes, 15 batches |

### Result against every acceptance condition

| Condition | Required | Observed |
|---|---|---|
| Observations | 1,440 / 1,440 | **1,440 / 1,440** |
| Unexplained hydration errors | 0 | **0** |
| Unexplained client errors | 0 | **0** |
| Violations | 0 | **0** |
| Metamorphic disagreements | 0 | **0** |
| HTTP / page errors | 0 | **0 / 0** |
| Semantic regression from 1,238 / 202 / 0 | none | **none — 1,440 / 0 / 0** |

Hydration was zero on every cut the report makes: per worker (418 / 266 / 179 / 577 loads, 0%
each), same-worker vs cross-worker (0 of 4, 0 of 1,436), and every RSC cluster. `untraced: 0` and
`totalHydrationErrors: 0`. Every observation returned HTTP 200 with an empty `errors` array.

### The semantic improvement is real, and is not attributable to Next 16

Outcomes moved from `answered 1,238 / unanswerable 43 / absent 159` to `answered 1,440 /
unanswerable 0 / absent 0`. This is **not** a like-for-like comparison and must not be reported as
one: the A/B held the application source constant and swapped only the framework, whereas this
acceptance runs `be2a963`, which merged roughly 179 files of later work — including new
head-to-head queries, the qualifying-matches gate, semantic intents and team-match/player-career
changes. The A/B's failures were concentrated in exactly the categories that work targets
(`user_head_to_head` 80, `user_draws` 80). Spot-checked answers are sensible
(`Richmond vs Collingwood (2015) — 91 win margin`; `Scott Pendlebury — 440 games`).

What this sweep proves for ISSUE-068 is the hydration claim: **zero hydration and client errors
across 1,440 loads on the deployed Next 16.3.1 build**, at unchanged concurrency, with every
response bound to that build. The search-quality gain belongs to the merged NL work, not to the
framework upgrade.

### Closure position

Every closure condition stated in this issue is met, and **AFLDB-ISSUE-068 was marked Resolved
on 2026-08-29** on operator instruction. See *Resolution — 2026-08-29* at the top of this
document for the authoritative closing record.
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
