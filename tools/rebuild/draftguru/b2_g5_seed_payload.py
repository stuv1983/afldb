#!/usr/bin/env python3
"""AFLDB-ISSUE-093 Stage B2-1 — G5 final: provenance of the two seed targets' player metadata.

EVIDENCE ONLY. Zero writes.

§42 established that the two zero-game, admin-created linked targets have **no** canonical
graph to reconstruct — their only FK references are `draft_persons`, `draft_picks`,
`player_link_resolutions` and a `player_career_stats` row — but that their `players` rows
carry populated optional metadata. This runner classifies that metadata's provenance so the
smallest durable seed payload can be fixed.

The single question per field: **is this value reproducible from a tracked source, or was it
authored by a human and therefore lost unless the ledger carries it?**

Nothing here is guesswork about what "looks derivable". Each candidate derivation is the
*exact rule from tracked code*, run against the stored value:

  * `given_name` / `surname` / `sort_name` — `createPlayerInTransaction`
    (`src/db/queries/players.ts:299-312`), including its naive last-token split;
  * `search_name` and both slug rules — `import_fitzroy_core.py:947-952` (the rebuild's own
    rule) versus `createPlayerInTransaction:313-316` (the admin rule). They differ on
    apostrophes and accents, so which one a seed uses can change a player-page URL;
  * `birth_year` — `createPlayerInTransaction:320`, the first four characters of `dob`;
  * `height_cm` — compared against the **accepted Stage A** `height_raw` for that person's own
    draft row, passed in from the immutable snapshot.

`player_career_stats` is also checked for material content, because `rebuild_derived.py`
TRUNCATEs and regenerates that table from `player_match_stats` alone — a zero-game player
produces no group and therefore no row.

Egress discipline
-----------------
Booleans, counts and enum vocabulary only. **No names, no dates of birth, no heights, no
weights, no notes text, no surrogate ids.** Every comparison reports whether values agree,
never what they are. `notes` is reduced to a length bucket.

Safety envelope — identical to every other Stage B2 runner: `AFLDB_OWNER_DATABASE_URL` parsed
out of `.env` (never sourced, never printed); DSN path hard-guarded to `/afldb_dev`; the
preserved pre-rebuild database refused by name; `default_transaction_read_only=on` at connect;
`REPEATABLE READ` read-only; in-session verification of database / user / read-only /
isolation; SELECT only; explicit `ROLLBACK` and a safe close on success and failure alike.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlparse

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]

REQUIRED_DB = "afldb_dev"
REQUIRED_PATH = f"/{REQUIRED_DB}"
REFUSED_SUBSTRINGS = ("afldb_test_pre_rebuild",)
ENV_KEY = "AFLDB_OWNER_DATABASE_URL"

EXPECTED_TARGETS = 2

TARGETS = "SELECT id FROM players WHERE legacy_player_id IS NULL"
Q_TARGET_COUNT = "SELECT count(*) FROM players WHERE legacy_player_id IS NULL"


# The admin split rule, transcribed from src/db/queries/players.ts:302-310.
SPLIT_GIVEN = ("CASE WHEN array_length(regexp_split_to_array(btrim(p.display_name), '\\s+'), 1) > 1 "
               "THEN array_to_string((regexp_split_to_array(btrim(p.display_name), '\\s+'))"
               "[1:array_length(regexp_split_to_array(btrim(p.display_name), '\\s+'), 1) - 1], ' ') "
               "ELSE NULL END")
SPLIT_SURNAME = ("(regexp_split_to_array(btrim(p.display_name), '\\s+'))"
                 "[array_length(regexp_split_to_array(btrim(p.display_name), '\\s+'), 1)]")

# The two competing slug rules.
SLUG_REBUILD = "regexp_replace(afldb_normalise_name(p.display_name), '\\s+', '-', 'g')"
SLUG_ADMIN = ("btrim(regexp_replace(lower(p.display_name), '[^a-z0-9]+', '-', 'g'), '-')")


Q_FIELDS = f"""
SELECT
  count(*)                                                          AS targets,

  -- name payload: reproducible from display_name by the tracked admin rule?
  count(*) FILTER (WHERE p.given_name IS NOT DISTINCT FROM {SPLIT_GIVEN})
                                                                    AS given_name_reproduced,
  count(*) FILTER (WHERE p.surname IS NOT DISTINCT FROM {SPLIT_SURNAME})
                                                                    AS surname_reproduced,
  count(*) FILTER (WHERE p.sort_name = p.surname || ', ' || p.given_name)
                                                                    AS sort_name_is_surname_given,
  count(*) FILTER (WHERE p.sort_name = p.display_name)              AS sort_name_is_display_name,

  -- derived search/URL columns
  count(*) FILTER (WHERE p.search_name = afldb_normalise_name(p.display_name))
                                                                    AS search_name_reproduced,
  count(*) FILTER (WHERE p.slug = {SLUG_REBUILD})                   AS slug_matches_rebuild_rule,
  count(*) FILTER (WHERE p.slug = {SLUG_ADMIN})                     AS slug_matches_admin_rule,

  -- birth information
  count(*) FILTER (WHERE p.birth_year = extract(year FROM p.dob)::int)
                                                                    AS birth_year_from_dob,
  count(*) FILTER (WHERE p.birth_year_min IS NOT NULL
                     AND p.birth_year_min = p.birth_year)           AS birth_year_min_equals_year,
  count(*) FILTER (WHERE p.birth_year_max IS NOT NULL
                     AND p.birth_year_max = p.birth_year)           AS birth_year_max_equals_year,
  count(*) FILTER (WHERE p.dob_disputed)                            AS dob_disputed_true,
  count(*) FILTER (WHERE p.dob_evidence_id IS NOT NULL)             AS dob_has_evidence_row,

  -- notes: bucket only, never the text
  count(*) FILTER (WHERE length(btrim(p.notes)) = 0)                AS notes_empty,
  count(*) FILTER (WHERE length(btrim(p.notes)) BETWEEN 1 AND 120)  AS notes_short,
  count(*) FILTER (WHERE length(btrim(p.notes)) > 120)              AS notes_long
