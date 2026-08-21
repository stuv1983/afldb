---
name: afldb-hydration-parallel-debug
description: Diagnose and fix AFLDB-ISSUE-068, the intermittent React hydration/client failure under sustained varied parallel /search traffic. Use for React #418, hydration mismatch, RSC/client divergence, browser commit errors, server HTML versus hydrated DOM mismatches, or Playwright NL UI stress failures. Keep issues.md and CHANGELOG.md current.
disable-model-invocation: true
---

# AFLDB ISSUE-068 — Parallel Hydration / Client Error Debugger

Use this skill specifically for:

**AFLDB-ISSUE-068 — intermittent hydration/client errors under parallel UI load**

Treat this first as a rendered-runtime / React Server Components / hydration / concurrency defect, not as an NL parser defect.

The goal is to identify the first wrong server-to-client transition and eliminate the failures under the same varied parallel workload that reproduces them.

---

# Completion standard

Do not mark ISSUE-068 resolved until:

1. A real failure is captured from the varied parallel workload.
2. At least one failure has:
   - exact query;
   - browser/client error;
   - server response evidence;
   - hydrated DOM evidence;
   - clean same-query or equivalent control.
3. The first wrong layer is proven.
4. The smallest owning-layer fix is made.
5. The real parallel workload is rerun under comparable conditions.
6. The expanded run has zero unexplained hydration/client errors.
7. The full 12,000-question UI run has zero unexplained hydration/client errors.
8. Semantic search behaviour remains correct.
9. `issues.md` is updated.
10. `CHANGELOG.md` is updated for every code/test/tooling/documentation change.

A semantic PASS with a hydration/client error is:

```text
semantic = PASS
runtime = FAIL
```

React recovery does not turn the runtime failure into a pass.

---

# Known evidence — do not waste time rediscovering it

## Canonical issue

```text
AFLDB-ISSUE-068
```

Primary observed error:

```text
React minified error #418
```

The defect occurs under:

```text
many distinct questions
+ sustained traffic
+ parallel Playwright workers/processes
+ normal /search navigation/rendering
```

It usually disappears when failing queries are replayed serially.

## Full 12,000-query UI baseline

Parser v24 full UI audit recorded:

```text
Attempted:             12,000
Observed:              12,000
Semantic passes:       11,442
Expectation failures:     502
HTTP failures:              0
Page errors:                0
Console/client errors:    235
Hydration errors:         235
Timeouts:                   0
Malformed answers:          0
Visible declines:         342
```

Hydration/client error rate:

```text
235 / 12,000 ~= 1.96%
```

Archived report:

```text
artifacts/nl-ui/nl-audit-v24-ui-12000-20260821/summary.json
```

The 502 expectation failures were separately classified as:

```text
286 data-coverage limitations
216 stale corpus oracle/policy rows
```

Do not mix those with ISSUE-068.

## Expanded corpus evidence

Observed expanded runs include:

```text
501 attempted
483 semantic passes
18 expectation failures
20 hydration errors
```

and later:

```text
501 attempted
483 semantic passes
9 hydration errors
```

Hydration errors remain independently present even when semantic failures are understood.

## Serial replay evidence

Eight captured failing queries were replayed individually:

```text
8 / 8 passed serially
0 hydration/client errors
```

This does **not** clear ISSUE-068.

It shows the failure depends on workload shape, concurrency, timing, navigation history, process interaction, or another condition absent from serial replay.

## Failed reproduction strategies already ruled out

Do not make these the primary investigation again:

- sequentially repeating one fixed question;
- four-way concurrent repetition of one fixed question;
- roughly 400 repetitions per fixed-question attempt.

Those attempts produced zero hydration errors.

A same-question stress test is not representative of the known failure.

## Recent parser context

Keep parser work separate unless evidence links it directly to hydration.

Recent parser versions include:

```text
v23 — record/leader phrasing repair
v24 — record holder vocabulary repair
v25 — malformed "players with most N games" rejection
```

`AFLDB-ISSUE-066` is resolved in v25.

## Other known issue classes

Keep separate unless causally linked:

```text
AFLDB-ISSUE-065 — player-season metric live performance/compiler issue
AFLDB-ISSUE-066 — malformed "players with most N games" — resolved
AFLDB-ISSUE-067 — generated double plurals — fixed
AFLDB-ISSUE-069 — debut-season oracle/policy correction
AFLDB-ISSUE-071 — V2 classification/audit item
```

---

# Repository / development environment

## Windows editing workspace

```text
D:\dev\afldb
```

## Authoritative development server

