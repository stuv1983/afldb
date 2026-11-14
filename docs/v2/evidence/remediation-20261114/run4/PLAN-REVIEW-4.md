# Remediation run 4 — plan review (afldb-reviewer, Duty A)

**Verdict: PROCEED WITH MITIGATIONS.** 0 CRIT, 0 HIGH, 15 MED, 6 LOW, 4 INFO.
The MED mitigations are binding and must be folded into `RUN-PLAN-4.md`, `AGENT-BRIEF-COMMON-4.md` and the scope briefs **before** any
worker is spawned (see F-010 for the re-cut of base B4). F-001 is the one that would become HIGH if a worker ran on the brief as written.

Reviewed: `RUN-PLAN-4.md` and `AGENT-BRIEF-COMMON-4.md` at the worktree `D:\dev\afldb-rem-20261114`, against code and run-3 records read
from disk. I ran no command and wrote only this file. Paths are relative to the worktree root unless absolute.

Not verified (stated, not guessed): host state beyond `run4/DEV-STATE-BEFORE-4.txt` and `run4/RB1-PATHS.txt`; whether the pristine bases
hold 2026 `brownlow_round_votes` rows; the import closure of the TypeScript rebuild stages; exact `git push` behaviour for an unpeeled
annotated tag (F-008 gives a local rehearsal instead of a guess).

## 1. Findings

