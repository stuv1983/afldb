# V2-GAP-029 — production-scope reconciliation (2026-11-03)

**Status: classification complete; one cause demonstrated and ready to close on a clone; GAP-029 stays OPEN.** Nothing was applied to
DEV or PRODUCTION. Authority used: scoped local commands, read-only Git, disposable isolated clones, one local commit. No push, no
host access, no provider acquisition, no retained-baseline modification.

Machine-readable counterpart: [`evidence/gap-029-production-scope-2026-11-03.json`](evidence/gap-029-production-scope-2026-11-03.json).

## 1. Two evidence sets, one name

| | Accepted baseline | Production-derived |
|---|---|---|
| Database | `afldb_test` rebuild (`afldb_v2_gap029_test`) | restore of the checksum-verified production backup (`afldb_v2_gap029_prod_test`) + the 64 labels (`…_prodev_test`) |
| Latest season | 2025 (no 2026 matches) | 2026 (218 matches to 2026-09-26) |
| `draft_picks` linked / total | 5,123 / 6,818 | **5 / 6,810** |
| `captaincies` | 1,781 | **1,774** |
| Strict / approved / unapproved | 149 / 99 / 50 (42 event + 8 dated membership) | 433 / 99 / 334 (after labels) |
| Source of the count | accepted 2026-10-20, reproduced key for key on Linux 2026-10-28 | one diagnostic run, 2026-11-01 |

The two counts are **not comparable** and neither supersedes the other. Re-running a baseline-like clone today (labelled data, 2025 only)
gives 107 strict / 99 approved / 8 unapproved (the eight dated-membership dataset gaps), unchanged from the 2026-11-01 record, so the
corpus edit in §6 changes nothing there. The 334 are what is **different about the production data**, not a regression of the baseline.

## 2. Classification of the 334 production-derived unapproved findings

| Group | Cells | Class | Cause (evidence) | State |
|---|---:|---|---|---|
| Draft / trade dataset gap (`pick1` 11, `picktop5` 15, `picktop10` 228, `pickrookie` 9, `traded1` 15, `freeagent1` 3) | 281 | **missing data on production; owner policy** | The corpus probe sets `draftLinks=false` when under half of `draft_picks` is trusted-linked. Production has 5 of 6,810; the baseline has 5,123 of 6,818 (the ISSUE-222 DraftGuru bridge plus 8 audited manual rookie selections). Every other gap flag is true on production, so this is the only gate. ISSUE-222 recorded "PROD remains out of scope and untouched"; no later record promotes it. Board years 2023: 80, 2024: 87, 2025: 78, 2026: 36 | **Owner decision D2** |
| Captain known answer (`incorrect known answer`) | 20 | **missing data on production** | Production lacks the seven AFLDB-ISSUE-225 co-captain rows that the tracked `data/awards/captaincies.csv` (1,781 rows) carries. The Cameron Bruce adjudication is therefore reported STALE (`trusted_captaincies:` empty against the recorded `Melbourne=2008`) and his 2026 captain cells fall back to `incorrect known answer` | **Demonstrated closed on a clone (§3); owner decision D1** |
| Sibling source coverage gap (`has_brother`) | 33 | **stale expectation + missing relationship evidence** | All on 2026 boards (2026-01-21 to 2026-08-03). On the baseline every 2026 board was routed to `time of board` because the board year exceeded the maximum season (2025). Production holds 2026, so the cells are judged on each player's final season and surface. No brothers row exists for these players in either database | Lyons 11: **D3**. McGovern 14, Webster 8: **D4** |

Reproducible query/application defects found: **none**. Every group is a data-scope difference or an evidence question. The solver, the
query builders and the classification chain behaved as designed; no cell exceeded one second and no timeout recurred (the clone was
`ANALYZE`d first, as the 2026-11-01 operational note requires).

### 2.1 Draft cells: what is and is not established

- Established: the 281 are exactly the cells whose axis uses a draft builder; the corpus never compares them while `draftLinks` is false, so
  they say nothing about whether the draft answers are right. They say production cannot answer draft criteria.
- Not established: how many draft-criterion disagreements would appear once production is linked. On the baseline there are **zero**
  draft-criterion cells (ISSUE-222 evidence), but the production population and the 2026 boards are different. That is only knowable by
  running the link-only bridge against a production-derived clone, which needs a bridge dataset bound to that target (the tracked
  bridges are per-target: `…v1/v2/v3` for `afldb_test`/`afldb_dev`) and is the first step of D2, not something to improvise here.
- User-visible effect: draft-axis squares and draft-based answers on production work from 5 linked picks. Grid Solver is `super_admin`
  only on production, which limits exposure; NL draft questions are not assessed here.

### 2.2 Sibling cells by player

