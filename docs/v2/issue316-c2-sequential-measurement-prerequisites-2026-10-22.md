# ISSUE-316 C2 sequential height/corroboration/coach measurement — prerequisite review — 2026-10-22

> **Retention review (2026-10-22, evidence-retention session).** File content before this note had SHA-256 prefix `998f9f62e824412d` (matches the rehearsal closure). Cited retained-artefact hashes were re-checked; historical text below is preserved unmodified. Its FAIL/BLOCKED rows describe the state at `b8ea2855`. The isolated rehearsal at `5643f5c2` later completed. Rows concerning production evidence stay blocked: manifest-matching raw coach HTML is absent, the Wikipedia heights file has no tracked pin, and no live-target ownership census exists. See the [rehearsal closure](issue316-c2-rehearsal-closure-2026-10-22.md#8-retention-review-and-dependency-lock-findings-2026-10-22).

**Prerequisite review only. Nothing executed, accepted, bound or written. ISSUE-316 OPEN. Production NO-GO. 1,640 remains rehearsal-only.**

## 1. Scope, authority and method limits

One agent; owner-authorised bounded offline review. Implementation basis `b8ea28550a291b766bf7ad9f3b63621e9f9efa81`
(`HEAD`; the session-start status snapshot lists no modified file under `tools/` or `data/`; `git` was not re-run).
Reused, not repeated: the loader planning report (`C:\tmp\afldb-c2-loader-planning-20261022\REPORT.md`,
`INPUT_BINDINGS.json`, retained `host-evidence/export/loaders/*.stdout`) and the supplement-free proposal.

**Method limit, stated plainly.** The owner's text authorised "native in-process" hashing and database-free evaluation of pure
helpers, and also forbade shell commands. This session had no in-process execution capability other than a shell, so **no hash was
recomputed and no runner helper was evaluated**. Every hash comparison below is a string comparison between a hash recorded in a
retained artifact (`INPUT_BINDINGS.json`) and a hash pinned in a tracked contract; every behavioural claim is from reading the code at
the cited lines. Where an executed check would be stronger, it is named as such. CR-free working copies of both manifests were
checked by content search (zero `\r`), so the runner's CRLF→LF normalisation is a no-op for them.

Exploratory use of the exact historical artifacts (roster `rosters-20260905`, Wikipedia CSV, coach pages `coaches-20260905`) is
distinguished throughout from **acceptance of their successor coverage**, which nothing here grants.

## 2. Verdicts at a glance

| # | Prerequisite | Verdict |
|---|---|---|
| P1 | Roster manifest pin (`provePin` equivalent) | **PASS** (static; not recomputed) |
| P2 | Roster contract-version | **PASS, but not a gate** (nothing enforces it) |
| P3 | Roster artifact hashes (loader-level) | **PASS** (planning dry-run); runner `--validate-only` **NOT RUN** |
| P4 | Roster measured pin vs candidate | **FAIL** as a runner final gate; **BLOCKED** on measurement review |
| P5 | Coach manifest pin (`provePin` equivalent) | **PASS** (static; not recomputed) |
| P6 | Coach manifest family/contract-version, parsed hashes and row counts | **PASS** (loader-enforced; planning dry-run) |
| P7 | Coach measured pin vs candidate | **FAIL** (2 of 7 keys) as a runner final gate; **BLOCKED** |
| P8 | Coach raw files required by an applicable gate | **PASS — not required** (cites in §4) |
| P9 | Height binding in the real contract (`baseline_only`) | **FAIL** as installed; **BLOCKED** (needs unmeasured integers) |
| P10 | Runner can select the `c2-2026-final-core-v1` baseline | **FAIL** (not in the accepted register) |
| P11 | Wikipedia CSV bound to the implementation | **PARTIAL** — tracked-in-git only; no hash pin anywhere in the repo |
| P12 | Test-only binding for the CSV | **PASS** for exploratory use (already recorded); **NOT SUFFICIENT** for acceptance |
| P13 | Successor coverage of roster / Wikipedia / coaches | **UNPROVEN**; specific gaps in §6 |
| P14 | Loader-level feasibility of a sequential clone-only run | **PASS without weakening any loader gate**; **no runner-gate result** |

## 3. Roster and coach inputs against the runner's real requirements (question 1)

The runner never takes a pin from the command line. `aflApiRosterPin()` and `afltablesCoachesPin()` read the **repository** contracts
and call `provePin`, which refuses unless the manifest file exists in the checkout and its LF-normalised SHA-256 equals the contract
value (`tools/db/rebuild-test.ts:2975–2988`, `3082–3109`, `3313–3358`).

| Item | Contract value (repository) | Retained input binding | Result |
|---|---|---|---|
| Roster label / manifest | `rosters-20260905`, `docs/rebuild-manifests/afl_api/rosters-20260905.json` (`afl-api-contract.json:91–93`) | same path, `origin git:b8ea2855…` | match |
| Roster `manifest_sha256` | `61aff99a8b14e08823821b23e68817c30604dabf33399b437ad3bf7fbe6369a7` | `61aff99a…69a7` | **equal** |
| Coach label / manifest | `coaches-20260905`, `docs/rebuild-manifests/afltables_coaches/coaches-20260905.json` (`afltables-contract.json:177–180`) | same path | match |
| Coach `manifest_sha256_lf` | `3e78f47354ac9fe594547ad327efaa6a2f6da90c54b17072ade4443e74ba8094` | `3e78f473…8094` | **equal** |

**Contract versions.** Coaches: `import_match_coaches.py:89–93` refuses unless manifest `family` equals the contract's (`coach_pages`
= `coach_pages`) and `contract_coaches_version` equals the contract's (`1` = `1`; `coaches-20260905.json:4,8`,
`afltables-contract.json:75–76`) — a real, satisfied gate. Roster: manifest and contract both carry `contract_roster_version: 1`
(`rosters-20260905.json:8`, `afl-api-contract.json:61`), but a search of `tools/db/*.ts`, `tools/migration/*.py`, the `tools/rebuild` JSON and `tests`
finds **no code that reads it** (R/Python adapters under `tools/rebuild` and `legacy/` were not searched); equality exists, enforcement does not. The AFL API loader's only manifest checks are that roster
entries exist and each artifact's SHA-256 matches (`enrich_heights_afl_api.py:247–259`).

