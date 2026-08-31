# AFLDB-ISSUE-095 — Canonical legacy-free ladder / team-season acquisition

**This file is the durable source of truth for ISSUE-095.** A fresh session must be able to
plan and implement this issue from `CLAUDE.md`, `docs/development/WORKFLOW.md`, this file, `issues.md` and
`IssuesIndex.md` alone. Do not rely on chat history.

## Status

```
Status:         RESOLVED 2026-08-28. D1-D7 approved and implemented (§10, §11);
                witness contract and D7 path (§13); acceptance proven by a clean
                afldb_test rebuild (§14) — all stages passed, the 1,622-row witness
                comparison agreed on every field, final validation 19/19, and both
                ISSUE-095-owned release gates are green. No migration was added
                (75/75) and no privilege was widened.
                Superseded: the "no design decision has been made" line below, and
                §4/§5/§8, all retained as lineage.
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

> **SUPERSEDED 2026-08-28 by §10.9 / §11.** The condition below has been met: the domain
> now has an accepted contract and `club_seasons` is derived from the same accepted match
> set, so the gates ARE added. The original text is retained as lineage.

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

Per `docs/development/WORKFLOW.md`, the D1–D7 design belongs to an Opus/High planning session and the
implementation to a fresh session against the approved plan.

---

# 10. Decisions D1–D7 — DRAFTED 2026-08-28

Drafted in an Opus/High planning session from measured evidence. §10.8 is the one point
requiring operator approval before implementation. Nothing below has been implemented.

## 10.1 Evidence base

**E1 — exhaustive D1 coverage probe, 1897–2025, run 2026-08-28.**
`artifacts/issue-095/probe_ladder_coverage.R` (untracked; `artifacts/` is gitignored),
outputs `ladder_probe_summary_1897_2025.csv`, `ladder_probe_rows_1897_2025.csv`,
`probe_ladder_coverage.log`. Read-only; no database touched.

129/129 seasons returned. **Zero** call errors, zero zero-row seasons, zero schema drift,
zero wrong-`Season` echoes, zero blank `Team`, zero duplicate-team seasons, zero bad or
missing ladder positions, zero NA `Season.Points`. Row counts 4 (1916) to 18 (2012–2025).
The eight-column contract held for every season. **Historical coverage is sufficient for D1.**

**E2 — `Percentage` is recomputed.** `max |Percentage − Score.For/Score.Against| = 0` across
all 129 seasons. Not an independently published field.

**E3 — the row set is the results-derived club-season universe.** 1,622 rows over 20 distinct
labels. `fitzroy-contract.json` `source_club_normalisation.rules[0].evidence` independently
records **1,622 distinct (club string, season) pairs** in the accepted
`full-history-20260827` `results.csv`. The two populations are identical.

**E4 — points follow one uniform rule with no era exception.** In **all 129 seasons**
`sum(Season.Points) mod 4 = 0` and `sum(Score.For) = sum(Score.Against)` exactly. Verified
against every odd-team and shortened season: 1897 8 teams/56 matches, 1916 4/24, 1924 9/72,
1987 14/154, 1991 15/165, 2011 17/187, 2020 18/153, 2025 18/207 — each exactly
`teams x games / 2`. **Byes award zero points everywhere; no deduction, forfeit or
rule-change exception appears anywhere in 128 years.**

**E5 — `Round.Number` is a free parameter**, defaulting to the last home-and-away round; a
ladder can be produced as at any round of any season back to 1897. **E6 — the dataset carries
no `wins`/`draws`/`losses` columns at all.**

**Provenance verdict.** E2+E3+E4+E5+E6 together establish, behaviourally, that
`fetch_ladder_afltables` **computes** the ladder locally from `fetch_results_afltables`
under a uniform 4-win / 2-draw / 0-loss rule and ranks locally by points then percentage.
It is not a scrape of 129 separately published historical ladders.

**Limit of this evidence, stated honestly.** The pinned package's implementation was **not**
read. fitzRoy 1.8.0 is installed at
`C:\Users\stuar\AppData\Local\R\win-library\4.6\fitzRoy` (DESCRIPTION `Version: 1.8.0`,
matching `pinned_version`), and a CRAN binary install stores R code in a lazy-load database
(`R/fitzRoy.rdb`) with no plain source; both that file and `help/fitzRoy.rdb` were confirmed
fully compressed with zero readable strings. Reading the body therefore requires R itself:

```bash
Rscript -e 'library(fitzRoy); ns <- asNamespace("fitzRoy"); print(fetch_ladder_afltables); for (h in grep("ladder", ls(ns, all.names=TRUE), ignore.case=TRUE, value=TRUE)) { cat("\n---", h, "---\n"); f <- get(h, envir=ns); if (is.function(f)) print(f) }'
```

**This command is confirmation, not a blocker.** D2/D3 below are decided on the measured
behaviour of the values, which is what AFLDB would store. A scrape that reproduced E2+E4
exactly would mean AFL Tables itself publishes a recomputation — the same conclusion for
AFLDB's purposes. Run it to close the record; it changes no decision unless it contradicts
E2–E6, which would be a material contradiction requiring this section to be revised.

## 10.2 D1 — canonical source

**Completed-season ladder acquisition uses pinned fitzRoy 1.8.0 `fetch_ladder_afltables`
for 1897–2025** (E1), acquired under the ISSUE-093 conventions: immutable artefacts,
SHA-256 manifest, acceptance register, offline fail-closed validation before any DB access.

**Its role is an independent VALIDATION artefact, not a field authority.** Per E2/E4 it
supplies no value AFLDB cannot compute from its own canonical `matches`, so importing its
columns as sourced facts would launder a local recomputation into external provenance. What
it *does* provide, and what nothing else does, is an **independent check on AFLDB's match
set and `is_final` classification**: its `Score.For`/`Score.Against` are the same aggregation
computed by a different toolchain over the same upstream source.

`AFLDB_LEGACY_SQLITE` appears nowhere on this path, including as a fallback.

## 10.3 D2 — field authority split

| Column | Authority | Basis |
|---|---|---|
| `played`, `wins`, `draws`, `losses` | **canonical `matches`**, home-and-away only | The source supplies none of them (E6) |
| `points_for`, `points_against` | **canonical `matches`** | Source values are the same aggregation; used as cross-check only |
| `percentage` | **canonical `matches`** | E2 proves the source value is recomputed, not observed |
| `premiership_points` | **see §10.8** — NULL, or declared-rule derivation | E4: the source value is a uniform local rule, not a published standing |
| `ladder_rank` | **see §10.8** — NULL, or declared-rule derivation | Rank is a local sort over `premiership_points`; it stands or falls with it |
| `wooden_spoon` | derived, **completion-gated**, semantics unchanged | Existing SQL; §3 semantics preserved |
| `is_premier` | derived from Grand Final `winner_club_id`, **drawn GF excluded** | Existing SQL; §3 semantics preserved |
| `finals_played` | derived from `matches.is_final` | Existing SQL, already correct |

Neither `Season.Points` nor `Ladder.Position` is treated as externally authoritative. The
existing wooden-spoon completion gate and the drawn-Grand-Final exclusion survive verbatim.

## 10.4 D3 — historical / NULL policy

No value is invented and no modern rule is applied retroactively under the source's
authority. Where a field is neither genuinely sourced nor deterministically reconstructable
under a historically verified rule, it is **NULL** — never zero, never a modern default.

`played`/`wins`/`draws`/`losses`/`points_for`/`points_against`/`percentage` are
deterministic consequences of canonical match facts and carry no era assumption: a club with
no matches in a season simply has no row, which is why South Melbourne has 128 seasons and
not 129 (1916, when only four clubs competed) and why Fitzroy has exactly the 100 seasons
migration 017 names.

`premiership_points` is the opposite case. E4 shows the source applies one uniform rule
across 128 years. That rule is *plausibly* historically correct for most of VFL/AFL history
— byes demonstrably award nothing — but **forfeits and early-era anomalies have not been
verified**, and verifying them is source research this issue has not done. §10.8 decides
between NULL and a declared rule; under either branch an unverified era yields NULL.

## 10.5 D4 — staging and provenance

**`staging.team_seasons` is NOT used as the handoff for completed seasons.** Its table
comment defines it as *"Raw season ladders. club_raw is the source string"*; writing
AFLDB's own match-derived tallies into it would misdescribe them as acquired source rows.
Under D2 there is no external ladder row to stage. The derived layer reads `matches`
directly.

Consequences, all in scope:
- `REBUILDS["club_seasons"]` sources tallies from `matches` instead of `staging.team_seasons`.
- `recomputeClubSeasons` (`src/db/queries/player-derived.ts:402`) is brought back into
  lockstep, as §7 requires. Its fail-closed guard is **retained and re-pointed**: it must
  refuse on a season with no canonical *matches* rather than no staging rows. This also
  clears §6's operational consequence — match create/delete/score-edit stops throwing on a
  canonically rebuilt database. ISSUE-015's status is unchanged and it is not reopened.
- Provenance: the hardcoded `sports_data_lab` `source_id` is replaced by **`afltables`**
  (already in `data/reference/sources.json`), in **both** writers. Match-derived rows must
  not inherit the retired legacy registry key. No new `sources.json` key is required.
- Ownership is **completed seasons only, ≤ 2025**. The acquisition and the load are scoped
  by season and cannot write, delete or truncate a row outside that range, so they cannot
  touch the current-season pipeline's population.

## 10.6 D5 — club identity

**Required, not optional.** The probe proves the source emits one modernised label per
organization across all time, in both directions: `Sydney` back to 1897 (before the 1982
rename), `Brisbane Lions` back to 1987 (the Bears era), `Footscray` forward to 2025 (after
the 1997 rename), and `North Melbourne` across 1999–2007 with the Kangaroos identity never
exposed. Fitzroy is correctly kept separate through 1996 (100 seasons) and University
appears for exactly 1908–1914.

Resolution uses the existing canonical machinery unchanged in mechanism: `ClubResolver`
(`tools/migration/import_fitzroy_core.py:276-407`) — tracked `source_club_normalisation`
rules first, scoped to an exact raw string, season range and dataset; then the alias map;
then, where the alias's own era does not contain the season, a walk of the **same
organization** for the unique identity whose era does; fail closed on zero or multiple
candidates. Verified against `data/reference/clubs.json`:

| Source label + season | Resolves via | To identity | Covered today? |
|---|---|---|---|
| `Sydney` ≤ 1981 | era miss → org walk (`org_members[Sydney]`) | South Melbourne (1897–1981) | **yes** |
| `Sydney` ≥ 1982 | era contains | Sydney (1982–) | **yes** |
| `Footscray` ≤ 1996 | era contains | Footscray (1925–1996) | **yes** |
| `Footscray` ≥ 1997 | era miss → org walk (`org_members[Western Bulldogs]`) | Western Bulldogs (1997–) | **yes** |
| `Brisbane Lions` 1987–1996 | `source_club_normalisation` rule 1 | Brisbane Bears (1987–1996) | **yes — rule is unscoped** |
| `Brisbane Lions` ≥ 1997 | era contains | Brisbane Lions (1997–) | **yes** |
| `North Melbourne` 1999–2007 | rule 2 is `dataset: "results"` | **North Melbourne — WRONG** | **NO — GAP** |
| `North Melbourne` outside 1999–2007 | era contains | North Melbourne (1925–) | **yes** |

**The one missing rule.** Rule 2 is scoped `dataset: "results"`, so for a `ladder` dataset
`resolve()` skips it (`:382-384`); North Melbourne's canonical span 1925–present then
*contains* 2003, the era check passes, and the row resolves silently to the modern identity.
This is the exact failure the rule's own `reason` field describes, and it **fails open, not
closed** — the most dangerous shape. D5 therefore adds, for the ladder dataset only:

```
{ "dataset": "ladder", "raw": "North Melbourne",
  "first_season": 1999, "last_season": 2007, "resolves_to_hist": "Kangaroos" }
