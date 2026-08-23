#!/usr/bin/env python3
"""Import awards, honours and captaincies — AFLDB Phase 3b.

    python tools/migration/import_awards.py                 # full run
    python tools/migration/import_awards.py --dry-run       # counts only
    python tools/migration/import_awards.py --groups rising_star
    python tools/migration/import_awards.py --groups under_22
    python tools/migration/import_awards.py --list-groups

Every target table already exists (migration 005). This importer fills
them from the legacy SQLite database, which holds the scraped award data
that Phase 3 deliberately left until the core entities were proven.

Every group reloads its targets by the source's own key, so a rerun always
produces the same result *and* the target rows keep their ids. That matters
because ``player_link_resolutions.target_id`` points at those ids: the earlier
truncate-and-reload discarded every manual identity decision and left its audit
row dangling (AFLDB-ISSUE-044). Human decisions are re-applied on top of the
refreshed source facts, and a decision that cannot be carried safely stops the
run before anything is written unless ``--allow-link-loss`` is given. Nothing is
written to the legacy database.

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
    LinkDecisionLoss,
    ReloadOwnershipCollision,
    Reporter,
    analyze,
    clean_text,
    connect_legacy,
    connect_pg,
    import_batch,
    load_env,
    reload_keyed,
    report_reload,
    require_env,
    safe_dsn,
    scalar,
    set_reload_scope,
    to_int,
)
from under_22 import Under22Selection, load_under_22  # noqa: E402

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
UNDER_22_SLUG = "22-under-22"
UNDER_22_SOURCE_KEY = "wikipedia_22under22"

# Transaction-scoped advisory lock serialising every writer that can change
# honour_team_members identity (AFLDB-ISSUE-080 §5.3). Migration 059's partial
# unique indexes leave the two mixed linked/unlinked same-name collisions with
# no database backstop, so the collision preflight and the write must share one
# protected transaction. The two constants are the frozen cross-language lock
# identity: they must remain byte-identical to HONOUR_TEAM_LOCK_NAMESPACE /
# HONOUR_TEAM_LOCK_KEY in src/db/queries/awards-admin.ts. Never derive them by
# hashing a string — the two implementations must contend on identical
# literals. The importer uses the blocking form (a batch job may wait); the
# admin path uses the try form.
HONOUR_TEAM_LOCK_NAMESPACE = 717275  # 0xAF1DB — AFLDB advisory-lock namespace
HONOUR_TEAM_LOCK_KEY = 1             # honour_team_members identity writers


def require_source(sources: dict[str, int], key: str) -> int:
    """Resolve a source id, failing closed when it is not configured.

    A ``sources.get(...)`` miss would make a provenance scope
    ``source_id = ANY(ARRAY[NULL])`` — a predicate that is never true — so the
    loader would reconcile nothing and INSERT every incoming row with NULL
    provenance (AFLDB-ISSUE-080 §8.1d). Raise with the source's name instead.
    """
    source_id = sources.get(key)
    if source_id is None:
        raise RuntimeError(
            f"source {key!r} is missing from the sources table; this loader "
            f"cannot establish its ownership scope without it"
        )
    return source_id


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
    UNDER_22_SLUG:
        "The AFL Players' Association's annual representative team recognising "
        "the best AFL players aged 22 or younger.",
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
                  sources: dict[str, int], person_links: dict[int, tuple],
                  allow_link_loss: bool = False) -> None:
    # Both targets are reloaded by key rather than emptied and refilled. 22
    # Under 22 is independently sourced and owns durable winner ids used by the
    # append-only player-link audit, so it stays outside this group's scope
    # entirely instead of being deleted and rebuilt; the All-Australian award's
    # winners belong to the next group and are likewise out of scope here.
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

    # An award definition is a plain source fact with no player link of its
    # own, so no resolution is read here. Keying on the slug is what keeps
    # awards.id stable, and with it the award_winners rows that reference it
    # through an ON DELETE CASCADE foreign key.
    reload_keyed(
        pg, "awards", ["slug"],
        ["slug", "name", "category", "competition", "club_id",
         "description", "first_season", "last_season"],
        build_definitions(), batch,
        link_columns=None,
        scope_column="slug", scope_values=[UNDER_22_SLUG], scope_exclude=True,
    )

    with pg.cursor() as cur:
        cur.execute("SELECT slug, id FROM awards")
        award_ids = dict(cur.fetchall())

    # 2. Winners.
    source_id = require_source(sources, "draftguru")
    # Winners owned by another group: 22 Under 22 upserts its own rows, and the
    # All-Australian team is loaded from its own two sources immediately after.
    other_group_awards = [
        award_ids[slug] for slug in (UNDER_22_SLUG, ALL_AUSTRALIAN_SLUG)
        if slug in award_ids
    ]

    def build_winners():
        for row_no, r in enumerate(rows, start=1):
            batch.records_read += 1
            slug = award_slug(r["award_category"], r["award_slug"], r["award_name"])
            award_id = award_ids.get(slug)
            player = clean_text(r["player"])
            if award_id is None or not player:
                batch.reject(r["source_row"], "award or player name missing", dict(r))
                continue
            if award_id in other_group_awards:
                # Out of this reload's scope, so an inserted row here could
                # never be matched again and would double on the next run.
                batch.reject(r["source_row"], f"award {slug!r} is loaded by another group", dict(r))
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

    winners = reload_keyed(
        pg, "award_winners", ["source_id", "source_record_id"],
        ["award_id", "season", "player_id", "player_name_raw", "link_status_value",
         "candidate_count", "club_id", "club_name_raw", "votes", "position",
         "is_captain", "is_vice_captain", "note", "source_id", "source_record_id",
         "import_batch_id"],
        build_winners(), batch,
        target_table="award_winners",
        scope_column="award_id", scope_values=other_group_awards, scope_exclude=True,
        # Ownership is domain AND provenance (AFLDB-ISSUE-080): the award-family
        # exclusion alone would still delete manual_admin_edit and
        # sports_data_lab rows whose keys this extract can never produce.
        scopes=[("source_id", [source_id], False)],
        allow_link_loss=allow_link_loss,
    )
    pg.commit()
    report_reload(rep, "award_winners", winners)

    rep.result("awards", scalar(pg, "SELECT count(*) FROM awards"))
    rep.result("award_winners", scalar(pg, "SELECT count(*) FROM award_winners"),
               f"({scalar(pg, 'SELECT count(*) FROM award_winners WHERE player_id IS NOT NULL')} linked)")


# ---------------------------------------------------------------------------
# Group: All-Australian
# ---------------------------------------------------------------------------
def import_all_australian(pg, lite, rep: Reporter, batch, clubs: ClubResolver,
                          sources: dict[str, int], person_links: dict[int, tuple],
                          allow_link_loss: bool = False) -> None:
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

    draftguru_id = require_source(sources, "draftguru")
    wikipedia_id = require_source(sources, "wikipedia")

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
                draftguru_id, f"aa:{r['season']}:{row_no}", batch.id,
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
                wikipedia_id,
                f"aah:{r['season']}:{r['player_source']}:{r['club_source'] or ''}", batch.id,
            )

    # Scoped to this one award AND to the two legacy sources that supply it:
    # the legacy awards group above deliberately leaves the award alone, and
    # rows the ingest pipeline promoted under sports_data_lab are not this
    # loader's to reconcile (AFLDB-ISSUE-080).
    stats = reload_keyed(
        pg, "award_winners", ["source_id", "source_record_id"],
        ["award_id", "season", "player_id", "player_name_raw", "link_status_value",
         "candidate_count", "club_id", "club_name_raw", "votes", "position",
         "is_captain", "is_vice_captain", "note", "source_id", "source_record_id",
         "import_batch_id"],
        build(), batch,
        target_table="award_winners",
        scope_column="award_id", scope_values=[award_id],
        scopes=[("source_id", [draftguru_id, wikipedia_id], False)],
        allow_link_loss=allow_link_loss,
    )
    report_reload(rep, "all_australian", stats)

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
# Group: AFLPA 22 Under 22
# ---------------------------------------------------------------------------
def resolve_under_22_player(
    pg: psycopg.Connection,
    row: Under22Selection,
    club_id: int,
) -> tuple[int | None, str, int]:
    """Resolve only an exact name/alias corroborated by season and club.

    Names locate candidates; they never establish identity on their own. A
    trusted link requires exactly one candidate whose player-match history
    puts that player at the source club in the selection season. This is
    deliberately stricter than the generic upload resolver because every row
    in this source names an AFL club and a current-season AFL player.
    """
    with pg.cursor() as cur:
        cur.execute(
            """SELECT DISTINCT p.id,
                       EXISTS (
                         SELECT 1
                           FROM player_match_stats pms
                           JOIN matches m ON m.id = pms.match_id
                          WHERE pms.player_id = p.id
                            AND pms.club_id = %s
                            AND m.season = %s
                       ) AS corroborated
                  FROM players p
                 WHERE p.search_name = afldb_normalise_name(%s)
                    OR EXISTS (
                         SELECT 1
                           FROM player_name_aliases a
                          WHERE a.player_id = p.id
                            AND a.search_alias = afldb_normalise_name(%s)
                       )
                 ORDER BY p.id""",
            (club_id, row.season, row.player, row.player),
        )
        candidates = cur.fetchall()

    corroborated = [candidate[0] for candidate in candidates if candidate[1]]
    if len(corroborated) == 1:
        status = "unique" if len(candidates) == 1 else "resolved"
        return corroborated[0], status, len(candidates)
    if len(corroborated) > 1:
        return None, "ambiguous", len(candidates)
    if candidates:
        return None, "implausible", len(candidates)
    return None, "unmatched", 0


Under22Prepared = tuple[int, int | None, str, int]


def prepare_under_22(
    pg: psycopg.Connection,
    rows: list[Under22Selection],
    clubs: ClubResolver,
    preserved_resolutions: dict[str, tuple[str, int, int]] | None = None,
) -> dict[str, Under22Prepared]:
    """Validate every database reference and resolve every player up front.

    A full awards run is destructive and commits by group. Doing all source,
    season, club and player resolution before that loop means an invalid
    prerequisite cannot erase the previous awards family and fail only later.
    """
    source_seasons = {row.season for row in rows}
    with pg.cursor() as cur:
        cur.execute("SELECT year FROM seasons WHERE year = ANY(%s)", (list(source_seasons),))
        loaded_seasons = {record[0] for record in cur.fetchall()}
    missing_seasons = sorted(source_seasons - loaded_seasons)
    if missing_seasons:
        raise RuntimeError(
            "22 Under 22 source refers to seasons not loaded in AFLDB: "
            + ", ".join(map(str, missing_seasons))
        )

    preserved_resolutions = preserved_resolutions or {}
    prepared: dict[str, Under22Prepared] = {}
    trusted_player_seasons: dict[tuple[int, int], str] = {}
    for row in rows:
        club_id, _ = clubs.resolve(row.club, row.season)
        club = clubs.clubs.get(club_id) if club_id is not None else None
        active = club is not None and (
            (club["first"] is None or row.season >= club["first"])
            and (club["last"] is None or row.season <= club["last"])
        )
        if not active:
            raise RuntimeError(
                f"{row.source_key}: club {row.club!r} has no AFL identity active "
                f"in {row.season}"
            )

        player_id, status, candidate_count = resolve_under_22_player(pg, row, club_id)
        preserved = preserved_resolutions.get(row.source_key)
        if preserved is not None:
            prior_name, prior_player_id, prior_candidates = preserved
            if prior_name != row.player:
                raise RuntimeError(
                    f"{row.source_key}: source player changed from {prior_name!r} to "
                    f"{row.player!r}; review the preserved manual resolution first"
                )
            player_id = prior_player_id
            status = "resolved"
            candidate_count = prior_candidates

        if player_id is not None:
            identity_key = (row.season, player_id)
            prior_key = trusted_player_seasons.get(identity_key)
            if prior_key is not None:
                raise RuntimeError(
                    f"{row.source_key}: resolved player {player_id} is already selected "
                    f"for {row.season} by {prior_key}"
                )
            trusted_player_seasons[identity_key] = row.source_key

        prepared[row.source_key] = (club_id, player_id, status, candidate_count)
    return prepared


def import_under_22(
    pg: psycopg.Connection,
    rep: Reporter,
    batch,
    clubs: ClubResolver,
    sources: dict[str, int],
    source_rows: list[Under22Selection] | None = None,
    prepared_rows: dict[str, Under22Prepared] | None = None,
) -> None:
    """Load the complete committed 2012-2026 annual team extract.

    This is a scoped upsert: a targeted rerun does not touch any other award.
    The legacy ``awards`` group includes this group so a full refresh also
    applies the current independently sourced manifest; its own deletes leave
    these durable Under 22 rows and IDs intact.
    """
    rows = source_rows if source_rows is not None else load_under_22()
    batch.records_read += len(rows)

    source_id = sources.get(UNDER_22_SOURCE_KEY)
    if source_id is None:
        raise RuntimeError(
            f"source {UNDER_22_SOURCE_KEY!r} is missing; run database migration 060 first"
        )

    source_seasons = {row.season for row in rows}
    prepared_rows = prepared_rows or prepare_under_22(pg, rows, clubs)

    first_season = min(source_seasons)
    last_season = max(source_seasons)
    with pg.cursor() as cur:
        cur.execute(
            """INSERT INTO awards
                 (slug, name, category, competition, club_id, description,
                  first_season, last_season)
               VALUES (%s, %s, 'honour_team', 'AFL', NULL, %s, %s, %s)
               ON CONFLICT (slug) DO UPDATE
                 SET name = EXCLUDED.name,
                     category = EXCLUDED.category,
                     competition = EXCLUDED.competition,
                     club_id = NULL,
                     description = EXCLUDED.description,
                     first_season = EXCLUDED.first_season,
                     last_season = EXCLUDED.last_season
               RETURNING id""",
            (
                UNDER_22_SLUG,
                "22 Under 22 Team",
                AWARD_DESCRIPTIONS[UNDER_22_SLUG],
                first_season,
                last_season,
            ),
        )
        award_id = cur.fetchone()[0]

    keys = [row.source_key for row in rows]
    with pg.cursor() as cur:
        cur.execute(
            """SELECT source_record_id, award_id, player_name_raw,
                      link_status_value::text, player_id, candidate_count
                 FROM award_winners
                WHERE source_id = %s
                  AND source_record_id = ANY(%s)""",
            (source_id, keys),
        )
        existing = {record[0]: record[1:] for record in cur.fetchall()}
        cur.execute(
            """SELECT source_record_id
                 FROM award_winners
                WHERE award_id = %s
                  AND source_record_id = ANY(%s)
                  AND source_id IS DISTINCT FROM %s
                LIMIT 1""",
            (award_id, keys, source_id),
        )
        cross_source_collision = cur.fetchone()
    if cross_source_collision:
        raise RuntimeError(
            "22 Under 22 source key collides with another source: "
            + cross_source_collision[0]
        )

    prepared: list[tuple] = []
    status_counts = {"unique": 0, "resolved": 0, "ambiguous": 0,
                     "unmatched": 0, "implausible": 0}
    for row in rows:
        club_id, player_id, status, candidate_count = prepared_rows[row.source_key]
        prior = existing.get(row.source_key)
        if prior is not None:
            prior_award_id, prior_name, prior_status, prior_player_id, prior_candidates = prior
            if prior_award_id != award_id:
                raise RuntimeError(
                    f"{row.source_key}: existing source row belongs to award {prior_award_id}, "
                    f"not {award_id}"
                )
            if prior_status == "resolved" and prior_player_id is not None:
                if prior_name != row.player:
                    raise RuntimeError(
                        f"{row.source_key}: source player changed from {prior_name!r} to "
                        f"{row.player!r}; review the existing manual resolution first"
                    )
                player_id = prior_player_id
                status = "resolved"
                candidate_count = prior_candidates

        status_counts[status] += 1
        prepared.append((
            award_id, row.season, player_id, row.player, status, candidate_count,
            club_id, row.club, row.position, row.sort_order,
            row.is_captain, row.is_vice_captain, source_id, row.source_key, batch.id,
        ))

    with pg.cursor() as cur:
        cur.execute(
            """DELETE FROM award_winners
                WHERE award_id = %s
                  AND source_id = %s
                  AND (source_record_id IS NULL OR source_record_id <> ALL(%s))""",
            (award_id, source_id, keys),
        )
        cur.executemany(
            """INSERT INTO award_winners
                 (award_id, season, player_id, player_name_raw, link_status_value,
                  candidate_count, club_id, club_name_raw, position,
                  sort_order, is_captain, is_vice_captain, source_id,
                  source_record_id, import_batch_id)
               VALUES (%s, %s, %s, %s, %s::link_status, %s, %s, %s, %s,
                       %s, %s, %s, %s, %s, %s)
               ON CONFLICT ON CONSTRAINT award_winners_source_uq DO UPDATE
                 SET award_id = EXCLUDED.award_id,
                     season = EXCLUDED.season,
                     player_id = EXCLUDED.player_id,
                     player_name_raw = EXCLUDED.player_name_raw,
                     link_status_value = EXCLUDED.link_status_value,
                     candidate_count = EXCLUDED.candidate_count,
                     club_id = EXCLUDED.club_id,
                     club_name_raw = EXCLUDED.club_name_raw,
                     position = EXCLUDED.position,
                     sort_order = EXCLUDED.sort_order,
                     is_captain = EXCLUDED.is_captain,
                     is_vice_captain = EXCLUDED.is_vice_captain,
                     import_batch_id = EXCLUDED.import_batch_id""",
            prepared,
        )
    batch.records_inserted += len(rows) - len(existing)
    batch.records_updated += len(existing)
    pg.commit()

    linked = status_counts["unique"] + status_counts["resolved"]
    rep.result(
        "22 Under 22 selections",
        len(rows),
        f"({len(source_seasons)} seasons, {linked} linked, "
        f"{len(rows) - linked} awaiting identity review)",
    )


# ---------------------------------------------------------------------------
# Group: Rising Star nominations
# ---------------------------------------------------------------------------
STAT_COLUMNS = [
    "kicks", "handballs", "disposals", "marks", "goals", "behinds",
    "tackles", "hitouts", "frees_for", "frees_against", "supercoach", "afl_fantasy",
]


def import_rising_star(pg, lite, rep: Reporter, batch, clubs: ClubResolver,
                       sources: dict[str, int], allow_link_loss: bool = False) -> None:
    """Load every round-by-round Rising Star nomination, 1993 on.

    The award itself is already in ``awards`` from the draftguru load —
    this adds the nominees, which is the part that makes the award
    browsable rather than a list of 33 winners.
    """
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

    source_id = require_source(sources, "footywire")

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

    stats = reload_keyed(
        pg, "award_nominations", ["source_id", "source_record_id"],
        ["award_id", "season", "round_number", "player_id", "player_name_raw",
         "link_status_value", "club_id", "opponent_club_id", "is_winner",
         "is_ineligible", "ineligible_reason", "votes", "stat_line",
         "source_id", "source_record_id", "import_batch_id"],
        build(), batch,
        target_table="award_nominations",
        scope_column="award_id", scope_values=[award_id],
        # Domain AND provenance: rising_star rows the ingest pipeline promoted
        # under sports_data_lab share this award and must survive this reload
        # (AFLDB-ISSUE-080).
        scopes=[("source_id", [source_id], False)],
        allow_link_loss=allow_link_loss,
    )
    pg.commit()
    report_reload(rep, "award_nominations", stats)

    total = scalar(pg, "SELECT count(*) FROM award_nominations")
    linked = scalar(pg, "SELECT count(*) FROM award_nominations WHERE player_id IS NOT NULL")
    seasons = scalar(pg, "SELECT count(DISTINCT season) FROM award_nominations")
    winners = scalar(pg, "SELECT count(*) FROM award_nominations WHERE is_winner")
    rep.result("award_nominations", total, f"({seasons} seasons, {linked} linked)")
    rep.result("  of which season winners", winners)


# ---------------------------------------------------------------------------
# Group: Hall of Fame
# ---------------------------------------------------------------------------
def import_hall_of_fame(pg, lite, rep: Reporter, batch, sources: dict[str, int],
                        allow_link_loss: bool = False) -> None:
    rows = lite.execute(
        """SELECT name, category, inducted_year, is_legend, legend_year, club,
                  state, playing_career, games_goals, removed_year, player_id,
                  match_status, candidate_count, notes, source_url
             FROM hall_of_fame ORDER BY inducted_year, name"""
    ).fetchall()

    source_id = require_source(sources, "wikipedia")

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
                source_id, batch.id,
            )

    # This source carries no record id of its own, so migration 042's natural
    # key does the work. The name is therefore part of the key: a renamed
    # inductee reads as "old key gone, new key arrived", which is exactly the
    # case that must stop rather than quietly delete and reinsert a decided row.
    #
    # The reload reconciles only rows this source owns (AFLDB-ISSUE-080):
    # admin-created rows are not its to delete. (name, inducted_year) is a
    # total, globally unique natural key (hall_of_fame_name_uq), so an incoming
    # key held by a foreign-owned row is a genuine collision and the opt-in
    # out-of-scope preflight refuses it with both row identities.
    stats = reload_keyed(
        pg, "hall_of_fame", ["name", "inducted_year"],
        ["name", "player_id", "link_status_value", "category", "inducted_year",
         "is_legend", "legend_year", "club_name_raw", "state", "playing_career",
         "removed_year", "notes", "source_id", "import_batch_id"],
        build(), batch,
        target_table="hall_of_fame", name_column="name",
        scope_column="source_id", scope_values=[source_id],
        refuse_out_of_scope_key=True,
        allow_link_loss=allow_link_loss,
    )
    pg.commit()
    report_reload(rep, "hall_of_fame", stats)

    rep.result("hall_of_fame", scalar(pg, "SELECT count(*) FROM hall_of_fame"),
               f"({scalar(pg, 'SELECT count(*) FROM hall_of_fame WHERE is_legend')} legends, "
               f"{scalar(pg, 'SELECT count(*) FROM hall_of_fame WHERE player_id IS NOT NULL')} linked)")


# ---------------------------------------------------------------------------
# Group: honour teams
# ---------------------------------------------------------------------------
def _refuse_honour_team_identity_collisions(
    pg, incoming: list[tuple], source_id: int,
) -> None:
    """AFLDB-ISSUE-080 check 2: the §4.3 matrix and the §4.4 identity rule.

    A raw-name match is not automatically a collision: migration 059 stopped
    treating ``player_name_raw`` as identity (AFLDB-ISSUE-025), so two rows
    positively linked to *different* players may share a display name in one
    team. Every other same-name case is ambiguous or duplicated identity and
    refuses — and the two mixed linked/unlinked cases have no unique-index
    backstop after 059, which is why this check runs under the §5.3 advisory
    lock and inside the reload transaction.

    ``incoming`` rows are the loader's prepared tuples, whose first three
    fields are (team_name, player_id, player_name_raw); classification uses the
    raw incoming ``player_id``, because a decision replay only alters rows that
    matched an in-scope row, and those are UPDATEs that never reach this
    collision surface.
    """
    with pg.cursor() as cur:
        # IS NOT TRUE is the ownership scope's exact complement: a NULL
        # source_id makes ``= ANY`` evaluate NULL, and NULL-provenance rows
        # are precisely the foreign rows this check must see.
        cur.execute(
            """SELECT id, team_name, player_name_raw, player_id, source_id
                 FROM honour_team_members
                WHERE (source_id = ANY(%s)) IS NOT TRUE""",
            ([source_id],),
        )
        foreign = cur.fetchall()
    if not foreign:
        return

    by_name: dict[tuple[str, str], list[tuple]] = {}
    by_player: dict[tuple[str, int], list[tuple]] = {}
    for row_id, team, name, player_id, owner in foreign:
        by_name.setdefault((team, name), []).append((row_id, player_id, owner))
        if player_id is not None:
            by_player.setdefault((team, player_id), []).append((row_id, name, owner))

    problems: list[str] = []
    for row in incoming:
        team, player_id, name = row[0], row[1], row[2]
        # §4.4 — same (team_name, player_id), any raw name: always refuse.
        # Mirrors honour_team_linked_player_uq: both sides non-NULL, plain
        # equality.
        if player_id is not None:
            for row_id, existing_name, owner in by_player.get((team, player_id), []):
                problems.append(
                    f"row id={row_id} source_id={owner} team={team!r} already "
                    f"records player {player_id} as {existing_name!r}; the "
                    f"incoming row asserts the same player as {name!r}"
                )
        # §4.3 — the raw-name matrix.
        for row_id, existing_player, owner in by_name.get((team, name), []):
            if existing_player is not None and player_id is not None:
                # Identity positively known on both sides: distinct players
                # coexist by design (migration 059), and the same player is
                # already refused by the §4.4 axis above.
                continue
            if existing_player is None and player_id is None:
                why = "identity is unknown on both sides"
            elif existing_player is None:
                why = (f"the existing row is unlinked and the incoming row is "
                       f"linked to player {player_id}; review whether they are "
                       f"the same person")
            else:
                why = (f"the existing row is linked to player "
                       f"{existing_player} and the incoming row is unlinked; "
                       f"review whether they are the same person")
            problems.append(
                f"row id={row_id} source_id={owner} team={team!r} "
                f"name={name!r}: {why}"
            )

    if problems:
        shown = "\n  ".join(problems[:5])
        more = f"\n  (+{len(problems) - 5} more)" if len(problems) > 5 else ""
        raise ReloadOwnershipCollision(
            f"honour_team_members: the incoming source collides with row(s) "
            f"this loader does not own:\n  {shown}{more}\n"
            f"Nothing has been written. A curator must reconcile each pair "
            f"before this reload can run."
        )


def import_honour_teams(pg, lite, rep: Reporter, batch, sources: dict[str, int],
                        allow_link_loss: bool = False) -> None:
    rows = lite.execute(
        """SELECT team_name, position, sort_order, name, club, role, note,
                  player_id, match_status, candidate_count, notes, source_url
             FROM team_selections ORDER BY team_name, sort_order, name"""
    ).fetchall()

    source_id = require_source(sources, "wikipedia")

    prepared: list[tuple] = []
    for r in rows:
        batch.records_read += 1
        name = clean_text(r["name"])
        team = clean_text(r["team_name"])
        if not name or not team:
            continue
        status = link_status(r["match_status"], r["player_id"])
        notes = [clean_text(r["note"]), clean_text(r["notes"])]
        prepared.append((
            team, r["player_id"], name, status,
            clean_text(r["position"]), clean_text(r["role"]),
            clean_text(r["club"]), to_int(r["sort_order"]) or 0,
            " · ".join(n for n in notes if n) or None,
            source_id, batch.id,
        ))

    # §5.3 (AFLDB-ISSUE-080): serialise every honour_team_members identity
    # writer before reading. The blocking transaction-scoped form is correct
    # for a batch job; commit or rollback releases it. Taken before the
    # collision preflight so no writer can slip between check and write.
    with pg.cursor() as cur:
        cur.execute(
            "SELECT pg_advisory_xact_lock(%s, %s)",
            (HONOUR_TEAM_LOCK_NAMESPACE, HONOUR_TEAM_LOCK_KEY),
        )

    _refuse_honour_team_identity_collisions(pg, prepared, source_id)

    # No source record id here either. (team_name, player_name_raw) was this
    # table's original uniqueness rule and is still the only key the source
    # supplies, so — as for the Hall of Fame — a source rename cannot be
    # separated from a deletion and must stop a decided row from being lost.
    #
    # The reload reconciles only rows this source owns (AFLDB-ISSUE-080). The
    # generic out-of-scope key refusal is deliberately NOT enabled here: the
    # reload key contains player_name_raw, which is not identity (migration
    # 059), and a blanket key refusal would collapse two distinct linked
    # players sharing a display name. The §4.3/§4.4 preflight above applies
    # the correct case-by-case policy instead.
    stats = reload_keyed(
        pg, "honour_team_members", ["team_name", "player_name_raw"],
        ["team_name", "player_id", "player_name_raw", "link_status_value",
         "position", "role", "club_name_raw", "sort_order", "note",
         "source_id", "import_batch_id"],
        iter(prepared), batch,
        target_table="honour_team_members",
        scope_column="source_id", scope_values=[source_id],
        allow_link_loss=allow_link_loss,
    )
    pg.commit()
    report_reload(rep, "honour_team_members", stats)

    rep.result("honour_team_members", scalar(pg, "SELECT count(*) FROM honour_team_members"),
               f"({scalar(pg, 'SELECT count(DISTINCT team_name) FROM honour_team_members')} teams)")


# ---------------------------------------------------------------------------
# Group: captaincies
# ---------------------------------------------------------------------------
def import_captaincies(pg, lite, rep: Reporter, batch, clubs: ClubResolver,
                       sources: dict[str, int], allow_link_loss: bool = False) -> None:
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

    stats = reload_keyed(
        pg, "captaincies", ["source_id", "source_record_id"],
        ["season", "club_id", "player_id", "player_name_raw", "link_status_value",
         "role", "period", "notes", "source_id", "source_record_id", "import_batch_id"],
        build(), batch,
        target_table="captaincies",
        allow_link_loss=allow_link_loss,
    )
    pg.commit()
    report_reload(rep, "captaincies", stats)

    rep.result("captaincies", scalar(pg, "SELECT count(*) FROM captaincies"),
               f"({scalar(pg, 'SELECT count(*) FROM captaincies WHERE player_id IS NOT NULL')} linked)")


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
GROUPS = {
    "awards":         ("Award definitions and winners", ["awards", "award_winners"]),
    "all_australian": ("All-Australian teams", ["award_winners"]),
    "under_22":       ("AFLPA 22 Under 22 teams", ["awards", "award_winners"]),
    "rising_star":    ("Rising Star nominations", ["award_nominations"]),
    "hall_of_fame":   ("Australian Football Hall of Fame", ["hall_of_fame"]),
    "honour_teams":   ("Teams of the century and similar", ["honour_team_members"]),
    "captaincies":    ("Club captains by season", ["captaincies"]),
}

# all_australian and rising_star both need the legacy award definitions, so
# 'awards' always runs first. under_22 can also run alone because it upserts
# only its own definition and rows.
GROUP_ORDER = ["awards", "all_australian", "under_22", "rising_star", "hall_of_fame",
               "honour_teams", "captaincies"]

# Groups that cannot be run without another.
#
# 'awards', 'all_australian' and 'rising_star' share definitions/tables, so a
# legacy-family refresh must close over all three. A full awards refresh also
# includes independently sourced under_22 so its current manifest is applied,
# while its rows and durable IDs are excluded from the legacy deletes.
# under_22 itself is deliberately asymmetric and may run alone as a scoped
# upsert.
GROUP_REQUIRES = {
    "awards": {"all_australian", "under_22", "rising_star"},
    "all_australian": {"awards"},
    "rising_star": {"awards"},
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
    parser.add_argument(
        "--allow-link-loss", action="store_true",
        help="proceed even when a manual player-link decision cannot survive "
             "the reload; every discarded decision is itemised",
    )
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
    needs_legacy = any(key != "under_22" for key in selected)
    legacy_path = require_env("AFLDB_LEGACY_SQLITE") if needs_legacy else None

    if legacy_path:
        rep.step(f"legacy source : {legacy_path}")
    rep.step(f"groups        : {', '.join(selected)}")
    if added:
        rep.step(f"                (+{', '.join(sorted(added))} — required by the groups you asked for)")

    lite = connect_legacy(legacy_path) if legacy_path else None

    if args.dry_run:
        rep.step("dry run — source counts only")
        if lite is not None:
            for table in ("awards", "all_australian", "all_australian_history",
                          "rising_star_nominees", "hall_of_fame", "team_selections",
                          "captaincies"):
                rep.result(table, lite.execute(f"SELECT count(*) FROM {table}").fetchone()[0])
            lite.close()
        if "under_22" in selected:
            under_22_rows = load_under_22()
            rep.result(
                "22 Under 22 source",
                len(under_22_rows),
                f"({len({row.season for row in under_22_rows})} seasons)",
            )
        return 0

    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")
    rep.step(f"target        : {safe_dsn(dsn)}")
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
        person_links = load_person_links(lite) if lite is not None else {}
        preserved_under_22_resolutions: dict[str, tuple[str, int, int]] = {}
        under_22_rows: list[Under22Selection] | None = None
        under_22_prepared: dict[str, Under22Prepared] | None = None
        under_22_source_id = sources.get(UNDER_22_SOURCE_KEY)
        if "under_22" in selected:
            # Validate every source/reference prerequisite before a requested
            # shared legacy awards rebuild deletes or rewrites its own rows.
            if under_22_source_id is None:
                raise RuntimeError(
                    f"source {UNDER_22_SOURCE_KEY!r} is missing; "
                    "run database migration 060 first"
                )
            with pg.cursor() as cur:
                cur.execute(
                    """SELECT EXISTS (
                         SELECT 1
                           FROM information_schema.columns
                          WHERE table_schema = 'public'
                            AND table_name = 'award_winners'
                            AND column_name = 'sort_order'
                       )"""
                )
                has_sort_order = cur.fetchone()[0]
            if not has_sort_order:
                raise RuntimeError(
                    "award_winners.sort_order is missing; run database migration 061 first"
                )
            under_22_rows = load_under_22()

            # Capture deliberate human links before any shared-family rebuild.
            # The legacy awards loader now preserves Under 22 rows and IDs, and
            # this preflight also prevents a changed raw name from silently
            # inheriting an earlier manual resolution.
            with pg.cursor() as cur:
                cur.execute(
                    """SELECT w.source_record_id, w.player_name_raw,
                              w.player_id, w.candidate_count
                         FROM award_winners w
                         JOIN awards a ON a.id = w.award_id
                        WHERE a.slug = %s
                          AND w.source_id = %s
                          AND w.link_status_value = 'resolved'
                          AND w.player_id IS NOT NULL""",
                    (UNDER_22_SLUG, under_22_source_id),
                )
                preserved_under_22_resolutions = {
                    row[0]: (row[1], row[2], row[3]) for row in cur.fetchall()
                }
            under_22_prepared = prepare_under_22(
                pg, under_22_rows, clubs, preserved_under_22_resolutions
            )

        for key in selected:
            rep.step(f"{key} — {GROUPS[key][0]}")
            batch_source = UNDER_22_SOURCE_KEY if key == "under_22" else "sports_data_lab"
            with import_batch(pg, batch_source, "import_awards.py", key) as batch:
                if key == "awards":
                    import_awards(pg, lite, rep, batch, clubs, sources, person_links,
                                  allow_link_loss=args.allow_link_loss)
                elif key == "all_australian":
                    import_all_australian(pg, lite, rep, batch, clubs, sources, person_links,
                                          allow_link_loss=args.allow_link_loss)
                elif key == "under_22":
                    import_under_22(
                        pg, rep, batch, clubs, sources,
                        source_rows=under_22_rows,
                        prepared_rows=under_22_prepared,
                    )
                elif key == "rising_star":
                    import_rising_star(pg, lite, rep, batch, clubs, sources,
                                       allow_link_loss=args.allow_link_loss)
                elif key == "hall_of_fame":
                    import_hall_of_fame(pg, lite, rep, batch, sources,
                                        allow_link_loss=args.allow_link_loss)
                elif key == "honour_teams":
                    import_honour_teams(pg, lite, rep, batch, sources,
                                        allow_link_loss=args.allow_link_loss)
                elif key == "captaincies":
                    import_captaincies(pg, lite, rep, batch, clubs, sources,
                                       allow_link_loss=args.allow_link_loss)

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
    except (LinkDecisionLoss, ReloadOwnershipCollision) as loss:
        # Raised during analysis, before the group wrote anything; import_batch
        # has already rolled its transaction back, so the targets are untouched.
        rep.warn(str(loss))
        return 1
    finally:
        pg.close()
        if lite is not None:
            lite.close()

    rep.step(f"done in {time.time() - started:.0f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
