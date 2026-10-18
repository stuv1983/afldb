# Plan review — AFLDB V2 Launch A (2026-10-19)

Reviewer: `afldb-reviewer` (plan review at launch). Read-only review of `D:\dev\afldbV2`;
this file is the only artefact written. No command was executed. The source worktree
`D:\dev\afldb-afl-api-cutover` was not touched.

Reviewed against disk, not against the plan's own description: `docs/v2/plan.md`,
`docs/v2/owner-instruction-2026-10-19.md`, `docs/v2/baseline.md`,
`docs/v2/evidence/baseline-failures.txt`, `tests/setup.ts`, `tests/integration/guard.ts`,
`vitest.config.mts`, `tsconfig.json`, `eslint.config.mjs`, `next.config.ts`, `package.json`,
`src/db/client.ts`, `src/db/authClient.ts`, `tools/current-season/load-env.ts`,
`tools/db/migration-safety.ts` (head), plus targeted index lookups for `grant_app_read`,
auth-DSN handling and `next/font/google` (none used).

## Verdict

**Proceed with resolutions.** Nothing in Launch A requires an owner stop (no production,
credential, destructive-DB, deploy or product-contradiction condition is reached). Two findings
are HIGH and must be resolved by plan amendment **before any Stage 1 code is written**; both are
resolvable with text changes to `docs/v2/plan.md` and a small change to how D5 is implemented.
Per CLAUDE.md §15 a HIGH at plan review goes to the user: the orchestrator should put R-001 and
R-002 (and their proposed amendments) in front of the user before executing Stage 1.

## Findings

### R-001 — HIGH — D5 "fail closed" is under-specified and its acceptance check is too narrow
`docs/v2/plan.md:71-76`, `docs/v2/plan.md:122`; `tests/setup.ts:12-14, 36-68`.

- "make an absent `AFLDB_TEST_DATABASE_URL` fail closed" can be read as *throw*. `tests/setup.ts`
  is the global `setupFiles` entry (`vitest.config.mts:13`) for all 265 test files; a throw on
  absence would fail every one of the 167 currently-passing files. It must mean **strip, never
  throw**: on absence, delete `DATABASE_URL`, `AFLDB_AUTH_DATABASE_URL`, `AFLDB_OWNER_DATABASE_URL`,
  `AFLDB_IMPORT_DATABASE_URL` and any other `*DATABASE_URL*` key, leaving the existing non-fatal
  comment at `tests/setup.ts:12-14` true.
- Order matters: the existing throw at `tests/setup.ts:61-66` (`AFLDB_TEST_IMPORT_DATABASE_URL`
  set without a test DSN) is itself a fail-closed signal. If the strip runs first it can never fire
  — a silent weakening. Strip **after** the existing checks, or exclude that key from the strip.
- Stage 1 acceptance says only "baseline suites unchanged". For a change to a file loaded by all
  265 test files, the seven-suite set (831 tests) is not an acceptance check. Failure scenario: the
  strip (or a thrown error) changes a unit suite outside the seven; the step is reported complete
  on 829/2. Resolution: Stage 1 acceptance = full `vitest run --no-cache` (same env as
  `baseline.md` §"Baseline verification"), diffed against `docs/v2/evidence/baseline-failures.txt`:
  identical failing-file set (96) and identical failing-case set (15), **and** the 87 load-failure
  messages unchanged ("AFLDB_TEST_DATABASE_URL must be set" from `tests/integration/guard.ts:20-25`;
  "DATABASE_URL is not set" from `src/db/client.ts:19`). In the V2 environment every DSN is already
  unset, so the strip is a no-op there and the baseline cannot legitimately move.

### R-002 — HIGH — the three D5 "proof" tests are vacuous as specified, and the one failure that matters is undetectable locally
`docs/v2/plan.md:73-74`; `tests/setup.ts:36-58`.

- "with no test DSN, `DATABASE_URL` is unset in tests" passes today without any change (nothing is
  set in V2). A test that only asserts `process.env.DATABASE_URL === undefined` proves nothing.
- The dangerous mis-implementation — stripping `DATABASE_URL` **even when** a `_test` DSN is
  present, undoing `tests/setup.ts:57` — cannot be observed on this workstation (no DB) and would
  break every integration suite on the Linux dev host with "DATABASE_URL is not set". It would be
  carried into V2 as a passing build.
- Resolution (smallest correct): factor the policy into a pure function, e.g.
  `tests/dsn-policy.ts` `applyTestDsnPolicy(env: Record<string,string|undefined>)` returning the
  mutated env or throwing; `tests/setup.ts` calls it after the `.env` load. Unit-test the function
  with env objects: (a) nothing set → every `*DATABASE_URL*` removed, no throw; (b)
  `AFLDB_TEST_DATABASE_URL=…/afldb_test` plus a stray `DATABASE_URL=…/afldb_dev` →
  `DATABASE_URL` becomes the test URL (not deleted); (c) `…/afldb_dev` → throws the existing
  message (`tests/setup.ts:49-53`); (d) `…/afldb_prod` ("production-looking") → throws by the same
  `_test$` rule — state explicitly that the rule is the allowlist suffix, not a host heuristic;
  (e) non-URL → throws "not a valid connection URL". Record in the Stage 1 report that the
  present-DSN branch is **unverified on a live database** (honesty rule §6).

