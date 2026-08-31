# AFLDB-ISSUE-093 — Core-import handoff: canonical fitzRoy snapshot → PostgreSQL historical/core importer

For the next fresh bounded implementation session. Read `CLAUDE.md`, this file,
`AFLDB-ISSUE-093.md` (§2, §4, §6.9, §8, §9, §13 incl. §13.4a, §16, §17) and the
ISSUE-092/093 entries in `IssuesIndex.md`/`issues.md`. Do not re-derive Phase 1/2/3
history from chat. Do not implement anything from this file outside that session.

## CURRENT STATE

- `AFLDB-ISSUE-093` is **Open**.
- Phase 1 (static/reference data) COMPLETE — `tests/reference-data.test.ts` 12/12 PASS.
- Phase 2 (fitzRoy acquisition) COMPLETE — `tests/fitzroy-acquisition.test.ts` 13/13
  PASS; pinned fitzRoy 1.8.0; proven `trial-2024` snapshot + manifest.
- Phase 3 non-DB work COMPLETE — five-club canonical club-list wiring
  (`tests/club-list-sources.test.ts` 8/8) and the ISSUE-092 §4 fail-closed
  `external_identities` gate + §5 `--source-key` containment (reusable
  `check_population_drop()` in `tools/migration/common.py`).
- Combined non-DB validation: **33/33 PASS** (user-run 2026-08-25).
- ISSUE-092's DB-backed tests 24–27 (`tests/integration/dob-enrichment-issues.test.ts`)
  remain **pending until a fresh `afldb_test` exists**.
- `afldb_test_pre_rebuild_20260825` remains `ALLOW_CONNECTIONS=false`, reference-only,
  and is NOT an input to the new path.
- **No current `afldb_test` should be assumed to exist.**
- **Zero `AFLDB_LEGACY_SQLITE` dependency is mandatory** for everything on the new
  rebuild path.

## VERIFIED FITZROY CONTRACT (Phase 2, evidence-backed — do not re-verify)

- Pinned **fitzRoy 1.8.0** (`tools/rebuild/fitzroy/fitzroy-contract.json`).
- The canonical `player_stats` snapshot provides: stable `ID`, player name, `DOB`,
  AFL Tables profile `url`, season, round, date, venue, attendance, team context,
  scores (incl. quarter team scores), the 21 match-stat fields, and `Brownlow.Votes`.
- `Brownlow.Votes` is player-per-match grain; **NA != 0**.
- Attendance is repeated at player-match grain and **must be deduplicated by match**.
- `results` provides match/results/round/team/score/venue data (no attendance).
- `player_details` is supplemental only (debut/career span; no DOB/ID/URL).
- `player_match_period_stats` remains **MISSING** (later investigation, §13.7).

## NEXT OBJECTIVE — the historical/core PostgreSQL importer (§13.4a)

The approved runbook's phase list previously jumped from acquisition/club-list work
straight to the DraftGuru adapter, but the rebuild still lacks its essential centre:
the canonical fitzRoy snapshot → normalized PostgreSQL historical/core importer. That
importer is the next bounded implementation step, **before DraftGuru**.

Implement the smallest coherent canonical-snapshot → PostgreSQL core importer covering,
in dependency-safe order:

1. players / player identity
2. venues as required
3. matches/results
4. player_match_stats
5. DOB / `player_birth_evidence` where appropriate
6. AFL Tables `external_identities`
7. Brownlow round votes
8. attendance/provenance

Requirements:

- The importer **consumes the canonical snapshot files/manifests**
  (`data/sources/afltables/fitzroy_core/<label>/` +
  `docs/rebuild-manifests/afltables_fitzroy_core/<label>.json`), never calling live
  fitzRoy directly.
- It preserves existing normalized schema semantics, stable source identities
  (`sources.key`, migration-018 external-identity semantics), NULL-vs-zero rules
  (missing means "not recorded", never 0; `stat-availability.json` is the coverage
  authority), and **ISSUE-092 reconciliation safety** — any `external_identities`
  reconciliation goes through `check_population_drop()`/`--source-key`, not a fresh
  delete path.
- The fresh session may inspect the schema and the current legacy importer
  (`import_legacy_afl.py`, `enrich_birth_dates.py`) **only to understand target
  transformation semantics — never to use the legacy SQLite as data**.

## OUT OF SCOPE for that session

- DraftGuru (draft persons/picks) — it is the **following** phase, after the
  historical/core importer works.
- Awards/honours adapters, `player_match_period_stats`, the `db:test:rebuild`
  orchestrator, release-gate re-baselining, production/dev databases, `CHANGELOG.md`
  (ISSUE-093 remains Open).

User executes all shell/R/Python/SQL/Git commands.
