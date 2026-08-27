# AFLDB-ISSUE-093 — Deterministic afldb_test rebuild from authoritative sources

**This file is the durable source of truth for ISSUE-093.** A fresh session must be able to
execute from `CLAUDE.md`, `WORKFLOW.md`, this file, `issues.md` and `IssuesIndex.md` alone.
Do not rely on chat history.

## Status

```
Planning:       COMPLETE — APPROVED for implementation planning (this document)
Implementation: PHASE 1 COMPLETE (2026-08-25, validated 12/12 — see §15).
                PHASE 2 COMPLETE (2026-08-25, see §16): fitzRoy 1.8.0 pinned, canonical
                acquisition + manifest/fingerprint path proven end-to-end (trial-2024),
                field matrix evidence-backed, 13/13 static tests.
                PHASE 3 IMPLEMENTED (2026-08-25, see §17): club-list canonical source
                wiring + ISSUE-092 §4 fail-closed gate; static gate PASS 33/33.
                PHASE 4a (§13.4a core importer) IMPLEMENTED + VALIDATED (see §18, §19).
                DRAFTGURU Stages A/B1/B2-1..B2-8 COMPLETE (see §19 and the B2 handoff).
                ORCHESTRATOR npm run db:test:rebuild IMPLEMENTED (see §10, §19).
                CANONICAL FULL-HISTORY FITZROY SOURCE FROZEN 2026-08-27 (see §19).
ISSUE STATUS:   ***** RESOLVED — 2026-08-27 *****
Current state:  RESOLVED. The first complete canonical clean rebuild of afldb_test ran end to
                end on 2026-08-27: all NINE stages passed, migrations 72/72, and
                `AFLDB-FINAL-VALIDATION PASSED: 13 checks`. Data stages ran under the
                restricted afldb_import role. ZERO AFLDB_LEGACY_SQLITE dependency on the
                supported path. Authoritative record: §H15 (see also §19 for the frozen
                canonical source). Where §H15 and earlier sections disagree about execution
                state, §H15 wins.
Production:     NOT TOUCHED
Database:       afldb_test rebuilt and validated 2026-08-27 (§H15). RESET_SQL is proven both
                by the passing rollback-only proof (§H2/§20) and by the real rebuild.
Next stage:     none for this issue. Remaining work is tracked separately —
                AFLDB-ISSUE-095 (canonical legacy-free ladder / team-season acquisition).
Blocks:         none
Follow-up:      AFLDB-ISSUE-095 — club_seasons has no canonical acquisition path, so a
                legacy-free rebuild correctly yields zero rows (§H15.5). Stage 9 must NOT
                gate club_seasons until that issue lands. It links AFLDB-ISSUE-015
                (per-season recomputeClubSeasons parity) WITHOUT absorbing it.
Depends on:     AFLDB-ISSUE-092 §4 (fail-closed external_identities gate) must land in
                whatever importer owns external_identities before that importer ever runs
                against afldb_test, rebuilt path or not (see §9). AFLDB-ISSUE-083
                (restricted afldb_import test-role parity) was handled SEPARATELY by Codex
                and was never absorbed here; the rebuild's data stages nevertheless ran
                under the restricted role.
```

This document remains architecture plus the durable execution record. The issue is closed;
do not resume implementation from it. Any new work on the ladder/team-season domain belongs
to `AFLDB-ISSUE-095.md`.

---

## Context

AFLDB's `afldb_test` has twice shown it is not genuinely disposable: `AFLDB-ISSUE-090` found
non-idempotent DOB-conflict writes, and while regression-testing that fix, `AFLDB-ISSUE-092`
found that `enrich_birth_dates.py`'s `external_identities` reconciliation silently deleted
the real 12,472-row population when a test invoked it with a tiny fixture source. Both
issues are scoped to *repairing* the current database; neither proposes rebuilding it. There
is no `AFLDB-ISSUE-090 / 092 recovery strategy reassessment — REBUILD vs REPAIR.md` file in
the repository — checked, does not exist; the two runbooks and their `issues.md`/
`IssuesIndex.md` entries were read in full instead.