| Id | Grade | Where | Summary |
|---|---|---|---|
| F-001 | MED | `AGENT-BRIEF-COMMON-4.md:69`; `RUN-PLAN-4.md:37`; `data/reference/coleman-derivation.json:45,52`; `tools/migration/import_awards.py:1819,1887-1891` | 363-C as worded licenses editing the Coleman contract `expected_rows` 46 -> 47. That value is the measured legacy-transition size (1980-2025) and the guard of the production `--rekey-coleman`; it is not a test pin. |
| F-002 | MED | `src/db/queries/player-derived.ts:735-761`; `src/db/queries/admin-brownlow.ts:265-269,723,1317`; `data/reference/stat-availability.json:18,22,26,28,32,34`; `packages/domain/src/coverage-registry.ts:228-247,270` | D-365-1: no explicit no-medal declaration exists in `src/` or in the schema. The only one is the reference JSON. The plan does not say what the rule may read, and all three grains carry the same inference. |
| F-003 | MED | `tools/db/afl-api-identity-correction-rehearsal.ts:1540-1544,1643,3108`; `tools/migration/correct_afl_api_identity.ts:2775-2781`; `RUN-PLAN-4.md:34,41` | D-365-1 consumers the plan never names: the rehearsal tool pins the old rule and no suite runs it; the identity-correction CLI and the two Brownlow clone suites call the changed function and are first exercised in step 8. |
| F-004 | MED | `RUN-PLAN-4.md:34` | D-365-1 has no stated acceptance check beyond "regressions for both cases". |
| F-005 | MED | `src/db/queries/admin-brownlow.ts:723`; `src/lib/acquisition/afl-api-brownlow.ts:1721-1722`; `src/db/queries/brownlow-readiness.ts:18-28`; `RUN-PLAN-4.md:43` | The code change does not repair a season a previous recompute already wrote `not_applicable`; the admin path stays locked. The packet must say so and carry the conditional production step. |
| F-006 | MED | `src/lib/format.ts:42,56`; `src/app/players/[slug]/page.tsx:612`; `tests/e2e/journeys.spec.ts:134` | A completed season held at `pending` renders "The season is still in progress; the Brownlow Medal has not been awarded." Not addressed by the plan either way. |
| F-007 | MED | `run2/evidence/verify-manifests.sh:62-67,74,77,91-94,49,159`; `run3/qualification-3/manifest-verify-9cb06c53.tsv:1`; `RUN-PLAN-4.md:39` | The checker has a second, more dangerous half of the same defect (a real mismatch masked by a like-named file), 1,159 manifest rows are UNRESOLVED for want of a host rule, and item 1 has no pass criterion. |
| F-008 | MED | `RUN-PLAN-4.md:54-67,45-46` | Final-candidate mechanism is sound in outline but leaves four holes: Q″ defined by path while executable evidence lives under a record path; no failure path for phase B; nothing forbids an uncommitted or post-C tracked write; the packet's push command does not resolve through the ref. |
| F-009 | MED | `RUN-PLAN-4.md:41-42`; `run3/QUALIFICATION-3.md:28,79-80` | The ledger's "gone/new/continuing vs run 3" is defined for one of four cells only. Run 3 has no full rebuild run and no shared-mode run at Q′. |
| F-010 | MED | `RUN-PLAN-4.md:48-50`; `AGENT-BRIEF-COMMON-4.md:4,24`; `tests/integration/leaked-fixtures.ts:19-26,42-49` | Parallel scopes will collide: unallocated fixture seasons and provider ids, shared files, and a base B4 cut before this review's mitigations exist in the brief. |
| F-011 | MED | `RUN-PLAN-4.md:69-75,41` | Rebuild rule has no mechanical test, will almost certainly fire, and the plan does not say which rebuild the integration then runs on. No reuse table for "reuse unchanged evidence". |
| F-012 | MED | `tests/integration/release-gates.test.ts:1072-1153`; `run3/integb/README.md:141-142,190-192` | 363-G: the snapshot base has no in-progress season at all, so "re-point to the in-progress season" passes vacuously there. The 261-player gate pins surrogate-id fingerprints. |
| F-013 | MED | `RUN-PLAN-4.md:36`; `tests/integration/database.test.ts:213-222,479-511` | Item 4 has no red: all four witnesses pass on both bases today. Without a staleness probe the step is reported complete on a feeling. |
| F-014 | MED | `RUN-PLAN-4.md:25-27,43`; `run4/RB1-PATHS.txt` | RB-1 "record the dependency prominently" is owned by no step, and the natural homes are outside the record paths (so must land by Q″) or owner-only. |
| F-015 | MED | `AGENT-BRIEF-COMMON-4.md:29`; `tests/integration/v2-brownlow-eligibility-2025-rehearsal.test.ts:23`; `tests/integration/v2-brownlow-production-correction.test.ts:23` | The brief's database naming rule forbids the exact names the two Brownlow clone suites pin. |
| F-016 | LOW | `RUN-PLAN-4.md:41-42` | Steps 8 and 9 share port 55687; 55686 is unused. |
| F-017 | LOW | `AGENT-BRIEF-COMMON-4.md:13` | Lint hard stop does not name `lint:gate --update`, which can move debt between pairs (run-2 REVIEW-C LOW-8). |
| F-018 | LOW | `RUN-PLAN-4.md:34` | "Remaining Brownlow suites using `CD_I297354`" must be enumerated by fixture import, not by a literal grep (the id reaches `-backtest` and `-reschedule` through the shared fixture files). |
| F-019 | LOW | `AGENT-BRIEF-COMMON-4.md:15`; `RUN-PLAN-4.md:38,41` | "Shared mode" (one isolated database, the vitest default) and "the shared `afldb_test`" (port 5432, forbidden) are different things with the same adjective. |
| F-020 | LOW | `RUN-PLAN-4.md:44` | Item 8 "review the full combined delta": closure phase A should carry the brief §3 test-design rules as an explicit checklist over `B4..Q″`. |
| F-021 | LOW | `RUN-PLAN-4.md:35` | The three release-gates re-pins the owner approved (268, attendance, ladder ranges to 2026) remain baseline-pinned and will need the next accepted baseline; say so in `RESIDUALS-4`. |
| F-022 | INFO | `RUN-PLAN-4.md:21-23`; `run3/CLOSURE-3.md:95`; `run3/RESIDUALS-3.md:55-56` | Item 4 interpretation is defensible: both run-3 records say "four" and "stale when 2027 completes" of exactly these witnesses. State it in the packet. |
| F-023 | INFO | `RUN-PLAN-4.md:38`; `vitest.config.mts:24`; `tests/setup.ts:56-62` | T363-2/T363-3 are in scope: shared mode is the default, documented mode, and both are demonstrated defects under items 5 and 6. Test-only; stop if a fix needs `src/`. |
| F-024 | INFO | `run4/DEV-STATE-BEFORE-4.txt:10`; `vitest.config.mts:24` | Host capacity is adequate: 440 G free, file parallelism off, heavy phases serialised by the lock. |
| F-025 | INFO | `RUN-PLAN-4.md:8-19,29-46` | Every decision and item 1-8 maps to a step. No scope creep found apart from the open choices in F-006. |

## 2. MED findings and mitigations

### F-001 — 363-C must not edit the Coleman contract

