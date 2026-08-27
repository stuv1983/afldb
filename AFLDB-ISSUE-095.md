# AFLDB-ISSUE-095 — Canonical legacy-free ladder / team-season acquisition

**This file is the durable source of truth for ISSUE-095.** A fresh session must be able to
plan and implement this issue from `CLAUDE.md`, `WORKFLOW.md`, this file, `issues.md` and
`IssuesIndex.md` alone. Do not rely on chat history.

## Status

```
Status:         OPEN — not started. No design decision has been made and no code has been
                written for this issue.
Opened:         2026-08-27
Severity:       Medium
Area:           Data acquisition / Import architecture / Data integrity
Origin:         AFLDB-ISSUE-093 §H15.5 — proven during the first complete canonical clean
                rebuild of afldb_test (2026-08-27).
Links:          AFLDB-ISSUE-093 (canonical clean rebuild — Resolved 2026-08-27)
                AFLDB-ISSUE-015 (per-season recomputeClubSeasons parity — Resolved
                2026-08-22; LINKED, NOT ABSORBED, and NOT reopened by this issue)
Blocks:         nothing today. The canonical rebuild passes without it.
Depends on:     nothing. It may be planned and implemented independently.
```

**Scope boundary for the implementing session.** This issue is the *acquisition and load*
of the ladder/team-season domain from a canonical, legacy-free source. It is not a change to
`recomputeClubSeasons`, not a schema redesign, and not a re-opening of ISSUE-093.

---

## 1. Problem

`club_seasons` — AFLDB's club/season ladder table — has **no canonical acquisition path**.
Its only historical source is `AFLDB_LEGACY_SQLITE`, the single-developer intermediate
database that `AFLDB-ISSUE-093` exists to retire. A clean canonical rebuild of `afldb_test`
therefore correctly produces `club_seasons = 0`.

This was proven, not inferred, during the first complete clean rebuild (ISSUE-093 §H15,
2026-08-27). It is the expected outcome of a legacy-free rebuild under the current contract,
**not a defect in that rebuild**.

## 2. Proven source chain (do not re-investigate)

1. `tools/migration/rebuild_derived.py` — `REBUILDS["club_seasons"]` (`:312`) builds the
   table **only** from `staging.team_seasons`
   (`TRUNCATE club_seasons; INSERT … SELECT … FROM staging.team_seasons`).
2. `staging.team_seasons` is populated **only** by
   `tools/migration/import_legacy_afl.py` (`:767`, `:776`, `:795`; group key `"ladders"` at
   `:996`). The only other references anywhere are `rebuild_derived.py`, which reads it, and
   `tools/validation/validate_migration.py`, the legacy parity checker.
3. That loader requires `AFLDB_LEGACY_SQLITE` (`require_env`, `:1021`).
4. The ISSUE-093 nine-stage canonical rebuild deliberately has **no legacy staging-load
   stage** — the data stages are reference → fitzRoy core → DraftGuru → derived-from-those.
   Ladder tallies were never in that contract.
5. With `staging.team_seasons` empty the CTE yields no rows, so the derived stage writes
   **zero** `club_seasons` rows. It did exactly what it is defined to do.

## 3. The table

`src/db/migrations/006_draft_relationships.sql:55`. One row per club per season,
`UNIQUE (season, club_id)`, `CHECK (played = wins + draws + losses)`:

| Column | Nullability | Current derivation in `rebuild_derived.py` |
|---|---|---|
| `season`, `club_id` | NOT NULL | staging row, `club_id` re-pointed through `afldb_identity_for_season(organization_id, season)` |
| `played`, `wins`, `draws`, `losses` | NOT NULL | copied verbatim from the source ladder |
| `points_for`, `points_against` | NOT NULL | copied verbatim from the source ladder |
| `premiership_points` | **nullable** (`:66`) | copied verbatim from the source ladder |
| `percentage` | **nullable** (`:67`) | copied verbatim from the source ladder |
| `ladder_rank` | **nullable** (`:68`) | copied verbatim from the source ladder |
| `wooden_spoon` | NOT NULL DEFAULT false | source ladder flag **AND** `season_status = 'complete'` |
| `is_premier` | NOT NULL DEFAULT false | derived from matches: Grand Final `winner_club_id` (NULL for a drawn GF, so 1948/1977/2010 draws drop out and only replays count) |
| `finals_played` | nullable | derived from matches: count of `matches.is_final` appearances |
| `source_id` | nullable | **hardcoded** `(SELECT id FROM sources WHERE key = 'sports_data_lab')` |

## 4. What fitzRoy can and cannot supply

Established from the accepted `full-history-20260827` baseline (ISSUE-093 §H4).

| Deterministically reconstructable from accepted match facts | Requires an external ladder source |
|---|---|
| `played`, `wins`, `draws`, `losses` | `ladder_rank` — the *published* ladder position |
| `points_for`, `points_against`, `percentage` | `premiership_points` — historical competition rules: per-win value, byes, forfeits, and rule changes across 1897–2025 |
| `is_premier`, `finals_played` — **already** derived from match facts by the existing SQL | |

Because `premiership_points`, `percentage` and `ladder_rank` are nullable, a purely
match-derived reconstruction is **schema-legal**. It is not therefore automatically correct:
see §5.

## 5. Decisions this issue must make (none are pre-decided)

**D1 — Authoritative source.** Choose and document the canonical, legacy-free source for
the ladder/team-season domain. Candidates to evaluate, not a recommendation: a fitzRoy
ladder/season endpoint; an AFL Tables season/ladder artefact acquired the same way the
fitzRoy core is (immutable artefacts + SHA-256 manifest + acceptance register); or a
match-derived reconstruction with an external source used only for `ladder_rank` and
`premiership_points`.

