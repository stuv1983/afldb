#!/usr/bin/env python3
"""AFLDB-ISSUE-368: behavioural contract for the AFLW staging replacement.

    python tests/python/aflw_staging_contract.py

No database, no psycopg, no network. Drives the real write_generation(),
check(), verify(), load() and main() of tools/aflw/load_staging.py over
temporary directories and a recording stand-in for the connection.

The invariant: a replacement that is not one complete, unaltered parser
generation is refused before anything can be truncated, and --load copies
exactly the rows that were verified.

Exit 0 = every scenario holds. Exit 1 = a scenario failed, and it says which.
"""

from __future__ import annotations

import contextlib
import copy
import io
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "aflw"))

import load_staging as ls  # noqa: E402

failures: list[str] = []
passed = 0


def expect(label: str, condition: bool, detail: str = "") -> None:
    global passed
    if condition:
        passed += 1
        print(f"  ok    {label}")
    else:
        failures.append(label)
        print(f"  FAIL  {label}{': ' + detail if detail else ''}")


def quiet(fn, *args, **kwargs):
    """Run fn with its report captured; return (result, output)."""
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        result = fn(*args, **kwargs)
    return result, buffer.getvalue()


COLUMNS = dict(ls.TABLES)


def row(table: str, **values) -> dict:
    return {column: str(values.get(column, "")) for column in COLUMNS[table]}


def dataset() -> dict[str, list[dict]]:
    """The smallest complete AFLW generation: one season, one played match."""
    played = dict(match_key="2099-1-aaa-bbb", season_key="2099", round_code="1",
                  round_number=1, round_type="home_and_away", is_final="False",
                  match_date="2099-02-01", venue_raw="Oval", home_team_code="aaa",
                  home_team_name_raw="A", away_team_code="bbb", away_team_name_raw="B",
                  home_goals=2, home_behinds=1, home_score=13, away_goals=1,
                  away_behinds=0, away_score=6, source_page="game__1.html")
    return {
        "seasons": [row("seasons", season_key="2099", ordinal=1, calendar_year=2099,
                        display_label="2099", first_fixture_date="2099-02-01",
                        last_fixture_date="2099-02-08", fixture_count=2,
                        played_count=1, ladder_group_count=1, has_grand_final="False")],
        "ladders": [row("ladders", season_key="2099", team_code=code, team_name_raw=code,
                        ladder_rank=rank, played=1, premiership_points=pts,
                        percentage=100, wins=pts // 4, draws=0, losses=1 - pts // 4,
                        points_for=13, points_against=6, source_page="season__2099.html")
                    for rank, code, pts in ((1, "aaa", 4), (2, "bbb", 0))],
        "fixtures": [
            row("fixtures", **played, is_played="True", fixture_status="played"),
            row("fixtures", match_key="2099-2-bbb-aaa", season_key="2099", round_code="2",
                round_number=2, round_type="home_and_away", is_final="False",
                match_date="2099-02-08", venue_raw="Oval", home_team_code="bbb",
                home_team_name_raw="B", away_team_code="aaa", away_team_name_raw="A",
                is_played="False", fixture_status="scheduled",
                source_page="season__2099.html"),
        ],
        "matches": [row("matches", **played)],
        "player_match_stats": [
            row("player_match_stats", match_key="2099-1-aaa-bbb", season_key="2099",
                team_code=team, player_slug=slug, player_name_raw=slug, kicks=3,
                handballs=2, disposals=5, contested=1, metres_gained=10, marks=1,
                hitouts=0, tackles=1, goals=goals, behinds=behinds,
                score_points=goals * 6 + behinds, fantasy_points=20,
                source_page="game__1.html")
            for team, slug, goals, behinds in (("aaa", "Ann_A", 2, 1), ("bbb", "Bea_B", 1, 0))],
        "scoring_events": [row("scoring_events", match_key="2099-1-aaa-bbb",
                               season_key="2099", event_seq=1, period=1, clock="1m",
                               team_code="aaa", event_type="GOAL", points=6,
                               home_goals=1, home_behinds=0, away_goals=0,
                               away_behinds=0, source_page="game__1.html")],
        "player_seasons": [row("player_seasons", season_key="2099", player_slug=slug,
                               player_name_raw=slug, team_code=team, games=1)
                           for team, slug in (("aaa", "Ann_A"), ("bbb", "Bea_B"))],
        "issues": [],
    }


