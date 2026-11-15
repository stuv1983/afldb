# G-1 — source-only frozen rebuild vs production-equivalent replay (run 5; proposal, nothing implemented)

## 1. The distinction

| | Source-only frozen rebuild (the **accepted contract**, unchanged) | Production-equivalent replay |
|---|---|---|
| What it is | `tools/db/rebuild-test.ts --target isolated`: 30 stages, 91 checks, from tracked and retained sources only (fitzRoy `full-history-20260902`, DraftGuru `annual-html-20260826`, reference datasets, the RB-1 inputs). Accepted dump `afldb_v2_rb_rem3-6d5388ea.dump`, sha256 `d8397aab…65c63` | the same rebuild **plus** the administrator-curated layer production carries on top of sources: audited Data Editor corrections (`data_overrides` replay rows with their `data_edits` audit), and curated labels such as the 64 GAP-029 `matches.match_event` labels |
| What it proves | the pipeline reproduces the accepted contracts from sources, deterministically (`docs/v2/isolated-rebuild.md` §3: "not historical parity with production") | that a rebuild, after replaying the curated layer, answers what production answers (Gridley acceptance, marquee-match criteria, identity corrections) |
| Current state | 0 `data_overrides`; 0 `match_event` labels | the 4 Nov snapshot holds 165 `data_overrides` (64 `matches/match_event`, 92 `players/identity`, 8 `draft_picks/selection`, 1 `player_match_stats/lineup`) and 64 labels |
| Gridley | 3 ids fail (`anzac-playedin-1`, `anzac-won-1`, `bigfreeze-playedin-1`, `dreamtime-playedin-1` read as dataset gaps; 65 cells), class 5 | expected to pass once the labels exist (inferred from the mapping in `run4/clubcmp/README.md` §7; **not measured**) |

The two must not be merged silently. Adding a replay stage to `rebuild-test.ts` would change the accepted contract (its stage list,
check count and the dump digest every qualification pins). Importing the live `data_overrides` rows into the rebuild or into ordinary
fixtures would copy administrator data (92 player identity corrections, editor ids, audit rows) into test bases that are cloned, shared and
committed as evidence.

## 2. Recommendation (owner decision G-1)

**Keep the frozen rebuild as the contract and add a second, named tier on top of it, built only from tracked, reviewed curation evidence.**

1. **Tier S (source-only, unchanged).** `rebuild-test.ts` keeps 30 stages / 91 checks and the accepted digest. The Gridley assertions that need
   curated labels stay recorded against tier S as a declared dependency, not as failures to re-triage each run: a tracked manifest line per id,
   "requires tier P (curated GAP-029 labels)", checked by the failure-ledger tooling so a NEW Gridley failure on tier S is still red.
   No test is skipped or weakened.
2. **Tier P (production-equivalent overlay), separate and opt-in.** A post-rebuild step run on a **fresh copy** of the accepted dump (never the
   template, never the shared `afldb_test`), named `afldb_v2_rb_*_overlay_test`, that applies only curation that is itself tracked and reviewed:
   - the 64 GAP-029 labels through the existing audited applier `tools/v2/apply-gap029-match-events.ts` (it writes through `saveEdit`, so
     each label gets its `data_overrides` replay row and `data_edits` audit row, and it validates every match id's season, date, round,
     clubs and scores before the first write). The three 2026 ids differ on the rebuild, so the overlay needs either a rebuild-keyed evidence
     file (same entries keyed by natural key: season, date, clubs, scores; reviewed once) or, as a first step, the 61 entries ≤ 2025 only;
   - nothing else from production. The 92 player-identity, 8 draft-pick and 1 line-up overrides stay out: they are live administrator data.
   Record the overlay's own digest (applier report + resulting dump sha256) next to, not instead of, the accepted digest.
3. **Test the replay mechanism itself with owned fixtures**, not production rows: the existing data-editor / replay suites already create
   their own entities and overrides; extend the closest one (`tests/integration/data-editor.test.ts`) only if a replay path is
   uncovered. That tests "overrides survive a rebuild/reload" without any production data.
4. **Parity with production stays a read-only comparison**, never an import: aggregate counts per `data_overrides` (`entity_type`,
   `field_group`) and per curated label family, read with the B0 pattern on production and on tier P, compared in a record. A gap there is a
   finding, not a fixture.
5. **Gridley acceptance** is then measured on tier P (the full corpus), and tier S keeps its declared-dependency list. If tier P still fails,
   the cause is real and goes to the failure ledger like any other.

**Consequence of the recommendation:** the accepted rebuild contract and its digest do not change; the 3 ids stop being an open owner question
on every run; Gridley gets a real acceptance base; no administrator data enters fixtures. Cost: one later run (evidence-file keying for the
three 2026 ids, the overlay step, the manifest lines, one full Gridley run on tier P).

**Alternative (b):** accept the 3 ids as a permanent tier-S limitation with no tier P. Gridley's marquee-match criteria then have no accepted
base outside production-derived snapshots, which are being retired as a qualification base (T-1).

**Alternative (c), not recommended:** add the replay to the standard rebuild. It changes the accepted contract and its digest, and, if it
replays production's `data_overrides`, imports live administrator data into every rebuilt test base.

**What this decision blocks:** neither publication nor any production operation. It governs future rebuild qualification only.