```

`KNOWN_DATASETS` (`import_fitzroy_core.py:103`) must gain `"ladder"` or the contract
validator refuses the rule (`:325-328`). The existing collision check (`:338-353`) accepts
the pair: same raw string and range, but both rules are dataset-scoped and the scopes
differ, so `scopes_disjoint` is true and no conflict is raised.

**Brisbane Bears rule 1 is load-bearing and must not be narrowed.** Without it,
`Brisbane Lions` + 1990 finds zero same-organization candidates (Bears, Lions and Fitzroy
are three separate organizations) and raises `MatchIdentityError`. That refusal is correct
behaviour: the model will not merge distinct organizations, and the tracked rule — not an
alias — is what carries the source's mislabelling without making the two identities
interchangeable anywhere else.

**Invariant.** Every `(label, season)` pair resolves to exactly one time-bounded identity,
or the run fails. Enforced over all 1,622 pairs, not the four families alone — the probe
found 20 distinct labels and the gate covers every one.

## 10.7 D6 — rebuild placement

The load is **not** a new data stage. Under D4 there is no staging population to build, so
`club_seasons` remains produced by the existing DERIVED stage, whose position already
satisfies the ordering requirement: it runs after `fitzroy` and `draftguru`, so canonical
`matches` exist, and `rebuild_derived.py`'s `ORDER` already places `club_seasons` after
`season_metadata` so the completion gate reads a current `seasons.status`.

The **validation** artefact is consumed by the FINAL VALIDATION stage (D7), not by a data
stage. `planStages()` therefore keeps nine stages and gains no tenth. This is a change from
the §9 sketch and from the first checkpoint's proposal; the evidence removed the need.

`rebuild_derived.py`'s club-season derivation semantics change only where D2/D4 require:
the source of the tallies, and the `source_id`. Wooden-spoon, premier and finals semantics
are untouched.

## 10.8 THE ONE OPEN DESIGN POINT — operator approval required

`premiership_points` and `ladder_rank` (D2 rows 4–5). Both options honour D3; neither
treats fitzRoy as authoritative.

**Option A — NULL both.** Strictest reading of D3. Nothing unverified is stored. Cost:
`club_seasons` carries no ladder order at all, so ladder rank, `ix_club_seasons_ladder` and
every rank-dependent NL answer stay degraded after this issue closes.

**Option B — derive both from `matches` under an explicitly declared rule** (4 win /
2 draw / 0 loss; byes and unplayed matches award nothing), the rule and its evidence
recorded in a tracked reference file, `source_id = afltables`, and acceptance gated on
**exact agreement with the fitzRoy artefact across all 1,622 club-seasons**. Any season that
disagrees has both fields set NULL rather than forced. E4 is the evidence the rule holds
across 128 years; the residual risk is early-era forfeits, which the disagreement gate
localises rather than hides.

**Recommendation: Option B.** It is the only option that ends this issue with a working
ladder, it makes AFLDB's rule explicit and reviewable instead of inheriting an undeclared
one, and its cross-check turns the acquisition into a real independent test of AFLDB's own
match set. Option A is the safe fallback if the operator judges the declared rule to be a
retroactive modern assumption AFLDB should not make.

## 10.9 D7 — acceptance gates

Register-bound, read-only, all failures collected, ending in `RAISE EXCEPTION`, following
the existing 13 Stage-9 gates (§H11.4). The `club_seasons` non-zero gate §8 defers is added
here, and only here.

1. **Coverage** — every completed season 1897–2025 present; **1,622** club-season rows.
2. **Identity resolution** — every one of the 1,622 `(label, season)` pairs maps to exactly
   one time-bounded identity; zero unresolved, zero ambiguous.
3. **No duplicate identity-season** — `UNIQUE (season, club_id)` holds after resolution
   (the existing `resolves a season to exactly one identity per organization` gate stops
   passing vacuously).
4. **Era boundaries, measured** — Brisbane Lions' first `club_seasons` season **1997**;
   Footscray 1925–1996 / Western Bulldogs 1997–2025; South Melbourne 1897–1981 /
   Sydney 1982–2025; Kangaroos exactly 1999–2007; North Melbourne 1925–2025 minus that span.
5. **Era partition totals** — Footscray+Western Bulldogs **101**, South Melbourne+Sydney
   **128**, Kangaroos+North Melbourne **101**. Measured from the probe artefact, not
   carried over: the retired 102/129/102 pins included 2026 and are **not** reinstated.
6. **Cross-check against the artefact** — derived `points_for`/`points_against` equal the
   artefact's `Score.For`/`Score.Against` for all 1,622 rows. This is the gate that
   independently validates AFLDB's match set and `is_final` classification.
7. **Under Option B only** — derived `premiership_points`/`ladder_rank` equal the artefact's
   `Season.Points`/`Ladder.Position` for all 1,622 rows, or that season is NULL.
8. **2026 excluded** — zero `club_seasons` rows for 2026 from this path. The
   `staging.team_seasons WHERE season = 2026` release-gate assertion is **not** an
   ISSUE-095 acceptance gate; see §10.10.
9. **Idempotence** — a second run produces a byte-identical population.
10. **Source integrity** — manifest SHA-256 and artefact-set digest verified before use;
    `fitzroy_version_installed == pinned_version`.
11. **No `AFLDB_LEGACY_SQLITE`** anywhere on the path, including as a fallback.

## 10.10 Boundary — 2026 stays out

ISSUE-095 owns completed seasons **through 2025**. The in-progress 2026 ladder remains with
the current-season pipeline under `AFLDB-ISSUE-098`/`-099`, with rollover coordinated by
`AFLDB-ISSUE-101`, exactly as `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §6 records. That
`fetch_ladder_afltables` can return 2026 does not move it here.

