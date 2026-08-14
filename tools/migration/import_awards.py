#!/usr/bin/env python3
"""Import awards, honours and captaincies — AFLDB Phase 3b.

    python tools/migration/import_awards.py                 # full run
    python tools/migration/import_awards.py --dry-run       # counts only
    python tools/migration/import_awards.py --groups rising_star
    python tools/migration/import_awards.py --list-groups

Every target table already exists (migration 005). This importer fills
them from the legacy SQLite database, which holds the scraped award data
that Phase 3 deliberately left until the core entities were proven.

Like the core importer, each group truncates its targets and reloads, so
a rerun always produces the same result, and nothing is written to the
legacy database.

Two rules carried over from Phase 3
-----------------------------------
* **An unlinked row is still a row.** ``player_id`` is NULL when the
  source name could not be tied to a player with confidence, and the
  source spelling is always kept. 95 Hall of Fame inductees and 65
  pre-1979 All-Australians are state-league figures with no VFL/AFL
  record; discarding them would be a worse lie than admitting the link
  is missing.
* **A club is named as it was at the time.** The award sources use
  modern club names throughout — draftguru lists a 1980 Charles Sutton
  Medal against "Western Bulldogs" — so every club reference is resolved
  through the identity that was actually trading that season.
"""

from __future__ import annotations

import argparse
import json
import re
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
    set_reload_scope,
    to_int,
    truncate,
)

# ---------------------------------------------------------------------------
# Link status
# ---------------------------------------------------------------------------
# The legacy vocabulary is wider than AFLDB's link_status enum because it
# records *how* a link was made as well as how far it is trusted. Only
# 'unique' and 'resolved' may be treated as confirmed, so anything that
# produced a player id maps into those two and everything else maps to a
# status that reads as "not trusted".
LINK_STATUS = {
    "unique": "unique",
    "resolved": "resolved",
    "from_draft": "resolved",     # resolved via the draft link, and trusted there
    "ambiguous": "ambiguous",
    "unmatched": "unmatched",
    "implausible": "implausible",
    "unevidenced": "ambiguous",   # candidates existed, none could be evidenced
}


def link_status(raw: str | None, player_id: int | None) -> str:
    """Map a legacy match status onto the AFLDB enum.

    A status is never allowed to disagree with the data: a row carrying a
    player id is a link, and a row without one is not, whatever the
    source called it.
    """
    status = LINK_STATUS.get((raw or "").strip().lower(), "unmatched")
    if player_id is None and status in ("unique", "resolved"):
        return "unmatched"
    if player_id is not None and status not in ("unique", "resolved"):
        return "resolved"
    return status


# ---------------------------------------------------------------------------
# Clubs
# ---------------------------------------------------------------------------
# Spellings the award sources use that the club_aliases table does not
# carry. Each maps to a club identity slug; the season then decides which
# identity within that club's lineage is correct.
SOURCE_CLUB_ALIASES = {
    "brisbane": "brisbane-lions",          # season-aware, see resolve_club
    "adelaide crows": "adelaide",
    "geelong cats": "geelong",
    "sydney swans": "sydney",
    "gws giants": "greater-western-sydney",
    "gws": "greater-western-sydney",
    "greater western sydney": "greater-western-sydney",
    "gold coast suns": "gold-coast",
    "west coast eagles": "west-coast",
    "kangaroos": "kangaroos",
    "footscray": "footscray",
    "south melbourne": "south-melbourne",
}


def normalise_club(value: str | None) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    text = text.lower().replace(".", "").replace("'", "")
    return re.sub(r"\s+", " ", text).strip() or None


