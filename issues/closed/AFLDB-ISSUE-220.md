# AFLDB-ISSUE-220 — Web service credential boundary contradicts the application's `afldb_import` requirement; owner-role code-test DSN and a complete `.env` copy reach the internet-facing process

Status: **Resolved 2026-10-01.** Opened 2026-09-17 (Fable 5.1 code review outside NL search) as a
planning runbook. §1–§11 below are that original plan, kept as history. The final state is §0; the
DEV and PROD acceptance evidence is §0a.

## 0. Current state — final closure (2026-10-01)

**Resolved 2026-10-01.** The credential boundary is implemented, merged and accepted on both DEV and
PROD. Every item that was outstanding below is complete, with operator-run evidence recorded in §0a.
- Implementation: `f5adfe39`, merged to `main` at `46805c05` (2026-09-17).
- Credential-drift repair: `1111ab193882566b7ba7e3fc8d69b2f7c62c6c40`, merged and pushed to `main`.
- `tests/deploy-web-unit.test.ts`: 24/24 PASS.
- DEV and PROD both run `1111ab19` and hold exactly `DATABASE_URL`, `AFLDB_AUTH_DATABASE_URL` and
  `AFLDB_IMPORT_DATABASE_URL`, with no `.env*` anywhere under `.next/standalone`.

The remainder of this section is the history of how the issue reached closure.

**Historical implementation.**
- `f5adfe39` implemented the fix and was merged to `main` at `46805c05` on 2026-09-17.
- It shipped:
  - the three-DSN `UnsetEnvironment=` boundary in `deploy/afldb.service`;
  - post-build `.env*` stripping (`tools/build/env-in-standalone.mjs`, `prepare-standalone.mjs`);
  - the derived contract test `tests/deploy-web-unit.test.ts`;
  - the `docs/deployment.md` §9 corrections.
- Local validation at the time: contract test 15/15, `tsc --noEmit` clean.
- The `afldb-issue-220` worktree it was built in no longer exists. No work was lost.

**Historical partial DEV evidence.** The ISSUE-222 DEV deploy at `19eb40c0` (2026-09-19) observed
the running `MainPID` holding exactly `DATABASE_URL`, `AFLDB_AUTH_DATABASE_URL` and
`AFLDB_IMPORT_DATABASE_URL`. Its limits:
- it is start-environment (`/proc/<pid>/environ`) evidence only;
- it predates the three DSNs below;
- it did not prove `.next/standalone/.env*` absent.

So it is not §8 acceptance.

**Drift found 2026-10-01, restored on `sonnet/issue-220-credential-drift`.**
- `.env.example` gained three operator maintenance DSNs without matching deny-list or §9 entries:
  - `AFLDB_DEV_IMPORT_DATABASE_URL` (ISSUE-224, `64858c52`);
  - `AFLDB_PROD_IMPORT_DATABASE_URL` and `AFLDB_PROD_AUTH_DATABASE_URL` (ISSUE-251, `fb12c2bc`).
- The derived contract test caught it. On `main` `d0423d92` it ran 19 tests with 4 failures: three
  `unsets …` cases and `lists every DSN name .env.example defines`.
- This pass adds the three names to `UnsetEnvironment=` and to §9, and changes no test assertion.
  The contract test is now 24/24.

**Next.js 16.3.1 re-verified (installed source, 2026-10-01).**
- `writeStandaloneDirectory` (`next/dist/build/index.js:325-344`) still copies the loaded `.env` /
  `.env.production` into `.next/standalone/<relative(outputFileTracingRoot, appDir)>/`
  unconditionally for `output: 'standalone'`.
- No `next.config` option suppresses it.
- Post-build removal stays the mitigation.
- New hardening: `findEnvFilesRecursive` scans the whole finished standalone tree. It reads names
  only and never follows a symlink or junction. `prepare-standalone.mjs` refuses to ship if any
  `.env`/`.env.*` survives anywhere. A nested one is reported for inspection, never deleted.
- The workstation `node_modules` holds no `.env*` file, so no legitimate dependency is blocked.

**Acceptance that was outstanding at the time of the drift repair (all complete, see §0a).**
1. DEV rollout (unit install + rebuild + restart) and the §8 checks.
2. One Admin Centre `afldb_import`-backed write and revert on DEV.
3. PROD read-only before-state checks (§8 step 6).
4. PROD unit/build rollout, only after explicit operator authorisation.
5. PROD after-state checks.

## 0a. Final acceptance evidence (operator-run, 2026-10-01)

No application code, migration, deployment file, package file or test changed in this closure.

**DEV (revision `1111ab193882566b7ba7e3fc8d69b2f7c62c6c40`).**
- Next 16.3.1 production build succeeded, 1516 static pages.
- `prepare-standalone` confirmed no `.env*` at the standalone root and none anywhere under
  `.next/standalone`; the recursive standalone env count is 0.
