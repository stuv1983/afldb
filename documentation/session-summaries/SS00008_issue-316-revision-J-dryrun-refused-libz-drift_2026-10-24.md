<!-- DOC: Step session summary for AFLDB-ISSUE-316 revision J steps 5-8: package, enforced dry run refused on libz drift, rebuild not run, tracking commit -->
<!-- DOC-SCOPE: PhanesLight working memory; AFLDB issues.md / IssuesIndex.md remain authoritative -->

# SS00008 — AFLDB-ISSUE-316 revision J: package built, enforced dry run REFUSED on native-closure drift (libz), rebuild not run (2026-10-24)

Third orchestrator of run `i316J-20261024` (predecessors: SS00006, SS00007). No subagents spawned. Returns:
`.phaneslight/returns/i316J-20261024/` (J-07 = owner rulings set 3, persisted verbatim before any action).
Production NO-GO; no apply, push, deploy, activation, census or populated-database contact took place.

## Done
- **Step 5 (package).** `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-J-20261023T2234Z/` (`PROPOSAL_J.md`, `pins/`, `validation/`,
  `dryrun-streamanator/`, `scripts/`, `HASHES.sha256`). Bundles on D: (`D:/tmp/afldb-i316-J-20261023T2154Z/bundle/`):
  `pinned.bundle` (ref `v2/rebuild` at `dfbfc1ab`) `582b579b…9f71`; `post-transition.bundle` (`72e37fa7`) `b03d5fb8…0569`.
  Packages I (71/71), H (29/29), G (55/55) and the credential-incident record (22/22) verified byte-unchanged.
- **Set 3 `.bin` question.** The J layout omits every `.bin` directory (8), so the J copies carry no `.bin` link and no
  `.bin` target exists; all 22,408 regular files are sha256-equal to the clean install, whose `package-lock.json`
  (`984b4422…`) and `package.json` are byte-equal to the checkout's; 427 package directories at the locked version.
  Code (`tools/db/rebuild-test.ts:1650-1655`) checks a `.bin` link's FINAL real path only (finding F-J01 below).
- **Step 6 (enforced dry run): FAILED.** Fresh checkout `/home/arm/afldb-i316-apply-dfbfc1ab1640-20261023T2240Z`, stage
  `/home/arm/afldb-i316-J-stage-20261023T2237Z`. Layout and esbuild real-path/hash/policy re-check PASSED before and
  after; node control mapped, wrong pin 127; venv-python control refused 127 on libz; planner REFUSED at gate 1
  (exit 2, 1 REFUSED line, `libz.so.1.3` bytes differ from the bound sha256); root/git status/HEAD unchanged.
  Read-only drift scan: 1/250 objects drifted (libz bound `86200da3…`, now `f61677c7…`), from `apt-get -y
  dist-upgrade` at 2026-10-23T16:16:54Z (zlib1g 1:1.3.dfsg-3.1ubuntu2.2 → 2.3). Evidence `dryrun-results-J.tar`
  `6a96de11…e420`, 0 password-bearing DSNs.
- **Step 7: NOT run** (contract: only if step 6 passes). The single rebuild attempt is not consumed.
- **Step 8.** Tracking edits: `issues.md` (322 resolved; 316/323/324 states; Open Issues table and count),
  `IssuesIndex.md`, `CHANGELOG.md`, `docs/deployment.md` §6a (ordinary-CLI `code_test_db` refusal, layout and env
  refusals), this summary, `doc-index`. Stale test title deferred: `tests/db-promotion-check.test.ts` is in COMMIT2-prime.

## Findings
- **F-J02 HIGH (deferred to the owner):** native-closure drift on streamanator (`libz.so.1.3`) blocks every enforced
  run. Not dispatched to the reviewer: every remedy (re-derive/review a policy or record, downgrade or hold packages)
  is outside the authorisation (J-05; brief NOT-AUTHORISED list).
- **F-J01 MED (handled: recorded, no code change authorised):** `verifyOrdinaryTsxEntry` admits a `.bin` link by its
  final real path; an intermediate hop outside the checkout is not inspected (owner set 3: "no link in that chain may
  escape"). Not reachable in J copies (0 `.bin` links, harness asserts exactly two links); the ordinary path never
  executes `.bin` entries.
- **F-J03 LOW:** the J/I drive scripts do not gate the dry run on the enforcement-control result; the python control
  failure preceded the run. Fix in the next harness.
- **LOW:** stale test title "an old 41-table freeze record" (pinned file; deferred).

## Resumption point
Owner decision on F-J02. Then rerun step 6 from the same stage (the scripts and bundle are unchanged) and, only if it
passes, step 7 under the I rbstage pattern with the J layout (`j-layout-node-modules.py`, `j-layout-recheck.sh`).
