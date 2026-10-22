# ISSUE-316 C2 supplement-free candidate support proposal — 2026-10-21

> **Retention review (2026-10-22, evidence-retention session).** File content before this note had SHA-256 prefix `0f01480a9f51a565` (matches the rehearsal closure). Cited retained-artefact hashes were re-checked; historical text below is preserved unmodified. The "implementation approval PENDING" headline is history. The isolated rehearsal at `5643f5c2` ran supplement-free and passed, and N5 (2026-10-22) proposes `baseline_only` shared height/coach statistics with no supplement for a successor (see the consolidated proposal in the [decision package](issue316-c2-successor-decision-2026-10-21.md#consolidated-successor-proposal--2026-10-22)). Production adoption remains an owner decision. See the [rehearsal closure](issue316-c2-rehearsal-closure-2026-10-22.md#8-retention-review-and-dependency-lock-findings-2026-10-22).

**Proposal only; implementation approval PENDING. ISSUE-316 OPEN. Production NO-GO.**

## 1. Authority and retained findings

One agent. The owner authorised this bounded implementation proposal only. No implementation, contract/reference edit, accepted binding or stage execution is authorised. The owner permits further candidate assessment with every unmatched and name_mismatch register row still rejected. This includes Collingwood Caps 162/182/615/649: the four goal discrepancies remain unresolved and rejected for height matching. Neither goal value nor blank-to-zero semantics is approved. Jumper disagreements remain informational and never select, strengthen or reject identity.

Read AGENTS.md and the retained [height applicability](issue316-c2-height-applicability-2026-10-21.md), [source reconciliation](issue316-c2-height-source-reconciliation-2026-10-21.md), [exception evidence](issue316-c2-height-exception-evidence-2026-10-21.md) and [goal verification](issue316-c2-height-goal-verification-2026-10-21.md) reviews. Their completed provenance, overlap, reconciliation, historical-evidence limitations, linkage, quarter and rehearsal findings are reused. No raw source aggregation, historical browsing or completed measurement was repeated.

The retained overlap finding is sufficient to reject the predecessor supplement as additive input to this candidate: all its 9,614 rows already occur in the candidate with identical height-join and coach fields. No dummy supplement, self-supplement, automatic overlap removal or deduplication is proposed. Baseline-only support does not establish production height coverage or successor acceptance.

## 2. Implementation-basis inspection

Basis: **4a2eea89cccc465f2f017fb06ad55a7d4cb7733d**. Native in-process filesystem inspection only; no retained application or loader module was imported or executed. Graph tools were unavailable. Direct source ranges below provide bounded evidence, without a graph completeness claim.

The inspected working-copy sources, normalised to LF, match the source hashes already recorded for this basis in the applicability/source-reconciliation reviews:

| Source | SHA-256 of inspected LF bytes |
|---|---|
| tools/db/rebuild-test.ts | 5903e5115b6a6110963de6c7b8312b276b81869b5ea236df55a9d23676b51419 |
| tools/migration/enrich_heights.py | 647bb383eb661f0ab0b0d6cac2dafe495b27a3f7361c7ea3ffafd50a51a6bcf0 |
| tools/migration/import_match_coaches.py | 606399b5dc283b5776f2e0780925a3277288605aad3c78ac9fe3ca460991674d |

This corroborates the inspected implementation against retained source bindings; it is not a new Git/whole-tree verification or acceptance of any candidate artifact. No historical archive or raw input hashes were remeasured. Current contract/tests were read as local model and regression context, not as accepted successor inputs.

| Exact source location | Current behavior and implication |
|---|---|
| rebuild-test.ts:2986–3035, especially 3009 | HeightEnrichmentPins carries supplements and three measured integers. Missing block/list/measurements or an empty list refuses. Each listed manifest is proved using canonical LF bytes (2961–2983). This empty-list refusal is the actual support gap. |
| rebuild-test.ts:1333,2824–2834,3070–3080 | Stage label and preflight text assume supplements. Data argv appends one --supplement-label per pin; validate argv derives from data argv. Empty iteration would already produce the correct loader arguments. |
| enrich_heights.py:310–364 | Loader already defaults supplements to []; verifies exactly one baseline register and all baseline stats, then each supplied supplement. --validate-only exits before reconciliation and database access. No loader change is necessary. |
| rebuild-test.ts:3317–3325; import_match_coaches.py:146–152,275–297 | Coaches deliberately receives the same height supplement list. Its loader also already supports []. Its coach-page pin remains separate. Removing supplements changes both stages' stats input, not just height arguments. |
| import_match_coaches.py:166–205,299–341 | Coaches folds Coach strings by canonical match/club using existing core row corrections/club policy; differing strings refuse, blanks remain gaps, exact frozen index strings resolve pages. Profile/player and canonical match links remain separate checks. Duplicate identical strings folding harmlessly does not establish successor assignments. |
| rebuild-test.ts:3127–3146,3334–3356 | Five height and eight coach final checks remain mandatory; their expectations are not source-mapped register counts. |

The loaders' existing zero-supplement CLI support is not permission to bypass the runner's binding/preflight gates.

## 3. Recommended smallest change

Change the runner's binding reader and its direct callers only, plus focused regression tests. Keep the two Python loaders unchanged.

### Explicit configuration model

Extend datasets.player_details.height_enrichment with an optional **stats_input_mode** discriminator. Proposed values are **supplemented_baseline** and **baseline_only**. Add **baseline_snapshot_label** for explicit baseline-only bindings. These names are proposed, not installed configuration.

| Configuration | Required handling |
|---|---|
| Existing block, no mode, nonempty supplements | Preserve legacy supplemented-baseline behavior exactly: same manifest proofs, list order, argv, measurements and final gates. Do not rewrite existing contract bytes. |
| Explicit supplemented_baseline | Require a nonempty supplement list and all existing bindings/measurements. Same behavior as legacy. |
| Explicit baseline_only | Require supplements to be present as exactly [], a nonblank baseline_snapshot_label equal to the actually selected fitzRoy baseline, and all three measured integers. No supplement argument is emitted. Baseline register/stats still pass their normal manifest/hash preflight. |
| Missing block/list/measurements; empty list without baseline_only; unknown/null/nonstring mode; baseline_only with supplements or missing/wrong baseline label | RebuildRefused before destructive execution. Never infer mode from year, data availability, list absence or an accepted-reference change. |

Retain the existing supplements and measured fields in the returned HeightEnrichmentPins model; add the normalised mode and explicit baseline binding. Thread the already resolved baseline label into the binding validation at every use: stage presentation, height and coach data/validate argv, preflight diagnostics and final height checks. If no selected label is available for a baseline_only binding, refuse rather than silently skip comparison. Keep one resolution path; do not introduce a CLI switch or a second candidate-source selector. A narrow test injection seam for this reader/argument construction is acceptable; no generalized dependency-injection refactor.

The baseline label is an additional scope guard, not a replacement hash binding. The existing selected baseline manifest and accepted-source gates still establish input bytes. Existing supplement manifest path/hash proofs remain unchanged for supplemented input. No loader source-matching predicate or manifest verification is weakened.

### Coaches: retain and declare the shared dependency

For the smallest scope, **keep coaches on exactly the same baseline/stats-supplement set as heights**. Define stats_input_mode as applying to both consumers in the model documentation, shared validation and test names. Both data and validate argv must consume the same resolved binding. baseline_only therefore sends no supplement to either loader; supplemented_baseline preserves every existing supplement for both. Update the coaches stage description/diagnostics to make that dependency visible.

Do not add an independent coaches supplement list, silently retain the old supplement for coaches, or bypass height binding validation in the coaches builder. Coach-page accepted_snapshot, its manifest proof, profile-link corrections and its measured outcomes remain independently required. Approval of this shared-input implementation would not approve the frozen coach pages for the successor. If the owner needs different stats inputs for coaches, stop for a separate model proposal; independent inputs are outside this minimum change.

### Presentation and measurements

Render stage descriptions from the actual input list so baseline_only has no dangling plus sign or claim that an in-season supplement is required. Preserve supplemented argument order and meaning. Failure text must describe baseline/register and configured supplements accurately while retaining the before-destruction refusal.

All three height measured fields remain mandatory integer expectations, with no fallback, zero default, threshold or automatic derivation. No successor numeric value is supplied by this proposal. A runnable baseline_only configuration cannot be approved until fresh canonical measurements are available and separately reviewed. The implementation/tests can be reviewed without installing such a configuration.

## 4. Exact gates to preserve

1. Selected baseline eligibility, exactly-one accepted selection, manifest bindings and every consumed artifact hash; no source/reference selection bypass. provePin remains active for every supplement and the separate API/coach manifests. Baseline-only means zero supplements, not zero source checks.
2. Height source predicate: unchanged raw stripped URL/club aggregation, exact club/games/goals/season-set facts and exactly one name-matching candidate. Multiple named candidates remain ambiguous; unmatched/name_mismatch remain unselected and are rejection evidence. Retain existing height parsing and local club aliases; no new alias or blank policy.
3. No core continuity merges, core row drops or display-name fallbacks inside height aggregation. Approved core continuity can supply canonical identities later; it does not combine raw height fact aggregates. The Jim Stewart and split-URL limitations remain.
4. Canonical height identity requires afltables source, afltables_profile_url method, unique/resolved status and nonnull player_id (enrich_heights.py:391–417). No name/jumper canonical fallback.
5. Preserve plausible height bounds, evidence source/type/confidence/profile/occurrences/import-batch lineage, rejection records and transactional writes. Only NULL heights fill and must link to justifying evidence. Internal conflicts prevent fills; different existing heights remain and produce conflicts (423–434,490–558). Zero raw-URL conflicts cannot prove zero canonical conflicts.
6. Preserve all five height final keys: players_with_height, height_without_evidence, height_conflicts_open, players_with_afl_api_height_evidence, players_with_wikipedia_height_evidence. API and Wikipedia remain corroborating evidence only. Their inputs, resolution and canonical distinct-player coverage require successor applicability checks.
7. Preserve all eight coach final keys: coaches, coaches_linked_to_players, coaches_unlinked, coaches_linked_outside_unique, match_coaches, matches_with_both_coaches, matches_with_one_coach, matches_without_coach. Keep the existing zero outside-unique invariant and all exact string/profile/match checks.
8. Preserve preflight/data argument parity, preflight before destruction, stage ordering and first-failure stopping. Baseline-only support does not skip heights, either corroboration stage or coaches.

The retained 16,713 mapped register rows, 15,870 mapped valid-height occurrences and 12,580 raw URLs are source observations only. **None is a canonical-fill or final players_with_height expectation.** The predecessor 12,487 fill count and other predecessor counters must not be copied into successor expectations. Even equal successor values need new applicability evidence; equality is not inheritance.

## 5. Bounded implementation files and focused tests

| File | Proposed implementation scope |
|---|---|
| tools/db/rebuild-test.ts | Extend HeightEnrichmentPins/heightEnrichmentPins mode and baseline validation; thread selected label through direct height/coach consumers and final-check construction; accurately describe both input modes. Preserve loader paths, stage graph, SQL gates and legacy behavior. |
| tests/db-test-rebuild.test.ts | Extend existing height enrichment (1829–1921) and coaches (2008–2094) blocks using injected synthetic bindings. Keep current tracked supplemented-contract regression. Test actual argument builders/stage/preflight/final-check paths, not only a standalone parser. |
| tests/height-reconciliation.test.ts | Extend the closest pure-reconciliation suite with bounded negative cases guarding the specified identity boundary; no new production predicate. |

Required runner cases: explicit baseline_only produces no --supplement-label in heights or coaches and both validate argv equal data argv plus --validate-only; baseline mismatch/omission refuses in both builders and relevant stage/final-check paths; no implicit [] acceptance; unknown modes and contradictory lists refuse; missing/noninteger measured values refuse; malformed/missing/mismatched configured pins still refuse. Existing nonempty legacy configuration must reproduce existing argv/order and final expectations; explicit supplemented mode does likewise. Synthetic integer fixtures are test data, never proposed successor counters.

Use the existing preflight fake effects to prove baseline register/stats failure, supplement failure where configured, API/Wikipedia failure and coach-page failure all stop before reset. Check all five/eight final keys and exact configured expectations remain present in both modes. Exercise stage labels with [] and multiple supplements. Preserve existing target, environment and ordering assertions.

Height negative cases: same club/name/games/seasons with differing goals stays unmatched, including literal blank register Goals versus positive stats Goals; a spelling mismatch stays name_mismatch; multiple matching names stay ambiguous even if jumpers favor one; disjoint nonempty jumpers leave an otherwise mapped result mapped with false informational corroboration. Split raw URLs remain split, not merged. Existing tests already cover several adjacent cases; extend rather than duplicate them. These fixtures characterize existing behavior without endorsing blank-to-zero semantics or correcting the four historical cases.

Run the existing tests/coach-reconciliation.test.ts as the loader regression: exact index matching, conflicting strings, gaps and profile-only identity/continuity rules. No new coach loader code or test file is required. No Python file, migration, acquisition code, contract, accepted register, active reference, roster, Wikipedia artifact or adjudication file is in the implementation edit scope.

## 6. Verification after a separately approved implementation

### Source-only verification

First run the focused runner height/coaches blocks with effects injected; then the two pure-loader regression suites. Suggested commands for a later authorised, isolated validation checkout (not run here):

~~~text
npx vitest run tests/db-test-rebuild.test.ts -t 'height enrichment|coaches \(AFLDB-ISSUE-118' --no-cache --configLoader runner
npx vitest run tests/height-reconciliation.test.ts tests/coach-reconciliation.test.ts --no-cache --configLoader runner
~~~

Use the established isolated TEMP/TMP and cache/output controls. Python subprocesses in the loader suites must disable bytecode output (PYTHONDONTWRITEBYTECODE=1). They use synthetic inputs/tracked fixtures, no target or network. After focused passes, run the whole db-test-rebuild.test.ts once to cover direct-caller and final-validation integration, then a nonincremental TypeScript check and lint on changed TypeScript files. No build/full application suite is justified for this runner-only change unless new failures show otherwise. Exact execution authority, environment and commands must be confirmed in that later scope; this document grants none.

Offline loader --validate-only can subsequently prove configured manifests/raw bytes under separate stage-execution authority. Both loaders return before substantive reconciliation, so that exit 0 is **only artifact preflight**. Height --dry-run accesses a database; it is not source-only. Do not repeat the completed candidate reconciliation or supplement-overlap measurement merely to test argument wiring.

### Canonical database/evidence verification — separate authority required

Before any such execution, agree exact successor inputs/implementation, isolated target lifecycle, allowed stages, report outputs and stop rules. Use a fresh disposable Linux/PostgreSQL test target with proven identity/ownership, loopback isolation, no production/application writers, bound inputs and retained evidence. Existing canonical databases are not an alternative. This is a future narrowly scoped height/corroboration/coach validation, not an authorisation to rerun completed acquisition, full rehearsal or D7.

Reuse a retained canonical export only if its exact successor identity/fact state and provenance can be demonstrated; otherwise a separately authorised construction is needed. The completed core rehearsal alone supplies no per-player height map. Measure and retain:

- Exact successor external identities with source/method/status/player links, both approved continuity paths and input/import lineage; actual target height/evidence state. Distinguish a clean post-core target from an already enriched target.
- Height no-canonical rows, per-canonical-player assertions/occurrences, planned fills, agreements, internal and existing conflicts. Retain each rejection and prove the four Collingwood rows and all other unmatched/name_mismatch rows contribute no selected identity or height evidence through this register path.
- On separately authorised disposable writes: evidence provenance/batch lineage, NULL-only fills, correct evidence links, retained conflicting heights and conflict issues. Measure the three height invariants on the intended final stage state; dry-run planned fills do not prove persisted linkage.
- Exact pinned API roster/Wikipedia inputs, successor resolution, evidence-only behavior and distinct canonical evidence-player counts. The current Wikipedia final expectation derives from artifact rows; prove complete resolution and distinctness for the successor rather than assuming source row count equals canonical players. Stop on collisions/unresolved rows; do not relax that check.
- Coach strings/group gaps and exact frozen index/page resolution under existing corrections; canonical profile/match/club links, assignments and all eight final invariants. The predecessor overlap's identical Coach values do not prove full successor compatibility.

No expected counters are invented here. Measurement outputs must be reviewed before any later contract edit records expectations. If a binding-required runner cannot run with unmeasured fields, do not seed guessed values or add a bypass: first obtain the separately authorised loader/report evidence on the disposable target, then review bindings. Any subsequent pinning and gated reproduction requires its own concrete approval. Do not make the same run's observed values its automatically accepted expectations.

## 7. Unresolved decisions and approval boundary

The next decision is whether to authorise **only the three-file implementation/test scope in §5**, with the explicit baseline label and intentional shared coaches policy in §3. That approval would still exclude installing a baseline_only contract, changing accepted inputs/references, stage execution or database access. Source-only test execution needs explicit authority under AGENTS.md and a reviewed isolation setup.

Still unresolved: final configuration-field spelling; approval of intentionally shared height/coach stats mode versus a separate future coach model; actual successor register capture metadata; canonical/evidence/coach measurements and their applicability; exact candidate bindings and owner field/availability decisions. The recommendation above fixes the proposed behavior so approval can be concrete; these are not accepted decisions. A request for independent coach stats inputs or identity/blank-policy changes exceeds this scope.

The goal-history question remains separate: further independent historical evidence and fresh exact-profile access would be needed to adjudicate either goal value or Victor's blank meaning, subject to retained cache/access limitations and incomplete predecessor hash verification. Such browsing is not required to preserve the present refusals during candidate assessment, and is not authorised by this proposal.

All successor and production applicability decisions remain pending. ET applicability remains unresolved. All three 2026 Brownlow keys — **brownlow_match_votes, brownlow_round_votes, brownlow_season_total** — remain pending, with canonical suppression/publication restrictions unchanged. Preserve AFL API authority, eligibility and ownership restrictions. **1,640 remains rehearsal-only.** No freeze/recovery, census, rollover, release or deployment decision follows.

## 8. Files and validation of this proposal

Created this document after verifying its absence. Updated only the current ISSUE-316 links/next actions in IssuesIndex.md, issues.md, issues/open/AFLDB-ISSUE-316.md and docs/v2/issue316-c2-preparation-2026-10-21.md. Earlier reviews and evidence remain intact. Open Issues/index membership unchanged; ISSUE-316 stays OPEN. No CHANGELOG entry for proposal-only tracking. Unrelated changes and .codex/ untouched.

Validation here: native source/document inspection, the three implementation-source LF hash comparisons above, proposal/tracking readback and link existence checks. No tests, loaders, stages, shell/Git commands, network, host/database access, WSL, installation, acquisition, census, rehearsal rerun, cleanup, commit, push or deployment. No implementation, accepted bindings or contract/reference edits. Stop.