**D2 — Field split.** For each of `played`, `wins`, `draws`, `losses`, `points_for`,
`points_against`, `percentage`, `premiership_points`, `ladder_rank`, `wooden_spoon`,
`is_premier`, `finals_played`: decide whether it is reconstructed from canonical match facts,
externally sourced, or deliberately left NULL — and record the reason. Preserve the existing
historical semantics listed in §3; in particular the wooden-spoon completion gate and the
drawn-Grand-Final exclusion must survive whatever replaces the current SQL.

**D3 — Historical rule handling.** `premiership_points` semantics change across the
competition's history (per-win value, byes, forfeits, points deductions), and `ladder_rank`
is a *published* standing rather than a computable one. Decide explicitly how each era is
handled, and prefer NULL over an invented value. AFLDB's modelling rule applies: missing
historical data means "not recorded", not zero.

**D4 — Provenance.** The current SQL hardcodes `source_id = 'sports_data_lab'`. Rows that
are match-derived, or that come from a different acquired source, **must not inherit that
provenance**. Decide the correct `sources.key` (adding one to `data/reference/sources.json`
if required), and whether mixed-provenance rows are permitted at all.

**D5 — Club identity.** Any replacement must keep the `afldb_identity_for_season`
re-pointing. The source ladder names every club by its modern name; without the re-pointing
Sydney had ladder rows back to 1897 and Footscray had none, and club pages disagreed with
themselves. Everything downstream (premierships, finals counts) joins the **resolved**
identity because matches also store historical identities.

**D6 — Rebuild placement.** Decide whether this becomes a **tenth canonical rebuild stage**
(acquisition + load, like fitzRoy core / DraftGuru) or lands inside an existing stage
(most plausibly a canonical replacement for the `staging.team_seasons` input consumed by the
DERIVED stage). Either way it must run **after** matches exist, since match-derived fields
depend on them.

**D7 — Stage-9 gate.** Once implemented, add a FINAL VALIDATION gate for `club_seasons`
using the same register-bound pattern as the existing 13 gates (ISSUE-093 §H11.4): expected
values read from a tracked acceptance register, an unrecognised measured key is a refusal,
read-only, all failures collected, ending in `RAISE EXCEPTION`.

**Hard constraint on every option: ZERO supported `AFLDB_LEGACY_SQLITE` dependency.** That
environment variable must not appear anywhere on the supported path, including as a fallback.

## 6. What is degraded while `club_seasons` is empty

This is a genuine gap, not a cosmetic one. `club_seasons` is read by:

- `src/db/queries/clubs.ts`, `seasons.ts`, `rounds.ts`, `grid-solver.ts`, `search.ts`,
  `db-health.ts`, `player-derived.ts`, `nl/club-season.ts`;
- NL search `parser.ts`, `plan.ts`, `vocab.ts`;
- `src/lib/edit/spec.ts`.

Ladders, premiership and wooden-spoon flags, finals counts and club-season natural-language
answers are unavailable until the domain lands.

**Operational consequence for admin match mutations (from ISSUE-015, verified in source).**
`recomputeClubSeasons(tx, season)` (`src/db/queries/player-derived.ts:402-411`) **fails
closed**: if `staging.team_seasons` has no rows for the season it throws before deleting
anything, rolling back the surrounding mutation. It is wired into `createMatch` and
`deleteMatch` (`src/db/queries/match-admin.ts`) and the `applyMatchEdit` score case
(`src/db/queries/data-edits.ts`). So on a canonically rebuilt database with an empty
`staging.team_seasons`, **every** match create/delete/score-edit will throw for **every**
season. Expect this when running admin/integration suites against the rebuilt `afldb_test`;
it is the fail-closed guard behaving as designed, not a new defect.

## 7. Relationship to ISSUE-015 — linked, not absorbed

`AFLDB-ISSUE-015` (Resolved 2026-08-22) added `recomputeClubSeasons`, the targeted per-season
counterpart of the canonical full rebuild, kept in lockstep with `rebuild_derived.py`. Its
deliberate design decision stands: match score corrections do **not** recalculate published
ladder tallies from match facts; those values stay sourced from `staging.team_seasons`.

This issue does **not** reopen ISSUE-015 and does not absorb it. But whatever D1/D2/D4
decide, `recomputeClubSeasons` must be brought back into lockstep with the new canonical
definition — that lockstep is part of this issue's implementation, and ISSUE-015's status is
unchanged by it.

## 8. Stage-9 policy until this lands

**Do NOT add a `club_seasons` non-zero gate to the ISSUE-093 rebuild's FINAL VALIDATION stage
until this domain has an accepted canonical source and contract.** A non-zero requirement
would fail every canonical rebuild over a known, deliberate gap, converting it into a false
failure. Add the gate as part of D7.

## 9. Suggested first bounded session

1. Read this file, `AFLDB-ISSUE-093.md` §H4 (accepted baseline + acquisition/manifest
   pattern) and §H15.5.
2. Evaluate the D1 candidate sources for real coverage of 1897–2025 and for whether they
   carry `ladder_rank`/`premiership_points` at all — evidence first, no design commitment.
3. Produce the D1–D7 decisions as an approved plan in this file before writing any importer.
4. Implement acquisition + load with the ISSUE-093 conventions: immutable artefacts,
   SHA-256 manifest, acceptance register, fail-closed validation before any DB access,
   keyed/scoped writes that cannot touch another writer's rows, and no owner fallback.
5. Add the Stage-9 gate (D7) only once the data is accepted.

Per `WORKFLOW.md`, the D1–D7 design belongs to an Opus/High planning session and the
implementation to a fresh session against the approved plan.