def write(directory: Path, tables: dict[str, list[dict]]) -> None:
    quiet(ls.write_generation, directory, tables, {})


def check(directory: Path) -> int:
    return quiet(ls.check, directory)[0]


class RecordingConnection:
    """Stands in for psycopg: records every statement and copied row."""

    def __init__(self) -> None:
        self.statements: list[str] = []
        self.copied: dict[str, list[list]] = {}

    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement: str) -> None:
        self.statements.append(statement)

    @contextlib.contextmanager
    def copy(self, statement: str):
        table = statement.split()[1].split(".")[1]
        rows = self.copied.setdefault(table, [])

        class Writer:
            def write_row(self, values):
                rows.append(list(values))

        yield Writer()


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)

        print("1. The closeout review's header-only input")
        d = base / "header-only-legacy"
        d.mkdir()
        for name, columns in ls.TABLES:
            (d / f"{name}.csv").write_text(",".join(columns) + "\n", encoding="utf-8")
        result, output = quiet(ls.check, d)
        expect("header-only files without a manifest are refused", result == 1)
        expect("the refusal names the missing manifest", "manifest.json not found" in output)

        print("2. A header-only generation with a valid manifest")
        d = base / "header-only"
        write(d, {})
        manifest = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
        expect("the parser writes all eight tables and the manifest",
               sorted(manifest["tables"]) == sorted(COLUMNS)
               and all((d / f"{name}.csv").is_file() for name in COLUMNS))
        result, output = quiet(ls.check, d)
        expect("an all-empty replacement is refused", result == 1)
        expect("the refusal is the completeness check",
               "FAIL  every table except issues has rows" in output)

        print("3. A complete generation")
        d = base / "valid"
        write(d, dataset())
        data, output = quiet(ls.verify, d)
        expect("a complete generation passes", data[0] is not None, output[-400:])
        expect("zero parser issues are allowed", data[0] is not None and data[0]["issues"] == [])

        print("4. Missing or incomplete core input")
        for name in ("seasons", "fixtures", "matches", "player_match_stats"):
            d = base / f"omit-{name}"
            write(d, dataset())
            (d / f"{name}.csv").unlink()
            expect(f"an omitted {name}.csv is refused", check(d) == 1)
        for name in ("ladders", "scoring_events", "player_seasons"):
            tables = dataset()
            tables[name] = []
            d = base / f"empty-{name}"
            write(d, tables)
            expect(f"an empty {name} table is refused", check(d) == 1)
        tables = dataset()
        tables["matches"] = []
        tables["player_match_stats"] = []
        tables["scoring_events"] = [r for r in tables["scoring_events"] if False]
        d = base / "played-without-match"
        write(d, tables)
        result, output = quiet(ls.check, d)
        expect("a played fixture without its match is refused",
               result == 1 and "FAIL  every played fixture has its match" in output)
        tables = dataset()
        tables["player_match_stats"] = tables["player_match_stats"][:1]
        tables["player_seasons"] = tables["player_seasons"][:1]
        d = base / "one-side"
        write(d, tables)
        result, output = quiet(ls.check, d)
        expect("a match with one side's statistics is refused",
               result == 1 and "both teams" in output)
        tables = dataset()
        tables["seasons"][0]["fixture_count"] = "3"
        d = base / "count-mismatch"
        write(d, tables)
        expect("season counts that disagree with the fixtures are refused", check(d) == 1)

        print("5. Stale and mixed generations")
        d = base / "reused"
        tables = dataset()
        tables["issues"] = [row("issues", source_page="season__2099.html",
                                kind="fixture_never_played", detail="old")]
        write(d, tables)
        old_issues = (d / "issues.csv").read_bytes()
        write(d, dataset())
        data, _ = quiet(ls.verify, d)
        expect("a newer run with zero issues replaces the older issues.csv",
               data[0] is not None and data[0]["issues"] == [])
        (d / "issues.csv").write_bytes(old_issues)
        expect("an older optional file restored beside the manifest is refused", check(d) == 1)
        write(d, dataset())
        manifest = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
        del manifest["tables"]["issues"]
        (d / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        expect("a manifest missing a table is refused", check(d) == 1)
        write(d, dataset())
        manifest = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
        manifest["tables"]["fixtures"]["rows"] = 5
        (d / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        expect("a row count that disagrees with the manifest is refused", check(d) == 1)
        write(d, dataset())
        text = (d / "seasons.csv").read_text(encoding="utf-8").replace("ordinal", "ordinal_x")
        (d / "seasons.csv").write_text(text, encoding="utf-8")
        expect("an altered file is refused", check(d) == 1)

        print("6. An interrupted parser run")
        d = base / "interrupted"
        write(d, dataset())
        broken = dataset()
        broken["matches"][0]["unexpected"] = "x"
        try:
            quiet(ls.write_generation, d, broken, {})
            raised = False
        except ValueError:
            raised = True
        expect("the bad write raises", raised)
        expect("the previous manifest is gone", not (d / "manifest.json").exists())
        expect("the half-written directory is refused", check(d) == 1)

        print("7. The load copies the verified rows, not the files")
        d = base / "toctou"
        write(d, dataset())
        (data, _), _ = quiet(ls.verify, d)
        verified = copy.deepcopy(data)
        (d / "matches.csv").write_text("changed after validation\n", encoding="utf-8")
        connection = RecordingConnection()
        quiet(ls.load, connection, data)
        expect("every table is truncated, children first",
               [s.split(".")[1].split()[0] for s in connection.statements[:8]]
               == [name for name, _ in reversed(ls.TABLES)])
        copied_matches = connection.copied.get("matches", [])
        expect("the copied match is the verified one",
               copied_matches == [[verified["matches"][0][c] or None
                                   for c in COLUMNS["matches"]]])
        expect("the changed file is refused on the next check", check(d) == 1)
        try:
            ls.load(RecordingConnection(), {"seasons": []})
            raised = False
        except ValueError:
            raised = True
        expect("load refuses an incomplete row set before any statement", raised)

        print("8. --load never connects for a refused generation")
        d = base / "refused-load"
        write(d, {})
        calls = []
        original_connect, original_argv = ls.connect, sys.argv
        ls.connect = lambda: calls.append("connect")
        sys.argv = ["load_staging.py", "--in", str(d), "--load"]
        try:
            result, _ = quiet(ls.main)
        finally:
            ls.connect, sys.argv = original_connect, original_argv
        expect("--load on an empty generation exits 1", result == 1)
        expect("the database is never contacted", calls == [])

        print("9. Sealing a pre-manifest parse")
        legacy = base / "legacy"
        write(legacy, dataset())
        (legacy / "manifest.json").unlink()
        expect("the unsealed parse is refused", check(legacy) == 1)
        sys.argv = ["load_staging.py", "--in", str(legacy), "--seal"]
        try:
            result, _ = quiet(ls.main)
        finally:
            sys.argv = original_argv
        expect("a complete parse seals", result == 0 and check(legacy) == 0)
        empty_legacy = base / "legacy-empty"
        shutil.copytree(base / "header-only-legacy", empty_legacy)
        sys.argv = ["load_staging.py", "--in", str(empty_legacy), "--seal"]
        try:
            result, _ = quiet(ls.main)
        finally:
            sys.argv = original_argv
        expect("an empty parse does not seal",
               result == 1 and not (empty_legacy / "manifest.json").exists())

    print()
    if failures:
        print(f"{len(failures)} of {passed + len(failures)} AFLW staging checks FAILED:")
        for label in failures:
            print(f"  - {label}")
        return 1
    print(f"All {passed} AFLW staging generation checks hold.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
