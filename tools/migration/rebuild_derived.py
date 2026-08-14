#!/usr/bin/env python3
"""Rebuild AFLDB derived summaries from the authoritative tables.

    python tools/migration/rebuild_derived.py              # rebuild everything
    python tools/migration/rebuild_derived.py --targets player_career_stats

Everything this script writes is reproducible. It is safe to run at any
time and is the required follow-up to any data import.

Statistical definitions live here and nowhere else. Pages, records and
Advanced Search all read these tables, so a metric can never mean two
different things in two places.

    games        one row in player_match_stats
    finals       a game whose match.is_final is true
    premiership  a game in a grand final whose result the player's club won
    clubs played distinct MODERN club identities (clubs.current_identity_id),
                 not distinct historical names. Brent Harvey played for
                 "Kangaroos" and "North Melbourne", but that is one club
                 under two names, so clubs_played is 1. The same applies to
                 Footscray/Western Bulldogs and South Melbourne/Sydney.
                 player_clubs still records the historical stints.
    Brownlow     summed from brownlow_season_votes (AUTHORITATIVE).
                 Never summed from player_match_stats.brownlow_votes,
                 which exists only for 1931-1934 and 1984-2025.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import psycopg  # noqa: E402

from common import Reporter, analyze, connect_pg, load_env, require_env, safe_dsn, scalar  # noqa: E402

# ---------------------------------------------------------------------------
# Shared context: a player-game joined to its match, with the result
# expressed from that player's club's point of view.
# ---------------------------------------------------------------------------

PLAYER_GAME_CONTEXT = """
CREATE TEMPORARY TABLE pg_ctx ON COMMIT DROP AS
SELECT
    pms.player_id,
    pms.match_id,
    pms.club_id,
    -- Modern identity of the club the player represented. "Clubs played"
    -- counts these, so a rename or relocation is not counted twice.
    cl.current_identity_id AS modern_club_id,
    m.season,
    m.match_date,
    m.is_final,
    m.round_type,
    -- The player's club won iff "home won" agrees with "player was home".
    CASE
      WHEN m.result = 'draw' THEN 'D'
      WHEN (m.result = 'home_win') = (m.home_club_id = pms.club_id) THEN 'W'
      ELSE 'L'
    END AS outcome,
    pms.goals, pms.behinds, pms.kicks, pms.handballs, pms.disposals,
    pms.marks, pms.tackles, pms.hitouts
FROM player_match_stats pms
JOIN matches m  ON m.id  = pms.match_id
JOIN clubs   cl ON cl.id = pms.club_id;

CREATE INDEX ON pg_ctx (player_id);
CREATE INDEX ON pg_ctx (player_id, season, club_id);
ANALYZE pg_ctx;
"""

REBUILDS: dict[str, str] = {}

# --- player_clubs ----------------------------------------------------------
REBUILDS["player_clubs"] = """
TRUNCATE player_clubs;
INSERT INTO player_clubs
      (player_id, club_id, games, goals, first_season, last_season,
       first_match_id, last_match_id)
SELECT
    player_id,
    club_id,
    count(*),
    COALESCE(sum(goals), 0),
    min(season),
    max(season),
    (array_agg(match_id ORDER BY match_date, match_id))[1],
    (array_agg(match_id ORDER BY match_date DESC, match_id DESC))[1]
FROM pg_ctx
GROUP BY player_id, club_id;
"""

# --- player_season_stats ---------------------------------------------------
REBUILDS["player_season_stats"] = """
TRUNCATE player_season_stats;
INSERT INTO player_season_stats
      (player_id, season, club_id, games, finals, wins, draws, losses,
       goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts,
       disposals_recorded_games, tackles_recorded_games, hitouts_recorded_games,
       brownlow_votes, is_premier)
