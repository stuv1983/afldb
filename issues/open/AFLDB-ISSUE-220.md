# AFLDB-ISSUE-220 — Web service credential boundary contradicts the application's `afldb_import` requirement; owner-role code-test DSN and a complete `.env` copy reach the internet-facing process

Status: **Open — planning runbook, 2026-09-17 (Fable 5.1 code review outside NL search).
F-A and F-B confirmed on DEV by operator-run, names-only host checks. The runtime branch is
SETTLED as (a) from Next.js source read on DEV (§4): the standalone server loads
`.next/standalone/.env` at start-up. The build mechanism that copies `.env` there is NOT
established (§4b) and is the implementation task's first step. No product, test, deployment or
documentation file has been changed. Implementation is a separate task.**

## 1. Objective

Make the web service's credential set true, minimal, documented and tested:

1. the process holds exactly the DSNs it needs (`DATABASE_URL`, `AFLDB_AUTH_DATABASE_URL`,
   `AFLDB_IMPORT_DATABASE_URL`) and nothing else — no owner, backup, test, code-test or prod DSN;
2. the build output carries no credential file;
3. `deploy/afldb.service` and `docs/deployment.md` §9 describe that state accurately;
4. a source-contract test fails if a future DSN name or a future unit edit breaks it.

## 2. Confirmed evidence (2026-09-17)

| # | Fact | Source |
|---|---|---|
| E1 | `UnsetEnvironment=` in the web unit removes `AFLDB_IMPORT_DATABASE_URL`, owner, test, backup and prod DSNs; comment claims the website needs only the read-only role | `deploy/afldb.service:35-44` |
| E2 | Docs claim the process holds only `DATABASE_URL`, "which cannot write" | `docs/deployment.md:1093-1097` |
| E3 | Twenty-one modules require `process.env.AFLDB_IMPORT_DATABASE_URL` for every Admin Centre statistical mutation and fail closed without it | `src/db/queries/admin-*.ts`, `awards-admin.ts`, `data-edits.ts`, `match-admin.ts`, `match-sheet.ts`, `player-links.ts`, `players.ts:444`, `src/lib/ingest/pipeline.ts:257`, `src/lib/external-afl/current-season-import.ts:376` |
| E4 | `AFLDB_CODE_TEST_DATABASE_URL` is the **owner** DSN and `AFLDB_CODE_TEST_IMPORT_DATABASE_URL` the import DSN for `code_test_db` (AFLDB-ISSUE-146); neither is in the unset list | `docs/deployment.md:245`, `tools/db/rebuild-test.ts:151-152`, `deploy/afldb.service:44` |
| E5 | DEV running process initial environment (names only): `DATABASE_URL`, `AFLDB_AUTH_DATABASE_URL`, `AFLDB_CODE_TEST_DATABASE_URL`, `AFLDB_CODE_TEST_IMPORT_DATABASE_URL` | operator host check, streamanator, 2026-09-17 |
| E6 | `/home/arm/projects/afldb/.next/standalone/.env` exists with the same variable names as the project `.env` (import, owner, backup, test, SMTP, API credentials) | operator host check, streamanator, 2026-09-17 |
| E7 | No repository code reads or copies `.env` for the web process; `.env*` and `.next/` are git-ignored; `prepare-standalone.mjs` copies only static/public/coming-soon | grep of `src/`, `deploy/`, `tools/build/`; `.gitignore:11,25-28` |
| E8 | Exec-time environment on DEV 2026-08-29 held only `DATABASE_URL` and `AFLDB_AUTH_DATABASE_URL` (before ISSUE-146 added the code-test DSNs) | `issues/closed/AFLDB-ISSUE-107.md:452` |
| E9 | Only the *settle* unit's DSN list is pinned by a test; the web unit is read by one test for `HOSTNAME` only | `tests/current-season-import.test.ts:4801-4802`, `tests/settle-season-revalidation.test.ts:1073` |

Nothing above required or displayed a credential value.

## 3. Findings

- **F-A (confirmed, High):** an owner-role DSN and a second import-role DSN are live in the
  internet-facing process because the deny list was never extended (E4, E5). Material under any
  runtime branch.
- **F-B (confirmed, High):** the deployed build output contains a full copy of `.env` (E6, E7),
  outside the unit's control and inside a path the unit makes writable. Material under any
  runtime branch: a path traversal, a debug endpoint or a backup of `.next/` exposes every secret.
