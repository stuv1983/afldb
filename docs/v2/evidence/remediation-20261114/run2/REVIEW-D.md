# REVIEW-D: independent review of remediation run 2 after REVIEW-C (`52efe47e..acd3a8c9`)

Reviewer: `afldb-reviewer`, 2026-11-14. Read-only (Read/Grep/Glob). No command, test or Git was run and no code was
edited, so every finding is traced from source on disk in `D:\dev\afldb-rem-20261114`. Scope: ISSUE-363 per-file
disposable integration databases (`fb9e94a6`), the REVIEW-C MED-1 fix (`42637e58`, `a563320a`), LOW-6 (`547444c6`),
LOW-7 (`e03d0d5b`), and the app/host-operation interaction across `e8666c17..acd3a8c9`.

**Verdict: no CRIT, no HIGH. 2 MED, 3 LOW, 5 INFO.** Neither MED can damage data: the base is never droppable and
only generated-shape names are ever dropped. MED-1 is the one place an owner requirement ("nothing in the change can
reach DEV") rests on a DSN-string heuristic rather than on the server; MED-2 makes one README claim ("a crash leaves
only sweepable residue") false for a kill that lands during database creation.

## Limits of this review

- Nothing was executed. Scenarios marked "not executed" are traced from source and from library or server semantics.
- No diff was available. I read the files at `acd3a8c9`; "unchanged default behaviour" is judged from the code paths
  taken when `AFLDB_TEST_PER_FILE_DB` is unset, not from a line-by-line comparison with `52efe47e`.
- `postgres` (postgres.js) behaviour was read from `D:\dev\afldb\node_modules\postgres\src\index.js` and
  `connection.js`; the review worktree has no `node_modules` of its own that Glob could see. `package.json` pins
  `^3.4.9` in both, but I did not confirm the two installs are the same patch version.
- External behaviour I could not confirm from the repository and did not guess: that Caddy's JSON access log writes
  `resp_headers` (LOW-4), that Next 16 answers a trailing slash with a 308 before middleware runs (LOW-4), that a
  PostgreSQL backend finishes `CREATE DATABASE` after its client is killed (MED-2), and vitest 4 worker/env lifetime
  (relied on the tests363 full-run evidence instead). Each is flagged where it carries a finding.
- The 58 unit tests in `tests/dsn-policy.test.ts` were sampled (`:303-362` and the describe list), not read in full.
  ESLint/typecheck status of the new files is the README's claim (`rc 0` at `ad073a72`), not re-derived.
- Evidence files under `tests363/` other than the README and the two wrappers were not opened.

## Findings

### MED-1. The "never DEV, never port 5432" rule is checked on the DSN string only; three DSN shapes pass it
`packages/testing/src/per-file-db-policy.ts:61-83` (`checkPerFileBase`); `packages/testing/src/per-file-db.ts:93-101`
(`adminDsnFor`), `:130`, `:195`, `:361`; postgres.js `src/index.js:436-439, :466-467, :484-488, :537-559`,
`src/connection.js:996-1005`.

Per-file mode does not require the isolated runner (`AFLDB_V2_ISOLATED_PG`); it runs for any base DSN that parses,
ends `_test`, states a port other than 5432 and lacks five libpq query keys. `tests/integration/guard.ts:69-91` does
verify the server, but only under the isolated runner and only AFTER `tests/setup.ts:66` has already created the
database. Concrete shapes that pass `checkPerFileBase` (none executed):

1. **Multi-host.** `postgres://u:p@10.0.40.100,127.0.0.1:55651/afldb_test`. `new URL` reads one opaque host and port
   `55651`, so the port check passes. postgres.js splits the host list and gives a host without its own port the
   default: it dials `10.0.40.100:5432` first (`index.js:545` strips the list to the first host, whose URL has no
   port, so `port` is 5432; `:467` applies it per host). `adminDsnFor` keeps the host list, so the admin connection
   and the `CREATE DATABASE` go to DEV's PostgreSQL.
2. **A forwarded port.** `postgres://u:p@127.0.0.1:15432/afldb_test` where 15432 is an SSH tunnel to DEV's 5432 (the
   guard's own failure text, `guard.ts:62`, names "any required SSH tunnel" as a normal way to reach the test
   database). The string says 15432; the server is DEV.