**Manifest and artifact requirements.** Loader-level: the planning dry-runs verified 15/15 roster artifacts and 386 index rows /
386 pages. The runner's own preflight is the same loaders with `--validate-only` (`rebuild-test.ts:2852–2860`, `2876–2887`). The
planning report disclosed that `--validate-only` was not run separately, so the runner-level preflight is **not run**; the code path is
shared, but "same code" is not "same execution".

**Measured expectations (the part that does not carry over).** Pinned values describe the predecessor baseline (16,838 matches):

| Key | Contract | Candidate planning count | Difference |
|---|---|---|---|
| `players_with_afl_api_evidence` | 1,824 | 1,916 mapped | +92 |
| `coaches` / linked / unlinked | 386 / 368 / 18 | 386 / 368 / 18 | 0 |
| `match_coaches` | 32,034 | 32,470 | +436 |
| `matches_with_both_coaches` | 15,817 | 16,035 | +218 |
| `matches_with_one_coach` / `without` | 400 / 621 | 400 / 621 | 0 |

Arithmetic observation, not an expectation: 17,056 − 16,838 = 218, and +218 both-coach matches / +436 assignments fits exactly
218 matches with two coaches each. The one-coach and no-coach counts are unchanged. These planning counts came from
independent dry-runs against empty enrichment tables; equality or inequality with a predecessor pin is not inheritance and not
acceptance. Under the unmodified contracts the runner's final gates for the two roster/coach keys above would **fail**; they may not
be edited to match until a reviewed measurement exists (proposal §6 rule: no same-run auto-acceptance).

