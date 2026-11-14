# Remediation run 3 — independent closure verification (afldb-closure)

Branch `claude/remediation-20261114`, tip `3465fd9790f34d07222881f8d439611d03e7fd84`; publication candidate `b9a43343`; executable revision Q' = `692b1902cbcc321cea76a30857a03e15f02db6b7`; run-2 Q = `f10e47ad`; origin base `de640826`.
Verified 2026-11-15 (host clock 2026-11-14 UTC) by re-reading from disk in `D:\dev\afldb-rem-20261114` (read-only Git) and a NEW host workspace. Output is a flag, never a fix: nothing in the repository was written. This file is outside the repository for the orchestrator to commit.

Baseline refs used: `f10e47ad` (run-2 Q), `6d5388ea` (run-3 base), `de640826` (origin/main), `692b1902` (Q'), `b9a43343`, `3465fd97`.

## Verdicts

| Item | Verdict |
|---|---|
| 1 Records-only proof | PASS (one wording note, F-001) |
| 2 Packet numbers | PASS (note: the 190-file figure is only reproduced when `issues/` is excluded as the packet says) |
| 3 Claims vs evidence | PASS with LOW flags (F-002, F-003) |
| 4 Ledger consistency | PASS with LOW flags (F-002, F-004) |
| 5 Applied vs intended code | PASS with INFO/LOW flags (F-005, F-006): no weakened/skipped assertion, no frozen pin touched, no undisclosed committed change |
| 6 Independent re-run at Q' (focused) | PASS (typecheck rc 0; all focused runs green; red control reproduced) |
| 7 Host hygiene / DEV unchanged | PASS |

Not performed by me, stated explicitly: the full unit suite, the full 99-file integration run, `npm run build`, lint gate, the shell harnesses, and the manifest verifier at `6575bc95` were NOT re-run by me; those results (qualification-3) are UNVERIFIED by me beyond the recounts of the committed JSON below. No production contact (none authorised). Nothing on `afldb_test`, no sudo, no wsl, no push/commit.

## 1. Records-only proof

- `git log -1 -- . ':(exclude)docs' ':(exclude)issues.md' ':(exclude)IssuesIndex.md' ':(exclude)blockers.md' ':(exclude)CHANGELOG.md'` returns **`bb81cbc9`** (the `database` re-pin), not `692b1902`. `692b1902` changes only `docs/.../run3/qualification-3/{fixtures,qual,setup}.sh` (3 files, +338), i.e. paths under `docs/`. Its claim in the packet, "the last commit that changes code, tests or scripts", is true (the scripts are the qualification scripts); the brief's wording "last commit changing anything outside docs/…" is not literally true of `692b1902`. The substance holds (below). F-001.
- `git diff --name-only 692b1902 HEAD` outside `docs/`, `issues.md`, `IssuesIndex.md`, `blockers.md`, `CHANGELOG.md`: empty. `692b1902..b9a43343` outside docs: only `CHANGELOG.md IssuesIndex.md blockers.md issues.md`. `b9a43343..3465fd97`: exactly 2 files (`HANDOFF.md`, `run3/APPROVAL-PACKET-3.md`, +188/-2).
- `git diff --name-only f10e47ad 692b1902` outside records: **exactly** `tests/integration/{database,settle-afl-api-brownlow,settle-afl-api-issue276,settle-afl-api-state-b,settle-afl-api}.test.ts` (+264/-23, matches the packet).
- `git diff --name-only f10e47ad HEAD -- src tools packages deploy migrations data reference package.json package-lock.json`: empty. `git diff --stat 8db4007d 692b1902 -- tests src tools packages deploy`: empty. `git diff 6d5388ea 692b1902 -- tools/db tools/migration tools/rebuild src/db/migrations data/reference`: empty (so the rebuild at `6d5388ea` carries to Q').
- Run-3 commits touching pre-run-3 evidence (`git diff --name-only 6d5388ea HEAD` outside `run3/`): only `CHANGELOG.md IssuesIndex.md blockers.md issues.md`, the `HANDOFF.md`, and the five test files. No run-1/run-2 evidence file was edited in run 3.

## 2. Packet numbers (APPROVAL-PACKET-3 section A)

- `git rev-list --count de640826..b9a43343` = **129** (matches).
- `git diff --name-only de640826 b9a43343 | wc -l` = **1,632** (matches).
- Excluding `docs/v2/evidence/` AND `issues/`: **190 files, +13,633 / -512** (matches exactly). Excluding `docs/v2/evidence/` only gives 191 files +14,087/-512; the packet's phrase "Excluding docs/v2/evidence/ and issues/" is therefore accurate.
- `git ls-remote origin refs/heads/main` = `de640826d13489c58392563e7ae1ff62403ed293` (unchanged).

## 3. Claims versus evidence

- Recounted from the committed gzipped vitest JSON (host `node`; the workstation has no Node): `integ.json.gz` numFailedTests 42, passed 3,459 (= 3,457 passed + 2 expected-fail), pending 123, total 3,647, 99 files, 11 failed files, 42 assertion failures + 4 file-level failures = 46 ids; `integ-failures.tsv` has 46 lines (4 `<file-level>`). `unit-nofix` 7 failed / 12,282 passed / 31 skipped; `unit-fix` 2 / 12,287 / 31; `unit-allfix` 0 / 12,295 / 25 (216 files). All equal QUALIFICATION-3. `integ-compare.txt`: 6 gone, 46 common, 0 new (52 in run 2): matches.
- `integb/evidence/table-53.md` recounted: class 1 = 14, class 2 = 1 + 1 fixed = 2, class 3 = 27 + 4 corrected = 31, class 5 = 5, class 6 = 1; total 53. Equals `integb/README.md` section 1/7 and QUALIFICATION-3 section 3.
- `rebuild/final-validation.txt`: `PASSED: 91 checks`; matches 17,056, player_match_rows 695,499, draft_picks 6,810, draft_persons 5,057, club_seasons_rows 1,640, coleman_rows 47, Brownlow 1924-2025; `rebuild-trimmed.txt` has 30 `==>` stage banners; README states no id in 6819-6853. Equals the packet.
- SHA256SUMS against committed blobs (`git cat-file blob HEAD:<path> | sha256sum`): stateb 92/92, rebuild 42/42, integb 316/316, integ (`evidence/SHA256SUMS`, paths carry a `./` prefix) 86/86, qualification-3 35/35 plus `SHA256SUMS-late` 2/2: **0 mismatch, 0 missing**.
- The single COMMITTED-MISMATCH in `qualification-3/manifest-verify-9cb06c53.tsv` (summed 754 OK / 1 / 141 / 94 / 1,300 = 2,290 rows): `integ/evidence/brownlow/retained-artefacts.SHA256SUMS` `template-identity.txt` expected `4ec64b7b...ea60` was compared with `integb/evidence/c1/template-identity.txt` (`81a6c2fb...a32`). The real file `integ/evidence/brownlow/template-identity.restored.txt` (and the `integb/.../final*/brownlow` copies) hash to `4ec64b7b...ea60`. **False positive confirmed** as described in RESIDUALS-3 section 2.5.
- DEV state before/after (`DEV-STATE-*-3.txt`) identical for afldb/caddy/postgresql MainPID, InvocationID, NRestarts (also re-read live by me, item 7).

## 4. Ledger consistency (CLAUDE.md section 5)

Read only the stated sections. ISSUE-363 table row (`issues.md:64`), its entry (`issues.md:55109-55143`), ISSUE-365 row (`:66`) and entry (`:55166-`), `IssuesIndex.md` lines 12, 140-147, `blockers.md` header, `CHANGELOG.md` `[Unreleased]` run-3 block:
- 363 is stated **"partially resolved"**, status Open, "Remaining (why this stays open)" listed; never claimed fully fixed. 365 is Open (Medium), not resolved, "Production state not read". Open count **10** (332, 348, 350, 351, 352, 357, 362, 363, 364, 365) is consistent in the Open Issues table (10 rows), `IssuesIndex.md:12` and `blockers.md` header. Executable revision `692b1902`, 42 failed / 3,457 passed, 6 gone / 0 new, 91 checks, 14/2/31/5/1 all agree with the evidence.
- Inconsistency: the stale-witness count is **28** in the table row, the `IssuesIndex.md` current-state line and 363 bullet, the `blockers.md` header and the packet-adjacent integb README section 6 heading, but **27** ("**27 not corrected**: club-comparison 24, release-gates 3") in the same issue entry and in QUALIFICATION-3 and the packet (`27 stale ... (plus 2 surrogate-id lookups)`); the 53-id table has 24 + 3 = 27. F-002.
- The `issues.md` preamble (lines ~40-42, "Remediation run 2026-11-14" and "Full review" paragraphs) has no run-3 current-state paragraph and still lists 363 as "shared-DB fixture leaks"; the counts live in the table and `IssuesIndex.md`, which are correct. F-004.
- `CHANGELOG.md` run-3 block states test-harness changes only, "no application code changed"; consistent with section 1. It does not mention ISSUE-363 as partial (it says "every remaining integration failure was classified"), which is true.

## 5. Applied versus intended (the five test files, f10e47ad..692b1902)

Full diffs read. Findings:
- No assertion weakened or removed; no `skip`/`todo`/`xit`; the 23 deleted lines are: 4 replaced `database` count pins (below), issue276 `'PF'`/`preliminary_final` fixture values, and the old unconditional `recomputeBrownlowCoverage` in the brownlow cleanup (replaced by a captured-rows restore plus crash-repair recompute). New assertions were added (identity-row-unchanged, occurrence-count guards, `restoreSeasonAvailability` read-back).
- No frozen pin edited: no hit for `DRAFTGURU_EXPECTED`, `draftguru-contract`, `AWARDS_HONOURS_EXPECTED`, `EXPECT_STAGE_A`, Coleman contract, ladder tuple; `data/reference/fitzroy-accepted-baselines.json` untouched (and 695,499 is its `player_match_rows`).
- No deletion of a pre-existing row the suite did not create: state-b and `settle-afl-api` now stop deleting the snapshot's `(afl_api, CD_I297354)` row; state-b's new `DELETE FROM external_identities WHERE player_id IN <own synthetic players>` is scoped to its own synthetic player; brownlow deletes only `stat_availability` rows in SEASON that were not captured at start and reinserts captured ones.
- `database.test.ts` re-pins four count witnesses (685,471 to 695,499; 114 to 120; 261 to 268; 219 to 223) under the stale-assertion class, with before/after evidence. They are accepted-baseline-dependent counts, not on the frozen list; the packet reports them in section D but they are not an owner decision in section C. They pass on the snapshot copy too (69/69, item 6), and will go stale again when 2027 completes. F-005 (INFO/LOW).
- `settle-afl-api-issue276` fixtures changed from a Preliminary Final (`PF`, finals) to an ordinary round-6 `home_and_away` row (`round_type`, `is_finals` false) so they cannot collide with the real 2026 PF; as disclosed ("no assertion changed"), but the suite no longer exercises a finals-round fixture row. F-006 (LOW, design note).
- Drift check: every committed change after `6d5388ea` maps to a disclosed scope return (`.phaneslight/returns/rem3-20261114/02-06`): stateb commits `18cbde7b`, `69168858`, `5270f678`; rebuild `a6532ec2`; integ `aae066c4`; integb `a38f98f5`, `6edf4f99`, `532e234d`, `bb81cbc9`, `0c66f3e3`, `ed256295`; qual `9cb06c53`, `6575bc95`, `692b1902`; orchestrator records `38b08a2a`, `b9a43343`, `3465fd97` (docs/ledger only). **No undisclosed committed change found.** Minor: the packet's "Incidents disclosed" list omits two worker disclosures (an untracked `.probe-rebuilt.mjs` copied into the rebuild host checkout and removed; migration 118 applied to the Brownlow clones in addition to 116/117) and does not name the rebuild worker's read of `/home/arm/afldb-v2-brownlowverify-20261028` (a named retained input, read-only, hash-verified). F-007 (INFO).

## 6. Independent re-run at Q' (focused)

Workspace `/mnt/ssd/afldb-rem3-closure-20261114` (new), cluster `/mnt/ssd/afldb-rem3-closure-20261114-pg` port **55678**. Host checkout from a bundle of `6d5388ea..claude/remediation-20261114` (sha256 `1993a9ff92ab0d7fd1665cb3ef0cfe4d76c22671e76c3a056797bba72406cfdc`; base bundle sha256 `0a1b46d1...ccf68` verified), `HEAD=692b1902cbcc321cea76a30857a03e15f02db6b7`, porcelain 0 before and after, no `.env`, `npm ci` (427 packages), package files unchanged since `6d5388ea`. Snapshot dump 30,141,895 bytes, sha256 `e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d` verified; restore as run 2; ledger 118, 17,056 matches. Heavy lock held for typecheck and every vitest run; every DB command through `isolated-pg run <db> --` with explicit PG ROOT/PORT/BIN exports. Node 22.23.2, vitest 4.1.10.

| Run | Result |
|---|---|
| `npm run typecheck` (`next typegen` + `tsc --noEmit`) | rc 0, no `error TS` |
| per-file mode (`AFLDB_TEST_PER_FILE_DB=all`) `settle-afl-api-state-b`, fresh template copy | 1 passed / 0 failed (1 test) |
| per-file mode `settle-afl-api-issue276`, fresh copy | 4 passed / 0 failed |
| per-file mode `database`, fresh copy | **69 passed / 0 failed** (includes the four re-pinned witnesses and the war-years test) |
| SHARED mode, one fresh copy, separate invocations in forced order: `settle-afl-api-brownlow` | 21 passed / 0 failed |
| ... then `database` (same database) | **69 passed / 0 failed** (war years fix confirmed) |
| control: `database` alone, shared, fresh copy | 69 passed / 0 failed |
| red control (my own, scratch file removed, porcelain 0): the PRE-fix `settle-afl-api-brownlow` test from `f10e47ad` (21 passed), then `database` on the same database | **1 failed / 68 passed**: `Brownlow correctness > separates the war years from merely uncollected seasons`: `expected [ 1942, 1943, 1944, 1945, 2026 ] to deeply equal [ 1942, 1943, 1944, 1945 ]` |

The red/green pair confirms both that the war-years contamination is real and that Q' removes it. Raw logs and JSON: `D:\tmp\afldb-rem3-closure\evidence\` (not committed). Not run by me: `settle-afl-api` itself (not requested), the full unit or integration suites, `npm run build` (no build-affecting file changed since Q, `git diff` empty over src/tools/packages/deploy/package files), lint gate.

## 7. Host hygiene and DEV

- Cluster stopped (`isolated-pg stop`: "server stopped"); `postmaster.pid` absent; **no listener on 55671-55678** (also none on 556xx/557xx); `pgrep -u arm -af afldb-rem3` empty, no postgres/vitest/next process under `/mnt/ssd/afldb-rem3-*`; no `postmaster.pid` in any `/mnt/ssd/afldb-rem3-*-pg`. Workspace 1.4 G, cluster root 3.7 G left in place.
- DEV read-only `systemctl show`: afldb MainPID 1732, NRestarts 0, InvocationID `c15b39a7e5554f30a8d1806333c9e880`; postgresql@16-main 1531 / 0 / `f21f38b180c74c3e9baf2a87bad28e21`; caddy 1683 / 0 / `e18d81237bc044ef829f5c17ead441ec`. All identical to `run3/DEV-STATE-AFTER-3.txt` and `-BEFORE-3.txt`. DEV checkout `8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a` unchanged. `:5432` (DEV) untouched; shared `afldb_test` untouched.
- Incident disclosure (mine): my first `focused.sh` run stopped after the typecheck phase because of a script bug (grep exit status, not a test failure; the typecheck itself was rc 0); relaunched with the remaining phases. No command outside authority; no production contact.

## Findings

| Id | Grade | Where | Summary |
|---|---|---|---|
| F-001 | LOW | `APPROVAL-PACKET-3.md:13,27`; brief item 1 | The last commit outside the five record paths is `bb81cbc9`; `692b1902` is a docs-path commit (qualification scripts). The proof that nothing executable changed after Q' holds (`git diff 692b1902 HEAD` over non-record paths is empty), but "last commit changing anything outside docs/…" is not literally `692b1902`. |
| F-002 | LOW | `issues.md:64` row, `IssuesIndex.md:12,145`, `blockers.md:5` say 28; `issues.md` entry ("27 not corrected"), `QUALIFICATION-3.md:58`, `APPROVAL-PACKET-3.md:108` say 27; `integb/README.md:126` heading says 28 | Stale-witness count 28 vs 27 (the 53-id table has 24 + 3 = 27). Wording/consistency only; no evidence changes. |
| F-003 | LOW | `QUALIFICATION-3.md:70-71` vs `qualification-3/manifest-verify-9cb06c53.tsv` | QUALIFICATION-3 quotes 763 / 142 / 1,302 "at 6575bc95"; the only committed verifier output is at `9cb06c53` with 754 / 141 / 1,300 (the scope README and worker return state both). Not reconcilable from committed evidence (the `6575bc95` run has no committed TSV). The 1 mismatch / 94 HOST-MISSING are the same in both. |
| F-004 | LOW | `issues.md:40-42` | The preamble has no run-3 state paragraph (still describes run 2 and 363 as "shared-DB fixture leaks"); table, entries and `IssuesIndex.md` are correct. |
| F-005 | LOW | `tests/integration/database.test.ts:213-222,479-511` | Four accepted-baseline count witnesses re-pinned by a worker under the stale-assertion class (not on the frozen list, evidence recorded, 695,499 equals the register). Pass on snapshot and rebuild (verified 69/69 on a snapshot copy). They are not offered to the owner as a decision in packet section C and will go stale when 2027 completes. |
| F-006 | LOW | `tests/integration/settle-afl-api-issue276.test.ts:1327-1330` | Fixture rows moved from `preliminary_final`/`is_finals` true to `home_and_away` round 6 to avoid the real 2026 PF collision; the suite no longer exercises a finals-round fixture (disclosed as "no assertion changed"; behaviour coverage narrowed, not weakened in any assertion). |
| F-007 | INFO | `APPROVAL-PACKET-3.md:141-144` | Incident list omits the rebuild worker's temporary untracked `.probe-rebuilt.mjs` in the host checkout, integ's migration 118 on the Brownlow clones, and integ's read of `/home/arm/afldb-v2-brownlowverify-20261028` (authorised class, read-only). None outside authority; the list says "none outside authority". |
| F-008 | INFO | `qualification-3/manifest-verify-9cb06c53.tsv` line 1 | The one COMMITTED-MISMATCH is a verifier basename false positive (re-proved by hashing `template-identity.restored.txt` = `4ec64b7b...ea60`). |
| F-009 | INFO | host runs | Red control reproduced the pre-fix war-years failure; Q' green in both per-file and shared-pair mode. |

No CRIT, HIGH or MED findings. ISSUE-363 is correctly not claimed fixed; ISSUE-365 is correctly open; open count 10 everywhere checked.

## edits_made (exhaustive)

Repository: none. Outside the repository only:
- `D:\tmp\afldb-rem3-closure\` (this file, `q.bundle`, `setup.sh`, `setup.src`, `focused.sh`, `red.sh`, `count.js`, `evidence\` logs): scratch on the workstation.
- Host `/mnt/ssd/afldb-rem3-closure-20261114` and `-pg` (new workspace, cluster, `in/`, `evidence/`, a transient untracked `tests/integration/zz-red-brownlow.test.ts` in my own checkout, created and removed; porcelain 0 after).
No `.phaneslight/registry/` regen, `_index.md`, archive digest, handover or `capabilities.failures[]` write (duties 1, 4-7 are not applicable to this task's scope: no UI change; registry/doc-index/archive/handover not requested).