3. **Startup parameters.** postgres.js sends every query parameter that is not one of its own options as a startup
   parameter, and they override `user` and `database` (`index.js:487`, `connection.js:998-1003`). `?database=x` and
   `?user=y` are therefore live redirects for postgres.js and are not in the refused list, while `host`, `hostaddr`,
   `service` and `port` in the query, which the list does refuse, are inert in postgres.js (they matter only to a
   libpq child such as `psql`). This one stays on the same host and port, and `redirectDsn` carries the query string
   onto the per-file DSN, so the suite would run against database `x` while the DSN names the copy. The `_test`
   allowlist in `dsn-policy.ts:58-64` has the same gap in shared mode, so that part predates this change.

Outcome for 1 and 2: with the base role lacking CREATEDB every integration file fails in setup with a permission
error and nothing is created (fail closed). If the role can create databases there, or the operator supplies
`AFLDB_TEST_PER_FILE_ADMIN_*` for that server, `afldb_v2_pf_*_test` copies of `afldb_test` are created on and dropped
from DEV's cluster. No existing database can be dropped by any of these (the drop and sweep rules hold, see "sound").
The supported wrappers are not affected: `isolated-pg run` builds the DSNs itself (`tools/v2/isolated-pg.ts:384-401`).

Smallest fix plan (three checks, no redesign):
- `per-file-db-policy.ts` `checkPerFileBase`: refuse a `,` in `url.hostname` (`multi_host`) and refuse ANY query
  parameter rather than five named ones (`query_parameter`); pure, unit-testable on plain values.
- `per-file-db.ts`: one helper run on the admin connection before the first statement of `createPerFileDatabase`,
  `dropPerFileDatabase`, `reapLedgerDatabases` and `sweepStalePerFileDatabases`:
  `SELECT inet_server_port() AS port, current_database() AS db`; refuse unless `port` equals the DSN's port (so is
  not 5432) and `db` is `postgres`. A tunnel and a multi-host fallback both report the server's real port.
- Risk of the change: a cluster reached through a deliberate port mapping (container publish) would be refused; the
  isolated cluster here listens on its own port, so the wrappers are unaffected. `inet_server_port()` is NULL on a
  Unix socket: treat NULL as a refusal.
- Acceptance: `tests/dsn-policy.test.ts`, describe `per-file databases: mode and base refusals`: add the multi-host
  DSN and `?database=x` / `?application_name=x` to the refusals, and one injected-connection case whose fake server
  answers port 5432 and must be refused before any `CREATE`. Then one `MODE=all` run of a single integration file
  through `run-integration-per-file.sh` to show the server check passes on the real isolated cluster.

### MED-2. A kill during `CREATE DATABASE` leaves a database the sweep will never remove
`packages/testing/src/per-file-db.ts:146` (create) and `:170` (comment);
`packages/testing/src/per-file-db-policy.ts:200` (`marker comment differs from the base`).

The marker comment is applied by a second statement after the create. A SIGKILL of the worker (or of the whole run)
while the server is executing `CREATE DATABASE` does not cancel the statement: the backend notices the dead client
only when it next touches the socket, after the create has committed. The result is a generated-shape database with a
NULL comment. In an isolated cluster the base always carries the marker (`guard.ts` requires it), so
`selectStalePerFileDatabases` keeps that database forever with "marker comment differs from the base". The README
measures creation at 232 s of a 1,795 s run, so roughly one kill in eight lands in the window. Each such orphan is
407 MB, is listed as `kept` by every later sweep, and needs a manual superuser `DROP DATABASE`. This contradicts
README "Crash (SIGKILL, reboot). ... `sweep-per-file-dbs.sh` removes them" and residual 2. Not executed; the server
half is PostgreSQL semantics I could not confirm from the repository (default `client_connection_check_interval`).
The end-of-run reaper has the same narrow gap: `DROP DATABASE IF EXISTS` issued while the create is still in flight is
a no-op.

