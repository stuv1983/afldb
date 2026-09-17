# AFLDB-ISSUE-113 — Replace legacy `brownlow_season_votes` acquisition

**Status: RESOLVED 2026-09-04 (§8.18). Committed on `claude/issue-113`; not merged, not
deployed.** The tracked artefact, fail-closed loader and `brownlow-season` rebuild stage are
implemented; V1-V13 are GREEN on the canonical `db:test:rebuild` of the accepted baseline with
the `AFLDB-ISSUE-136` fold (48 final checks; V5 0 / 0 / 0 over 8,570 player-seasons; season,
career and derived totals 79,113; V12 105 passed / 0 failed; V13 idempotent, both content
fingerprints unchanged). **Production still shows the §8.1 symptom**: its remediation is
sequenced under `AFLDB-ISSUE-137` (§8.18.5). Earlier states: §8.14-§8.17.**
**Parent (coordination only):** `AFLDB-ISSUE-102`. **Outside** ISSUE-102's closure boundary
(ISSUE-102 §8.3) — this issue may remain open after ISSUE-102 resolves.
**Severity:** Medium — **Area:** Data acquisition / Import architecture / Data integrity.
**Created:** 2026-08-30 (ISSUE-102 pass 2, operator-authorised).
**Origin:** recorded unowned at `issues/closed/AFLDB-ISSUE-090.md` §27.5 item 1.

**`AFLDB-ISSUE-110` is a different, unmerged issue. Do not use that id.**

---

## 1. The gap, stated precisely

Do **not** say "Brownlow is legacy-free". Only the **round** grain is.

| Table | Writer | Legacy-free? |
|---|---|---|
| `brownlow_round_votes` | `tools/migration/import_fitzroy_core.py:2515` `import_brownlow_round_votes()` | **yes** — canonical, Stage-9 gated (320,861 rows) |
| `brownlow_season_votes` | `tools/migration/import_legacy_afl.py:684` `import_brownlow()` — **sole writer** | **no** — requires `AFLDB_LEGACY_SQLITE` (`:1021`) |

`import_brownlow()` `truncate()`s **both** tables and then `copy_rows()` into
`brownlow_season_votes` the columns: `season, player_id, votes, vote_rank, eligible_rank,
is_ineligible, is_winner, games, three_vote_games, two_vote_games, one_vote_games,
polling_games, link_status_value, source_id, source_record_id, import_batch_id`
(`import_legacy_afl.py:720-725`).

**Boundary: this is `import_legacy_afl.py`, not `import_awards.py`.** Do not conflate it with
`AFLDB-ISSUE-112`. Note also that the Brownlow **award-winner row** in `award_winners` is a
different record, owned by ISSUE-112 family 7; this issue owns only `brownlow_season_votes`.

---

## 2. Coverage — why round votes cannot reconstruct the history

From `data/reference/stat-availability.json` (verified):

| stat key | coverage |
|---|---|
| `brownlow_season_total` | `not_applicable 1897-1923`; **`complete 1924-1941`**; `not_applicable 1942-1945`; **`complete 1946-2025`**; `pending 2026` |
| `brownlow_round_votes` | `not_applicable 1897-1923`; `not_collected 1924-1941`; `not_applicable 1942-1945`; `not_collected 1946-1983`; **`complete 1984-2025`**; `pending 2026` |
| `brownlow_match_votes` | as above but `partial 1931-1934` |

So round-grain votes exist for **1984-2025** (plus a partial 1931-1934 match-grain slice), while
season totals are asserted **complete for 1924-1941 and 1946-2025** — roughly **56 of ~102
decided seasons have no round-grain votes at all**.

Even inside 1984-2025, summing round votes would not reproduce the table:

- `vote_rank` and `eligible_rank` are orderings, not sums.
- `is_ineligible` is an **external disciplinary fact** (a suspension), unknowable from votes.
- `is_winner` follows from eligibility, not from the raw maximum.
- `games`, `three_vote_games`, `two_vote_games`, `one_vote_games`, `polling_games` are countable
  from round votes **only** where round votes are complete.

Legacy source scale for reference (`docs/data-dictionary.md` §3.1): `brownlow_results` 16,120
rows, 1924-2025, 112 winners, 79,113 total votes, **0 unmatched** (15,058 `unique`, 1,062
`resolved`).

---

## 3. Why this matters — `brownlow_season_votes` is AUTHORITATIVE

`tools/migration/rebuild_derived.py:23-26`:

> *"Brownlow — summed from `brownlow_season_votes` (AUTHORITATIVE). Never summed from
> `player_match_stats.brownlow_votes`, which exists only for 1931-1934 and 1984-2025. Stored
> ONLY at player-season grain."*

`src/db/queries/db-health.ts:94` labels the table *"AUTHORITATIVE season Brownlow totals"* and
`:254`/`:273` runs a live integrity check of `player_career_stats` against it.

### 3.1 Downstream consumers (verified)

| Consumer | Path | Dependency |
|---|---|---|
| `player_season_stats.brownlow_votes` + `brownlow_status` | `rebuild_derived.py` `REBUILDS["player_season_stats"]` | LEFT JOIN on `brownlow_season_votes`; `brownlow_status` is `complete` **iff a row exists for that season** |
| `player_career_stats` votes + medals | `rebuild_derived.py:291-297` | `sum(votes)`, `count(*) FILTER (WHERE is_winner)` |
| Grid Solver — 6 axes | `src/db/queries/grid-solver.ts:695, 803, 806, 811, 816, 819` | `brownlow_medallist`, `brownlow_finish_exact`, `brownlow_top_finish`, `brownlow_top_finish_min_times`, `brownlow_winner_votes_min`, `brownlow_season_votes_min` |
| `/brownlow/[year]` | `src/db/queries/brownlow.ts:57, 148` | *"Totals come from `brownlow_season_votes`, the authoritative season …"* |
| Season pages | `src/db/queries/seasons.ts:197` | season leaderboard |
| Player pages | `src/db/queries/players.ts:683` | per-player vote history |
| Player derived reads | `src/db/queries/player-derived.ts:133, 201, 279, 320, 363, 376` | multiple live queries |
| Sitemap | `src/app/sitemap.ts:114` | `SELECT DISTINCT season FROM brownlow_season_votes` — **the Brownlow route set itself** |
| DB health | `src/db/queries/db-health.ts:254, 273, 348` | integrity check + link-status panel |
| Release gates | `tests/integration/release-gates.test.ts:81` | assertions **already skipped**, annotated *"no canonical legacy-free writer for `brownlow_season_votes`"* |

### 3.2 The silent-wrongness hazard — the most important finding

`migration 015` comments (`:147-148`):

> *"Season total from `brownlow_season_votes`. **0 means polled none in a season that was
> decided. NULL means the question does not apply** — read `brownlow_status`."*

And `rebuild_derived.py`'s `season_brownlow` CTE:

```sql
WHEN EXISTS (SELECT 1 FROM brownlow_season_votes b WHERE b.season = s.year) THEN 'complete'
WHEN s.status = 'in_progress'                                              THEN 'pending'
ELSE 'not_applicable'
```

**With the table empty, every decided season 1924-2025 falls to `not_applicable`** — AFLDB would
assert "there was no Brownlow Medal that season" for a century of seasons that had one, and the
sitemap would publish no Brownlow routes at all. That is not a visible gap; it is a confident
wrong answer, which is worse. Any replacement must preserve the three-way
`complete` / `pending` / `not_applicable` distinction exactly, and **must never convert an
unknown into a zero**.

---

## 4. Replacement source — UNDECIDED, deliberately

**No source is selected. Operator decision 6 forbids selecting one without evidence, and this
pass acquired none.** The candidate classes, with what each would have to prove:

| Class | Shape | Must prove | Current evidence |
|---|---|---|---|
| **A — curated manifest** | tracked file(s) carrying 1924-2025 season totals, in the ISSUE-112 mould | that ~16,120 rows × 13 columns is reviewable and maintainable at that size; where the one-time extraction comes from | Precedent exists (22 Under 22, first-kick-goal) but at 330 and 334 rows, two orders of magnitude smaller |
| **B — structured external source** | an AFL Tables Brownlow-summary path via fitzRoy, or another free structured feed | that such an endpoint exists, is free, and carries `vote_rank`/`eligible_rank`/`is_ineligible` — **not just vote totals** | **Unprobed.** `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` records Brownlow as solved *at the round grain* and did not probe a season-summary endpoint. This is the single most valuable unexplored lead. |
| **C — split: derive 1984-2025, curate the tail** | sum/rank from complete round votes for 1984-2025; a manifest for 1924-1941 and 1946-1983 | that derived ranks reproduce the authoritative ones exactly for 1984-2025, **including ineligibility**, which votes alone cannot give | Attractive on size, but ineligibility is the blocker — it would still need a curated exception list |
| **D — export from the existing loaded database** | one-time read-only export of the already-loaded 16,120 rows into a tracked artefact | that the export is faithful and that the legacy-loaded data is itself trustworthy | Lowest risk, no new acquisition; needs operator authorisation. Same prerequisite as ISSUE-112 §11.1 |

**Recommended next step (not a decision): probe class B before committing to A or D.** If a free
structured season-summary source carries the rank and ineligibility columns, it is strictly
better than a 16,120-row hand-maintained manifest. If it does not, D-then-A is the fallback.
A probe is read-only research and must be separately authorised — this pass performed none.

---

## 5. Acceptance design

Whatever source is chosen, the replacement must satisfy:

| # | Requirement |
|---|---|
| 1 | **Complete intended coverage**: 1924-1941 and 1946-2025 decided seasons, matching the `stat_availability` contract. Any narrower coverage is a declared, gated reduction, not an accident. |
| 2 | **All 13 substantive columns**, not just `votes`. A partial load that leaves `vote_rank`/`eligible_rank`/`is_ineligible` NULL breaks six Grid Solver axes. |
| 3 | **Deterministic provenance**: `source_id`, `source_record_id`, `import_batch_id`. If any value is derived rather than acquired, it must not carry external-source provenance (the ISSUE-095 laundering rule). |
| 4 | **No silent NULL-to-zero conversion.** `not_applicable` ≠ `complete`-with-0. Preserve the migration 015 semantics exactly. |
| 5 | **No regression to derived Brownlow outputs**: `player_season_stats.brownlow_votes`/`brownlow_status` and `player_career_stats` votes/medals reproduce their current values on a host that still has the legacy data. |
| 6 | **Canonical rebuild support**: a stage in `tools/db/rebuild-test.ts` before DERIVED (`rebuild_derived.py` reads the table), plus Stage-9 gates — added only once the source exists. |
| 7 | **Validation against current authoritative totals**: 16,120 rows, 79,113 votes, 112 winners, 0 unmatched (`docs/data-dictionary.md` §3.1), verified as a measurement first, not trusted as a constant. |
| 8 | **Link integrity**: `brownlow_season_votes` carries `link_status_value` and appears in the db-health link panel (`db-health.ts:348`), but it is **not** in `LINK_TARGET_TABLES` (`player-links.ts:37-45`) — so it carries no `player_link_resolutions` decisions. Confirm this before designing the reload; it means the ISSUE-044 decision-preservation machinery does **not** apply here. |
| 9 | **Reload safety**: `import_brownlow()` currently `truncate()`s both tables. A replacement must not truncate `brownlow_round_votes`, which a different, canonical writer owns. This coupling is a defect to unpick, not preserve. |
| 10 | **Removal of the `AFLDB_LEGACY_SQLITE` dependency for this slice**, without disturbing the other `import_legacy_afl.py` groups. |
| 11 | Re-arm the skipped `tests/integration/release-gates.test.ts` Brownlow assertions (`:65-81`) and the retired ISSUE-090 §27.5 gate. |

---

## 6. Explicit exclusions

- No source selection without evidence (operator decision 6).
- No scraping, fetching or external acquisition in this issue as written.
- No broader `import_legacy_afl.py` parent issue (operator decision 7) — if later evidence proves
  coordinated replacement is needed, record it then, as a candidate follow-up, not speculatively.
- No `import_awards.py` work — that is ISSUE-112.
- No change to `brownlow_round_votes` acquisition.
- No migration editing; no privilege change; no production or `afldb_dev` mutation.

---

## 7. Status

Design recorded 2026-08-30. **Not implemented. No source selected.** The single unresolved
decision is §4: which replacement class, gated on a read-only probe of class B that has not been
authorised or performed.

**Superseded 2026-09-04 by §8** — the source question is now provisionally decided on evidence
(§8.5) and the remaining gates are measurements and authorisation (§8.8, §8.10).

**Resolved 2026-09-04 — see §8.18.**

---

## 8. Stage 2026-09-04 — production linkage, evidence, and the implementation/source plan

Worktree `D:\dev\afldb-issue-113`, branch `claude/issue-113`, base `f11037a`. Repository
inspection only; no command, database, Git or network action was taken. Nothing is
implemented. Nothing is committed.

### 8.1 Production symptom — this issue is now live (linkage from `AFLDB-ISSUE-135`)

`issues/open/AFLDB-ISSUE-135.md` is **not on this branch** (only the "next free ID" allocation
note in `IssuesIndex.md`/`issues.md` mentions the number), so the linkage below is recorded from
the operator's brief, not from that file. ISSUE-135 independently traced the current production
Brownlow failure to this issue; ISSUE-113 is the **owning implementation issue**.

Production evidence supplied by the operator (`afldb-prod`, `current_database() = afldb_prod`,
read-only):

| Observation | Value |
|---|---|
| `brownlow_round_votes` | populated and correctly linked to canonical players — Harley Reid (`5481`, 39 round rows / 7 polling / 10 career votes), Matt Rowell (`9239`, 108 / 39 / 89), Tom Green (`12550`, 108 / 34 / 73) |
| Direct SQL over round votes | a valid 1984-2025 career leaderboard (Ablett 262, Dangerfield 259, Mitchell 227, Neale 225, Pendlebury 225, Harvey 215, Selwood 214, Martin 213, Bontempelli 213, Judd 210, Cripps 205 …) |
| The two canonical Tom Green rows | legitimately different players (`12549` 1935; `12550` 2020-2025) — **not** the cause |
| Public surfaces | Reid / Rowell / Green all **0 Brownlow votes**; `/brownlow` career leaders **0 players** |