```text
SSH:          arm@10.0.40.100
Remote repo:  /home/arm/projects/afldb
Dev app:      http://10.0.40.100:8090
Loopback app: http://127.0.0.1:3100
Dev DB:       afldb_dev
Test DB:      AFLDB_TEST_DATABASE_URL, must end in _test
```

The remote Linux environment is authoritative for:

- Next.js standalone runtime;
- React/RSC behaviour;
- server HTML/RSC responses;
- production-style build;
- DB integration;
- deployed `/search`;
- Playwright against the development deployment.

Do not use WSL as the authoritative AFLDB environment.

---

# Safety rules

## Application/data

- Inspect before editing.
- Work only on local/development copies.
- Never use production as the test target.
- Never mutate production data.
- Do not modify `tools/migration/**` or `*.py` unless explicitly requested.
- Do not change AFL data to make a browser test pass.
- Do not weaken beta/auth/security controls.
- Do not reduce concurrency merely to get a green result.
- Do not suppress React errors.

Forbidden "fixes" include:

```text
suppressHydrationWarning
blanket 'use client'
arbitrary setTimeout/waits
swallowing console errors
skipping failing corpus rows
serialising the whole harness
reducing workers until green
increasing timeouts as the only change
```

## Git

Read-only metadata required by existing tooling is allowed:

```text
git rev-parse HEAD
git rev-parse --short HEAD
git rev-parse --show-toplevel
```

Unless explicitly requested, do not:

- commit;
- stage/add;
- stash;
- branch/switch;
- merge/rebase;
- checkout/restore/reset;
- cherry-pick/revert;
- pull/fetch/push;
- tag;
- clean;
- modify `.git`;
- change Git config.

The user reviews working-tree changes first.

## Beta access

Prefer the existing Playwright auth state when valid.

If it is stale and the user has supplied a beta code in the current session, use it only ephemerally to establish browser access.

Never store or print the beta code in:

- source;
- tests;
- this skill;
- `issues.md`;
- `CHANGELOG.md`;
- screenshots;
- traces;
- generated corpora;
- console output.

---

# Audit records are mandatory

## issues.md

The repository has established:

```text
issues.md
```

as the canonical issue ledger.

Do not create a duplicate `issuesFound.md`.

At the start:

1. read `AFLDB-ISSUE-068`;
2. preserve its history;
3. append new evidence.

Update ISSUE-068 whenever:

- a new reproduction rate is measured;
- a failure/control pair is captured;
- a hypothesis is ruled out;
- raw server/RSC evidence is captured;
- root cause is proven;
- a fix is made;
- a validation run changes the error rate;
- work is blocked;
- the issue is resolved.

Recommended structure:

```markdown
### Latest reproduction
- Date:
- Build/parser version:
- Corpus:
- Total queries:
- Playwright workers/processes:
- Hydration/client errors:
- Error rate:
- HTTP failures:
- Page errors:
- Timeouts:
- Report path:

### Representative failure
- Query:
- Previous query/result shape:
- React/client error:
- Server response capture:
- Hydrated DOM capture:
- Clean same-query control:
- Serial replay:
- Parallel replay:

### First wrong layer
Not yet confirmed | Server render | RSC response | Navigation | Hydration | Client component | Cache/revalidation | Request race | Other

### Root cause
Not yet confirmed, or evidence-backed explanation.

### Fix
Not yet fixed, or exact change.

### Validation
Before/after comparable corpus results.
```

Do not mark resolved because serial replay passes.

## CHANGELOG.md

Update the existing uppercase:

```text
CHANGELOG.md
```

for every permanent change made while investigating/fixing ISSUE-068, including:

- rendering/RSC fix;
- client-state fix;
- stable-key fix;
- ordering fix;
- cache/revalidation fix;
- Playwright instrumentation;
- raw HTML/RSC capture;
- regression coverage;
- stress harness changes;
- runtime debug tooling kept in the repository.

Reference:

```text
AFLDB-ISSUE-068
```

Do not add a changelog entry merely for running another reproduction with no project change.

---

# Core question

Do not centre the investigation on:

> Which query breaks hydration?

Current evidence points instead to:

> What differs between server output and client hydration/commit under sustained varied parallel traffic?

Trace:

```text
browser submit/navigation
-> Next.js request
-> Server Component render
-> NL answer/result
-> HTML or RSC payload
-> browser response
-> React hydration/commit
-> client state/effects
-> visible DOM
```

Find the first wrong transition.

---

# Phase 1 — baseline and topology

Before editing:

1. Read:
   - `issues.md` ISSUE-068;
   - `CHANGELOG.md`;
   - `README.md`;
   - `docs/search.md`;
   - `package.json`;
   - Playwright NL configs;
   - `tools/nl/**`;
   - `/search` route/components;
   - NL answer components;
   - relevant Server Actions/navigation/revalidation code.