Smallest fix plan: in `selectStalePerFileDatabases`, treat a generated-shape name with `comment === null` as
sweepable (keep refusing a non-null comment that differs from the base's). The name shape, the `_test` suffix, the
base exclusion and the age bound all still apply. Risk: in a cluster holding two bases with different markers, either
base's sweep may remove the other's comment-less orphan; it is an orphan either way and is at least an hour old.
Acceptance: `tests/dsn-policy.test.ts`, describe `per-file databases: sweep selection`: a candidate with the generated
shape, older than the bound, `comment: null`, base comment set, must be in `drop`; the existing "different marker"
case must stay in `kept`. Update README residual 2 to say which case is covered.

### LOW-3. MED-1 parser fix: the auxiliary cue still reads a period noun as Barry Round
`src/search/nl/parser.ts:2173-2179`.
The next-word check was added to the start-of-question alternative only (stated in the comment, `:2169-2171`).
`which was round with most goals` or `what is round with the most goals`: one occurrence of the word, matched by
`\b(?:...|was|is|...)\s+round\b`, so `roundIsSurnameSubject` is true; if `which`/`what`/`was`/`with` are stripped as
stopwords the span is `round` and the Round family is planned, the same wrong answer MED-1 described. Not executed,
and the phrasing omits "the" ("what was THE round with..." declines correctly), so it is rarer than the MED-1 shape.
Fix if wanted: give the auxiliary alternative a lookahead on the non-auxiliary subset only
(`with|of|by|in|for|that|which|where|when|on|at|to|from|during|than`), which keeps the tested
`has round had the most goals`; add the two questions to the declining `it.each` at `tests/nl-parser.test.ts:5372`;
acceptance is the focused describe `Review B-03` plus the parse-only V5 corpus diff (expect 0 changed).

### LOW-4. Invite token can still reach the access log through the response `Location` header
`deploy/Caddyfile.production:66-78`, `deploy/Caddyfile:29-33` (the filter rewrites `request>uri` and
`request>headers>Referer` only); `src/middleware.ts:156-159`.
`/admin/invite/<token>/` (a link with a trailing slash, the same "mangled link" class as REVIEW-C LOW-7) is not under
a protected prefix, reaches Next, and is answered with a redirect whose `Location` is `/admin/invite/<token>`. The
request `uri` is redacted; `resp_headers.Location` is not. Second shape: an unadmitted visitor to a non-public
spelling such as `/Admin/Invite/<token>` is sent to `/beta?from=%2FAdmin%2FInvite%2F<token>` (`middleware.ts:158`).
The LOW-7 probes (`caddy357/README.md` section 9) ran against a stub that answered 200, so no redirect was ever
logged. Two external facts I could not confirm from the repository and hand to the orchestrator: that Caddy's access
log includes `resp_headers`, and that Next's trailing-slash redirect is a 308 with that `Location`.
Fix: add `resp_headers>Location` to `(afldb_log_format)` in both files with the same two invite rules and the
query-drop rule, extend the contract test at `tests/settle-season-revalidation.test.ts:1107`, and add a redirecting
case to `redact.sh`. Acceptance: token count 0 in the access log for `/admin/invite/T/` against the real app.

### LOW-5. Per-file mode needs the base DSN in the main process environment
`packages/testing/src/per-file-global-setup.ts:16-17`; `tests/setup.ts:39-48`.
`.env` is loaded by the setup file in each worker, not in the vitest main process, so with the mode on and the DSN
only in `.env` the globalSetup refuses with "AFLDB_TEST_DATABASE_URL is not set". Fails closed with a misleading
reason; the isolated runner forbids `.env` anyway (`isolated-pg.ts:428-429`). No fix needed; one sentence in the
README would do.

### INFO
- **I-6** README "the password ... never enters any environment, so no test, imported module or child process can see
  it" overstates: the file's path is in the environment and the file is readable by the same uid; the admin DSN is a
  string in the worker's memory. True as written only for the environment, argv and logs.
- **I-7** `adminDsnFor` (`per-file-db.ts:99`): a password containing `%` is not re-encoded by the `URL.password`
  setter and is then percent-decoded by postgres.js, so it fails to authenticate (or throws `URIError`, which carries
  no DSN). Fails closed.
- **I-8** `MODE=1`: files outside `COMMITTING_SUITES` run against the base and anything they commit is inherited by
  every later copy. Already README residual 4; `=all` is the safe mode.
- **I-9** The sweep can remove a live run's fully-skipped-file databases once they are over the bound (they live to
  the end of the run; `timeout 10800` allows three hours). Nothing uses them and the reaper's `DROP ... IF EXISTS`
  tolerates it. A hung file older than the bound would be force-dropped; the README says not to sweep during a run.
- **I-10** `PARSER_VERSION` stayed 69. It is consumed only as a label: written to `nl_search_log.parser_version`
  (`src/db/queries/nl/answer.ts:108-183`, `log.ts:163`), shown in admin pages and the export, and stamped on NL corpus
  run labels (`tools/nl/v2-runner.ts:539, :702`, `compare-runs.ts:128-129`). Nothing keys a cache, a plan token or a
  behaviour on it. The reasoning holds as long as no v69 build wrote log rows anywhere durable; corpus runs made at 69
  before the fix are distinguished by the `gitCommit` in the same label.

