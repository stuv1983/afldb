# AFLDB-ISSUE-162 — Fixture / season schedule administration (ISSUE-156 P3d)

- **Status:** **OPEN. Stage 1 committed `cb98c67`, Stage 2 committed `6a9fbc4`; both validated
  locally. Final local audit 2026-09-12 (Opus 5 high, 1M) — 8 Stage 2 defects fixed, UNCOMMITTED and
  NOT RE-RUN (§39).** Not merged, not deployed; DEV and PROD untouched throughout. Migration **097
  allocated**; its all-refs collision check (§37.10) has still never run and remains binding.
  Combined ISSUE-160 + 161 + 162 DEV/browser acceptance is deferred to the Admin Centre batch (§34).
  Records: **§37** Stage 1, **§38** Stage 2, **§39** the final audit.
  **Operator decisions D-1…D-7 DECIDED 2026-09-11 (§35); D-6 approved with a condition and one
  additional implementation constraint.**
- **Severity:** Medium
- **Area:** Admin / Data management / Match model / Acquisition boundary / Promotion lineage
- **Planning model:** Fable 5.1, high
- **Worktree / branch:** `D:\dev\afldb-issue-162`, `opus/issue-162-fixture-admin`, cut from
  `opus/issue-161-season-lists` @ `34858ce` (stacked on ISSUE-161, which is stacked on ISSUE-160).
  Neither parent is merged first; all three deploy to DEV together as the Admin Centre batch (§34).
- **Parent:** `AFLDB-ISSUE-156` (Admin Centre completion umbrella). Allocated as a supplemental
  child **P3d** after P3c, so P4–P12 keep their labels. **P10 (fixture-identity correction of
  played matches, `match-rekey.ts`) is NOT absorbed** — see §31.

Every file/line citation below was verified natively on this branch on 2026-09-11. No database was
read or written during planning; every "measured" figure is quoted from the cited record.

---

## 1. Executive summary

AFLDB cannot represent an unplayed match. `matches` requires `home_score`, `away_score`, `result`
and `margin` `NOT NULL` (`003_matches.sql:45-52`) and reconciles them with five CHECKs
(`003:60-70`, `022:25-55`), so the only "fixture" the database knows is a game that has already
been scored. The current-season acquisition already records this: "pre-match match identity is
structurally unavailable: `matches` requires NOT NULL scores/result/margin, so an unplayed fixture
cannot exist there" (`IssuesIndex.md:2299-2300`, ISSUE-100 L3A). Every consumer of `matches` —
the club ladder (`rebuild_derived.py:340-356`, `player-derived.ts:413-458`), season metadata
(`player-derived.ts:515-560`), round ladders (`rounds.ts:44-105`), venue records (`venues.ts`,
13 reads), NL team plans, the Grid Solver — reads "row exists" as "match played". A scheduled row
placed in `matches` with placeholder scores would count as a 0–0 draw; with NULL scores it cannot
be inserted at all.

The repository's own precedent for this exact distinction is AFLW: `staging_aflw.fixtures` (the
published schedule, `fixture_status IN ('played','scheduled','cancelled')`, scores CHECK-forced NULL
unless played, `025_staging_aflw.sql:80-125`) is a separate table from `staging_aflw.matches` (one
row per played fixture, `025:127-131`). The chosen design follows that shape at canonical level:

- **A new canonical registry table `fixtures`** holds scheduled-match facts only: season, round,
  home/away club identity, optional date, optional local start time, optional venue, a lifecycle
  `status` (`scheduled` | `cancelled` | `void`) and a minted, never-edited `fixture_key` token
  under the existing `manual_admin_edit` source. It carries **no** score, result, attendance or
  statistic column, so no fixture can ever be read as a played match.
- **`matches` stays played-only and untouched.** No column, constraint or consumer changes. The
  ladder, season metadata, venue/club records, NL and Grid Solver are safe by construction.
- **"Played" is derived, never stored:** a fixture is played when exactly one `matches` row exists
  for the same season, round code and club pair (§18). The AFL Tables settle keeps inserting
  `matches` rows by `match_key` exactly as today and never reads `fixtures`; no twin is possible
  because the two tables never hold the same fact.
- **Durability** is the ISSUE-159/160/161 shape: a whole-row `data_overrides` record keyed
  `manual_admin_edit:<token>`, one import-role transaction per mutation with an in-transaction
  `data_edits` row, and a fail-closed `replay_admin_overrides('fixtures')` branch so every
  fixture survives a rebuild, a DEV→PROD promotion and disaster recovery.
- **Removal never deletes.** A data-entry mistake is `void`; a real-world cancellation is
  `cancelled`; both keep the row, the identity and the audit trail resolvable (§16).
- **Season boundary:** ISSUE-162 writes no `seasons`, `clubs` or `club_seasons` row (ISSUE-161
  D-6, `096_season_list_members.sql:33-57`). A fixture season is administrable for
  `max(seasons.year) <= S <= max(seasons.year) + 1`; eligible clubs come from the ONE existing rule
  `afldb_season_list_clubs(season)` (`096:166-185`).
- **One migration** (next free number **097** at planning time; re-check at Stage 1), additive,
  no backfill. Two stages: Stage 1 = model + mutations + replay + promotion classification +
  derived-safety tests; Stage 2 = `/admin/fixtures` routes, capabilities, single and round-batch
  entry, diagnostics, responsive acceptance deferred to the Admin Centre DEV batch.

---

## 2. Current fixture architecture (Planning Question 1)

### 2.1 What `matches` is

| Fact | Column(s) | Nullable | Evidence |
|---|---|---|---|
| Identity | `id` (identity, rebuilt on promotion); `match_key text NOT NULL UNIQUE` = `season\|round_code\|match_date\|home name\|away name` | no | `003:20-23`; rendering `import_fitzroy_core.py:54,1880`; `match-rekey.ts:4-13` |
| Season | `season smallint NOT NULL REFERENCES seasons(year)` | no | `003:25` |
| Round | `round_code text NOT NULL`, `round_number smallint`, `round_type round_type NOT NULL`, `is_final boolean NOT NULL` CHECK-derived, `is_finals_series` GENERATED | round_number NULL for finals only (`matches_round_number_ck`) | `003:26-29,66-69`; `084`; `085:52-54` |
| Date / time | `match_date date NOT NULL`, `match_time text` (AFL Tables `Local.start.time`, verbatim), `scheduled_at timestamptz` | date NOT NULL; time nullable; `scheduled_at` has **no reader or writer anywhere in `src/` or `tools/`** (only `003:33`) | `003:31-33`; `import_fitzroy_core.py:1604` |
| Venue | `venue_id` nullable enrichment, `venue_raw text NOT NULL` | venue_id yes | `003:35-38,74-75` |
| Clubs | `home_club_id`, `away_club_id NOT NULL`, CHECK differ | no | `003:40-41,60` |
| Scores | `home_score`, `away_score` **NOT NULL**; goals/behinds nullable; components CHECK | **no** | `003:43-48`; `022:36-55` |
| Result | `result match_result NOT NULL`, `winner_club_id`, `margin NOT NULL`; result must follow scores | **no** | `003:50-52,61-65`; `022:25-30` |
| Attendance | nullable; NULL = not recorded, never 0; zero must cite a source | yes | `003:54-55,72-73`; `020` |
| Provenance | `source_id`, `source_record_id`, `import_batch_id`, `imported_at` (migration 064) | yes | `064:10-15` |

**Conclusion:** there is no state of a `matches` row that means "not yet played". Every row is a
result. There is no separate fixture table in `public`; the only fixture table in the database
is AFLW's staging one (§2.4).

### 2.2 Who writes `matches`, and how a row is identified

| Writer | Identity used | Behaviour on an existing row | Evidence |
|---|---|---|---|
| `tools/migration/import_fitzroy_core.py import_matches()` (historical rebuild, 1897–2025) | `match_key` | `INSERT … ON CONFLICT (match_key) DO UPDATE` every scored field; period scores deleted and re-copied. **No `DELETE FROM matches` and no `TRUNCATE matches` anywhere in `tools/`** (the only two are the ISSUE-155 acceptance fixture scripts) | `:2978-3086`; grep |
| `tools/db/rebuild-test.ts` (`npm run db:test:rebuild`) | starts from an **empty** database | every table recreated; overrides replayed only where the importer calls `replay_admin_overrides` | `AFLDB-ISSUE-161.md` §19 |
| AFL Tables nightly settle (`settle-afltables.ts` → `canonical-apply.ts writeMatch()`) | the bundle projection's `match_key` verbatim; canonical lookup by `refs.matchIdsByKey` (every `matches` row of the season, `:1694`); a miss runs the ISSUE-131 rekey search | insert when `new_target`; update by id on a hit; refuses `rekey_ambiguous` / `rekey_would_merge` | `settle-afltables.ts:2946-3031`; `canonical-apply.ts:651-688` |
| ISSUE-131 rekey (`match-rekey.ts`) | season + BOTH club ids exact, at most one of `round_code`/`match_date` differs, candidate must be owned by the promoting source (`m.source_id = identity.sourceId`) and provably retired | moves `match_key` in place, carries `data_overrides` (`carryMatchOverrides`) | `:18-37,115-150,156-231` |
| Squiggle/Kali current-season refresh (`current-season-import.ts`) | `resolveLocalMatch()`: season, date, local round codes, unordered club pair, exactly one hit | **writes `staging.external_current_matches` only; "cannot create a partial `matches` row"** | `:475-484,596-613`; `063` |
| `createMatch()` (`match-admin.ts`, `/admin/data-editor`) | a **third** `match_key` rendering (`season\|round\|date\|homeId\|awayId`, `:224`) that the applier calls "one of three incompatible renderings" | inserts a fully scored row; also `INSERT INTO seasons … ON CONFLICT DO NOTHING` (`:192-196`); recomputes club_seasons/season metadata | `:101-320`; `canonical-apply.ts:663-665` |
| `src/lib/ingest/datasets.ts` (legacy CSV intake) | `match_key` upsert | scored rows only | `:559-572` |
| `replay_admin_overrides('matches')` | `data_overrides.entity_key = match_key` | patches attendance/time/event/notes/score fields on an existing row; never inserts | `common.py:1161-1228` |

### 2.3 Byes, finals, rounds today

- **Byes are absence.** No bye row exists; `rounds.ts:36-42` documents that the round ladder joins
  on `round_number <=` precisely so "a bye correctly carries a club's standing forward instead of
  silently missing a round".
- **Rounds are a text code plus a typed enum.** Home-and-away `round_code` is the decimal string of
  `round_number` (`normalise_results_round`, `import_fitzroy_core.py:1213-1221`); finals codes are
  `EF QF SF PF GF WF` (`FINALS_CODES`, `:166-173`), each mapped to `round_type`. AFLDB numbers the
  Opening Round as **round 1** from 2024 (`tools/records/import-first-kick-goal.ts:597`,
  `data/reference/source-families.json:57`, `tests/current-season-import.test.ts:130`); Squiggle and
  Kali number it 0. ISSUE-140 measured what happens when two conventions meet: 17 duplicate 2026
  `matches` rows on the pre-rebuild DEV lineage (`issues.md:18024-18049`).
- **Finals** are rows with `round_number NULL` and a finals `round_type`; participants are known
  because the row is a result. The Wildcard Final is `round_type = 'wildcard_final'`,
  `is_final = true`, `is_finals_series = false` (`084`, `085`).

### 2.4 The repository-native fixture precedent (AFLW)

`staging_aflw.fixtures` (`025:80-125`): "the complete published fixture list, including matches
that were never played … scores here are NULL and `fixture_status` carries the meaning";
`fixture_status IN ('played','scheduled','cancelled')`; `is_played = (fixture_status = 'played')`
CHECK; `saflw_fixtures_score_ck` forces scores NULL unless played, "or it becomes a 0-0 draw";
`match_date` nullable. `staging_aflw.matches` is "one row per played fixture" with
`match_key REFERENCES staging_aflw.fixtures(match_key)`. The AFLW model already separates
schedule from result; it is staging-only and outside the normalised model, so it is a design
precedent, not a reusable table.

### 2.5 Season register and club eligibility

- `seasons` is reference data loaded by `TRUNCATE`-and-copy from `data/reference/seasons.json`
  (`last_season: 2026`, `in_progress_seasons: [2026]`); the ISSUE-101 rollover advances it only
  after the completed season's acquisition is accepted, and never from the browser
  (`AFLDB-ISSUE-161.md` §9.2 table; `season-rollover.ts:685-721,1245-1308`).
- `clubs.last_season` for a current identity equals the register's last season, so
  `afldb_identity_for_season(org, 2027)` returns NULL for every identity while the register ends at
  2026 (`096:147-151`). ISSUE-161 solved this once with `afldb_season_list_clubs(p_season)`:
  `is_current_afl_club` identities for `S >= max(seasons.year)`, era identities with a
  `club_seasons` row before it (`096:166-185`).
- `club_seasons` is derived from `matches WHERE NOT is_final` with NOT NULL ladder columns
  (`006:55-78`; `rebuild_derived.py:340-356`); it cannot hold a season with no results.

---

## 3. Scheduled-vs-played semantic model (Planning Question 2)

Three fact classes, three homes:

| Class | Holds | Home | Written by |
|---|---|---|---|
| **Scheduled-match facts** | season, round, home, away, date (or TBC), local time (or TBC), venue (or TBC), lifecycle status, provenance | **`fixtures`** (new) | Super Admin (ISSUE-162); a future fixture importer under its own source (not this issue) |
| **Played-match facts** | scores, result, margin, attendance, period scores, participation and statistics | `matches`, `match_period_scores`, `player_match_stats`, `brownlow_round_votes` | AFL Tables settle, historical rebuild, data editor |
| **Derived statistics** | ladders, club/venue/player/coach records, season metadata | `club_seasons`, `player_*_stats`, `seasons` measured columns, live queries | `rebuild_derived.py`, `player-derived.ts`, read-time SQL |

Rules that follow:

1. A fixture never carries a score, result, attendance, period, lineup or statistic. The table has
   no such column, so "0–0 means not played" is unrepresentable rather than merely forbidden.
2. A played match never carries scheduling intent. `matches` is unchanged.
3. "Played" is a **derived** relation between the two (§18), never a stored flag on either.
4. Nothing derived reads `fixtures` (§21); nothing in `fixtures` is derived from anything.

**Can the current `matches` table represent a future fixture correctly?** No, and not by any
minimal change: making `home_score`/`away_score`/`result`/`margin` nullable would require re-proving
every one of the 105 `FROM matches` occurrences across 41 `src/` files, `rebuild_derived.py`, the
NL compilers and the Grid Solver (all of which take a row as a result), would leave `match_key`
— a content address over the very fields a fixture changes — as the identity, and would put
unplayed rows inside the settle's `matchIdsByKey` lookup and the ISSUE-131 rekey candidate set.
That is the stop condition "scheduled rows in `matches` contaminate ladder/stat derivation" fired
by design, and it is why Option A/C are rejected (§5).

---

## 4. Chosen canonical data model (Planning Question 3)

**Option B′ — a canonical registry table `fixtures`, played state derived by resolution against
`matches`.** One logical match has at most one fixture identity (permanent, minted) and at most
one played identity (`match_key`, source-owned); the two are joined deterministically, never
merged and never duplicated.