SELECT
    c.player_id,
    c.season,
    c.club_id,
    count(*)                                        AS games,
    count(*) FILTER (WHERE c.is_final)              AS finals,
    count(*) FILTER (WHERE c.outcome = 'W')         AS wins,
    count(*) FILTER (WHERE c.outcome = 'D')         AS draws,
    count(*) FILTER (WHERE c.outcome = 'L')         AS losses,
    sum(c.goals), sum(c.behinds), sum(c.kicks), sum(c.handballs),
    sum(c.disposals), sum(c.marks), sum(c.tackles), sum(c.hitouts),
    -- Games in which each era-limited statistic was actually recorded.
    count(c.disposals), count(c.tackles), count(c.hitouts),
    bsv.votes,
    bool_or(c.round_type = 'grand_final' AND c.outcome = 'W') AS is_premier
FROM pg_ctx c
LEFT JOIN brownlow_season_votes bsv
       ON bsv.player_id = c.player_id AND bsv.season = c.season
GROUP BY c.player_id, c.season, c.club_id, bsv.votes;
"""

# --- player_career_stats ---------------------------------------------------
# Brownlow totals come from brownlow_season_votes, never from per-game votes.
REBUILDS["player_career_stats"] = """
TRUNCATE player_career_stats;
INSERT INTO player_career_stats
      (player_id, games, finals, premierships, wins, draws, losses,
       goals, behinds, kicks, handballs, disposals, marks, tackles, hitouts,
       behinds_recorded_games, kicks_recorded_games, handballs_recorded_games,
       disposals_recorded_games, marks_recorded_games, tackles_recorded_games,
       hitouts_recorded_games,
       brownlow_votes, brownlow_medals,
       clubs_played, seasons_played, debut_season, final_season,
       debut_date, last_match_date, best_goals_game, best_disposals_game)
SELECT
    g.player_id,
    g.games, g.finals, g.premierships, g.wins, g.draws, g.losses,
    g.goals, g.behinds, g.kicks, g.handballs, g.disposals, g.marks,
    g.tackles, g.hitouts,
    g.behinds_rec, g.kicks_rec, g.handballs_rec, g.disposals_rec,
    g.marks_rec, g.tackles_rec, g.hitouts_rec,
    COALESCE(b.votes, 0),
    COALESCE(b.medals, 0),
    g.clubs_played, g.seasons_played, g.debut_season, g.final_season,
    g.debut_date, g.last_match_date, g.best_goals, g.best_disposals
FROM (
    SELECT
        player_id,
        count(*)                                    AS games,
        count(*) FILTER (WHERE is_final)            AS finals,
        count(*) FILTER (WHERE round_type = 'grand_final' AND outcome = 'W')
                                                    AS premierships,
        count(*) FILTER (WHERE outcome = 'W')       AS wins,
        count(*) FILTER (WHERE outcome = 'D')       AS draws,
        count(*) FILTER (WHERE outcome = 'L')       AS losses,
        COALESCE(sum(goals), 0)                     AS goals,
        sum(behinds) AS behinds, sum(kicks) AS kicks,
        sum(handballs) AS handballs, sum(disposals) AS disposals,
        sum(marks) AS marks, sum(tackles) AS tackles, sum(hitouts) AS hitouts,
        count(behinds) AS behinds_rec, count(kicks) AS kicks_rec,
        count(handballs) AS handballs_rec, count(disposals) AS disposals_rec,
        count(marks) AS marks_rec, count(tackles) AS tackles_rec,
        count(hitouts) AS hitouts_rec,
        count(DISTINCT modern_club_id)              AS clubs_played,
        count(DISTINCT season)                      AS seasons_played,
        min(season) AS debut_season, max(season) AS final_season,
        min(match_date) AS debut_date, max(match_date) AS last_match_date,
        max(goals) AS best_goals, max(disposals) AS best_disposals
    FROM pg_ctx
    GROUP BY player_id
) g
LEFT JOIN (
    SELECT player_id,
           sum(votes)                        AS votes,
           count(*) FILTER (WHERE is_winner) AS medals
    FROM brownlow_season_votes
    GROUP BY player_id
) b ON b.player_id = g.player_id;
"""

# --- club_seasons ----------------------------------------------------------
# Ladder positions come from the legacy team_seasons table; premiership
# flags are resolved from Grand Final results so there is one definition.
REBUILDS["club_seasons"] = """
TRUNCATE club_seasons;
INSERT INTO club_seasons
      (season, club_id, played, wins, draws, losses, points_for, points_against,
       premiership_points, percentage, ladder_rank, wooden_spoon, is_premier,
       finals_played, source_id)
