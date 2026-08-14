#!/usr/bin/env python3
"""Migrate the legacy AFL SQLite database into AFLDB PostgreSQL.

    python tools/migration/import_legacy_afl.py                  # full run
    python tools/migration/import_legacy_afl.py --dry-run        # counts only
    python tools/migration/import_legacy_afl.py --groups core    # subset
    python tools/migration/import_legacy_afl.py --list-groups

The migration is idempotent: each group truncates its targets and
reloads, so a rerun always produces the same result. Groups run in
dependency order and each is wrapped in a tracked import batch.

Nothing is written to the legacy database, which is opened read-only.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import psycopg  # noqa: E402

from common import (  # noqa: E402
    Reporter,
    analyze,
    clean_text,
    connect_legacy,
    connect_pg,
    copy_rows,
    import_batch,
    load_env,
    require_env,
    safe_dsn,
    scalar,
    to_int,
    truncate,
)

# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------

SOURCES = [
    ("fitzroy_afldata", "fitzRoy afldata.rda (AFL Tables player stats)",
     "https://github.com/jimmyday12/fitzRoy_data", "upstream_dataset",
     "Upstream player-game dataset; origin of the games fact table."),
    ("afltables", "AFL Tables", "https://afltables.com", "scrape",
     "Brownlow votes, match details, venue and club records."),
    ("wikipedia", "Wikipedia", "https://en.wikipedia.org", "scrape",
     "Awards, captaincies, hall of fame, football families."),
    ("draftguru", "DraftGuru", "https://draftguru.com.au", "scrape",
     "Draft and recruitment history."),
    ("footywire", "FootyWire", "https://footywire.com", "scrape",
     "Rising Star nominations."),
    ("sports_data_lab", "Sports Data Lab legacy database", None, "derived",
     "Legacy normalisation and derivation layer used as the migration source."),
]

# (legacy club_hist, display name, short name, abbreviation, successor
#  club_hist or None for self, succession, is_current_afl_club, home state)
CLUBS = [
    ("Adelaide",               "Adelaide",               "Adelaide",       "ADE",  None,                "current",   True,  "SA"),
    ("Brisbane Bears",         "Brisbane Bears",         "Brisbane Bears", "BB",   None,                "merged",    False, "QLD"),
    ("Brisbane Lions",         "Brisbane Lions",         "Brisbane Lions", "BL",   None,                "current",   True,  "QLD"),
    ("Carlton",                "Carlton",                "Carlton",        "CARL", None,                "current",   True,  "VIC"),
    ("Collingwood",            "Collingwood",            "Collingwood",    "COLL", None,                "current",   True,  "VIC"),
    ("Essendon",               "Essendon",               "Essendon",       "ESS",  None,                "current",   True,  "VIC"),
    ("Fitzroy",                "Fitzroy",                "Fitzroy",        "FITZ", None,                "merged",    False, "VIC"),
    ("Footscray",              "Footscray",              "Footscray",      "FOOT", "Western Bulldogs",  "renamed",   False, "VIC"),
    ("Fremantle",              "Fremantle",              "Fremantle",      "FRE",  None,                "current",   True,  "WA"),
    ("Geelong",                "Geelong",                "Geelong",        "GEEL", None,                "current",   True,  "VIC"),
    ("Gold Coast",             "Gold Coast",             "Gold Coast",     "GC",   None,                "current",   True,  "QLD"),
    ("Greater Western Sydney", "Greater Western Sydney", "GWS",            "GWS",  None,                "current",   True,  "NSW"),
    ("Hawthorn",               "Hawthorn",               "Hawthorn",       "HAW",  None,                "current",   True,  "VIC"),
    ("Kangaroos",              "Kangaroos",              "Kangaroos",      "KANG", "North Melbourne",   "renamed",   False, "VIC"),
    ("Melbourne",              "Melbourne",              "Melbourne",      "MELB", None,                "current",   True,  "VIC"),
    ("North Melbourne",        "North Melbourne",        "North Melbourne","NM",   None,                "current",   True,  "VIC"),
    ("Port Adelaide",          "Port Adelaide",          "Port Adelaide",  "PA",   None,                "current",   True,  "SA"),
    ("Richmond",               "Richmond",               "Richmond",       "RICH", None,                "current",   True,  "VIC"),
    ("South Melbourne",        "South Melbourne",        "South Melbourne","SM",   "Sydney",            "relocated", False, "VIC"),
    ("St Kilda",               "St Kilda",               "St Kilda",       "STK",  None,                "current",   True,  "VIC"),
    ("Sydney",                 "Sydney",                 "Sydney",         "SYD",  None,                "current",   True,  "NSW"),
    ("University",             "University",             "University",     "UNI",  None,                "defunct",   False, "VIC"),
    ("West Coast",             "West Coast",             "West Coast",     "WCE",  None,                "current",   True,  "WA"),
    ("Western Bulldogs",       "Western Bulldogs",       "Western Bulldogs","WB",  None,                "current",   True,  "VIC"),
]

CLUB_NOTES = {
    "Fitzroy": "Merged with Brisbane Bears in 1997 to form the Brisbane Lions. "
               "Retained as a distinct identity because the source data keeps its record separate.",
    "Brisbane Bears": "Merged with Fitzroy in 1997 to form the Brisbane Lions. "
                      "Retained as a distinct identity because the source data keeps its record separate.",
    "University": "Competed 1908-1914 and withdrew from the competition.",
    "Kangaroos": "North Melbourne competed as the Kangaroos from 1999 to 2007.",
    "South Melbourne": "Relocated to Sydney in 1982.",
    "Footscray": "Renamed the Western Bulldogs in 1997.",
}

# Venue names arrive abbreviated. Only unambiguous expansions are applied
# here; fuller canonicalisation (city, state, capacity) is a later
# enrichment pass. The legacy string is always preserved as an alias.
VENUE_CANONICAL = {
    "M.C.G.": "Melbourne Cricket Ground",
    "S.C.G.": "Sydney Cricket Ground",
    "W.A.C.A.": "WACA Ground",
}

ROUND_TYPES = {
    "EF": "elimination_final",
    "QF": "qualifying_final",
    "SF": "semi_final",
    "PF": "preliminary_final",
    "GF": "grand_final",
}

# legacy games column -> AFLDB player_match_stats column
STAT_COLUMNS = {
    "kicks": "kicks",
    "marks": "marks",
    "handballs": "handballs",
    "disposals": "disposals",
    "goals": "goals",
    "behinds": "behinds",
    "hitouts": "hitouts",
    "tackles": "tackles",
    "rebounds": "rebounds",
    "inside50s": "inside_50s",
    "clearances": "clearances",
    "clangers": "clangers",
    "frees_for": "frees_for",
    "frees_against": "frees_against",
    "contested": "contested",
    "uncontested": "uncontested",
    "contested_marks": "contested_marks",
    "marks_i50": "marks_inside_50",
    "one_percenters": "one_percenters",
    "bounces": "bounces",
    "goal_assists": "goal_assists",
    "brownlow": "brownlow_votes",
}

STAT_DEFINITIONS = [
    ("goals", "Goals", "G", "count", 10),
    ("behinds", "Behinds", "B", "count", 20),
    ("kicks", "Kicks", "K", "count", 30),
    ("handballs", "Handballs", "HB", "count", 40),
    ("disposals", "Disposals", "D", "count", 50),
    ("marks", "Marks", "M", "count", 60),
    ("tackles", "Tackles", "T", "count", 70),
    ("hitouts", "Hit-outs", "HO", "count", 80),
    ("rebounds", "Rebound 50s", "R50", "count", 90),
    ("inside50s", "Inside 50s", "I50", "count", 100),
    ("clearances", "Clearances", "CL", "count", 110),
    ("clangers", "Clangers", "CG", "count", 120),
    ("frees_for", "Frees For", "FF", "count", 130),
    ("frees_against", "Frees Against", "FA", "count", 140),
    ("contested", "Contested Possessions", "CP", "count", 150),
    ("uncontested", "Uncontested Possessions", "UP", "count", 160),
    ("contested_marks", "Contested Marks", "CM", "count", 170),
    ("marks_i50", "Marks Inside 50", "MI50", "count", 180),
    ("one_percenters", "One Percenters", "1%", "count", 190),
    ("bounces", "Bounces", "BO", "count", 200),
    ("goal_assists", "Goal Assists", "GA", "count", 210),
    ("brownlow", "Brownlow Votes", "BV", "count", 220),
]


def slugify(text: str) -> str:
    """URL slug. Mirrors afldb_normalise_name, then hyphenates."""
    import re
    import unicodedata

    normalised = unicodedata.normalize("NFKD", text)
    normalised = "".join(c for c in normalised if not unicodedata.combining(c))
    normalised = normalised.lower()
    normalised = re.sub(r"['`.,]", "", normalised)
    normalised = re.sub(r"[\-_/\s]+", " ", normalised).strip()
    return re.sub(r"\s+", "-", normalised)


# ---------------------------------------------------------------------------
# Import groups
# ---------------------------------------------------------------------------


def import_sources(pg: psycopg.Connection, lite, rep: Reporter) -> None:
    with pg.cursor() as cur:
        for key, name, url, kind, description in SOURCES:
            cur.execute(
                """INSERT INTO sources (key, name, url, kind, description)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (key) DO UPDATE
                     SET name = EXCLUDED.name, url = EXCLUDED.url,
                         kind = EXCLUDED.kind, description = EXCLUDED.description""",
                (key, name, url, kind, description),
            )
    pg.commit()
    rep.result("sources", scalar(pg, "SELECT count(*) FROM sources"))


def import_seasons(pg: psycopg.Connection, lite, rep: Reporter) -> None:
    truncate(pg, "seasons")
    rows = lite.execute(
        """SELECT season, MIN(date) AS first_date, MAX(date) AS last_date,
                  COUNT(DISTINCT match_id) AS matches,
                  COUNT(DISTINCT club_hist) AS clubs
             FROM games GROUP BY season ORDER BY season"""
    ).fetchall()
    max_season = max(r["season"] for r in rows)
    with pg.cursor() as cur:
        for r in rows:
            season = r["season"]
            cur.execute(
                """INSERT INTO seasons
                     (year, league, is_complete, first_match_date, last_match_date,
                      match_count, club_count, notes)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    season,
                    "VFL" if season <= 1989 else "AFL",
                    season < max_season,
                    r["first_date"],
                    r["last_date"],
                    r["matches"],
                    r["clubs"],
                    "Season in progress at time of import." if season == max_season else None,
                ),
            )
    pg.commit()
    rep.result("seasons", scalar(pg, "SELECT count(*) FROM seasons"),
               f"(1897-{max_season}; {max_season} marked in progress)")


