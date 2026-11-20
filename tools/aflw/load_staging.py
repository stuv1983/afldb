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

The input is one parser generation (AFLDB-ISSUE-368). parse_aflw.py writes
every table's CSV, including header-only ones, then manifest.json last with
each file's SHA-256 and row count. Both modes refuse a directory without a
manifest, a missing or altered file, a header that does not match the
schema, and a replacement that is not a complete AFLW dataset: every table
except the parser's issue list must have rows, and the seasons, fixtures,
matches and player statistics must agree with one another. Each file is
read once, and --load copies exactly the rows that were verified, so a file
changed after the check cannot reach the database. A refusal happens before
the database connection is opened, so it never truncates anything.

A directory written by the parser before the manifest existed can be sealed
once with --seal, which runs the same checks and writes the manifest only if
they pass. Seal only a directory that holds the output of one parser run.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
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


MANIFEST = "manifest.json"
MANIFEST_FORMAT = "afldb-aflw-parsed/1"

# The parser's issue list is legitimately empty for a clean scrape. Every
# other table must carry rows: a replacement without seasons, ladders,
# fixtures, played matches, player statistics, scoring events or player
# seasons is not an AFLW dataset, and loading it would empty the public views.
OPTIONAL_EMPTY = {"issues"}


def _csv_bytes(header: list[str], rows: list[dict]) -> bytes:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=header)
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue().encode("utf-8")


def _write_atomic(path: Path, payload: bytes) -> None:
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    with temporary.open("wb") as fh:
        fh.write(payload)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(temporary, path)


def _write_manifest(out_dir: Path, entries: dict[str, dict]) -> None:
    manifest = {"format": MANIFEST_FORMAT, "tables": entries}
    text = json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    _write_atomic(out_dir / MANIFEST, text.encode("utf-8"))


def write_generation(out_dir: Path, tables: dict[str, list[dict]],
                     headers: dict[str, list[str]]) -> None:
    """Write one complete parser generation: every table, then the manifest.

    The previous manifest is removed first, so a run that fails part-way
    leaves a directory both modes refuse instead of a mix of generations.
    A table with no rows is still written, header only, so no file from an
    earlier run can survive into this generation.
    """
    unknown = sorted(set(tables) - {name for name, _ in TABLES})
    if unknown:
        raise ValueError(f"unknown AFLW table(s): {', '.join(unknown)}")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / MANIFEST).unlink(missing_ok=True)
    entries: dict[str, dict] = {}
    for name, columns in TABLES:
        rows = tables.get(name, [])
        payload = _csv_bytes(headers.get(name, columns), rows)
        _write_atomic(out_dir / f"{name}.csv", payload)
        entries[name] = {"file": f"{name}.csv", "rows": len(rows),
                         "sha256": hashlib.sha256(payload).hexdigest()}
        print(f"  {name + '.csv':28s} {len(rows):>7,} rows")
    _write_manifest(out_dir, entries)