Evidence. `data/reference/coleman-derivation.json:43-53` is the one-time legacy transition: "46 legacy winner rows, exactly one per season
from 1980 to 2025" (`:8`, `:49`), `first_load_expectation` "46 updated, 0 inserted, 0 deleted" (`:52`). `import_awards.py:1819` reads
`expected_rows` and `:1887-1891` refuses the rekey on any other legacy count. The standard rebuild does not run `--rekey-coleman`
(no reference in `tools/db/rebuild-test.ts`), so nothing in qualification would catch a wrong value.
The test conflates two quantities: `tests/integration/awards-reload-links.test.ts:5153-5160` and `:5533` require the database's whole
Coleman family (47 since 2026 completed) to equal the legacy-transition size, and `:5380`, `:5700`, `:5759` use the same number as the
reload's updated-row count. Its own error text invites the wrong fix: "reconcile data/reference/coleman-derivation.json".

Failure scenario. The `coleman276` worker, told that "363-C unfreezes the Coleman contract's row expectation", sets `expected_rows` to 47
(and `tests/coleman-derivation.test.ts:400`). The suite passes. The candidate then ships a rekey guard that refuses the only legacy state
that ever existed (46 rows), contradicts the contract's own basis text, and goes stale again when 2027 completes.

Mitigation (fold into brief §3 and the `coleman276` scope brief).
1. Replace the unfreeze sentence with: "363-C unfreezes the **test's** family-size precondition and row-count expectations in
   `awards-reload-links.test.ts` only. `data/reference/coleman-derivation.json` and `tests/coleman-derivation.test.ts:400` stay frozen.
   If you conclude the contract itself must change, stop and report options; do not edit it."
2. Separate the two quantities in the test: (a) legacy-transition size = the contract's 46 with an explicit scope of seasons
   `first_season`..2025, the legacy state manufactured for that scope only (later derived rows captured, removed for the transition block
   and restored by id, in the per-file database); (b) current family size = an independent raw-SQL oracle written in the test from the
   contract's stated `derivation_method` (home-and-away goals maxima per completed season >= 1980, ties included), never the loader's own
   output.
3. Acceptance: red at B4 with the exact file-level refusal text on both bases; green on both bases per-file and shared; `git diff B4 --
   data/reference/coleman-derivation.json tests/coleman-derivation.test.ts` empty; a mutation proof that a 2026 row left in the legacy
   scope makes the rekey refuse.

### F-002 — D-365-1: what counts as the explicit declaration

What exists today.
- `data/reference/stat-availability.json` `coverage_ranges`: `brownlow_season_total` `not_applicable` 1897-1923 (`:32`) and 1942-1945
  (`:34`), the same for match votes (`:18`, `:22`) and round votes (`:26`, `:28`); 2026 `pending` at all three grains (`:25`, `:31`,
  `:36`). The standard rebuild loads this file (`tools/db/rebuild-test.ts:1991` -> `tools/migration/load_reference_data.py`). It is the
  only committed, explicit, hashable declaration.
- `packages/domain/src/coverage-registry.ts:228-247` restates it in prose (`status: 'unsupported'`, "no medal was awarded").
  **Trap:** `:270` gives 2027 the same `unsupported` status for a different reason. `unsupported` is not a no-medal declaration.
- Nothing in `src/` or the schema. `admin-brownlow.ts:265-269` says so deliberately: the derived `stat_availability` row *is* the
  authority that `lockMatch` (`:723`), publication (`:1317`) and `brownlowStatusSql` (`brownlow-readiness.ts:20-22`) read.
- The inference "no rows, not in progress => no medal" is in three places: `player-derived.ts:735-740` (season total), `:742-751`
  (round), `:752-761` (match); and in two siblings: migration 016 (`:60-75`, applied, never edited) and
  `tools/migration/import_legacy_afl.py:845-857` (not on the standard rebuild path).

Failure scenarios if left open. (a) The worker keeps `not_applicable` "when the existing row already says so": a database where a settle
has already recomputed 2026 stays wrong forever, which is the exact state ISSUE-365 describes. (b) The worker derives the list from the
registry's `unsupported` rows: 2027 becomes a declared no-medal season. (c) Only the season-total branch is changed: a recompute still
writes `not_applicable` at the round and match grains for a completed season, so missing data still implies no medal.