def import_clubs(pg: psycopg.Connection, lite, rep: Reporter) -> None:
    truncate(pg, "clubs", "club_aliases")
    legacy_meta = {
        r["db_club_now"]: r
        for r in lite.execute("SELECT * FROM clubs").fetchall()
    }
    spans = {
        r["club_hist"]: (r["first_season"], r["last_season"])
        for r in lite.execute(
            "SELECT club_hist, MIN(season) first_season, MAX(season) last_season "
            "FROM games GROUP BY club_hist"
        ).fetchall()
    }

    ids: dict[str, int] = {}
    with pg.cursor() as cur:
        # The first club inserted has no valid identity to point at yet,
        # so the self-referencing FK is deferred to COMMIT while both
        # passes run.
        cur.execute("SET CONSTRAINTS clubs_current_identity_id_fkey DEFERRED")

        # Pass 1: insert with a placeholder identity.
        for hist, name, short, abbrev, _succ_to, succession, is_current, state in CLUBS:
            first_season, last_season = spans.get(hist, (None, None))
            meta = legacy_meta.get(name) or legacy_meta.get(short)
            cur.execute(
                """INSERT INTO clubs
                     (slug, name, short_name, abbreviation, current_identity_id,
                      succession, is_current_afl_club, first_season, last_season,
                      home_state, wikipedia_url, afltables_slug, legacy_club_key,
                      legacy_club_hist, notes)
                   VALUES (%s,%s,%s,%s, 0, %s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   RETURNING id""",
                (
                    slugify(name), name, short, abbrev, succession, is_current,
                    first_season, last_season, state,
                    meta["wikipedia_url"] if meta else None,
                    meta["afltables_slug"] if meta else None,
                    meta["club_id"] if meta else None,
                    hist, CLUB_NOTES.get(hist),
                ),
            )
            ids[hist] = cur.fetchone()[0]

        # Pass 2: resolve successor identities.
        for hist, _name, _short, _abbrev, succ_to, *_ in CLUBS:
            target = ids[succ_to] if succ_to else ids[hist]
            cur.execute("UPDATE clubs SET current_identity_id = %s WHERE id = %s",
                        (target, ids[hist]))

        # Aliases: every string any source uses for the club, so lookups
        # by club_hist, club_now, short name or abbreviation all resolve.
        seen: set[tuple[int, str]] = set()
        for hist, name, short, abbrev, _succ_to, *_ in CLUBS:
            club_id = ids[hist]
            for alias, alias_type in (
                (hist, "source_string"), (name, "alternate"),
                (short, "alternate"), (abbrev, "abbreviation"),
            ):
                if alias and (club_id, alias) not in seen:
                    seen.add((club_id, alias))
                    cur.execute(
                        """INSERT INTO club_aliases (club_id, alias, alias_type)
                           VALUES (%s,%s,%s) ON CONFLICT DO NOTHING""",
                        (club_id, alias, alias_type),
                    )
        # club_now strings that differ from club_hist.
        for club_now in {r["club_now"] for r in
                         lite.execute("SELECT DISTINCT club_now FROM games").fetchall()}:
            match = next((h for h, n, s, *_ in CLUBS if club_now in (h, n, s)), None)
            if match:
                cur.execute(
                    """INSERT INTO club_aliases (club_id, alias, alias_type)
                       VALUES (%s,%s,'source_string') ON CONFLICT DO NOTHING""",
                    (ids[match], club_now),
                )
    pg.commit()

    missing = {r["club_hist"] for r in
               lite.execute("SELECT DISTINCT club_hist FROM games").fetchall()} - set(ids)
    if missing:
        raise RuntimeError(f"club_hist values with no AFLDB club: {sorted(missing)}")

    rep.result("clubs", scalar(pg, "SELECT count(*) FROM clubs"),
               f"({scalar(pg, 'SELECT count(*) FROM clubs WHERE is_current_afl_club')} current)")
    rep.result("club_aliases", scalar(pg, "SELECT count(*) FROM club_aliases"))