## Checked and found sound

**ISSUE-363 per-file databases**
- **Default unchanged.** Mode off: the globalSetup returns `undefined` (`per-file-global-setup.ts:15`);
  `perFileAppliesTo` returns false first (`per-file-db-policy.ts:247`), so `tests/setup.ts:64-76` creates nothing and
  registers no hook. A typo in the mode throws in both places instead of running shared mode.
- **Create.** The name is always generated (`per-file-db.ts:121-126`), validated prefix, 61 characters at most, ends
  `_test`. The owner must match `SAFE_IDENT`; the strategy is an enum; the base name cannot contain a `"` (URL path
  encoding) and must exist in `pg_database`; the comment is quote-doubled. No session on the base is terminated.
- **Drop.** `dropPerFileDatabase` asserts before connecting: not the base, ends `_test`, generated shape, in this
  process's registry (`per-file-db-policy.ts:159-172`). The reaper applies the same rule with the ledger as the set,
  and the ledger directory path is held in the main process closure, not re-read from the environment
  (`per-file-global-setup.ts:18-21`). The sweep excludes the base by name before any other test (`:196-197`).
- **Redirect.** `redirectDsn` changes only a variable whose host, port and database equal the base's; a mismatch in
  the import-role DSN is caught by `validateImportRoleParityDsnTargets` (`tests/setup.ts:78-82`), which compares
  endpoint and database after the rewrite.
- **Leak guard.** `leaked-fixtures.ts:111-134` is unchanged and reads the connection it is given, so a contaminated
  base is copied into the file's database and the guard fires there; 2061 and 2062 are in the reserved map.
- **Secret handling.** The password is read per connection into a URL object, never into `env`, argv or a message;
  both wrappers pass only the path; `adminDsnFor` and `withDb` parse only already-valid URLs, so Node's
  `Invalid URL` error (which carries its input) cannot fire with the password in it; refusal messages name checks.
- **Reaper for fully-skipped files.** The ledger entry is written before the create (`per-file-db.ts:142-143`) and
  removed on every handled failure and on a successful drop, so a file that never runs `afterAll` is still recorded
  and is dropped at teardown.
- **Sweep versus a concurrent run.** A bound under 60 minutes is refused, a missing or non-numeric
  `--max-age-minutes` value becomes `NaN` and is refused, and age is taken from the stamp in the name.
- **DEV/production reach** through the supported wrappers: none; both run under `isolated-pg run`, which verifies the
  cluster and builds every DSN. The exceptions are MED-1.
- **Awards season move.** `2061` and `2062` appear in `tests/` only in `awards-reload-links.test.ts:4259-4261`, the
  registry and its unit test; the one other hit (`tests/fixtures/oracle_baseline.json:651`) is a data value, not a
  season fixture. No suite derives a season in the 2060s.
- No nested `tests/integration/*/` test files exist, so `=all` cannot silently skip one.

**MED-1 parser fix.** The start-of-question cue now refuses all eight REVIEW-C shapes and the ISSUE-356 (c) declining
cases are still listed and still decline by construction (`in a`, `in the`, `by` precede the word, so neither
alternative matches). Every remaining mismatch I could construct on the `^` alternative is a decline, not a wrong
answer (`round in 1975 goals`, `round for sydney goals`). `rounds` never matches the cue.

**LOW-6.** Wording only; the sentence matches `writeMatchFacts` step 1 (`src/db/queries/admin-brownlow.ts:811-823`),
and it is appended only when an unlinked vote is among the dependents (`match-sheet-dependents.ts:138`).

**LOW-7.** The second rule sits before the query-drop rule in both files, is identical in both, leaves
`/admin/invites` alone, and the contract test pins the exact text and the order.

**App and host operations (`e8666c17..acd3a8c9`)**
- No page or route file exists under the eight protected prefixes beyond the allowed shapes (18 files enumerated;
  `/clubs/compare` and `/players/compare` are single lower-case segments, the busy state changes no URL, and there is
  no `opengraph-image` or `route.ts` under them).
- B-05: `/admin/login` and `/beta?from=...` are outside layer 4, and the `from` value is in the query, which layers
  1 to 3 exclude. `adminClaimBelowBetaEpoch` mints nothing and returns false on a malformed epoch, so no loop.
- `/admin/invite` stays a public prefix, so a normal invite click is never redirected with the token in `Location`.
- `deploy/release.mjs` runs neither ESLint nor vitest, so the new vitest `globalSetup` and the lint gate cannot
  affect a release build; the lint gate lives in `preflight` and `merge:ready` only.