2. Prove the deployed build/parser version.
3. Confirm the beta session works.
4. Identify the exact 12k corpus and harness.
5. Record:
   - Playwright worker count;
   - browser/process count;
   - navigation pattern;
   - Node version;
   - `AFLDB_WORKERS`;
   - `AFLDB_POOL_MAX`;
   - server worker/PID information when useful;
   - build/SHA identifier when useful.
6. Preserve the known 12k baseline.
7. Find the smallest **varied parallel** slice that still reproduces the issue.

Do not spend the main investigation repeatedly hammering one fixed question.

---

# Phase 2 — instrument the real stress harness

Prefer improving the existing NL UI stress harness over creating a detached reproduction whose workload differs materially.

For every hydration/client failure capture:

## Identity

- exact query;
- corpus row/index/id;
- timestamp;
- browser worker/process;
- page/context identifier;
- parser/build version;
- current URL;
- previous query;
- previous answer shape;
- current expected answer shape.

## Browser evidence

- full console error text;
- React error code;
- page error if any;
- visible NL answer text;
- hydrated DOM snippet around the answer;
- whether React recovered;
- whether final answer remained semantically correct;
- screenshot if useful;
- trace if useful.

## Server evidence

Capture the response associated with the failing transition.

Depending on navigation type this may be:

- initial document HTML;
- App Router RSC/navigation response;
- server-rendered answer payload;
- response headers/status;
- non-secret request correlation metadata.

Do not assume document HTML alone is sufficient for an App Router navigation failure.

## Clean controls

For every representative failure capture:

1. same query serially;
2. same query in a fresh browser context;
3. semantically equivalent phrasing;
4. neighbouring known-clean query.

Compare failure and clean server/client output.

---

# Phase 3 — preserve the reproducing workload

The known failure shape is:

```text
varied questions
+ sustained execution
+ parallel browser workers
+ repeated /search tree changes
```

When shrinking the corpus for diagnosis, retain:

- previously failing queries;
- clean controls;
- multiple answer payload shapes;
- declines;
- ties;
- no-results answers;
- grouped answers;
- player/team/season/career answers;
- enough unrelated queries to preserve varied transitions.

Do not accept these as resolution evidence:

```text
single query repeated hundreds of times
serial-only replay
one clean browser process
one clean 60-query smoke
lower worker count than baseline
only semantic answer assertions
```

---

# Phase 4 — cluster failures first

Do not manually inspect hundreds of failures independently.

Cluster by:

- React error code/text;
- current answer payload kind;
- previous answer payload kind;
- plan grain;
- result cardinality;
- tie vs single result;
- no-results vs populated;
- decline/coverage vs answer;
- worker/process;
- elapsed runtime;
- navigation type;
- response length/hash;
- server worker/PID when available.

Pay particular attention to answer-shape transitions such as:

```text
grouped -> player
player -> no_results
tie -> single
decline -> ranked
ranked -> grouped
player_game -> player_season
club_season -> team_match
large result -> single row
```

If failures cluster by transition/workload rather than query meaning, prioritise React/runtime state.

---

# Phase 5 — investigate likely boundaries

## A. Server render determinism

Search for and verify whether initial rendered output can vary because of:

- `Date.now()`;
- `new Date()`;
- `Math.random()`;
- random UUIDs;
- locale/timezone-sensitive formatting;
- unordered object/set/map iteration;
- DB query ties without deterministic `ORDER BY`;
- module-level mutable state;
- process-local state;
- worker-specific values.

Do not assume occurrences are bugs; compare failing and clean output.

## B. Keys/component identity

Inspect:

- duplicate keys;
- index-based keys;
- keys derived only from display text;
- different result types reusing the same key;
- wrappers appearing/disappearing between answer types;
- conditional tree-shape changes.

Use stable database IDs or stable semantic identifiers where appropriate.

## C. Server/Client boundary

Map every `'use client'` boundary in the `/search` path.

Check for:

- non-serialisable props;
- object shapes changing between render paths;
- missing/undefined fields changing markup;
- browser-only values affecting initial client render;
- client state initialised from stale previous props;
- effects that immediately rewrite hydrated markup.

Do not broadly convert Server Components into Client Components.

## D. App Router/RSC navigation

Determine whether errors occur during:

- first load;
- same-route search submit;
- soft navigation;
- router refresh;
- Server Action completion;
- revalidation;
- transition between answer shapes.

Capture the actual RSC/navigation response when relevant.

## E. Cache/revalidation