Consequently release-gate `gate: 2026 is provisional` →
`preserves the raw ladder untouched in staging` (`tests/integration/release-gates.test.ts:872`)
is **reclassified out of ISSUE-095**. It asserts a 2026 `staging.team_seasons` row and is a
current-season fact. ISSUE-095 owns **two** release-gate failures, not three:
`records the merger as a navigable link` (`:313`) and
`attaches every ladder row to the identity trading that season` (`:334`). No new issue was
created for the reclassification; the owning issues already exist.

---

# 11. Implementation record — 2026-08-28

D1-D7 approved by the operator (Option B at §10.8, with the fail-closed tie refinement).
Implemented without any database access. **No migration was added; migration state stays
75/75.** Nothing committed.

## 11.1 Provenance question CLOSED

The operator deparsed pinned fitzRoy 1.8.0. `fetch_ladder_afltables` calls
`fetch_results_afltables(season)`, filters `Round.Type == "Regular"`, derives the winner
from `Home.Points`/`Away.Points`, scores win=1 / draw=0.5 / loss=0, sets `points = win * 4`,
cumulates `season_points`/`score_for`/`score_against`, computes
`percentage = score_for / score_against`, sorts by Season, Round.Number, descending
`season_points` then descending `percentage`, and assigns `ladder_pos` from that ordering.
**There is no further tie-break.** This confirms §10.1's behavioural verdict exactly:
`Season.Points`, `Ladder.Position` and `Percentage` are local computations, never
independently published observations. Recorded in `fitzroy-contract.json`
`datasets.ladder.provenance`.