**Heights are the hard blocker for any runner path** (not asked, but it decides whether the pins matter):
- `heightEnrichmentPins` (`rebuild-test.ts:3012–3072`) requires `datasets.player_details.height_enrichment`; absent `stats_input_mode`
  it defaults to `supplemented_baseline` and then **requires a nonempty supplement list** (`3041–3044`). Both the repository contract
  (`fitzroy-contract.json:298–307`) and the retained rehearsal-only contract (`…\run-tree\tools\rebuild\fitzroy\fitzroy-contract.json:421–430`)
  list supplement `issue129-t7-20260903`, hash `9dfb2efa…3984`, and no `stats_input_mode`. The runner would therefore pass
  `--supplement-label issue129-t7-20260903` to the heights **and** coach loaders (`3116`, `3364`) — the opposite of the
  supplement-free measurement (the retained overlap finding rejects that supplement as additive). **FAIL (P9).**
- `baseline_only` needs `supplements: []`, `baseline_snapshot_label` equal to the selected baseline, and **three integer
  `measured` fields** (`3027–3040`, `3055–3061`). No successor integers exist; supplying any would manufacture expectations. **BLOCKED.**
- `selectAcceptedBaseline` (`1088–1121`) takes the single `accepted` entry of `data/reference/fitzroy-accepted-baselines.json`, which is
  `full-history-20260902` (`:217–218`); `c2-2026-final-core-v1` appears nowhere under `data/reference`. Reaching it would need the
  partial-baseline label path, which is a stage entry point outside this authority. **FAIL (P10).**

## 4. Coach raw files (question 2)

**No applicable gate requires them.** Exact requirements:

1. `import_match_coaches.py:130–143` — raw bytes are verified **only if `raw/` exists**; otherwise the loader prints
   `raw/ not present (the tracked parsed artefacts are the rebuild input)` and continues. The retained dry-run output printed exactly that
   (`p4-coaches.stdout:2`).
2. `afltables-contract.json:142` (`artefact_rule`) — raw HTML is "gitignored but hash-bound in the manifest. The loader always verifies
   the parsed artefacts … and verifies the raw bytes whenever raw/ is present."
3. Runner preflight (`rebuild-test.ts:2873–2887`) — a `--validate-only` exit status; the message mentions re-acquisition but there is
   no separate raw-existence check (search of `tools/db` and `tests` finds none).
4. Binding that does exist: every parsed page row must carry the manifest entry's `raw_sha256` (`import_match_coaches.py:126–129`),
   and manifest counts must agree with the index/page rows (`:118–122`).

Boundaries this does **not** settle: a *partial* `raw/` directory would fail the loader (`:136–139`), so a measurement tree must either
contain complete raw or none. The parsed rows are hash-linked to raw hashes but the raw bytes themselves are unverified everywhere
(retained report: absent everywhere). Whether that is acceptable for *acceptance* is an owner provenance decision (D3), not a gate
finding.

## 5. Wikipedia CSV provenance (question 3)

What binds it today:
- Tracked in git at the implementation commit; `.gitignore:97–98` opts it in; the planning bindings record `origin git:b8ea2855…`,
  SHA-256 `3d809e60afe996b8d939ae6348d26386ccc2b844954bfcef0ae7d9ada115a13b`, 19,594 bytes. A repository-wide search finds that hash
  **in no tracked file** (only the retained C: bindings).
- The loader pins nothing: `enrich_heights_wikipedia.py:60–86` checks columns, `players/…html` profile shape, no duplicates, integer
  height within bounds, non-blank title. It accepts any file passed via `--csv`.
- The runner's final key `players_with_wikipedia_height_evidence` expects `wikipediaHeightRows()` — the file's own nonblank-line
  count minus the header (`rebuild-test.ts:3148–3163`, `3187–3189`). The expectation is **derived from the artifact it checks**, so it is
  self-referential and cannot detect a substituted file. The file has 84 data rows (85 lines).
