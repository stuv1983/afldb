# Remediation run 4 — failure ledger (integration, executable revision Q″ `1f7b0d717b37e98432716d6b9170fbd45142ab63`)

Every failing integration id in the four PLAN-REVIEW-4 F-009 cells at Q″ has exactly one class (`../run4/AGENT-BRIEF-COMMON-4.md` §4:
1 passes under intended conditions, 2 actual defect, 3 stale assertion, 4 deliberate refusal, 5 limitation awaiting the owner, 6 not run).
Machine-readable: `FAILURE-LEDGER-4.tsv` (50 rows: cell, comparison baseline, gone/new/continuing status, file, test, class, basis, first
failure line). Raw per-cell lists and the gone/new/continuing TSVs: `qualification-4/{s_pf,r_pf,r_sh,s_sh}/*-failures.tsv`, `qualification-4/cmp/`.
The fix-loop revision Q‴ changed one integration file (`club-comparison`, which passes in every cell at Q″ and is re-run at Q‴ in
`fixloop/README.md`); no id below is affected by it. **Continuity is not correctness:** a "continuing" id carries its own class and basis.

## Counts

| Cell (base × `AFLDB_TEST_PER_FILE_DB`) | Baseline | Baseline ids | Failing ids at Q″ | Tests failed / passed | Gone | New | Continuing |
|---|---|---|---|---|---|---|---|
| S-PF snapshot × `all` | run 3 Q′ (`run3/qualification-3/integ-failures.tsv`) | 46 | **18** (15 tests + 3 file-level) | 15 / 3,518 | 31 | 3 | 15 |
| R-PF rebuild × `all` | B4 C1 | 73 | **7** (4 + 3 file-level) | 4 / 3,529 | 66 | 0 | 7 |
| R-SH rebuild × shared | B4 C2 | 73 | **7** | 4 / 3,529 | 66 | 0 | 7 |
| S-SH snapshot × shared | B4 C3 | 46 | **18** | 15 / 3,518 | 31 | 3 | 15 |

Shared mode now fails exactly the ids per-file mode fails, on both bases (`qualification-4/cmp/cmp-*-sh-vs-*-pf-at-Qpp.tsv`): the
T363-2/T363-3 cross-file effects and the B4 shared-mode leaks are gone. Shared-mode residue after a full run: rebuild `import_batches`
27 → 149 only; snapshot `import_batches` 75 → 197 and `award_winners` +1 (see RESIDUALS-4 R4-08).

## Classes at Q″

| Class | Snapshot cells (each) | Rebuild cells (each) | Ids |
|---|---|---|---|
| 1 passes under intended conditions | 17 | 4 | OD-5 `settle-afl-api` (74/74 on an `afldb_v2_rb_*_test` clone of both bases); the three dedicated-clone file-level refusals (`v2-brownlow-eligibility-2025-rehearsal` 3/3, `v2-brownlow-production-correction` 8/8, `v2-coleman-publication` 28/28 on schema-only); snapshot only: `admin-brownlow` P2, `data-editor` ×5, `draft-linkage` ×2, release-gates Brownlow authority and "remaining players", and the three 363-B birth-date pins (new against run 3, pre-registered) — all pass on the accepted rebuild |
| 5 limitation awaiting the owner | 1 | 3 | Gridley: snapshot "no failing cells" (run 3 N7); rebuild ×3 (clubcmp F-CC-4: the standard rebuild reproduces 0 `data_overrides` versus the snapshot's 165, and 64 GAP-029 `match_event` labels) |
| 2, 3, 4, 6 | 0 | 0 | — |

No failing id is an unexplained defect. The 3 "new" snapshot ids are the release-gates birth-date gates re-pinned to the accepted rebuild
under owner decision 363-B (`gates` scope, `6778a4ec`); PLAN-REVIEW-4 F-009 pre-registered them.

## What went, by file (full id lists in `qualification-4/cmp/`)

- **S-PF vs run 3 (31):** club-comparison 24 (363-W, `clubcmp`), release-gates 6 (363-W/G/B, `gates`), awards-reload-links file-level
  (363-C, `coleman276`). S-SH vs B4 C3 (31): the same set.
- **R-PF vs B4 C1 (66):** club-comparison 26, release-gates 9, nl-answers-relationships 11, nl-answers-cross-domain 6,
  nl-answers-first-kick-goal 4, nl-answers-after-siren 3, admin-season-lists 2, nl-answers-coaching 1, awards-reload-links 1,
  settle-afl-api-state-b 1, special-records-lifecycle 1, special-records-public-suppression 1 (`clubcmp`, `gates`, `rbfail`, `shared`,
  `coleman276`, `fixup`).
- **R-SH vs B4 C2 (66):** as R-PF except state-b and special-records-lifecycle (which passed in C2 only because another file leaked an
  administrator) and one admin-season-lists id; plus afl-api-c7-observation 3 (`leaks` `match-admin-delete` fix and orchestrator
  `581a898b`, the `awards_last_season_fkey` residue of awards-reload-links).
