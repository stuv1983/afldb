#!/usr/bin/env python3
"""Parse and validate the canonical club best-and-fairest source files.

The source is deliberately checked before any database importer sees a row.
Malformed or incomplete data raises ``ClubBestAndFairestSourceError``; no
best-effort coercion is performed here.

AFLDB-ISSUE-112 phase 6 (§22). Two tracked files replace the
``award_category = 'club_best_and_fairest'`` slice of the legacy SQLite
``awards`` table:

* ``data/awards/club-best-and-fairest.csv`` — 752 winner rows, one per
  award-season-winner (a tied season carries one row per winner). The
  bootstrap was extracted read-only from ``afldb_dev.award_winners``
  joined to the 19 ``bf-*`` awards.
* ``data/awards/club-best-and-fairest-definitions.csv`` — the 19 ``bf-*``
  award definitions themselves (``awards`` rows). These were previously
  derived by ``import_awards.import_awards`` from the same legacy table;
  tracking them here is what lets the family run with
  ``AFLDB_LEGACY_SQLITE`` unset.

Like the All-Australian / Rising Star / captaincies slices, ``award_winners``
already carries a stable ``source_record_id`` on every row and reloads on
``(source_id, source_record_id)`` — not a natural key. ``source_key`` in the
winners file is therefore the *preserved* database ``source_record_id``,
carried verbatim (``bf-<club-slug>:<season>:<row_no>``, where ``<row_no>``
was the legacy scan-order position and is now a frozen assigned id): it is
**not** re-minted here and the loader keys the reload on it unchanged.

``club`` is the source's own verbatim club string — exactly the value the
legacy loader passed to ``import_awards.ClubResolver`` and exactly what it
stored in ``award_winners.club_name_raw``. The loader re-resolves it
season-aware at load time, so ``club_id`` is reconstructed (rebuild-stable
against a canonically rebuilt ``clubs`` / ``club_aliases``) rather than
frozen, while ``club_name_raw`` round-trips byte-for-byte. Four clubs have
an era split the resolver handles from the season alone: ``Brisbane`` →
Bears (1987-96) / Lions (1997-), ``North Melbourne`` → North Melbourne /
Kangaroos (1999-2007), ``South Melbourne``/``Sydney`` (the name changed in
1982), ``Western Bulldogs`` → Footscray (to 1996) / Western Bulldogs.

Provenance is ``draftguru`` for every row, at source granularity (the
operator policy for this family — ``source_citation`` is not a per-page
citation and legacy SQLite is not reopened to reconstruct one). ``votes``
is empty on every legacy row; the parser refuses a value rather than
loading one through.

A player can win the same club's award in more than one season, and a
season can have more than one winner (25 tied seasons in the measured
data), so the parser does **not** enforce ``(award_slug, season)``
uniqueness. It enforces ``source_key`` uniqueness and the finer
``(award_slug, season, player)`` identity, both measured collision-free.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


_DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "awards"
DEFAULT_WINNERS_PATH = _DATA_DIR / "club-best-and-fairest.csv"
DEFAULT_DEFINITIONS_PATH = _DATA_DIR / "club-best-and-fairest-definitions.csv"

WINNERS_HEADER = (
    "source_key",
    "award_slug",
    "season",
    "club",
    "player",
    "player_id",
    "link_status",
    "candidate_count",
    "votes",
    "note",
    "source_citation",
)
DEFINITIONS_HEADER = (
    "slug",
    "name",
    "category",
    "club",
    "first_season",
    "last_season",
    "source_citation",
)

# Declared coverage, measured read-only against afldb_dev
# (AFLDB-ISSUE-112 §14.4 / §22). A row count, season span or per-family
# distribution outside this is a source contract change, not a formatting
# slip — bump these when a later season's winners are curated in.
EXPECTED_WINNERS = 752
EXPECTED_DEFINITIONS = 19
MIN_SEASON = 1980
MAX_SEASON = 2025
EXPECTED_DISTINCT_SEASONS = 46
EXPECTED_LINKED = 744
EXPECTED_NOTE_PRESENT = 684

# The 19 bf-* award slugs, exactly as import_awards.award_slug() namespaces
# them. The winners file may reference only these; the definitions file must
# supply exactly these, once each.
AWARD_SLUGS = frozenset({
    "bf-adelaide", "bf-brisbane", "bf-carlton", "bf-collingwood", "bf-essendon",
    "bf-fitzroy", "bf-fremantle", "bf-geelong", "bf-gold-coast",
    "bf-greater-western-sydney", "bf-hawthorn", "bf-melbourne",
    "bf-north-melbourne", "bf-port-adelaide", "bf-richmond", "bf-st-kilda",
    "bf-sydney", "bf-west-coast", "bf-western-bulldogs",
})

# The category every bf-* definition carries (migration 005 award category
# vocabulary). A definitions row with any other value is rejected.
DEFINITION_CATEGORY = "club_best_and_fairest"

# Source-granularity provenance for the whole family (§13 operator policy).
SOURCE_CITATION = "draftguru"

# The link_status enum (migration 005) and the subset that requires a
# player_id (the migration 019/053 invariant, enforced here rather than
# left to the database). This family carries 8 legitimately unlinked rows,
# so completeness is a fixed expected linked count, not "every row linked".
LINK_STATUSES = {"unique", "resolved", "ambiguous", "unmatched", "implausible"}
LINKED_STATUSES = {"unique", "resolved"}

# The source club strings measured across all 752 club cells in afldb_dev —
# the modern club names draftguru uses throughout, which import_awards
# .ClubResolver maps season-aware (several of them to two identities across
# a lineage split). Adding a value here is a deliberate change, not a
# parser fix.
KNOWN_CLUBS = {
    "Adelaide", "Brisbane", "Carlton", "Collingwood", "Essendon", "Fitzroy",
    "Fremantle", "Geelong", "Gold Coast", "GWS", "Hawthorn", "Melbourne",
    "North Melbourne", "Port Adelaide", "Richmond", "South Melbourne",
    "St Kilda", "Sydney", "West Coast", "Western Bulldogs",
}

_SOURCE_KEY_RE = re.compile(r"^(bf-[a-z0-9-]+):([0-9]{4}):([0-9]+)$")
_MAX_CANDIDATE_COUNT = 9


class ClubBestAndFairestSourceError(ValueError):
    """Raised when a canonical source file violates its data contract."""


@dataclass(frozen=True)
class ClubBestAndFairestWinner:
    source_key: str
    award_slug: str
    season: int
    club: str
    player: str
    player_id: int | None
    link_status: str
    candidate_count: int
    note: str | None
    source_citation: str


@dataclass(frozen=True)
class ClubBestAndFairestAward:
    slug: str
    name: str
    category: str
    club: str
    first_season: int
    last_season: int
    source_citation: str


def _required_text(value: str | None, field: str, line: int) -> str:
    if value is None or value == "":
        raise ClubBestAndFairestSourceError(f"line {line}: {field} is required")
    if value != value.strip():
        raise ClubBestAndFairestSourceError(
            f"line {line}: {field} has leading or trailing whitespace"
        )
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise ClubBestAndFairestSourceError(
            f"line {line}: {field} contains a control character"
        )
    return value


def _optional_text(value: str | None, field: str, line: int) -> str | None:
    if value is None or value == "":
        return None
    return _required_text(value, field, line)


def _int(value: str | None, field: str, line: int) -> int:
    text = _required_text(value, field, line)
    if not re.fullmatch(r"-?[0-9]+", text):
        raise ClubBestAndFairestSourceError(
            f"line {line}: {field} must be an integer, got {text!r}"
        )
    return int(text)


def _optional_positive_int(value: str | None, field: str, line: int) -> int | None:
    if value is None or value == "":
        return None
    text = _required_text(value, field, line)
    if not re.fullmatch(r"[0-9]+", text):
        raise ClubBestAndFairestSourceError(
            f"line {line}: {field} must be a positive integer, got {text!r}"
        )
    return int(text)


# ---------------------------------------------------------------------------
# Winners
# ---------------------------------------------------------------------------
def load_club_best_and_fairest(
    path: str | Path = DEFAULT_WINNERS_PATH,
) -> list[ClubBestAndFairestWinner]:
    """Load the complete canonical winners file or fail without partial data."""

    csv_path = Path(path)
    rows: list[ClubBestAndFairestWinner] = []
    source_keys: set[str] = set()
    natural_keys: set[tuple[str, int, str]] = set()
    last_source_key: str | None = None

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, strict=True)
            actual_header = tuple(reader.fieldnames or ())
            if actual_header != WINNERS_HEADER:
                raise ClubBestAndFairestSourceError(
                    "invalid header: expected "
                    f"{','.join(WINNERS_HEADER)!r}, got {','.join(actual_header)!r}"
                )

            for raw in reader:
                line = reader.line_num
                if None in raw:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: too many columns"
                    )

                source_key = _required_text(raw.get("source_key"), "source_key", line)
                award_slug = _required_text(raw.get("award_slug"), "award_slug", line)
                season = _int(raw.get("season"), "season", line)
                club = _required_text(raw.get("club"), "club", line)
                player = _required_text(raw.get("player"), "player", line)
                player_id = _optional_positive_int(
                    raw.get("player_id"), "player_id", line
                )
                link_status = _required_text(
                    raw.get("link_status"), "link_status", line
                )
                candidate_count = _int(
                    raw.get("candidate_count"), "candidate_count", line
                )
                votes = raw.get("votes")
                note = _optional_text(raw.get("note"), "note", line)
                source_citation = _required_text(
                    raw.get("source_citation"), "source_citation", line
                )

                if award_slug not in AWARD_SLUGS:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: unknown award_slug {award_slug!r} "
                        f"(not one of the 19 measured bf-* awards)"
                    )

                match = _SOURCE_KEY_RE.fullmatch(source_key)
                if match is None:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: invalid source_key {source_key!r} "
                        f"(expected bf-<club-slug>:<season>:<row_no>)"
                    )
                if match.group(1) != award_slug:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: source_key {source_key!r} names award "
                        f"{match.group(1)!r} but award_slug is {award_slug!r}"
                    )
                if int(match.group(2)) != season:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: source_key {source_key!r} embeds season "
                        f"{match.group(2)} but the row's season is {season}"
                    )

                if not (MIN_SEASON <= season <= MAX_SEASON):
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: season {season} is outside the declared "
                        f"range {MIN_SEASON}-{MAX_SEASON}"
                    )
                if club not in KNOWN_CLUBS:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: unknown club {club!r} "
                        f"(not a measured club best-and-fairest source club string)"
                    )
                if link_status not in LINK_STATUSES:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: invalid link_status {link_status!r}"
                    )
                if not (0 <= candidate_count <= _MAX_CANDIDATE_COUNT):
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: candidate_count {candidate_count} is outside "
                        f"the plausible range 0-{_MAX_CANDIDATE_COUNT}"
                    )

                is_linked_status = link_status in LINKED_STATUSES
                if is_linked_status and player_id is None:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: link_status {link_status!r} requires player_id"
                    )
                if not is_linked_status and player_id is not None:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: link_status {link_status!r} must not carry "
                        f"player_id"
                    )

                if source_citation != SOURCE_CITATION:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: source_citation {source_citation!r} must be "
                        f"{SOURCE_CITATION!r} (source-granularity provenance)"
                    )

                # votes is empty for every legacy club best-and-fairest row;
                # a value is a source contract change, not something to load
                # through.
                if votes is not None and votes != "":
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: votes is not expected for club "
                        f"best-and-fairest winners (got {votes!r})"
                    )

                # Checked before the ordering rule: a literal repeat of an
                # earlier key is always also an ordering violation, so
                # checking duplication first keeps that failure distinctly
                # reported rather than masked.
                if source_key in source_keys:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: duplicate source_key {source_key!r}"
                    )
                if last_source_key is not None and source_key <= last_source_key:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: source_key {source_key!r} is out of "
                        f"deterministic order (expected strictly ascending, "
                        f"previous was {last_source_key!r})"
                    )
                last_source_key = source_key

                # NOT (award_slug, season): a tied season legitimately lists
                # more than one winner. (award_slug, season, player)
                # distinguishes every measured row.
                natural_key = (award_slug, season, player)
                if natural_key in natural_keys:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: duplicate natural identity "
                        f"(award_slug, season, player) = {natural_key!r}"
                    )

                source_keys.add(source_key)
                natural_keys.add(natural_key)

                rows.append(
                    ClubBestAndFairestWinner(
                        source_key=source_key,
                        award_slug=award_slug,
                        season=season,
                        club=club,
                        player=player,
                        player_id=player_id,
                        link_status=link_status,
                        candidate_count=candidate_count,
                        note=note,
                        source_citation=source_citation,
                    )
                )
    except ClubBestAndFairestSourceError:
        raise
    except (OSError, UnicodeError, csv.Error) as exc:
        raise ClubBestAndFairestSourceError(
            f"cannot read {csv_path}: {exc}"
        ) from exc

    _validate_winners_complete(rows)
    return rows


def _validate_winners_complete(rows: Sequence[ClubBestAndFairestWinner]) -> None:
    if len(rows) != EXPECTED_WINNERS:
        raise ClubBestAndFairestSourceError(
            f"expected {EXPECTED_WINNERS} club best-and-fairest winner rows, "
            f"got {len(rows)}"
        )

    seasons = {row.season for row in rows}
    if min(seasons) != MIN_SEASON or max(seasons) != MAX_SEASON:
        raise ClubBestAndFairestSourceError(
            f"season span {min(seasons)}-{max(seasons)} does not match the "
            f"declared {MIN_SEASON}-{MAX_SEASON}"
        )
    if len(seasons) != EXPECTED_DISTINCT_SEASONS:
        raise ClubBestAndFairestSourceError(
            f"expected {EXPECTED_DISTINCT_SEASONS} distinct seasons, "
            f"got {len(seasons)}"
        )

    slugs = {row.award_slug for row in rows}
    if slugs != set(AWARD_SLUGS):
        missing = sorted(set(AWARD_SLUGS) - slugs)
        extra = sorted(slugs - set(AWARD_SLUGS))
        raise ClubBestAndFairestSourceError(
            f"winners cover {len(slugs)} of the 19 bf-* awards "
            f"(missing {missing}, unexpected {extra})"
        )

    citations = {row.source_citation for row in rows}
    if citations != {SOURCE_CITATION}:
        raise ClubBestAndFairestSourceError(
            f"source_citation vocabulary {sorted(citations)} does not match the "
            f"declared [{SOURCE_CITATION!r}]"
        )

    linked = sum(1 for row in rows if row.player_id is not None)
    if linked != EXPECTED_LINKED:
        raise ClubBestAndFairestSourceError(
            f"expected {EXPECTED_LINKED} linked rows, got {linked} "
            f"({len(rows) - linked} unlinked)"
        )

    note_present = sum(1 for row in rows if row.note is not None)
    if note_present != EXPECTED_NOTE_PRESENT:
        raise ClubBestAndFairestSourceError(
            f"expected {EXPECTED_NOTE_PRESENT} rows with a note, got {note_present}"
        )


# ---------------------------------------------------------------------------
# Definitions
# ---------------------------------------------------------------------------
def load_club_best_and_fairest_definitions(
    path: str | Path = DEFAULT_DEFINITIONS_PATH,
) -> list[ClubBestAndFairestAward]:
    """Load the 19 bf-* award definitions or fail without partial data."""

    csv_path = Path(path)
    rows: list[ClubBestAndFairestAward] = []
    slugs: set[str] = set()
    last_slug: str | None = None

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, strict=True)
            actual_header = tuple(reader.fieldnames or ())
            if actual_header != DEFINITIONS_HEADER:
                raise ClubBestAndFairestSourceError(
                    "invalid definitions header: expected "
                    f"{','.join(DEFINITIONS_HEADER)!r}, got "
                    f"{','.join(actual_header)!r}"
                )

            for raw in reader:
                line = reader.line_num
                if None in raw:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: too many columns"
                    )

                slug = _required_text(raw.get("slug"), "slug", line)
                name = _required_text(raw.get("name"), "name", line)
                category = _required_text(raw.get("category"), "category", line)
                club = _required_text(raw.get("club"), "club", line)
                first_season = _int(raw.get("first_season"), "first_season", line)
                last_season = _int(raw.get("last_season"), "last_season", line)
                source_citation = _required_text(
                    raw.get("source_citation"), "source_citation", line
                )

                if slug not in AWARD_SLUGS:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: unknown slug {slug!r} "
                        f"(not one of the 19 measured bf-* awards)"
                    )
                if category != DEFINITION_CATEGORY:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: category {category!r} must be "
                        f"{DEFINITION_CATEGORY!r}"
                    )
                if club not in KNOWN_CLUBS:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: unknown club {club!r}"
                    )
                if not (MIN_SEASON <= first_season <= last_season <= MAX_SEASON):
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: malformed season bounds "
                        f"{first_season}-{last_season} (must satisfy "
                        f"{MIN_SEASON} <= first <= last <= {MAX_SEASON})"
                    )
                if source_citation != SOURCE_CITATION:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: source_citation {source_citation!r} must be "
                        f"{SOURCE_CITATION!r}"
                    )

                if slug in slugs:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: duplicate slug {slug!r}"
                    )
                if last_slug is not None and slug <= last_slug:
                    raise ClubBestAndFairestSourceError(
                        f"line {line}: slug {slug!r} is out of deterministic order "
                        f"(expected strictly ascending, previous was {last_slug!r})"
                    )
                last_slug = slug
                slugs.add(slug)

                rows.append(
                    ClubBestAndFairestAward(
                        slug=slug,
                        name=name,
                        category=category,
                        club=club,
                        first_season=first_season,
                        last_season=last_season,
                        source_citation=source_citation,
                    )
                )
    except ClubBestAndFairestSourceError:
        raise
    except (OSError, UnicodeError, csv.Error) as exc:
        raise ClubBestAndFairestSourceError(
            f"cannot read {csv_path}: {exc}"
        ) from exc

    if slugs != set(AWARD_SLUGS):
        missing = sorted(set(AWARD_SLUGS) - slugs)
        extra = sorted(slugs - set(AWARD_SLUGS))
        raise ClubBestAndFairestSourceError(
            f"expected exactly the 19 bf-* award definitions "
            f"(missing {missing}, unexpected {extra})"
        )
    return rows


def validate_family(
    winners: Sequence[ClubBestAndFairestWinner],
    definitions: Sequence[ClubBestAndFairestAward],
) -> None:
    """Cross-check the two files against each other.

    Every winner's award must have a definition, and each definition's
    declared span must be exactly the min/max season of its winners — a
    drift between the two files is a curation error, not something to
    resolve silently at load time.
    """
    by_slug = {award.slug: award for award in definitions}
    spans: dict[str, tuple[int, int]] = {}
    for row in winners:
        low, high = spans.get(row.award_slug, (row.season, row.season))
        spans[row.award_slug] = (min(low, row.season), max(high, row.season))

    for slug, (first, last) in sorted(spans.items()):
        award = by_slug.get(slug)
        if award is None:
            raise ClubBestAndFairestSourceError(
                f"winners reference award {slug!r} with no definition row"
            )
        if (award.first_season, award.last_season) != (first, last):
            raise ClubBestAndFairestSourceError(
                f"award {slug!r} definition span "
                f"{award.first_season}-{award.last_season} does not match its "
                f"winners' {first}-{last}"
            )


def summary(
    winners: Sequence[ClubBestAndFairestWinner],
    definitions: Sequence[ClubBestAndFairestAward],
    winners_path: str | Path,
    definitions_path: str | Path,
) -> dict[str, object]:
    seasons = [row.season for row in winners]
    statuses = Counter(row.link_status for row in winners)
    by_award = Counter(row.award_slug for row in winners)
    return {
        "ok": True,
        "winners_path": str(Path(winners_path).resolve()),
        "definitions_path": str(Path(definitions_path).resolve()),
        "winner_count": len(winners),
        "definition_count": len(definitions),
        "linked_count": sum(1 for row in winners if row.player_id is not None),
        "unlinked_count": sum(1 for row in winners if row.player_id is None),
        "season_min": min(seasons),
        "season_max": max(seasons),
        "distinct_seasons": len(set(seasons)),
        "distinct_awards": len(by_award),
        "note_present": sum(1 for row in winners if row.note is not None),
        "link_status": {name: statuses[name] for name in sorted(statuses)},
        "winners_by_award": {name: by_award[name] for name in sorted(by_award)},
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--csv",
        type=Path,
        default=DEFAULT_WINNERS_PATH,
        help=f"canonical winners path (default: {DEFAULT_WINNERS_PATH})",
    )
    parser.add_argument(
        "--definitions",
        type=Path,
        default=DEFAULT_DEFINITIONS_PATH,
        help=f"canonical definitions path (default: {DEFAULT_DEFINITIONS_PATH})",
    )
    args = parser.parse_args(argv)
    try:
        winners = load_club_best_and_fairest(args.csv)
        definitions = load_club_best_and_fairest_definitions(args.definitions)
        validate_family(winners, definitions)
    except ClubBestAndFairestSourceError as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "winners_path": str(args.csv.resolve()),
                    "definitions_path": str(args.definitions.resolve()),
                    "error": str(exc),
                },
                sort_keys=True,
            )
        )
        return 1

    print(
        json.dumps(
            summary(winners, definitions, args.csv, args.definitions),
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