def import_venues(pg: psycopg.Connection, lite, rep: Reporter) -> None:
    truncate(pg, "venues", "venue_aliases")
    rows = lite.execute(
        """SELECT venue, MIN(season) first_season, MAX(season) last_season
             FROM games GROUP BY venue ORDER BY venue"""
    ).fetchall()
    with pg.cursor() as cur:
        for r in rows:
            legacy = r["venue"]
            canonical = VENUE_CANONICAL.get(legacy, legacy)
            cur.execute(
                """INSERT INTO venues
                     (slug, canonical_name, legacy_name, first_season, last_season)
                   VALUES (%s,%s,%s,%s,%s) RETURNING id""",
                (slugify(canonical), canonical, legacy, r["first_season"], r["last_season"]),
            )
            venue_id = cur.fetchone()[0]
            for alias in {legacy, canonical}:
                cur.execute(
                    """INSERT INTO venue_aliases (venue_id, alias)
                       VALUES (%s,%s) ON CONFLICT DO NOTHING""",
                    (venue_id, alias),
                )
    pg.commit()
    rep.result("venues", scalar(pg, "SELECT count(*) FROM venues"))
    rep.result("venue_aliases", scalar(pg, "SELECT count(*) FROM venue_aliases"))


def import_players(pg: psycopg.Connection, lite, rep: Reporter, batch) -> None:
    truncate(pg, "players")
    rows = lite.execute(
        """SELECT player_id, player, dob, birth_year, birth_year_min, birth_year_max,
                  debut_season, final_season, name_key
             FROM players ORDER BY player_id"""
    ).fetchall()

    def build():
        for r in rows:
            batch.records_read += 1
            name = clean_text(r["player"])
            if not name:
                batch.reject(str(r["player_id"]), "player has no name", dict(r))
                continue
            parts = name.split()
            surname = parts[-1] if parts else name
            given = " ".join(parts[:-1]) if len(parts) > 1 else None
            has_dob = r["dob"] is not None
            yield (
                r["player_id"], r["player_id"], name,
                f"{surname}, {given}" if given else surname,
                "",                       # search_name filled in SQL below
                "",                       # slug filled in SQL below
                given, surname, r["dob"],
                "sourced" if has_dob else "unknown",
                to_int(r["birth_year"]), r["birth_year_min"], r["birth_year_max"],
                "sourced" if has_dob else "estimated",
                r["debut_season"], r["final_season"],
            )

    copy_rows(
        pg, "players",
        ["id", "legacy_player_id", "display_name", "sort_name", "search_name", "slug",
         "given_name", "surname", "dob", "dob_confidence", "birth_year",
         "birth_year_min", "birth_year_max", "birth_year_confidence",
         "debut_season", "final_season"],
        build(), batch,
    )

    # Derive search_name and slug in SQL so they can never drift from the
    # normalisation the search queries use.
    with pg.cursor() as cur:
        cur.execute("""
            UPDATE players
               SET search_name = afldb_normalise_name(display_name),
                   slug        = regexp_replace(afldb_normalise_name(display_name), '\\s+', '-', 'g')
        """)
        cur.execute("SELECT setval(pg_get_serial_sequence('players','id'), COALESCE(MAX(id),1)) FROM players")
        # Preserve the legacy name_key as a searchable alias where it differs.
        cur.execute("""
            INSERT INTO player_name_aliases (player_id, alias, search_alias, alias_type)
            SELECT p.id, p.display_name, p.search_name, 'source_string'
              FROM players p
             ON CONFLICT DO NOTHING
        """)
    pg.commit()
    rep.result("players", scalar(pg, "SELECT count(*) FROM players"),
               f"({scalar(pg, 'SELECT count(*) FROM players WHERE dob IS NOT NULL')} with DOB)")


