# AFLDB-ISSUE-222 -- population-scan operator decision pack (20260918-v1)

**Phase 3 remains PENDING.** This pack corrects and completes the population-scan sign-off pack (`bridge-population-scan-signoff-20260918-v1.md`) into a full, internally reconciled operator decision pack. It decides nothing, imports nothing, generates no bridge v2 dataset, and sets no `operator_verdict`. All figures below are computed directly from the retained, immutable population-scan JSON (`bridge-population-scan-20260918-v1.json`, 3,564 rows, `rows_sha256=ddd5faba8a292d91b52d5beef86f9aae91dfef0ab2a14dec9ba5894f2968c8c0`) and the immutable 997-row review sample (`bridge-review-20260918-v1.json`). No network, database, import, Playwright, or Git action was taken to produce it.

## 1. Executive summary

- All 3,564 parent bridge candidates are reconciled into 7 mutually exclusive population outcomes; totals sum exactly to 3,564 (verified programmatically).
- `target_not_registered` (101 child rows) decomposes **exactly** as 94 `insufficient_evidence` (`TARGET_NOT_REGISTERED_NO_EVIDENCE`) + 7 `source_discrepancy_same_person` (`ALTERNATE_REGISTERED_IDENTITY_CORROBORATED`) = 101. None of the 23 confirmed or 2 suspected mislinks are target-unregistered -- all 25 are currently bridged.
- 23 `confirmed_source_mislink` rows recommend `exclude_from_bridge`: 7 originally sampled (random stratum) + 16 discovered only by the population scan (16 non-sample). 0 are in the national top-10 census stratum.
- 2 `suspected_source_mislink` rows (`adrian_deluca/1`, `setanta_ó hailpín/1`) are flagged only by a surname-tokenisation limitation on compound/diacritic surnames; every other signal agrees. Recommendation: withhold pending operator confirmation, NOT exclusion.
- 7 `source_discrepancy_same_person` rows are numbering/spelling cases with a corroborated alternate identity; recommendation: route to manual curation, not auto-admit (current href-only contract cannot safely admit them).
- 107 `insufficient_evidence` rows (94 `TARGET_NOT_REGISTERED_NO_EVIDENCE` + 13 `OFFLINE_LIMITED`) default to withhold; none may be called registration lag without retained proof.
- 3 `human_authority_overlap` rows retain the existing human ledger decision unchanged; they are not net-new bridge applications.
- The pre-existing statistical claim (`0.50%` zero-failure bound on the 598-row random stratum) is **not valid as originally stated**: the random stratum was not actually a zero-failure draw (7 confirmed mislinks + 3 same-person discrepancies were within it). A recalculated bound on the 588 clean survivors is presented in §9, together with a recommendation (not a decision) on sample redraw/top-up.

## 2. Reconciliation cross-tabulations (all 3,564 rows)

### 2.1 Population outcome (mutually exclusive, sums to 3,564)

| Outcome | Rows | Distinct draft persons | Affected draft-pick rows |
|---|---:|---:|---:|
| `population_clean` | 3422 | 3422 | 5055 |
| `confirmed_source_mislink` | 23 | 23 | 23 |
| `suspected_source_mislink` | 2 | 2 | 3 |
| `source_discrepancy_same_person` | 7 | 7 | 11 |
| `insufficient_evidence` | 107 | 107 | 118 |
| `human_authority_overlap` | 3 | 3 | 3 |
| `tooling_or_schema_error` | 0 | 0 | 0 |
| **Total** | **3564** | **3564** | **5213** |

Distinct-draft-persons here is scoped to this population scan's 3,564 rows (each `player_url` maps to exactly one `expected_afltables_identity` with zero cross-category or within-category duplicates, verified programmatically). This does not reproduce the separately-quoted parent-level `3,564/1,493` distinct-identity figure (§11.6), which reflects database-level profile-continuity deduplication this offline, no-database pass does not perform.

### 2.2 Parent vs. `afldb_test` child membership (`child_status`)

| Outcome | `bridged` | `target_not_registered` |
|---|---:|---:|
| `population_clean` | 3422 | 0 |
| `confirmed_source_mislink` | 23 | 0 |
| `suspected_source_mislink` | 2 | 0 |
| `source_discrepancy_same_person` | 0 | 7 |
| `insufficient_evidence` | 13 | 94 |
| `human_authority_overlap` | 3 | 0 |