Mitigation (fold into the `brownlow` scope brief).
1. One explicit declaration in code: a named constant of declared no-medal season ranges, exactly 1897-1923 and 1942-1945, with a
   provenance comment naming the reference JSON lines. Passed to SQL as bound parameters.
2. `recomputeBrownlowCoverage` uses it for the final `ELSE` of **all three grains**: declared -> `not_applicable`, otherwise `pending`.
   State the full precedence in the comment (loaded medal, in progress, workflow decisions, declared, else pending) and replace the
   comments at `:659-668` and `:722-734` that describe the old rule.
3. The rule must not read the season's existing `stat_availability` row, and must not use `medal_awarded` as evidence of absence.
4. A unit test pins the constant to literals and proves it equal to the reference JSON's `brownlow_season_total` `not_applicable`
   ranges. It must not consult `coverage-registry` status.
5. No synthetic or fixture year is ever added to the constant. No table, column or migration: if the worker judges one necessary, stop
   and report (migration ordering and `grant_app_read` are out of this run's scope).
6. Siblings: migration 016 is not edited. For `import_legacy_afl.py`, establish whether any live path invokes it; if none, leave it,
   correct the "keep all three definitions in lockstep" comment at `player-derived.ts:630-633`, and record the divergence with
   `file:line` in the scope README; if live, stop and report. Note any edit under `tools/migration` trips the rebuild rule (F-011).
7. `docs/data-dictionary.md` and `docs/architecture.md` Brownlow coverage text updated in the same commit (CLAUDE.md §11), and they are
   outside the record paths, so they land before Q″.

### F-003 — D-365-1 consumers the plan does not name

- `tools/db/afl-api-identity-correction-rehearsal.ts:1540-1544` pins `not_applicable` for the season total and match votes of fixture
  season 2092 (complete, no medal) and asserts it at `:1643`, with fixed-point checks at `:3108` and `:3322`. No test runs this tool
  (only source-text unit tests reference it), so it goes stale silently and fails at the next operator rehearsal.
- `tools/migration/correct_afl_api_identity.ts:2775-2781` calls the changed function and refuses if `stat_availability` changes. This
  is the correction tool the pending B-steps rest on.
- `v2-brownlow-production-correction` (8/8, 38 min in run 3) and `v2-brownlow-eligibility-2025-rehearsal` exercise that path and are
  first run in step 8, after integration.

Mitigation. Add to step 1: update the rehearsal's `SETTLED_BROWNLOW_COVERAGE` to literals that follow from the owner's rule (not read
back from a run), run the rehearsal tool end to end on an isolated database, and run both clone suites at the scope tip before
returning. Step 8 re-runs all three at Q″. **No run-3 evidence is reused** for any of them. Each existing test that pinned the old rule
is listed in the scope README with before/after.

### F-004 — D-365-1 acceptance checks

Fold into the `brownlow` brief; every expected value is a literal from the owner's decision.
1. Suite-owned completed season, no `brownlow_season_votes`, no entry-state decisions: red at B4 (`not_applicable`, exact rows), green
   after (`pending`).
2. Same season with the season-total row pre-seeded `not_applicable` (the already-corrupted state): recompute heals it to `pending`.
3. Declared seasons: recompute 1900 and 1943 inside an always-rolled-back transaction; the three rows are byte-identical before and
   after.
4. All-season sweep on both bases, each season in a rolled-back transaction: list every season whose three Brownlow rows differ from the
   base. Expected at the season-total grain: none. Any round or match grain difference is reported with the row text, not fixed.
5. `lockMatch`: a completed `pending` season admits a finalisation (and becomes `partial`); a declared season still refuses
   `season_not_polled`.
6. Re-run run 3's red control (the pre-`6edf4f99` `settle-afl-api-brownlow` file, then `database`, shared, fresh copy): the war-years
   test (`database.test.ts:325-335`, literal `[1942, 1943, 1944, 1945]`) now passes without the test-side restore.
7. The 2026 rows of both bases before and after one recompute, three grains, with md5, in the README.
The regression's home is the closest Brownlow suite (`admin-brownlow.test.ts` or `brownlow-pending-*.test.ts`), not `database.test.ts`
(F-010).

### F-005 — already-recomputed databases and the packet

A database where 2026 already reads `not_applicable` stays locked after this change: `lockMatch` refuses before any recompute can run
(`admin-brownlow.ts:723`), the settle recomputes only on a canonical Brownlow change (`afl-api-brownlow.ts:1721`), and
`player_season_stats.brownlow_status` follows the row (`brownlow-readiness.ts:20-22`). Production's 2026 rows have never been read.

Mitigation (step 10). `APPROVAL-PACKET-4` states ISSUE-365 as "fixed locally for future recomputes; does not repair an existing row";
keeps the read-only probe of production's 2026 rows as its own approval; and adds a conditional, separately approved repair step
(coverage recompute, then season-status recompute, for 2026) with its acceptance query. Nothing is run. ISSUE-365 stays open until the
probe result is known.

### F-006 — public text for a completed, pending season

`brownlowStatusNote('pending')` and `formatBrownlow` state that the season is in progress and the medal not awarded. For 2026 both are
false, and "not awarded" is the mirror of the inference the owner prohibited. This predates the run (the bases already hold 2026 at
`pending`), but D-365-1 makes `pending` the durable state.

Mitigation. Decide before fan-out, and record the choice in the plan: **default** is no UI change, with the two strings carried as a
substantive owner decision in the packet (proposed neutral wording included). If the orchestrator instead changes the text, it is a
rendered-UI change: the proposal must declare viewport, screen (`/players/[slug]` season table) and states first, the unit and e2e pins
(`journeys.spec.ts:134`) move with it, and closure captures or flags `VISUAL: UNVERIFIED`. A worker must not change it unprompted.

### F-007 — evidence checker

Defects, from `run2/evidence/verify-manifests.sh`:
- `:77` takes the scope as the first path component (`run3`), and `:91-94` then accepts any file under it whose path ends in the entry
  name. That produced the known false positive (`manifest-verify-9cb06c53.tsv:1`).
- `:62-67` accepts the **first candidate whose hash matches**. If the file at the manifest's own path is altered and a like-named file
  elsewhere still has the recorded hash, the row is COMMITTED-OK. This direction hides real corruption and is not in the run-3 record.
- `:74` excludes every `run2/` manifest; `:159` excludes `run2/` prose.
- `:49`: every run-2/3 manifest entry that is not committed falls to "no host mapping rule": **1,159** of the 1,300 UNRESOLVED rows
  (another 50 are prose prefixes).

Mitigation (fold into the `evidence` brief).
1. Resolution is exact: an entry resolves to the manifest's directory plus the entry path, or to a location named in an explicit,
   committed per-manifest map (root, host root, alias such as `template-identity.txt` -> `template-identity.restored.txt`). No basename
   or suffix search. More than one candidate is an error class of its own, never a pass.
2. Keep reading blobs with `git cat-file` (a Windows clone's working tree is not byte-stable).
3. Self-test fixtures prove both directions red on the run-2 script and green on the new one: the false positive, and the masked
   mismatch.
4. Pass criterion, stated in the plan: COMMITTED-MISMATCH 0; ambiguous 0; every manifest entry in exactly one class (committed exact
   path, committed by declared alias, host-verified read-only by declared path, host-missing, declared not retained with reason);
   manifest-entry UNRESOLVED 0 or each one listed. Prose-prefix rows are a separate, informational class.
5. The packet reports the counts per class. It does not say "verified" for rows that were not hashed.
6. Run-4 manifests list committed files only, paths relative to the manifest's directory; host-only hashes go in a separately named file
   with absolute paths. This keeps the map free of post-Q″ edits (F-008).
7. Preservation: the run-2 script stays byte-identical (hash recorded); its committed failing output stays; the original script is run
   once more at B4 and its output committed as the red; the explanation goes in the run-4 record and in a **new** `ERRATA.md` beside the
   script (precedent: ISSUE-363 TST-8). The brief must grant that one new file, since §5 otherwise confines records to `run4/<scope>/`.
   That satisfies "preserve the original failure and its explanation".

### F-008 — final-candidate mechanism

The outline works: an annotated tag is a separate object, so its message can name C without circularity, and `cat-file -p` shows the
`object` header as well. Four holes:
1. **Q″ by path.** The checker, its map and the qualification scripts live under `docs/v2/evidence/…`, a record path. A step-12 "LOW
   correction" to the map would pass `git diff --name-only Q″ C` and still change the tool that verifies C (run-3 CLOSURE F-001 and
   PLAN-REVIEW-3 F-008 again). Define the record set as an explicit allowlist of files and globs, and treat any change to a script, the
   checker or its map as a new executable revision with a stated requalification (for a checker-only change: self-test plus full
   verification). Phase B's check uses the same allowlist.
2. **Phase B failure.** The plan says nothing is committed after C, and does not say what happens if phase B fails. State it: delete the
   local tag and branch (never pushed), correct, cut C′, recreate both, rerun phase B in full. A stale tag must never survive.
3. **Tree state.** Phase B also asserts an empty `git status --porcelain` in the integration worktree and that the three refs are equal.
   Any session summary or handover a tier writes to a tracked path is written before C and is in the allowlist, or is written outside the
   repository.
4. **Ref and command.** The packet cannot contain C's SHA. Give the owner both forms and verify they agree: in the packet,
   `git push origin "remediation-final-20261115^{commit}:refs/heads/main"` with a fully qualified destination; in the tag annotation and
   the final report, the same command with the full SHA. Never the unpeeled tag as source. Add `git rev-list -n 1
   remediation-final-20261115` as the shell-neutral way to print the SHA (`^{commit}` is mangled by `cmd.exe`). Phase B adds: origin
   `main` re-read and unchanged, `de640826` is an ancestor of C, and the exact refspec rehearsed against a throwaway **local** bare
   repository (no contact with origin). The tag itself is not part of Approval A and is not pushed.
Also: the verification of C necessarily lives outside C. The packet says where, and that its own manifest figures are for the pre-final
tip; phase B shows the two outputs differ only by rows for files added in between, and that each step-12 edit maps to a closure finding.
A self-contained bundle of the tag with a recorded sha256 is the simplest source for the "fresh clone".

### F-009 — failure-ledger baselines

Run 3's only full 99-file run was per-file (`=all`) on the snapshot (`QUALIFICATION-3.md:28`); shared mode was not run at Q′
(`:79-80`); the rebuild was measured by named groups for the 53 ids (`integb/README.md` §7-§8).

Mitigation. In `FAILURE-LEDGER-4`: (1) name the cells exactly (base x `AFLDB_TEST_PER_FILE_DB` value, and say whether mode `1` is run);
(2) "gone/new/continuing vs run 3" is used only for snapshot x per-file; (3) for the other three cells either run the same cell at B4
first as the baseline (recommended for both shared cells, where an order-dependent failure cannot otherwise be attributed) or label the
cell "first measurement" and classify every id on its merits; (4) record the file order of each shared run and state that one order is
one sample; (5) pre-register the predicted base-dependent changes so they are neither mistaken for regressions nor "fixed" by
weakening: the three birth-date ids will fail on the snapshot once pinned to the rebuild (13,347 vs 13,255), and any surrogate-id
fingerprint will differ by base (F-012).

### F-010 — cross-scope collisions and base B4

1. **B4.** The brief says its MED mitigations are binding and that B4 is "the commit that added this file". Workers read the brief from
   their own worktree. B4 must be the commit that contains the amended plan, the amended brief and this review; the bundle and its
   sha256 are made after that.
2. **Fixture namespaces.** `leaked-fixtures.ts:19-26,42-49` is the season registry and already records overlaps. Allocate in the plan,
   before fan-out, a distinct season range and synthetic provider-id prefix per scope (run 3 used `CD_I2071275001`), and have the
   orchestrator alone edit the registry at step 7.
3. **File ownership.** `database.test.ts` belongs to `clubcmp` only; `release-gates.test.ts` to `gates`; `settle-afl-api-brownlow*`,
   `settle-afl-api.test.ts`, `settle-afl-api-state-b.test.ts` and `brownlow-fixture.ts` to `brownlow`; `settle-afl-api-issue276` and
   `awards-reload-links` to `coleman276`; `admin-fixtures` and `after-siren*` to `shared`. A shared helper is extracted by one named
   scope or not at all.
4. **Same fact, two files.** `database` "50-199 goals and no Brownlow votes" (item 4, `clubcmp`) and release-gates "exact 261 players"
   (363-W, `gates`) are one fact. The two scopes agree the treatment in their briefs and the difference, if any, is recorded.
5. **Exit gate per scope.** Before returning: typecheck, `lint:gate`, and the changed suites on both bases in per-file and shared mode.

### F-011 — rebuild rule and reuse

Mitigation. (1) Compute reachability mechanically: the import closure of each TypeScript stage entry (a bundler metafile is enough),
intersected with `git diff --name-only 6d5388ea Q″`, plus the path prefixes; commit the list. (2) Expect it to fire: step 1 edits
`src/db/queries/player-derived.ts` and a file under `tools/db`. Budget the rebuild (571 s in run 3) from the run-3 input copies; RB-1 is
not read. (3) If rebuilt, integration runs on the Q″ rebuild, and the worker records its equivalence to the run-3 dump (83-table counts,
and the Brownlow `stat_availability` rows of every season) so scope red/green taken on the run-3 dump still stands. (4) `QUALIFICATION-4`
carries a reuse table: each check is "re-run at Q″" or "reused from <revision>" with the exact `git diff` that proves independence.
`src/` changes in this run, so typecheck, lint gate, unit, build and the AFLW metadata check are re-run or individually justified; the
Caddy matrix may be reused on an empty diff. (5) Any qualification-script fix after Q″ follows F-008 item 1.

### F-012 — 363-G must not pass vacuously

On the snapshot `seasons` has no `in_progress` row (`integb/README.md:191`: `expected [] to deeply equal [ 2026 ]`); on the rebuild it
is 2027. A gate that looks up "the in-progress season" and returns when there is none repeats the TST-4 defect this issue fixed.

Mitigation (`gates` brief). The provisional-season contracts (no premier, no wooden spoon, Brownlow pending and never zero, no
player-season row with a vote) are asserted on a season the test itself establishes inside an always-rolled-back transaction, so
`release-gates` stays a non-committing file and nothing leaks in shared mode. The structural invariant (at most one in-progress season,
and it is the latest) is asserted separately on the real table. Each assertion is shown non-vacuous on both bases (a mutation red).
The "exact N players" fingerprints (`integb/README.md:141-142`) are re-derived over stable keys, never surrogate ids. The completed-season
`pending` case belongs to D-365-1's regression (F-004), not to this file.

### F-013 — item 4 needs a red

Mitigation (`clubcmp` brief). Durable form: the application result equals an independent raw-SQL oracle written in the test, and the
oracle bounded to seasons <= 2025 equals the historical literals with recorded provenance (685,471 / 114 / 261 / 219,
`integb/README.md` §5). Acceptance: on a scratch copy, commit a synthetic later completed season that moves each cohort; the B4
assertions fail (red, exact text), the new ones pass; both pass unchanged on the two pristine bases.

### F-014 — RB-1 record

Mitigation. Name the owner of the record (step 7, orchestrator) and the places: `docs/v2/isolated-rebuild.md` (already stale per
`RESIDUALS-3.md` §2.6; outside the record paths, so before Q″), `blockers.md`, `HANDOFF.md`, `RESIDUALS-4`. `CLAUDE.md` is owner-only:
propose the text in the packet, do not edit. Add to brief §1 that `/mnt/ssd/afldb-rem3-*` (the accepted dump and the rebuild input
copies) and `/mnt/ssd/afldb-review-20261114T0640Z` are read-only and excluded from cleanup, and that no cleanup uses a glob wider than
`/mnt/ssd/afldb-rem4-<own scope>-*`.

### F-015 — clone database names

Mitigation. Add to brief §2: "The two Brownlow clone suites require the exact names `afldb_v2_brownlow_tristate_twelve_test` and
`afldb_v2_brownlow_policy_final_test`; these are permitted on your own cluster and port only, built from the documented recipe and
retained artefacts (PLAN-REVIEW-3 F-005, F-006)."

## 3. Answers to the questions put

- **Coverage and scope.** Complete (F-025). Item 4 reading defensible (F-022). T363-2/T363-3 in scope (F-023).
- **D-365-1.** F-002 to F-006. The rebuild takes its Brownlow coverage from the reference JSON, not from the changed function, so the
  rebuilt database should not change; the file-level rule will still call for a rebuild (F-011).
- **Sequencing and isolation.** F-010, F-015, F-016. Five workers plus qualification are safe on the host (F-024).
- **Qualification.** F-009, F-011.
- **Evidence checker.** F-007.
- **Final candidate.** F-008.
- **Hard stops.** Complete for push, production, DEV, shared `afldb_test`, lint baseline, live Brownlow and both RB-1 names. Gaps are
  F-014 (run-3 inputs, cleanup globs) and F-017. The test-design rule is right; F-001, F-003, F-012 and F-013 are the places it would
  be broken without the mitigations.