### R-003 — MED — "narrowest fail-closed guard" in runtime files could refuse production's own DSN
`docs/v2/plan.md:75-76`; `src/db/client.ts:16-20`, `src/db/authClient.ts:32-39`,
`tools/current-season/load-env.ts:60-79`.

These are production runtime paths. `load-env.ts` is the systemd `.env` loader whose "already-set
wins" semantics are the ISSUE-244 F016 contract (`load-env.ts:56-58`) and are covered by the
seven-suite set. A `_test`-only refusal in any of them would make a deployed V2 refuse
`afldb_prod`/`afldb_dev`. Resolution: plan text must say the runtime files keep accepting
production DSNs; the only admissible guard there is scoped to `process.env.VITEST` (set by vitest)
and refuses a non-`_test` database name under test — or no change, with the finding recorded in
`known-gaps.md`. Do not alter `loadEnv()` semantics.

### R-004 — MED — `AFLDB_AUTH_DATABASE_URL` is never redirected when a test DSN *is* present
`tests/setup.ts:56-58` (redirects only `DATABASE_URL`); `src/db/authClient.ts:33`;
`tools/maintenance/02_add_auth_role.sh:75-77` writes an `afldb_dev` auth DSN into `.env`.

Pre-existing gap, but D5's "every other DSN variable" covers only the absent case. On a host with
`.env` present and `AFLDB_TEST_DATABASE_URL` set, auth-pool suites run against whatever
`AFLDB_AUTH_DATABASE_URL` names (the ISSUE-155 scripts rewrite it by hand, so the suites rely on
operator discipline). Resolution: in the present-DSN branch, if `AFLDB_AUTH_DATABASE_URL` is set and
does not name a `_test` database, throw with a sentence naming the variable. Mark it "unverifiable
locally; may surface on the Linux dev host" in the Stage 1 report and `known-gaps.md`.

### R-005 — MED — `next build` is not executable in V2 without a database; the brief's "possibly `next build --webpack` if it opens no DB" cannot be met
`src/db/client.ts:47` (pool built at import; throws at `:19` with no `DATABASE_URL`);
`src/db/authClient.ts:59-63` (confirms builds expect `DATABASE_URL`, only auth is lazy);
`package.json:8`; owner go/no-go `owner-instruction-2026-10-19.md:475`.

"Collecting page data" imports route modules, so any route reaching `src/db/client.ts` throws
before prerender. Resolution: drop `next build` from Launch A; keep `next typegen` + `tsc` (already
in `baseline.md`) and record `V2-GAP-00n frontend build unexecuted: no database available`. Forbid
pointing a build at any non-loopback DSN. Set `NEXT_TELEMETRY_DISABLED=1` for every `next` command
— telemetry is network access outside plan §1's npm-registry-only allowance.

### R-006 — MED — plan omits owner-required deliverables
`docs/v2/plan.md:119-127` vs `owner-instruction-2026-10-19.md:192, 437, 441-442, 453, 455, 459, 461, 463`.

Missing from every stage row: database compatibility and ownership matrix (owner l.192/455);
architecture overview (`docs/v2/architecture.md` is referenced at `plan.md:52` but no stage
delivers it); admin-centre operating guide (l.459); migration plan (l.461); **backup** plan (l.463
says backup *and* rollback; Stage 6 lists rollback only); frontend integration/contract tests
(l.437); explicit tests "runtime has no dependency on CSV/AFL Tables" and "no scheduler or admin
path invokes legacy tools" (l.441-442) appear only implicitly in D10. Resolution: add to §4 —
Stage 1: `architecture.md`; Stage 2: ownership matrix (draft), Stage 4: completed; Stage 5: admin
operating guide; Stage 6: backup + rollback plan, migration plan; Stages 4/5: name the two legacy
independence tests and the frontend contract test as deliverables.

### R-007 — MED — Stage 2 tooling: refusal semantics inconsistent and "read-only" undefined
`docs/v2/plan.md:123` ("comparison script that takes a DSN … refuses non-`_test` unless
`--read-only` + explicit confirmation flag") vs launch brief (offline comparator with no DSN;
manifest *producer* refusing non-`_test` unless `--read-only-source`); owner l.389 (no production
data in the repository).

A client-side flag does not make a connection read-only. Resolution, to be written into the plan:
(a) the comparator is DSN-free (two manifests in, diff out); (b) the producer takes a DSN only from
an explicit `--dsn-env <VAR>` flag, never implicitly from `DATABASE_URL`; (c) a non-`_test`
database requires **two** flags (`--read-only-source` and a confirmation flag whose name states the
risk) and read-only is enforced server-side — `SET default_transaction_read_only = on` and
`BEGIN READ ONLY` — with a unit test asserting that SQL text through a fake client; (d) the
manifest holds counts/checksums only, never row content; (e) never run against any database in
Launch A. Also add owner Stage 2 "document restoration and reconciliation" (l.390) to the row,
or point it at Stage 6.