def import_matches(pg: psycopg.Connection, lite, rep: Reporter, batch) -> None:
    truncate(pg, "matches", "match_period_scores")
    clubs = {r[0]: r[1] for r in
             pg.execute("SELECT legacy_club_hist, id FROM clubs").fetchall()}
    venues = {r[0]: r[1] for r in
              pg.execute("SELECT legacy_name, id FROM venues").fetchall()}
    details = {
        r["match_id"]: r
        for r in lite.execute("SELECT * FROM match_details").fetchall()
    }
    events = {
        r["match_id"]: r["match_event"]
        for r in lite.execute(
            "SELECT match_id, match_event FROM games "
            "WHERE match_event IS NOT NULL GROUP BY match_id"
        ).fetchall()
    }

    rows = lite.execute("SELECT * FROM matches ORDER BY match_id").fetchall()

    def build():
        for r in rows:
            batch.records_read += 1
            round_code = str(r["round"]).strip()
            if round_code in ROUND_TYPES:
                round_type, round_number = ROUND_TYPES[round_code], None
            elif round_code.isdigit():
                round_type, round_number = "home_and_away", int(round_code)
            else:
                batch.reject(str(r["match_id"]), f"unrecognised round code {round_code!r}", dict(r))
                continue

            home_id = clubs.get(r["home_team"])
            away_id = clubs.get(r["away_team"])
            if home_id is None or away_id is None:
                batch.reject(str(r["match_id"]),
                             f"unmapped club: {r['home_team']!r} / {r['away_team']!r}", dict(r))
                continue

            home_score, away_score = to_int(r["home_score"]), to_int(r["away_score"])
            if home_score is None or away_score is None:
                batch.reject(str(r["match_id"]), "missing score", dict(r))
                continue

            if home_score > away_score:
                result, winner = "home_win", home_id
            elif away_score > home_score:
                result, winner = "away_win", away_id
            else:
                result, winner = "draw", None

            d = details.get(r["match_id"])
            yield (
                r["match_id"], r["match_id"], r["match_key"], r["season"],
                round_code, round_number, round_type, round_type != "home_and_away",
                r["match_date"],
                clean_text(d["match_time"]) if d else None,
                d["scheduled_datetime"] if d else None,
                venues.get(r["venue"]), r["venue"],
                home_id, away_id,
                to_int(d["home_q4_goals"]) if d else None,
                to_int(d["home_q4_behinds"]) if d else None,
                home_score,
                to_int(d["away_q4_goals"]) if d else None,
                to_int(d["away_q4_behinds"]) if d else None,
                away_score,
                result, winner, abs(home_score - away_score),
                to_int(d["attendance"]) if d else to_int(r["attendance"]),
                events.get(r["match_id"]),
            )

    copy_rows(
        pg, "matches",
        ["id", "legacy_match_id", "match_key", "season", "round_code", "round_number",
         "round_type", "is_final", "match_date", "match_time", "scheduled_at",
         "venue_id", "venue_raw", "home_club_id", "away_club_id",
         "home_goals", "home_behinds", "home_score",
         "away_goals", "away_behinds", "away_score",
         "result", "winner_club_id", "margin", "attendance", "match_event"],
        build(), batch,
    )

    # Quarter scores, from match_details (better typed than matches).
    # Index the match rows once rather than scanning per period.
    match_by_id = {r["match_id"]: r for r in rows}

    def periods():
        for match_id, d in details.items():
            m = match_by_id.get(match_id)
            if m is None:
                continue
            for side, club_key in (("home", "home_team"), ("away", "away_team")):
                club_id = clubs.get(m[club_key])
                if club_id is None:
                    continue
                for q in (1, 2, 3, 4):
                    yield (match_id, club_id, q,
                           to_int(d[f"{side}_q{q}_goals"]),
                           to_int(d[f"{side}_q{q}_behinds"]),
                           to_int(d[f"{side}_q{q}_points"]))

    copy_rows(pg, "match_period_scores",
              ["match_id", "club_id", "period", "goals", "behinds", "points"],
              periods())

    with pg.cursor() as cur:
        cur.execute("SELECT setval(pg_get_serial_sequence('matches','id'), COALESCE(MAX(id),1)) FROM matches")
    pg.commit()
    rep.result("matches", scalar(pg, "SELECT count(*) FROM matches"),
               f"({scalar(pg, 'SELECT count(*) FROM matches WHERE is_final')} finals)")
    rep.result("match_period_scores", scalar(pg, "SELECT count(*) FROM match_period_scores"))