## 11.2 The tie audit — the §10.8 refinement

Audited over all 1,622 accepted club-seasons using **exact rational comparison**
(`score_for x other_against` vs `other_for x score_against`), so float rounding can neither
manufacture nor conceal a tie. **Zero exact points-and-percentage ties exist in
1897-2025.** Points-then-percentage is therefore sufficient for the accepted corpus, and
that is recorded as a measured fact, not an assumption.

The fail-closed branch is implemented anyway, as defence against a future match
correction: a club exactly level on both gets `ladder_rank = NULL` — never an order taken
from club id, alphabet, insertion order or source row order — and a Stage-9 gate
(`club_seasons_unranked_rows = 0`) turns any future tie into a loud rebuild failure rather
than a quietly dropped position. A tie for last likewise awards no wooden spoon.

## 11.3 What changed

| File | Change |
|---|---|
| `tools/migration/rebuild_derived.py` | `REBUILDS["club_seasons"]` derives every column from `matches` (home-and-away only). Declared 4/2/0 rule; rank on exact ratio, stored x100; tie -> NULL; `source_id` -> `afltables`. Wooden-spoon completion gate, drawn-GF exclusion and finals counting unchanged. |
| `src/db/queries/player-derived.ts` | `recomputeClubSeasons` in lockstep, guard re-pointed to "no canonical home-and-away matches". |
| `tools/rebuild/fitzroy/fitzroy-contract.json` | `datasets.ladder` (role `VALIDATION_WITNESS`, provenance, coverage); the `dataset: "ladder"` North Melbourne 1999-2007 -> Kangaroos rule; `source_club_normalisation.$comment` extended to name the nested-era fail-open class. `full_history.required_datasets` **unchanged**. |
| `tools/rebuild/fitzroy/ladder-source-labels.json` | **New.** The 20 emitted labels with spans and explicit wartime gaps; regenerates the exact 1,622 pairs. |
| `tools/migration/import_fitzroy_core.py` | `KNOWN_DATASETS` gains `"ladder"`. |
| `tools/rebuild/fitzroy/acquire_core.R` | Per-season `ladder` acquisition; zero rows is a terminal failure, never an absence. |
| `tools/db/rebuild-test.ts` | `CLUB_SEASONS_EXPECTED` + `clubSeasonChecks()`; six Stage-9 gates. **Nine-stage topology unchanged.** |
| `tests/python/ladder_identity_contract.py` | **New.** 37 checks. |
| `tests/db-test-rebuild.test.ts` | Six gate tests. |
| `tests/admin-match-mutations.test.ts` | Re-pinned to the derived contract. |
| `tests/integration/data-editor.test.ts` | ISSUE-015 parity suite re-pointed; new score-correction test. |
| `tests/integration/release-gates.test.ts` | The two ISSUE-095-owned pins: `to: 2026`->`2025`, totals 102/129/102 -> **101/128/101**. |