FROM players p
WHERE p.legacy_player_id IS NULL
"""

Q_CONFIDENCE_VOCAB = """
SELECT p.dob_confidence::text        AS dob_confidence,
       p.birth_year_confidence::text AS birth_year_confidence,
       count(*)                      AS targets
FROM players p
WHERE p.legacy_player_id IS NULL
GROUP BY 1, 2 ORDER BY 3 DESC
"""

# Is the stored height the DraftGuru draft-day height? Stage A is passed in from the accepted
# immutable snapshot; only agreement counts are reported, never a measurement.
Q_HEIGHT = """
WITH stage_a(player_url, height_cm) AS (
  SELECT * FROM unnest(%s::text[], %s::int[])
), t AS (
  SELECT p.id, p.height_cm AS player_height, p.weight_kg,
         dpk.height_cm AS pick_height, dpk.weight_kg AS pick_weight,
         sa.height_cm  AS stage_a_height
  FROM players p
  JOIN draft_picks dpk ON dpk.player_id = p.id
  LEFT JOIN stage_a sa ON sa.player_url = dpk.player_url
  WHERE p.legacy_player_id IS NULL
)
SELECT count(*)                                                     AS target_pick_rows,
       count(*) FILTER (WHERE player_height IS NOT NULL)            AS players_height_present,
       count(*) FILTER (WHERE pick_height IS NOT NULL)              AS pick_height_present,
       count(*) FILTER (WHERE stage_a_height IS NOT NULL)           AS stage_a_height_present,
       count(*) FILTER (WHERE player_height = pick_height)          AS player_height_eq_pick,
       count(*) FILTER (WHERE player_height = stage_a_height)       AS player_height_eq_stage_a,
       count(*) FILTER (WHERE weight_kg IS NOT NULL)                AS players_weight_present,
       count(*) FILTER (WHERE pick_weight IS NOT NULL)              AS pick_weight_present
FROM t
"""

# Does either career-stats row hold anything material? A zero-game player's row is created by
# createPlayerInTransaction and removed by the next rebuild_derived.py run.
Q_CAREER = """
SELECT count(*)                                                     AS rows_present,
       count(*) FILTER (WHERE COALESCE(games,0) <> 0
                          OR COALESCE(goals,0) <> 0
                          OR COALESCE(finals,0) <> 0
                          OR COALESCE(premierships,0) <> 0
                          OR COALESCE(wins,0) <> 0
                          OR COALESCE(draws,0) <> 0
                          OR COALESCE(losses,0) <> 0
                          OR COALESCE(brownlow_votes,0) <> 0
                          OR COALESCE(brownlow_medals,0) <> 0
                          OR COALESCE(clubs_played,0) <> 0
                          OR COALESCE(seasons_played,0) <> 0)       AS rows_with_material_state,
       count(*) FILTER (WHERE debut_season IS NOT NULL
                          OR final_season IS NOT NULL
                          OR debut_date IS NOT NULL
                          OR last_match_date IS NOT NULL)           AS rows_with_career_span
