# AFLDB-ISSUE-221 — Grid Solver draft criteria: review closeout and the handoff for reopening AFLDB-ISSUE-164 (trusted draft-player linking)

Status: **Implemented, uncommitted, locally validated — 2026-09-17 (Fable 5.1, worktree
`D:\dev\afldb-issue-221`, branch `fable/issue-221-grid-solver-draft`). Awaiting operator commit,
`merge:ready` and the DEV checks in §6. This file is the cross-session handoff: §1–§4 record what
ISSUE-221 established and where; §5 is the brief for the fresh session that reopens
AFLDB-ISSUE-164 to write the trusted draft-player-linking runbook. That session must NOT begin
ISSUE-164 implementation.**

The authoritative detailed record is the `AFLDB-ISSUE-221` entry at the foot of `issues.md`
(Root cause, Review findings 1–9, Scope decisions, Implementation, Validation, Follow-up). This
file does not repeat its evidence tables; it points at them.

## 1. Where everything from ISSUE-221 was saved

| What | Where |
|---|---|
| Full ledger entry (root cause, nine review findings, validation, follow-up) | `issues.md` → `## AFLDB-ISSUE-221` (last entry) |
| Open-issue row and index card | `issues.md` Open Issues table; `IssuesIndex.md` |
| Retained behaviour changes | `CHANGELOG.md` → `[Unreleased]` → "Grid Solver: draft criteria review …" |
| Product code (all uncommitted in this worktree) | `src/search/grid-solver-spec.ts`, `src/db/queries/grid-solver.ts`, `src/app/grid-solver/page.tsx`, `src/app/grid-solver/GridSolverForm.tsx`, `src/search/gridley-compat.ts` |
| Tests | `tests/grid-solver-spec.test.ts`, `tests/grid-solver-timeout.test.ts`, `tests/gridley-compat.test.ts`, `tests/integration/grid-solver.test.ts` (new committed draft fixture describe + two oracle corrections), `tests/integration/gridley-corpus.test.ts` (comment only) |
| ISSUE-164 follow-up evidence | `issues.md` ISSUE-221 entry, sections *Root cause of the reported symptom* and *Follow-up*; the draft-linkage counts are in §2 below |
| Cross-session memory (Claude auto-memory, not repository) | `issue-221-grid-solver-draft-gap.md` |
| Scratch reproduction harness | deleted before handoff (a `renderToStaticMarkup` render of the page component with the audience gate and Next navigation stubbed; the technique is described in the ledger entry's *Actual* section) |

Nothing has been committed, pushed, merged or deployed. No Git command was executed by the
implementing session.

## 2. The draft-linkage evidence (measured 2026-09-17, read-only, both databases)

Measured over the 55432 tunnel on **`afldb_dev`** (as `afldb_app`) and **`afldb_test`** (as
`afldb_owner`); the two databases returned identical figures.

| Fact | Value |
|---|---|
| `draft_picks` rows | **6,810** |
| trusted links (`link_status_value IN ('unique','resolved')`) | **5** — all `resolved`, `match_method = 'draftguru_explicit_admin_decision'` |
| the five | Matt Rendell 1991 National pick 76; Ryan O'Keefe 1999 National pick 56; Nathan Fyfe 2009 National pick 20; Riley Onley 2025 Rookie pick 3; Fred Rodriguez 2025 Rookie pick 1 |
| `unmatched` | 6,805 (no `ambiguous`/`implausible` rows) |
| `draft_persons` | 5,057: 5 `resolved` (with `player_id`) / 5,052 `unmatched`; **0** picks whose person links while the pick does not |
| `draft_kind` populated | every row: national 3,089 (2,976 `'National'` + 113 `'National Draft'` for 1981/82/87), rookie 1,209, trade 990, preseason 541, pre_draft 370, midseason 280, post_draft 188, free_agency 138, mini_draft 4, training_squad_selection 1 |
| `pick_number` NULL | every trade, pre_draft, post_draft and free_agency row; no other kind |
| `club_id` on list moves | trade 929/990, free_agency 128/138 — the **receiving** club |
| `signing_kind` | 5,815 NULL; Academy 170, Foundation 124, Father-Son 118, SSP 107, Zone 89, FA 79, International 75, DFA 59, … (none linked) |
| national top-10 picks with a trusted link | **0** |
| `father_son_selections` (the other draft-shaped table) | fully linked and unaffected: 99 linked selected players, 123 linked fathers |

Consequence: every `draft_picks`-backed answer in the product — the eight Grid Solver builders
in §3, `/draft/[year]`, the player-profile draft card, the query builder's `player.draft_picks`
relationship — is drawn from those five players on every current database.

## 3. Grid Solver builders that depend on the draft-pick links

`drafted_by_club`, `draft_pick_between`, `draft_year_between`, `draft_type_is`,
`drafted_by_club_never_played`, `recruited_via`, `traded_min_times`,
`national_draft_pick_between` (all in `src/db/queries/grid-solver.ts`, group *Draft &
recruitment*). Gridley criteria that map onto them: `pick1`, `picktop5`, `picktop10`,
`pickrookie`, `freeagent1`, `traded1` — all classified `dataset gap` by
`tests/integration/gridley-corpus.test.ts`'s `draftLinks` probe (linked × 2 ≥ total is false).
`fatherson` no longer depends on them (remapped to `father_son_selection`, 99 players, 0
disagreements with Gridley's answer keys).

Since ISSUE-221 the page renders such an axis as **"No data — No player in this database
matches this question: …"** instead of "No answer / No player satisfies both axes"; the
builders themselves were left in the catalogue deliberately (scope decision recorded in the
ledger entry).

## 4. AFLDB-ISSUE-164 Decision D-9 — the governing context

Source: `issues/closed/AFLDB-ISSUE-164.md` (RESOLVED 2026-09-12; runbook retained in full).

- **D-9 (decided 2026-09-11, in force):** `draft_person` is **suspended from unattended
  (bulk) approval**. Suggestions and manual approval remain. Re-admission requires a `--labels`
  run over a **Tier 2** population presenting the §9.1 table in full — ≥ 253 bulk-eligible
  labelled rows, 0 false positives, 0 hard conflicts, exact name evidence on every one (§12 P1c
  item 10; §13 item 2b "DELIBERATELY UNMET").
- **Why the population is 5:** the legacy automatic `legacy_player_id` linker (retired
  `tools/migration/import_draft.py`, AFLDB-ISSUE-093 Stage B2-7) produced the historical
  2,319-row draft population; ISSUE-093 ruled automatic historical links inadmissible as durable
  identity and they were **never replayed**. The five rows are the five explicit human decisions
  in the tracked DraftGuru ledger (§12 P1c items 1–4, 9).
- **Truth source, ranked (§12 P1c item 5):** the DraftGuru person-page **AFL Tables href**
  (the accepted Stage B1 snapshot). *Tier 1* = the existing 120-record snapshot → 114 labels,
  run 2026-09-12: Top-1 98.96%, Very High precision 54/54, bulk n = 0 (nothing to bound). *Tier
  2* = re-run the Stage B1 acquisition over the whole person population ("acquired, not
  recovered"); ~97% residual coverage → positives in the low thousands. That is the only route
  to §9.1 and is the work ISSUE-164's reopening must plan.
- **Sample-size rule (§12 P1c item 6):** §9.1's n ≥ 253 / 0 failures bounds the FP rate at
  1.177% (parity with `player_achievements`), not 0.1%; a 0.1% bound needs n = 2,995.
- **Admissibility boundary:** ISSUE-093 §21 admits the Stage B1 snapshot as a profiling /
  validation oracle only; turning pairs into **stored links** is Stage B3's separate `--bridge`
  path and is governed by ISSUE-093, not by the matcher. `draft_picks` links therefore arrive
  either through that bridge or through `/admin/player-links` manual approval / the
  `admin-draft.ts` manual selection path (D-5) — never through bulk while D-9 stands.
- **Tooling that exists:** `npm run match:draft-labels` (`tools/matching/export-draft-labels.ts`),
  `npm run match:backtest -- --labels …` (`tools/matching/backtest.ts`, `label-set.ts`,
  `compare.ts`); label snapshot `draft-labels-b1-120.json` and the immutable
  `backtest-v1-baseline.json` / `queue-v1-baseline.json` at the repository root.
- **Known undetermined identity:** `draft_person:4163` Sam Chapman — not in the Stage B1
  snapshot, so Tier 1 cannot settle him (§12 P1c items 8, 12).

## 5. Unresolved decisions for the reopening session (operator's, not the model's)

| # | Decision | Notes |
|---|---|---|
| U1 | **Reopen ISSUE-164 vs open a new issue** for the Tier 2 acquisition and the linking runbook | ISSUE-164 is RESOLVED with D-9 as its stop condition working; its §16 names Tier 2 as future work. Either way the runbook must cite D-9 and §9.1 verbatim. |
| U2 | **Which path stores the links:** ISSUE-093 Stage B3 `--bridge` (person-page href → `draft_persons.player_id` → propagated to `draft_picks`) vs matcher bulk re-admission under §9.1 | These are different governance regimes; the bridge does not need §9.1 but needs ISSUE-093's own contract. |
| U3 | **Acquisition scope and snapshot discipline** for Tier 2 (whole person population, ~5,057 pages) — manifest-pinned, `--validate-only` preflight, rebuild stage placement | Pattern: `tools/rebuild/afltables/` club lists (ISSUE-118 Stage D1) and the `draftguru` rebuild contract. |
| U4 | **Whether `draft_picks` links are a `db:test:rebuild` stage** (so `afldb_test` carries them) or a DEV/PROD data load | The corpus suite's `draftLinks` probe flips at 50% linked; the Gridley draft criteria then stop being `dataset gap` and start being scored against answer keys. |
| U5 | Sam Chapman (`draft_person:4163`) | Manual decision or Tier 2 coverage. |
| U6 | Sequencing against ISSUE-221 | ISSUE-221 is uncommitted; its "No data" rendering is what users see until links exist. Recommend committing/merging 221 first so the runbook session starts from a clean main. |

**Decided 2026-09-18 (operator):** U1 successor issue **AFLDB-ISSUE-222** (ISSUE-164 not
reopened, D-9 preserved); U2 ISSUE-093 bridge, matcher backtest calibration-only; U3
whole-population resumable acquisition, new immutable snapshot, tracked bridge artefact, not
authorised to start yet; U4 rebuild stage, DEV/PROD via the verified in-place data refresh; U5
no manual decision for Sam Chapman, absent href = unresolved identity; U6 this issue's
commit/merge and DEV smoke first. The draft runbook is `AFLDB-ISSUE-222.md`; §6 and §7 of this
file are unchanged.

## 6. Validation status and remaining checks (ISSUE-221)

Done locally (workstation, `afldb_test` over the tunnel, 2026-09-17): unit suites 48/48;
`tests/integration/grid-solver.test.ts` 216/216 (from 209/212 — the two `is_final` oracles and
the after-siren precondition were the pre-existing failures); Gridley corpus diagnostic
1,163/1,166 with only the known pre-existing failures (two 2026 debutants, captain/teammates
answer keys); `tsc --noEmit` clean; eslint on touched files clean.

Remaining before ISSUE-221 resolves (operator): commit the worktree → `npm run merge:ready --
--issue 221` → push/merge → `deploy/sync-dev.ps1` → DEV browser smoke as super admin at
`/grid-solver`: (a) a draft axis (e.g. National Draft pick between 1–10) renders **"No data"**
naming the question, not "No answer"; (b) a share token carrying `to: "199999"` on a season
range renders three **"Invalid value"** squares and six solved; (c) **Reset** clears the six
axis editors, not just the board; (d) the Draft type dropdown lists ten kinds with "National
Draft" once. Not run anywhere: `npm run build`, browser E2E, PROD.

## 7. Required reading order for the fresh session

1. `CLAUDE.md` (operating rules; the user runs commands; no Git).
2. `IssuesIndex.md` (ISSUE-221 and ISSUE-220 are the open issues).
3. This file, §2–§5.
4. `issues.md` → `## AFLDB-ISSUE-221`: *Root cause of the reported symptom*, *Scope decisions*,
   *Follow-up*.
5. `issues/closed/AFLDB-ISSUE-164.md`: status header; §9.1; §12 P1c record items 5, 6, 9, 10
   and 12; §13 item 2b; §16; §17 (D-1…D-9).
6. `issues/closed/AFLDB-ISSUE-093.md` §21 (Stage B1 snapshot admissibility; Stage B3 `--bridge`)
   and its Stage B2-7 tombstone note for `import_draft.py`.
7. `src/db/migrations/019_draft_persons.sql` and `069_draft_source_identity.sql`
   (`draft_persons_link_ck`, `draft_picks_link_ck`, the `(source_id, player_url, draft_year,
   draft_kind)` reload key); `data/reference/draftguru-event-kinds.json`.
8. `tools/matching/export-draft-labels.ts`, `label-set.ts`, `backtest.ts` (`--labels`);
   `draft-labels-b1-120.json`; the acquisition side in `tools/rebuild/draftguru/`
   (`acquire_persons.py` — the Stage B1 person-page acquisition a Tier 2 run re-executes over
   the whole population — `acquire_draft.py`, `export_link_decisions.py`, `draftguru-contract.json`)
   and the retained ISSUE-093 DraftGuru handoffs in `issues/closed/`
   (`AFLDB-ISSUE-093-DRAFTGURU-ACQUISITION-HANDOFF.md`, `…-DRAFTGURU-B2-HANDOFF.md`). "§21" is
   ISSUE-164's own citation of the ISSUE-093 admissibility ruling; locate it by searching
   `AFLDB-ISSUE-093.md` for "profiling" / "bridge" rather than by heading number.
9. `src/db/queries/admin-draft.ts` (the only `INSERT INTO draft_picks` in `src/`, D-5) and
   `src/db/queries/player-links.ts` (manual approval path).
10. `tests/integration/gridley-corpus.test.ts` lines ~100–120 and ~318–350 (`DRAFT_BUILDERS`,
    the `draftLinks` probe) — the acceptance instrument once links exist.

Do not read `docs/development/WORKFLOW.md` unless preparing the handoff itself; do not bulk-read
`issues.md`.

## 8. Merge readiness

Status is `ready` for the code merge into `main`; DEV browser smoke (§6) is the pending
post-merge step and does not block the merge itself, per the documented rollout sequence
(commit → `merge:ready` → merge/push → `sync-dev.ps1` → DEV smoke → close the issue).

<!-- afldb-merge-readiness
{"status":"ready","hardBlockers":[],"expectedFiles":["CHANGELOG.md","IssuesIndex.md","issues.md","AFLDB-ISSUE-221.md","src/app/grid-solver/GridSolverForm.tsx","src/app/grid-solver/page.tsx","src/db/queries/grid-solver.ts","src/search/grid-solver-spec.ts","src/search/gridley-compat.ts","tests/grid-solver-spec.test.ts","tests/grid-solver-timeout.test.ts","tests/gridley-compat.test.ts","tests/integration/grid-solver.test.ts","tests/integration/gridley-corpus.test.ts"],"validation":["npx tsc --noEmit -p . — PASS: clean (2026-09-17, reconfirmed 2026-09-18)","unit suites grid-solver-spec/grid-solver-timeout/gridley-compat/grid-solver-under22 — PASS: 48/48 (2026-09-17, reconfirmed 2026-09-18)","tests/integration/grid-solver.test.ts (afldb_test) — PASS: 216/216 (2026-09-17; not re-run 2026-09-18, no DB DSN configured in this worktree)","tests/integration/gridley-corpus.test.ts diagnostic AFLDB_GRIDLEY_DIAGNOSTIC=1 (afldb_test) — PASS: 1,163/1,166 (2026-09-17; the 3 failures are pre-existing and unrelated to this change)","eslint on every touched file — PASS: clean (2026-09-17, reconfirmed 2026-09-18)","DEV browser smoke — PENDING: post-merge step, not a merge blocker"]}
-->