Total `bridged` = 3,463; total `target_not_registered` = 101; 3,463 + 101 = 3,564. All 3,463 bridged rows are verified present in the accepted fitzRoy snapshot's URL set (§11.5); all 101 target-unregistered rows are verified absent from it.

### 2.3 Target registration status decomposition (proves 101 = 94 + 7)

- Total `child_status == target_not_registered` rows: **101**
- Of these, `insufficient_evidence` (`TARGET_NOT_REGISTERED_NO_EVIDENCE`): **94**
- Of these, `source_discrepancy_same_person` (`ALTERNATE_REGISTERED_IDENTITY_CORROBORATED`): **7**
- Sum check: 94 + 7 = **101** (= 101). Confirmed exact, no residual.
- `confirmed_source_mislink` or `suspected_source_mislink` rows that are target-unregistered: **0** (none -- all 25 are currently bridged).

### 2.4 Existing human-decision status (`ledger_status`)

| Outcome | `none` | `linked_agreeing` | `linked_disagreeing` | `confirmed_unlinked` |
|---|---:|---:|---:|---:|
| `population_clean` | 3422 | 0 | 0 | 0 |
| `confirmed_source_mislink` | 23 | 0 | 0 | 0 |
| `suspected_source_mislink` | 2 | 0 | 0 | 0 |
| `source_discrepancy_same_person` | 7 | 0 | 0 | 0 |
| `insufficient_evidence` | 107 | 0 | 0 | 0 |
| `human_authority_overlap` | 0 | 3 | 0 | 0 |

Only the 3 `human_authority_overlap` rows carry a ledger decision (`linked_agreeing`, all 3). No row anywhere in the population carries `linked_disagreeing` or `confirmed_unlinked` (a disagreement would be a HALT under §3.2, not reached this pass).

### 2.5 Census / random-sample / non-sample membership

| Outcome | Census (399) | Random (598) | Non-sample (2,567) |
|---|---:|---:|---:|
| `population_clean` | 385 | 575 | 2462 |
| `confirmed_source_mislink` | 0 | 7 | 16 |
| `suspected_source_mislink` | 0 | 0 | 2 |
| `source_discrepancy_same_person` | 1 | 3 | 3 |
| `insufficient_evidence` | 13 | 13 | 81 |
| `human_authority_overlap` | 0 | 0 | 3 |