- Row-level provenance exists in the file (`wikipedia_title`, `revision_id`, `revision_timestamp`; six rows carry September 2026
  timestamps) and the closed ISSUE-118 runbook records the 83 + 1 row history. That is curation provenance, not a binding.

Additional binding a **test-only (exploratory) measurement** needs beyond what `INPUT_BINDINGS.json` already holds (path, origin,
SHA-256, bytes): (a) the harness, not the loader, must verify the file hash before and after each phase and pass the bound path
explicitly; (b) the report must state that the set was selected against the predecessor register (captured 2026-09-02, 13,273 players)
and that no c2 selection was made; (c) the 84-row count is recorded as an observation, not an expectation. Nothing else should be
created — no acceptance metadata, no contract pin.

What would additionally be needed for **acceptance** (not requested, not available): a tracked hash pin or manifest for the CSV, an
owner decision that this set (or a re-derived one) covers the successor, and a distinctness check (below).

Unmeasured risk: the evidence upsert key is `(player_id, source_id, height_cm)` (`:160–167`); if two CSV profiles resolve to one player
(the height register already has one two-URL player, 12,580 URLs → 12,579 players), distinct evidence players could be fewer than 84.
The planning dry-run reports resolved profiles (84), not distinct players.

## 6. What each snapshot covers, and unsupported successor coverage (question 4)

Candidate: `c2-2026-final-core-v1`, 17,056 matches 1897–2026, acquired 2026-10-21T04:34:37Z. Age alone is not treated as invalidity;
the items below are measured or structural gaps.

| Snapshot | Actual coverage | Evidence-based gaps for the successor |
|---|---|---|
| Roster `rosters-20260905` | 15 seasons 2012–2026, one `current=TRUE` fetch per season, extracted 2026-09-04T22:07:51Z, `completeness: "unvalidated"`; 2,395 providerIds, 1,916 mapped, **479 unmapped**, 0 ambiguous | Nothing before 2012 by design. The 479 unmapped providerIds are uncharacterised (reason, season, club not retained). Players only in the candidate's 2026 data and not listed on 2026-09-05 are unsupported; whether the +92 over the predecessor pin relates to them is unproven. Comparison with the register height is unmeasurable (canonical heights NULL). |
| Wikipedia CSV | Exactly 84 named profiles, all 84 resolve in the candidate, 0 unresolved | Targeted set only; "says nothing about players outside it" (loader docstring). Selected against the predecessor register; whether the candidate register disagrees with the external oracle for other players, including the ~90 identities the predecessor lacked (13,363 vs 13,273), is unknown. Agree/differ (0/84) is a NULL artefact. |
| Coaches `coaches-20260905` | Index and pages for 386 coaches, extracted 2026-09-05 06:26–06:36Z; 385 distinct Coach strings in the candidate all resolved exactly; 368 linked, 18 coach-only; the +218 both-coach count equals the +218 matches over the predecessor (arithmetic fit, not a per-match check) | Coach-page Games Coached equals the plan for 376/386; **10 differ and are not enumerated** in retained output. The loader's explanatory text ("pre-1923/1940 gaps and seasons beyond the baseline", `p4-coaches.stdout:10`) is a fixed string, not a computed attribution. Coaches appointed after 2026-09-05 would surface as unresolved strings (a refusal) — none occurred, which supports, but does not prove, adequacy. |

Exploratory use of these exact artifacts is possible; each result must carry "successor applicability unproven".

## 7. What can be satisfied now, and what cannot (question 5)

**Now (no owner decision):**
- P1, P5 and P6 pin/version/hash equality as static findings (§3); the retained 162-file `INPUT_BINDINGS.json` already hashes every
  exploratory input including the CSV and the parsed coach artifacts.