- `afldb.service` active; `/api/health` returned `status=ok`, `database=ok`.
- Live `MainPID` held exactly `AFLDB_AUTH_DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL`, `DATABASE_URL`.
- Repository `deploy/afldb.service` and installed `/etc/systemd/system/afldb.service` were
  byte-identical, SHA256 `a3444840e0bd5f94ea05ea4b01508e0e8209d65ae452be665c1049c6b34e149a`.
- The installed deny list held all 12 non-web DSNs: `AFLDB_OWNER_DATABASE_URL`,
  `AFLDB_TEST_DATABASE_URL`, `AFLDB_TEST_IMPORT_DATABASE_URL`, `AFLDB_TEST_AUTH_DATABASE_URL`,
  `AFLDB_CODE_TEST_DATABASE_URL`, `AFLDB_CODE_TEST_IMPORT_DATABASE_URL`, `AFLDB_DEV_DATABASE_URL`,
  `AFLDB_DEV_IMPORT_DATABASE_URL`, `AFLDB_BACKUP_DATABASE_URL`, `AFLDB_PROD_DATABASE_URL`,
  `AFLDB_PROD_IMPORT_DATABASE_URL`, `AFLDB_PROD_AUTH_DATABASE_URL`.
- Browser acceptance through `/admin/data-editor`: a temporary player Notes edit saved and recorded
  `data_edit.saved`; the exact original Notes were restored and a second `data_edit.saved` audit was
  recorded for the revert. This proves a real `AFLDB_IMPORT_DATABASE_URL`-backed Admin Centre
  mutation works after the boundary change.

**PROD before-state (revision `8fc60404d12c64d410e1f41c68bd8f0c7f5b6154`).**
- Service active; health `status=ok`, `database=ok`.
- The live process held only `AFLDB_AUTH_DATABASE_URL` and `DATABASE_URL`;
  `AFLDB_IMPORT_DATABASE_URL` was absent. Standalone env count was already 0.
- Repository and installed unit hashes differed, and the old installed `UnsetEnvironment=`
  explicitly removed `AFLDB_IMPORT_DATABASE_URL`.
- This established the stale, under-provisioned PROD state before rollout.

**PROD rollout.**
- The checkout fast-forwarded 21 commits to `1111ab193882566b7ba7e3fc8d69b2f7c62c6c40`. The 31
  known nightly settle manifests were temporarily preserved in a stash so deploy preflight could
  require a clean worktree.
- Read-only deploy preflight first correctly blocked on pending migrations 106–109 (status
  105/109). The operator-authorised PROD apply ran `106_afl_api_identity_corrected_action.sql`,
  `107_canonical_applications_delete_audit.sql`, `108_import_reads_data_edits.sql` and
  `109_import_reads_player_match_period_stats.sql`, all ok. `privileges.sql` reconciled as
  `afldb_owner` against `afldb_prod`. Post-apply status 109/109, 0 pending.
- Deploy preflight: READY, 0 blockers, one expected SSH-not-requested warning.
  `AFLDB_IMPORT_DATABASE_URL` independently resolved to database `afldb_prod`, role `afldb_import`.
  Worker settings `AFLDB_WORKERS=2`, `AFLDB_POOL_MAX=10`.
- `npm ci` installed the locked tree and reported 7 dependency vulnerabilities (2 moderate, 4 high,
  1 critical). Observed only: no `npm audit fix` was run, and dependency remediation is outside
  this issue.
- `tests/deploy-web-unit.test.ts` 24/24 PASS.
- The first build exposed an execution-environment evidence gap only: `AFLDB_ENV=production` was in
  `.env` but not exported to the separate `prepare-standalone` wrapper process. No deploy or
  restart occurred from that build. The rebuild with `AFLDB_ENV=production` exported succeeded,
  1516 static pages; `prepare-standalone` reported HSTS and production CSP enabled, no `.env*`
  anywhere under `.next/standalone`, bundle ready. Independent checks: standalone env count 0, and
  `Strict-Transport-Security` present in `.next/routes-manifest.json`.

**PROD after-state.**
- The repository `afldb.service` was installed and `afldb` restarted at revision
  `1111ab193882566b7ba7e3fc8d69b2f7c62c6c40`. Service active; health `status=ok`, `database=ok`.
- Live `MainPID` held exactly `AFLDB_AUTH_DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL`,
  `DATABASE_URL`. Standalone env count 0.
- Repository and installed unit SHA256 both `a3444840e0bd5f94ea05ea4b01508e0e8209d65ae452be665c1049c6b34e149a`;
  the installed deny list held the same 12 non-web DSNs as DEV.
- PROD therefore satisfies the intended exact three-DSN runtime boundary with no credential file in
  the standalone output.

**Post-rollout housekeeping.** `stash@{0}` applied cleanly and restored exactly the original 31
nightly settle manifests as untracked operational artefacts. No tracked PROD checkout change was
present, and the temporary stash was dropped.

**Acceptance criteria (§9).** All met: §8 steps 1–5 on DEV; steps 2, 3 and 6 on PROD; the unit,
`docs/deployment.md` §9 and the contract test agree on the three-DSN set; no `.env*` under
`.next/standalone/` on either host after a fresh build.

---

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