| AFLDB player | Cells | Boards (2026) | Evidence held |
|---|---:|---|---|
| 6818 Jarryd Lyons (final season 2024) | 11 | 920, 964, 990, 1015, 1073, 1109, 1114 | The same Corey Lyons evidence as the 21 approved cells (`data/reference/gridley-sibling-eligibility-evidence.json`: club and league record no senior AFL appearance). The 11 are not enumerated in the approval |
| 6937 Jeremy McGovern (2025) | 14 | 920, 929, 964, 990, 1009, 1015, 1073, 1109, 1114 | none |
| 7271 Jimmy Webster (2025) | 8 | 920, 929, 964, 990, 1073, 1109 | none |

No relationship was inferred for McGovern or Webster. Exact cell lists are in the JSON.

## 3. Demonstration: the captain cause (disposable clone `afldb_v2_gap029_cap_test`)

Created `--template` from `afldb_v2_gap029_prodev_test`, then `tools/migration/import_awards.py --groups captaincies` (the rebuild's own
loader for this group) through the guarded launcher, then `ANALYZE`.

| Check | Result |
|---|---|
| Rows | 1,781; set equals the baseline set on `(season, club, player, name, role, period)` with **0 missing, 0 extra, 0 production rows lost** |
| The seven rows | 2008 Melbourne Cameron Bruce and James McDonald (co-captains, rounds 6-22); 2017 and 2018 Gold Coast Steven May; 2019, 2020 and 2021 Gold Coast Jarrod Witts. Source keys and the CSV lines are in the JSON; provenance is the existing AFLDB-ISSUE-225 co-captaincy review |
| Corpus, production-derived + captaincies | strict 433 → **413**; unapproved 334 → **314**; `incorrect known answer` 20 → **0**; no new unapproved category. Informational categories re-resolve because Bruce and the other co-captains now exist: `time of board` 22,891 → 22,860, `adjudicated key disagreement` 17 → 54 (the existing D4/D10 record is current again), `list membership` 1,222 → 1,223; every other category count is unchanged |
| Remaining unapproved | 314 = 281 draft/trade + 33 sibling |

The loader is a group **reload** and the table has no audited V2 writer, so this is a demonstration of cause, not a production entry
point. A production change would be an additive, key-guarded insert of exactly these seven rows under its own plan, backup and approval.

## 4. What the earlier 149/99/50 items look like now

| Baseline item | Production-derived status |
|---|---|
| 42 match-event cells | **Closed on production data** by the 64 labels (Block L, applied and verified 2026-11-02); effect on public pages (ISR) still unverified |
| 8 dated-membership cells | Not unapproved on production data (2026-11-01 §10); classified, not defects |
| 78 unsupported (accepted deferrals) | Unchanged; strict findings by definition |
| 21 approved sibling disagreements | Unchanged; approved, 0 data matches |

## 5. Owner decisions (smallest set, each independent)

- **D1 — captaincy delta.** Approve a separately reviewed additive load of the seven co-captain rows to production (closes the 20; no
  other cell moves), **or** accept the 20 as a known production-data difference. Either way the Bruce adjudication stays STALE on
  production until the rows exist.
- **D2 — production draft linkage.** Choose one: (a) commission a production draft-link promotion package (target-bound bridge, link-only
  import, 8 manual rookies, own plan, backup and approval; expected to close up to 281 cells and expose any draft disagreements for
  adjudication); (b) accept production draft linkage as a recorded limitation and approve a bounded, enumerated deferral manifest for the
  281 cells (a new deferral class, same pattern as the 78); or (c) leave unchanged and open.
- **D3 — Lyons on 2026 boards.** Extend the existing approval to the 11 enumerated 2026-board Lyons cells (same Corey Lyons evidence, same
  `games > 0` rule), or leave them unapproved.
- **D4 — McGovern and Webster.** Supply or authorise acquisition of sibling-pair evidence for the 22 cells (source request §3 in
  [gap-029-source-requests.md](gap-029-source-requests.md)), or accept them as source coverage gaps.
- **D5 — what closes GAP-029.** Strict parity cannot reach zero (78 accepted deferrals and 21 approved disagreements are strict by
  definition), and no written close condition exists for a production-scope run. State whether closure means "every unapproved
  difference is fixed, approved or deferred on the production-derived database" and which database is the reference.

GAP-029 is **not closed**: D1-D5 are open, the 281 and 33 are unapproved, and closure criteria are not written.

## 6. Local change

`tests/integration/gridley-corpus.test.ts`: the written report gains a `scope` block (database name, maximum season, `draft_picks` total and
linked, captaincies, labelled matches, probe counts and gap flags). Additive and diagnostic: no assertion reads it, no expectation or
threshold changed. Verified: `tsc --noEmit` exit 0; `gridley-compat` + `v2-gap029-label-checks` 63/63; corpus on the baseline-like clone
unchanged (107 strict / 8 unapproved); corpus on the captaincy clone as in §3. The corpus suite's two diagnostic-mode failures on
production-derived data are the standing strict and policy gates and remain failing by design.

## 7. Disposable state

`afldb_v2_gap029_cap_test` (created today, marked) on the isolated cluster; scratch outputs under the session scratchpad. Nothing was dropped
or cleaned. The retained 2026-11-01 report (`D:\tmp\gap029-corpus\`) was only read.