- P8: coach raw files are not required by any applicable gate.
- P14: the four loaders accept the measurement without any code change. `enrich_heights.py` has no accepted-baseline or pin gate;
  the AFL API loader does not read `afl-api-contract.json`; the coach loader reads only the coaches section of
  `afltables-contract.json` plus the fitzRoy contract for corrections/continuity; `supplements` default to `[]`. A direct run is **not a
  gate bypass** only if it is labelled exploratory and claims no runner-gate result.

**Requires an owner decision:** D1–D5 in §8.

**Requires unavailable evidence:** coach raw bytes (absent everywhere); a tracked hash pin for the CSV; the list of 10 mismatched coach
pages and the 479 unmapped providerIds (not retained; both obtainable read-only on a clone); successor Wikipedia/roster/coach captures
(acquisition, out of scope).

**Requires implementation or data changes (runner-gate path only):** a `baseline_only` entry in the contract with three integer
measured values and the three roster/coach pins re-measured; a way for the runner to select the candidate baseline. These are
contract-data edits plus selection policy and **must follow, not precede, a reviewed measurement**. None is needed for exploratory measurement.

## 8. Remaining owner decisions

- **D1** Confirm the framing: a direct sequential loader run is measurement-only, uses no runner stage entry point, and claims neither
  runner-gate success nor successor acceptance. (Without this, writes cannot proceed without being read as weakening P9/P10.)
- **D2** Authorise the three historical artifacts as exploratory inputs labelled "successor applicability unproven", or commission successor
  captures instead.
- **D3** Whether absent coach raw bytes are acceptable for eventual acceptance (not needed for measurement).
- **D4** Confirm that measured values are recorded only after review and never become the same run's expectations.
- **D5** Whether a successor-derived Wikipedia adjudication set is required before any acceptance.

## 9. One bounded proposal (not started)

**Execution proposal — one agent, one fresh disposable clone, loaders only.** Reuse the 2026-10-22 planning clone procedure and bound
tree (same stopped source, same 162 hashed inputs, same identity guards, private socket, read-only default lifted only on the new
clone). Run, directly and in order, `enrich_heights.py --label c2-2026-final-core-v1` → `enrich_heights_afl_api.py --label
rosters-20260905` → `enrich_heights_wikipedia.py --csv <bound CSV>` → `import_match_coaches.py --label coaches-20260905 --fitzroy-label
c2-2026-final-core-v1`, no supplements, no runner, no contract edit, no `--report` flags beyond those already in the loaders. Before
each loader: verify tree hashes and clone identity; after each: before/after table counts and hash re-check. Read-only extraction
afterwards: evidence rows with batch lineage, NULL-only fills and `height_evidence_id` links, conflicts, the five height and eight
coach keys as the runner defines them (`rebuild-test.ts:3174–3191`, `3385–3403`), distinct Wikipedia and AFL API evidence players,
the 10 coach pages whose Games Coached differ, and the 479 unmapped providerIds by season/club. Stop on any drift, write outside the
clone, or loader refusal. Outputs are reviewed before any expectation is written anywhere. No supplements, no rebuild, no accepted
binding, no active-reference change.

If D1 is declined, there is no repair that keeps the gates intact today: the runner path stays **BLOCKED** until a reviewed
measurement supplies the integers and a candidate-selection decision exists.

## 10. Preserved and files

Unchanged: all 18 rejected height matches (unmatched 9, name_mismatch 9, including Collingwood Caps 162/182/615/649), informational
jumpers, unresolved ET, all three 2026 Brownlow keys (`brownlow_match_votes`, `brownlow_round_votes`, `brownlow_season_total`)
pending, AFL API authority, eligibility and ownership restrictions. 1,640 rehearsal-only; production NO-GO.

Created this document after confirming its absence. Tracking updated only in `IssuesIndex.md`, `issues.md` and
`issues/open/AFLDB-ISSUE-316.md`. No CHANGELOG entry (no retained behaviour change). `.codex/` and unrelated edits untouched. No shell,
Git, network, host/database access, loader or stage execution, hashing, clone, acquisition, commit or deployment.
