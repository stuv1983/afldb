# AFLDB-ISSUE-222 -- population-scan operator decision pack (20260918-v2, corrected)

**Phase 3 remains PENDING.** This pack **supersedes** `bridge-population-scan-decision-pack-20260918-v1.{md,csv,json}`, which is **preserved unmodified as superseded evidence** and never overwritten. It decides nothing, imports nothing, generates no bridge v2 dataset, and sets no `operator_verdict`. All figures are computed directly from the retained, immutable corrected population-scan JSON (`bridge-population-scan-20260918-v2.json`, 3,564 rows, `rows_sha256=ad134d1447b10b6a9880e14507be6d88da8001659b69ab996d91580cbb64908f`) and the immutable 997-row review sample (`bridge-review-20260918-v1.json`). No network, database, import, Playwright, or Git action was taken to produce it.

## 0. What changed from v1, and why

An independent (Fable 5.1) statistical review found the v1 pack's `confirmed_source_mislink`
outcome (23 rows) and every claim built on it invalid:

- DraftGuru's per-entry `games` figure records games **following that specific listing event**,
  not the person's career games, so a `0` proves nothing about whether the person ever played.
- Stage A's own listed age at the event agrees with the retained target's birth year on every one
  of the 23 rows -- evidence *for* the same person, not against.