FROM player_career_stats
WHERE player_id IN (SELECT id FROM players WHERE legacy_player_id IS NULL)
"""

# Sanity: the targets really do have no match rows, so rebuild_derived.py drops their row.
Q_MATCH_ROWS = """
SELECT count(*) AS player_match_stats_rows
FROM player_match_stats
WHERE player_id IN (SELECT id FROM players WHERE legacy_player_id IS NULL)
"""


def read_dsn() -> str:
    """Parse the owner DSN out of .env. The file is never sourced and never printed."""
    env_path = REPO_ROOT / ".env"
    if not env_path.is_file():
        raise SystemExit(f"REFUSED: {env_path} not found")
    for raw in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if line.startswith(f"{ENV_KEY}="):
            dsn = line[len(ENV_KEY) + 1:].strip().strip('"').strip("'")
            break
    else:
        raise SystemExit(f"REFUSED: {ENV_KEY} is not set in .env")
    parsed = urlparse(dsn)
    if parsed.path != REQUIRED_PATH:
        raise SystemExit(f"REFUSED: {ENV_KEY} does not target {REQUIRED_PATH}")
    if any(bad in dsn for bad in REFUSED_SUBSTRINGS):
        raise SystemExit("REFUSED: DSN names a preserved pre-rebuild database")
    return dsn


def load_stage_a_heights(label: str) -> tuple[list[str], list[int | None]]:
    """(player_url, height_cm) from the accepted, immutable Stage A snapshot."""
    path = REPO_ROOT / "data" / "sources" / "draftguru" / label / "parsed" / "rows.jsonl"
    if not path.is_file():
        raise SystemExit(f"REFUSED: missing Stage A parsed rows {path}")
    seen: dict[str, int | None] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        raw = record.get("height_raw") or ""
        digits = "".join(ch for ch in raw if ch.isdigit())
        seen.setdefault(record["player_url"], int(digits) if digits else None)
    urls = list(seen)
    return urls, [seen[u] for u in urls]


def section(title: str) -> None:
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


def table(rows, headers) -> None:
    if not rows:
        print("  (none)")
        return
    widths = [max(len(str(h)), max(len(str(r[i])) for r in rows)) for i, h in enumerate(headers)]
    print("  " + "  ".join(str(h).ljust(w) for h, w in zip(headers, widths)))
    print("  " + "  ".join("-" * w for w in widths))
    for row in rows:
        print("  " + "  ".join(str(v).ljust(w) for v, w in zip(row, widths)))


def named(cur, sql, params=None):
    cur.execute(sql, params)
    row = cur.fetchone()
    return list(zip([d.name for d in cur.description], row))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--label", default="annual-html-20260826",
                        help="accepted Stage A snapshot label (read-only, immutable)")
    args = parser.parse_args(argv)

    import psycopg

    urls, heights = load_stage_a_heights(args.label)
    print(f"Stage A oracle: {len(urls)} distinct player_url, "
          f"{sum(1 for h in heights if h is not None)} with a height")

    dsn = read_dsn()
    conn = psycopg.connect(dsn, options="-c default_transaction_read_only=on")
    try:
        conn.read_only = True
        conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        with conn.cursor() as cur:
            cur.execute("SELECT current_database(), current_user, "
                        "current_setting('transaction_read_only'), "
                        "current_setting('default_transaction_read_only'), "
                        "current_setting('transaction_isolation')")
            db, usr, txn_ro, default_ro, iso = cur.fetchone()
            section("SAFETY IDENTITY")
            print(f"  db={db}  user={usr}  txn_ro={txn_ro}  default_ro={default_ro}  isolation={iso}")
            if db != REQUIRED_DB:
                raise SystemExit(f"REFUSED: connected to {db!r}, not {REQUIRED_DB!r}")
            if txn_ro != "on" or default_ro != "on":
                raise SystemExit("REFUSED: transaction is not read-only")
            if not iso.startswith("repeatable"):
                raise SystemExit(f"REFUSED: isolation is {iso!r}")

            cur.execute(Q_TARGET_COUNT)
            n = cur.fetchone()[0]
            print(f"\n  admin-created target players: {n}")
            if n != EXPECTED_TARGETS:
                raise SystemExit(
                    f"REFUSED: expected exactly {EXPECTED_TARGETS} admin-created players "
                    f"(§42.1), found {n}. Scope has changed; review before continuing.")

            # ---- G5-F ----------------------------------------------------
            section("G5-F — is each stored value reproducible from a tracked rule?")
            print("  Every candidate below is the EXACT rule from tracked code, not a guess.\n")
            for name, value in named(cur, Q_FIELDS):
                print(f"  {name:<32} {value} / {n}" if name != "targets" else
                      f"  {name:<32} {value}")
            print("\n  confidence vocabulary (enum categories — safe to print):")
            cur.execute(Q_CONFIDENCE_VOCAB)
            table(cur.fetchall(), ["dob_confidence", "birth_year_confidence", "targets"])

            section("G5-F — height / weight provenance against accepted Stage A")
            for name, value in named(cur, Q_HEIGHT, (urls, heights)):
                print(f"  {name:<32} {value}")
            print("\n  players.height_cm == the Stage A draft-day height would make height")
            print("  class A (reproducible). Anything else makes it human-authored payload.")
            print("  Stage A carries NO weight field at all, so weight_kg can only be class C.")

            # ---- G5-G ----------------------------------------------------
            section("G5-G — player_career_stats materiality")
            for name, value in named(cur, Q_CAREER):
                print(f"  {name:<32} {value}")
            for name, value in named(cur, Q_MATCH_ROWS):
                print(f"  {name:<32} {value}")
            print("\n  rebuild_derived.py TRUNCATEs player_career_stats and repopulates it by")
            print("  GROUP BY player_id over player_match_stats (:243-297). A player with zero")
            print("  match rows produces no group, so the next derived pass REMOVES this row.")
            print("  If rows_with_material_state > 0, something other than the admin seed wrote")
            print("  it — HALT and review.")
    finally:
        try:
            conn.rollback()
        finally:
            conn.close()

    print("\nROLLBACK completed — nothing was written.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