class ClubResolver:
    """Resolves a source club string and season to the identity of the era.

    Two lookups, deliberately separate. The *organization* is the club as
    a continuing entity, which is what a name identifies; the *identity*
    is the name it traded under in a given season, which is what the row
    should point at. Resolving in one step is what previously gave Sydney
    ladder rows back to 1897.
    """

    def __init__(self, pg: psycopg.Connection) -> None:
        with pg.cursor() as cur:
            cur.execute(
                """SELECT id, slug, name, organization_id, first_season, last_season
                     FROM clubs ORDER BY organization_id, first_season"""
            )
            self.clubs = {
                r[0]: {
                    "id": r[0], "slug": r[1], "name": r[2], "org": r[3],
                    "first": r[4], "last": r[5],
                }
                for r in cur.fetchall()
            }
            cur.execute("SELECT club_id, alias FROM club_aliases")
            alias_rows = cur.fetchall()

        self.by_slug = {c["slug"]: c for c in self.clubs.values()}
        # Identities grouped by organization, earliest first.
        self.by_org: dict[int, list[dict]] = {}
        for club in self.clubs.values():
            self.by_org.setdefault(club["org"], []).append(club)
        for members in self.by_org.values():
            members.sort(key=lambda c: (c["first"] or 0))

        self.alias_map: dict[str, dict] = {}
        for club_id, alias in alias_rows:
            key = normalise_club(alias)
            if key:
                self.alias_map[key] = self.clubs[club_id]
        for club in self.clubs.values():
            for text in (club["name"], club["slug"].replace("-", " ")):
                key = normalise_club(text)
                if key:
                    self.alias_map.setdefault(key, club)
        for alias, slug in SOURCE_CLUB_ALIASES.items():
            if slug in self.by_slug:
                self.alias_map[alias] = self.by_slug[slug]

        self.unresolved: dict[str, int] = {}

    def identity_for_season(self, org_id: int, season: int | None) -> dict | None:
        """The identity trading in a season, clamped to the club's span.

        Clamping matters for sources that name a club by its present
        identity outside that identity's own era — a captain list headed
        "Western Bulldogs" covering 1925 onwards. Without it the row would
        be dropped; with it the row lands on Footscray, which is correct.
        """
        members = self.by_org.get(org_id, [])
        if not members:
            return None
        if season is None:
            return members[-1]
        # The narrower, later-starting identity wins: Kangaroos sits
        # inside North Melbourne's span.
        best = None
        for club in members:
            first = club["first"]
            last = club["last"]
            if (first is None or season >= first) and (last is None or season <= last):
                if best is None or (club["first"] or 0) > (best["first"] or 0):
                    best = club
        if best is not None:
            return best
        if season < (members[0]["first"] or season):
            return members[0]
        return members[-1]

    def resolve(self, value: str | None, season: int | None) -> tuple[int | None, str | None]:
        """Return (club_id, raw_name). club_id is None for a non-AFL club."""
        raw = clean_text(value)
        key = normalise_club(value)
        if not key:
            return None, raw

        club = self.alias_map.get(key)
        if club is None:
            self.unresolved[raw or key] = self.unresolved.get(raw or key, 0) + 1
            return None, raw

        org = club["org"]
        # "Brisbane" is the Bears before 1997 and the Lions after. They
        # are separate organizations — a merger, not a rename — so the
        # season has to pick between them before the identity lookup.
        if key == "brisbane" and season is not None and season < 1997:
            bears = self.by_slug.get("brisbane-bears")
            if bears is not None:
                org = bears["org"]

        identity = self.identity_for_season(org, season)
        return (identity["id"] if identity else club["id"]), raw


# ---------------------------------------------------------------------------
# Award definitions
# ---------------------------------------------------------------------------
COMPETITION_RE = re.compile(r"\(([^)]+)\)\s*$")

ALL_AUSTRALIAN_SLUG = "all-australian"
RISING_STAR_SLUG = "rising-star"


