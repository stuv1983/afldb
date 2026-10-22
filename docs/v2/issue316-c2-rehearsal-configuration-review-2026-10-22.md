# ISSUE-316 rehearsal-only candidate configuration — 2026-10-22

> **Retention review (2026-10-22, evidence-retention session).** File content before this note had SHA-256 prefix `2e183a651bdcd70a` (matches the rehearsal closure). Cited retained-artefact hashes were re-checked; historical text below is preserved unmodified. The "Full runner configuration BLOCKED … No rehearsal started" headline is history: the configuration was completed and the isolated rehearsal ran and passed at `5643f5c2` ([closure](issue316-c2-rehearsal-closure-2026-10-22.md)). The packaged rehearsal overlay derived from it is not an installable configuration (see closure §8 and the consolidated proposal). See the [rehearsal closure](issue316-c2-rehearsal-closure-2026-10-22.md#8-retention-review-and-dependency-lock-findings-2026-10-22).

**Preparation complete for the frozen height/coach configuration. Full runner configuration BLOCKED. ISSUE-316 OPEN; production NO-GO. No rehearsal started.**

One agent. Owner-authorised native filesystem/Git inspection, copying, hashing and static configuration validation only. Read AGENTS.md and the sequential measurement review. Graph tools unavailable; bounded exact-source inspection, no graph completeness claim. The sandbox denied the initial C: directory creation; the approved escalation ran a native Node filesystem preparation program with only read-only local Git children. No application module, runner (including --plan), loader, test suite, database, host, network, installation, acquisition, census, WSL or deployment ran. No Git mutation or cleanup.

## Isolated paths and implementation

Root: **C:/tmp/afldb-c2-REHEARSAL-ONLY-config-b8ea2855-20261022/**. Source: **C:/tmp/afldb-c2-REHEARSAL-ONLY-config-b8ea2855-20261022/source/**. REHEARSAL-ONLY.txt labels containment; source has no .git, .env, node_modules or copied .codex directory. Implementation **b8ea28550a291b766bf7ad9f3b63621e9f9efa81**: all 2,290 Git blobs read from that commit and SHA-1 checked; original SHA-256s recorded in EXACT_COMMIT_SOURCE.json. After the four configuration overrides, all **2,286 other source files** were rehashed equal to the pinned blobs. Runner SHA-256 **bfdc250c901bbe0a79d21791e33a5c799b36f179eb055117d14817485037b407** unchanged. No executable source edit.

Actual runner paths below are relative to source/. Full exact textual diff against exact-commit files: **configuration.diff**, SHA-256 **5bc5ec338e042a142a60e8a66631e4e965306ea4682adf0c6a39aa5077743c0e**. original-configs/ and proposed-configs/ contain the byte pairs. Acquired additions are listed separately in CONSUMED_INPUTS.json; no acquired bytes/manifests are edited. Retained prior test contract/register are saved unchanged as *.original.json; they are provenance, not new authority.

| Isolated proposed file | SHA-256 |
|---|---|
| tools/rebuild/fitzroy/fitzroy-contract.json | 7655aba3405229e4819951e5ae562a96ef376ae3f9760e03bb6537626d399a5f |
| tools/rebuild/afl_api/afl-api-contract.json | c0ee3191696f6345e10900d67401f57a07238f0040a859835f2b27c944df3524 |
| tools/rebuild/afltables/afltables-contract.json | b5b26ab838c01db8fdb59bfe027b00d64fecc8c2a23b6273364e9e32a4b45695 |
| data/reference/fitzroy-accepted-baselines.json | ccc364c5f3f7b1d5b3c6f8db1db5b1f574c173a2181ffb6ef671d3e28f104b33 |

The candidate register preserves historical entries and disables predecessor selection with rehearsal_not_selected solely inside this copy; no retirement date or supersession is fabricated. Exactly one candidate entry is accepted only because the genuine selector requires that literal. It conveys no canonical successor acceptance, and carries no invented accepted_on, validator verdict or rollover date. Exact retained core fingerprints/identity scan remain labelled as retained candidate evidence; the thirteen measurements do not approve other stages. The required range contains only 1897/2026; inherited UNSET date and fictional 2027 rollover wording were removed. Unchanged seasons.json still conflicts with treating 2026 as within completed rebuild/census scope; this is recorded as a blocker.

## Thirteen existing expectation locations

| Runner key | Value | Actual existing field or mechanism |
|---|---:|---|
| players_with_height | 12579 | tools/rebuild/fitzroy/fitzroy-contract.json#/datasets/player_details/height_enrichment/measured/players_with_height |
| height_without_evidence | 0 | tools/rebuild/fitzroy/fitzroy-contract.json#/datasets/player_details/height_enrichment/measured/height_without_evidence |
| height_conflicts_open | 0 | tools/rebuild/fitzroy/fitzroy-contract.json#/datasets/player_details/height_enrichment/measured/height_conflicts_open |
| players_with_afl_api_height_evidence | 1916 | tools/rebuild/afl_api/afl-api-contract.json#/roster/accepted_snapshot/measured/players_with_afl_api_evidence |
| players_with_wikipedia_height_evidence | 84 | data/players/height-evidence-wikipedia.csv; wikipediaHeightRows() (runner:3148) |
| coaches | 386 | tools/rebuild/afltables/afltables-contract.json#/coaches/accepted_snapshot/measured/coaches |
| coaches_linked_to_players | 368 | tools/rebuild/afltables/afltables-contract.json#/coaches/accepted_snapshot/measured/coaches_linked_to_players |
| coaches_unlinked | 18 | tools/rebuild/afltables/afltables-contract.json#/coaches/accepted_snapshot/measured/coaches_unlinked |
| match_coaches | 32470 | tools/rebuild/afltables/afltables-contract.json#/coaches/accepted_snapshot/measured/match_coaches |
| matches_with_both_coaches | 16035 | tools/rebuild/afltables/afltables-contract.json#/coaches/accepted_snapshot/measured/matches_with_both_coaches |
| matches_with_one_coach | 400 | tools/rebuild/afltables/afltables-contract.json#/coaches/accepted_snapshot/measured/matches_with_one_coach |
| matches_without_coach | 621 | tools/rebuild/afltables/afltables-contract.json#/coaches/accepted_snapshot/measured/matches_without_coach |
| coaches_linked_outside_unique | 0 | existing hard-coded coachChecks invariant (runner:3393) |

The matching baseline_snapshot_label is c2-2026-final-core-v1; explicit stats_input_mode=baseline_only and supplements=[] apply jointly to heights and coaches. Wikipedia's 84 remains row-derived in the existing model; no invented configuration key. REHEARSAL_BINDINGS.json independently pins the exact CSV content for a future external hash guard, which is not part of the runner. coaches_linked_outside_unique=0 remains the hard-coded invariant. These expectations are conditional on unchanged implementation, canonical input state and fingerprints; the full intervening stage chain has not been measured.

## Immutable sources, manifests and capture metadata

All 162 original planning bindings (280,130,385 bytes) were checked, copied or matched to exact Git bytes, with the original rehearsal contract preserved separately. Added the unchanged retained witness manifest and 130 files, making 293 consumed binding records including implementation/configuration provenance. The 132 core, 130 witness and 15 roster artifact hashes match their exact manifests. Both 386-row parsed coach files match hashes/schema/row counts; all 386 page raw_sha256 references match manifest entries; raw/ is absent. The original consumed artifacts remain unchanged. This is hash integrity, not publisher authentication or absent-raw verification.

| Source | Exact binding / capture |
|---|---|
| Core c2-2026-final-core-v1 | manifest 02bbcf932ef71d411c5d5077ae85000ebdbc0896323cf3f57c0e9fa417cf9988; 132 files, 729288 raw rows; set digest 817d594e5c0529b6524c8b211a209b9ef25a500c5c463daad8e3bb7b1eee7b7e; captured 2026-10-21T04:34:37Z |
| player_details.csv | 03f790eeeca85426b7866e2b034c600091a4061177eb4c0e572667cea91f133f; all date_accessed cells 2026-10-21; height register capture metadata updated accordingly |
| Ladder c2-2026-final-ladder-v1 | manifest 65c299072afb35f1b0ddce50c9c72728e03bcd1580d676ca63eaaafb86047c34; 130 files, 1640 rows, 1897–2026; original manifest capture metadata preserved |
| Roster rosters-20260905 | manifest 61aff99a8b14e08823821b23e68817c30604dabf33399b437ad3bf7fbe6369a7; 15 seasons 2012–2026; capture 2026-09-04T22:07:51Z; completeness unvalidated; successor applicability unproven |
| Coach coaches-20260905 | manifest 3e78f47354ac9fe594547ad327efaa6a2f6da90c54b17072ade4443e74ba8094; capture 2026-09-05T06:26:31Z–06:36:13Z; parsed hashes 525ae8876786a2bb006f8be91fc29f860e12e765eb12316c5f9da9ed6ef142ef / ec4959a40fc56a6ff6e15b6a91a4bd81cc75326c507440cf98b4ed60f853113b; successor applicability unproven |
| Wikipedia | data/players/height-evidence-wikipedia.csv; 19594 bytes; 3d809e60afe996b8d939ae6348d26386ccc2b844954bfcef0ae7d9ada115a13b; 84 unique profile rows; row revision/timestamp metadata unchanged; selected against predecessor; successor applicability unproven |

Recomputed evidence inventory/binding fingerprints match the review:
- C:/tmp/afldb-c2-sequential-measurement-20261022/SHA256SUMS.txt: dc6577bf34cca6b665517105ba9dc6ddfad1ca638a613bdc217192dde49675c6
- C:/tmp/afldb-c2-loader-planning-20261022/SHA256SUMS.txt: 313752b19cebe7c9c13ac84a9d00973bd78aff8cb67197c1749534aace1ff343
- C:/tmp/afldb-c2-canonical-export-20261022/SHA256SUMS.txt: 27583f98dbd55ca0c733db332df87be84f5ede812c5c77d6fcbbba932e8dbc7e
- C:/tmp/afldb-c2-loader-planning-20261022/INPUT_BINDINGS.json: 542932f2411b00fbe234ac105f5e910fa82c40030a30bd48dec6df3bd93446f9

The earlier canonical database was built under 4a2eea89cccc465f2f017fb06ad55a7d4cb7733d. No new core database or exact-b8ea2855 runner result is implied. Retained fingerprints cover 106 ordinary tables plus players#height_columns (107 entries); they are snapshot content checks, not a write audit. Detailed evidence predicates/limits remain in the sequential review.

## Correction and protection scope

Both test contract and successor register explicitly contain all three club rules: unscoped Brisbane Lions 1987–1996 → Brisbane Bears; results-only North Melbourne 1999–2007 → Kangaroos; **separately ladder-only North Melbourne 1999–2007 → Kangaroos**. No aliases added. Both exact one-row Jim Stewart drops and their fingerprints are preserved. Four profile continuity rules bind 52/31/42/25 rows through 2026; display fallback remains four-profile/display-only; Billy Wilson remains separate. No rejected height row or provider identity is promoted.

Preserve 18 register rejections including Collingwood Caps 162/182/615/649, all 479 API refusals, informational jumpers, unresolved ET, all eligibility/ownership restrictions. Zero open height_conflict records means that predicate only; 737 API / 24 Wikipedia disagreements remain unresolved. All ten coach discrepancies and missing raw remain release decisions, without inferred finals omission, Carter exclusivity or Adamson attribution. P4 +89 deletes remains unattributed.

stat-availability.json is unchanged (e2900084ebd7e9505239b82aef8f8665fcf7939e7b84b94b13e110fa6cfcc2b8): all three 2026 Brownlow keys pending. Existing source authority, canonical suppression and publication/eligibility rules remain. 1640 is rehearsal-only, not a production expectation. No source authority, date, ownership or public availability decision added.

## Every required stage — static input/gate review

All 30 stages are retained in order. Every result below is static configuration evidence or a blocker, not executed gate success. Exact stage and final-check definitions are in the unchanged tools/db/rebuild-test.ts:1238–1640, :1657–2430, :2720–2958 and :2962–3742.

| # | Required stage | Configuration/gate state |
|---:|---|---|
| 1 | precheck | BLOCKED: mandatory acquired birth-date/DraftGuru/first-kick-goal files absent; Python/dependencies and external capture root unbound. No --validate-only invoked. |
| 2 | afl-api-ownership-census | BLOCKED: no target/census authority. Proposed full-history range includes 2026, but unchanged seasons.json and contract exclusion omit it from census. No ownership replay/waiver. |
| 3 | afl-api-adjudications-capture | BLOCKED: exact isolated target, owner credential, fresh capture directory/ledger/manual-registration state and lifecycle not supplied; no empty capture invented. |
| 4 | recreate | BLOCKED: no target or destruction authority; no existing database may be used. |
| 5 | migrations | UNEXECUTED: full pinned migration set copied; isolated target, Node/tsx/psql and supported Linux runtime not bound. |
| 6 | privileges | UNEXECUTED: pinned role registries/scripts copied; owner/import roles and ACL target unbound. |
| 7 | reference | UNEXECUTED: tracked reference files copied unchanged. seasons.json marks 2026 in progress; no fictional 2027/date supplied. |
| 8 | fitzroy | CONFIGURATION BINDINGS CHECKED: 132 unchanged files, manifest/digest/counts/range/versions and exact correction/continuity scopes installed in test register. Three genuine candidate validator gates NOT RUN at this commit; retained core fingerprint is evidence, not approval inferred from heights/coaches. |
| 9 | heights | CONFIGURATION COMPLETE for frozen inputs: baseline_only, matching label, supplements [], 12579/0/0. Needs exact fresh clean post-core state; all 18 refusals preserved. |
| 10 | heights-afl-api | CONFIGURATION COMPLETE for frozen 15-file roster, 1916 evidence players. Manifest provePin-equivalent hash checked. 479 providers rejected; successor applicability unproven. |
| 11 | heights-wikipedia | CONDITIONAL CONFIGURATION COMPLETE: unchanged CSV hash and 84 rows/distinct profiles checked; runner derives 84 from rows, not an independent integer/hash setting. External pre/post content-hash enforcement still needs review for a future runner harness. |
| 12 | birth-dates | BLOCKED: 21 parsed CSV + 21 raw HTML missing from this isolated copy; both required by loader. Existing five measured pins 13255/0/13255/0/2 describe predecessor and are not established for successor. No replacements guessed. |
| 13 | coaches | CONFIGURATION COMPLETE for exact parsed-only exploratory input: family/version, two 386-row files and 386 raw-hash references checked; raw/ absent, loader permits complete absence. Existing 0 invariant kept; seven configurable integers installed. Historical attribution and raw provenance unresolved. |
| 14 | father-son | UNEXECUTED: tracked selections/adjudications/provenance copied. Existing artifact-derived row/link/relationship gates retained; canonical successor identity resolution has not run. |
| 15 | siblings | UNEXECUTED: tracked pairs/adjudications/supplements/provenance copied. Artifact-derived pair/link and has_brother gates retained; no successor result inferred. |
| 16 | after-siren | UNEXECUTED: tracked events/adjudications/provenance copied. Artifact-derived counts retained; match/club/player participation resolution not demonstrated for this full chain. |
| 17 | after-siren-reconcile | UNEXECUTED: all 38 re-resolution/integrity checks remain; no database result supplied. |
| 18 | manual-registrations-reinstate | BLOCKED on target-bound capture; token, actor, path and convergence refusal rules retained. |
| 19 | manual-registrations-replay | BLOCKED on captured registration state and target; production replay implementation retained. |
| 20 | manual-registrations-verify | BLOCKED on capture/replay; exact registration re-capture gate retained. |
| 21 | draftguru | BLOCKED: default annual-html-20260826 manifest exists but all 42 raw year pages absent in this copy. Existing preflight 42/5057/6810 and explicit identity decisions retained. No bridge option chosen; no empty/default population fabricated. The separate 20260902 lost-source history is not substituted. |
| 22 | afl-api-adjudications-reinstate | BLOCKED on authentic capture and completed DraftGuru population; one-transaction replay/remapping/bijection requirements retained. |
| 23 | afl-api-adjudications-bijection | BLOCKED on preceding capture/reinstatement; importer/human identity invariant not skipped. |
| 24 | awards-honours | UNEXECUTED: eight groups all_australian/under_22/rising_star/club_bf/named_medals/hall_of_fame/honour_teams/captaincies kept. Tracked manifests copied; fixed per-family row/source gates retained. Links/source applicability not established by thirteen measurements. |
| 25 | brownlow-season | UNEXECUTED: historical manifest/CSV/identity files retained unchanged; per-file hashes, season-scoped API artifact coverage and no-overlap gates must run. 2026 remains pending/suppressed, never adopted from source presence. |
| 26 | derived | UNEXECUTED: exact pending-readiness implementation copied; earlier 4a2eea89 core/derived evidence is retained history, not a fresh b8ea2855 runner result. Check completed football versus pending Brownlow, protected snapshots and public suppression. |
| 27 | coleman | UNEXECUTED/UNPROVEN: isolated-only historical wrapper retained with cluster/name/port/marker/no-publication guards. First season 1980 plus candidate last season 2026 makes runner expect 47 rows and 47 seasons (one winner per season assumption); no candidate Coleman measurement or tie decision supplied. No guessed row pin. |
| 28 | first-kick-goal | BLOCKED: tracked source pin/334 active IDs exist; gitignored data/records/first-kick-goal.csv absent. Must supply exact accepted extract with normalized SHA256 8f234f3b76ce78c18e6d0bc7f30ef8f64ec125b4b646f4cd15577a32f0e5a036, 334 rows and exact manifest join. No source acquisition authorised. |
| 29 | ladder-witness | CONFIGURATION BINDINGS CHECKED: 130 unchanged CSVs/1640 rows, exact witness pin and ladder-only Kangaroos scope copied. Actual D7 requires fresh derived database; prior D7 is historical and locally computed witness is not independent published authority. |
| 30 | fingerprints | BLOCKED: club_seasons_rows hard-coded 1622 at runner:2380–2390 contradicts 1640 candidate. Birth-date pins remain predecessor-specific; Coleman 47 unmeasured. All other core/DraftGuru/awards/Brownlow/relationships/after-siren/first-kick gates stay intact; no runner final result exists. |

Static native validation: selector cardinality and label match; explicit empty supplement list; all 13 expectation mechanisms; core manifest SHA/file count/row sum/set digest/required versions/range/datasets; roster/coach provePin-equivalent LF hashes; coach family/version/columns/rows and raw-hash references; 84 Wikipedia unique profiles; immutable source/artifact comparisons. Full schema/semantic validators and SQL gates were deliberately not executed. VALIDATION.json records file checks and all exact missing paths. No statement that a real preflight, provePin invocation, candidate gate, final gate or Linux validation passed.

Final families retained individually: baseline measured SQL (including source-filtered players and Brownlow round rows), DraftGuru persons/picks/optional bridge, ladder row/era/duplicate/rank/merger/beyond-range, Coleman row/season/link/source/key/beyond-range, eight awards/honours family counts/definitions/source/beyond-range, historical/optional API Brownlow manifest totals/eligibility/link/coverage/overlap, height five, DOB five, coaches eight, father–son selection/link/relationship counts, sibling pair/link/has_brother, after-siren artifact counts plus 38 reconciliation checks, and first-kick exact owned-ID population. No counter outside the thirteen is replaced on the strength of the thirteen. Optional DraftGuru bridge stays unselected, with its conditional preflight/final requirements retained.

## Remaining prerequisites for any fresh exact-commit runner rehearsal

1. Resolve the implementation contradiction: b8ea2855 has fixed CLUB_SEASONS_EXPECTED.rows=1622. This candidate's measured 1640 cannot pass the unchanged full final gate. No configuration-only solution exists; an explicitly authorised, tested successor implementation would require a new exact commit. No full runner scope at b8ea2855 is proposed as executable.
2. Resolve rehearsal-only season/completed-range/ownership-census metadata consistently without inventing a rollover or changing active references. Current seasons reference remains 2026 in progress, so the census excludes a rebuilt 2026. No silent census omission or ownership change is acceptable.
3. Supply and hash-bind the existing required acquired inputs: 42 birth-date files (21 parsed + 21 raw), 42 default DraftGuru year pages, and the exact 334-row first-kick extract. Their manifests/pins remain unchanged. Presence elsewhere is not asserted; no broad search/acquisition performed. No substitute snapshot or empty extract.
4. Establish successor applicability and expected outcomes for birth dates (five predecessor pins), candidate Coleman (47-row/season assumption/ties), and all other unmeasured dependent stages and final families. Use retained evidence first; separately authorise missing evidence work. Do not invent values or count-driven approvals. The thirteen remain conditional on a reproduced clean input state and intervening stages.
5. Review exact proposed configuration hashes/diff and external Wikipedia content pin. A separately approved future harness must verify input/configuration/implementation fingerprints before/after all relevant phases and refuse drift. It must run the unchanged real preflight and every stage/final gate, without bypasses or partial-stage substitution.
6. Bind a genuinely isolated supported Linux runtime, existing dependencies/interpreters (Node/tsx/Python/psql/psycopg), exact source package/configuration inventory, fresh dedicated cluster/database/port/marker and owner/import-role DSNs without revealing credentials. No installation or target currently authorised or chosen.
7. Authorise fresh target-specific ownership census and authentic adjudication/manual-registration capture/reinstate/bijection lifecycle, external capture root, no canonical publications where the offline Coleman guard requires it, and destructive-reset scope. No fabricated empty state, stale census or production target.
8. Approve a bounded lifecycle with runtime/space limits, protected-state/public-suppression checks, evidence capture, refusal/stop criteria and unconditional shutdown/retention of only its own cluster. Prior shutdown evidence is historical, not a current host attestation.
9. Separately authorise actual execution after blockers are resolved. No runner command is offered now. Production decisions (missing coach raw, successor Wikipedia/roster/coach coverage, disagreements, coach attribution, field/availability/ET, real rollover authority/date, release readiness) remain distinct; none is waived by this configuration.

**Bounded next supported scope:** offline review of these four proposed configuration files, external bindings and blocker resolution only. A fresh complete runner rehearsal at the pinned commit is not presently supported. A later proposal must name its exact compatible implementation and all input/target/lifecycle gates; no stage skipping, weakening or guessed pins. Stop here; do not start rehearsal.

## Repository tracking

Only this ISSUE-316 record, IssuesIndex.md, the ISSUE-316 detailed ledger/Open Issues row and issues/open/AFLDB-ISSUE-316.md are updated. ISSUE-316 stays open; membership unchanged. CHANGELOG unchanged: configuration is outside the repository and this is preparation/investigation tracking, not a retained application change. Real contracts/registers/references/source data, unrelated files and .codex/ remain untouched.