def import_player_match_stats(pg: psycopg.Connection, lite, rep: Reporter, batch) -> None:
    truncate(pg, "player_match_stats")
    clubs = {r[0]: r[1] for r in
             pg.execute("SELECT legacy_club_hist, id FROM clubs").fetchall()}
    source_id = scalar(pg, "SELECT id FROM sources WHERE key = 'fitzroy_afldata'")

    legacy_cols = list(STAT_COLUMNS.keys())
    select_cols = ", ".join(["player_id", "match_id", "club_hist", "career_game_no"] + legacy_cols)
    cursor = lite.execute(f"SELECT {select_cols} FROM games ORDER BY player_id, match_id")

    def build():
        while True:
            chunk = cursor.fetchmany(20000)
            if not chunk:
                break
            for r in chunk:
                batch.records_read += 1
                club_id = clubs.get(r["club_hist"])
                if club_id is None:
                    batch.reject(f"{r['player_id']}:{r['match_id']}",
                                 f"unmapped club_hist {r['club_hist']!r}", None)
                    continue
                yield (
                    r["player_id"], r["match_id"], club_id, to_int(r["career_game_no"]),
                    *(to_int(r[c]) for c in legacy_cols),
                    source_id, batch.id,
                )

    started = time.time()
    copy_rows(
        pg, "player_match_stats",
        ["player_id", "match_id", "club_id", "career_game_no",
         *(STAT_COLUMNS[c] for c in legacy_cols),
         "source_id", "import_batch_id"],
        build(), batch,
    )
    pg.commit()
    count = scalar(pg, "SELECT count(*) FROM player_match_stats")
    rep.result("player_match_stats", count, f"({time.time() - started:.1f}s)")
    analyze(pg, "player_match_stats")


