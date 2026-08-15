#!/usr/bin/env python3
"""Parse the aflwstats.com scrape into flat staging files.

Input   D:/dev/aflw/raw/raw  (757 HTML pages, 2017-2026)
Output  data/aflw/parsed/*.csv

This stage deliberately does NO entity resolution. Team codes, player
slugs and venue strings are emitted exactly as the source publishes them,
alongside the source page they came from. Resolving them to AFLDB clubs,
players and venues is a later pass that must be re-runnable without
re-parsing 34MB of HTML.

Two source behaviours matter and are handled explicitly:

* An unplayed fixture renders as ``class="Draw"`` with ``data-value="0"``
  and an EMPTY score cell. Reading data-value alone turns every scheduled
  2026 fixture into a 0-0 draw. A fixture counts as played only when the
  score cell actually contains score spans.
* An empty player scoreboard cell means the player did not score. It is
  emitted as blank, not 0, so the staging layer keeps the source's shape
  and the reconciliation pass can prove the zero from scoring events.

Nothing is dropped. Anything that fails to parse is written to
issues.csv with enough context to find it again.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from bs4 import BeautifulSoup

DEFAULT_RAW = Path("D:/dev/aflw/raw/raw")
DEFAULT_OUT = Path(__file__).resolve().parents[2] / "data" / "aflw" / "parsed"

# The source keys Season Seven as "7" because it shares calendar 2022 with
# Season Six. Ordinal is the league's own season numbering.
SEASON_KEYS = ["2017", "2018", "2019", "2020", "2021", "2022",
               "7", "2023", "2024", "2025", "2026"]
SEASON_ORDINAL = {key: i + 1 for i, key in enumerate(SEASON_KEYS)}
SEASON_CALENDAR_YEAR = {"7": 2022, **{k: int(k) for k in SEASON_KEYS if k != "7"}}

# Both the season-page captions and the game-page round links are mapped
# through here. Values match the existing round_type enum in 003_matches.
ROUND_TYPES = {
    "elimination final": "elimination_final",
    "qualifying final": "qualifying_final",
    "semi final": "semi_final",
    "preliminary final": "preliminary_final",
    "grand final": "grand_final",
}
FINAL_TOKENS = {
    "ef": "elimination_final",
    "qf": "qualifying_final",
    "sf": "semi_final",
    "pf": "preliminary_final",
    "gf": "grand_final",
}

PLAYER_STAT_COLUMNS = [
    "kicks", "handballs", "disposals", "contested", "metres_gained",
    "marks", "hitouts", "tackles",
]


# ---------------------------------------------------------------------------
# Output plumbing
# ---------------------------------------------------------------------------

@dataclass
class Output:
    """Collects rows per file and writes them once at the end."""

    out_dir: Path
    tables: dict[str, list[dict]] = field(default_factory=dict)
    headers: dict[str, list[str]] = field(default_factory=dict)

    def add(self, table: str, header: list[str], row: dict) -> None:
        self.headers.setdefault(table, header)
        self.tables.setdefault(table, []).append(row)

    def issue(self, source: str, kind: str, detail: str) -> None:
        self.add("issues", ["source_page", "kind", "detail"],
                 {"source_page": source, "kind": kind, "detail": detail})

    def write(self) -> None:
        self.out_dir.mkdir(parents=True, exist_ok=True)
        for table, rows in sorted(self.tables.items()):
            path = self.out_dir / f"{table}.csv"
            with path.open("w", newline="", encoding="utf-8") as fh:
                writer = csv.DictWriter(fh, fieldnames=self.headers[table])
                writer.writeheader()
                writer.writerows(rows)
            print(f"  {path.name:28s} {len(rows):>7,} rows")


# ---------------------------------------------------------------------------
# Small parsing helpers
# ---------------------------------------------------------------------------

def text(node) -> str:
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip() if node else ""


def to_int(value: str) -> int | None:
    value = (value or "").strip().replace(",", "")
    if not value or value in {"-", "\u2014"}:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def to_float(value: str) -> float | None:
    value = (value or "").strip().replace(",", "")
    try:
        return float(value)
    except ValueError:
        return None


def parse_scoreboard(cell) -> tuple[int | None, int | None, int | None]:
    """Read a score-breakdown cell: goals, behinds, points.

    Returns (None, None, None) when the cell is empty. An empty cell means
    either an unplayed fixture or a player who did not score, and the
    caller has the context to tell those apart. data-value is deliberately
    ignored: the source sets it to 0 on unplayed fixtures.
    """
    if cell is None:
        return None, None, None
    goals = cell.find("span", class_="gl")
    behinds = cell.find("span", class_="bh")
    points = cell.find("span", class_="sc")
    if goals is None and behinds is None and points is None:
        return None, None, None
    return to_int(text(goals)), to_int(text(behinds)), to_int(text(points))


def parse_datetime(raw: str) -> tuple[str, str]:
    """dd/mm/yyyy HH:MM -> (iso date, time). Either half may be missing."""
    raw = (raw or "").strip()
    match = re.match(r"(\d{2})/(\d{2})/(\d{4})(?:\s+(\d{1,2}:\d{2}))?", raw)
    if not match:
        return "", ""
    day, month, year, time_of_day = match.groups()
    return f"{year}-{month}-{day}", time_of_day or ""


def classify_round(label: str) -> tuple[str, int | None, str]:
    """Caption or link text -> (round_code, round_number, round_type)."""
    label = (label or "").strip()
    number = re.match(r"(?i)round\s+(\d+)", label)
    if number:
        return number.group(1), int(number.group(1)), "home_and_away"
    # Captions are plural ("Semi Finals") while a single match is not.
    singular = re.sub(r"(?i)finals$", "final", label).strip().lower()
    if singular in ROUND_TYPES:
        round_type = ROUND_TYPES[singular]
        code = "".join(word[0] for word in singular.split()).upper()
        return code, None, round_type
    return label, None, ""


def team_code_from_href(node) -> str:
    if node is None:
        return ""
    link = node if node.name == "a" else node.find("a")
    if link is None or not link.get("href"):
        return ""
    match = re.search(r"/team/(\w+)", link["href"])
    return match.group(1) if match else ""


def player_from_cell(cell) -> tuple[str, str]:
    """Returns (slug, display name). The slug is the source's only handle
    on a person and carries no disambiguation, so it is kept verbatim."""
    link = cell.find("a") if cell else None
    if link is None:
        return "", text(cell)
    match = re.search(r"/player/([^\"/?]+)", link.get("href", ""))
    return (match.group(1) if match else ""), text(link)


# ---------------------------------------------------------------------------
# Season pages: ladders and the full fixture list
# ---------------------------------------------------------------------------

LADDER_HEADER = ["season_key", "conference", "ladder_rank", "team_code",
                 "team_name_raw", "played", "premiership_points", "percentage",
                 "wins", "draws", "losses", "points_for", "points_against",
                 "source_page"]

FIXTURE_HEADER = ["match_key", "season_key", "round_code", "round_number",
                  "round_type", "is_final", "match_date", "match_time",
                  "venue_raw", "home_team_code", "home_team_name_raw",
                  "away_team_code", "away_team_name_raw",
                  "home_goals", "home_behinds", "home_score",
                  "away_goals", "away_behinds", "away_score",
                  "is_played", "fixture_status", "source_page"]


def parse_season_page(path: Path, out: Output) -> None:
    season_key = path.stem.split("__", 1)[1]
    soup = BeautifulSoup(path.read_text(encoding="utf-8"), "lxml")
    page = path.name

    for table in soup.find_all("table"):
        caption = text(table.find("caption"))
        is_fixture = table.find("th", class_="home") is not None
        if is_fixture:
            parse_fixture_table(table, caption, season_key, page, out)
        else:
            parse_ladder_table(table, caption, season_key, page, out)


def parse_ladder_table(table, caption: str, season_key: str,
                       page: str, out: Output) -> None:
    # 2020 is the only season with conferences; its two ladders are
    # captioned "A" and "B". Every other season has one uncaptioned table.
    conference = caption if caption else ""
    for row in table.select("tbody tr"):
        cells = row.find_all("td")
        if len(cells) < 10:
            out.issue(page, "ladder_row_short", f"{conference}: {text(row)[:120]}")
            continue
        code = team_code_from_href(cells[1])
        if not code:
            out.issue(page, "ladder_team_unresolved", text(cells[1])[:120])
        out.add("ladders", LADDER_HEADER, {
            "season_key": season_key,
            "conference": conference,
            "ladder_rank": to_int(text(cells[0])),
            "team_code": code,
            "team_name_raw": text(cells[1]),
            "played": to_int(text(cells[2])),
            "premiership_points": to_int(text(cells[3])),
            "percentage": to_float(text(cells[4])),
            "wins": to_int(text(cells[5])),
            "draws": to_int(text(cells[6])),
            "losses": to_int(text(cells[7])),
            "points_for": to_int(text(cells[8])),
            "points_against": to_int(text(cells[9])),
            "source_page": page,
        })


def parse_fixture_table(table, caption: str, season_key: str,
                        page: str, out: Output) -> None:
    round_code, round_number, round_type = classify_round(caption)
    if not round_type:
        out.issue(page, "round_unclassified", caption)
        round_type = ""

    for row in table.select("tbody tr"):
        cells = row.find_all("td")
        if len(cells) < 6:
            out.issue(page, "fixture_row_short", text(row)[:120])
            continue

        home_goals, home_behinds, home_score = parse_scoreboard(cells[1])
        away_goals, away_behinds, away_score = parse_scoreboard(cells[2])

        # The only reliable played/unplayed signal. See module docstring.
        stats_link = cells[6].find("a") if len(cells) > 6 else None
        match_key = ""
        if stats_link is not None and stats_link.get("href"):
            match_key = stats_link["href"].rsplit("/", 1)[-1]
        has_score = home_score is not None and away_score is not None
        is_played = has_score and match_key != ""

        if has_score != bool(match_key):
            out.issue(page, "played_signals_disagree",
                      f"{caption}: score={has_score} link={match_key or 'none'}")

        match_date, match_time = parse_datetime(text(cells[5]))
        home_code = team_code_from_href(cells[0])
        away_code = team_code_from_href(cells[3])
        if not match_key:
            # Synthetic key for scheduled fixtures, same shape as the source's.
            match_key = f"{season_key}-{round_code}-{home_code}-{away_code}"

        out.add("fixtures", FIXTURE_HEADER, {
            "match_key": match_key,
            "season_key": season_key,
            "round_code": round_code,
            "round_number": round_number,
            "round_type": round_type,
            "is_final": round_type not in ("home_and_away", ""),
            "match_date": match_date,
            "match_time": match_time,
            "venue_raw": text(cells[4]),
            "home_team_code": home_code,
            "home_team_name_raw": text(cells[0]),
            "away_team_code": away_code,
            "away_team_name_raw": text(cells[3]),
            "home_goals": home_goals, "home_behinds": home_behinds,
            "home_score": home_score,
            "away_goals": away_goals, "away_behinds": away_behinds,
            "away_score": away_score,
            "is_played": is_played,
            "fixture_status": "played" if is_played else "",  # set in a second pass
            "source_page": page,
        })


# ---------------------------------------------------------------------------
# Game pages: match detail, player statistics, scoring progression
# ---------------------------------------------------------------------------

MATCH_HEADER = ["match_key", "season_key", "round_code", "round_number",
                "round_type", "is_final", "match_date", "match_time",
                "venue_raw", "weather_raw",
                "home_team_code", "home_team_name_raw",
                "away_team_code", "away_team_name_raw",
                "home_goals", "home_behinds", "home_score",
                "away_goals", "away_behinds", "away_score", "source_page"]

PMS_HEADER = ["match_key", "season_key", "team_code", "player_slug",
              "player_name_raw", "jumper_number", "position",
              *PLAYER_STAT_COLUMNS,
              "goals", "behinds", "score_points", "fantasy_points",
              "source_page"]

EVENT_HEADER = ["match_key", "season_key", "event_seq", "period", "clock",
                "team_code", "event_type", "player_name_raw", "points",
                "home_goals", "home_behinds", "away_goals", "away_behinds",
                "source_page"]

# The scoring worm leaks its server-side struct into the SVG as a CDATA
# comment: {2 gws <ptr> <ptr> <ptr> 1 2m42s BEHIND 1 a -1}. It is the only
# place the scoring team is machine-readable, so it is parsed alongside the
# human-readable <title>, and the two are cross-checked.
EVENT_STRUCT = re.compile(
    r"\{\d+\s+(?P<team>\w+)\s+\S+\s+\S+\s+\S+\s+"
    r"(?P<period>\d+)\s+(?P<clock>\d+m\d+s)\s+"
    r"(?P<type>[A-Z ]+?)\s+(?P<points>\d+)\s+(?P<side>[ha])\s+(?P<margin>-?\d+)\}"
)
EVENT_TITLE = re.compile(
    r"^Q(?P<period>\d+)\s+(?P<clock>\d+m\d+s)\s*\n"
    # Closed set. "RUSHED BEHIND" must be tried before "BEHIND", and its
    # trailing text is a club nickname rather than a scorer.
    r"(?P<type>RUSHED BEHIND|BEHIND|GOAL)(?:\s+(?P<player>.+?))?\s*\n"
    r"(?P<hteam>.+?)\s+(?P<hg>\d+)\.(?P<hb>\d+)\s+v\s+(?P<ateam>.+?)\s+(?P<ag>\d+)\.(?P<ab>\d+)\s*$"
)


def parse_game_page(path: Path, out: Output) -> None:
    match_key = path.stem.split("__", 1)[1]
    season_key = match_key.split("-", 1)[0]
    soup = BeautifulSoup(path.read_text(encoding="utf-8"), "lxml")
    page = path.name

    header = parse_game_header(soup, match_key, season_key, page, out)
    if header is not None:
        out.add("matches", MATCH_HEADER, header)
    parse_scoring_events(soup, match_key, season_key, page, out)
    parse_stat_tables(soup, match_key, season_key, page, out)


def parse_game_header(soup, match_key: str, season_key: str,
                      page: str, out: Output) -> dict | None:
    row = soup.find("div", class_="row")
    if row is None:
        out.issue(page, "game_header_missing", "no header row")
        return None
    columns = row.find_all("div", recursive=False)
    if len(columns) < 3:
        out.issue(page, "game_header_missing", f"{len(columns)} header columns")
        return None

    def side(column) -> tuple[str, str, int | None, int | None, int | None]:
        heading = column.find(["h2", "h3"])
        code = team_code_from_href(heading)
        name = text(heading.find("a")) if heading and heading.find("a") else ""
        # "7.6 48" sits as a bare text node after the club link.
        score = re.search(r"(\d+)\.(\d+)\s+(\d+)", text(heading))
        if not score:
            return code, name, None, None, None
        return code, name, int(score.group(1)), int(score.group(2)), int(score.group(3))

    home_code, home_name, home_goals, home_behinds, home_score = side(columns[0])
    away_code, away_name, away_goals, away_behinds, away_score = side(columns[2])
    if home_score is None or away_score is None:
        out.issue(page, "game_score_unparsed", text(row)[:160])

    centre = columns[1]
    round_label = text(centre.find("a")) if centre.find("a") else ""
    round_code, round_number, round_type = classify_round(round_label)
    if not round_type:
        # 2024/2025 finals use uppercase tokens in the key (…-GF-kan-brl).
        token = match_key.split("-")[1].lower()
        round_type = FINAL_TOKENS.get(token, "")
        if not round_type:
            out.issue(page, "round_unclassified", f"{round_label!r} / {token!r}")

    # Venue and kickoff are bare text nodes between <br/> tags.
    lines = [line.strip() for line in centre.find("h4").stripped_strings] \
        if centre.find("h4") else []
    lines = [line for line in lines if line and line != round_label]
    venue = lines[0] if lines else ""
    match_date, match_time = parse_datetime(lines[1] if len(lines) > 1 else "")
    weather = centre.find("i", class_="weather")

    return {
        "match_key": match_key, "season_key": season_key,
        "round_code": round_code, "round_number": round_number,
        "round_type": round_type,
        "is_final": round_type not in ("home_and_away", ""),
        "match_date": match_date, "match_time": match_time,
        "venue_raw": venue,
        "weather_raw": weather.get("title", "") if weather else "",
        "home_team_code": home_code, "home_team_name_raw": home_name,
        "away_team_code": away_code, "away_team_name_raw": away_name,
        "home_goals": home_goals, "home_behinds": home_behinds,
        "home_score": home_score,
        "away_goals": away_goals, "away_behinds": away_behinds,
        "away_score": away_score,
        "source_page": page,
    }


def parse_scoring_events(soup, match_key: str, season_key: str,
                         page: str, out: Output) -> None:
    svg = soup.find("svg")
    if svg is None:
        out.issue(page, "scoring_worm_missing", "no svg")
        return

    structs = EVENT_STRUCT.findall(str(svg))
    titles = [text_node for text_node in svg.find_all("title")]
    if len(structs) != len(titles):
        out.issue(page, "event_count_mismatch",
                  f"{len(structs)} structs vs {len(titles)} titles")

    for seq, title in enumerate(titles):
        raw = title.get_text("\n", strip=True)
        parsed = EVENT_TITLE.match(raw)
        if parsed is None:
            out.issue(page, "event_title_unparsed", raw.replace("\n", " | ")[:160])
            continue
        struct = structs[seq] if seq < len(structs) else None
        team_code, points = "", None
        if struct is not None:
            team_code, struct_period, _clock, struct_type, points = (
                struct[0], struct[1], struct[2], struct[3].strip(), to_int(struct[4]))
            if struct_period != parsed.group("period"):
                out.issue(page, "event_period_disagrees",
                          f"struct Q{struct_period} vs title Q{parsed.group('period')}")
            if struct_type != parsed.group("type").strip():
                out.issue(page, "event_type_disagrees",
                          f"{struct_type} vs {parsed.group('type').strip()}")
        else:
            out.issue(page, "event_team_unknown", raw.replace("\n", " | ")[:120])

        # "GOAL Erin Phillips (Crows)" -> player; "RUSHED BEHIND Crows" -> none.
        player = parsed.group("player") or ""
        named = re.match(r"^(?P<name>.+?)\s*\((?P<club>.+)\)$", player)
        player_name = named.group("name") if named else ""

        out.add("scoring_events", EVENT_HEADER, {
            "match_key": match_key, "season_key": season_key,
            "event_seq": seq + 1,
            "period": to_int(parsed.group("period")),
            "clock": parsed.group("clock"),
            "team_code": team_code,
            "event_type": parsed.group("type").strip(),
            "player_name_raw": player_name,
            "points": points,
            "home_goals": to_int(parsed.group("hg")),
            "home_behinds": to_int(parsed.group("hb")),
            "away_goals": to_int(parsed.group("ag")),
            "away_behinds": to_int(parsed.group("ab")),
            "source_page": page,
        })


def parse_stat_tables(soup, match_key: str, season_key: str,
                      page: str, out: Output) -> None:
    tables = [t for t in soup.find_all("table") if t.find("th", class_="player")]
    if len(tables) != 2:
        out.issue(page, "stat_table_count", f"{len(tables)} tables, expected 2")

    for table in tables:
        caption = table.find("caption")
        team_code = ""
        image = caption.find("img") if caption else None
        if image is not None and image.get("src"):
            match = re.search(r"/static/(?:lg/)?(\w+)\.png", image["src"])
            team_code = match.group(1) if match else ""
        if not team_code:
            out.issue(page, "stat_table_team_unknown", text(caption)[:80])

        headers = [text(th).lower() for th in table.select("thead th")]
        if len(headers) != 13:
            out.issue(page, "stat_header_shape",
                      f"{len(headers)} columns: {headers}")

        for row in table.select("tbody tr"):
            cells = row.find_all("td")
            if len(cells) < 13:
                out.issue(page, "stat_row_short",
                          f"{len(cells)} cells: {text(row)[:100]}")
                continue
            slug, name = player_from_cell(cells[0])
            if not slug:
                out.issue(page, "player_slug_missing", name[:80])
            goals, behinds, points = parse_scoreboard(cells[11])
            out.add("player_match_stats", PMS_HEADER, {
                "match_key": match_key, "season_key": season_key,
                "team_code": team_code,
                "player_slug": slug, "player_name_raw": name,
                # Jumper numbers are identifiers, not quantities.
                "jumper_number": text(cells[1]),
                "position": text(cells[2]),
                "kicks": to_int(text(cells[3])),
                "handballs": to_int(text(cells[4])),
                "disposals": to_int(text(cells[5])),
                "contested": to_int(text(cells[6])),
                "metres_gained": to_int(text(cells[7])),
                "marks": to_int(text(cells[8])),
                "hitouts": to_int(text(cells[9])),
                "tackles": to_int(text(cells[10])),
                # Blank, not 0: an empty cell is the source saying nothing.
                "goals": goals, "behinds": behinds, "score_points": points,
                "fantasy_points": to_int(text(cells[12])),
                "source_page": page,
            })


# ---------------------------------------------------------------------------
# Season player pages: the source's own per-season totals (cross-check)
# ---------------------------------------------------------------------------

PLAYER_SEASON_HEADER = ["season_key", "team_code", "player_slug",
                        "player_name_raw", "games", "kicks", "handballs",
                        "disposals", "contested", "metres_gained", "marks",
                        "tackles", "hitouts", "fantasy_points",
                        "goals", "behinds", "score_points", "source_page"]


def parse_players_page(path: Path, out: Output) -> None:
    season_key = path.stem.split("__", 1)[1]
    soup = BeautifulSoup(path.read_text(encoding="utf-8"), "lxml")
    page = path.name
    table = soup.find("table")
    if table is None:
        out.issue(page, "players_table_missing", "no table")
        return

    for row in table.select("tbody tr"):
        cells = row.find_all("td")
        if len(cells) < 13:
            out.issue(page, "player_season_row_short", text(row)[:120])
            continue
        slug, name = player_from_cell(cells[1])
        goals, behinds, points = parse_scoreboard(cells[12])
        out.add("player_seasons", PLAYER_SEASON_HEADER, {
            "season_key": season_key,
            "team_code": team_code_from_href(cells[0]),
            "player_slug": slug, "player_name_raw": name,
            "games": to_int(text(cells[2])),
            "kicks": to_int(text(cells[3])),
            "handballs": to_int(text(cells[4])),
            "disposals": to_int(text(cells[5])),
            "contested": to_int(text(cells[6])),
            "metres_gained": to_int(text(cells[7])),
            "marks": to_int(text(cells[8])),
            "tackles": to_int(text(cells[9])),
            "hitouts": to_int(text(cells[10])),
            "fantasy_points": to_int(text(cells[11])),
            "goals": goals, "behinds": behinds, "score_points": points,
            "source_page": page,
        })


# ---------------------------------------------------------------------------
# Seasons manifest
# ---------------------------------------------------------------------------

SEASON_HEADER = ["season_key", "ordinal", "calendar_year", "display_label",
                 "first_fixture_date", "last_fixture_date", "fixture_count",
                 "played_count", "ladder_group_count", "has_grand_final"]


def classify_fixture_status(out: Output) -> None:
    """Separate a fixture that was never played from one not yet played.

    Both render identically. The discriminator is position within the
    season: an unplayed fixture scheduled BEFORE the season's last played
    match was abandoned, while one scheduled after it is still to come.
    Deliberately not based on today's date, so a re-parse of the same
    scrape always produces the same answer.
    """
    fixtures = out.tables.get("fixtures", [])
    last_played: dict[str, str] = {}
    for row in fixtures:
        if row["is_played"] and row["match_date"]:
            key = row["season_key"]
            last_played[key] = max(last_played.get(key, ""), row["match_date"])

    for row in fixtures:
        if row["is_played"]:
            continue
        cutoff = last_played.get(row["season_key"], "")
        if cutoff and row["match_date"] and row["match_date"] < cutoff:
            row["fixture_status"] = "cancelled"
            out.issue(row["source_page"], "fixture_never_played",
                      f"{row['match_key']} on {row['match_date']}, season played "
                      f"through {cutoff}")
        else:
            row["fixture_status"] = "scheduled"


def build_seasons(out: Output) -> None:
    fixtures = out.tables.get("fixtures", [])
    ladders = out.tables.get("ladders", [])
    for key in SEASON_KEYS:
        rows = [f for f in fixtures if f["season_key"] == key]
        if not rows:
            out.issue(f"season__{key}.html", "season_no_fixtures", key)
            continue
        dates = sorted(d for d in (f["match_date"] for f in rows) if d)
        groups = {l["conference"] for l in ladders if l["season_key"] == key}
        ordinal = SEASON_ORDINAL[key]
        year = SEASON_CALENDAR_YEAR[key]
        out.add("seasons", SEASON_HEADER, {
            "season_key": key,
            "ordinal": ordinal,
            "calendar_year": year,
            # Two seasons share 2022, so the year alone cannot label them.
            "display_label": f"{year} (Season {ordinal})" if year == 2022 else str(year),
            "first_fixture_date": dates[0] if dates else "",
            "last_fixture_date": dates[-1] if dates else "",
            "fixture_count": len(rows),
            "played_count": sum(1 for f in rows if f["is_played"]),
            "ladder_group_count": len(groups),
            "has_grand_final": any(f["round_type"] == "grand_final" for f in rows),
        })


# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, default=DEFAULT_RAW)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    if not args.raw.is_dir():
        sys.exit(f"ERROR: raw directory not found: {args.raw}")

    out = Output(out_dir=args.out)

    seasons = sorted(args.raw.glob("season__*.html"))
    games = sorted(args.raw.glob("game__*.html"))
    players = sorted(args.raw.glob("players__*.html"))
    print(f"Parsing {len(seasons)} season, {len(games)} game, "
          f"{len(players)} player pages from {args.raw}")

    for path in seasons:
        parse_season_page(path, out)
    for index, path in enumerate(games, 1):
        parse_game_page(path, out)
        if index % 100 == 0:
            print(f"  ... {index}/{len(games)} games")
    for path in players:
        parse_players_page(path, out)

    classify_fixture_status(out)
    build_seasons(out)

    print("\nWriting:")
    out.write()

    issues = len(out.tables.get("issues", []))
    print(f"\n{issues:,} issue(s) recorded." if issues else "\nNo issues recorded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
