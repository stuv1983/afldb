#!/usr/bin/env python3
"""Validate the AFLDB migration against the legacy database.

    python tools/validation/validate_migration.py
    python tools/validation/validate_migration.py --json report.json

Row counts alone are not evidence. This compares aggregate totals,
per-player career figures, referential integrity, NULL semantics and the
exact player-ID sets returned by the Advanced Search regression cases.

Where AFLDB deliberately differs from the legacy database, the check
asserts the corrected value and says why. Expected results are never
adjusted just to make a check pass.

Exit code 0 = all checks passed, 1 = at least one failure.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "migration"))

import psycopg  # noqa: E402

from common import connect_legacy, connect_pg, load_env, require_env  # noqa: E402

GREEN, RED, YELLOW, DIM, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


@dataclass
class Results:
    passed: int = 0
    failed: int = 0
    notes: list[str] = field(default_factory=list)
    failures: list[dict] = field(default_factory=list)

    def check(self, name: str, actual, expected, detail: str = "") -> bool:
        ok = actual == expected
        if ok:
            self.passed += 1
            mark, colour = "PASS", GREEN
        else:
            self.failed += 1
            mark, colour = "FAIL", RED
            self.failures.append(
                {"check": name, "expected": expected, "actual": actual, "detail": detail}
            )
        line = f"  {colour}{mark}{RESET}  {name:<52}"
        if ok:
            line += f" {actual!r}" if not isinstance(actual, int) else f" {actual:,}"
        else:
            line += f" expected {expected!r}, got {actual!r}"
        print(line)
        if detail and not ok:
            print(f"        {DIM}{detail}{RESET}")
        return ok

    def note(self, message: str) -> None:
        self.notes.append(message)
        print(f"  {YELLOW}NOTE{RESET}  {message}")


def section(title: str) -> None:
    print(f"\n{title}\n{'-' * len(title)}")


def id_hash(ids: list[int]) -> str:
    return hashlib.sha256(",".join(map(str, sorted(ids))).encode()).hexdigest()[:16]


def pg_ids(pg: psycopg.Connection, sql: str) -> list[int]:
    with pg.cursor() as cur:
        cur.execute(sql)
        return sorted(r[0] for r in cur.fetchall())


def pg_one(pg: psycopg.Connection, sql: str):
    with pg.cursor() as cur:
        cur.execute(sql)
        row = cur.fetchone()
        return row[0] if row else None


def lite_one(lite: sqlite3.Connection, sql: str):
    row = lite.execute(sql).fetchone()
    return row[0] if row else None


# ---------------------------------------------------------------------------


def validate_counts(pg, lite, r: Results) -> None:
    section("1. Row counts (AFLDB vs legacy)")
    for label, pg_sql, lite_sql in [
        ("players", "SELECT count(*) FROM players", "SELECT COUNT(*) FROM players"),
        ("matches", "SELECT count(*) FROM matches", "SELECT COUNT(*) FROM matches"),
        ("player_match_stats", "SELECT count(*) FROM player_match_stats",
         "SELECT COUNT(*) FROM games"),
        ("brownlow_season_votes", "SELECT count(*) FROM brownlow_season_votes",
         "SELECT COUNT(*) FROM brownlow_results WHERE player_id IS NOT NULL"),
        ("club_seasons", "SELECT count(*) FROM club_seasons",
         "SELECT COUNT(*) FROM team_seasons"),
        ("venues", "SELECT count(*) FROM venues", "SELECT COUNT(DISTINCT venue) FROM games"),
        ("clubs (historical identities)", "SELECT count(*) FROM clubs",
         "SELECT COUNT(DISTINCT club_hist) FROM games"),
        ("seasons", "SELECT count(*) FROM seasons",
         "SELECT COUNT(DISTINCT season) FROM games"),
    ]:
        r.check(label, pg_one(pg, pg_sql), lite_one(lite, lite_sql))


def validate_aggregates(pg, lite, r: Results) -> None:
    section("2. Aggregate totals")
    r.check("sum of career games",
            pg_one(pg, "SELECT sum(games) FROM player_career_stats"),
            lite_one(lite, "SELECT SUM(career_games) FROM players"))
    r.check("sum of goals (player_match_stats)",
            pg_one(pg, "SELECT sum(goals) FROM player_match_stats"),
            lite_one(lite, "SELECT CAST(SUM(goals) AS INT) FROM games"))
    r.check("sum of career goals",
            pg_one(pg, "SELECT sum(goals) FROM player_career_stats"),
            lite_one(lite, "SELECT CAST(SUM(career_goals) AS INT) FROM players"))
    r.check("sum of finals played",
            pg_one(pg, "SELECT sum(finals) FROM player_career_stats"),
            lite_one(lite, "SELECT SUM(finals_played) FROM players"))
    r.check("finals matches", pg_one(pg, "SELECT count(*) FROM matches WHERE is_final"),
            lite_one(lite, "SELECT COUNT(*) FROM matches WHERE is_final=1"))
    r.check("matches with no attendance",
            pg_one(pg, "SELECT count(*) FROM matches WHERE attendance IS NULL"),
            lite_one(lite, "SELECT COUNT(*) FROM match_details WHERE attendance IS NULL"))

    # Brownlow: AFLDB corrects the legacy career figure on purpose.
    section("3. Brownlow votes (deliberate correction)")
    authoritative = lite_one(lite, "SELECT SUM(votes) FROM brownlow_results")
    legacy_pergame = lite_one(lite, "SELECT CAST(SUM(brownlow) AS INT) FROM games")
    r.check("career Brownlow total = authoritative source",
            pg_one(pg, "SELECT sum(brownlow_votes) FROM player_career_stats"),
            authoritative,
            "Summed from brownlow_season_votes, not per-game votes.")
    r.check("per-game Brownlow total unchanged",
            pg_one(pg, "SELECT sum(brownlow_votes) FROM player_match_stats"),
            legacy_pergame,
            "Per-game detail is migrated as-is; only career totals are corrected.")
    r.note(f"AFLDB career Brownlow is {authoritative - legacy_pergame:,} votes higher than the "
           f"legacy derivation ({authoritative:,} vs {legacy_pergame:,}) because per-game votes "
           f"do not exist for 1935-1983.")
    r.check("Brownlow medals awarded",
            pg_one(pg, "SELECT sum(brownlow_medals) FROM player_career_stats"),
            lite_one(lite, "SELECT SUM(winner) FROM brownlow_results"))


def validate_integrity(pg, r: Results) -> None:
    section("4. Referential integrity and constraints")
    for label, sql in [
        ("orphan player_match_stats -> players",
         "SELECT count(*) FROM player_match_stats s LEFT JOIN players p ON p.id=s.player_id WHERE p.id IS NULL"),
        ("orphan player_match_stats -> matches",
         "SELECT count(*) FROM player_match_stats s LEFT JOIN matches m ON m.id=s.match_id WHERE m.id IS NULL"),
        ("orphan player_match_stats -> clubs",
         "SELECT count(*) FROM player_match_stats s LEFT JOIN clubs c ON c.id=s.club_id WHERE c.id IS NULL"),
        ("matches with unresolved venue",
         "SELECT count(*) FROM matches WHERE venue_id IS NULL"),
        ("players missing career stats",
         "SELECT count(*) FROM players p LEFT JOIN player_career_stats c ON c.player_id=p.id WHERE c.player_id IS NULL"),
        ("duplicate (player, match)",
         "SELECT count(*) FROM (SELECT player_id, match_id FROM player_match_stats GROUP BY 1,2 HAVING count(*)>1) x"),
        ("clubs with no current identity",
         "SELECT count(*) FROM clubs c LEFT JOIN clubs t ON t.id=c.current_identity_id WHERE t.id IS NULL"),
        ("club_seasons with unresolved club",
         "SELECT count(*) FROM staging.team_seasons WHERE club_id IS NULL"),
        ("match margin disagrees with scores",
         "SELECT count(*) FROM matches WHERE margin <> abs(home_score-away_score)"),
    ]:
        r.check(label, pg_one(pg, sql), 0)


def validate_null_semantics(pg, lite, r: Results) -> None:
    section("5. NULL semantics preserved (not recorded != zero)")
    for pg_col, lite_col in [
        ("disposals", "disposals"), ("tackles", "tackles"),
        ("hitouts", "hitouts"), ("goal_assists", "goal_assists"),
        ("brownlow_votes", "brownlow"),
    ]:
        r.check(f"{pg_col}: NULL count preserved",
                pg_one(pg, f"SELECT count(*) FROM player_match_stats WHERE {pg_col} IS NULL"),
                lite_one(lite, f"SELECT COUNT(*) FROM games WHERE {lite_col} IS NULL"))

    r.check("players with DOB (rest NULL, not defaulted)",
            pg_one(pg, "SELECT count(*) FROM players WHERE dob IS NOT NULL"),
            lite_one(lite, "SELECT COUNT(*) FROM players WHERE dob IS NOT NULL"))

    section("6. Statistic availability (per season, per grain)")
    # 1935-1983 is 49 seasons. 45 of them had a medal whose per-match
    # breakdown was never published ('not_collected'); the other 4 are the
    # war years 1942-1945, when no medal was awarded at all
    # ('not_applicable'). The legacy stat_coverage range of 1931-2025
    # concealed the whole gap, and a single boolean would still conflate
    # these two quite different facts.
    gap = pg_one(pg, """SELECT count(*) FROM stat_availability
                         WHERE stat_key='brownlow_match_votes'
                           AND coverage='not_collected'
                           AND season BETWEEN 1935 AND 1983""")
    r.check("Brownlow match votes 1935-1983 not collected", gap, 45,
            "The legacy stat_coverage range of 1931-2025 concealed this gap.")
    war = pg_one(pg, """SELECT count(*) FROM stat_availability
                         WHERE stat_key='brownlow_season_total'
                           AND coverage='not_applicable'
                           AND season BETWEEN 1935 AND 1983""")
    r.check("Brownlow war years recorded as not applicable", war, 4,
            "1942-1945: no medal was awarded, which is not the same as no votes.")
    total_known = pg_one(pg, """SELECT count(*) FROM stat_availability
                                 WHERE stat_key='brownlow_season_total'
                                   AND coverage='complete'
                                   AND season BETWEEN 1935 AND 1983""")
    r.check("Brownlow season totals complete 1935-1983", total_known, 45,
            "The same seasons are fully known at season grain: this is why AFLDB "
            "reads career totals from brownlow_season_votes.")
    r.check("goals recorded in every season",
            pg_one(pg, """SELECT count(*) FROM stat_availability
                           WHERE stat_key='goals' AND NOT is_recorded"""), 0)
    r.check("goal_assists absent before 2003",
            pg_one(pg, """SELECT count(*) FROM stat_availability
                           WHERE stat_key='goal_assists' AND is_recorded AND season < 2003"""), 0)


def validate_players(pg, oracle: dict, r: Results) -> None:
    section("7. Representative player parity")
    for pid, expected in oracle["_representative_players"].items():
        pid = int(pid)
        row = pg_one(pg, f"""
            SELECT json_build_object(
              'name', p.display_name, 'games', c.games, 'goals', c.goals,
              'finals', c.finals, 'clubs', c.clubs_played,
              'brownlow', c.brownlow_votes)
            FROM players p JOIN player_career_stats c ON c.player_id = p.id
            WHERE p.id = {pid}""")
        if row is None:
            r.check(f"player {pid}", None, expected["name"])
            continue
        label = f"{row['name']} ({pid})"
        r.check(f"{label}: games", row["games"], expected["games"])
        r.check(f"{label}: goals", row["goals"], int(expected["goals"]))
        r.check(f"{label}: finals", row["finals"], expected["finals"])
        r.check(f"{label}: clubs", row["clubs"], expected["clubs"])
        r.check(f"{label}: Brownlow votes", row["brownlow"],
                expected["brownlow_authoritative"],
                "Authoritative season-totals source.")


def validate_search_cases(pg, oracle: dict, r: Results) -> None:
    section("8. Advanced Search regression cases (exact ID sets)")

    cases = {
        "debut_1960s_exactly_two_clubs": """
            SELECT player_id FROM player_career_stats
             WHERE debut_season BETWEEN 1960 AND 1969 AND clubs_played = 2""",
        "games_200_249_and_16plus_finals": """
            SELECT player_id FROM player_career_stats
             WHERE games BETWEEN 200 AND 249 AND finals >= 16""",
        "goals_50_199_and_zero_brownlow_AUTHORITATIVE": """
            SELECT player_id FROM player_career_stats
             WHERE goals BETWEEN 50 AND 199 AND brownlow_votes = 0""",
        "career_games_ge_200_goals_ge_100_finals_ge_15": """
            SELECT player_id FROM player_career_stats
             WHERE games >= 200 AND goals >= 100 AND finals >= 15""",
    }

    for name, sql in cases.items():
        expected = oracle[name]
        actual = pg_ids(pg, sql)
        r.check(f"{name}: count", len(actual), expected["count"])
        r.check(f"{name}: ID-set hash", id_hash(actual), expected["sha256_16"],
                "Exact player-ID set must match, not merely the count.")

    legacy = oracle["goals_50_199_and_zero_brownlow_LEGACY_pergame"]
    corrected = oracle["goals_50_199_and_zero_brownlow_AUTHORITATIVE"]
    r.note(f"'zero Brownlow votes' returns {corrected['count']} players in AFLDB "
           f"against {legacy['count']} under the legacy per-game derivation. The "
           f"{legacy['count'] - corrected['count']} difference are players who did poll "
           f"votes during 1935-1983. AFLDB is correct.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate the AFLDB migration.")
    parser.add_argument("--json", type=Path, help="write a JSON report")
    args = parser.parse_args()

    load_env()
    oracle_path = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "oracle_baseline.json"
    if not oracle_path.exists():
        sys.exit(f"ERROR: oracle baseline not found at {oracle_path}")
    oracle = json.loads(oracle_path.read_text())

    lite = connect_legacy(require_env("AFLDB_LEGACY_SQLITE"))
    pg = connect_pg(require_env("DATABASE_URL"))  # read-only role is sufficient

    print("AFLDB migration validation")
    r = Results()
    try:
        validate_counts(pg, lite, r)
        validate_aggregates(pg, lite, r)
        validate_integrity(pg, r)
        validate_null_semantics(pg, lite, r)
        validate_players(pg, oracle, r)
        validate_search_cases(pg, oracle, r)
    finally:
        lite.close()
        pg.close()

    total = r.passed + r.failed
    print(f"\n{'=' * 62}")
    colour = GREEN if r.failed == 0 else RED
    print(f"{colour}{r.passed}/{total} checks passed{RESET}"
          + (f", {r.failed} FAILED" if r.failed else ""))
    print("=" * 62)

    if args.json:
        args.json.write_text(json.dumps(
            {"passed": r.passed, "failed": r.failed,
             "failures": r.failures, "notes": r.notes}, indent=2))
        print(f"Report written to {args.json}")

    return 1 if r.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
