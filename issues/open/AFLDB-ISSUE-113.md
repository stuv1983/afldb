# AFLDB-ISSUE-113 — Replace legacy `brownlow_season_votes` acquisition

**Status: Open. Design only. NOT implemented. Replacement source UNDECIDED.**
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