### R-008 — MED (Stage 4, later launch) — migration → privileges → code ordering and pglite feasibility are unstated
`docs/v2/plan.md:59-62, 67-70, 125`; `src/db/migrations/039_app_read_is_fail_closed.sql:97-116`;
`src/db/migrations/097_fixtures.sql:342-346`; `package.json:16-18` (`db:privileges*`).

A `111_` migration that calls `afldb_meta.grant_app_read()` / `grant_import_write()` cannot execute
in a bare pglite: the functions, `afldb_meta` and the roles come from earlier migrations D2 forbids
replaying — so D2's fallback will trigger on exactly the fail-closed statements. The plan also never
names the `tools/db/privileges.ts` update or the deploy-order comment that 097 carries (ISSUE-027).
Resolution for the Stage 4 row: privileges script update; a 097-style deploy-order comment in the
migration; pglite harness either pre-creates labelled `afldb_meta` stubs or executes DDL only, with
the grants "statically reviewed, unexecuted"; the `-- ROLLBACK:` block must be comment lines only
because the runner executes the whole file (`tools/db/migration-safety.ts:48-62` hashes it whole).

### R-009 — LOW — `@afldb/*` mapping and test location need pinning
`tsconfig.json:25-29, 31-37`; `vitest.config.mts:8, 23-31`.

`tsconfig.json` `include` already covers `packages/**` (`**/*.ts`), so no include change is
needed. A mapping `"@afldb/*": ["./packages/*/src"]` resolves `@afldb/domain/x` to
`packages/domain/x/src`; pin `["./packages/*/src/index.ts"]` and have the boundary test forbid
subpath imports; mirror as a regex alias in vitest. `vitest.config.mts:8` collects `tests/**` only:
state that package tests live under `tests/` (CLAUDE.md §10) rather than beside the code.

### R-010 — LOW — `no-restricted-imports` matches specifiers, not resolved files; `testing` has no place in the dependency direction
`eslint.config.mjs:5-18`; `docs/v2/plan.md:54-58`.

Flat-config `no-restricted-imports` with per-directory `files` is feasible, but a relative import
(`../../../src/lib/x`) escapes an `@/`-based pattern. The boundary test should resolve specifiers
(`issues/closed/AFLDB-ISSUE-265-phase-a/tools/import-graph.mjs` uses `ts.preProcessFile` and is a
DB-free precedent). State that `packages/testing` may import any package and only `tests/**`
imports it.

### R-011 — LOW — "eslint clean on changed files" invites unrelated edits
`docs/v2/plan.md:114-115, 122`; `docs/v2/baseline.md:59` (253 pre-existing errors).

`src/db/client.ts`, `tests/setup.ts` and friends may already carry findings. Define the gate as
"no new findings in changed files" so Stage 1 does not drift into unrelated lint fixes (CLAUDE.md §13).

### R-012 — INFO
- `docs/v2/plan.md:135` attribution names "Claude Opus 5.5"; CLAUDE.md pins the orchestrator at
  Opus 5. Use whichever model actually commits.
- D3 (`plan.md:63-66`) departs from CLAUDE.md §5 ID allocation for a sound reason (ledger
  collision); say so in the `CHANGELOG.md` V2 section.
- Owner stop conditions: none are reached by Launch A as scoped. The pglite install is the only
  network contact and is pre-authorised (D2).
- Hazard check: a root listing of the source worktree was truncated (6,642 entries), so I could
  not confirm the absence of hook-created stray files. Ask the user to run `git status --porcelain`
  in `D:\dev\afldb-afl-api-cutover` and compare with the launch snapshot before Stage 1.

## Proposed plan amendments (for the orchestrator to apply to `docs/v2/plan.md`)

1. D5 (l.71-76): replace with the strip-never-throw wording, the ordering rule, the
   `applyTestDsnPolicy` factoring, the five test cases, the `VITEST`-scoped limit on runtime guards,
   and the present-DSN `AFLDB_AUTH_DATABASE_URL` refusal, each with its "unverified on a live
   database" label where applicable (R-001..R-004).
2. Stage 1 acceptance (l.122): full `vitest run --no-cache` diffed against
   `evidence/baseline-failures.txt` (file set, case set, load-failure messages); `next build` not
   attempted; `NEXT_TELEMETRY_DISABLED=1` (R-001, R-005).
3. Stage 2 row (l.123): split comparator/producer, two-flag non-`_test` refusal, server-side
   read-only, counts/checksums only, restoration doc (R-007).
4. §4 table: add the omitted deliverables per R-006; Stage 4 row per R-008.
5. D1 (l.45-58): pin the `@afldb/*` mapping, test location and `testing`'s position (R-009, R-010).