```sql
CREATE TABLE fixtures (
  id               bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,   -- rebuilt on promotion; never identity
  fixture_key      text        NOT NULL UNIQUE,   -- randomUUID() minted once at creation; never edited (§6)
  season           smallint    NOT NULL CHECK (season BETWEEN 1897 AND 2100),  -- no FK to seasons (§8)
  round_code       text        NOT NULL,          -- '1'..'N' or EF/QF/SF/PF/GF/WF, the matches vocabulary (§9)
  round_number     smallint,
  round_type       round_type  NOT NULL,          -- the existing enum, wildcard_final included
  is_final         boolean     GENERATED ALWAYS AS (round_type <> 'home_and_away') STORED,
  match_date       date,                          -- NULL = date TBC (§10)
  match_time       text,                          -- NULL = time TBC; local venue time text, matches.match_time vocabulary
  venue_id         integer     REFERENCES venues(id),   -- NULL = TBC or unmapped
  venue_raw        text,                          -- named-but-unmapped venue text; NULL with venue_id NULL = TBC (§11)
  home_club_id     integer     NOT NULL REFERENCES clubs(id),
  away_club_id     integer     NOT NULL REFERENCES clubs(id),
  status           text        NOT NULL DEFAULT 'scheduled'
                               CHECK (status IN ('scheduled', 'cancelled', 'void')),  -- §16
  status_reason    text,                          -- required by the writer for cancelled/void
  notes            text,
  source_id        smallint    NOT NULL REFERENCES sources(id),   -- manual_admin_edit for every ISSUE-162 row
  source_record_id text        NOT NULL,          -- = fixture_key for manual rows
  import_batch_id  bigint      REFERENCES import_batches(id),     -- reserved for a future importer, NULL here
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixtures_clubs_differ_ck   CHECK (home_club_id <> away_club_id),
  CONSTRAINT fixtures_round_number_ck   CHECK (
    (round_type = 'home_and_away' AND round_number IS NOT NULL AND round_code = round_number::text)
    OR (round_type <> 'home_and_away' AND round_number IS NULL)),
  CONSTRAINT fixtures_status_reason_ck  CHECK (status = 'scheduled' OR status_reason IS NOT NULL),
  CONSTRAINT fixtures_venue_ck          CHECK (venue_id IS NULL OR venue_raw IS NOT NULL),
  CONSTRAINT fixtures_source_record_uq  UNIQUE (source_id, source_record_id)
);
CREATE INDEX ix_fixtures_season_round ON fixtures (season, round_code);
CREATE INDEX ix_fixtures_home         ON fixtures (home_club_id, season);
CREATE INDEX ix_fixtures_away         ON fixtures (away_club_id, season);
CREATE INDEX ix_fixtures_venue        ON fixtures (venue_id) WHERE venue_id IS NOT NULL;
CREATE INDEX ix_fixtures_source       ON fixtures (source_id);
CREATE INDEX ix_fixtures_batch        ON fixtures (import_batch_id) WHERE import_batch_id IS NOT NULL;
```

(The exact DDL is written at Stage 1; the shape above is the contract. `venue_raw` is populated
from `venues.canonical_name` when `venue_id` is set, as `createMatch()` does at `:214-218`, so a
fixture always renders a venue string the same way `matches` does.)

**Assessment against the Q3 criteria**

| Criterion | Option B′ |
|---|---|
| Semantic correctness | exact: schedule and result are different facts in different tables; no fake values anywhere |
| Compatibility with existing imports | total: no importer, settle or rekey path reads or writes `fixtures`; `matches` unchanged |
| Promotion / replay | the ISSUE-161 registry shape (`grant_import_write` registry, whole-row override, fail-closed replay); one new lineage rule for audit rows (§20) |
| Manual edits | ordinary row edits under the token identity; `match_key` never involved |
| Public query impact | none until a public consumer opts in (§22) |
| Ladder / stat derivation | untouched by construction (§21) |
| Performance | ≤ ~230 rows per season; indexed by (season, round) |
| Migration complexity | one additive migration, no backfill |
| Duplicate fixture/result risk | different tables; the played link is a deterministic resolution with an `ambiguous` outcome that never merges (§18) |
| Scheduled → completed cleanly? | the fixture identity persists and reports `played` once the result exists; the result is the source's row. Two rows, one logical match, joined by rule — not one row that changes state |

---

## 5. Rejected alternatives

| Option | Why rejected |
|---|---|
| **A. `matches` canonical for both, scores nullable** | fires the derived-contamination stop condition (§3); `match_key` is a mutable content address (`match-rekey.ts:4-13`) unfit for a fixture whose date/round/venue change; unplayed rows would enter the settle's season lookup and the rekey candidate set; ~41 consumer files plus Python and NL to re-prove; ISSUE-140 shows what duplicate keys under two round conventions already cost |
| **C. `matches` plus explicit fixture status/provenance** | same schema change as A plus a status column every consumer would have to filter on; one missed filter = a 0–0 draw in a ladder; `matches_result_scores_ck` and friends would have to be conditionalised on status |
| **B (strict). New table that "settles into" `matches` by moving the row** | there is nothing to move: the settle creates the played row from the source with its own identity; a copy step would put fixture code inside `canonical-apply.ts` and create a second writer of `matches` outside the Decision-E ownership model |
| **Stored `fixtures.match_id` FK** | lineage-bound (`matches.id` is rebuilt on promotion); would need the `rowIdColumn` staged-remap mechanism ISSUE-155 invented (`promotion-inventory.ts:670-721`) for a link that is fully derivable. Deferred unless read-time resolution proves insufficient (D-6) |
| **Placeholder "TBC" clubs for finals** | clubs are tracked reference data (`clubs.json`); a fake identity would enter every club query; §17 creates a finals fixture only once participants are known |
| **Reuse `createMatch()`** | it is a played-match creator with a third incompatible `match_key` rendering and a `seasons` INSERT the reference loader reverts (`match-admin.ts:192-196,224`); its use for scheduling is exactly the fake-score path this issue forbids |
| **Reuse `staging_aflw.fixtures`** | AFLW staging, team codes not club ids, outside the normalised model and the promotion registry |
| **`data_overrides`-only design (no table)** | a fixture is a first-class canonical fact with FKs, uniqueness and diagnostics; `data_overrides` is a durable *record*, not a queryable table (the ISSUE-161 §3 argument, unchanged) |

---

## 6. Match identity strategy (Planning Question 4)

| Component | Stable? | Role |
|---|---|---|
| `fixtures.fixture_key` (UUID token) | **yes** — minted once by `randomUUID()`, never edited, survives rebuild/promotion via the override key | **the durable fixture identity**; admin route segment; `data_overrides.entity_key = 'manual_admin_edit:<token>'`; `source_record_id` |
| `fixtures.id` | no (rebuilt on promotion) | storage only; `data_edits.row_id`, remapped by the new `fixture_key` lineage rule (§20) |
| season + round_code + club pair | stable in practice, **mutable by edit** | the **played-resolution key** (§18) and the duplicate-refusal key (§13) — never the identity |
| `match_date`, `match_time`, `venue_id` | mutable | schedule facts, freely rescheduled |
| home/away designation | mutable (swap action) | schedule fact; resolution tolerates a swap with a warning |
| `matches.match_key` | content address over mutable fields | the **played** identity, source-owned; ISSUE-162 never renders, stores or compares it |
| `matches.source_record_id` (AFL Tables game id) | source-owned | never used here |