- 21 further rows the v1 scanner called `population_clean` share the identical shape (zero
  per-entry games; retained target's real career already ended) and differed from the 23 only in
  whether the retained career's `last_season` equalled the listing year or was exactly one year
  earlier -- an arbitrary boundary in the v1 scanner's strict `<` comparison, not a real
  distinction.

The corrected scanner (`tools/rebuild/draftguru/scan_person_bridge_population.py`, v2.0.0) removes
`confirmed_source_mislink` and reports the union of both groups (44 rows) as the single neutral
outcome **`relisting_signature_review`** -- requiring operator adjudication, never a confirmed
mislink, never automatically safe. The v1 pack's `~0.51%`/`588`-clean-survivor statistical claim is
**withdrawn** separately (§9 below) -- that defect existed even under the withdrawn v1 labels and
is independent of the classification fix.

## 1. Executive summary

- All 3,564 parent bridge candidates are reconciled into 7 mutually exclusive population outcomes; totals sum exactly to 3,564 (verified programmatically).
- `target_not_registered` (101 child rows) still decomposes **exactly** as 94 `insufficient_evidence` + 7 `source_discrepancy_same_person` = 101 (unchanged from v1 -- this decomposition never depended on the withdrawn classification).
- **44 `relisting_signature_review` rows** recommend `operator_adjudication_required`: 23 were labelled `confirmed_source_mislink` by the withdrawn v1 scanner (7 originally-sampled random-stratum, 16 non-sample), and 21 were labelled `population_clean` by v1 (4 random-stratum, 17 non-sample). 0 are in the national top-10 census stratum.
- 2 `suspected_source_mislink` rows (`adrian_deluca/1`, `setanta_ó hailpín/1`) unchanged from v1 -- flagged only by a surname-tokenisation limitation; recommendation: withhold pending operator confirmation, NOT exclusion.
- 7 `source_discrepancy_same_person` rows unchanged from v1 -- numbering/spelling cases; recommendation: route to manual curation, not auto-admit.
- 107 `insufficient_evidence` rows (94 `TARGET_NOT_REGISTERED_NO_EVIDENCE` + 13 `OFFLINE_LIMITED`) unchanged from v1 -- default to withhold; none may be called registration lag without retained proof.
- 3 `human_authority_overlap` rows unchanged from v1 -- existing human ledger decision retained.
- The v1 pack's `0.50%`/recalculated `0.508%` zero-failure-bound claims are **withdrawn** for two independent reasons (§9): circularity, and an arithmetic error in the "588" denominator that never subtracted 13 `insufficient_evidence` rows from 598. **No formal residual-error bound exists.**
- **This pass does not exclude anything from the bridge.** The current baseline (3,460 net-new bridge rows, 389/420 top-10 picks, etc.) is **unchanged** -- exclusion of any relisting-signature, suspected, or discrepancy row is an operator decision this pack does not make.

## 2. Reconciliation cross-tabulations (all 3,564 rows)

### 2.1 Population outcome (mutually exclusive, sums to 3,564)

| Outcome | Rows |
|---|---:|
| `population_clean` | 3401 |
| `relisting_signature_review` | 44 |
| `suspected_source_mislink` | 2 |
| `source_discrepancy_same_person` | 7 |
| `insufficient_evidence` | 107 |
| `human_authority_overlap` | 3 |
| `tooling_or_schema_error` | 0 |
| **Total** | **3564** |

### 2.2 Census / random-sample / non-sample membership

| Outcome | Census (399) | Random (598) | Non-sample (2,567) |
|---|---:|---:|---:|
| `population_clean` | 385 | 571 | 2445 |
| `relisting_signature_review` | 0 | 11 | 33 |
| `suspected_source_mislink` | 0 | 0 | 2 |
| `source_discrepancy_same_person` | 1 | 3 | 3 |
| `insufficient_evidence` | 13 | 13 | 81 |
| `human_authority_overlap` | 0 | 0 | 3 |

399 + 598 + 2,567 = 3,564. 0 of the 44 `relisting_signature_review` rows are census rows, so the
existing National Draft top-10 reconciliation (389/420 picks, 92.62%; 387/418 persons, 92.58%) is
**unaffected** by this correction.

### 2.3 `relisting_signature_review` former-label breakdown (proves the 44 = 23 + 21)

| Former v1 label | Count | Census | Random | Non-sample |
|---|---:|---:|---:|---:|
| `confirmed_source_mislink` (withdrawn) | 23 | 0 | 7 | 16 |
| `population_clean` (v1) | 21 | 0 | 4 | 17 |
| **Total** | **44** | **0** | **11** | **33** |

## 3. Relisting-signature rows (44) -- recommend `operator_adjudication_required`

Full per-row detail (identity, event, DraftGuru and retained-target evidence, blank
`operator_verdict`): `bridge-population-scan-decision-pack-20260918-v2.csv`/`.json` and the
dedicated operator-adjudication pack (§10 below), which additionally states each row's Stage A
listed age and birth-year agreement and the allowed three-way verdict set
(`same_person_valid_relisting` / `different_person_wrong_href` / `undetermined_withhold`). Never
`exclude_from_bridge` -- that disposition no longer exists for this class.

## 4. Suspected source mislinks (2) -- unchanged from v1, recommend withhold pending operator confirmation

Unchanged from `bridge-population-scan-decision-pack-20260918-v1.md` §4: `adrian_deluca/1` and
`setanta_ó hailpín/1`, flagged only by `SURNAME_DIFFERENT` on a tokenisation gap
(compound/diacritic surname), every other signal agreeing. `operator_verdict` blank for both.

## 5. Same-person discrepancies (7) -- unchanged from v1, recommend `manual_curation`

Unchanged from v1 §5: `tom_murphy/1`, `joel_smith/1`, `josh_smith/1`, `stephen_schwerdt/1`,
`aaron_black/1`, `alwyn_davey/1`, `sam_butler/1`. `operator_verdict` blank for all 7.

## 6. Insufficient evidence (107) -- unchanged from v1, grouped

| Reason | Count | Recommended |
|---|---:|---|
| `TARGET_NOT_REGISTERED_NO_EVIDENCE` | 94 | withhold |
| `OFFLINE_LIMITED` | 13 | withhold |

Total: 107. Default recommendation unchanged: withhold unless retained evidence satisfies the
approved contract.

## 7. Human-authority overlap (3) -- unchanged from v1

`matt_rendell/1`, `nathan_fyfe/1`, `ryan_o'keefe/1`; human decision remains controlling; excluded
from every net-new bridge count. `operator_verdict` not required by the runbook for this category.

## 8. Baseline (current, unchanged by this classification correction)

| Metric | Current baseline |
|---|---:|
| Net-new bridge rows | 3460 |
| Bridged rows | 3463 |
| Unresolved persons | 1592 |
| Bridge-covered picks | 5101 |
| Unresolved picks | 1704 |
| National top-10 picks | 389/420 |
| National top-10 persons | 387/418 |

This pack excludes nothing from the bridge and generates no bridge v2 dataset. The withdrawn v1
pack's Scenario A/B/C exclusion projections (built on the invalid 23-row exclusion) do not apply.
Any future exclusion is an operator decision, taken only after this pack's and the operator
adjudication pack's rows are adjudicated.

## 9. Sample and statistical impact (corrected)

- **The `0.50%`/recalculated `0.508%`/`~0.51%` zero-failure-bound claims are WITHDRAWN**, for two
  independent reasons:
  1. **Circular.** `population_clean` is defined by exactly the machine rule whose error rate the
     bound purports to measure; a zero-failure count over that category proves nothing about rows
     the same rule might misclassify.
  2. **Arithmetic error, present even under the withdrawn v1 labels.** The v1 pack computed its
     "588 clean survivors" as `598 − 7 (confirmed) − 3 (discrepancy) = 588`, never subtracting the
     13 random-stratum `insufficient_evidence`/`target_not_registered` rows also present in the
     598 -- silently counting them as confirmed-clean survivors. The v1-label random-stratum
     composition was actually **575 `population_clean` + 7 machine-flagged (the withdrawn
     `confirmed_source_mislink`) + 3 `source_discrepancy_same_person` + 13 `insufficient_evidence`
     = 598** -- the TRUE clean-survivor count under those labels was **575, not 588**.
  No formal residual-error bound exists as a result of either defect. The 986 full-sample
  "clean survivor" figure in the v1 pack (§9) is withdrawn on the same basis.
- **Current (corrected) random-stratum breakdown**, descriptive only, no confidence-bound
  interpretation claimed: `population_clean` 571, `relisting_signature_review` 11,
  `source_discrepancy_same_person` 3, `insufficient_evidence` 13 (571+11+3+13 = 598).
- The original 598-row random selection (salt `AFLDB-ISSUE-222/v1`) remains retained as historical
  evidence, unmodified, and is **not** redrawn or topped up by this pass.
- **A future, disjoint, new-salt validation sample is required before any formal residual-error
  bound can be claimed.** Contract (recorded, not generated): salt `AFLDB-ISSUE-222/v2`; target
  population non-census bridge-v2 rows, excluding prior discovery/random rows; ordering
  `sha256(salt + "|" + player_url)` ascending, ties by URL; `n = 598`; bridge v2 must first be
  frozen after operator adjudication of this pack and the operator adjudication pack; sample
  membership and tool hashes frozen before review; any tool/rule change voids the sample and
  requires a new version/salt. **Not generated by this pass.**

## 10. Minimal operator decision table

| # | Decision | Operator verdict |
|---|---|---|
| 1 | Approve routing all 44 `relisting_signature_review` rows to the operator adjudication pack for a `same_person_valid_relisting` / `different_person_wrong_href` / `undetermined_withhold` verdict (no automatic `exclude_from_bridge`)? |  |
| 2 | Approve withholding the 2 `suspected_source_mislink` rows pending manual confirmation? |  |
| 3 | Approve routing the 7 `source_discrepancy_same_person` rows to manual curation? |  |
| 4 | Approve withholding all 107 `insufficient_evidence` rows by default? |  |
| 5 | Approve retaining human authority for the 3 `human_authority_overlap` rows? |  |
| 6 | Is an independent review required before any bridge v2 generation? |  |
| 7 | Sample redraw/top-up policy for a future validation sample: confirm the new-salt/n=598/post-freeze contract in §9, or specify a different one? |  |

All `operator_verdict` cells above are intentionally blank. No `operator_verdict` has been set on
any row of the underlying artefacts by this pass. Phase 3 remains **PENDING**; Phase 4 is
**unauthorised**.

## 11. Related deliverable -- the operator adjudication pack

`docs/rebuild-manifests/draftguru/bridge-operator-adjudication-pack-20260918-v1.{md,csv,json}`
carries the full per-row evidence for the 44 relisting-signature rows plus the 2 suspected
tokenisation rows, the 7 source discrepancies, and the existing 30-row deterministic audit (83 rows
total), each with its own allowed three-way operator verdict set and every field blank. This
decision pack and that adjudication pack are companions -- work them together.

## 12. Confirmations

- All 3,564 parent bridge candidates reconciled; every category mutually exclusive; totals sum exactly to 3,564 (verified programmatically).
- No `operator_verdict` set anywhere in this pack or the underlying artefacts.
- No network request, database connection, SSH tunnel, Playwright session, import/link action, exporter run, Git command, or DEV/PROD/deployment action occurred while producing this pack.
- Parent, child, sample, and every v1 population-scan/decision-pack artefact were read-only inputs or preserved unmodified; none were overwritten.
- No bridge v2 dataset was generated. No v2 validation sample was generated.
- Phase 3 remains **PENDING** operator sign-off. Phase 4 has not begun.
