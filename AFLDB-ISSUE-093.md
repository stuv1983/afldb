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
                PHASE 4a (§13.4a core importer) IMPLEMENTED (2026-08-25, see §18):
                canonical snapshot → PostgreSQL historical/core importer; non-DB
                validation pending user-run tests.
Production:     NOT TOUCHED
Blocks:         none
Depends on:     AFLDB-ISSUE-092 §4 (fail-closed external_identities gate) must land in
                whatever importer owns external_identities before that importer ever runs
                against afldb_test, rebuilt path or not (see §9)
```

Do not implement anything from this document without opening a new bounded session per the
implementation phases in §13. This document is architecture, not an execution runbook for a
single session.

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

## 10. Rebuild orchestrator safety contract (future `npm run db:test:rebuild` — not
implemented yet)

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
