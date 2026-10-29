# ISSUE-316 C2 successor height and dependent-stage applicability — 2026-10-21

> **Retention review (2026-10-22, evidence-retention session).** File content before this note had SHA-256 prefix `905d1d2596cb38b0` (matches the rehearsal closure). Cited retained-artefact hashes were re-checked; historical text below is preserved unmodified. The "unchanged runner unsupported" and PENDING conclusions below describe the runner at `4a2eea89`. The isolated rehearsal at `5643f5c2` ran supplement-free (baseline_only, `supplements: []`) and passed ([closure](issue316-c2-rehearsal-closure-2026-10-22.md)); N5 proposes that binding for a successor. Production applicability is still not established. See the [rehearsal closure](issue316-c2-rehearsal-closure-2026-10-22.md#8-retention-review-and-dependency-lock-findings-2026-10-22).

**Review complete; successor stage applicability PENDING / unchanged runner unsupported. Production NO-GO.** The candidate supplies the register and the formerly missing 2026 season. Retained evidence does not establish successor height mappings, canonical fills or evidence invariants. The predecessor supplement is redundant as coverage and incompatible with additive height aggregation alongside this candidate. No owner acceptance is recorded.

## 1. Scope, provenance and stop boundary

One agent. Read AGENTS.md and relevant field worksheet, successor decision, quarter and linkage §11 evidence. Implementation basis: **4a2eea89cccc465f2f017fb06ad55a7d4cb7733d**. Reuse linkage §11's completed commit/archive/bundle/inventory reconciliation, approved corrections and continuity, quarter findings and D7. None was rerun. Graph tools were unavailable; exact retained source paths/ranges supplied code evidence.

R = C:/tmp/afldb-c2-brownlow-fix-20261021/; S = R/REHEARSAL-ONLY-source/. Source citations below refer to verified S bytes, not an assumed current working-tree implementation. Native Node filesystem/crypto and an in-memory CSV parser were used. No retained Python/TypeScript module was executed or imported; no enrichment/import/rebuild stage or write logic was reproduced. CSV analysis measured raw shape and overlap, without simulating fills.

**Stop boundary reached:** the runner requires a nonempty supplement list, while its pinned supplement duplicates candidate inputs. A supplement-free successor requires a separately authorised implementation/contract decision. Stop without fixing pins, manufacturing measurements, adding identity rules or relaxing gates. No consumed hash drift or unexplained discrepancy was found in the checks performed. Unmeasured source/canonical reconciliation remains unresolved, not a PASS.

## 2. Recorded bindings and newly measured observations

The source inventory's recorded hash is retained in run-config and linkage §11.1, whose bundle/commit verification is reused. Run-config matches its existing R/SHA256SUMS entry. Inventory entries are **previously recorded bindings**; matching hashes below are **new observations**, not accepted successor bindings. No Git/current-HEAD, archive or full-tree verification was repeated.

Run-config was initially opened to locate the inventory, then hash-checked before relying on that locator. R/SHA256SUMS remains an existing inventory, not a newly independent anchor. Repository operating/review/tracking documents supply navigation and authority history, not raw-data acceptance bindings.

| Consumed artifact | Newly measured SHA-256, equal to recorded value | Existing binding |
|---|---|---|
| S/SOURCE_SHA256SUMS.json | b4a407b38d9f88f27631c51b5ba72d36ca0585f514cfc3d9badd31923055bdfc | retained run-config; linkage §11.1 |
| R/run-config.json | 547be7ce9260a764abcb6b615fde2f240d56ed2a50e89830de62c220da370531 | R/SHA256SUMS.txt |
| S/tools/migration/enrich_heights.py | 647bb383eb661f0ab0b0d6cac2dafe495b27a3f7361c7ea3ffafd50a51a6bcf0 | SOURCE_SHA256SUMS.json |
| S/tools/db/rebuild-test.ts | 5903e5115b6a6110963de6c7b8312b276b81869b5ea236df55a9d23676b51419 | SOURCE_SHA256SUMS.json |
| S/tools/rebuild/fitzroy/fitzroy-contract.json | a0c01bc285b98c902d2a64b37ded687d2ac552cb71edc5bf9cc6459a7053cfb8 | SOURCE_SHA256SUMS.json |
| S/tools/migration/enrich_heights_afl_api.py | a562077234a964afd42133795d6e143e22638010ac8e6787a2d8d4f26fb4a87f | SOURCE_SHA256SUMS.json |
| S/tools/migration/enrich_heights_wikipedia.py | 73c898bc246267575575f65b4a70670358c8ced87f4210fd6b16de06e94ff86c | SOURCE_SHA256SUMS.json |
| S/tools/migration/import_fitzroy_core.py | 4786d336349170bce6b210fceeb6f72de79d8eebc1471b79e25a8f9e18e75cc5 | SOURCE_SHA256SUMS.json |
| S/tools/migration/import_match_coaches.py | 606399b5dc283b5776f2e0780925a3277288605aad3c78ac9fe3ca460991674d | SOURCE_SHA256SUMS.json |
| S/src/db/migrations/086_player_height_evidence.sql | c2905d005fd6ad052ec86ebd5a0d7de028b3f41ffa5074e31d06b50a01bf45f6 | SOURCE_SHA256SUMS.json |
| S/docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-core-v1.json | 02bbcf932ef71d411c5d5077ae85000ebdbc0896323cf3f57c0e9fa417cf9988 | SOURCE_SHA256SUMS.json |
| S/docs/rebuild-manifests/afltables_fitzroy_core/issue129-t7-20260903.json | 9dfb2efa74a8cf62cbc6719c91cf0655301d50f43b65505891170cfbfd7c3984 | SOURCE_SHA256SUMS.json |
| S/data/sources/afltables/fitzroy_core/c2-2026-final-core-v1/player_details.csv | 03f790eeeca85426b7866e2b034c600091a4061177eb4c0e572667cea91f133f | core manifest |
| S/data/sources/afltables/fitzroy_core/c2-2026-final-core-v1/player_stats_2026.csv | 79db69732ea1018b577e548622e6c702c1a79270478cc019dc80571fc217898f | core manifest |
| repository/data/sources/afltables/fitzroy_core/issue129-t7-20260903/player_stats_2026.csv | 90cb5864c5c978c1b3a6302392d44e0c31672fe68586b7867defd1edbcc44d45 | hash-bound predecessor supplement manifest |

Candidate contract/manifest/details/stats also match explicit decision-package/worksheet hashes. The supplement manifest also equals the contract pin; its raw stats match the manifest entry. Supplement raw bytes were read from the repository's retained gitignored acquisition path; placement does not create a binding. Supplement results were neither needed nor consumed. Other 129 candidate stats files, API roster bytes, Wikipedia data and coach-page artifacts were not consumed or newly verified. This is not full-input revalidation.

## 3. Actual height input and identity requirements

Evidence: S/tools/migration/enrich_heights.py:95–255,263–287,345–442; URL normalisation in import_fitzroy_core.py:286–296.

1. The base label supplies exactly one manifest-verified player_details file and manifest-verified player_stats files. Supplements append their stats files without overlap detection or deduplication (345–357). Results, ladder witness and derived career summaries are not height identity inputs.
2. Register join fields: Team, Games, Goals, Seasons and Player. HT supplies height; # supplies informational jumper corroboration; Cap supplies Team/Cap rejection-record identity. WT, Debut, Last and date_accessed are not join evidence. The register has no stable ID or DOB.
3. Stats aggregate by raw stripped URL and register club, counting **every row** as a game, summing Goals and collecting the season set. Names come from First.name + Surname and Player. Missing URL or unknown register club refuses. Height-local aliases are Footscray→Western Bulldogs, Kangaroos→North Melbourne, South Melbourne→Sydney and Greater Western Sydney→GWS. They are distinct from core ClubResolver policy; no alias was added.
4. The actual predicate is exact club/games/goals/season-set agreement, then **exactly one name-matching candidate** after NFKD/ASCII/lowercase/punctuation normalisation. Several fact candidates can still yield one mapping if only one name matches; this is more precise than the introductory unique-fact prose. Zero candidates yields unmatched; fact candidates without a matching name yield name_mismatch; multiple named candidates yield ambiguous. Names alone never bridge to canonical identity. Jumper disagreement does not select identity.
5. HT accepts integer cm text only, 120–230 inclusive (137–143). Blank, imperial/other syntax or implausible values yield no parsed height. Worksheet observations of 15,888 populated HT cells / 843 empties are **raw-cell counts**, not parsed heights, mapped rows, URLs or canonical players. They were not converted to fills here. Existing parse_int treats blank Games/Goals as zero (146–148); this is implementation behaviour, not acceptance of the meaning of 4,437 empty register Goals cells.
6. Source-mapped URLs are normalised to players/...html paths and looked up in afltables external_identities with match_method afltables_profile_url, status unique/resolved and nonnull player_id (391–417). This needs the specific rebuilt target's identity map. Repeated club rows and multiple URLs can reach one canonical player; distinct asserted heights must then be considered together.

The height reader consumes raw CSVs directly. It does **not** call core iter_player_stats corrections or apply_profile_continuity. Core continuity folds approved renumberings and registers both paths (import_fitzroy_core.py:1774–1850), but height source aggregates stay separated by raw URL. Reuse approved Jim Stewart drops, display-only fallback, continuity 52/31/42/25 and Billy Wilson remaining separate. Core identity PASS does not prove height reconciliation. Exact register exceptions associated with those boundaries remain unmeasured; no repair or inferred merging is authorised.

## 4. New bounded observations and supplement verdict

A character-state CSV parser handled quoted commas, doubled quotes, quoted embedded newlines and CRLF/LF; malformed quotes, trailing characters after closing quotes, duplicate headers and unequal widths refuse. Quoted-comma/escaped-quote and embedded-newline/empty-cell probes returned expected cells. Cell text was preserved without numeric coercion. All headers/order and row counts matched verified manifests.

| Input | Parsed shape | Supported relationship |
|---|---|---|
| Candidate player_details | 16,731 × 15 | Register physically supplied; parsed-height domain and source join not newly measured |
| Candidate player_stats_2026 | 10,028 × 81 | Candidate supplies 2026; manifest lists 130 stats files for 1897–2026; other 129 not reparsed |
| Predecessor supplement player_stats_2026 | 9,614 × 81 | Old 2026 slice, not an additional missing season |

Exact raw comparison key: (Season, Date, oriented Home.team, Away.team, Playing.for, url). All 10,028 candidate and all 9,614 supplement keys are unique within each file. **9,614/9,614 supplement keys occur in the candidate; zero missing.** For every pair, Goals, Season, Playing.for, First.name, Surname, Player, url, Jumper.No. and Coach are lexically identical: **zero differences**. These include all height aggregation fields plus identity context and coach value. No full-row equality or independent football authority is claimed.

- **Not required for 2026 coverage:** the supplement contributes no new key.
- **Redundant as coverage; incompatible as additive height input:** passing it alongside this candidate counts 9,614 appearances a second time and sums their goals again. A season set does not remove duplicate games. This is a supported input consequence, not an observed stage failure or a count of affected register mappings.
- **Baseline-only remains conditional:** it avoids this duplication but does not prove full-career reconciliation, valid HT coverage, canonical mappings or conflict freedom. The predecessor 14,400/675/16,713 mapping counters and 12,487-of-13,273 fill result are not successor measurements and are not inherited.

## 5. Evidence and dependent stages

Evidence: enrich_heights.py:403–442,444–481,490–558; src/db/migrations/086_player_height_evidence.sql:27–69.

Canonical height assertions need a canonical player, afltables source, normalised profile path, plausible height, evidence type afltables_player_details_register, sourced confidence, occurrences and import-batch lineage. Distinct heights remain evidence. Multiple heights for one canonical player prevent fill and open a height_conflict; an existing differing height is retained with a conflict. Only NULL heights may be filled, linked to justifying evidence. Unmapped/no-canonical rows are rejection evidence. Fills, agreements, internal conflicts, existing conflicts and evidence linkage are separate target-dependent outcomes.

| Stage / validation | Supported relationship and remaining applicability gap |
|---|---|
| Core → heights | Runner 1326–1337: follows fitzroy, using its players/external identities. Sources and evidence migrations must exist. No later derived summary supplies height identity. |
| Height precheck and wiring | Runner 2819–2835,2991–3080: heightEnrichmentPins requires a **nonempty** supplement list and measured integers, proves supplement manifest pins, then passes every pin to heights. Empty supplements refuse. Loader validate-only returns at 362–364 **before reconciliation**, so hash PASS establishes no mapping. Loader dry-run accesses a database; it is not an offline substitute. Neither mode ran. |
| heights-afl-api | Runner 1340–1350; loader 187–229,318–344: separately pinned roster; canonical name + club-season, then surname + club-season + jumper fallback; ambiguous candidates fail closed. Reads core player-match/club-organisation facts and canonical height. Evidence only, never fills height. Successor identity/fact changes can affect coverage. Roster bytes/contract not revalidated; old counts not inherited. |
| heights-wikipedia | Runner 1353–1362; loader 60–86,119–142: separately tracked revision-bearing transcription keyed by AFL Tables profile; any unresolved row refuses the whole run. Evidence only; reads height for agreement. Successor profile resolution and distinct canonical evidence-player counts remain necessary; data not revalidated. |
| Coaches — shared supplement pin | Runner 3316–3325 passes **the same heightEnrichmentPins supplements** to coachesImportArgv. import_match_coaches.py:146–159,166–205,299–334 reads those stats, folds one Coach string per canonical match/club, requires exact frozen coach-index resolution and target match/profile links. The 9,614 duplicate rows have identical Coach strings and add no assignment key. This set-folding differs from height game counting; it does not prove all successor coach strings/pages resolve. Removing a height supplement also affects coaches inputs. |
| Final fingerprints | Runner 2251–2253,3127–3146 checks players_with_height, height_without_evidence, height_conflicts_open, distinct AFL API evidence players and distinct Wikipedia evidence players. No successor expected values established. Coaches has separate pin/count applicability. Old expected values cannot be retained or replaced as fresh measurements without evidence. |
| Height consumers | Migration 086 records Grid Solver height criteria reading players.height_cm. Consumer behaviour depends on canonical outcomes. This review traced loader/runner edges, not every application caller; no exhaustive graph or consumer regression claim. |

Birth dates is separately pinned and uses core profile identities (runner 1366–1370); it does not consume register HT or the height supplement through this path. Ordering alone does not establish a height dependency. Completed full-derived/D7 findings remain reusable but do not validate unexecuted height, corroboration, coach stages or their final gates.

## 6. Exact missing evidence and smallest next proposal

The smallest next **validation proposal**, separately authorised, is a **baseline-only read-only source reconciliation worksheet**. Verify the 130 candidate stats files and details actually consumed against the bound manifest/inventory; parse proper CSV using existing source predicates. Measure mapped/unmatched/ambiguous/name_mismatch rows, exact Team/Cap exceptions and candidate URLs, HT valid/empty/invalid, URL-height conflicts and jumper corroboration. Keep raw URL aggregation distinct from approved core continuity. Stop on unexplained discrepancy; no added aliases, continuity inside height aggregation, empty-Goals policy change, stage execution, target access, write logic or accepted bindings. Do not repeat supplement overlap, provenance, linkage, quarters or D7.

After that source-only worksheet, stage-success evidence still requires:

1. The exact intended successor canonical identity map, with source/method/status and both approved continuity paths, tied to implementation/input/import evidence. Aggregate rehearsal output cannot derive no-canonical rows, canonical assertions or conflicts. Review retained exact output if available under bounded authority; otherwise stop for separate target/evidence authority, never fabricate a map.
2. That target's current height/evidence state; target-specific fills/agreements/internal/existing conflicts; rejection evidence; evidence linkage; and the three canonical invariant counts. Clean rebuild and populated-target outcomes are not interchangeable. No database/host access is authorised here.
3. Exact pinned API/Wikipedia artifacts, successor identity resolution and distinct canonical evidence-player counts, preserving corroboration roles. For coaches: candidate Coach group repetition/blank coverage, exact frozen-index/page resolution, corrections/continuity, canonical match links, assignments and final-count applicability. The overlap comparison supplies none of those full-stage proofs.
4. A separately reviewed implementation/contract proposal supporting no overlapping supplement, explicitly addressing the **nonempty-list refusal and coaches' shared dependency**, actual register capture metadata and newly evidenced expectations. This needs source/contract decision authority. No dummy supplement, silent deduplication, relaxed threshold or inherited counter is proposed.

Any need for external evidence/new policy is a stop requiring separate authority. All S1/S2 field/availability decisions, stage applicability and successor bindings remain pending. ET applicability remains unresolved. **All three 2026 Brownlow keys — brownlow_match_votes, brownlow_round_votes and brownlow_season_total — remain pending**, with canonical suppression/publication restrictions unchanged. Preserve AFL API authority, eligibility and ownership restrictions. **1,640 is rehearsal-only**, not production acceptance; no active-reference change, rollover date or census is granted.

## 7. Changes and validation

Created this review exclusively; narrowly updated current links/next actions in IssuesIndex.md, issues.md, issues/open/AFLDB-ISSUE-316.md and docs/v2/issue316-c2-preparation-2026-10-21.md. No CHANGELOG entry: investigation-only. ISSUE-316 remains OPEN; index/open-table membership is unchanged. Unrelated changes and .codex/ were untouched.

Validation: matching recorded hashes, parser probes, manifest shapes, exhaustive bounded overlap comparison and document readback. No tests/build, shell/Git, network, host/database, WSL, installation, acquisition, census, enrichment/import/rebuild/gates, rehearsal rerun, source/policy changes, accepted bindings, active-reference changes, cleanup, commit/push or deployment. Stop.
