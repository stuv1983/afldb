# ISSUE-316 C2 sequential measurement — offline review — 2026-10-22

> **Retention review (2026-10-22, evidence-retention session).** File content before this note had SHA-256 prefix `7ecf4635df5b819e` (matches the rehearsal closure). Cited retained-artefact hashes were re-checked; historical text below is preserved unmodified. Measured values here (and the 12,579 height / 32,470 coach figures later reproduced in the rehearsal) are frozen rehearsal inputs and expectations only (N7, N8, N11); successor applicability is unproven and coach attribution stays unresolved. See the [rehearsal closure](issue316-c2-rehearsal-closure-2026-10-22.md#8-retention-review-and-dependency-lock-findings-2026-10-22).

**Review complete within the offline scope. ISSUE-316 remains OPEN; production NO-GO. No binding or owner choice approved.**

## 1. Scope, basis and evidence integrity

One agent. Read AGENTS.md, the relevant ISSUE-316 index/ledger/runbook checkpoints, the supplement-free proposal, the sequential prerequisite review, and the retained planning, canonical-export and sequential evidence. No shell/Git command, network, host/database connection, loader/module execution, acquisition, census, clone, import, rebuild, runner, installation, WSL, cleanup or deployment was performed. Filesystem reads, SHA-256 computations, CSV parsing, row-set comparisons and documentation writes used native in-process Node APIs. No graph tools were available; this is a bounded source/evidence review, with no graph completeness claim.

Implementation basis is **b8ea28550a291b766bf7ad9f3b63621e9f9efa81**. The local branch ref names that commit. Its commit/tree and runner blob were read and SHA-1-checked directly from Git object bytes, without invoking Git. The exact runner blob SHA-256 is **bfdc250c901bbe0a79d21791e33a5c799b36f179eb055117d14817485037b407**. All 13 git-origin files in the retained input binding also match current working-copy raw and LF bytes. Eleven of their historical object traversals encountered packed/unavailable loose objects; their origin remains supported by the hash-bound retained provenance and current byte equality, rather than a newly completed independent blob read. No whole-checkout cleanliness claim is made.

The canonical database state was built under **4a2eea89cccc465f2f017fb06ad55a7d4cb7733d**, not rebuilt under b8ea2855. The measurement uses that retained state with b8ea2855 loaders and a separate rehearsal-only fitzRoy contract. It is not a fresh exact-commit runner rehearsal.

Evidence roots used below:

- **S:** C:/tmp/afldb-c2-sequential-measurement-20261022/
- **P:** C:/tmp/afldb-c2-loader-planning-20261022/
- **C:** C:/tmp/afldb-c2-canonical-export-20261022/
- **E:** S/host-evidence/export/

Recomputed every listed file hash: **S 236/236, P 307/307, C 38/38; zero mismatches or missing listed files**. S contains those 236 files plus SHA256SUMS.txt itself. Also recomputed all **162** P/run-tree files against INPUT_BINDINGS.json, including byte lengths: **280,130,385 bytes**, zero mismatches. These checks verify retained bytes against recorded inventories; inventories are not independent publisher authentication or proof of live host state.

| Inventory/binding | Recomputed SHA-256 |
|---|---|
| S/SHA256SUMS.txt | dc6577bf34cca6b665517105ba9dc6ddfad1ca638a613bdc217192dde49675c6 |
| P/SHA256SUMS.txt | 313752b19cebe7c9c13ac84a9d00973bd78aff8cb67197c1749534aace1ff343 |
| C/SHA256SUMS.txt | 27583f98dbd55ca0c733db332df87be84f5ede812c5c77d6fcbbba932e8dbc7e |
| P/INPUT_BINDINGS.json | 542932f2411b00fbe234ac105f5e910fa82c40030a30bd48dec6df3bd93446f9 |
| Rehearsal-only fitzRoy contract | a0c01bc285b98c902d2a64b37ded687d2ac552cb71edc5bf9cc6459a7053cfb8 |
| Candidate core manifest | 02bbcf932ef71d411c5d5077ae85000ebdbc0896323cf3f57c0e9fa417cf9988 |
| Roster manifest | 61aff99a8b14e08823821b23e68817c30604dabf33399b437ad3bf7fbe6369a7 |
| Coach manifest | 3e78f47354ac9fe594547ad327efaa6a2f6da90c54b17072ade4443e74ba8094 |
| Wikipedia CSV | 3d809e60afe996b8d939ae6348d26386ccc2b844954bfcef0ae7d9ada115a13b |

The roster manifest's 15 artifact hashes match the bound artifacts. Both 386-row parsed coach files are bound; each page's recorded raw_sha256 matches its manifest entry. This verifies a hash reference, **not absent raw bytes**. All eight retained phase Wikipedia hash records agree; all four phases' pre/post tree-check outputs are empty with successful result records.

## 2. Exact query measurements and suitability for later rehearsal bindings

Read E/loaders phase stdout, result JSON, P1/P2 report JSON, state/fingerprint records, E/measure/measure.txt, the actual initial/final CSVs, and the retained SQL. Independently recounted the following from the final exports. All thirteen agree with the retained SQL results.

SQL below is the exact query definition at b8ea2855, tools/db/rebuild-test.ts:3171–3191 and :3380–3403, also used in S/host-evidence/bin/measure.sql. For the last three rows, **M** is exactly:

~~~sql
SELECT m.id, count(mc.match_id) AS n FROM matches m LEFT JOIN match_coaches mc ON mc.match_id = m.id GROUP BY m.id
~~~

“Suitable” means a **candidate expectation for a later separately approved rehearsal-only reproduction of these exact inputs/state**, subject to the listed limit and owner choices in §7. It neither installs an expectation nor accepts source truth or successor production coverage. **No row is production acceptance.**

| Key | Exact measured value | Exact SQL | Provenance / planning comparison | Limit and rehearsal-only suitability |
|---|---:|---|---|---|
| players_with_height | 12,579 | SELECT count(*) FROM players WHERE height_cm IS NOT NULL | E/final/03; P1 fills set and planning fills set equal persisted (player,height) set | Yes, conditional on same clean post-core state and inputs; planning measured intended fills, not this persisted query |
| height_without_evidence | 0 | SELECT count(*) FROM players WHERE height_cm IS NOT NULL AND height_evidence_id IS NULL | E/final/03; E/measure link_integrity | Yes, as the exact missing-link count; query alone does not prove same-player/same-height links (separately checked). First final-state measurement here |
| height_conflicts_open | 0 | SELECT count(*) FROM data_issues WHERE issue_type = 'height_conflict' AND resolved_at IS NULL | E/final/09 empty; initial file also empty | Yes, as open issue-record count only. Does not mean source agreement; first post-sequence measurement here |
| players_with_afl_api_height_evidence | 1,916 | SELECT count(DISTINCT e.player_id) FROM player_height_evidence e JOIN sources s ON s.id = e.source_id WHERE s.key = 'afl_api' | E/final/01+08; planning API players_with_evidence 1,916 and mapping set reproduce | Yes for frozen roster/resolution; 479 providers remain rejected and coverage unproven |
| players_with_wikipedia_height_evidence | 84 | SELECT count(DISTINCT e.player_id) FROM player_height_evidence e JOIN sources s ON s.id = e.source_id WHERE s.key = 'wikipedia' | E/final/01+08; CSV × exact afltables identity set equals persisted (player,height,title) set | Yes for this exact hash-bound CSV. Planning measured 84 resolved profiles; distinct persisted players first measured here |
| coaches | 386 | SELECT count(*) FROM coaches | E/final/10; planning P4 measured 386 | Yes as frozen parsed-index population; raw provenance and historical totals unresolved |
| coaches_linked_to_players | 368 | SELECT count(*) FROM coaches WHERE player_id IS NOT NULL AND link_status_value = 'unique' | E/final/10; planning P4 measured 368 | Yes as link-state count; not independent historical identity adjudication |
| coaches_unlinked | 18 | SELECT count(*) FROM coaches WHERE player_id IS NULL | E/final/10; planning P4 measured 18 | Yes, preserving coach-only identities; no guessed player links |
| coaches_linked_outside_unique | 0 | SELECT count(*) FROM coaches WHERE player_id IS NOT NULL AND link_status_value <> 'unique' | E/final/10; all 368 linked rows unique, no blank/null link status among linked rows | Yes as exact invariant. First measured final key here; planning only inferred it. SQL <> does not itself count NULL status |
| match_coaches | 32,470 | SELECT count(*) FROM match_coaches | E/final/11; planning P4 measured 32,470 | Yes as assignments produced by frozen Coach strings/policy; ten page-total discrepancies remain |
| matches_with_both_coaches | 16,035 | SELECT count(*) FROM (M) x WHERE n = 2 | E/final/04+11; planning P4 measured 16,035 | Yes as exactly two assignment rows, not independently verified two historical coaches |
| matches_with_one_coach | 400 | SELECT count(*) FROM (M) x WHERE n = 1 | E/final/04+11; planning P4 measured 400 | Yes, preserving the measured gaps; no coverage acceptance |
| matches_without_coach | 621 | SELECT count(*) FROM (M) x WHERE n = 0 | E/final/04+11; planning P4 measured 621 | Yes, preserving the measured gaps; no coverage acceptance |

Here “(M)” means substitution of the full SQL above, not a proposed SQL identifier. Independent recount also found no match with more than two assignments, no assignment club outside its fixture, no dangling coach/player link and no player linked twice. Thus 16,035 + 400 + 621 = 17,056 and 2 × 16,035 + 400 = 32,470 describe this export.

**Correction to “all equal to planning”:** seven coach planning measures genuinely have comparable persisted measures: 386/368/18/32,470/16,035/400/621. Height planning fills 12,579 and API planned evidence players 1,916 reproduce their persisted sets/counts; Wikipedia 84 resolved profiles reproduces the source resolution count, while distinctness required the later persisted check. Planning did not execute all thirteen final SQL definitions against an enriched state. Missing-link/open-issue final-state checks, coaches_linked_outside_unique, persisted batches/links/NULL-only effects, Wikipedia distinct players, source disagreements, the enumerated ten coach discrepancies and detailed unmapped-provider classifications were first measured in the sequential run. An initial empty-table zero is not a prior post-enrichment invariant measurement.

Planning API agree/differ 0/0 with 1,916 canonical NULLs, and Wikipedia agree/differ 0/84 with all canonical heights NULL, cannot be retained as substantive agreement results. Sequential measured comparisons replace those interpretations.

## 3. Persisted writes, lineage, source roles and rejected rows

Initial files 01–15 are **15/15 byte-equal** to C/data, including file 14. Initial heights/links/evidence/coaches/assignments are empty; seven prior batches exist. Read the actual phase reports and exports rather than relying on the closing summary.

| Phase | Persisted lineage and row checks | Scope of corroborating evidence |
|---|---|---|
| P1 | Batch 8, afltables, enrich_heights.py, completed; read 16,731, evidence inserted 12,579, player updates 12,579, rejected 18. All 12,579 evidence rows carry batch 8. Planning and run report fills equal the persisted set exactly | All initial canonical heights/links NULL. Every final filled player links to existing same-player/same-height batch-8 evidence; zero bad links. This verifies clean-state NULL-only filling, not a new non-NULL overwrite experiment |
| P2 | Batch 9, afl_api, completed; read 2,395, inserted 1,916, updated 0, rejected 479. Persisted external_id/player mapping equals both planning and sequential mapped_rows | Evidence-only; player-height fingerprint unchanged. No API evidence becomes a canonical height link |
| P3 | Batch 10, wikipedia, completed; read/inserted 84, rejected 0. Exactly 84 distinct players. Persisted set equals CSV × canonical afltables identities | Evidence-only; player-height fingerprint unchanged. Revision metadata in CSV is curation provenance, not a tracked acceptance pin |
| P4 | Batch 11, afltables, completed; read 695,499, inserted 32,856 = 386 coaches + 32,470 assignments, updated/rejected 0. Every coach/assignment carries batch 11 and afltables source | Coach pages supply identity/page totals; per-match Coach strings supply assignments. Page totals are cross-checks, not a substitution rule for missing assignments |

All canonical fills are AFL Tables batch 8; API/Wikipedia/P4 leave player-height columns unchanged. No evidence/player batch orphan appears in retained checks. Exported non-height player fields are unchanged for all 13,363 rows; the broader non-height fingerprint is also unchanged.

All **18** P1 rejection IDs exactly equal report not_mapped IDs: nine unmatched, nine name_mismatch; no no_canonical_player rows. The bound loader's assertion path admits only status=mapped with URL and non-NULL height (enrich_heights.py:252–254, :408 onward); rejection payload candidates are not selected identities. Report set equality, source gating and persisted rejections support rejected-row noncontribution **through this register path**. They do not imply a rejected name can never receive independent evidence from another accepted register row.

Collingwood Caps 162/182/615/649 remain unmatched with empty candidate lists. Victor Jackson 13048, Bert Chapman 1210 and Terry Waters 12456 remain NULL without evidence. Jim Jackson 7096 has 174 cm evidence with occurrences=2: the register has three 174 cm rows (Collingwood, Hawthorn, St Kilda), only Collingwood is rejected. The two surviving rows explain the occurrence count; the rejected row did not become a third assertion. No goal value, blank meaning or identity rule is adjudicated.

All **479** API rejection IDs equal the report's unmapped providerIds and the retained unmapped export; none is an API evidence external_id. 477 have a listed height. Retained computed classes are 418 with no normalized namesake or surname-at-listed-club-season candidate, 33 older namesakes only, 23 surname candidates not accepted by the rules, and five post-2012 namesakes without a shared club-season. These classify available matching evidence, **not reasons for absence or proven identities**. No “never played”, spelling or missing-history explanation is established.

Continuity observations remain: Cameron 2616 is 181 cm (API 180, Wikipedia 178); Graham 6318 is 181 (API 181); Ross 6547 and Williams 6648 remain canonical NULL with API evidence 187/198. Their rejected register rows stay rejected. No continuity policy changes follow.

## 4. Open conflict records versus source disagreements

Recounted from E/final/01+03+08:

| Comparison | Equal | Different | Canonical NULL |
|---|---:|---:|---:|
| AFL API versus canonical | 1,177 | 737 | 2 |
| Wikipedia versus canonical | 60 | 24 | 0 |

There are **zero open height_conflict records**, and indeed no height_conflict rows in export 09. P1 found no internal/existing canonical conflict on the clean state; the corroborating loaders do not create these issues for their cross-source disagreements. Therefore “no height conflicts” is valid only if explicitly restricted to the issue-record/P1 predicate. It is **not source agreement**. These counts neither select a preferred height nor constitute adjudication.

## 5. Ten coach discrepancies: arithmetic and attribution kept separate

Independently grouped final match_coaches by coach and compared the source_games_coached field. Exactly 376 of 386 totals agree.

| Coach / id | Page total | Assigned | Page − assigned | 2026 QF/EF/SF/PF/GF assignments |
|---|---:|---:|---:|---:|
| Chris Scott / 16 | 383 | 385 | −2 | 2 |
| Luke Beveridge / 31 | 277 | 278 | −1 | 1 |
| Chris Fagan / 39 | 239 | 243 | −4 | 4 |
| Wally Carter / 44 | 219 | 208 | +11 | 0 |
| Justin Longmuir / 55 | 154 | 158 | −4 | 4 |
| Matthew Nicks / 56 | 154 | 156 | −2 | 2 |
| Sam Mitchell / 76 | 119 | 121 | −2 | 2 |
| Dean Cox / 179 | 46 | 48 | −2 | 2 |
| Josh Fraser / 293 | 15 | 16 | −1 | 1 |
| Jim Adamson / 315 | 11 | 0 | +11 | 0 |

Read S/host-evidence/bin/coach-attribution.sql, coach-finals-check.sql and coach-last-assignments.sql and their E/measure outputs, plus parsed coach index/pages. The eight negative differences each equal the corresponding 2026 ordinary-finals assignment count; all eight coaches in those rounds are in this discrepancy set. Finals dates span September 3–26; WF was August 28–29; capture was September 5, 06:26–06:36Z. Retained scheduled_at comparisons have NULL timing data, so zeros for “started after capture” are not proof that no match started afterwards.

**Arithmetic fit is proven; page omission and its cause are not.** “The equality implies the pages include WF and exclude QF onward” and “eight pages omit the series” exceed the retained evidence. Counts and the last-six-match lists support that hypothesis but do not identify every game counted by the historical pages or exclude offsetting differences. Missing raw pages further limit independent checking.

North Melbourne has exactly eleven unassigned club-match rows, all 1940 rounds 8–18: match ids **3815, 3818, 3828, 3830, 3840, 3843, 3851, 3854, 3862, 3870, 3876**. The 1940 season has 18 matches, seven assigned to Len Thomas. Adamson's parsed index says NM/1940 and total 11. Count/club/year align, but retained data does not name him on those eleven match rows. “Adamson's count already uses them” is not established.

Carter's parsed index says **NM/1940–1962**, total 219; the persisted 208 assignments span **1948–1962**, with zero unassigned NM matches in that assigned tenure. The index's 1940 start is relevant source context, not row-level proof. **Withdraw “Carter’s difference can only come from those 11 matches”.** No retained row-level evidence establishes that exclusivity or rules out disputed existing assignments, page-total error, differing counting conventions or offsetting omissions. The two +11 differences cannot both be repaired by assigning the same eleven club-match rows under a one-coach rule, but that conditional arithmetic does not establish whose total or assignments are correct. Both historical attributions remain unresolved.

The loader's printed “pre-1923/1940 gaps and seasons beyond the baseline” is fixed explanatory text, not a computed resolution of these ten cases. Retained P4 planning exposes seven counters, not a complete planned assignment-row export. Count agreement and link integrity do not establish independent source-to-fixture or historical assignment proof. The broad earlier claim that every loader's full planned row set equals persistence is supported as an exact set comparison for P1 fills, P2 mapped identities and P3 CSV/identity evidence, not a separately retained P4 planned-row set. No assignments or totals have been corrected.

## 6. Protected state, delete counter and shutdown

The fingerprint query covers relkind='r' tables in public, afldb_meta, aflw, staging and staging_aflw. It hashes ordered textual row content with MD5 and records counts; players excludes height_cm/height_evidence_id, which receive a separate fingerprint entry.

**Correction:** the files contain **107 fingerprint entries: 106 ordinary-table entries plus players#height_columns**, not 107 ordinary tables. **101/107 entries are unchanged**. Changed entries are coaches, import_batches, import_rejections, match_coaches, player_height_evidence and players#height_columns. The ordinary players entry (other columns) is unchanged. Per-phase diffs match those intended categories.

Fingerprints support snapshot content equality within their exact scope. They do not prove zero write attempts, zero transient/reverted writes, zero catalog/temporary-table changes, unchanged sequences/indexes/functions/DDL/privileges or anything outside those schemas/relkind. MD5 equality is a content check with collision limits, not an audit trail. Export CSVs likewise cover selected columns/rows, not all database state. Thus the report's blanket “no unexpected write”/“only intended tables changed” must be read as **observed retained snapshot/table-counter scope**, not universal absence of activity.

Protected Brownlow, awards, seasons, club_seasons, player-season/club-season/list-member and other protected table fingerprint entries are unchanged. Files 01,02,04–07,09,13–15 are byte-equal initial/final; file 14 also equals the canonical retained file. It reports 2026 round/season rows 0, match vote values 0, publication records 0, nonpending/non-NULL-derived rows 0, and **669 pending player-season rows / zero non-NULL votes**. Club seasons remain **1,640, rehearsal-only**. Public-projection expressions were not rerun. All three 2026 keys — brownlow_match_votes, brownlow_round_votes, brownlow_season_total — remain pending. ET remains unresolved; all authority, eligibility, ownership and suppression/publication restrictions remain unchanged.

P4 database tup_deleted rises **1,058 → 1,147 (+89)**. Retained pg_stat_user_tables delete counters do not increase; stale assignment removal reports zero. The coach code has temporary-table activity, but there is **no retained relation/statement-level delete attribution** linking it to these 89. The increase is **explicitly unattributed**. Withdraw any factual attribution to temporary/catalog rows; even the earlier labelled inference must not become an accepted explanation. The aggregate counter and table fingerprints cannot resolve it.

Offline inspection supports the **recorded shutdown at that time**: stop.out records pre-stop guard, clone-only fast stop, PID 1454360 gone, no postmaster.pid, pg_ctl status 3, no process referencing clone, no port-55439 socket and control state shut down. The original source's before/after SHA-256 lists are identical for 2,142 files; retained source remains recorded stopped; other main PID 1301370/start time agrees. This review does not refresh current host state.

All 46 guard records identify the dedicated clone/database/port/marker and read-only default. The inherited system identifier is not clone identity; use the recorded control-file decimal string rather than JavaScript Number conversion of a 64-bit value. The read-only query wrapper explicitly begins REPEATABLE READ READ ONLY; the four write-phase records scope the per-session override to loaders. This evidence does not create a new host safety attestation.

The retained PostgreSQL log has **85 connection-received and 85 authorised entries**, all the named clone role/database (80 psql, five without application_name), correcting REPORT.md's 84. It has two ERROR entries corresponding to malformed read-only verification queries (FILTER syntax and GROUP BY); not loader errors. No unrelated dashboard investigation was performed.

## 7. Concrete owner choices still required

None of these choices is selected or approved by this review.

| Decision | Concrete choices | Boundary / evidence limitation |
|---|---|---|
| Historical roster input | Use exact rosters-20260905 solely for frozen rehearsal reproduction; or require a separately authorised successor capture/coverage review before broader use | 2012–2026 only, completeness unvalidated, capture 2026-09-04T22:07:51Z, 479 unmapped. +92 over predecessor is arithmetic, not coverage attribution |
| Wikipedia input / D5 | Use exact 84-row hash-bound set solely for rehearsal; or require a successor-derived adjudication set before acceptance | Selected against predecessor; complete resolution/distinctness now proven for these 84 only. Existing runner derives expected count from file rows and has no tracked content pin |
| Coach input coverage | Freeze coaches-20260905 plus candidate Coach strings for rehearsal and retain all gaps; or require separately scoped successor source coverage work | 386 parsed profiles, 385 Coach strings, 1,642 blank team-match groups; ten page totals disagree. Parsed identity resolution does not prove all assignments/history |
| Missing coach raw / D3 | Explicitly allow parsed-only evidence for a stated rehearsal scope; or require exact manifest-matching raw bytes before a later provenance acceptance | Raw absent in consumed tree, not fabricated. Loader allows complete absence and verifies raw if present; a partial raw directory fails. Hash references cannot reconstruct or authenticate absent bytes |
| Rejected heights / unmapped identities | Preserve all current refusals and gaps for rehearsal; commission separately authorised row-level evidence review if owner wants future adjudication | All 18 register rejections and 479 providers remain rejected. Four Collingwood goal discrepancies, Ross/Williams and all identity rules remain unresolved/unchanged |
| Coach attribution | Retain ten discrepancies as observations; or commission separately scoped historical row-level evidence work | No Carter exclusivity, Adamson assignment or finals-omission cause proven. No count-driven reassignment |
| Future baseline_only contract | Authorise a reviewable rehearsal-only configuration proposal with explicit shared height/coach inputs; or defer until input/provenance decisions are settled | No production contract/register edit, accepted-reference change, pin inheritance or gate bypass follows from these measurements |
| Fresh exact-commit runner rehearsal | After separate configuration/selection approval, commission a fresh isolated runner rehearsal with exact input/implementation/target bindings and shutdown evidence; or defer | This direct-loader run is not runner execution, not provePin/preflight/final-gate success, and not a core rebuild under b8ea2855. Exact future commit must be recorded when chosen, never guessed |

Production acceptance additionally retains the successor field/coverage decisions, exact contract/witness/register bindings, fresh scoped ownership/census and actual rollover date/status/authority gates from the retained decision package. This review supplies no production GO and no decision inheritance.

## 8. Smallest next test-only configuration proposal — not installed

Prepare **one reviewable rehearsal-only configuration overlay/fixture proposal** for the frozen c2-2026-final-core-v1 input set. Its smallest measured height block is:

~~~json
{
  "stats_input_mode": "baseline_only",
  "baseline_snapshot_label": "c2-2026-final-core-v1",
  "supplements": [],
  "measured": {
    "players_with_height": 12579,
    "height_without_evidence": 0,
    "height_conflicts_open": 0
  }
}
~~~

The proposal must declare that heights and coaches share this baseline/stats set. Alongside it, specify the already verified roster/coach manifest hashes and **rehearsal-only** measured fields: roster players_with_afl_api_evidence=1916; coaches 386, coaches_linked_to_players 368, coaches_unlinked 18, match_coaches 32470, matches_with_both_coaches 16035, matches_with_one_coach 400, matches_without_coach 621. Keep coaches_linked_outside_unique=0 as the existing hard-coded invariant. The Wikipedia final value is 84 only for the exact CSV hash above with resolution/distinctness preserved; do not invent a new unsupported contract key or mistake row-derived counting for content binding.

This is a configuration **proposal**, not a complete runnable runner configuration: the owner must still choose explicit test-only candidate selection and containment of roster/coach contract overrides and CSV hash verification without altering production references. The production accepted-baseline selector does not select c2. The current contracts retain predecessor pins (height 12,487; API 1,824; assignments 32,034; both-coach matches 15,817) and default supplemented mode. Do not overwrite them or add guessed expectations for unrelated stages. The next bounded work is offline proposal preparation/review only; a fresh exact-commit runner rehearsal remains a separate later authorisation with exact target lifecycle and gates. No bindings are installed here.

## 9. Corrections, history and files

Earlier reports and prerequisite/planning documents remain intact as dated history. This review supersedes their current interpretations where stated: “all thirteen equal planning”, unqualified “no height conflicts”, inferred finals omission/exclusive Carter attribution, blanket fingerprint safety claims, 107 ordinary tables, 84 connections, and any attribution of +89 deletes. Earlier statements that measurements were unavailable describe their earlier checkpoint; the measurements above now exist with the stated limits.

Created this file only after confirming absence; exclusive-create writing also refuses replacement. Necessary ISSUE-316 tracking updated in IssuesIndex.md, issues.md (including its Open Issues row) and issues/open/AFLDB-ISSUE-316.md. ISSUE-316 remains unresolved; membership unchanged. No CHANGELOG entry for this investigation-only review. No code, contract, reference, .codex/ or unrelated file was changed.

### Selected consumed sequential evidence hashes

Paths below are relative to S; the full verified inventory covers the remaining phase reports, queries, exports, guards and provenance files.

| Path | Recomputed SHA-256 |
|---|---|
| REPORT.md | b07d8f47ebdaf67a05e5988a32790d64bf64c3ad5fee8b8c8d190fa03c258433 |
| host-evidence/bin/measure.sql | 4b84e5f6ea041958d0c4167981e3b79e4c9cc59de9e9edf7f366006033ead1f2 |
| host-evidence/bin/fingerprint.sql | 880badf07afe5b9fbe61294057a1204163fc29a8cece1052ebe0c9964e471429 |
| host-evidence/bin/state2.sql | f8764a62f9d48b76db762584fdc66160c7a759f3b974d219757754a27aa1c0c6 |
| host-evidence/export/final/03-players.csv | 8d445658e886ae4f635cae87998d2c5b23a26532152e068e58025637af602685 |
| host-evidence/export/final/08-player-height-evidence.csv | 5547a407dedde9b398f0e92944e3271d75365c57bf3aa51522eb8fe530b645c5 |
| host-evidence/export/final/09-data-issues-height-conflict.csv | 1fdffcff2fab63cd32ef608aaf9e8e7b807001b8708b624a5c7913c907f69025 |
| host-evidence/export/final/10-coaches.csv | fbd7ffc6a01d06331e8b3a359420323467e77aa11e79a5393dcdd39bad8db7e1 |
| host-evidence/export/final/11-match-coaches.csv | 82aa5ced2ea9c7ebda58234ae157aea4fb4f5125431a5a15f2e6f6e165364abe |
| host-evidence/export/final/12-import-batches.csv | e4ee574fe9db10dea80ceadab9e6236dc4f27971bec33346777cf5b0c6c2e322 |
| host-evidence/export/final/14-pending-brownlow-and-count-state.csv | bf4286b24afce3e33dce59abeb7906d6e74e5f9665ee87951c4cc9a48f233b25 |
| host-evidence/export/measure/final-rejections.csv | d931fa9fe49785f2ff7769b594fbdd1f6c65455ff779cd0c21e9c527cf0bbd62 |
| stop.out | 7c277ac6d38422d9609e5a38122ce1d228ae4a35eebf49591cabce0515184169 |
