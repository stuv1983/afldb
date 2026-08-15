#!/usr/bin/env python3
"""Load the parsed AFLW files into the staging_aflw schema.

    python tools/aflw/load_staging.py --check    # no database needed
    python tools/aflw/load_staging.py --load     # TRUNCATE + COPY

The schema itself is src/db/migrations/025_staging_aflw.sql, applied the
normal way with `npm run db:migrate` — not by this script. Grants belong
in a migration, not a script-issued GRANT (see docs/deployment.md §12), so
this tool only ever loads rows into a schema that migration already
created.

--check validates the CSVs against every constraint the migration defines,
without touching a database, so a load can be proven safe from a machine
that has no connection to one. --load requires AFLDB_IMPORT_DATABASE_URL
(read from .env, same as every other importer in tools/migration) and
psycopg.

Loading is a full replace: staging holds one parse of one scrape, and a
re-parse supersedes it entirely. Tables are truncated in dependency order,
then reloaded, inside a single transaction, so a failure leaves the
previous load intact.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_IN = ROOT / "data" / "aflw" / "parsed"

# Load order is dependency order; truncation is the reverse.
TABLES = [
    ("seasons", ["season_key", "ordinal", "calendar_year", "display_label",
                 "first_fixture_date", "last_fixture_date", "fixture_count",
                 "played_count", "ladder_group_count", "has_grand_final"]),
    ("ladders", ["season_key", "conference", "team_code", "team_name_raw",
                 "ladder_rank", "played", "premiership_points", "percentage",
                 "wins", "draws", "losses", "points_for", "points_against",
                 "source_page"]),
    ("fixtures", ["match_key", "season_key", "round_code", "round_number",
                  "round_type", "is_final", "match_date", "match_time",
                  "venue_raw", "home_team_code", "home_team_name_raw",
                  "away_team_code", "away_team_name_raw", "home_goals",
                  "home_behinds", "home_score", "away_goals", "away_behinds",
                  "away_score", "is_played", "fixture_status", "source_page"]),
    ("matches", ["match_key", "season_key", "round_code", "round_number",
                 "round_type", "is_final", "match_date", "match_time",
                 "venue_raw", "weather_raw", "home_team_code",
                 "home_team_name_raw", "away_team_code", "away_team_name_raw",
                 "home_goals", "home_behinds", "home_score", "away_goals",
                 "away_behinds", "away_score", "source_page"]),
    ("player_match_stats", ["match_key", "season_key", "team_code",
                            "player_slug", "player_name_raw", "jumper_number",
                            "position", "kicks", "handballs", "disposals",
                            "contested", "metres_gained", "marks", "hitouts",
                            "tackles", "goals", "behinds", "score_points",
                            "fantasy_points", "source_page"]),
    ("scoring_events", ["match_key", "season_key", "event_seq", "period",
                        "clock", "team_code", "event_type", "player_name_raw",
                        "points", "home_goals", "home_behinds", "away_goals",
                        "away_behinds", "source_page"]),
    ("player_seasons", ["season_key", "player_slug", "player_name_raw",
                        "team_code", "games", "kicks", "handballs",
                        "disposals", "contested", "metres_gained", "marks",
                        "tackles", "hitouts", "fantasy_points", "goals",
                        "behinds", "score_points", "source_page"]),
    ("issues", ["source_page", "kind", "detail"]),
]


def read(in_dir: Path, name: str) -> list[dict]:
    path = in_dir / f"{name}.csv"
    if not path.exists():
        sys.exit(f"ERROR: {path} not found. Run parse_aflw.py first.")
    with path.open(encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def zero(value: str) -> int:
    return int(value) if value not in ("", None) else 0


# A blank in a numeric or date column means NULL. In these two text columns
# it is the value itself: conference is '' in every season except 2020 and
# is part of the ladder primary key, and player_name_raw is '' for the 80%
# of scores whose worm names only the club. Converting either to NULL
# violates NOT NULL and loses the distinction.
BLANK_IS_EMPTY_STRING = {"conference", "player_name_raw"}


# ---------------------------------------------------------------------------
# Constraint pre-flight — mirrors staging_schema.sql exactly
# ---------------------------------------------------------------------------

def check(in_dir: Path) -> int:
    data = {name: read(in_dir, name) for name, _ in TABLES}
    failures: list[str] = []

    def require(label: str, bad: list[str]) -> None:
        if bad:
            failures.append(f"{label}: {len(bad):,} row(s), e.g. {bad[0]}")
            print(f"  FAIL  {label}  ({len(bad):,})")
            for item in bad[:3]:
                print(f"          {item}")
        else:
            print(f"  PASS  {label}")

    def unique(name: str, keys: list[str]) -> None:
        seen: dict[tuple, int] = {}
        bad = []
        for row in data[name]:
            key = tuple(row[k] for k in keys)
            if key in seen:
                bad.append(str(key))
            seen[key] = 1
        require(f"{name} unique on {'+'.join(keys)}", bad)

    def references(child: str, columns: list[str],
                   parent: str, parent_columns: list[str]) -> None:
        allowed = {tuple(r[k] for k in parent_columns) for r in data[parent]}
        bad = [str(tuple(r[k] for k in columns)) for r in data[child]
               if tuple(r[k] for k in columns) not in allowed]
        require(f"{child}.{'+'.join(columns)} -> {parent}", bad)

    print("Primary keys")
    unique("seasons", ["season_key"])
    unique("seasons", ["ordinal"])
    unique("ladders", ["season_key", "conference", "team_code"])
    unique("fixtures", ["match_key"])
    unique("matches", ["match_key"])
    unique("player_match_stats", ["match_key", "player_slug"])
    unique("scoring_events", ["match_key", "event_seq"])
    unique("player_seasons", ["season_key", "player_slug"])

    print("\nForeign keys")
    for table in ("ladders", "fixtures", "matches", "player_match_stats",
                  "scoring_events", "player_seasons"):
        references(table, ["season_key"], "seasons", ["season_key"])
    references("matches", ["match_key"], "fixtures", ["match_key"])
    for table in ("player_match_stats", "scoring_events"):
        references(table, ["match_key"], "matches", ["match_key"])

    print("\nCheck constraints")
    require("fixtures.fixture_status in (played, scheduled, cancelled)",
            [r["match_key"] for r in data["fixtures"]
             if r["fixture_status"] not in ("played", "scheduled", "cancelled")])
    require("fixtures.is_played matches fixture_status",
            [r["match_key"] for r in data["fixtures"]
             if (r["is_played"] == "True") != (r["fixture_status"] == "played")])
    require("fixtures: score present iff played",
            [r["match_key"] for r in data["fixtures"]
             if (r["home_score"] != "") != (r["fixture_status"] == "played")
             or (r["away_score"] != "") != (r["fixture_status"] == "played")])
    require("fixtures.is_final matches round_type",
            [r["match_key"] for r in data["fixtures"]
             if (r["is_final"] == "True") != (r["round_type"] != "home_and_away")])
    require("fixtures: home and away differ",
            [r["match_key"] for r in data["fixtures"]
             if r["home_team_code"] == r["away_team_code"]])
    require("matches: goals*6 + behinds = score",
            [r["match_key"] for r in data["matches"]
             for side in ("home", "away")
             if zero(r[f"{side}_goals"]) * 6 + zero(r[f"{side}_behinds"])
             != zero(r[f"{side}_score"])])
    require("matches: date and venue are present",
            [r["match_key"] for r in data["matches"]
             if not r["match_date"] or not r["venue_raw"]])
    require("player_match_stats: kicks + handballs = disposals",
            [f"{r['match_key']} {r['player_slug']}" for r in data["player_match_stats"]
             if zero(r["kicks"]) + zero(r["handballs"]) != zero(r["disposals"])])
    require("player_match_stats: scoreboard blank together or consistent",
            [f"{r['match_key']} {r['player_slug']}" for r in data["player_match_stats"]
             if (r["goals"] == "") != (r["score_points"] == "")
             or (r["behinds"] == "") != (r["score_points"] == "")
             or (r["goals"] != "" and zero(r["goals"]) * 6 + zero(r["behinds"])
                 != zero(r["score_points"]))])
    require("player_match_stats: required statistics never blank",
            [f"{r['match_key']} {r['player_slug']}" for r in data["player_match_stats"]
             for column in ("kicks", "handballs", "disposals", "contested",
                            "metres_gained", "marks", "hitouts", "tackles",
                            "fantasy_points")
             if r[column] == ""])
    require("scoring_events.event_type in (GOAL, BEHIND, RUSHED BEHIND)",
            [f"{r['match_key']} #{r['event_seq']}" for r in data["scoring_events"]
             if r["event_type"] not in ("GOAL", "BEHIND", "RUSHED BEHIND")])
    require("scoring_events: points match event type",
            [f"{r['match_key']} #{r['event_seq']}" for r in data["scoring_events"]
             if zero(r["points"]) != (6 if r["event_type"] == "GOAL" else 1)])
    require("scoring_events: period between 1 and 4",
            [f"{r['match_key']} #{r['event_seq']}" for r in data["scoring_events"]
             if not 1 <= zero(r["period"]) <= 4])
    require("scoring_events: a rushed behind has no scorer",
            [f"{r['match_key']} #{r['event_seq']}" for r in data["scoring_events"]
             if r["event_type"] == "RUSHED BEHIND" and r["player_name_raw"]])
    require("scoring_events: team_code always present",
            [f"{r['match_key']} #{r['event_seq']}" for r in data["scoring_events"]
             if not r["team_code"]])

    print()
    if failures:
        print(f"{len(failures)} constraint(s) would reject rows. Not safe to load.")
        return 1
    total = sum(len(rows) for rows in data.values())
    print(f"All constraints satisfied. {total:,} rows across "
          f"{len(TABLES)} tables are safe to load.")
    return 0


# ---------------------------------------------------------------------------
# Database load
# ---------------------------------------------------------------------------

def connect():
    # Imported here, not at module scope: tools/migration/common.py imports
    # psycopg on import, and --check must keep working on a machine that has
    # no database driver and no database.
    sys.path.insert(0, str(ROOT / "tools" / "migration"))
    try:
        from common import load_env, require_env
    except ImportError:
        sys.exit("ERROR: psycopg is not installed. "
                 "On the dev server use ~/projects/afldb/.venv/bin/python.")
    load_env()
    import psycopg
    # afldb_import: the role every ETL script writes with (see common.py).
    # Not the owner role — this script never alters schema, only rows.
    return psycopg.connect(require_env("AFLDB_IMPORT_DATABASE_URL"))


def load(conn, in_dir: Path) -> None:
    total = 0
    with conn.cursor() as cur:
        for name, _ in reversed(TABLES):
            cur.execute(f"TRUNCATE staging_aflw.{name} CASCADE")
        for name, columns in TABLES:
            rows = read(in_dir, name)
            target = ", ".join(columns)
            # Postgres TEXT format, not CSV: copy.write_row() emits
            # tab-delimited rows with \N for None regardless of what the
            # statement declares, so declaring CSV makes the server read
            # a whole line as one column.
            statement = f"COPY staging_aflw.{name} ({target}) FROM STDIN"
            with cur.copy(statement) as copy:
                for row in rows:
                    copy.write_row([
                        row[column]
                        if row[column] != "" or column in BLANK_IS_EMPTY_STRING
                        else None
                        for column in columns])
            print(f"  staging_aflw.{name:<22} {len(rows):>7,} rows")
            total += len(rows)
        cur.execute("ANALYZE staging_aflw.player_match_stats")
        cur.execute("ANALYZE staging_aflw.scoring_events")
    print(f"  {'':<22} {total:>7,} rows total")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in", dest="in_dir", type=Path, default=DEFAULT_IN)
    parser.add_argument("--check", action="store_true",
                        help="validate the CSVs against the schema, no database")
    parser.add_argument("--load", action="store_true", help="TRUNCATE + COPY")
    args = parser.parse_args()

    if not (args.check or args.load):
        parser.error("choose at least one of --check, --load")

    # A load always validates first: the constraints are cheap to check in
    # Python and a rejection mid-COPY is far harder to read than this report.
    if check(args.in_dir) != 0:
        return 1
    if not args.load:
        return 0

    print()
    conn = connect()
    try:
        with conn:
            load(conn, args.in_dir)
        print("Committed.")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