def slugify(value: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return text or "award"


def award_slug(category: str, legacy_slug: str, award_name: str) -> str:
    """A stable, unique slug per award.

    Club best-and-fairests are namespaced because the legacy slug is the
    club key: 'north_melbourne' would otherwise collide with anything
    else keyed on a club.
    """
    if category == "club_best_and_fairest":
        return f"bf-{slugify(legacy_slug or award_name)}"
    return slugify(legacy_slug or award_name)


def split_competition(award_name: str) -> tuple[str, str | None]:
    """'Coleman Medal (AFL)' -> ('Coleman Medal', 'AFL')."""
    match = COMPETITION_RE.search(award_name or "")
    if not match:
        return (award_name or "").strip(), None
    return COMPETITION_RE.sub("", award_name).strip(), match.group(1).strip()


AWARD_DESCRIPTIONS = {
    RISING_STAR_SLUG:
        "Awarded to the season's best young player. One player is nominated "
        "each round; the nominees then contest the award. Nominations are "
        "recorded from 1993.",
    ALL_AUSTRALIAN_SLUG:
        "The representative team of the season's best players. Selected from "
        "interstate carnivals until 1982 and from the national competition "
        "since; players from other leagues appear in the earlier teams.",
    "coleman": "Awarded to the leading goalkicker of the home-and-away season.",
    "norm-smith-medal": "Awarded to the best player afield in the Grand Final.",
    "brownlow-medal":
        "Awarded to the fairest and best player of the season. AFLDB holds "
        "the full vote history separately, from 1924.",
}


# ---------------------------------------------------------------------------
# Group: awards and their winners
# ---------------------------------------------------------------------------
def import_awards(pg, lite, rep: Reporter, batch, clubs: ClubResolver,
                  sources: dict[str, int], person_links: dict[int, tuple]) -> None:
    truncate(pg, "awards")

    rows = lite.execute(
        """SELECT award_category, award_name, award_slug, source_category, season,
                  player, player_url, club, original_club, votes, prior_games,
                  season_games, season_goals, career_games, games, goals,
                  drafted_text, clubs_text, note, awards_text, source_url,
                  source_row, dg_person_id
             FROM awards
            ORDER BY award_category, award_slug, season, player"""
    ).fetchall()

    # 1. Definitions, one per distinct award.
    definitions: dict[str, dict] = {}
    for r in rows:
        category = r["award_category"]
        slug = award_slug(category, r["award_slug"], r["award_name"])
        name, competition = split_competition(r["award_name"])
        entry = definitions.setdefault(slug, {
            "slug": slug,
            "name": name,
            "category": category,
            "competition": competition,
            "club_key": r["club"] if category == "club_best_and_fairest" else None,
            "first": r["season"],
            "last": r["season"],
        })
        if r["season"] is not None:
            entry["first"] = min(entry["first"] or r["season"], r["season"])
            entry["last"] = max(entry["last"] or r["season"], r["season"])

    # The All-Australian team is a separate source; its definition is
    # created here so every award lives in one table.
    definitions[ALL_AUSTRALIAN_SLUG] = {
        "slug": ALL_AUSTRALIAN_SLUG,
        "name": "All-Australian Team",
        "category": "honour_team",
        "competition": "AFL",
        "club_key": None,
        "first": None,
        "last": None,
    }
    aa_span = lite.execute(
        """SELECT min(season), max(season) FROM (
               SELECT season FROM all_australian
               UNION SELECT season FROM all_australian_history)"""
    ).fetchone()
    definitions[ALL_AUSTRALIAN_SLUG]["first"] = aa_span[0]
    definitions[ALL_AUSTRALIAN_SLUG]["last"] = aa_span[1]

    def build_definitions():
        for entry in definitions.values():
            batch.records_read += 1
            club_id = None
            if entry["club_key"]:
                # A club award belongs to the club as it is now; each
                # winner row still carries the identity of its own season.
                club_id, _ = clubs.resolve(entry["club_key"], entry["last"])
            yield (
                entry["slug"], entry["name"], entry["category"], entry["competition"],
                club_id, AWARD_DESCRIPTIONS.get(entry["slug"]),
                entry["first"], entry["last"],
            )

    copy_rows(
        pg, "awards",
        ["slug", "name", "category", "competition", "club_id",
         "description", "first_season", "last_season"],
        build_definitions(), batch,
    )
    pg.commit()

    with pg.cursor() as cur:
        cur.execute("SELECT slug, id FROM awards")
        award_ids = dict(cur.fetchall())

    # 2. Winners.
    truncate(pg, "award_winners")
    source_id = sources.get("draftguru")

    def build_winners():
        for row_no, r in enumerate(rows, start=1):
            batch.records_read += 1
            slug = award_slug(r["award_category"], r["award_slug"], r["award_name"])
            award_id = award_ids.get(slug)
            player = clean_text(r["player"])
            if award_id is None or not player:
                batch.reject(r["source_row"], "award or player name missing", dict(r))
                continue

            linked = person_links.get(r["dg_person_id"]) if r["dg_person_id"] else None
            player_id = linked[0] if linked else None
            status = link_status(linked[1] if linked else None, player_id)
            club_id, club_raw = clubs.resolve(r["club"], r["season"])

            # Everything the source said that has no column of its own is
            # kept as a note rather than dropped.
            notes = [clean_text(r["note"]), clean_text(r["awards_text"])]
            if clean_text(r["original_club"]):
                notes.append(f"Recruited from {clean_text(r['original_club'])}")
            note = " · ".join(n for n in notes if n) or None

            # source_row is the row number on the scraped PAGE, which
            # repeats across seasons of one award. A source record id
            # must identify the record, so it is namespaced here; the
            # ordered enumerate keeps it unique even if a page listed
            # the same player twice.
            record_id = f"{slug}:{r['season']}:{row_no}"
            yield (
                award_id, r["season"], player_id, player, status,
                linked[2] if linked else 0,
                club_id, club_raw,
                r["votes"],
                None, False, False, note,
                source_id, record_id, batch.id,
            )

    copy_rows(
        pg, "award_winners",
        ["award_id", "season", "player_id", "player_name_raw", "link_status_value",
         "candidate_count", "club_id", "club_name_raw", "votes", "position",
         "is_captain", "is_vice_captain", "note", "source_id", "source_record_id",
         "import_batch_id"],
        build_winners(), batch,
    )
    pg.commit()

    rep.result("awards", scalar(pg, "SELECT count(*) FROM awards"))
    rep.result("award_winners", scalar(pg, "SELECT count(*) FROM award_winners"),
               f"({scalar(pg, 'SELECT count(*) FROM award_winners WHERE player_id IS NOT NULL')} linked)")


# ---------------------------------------------------------------------------
# Group: All-Australian
# ---------------------------------------------------------------------------
def import_all_australian(pg, lite, rep: Reporter, batch, clubs: ClubResolver,
                          sources: dict[str, int], person_links: dict[int, tuple]) -> None:
    """Load the All-Australian teams from both legacy sources.

    ``all_australian`` is draftguru's 1979-2025 table and carries position
    and captaincy; ``all_australian_history`` is the Wikipedia scrape and
    reaches back to the 1953 carnival team. Neither is complete on its
    own — the history table is missing 2025 and the draftguru table is
    missing eleven earlier seasons — so the richer row wins where both
    describe a season, and the other fills the gaps.
    """
    with pg.cursor() as cur:
        cur.execute("SELECT id FROM awards WHERE slug = %s", (ALL_AUSTRALIAN_SLUG,))
        row = cur.fetchone()
        if row is None:
            raise RuntimeError(
                "the all-australian award definition is missing; "
                "run the 'awards' group first"
            )
        award_id = row[0]
        cur.execute("DELETE FROM award_winners WHERE award_id = %s", (award_id,))
    pg.commit()

    detailed = lite.execute(
        """SELECT season, player, club, position, is_captain, is_vice_captain,
                  times_aa, source_url, source_row, dg_person_id
             FROM all_australian ORDER BY season, player"""
    ).fetchall()
    detailed_seasons = {r["season"] for r in detailed}

    history = lite.execute(
        """SELECT season, player_source, club_source, player_id, match_status,
                  candidate_count, source_url
             FROM all_australian_history ORDER BY season, player_source"""
    ).fetchall()

    def build():
        # Source record ids are namespaced per source: draftguru's
        # source_row repeats across seasons, so it cannot stand alone.
        for row_no, r in enumerate(detailed, start=1):
            batch.records_read += 1
            player = clean_text(r["player"])
            if not player:
                continue
            linked = person_links.get(r["dg_person_id"]) if r["dg_person_id"] else None
            player_id = linked[0] if linked else None
            status = link_status(linked[1] if linked else None, player_id)
            club_id, club_raw = clubs.resolve(r["club"], r["season"])
            times = to_int(r["times_aa"])
            yield (
                award_id, r["season"], player_id, player, status,
                linked[2] if linked else 0,
                club_id, club_raw, None,
                clean_text(r["position"]),
                bool(r["is_captain"]), bool(r["is_vice_captain"]),
                f"{times} time All-Australian" if times else None,
                sources.get("draftguru"), f"aa:{r['season']}:{row_no}", batch.id,
            )

        for r in history:
            if r["season"] in detailed_seasons:
                continue  # the draftguru row already covers this season
            batch.records_read += 1
            # The Wikipedia scrape marks the era's selections with an
            # asterisk; it is a footnote, not part of the name.
            player = clean_text((r["player_source"] or "").rstrip("*"))
            if not player:
                continue
            player_id = r["player_id"]
            status = link_status(r["match_status"], player_id)
            club_id, club_raw = clubs.resolve(r["club_source"], r["season"])
            # (season, player_source, club_source) is the source table's
            # own unique key.
            yield (
                award_id, r["season"], player_id, player, status,
                to_int(r["candidate_count"]) or 0,
                club_id, club_raw, None,
                None, False, False, None,
                sources.get("wikipedia"),
                f"aah:{r['season']}:{r['player_source']}:{r['club_source'] or ''}", batch.id,
            )

    copy_rows(
        pg, "award_winners",
        ["award_id", "season", "player_id", "player_name_raw", "link_status_value",
         "candidate_count", "club_id", "club_name_raw", "votes", "position",
         "is_captain", "is_vice_captain", "note", "source_id", "source_record_id",
         "import_batch_id"],
        build(), batch,
    )

    with pg.cursor() as cur:
        cur.execute(
            "UPDATE awards SET first_season = %s, last_season = %s WHERE id = %s",
            (
                scalar(pg, "SELECT min(season) FROM award_winners WHERE award_id = %s", (award_id,)),
                scalar(pg, "SELECT max(season) FROM award_winners WHERE award_id = %s", (award_id,)),
                award_id,
            ),
        )
    pg.commit()

    total = scalar(pg, "SELECT count(*) FROM award_winners WHERE award_id = %s", (award_id,))
    linked = scalar(
        pg,
        "SELECT count(*) FROM award_winners WHERE award_id = %s AND player_id IS NOT NULL",
        (award_id,),
    )
    seasons = scalar(
        pg, "SELECT count(DISTINCT season) FROM award_winners WHERE award_id = %s", (award_id,)
    )
    rep.result("all_australian selections", total, f"({seasons} seasons, {linked} linked)")


# ---------------------------------------------------------------------------
# Group: Rising Star nominations
# ---------------------------------------------------------------------------
STAT_COLUMNS = [
    "kicks", "handballs", "disposals", "marks", "goals", "behinds",
    "tackles", "hitouts", "frees_for", "frees_against", "supercoach", "afl_fantasy",
]


def import_rising_star(pg, lite, rep: Reporter, batch, clubs: ClubResolver,
                       sources: dict[str, int]) -> None:
    """Load every round-by-round Rising Star nomination, 1993 on.

    The award itself is already in ``awards`` from the draftguru load —
    this adds the nominees, which is the part that makes the award
    browsable rather than a list of 33 winners.
    """
    truncate(pg, "award_nominations")

    with pg.cursor() as cur:
        cur.execute("SELECT id FROM awards WHERE slug = %s", (RISING_STAR_SLUG,))
        row = cur.fetchone()
        if row is None:
            raise RuntimeError(
                "the rising-star award definition is missing; "
                "run the 'awards' group first"
            )
        award_id = row[0]
        cur.execute("SELECT year FROM seasons")
        valid_seasons = {r[0] for r in cur.fetchall()}
        cur.execute("SELECT id FROM players")
        valid_players = {r[0] for r in cur.fetchall()}

    rows = lite.execute(
        """SELECT source_key, season, round_number, player, player_display, club,
                  opponent, is_season_winner, ineligible, ineligible_reason, votes,
                  player_id, match_status, candidate_count, source_url,
                  kicks, handballs, disposals, marks, goals, behinds, tackles,
                  hitouts, frees_for, frees_against, supercoach, afl_fantasy
             FROM rising_star_nominees
            ORDER BY season, round_number, player"""
    ).fetchall()

    source_id = sources.get("footywire")

    def build():
        for r in rows:
            batch.records_read += 1
            # player_display is FootyWire's abbreviated form ("M Reid");
            # player carries the full name.
            player = clean_text(r["player"]) or clean_text(r["player_display"])
            if not player or r["season"] not in valid_seasons:
                batch.reject(r["source_key"], "missing player or unknown season", dict(r))
                continue

            player_id = r["player_id"] if r["player_id"] in valid_players else None
            status = link_status(r["match_status"], player_id)
            club_id, _ = clubs.resolve(r["club"], r["season"])
            opponent_id, _ = clubs.resolve(r["opponent"], r["season"])

            # Statistics are kept as recorded, NULL included: a nomination
            # from 1993 has no tackle count because tackles were not
            # collected, which is not the same as none being laid.
            stats = {k: to_int(r[k]) for k in STAT_COLUMNS}
            stats = {k: v for k, v in stats.items() if v is not None}

            yield (
                award_id, r["season"], to_int(r["round_number"]),
                player_id, player, status,
                club_id, opponent_id,
                bool(r["is_season_winner"]), bool(r["ineligible"]),
                clean_text(r["ineligible_reason"]),
                to_int(r["votes"]),
                json.dumps(stats) if stats else None,
                source_id, r["source_key"], batch.id,
            )

    copy_rows(
        pg, "award_nominations",
        ["award_id", "season", "round_number", "player_id", "player_name_raw",
         "link_status_value", "club_id", "opponent_club_id", "is_winner",
         "is_ineligible", "ineligible_reason", "votes", "stat_line",
         "source_id", "source_record_id", "import_batch_id"],
        build(), batch,
    )
    pg.commit()

    total = scalar(pg, "SELECT count(*) FROM award_nominations")
    linked = scalar(pg, "SELECT count(*) FROM award_nominations WHERE player_id IS NOT NULL")
    seasons = scalar(pg, "SELECT count(DISTINCT season) FROM award_nominations")
    winners = scalar(pg, "SELECT count(*) FROM award_nominations WHERE is_winner")
    rep.result("award_nominations", total, f"({seasons} seasons, {linked} linked)")
    rep.result("  of which season winners", winners)


# ---------------------------------------------------------------------------
# Group: Hall of Fame
# ---------------------------------------------------------------------------
def import_hall_of_fame(pg, lite, rep: Reporter, batch, sources: dict[str, int]) -> None:
    truncate(pg, "hall_of_fame")

    rows = lite.execute(
        """SELECT name, category, inducted_year, is_legend, legend_year, club,
                  state, playing_career, games_goals, removed_year, player_id,
                  match_status, candidate_count, notes, source_url
             FROM hall_of_fame ORDER BY inducted_year, name"""
    ).fetchall()

    def build():
        for r in rows:
            batch.records_read += 1
            name = clean_text(r["name"])
            if not name:
                continue
            status = link_status(r["match_status"], r["player_id"])
            notes = [clean_text(r["notes"]), clean_text(r["games_goals"])]
            yield (
                name, r["player_id"], status,
                clean_text(r["category"]), to_int(r["inducted_year"]),
                bool(r["is_legend"]), to_int(r["legend_year"]),
                clean_text(r["club"]), clean_text(r["state"]),
                clean_text(r["playing_career"]), to_int(r["removed_year"]),
                " · ".join(n for n in notes if n) or None,
                sources.get("wikipedia"), batch.id,
            )

    copy_rows(
        pg, "hall_of_fame",
        ["name", "player_id", "link_status_value", "category", "inducted_year",
         "is_legend", "legend_year", "club_name_raw", "state", "playing_career",
         "removed_year", "notes", "source_id", "import_batch_id"],
        build(), batch,
    )
    pg.commit()

    rep.result("hall_of_fame", scalar(pg, "SELECT count(*) FROM hall_of_fame"),
               f"({scalar(pg, 'SELECT count(*) FROM hall_of_fame WHERE is_legend')} legends, "
               f"{scalar(pg, 'SELECT count(*) FROM hall_of_fame WHERE player_id IS NOT NULL')} linked)")


# ---------------------------------------------------------------------------
# Group: honour teams
# ---------------------------------------------------------------------------
def import_honour_teams(pg, lite, rep: Reporter, batch, sources: dict[str, int]) -> None:
    truncate(pg, "honour_team_members")

    rows = lite.execute(
        """SELECT team_name, position, sort_order, name, club, role, note,
                  player_id, match_status, candidate_count, notes, source_url
             FROM team_selections ORDER BY team_name, sort_order, name"""
    ).fetchall()

    def build():
        for r in rows:
            batch.records_read += 1
            name = clean_text(r["name"])
            team = clean_text(r["team_name"])
            if not name or not team:
                continue
            status = link_status(r["match_status"], r["player_id"])
            notes = [clean_text(r["note"]), clean_text(r["notes"])]
            yield (
                team, r["player_id"], name, status,
                clean_text(r["position"]), clean_text(r["role"]),
                clean_text(r["club"]), to_int(r["sort_order"]) or 0,
                " · ".join(n for n in notes if n) or None,
                sources.get("wikipedia"), batch.id,
            )

    copy_rows(
        pg, "honour_team_members",
        ["team_name", "player_id", "player_name_raw", "link_status_value",
         "position", "role", "club_name_raw", "sort_order", "note",
         "source_id", "import_batch_id"],
        build(), batch,
    )
    pg.commit()

    rep.result("honour_team_members", scalar(pg, "SELECT count(*) FROM honour_team_members"),
               f"({scalar(pg, 'SELECT count(DISTINCT team_name) FROM honour_team_members')} teams)")


# ---------------------------------------------------------------------------
# Group: captaincies
# ---------------------------------------------------------------------------
def import_captaincies(pg, lite, rep: Reporter, batch, clubs: ClubResolver,
                       sources: dict[str, int]) -> None:
    truncate(pg, "captaincies")

    with pg.cursor() as cur:
        cur.execute("SELECT year FROM seasons")
        valid_seasons = {r[0] for r in cur.fetchall()}

    rows = lite.execute(
        """SELECT source_row_id, season, club, player, role, source_period,
                  source_notes, player_id, match_status, candidate_count, source_url
             FROM captaincies ORDER BY club, season, player"""
    ).fetchall()

    def build():
        for r in rows:
            batch.records_read += 1
            player = clean_text(r["player"])
            if not player or r["season"] not in valid_seasons:
                batch.reject(r["source_row_id"], "missing player or unknown season", dict(r))
                continue
            # club_id is NOT NULL here: a captaincy with no club is not a
            # fact AFLDB can state, so it is rejected rather than guessed.
            club_id, club_raw = clubs.resolve(r["club"], r["season"])
            if club_id is None:
                batch.reject(r["source_row_id"], f"club not resolved: {club_raw!r}", dict(r))
                continue
            status = link_status(r["match_status"], r["player_id"])
            yield (
                r["season"], club_id, r["player_id"], player, status,
                clean_text(r["role"]) or "Captain",
                clean_text(r["source_period"]),
                clean_text(r["source_notes"]),
                sources.get("wikipedia"), r["source_row_id"], batch.id,
            )

    copy_rows(
        pg, "captaincies",
        ["season", "club_id", "player_id", "player_name_raw", "link_status_value",
         "role", "period", "notes", "source_id", "source_record_id", "import_batch_id"],
        build(), batch,
    )
    pg.commit()

    rep.result("captaincies", scalar(pg, "SELECT count(*) FROM captaincies"),
               f"({scalar(pg, 'SELECT count(*) FROM captaincies WHERE player_id IS NOT NULL')} linked)")


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
GROUPS = {
    "awards":         ("Award definitions and winners", ["awards", "award_winners"]),
    "all_australian": ("All-Australian teams", ["award_winners"]),
    "rising_star":    ("Rising Star nominations", ["award_nominations"]),
    "hall_of_fame":   ("Australian Football Hall of Fame", ["hall_of_fame"]),
    "honour_teams":   ("Teams of the century and similar", ["honour_team_members"]),
    "captaincies":    ("Club captains by season", ["captaincies"]),
}

# all_australian and rising_star both need the award definitions, so
# 'awards' always runs first.
GROUP_ORDER = ["awards", "all_australian", "rising_star", "hall_of_fame",
               "honour_teams", "captaincies"]

# Groups that cannot be run without another.
#
# 'awards' and 'all_australian' write the same table and 'awards' rebuilds
# the definitions those winners hang off, so reloading either alone would
# take the other's rows with it via ON DELETE CASCADE and then report
# success. They are pulled in together rather than left to a flag nobody
# would think to pass.
GROUP_REQUIRES = {
    "awards": {"all_australian"},
    "all_australian": {"awards"},
    "rising_star": {"awards", "all_australian"},
}


def expand_groups(selected: list[str]) -> tuple[list[str], set[str]]:
    """Close the selection over GROUP_REQUIRES, preserving run order."""
    chosen = set(selected)
    while True:
        grown = set(chosen)
        for key in chosen:
            grown |= GROUP_REQUIRES.get(key, set())
        if grown == chosen:
            break
        chosen = grown
    return [g for g in GROUP_ORDER if g in chosen], chosen - set(selected)


def load_person_links(lite) -> dict[int, tuple]:
    """dg_person_id -> (player_id, match_status, candidate_count).

    The draftguru award rows identify a person, not a row, so resolving
    identity once per person is what stops the same footballer being
    linked on one award and unlinked on the next.
    """
    return {
        r["dg_person_id"]: (r["player_id"], r["match_status"], r["candidate_count"] or 0)
        for r in lite.execute(
            "SELECT dg_person_id, player_id, match_status, candidate_count FROM person_links"
        )
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Import AFLDB awards and honours.")
    parser.add_argument("--groups", nargs="*", help="subset of groups to run")
    parser.add_argument("--list-groups", action="store_true")
    parser.add_argument("--dry-run", action="store_true",
                        help="report source counts without writing")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    if args.list_groups:
        for key in GROUP_ORDER:
            print(f"  {key:<16} {GROUPS[key][0]}")
        return 0

    unknown = set(args.groups or []) - set(GROUPS)
    if unknown:
        sys.exit(f"ERROR: unknown group(s): {', '.join(sorted(unknown))}")

    selected = [g for g in GROUP_ORDER if not args.groups or g in args.groups]
    selected, added = expand_groups(selected)

    load_env()
    rep = Reporter(verbose=not args.quiet)
    legacy_path = require_env("AFLDB_LEGACY_SQLITE")
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")

    rep.step(f"legacy source : {legacy_path}")
    rep.step(f"target        : {safe_dsn(dsn)}")
    rep.step(f"groups        : {', '.join(selected)}")
    if added:
        rep.step(f"                (+{', '.join(sorted(added))} — required by the groups you asked for)")

    lite = connect_legacy(legacy_path)

    if args.dry_run:
        rep.step("dry run — source counts only")
        for table in ("awards", "all_australian", "all_australian_history",
                      "rising_star_nominees", "hall_of_fame", "team_selections",
                      "captaincies"):
            rep.result(table, lite.execute(f"SELECT count(*) FROM {table}").fetchone()[0])
        return 0

    started = time.time()
    pg = connect_pg(dsn)

    # Declare what this run rebuilds so TRUNCATE ... CASCADE cannot
    # silently empty a table no group here repopulates.
    scope: set[str] = set()
    for key in selected:
        scope.update(GROUPS[key][1])
    set_reload_scope(scope)

    try:
        with pg.cursor() as cur:
            cur.execute("SELECT key, id FROM sources")
            sources = dict(cur.fetchall())
        clubs = ClubResolver(pg)
        person_links = load_person_links(lite)

        for key in selected:
            rep.step(f"{key} — {GROUPS[key][0]}")
            with import_batch(pg, "sports_data_lab", "import_awards.py", key) as batch:
                if key == "awards":
                    import_awards(pg, lite, rep, batch, clubs, sources, person_links)
                elif key == "all_australian":
                    import_all_australian(pg, lite, rep, batch, clubs, sources, person_links)
                elif key == "rising_star":
                    import_rising_star(pg, lite, rep, batch, clubs, sources)
                elif key == "hall_of_fame":
                    import_hall_of_fame(pg, lite, rep, batch, sources)
                elif key == "honour_teams":
                    import_honour_teams(pg, lite, rep, batch, sources)
                elif key == "captaincies":
                    import_captaincies(pg, lite, rep, batch, clubs, sources)

        analyze(pg, "awards", "award_winners", "award_nominations", "hall_of_fame",
                "honour_team_members", "captaincies")

        if clubs.unresolved:
            # Expected: the pre-1979 All-Australian teams and the Hall of
            # Fame are full of state-league clubs that have no AFLDB row.
            top = sorted(clubs.unresolved.items(), key=lambda kv: -kv[1])[:10]
            rep.warn(
                f"{len(clubs.unresolved)} club names had no AFLDB club "
                f"(kept as club_name_raw): "
                + ", ".join(f"{name} x{count}" for name, count in top)
            )
    finally:
        pg.close()
        lite.close()

    rep.step(f"done in {time.time() - started:.0f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