Mechanism (the §3.2 hazard, realised exactly as predicted): the 2026-09-02 production cutover
promoted a **canonical rebuild** (`CHANGELOG.md` "2026 season baseline … replaced with a clean
rebuilt database"). The canonical rebuild and the in-season settle populate `brownlow_round_votes`
and intentionally never write `brownlow_season_votes` (§8.2), so the season table arrived
**empty**; `rebuild_derived.py` then wrote `player_season_stats.brownlow_votes = NULL /
brownlow_status = not_applicable` for every decided season and `player_career_stats.brownlow_votes
= 0 / brownlow_medals = 0` for every player; every consumer in §3.1 reads those derived values or
the empty table. **Correctness defect, not presentation.** Also affected by the same mechanism,
per §3.1: `/brownlow/[year]`, the sitemap's Brownlow route set (empty), season-page leaderboards,
player-page vote history, six Grid Solver axes, NL search / record boards that read the derived
totals, the db-health reconciliation panel, and the season-medal status semantics.

A correction to §2's arithmetic while here: 1924-2025 is 102 calendar years, of which 1942-1945
were not decided, so the intended coverage is **98 decided seasons** (18 in 1924-1941 + 80 in
1946-2025), not "~102". The "56 seasons with no round-grain votes" figure stands (98 − 42).

### 8.2 Repository findings (verified at `f11037a`)

**Writers.** `import_legacy_afl.py:683-757` `import_brownlow()` is still the **sole** writer, and
still `truncate()`s both tables (`:684`) under `AFLDB_LEGACY_SQLITE`. Every other Brownlow path
disclaims the season table explicitly: `src/lib/acquisition/settle-afltables.ts:1354` ("WHAT IT
NEVER WRITES … `brownlow_season_votes`"), `src/lib/acquisition/canonical-apply.ts:781` ("never
written and no season total is derived from a partial round set"),
`tests/integration/settle-afltables.test.ts:2979-2984` (asserts the row count is unchanged after a
settle, citing this issue), `tools/migration/import_awards.py:997` ("this loader sources no season
vote totals"), and `import_fitzroy_core.py:2725-2780` writes `brownlow_round_votes` only. There is
no other `INSERT`/`COPY` into the table in `tools/` or `src/`.

**Rebuild ordering.** `tools/db/rebuild-test.ts:400-537` `planStages()`:
`precheck → recreate → migrations → privileges → reference → fitzroy → draftguru →
awards-honours → derived → coleman → ladder-witness → fingerprints`. A replacement loader must run
**after `fitzroy`** (which populates `players` and the `external_identities` profile identities the
re-key resolves through; `:502-503`) and **before `derived`** (`rebuild_derived.py:194-202` and
`:295-301` read the table). The natural slot is a new data stage immediately after
`awards-honours`. `tests/db-test-rebuild.test.ts:691-716` pins both the full stage-id list and the
data-stage list, so both assertions are extended in the same change — expected, not a blocker.
`finalValidationSql()` (`:776`) carries `brownlow_round_vote_rows` only; **no season-grain
fingerprint exists.**

**Gates and skips (all re-armable by the same path).**

| Location | State | Re-arm condition |
|---|---|---|
| `tests/integration/release-gates.test.ts:79` season total 79,113 | `it.skip` | load lands |
| `:86` career = 79,113, per-game = 46,979 | `it.skip` | load lands (per-game figure must be re-measured — the canonical round table is fitzRoy-sourced) |
| `:97` player_season_stats cannot inflate | `it.skip` | load lands |
| `:138` representative totals (Reynolds 154, Skilton 180) | `it.skip` | must be rewritten to resolve the witnesses **from data** (profile identity), not pinned ids 3702/3578 (`:73-75`) |
| `:176` genuine zero in a decided season | `it.skip` | load lands |
| `:234` 269-player zero-votes cohort | `it.skip` | load lands; cohort count to be re-measured |
| `:973` 2026 reports `pending`, never zero | `it.skip` | load lands **and** the loader writes no 2026 row |
| `tests/integration/database.test.ts:235-260`, `:458` | skipped, same annotation | load lands |
| `tests/integration/grid-solver.test.ts:499-506` (`eligible_rank <= 1`) | runs, but vacuous on an empty table | becomes meaningful |
| `ISSUE-090` §27.5 gate | retired | re-record as the Stage-9 season fingerprint |

**Provenance contract.** Schema `005_brownlow_awards.sql:11-38`: `source_id` → `sources`,
`source_record_id text`, `import_batch_id` → `import_batches`, `link_status_value` (default
`unique`), `UNIQUE (season, player_id)`, `votes >= 0`, nullable `club_id` (the legacy writer never
set it). The registry (`data/reference/sources.json`) holds `afltables` (`scrape`, "Brownlow
votes, match details …") and `sports_data_lab` (`derived`, legacy layer, "the new rebuild path
never reads from it"). The legacy writer stamped `source_id = afltables`, `source_record_id =
<legacy SQLite result_id>`, batch `import_batch(pg, 'afltables', 'import_legacy_afl.py',
'brownlow_season_votes')`. ISSUE-112's operator decision of 2026-09-01 ("`source_citation`
granularity: source-granularity provenance from the canonical source identity, not a per-row
page/edition citation; legacy SQLite is not reopened to reconstruct it") is the standing precedent
for a bootstrap export.

**Privileges.** Migration `045_import_write_is_fail_closed.sql:99-112` registered every
then-existing public table in `afldb_meta.import_writable_tables`, and `brownlow_season_votes`
(created by 005) is not in its exclusion list, so `afldb_import` already holds
`SELECT, INSERT, UPDATE, DELETE, TRUNCATE` on it via `privileges.sql:249`. **No privilege change
and no migration is expected** (verify with §8.8 Q9 before relying on it).

**Identity — the binding hazard, confirmed.** The canonical rebuild re-seeds `players.id`;
ISSUE-112 measured **0 of 12,392** shared ids denoting the same footballer
(`import_awards.py:270-279`, `tools/migration/player_identity.py`). `players.legacy_player_id`
exists (`002_core_entities.sql:118`) but `import_fitzroy_core.py` never populates it
(`import_draft.py:14-15`), so it is not a bridge. The identity the rebuild preserves is the AFL
Tables profile path in `external_identities` (`source = afltables`, `match_method =
'afltables_profile_url'`, `status IN ('unique','resolved')`), normalised by
`import_fitzroy_core.normalise_profile_url()` (`:263-273`) to the `players/A/Name.html` form,
which `enrich_birth_dates.py` mirrors. The proven resolver is `import_awards.PlayerResolver`
(`:288-338`): census id → profile path → exactly one canonical player, **fail-closed, never a name,
never the bootstrap id**. In the **legacy-loaded** databases the same `external_identities` rows
were written by ISSUE-090's register pass from the SQLite `afltables_player_index` (13,358 rows;
pinned population 12,472 of 13,361 legacy players), so a legacy `player_id → profile path` bridge
exists there too — its coverage over the Brownlow polling population is **unmeasured** (§8.8 Q4).

**Coverage semantics.** `rebuild_derived.py:194-202`: a season is `complete` iff a row exists,
`pending` iff `seasons.status = 'in_progress'`, else `not_applicable`. `data/reference/seasons.json`
holds 2026 as `in_progress`. So the writer must emit rows for exactly the seasons whose
`brownlow_season_total` availability is `complete` (1924-1941, 1946-2025) and **never** a 2026 row
while that season is pending.

**Decision preservation.** §5.8 stands: the table is not in `LINK_TARGET_TABLES`, carries no
`player_link_resolutions`, so no ISSUE-044 decision replay is needed. Its `link_status_value`
still feeds the db-health link panel (`db-health.ts:351`).

### 8.3 Class B — structured external season-summary source: evidence

| Question | Repository evidence |
|---|---|
| Does fitzRoy 1.8.0 expose an **AFL Tables** Brownlow season-summary function? | **No evidence.** `tools/rebuild/fitzroy/fitzroy-contract.json` declares `player_stats`, `player_details`, `ladder`, … — no Brownlow summary dataset. The only AFL Tables Brownlow field is `Brownlow.Votes` at player-match grain (`:199`). |
| Does fitzRoy expose *any* Brownlow tally function? | `fetch_awards_brownlow()` (**FootyWire**, "season/player/team tally grain") — existence verified against the 1.8.0 reference index on 2026-08-25 (`issues/closed/AFLDB-ISSUE-093.md:154, 634`); recorded then as an "independent cross-check only, not acquired"; **columns and coverage never probed** (`fitzroy-contract.json:199` note). |
| Would it carry `vote_rank` / `eligible_rank` / `is_ineligible` / `is_winner`? | **Unknown.** A tally grain implies totals; there is no evidence it records ineligibility, and a FootyWire tally would be a *second scrape-derived* source that §6 excludes from this issue as written. |
| Historical reach 1924-1983? | **Unknown**; nothing in the repository asserts FootyWire coverage before the modern era. |

**Conclusion.** Class B is **not evidenced** to satisfy §5 requirements 1 and 2. It cannot be
adopted on current evidence. It remains useful only as an optional independent cross-check. The
exact read-only probe, if the operator wants it (R host with fitzRoy 1.8.0 — `afldb-prod` or the
local Rscript per memory; **requires separate authorisation; it is a network fetch**):

```r
library(fitzRoy)
print(packageVersion("fitzRoy"))            # expect 1.8.0
print(args(fetch_awards_brownlow))          # learn the real signature before calling
x <- fetch_awards_brownlow()                # then re-call with the season argument args() shows, for 2024 and for 1950
str(x); print(names(x)); print(nrow(x)); print(range(x$season, na.rm = TRUE))
```

Record: column list, whether any column expresses ineligibility or rank, and the earliest season
returned. A negative result closes class B; a positive result still only makes it a witness.

### 8.4 Class D — recovery/export from the preserved authoritative database: evidence

Databases the repository records as still holding the legacy-loaded, authoritative
`brownlow_season_votes` (16,120 rows / 79,113 votes / 112 winners / 0 unmatched per
`docs/data-dictionary.md` §3.1, loaded by the legacy writer):

| Candidate | Evidence | State |
|---|---|---|
| **`afldb_prod_auth_recovery`** on `afldb-prod` | created from the **full** pre-cutover dump (`issues/closed/AFLDB-ISSUE-122.md:2787-2804`; `IssuesIndex.md` ISSUE-126 row); pre-cutover production was legacy-loaded (`CHANGELOG.md:316-318`: "every pre-existing 2026 row was legacy-loaded") | **preserved and must not be dropped until ISSUE-126 resolves** — available now; Brownlow contents unmeasured |
| `/home/arm/afldb_prod_pre_rebuild_20260902-200355.dump` on `afldb-prod` | the pre-cutover backup, SHA-256 transfer-checked (`CHANGELOG.md:311-313`) | immutable artefact; same contents |
| `afldb_dev` on the dev host | ISSUE-112's authorised bootstrap source (`issues/closed/AFLDB-ISSUE-112.md:315-320, 4570`); the `afldb_dev` rung of the ISSUE-122 rollout never ran (`AFLDB-ISSUE-122.md:2683-2684`, no R on that host) | presumed still legacy-loaded as of 2026-09-03; **verify before use** (§8.8 Q0/Q1) |
| the legacy SQLite (`AFLDB_LEGACY_SQLITE`) | the original scrape target; operator decision 8 says it is never wired back into the rebuild | not preferred: the PostgreSQL state additionally carries the `external_identities` bridge, and ISSUE-112 §11.1 already chose the PostgreSQL state for the same reason |

**Why D is evidence-supported rather than merely convenient.** The export is the *same data* that
was authoritative on production until 2026-09-02, carries all 13 substantive columns and the
`link_status_value`, and needs no new acquisition. The identity bridge it depends on is the one the
repository already uses for exactly this bootstrap shape (ISSUE-112, 5,142 of 5,194 rows resolved,
every failure enumerated, zero mis-links). The two independent witnesses in §8.7 (canonical
fitzRoy round votes for 1984-2025; the ISSUE-112 Brownlow winner rows) can prove the re-key landed
on the right footballers without trusting the export.

**Binding hazard and its handling.** Legacy `player_id` values are **never** written to the target.
The export carries the profile path as the key; the loader resolves it against the target's
`external_identities` exactly as `PlayerResolver` does. A row whose bootstrap player has no profile
path in the recovery database, or whose path resolves to zero or more than one canonical player,
is a **rejection**, not an unlinked row (the column is `NOT NULL`, and a silently dropped polling
row would shorten a season's total while the season still read `complete`). **The load is accepted
only at zero rejections**; the coverage measurement in §8.8 Q4 decides whether a second bridge
(the SQLite `afltables_player_index`, or adjudication rows in the style of
`data/awards/player-identity.csv`) is needed before the artefact is built.

### 8.5 Decision (provisional, evidence-based)

**Adopt class D as the acquisition path**, producing a tracked, rebuildable artefact (which is
what class A wanted, without hand-curation), **with class C as the 1984-2025 validation witness**,
and class B as an optional cross-check only. This is provisional on the §8.8 measurements
reproducing 16,120 / 79,113 / 112 / 98 seasons and on an identity-coverage result that leaves a
tractable rejection set. Operator authorisation is required for every step in §8.10; none is
assumed. **Confirmed 2026-09-04 by §8.11: both conditions hold** (exact reproduction; 174-player
gap, 173 resolved by evidence, 1 operator decision). The decision stands; execution remains
gated on §8.13.

Not adopted: summing `brownlow_round_votes` as the writer (fails §5.1 for 56 seasons and §5.2 for
rank/ineligibility everywhere); a fresh scrape of any kind (§6).

### 8.6 Writer boundary — design

**Artefact.** `data/brownlow/season-votes.csv` (tracked; ~16,120 rows, roughly 1 MB — two orders
larger than `data/awards/*.csv` but well inside Git norms) plus a sidecar
`data/brownlow/season-votes.manifest.json` recording: source database name and host, the dump
filename and its SHA-256, extraction timestamp (UTC), the exact export SQL, row count, `sum(votes)`,
winner count, distinct seasons, distinct players, and the CSV's SHA-256. Columns:

```text
season, afltables_profile_url, votes, vote_rank, eligible_rank, is_ineligible, is_winner,
games, three_vote_games, two_vote_games, one_vote_games, polling_games, link_status_value,
bootstrap_player_id, display_name, legacy_source_record_id
```

The last three are **review-only** (same rule as the census: never a target id, never matched on).
Empty string = SQL NULL for the nullable smallints; never coerced to 0.

**Loader.** New module `tools/migration/import_brownlow_season.py` — not `import_legacy_afl.py`
(§1 boundary) and not `import_awards.py` (§6). Contract:

1. Parse and validate the artefact before any database contact: header exact; `(season,
   afltables_profile_url)` unique; `votes >= 0`; every season in the artefact has
   `brownlow_season_total = complete` in `stat_availability` and `seasons.status <> 'in_progress'`;
   every `complete` season is present; at least one `is_winner` per season; no row for 1942-1945 or
   before 1924; manifest SHA-256 matches the CSV bytes.
2. Resolve every profile path through `external_identities` (`afltables` /
   `afltables_profile_url` / unique-or-resolved) to exactly one `players.id`; anything else is a
   rejection recorded in `import_rejections` with the path and season.
3. **Zero rejections or no write**: the batch fails (non-zero exit, transaction rolled back) if any
   row is unresolved. This is what makes "0 unmatched" an acceptance fact, not a hope.
4. Write inside one transaction under `import_batch(pg, <source_key>,
   'import_brownlow_season.py', 'brownlow_season_votes')`: `TRUNCATE brownlow_season_votes`
   **only** (never `brownlow_round_votes` — §5.9) then `copy_rows()` in deterministic
   `(season, player_id)` order. Deterministic and rerunnable: an identical rerun yields identical
   rows and counts.
5. Provenance: `source_id = 'afltables'` (the fact's canonical source identity, per the ISSUE-112
   `source_citation` precedent; the values are acquired, not derived, so this is not the ISSUE-095
   laundering case), `source_record_id = 'brownlow-season:<season>:<profile path>'` (stable,
   checkable by a later reader; the retired SQLite `result_id` is *not* reused — cf.
   `enrich_birth_dates.py:333-337`), `import_batch_id` from the batch. `link_status_value` carried
   through. `club_id` left NULL as before. **Operator decision required** on the source key; the
   alternative is `sports_data_lab` (the layer the rows physically came from), which would be
   faithful to the artefact's lineage but would mislabel AFL Tables facts as "derived".
6. Runs as `afldb_import` with `AFLDB_IMPORT_DATABASE_URL` only; reads no `AFLDB_LEGACY_SQLITE`
   and no network.

**Rebuild integration.** New stage in `planStages()` with id `brownlow-season`, kind `data`,
between `awards-honours` and `derived`; extend `tests/db-test-rebuild.test.ts:695-711` ordering
and data-stage assertions; add Stage-9 fingerprints `brownlow_season_rows`,
`brownlow_season_votes_total`, `brownlow_season_winners`, `brownlow_season_seasons` (values
measured from the artefact at plan time, not typed in).

**Legacy writer retirement (§5.10).** Remove the `brownlow` group from `import_legacy_afl.py`'s
`GROUPS` (`:995`) and delete `import_brownlow()`, so no path can truncate `brownlow_round_votes`
again; the other legacy groups are untouched. `docs/deployment.md:312` (reload order) and
`tools/maintenance/restore-test.sh:191` (already checks `sum(votes)`) are the doc/ops references
to update.

**Production remediation (sequence for the deploy stage; not authorised here).** Deploy code →
run `import_brownlow_season.py` on `afldb_prod` as `afldb_import` → run `rebuild_derived.py` →
confirm §8.7 → note that `/brownlow/[year]`, player and season pages may be ISR-cached for up to
an hour after the derived rebuild (the ISSUE-133/134 pattern), so verify against the on-disk
`.next` entry or after a rebuild before declaring the surfaces fixed.

**Follow-up, not this issue:** an annual season-close procedure to append the 2026 (and later)
season rows once the medal is decided — votes and polling counts are derivable from the complete
canonical round votes from 1984 onward, but `vote_rank`/`eligible_rank`/`is_ineligible`/
`is_winner` need the year's ineligibility list, a small curated input. Record as a candidate
follow-up when this issue closes.

### 8.7 Validation plan

Measured, never assumed; every figure below is a hypothesis until §8.8 confirms it against the
recovery source.

| # | Check | Expected |
|---|---|---|
| V1 | `count(*)`, `sum(votes)`, `count(*) FILTER (WHERE is_winner)`, `count(DISTINCT season)` on the loaded table | 16,120 / 79,113 / 112 / 98 — equal to the recovery-source measurement |
| V2 | rejections in the load batch | **0** |
| V3 | seasons with rows = exactly {1924..1941} ∪ {1946..2025}; no 1942-1945; no 2026 | true |
| V4 | `player_season_stats.brownlow_status` by season: `complete` for V3's set, `not_applicable` for pre-1924 and 1942-1945, `pending` for 2026 with NULL votes | true (re-arms `release-gates.test.ts:155-184, 973`) |
| V5 | **Round-vote witness, 1984-2025** (class C): per `(season, player_id)`, `sum(brownlow_round_votes.votes)` = `votes`, `count(*) FILTER (WHERE votes > 0)` = `polling_games`, and the 3/2/1 counts match; and no `(season, player)` with round votes > 0 lacks a season row | 0 mismatches (any mismatch is either a mis-keyed row or a real source disagreement — adjudicate, never suppress) |
| V6 | **Winner witness**: `is_winner` rows ⊆ the ISSUE-112 Brownlow `award_winners` rows by `(season, player_id)` and vice versa, for the seasons both cover | 0 asymmetric rows |
| V7 | `player_career_stats` totals: Reid 10, Rowell 89, Green (`12550`) 73 from the operator's round-vote figures — these are 1984+ players so round sums are exact; plus the pre-1984 witnesses resolved **from data** (Reynolds 154, Skilton 180 by profile path) | equal |
| V8 | `db-health` reconciliation `brownlow votes: player_career_stats vs. brownlow_season_votes` | 0 mismatches |
| V9 | `/brownlow/[year]` renders for every V3 season; `/brownlow` career leaders non-empty and headed by the §8.1 leaderboard order for 1984+ contributions plus historical totals | true |
| V10 | `sitemap.ts:114` route set = V3's seasons | 98 routes |
| V11 | Grid Solver: the six axes return non-empty, and `grid-solver.test.ts:499` compares a non-zero count | true |
| V12 | Release gates re-armed (§8.2 table) and green; `database.test.ts` Brownlow describes green; Stage-9 fingerprints green in a full `db:test:rebuild` | green |
| V13 | Idempotence: rerun the loader; row count, sums and `import_batches` counters identical; `brownlow_round_votes` count unchanged before/after | true |

### 8.8 Exact read-only operator queries (persisted; NOT run; require authorisation)

Run on `afldb-prod` against **`afldb_prod_auth_recovery`** first (fallback: `afldb_dev` on the dev
host). Every session starts with the guard and stays inside a read-only transaction:

```sql
-- Q0 guard: must print the intended database; abort otherwise.
SELECT current_database(), current_user, now();
BEGIN; SET TRANSACTION READ ONLY;

-- Q1 headline measurement (hypothesis: 16120 / 79113 / 112 / 98 / 1924 / 2025)
SELECT count(*)                              AS rows,
       sum(votes)                            AS votes,
       count(*) FILTER (WHERE is_winner)     AS winners,
       count(DISTINCT season)                AS seasons,
       min(season), max(season),
       count(DISTINCT player_id)             AS players,
       count(*) FILTER (WHERE link_status_value = 'unique')   AS lk_unique,
       count(*) FILTER (WHERE link_status_value = 'resolved') AS lk_resolved,
       count(*) FILTER (WHERE link_status_value NOT IN ('unique','resolved')) AS lk_other,
       count(*) FILTER (WHERE vote_rank IS NULL)     AS null_vote_rank,
       count(*) FILTER (WHERE eligible_rank IS NULL) AS null_eligible_rank,
       count(*) FILTER (WHERE games IS NULL)         AS null_games,
       count(*) FILTER (WHERE polling_games IS NULL) AS null_polling
  FROM brownlow_season_votes;

-- Q2 season coverage: decided seasons with NO rows (expect none) and rows in undecided seasons (expect none)
SELECT s.year FROM seasons s
 WHERE s.year BETWEEN 1924 AND 2025 AND s.year NOT BETWEEN 1942 AND 1945
   AND NOT EXISTS (SELECT 1 FROM brownlow_season_votes b WHERE b.season = s.year)
 ORDER BY 1;
SELECT season, count(*) FROM brownlow_season_votes
 WHERE season < 1924 OR season BETWEEN 1942 AND 1945 OR season >= 2026
 GROUP BY 1 ORDER BY 1;

-- Q3 winners per season (expect every decided season >= 1; list the ties for the record)
SELECT season, count(*) FILTER (WHERE is_winner) AS winners
  FROM brownlow_season_votes GROUP BY 1
HAVING count(*) FILTER (WHERE is_winner) <> 1 ORDER BY 1;

-- Q4 identity-bridge coverage in THIS database (the go/no-go for the re-key)
WITH ids AS (
  SELECT ei.player_id, ei.external_id
    FROM external_identities ei JOIN sources s ON s.id = ei.source_id
   WHERE s.key = 'afltables' AND ei.match_method = 'afltables_profile_url'
     AND ei.status IN ('unique','resolved') AND ei.player_id IS NOT NULL
)
SELECT count(DISTINCT b.player_id)                                        AS brownlow_players,
       count(DISTINCT b.player_id) FILTER (WHERE i.player_id IS NOT NULL) AS with_profile,
       count(*)                                                           AS brownlow_rows,
       count(*) FILTER (WHERE i.player_id IS NULL)                        AS rows_without_profile,
       sum(b.votes) FILTER (WHERE i.player_id IS NULL)                    AS votes_without_profile
  FROM brownlow_season_votes b LEFT JOIN ids i ON i.player_id = b.player_id;

-- Q4b the unresolved players, largest first (bounded)
WITH ids AS (
  SELECT ei.player_id FROM external_identities ei JOIN sources s ON s.id = ei.source_id
   WHERE s.key = 'afltables' AND ei.match_method = 'afltables_profile_url'
     AND ei.status IN ('unique','resolved') AND ei.player_id IS NOT NULL)
SELECT b.player_id, p.display_name, p.legacy_player_id,
       min(b.season) AS first, max(b.season) AS last, count(*) AS seasons, sum(b.votes) AS votes
  FROM brownlow_season_votes b JOIN players p ON p.id = b.player_id
 WHERE NOT EXISTS (SELECT 1 FROM ids i WHERE i.player_id = b.player_id)
 GROUP BY 1,2,3 ORDER BY votes DESC, seasons DESC LIMIT 50;

-- Q5 bridge ambiguity: one profile path → more than one player in THIS database (expect 0 rows)
SELECT ei.external_id, count(DISTINCT ei.player_id)
  FROM external_identities ei JOIN sources s ON s.id = ei.source_id
 WHERE s.key = 'afltables' AND ei.match_method = 'afltables_profile_url'
   AND ei.status IN ('unique','resolved') AND ei.player_id IS NOT NULL
 GROUP BY 1 HAVING count(DISTINCT ei.player_id) > 1 LIMIT 20;

-- Q6 the bridge population itself (hypothesis: ~12,472 afltables_profile_url rows)
SELECT s.key, ei.match_method, ei.status, count(*)
  FROM external_identities ei JOIN sources s ON s.id = ei.source_id
 GROUP BY 1,2,3 ORDER BY 1,2,3;
ROLLBACK;
```

Then on **`afldb_prod`** (canonical, read-only — the target side of the re-key):

```sql
SELECT current_database();
BEGIN; SET TRANSACTION READ ONLY;
-- Q7 target bridge population and ambiguity (expect ambiguity = 0)
SELECT count(*) AS profile_ids, count(DISTINCT player_id) AS players,
       count(*) - count(DISTINCT external_id) AS duplicate_paths
  FROM external_identities ei JOIN sources s ON s.id = ei.source_id
 WHERE s.key = 'afltables' AND ei.match_method = 'afltables_profile_url'
   AND ei.status IN ('unique','resolved') AND ei.player_id IS NOT NULL;
-- Q8 the defect as it stands today (expect season = 0; round > 0)
SELECT (SELECT count(*) FROM brownlow_season_votes) AS season_rows,
       (SELECT count(*) FROM brownlow_round_votes)  AS round_rows,
       (SELECT count(*) FROM player_season_stats WHERE brownlow_status = 'complete') AS complete_rows,
       (SELECT sum(brownlow_votes) FROM player_career_stats) AS career_votes;
-- Q9 the loader's privilege assumption (expect t, t; the third column is informational)
SELECT has_table_privilege('afldb_import', 'brownlow_season_votes', 'INSERT')   AS ins,
       has_table_privilege('afldb_import', 'brownlow_season_votes', 'TRUNCATE') AS trunc,
       has_table_privilege('afldb_import', 'brownlow_round_votes',  'TRUNCATE') AS round_trunc_granted_too;
ROLLBACK;
```

(Q9's third column is informational: 045 grants the import role TRUNCATE on the round table too,
which is why the *code* must never issue it — the privilege boundary will not stop it.)

**The export itself — persisted, NOT authorised, do not run in this stage.** From the recovery
database, after Q1-Q6 pass, as a read-only role, to a file that is then hashed and copied into the
worktree:

```sql
\copy (
  SELECT b.season,
         ei.external_id AS afltables_profile_url,
         b.votes, b.vote_rank, b.eligible_rank, b.is_ineligible, b.is_winner,
         b.games, b.three_vote_games, b.two_vote_games, b.one_vote_games, b.polling_games,
         b.link_status_value,
         b.player_id AS bootstrap_player_id, p.display_name,
         b.source_record_id AS legacy_source_record_id
    FROM brownlow_season_votes b
    JOIN players p ON p.id = b.player_id
    LEFT JOIN (SELECT ei.player_id, ei.external_id
                 FROM external_identities ei JOIN sources s ON s.id = ei.source_id
                WHERE s.key = 'afltables' AND ei.match_method = 'afltables_profile_url'
                  AND ei.status IN ('unique','resolved') AND ei.player_id IS NOT NULL) ei
      ON ei.player_id = b.player_id
   ORDER BY b.season, ei.external_id, b.player_id
) TO 'brownlow-season-votes-export.csv' WITH (FORMAT csv, HEADER true)
```

followed by `sha256sum brownlow-season-votes-export.csv` and `wc -l` for the manifest. Rows with an
empty `afltables_profile_url` are the Q4 gap and must be resolved (second bridge or adjudication)
before the artefact is accepted.

### 8.9 Blockers and deviations (written before measurement; see §8.11 for what changed)

**Update 2026-09-04 after §8.11:** the "unknown until measured" items below are now known — the
contract figures reproduce, the bridge gap is 174 players and is resolvable without reopening
the SQLite source (§8.12), and only one identity (Peter Brown 1978) and the source key remain
operator decisions. The authorisation blockers on the export, the artefact commit and the
implementation still stand (§8.13).

- **Not a deviation from the §5 contract**: every requirement 1-11 maps to §8.6/§8.7. Requirement
  7's figures are treated as hypotheses pending Q1.
- **§6 "no source selection without evidence"**: §8.5 is provisional and evidence-cited; it becomes
  a decision only when the operator authorises §8.10 step 1 and Q1-Q6 pass.
- **Blocked on operator action**: every database contact (Q0-Q9, the export), the source-key
  provenance choice, and committing a ~16k-row tracked artefact.
- **Unknown until measured**: identity-bridge coverage in the recovery database (Q4). If it is
  materially below 100 % of polling rows, the second bridge (SQLite `afltables_player_index`, a
  one-time read of the retired source that does *not* wire it into the rebuild) or a small
  adjudication file is the fallback; that choice is deferred to the evidence.
- **ISSUE-135 file absent on this branch**: linkage recorded from the operator's brief; if that
  runbook holds contradicting evidence, it wins and this section must be amended.
- **ISSUE-126 dependency**: `afldb_prod_auth_recovery` must survive until this export is taken and
  verified; add that to ISSUE-126's "must not be dropped" condition when it is next touched.

### 8.10 Exact next action — SUPERSEDED by §8.13 (the measurements below were run)

1. **Operator**: authorise and run §8.8 Q0-Q6 on `afldb_prod_auth_recovery` (fallback
   `afldb_dev`) and Q7-Q9 on `afldb_prod`; return the outputs. Decide the provenance source key
   (§8.6 item 5; recommended `afltables`).
2. **Next session (implementation, fresh, carry-over this file §8)**: if Q1 reproduces
   16,120 / 79,113 / 112 / 98 and Q4 leaves no or a tractable gap — build the artefact from the
   authorised export, write `tools/migration/import_brownlow_season.py`, add the `brownlow-season`
   stage and fingerprints, retire the legacy `brownlow` group, re-arm the gates, and validate
   V1-V13 on `afldb_test` via a full `db:test:rebuild`. Production load only after that, under
   the §8.6 remediation sequence and the operator's deploy control.
3. If Q1 does **not** reproduce the contract figures, stop and record the discrepancy here before
   any artefact is built.

### 8.11 Measurement results — 2026-09-04 (operator-authorised, read-only, RUN)

**How.** From this workstation over SSH to `afldb-prod`, `psql` as the `afldb_owner` role from
the host `.env`, with `PGOPTIONS='-c default_transaction_read_only=on'` **and** an explicit
`BEGIN; SET TRANSACTION READ ONLY; … ROLLBACK;` around every batch; the guard printed
`default_transaction_read_only = on` for each session. No DSN was printed or copied. Query files
were staged under `/tmp` on the host and removed at the end of each run. Beyond §8.8, three
further read-only measurements were taken in the same authorised class and are recorded as
Q10-Q11 below: they size the identity gap Q4 exposed, and they do not touch anything else.

**Recovery database `afldb_prod_auth_recovery` (Q0 guard: `current_database() =
afldb_prod_auth_recovery`, `2026-09-04 01:05:30+10`).**

| Q | Measure | Result | Hypothesis |
|---|---|---|---|
| Q1 | rows / votes / winners / distinct seasons / min / max | **16,120 / 79,113 / 112 / 98 / 1924 / 2025** | reproduced exactly |
| Q1 | distinct players | 4,275 | — |
| Q1 | `link_status_value` unique / resolved / other | 15,058 / 1,062 / 0 | matches `docs/data-dictionary.md` §3.1 |
| Q1 | NULL `vote_rank` / `eligible_rank` / `games` / `polling_games` | 0 / **3** / 0 / **4,928** | the 3 NULL `eligible_rank` rows are exactly the 3 `is_ineligible` rows; `polling_games` is NULL on 4,928 rows and **must stay NULL** (not 0) in the artefact |
| Q1 | `club_id` set / `source_record_id` NULL / source ids / batches | 0 / 0 / 1 / 1 | single legacy batch, `source = afltables` (Q1b: 16,120) |
| Q2a | decided seasons (1924-1941, 1946-2025) with no rows | **none** | — |
| Q2b | rows in pre-1924, 1942-1945 or 2026 | **none** | — |
| Q3 | seasons whose winner count ≠ 1 | 12 joint-medal seasons: 1930 (3), 2003 (3), and 1940, 1949, 1952, 1959, 1965, 1981, 1986, 1987, 1996, 2012 (2 each) — 98 + 14 = 112 | reconciles the winner count |
| Q4 | identity bridge (`external_identities`, `afltables_profile_url`, unique/resolved) | **4,101 of 4,275 players** resolve; **174 players / 525 rows / 2,407 votes / 7 winner rows** do not | the gap the design anticipated |
| Q4c | unresolved rows by decade | 1920s 21 · 1930s 59 · 1940s 50 · 1950s 107 · 1960s 91 · 1970s 105 · 1980s 58 · 1990s 34 · none from 2000 on | the ISSUE-090 register-pass gap, not an era artefact |
| Q5 / Q5b | one path → many players; one player → many paths | **0 / 0** | bridge is unambiguous in the source |
| Q6 | bridge population | 12,472 `afltables_profile_url` rows, all `unique` | matches the ISSUE-090 pin |
| Q6b | `players` | 13,361 rows, every `id = legacy_player_id` | the legacy seeding, as expected |
| Q6c | legacy round table | 194,033 rows, 1984-2025, **44,478 votes** | — |
| Q10a | the 7 unresolved **winner** rows | Haydn Bunton 1931/1932/1935, Wilfred Smallhorn 1933, Denis Ryan 1936, Alan Ruthven 1950, Kevin Murray 1969 | all pre-1984 |

**Production `afldb_prod` (Q0 guard: `current_database() = afldb_prod`, same minute).**

| Q | Measure | Result |
|---|---|---|
| Q7 | target bridge | **13,275** profile paths → 13,275 players, **0 duplicate paths** |
| Q7b | other identities | `draftguru` 5 resolved / 1 unmatched explicit decisions, 5,051 unmatched — irrelevant to this bridge |
| Q8 | the defect | `brownlow_season_votes` **0**; `brownlow_round_votes` 320,861 rows / **44,478 votes** (identical vote total to the legacy round table); `player_season_stats` `complete` rows **0**, `not_applicable` seasons **129** (every season 1897-2025), `pending` 1 (2026); `player_career_stats.brownlow_votes` sum **0**; players 13,277 |
| Q8b | witness shape 1984-2025 | 24,675 `(season, player)` pairs, **8,570 polling pairs**, 44,478 votes |
| Q8c | operator witnesses by path | `players/H/Harley_Reid.html` → 5481 (10), `players/M/Matt_Rowell.html` → 9239 (89), `players/T/Tom_Green1.html` → 12550 (73) — note the disambiguating `1` suffix in the path |
| Q9 | privileges | `afldb_import` INSERT **t**, TRUNCATE **t** on the season table; TRUNCATE on the round table also **t** (so the code, not the grant, is the boundary); registered in `import_writable_tables` **t** |

**Q8 confirms §3.2 literally**: production currently asserts `not_applicable` ("no medal that
season") for all 129 seasons, including the 98 decided ones.

**Identity-gap sizing (Q10b/Q10c, `python3` on the host over two read-only CSV exports that
were deleted afterwards).** The 174 unresolved legacy players matched against canonical
production players by normalised name, requiring the canonical career span to contain the
legacy polling span:

| Bucket | Players | Rows | Votes | Winners |
|---|---|---|---|---|
| exactly one name match, span-compatible | **164** | 512 | 2,379 | all 5 (7 rows) |
| several name matches, exactly one span-compatible | **8** | 11 | 24 | — |
| several span-compatible candidates | **2** | 2 | 4 | — |
| no name match at all | **0** | 0 | 0 | — |

Every single-candidate match has a profile path in production (0 without). DOB could not
corroborate (legacy DOB unknown for all 172 — the legacy source's 93 % DOB gap). The two
multi-candidate cases:

| Legacy | Polling | Candidates | Resolution |
|---|---|---|---|
| 1367 Michael Kennedy | 1989, 1 vote | 9534 `Michael_Kennedy0.html` (1988-1990) · 9535 `Michael_Kennedy1.html` (1984-1990) | **Settled by the round-vote witness (Q11)**: 9534 polled 1 vote in 1989, 9535 polled 0 → **9534** |
| 10924 Peter Brown | 1978, 3 votes | 10476 `Peter_Brown3.html` (1977-1980, 44 games) · 10478 `Peter_Brown5.html` (1976-1982, 55 games) (four others fail the span) | **Operator adjudication required** — pre-1984, no witness; the AFL Tables 1978 Brownlow page names the club |

**Q11b witness proof for the largest 1984+ gap player.** Legacy David Bain (1989-1992, 36 votes)
→ canonical 3469 `players/D/David_Bain.html`, whose round votes are 11 + 15 + 4 + 6 = **36**.
The name+span match and the independent witness agree.

Cross-benefit noted, not scope: at least ten of ISSUE-112's nineteen "no rebuild-stable identity"
players (Kevin Murray, Garry Wilson, Haydn Bunton, Wilfred Smallhorn, Ron Alexander, David Bain,
Frank Curcio, Owen Abrahams, Matthew Rendell, Bob Beecroft) are in this 174; the adjudication file
below resolves them by profile path, which ISSUE-112's census could then adopt.

### 8.12 Identity adjudication — how the 174 are handled without a name rule in the loader

The loader (§8.6) still resolves **only** by profile path and never by name. The 174 legacy
players with no path in the recovery database get their path from a **tracked, reviewed
adjudication file**, `data/brownlow/player-identity.csv` — the same shape and rule as
`data/awards/player-identity.csv`: `bootstrap_player_id, display_name, afltables_profile_url,
evidence`, where `evidence` is one of `round_vote_witness` (1984+, proven by Q11-style sums),
`unique_name_span` (pre-1984, exactly one canonical candidate whose career contains the polling
span), or `operator` (Peter Brown 1978). The artefact builder writes the adjudicated path into
`season-votes.csv` for those rows; a DB-free test asserts that every artefact row whose bootstrap
id is in the adjudication file carries exactly that path, and that no artefact row has an empty
path. Acceptance stays at **zero rejections**; V5 (round-vote witness) additionally proves every
1984+ adjudicated row landed on the footballer who actually polled.

Second bridge **not needed**: no unresolved player lacks a canonical name match, so the retired
SQLite `afltables_player_index` is not reopened.

### 8.13 Exact next action (revised 2026-09-04 after measurement)

1. **Operator decisions** (three, all small):
   a. Peter Brown 1978 → `Peter_Brown3.html` (10476) or `Peter_Brown5.html` (10478), from the
      AFL Tables 1978 Brownlow page's club column.
   b. Provenance source key for the loaded rows: recommended **`afltables`** (§8.6 item 5).
   c. Authorise the **read-only export** (§8.8 `\copy`, from `afldb_prod_auth_recovery`, owner
      role, read-only session) and the commit of the ~16k-row tracked artefact plus manifest.
2. **Implementation session** (fresh; carry-over: this file §8): build `data/brownlow/
   season-votes.csv` + `season-votes.manifest.json` + `player-identity.csv` (174 rows, 173
   evidenced from §8.11, one from decision 1a); write `tools/migration/import_brownlow_season.py`;
   add the `brownlow-season` stage and Stage-9 fingerprints (16,120 / 79,113 / 112 / 98); retire
   the legacy `brownlow` group; re-arm the §8.2 gates; run V1-V13 on `afldb_test` via a full
   `db:test:rebuild`.
3. **Production remediation** only after step 2 is green, under the §8.6 sequence and the
   operator's deploy control. `afldb_prod_auth_recovery` must survive until the export is taken
   and V1 is verified against it.

### 8.14 Implementation stage 2026-09-04 — export taken, artefact built, loader/stage/gates written; ONE IDENTITY STOP CONDITION and ONE ENVIRONMENT BLOCKER; nothing committed

Worktree `D:\dev\afldb-issue-113`, branch `claude/issue-113`, base `f11037a`. Operator decisions
received at session start: **Peter Brown 1978 → canonical `10476` `players/P/Peter_Brown3.html`
(career 1977-1980)**; **provenance source key `afltables`**; the read-only export from
`afldb_prod_auth_recovery` and the commit of the artefact, manifest and adjudication file
**authorised**. Mid-session the operator additionally (a) excluded `streamanator` / `afldb_dev`
from this issue entirely, (b) authorised read-only queries of `afldb_prod` **only** for the
canonical witness data the persisted V5/V6/identity checks need, (c) required all
implementation and full-rebuild validation to run against the repository-standard `afldb_test`
with no substitute database, and (d) required an immediate stop on any identity or contract
mismatch. All four were followed.

#### 8.14.1 Export — RUN, read-only, verified

One script (`scp` to `/home/arm`, run by path, deleted afterwards; staged under `/tmp/b113`,
removed). Both sessions ran under `PGOPTIONS='-c default_transaction_read_only=on'` plus an
explicit `BEGIN; SET TRANSACTION READ ONLY; … ROLLBACK;`; each printed its guard
(`current_database()`, `afldb_owner`, `default_transaction_read_only = on`). No DSN was printed
or copied. Extraction timestamp **2026-09-03T15:39:41Z** (01:39:41 +10 on the host), PostgreSQL
16.15.

| File (source) | Rows | SHA-256 |
|---|---|---|
| `recovery-season-votes-export.csv` (`afldb_prod_auth_recovery`, the §8.8 `\copy`, verbatim in the manifest's `export_sql`) | 16,120 | `256d9507f874879b100ea11a999d2b4374f4da1a66f517a92d21058384224bb0` |
| `recovery-gap-players.csv` (the 174 players with no profile path, with legacy career span) | 174 | `c3b800ed68e670c90abeb400c8e068dc895f4532fdd4cb3d3a70e49ebf7e0dac` |
| `recovery-headline.csv` (Q1 re-run) | 1 | `496f123db81c2eb5ea60f1e00ac31916dd17b5a8e6ec38bc792d3ea2615e854c` |
| `prod-canonical-players.csv` (`afldb_prod`, every player with a unique/resolved profile path + `player_season_stats` span) | 13,275 | `bde3949229f261b5f595ab13d73b5a7be34b4c4c51912ada3ff7ef85d987bb83` |
| `prod-round-vote-witness.csv` (`afldb_prod`, per `(season, player_id)` sums where votes > 0) | 8,570 | `03b839b9ac76f56a78170a0cbd45a44105f75c685fa38906516428bc549f453e` |
| `prod-brownlow-winner-witness.csv` (`afldb_prod`, `awards.slug = 'brownlow-medal'` winners, 1980-2025) | 53 | `e8caa7b053687e71b4cdd6d14ae3281270d59f11b20fa026721cc52b9894a44c` |
| `/home/arm/afldb_prod_pre_rebuild_20260902-200355.dump` (the dump the recovery database was restored from) | — | `80eccdff2de90d726bd2249b24d1e51d9fad872f60cc85281477cd8cc94c27e5` |

Headline re-run on the recovery database: **16,120 / 79,113 / 112 / 98 / 4,275 players /
1924-2025**, NULL `eligible_rank` **3**, NULL `polling_games` **4,928**, NULL `vote_rank` 0,
NULL `games` 0 — §8.11 reproduced exactly. Additional NULLs the export exposes and the artefact
preserves: `three_vote_games` 10,589, `two_vote_games` 10,568, `one_vote_games` 9,003.
`link_status_value` unique 15,058 / resolved 1,062. The recovery database was not mutated; the
ISSUE-126 hold stays in place (the export is taken but **not yet verified by V1** — §8.14.5).

#### 8.14.2 Identity adjudication — reproduced and written

Recomputed from the exports (normalised name, canonical `player_season_stats` span must contain
the legacy polling span): **164** single name match / span-compatible, **8** several names with
exactly one span-compatible, **2** several span-compatible, **0** no match — identical to §8.11.
All **20** players with any 1984+ polling season pass the round-vote witness (every polling
season's `sum(brownlow_round_votes.votes)` equals the legacy row) on exactly one candidate;
Michael Kennedy 1989 → `9534` `Michael_Kennedy0.html` by that witness. Peter Brown 1978 →
`Peter_Brown3.html` by operator decision.

`data/brownlow/player-identity.csv` — 174 rows, header `bootstrap_player_id, display_name,
afltables_profile_url, evidence`, strictly ascending ids, 174 distinct paths; evidence
`unique_name_span` 153 / `round_vote_witness` 20 / `operator` 1. SHA-256
`99f6c2537ac80b6f2aa76e6736b6c55306f7cfaf9ae96602e2cc744c178922da`.

#### 8.14.3 Artefact and manifest — built, self-validating

`tools/migration/build_brownlow_season_artefact.py` (new, DB-free) filled the 525 empty paths
from the adjudication file (refusing any surplus/missing id or a path already carried by a
bridged player), re-sorted to `(season, afltables_profile_url)`, and wrote
`data/brownlow/season-votes.csv` (16,121 lines incl. header, LF, SHA-256
`076de3912c6669cf9792ef82f926a78596c8520af687803b3bdbd49725cff732`) and
`data/brownlow/season-votes.manifest.json` (source host/database/role/PostgreSQL version,
`read_only: true`, dump filename + SHA-256, extraction timestamp, exact `export_sql`, export
row count + SHA-256, identity file SHA-256 / 174 players / 525 rows / evidence counts, artefact
SHA-256, columns, rows 16,120, votes 79,113, winners 112, seasons 98, players 4,275,
first/last 1924/2025, `season_coverage` `[[1924,1941],[1946,2025]]`, per-column NULL counts,
3 ineligible rows, link-status counts). `.gitattributes` forces LF for `data/brownlow/*` and
`.gitignore` opts the three files in (`/data/*` had ignored the directory).

`import_brownlow_season.py --validate-only` → `ok: true` with those exact figures.

#### 8.14.4 Implementation — written, unit-tested, NOT database-validated

| File | Change |
|---|---|
| `tools/migration/import_brownlow_season.py` | **new** dedicated loader per §8.6: strict artefact/manifest/adjudication parsing (`--validate-only`, JSON); DB coverage check (`stat_availability` `brownlow_season_total = complete` must equal the manifest's `season_coverage`; no in-progress season); `ProfileResolver` (profile path → exactly one `players.id` via `external_identities`, never a name, never the bootstrap id); every rejection recorded, **any rejection → no write** (transaction rolled back, batch `failed`); `TRUNCATE ONLY brownlow_season_votes` then `COPY` in `(season, player_id)` order; `source_id = afltables`, `source_record_id = brownlow-season:<season>:<path>`, `link_status_value` carried, `club_id` NULL; post-write measurement must equal the manifest (rows/votes/winners/seasons/players and the NULL `eligible_rank`/`polling_games` counts) and `brownlow_round_votes` count must be unchanged, else rollback; `AFLDB_IMPORT_DATABASE_URL` only |
| `tools/migration/build_brownlow_season_artefact.py` | **new** builder (§8.14.3) |
| `tools/migration/import_legacy_afl.py` | legacy `brownlow` group removed from `GROUPS`, `DEFAULT_ORDER`, `GROUP_TABLES`, the dispatch and the dry-run table list; `import_brownlow()` deleted (a comment marks the retirement); final `analyze()` no longer names the season table. The `coverage` group's `import_brownlow_availability()` is untouched (out of scope) |
| `tools/db/rebuild-test.ts` | `brownlow-season` data stage between `awards-honours` and `derived` (`[python, tools/migration/import_brownlow_season.py]`, import DSN only); preflight requires the three tracked files and a passing `--validate-only`; `brownlowSeasonExpected()` reads the manifest at plan time (refuses if missing/malformed); `brownlowSeasonChecks()` Stage-9 gates `brownlow_season_rows`, `_votes_total`, `_winners`, `_seasons`, `_first_season`, `_last_season`, `_rows_not_sourced_from_afltables = 0`, `_rows_not_keyed_by_profile_path = 0`, `_after_accepted_last_season = 0` |
| `tests/db-test-rebuild.test.ts` | stage-order and data-stage pins extended (13 stages, 7 data); new `brownlow season` stage/preflight tests and `brownlow season gates` tests |
| `tests/brownlow-season-artefact.test.ts` | **new** DB-free suite: header/LF, 16,120 / 79,113 / 112 / 98 / 4,275, no 1942-1945 or 2026 row, no empty path, no target id, NULL counts, ordering/uniqueness, ≥1 winner per season, 174 adjudications by evidence, Peter Brown → `Peter_Brown3.html`, Kennedy → `Michael_Kennedy0.html`, adjudicated rows carry exactly their path (525), witnesses Reid 10 / Rowell 89 / Green (`Tom_Green1.html`) 73 / Reynolds 154 / Skilton 180 + 3 medals, manifest provenance, loader CLI validation green and a tampered copy refused |
| `tests/integration/release-gates.test.ts` | re-armed: season total 79,113; career = 79,113 with per-game **structurally** `< 79,113` (the legacy 46,979 is not re-pinned — the canonical per-game column is fitzRoy-sourced and must be re-measured); season-grain cannot inflate; representative totals resolved **by profile path** (Reynolds 154, Skilton 180 + 3 medals, Reid 10, Rowell 89, Green 73); **new** gate: every career whose first season is ≥ 1984 has `player_career_stats.brownlow_votes` = its round-vote sum (V5 in gate form, 0 mismatches); genuine zero in 2025; 2026 pending. **Still skipped, annotated:** the 269-player cohort + id digest (must be re-measured on `afldb_test`, digest re-taken over profile identity) |
| `tests/integration/database.test.ts` | re-armed: career = authoritative = 79,113; per-game structurally short; Skilton by profile path (180 / 3). **Still skipped, annotated:** the 269 cohort |
| `docs/deployment.md` | §7 reload order gains `import_brownlow_season.py` before `rebuild_derived.py`, with the writer-boundary paragraph |
| `CHANGELOG.md`, `IssuesIndex.md`, `issues.md`, this runbook | bookkeeping |

Evidence: `npx vitest run tests/db-test-rebuild.test.ts tests/brownlow-season-artefact.test.ts`
→ **2 files, 255 tests passed**; `npx tsc --noEmit` → no errors in the changed files. **No
database has executed the loader.** V1-V13 are **not run** (§8.14.6).

#### 8.14.5 STOP CONDITION — identity mismatch in the *bridged* population (new evidence; contradicts §8.11's framing)

**RESOLVED 2026-09-04 by operator adjudication — see §8.15.** The evidence below is retained as written.

An offline pre-check resolved every artefact path against the canonical bridge exported from
`afldb_prod` (13,275 paths; the same accepted snapshot a rebuilt `afldb_test` carries).
**16,106 of 16,120 rows resolve to exactly one canonical player; 14 rows (5 players, 77 votes,
0 winner rows) do not.** These are **bridged** rows — the recovery database's
`external_identities` (the ISSUE-090 register pass) holds a path for them, but that path is
spelt from the legacy display name, not as AFL Tables actually names the profile — so §8.12
never adjudicated them and the builder never touches them. Loaded as-is they are 14 rejections
and the zero-rejection gate goes **red**; §8.11's "4,101 bridged players resolve" was measured
inside the recovery database only, never against the canonical bridge.

| Legacy (bootstrap id, name, link status) | Recovery bridge path | Rows / votes | Canonical candidate (exactly one, span-compatible) |
|---|---|---|---|
| 3597 Archie Roberts (resolved) | `players/A/Archie_Roberts0.html` | 1934: 2 | `733` `players/A/Archie_Roberts.html` (1932-1937, 48 games). `Archie_Roberts1.html` is a 2024- player |
| 2425 Glen Scanlon (resolved) | `players/G/Glenn_Scanlon.html` | 1977: 1 | `5164` `players/G/Glen_Scanlon.html` (1977-1978, 9 games) |
| 2060 Jack Patterson (unique) | `players/J/Jack_Patterson.html` | 1931: 1, 1932: 8, 1935: 3 | `6489` `players/J/Jack_Paterson.html` (1920-1935, 68 games) — spelling variant; no canonical "Patterson" 1931-1935 |
| 2459 Lyall Anderson (resolved) | `players/L/Lyle_Anderson.html` | 1958: 2 | `8970` `players/L/Lyall_Anderson.html` (1957-1959, 24 games) |
| 1830 Stephen Icke (resolved) | `players/S/Steven_Icke.html` | 1976-1984, 8 seasons, 60 votes | `12010` `players/S/Stephen_Icke.html` (1975-1987, 198 games); **1984 round-vote witness: 3 = 3** |

The offline V5/V6 comparison against the prod witness exports did **not** complete: the script
stopped at the first unresolvable path, so no V5/V6 result is claimed here — both are run on
`afldb_test` (§8.7). Per the stage discipline the artefact was **not** altered and no
work-around was applied. **Operator decision required (design change to §8.12):** extend
`data/brownlow/player-identity.csv` to cover these five bridged players with the evidence
classes already defined (`unique_name_span` ×4, `round_vote_witness` for Icke), and let the
builder **override** a bridged path only when an adjudication row exists for that bootstrap id
(today it refuses a surplus id). The loader stays unchanged — it still resolves by path only.
Then rebuild the artefact and manifest (the artefact SHA-256 and `identity` block change; the
counts do not).

#### 8.14.6 BLOCKER — the repository-standard `afldb_test` is not reachable

`.env.example:60` and `tools/db/rebuild-test.ts:186` define the target as
`AFLDB_TEST_DATABASE_URL` (a `*_test` database); the workstation's `.env` points it at
`127.0.0.1:5432/afldb_test`. On this workstation port 5432 has **no listener**: the PostgreSQL 16
installation is client tools only (no service, no data directory, no registry installation
record). `streamanator` (where `afldb_test` historically lives) is excluded from this issue by
operator instruction and was in any case unreachable (port 22 timed out; the workstation's default
route is a WireGuard tunnel). `afldb-prod` holds `afldb_prod`, `afldb_prod_auth_recovery` and
`afldb_restore_test` only, no full-history fitzRoy or DraftGuru snapshot, and the operator
forbade substituting another database. Per instruction the blocker is persisted, not improvised
around. Consequently: the loader has never run against a database; V1-V13, the idempotent rerun,
the round-table-unchanged check, the db-health reconciliation, route/sitemap/Grid-Solver checks,
the per-game and 269-cohort re-measurements, and the full `db:test:rebuild` are all
**outstanding**. `afldb_prod_auth_recovery` therefore **must still not be dropped** (V1 against
it is not yet verified).

#### 8.14.7 Working tree (uncommitted, on `claude/issue-113`)

Nothing was committed: validation is not green (§8.14.5 red, §8.14.6 blocked). Modified:
`.gitattributes`, `.gitignore`, `IssuesIndex.md`, `issues.md`, `issues/open/AFLDB-ISSUE-113.md`,
`CHANGELOG.md`, `docs/deployment.md`, `tests/db-test-rebuild.test.ts`,
`tests/integration/database.test.ts`, `tests/integration/release-gates.test.ts`,
`tools/db/rebuild-test.ts`, `tools/migration/import_legacy_afl.py`. New: `data/brownlow/
season-votes.csv`, `data/brownlow/season-votes.manifest.json`, `data/brownlow/player-identity.csv`,
`tests/brownlow-season-artefact.test.ts`, `tools/migration/build_brownlow_season_artefact.py`,
`tools/migration/import_brownlow_season.py`. The raw exports (§8.14.1) are in the session
scratchpad only; they are reproducible from the recorded SQL and hashes.

#### 8.14.8 Exact next action — SUPERSEDED by §8.15.6 (item 1's adjudication half is done)

1. **Operator**: decide §8.14.5 (recommended: adjudicate the five bridged path variants as
   listed; approve the builder override rule). Provide a reachable repository-standard
   `afldb_test` (a `*_test` database the workstation's `AFLDB_TEST_DATABASE_URL` /
   `AFLDB_TEST_IMPORT_DATABASE_URL` can reach, with `AFLDB_PYTHON` set for the worktree) — or
   say which host is the standard one for this issue.
2. **Next session** (this worktree; carry-over §8.14): apply the five adjudications, rebuild
   artefact + manifest, re-run the DB-free suites; then `npm run db:test:rebuild` (full), V1-V13
   per §8.7 including the idempotent rerun and the `brownlow_round_votes` before/after count;
   re-measure and re-pin the 269 cohort (digest over profile identity) and decide the per-game
   pin; then commit artefact, manifest, adjudication file, implementation, tests and bookkeeping.
3. **Production remediation** only after 2 is green (§8.6 sequence; operator deploy control).

### 8.15 Adjudication stage 2026-09-04 — the five bridged path variants adjudicated; builder override rule implemented; DB-free validation green; `afldb_test` still unreachable

Same worktree and branch as §8.14 (`D:\dev\afldb-issue-113`, `claude/issue-113`, base
`f11037a`), continuing from the uncommitted state in §8.14.7. Operator instruction at session
start: adjudicate the five §8.14.5 players exactly as listed below; implement the builder
override narrowly (recovery path authoritative by default; override only on an explicit row for
that exact legacy player; replacement path from the row; no fuzzy/spelling/span/alias
resolution; unadjudicated mismatch stays a hard failure; preserve the original path in
provenance; positive coverage for all five, at least one negative); rebuild the three artefacts
with the DB-free builder; run the offline validation, the DB-free suites and `tsc`; **no dev
host, no change to `afldb_prod_auth_recovery`, no production writes, no database validation
unless the repository-standard `afldb_test` becomes reachable.** All followed.

#### 8.15.1 Adjudication decision (operator, 2026-09-04)

| Legacy (bootstrap id, name) | Recovery-bridge path (replaced) | Adjudicated path | Canonical player | Rows / votes |
|---|---|---|---|---|
| 3597 Archie Roberts | `players/A/Archie_Roberts0.html` | `players/A/Archie_Roberts.html` | `733` | 1934: 1 / 2 |
| 2425 Glen Scanlon | `players/G/Glenn_Scanlon.html` | `players/G/Glen_Scanlon.html` | `5164` | 1977: 1 / 1 |
| 2060 Jack Patterson | `players/J/Jack_Patterson.html` | `players/J/Jack_Paterson.html` | `6489` | 1931, 1932, 1935: 3 / 12 |
| 2459 Lyall Anderson | `players/L/Lyle_Anderson.html` | `players/L/Lyall_Anderson.html` | `8970` | 1958: 1 / 2 |
| 1830 Stephen Icke | `players/S/Steven_Icke.html` | `players/S/Stephen_Icke.html` | `12010` | 1976-1984 (8 seasons): 8 / 60 |

Evidence class recorded: **`operator`** for all five (the operator adjudicated them by explicit
instruction; the name rule did not match them, so `unique_name_span` would misdescribe the
evidence). The supporting evidence from §8.14.5 (exactly one span-compatible canonical player
each; Icke's 1984 round-vote witness 3 = 3) is retained there. Totals: 14 rows / 77 votes / 0
winner rows. These five rows are **explicit exceptions to recovery-path authority, not a general
identity-matching strategy** — nothing in the builder or loader generalises them.

#### 8.15.2 Mechanism — exactly what was added

* `data/brownlow/player-identity.csv` — header gains a fifth column `recovery_profile_url`.
  Empty for the 174 gap-fill rows (the recovery database had no path). For the five override
  rows it is the exact recovery-bridge path being replaced. 179 rows, still strictly ascending
  on bootstrap id, every adjudicated path and every recovery path claimed at most once.
* `tools/migration/import_brownlow_season.py` — `IdentityAdjudication.recovery_profile_url`
  (`None` = gap fill) and `is_override`; the parser accepts the column, requires a normalised
  path when present, rejects an override that restates its own path, a recovery path overridden
  twice, or a path that is both overridden and adjudicated. `validate_offline` additionally
  requires: no overridden recovery path survives anywhere in the artefact; the manifest's
  `identity.overrides` lists exactly the file's override rows (id, name, original path, new
  path, evidence, row count); `identity.gap_players/gap_rows/override_players/override_rows`
  match. Summary JSON gains `identity_gap_players`, `identity_override_players`,
  `identity_override_rows`. `ProfileResolver.from_pairs()` builds the same fail-closed resolver
  over an in-memory bridge so the rejection rule is testable without a database; production
  still builds from `external_identities` only. Docstring updated.
* `tools/migration/build_brownlow_season_artefact.py` — Rule 1 unchanged (gap-fill rows cover
  exactly the empty-path players). **Rule 2 (new): a non-empty recovery-bridge path is carried
  verbatim unless an override row exists for that exact bootstrap id whose `recovery_profile_url`
  equals, verbatim, every path the export carries for that id.** An override for an id the export
  lacks, or naming a path the export does not carry for it, or a recovery path shared by another
  legacy player, is a hard failure (exit 1, nothing written). Rule 3: no adjudicated path may
  already be carried by a bridged player that is not itself overridden. The manifest records
  `export.rows_with_overridden_profile_path` and `identity.overrides[]` (with `seasons` and
  `votes` per override). No name matching, no spelling correction, no span or alias guessing.
* Loader/database path unchanged: it still resolves every artefact row by profile path only.

#### 8.15.3 Artefacts rebuilt (DB-free, from the same hash-verified export)

Builder run with the §8.14.1 export (SHA-256 `256d9507…` verified before build) and the §8.14.1
provenance arguments. **Counts unchanged:** 16,120 rows / 79,113 votes / 112 winners / 98 seasons
/ 4,275 players / 1924-2025; NULL counts identical (`eligible_rank` 3, `polling_games` 4,928,
`three/two/one_vote_games` 10,589 / 10,568 / 9,003); link status 15,058 / 1,062; 3 ineligible.
Identity: 179 players, 539 adjudicated rows = 525 gap-fill + 14 override; evidence
`unique_name_span` 153 / `round_vote_witness` 20 / `operator` 6.

| File | Lines / rows | SHA-256 (new) | Previous |
|---|---|---|---|
| `data/brownlow/player-identity.csv` | 180 lines / 179 rows | `17b512e48374c12d2f666194aa99c7c713db57643ce5b31cc67f9f8931493c61` | `99f6c253…` (174 rows) |
| `data/brownlow/season-votes.csv` | 16,121 lines / 16,120 rows, LF | `042a8fca776f3c3879585daa6524690d48add5e67f60c3f8dbdf5e5dc5c70059` | `076de391…` |
| `data/brownlow/season-votes.manifest.json` | — | `db44fb8600a12d3f97e0d6fc7fb22960a8c95aebbc2773c1b6d694a54f6565f1` | — |

Only the 14 override rows differ from the previous artefact (path column), plus their re-sorted
positions. Manifest correction noticed and fixed in passing: the previous build's
`source.restored_from_dump` had been mangled by Git Bash path conversion to
`C:/Program Files/Git/home/arm/…`; it now reads `/home/arm/afldb_prod_pre_rebuild_20260902-200355.dump`
(the builder was run with `MSYS_NO_PATHCONV=1`). No other manifest field changed except the
identity block and the hashes.

#### 8.15.4 Validation run (DB-free)

* `python tools/migration/import_brownlow_season.py --validate-only` → `ok: true`, figures above.
* Offline re-run of the §8.14.5 pre-check against the prod canonical bridge witness
  (`prod-canonical-players.csv`, SHA-256 `bde39492…`, re-verified): **16,120 of 16,120 rows
  resolve to exactly one canonical player** (was 16,106); the five map to `733`, `5164`, `6489`,
  `8970`, `12010`; no duplicate `(season, canonical player)` key after the override. All five
  replacement paths are carried by exactly one canonical player and by no other export player;
  none of the five original recovery paths exists canonically.
* `npx vitest run tests/brownlow-season-artefact.test.ts tests/db-test-rebuild.test.ts` →
  **2 files, 267 tests passed** (255 before). New coverage in `tests/brownlow-season-artefact.test.ts`:
  `it.each` over the five adjudications (identity row exact, artefact rows/seasons/votes, original
  path absent, manifest override entry exact); the override list totals (5 / 14 / 77 / 0 winners);
  a builder suite driving `build_brownlow_season_artefact.py` through its CLI on a synthetic
  export — all five applied; **negative: without an adjudication row `Archie_Roberts0.html` is
  carried through unchanged (no correction)**; an override naming a path the export does not
  carry fails hard; an override for an unknown player fails hard; a gap-fill row for a bridged
  player is refused; and a loader suite proving `ProfileResolver` rejects each of the five
  original recovery paths ("no canonical player carries this AFL Tables profile path") while
  resolving each adjudicated path to the intended canonical id. Counts re-pinned (179 / 539 /
  `operator` 6). One latent defect fixed in the same file: the ordering test's key separator was
  a literal NUL byte, which made Git treat the test file as binary; it is now a space.
* `npx tsc --noEmit` → clean.

#### 8.15.5 Working tree (uncommitted, on `claude/issue-113`)

§8.14.7's list, with this session's changes to: `data/brownlow/player-identity.csv`,
`data/brownlow/season-votes.csv`, `data/brownlow/season-votes.manifest.json`,
`tools/migration/import_brownlow_season.py`, `tools/migration/build_brownlow_season_artefact.py`,
`tests/brownlow-season-artefact.test.ts`, `CHANGELOG.md`, `IssuesIndex.md`, `issues.md`, this
runbook. Nothing committed: database validation is still outstanding.

#### 8.15.6 Remaining blocker and exact next action — SUPERSEDED by §8.16 (the blocker cleared; item 2 was run and stopped at V5)

`afldb_test` is still unreachable: a TCP probe of `127.0.0.1:5432` (the workstation's
`AFLDB_TEST_DATABASE_URL` target) timed out this session; §8.14.6 stands in full. Per instruction
nothing database-side was attempted, no substitute database was used, `afldb_prod_auth_recovery`
was not touched, and the ISSUE-126 hold on it remains.

1. **Operator**: provide a reachable repository-standard `afldb_test` (a `*_test` database the
   worktree's `AFLDB_TEST_DATABASE_URL` / `AFLDB_TEST_IMPORT_DATABASE_URL` can reach, with
   `AFLDB_PYTHON` set) — or name the standard host for this issue.
2. **Next session** (this worktree): `npm run db:test:rebuild` (full), V1-V13 per §8.7 including
   the idempotent rerun and the `brownlow_round_votes` before/after count; re-measure and re-pin
   the 269 cohort (digest over profile identity) and decide the per-game pin; then commit the
   artefact, manifest, adjudication file, implementation, tests and bookkeeping.
3. **Production remediation** only after 2 is green (§8.6 sequence; operator deploy control).

### 8.16 Database validation stage 2026-09-04 — full `db:test:rebuild` green; loader executed with zero rejections; V1-V4 and V6-V8 green; **V5 RED on a core identity split outside this issue's writer boundary**; validation stopped, nothing committed

Same worktree and branch (`D:\dev\afldb-issue-113`, `claude/issue-113`, base `f11037a`), continuing
from §8.15.5. Operator instruction at session start: `afldb_test` is now reachable through an SSH
tunnel; resume from §8.15.6; run the full validation; **stop immediately on any red DB validation
and persist exact evidence and next action; do not touch `afldb_dev`; do not mutate `afldb_prod` or
`afldb_prod_auth_recovery`; do not deploy; commit only if everything is green.** All followed.
`afldb_dev`, `afldb_prod` and `afldb_prod_auth_recovery` were not contacted.

#### 8.16.1 Environment actually used (repository-standard target, recorded exactly)

| Item | Value |
|---|---|
| Target | `afldb_test` as `afldb_owner` via `AFLDB_TEST_DATABASE_URL` → `127.0.0.1:55432`, an SSH tunnel to `streamanator:5432` (the historical `afldb_test` host) |
| Import DSN | `AFLDB_TEST_IMPORT_DATABASE_URL` is not present in any repo environment; the rebuild ran with the repository-supported `--allow-owner-import-dsn` fallback (data stages as owner; the `afldb_import` grant check is therefore not exercised — AFLDB-ISSUE-083) |
| Python | `AFLDB_PYTHON=C:/Users/stuar/AppData/Local/Programs/Python/Python312/python.exe` (3.12.10, psycopg 3.3.5; the worktree has no `.venv`) |
| psql | `C:\Program Files\PostgreSQL\16\bin` prepended to `PATH` for the run (client tools only) |
| Sources | `data/sources/` (gitignored) was empty in this worktree. The three accepted snapshots were copied byte-for-byte from `D:\dev\afldb-issue-102\data\sources` (`afltables/fitzroy_core/full-history-20260902`, 131 files; `afltables/fitzroy_core/ladder-20260828`; `draftguru/annual-html-20260902`, 90 files). Every importer re-verified them by SHA-256 against the tracked manifests before use |
| DraftGuru label | `--draftguru-label annual-html-20260902`, exactly as the ISSUE-102/112 closure rebuild (`issues/closed/AFLDB-ISSUE-102-HANDOFF.md:1236`). The default label `annual-html-20260826` does not exist on this workstation (its directory under `D:\dev\afldb` is empty); `annual-html-20260902` is a tracked accepted manifest with identical counts (42 pages / 5,057 persons / 6,810 picks) |

Command (from the worktree root):

```
npm run db:test:rebuild -- --draftguru-label annual-html-20260902 --allow-owner-import-dsn --acknowledge-destroy afldb_test
```

#### 8.16.2 Full rebuild — GREEN (07:52:03 → 08:13:32 AUSEST, exit 0)

All 13 stages ran in the planned order: PRECHECK → RESET → MIGRATIONS → PRIVILEGES → REFERENCE →
FITZROY CORE `full-history-20260902` → DRAFTGURU `annual-html-20260902` → AWARDS & HONOURS →
**BROWNLOW SEASON** → DERIVED → COLEMAN → LADDER WITNESS → FINAL VALIDATION. The preflight ran
`import_brownlow_season.py --validate-only` before destruction (`ok: true`, the §8.15.3 figures).
FINAL VALIDATION: **`PASSED: 47 checks`**, including every new Stage-9 Brownlow gate at its
manifest-derived expectation: `brownlow_season_rows = 16120`, `_votes_total = 79113`,
`_winners = 112`, `_seasons = 98`, `_first_season = 1924`, `_last_season = 2025`,
`_rows_not_sourced_from_afltables = 0`, `_rows_not_keyed_by_profile_path = 0`,
`_after_accepted_last_season = 0`, and `brownlow_round_vote_rows = 320861` unchanged.

Loader stage output (first execution of the loader against any database):

```
artefact      : data/brownlow/season-votes.csv (sha256 042a8fca776f3c38…)
manifest      : 16,120 rows, 79,113 votes, 112 winners, 98 seasons
brownlow_season_votes                 16,120  (79,113 votes, 112 winners, 98 seasons, 4275 players)
brownlow_round_votes                 320,861  (untouched)
completed in 3.0s
```

#### 8.16.3 V1-V13 — measured with psql over the owner DSN (read-only; scripts in the session scratchpad)

| # | Result | Evidence |
|---|---|---|
| V1 | **GREEN** | 16,120 rows / 79,113 votes / 112 winners / 98 seasons / 4,275 players / 1924-2025; NULL counts `eligible_rank` 3, `polling_games` 4,928, `three/two/one_vote_games` 10,589 / 10,568 / 9,003 (= manifest); `link_status_value` unique 15,058 / resolved 1,062; 3 ineligible; `club_id` NULL on all; source `afltables` on all; 0 rows not keyed `brownlow-season:<season>:players/…` |
| V2 | **GREEN** | `import_batches` id 16, tool `import_brownlow_season.py`, target `brownlow_season_votes`, status `completed`, read 16,120 / inserted 16,120 / updated 0 / **rejected 0**, no error |
| V3 | **GREEN** | distinct seasons: 18 in 1924-1941, 80 in 1946-2025; 0 rows in 1942-1945, before 1924 or in 2026 |
| V4 | **GREEN** | `player_season_stats.brownlow_status`: `complete` 48,623 rows over exactly the 98 seasons 1924-2025 with 0 NULL votes; `not_applicable` 9,553 rows over 31 seasons 1897-1945, all NULL; no row contradicts the expected mapping. 2026: `seasons.status = in_progress`, `stat_availability` `brownlow_season_total` = `pending`, 0 season rows — and 0 `matches` / 0 `player_season_stats` rows for 2026 exist in this baseline, so there is no player-season row to carry `pending` (the derivation rule is unchanged and would produce it once 2026 match rows exist) |
| **V5** | **RED** | 1984-2025: 8,560 `(season, player_id)` pairs compared, **0** vote / polling / 3-2-1 mismatches among them; but **10 polled player-seasons have no season row under the same `player_id`, and the same 10 season rows have no round rows** — see §8.16.4 |
| V6 | **GREEN** | ISSUE-112 `award_winners` for `brownlow-medal` covers 1980-2025 (46 seasons, 53 rows, 0 unlinked); within those seasons 0 winner rows missing from `award_winners` and 0 award rows missing from `is_winner` |
| V7 | **GREEN** | by profile path: Reynolds 154 (3 medals), Skilton 180 (3), Reid 10, Rowell 89 (1), Green `Tom_Green1.html` 73; the five §8.15.1 adjudications: Roberts 2, Scanlon 1, Paterson 12, Anderson 2, Icke 60. `sum(player_career_stats.brownlow_votes)` = **79,113**, 4,275 players with votes |
| V8 | **GREEN** | db-health `brownlow votes: player_career_stats vs. brownlow_season_votes` = **0** mismatches; 0 voted players without a career row |
| V9-V12 | **NOT RUN** | stopped at V5 per instruction. Note for V12: `sum(player_season_stats.brownlow_votes)` = **79,079**, not 79,113 — the 34 missing votes are exactly the 10 V5 rows (§8.16.4), so `release-gates.test.ts` "season-grain table cannot inflate the total" and "agrees with the canonical round votes for every career inside their coverage" (players 2604 / 6293: career 0 vs round sums 25 / 9) would fail on this database; the suites were deliberately not executed |
| V13 | **NOT RUN** | pre-rerun snapshot taken: `brownlow_round_votes` 320,861 rows / 44,478 votes; `brownlow_season_votes` 16,120 rows, ids 1-16,120 |
| 269 cohort | measured, **not re-pinned** | `goals BETWEEN 50 AND 199 AND brownlow_votes = 0` → **262** on this database; the count is contaminated by the split identities (§8.16.4) and must be re-measured after they are fixed |
| per-game | measured, **not re-pinned** | `sum(player_match_stats.brownlow_votes)` = **46,970** over 336,821 non-NULL rows (legacy pin was 46,979); the structural `< 79,113` gate is correct as written |

#### 8.16.4 The V5 red — exact rows, mechanism, and why it is outside this issue's boundary

The 10 rows (all 1984-2025, none elsewhere: every other season row in the artefact has match rows
for its player in its season):

| Season | Artefact path → canonical id | Votes | Round votes (same person) under |
|---|---|---|---|
| 2019 | `players/C/Charlie_Cameron3.html` → `2608` | 11 | `2604` `players/C/Charlie_Cameron.html`: 11 |
| 2020 | `Charlie_Cameron3.html` → `2608` | 1 | `2604`: 1 |
| 2021 | `Charlie_Cameron3.html` → `2608` | 1 | `2604`: 1 |
| 2022 | `Charlie_Cameron3.html` → `2608` | 3 | `2604`: 3 |
| 2023 | `Charlie_Cameron3.html` → `2608` | 8 | `2604`: 8 |
| 2024 | `Charlie_Cameron3.html` → `2608` | 1 | `2604`: 1 |
| 2019 | `players/J/Jack_Graham2.html` → `6296` | 1 | `6293` `players/J/Jack_Graham.html`: 1 |
| 2020 | `Jack_Graham2.html` → `6296` | 3 | `6293`: 3 |
| 2021 | `Jack_Graham2.html` → `6296` | 3 | `6293`: 3 |
| 2022 | `Jack_Graham2.html` → `6296` | 2 | `6293`: 2 |

Totals: 25 + 9 = 34 votes — the entire 79,113 − 79,079 gap. Vote values agree exactly with the
round-vote witness in every row; **only the canonical player differs.**

Mechanism (measured on `afldb_test` and in the accepted snapshot, not inferred):

* The canonical core rebuild holds **two players for one person** in each case: `2604` Charlie
  Cameron (`Charlie_Cameron.html`, 229 games, Adelaide 2014-2017 / Brisbane 2018-2024) and `2608`
  Charlie Cameron (`Charlie_Cameron3.html`, 25 games, Brisbane 2025 only); `6293` Jack Graham
  (`Jack_Graham.html`, 131 games, Richmond 2017-2024) and `6296` Jack Graham
  (`Jack_Graham2.html`, 18 games, West Coast 2025 only). All four `external_identities` rows are
  `unique` / `afltables_profile_url`.
* In `data/sources/afltables/fitzroy_core/full-history-20260902/player_stats_2025.csv` the 2025
  rows for these players carry a **blank fitzRoy `ID`** and the renumbered AFL Tables URL,
  whereas their 2014-2024 rows carry `ID` 12277 / 12576 and the base URL. The class is bounded:
  **83 rows with a blank `ID` in 2025, across exactly 5 URLs** — `Charlie_Cameron3.html` (25),
  `Jack_Graham2.html` (18), `Jack_Ross3.html` (23), `Jack_Williams3.html` (13),
  `Billy_Wilson2.html` (4); 2023 and 2024 have 0 blank-`ID` rows. On `afldb_test` the same
  split is visible for Jack Ross (`6521`/`6525`) and Jack Williams (`6622`/`6626`); a fifth
  adjacent-span pair, Harry Jones (`5641` `Harry_Jones1.html` 2020 / `5642` `Harry_Jones2.html`
  2021-2025), has the same shape but was not traced to a blank id. Only Cameron and Graham
  polled Brownlow votes, which is why V5 shows exactly 10 rows.
* The artefact's paths are AFL Tables' **current** paths: the pre-cutover authoritative table
  linked the 2019-2024 season pages to `Charlie_Cameron3.html` / `Jack_Graham2.html`, and the
  same snapshot's 2025 rows carry those same paths. The recovery export, the builder, the
  adjudication file and the loader all behaved as designed (fail-closed by profile path, no name
  matching); the loader resolved each row to the one canonical player that carries that path.
  **The defect is that the fitzRoy core import seeded a second canonical player when AFL Tables
  renumbered a profile URL** — an identity defect of the core rebuild (AFLDB-ISSUE-093 /
  `import_fitzroy_core.py` identity rule), tracked separately as **`AFLDB-ISSUE-136`**. It is
  also present on production, which was cut over from the same accepted baseline: there, Charlie
  Cameron's 229-game career currently carries no Brownlow votes at all (the ISSUE-113 symptom)
  and, once this artefact is loaded unchanged, would carry 0 while the 2025-only shell carries 25.
* Nothing in ISSUE-113 may paper over this: an override row in `player-identity.csv` mapping
  `Charlie_Cameron3.html` back to `Charlie_Cameron.html` would put the votes on the right person
  for 2019-2024 but leave the person split (2025 games, and any 2025 votes, on the shell) and
  would encode a stale path as canonical. The fix belongs in the core identity; once one player
  carries both paths (or the renumbered path becomes the single canonical one), this artefact
  loads correctly with **no change**.

#### 8.16.5 Working tree (uncommitted, on `claude/issue-113`)

§8.15.5's list plus this runbook, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md` (bookkeeping
only — no code, artefact or test changed this session). `data/sources/` is gitignored. **Nothing
committed**: V5 is red, so the operator's commit condition is not met. The DB-free suites and
`tsc` were re-run first and are green (267 tests).

#### 8.16.6 Exact next action — SUPERSEDED by §8.17 (item 2 was run: V5-V11 green, V12 red)

1. **`AFLDB-ISSUE-136`** (core identity): decide and implement how the fitzRoy import treats a
   2025 row with a blank `ID` and a renumbered profile URL for a person already seeded (merge
   into the existing player and register the new path as a second `external_identities` row, or
   re-key the existing player to the current path — the ISSUE-131 rekey pattern is the nearest
   precedent). Verify against live AFL Tables which path is current. That is a separate issue and
   branch; it must not be designed inside ISSUE-113.
2. **Then, this worktree**: `npm run db:test:rebuild` (same command as §8.16.1) and V5-V13 in
   full — expected: V5 0 / 0 / 0, `sum(player_season_stats.brownlow_votes)` = 79,113, then the
   two integration suites, db-health, sitemap/route/Grid-Solver checks, the idempotent rerun with
   the round-table before/after count — then re-pin the cohort and decide the per-game pin, and
   commit.
3. **Operator option (not taken here)**: commit the ISSUE-113 implementation now on the strength
   of §8.16.2-§8.16.3 (rebuild, loader, V1-V4, V6-V8 green; the red is upstream and the artefact
   needs no change), leaving V5/V12/V13 to close after 136. The session's instruction was
   "commit only if all green", so this was not done.
4. Production remediation only after 2 is green (§8.6 sequence; operator deploy control).
   `afldb_prod_auth_recovery` may now be regarded as verified for V1 (this rebuild reproduced the
   §8.11 contract from the tracked artefact), but it should still survive until the artefact is
   committed.

### 8.17 Database validation stage 2 2026-09-04 — ISSUE-136 merged; full rebuild GREEN (48 checks); V1-V11 GREEN with **V5 fixed by ISSUE-136**; **V12 RED on three gates**; validation stopped at V12; nothing committed

Same worktree and branch. `AFLDB-ISSUE-136` was merged into this branch via `main` at `295e054`
(`Merge ISSUE-136 fitzRoy profile continuity`); the ISSUE-113 working tree was stashed and
reapplied, leaving exactly three bookkeeping conflicts, resolved as: `CHANGELOG.md` keeps both
Unreleased entries (ISSUE-136 above ISSUE-113); `IssuesIndex.md` keeps the upstream count of 12
open issues (ISSUE-137 is listed); `issues.md` keeps the upstream Resolved ISSUE-136 entry and
the allocated ISSUE-137 entry and drops this branch's stale "Open" ISSUE-136 draft. ISSUE-137
stays allocated; next free ID remains `AFLDB-ISSUE-138`; no implementation file was touched by
the resolution. Operator instruction: full canonical rebuild of the repository-standard
`afldb_test`, V1-V13, confirm V5 is fixed by ISSUE-136, **stop at first red**; no deploy, no
PROD, no `afldb_dev`, ISSUE-136 worktree untouched. All followed.

#### 8.17.1 Pre-rebuild checks on the merged tree

`tsc --noEmit` clean; `db-test-rebuild`, `brownlow-season-artefact` and `fitzroy-core-import`
suites 376 passed / 4 skipped. `afldb_test` before destruction held ISSUE-136's §13 state
(`players` 13,273; `import_batches` 17 = the failed split-HALT audit row); destroyed by the
rebuild as authorised.

#### 8.17.2 Full rebuild — GREEN (10:06:03 → 10:27:31 AUSEST, exit 0)

Environment and command exactly as §8.16.1. PRECHECK and FITZROY CORE both report `accepted
canonical baseline VERIFIED` (the four `profile_url_continuity` rules applied). 13 stages in the
planned order. Loader stage: `16,120 (79,113 votes, 112 winners, 98 seasons, 4275 players)`,
`brownlow_round_votes 320,861 (untouched)`, 3.1 s. **FINAL VALIDATION PASSED: 48 checks** (47 +
ISSUE-136's `players_with_renumbered_profile = 4`): `players = 13271`, `player_match_rows =
685471`, `brownlow_round_vote_rows = 320861`, and all nine `brownlow_season_*` gates at their
manifest expectation (16120 / 79113 / 112 / 98 / 1924 / 2025 / 0 / 0 / 0).

#### 8.17.3 V1-V13 (psql over the owner DSN, read-only; scripts in the session scratchpad)

| # | Result | Evidence |
|---|---|---|
| V1 | **GREEN** | identical to §8.16.3: 16,120 / 79,113 / 112 / 98 / 4,275 / 1924-2025; NULLs 3 / 4,928 / 10,589 / 10,568 / 9,003; `unique` 15,058 / `resolved` 1,062; 3 ineligible; `club_id` NULL; source `afltables`; 0 rows not keyed by profile path |
| V2 | **GREEN** | batch 16 `import_brownlow_season.py` → `brownlow_season_votes`, `completed`, read 16,120 / inserted 16,120 / updated 0 / **rejected 0** |
| V3 | **GREEN** | 18 seasons in 1924-1941, 80 in 1946-2025, 0 rows outside |
| V4 | **GREEN** | `complete` 48,623 rows over exactly 1924-2025 with 0 NULL votes; `not_applicable` 9,553 rows over 1897-1945 all NULL; no contradicting row; 2026 `in_progress`, `stat_availability` `pending`, 0 season rows (0 `matches` / 0 `player_season_stats` for 2026 in the baseline — see V12(c)) |
| **V5** | **GREEN — fixed by ISSUE-136** | 1984-2025: **8,570** `(season, player_id)` pairs compared (was 8,560 + 10 orphaned), **0** votes / **0** polling / **0** 3-2-1 mismatches, **0** polled player-seasons without a season row, **0** season rows without round rows. Fold proof: exactly four players hold two AFL Tables paths — `2604` Charlie Cameron 254 games / **25** votes, `6292` Jack Graham 149 games / **9** votes, `6519` Jack Ross, `6619` Jack Williams. `sum(player_season_stats.brownlow_votes)` = **79,113** (was 79,079) |
| V6 | **GREEN** | `award_winners` `brownlow-medal` covers 1980-2025 (53 rows, 0 unlinked); the 53 winner rows inside that window all match and 0 award rows lack a winner row; the other 59 winner rows are 1924-1979, outside the award manifest's coverage by design |
| V7 | **GREEN** | by path: Reynolds 154 (3), Skilton 180 (3), Reid 10, Rowell 89 (1), Green `Tom_Green1.html` 73; adjudications Roberts 2, Scanlon 1, Paterson 12, Anderson 2, Icke 60; `sum(player_career_stats.brownlow_votes)` = 79,113 over 4,275 players |
| V8 | **GREEN** | db-health reconciliation 0 mismatches; 0 voted players without a career row |
| V9 | **GREEN** | the `/brownlow/[year]` `getCount` query returns a non-empty list with a winner for every one of the 98 seasons; `getBrownlowCareerLeaders` total 4,275 headed Gary Ablett 262 (2), Patrick Dangerfield 259 (1), Gary Dempsey 246 (1), Sam Mitchell 227, Lachie Neale 225 (2), Scott Pendlebury 225, Robert Harvey 215 (2), Joel Selwood 214, Marcus Bontempelli 213, Dustin Martin 213 (1), Chris Judd 210 (2), Patrick Cripps 205 (2) — the §8.1 1984+ order with the historical totals interleaved; `getBrownlowWinners` 112 rows; `getMultipleBrownlowWinners` 17 players (Bunton, Reynolds, Skilton, Stewart ×3; 13 ×2). Exercised through the real query modules with a temporary vitest file `tests/tmp-issue113-v9v10.test.ts` (3 passed), deleted afterwards |
| V10 | **GREEN** | sitemap route set = 98 seasons = {1924..1941} ∪ {1946..2025} exactly |
| V11 | **GREEN** | `tests/integration/grid-solver.test.ts` 143 passed, including `brownlow_top_finish(1)` against the hand-written count |
| **V12** | **RED — 3 gates** | `release-gates.test.ts` 56 passed / **2 failed** / 8 skipped; `database.test.ts` 44 passed / **1 failed** / 1 skipped. Every Brownlow gate this issue re-armed is green except (c) below; every `Brownlow correctness` describe in `database.test.ts` is green. See §8.17.4 |
| V13 | **NOT RUN** | stopped at V12. Pre-rerun snapshot: `brownlow_round_votes` 320,861 rows / 44,478 votes; `brownlow_season_votes` 16,120 rows, ids 1-16,120. Rerun script prepared (`AFLDB_IMPORT_DATABASE_URL` set explicitly to the owner test DSN; `.env`'s value points at `afldb_dev` and `load_env()` is `setdefault`, so the explicit value wins) |
| 269 cohort | measured, **not re-pinned** | `goals BETWEEN 50 AND 199 AND brownlow_votes = 0` → **261** (262 before the fold); profile-identity digest over the 261 (261 keys) = `ca65f15239aaf0b5` |
| per-game | measured | `sum(player_match_stats.brownlow_votes)` = **46,970** over 336,821 non-NULL rows; the structural `< 79,113` gate stays as written |

#### 8.17.4 The three V12 reds — cause, evidence, boundary

| | Gate | Expected → actual | Cause (measured) | Boundary |
|---|---|---|---|---|
| (a) | `release-gates.test.ts` "gate: birth dates › leaves the remaining players honestly without a date" | 12,422 → **12,418** | `players` = 13,273 = 855 dated + 12,418 `dob IS NULL AND dob_confidence = 'unknown'` (0 other undated). The pin's own comment assumes 855 + 12,422 = 13,277 on the pre-fold baseline. The four renumbered-profile duplicates the ISSUE-136 fold removed were undated 2025-only rows; the four continuing players carry a DOB | **ISSUE-136 consequence** — a legacy pin the fold moved; ISSUE-136's validation ran the DB-free suites and `db-test-rebuild`, not `release-gates.test.ts`. Re-pin to 12,418 with attribution |
| (b) | `database.test.ts` "advanced search regression cases › 200-249 games with 16 or more finals" | 115 → **114** | `2604` Charlie Cameron is now one player with 254 games / 27 finals (229 + 25) and has left the 200-249 band | **ISSUE-136 consequence**; re-pin to 114 with attribution |
| (c) | `release-gates.test.ts` "gate: 2026 is provisional › reports 2026 Brownlow as pending, never as zero" | 1 distinct `(status, votes)` row → **0** | The accepted baseline ends at 2025 (`seasons_last = 2025`, `matches_after_accepted_last_season = 0`): `matches`, `player_match_stats` and `player_season_stats` hold 0 rows for 2026 on every canonical rebuild, so the gate as re-armed by this issue is unsatisfiable on the database it gates (the fact was recorded at V4 in §8.16.3 but not carried into the gate). The season-level facts it wants are present: `stat_availability` `brownlow_season_total` 2026 = `pending`, `seasons.status = in_progress`, 0 season rows for 2026 | **ISSUE-113's own gate design.** Rewrite: assert `stat_availability` (`pending` 2026, `complete` 2025), 0 `brownlow_season_votes` rows for 2026, and that no 2026 `player_season_stats` row carries a non-NULL vote or a status other than `pending` (vacuous on the baseline, binding once a settle populates 2026) — never a row count the baseline cannot produce |

None of the three touches the artefact, the loader, the rebuild stage or any Brownlow figure.

#### 8.17.5 Working tree (uncommitted, on `claude/issue-113`)

§8.16.5's list, now on top of the ISSUE-136 merge, plus the three resolved bookkeeping files
(staged) and this runbook. The temporary V9/V10 test file was deleted. `data/sources/` remains
gitignored. **Nothing committed** (stop at first red). `afldb_test` now holds the green
post-ISSUE-136 canonical rebuild with the loaded season table (batch 16).

#### 8.17.6 Exact next action — DONE (§8.18)

1. **Fix the three V12 gates in place** (this branch carries the ISSUE-136 merge): re-pin (a)
   to 12,418 and (b) to 114 with `AFLDB-ISSUE-136` attribution; rewrite (c) as §8.17.4 says.
   Re-run `npx vitest run tests/integration/release-gates.test.ts tests/integration/database.test.ts`
   against the current `afldb_test` — no rebuild is needed; expect 0 failures.
2. **Re-pin the cohort**: un-skip both 269-cohort gates at **261** with the profile-identity
   digest `ca65f15239aaf0b5` (261 keys), taken as the 1960s-debut gate does; record 46,970 as
   the measured per-game sum in the comment and keep the structural `< 79,113` invariant.
3. **V13**: rerun `tools/migration/import_brownlow_season.py` with `AFLDB_IMPORT_DATABASE_URL`
   set explicitly to the owner test DSN; expect a new `completed` batch with 16,120 read /
   16,120 inserted / 0 rejected, identical counts and content fingerprint, and
   `brownlow_round_votes` still 320,861 rows / 44,478 votes.
4. Then close: resolution in `issues.md`, remove from `IssuesIndex.md` and the Open Issues
   table, `CHANGELOG.md`, move this runbook to `issues/closed/`, commit on `claude/issue-113`.
5. Production remediation only after 4, under operator control and sequenced with
   `AFLDB-ISSUE-137` (§8.6 sequence; the artefact loads correctly only where the four careers
   are one player each). `afldb_prod_auth_recovery` survives until the artefact is committed.

### 8.18 Closure stage 2026-09-04 — three V12 gates fixed and both suites GREEN; cohort re-pinned at 261; V13 idempotence GREEN; **RESOLVED**; committed on `claude/issue-113`

Same worktree, branch and `afldb_test` as §8.17 (no rebuild — the post-ISSUE-136 canonical
rebuild with loader batch 16 was reused as authorised). Operator instruction: fix only the three
V12 gates of §8.17.6, re-run only the two affected suites, stop at first red, re-pin the cohort,
run the prepared V13 rerun, then close and commit; no deploy, no PROD, no `afldb_dev`, no
rebuild, preserved stash not dropped. All followed. No Brownlow artefact row, loader line,
rebuild-stage line, derived rule, ISSUE-136 continuity rule or unrelated gate was changed.

#### 8.18.1 Gate fixes (exactly the three of §8.17.4, plus the cohort of §8.17.6 item 2)

| Gate | File | Change |
|---|---|---|
| (a) players honestly without a date | `tests/integration/release-gates.test.ts` | pin 12,422 → **12,418** with `AFLDB-ISSUE-136` attribution (four undated 2025-only duplicates folded; 855 dated + 12,418 = 13,273) |
| (b) 200-249 games / 16+ finals | `tests/integration/database.test.ts` | pin 115 → **114** with `AFLDB-ISSUE-136` attribution (Charlie Cameron 254 games / 27 finals left the band) |
| (c) 2026 Brownlow pending, never zero | `tests/integration/release-gates.test.ts` | rewritten as §8.17.4 prescribes: `stat_availability.brownlow_season_total` must be exactly `[2025 complete, 2026 pending]`; `seasons.status` 2026 = `in_progress`; 0 `brownlow_season_votes` rows for 2026; 0 `player_season_stats` rows for 2026 with a non-NULL vote or a status other than `pending` (vacuous on the accepted baseline, binding once a settle populates 2026). The gate no longer requires a 2026 `player_season_stats` row, which the accepted canonical contract never produces |
| cohort (release gate) | `tests/integration/release-gates.test.ts` | un-skipped at **261** with the profile-identity digest **`ca65f15239aaf0b5`** over 261 keys, taken exactly as the 1960s-debut gate takes it; the dead `idHash()` helper and its `node:crypto` import removed (that gate was their only consumer) |
| cohort (database suite) | `tests/integration/database.test.ts` | un-skipped at **261** |
| per-game sum | `tests/integration/release-gates.test.ts` | comment records the measured **46,970** (336,821 non-NULL rows); the structural `< 79,113` invariant is unchanged |

#### 8.18.2 V12 rerun — GREEN

`npx vitest run tests/integration/release-gates.test.ts tests/integration/database.test.ts`
against the current `afldb_test`: **2 files passed, 105 passed / 7 skipped / 0 failed**, 16.57 s
(was 100 passed / 3 failed / 9 skipped: the three reds fixed and the two cohort gates re-armed).

#### 8.18.3 V13 loader idempotence rerun — GREEN

`tools/migration/import_brownlow_season.py` rerun with `AFLDB_IMPORT_DATABASE_URL` set
explicitly to the owner `afldb_test` DSN (the wrapper refuses any DSN not ending in
`afldb_test`; `.env`'s value points at `afldb_dev` and was not used). Loader: artefact sha256
`042a8fca776f3c38…` verified against the manifest, `completed in 3.0s`, exit 0.

| Measure | Pre-rerun | Post-rerun |
|---|---|---|
| `brownlow_round_votes` rows / votes / id range | 320,861 / 44,478 / 1-320,861 | **320,861 / 44,478 / 1-320,861** (untouched) |
| `brownlow_round_votes` content fingerprint | `0c45273f93c23e49` | **`0c45273f93c23e49`** |
| `brownlow_season_votes` rows / votes / winners / seasons / players | 16,120 / 79,113 / 112 / 98 / 4,275 | **16,120 / 79,113 / 112 / 98 / 4,275** |
| `brownlow_season_votes` content fingerprint | `59ead6dbdffe23f1` | **`59ead6dbdffe23f1`** |
| `brownlow_season_votes` id range | 1-16,120 | 16,121-32,240 (the loader truncates and reloads the season table only, by design) |
| `sum(brownlow_votes)` season / career / per-game | 79,113 / 79,113 / 46,970 | **79,113 / 79,113 / 46,970** |
| `import_batches` for the loader | batch 16 `completed` 16,120 / 16,120 / 0 rejected | batch 16 unchanged + **batch 18 `completed` read 16,120 / inserted 16,120 / updated 0 / rejected 0**, no error (batch 17 is the rebuild's `import_awards.py` coleman stage) |

No new mismatches, no rejections, no change to any round-grain row.

#### 8.18.4 Resolution

- **Root cause:** `brownlow_season_votes` — authoritative for every career and season Brownlow
  total — had no legacy-free writer after `AFLDB-ISSUE-108` retired the legacy SQLite path, so
  every canonical rebuild (including the 2026-09-02 production cutover) left it empty and the
  derived layer reported decided seasons as `not_applicable` / totals as 0 (§1, §3.2, §8.1).
- **Fix:** a tracked, hash-recorded artefact (`data/brownlow/season-votes.csv` + manifest +
  `player-identity.csv`) exported read-only from the preserved authoritative database, keyed by
  AFL Tables profile path; a fail-closed loader `tools/migration/import_brownlow_season.py`; a
  `brownlow-season` rebuild stage with Stage-9 gates; the legacy `brownlow` group removed from
  `import_legacy_afl.py` (it also truncated the canonically-owned round table); the Brownlow
  release gates re-armed on profile identity (§8.6, §8.14-§8.15, §8.18.1).
- **Validation:** V1-V13 all GREEN on the canonical `db:test:rebuild` of the accepted baseline
  with the ISSUE-136 fold (48 final checks; §8.17.2-§8.17.3, §8.18.2-§8.18.3). DB-free suites
  and `tsc --noEmit` green (§8.17.1).

#### 8.18.5 Follow-up (recorded separately, not part of this closure)

- **Production remediation** is sequenced under `AFLDB-ISSUE-137` (§8.6 sequence): the
  artefact loads correctly only where the four ISSUE-136 careers are one player each, so
  production is repaired first, then the committed loader/artefact is applied, under operator
  control with a pre-change backup. Production still shows the §8.1 symptom until then.
- `afldb_prod_auth_recovery` was to survive until the artefact was committed; it now is. Its
  retirement is an operator decision — retaining it until the production load has been
  validated against §8.11's figures is the conservative choice.
- Cohort and pin history: 269 (legacy) → 262 (pre-fold canonical) → 261 (§8.17.3); any future
  change to 261 / `ca65f15239aaf0b5` is a real identity or goals change, not a re-pin.