`AFLDB_LEGACY_SQLITE` ("Sports Data Lab afl.db") is not an opaque third-party authoritative
source — it is the user's own previously-built intermediate aggregation database, assembled
from upstream AFL data (fitzRoy/AFL Tables, DraftGuru, Wikipedia, FootyWire). The real
architectural gap is that **AFLDB does not currently have its own deterministic
source-to-PostgreSQL rebuild path** — the major historical/core rebuild path
(`import_legacy_afl.py`, `import_draft.py`, most of `import_awards.py`, and
`enrich_birth_dates.py`'s main-register pass) goes through that one hand-built intermediate
layer instead of acquiring from the original upstream sources directly. Several other
domains already bypass it: 22-under-22 (CSV), first-kick-goal achievements, current-season
catch-up (Squiggle/Kali), the derived-stats rebuild, and the five club-list DOB CSVs.

ISSUE-093 removes that intermediate dependency for the new rebuild architecture: it makes
the original upstream sources first-class rebuild inputs, with `AFLDB_LEGACY_SQLITE`
excluded from the new path entirely. It is not being declared untrustworthy — it is being
replaced with a rebuild path that doesn't need an intermediate hand-maintained hop at all.

**Release-gate policy note (see §11):** a rebuilt dataset is not required or expected to
reproduce today's exact snapshot figures bit-for-bit. `release-gates.test.ts` assertions
split into source-independent invariants (must keep holding) and legacy-snapshot-specific
counts (may only be re-baselined after independent validation, never silently loosened to
make a rebuild pass).

**Non-goals of this document** are listed in full in §14; the short version: no code, SQL,
or importer is implemented here, and bit-for-bit parity with today's dataset is not a goal.

---

## 1. Issue summary

- **ID:** `AFLDB-ISSUE-093`
- **Title:** Deterministic afldb_test rebuild from authoritative sources
- **Severity:** Medium — architectural limitation. AFLDB has no deterministic
  source-to-PostgreSQL rebuild path of its own; the current path routes through a single
  hand-built intermediate aggregation database with no provenance/versioning of its own.
- **Area:** Tooling / Data integrity / Import architecture

---

## 2. Source-to-schema matrix

Status vocabulary: **IMPLEMENTED** (working, source-agnostic or already non-legacy),
**DERIVED** (computed from already-imported PG tables), **STATIC/TRACKED** (hand-curated
reference data, portable as a tracked file), **LIKELY FITZROY-SUPPLIED — VERIFY** (current
fitzRoy is believed to carry this field/table; must be confirmed against the pinned version
before an adapter is designed around it), **MISSING** (no known adapter or source yet).

| Domain | Target tables (migration) | Authoritative source | Status | Notes |
|---|---|---|---|---|
| Seasons | `seasons` (002,013,015) | Generated (1897–present) | STATIC/TRACKED | Trivial range generation |
| Clubs / club identity | `clubs`, `club_aliases`, `club_organizations`, `club_organization_relations` (002,012,017,021) | Hand-curated (currently inline Python in `import_legacy_afl.py`) | STATIC/TRACKED | Needs porting to a standalone tracked dataset, independent of the intermediate-layer importer file |
| Venues | `venues`, `venue_aliases` (002) | fitzRoy match results (venue names) + hand aliases | LIKELY FITZROY-SUPPLIED — VERIFY (canonical list) / STATIC/TRACKED (aliases) | Venue names are a byproduct of the results snapshot |
| Players (identity/name/debut), DOB, AFL Tables profile URL, player_match_stats, Brownlow match votes | `players`, `player_name_aliases`, `players.dob`, `player_birth_evidence`, `external_identities`, `player_match_stats`, `brownlow_round_votes` (002,004,008,018) | **One canonical fitzRoy AFL Tables player-match/details snapshot** — `fetch_player_stats_afltables()` (carries `Brownlow.Votes`, AFL Tables URL since fitzRoy 1.5+, DOB since fitzRoy 1.6+) and `fetch_player_details_afltables()` | LIKELY FITZROY-SUPPLIED — VERIFY FIELD COMPLETENESS / IDENTITY SEMANTICS | See §8: prefer **one** acquisition covering all five sub-domains over separate scrapers, to avoid duplicate identity reconciliation paths. Preserve era-limited null semantics |
| Matches / results / scores / rounds / attendance | `matches`, `match_period_scores` (003,020,022,064) | fitzRoy results function (AFL Tables source) | LIKELY FITZROY-SUPPLIED — VERIFY | |
| Player match **period** stats | `player_match_period_stats` (062) | Unconfirmed | MISSING — **genuine unknown, needs source investigation** | AFL Tables' public tables are predominantly match-total; no known fitzRoy function surfaces per-quarter per-player data |
| Brownlow round/season votes | `brownlow_round_votes`, `brownlow_season_votes` (005,015/016) | Primary: `Brownlow.Votes` field inside `fetch_player_stats_afltables()`. Cross-check: `fetch_awards_brownlow()` (FootyWire, season/player/team tally grain) | LIKELY FITZROY-SUPPLIED — VERIFY GRAIN/COVERAGE | Do not build a separate scraper unless validation proves the fitzRoy player-match field insufficient (§8) |
| Brownlow career totals | derived from above | DERIVED once votes are sourced | DERIVED | |
| Coverage/status semantics | `stat_availability`, `stat_definitions` (002) | Hand-curated era coverage table | STATIC/TRACKED | |
| Draft persons/picks | `draft_persons`, `draft_picks` (006,019,069) | DraftGuru (not fitzRoy) | MISSING | fitzRoy does not cover draft history |
| Award winners (non-Brownlow) | `award_winners`, `awards` (005,042,061) | DraftGuru | MISSING | |
| All-Australian | `award_winners` | DraftGuru + Wikipedia | MISSING | |
| Rising Star | `award_winners` | FootyWire | MISSING | |
| Hall of Fame | `hall_of_fame` (005) | Wikipedia | MISSING | |
| Honour teams | `honour_team_members` (005,059) | Wikipedia | MISSING | |
| Captaincies | `captaincies` (005,042) | Wikipedia | MISSING | |
| 22-under-22 | `award_winners` via `under_22.py` | `data/awards/22-under-22.csv` (committed) | **IMPLEMENTED** | Already CSV-based |
| First-kick-goal achievements | `player_achievements` (053/054) | `tools/records/import-first-kick-goal.ts`, own source | **IMPLEMENTED** | Already outside the intermediate layer |
| DOB — club-list enrichment (5 clubs) | `players.dob`, `player_birth_evidence`, `data_issues` | Five AFL Tables club-list CSVs (all five now available) | **IMPLEMENTED** | `enrich_birth_dates_from_club_lists.py` — separate enrichment/evidence source from the main fitzRoy snapshot |
| DOB conflicts | `data_issues` (001) + ownership fix (072) | DERIVED from the DOB-writing importers | DERIVED | Governed by ISSUE-090's approved D1–D5 and migration 072. ISSUE-092's fail-closed reconciliation semantics apply **regardless of where the source data comes from** (§9) |
| Current season (Squiggle/Kali) | `staging.external_current_matches`, `matches` provenance (063,064) | Squiggle/Kali APIs | **IMPLEMENTED** | Own pipeline, runs after historical rebuild |
| Career/season derived stats, search rank | `player_season_stats`, `player_club_season_stats`, `player_career_stats`, `player_clubs`, `club_seasons`, `search_rank` | Already-imported PG tables | **IMPLEMENTED / DERIVED** | `rebuild_derived.py` — fully reusable unchanged |
| `player_link_resolutions`, `player_link_suggestions`, `player_link_match_candidates` | (056,067) | Admin decisions | MANUAL/RESTORED → **disposable** | See §7 |
| `data_edits`, resolved `data_issues` | (057/058) | Admin decisions | MANUAL/RESTORED → **disposable** | See §7 |
| `site_settings` | (034) | Defaults | STATIC/TRACKED | Reseed with defaults, not exported |
| Auth/test accounts | various | Test fixtures | MANUAL/RESTORED → **deterministic seed script** | See §7 |
| `nl_search_log` family | (046–051,055) | N/A (runtime telemetry) | N/A | Empty by design on a fresh rebuild |

---

## 3. fitzRoy / non-fitzRoy / missing split

**Believed fitzRoy-suppliable via one canonical AFL Tables player-match/details snapshot —
verify before adapter design:**
- Player identity/name/debut
- Player DOB (`fetch_player_stats_afltables()`, fitzRoy 1.6+)
- AFL Tables profile URL (`fetch_player_stats_afltables()`, fitzRoy 1.5+)
- `player_match_stats`
- Brownlow match votes (`Brownlow.Votes` field in the same function)
- Match results/scores/rounds/venues/attendance (fitzRoy results function)

**fitzRoy cross-check / secondary source:**
- `fetch_awards_brownlow()` (FootyWire, season/player/team tally grain) — independent
  reconciliation check on Brownlow totals, not the primary source

**Known non-fitzRoy sources already available or identified:**
- Five AFL Tables club-list CSVs (Brisbane Bears, Fitzroy, North Melbourne, Sydney/South
  Melbourne, University) — remain a *separate* enrichment/evidence source even once the main
  DOB field is fitzRoy-sourced
- DraftGuru — draft persons/picks, award winners, All-Australian, Rising Star (partial)
- Wikipedia — Hall of Fame, honour teams, captaincies, All-Australian (partial), 22-under-22
  (already CSV-ingested)
- FootyWire — Rising Star nominees, Brownlow cross-check
- Squiggle / Kali — current-season live data (already implemented)

**Genuine remaining unknowns (backlog — see §12), only after verification rules out
fitzRoy:**
- `player_match_period_stats` (quarter-by-quarter, per-player) — no known source at any
  grain
- Anything else where the pinned fitzRoy snapshot proves incomplete on inspection

---

## 4. Canonical source snapshot layout and durability

Two distinct concerns: an ephemeral **working acquisition area**, and a durable
**accepted-baseline archive** — a checksum alone does not make a deleted local file
reproducible.

```
data/sources/<domain>/<source>/<snapshot-label>/     # working copy, gitignored, may be
  <raw files>                                         # regenerated/discarded
```

**Durable archive:** once a snapshot is accepted as a rebuild baseline, its raw files are
additionally preserved in a documented durable location outside Git — analogous to the
existing off-host database backup practice, not the ephemeral `data/sources/` working
directory. Exact host/path is settled at implementation time; the requirement is that it is
documented, host-external where practical, and not itself required to be committed to Git
(no large raw datasets in Git).

**Tracked manifests (Git):**

```
docs/rebuild-manifests/<domain>/<snapshot-label>.json
```

Each manifest records, at minimum:
- source (e.g. "AFL Tables via fitzRoy")
- source adapter (script/module name)
- fitzRoy/package version used (must match the pinned version, §5)
- extraction date
- requested season/range
- raw snapshot filename(s)
- row count(s)
- SHA-256 checksum(s) of the raw file(s), linking the manifest to both the working copy and
  the durable archive copy
- adapter/schema version, if the importer's parsing contract has its own version

**Snapshot immutability:** if a raw snapshot is intentionally reacquired later and its
bytes/content differ from the previously accepted baseline, it is treated as a **new**
snapshot with its own new manifest and fingerprint — never a silent in-place replacement of
a previously accepted baseline's manifest.

**Club-list CSVs — canonical location and exact filenames** (must match
`enrich_birth_dates_from_club_lists.py`'s hardcoded `FILE_ORGS` exactly):

```
data/sources/afltables/club_lists/
  Brisbane_Bears_-_All_Time_Player_List.csv
  Fitzroy_-_All_Time_Player_List.csv
  North_Melbourne_-_All_Time_Player_List.csv
  Sydney(South Melbourne)_-_All_Time_Player_List.csv
  University_-_All_Time_Player_List.csv
```

---

## 5. fitzRoy version pin

The rebuild must not depend on an unspecified installed fitzRoy version:
- An explicit supported fitzRoy version is pinned in the rebuild tooling (e.g. an R
  lockfile/renv or an explicit `packageVersion("fitzRoy")` check at adapter start)
- Initial target: the current stable CRAN release, unless implementation-phase evidence
  shows a specific function is only correct on a newer/dev version
- The pinned version is recorded in every source manifest (§4)
- An adapter run against an unsupported/mismatched fitzRoy version fails or warns clearly
  rather than silently accepting a changed upstream output shape
- The rebuild must not implicitly depend on fitzRoy's development branch

---

## 6. Rebuild phase order — preflight before destructive action

The default **complete** rebuild must fail *before* destroying `afldb_test` wherever a
blocking problem is detectable during preflight. Partial/development rebuild modes
(deliberately incomplete, for local iteration) may be designed later, but are not the
default and are not designed in this document.

1. **Resolve target** — prove the target is exactly `afldb_test` (see §10)
2. **Acquire/locate source snapshots** — fetch or locate all source snapshots required for
   the requested rebuild, per the canonical layout (§4), at the pinned fitzRoy version (§5)
3. **Validate sources** — confirm presence, expected schema shape, pinned tool/package
   versions, manifests, and checksums for every acquired snapshot
4. **Domain completeness gate** — determine whether every domain REQUIRED for a complete
   rebuild has an available implementation and source; **fail here, before touching the
   database**, if any required domain is still MISSING
5. **Destructive acknowledgement** — only once 1–4 pass, require the explicit
   destructive-acknowledgement flag (§10) before any drop/reset of `afldb_test`
6. **Reset/recreate `afldb_test`**
7. **Apply migrations** — apply the complete current tracked migration set (today that is
   001–072; the tool applies whatever is currently tracked, not a hard-coded terminal
   number — see §10)
8. **Apply privileges** — `db:privileges:test`
9. **Import, in dependency order:**
   a. Static/reference: seasons, clubs/club_organizations/aliases, venues/aliases,
      stat_definitions/availability
   b. Core: players, matches, player_match_stats, DOB, external_identities, Brownlow match
      votes — from the single canonical fitzRoy snapshot (§8)
   c. DOB club-list CSV enrichment — layered on top of (b) — depends on (b)
   d. Draft persons/picks (DraftGuru) — depends on (b)
   e. Awards/honours domains (All-Australian, Hall of Fame, honour teams, captaincies,
      Rising Star; Brownlow season/career totals derived from (b)) — depends on (b)
   f. 22-under-22 (CSV, IMPLEMENTED) — depends on (b)
   g. First-kick-goal achievements (IMPLEMENTED) — depends on (b)
   h. Current-season catch-up (Squiggle/Kali, IMPLEMENTED) — depends on (b)
10. **Derived rebuild** — `rebuild_derived.py` (unchanged) — depends on all of (9)
11. **Manual/test seed** — deterministic minimal seed for auth/test fixtures + `site_settings`
    defaults (§7)
12. **Validate** — per-domain row counts/fingerprints against manifests, migration-checksum,
    `privileges.test.ts`, split release-gate validation (§11)

---

## 7. Manual/test state policy

Recommendation: **disposable/reseeded by default**, not preserved (`afldb_test` is already
excluded from backup per `docs/backup-restore.md` and assumed reproducible by re-running
imports):

- `player_link_resolutions`, `player_link_suggestions`, `player_link_match_candidates` —
  disposable
- `data_edits`, resolved `data_issues` — disposable
- `site_settings` — reseeded with defaults
- Auth/test accounts — replaced with a deterministic seed script

Nothing in current `afldb_test` state is recommended for export/replay into the rebuilt
database.

---

## 8. Implementation ordering principle — one canonical acquisition, not five

Before creating separate source adapters for player identity, DOB, AFL Tables URL,
`player_match_stats`, and Brownlow match votes, the implementation phase must first
determine whether **one** `fetch_player_stats_afltables()` (+
`fetch_player_details_afltables()` where needed) acquisition already supplies all five, at
the pinned fitzRoy version. This avoids duplicate scraping and multiple independent
identity-reconciliation paths into `players`/`external_identities`. Only build a separate
Brownlow scraper or a separate DOB/identity scraper if verification proves the canonical
snapshot's relevant field is missing, wrong-grain, or unreliable for a meaningful span of
history — use `fetch_awards_brownlow()` as an independent cross-check first, not as a
replacement source.

---

## 9. ISSUE-092 dependency — minimum containment before validating a rebuilt DB

Key distinction: ISSUE-092's runbook has **§4 the fail-closed population-sanity gate** (a
code fix to the reconciliation logic) and **§6 recovery of the current `afldb_test`'s
destroyed data** (a one-time restoration for the database that exists today).

For a from-scratch rebuild, §6 is moot — the table starts empty. But **§4's fail-closed gate
is still mandatory and source-independent**: whatever adapter ends up owning
`external_identities` reconciliation carries the same defect class — a DELETE that trusts an
unproven-complete source population — unless the gate is built in from day one. **Minimum
required work: implement and validate ISSUE-092 §4 (the fail-closed gate +
`--acknowledge-population-drop` override + `--source-key` test containment) in whatever
importer owns `external_identities` before that importer is ever run against `afldb_test`,
rebuilt or not.**

---

## 10. Rebuild orchestrator safety contract (`npm run db:test:rebuild`)

> **IMPLEMENTED 2026-08-27** in `tools/db/rebuild-test.ts`, proven DB-free by
> `tests/db-test-rebuild.test.ts` (70/70). The contract below is what it implements, point
> for point. It has **never been executed destructively** — see §19.9. The text after this
> note is the original approved contract, unchanged.

Reusing patterns already proven in this codebase:
- **Explicit named-target map**, refuse on anything unrecognized — the pattern
  `tools/db/migrate.ts` already uses for `AFLDB_MIGRATE_TARGET`
- **Destination-must-equal-known-safe-name check** — the pattern
  `tools/maintenance/restore-test.sh` uses
- Must refuse any target except `afldb_test`; explicitly reject `afldb_prod` and `afldb_dev`
  by name
- Must run the full preflight sequence in §6 (steps 1–4) **before** requiring destructive
  acknowledgement or touching the database — a missing required source must be detected and
  reported pre-destruction, not discovered mid-rebuild
- Must require an explicit destructive-acknowledgement flag before any drop/reset of
  `afldb_test`, in the spirit of ISSUE-092's `--acknowledge-population-drop`
- Must apply the **complete current tracked migration set** — the orchestrator discovers and
  applies whatever migrations exist in `src/db/migrations/` at run time (reusing
  `tools/db/migrate.ts` unchanged); it must not have a terminal migration number (e.g.
  `072`) hard-coded as "the schema." The rebuild report records the highest migration number
  actually applied, as an observation, not a target
- Must run import phases in the fixed dependency order in §6, failing closed on a missing
  required source
- Must produce source fingerprints and row counts per domain, backed by the tracked
  manifests in §4
- Must never reference `AFLDB_LEGACY_SQLITE`

---

## 11. Release-gate policy

`release-gates.test.ts` assertions split into two classes — the rebuild must not "pass" by
loosening Class B expectations to match whatever the new import happens to produce:

- **Class A — source-independent semantic/truth/integrity invariants** (e.g. Barassi Sr/Jr
  distinct, NULL-vs-zero semantics, structural uniqueness constraints): remain fixed unless
  independently proven wrong by evidence, not by rebuild convenience.
- **Class B — dataset snapshot/count expectations tied to today's legacy-source snapshot**
  (e.g. Brownlow total 79,113, exact draft-link counts): may only be re-established after the
  new authoritative import is independently validated against its own source manifests (§4)
  — not simply set to whatever the rebuild outputs. Where old and new values differ, require
  a provenance/source comparison (why they differ — upstream correction, different coverage,
  genuine defect) before changing any expected figure.

---

## 12. Missing source backlog (implement one at a time in later bounded sessions)

1. **Verify** the canonical fitzRoy player-match/details snapshot's coverage for: player
   identity, DOB, AFL Tables URL, Brownlow match votes, at the pinned version — this is
   investigation, not yet a "missing" adapter, but gates everything else
2. `player_match_period_stats` — genuine unknown, no known source at any grain, needs
   investigation before it can even be scoped
3. Canonical venue list adapter (beyond hand-curated aliases) — verify against the results
   snapshot first
4. Draft persons/picks adapter (DraftGuru) — confirmed non-fitzRoy
5. Awards/honours adapters: award winners, All-Australian, Rising Star, Hall of Fame, honour
   teams, captaincies (DraftGuru/Wikipedia/FootyWire — confirmed non-fitzRoy, likely several
   small adapters)
6. Clubs/club_organizations static dataset extraction (port hand-curated data out of
   `import_legacy_afl.py` into a standalone tracked file — not a new source, just currently
   entangled with the intermediate-layer importer file)

Brownlow votes and the main DOB register/`external_identities` are **not** listed as
assumed-missing items — they move to item 1 (verification), per §8.

---

## 13. Implementation phases (each its own future bounded session)

1. Port static/reference data (clubs, orgs, aliases, seasons, stat coverage) out of
   `import_legacy_afl.py` into a standalone tracked dataset + loader
2. Pin fitzRoy version (§5); verify the canonical player-match/details snapshot's coverage of
   identity/DOB/URL/Brownlow-votes/player_match_stats (§8, backlog item 1); build the
   **single** adapter if verification succeeds
3. If verification finds gaps: scope only the specific missing piece, not a full separate
   scraper, unless the gap is structural
4. Wire club-list CSV DOB enrichment to the canonical directory (§4) end-to-end as the
   separate evidence-source layer; add the ISSUE-092 fail-closed gate to whichever importer
   owns `external_identities` (§9)
4a. **Historical/core PostgreSQL importer** — canonical fitzRoy snapshot (files +
   manifests, §4/§16; never live fitzRoy) → players/identity, venues as required,
   matches/results, player_match_stats, DOB/`player_birth_evidence`, AFL Tables
   `external_identities` (under the ISSUE-092 gate), Brownlow round votes,
   attendance/provenance — i.e. §6.9(b), preserving NULL-vs-zero and stable-identity
   semantics. Added 2026-08-25: the original list jumped from acquisition to DraftGuru
   with no core-import phase. Handoff: `AFLDB-ISSUE-093-CORE-IMPORT-HANDOFF.md`.
5. Draft adapter (DraftGuru) — follows 4a
6. Awards/honours adapters (likely multiple sessions)
7. `player_match_period_stats` source investigation (may conclude "no source exists for
   historical seasons")
8. Orchestrator (`db:test:rebuild`) wiring the above behind the §6/§10 preflight-first safety
   contract, plus manifest/fingerprint validation reporting
9. Re-baseline `release-gates.test.ts` Class B expectations (§11) against the rebuilt
   dataset's actual, provenance-compared figures

---

## 14. Explicit non-goals

- Bit-for-bit parity between the rebuilt dataset and today's legacy-sourced `afldb_test`
  figures
- Implementing any importer/adapter in this document
- Resolving the `player_match_period_stats` source gap in this document
- Recovering the *current* `afldb_test`'s `external_identities` data (ISSUE-092 §6,
  orthogonal to this rebuild)
- Building the `db:test:rebuild` orchestrator script itself in this document
- Auditing/repairing `afldb_prod` or `afldb_dev` — this issue is scoped to `afldb_test` only
- Loosening any `release-gates.test.ts` Class A invariant, or any Class B figure without a
  provenance comparison, to make a rebuild appear to pass
- Designing partial/development rebuild modes (deliberately incomplete) — noted as a future
  possibility only

---

## 15. Phase 1 implementation state — COMPLETE (2026-08-25)

Phase 1 (§13.1: port static/reference data out of `import_legacy_afl.py`) is **COMPLETE
and validated**: `npx vitest run tests/reference-data.test.ts` — 1 file passed, **12/12
tests PASS** (859ms, user-run 2026-08-25). `import_legacy_afl.py` is unchanged — the
legacy path still works; the new path exists alongside it. The preserved baseline
`afldb_test_pre_rebuild_20260825` was returned to `ALLOW_CONNECTIONS = false` after the
one-time extraction and is reference-only — it is NOT an input to the new rebuild path.
Next: Phase 2 (fitzRoy core acquisition/adapter) in a fresh bounded session — durable
handoff in `AFLDB-ISSUE-093-PHASE-2-HANDOFF.md`.

### Files

| File | Role |
|---|---|
| `data/reference/sources.json` | 7 source-registry rows, verbatim from `SOURCES` |
| `data/reference/seasons.json` | Season range 1897–2026, league eras (VFL≤1989/AFL≥1990), in-progress seasons, notes |
| `data/reference/clubs.json` | 24 identities (+ notes inline), 3 organization relations, verbatim from `CLUBS`/`CLUB_ORGANIZATION_RELATIONS`/`CLUB_NOTES`; slugs precomputed |
| `data/reference/stat-definitions.json` | Final 24-key state: 21 per-match keys + 3 Brownlow grains; generic `brownlow` key deliberately absent |
| `data/reference/stat-availability.json` | Coverage grid as season ranges — **status `PENDING_EXTRACTION`**, see below |
| `data/reference/venue-canonical.json` | `VENUE_CANONICAL` 3-entry map, data only; consumed by the future venue import phase, not loaded in Phase 1 |
| `tools/migration/load_reference_data.py` | Standalone loader (groups: sources, seasons, clubs, coverage); `--print-plan`, `--groups`, `--allow-cascade`, `--list-groups` |
| `tests/reference-data.test.ts` | Dataset invariants + loader zero-legacy guarantee + `--print-plan` determinism |

### Static vs legacy-derived split established by inspection

Genuinely static, ported verbatim: `SOURCES`, `CLUBS`, `CLUB_ORGANIZATION_RELATIONS`,
`CLUB_NOTES`, `STAT_DEFINITIONS` (minus the deleted generic `brownlow` key, plus the three
grain definitions from `import_brownlow_availability`), `VENUE_CANONICAL`.

Legacy-derived in the old path, handled as follows:

- **seasons** measured columns (match dates/counts, `data_through_date`) — owned by later
  match-import/season_metadata phases; static loader writes NULL. Season enumeration is the
  runbook's trivial range generation, with the range and in-progress seasons explicit in the
  dataset so the load is deterministic.
- **clubs.first_season/last_season** — previously measured from legacy `games` per
  `club_hist`; encoded in `clubs.json` as identity-era facts (`last_season: null` = current,
  resolved to the season range's last season). **Must be verified against the current
  database by the extraction below before acceptance.**
- **clubs.wikipedia_url/afltables_slug** — previously read from the legacy SQLite `clubs`
  table; currently `null` in `clubs.json`, **pending extraction** from the current database.
- **clubs.legacy_club_key** — the legacy SQLite numeric club id; deliberately NOT carried
  into the new path (loader writes NULL). Unused by application code (only migration 002
  defines it).
- **club_now alias pass** — inspection shows it provably inserts nothing today: every
  matched `club_now` string is already inserted by the static hist/name/short/abbrev pass
  and hits `ON CONFLICT DO NOTHING`. The static alias set is therefore complete; the
  extraction's full alias dump verifies this.
- **stat_availability** — coverage classes per (stat, season) are the known-good historical
  truth (the NULL-era semantics this issue must preserve); the grid is extracted once from
  the current database and committed as ranges. `is_recorded` is derived at load as
  `coverage IN ('complete','partial')` (the rule the current importer applies to every
  grain; the extraction cross-checks for violations). Measured `populated_rows/total_rows`
  are owned by later core-import phases; static loader writes NULL.
- `STAT_COLUMNS` and `ROUND_TYPES` are legacy-input column/string mappings, not target
  reference data — they belong to the future fitzRoy adapter, not ported.

### Loader safety/determinism

- Zero `AFLDB_LEGACY_SQLITE` dependency (no `connect_legacy`, no sqlite import; pinned by
  test).
- Deterministic: pure function of the JSON datasets; `--print-plan` validates and counts
  without connecting.
- Idempotent: sources upsert by key; other groups truncate-and-reload, matching current
  schema semantics.
- **`sources.id` contract (verified 2026-08-25):** `sources.key` is the stable identifier;
  numeric ids are intentionally database-local. No repository code references a numeric
  `sources.id` literal — every consumer resolves ids at runtime via
  `SELECT id FROM sources WHERE key = ...` (`common.py` ImportBatch, all importers,
  `src/db/queries/*` admin/derived writers, `import-first-kick-goal.ts`). On an existing
  database the upsert preserves ids (so `import_batches`/alias FKs are safe); on a fresh
  rebuild, migrations 053/057/060/063 seed additional source keys before the loader runs
  and ids fall wherever insertion order puts them — which is fine, because nothing depends
  on the numbers. Migration 060 seeds `wikipedia_22under22`, which the loader's upsert
  then updates in place (no duplicate, key conflict handled).
- Fail-closed truncation: computes `cascade_dependents()` and refuses if CASCADE would
  empty any **populated** table this run does not rebuild (partial runs included — e.g.
  `--groups seasons` against a database with clubs loaded refuses); `--allow-cascade`
  overrides explicitly. Works unattended on a freshly migrated empty database.
- Clubs + aliases + organizations + relations land in one transaction (deferred
  self-referencing FK, orphan check), preserving the migration-021 guarantee.
- Coverage group refuses to load while `stat-availability.json` is `PENDING_EXTRACTION`.

### Baseline extraction — COMPLETED 2026-08-25

The old legacy-built `afldb_test` was preserved by rename to
`afldb_test_pre_rebuild_20260825` (kept with `ALLOW_CONNECTIONS false`; there is currently
no database named `afldb_test`). A guarded one-time read-only extraction ran against it:
connections temporarily enabled, explicit DSN derived from the test DSN with only the
database name changed (no env fallback), the script proved `current_database()` =
`afldb_test_pre_rebuild_20260825` and `transaction_read_only = on` before any query.
Evidence captured in the session scratchpad (`reference-baseline.json`). Results baked in:

- **stat-availability.json → `READY`**: full coverage grid, 88 contiguous ranges over 24
  stat keys × 130 seasons (1897–2026, 3,120 rows when expanded). Zero baseline rows
  violate the `is_recorded = coverage IN ('complete','partial')` rule the loader derives.
  Notable preserved semantics: Brownlow match votes `not_applicable` 1897–1923 and
  1942–1945 (no medal), `partial` 1931–1934, `not_collected` 1935–1941 and 1946–1983,
  `complete` 1984–2025, `pending` 2026; per-match stats' `partial` mid-1970s seasons;
  hitouts' fragmented 1966–1978 coverage.
- **clubs.json**: all 24 hand-encoded era spans confirmed exact against the baseline (no
  corrections needed). `wikipedia_url`/`afltables_slug` baked in for the 18 current
  identities; the six historical identities hold NULL in the baseline and stay null.
  Quirky baseline slugs preserved verbatim, not corrected: North Melbourne →
  `kangaroos`, Sydney → `swans`, Port Adelaide → `padelaide`, Western Bulldogs →
  `bullldogs` (triple-l — that is genuinely AFL Tables' URL spelling).
- **Aliases**: baseline holds exactly 48 rows, matching the loader's static derivation
  byte-for-byte (including GWS's `GWS` landing as `alternate` via the seen-set order) —
  confirms the legacy `club_now` pass contributes nothing.
- **Organizations/relations**: 21 organizations and 3 relations match the loader's
  derivation exactly (Sydney org 1897 via South Melbourne, Western Bulldogs org 1925 via
  Footscray; Bears/Fitzroy/University inactive).
- **Sources**: 11 rows = the 7 importer rows + 4 migration-seeded keys. One text
  discrepancy found: `wikipedia_22under22` description in the baseline carries an en dash
  ("2012–2026", from migration 060's seed) while the legacy importer constant has an ASCII
  hyphen — i.e. the legacy sources upsert never ran after migration 060. `sources.json`
  now carries the en-dash baseline/migration text so a rebuild's upsert cannot regress it.
- **Stat definitions**: 24 baseline rows match the dataset exactly (no generic `brownlow`
  key; `is_cumulative` true throughout; the rebounds/brownlow_match_votes display_order 90
  collision confirmed in the baseline and preserved).
- **Seasons**: 130 rows 1897–2026; league rule (VFL ≤ 1989) holds for every row; the only
  status/notes anomaly is 2026 `in_progress` with the import note — exactly what
  `seasons.json` encodes.
- **legacy_club_key**: the baseline holds text keys (e.g. `adelaide`, `north_melbourne`)
  for the 18 current identities. Decision unchanged: deliberately not carried into the new
  path (loader writes NULL) — it is legacy-SQLite provenance, unused by application code.
- One evidence-driven test correction: the 1935–1983 Brownlow-gap assertion in
  `tests/reference-data.test.ts` now expects `not_applicable` for the 1942–1945 war years
  inside the gap (the baseline's semantics), `not_collected` elsewhere.

### Phase-1 tracking correction (2026-08-25, during Phase 2)

`git check-ignore -v data/reference/sources.json` proved the `/data/*` rule was silently
ignoring the Phase-1 canonical datasets — they would not have survived a clean checkout.
Fixed narrowly in `.gitignore` with the existing opt-in pattern: `!/data/reference/` +
`/data/reference/*` + `!/data/reference/*.json` (only the curated JSON datasets opt in;
`data/sources/` and all other raw/generated data under `data/` remain ignored). The
canonical location stays `data/reference/`.

### Phase-1 closure record (2026-08-25)

1. `npx vitest run tests/reference-data.test.ts` — **12/12 PASS** (user-run).
2. Preserved baseline re-locked: `afldb_test_pre_rebuild_20260825 | ALLOW_CONNECTIONS =
   false` (user-verified). Reference-only from here on.
3. An actual load has NOT been executed anywhere — first real execution belongs to the
   later orchestrator phase (or an explicit user-authorised trial against a scratch
   `*_test` database), per §6/§10.
4. `sources.key` is the durable source-identity contract; numeric `sources.id` values are
   database-local and no repository code depends on literal numeric ids (verified — see
   the `sources.id` contract note above).

### Deviations from the approved architecture

None. One inclusion decision: `sources.json` keeps the `sports_data_lab` registry row as a
provenance record (its `sources` row is FK'd by historical `import_batches`); the new path
never reads from it.

---

## 16. Phase 2 implementation state — COMPLETE (2026-08-25)

Phase 2 (§13.2: fitzRoy core source acquisition) is **COMPLETE and validated**: version
pinned and verified, canonical acquisition path proven end-to-end by a real bounded
acquisition (`trial-2024`), field/coverage matrix evidence-backed by two real probes, and
the static contract suite (`tests/fitzroy-acquisition.test.ts`, **13 tests**) green. Phase
2 touched no database: zero PostgreSQL dependency, zero `AFLDB_LEGACY_SQLITE` dependency
(both pinned by tests). §13.3 (gap scoping) collapses to a no-op — verification found no
structural gap requiring separate scraping (`player_match_period_stats` stays deferred to
§13.7). Next: **Phase 3 = §13.4**, per `AFLDB-ISSUE-093-PHASE-3-HANDOFF.md`.

### fitzRoy version pin (§5)

- **Pinned: fitzRoy 1.8.0** — the current CRAN stable release, verified against the CRAN
  package index on 2026-08-25 (published 2026-08-23). Not the development branch.
- Mechanism: `pinned_version` in `tools/rebuild/fitzroy/fitzroy-contract.json`;
  `acquire_core.R` compares `packageVersion("fitzRoy")` at start and **fails closed** on
  any mismatch unless `--allow-version-mismatch` is passed; the installed + pinned
  versions and match flag are recorded in every probe output and manifest.
- Interface existence verified against the fitzRoy 1.8.0 reference index (2026-08-25):
  `fetch_player_stats_afltables()`, `fetch_player_details_afltables()`,
  `fetch_results_afltables()` all exist; `fetch_awards_brownlow()` exists as the
  documented independent Brownlow cross-check (not acquired in Phase 2). There is no
  AFL Tables fixture function (irrelevant to historical rebuild).
- **Column-level schema is deliberately UNVERIFIED until the probe runs** — nothing was
  assumed from documentation or model knowledge.

### Files

| File | Role |
|---|---|
| `tools/rebuild/fitzroy/fitzroy-contract.json` | Version pin + per-dataset field contract; every field carries a status in {SUPPORTED, SUPPORTED_WITH_COVERAGE_LIMITATION, WRONG_GRAIN, MISSING, UNVERIFIED} |
| `tools/rebuild/fitzroy/acquire_core.R` | Canonical acquisition adapter: `--probe` (schema evidence) and `--acquire` (raw CSV snapshot + tracked manifest); zero PostgreSQL / zero `AFLDB_LEGACY_SQLITE` |
| `tests/fitzroy-acquisition.test.ts` | Static contract/adapter validation — no network, no R, no database |

### Snapshot / manifest mechanics (§4)

- Working raw snapshots: `data/sources/afltables/fitzroy_core/<label>/` — gitignored via
  the existing `/data/*` rule (verified; no opt-in exposes it). Per-season
  `player_stats_<season>.csv` files, single `player_details.csv`, single `results.csv`.
- Tracked manifests: `docs/rebuild-manifests/afltables_fitzroy_core/<label>.json` with
  source, adapter + `adapter_schema_version`, installed/pinned fitzRoy version, extraction
  date/timestamp, requested season range, per-file dataset/filename/row-count/**SHA-256**/
  column list. An existing manifest label is refused (snapshot immutability — reacquire
  under a new label).
- Probe output: `data/sources/afltables/fitzroy_core/_probe/schema-probe.json` — actual
  columns/types/NA counts per dataset plus contract candidate-column match results.
- NULL semantics: raw values written exactly as returned (`na = ""`), never coerced to 0;
  `data/reference/stat-availability.json` remains the coverage authority.

### Probe run 1 — 2026-08-25 (fitzRoy 1.8.0, R 4.6.1, season 2024)

Static test gate passed first (`tests/fitzroy-acquisition.test.ts` 11/11, user-run).
Probe evidence: `data/sources/afltables/fitzroy_core/_probe/schema-probe.json`
(version match true, 2026-08-25T12:42:04Z).

- **`fetch_results_afltables(2024)` — OK, 216 rows, 16 columns**, all 0 NA: Game, Date,
  Round, Round.Type, Round.Number, Season, Home/Away.Team, Home/Away.Goals/Behinds/Points,
  Venue, Margin. **No Attendance column.**
- **`fetch_player_details_afltables()` — OK, 16,731 rows, 15 columns**: Player, Team, Cap,
  #, HT, WT, Games, Wins, Draws, Losses, Goals (4,437 NA — goalless-era NA preserved
  upstream), Seasons, Debut, Last, date_accessed. **No DOB, no stable ID, no profile-URL
  column.**
- **`fetch_player_stats_afltables(2024)` — FAILED** inside fitzRoy with R error
  `object 'dictionary_afltables' not found`. This is not a network/API failure: the
  data download itself succeeded (fitzRoy_data cache fetched); the error is an unresolved
  internal fitzRoy data object. The adapter called the function namespace-qualified
  (`fitzRoy::`) without attaching the package, which prevents lazy-data resolution of
  package datasets in some call paths — the leading concrete hypothesis. Fix applied to
  `acquire_core.R` (attach `library(fitzRoy)` at startup); probe re-run pending. If it
  still fails identically with the package attached, it is a genuine fitzRoy 1.8.0 defect
  to report upstream, and Phase 2 HALTs on the player_stats dataset rather than switching
  sources.

### Probe run 2 — 2026-08-25T12:47Z (attach fix applied) — SUCCEEDED

The attach hypothesis was proven: after `library(fitzRoy)` was added to
`acquire_core.R`, `fetch_player_stats_afltables(2024)` returned **9,936 rows, 78
columns** (probe run 1's `dictionary_afltables` error was the un-attached namespace
call, not a fitzRoy defect or network failure). A regression test now pins the attach.

player_stats columns relevant to Phase 2 (all 0 NA in 2024 unless noted): `ID` (integer
stable AFL Tables id), `First.name`, `Surname`, `Player`, `DOB` (character),
`url` (AFL Tables profile URL), `Jumper.No.`, `Playing.for`, `Season`, `Round`, `Date`,
`Local.start.time`, `Venue`, **`Attendance`** (integer), `Home.team`/`Away.team`,
`Home.score`/`Away.score`, quarter-by-quarter TEAM scores (`HQ1G`…`AQ4P`; `*ET*`
columns NA when no extra time), all 21 contract stat columns (actual name
`Time.on.Ground`, not `Time.on.Ground..`; `Disposals` extra), `Brownlow.Votes`
(integer, **414/9,936 NA** — not-applicable rows stay NA, not 0), `Age`,
`Career.Games`, `Coach`, `Substitute`, umpires.

### Field status matrix (after probe run 2 — evidence-backed)

| Target | Canonical dataset | Status |
|---|---|---|
| Player stable ID | player_stats (`ID`) | **SUPPORTED** |
| Player name | player_stats (`First.name`/`Surname`/`Player`) | **SUPPORTED** |
| Player DOB | player_stats (`DOB`) | **SUPPORTED WITH COVERAGE LIMITATION** — format + historical coverage to verify at acquisition |
| AFL Tables profile URL | player_stats (`url`) | **SUPPORTED** |
| player_match_stats (21 keys) | player_stats | **SUPPORTED WITH COVERAGE LIMITATION** — era coverage per `stat-availability.json`; NA stays NULL |
| Brownlow match votes | player_stats (`Brownlow.Votes`) | **SUPPORTED WITH COVERAGE LIMITATION** — correct per-player-per-match grain for `brownlow_round_votes`, totals derivable; historical coverage (1935–1983 gap etc.) still to verify |
| Match identity/season/round/teams/date | results + player_stats | **SUPPORTED** |
| Scores/results | results (+ quarter team scores on player_stats) | **SUPPORTED** |
| Venue | results + player_stats | **SUPPORTED** |
| Attendance | player_stats (`Attendance`; **absent from results**) | **SUPPORTED WITH COVERAGE LIMITATION** — match-level value carried at player-match grain (dedupe by match); historical coverage to verify |
| Player name (secondary) | player_details (`Player`, no ID) | SUPPORTED WITH COVERAGE LIMITATION |
| DOB via player_details | player_details | MISSING (in that dataset) |
| Debut/career span | player_details | SUPPORTED |
| `player_match_period_stats` | — | **MISSING — later investigation** (§12.2); note the probe DID reveal quarter-by-quarter **team** scores on player_stats, but no per-player quarter stats |

**§8 conclusion: confirmed.** One canonical `fetch_player_stats_afltables()` acquisition
supplies all five player sub-domains (stable ID, name, DOB, profile URL, match stats,
Brownlow votes) **plus attendance and match linkage**. No separate Brownlow, DOB or
identity scraper is needed. `fetch_results_afltables()` complements it at match grain
(and is the only place `Round.Type`/`Round.Number`/`Margin` are pre-computed);
`fetch_player_details_afltables()` adds debut/career span only.

"SUPPORTED" means the column exists with data at fitzRoy 1.8.0 for the 2024 probe
season; single-season probes cannot prove historical completeness — the full-range
acquisition measures that, with `stat-availability.json` as the coverage authority.

### Phase-2 validation record

1. Static test gate — DONE (`tests/fitzroy-acquisition.test.ts`, finally 13/13; grew from
   11 with the attach-regression and checksum-representation tests).
2. Probe — DONE (runs 1+2, 2026-08-25); §8 one-canonical-acquisition confirmed.
3. Bounded `--acquire` trial `trial-2024` (season 2024) — **DONE in two runs**:
   - Run 1: all three fetches/CSVs succeeded (9,936 / 16,731 / 216 rows) but manifest
     serialization failed with `No method asJSON S3 class: sha256`. Root cause: `digest`
     not installed on the host → openssl fallback, whose `sha256()` returns a classed S3
     object jsonlite refuses. Narrow fix in `sha256_file()`: openssl raw bytes are
     hex-formatted directly, both paths normalize via `tolower(unclass(as.character()))`,
     and a fail-closed gate rejects anything but a single plain `^[0-9a-f]{64}$` string.
     Retry semantics recorded: immutability anchors on the manifest, not working files —
     raw CSVs without a manifest are an incomplete acquisition, safely regenerated under
     the same label; only a completed manifest is immutable.
   - Run 2 (retry, 2026-08-25T12:56:36Z): **SUCCEEDED**. Manifest
     `docs/rebuild-manifests/afltables_fitzroy_core/trial-2024.json` verified complete
     against §4: source "AFL Tables via fitzRoy", adapter + `adapter_schema_version` 1,
     installed = pinned = 1.8.0 (match true), extraction date/timestamp, range 2024–2024,
     exactly three files with row counts 9,936 / 16,731 / 216 (26,883 total), full column
     lists (matching probe run 2), and three plain lowercase 64-hex SHA-256 checksums.
     Raw files remain in gitignored `data/sources/afltables/fitzroy_core/trial-2024/`.
4. Full-range historical acquisition is deliberately NOT part of Phase 2: it belongs to
   the accepted-baseline/import work of later phases (per the Phase-2 handoff boundary —
   Phase 2 proves the acquisition path and schema, not historical completeness). The
   coverage-limitation entries above record exactly what that later run must measure.

### Phase-2 importer notes (for the later core-import phase)

- `Brownlow.Votes` has the correct per-player-per-match grain for
  `brownlow_round_votes`; season/career totals are derivable; NA means not
  applicable/not recorded — never 0.
- `Attendance` comes from player_stats repeated at player-match grain — the importer
  must deduplicate by match.
- `player_details` supplies no DOB/stable ID/URL — supplemental (debut/career span)
  only; player_stats is the primary identity source.
- `library(fitzRoy)` must stay attached in the adapter: namespace-only invocation fails
  on `dictionary_afltables` resolution (regression-tested).

---

## 17. Phase 3 implementation state — IMPLEMENTED (2026-08-25), validation pending

Phase 3 (§13.4: club-list canonical wiring + ISSUE-092 §4 gate) is code-complete;
user-run validation not yet performed.

### A. Five-club canonical source wiring

`tools/migration/enrich_birth_dates_from_club_lists.py`:

- `--csv-dir` is now optional; when omitted the canonical directory
  `data/sources/afltables/club_lists/` (§4, repo-relative, gitignored) is used and all
  five expected `FILE_ORGS` filenames are REQUIRED — any missing file fails closed
  before any environment/database access. An explicit `--csv-dir` keeps the ISSUE-090
  partial/test semantics; `--require-complete` opts any directory into the five-file
  completeness contract.
- Required CSV headers (`Cap`, `Player`, `DOB`, `Games (W-D-L)`, `Goals`, `Seasons`)
  are validated per file, fail-closed, before connecting to anything.
- ISSUE-090 semantics (`FILE_ORGS`, file keys, `club-list:<key>:cap<n>` external IDs,
  reconciliation) are unchanged. Club-list evidence stays a separate evidence layer
  (`evidence_type = 'club_all_time_list'`); nothing merges it with the fitzRoy DOB
  source. Raw CSVs remain uncommitted (`data/sources/` gitignored), per §4.
- New static suite `tests/club-list-sources.test.ts`: pins the five filenames/source
  keys, the canonical directory, header contract, no-download guarantee, and the three
  fail-closed spawn paths (missing file, bad header, missing/empty directory) with no
  database.

### B. ISSUE-092 §4 fail-closed gate (see `AFLDB-ISSUE-092.md` for full semantics)

- Reusable helper `check_population_drop()` + `PopulationDropRefused` +
  `POPULATION_DROP_THRESHOLD = 0.10` in `tools/migration/common.py` — deliberately
  importer-agnostic so the future fitzRoy → PostgreSQL core importer (whichever adapter
  ends up owning `external_identities`, §9) reuses the same gate instead of duplicating
  it.
- `tools/migration/enrich_birth_dates.py`: gate wired before the `external_identities`
  DELETE (counts read in-transaction before the delete; check 1 empty-population refusal
  is NOT bypassable; check 2 >10% drop bypassable only via the new per-invocation
  `--acknowledge-population-drop`, logged via `Reporter.warn`). New `--source-key`
  override (default `afltables`) threads through the sources lookup, `import_batch`
  and every scoped read/write/delete.
- `tests/integration/dob-enrichment-issues.test.ts`: fixture source
  `afltables_issue090_fixture` seeded idempotently at runtime; `runRegister()` always
  passes `--source-key` (structural containment, §5); cleanup extended; new tests 24–27
  cover real-population containment, check-1 unconditional refusal + failed batch,
  check-2 refusal/acknowledgement, and the no-false-positive/recovery direction.

### Explicitly NOT done (per Phase-3 scope)

No fitzRoy PostgreSQL core importer, no `afldb_test` rebuild/load, no ISSUE-092 §6
recovery of the old database (obsolete for the rebuild path), no orchestrator, no
release-gate re-baselining, no CHANGELOG entry (ISSUE-093 still Open).

### Validation gate (user-run, pending)

1. `npx vitest run tests/club-list-sources.test.ts tests/fitzroy-acquisition.test.ts tests/reference-data.test.ts`
   — **PASS 33/33** (user-run 2026-08-25: reference-data 12/12, fitzroy-acquisition
   13/13, club-list-sources 8/8).
2. `npx vitest run tests/integration/dob-enrichment-issues.test.ts` — only against a
   database where that suite is safe to run (requires `AFLDB_TEST_DATABASE_URL`; there
   is currently no `afldb_test`, so this step waits for the rebuilt database or an
   explicit isolated `*_test` target).

### Next phase

**§13.4a — the historical/core PostgreSQL importer** (canonical fitzRoy snapshot →
normalized core tables), per `AFLDB-ISSUE-093-CORE-IMPORT-HANDOFF.md`. DraftGuru
(§13.5) follows it.

---

## 18. Phase 4a implementation state — §13.4a core importer IMPLEMENTED (2026-08-25),
##     validation pending

The historical/core PostgreSQL importer is code-complete; the first (non-DB)
validation gate is pending user-run tests. No database was touched and no live
database exists or is assumed.

### Files

| File | Role |
|---|---|
| `tools/migration/import_fitzroy_core.py` | Canonical snapshot + manifest → venues, players (+DOB evidence, external identities), matches (+period scores, attendance), player_match_stats, brownlow_round_votes. `--validate-only` runs the full manifest/snapshot validation and scan with zero database (and zero psycopg) dependency |
| `tests/fitzroy-core-import.test.ts` | Static contract pins + spawn tests of `--validate-only` against synthetic manifested snapshots (new file: no existing suite owns the core importer) |

### Inputs consumed

- `data/sources/afltables/fitzroy_core/<label>/` (`player_stats_<season>.csv` × N +
  `results.csv`; `player_details.csv` is deliberately NOT consumed — supplemental
  only, no ID/DOB/URL) and `docs/rebuild-manifests/afltables_fitzroy_core/<label>.json`.
- Canonical reference datasets: `clubs.json` (alias→identity resolution),
  `venue-canonical.json`, `stat-availability.json` (coverage authority; gates
  round-vote derivation seasons).
- Fail-closed BEFORE any DB access: manifest mode/label/adapter_schema_version (1),
  fitzRoy pin (installed = pinned = contract 1.8.0, match true), requested range,
  file presence, SHA-256, row counts, exact manifest-vs-CSV column equality,
  required columns.

### Identity decisions

- **Player identity**: AFL Tables profile URL, normalised to the
  `players/A/Name.html` path (same reduction as `enrich_birth_dates.py`),
  registered under (source `afltables`, `match_method='afltables_profile_url'`) —
  migration-018 semantics unchanged. fitzRoy numeric `ID` is the in-run grouping
  key only; ID↔URL must be 1:1 (either direction fails closed). Re-runs resolve
  existing players through external_identities, so player rows are upserted, never
  duplicated; names are never identity. `players.legacy_player_id` stays NULL on
  the new path.
- **Match identity**: `results.csv` is the canonical match structure. match_key =
  `season|round_code|date|home name|away name` (the current-season-import
  convention); matches upsert ON CONFLICT (match_key), source_record_id =
  results `Game`. player_stats rows join on (date, resolved home, resolved away);
  any join/season/round/score/venue disagreement fails closed. Rounds: results
  `R<n>` → round_code `<n>` + round_number; finals codes EF/QF/SF/PF/GF →
  round_type, round_number NULL (fitzRoy's finals Round.Number 26 is discarded).
- **Club resolution**: source string → identity via the clubs.json alias set;
  if the identity's own era does not contain the season (fitzRoy says "Footscray"
  in 2024), remap to the unique same-organization identity whose era does.
  No candidate or >1 candidate fails closed — mergers are separate organizations,
  so a pre-1997 "Brisbane Lions" string HALTs rather than becoming Brisbane Bears.

### Semantics

- **NULL ≠ 0 throughout**: empty CSV cells → NULL via `to_int`; explicit
  STAT_MAP (22 named column pairs incl. Disposals and Brownlow.Votes →
  brownlow_votes); `Time.on.Ground` has no player_match_stats column and is not
  imported; `Career.Games` → career_game_no (verified incrementing per match),
  `Jumper.No.` → jumper_number.
- **Attendance**: player_stats-only (absent from results); deduplicated to match
  grain; conflicting values (incl. value-vs-missing) between rows of one match
  fail closed; migration-020 provenance written (`complete`+afltables source when
  present, else `not_collected`/NULL).
- **Quarter scores**: HQ/AQ Q1–Q4 cumulative team scores → match_period_scores
  (dedup per match, disagreement fails closed; all-NULL periods write no row;
  extra-time columns not imported).
- **Brownlow**: Brownlow.Votes → player_match_stats.brownlow_votes at match grain
  (NA→NULL, never 0). brownlow_round_votes derived only for home-and-away rows
  with non-NA votes, in seasons whose `stat-availability.json`
  brownlow_round_votes coverage is complete/partial/pending (so 1931–1934 match
  votes stay match-grain only, matching the baseline's 1984+ round coverage).
  played=true; a 0 vote is a row, NA is no row. brownlow_season_votes is NOT
  written: its authoritative winner/rank/eligibility fields are not derivable
  from the snapshot (schema comment: season totals are their own authoritative
  source) — remains a later-source decision, recorded here deliberately.
- **DOB**: snapshot DOB (`2-Sep-1999` format) recorded in player_birth_evidence
  under source `fitzroy_afldata`, evidence_type `fitzroy_player_stats` —
  structurally disjoint from the afltables club-list/register evidence layers.
  players.dob is fill-if-missing only (dob_confidence/birth_year* set,
  dob_evidence_id linked); disagreement with an existing date or an internal
  multi-date conflict records evidence + warns, never overwrites and (by design,
  this phase) does not write ISSUE-090 dob_conflict payloads — that contract
  stays owned by the enrichment passes.
- **external_identities**: ISSUE-092 §4 gate reused verbatim
  (`check_population_drop` from common.py before the scoped reconciliation
  DELETE; check 1 not bypassable; check 2 via per-invocation
  `--acknowledge-population-drop`) + §5 `--source-key` containment (default
  `afltables`). URL-maps-to-different-player conflicts keep the stored row, warn,
  and file `external_identity_conflict` data_issues — same behaviour as the
  register pass.
- **Provenance**: batches per group — venues/players/matches/brownlow under
  source `afltables`, player_match_stats under `fitzroy_afldata` (mirroring the
  legacy importer's attribution split).

### Idempotency / retry safety

Keyed upserts (players via identity, matches via match_key, evidence via its
unique key, venues via legacy_name) plus scoped delete-then-COPY for the bulk
facts: player_match_stats deletes only rows of this snapshot's match ids;
brownlow_round_votes deletes only this snapshot's seasons. No TRUNCATE, no
global cleanup; rows owned by other paths (current-season pipeline, club-list
evidence) are never touched. Each group runs in one `import_batch` transaction
(rollback-on-exception marks the batch failed).

### Validation gate (user-run, pending)

1. `npx vitest run tests/fitzroy-core-import.test.ts` — static pins + fail-closed
   `--validate-only` spawn suite (no PostgreSQL, no psycopg, no network).
2. After (1) is green: `--validate-only` against the real `trial-2024` snapshot,
   then decide the fresh `afldb_test` creation step (user-operated).

#### Validation iteration 1 (2026-08-25) — 15/17 pass, 2 fail

First user run of gate (1): 15 passed, 2 failed.

Failure A (proven TEST defect, corrected same day): the static test
"keeps the fitzRoy DOB evidence source distinct from the club-list layer"
asserted `not.toContain('club_all_time_list')`, which false-positived on the
importer's explanatory comment documenting the intended provenance separation.
The comment is correct and was kept. The test was rewritten to prove the
functional contract instead: `DOB_EVIDENCE_TYPE = "fitzroy_player_stats"` and
`SOURCE_KEY_FITZROY = "fitzroy_afldata"` pinned; the evidence INSERT uses the
pinned constant; no import/invocation of `enrich_birth_dates_from_club_lists`;
no `club_lists` data-path reference; `club_all_time_list` never appears as a
Python string literal (bare comment mentions allowed). Importer code unchanged.

Failure B: detailed output not captured in the handoff. Source inspection of
all static pins and spawn-test expectations against the current importer and
reference data (stat-availability 2024 round-vote coverage `complete`;
Footscray→Western Bulldogs rename chain; Brisbane Bears `successor_hist: null`
so 1990 "Brisbane Lions" fails closed) found no provable defect. Cause remains
unknown pending the rerun of gate (1).

#### Validation iteration 2 (2026-08-26) — 16/17 pass; three corrections

Rerun of gate (1): 16/17 (iteration-1 corrections held). The remaining failure
output proved three issues, all corrected same day:

1. **Legacy-dependency test defect** — `not.toContain('AFLDB_LEGACY_SQLITE')`
   false-positived on the module docstring documenting the zero-legacy
   contract. Rewritten as a functional pin: no `import sqlite3`, no
   `connect_legacy`, no quoted `AFLDB_LEGACY_SQLITE` string literal, no
   environ/getenv/config lookup of it. Docstring kept.

2. **Attendance NULL semantics (implementation defect)** —
   `scan_player_stats()` treated value-vs-blank attendance across rows of the
   same match as a contradiction. Final semantics: blank = no observation;
   0 is a legitimate recorded value; zero non-null observations → NULL
   (`not_collected`, NULL source); exactly one distinct non-null value wins
   regardless of blank rows (`complete`, AFL Tables source); two distinct
   non-null values fail closed. New spawn test proves [40012, blank] → 40012
   and [blank, 0] → 0; the existing conflict test still proves
   [40012, 40013] → refusal. Match-level provenance behaviour unchanged.

3. **External-identity conflict HALT (implementation defect)** —
   `import_players()` previously kept a stored canonical-URL mapping that
   pointed at a different players.id, warned, wrote a data_issues row and
   continued. Now: the conflict check runs BEFORE the ISSUE-092 population
   gate, the reconciliation DELETE and the identity upsert, and raises a
   fail-closed RuntimeError ("external-identity conflict … refusing to
   reconcile"; import_batch rolls back and marks the batch failed). No
   heuristic choice, no name merge, no downgrade path remains. In-snapshot
   ID↔URL bijection checks unchanged. Behavioural DB proof deferred to the DB
   gate; the fail-closed structure (raise precedes the DELETE, downgrade code
   absent) is pinned statically in the test suite.

#### Validation iteration 3 (2026-08-26) — non-DB boundary COMPLETE (green)

1. `npx vitest run tests/fitzroy-core-import.test.ts` — **19/19 PASS**
   (iteration-2 corrections held; attendance semantics and identity-HALT
   pins green).
2. `python tools/migration/import_fitzroy_core.py --label trial-2024
   --validate-only` — **PASS** (0.3s, zero database access) against the real
   canonical snapshot. Scan summary reconciles exactly:
   - 9,936 player-match rows = 216 matches × 46 players;
   - 9,522 brownlow_round_vote rows = 207 home-and-away matches × 46 players
     (the other 9 matches are finals: 9,936 − 9 × 46 = 9,522 — NA-in-finals
     never counted);
   - matches_with_player_rows 216/216; attendance_known 216/216;
   - players 658, players_with_dob 658/658, players_with_dob_conflict 0;
   - venues 17; seasons 2024-2024; all 18 2024 club identities resolved
     (fitzRoy "Footscray" era-remapped to Western Bulldogs, no Footscray-era
     identity emitted);
   - no HALT condition hit.

**The Phase 4a non-DB validation boundary is complete.**

#### Fresh `afldb_test` bootstrap COMPLETE (2026-08-26)

The existing empty `afldb_test` (owner `afldb_owner`, zero user tables, no
old data) was retained rather than recreated; `pg_trgm`/`unaccent`
installed; `npm run db:migrate:test` applied the full tracked set — 71
files, `001`–`071`, 0 previously applied, all succeeded (an earlier note
claiming 001–072 was stale); `npm run db:privileges:test` reconciled
successfully (60 public tables; app 41 readable/19 revoked, import 39
writable/21 revoked, auth 32/32; backup-role NOTICE only). The preserved
`afldb_test_pre_rebuild_20260825` was untouched and stays
`ALLOW_CONNECTIONS=false`.

**Next boundary — DB execution (fresh session):** see
`AFLDB-ISSUE-093-CORE-IMPORT-DB-HANDOFF.md`. First action there is loading
Phase-1 reference data via `tools/migration/load_reference_data.py`, then
the core importer in dependency-safe order. No fitzRoy PostgreSQL import
has occurred yet; DraftGuru follows only after the core importer is
DB-validated.

### Explicitly NOT done

DraftGuru (§13.5 — follows this phase), awards/honours, player_match_period_stats,
`db:test:rebuild` orchestrator, release-gate re-baselining, brownlow_season_votes
population, dob_conflict issue payloads from the fitzRoy DOB source, any
database creation/mutation, CHANGELOG (issue remains Open).

---

## 19. CURRENT CHECKPOINT (2026-08-27) — CANONICAL FULL-HISTORY FITZROY SOURCE FROZEN

**A new session should read this section first, then stop and await the assignment.**
Everything above §19 is architecture and per-phase history. This section is the current
state. Where the two disagree, §19 wins.

Detailed evidence lives in `AFLDB-ISSUE-093-DRAFTGURU-B2-HANDOFF.md`
(PART I–XV = DraftGuru Stage B2; PART XVI–XVIII = full-history fitzRoy). That file's own
opening header is marked superseded; do not act on it.

### 19.1 What is DONE

| Area | State |
|---|---|
| Reference data + loader | COMPLETE (§15) |
| fitzRoy acquisition adapter, version pin 1.8.0 | COMPLETE (§16) |
| Club-list wiring + ISSUE-092 §4 gate | COMPLETE (§17) |
| fitzRoy core importer `import_fitzroy_core.py` | COMPLETE + validated (§18, §19.4) |
| **Canonical full-history fitzRoy source** | **FROZEN 2026-08-27 (§19.3–§19.5)** |
| DraftGuru Stage A acquisition | COMPLETE (§19.6) |
| DraftGuru supported importer + bridge resolution | COMPLETE (§19.6) |
| Legacy `tools/migration/import_draft.py` | RETIRED / tombstoned (§19.6) |
| Rebuild orchestrator `npm run db:test:rebuild` | IMPLEMENTED, never executed (§10, §19.7) |

### 19.2 What is NOT done — the rebuild is NOT complete

**No clean rebuild has ever been executed. No RESET_SQL has ever run. Every claim above is
proven offline only.** See §19.9.

### 19.3 The accepted canonical fitzRoy baseline

```
label      full-history-20260827
coverage   VFL/AFL men's senior competition, 1897-2025 inclusive
raw        131 immutable artefacts, 719,042 acquired rows
snapshot   data/sources/afltables/fitzroy_core/full-history-20260827/   (raw CSVs gitignored)
manifest   docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260827.json
```

**2026 is excluded because current-season ingestion owns it** — the contract derives the
last season as `seasons.json last_season (2026)` minus every `in_progress_seasons` entry
(`[2026]`), so the range moves on its own when 2026 completes. **AFLW remains entirely
separate** and is not part of this source or this range.

**Hash binding**

```
manifest SHA-256       cc8aaf0946fc59003dc4e5d6803410383db975e2f5bf58e9d510c31dc781e3b6
artefact-set SHA-256   8e14ce6198685b9fec568ab3c680cab34783e8e202ab0c7e93f45773d96f4125
```

The artefact-set digest is `sha256` over sorted `"<filename> <sha256> <row_count>"` lines
from the manifest's `files[]` — a second, independently recomputable binding to the same
bytes, so covering one does not cover the other.

**The original acquisition manifest is preserved byte-for-byte** (246,282 bytes, sha256
`cc8aaf09…`). It still carries its **historically incorrect self-declared**
`full_history: true` / `completeness: "full_history"` — the claim the independent validator
rejected, because the acquirer implemented a smaller gate set than the contract declares.
**Those acquisition verdict fields are INERT** and are never read as a verdict anywhere in
the supported path. Acceptance is a **separate tracked decision** (§19.5). Do not "fix" the
manifest; its mistake is the evidence.

### 19.4 Accepted validator measurements

```
matches                    16838      venues                     52
matches_with_player_rows   16838      attendance_known           15187
seasons                    1897-2025  club_identities            24
players                    13275      brownlow_round_vote_rows   320861
players_with_dob           855        players_with_dob_conflict  0
player_match_rows          685471
```

Identity scan:

```
source player_stats rows   685473     missing_url                0
missing_id                 83         malformed_url              0
distinct_ids               13270      distinct_urls              13275
```

Reading these: `matches_with_player_rows == matches` means every match joins.
`player_match_rows 685471 = 685473 - 2` — the two tracked 1909 drops (§19.5 item 4) and
nothing else. `distinct_urls == players` means one player per URL.
`13275 - 13270 = 5` is exactly the five players carrying no fitzRoy ID anywhere.

**Independent accepted-baseline validation PASSED with no PostgreSQL access:**

```
.venv/Scripts/python.exe tools/migration/import_fitzroy_core.py \
  --label full-history-20260827 --validate-only --require-accepted-baseline
```

### 19.5 Settled fitzRoy semantics — CLOSED decisions, do not reopen

1. **Identity.** The canonical **AFL Tables profile URL** is the durable player identity.
   The fitzRoy numeric ID is **optional** and is **not** persisted as canonical identity —
   83 rows (five players) carry none. A name is never identity, in any dataset, ever.
   *This supersedes the earlier §18 wording "fitzRoy `ID` in-run only, 1:1 enforced": the
   1:1 ID rule was removed once the 1897–2025 evidence existed.*
2. **Source-era normalisation.** raw `"Brisbane Lions"`, seasons **1987–1996** → canonical
   **Brisbane Bears**. All datasets. This is fitzRoy-source normalisation, **not** a global
   alias: Brisbane Bears and Brisbane Lions remain distinct identities, and the merger stays
   link-only per migration 017.
3. **Dataset-specific source-era normalisation.** dataset **`results`**, raw
   `"North Melbourne"`, seasons **1999–2007** → canonical **Kangaroos**. Scoped to `results`
   only, because `player_stats` already says "Kangaroos" in those seasons. Fixed 9,196
   unjoined rows across 198 match combinations → **0**, discarding nothing.
4. **1909 Jim Stewart source corruption.** Two spurious Cartesian-product rows are dropped
   under **exact tracked row fingerprints**; the **two genuine players remain distinct**
   (`Jim_Stewart0`, career game 68; `Jim_Stewart1`, career game 1). No dedup, no merge, no
   name matching, and `career_game_no` stays reliable globally.
5. **Blank `Player` transformation.** When `Player` is blank **and** `First.name` and
   `Surname` are both present, `display_name` is built from those existing structured
   fields (79 rows, 4 players, all 2025). A non-blank `Player` always wins; neither
   component present still fails closed. **This never participates in identity matching.**

Rules 2–4 are tracked in `tools/rebuild/fitzroy/fitzroy-contract.json`
(`source_club_normalisation`, `source_row_corrections`); rule 5 is in the importer; all are
listed in the acceptance register under `accepted_corrections`.

**The acceptance mechanism.** `data/reference/fitzroy-accepted-baselines.json`
(`contract: afldb.fitzroy.accepted_baselines`). Selection policy **`exactly_one_accepted`**:
**zero accepted fails closed; more than one accepted fails closed**; there is **no
latest-label, date or filename fallback anywhere**, in either the importer or the
orchestrator. The register **binds** (which acquisition, which hashes, which contract
version, which measured fingerprint) — **it never blesses**. Five independent gates run in
normal preflight: acceptance→manifest bytes; manifest→artefact list; manifest→raw bytes
(every artefact re-hashed); artefacts→full-history gates
(`--require-accepted-baseline` **implies** `--require-full-history`); artefacts→measured
fingerprint. A hand-edited acceptance record therefore cannot bless arbitrary bytes.

### 19.6 DraftGuru status

Supported importer **COMPLETE**: `tools/rebuild/draftguru/import_draftguru.py`, with
bridge resolution and the authority hierarchy **explicit human decision > admissible bridge
evidence > unmatched**. Automatic evidence never overrides a human decision.

Stage A accepted snapshot:

```
label     annual-html-20260826
pages     42 annual pages
rows      6,810
persons   5,057 distinct player_url values
```

The six explicit human/admin link decisions are exported to a tracked natural-key ledger,
`data/reference/draftguru-link-decisions.json`. The event/signing contract is frozen in
`data/reference/draftguru-event-kinds.json`.

`tools/migration/import_draft.py` is **retired and tombstoned** (exits 2, reads and writes
nothing, names its replacement, does not delegate) — kept rather than deleted because two
operator docs still print the command and running it against a rebuilt database would
replace Stage A data and wipe links.

**DraftGuru Stage B3** (the 5,057-person person-page crawl) remains **OPTIONAL and NOT
STARTED**, and is **NOT a blocker for the clean rebuild**. Do not start it.

### 19.7 Rebuild orchestrator

Canonical command — **`npm run db:test:rebuild`**. Stage order:

```
1 PRECHECK      2 DATABASE RESET   3 MIGRATIONS   4 PRIVILEGES   5 REFERENCE
6 FITZROY       7 DRAFTGURU        8 DERIVED      9 FINAL VALIDATION / FINGERPRINTS
```

**Normal mode selects the accepted full-history baseline automatically** — no
`--fitzroy-label`, no `--acknowledge-partial-fitzroy`:

```
fitzRoy label : full-history-20260827 (ACCEPTED canonical full-history baseline)
```

**The accepted/full-history validator runs in PRECHECK, before any destructive stage.**
`trial-2024` remains **partial/testing only under explicit opt-in**
(`--fitzroy-label trial-2024 --acknowledge-partial-fitzroy`); a bare acknowledgement is
refused, and a label that is not the accepted baseline is refused rather than honoured.
Destruction additionally requires `--acknowledge-destroy afldb_test`.

### 19.8 Current test state (2026-08-27)

**321/321 DB-free tests passed**, nothing skipped:

```
npx vitest run tests/fitzroy-core-import.test.ts tests/db-test-rebuild.test.ts \
  tests/draftguru-import.test.ts tests/draftguru-acquisition.test.ts \
  tests/fitzroy-acquisition.test.ts tests/reference-data.test.ts
```

plus the accepted-baseline offline validator (§19.4), which passed with no database access.

**That is the whole of the current green evidence. Do not claim more.** In particular:
`tests/integration/draftguru-import.test.ts` (18 DB-backed proofs) is **not** part of this
321 and needs a live test database; and the suite runs importers as `afldb_owner`, so
`afldb_import` grants are **not** proven at runtime (ISSUE-083).

### 19.9 REMAINING BLOCKERS — the rebuild is NOT complete

1. **AFLDB-ISSUE-083 — restricted `afldb_import` test-role parity / closeout.**
   **Being handled separately by Codex and NOT yet integrated into this working tree.**
   Until it lands, `AFLDB_TEST_IMPORT_DATABASE_URL` is unset and the orchestrator fails
   closed (or must be forced to owner with `--allow-owner-import-dsn`, which would leave
   import grants unproven). **Do not absorb this issue into ISSUE-093.**
2. ~~**`RESET_SQL` has never been proven against live PostgreSQL.**~~
   **CLOSED 2026-08-27** — the rollback-only proof passed with exact fingerprint equality
   through the real psql path. See §20 for the full record and the FIRST CLEAN REBUILD
   HANDOFF §H2–§H3 for the result and lineage.
3. **The first actual clean `afldb_test` rebuild has never been executed.** ← the only
   remaining blocker.

**Blocker 1 (ISSUE-083) is complete and parked separately at commit `fa035ed`; it is not an
implementation blocker to the rebuild (§H7). The next session owns blocker 3 ONLY: the
FIRST ACTUAL CLEAN REBUILD — see the FIRST CLEAN REBUILD HANDOFF at the end of this file.**

It must **NOT** start the clean rebuild until that proof is reviewed and executed. Blockers
1 and 3 are out of its scope.

### 19.10 Standing boundaries for the next session

Do not: run Git or commit; touch `afldb_dev` or production; use
`afldb_test_pre_rebuild_*` as a source; reacquire fitzRoy; modify any of the 131 raw
artefacts; rewrite the acquisition manifest; start DraftGuru Stage B3; absorb ISSUE-083;
reopen any decision in §19.5; or touch the unrelated worktree at `D:\dev\afldb-nl-semantic`.

The working tree carries intentional uncommitted ISSUE-093 work. Do not stash, reset,
restore or discard it.

---

## 20. BLOCKER 2 — SAFE RESET_SQL PROOF (2026-08-27)

**Status: BLOCKER 2 CLOSED — the live rollback-only proof PASSED (2026-08-27).** See the
FIRST CLEAN REBUILD HANDOFF §H2 for the passing run, and §H3 for the full lineage.

**The path there was not clean, and the record below is kept in full deliberately.** The
first attempt refused unexplainably (§20.9a); the second **committed the reset and wiped
`afldb_test`** (§20.12); the hardened proof then refused twice against its own observer
session (§20.14). Production and `afldb_dev` were never targeted at any point, and the loss
was schema-and-privileges only. `afldb_test` has since been reconstructed (migrations 001–072
+ privileges) and the proof re-run to a byte-identical fingerprint.

### 20.1 Two defects found while inspecting RESET_SQL — both FIXED

Both were found statically, before any live proof. Either alone would have made the first
clean rebuild fail or, worse, appear to succeed.

**Defect A — the reset was never sent to the server.** `runSql` was

```ts
void client.unsafe(sql);      // postgres.js
```

A postgres.js `Query` only executes when `.then`, `.catch`, `.finally`, `.execute()` or
`.forEach()` is called (`node_modules/postgres/src/query.js:140-155`: `handle()` is what
calls the handler, and `then/catch/finally/execute` are the only callers). `void expr`
calls none of them, so **no bytes ever reached PostgreSQL**, the `try/catch` around it could
never see a failure, and the DATABASE RESET stage would have reported success against a
completely untouched database — after which MIGRATIONS would have found every migration
already applied and every later stage would have loaded on top of the old data.

Fixed by running the reset through `psql` under `spawnSync`, which is synchronous (the whole
stage graph is, and Node cannot await inside it), returns a real exit code, and is already
this repository's SQL-script runner (`db:privileges:test`, `restore-test.sh`):

```
psql <dsn> -v ON_ERROR_STOP=1 --single-transaction -q -f -
```

`--single-transaction` also makes the real reset **all-or-nothing** — without it psql
autocommits each `DO` block and a failure halfway leaves a half-destroyed database.
The DSN is passed as an argument exactly as `db:privileges:test` already does; psql's error
text names relations and roles, never a password.

**Defect B — the `pg_` schema exclusion excluded nothing.** The schema loop had

```
AND nspname NOT LIKE 'pg\\\\_%'        -- inside a JS template literal
```

which reaches the server as `NOT LIKE 'pg\\_%'`. With `standard_conforming_strings = on`
that pattern is *backslash-backslash-underscore*: LIKE reads `\\` as a literal backslash and
`_` as any character, so it matches only names beginning `pg\`. **Nothing was excluded.**
`pg_toast` is present in `pg_namespace` in every database and passes the `NOT IN` list, so
the very first loop would have issued `DROP SCHEMA IF EXISTS pg_toast CASCADE` and aborted
on a pinned system schema.

Fixed with a regex, which has no escape to lose through two layers of quoting:

```
AND n.nspname !~ '^pg_'
```

### 20.2 Exact RESET_SQL object semantics (after the fixes)

Six `DO` loops, in this order. Every loop excludes extension members
(`pg_depend.deptype = 'e'`); the first three pg_class loops and the schema loop gained that
guard in this session — previously only routines and types had it.

| # | Loop | Selects | Statement |
|---|---|---|---|
| 1 | schemas | `pg_namespace`, not `pg_catalog`/`information_schema`/`public`, `!~ '^pg_'`, not an extension member | `DROP SCHEMA IF EXISTS %I CASCADE` |
| 2 | tables | `public`, `relkind IN ('r','p')`, not an extension member | `DROP TABLE IF EXISTS public.%I CASCADE` |
| 3 | views | `public`, `relkind IN ('v','m')`, not an extension member | `DROP VIEW`/`DROP MATERIALIZED VIEW … CASCADE` |
| 4 | sequences / foreign tables | `public`, `relkind IN ('S','f')`, not an extension member | `DROP SEQUENCE`/`DROP FOREIGN TABLE … CASCADE` |
| 5 | routines | `public`, not an extension member | `DROP ROUTINE IF EXISTS <regprocedure> CASCADE` |
| 6 | types | `public`, `typtype IN ('e','d','c')`, not an extension member, not a relation's composite type | `DROP TYPE IF EXISTS <regtype> CASCADE` |

**Removed:** the four application schemas (`staging`, `staging_aflw`, `aflw`, `afldb_meta`)
with everything in them — which is how **migration bookkeeping**
(`afldb_meta.schema_migrations`) goes; every table in `public` including partitioned parents
and their partitions; every view and materialized view; standalone sequences and foreign
tables; every non-extension routine and enum/domain/composite type. **Indexes, constraints,
defaults, triggers and per-object ACLs go with their owning object** — they are never
addressed directly, which is why nothing enumerates them.

**Preserved:** the `public` schema itself and its owner and ACL; **both extensions and every
object they own** (`pg_trgm`, `unaccent` — installed at host bootstrap,
`tools/maintenance/00_install_postgres.sh:98-99`, owned by `postgres`, living in `public`);
`pg_catalog`, `information_schema` and every `pg_*` internal schema; **`ALTER DEFAULT
PRIVILEGES` entries** (`pg_default_acl` is database-scoped, not attached to any dropped
object, and the bootstrap sets it); roles, role memberships and database-level grants.
Loop 4's classes exist for completeness: the migrations create no standalone sequence and no
foreign table (72 `CREATE TABLE`, 16 `CREATE VIEW`, 13 `CREATE TYPE`, 10 `CREATE FUNCTION`,
4 `CREATE SCHEMA`, 164 indexes, no trigger, no matview), so the loop normally finds nothing
— and the proof asserts it finds nothing left behind.

**Not addressed at all**, because nothing in AFLDB creates them: event triggers,
publications, subscriptions, collations, operators/operator classes outside extensions,
casts, large objects, tablespaces. Any of these appearing later would survive a reset; the
proof's post-reset census does not currently cover them.

`DROP SCHEMA public CASCADE` is still deliberately absent — the extensions live there and
are owned by another role, so it would fail on extension ownership
(`tools/maintenance/restore-test.sh:104-106` records the same reasoning).

### 20.3 Transactionality — every operation, individually

| Operation | Transactional? | Rollback restores | Caveat |
|---|---|---|---|
| `DROP SCHEMA … CASCADE` | Yes | The schema, its ACL/owner and every contained object | none |
| `DROP TABLE … CASCADE` | Yes | Catalog rows, the heap and its data, indexes, constraints, defaults, triggers, ACLs, owner-linked sequences | Relation files are unlinked at COMMIT, so a ROLLBACK unlinks nothing |
| `DROP VIEW` / `DROP MATERIALIZED VIEW` | Yes | Definition, ACLs, matview contents | none |
| `DROP SEQUENCE` | Yes | The sequence and its parameters | `nextval` is non-transactional in general; nothing here calls it, so `last_value` cannot move |
| `DROP FOREIGN TABLE` | Yes | Definition and options | none |
| `DROP ROUTINE … CASCADE` | Yes | Body, signature, owner, ACL | none |
| `DROP TYPE … CASCADE` | Yes | Type, enum labels, dependent columns via CASCADE | none |
| `DO $$ … $$` (plpgsql) | Yes | Nothing of its own — it only issues the DROPs above | A `DO` block **cannot** contain `COMMIT`/`ROLLBACK` when called inside an explicit transaction; **none does**, and a static test now enforces that |

Nothing in RESET_SQL is `CONCURRENTLY`, `DROP DATABASE`, `DROP TABLESPACE`, `VACUUM`,
`ALTER SYSTEM` or `CREATE INDEX CONCURRENTLY` — the operations that cannot participate.
**No operation is unsafe to include in the proof, so the proof is not partial.**

### 20.4 Concurrency and locking

A rolled-back reset is still a **write** transaction that takes `ACCESS EXCLUSIVE` on every
object it drops, in catalog order, and holds them until ROLLBACK. Consequences and handling:

| Risk | Handling |
|---|---|
| Application/test/importer connections | The proof **refuses to start** if `pg_stat_activity` shows any client backend on `afldb_test` other than itself. Fail-closed, no override flag — and checked **twice**: once from Node before psql is launched, once inside the psql transaction itself, since that is the session that takes the locks. |
| An autovacuum worker | **Reported, not refused** — the one exception. Nobody can "close" it: it appears and disappears on its own, holds only SHARE UPDATE EXCLUSIVE, and PostgreSQL cancels it automatically when it blocks DDL. Refusing on it would fail at random on an idle database, which is how a safety gate ends up weakened. `lock_timeout` bounds any interference. A client backend arriving alongside one still refuses. |
| An idle-in-transaction session holding a conflicting lock | Would block the reset. `SET LOCAL lock_timeout = '5s'` makes it fail fast instead of queueing. |
| The proof itself blocking others | Same lock_timeout, plus `statement_timeout = '300s'` and `idle_in_transaction_session_timeout = '60s'`, all `SET LOCAL` as the transaction's first statement. |
| Advisory locks | A session-scoped advisory lock can only be held by a session; with zero other sessions there are none. Covered by the exclusive-access gate rather than a second check. |
| Terminating offenders | **Never.** No repository contract authorises `pg_terminate_backend`, and a static test asserts the proof does not call it. The refusal prints pid / user / application / state so the operator can close them. |

The proof sets `application_name = afldb-reset-proof`, so its own backend is identifiable —
though it excludes itself by `pid <> pg_backend_pid()`, not by name.

### 20.5 EXECUTION-PATH PARITY — the gap found in review, and the correction

**The first design of this proof ran `RESET_SQL` through postgres.js inside a
`sql.begin()` transaction, while the real rebuild ran it through `psql`.** A passing proof
would then have demonstrated the SQL *semantics* and left the *mechanism* — the thing that
had just been found broken twice in §20.1 — completely untested. That is precisely the gap
this stage exists to close: the first clean rebuild must not be the first live exercise of
the actual reset path.

**Correction: one shared execution helper, `tools/db/psql.ts`.** Both callers go through
`runPsql(dsn, sql, deps)` and the single `psqlArgv()`:

```
psql <dsn> -v ON_ERROR_STOP=1 --single-transaction -q -f -
```

Same binary, same argument vector, same `error`/exit-status handling, in one place, with a
test that asserts neither caller assembles its own flags and that `psqlArgv` is defined
exactly once. The **only** intended difference between the two is the stream, which is where
the safety difference belongs:

| | real reset | proof |
|---|---|---|
| SQL | `RESET_SQL` | `buildProofSql()` — wraps the **verbatim** `RESET_SQL` |
| ends | normally → psql COMMITs | `RAISE EXCEPTION` → psql cannot commit |

Read-only observation (identity, sessions, the before/after catalog fingerprints) still runs
over postgres.js, outside psql and outside any transaction. Those are `SELECT`s against the
catalogs, not the reset; they need no execution-path parity, and keeping them in Node is what
lets the fingerprints be computed and compared exactly.

**The proof model:**

```
postgres.js (read-only)
  assert target NAME              (rebuild's own assertRebuildTargetName — imported)
  assert SERVER identity          (database, current_user, session_user, rolsuper x2)
  assert exclusive access         (pg_stat_activity)
  assert psql REACHABLE           (the reset's own argv, harmless SELECT 1)
  fingerprint BEFORE
psql — ONE transaction, --single-transaction, ON_ERROR_STOP=1
  SET LOCAL lock/statement/idle timeouts, client_min_messages = warning
  re-assert identity            in the SAME session that will run the reset
  re-assert exclusive access    in the SAME session
  snapshot extensions + every extension-owned object into TEMP tables
  emit the pre-reset counts
  << the verbatim RESET_SQL >>
  census: every rebuild-owned object class must be 0, public must remain, no bookkeeping
  extensions must equal the in-transaction snapshot, member for member
  RAISE EXCEPTION 'AFLDB-RESET-PROOF-ROLLBACK'      <- ALWAYS
postgres.js (read-only)
  require psql exit != 0 AND the sentinel AND every assertion marker
  cross-check the counts psql saw against the pre-reset fingerprint
  fingerprint AFTER, require exact equality with BEFORE
  health query
```

The extension snapshot lives in **temp tables**, which is stricter than the old cross-session
comparison: `pg_temp_N` is excluded by RESET_SQL's `!~ '^pg_'` schema guard and its table
loop is `public`-only, so the snapshot provably survives the very reset it checks, inside the
one transaction.

**Why it cannot commit — two independent guarantees.** The stream's last statement is always
`RAISE EXCEPTION`, reached only once every assertion has passed, so the success path aborts
exactly as any failure path does. Then: (1) psql under `ON_ERROR_STOP=1` with
`--single-transaction` stops at that error and does not commit the stream; and (2) even if a
`COMMIT` were somehow sent, **PostgreSQL rolls back an already-aborted transaction** — a
`COMMIT` on an aborted transaction *is* a rollback. The proof therefore treats **exit status
0 as a FAILURE**, with an explicit refusal saying the stream did not abort and the reset must
be treated as unproven.

Against **the existing `afldb_test`**, not a disposable database: §10 already records that no
DSN in the credential model can `CREATE`/`DROP DATABASE` — `afldb_test` is created once at
host bootstrap by `sudo -u postgres createdb -O afldb_owner`. Inventing a credential to make
a scratch database would add a privileged path that does not otherwise exist, and a scratch
database would not carry the real object graph, extensions or ACLs, so it would prove less.

**Separate entry point, not a rebuild flag.** `npm run db:test:prove-reset` runs
`tools/db/prove-reset.ts`, which has **no stage graph and spawns nothing of its own** — its
only subprocess is the shared psql helper, injected as a dependency. Overloading
`--acknowledge-destroy` for a rollback-only proof would make the operator's intent ambiguous
at the one moment it must not be. Falling through into migrations is not prevented by a
check — there is nothing to fall through *to*.

**ISSUE-083 does not gate this**, and neither does the fitzRoy acceptance register: the proof
needs only the owner DSN, loads no data, runs no importer, and commits nothing.

### 20.5a Owner / superuser policy — settled, and enforced as a refusal

The earlier draft *warned* on a superuser. That is now a **refusal**, in both the Node
pre-check and the in-transaction SQL, because the repository evidence leaves no room for it:

```
tools/maintenance/00_install_postgres.sh:54-57
  -- Roles. NOSUPERUSER/NOCREATEROLE everywhere: the app never runs as superuser.
  CREATE ROLE afldb_owner LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB;
```

and a repository-wide search finds **no `SET ROLE` anywhere** in `src/`, `tools/` or `tests/`.

| Property | Required value | On mismatch |
|---|---|---|
| `current_database()` | exactly `afldb_test` | REFUSE |
| DSN database vs server's answer | must agree | REFUSE |
| `current_user` (effective role — what ownership is checked against) | exactly `afldb_owner` | REFUSE |
| `session_user` (what the DSN authenticated as, unchanged by SET ROLE) | exactly `afldb_owner` | REFUSE |
| `pg_roles.rolsuper` for `current_user` | false | REFUSE |
| `pg_roles.rolsuper` for `session_user` | false | REFUSE |

A superuser-session-plus-`SET ROLE afldb_owner` configuration is **refused**: it is not
required by the actual credential model, and it would leave `session_user` holding superuser
authority that bypasses exactly the ownership rules the real reset depends on — masking a
failure the rebuild would hit. The refusal is not "superuser could not do this"; it is
"proving it under superuser would not prove the reset the rebuild will run".

### 20.5b psql availability preflight

Because the reset's execution mechanism is now explicitly psql, the proof fails **before**
`RESET_SQL` if psql cannot be used, and it never assumes `PATH` is correct:

* `runPsql` distinguishes **could not launch** (`spawnSync` returned an `error` — ENOENT,
  permissions) from **ran and failed** (non-zero exit), and raises `PsqlUnavailable` for the
  first, naming `psql` and pointing at the identical dependency `npm run db:privileges:test`
  and `tools/maintenance/restore-test.sh` already carry.
* `assertPsqlReachable` then sends a harmless `SELECT 1` **through the reset's own argv**, so
  a bad DSN, a refused connection or a failed authentication is reported before anything
  destructive is attempted. What is being proven is the mechanism, not the query.
* It runs after the identity and session gates and **before** the fingerprint work, so a
  missing psql costs nothing and reports immediately.
* Nothing is installed and nothing is auto-fixed. No DSN or password appears in any message:
  psql's own diagnostics name relations, roles and hosts, never the connection string it was
  handed.

### 20.6 The fingerprint contract

Twelve catalog sections plus migration bookkeeping, each an ordered list of one-line object
identities, hashed per section and then over the section digests:

```
schemas  relations  columns  indexes  constraints  routines  types  enum_values
sequences  extensions  extension_members  default_acls  migrations
```

Recorded per section: names, `relkind`/`typtype`/`prokind`, owner (`pg_get_userbyid`), ACL
text, column type OID + typmod + notnull + default/identity/generated flags, index columns
and uniqueness, constraint type and key columns, enum labels and sort order, sequence
start/increment/min/max, extension name + version + schema + owner, and every
`pg_depend deptype = 'e'` membership row. `migrations` is probed in two steps —
`to_regclass('afldb_meta.schema_migrations')` first, because a single statement naming that
table fails at **parse** time once the reset has dropped it, so a `CASE` guard would not save
it — and then records the applied count and the latest migration name.

Every query is **search_path independent**: identifiers are assembled from `nspname` plus the
object's own name, or from raw OIDs. Nothing uses `::regclass`, `::regtype`,
`::regprocedure`, `format_type()` or `pg_get_constraintdef()`, all of which render qualified
or bare depending on `search_path` and would make the two sides incomparable for no gain.

**Deliberately not hashed:** table contents (a ROLLBACK of a DROP leaves the heap untouched;
hashing 685k player rows would cost minutes and prove less than the schema equality does) and
sequence `last_value` (nothing calls `nextval`, and the definition is fingerprinted instead).

A mismatch names the drifted **sections** and prints no rows.

**The two sides.** The fingerprint is taken **before** the psql run and **after** it, both
from Node, and must be exactly equal — that is the rollback-restoration proof. Because the
reset now runs in a separate psql session, the old "the transaction sees the same state"
check became a **count cross-check**: the stream emits the schema, relation, extension and
extension-member counts it saw before the reset, and Node requires the relation count to
equal `beforeSections.relations.length`. It is compared against the sections already
collected, never against a fresh query — a post-rollback re-read would compare the wrong side
and mask real drift. The exclusive-access gate is what makes the two observations comparable
in the first place: no other client backend can change the database between them.

### 20.7 Post-reset and extension-preservation assertions

Inside the transaction, immediately after RESET_SQL — each count excludes extension members:

```
application schemas 0   tables 0   views+matviews 0   sequences 0
foreign tables 0        routines 0   enum/domain/composite types 0
afldb_meta.schema_migrations  ABSENT      public schema  PRESENT (exactly 1)
```

All of it is asserted **in SQL**, so the stream aborts on its own without needing Node to
notice; Node then re-asserts the same numbers from the emitted marker, so a stream that
reported a count its own `IF` did not act on still fails.

Extensions: before the reset, the same transaction copies `pg_extension` and every
`pg_depend deptype='e'` row into **temp tables**; after the reset it requires both to match
member for member, in both directions (`EXCEPT` each way). Temp objects live in `pg_temp_N`,
which RESET_SQL's `!~ '^pg_'` schema guard excludes and whose tables its `nspname = 'public'`
table guard never sees — so the snapshot provably survives the reset it verifies. The
expected set is **not hard-coded**: a static test asserts the words `pg_trgm` and `unaccent`
do not appear in the proof's code, so a third extension added at bootstrap is preserved and
proven with no code change. Membership is what makes this strict — it covers every function,
operator, operator class and type the extensions own, so dropping any single member fails
even though the extension itself would still be listed.

### 20.8 Files changed and DB-free tests

| File | Change |
|---|---|
| `tools/db/psql.ts` | **NEW.** The ONE psql execution path: `PSQL_BIN`, `psqlArgv`, `runPsql`, `assertPsqlReachable`, `PsqlUnavailable`. Both the destructive reset and the proof go through it. |
| `tools/db/prove-reset.ts` | **NEW.** The rollback-only proof: `buildProofSql()` (wraps the verbatim `RESET_SQL`), the identity/session/census/extension assertions, the fingerprints, and `assertProofOutcome` — pure/dependency-injected below the CLI. |
| `tools/db/rebuild-test.ts` | Defect A fix (`runSql` now via the shared `runPsql`); defect B fix (`!~ '^pg_'`); extension-member guards on the schema/table/view loops; new sequence + foreign-table loop; `assertRebuildTargetName` and `databaseOf` extracted and exported so the proof reuses the target contract instead of copying it. |
| `tools/db/catalog-fingerprint.ts` | **NEW.** The read-only fingerprint, extracted so a state verification can never pull in anything that could change state. SELECTs and pure functions only. |
| `tools/db/fingerprint-test.ts` | **NEW.** `npm run db:test:fingerprint [-- --expect <sha256>]` — read-only state verification (§20.11). |
| `tests/db-test-rebuild.test.ts` | +96 tests: 5 added to `reset semantics` (7 total), 1 to `wiring`, 82 in the `reset proof` suite (including a 7-test `connection lifecycle` block), and 8 in the `read-only fingerprint verifier` suite. |
| `package.json` | `db:privileges` and `db:privileges:test` moved off the DSN-first argv shape (§20.12). |
| `package.json` | `db:test:prove-reset` script. |

`npx vitest run tests/fitzroy-core-import.test.ts tests/db-test-rebuild.test.ts
tests/draftguru-import.test.ts tests/draftguru-acquisition.test.ts
tests/fitzroy-acquisition.test.ts tests/reference-data.test.ts`
→ **417/417 passed** (the §19.8 checkpoint of 321, plus the 96 new). `npx tsc --noEmit` shows
**no error in any file changed here**; 14 pre-existing error lines remain in
`tests/draftguru-acquisition.test.ts` and `tests/integration/draftguru-import.test.ts`
(`Buffer` vs `string` from `readFileSync`/`spawnSync` overloads, and one arity error) — not
touched by this session and not part of the vitest run.

The `reset proof` suite runs against a fake psql and a fake catalog. It covers:

**Execution-path parity** — neither caller assembles psql flags (`psqlArgv` is defined once);
a single test drives the real rebuild's destructive stage and the proof through one recorded
`spawn` and asserts **identical binary and identical argv**, differing only in the stream;
`RESET_SQL` reaches the psql path and never the read-only query path (the fake `query`
*throws* on anything that is not a catalog SELECT, so this cannot pass silently);
`buildProofSql()` contains `RESET_SQL` verbatim and the module never re-declares it.

**psql availability** — a launch failure (`ENOENT`) becomes `PsqlUnavailable` naming psql and
`PATH`; the probe uses the reset's own argv and its exact stdin; and, added after the failed
first live attempt, it **detects a psql that exits 0 without executing its stdin**, a path
where **ON_ERROR_STOP is not in force**, and **diagnostics that never reach this process** —
each with its own refusal. Only a path that delivered stdin AND surfaced the error passes. An
unavailable psql fails before any stream is sent and before the fingerprint work.

**Payload, not just argv** — `runPsql` passes the exact SQL bytes as `input` (present, a
string, byte-identical, non-empty); `-f -` appears exactly once with no `-c`; the real reset
hands the raw `RESET_SQL` body to the helper while the proof hands a stream containing it
verbatim plus the sentinel. This is the assertion whose absence let the 2026-08-27 failure
through.

**Commit trap and delivery** — the trap is armed before the reset, in a temp table, using a
deferred unique violation; the delivery marker precedes the trap and the reset; a truncated
stream that never reached the sentinel is refused; psql's own output is never discarded.

**No commit path** — the stream always ends in the sentinel `RAISE EXCEPTION` with nothing
executable after it; no `COMMIT`, `BEGIN` or `ROLLBACK` of its own; **exit status 0 is a
failure**; a non-zero exit without the sentinel is reported as a genuine failure carrying
PostgreSQL's own message; each of the five required markers missing is a refusal.

**Identity** — nine refusals, each asserting no stream was sent: non-`afldb_test`,
`afldb_dev`, production-looking, not `_test`-suffixed, server answering a different database
from the DSN, `current_user` not `afldb_owner`, `session_user` not `afldb_owner`, superuser
`current_user`, superuser `session_user`; plus the absence of the old warn-and-continue
behaviour, and `rolsuper`/`current_user`/`session_user` being re-asserted in the stream
before the reset.

**Concurrency** — a client backend refuses; an autovacuum worker is tolerated; a client
backend alongside an autovacuum worker still refuses; exclusivity and all three timeout
guards appear in the stream before the reset; no `pg_terminate_backend`/`pg_cancel_backend`
in either module.

**Post-reset and rollback** — nine census refusals (seven object classes, surviving migration
bookkeeping, removed `public` schema); the same assertions present in the SQL after the
reset; a non-integer census value; extension snapshot taken before and compared after; the
fingerprint mismatch refusal, a drifted section named without printing a row; and the
relation-count cross-check between what psql saw and the pre-reset fingerprint.

**Containment** — no stage graph, no `spawnSync` of its own, no migration/privilege/importer/
derived reference, no `AFLDB_LEGACY_SQLITE`, no `TRUNCATE` anywhere on the proof path, no
fitzRoy acceptance dependency, no import DSN, no options, and no DSN or password in any
diagnostic in either module.

### 20.9 The ONE command to execute

> **SUPERSEDED by §20.12.** The first live attempt committed the reset; `afldb_test` is now
> an empty clean slate (fingerprint `f46ce34c…`). Re-running the proof against an already
> empty database proves very little — the census would pass trivially. Decide the sequencing
> first (§20.13), then re-prove against a database that has a schema to lose.

Nothing else should be running against `afldb_test`.

```bash
npm run db:test:prove-reset
```

Expected success output (fingerprints and counts will differ):

```
AFLDB RESET_SQL proof (AFLDB-ISSUE-093 §20)
  mode          : ROLLBACK-ONLY — nothing is committed, nothing is rebuilt
  reset path    : psql (tools/db/psql.ts) — the same helper, binary and argv
                  the destructive rebuild uses
  database      : afldb_test
  role          : current_user afldb_owner, session_user afldb_owner, superuser no
  server        : 127.0.0.1:5432 PostgreSQL 16.x
  other sessions: 0 (exclusive access)
  psql          : reachable, and answered through the reset's own argv
  fingerprint   : <sha256>
  psql exit     : 3 (the deliberate abort — this is success)
  post-rollback : <the same sha256> (identical)
  health        : <n> relations, 2 extensions

  post-reset census (inside the aborted transaction):
    application schemas 0   tables 0   views 0   sequences 0
    routines 0   types 0   foreign tables 0   public schema kept yes
    extensions preserved 2, extension-owned objects <n>
    reset stream completed in <n> ms

RESET_SQL PROVEN through the real psql path — clean slate inside the
transaction, extensions intact, rollback restored the database
byte-identical by fingerprint.
THIS WAS A ROLLBACK-ONLY PROOF. Nothing was committed. Nothing was rebuilt.
```

**A non-zero `psql exit` on that line is the SUCCESS signal, not a fault** — the stream ends
in a deliberate `RAISE EXCEPTION`, which is what makes a commit impossible. Exit 3 is psql's
"script error" status. An exit of **0** would be reported as a failure.

Any other outcome prints `REFUSED: …` or PostgreSQL's own error, then
`Nothing was committed. The database is unchanged.`, and exits non-zero.

**Note on the expected state of `afldb_test` right now.** §19 records it as bootstrapped with
migrations 001–071 and privileges but **no fitzRoy data**. The proof does not care how full it
is — it proves the reset against whatever is actually there. A near-empty database still
exercises all six loops (four schemas, ~60 tables, the views, the enum types, the functions)
and both extensions.

### 20.9a FIRST LIVE ATTEMPT — 2026-08-27 — FAILED. Blocker 2 remains OPEN.

```
database      : afldb_test
role          : current_user afldb_owner, session_user afldb_owner, superuser no
server        : 127.0.0.1/32:5432 PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
other sessions: 0 (exclusive access)
psql          : reachable, and answered through the reset's own argv
fingerprint   : 0229d62cf768f986416e1eea222801391d793039070889d8af5294346b65cbd9
REFUSED: psql exited 0, which means the proof stream did NOT abort.
```

**What passed:** the target-name contract, the server identity gate (database, `current_user`,
`session_user`, both `rolsuper` checks), the exclusive-session gate, the psql availability
probe, and the pre-reset fingerprint. **The pre-proof fingerprint is
`0229d62cf768f986416e1eea222801391d793039070889d8af5294346b65cbd9`** — the baseline for any
later verification.

**What failed:** the deliberate abort did not happen. psql exited **0**.

**What the code proves, and what it does not.** Tracing the call graph:
`prove-reset.ts` → `deps.runPsql(buildProofSql())` → `runPsql(dsn, sql, psqlDeps)` →
`deps.spawn(PSQL_BIN, psqlArgv(dsn), { input: sql, encoding: 'utf8', cwd })`. **`input` is
present and is the SQL** (`tools/db/psql.ts:59-61`); `psqlArgv` contains `-f -` exactly once;
`buildProofSql()` embeds `RESET_SQL.trim()` and ends in the sentinel `RAISE EXCEPTION`. So
"a wrapper discarded the SQL argument" and "runPsql accepts the SQL but does not pass it" are
both **disproven by inspection**. The root cause is therefore at the psql process boundary —
and **the implementation destroyed the evidence needed to name it**: the refusal fired on the
exit status alone and never printed psql's stdout or stderr.

Two defects made the outcome uninterpretable, and both are now fixed:

1. **`assertPsqlReachable` proved nothing.** It ran `SELECT 1` and accepted exit 0 — but an
   empty or discarded stdin *also* exits 0, and so does an errored script when
   `ON_ERROR_STOP` is not in force. It could not distinguish a working path from one that
   silently drops the SQL, which is precisely the ambiguity that made this failure
   unexplainable.
2. **The parity test asserted argv, never the payload.** It recorded `opts.input` for both
   callers and then only asserted the two *differed* — never that either was non-empty, or
   contained `RESET_SQL`, or contained the sentinel.

**Could RESET_SQL have committed? Four hypotheses:**

| | Scenario | Commit possible? |
|---|---|---|
| **A** | psql received no SQL at all (empty/undelivered stdin) → exit 0, no output | **No.** Nothing ran. |
| **B** | psql received only PART of the stream | **YES, if the cut fell after RESET_SQL** — psql reaches EOF and `--single-transaction` COMMITs. |
| **C** | RESET_SQL executed but the sentinel never did | **YES**, same mechanism as B. |
| **D** | Whole stream ran, `ON_ERROR_STOP` not in force | **No.** The sentinel aborted the transaction; psql's closing COMMIT on an aborted transaction *is* a rollback. Exit 0 with no error propagation. |

**A and D are the likely readings and both are safe; B and C are not excludable from code
inspection alone.** Therefore the earlier line "Nothing was committed. The database is
unchanged." is **NOT established evidence**, and §20.11's read-only verification decides it.

**Fixes, so this cannot recur and cannot be dangerous:**

* **A commit trap, armed before the reset.** The stream now creates a temp table with a
  `DEFERRABLE INITIALLY DEFERRED UNIQUE` constraint and inserts a duplicate. Deferred
  constraints are checked **at COMMIT**, so from that point on any commit becomes an error —
  and therefore a rollback. This is a **server-side** guarantee: it does not depend on psql's
  flags, on `ON_ERROR_STOP`, or on the stream reaching its own sentinel. Scenarios B and C
  can no longer commit. It lives in `pg_temp_N`, which the reset cannot drop.
* **A delivery marker**, raised as the stream's very first statement. Its absence now proves
  psql never executed the stream, and the refusals for "never began" and "began but stopped"
  are different messages saying different things about database state.
* **A probe that proves the mechanism.** It deliberately raises, and demands back: the OK
  token (stdin was delivered and executed), a non-zero exit (`ON_ERROR_STOP` is in force),
  and the abort token (diagnostics reach this process). Any of the three missing is a
  refusal naming exactly which. Had this existed, the live run would have failed at the probe
  with a precise message instead of at the reset with a mystery.
* **psql's own words are never discarded** — every unexpected outcome now carries its stdout
  and stderr, which name relations, roles and hosts but never the connection string.

This matters beyond the proof: if this machine's psql does not receive stdin, then the **real
rebuild's** reset would silently do nothing and MIGRATIONS would then run against the old
database. The probe now blocks that too.

### 20.12 INCIDENT — the rollback proof COMMITTED the reset (2026-08-27)

**The read-only verification returned MISMATCH. `afldb_test` was wiped.**

```
pre-proof   0229d62cf768f986416e1eea222801391d793039070889d8af5294346b65cbd9
post-incident f46ce34c5689818fe149133a812bed2ea3d28f115bd48ca19214eb7b32c01881

schemas 1   relations 0   columns 0   indexes 0   constraints 0
routines 35 types 2       enum_values 0  sequences 0
extensions 3   extension_members 56   default_acls 0   migrations absent
```

**That state is exactly the intended post-RESET clean slate.** Only `public` remains among
non-system schemas (`staging`, `staging_aflw`, `aflw`, `afldb_meta` gone); zero application
relations, columns, indexes, constraints, enum values and sequences; `afldb_meta.schema_migrations`
absent; and **all three extensions plus all 56 extension-owned objects preserved** — the 35
surviving routines and 2 surviving types are theirs. (Three, not two: `plpgsql` is an
extension as well as `pg_trgm` and `unaccent`. §20.9's sketched output said two; that was
wrong and is corrected here.)

**So `RESET_SQL` is now empirically CORRECT against live PostgreSQL** — it produced precisely
the clean slate it was designed to produce, with the extension-preservation discipline
holding. **What failed is the rollback containment.** Blocker 2 is NOT resolved: a reset that
cannot be proven safe by rolling it back is still unproven, and it has now been demonstrated
the hard way.

**Reconciling the exit-0 refusal with the committed state.** The observation set is: psql
exited **0**; `RESET_SQL` **committed**; the sentinel `RAISE EXCEPTION` therefore never
errored. Working through it:

* The stream itself is clean and was **not** truncated by its own content. Dumping
  `buildProofSql()` and inspecting the bytes: 13,908 bytes, **0 CR, 0 backslashes, 0 NUL, 0
  Ctrl-Z, no line beginning with `\` (no psql meta-command, so no `\q`)**, dollar tags
  balanced (`$afldb_proof$` ×14, `$$` ×12), valid UTF-8. Nothing in it can be read as EOF.
* **The sentinel was syntactically valid.** It is not a bare top-level `RAISE` — that would
  be a syntax error, since `RAISE` is PL/pgSQL and not SQL. The stream's final bytes are
  `DO $afldb_proof$\nBEGIN\n  RAISE EXCEPTION 'AFLDB-RESET-PROOF-ROLLBACK: …';\nEND
  $afldb_proof$;\n` — a well-formed `DO` block. Had it executed, it would have errored.
* `input` **is** supplied to `spawnSync` and `-f -` **is** present, so the SQL was handed to
  the process.

Two families remain, and they are distinguished by whether psql applied its options:

| | | Fits the evidence? |
|---|---|---|
| **Options applied** (`--single-transaction` + `ON_ERROR_STOP=1`) | The sentinel would have errored → psql rolls back → non-zero exit. To commit, the stream must have been truncated between `RESET_SQL` and the sentinel — but nothing in the bytes can truncate it, and the transport is a single `spawnSync` buffer. | **Poorly** |
| **Options NOT applied** | No `BEGIN` is sent, so every statement **autocommits** — `RESET_SQL` commits the moment it runs. The census and extension blocks then pass trivially against the now-empty database, the sentinel raises, psql prints the error, and **without `ON_ERROR_STOP` psql still exits 0**. `-f -` being ignored changes nothing: psql reads stdin by default when it is not a tty. | **Completely — every observation, with no exotic mechanism** |

**Leading cause: the argument vector put the DSN FIRST.** psql's usage is
`psql [OPTION]... [DBNAME [USERNAME]]`, and psql does not always use GNU getopt:
PostgreSQL's own `src/port/getopt_long.c` — built wherever the system `getopt_long` is
absent, **Windows included** — **stops at the first non-option argument and does not
permute**. With `psql <dsn> -v ON_ERROR_STOP=1 --single-transaction …`, everything after the
DSN can be taken as an operand rather than an option, and psql only *warns* about extras. The
warnings would have gone to stderr — which the refusal discarded (§20.9a). This is stated as
the leading cause on the evidence, not as a confirmed one: the decisive stderr was destroyed,
and the fixes below do not depend on it being right.

**`db:privileges` and `db:privileges:test` used the identical shape** (`psql "$DSN" -v
ON_ERROR_STOP=1 -f …`). Both are now `psql -v ON_ERROR_STOP=1 -f … -d "$DSN"`. If the same
mechanism applied to them, past privilege reconciliations may have run without
`ON_ERROR_STOP` and reported success over errors — worth re-running once the rebuild lands.

**Fixes, in the order they now bite:**

1. **The DSN is an option, not an operand** — `psql -d <dsn> -v ON_ERROR_STOP=1
   --single-transaction -q -f -`. With no positional operand there is nothing for a
   non-permuting getopt to stop at. One `psqlArgv`, both callers, tested.
2. **The probe now proves the mechanism** (§20.5b): it deliberately raises and demands the
   stdin token, a **non-zero exit** and the error text. A psql that ignores `ON_ERROR_STOP`
   now fails **at the probe**, before the reset. This alone would have prevented the incident.
3. **The commit trap** (already added after §20.9a, and it is what makes truncation safe): a
   `DEFERRABLE INITIALLY DEFERRED` unique violation in a temp table, armed before the reset,
   turning any COMMIT into an error at the server.
4. **The trap doubles as an in-transaction detector.** In autocommit the deferred duplicate
   INSERT fails at its own statement end, so a new assertion immediately after it sees fewer
   than two rows and **stops the stream before the first destructive statement** with
   "this session is not in a transaction block". This closes the exact hole the incident went
   through, and it does so without relying on the diagnosis being correct.
5. **psql's output is always relayed, redacted** — connection strings and passwords are
   replaced before printing, so the next failure is diagnosable without leaking a DSN.

**Audit of the trap, as required.** Armed at stream position 0b, before `RESET_SQL`. Nothing
between it and COMMIT can disarm it: the stream issues no `SET CONSTRAINTS`, no `SAVEPOINT`
or `ROLLBACK TO`, no `DISCARD`, and no `DELETE`/`DROP` against the trap table; and
`RESET_SQL` cannot reach it, because its relation loops are `nspname = 'public'` only and its
schema loop excludes `^pg_`, which is where temp objects live. All six conditions are
asserted by DB-free tests.

### 20.14 SELF-COLLISION — the proof was its own "other session" (2026-08-27, reproduced ×2)

The hardened proof refused twice, identically:

```
AFLDB-PROOF received stream=begins
AFLDB-PROOF trap armed=2 rows
AFLDB-PROOF identity database=afldb_test current_user=afldb_owner session_user=afldb_owner
ERROR: AFLDB-PROOF sessions: 1 other client session(s) connected to afldb_test
```

while a standalone `psql … -c "SELECT … FROM pg_stat_activity WHERE … backend_type='client
backend'"` run seconds earlier returned **(0 rows)**, the harness's own Node-side gate
reported `other sessions: 0 (exclusive access)`, and the phantom session disappeared the
moment the proof exited.

**Root cause: the harness was the other session.** Confirmed from the connection lifecycle,
not inferred. The CLI opened **one** postgres.js client before calling `runResetProof` and
closed it only in a `finally` **after** the whole proof:

```
postgres(dsn)                     <- observer opens
  IDENTITY_SQL, OTHER_SESSIONS_SQL   (sees 0 others: it excludes itself via
  collectSections()  x13              pid <> pg_backend_pid())
  runPsql(buildProofSql())         <- psql connects as a SECOND client backend and
                                      correctly counts the observer as 1 other
  collectSections() x13, HEALTH_SQL
sql.end()                          <- observer closes, phantom "disappears"
```

Every observation is explained exactly: the Node gate excludes only *itself*, so it could
never see itself; psql is a different backend, so it could; and the standalone check saw
nothing because no Node process was running at the time.

**The gate was right. The harness was the intruder.** The exclusivity SQL is unchanged and
still fail-closed — the correction is to stop being a second session, never to whitelist one.
An `application_name` or PID exemption would have buried this bug and every future one like
it, so a test now asserts no such exemption exists in either the module or the stream.

**The corrected lifecycle — three phases, and nothing spans the psql run:**

```
PHASE 1  withSession(...)   identity, exclusivity, pre-reset fingerprint    -> CLOSED
PHASE 2  psql only          probe, then the proof stream                    no pg client
PHASE 3  withSession(...)   post-rollback fingerprint, health               fresh session
```

`ProofDeps` no longer carries a `query` handle at all; it carries `withSession`, which opens
a client, runs the callback and `await`s `sql.end({ timeout: 5 })` in a `finally`. There is
no longer a way to hand `runResetProof` a connection it could keep open, including on a
refusal path. Both psql invocations are synchronous `spawnSync` calls, so **the probe's psql
process has fully exited before the proof stream is sent** — a spawn cannot return while its
child still holds a backend.

One residual, stated rather than hidden: between `sql.end()` completing and psql connecting
there is a sub-millisecond window in which PostgreSQL might still list the departing backend.
`sql.end()` waits for the socket to close and process startup dwarfs backend teardown, so
this is theoretical; if it ever fires the proof simply refuses and is re-run. It is left
fail-closed deliberately.

### 20.13 Impact

| | |
|---|---|
| **Targets** | `afldb_test` only. **Production and `afldb_dev` were never contacted** — the target-name contract refuses both by name, and the run's own output names `afldb_test`. |
| **What was lost** | Schema and privileges only. §19 records `afldb_test` as migrations 001–071 (plus 072) with privileges reconciled, ~60 public tables, **no fitzRoy import ever performed** — no imported data existed to lose. Per-object ACLs went with their objects. |
| **Loss severity** | **Low.** `afldb_test` is by definition disposable and ISSUE-093 exists precisely to destroy and rebuild it. |
| **Safety-proof severity** | **High.** A mechanism whose entire purpose was to make the first reset non-destructive performed a destructive, committed reset. That is the failure that matters. |
| **ISSUE-093** | Blocker 2 remains OPEN. Silver lining: `RESET_SQL`'s semantics are now validated against live PostgreSQL (§20.12), and the destructive stage's psql path is proven to work end to end. |
| **AFLDB-ISSUE-083** | **Disrupted.** Codex is establishing restricted `afldb_import` role parity against `afldb_test`, which now has no schema and no per-object grants. That work needs migrations + privileges re-applied, or must wait for the rebuild. **Tell Codex before it runs anything against `afldb_test`.** |
| **Other test work** | Every DB-backed suite against `afldb_test` will now fail until schema exists: `tests/integration/*`, ISSUE-090's dob-enrichment suite, ISSUE-092 §11 tests 24–27, and the 18 DB-backed DraftGuru proofs. All were already blocked on a live test database; they are now blocked more definitely. |

**Restoration is neither necessary nor supported.** `afldb_test_pre_rebuild_20260825` is
preserved read-only reference and §19.10 explicitly forbids using it as a source. There is no
authorised backup of the wiped state, and it held nothing that the rebuild would not recreate.
**The empty `afldb_test` should be treated as the clean rebuild's starting state** — which is
what stage 2 of the rebuild would have produced anyway. Restoring schema sooner, if ISSUE-083
needs it before the rebuild, is `npm run db:migrate:test` followed by
`npm run db:privileges:test`: the documented bootstrap, and the user's call, not this
session's.

### 20.11 READ-ONLY VERIFICATION — `npm run db:test:fingerprint`

`tools/db/fingerprint-test.ts`, with the fingerprint implementation extracted to
`tools/db/catalog-fingerprint.ts` so the verifier and the proof compute **the same digest
from one implementation** — if they could drift, a "MATCH" would mean nothing.

It cannot change anything, and that is enforced rather than promised: the only SQL it can
reach is `catalog-fingerprint.ts` (SELECTs and pure functions); it never calls `runPsql`,
never references `RESET_SQL` and spawns nothing; and it issues
`SET default_transaction_read_only = on` **before** any query, so the server itself would
reject a write. A DB-free test checks every statement the path can send begins with `SELECT`
or `SET` and contains no DDL/DML verb.

A match proves no reset committed: RESET_SQL drops schemas, tables, views, sequences,
routines and types, every one of which the fingerprint covers. RESET_SQL performs no DML at
all, so row contents are not what needs proving here.

### 20.10 Rollback guarantees, and what remains after a pass

* Success path: every assertion passes, the stream raises the sentinel, psql aborts the
  transaction and exits non-zero; Node requires the sentinel **and** all five markers before
  calling it a pass.
* Assertion failure inside the stream: `ON_ERROR_STOP=1` halts at the first error, the
  transaction is aborted, and the reset is never committed. Node reports PostgreSQL's own
  message and exits non-zero.
* PostgreSQL error during RESET_SQL itself: identical — aborted, not committed, reported.
* `statement_timeout` / `lock_timeout` firing: an error, therefore an abort.
* Connection loss or a killed process: the server aborts the uncommitted transaction.
* A `COMMIT` reaching the server anyway: PostgreSQL rolls back an aborted transaction, so it
  would still not commit.
* **Exit status 0**: treated as a FAILURE and refused with an explicit "the stream did not
  abort — treat the reset as UNPROVEN and inspect the database" message.
* Post-rollback: the fingerprint is recomputed and must match **exactly**; a mismatch is a
  refusal that says `Do NOT run the rebuild`. "It rolled back" is never accepted as evidence
  on its own.

**After a passing proof, blocker 2 closes. Two blockers remain**, unchanged: ISSUE-083's
restricted `afldb_import` test-role parity (blocker 1, Codex, separate worktree), and the
first actual clean rebuild (blocker 3). Note that the defect-A fix means the DATABASE RESET
stage of `npm run db:test:rebuild` has itself never run in any form — the proof is the first
time RESET_SQL reaches a server at all.

**Residual risks the proof does NOT cover**, stated rather than hidden:

1. Object classes AFLDB does not currently create (event triggers, publications, collations,
   casts, large objects) are neither dropped nor censused.
2. The proof runs against `afldb_test` as it is today. If a future database contains an
   extension-owned **table** in `public`, loop 2's new guard skips it — correct for the
   extension, but the migrations would then re-run against a surviving table. Nothing in
   AFLDB installs such an extension today.
3. The proof exercises the psql path with `RESET_SQL` and the proof stream; it does not
   exercise psql's **commit** branch, because committing is the one thing it must never do.
   What remains unproven about the real reset is therefore exactly one step: that psql
   COMMITs a stream that did not raise. That is ordinary psql behaviour, it is the same
   branch `npm run db:privileges:test` uses on every run, and the proof does establish that
   the binary, the argv, the connection, the transaction envelope, `ON_ERROR_STOP`
   error-reporting and the entire `RESET_SQL` body all work.
4. Read-only observation still runs over postgres.js. If postgres.js and psql disagreed
   about what the catalogs contain — they cannot, being the same server — the fingerprints
   would be measuring a different database from the one reset. The relation-count
   cross-check between the psql stream and the pre-reset fingerprint exists to catch that.
5. `psql` must be on `PATH`. This is no longer an untested assumption: the proof probes it
   through the reset's own argv and fails closed before the reset (§20.5b).

---

# FIRST CLEAN REBUILD HANDOFF — 2026-08-27

> **SUPERSEDED — HISTORICAL.** The rebuild this handoff prepared for was executed on
> 2026-08-27 and **PASSED** (§H15); ISSUE-093 is **Resolved — 2026-08-27**. §H1–§H14 are
> retained as the durable execution and incident record. Where they describe pending work,
> pre-rebuild database state, or a "next action", **§H15 supersedes them.** The only remaining
> follow-up is **`AFLDB-ISSUE-095`** (canonical legacy-free ladder / team-season acquisition,
> §H15.5).

**A fresh session owning the first clean rebuild should read THIS section and §19, and needs
nothing else from the conversation that produced it.** §20 remains the full RESET record;
this section is the state to start from.

**RESET blocker 2 is CLOSED.** The live rollback-only proof passed with exact fingerprint
equality (§H2). The remaining blocker is the rebuild itself.

## H1. Current database state

| | |
|---|---|
| Target | `afldb_test` |
| Owner / effective role | `afldb_owner` (`current_user` = `session_user`, non-superuser) |
| PostgreSQL | 16.15 |
| Schema | **Reconstructed after the accidental reset of §20.12** |
| Migrations | **001–072 applied successfully** |
| Privileges | **Reconciled successfully** |
| Canonical data | **NONE. No canonical data rebuild has ever been run.** |

The database currently holds the **migrated schema and reconciled privileges only** — not the
completed canonical dataset. Reference data, fitzRoy core, DraftGuru and derived summaries
have never been loaded into it.

## H2. Final RESET proof — PASSED

```
pre-reset fingerprint     a8a2a899e431ced96afe2d80b4ec258b31533ae27c58791b5e8bf05e0bd0e1d7
post-rollback fingerprint a8a2a899e431ced96afe2d80b4ec258b31533ae27c58791b5e8bf05e0bd0e1d7
                          ^ EXACT equality — the rollback restored the database

health                    950 relations, 3 extensions
psql exit                 3  (the deliberate abort — the expected success signal)
reset duration            1498 ms
```

Inside the aborted reset transaction:

```
application schemas 0     tables 0        views 0          sequences 0
routines 0                types 0         foreign tables 0
public schema             PRESERVED
extensions                3 PRESERVED
extension-owned objects   56 PRESERVED
```

**RESET blocker 2 CLOSED.** `RESET_SQL` is now proven both ways against live PostgreSQL: it
produces exactly the intended clean slate with extensions intact (§20.12, learned the hard
way), and it rolls back to a byte-identical catalog fingerprint through the same psql path
the destructive rebuild uses.

## H3. RESET incident root-cause chain

Recorded in the order it actually happened. **This path was not clean and is not presented as
clean** — three separate defects and one live data-loss incident preceded the passing proof.

**Proven facts:**

1. The original postgres.js reset runner **never executed the query at all** —
   `void client.unsafe(sql)` returns a `Query` that only runs when `.then`/`.execute()` is
   called, so the destructive stage would have reported success against an untouched
   database (§20.1).
2. The `pg_` schema exclusion was **incorrectly escaped**: `NOT LIKE 'pg\\_%'` through a JS
   template literal reaches the server as a pattern matching `pg\` + any character, excluding
   nothing — `DROP SCHEMA pg_toast` would have aborted the first loop (§20.1).
3. **The first rollback proof COMMITTED `RESET_SQL`.** psql exited 0 without performing the
   deliberate abort; `afldb_test` was wiped (§20.12).
4. The committed reset left **exactly the intended clean slate** — `public` only, zero
   application relations, no migration bookkeeping, all 3 extensions and all 56
   extension-owned objects preserved. Pre-proof `0229d62c…` → post-incident `f46ce34c…`.
5. **Leading — but NOT forensically proven — cause:** the psql invocation put the **DSN
   first**, and PostgreSQL's own non-permuting `src/port/getopt_long.c` (built on Windows and
   wherever the system getopt_long is absent) stops at the first non-option argument, so
   `--single-transaction` and `ON_ERROR_STOP=1` can be swallowed as operands — leaving psql
   to autocommit each statement and exit 0 regardless of errors. This fits every observation,
   but **the decisive stderr was discarded by the refusal path, so it could not be confirmed
   forensically.** Recorded as the leading explanation, not as fact. What *was* proven by
   inspection: the stream is byte-clean (13,908 bytes; 0 CR, 0 backslashes, 0 NUL, 0 Ctrl-Z,
   no psql meta-command line, balanced dollar tags), the sentinel was a syntactically valid
   `DO` block, and `input` / `-f -` were correctly supplied.
6. The psql invocation was hardened to **`-d <dsn>` with all options before it**, so no
   positional operand exists for a non-permuting getopt to stop at.
   `db:privileges`/`db:privileges:test` were moved off the same shape.
7. A **delivery / ON_ERROR_STOP probe** was added: it deliberately raises and requires the
   stdin token, a non-zero exit, and the error text — so a psql that discards stdin or
   ignores `ON_ERROR_STOP` fails *before* the reset.
8. A **deferred-constraint commit/autocommit trap** was added before the destructive SQL: a
   `DEFERRABLE INITIALLY DEFERRED` unique violation in a temp table, checked at COMMIT, so no
   truncation point can commit — and in autocommit its duplicate INSERT fails immediately,
   stopping the stream before the first destructive statement.
9. The proof's own postgres.js observer session **self-collided with the exclusive-access
   gate**: one client was held open across the psql run, so psql correctly counted it as
   "1 other client session". The Node-side gate could not see itself
   (`pid <> pg_backend_pid()`). Reproduced twice (§20.14).
10. The observer lifecycle was split into **pre-proof / psql-only / fresh post-proof** phases;
    `ProofDeps` exposes a scoped `withSession` rather than a connection handle, so nothing can
    span the reset. **No session was exempted by application_name, PID or role** — the gate is
    unchanged and still fail-closed.
11. The **final live rollback proof passed** with exact fingerprint equality (§H2).

## H4. Accepted fitzRoy baseline

```
label            full-history-20260827
coverage         men's VFL/AFL 1897–2025 (2026 EXCLUDED — owned by current-season ingestion)
manifest         docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260827.json
registry         data/reference/fitzroy-accepted-baselines.json
manifest SHA256      cc8aaf0946fc59003dc4e5d6803410383db975e2f5bf58e9d510c31dc781e3b6
artefact-set SHA256  8e14ce6198685b9fec568ab3c680cab34783e8e202ab0c7e93f45773d96f4125
```

Selection policy `exactly_one_accepted`: zero accepted fails closed, more than one fails
closed, and there is no latest-label, date or filename fallback anywhere. AFLW is a separate
pipeline and is not part of this source.

**Final offline measured fingerprint:**

```
matches                   16838      venues                    52
seasons                   1897–2025  attendance_known          15187
matches_with_player_rows  16838      club_identities           24
players                   13275      brownlow_round_vote_rows  320861
players_with_dob          855        players_with_dob_conflict 0
player_match_rows         685471
```

**Identity:**

```
source player_stats rows  685473     missing URL           0
missing fitzRoy ID        83         malformed URL         0
distinct fitzRoy IDs      13270      distinct URLs         13275
```

The canonical **AFL Tables profile URL** is the durable player identity; the fitzRoy numeric
ID is optional and never persisted as canonical identity.

**Accepted semantic corrections** (CLOSED — do not reopen):

- **Brisbane** — raw `"Brisbane Lions"`, seasons **1987–1996** → canonical **Brisbane Bears**,
  all datasets. fitzRoy-source normalisation only; Bears and Lions remain distinct identities.
- **Kangaroos** — dataset **`results`** only, raw `"North Melbourne"`, seasons **1999–2007** →
  **Kangaroos**. Scoped to `results` because `player_stats` already says Kangaroos there;
  fixed 9,196 unjoined rows across 198 match combinations to 0, discarding nothing.
- **Jim Stewart 1909** — fitzRoy emitted a 2×2 Cartesian product for two distinct players in
  one match. **Exactly two** spurious rows are dropped under exact tracked row fingerprints;
  the two genuine players remain distinct (`Jim_Stewart0` career game 68; `Jim_Stewart1`
  career game 1). No dedup, no merge, no name matching.
- **Blank 2025 `Player`** — when `Player` is blank **and** `First.name` and `Surname` are both
  present, `display_name` is built from those structured fields (79 rows, 4 players, all
  2025). Display-name construction only; **never** participates in identity matching.

Corrections 1–3 are tracked in `tools/rebuild/fitzroy/fitzroy-contract.json`; correction 4 is
in the importer; all are listed under `accepted_corrections` in the registry.

## H5. DraftGuru state

**Stage A COMPLETE** — `annual-html-20260826`:

```
annual pages   42
years          1981, 1982, 1986–2025      (1983–1985 are INTENTIONAL source gaps)
rows           6,810
persons        5,057 distinct player_url values
```

**Stage B2 COMPLETE** — authority contract, event mapping, signing mapping, club mapping, the
explicit human link-decision ledger (`data/reference/draftguru-link-decisions.json`, six
decisions) and the supported canonical importer. Authority hierarchy: **explicit human
decision > admissible bridge evidence > unmatched**; automatic evidence never overrides a
human decision. Event/signing contract frozen in `data/reference/draftguru-event-kinds.json`.

```
supported importer   tools/rebuild/draftguru/import_draftguru.py
legacy               tools/migration/import_draft.py — RETIRED / TOMBSTONED
                     (exits 2, reads and writes nothing, names its replacement)
```

**Stage B3** (the 5,057-person person-page crawl) — **optional, NOT started, NOT a rebuild
blocker. Do not start it.**

## H6. Rebuild orchestrator

```
1 PRECHECK      2 DATABASE RESET   3 MIGRATIONS   4 PRIVILEGES   5 REFERENCE
6 FITZROY       7 DRAFTGURU        8 DERIVED      9 FINAL VALIDATION / FINGERPRINTS
```

Entry point — **`npm run db:test:rebuild`**. Normal mode selects the accepted full-history
baseline automatically (no `--fitzroy-label`, no `--acknowledge-partial-fitzroy`); the
accepted/full-history validator runs in PRECHECK, **before any destructive stage**;
destruction additionally requires `--acknowledge-destroy afldb_test`. `trial-2024` remains
partial/testing only under explicit opt-in.

**The destructive RESET stage now shares the proven psql helper and path** —
`tools/db/psql.ts`, one `psqlArgv`, the same binary and flags the rollback-only proof
exercised (§H2). It is no longer the postgres.js runner that never sent its query.

## H7. Separate issue state — do NOT absorb these into ISSUE-093

**AFLDB-ISSUE-083** — restricted `afldb_import` test-role parity.
Implementation **complete**; validation **complete before the RESET incident**; committed and
**parked separately at commit `fa035ed`**. **Not an implementation blocker to the clean
rebuild.** Later branch integration remains separate repository work.

**AFLDB-ISSUE-059** — grouped qualifying-count drill-down. Checkpoint `4444d76`, implemented,
**DB-backed validation still pending**.

**AFLDB-ISSUE-073** — FK-index gate. Checkpoint `0885129`, **DB-free 5/5 passed**, PostgreSQL
catalogue validation pending.

Do not merge, rebase or absorb these branches during the rebuild session.

## H8. First-clean-rebuild prerequisites

A fresh agent must verify all of these before the user executes anything destructive:

1. `current_database()` is **exactly** `afldb_test`;
2. `current_user` **and** `session_user` are **exactly** `afldb_owner`;
3. neither role is a **superuser** (`pg_roles.rolsuper` false for both);
4. **zero** other client sessions on `afldb_test` (autovacuum workers tolerated, nothing else);
5. **psql 16.15 available on PATH**, and proven to receive stdin and honour `ON_ERROR_STOP`;
6. required environment variables present — **never printed**, never echoed, no DSN or
   password in any diagnostic;
7. the **accepted fitzRoy baseline** resolves to `full-history-20260827` from the registry;
8. **DraftGuru Stage A** manifest and source artefacts present and SHA-256 verified;
9. **no `AFLDB_LEGACY_SQLITE` dependency** anywhere on the supported DraftGuru path;
10. the target is **not** production and **not** `afldb_dev`.

## H9. Failure policy

The rebuild session must **fail closed** on every one of:

wrong database · wrong role · superuser · concurrent client session · accepted-baseline
mismatch · manifest/hash mismatch · missing source artefact · migration failure · privilege
failure · importer failure · validation/fingerprint mismatch.

**There is no "continue anyway".** No stage may be skipped, weakened, or retried past a
failure to make the run complete.

## H10. Next phase

```
NEXT PHASE: FIRST ACTUAL CLEAN AFLDB_TEST REBUILD
```

The next agent **may inspect and prepare, but must NOT run the destructive rebuild itself.
The user executes the final command.**

Standing boundaries for that session: do not start DraftGuru Stage B3; do not access
production or `afldb_dev`; do not merge the parked issue branches (§H7); do not run Git; do
not reopen any decision in §19.5 or §H4; do not use `afldb_test_pre_rebuild_20260825` as a
source; do not reacquire fitzRoy or modify any of the 131 raw artefacts.

# H11. EXECUTION-BOUNDARY AUDIT — 2026-08-27 (before the first clean rebuild)

Scope: the exact command path the operator will run, on the machine that will run it.
Audited `package.json`, `tools/db/rebuild-test.ts`, `tools/db/psql.ts`, `.env` loading,
accepted-baseline selection, DraftGuru input discovery and all nine stage boundaries.
**No PostgreSQL was contacted, and no rebuild, importer, migration or Git command was run.**

Host: Windows 11, Git Bash, node `v22.21.0`, npm with **no `.npmrc` anywhere** (repository,
user, `%APPDATA%`, or npm's own `etc/`), so `script-shell` resolves to `null` → **`cmd.exe`**.

## H11.1 What the audit CONFIRMED as correct

| # | Question | Result |
|---|---|---|
| 3 | `.env` loading | **Safe.** `rebuild-test.ts:690` parses `.env` in Node, never sources it in a shell, and only fills variables that are unset. The Python stages' `common.load_env()` uses `os.environ.setdefault`, so the orchestrator's explicit `AFLDB_IMPORT_DATABASE_URL` overlay is **not** overwritten by `.env`'s development value. |
| 7 | RESET psql invocation | **Correct.** `psqlArgv()` emits `-d <dsn> -v ON_ERROR_STOP=1 --single-transaction -q -f -` — every option before the DSN, the DSN via `-d`, and the destructive stage calls the same `runPsql` helper the passing rollback proof used (§H2). |
| 8 | Baseline selection | **Correct.** Normal mode takes no label, `selectAcceptedBaseline()` enforces `exactly_one_accepted`, and there is no latest-label, date or filename fallback. Resolves to `full-history-20260827`. |
| 9 | DraftGuru inputs | **Correct.** Stage A label `annual-html-20260826` plus the three tracked Stage B2 files; `import_draft.py` is not referenced anywhere in the plan. |
| 10 | `AFLDB_LEGACY_SQLITE` | **Absent.** The only matches on the supported path are docstrings asserting its absence. |
| 11 | Silent continuation | **Impossible.** `executeRebuild()` returns at the first non-zero stage and names every stage not run. |
| — | Preflight validators | **DB-free as claimed.** `import_fitzroy_core.py --validate-only` and `import_draftguru.py --validate-only` both `return 0` *before* any `require_env("AFLDB_IMPORT_DATABASE_URL")`, so neither can reach `afldb_dev` through the inherited `.env` value. |
| — | DB-free contract suite | `tests/db-test-rebuild.test.ts` — **166/166 passed** (2026-08-27, this audit). |

## H11.2 F1 — BLOCKER: the MIGRATIONS and PRIVILEGES stages cannot run on this host

`db:migrate:test` and `db:privileges:test` are written in POSIX shell syntax, and npm on
Windows executes package scripts under **`cmd.exe`**:

```
db:migrate:test     AFLDB_MIGRATE_TARGET=test tsx tools/db/migrate.ts
db:privileges:test  psql -v ON_ERROR_STOP=1 -f tools/maintenance/privileges.sql -d "$AFLDB_TEST_DATABASE_URL"
```

Reproduced through the real `npm run` path in an isolated scratch package on this machine:

```
inline env assignment   'AFLDB_MIGRATE_TARGET' is not recognized as an internal or
                        external command, operable program or batch file.   exit 1
$VAR expansion          ARG=[$AFLDB_TEST_DATABASE_URL]                      exit 0
```

**Consequence, and it is the dangerous part:** the destructive RESET is stage 2 and
MIGRATIONS is stage 3. An unremedied run therefore **wipes `afldb_test` and then fails
immediately**, leaving the database empty with no schema. PRIVILEGES would fail the same way
one stage later — psql receives the literal string `$AFLDB_TEST_DATABASE_URL` as a database
name. Both are fail-closed failures rather than silent successes, but both are certain.

**Remedy, proven on this host, requiring no repository change:** set npm's script shell for
the invocation. `npm_config_script_shell=bash` was verified to fix both cases **and to
propagate into the nested `npm run` calls** that `rebuild-test.ts` spawns
(`spawnSync('npm', […], { shell: true, env: process.env })`):

```
inline env assignment   REACHED target=test        exit 0
$VAR expansion          ARG=[SENTINEL_VALUE]       exit 0
nested npm run          NESTED_OUT:REACHED target=test  NESTED_STATUS:0
```

`bash` resolves at `/usr/bin/bash` for the npm process when invoked from Git Bash.

**RESOLVED 2026-08-27 — the durable fix was taken, not the shell override.** The two scripts
are now cross-platform and the rebuild no longer depends on an operator-supplied shell:

```
db:migrate:test     tsx tools/db/migrate.ts --target test
db:privileges       tsx tools/db/privileges.ts --target dev
db:privileges:test  tsx tools/db/privileges.ts --target test
```

`migrate.ts` gained `--target <name>`; `AFLDB_MIGRATE_TARGET` remains supported and unchanged
for every documented invocation (the prod cutover included), and when both are supplied they
must **agree** — a disagreement is a refusal, because silently preferring one over the other
is the "guess which database to alter" failure the explicit-target rule exists to prevent.

New `tools/db/privileges.ts` resolves the DSN in Node from the same explicitly named targets
and passes it to psql as an argument. The psql invocation is otherwise **unchanged** — same
binary, same flags, same `-f tools/maintenance/privileges.sql`, same exit status — and it
deliberately does *not* route through `runPsql`, whose `--single-transaction -f -` envelope
belongs to the destructive reset and would change how `privileges.sql` executes. No DSN is
printed on any path. Script *names* are unchanged, so every existing document and runbook
that says `npm run db:privileges:test` remains correct.

The pre-existing test that asserted these callers keep off the getopt hazard was **relocated,
not weakened**: it now asserts the invariant where the argv is actually built, plus that
neither script depends on shell expansion.

## H11.3 F2 — BLOCKER: no restricted test import credential in this working tree

`resolveTarget()` refuses while `AFLDB_TEST_IMPORT_DATABASE_URL` is unset. The variable is in
neither `.env` nor `.env.example` on `dev`; ISSUE-083 is complete but **parked at `fa035ed`
and deliberately not merged** (§H7). This refusal happens before preflight and before any
destruction, so it is safe — but the rebuild cannot start until one of two paths is chosen:

1. **Set `AFLDB_TEST_IMPORT_DATABASE_URL`** to the `afldb_import` role against `afldb_test`.
   The privileges reconciliation already ran on `afldb_test` and granted `afldb_import` 39
   writable tables (§H1), so real import-role parity is exercised. A missing grant would then
   fail mid-run, after destruction.
2. **`--allow-owner-import-dsn`** — data stages run as owner. The run cannot then catch a
   missing `afldb_import` grant; the orchestrator prints that warning itself.

This is an operator decision, not a defect.

## H11.4 F3 — BLOCKER: the FINAL VALIDATION stage does no work

Stage 9 (`fingerprints`) is declared `run: 'internal'`, and `executeRebuild()` has **no branch
for `internal`** — the loop logs the stage name, records it as executed, and falls through.
`FINGERPRINT_QUERIES` (`rebuild-test.ts:670`) is exported and **never called by anything**.

So `Rebuild complete.` is printed immediately after DERIVED, on the strength of eight exit
codes and nothing else. Question 12 of the audit brief is therefore answered **no**: the run
cannot fail closed on "final validation mismatch" or "final fingerprint mismatch" (§H9),
because it performs neither.

This is a blocker, not a note. §H9 lists both mismatches as mandatory fail-closed conditions,
and a stage that cannot evaluate its own contract cannot enforce it.

(The same `internal` no-op applies to stage 1 in the loop, but there it is harmless: `main()`
calls `runPreflight()` separately, before the destructive acknowledgement is consumed.)

**RESOLVED 2026-08-27 — stage 9 is implemented.** It is now a `validate` stage: a distinct
`run` kind with its own `deps.runValidation`, deliberately separate from the destructive
`runSql`, so no edit to a single field can route a validation stream into the destructive
runner or the reset into the read-only one. It executes through the same proven
`tools/db/psql.ts` path.

**The expected values are not written into the runner.** They are read from the same tracked
acceptance register the fitzRoy preflight validates against
(`baselines[].measured`), so the offline gate and the database gate cannot drift apart, and
the DraftGuru counts come from the one `DRAFTGURU_EXPECTED` constant the preflight already
uses. This stage asserts the one thing the offline validator structurally cannot: **that the
database actually received that dataset.**

Gates (13): `matches` · `matches_with_player_rows` · `seasons_first` · `seasons_last` ·
`venues` · `attendance_known` · `club_identities` · `players` · `player_match_rows` ·
`brownlow_round_vote_rows` — each from the register — plus
`matches_after_accepted_last_season = 0` (the 2026 exclusion, derived from the register's own
`seasons_last`), `draft_persons` and `draft_picks`.

Scoping decisions, recorded because they are not obvious:

- `venues` and `club_identities` count identities **referenced by matches**, not
  `count(*)` over those tables, because `clubs` and `venues` also carry reference data this
  baseline never claimed to describe.
- `players` counts the **AFL Tables external identities**, not the `players` table: the
  canonical identity is the AFL Tables profile URL (§H4), and `players` also holds whatever
  canonical shells the DraftGuru stage minted afterwards.
- `players_with_dob` and `players_with_dob_conflict` are **deliberately not database-gated**
  — birth dates arrive through `player_birth_evidence` and DOB enrichment (ISSUE-090), so a
  raw count is not this baseline's claim. They stay gated offline. The skip is **explicit**:
  an unrecognised `measured` key is a refusal, so this gate cannot silently shrink when the
  register grows a key.

The stream reports every measured value through `RAISE WARNING` whether it passes or fails —
so the run's own output is the evidence, not a bare verdict — collects all failures and
reports them together, and ends in `RAISE EXCEPTION`, which under `ON_ERROR_STOP=1` is a
non-zero psql exit and therefore a failed stage. It performs no DML or DDL. The runner relays
the validation output on the **success** path too, since `RAISE WARNING` goes to stderr.

`FINGERPRINT_QUERIES` — six unscoped `count(*)`s with nothing to compare them against — was
removed rather than left as a decorative export.

## H11.5 F4 — the rebuild's own preflight omits the §H8 database gates

`runPreflight()` covers the fitzRoy validator, the three tracked DraftGuru files and the
DraftGuru `--validate-only` counts (42 year pages / 5,057 persons / 6,810 picks). It does
**not** cover §H8 items 1–5. Specifically, `rebuild-test.ts` never calls
`assertPsqlReachable`, and holds no `current_database()`, `current_user`, `session_user`,
`rolsuper` or `pg_stat_activity` check. Those exist only in `tools/db/prove-reset.ts`.

§H8 assigns these to the session rather than to the orchestrator, so they are satisfied here
by read-only operator commands before the destructive run — but the orchestrator gap is real
and is recorded, not assumed away.

## H11.6 F5 — the destructive reset carries no lock or statement timeout

`prove-reset.ts` sets `lock_timeout`, `statement_timeout` and
`idle_in_transaction_session_timeout` inside its stream (`:176-178`). The rebuild's
`RESET_SQL` sets none, and the rebuild has no exclusive-access gate (F4). A concurrent client
holding a lock would therefore block `DROP … CASCADE` indefinitely rather than failing.
Compensated for this run by the operator-verified zero-other-sessions check.

## H11.7 Verdict

**Audit verdict (before remediation): NOT READY — three blockers.** F1, F2 and F3 all had to
be cleared before any destructive command could be issued. F4 and F5 are compensated by
operator-run read-only checks and remain recorded as orchestrator gaps. Nothing in F1–F5
required redesigning the rebuild, and no decision in §19.5 or §H4 was reopened.

## H11.8 Remediation — 2026-08-27

| Finding | Decision | State |
|---|---|---|
| F1 npm/`cmd.exe` | Fix `package.json` now (not the shell override) | **RESOLVED** — see §H11.2 |
| F2 import credential | Set `AFLDB_TEST_IMPORT_DATABASE_URL` (real import-role parity) | **OPERATOR ACTION** — see §H11.3 |
| F3 stage 9 no-op | Implement the stage | **RESOLVED** — see §H11.4 |
| F4 preflight DB gates | Compensate with operator-run read-only checks | Recorded; orchestrator gap stands |
| F5 reset timeouts | Compensate with the zero-other-sessions check | Recorded; orchestrator gap stands |

**Files changed by the remediation:**

```
package.json                    db:migrate:test, db:privileges, db:privileges:test
tools/db/migrate.ts             --target <name>, and a refusal when it disagrees with the env var
tools/db/privileges.ts          NEW — cross-platform runner for privileges.sql
tools/db/rebuild-test.ts        `validate` stage kind, deps.runValidation, finalValidationChecks(),
                                buildFinalValidationSql(); FINGERPRINT_QUERIES removed
tests/db-test-rebuild.test.ts   16 new DB-free tests; the getopt-hazard test relocated, not weakened
```

**DB-free validation: `tests/db-test-rebuild.test.ts` 182/182 passed.** `tsc --noEmit` reports
no error in any file changed here; the pre-existing errors it does report are in
`tests/draftguru-acquisition.test.ts` and `tests/integration/draftguru-import.test.ts`
(`NonSharedBuffer` typing under `@types/node` 26, and one arity error) and are untouched by
this work.

**Remaining before the first clean rebuild:** F2 (operator sets
`AFLDB_TEST_IMPORT_DATABASE_URL`), `psql` on PATH, and the §H8 items 1–5 read-only checks.
No PostgreSQL was contacted, and no rebuild, importer, migration or Git command was run.

# H12. FIRST CLEAN REBUILD ATTEMPT 1 — FAILED AT REFERENCE (2026-08-27)

The first clean rebuild ran with the restricted import credential in place (F2 closed) and
**failed after destruction**, at stage 5.

```
PRECHECK          PASSED
DATABASE RESET    PASSED
MIGRATIONS        PASSED   72/72
PRIVILEGES        PASSED
REFERENCE         FAILED   psycopg.errors.InsufficientPrivilege:
                           permission denied for table player_link_match_candidates
Not run           fitzroy, draftguru, derived, fingerprints
```

Failure path: `load_reference_data.py -> guard_cascade() -> scalar(pg, "SELECT count(*) FROM {t}")`.

**This is not a regression from §H11.** It is the F2 residual risk landing exactly where it
was predicted to: the restricted role is now being exercised for the first time, and it works
— it correctly denied a read the import role is not meant to have.

## H12.1 Root cause

`guard_cascade()` refuses to `TRUNCATE ... CASCADE` if the cascade would empty an out-of-scope
table that holds rows. To decide "holds rows" it ran `SELECT count(*)` over **every transitive
FK dependent** of its truncate roots (`seasons`, `clubs`, `club_aliases`, `stat_definitions`,
`stat_availability`).

That closure is not a small set of statistical tables. It is 30 relations, and it includes
admin and link-review relations that `afldb_import` is **deliberately denied**.

The mechanism is `tools/maintenance/privileges.sql:222-252`, and it is working as designed:

- for a **base table**, `afldb_import` is granted `SELECT` **only** via
  `afldb_meta.import_writable_tables`. The `app_readable_tables` registry is consulted **only
  for views and matviews** — so being app-readable grants the import role nothing;
- migration 045 seeded `import_writable_tables` from every public base table that existed
  **at that time**, minus an explicit auth/submission exclusion list;
- therefore **every base table created after 045 is revoked from `afldb_import` unless its
  migration calls `afldb_meta.grant_import_write()`**.

`player_link_match_candidates` is created by migration **067**, which calls
`grant_app_read('player_link_match_candidates')` and **not** `grant_import_write`. Migration
070's own commentary shows this was reasoned about rather than overlooked: it contrasts
`player_link_suggestions` with "the match-candidate cache", which "is read keyed by the entity
ids currently on the page … so an orphan there is never fetched". The cache is admin-owned
state the ETL has no business reading.

## H12.2 Answers to the five questions

**1. Is `player_link_match_candidates` intentionally unreadable to `afldb_import`?**
**Yes.** By the 045 mechanism, by migration 067's deliberate `grant_app_read`-only
registration, and by migration 070's explicit reasoning about that exact table.

**2. Can `guard_cascade` fail again table-by-table?**
**Yes, and it would have.** The complete closure, computed DB-free from the migration SQL
(truncate roots → transitive FK children, minus `GROUP_REBUILDS`), is **30 relations**:

```
award_nominations  award_winners  awards  brownlow_round_votes  brownlow_season_votes
captaincies  club_seasons  draft_persons  draft_picks  external_identities
father_son_selections  hall_of_fame  honour_team_members  match_period_scores  matches
player_achievements  player_birth_evidence  player_career_stats  player_clubs
player_link_match_candidates  player_link_resolutions  player_match_period_stats
player_match_stats  player_name_aliases  player_relationships  player_season_stats
stat_availability  venue_aliases  venues
```

(`player_season_stats` is the pre-015 name; migration 015 renamed it to
`player_club_season_stats`. Both are pre-045 and therefore seeded writable.)

Of those, exactly **two** are unreadable to `afldb_import`:

| Relation | Created | Registration | Path to a truncate root |
|---|---|---|---|
| `player_link_match_candidates` | 067 | `grant_app_read` only | `.player_id → players → clubs/seasons` |
| `player_match_period_stats` | 062 | **neither** | `.club_id → clubs` (direct) |

`outside` is sorted, so `player_link_match_candidates` failed first and
**`player_match_period_stats` was the next failure**. A one-table grant would have bought
exactly one stage-5 attempt. `player_link_resolutions` is also in the closure but reads fine —
`privileges.sql` grants it `SELECT` explicitly (migration 068).

**3/4. Chosen repair, and would a broad grant weaken ISSUE-083's model?**
A broad `GRANT SELECT` would weaken it materially: the fail-closed import-role model is the
whole point of 039/045, and widening it to satisfy a *guard* — not a data need — inverts it.
Rejected. See §H12.3.

**5. Does the reference loader need to inspect these relations during a clean rebuild?**
**No — and this is the key fact.** On a clean rebuild every table is empty, so there is no
data anywhere for `CASCADE` to destroy and nothing for the guard to adjudicate. The guard was
doing expensive, privileged work to answer a question that could not have had a dangerous
answer.

## H12.3 Rejected alternatives

| Option | Rejected because |
|---|---|
| Grant `SELECT` on `player_link_match_candidates` | Whack-a-mole: `player_match_period_stats` fails next. Also grants a read for a guard, not a need. |
| Grant `SELECT` on both | Same in principle, and still not a contract: the next post-045 table in the closure re-breaks it. Weakens 039/045. |
| Grant `SELECT` on all 30 closure members | Directly inverts the fail-closed model ISSUE-083 exists to defend. |
| A second owner/read-only connection for the safety check | Introduces an owner connection into a run whose entire purpose is to exercise the restricted role, and creates a path that could drift into owner writes. Violates "no fallback to owner writes". |
| Run the reference stage with `--allow-cascade` | Turns a safety refusal into a flag. It would also mask a genuinely populated database. |
| `pg_class.reltuples` instead of `count(*)` | An estimate, and stale immediately after a reset. Not fail-closed. |

## H12.4 Chosen repair

Two changes, both inside the loader's own layer. **`privileges.sql` is not touched, no grant
is added, and no relation becomes readable that was not readable before.**

**(a) The guard asks the catalogue, then refuses what it cannot prove.**
New `common.selectable(conn, tables)` classifies relations with `has_table_privilege(t,
'SELECT')` — which requires no privilege on its argument — in one round trip.
`guard_cascade()` now counts rows only in dependents it has proven readable, and **refuses**
on any unreadable dependent, because a table it cannot read is a table it cannot prove empty.
That is strictly more fail-closed than before, where the same situation was an unhandled
exception.

**(b) A truncate whose targets are already empty is skipped.**
`TRUNCATE a, b CASCADE` requires `TRUNCATE` privilege on **the whole cascade set**, not merely
on the tables named — so even with the guard fixed, the statement itself would have been
denied on the same two relations. New `reload_truncate()` skips the statement when every named
target is already empty. Truncating an empty table removes nothing, so this is exactly
equivalent, and it asks for no privilege the role is not meant to hold.

`guard_cascade()` gains the same short-circuit: no truncate target holds a row means nothing
to cascade into, so it returns before classifying anything.

**Why this is the complete contract, not another patch:** on a clean rebuild the truncate
roots are *always* empty, so the guard returns immediately and no `TRUNCATE` is issued. No
relation in the closure is read or locked, and **a table added by a future migration cannot
reintroduce this failure.** On a populated database the guard still refuses, now with a clear
message instead of a traceback.

> ### ⚠️ THE PARAGRAPH ABOVE IS WRONG. See §H13.
>
> "On a clean rebuild the truncate roots are *always* empty" is **false**. Migrations 015 and
> 016 SEED `stat_definitions` and `stat_availability`, so a freshly migrated database is
> never fully empty and the short circuit could not fire. The §H12 repair was **necessary but
> not sufficient**, and the live proof that followed refused. The claim is left standing here,
> struck through rather than deleted, because the reasoning error — asserting a runtime
> property that only source-string tests had ever checked — is the point of §H13.

Required properties, each held: writes stay under `afldb_import`; no
`--allow-owner-import-dsn`; no owner fallback; least privilege (nothing granted);
`guard_cascade` fail-closed (strengthened); no production or dev impact; no legacy SQLite; no
Stage B3; no parked-branch merge.

## H12.5 Files changed and validation

```
tools/migration/common.py              + selectable(), + any_rows()
tools/migration/load_reference_data.py guard_cascade() rewritten; + reload_truncate();
                                       three group loaders call it; docstring updated
tests/reference-data.test.ts           + 10 DB-free source-contract tests
tools/maintenance/privileges.sql       UNCHANGED — asserted by a test
src/db/migrations/                     UNCHANGED — no new migration
```

The new tests pin the failure class, not the single table: one asserts the loader contains no
unguarded `count(*)` over a closure member; one pins the **complete list of post-045 tables
that never registered import write**, so a new one is a visible DB-free diff rather than a
surprise mid-rebuild; one asserts `privileges.sql` still grants neither of the two relations.

```
tests/reference-data.test.ts + tests/db-test-rebuild.test.ts   204/204 passed
python -m py_compile (both changed modules)                    OK
tsc --noEmit                                                   no error in any changed file
```

## H12.6 Database state and what happens next

`guard_cascade()` refuses **before any write**, so the REFERENCE stage wrote nothing.
`afldb_test` currently holds the freshly reset schema, migrations 001–072 and reconciled
privileges, and **zero rows** — which is precisely the state a rebuild reaches at the end of
stage 4. Nothing of diagnostic value is held in it; the entire diagnosis above was obtained by
source inspection with no database access.

The orchestrator has **no resume capability** (`parseArgs` rejects any unrecognised argument),
and adding one is not in scope. The next run is therefore a full clean rebuild, which is cheap
— RESET measured 1,498 ms, and migrations plus privileges are the only other work repeated.

Because the database already sits in the post-stage-4 state, the repair can be **proven
without any further destruction** by running the reference loader alone under the restricted
credential first. That is the recommended next step.

# H13. BOUNDED STAGE-5 PROOF 1 — FAILED SAFELY (2026-08-27)

The §H12 repair was proven non-destructively before any rebuild, exactly as intended, and
**the proof refused.** Nothing was written and nothing destroyed: the failure was caught by
the bounded proof rather than by a second destructive rebuild.

```
AFLDB_IMPORT_DATABASE_URL="$AFLDB_TEST_IMPORT_DATABASE_URL" \
  .venv/Scripts/python.exe tools/migration/load_reference_data.py

  target: afldb_import@127.0.0.1:5432/afldb_test      (correct)

ERROR: refusing to load reference data: TRUNCATE ... CASCADE would reach
player_link_match_candidates, player_match_period_stats, which this role may not
read, so they cannot be shown to be empty. ...
```

**§H12's claim that the repair was complete was wrong.** It is amended in place above rather
than deleted.

## H13.1 Root cause of the second failure

**A freshly migrated `afldb_test` is not empty.** Two migrations seed reference tables:

```
015_brownlow_grain_and_coverage.sql:181   INSERT INTO stat_definitions (...)
016_brownlow_grain_availability.sql:82    INSERT INTO stat_availability (...)
```

`stat_definitions` and `stat_availability` are **both truncate roots** of the loader's
`coverage` group. So on every freshly migrated database, two of the five roots hold rows.

## H13.2 The control-flow defect

`guard_cascade()` evaluated emptiness, and took its cascade closure, over the **union of every
group's truncate targets**:

```python
if not any_rows(pg, sorted(to_truncate)):                  # union: never empty
    return
dependents = cascade_dependents(pg, sorted(to_truncate))   # union: reaches clubs/seasons
```

while `reload_truncate()` decides **per group, at call time**. The two disagreed:

- the union is never empty (015/016), so the short circuit **could not fire**;
- the closure was therefore computed from all five roots, including `clubs`, `club_aliases`
  and `seasons` — which were empty, whose truncates `reload_truncate()` would have skipped,
  and whose cascade therefore **was never going to happen**;
- that closure reaches `player_link_match_candidates` and `player_match_period_stats`, so the
  guard refused over a cascade it had already decided not to perform.

Against the stated hypotheses: **#1 confirmed** (the guard is global and runs once, ahead of
every per-call truncate decision); **#2 confirmed** (`any_rows`/`cascade_dependents` were
given the wrong relation set — the union rather than the roots that would actually be
truncated); **#3 confirmed as the trigger** (migrations seed two roots); **#4 confirmed** (the
§H12 tests pinned the *shape* of the short circuit but could not observe that it never fired);
**#5 rejected** (no path bypasses `reload_truncate()` — all three group loaders call it and no
raw `truncate(pg, "` remains).

## H13.3 The repair

**(a) The closure comes from the POPULATED roots only.** A truncate that will be skipped
cascades into nothing, so an empty root contributes nothing to adjudicate:

```python
populated_roots = any_rows(pg, sorted(to_truncate))
if not populated_roots:
    return
dependents = cascade_dependents(pg, populated_roots)
```

On a freshly migrated database the populated roots are `{stat_definitions,
stat_availability}`, and their closure is confined: `stat_definitions` is referenced by
exactly one relation — `stat_availability` (`002_core_entities.sql:212`) — and
`stat_availability` is referenced by nothing. Both are in `GROUP_REBUILDS['coverage']`, so
`outside` is **empty**, no readability split is needed, and neither denied relation is
touched.

**(b) The guard and the truncate can no longer disagree.** That disagreement is the actual
defect class, so it is now closed structurally rather than by matching reasoning in two
places. `guard_cascade()` records the roots whose cascade it adjudicated; `reload_truncate()`
**refuses** to truncate anything outside that set, and refuses outright if the guard has not
run. A root that was empty at guard time but holds rows at truncate time is unadjudicated, and
is refused rather than truncated.

Every required property still holds: `afldb_import` stays restricted; no owner fallback; no
new SELECT or TRUNCATE grant; `--allow-cascade` unused; empty roots require no read of any
unrelated dependent; non-empty roots remain fail-closed; a populated root with unreadable
dependents still refuses; and because adjudication is scoped to what is actually truncated, a
future migration adding an unregistered table cannot reintroduce a table-by-table privilege
failure.

## H13.4 Behavioural tests — the real lesson

§H12's tests asserted source strings, and passed against wrong control flow. The new
`tests/python/reference_cascade_contract.py` drives the **real** `guard_cascade()` and
`reload_truncate()` against a fake connection that answers the three queries they issue,
records what they asked for, and **raises if the guard reads a relation the role may not
SELECT**. No database, no psycopg connection, no network.

```
A  freshly migrated DB (015/016 seeds)  A1 no refusal · A2 closure from populated roots ONLY
                                        A3 no unreadable relation inspected · A4 zero
                                        readability splits · A5 no TRUNCATE for empty roots ·
                                        A6 only the seeded coverage pair truncated ·
                                        A7 a wholly empty DB issues no closure query at all
B  populated clubs + unreadable dep     B1 refuses · B2 names them · B3 never read them
C  populated clubs + readable deps      C1 load allowed · C2 guarded TRUNCATE issued ·
                                        C3 a POPULATED readable dependent still refuses
D  guard/truncate agreement             D1 TRUNCATE before the guard refuses · D2 an
                                        unadjudicated root refused, not truncated ·
                                        D3/D4 --allow-cascade is opt-in and is what separates
                                        refusal from warning · D5 the canonical rebuild path
                                        never passes it
```

Scenario **A2** is the one that would have caught §H12: it asserts the closure query was
issued for `{stat_availability, stat_definitions}` and nothing else.

## H13.5 Files changed and validation

```
tools/migration/load_reference_data.py       closure scoped to populated_roots; + _cleared_roots
                                             and reset_cascade_state(); reload_truncate()
                                             refuses an unadjudicated root
tests/python/reference_cascade_contract.py   NEW — 19 DB-free behavioural scenarios
tests/reference-data.test.ts                 + runs the behavioural contract; two stale
                                             source-string assertions corrected
tools/migration/common.py                    UNCHANGED since §H12
tools/maintenance/privileges.sql             UNCHANGED
src/db/migrations/                           UNCHANGED
```

```
tests/python/reference_cascade_contract.py              19/19 scenarios hold
tests/reference-data.test.ts + db-test-rebuild.test.ts  206/206 passed
python -m py_compile                                    OK
tsc --noEmit                                            no error in any changed file
```

`afldb_test` is unchanged: the guard refuses before any write, so the failed proof wrote
nothing. It still holds the reset schema, migrations 001–072, reconciled privileges and zero
rows — the post-stage-4 state, so the bounded proof can simply be rerun.

# H14. FITZROY STAGE — `NameError: corrections` (2026-08-27)

The second full clean rebuild cleared every earlier gate — PRECHECK, RESET, MIGRATIONS 72/72,
PRIVILEGES, REFERENCE DATA — and FITZROY imported venues 52, players 13,275, matches 16,838
and match_period_scores 134,704 before dying at `[stats]`:

```
import_player_match_stats(pg, rep, files, matches, clubs, args, refs)
  -> build()
     -> for context, _season, row in iter_player_stats(files, corrections):
NameError: name 'corrections' is not defined
```

## H14.1 Root cause — confirmed

`corrections` is created in `main()` (`load_row_corrections()`, the tracked
`source_row_corrections` rules) and threaded explicitly into the scan phase:

```
main():1832   corrections = load_row_corrections()
main():1842   scan_player_stats(files, matches, clubs, round_vote_seasons, corrections)
```

`scan_player_stats()` declares it as a parameter. **The two import phases do not.** Both
call `iter_player_stats(files, corrections)` in their bodies while neither declared the
parameter, and `main()` passed it to neither — so the name resolved to module scope, where it
does not exist.

**It was a dropped parameter, not a missing definition.** There is no module-level
`corrections`, which is why it surfaced as a clean `NameError` rather than as a silent
uncorrected import.

## H14.2 Sibling defect — FOUND

`import_brownlow_round_votes()` (`:1703`, calling `iter_player_stats` at `:1723`) carried
**the identical defect**. `GROUPS = [venues, players, matches, stats, brownlow]`, so `stats`
failed first and `brownlow` would have failed the same way at the very next group.

A full AST audit of the importer — names each function reads that are neither its own
parameters/locals nor module globals nor builtins — found **no other instance**. The four
remaining hits (`what`/`expected`/`actual` at `:509-510`, `f` at `:1327`) are false positives
of the scan: nested `refuse()` parameters and a `lambda f:` parameter, which `ast.walk`
descends into.

## H14.3 Repair

`corrections: list[dict]` added as a **required** parameter to both phases, and passed from
`main()`. Required rather than defaulted to `None`: a default would let a future caller drop
it again and silently import the source **uncorrected**, which is the failure mode the
accepted-corrections mechanism exists to prevent. Not made global, not stubbed empty, and the
mechanism itself is untouched.

All four accepted corrections stay active: the two Jim Stewart 1909 cartesian row drops
travel in this object; Brisbane Lions 1987–1996 → Brisbane Bears and North Melbourne
1999–2007 → Kangaroos travel on the contract through `ClubResolver`; the 2025 blank-`Player`
display-name construction is in the importer. The regression test asserts all four are live,
so an "empty corrections" repair cannot pass.

## H14.4 Test added

`tests/python/fitzroy_corrections_contract.py` — 24 DB-free behavioural checks, run from
`tests/fitzroy-core-import.test.ts`. Deliberately **not** source-string assertions:

- binds `main()`'s real argument list to the real signatures with `inspect.signature().bind()`,
  and asserts the bound `corrections` **is** (identity) the object `load_row_corrections()`
  returned — for both phases;
- asserts `corrections` is a **required** parameter of both;
- reads the compiled **code objects** to prove the name resolves to the parameter and not to
  module scope — `import_player_match_stats` closes it into a cell its nested `build()` reads
  as a free variable, `import_brownlow_round_votes` holds it as a plain local; either way it
  is absent from `co_names`, which is exactly the difference between working and `NameError`;
- **reconstructs the pre-repair shape and executes it**, asserting it raises `NameError`
  naming `corrections`, then executes the repaired shape and asserts the object arrives;
- AST-audits every `import_*` phase for the same dropped-parameter class across the names
  `main()` threads, and asserts every `iter_player_stats` call site passes `corrections`.

## H14.5 Validation

```
tests/python/fitzroy_corrections_contract.py            24/24 checks hold
tests/fitzroy-core-import.test.ts + reference-data      93/93 passed
python -m py_compile import_fitzroy_core.py             OK
AST undefined-name audit                                0 real problems
```

## H14.6 Transactionality of the failed stage — from source

`connect_pg()` is `psycopg.connect(dsn)` with **no autocommit**, and `import_batch()` on
exception calls `conn.rollback()` **before** recording the failure
(`common.py:273-277`); `ImportBatch.finish()` ends with `conn.commit()`.

So the `[stats]` group's own writes — the `DELETE FROM player_match_stats WHERE match_id =
ANY(...)` and any COPY — **were rolled back**, and an `import_batches` row is committed with
`status = 'failed'` and the error text. Each earlier group ran in its own `import_batch`
block and committed on success, so **venues, players, matches and match_period_scores
persist**. `player_match_stats` and `brownlow_round_votes` are empty.

The importer is idempotent by design (scoped delete-then-COPY), so the two unreached groups
can be run on their own against the committed core as a bounded proof, without repeating the
rebuild.

# H15. FIRST COMPLETE CLEAN REBUILD — PASSED (2026-08-27)

**The canonical rebuild ran end to end and every stage passed.** This is the milestone §H10
named as the next phase, and the first time AFLDB has been rebuilt from tracked, reproducible
sources with zero `AFLDB_LEGACY_SQLITE` dependency.

```
npm run db:test:rebuild -- --acknowledge-destroy afldb_test
```

## H15.1 Execution model

```
target                 afldb_test        (not production, not afldb_dev)
schema / reset /
  migrations           afldb_owner
data stages            afldb_import      — the RESTRICTED role
--allow-owner-import-dsn   NOT used
AFLDB_LEGACY_SQLITE        NOT used
```

The data stages ran under the restricted import credential throughout. This matters: it is
what made §H12/§H13 and §H14 findable at all, and it means the rebuild proves grant
sufficiency rather than assuming it (the ISSUE-083 gap, exercised here in practice).

## H15.2 Sources

```
fitzRoy label          full-history-20260827
manifest               docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260827.json
manifest SHA256        cc8aaf0946fc59003dc4e5d6803410383db975e2f5bf58e9d510c31dc781e3b6
artefact-set SHA256    8e14ce6198685b9fec568ab3c680cab34783e8e202ab0c7e93f45773d96f4125
raw artefacts          131          acquired rows   719,042

DraftGuru snapshot     annual-html-20260826
persons                5,057        picks           6,810        ledger decisions   6
```

## H15.3 The nine stages — ALL PASSED

```
1 PRECHECK          PASSED        6 FITZROY CORE       PASSED
2 DATABASE RESET    PASSED        7 DRAFTGURU          PASSED
3 MIGRATIONS        PASSED 72/72  8 DERIVED            PASSED
4 PRIVILEGES        PASSED        9 FINAL VALIDATION   PASSED 13/13
5 REFERENCE DATA    PASSED
```

**Reference data**

```
sources        11     clubs               24     stat_definitions     24
seasons       130     club_aliases        48     stat_availability  3,120
                      club_organizations  21
```

**fitzRoy core** — completed after the §H14 corrections-parameter repair

```
venues                     52     match_period_scores    134,704
players                13,275     player_match_stats     685,471
matches                16,838     brownlow_round_votes   320,861
```

**DraftGuru**

```
persons   5,057    ledger          6    bridge         0    seeded    2
picks     6,810    live_override   0    unmatched  5,052
```

**Derived**

```
season_metadata             130     player_season_stats     58,176
player_clubs             16,713     player_career_stats     13,275
player_club_season_stats 58,425     search_rank             13,277
club_seasons                  0     <-- EXPECTED; see §H15.5 → AFLDB-ISSUE-095
```

## H15.4 Stage 9 — FINAL VALIDATION, 13/13

Every gate measured against the accepted register (§H11.4), not against values written into
the runner:

```
matches                             16,838      players                     13,275
matches_with_player_rows            16,838      player_match_rows          685,471
seasons_first                        1,897      brownlow_round_vote_rows   320,861
seasons_last                         2,025      matches_after_accepted_last_season   0
venues                                  52      draft_persons                5,057
attendance_known                    15,187      draft_picks                  6,810
club_identities                         24
```

```
AFLDB-FINAL-VALIDATION PASSED: 13 checks
Rebuild complete.
```

`matches_after_accepted_last_season = 0` confirms 2026 was **not** imported into the
historical core; it remains owned by current-season ingestion (§H4).

Stage 9 was a no-op until §H11.4 (F3). Had it stayed one, this run would have printed
`Rebuild complete.` on exit codes alone and proved nothing about the dataset.

## H15.5 RESOLVED — `club_seasons = 0` is expected; the ladder domain is a SEPARATE FOLLOW-UP

**Verdict: SEPARATE FOLLOW-UP. It does not invalidate the core rebuild.** Source-proven
2026-08-27; the original open-item text is kept below for lineage.

**The only writer of `staging.team_seasons` is the legacy importer.**
`tools/migration/import_legacy_afl.py` truncates and loads it (`:767`, `:776`, `:795`) from a
SQLite cursor whose path is `require_env("AFLDB_LEGACY_SQLITE")` (`:1021`), under the group
key `"ladders"` (`:996`). No other tool writes it — the only other references are
`rebuild_derived.py` (which reads it) and `validate_migration.py` (the legacy parity checker).

`REBUILDS["club_seasons"]` (`rebuild_derived.py:312`) selects `FROM staging.team_seasons`.
With that table empty the CTE yields no rows, so `TRUNCATE club_seasons; INSERT … SELECT`
correctly writes **zero** rows. The derived stage did exactly what it is defined to do.

**So the ladder/team-season domain has no canonical acquisition path yet, and never had one
inside this issue.** Its sole historical source is the very database ISSUE-093 exists to
retire. The nine-stage contract's data stages are reference → fitzRoy core → DraftGuru →
derived-from-those; ladder tallies were never among them (§H6). `club_seasons = 0` is
therefore **the expected outcome of a legacy-free rebuild**, not a defect in it — the domain
is simply not migrated yet.

**What is genuinely degraded while it is empty** — this is real, and is why "acceptable" is
too weak a verdict on its own. `club_seasons` is read by `src/db/queries/clubs.ts`,
`seasons.ts`, `rounds.ts`, `grid-solver.ts`, `search.ts`, `db-health.ts`,
`player-derived.ts`, `nl/club-season.ts`, and by the NL search `parser.ts`/`plan.ts`/
`vocab.ts` and `src/lib/edit/spec.ts`. Ladders, premiership/wooden-spoon flags, finals counts
and club-season NL answers are unavailable until the domain lands.

**Can fitzRoy reconstruct it?** Partially, and the split is exact:

| Derivable from the accepted match facts | Requires an external ladder source |
|---|---|
| `played`, `wins`, `draws`, `losses` | `ladder_rank` — the *published* ladder position |
| `points_for`, `points_against`, `percentage` | `premiership_points` — historical competition rules (per-win value, byes, forfeits) |
| `is_premier`, `finals_played` — **already** derived from Grand Final `winner_club_id` and `matches.is_final` in the existing SQL | |

The schema permits a partial row: `premiership_points` and `ladder_rank` are **nullable**
(`006_draft_relationships.sql:66,68`), while `played/wins/draws/losses/points_for/
points_against` are `NOT NULL` and all derivable. So a fitzRoy-derived reconstruction would
not violate the table contract — **but** the current SQL hardcodes
`source_id = (SELECT id FROM sources WHERE key = 'sports_data_lab')`, and emitting
match-derived rows under that key would misattribute provenance. Choosing the source key,
and deciding whether a ladder with NULL `ladder_rank` is acceptable to the app, are design
decisions for the follow-up — not something to settle inside this issue.

**Stage 9 must NOT gate `club_seasons` yet.** A non-zero requirement would fail every
canonical rebuild until the domain is incorporated, converting a known gap into a false
failure. Add the gate when the follow-up lands, at which point it should assert row counts
against whatever tracked source is accepted — the same register-bound pattern as the other 13
gates (§H11.4).

**Follow-up — RECORDED 2026-08-27 as `AFLDB-ISSUE-095` — canonical legacy-free ladder /
team-season acquisition** (runbook `AFLDB-ISSUE-095.md`; entry in `issues.md`; listed in
`IssuesIndex.md`). `AFLDB-ISSUE-094` was NOT used — it is already allocated to NL semantic
mapping. Its scope: give the ladder/team-season domain a canonical, legacy-free acquisition
and load path — decide the authoritative source, whether `ladder_rank`/`premiership_points`
come from it or stay NULL under a match-derived reconstruction, its provenance `source_id`,
whether it becomes a tenth rebuild stage, and its Stage-9 gate. `AFLDB-ISSUE-015` holds the
existing per-season `recomputeClubSeasons` parity work and is **linked, not absorbed**.

**ISSUE-093 is not blocked by this.** The core rebuild it set out to prove — tracked,
reproducible, hash-bound, zero `AFLDB_LEGACY_SQLITE` — completed and validated 13/13.

---

*Original open-item text, retained for lineage:*

## H15.5(orig) OPEN — `club_seasons = 0` is NOT yet explained

`club_seasons` came back **empty** from the derived stage. **This is recorded as an observed
value requiring explicit bounded confirmation, not as an expected one.** No section of this
issue proves it is intentional, and it is not being explained away here.

There is a **candidate mechanism, unverified for this rebuild**: `issues.md` (ISSUE-015,
2026-08-22) records that `REBUILDS["club_seasons"]` in `rebuild_derived.py` copies ladder
tallies **verbatim from the published source ladder in `staging.team_seasons`**, deriving only
`is_premier`, `finals_played` and `wooden_spoon` from match facts. The canonical nine-stage
rebuild has **no staging-load stage**, so `staging.team_seasons` would be empty on a clean
rebuild. That is a lead, not a finding: it has not been confirmed against this run, and
whether an empty `club_seasons` is an acceptable end state for a canonical rebuild — or a
missing stage in the rebuild contract — is exactly the open question.

**Required before ISSUE-093 can be considered fully closed:** a bounded, read-only
confirmation of whether `club_seasons = 0` is intentional on the canonical rebuild path, and
if it is not, what supplies it. Every other derived table returned a non-zero count.

## H15.6 What real execution exposed — and where each thing is recorded

The durable record deliberately separates what was planned, what failed, what was proven in
isolation, and what finally ran. Nothing below is duplicated here; these are pointers.

| Phase | Outcome | Section |
|---|---|---|
| Planned/proven before any rebuild — RESET_SQL rollback proof, accepted baseline, orchestrator | PASSED | §H2, §H4, §H6, §20 |
| Execution-boundary audit — F1 npm/cmd.exe, F2 import credential, F3 stage-9 no-op, F4/F5 gaps | 3 blockers found and cleared **before** any destruction | §H11 |
| Clean rebuild attempt 1 | **FAILED after destruction** at REFERENCE — `InsufficientPrivilege` on `player_link_match_candidates` | §H12 |
| Bounded Stage-5 proof 1 | **FAILED safely**, no writes — the §H12 repair was necessary but not sufficient | §H13 |
| Bounded Stage-5 proof 2 | PASSED | §H13 repair |
| Clean rebuild attempt 2 | **FAILED after destruction** at FITZROY `[stats]` — `NameError: corrections` | §H14 |
| Bounded fitzRoy proof | PASSED — `player_match_stats 685,471`, `brownlow_round_votes 320,861` | §H14 |
| **First complete clean rebuild** | **PASSED — all nine stages, 13/13 final validation** | **§H15** |

Two defects were exposed only by real execution under the restricted role, and neither was
reachable by inspection or by the DB-free suites as they stood:

**1. REFERENCE loader cascade guard (§H12, §H13).** `afldb_import` correctly could not read
`player_link_match_candidates` or `player_match_period_stats` — both deliberately unregistered
post-045 tables. The first repair assumed a freshly migrated database is empty; migrations 015
and 016 **seed** `stat_definitions` and `stat_availability`, both truncate roots, so that
assumption was false and the guard adjudicated the cascade of roots it was never going to
truncate. The final repair scopes cascade analysis to **populated roots only** and binds the
guard and the truncate so they cannot disagree. **No privilege was granted;
`tools/maintenance/privileges.sql` is unchanged.** A bounded Stage-5 proof passed before the
full rebuild was attempted again.

**2. fitzRoy corrections-parameter threading (§H14).** `import_player_match_stats` and
`import_brownlow_round_votes` both called `iter_player_stats(files, corrections)` while
neither declared the parameter and `main()` passed it to neither. Both signatures and both
call sites were repaired, with `corrections` **required** rather than defaulted so a future
caller cannot silently import the source uncorrected. A bounded live proof passed
(`player_match_stats 685,471`, `brownlow_round_votes 320,861`), and this rebuild then proved
both paths end to end.

The accepted corrections were active throughout: Brisbane Lions 1987–1996 → Brisbane Bears,
North Melbourne 1999–2007 → Kangaroos, the two Jim Stewart 1909 cartesian row drops, and the
2025 blank-`Player` display-name construction (§H4).

## H15.7 Status

```
RESOLVED — 2026-08-27
```

The first complete clean rebuild is **achieved and validated**: nine stages, 13/13 final
validation against the accepted register, under the restricted import role, with no legacy
dependency.

The single remaining question — `club_seasons = 0` — was investigated and **proven to belong
to a separate data domain** (§H15.5): `staging.team_seasons` has no non-legacy writer, so zero
rows is the expected outcome of a legacy-free rebuild rather than a defect in it. That domain
is now tracked as **`AFLDB-ISSUE-095` — canonical legacy-free ladder / team-season
acquisition** (runbook `AFLDB-ISSUE-095.md`), which links `AFLDB-ISSUE-015` without absorbing
it. With that recorded, ISSUE-093 is **Resolved — 2026-08-27**.

*Superseded status line, kept for lineage: `CLEAN REBUILD PROVEN — FINAL POST-REBUILD
VALIDATION PENDING`, with the note that the issue was not yet Resolved solely because
§H15.5 was open.*

Unchanged standing boundaries: do not start DraftGuru Stage B3 (optional, not a blocker); do
not merge the parked branches — ISSUE-083 `fa035ed`, ISSUE-059 `4444d76`, ISSUE-073
`0885129`. ISSUE-059 and ISSUE-073 were blocked on a usable rebuilt database and are now
**unblocked** for their own focused DB-backed validation, as separate work.

## club_seasons = 0 — fresh-chat finding

**Self-contained handoff. A fresh session needs this section only; the conversation that
produced it is not required.**

**VERDICT: SEPARATE FOLLOW-UP.** The successful canonical clean rebuild (§H15) is valid and
is **not** invalidated by `club_seasons = 0`.

**What the table is.** One row per club per season: `played`, `wins`, `draws`, `losses`,
`points_for`, `points_against`, `premiership_points`, `percentage`, `ladder_rank`,
`wooden_spoon`, `is_premier`, `finals_played`. Schema: `006_draft_relationships.sql:55`.

**Why it is zero — the proven chain.**

1. `rebuild_derived.py` builds `club_seasons` **only** from `staging.team_seasons`
   (`REBUILDS["club_seasons"]:312`).
2. `staging.team_seasons` is populated **only** by `tools/migration/import_legacy_afl.py`
   (`:767`, `:776`, `:795`; group key `"ladders"` at `:996`).
3. That loader requires `AFLDB_LEGACY_SQLITE` (`:1021`).
4. The nine-stage ISSUE-093 canonical rebuild **deliberately has no legacy staging-load
   stage** — eliminating that dependency is the point of the issue.
5. Therefore `staging.team_seasons` is empty after a canonical clean rebuild, and
   `club_seasons` **correctly becomes 0** under the current implementation.

Historically `club_seasons` was populated only because legacy/staging ladder data already
existed. Nothing regressed.

**What fitzRoy can and cannot supply.**

- Deterministically reconstructable from accepted match data: `played`, `wins`, `draws`,
  `losses`, `points_for`, `points_against`, `percentage` — and likely `is_premier` /
  `finals_played` from match/finals facts (the existing SQL already derives those two).
- **Not** proven by fitzRoy alone: official published `ladder_rank`, and historical
  `premiership_points` semantics (per-win value, byes, forfeits).
- Both are **nullable**, so a partial reconstruction is **schema-legal** — but provenance must
  be designed correctly. The current SQL writes `source_id = 'sports_data_lab'`; a
  match-derived reconstruction **must not inherit that provenance**.

**Real consumers** (so this is a genuine gap, not a cosmetic one): club/season/round queries,
Grid Solver, search, NL club-season logic, health checks and editor code —
`src/db/queries/{clubs,seasons,rounds,grid-solver,search,db-health,player-derived,nl/club-season}.ts`,
NL `parser.ts`/`plan.ts`/`vocab.ts`, `src/lib/edit/spec.ts`.

**Stage 9:** do **NOT** add a `club_seasons` non-zero gate until the ladder/team-season domain
has an accepted canonical source and contract. Gating it now would fail every canonical
rebuild over a known, deliberate gap.

**Next action — DONE 2026-08-27.** The follow-up issue was created as **`AFLDB-ISSUE-095` —
Canonical legacy-free ladder / team-season acquisition**.

- `AFLDB-ISSUE-094` was **not** allocated — it is already used by NL semantic mapping. `095`
  was confirmed absent from both `issues.md` and `IssuesIndex.md` before use.
- Durable runbook: **`AFLDB-ISSUE-095.md`** (proven source chain, per-field table, fitzRoy
  capability split, decisions D1–D7, Stage-9 policy). Detailed entry in `issues.md`; open-issue
  row and detail block in `IssuesIndex.md`.
- It links **ISSUE-015** and **ISSUE-093**. **ISSUE-015 was NOT absorbed** and its Resolved
  status is unchanged.
- Scope as recorded: authoritative source; whether `ladder_rank`/`premiership_points` come from
  it or stay NULL under a match-derived reconstruction; provenance `source_id`; club-identity
  re-pointing; whether it becomes a tenth rebuild stage; its Stage-9 gate; zero supported
  `AFLDB_LEGACY_SQLITE` dependency.

**ISSUE-093 status transition — COMPLETED.**

```
Was:  CLEAN REBUILD PROVEN — FINAL POST-REBUILD VALIDATION PENDING
Now:  Resolved — 2026-08-27
```

The follow-up is recorded, so ISSUE-093 is closed. Nothing further is pending on it.