Inspect only with evidence:

- `revalidatePath`;
- `revalidateTag`;
- `router.refresh`;
- cached promises;
- memoised answer objects;
- cache keys missing query-specific state;
- response reuse between questions.

Do not perform a blanket caching rewrite.

## F. Cross-request mutable state

Search for mutable module-level:

- arrays;
- maps;
- sets;
- singleton answer state;
- parser state;
- formatter state;
- shared temporary objects;
- request state stored globally.

Under multi-worker mixed traffic, request state must remain request-local.

## G. Browser request race

Test whether:

```text
A starts
B starts
B commits
A arrives late
A mutates/replaces B state
```

Look for:

- overlapping navigations;
- stale-response guards;
- abort handling;
- transitions;
- action/pending state tied to unstable identity.

Capture request/commit ordering before declaring a race.

## H. Build/assets mismatch

Verify that server output and browser assets belong to the same intended deployment/build.

Check:

- service restart actually completed;
- no stale standalone bundle;
- static asset/build identity;
- worker replacement state.

Do not run acceptance against a stale server and credit it to a newly built parser/runtime.

---

# Phase 6 — test hypotheses, not guesses

Examples:

## H1 — unstable ordering/tree

Prediction:

- same semantic values but different server markup/order between fail and clean.

## H2 — answer-shape transition leak

Prediction:

- failures correlate with the previous answer payload/tree.

## H3 — overlapping navigation race

Prediction:

- failures correlate with request/commit ordering.

## H4 — process-local shared state

Prediction:

- failures cluster by worker or sustained mixed traffic.

## H5 — cache/revalidation cross-talk

Prediction:

- query/answer identity mismatches response/cache identity.

## H6 — deployment mismatch

Prediction:

- server markup and browser assets originate from different builds.

For each hypothesis record:

```text
prediction
test
evidence
result: supported / weakened / ruled out
```

Update ISSUE-068 when a meaningful hypothesis is ruled out so later audits do not repeat it.

---

# Phase 7 — patch narrowly

Only patch after locating the first wrong layer.

Valid classes of fix may include:

- stable deterministic ordering;
- stable React keys;
- request-local state;
- stale-response guard;
- corrected client initial state;
- corrected Server/Client boundary;
- precise cache/revalidation keying;
- stable tree shape;
- proper navigation/action state ownership.

Do not use:

```text
suppressHydrationWarning
arbitrary sleep
blanket client rendering
reduced concurrency
hidden console filtering
automatic retry that hides the error
```

as the solution.

---

# Phase 8 — regression coverage

The regression must preserve the actual failure condition.

If the cause is an answer-shape transition, test the transition.

If the cause requires mixed traffic, keep mixed traffic.

If the cause requires parallel navigation, keep parallel navigation.

Possible regression layers:

- component/unit;
- render/RSC;
- Playwright transition;
- parallel mini-corpus;
- full NL UI stress assertion.

Do not create a regression that only repeats one failing query serially if that never reproduced the issue.

---

# Phase 9 — verification ladder

After a fix:

## 1. Focused regression

Run the newly added targeted test.

## 2. Typecheck

```powershell
npm.cmd run typecheck
```

## 3. Relevant NL semantic suites

Ensure the runtime fix did not change search semantics unintentionally.

## 4. Guarded DB integration

Remote integration must use:

```text
AFLDB_TEST_DATABASE_URL
```

and the database name must end in:

```text
_test
```

Never substitute `afldb_dev`.

## 5. Linux build

Use the documented development build.

## 6. Legitimate service restart

Use the documented development service.

If:

```text
sudo systemctl restart afldb
```

requires an interactive password, do not:

- kill the process manually;
- bypass systemd;
- alter sudoers;
- claim new code is live.

Report deployment verification blocked until the user performs the legitimate restart.

## 7. Prove intended build is live

Use build/parser/runtime evidence.

## 8. Serial controls

Replay representative captured failures.

## 9. Reduced varied parallel corpus

Must retain the reproducing workload shape.

## 10. Expanded 501+ corpus

Use comparable worker/concurrency settings.

Acceptance:

```text
0 unexplained hydration/client errors
```

## 11. Full 12,000-query corpus

Use the same or meaningfully equivalent:

- corpus;
- Playwright project;
- concurrency;
- navigation path;
- development deployment.

Acceptance:

```text
0 unexplained hydration/client errors
```

Do not declare ISSUE-068 resolved before the full comparable acceptance run.

---

# Before/after reporting

Always separate semantic correctness from runtime correctness.

Example:

```text
BEFORE
Corpus:                  12,000
Semantic passes:         11,442
Expectation failures:       502
Hydration/client errors:    235
Hydration rate:           1.96%
HTTP failures:               0
Page errors:                 0
Timeouts:                    0

AFTER
Corpus:                  12,000
Semantic passes:             ...
Expectation failures:        ...
Hydration/client errors:     ...
Hydration rate:              ...
HTTP failures:               ...
Page errors:                 ...
Timeouts:                    ...
```

If test conditions changed, disclose exactly how.

Never claim the patch improved hydration if the after-run used lower concurrency.

---

# Corpus/oracle hygiene

Keep test-data defects separate from product defects.

Already established examples include:

```text
goalss / markss / handballss
stale debut-season oracle
stale ambiguous-surname policy
coverage-limited historical metrics
```

Rules:

- malformed generated language belongs in the generator fix;
- do not expand parser vocabulary to accept generator garbage;
- stale oracle rows are not runtime defects;
- coverage limits are not parser defects;
- keep semantic expectation failure counts separate from hydration/client errors.

---

# Useful investigation targets

Inspect actual paths first, then prioritise:

```text
src/app/search/**
src/components/**
src/search/nl/**
src/db/queries/nl/**
tests/nl-ui/**
tools/nl/**
playwright*.config.*
deploy/server-cluster.mjs
deploy/**
docs/search.md
issues.md
CHANGELOG.md
```

Useful searches:

```text
'use client'
revalidatePath
revalidateTag
router.refresh
router.push
router.replace
useTransition
useActionState
useOptimistic
useEffect
useLayoutEffect
useId
Date.now
Math.random
crypto.randomUUID
key=
suppressHydrationWarning
```

Do not treat search hits as proof.

---

# Runtime evidence

When useful record:

- Node version;
- development build identifier;
- server PID/worker;
- `AFLDB_WORKERS`;
- `AFLDB_POOL_MAX`;
- worker restart evidence;
- resource/memory errors;
- systemd journal around failure windows.

Known 12k ISSUE-068 baseline had:

```text
HTTP failures: 0
Page errors: 0
Timeouts: 0
```

Therefore do not begin with DNS/Caddy/network troubleshooting unless new evidence points there.

---

# Final report

## Summary

- status: Open / Resolved / Blocked;
- first wrong layer;
- root cause;
- before/after hydration rate;
- files changed.

## Reproduction

- corpus;
- total queries;
- workers/processes;
- hydration/client errors;
- rate;
- semantic failures;
- HTTP/page/timeouts;
- report paths.

## Representative evidence

For each selected failure:

- query;
- prior answer shape;
- current answer shape;
- client error;
- server response capture;
- hydrated DOM capture;
- clean control.

## Root cause

Use:

```text
Not yet confirmed
```

until evidence supports it.

## Changes made

List every changed file and reason.

## Verification

Report separately:

```text
Semantic correctness: PASS/FAIL/BLOCKED
Runtime/hydration correctness: PASS/FAIL/BLOCKED
```

## Remaining risk

List:

- residual hydration failures;
- intermittency;
- workload differences;
- unrelated issues.

## Audit records

Explicitly state:

```text
issues.md: updated / unchanged (reason)
CHANGELOG.md: updated / unchanged (reason)
```

---

# Final completion checklist

Do not resolve AFLDB-ISSUE-068 until:

- [ ] existing ISSUE-068 history preserved;
- [ ] known failed fixed-query reproduction strategies were not repeated as primary work;
- [ ] real varied parallel failure evidence exists;
- [ ] representative server/client mismatch evidence captured;
- [ ] same-query clean controls captured;
- [ ] first wrong layer identified;
- [ ] evidence-backed root cause documented;
- [ ] smallest owning-layer fix implemented;
- [ ] regression preserves actual failure condition;
- [ ] focused tests pass;
- [ ] typecheck passes;
- [ ] relevant NL suites pass;
- [ ] guarded DB integration passes;
- [ ] Linux build passes;
- [ ] intended build is legitimately live;
- [ ] serial controls pass;
- [ ] reduced varied parallel corpus passes;
- [ ] expanded 501+ corpus reports zero unexplained hydration/client errors;
- [ ] full 12,000-query UI corpus reports zero unexplained hydration/client errors;
- [ ] worker/concurrency level was not artificially reduced;
- [ ] semantic results did not regress;
- [ ] `issues.md` contains root cause, fix, and final validation;
- [ ] `CHANGELOG.md` contains the implemented change;
- [ ] no secrets or temporary forensic artefacts were accidentally persisted.

If any unexplained hydration/client error remains under the comparable full acceptance workload, keep `AFLDB-ISSUE-068` open.