def read_generation(in_dir: Path, sealing: bool = False
                    ) -> tuple[dict[str, list[dict]] | None, dict[str, str], list[str]]:
    """Read each CSV once and verify it against the manifest.

    Returns the parsed rows (the only rows --load ever copies), each file's
    SHA-256, and the refusals. The rows are None when anything is refused.
    sealing=True skips the manifest comparison for --seal.
    """
    refusals: list[str] = []
    expected = {name for name, _ in TABLES}
    entries: dict = {}
    if not sealing:
        manifest_path = in_dir / MANIFEST
        if not manifest_path.is_file():
            return None, {}, [
                f"{manifest_path} not found: the directory is not one complete parser "
                "generation. Run parse_aflw.py, or --seal a single pre-manifest parse."]
        try:
            manifest = json.loads(manifest_path.read_bytes().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            return None, {}, [f"{manifest_path} is not valid JSON: {error}"]
        if (not isinstance(manifest, dict)
                or manifest.get("format") != MANIFEST_FORMAT
                or not isinstance(manifest.get("tables"), dict)):
            return None, {}, [f"{manifest_path} is not an {MANIFEST_FORMAT} manifest"]
        entries = manifest["tables"]
        if set(entries) != expected:
            refusals.append(
                "manifest tables differ from the schema (missing "
                f"{sorted(expected - set(entries)) or 'none'}, unexpected "
                f"{sorted(set(entries) - expected) or 'none'})")

    data: dict[str, list[dict]] = {}
    digests: dict[str, str] = {}
    for name, columns in TABLES:
        path = in_dir / f"{name}.csv"
        if not path.is_file():
            refusals.append(f"{path} not found")
            continue
        payload = path.read_bytes()
        digests[name] = hashlib.sha256(payload).hexdigest()
        entry = entries.get(name)
        if not sealing:
            if not isinstance(entry, dict):
                continue
            if entry.get("file") != f"{name}.csv" or entry.get("sha256") != digests[name]:
                refusals.append(f"{name}.csv does not match its manifest checksum "
                                "(changed, stale or from another generation)")
                continue
        try:
            text = payload.decode("utf-8")
        except UnicodeDecodeError as error:
            refusals.append(f"{name}.csv is not UTF-8: {error}")
            continue
        reader = csv.DictReader(io.StringIO(text, newline=""))
        header = list(reader.fieldnames or [])
        if len(header) != len(set(header)) or set(header) != set(columns):
            refusals.append(f"{name}.csv header {header} does not match the "
                            f"schema columns {columns}")
            continue
        rows = list(reader)
        if any(None in row or None in row.values() for row in rows):
            refusals.append(f"{name}.csv has a row whose field count differs from its header")
            continue
        if not sealing and entry.get("rows") != len(rows):
            refusals.append(f"{name}.csv has {len(rows):,} rows; the manifest "
                            f"records {entry.get('rows')}")
            continue
        data[name] = rows
    if refusals:
        return None, digests, refusals
    return data, digests, []


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
    """Exit-code form of verify(): 0 only for a complete, loadable generation."""
    return 0 if verify(in_dir)[0] is not None else 1


def verify(in_dir: Path, sealing: bool = False
           ) -> tuple[dict[str, list[dict]] | None, dict[str, str]]:
    """Verify one generation. Returns its rows only if every check passes."""
    print("Generation")
    data, digests, refusals = read_generation(in_dir, sealing=sealing)
    if data is None:
        for refusal in refusals:
            print(f"  FAIL  {refusal}")
        print(f"\n{len(refusals)} input check(s) failed. Not safe to load; "
              "nothing was loaded.")
        return None, digests
    print(f"  PASS  {len(TABLES)} files read once"
          + ("" if sealing else " and matched to the manifest"))
    if constraint_failures(data):
        return None, digests
    return data, digests


def constraint_failures(data: dict[str, list[dict]]) -> int:
    """Print the constraint report and return how many checks failed."""
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

    print("\nCompleteness")
    require("every table except issues has rows",
            [name for name, _ in TABLES
             if name not in OPTIONAL_EMPTY and not data[name]])
    fixtures_by_season: dict[str, int] = {}
    played_by_season: dict[str, int] = {}
    for row in data["fixtures"]:
        key = row["season_key"]
        fixtures_by_season[key] = fixtures_by_season.get(key, 0) + 1
        if row["fixture_status"] == "played":
            played_by_season[key] = played_by_season.get(key, 0) + 1

    def counted(value: str) -> int | None:
        try:
            return int(value)
        except ValueError:
            return None

    require("every season has fixtures, and its fixture and played counts match them",
            [f"{r['season_key']} records {r['fixture_count']}/{r['played_count']}, "
             f"fixtures give {fixtures_by_season.get(r['season_key'], 0)}/"
             f"{played_by_season.get(r['season_key'], 0)}"
             for r in data["seasons"]
             if not fixtures_by_season.get(r["season_key"])
             or counted(r["fixture_count"]) != fixtures_by_season.get(r["season_key"], 0)
             or counted(r["played_count"]) != played_by_season.get(r["season_key"], 0)])
    match_keys = {r["match_key"] for r in data["matches"]}
    played_keys = {r["match_key"] for r in data["fixtures"]
                   if r["fixture_status"] == "played"}
    require("every played fixture has its match",
            sorted(played_keys - match_keys))
    require("every match is a played fixture",
            sorted(match_keys - played_keys))
    sides = {(r["match_key"], r["team_code"]) for r in data["player_match_stats"]}
    require("every match has player statistics for both teams",
            [f"{r['match_key']} {r[side + '_team_code']}" for r in data["matches"]
             for side in ("home", "away")
             if (r["match_key"], r[side + "_team_code"]) not in sides])

    print()
    if failures:
        print(f"{len(failures)} check(s) would reject this replacement. "
              "Not safe to load; nothing was loaded.")
        return len(failures)
    total = sum(len(rows) for rows in data.values())
    print(f"All checks satisfied. {total:,} rows across "
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


def load(conn, data: dict[str, list[dict]]) -> None:
    """Replace staging with verified rows. The caller owns the transaction.

    Takes the rows verify() returned, never a path: the bytes that were
    checked are the bytes that are copied (AFLDB-ISSUE-368).
    """
    missing = [name for name, _ in TABLES if name not in data]
    if missing:
        raise ValueError(f"unverified generation, missing {missing}")
    total = 0
    with conn.cursor() as cur:
        for name, _ in reversed(TABLES):
            cur.execute(f"TRUNCATE staging_aflw.{name} CASCADE")
        for name, columns in TABLES:
            rows = data[name]
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
    parser.add_argument("--seal", action="store_true",
                        help="check a pre-manifest parse and write its manifest")
    args = parser.parse_args()

    if args.seal and (args.check or args.load):
        parser.error("--seal runs alone")
    if not (args.check or args.load or args.seal):
        parser.error("choose one of --check, --load, --seal")

    if args.seal:
        if (args.in_dir / MANIFEST).exists():
            print(f"ERROR: {args.in_dir / MANIFEST} already exists; nothing to seal.")
            return 1
        data, digests = verify(args.in_dir, sealing=True)
        if data is None:
            return 1
        _write_manifest(args.in_dir, {
            name: {"file": f"{name}.csv", "rows": len(data[name]),
                   "sha256": digests[name]}
            for name, _ in TABLES})
        print(f"Sealed {args.in_dir / MANIFEST}.")
        return 0

    # A load always validates first and copies only what it validated. A
    # refusal returns here, before the database is contacted.
    data, _ = verify(args.in_dir)
    if data is None:
        return 1
    if not args.load:
        return 0

    print()
    conn = connect()
    try:
        with conn:
            load(conn, data)
        print("Committed.")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