This mirrors the ISSUE-160 manual-selection contract (`AFLDB-ISSUE-160.md` §3.1: `player_url =
'manual:<token>'`, "token = `randomUUID()` minted once at creation, never edited, never
name-derived") and the ISSUE-159 manual-coach namespace. No display string is ever an identity.

**Binding constraint (operator, 2026-09-11):** a played-match association never replaces
`fixture_key` with `match_key`. `fixture_key` is the fixture's identity before, during and after
settlement, across every reschedule, venue change, round change and club correction. `fixtures`
carries no `match_key` and no `match_id` column; the played row's id is a read-time result (§18),
never stored, and no writer in this issue may render, copy or compare a `match_key`.

---

## 7. Source / provenance strategy (Planning Question 5, 25)

| Row | `source_id` | `source_record_id` | Durable record | Distinguishable how |
|---|---|---|---|---|
| Manual fixture (this issue) | `manual_admin_edit` (`057:36-42`) | the token | `data_overrides ('fixtures', 'manual_admin_edit:<token>', 'fixture', whole-row payload)` | `source_id` only; never a name pattern |
| Future imported fixture (not this issue) | its own source (e.g. `squiggle_api`, `063:10-14`) | the provider id | none needed (reload re-creates) | `source_id` |
| Played match | AFL Tables (`matches.source_id`) | AFL Tables game id | source | separate table |

Precedence rules (binding on any later importer):

1. A source-owned fixture writer writes only rows carrying its own `source_id`; it never inserts,
   updates or deletes a `manual_admin_edit` row (the ISSUE-161 §7 rule, `096:139-140`).
2. A manual fixture is never overwritten by source data; reconciliation between a manual fixture
   and a source fixture is a **diagnostic** (§31), never an automatic mutation.
3. The played link (§18) is the only interaction with AFL Tables data, and it is read-only.
4. `data_overrides` is sufficient for durability because every ISSUE-162 row is manual and whole-row;
   no "source-backed row plus patch override" case exists yet. When a fixture importer arrives it
   adds the patch form for its own rows, exactly as `matches` overrides do today.

No new provenance state is invented: `manual_admin_edit` / imported (reserved) / the three
lifecycle statuses are all that exist.

---

## 8. Season-boundary ownership (Planning Questions 6, 34)

**Answer: Option B — the existing reference/rollover process owns `seasons`; fixture administration
works against the register and never writes it.** This is the same answer ISSUE-161 D-6 recorded
and the migration-096 header restates (`096:33-57`), so there is one season-boundary model across
ISSUE-101, ISSUE-161 and ISSUE-162:

| Structure | Owner | ISSUE-162 |
|---|---|---|
| `seasons` row for S+1 | `seasons.json` via `load_reference_data.py`; advanced by the ISSUE-101 rollover | **never written**; no FK from `fixtures.season` (CHECK range only, as `096:75`) |
| `clubs.last_season`, `club_organizations` | same loader | never written |
| `club_seasons` for S+1 | derived from `matches` | never written; not required |
| `createMatch()`'s `INSERT INTO seasons` (`match-admin.ts:192-196`) | legacy data-editor path | **not reused**; it is the ISSUE-033 lineage the reference loader reverts |

Administrable fixture season: `max(seasons.year) <= S <= max(seasons.year) + 1` (D-3). The lower
bound admits the in-progress season so finals fixtures can be entered as they become known; the
upper bound matches ISSUE-161's list bound. `S < max(seasons.year)` is history and is refused for
every write (source-owned results already exist). When the rollover advances the register the window
slides and nothing has to be migrated.

**Operational note (not a dependency):** AFL Tables 2027 results can land in `matches` only once
the register carries 2027 (`matches.season REFERENCES seasons(year)`). That is the existing
ISSUE-101 lifecycle and is unaffected by fixtures; a 2027 fixture exists and is administrable
before, during and after that rollover. "Opening a season" for fixtures is the first fixture
written for it — no initialise action, no workflow state (the ISSUE-161 finding, §9.2 there).

---

## 9. Round model (Planning Question 7)

Reuse the `matches` vocabulary exactly, so the played resolution (§18) compares like with like:

- `round_type` = the existing enum (`home_and_away`, `wildcard_final`, `elimination_final`,
  `qualifying_final`, `semi_final`, `preliminary_final`, `grand_final`).
- Home-and-away: `round_number` 1..30 required; `round_code = round_number::text` (CHECK).
  **Opening Round is round 1** (AFLDB convention since 2024, §2.3); the UI labels round 1 with
  "AFLDB numbers the Opening Round as round 1" for seasons ≥ 2024 and never offers a round 0.
- Finals: `round_number NULL`; `round_code` is the `FINALS_CODES` key for the type (`EF QF SF PF
  GF WF`), derived server-side from `round_type` exactly as `createMatch()` does (`match-admin.ts:150-156`).
- Named rounds (Gather Round, Rivalry Round, split rounds) are not modelled in `matches` and are not
  modelled here; `notes` carries them. A split round is simply a round whose fixtures span more
  dates; nothing assumes one weekend.
- No hard-coded 24 rounds, 18 clubs or 9 games per round: the round set for a season is whatever
  fixtures exist; diagnostics (§27) report shape, never refuse it.
- Round text is not source-owned for fixtures: the admin selects a `round_type` and, for
  home-and-away, a `round_number`; the writer renders `round_code`. A human never types a code.

---

## 10. Date / time / TBC model (Planning Question 9)

| Fact | Representation | Rationale |
|---|---|---|
| Exact scheduled date | `match_date date` | same type as `matches.match_date` |
| Date known, time TBC | `match_date` set, `match_time NULL` | `matches.match_time` is already nullable text meaning "not published" (`076:59`); NULL is the existing "unknown" |
| Date TBC | `match_date NULL` (`match_time` must then be NULL too — writer rule) | new table, so nullable is free; **no fake midnight, no sentinel date** |
| Time known | `match_time text`, validated by the writer as `HH:MM` 24-hour local venue time | `matches.match_time` is free text from `Local.start.time` (`import_fitzroy_core.py:1604`); the writer constrains what an admin may type, the column keeps the vocabulary |
| Reschedule | UPDATE date/time under the token identity, audited (§15) | identity is not the date |
| `scheduled_at timestamptz` | **not added** | the `matches` column has had no reader or writer since migration 003; adding a second time representation invents a convention nothing consumes |

**Timezone is explicit and textual:** the stored time is local venue time, exactly as AFL Tables
publishes and `matches` stores it. No timestamptz, no UTC conversion, no DST arithmetic. Display
uses the same formatting the match page uses for `matchTime` (plain text); date formatting goes
through `formatDate` (`format.ts:125-134`, `timeZone: 'UTC'` on a `date` value, so no shift).
Sorting: `round_number NULLS LAST`, then `match_date NULLS LAST`, then `match_time NULLS LAST`,
then `id` — TBC fixtures sort to the end of their round, never to the start.

---

## 11. Venue model (Planning Question 10)

- Known venue: `venue_id` from `venues` (existing rows only, chosen from a list), `venue_raw =
  canonical_name` copied at write time (the `createMatch()` convention, `match-admin.ts:212-218`).
- TBC venue: `venue_id NULL`, `venue_raw NULL`.
- Named venue not in `venues`: `venue_id NULL`, `venue_raw = <typed name>` — the same shape
  `matches` uses for an unmapped source string (`003:74-75`). Diagnostic: "unmapped venue" (warning).
- Venue changed later: UPDATE, audited (§15).
- **No inline venue creation.** No `INSERT INTO venues` or `venue_aliases` exists anywhere in
  `src/`; venues are created by `import_venues()` (`import_fitzroy_core.py:3522`) from source
  strings and by the settle's alias resolution. A venue-administration surface is a separate
  ISSUE-156 child; ISSUE-162 hands off to it by leaving `venue_id NULL` with the name in
  `venue_raw`, which the admin corrects once the venue exists.

---

## 12. Club eligibility model (Planning Questions 11, 32, 33)

- **Source of truth:** `afldb_season_list_clubs(season)` (`096:166-185`) — the ONE rule
  ISSUE-161 introduced. For `S >= max(seasons.year)` it returns `is_current_afl_club` identities;
  a new club, rename or departure enters through `clubs.json` and is picked up with no code
  change. ISSUE-162 adds no second rule and modifies neither this function nor
  `afldb_identity_for_season()`.
- Writer invariant: `home_club_id` and `away_club_id` must both be in
  `afldb_season_list_clubs(season)`; an id typed or posted outside that set is refused
  (`club_ineligible`). Clubs are chosen from that list in the UI; ids, never names, are submitted.
- **Not circular:** the eligible set never reads `fixtures` or `matches` for a future season.
- **ISSUE-161 interaction:** none beyond the shared function. A fixture needs no membership; a
  membership needs no fixture (`AFLDB-ISSUE-161.md` §9.4, W-14). Fixture creation writes no
  `season_list_members` row and player lists are never consulted.
- **ISSUE-160 interaction:** none. `fixtures` references `clubs`, `venues`, `sources`,
  `import_batches` only; no `draft_picks` or `players` column, no read of either.
- Future expansion club: appears in the eligible set when `clubs.json` declares it current; until
  then a fixture naming it is refused rather than a placeholder being invented.

---

## 13. Create-match workflow (Planning Question 12)

`createFixture(input)` in a new `src/db/queries/admin-fixtures.ts` — the ONE fixture mutation
contract (the `admin-season-lists.ts` shape, `:11-96`):

Input: `season`, `roundType`, `roundNumber?`, `homeClubId`, `awayClubId`, `matchDate?`,
`matchTime?`, `venueId?` | `venueRaw?`, `notes?`, `adminUserId`.

Preconditions, all checked **before the first write**, under
`pg_advisory_xact_lock(<fixtures namespace>, season)` so two concurrent creates for one season
serialise (the ISSUE-155 Phase B lock pattern):

| Rule | Refusal reason |
|---|---|
| `max(seasons.year) <= season <= max + 1` | `season_out_of_window` |
| `roundType` valid; H&A ⇒ `roundNumber` in 1..30; finals ⇒ no number | `invalid_round` |
| `homeClubId <> awayClubId` | `same_club` |
| both clubs in `afldb_season_list_clubs(season)` | `club_ineligible` |
| `matchTime` requires `matchDate`; `matchTime` matches `^\d{2}:\d{2}$` | `invalid_schedule` |
| `venueId` exists, or `venueRaw` non-empty, or both absent | `invalid_venue` |
| no `status = 'scheduled'` fixture in `(season, round_code)` with the same unordered club pair | `duplicate_fixture` |
| neither club has a `scheduled` fixture in `(season, round_code)` | `club_already_scheduled` |
| no `matches` row for `(season, round_code, unordered pair)` | `already_played` (the game exists as a result; nothing to schedule) |
| token `randomUUID()` not already present (defensive) | `identity_collision` |

Writes, one import-role transaction: `INSERT INTO fixtures` (status `scheduled`,
`source_id = manual_admin_edit`, `source_record_id = token`) → `INSERT INTO data_overrides`
(`is_active = true`, whole-row payload §20) → `recordDataEdit(tx, { tableName: 'fixtures',
rowId, fieldGroup: 'fixture_creation', oldValues: {}, newValues: <payload> })`. Any refusal after
a write throws `RollbackRefusal` (never returned). No fuzzy matching anywhere: club ids, round
enum, exact codes.

---

## 14. Bulk-entry workflow (Planning Question 13)

**Recommendation: a round-at-a-time batch form with optional structured-paste pre-fill, previewed
and written all-or-nothing (Option E + B, D-4).** CSV/JSON upload and "import from external source"
are not built.

- The unit of entry is a round: one `roundType`/`roundNumber` header, N rows of
  (home, away, date, time, venue), N ≤ 20 (AFL rounds have ≤ 9 games; 20 leaves room without
  admitting a whole-season paste). A whole season is 24 such submissions, each under a minute.
- Paste: a textarea accepting one fixture per line (`Home, Away, YYYY-MM-DD, HH:MM, Venue`) is
  parsed **client-side** into the same structured rows the form submits; clubs and venues are
  resolved to ids by exact match against the eligible-club and venue lists, unresolved cells left
  blank and highlighted. The server never receives free text as a fixture; it receives ids.
- **Preview is mandatory and server-side:** `createFixtures({ rows, dryRun: true })` runs the full
  §13 validation over every row inside a transaction that is rolled back, and returns per-row
  outcomes plus a `previewFingerprint` (SHA-256 over the canonicalised rows). Confirm posts the
  rows again with the fingerprint; the writer recomputes it and refuses `stale_preview` on
  mismatch — the `CopyForwardPanel` lesson (`AFLDB-ISSUE-161.md` §33.5: never let Confirm act on
  rows the operator did not preview).
- **All-or-nothing**, one transaction, one `batch_id` (UUID) written into every override payload
  and audit row. Justification: a round is the natural unit; partial success creates the "did row
  7 land?" ambiguity that ISSUE-160's atomicity defect was about; re-entering nine rows costs less
  than reasoning about a half-written round. Row-level refusals are returned in full (row index,
  reason, offending value) with nothing written.
- Cross-row rules inside a batch: no club twice in the batch; no pair twice; every row also
  passes the single-row rules against the database state.

---

## 15. Edit / reschedule workflow (Planning Question 14)

All edits are UPDATEs of the same row/identity, each its own transaction with a CAS on
`expectedUpdatedAt` (`stale` refusal, the ISSUE-161 remove pattern), the season advisory lock, the
override payload rewritten whole-row, and a `data_edits` row with old/new values.

| Field | While `scheduled` and unplayed | Once played (§18 resolves to a match) | Once `cancelled` | Once `void` |
|---|---|---|---|---|
| date / time (`fixture_schedule`) | yes | **refused** `played_locked` — the result row is authoritative | yes (a cancelled game may be rescheduled, which also reinstates it, §16) | refused |
| venue (`fixture_venue`) | yes | refused `played_locked` | yes | refused |
| round (`fixture_round`) | yes, re-runs duplicate/played checks for the new round | refused | yes | refused |
| home/away swap (`fixture_clubs`) | yes, re-runs checks | refused | yes | refused |
| replace a club (`fixture_clubs`) | yes, re-runs checks | refused | yes | refused |
| season | **never** — void and re-create | — | — | — |
| notes (`fixture_notes`) | yes | yes (the only edit a played fixture accepts) | yes | yes |

"Once played" is evaluated at write time inside the transaction from §18's resolution, so a
schedule edit can never race a settle into orphaning anything: the fixture holds no statistics to
orphan, and the played row is never touched by any ISSUE-162 write. Correcting a **played** match's
round/date/clubs is ISSUE-156 P10 (`match-rekey.ts`), not this issue (§31).

---

## 16. Delete / cancel / void workflow (Planning Question 15)

**No hard DELETE. Two terminal statuses, both replay-safe (D-2):**

| Situation | Operation | Row | Override | Reversible? | Excluded from uniqueness? |
|---|---|---|---|---|---|
| Data-entry mistake (wrong clubs, wrong season, duplicate) | `voidFixture({ reason })` | `status = 'void'`, `status_reason` | active, payload `status: 'void'` | no (create a new fixture) | yes |
| Real-world cancellation / abandonment before play | `cancelFixture({ reason })` | `status = 'cancelled'`, `status_reason` | active, payload `status: 'cancelled'` | yes: `reinstateFixture()` → `scheduled` after re-running §13 checks | yes |
| Rescheduled / replaced | **edit** the same fixture (§15) — identity is the token, so a "replacement row" is unnecessary; if a cancelled fixture is later replayed on a new date, reinstate and reschedule it | — | — | — | — |
| Played fixture | void/cancel **refused** `played_locked` | — | — | — | — |

Why not the ISSUE-161 DELETE-plus-tombstone: fixture audit rows point at `fixtures.id` (§23), and
a deleted row's `data_edits` would become unresolvable at the next promotion lineage remap
(`docs/production-promotion.md` §7.4c) — the exact stop the ISSUE-160 `draft_pick_key` rule was
written to avoid. Keeping the row keeps every audit row resolvable forever, matches the ISSUE-155
"deactivate, never delete" and C1 "claim-and-demote, never delete" precedents, and preserves the
distinction the operator asked for: `void` is "this never should have existed", `cancelled` is
"this was real and did not happen". Void rows are hidden from every list by default and visible
under a "show voided" filter with their reason.

---

## 17. Finals workflow (Planning Question 16)

- A finals fixture is an ordinary fixture with a finals `round_type`, `round_number NULL`,
  `round_code` rendered from the type; venue/date/time TBC via NULLs.
- **It is created when the two participants are known** (after the qualifying week), not before.
  No placeholder club, no "TBC v TBC" row: `home_club_id`/`away_club_id` are NOT NULL and
  reference tracked club identities only (§5). Until then the finals series simply has fewer
  fixtures, which the season diagnostics show as "finals: N of an expected up-to-9 known" (info).
- Two clubs can meet twice in a series (QF and GF): `round_code` separates them in every rule.
- The Wildcard Final is `wildcard_final`; `is_final` true; nothing here reads `is_finals_series`.
- Once AFL Tables publishes the result, the fixture resolves to played (§18) like any other.

---

## 18. Result-settlement model (Planning Question 17)

"Settlement" is a **read-time, deterministic resolution**, defined once (a SQL fragment exported
from `admin-fixtures.ts`, used by every read and by the write-time `played_locked` check):

```text
for fixture f (status <> 'void'):
  exact   := matches m WHERE m.season = f.season AND m.round_code = f.round_code
                         AND m.home_club_id = f.home_club_id AND m.away_club_id = f.away_club_id
  swapped := same, with home/away exchanged
  |exact| = 1                          -> played            (match id = that row)
  |exact| = 0 AND |swapped| = 1        -> played_home_away_differs   (warning; match id = that row)
  |exact| + |swapped| = 0              -> unplayed
  otherwise                            -> ambiguous          (hard diagnostic; never resolved automatically)
```

- Identity used: season, round code and club **ids** — the stable components of §6; date and
  venue are deliberately absent so a source-published reschedule still resolves.
- No name matching, no date tolerance, no scoring. `ambiguous` is surfaced, never merged
  (the `match-rekey.ts` rule 4 discipline).
- **D-6 condition (binding):** the resolution is deterministic and **fails closed**. The only
  inputs are exact `season`, exact `round_code` and exact club **ids**; the `swapped` arm is the
  same three exact facts with the two ids exchanged, not an approximation. Any outcome other than
  exactly one `exact` row, or zero `exact` and exactly one `swapped` row, leaves the fixture
  **unlinked** (`unplayed` or `ambiguous`); nothing is guessed from names, dates or venues, and
  nothing is ever written by the resolution. `fixture_key` remains the identity of a played
  fixture; the resolved `matches.id` is a read-time value only (§6 constraint).
- Conflict behaviour when the source's row disagrees with the fixture on date/venue/home-away: the
  fixture still resolves (played), and the diagnostics list the disagreement as `warning`
  (`schedule_differs_from_result`). The result row is authoritative for what happened; the
  fixture is left as the record of what was scheduled and may be edited only in `notes`.
- A source round convention mismatch (the ISSUE-140 class: source says round N, AFLDB round N+1)
  cannot arise inside AFLDB's own `matches` because the settle already normalises to AFLDB's
  numbering; a fixture entered under the wrong number shows as `unplayed` with a
  `played_match_without_fixture` counterpart in the same round's diagnostics, which is the cue to
  correct the fixture's round (§15).
- **No twin:** ISSUE-162 never inserts into `matches`; the settle never inserts into `fixtures`.

---

## 19. Current-season ingestion interaction (Planning Question 18)

| Path | Reads/writes `matches`? | Reads/writes `fixtures`? | Change required |
|---|---|---|---|
| Squiggle/Kali refresh (`current-season-import.ts`) | resolves only; "cannot create a partial `matches` row" (`:483`) | no | **none** |
| AFL Tables settle (`settle-afltables.ts` / `canonical-apply.ts`) | inserts/updates by `match_key`; rekey by ISSUE-131 rules | no | **none** |
| `repair-match-rekeys.ts` | matches | no | none |
| `/admin/current-season` trigger (ISSUE-127) | runs the settle | no | none |
| `manual-authority.ts` proof | reads `data_overrides.entity_type` CHECK live; order-independent since ISSUE-159 D-1 (`:33-44`) | `OVERRIDE_ENTITY_TYPES` gains `'fixtures'` (`:80-82`); not a settle target, so `UNREPRESENTABLE_OVERRIDE_ENTITIES` unchanged and condition 2 holds in either deploy order | one constant + its test |

No second ingestion path is created. Manual fixtures coexist with source data because they are a
different fact in a different table; they are "settled" by §18's resolution the moment the settle
lands the result.

---

## 20. fitzRoy / rebuild / replay / promotion model (Planning Questions 19, 26)

- **Does the rebuild destroy manual fixtures?** `npm run db:test:rebuild` starts from an empty
  database, and a promotion swaps in a rebuilt candidate whose registry tables are empty
  (`docs/production-promotion.md` §1: everything in `import_writable_tables` "arrives with the
  rebuild"). So yes — exactly as for `season_list_members`, `coaches`, manual `players` and
  manual `draft_picks`, which is why the registry-plus-replay shape exists.
- **Durable record:** `data_overrides` row per fixture: `entity_type = 'fixtures'`,
  `entity_key = 'manual_admin_edit:<token>'`, `field_group = 'fixture'`, `is_active = true`
  always (status lives in the payload; no tombstones, §16), payload:
  `{ fixture_key, season, round_type, round_number, round_code, match_date, match_time,
  home_club_slug, away_club_slug, venue_slug?, venue_raw?, status, status_reason?, notes?,
  batch_id? }` — club **slugs** (tracked reference data) and venue **slug**, never ids.
- **`replay_admin_overrides(conn, 'fixtures')`** (new branch in `tools/migration/common.py`):
  1. fail-closed pre-check over every `fixtures` override: token present; season in range;
     `round_type` a valid enum label and `round_number`/`round_code` consistent; both club slugs
     resolve to an identity in `afldb_season_list_clubs(season)`; `status` in the CHECK set; any
     failure → `RuntimeError` naming the keys, nothing written;
  2. venue: `venue_slug` resolving to a venue → `venue_id` + canonical name; not resolving →
     `venue_id NULL`, `venue_raw` from the payload, **counted and printed** (venue is enrichment,
     `003:74-75`, not identity; a promotion is not stopped by a venue rename);
  3. `INSERT … WHERE NOT EXISTS (fixture_key)` (never `ON CONFLICT`), then `UPDATE` every
     scheduling/status field from the payload for rows that exist, so a replay is idempotent and
     re-creates `void` and `cancelled` rows too (their audit rows must stay resolvable).
- **Call sites:** `import_fitzroy_core.py` after `replay_admin_overrides(pg, "matches")`
  (`:3538-3540`) — binding order: after `players` is irrelevant, after `matches` is not required
  either (the played link is read-time), but placing it in the `matches` group keeps "every
  match-shaped thing" together; the §8 promotion loop in `docs/production-promotion.md:650-661`
  becomes `('players', 'matches', 'draft_picks', 'season_list_members', 'coaches',
  'match_coaches', 'fixtures')` with the ordering note "`fixtures` is independent and may go
  anywhere".
- **Promotion inventory (`tools/db/promotion-inventory.ts`):**
  - `fixtures` is registered via `afldb_meta.grant_import_write('fixtures')` → an import-writable
    **registry** table; **no `PROMOTION_CONTRACT` entry** (that would classify it `both` and refuse
    every phase, `096:238-244`); not a `DERIVED_FOOTBALL_TABLE`.
  - New `LineageIdentityRule` **`fixture_key`** (`:88-90`) with `byId`/`byIdentity` SQL over
    `fixtures (id, fixture_key)`, and a new `data_edits` target
    `{ kind: 'fixtures', entity: 'fixtures', identity: 'fixture_key' }` beside the `draft_pick_key`
    entry (`:333-348`), so `data_edits.table_name = 'fixtures'` rows remap across a lineage change
    exactly as draft audit rows do. Because rows are never deleted (§16) and the replay re-creates
    every override before the remap runs, every fixture audit row resolves.
  - `tests/db-promotion-check.test.ts` extended; `assertContractCoherent()` and the classification
    test must pass with the new registry row (unclassified → every phase refuses — **stop**, R-3).
- **Promotion window:** between the swap and the replay no fixture exists in the promoted
  database; no public surface reads fixtures (§22), so it is admin-visible only, and the promotion
  record states it (the 159/160/161 wording).
- **Disaster recovery:** `data_overrides` is in every backup; restore + the §8 loop re-creates every
  fixture; `privileges.sql` must be reconciled after a restore (fail-closed read registry).
- **Fail-closed conditions:** unresolvable club slug, invalid round vocabulary, invalid status,
  missing token, unclassified table, missing lineage rule → the replay/checker stops and names the
  key; none of these is skipped.

---

## 21. Derived-statistics safety (Planning Question 20)

**By construction:** ISSUE-162 writes `fixtures`, `data_overrides` and `data_edits` only. It never
inserts, updates or deletes a `matches`, `match_period_scores`, `player_match_stats`,
`club_seasons` or `seasons` row and never calls `recomputeClubSeasons`, `recomputeSeasonMetadata`
or `rebuild_derived.py`. Every consumer audited reads `matches` (or tables derived from it) and
none reads `fixtures`:

| Consumer | Reads | Affected? |
|---|---|---|
| Final ladder `club_seasons` | `matches WHERE NOT is_final` (`rebuild_derived.py:340-356`, `player-derived.ts:427-458`) | no |
| Round ladder | `matches` (`rounds.ts:44-105`) | no |
| Season metadata / status / match_count | `matches` (`player-derived.ts:515-560`) | no |
| Club records, comparison, streaks | `matches` (`clubs.ts`, `club-comparison.ts`, `nl/team-streak.ts`) | no |
| Venue records / counts | `matches` (`venues.ts:49,147-449`) | no |
| Match search, match pages, sitemap | `matches` (`match-search.ts`, `matches.ts:23-95`, `sitemap.ts`) | no |
| Player stats / W-D-L / coach records | `player_match_stats`, `match_coaches` → `matches` | no |
| NL search plans | `matches` (`search/nl/plan.ts`, `nl/*.ts`) | no |
| Grid Solver | `matches` (`grid-solver.ts:194-201`) | no |
| Brownlow coverage | `matches` (`016`) | no |
| Current-season completeness / settle report | `matches`, staging | no |

**Contract test (Stage 1):** a static source contract asserting the string `fixtures` (as a table
reference) appears in none of `src/db/queries/**` except `admin-fixtures*.ts`, none of
`src/search/**`, none of `src/lib/acquisition/**`, and none of `tools/migration/rebuild_derived.py`
— the `tests/reference-data.test.ts` "tables after 045" style. Plus the integration proofs in §29.

---

## 22. Public-site impact (Planning Question 21)

- **A. Required correctness changes: none.** No public page, NL plan, Grid Solver axis or API
  reads `fixtures`; no public behaviour changes.
- **B. Useful UI exposure (deferred, separate ISSUE-156 child or public issue):** season page
  "Upcoming fixtures" for an in-progress season (`/seasons/[year]` is ISR 1h and prerendered —
  `season-page-isr-stale-after-settle` memory — so exposure needs its own revalidation design);
  club page "Next match"; venue page "Upcoming"; a pre-match `/fixtures/[season]/[key]` page.
- **C. Follow-ups:** fixture importer under a source id (Squiggle publishes fixtures); reconciliation
  view (§31); venue administration (§11).
- Consequence: `revalidatePaths: []` always in Stage 2 actions, no revalidate route (the ISSUE-161 §10
  decision), until B exists.

---

## 23. Capabilities / permissions (Planning Question 22)

Pattern inspected: `data.<domain>.read` / `data.<domain>.edit` (`capabilities.ts:42-47,88-106`),
`ADMIN_AND_UP` for read, `SUPER_ADMIN_ONLY` for edit; nav in the Data group (`nav-model.ts:84-91`).

| Capability | Roles | Grants |
|---|---|---|
| `data.fixtures.read` | Admin, Super Admin | every `/admin/fixtures*` page, diagnostics, audit links |
| `data.fixtures.edit` | Super Admin | create, batch create, edit/reschedule, venue/round/club changes, cancel, reinstate, void |
| Contributor | — | nothing; `requireCapability` redirects before any fixture markup or action reference reaches the client (ISSUE-155 §27.27 K precedent) |

Result entry is **not** a fixture capability: scores live in `matches` and are owned by the settle
and the data editor; a fixture never accepts a score. `tests/auth.test.ts`'s source contract must
cover both capabilities at every page/route/action boundary.

---

## 24. Audit contract (Planning Question 23)

`data_edits.table_name` CHECK is widened to admit `'fixtures'` (migration, §26) — the ISSUE-160
`draft_picks` shape, not the ISSUE-161 audit-on-the-parent shape, because a fixture has no
allowlisted parent row and (§16) is never deleted, so `row_id = fixtures.id` always resolves
through the `fixture_key` lineage rule.

| Operation | `field_group` | `old_values` → `new_values` | Extra |
|---|---|---|---|
| create | `fixture_creation` | `{}` → whole row | — |
| batch create | `fixture_creation` per row | as above | `batch_id`, `batch_size` in `new_values`; one `data_edits` row per fixture |
| reschedule | `fixture_schedule` | `{match_date, match_time}` before → after | — |
| venue change | `fixture_venue` | `{venue_id, venue_raw}` | — |
| round change | `fixture_round` | `{round_type, round_number, round_code}` | — |
| home/away swap or club replacement | `fixture_clubs` | `{home_club_id, away_club_id}` | — |
| cancel | `fixture_cancelled` | `{status, status_reason}` | reason required |
| reinstate | `fixture_reinstated` | `{status, status_reason}` | — |
| void | `fixture_void` | `{status, status_reason}` | reason required |
| notes | `fixture_notes` | `{notes}` | — |

Every row carries actor (`admin_user_id`), the fixture (`row_id`), and — inside `new_values` —
`fixture_key`, `season`, `round_code`, `home_club_slug`, `away_club_slug`, so the entry is readable
without joining. `note` carries the operator's free-text reason. Refusals worth recording
(`duplicate_fixture`, `club_already_scheduled`, `already_played`, `played_locked`, `stale`,
`stale_preview`, `forbidden`) are audited to `auth_audit_log` via `audit()` after the transaction,
as the ISSUE-161 actions do (`season-lists/actions.ts:29-40`); ordinary validation misses are not.
Source settle/reconcile is not an ISSUE-162 mutation and writes no fixture audit.

The ISSUE-157 audit viewer (`/admin/audit/entity/fixtures/<id>`) must accept the new
`table_name`; the entity-link helper in `src/db/queries/data-edits.ts` gains a `fixtures` case
(read-only, Stage 2).

---

## 25. Transaction contract (Planning Question 24)

Binding on every writer in `admin-fixtures.ts` (the `admin-season-lists.ts:70-77` contract):

1. One `AFLDB_IMPORT_DATABASE_URL` transaction per operation (single fixture, single edit, whole
   batch); `pg_advisory_xact_lock(<namespace>, season)` first.
2. Every precondition (§13, §15, §16) is evaluated **before the first write**, inside the lock.
3. Canonical write → `data_overrides` write → `recordDataEdit()` in that order in the same
   transaction; an audit or override failure rolls the canonical write back (ISSUE-027).
4. Any refusal discovered after a write is **thrown** as `RollbackRefusal`, never returned
   (`postgres.js` commits when the callback resolves — the ISSUE-160 defect).
5. No post-commit audit of the mutation itself; only the `auth_audit_log` refusal/success note.
6. Batch = **all-or-nothing** (D-4): one transaction, every row validated against the database and
   against the other rows, one `batch_id`; any failure returns every row's outcome and writes nothing.
7. `expectedUpdatedAt` CAS on every edit; the loser of a race is refused `stale`.
8. Forced-failure proofs (Stage 1 gate): a trigger on `data_edits`/`data_overrides` that raises for
   a marked note must roll back the fixture row (the ISSUE-159/160/161 gate-8 strategy).

---

## 26. Migration plan (Planning Question 27)

**Required: yes, one, additive, forward-only, no backfill.** Next free number at planning:
**097** (highest on this branch: `096_season_list_members.sql`). **Not allocated here**; Stage 1
re-checks `src/db/migrations/` on its own branch first.

Contents:

1. `CREATE TABLE fixtures` + indexes (§4). No FK to `seasons` (§8). `is_final` generated.
2. `data_overrides.entity_type` CHECK: add `'fixtures'` (retain every existing literal verbatim;
   the three unrepresentable settle targets stay absent, `096:189-231`).
3. `data_edits.table_name` CHECK: add `'fixtures'` (retain every literal from `095:105-118`).
4. `SELECT afldb_meta.grant_app_read('fixtures'); SELECT afldb_meta.grant_import_write('fixtures');`
   — app reads for the admin pages, import-role writes for the mutations, registry classification
   for promotion; **no `privileges.sql` edit** (the registries drive it); nothing for `afldb_auth`.
5. `COMMENT ON TABLE/COLUMN` stating: schedule facts only; never a score; status semantics; played
   is derived; never hand-edited outside `admin-fixtures.ts`.

Deploy order is binding: **migration → `npm run db:privileges` → code** (app read is fail-closed
since 039; ISSUE-027/161 precedent). The two CHECK widenings are safe in either order relative to
the code: code writing `'fixtures'` before the migration is refused by the CHECK and rolled back;
`manual-authority.ts`'s proof is order-independent (ISSUE-159 D-1). No destructive statement, no
data rewrite, no down-migration.

---

## 27. Fixture-completeness diagnostics (Planning Question 28)

Read-only, per season, shown on `/admin/fixtures/[season]` (Stage 2), computed in
`admin-fixtures-ui.ts`:

| Class | Check |
|---|---|
| **Hard invalid** (should be impossible; shown if ever present) | two `scheduled` fixtures for one club in one round; same pair twice in one round; `ambiguous` played resolution (§18); H&A fixture with `round_number` NULL |
| **Warning** | `played_home_away_differs`; `schedule_differs_from_result` (date/venue/time disagree with the played row); `played_match_without_fixture` (a `matches` row in the season/round with no fixture — the ISSUE-140 cue); unmapped venue (`venue_raw` set, `venue_id` NULL); a club with 0 scheduled fixtures in a season that has any (likely incomplete entry); a club whose H&A fixture count differs from the modal count by more than 1 |
| **Informational** | total fixtures; per-round counts; per-round byes (clubs with no fixture in that round, listed by name — bye vs incomplete is not decidable, so it is shown, not judged); TBC counts (date / time / venue); finals known (per `round_type`); cancelled and void counts; played / unplayed counts |

Nothing here refuses: AFL formats vary (Opening Round, 23-round seasons, unequal counts,
wildcards), so shape is reported, never enforced.

---

## 28. Admin UI route / design plan (Planning Questions 29, 30)

Conventions inspected: `/admin/season-lists`, `/[season]`, `/[season]/[club]`; `force-dynamic`;
`generateMetadata` calling `requireCapability`; `robots: noindex`; panels as client components
with `useActionState` through the shared `action-submit.ts` helper; `revalidatePaths: []`.

| Route | Capability | Content |
|---|---|---|
| `/admin/fixtures` | `data.fixtures.read` | administrable seasons (`max`, `max+1`) with fixture / round / TBC / played counts and a diagnostics badge; link into each |
| `/admin/fixtures/[season]` | read (edit reveals panels) | rounds as stacked sections (never one wide grid): each round a compact list of fixtures (date · time · home v away · venue · status/played chip · provenance chip); filters: round, club, status, TBC-only, played/unplayed, show voided; diagnostics panel (§27); "Add fixture" and "Enter a round" entry points |
| `/admin/fixtures/[season]/new` | `data.fixtures.edit` | two tabs on one page: **Single fixture** (round-at-a-time form with one row) and **Round batch** (§14: header + N rows + paste box → Preview → Confirm) |
| `/admin/fixtures/[season]/[fixtureKey]` | read (edit reveals panels) | detail: schedule, venue, round, clubs, status, provenance, played resolution with a link to `/matches/[id]` when played; panels: reschedule, venue, round, swap/replace clubs, cancel/reinstate, void, notes; link to `/admin/audit/entity/fixtures/<id>` |

Nav: Data group, "Fixtures" after "Season lists". Dashboard badge optional (count of TBC in the
in-progress season).

UX choice (Q30): **round-at-a-time form** (single row = the same form with N=1), not a wizard
(too slow for 200 rows), not a modal (loses context), not a spreadsheet grid (unusable at 320px,
keyboard-hostile). Keyboard: tab order home → away → date → time → venue → next row; Enter in the
last cell adds a row; clubs and venues are `<select>`s populated from the eligible list so no
free text reaches the server; duplicates are caught client-side before preview and again
server-side. Confirmation: preview table with per-row outcome, then a single Confirm bound to the
preview fingerprint. Responsive targets 320 / 768 / 1000 / 1280 / 1920: each fixture row stacks
to two lines under 768px; the batch form becomes one card per row under 768px; no horizontal
scroll; focus restored after a refused action (ISSUE-155 H-1 `focus-restore.ts` reuse).

---

## 29. Test strategy (Planning Question 35)

Existing homes reused; two new suites named in the 159/160/161 convention.

| Suite | Kind | Covers |
|---|---|---|
| `tests/admin-fixture-actions.test.ts` (new) | pure | key/payload shape; round rendering (H&A, finals, WF, Opening Round = 1); date/time/TBC validation (`HH:MM`, time without date refused); season window arithmetic; batch cross-row rules; preview fingerprint; action parsers/allowlists; refusal-audit selection |
| `tests/integration/admin-fixtures.test.ts` (new, `afldb_test`, marker `AFLDB-ISSUE-162-TEST`, seasons `max+1`/`max+2` under the same `NODE_ENV=test` ceiling ISSUE-161 uses, no `seasons`/`clubs`/`club_seasons` row created) | DB | create; unplayed fixture has no score anywhere; duplicate refusal; `club_already_scheduled`; `same_club`; ineligible club; season out of window; TBC venue/date/time; reschedule; venue change; round change; swap; cancel → reinstate; void; finals fixture; **zero `player_match_stats` / `match_period_scores` / `matches` rows written** (count before = after); ladder safety: `club_seasons` for the test season absent before and after, `recomputeClubSeasons` never invoked (spy) and `seasons.match_count` unchanged; identity: token durable across edits; played resolution — seed one marker `matches` row through the test's owner connection (never through ISSUE-162 code) and prove `played`, `played_home_away_differs`, `ambiguous`, `played_locked`; transactions — forced-failure triggers on `data_edits` and `data_overrides` roll the row back, post-write refusal throws, batch atomicity (one bad row writes nothing); **real replay**: run `replay_admin_overrides('fixtures')` from `tools/migration/common.py` via the repository `.venv` (the ISSUE-161 harness, `admin-season-lists.test.ts:26-70`) after deleting the test rows and prove byte-equal re-creation including `void`/`cancelled`, venue degrade path, and the fail-closed refusals |
| `tests/auth.test.ts` | contract | both capabilities declared, role table, nav entry, every page/route/action boundary |
| `tests/data-overrides-source-contract.test.ts` | contract | `'fixtures'` admitted; settle targets still absent |
| `tests/reference-data.test.ts` | contract | `fixtures` in the post-045 registry list |
| `tests/db-promotion-check.test.ts` | contract | registry classification, `fixture_key` rule, `data_edits` target, `assertContractCoherent()` |
| manual-authority test | contract | `OVERRIDE_ENTITY_TYPES` includes `'fixtures'`; conditions 2 and 4 hold |
| derived-safety source contract (new `it` in `reference-data` or a sibling) | static | no `fixtures` reference in derived/NL/grid/acquisition code (§21) |
| `tests/admin-match-mutations.test.ts` | regression | `createMatch`/`deleteMatch` unchanged |
| Playwright (DEV batch, §34) | UI | three-role matrix; season/round views; refusal rendering; keyboard flow; focus after refusal; 320/768/1000/1280/1920; batch preview → confirm → stale-preview refusal |

---

## 30. Performance (Planning Question 36)

Volumes: ≤ ~230 fixtures per season, two seasons administrable. Season page = one query over
`fixtures` joined to `clubs`/`venues` plus one played-resolution join against `matches` filtered by
season (`ix_matches_season_round` and the club indexes already exist). Diagnostics = a handful of
grouped queries per page load. Indexes: exactly those in §4 (every FK column carries a leading
index — `tests/integration/fk-indexes.test.ts`). No caching, no materialised view, no new index on
`matches`.

---

## 31. Explicit out-of-scope

- Correcting a **played** match's identity, round, date or clubs — ISSUE-156 **P10**
  (`match-rekey.ts`, ISSUE-142 lineage interaction); never through a fixture edit.
- Score/result/attendance/lineup entry of any kind.
- Any write to `matches`, `seasons`, `clubs`, `club_seasons`, `venues`, `venue_aliases`.
- A fixture importer (Squiggle/Kali/AFL Tables) and a reconciliation dashboard (AFLDB-only /
  source-only / same / changed-date / changed-venue / unresolved) — deferred; the §18 resolution
  and the §27 warnings are the minimum linking needed for settlement and are all Stage 2 ships.
- Public exposure (§22 B/C).
- Venue administration.
- AFLW fixtures.
- Named-round labels.
- A `seasons` initialise action or any change to the ISSUE-101 rollover.
- Backfilling historical fixtures (no source publishes AFLDB-normalised schedules; nothing to backfill).

---

## 32. Risks / stop conditions

| ID | Condition | Status at planning | Stage 1 action if it fires |
|---|---|---|---|
| S-1 | Scheduled rows in `matches` contaminate ladder/stat derivation | **fires for options A/C** (§3) — resolved by choosing B′; no fixture row is ever written to `matches` | if any Stage 1 code path writes `matches`: stop |
| S-2 | Match identity cannot survive date/venue changes | `match_key` cannot; `fixture_key` can (§6) — resolved | — |
| S-3 | Current-season import would inevitably duplicate manual fixtures | different tables; no importer reads/writes `fixtures` (§19) — resolved | — |
| S-4 | Season register ownership conflicts between ISSUE-101/161/162 | one model, Option B (§8) — resolved | — |
| S-5 | Current schema cannot represent TBC facts without fake values | `matches` cannot; `fixtures` NULLs can (§10) — resolved by the migration | — |
| S-6 | Rebuild would destroy manual fixtures without a safe replay identity | registry + whole-row override + token (§20) — resolved | replay not byte-exact in the real-replay test → stop |
| S-7 | Finals placeholders require fake clubs | none created (§17) — resolved | — |
| S-8 | Cancellation/deletion could erase played historical data | fixtures hold none; played fixtures are locked (§15, §16) — resolved | — |
| S-9 | Migration requires unsafe backfill | none (§26) — resolved | — |
| S-10 | Stage 1 requires DEV/PROD mutation | no; `afldb_test` only | — |
| R-1 | Unclassified table refuses every promotion phase | `grant_import_write` registry, checker test | classification test fails → stop before merge (ISSUE-156 R-3) |
| R-2 | `data_edits` rows for fixtures unresolvable at lineage remap | never-delete + `fixture_key` rule (§16, §20) | `db-promotion-check` unresolved → stop |
| R-3 | Subtractive `afldb_auth` spec / fail-closed app read | registries drive privileges; deploy order stated (§26) | — |
| R-4 | Two Super Admins race one season | season advisory lock + CAS | concurrency test |
| R-5 | `revalidatePath` inside a Server Action hangs the client | no revalidation at all in this issue | — |
| R-6 | int8-as-string on `fixtures.id`/`data_edits.id` | cast `::int`/`::text` in SQL (ISSUE-156 §4 trap) | contract test |
| R-7 | Windows CRLF false failures | known; Linux is the gate | — |

None of S-1…S-10 blocks the plan as designed; S-1 and S-5 are the reasons for the design.

---

## 33. Staged implementation plan

**Stage 1 — model, mutations, replay, promotion, derived-safety (Opus 5 high or Fable 5.1 high,
fresh session, this worktree)**

1. Preflight: `npm run preflight -- --mode implementation --issue 162`; re-check next free
   migration; confirm D-1, D-2, D-6 decided.
2. Migration (§26). Apply to `afldb_test` only.
3. `src/db/queries/admin-fixtures.ts`: `createFixture`, `createFixtures` (dry-run + write),
   `rescheduleFixture`, `changeFixtureVenue`, `changeFixtureRound`, `changeFixtureClubs`,
   `cancelFixture`, `reinstateFixture`, `voidFixture`, `updateFixtureNotes`, the played-resolution
   fragment, `administrableFixtureSeasons()`, `readSeasonFixtures()`, diagnostics readers, override
   reader through the narrow import-role SELECT helper.
4. `tools/migration/common.py` `replay_admin_overrides('fixtures')` + `import_fitzroy_core.py`
   call site + `docs/production-promotion.md` §8 loop and §1 table row.
5. `tools/db/promotion-inventory.ts`: `fixture_key` rule + `data_edits` target;
   `manual-authority.ts` constant; `data-edits.ts` entity link case.
6. Tests (§29) green: new pure + integration suites, contract suites, forced-failure proofs, real
   replay, derived-safety proofs; `tsc`, eslint, `git diff --check`.
7. Ledger update; stop for operator review/commit.

**Stage 2 — admin surface (Fable 5.1 high, fresh session)**

1. Capabilities + nav (§23); routes and panels (§28); Server Actions with the shared submit helper;
   `revalidatePaths: []`.
2. Batch entry UI with paste pre-fill, preview, fingerprint-gated confirm.
3. Diagnostics panel (§27); audit viewer entity link.
4. `tests/auth.test.ts` contract; action parsers; local `next build`/typecheck; static responsive
   review. Live Playwright deferred to §34.
5. Ledger update; stop.

**No Stage 3.** A fixture importer, reconciliation view, public exposure and venue admin are
separate issues.

---

## 34. Admin Centre batch rollout / deployment plan (Planning Question 37)

Recorded explicitly, per the operator's standing rule:

- ISSUE-162 is developed locally on top of ISSUE-161 (on ISSUE-160). Nothing deploys to DEV during
  implementation; PROD is not touched.
- No Admin/Super Admin change deploys to DEV until ISSUE-162 is code-complete **and** the operator
  confirms there is no further Admin Centre addition to include in the batch.
- Then, in order: integrate the stacked branches (160 → 161 → 162); apply migrations in order
  (096, then ISSUE-162's number); `npm run db:privileges`; rebuild/update DEV; combined
  ISSUE-160 + 161 + 162 acceptance; three-role Playwright; responsive acceptance at
  320/768/1000/1280/1920; fix defects; close the three issues when green.
- PROD follows the ISSUE-151 promotion contract (registry table, replay before the `data_edits`
  remap) and is a separate, later operator decision.

---

## 35. Operator decisions — DECIDED 2026-09-11 (binding for Stage 1 and Stage 2)

| ID | Decision | Outcome | Binding wording |
|---|---|---|---|
| **D-1** | Canonical fixture model (§4) | **APPROVED — B′** | Use a separate canonical `fixtures` registry. Do not reuse `matches` for unplayed schedule rows. |
| **D-2** | Removal semantics (§16) | **APPROVED** | Fixtures are never hard-deleted. Use `scheduled` / `cancelled` / `void` lifecycle states and preserve audit/replay identity. |
| **D-3** | Administrable season window (§8) | **APPROVED** | Use the safe forward-season window `max(seasons.year) <= S <= max + 1`. Do not mutate the season reference register merely to administer the next fixture. |
| **D-4** | Bulk-entry UX and transaction mode (§14) | **APPROVED** | Round-batch entry is the primary bulk workflow, with preview + validation + atomic (all-or-nothing) commit. |
| **D-5** | TBC representation (§10, §11) | **APPROVED** | NULL means genuinely TBC/unknown for date, local time and venue. No fake values. |
| **D-6** | Played linkage (§18) | **APPROVED WITH CONDITION** | Played linkage is derived/read-time, but must be **deterministic and fail closed**. No approximate or name/date-only guessing. Ambiguity leaves the fixture unlinked. The durable `fixture_key` remains the fixture identity after a match is played. |
| **D-7** | Public exposure (§22) | **APPROVED** | No public fixture exposure in ISSUE-162. |
| **Constraint** | Identity across settlement (§6) | **operator constraint, 2026-09-11** | A played-match association must not replace `fixture_key` with `match_key`. `fixture_key` remains stable across reschedules, venue changes and settlement. |

Options considered and rejected for each decision are retained in the corresponding sections
(§5 for D-1; §16 for D-2; §8 for D-3; §14 for D-4; §10 for D-5; §5 and §18 for D-6; §22 for D-7).

Technical questions resolved from evidence and **not** put to the operator: table vs override-only
(§5), identity token (§6), one eligibility rule (§12), round vocabulary (§9), venue handoff (§11),
finals-when-known (§17), audit target and `data_edits` widening (§24), capabilities (§23),
routes (§28), stage split (§33), no settle/current-season change (§19), promotion classification
(§20).

---

## 36. Final report

1. **Proposed issue title:** AFLDB-ISSUE-162 — Fixture / season schedule administration: create and
   maintain a future AFL season's fixture inside AFLDB (ISSUE-156 P3d).
2. **Recommended canonical model:** new canonical registry table `fixtures` (schedule facts only,
   no score columns); `matches` unchanged and played-only; played state derived by resolution.
3. **Migration required:** **yes**, one additive migration (next free **097** at planning, not
   allocated): table + indexes; `data_overrides.entity_type` += `'fixtures'`;
   `data_edits.table_name` += `'fixtures'`; `grant_app_read` + `grant_import_write`. No backfill.
4. **Scheduled vs played:** different tables. A fixture cannot carry a score; a match cannot be
   unplayed. "Played" = exactly one `matches` row for the same season, round code and club pair.
5. **Durable match identity:** `fixtures.fixture_key`, a UUID minted once under
   `manual_admin_edit`, never edited; `data_overrides` key `manual_admin_edit:<token>`;
   `match_key` is never used for fixtures.
6. **2027 availability:** no initialise step and no `seasons`/`clubs`/`club_seasons` write; a
   season is administrable for `max(seasons.year) <= S <= max+1`, clubs from
   `afldb_season_list_clubs(S)`; the register advances only through the ISSUE-101 rollover.
7. **Round model:** the `matches` vocabulary — `round_type` enum, `round_number` for
   home-and-away (Opening Round = 1), `round_code` rendered server-side, finals codes
   `EF QF SF PF GF WF`; no hard-coded shape.
8. **Date/time/TBC:** nullable `match_date` and `match_time` (local venue time text, `HH:MM`);
   NULL = TBC; no sentinel, no timestamptz.
9. **Venue:** existing `venues` only, TBC = NULL, unmapped name kept in `venue_raw`; no inline
   creation.
10. **Create/edit/delete/cancel:** one mutation contract in `admin-fixtures.ts`; server-side
    invariants (§13); edits under the token identity with CAS; `cancelled` (reversible) and
    `void` (mistake) statuses, never DELETE; played fixtures locked except notes.
11. **Bulk entry:** round-at-a-time batch form with structured-paste pre-fill, server-side preview
    with a fingerprint-gated confirm, all-or-nothing.
12. **Finals:** created when participants are known; no placeholder clubs; venue/date/time TBC.
13. **Source settlement:** read-time deterministic resolution against `matches`; no settle,
    current-season or rekey code changes; disagreements are warnings; ambiguity is never merged.
14. **Replay/rebuild:** whole-row `data_overrides`, fail-closed `replay_admin_overrides('fixtures')`
    (venue degrades with a report), registry classification, `fixture_key` lineage rule for audit
    rows, promotion §8 loop extended.
15. **Derived safety:** by construction (no `matches` write) plus integration and static-contract
    proofs.
16. **Permissions:** `data.fixtures.read` (Admin+), `data.fixtures.edit` (Super Admin);
    Contributor nothing; no result entry.
17. **Routes:** `/admin/fixtures`, `/admin/fixtures/[season]`, `/admin/fixtures/[season]/new`,
    `/admin/fixtures/[season]/[fixtureKey]`; Data-group nav "Fixtures"; no revalidate route.
18. **Stages:** Stage 1 model/mutations/replay/promotion/tests; Stage 2 admin surface; no Stage 3.
19. **Tests:** `tests/admin-fixture-actions.test.ts`, `tests/integration/admin-fixtures.test.ts`
    (including the real Python replay and derived-safety proofs), plus `auth`,
    `data-overrides-source-contract`, `reference-data`, `db-promotion-check`, manual-authority;
    Playwright deferred to the DEV batch.
20. **Operator decisions:** D-1…D-7 **DECIDED 2026-09-11** (§35): all approved as recommended,
    D-6 with the condition that the read-time resolution is deterministic and fail-closed (ambiguity
    = unlinked; no name/date guessing), plus the constraint that `fixture_key` is never replaced by
    `match_key` across settlement.
21. **Blockers / stop conditions:** none fired against the approved design; S-1 and S-5 fire
    for the rejected `matches`-based options and are the reason for D-1. Stage 1 hard stops:
    replay not byte-exact, promotion classification refusal, any code path writing `matches`, any
    column or writer that stores or compares a `match_key` on a fixture.
22. **Ready to begin:** **yes — Stage 1 is authorised.** Opening prompt for the Stage 1 session:
    `Execute AFLDB-ISSUE-162 Stage 1 according to AFLDB-ISSUE-162.md` from
    `D:\dev\afldb-issue-162` on `opus/issue-162-fixture-admin`; first actions are the preflight and
    the migration-number re-check. No DEV, no PROD, no merge, no deploy.

---

## 37. Stage 1 implementation record (2026-09-11, Opus 5 high 1M, UNCOMMITTED)

Executed against this document as the implementation contract. Nothing was re-planned; D-1…D-7 and
the §6 `fixture_key` constraint were treated as binding throughout, and no stop condition fired.

### 37.1 Migration-number re-check

`src/db/migrations/` ends at `096_season_list_members.sql` on this branch, so **097 was free and is
allocated** as `097_fixtures.sql`. The all-refs cross-check (`git log --all --oneline --
src/db/migrations/097_*.sql`) is in §37.7 and is the operator's to run; nothing is committed, so a
renumber is trivial if it comes back occupied.

### 37.2 What was built

| File | Change |
|---|---|
| `src/db/migrations/097_fixtures.sql` | **new** — §26 in full: `fixtures` + 6 indexes + 6 CHECKs, `data_overrides.entity_type` += `'fixtures'`, `data_edits.table_name` += `'fixtures'`, `grant_app_read` + `grant_import_write`, table/column comments. No backfill, no destructive statement, no `privileges.sql` edit |
| `src/db/queries/admin-fixtures.ts` | **new** — the ONE fixture mutation contract (§13, §14, §15, §16), the read-time played resolution (§18), the season/summary/orphan/diagnostics readers (§27) and the import-role override reader |
| `src/db/queries/audit-log.ts` | `DataEditTableName` and `DATA_EDIT_TABLE_NAMES` += `'fixtures'` |
| `src/lib/acquisition/manual-authority.ts` | `OVERRIDE_ENTITY_TYPES` += `'fixtures'` (inventory only; the proof still consults nothing) |
| `tools/migration/common.py` | `FIXTURE_STATUSES`, `FIXTURE_ROUND_TYPES`, and the fail-closed `replay_admin_overrides('fixtures')` branch (§20) |
| `tools/migration/import_fitzroy_core.py` | call site after `replay_admin_overrides(pg, "matches")` |
| `tools/db/promotion-inventory.ts` | `fixture_key` `LineageIdentityRule` + its by-id/by-identity SQL, the `data_edits` target, remediation text, acceptance-checklist wording |
| `docs/production-promotion.md` | §8 replay loop += `'fixtures'`, with the ordering and venue-degrade notes |
| `tests/admin-fixture-actions.test.ts` | **new** — the pure half |
| `tests/integration/admin-fixtures.test.ts` | **new** — the PostgreSQL half, incl. the real Python replay |
| `tests/db-promotion-check.test.ts` | `fixtures` in `PINNED_FOOTBALL_TABLES`, the lineage target, the `fixture_key` rule, the no-`PROMOTION_CONTRACT`-entry classification, the checklist |
| `tests/current-season-import.test.ts` | `CHECK_AFTER_097`, the 097 widening, the settle-target absence, order-independence in both directions |
| `tests/data-overrides-source-contract.test.ts` | one-writer grep, the derived-safety contract in both directions, the replay contract, the importer call site, the frozen enumerations |

### 37.3 The invariants the schema now enforces rather than merely documents

- **No result fact can exist on a fixture.** There is no score, goals, behinds, result, margin,
  winner, attendance, period, lineup or statistic column, so "0–0 means not played" is
  unrepresentable rather than forbidden.
- **D-6 and the operator constraint are structural.** `fixtures` has no `match_id` and no
  `match_key` column and no FK to `matches`; the resolution is a `SELECT` in a LATERAL, and the
  module's code (comments stripped) contains neither string.
- **A time cannot be stored without a date** (`fixtures_time_needs_date_ck`), so no writer, replay
  or future importer can invent a midnight.
- **A terminal state cannot be unexplained** (`fixtures_status_reason_ck`).
- **A home-and-away fixture cannot disagree with itself about its round**
  (`fixtures_round_number_ck` includes `round_code = round_number::text`), which is what would make
  the played resolution silently miss.

### 37.4 Deviations from this runbook

Both are strengthenings; neither contradicts a decision or widens scope.

1. **`fixtures_time_needs_date_ck` is a CHECK.** §10 states "a time requires a date" as a *writer*
   rule. It is enforced in both the writer and the database so the replay and any future importer
   are bound by it too.
2. **Stage 1 ships `classifyFixtureDiagnostics()` / `readFixtureDiagnostics()`.** §27 places the
   diagnostics *panel* in Stage 2, but §33 Stage 1 item 3 lists "diagnostics readers". The
   classification is a pure function over rows, so it is unit-testable now and the Stage 2 panel
   becomes rendering. Nothing refuses: shape is reported, never enforced, and per-round byes are
   listed as **information** because a bye and an incomplete round are not distinguishable from the
   data.

**Also recorded, because §15/§16 name it in neither direction:** `cancelled → void` is permitted (a
cancelled fixture may still turn out to have been mis-entered); `void` is terminal in every
direction, accepting notes only. Restated as a binding semantic, with the Stage 2 obligation it
carries, in §37.8 item 8.

### 37.5 A tail risk worth stating

The replay resolves each club slug through `afldb_season_list_clubs(season)`, exactly as §20
requires, and refuses when it does not resolve. Once the register advances past a fixture's season
that function takes its historical arm, which requires a `club_seasons` row — so a fixture naming a
club that never played in that season (an expansion club whose fixture was voided, say) would fail
the replay closed years later. That is the specified behaviour and the correct default for a durable
human decision, but it is a real edge and belongs in the record rather than being discovered during
a promotion.

### 37.6 Not built (Stage 2)

`/admin/fixtures` routes and panels; `data.fixtures.read` / `data.fixtures.edit`; the Data-group nav
entry; the batch-entry UI with client-side paste pre-fill; the diagnostics panel; the
`src/db/queries/data-edits.ts` entity-link case; `tests/auth.test.ts` coverage; Playwright and the
responsive matrix (deferred to the combined Admin Centre DEV batch, §34).

Stage 2 also owes the **void control a destructive-confirmation step** — an explicit confirm plus the
mandatory reason, in the ISSUE-155 pattern — because `void` says the record should never have existed
and is terminal. It must not be rendered as an equivalent sibling of cancel. See §37.8 item 8.

### 37.7 Validation — NOT YET RUN

Nothing below has been executed. Every command is the operator's, in this order, from
`D:\dev\afldb-issue-162`:

1. `npm run preflight -- --mode implementation --issue 162`
2. `git log --all --oneline -- src/db/migrations/097_*.sql` (expect no output)
3. apply migration 097 to **`afldb_test` only**, then `npm run db:privileges` against it
4. `npx tsc --noEmit`
5. `npx vitest run tests/admin-fixture-actions.test.ts tests/data-overrides-source-contract.test.ts tests/db-promotion-check.test.ts tests/current-season-import.test.ts`
6. `npx vitest run tests/integration/admin-fixtures.test.ts`
7. `npx vitest run tests/admin-season-list-actions.test.ts tests/integration/admin-season-lists.test.ts tests/reference-data.test.ts tests/admin-match-mutations.test.ts`
8. `npx eslint` over the changed source and test files
9. `git diff --check` and `git status --short`

Stage 1 is complete as designed but **unproven** until those are green; a failure there is a Stage 1
defect, not a Stage 2 item.

### 37.8 Stage 1 validation repair (2026-09-11, second pass — STILL UNCOMMITTED, STILL UNVALIDATED)

The operator ran the §37.7 typecheck and unit suites. They found two REAL product defects, one
missing audit label and a set of brittle source-contract extractions. All are repaired below; the
§37.7 gates remain the gates, and none of them has been re-run by this pass.

**1. `DATA_EDIT_TABLE_LABELS` had no `fixtures` entry (typecheck failure).** `DataEditTableName`
gained `'fixtures'` in §37.2, and `src/lib/audit-view.ts` maps that union exhaustively.
`fixtures: 'Fixtures'` added — the label only, matching the existing Admin Centre vocabulary
(`Coaches`, `Draft picks`). The ISSUE-157 viewer therefore names the table correctly in its filter
and its applied-filter line. Stage 2's entity-link case in `src/db/queries/data-edits.ts` is still
**not** built (§37.6): this is the type's label, not the navigation.

**2. `normaliseSchedule()` accepted impossible calendar dates (REAL DEFECT, D-5).** The rule was the
`YYYY-MM-DD` shape plus `Date.parse()`. `Date.parse()` is not a calendar check: it NORMALISES an
impossible day rather than rejecting it, so `2027-02-30` parsed — as 2 March — and was accepted. A
fixture could have been stored on a day that does not exist, or the operator's typo silently accepted
as a different day. Replaced with `isRealCalendarDate()`: build the day in UTC and require all three
components to survive the round trip, which is exactly the arithmetic `parseAuditDate()` already uses
(`src/lib/audit-view.ts`). `2027-02-30`, `2027-02-29`, `2027-04-31`, month `00`/`13` and day
`00`/`32` now refuse; `2028-02-29` and `2000-02-29` are accepted. No time-zone conversion is
introduced — `Date.UTC` is calendar arithmetic only, and the value stored remains the operator's
string (§10: a fixture's date and local start time are AFL local facts, never an instant). NULL/TBC
semantics and the `HH:MM` rule are untouched. `fixtures.match_date` is a `date` column, so PostgreSQL
would have refused `2027-02-30` at the write; the defect was that the writer told the operator it had
accepted it, and the same rule now holds in both places.

**3. `resolvePlayed()` could link a fixture on a contested candidate (REAL DEFECT, D-6).** The first
arm was `exactCount === 1`, tested before the swapped count, so `exact 1 / swapped 1` resolved to
`played` on the exact row. That is the tie-break D-6 forbids: two different `matches` rows could each
be the fixture, and choosing one would lock the fixture against every edit, claim a result it may not
have, and report a schedule disagreement against a row picked by preference rather than identity. The
truth table is now exactly, and only:

| exact | swapped | state | matchId |
|---|---|---|---|
| 1 | 0 | `played` | `exactMatchId` |
| 0 | 1 | `played_home_away_differs` | `swappedMatchId` |
| 0 | 0 | `unplayed` | null |
| anything else | | `ambiguous` | **null** |

`void` still short-circuits to `unplayed`. Ambiguity remains an `invalid` diagnostic
(`ambiguous_played_resolution`) that reports and never merges, and it deliberately does NOT lock
edits — an unlinked fixture is still an ordinary fixture.

**4. `PLAYED_RESULT_FACTS` chose a result row independently of the resolution (same defect's other
half).** It read `ORDER BY m.id LIMIT 1` over every candidate, so `scheduleDiffersFromResult` could
compare the fixture against a row the resolution had not linked. Its candidate set is the same set
`PLAYED_RESOLUTION_LATERAL` counts, so the guard is one scalar predicate —
`pl."exactCount" + pl."swappedCount" = 1` — rather than a second copy of the truth table that could
drift from it: exactly one candidate means the only row it can yield IS the resolved one, and every
ambiguous shape yields no row at all. `ORDER BY`/`LIMIT` removed with it, and
`withPlayedResolution()` additionally requires `matchId !== null` before comparing. Two guards, in
the two languages, deliberately; `PLAYED_RESOLUTION_LATERAL` itself is unchanged. **No `match_id` or
`match_key` is persisted or compared anywhere** — the association is still read-time only.

**5. ISSUE-159's `match_coaches` source contracts were extracted brittly (test repair, no semantic
change).** Both tests sliced `common.py` from `elif table == "match_coaches":` to the END OF FILE,
which was correct only while that branch was last. ISSUE-161 and ISSUE-162 appended branches after
it, so the assertions "no `COALESCE(`" and "no `split_part(entity_key ...)`" began reading code that
is not their subject — the fixtures branch legitimately `COALESCE`s and legitimately decodes its own
`manual_admin_edit:<token>` key with `split_part` on `':'`. A `replayBranch(source, table)` helper now
isolates ONE branch, from its own `elif` to the next sibling at the same indentation or to the end of
the function. The ISSUE-159 guarantees are unchanged and are still asserted in full against the
isolated executable branch: absent-vs-explicit-null refusal, last-delimiter composite-key decode, no
`split_part(entity_key ...)`, resolution by path rather than by id or name, and fail-closed-before-
write. `coaches`, `season_list_members` and `fixtures` now use the same helper, so the next branch
added cannot silently widen any of them again.

**6. The ISSUE-162 source contracts read raw text, so the module's own commentary failed them (test
repair, no semantic change).** `src/db/queries/admin-fixtures.ts` documents that it creates no venue
by writing out the `INSERT INTO venues` it will never contain, and the replay branch explains D-6 by
naming `match_key` and `match_id`. Asserting over raw source made each explanation a violation of the
rule it explains. Both are now asserted against EXECUTABLE code — comments stripped — and the
contracts were strengthened rather than weakened while the extraction was repaired: the mutation
module still proves no write to `matches`, `venues`, `venue_aliases`, `seasons`, `clubs`,
`club_seasons` or any derived table, and now also proves that no executable line names `match_key` or
`match_id` at all; the fixtures replay branch still proves no `DELETE FROM fixtures`, fail-closed
refusal before any write, `NOT EXISTS` rather than `ON CONFLICT`, `fixture_key` never in a `SET`
list, and no result fact.

**7. The unresolved-venue replay contract is PROVED, not assumed (§11).** Checked end to end.
`resolveVenue()` copies `venues.canonical_name` into `venue_raw` whenever it resolves a `venue_id`
(the `createMatch()` convention), and `fixtureOverridePayload()` writes `venue_slug` and `venue_raw`
together, so a durable payload can never carry a slug without the human-readable name beside it.
When a rebuilt or promoted database does not have that slug, the replay's
`CASE WHEN f.venue_id IS NOT NULL THEN f.venue_canonical_name ELSE f.v->>'venue_raw' END` — present
identically in both the INSERT and the idempotent UPDATE — keeps the stored name, leaves `venue_id`
NULL, and the branch prints a counted WARNING. The venue is NOT refused (a rename must not stop a
promotion), NOT silently downgraded to TBC, and NOT fuzzy-matched to a replacement. No payload or
replay change was needed; three regressions now pin it: the payload carries both facts for a mapped
venue, a typed-but-unmapped venue carries a name and no slug, and the replay's two venue expressions
are identical, warn, and appear in no refusal arm.

**Known limit, stated rather than fixed:** a fixture whose canonical row was re-created by a replay
in a database that could not resolve its slug holds `venue_id NULL` + the name, so a LATER admin edit
rewrites the durable payload from that row and the `venue_slug` key is not carried forward. The
human-readable venue fact always survives; the slug binding does not survive that particular
sequence. It is a degradation of enrichment, not a loss of a fact, and re-selecting the venue in
Stage 2's venue panel restores it.

**8. `cancelled` → `void` — the binding semantics (§16, restated because it is a classification
change, not a lifecycle change).**

- `cancelled` — a GENUINE scheduled event that was cancelled in the real world. Reversible via
  `reinstateFixture()`, which re-runs the §13 collision checks.
- `void` — the AFLDB RECORD was erroneous and should never have represented a valid fixture. It is
  not a statement about the real world at all.
- `cancelled → void` is permitted, and ONLY as an explicit, audited correction of classification: a
  fixture cancelled in good faith may later turn out to have been mis-entered. It is audited under
  `fixture_void` with a required `status_reason`, like any other void.
- `fixture_key` is unchanged by either transition, in both directions: identity survives the
  lifecycle (§6), which is what keeps the `data_edits` rows resolvable at the next promotion remap.
- `void` is TERMINAL in every direction. `reinstateFixture()` refuses anything that is not
  `cancelled`, and the only edit a void row accepts is `fixture_notes`, so the record of WHY can be
  completed.
- Neither state deletes a row, and neither is a delete in disguise (D-2).
- **Stage 2 obligation:** the void control is destructive-confirmation UI — an explicit confirm step
  plus the mandatory reason, in the ISSUE-155 pattern — and must never sit next to cancel as an
  equivalent button. Recorded in §37.6 as a Stage 2 requirement, not built here.

**9. The integration suite did not run, and that is an ENVIRONMENT gap, not a failure.**
`tests/integration/admin-fixtures.test.ts` aborted in `tests/integration/guard.ts` with
"`AFLDB_TEST_DATABASE_URL` must be set to run integration tests." Zero tests executed, so nothing
about the fixture integration contract is yet known either way. This worktree has no `.env` — only
`.env.example` — while `tests/setup.ts` loads the gitignored `.env` from the worktree root; the
ISSUE-161 worktree had one and this one was never given it. See §37.7 step 6 for the rerun; the
condition is stated in §37.9.

**Files changed by this pass:** `src/lib/audit-view.ts`, `src/db/queries/admin-fixtures.ts`,
`tests/admin-fixture-actions.test.ts`, `tests/data-overrides-source-contract.test.ts`, and this
record. No migration change, no `common.py` change, no schema change, nothing committed.

### 37.9 Integration-test environment requirement (operator)

`tests/setup.ts` reads a **gitignored `.env` at the worktree root** (`D:\dev\afldb-issue-162\.env`)
and only then falls back to variables already exported in the shell. This worktree contains
`.env.example` and no `.env`, which is the whole reason step 6 ran zero tests.

Before rerunning `npx vitest run tests/integration/admin-fixtures.test.ts`, exactly one condition
must hold — copy the ISSUE-161 worktree's `.env`, or write one from `.env.example`, carrying at
least:

- `AFLDB_TEST_DATABASE_URL` — the owner credential for **`afldb_test`** through the local **55432**
  tunnel. `tests/setup.ts` refuses any database whose name does not end in `_test` and redirects
  `DATABASE_URL` to it; the suite additionally redirects `AFLDB_IMPORT_DATABASE_URL` to the same
  value at module load, because the repository `.env` points that at `afldb_dev` and every fixture
  mutation opens the import connection.
- Optional: `AFLDB_TEST_IMPORT_DATABASE_URL` (same `_test` database, `afldb_import` login) for the
  role-parity suites. Absent, those skip explicitly; they never fall back to the owner credential.

Also required before the suite can pass, and separate from the variable: **migration 097 applied to
`afldb_test` only**, then `npm run db:privileges` against it (§37.7 step 3) — `fixtures` needs its
`grant_app_read` / `grant_import_write`, and `data_overrides` / `data_edits` need the widened CHECKs.
The replay-backed cases also need `.venv` with `psycopg`; without it they skip via
`it.runIf(canReplay)` rather than fail, which would leave the replay contract unproven.

**Never** `afldb_dev`, **never** PROD, and no credential is printed here or anywhere in this record.

### 37.10 Still-required gates NOT met

`npm run preflight -- --mode implementation --issue 162` and
`git log --all --oneline -- src/db/migrations/097_*.sql` (the migration-097 collision check across
all refs) have **not** been supplied. Both remain binding §37.7 gates and neither is treated as
passed. Migration 097 is allocated on the strength of §37.1's local re-check only.

### 37.11 Second validation run, and the integration-test ordering repair (2026-09-11, third pass)

The operator supplied the `.env` of §37.9 and re-ran. **Green:** `npx tsc --noEmit`;
`tests/admin-fixture-actions.test.ts` 69/69; `data-overrides-source-contract` +
`db-promotion-check` + `current-season-import` 383 passed / 4 skipped; the ISSUE-161 / reference /
match regression set 124/124; targeted ESLint; `git diff --check` (only the expected LF→CRLF
warning). Every §37.8 repair therefore holds. The 31 passing integration tests are also the first
evidence that §37.7 step 3 was done — migration 097 is applied to `afldb_test` and its privileges
reconciled, or no fixture could be written or read at all.

**Not green: `tests/integration/admin-fixtures.test.ts`, 31 passed / 5 failed** — every failure in
the read-time played-resolution group, and every one of them a TEST defect, not a product defect.

**Root cause: the five tests modelled the wrong chronology.** Each called `seedMarkerMatch()` — which
writes a played `matches` row — BEFORE `mustCreate()`. §13's I-3 precondition then refused the
create with `already_played`, correctly: AFLDB already held the game as a result, so there was
nothing left to schedule, and the test died before it reached the resolution it was written to
prove. The failure message named the refusal exactly. It was **not** leakage and not isolation: each
test cleans up after itself, `beforeAll` clears earlier debris and asserts the marker round is empty,
and the sibling test that DOES want the result first (`refuses to schedule a game AFLDB already holds
as a result`) passed throughout — which is the same guard, observed from the other side.

**The repair, in the tests only.** The five now follow the chronology §18 is about: the fixture
exists while the game is scheduled, the played row arrives later, and reads resolve against it.
`seedMarkerMatch()` is renamed **`insertPlayedMatch()`** — a seed sounds like setup, and calling it
as setup is the mistake — and its doc states the ordering rule, spells out the two-line sequence, and
says why the two calls are deliberately NOT folded into one helper: their order is the thing under
test. Strengthenings that the corrected order made possible, none of which relaxes anything:

- the exact case now asserts the fixture reads `unplayed` BEFORE the result exists and `played`
  after, with no write in between — which is what "derived, never stored" means;
- the reschedule case now really reschedules: the fixture is moved twice (date, time, then venue)
  while unplayed, and only then is a result played on a different day again, so all three facts
  disagree at the moment of resolution;
- the swapped case asserts the §27 diagnostic as well as the state, so "never silently" is proved
  rather than asserted, and that nothing was written onto the fixture;
- the ambiguous case schedules the fixture for a day NEITHER result was played on, so a resolution
  borrowing an arbitrary candidate row would report a schedule disagreement — it must report none.
  It pins `scheduleDiffersFromResult === false` on both read paths plus the `invalid` diagnostic,
  which is the §37.8 item 4 guard proved end to end against real rows;
- the played-lock case edits the fixture successfully while unplayed, then has the game played, then
  proves every schedule edit refuses `played_locked` and notes still succeed.

`createFixture()` is unchanged; `resolvePlayed()`, `PLAYED_RESOLUTION_LATERAL` and
`PLAYED_RESULT_FACTS` are unchanged; no `NODE_ENV` special case, no `match_id`/`match_key`, no
date or venue matching, no relaxed ambiguity. **No production file was touched by this pass.**

Next: `npx vitest run tests/integration/admin-fixtures.test.ts`, expecting **36/36**, then the
compact re-gate of §37.7 (typecheck, the unit and contract suites, the ISSUE-161 regressions, ESLint,
`git diff --check`) plus the two §37.10 gates that have still never run.

---

## 38. Stage 2 implementation record (2026-09-11, Sonnet 5 high, UNCOMMITTED)

Stage 1 is committed on this branch (`cb98c67`, per the operator's Stage 2 briefing) and treated as
pinned. Executed against §28 (routes), §23 (capabilities), §14 (batch UX), §16/§37.8 item 8
(lifecycle) and §27 (diagnostics) as the implementation contract. No Stage 1 file
(`src/db/queries/admin-fixtures.ts`, `097_fixtures.sql`, `tools/migration/common.py`,
`promotion-inventory.ts`) was touched; no true Stage 1 defect was found.

### 38.1 What was built

| File | Change |
|---|---|
| `src/lib/auth/capabilities.ts` | **changed** — `data.fixtures.read` (Admin+) / `data.fixtures.edit` (Super Admin) added to the `Capability` union and `CAPABILITY_ROLES` |
| `src/app/admin/nav-model.ts` | **changed** — "Fixtures" added to the Data group, after "Season lists" |
| `src/app/admin/fixtures/validation.ts` | **new** — pure form-parsing helpers, mirroring `season-lists/validation.ts` |
| `src/app/admin/fixtures/submit-helper.ts` | **new** — `useFixtureActionSubmit`, wrapping the shared `useAdminActionSubmit` (ISSUE-160 D-9); `RoundBatchActionState` mirrors `CopyForwardActionState` |
| `src/app/admin/fixtures/labels.ts` | **new** — round/played-state/status display strings, presentation-only |
| `src/app/admin/fixtures/actions.ts` | **new** — 10 Server Actions: create, submit-batch (preview+confirm share one action, the `copySeasonListsForwardAction` shape), reschedule, change-venue, change-round, change-clubs, update-notes, cancel, reinstate, void. Every action asserts `data.fixtures.edit` as the first awaited call; every refusal returns `revalidatePaths: []` |
| `src/app/admin/fixtures/page.tsx` | **new** — `/admin/fixtures`, `data.fixtures.read` |
| `src/app/admin/fixtures/[season]/page.tsx` | **new** — `/admin/fixtures/[season]`, `data.fixtures.read` |
| `src/app/admin/fixtures/[season]/new/page.tsx` | **new** — `/admin/fixtures/[season]/new`, `data.fixtures.edit` |
| `src/app/admin/fixtures/[season]/[fixtureKey]/page.tsx` | **new** — `/admin/fixtures/[season]/[fixtureKey]`, `data.fixtures.read` (edit reveals panels) |
| `src/app/admin/fixtures/SingleFixtureForm.tsx` | **new** — round-at-a-time single-row create |
| `src/app/admin/fixtures/RoundBatchForm.tsx` | **new** — the batch entry flow: header, up to `MAX_BATCH_ROWS` rows, paste pre-fill, preview, fingerprint-gated confirm |
| `src/app/admin/fixtures/ReschedulePanel.tsx`, `VenuePanel.tsx`, `RoundPanel.tsx`, `ClubsPanel.tsx`, `NotesPanel.tsx`, `LifecyclePanel.tsx` | **new** — one panel per §15/§16 field group, so the UI boundary matches the audit boundary exactly |
| `tests/auth.test.ts` | **changed** — `EQUIVALENT_ROLE_GUARD` gains both capabilities (required for the file to typecheck, since it is a `Record<Capability, …>`); the three hard-coded nav-order assertions extended with `/admin/fixtures` |
| `CHANGELOG.md`, `issues.md`, `IssuesIndex.md`, `AFLDB-ISSUE-162.md`, `AFLDB-ISSUE-156.md` | tracking |

No new test *file* was added for Stage 2. This mirrors the ISSUE-161 Stage 2 precedent exactly:
`season-lists/validation.ts` has never had a dedicated test file, `tests/admin-season-list-actions.test.ts`
is Stage 1's pure-backend suite, and Stage 2's own gate there was `tests/auth.test.ts` plus typecheck/
eslint/build — never a new UI test file. The fixture form-parsing helpers are the same shape
(trivial pass-throughs; business validation stays server-side in Stage 1). Live Playwright and the
responsive matrix are deferred to §34's combined Admin Centre DEV batch, as planned.

### 38.2 Deviations / clarifications from the runbook

1. **§24's "entity-link helper in `src/db/queries/data-edits.ts` gains a `fixtures` case" does not
   describe a real extension point.** `data-edits.ts` is the generic `/admin/data-editor` read/write
   module (players and matches only, pre-dating the entity-link pattern); the audit viewer's entity
   page (`/admin/audit/entity/[table]/[rowId]`) is already fully generic over `DataEditTableName`
   (which gained `'fixtures'` in Stage 1, `audit-view.ts`'s `fixtures: 'Fixtures'` label included) and
   needs no per-table code. Every existing detail page (`coaches/[id]`, `draft/[id]`) links to it by
   building the href inline, not through a shared helper function. The fixture detail page does
   exactly the same: `Link href={/admin/audit/entity/fixtures/${fixture.id}}`. §24 is satisfied; no
   `data-edits.ts` change was needed or made.
2. **Panel-per-field-group, not fewer, larger panels.** §15's table names six distinct field groups
   (`fixture_schedule`, `fixture_venue`, `fixture_round`, `fixture_clubs`, plus lifecycle and notes).
   Six panels were built instead of combining them, so each panel's one submit button maps to
   exactly one backend mutation and one audit `field_group` — no panel can accidentally bundle two
   unrelated changes into one CAS-guarded request.
3. **Round-batch row transport is one hidden JSON field (`rowsJson`), not N sets of named fields.**
   The row count is dynamic (1..20, add/remove client-side); a fixed-name-per-row scheme would need
   either 20 always-present field sets or index-juggling. The server parses the JSON narrowly (shape
   only: every id must already be a JS `number`, never a coerced string) before it ever reaches
   `createFixtures()` — a row missing a club selection fails the parse rather than being coerced to
   club id 0, and the client additionally disables Preview until every row has both clubs chosen.
4. **The paste-to-rows parser resolves names to ids by exact case-insensitive match only, client-side,
   as §14 requires** ("the server never receives free text as a fixture; it receives ids"). An
   unresolved club or venue name is left blank in the row rather than guessed; the operator finishes
   it from the `<select>`s.
5. **The "Opening Round is round 1" note (§9) is surfaced once, on the single-fixture form's round-
   number label, for `season >= 2024`.** It is not repeated on every round heading in the season list
   or the batch form, to avoid cluttering a table that already reads unambiguously ("Round 1").
6. **The played-match link goes to the public `/matches/[id]` page** (§28's own wording), not an
   admin match-edit route — there is no established Admin route for viewing a single match by id
   outside the data editor's match-sheet mode, and the public page is the "existing… view" §28 names.
7. **The season page's diagnostics badge and per-season landing-page counts both call
   `classifyFixtureDiagnostics()` directly** (via the same three reads `readFixtureDiagnostics()`
   composes) rather than the composed helper, so the landing page's per-season `played` count can be
   derived from the same already-fetched fixture rows without a second season read. No diagnostic
   rule was duplicated or changed.

### 38.3 Played-fixture UX

Once `isPlayedState(fixture.playedState)` is true, the detail page renders only the identity/
schedule table, Notes and a one-line explanation — Reschedule, Venue, Round, Clubs and Lifecycle
are not rendered at all. This is UI convenience only, never the boundary: every action still
asserts `data.fixtures.edit` first, and `editFixture()`'s `isFixtureEditAllowed()` gate still
refuses `played_locked` on its own account for any field group but `fixture_notes`, so a forged
request against a hidden panel's action is refused by the backend exactly as ISSUE-155 §27.27 K
proved for Brownlow. `played_home_away_differs` and `scheduleDiffersFromResult` render as explicit
warnings beside the played badge; `ambiguous` renders as an `alert`-role notice stating AFLDB
deliberately linked nothing, with no match link and no lock (an unlinked fixture stays an ordinary,
editable fixture, per §18/D-6).

### 38.4 Not built / deferred

Everything §37.6 named stays deferred to the combined Admin Centre DEV batch (§34): live Playwright,
the three-role rendered permission matrix, and responsive acceptance at 320/768/1000/1280/1920 (the
CSS is written to the same stacked-card conventions as `season-lists`/`draft`, but has not been
opened in a browser). No DEV/PROD mutation was made or requested.

### 38.5 Validation — NOT YET RUN

Nothing below has executed. In order, from `D:\dev\afldb-issue-162`:

1. `npm run preflight -- --mode implementation --issue 162`
2. `npx tsc --noEmit`
3. `npx vitest run tests/auth.test.ts`
4. `npx vitest run tests/admin-fixture-actions.test.ts tests/data-overrides-source-contract.test.ts tests/db-promotion-check.test.ts tests/current-season-import.test.ts` (Stage 1 regression, unchanged)
5. `npx vitest run tests/integration/admin-fixtures.test.ts` (Stage 1 regression, unchanged — expect 36/36 per §37.11)
6. `npx eslint` over every file listed in §38.1
7. `git diff --check` and `git status --short`
8. `npm run build` (local, no deploy) if the operator wants build-level confidence beyond `tsc`

A failure in 3 most likely means a nav-order or capability-table assertion this record missed;
a failure in 2 most likely means a type mismatch between an action's `FormData` parsing and a
Stage 1 mutation's input type. Neither should require touching Stage 1.

ISSUE-162 remains **not resolved**: Stage 2 is code-complete but unvalidated by a run, uncommitted,
not merged, not deployed to DEV, PROD untouched.

**Superseded by §39:** Stage 2 was subsequently validated and committed (`6a9fbc4`), and the
whole-issue audit below re-gated it. §38.5's list was run green by the operator; the re-gate
commands are §39.7.

---

## 39. Final local audit (2026-09-12, Opus 5 high 1M) — UNCOMMITTED

A whole-issue audit of Stage 1 + Stage 2 together at `6a9fbc4`, against §§3–28, D-1…D-7 and the §6
identity constraint. Read natively; no shell, Git, database or deployment command was executed
(CLAUDE.md §9/§12), and no DEV or PROD state was touched.

### 39.1 Verdict

**No stop condition fired.** None of the twelve architectural stops is in play: the schema needs no
migration 098, `fixture_key` needs no redesign, no persisted match linkage is required, the played
resolution needs no fuzzy matching, the batch fingerprint contract is sound as designed, the
capability contract agrees with the ISSUE-156 umbrella, nothing requires public exposure, the replay
contract is unchanged, no path writes `matches`, and no `seasons` row is needed.

Eight ordinary defects were found and fixed. Two are behavioural (a void fixture was offered four
edit controls the backend can only refuse; a cleared date left an invisible start time that refused
the submission). The rest are a duplicate React key, an undefined CSS class, a `<select>` that could
display a club the fixture does not name, a coerced id in the batch parser, missing accessible names
on the batch row controls, and a 320px overflow guard.

### 39.2 Confirmations, by audit area

| Area | Result |
|---|---|
| **A. Authorization** | Clean. `data.fixtures.read` = ADMIN_AND_UP, `data.fixtures.edit` = SUPER_ADMIN_ONLY (`capabilities.ts:117-118`). `tests/auth.test.ts`'s ISSUE-158 contract is generic over `src/app/admin/**`: it walks every `page.tsx`, `route.ts` and `'use server'` module, requires `requireCapability()` to be the FIRST awaited call of every exported async function, and asserts every declared capability is enforced at a real boundary and every enforced one is declared. All four fixture pages (and both `generateMetadata`s) and all ten actions satisfy it by construction; no role helper is used anywhere in the fixture tree, so the capability/legacy-guard mismatch class cannot arise. Nav visibility is furniture over the same capability the route enforces, asserted by the same suite |
| **B. Server Action contract** | Clean. Ten actions, each: capability first, shape-only parsing, ONE `admin-fixtures.ts` call, structured `reason` preserved (`shouldAuditRefusal()` switches on the enum, never on the sentence), `revalidatePaths: []` on every success, none on a refusal, no public path anywhere. No action writes SQL; none catches a DB error into a success — `audit()` is the only `try/catch` and it wraps the audit call alone, after the mutation has already returned `ok` |
| **C. Batch preview staleness** | Sound, and now proved rather than assumed. Two independent gates: the client retires Confirm whenever its snapshot (round type, round number, every wire row in order) differs from the previewed one, and the server recomputes `fixtureBatchFingerprint()` over `{season, roundType, roundNumber, rows[]}` and refuses `stale_preview` on any mismatch — including a confirm carrying no fingerprint at all. The server gate is the real one: the client snapshot omits `season` (a route prop), so the fingerprint is the only thing standing between a re-targeted season and a write. §39.4 item 9 extends the unit test to pin season, round type, both club ids, date, venue id, an unmapped venue name, notes and row count. Preview writes nothing (§37.11 and `wrote(seen)` is empty); confirm is one transaction, all-or-nothing; every row's outcome is returned, not only the first failure |
| **D. Single create** | Clean. Clubs come only from `eligibleFixtureClubs()`; the `"other"` venue sentinel is swallowed by `parsePositiveInt()` and can never be read as an id; no placeholder club exists anywhere; finals carry no round number and home-and-away carries one (`renderRound()` + `fixtures_round_number_ck`); a time with no date is refused in the writer AND by `fixtures_time_needs_date_ck`; unmapped venues are supported with no `INSERT INTO venues`; `already_played` is refused before the first write; there is no score field to enter |
| **E. Detail / CAS** | Clean after the void fix. `readFixture()` is by `fixture_key` and the page 404s on `fixture.season !== season`, so a right key under a wrong season is not reachable. Every panel carries `expectedUpdatedAt`; `editFixture()` locks the row `FOR UPDATE`, takes the season advisory lock, then CASes on `updated_at` and refuses `stale` — before the lifecycle gate, the precheck and any write. `fixture_key` is never in a `SET` list |
| **F. Played resolution** | Clean. `resolvePlayed()` is the single decision for reads and for the write-time lock; `ambiguous` links nothing, is an `invalid` diagnostic, and deliberately does NOT lock edits; `played_home_away_differs` links but renders an explicit warning on both the list and the detail page; no date or venue is compared to decide the state; `PLAYED_RESULT_FACTS` yields a row only when exactly one candidate exists, so a schedule disagreement can never be reported against a row the resolution did not link. No `match_id`/`match_key` column, and none is compared. A played fixture renders notes only; the backend refuses `played_locked` independently of what is rendered |
| **G. Lifecycle** | Clean after the void fix. scheduled→cancelled (reason + confirm), cancelled→scheduled (reinstate re-runs the §13 collision checks and the season window), scheduled→void and cancelled→void (reason + separate destructive block, reclassification wording when already cancelled), void terminal in every direction. No hard DELETE exists. Void is never a sibling button of cancel |
| **H. Venue semantics** | Clean, and Stage 2 improves rather than hides the §37.8 limit. Mapped / unmapped-by-name / TBC are three distinct renderings on both the season list and the detail page, plus an `unmapped_venue` warning in the diagnostics. Editing an unrelated field does NOT destroy `venue_raw`: `editFixture()` carries every unchanged field forward from the locked row into the rewritten payload. The documented limit is unchanged and remains non-blocking — a replay that could not resolve a slug leaves `venue_id NULL` with the name intact, and a later edit rewrites the payload from that row without a `venue_slug`; the human-readable fact always survives and re-selecting the venue restores the binding |
| **I. Diagnostics** | Clean after the key fix. Read-only, no auto-fix, no one-click retrospective creation; byes and missing clubs are `info`/`warning` and refuse nothing; ambiguity, swapped home/away, schedule disagreement, unmapped venue and played-without-fixture all surface |
| **J. Audit links** | Correct as built. `/admin/audit/entity/fixtures/${fixture.id}` — numeric `fixtures.id`, which is what `data_edits.row_id` holds and what the generic page casts `::bigint`; `isDataEditTableName('fixtures')` and `DATA_EDIT_TABLE_LABELS.fixtures` both exist from Stage 1. Identical in shape to the `coaches/[id]` precedent, and `operations.audit.read` is ADMIN_AND_UP, the same audience as `data.fixtures.read`, so the link never dead-ends for a viewer who can see it. The inline href is the established convention, not an omission (§38.2 item 1) |
| **K. Route / parameter safety** | Clean. `Number(param)` + `Number.isInteger` + `notFound()` on all three season routes; the season page and the new page additionally 404 outside the administrable window; the fixture key is used only as a bound parameter. No raw interpolation of user input anywhere — `sql.unsafe` is used twice, with a constant SQL string and bound `$1`/`$2`. No redirect takes a parameter |
| **L. Responsive (source only)** | Every table is inside `.table-wrap`, which scrolls sideways on its own so the page body never does. Two-column inline grids now carry `minWidth: 0`. **Not** implemented: §28's "the batch form becomes one card per row under 768px" — the batch is a scrolling table at every width. Recorded as a known deviation for the DEV responsive pass, not silently fixed |
| **M. Accessibility (source only)** | Labels are real `<label>`s wrapping their control; every actionable control is a `<button>` or a `<Link>`, never a clickable div; errors are `role="alert"`, successes `role="status"`; both destructive flows are two-step with a mandatory reason. Batch row controls now have accessible names, and the disabled time inputs say why. Severity badges carry their state in the text, so colour is reinforcement, not the signal |
| **N. Tracking** | Corrected (§39.5). No document claimed DEV acceptance, Playwright, rendered responsive acceptance, PROD promotion or resolution; the inaccuracies were all stale understatements |
| **O. Replay / promotion** | Nothing new is required. Stage 2 added no persisted state of any kind — every fixture fact it writes goes through the Stage 1 mutation contract, so the whole-row override and the `fixture_key` lineage rule still cover every mutation. No `PROMOTION_CONTRACT` entry, no new registry table, no new `data_edits` target |
| **P. Cross-issue regression** | The only shared files touched by this audit are `src/styles/globals.css` (one ADDITIVE rule, `.badge-danger`, used by no other issue) and `tests/admin-fixture-actions.test.ts` (assertions added to one existing `it`). ISSUE-160 draft, ISSUE-161 season lists, the capability model, nav order, the audit viewer, current-season import, promotion inventory and the data-override source contracts are untouched |

### 39.3 Defects found and fixed

Ordered by severity. All eight are Stage 2; **no Stage 1 file was changed by this audit** —
`097_fixtures.sql`, `src/db/queries/admin-fixtures.ts`, `tools/migration/common.py`,
`import_fitzroy_core.py` and `promotion-inventory.ts` are byte-unchanged.

1. **MEDIUM — a voided fixture was offered four edits the backend can only refuse.**
   `[season]/[fixtureKey]/page.tsx` gated Reschedule, Venue, Round and Clubs on `canEdit && !played`,
   so a `void` row rendered all four. `isFixtureEditAllowed()` refuses every field group but
   `fixture_notes` for a void row (§16, §37.8 item 8), and `LifecyclePanel` already handled `void`
   by returning its terminal message — the detail page was the one place the rule was missing.
   Four controls that can only ever fail is a UI that disagrees with its own contract, and it invites
   an operator to conclude the record is maintainable when it is deliberately not. Fixed with a
   `schedulable` gate (`!played && status !== 'void'`); an editor already gets the explanation from
   `LifecyclePanel`'s terminal branch, and a read-only Admin — who never sees that panel — now gets
   the same sentence. **Hiding is not the boundary:** the backend gate is unchanged and still
   refuses a forged request against any hidden panel, exactly as ISSUE-155 §27.27 K proved.
2. **MEDIUM — clearing a date left an invisible start time that refused the submission.**
   `ReschedulePanel` disables the time input while the date is blank but kept the time in state and
   still submitted it, so returning a date to TBC produced `invalid_schedule` ("a start time needs a
   date") about a value the operator could no longer see or edit. `RoundBatchForm` had the same
   shape through `toWireRow()`, where it was worse: one such row refuses the WHOLE round. Fixed in
   both, in both places — the state clears when the date is cleared, and `toWireRow()` drops the
   time when the row has no date, so preview and confirm always serialise identically and the
   fingerprint cannot be affected.
3. **LOW-MEDIUM — a `<select>` could display a club the fixture does not name.** `ClubsPanel`'s
   options are the season's eligible clubs, which is not guaranteed to contain the fixture's current
   pair (`clubs.json` can change between entry and edit). A `<select>` whose `value` matches no
   option renders as its FIRST option, so the panel would have shown one club and saved that club on
   the next submit — a silent, wrong write. The current pair is now always present, labelled
   "(no longer eligible)". The server's `club_ineligible` precheck is unchanged, so this reveals the
   state rather than widening what may be written.
4. **LOW — duplicate React keys on the diagnostics list.** `key={d.code}` on `[season]/page.tsx`,
   while §27 emits `round_byes` once per round. Keyed on the position as well.
5. **LOW — `badge-danger` was an undefined class.** Used in three fixture files for the `invalid`
   severity, the ambiguous played state and a refused batch row; defined nowhere in `globals.css`,
   so all three rendered identically to a benign badge. Added beside `.badge-warn`, using the
   existing `--loss` token (defined in the light, `prefers-color-scheme` and `[data-theme]` blocks).
   Additive; no existing rule changed.
6. **LOW — the batch parser coerced a venue id where it held a club id strictly.**
   `Number(row.venueId)` against §38.2 item 3's own stated contract, so `true` would have arrived as
   venue 1, and a malformed id was quietly nulled into "TBC" — a guess about a submission that is
   itself the thing being validated. Now the club rule: a number or absent, otherwise the parse
   refuses. (Unreachable from the real client, and the backend's venue lookup refused every unreal
   id anyway; this closes the gap between the parser and its documented contract.)
7. **LOW — batch row controls had no accessible names.** Column headers do not name a control inside
   a cell. `aria-label`s added, including the reason a disabled time input is disabled.
8. **LOW — 320px overflow risk.** `1fr 1fr` / `1fr auto 1fr` inline grids whose children are
   `<select>`s: a grid `1fr` track's min size is `auto`, and a `<select>`'s min-content width is
   its widest option, so long club names can push a two-column row past a narrow viewport.
   `minWidth: 0` added to those grid children — the remedy `globals.css` already documents for the
   same class of overflow. Source-level only; the rendered check remains the DEV responsive pass.

9. **Test hardening (C).** `fixtureBatchFingerprint`'s regression previously pinned the round number,
   a time change, row order and blank/absent equivalence. It now also pins season, round type, both
   club ids, the date, the venue id, an unmapped venue name, notes and the row count — the full set
   the audit brief requires be proved rather than inferred from the canonicalisation.

### 39.4 Files changed by this audit

| File | Change |
|---|---|
| `src/app/admin/fixtures/[season]/[fixtureKey]/page.tsx` | `schedulable` gate; void explanation block; passes the club names to `ClubsPanel` |
| `src/app/admin/fixtures/ClubsPanel.tsx` | current pair always selectable and labelled when no longer eligible; `minWidth: 0`; `aria-label` on the swap button |
| `src/app/admin/fixtures/ReschedulePanel.tsx` | clearing the date clears the time; the label says why the time is disabled; `minWidth: 0` |
| `src/app/admin/fixtures/RoundBatchForm.tsx` | `toWireRow()` drops a time with no date; `updateRow()` clears the time with the date; `aria-label` on every row control; `minWidth: 0` on the header grid |
| `src/app/admin/fixtures/RoundPanel.tsx`, `SingleFixtureForm.tsx` | `minWidth: 0` on the two-column grid children |
| `src/app/admin/fixtures/[season]/page.tsx` | unique diagnostics keys |
| `src/app/admin/fixtures/actions.ts` | `parseBatchRows()` holds `venueId` to the club-id rule |
| `src/styles/globals.css` | **additive** `.badge-danger` |
| `tests/admin-fixture-actions.test.ts` | fingerprint regression extended |
| `CHANGELOG.md`, `issues.md`, `IssuesIndex.md`, `AFLDB-ISSUE-162.md`, `AFLDB-ISSUE-156.md` | tracking |

### 39.5 Tracking corrections made

Every document was checked for an overclaim first; there was none. The corrections are all in the
other direction — records that had gone stale by understating what had happened:

- `IssuesIndex.md` and `issues.md` still carried "Stage 2 NOT built" and "tests written but NOT run"
  UPDATE blocks at the top, and a **State** line describing Stage 1 as uncommitted while a later
  bullet in the same entry said it was committed at `cb98c67`.
- Stage 2 is now committed (`6a9fbc4`) and its §38.5 validation ran green — recorded, with the
  figures the operator supplied.
- `src/db/queries/data-edits.ts` was still listed as an outstanding Stage 2 item; §38.2 item 1
  established it is not an extension point and no change was needed. Corrected to say so.

No document asserts DEV acceptance, Playwright, rendered responsive acceptance, PROD promotion or
resolution. ISSUE-162 remains **OPEN**.

### 39.6 Known limitations carried forward (none blocking)

1. The §37.8 item 7 venue-slug replay limit, unchanged and non-blocking: a fixture re-created by a
   replay that could not resolve its slug keeps the venue NAME and loses the slug binding if a later
   edit rewrites the payload. Re-selecting the venue restores it; Stage 2 surfaces the state in
   three places rather than hiding it.
2. The §37.5 tail risk, unchanged: once the register advances past a fixture's season,
   `afldb_season_list_clubs()` takes its historical arm and a fixture naming a club with no
   `club_seasons` row for that season would fail the replay closed. Specified behaviour, recorded
   so it is not discovered during a promotion.
3. §28's per-row card layout for the batch form under 768px is not implemented; it is a scrolling
   table at every width (§39.2 L).
4. `listVenues()` orders by match count and aggregates over `matches` on every load of the two pages
   that render a venue `<select>`. Correct and small at AFLDB's venue volume; noted, not changed —
   it is a shared query outside this issue.
5. Rendered acceptance of every point in §39.2 L and M is deferred to the DEV batch by design.

### 39.7 Re-gate — NOT YET RUN

Nothing below has executed. In order, from `D:\dev\afldb-issue-162`:

1. `npm run preflight -- --mode implementation --issue 162`
2. `npx tsc --noEmit`
3. `npx vitest run tests/auth.test.ts`
4. `npx vitest run tests/admin-fixture-actions.test.ts tests/data-overrides-source-contract.test.ts tests/db-promotion-check.test.ts tests/current-season-import.test.ts`
5. `npx vitest run tests/integration/admin-fixtures.test.ts` (expect 36/36; no Stage 1 file changed)
6. `npx vitest run tests/admin-season-list-actions.test.ts tests/integration/admin-season-lists.test.ts tests/reference-data.test.ts tests/admin-match-mutations.test.ts` (ISSUE-160/161 regressions — `globals.css` is the only shared file touched)
7. `npx eslint` over the eight changed TS/TSX files of §39.4
8. `git diff --check` and `git status --short`

The §37.10 all-refs migration-097 collision check
(`git log --all --oneline -- src/db/migrations/097_*.sql`) has still never run and remains binding.

Failure expectations: step 2 would most likely be the `ClubsPanel` prop addition; step 3 should be
unaffected (no capability, nav or boundary changed); step 5 should be unaffected entirely.

### 39.8 State after this audit

- Stage 1 backend **complete** and validated locally (committed `cb98c67`).
- Stage 2 Admin UI **complete** and validated locally (committed `6a9fbc4`).
- Final local code/contract audit **complete**; its fixes are **uncommitted** and **not re-run**.
- ISSUE-162 remains **OPEN**.
- Combined ISSUE-160 + 161 + 162 DEV/browser acceptance **deferred** to the Admin Centre batch (§34),
  which begins only on the operator's confirmation that no further Admin/Super Admin addition joins it.
- PROD promotion **deferred**. No public fixture exposure. No DEV or PROD mutation was performed or
  requested at any point in Stage 1, Stage 2 or this audit.