- **F-C (confirmed contract contradiction; §4 settled the runtime side):** the unit and docs deny
  the web process the one DSN the Admin Centre write path requires (E1–E3), and the process has
  it anyway only because the framework reloads the copied `.env` at start-up (§4).

## 4. Runtime branch — SETTLED (a), 2026-09-17, from Next.js source on DEV

The operator read the control flow in the installed Next.js under
`~/projects/afldb/node_modules/next/dist/server/` and in the generated
`.next/standalone/server.js` on streamanator (source lines only; no values):

| Step | Observed |
|---|---|
| S1 | `.next/standalone/server.js` sets its directory to `__dirname` (the standalone root) and `chdir`s into it |
| S2 | `BaseServer`'s constructor calls `this.loadEnvConfig()` |
| S3 | `NextServer.loadEnvConfig()` calls `@next/env`'s `loadEnvConfig(this.dir, …)` — `this.dir` is the standalone root from S1, where the copied `.env` (E6) sits |
| S4 | The `__NEXT_PRIVATE_STANDALONE_CONFIG` early return in `config.js` bypasses only `loadConfig`'s own env-loader call; it never reaches the `BaseServer` call in S2 |

**Conclusion (branch (a)).** At every start of the web service, the framework loads the full
project `.env` from the standalone tree into `process.env`. `UnsetEnvironment=` in
`deploy/afldb.service` strips the listed names from the exec-time environment, and S1–S4 put them
straight back. So: every credential in `.env` is live in the internet-facing process; the
documented boundary is false; the Admin Centre's `afldb_import` writes succeed on DEV only because
of this bypass. This reconciles the DEV acceptances of AFLDB-ISSUE-155/165/167 with
AFLDB-ISSUE-107's exec-time `/proc/<pid>/environ` view (E8). Branch (b) is ruled out for DEV.
PROD has not been inspected (§8 step 6).

**Independent of S1–S4:** the two code-test DSNs (E5), including the owner-role
`AFLDB_CODE_TEST_DATABASE_URL`, were observed in the service's *initial* environment, i.e. before
any framework loading. That is a deny-list gap in the unit itself and is fixed by the unit alone
(§6 step 2), whatever happens to the standalone `.env`.

## 4b. Still NOT established — the build mechanism that copies `.env` (implementation step 1)

The build-trace lines the operator displayed did not establish how `.env` reaches
`.next/standalone/`. What is known: no repository code writes it (E7); it is present after
`next build`; `prepare-standalone.mjs` never touches it. Before choosing the exclusion in §6
step 4, the implementer must identify the mechanism from the installed Next major's build code
(`node_modules/next/dist/build/`) and its shipped docs (`node_modules/next/dist/docs/`,
per `CLAUDE.md`: this is not the Next of training data), then pick the supported knob. Do not
guess `outputFileTracingExcludes` without that reading; a wrong exclusion silently leaves the file
in place and §8 step 3 is what catches it.

## 5. Affected files (implementation task)

- `deploy/afldb.service` — `UnsetEnvironment=` list and lines 35-44 comment.
- `docs/deployment.md` — §9 environment table and the "The web service does not receive them
  all" paragraph; §5/§7 wherever the credential set is described.
- `tools/build/prepare-standalone.mjs` — post-build assertion that no `.env*` exists under
  `.next/standalone/` (fail the build if it does).
- `next.config.ts` — only if branch (a) requires excluding `.env*` from output file tracing
  (`outputFileTracingExcludes` or the equivalent for the installed Next major; consult
  `node_modules/next/dist/docs/` first — this is not the Next of training data).
- New contract test beside `tests/settle-season-revalidation.test.ts:1073` (or a new
  `tests/deploy-web-unit.test.ts` only if no existing deploy-contract suite fits): the web unit
  must keep `DATABASE_URL`, `AFLDB_AUTH_DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL`; must unset
  every other `*_DATABASE_URL` name that appears in `docs/deployment.md`'s environment table
  (derive the list from the doc, not a hand-typed array, so a future DSN cannot be missed
  again); `prepare-standalone.mjs` must contain the `.env*` assertion.

## 6. Proposed fix, in order

1. Establish the build copy mechanism (§4b) and record it under this issue in `issues.md`.
   (§4 itself is settled: branch (a).)
2. **F-A:** add `AFLDB_CODE_TEST_DATABASE_URL AFLDB_CODE_TEST_IMPORT_DATABASE_URL` to
   `UnsetEnvironment=`. Consider replacing the deny list with a positive statement in the
   comment of the exact three names kept, and let the new test enforce the rest.