## 11.4 Why no tenth stage, and why no re-pointing

D6 held: the DERIVED stage already runs after `fitzroy`/`draftguru`, so canonical matches
exist, and `ORDER` already places `club_seasons` after `season_metadata` so the completion
gate reads a current `seasons.status`. The ladder artefact is read at FINAL VALIDATION, not
by a data stage.

The derivation deliberately does **not** re-point through `afldb_identity_for_season`.
`matches` already store the historical identity, so the era is correct by construction;
Stage 9 gate `club_seasons_identity_era_violations = 0` **proves** it instead, so a
mis-attributed match fails the rebuild rather than being silently normalised away. §10.6's
requirement is met by proof rather than by forcing.

The derivation also carries **no hard-coded year**. It produces nothing for 2026 because
the accepted core contains no 2026 match — proven by
`club_seasons_after_accepted_last_season`, which reads the register.

## 11.5 Validation actually run

- `tests/python/ladder_identity_contract.py` — **37/37 PASS**, DB-free and network-free.
  All 1,622 pairs resolve; every resolution lands inside its identity's own era; no season
  maps two labels onto one identity; Fitzroy holds exactly its 100 seasons and never
  resolves to a Brisbane identity; Bears exactly 1987-1996, Lions from 1997, Kangaroos
  exactly 1999-2007; era partitions **101 / 128 / 101** with no overlap. Test 6 proves the
  new rule is load-bearing by rebuilding the resolver without it and asserting the wrong
  answer returns, and proves the Brisbane rule's removal fails **closed**.
- Contract JSON re-parsed and `required_datasets` confirmed unchanged.
- `player-derived.ts` assertion parity verified against the source directly.
- **Not run: every vitest suite.** This worktree has no `node_modules` (a fresh git
  worktree), and `D:\dev\afldb` must not be touched. See §11.6.

## 11.6 Outstanding — two operator steps, in order

1. **`npm install` in this worktree**, then the DB-free vitest suites
   (`db-test-rebuild`, `fitzroy-acquisition`, `admin-match-mutations`,
   `fitzroy-core-import`, `reference-data`).
2. **The ladder acquisition** (network, no database):
   `Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --label ladder-<date> --datasets ladder --from 1897 --to 2025`
   — produces the manifested witness artefact. Its cross-check against the derived table
   (D7 gates 6-7) can only run once both it and the rebuilt database exist.
3. **Then** the clean `afldb_test` rebuild, which is a separate authorisation.

---

# 12. DB-free validation and repair pass — 2026-08-28

Supersedes §11.6 step 1. `npm ci` was run by the operator; the five DB-free suites then
reported six failures. **Five repaired, one classified out of scope.** No product design
changed, no PostgreSQL, no acquisition, no rebuild, no migration, no privilege change.

## 12.1 Classification

| # | Failure | Cause | ISSUE-095's? |
|---|---|---|---|
| 1 | `declares exactly the three canonical AFL Tables datasets` | The contract gained a fourth key, `ladder` | **YES** |
| 2 | `has zero legacy/database dependency` | CRLF: the guard's comment stripper is inert here | No — pre-existing |
| 3 | `a stored profile-URL mapping to a different player fails closed` | CRLF: `indexOf` of a `\n`-joined source shape | No — pre-existing |
| 4 | `refuses a tracked rule that is itself inconsistent` | CRLF, same mechanism | No — pre-existing |
| 5 | `keeps a non-blank Player winning, unchanged` | CRLF, same mechanism | No — pre-existing |
| 6 | `finds the tables created after 045 that never registered import write` | Migrations **073/074** added `data_overrides` and `promotion_decisions` | No — **ISSUE-096/-086** |

## 12.2 The CRLF finding (failures 2-5)

`git config core.autocrlf` is **true** on this worktree: every file is LF in git and CRLF
on disk. Four assertions compare source text using `\n`, so they were matching against a
file that has `\r\n`.

Failure 2 is the one worth naming, because it was not merely tripping — **the guard was
inert**. It strips comments with `/#.*$/`, and JavaScript's `.` does not match `\r`, so on
a CRLF checkout `#.*` stops before the `\r`, `$` cannot match, and **nothing was stripped
from any line**. The rule "comments may mention what the script does NOT do; code may not"
had not been enforced on this platform at all. Proven against the HEAD blob, unmodified:
the same failure reproduces without any ISSUE-095 change.

**Repair: normalise the source on read** in the two test files — one line each, with the
reason recorded. Every assertion is left exactly as written. The alternative offered
(reword the adapter comment to drop the forbidden token) would have turned the suite green
while leaving the guard switched off, so it was not taken; the comment is accurate and the
test's own contract permits it.

## 12.3 The contract test (failure 1)

Repaired semantically, not by renaming. `fitzroy-contract.json` now holds two KINDS of
dataset, and a flat key list conflated them. The suite now asserts:

