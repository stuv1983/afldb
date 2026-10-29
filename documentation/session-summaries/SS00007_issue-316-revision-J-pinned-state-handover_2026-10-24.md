<!-- DOC: State session summary and successor handover for AFLDB-ISSUE-316 revision J after the J pin (steps 1-4 done) -->
<!-- DOC-SCOPE: PhanesLight working memory; AFLDB issues.md / IssuesIndex.md remain authoritative -->

# SS00007 — AFLDB-ISSUE-316 revision J: esbuild exception, ISSUE-322 integration proof, J pinned; handover (2026-10-24)

Successor orchestrator of run `i316J-20261024` (predecessor: SS00006). Reached its context ceiling after step 4.
Returns (verbatim): `.phaneslight/returns/i316J-20261024/` — J-05 owner rulings set 2, J-06 reviewer delta review
(GO-WITH-CHANGES, no CRIT/HIGH). Scratch root: `D:/tmp/afldb-i316-J-20261023T2154Z/` (UTC stamp; local date 24th).
Production NO-GO; no apply, push, deploy, activation, census or populated-database contact took place.

## Done (verify on disk)
- **Step 1.** J-05 persisted; reviewer delta J-06: Q1 = `.bin` links admitted only when their real file is inside
  the checkout's node_modules (main-session "no links" note NOT adopted: it would break the normal afldb_test
  rebuild, F-102); Q2 = permissive (regular file OR exact symlink, F-103); Q3 = refuse ESBUILD_BINARY_PATH,
  NODE_OPTIONS, NODE_PATH, TSX_TSCONFIG_PATH (F-101); Q4 = dry run MUST use the rebuild's checkout-local layout;
  Q5 = provisioning superuser use (init/start/roles/create-db incl. CREATE EXTENSION bootstrap) disclosed separately
  from the two rename executions; Q6 = skip-unless-targeted, evidence must show `7 passed, 0 skipped`.
- **Step 2.** `14abea5eab52800ff7cdc50d4ec64e8556709ce9` (parent `db541ae3`): `tools/db/rebuild-test.ts` +94/−4 and
  `tests/db-test-rebuild.test.ts` +218/−7. Test file net over the three test commits: +315. Constants `ORDINARY_ESBUILD_LINKS` (2 lexical paths →
  absolute targets in `/home/arm/afldb-c2-CLEANINSTALL-20261022T195338Z/repolock-scripts-reviewed/…`),
  `ORDINARY_ESBUILD_SHA256 = e1698a3d…4100` (= policy `30199b6a…` lines 21-22, read-only probe 2026-10-23T21:5xZ),
  `ORDINARY_FORBIDDEN_ENV`, `assertOrdinaryEnvironment`; whole-node_modules walk in `verifyOrdinaryTsxEntry`.
  25 new tests; ISSUE-324 block 102 passed; focused files 1,586 passed / 3 skipped; tsc 0; changed-line ESLint 0.
  Linux (integration root, real npm tree with 34 `.bin` links): `tests/db-test-rebuild.test.ts` 1,109/1,109.
- **Step 3.** Test commits `4fcc95ef…` (rewrite), `60eb5e0c…` (exact trigger def), `dfbfc1ab1640cc2aacb9900758a5af5e202fc824`
  (marker single-encoded) — FINAL IMPLEMENTATION SHA. Disposable cluster `/mnt/ssd/afldb-i316-J-int-20261023T2154Z`,
  127.0.0.1:55811, system id 7699985767742577722, stage `/home/arm/afldb-i316-J-int-stage-20261023T2154Z`.
  Databases `afldb_v2_i322_{base,nonempty,live,cand}_test` (+ `_pre_test` only by rename). Run 1 refused in
  beforeAll (read-only; stale trigger pattern); run 2: 5 passed, 2 failed on a double-encoded marker only (digests and
  OIDs passed) — the three used copies were dropped with `isolated-pg drop-db` and re-created from the untouched base;
  run 3: **7 passed, 0 skipped, exit 0**. Superuser used for exactly two psql files: swap (terminate + live→pre,
  cand→live) and rollback (terminate + live→cand, pre→live). Final digests: base 0:d41d8cd9…, nonempty
  1:8a85a33c…, live 3:d71a36f5f13411bd0ddc4a9abca6562e, cand 3:d71a36f5…; trigger 'O' everywhere; all afldb_* roles
  NOSUPERUSER/NOCREATEDB. Stopped: shut down, port free, no process references the root, 0 password occurrences,
  `j-int-evidence.tar` `6cc3246f36832fdfb6d7613dfe7ff7c867c0cb29df41d32f8dc6bf6943a1f0bf` (copy in `int/`).
