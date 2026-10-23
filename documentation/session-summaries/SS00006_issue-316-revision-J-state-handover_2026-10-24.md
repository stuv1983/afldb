<!-- DOC: State session summary and successor handover for AFLDB-ISSUE-316 revision J (ISSUE-322/324) -->
<!-- DOC-SCOPE: PhanesLight working memory; AFLDB issues.md / IssuesIndex.md remain authoritative -->

# SS00006 — AFLDB-ISSUE-316 revision J: implementation committed, state handover (2026-10-24)

Orchestrator run `i316J-20261024`, reached its context ceiling after the implementation step. Returns (verbatim):
`.phaneslight/returns/i316J-20261024/` — J-01 plan review, J-02 owner rulings (binding, verbatim), J-03 ISSUE-322
worker, J-04 ISSUE-324 worker. Production NO-GO; no apply, push, deploy or activation took place.

## Done
- Plan review: GO-WITH-CHANGES, one HIGH (F-001, receipts would have left the F0 freeze set) returned to the owner;
  owner ruled (J-02): corrected ISSUE-322 design, STRICT realpath for ISSUE-324, code_test_db refusal accepted,
  ISSUE-322 integration proof authorised on a separate disposable cluster, keep `--rollover-date 2026-10-24`.
- Commits on `v2/rebuild` (parent `2f9b29f1`):
  - `82603dc7034f0167d7c1023c61d3813e929028cf` ISSUE-324: `tools/db/rebuild-test.ts` +267/−4,
    `tests/db-test-rebuild.test.ts` +395.
  - `db541ae348d613df1b277215e1ff4ad0c374afe0` ISSUE-322: `tools/db/promotion-inventory.ts` +195/−8,
    `tests/db-promotion-check.test.ts` +250, `docs/v2/db-ownership-matrix.md` +1.
- Focused verification at `db541ae3` (orchestrator-run): `tests/db-test-rebuild.test.ts` +
  `tests/db-promotion-check.test.ts`: 1,561 passed, 3 skipped (pre-existing skips), 0 failed. Worker-run: tsc exit 0;
  eslint no findings on changed lines; 5 sibling promotion suites 697/697.
- Static code_test_db reliance check (J-04): no dry-run, rebuild (`--target isolated`), successor-validation,
  promotion/apply or deploy path uses the ordinary CLI `--target code_test_db`. Stale docs: `docs/deployment.md`
  lines ~245–335 still advertise it (LOW; update in the tracking commit).