- the three **fact-bearing** datasets are exactly `player_details`, `player_stats`,
  `results`, identified by *not* carrying `role: VALIDATION_WITNESS`, each bound to its
  fitzRoy function — and that this set equals `full_history.required_datasets`, so the two
  definitions of "canonical" cannot drift apart;
- `ladder` exists, is `VALIDATION_WITNESS`, records `provenance.verdict:
  LOCALLY_COMPUTED`, is **absent** from `required_datasets`, has no field described as
  anything but a cross-check, and carries W/D/L as `MISSING` with no candidate columns.

Adding a witness no longer looks like adding a fact source.

## 12.4 Failure 6 — out of scope, deliberately not repaired

`data_overrides` (migration 073) and `promotion_decisions` (migration 074) are real, are
genuinely unregistered for import write, and are `AFLDB-ISSUE-096`/`AFLDB-ISSUE-086`
tables. ISSUE-095 added no table, touched no migration and changed no grant, and this
failure reproduces without any of its changes.

Repairing it would mean asserting that leaving those two without import write is correct —
a privilege decision belonging to ISSUE-086's manual-authority contract, which ISSUE-096
records as **blocked** and unbuilt. **Left untouched and reported.** It is a one-line
deterministic list update once that owner decides, and it must not be made silently here.

## 12.5 Result

- Five suites: **309 passed, 1 failed, 6 skipped**. The only failure is §12.4.
  `db-test-rebuild` 188/188, `admin-match-mutations` 11/11, `fitzroy-acquisition`,
  `fitzroy-core-import` and the rest of `reference-data` all green.
- `tests/python/ladder_identity_contract.py` — **37/37**.
- Files changed by this pass: `tests/fitzroy-acquisition.test.ts`,
  `tests/fitzroy-core-import.test.ts`. Nothing else.

**ISSUE-095's own DB-free boundary is green.** The next step is the ladder witness
acquisition (§11.6 step 2), then the clean rebuild as a separate authorisation.

---

# 13. Witness contract and D7 validation path — 2026-08-28

The ladder witness was acquired (`ladder-20260828`, 129 files, 1,622 rows, zero fetch
failures). This section completes the DB-free portion. **No PostgreSQL, no rebuild, no
migration, no privilege change.**

## 13.1 Amendment to §11.4 — there IS now a tenth stage

§11.4 said the rebuild "keeps nine stages and gains no tenth". That is amended, and the
amendment is deliberate rather than a drift: `ladder-witness` is added between `derived`
and `fingerprints`.

**D6 still holds as written.** D6 is about DATA stages — acquisition and load — and the
data topology is unchanged and now asserted: `reference -> fitzroy -> draftguru -> derived`
and nothing else carries `kind: 'data'`. The new stage imports nothing and opens its single
connection read-only. It cannot live inside FINAL VALIDATION, which is one SQL stream
executed by psql and therefore cannot resolve club identities through `ClubResolver`, nor
report per-row diagnostics.

## 13.2 The witness validator — one authority

`tools/rebuild/fitzroy/validate_ladder_witness.py`. Default mode makes **no database
connection and no network request**; `--compare` adds the D7 cross-check, read-only.

Offline it proves, from the manifest plus the acquired bytes alone: the contract classifies
`ladder` as a witness and does not require it for full history; the manifest is the accepted
label and matches its accepted sha256 byte-for-byte; 129 files totalling 1,622 rows; every
file's sha256 matches disk; every row count matches the manifest; the exact eight-column
schema; no zero-row season; every row's `Season` matches its file; Team non-empty and unique
within season; `Ladder.Position` complete and unique within season; seasons exactly
1897-2025 with no duplicate and nothing later; no duplicate (label, season); the witness's
own `Percentage` agrees with its own integers; and all 1,622 labels resolve through the
**real** `ClubResolver` to exactly one in-era identity, with no two labels colliding on one
identity in a season. **Measured: 26/26 PASS.**

`tests/python/ladder_identity_contract.py` now *defers* to this validator rather than
re-implementing it, and adds the check that closes the loop: the tracked
`ladder-source-labels.json` universe equals the acquired witness exactly, so that file
cannot silently drift from the source. It skips gracefully when the gitignored bytes are
absent, so it still runs on a bare checkout.

## 13.3 Durability — ISSUE-093's convention, reused, not reinvented

**Option C, which subsumes B.** ISSUE-093 already defines this: raw snapshots are
gitignored, only the manifest is tracked, and PRECHECK re-proves every artefact hash against
it before anything is destroyed. The witness reuses that exactly.

`fitzroy-contract.json` gains `datasets.ladder.accepted_witness`, naming the accepted label
and binding the tracked manifest by **sha256**, so the per-file hash list inside the
manifest cannot be edited to cover for tampered bytes. `runPreflight` now runs the validator
offline and refuses the rebuild if it does not pass.

**The failure mode this exists for was executed, not assumed.** With the manifest present
and the bytes moved aside, the validator exits **2** with a REFUSED message naming the
re-acquisition command; with the bytes restored it exits **0**. The rebuild therefore
refuses *before* the destructive stage rather than discovering the gap at the last stage
with the database already gone. The accepted core baseline was not touched, and the witness
was deliberately NOT added to `fitzroy-accepted-baselines.json` — that register's
`exactly_one_accepted` policy would refuse a second accepted entry.

## 13.4 D7 cross-check