- **Step 4.** J base pin `tools/db/rebuild-test.ts` `960648405df73a119cbb590e37556debd6d51df3f22f46b6460d5645ca0215de`.
  J-unpinned = I-unpinned `5a410a82…` (byte-equal). **J-pinned `5c0763fa49f0731889fcd6d2e22f07a11d238eeca482df6a0d95f5aefddf6104`**;
  only `tools/db/rebuild-test.ts` final changes: `bd8f6b0c…` → `55edeab01164a7c5675bf5086aa9bc3cf800eb6913e4c7eedeaceb8542597b6f`.
  Local Windows dry runs: unpinned exit 0, 3/3, root unchanged; pinned: "pins match this plan for every file",
  1622→1640, renumbered 4, 91 checks, 0 REFUSED, root unchanged. Branch `i316/J-post-transition-on-dfbfc1ab`:
  commit 1 `31f0ab326d07b50e26e0b6915e7846d02c691a1a` (10 finals verified, `runs/j.commit1-final.sha256`), commit 2′
  `72e37fa7e58f61f964a9b16b6ed59d54386986a6` (16 files; 14 byte-equal to I; `runs/COMMIT2-prime.sha256`).
  Full DB-free suites (worktrees `pred` = dfbfc1ab, `tree` = 72e37fa7; coach bundle `24685690…` and 511 gitignored
  DraftGuru/fitzRoy inputs copied hash-verified, `runs/ignored-inputs.sha256` `5c889178…`): first pass 7 failures in
  each tree, all ENOENT on the not-yet-copied ignored inputs; after the copy the affected files reran green.
  **Effective: predecessor 11,266 passed / 0 failed / 26 skipped; successor 11,315 / 0 / 26** (skip set = I's 26).
  tsc 0 both trees. ESLint changed lines: db541ae3..dfbfc1ab 0; dfbfc1ab..72e37fa7 31 no-explicit-any, equal to I's 31.

## Outstanding (brief step ids)
5. Package `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-J-<UTC>/` (PROPOSAL_J.md, pins/, HASHES.sha256, bundle hash; bulk on D:).
   Pinned bundle of `dfbfc1ab`, post-transition bundle of `72e37fa7`. Stage files: `D:/tmp/afldb-i316-J-20261023T2154Z/stage/`.
6. Enforced dry run on streamanator from a fresh mode-700 checkout, **with the checkout-local node_modules layout**
   (J-06 Q4): copy the clean install omitting `.bin`, recreate only the two esbuild entries as absolute symlinks, per-file
   sha256 equal to the clean install, `find -type l` = exactly the two; re-check realpath + sha256 of both targets and
   policy sha256 immediately before. I's `stage/i-drive.sh`/`i-prepare-linux.sh` pattern, auditor `32d5f6fe…`, policy
   `30199b6a…`, record `685a281c…`. Census note: 2026-10-23T03:28Z captures are outside 6 h; no freshness evidence.
7. One disposable rebuild only if 6 passes (brief conditions unchanged). The F-102 acceptance (`--plan` on an npm tree)
   is covered by the Linux unit run above; the J copy itself carries no `.bin`.
8. Tracking commit (issues.md 316/322/323/324, IssuesIndex.md, CHANGELOG.md incl. the new env refusals and the
   esbuild exception, docs/deployment.md stale code_test_db lines, SS index via `doc-index`). ISSUE-322 MAY now be
   resolved (the complete real swap and rollback integration test passed). ISSUE-323/324 only if step 7 passes execution.

## Deviations / disclosures
- Main-session notes "each is a symlink" and "no other links" not adopted, per reviewer rulings Q1/Q2 (normal
  afldb_test rebuild and Windows must keep working); the J copy still has exactly two links.
- Superuser provisioning (isolated-pg init/roles/create-db ×4 + 3 re-creates, drop-db ×3) recorded separately from the
  two rename executions. Read-only probe `/home/arm/j-esbuild-probe-20261024.sh` left on streamanator (disclosed).
- Harness slips (no database contact): two local prepare attempts refused/aborted (relative stage path; package
  `source/` subdir), retained as `local/NOT-USED-*` and `runs/NOT-USED-*`.

## Open items
- LOW: docs/deployment.md stale; stale test title "old 41-table freeze record". No MED+ open.
- Resumption point: step 5 (package build), working tree `v2/rebuild` at `dfbfc1ab` (untracked: `.codex/`, SS00006, SS00007).