def import_brownlow(pg: psycopg.Connection, lite, rep: Reporter, batch) -> None:
    truncate(pg, "brownlow_season_votes", "brownlow_round_votes")
    source_id = scalar(pg, "SELECT id FROM sources WHERE key = 'afltables'")
    valid_players = {r[0] for r in pg.execute("SELECT id FROM players").fetchall()}
    valid_seasons = {r[0] for r in pg.execute("SELECT year FROM seasons").fetchall()}

    rows = lite.execute(
        "SELECT * FROM brownlow_results WHERE player_id IS NOT NULL ORDER BY season, player_id"
    ).fetchall()

    # Keep the highest-vote row if a source ever duplicates (season, player).
    best: dict[tuple[int, int], object] = {}
    for r in rows:
        batch.records_read += 1
        key = (r["season"], r["player_id"])
        if r["player_id"] not in valid_players:
            batch.reject(r["result_id"], "player_id not present in AFLDB", None)
            continue
        if r["season"] not in valid_seasons:
            batch.reject(r["result_id"], f"season {r['season']} not present in AFLDB", None)
            continue
        if key not in best or (r["votes"] or 0) > (best[key]["votes"] or 0):
            best[key] = r

    def build():
        for (season, player_id), r in best.items():
            yield (
                season, player_id, r["votes"] or 0, r["vote_rank"], r["eligible_rank"],
                bool(r["ineligible"]), bool(r["winner"]),
                to_int(r["games"]), to_int(r["three_vote_games"]),
                to_int(r["two_vote_games"]), to_int(r["one_vote_games"]),
                to_int(r["polling_games"]),
                r["match_status"] if r["match_status"] in
                ("unique", "resolved", "ambiguous", "unmatched", "implausible") else "unique",
                source_id, r["result_id"], batch.id,
            )

    copy_rows(
        pg, "brownlow_season_votes",
        ["season", "player_id", "votes", "vote_rank", "eligible_rank",
         "is_ineligible", "is_winner", "games", "three_vote_games",
         "two_vote_games", "one_vote_games", "polling_games",
         "link_status_value", "source_id", "source_record_id", "import_batch_id"],
        build(), batch,
    )

    # Round votes, joined through result_id to recover player and season.
    result_map = {r["result_id"]: (r["season"], r["player_id"]) for r in rows}
    round_rows = lite.execute("SELECT * FROM brownlow_round_votes").fetchall()

    def build_rounds():
        seen: set[tuple[int, int, int]] = set()
        for r in round_rows:
            mapped = result_map.get(r["result_id"])
            if mapped is None:
                continue
            season, player_id = mapped
            if player_id not in valid_players or season not in valid_seasons:
                continue
            key = (season, player_id, r["round_number"])
            if key in seen:
                continue
            seen.add(key)
            yield (season, player_id, r["round_number"], bool(r["played"]), to_int(r["votes"]))

    copy_rows(pg, "brownlow_round_votes",
              ["season", "player_id", "round_number", "played", "votes"],
              build_rounds())
    pg.commit()

    total = scalar(pg, "SELECT sum(votes) FROM brownlow_season_votes")
    rep.result("brownlow_season_votes", scalar(pg, "SELECT count(*) FROM brownlow_season_votes"),
               f"({total:,} votes)")
    rep.result("brownlow_round_votes", scalar(pg, "SELECT count(*) FROM brownlow_round_votes"),
               "(1984-2025 only)")


