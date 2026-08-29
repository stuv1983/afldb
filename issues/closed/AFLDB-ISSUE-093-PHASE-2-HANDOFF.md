# AFLDB-ISSUE-093 — Phase 2 handoff: fitzRoy core acquisition/adapter

For a fresh **Fable / Low / Manual** implementation session. Read `CLAUDE.md`, this file,
`AFLDB-ISSUE-093.md` (§4, §5, §8 especially), and the ISSUE-093 entries in
`IssuesIndex.md`/`issues.md`. Do not re-derive Phase-1 history from chat.

## CURRENT STATE

- `AFLDB-ISSUE-093` is **Open**. Phase 1 is **COMPLETE** (2026-08-25), focused validation
  `tests/reference-data.test.ts` **12/12 PASS**.
- The old legacy-built test database is preserved as `afldb_test_pre_rebuild_20260825`
  with `ALLOW_CONNECTIONS = false`. It is **reference-only** — NOT an input to the new
  rebuild path. Do not connect to it or re-enable connections.
- There is currently **no database named `afldb_test`**. Do not rebuild it in Phase 2.
- The new rebuild path has, and must keep, **zero `AFLDB_LEGACY_SQLITE` dependency**.

## PHASE-1 OUTPUTS (contracts Phase 2 can rely on)

- `data/reference/sources.json` — 7 registry rows; loader upserts by `sources.key`.
  **`key` is the durable source-identity contract; numeric `sources.id` is
  database-local** (no repository code uses literal numeric ids).
- `data/reference/seasons.json` — seasons 1897–2026, league eras (VFL ≤1989 / AFL ≥1990),
  in-progress seasons explicit. Measured season columns are NULL until later phases.
- `data/reference/clubs.json` — 24 identities with stable `hist` keys, slugs, spans
  (baseline-verified), succession/organization model, `wikipedia_url`/`afltables_slug`
  for the 18 current identities. `legacy_club_key` is excluded from the new contract.
- `data/reference/stat-definitions.json` — the 24-key final state (21 per-match + 3
  Brownlow grains; no generic `brownlow` key).
- `data/reference/stat-availability.json` — **READY**: 88 compressed ranges, 24 keys ×
  130 seasons = 3,120 cells; NULL-era semantics preserved (1942–1945 Brownlow
  `not_applicable`; other applicable parts of the 1935–1983 match-vote gap
  `not_collected`).
- `data/reference/venue-canonical.json` — 3 hand-curated name expansions, data-only;
  consumed by the venue import that Phase 2's results acquisition feeds.
- `tools/migration/load_reference_data.py` — standalone deterministic/idempotent loader
  (groups: sources, seasons, clubs, coverage; `--print-plan`; fail-closed cascade guard).
- `tests/reference-data.test.ts` — pins the dataset invariants and the loader's
  zero-legacy guarantee.

## PHASE-2 OBJECTIVE

fitzRoy core **source acquisition/adapter**. Against the pinned/current supported fitzRoy
version (per `AFLDB-ISSUE-093.md` §5), verify exactly what the canonical AFL Tables
acquisition (`fetch_player_stats_afltables()` + `fetch_player_details_afltables()` +
results function) supplies for:

- player identity/name;
- player DOB;
- AFL Tables profile URL;
- `player_match_stats`;
- Brownlow match votes;
- matches/results/scores/rounds;
- venues;
- attendance where available.

Prefer **one** canonical acquisition over multiple independent scrapers (§8). Source
acquisition (raw snapshot to `data/sources/...` + tracked manifest per §4) stays
**separate from PostgreSQL import**.

## PHASE-2 CONSTRAINTS

- Zero `AFLDB_LEGACY_SQLITE` use.
- Do not rebuild `afldb_test`; do not use the preserved database as a source.
- Do not implement DraftGuru or awards/honours; do not investigate later phases.
- Do not invent fitzRoy fields or coverage — report unsupported fields/grains explicitly.
- Raw snapshot + manifest/fingerprint policy from `AFLDB-ISSUE-093.md` §4 applies;
  fitzRoy version pin per §5.
- ISSUE-092's fail-closed semantics remain mandatory for whatever importer eventually owns
  `external_identities` reconciliation (§9) — but Phase 2 must not expand into that
  implementation unnecessarily.
- User executes all shell/R/Python/SQL/Git commands; Claude inspects/edits natively.

## PHASE-2 VALIDATION BOUNDARY — stop when

1. actual fitzRoy version/API/schema verified (evidence, not assumption);
2. canonical acquisition/snapshot path implemented for the supported core data;
3. focused acquisition validation/tests added;
4. exact unsupported/missing fields identified and recorded;
5. `AFLDB-ISSUE-093.md` updated with Phase-2 state;
6. ONE user-operated validation command supplied.

Then stop; PostgreSQL import of the acquired core is a later step.