399 + 598 + 2,567 = 3,564. The census stratum (every candidate declared in `bridge-review-20260918-v1.json`'s `census_stratum`, the exhaustive national top-10 pool) carries 14 non-clean rows (11 `TARGET_NOT_REGISTERED_NO_EVIDENCE`, 2 `OFFLINE_LIMITED`, 1 `source_discrepancy_same_person` -- `joel_smith/1`); 0 confirmed or suspected mislinks.

### 2.6 Positive-game vs. zero-game DraftGuru cohort

| Outcome | Positive games | Zero games |
|---|---:|---:|
| `population_clean` | 3401 | 21 |
| `confirmed_source_mislink` | 0 | 23 |
| `suspected_source_mislink` | 2 | 0 |
| `source_discrepancy_same_person` | 7 | 0 |
| `insufficient_evidence` | 106 | 1 |
| `human_authority_overlap` | 3 | 0 |

All 23 confirmed mislinks are zero-game DraftGuru entries (the defining signature); the 2 suspected and 7 discrepancy rows are all positive-game (consistent with being the SAME real, played career misfiled by a tokenisation/spelling artefact, not a phantom draftee).

### 2.7 Distinct draft persons -- see §2.1 (column 2); 1:1 with rows in this population scan's scope.

### 2.8 Affected draft-pick count -- see §2.1 (column 3); sums to 5,213 Stage A draft-event rows across the 3,564 candidates.

### 2.9 / 2.10 National Draft top-10 person / pick count

- Current baseline (§11.9, unchanged by this pack): **389/420** picks, **387/418** persons (92.62%/92.58%).
- Within the census stratum (the operational national top-10 pool used by this pass, 399 rows, see §2.5): 385 rows are `population_clean`, 14 are not (§2.3). 0 of the 23 confirmed / 2 suspected are census rows, so Scenario A (§8.1) leaves 389/420 and 387/418 unchanged.
- Scenario B (§8.2) additionally withholds exactly 2 currently-bridged census rows (`keith_thomas/2`, `tim_walsh/1`, both `OFFLINE_LIMITED`, 1 affected pick each per retained evidence) -- see §8.2 for the corrected 387/420 and 385/418.

## 3. Confirmed source mislinks (23) -- recommend `exclude_from_bridge`

| DraftGuru URL | Name | Captured href | Retained target | Earliest recruitment | DG games/goals | Target span/games/goals | Sample | Child | Picks |
|---|---|---|---|---|---|---|---|---|---|
| `https://www.draftguru.com.au/players/andrew_krakouer/1` | Andrew Krakouer | `players/A/Andrew_Krakouer0.html` | Andrew Krakouer | 1992 Mid-Season | 0/0 | 1989-1990 / 8 / 8 | non_sample (non_sample) | bridged | 1 |
| `https://www.draftguru.com.au/players/bradley_sparks/1` | Bradley Sparks | `players/B/Bradley_Sparks.html` | Bradley Sparks | 1990 Pre-Draft | 0/0 | 1987-1988 / 4 / 4 | non_sample (non_sample) | bridged | 1 |
| `https://www.draftguru.com.au/players/bret_hutchinson/1` | Bret Hutchinson | `players/B/Bret_Hutchinson.html` | Bret Hutchinson | 1989 Pre-Season | 0/0 | 1985-1985 / 1 / 0 | originally_sampled (random) | bridged | 1 |
| `https://www.draftguru.com.au/players/chris_o'dwyer/1` | Chris O'Dwyer | `players/C/Chris_ODwyer.html` | Chris ODwyer | 1992 Pre-Season | 0/0 | 1990-1991 / 8 / 1 | non_sample (non_sample) | bridged | 1 |
| `https://www.draftguru.com.au/players/craig_somerville/1` | Craig Somerville | `players/C/Craig_Somerville.html` | Craig Somerville | ? (not captured) | 0/0 | 1986-1986 / 8 / 7 | originally_sampled (random) | bridged | 1 |
| `https://www.draftguru.com.au/players/darren_williams/1` | Darren Williams | `players/D/Darren_Williams.html` | Darren Williams | 1990 Pre-Season | 0/0 | 1979-1989 / 109 / 94 | non_sample (non_sample) | bridged | 1 |
| `https://www.draftguru.com.au/players/david_sullivan/1` | David Sullivan | `players/D/David_Sullivan.html` | David Sullivan | 1989 Pre-Season | 0/0 | 1986-1988 / 11 / 14 | non_sample (non_sample) | bridged | 1 |
| `https://www.draftguru.com.au/players/david_williams/1` | David Williams | `players/D/David_Williams.html` | David Williams | 1989 Pre-Season | 0/0 | 1983-1988 / 67 / 102 | originally_sampled (random) | bridged | 1 |
| `https://www.draftguru.com.au/players/gary_keane/1` | Gary Keane | `players/G/Gary_Keane.html` | Gary Keane | ? (not captured) | 0/0 | 1985-1988 / 55 / 55 | non_sample (non_sample) | bridged | 1 |
| `https://www.draftguru.com.au/players/glen_bartlett/1` | Glen Bartlett | `players/G/Glen_Bartlett.html` | Glen Bartlett | 1989 Mid-Season | 0/0 | 1987-1987 / 4 / 0 | originally_sampled (random) | bridged | 1 |
| `https://www.draftguru.com.au/players/ian_rickman/1` | Ian Rickman | `players/I/Ian_Rickman.html` | Ian Rickman | 1989 Pre-Season | 0/0 | 1982-1984 / 11 / 10 | non_sample (non_sample) | bridged | 1 |
| `https://www.draftguru.com.au/players/john_ahern/1` | John Ahern | `players/J/John_Ahern.html` | John Ahern | ? (not captured) | 0/0 | 1989-1989 / 2 / 0 | non_sample (non_sample) | bridged | 1 |
| `https://www.draftguru.com.au/players/john_peter-budge/1` | John Peter-Budge | `players/J/John_Peter-Budge.html` | John Peter-Budge | 1990 National | 0/0 | 1986-1988 / 45 / 26 | non_sample (non_sample) | bridged | 1 |
| `https://www.draftguru.com.au/players/mark_mcleod/1` | Mark McLeod | `players/M/Mark_McLeod.html` | Mark McLeod | 1990 Pre-Season | 0/0 | 1989-1989 / 3 / 0 | non_sample (non_sample) | bridged | 1 |
| `https://www.draftguru.com.au/players/mark_pitura/1` | Mark Pitura | `players/M/Mark_Pitura.html` | Mark Pitura | 1995 Pre-Season | 0/0 | 1993-1993 / 2 / 0 | non_sample (non_sample) | bridged | 1 |
| `https://www.draftguru.com.au/players/nathan_irvin/1` | Nathan Irvin | `players/N/Nathan_Irvin.html` | Nathan Irvin | 1994 National | 0/0 | 1993-1993 / 1 / 0 | non_sample (non_sample) | bridged | 1 |
| `https://www.draftguru.com.au/players/paul_mifka/1` | Paul Mifka | `players/P/Paul_Mifka.html` | Paul Mifka | 1990 Pre-Draft | 0/0 | 1987-1987 / 1 / 0 | non_sample (non_sample) | bridged | 1 |
| `https://www.draftguru.com.au/players/peter_freeman/1` | Peter Freeman | `players/P/Peter_Freeman.html` | Peter Freeman | 1991 National | 0/0 | 1988-1990 / 5 / 0 | non_sample (non_sample) | bridged | 1 |
| `https://www.draftguru.com.au/players/peter_whyte/1` | Peter Whyte | `players/P/Peter_Whyte.html` | Peter Whyte | 1990 National | 0/0 | 1986-1988 / 22 / 3 | originally_sampled (random) | bridged | 1 |
| `https://www.draftguru.com.au/players/rodney_gladman/1` | Rodney Gladman | `players/R/Rodney_Gladman.html` | Rodney Gladman | 1989 Pre-Season | 0/0 | 1987-1987 / 1 / 0 | non_sample (non_sample) | bridged | 1 |
| `https://www.draftguru.com.au/players/simon_taylor/1` | Simon Taylor | `players/S/Simon_Taylor0.html` | Simon Taylor | 1991 Pre-Season | 0/0 | 1989-1989 / 2 / 1 | originally_sampled (random) | bridged | 1 |
| `https://www.draftguru.com.au/players/tim_bourke/1` | Tim Bourke | `players/T/Tim_Bourke.html` | Tim Bourke | ? (not captured) | 0/0 | 1989-1990 / 5 / 0 | originally_sampled (random) | bridged | 1 |
| `https://www.draftguru.com.au/players/tony_furey/1` | Tony Furey | `players/T/Tony_Furey.html` | Tony Furey | 1988 Pre-Season | 0/0 | 1983-1985 / 41 / 29 | non_sample (non_sample) | bridged | 1 |

All 23: `recommended_disposition = exclude_from_bridge`; `operator_verdict` blank. Contradiction reason (all 23): `ZERO_GAME_DRAFTEE_RESOLVES_TO_RETIRED_NAMESAKE` -- DraftGuru records 0 games for the entry, the captured href resolves to a retained target whose career (`career_games > 0`) ended before the entry's earliest original recruitment year.

- 7 of 23 were in the original Phase 3 review sample (all in the **random** stratum, 0 in census): `bret_hutchinson/1`, `craig_somerville/1`, `david_williams/1`, `glen_bartlett/1`, `peter_whyte/1`, `simon_taylor/1`, `tim_bourke/1`
- 16 of 23 were discovered only by this population scan (non-sample): `andrew_krakouer/1`, `bradley_sparks/1`, `chris_o'dwyer/1`, `darren_williams/1`, `david_sullivan/1`, `gary_keane/1`, `ian_rickman/1`, `john_ahern/1`, `john_peter-budge/1`, `mark_mcleod/1`, `mark_pitura/1`, `nathan_irvin/1`, `paul_mifka/1`, `peter_freeman/1`, `rodney_gladman/1`, `tony_furey/1`

## 4. Suspected source mislinks (2) -- recommend withhold pending operator confirmation

| DraftGuru URL | Captured href | Retained target | DG birth yr / target birth yr | DG games | Target span/games | Reason | Sample | Child | Picks |
|---|---|---|---|---|---|---|---|---|---|
| `https://www.draftguru.com.au/players/adrian_deluca/1` | `players/A/Adrian_De_Luca.html` | Adrian De Luca | 1982 / 1982 | 46 | 2004-2006 / 46 | OTHER_CONTRADICTION:SURNAME_DIFFERENT | non_sample | bridged | 1 |
| `https://www.draftguru.com.au/players/setanta_%C3%B3%20hailp%C3%ADn/1` | `players/S/Setanta_OhAilpin.html` | Setanta OhAilpin | 1983 / 1983 | 88 | 2005-2013 / 88 | OTHER_CONTRADICTION:SURNAME_DIFFERENT | non_sample | bridged | 2 |

Both rows are flagged only by `OTHER_CONTRADICTION:SURNAME_DIFFERENT` with birth year, debut timing, games and club overlap all agreeing -- almost certainly the same real player (Adrian De Luca; Setanta Ó hAilpín) misflagged by a surname-tokenisation gap on a compound/diacritic surname (`De Luca` vs `Deluca`; `Ó hAilpín` vs `OhAilpin`/URL-encoded `%C3%B3%20hailp%C3%ADn`), not a genuine mislink. Neither is sampled. Recommended disposition: `manual_curation` (withhold pending operator confirmation, NOT exclusion). `operator_verdict` blank for both.

## 5. Same-person discrepancies (7) -- recommend `manual_curation`

| DraftGuru URL | Captured href | Corrected identity candidate | DG games | Clubs | Sample | Child | Picks |
|---|---|---|---|---|---|---|---|
| `https://www.draftguru.com.au/players/aaron_black/1` | `players/A/Aaron_Black.html` | `players/A/Aaron_Black0.html` | 57 | Geelong, North Melbourne | non_sample | target_not_registered | 2 |
| `https://www.draftguru.com.au/players/alwyn_davey/1` | `players/A/Alwyn_Davey.html` | `players/A/Alwyn_Davey0.html` | 100 | Essendon | non_sample | target_not_registered | 1 |
| `https://www.draftguru.com.au/players/joel_smith/1` | `players/J/Joel_Smith.html` | `players/J/Joel_Smith0.html` | 221 | Hawthorn, St Kilda | census | target_not_registered | 2 |
| `https://www.draftguru.com.au/players/josh_smith/1` | `players/J/Josh_Smith.html` | `players/J/Josh_Smith0.html` | 11 | North Melbourne | random | target_not_registered | 1 |
| `https://www.draftguru.com.au/players/sam_butler/1` | `players/S/Sam_Butler.html` | `players/S/Sam_Butler0.html` | 166 | West Coast | non_sample | target_not_registered | 1 |
| `https://www.draftguru.com.au/players/stephen_schwerdt/1` | `players/S/Steven_Schwerdt.html` | `players/S/Stephen_Schwerdt.html` | 25 | Adelaide, West Coast | random | target_not_registered | 2 |
| `https://www.draftguru.com.au/players/tom_murphy/1` | `players/T/Tom_Murphy.html` | `players/T/Tom_Murphy0.html` | 113 | Gold Coast, Hawthorn | random | target_not_registered | 2 |

Known numbering/spelling cases: `tom_murphy/1`, `joel_smith/1`, `josh_smith/1`, `stephen_schwerdt/1`. The other three (independently rediscovered by the same evidence-gated probe, same corroboration bar): `aaron_black/1`, `alwyn_davey/1`, `sam_butler/1`.

Why these cannot be auto-admitted under the current href-only contract: the corroborated alternate identity was found by a bounded, evidence-gated *probe* (numeric-suffix or visible-name-spelling candidate, requiring name + birth-year + ≥1 games/debut/span signal, plus club overlap for a numeric-suffix candidate) rather than the captured href itself resolving correctly -- D-9 forbids promoting on name/identity equality alone, and the contract's authority chain is the captured href, not a downstream inference. All 7: `recommended_disposition = manual_curation`; `operator_verdict` blank.

## 6. Insufficient evidence (107) -- grouped

| Reason | Count | Target-registered | Target-unregistered | Positive games | Zero games | Census | Random | Non-sample | Pick rows | Recommended |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `TARGET_NOT_REGISTERED_NO_EVIDENCE` | 94 | 0 | 94 | 94 | 0 | 11 | 13 | 70 | 98 | withhold |
| `OFFLINE_LIMITED` | 13 | 13 | 0 | 12 | 1 | 2 | 0 | 11 | 20 | withhold |

Total: 107 (= 107). Default recommendation: **withhold unless retained evidence satisfies the approved contract.** Neither group is called "registration lag" here without retained proof -- `TARGET_NOT_REGISTERED_NO_EVIDENCE` means no corroborated alternate identity was found under the same bar §5 requires, not that the player will register later; `OFFLINE_LIMITED` means the offline evidence (profile/Stage A capture) was too thin to reach `offline_strong` or `offline_contradict`, independent of registration. Full 107-row detail (per-row facts, blank `operator_verdict`): `bridge-population-scan-decision-pack-20260918-v1.csv`/`.json` and the source `bridge-population-scan-20260918-v1.csv`/`.json`.

## 7. Human-authority overlap (3)

| DraftGuru URL | Ledger status | Retained target | Sample | Picks |
|---|---|---|---|---:|
| `https://www.draftguru.com.au/players/matt_rendell/1` | `linked_agreeing` | Matthew Rendell | non_sample | 1 |
| `https://www.draftguru.com.au/players/nathan_fyfe/1` | `linked_agreeing` | Nat Fyfe | non_sample | 1 |
| `https://www.draftguru.com.au/players/ryan_o'keefe/1` | `linked_agreeing` | Ryan OKeefe | non_sample | 1 |

All 3 (`matt_rendell/1`, `nathan_fyfe/1`, `ryan_o'keefe/1`) carry an existing human ledger decision (`linked_agreeing`) that retained evidence does not contradict. The human decision remains controlling; these 3 are **excluded from every net-new bridge count** in this pack (they are already resolved via the human ledger, not the bridge). Recommended disposition: `retain_human_authority`. `operator_verdict` not required by the runbook for this category.

## 8. Projection scenarios

### 8.1 Scenario A -- remove 23 confirmed mislinks only

| Metric | Baseline (current) | Scenario A |
|---|---:|---:|
| Net-new bridge rows | 3460 | 3437 |
| Bridged rows | 3463 | 3440 |
| Unresolved persons | 1592 | 1615 |
| Bridge-covered picks | 5101 | 5078 |
| Unresolved picks | 1704 | 1727 |
| National top-10 picks | 389/420 | 389/420 |
| National top-10 persons | 387/418 | 387/418 |

unchanged -- 0 of the 23 confirmed are in the census stratum (top-10 population).

### 8.2 Scenario B -- conservative proposed import set (population_clean only)

| Metric | Baseline (current) | Scenario B |
|---|---:|---:|
| Net-new bridge rows | 3460 | 3422 |
| Bridged rows | 3463 | 3425 |
| Unresolved persons | 1592 | 1630 |
| Bridge-covered picks | 5101 | 5055 |
| Unresolved picks | 1704 | 1750 |
| National top-10 picks | 389/420 | 387/420 |
| National top-10 persons | 387/418 | 385/418 |

Withholds: 23 confirmed + 2 suspected + 7 same-person discrepancies (manual curation) + 107 insufficient_evidence. The 3 human-authority overlaps are preserved outside the net-new count (bridged rows 3425 = net-new 3422 + 3). 2 currently-bridged national top-10 census person(s) additionally withheld (https://www.draftguru.com.au/players/keith_thomas/2, https://www.draftguru.com.au/players/tim_walsh/1), each holding exactly 1 affected pick per retained evidence; 0 of the 23 confirmed / 2 suspected / 7 discrepancy rows are in the census stratum.

### 8.3 Scenario C -- hypothetical, after potential manual curation (NOT approved)

**Hypothetical only -- not an approved or recommended scenario.**

| Metric | Scenario B | Scenario C (hypothetical) |
|---|---:|---:|
| Net-new bridge rows | 3422 | 3429 |
| Unresolved persons | 1630 | 1623 |
| Bridge-covered picks | 5055 | 5066 |
| Unresolved picks | 1750 | 1739 |

Basis: Scenario B plus successful manual curation of all 7 source_discrepancy_same_person rows. Suspected and insufficient rows: remain withheld, unchanged from Scenario B. 1 of the 7 discrepancy rows (joel_smith/1) is in the census stratum but was ALREADY target_not_registered (not part of the current 387/389 baseline), so successful curation would be a net gain of at most 1 top-10 person/pick over Scenario B, not a restoration of a loss.

## 9. Sample and statistical impact

- Confirmed mislinks by sample bucket: census 0, random 7, non-sample 16.
- Suspected by bucket: census 0, random 0, non-sample 2.
- Same-person discrepancy by bucket: census 1, random 3, non-sample 3.
- The original 598-row random selection (salt `AFLDB-ISSUE-222/v1`) remains retained as historical evidence, unmodified, and is **not** redrawn or topped up by this pass.
- Reviewed clean-survivor count across the full 997-row sample (both strata, removing confirmed + suspected + discrepancy rows found within it): **986**.
- Random-stratum observed failures within n=598: 7 confirmed mislinks (1.171% observed rate) plus 3 same-person discrepancies -- **not** a zero-failure draw.
- **NOT VALID AS STATED -- the original O-3 claim of a zero-observed-failure bound on n=598 presupposed 0 failures; the Phase 3 sample review that prompted this population scan actually found 7 confirmed_source_mislink rows plus 3 source_discrepancy_same_person rows within the random stratum, so the n=598 draw was NOT a zero-failure sample for the mislink mechanism**
- Recalculated zero-failure bound on the 588 random-stratum clean survivors (removing the 7 confirmed + 3 discrepancy rows found within it): **0.508%** (`1 - 0.05^(1/588)`), materially unchanged from the original 0.5% claim in absolute terms, but its statistical meaning has changed:
  Statistically valid ONLY as a residual bound on further-undiscovered failure MODES beyond the 23 confirmed_source_mislink signature, which this pass's population scan already resolved exhaustively (a census, not a sample, for that specific signature) across all 3,564 candidates. It is not needed to bound the confirmed-mislink rate itself, which is now known exactly (23/3564 = 0.645%, exhaustive).

**Governance rule applied: no redraw, replacement or top-up decided in this pass; all sampled failures are preserved.** Recommendation for independent review, not a decision:

> Present for independent review, not decided here (governance rule): the random stratum was not a zero-failure draw as originally assumed, but the population scan has since exhaustively resolved the specific mechanism found. Whether an independent-salt v2 redraw or top-up is still warranted to bound OTHER undiscovered failure modes is an operator/independent-review decision (runbook Sec.7 item 9), not decided in this pass.

## 10. Minimal operator decision table

| # | Decision | Operator verdict |
|---|---|---|
| 1 | Approve excluding all 23 `confirmed_source_mislink` rows (`exclude_from_bridge`)? |  |
| 2 | Approve withholding the 2 `suspected_source_mislink` rows pending operator confirmation? |  |
| 3 | Approve routing the 7 `source_discrepancy_same_person` rows to manual curation? |  |
| 4 | Approve withholding all 107 `insufficient_evidence` rows under Scenario B? |  |
| 5 | Approve retaining human authority for the 3 `human_authority_overlap` rows (outside the net-new count)? |  |
| 6 | Is Scenario B (3,422 net-new, population_clean only) the basis for a future bridge v2 dataset? |  |
| 7 | Is an independent (Fable) review required before any bridge v2 generation? |  |
| 8 | Sample redraw/top-up policy -- retain as-is / independent-salt v2 redraw / top-up (deferred to independent review per governance rule)? |  |

All `operator_verdict` cells above are intentionally blank. No `operator_verdict` has been set on any row of the underlying artefacts by this pass. Phase 3 remains **PENDING**; Phase 4 is **unauthorised**.

## 11. Confirmations

- All 3,564 parent bridge candidates reconciled; every category mutually exclusive; totals sum exactly to 3,564 (verified programmatically, see build script assertions).
- No `operator_verdict` set anywhere in this pack or the underlying artefacts.
- No network request, database connection, SSH tunnel, Playwright session, import/link action, exporter run, Git command, or DEV/PROD/deployment action occurred while producing this pack.
- Parent, child and sample files were read-only inputs; none were modified.
- No bridge v2 dataset was generated.
- Phase 3 remains **PENDING** operator sign-off. Phase 4 has not begun.