def import_stat_availability(pg: psycopg.Connection, lite, rep: Reporter) -> None:
    """Record per-season presence of each statistic.

    Deliberately computed per season rather than copied from the legacy
    stat_coverage min/max range, which conceals the 1935-1983 gap in
    per-game Brownlow votes.
    """
    truncate(pg, "stat_definitions", "stat_availability")
    with pg.cursor() as cur:
        for key, label, short, unit, order in STAT_DEFINITIONS:
            cur.execute(
                """INSERT INTO stat_definitions (key, label, short_label, unit, display_order)
                   VALUES (%s,%s,%s,%s,%s)""",
                (key, label, short, unit, order),
            )
    pg.commit()

    seasons = {r[0] for r in pg.execute("SELECT year FROM seasons").fetchall()}
    rows = []
    for key, *_ in STAT_DEFINITIONS:
        for r in lite.execute(
            f"""SELECT season, COUNT(*) total, SUM(CASE WHEN "{key}" IS NOT NULL THEN 1 ELSE 0 END) populated
                  FROM games GROUP BY season ORDER BY season"""
        ).fetchall():
            if r["season"] not in seasons:
                continue
            rows.append((key, r["season"], (r["populated"] or 0) > 0,
                         r["populated"] or 0, r["total"]))

    copy_rows(pg, "stat_availability",
              ["stat_key", "season", "is_recorded", "populated_rows", "total_rows"], rows)
    pg.commit()

    recorded = scalar(pg, "SELECT count(*) FROM stat_availability WHERE is_recorded")
    rep.result("stat_availability", len(rows), f"({recorded} season/stat pairs recorded)")

    gap = scalar(pg, """
        SELECT count(*) FROM stat_availability
         WHERE stat_key = 'brownlow' AND NOT is_recorded AND season BETWEEN 1935 AND 1983
    """)
    rep.step(f"Brownlow per-game gap confirmed: {gap} seasons 1935-1983 marked not recorded")


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

