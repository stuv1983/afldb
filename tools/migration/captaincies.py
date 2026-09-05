#!/usr/bin/env python3
"""Parse and validate the canonical captaincies source file.

The source is deliberately checked before any database importer sees a row.
Malformed or incomplete data raises ``CaptainciesSourceError``; no
best-effort coercion is performed here.

AFLDB-ISSUE-112 phase 3 (§19). The bootstrap content was extracted
read-only from ``afldb_dev.captaincies`` (1,375 rows, all provenance
``wikipedia``); ``source_citation`` is source-granularity canonical
provenance only, per the operator policy recorded for this family — it is
not a claim that any row identifies the exact historical page or edition
it came from.

Unlike the honour-teams and Hall of Fame slices, ``captaincies`` already
carries a stable ``source_record_id`` on every row and reloads on
``(source_id, source_record_id)`` — not a natural key. ``source_key`` in
this manifest is therefore the *preserved* database ``source_record_id``
(a 24-hex-character digest minted by the original legacy scrape), carried
verbatim: it is **not** re-minted here and the loader keys the reload on
it unchanged.

``club`` is the canonical ``clubs.name`` for the row's era identity. It is
re-resolved through ``import_awards.ClubResolver`` at load time — exactly
the path the legacy loader used for its raw club string — so the manifest
carries a rebuild-stable club identity rather than a frozen ``club_id``.
Every one of the 1,375 rows was verified to round-trip
(``identity_for_season(org, season)`` reproduces the stored ``club_id``).
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


DEFAULT_CSV_PATH = (
    Path(__file__).resolve().parents[2] / "data" / "awards" / "captaincies.csv"
)
EXPECTED_HEADER = (
    "source_key",
    "season",
    "club",
    "player",
    "player_id",
    "link_status",
    "role",
    "period",
    "note",
    "source_citation",
)

# Declared coverage, measured read-only against afldb_dev
# (AFLDB-ISSUE-112 §14.4 / §19). A row count or season span outside this is
# a source contract change, not a formatting slip — bump these when a later
# season's captaincies are curated in.
# AFLDB-ISSUE-118 §23.21 (Family B): +400 rows for the six clubs the bootstrap
# lacked (Geelong, Hawthorn, West Coast, Fitzroy, Brisbane Bears, University),
# transcribed from the Wikipedia captain lists (Hawthorn 1952, Peter O'Donohue, has no
# AFL Tables identity and is recorded in the runbook, not here).
EXPECTED_TOTAL = 1774
MIN_SEASON = 1897
MAX_SEASON = 2026
EXPECTED_DISTINCT_SEASONS = 130

# The canonical clubs represented in the captaincies data, measured against
# afldb_dev. Every value is an exact ``clubs.name`` that
# import_awards.ClubResolver resolves deterministically. Footscray/Western
# Bulldogs, South Melbourne/Sydney and North Melbourne/Kangaroos are the
# three era-identity pairs; the loader's season-aware resolver picks the
# right one. Adding a club here is a deliberate change, not a parser fix.
KNOWN_CLUBS = {
    "Adelaide", "Brisbane Bears", "Brisbane Lions", "Carlton", "Collingwood",
    "Essendon", "Fitzroy", "Footscray", "Fremantle", "Geelong", "Gold Coast",
    "Greater Western Sydney", "Hawthorn", "Kangaroos", "Melbourne",
    "North Melbourne", "Port Adelaide", "Richmond", "South Melbourne",
    "St Kilda", "Sydney", "University", "West Coast", "Western Bulldogs",
}
EXPECTED_DISTINCT_CLUBS = 24

# role vocabulary as measured — a single value. "Vice-captain" or a
# co-captain role would be a new vocabulary entry, i.e. a deliberate change.
ROLES = {"Captain"}

# The link_status enum (migration 005), and the subset that requires a
# player_id (the migration 019/053 invariant, enforced here rather than
# left to the database). Every captaincy row is linked today; a future
# unlinked intake needs LINKED completeness relaxed deliberately.
LINK_STATUSES = {"unique", "resolved", "ambiguous", "unmatched", "implausible"}
LINKED_STATUSES = {"unique", "resolved"}

# The operator policy for this family (AFLDB-ISSUE-112 §14.5 item 1 / §13):
# every captaincy row is sourced from wikipedia, and source_citation
# records that at source granularity only. Widening this set is a new
# decision, not a parser change.
SOURCE_CITATIONS = {"wikipedia"}

_SOURCE_KEY = re.compile(r"^[0-9a-f]{24}$")


class CaptainciesSourceError(ValueError):
    """Raised when the canonical source violates its data contract."""


@dataclass(frozen=True)
class Captaincy:
    source_key: str
    season: int
    club: str
    player: str
    player_id: int | None
    link_status: str
    role: str
    period: str
    note: str | None
    source_citation: str


def _required_text(value: str | None, field: str, line: int) -> str:
    if value is None or value == "":
        raise CaptainciesSourceError(f"line {line}: {field} is required")
    if value != value.strip():
        raise CaptainciesSourceError(
            f"line {line}: {field} has leading or trailing whitespace"
        )
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise CaptainciesSourceError(
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
        raise CaptainciesSourceError(
            f"line {line}: {field} must be an integer, got {text!r}"
        )
    return int(text)


def _optional_int(value: str | None, field: str, line: int) -> int | None:
    if value is None or value == "":
        return None
    text = _required_text(value, field, line)
    if not re.fullmatch(r"[0-9]+", text):
        raise CaptainciesSourceError(
            f"line {line}: {field} must be a positive integer, got {text!r}"
        )
    return int(text)


def load_captaincies(path: str | Path = DEFAULT_CSV_PATH) -> list[Captaincy]:
    """Load the complete canonical captaincies source or fail without partial data."""

    csv_path = Path(path)
    rows: list[Captaincy] = []
    source_keys: set[str] = set()
    natural_keys: set[tuple[int, str, str, str]] = set()
    last_source_key: str | None = None

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, strict=True)
            actual_header = tuple(reader.fieldnames or ())
            if actual_header != EXPECTED_HEADER:
                raise CaptainciesSourceError(
                    "invalid header: expected "
                    f"{','.join(EXPECTED_HEADER)!r}, got {','.join(actual_header)!r}"
                )

            for raw in reader:
                line = reader.line_num
                if None in raw:
                    raise CaptainciesSourceError(f"line {line}: too many columns")

                source_key = _required_text(raw.get("source_key"), "source_key", line)
                season = _int(raw.get("season"), "season", line)
                club = _required_text(raw.get("club"), "club", line)
                player = _required_text(raw.get("player"), "player", line)
                player_id = _optional_int(raw.get("player_id"), "player_id", line)
                link_status = _required_text(raw.get("link_status"), "link_status", line)
                role = _required_text(raw.get("role"), "role", line)
                period = _required_text(raw.get("period"), "period", line)
                note = _optional_text(raw.get("note"), "note", line)
                source_citation = _required_text(
                    raw.get("source_citation"), "source_citation", line
                )

                if _SOURCE_KEY.fullmatch(source_key) is None:
                    raise CaptainciesSourceError(
                        f"line {line}: invalid source_key {source_key!r} "
                        f"(expected 24 hex characters — the preserved "
                        f"source_record_id)"
                    )
                if not (MIN_SEASON <= season <= MAX_SEASON):
                    raise CaptainciesSourceError(
                        f"line {line}: season {season} is outside the declared "
                        f"range {MIN_SEASON}-{MAX_SEASON}"
                    )
                if club not in KNOWN_CLUBS:
                    raise CaptainciesSourceError(
                        f"line {line}: unknown club {club!r} "
                        f"(not a canonical AFLDB club name)"
                    )
                if role not in ROLES:
                    raise CaptainciesSourceError(
                        f"line {line}: invalid role {role!r} (only {sorted(ROLES)})"
                    )
                if link_status not in LINK_STATUSES:
                    raise CaptainciesSourceError(
                        f"line {line}: invalid link_status {link_status!r}"
                    )
                if source_citation not in SOURCE_CITATIONS:
                    raise CaptainciesSourceError(
                        f"line {line}: source_citation {source_citation!r} is not an "
                        f"authorised value for this family "
                        f"(only {sorted(SOURCE_CITATIONS)})"
                    )

                is_linked_status = link_status in LINKED_STATUSES
                if is_linked_status and player_id is None:
                    raise CaptainciesSourceError(
                        f"line {line}: link_status {link_status!r} requires player_id"
                    )
                if not is_linked_status and player_id is not None:
                    raise CaptainciesSourceError(
                        f"line {line}: link_status {link_status!r} must not carry "
                        f"player_id"
                    )

                # Checked before the ordering rule below: a literal repeat of
                # an earlier key is always also an ordering violation (the
                # file is strictly ascending), and that would otherwise mask
                # this as an ordering error rather than the duplicate it is.
                if source_key in source_keys:
                    raise CaptainciesSourceError(
                        f"line {line}: duplicate source_key {source_key!r}"
                    )
                if last_source_key is not None and source_key <= last_source_key:
                    raise CaptainciesSourceError(
                        f"line {line}: source_key {source_key!r} is out of "
                        f"deterministic order (expected strictly ascending, "
                        f"previous was {last_source_key!r})"
                    )
                last_source_key = source_key

                natural_key = (season, club, player, role)
                if natural_key in natural_keys:
                    raise CaptainciesSourceError(
                        f"line {line}: duplicate natural identity "
                        f"(season, club, player, role) = {natural_key!r}"
                    )

                source_keys.add(source_key)
                natural_keys.add(natural_key)

                rows.append(
                    Captaincy(
                        source_key=source_key,
                        season=season,
                        club=club,
                        player=player,
                        player_id=player_id,
                        link_status=link_status,
                        role=role,
                        period=period,
                        note=note,
                        source_citation=source_citation,
                    )
                )
    except CaptainciesSourceError:
        raise
    except (OSError, UnicodeError, csv.Error) as exc:
        raise CaptainciesSourceError(f"cannot read {csv_path}: {exc}") from exc

    _validate_complete(rows)
    return rows


def _validate_complete(rows: Sequence[Captaincy]) -> None:
    if len(rows) != EXPECTED_TOTAL:
        raise CaptainciesSourceError(
            f"expected {EXPECTED_TOTAL} captaincy rows, got {len(rows)}"
        )
    seasons = {row.season for row in rows}
    if min(seasons) != MIN_SEASON or max(seasons) != MAX_SEASON:
        raise CaptainciesSourceError(
            f"season span {min(seasons)}-{max(seasons)} does not match the "
            f"declared {MIN_SEASON}-{MAX_SEASON}"
        )
    if len(seasons) != EXPECTED_DISTINCT_SEASONS:
        raise CaptainciesSourceError(
            f"expected {EXPECTED_DISTINCT_SEASONS} distinct seasons, "
            f"got {len(seasons)}"
        )
    clubs = {row.club for row in rows}
    if len(clubs) != EXPECTED_DISTINCT_CLUBS:
        raise CaptainciesSourceError(
            f"expected {EXPECTED_DISTINCT_CLUBS} distinct clubs, got {len(clubs)}: "
            f"{sorted(clubs)}"
        )
    unlinked = [row.source_key for row in rows if row.player_id is None]
    if unlinked:
        raise CaptainciesSourceError(
            f"every captaincy row is expected to be linked; "
            f"{len(unlinked)} are not (e.g. {unlinked[0]!r})"
        )
    roles = {row.role for row in rows}
    if roles != ROLES:
        raise CaptainciesSourceError(
            f"role vocabulary {sorted(roles)} does not match the declared "
            f"{sorted(ROLES)}"
        )


def summary(rows: Sequence[Captaincy], path: str | Path) -> dict[str, object]:
    seasons = [row.season for row in rows]
    roles = Counter(row.role for row in rows)
    return {
        "ok": True,
        "path": str(Path(path).resolve()),
        "row_count": len(rows),
        "linked_count": sum(1 for row in rows if row.player_id is not None),
        "unlinked_count": sum(1 for row in rows if row.player_id is None),
        "season_min": min(seasons),
        "season_max": max(seasons),
        "distinct_seasons": len(set(seasons)),
        "distinct_clubs": len({row.club for row in rows}),
        "notes_present": sum(1 for row in rows if row.note is not None),
        "roles": {name: roles[name] for name in sorted(roles)},
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--csv",
        type=Path,
        default=DEFAULT_CSV_PATH,
        help=f"canonical source path (default: {DEFAULT_CSV_PATH})",
    )
    args = parser.parse_args(argv)
    try:
        rows = load_captaincies(args.csv)
    except CaptainciesSourceError as exc:
        print(
            json.dumps(
                {"ok": False, "path": str(args.csv.resolve()), "error": str(exc)},
                sort_keys=True,
            )
        )
        return 1

    print(json.dumps(summary(rows, args.csv), sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