- The settle revalidation endpoint is loopback to the app and does not pass through Caddy.
- The combined install in `caddy357/README.md` section 10 names all three changes, one backup and one rollback, and
  answers REVIEW-C MED-2.

## § Re-check of fixes (f10e47ad)

Same rules: read-only, nothing executed. Files read at `f10e47ad`: `packages/testing/src/per-file-db-policy.ts`,
`per-file-db.ts`, `per-file-global-setup.ts`, `src/search/nl/parser.ts:2150-2190`, both Caddyfiles' log snippet,
`caddy357/low4/README.md`, `tools/v2/isolated-pg.ts:184-186`. The new unit tests were located by grep
(`tests/dsn-policy.test.ts:368-481, :583-615, :688-757`), not read line by line, and the REVIEW-D addendum in
`tests363/README.md` was not opened.

**All five findings FIXED. No new defect found. The supported wrapper path is not broken by the new checks.**

| Finding | Status | Where |
|---|---|---|
| MED-1 DSN checks string-only | **FIXED** | `per-file-db-policy.ts:93-110` (`checkDsnShape`: comma in host, ANY query parameter), `:113-127` (same checks plus the port rule on the admin DSN), `:134-157` (server identity); `per-file-db.ts:106` (admin DSN asserted where it is built), `:115-122` (`verifyAdminServer`), called before the first statement at `:156` (create), `:221` (drop), `:270` (reaper), `:315` (audit), `:392` (sweep) |
| MED-2 comment-less orphan unsweepable | **FIXED** | `per-file-db-policy.ts:274-276`: a NULL comment on a generated-shape name is sweepable; a different non-null comment is still kept; base exclusion, shape and age bound unchanged |
| LOW-3 auxiliary cue | **FIXED** | `parser.ts:2179-2184`: the auxiliary alternative now carries a lookahead on the non-verb words only; `has round had the most goals` still reads as a surname; declining cases added at `tests/nl-parser.test.ts:5392-5394` and `tests/integration/nl-semantic-mapping.test.ts:986-987` |
| LOW-4 token in `Location` | **FIXED**, and wider than I reported | `deploy/Caddyfile.production:79-86`, `deploy/Caddyfile:37-44`: the any-spelling invite rule and the query-drop rule on `resp_headers>Location` and `resp_headers>Refresh`, identical in both files; contract test `tests/settle-season-revalidation.test.ts:1117`. The measurement (`low4/README.md`) confirmed both external facts I could not (Caddy logs `resp_headers`; Next answers the trailing slash with a 308) and found `Refresh` and the magic-link token as well |
| LOW-5 misleading "not set" | **FIXED** | `per-file-global-setup.ts:22-28` names the `.env` cause before the generic check |

**Wrapper path (`isolated-pg run`).** `dsnFor` (`tools/v2/isolated-pg.ts:184-186`) builds
`postgresql://<user>:<pw>@127.0.0.1:<port>/<db>`: one host, an explicit port, no query string, so `checkDsnShape`
returns nothing for the base and for the admin DSN derived from it. The connection is TCP to loopback, so
`inet_server_port()` is the cluster's own port (not NULL) and equals `new URL(adminDsn).port`; `adminDsnFor` sets the
path to `/postgres`, so `current_database()` matches. Not executed; the qualification running at `f10e47ad` is the
proof.

**Residuals, all INFO (no work):**
- A percent-encoded comma in the host (`h1%2Ch2:55651`) is not a literal comma to `new URL`, so the string check
  passes, and postgres.js decodes it into a host list. Both entries then use the stated port, never 5432, and the
  server check still requires that port, so the 5432 rule holds.
- The audit's second and third connections (`per-file-db.ts:326, :347`) are not themselves server-checked; they reuse
  the host and port just verified on the maintenance connection.
- A non-isolated DSN that legitimately needs a query parameter (`?sslmode=require`) is now refused for per-file mode.
  Fail closed, and the message names the parameter.
- The other `*DATABASE_URL*` variables are not shape-checked; `redirectDsn` still carries a query string onto the
  per-file DSN. Under the wrapper none has one. The shared-mode `_test` allowlist has the same gap and predates
  this run.
- LOW-3 makes `did round in 1975 kick goals` decline. A decline, not a wrong answer.
- `Location` is now logged without its query (`/beta` instead of `/beta?from=...`). Log content only; responses
  are unchanged per `low4/README.md`.