After `derived`, for all 1,622 rows, matched on **(season, resolved club identity)** — never
on the raw `Team` string:

| Compared | AFLDB | Witness |
|---|---|---|
| `points_for` | `club_seasons.points_for` | `Score.For` |
| `points_against` | `club_seasons.points_against` | `Score.Against` |
| `premiership_points` | `club_seasons.premiership_points` | `Season.Points` |
| `ladder_rank` | `club_seasons.ladder_rank` | `Ladder.Position` |
| `percentage` | `club_seasons.percentage` | reconstructed — see below |

Set equality is checked in both directions first: a witness club-season missing from
`club_seasons`, or an extra one, is itself a failure. Any disagreement fails the stage with
`season | team (slug) | field | AFLDB=... witness=...`. Nothing is mutated to force
agreement — the witness is not authority; agreement is the acceptance check.

**Percentage scale.** The two floats are never compared. fitzRoy emits a ratio
(`score_for/score_against`); AFLDB stores that ratio **x100** rounded to 4 places as
`numeric(9,4)`. The expected stored value is reconstructed with exact decimal arithmetic
from the witness's own INTEGER `Score.For`/`Score.Against`, using ROUND_HALF_UP to match
PostgreSQL's `round(numeric, n)` (half away from zero, not half-to-even). Float
representation is removed from the comparison entirely. Separately, the witness's own
`Percentage` column is checked against its own integers, so an internally inconsistent
artefact is caught rather than papered over.

**Tie rule unchanged.** Rank by `premiership_points`, then the exact
`points_for/points_against` ratio; an exact tie on both yields `ladder_rank = NULL` and no
wooden spoon; no alphabetical, id or input-order fallback. Zero exact ties exist in
1897-2025, and Stage 9's `club_seasons_unranked_rows = 0` keeps it that way loudly.

## 13.5 Witness-only acquisition messaging — repaired narrowly

The acquirer measured a ladder-only run against the CORE contract, so it reported
`seasons_acquired: []` and `missing_seasons: [all 129]` — a run that acquired all 129 of its
own seasons described itself as having missed all 129 — and then printed the core
adjudicator as the next step, which necessarily fails over datasets a witness never claimed.

Repaired by measuring the right thing, **not** by relaxing any gate: when every requested
dataset carries `role: VALIDATION_WITNESS`, the per-season accounting counts the witness's
own files and the required range is the range requested; the manifest records
`acquisition_kind: "validation_witness"`, points `verdict_authority` at
`validate_ladder_witness.py`, and marks the player_stats-only `identity_observations` as
`not_applicable` rather than a row of zeroes that reads as "measured and found empty"; and
the printed next step names the witness validator with an explicit warning not to run the
core one. When any fact-bearing dataset is present the core contract applies **unchanged**.
`completeness` stays `unvalidated` either way — the acquirer still does not adjudicate.

## 13.6 The remaining reference-data failure does NOT block the rebuild

Two grounds, both checked rather than assumed:

1. `npm run db:test:rebuild` is `tsx tools/db/rebuild-test.ts`. It runs **no vitest suite**,
   so a red contract test cannot gate it.
2. The concern the test encodes — a table the reference loader's FK cascade reaches but
   `afldb_import` cannot read — does not apply to these two. `data_overrides` references
   only `auth_users`; `promotion_decisions` references `promotion_candidates` and
   `auth_users`. **Neither reaches `clubs`, `players` or `seasons`**, so neither is in the
   reference loader's cascade closure and neither can trip the `reference` stage.

It stays `AFLDB-ISSUE-096`/`AFLDB-ISSUE-086`'s, unrepaired here.

## 13.7 Validation run

- Five suites: **314 passed, 1 failed, 6 skipped** — the one failure is §13.6.
- `tests/python/ladder_identity_contract.py` — **40/40**, including the acquired-witness
  section.
- `validate_ladder_witness.py --label ladder-20260828` — **26/26**, offline.
- Fail-closed durability gate — executed: exit **2** with bytes absent, **0** restored.

## 13.8 Python interpreter resolution — repaired 2026-08-28

The first rebuild attempt refused at preflight with only *"The system cannot find the path
specified."*, reported as a fitzRoy preflight failure. It was neither: `VENV_PYTHON` was
hard-coded to the in-tree `.venv`, and **a git worktree has no `.venv` of its own**, so
every Python stage was unrunnable and the first one to try took the blame. Nothing had been
destroyed.

`resolvePython()` now reads `AFLDB_PYTHON` when set and non-blank, and otherwise keeps the
platform-local default unchanged (`.venv/Scripts/python.exe` on Windows,
`.venv/bin/python` on POSIX). That is the same override seven existing test suites already
use. It is read at CALL time, not captured at module load, so `DRAFTGURU_VALIDATE_ARGV`
became `draftguruValidateArgv()`. One resolution serves the whole graph: reference loader,
fitzRoy importer and preflight, DraftGuru importer and preflight, derived rebuild, and the
ladder witness validator.

**Deliberately not resolved by searching parent or sibling directories**, and asserted by
test: an interpreter found by walking out of the repository is one nobody chose, and this
harness drives a destructive rebuild. Explicit override, or the platform-local default.

Preflight now also fails closed on a missing interpreter, naming the selected path and
whether it came from `AFLDB_PYTHON` or the default — no credential or unrelated
environment value is printed.