GROUPS = {
    "reference": "sources, seasons, clubs, venues",
    "players": "players",
    "matches": "matches and quarter scores",
    "stats": "player match statistics (694K rows)",
    "brownlow": "Brownlow season and round votes",
    "coverage": "stat definitions and per-season availability",
}
DEFAULT_ORDER = ["reference", "players", "matches", "stats", "brownlow", "coverage"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate legacy AFL data into AFLDB PostgreSQL.")
    parser.add_argument("--dry-run", action="store_true",
                        help="report source counts without writing")
    parser.add_argument("--groups", nargs="+", choices=DEFAULT_ORDER,
                        help="import only these groups (dependency order is preserved)")
    parser.add_argument("--list-groups", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    if args.list_groups:
        for name in DEFAULT_ORDER:
            print(f"  {name:<12} {GROUPS[name]}")
        return 0

    load_env()
    rep = Reporter(verbose=not args.quiet)
    legacy_path = require_env("AFLDB_LEGACY_SQLITE")
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")

    lite = connect_legacy(legacy_path)
    print(f"AFLDB legacy migration")
    print(f"  source: {legacy_path}")
    print(f"  target: {safe_dsn(dsn)}\n")

    if args.dry_run:
        print("  DRY RUN — no changes will be written\n")
        for table in ("players", "games", "matches", "brownlow_results", "team_seasons"):
            count = lite.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            rep.result(f"legacy {table}", count)
        return 0

    groups = [g for g in DEFAULT_ORDER if not args.groups or g in args.groups]
    pg = connect_pg(dsn)
    started = time.time()

    try:
        for group in groups:
            rep.step(f"[{group}] {GROUPS[group]}")
            if group == "reference":
                import_sources(pg, lite, rep)
                import_seasons(pg, lite, rep)
                import_clubs(pg, lite, rep)
                import_venues(pg, lite, rep)
            elif group == "players":
                with import_batch(pg, "sports_data_lab", "import_legacy_afl.py", "players") as b:
                    import_players(pg, lite, rep, b)
            elif group == "matches":
                with import_batch(pg, "afltables", "import_legacy_afl.py", "matches") as b:
                    import_matches(pg, lite, rep, b)
            elif group == "stats":
                with import_batch(pg, "fitzroy_afldata", "import_legacy_afl.py",
                                  "player_match_stats") as b:
                    import_player_match_stats(pg, lite, rep, b)
            elif group == "brownlow":
                with import_batch(pg, "afltables", "import_legacy_afl.py",
                                  "brownlow_season_votes") as b:
                    import_brownlow(pg, lite, rep, b)
            elif group == "coverage":
                import_stat_availability(pg, lite, rep)
    finally:
        lite.close()

    analyze(pg, "players", "matches", "clubs", "venues", "brownlow_season_votes")
    print(f"\nCompleted in {time.time() - started:.1f}s")

    rejected = scalar(pg, "SELECT count(*) FROM import_rejections")
    if rejected:
        rep.warn(f"{rejected} row(s) rejected — inspect import_rejections")
    pg.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
