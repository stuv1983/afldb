# AFLDB-ISSUE-336 — draft categories: evidence (2026-11-05)

Branch `claude/issue-336-draft-categories` (local, not pushed): `036c31c0` (implementation), `3a130595` and `e747d96b` (rehearsal writer fixes), `9f903367` (records),
`d4070e7c` (lint fix), `dc55bdd1` (seal inventory), then this update. Base `eec192f2`. Production, DEV and the live DEV database were not touched.

## 1. Root cause

The stored data was already right. `draft_picks.draft_kind` is the canonical category (ten kinds,
`data/reference/draftguru-event-kinds.json`), `draft_type` is the source's display label (keeps the
`National` / `National Draft` split that the kind collapses), `pick_number` is the source's `# ↧` selection
number within the category (blank, never 0, for Trade/Free Agency/Pre-Draft/Post-Draft), and `signing_kind`
holds the signing mechanism (`Father-Son`, `Academy`, ...). Information was lost only in presentation:
`/draft/[year]` ordered every category by one `pick_number` sequence and showed `draft_type` in a muted column,
so National pick 1 and Rookie pick 1 sat together as equal "1"s; `signing_kind` was not shown anywhere public; the
player page showed a bare pick number. No schema migration is needed.

## 2. Source inventory (owner CSVs, read-only; hashes in `csv-inventory.txt`)

35 files, 1991–2025, **5,966 rows**; 33 files with `Signing`, 1997/1998 with `Detail`. 8,118 NBSP, 6,504 ZWSP, no
BOM; three names carry CSV-side mojibake (`Setanta Ã“ hAilpÃ­n`, `CiarÃ¡n …`, `Red Ã“g Murphy`), repaired for
matching only. Categories: National 2,586, Rookie 1,209, Trade 946, Pre-Season 379, Pre-Draft 317, Mid-Season 198,
Post-Draft 188, Free Agency 138, Mini-Draft 4, Training Squad Selection 1. `Pick` holds only notes (Priority,
Compensation …; 101 rows); the numeric selection is always `# ↧` (float-formatted). Trade, Free Agency, Pre-Draft
and Post-Draft never carry `# ↧`. No duplicate (year, category, `# ↧`). Father–Son: National 82, Pre-Draft 19,
Rookie 8. Signing heads include **`Intl Schol` (32)**, absent from the closed vocabulary.

## 3. Reconciliation against the 2026-11-04 production dump (restored on an isolated `_test` cluster)

`reconcile-before.txt`: stored 6,818 rows (6,810 DraftGuru + the 8 GAP-029 manual rookie picks, 8 active
overrides). In 1991–2025: 5,931 DraftGuru rows, **5,931 matched, 0 stored rows unmatched, 35 CSV rows missing**
(all Pre-Draft, 2008–2025: 32 `Intl Schol`, 2 `International`, 1 `Unregistered`). On the 5,931 matched rows,
category label, pick number, pick note, club and signing agree exactly; `original_club_raw` differs on **187 rows**
(DraftGuru has since revised origin paths; report-only, not repaired). Fred Rodriguez = stored 2025 Rookie #1 West
Coast; Willem Duursma = 2025 National #1 West Coast; Nick Daicos = 2021 National #4, `Father-Son`.

## 4. Bounded repair, prepared and rehearsed only on the isolated clone

`predraft-insert-plan.json` (sha256 `6a207cfe…11cb`): the 35 rows with DraftGuru person URLs taken from the live
year pages (fetched 2026-11-05, page sha256s in the plan), parsed by the repository's own fail-closed parser; the 11
pages' row totals equal the CSV totals. Writer `tools/v2/issue336-predraft-insert.ts` at `e747d96b` (since replaced, see §6; isolated `_test` targets
only). Rehearsal on `afldb_v2_i336app_test` (`q-q5_db.log`): refused without decision D-336-1; dry run rolled back;
apply committed **35 picks, 31 new unmatched persons, 4 existing persons reused by URL** (2 already linked: player
8331, 5867); every pre-existing `draft_picks`/`draft_persons` row and every draft override byte-identical; re-run
refused on the reload key. After (`reconcile-after-rehearsal.txt`): 5,966 = 5,966, 0 unmatched either side, 0
per-(year, category) differences; GAP-029's 8 rows untouched; history outside 1991–2025 unchanged.

## 5. Verification

Linux (streamanator, `/mnt/ssd/afldb/workspaces/i336-draft-20261105`, loopback cluster 55498): typecheck PASS;
`catalogue-lookups` 19/19, `coach-profile-route` 18/18, `grid-solver-spec` 19/19; `draftguru-acquisition` 163 passed,
2 failed for an untracked local snapshot absent from any clean clone (environmental, unrelated); RED with the base
`draft.ts`: 5 failed / 14 passed (exactly the draft ORDER BY and category-filter cases); `npm run build` PASS.
Browser (Playwright from the workstation through an SSH tunnel to the isolated app, data = clone after rehearsal):
**68/68 checks**, desktop 1280×900 and mobile 390×844, `screens/results.json` and the PNGs.

Follow-up pass (commits `d4070e7c` lint fix, `dc55bdd1` seal inventory): full unit suite (integration, NL-UI and
E2E excluded) on a clean base clone and on the candidate. Base 106 failed / 11,667 passed, candidate 107 / 11,671
(`fullunit-*.fails`); the 106 are identical in both (10 files that need data absent from a clean clone:
reconciliation inputs, rebuild fixtures, the DraftGuru snapshot). The one candidate-only failure was the V2-GAP-006
writer inventory, which must classify every file writing `draft_picks`; the rehearsal writer is now classified
`offline` (isolated targets only). After the fix the seal and draft suites pass 81/81 on Linux. ESLint on the changed
files: the one error (a variable reassigned during render, `react-hooks/immutability`) is fixed; two pre-existing
unused-variable warnings remain in untouched lines. Rebuilt (`npm run build` PASS); the served page carries the new
BUILD_ID; browser re-check **68/68**. `src/`, `tests/` and `tools/` trees on the Linux candidate equal the branch.

## 6. Owner decisions of 2026-11-06 and the production tool

D-336-1 accepted: `Intl Schol` is in `draftguru-event-kinds.json` (as `post_stage_a_additions`) and `GRID_SIGNING_KINDS`; the set-equality and Stage A
head tests now account for it explicitly. D-336-2 "prepare": the isolated-only writer of §4 was replaced by
`tools/v2/issue336-predraft-insert-production.ts`, run through the V2-GAP-029 operations framework as stage I336 (stage table, approval statement, the
three host-script guards, restore-evidence assembly). `prod-tool-rehearsal/` holds its rehearsal at `09acd432` on a fresh clone of the 2026-11-04
production dump: production mode on a clone refused; non-viable actor refused before mutation; `COMMITTED_VERIFIED` with 35 picks, 31 new persons, 35
audit rows by actor 1 and seal basis `audited_correction` × 35; verify 35/35 with every pre-existing draft row unchanged; replay refused on baseline
drift; `reconcile-after.txt` 5,966 = 5,966. The assembler's I336 derivation (`baseline-rehearsal.json`) was run; a production capture and a sealed
assembly were not (no dump younger than 24 hours exists). Runbook: `issues/open/AFLDB-ISSUE-336.md`.
