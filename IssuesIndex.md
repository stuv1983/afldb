# AFLDB Current Issues Index

> Lightweight session index of **open issues only**.
>
> `issues.md` is the authoritative detailed ledger. If this file and
> `issues.md` disagree, trust `issues.md` and immediately synchronize this file
> and the Open Issues table at the top of `issues.md`.

**Last updated:** 2026-09-11
**Open issues:** 18 tracked here — `AFLDB-ISSUE-117`, `AFLDB-ISSUE-137`, `AFLDB-ISSUE-138`, `AFLDB-ISSUE-139`, `AFLDB-ISSUE-140`, `AFLDB-ISSUE-142`, `AFLDB-ISSUE-144`, `AFLDB-ISSUE-147`, `AFLDB-ISSUE-148`, `AFLDB-ISSUE-149`, `AFLDB-ISSUE-150`, `AFLDB-ISSUE-151`, `AFLDB-ISSUE-152`, `AFLDB-ISSUE-153`, `AFLDB-ISSUE-155`, `AFLDB-ISSUE-156`, `AFLDB-ISSUE-157`, `AFLDB-ISSUE-158`.

<!-- UPDATE 2026-09-11 (ADMIN CENTRE COMPLETION UMBRELLA ALLOCATED — PLANNING ONLY, NO CODE):
     `AFLDB-ISSUE-156` (umbrella), `AFLDB-ISSUE-157` (P1 Admin foundation and audit viewer) and
     `AFLDB-ISSUE-158` (P2 Capability enforcement) allocated after confirming none of the three
     appeared in the working tree, `git log --all`, `issues.md`, this file, `AFLDB-ISSUE-155.md`
     or `CHANGELOG.md`. ISSUE-155 Phases D–I are TRANSFERRED BY REFERENCE to the 156 umbrella
     (placeholders P3/P4/P6/P7/P11/P12, ID only at phase start); ISSUE-155 keeps only the PROD
     closeout of A/B/C1/C2 and is NOT a blocker. ISSUE-151 is a contract to honour (promotion
     inventory entry for every new table), not a gate. `AFLDB-ISSUE-154` stays a ledger hole
     reserved for the Grid Solver won-final defect — NOT reused. Migration 095 is the
     planning-time next-free snapshot only, NOT allocated; every phase re-checks numbering.
     Two planning findings recorded in `AFLDB-ISSUE-156.md`: (1) 157 reads `auth_audit_log` and
     `data_edits` with no migration or privilege change, `data_overrides` visibility deferred;
     (2) coach-only identity creation as ISSUE-155 §9 described it is blocked by the NOT NULL
     `coaches.afltables_coach_path` / `coaches.source_id` (087) — P3 preflight decision C-1.
     Runbook `AFLDB-ISSUE-156.md`; no `src/`, `tools/`, `tests/`, `deploy/`, `CHANGELOG.md` change. -->

<!-- UPDATE 2026-09-09 (ISSUE-152 PHASE F RENDERED ACCEPTANCE COMPLETE AND GREEN — §27; P6 349/349 AND A FRESH P4-r1 1,495/1,495):
     Phase F is ACCEPTED. The §26.10 outstanding list is now closed. A fresh production
     `npm run build` of this branch PASSED (taken AFTER the test type-contract correction
     `2ec9871`) and was served standalone on 127.0.0.1:3100; the MANDATORY stale-build
     discriminator then returned **HTTP 200** and the answer **"365 players match"** for
     `/search?q=players+who+also+coached`, which no pre-Phase-F build can produce. **D20
     rendered correctly in the same check** — "Showing 100 of 365", with the answer text
     explicitly stating the displayed rows were NOT the whole list.
     **P6** (`issue152-phasef-p6`, preserved `nl-ui-out-152-phaseg/p6-phase-f-next/`):
     **349/349 observed, 253 answered / 25 unanswerable / 71 absent, 349 pass, 0 fail,
     0 unscored, 0 rate-limit detections, 0 page_error, 0 http_error, 0 filler
     disagreements, 0 client-side errors**, 4/4 Playwright batches. **P4-r1 re-run FRESH**
     (`issue152-phasef-p4r1`, preserved `nl-ui-out-152-phaseg/p4-regression/`):
     **1,495/1,495, 1,435 answered / 60 unanswerable, absent 0, 0 fail, 0 unscored**,
     every transport counter at zero, 15/15 batches — the 1,435 + 60 gate is UNCHANGED.
     Two corrections were made during acceptance, NEITHER semantic: `2ec9871` fixed two
     test type contracts (`matchType: 'final'` -> `'finals'`; a hand-copied set union
     replaced by the imported `PhaseGSetName`), and `5be7511` added `next` to the shared
     `ValidateSet` in `tools/issue-152/phase-g-common.ps1` so `phase-f-corpus.ps1` could
     ask for its own set — a HARNESS-ONLY correction with no semantic change.
     The frozen 271, 319 and 1,495 sets and every preserved historical run are untouched.
     **C1, FS1, FS2, FS3, FS6, D6, D8 and X3 remain DEFERRED to `AFLDB-ISSUE-153`, are
     each held by a named decline row in the rendered corpus, and are NOT Phase F
     failures.** The working tree is clean; B, C, D, E, F and G are all committed on
     `opus/issue-152-nl-record-expansion` through `5be7511`. **Phase F is ACCEPTED and
     ready to merge as a stable checkpoint before ISSUE-153.** **ISSUE-152 as a whole is
     NOT closed:** migrations 092 and 093 must still reach afldb_dev and production BEFORE
     the code, `nl:stress` has still not been run for B, C, D, E or F, and the blocked
     Phase D half stays with ISSUE-153. No deploy, no merge, no production change. -->

<!-- UPDATE 2026-09-09 (ISSUE-152 PHASE F IMPLEMENTED AND LOCALLY VALIDATED — §26; ITS "NEXT ACTION" IS SUPERSEDED BY THE UPDATE ABOVE, WHICH RECORDS THAT RUN AS COMPLETE AND GREEN):
     Phase F is BUILT. The operator decisions are final: F-D1 defers X3 to AFLDB-ISSUE-153,
     F-D2 declines all temporal wording, F-D3 declines one-sided club composition, and F-D4
     approved the `played_for_club` reuse on fresh read-only afldb_test evidence. Shipped:
     **X1** ("players who also coached", **365** — match_coaches-backed, NOT the 368
     identity-only seam) and **X2** ("players who played for Richmond and also coached
     Richmond", **27**), plus the asymmetric and organization-lineage forms. TWO new grid
     builders — `has_coached` and `coached_club(organization)`, catalogue **164 -> 166**;
     `played_for_club` reused unchanged; **no new grain, no migration**; ONE plan field
     (`crossDomainClubs`, so the answer can NAME both clubs — a recorded deviation from
     §25.5, which had assumed none was needed); `PARSER_VERSION` **38 -> 39**.
     Validation: R0 red-before-green recorded (no Phase F wording answered under v38);
     typecheck PASS; 3,777 DB-free tests pass (2 pre-existing unrelated failures, §26.9);
     the NEW independent DB oracle suite `tests/integration/nl-answers-cross-domain.test.ts`
     is **21/21** — X1 = 365, X2 Richmond = 27, coached_club(18) alone = 41, the 368 seam,
     the Pagan/Wallace/Laidley lineage traps, D20 365/100 — and all 11 NL integration
     suites are green (215 tests). Corpus: two new tracked CSVs (15 plan / 15 decline) and
     `PHASE_G_SETS.next` = **349 = 253 plan + 96 decline**, 4 batches, every row verified
     against afldb_test BEFORE pinning; the frozen 271, 319 and 1,495 sets are untouched.
     NEXT ACTION: **fresh production build of this branch -> stale-build discriminator
     (/search?q=players+who+also+coached must answer "365 players match") -> P6
     `.\tools\issue-152\phase-f-corpus.ps1` (349 rows, ~13 min) -> fresh 1,495 regression.**
     Migrations 092 and 093 must still reach afldb_dev and production BEFORE the code, and
     nl:stress has still not been run for B, C, D, E or F. Phase F is NOT green and
     ISSUE-152 is NOT resolvable. No deploy, no merge, no production change. -->

<!-- UPDATE 2026-09-09 (ISSUE-152 PHASE F PLANNED — §25; SUPERSEDED BY THE UPDATE ABOVE):
     Phase F (cross-domain composition, X1/X2/X3) is now PLANNING-ELIGIBLE and PLANNED.
     Its §9 gate is satisfied: **Phase D is GREEN for the ISSUE-152-owned/unblocked scope**
     (C2, C3, C4, FS4 — P5-r2 319/319 and a fresh P4-r1 1,495/1,495, every transport counter
     at zero), and the ISSUE-153-deferred semantics (C1, FS1, FS2, FS3, FS6, D6, D8) do
     **NOT** block Phase F — they supply no predicate, plan field or vocabulary rule that
     X1/X2/X3 consume, and they remain explicit declines until deliberately revisited.
     Runbook **§25** records the plan against measured, read-only `afldb_test` evidence
     (F0-F8, 2026-09-09, `afldb_app`, 55432 tunnel, BEGIN TRANSACTION READ ONLY / ROLLBACK,
     production untouched): **X1 = 365** (played AND actually coached, `match_coaches`-backed —
     NOT the 368 identity-only seam), **X2 = 27** (played Richmond AND coached Richmond;
     coached-Richmond-only is 41, never-played-there is 14), **X3 = 1** (Rhyce Shaw, player
     10974 / coach 233). Design: **TWO new grid builders only** — `has_coached` (parameterless)
     and `coached_club(organization)` — catalogue 164 -> 166, with `played_for_club` and
     `father_son_selection` REUSED unchanged; **no new grain, no new plan field, no migration**;
     everything stays on `player_career` + `careerPredicates`. `coached_by` CANNOT serve
     (wrong subject, owns a coach id and no club, never touches the player link) and must not
     be overloaded. **X2 sets no `scope.clubFor` at all** — both clubs are builder parameters —
     because `careerPredicatesOwnClubFor` would otherwise suppress the generic playing-club
     filter and silently answer "coached Richmond" (41) for "played AND coached Richmond" (27).
     Coached-club scope folds through `clubs.organization_id`, never a raw `clubs.id`
     (measured: Pagan 3 raw / 2 orgs, Wallace 3/2, Laidley 2/1). **D9 is NOT reopened**: the
     "also" reading ships, "later" declines by name in the parser with a stated reason and is
     never silently stripped — chronology is derivable (238 after / 127 before-or-during / 0
     missing) but is not an owned semantic. One parser bump only, **v38 -> v39**. Four operator
     decisions are OPEN before coding: **F-D1** (X3 needs an explicit son-side father-son cue
     that the D8 guard currently blocks — recommend DEFERRING X3, shipping F as X1+X2),
     **F-D2** ("went on to coach" declines with "later"), **F-D3** (one-sided club forms
     decline), **F-D4** (one targeted read-only query, §25.16, to confirm `player_clubs` and
     games-based Richmond membership agree at 27). Phase F is **NOT started** and ISSUE-152 is
     **NOT resolvable**. No executable source, migration, corpus, test, PARSER_VERSION, database
     or Git change was made by the planning slice. -->

<!-- UPDATE 2026-09-09 (ISSUE-152 PHASE D RENDERED ACCEPTANCE COMPLETE AND GREEN):
     the sweep that §23 left as the next action has been RUN. The unblocked Phase D slice --
     **C2, C3, C4 and FS4** -- is COMPLETE and GREEN through a real browser against a real build.
     **P5-r2** (`issue152-phased-p5r2`, preserved `nl-ui-out-152-phaseg/p5-phase-d-current-r2/`):
     **319/319 observed, 238 answered / 21 unanswerable / 60 absent, 319 pass, 0 fail, 0 unscored,
     0 rate-limit detections, 0 page_error, 0 http_error, 0 filler disagreements, 0 client-side
     errors**, 4/4 batches. **P4-r1 re-run FRESH** (`issue152-phased-p4r1`, preserved
     `nl-ui-out-152-phaseg/p4-regression-phase-d-r1/`): **1,495/1,495, 1,435 answered / 60
     unanswerable, 0 fail, 0 unscored**, every transport counter at zero, 15/15 batches -- the
     1,435 + 60 gate is UNCHANGED. **The first P5 attempt was INADMISSIBLE** (a stale
     pre-Phase-D standalone build: sound transport, wrong code underneath) and is counted
     nowhere; a **fresh discriminator** proved Phase D relationship rendering on the rebuilt
     server BEFORE P5-r2, and that is what makes P5-r2 admissible. Historical Phase G P3/P4
     preserved evidence is UNTOUCHED and the accepted P3 corpus stays 271 = 212 + 59. **D20
     remains ACCEPTED** as capped-list disclosure, now proved end-to-end. Parser **v38**, **no
     migration**, nothing in `src/` changed during acceptance or closeout. **Closeout validation
     (no sweep re-run):** `tsc --noEmit` clean; **1,107/1,107** across 16 focused DB-free NL
     suites; `grid-solver-spec` **16/16**; `nl-answers-relationships` **20/20** and
     `nl-semantic-mapping` **22/22**, DB-backed read-only against `afldb_test`;
     `phase-g-verify.ps1 -Set current` PASS (319/238/81, 4 batches); `phase-g-verify.ps1` default
     PASS and UNCHANGED (271/212/59, 3 batches); preserve-static PASS (30 assertions);
     `git diff --check` clean. **ISSUE-152 REMAINS OPEN AND IS NOT RESOLVABLE:** the blocked
     Phase D half (C1, C5/C6, FS1, FS2, FS3, FS6, D6/D8 -- with `AFLDB-ISSUE-153`), **Phase F**
     (not started), the **uncommitted working tree**, and the **un-run deploy** (migrations 092
     AND 093 before the code). The two `tests/integration/grid-solver.test.ts` won-final failures
     stay OUTSIDE ISSUE-152, uninvestigated and untouched. No Git write, commit, merge or deploy
     was performed. Runbook §24. -->
<!-- UPDATE 2026-09-09 (ISSUE-152 PHASE D RENDERED CORPUS AND ACCEPTANCE HARNESS BUILT; D20 ACCEPTED):
     the gate §22.12 named as missing. **D20 IS ACCEPTED** (runbook §22.5): relationship
     queries whose true result count exceeds 100 use AFLDB's EXISTING capped-list disclosure
     contract — true total computed and reported, existing capped table rendered, explicit
     "Showing 100 of N", and answer wording that states the displayed rows are not the whole
     list. Silent truncation is prohibited; NO Phase-D-specific refusal was introduced for
     C2 (658), C3 (181) or FS4 (107). Held by five assertions in `tests/nl-describe.test.ts`
     and by the eight over-cap rows in the new corpus. **TWO ADDITIVE CORPORA, 48 ROWS:**
     `tests/nl-ui/corpora/afldb-ui-questions-relationships-v1-20260909.csv` (**26** plan) and
     `...-relationships-decline-v1-20260909.csv` (**22** decline), covering C2/C3/C4/FS4 only.
     The 22 declines are one row per boundary, each named by category: C1/D6, C5/C6, FS1, FS2,
     FS3, FS6, vague "family members"/"related to", sisters, twins, cousins, grandparents,
     uncles, in-laws, mothers, pairings, an ambiguous subject, and the five unsupported scopes
     (club, season, venue, opponent, match type). The **Ben Cousins** surname-collision
     regression (§22.8) is preserved as a rendered PAIR — a plan row where the surname resolves
     as a player beside a live relationship cue, opposite the cousins decline.
     **EVERY ROW WAS VERIFIED AGAINST `afldb_test` BEFORE BEING PINNED:** a throwaway DB-backed
     probe parsed all 48 through the real resolver, executed each plan row's SQL and rendered
     it — **48 of 48** as claimed (17 parser declines + 5 `validatePlan` refusals; the pinned
     negatives render as an ANSWER, not an empty panel; `sons of Gary Ablett Snr` resolves the
     FATHER, id 4700). The probe is deleted and its evidence is durable in §23.3.
     **HISTORICAL PHASE G EVIDENCE DOES NOT MOVE:** the accepted P3 corpus stays **271 = 212 +
     59** and `phase-g-new-corpus.ps1` still runs exactly it. Phase D APPENDS as a separate
     `current` set — **319 = 238 plan + 81 decline**, 4 Playwright batches — whose first 271
     rows are byte-for-byte the 271-row file, so §19.3's position-based statements survive.
     **NEW RUNNER `tools/issue-152/phase-d-corpus.ps1` (P5):** every P3 guard kept (2,200 ms at
     ONE worker, `NL_UI_LIMIT` refused not inherited, throttling = `page_error` = hard failure,
     immutable `-OutName`), plus four refusals of its own — a corpus that is not 319/238/81, a
     corpus that does not slice into 4 batches, the P3/P4 run tags, and a missing tunnel (TCP
     probe; **no psql or database client anywhere in the script**). Run tag
     `issue152-phased-p5`, preserved at `nl-ui-out-152-phaseg/p5-phase-d-current/`.
     **VALIDATION:** `npx tsc --noEmit` clean; **627/627** across parser/plan/describe/audit/
     query-intent/grid-solver-spec/nl-ui-corpus; **232/232** across the four remaining DB-free
     NL corpus suites; `tests/integration/nl-answers-relationships.test.ts` **20/20** DB-backed
     against `afldb_test`; `nl-semantic-mapping` **22/22**; `phase-g-verify.ps1 -Set current`
     PASS (319/238/81, `playwright --list` enumerated **4** batches); `phase-g-verify.ps1`
     default PASS and UNCHANGED (271/212/59, 3 batches); preserve-static PASS (30 assertions).
     The pins are stated three times independently — `PHASE_G_SETS.current`,
     `phase-d-corpus.ps1`, `tests/nl-ui-corpus.test.ts`. **Nothing in `src/` changed:** parser
     stays **v38**, no migration. The two `tests/integration/grid-solver.test.ts` won-final
     failures remain OUT OF SCOPE, uninvestigated and unedited — that suite is NOT claimed
     green. **NOT DONE:** the rendered Phase D sweep has NOT been run, nor the P4 re-run;
     nothing committed, merged or deployed. Runbook §23. -->

<!-- UPDATE 2026-09-09 (ISSUE-152 PHASE D IMPLEMENTED — UNBLOCKED HALF ONLY: C2/C3/C4/FS4):
     the operator authorised the unblocked half after the read-only `afldb_test` evidence run
     of 14:08:43 (`afldb_app`, `default_transaction_read_only=on`, one backend pid, ROLLBACK;
     transcript preserved at
     `nl-ui-out-152-phaseg/evidence/ISSUE-152-phase-d-evidence-afldb_test-20260909-140843.txt`).
     **`PARSER_VERSION` 37 -> 38, one bump. NO MIGRATION.** Six new grid builders take the
     catalogue 158 -> 164: `has_afl_father`, `has_afl_son`, `has_afl_parent_or_child`, and the
     per-player `brother_of_player` / `father_of_player` / `son_of_player`; `has_brother` and
     `father_son_father` are REUSED unchanged. Three rules are encoded rather than assumed:
     direction comes from `person_a_role`/`person_b_role` (measured father -> son, 127 of 127),
     "brother" stays LABEL-backed (`brothers` + `twin brothers`, never `relationship='sibling'`,
     which also holds sisters and unsexed rows), and an unlinked side is a NAME, never an
     identity. A named relative is a new typed plan field (`relationshipSubject`) paired with
     the predicate's bound id, because the person a question is ABOUT is not the person it
     returns. **RED BEFORE GREEN:** the Stage-0 probe recorded 31 of 31 NONE on the pre-phase
     parser (runbook §22.2); the probe is deleted and its evidence is durable in §22.
     **VALIDATION:** `npx tsc --noEmit` clean; parser **300/300** (47 new), plan **144/144**
     (8 new), describe **61/61** (12 new), grid-solver-spec **16/16**, nine further DB-free NL
     suites **485/485**, NL integration **174/174**, and the new DB-backed
     `tests/integration/nl-answers-relationships.test.ts` **20/20** against hand-written SQL
     (populations 658 / 181 / 107 / 127 asserted as a fixture contract, both unlinked-side
     witnesses, the Gary Ablett 4700/4701 identity trap). **STILL DECLINING, unchanged:** C1,
     C5/C6, FS1, FS2, FS3, FS6 and every bare father-son SELECTION form (D6/D8, with
     `AFLDB-ISSUE-153`), plus sisters/twins/cousins/grandparents/in-laws/mothers-daughters and
     vague "family"/"related to" wording, each now declining BY NAME. **One operator decision
     is recorded and open, D20** (§22.5): the three unbounded forms (658 / 181 / 107) answer
     with the framework's existing explicit over-cap DISCLOSURE — true count in the headline,
     "Showing 100 of 658", plus a new in-answer caveat — because the framework has no over-cap
     REFUSAL to reuse; reversing that is one line plus three corpus rows. **TWO PRE-EXISTING
     `tests/integration/grid-solver.test.ts` FAILURES ARE NOT PHASE D** (§22.10): won-final
     eligibility disagrees with its own in-test oracle (282 vs 283; 3,644 vs 3,658), stable
     across two runs, in a code path this phase did not touch (69 insertions, 0 deletions);
     recommend allocating **`AFLDB-ISSUE-154`** for it. **NOT DONE:** no rendered/browser
     acceptance, no Phase D corpus rows, no Phase G re-run, no `nl:stress`, nothing committed,
     nothing deployed. Next free issue ID is `AFLDB-ISSUE-154`. Runbook §22. -->

<!-- UPDATE 2026-09-09 (ISSUE-152 PHASE G COMPLETE AND GREEN — P3-r2 271/271, P4-r1 1,495/1,495):
     both rendered browser sweeps passed against a local production build of
     `opus/issue-152-nl-record-expansion` on 127.0.0.1:3100 (DEV serves `main`, which has
     neither new grain, so a DEV sweep would measure the wrong code — runbook §19.1).
     **P3-r2** `issue152-phaseg-p3r2`, preserved at `nl-ui-out-152-phaseg/p3-new-family-r2/`:
     271 of 271 observed, 212 answered / 16 unanswerable / 43 absent, 271 pass, 0 fail,
     0 unscored, 0 rate-limit detections, 0 page_error, 0 http_error, 0 filler-variant
     disagreements, 0 client-side errors, 3/3 Playwright batches. **P4-r1**
     `issue152-phaseg-p4r1`, preserved at `nl-ui-out-152-phaseg/p4-regression-r1/`: 1,495 of
     1,495 observed, **1,435 answered / 60 unanswerable** — the existing gate's exact shape,
     unmoved by three parser versions — 1,495 pass, 0 fail, 0 unscored, 0 rate-limit
     detections, 0 page_error, 0 http_error, 0 filler disagreements, 0 client-side errors,
     15/15 batches. **P3-r1 was a VALID run (269/270)** whose sole failure was an incorrect
     `plan` expectation on the unsuffixed "gary ablett": the existing resolver contract
     correctly treats the bare name as AMBIGUOUS (ids 4700/4701) and declines rather than
     guessing, so the corpus was wrong and the engine right. Corrected by suffixing the plan
     row to "gary ablett jr" and adding the bare form as decline `fkg_dec_007` — final pinned
     corpus **271 = 212 plan + 59 decline**, strict size guard KEPT, not loosened. Smoke r1
     stays INADMISSIBLE (no 55432 tunnel, `ECONNREFUSED 127.0.0.1:55432`); **smoke r2 proved
     the paced transport clean at 40/40** before either full sweep was spent. Phase G tooling
     is now a reusable tunnel/server/verify/smoke/P3/P4/status/diagnose workflow under
     `tools/issue-152/`; preserved run output is IMMUTABLE and refuses overwrite (tested
     offline by `tests/phase-g-preserve-static.test.ps1`, 30 assertions); `phase-g-verify.ps1`
     exits 0 on all six static gates. **Closeout validation 2026-09-09:** `npx tsc --noEmit`
     clean; 6 focused suites **644/644** (parser 253, plan 136, describe 49, audit 10,
     ui-corpus 37, semantic-mapping 159); `phase-g-verify.ps1` PASS; preserve-static PASS.
     **ISSUE-152 is NOT resolvable:** Phases D and F have not started, the Phase G working
     tree is uncommitted, and nothing is deployed. Runbook §21. -->

<!-- UPDATE 2026-09-09 (ISSUE-152 PHASE G P3 RUN 1 VALID — 269/270; SOLE FAILURE WAS A CORPUS DEFECT):
     the first ADMISSIBLE P3 run (tag `issue152-phaseg-p3-r1`, 2026-09-09T01:15:13Z, 2,200 ms at ONE
     worker, 3 batches, 11.3 min). Nothing throttled, tunnel up: **270 of 270 observed, pass 269 /
     fail 1 / unscored 0**, outcomes answered 211 / unanswerable 16 / absent 43 / http_error 0 /
     page_error 0, 0 metamorphic violations, 0 client-side errors, Playwright exit 0. Preserved at
     `nl-ui-out-152-phaseg/p3-new-family/`. **The single failure is a CORPUS-CONTRACT DEFECT, not a
     parser defect.** `fkg_005` asked "did gary ablett kick a goal with his first kick" as a `plan`
     expectation, and observed `absent`. Two directory players are named Gary Ablett (ids 4700/4701),
     and the resolver's existing contract (`src/search/nl/parser.ts:2092`) makes an unsuffixed mention
     an **ambiguity** that declines rather than guessing between two real players — so the engine was
     right and the row was wrong. NO parser/planner/compiler/renderer/vocab/query/migration/grant
     change; `PARSER_VERSION` stays **37**. Correction: the plan row is rewritten to the suffixed
     **"gary ablett jr"** form (exercising the Jr/Jnr alias path, `parser.ts:1383`), and the bare
     wording is ADDED to the decline corpus as `fkg_dec_007` / `fkg_decline_ambiguous_player` — the
     run-1 `absent` already stands as its red evidence (`tools/nl/ui-corpus.ts:172`: absent is a
     legitimate decline). **New pinned P3 size 271 (212 plan / 59 decline)**: plan is UNCHANGED because
     the row was replaced, not added; decline went 58 -> 59. `build-phase-g-corpora.ts` REFUSED to
     build until this was recorded — the guard working as designed — and **the guard was not
     loosened**: `PHASE_G_SETS.new.expected` is now `{rows:271, plan:212, decline:59, unknown:0}`, the
     merged output renamed `phase-g-new-family-271.csv`, with matching pinned counts in
     `phase-g-new-corpus.ps1`, `phase-g-verify.ps1`, `phase-g-smoke.ps1` and `tools/issue-152/README.md`
     (`phase-g-status.ps1` needed none — it counts data lines at run time). **P3 is NOT YET GREEN:**
     two rows have never been observed in their current form, so the FULL 271 must re-run as
     `issue152-phaseg-p3-r2`; a two-row partial would not re-establish the metamorphic groupings or the
     transport gates. P4 (1,495) is unaffected and has not been run. Runbook §20. -->

<!-- UPDATE 2026-09-09 (ISSUE-152 PHASE G SMOKE r1 INADMISSIBLE — MISSING PostgreSQL TUNNEL, NOT A DEFECT):
     the 40-row paced coaching smoke returned 40/40 HTTP 500. Root cause is PROVEN from the
     persisted standalone server log: `Error: connect ECONNREFUSED 127.0.0.1:55432`. This
     workstation runs no PostgreSQL server — every Phase G DSN reaches the database through an
     SSH forward on 55432, and it was not running. NOT semantics, NOT parser/planner, NOT the
     rate limiter, NOT a grant (no connection was ever made, so no grant was exercised), NOT a
     standalone-runtime failure (`/` returned 200 as one of 1,472 build-time prerenders).
     r1 establishes ONE thing — pacing works: 40 observed, 0 rate-limit detections, 0 page_error.
     It wrote NO nl_search_log rows and supports NO semantic conclusion. Harness only, no
     application/DB change: NEW `tools/issue-152/phase-g-tunnel.ps1` (window 1, `ssh -N -o
     ExitOnForwardFailure=yes -L 127.0.0.1:55432:127.0.0.1:5432 arm@10.0.40.100`, no credential
     stored, occupied port reported by PID and never killed); `phase-g-server.ps1` now REFUSES to
     start without a reachable forward and tees stdout+stderr to
     `nl-ui-out-152-phaseg/server/server-<timestamp>.log` (one per run, gitignored, no
     credential — that log is what proved this); NEW read-only `phase-g-diagnose.ps1`;
     `phase-g-status.ps1` gains a `-- PostgreSQL tunnel 55432 --` block with a real connect test.
     Workflow is now three windows: tunnel -> server -> tests. Re-run is tagged
     `issue152-phaseg-smoke-r2`. Runbook §19.7. -->

<!-- UPDATE 2026-09-09 (ISSUE-152 PHASE G: P1 BUILD PASS; P3 ATTEMPT 1 INADMISSIBLE, NOT FAILED):
     the first rendered/browser acceptance of Phases B+C+E ran 270 questions against a local
     production build of the branch backed by `afldb_test`. Transport and browser execution
     COMPLETED (270/270 observed, all HTTP 200, zero page/console/hydration errors), but the
     SEMANTIC EVIDENCE IS INADMISSIBLE: `/search` enforces a per-IP, PER-PROCESS rate limit of
     30 requests/60s ahead of the NL pipeline (src/app/search/rate-limit.ts, ISSUE-120,
     1 Sep 2026), and `npx next start` is ONE process. **Exactly 30 requests traversed the NL
     pipeline**; the remaining **240 were rate-limited** and rendered "Too many searches"
     without calling globalSearch(). The 26-second run never left one 60s window. The 30 passes
     are the first 15 rows of each worker's first batch — positional, not semantic. **All 58
     apparent decline passes are DISCARDED as evidence** (a throttled page is indistinguishable
     from a correct decline). **Phase G P3 remains UNPROVEN, not failed** — no parser, planner,
     compiler or renderer defect is implicated and none was changed. What the 30 admissible
     observations DO prove: `coach_record` and `after_siren` render end-to-end with correct
     counts/interpretations, and app-role reads work on `coaches`/`match_coaches`/
     `after_siren_kicks`. **First-kick-goal has NO rendered evidence at all.** ONE edit made:
     `tests/nl-ui/nl-stress.spec.ts` `observe()` now scores the rendered "Too many searches"
     branch as `page_error` instead of `absent`, so a throttled sweep fails loudly instead of
     manufacturing semantic failures. No new outcome, no scoring/corpus/timeout change, no
     application change; **the rate limiter was NOT weakened and must not be**. NEXT ACTION:
     re-run P3 in the deployed runtime shape — `node deploy/server-cluster.mjs` with
     `AFLDB_WORKERS=8` against `afldb_test`, `NL_UI_WORKERS=1` — then P4 (1,435 + 60).
     Runbook §19. -->

<!-- UPDATE 2026-09-09 (ISSUE-152 PHASE E TECHNICALLY COMPLETE; F4 CLOSED; D11 GATE SATISFIED):
     the first-kick-goal family closes its last two gaps. `PARSER_VERSION` **37** (36->37, one
     bump). Phase E added **no grain, no builder, no query file, no SQL and no migration**: E7
     ("a goal with each of their first N kicks") and E8 ("whose first-kick goal was their only
     career goal") now emit two builders the Grid Solver has always had. E8 was a MISREAD before
     it was a decline — the tail "only career goal" was read as the ranking subject, so a
     career-goals leaderboard would have answered a question about players who kicked exactly one.
     The operator authorised the loader (E-D2); `--apply` against `afldb_test` from
     `D:\dev\afldb\data\records\first-kick-goal.csv` (main checkout; the extract is gitignored and
     is NOT committed) reported batch **230: 334 updated / 0 inserted / 0 deleted**. M-E1:
     **334 total / 330 linked / 44 multi-kick / max consecutive 6 / 23 only-career-goal /
     4 no-further-kicks / 1911-2026**. Non-DB gate **485/485 PASS**, `tsc` clean; red-before-green
     against `47a645f` **21 failed / 427 passed**; **`tests/integration/nl-answers-first-kick-goal.test.ts`
     20/20 PASS in 1.499s** against the loaded population. The jointly-invoked reload suite's **11
     Windows timeouts are the established Windows runtime pathology, NOT a Phase E regression** —
     authoritative Linux run 16/16 PASS in 53.94s; no timeout raised, no importer behaviour
     changed. Three deliberate fail-closed deviations (E9, E-DEC-4/5, E-DEC-8) return NAMED
     refusals instead of leftover tokens, because the leftovers here are "goal" and "kick" —
     both METRIC_WORDS — and a consumed span removes the unresolved-token penalty that was the
     only thing suppressing the wrong answer. **ISSUE-152 stays OPEN for Phases D and F, which
     have NOT started; Phase D is blocked on AFLDB-ISSUE-153.** Runbook §18. -->

<!-- UPDATE 2026-09-08 (ISSUE-152 PHASE C IMPLEMENTED; M7 CLOSED; D19 DID NOT FIRE): the operator
     answered D12-D19 and authorised Phase C. It is BUILT: a tenth `after_siren` EVENT grain over
     the curated `after_siren_kicks` list, three INDEPENDENT typed dimensions, an `event`/`player`
     subject split with two payload shapes, the D10 match-link boundary as one exported
     `afterSirenRequiresMatchLink()`, `src/db/queries/nl/after-siren.ts`, two renderer tables, and
     migration `093_nl_search_log_after_siren_grain.sql`. `PARSER_VERSION` 35 -> **36** (one bump).
     **R0 (run BEFORE any edit): all eight after-siren probes DECLINED, so no live false-answer
     defect exists and D19's condition DID NOT FIRE** -- but the hazard is confirmed and was only
     masked: the player-metric extractor DID claim `goals`/`kicks`, suppressed solely by the
     unresolved penalty on the leftover `after siren` tokens, so the step-5d precedence rule is
     load-bearing and is asserted directly. **M7 CLOSED by the D16 read-only query:
     `club_unresolved = 0`, `opponent_unresolved = 0`, `events = 126`** -- every curated event has
     both club ids resolved, so §15.6's exclusion caveat was dead code and was NOT implemented
     (§15.19's own instruction). The two real exclusions ARE wired and computed at answer time: 6 of
     126 events have no trusted player link, 10 of 126 have no canonical match.
     **Red-before-green: 46 assertions were OBSERVED failing across five suites before
     implementation began**, including R1 -- `after_siren` added to the type-derived
     `SUPPORTED_NL_GRAINS` made `afldb_test` reject it with
     `violates check constraint "nl_search_log_grain_check"`, which is what proved 093 was required
     rather than assumed. Validation: `tsc` clean; DB-free NL gate **490/490 PASS** (7 files);
     new `tests/integration/nl-answers-after-siren.test.ts` **20/20 PASS** against `afldb_test`,
     every assertion compared to independently hand-written SQL; the six other NL integration
     suites **86 PASS / 3 skipped**, so Phase B coaching stays green; the telemetry-grain contract
     PASSES with 093 applied; migration naming/collision/checksum contract passes. Measured and
     matching every §15.16 witness: most goals = **Barry Hall and Gary Rohan tied on 2**; most kicks
     = **nine tied on 2**; 3+ goals **empty**; 4 goals against the Richmond lineage including
     **Bill Wood 1946 Footscray**; Grand Final **empty** and never the `round_raw='GF'` Escort
     Championships row; 8 finals events; first = **Billy Schmidt 1913** (match 1313); most recent =
     **Nasiah Wanganeen-Milera 2025** (match 16792) and never a match-unlinked later row; R7 parity
     with `getAfterSirenRecords` holds for **every** player. Two additive corpora, **93 plan / 27
     decline**, every row executed through the REAL directory and behaving as declared; the
     1,435/60 gates and both coaching corpora untouched and asserted siren-free.
     **Three deviations from §15, all narrowing (runbook §16.10):** "out on the full" / "fell short"
     are NOT vocabulary (§15.4 and §15.14 C-D9 contradicted each other; resolved in favour of the
     decline, since D5 does not expose `shot_detail`); the unresolved-club caveat dropped on the M7
     measurement; and two small additions found by executing the corpus -- a kick-noun regex and the
     whole-token hyphenated `match-winning`/`game-winning` compounds.
     **NOT COMMITTED, NOT DEPLOYED**, no rendered/browser run, no `npm run build`, no `nl:stress`.
     Migrations **092 AND 093 must reach `afldb_dev` and production BEFORE the code.**
     **ISSUE-152 stays OPEN for Phases D-F, which have NOT started.** Runbook §16. -->

<!-- UPDATE 2026-09-08 (ISSUE-152 PHASE B TECHNICALLY COMPLETE; F5 CLOSED): the two DB-backed
     gates left BLOCKED at implementation time have been EXECUTED and both pass. Migration 092 is
     applied to `afldb_test`, and the F5 contract test -- `tests/integration/database.test.ts` ->
     "accepts every supported NL telemetry grain and rejects an unsupported one" -- **PASSES**: all
     nine grains insert including `coach_record`, and a random unsupported grain is still rejected.
     **F5 CLOSED**, proven against the database. `tests/integration/nl-answers-coaching.test.ts`
     re-ran **23/23 PASS**. Focused non-DB Phase B gate **548/548 PASS** (7 files); migration
     naming/collision/checksum contract **36/36 PASS**; `npx tsc --noEmit` clean.
     **OUT OF SCOPE, NOT INVESTIGATED, NOT EDITED:** four `tests/integration/database.test.ts`
     dataset-count assertions fail as external, pre-existing `afldb_test` baseline drift --
     player-match rows 685,471 expected / 694,445 actual; 200-249 games with 16+ finals 114 / 119;
     50-199 goals and no Brownlow votes 261 / 268; 200+ games, 100+ goals, 15+ finals 219 / 223.
     The first is pinned by its own comment to the `full-history-20260827` snapshot and the other
     three count the same population. None touches NL search, telemetry or migration 092, and
     Phase B changes no row count; re-pinning them to the current database would destroy the drift
     signal, so they are left to a separate dataset-baseline investigation. Phase B is technically
     complete -- code, tests, migration and docs finished and validated -- and COMMITTED on
     `opus/issue-152-nl-record-expansion`. NOT shipped: no rendered/browser run, no `npm run build`,
     no deploy; migration 092 must reach `afldb_dev` and production BEFORE the code.
     **ISSUE-152 stays OPEN for Phases C-F. Phase C has NOT started.** Runbook §14.4, §14.4.1,
     §14.6, §14.7. -->

<!-- UPDATE 2026-09-08 (ISSUE-152 PHASE B IMPLEMENTED): the operator approved runbook §13 and
     answered §13.17 as **(b)** — a floor-only coaching coverage rule at **1902**, no hard-coded
     upper bound, an empty future-season result treated as a genuine empty result, and no claim
     that coverage is complete from 1902 onward. Phase B is now BUILT: a `coach_record` grain over
     `match_coaches ⋈ matches`, an `NlCoachRef` distinct from any player reference, a 386-row coach
     directory that excludes colliding surnames, the two player-grain readings wired to the
     existing `coached_by` / `premiership_coach` builders, and the DELETION of the false
     `UNANSWERABLE_TOPICS` coaching rule in the same change (F2 CLOSED). `PARSER_VERSION` 34 → 35.
     Validation: `tsc` clean; the focused parser/plan/describe/acceptance suites green;
     `tests/integration/nl-answers-coaching.test.ts` **23/23 PASS** against `afldb_test` over the
     55432 tunnel, comparing every answer to independently hand-written SQL on the exhaustive §1.4 /
     §1.5 / §7.2 witnesses; the 1,435-row realistic and 60-row decline gates untouched and re-asserted
     coaching-free. Two new additive corpora (99 plan / 25 decline) are executed through the REAL
     coach directory in that suite. NOT DONE: no rendered/browser run, no `npm run build`, no
     deploy, no commit. Deviations from §13 are recorded in runbook **§14.5** — notably the coaching
     step runs before match-type extraction (so "grand finals" stays a coaching metric), the
     win-percentage qualifier is a new `coachQualifier` plan field, `organizations` ships as a tenth
     metric, and the tests were written AFTER the implementation with a post-hoc red check (53 of the
     new cases fail with the three gates reverted) rather than test-first. Phase C NOT started. -->

<!-- UPDATE 2026-09-08 (ISSUE-152 operator decisions FINAL; Phase B PLANNED, not implemented):
     **D1, D2, D3, D4, D5, D7, D9 APPROVED**; **D6/D8 DEFERRED** to `AFLDB-ISSUE-153`; **F1 stays
     external-only** under ISSUE-153. **D10 PARTIALLY APPROVED** — a match-unlinked
     `after_siren_kicks` row may take part in any semantics fully answerable from that table
     (list, count, player totals, club/opponent totals, goal/behind/none, won/drew/none,
     `kicker_result`, season, premiership-season flag), and `match_id` must NOT be required merely
     because the event is premiership-season; but it may NOT determine "most recent"/"first" until
     a deterministic chronology independent of canonical `matches` is proven (`season` + `round_raw`
     is not automatically a total ordering), and any semantics needing canonical match properties
     (finals/`round_type`, match date, venue, match identity) MUST require `match_id`. The ownership
     boundary is documented in runbook **§7.1**. **D11 ANSWERED — DB-backed verification REQUIRED**:
     parser/plan-only verification is refused for Phase E; the first-kick-goal family must be
     populated in `afldb_test` through the existing supported loader before Phase E is accepted;
     **that loader must not be run until the operator authorises it**; Phase E stays after Phase B
     and Phase C; the DB-backed testing contract is not weakened. **Runbook §13 now holds the Phase B
     coaching implementation plan** — plan only, nothing built: no source, test, corpus or
     `CHANGELOG` change, `PARSER_VERSION` still 34. Next gate is operator approval of §13. -->

<!-- UPDATE 2026-09-08 (ISSUE-152 Stage-0 evidence gate CLEARED): the operator executed
     `ISSUE-152-nl-evidence.sql` against `afldb_test` over the `55432` tunnel — read-only,
     `ROLLBACK` reached, 41/41 sections, no errors, production untouched — into
     `ISSUE-152-nl-evidence-output.txt`. Two evidence-pack-only SQL fixes were required first
     (§7.4 `id` qualified as `a.id`; §2.8 `id AS event_id` restored); no product, schema or test
     file was touched. Runbook §5.3 now records every measured witness, threshold boundary,
     coverage limit and identity boundary, plus six named measurement gaps (M1–M6).
     **D1–D5, D7 and D9 are resolved on measured evidence and await only an operator yes;
     D6/D8 stay with `AFLDB-ISSUE-153`; two new decisions D10 (match-unlinked after-siren rows)
     and D11 (no first-kick-goal data in `afldb_test`) need answers.** New Finding **F4**:
     `player_achievements` holds zero `first_kick_goal` rows in `afldb_test` because the family
     loads from a gitignored curated extract — a test-fixture gap, not a product defect, and the
     only reason Phase E lacks DB-backed witnesses. Finding **F1** is measured **LATENT** on this
     data (see the `AFLDB-ISSUE-153` row) — urgency down, scope unchanged, still out of ISSUE-152
     implementation scope. `PARSER_VERSION` still 34; no implementation started. Next free issue
     ID is `AFLDB-ISSUE-154`. -->

<!-- UPDATE 2026-09-08 (ISSUE-153 allocated from ISSUE-152 Stage-0 Finding F1): `AFLDB-ISSUE-153`
     is now ALLOCATED and Open — **`/records/father-son` and `/records/family` do not read what
     their prose says**. Split out of `AFLDB-ISSUE-152` by operator decision so a public-UI
     semantic defect is not carried inside an NL issue. `/records/father-son` reads
     `player_relationships` `parent_child` and never `father_son_selections`, while the Grid
     Solver's `father_son_selection` builder reads that draft-rule table; `/records/family` groups
     every relationship type by `family_key` while its prose says siblings. No implementation, no
     branch, not reproduced against data. ISSUE-152 records it as an EXTERNAL DEPENDENCY only and
     is NOT blocked by it for Phases B, C or E. Next free issue ID is `AFLDB-ISSUE-154`. -->

<!-- UPDATE 2026-09-08 (ISSUE-152 allocated, STAGE 0 ONLY): `AFLDB-ISSUE-152` is now ALLOCATED and
     Open — **Expand deterministic NL Search to newer AFLDB record families**, on branch
     `opus/issue-152-nl-record-expansion` (worktree `D:\dev\afldb-issue-152`), from merged `main` @
     `c2761e6` (the ISSUE-110 semantic-closeout merge; `main` had not advanced). `PARSER_VERSION`
     34, deliberately NOT incremented. Stage 0 is allocation + inventory + a proposed semantic
     contract only: no parser, plan, compiler, corpus, UI or schema change, no migration, and no
     `CHANGELOG` entry because no behaviour changed. AFLDB has five public record boards the typed
     NL layer does not represent; only first-kick-goal is substantially supported. Three findings —
     (F1) `/records/father-son` reads `player_relationships` `parent_child` and never
     `father_son_selections` while the Grid Solver builder reads the draft-rule table, and
     `/records/family` groups every relationship type while its prose says siblings; (F2) the NL
     coaching decline (`vocab.ts:882`) gives a reason that migration 087 made untrue; (F3) six
     implemented grid builders are unreachable from NL (the parser emits 8 of 179). Both rendered
     corpora (1,435 / 60) are untouched and contain no question in these families, so the expansion
     is purely additive. Evidence pack inspected and verified read-only; NOT executed (no `.env`,
     no `afldb_test` tunnel here). **Operator 2026-09-08:** Stage 0 approved for persistence; F1 is
     OUT OF ISSUE-152 scope, tracked as `AFLDB-ISSUE-153`, recorded here as an external dependency
     that does NOT block Phase B, C or E. Runbook: `issues/open/AFLDB-ISSUE-152.md`. Next free
     issue ID is `AFLDB-ISSUE-154`. -->

<!-- UPDATE 2026-09-08 (ISSUE-151 allocated + implemented): `AFLDB-ISSUE-151` is now ALLOCATED and
     Open — **Fix production promotion lineage/FK sequencing for `external_grid_sources`**, on
     branch `sonnet/issue-151-promotion-lineage-fk` (worktree `D:\dev\afldb-issue-151`), from `main`
     @ `88ca994`. Found by the first real production promotion (stamp `20260907-234124`, paused with
     the candidate restored and the source/pre-cutover/restored gates green): the generated plan
     plainly `pg_restore`d `external_grid_sources` (id 1, `ingest_source_id = 57`) into a candidate
     whose gridley `sources` row is id 7 and whose id 57 does not exist, so the NOT NULL immediate FK
     refuses BEFORE the correctly evidenced AFLDB-ISSUE-142 remap (57 -> gridley -> 7) can run.
     Generator defect, fixed in the tracked tooling, **no migration**: the contract now STAGES any
     reinstated table with a NOT NULL football reference that has a stable lineage identity
     (`isStagedReinstatement`, by shape — today exactly `external_grid_sources`). New generated
     `promotion-stage.sql` / `promotion-promote-staged.sql`; the transcript restores the staged
     table into `promotion_staging` (COPY header redirected, grep-guarded), runs the
     `--lineage-remap-out` file at fixed step 2c (its UPDATE now targets the staging copy; written
     as an explicit no-op on a shared lineage), promotes with `OVERRIDING SYSTEM VALUE` (ids
     preserved, FK enforced on insert), then restores `external_grids`/`external_grid_axes`. The
     plan validator refuses the old plain restore, a misordered lifecycle and every constraint
     bypass. Hardened 2026-09-08: pre-cutover refuses an empty staged table; a leftover
     promotion_staging schema is refused at every phase and by the plan validator, docs §7.2
     require inspection before cleanup/retry. **Validation:** `tests/db-promotion-check.test.ts` 96/96 (13 new),
     `tests/workflow-preflight.test.ts` 24/24, `tsc` + `eslint` clean; generated artefacts for the
     real stamp inspected. NOT run: the DB rehearsal `ISSUE-151-staged-reinstate-rehearsal.sh` (no
     PostgreSQL server on the workstation) — operator runs it on streamanator. Next free issue ID is
     `AFLDB-ISSUE-152`. -->

<!-- UPDATE 2026-09-07 (ISSUE-150 allocated + implemented): `AFLDB-ISSUE-150` is now ALLOCATED and
     Open — **Expand AFL venue pages with historical venue records and statistics**, on branch
     `sonnet/issue-150-venue-records` (worktree `D:\dev\afldb-issue-150`), bootstrapped from merged
     `main` @ `00eea34` after ISSUE-149. The public venue page (`/venues/[slug]`) is rebuilt from a
     "most recent 50 matches" list into a historical record page — **no migration**, no schema /
     index / route-privilege / deploy change; one new server-rendered route
     `/venues/[slug]/matches`. Five new venue-scoped (`matches.venue_id`) typed query functions in
     `src/db/queries/venues.ts`, run in parallel, each mirroring `ISSUE-150-venue-evidence.sql`
     (the semantic contract): **(1) `getVenueOverview`** — total matches, recorded-attendance
     coverage, first + most recent match as linked briefs (`ORDER BY match_date, id` / `DESC`).
     **(2) `getVenueClubRecords`** — W-D-L + win % (`wins/games*100`, a draw is NOT half a win) for
     every historical club identity that played there, grouped on the raw `clubs.id` from the match
     (Footscray ≠ Western Bulldogs), `games DESC, wins DESC, name, id`. **(3) `getVenueRecords`** —
     highest / lowest **recorded** attendance (`attendance IS NOT NULL`; NULL never wins, a real 0
     is a valid minimum), highest single-team score, biggest winning margin; every ORDER BY ends on
     a unique column. **(4) `getVenuePlayerLeaders`** — top 5 for games / goals / marks / kicks /
     handballs in one round trip; `games` counts `player_match_stats` rows, the stat boards `SUM`
     only `WHERE <stat> IS NOT NULL` (a NULL is never COALESCEd to 0) and carry `recordedGames`, so
     marks/kicks/handballs boards are headed "Recorded"; ranked `value DESC, player_id`.
     **(5) `getVenueMatches`** — the complete history, `match_date DESC, id DESC`,
     `count(*) OVER ()` + empty-page fallback (the `getPlayerMatches` shape); the 50-row ceiling is
     removed. Components: `src/components/Venue{Records,ClubRecords,PlayerLeaders,MatchHistory}.tsx`
     (server components, each renders nothing when empty). Pages:
     `src/app/venues/[slug]/page.tsx` rewritten (keeps `revalidate=86400` + `generateStaticParams`;
     Overview → Venue records → Club records → Player leaders → 10-match preview linking to the full
     log); new `src/app/venues/[slug]/matches/page.tsx` (`force-dynamic`, `?page=` 100/page,
     `<Pagination>`, `noindex` on filtered views) — the exact `/players/[slug]/matches` split, so the
     aggregates stay on the cached venue page. Not added to `sitemap.ts`. **Validation (workstation
     had a tunnel to `afldb_test`):** `tsc` PASS; `eslint` 0 errors (one pre-existing-style `_total`
     warning); `tests/venue-records-sections.test.ts` **12/12** (no DB); `tests/integration/
     venue-records.test.ts` **15/15** against `afldb_test` (truth re-derived from raw `matches` /
     `player_match_stats`). **NOT run:** `ISSUE-150-venue-evidence.sql` eyeball (no `psql` here),
     `npm run build`, DEV deploy + browser smoke — see `ISSUE-150-OPERATOR-VALIDATION.md`. One
     Unreleased `CHANGELOG.md` entry. Next free issue ID is `AFLDB-ISSUE-151`. -->

<!-- UPDATE 2026-09-07 (ISSUE-149 allocated + implemented): `AFLDB-ISSUE-149` is now ALLOCATED and
     Open — **Expand club pages with historical records and player honours**, on branch
     `fable/issue-149-club-records` (worktree `D:\dev\afldb-issue-149`), bootstrapped from merged
     `main` after ISSUE-148. SIX new public club-page sections, all lineage-scoped by
     `organization_id`, all from existing canonical tables, no migration, ISSUE-148's Premierships /
     Coaches sections preserved: **(1) Club records** — `getClubMatchRecords()` in
     `src/db/queries/clubs.ts` (a `club_matches` CTE orients every lineage match to the club's
     perspective; six single-row deterministic picks — biggest win/loss margin, club's own
     highest/lowest score, highest/lowest COMBINED match score; ties broken `match_date DESC,
     match_id DESC`), `src/components/ClubMatchRecords.tsx`. **(2) Record crowds** —
     `getClubCrowdRecords()` (same CTE + `attendance IS NOT NULL`; highest home-and-away
     / finals `is_finals_series` / Grand Final crowd + Top 5, `attendance DESC, match_date DESC,
     match_id DESC`; null attendance never shown as 0), `src/components/ClubCrowdRecords.tsx`.
     **(3) Players** — `getClubPlayers()` (full `player_clubs` set summed by `organization_id`, one
     row per player, this club's games/goals only, not truncated), `src/components/ClubPlayers.tsx`
     (`SortableTable` in a `defaultOpen={false}` `CollapsibleTable`). **(4) Premiership players** —
     `getClubPremiershipPlayers()` (`player_club_season_stats.is_premier`, lineage-scoped,
     `season DESC, games DESC`), `src/components/ClubPremiershipPlayers.tsx`. **(5) Awards & honours**
     — `getClubBrownlowMedallists()` (real `brownlow_season_votes.is_winner` rows, club attributed
     by the player's same-season club — `player_season_stats.primary_club_id` when `club_count = 1`,
     COALESCEd behind the always-null `brownlow_season_votes.club_id`; the same convention as
     `brownlowAttribution()` / `getClubBrownlowHistory` in `src/db/queries/club-comparison.ts` and
     the public `/brownlow` Club column, per ISSUE-118 §W.4 — then lineage-scoped) and
     `getClubHonours()` (`award_winners` with
     `awards.category = 'award'`, `slug <> 'brownlow-medal'`, `club_id` in lineage) in
     `src/db/queries/awards.ts`, `src/components/ClubHonours.tsx`. Page wiring in
     `src/app/clubs/[slug]/page.tsx` (6 queries into the existing `Promise.all`; 5 section blocks,
     each omitted when empty). **Most Games / Most Goals / Captains from the issue brief were
     already on the page** (Games leaders / Goalkicking leaders / Captains) and are preserved
     unchanged. **Unsupported attribution, deliberately omitted and reported:** `honour_team_members`
     (only `club_name_raw`, no `club_id`/season — cannot prove the club at the time),
     `player_achievements` (zero rows), Brownlow winners whose season club cannot be resolved
     (`brownlow_season_votes.club_id` NULL for all 112 winner rows + no single-club season row —
     zero such rows in `afldb_test`).
     **Claims NO migration number.** New tests: `tests/integration/club-match-records.test.ts`,
     `tests/integration/club-crowd-records.test.ts`, `tests/integration/club-players.test.ts`,
     `tests/integration/club-premiership-players.test.ts` (cross-checks the premiership-season set
     against `club_seasons.is_premier` AND `getClubPremierships`),
     `tests/integration/club-honours.test.ts`, `tests/club-records-sections.test.ts` (component
     render). One Unreleased `CHANGELOG.md` entry.
     **Brownlow correction 2026-09-07:** the first cut inner-joined `brownlow_season_votes.club_id`,
     which is NULL for all 112 winner rows, so every club returned zero Brownlow rows.
     `getClubBrownlowMedallists` now attributes by same-season club
     (`player_season_stats.primary_club_id` when `club_count = 1`), COALESCEd behind the null
     `club_id` — the existing `getClubBrownlowHistory` / `/brownlow` convention; its tests rewritten
     to prove the semantic against an independent `player_club_season_stats` oracle.
     **Validation GREEN (operator, 2026-09-07):** `club-records-sections` 14/14, ISSUE-149
     integration set 32/32, `npx tsc --noEmit` PASS, `npm run build` PASS, no migration. Awaiting
     operator commit / merge / DEV deploy / browser smoke. Stays Open until merged and verified on
     DEV. 10 -> 11 open. Next free issue ID is `AFLDB-ISSUE-150`. -->


<!-- UPDATE 2026-09-07 (ISSUE-148 allocated + implemented): `AFLDB-ISSUE-148` is now ALLOCATED and
     Open — **Show club-specific coaching records (and premierships) on club pages**, on branch
     `fable/issue-148-coach-club-records` (worktree `D:\dev\afldb-issue-148-coach-club-records`).
     TWO sections added to every public AFL club page, both derived from canonical `matches` with no
     migration:
     (1) **Coaches** — one row per coach who has coached that club, with that coach's record **for
     that club only** (club-specific, never whole-career; separate periods in charge aggregated into
     one row). New `getClubCoachRecords(clubId)` in `src/db/queries/coaches.ts` (lineage-scoped by
     `organization_id`, like `getClubTotals`/`getClubLeaders`; draw-weighted win % to match
     `/records/coaches`), `src/components/ClubCoachRecords.tsx` (Coach · **Span** · Games · W · D ·
     L · Win %; "Span" = `formatSpan(firstSeason, lastSeason)`, a first/last range; coach names link
     to player / `/coaches/[slug]-id`), pushed after Captains, omitted when empty.
     (2) **Premierships** — one row per **won Grand Final** (`m.round_type = 'grand_final'`, the
     canonical predicate `getCoachCareer` / Grid Solver use — not every final, never a Wildcard
     Final; a drawn GF has a null winner so the replay is the row), newest first. New
     `getClubPremierships(clubId)` in `src/db/queries/clubs.ts` (opponent = the non-winner club home
     or away, score from the winner's perspective, venue via `COALESCE(v.canonical_name,
     m.venue_raw)` + `v.slug`, crowd = `m.attendance` left null; lineage-scoped so
     Footscray/Western Bulldogs share 1954+2016; no hand-kept year list),
     `src/components/ClubPremierships.tsx` (Year · Opponent · Score · Venue · Date · Crowd; opponent
     → `clubPath`, venue → `venuePath`, `formatDate` / `formatAttendance`), pushed first, omitted
     when empty.
     **Claims NO migration number** — existing schema already supports both.
     New tests: `tests/integration/club-coach-records.test.ts`, `tests/club-coach-records.test.ts`,
     `tests/integration/club-premierships.test.ts` (Richmond year set cross-checked against
     `club_seasons.is_premier`; per-row fields checked against the raw `matches` row),
     `tests/club-premierships.test.ts` (component render). One Unreleased `CHANGELOG.md` entry
     covering both sections.
     **Validation:** coaching section operator-validated against `afldb_test` via SSH tunnel
     (`tests/club-coach-records.test.ts` 8/8 PASS, `tests/integration/club-coach-records.test.ts`
     9/9 PASS, `tsc` PASS, `build` PASS); premierships section `tsc`-checked, its integration suite
     written but NOT yet operator-run. Awaiting operator commit / merge / DEV deployment / browser
     smoke; stays Open until merged and verified on DEV. 9 -> 10 open. Next free issue ID is
     `AFLDB-ISSUE-149`. -->


<!-- UPDATE 2026-09-07 (ISSUE-147 allocated + implemented): `AFLDB-ISSUE-147` is now ALLOCATED and
     Open — **Public UI responsive design review and remediation**, on branch `claude/issue-147-ui`
     (worktree `D:\dev\afldb-issue-147-ui`). A full authenticated rendered audit of the public site
     against DEV (27 routes × 7 widths, 320–1440) found page-level responsive discipline sound (no
     document-level horizontal overflow anywhere); the defects were concentrated in navigation IA
     (the phone bottom bar exposed 5 of 11 masthead destinations — Clubs, Venues, Coaches, Brownlow,
     Awards, Draft, Match Search unreachable on a phone; same gap under `/aflw`; the home browse grid
     a third drifting list), a 641–~890 px masthead-nav overflow band, and dense tables that scroll
     inside `.table-wrap` with no affordance. IMPLEMENTED and validated locally against the live DEV
     database through an operator SSH tunnel (temporary process-level DSN overrides only; `.env`
     untouched): new canonical `src/lib/site-nav-model.ts` feeding masthead + a new phone "More"
     dialog sheet (full primary set, focus-trapped, Esc/backdrop/link/popstate close) + the home
     grid (Coaches card added); `QUICK_TABS` now includes Clubs; masthead nav wraps cleanly at
     641–1080 px; `.table-wrap` gains a CSS-only theme-aware directional scroll shadow with no markup
     change; new committed `tests/e2e/responsive-nav.spec.ts` (32/32) derives nav parity from the
     rendered masthead; `tests/e2e/journeys.spec.ts` nav tests de-skipped on mobile + a "clubs is
     reachable" test. `tsc`/`eslint`/`npm run build` PASS; journeys nav 10/10 on Desktop + Pixel 7;
     full viewport audit 200/200, zero overflow, zero 4xx/5xx. **Claims NO migration number** — no
     schema/query/route/privilege/deploy change. 8 -> 9 open. Next free issue ID is
     `AFLDB-ISSUE-148`. Awaiting operator commit/merge/deploy; audit scaffolding
     (`playwright.responsive.config.ts`, `tests/responsive/_baseline-audit.spec.ts`,
     `artifacts/issue-147/`) is NOT for commit. -->


<!-- UPDATE 2026-09-07 (ISSUE-146 closeout): `AFLDB-ISSUE-146` is **Resolved — 2026-09-07**.
     `code_test_db` as a second explicitly supported disposable full-rebuild target for
     `npm run db:test:rebuild` merged to `main` (`62e9536`). The first real rehearsal rebuild has
     since completed successfully: one bounded host-bootstrap gap was found and fixed along the way
     — a freshly created `code_test_db` had no `pg_trgm`/`unaccent` extensions because
     `tools/maintenance/00_install_postgres.sh` never provisioned it (only `afldb_dev`/`afldb_test`),
     so migration `008_search.sql` failed on `unaccent`; the script now bootstraps `code_test_db`
     identically. After that fix, the full rebuild applied all 91 migrations, completed all 22
     stages, passed the ladder witness, and passed final validation 85/85. Removed from this index
     and the Open Issues table; number stays allocated. 9 -> 8 open (this entry corrects the table's
     count, which was not incremented when `AFLDB-ISSUE-146` was allocated). Next free issue ID
     remains `AFLDB-ISSUE-147`. -->

<!-- UPDATE 2026-09-06 (ISSUE-145 closeout): `AFLDB-ISSUE-145` is **Resolved — 2026-09-06** on branch
     `sonnet/issue-145-venues` (worktree `D:\dev\afldb-issue-144-venues`), not yet committed. The
     existing `/venues` index is now exposed in site navigation: `Venues` entry after `Seasons` in
     `PRIMARY_NAV` (`src/components/SiteNav.tsx`), `Venues` card after `Seasons` in the home "Browse
     the record" grid (`src/app/page.tsx`), a focused Playwright nav-reachability test
     (`tests/e2e/journeys.spec.ts`) and one Unreleased `CHANGELOG.md` entry. **NO migration number**,
     no schema, no query, no new route. Validated: `tsc --noEmit` clean; the focused nav Playwright
     test passes on desktop and skips on mobile by design; `npm run build` exit 0 with `/venues`
     (dynamic) and all 52 `/venues/[slug]` pages generated. Removed from this index and from the Open
     Issues table; number stays allocated. 9 -> 8 open. Next free issue ID is `AFLDB-ISSUE-146`. -->

<!-- UPDATE 2026-09-06 (ISSUE-144 Stage 0): `AFLDB-ISSUE-144` is now ALLOCATED and Open — Club vs Club
     comparison and connected history, on branch `codex/issue-144` (worktree `D:\dev\afldb-issue-144`).
     The approved V1.6 runbook is persisted as `AFLDB-ISSUE-144.md` at the repository root and is the
     implementation contract; execution is **one stage per session** (Stage 0 through Stage 9), each
     persisting its own handoff into that file. Stage 0 is COMPLETE: the runbook is saved, both ledgers
     carry the issue, every load-bearing schema semantic was re-verified against the migrations with no
     contradiction found (`afldb_identity_for_season`, `clubs.organization_id`, `seasons.status` /
     `data_through_date`, `coverage_status` + `stat_availability.coverage`, the three Brownlow grain
     keys computed from loaded data, nullable `brownlow_season_votes.club_id`,
     `player_club_season_stats`, `matches.is_finals_series`, `club_seasons`, `player_clubs`), and the
     bundled Next.js 16.3.1 docs were checked (`searchParams` is a Promise; `force-dynamic` supported;
     `cacheComponents` not enabled). Gate `npx vitest run tests/finals-semantics-contract.test.ts` ran
     **9 passed / 1 failed**, the failure being the known Windows `autocrlf` CRLF artefact only. No
     application code, no migration, no database contact. **Next: Stage 1 — H2H core queries.** 7 -> 8
     open. Next free issue ID is `AFLDB-ISSUE-145`. -->

<!-- UPDATE 2026-09-06 (ISSUE-143 closeout): `AFLDB-ISSUE-143` is **Resolved** on branch
     `claude/issue-143` (worktree `D:\dev\afldb-issue-143`), **not merged**. The promotion contract
     can now express an intentional HISTORICAL-ONLY / recorded-gap disposition, and it is a tracked
     contract declaration rather than a flag: a `historicalOnly` entry on a `TableTreatment` names
     the environments, EVERY lineage-bound column of that table, the deciding issue and the reason,
     and one declaration drives the plan (no `pg_restore` line + a printed `INTENTIONALLY NOT
     REINSTATED` block), the truncate (unchanged — the candidate still holds nothing), the
     `candidate` compare (`zero`, not `equal`), the `restored` gate (`hist` with counts and reasons
     instead of `FAIL`, and no statement in `--lineage-remap-out`) and the `database.promoted`
     marker (`historical_only` + a recorded-gap sentence). Acceptance is per
     (table, column, environment) via the pure `judgeLineage()`; there is no CLI override, and
     `assertContractCoherent()` refuses a partial/misplaced/unbacked declaration before the first
     query. **Production declares nothing and is byte-identical.** Declared for `--environment dev`
     only: `player_link_resolutions` (ISSUE-139 D1) and `data_edits` (ISSUE-139 D2), both §7.4c
     option 2. §7.4c option 1 is deliberately NOT implemented and still refuses. Validation: 73/73
     in `tests/db-promotion-check.test.ts`, repo-wide `tsc` clean, lint clean on all three touched
     files, a DEV plan generated and read back, and read-only on the live DEV databases
     `--environment dev --phase source` **PASS (7 gates)** with `pre-cutover` at its recorded
     parity-only refusal (`data_edits` 24 rows, `player_link_resolutions` 94 confirmed live).
     No migration, no `privileges.sql` change, no database write. `AFLDB-ISSUE-139` Phase 4E is
     unblocked; it resumes on
     `npm run db:promotion:check -- --environment dev --phase source --database afldb_test` after
     this branch merges. 8 -> 7 open. Next free issue ID is `AFLDB-ISSUE-144`. -->

<!-- UPDATE 2026-09-06 (ISSUE-139 Phase 4C′): `AFLDB-ISSUE-139` resumed on merged `main` `59250a6`
     (`claude/issue-139`, read-only) and STOPPED at the §7.4c decision boundary. `db:promotion:check
     --environment dev` now PASSES `source` on `afldb_test` (7 gates) and refuses `pre-cutover` on
     `afldb_dev` on migration parity only (`UNKNOWN 079` + `PENDING 091`, both truthful) — ISSUE-142's
     expected (3a)/(3b). Lineage measured: 33 of 42 lineage-bound player ids evidenced, 9 identity-less;
     `target_id` 94/94 unresolvable by contract; `data_edits` matches 8/8 unresolvable now. Finding D: the
     `restored` gate FAILs on any unresolved row and neither §7.4c answer has an executable path —
     `AFLDB-ISSUE-143` allocated. Operator decisions D0–D3 recorded in `issues.md`. 7 -> 8 open. Next free
     issue ID is `AFLDB-ISSUE-144`. -->

<!-- UPDATE 2026-09-06 (ISSUE-142 implementation): `AFLDB-ISSUE-142` is **implemented, validated, committed and pushed** as `12a3995`, with **no migration and no privilege change**. (A) `player_match_period_stats` is decided in the
     promotion contract (`rebuilt` / `compare: zero`) rather than registered import-writable, and
     `tests/db-promotion-check.test.ts` now DERIVES the import-writable registry from the migrations and
     runs the real classifier over it, so a future 062-shaped migration fails at test time. (B) a new
     `--phase restored` gate proves the candidate's id LINEAGE from stable external identities (AFL
     Tables profile url, `matches.match_key`) instead of mere id existence: it passes silently on a
     same-lineage production promotion, refuses every unevidenced id, and writes an auditable per-row
     remap with `--lineage-remap-out`. `player_link_resolutions.target_id` carries identity `none` — no
     external key exists for an honours row — so a DEV promotion is a decided refusal with
     `docs/production-promotion.md` §7.4c's two answers printed. (C) `079_access_code_delete.sql` is
     committed only on `claude/issue-116` @ `2344ab5` (ref read from disk; the file is in no checkout),
     cannot merge at 079, and the DEV pre-cutover parity refusal is truthful and stays — the promotion
     itself is the reconciliation. `issues.md`'s open-issue count line was also synchronised (it still
     said "3 tracked here — -110, -118, -137"). Still 6 open. Next free issue ID is `AFLDB-ISSUE-143`. -->

<!-- UPDATE 2026-09-06 (ISSUE-139 Phase 4C): `AFLDB-ISSUE-139` resumed on merged `main` (`8dd96c5`)
     and STOPPED read-only before any destructive step. `db:promotion:check` refuses `source` on
     `afldb_test` and `pre-cutover` on `afldb_dev` because `player_match_period_stats` (migration 062)
     is in neither classification set — a contract gap beyond ISSUE-141, now `AFLDB-ISSUE-142` (with a
     second finding: id-keyed ledgers reinstated across a lineage change misattribute 34/36 players).
     DEV's ledger also carries the unmerged `079_access_code_delete.sql`. §7.4b settled (option 1).
     5 -> 6 open. Next free issue ID is `AFLDB-ISSUE-143`. -->

<!-- UPDATE 2026-09-06 (ISSUE-141 closeout): `AFLDB-ISSUE-141` is **Resolved**. The
     promotion contract now classifies the migration-080 Gridley trio (reinstate, FK order
     external_grid_sources 20 -> external_grids 30 -> external_grid_axes 40) so a generated
     plan can no longer drop the captured corpus, and `db:promotion:check` takes an explicit
     `--environment prod|dev` defaulting to `prod`. Verified DB-free: 52/52 in
     `tests/db-promotion-check.test.ts`, repo-wide typecheck clean, lint clean on every
     touched file, and both a prod and a dev plan generated and read back. **The work is
     uncommitted in the `main` working tree** — `AFLDB-ISSUE-139` unblocks on the merge, not
     on this status. Authoritative record: `issues.md` (Resolution, 2026-09-06). Next free
     issue ID is `AFLDB-ISSUE-142`. -->

<!-- UPDATE 2026-09-05 (ISSUE-118 REOPENED, later the same day): the closeout below stands as
     history, but its acceptance definition was too weak — 28 valid Gridley criteria were counted
     as acceptable because they were classified data_absent. Reopened with a corrected contract
     (zero unsupported valid criteria); row restored below; 2 -> 3. Runbook moved back to
     `issues/open/AFLDB-ISSUE-118.md` (§23). -->

<!-- UPDATE 2026-09-05 (ISSUE-118 closeout): `AFLDB-ISSUE-118` is **Resolved**. Merged to `main`
     (`4efdf70`), deployed to DEV (`tmEQ-3b-HBNZtkAw90Aag`) and PROD (`pEc4154P6P0QK8Hjoo5Uj`);
     the production journal confirmed digest `1511510695` = SQLSTATE 57014 (two entries,
     2026-09-03 15:49 AEST) and no recurrence after the deploy; migration `080` deliberately NOT
     applied on production (runtime does not read `external_grids`). Authoritative records:
     `issues.md` (Resolution, 2026-09-05) and `issues/closed/AFLDB-ISSUE-118.md` §22.12.
     Next free issue ID is still `AFLDB-ISSUE-138`. -->

<!-- UPDATE 2026-09-04 (ISSUE-125 closeout): `AFLDB-ISSUE-125` is **Resolved**. A rebuilt
     database is now promoted by restoring it into a NEW candidate on the production host,
     truncating every non-rebuilt table there, reinstating production-owned rows from the
     mandatory pre-cutover dump (18 tables in FK order plus `staging_aflw`; `auth_sessions`,
     `beta_login_tokens`, `promotion_decisions` reset; `player_link_match_candidates`
     regenerated; `canonical_applications`/`staging.*` taken from the rebuild), writing a
     `database.promoted` audit marker, running `privileges.sql`, and swapping by
     `ALTER DATABASE … RENAME`. `npm run db:promotion:check` (read-only, fail-closed) binds each
     phase to one database name, refuses any public table without a decided treatment, gates
     migration parity, REFUSES any reserved-domain (`*.test`, `example.*`, …) identity in any
     email-bearing table, proves the real super admin, compares counts to the pre-cutover
     snapshot and probes grants. Procedure: `docs/production-promotion.md`; contract:
     `tools/db/promotion-inventory.ts`; 37 DB-free tests. No production mutation; ISSUE-126
     and ISSUE-137 untouched. Branch `claude/issue-125`, not merged. -->

<!-- UPDATE 2026-09-04 (ISSUE-134 closeout): `AFLDB-ISSUE-134` is **Resolved**. The settle now
     publishes the season it committed to the public ISR cache, and the `404`-on-every-request
     defect the first DEV acceptance found is repaired: gate 1 requires the forwarded client
     address to RESOLVE TO LOOPBACK rather than requiring the forwarding headers to be absent,
     which Next 16 makes meaningless by synthesising both on every request. Soundness rests on
     the tracked proxy contract - both Caddyfiles overwrite `X-Forwarded-For` with
     `{remote_host}` on every proxy block and drop `X-Real-IP`/`Forwarded`, and
     `deploy/afldb.service` binds the app to `127.0.0.1` - and that contract is now asserted
     statically so it cannot drift. Accepted on the real host: correct-secret loopback POST 200,
     non-loopback/chained/malformed 404, wrong secret 401, four distinct worker ordinals reached
     on fresh connections, `/seasons/2026` regenerated inside its hour against a control, and a
     spoofed `X-Forwarded-For: 127.0.0.1` WITH the correct secret still refused through the real
     Caddy proxy. Two real settle runs were 0/0 and published nothing. Branch
     `claude/issue-134` is pushed but **NOT merged and NOT deployed to PROD** - that is the
     operator's call. DEV was restored to `main` @ `169d738`. Evidence:
     `issues/closed/AFLDB-ISSUE-134.md` §11-§12. -->

<!-- UPDATE 2026-09-04 (ISSUE-127 closeout): `AFLDB-ISSUE-127` is **Resolved** — operator host
     validation completed on dev (`streamanator`, deployed revision `169d738`). The polkit grant
     was exercised as `arm` over a non-interactive session: `start` on
     `afldb-settle-afltables.service` allowed, `stop` on the same unit and `start` on
     `afldb.service` both refused. Three Super Admin attempts wrote audit rows 636/637/638
     (`started`, `started`, `already-running`) for two ingestion transactions (batches 91, 92);
     panel counters matched `import_batches` field for field; the control was inert with
     `AFLDB_SETTLE_TRIGGER` unset. Two deviations recorded (dev sudo needs a password, so the
     grant was proved as `arm` directly and `afldb` restarted via `kill MainPID`; and the
     "second press" check needs a stale second tab because `SettleRunPanel.tsx:183` disables the
     button once the unit reads `running`). **No repository code, test, unit-file, migration or
     `privileges.sql` change**, no `CHANGELOG.md` change (the feature's entry already shipped on
     2026-09-03), and **no production command of any kind** — production installation is the two
     ordinary `docs/deployment.md` §7b host steps, not outstanding issue work. Dev's nightly
     settle timer was never installed and still is not; no cadence was created or altered.
     Removed from this index and the `issues.md` Open Issues table; its number stays allocated;
     it claims **no migration number** (`086` still next free). Committed on `codex/issue-127`,
     not merged. Authoritative records: the `AFLDB-ISSUE-127` entry in `issues.md` (Resolution —
     2026-09-04) and `issues/closed/AFLDB-ISSUE-127.md` §13.
     **Next free issue ID is still `AFLDB-ISSUE-138`.** -->

<!-- UPDATE 2026-09-04 (ISSUE-113 closeout): `AFLDB-ISSUE-113` is **Resolved** — tracked
     Brownlow season artefact + fail-closed loader + `brownlow-season` rebuild stage; V1-V13
     green on the canonical `db:test:rebuild` with the ISSUE-136 fold
     (`issues/closed/AFLDB-ISSUE-113.md` §8.18); committed on `claude/issue-113`, not merged,
     not deployed. Production still shows the empty-season-table symptom; its remediation is
     sequenced under `AFLDB-ISSUE-137` (repair the four splits first, then load the artefact). -->

<!-- UPDATE 2026-09-04 (ISSUE-136 closeout): `AFLDB-ISSUE-136` is **Resolved** — canonical
     `db:test:rebuild` and the ISSUE-113 V5 witness are green on the shared `afldb_test`
     (`issues/closed/AFLDB-ISSUE-136.md` §13); committed on `claude/issue-136`, not merged, not
     deployed. `AFLDB-ISSUE-137` is now ALLOCATED and Open (production still holds the four
     split canonical players; not started; no production mutation authorised). Neither claims a
     migration number (`086` still next free). `AFLDB-ISSUE-135` is ALLOCATED on branch
     `claude/issue-135` (worktree `D:\dev\afldb-issue-135`, uncommitted there, subject not
     visible from this branch) and is NOT free; its own branch adds its row.
     **Next free issue ID is `AFLDB-ISSUE-138`.** -->

<!-- UPDATE 2026-09-04 (ISSUE-131 closeout): `AFLDB-ISSUE-131` is **Resolved** — runbook §8's
     production acceptance is reconstructed and accepted from persisted production evidence
     (`issues/closed/AFLDB-ISSUE-131.md` §16). Removed from this index and the `issues.md` Open
     Issues table; its number stays allocated; it claims **NO migration number** (`086` still next
     free) because §7's optional hardening index was never measured (§9.4) and is not adopted.
     Committed on `claude/issue-131`, not merged. No application, test, migration, deployment or
     `CHANGELOG.md` change in the closeout, and no write on any environment.
     **Next free issue ID is still `AFLDB-ISSUE-138`.** -->


<!-- ALLOCATION WARNING 2026-09-01: `AFLDB-ISSUE-118` is allocated and is NOT free.
     It belongs to the Gridley compatibility-corpus project on branch `opus/gridley-corpus`,
     which has committed Stage 0/1/2 under that ID. The NL-search telemetry issue below was
     renumbered 118 -> 119 on 2026-09-01 because its claim was still uncommitted; see
     `issues/closed/AFLDB-ISSUE-119.md` §0. Next free issue ID is `AFLDB-ISSUE-121`.
     NOTE: the branch and worktree have since been renamed to `codex/issue-119` /
     `D:\dev\afldb-issue-119`, so the ID now matches; runbook §21.1/§22.1/§23.1 record the
     former `codex/issue-118` name and are accurate as of their dates.
     MIGRATION NUMBERS 2026-09-01: `080_external_grids.sql` belongs to `opus/gridley-corpus`;
     `081_nl_search_telemetry_clear.sql` is allocated to `AFLDB-ISSUE-119`, committed on
     `codex/issue-119`, applied to `afldb_test` and now validated end to end there.
     UPDATE 2026-09-01: `082_auth_audit_log_jsonb_repair.sql` is committed on `dev` (`54c7a31`) and
     APPLIED to `afldb_test` and `afldb_dev`; it is NOT yet applied to production (ships with or
     after the code fix, never before it). `AFLDB-ISSUE-121` is **Resolved 2026-09-01** and is no
     longer an open issue; its number stays allocated.
     UPDATE 2026-09-02: `AFLDB-ISSUE-122` is now ALLOCATED and Open (automatic current-season AFL
     Tables canonical ingestion; planning complete, nothing implemented). **Next free issue ID is
     `AFLDB-ISSUE-123`.** ISSUE-122 will claim a migration number at implementation time and its
     runbook §12.1/§15.2 REQUIRE a live-branch scan first — `083` is the next free number visible
     from this worktree but is NOT reserved, and `080_external_grids.sql` belongs to
     `opus/gridley-corpus`. `claude/issue-116` must re-scan every live branch tip and derive its
     own number immediately before renumbering its competing `079_access_code_delete.sql`.
     UPDATE 2026-09-02 (later): ISSUE-122 S1 re-scanned 49 tips (083 still free) and CLAIMED
     `083_canonical_auto_apply.sql` on `claude/issue-122`; it is applied to `afldb_test` only and
     is UNCOMMITTED until the operator commits S1, so other branches cannot yet see it. Any other
     branch needing a number must treat `083` as taken and derive `084` or later.
     UPDATE 2026-09-03 (ISSUE-122 closeout): `AFLDB-ISSUE-122` is **Resolved 2026-09-03** and is
     no longer an open issue; its number stays allocated. `083_canonical_auto_apply.sql` is
     COMMITTED and merged to `main` (merge `250caa2`) and is APPLIED TO PRODUCTION — production
     is at `083` with 0 pending — so `083` is now visible to every branch and is definitively
     taken. Four follow-ups were allocated out of that closeout: `AFLDB-ISSUE-123`,
     `AFLDB-ISSUE-124`, `AFLDB-ISSUE-125` and `AFLDB-ISSUE-126`, all Open and none implemented.
     UPDATE 2026-09-03: `AFLDB-ISSUE-127` is now ALLOCATED and Open (Super Admin on-demand AFL
     Tables current-season refresh), implemented on branch `codex/issue-127` in worktree
     `D:\dev\afldb-issue-127`. **Next free issue ID is `AFLDB-ISSUE-128`.** None of 123-127
     claims a migration number — ISSUE-127 adds no schema at all; `084` is the next number
     visible from this worktree but is NOT reserved, and any branch needing one must still
     re-scan every live branch tip before claiming it.
     UPDATE 2026-09-03 (later): `AFLDB-ISSUE-128` and `AFLDB-ISSUE-129` are now ALLOCATED and
     Open, both implemented/raised on branch `codex/issue-127` in worktree
     `D:\dev\afldb-issue-127` alongside ISSUE-127. **Next free issue ID is
     `AFLDB-ISSUE-130`.** `AFLDB-ISSUE-128` claims NO migration number (no schema change).
     `AFLDB-ISSUE-129` **WILL need one and has NOT claimed it** — it must re-scan every live
     branch tip first; `084` is the next number visible from this worktree but is NOT
     reserved.
     UPDATE 2026-09-03 (ISSUE-128 closeout): `AFLDB-ISSUE-128` is **Resolved 2026-09-03** and is
     no longer an open issue; its number stays allocated and it still claims NO migration number.
     **Next free issue ID is still `AFLDB-ISSUE-130`.**
     UPDATE 2026-09-03 (ISSUE-129 closeout): `AFLDB-ISSUE-129` is **Resolved 2026-09-03** and is no
     longer an open issue; its number stays allocated. It **CLAIMED, WROTE AND COMMITTED TWO
     MIGRATION NUMBERS** - `084_round_type_wildcard_final.sql` and
     `085_matches_is_finals_series.sql`, committed on `opus/issue-129` at `b1d4085` after a scan of
     all 54 references and 5 sibling worktrees. Both are APPLIED TO `afldb_test` ONLY - **not**
     `afldb_dev` and **not** production, which is still at `083`. **`084` and `085` are definitively
     taken; the next free migration number is `086`, and any branch needing one must still re-scan
     every live branch tip.** **Next free issue ID is `AFLDB-ISSUE-130`.**
     UPDATE 2026-09-03 (ISSUE-130 Stage 1): `AFLDB-ISSUE-130` is now ALLOCATED and Open (the settle
     service's R library dependency is undeclared and unvalidated), Stage 1 investigation/design only
     on branch `claude/issue-130` in worktree `D:\dev\afldb-issue-130`. UPDATE (Stage 2, same day):
     implemented on that branch (two new `deploy/afldb-r-*.sh` files, settle script, docs, tests);
     awaiting dev-host validation before closure. UPDATE (closeout, same day): `AFLDB-ISSUE-130` is
     **Resolved 2026-09-03** on `claude/issue-130` and is no longer an open issue; its number stays
     allocated. Dev host validated (supervised settle COMPLETE with the drop-in absent), production
     inspected read-only and **already compliant** (fitzRoy 1.8.0 in `/usr/local/lib/R/site-library`,
     no drop-in) — no production reconciliation required. **Not merged to `main`, not deployed.**
     Deployment gate: after the normal controlled production deploy, `sh deploy/afldb-r-preflight.sh`
     on `afldb-prod` must end `R PREFLIGHT: OK` before the settle timer runs on the new code
     (`issues/closed/AFLDB-ISSUE-130.md` §12.5).
     It claims **NO migration number** (no schema change), so the next free migration number is still
     `086`. **Next free issue ID is `AFLDB-ISSUE-131`.**
     UPDATE 2026-09-03 (ISSUE-131 Stage 1, amended after Stage 2): `AFLDB-ISSUE-131` is now ALLOCATED and Open (an upstream
     match rekey duplicates the canonical match instead of updating it), on branch
     `claude/issue-131` in worktree `D:\dev\afldb-issue-131`. Stage 1 was
     investigation/design/RED-reproduction only; **Stage 2 (2026-09-03) implemented and
     validated the fix and the §8 repair tool on `afldb_test`, is UNMERGED, and touched no
     production database — `afldb-settle-afltables.timer` remains STOPPED.** It claims **NO
     migration number** — the identity fix needs no schema change, which Stage 2 confirmed. One OPTIONAL
     hardening index (a UNIQUE on `(season, match_date, home_club_id, away_club_id)`) is proposed and
     is **gated on measuring the full canonical history first** (runbook §7/§9.4); it is NOT adopted
     and NOT reserved, so the next free migration number is still `086` and any branch needing one
     must re-scan every live branch tip. Also synchronised in this pass: `issues.md`'s open-issue
     count line still listed the resolved `AFLDB-ISSUE-130` and now does not.
     **Next free issue ID is `AFLDB-ISSUE-132`.**
     UPDATE 2026-09-03 (ISSUE-132 Stage 1): `AFLDB-ISSUE-132` is now ALLOCATED and Open (Wildcard
     Final visibility on the public and admin UI — the rendered-surface follow-up ISSUE-129
     deferred), on branch `claude/issue-132` in worktree `D:\dev\afldb-issue-132`. Stage 1 is
     inspection/plan only (no defect found; Stage 2 is regression tests). It claims **NO
     migration number**, so the next free migration number is still `086`.
     **Next free issue ID is `AFLDB-ISSUE-133`.**
     UPDATE 2026-09-03 (ISSUE-132 closeout): `AFLDB-ISSUE-132` is **Resolved** — no application
     change; regression tests only (T1-T6/T6b GREEN, `tsc` GREEN, one pre-existing ISSUE-129
     Windows CRLF test artefact dispositioned by the operator). Removed from this index; its
     number stays allocated; it claimed NO migration number, so `086` is still the next free
     migration. **Uncommitted on `claude/issue-132`.** A SEPARATE, NOT-started investigation is
     handed off in `issues/closed/AFLDB-ISSUE-132.md` §11 and the ISSUE-132 ledger Follow-up:
     production holds two canonical 2026 Wildcard Final matches that the observed public season
     UI did not show, although the repository's query/render paths and tests support them.
     Allocate `AFLDB-ISSUE-133` for it when it opens.
     **Next free issue ID is still `AFLDB-ISSUE-133`.**
     UPDATE 2026-09-03 (ISSUE-133 investigation stage): `AFLDB-ISSUE-133` is now ALLOCATED and
     Open (production season page did not show the two 2026 Wildcard Finals), on branch
     `claude/issue-133` in worktree `D:\dev\afldb-issue-133`. Investigation complete and
     CLASSIFIED as stale ISR cache output — deployed revision, migrations, data and query path
     all correct; the deploy prerendered `/seasons/2026` 23 minutes before the settle inserted
     the rows and the route's `revalidate = 3600` window served that prerender. Runbook
     `issues/open/AFLDB-ISSUE-133.md`. No code, migration or production change; it claims NO
     migration number (`086` still next free). **Uncommitted on `claude/issue-133`.**
     **Next free issue ID is `AFLDB-ISSUE-134`.**
     UPDATE 2026-09-03 (ISSUE-133 closeout): `AFLDB-ISSUE-133` is **Resolved** — stale ISR cache
     output caused by build-before-settle ordering plus the one-hour revalidation window; the
     operator's read-only production verification showed the on-disk `/seasons/2026` entry
     regenerated at 23:50:48 AEST with the Wildcard Final block and the live page rendering both
     matches. **No application fix was made.** Removed from this index; its number stays
     allocated; it claimed NO migration number (`086` still next free); runbook moved to
     `issues/closed/AFLDB-ISSUE-133.md`. `AFLDB-ISSUE-134` is now ALLOCATED and Open
     (current-season settle should invalidate/revalidate affected public season ISR — the
     ISSUE-133 §11.4 handoff; NOT started, no branch, no worktree). It claims NO migration
     number. The ISSUE-131 row below carries a dated bookkeeping correction (merged, deployed,
     timer active; §8 acceptance evidence unrecorded); ISSUE-131 stays Open.
     **Uncommitted on `claude/issue-133`.**
     UPDATE 2026-09-04 (ISSUE-113 validation): `AFLDB-ISSUE-135` is ALLOCATED on `claude/issue-135`
     (worktree `D:\dev\afldb-issue-135`, not yet on `main`) and `AFLDB-ISSUE-136` is allocated here on
     `claude/issue-113`. **Next free issue ID is `AFLDB-ISSUE-137`.**
     UPDATE 2026-09-04 (ISSUE-124 closeout): `AFLDB-ISSUE-124` is **Resolved 2026-09-04** and is no
     longer an open issue, superseding the 2026-09-03 line above that listed it as Open and
     unimplemented; its number stays allocated and it claims **NO migration number** - `086` is
     still the next free one. The fix is a `deploy/afldb.service` section move only: no migration,
     schema, `privileges.sql`, `.env`, timer, polkit or database change. Of the four ISSUE-122
     follow-ups, `AFLDB-ISSUE-123`, `-125` and `-126` remain Open and unimplemented. Committed on
     `claude/issue-124`, **not merged**. -->

<!-- The former "`AFLDB-ISSUE-110` is allocated and is NOT free" merge warning is retired:
     the ISSUE-110 branch merged into dev on 2026-08-31 and its own row below is now
     authoritative. -->

## How Claude should use this file

- Read this file once near the start of technical AFLDB work.
- Use it to identify overlap with a known open issue.
- If an issue is relevant, read only that exact detailed entry from `issues.md`.
- Do not read all of `issues.md` just to understand current project problems.
- When an issue is created, reopened, resolved, materially reclassified, or
  given a materially different next action, update this file in the same task.
- Keep this file synchronized with the Open Issues table at the top of
  `issues.md`.

## Open issues at a glance

| Issue | Severity | Area | Current state |
|---|---|---|---|
<!-- RETIRED 2026-09-01 — `AFLDB-ISSUE-119` is **Resolved** and is NO LONGER an
     open issue. Final guarded Playwright acceptance passed 9/9 against the
     disposable loopback `afldb_test` deployment. Authoritative records:
     `issues.md` (Resolution, 2026-09-01) and
     `issues/closed/AFLDB-ISSUE-119.md` §34. -->
<!-- RETIRED 2026-08-30 — `AFLDB-ISSUE-107` is **Resolved** and is NO LONGER an open issue.
     Its pre-resolution row and detail block are retired below; their "Only open gate" and
     "Exact next action" text is SUPERSEDED. Authoritative records: the `AFLDB-ISSUE-107`
     entry in `issues.md` (Resolution, 2026-08-30) and `issues/closed/AFLDB-ISSUE-107.md` "Gates".
     Final gate state: G0/G1/G2/G3/G4 PASS; G5 (production eligibility) is out of ISSUE-107's
     scope by design and is NOT a completion condition. G2 closed when `AFLDB-ISSUE-108`
     validated green on Linux at commit 673f0e3 (89 passed / 5 skipped files, 2,515 passed /
     104 skipped tests, 0 failures, 122.21 s). Production rollout is separate work under its
     own review and is NOT authorised by this resolution. -->
<!-- RETIRED 2026-08-30 — `AFLDB-ISSUE-108` is **Resolved** and is NO LONGER an open issue.
     Do not read the row below as current: it is the pre-resolution index row, kept only as
     lineage, and its "Open" / "awaiting serial re-run" / "Next" text is SUPERSEDED.
     Authoritative records: the `AFLDB-ISSUE-108` entry in `issues.md` (Resolved, 2026-08-30)
     and `issues/closed/AFLDB-ISSUE-108.md` §12. Final validation, Linux, exact commit 673f0e3, Node
     v22.23.2 / npm 10.9.8, `npm test -- --no-file-parallelism`: 89 passed / 5 skipped test
     files (94), 2,515 passed / 104 skipped tests, 0 failures, 122.21 s. `afldb_test` was NOT
     rebuilt and was never stale — it matched the accepted canonical baseline
     `full-history-20260827`. Every residual is a deliberate skip with an owning issue
     (`AFLDB-ISSUE-090` §27.5 Brownlow, DraftGuru Stage B3, `AFLDB-ISSUE-099` 2026 provisional,
     retired DOB adjudication, the gitignored DraftGuru CSV oracle, and the restricted
     `afldb_import`-role parity cases). Non-blocking follow-up carried forward, NOT reopening
     this issue: `tools/validation/validate_migration.py` and `tests/fixtures/oracle_baseline.json`
     are still bound to the retired legacy dataset. This closure set `AFLDB-ISSUE-107` G2 to PASS.
     The pre-resolution index row is DELETED, not merely commented out, so ISSUE-108 cannot
     render as an open row under any renderer. Its full pre-resolution text is preserved in
     `issues/closed/AFLDB-ISSUE-108.md` §9 and in the `AFLDB-ISSUE-108` entry in `issues.md`. -->

<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-090` is **Resolved** and is NO LONGER an open issue.
     Do not read the commented-out row below as current: it is the pre-resolution index row,
     kept only as lineage, and its "Next action" text is SUPERSEDED. Authoritative records:
     the `AFLDB-ISSUE-090` entry in `issues.md` (Resolution, 2026-08-28) and
     `issues/closed/AFLDB-ISSUE-090.md` §27. Final evidence: DOB reconciliation suite 27/27, the canonical
     external-identity release assertion 1/1 (pin 13,275), privileges 24/24 with no grant
     widened. NOTE: the full `release-gates.test.ts` suite is NOT green — Gate 1 was 42
     passed / 22 failed on 2026-08-28 and the 16 unrelated failures stay with
     `AFLDB-ISSUE-095`, `AFLDB-ISSUE-093`/DraftGuru B3, `AFLDB-ISSUE-096`/`-098`/`-099` and
     rebuild-baseline drift. Two unowned observations are carried at `issues/closed/AFLDB-ISSUE-090.md`
     §27.5: no legacy-free writer for `brownlow_season_votes`, and no writer at all for
     `unlinked_player_with_games` backlog issues. Neither was converted to an issue here.

| `AFLDB-ISSUE-090` | Medium | Data integrity / Import | Club-list DOB enrichment stacked duplicate unresolved `dob_conflict` rows on rerun and the register pass deleted conflicts it did not own. **Reconciliation contract IMPLEMENTED and PROVEN**: migration 072 applied, focused suite 27/27, and the global duplicate-issue invariant in `release-gates.test.ts` is **GREEN**. **Gate 1 run 2026-08-28** — 64 tests / 42 passed / 22 failed, all classified (handoff §11.3). Owned repair made: external-identity pin `12_472` → `13_275` (test-baseline repair from the canonical rebuild; live 13,275 = `measured.players` = `distinct_urls`, `missing_url` 0). The five `gate: birth dates` population assertions are **RETIRED as acceptance** — the canonical rebuild runs neither enrichment pass, 855 DOBs is the accepted baseline's contracted figure, the register pass needs `AFLDB_LEGACY_SQLITE` plus a `legacy_player_id` nothing writes, and the club-list CSVs are gitignored/absent. Revised standard: `issues/closed/AFLDB-ISSUE-090.md` §27.4. **Next action: run `privileges.test.ts` (Gate 2) — no grant widened.** Other 16 failures owned by ISSUE-095 / ISSUE-093-B3 / ISSUE-096-098-099 / rebuild drift; untouched. |
-->

<!-- Open issues continue. The header is repeated because the retired ISSUE-090 row
     above interrupts the table. -->

| Issue | Severity | Area | Current state |
|---|---|---|---|
<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-095` is **Resolved** and is NO LONGER an open
     issue. The row below is the pre-resolution index row, kept only as lineage; its
     "next action" text is SUPERSEDED. Authoritative records: the `AFLDB-ISSUE-095`
     entry in `issues.md` (Resolution, 2026-08-28) and `issues/closed/AFLDB-ISSUE-095.md` §14.
     Final evidence: clean afldb_test rebuild passed, 1,622-row ladder witness
     comparison agreed on every field, final validation 19/19, release gates 45/64
     with all nine club-organization/identity gates green. No migration (75/75), no
     privilege widened. The 19 remaining gate failures are owned by Brownlow
     acquisition, DraftGuru B3, DOB enrichment, the attendance baseline and the
     current-season 2026 pipeline — NOT by this issue.

| `AFLDB-ISSUE-095` | Medium | Data acquisition / Import architecture / Data integrity | `club_seasons` has no canonical, legacy-free acquisition path — `rebuild_derived.py` builds it only from `staging.team_seasons`, whose sole writer is `import_legacy_afl.py` under `AFLDB_LEGACY_SQLITE`. A clean canonical rebuild therefore correctly yields `club_seasons = 0`. **D1–D7 approved and IMPLEMENTED 2026-08-28** (`issues/closed/AFLDB-ISSUE-095.md` §10 decisions, §11 record). The pinned fitzRoy `fetch_ladder_afltables` was deparsed and **computes** its ladder from results under a uniform 4/2/0 rule, so it is adopted as a **validation witness only**; every `club_seasons` column is now derived from canonical `matches` under a declared rule, `ladder_rank` fails closed to NULL on an exact tie (audited: zero ties in 1,622 rows), provenance moved `sports_data_lab` → `afltables`, and a **fail-open** `North Melbourne` 1999–2007 identity gap was closed. Six Stage-9 gates added; nine-stage topology unchanged; no migration. Resolver proof 37/37 DB-free. **Not resolved** — vitest suites unrun (worktree has no `node_modules`), ladder acquisition and clean rebuild outstanding. |
-->
<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-096` is **Resolved** (complete within its authorised S1–S4
     scope) and is NO LONGER an open issue. Do not read the commented-out row below as current:
     it is the pre-resolution index row, kept only as lineage, and its intermediate "UNAPPLIED",
     "BLOCKED" and "next action" text is SUPERSEDED. Authoritative records: the `AFLDB-ISSUE-096`
     entry in `issues.md` and `issues/closed/AFLDB-ISSUE-096.md` §16.16–§16.17. Final evidence: source contract
     106/106, spine suite 13/13, FK gate 2/2, privileges 24/24, migrations 75/75 with 074 before
     075, fingerprint `c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`.
     Downstream work stays with `AFLDB-ISSUE-086` (manual authority), `AFLDB-ISSUE-099`
     (the `data_issues` disagreement row) and `AFLDB-ISSUE-101` (rollover supersession).

| `AFLDB-ISSUE-096` | Medium | Data acquisition / Import architecture | Parent architecture/contract issue for 2026+ API-first acquisition. **HALT LIFTED 2026-08-28** — decisions A–H and §12 approved (`issues/closed/AFLDB-ISSUE-096.md` §14); now foundation implementation S1–S4, still **no family-specific importer**. Evidence baseline: P3/P4/P5/P6 PASS; **P1/P2 RE-RUN 2026-08-28 with the supplied Kali key — both PASS**; P7 still BLOCKED. **P1 falsified an approved S1 declaration**: Kali `/matches` is NOT a Squiggle proxy, so Squiggle+Kali are now TWO match witnesses (`/fixture` stays a proven proxy). **S1 IMPLEMENTED + AMENDED** (GREEN 34/34); **S2 COMPLETE and GREEN 2026-08-28 — final post-hygiene run 61/61, 0 failures, 303 ms** (first run 59/61; the two red source-contract assertions were **confirmed false positives** — both `[^;]*` regexes spanned the migration's own explanatory comments — and the **tests** were repaired to inspect executable SQL statements; migration unchanged, append-only and A→B→A invariants intact). §16.4 hygiene fixed: the NUL bytes in `observations.ts:499` are now source escapes (same character, keys byte-identical — the proposed space separator was **rejected** as semantics-changing and ambiguity-permitting) and the stale "migration 073" header reads 074. Migration **074** (073 is ISSUE-086's `data_overrides`) **UNAPPLIED**; no CHANGELOG entry required at this checkpoint. **S3 COMPLETE and GREEN 2026-08-28 — `84/84`, 0 failures, 316 ms** — `src/lib/acquisition/reconciliation.ts` computes Decision C's ten verbs from a live payload against the stored open version with an exported precedence, reusing S2's ownership predicate and authority boundary; foreign **and unreadable** ownership fail closed before authority is asked, agreement never substitutes for authority, and a payload change moving no projected fact field returns the verb-less `history_only` outcome (settled, not an eleventh verb). **S4 IMPLEMENTED 2026-08-28 and AWAITING VALIDATION (§16.10)** — new pure `src/lib/acquisition/promotion-review.ts` carries the review contract: the candidate record with 074's CHECKs enforced in TypeScript, a `baselineCanonicalHash` over **exactly the proposed fields** (ordering-independent, null for a `new` target), `renderReviewItem`, `evaluateAcceptRequest`, the requeue-vs-supersede rule, and reject/requeue decision drafts; render and accept both recompute the baseline from re-read values and then delegate to **S2's `evaluateAcceptance`**, so its gate order and the `stale_review`/`stale_canonical_target` distinction are unchanged. `observations.ts` gained one additive, behaviour-preserving export (`canonicalJson`) so canonical values are never hashed under a family's *payload* exclusions. **§7's gate is intact by construction:** no `'accept'` decision is representable, a cleared evaluation still returns `write.implemented: false`, and `UNAVAILABLE_MANUAL_AUTHORITY` refuses every promotable verb including `new`. **S4 COMPLETE and GREEN 2026-08-28 — `105/105`, 0 failures, 357 ms** on the final post-hygiene run, user-run: the promotion-review contract renders the approved candidate evidence, hashes a baseline over **exactly** the proposed/touched fields (deterministic, ordering-independent; unrelated canonical changes do not stale a review, proposed-field changes do), keeps moved source evidence and a moved canonical baseline as **distinct** stale outcomes, re-runs every acceptance gate fail-closed (provider agreement never substitutes for authority; foreign and unreadable ownership refuse; authority conflict and indeterminate/unavailable refuse; season ownership enforced), rejects without mutating canonical facts or observations, and exposes no force/override/bypass/consensus path. **The canonical acceptance/write transaction is deliberately NOT implemented** — the write, provenance quartet and real `accept` decision row stay blocked behind ISSUE-086's authority contract, `PromotionDecisionDraft` cannot represent an acceptance, and a fully cleared gate still reports the write as unimplemented. NUL hygiene RESOLVED (user-performed byte repair, verified). Migration 074 UNAPPLIED; no production/`afldb_dev` work; **no approved S5 exists** — §11 stops at S4. `AFLDB-ISSUE-100` remains separate and does not block this checkpoint. **PostgreSQL validation phase HALTED AT PREFLIGHT 2026-08-28 and BLOCKED (§16.13):** `npx tsx tools/db/migrate.ts --status --target test` proved the target is `afldb_test` (73 of 74 applied) and then **refused** because applied migration `073_data_overrides.sql` (**ISSUE-086's**) fails the checksum guard. 074 was **NOT applied and NOT modified**; no database was written; S1–S4 stay green. Line-ending and algorithm causes are eliminated (ISSUE-091's three-representation tolerance; 72 rows validated in the same pass); Git shows **one committed 073 blob only** (`a8ad3079…`, in `2a068a8`/`e0d64aa`), clean worktree, no stashes — so **no committed revision matches the applied artefact** and `dev` holds **no** invalid mutation of an applied migration. **CONFIRMED by the ledger:** stored `47937827…`, committed canonical-LF `778c5bfb…`, applied `2026-08-28 01:54:41.063665+10` — **1 h 1 min 48 s before** the sole committed revision existed (`2026-08-28 02:56:29+10`), so an **uncommitted intermediate** version was migrated and then changed before commit. **Repair owned by `AFLDB-ISSUE-086`** (database-ledger coherence, not history surgery); **a later corrective migration cannot fix it alone** — the runner validates applied checksums before running anything, so the baseline must be made coherent first, and `afldb_test` must **not** be rebuilt from this worktree while pending 074 lacks its §16.14 FK indexes. **074 has NOT failed — it was never executed.** **BLOCKER RESOLVED 2026-08-28:** ISSUE-086 rebuilt `afldb_test` cleanly through the committed 073 — **73/73 applied, 0 pending, no drift** — so the **PostgreSQL validation phase may resume**. The structural pre-application review's **three missing FK-covering indexes** are now **repaired in 074 itself before first application** (§16.14): `ix_promotion_candidates_evidence`, `ix_promotion_candidates_decision`, `ix_promotion_decisions_admin`. **074 remains UNAPPLIED** pending DB-free source-contract validation of that repair, **075 (ISSUE-086) also remains unapplied**, and application must be normal filename order — **074 then 075**. **No DB-backed FK validation is green yet** — `tests/integration/fk-indexes.test.ts` is untouched and cannot run against 074 until 074 is applied. **PHASE RESUMED AND SCHEMA GATE GREEN 2026-08-28 (§16.16):** 074 then 075 applied to `afldb_test` only, **75/75, 0 pending, no drift**, privileges reconciled, FK gate **2/2**, fingerprint `c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`. `src/lib/acquisition/` still has **no persistence layer**, so new suite `tests/integration/observation-spine.test.ts` proves the **schema half** of §5.H only — real `decideObservation`/`sweepAbsences` decisions applied to `afldb_test`, each head read back out of PostgreSQL, all inside an always-rolled-back transaction on a synthetic `sources` row. Refreshed matrix: **2 executable** (A→B→A; absence ≠ deletion), **3 partial** (idempotence; foreign ownership; stale-review race), **3 BLOCKED** — manual authority (ISSUE-086), the `data_issues` row (never implemented), rollover supersession (ISSUE-101, no supersession column in 074). **No canonical acceptance/write path added**; blocked rows have no test rather than a fake one. **VALIDATION GREEN 2026-08-28, user-run: source contract `106/106`, FK catalogue gate `2/2`, spine suite `13/13`.** The one first-run failure was a fixture defect (`seasons.is_complete` is generated from `status` since migration 015) that aborted ten cases in shared setup before their bodies ran; seed corrected to `status = 'in_progress'`, no behavioural assertion changed, rerun 13/13. **13/13 proves the implemented PostgreSQL/schema half of §5.H only** — the three partial rows stay partial and the three blocked rows stay blocked. |
-->

<!-- Open issues continue. The header is repeated below because the retired ISSUE-096 row
     above and the retired ISSUE-099 row that follows both interrupt the table. -->

<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-099` is Resolved (T1-T8 complete, validated end-to-end
     on real 2026 data) and is NO LONGER an open issue. Do not read the commented-out row
     below as current: it is the pre-implementation index row, kept only as lineage, and its
     "nothing implemented" / "start at T1" text is SUPERSEDED. Authoritative records: the
     `AFLDB-ISSUE-099` entry in `issues.md` and `issues/closed/AFLDB-ISSUE-099.md` "T8 — COMPLETE".
     Final evidence: `current-season-import` 172/172; `settle-afltables` integration 20/20
     with zero skips (incl. restricted `afldb_import` role parity); typecheck at the 13-error
     unrelated baseline with zero ISSUE-099 errors; ESLint silent; real 2026 acquisition
     207 matches / 9522 player rows / 0 missing profile URLs; clean apply (batch 90) then
     idempotent rerun (batch 91) with ZERO canonical rows written. Migration 076 is applied
     and checksum-frozen - never edit it. Carried out as separate open work below:
     `AFLDB-ISSUE-104`, `AFLDB-ISSUE-105`, `AFLDB-ISSUE-106`. Downstream: `AFLDB-ISSUE-101`.

| `AFLDB-ISSUE-099` | Medium | Data acquisition / Import architecture | 2026 has no player stats, period scores, attendance or Brownlow votes. Nightly in-season AFL Tables settle pass. **Planning COMPLETE 2026-08-28 — approved contract at `issues/closed/AFLDB-ISSUE-099.md`; nothing implemented. P5 PASSED, stop condition NOT triggered — no longer probe-blocked.** v1 stops at candidates + `data_issues`: **zero canonical writes.** Next action: fresh Opus/High/Normal session, carry-over `issues/closed/AFLDB-ISSUE-099.md`, start at T1. |
-->

| Issue | Severity | Area | Current state |
|---|---|---|---|
<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-100` is **Resolved** and is NO LONGER an open
     issue. Implemented and validated end-to-end against the real 2026 R20/R25 source;
     migration 077 applied and checksum-frozen. Retained as lineage only — its
     "next action" text is SUPERSEDED. See `issues.md` for the resolution record.
| `AFLDB-ISSUE-100` | Medium | Data acquisition / Import architecture | Staging-only lineup/team-announcement domain fed by `fetch_lineup_afl`. **Never canonical participation.** **P3 (identity) and P3b (shape/types/NULLs/completeness) both PASS** — no longer probe-blocked; the R20-only column is `lateChanges` and the set is complete at 20. **L1–L3B2 COMPLETE and GREEN 2026-08-29.** Source-family contract, bounded acquisition (`tools/rebuild/afl_api/`), deterministic observation bundle (`lineup-bundle.ts`), **migration 077 applied and checksum-frozen** to `afldb_test`, and persistence (`lineup-store.ts`) through the **074 spine** into the typed `staging.afl_api_lineup`. Durable family-local contracts: `external_record_id` = `providerId\|teamId\|player.playerId` (delimiter-refusing), `scope_key` = `season=YYYY;round=NN`, enumeration `complete:false` permanently. Binding and proved: `source_id` resolved internally from literal `'afl_api'`; unresolved `match_id`/`club_id`/`player_id` stay **NULL** and the row still persists; **no absence sweep**; **no DELETE/TRUNCATE path** (keyed upsert only); **no canonical participation write**; `player.captain` raw evidence but **not projected** (572/572 `FALSE` sentinel); `lateChanges` **verbatim, never parsed**; no closed enum CHECKs; `required_columns` stays at five. Owner **16/16 + 11/11** and **restricted `afldb_import` parity green**. Next: **bounded real R20/R25 persistence validation**, then close-out. |
-->
<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-101` is **Resolved** and is NO LONGER an open issue.
     Resolved for the **reusable mechanism only**: an explicit, fail-closed rollover planner +
     dry-run-by-default CLI, with the fitzRoy full-history, accepted-baseline and offline
     ladder-witness authorities all EXECUTED against a temporary successor state before any
     tracked write. `measured` and `identity_scan` are derived from validator execution;
     `--identity-scan` no longer exists. **No season was rolled** — the real boundary is
     unchanged (accepted through 2025, `seasons.json` 2026 / `in_progress [2026]`), no
     migration was added (077 remains the highest, untouched), and no canonical row is
     written. Only `validate_ladder_witness.py --compare` remains post-rebuild, because it
     requires the rebuilt database. Actual 2026 -> 2027 execution is **intentionally deferred**
     until the season is formally complete and genuine completed-season evidence (a real
     full-history candidate `1897..Y` plus a matching ladder witness) exists; it must not be
     manufactured. Final evidence: `tests/season-rollover.test.ts` 131/131;
     broader regression 5/5 suites, 472 passed, 6 existing skips;
     `tests/python/ladder_identity_contract.py` all executable checks passed (acquired witness
     bytes skipped — gitignored by design). Authoritative record: the `AFLDB-ISSUE-101` entry
     in `issues.md`. `AFLDB-ISSUE-101-HANDOFF.md` is handoff documentation only and its §14/§15
     "current active task" and "what remains" text is SUPERSEDED. Do not read the
     commented-out row below as current — its "not yet validated" text is SUPERSEDED.

| `AFLDB-ISSUE-101` | Medium | Data acquisition / Import architecture / Data integrity | End-of-season promotion / baseline rollover. **Planner + CLI IMPLEMENTED 2026-08-29, not yet validated** (`src/lib/rollover/season-rollover.ts`, `tools/db/rollover-season.ts`, `tests/season-rollover.test.ts`). No migration, no canonical write, no clock read; **2026 NOT rolled**. ISSUE-099 and ISSUE-095 are both Resolved, so both dependencies are satisfied. Two policy points adjudicated 2026-08-29: the retired-baseline lifecycle status is **`retired`** (now declared in the real register as `selection_policy.retired_statuses`, a policy-only edit that changed no acceptance, measurement or fingerprint), and **`accepted_corrections` are reviewed per acquisition, never inherited**. **Must not redefine completed-season `club_seasons` ownership** — ISSUE-095's D1–D7 are implemented, not open, and its D7 already added six `club_seasons` Stage-9 gates. |
-->

<!-- Open issues continue. The header is repeated because the retired ISSUE-101 row
     above interrupts the table. -->

**ISSUE-102 / ISSUE-112 closeout checkpoint — 2026-09-02:** both issues are
**Resolved**. ISSUE-112 G1–G8 and ISSUE-102's eight closure criteria all pass; the
authoritative records are `issues/closed/AFLDB-ISSUE-112.md` §32 and
`issues/closed/AFLDB-ISSUE-102.md` §8.4. ISSUE-113 remains Open outside the parent
closure boundary, and the unrelated query-builder timing regression remains with ISSUE-116.

| Issue | Severity | Area | Current state |
|---|---|---|---|
| `AFLDB-ISSUE-136` | High | Data acquisition / Identity / Data integrity | **OPENED 2026-09-04 from the ISSUE-113 database validation (runbook §8.16.4). NOT STARTED.** The accepted fitzRoy baseline `full-history-20260902` has 83 rows in `player_stats_2025.csv` with a blank fitzRoy `ID` and a renumbered AFL Tables profile URL (`Charlie_Cameron3`, `Jack_Graham2`, `Jack_Ross3`, `Jack_Williams3`, `Billy_Wilson2`); `import_fitzroy_core.py` keys identity by path and seeded each as a NEW canonical player, so one person is two players (e.g. `2604` Cameron 229 games 2014-24 + `2608` Cameron 25 games 2025). Present on `afldb_test` and on production (same baseline). Effect: careers split; ISSUE-113's season-grain Brownlow rows key by the current path and land on the 2025 shells (34 votes; `sum(player_season_stats.brownlow_votes)` 79,079 vs 79,113); two re-armed release gates fail. Not to be resolved inside ISSUE-113. Next: confirm current paths on live AFL Tables; define the blank-`ID`/renumbered-URL merge or rekey rule in the core import (ISSUE-131 rekey is the nearest precedent), record per-player decisions in a tracked file, gate blank-`ID` rows in the baseline register; rebuild `afldb_test`; then ISSUE-113 V5-V13 and a production correction plan. |
<!-- RETIRED 2026-09-02 — `AFLDB-ISSUE-102` is Resolved and is NO LONGER an open issue.
     Authoritative records: `issues.md` (Resolution — 2026-09-02) and
     `issues/closed/AFLDB-ISSUE-102.md` §8.4. All eight closure criteria passed; ISSUE-113
     remains open outside the parent closure boundary by §8.3. The historical row below is
     retained as lineage only and must not be read as current state.
| `AFLDB-ISSUE-102` | Medium | Data acquisition / Import architecture | **PARENT ARCHITECTURE / COORDINATION RECORD — scope revised 2026-08-30 by operator decision** from the former "record only; do not design the replacement" boundary, which is now superseded (lineage retained in `issues.md`). Runbook `issues/open/AFLDB-ISSUE-102.md`; continuation state `issues/open/AFLDB-ISSUE-102-HANDOFF.md`. ISSUE-102 owns the architecture, the `AFLDB_LEGACY_SQLITE` inventory, child coordination, the closure criteria and the final verification that `import_awards.py` no longer operationally requires legacy SQLite — **it does not implement loaders**. Confirmed: the dependency is **per-group** (`needs_legacy = any(key not in LEGACY_FREE_GROUPS ...)`; the predicate was generalised from the single `under_22` exemption by ISSUE-111 pass 1), `under_22` is legacy-free via the tracked `data/awards/22-under-22.csv` manifest and `coleman` is legacy-free by derivation, leaving **six of eight** groups still dependent; classified **`LEGACY_SOURCE_DEPENDENCY`**, a repeatable reload still required by `docs/deployment.md` §7. `tools/db/rebuild-test.ts` gained a `coleman` data stage in ISSUE-111, **validated by the 2026-08-30 canonical rebuild** (`AFLDB-ISSUE-111` **Resolved 2026-08-30**; its record stays at `issues/open/AFLDB-ISSUE-111.md` while this parent cites it); the other five awards/honours tables still have **no rebuild stage and no Stage-9 gate**, so a canonical rebuild leaves them at **zero rows** — the `club_seasons = 0` shape of ISSUE-095. Every integrity contract a replacement needs already exists in `reload_keyed` and **no privilege change is required**; but `awards-reload-links.test.ts:205-1247` is **currently unexecutable** (gated on `AFLDB_LEGACY_SQLITE`). Children: **`AFLDB-ISSUE-111`** (Coleman derivation), **`AFLDB-ISSUE-112`** (curated honours manifests), **`AFLDB-ISSUE-113`** (Brownlow season totals — **outside 102's closure boundary**; 102 may resolve while 113 stays open, and the resolution must say so). `AFLDB-ISSUE-110` is NL semantic-mapping work (merged into dev 2026-08-31, own row below) and is **not** a child. **Next action: ISSUE-112 implementation phasing** — G0 is **DONE 2026-09-01 (all nine families PASS**, measured read-only against `afldb_dev`; `AFLDB-ISSUE-112.md` §14.4/§14.6). All 7 slices (honour teams, Hall of Fame, captaincies, Rising Star, All-Australian, club best-and-fairest, named medals) are **IMPLEMENTED + DB-validated** (through 2026-09-02, Pass 14) — every family is manifest-backed and runs legacy-free individually. **ISSUE-112 closeout ATTEMPTED 2026-09-02 (Pass 15, runbook §24) — ISSUE-112 STAYS OPEN.** G2/G4/G7/G8 PASS, G5 PASS-in-shape, **G3 PARTIAL**, **G6 BLOCKED** (the accepted fitzRoy/DraftGuru snapshot bytes are absent from every reachable checkout; re-acquiring is a scrape ISSUE-112 §12 forbids) — **superseded 2026-09-02 by ISSUE-112 Pass 20: the operator authorised reacquisition and then re-acceptance, and G6's input blocker is now cleared (`full-history-20260902`, `ladder-20260828`, `annual-html-20260902`); the rebuild itself is still unrun.** The §7 AWARDS/HONOURS rebuild stage now exists (`awards-honours`, between DraftGuru and DERIVED, Stage-9 per-family row gates), the last two shared definitions and the 33 previously-unowned `rising-star` winner rows are tracked, and a **correctness defect was found and fixed**: the manifests' carried `player_id` denoted a different footballer after a canonical rebuild in **12,392 of 12,392** cases, so links now resolve through the tracked AFL Tables profile identity (`data/awards/player-identity.csv`), fail-closed. **UPDATE 2026-09-02: `AFLDB-ISSUE-112` is RESOLVED** — G1-G8 all PASS, the DraftGuru preflight label defect was fixed at the wiring, and the canonical rebuild ran end to end against `afldb_test` (exit 0, FINAL VALIDATION 38/38, every awards/honours family at its exact expected count, zero orphan and zero wrong-player links, no legacy SQLite in the plan). The former gate "ISSUE-102 cannot close until ISSUE-112 does" is **satisfied**. Both in-boundary children (`AFLDB-ISSUE-111`, `AFLDB-ISSUE-112`) are now closed; `AFLDB-ISSUE-113` is outside this issue's closure boundary. **Next action: evaluate ISSUE-102's own closure criteria (`issues/open/AFLDB-ISSUE-102.md` §8) in a fresh session** — not yet done, so ISSUE-102 stays OPEN. Extraction-source prerequisite (ISSUE-112 §11.1) is **DECIDED 2026-09-01**: the legacy-loaded AFLDB PostgreSQL state, not a fresh scrape. One systemic pre-merge operator decision remains for ISSUE-112 — `source_citation` granularity (no per-row page citation survives in PostgreSQL; no scrape proposed). ISSUE-111's gate is closed: it is Resolved. **No implementation is authorised under ISSUE-102 itself.** |
-->
<!-- RETIRED 2026-09-02 — `AFLDB-ISSUE-112` is **Resolved** and is NO LONGER an open issue.
     Its index row is DELETED, not commented out, so it cannot render as an open row under any
     renderer. Authoritative records: the `AFLDB-ISSUE-112` entry in `issues.md` (Resolution,
     2026-09-02) and `issues/closed/AFLDB-ISSUE-112.md` §32. Final gate state: **G1-G8 all PASS.**
     G6 closed when the canonical `npm run db:test:rebuild` ran end to end against `afldb_test`
     (exit 0, FINAL VALIDATION 38/38, every awards/honours family at its exact expected count,
     zero orphan and zero wrong-player links, no legacy SQLite in the plan). The last blocker was
     an orchestrator defect, not data: `draftguruValidateArgv()` took no label, so the DraftGuru
     preflight could verify one snapshot while the data stage imported another. Fixed at the
     wiring — the preflight argv is now derived from the data-stage argv and `runPreflight` takes
     the same `Options` object `planStages()` uses.
     Carried forward, NOT reopening this issue: the §24.6 identity backlog (18 censused players /
     33 manifest rows, unchanged, plus 16 players / 19 rows first measurable against canonical
     data — all fail closed to unlinked, none mis-linked) still needs an operator decision, and
     the one out-of-scope post-rebuild test failure was routed to `AFLDB-ISSUE-116`, which owns
     that mechanism. -->
<!-- RETIRED 2026-09-03 — `AFLDB-ISSUE-122` is **Resolved** and is NO LONGER an open issue.
     Automatic current-season AFL Tables canonical ingestion is OPERATING IN PRODUCTION.
     `main` merged at `250caa2`; production pulled it, is at migration `083` with 0 pending,
     `db:privileges` reconciled, R 4.3.3 + fitzRoy 1.8.0 installed and pinned. Supervised
     production ladder passed end to end on snapshot `settle-2026-09-02-1958`: a full
     `--dry-run --auto-apply` against the real production schema rolled back completely, the
     real apply (`import_batches` 731) wrote 10582 canonical rows / 9133 ledger rows with 0
     refusals and 0 failures, and the identical rerun (`import_batches` 732) wrote 0/0/0 —
     **SC3 passed on production**. Exception report showed only the 803 unresolved player rows;
     0 other pending candidates, 0 apply failures, 0 source disagreements, 0 moot candidates.
     `deploy/afldb-settle-afltables.timer` is enabled and active, next trigger
     Fri 2026-09-04 04:34:12 AEST, `Persistent=true`; Squiggle/Kali are never invoked
     automatically and no fallback canonical authority exists. **S9 is NOT REQUIRED** — §14
     rule 7 refuses all 189 legacy-loaded 2026 rows, adoptable set 0. Health after the final
     recovery: `{"status":"ok","database":"ok","latencyMs":2}`; production super-admin login
     verified after the auth recovery. `afldb.com` stays the static holding page (its
     `/api/health` 404 is expected); Caddy unchanged. All SC1-SC10 clear. Authoritative record:
     the `AFLDB-ISSUE-122` entry in `issues.md` (Resolution, 2026-09-03) and
     `issues/closed/AFLDB-ISSUE-122.md` §23. Four follow-ups routed out of the closeout:
     `AFLDB-ISSUE-123`, `-124`, `-125`, `-126`. -->
<!-- RETIRED 2026-09-03 - `AFLDB-ISSUE-129` is **Resolved** and is NO LONGER an open issue.
     AFL Tables' Wildcard Final is now canonically representable. Implementation commit `b1d4085`
     on `opus/issue-129` adds migrations `084_round_type_wildcard_final.sql` and
     `085_matches_is_finals_series.sql` - applied to `afldb_test` ONLY, not dev and not production
     - a distinct `wildcard_final` round type with `matches_is_final_ck` UNCHANGED (so
     `is_final = true` by construction), and one canonical `matches.is_finals_series` generated
     column that is false for both `home_and_away` and `wildcard_final`. The full §11 acceptance is
     green: T1-T16; five touched integration suites **268 passed / 5 skipped / 0 failed**;
     typecheck clean; 0 lint findings in changed or new code; **T15 generated-column invariant
     0 mismatches**; **T16 ladder witness 1,622 comparable club-seasons agree**; and **T7 against
     the real live source 209 matches / 9,614 player-match rows, 0 rejected, 0 unkeyed,
     `SOURCE COMPLETENESS: COMPLETE`** (was 207 / 9,522 with 94 unrepresentable rows). ISSUE-128
     needed no code change. Its number stays allocated and `084`/`085` are definitively taken.
     Authoritative record: the `AFLDB-ISSUE-129` entry in `issues.md` (Resolution, 2026-09-03) and
     `issues/closed/AFLDB-ISSUE-129.md` §18.
     **NOT DEPLOYED TO PRODUCTION** - production is at `083` with no wildcard support. ISSUE-128 and
     ISSUE-129 must ship together: deploying 128 alone leaves the nightly settle unit reporting
     `failed` every night the 2026 Wildcard Round is in the acquired window. Next action: merge both
     to `main`, apply `084` then `085` to dev and re-validate, then production in the order
     migrations -> `npm run db:privileges` -> code deploy -> supervised settle. -->
<!-- RETIRED 2026-09-03 — `AFLDB-ISSUE-128` is **Resolved** and is NO LONGER an open issue.
     A current-season settle can no longer report success while dropping rows AFL Tables supplied:
     the completeness verdict is derived from the source's own counters (never a calendar), stated
     by `import_fitzroy_core.py`, enforced by `settle-afltables.ts --require-complete-source`
     **after** the settle commits, passed by `deploy/afldb-settle-afltables.sh`, and projected by
     `/admin/current-season`. The legacy Kali `auto` mode is removed, unknown modes are refused and
     `parseCurrentSeasonSources()` no longer defaults to `kali`. Validated on dev with the real
     systemd chain (`import_batches` 87 committed `completed`, 980 canonical rows, 0 apply failures,
     unit exited **1** with `Source INCOMPLETE: 94 unrepresentable row(s), 2 unswept scope(s)`), then
     accepted on `afldb_test` — `tests/integration/settle-afltables.test.ts` **44 passed / 1 skipped
     / 0 failed** (the skip is the pre-existing restricted `afldb_import`-role check on an unset
     `AFLDB_TEST_IMPORT_DATABASE_URL`). The temporary systemd drop-in repointing the unit at the
     ISSUE-128 worktree has been removed and the unit restored to `/home/arm/projects/afldb`.
     NOT eyeballed in a browser: the rendered INCOMPLETE alert on `/admin/current-season` — proven
     at the data layer only; carried to `AFLDB-ISSUE-129`. Authoritative record: the
     `AFLDB-ISSUE-128` entry in `issues.md` (Resolution, 2026-09-03) and
     `issues/closed/AFLDB-ISSUE-128.md` §12-§13.
     **NOT DEPLOYED TO PRODUCTION, deliberately** — the nightly unit will report `failed` every
     night the 2026 Wildcard Round is in the acquired window. `AFLDB-ISSUE-129` (Wildcard Final
     enum + finals semantics) is the open blocker and must be decided first. -->
<!-- RETIRED 2026-09-03 — `AFLDB-ISSUE-130` is **Resolved** and is NO LONGER an open issue.
     The settle service's R library is declared (`deploy/afldb-r-env.sh`) and validated at deploy
     time (`deploy/afldb-r-preflight.sh`, exact fitzRoy pin read from `fitzroy-contract.json`);
     `/usr/local/lib/R/site-library` is canonical on every host; unit file unchanged. Resolving
     validation: dev-host supervised settle with the untracked drop-in ABSENT and `Environment=`
     empty — 209 / 9,614 / 0 unkeyed / `SOURCE COMPLETENESS: COMPLETE`, exit 0. Production
     inspected read-only at `250caa2`: no drop-in, R 4.3.3, jsonlite/digest from apt, fitzRoy
     1.8.0 in `/usr/local/lib/R/site-library` — already compliant, nothing to reconcile.
     **NOT MERGED, NOT DEPLOYED.** Post-deploy gate: `sh deploy/afldb-r-preflight.sh` on
     `afldb-prod` must print `R PREFLIGHT: OK`. Authoritative record: the `AFLDB-ISSUE-130`
     entry in `issues.md` (Resolution, 2026-09-03) and `issues/closed/AFLDB-ISSUE-130.md` §12-§13. -->
<!-- RETIRED 2026-09-03 — `AFLDB-ISSUE-133` is **Resolved** and is NO LONGER an open issue.
     Classification: stale/static/ISR cache output (build-before-settle ordering plus the one-hour
     revalidation window); no application fix made. Operator production verification: live
     `/seasons/2026` renders the Wildcard Final section; on-disk entry regenerated 23:50:48 AEST
     (5 "wildcard", 1 anchor). Authoritative records: the `AFLDB-ISSUE-133` entry in `issues.md`
     (Resolution, 2026-09-03) and `issues/closed/AFLDB-ISSUE-133.md` §11. Follow-up: `AFLDB-ISSUE-134`. -->
<!-- RETIRED 2026-09-04 — `AFLDB-ISSUE-136` (fitzRoy canonical player identity split on a blank ID +
     renumbered AFL Tables url) is **Resolved** and is NO LONGER an open issue. Canonical rebuild on the
     shared `afldb_test` GREEN (39 final-validation checks; 13,271 distinct players behind 13,275 AFL
     Tables identities; four players with two registered paths), ISSUE-113 V5 witness 79,113 with a zero
     identity gap, split HALT exercised against the real database. Committed on `claude/issue-136`, not
     merged. Authoritative records: the `AFLDB-ISSUE-136` entry in `issues.md` (Resolution, 2026-09-04)
     and `issues/closed/AFLDB-ISSUE-136.md` §13. Follow-up: `AFLDB-ISSUE-137`. -->
<!-- UPDATE 2026-09-06 (ISSUE-118 DEV load attempted): the `AFLDB-ISSUE-118` follow-up "DEV load"
     was executed on `streamanator` / `afldb_dev` at `c2a5a13`. **After-siren loaded** (batch 105:
     126 events, 126 rows, 123 linked / 3 unresolved, 121 matches linked; `after_siren.py reconcile`
     38/38 — the same contract the canonical rebuild's AFTER-SIREN RECONCILE stage runs). **Coaches,
     father-son and siblings could NOT be loaded**: all three resolve people only through the AFL
     Tables profile-url identity and `afldb_dev` registers 12,472 of the accepted baseline's 13,271,
     so they fail closed on 2 / 40 / 29 missing profiles respectively. That gap is now
     `AFLDB-ISSUE-139`; the 17 duplicate stat-less 2026 matches found while explaining one unresolved
     after-siren kicker are `AFLDB-ISSUE-140`. No code changed, no name-based identity written,
     `import_fitzroy_core.py` was NOT run against `afldb_dev`, and production was untouched.
     **Next free issue ID is `AFLDB-ISSUE-142`.** -->

| `AFLDB-ISSUE-137` | High | Data integrity / Operations / Database (production) | **NOT STARTED — allocated 2026-09-04 at the ISSUE-136 closeout; no production mutation authorised.** Production `afldb_prod` still holds the four canonical player splits that `AFLDB-ISSUE-136` fixes at rebuild time (Charlie Cameron, Jack Graham, Jack Ross, Jack Williams: a career player plus a 2025-only duplicate keyed on the renumbered AFL Tables url, the duplicate carrying the 2025 match rows, the awards-census rows and every 2026 settle row). The fixed importer HALTs (`external-identity split`) against such a database by design. Key files: `issues/closed/AFLDB-ISSUE-136.md` §10.3/§13.4 (verification SQL), `tools/migration/import_fitzroy_core.py`, `AFLDB-ISSUE-125` (promotion path). | Operator chooses (a) canonical rebuild-and-promote under `AFLDB-ISSUE-125`, or (b) a supervised, reviewed per-player identity reconciliation on production (re-point the renumbered identity, match rows, award rows and settle rows to the career player, recompute derived tables, retire the duplicate) after a production backup; first step of either is a read-only measurement of the production split. |
| `AFLDB-ISSUE-138` | Low | Testing / Database privileges | **OPEN — found 2026-09-05 during ISSUE-118 §23.28.** `tests/integration/privileges.test.ts` ("afldb_import writes exactly the tables the registry allows") reports `external_grids` / `external_grid_axes` as writable-but-unregistered on every database since migration `080`, whose narrow `afldb_import` grants (SELECT + INSERT, UPDATE on `is_current`) are deliberate and outside the registry; reproduced hand-migrated and after a clean 18-stage rebuild, 34/35 pass. No privilege is wrong. | Extend the suite's exclusion list with the two tables and assert the 080 narrow shape (no DELETE/TRUNCATE), mirroring the `data_overrides` column-scoped case; no privilege change. |
| `AFLDB-ISSUE-139` | High | Data integrity / Import architecture / Database (dev) | **OPEN — Phase 5 (Final UI exposure) implemented 2026-09-06, uncommitted on `claude/issue-139`: Family/Father–Son/Coach/After-the-Siren Records pages + a Coaches nav entry, no migration; `tsc`/`eslint` clean, one DB-free test passed. Still open pending the operator's DEV deploy + browser smoke (`issues.md` Phase 5 close-out) before resolution.** Earlier — Phase 4E EXECUTED END TO END 2026-09-06 (stamp `20260906-112500`): `afldb_dev` is now the promoted rebuilt lineage (`afldb_dev_pre_rebuild_20260906-112500` retained), `--phase production` **PASS (8 gates)**, 2026 re-acquired (batch 86, 3 h 49 min into empty staging; idempotence batch 87 in 51 s), ISSUE-140 re-measured 0 / 0 / 0, admin login recorded. Three plan-generator defects fixed in this worktree (74/74, tsc/eslint clean, changelog); swap quoting fixed in the doc. Earlier: Phase 4E-2 done: candidate restored, reinstated, §7.4b done, `--phase candidate` PASS (8 gates). Three promotion-plan generator defects found live and FIXED in this worktree (`tools/db/promotion-inventory.ts`, 74/74, tsc/eslint clean, changelog). Earlier: Phase 4E-1 done (backup PROVEN, snapshot, source dump, plan). Earlier: Phase 4C′ done 2026-09-06 on merged `main` `59250a6` (`claude/issue-139`, read-only) and STOPPED at the §7.4c decision boundary.** `db:promotion:check --environment dev` PASSES `source` on `afldb_test` (7 gates; 71 tables = 44 + 27; parity 91/91) and refuses `pre-cutover` on `afldb_dev` on migration parity only (`UNKNOWN 079_access_code_delete.sql` + `PENDING 091`, both truthful; fixtures 2 accepted; super admins 4/5). Lineage (read-only, ISSUE-142 recipe): 42 lineage-bound player ids, 33 evidenced and present in the rebuilt lineage, 9 with no identity; `player_link_resolutions.target_id` 94/94 unresolvable by contract; `data_edits` 16 player rows (7 ids) and 8 match rows (2 matches already deleted on DEV, 1 current-season) unresolvable now. **Finding D → `AFLDB-ISSUE-143`, RESOLVED 2026-09-06:** the `restored` gate FAILed on any unresolved row and neither §7.4c answer had an executable path; §7.4d's declared historical-only disposition now supplies one, and both ledgers are declared for `--environment dev`. `afldb_test` = proven ISSUE-118 rebuild + 091, inputs unchanged since `cadb4ad`, no other session — re-running 4D is optional. `afldb_dev`: `players` 13,363 / identities 12,472 / 891 without; `external_grids` 2,266 (batches 82/84), `external_grid_axes` 13,596; `auth_audit_log` 625; `staging_aflw.*` 51,018. §7.4b settled: option 1 (batches 82/84, `gridley` 80→7). Key files: `tools/db/promotion-check.ts`, `tools/db/promotion-inventory.ts`, `docs/production-promotion.md` §7.4c/§13, `tools/db/rebuild-test.ts`. | **Close-out (operator):** `/admin/player-links` refresh to regenerate `player_link_match_candidates` (0 now, §7.4d re-surfacing expected); browser check of a season / player / AFLW / search page and `/admin/settings`; merge `claude/issue-139`; DEV deploy of the host checkout (`c2a5a13` → `main`, migration 091 already applied); cleanup of `afldb_dev_pre_rebuild_20260906-112500` NOT the same day. Then mark Resolved. **Hardening handoff for Codex** is persisted in the entry (`### Post-139 hardening handoff for Codex`, H1–H15 + P0–P2 order); read it before any post-139 tooling work. Superseded: **Phase 4E-3 — operator first (§8 swap, sudo):** on `streamanator`, `sudo systemctl stop afldb`; as postgres terminate backends on `afldb_dev` + the candidate, `ALTER DATABASE afldb_dev RENAME TO afldb_dev_pre_rebuild_20260906-112500`, `ALTER DATABASE "afldb_dev_candidate_20260906-112500" RENAME TO afldb_dev`; `sudo systemctl start afldb` (exact block in `issues.md` Phase 4E-3). Then Claude resumes with `--environment dev --phase production --database afldb_dev --compare <snapshot> --allow-fixture-identities --expect-super-admin <operator>` (expect PASS), health, override replay, link-candidate regeneration, 2026 re-acquisition, Phase 6 + ISSUE-140 re-measure. Record: `~/backups/afldb/promotion-dev-20260906-112500/` on the host. Any Git Bash checker call carrying a host path needs `MSYS_NO_PATHCONV=1`. Earlier: **D0–D3 ALL SETTLED 2026-09-06.** D0 = reuse `afldb_test`; D1/D2 = §7.4c **option 2** for `player_link_resolutions` and `data_edits`; D3 = `AFLDB-ISSUE-143` **Resolved** (branch `claude/issue-143`, unmerged), so both tables are declared `historicalOnly` for `--environment dev`. **Merge `claude/issue-143` first**, then resume on `npm run db:promotion:check -- --environment dev --phase source --database afldb_test` (expect PASS, 7 gates), then Phase 4E host-side per `docs/production-promotion.md` §§3–8 + §13 + §7.4d, with the §7.4b option-1 steps before the corpus reinstate and `--phase restored --lineage-remap-out` (expect WARN, 0 refused: both ledgers report `hist`, the plan already omits their `pg_restore` lines, and `--phase candidate` expects 0 rows in each; there is no deferred `data_edits` remap under D2). Never match by name; never point `import_fitzroy_core.py` at `afldb_dev`; ISSUE-140 is re-measured only. |
| `AFLDB-ISSUE-140` | Medium | Data integrity / Import (current season) | **RE-MEASURED 2026-09-06 after the ISSUE-139 DEV promotion: 0 / 0 / 0 on the promoted lineage (baseline 17 / 34 / 17); the old lineage with the duplicates is retained as `afldb_dev_pre_rebuild_20260906-112500` for the writer identification. No repair performed.** **OPEN — found 2026-09-06 during the ISSUE-118 DEV load. Not started; nothing deleted.** `afldb_dev` holds 17 duplicate 2026 fixtures (34 rows, rounds 23-25): one copy carries the stats, the other is empty and sits one `round_number` lower — AFL Tables' numbering, which omits Opening Round, against AFLDB's which counts it. All 17 stat-less rows are under round 23 (9) and 24 (8) with no `match_period_scores`. `match_key` embeds the round, so the two conventions key one fixture twice and no upsert collapses them. Observed effect: the after-siren loader matched `2026-vfl-afl-23-hawthorn-dylan-moore` to the empty round-23 row (17046) and left the kicker unresolved. Production not measured. Key files: the settle path (`AFLDB-ISSUE-099`), `tools/migration/import_fitzroy_core.py` match identity, `AFLDB-ISSUE-131` (rekey-in-place precedent). | Read-only: identify which writer produced the stat-less copies and its round-number convention from `import_batches` / provenance, then measure production read-only. Do not delete rows first — the next settle would recreate them. |
| `AFLDB-ISSUE-117` | Medium | Admin / Access management / Security | **OPEN — implemented 2026-08-31, RECONCILED onto current `main` 2026-09-06 on `claude/issue-117` (worktree `D:\dev\afldb-issue-117`, cut from `main` @ `8dd96c5`).** `/admin/access` can revoke a beta access key but never remove one, and a **spent** key (`use_count >= max_uses`) is offered neither Revoke (shown only while `live`) nor Delete, so retired keys accumulate with no disposal path. Deletable = **retired** (revoked OR spent); partly-used and unlimited keys stay refused because they remain redeemable; expiry deliberately excluded. The rule is a `WHERE` clause inside the DELETE, not a hidden button, and `access.code_deleted` is written on the deleting transaction so the row cannot outlive its trail. **Two reconciliations against `main`:** the migration is renumbered **`079` → `091`** (`main` took `079` for the head-to-head grain migration; `091` confirmed free across every local/remote ref *and* every sibling worktree), and the original `src/lib/auth/session.ts` change is **DROPPED** as superseded — `AFLDB-ISSUE-119` already added `auditInTransaction`, which `deleteAccessCode` now calls. Key files: `src/db/migrations/091_access_code_delete.sql` (new), `src/db/queries/access-codes.ts` (new), `src/app/admin/access/actions.ts`, `AccessManager.tsx`, `tools/maintenance/privileges.sql`, `tests/admin-access-actions.test.ts` (new), `tests/integration/access-codes.test.ts` (new), `tests/integration/privileges.test.ts`. Validated DB-free 2026-09-06: **13/13 unit, `tsc --noEmit` exit 0, `eslint` exit 0**. **Next action: operator runs `npm run db:migrate:test` then the two integration suites, then merge.** **Deploy order is load-bearing — migration `091` and `privileges.sql` BEFORE the code**, or every delete fails closed on a permission error. **Does NOT clear ISSUE-139's DEV parity refusal:** `afldb_dev` keeps its orphan applied `079_access_code_delete.sql` row, which renumbering cannot remove and which no supported path deletes — the promotion is the reconciliation, per `AFLDB-ISSUE-142` Finding C. Runbook: `issues/open/AFLDB-ISSUE-117.md`. |
| `AFLDB-ISSUE-142` | High | Operations / Database tooling / Data integrity | **OPEN — IMPLEMENTED 2026-09-06, AWAITING VALIDATION (focused suite, typecheck, lint, then the two read-only checker phases). Uncommitted in the `main` working tree; 5 files; no migration, no privilege change, no database contacted.** (A) decided in the contract as `rebuilt`/`compare: zero` — NOT registered import-writable, because `grant_import_write()` grants UPDATE/DELETE/TRUNCATE for a writer that does not exist; the suite now derives the registry from the migrations instead of assuming it. (B) a `restored`-phase lineage gate proves identity (AFL Tables profile url / `matches.match_key`) rather than existence, passes silently on a same-lineage production promotion and refuses anything unevidenced, with `--lineage-remap-out` writing the evidenced per-row remap; `player_link_resolutions.target_id` is declared identity `none`, so DEV is refused with §7.4c's two supportable answers printed. (C) `079_access_code_delete.sql` is committed only on `claude/issue-116` @ `2344ab5`, is in no checkout, and cannot merge at 079 — the DEV parity refusal stands, the promotion is the reconciliation. Originally: **found 2026-09-06 during ISSUE-139 Phase 4C, read-only.** (A) `player_match_period_stats` (migration 062) is in neither `afldb_meta.import_writable_tables` nor `publicContractTables()`, so the fail-closed classification gate refuses every `db:promotion:check` phase on every real database — reproduced on `afldb_test` and `afldb_dev`; `tests/db-promotion-check.test.ts` misses it because `PINNED_FOOTBALL_TABLES` assumes the table is import-writable. (B) The contract reinstates `player_link_resolutions` / `data_edits` by id; across a lineage change (DEV bootstrap → rebuilt) 34 of 36 referenced player ids name a different person. Key files: `tools/db/promotion-inventory.ts`, `tools/db/promotion-check.ts`, `tests/db-promotion-check.test.ts`, `src/db/migrations/062_player_match_period_stats.sql`, `docs/production-promotion.md` §13. | Operator decides (A) forward migration vs contract entry and (B) audit-ledger vs evidenced profile-url remap; implement on `claude/issue-142` with the unit suite checking the registry rather than a pinned assumption; proof is `--environment dev --phase source --database afldb_test` and `--phase pre-cutover --database afldb_dev --allow-fixture-identities` reading PASS (parity on DEV still needs the `079_access_code_delete.sql` decision). Blocks `AFLDB-ISSUE-139` Phase 4D and `AFLDB-ISSUE-137` path (a). |
| `AFLDB-ISSUE-144` | Medium | Public UI / club history / database queries | **OPEN — the V1.7 implementation (Stages 0-10) is now MERGED into `main` (`2102b51`, via PR #2); the Linux route-budget/Playwright acceptance items below are unchanged and still outstanding. A SEPARATE, ADDITIVE follow-up — the "Club Rivalry Explorer" browser-review redesign (all-time-first, era/decade drill-down, replacing season UI/state) — is now IN PROGRESS on `claude/issue-144-rivalry` (same worktree). Follow-up Stages FR-1 (remove season from the route/state/URL/presentation contract), FR-2 (era explorer + query-layer era filtering) and FR-3 (section split and reorder) are COMPLETE 2026-09-06, uncommitted; `getClubSeasonComparison` and its composed query primitives were deliberately left intact but unused rather than deleted (FR-1). FR-2 added an `era` URL parameter validated against each pair's own `getHeadToHeadByDecade` population, scoped `getHeadToHeadRecords`/`getHeadToHeadMeetings` to it, and added the era-chip UI (`ClubComparisonEraExplorer`) — streaks/venues/players/Brownlow stay all-time. FR-3 split the former monolithic `ClubComparisonHeadToHead`/`ClubComparisonTrends` (both deleted) into `ClubComparisonHero`, `ClubComparisonRivalryRecords`, `ClubComparisonVenues` and `ClubComparisonMatchHistory`, reordered the page to Header → Hero → Era explorer → Rivalry records → Venues → Players → Brownlow → Match history, collapsed Venues/Players/Brownlow/Match history behind one top-level disclosure each (Rivalry records stays always expanded), and relocated the match-type control into Match History's own local form. No query-layer file was touched by FR-3. **FR-2/FR-3 validation EXECUTED by the operator 2026-09-07 — ALL PASS** (`tsc`, targeted ESLint, `club-comparison`/`club-comparison-view` unit suites 51/51, `integration/club-comparison` 70/70 including era filtering, and the route-equivalent warm composed-load performance — Adelaide/Brisbane Lions median 138.6 ms, Carlton/Collingwood median 189.6 ms, both well under the 1.5 s ceiling). **The Club Rivalry Explorer follow-up (FR-1 through FR-5) is now IMPLEMENTATION COMPLETE, 2026-09-07 — NOT YET DEPLOYED.** Getting there needed three rounds of test-only Playwright hardening for a mobile-under-load flake in the era-canonical assertion (`expect.poll` timing fix → structural `toHaveAttribute` fix → finally removing the duplicated canonical assertion from the era journey test in favour of `seo.spec.ts`'s dedicated ownership — test-scope separation, not an application regression) plus one real heading-hierarchy fix (three subsections nested inside an already-top-level section were rendering a second `<h2>`; `CollapsiblePanel`/`CollapsibleTable` gained an optional heading-level option, default unchanged everywhere else) and one Playwright-test-only Players-locator fix (`details.filter({has: heading})` was matching nested disclosures too; scoped to `#players` + `> summary`). **Final FR-5 acceptance GREEN, EXECUTED by the operator 2026-09-07:** mobile era-journey `--repeat-each=3` 3/3 PASS; broader targeted ISSUE-144 comparison gate (`journeys.spec.ts` + `seo.spec.ts`, both projects) 22 PASS / 2 expected project-specific skips / 0 failures. One `CHANGELOG.md` entry added. `npm run build`, the Linux route-budget check and the manual breakpoint sweep remain outstanding but are not part of this gate's acceptance criteria. **Uncommitted on `claude/issue-144-rivalry`. Next action: operator's Git handoff (staged file set, commit message, push, PR, post-merge DEV rebuild/restart + smoke checklist) is in `AFLDB-ISSUE-144.md`'s final "Git handoff" section — commit/push/merge/deploy are all the operator's call, none performed by any session.** Earlier: **IMPLEMENTATION COMPLETE 2026-09-06 — Stages 0-10 complete (11 stages total) on `codex/issue-144` (worktree `D:\dev\afldb-issue-144`), UNCOMMITTED, awaiting user Git review/commit/merge and dev deployment.** The `/clubs/compare` surface is fully built and public: selected-season comparison, complete head-to-head history, extended rivalry analytics (decade H2H, period-score records, coverage-aware H2H player averages) and connected-player history, per the approved V1.7 runbook `AFLDB-ISSUE-144.md`. Final Stage 10 regression: 172 tests pass (unchanged from Stage 9) across `tests/club-comparison.test.ts`, `tests/club-comparison-view.test.ts`, `tests/integration/club-comparison.test.ts`, `tests/integration/club-comparison-route.test.ts`, `tests/integration/club-comparison-view.test.ts` and `tests/seo.test.ts`; `npx tsc --noEmit` clean; `eslint` 0 errors (3 warnings — 1 pre-existing, 2 new-but-harmless in ISSUE-144's own files, none fixed to avoid cosmetic churn on accepted code); `npm run build` exit 0 with `/clubs/compare` still dynamic; the Windows Playwright rerun reproduced Stage 9 exactly (90 passed, 20 pre-existing dataset-numbering failures unrelated to ISSUE-144, 4 skipped). The single Unreleased `CHANGELOG.md` entry was added. **Two acceptance prerequisites remain OUTSTANDING and are explicitly NOT claimed as passed:** the Linux warm route-budget measurement (`npm test -- tests/integration/club-comparison-route.test.ts -t "route budget"`, target <1.5 s for Adelaide/Brisbane Lions and Carlton/Collingwood) and the full Playwright suite on the Linux dev host's matching dataset — both require `codex/issue-144` to exist on the Linux dev host, which is a user-controlled Git/deploy action this session did not perform. The four foreign `AFLDB-ISSUE-144-venue-*` files and `AFLDB-ISSUE-144.md.encoding-backup` were moved out of the worktree to `D:\dev` before Git closeout and are excluded from ISSUE-144's file inventory. Full evidence and the exact user handoff are in the Stage 10 entry of `AFLDB-ISSUE-144.md`'s "Stage execution log". **No migration, no index, no materialization, no persistent cache, no public API.** | **User-controlled, in order:** (1) review `git status`/`git diff` and separately triage the foreign `AFLDB-ISSUE-144-venue-*` files and the `.encoding-backup` file; (2) commit the ISSUE-144 files (see the runbook's Stage 10 changed-file inventory); (3) push/merge per normal workflow; (4) make merged code available on the Linux dev host; (5) run the Linux route-budget command above and the full `npx playwright test tests/e2e/journeys.spec.ts tests/e2e/seo.spec.ts` suite there; (6) close ISSUE-144 once both pass; (7) deploy to dev and run the post-deploy smoke checklist in the runbook (`/api/health`, `/clubs/compare`, Adelaide/Brisbane Lions, Carlton/Collingwood, swap, historical season, match-type filter, pagination, mobile, logs). |
| `AFLDB-ISSUE-146` | Medium | Rebuild tooling / Database (test, rehearsal) | **OPEN — IMPLEMENTED 2026-09-07 on `claude/issue-146` (worktree `D:\dev\afldb-issue-146`), uncommitted; local validation passed; the first real `code_test_db` rebuild has NOT been run.** `npm run db:test:rebuild` gains an explicit `--target <database>` restricted to an allowlist of exactly `afldb_test` (still the default) and the new disposable full-rebuild rehearsal database `code_test_db`, which runs the identical stage graph through its own dedicated `AFLDB_CODE_TEST_DATABASE_URL` / `AFLDB_CODE_TEST_IMPORT_DATABASE_URL` and matching `db:migrate:code-test` / `db:privileges:code-test` scripts. `--acknowledge-destroy` must name the selected database exactly; dev/prod/`*pre_rebuild*`/arbitrary `*_test` names are refused by name before any DSN is read, and a DSN naming any database other than the selected target is refused. Key files: `tools/db/rebuild-test.ts`, `tools/db/migrate.ts`, `tools/db/privileges.ts`, `package.json`, `docs/deployment.md` §6a, `tests/db-test-rebuild.test.ts`. | **Operator:** review + commit the branch; create `code_test_db` (owned by `afldb_owner`, with `afldb_import` connect) on the rehearsal host and set the two `AFLDB_CODE_TEST_*` variables; then run the first real rehearsal: `npm run db:test:rebuild -- --target code_test_db --acknowledge-destroy code_test_db` (dry-run first with `--plan`). Resolve once the rehearsal passes its final validation. |
| `AFLDB-ISSUE-147` | Medium | Public UI / navigation IA / responsive layout | **OPEN — IMPLEMENTATION COMPLETE, validated locally against DEV data via an operator SSH tunnel; awaiting operator commit / merge / deploy.** Branch `claude/issue-147-ui` (worktree `D:\dev\afldb-issue-147-ui`). Full authenticated rendered audit of the public site (27 routes × 7 widths, 320–1440) — page-level responsive discipline sound (zero document-level horizontal overflow anywhere); defects concentrated in: **P0** the phone bottom bar (`TABS`) was a smaller, independently hand-kept IA than the masthead (`PRIMARY_NAV`) — **Clubs, Venues, Coaches, Brownlow, Awards, Draft, Match Search unreachable from the phone chrome**, same gap under `/aflw`, and the home "Browse the record" grid a third drifting list (already missing Coaches); **P1** a 641–~890 px masthead-nav overflow band; **P1** dense tables scroll inside `.table-wrap` with no cue that off-screen columns / sort headers exist. Fix — navigation + responsive CSS + tests only, **no migration / schema / query / route / privilege / deploy change**: new canonical `src/lib/site-nav-model.ts` (one `PRIMARY_NAV`; derived `QUICK_TABS` now incl. **Clubs**; derived `BROWSE_SECTIONS` now incl. **Coaches**); `TabBar` gains a "More" bottom-sheet dialog listing the **whole** active primary set (focus-trapped, `aria-current`, Esc/backdrop/link/`popstate` close); masthead nav `flex-wrap`s cleanly at 641–1080 px; `.table-wrap` gains a CSS-only theme-aware directional scroll shadow (`--edge-shadow`, self-hiding, no markup change); new committed `tests/e2e/responsive-nav.spec.ts` derives nav parity from the rendered masthead so a future one-sided addition fails; `tests/e2e/journeys.spec.ts` nav tests de-skipped on mobile via `reachPrimary()` + a new "clubs is reachable" test. Key files: `src/lib/site-nav-model.ts` (new), `src/components/SiteNav.tsx`, `src/app/page.tsx`, `src/styles/globals.css`, `tests/e2e/responsive-nav.spec.ts` (new), `tests/e2e/journeys.spec.ts`, `CHANGELOG.md`. Validation (branch built as the standalone prod server against the live DEV Postgres via an operator SSH tunnel, temporary process-level DSN overrides only, `.env` untouched): `tsc`/`eslint`/`npm run build` PASS; `responsive-nav.spec.ts` 32/32; journeys nav tests 10/10 on Desktop + Pixel 7; full viewport audit 200/200, zero overflow, zero 4xx/5xx; before/after screenshots in `artifacts/issue-147/` (gitignored). | **Operator:** review + commit `claude/issue-147-ui`; delete audit scaffolding (`playwright.responsive.config.ts`, `tests/responsive/_baseline-audit.spec.ts`, `artifacts/issue-147/`, `tests/nl-ui/.auth/`) — or keep `playwright.responsive.config.ts` for the re-runnable audit; merge; deploy to DEV via `deploy/sync-dev.ps1` and smoke the phone nav + `/clubs` on a real device; run `npm run test:e2e` on the Linux dev host to confirm the new spec's gate-off path; then Resolve. |
| `AFLDB-ISSUE-149` | Low | Public UI / club pages / database queries | **OPEN — IMPLEMENTATION COMPLETE; `tsc` / focused vitest / `npm run build` all NOT yet operator-run. Stays Open until merged and verified on DEV.** Branch `fable/issue-149-club-records` (worktree `D:\dev\afldb-issue-149`), bootstrapped from merged `main` after ISSUE-148. SIX new public AFL club-page sections, all lineage-scoped by `clubs.organization_id`, all from existing canonical tables, **no migration**, ISSUE-148's Premierships / Coaches sections preserved. **(1) Club records** — `getClubMatchRecords(clubId)` in `src/db/queries/clubs.ts`: a `club_matches` CTE orients every lineage match to the club's perspective (`club_score`/`opponent_score`/`opponent_id` regardless of home/away), six single-row deterministic picks — `biggest_win`/`biggest_loss` (largest winning/losing margin), `highest_score`/`lowest_score` (the club's OWN score, not combined), `highest_scoring_match`/`lowest_scoring_match` (COMBINED score of both sides); ties broken `match_date DESC, match_id DESC`. `src/components/ClubMatchRecords.tsx`. **(2) Record crowds** — `getClubCrowdRecords(clubId)`: same CTE + `attendance IS NOT NULL`; `{records, top}` — highest home-and-away (`round_type='home_and_away'`) / finals (`is_finals_series IS TRUE`) / Grand Final (`round_type='grand_final'`) crowd + five largest crowds; `attendance DESC, match_date DESC, match_id DESC`; null attendance excluded, never shown as 0. `src/components/ClubCrowdRecords.tsx`. **(3) Players (complete list)** — `getClubPlayers(clubId)`: full `player_clubs` set summed by `organization_id` (one row per player, this club's games/goals only), `games DESC, goals DESC, display_name, id`, not truncated. `src/components/ClubPlayers.tsx` — `SortableTable` in a `defaultOpen={false}` `CollapsibleTable`. **(4) Premiership players** — `getClubPremiershipPlayers(clubId)`: `player_club_season_stats` `is_premier=true` in lineage, `season DESC, games DESC, display_name, player_id`. `src/components/ClubPremiershipPlayers.tsx` (one `SortableTable`, Season column keeps each season's players contiguous, no heading-level jump). **(5) Awards & honours** — `getClubBrownlowMedallists(clubId)` (from `brownlow_season_votes` `is_winner` + `link_status_value IN ('unique','resolved')` + `club_id` in lineage — per ISSUE-118 §W.4, not `award_winners`) and `getClubHonours(clubId)` (`award_winners` where `awards.category='award'`, `slug<>'brownlow-medal'`, `club_id` in lineage — Coleman/Norm Smith/All-Australian/Rising Star/etc.) in `src/db/queries/awards.ts`. `src/components/ClubHonours.tsx` (Brownlow table + national-honours `SortableTable`; unlinked winners render as plain text). Page wiring in `src/app/clubs/[slug]/page.tsx` — 6 queries into the existing `Promise.all`, 5 section blocks each guarded on non-empty data. **Most Games / Most Goals / Captains from the brief were already on the page** (Games leaders / Goalkicking leaders / Captains — preserved unchanged). **Unsupported attribution, deliberately omitted + reported:** `honour_team_members` (only `club_name_raw`, no `club_id`/season), `player_achievements` (0 rows), Brownlow winners with null `club_id`. Key files: `src/db/queries/clubs.ts`, `src/db/queries/awards.ts`, `src/components/Club{MatchRecords,CrowdRecords,Players,PremiershipPlayers,Honours}.tsx`, `src/app/clubs/[slug]/page.tsx`, `tests/integration/club-{match-records,crowd-records,players,premiership-players,honours}.test.ts` (new), `tests/club-records-sections.test.ts` (new), `CHANGELOG.md`. | **Operator:** `npx tsc --noEmit`; `npx vitest run tests/club-records-sections.test.ts`; with `AFLDB_TEST_DATABASE_URL`=`afldb_test`, `npx vitest run tests/integration/club-match-records.test.ts tests/integration/club-crowd-records.test.ts tests/integration/club-players.test.ts tests/integration/club-premiership-players.test.ts tests/integration/club-honours.test.ts`; then `npm run build`. On green: commit on `fable/issue-149-club-records`, merge, deploy to DEV, eyeball `/clubs/richmond` + one historical club (e.g. `/clubs/footscray` / `/clubs/western-bulldogs`) + a young club (`/clubs/gold-coast`) for the omit-when-empty paths, Resolve. |
| `AFLDB-ISSUE-150` | Low | Public UI / venue pages / database queries | **OPEN — IMPLEMENTATION COMPLETE. On the implementation workstation (tunnel to `afldb_test` up): `tsc` PASS, `eslint` 0 errors, `tests/venue-records-sections.test.ts` 12/12 (no DB), `tests/integration/venue-records.test.ts` 15/15 against `afldb_test`. NOT run: `ISSUE-150-venue-evidence.sql` eyeball (no `psql` here), `npm run build`, DEV deploy + browser smoke. Stays Open until merged and verified on DEV.** Branch `sonnet/issue-150-venue-records` (worktree `D:\dev\afldb-issue-150`), from merged `main` @ `00eea34` after ISSUE-149. `/venues/[slug]` rebuilt from a "recent 50 matches" list into a historical record page; **no migration**, no schema / index / route-privilege / deploy change; one new server-rendered route `/venues/[slug]/matches`. Five venue-scoped (`matches.venue_id`) typed query fns in `src/db/queries/venues.ts`, run in parallel, each mirroring `ISSUE-150-venue-evidence.sql`: **`getVenueOverview`** (total matches, recorded-attendance coverage, first + most recent linked match); **`getVenueClubRecords`** (W-D-L + win % `wins/games*100` — a draw is NOT half a win — for every historical club identity, grouped on the raw `clubs.id` from the match so Footscray ≠ Western Bulldogs; `games DESC, wins DESC, name, id`); **`getVenueRecords`** (highest / lowest **recorded** attendance — NULL never wins, a real 0 is a valid minimum — highest single-team score, biggest winning margin; every ORDER BY ends on a unique column); **`getVenuePlayerLeaders`** (top 5 games / goals / marks / kicks / handballs in one round trip — `games` counts `player_match_stats` rows, stat boards `SUM` only `WHERE <stat> IS NOT NULL` and never COALESCE a NULL to 0, carry `recordedGames`, and the marks/kicks/handballs boards are headed "Recorded"; ranked `value DESC, player_id`); **`getVenueMatches`** (`match_date DESC, id DESC`, `count(*) OVER ()` + empty-page fallback — the 50-row ceiling removed). Components `src/components/Venue{Records,ClubRecords,PlayerLeaders,MatchHistory}.tsx` (server, omit when empty). `src/app/venues/[slug]/page.tsx` rewritten (keeps `revalidate=86400` + `generateStaticParams`; Overview → Venue records → Club records → Player leaders → 10-match preview → link to the full log); new `src/app/venues/[slug]/matches/page.tsx` (`force-dynamic`, `?page=` 100/page, `<Pagination>`, `noindex` on filtered views) — the exact `/players/[slug]/matches` split. Not in `sitemap.ts`. Key files: `src/db/queries/venues.ts`, the four new components, both venue pages, `tests/venue-records-sections.test.ts` (new), `tests/integration/venue-records.test.ts` (new), `CHANGELOG.md`, `ISSUE-150-venue-evidence.sql` + `ISSUE-150-OPERATOR-VALIDATION.md`. | **Operator:** run `ISSUE-150-venue-evidence.sql` against `afldb_test` and eyeball the implementation output for MCG, a low-volume ground, first/latest match, W-D-L, win %, highest/lowest recorded attendance, highest score, biggest margin and each top-5 board (commands + captured smoke numbers in `ISSUE-150-OPERATOR-VALIDATION.md`); `npm run build` with a real `DATABASE_URL`. On green: commit on `sonnet/issue-150-venue-records`, merge, deploy to DEV, eyeball `/venues/melbourne-cricket-ground`, a low-volume ground and `/venues/melbourne-cricket-ground/matches` paging on desktop + narrow mobile, Resolve. |
| `AFLDB-ISSUE-151` | High | Production promotion tooling / `tools/db/promotion-*` / Grid Solver corpus | **OPEN — IMPLEMENTATION COMPLETE, awaiting review, merge and the resumed promotion.** Branch `sonnet/issue-151-promotion-lineage-fk` (worktree `D:\dev\afldb-issue-151`), from `main` @ `88ca994`; no migration. The first real production promotion (stamp `20260907-234124`, paused, candidate restored, three gates green) proved the generated plan plainly restored `external_grid_sources` (id 1, `ingest_source_id = 57`) into a candidate whose gridley `sources` row is id 7 with no id 57 — the NOT NULL immediate FK refuses before the evidenced AFLDB-ISSUE-142 remap (57 -> gridley -> 7) can run, and the inventory/checker/transcript/checklist disagreed on when that remap runs. Fix: the contract STAGES any reinstated table with a NOT NULL football reference that has a stable lineage identity (by shape; today exactly `external_grid_sources`) — `promotion-stage.sql` creates `promotion_staging.<t>` (LIKE copy, no FK); the transcript restores into it (`pg_restore -f - | sed`, grep-guarded, `psql --single-transaction`), runs `$LINEAGE_REMAP_SQL` at fixed step 2c (UPDATE targets the staging copy; file now written as an explicit no-op on a shared lineage), `promotion-promote-staged.sql` refuses any unsettled reference then `INSERT … OVERRIDING SYSTEM VALUE` (ids preserved, FK on insert) and drops the schema, then `external_grids`/`external_grid_axes` restore (2e). Validator refuses the plain restore, a misordered lifecycle and every constraint bypass. §7.4 nullable path and §7.4b `import_batch_id` decision unchanged. Docs §1/§6/§7/§7.2/§7.4b/§7.4c reconciled; checklist updated. **Hardening (2026-09-08 review):** (1) zero staged rows is never a legitimate state the promotion can distinguish from a skipped restore, so the invariant is asserted early — `--phase pre-cutover` gate `Staged tables hold rows in the replaced database` (`judgeStagedSourceRows`) refuses an empty/absent staged table before any plan exists, and the promote file keeps its empty-copy refusal; (2) an interrupted staged reinstatement fails closed — every checker phase runs `No leftover promotion_staging schema` (`judgeStagingLeftover`, FAIL with inspect-first instructions), `stagedPlanProblems` refuses `CREATE SCHEMA IF NOT EXISTS`, `DROP SCHEMA/TABLE IF EXISTS` and any `DROP SCHEMA` outside `promotion-promote-staged.sql`, and docs §7.2 'Interrupted staged reinstatement' requires inspection + a recorded finding before any hand drop or retry (§10 says the schema is never cleanup). **Validation:** `tests/db-promotion-check.test.ts` 96/96, `tests/workflow-preflight.test.ts` 24/24, `tsc` + `eslint` clean. NOT run: `ISSUE-151-staged-reinstate-rehearsal.sh` (no PostgreSQL server here). Key files: `tools/db/promotion-inventory.ts`, `tools/db/promotion-check.ts`, `tests/db-promotion-check.test.ts`, `docs/production-promotion.md`, `ISSUE-151-staged-reinstate-rehearsal.sh`, `CHANGELOG.md`. **Next:** operator runs the rehearsal on streamanator (throwaway DBs), reviews, commits, `merge:ready -- --issue 151`, merges, deploys the checkout to the prod host; then on afldb-prod moves the paused plan files + old remap aside, regenerates `--plan` for stamp `20260907-234124`, re-runs `--phase restored … --lineage-remap-out`, reads all eight files + the remap, and resumes at step 1 of the new transcript. Resolve after `--phase candidate` passes. |
| `AFLDB-ISSUE-153` | Low | Public UI / record pages / database queries | **OPEN — NOT INVESTIGATED BEYOND THE STAGE-0 READ. No implementation, no branch, no worktree.** Split out of `AFLDB-ISSUE-152` Stage-0 Finding F1 by operator decision 2026-09-08. **(1)** `/records/father-son` → `getFatherSonRecords` (`src/db/queries/family-records.ts:130`) reads `player_relationships WHERE relationship = 'parent_child'` and **never touches `father_son_selections`**, while the Grid Solver's `father_son_selection` / `father_son_father` builders (`src/db/queries/grid-solver.ts:1279`) read that AFL draft-rule table — two meanings of "father-son" in one product, over two tables, with no cross-reference. **(2)** `/records/family` → `getFamilyRecords` (`src/db/queries/family-records.ts:39`) groups **every** `relationship_type` by `family_key` with no `relationship` filter, while `src/app/records/family/page.tsx:15,99` says "a linked family of **siblings**" — a family linked only by a cousin, in-law or spouse row is counted and described as siblings. The stricter evidenced reading already exists in the codebase as `has_brother` (`relationship = 'sibling'` AND `relationship_label IN ('brothers','twin brothers')` AND the other side linked with games > 0). **SIZED AGAINST DATA 2026-09-08** (`ISSUE-152-nl-evidence-output.txt` §3.1/§3.2/§3.5/§4.1, `afldb_test`, read-only): **both halves are LATENT, not active.** `player_relationships` holds only `sibling` (498 rows, 378 `family_key`s) and `parent_child` (127 rows, **0 `family_key`s**) — zero cousin/in-law/spouse/grandparent/aunt-uncle/other rows — so `getFamilyRecords`' `family_key` grouping cannot presently return a non-sibling family, and `/records/family` is correct in fact but wrong by construction. `father_son_selections` (127 / 96 linked / 31 not) and `parent_child` (127 / 96 / 31) are **the same population**, every `parent_child` row carrying the label `father and son (AFL father–son rule selection)`, so `/records/father-son` is not serving a wrong set today — but nothing enforces it, and **no witness exists that distinguishes the two readings**. Labels measured: `brothers` 467, `siblings` 13, `sisters` 8, `twin brothers` 7, `twins` 3. **Unmeasured (M5):** combined career games per family — the metric the page actually orders by (§3.5 ranked by member count; largest family `ablett-0004` has 5 linked players but only 4 distinct names, ids 4700/4701 both "Gary Ablett"). This is a **semantic** decision, not a code-only fix: correct each page's prose, narrow each query, or split the boards — three defensible resolutions producing different public pages, and narrowing the father-son board would also need the unlinked-father rule decided. `AFLDB-ISSUE-152` depends on this for C1/FS1–FS3/FS6 and decisions D6/D8, but is **not blocked** by it for Phases B, C or E. Key files: `src/db/queries/family-records.ts`, `src/app/records/family/page.tsx`, `src/app/records/father-son/page.tsx`, `src/db/queries/grid-solver.ts`. | **Operator:** the sizing run is **done** (see state). Decide the intended semantics of each board — the choice is now a design decision on latent defects, not a live-defect repair — then allocate a branch/worktree and implement. Resolve only when both pages' prose and queries agree and the boards are eyeballed on DEV. |
| `AFLDB-ISSUE-152` | Medium | Natural-language search / semantic coverage / `src/search/nl/*` | **OPEN — PHASES B, C AND E COMMITTED AND VALIDATED; PHASE G RENDERED ACCEPTANCE COMPLETE AND GREEN 2026-09-09; PHASE D (UNBLOCKED HALF C2/C3/C4/FS4) IMPLEMENTED, RENDERED AND GREEN 2026-09-09 — P5-r2 319/319 AND A FRESH P4-r1 1,495/1,495; PHASE F IMPLEMENTED, RENDERED AND GREEN 2026-09-09 (runbook §26 implementation, §27 rendered acceptance) — X1 + X2 SHIPPED, X3 DEFERRED (F-D1), P6 349/349 AND A FRESH P4-r1 1,495/1,495; PHASE F IS ACCEPTED AND READY TO MERGE AS A STABLE CHECKPOINT BEFORE `AFLDB-ISSUE-153`; WORKING TREE CLEAN — B, C, D, E, F AND G ARE ALL COMMITTED ON THE BRANCH THROUGH `5be7511`; ISSUE-152 AS A WHOLE IS NOT CLOSED.** Branch `opus/issue-152-nl-record-expansion` (worktree `D:\dev\afldb-issue-152`) from `main` @ `c2761e6`. `PARSER_VERSION` **39** (B 34->35 `e8f5f67`, C 35->36 `47a645f`, E 36->37 `75d207d`, D 37->38 `6ee63a4`, F 38->39 `f619de8`). Built: **B** `coach_record` grain + 386-coach directory, false coaching decline deleted (**F2 CLOSED**), migration **092**; **C** `after_siren` event grain over 126 curated events with three independent dimensions and a match-link boundary, migration **093** (**M7 CLOSED**); **E** first-kick-goal E7/E8 with **no grain, no builder, no SQL and no migration** (**D11 SATISFIED / F4 CLOSED** — `afldb_test` batch 230: 334 updated / 0 inserted / 0 deleted; M-E1 334 total / 330 linked / 44 multi-kick / max consecutive 6 / 23 only-career-goal / 4 no-further-kicks / 1911-2026), three deliberate fail-closed deviations (§18.5). **PHASE G IS GREEN.** **P3-r2** (`issue152-phaseg-p3r2`, preserved `nl-ui-out-152-phaseg/p3-new-family-r2/`): **271/271 observed, 212 answered / 16 unanswerable / 43 absent, 271 pass, 0 fail, 0 unscored, 0 rate-limit detections, 0 page_error, 0 http_error, 0 filler disagreements, 0 client-side errors**, 3/3 batches. **P4-r1** (`issue152-phaseg-p4r1`, preserved `nl-ui-out-152-phaseg/p4-regression-r1/`): **1,495/1,495 observed, 1,435 answered / 60 unanswerable, 1,495 pass, 0 fail, 0 unscored**, every transport counter at zero, 15/15 batches — **the 1,435 + 60 gate is unchanged and still green** after three parser versions, two new grains and a deleted decline. Both sweeps ran against a **local production build of this branch** on `127.0.0.1:3100` at 2,200 ms / one worker, because DEV serves `main` and would measure the wrong code (§19.1). **P3-r1 was VALID at 269/270**; its sole failure was a corpus-contract defect — the unsuffixed "gary ablett" is AMBIGUOUS by the resolver's own rule (ids 4700/4701) and must not carry a `plan` expectation. Fixed by suffixing the plan row to "gary ablett jr" and adding the bare form as decline `fkg_dec_007`; final pinned corpus **271 = 212 plan + 59 decline**, **strict size guard KEPT**. Smoke r1 INADMISSIBLE (no 55432 tunnel, `ECONNREFUSED 127.0.0.1:55432`); **smoke r2 clean at 40/40**. `tools/issue-152/` is now a reusable tunnel/server/verify/smoke/P3/P4/status/diagnose workflow; preserved output is **immutable and refuses overwrite** (`tests/phase-g-preserve-static.test.ps1`, 30 assertions); `phase-g-verify.ps1` exits **0** on all six static gates. **Closeout validation 2026-09-09:** `npx tsc --noEmit` clean; **644/644** across 6 focused suites (parser 253, plan 136, describe 49, audit 10, ui-corpus 37, semantic-mapping 159); `phase-g-verify.ps1` PASS; preserve-static PASS. The 271-row and 1,495-row sweeps were deliberately NOT re-run — the closeout changed prose only. Four `tests/integration/database.test.ts` dataset counts still fail as external `afldb_test` baseline drift — out of scope, untouched. **PHASE D (unblocked half) is IMPLEMENTED, §22:** six new grid builders (catalogue 158 -> 164) over `player_relationships` — `has_afl_father`, `has_afl_son`, `has_afl_parent_or_child`, `brother_of_player`, `father_of_player`, `son_of_player` — with `has_brother` and `father_son_father` REUSED unchanged, a new typed `relationshipSubject` plan field, **no migration**, and relationship-explicit answer wording. Direction is role-typed (measured father -> son, 127 of 127), "brother" stays label-backed, an unlinked side is a name and never an identity, and the blocked father-son SELECTION forms still decline on their own leftover tokens. Red before green: the Stage-0 probe recorded **31/31 NONE** and was then deleted (§22.2). Green: `tsc` clean, parser **300/300** (47 new), plan **144/144**, describe **61/61**, grid-solver-spec **16/16**, nine further DB-free NL suites **485/485**, NL integration **174/174**, and the new DB-backed `tests/integration/nl-answers-relationships.test.ts` **20/20** against hand-written SQL. **Operator decision D20 is ACCEPTED 2026-09-09** (§22.5): relationship queries whose true result count exceeds 100 use AFLDB's EXISTING capped-list disclosure contract — true total computed and reported, existing capped table rendered, explicit "Showing 100 of N", and answer wording stating the displayed rows are not the whole list. Silent truncation is prohibited and NO Phase-D-specific refusal was introduced for 658 / 181 / 107. Held by five assertions in `tests/nl-describe.test.ts` and by the eight over-cap rows in the new corpus. **Two `tests/integration/grid-solver.test.ts` won-final failures are pre-existing and NOT Phase D** (282 vs 283, 3,644 vs 3,658; 69 insertions / 0 deletions in that file) — recommend allocating `AFLDB-ISSUE-154`. **PHASE D RENDERED CORPUS AND ACCEPTANCE HARNESS ARE BUILT, §23:** two additive tracked corpora — `tests/nl-ui/corpora/afldb-ui-questions-relationships-v1-20260909.csv` (**26** plan) and `...-relationships-decline-v1-20260909.csv` (**22** decline), 48 rows over C2/C3/C4/FS4 only, with one named decline row per boundary (C1/D6, C5/C6, FS1, FS2, FS3, FS6, vague family/related-to, sisters, twins, cousins, grandparents, uncles, in-laws, mothers, pairings, ambiguous subject, and the five unsupported scopes) and the **Ben Cousins** surname-collision regression preserved as a rendered pair. **Every one of the 48 rows was verified against `afldb_test` before being pinned** by a throwaway DB-backed probe that parsed, executed and rendered each one — 48/48 as claimed (17 parser declines + 5 `validatePlan` refusals; pinned negatives render as an ANSWER, not an empty panel; `sons of Gary Ablett Snr` resolves the FATHER, id 4700). **HISTORICAL PHASE G EVIDENCE DOES NOT MOVE:** the accepted P3 corpus stays **271 = 212 + 59** and `phase-g-new-corpus.ps1` still runs exactly it; Phase D APPENDS as a separate `current` set, **319 = 238 plan + 81 decline**, 4 Playwright batches, whose first 271 rows are byte-for-byte the 271-row file so §19.3's position-based statements survive. New runner `tools/issue-152/phase-d-corpus.ps1` (P5, run tag `issue152-phased-p5`) keeps every P3 guard — 2,200 ms at ONE worker, `NL_UI_LIMIT` refused not inherited, throttling as `page_error` and a hard failure, immutable `-OutName` — and adds four refusals of its own: a corpus that is not 319/238/81, a corpus that does not slice into 4 batches, the P3/P4 run tags, and a missing tunnel (TCP probe; **no psql or database client anywhere in the script**). Pins are stated three times independently (`PHASE_G_SETS.current`, `phase-d-corpus.ps1`, `tests/nl-ui-corpus.test.ts`). **Validation 2026-09-09:** `tsc` clean; **627/627** across parser/plan/describe/audit/query-intent/grid-solver-spec/nl-ui-corpus; **232/232** across the four remaining DB-free NL corpus suites; relationships integration **20/20**; semantic-mapping **22/22**; `phase-g-verify.ps1 -Set current` PASS with `playwright --list` enumerating **4** batches; `phase-g-verify.ps1` default PASS and UNCHANGED at 271/212/59 and 3 batches; preserve-static PASS. **Nothing in `src/` changed in this slice** — parser stays **v38**, no migration. **PHASE D RENDERED ACCEPTANCE IS NOW COMPLETE AND GREEN, §24:** **P5-r2** (`issue152-phased-p5r2`, preserved `nl-ui-out-152-phaseg/p5-phase-d-current-r2/`): **319/319 observed, 238 answered / 21 unanswerable / 60 absent, 319 pass, 0 fail, 0 unscored, 0 rate-limit detections, 0 page_error, 0 http_error, 0 filler disagreements, 0 client-side errors**, 4/4 batches. **P4-r1 re-run FRESH** (`issue152-phased-p4r1`, preserved `nl-ui-out-152-phaseg/p4-regression-phase-d-r1/`): **1,495/1,495, 1,435 answered / 60 unanswerable, 0 fail, 0 unscored**, every transport counter at zero, 15/15 batches — the 1,435 + 60 gate is UNCHANGED. **The FIRST P5 attempt was INADMISSIBLE** (stale pre-Phase-D standalone build) and is counted nowhere; a **fresh discriminator** proved Phase D relationship rendering on the rebuilt server BEFORE P5-r2. Historical Phase G P3/P4 preserved evidence is **untouched**; the accepted P3 corpus stays 271 = 212 + 59. **Closeout validation 2026-09-09** (no sweep re-run — no executable behaviour changed): `tsc` clean; **1,107/1,107** across 16 focused DB-free NL suites; `grid-solver-spec` **16/16**; relationships integration **20/20** and semantic-mapping **22/22**, DB-backed read-only against `afldb_test`; `phase-g-verify.ps1 -Set current` PASS (319/238/81, 4 batches); `phase-g-verify.ps1` default PASS and UNCHANGED (271/212/59, 3 batches); preserve-static PASS, 30 assertions; `git diff --check` clean. The authoritative `afldb_test` Stage-0 evidence remains the basis for every semantic claim. **C2, C3, C4 and FS4 are COMPLETE and GREEN; C1, C5/C6, FS1, FS2, FS3, FS6 and D6/D8 remain incomplete or blocked and are held only by named decline rows.** D6/D8 and F1 sit with `AFLDB-ISSUE-153`. **PHASE F IS PLANNED, NOT STARTED (§25):** its §9 gate is satisfied — Phase D is GREEN for the ISSUE-152-owned/unblocked scope (C2/C3/C4/FS4) — and the ISSUE-153-deferred semantics (C1, FS1-FS3, FS6, D6/D8) do NOT block it and remain explicit declines. Planned against measured read-only `afldb_test` evidence: **X1 = 365** (played AND actually coached, `match_coaches`-backed, NOT the 368 identity-only seam), **X2 = 27** (played Richmond AND coached Richmond; 41 coached-only, 14 never played there), **X3 = 1** (Rhyce Shaw 10974 / coach 233). **Two new builders only** — `has_coached` and `coached_club(organization)`, catalogue 164 -> 166 — with `played_for_club` and `father_son_selection` REUSED; **no grain, no plan field, no migration**; `coached_by` cannot serve and is not overloaded; **X2 sets no `scope.clubFor`** so `careerPredicatesOwnClubFor` cannot suppress the playing-club filter and answer 41 for 27; coached-club scope folds through `clubs.organization_id` (Pagan 3/2, Wallace 3/2, Laidley 2/1). **D9 unchanged: "also" ships, "later" declines by name and is never silently stripped** despite chronology being derivable (238/127/0). One parser bump, **v38 -> v39**. Corpus appends a `next` set, **349 = 252 plan + 97 decline**, 4 batches; the accepted 271 and 319 sets do not move. **PHASE F IS NOW IMPLEMENTED AND LOCALLY VALIDATED (§26).** All four operator decisions are FINAL: **F-D1** defers X3 to `AFLDB-ISSUE-153`; **F-D2** declines every temporal reading by name; **F-D3** declines one-sided club composition; **F-D4** approved the `played_for_club` reuse (0 zero-game memberships, 27, 365). Shipped: **X1** (365) and **X2** (27, plus the asymmetric and lineage forms). Catalogue **164 -> 166**; `PARSER_VERSION` **38 -> 39**; **no grain, no migration**; ONE plan field, `crossDomainClubs`, added because `describe.ts` cannot turn an organization id into a club name — a recorded deviation from §25.5, validated so the named clubs and the bound parameters can never drift apart. Three refusals live INSIDE the reading and not in `validatePlan`, because this reading clears `clubAgainst` and consumes its own cues: temporal wording, any father-son wording (the F-D1 back door), and an opponent — the last found by measurement, when the first corpus verification run answered "played and also coached against Carlton" with 27 Carlton people. **Validation:** R0 red-before-green recorded (§26.1 — no Phase F wording answered under v38; the predicted `coach_record` election IS real for one wording and was stopped by `validatePlan`, not by confidence); `npm run typecheck` PASS; **3,777** DB-free tests pass (2 pre-existing unrelated failures, §26.9); the NEW **`tests/integration/nl-answers-cross-domain.test.ts` 21/21** against hand-written SQL — X1 **365** and provably not the 368 identity seam, X2 Richmond **27**, `coached_club(18)` alone **41**, the Pagan/Wallace/Laidley lineage traps, both Aaron Black identities, D20 365/100 — and **215/215** across all 11 NL integration suites. Corpus: two new tracked CSVs (15 plan / 15 decline), `PHASE_G_SETS.next` = **349 = 253 plan + 96 decline**, 4 batches, **every row verified against `afldb_test` BEFORE pinning** (30/30); the frozen 271, 319 and 1,495 sets do not move. `tools/issue-152/phase-f-corpus.ps1` (P6, run tag `issue152-phasef-p6`) keeps every P3/P5 guard. **"Richmond players coached by Damien Hardwick" (§13.15(4)) was NOT implemented and still refuses at `validatePlan`** — it is named IN by §25.1 but specified nowhere else, has no measured population, and its two readings are exactly the ambiguity F-D3 declines (§26.8). **PHASE F RENDERED ACCEPTANCE IS NOW COMPLETE AND GREEN, §27.** A fresh production `npm run build` of this branch PASSED and was served standalone on `127.0.0.1:3100`; the **mandatory stale-build discriminator** then returned **HTTP 200** and **"365 players match"** for `/search?q=players+who+also+coached`, which no pre-Phase-F build can produce — and **D20 rendered correctly in the same check**, "Showing 100 of 365" with the answer text explicitly stating the displayed rows were NOT the whole list. **P6** (`issue152-phasef-p6`, preserved `nl-ui-out-152-phaseg/p6-phase-f-next/`): **349/349 observed, 253 answered / 25 unanswerable / 71 absent, 349 pass, 0 fail, 0 unscored, 0 rate-limit detections, 0 page_error, 0 http_error, 0 filler disagreements, 0 client-side errors**, 4/4 batches. **P4-r1 re-run FRESH** (`issue152-phasef-p4r1`, preserved `nl-ui-out-152-phaseg/p4-regression/`): **1,495/1,495, 1,435 answered / 60 unanswerable, absent 0, 0 fail, 0 unscored**, every transport counter at zero, 15/15 batches — the 1,435 + 60 gate is UNCHANGED. Two corrections were made during acceptance and **neither is semantic**: `2ec9871` fixed two test type contracts (`matchType: 'final'` -> `'finals'`, and a hand-copied set union replaced by the imported `PhaseGSetName`), and `5be7511` added `next` to the shared `ValidateSet` in `tools/issue-152/phase-g-common.ps1` so `phase-f-corpus.ps1` could ask for its own set — **harness-only, no semantic change**. The frozen 271, 319 and 1,495 sets and every preserved historical run are untouched. **C1, FS1, FS2, FS3, FS6, D6, D8 and X3 remain DEFERRED to `AFLDB-ISSUE-153`, are each held by a named decline row in the rendered corpus, and are NOT Phase F failures.** Key files: `issues/open/AFLDB-ISSUE-152.md` (§14 B, §16 C, §18 E, **§19-§21 Phase G**, **§22 Phase D implementation**, **§23 Phase D corpus/harness + D20**, **§24 Phase D rendered acceptance**, **§26 Phase F implementation**, **§27 Phase F rendered acceptance**), `src/search/nl/{vocab,parser,plan,describe}.ts`, `src/search/grid-solver-spec.ts`, `src/db/queries/grid-solver.ts`, `tools/issue-152/*` (incl. `phase-d-corpus.ps1`, `phase-f-corpus.ps1`, `phase-g-common.ps1`, `build-phase-g-corpora.ts`), `tests/nl-ui/corpora/afldb-ui-questions-relationships*-v1-20260909.csv`, `tests/nl-ui/corpora/afldb-ui-questions-cross-domain*-v1-20260909.csv`, `tests/integration/nl-answers-cross-domain.test.ts`, `tests/nl-ui/nl-stress.spec.ts`. | **Operator:** **(1)** **Review and merge the Phase F checkpoint.** Phases B, C, D (unblocked half), E, F and G are all implemented, rendered and green and are **committed on `opus/issue-152-nl-record-expansion` through `5be7511`**; the working tree is clean apart from untracked ISSUE-152 evidence/probe `.sql`/`.txt` files in the worktree root, which are local evidence and must NOT be staged. **Phase F is ACCEPTED and ready to merge as a stable checkpoint before `AFLDB-ISSUE-153` begins.** **(2)** **Deploy ordering is unchanged and non-negotiable: migrations 092 AND 093 must both reach `afldb_dev` and production BEFORE the code**, or the telemetry grain CHECK drops rows silently while answers render correctly. **(3)** Decide whether `nl:stress` runs before deploy — it has still NOT been run for B, C, D, E or F. **(4)** **Do NOT resolve ISSUE-152.** Phase F acceptance closes **X1** and **X2** only; **C1, FS1, FS2, FS3, FS6, D6, D8 and X3 remain deferred to `AFLDB-ISSUE-153`**, are each held by a named decline row in the rendered corpus, and are **not** Phase F failures. **"Richmond players coached by Damien Hardwick" is still a decline** (§26.8), and the two DB-free failures of §26.9 and the two `tests/integration/grid-solver.test.ts` won-final failures of §24.8 are pre-existing and outside ISSUE-152 — recommend allocating `AFLDB-ISSUE-154` for the latter. **(5)** To re-run rendered acceptance later: `phase-g-tunnel.ps1` (window 1), `phase-g-server.ps1` (window 2), then `phase-g-verify.ps1`, `phase-g-smoke.ps1`, and the runner for the set under test — `phase-g-new-corpus.ps1` (271), `phase-d-corpus.ps1` (319), `phase-f-corpus.ps1` (349), `phase-g-regression.ps1` (1,495) — each with a FRESH `-RunTag` because preserved output will not be overwritten, each behind a fresh production build of the branch under test, and each behind the **mandatory stale-build discriminator**. |
| `AFLDB-ISSUE-148` | Low | Public UI / club pages / database queries | **OPEN — coaching section IMPLEMENTATION COMPLETE and operator-validated; Premierships section added the same day (same issue), implemented + `tsc`-checked, its integration suite written but NOT yet operator-run. Stays Open until merged and verified on DEV.** Branch `fable/issue-148-coach-club-records` (worktree `D:\dev\afldb-issue-148-coach-club-records`). Two sections added to every AFL club page, both from canonical `matches`, no migration. **(1) Coaches:** `getClubCoachRecords(clubId)` in `src/db/queries/coaches.ts` (lineage-scoped by `organization_id` — exactly `getClubTotals`/`getClubLeaders`, no new club-identity semantics; W/D/L from `matches.winner_club_id` so `games = W + D + L`; distinct seasons in charge; draw-weighted win % `(W + D/2)/G` matching `/records/coaches`/`getCoachCareer` — the evidence file's plain `W/G` not adopted; one row per coach, separate tenures combined). `src/components/ClubCoachRecords.tsx` — "Coaches" section, Coach · **Span** · Games · W · D · L · Win % ("Span" = `formatSpan(firstSeason, lastSeason)`, a first/last range; coach names link to player / `/coaches/[slug]-id`), pushed after Captains, omitted when empty. **(2) Premierships:** `getClubPremierships(clubId)` in `src/db/queries/clubs.ts` — one row per **won Grand Final** (`m.round_type = 'grand_final'`, the canonical predicate `getCoachCareer`/Grid Solver use — not every final, never a Wildcard Final; a drawn GF has a null winner so the replay is the row), opponent = the non-winner club home-or-away, score from the winner's perspective, venue via `COALESCE(v.canonical_name, m.venue_raw)` + `v.slug`, crowd = `m.attendance` left null (never zero-filled), lineage-scoped so Footscray/Western Bulldogs share 1954+2016, no hand-kept year list, `ORDER BY season DESC`. `src/components/ClubPremierships.tsx` — "Premierships" section, Year · Opponent · Score · Venue · Date · Crowd (opponent → `clubPath`, venue → `venuePath`, `formatDate`/`formatAttendance`), pushed **first**, omitted when empty. **NO migration**, no schema/route/privilege/deploy change. Key files: `src/db/queries/coaches.ts`, `src/db/queries/clubs.ts`, `src/components/ClubCoachRecords.tsx`, `src/components/ClubPremierships.tsx`, `src/app/clubs/[slug]/page.tsx`, `tests/integration/club-coach-records.test.ts` (new), `tests/club-coach-records.test.ts` (new), `tests/integration/club-premierships.test.ts` (new), `tests/club-premierships.test.ts` (new), `CHANGELOG.md`. **Validation:** coaching — operator, `afldb_test` via SSH tunnel: `tests/club-coach-records.test.ts` 8/8 PASS, `tests/integration/club-coach-records.test.ts` 9/9 PASS, `npx tsc --noEmit` PASS, `npm run build` PASS. Premierships — `npx tsc --noEmit` self-checked; `tests/integration/club-premierships.test.ts` NOT yet operator-run. No migration. | **Operator:** run `npx vitest run tests/club-premierships.test.ts` and, with `AFLDB_TEST_DATABASE_URL`=`afldb_test`, `npx vitest run tests/integration/club-premierships.test.ts`; `npx tsc --noEmit`. On green: commit on `fable/issue-148-coach-club-records`, merge, deploy to DEV, eyeball `/clubs/richmond` + one historical club (both sections), Resolve. |
<!-- RETIRED 2026-09-06 — `AFLDB-ISSUE-145` is **Resolved** and is NO LONGER an open issue.
     The row below is the pre-resolution index row, kept only as lineage; its "OPEN" text is
     SUPERSEDED. The existing `/venues` index is now exposed in site navigation; validated
     (`tsc --noEmit` clean, focused nav Playwright test passes on desktop / skips on mobile,
     `npm run build` exit 0 with `/venues` still present). Navigation exposure only — no migration,
     no schema, no query, no new route. Authoritative record: the `AFLDB-ISSUE-145` entry in
     `issues.md` (Resolution — 2026-09-06), summarised in the closeout note at the top of this file.
| `AFLDB-ISSUE-145` | Low | Public UI / navigation | **OPEN — implementation complete 2026-09-06 on `sonnet/issue-145-venues` (worktree `D:\dev\afldb-issue-144-venues`), UNCOMMITTED; awaiting the focused nav Playwright check, then Resolved.** The `/venues` index, its `listVenues` query and its data already shipped, but nothing linked to it — the AFL `PRIMARY_NAV` had no Venues entry and the home "Browse the record" grid had no Venues card, so the page was reachable only by search or a typed URL (the AFLW nav already listed `/aflw/venues`). Recreated directly against current `main` after an earlier stale-base patch failed to apply: `Venues` entry after `Seasons` in `PRIMARY_NAV` (`src/components/SiteNav.tsx`; mobile `TABS` and the AFLW navs untouched), `Venues` card after `Seasons` in the "Browse the record" grid (`src/app/page.tsx`), a focused reachability test in `tests/e2e/journeys.spec.ts` mirroring the match-search one, and one Unreleased `CHANGELOG.md` entry. **No migration number, no schema, no query, no new route.** | Run `npx playwright test tests/e2e/journeys.spec.ts -g "venues is reachable from the primary navigation"` (expect pass; mobile projects skip it). Then commit/merge per normal workflow and mark Resolved. |
-->

<!-- RETIRED 2026-09-06 — `AFLDB-ISSUE-143` is **Resolved** and is NO LONGER an open issue.
     The row below is the pre-resolution index row, kept only as lineage; its "OPEN" and
     "Design and implement" text is SUPERSEDED. Authoritative record: the `AFLDB-ISSUE-143`
     entry in `issues.md` (Resolution — 2026-09-06), summarised in the closeout note at the
     top of this file.
| `AFLDB-ISSUE-143` | High | Operations / Database tooling / Data integrity | **OPEN — found 2026-09-06 during ISSUE-139 Phase 4C′ (read-only; no code changed).** `docs/production-promotion.md` §7.4c documents two supportable treatments for lineage-unresolvable ledger rows (historical not-live ledger, or recorded gap) plus a deferred current-season `data_edits` remap, but `gateLineageIdentity` FAILs on any unresolved row, identity `none` makes every `player_link_resolutions.target_id` row unresolved by construction, the generated plan cannot omit a table, the gate reads the old database, and the `candidate` compare would refuse an omitted table — so a DEV promotion can never pass `restored` under either answer. Production unaffected (same lineage). Key files: `tools/db/promotion-check.ts` (`gateLineageIdentity`), `tools/db/promotion-inventory.ts` (`resolveLineageRemap`, `lineageRefs`, `reinstatePlan`), `tests/db-promotion-check.test.ts`, `docs/production-promotion.md` §7.4c/§13. | Design and implement an explicit, audit-marked per-table lineage disposition (`historical` / `gap` + deferred current-season remap) honoured by the `restored` gate, the reinstate plan, the `database.promoted` marker and the `candidate` compare; fail-closed by default, refused under `--environment prod` unless the same evidence applies. Fresh worktree at Fable High / Opus High. Honour ISSUE-139's recorded D1/D2. Blocks `AFLDB-ISSUE-139` Phase 4E. |
-->

<!-- RESOLVED 2026-09-06 (§23.38) — `AFLDB-ISSUE-118` is **Resolved** and is NO LONGER an open issue.
     After-siren integrated into the deterministic rebuild (data stage + `after-siren-reconcile`); FK
     index migration `090` added the one ISSUE-118 migration 086 left off. Full `afldb_test` rebuild:
     22 stages, FINAL VALIDATION 85 checks, after-siren reconcile 38/38. Final Gridley corpus
     (diagnostic) 1,164/1,164: 9,854 cells solved, `incorrect known answer` 0, ISSUE-118 timeouts 0,
     residual unsupported = exactly the seven §23.36 accepted deferrals. 638 ISSUE-118-domain tests
     pass; `tsc` clean. Authoritative records: `issues.md` (Resolution, 2026-09-06) and
     `issues/closed/AFLDB-ISSUE-118.md` §23.38. Branch `claude/issue-118` pushed, not merged.
     Follow-up (not blocking): DEV load, production deploy (ISSUE-137), International Rules scope,
     `AFLDB-ISSUE-138` (`external_grid_*` privilege-registry drift). -->
<!-- 2026-09-05 (superseded by the REOPEN the same day; kept as history) — `AFLDB-ISSUE-118` was
     marked **Resolved**: merged, deployed to DEV and PROD, accepted on both; see `issues.md`
     (Resolution, 2026-09-05) and runbook §22.12. -->
<!-- RETIRED 2026-09-04 — `AFLDB-ISSUE-131` (an upstream match rekey duplicates the canonical match
     instead of updating it) is **Resolved** and is NO LONGER an open issue. The fail-closed
     rekey-in-place fix is merged (`657a875`) and deployed; runbook §8's production acceptance is
     reconstructed and accepted in `issues/closed/AFLDB-ISSUE-131.md` §16 from state the pipeline
     persists. Read-only production confirmation 2026-09-04 13:27 AEST: **0 duplicate 2026 fixture
     groups**, 209 canonical 2026 matches (207 home-and-away + 2 wildcard_final), settle batches
     735-739 all `completed` (735 applied 2 matches / 2 period sets / 83 player rows, source
     completeness `complete`, 0 refusals, 0 findings; 736-738 identical no-op reruns with zero
     ledger rows; 739 the nightly timer, also zero), no `data_issues` opened, timer **active**.
     `repair-match-rekeys` shipped and was correctly not needed (0 duplicates before the deploy,
     runbook §15.2). Not retained: the R preflight, repair dry-run and settle dry-run transcripts —
     each superseded by stronger persisted state (§16.5). `canonicalMatchesRekeyed = 0` on every
     production run, so the rekey path itself is proven by the `afldb_test` suite, not by a field
     firing (§16.6). Deferred, non-blocking (§16.8): §9.4/§7 hardening index and §9.6/§5.2 `game_id`,
     both unmeasured and NOT adopted (no migration); dev's 17 empty historical duplicate rows
     (separate supervised cleanup, no DELETE proposed); `AFLDB-ISSUE-134`; and re-measuring batch
     735's nine unresolved-identity rejections after `AFLDB-ISSUE-137`. Authoritative records: the
     `AFLDB-ISSUE-131` entry in `issues.md` (Resolution, 2026-09-04) and
     `issues/closed/AFLDB-ISSUE-131.md` §16. -->
<!-- RETIRED 2026-09-04 — `AFLDB-ISSUE-126` is **Resolved** and is NO LONGER an open issue.
     The row is DELETED, not merely commented out, so it cannot render as an open row under any
     renderer. Production-only state stranded by the 2026-09-02 cutover was decided per table and
     the approved subset restored to `afldb_prod` on 2026-09-04 (T1 92 audit rows with original
     ids 90–181, T2 7 `site_settings` + 1 `site_media`, T5 all eight `staging_aflw` tables =
     51,018 rows, T6 the `database.recovered` marker id 182); the spent beta code, 17 expired
     sessions, the join request, 2 `data_edits`, 8 player-link rows and colliding telemetry were
     deliberately retired and recorded. Database acceptance all PASS and browser acceptance all
     PASS — the operator's post-recovery super-admin login is audit id 183, and `/`, `/aflw`,
     `/aflw/seasons`, `/aflw/seasons/2025` and an AFLW match page all render the recovered state.
     The two public pages that looked stale straight afterwards were ISR output on the one-hour
     window (`AFLDB-ISSUE-133`/`-134` mechanisms, per-worker page cache included) and converged on
     their own; **no defect, no new issue, no application/schema/migration/privileges change, and
     nothing merged or deployed.** `afldb_prod_auth_recovery` is **still retained** — dropping it
     needs separate explicit approval. Committed on `claude/issue-126`, not merged. It claims
     **NO migration number** (`086` still next free) and **next free issue ID is still
     `AFLDB-ISSUE-138`.** Authoritative records: the `AFLDB-ISSUE-126` entry in `issues.md`
     (Resolution — 2026-09-04) and `issues/closed/AFLDB-ISSUE-126.md` §8.2/§8.3/§10. -->
<!-- RETIRED 2026-09-04 — `AFLDB-ISSUE-124` is **Resolved** and is NO LONGER an open issue.
     `deploy/afldb.service` moved `StartLimitIntervalSec=120`/`StartLimitBurst=5` from `[Service]`
     to `[Unit]` (commit `146b3e0`, branch `claude/issue-124`), values unchanged; the other four
     `deploy/` units carry no second occurrence. Dev D1-D4 green on `streamanator` (in-place
     relocation, not a file copy). **Production P1-P5 green 2026-09-04** under operator-authorised
     **Option B** — the tracked unit installed as a file behind a host-side `diff` gate that
     returned only this issue's relocation and comment move (net +9 lines, no W1/W2/W3, both md5s
     pinned at install time): `systemd-analyze verify` clean, `StartLimitIntervalUSec=2min`
     (was `10s`), `StartLimitBurst=5`, `MainPID=803941` **unchanged**, `active`, `root root 644`,
     loopback and `https://beta.afldb.com/api/health` both ok, **no service restart**. Option B was
     safe on production only because W1-W3 were already installed and live there before this issue
     — measured read-only pre-change; runbook §5.4.1 is corrected accordingly and the evidence is
     §5.4.2. The withheld set therefore remains outstanding **on dev only**, as a routine gated
     deployment of already-reviewed tracked configuration, not a tracked defect. No migration,
     schema, `privileges.sql`, `.env`, timer, polkit or database change; `086` still next free.
     Authoritative records: the `AFLDB-ISSUE-124` entry below (Resolution, 2026-09-04) and
     `issues/closed/AFLDB-ISSUE-124.md` §7.3. -->
<!-- RETIRED 2026-09-04 (ISSUE-123 closeout) — `AFLDB-ISSUE-123` (current-season settle
     performance is unmeasured at steady state) is **Resolved: measured; no optimisation
     warranted** and is NO LONGER an open issue. The measurement the issue was held open for now
     exists. Production's scheduled nightly firing ran **2026-09-04 04:31:21 -> 04:31:56 AEST =
     35.0 s wall / 21.277 s CPU**, `Result=success`, against `TimeoutStartSec=1h` (**0.97 % of
     budget**): acquire 14 s, adjudicate 2 s, and **19 s for the entire per-record settle phase
     over 9,823 records / 209 matches / 9,614 player-match rows**, writing 0 canonical rows, 0
     ledger rows, source completeness COMPLETE (batch 739), with 0 open pending candidates, 0 open
     apply failures and 0 open source disagreements. Production shows **0 deadlocks / 0 conflicts**
     on `afldb_prod`, no settle batch in any status but `completed` in all 25 settle rows, and a
     next timer elapse of 2026-09-05 04:34:59 — no contention, no long-running query, no timeout,
     no failed or stuck batch, no backlog, no possible overlap at a 0.04 % duty cycle. The ~1 hour
     that opened the issue was batch **731**, a one-time whole-season backfill of 10,582 canonical
     + 9,133 ledger rows preceded by a full dry-run pass; it is not the scheduled workload.
     **No performance code was changed** — the ISSUE-122 SC2/SC3/SC4 invariants are preserved by
     construction and were re-confirmed at `413d1d3`. Read-only production inspection only: no
     settle triggered, no cadence altered, nothing mutated, `AFLDB-ISSUE-137` untouched. No
     `CHANGELOG.md` entry (measurement and tracking only, no retained behaviour change); `086`
     still next free migration number. Committed on `claude/issue-123`, not merged. Authoritative
     records: the `AFLDB-ISSUE-123` entry in `issues.md` (Resolution — 2026-09-04) and
     `issues/closed/AFLDB-ISSUE-123.md`. -->
<!-- RETIRED 2026-09-04 — `AFLDB-ISSUE-113` (replace legacy `brownlow_season_votes` acquisition) is
     **Resolved** and is NO LONGER an open issue. Authoritative records: `issues.md` (Resolution —
     2026-09-04) and `issues/closed/AFLDB-ISSUE-113.md` §8.18. Tracked artefact `data/brownlow/`,
     loader `tools/migration/import_brownlow_season.py`, `brownlow-season` rebuild stage; V1-V13
     green on the canonical `afldb_test` rebuild with the ISSUE-136 fold (V12 105 passed / 0 failed;
     V13 idempotent, fingerprints unchanged). Committed on `claude/issue-113`, not merged, not
     deployed. Production remediation → `AFLDB-ISSUE-137`. -->
<!-- RETIRED 2026-09-08 — `AFLDB-ISSUE-110` (Problem Search semantic triage and
     club-career games) is **Resolved** and is NO LONGER an open issue. All acceptance
     gates green on `opus/issue-110-semantic-closeout` at `165313f`: DB-backed
     `nl-answers-team-club` 26/26; DEV redeploy; the 26 previously failing grouped-`games`
     questions 26/26 rendered; realistic UI corpus 1,435/1,435; decline corpus 60/60; zero
     HTTP/page/client/hydration/metamorphic errors throughout. Parser v33 -> v34 (`games`
     admitted as the un-predicated grouped team-result metric behind an explicit club
     subject). No migration/schema/privilege/route/deploy change; NL corpus unchanged;
     production untouched. Authoritative records: the `AFLDB-ISSUE-110` entry in `issues.md`
     (Resolution — 2026-09-08) and `issues/closed/AFLDB-ISSUE-110.md`. -->
<!-- RETIRED 2026-08-30 — `AFLDB-ISSUE-114` (ladder witness `manifest_sha256` was the pre-ISSUE-108 CRLF hash) is **Resolved** and is NO LONGER an open issue. Contract literal repaired to the canonical LF hash `604a8a16…8d3f`, value-asserted in `tests/db-test-rebuild.test.ts`; operator run `npm test -- tests/db-test-rebuild.test.ts` = **214 passed, 0 failed**. Authoritative record: the `AFLDB-ISSUE-114` entry in `issues.md` (Resolution, 2026-08-30). -->
<!-- RETIRED 2026-08-30 — `AFLDB-ISSUE-115` (Data QA multi-domain composable queries) is **Resolved**
     and is NO LONGER an open issue. Stages 0–8 complete on worktree `D:\dev\afldb-issue-115` /
     branch `claude/issue-115`; not merged or deployed. Final evidence: spec suite 24/24, integration
     suite 23/23 (47/47 across both, including the T-C11 cost gate under 1000 ms at the normal 5 s
     timeout), `npx tsc --noEmit` clean, `docs/search.md` §6 reviewed GREEN. Evidence-driven V1
     boundary: `player_match_stats` remains a valid results anchor but hosts no related-domain
     cards; all 12 relationships stay available via the other four anchors; `maxRelatedCards = 4`.
     Authoritative records: the `AFLDB-ISSUE-115` entry in `issues.md` (Resolved, 2026-08-30) and
     `AFLDB-ISSUE-115.md` §20. The pre-existing PMS anchor baseline is `AFLDB-ISSUE-116` below. -->
<!-- RETIRED 2026-09-01 — `AFLDB-ISSUE-120` is **Resolved** and is NO LONGER an open issue.
     F1 (per-IP NL `/search` limiter, 30/60 s, friendly HTTP 200 denial, fail-open), F2
     (`/api/health-event` 32 KiB streaming body cap → 413) and F3 (`Object.hasOwn` guards on the
     two request-derived catalogue lookups) are implemented and merged into dev as `21d7c60`.
     Static/unit closure: 4 focused suites 19/19, `npx tsc --noEmit` clean. Dev live end-to-end
     acceptance 2026-09-01: an authenticated beta browser loop against
     `http://10.0.40.100:8090/search?q=…` was allowed 1–30 and denied on request 31 exactly at the
     budget (`limitedAt: 31`, `hits: {4: 31}`); a read-only `nl_search_log` check showed exactly
     30 rows for the 31 requests (the denied request wrote no telemetry row); an oversized
     `POST /api/health-event` returned 413. An earlier unauthenticated 140-request loop against the
     app origin was invalid — the beta gate 307-redirects before the NL limiter runs.
     Authoritative records: the `AFLDB-ISSUE-120` entry in `issues.md` (Resolution, 2026-09-01) and
     `issues/closed/AFLDB-ISSUE-120.md` §12–§16. The production `AFLDB_BETA_GATE` re-adjudication
     recorded there still stands as a launch precondition. -->
<!-- RETIRED 2026-09-04 — `AFLDB-ISSUE-116` is **Resolved** and is NO LONGER an open issue.
     `runQueryBuilder` no longer carries the total on the page as `count(*) OVER ()`. The page and
     the count are two statements inside one `REPEATABLE READ READ ONLY` transaction sharing one
     compiled `WHERE` fragment; a short page derives its own exact total, so the count statement is
     skipped entirely for single-page and empty results; and `SET LOCAL jit = off` precedes the
     count, whose unlimited cost estimate crossed `jit_above_cost` and cost ~1.15 s of JIT
     compilation for 75 ms of work. Measured on `afldb_test` (PostgreSQL 16.15, 55432 tunnel):
     `player_match_stats` anchor alone **1144.5 → 353.4 ms**, `players x player.captaincies NOT
     EXISTS link_status=unique` **1073.4 → 320.9 ms**, both under the 1,000 ms T-C11 target, with
     `AFLDB_STATEMENT_TIMEOUT_MS` unchanged at 5000, no index and no schema change. The PMS
     anchor-alone gate was tightened from CEILING_MS to BOUND_MS. Filtering, sort, pagination,
     exact-total, parameterisation and timeout semantics are unchanged; the one deliberate
     correction is that a page past the end now reports the real total instead of 0.
     `QUERYABLE_TABLES.player_match_stats.subjects` stays `[]` (re-admission recorded as a separate
     future decision); `AFLDB-ISSUE-115` was not reopened. Authoritative records: the
     `AFLDB-ISSUE-116` entry in `issues.md` (Resolution, 2026-09-04) and
     `issues/closed/AFLDB-ISSUE-116.md`. -->
<!-- RETIRED 2026-09-04 — `AFLDB-ISSUE-104` is **Resolved** and is NO LONGER an open issue.
     Closed as **NOT REACHABLE**, not fixed, and the old "ISSUE-099 is the only writer" premise is
     SUPERSEDED: a second `issue_key` writer now exists (`canonical_apply_failed`, owner
     `AFLDB-ISSUE-122`), but it carries a distinct `issue_type` and a disjoint key prefix
     (`afltables|apply|…`), so it can never contend for ISSUE-099's index entry. The owner-blind
     `ON CONFLICT` is unchanged and is safe only because each `issue_type` in the keyed namespace
     has exactly one owner. No code, schema, migration or test change; migration 076 untouched.
     Authoritative records: the `AFLDB-ISSUE-104` entry in `issues.md` (Resolution, 2026-09-04) and
     `issues/closed/AFLDB-ISSUE-104.md`. Binding reopen trigger: a second owner writing an
     `issue_type` another owner already writes with a non-NULL `issue_key`; the two `issue_type`
     literals converging; or any writer outside `settle-afltables.ts` populating `issue_key`.
     Guard test: `tests/current-season-import.test.ts:3833-3846`. -->
<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-105` is **Resolved** and is NO LONGER an open issue.
     Do not read the commented-out row below as current: it is the pre-resolution index row,
     kept only as lineage, and its "NOT yet validated" / "next action" text is SUPERSEDED.
     Authoritative record: the `AFLDB-ISSUE-105` entry in `issues.md` (Resolution, 2026-08-29).
     Final evidence, user-run: `current-season-import` 178/178; `settle-afltables` integration
     19 passed / 1 skipped; `afl-api-lineup-store` integration 10 passed / 1 skipped;
     `observation-spine` 13/13. **Both skips are the restricted `afldb_import`-role parity
     cases, skipped because `AFLDB_TEST_IMPORT_DATABASE_URL` is unset — they did NOT run.**
     Not a blocker: no privilege, role, schema or migration behaviour changed, and the
     representation was proved through real PostgreSQL `RETURNING`/binding paths. No
     migration (077 remains the highest, untouched) and no runtime data-format change.

| `AFLDB-ISSUE-105` | Low | Data acquisition / Import architecture / Type safety | postgres.js returns uncast `import_batches.id` (`bigint`) as a **string** while several call sites declared `number`. **Adjudicated and IMPLEMENTED 2026-08-29, NOT yet validated.** Convention: an opaque branded **string** `ImportBatchId`, decoded once at the driver boundary by a fail-closed `asImportBatchId()` — new `src/lib/import-batch-id.ts`. Applied to every TS `INSERT INTO import_batches ... RETURNING id` and every signature carrying a batch id (observation-store, settle, lineup-store, current-season, ingest pipeline/datasets, submissions page, first-kick-goal tool). **No schema/migration change** (077 stays frozen); **no `bigint`→`int` cast** — seven pre-existing test casts removed; **no `Number()` narrowing** — the ISSUE-099 `Number(result.batchId)` workaround is gone. Runtime behaviour is unchanged: every value was already a string. Next action: run `npm test -- tests/current-season-import.test.ts`, then the settle and lineup integration suites. |
-->

<!-- No open rows follow. Everything below is retired lineage only: ISSUE-106 (retired
     2026-08-29) and ISSUE-093 (retired 2026-08-27). The open issues are ISSUE-104, -110,
     -113 and -116, listed above. -->

<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-106` is **Resolved** and is NO LONGER an open issue.
     Do not read the commented-out row below as current: it is the pre-resolution index row,
     kept only as lineage, and its "Next action" text is SUPERSEDED.
     Authoritative record: the `AFLDB-ISSUE-106` entry in `issues.md` (Resolution, 2026-08-29).
     Final semantics: absent/NULL/empty `period_scores` all mean the source published NO
     period-score evidence, so `match_period_scores` is **not established**,
     `proposedPeriodScoreValues()` returns `null`, and no empty-array candidate can be
     created. Published periods are preserved exactly (partial publication included, NULL
     stays NULL, no periods 5+ invented). Deliberate accounting corrections: a rejected
     record with `projection: null` establishes `matches` only, so the settle suite's
     rejected-record expectation is 4 candidates / 3 rejections, and `observationsUnchanged`
     — which counts reconciliation outcomes per **established** target — is 4, not 5.
     Final evidence, user-run: `current-season-import` 180/180; `settle-afltables` integration
     19 passed / 1 skipped. **The skip is the restricted `afldb_import`-role parity case,
     skipped because `AFLDB_TEST_IMPORT_DATABASE_URL` is unset — it did NOT run.** Not a
     blocker: no privilege, role, schema or migration behaviour changed. No migration (077
     remains the highest, untouched) and no change to the canonical period-score
     representation.

| `AFLDB-ISSUE-106` | Low | Data acquisition / Import architecture | `proposedPeriodScoreValues()` returns `{ period_scores: [] }` instead of `null` for a match with no published quarter scores, so it would raise an **empty** `match_period_scores` candidate — the sibling of the Brownlow defect ISSUE-099 D2 fixed. **Unreachable in the real T8 snapshot** (all 207 matches carried period scores). Next action: decide whether that match establishes the target; if not, return `null`, extend `targetEstablishedBySource()`, and reconcile the integration suite's rejected-record expectation deliberately. |
-->
<!-- RETIRED 2026-08-27 — `AFLDB-ISSUE-093` is Resolved and is NO LONGER an open issue.
     Do not read the commented-out row below: it is the pre-resolution index row, kept only
     as lineage, and its "NEXT PHASE"/"next action" text is SUPERSEDED — the first clean
     rebuild has since PASSED (nine stages, 13/13 final validation). Authoritative records:
     the `AFLDB-ISSUE-093` entry in `issues.md` and `issues/closed/AFLDB-ISSUE-093.md` §H15. The only
     remaining follow-up is `AFLDB-ISSUE-095`, listed above as an open issue.

| `AFLDB-ISSUE-093` | Medium | Tooling / Data integrity / Import architecture | **CHECKPOINT 2026-08-27 — CANONICAL FULL-HISTORY FITZROY SOURCE FROZEN. Read `issues/closed/AFLDB-ISSUE-093.md` §19 first — it is the authoritative current-state record.** Accepted baseline `full-history-20260827` (1897–2025, 131 artefacts, 719,042 rows), hash-bound via `data/reference/fitzroy-accepted-baselines.json` (`exactly_one_accepted`, no latest-label fallback) and independently revalidated offline with no PostgreSQL access. Phases 1–4a COMPLETE; DraftGuru Stage A/B1/B2-1..B2-8 COMPLETE (supported `import_draftguru.py`, tracked link ledger, legacy `import_draft.py` tombstoned); orchestrator `npm run db:test:rebuild` IMPLEMENTED (normal mode auto-selects the accepted baseline; validator runs before any destructive stage). **417/417 DB-free tests.** **RESET BLOCKER 2 CLOSED 2026-08-27 — live rollback proof PASSED (`a8a2a899…` → `a8a2a899…` exact, 950 relations, psql exit 3, 1498 ms). `afldb_test` reconstructed: migrations 001–072 + privileges, schema only, NO canonical data. NEXT PHASE: FIRST ACTUAL CLEAN REBUILD — read the FIRST CLEAN REBUILD HANDOFF (§H1–§H10) at the end of `issues/closed/AFLDB-ISSUE-093.md`.** Incident lineage retained in full and not rewritten: Building the proof had already found and fixed two real defects (`runSql` never sent the SQL at all — `void client.unsafe(...)`; and the `pg_` schema exclusion excluded nothing, so `DROP SCHEMA pg_toast` would have aborted the first loop). The live run then exited 0 without aborting and the reset committed: pre-proof `0229d62c…` → post-incident `f46ce34c…`. **`RESET_SQL` has therefore now RUN against live PostgreSQL and produced exactly the intended clean slate (schemas 1, relations 0, migrations absent, 3 extensions and all 56 extension-owned objects preserved) — its semantics are validated; the ROLLBACK CONTAINMENT is what failed and remains unproven.** Production and `afldb_dev` untouched; loss was schema + privileges only, no import had ever run. No clean rebuild has been executed. **SELF-COLLISION FIXED (§20.14):** the hardened proof then refused twice with "1 other client session(s) connected" — the harness's own postgres.js observer, held open across the psql run; corrected to three phases with nothing spanning the reset, gate unchanged and no session exempted. Key files: `issues/closed/AFLDB-ISSUE-093.md` §19–§20, `issues/closed/AFLDB-ISSUE-093-DRAFTGURU-B2-HANDOFF.md` PART I–XVIII, `tools/db/rebuild-test.ts`, `tools/db/prove-reset.ts`, `tools/migration/import_fitzroy_core.py`, `tools/rebuild/draftguru/import_draftguru.py`, `data/reference/*.json`. **EXECUTION-BOUNDARY AUDIT 2026-08-27 (§H11) — the first clean rebuild is NOT READY: three blockers. F1 `db:migrate:test`/`db:privileges:test` are POSIX-shell scripts and npm on Windows runs them under `cmd.exe`, so stages 3 and 4 fail *after* the destructive stage 2 wipes the database (remedy proven: `npm_config_script_shell=bash`, which also propagates to the nested `npm run` calls). F2 `AFLDB_TEST_IMPORT_DATABASE_URL` is unset on `dev` (ISSUE-083 parked at `fa035ed`), so `resolveTarget()` refuses before preflight — operator must set it or pass `--allow-owner-import-dsn`. F3 stage 9 FINAL VALIDATION is declared `run: 'internal'` and `executeRebuild()` has no `internal` branch, so it does nothing and `FINGERPRINT_QUERIES` is never called — the run cannot fail closed on validation/fingerprint mismatch as §H9 requires. F4 (no DB identity/session/psql-probe gate in the orchestrator) and F5 (no lock/statement timeout on the destructive reset) are recorded and compensated by operator-run read-only checks. `.env` loading, the psql argv, accepted-baseline selection, DraftGuru inputs and the zero-`AFLDB_LEGACY_SQLITE` boundary all audited CORRECT. **REMEDIATED 2026-08-27 (§H11.8): F1 and F3 are RESOLVED.** `db:migrate:test` is now `tsx tools/db/migrate.ts --target test` (new `--target` flag; `AFLDB_MIGRATE_TARGET` still supported, a disagreement is a refusal) and `db:privileges`/`db:privileges:test` route through new `tools/db/privileges.ts`, which resolves the DSN in Node — psql invocation otherwise unchanged, script names unchanged. Stage 9 is now a real `validate` stage with its own `deps.runValidation` separate from the destructive `runSql`: 13 gates bound to the accepted register's `measured` block plus `matches_after_accepted_last_season = 0`, `draft_persons` and `draft_picks`; an unrecognised measured key is a refusal so the gate cannot silently shrink; read-only, reports every value, fails the run on any mismatch. `FINGERPRINT_QUERIES` removed. **182/182 DB-free tests** in `tests/db-test-rebuild.test.ts`. **FIRST CLEAN REBUILD ATTEMPT 1 FAILED AT STAGE 5 — REPAIRED (§H12, 2026-08-27).** PRECHECK/RESET/MIGRATIONS 72-72/PRIVILEGES all passed; REFERENCE died on `psycopg.errors.InsufficientPrivilege: permission denied for table player_link_match_candidates` in `guard_cascade()`, which probed every transitive FK dependent of its truncate roots with `SELECT count(*)`. Root cause: `privileges.sql` grants `afldb_import` SELECT on a **base table** only via `import_writable_tables`; `app_readable_tables` is consulted only for views. Migration 045 seeded that registry from the tables existing then, so every base table created after 045 is revoked unless its migration calls `grant_import_write()` — migration 067 registers the candidate cache app-read ONLY, by design (migration 070 reasons about that exact table). The closure is 30 relations and **two** are unreadable: `player_link_match_candidates` (067) and `player_match_period_stats` (062, direct `club_id → clubs` FK) — so a one-table grant would have failed on the next relation. **Repair (no grant added, `privileges.sql` UNCHANGED):** `guard_cascade()` now classifies dependents via `has_table_privilege()` (new `common.selectable()`), counts rows only in proven-readable ones, and REFUSES on any it cannot prove empty; new `reload_truncate()` skips a TRUNCATE whose targets are already empty, since `TRUNCATE … CASCADE` needs privileges on the whole cascade set. On a clean rebuild the roots are always empty, so no closure relation is read or locked and a future migration cannot reintroduce the failure. **204/204 DB-free tests** (`reference-data` + `db-test-rebuild`), `py_compile` OK, no new tsc errors. `afldb_test` holds migrated+privileged schema and ZERO rows (the guard refuses before any write) — the post-stage-4 state. **BOUNDED STAGE-5 PROOF 1 FAILED SAFELY — REPAIRED AGAIN (§H13).** The §H12 repair was necessary but NOT sufficient and its "complete" claim is amended in place. Root cause of the second failure: **a freshly migrated database is not empty** — migrations 015 and 016 SEED `stat_definitions` and `stat_availability`, both truncate roots of the `coverage` group. `guard_cascade()` evaluated emptiness and took its cascade closure over the **union of every group's truncate targets** while `reload_truncate()` decides per group at call time, so the union short circuit could never fire and the closure of the EMPTY `clubs`/`seasons` roots (whose truncates would have been skipped) was adjudicated anyway — refusing over a cascade that was never going to happen. Hypotheses #1/#2/#3/#4 confirmed, #5 rejected. **Repair:** closure is now taken from `populated_roots` only (on a fresh DB that is `{stat_definitions, stat_availability}`, whose closure is just `stat_availability` — in the loader's own rebuild set, so `outside` is empty and neither denied relation is touched); and `guard_cascade()`/`reload_truncate()` can no longer disagree — the guard records the roots it adjudicated and the truncate refuses anything outside that set, or if the guard never ran. **New `tests/python/reference_cascade_contract.py`: 19 DB-free BEHAVIOURAL scenarios** driving the real functions against a fake connection that raises if the guard reads a denied relation — §H12's source-string tests passed against wrong control flow, which is the lesson. **206/206** TS tests, `py_compile` OK, no new tsc errors. `privileges.sql` and `src/db/migrations/` still UNCHANGED; `--allow-cascade` still unused. `afldb_test` untouched (the guard refuses before any write) and still in the post-stage-4 state. **FIRST COMPLETE CLEAN REBUILD PASSED — 2026-08-27 (§H15). STATUS: CLEAN REBUILD PROVEN — FINAL POST-REBUILD VALIDATION PENDING.** `npm run db:test:rebuild -- --acknowledge-destroy afldb_test` ran end to end: all NINE stages passed (PRECHECK, RESET, MIGRATIONS 72/72, PRIVILEGES, REFERENCE, FITZROY, DRAFTGURU, DERIVED, FINAL VALIDATION), with data stages under the **restricted `afldb_import` role** — no `--allow-owner-import-dsn`, no `AFLDB_LEGACY_SQLITE`, not production, not `afldb_dev`. Baseline `full-history-20260827` (131 artefacts, 719,042 rows, manifest `cc8aaf09…`, artefact-set `8e14ce61…`); DraftGuru `annual-html-20260826` (5,057 persons / 6,810 picks / 6 ledger decisions / 5,052 unmatched / 2 seeded). fitzRoy: venues 52, players 13,275, matches 16,838, match_period_scores 134,704, player_match_stats 685,471, brownlow_round_votes 320,861. **Stage 9: `AFLDB-FINAL-VALIDATION PASSED: 13 checks`**, including `matches_after_accepted_last_season = 0` (2026 correctly excluded). Two defects were exposed only by real execution under the restricted role and are now repaired: the REFERENCE cascade guard (§H12/§H13 — `afldb_import` correctly denied `player_link_match_candidates`/`player_match_period_stats`; migrations 015/016 SEED `stat_definitions`/`stat_availability` so the empty-root assumption was false; repair scopes cascade analysis to populated roots, **`privileges.sql` unchanged, no grant added**) and fitzRoy corrections-parameter threading (§H14 — both import phases repaired, `corrections` now required). **`club_seasons = 0` RESOLVED as SEPARATE FOLLOW-UP (§H15.5, source-proven 2026-08-27) — it does NOT invalidate the core rebuild.** The only writer of `staging.team_seasons` is `tools/migration/import_legacy_afl.py` (`:767/:776/:795`, group key `"ladders"`), which requires `AFLDB_LEGACY_SQLITE` (`:1021`). `REBUILDS["club_seasons"]` selects `FROM staging.team_seasons`, so an empty staging table correctly yields zero rows. The ladder/team-season domain therefore has **no canonical acquisition path yet** and was never in the nine-stage contract — zero is the *expected* outcome of a legacy-free rebuild, not a defect in it. Real degradation while empty: ladders, premiership/wooden-spoon flags, finals counts and club-season NL answers (`clubs.ts`, `seasons.ts`, `rounds.ts`, `grid-solver.ts`, `search.ts`, `db-health.ts`, `player-derived.ts`, `nl/club-season.ts`, NL `parser/plan/vocab`, `lib/edit/spec.ts`). fitzRoy can derive `played/wins/draws/losses/points_for/points_against/percentage` (and already derives `is_premier`/`finals_played`); `ladder_rank` and `premiership_points` need an external ladder source — both are nullable in the schema, so a partial rebuild is schema-legal but needs a provenance decision (the SQL hardcodes `source_id` = `sports_data_lab`). **Stage 9 must NOT gate `club_seasons` until the domain lands**, or every canonical rebuild would fail on a known gap. Next action: **record a follow-up issue for canonical legacy-free ladder/team-season acquisition + load stage + Stage-9 gate (determine the next unused id from `issues.md`/`IssuesIndex.md` — NOT `AFLDB-ISSUE-094`, already used by NL semantic mapping; link `AFLDB-ISSUE-015` and `AFLDB-ISSUE-093`, do not absorb ISSUE-015), then ISSUE-093 can be marked Resolved — 2026-08-27.** Do NOT start DraftGuru Stage B3; do NOT merge the parked branches. **ISSUE-059 (`4444d76`) and ISSUE-073 (`0885129`) are now UNBLOCKED** for their own focused DB-backed validation against the rebuilt database, as separate work. Do NOT start DraftGuru Stage B3 (optional, not a blocker); do NOT merge the parked branches — ISSUE-083 is complete and parked at `fa035ed`, ISSUE-059 at `4444d76`, ISSUE-073 at `0885129`.** |
-->

---

<!-- RETIRED 2026-09-01 — `AFLDB-ISSUE-121` is **Resolved** (2026-09-01) and is NO LONGER an
     open issue. Its pre-resolution detail block is removed. Authoritative records: the
     `AFLDB-ISSUE-121` entry in `issues.md` (Resolution, 2026-09-01) and
     `issues/closed/AFLDB-ISSUE-121.md` §14. Closing evidence: code fix committed at `54c7a31`;
     `tests/integration/auth-audit-jsonb.test.ts` 8/8 against `afldb_test`; migration `082`
     applied to `afldb_test` and `afldb_dev`; historical `auth_audit_log` row 632 repaired to a
     JSONB object (`detail->>'deletedLogRows' = 4953`); `auth_audit_log_detail_is_object_ck` live.
     Migration `082` is NOT yet applied to production — it ships with or after the `54c7a31` code
     fix, never before it. `AFLDB-ISSUE-119`'s final live dev acceptance is thereby unblocked. -->

---

<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-068` is **Resolved** (2026-08-29) and is NO LONGER an
     open issue. The block below is retained as lineage only; its "Current state" and
     "Exact next action" text is SUPERSEDED. Authoritative record: the `AFLDB-ISSUE-068`
     entry in `issues.md` (Status: Resolved) and `issues/closed/AFLDB-ISSUE-068.md` (Resolution —
     2026-08-29). Closing conclusion: the React #418 hydration defect was owned by the Next
     15.5.23 framework dependency closure/runtime/client/serving path; the Next 16.3.1
     closure eliminated it in matched A/B testing and the result is confirmed on the real
     Linux dev deployment with a clean 1,440-load acceptance at BUILD_ID
     uZReW8G1XnsGnG5FNYY-I. No exact internal Next.js function, commit or upstream bug ID is
     claimed. ISSUE-107, ISSUE-108 and ISSUE-109 remain Open and separate.
## AFLDB-ISSUE-068 — Intermittent React hydration errors during NL UI sweeps

- **Severity:** Medium
- **Area:** UI/Hydration
- **Runbook:** `issues/closed/AFLDB-ISSUE-068.md`.
- **First wrong layer:** Next 15.5.23 framework dependency closure/runtime/client/serving path.
- **Current state:** H9 is confirmed at the owning-layer level. Matched Next 15.5.23 passes
  (`oroK-9PaBQoMFamvJGRqB`) completed 1,440 / 1,440 with 73 and 62 hydration/client errors;
  matched Next 16.3.1 passes (`5RU_F0rm5IyuiVwKX9XHi`) completed 1,440 / 1,440 with zero and
  zero. All four runs had identical 1,238 / 202 / 0 semantics, zero HTTP/page errors, zero
  violations and zero metamorphic disagreements. Per-load `x-afldb-build` proved build identity.
- **Causal boundary:** Do not claim a specific Next.js internal function, upstream bug/commit,
  or `next` alone. React/ReactDOM stayed 19.2.8. Next 16 changes the segment-cache/prefetch
  serving format, so internal hydration correction versus changed serving path is not
  distinguished.
- **Deployed acceptance PASSED 2026-08-29:** ISSUE-107 deployed the closure and proved the live
  build; the sweep then ran against `uZReW8G1XnsGnG5FNYY-I` on `http://10.0.40.100:8090` with the
  full 1,440-question corpus, 4 Playwright workers, pool 10, tracing on, JavaScript enabled and no
  retries. Result: **1,440 / 1,440 observed, all bound to that build; zero hydration errors on
  every cut (per worker, same/cross worker, every RSC cluster), zero client errors, zero
  violations, zero metamorphic disagreements, zero HTTP and page errors.** Outcomes improved to
  1,440 / 0 / 0 — attributable to the NL work merged since the A/B source, not to the framework,
  and recorded as such.
- **Corpus note:** the tracked corpus is five rows short of the A/B set; a commit merged after the
  A/B removed five ambiguous "most games in a game" questions. The complete corpus survived on the
  dev host and was proven a clean superset before use, so no threshold was adjusted.
- **Exact next action:** every stated closure condition is met. Awaiting an explicit operator
  decision to close — closure was not authorised with the run, so the issue is left Open.

-->

<!-- RETIRED 2026-09-01 — `AFLDB-ISSUE-119` is **Resolved** and is NO LONGER an
     open issue. Final guarded Playwright acceptance passed 9/9 against the
     disposable loopback `afldb_test` deployment. Authoritative records:
     `issues.md` (Resolution, 2026-09-01) and
     `issues/closed/AFLDB-ISSUE-119.md` §34. -->
<!-- RETIRED 2026-08-30 — `AFLDB-ISSUE-107` and `AFLDB-ISSUE-108` are both **Resolved** and are
     NO LONGER open issues. The two detail blocks below are retained as lineage only; their
     "Current state", "Only open gate" and "Exact next action" text is SUPERSEDED. Authoritative
     records: the `AFLDB-ISSUE-107` and `AFLDB-ISSUE-108` entries in `issues.md` (both
     Resolved 2026-08-30), `issues/closed/AFLDB-ISSUE-107.md` "Gates" and `issues/closed/AFLDB-ISSUE-108.md` §12.

     ISSUE-108 final validation — Linux, exact commit 673f0e3, Node v22.23.2 / npm 10.9.8,
     `npm test -- --no-file-parallelism`: 89 passed / 5 skipped test files (94), 2,515 passed /
     104 skipped tests, 0 failures, 122.21 s. `afldb_test` was NOT rebuilt and was never stale.

     ISSUE-107 final gate state: G0 PASS, G1 PASS, G2 PASS, G3 PASS, G4 PASS; G5 (production
     eligibility) is out of ISSUE-107's scope by design and is NOT a completion condition.
     Production rollout is separate work under its own review and is NOT authorised by this
     resolution. `AFLDB-ISSUE-109` was open and separate at that checkpoint; it is now
     Resolved (2026-08-30), with its runbook in `issues/closed/AFLDB-ISSUE-109.md`.

## AFLDB-ISSUE-107 — Next.js 16 framework/runtime upgrade (RETIRED)

- **Severity:** Medium
- **Area:** Framework / Runtime / Deployment
- **Runbook:** `issues/closed/AFLDB-ISSUE-107.md`.
- **Current state:** Open; deployed to Linux development on 2026-08-29 and proven live.
  Commit `be2a963` on `dev`, Node `v22.23.2`, Next `16.3.1`, React/ReactDOM `19.2.8`, Webpack.
  Typecheck 0 errors; the Webpack build completed page collection, 1,499 static pages and
  complete standalone output; `deploy/sync-dev.ps1 -Issue107Gate` exited 0; live
  `x-afldb-build` equals BUILD_ID `uZReW8G1XnsGnG5FNYY-I`; systemd active with four
  `next-server (v16.3.1)` workers at `AFLDB_WORKERS=4`, `AFLDB_POOL_MAX=10`,
  `AFLDB_TRACE_REQUESTS=on`; `/api/health` ok; 17/17 focused live routes clean with zero
  console, page and hydration errors. The `/sitemap.xml` question is closed: no duplicate-route
  warning in the production build, and its 404 is the intended `AFLDB_INDEXING`-off behaviour.
- **Key files/subsystem:** `deploy/sync-dev.ps1` (four gate-integrity repairs: nvm Node
  selection, base64 remote transport, server-side `$(…)` evaluation, sudo-less systemd restart);
  the dev host `.env` (`AFLDB_POOL_MAX=10` added).
- **Only open gate:** G2's guarded database integration. 33 stable failures against `afldb_test`
  are content failures with no framework surface — tracked as `AFLDB-ISSUE-108`, not as an
  ISSUE-107 regression.
- **Dev migrations applied 2026-08-29:** on operator instruction, `071`–`077` were applied to
  `afldb_dev` via `npm run db:migrate` after confirming the target database, the absence of
  `AFLDB_PROD_DATABASE_URL` and the 70/77 starting status. Now **77/77, 0 pending**, no checksum
  drift, no privileges reconciliation required, production untouched. Smoke: `/api/health` ok;
  `/admin`, `/admin/data-editor`, `/admin/current-season` all 307 to login with no 500; live
  `x-afldb-build` unchanged at `uZReW8G1XnsGnG5FNYY-I` with no restart or rebuild. Applying `073`
  exposed `AFLDB-ISSUE-109`.
- **Stop conditions:** unexplained React/dependency expansion, simultaneous bundler change,
  semantic/security regression, unreproducible framework controls, live build mismatch,
  reduced concurrency, or any unexplained hydration/client error in ISSUE-068 acceptance.
- **Exact next action:** hand BUILD_ID `uZReW8G1XnsGnG5FNYY-I` on `http://10.0.40.100:8090` to
  ISSUE-068 for its 1,440-row acceptance at 4 Playwright workers (`NL_UI_WORKERS` unset).
  Re-run guarded integration once ISSUE-108 restores `afldb_test`. Do not resolve either issue
  before its owned gates pass, and do not roll out production.

## AFLDB-ISSUE-108 — the guarded test contract predates the canonical legacy-free `afldb_test` (RETIRED)

- **Severity:** Medium
- **Area:** Test database / Data integrity / Tooling
- **Runbook:** `issues/closed/AFLDB-ISSUE-108.md` (authoritative).
- **Current state:** Open; **Path A complete, all 33 stable failures classified, awaiting the
  serial guarded re-run on Linux dev.** Root cause corrected — `afldb_test` (77/77) already matches the accepted canonical
  baseline `full-history-20260827` exactly on every gated value (`player_match_rows` 685,471,
  `players_with_dob` 855, AFL Tables identities 13,275). The 33 failures are a **stale test
  contract** — legacy-SQLite `IMMUTABLE` pins (694,210 `player_match_stats`, 79,113
  `brownlow_season_votes`, 12,478 DOB, 3,459 DraftGuru links, 269-player cohorts) and
  DOB/DraftGuru-B3 enrichment passes the canonical rebuild does not run — plus 3 shared-`afldb_test`
  parallelism flakes. `afldb_test` was **not** rebuilt.
- **Not a framework issue:** every failing file imports nothing from `next`, `react` or
  `src/app`; confirmed on Next 16.3.1 / React 19.2.8 / Node v22.23.2.
- **Changes made (Path A):** Class-A re-pins/skips in `tests/integration/release-gates.test.ts`
  and `database.test.ts` (each skip links its owning gap: `AFLDB-ISSUE-090` §27.5 for Brownlow,
  DraftGuru B3, `AFLDB-ISSUE-099` for the 2026 provisional artefacts); manifest-hash
  cross-platform line-ending defect fixed (`data/reference/fitzroy-accepted-baselines.json`
  `manifest_sha256` → canonical LF hash, new `.gitattributes`, CRLF-tolerant test hashing,
  `tests/season-rollover.test.ts` literal); `src/db/queries/db-health.ts` "missing career row"
  check scoped to players with `player_match_stats`; `tests/integration/data-editor.test.ts`
  score-reversal fixture swaps goals & behinds; `tests/draftguru-acquisition.test.ts` CSV
  parity-oracle test `existsSync`-guarded; `vitest.config.mts` `fileParallelism: false`.
- **Second defect (the last 7 failures, `issues/closed/AFLDB-ISSUE-108.md` §9.4):** the canonical rebuild
  **re-seeds `players.id`** — `import_fitzroy_core.py` inserts with no `legacy_player_id` and
  resolves identity by AFL Tables profile URL; measured 13,277 players, 0 with a
  `legacy_player_id`. Every legacy ID pinned in the suite now addresses a different person
  (788 → Arthur Ford, 2520/2521 → Campbell Gray/Heath, 1105/567 → Ben King/Andrew Foster). The
  protected people are intact, so this is obsolete addressing, not identity corruption — and two
  of those gates were *passing* on the wrong people. All affected gates re-anchored to the data
  (surname lookup discriminated by career facts); the 1960s/two-club exact-membership digest
  re-based from an ID-set hash onto the durable AFL Tables identity (110 keys →
  `4b4c6a2aa975cc17`); cohort counts re-pinned 117 → 115 and 222 → 219, entailed by exact
  fact→derived aggregate agreement with the accepted 685,471-row baseline; the decided-season
  Brownlow genuine-zero gate retired under `AFLDB-ISSUE-090` §27.5 as structurally unreachable
  without a season-grain writer.
- **Known follow-up, not in scope:** `tools/validation/validate_migration.py` and
  `tests/fixtures/oracle_baseline.json` are still bound to the retired legacy dataset and carry
  the same surrogate-ID defect. Outside the guarded vitest gate, so it does not block this issue.
- **Exact next action:** push; on Linux dev run `npm test` against the `afldb_test` DSN (serial is
  now the config default; `--no-file-parallelism` is redundant but harmless). When serial is green
  (or every residual is an accounted-for skip), mark Resolved and set `AFLDB-ISSUE-107` G2 to
  PASS. Neither before that run passes.

     DONE 2026-08-30 — that run passed (89/5 files, 2,515/104 tests, 0 failures, 122.21 s at
     commit 673f0e3). ISSUE-108 Resolved, ISSUE-107 G2 PASS, ISSUE-107 Resolved.
-->


<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-077` is **Resolved** (2026-08-26) and is NO LONGER an
     open issue. The detail block below is retained as lineage only: its "Current state" and
     "Next action" text is the pre-resolution index text and is SUPERSEDED. Authoritative
     record: the `AFLDB-ISSUE-077` entry in `issues.md` (Status: Resolved, Resolved:
     2026-08-26). Root cause: `saveSiteSettings` revalidated only four paths, so statically
     generated pages kept serving a stale root layout and the client router flipped the theme
     on navigation between a revalidated and a stale page. Fix: `revalidatePath('/', 'layout')`
     in `src/app/admin/settings/actions.ts`, invalidating the whole root-layout cache boundary
     in one operation. Validation: `tests/admin-settings-actions.test.ts` 1/1, asserting the
     exact call and that it is the only revalidation issued. This block was left uncommented
     when the issue was resolved and was retired by the 2026-08-28 ledger reconciliation.

## AFLDB-ISSUE-077 — Frontend theme changes unpredictably during a user session (RETIRED)

- **Severity:** Medium
- **Area:** UI/Settings
- **Key files:** `src/db/queries/site-settings.ts`, `src/app/layout.tsx`, theme/layout components, and any client-side theme initialisation/storage code.
- **First wrong layer:** UI/settings state propagation or cache consistency.
- **Current state:** A theme selected by a super admin is not stable during ordinary browsing. One public page can render with the configured theme and the next internal navigation can render a different theme without any settings change. This is separate from ISSUE-072, which only covers the stale `frontendTheme` default-shape test.
- **Next action:** Trace every `frontendTheme` authority and cache boundary (database, admin mutation/revalidation, SSR layout, cookie/local storage, hydration), reduce them to one authoritative resolved theme, then add browser coverage that navigates across multiple routes and proves the theme remains unchanged until a super admin deliberately changes it.

-->




<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-086` is **Resolved** and is NO LONGER an open issue. The
     detail block below is retained as lineage only, and its "unapplied", "1/2" and "next action"
     text is SUPERSEDED. The reopening was solely the missing supporting index on
     `data_overrides(admin_user_id) -> auth_users(id)` omitted by migration 073 — never a defect
     in the durable admin-override behaviour, which remains validated by
     `tests/data-overrides-source-contract.test.ts` 6/6 and
     `tests/integration/draftguru-import.test.ts` 19/19 (an admin override surviving a destructive
     source reload under the restricted importer role). Repaired forward-only in migration 075
     with 073 untouched after application; 075 held until 074 could apply first; 074 then 075
     applied cleanly; ledger 75/75, 0 pending, no drift; `tests/integration/fk-indexes.test.ts`
     2/2; privileges reconciled; `afldb_test` fingerprint
     `c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`. All evidence is from
     `afldb_test`; no production or `afldb_dev` application is claimed. Authoritative records:
     the `AFLDB-ISSUE-086` entry in `issues.md` and `issues/closed/AFLDB-ISSUE-086.md`.

## AFLDB-ISSUE-086 — Durable admin overrides: `data_overrides(admin_user_id)` is an unindexed foreign key (RETIRED)

- **Severity:** Medium
- **Area:** Admin / Data integrity
- **Key files:** `src/db/migrations/073_data_overrides.sql` (applied,
  checksum-baselined, **must not be edited**);
  `src/db/migrations/075_data_overrides_fk_index.sql` (**applied to `afldb_test`
  2026-08-28, after 074; now checksum-frozen — must not be edited**);
  `tests/data-overrides-source-contract.test.ts`;
  `tests/integration/fk-indexes.test.ts` (read-only here);
  `issues/closed/AFLDB-ISSUE-086.md` (runbook, durable source of truth).
- **First wrong layer:** Database schema (migration 073).
- **Current state:** REOPENED 2026-08-28. The durable-override fix itself is
  validated and unchanged: checksum-baseline repair completed successfully; the
  clean rebuild through migration 073 passed **13/13** final validation;
  migration status **73/73, 0 pending, no drift**; DB-free source contract
  **6/6**; restricted-role DraftGuru integration **19/19**. Reopened for a
  separate proven defect: migration 073 declares
  `admin_user_id integer NOT NULL REFERENCES auth_users(id)` but indexes only
  `(entity_type, entity_key)`, so `tests/integration/fk-indexes.test.ts` was
  **1/2** on `data_overrides(admin_user_id) -> auth_users` and a parent-side
  `auth_users` delete sequentially scans `data_overrides`. Migration 075 is the
  forward repair (`CREATE INDEX IF NOT EXISTS ix_data_overrides_admin_user_id
  ON data_overrides (admin_user_id);`) and is **APPLIED to `afldb_test`**:
  `AFLDB-ISSUE-096` applied **074 then 075** in that order on 2026-08-28
  (75 files, 75 applied, 0 pending, no drift; privileges reconciled), and
  `tests/integration/fk-indexes.test.ts` is **2/2**, validating ISSUE-096's three
  074 FK indexes and this issue's `ix_data_overrides_admin_user_id` in one pass.
- **Exact next action:** *(The previous action — "repair ISSUE-096's migration
  074 first, then apply **074 then 075**, then re-run
  `tests/integration/fk-indexes.test.ts` and expect 2/2" — was executed on
  2026-08-28 and passed.)* The unindexed-FK defect is repaired and
  database-validated. **Whether that closes `AFLDB-ISSUE-086` is this issue's own
  decision** — `AFLDB-ISSUE-096` synced the proven facts only and changed no
  status, scope, ownership or historical conclusion. Migrations 073, 074 and 075
  are all applied and checksum-frozen: do not edit any of them, and do not
  renumber 075.

-->

<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-090` is **Resolved** and is NO LONGER an open issue.
     The detail block below is kept as lineage only. Every "Current state", "Next action"
     and HALT line in it is SUPERSEDED. Authoritative records: the `AFLDB-ISSUE-090` entry
     in `issues.md` (Resolution, 2026-08-28) and `issues/closed/AFLDB-ISSUE-090.md` §27. -->

## AFLDB-ISSUE-090 — DOB enrichment conflict writes are not pass-scoped or idempotent (RETIRED)

- **Status:** **Resolved 2026-08-28.** Final validation, operator-run against the
  canonically rebuilt `afldb_test`: DOB reconciliation suite **27/27** · canonical
  external-identity release assertion **1/1** (63 skipped; pin **13,275**) · privileges
  **24/24** with **no grant widened**. Resolved against the amended standard at
  `issues/closed/AFLDB-ISSUE-090.md` §27.4. **The full `release-gates.test.ts` suite is NOT green** —
  Gate 1 was 42 passed / 22 failed; the 16 unrelated failures keep their own owners and were
  left unchanged.

- **Severity:** Medium
- **Area:** Data integrity / Import
- **Key files:** `tools/migration/enrich_birth_dates_from_club_lists.py` (`:412-432`),
  `tools/migration/enrich_birth_dates.py` (`:407-412`),
  `src/db/migrations/072_dob_conflict_ownership.sql` (new),
  `tests/integration/dob-enrichment-issues.test.ts` (new)
- **Runbook:** `issues/closed/AFLDB-ISSUE-090.md` — durable source of truth. Planning COMPLETE/APPROVED;
  **implementation COMPLETE and validated 2026-08-28** (§27.4 standard, §27.6 resolution) —
  the "implementation IN PROGRESS" text that stood here is superseded lineage.
  Migration 072 APPLIED to `afldb_test`
  (`db:status` 72/72, 0 pending). `dob-enrichment-issues.test.ts` post-migration rerun
  GREEN 23/23 (fixed a test-harness bigint/string assertion defect on the way, not a
  migration defect). `AFLDB-ISSUE-091`'s migration-checksum blocker is Resolved.
- **Current state (SUPERSEDED 2026-08-28 by the Gate 1 result below; retained as lineage):**
  `release-gates.test.ts` validation was HALTED; **the halt is LIFTED as
  of 2026-08-28**. The intended duplicate-`dob_conflict` gate is GREEN (the fix ISSUE-090 set
  out to make). Two unrelated `external_identities` gates had flipped green→red (expected
  12,472 `afltables_profile_url`/`unique` rows, found 0) — root-caused to a pre-existing
  importer defect in `enrich_birth_dates.py` exposed by this issue's own new regression
  suite, **not** to migration 072 (conclusively ruled out — see `issues/closed/AFLDB-ISSUE-090.md`). That
  defect was tracked as **`AFLDB-ISSUE-092`**, which is now **Resolved** (fail-closed
  population gate + `--source-key` containment, validated 27/27 on 2026-08-28), and the
  emptied population was restored to **13,275** by the 2026-08-27 canonical rebuild. The
  0-row condition is gone; what remains is whether the 12,472 pin is still the right expected
  value — an ISSUE-090 decision. This issue is **OPEN and unblocked**, not resolved.
- **Approved decisions:** D1 identical resolved recurrence suppressed (assertion-specific);
  D1a no `recurrence_of`; D2 targeted partial unique index; D3 equivalent
  `dob_internal_conflict` invariant; D4 `external_identity_conflict` is follow-up;
  D5 recompute `players.dob_disputed`.
- **Gate 1 result (2026-08-28):** `release-gates.test.ts` — **64 tests, 42 passed, 22
  failed**, every failure classified in `issues/closed/AFLDB-ISSUE-090-HANDOFF.md` §11.3. **ISSUE-090's own
  duplicate-`dob_conflict` invariant (`:497-507`) is GREEN.** Six failures touched this
  issue: the one stale pin (repaired) and five `gate: birth dates` population assertions
  (retired as acceptance). The other 16 are owned by `AFLDB-ISSUE-095` (3),
  `AFLDB-ISSUE-093`/DraftGuru B3 (2), `AFLDB-ISSUE-096`/`-098`/`-099` (2), rebuild-baseline
  drift (4) and two unowned gaps (5) — **left unchanged.**
- **The one repair:** `tests/integration/release-gates.test.ts` `gate: birth dates` →
  `matches players on the profile URL rather than the name`, `12_472` → `13_275`. A
  **test-baseline repair caused by the canonical rebuild, not a data change** — live
  `afldb_test` 13,275, accepted baseline `measured.players` 13,275,
  `identity_scan.distinct_urls` 13,275, `missing_url`/`malformed_url` 0, Stage 9 PASSED.
  12,472 was the retired `AFLDB_LEGACY_SQLITE` register population. **The
  `player_birth_evidence` 12,472 pin was NOT re-pinned** — a different population, live 855.
- **Acceptance amended (`issues/closed/AFLDB-ISSUE-090.md` §27):** ISSUE-090 no longer has to recreate the
  old 12,478-player enriched DOB snapshot. The canonical rebuild invokes neither enrichment
  pass; `players_with_dob: 855` / `players_with_dob_conflict: 0` are the accepted baseline's
  own contracted figures; the register pass requires `AFLDB_LEGACY_SQLITE` **and** would
  resolve zero players because nothing canonical writes `players.legacy_player_id`; the
  club-list pass's CSV directory is gitignored and absent. Old requirement preserved as
  lineage at §27.3; revised standard at §27.4.
- **Next action — NONE. SUPERSEDED, retained as lineage.** This bullet read *"run
  `npm test -- tests/integration/privileges.test.ts` (Gate 2) … This issue remains **OPEN**
  until Gate 2 passes."* Gate 2 was run on 2026-08-28: **24/24 PASS, no grant widened.** With
  that, every item of the `issues/closed/AFLDB-ISSUE-090.md` §27.4 standard is met and the issue is
  **Resolved**. There is no outstanding ISSUE-090 action.

<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-092` is **Resolved** and is NO LONGER an open issue.
     Its index row and detail block have been removed from this open-issues-only file.
     Authoritative records: the `AFLDB-ISSUE-092` entry in `issues.md` and
     `issues/closed/AFLDB-ISSUE-092.md` §17 (§17.1 implementation verification, §17.2 recovery superseded
     by rebuild, §17.5 acceptance validation).

     Outcome: the fail-closed `external_identities` population-drop gate
     (`check_population_drop()` in `tools/migration/common.py`, reused by
     `import_fitzroy_core.py`) plus `--source-key` containment were implemented 2026-08-25
     and VALIDATED 2026-08-28 — `npm test -- tests/integration/dob-enrichment-issues.test.ts`
     **27/27, no skips**, tests 24–27 executed and green. §6 recovery of the emptied test
     database was superseded by the 2026-08-27 canonical rebuild, which repopulated the
     AFL Tables identity population to **13,275** through the gated import path.

     The historical incident (a one-row synthetic register wiping the real 12,472-row
     population via `dob-enrichment-issues.test.ts` test 5) is preserved in full in
     `issues.md` and `issues/closed/AFLDB-ISSUE-092.md` §1/§2 and must not be erased.

     Downstream: `AFLDB-ISSUE-090` is UNBLOCKED but still OPEN, listed above. Its two
     external-identity release gates are pinned at the stale legacy-derived 12,472 against a
     canonical 13,275; that re-pin is an ISSUE-090 decision and 12,472 must not be silently
     reinstated. -->

<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-095` is RESOLVED. Retained as lineage only; it is
     NOT an open issue and its "next action" text is SUPERSEDED. See `issues.md` and
     `issues/closed/AFLDB-ISSUE-095.md` §14.

## AFLDB-ISSUE-095 — Canonical legacy-free ladder / team-season acquisition

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture / Data integrity
- **Key files:** `issues/closed/AFLDB-ISSUE-095.md` (runbook, durable source of truth);
  `tools/migration/rebuild_derived.py` (`REBUILDS["club_seasons"]`, `:312`);
  `tools/migration/import_legacy_afl.py` (`:767`, `:776`, `:795`, `:996`, `:1021`);
  `src/db/migrations/006_draft_relationships.sql` (`:55-80`);
  `src/db/queries/player-derived.ts` (`recomputeClubSeasons`, `:402-411`);
  `tools/db/rebuild-test.ts` (Stage 9); `data/reference/sources.json`
- **Current state:** OPEN, nothing implemented. Proven during ISSUE-093's first complete
  canonical clean rebuild (`issues/closed/AFLDB-ISSUE-093.md` §H15.5): `club_seasons` is built **only** from
  `staging.team_seasons`, whose **only** writer is `import_legacy_afl.py` under
  `AFLDB_LEGACY_SQLITE`. The canonical rebuild deliberately has no legacy staging-load stage,
  so `club_seasons = 0` is the *expected* outcome of a legacy-free rebuild, not a defect in it.
  Degraded while empty: ladders, premiership/wooden-spoon flags, finals counts and club-season
  NL answers (`clubs.ts`, `seasons.ts`, `rounds.ts`, `grid-solver.ts`, `search.ts`,
  `db-health.ts`, `player-derived.ts`, `nl/club-season.ts`, NL `parser`/`plan`/`vocab`,
  `lib/edit/spec.ts`). Also note `recomputeClubSeasons` fails closed on an empty
  `staging.team_seasons`, so match create/delete/score-edit throws for every season on a
  canonically rebuilt database — by design, not a new defect.
- **DB-free validation: GREEN for this issue** (`issues/closed/AFLDB-ISSUE-095.md` §12) — 309 passed,
  6 skipped, plus the resolver contract 37/37. The single remaining failure,
  `reference-data.test.ts` → `finds the tables created after 045 that never registered
  import write`, is **`AFLDB-ISSUE-096`/`-086` drift** from migrations 073/074
  (`data_overrides`, `promotion_decisions`) and was deliberately left untouched: repairing
  it asserts a privilege decision that belongs to ISSUE-086's blocked manual-authority
  contract.
- **Witness acquired and validated (`issues/closed/AFLDB-ISSUE-095.md` §13).** `ladder-20260828`,
  129 files / 1,622 rows, pinned in the contract by `accepted_witness` + manifest sha256.
  New single-authority validator `tools/rebuild/fitzroy/validate_ladder_witness.py`
  (26/26 offline, no DB, no network); D7 cross-check wired as a tenth **validation** stage
  (`ladder-witness`, between `derived` and `fingerprints`) — the four-stage **data**
  topology is unchanged and now asserted. Durability reuses ISSUE-093's convention:
  bytes gitignored, manifest tracked, PRECHECK refuses before destruction — proven by
  execution (exit 2 with bytes absent, 0 restored).
- **Exact next action:** the clean `afldb_test` rebuild — a **separate authorisation**, and
  the only thing that can prove the D7 cross-check. It is a **full destructive recreate**
  of `afldb_test`. **ZERO supported `AFLDB_LEGACY_SQLITE` dependency.**
- **Do NOT** add a `club_seasons` non-zero Stage-9 gate until this lands — it would fail every
  canonical rebuild over a known, deliberate gap.
- **Links:** `AFLDB-ISSUE-093` (Resolved 2026-08-27, this issue is its recorded follow-up) and
  `AFLDB-ISSUE-015` (Resolved 2026-08-22, per-season `recomputeClubSeasons` parity) —
  **linked, not absorbed**; ISSUE-015's status is unchanged.

<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-096` is **Resolved**, complete within its authorised S1–S4
     scope. The detail block below is retained as lineage only. It is NOT an open issue, and its
     intermediate "UNAPPLIED", "BLOCKED", "not yet run" and "next action" text is SUPERSEDED:
     migration 074 is applied and checksum-frozen (074 before 075, 75/75, 0 pending), and the
     final validated evidence is source contract 106/106, spine suite 13/13, FK gate 2/2,
     privileges 24/24, fingerprint
     `c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`.
     Authoritative records: the `AFLDB-ISSUE-096` entry in `issues.md` and `issues/closed/AFLDB-ISSUE-096.md`
     §16.16–§16.17. The remaining §5.H partial and blocked rows are NOT unfinished ISSUE-096 work:
     they are either consequences with no code to exercise until a future persistence/accept path
     exists, or downstream capabilities owned by `AFLDB-ISSUE-086` (manual authority),
     `AFLDB-ISSUE-099` (the `data_issues` disagreement row) and
     `AFLDB-ISSUE-101` (rollover supersession), all of which remain open above.

-->

## AFLDB-ISSUE-096 — 2026+ API-first acquisition architecture and contract (RETIRED)

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Runbook:** `issues/closed/AFLDB-ISSUE-096.md` — **durable source of truth for this issue**.
  `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` is the parent investigation runbook (§4, §9 row A, and §13 for
  the dated P1–P7 probe results).
- **Key files:** `data/reference/source-families.json` (new, S1),
  `src/lib/acquisition/source-families.ts` (new, S1), `tests/reference-data.test.ts` (extended);
  `src/db/migrations/074_source_observation_spine.sql` (new, S2, **applied to `afldb_test`**),
  `tests/integration/observation-spine.test.ts` (new, §5.H schema half),
  `src/lib/acquisition/observations.ts` (new, S2), `src/lib/acquisition/reconciliation.ts`
  (new, S3), `tests/current-season-import.test.ts` (extended, S2+S3);
  orientation only: `src/lib/external-afl/current-season-import.ts`,
  `src/db/migrations/063_external_current_match_sources.sql`, `064_matches_external_provenance.sql`
- **Approval:** **HALT LIFTED 2026-08-28.** Decisions A–H and the §12 items approved and recorded
  verbatim in `issues/closed/AFLDB-ISSUE-096.md` §14: three-grain observation model; retain
  `staging.external_current_matches`; **no automatic canonical promotion in v1**; ISSUE-086
  authority boundary is interface-and-invariant only; Kali sits in the Squiggle independence group;
  **P1/P2/P7 are not retried** and no local database substitutes for P7. The issue is now
  foundation implementation S1–S4; family importers remain excluded.
- **S1 IMPLEMENTED (2026-08-28):** tracked source-family registry + pure fail-closed typed parser
  + DB-free contract tests. **Seven** families over four sources; **no family is promotable**;
  AFL API lineup columns deliberately `incomplete` so a round-20 payload refuses;
  `afltables.player_match_stats` and `kali_afl_stats.player_stats` are `identity_only`. No
  migration, no importer, no `sources.json`/`seasons.json` change.
- **P1/P2 RE-RUN 2026-08-28 (user supplied `KALI_AFL_API_KEY` and authorised the retry) — both
  PASS, and P1 AMENDED S1.** Kali `/matches` is **not** a Squiggle proxy: a genuine value
  disagreement on a completed match (Essendon v Port Adelaide 2026-08-23, Kali 95–105 vs
  Squiggle 95–104 at `complete=100`), `crowd` on 80/204 rows where Squiggle has no attendance
  field, 0 shared ids, a different venue vocabulary on 80/160 joined games, no goals/behinds.
  `kali_afl_stats.match` therefore moved to its own `kali` group and to a fully declared
  14-column shape (`sourcedAt` = `source_updated_at`, new `kali_2026` round vocabulary);
  `/fixture` stays a proven proxy in the `squiggle` group. **P2:** no player id on the Kali stat
  grain, so a new `kali_afl_stats.player_stats` family records the gap as `identity_only`.
  **Residual, flagged for review:** P1 disproves *pairwise* derivation; a *common ultimate
  upstream* is not excluded. **P7 stays BLOCKED; no local database substitutes for it.**
- **Current state:** Evidence baseline established 2026-08-28:
  **P3/P4/P5/P6 PASS**, **P5 stop condition NOT triggered** (`url` is 0 NA and 1:1 with `ID`, but
  **`ID` is 82 NA in-season — key on `url`**); **P1/P2 BLOCKED**, no `KALI_AFL_API_KEY`;
  **P7 BLOCKED**, SSH refused and **no database queried**. Contract drafted: three observation
  grains (immutable payloads / ordered versions / current-key state, so A→B→A stays three ordered
  states while repeat polling stays idempotent), reconciliation verb set, reviewed-promotion
  contract with a stale-review recheck, source containment, independence groups, season lifecycle.
- **S2 IMPLEMENTED (2026-08-28), DB-free suite GREEN, migration still unapplied:** `src/db/migrations/074_source_observation_spine.sql`
  (**unapplied**) — three observation grains + `promotion_candidates` + append-only
  `promotion_decisions`; `src/lib/acquisition/observations.ts` (pure: no DB/fs/network/clock);
  `tools/maintenance/privileges.sql` registered so the append-only grant survives a reconcile;
  28 DB-free tests. A→B→A stays three versions over two payloads because history is keyed
  by `version_seq` and **never** unique on `payload_hash`. Acceptance fails closed, and manual
  authority `indeterminate` refuses exactly as `conflict` does.
- **Validation 2026-08-28, three runs: 59/61 (FAILED) → 61/61 (PASSED) → post-hygiene 61/61,
  0 failures, 303 ms (PASSED). S2 IS COMPLETE AND GREEN.** All behavioural tests passed every
  time. The two red assertions
  (`:653` append-only grants, `:668` history uniqueness) were **confirmed false positives**:
  `[^;]*` is not a SQL statement boundary, so both regexes spanned the migration's own
  explanatory comments. Only the **tests** were repaired — a `sqlStatements()` helper strips
  `--` comments and splits on `;`, and the assertions now pin the complete set of executable
  GRANTs on `promotion_decisions` and the single `UNIQUE` statement on the versions table.
  Migration unchanged, no invariant weakened (`issues/closed/AFLDB-ISSUE-096.md` §16.3).
- **S2 hygiene FIXED 2026-08-28 (§16.4):** the two literal NUL bytes in `observations.ts:499`
  are now `U+0000` escapes — **same character, so `observationKey()` output is byte-identical**;
  the runbook's suggested "plain space" separator was NOT adopted, as it would change runtime
  semantics and let a value containing a space make a key ambiguous. Header corrected to
  "migration 074". `073_data_overrides.sql` (ISSUE-086) still observed, not investigated (§16.5);
  `privileges.sql:294`'s "Migration 073" is ISSUE-086's and is correct.
- **S3 COMPLETE and GREEN 2026-08-28 — user-run `npm test -- tests/current-season-import.test.ts`:
  `84/84`, 0 failures, 316 ms.** `src/lib/acquisition/reconciliation.ts` (new, pure: imports only
  `./observations` and `./source-families`) computes exactly Decision C's ten verbs from a live
  payload against the stored open version, precedence exported as `VERB_PRECEDENCE`:
  `stale_review → absent → unchanged → unresolved_identity → foreign_owned_collision →
  source_disagreement → manual_authority_conflict → new / rescheduled / corrected`. Structural
  evidence resolves before content; refusal gates run only when a canonical change is actually
  proposed; `unchanged` comes only from the family hash contract; `rescheduled` stays distinct from
  `corrected`; `absent` is observation state and never deletion; `source_disagreement` needs
  disagreeing **independence groups**, not two source rows; foreign **or unreadable** ownership
  fails closed **before** authority is asked; provider agreement never substitutes for authority;
  `conflict` and indeterminate authority both fail closed; no database/network/filesystem/clock/
  write path, and no force, override or consensus shortcut.
- **`history_only` — settled S3 outcome, not an eleventh verb.** A changed payload that advances
  history but moves **no projected canonical fact field** (Squiggle completion `90 → 100`) returns
  `history_only`: not in `RECONCILIATION_VERBS`, not a candidate verb, not a canonical change —
  history advances with no fact-level proposal. Calling it `unchanged` would erase a real
  source-state transition; calling it `corrected` would propose a candidate with no changed fields.
  Do not redesign unless S4 integration evidence contradicts it.
- **S4 IMPLEMENTED 2026-08-28, AWAITING VALIDATION (§16.10).** New pure module
  `src/lib/acquisition/promotion-review.ts`: the candidate record with migration 074's CHECK
  constraints enforced in TypeScript; `baselineCanonicalHash` over **exactly the proposed fields**
  (`sha256/v1(canonical-fields)`, sorted names, sorted keys at every depth, 64 hex chars, null for a
  `new` target, refusal on an unread field); `renderReviewItem`; `evaluateAcceptRequest`; the
  requeue/supersede rule; and reject/requeue decision drafts. Render and accept both run
  `runPromotionGates`, which recomputes the baseline from re-read values and then delegates to
  **S2's `evaluateAcceptance`** — gate order and the `stale_review` / `stale_canonical_target`
  distinction unchanged. `stale_canonical_target` ⇒ re-render in place (stays pending);
  `stale_review` ⇒ **supersede** so reconciliation can insert the replacement. One additive,
  behaviour-preserving change to `observations.ts`: the canonicaliser is hoisted and exported as
  `canonicalJson`, because a family's payload `hash_exclusions` must never be applied to canonical
  values. 20 DB-free tests added to `tests/current-season-import.test.ts`.
- **§7 gate INTACT and enforced by construction.** `PromotionDecisionDraft` has **no `'accept'`
  decision** and typed-`null` value columns, so S4 cannot represent an acceptance; a cleared
  evaluation returns `write: { implemented: false, blockedBy: 'canonical_write_unimplemented' }`
  with `canonicalChange: 'none'`. Under `UNAVAILABLE_MANUAL_AUTHORITY` every promotable verb —
  `new` included — refuses. **Blocked pending ISSUE-086:** the canonical acceptance transaction
  (write + provenance quartet + `accept` decision row) for `corrected`/`rescheduled` onto an
  existing row. No force flag, override, bypass or consensus shortcut added.
- **Checkpoint — all four approved stages complete:** S1 `34/34`, S2 `61/61`, S3 `84/84`, **S4
  complete and green `105/105`** (0 failures, 357 ms, final post-hygiene run, user-run 2026-08-28).
  The **canonical acceptance/write transaction remains deliberately unimplemented** behind
  ISSUE-086's authority gate, and the S4 type/state model must **not** be read as evidence those
  writes exist. `history_only` remains settled as an observation-layer outcome only. Migration
  **074 UNAPPLIED**, with **no production and no `afldb_dev` database work** at any point.
  `AFLDB-ISSUE-100` remains separate. **No CHANGELOG entry** — nothing has landed behaviour.
- **NUL hygiene RESOLVED (§16.11).** Both `observations.ts` and `source-families.ts` carried a raw
  `0x00` where the intended value is U+0000. The assistant located the second one (the
  `parseSourceFamilyRegistry` duplicate-declaration machine key) but **could not repair it
  natively** and stopped for evidence; **the user verified (`cat -A` showed `^@`, proving the
  separator had not become a space) and performed the byte-level repair**, after which
  `grep -naP '\x00'` returned no matches and the suite stayed green. Runtime semantics unchanged.
  PostgreSQL `text` still cannot store U+0000 — a forward concern only if a later stage proposes
  persisting one of these composite machine keys.
- **Schema/migration gate GREEN 2026-08-28 (`issues/closed/AFLDB-ISSUE-096.md` §16.16).** The migration-073
  baseline blocker is **closed**; the §16.14 three-index repair landed in 074 before its first
  application; 074 and 075 were then applied in normal filename order — **074 then 075** — to
  **`afldb_test` only**. **75/75 applied, 0 pending, no drift**; privileges reconciled;
  `tests/integration/fk-indexes.test.ts` **2/2** (real-catalogue proof of ISSUE-096's three 074
  indexes and `AFLDB-ISSUE-086`'s `data_overrides.admin_user_id` at once); fingerprint
  **`c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`**.
- **§5.H refreshed (§16.16 supersedes §16.15).** `src/lib/acquisition/` still has **no persistence
  layer**, so 074 created tables and not a writer for them. New suite
  `tests/integration/observation-spine.test.ts` drives the real `decideObservation`/`sweepAbsences`
  and applies each decision to `afldb_test`, reading each head **back out of PostgreSQL**; it
  proves the **schema half** of §5.H only. **2 fully executable** (A→B→A correction replay;
  absence ≠ deletion), **3 partial** (idempotence; foreign ownership; stale-review race),
  **3 BLOCKED** (manual authority — ISSUE-086; `data_issues` disagreement row — never implemented;
  rollover supersession — ISSUE-101, no supersession column in 074). **No canonical
  acceptance/write path exists or was added**; no blocked row was faked.
- **VALIDATION GREEN 2026-08-28 (user-run):** `tests/current-season-import.test.ts` **106/106**,
  `tests/integration/fk-indexes.test.ts` **2/2**, `tests/integration/observation-spine.test.ts`
  **13/13**. The FK gate validates the §16.14 source-contract FK repair in 074 and ISSUE-086's 075
  index together. The first spine run failed only on a **fixture** defect — the seed wrote
  `seasons.is_complete`, generated from `status` since migration 015 — which aborted ten cases in
  shared setup before their bodies ran; the seed now writes `status = 'in_progress'`, **no
  behavioural assertion changed**, rerun 13/13. **13/13 proves the implemented PostgreSQL/schema
  half of §5.H only** — not an importer and not a canonical accept transaction, neither of which
  exists. The three partial rows stay partial and the three blocked rows stay blocked.
- **Exact next action — the last ISSUE-096-owned validation gap:** 074's append-only-by-grant
  invariant on `promotion_decisions` now has catalogue coverage in
  `tests/integration/privileges.test.ts`'s existing append-only contract (positive `SELECT`/`INSERT`
  grant, plus no `UPDATE`/`DELETE`/`TRUNCATE` for `afldb_auth`); `privileges.sql` was inspected and
  **not changed**, its spec was already correct. **Run
  `npm test -- tests/integration/privileges.test.ts`. Do not close ISSUE-096 until it passes.**
- **Exact next action: none inside ISSUE-096 as approved.** §11 decomposes to S1–S4 and stops, so
  **there is no approved S5** — a next stage is a fresh approval decision (§16.12). Unbuilt work and
  blockers: (1) the canonical acceptance/write transaction — **blocked on `AFLDB-ISSUE-086`** by
  §7's gate; (2) applying migration 074 + the §5.H PostgreSQL tests — **not** ISSUE-086-blocked but
  a separate explicitly authorised step, **`afldb_test` only**; (3) the admin review screen — an
  explicit §2 **non-goal** of this issue. Do not apply migration 074 and do not implement
  ISSUE-086 here.
- **Manual-authority boundary:** ISSUE-096 defines only the invariant and the fail-closed
  interface; the **mechanism/storage (incl. `data_overrides`) belongs to `AFLDB-ISSUE-086`** and is
  not pre-empted. Promotion of `corrected` candidates onto existing rows is gated on that contract.
- **Unblocked by this evidence:** `AFLDB-ISSUE-099` (P5) and `AFLDB-ISSUE-100` (P3) are no longer
  probe-blocked. `AFLDB-ISSUE-098` remains independently actionable.
- **Do NOT** implement any family-specific importer here (`AFLDB-ISSUE-099`, `AFLDB-ISSUE-100`
  own those). Do NOT duplicate `AFLDB-ISSUE-086` or `AFLDB-ISSUE-095`.
- **Approved policy retained:** free sources only; fetch/staging/diff automatic; canonical
  promotion reviewed by default; lineups staging-only; in-progress season only; completed
  seasons re-acquired via the full-history fitzRoy path.

-->

## AFLDB-ISSUE-099 — In-season AFL Tables settle stage

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Runbook:** `issues/closed/AFLDB-ISSUE-099.md` — **durable source of truth, approved implementation
  contract.** `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §2.4, §5, §9 row D, §13.5 is the parent
  investigation record.
- **Key files:** `tools/rebuild/fitzroy/acquire_core.R`, `fitzroy-contract.json`,
  `tools/migration/import_fitzroy_core.py`, `src/lib/acquisition/*`,
  `src/db/migrations/074_source_observation_spine.sql` (applied — **must not be edited**)
- **Current state:** OPEN, **in implementation on branch `claude/issue-099`**. **T1–T6
  COMPLETE.** Migration **076 applied and checksum-frozen — never edit it**, a defect needs a
  forward migration. T6 delivered `observation-store.ts` (behaviour-preserving extraction),
  `settle-afltables.ts` (pure contract + settle transaction), the review-first operator CLI, and
  the `tests/integration/settle-afltables.test.ts` gate. Final evidence: integration **13 passed
  / 1 conditional skip**, `current-season-import` **153/153**, typecheck at the exact pre-T6
  baseline (13 errors in 4 unrelated files, zero ISSUE-099), targeted ESLint 0/0. O1 proved over
  executable SQL + surviving sentinels; no canonical fact row written by any settle transaction.
  2026 still has no player-match statistics, period scores, attendance or Brownlow votes —
  v1 writes NO canonical row by design.
- **P5 — SUPERSEDED GATE.** The previous entry read *"implementation gated on probe **P5**.
  If P5 shows no stable `ID`/`url` for 2026, implementation is blocked."* **P5 ran
  2026-08-28 and PASSED; the stop condition was NOT triggered.** Do not rerun it. Binding
  result: `url` **0 NA** and 1:1 with populated `ID`; `ID` itself **82 NA** in-season.
  **Key on the stable `url`; never require `ID`; names are never identity.**
- **Superseded wording:** the "snapshot labelled `partial`" description is stale —
  `acquire_core.R` no longer emits a `partial` label. The in-season path is a third
  `acquisition_kind` (`in_season_partial`) with its own offline adjudicator.
- **Approved architecture:** in-season partial acquisition + SHA-256 manifest → deterministic
  Python→TypeScript observation bundle → migration-074 observation persistence → typed family
  projections → reconciliation → `promotion_candidates` → idempotent `data_issues` →
  dry-run/apply reporting. Families: `afltables.match` (→ `matches`, `match_period_scores`;
  attendance is a `matches` field) and `afltables.player_match_stats` (→ `player_match_stats`,
  `brownlow_round_votes`).
- **v1 canonical-write prohibition:** ZERO canonical INSERT/UPDATE and no `accept`
  `promotion_decisions` row. Acceptance is a separately approved later stage; its
  prerequisites are recorded at `issues/closed/AFLDB-ISSUE-099.md` §16.
- **Schema:** new forward migration **076** only — typed staging projections,
  `data_issues.issue_key` + partial unique index, FK-covering indexes, grants. Migrations
  073/074/075 are **not** edited.
- **Dependencies:** `AFLDB-ISSUE-096` Resolved (074 applied, checksum-frozen);
  `AFLDB-ISSUE-086` Resolved but entity-scoped — a prerequisite of the acceptance stage,
  **not** a v1 gate.
- **Exact next action:** **fresh session — start T7**: the `data_issues` writer / refresher /
  resolver with ownership scoping, plus §23.2 dry-run/apply counter reporting. Its gate extends
  `tests/integration/settle-afltables.test.ts`; no schema work is needed (076 already carries
  `data_issues.issue_key` + `uq_data_issues_open_by_key`, and the identity helpers are
  unit-tested). Then T8. Carried-forward constraints are in `issues/closed/AFLDB-ISSUE-099.md` "T6 — COMPLETE":
  restricted `afldb_import` role parity is a conditional matrix check for T8, and the bigint
  `batchId` type mismatch is separately tracked cross-issue debt — do not cast bigint to int.

<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-100` is **Resolved** (see `issues.md`). The detail
     block below is retained as lineage only. It is NOT an open issue and its
     "exact next action" is SUPERSEDED: L1-L3B2 shipped, migration 077 is applied and
     checksum-frozen, and real 2026 R20/R25 validation passed with idempotent replay
     (468 and 104 rows; 0 canonical writes; all canonical FKs NULL by design).
## AFLDB-ISSUE-100 — Staging-only lineup / team-announcement domain

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Runbook:** `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §2.5, §9 row E, **§13.10 (P3b evidence)**.
- **Key files:** `data/reference/source-families.json` (`afl_api.lineup` family +
  `afl_api_2026` round vocabulary), `tools/rebuild/afl_api/` (`afl-api-contract.json`,
  `acquire_lineups.R`, `emit_lineup_bundle.ts`), `src/lib/acquisition/lineup-bundle.ts`,
  `tests/afl-api-lineup.test.ts`, `tests/reference-data.test.ts`; new
  `staging.external_lineups` and the `afl_api` `sources` row (migration **077**, not yet written)
- **L2 COMPLETE and GREEN 2026-08-29** — bounded acquisition + deterministic observation bundle,
  **still entirely DB-free**: no migration, no `sources` row, no staging table, no persistence,
  no absence sweep. Three durable **family-local** contracts now exist: `external_record_id` =
  `providerId|teamId|player.playerId` in declared key order, refusing a missing, blank,
  non-string or `|`-containing component rather than escaping it; `scope_key` =
  `season=<int>;round=<int>`; and enumeration `complete: false` **permanently**, typed as the
  literal `false` so widening it fails typecheck. A **separate** `tools/rebuild/afl_api/`
  source contract was created rather than adding a fourth acquisition kind to
  `fitzroy-contract.json`, whose `applies_to_source` is AFL Tables. Gates: `afl-api-lineup`
  **38/38**; four suites together **272 passed / 2 pre-existing skips**; typecheck at the exact
  13-error unrelated baseline with **zero** ISSUE-100 errors. Proven end-to-end on live
  upstream: R20 468×20 with `lateChanges`, R25 104×19 without; in the real R20 bundle 26 verbatim
  `lateChanges` rows and 442 present-and-null, captain `false` 468/468, jumper integers 1–51,
  every projection null; re-acquire → re-emit byte-identical.
- **Current state:** OPEN, **L1 COMPLETE and GREEN 2026-08-29** — source-family contract only.
  **No schema, no migration, no persistence, no database access.** Both gates
  are satisfied: **P3 PASS** (identity — `CD_M…`/`CD_T…`/`CD_I…`, cross-endpoint join measured
  26/26) and **P3b PASS** (shape/types/NULLs/completeness — R20 468 × 20, R25 104 × 19). The
  column P3 counted but never enumerated is **`lateChanges`**, and it is **conditional**, so
  R25's 19 columns are a strict subset of R20's 20. 0 NA except `lateChanges` (442/468), 0 blank
  strings, **0 duplicate external keys over 572 rows**, exact fixture↔lineup **match-set**
  equality in both rounds. Gates: `tests/reference-data.test.ts` **39 passed / 2 pre-existing
  Python-gated skips**; `tests/current-season-import.test.ts` **172/172**.
- **Approved rule — retained explicitly:** **lineups are staging-only and never become
  canonical participation.** Canonical participation remains the played match sheet. No public
  surface. `promotion_policy` is `never` and is test-pinned.
- **Binding limitations (decisions, not gaps):** **absence sweeping DISABLED** —
  `markMissingObservationsAbsent()` is never called for this family and `absent_since` is never
  set, because match-set completeness does not prove row-grain completeness; migration-074
  version/idempotence persistence is otherwise reused unchanged. **`player.captain` not
  projected** — `FALSE` for 572/572 across 11 matches and 22 team instances, a sentinel, and
  deliberately *not* declared zero-is-missing. **`lateChanges` verbatim, never parsed or
  name-matched** — conditional, nullable, **team-grain** free text with no provider player ids.
  **No closed enum CHECKs** on `status`/`teamStatus`/`teamType`/`compSeason.shortName`/`position`
  — measured vocabularies, not provider contracts. **`required_columns` stays at five.**
- **Still unknown, and design-binding:** whether rows reflect the team **before or after** a late
  change (n = 1); whether team player-rows are **row-grain complete** on every run.
- **Corrected by P3b:** §13.3's round-25 record implied a uniformly unconfirmed payload; R25 is
  **50/50 mixed at match grain**. Identity finding unaffected.
- **L3A COMPLETE 2026-08-29 — all three provider→canonical mappings are `none`.** `CD_M…`/
  `CD_T…`/`CD_I…` appear in no migration, query or lib outside ISSUE-100's own code, and
  `afl_api` appears in no migration at all. `external_identities`'s only writer is
  `import_fitzroy_core.py:2285`, hard-coded to `afltables`/`afltables_profile_url`, so no
  `afl_api` identity exists and no approved bridge populates one. **No mapping was created.**
  **Pre-match match identity is structurally unavailable:** `matches` requires NOT NULL
  scores/result/margin (migration 003), so an unplayed fixture cannot exist there and
  `match_id` can never be NOT NULL. **Club resolution is incomplete:** 12/18 R20 team names
  resolve against the loader-derived alias set; six are marketing forms and two match no field
  at all. The DB-backed measurement was **not run** — no `.env` and no DSN in this worktree;
  none was fabricated.
- **OPTION B approved and implemented:** provider identity is NOT NULL and is the row identity;
  `match_id`/`club_id`/`player_id` are nullable and in no key. Mirrors
  `staging.external_current_matches` (migration 063). `lateChanges` is **settled as
  raw-observation-only** — no column, no table, no parsing, test-pinned.
- **Migration 077 APPLIED and CHECKSUM-FROZEN 2026-08-29** — `afldb_test` only, identity proven
  `afldb_test|afldb_owner`, **77/77 applied, 0 pending**. Registers `afl_api` **fail-closed**
  (idempotent on an identical row, `RAISE EXCEPTION` on a conflicting one — not 060/063's
  blanket `ON CONFLICT DO UPDATE`) and creates `staging.afl_api_lineup`. `jumper_number` is
  `text` per AFLDB's schema-wide convention (004/025/076). Two pre-application corrections
  landed first: the source description now describes the provider and the **lineup family
  only** rather than binding every future `afl_api` family, and "unauthenticated" became
  "requires no operator-supplied API key". **Never edit 077 — a defect needs a forward
  migration.** Gate: `tests/afl-api-lineup-migration.test.ts` **22/22**.
- **L3B2 COMPLETE and GREEN 2026-08-29.** `src/lib/acquisition/lineup-store.ts` persists an
  emitted bundle through the **074 spine** via the shared `persistSourceObservation()` (no
  second observation system), then upserts the typed projection linked to the exact
  `version_seq` read back from PostgreSQL, all inside one `sql.begin`.
  `tools/rebuild/afl_api/persist_lineups.ts` is the operator entry point. Proven properties:
  **`source_id` resolved internally from the literal `'afl_api'`** (no `sourceId` on the
  signature or options; refuses when the key is absent; refuses another source's bundle);
  **unresolved `match_id`/`club_id`/`player_id` stay NULL and the row still persists**;
  **no absence sweep**; **no DELETE/TRUNCATE executable path** (keyed upsert only — a code
  property, since `privileges.sql` grants `afldb_import` both schema-wide); **no canonical
  participation write** (writes exactly `import_batches` + `staging.afl_api_lineup`); **no
  typed `lateChanges` or captain projection**. Validation: `afl-api-lineup-store` **16/16**
  DB-free, `integration/afl-api-lineup-store` **11/11**, and **restricted-role parity GREEN**
  under `AFLDB_TEST_IMPORT_DATABASE_URL` (identity `afldb_test|afldb_import`; first persist,
  idempotent replay, revision advance). DELETE/TRUNCATE were deliberately **not executed**
  under that role — the invariant is that the path never issues them.
- **Exact next action:** **bounded real R20/R25 persistence validation** against the
  acquisitions already on disk at `data/sources/afl_api/lineups/`, then final close-out.
  Everything so far ran on synthetic fixtures. ISSUE-100 stays **Open** until that passes;
  CHANGELOG is deliberately not yet updated. Canonical enrichment (`match_id`/`club_id`/
  `player_id`) remains deferred by decision — `match_id` is unresolvable pre-match by schema,
  club enrichment would need ISSUE-099's private name-based resolver (12/18 on R20), and no
  `afl_api` player bridge exists. Note `tests/integration/fk-indexes.test.ts` scans
  `nspname = 'public'` only, so it does **not** cover this staging table's FK indexes — they
  were added by reading, as migration 076's were.

-->

<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-101` is **Resolved** (the reusable mechanism; see
     `issues.md` for the authoritative resolution record). The detail block below is retained
     as lineage only. It is NOT an open issue and its "not yet validated" / "Exact next
     action" text is SUPERSEDED: the focused suite is 131/131, the broader regression is
     5/5 suites / 472 passed / 6 existing skips, and
     `tests/python/ladder_identity_contract.py` passed every executable check (acquired
     witness bytes skipped — gitignored by design). **No season was rolled**, and actual
     2026 -> 2027 execution is intentionally deferred until the season is formally complete
     and genuine completed-season evidence exists.

## AFLDB-ISSUE-101 — End-of-season promotion / baseline rollover (RETIRED)

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture / Data integrity
- **Runbook:** `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §5 (rollover row), §9 row F.
- **Key files:** `src/lib/rollover/season-rollover.ts` (planner),
  `tools/db/rollover-season.ts` (CLI), `tests/season-rollover.test.ts`,
  `tools/migration/import_fitzroy_core.py` (offline `--contract` / `--stat-availability`),
  `tools/rebuild/fitzroy/validate_ladder_witness.py` (offline `--contract` / `--manifest-dir`),
  `data/reference/fitzroy-accepted-baselines.json`, `data/reference/seasons.json`,
  `data/reference/stat-availability.json`,
  `tools/rebuild/fitzroy/fitzroy-contract.json`,
  `tools/db/rebuild-test.ts` (`CLUB_SEASONS_EXPECTED.rows` only)
- **Current state:** OPEN. **Planner + CLI IMPLEMENTED 2026-08-29, not yet validated.**
  Pure DB-free planner computes and validates the whole successor state in memory; CLI is
  dry-run by default and `--apply` also requires `--acknowledge-season-complete`. No
  migration, no canonical write, no database connection, no clock read. **2026 is NOT
  rolled and the real 2025/2026 boundary is unchanged.**
- **Retired lifecycle vocabulary — ADJUDICATED 2026-08-29:** `retired` is the value for a
  baseline that was accepted and has since been replaced. Declared in the real register as
  `selection_policy.retired_statuses: ["retired"]` — a **policy declaration only**: the
  accepted baseline, `measured.seasons_last` (2025), `required_range` and both acquisition
  fingerprints are untouched. `accepted` may never be listed; `candidate` is **not** valid
  for a previously accepted baseline; unknown values refuse.
- **`accepted_corrections` — ADJUDICATED 2026-08-29:** no longer auto-inherited. Reviewed
  per acquisition via required `--accepted-corrections`; the outgoing record supplies
  **category names only**, never values; "no corrections" is stated explicitly as the same
  categories with empty arrays; missing/unknown/non-array categories and entries lacking
  `kind`/`rule` refuse.
- **Validator authority — corrected 2026-08-29:** operator-supplied validator stdout is no
  longer accepted. The CLI **executes** the validators on every invocation (dry run and apply
  alike), refuses on non-zero exit, and proves from the captured argv that each run was the
  right command against exactly the label/manifest/snapshot being bound. No
  `--skip-validation`, no supplied transcript, no cached success.
- **Pre-apply authority CLOSED 2026-08-29 (§14 of `AFLDB-ISSUE-101-HANDOFF.md`).** Backward-
  compatible, offline-only path overrides were added — `import_fitzroy_core.py --contract` and
  `--stat-availability` (both require `--validate-only`), and
  `validate_ladder_witness.py --contract` / `--manifest-dir` (both refused with `--compare`).
  **All defaults are unchanged**, so the rebuild orchestrator, `tests/python` and the settle
  path are unaffected. The CLI now materialises the computed successor contract and register
  in an OS temp directory and runs **three** gates before any tracked write:
  (1) `--validate-only --require-full-history`, (2) `--validate-only
  --require-accepted-baseline` against the successor register, (3) the offline ladder witness.
  Each captured run is bound by the **bytes read back** from the temporary files, so a gate
  that adjudicated some other state is refused. **`identity_scan` is now MEASURED by gate (1)
  and `--identity-scan` no longer exists as an input.** Only
  `validate_ladder_witness.py --compare` still waits for the rebuilt database.
- **Validation GREEN 2026-08-29 (user-run):** `tests/season-rollover.test.ts` **131/131**,
  no skips; broader regression **5/5 suites, 472 passed, 6 existing skips** (skip count
  unchanged from the 426/6 pre-override baseline). The importer's new paths are exercised
  end-to-end because `tests/fitzroy-core-import.test.ts` spawns it with `--validate-only`,
  `--require-full-history` and `--accepted-baselines`.
- **Exact next action:** run the one uncovered direct test of the changed witness validator —
  `.venv/Scripts/python.exe tests/python/ladder_identity_contract.py`. It is the only
  executable test of `validate_ladder_witness.py` (its §7 spawns it with **default** paths)
  and **no vitest suite runs it**, so the 472 do not cover that file. After it passes, the
  reusable mechanism is implementation-complete and `CHANGELOG.md` becomes appropriate; the
  only remaining work is the deliberate decision in `AFLDB-ISSUE-101-HANDOFF.md` §15.4 —
  defer live CLI exercise until a season actually closes, or rehearse against a throwaway
  temporary state. **Do not manufacture a fake 1897..2026 acquisition.**
- **Dependencies:** `AFLDB-ISSUE-099` and `AFLDB-ISSUE-095` are both **Resolved** — both
  dependencies are satisfied.
- **Corrected orientation (do not re-derive from the old wording):**
  - `matches_after_accepted_last_season` **already derives its boundary** from
    `accepted.measured.seasons_last` and re-points itself; it is not edited here. The gate
    that does **not** self-advance is `CLUB_SEASONS_EXPECTED.rows`.
  - `AFLDB-ISSUE-099` writes **zero canonical rows**, so there is no in-season canonical
    provenance to rewrite; supersession is the existing clean rebuild.
  - the old key-file list omitted `tools/rebuild/fitzroy/fitzroy-contract.json` and
    `data/reference/stat-availability.json`, which carry five of the coupled transitions.
- **Boundary:** **must not independently redefine completed-season `club_seasons` ownership**
  — that stays with `AFLDB-ISSUE-095`, which is **Resolved** and whose D1–D7 are
  **implemented, not open**. Its D7 already added six `club_seasons` Stage-9 gates. **Do not
  add another.** The only coordination point is the accepted ladder witness span.

-->

## AFLDB-ISSUE-102 — Awards have no canonical legacy-free acquisition path (RETIRED — Resolved 2026-09-02)

All eight closure criteria passed. The authoritative resolution and per-criterion evidence are
in `issues/closed/AFLDB-ISSUE-102.md` §8.4. ISSUE-113 remains Open outside the closure boundary;
the ISSUE-116 timing regression remains separately routed and did not affect this resolution.

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Runbook:** `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §2.7, §9 row G.
- **Key files:** `tools/migration/import_awards.py` (`:1408`)
- **Current state:** **Resolved 2026-09-02.** `import_awards.py` no longer operationally
  requires `AFLDB_LEGACY_SQLITE` for any canonical awards/honours rebuild group; all eight
  closure criteria passed.
- **Exact next action:** none for ISSUE-102. ISSUE-113 remains separate, Open and outside this
  issue's closure boundary.
- **Links:** `AFLDB-ISSUE-095` as the direct sibling gap — linked, **not absorbed**.

<!-- RETIRED 2026-08-27 — `AFLDB-ISSUE-093` is RESOLVED (see `issues.md` and
     `issues/closed/AFLDB-ISSUE-093.md` §H15). The detail block below is retained as lineage only. It is NOT
     an open issue and its "next action" text is SUPERSEDED: the first clean rebuild has since
     been executed and passed all nine stages with 13/13 final validation, and the only
     remaining follow-up is `AFLDB-ISSUE-095` above.

## AFLDB-ISSUE-093 — Deterministic afldb_test rebuild from authoritative sources (RETIRED)

- **Severity:** Medium
- **Area:** Tooling / Data integrity / Import architecture
- **Key files:** `issues/closed/AFLDB-ISSUE-093.md` (durable source of truth, §15 = Phase-1 record,
  §16 = Phase-2 record); `issues/closed/AFLDB-ISSUE-093-PHASE-3-HANDOFF.md`; `data/reference/*.json`;
  `tools/migration/load_reference_data.py`; `tests/reference-data.test.ts`;
  `tools/rebuild/fitzroy/` (contract + `acquire_core.R`);
  `tests/fitzroy-acquisition.test.ts`;
  `docs/rebuild-manifests/afltables_fitzroy_core/trial-2024.json`.
- **Current state:** Architecture approved; **Phase 1 COMPLETE (2026-08-25)** —
  static/reference domains ported to tracked JSON datasets + standalone loader,
  validated 12/12; old test DB preserved as `afldb_test_pre_rebuild_20260825`
  (`ALLOW_CONNECTIONS=false`, reference-only). **Phase 2 COMPLETE (2026-08-25)** —
  fitzRoy pinned at 1.8.0 (fail-closed version gate), canonical AFL Tables acquisition
  (`fetch_player_stats_afltables` + details + results) verified by real probes and a
  real `trial-2024` acquisition with a tracked SHA-256 manifest; stable ID/name/URL and
  match identity/scores/venue SUPPORTED; DOB/match stats/Brownlow votes (correct
  per-player-per-match grain)/attendance SUPPORTED WITH COVERAGE LIMITATION;
  `player_match_period_stats` MISSING (deferred). 13/13 static tests; zero
  `AFLDB_LEGACY_SQLITE`/PostgreSQL dependency. There is still no database named
  `afldb_test`; no load has been executed anywhere yet.
- **Depends on:** `AFLDB-ISSUE-092` §4 (the fail-closed `external_identities`
  population-sanity gate) must land in whatever importer owns that reconciliation before it
  is ever run against `afldb_test`, rebuilt path or not — this is now part of Phase 3.
- **Phase 3 IMPLEMENTED (2026-08-25, §17):** club-list DOB enrichment wired to canonical
  `data/sources/afltables/club_lists/` (complete-or-refuse in canonical mode, fail-closed
  header/file validation before any DB access, `--require-complete`;
  `tests/club-list-sources.test.ts` new) + ISSUE-092 §4 gate/§5 containment implemented
  (see that issue). Static gate PASS 33/33 (user-run 2026-08-25). DB-side validation of
  the gate tests awaits a test database.
- **Phase 4a IMPLEMENTED (2026-08-25, §18):** `tools/migration/import_fitzroy_core.py` —
  canonical snapshot+manifest → venues, players (+DOB evidence under the distinct
  fitzRoy source, external identities under the ISSUE-092 gate), matches/period
  scores/attendance, player_match_stats (explicit STAT_MAP, NULL ≠ 0), derived
  brownlow_round_votes (coverage-gated, NA ≠ 0). Fail-closed manifest/SHA-256/column
  validation before any DB access; `--validate-only` needs no psycopg.
  `tests/fitzroy-core-import.test.ts` new.
- **Checkpoint (2026-08-27) — read `issues/closed/AFLDB-ISSUE-093.md` §19 first; it supersedes the
  per-phase history above.** Canonical full-history fitzRoy source FROZEN
  (`full-history-20260827`, 1897–2025, accepted via
  `data/reference/fitzroy-accepted-baselines.json` under `exactly_one_accepted`); DraftGuru
  Stage A + supported importer COMPLETE; legacy `import_draft.py` tombstoned; orchestrator
  `npm run db:test:rebuild` implemented but **never executed**. Stage B3 optional, not
  started.
- **Blocker 2 — RESET_SQL proof: IMPLEMENTED, awaiting execution (2026-08-27, §20).**
  Two real defects found and fixed while inspecting it: `runSql` never sent the SQL at all
  (`void client.unsafe(...)` — postgres.js only executes on `.then`/`.execute()`), so the
  destructive stage would have reported success against an untouched database; and the
  `pg_` schema exclusion (`NOT LIKE 'pg\\_%'` through two escaping layers) excluded nothing,
  so `DROP SCHEMA pg_toast` would have aborted the first loop. New rollback-only proof
  `tools/db/prove-reset.ts` + `npm run db:test:prove-reset`; DB-free suite 417/417.
- **Execution-path parity correction (2026-08-27 review, §20.5).** The proof originally ran
  `RESET_SQL` through postgres.js while the real rebuild ran it through psql — proving the
  SQL and leaving the mechanism untested. Now both go through one shared helper
  `tools/db/psql.ts` with identical binary and argv; the proof's stream always ends in
  `RAISE EXCEPTION`, so psql cannot commit it and **exit status 0 is treated as a failure**.
  psql availability is probed through the reset's own argv and fails closed before the reset.
  Owner policy hardened to a refusal: `current_user` and `session_user` must both be exactly
  `afldb_owner`, neither a superuser (§20.5a).
- **INCIDENT 2026-08-27 — THE ROLLBACK PROOF COMMITTED THE RESET; `afldb_test` WAS WIPED
  (§20.9a, §20.12).** psql exited 0 instead of aborting, and the read-only verification then
  returned MISMATCH: pre-proof `0229d62c…` → post-incident `f46ce34c…`, i.e. schemas 1
  (`public` only), relations 0, migrations absent, extensions 3 with all 56 extension-owned
  objects intact. **That is exactly the intended clean slate, so `RESET_SQL` is now
  empirically correct; the rollback containment is what failed.** Production and `afldb_dev`
  were never targeted. Loss was schema + privileges only — no fitzRoy import had ever run.
  Leading cause: the psql argv led with the DSN, and PostgreSQL's own non-permuting
  `getopt_long` (Windows) can then swallow `--single-transaction` and `ON_ERROR_STOP=1` as
  operands, leaving psql to autocommit each statement and exit 0 regardless of errors; the
  stream itself is byte-clean (0 CR, 0 backslashes, 0 NUL, balanced dollar tags, sentinel
  correctly wrapped in a `DO` block). Fixed: DSN passed as `-d`, a probe that fails unless
  stdin is delivered AND a raising script exits non-zero, a deferred-constraint commit trap
  armed before the reset that also detects autocommit and stops the stream before the first
  destructive statement, and redacted relaying of psql's output. `db:privileges[:test]` moved
  off the same argv shape.
- **SELF-COLLISION FOUND AND FIXED 2026-08-27 (§20.14), reproduced twice.** The hardened
  proof refused with "1 other client session(s) connected" while a standalone psql check saw
  none and the phantom vanished on exit. Cause confirmed from the connection lifecycle: the
  CLI held ONE postgres.js observer open across the whole proof, so psql — a second backend —
  correctly counted it, while the Node-side gate could not see itself
  (`pid <> pg_backend_pid()`). The gate was right; the harness was the intruder. Corrected to
  three phases with nothing spanning the psql run: observation session opened and CLOSED,
  then psql only, then a FRESH session for the post-rollback fingerprint. `ProofDeps` now
  exposes `withSession` rather than a `query` handle, so no connection can be kept open, and
  **no application_name/PID/role exemption was added** — asserted by test.
- **RESET BLOCKER 2 CLOSED 2026-08-27.** `afldb_test` reconstructed after the incident
  (migrations 001–072, privileges reconciled, PostgreSQL 16.15, `afldb_owner` non-superuser)
  and the rollback-only proof re-run against a real schema: pre-reset and post-rollback
  fingerprints both `a8a2a899e431ced96afe2d80b4ec258b31533ae27c58791b5e8bf05e0bd0e1d7`
  (exact equality), health 950 relations / 3 extensions, psql exit 3 (the deliberate abort),
  1498 ms; inside the aborted transaction every rebuild-owned object class was 0 and the
  public schema, 3 extensions and 56 extension-owned objects were preserved.
- **Exact next action:** **FIRST ACTUAL CLEAN REBUILD**, fresh session, per the **FIRST CLEAN
  REBUILD HANDOFF (§H1–§H10)** at the end of `issues/closed/AFLDB-ISSUE-093.md`. The database holds
  migrated schema and privileges only — no canonical data has ever been loaded. The agent may
  inspect and prepare; the user runs the destructive command.
- **Superseded next action:** decide sequencing (§20.13). `afldb_test` is now an empty clean
  slate, so re-running the proof against it proves little. **Tell Codex before it touches
  `afldb_test` for ISSUE-083** — its schema and per-object grants are gone. Blocker 2 stays
  OPEN. Do **not** start the clean
  rebuild until it passes. Remaining blockers after that: ISSUE-083 restricted
  `afldb_import` parity (Codex, separate worktree, do not absorb), then the first actual
  clean rebuild. Preserved `afldb_test_pre_rebuild_20260825` stays locked, never an input.
  ISSUE-092 §11 tests 24–27 still pending.
-->

## AFLDB-ISSUE-155 — Admin / Super Admin overhaul

- **Severity:** Medium
- **Area:** Admin / Auth / Data management / Acquisition
- **State:** Open / In progress — Phase A (capability policy + Admin Centre nav) implemented and verified 2026-09-10. Phase B (Super Admin user lifecycle) implemented and validated 2026-09-10, record in `AFLDB-ISSUE-155.md` §26.20: promote/demote/deactivate/reactivate in one transaction under `pg_advisory_xact_lock(717275, 2)`, deactivate-not-delete, transactional last-viable-Super-Admin invariant, no self-demote/deactivate, session revoke on every transition, atomic audit, no migration. Gates: 98/98 unit+action, 17/17 DB integration and deterministic concurrency, typecheck green, desktop 1440×900 and mobile 375×812 browser acceptance passed. Phase C (Brownlow administration) planning complete 2026-09-10 — `AFLDB-ISSUE-155.md` §27: canonical fact = match-level vote row (`brownlow_round_votes.match_id`, backfilled deterministically), season totals derived into `brownlow_season_votes` at Super Admin publication, artefact seasons stay source-published, one additive migration (094 at planning time) adding `brownlow_vote_entry_state` and `brownlow_season_authority`, Admin drafts / Super Admin finalises, revision + fingerprint CAS, importer guards fail closed, match-sheet Brownlow write removed. Phase C1 implementation complete 2026-09-10: preflights P1-P12 green (P3 and P11 hard gates passed) and a new read-only P13 measured the artefact's own rank / winner / games / NULL-for-zero counting conventions (`AFLDB-ISSUE-155.md` §27.29); migration 094 APPLIED and post-validated on `afldb_test` (320,861/320,861 `match_id` resolved, zero integrity mismatches, both partial unique indexes and the workflow/authority constraints validated, focused regression 152/152) -- do not reapply. `src/lib/brownlow/entry.ts` and the canonical writer `src/db/queries/admin-brownlow.ts` are claim-and-demote, never delete, because the round table is a dense participation record (P1). Items 7-9 written 2026-09-10: the match sheet refuses ANY Brownlow value and no longer writes the column (the mirror survives every save); both Python reload guards fail closed on `manual_admin_edit` rows; `tests/integration/admin-brownlow.test.ts` + `brownlow-fixture.ts` (reserved seasons 2089/2085/2084) cover the migration objects, every refusal, the four transactions, publication against all P13 conventions, the two guard predicates, mirror preservation, the `deleteMatch` RESTRICT, and four two-connection races with `pg_blocking_pids()` proof that both contenders waited. Writing that validation found and fixed one real defect: `recomputeBrownlowCoverage` would have flipped a completed, not-yet-published season's `brownlow_season_total` coverage to `not_applicable` on its FIRST finalisation, and `lockMatch` would then have refused every match after it -- a permanent lockout of the exact season being entered; a season holding decisions is now `partial`. C1 runtime validation started 2026-09-10: `tests/integration/admin-brownlow.test.ts` is GREEN at 44/44 (~109 s) against `afldb_test`, migration 094 not reapplied. Getting there changed one application behaviour — the revision CAS now precedes the transition check, so the loser of a race is refused `stale` rather than `already_final` (§27.14/§27.17); non-racing submissions against the current revision still get `already_final` — and corrected three test-side defects: the row-lock race must observe the transitive blocking chain rooted at the held `matches` row (a tuple-lock queue means the second contender never names the holder), the correction test conflated a vote reshuffle with a displacement, and `participantsComplete` compared postgres.js string counts. `deleteMatch` now refuses a Brownlow-carrying match in the application before any destructive statement, with the FK left as a storage backstop (§27.15). **PHASE C1 COMPLETE, GATE GREEN 2026-09-10** (record: `issues.md` "fixture residue cleanup, §27.30 harness fix and C1 gate closeout"; `AFLDB-ISSUE-155.md` §27.30-§27.31). The `afldb_test` fixture residue a timed-out `beforeAll` had committed was cleared by a guarded, committed cleanup: all 15 entanglement guards 0, fixture auth precondition 0, every FK blocker scan 0, P01-P14 residue green, P15 collateral accounting green, exactly 419 rows deleted. The §27.30 harness defect is FIXED and VALIDATED on both abnormal paths, not by inspection -- module-level seed registry entered before the first fixture write, dedicated per-seed connection, cancellation checkpoints, and an `afterAll` sweep that cancels first, waits for settlement, force-closes the connection, then removes rows (memoised, idempotent, fail-closed; the 300 s internal deadline is now secondary protection only). Registry-sweep path PASS and internal-deadline path PASS (`AFLDB_BROWNLOW_SEED_DEADLINE_MS=3000`), 1 passed / 1 skipped each, clean process exits; the temporary `tests/integration/tmp-issue155-cancel.test.ts` was deleted after. Independent read-only verification afterwards (READ ONLY transaction, `_test`-only DSN and `current_database()` guards): every ISSUE-155 residue counter 0 -- `ISSUE155_RESIDUE_ZERO: YES`, with `GLOBAL_DATA_EDITS_ORPHANS: 0` informational only. Gates: typecheck GREEN; `admin-brownlow` 44/44 (expected stderr only from the deliberate audit-probe rollback); `data-editor` 9/1/2 with T6/T6b/T6c PASS; `privileges` + `release-gates` 56 passed / 3 failed / 7 skipped. All four remaining failures are PROVEN EXTERNAL 2026 current-season drift, not ISSUE-155 and not historical-data regressions: `matches_2026` 213, `complete_2026` 213, `complete_le2025` 15,187 (the pinned value exactly), `club_seasons_2026` 18, `pss_2026` 577, `cohort_on_2025_basis` 261 (the pinned value exactly) -- `PURE_2026_DRIFT_CONFIRMED: YES`; `not_collected` unchanged at 1,651. No expected value, no ladder logic and no `external_grid_axes`/`external_grids` privilege work was touched. Documented and NOT decided here: the release gates are pinned to a canonical 1897-2025 baseline (ISSUE-095, ISSUE-113 in their own source) while `afldb_test` also carries current-season 2026 rows -- the reconciliation, and the `data-editor` ladder assertion that depends on a match-free in-progress season, belong to the release-gate/current-season owner and are a candidate for a separate issue. Nothing deployed. **PHASE C2 COMPLETE AND VALIDATED 2026-09-10** (record: `issues.md` "Phase C2 implementation and validation"). `src/app/admin/brownlow/**` (season list, season page with publish panel, round page with per-match inline editor), `actions.ts` (5 Server Actions behind `data.brownlow.draft` / `data.brownlow.finalise`, §27.18 revalidation, refusal audit for `stale`/`already_final`/`forbidden` only), `admin-brownlow-ui.ts` (SELECT-only helpers), nav link + dashboard badge, and the match sheet's BV column made read-only with the payload no longer carrying `brownlowVotes`. New `tests/admin-brownlow-actions.test.ts` (24); `tests/auth.test.ts` nav extended. Gates: typecheck GREEN; C2 action + nav + match-sheet + admin-match-mutation contracts PASS; `admin-brownlow` integration 44/44 (regression); DB-free suite 3970 passed / 3 failed. Two pre-existing failures repaired while validating (NOT C2 regressions): `external-grids-import` "never widens" (C1 put its `privileges.sql` block inside that test's text slice — block moved before the migration-080 block) and `reference-data` "tables after 045" (list stale since ISSUE-122; synced with the two Brownlow workflow tables and the migration-080 `external_grid_*` trio). Remaining failures are all external or deferred: `db-promotion-check` ×2 = the §27.28 / §27.22 promotion-lineage follow-up (see Next action); `finals-semantics-contract` = the Windows CRLF false-failure (Linux green); the `data-editor` ladder assertion and `external_grid_axes`/`external_grids` privilege mismatch = §27.31 external. Browser acceptance (§27.27) sections A-D now clean on the disposable 2089 `afldb_test` fixture after two stale-tab defects were root-caused and fixed 2026-09-10 (see Next action). Sections **E, F and G PASS** 2026-09-10 (record: `issues.md` "§27.27 browser acceptance sections E-H"): 2089 was completed through the UI (#18298 finalised, #18299 voided) and PUBLISHED with one player marked ineligible — "9 polling players, 18 votes, 2 medallists" — and `/brownlow/2089` reproduces every P13 convention (competition rank over all polled players, ineligible keeps rank 1 with no medal, tied winners, H&A-only games); a stale second tab was refused `revision 13, not 12`; the match sheet's BV column is plain text with zero inputs and two unrelated audited saves left #18296 at revision 7 with the mirror intact; 2085/#18303 blocks finalise/void/publish with a clear short-line-up reason and commits nothing, and a deliberate DOM-level bypass produced no request at all because `react-dom` reads `disabled` from the fiber, not the DOM. Section H found DEFECT H-1 (focus dumped to `document.body` after a refused action) and E-1 (match-worded season refusal text); **both are now FIXED** — H-1 via `src/app/admin/brownlow/focus-restore.ts` (wired into `MatchVoteEditor.tsx` and `PublishPanel.tsx`), live-retested successfully. Sections I, J and K subsequently ran and **PASSED**, including K's Super Admin/Admin/Contributor capability-boundary probes (`issues.md` "§27.27 sections I–K complete"). One further finding surfaced during K — a dev-mode-only `flushComponentPerformance` negative-timestamp console `TypeError` on `requireCapability`-triggered redirects — and was disposed BENIGN DEV-MODE FRAMEWORK ARTIFACT / NOT AN ISSUE-155 PRODUCT DEFECT after a read-only investigation (no application timing code, absent from the production React bundle by dead-code elimination, clean across 5 real `next build`/standalone-server navigations against `afldb_test`, and reproduces identically on a non-Brownlow `requireSuperAdmin` control page — so it is generic to the shared redirect pattern, not Brownlow-specific). **§27.27 IS NOW FULLY PASS (A-K).** C1+C2 deploy together; deployment NOT yet safe only because the promotion-contract stop condition below is still open and the disposable acceptance fixtures in `afldb_test` have not yet been cleaned up. Phases D-I not implemented. **Subsequently (2026-09-10):** Linux-local validation against the exact current working tree confirmed `tests/integration/admin-brownlow.test.ts` 44/44 PASS (~7.95s test / ~8.80s total Vitest duration, expected audit-probe stderr during the rollback case, that test PASSed) and `tests/admin-brownlow-actions.test.ts` 32/32 PASS (Linux-local and the earlier Windows non-DB run). The Windows-tunnel `admin-brownlow` integration timeout was diagnosed and disposed as tunnel latency, NOT an ISSUE-155 product or test defect: tunnel connectivity was healthy (~150-165ms direct queries, ~65.8ms measured per SQL round trip over the Windows->SSH tunnel), the Brownlow fixture seed issues 700+ statements (season 2089 alone ~326 statements/~21.5s), and that arithmetic does not fit Vitest's default 30s `beforeAll` budget over that tunnel — `hookTimeout` was not raised and no production code was changed. The `PROMOTION_CONTRACT` implementation for `brownlow_vote_entry_state`/`brownlow_season_authority` (staged `match_id` remap via a new `rowIdColumn` mechanism, player-slot remap via the AFL Tables profile-url identity) is now COMPLETE in the working tree, uncommitted — see Next action. **Committed 2026-09-10 at `3eb6739f1ca13e63b43beb20bce5ff5ce5ad003d`** on `codex/issue-155-admin-overhaul`. **DEV §27.21 deployment COMPLETE 2026-09-11** (record: `issues.md` "Committed ... and DEV §27.21 deployment complete"): all twelve §27.20 preflights re-run and green on `afldb_dev` itself (not just `afldb_test`), migrations 092/093/094 applied (94/94, 0 pending — 092/093 were an unrelated pre-existing ISSUE-152 gap on DEV, safely applied first), `db:privileges` reconciled and independently re-verified (narrow-grant, no TRUNCATE for `afldb_import`, zero for `afldb_auth`, zero `PUBLIC` grants), pre-deploy `_test` suites green (44/44, 32/32, 35/36 with only the known ISSUE-138 drift), deployed via `sync-dev.ps1 -RemoteRef` + `-SkipMigrate` (after independently re-confirming 0 pending — no deploy script modified, no migration-safety check weakened), live-DB reconciliation clean (all `db-health` career checks 0, `match_id` unresolved count 0), and full browser acceptance on the deployed service (Super Admin/Admin/Contributor capability boundaries, Save Draft mutation acceptance proven public-invisible by source and confirmed live). Three §27.20 wording defects found during the DEV pass and corrected in `AFLDB-ISSUE-155.md` (P6 "1984+"→1984–2025; P8 "expect 0 for 1899+" now reflects 7 accepted incomplete-2026 exceptions and zero historical ones; P12 split into the 1984–2025 comparison vs. the pre-1984 1931–1934 mirror-only population). **DEV is COMPLETE. PROD is PENDING** and not started — no PROD command has been given or run. ISSUE-155 remains OPEN.
- **Key files/subsystems:** `src/lib/auth/capabilities.ts`, `src/lib/auth/session.ts`, `src/app/admin/admins/**`; Phase C1: migration 094, `src/lib/brownlow/entry.ts`, `src/db/queries/admin-brownlow.ts`, `player-derived.ts`, `audit-log.ts`, `capabilities.ts`, `src/lib/match-sheet.ts`, `src/db/queries/match-sheet.ts`, `tools/maintenance/privileges.sql`, `tools/migration/import_brownlow_season.py`, `tools/migration/import_fitzroy_core.py`, `tests/integration/admin-brownlow.test.ts` + `brownlow-fixture.ts`; Phase C2: `src/app/admin/brownlow/**`, `src/db/queries/admin-brownlow-ui.ts`, `nav-model.ts`, `src/app/admin/page.tsx`, `MatchSheetEditor.tsx`, `tests/admin-brownlow-actions.test.ts`, `tests/auth.test.ts`, `tests/reference-data.test.ts`.
- **Next action:** DEV is fully deployed and accepted (see State above) — nothing further required there. What remains before ISSUE-155 can close is the **PROD** leg: the equivalent §27.21 sequence against production (preflights, migration 094 + the same 092/093 prerequisite check against PROD's own ledger, privilege reconciliation, deploy, live reconciliation, browser acceptance), plus whatever the ISSUE-151 promotion/restore-lineage pipeline additionally requires for a production host (not exercised by the DEV pass). This should be planned and executed as its own deliberate session, not started automatically. The `PROMOTION_CONTRACT` implementation itself (§27.28 / §27.22 ISSUE-151 follow-up) is DONE and committed — `brownlow_vote_entry_state` and `brownlow_season_authority` are both declared in `tools/db/promotion-inventory.ts`, `tests/db-promotion-check.test.ts` updated to match; do NOT use `grant_import_write()` for either table. No new issue ID. The two §27.27 stale-tab defects that stopped the 2026-09-10 partial run are both ROOT-CAUSED AND FIXED, and the stale-tab repro re-runs clean from freshly navigated tabs (record: `issues.md` "§27.27 stale-tab defects — both root-caused and FIXED"): the React console error was a `useActionState` dispatch called outside a transition (all four buttons now go through one `submit(runner)` helper that dispatches inside `startTransition`; `isPending` measured working), and the selection/reason reset was the reset `useEffect` re-running because the App Router destroys and re-creates the subtree's effects after EVERY Server Action round-trip — `useState` initialisers do not re-run, but a dependency array does not survive an effect re-mount, so the reset fired on refusals too. Reconciliation is now decided from a recorded `revision:canonicalFingerprint` in the state itself (`reconcileVoteEditorState` in `vote-form-data.ts`) via React's render-phase "adjusting state when a prop changes" pattern, and `MatchVoteEditor.tsx` now has no `useEffect` at all; that also cleared a pre-existing `react-hooks/set-state-in-effect` lint error. Gates: typecheck GREEN, eslint GREEN on both changed files, 132/132 across `brownlow-vote-form-data` (15, +10 new) / `brownlow-entry` / `admin-brownlow-actions`, `git diff --check` clean; `tests/integration/admin-brownlow.test.ts` deliberately not run while the live fixture owns `issue155-2089-*`. Uncommitted. **§27.27 is now FULLY PASS, A through K (2026-09-10).** DEFECT H-1 (focus dumped to `document.body` after a refused action) and FINDING E-1 (match-worded season refusal text) are both **FIXED and live-retested successfully** — see `issues.md` "§27.27 sections I–K complete". Sections I, J and K then ran clean, K covering Super Admin (full capability), Admin (`data.brownlow.draft` only — save draft works, finalise/correct/void/publish render disabled with "Super Admin only" copy and a forced DOM-bypass click on each produces zero network requests) and Contributor (no Brownlow nav or route access at all; every route redirects server-side before any Brownlow markup or action reference reaches the client; a forged `Next-Action` probe 404s). One further console-only finding (a dev-mode `flushComponentPerformance` negative-timestamp `TypeError` on any `requireCapability`/`requireSuperAdmin`-style redirect, React's own instrumentation bug, absent from the production bundle and clean across 5 real production-mode navigations against `afldb_test`) was disposed BENIGN DEV-MODE FRAMEWORK ARTIFACT / NOT AN ISSUE-155 PRODUCT DEFECT — no application code touched. **Next:** (1) commit the working tree (the promotion-contract implementation is done, see above — nothing further to write there); (2) clean the disposable `issue155-acceptance-*` fixtures in `afldb_test` (seasons 2085/2089) and re-run `tests/integration/admin-brownlow.test.ts` + `tests/admin-brownlow-actions.test.ts` + `tests/db-promotion-check.test.ts` clean; then (3) the §27.21 deploy sequence. Do not absorb the §27.31 database-state policy question or the `external_grid` privilege mismatch. **Scope narrowed 2026-09-11:** Phases D–I are transferred by reference to `AFLDB-ISSUE-156`; this issue now owns ONLY the PROD closeout of A/B/C1/C2 (record: `issues.md` ISSUE-155 "Scope transfer").

## AFLDB-ISSUE-156 — Admin Centre completion (umbrella)

- **Severity:** Medium
- **Area:** Admin / Auth / Data management / Acquisition / Operations
- **State:** Open / Planning complete 2026-09-11 — no implementation started. Umbrella for the former ISSUE-155 Phases D–I plus two newly identified prerequisites: the audit trail has no usable read surface (`src/app/admin/page.tsx:46-51` is the only `auth_audit_log` reader; `data_edits` has none), and 15 of 18 declared capabilities are nav-only, never reaching `requireCapability()`. Children allocated: 157 (P1), 158 (P2). P3 Coach admin (155 Phase D), P4 Special records (E), P5 Honours lifecycle, P6 Site content (F), P7 Safe refresh (G), P8 Data-editor decomposition, P9 Player lifecycle/merge (HIGH), P10 Fixture-identity correction (HIGH), P11 CSV transition (H), P12 Integrated acceptance (I) are named placeholders with no ID until each starts. Migration 095 is the planning snapshot only, not allocated. ISSUE-155 PROD and ISSUE-151 are not blockers; ISSUE-151's promotion-inventory contract applies to P3/P4/P5/P7/P9/P10. ISSUE-154 not reused. P3 carries stop condition C-1 (coach-only identity blocked by NOT NULL `coaches.afltables_coach_path` / `source_id`, migration 087).
- **Key files/subsystems:** `AFLDB-ISSUE-156.md` (runbook); baseline architecture `AFLDB-ISSUE-155.md` §5/§6/§7/§17/§18/§23; `src/lib/auth/capabilities.ts`, `src/app/admin/nav-model.ts`, `src/db/queries/audit-log.ts`, `tools/maintenance/privileges.sql:435-470`, `tools/db/promotion-inventory.ts`.
- **Next action:** start `AFLDB-ISSUE-157` in a fresh implementation session (Fable, high effort, normal implementation mode; escalate to a fresh Opus session only if genuine auth/privilege architecture ambiguity surfaces): `npm run worktree:bootstrap -- --issue 157 --branch <agent>/issue-157`, then `npm run preflight -- --mode implementation --issue 157`, carrying `AFLDB-ISSUE-156.md` §11 P1 contract + §4/§5. Then 158.

## AFLDB-ISSUE-157 — Admin foundation and audit viewer (ISSUE-156 P1)

- **Severity:** Medium
- **Area:** Admin / Auth / Operations
- **State:** Open / Not started. Read-only `/admin/audit` (Operations group) over `auth_audit_log` + `data_edits` with actor / date / entity / action filters and a per-entity "who changed what, from → to" view; SELECT-only readers beside the writer in `src/db/queries/audit-log.ts`; a viewer capability enforced via `requireCapability()`; `src/components/admin/` extraction only where two or more routes already duplicate a pattern (reuse the `player-links` pager). **Confirmed no migration, no privilege change** (`privileges.sql:441`, `:463` already grant `afldb_auth` SELECT). `data_overrides` visibility deferred (afldb_import-only grant, subtractive list). Traps: int8-as-string ids, jsonb `detail` already decoded. No ISSUE-151 or ISSUE-155-PROD dependency.
- **Key files/subsystems:** `AFLDB-ISSUE-156.md` §11 P1 contract; `src/db/queries/audit-log.ts`, `src/db/authClient.ts`, `src/lib/auth/capabilities.ts`, `src/app/admin/nav-model.ts`, `src/app/admin/player-links/`, `tests/auth.test.ts`.
- **Next action:** fresh worktree + `npm run preflight -- --mode implementation --issue 157`; re-verify the two privilege grants and the `Capability` union since `e27e985`; then implement. Stop if any write path or any privilege/migration becomes necessary for the default scope.

## AFLDB-ISSUE-158 — Capability enforcement (ISSUE-156 P2)

- **Severity:** Medium
- **Area:** Admin / Auth
- **State:** Open / Not started. Migrate role-name guards under `src/app/admin/**` to `requireCapability()` where the declared capability describes the same boundary (15 unenforced of 18); retain `requireSuperAdmin()` on `people.admins.lifecycle` (ISSUE-155 §26.3) with a capability assertion beside it; add a source-contract regression in `tests/auth.test.ts` proving every `Capability` member is enforced at a route/action boundary and no admin mutation lacks a server-side assertion. No migration, no privilege change, no ISSUE-151 dependency; independent of 157 except for shared component reuse.
- **Key files/subsystems:** `AFLDB-ISSUE-156.md` §11 P2 contract; `src/lib/auth/capabilities.ts`, `src/lib/auth/session.ts`, `src/app/admin/**`, `tests/auth.test.ts`.
- **Next action:** after 157: `npm run preflight -- --mode implementation --issue 158`, re-enumerate guard call sites, then implement. Stop if any direct URL loses its current guard or a capability is enforced more weakly than the role guard it replaced.