**One defect found in this repair, before it could bite.** The real `fileExists` dependency
resolved every candidate against the repo root, and `path.join` does not reset on an
absolute second argument: `join('D:/repo', 'C:/py.exe')` is `'D:/repo/C:/py.exe'`. Since
an override is always an absolute path, the new gate would have rejected every valid
`AFLDB_PYTHON`. Fixed with `isAbsolute()` and pinned by test.

Validation: five suites **323 passed / 1 failed / 6 skipped** (the failure is §13.6),
contract test 40/40, witness validator 26/26. No database access.

---

# 14. Acceptance — clean afldb_test rebuild PASSED, 2026-08-28

The clean rebuild completed. All stages passed, the **1,622-row ladder witness comparison
agreed on every compared field**, and FINAL VALIDATION passed **19/19** (the existing 13
plus the six new `club_seasons` gates). Release gates moved **42 -> 45 of 64**, with **all
nine club-organization/identity gates green**.

## 14.1 The two ISSUE-095-owned gates are fixed

`records the merger as a navigable link without combining records` and `attaches every
ladder row to the identity trading that season` both pass, at the measured 101/128/101 era
partitions. Two gates that previously passed **vacuously** over an empty table — `resolves
a season to exactly one identity per organization` and `awards no premier and no wooden
spoon for 2026` — are now meaningful assertions over a populated one.

## 14.2 Classification of the 19 remaining reds — ISSUE-095 owns NONE

| # | Gate | Owner |
|---|---|---|
| 1-5 | Brownlow authority x4, Brownlow coverage x1 | `brownlow_season_votes` has no canonical legacy-free writer (unowned gap, `AFLDB-ISSUE-090.md` §27.5) |
| 6 | Advanced Search — 269 players | The Brownlow gap above, plus the id-hash pin below |
| 7 | Advanced Search — 110 players | Rebuild-baseline drift — investigated below |
| 8-10 | draft links x3 | DraftGuru Stage B3 not started; `unlinked_player_with_games` has no writer |
| 11 | absence is never zero — attendance | Accepted baseline excludes 2026 (15,187 vs the pinned 15,376) |
| 12-16 | birth dates x5 | DOB enrichment never runs in the canonical rebuild; acceptance amended by `AFLDB-ISSUE-090.md` §27.3 |
| 17-19 | 2026 is provisional x3 | Current-season pipeline — `AFLDB-ISSUE-096`/`-098`/`-099`, rollover `-101` |

None was repaired. #19 (`preserves the raw ladder untouched in staging`) is the assertion
§10.10 reclassified out of this issue: it asserts a 2026 `staging.team_seasons` row, which
is current-season, not completed-season, ownership.

## 14.3 The Advanced Search case — NOT caused by ISSUE-095

`debuted in the 1960s with exactly two clubs`: count **110** (correct), id hash
`42d5dd22f2712ffe` against a pinned `8cebc4aa37002766`.

**Four independent lines of evidence, none of them assumption:**

1. **The query cannot see this issue's work.** `runAdvancedSearch`
   (`src/db/queries/advanced-search.ts:75-76`) reads `players` joined to
   `player_career_stats`, plus `player_clubs`/`clubs` for a club filter. It **never reads
   `club_seasons`**. The two predicates are `c.debut_season` and `c.clubs_played`
   (`advanced-spec.ts:67,80`) — both `player_career_stats` columns.
2. **This issue changed nothing that feeds it.** Every hunk of the `rebuild_derived.py`
   diff lies inside the `club_seasons` block; **zero** changed lines touch
   `player_career_stats`, `player_clubs`, `player_season_stats`, `search_rank` or `ORDER`.
3. **It was already failing this way before ISSUE-095 had any code.**
   `AFLDB-ISSUE-090-HANDOFF.md` §11.3 row 7 records it on 2026-08-28 with count 110
   correct and the cause named — *"idHash pinned to legacy player ids"* — classified **RB**
   (rebuild-baseline drift) and non-blocking.
4. **The mechanism, measured.** `players.id` is `GENERATED BY DEFAULT AS IDENTITY`
   (`002_core_entities.sql:114`), assigned at import, so a rebuild re-mints every id. Live:
   `players` holds **13,277** rows numbered **1-13,277**, against the retired legacy
   population of 12,472/12,478. A hash over legacy ids cannot survive that, whatever else
   changed.

**Membership is intact.** A direct read-only query reproduces exactly **110** players and
the same `42d5dd22f2712ffe`; all 110 have `debut_season` in 1960-1969 and
`clubs_played = 2`; and all 110 map to **110 distinct** AFL Tables profile URLs — the
canonical identity — so the set is identity-coherent with no duplicate or missing identity.
What changed is the id labelling, not who is in the set.

**Out of scope, pre-existing, left unrepaired.** For whoever re-pins it: the pin is
inherently unstable because it hashes a surrogate key that every rebuild re-mints. The
rebuild-stable equivalent over AFL Tables profile URLs for this same set is
`44d77e946fc5afd8`. Recorded as evidence only — **no gate was re-pinned here**, that is
`AFLDB-ISSUE-090`/`-093` baseline territory.

## 14.4 Closeout state

Acceptance is met on this issue's own contract: canonical legacy-free derivation, witness
agreement across 1,622 rows, 19/19 final validation, both owned gates green, zero supported
`AFLDB_LEGACY_SQLITE` dependency. **No migration was added** (state remains 75/75), no
privilege was widened, and no `afldb_dev` or production database was touched at any point.