SELECT
    s.season,
    s.club_id,
    s.played, s.wins, s.draws, s.losses, s.points_for, s.points_against,
    s.premiership_points, s.percentage, s.ladder_rank, s.wooden_spoon,
    COALESCE(gf.won, false),
    COALESCE(f.finals, 0),
    (SELECT id FROM sources WHERE key = 'sports_data_lab')
FROM staging.team_seasons s
LEFT JOIN (
    SELECT season, winner_club_id AS club_id, true AS won
    FROM matches WHERE round_type = 'grand_final' AND winner_club_id IS NOT NULL
) gf ON gf.season = s.season AND gf.club_id = s.club_id
LEFT JOIN (
    SELECT season, club_id, count(*) AS finals FROM (
        SELECT season, home_club_id AS club_id FROM matches WHERE is_final
        UNION ALL
        SELECT season, away_club_id FROM matches WHERE is_final
    ) x GROUP BY season, club_id
) f ON f.season = s.season AND f.club_id = s.club_id;
"""

# --- search ranking --------------------------------------------------------
REBUILDS["search_rank"] = """
UPDATE players p
   SET search_rank = COALESCE(c.games, 0)
  FROM player_career_stats c
 WHERE c.player_id = p.id;

UPDATE players SET search_rank = 0 WHERE search_rank IS NULL;
"""

ORDER = ["player_clubs", "player_season_stats", "player_career_stats",
         "club_seasons", "search_rank"]


def rebuild(pg: psycopg.Connection, target: str, rep: Reporter) -> None:
    started = time.time()
    with pg.cursor() as cur:
        cur.execute(
            "INSERT INTO derived_rebuilds (target, scope) VALUES (%s, %s) RETURNING id",
            (target, "full"),
        )
        rebuild_id = cur.fetchone()[0]
    pg.commit()

    try:
        with pg.cursor() as cur:
            # pg_ctx is ON COMMIT DROP, so it is recreated per target.
            cur.execute(PLAYER_GAME_CONTEXT)
            cur.execute(REBUILDS[target])
        # Count before commit drops the temp table.
        table = target if target != "search_rank" else "players"
        count = scalar(pg, f"SELECT count(*) FROM {table}")
        pg.commit()
    except Exception as exc:
        pg.rollback()
        with pg.cursor() as cur:
            cur.execute(
                """UPDATE derived_rebuilds
                      SET completed_at = now(), status = 'failed', error = %s
                    WHERE id = %s""",
                (f"{type(exc).__name__}: {exc}", rebuild_id),
            )
        pg.commit()
        raise

    with pg.cursor() as cur:
        cur.execute(
            """UPDATE derived_rebuilds
                  SET completed_at = now(), status = 'completed', row_count = %s
                WHERE id = %s""",
            (count, rebuild_id),
        )
    pg.commit()
    rep.result(target, count, f"({time.time() - started:.1f}s)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Rebuild AFLDB derived summaries.")
    parser.add_argument("--targets", nargs="+", choices=ORDER)
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    load_env()
    rep = Reporter(verbose=not args.quiet)
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")
    pg = connect_pg(dsn)

    print("AFLDB derived-data rebuild")
    print(f"  target: {safe_dsn(dsn)}\n")

    started = time.time()
    for target in ORDER:
        if args.targets and target not in args.targets:
            continue
        rebuild(pg, target, rep)

    analyze(pg, "player_career_stats", "player_season_stats", "player_clubs",
            "club_seasons", "players")
    print(f"\nCompleted in {time.time() - started:.1f}s")
    pg.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