3. **F-C (branch (a)):** remove `AFLDB_IMPORT_DATABASE_URL` from `UnsetEnvironment=` — the
   process genuinely needs it, and hiding it in the unit while the bundle supplies it is exactly
   the false comfort this issue exists to remove. Order matters with step 4: once step 4 stops
   the bundle supplying the DSN, step 3 is what keeps the Admin Centre working. Ship them
   together in one unit install + one rebuild, never step 4 alone.
4. **F-B:** stop `.env` reaching `.next/standalone/` (the knob chosen in step 1), add the
   `prepare-standalone.mjs` assertion, and on each host delete the existing
   `.next/standalone/.env` as part of the next deploy (`sync-dev.ps1` rebuilds the directory;
   confirm the rebuilt tree has no `.env*` before restart).
5. Rewrite `deploy/afldb.service:35-44` and `docs/deployment.md` §9 to state the real three-DSN
   set and why (`afldb_import` for audited Admin Centre writes since migration 066).
6. Add the contract test (§5).
7. Install the unit on DEV (`daemon-reload` + restart; sudo needs a password on both hosts,
   see memory), verify §8, then PROD after operator sign-off. DEV before PROD, never both in one
   step.

## 7. Safety constraints

- Names only, never values: every check uses `grep -oE '^[A-Z_]*='`, `grep -c` or
  `sort | uniq`; nothing prints, logs or pastes a DSN, password or token.
- No database change of any kind; this issue touches process environment and build output only.
- Do not remove `ReadWritePaths=/home/arm/projects/afldb/.next` — ISR needs it; the fix is to
  keep secrets out of that tree, not to make the tree read-only.
- Do not touch the settle or email-intake units; their lists were reviewed and are correct for
  their jobs.
- A unit edit that unsets a needed DSN takes the Admin Centre down silently (fail-closed error
  per mutation). Verify §8 step 2 before declaring DEV done.
- PROD: run the §8 names-only checks read-only first; PROD has no `afldb_test`/code-test
  databases (memory), so its `.env` and environment may differ from DEV.

## 8. Focused verification (operator-run, in this order)

1. `npx vitest run <new contract test file>` — passes against the edited unit and wrapper.
2. DEV, after reinstall and restart:
   `tr '\0' '\n' </proc/$(systemctl show afldb -p MainPID --value)/environ | grep -oE '^[A-Z_]*DATABASE_URL' | sort`
   → exactly `AFLDB_AUTH_DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL`, `DATABASE_URL`.
3. DEV: `ls -la ~/projects/afldb/.next/standalone/.env* 2>&1` → "No such file".
4. DEV browser: one data-editor save (or any `afldb_import`-backed mutation) succeeds and writes
   its `data_edits` row; then revert or void it through the same UI.
5. `npm run build` on DEV completes with the new `prepare-standalone.mjs` assertion passing.
6. PROD: steps 2–3 read-only before the unit is changed, and again after.

## 9. Acceptance criteria

- §8 steps 1–5 pass on DEV; steps 2, 3 and 6 pass on PROD.
- `deploy/afldb.service`, `docs/deployment.md` §9 and the contract test agree on the three-DSN
  set.
- No `.env*` under `.next/standalone/` on either host after a fresh build.
- `issues.md` records the §4 outcome, the fix, the validation transcript summaries (names only)
  and the resolution date; `IssuesIndex.md` and the Open Issues table drop the issue;
  `CHANGELOG.md` gains one Unreleased entry (deployment/operations behaviour changed).

## 10. Dependencies and related work

- None open. Related closed: AFLDB-ISSUE-027 (migration 066), AFLDB-ISSUE-107 (exec-time
  environment evidence), AFLDB-ISSUE-122 (settle unit keeps one writing DSN), AFLDB-ISSUE-134
  (`AFLDB_REVALIDATE_*` deliberately survive the settle unit's unset list — leave that alone),
  AFLDB-ISSUE-146 (introduced the code-test DSNs).
- Not part of this issue: the email-intake route still admitting `contributor` senders is
  tracked as AFLDB-ISSUE-186 Phase B (deferred, `issues.md` ISSUE-186 "Deferred").

## 11. Recommended next session

Sonnet 5, medium effort, implementation mode, in a fresh worktree
(`npm run worktree:bootstrap -- --issue 220 --branch sonnet/issue-220-web-unit-credentials`),
carrying this file and the ISSUE-220 entry in `issues.md`. First action: establish the build
copy mechanism (§4b) from the installed Next's build code and docs, and record it, before editing
anything.