## Uncommitted in the working tree (deliberately)
- `tests/integration/db-promotion-receipts.test.ts` (new, created via new-file). **Orchestrator finding MED (handled,
  not deferred to reviewer): its design must be revised before commit.** It parks the real migration-116 table and
  tests a `LIKE … INCLUDING ALL` clone with a trigger re-created from `pg_get_triggerdef`, and it does not execute the
  rollback renames. Required revision (the owner's "rollback leaves receipts unchanged" must be real):
  - use several real migrated databases created by `tools/v2/isolated-pg.ts create-db` (e.g. a migrated base, then
    `--template` copies): a non-empty candidate (refusal), a "production" holding synthetic receipts (full
    `pg_dump --format=custom`), an empty candidate (truncateSql passes; the exact `reinstatePlan` pg_restore line;
    digests equal; mutations refused; `tgenabled='O'`; replication role `origin`);
  - rollback: execute `swapSql` then `rollbackSql` with only the three database names mapped to `afldb_v2_*_test`
    names (assert the mapped text differs from the generated text only in those identifiers), and assert receipt
    digests unchanged in every database afterwards. The rename needs CREATEDB or superuser: the isolated roles are
    NOCREATEDB, so either run the rename pair from a harness script as the isolated superuser
    (`cluster/secrets/superuser.pw`, never in argv/logs) or grant CREATEDB to `afldb_owner` in that disposable
    cluster only, recorded as a deviation;
  - no table may be dropped, re-created or moved.

## Outstanding (by brief step id; the brief and J-02 are the contract)
1. Revise and commit the integration test (above). Run it on streamanator in a NEW root `/mnt/ssd/afldb-i316-J-int-<UTC>`
   with its own isolated cluster/port/credentials (files 600), J commit from a bundle, node_modules symlink is fine
   there (not the enforced path). Stop only that cluster. ISSUE-322 closes only if it passes.
2. Post-transition branch `i316/J-post-transition-on-db541ae3`: simulated commit 1 (J finals), commit 2′ (cherry-pick of
   `6d9b60a2`'s 16 files; expect overlap in `tests/db-test-rebuild.test.ts` and `tests/db-promotion-check.test.ts`).
   Harness to copy: `D:/tmp/afldb-i316-I-20261023T0820Z/scripts/` (i-prepare-local-root.sh, run-local-dryrun.sh,
   i-make-pinned.py, full-suites.sh, dbfree-totals.py, compare-suites.py, lint-changed-lines.py, proposed-state.ts) and
   `stage/` (BASE.sha256 → only `tools/db/rebuild-test.ts` changes; census JSONs, drafts-files.tar, FILE_ORIGINS.json).
   Reviewer F-008: only rebuild-test.ts base/final pins change; promotion files are unpinned. Argv keeps
   `--rollover-date 2026-10-24` (owner ruling 4: the date-bearing blobs `fitzroy-accepted-baselines.json`
   accepted_on/validated_on, `afltables-network.json`, `fitzroy-contract.json` must be regenerated for any other
   apply date).
3. Full DB-free suites both trees, tsc, changed-line ESLint; coach raw bundle copy `24685690…` into fresh worktrees;
   DraftGuru 11a/11c flake shown by rerun. Then pin J.
4. Package `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-J-<UTC>/` (small; C: ~3 GB free), scratch on D:.
5. Streamanator enforced dry run (I's `stage/i-drive.sh` pattern; symlinked node_modules is fine for the planner).
   Census age: reviewer F-007 — no age gate in code; record the 2026-10-23T03:28Z captures as outside 6 h and no
   freshness evidence.
6. Rebuild layout — **OPEN QUESTION, must go to the owner before launch (does not consume the attempt).** Probe
   (2026-10-23T21:06Z, read-only): the native policy (`30199b6a…`, 250 objects) binds exactly two node_modules
   objects, both by canonical path in the shared clean install:
   `…/CLEANINSTALL-20261022T195338Z/repolock-scripts-reviewed/node_modules/tsx/node_modules/@esbuild/linux-x64/bin/esbuild`
   and `…/tsx/node_modules/esbuild/bin/esbuild`. Clean install: tsx 4.23.12, bin `dist/cli.mjs`, 699 MB, 22,410 files,
   34 relative `.bin` symlinks. A checkout-local per-file-verified copy satisfies the strict-realpath rule for the tsx
   code (the code check walks `tsx/dist` only), but esbuild exec'd from the copy's path is unbound → EACCES. Without a
   policy change (forbidden) the only workable layouts execute the native esbuild binary from its bound shared-install
   path: (a) the two ELF files in the copy as symlinks to the bound paths, or (b) `ESBUILD_BINARY_PATH` set by the
   harness to the bound path. Both leave the executed native object digest- and path-equal to the policy binding; both
   execute a native binary that lives in the shared DEV install. The owner must rule before the single rebuild runs.
   Also: F-010 tsx version check (done: 4.23.12 = lock), the in-root enforced `ordinarySpawn` probe as a bootstrap
   control, npx/npm shims removed from PATH (keep `ss`).
7. Tracking commit: issues.md 316/322/323/324, IssuesIndex.md, CHANGELOG.md (ISSUE-324 code_test_db behaviour change;
   ISSUE-322 policy), docs/deployment.md stale code_test_db lines.

## Open items
- MED (orchestrator, handled): integration-test redesign above.
- LOW: docs/deployment.md stale; the ISSUE-322 worker's stale test title "old 41-table freeze record" (now 42).
- §9 disclosure: the ISSUE-324 worker ran one unauthorised read-only `ls`; no other unauthorised command.
- Resumption point: step 1 (integration-test revision), working tree at `db541ae3` + the untracked test file.
