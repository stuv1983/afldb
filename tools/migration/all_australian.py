#!/usr/bin/env python3
"""Parse and validate the canonical All-Australian source file.

The source is deliberately checked before any database importer sees a row.
Malformed or incomplete data raises ``AllAustralianSourceError``; no
best-effort coercion is performed here.

AFLDB-ISSUE-112 phase 5 (§21). The bootstrap content was extracted
read-only from ``afldb_dev.award_winners`` (the ``all-australian`` award,
1,158 rows) — the flat, already-merged result of the legacy loader's two
input tables (``all_australian`` draftguru + ``all_australian_history``
wikipedia). The manifest carries one row per selection slot; the merge
that produced it is already baked into which rows exist, so this parser —
and the loader that reads it — needs no merge logic.

Unlike the honour-teams and Hall of Fame slices, ``award_winners`` already
carries a stable ``source_record_id`` on every row and reloads on
``(source_id, source_record_id)`` — not a natural key. ``source_key`` in
this manifest is therefore the *preserved* database ``source_record_id``,
carried verbatim: it is **not** re-minted here and the loader keys the
reload on it unchanged. draftguru rows are ``aa:<season>:<row_no>``;
wikipedia rows are ``aah:<season>:<player_source>:<club_source>`` (the
Wikipedia scrape keeps the era's ``*`` selection marker inside the key —
that is deliberate and must survive verbatim).

This family has **two** provenance sources and they must not be flattened:
``source`` is ``draftguru`` (906 rows, 1979-2025, the detailed table with
position, captaincy and a "N time All-Australian" note) or ``wikipedia``
(252 rows, 1953-1990, the carnival-era history with neither). Per-row
``source`` decides the reload ``source_id``; ``source_citation`` records
the same value at source granularity only, per the operator policy for
this family — it is not a claim that any row identifies the exact page or
edition it came from.

``club`` is the source's own verbatim club string — exactly the value the
legacy loader passed to ``import_awards.ClubResolver`` and exactly what it
stored in ``award_winners.club_name_raw``. The loader re-resolves it
season-aware at load time, so ``club_id`` is reconstructed (rebuild-stable
against a canonically rebuilt ``clubs`` / ``club_aliases``), never frozen,
while ``club_name_raw`` round-trips byte-for-byte. 149 rows name a
state-league club or an interstate side (``Vic``, ``WA``, …) that has no
AFLDB ``club_id`` and resolves to NULL — deterministically, both today and
after a rebuild. 50 draftguru rows (1979-1988) have no club at all; those
cells are empty and load back NULL.

Legitimate same-season duplicate names exist by design and must not be
collapsed: the 1984 carnival team lists nine players under both their club
and their state selection (``Ross Glendinning`` / ``North Melbourne`` and
``Ross Glendinning*`` / ``WA``), and 2016 selected two different
footballers both named ``Josh Kennedy`` (Sydney and West Coast). Every one
is a distinct row with its own ``source_key``. The parser therefore does
**not** enforce ``(season, player)`` uniqueness; it enforces
``source_key`` uniqueness and the finer ``(season, player, club)``
identity, both of which these rows satisfy (measured collision-free).
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
    Path(__file__).resolve().parents[2] / "data" / "awards" / "all-australian.csv"
)
EXPECTED_HEADER = (
    "source_key",
    "source",
    "season",
    "club",
    "player",
    "player_id",
    "link_status",
    "candidate_count",
    "position",
    "is_captain",
    "is_vice_captain",
    "note",
    "votes",
    "source_citation",
)

# Declared coverage, measured read-only against afldb_dev
# (AFLDB-ISSUE-112 §14.4 / §21). A row count, season span or per-family
# distribution outside this is a source contract change, not a formatting
# slip — bump these when a later season's team is curated in.
EXPECTED_TOTAL = 1158
MIN_SEASON = 1953
MAX_SEASON = 2025
# The carnival era is not contiguous (1953, 1956, 1958, 1961, 1966, 1969,
# 1972, then 1979 on), so this is a distinct-count check, not span + 1.
EXPECTED_DISTINCT_SEASONS = 53
EXPECTED_LINKED = 1078
EXPECTED_POSITION_PRESENT = 760
EXPECTED_NOTE_PRESENT = 906
EXPECTED_CAPTAINS = 34
EXPECTED_VICE_CAPTAINS = 21

# The two provenance sources, kept distinct (AFLDB-ISSUE-112 §2, §21). Per
# row, source_citation must equal source; widening either set is a new
# operator decision, not a parser change.
SOURCES = {"draftguru", "wikipedia"}
SOURCE_CITATIONS = {"draftguru", "wikipedia"}
EXPECTED_BY_SOURCE = {"draftguru": 906, "wikipedia": 252}

# The link_status enum (migration 005) and the subset that requires a
# player_id (the migration 019/053 invariant, enforced here rather than
# left to the database). Unlike the other slices this family carries
# legitimately unlinked rows (80), so completeness is a fixed expected
# linked count, not "every row linked".
LINK_STATUSES = {"unique", "resolved", "ambiguous", "unmatched", "implausible"}
LINKED_STATUSES = {"unique", "resolved"}

# The source club strings measured across all 1,108 non-empty club cells
# in afldb_dev — canonical AFL/VFL names, plus the state-league sides and
# interstate abbreviations the carnival-era teams used. import_awards
# .ClubResolver maps each deterministically (many to a NULL club_id, which
# is correct). Adding a value here is a deliberate change, not a parser fix.
KNOWN_CLUBS = {
    "Adelaide", "Brisbane", "Carlton", "City", "Claremont", "Collingwood",
    "East Fremantle", "East Perth", "Essendon", "Fitzroy", "Footscray",
    "Fremantle", "GWS", "Geelong", "Glenelg", "Gold Coast", "Hawthorn",
    "Latrobe", "Launceston", "Melbourne", "Mordialloc", "NSW", "NT",
    "New Norfolk", "New Town", "North Adelaide", "North Launceston",
    "North Melbourne", "Norwood", "Perth", "Port Adelaide", "Port Melbourne",
    "Preston", "Richmond", "SA", "Scottsdale", "South Adelaide",
    "South Fremantle", "South Melbourne", "St Kilda", "Sturt", "Subiaco",
    "Swan Dists", "Sydney", "Sydney Swans", "Vic", "WA", "West Adelaide",
    "West Coast", "West Perth", "West Torr", "West Torrens", "Western Bulldogs",
    "Woodville", "Wynyard",
}

# The position vocabulary as measured — draftguru's line-up slot codes.
# History (wikipedia) rows carry no position.
POSITIONS = {
    "BP", "C", "CHB", "CHF", "FB", "FF", "FP", "HBF", "HFF", "IC", "RR", "Ro",
    "Ru", "W",
}

# The only note shape the legacy loader ever emitted for this family
# ("{n} time All-Australian", n >= 1). Present on every draftguru row,
# absent on every wikipedia row — a measured structural contract.
_NOTE_RE = re.compile(r"^[1-9][0-9]* time All-Australian$")
_DRAFTGURU_KEY = re.compile(r"^aa:([0-9]{4}):[0-9]+$")
_WIKIPEDIA_KEY = re.compile(r"^aah:([0-9]{4}):.+$")
_BOOLEANS = {"true": True, "false": False}
_MAX_CANDIDATE_COUNT = 9


class AllAustralianSourceError(ValueError):
    """Raised when the canonical source violates its data contract."""


@dataclass(frozen=True)
class AllAustralianSelection:
    source_key: str
    source: str
    season: int
    club: str | None
    player: str
    player_id: int | None
    link_status: str
    candidate_count: int
    position: str | None
    is_captain: bool
    is_vice_captain: bool
    note: str | None
    source_citation: str


def _required_text(value: str | None, field: str, line: int) -> str:
    if value is None or value == "":
        raise AllAustralianSourceError(f"line {line}: {field} is required")
    if value != value.strip():
        raise AllAustralianSourceError(
            f"line {line}: {field} has leading or trailing whitespace"
        )
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise AllAustralianSourceError(
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
        raise AllAustralianSourceError(
            f"line {line}: {field} must be an integer, got {text!r}"
        )
    return int(text)


def _optional_positive_int(value: str | None, field: str, line: int) -> int | None:
    if value is None or value == "":
        return None
    text = _required_text(value, field, line)
    if not re.fullmatch(r"[0-9]+", text):
        raise AllAustralianSourceError(
            f"line {line}: {field} must be a positive integer, got {text!r}"
        )
    return int(text)


def _bool(value: str | None, field: str, line: int) -> bool:
    text = _required_text(value, field, line)
    if text not in _BOOLEANS:
        raise AllAustralianSourceError(
            f"line {line}: {field} must be 'true' or 'false', got {text!r}"
        )
    return _BOOLEANS[text]


def load_all_australian(
    path: str | Path = DEFAULT_CSV_PATH,
) -> list[AllAustralianSelection]:
    """Load the complete canonical All-Australian source or fail without partial data."""

    csv_path = Path(path)
    rows: list[AllAustralianSelection] = []
    source_keys: set[str] = set()
    natural_keys: set[tuple[int, str, str]] = set()
    last_source_key: str | None = None

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, strict=True)
            actual_header = tuple(reader.fieldnames or ())
            if actual_header != EXPECTED_HEADER:
                raise AllAustralianSourceError(
                    "invalid header: expected "
                    f"{','.join(EXPECTED_HEADER)!r}, got {','.join(actual_header)!r}"
                )

            for raw in reader:
                line = reader.line_num
                if None in raw:
                    raise AllAustralianSourceError(f"line {line}: too many columns")

                source_key = _required_text(raw.get("source_key"), "source_key", line)
                source = _required_text(raw.get("source"), "source", line)
                season = _int(raw.get("season"), "season", line)
                club = _optional_text(raw.get("club"), "club", line)
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
                position = _optional_text(raw.get("position"), "position", line)
                is_captain = _bool(raw.get("is_captain"), "is_captain", line)
                is_vice_captain = _bool(
                    raw.get("is_vice_captain"), "is_vice_captain", line
                )
                note = _optional_text(raw.get("note"), "note", line)
                votes = raw.get("votes")
                source_citation = _required_text(
                    raw.get("source_citation"), "source_citation", line
                )

                if source not in SOURCES:
                    raise AllAustralianSourceError(
                        f"line {line}: unknown source {source!r} "
                        f"(only {sorted(SOURCES)})"
                    )
                if source_citation != source:
                    raise AllAustralianSourceError(
                        f"line {line}: source_citation {source_citation!r} must "
                        f"equal the row's source {source!r} (source-granularity "
                        f"provenance)"
                    )

                key_re = _DRAFTGURU_KEY if source == "draftguru" else _WIKIPEDIA_KEY
                match = key_re.fullmatch(source_key)
                if match is None:
                    raise AllAustralianSourceError(
                        f"line {line}: invalid source_key {source_key!r} for source "
                        f"{source!r} (expected {'aa:<season>:<n>' if source == 'draftguru' else 'aah:<season>:<...>'})"
                    )
                if int(match.group(1)) != season:
                    raise AllAustralianSourceError(
                        f"line {line}: source_key {source_key!r} embeds season "
                        f"{match.group(1)} but the row's season is {season}"
                    )

                if not (MIN_SEASON <= season <= MAX_SEASON):
                    raise AllAustralianSourceError(
                        f"line {line}: season {season} is outside the declared "
                        f"range {MIN_SEASON}-{MAX_SEASON}"
                    )
                if club is not None and club not in KNOWN_CLUBS:
                    raise AllAustralianSourceError(
                        f"line {line}: unknown club {club!r} "
                        f"(not a measured All-Australian source club string)"
                    )
                if link_status not in LINK_STATUSES:
                    raise AllAustralianSourceError(
                        f"line {line}: invalid link_status {link_status!r}"
                    )
                if not (0 <= candidate_count <= _MAX_CANDIDATE_COUNT):
                    raise AllAustralianSourceError(
                        f"line {line}: candidate_count {candidate_count} is outside "
                        f"the plausible range 0-{_MAX_CANDIDATE_COUNT}"
                    )

                is_linked_status = link_status in LINKED_STATUSES
                if is_linked_status and player_id is None:
                    raise AllAustralianSourceError(
                        f"line {line}: link_status {link_status!r} requires player_id"
                    )
                if not is_linked_status and player_id is not None:
                    raise AllAustralianSourceError(
                        f"line {line}: link_status {link_status!r} must not carry "
                        f"player_id"
                    )

                # position / captaincy / note are draftguru-only facts; the
                # carnival-era history rows carry none of them. Enforced both
                # directions so a stray value or a missing one is caught.
                if position is not None:
                    if source != "draftguru":
                        raise AllAustralianSourceError(
                            f"line {line}: position {position!r} on a {source!r} row "
                            f"(only draftguru rows carry a position)"
                        )
                    if position not in POSITIONS:
                        raise AllAustralianSourceError(
                            f"line {line}: unknown position {position!r}"
                        )
                if (is_captain or is_vice_captain) and source != "draftguru":
                    raise AllAustralianSourceError(
                        f"line {line}: captaincy flag on a {source!r} row "
                        f"(only draftguru rows carry captaincy)"
                    )
                if is_captain and is_vice_captain:
                    raise AllAustralianSourceError(
                        f"line {line}: a row cannot be both is_captain and "
                        f"is_vice_captain"
                    )
                if source == "draftguru":
                    if note is None:
                        raise AllAustralianSourceError(
                            f"line {line}: a draftguru row must carry a "
                            f"'N time All-Australian' note"
                        )
                    if _NOTE_RE.fullmatch(note) is None:
                        raise AllAustralianSourceError(
                            f"line {line}: note {note!r} is not of the form "
                            f"'N time All-Australian'"
                        )
                elif note is not None:
                    raise AllAustralianSourceError(
                        f"line {line}: a {source!r} row must not carry a note "
                        f"(got {note!r})"
                    )

                # votes is NULL for every All-Australian row; a value is a
                # source contract change, not something to load through.
                if votes is not None and votes != "":
                    raise AllAustralianSourceError(
                        f"line {line}: votes is not expected for All-Australian "
                        f"selections (got {votes!r})"
                    )

                # Checked before the ordering rule: a literal repeat of an
                # earlier key is always also an ordering violation (the file
                # is strictly ascending), so checking duplication first keeps
                # that failure distinctly reported rather than masked.
                if source_key in source_keys:
                    raise AllAustralianSourceError(
                        f"line {line}: duplicate source_key {source_key!r}"
                    )
                if last_source_key is not None and source_key <= last_source_key:
                    raise AllAustralianSourceError(
                        f"line {line}: source_key {source_key!r} is out of "
                        f"deterministic order (expected strictly ascending, "
                        f"previous was {last_source_key!r})"
                    )
                last_source_key = source_key

                # NOT (season, player): the 1984 club/state dual selections
                # and the 2016 Josh Kennedy pair are legitimate same-season
                # same-name rows. (season, player, club) distinguishes every
                # one of them and is measured collision-free.
                natural_key = (season, player, club or "")
                if natural_key in natural_keys:
                    raise AllAustralianSourceError(
                        f"line {line}: duplicate natural identity "
                        f"(season, player, club) = "
                        f"{(season, player, club)!r}"
                    )

                source_keys.add(source_key)
                natural_keys.add(natural_key)

                rows.append(
                    AllAustralianSelection(
                        source_key=source_key,
                        source=source,
                        season=season,
                        club=club,
                        player=player,
                        player_id=player_id,
                        link_status=link_status,
                        candidate_count=candidate_count,
                        position=position,
                        is_captain=is_captain,
                        is_vice_captain=is_vice_captain,
                        note=note,
                        source_citation=source_citation,
                    )
                )
    except AllAustralianSourceError:
        raise
    except (OSError, UnicodeError, csv.Error) as exc:
        raise AllAustralianSourceError(f"cannot read {csv_path}: {exc}") from exc

    _validate_complete(rows)
    return rows


def _validate_complete(rows: Sequence[AllAustralianSelection]) -> None:
    if len(rows) != EXPECTED_TOTAL:
        raise AllAustralianSourceError(
            f"expected {EXPECTED_TOTAL} All-Australian rows, got {len(rows)}"
        )

    seasons = {row.season for row in rows}
    if min(seasons) != MIN_SEASON or max(seasons) != MAX_SEASON:
        raise AllAustralianSourceError(
            f"season span {min(seasons)}-{max(seasons)} does not match the "
            f"declared {MIN_SEASON}-{MAX_SEASON}"
        )
    if len(seasons) != EXPECTED_DISTINCT_SEASONS:
        raise AllAustralianSourceError(
            f"expected {EXPECTED_DISTINCT_SEASONS} distinct seasons, "
            f"got {len(seasons)}"
        )

    by_source = Counter(row.source for row in rows)
    if dict(by_source) != EXPECTED_BY_SOURCE:
        raise AllAustralianSourceError(
            f"source split {dict(by_source)} does not match the declared "
            f"{EXPECTED_BY_SOURCE}"
        )

    citations = {row.source_citation for row in rows}
    if citations != SOURCE_CITATIONS:
        raise AllAustralianSourceError(
            f"source_citation vocabulary {sorted(citations)} does not match the "
            f"declared {sorted(SOURCE_CITATIONS)}"
        )

    linked = sum(1 for row in rows if row.player_id is not None)
    if linked != EXPECTED_LINKED:
        raise AllAustralianSourceError(
            f"expected {EXPECTED_LINKED} linked rows, got {linked} "
            f"({len(rows) - linked} unlinked)"
        )

    position_present = sum(1 for row in rows if row.position is not None)
    if position_present != EXPECTED_POSITION_PRESENT:
        raise AllAustralianSourceError(
            f"expected {EXPECTED_POSITION_PRESENT} rows with a position, "
            f"got {position_present}"
        )

    note_present = sum(1 for row in rows if row.note is not None)
    if note_present != EXPECTED_NOTE_PRESENT:
        raise AllAustralianSourceError(
            f"expected {EXPECTED_NOTE_PRESENT} rows with a note, got {note_present}"
        )

    captains = sum(1 for row in rows if row.is_captain)
    if captains != EXPECTED_CAPTAINS:
        raise AllAustralianSourceError(
            f"expected {EXPECTED_CAPTAINS} captain rows, got {captains}"
        )
    vice_captains = sum(1 for row in rows if row.is_vice_captain)
    if vice_captains != EXPECTED_VICE_CAPTAINS:
        raise AllAustralianSourceError(
            f"expected {EXPECTED_VICE_CAPTAINS} vice-captain rows, "
            f"got {vice_captains}"
        )


def summary(
    rows: Sequence[AllAustralianSelection], path: str | Path
) -> dict[str, object]:
    seasons = [row.season for row in rows]
    statuses = Counter(row.link_status for row in rows)
    by_source = Counter(row.source for row in rows)
    return {
        "ok": True,
        "path": str(Path(path).resolve()),
        "row_count": len(rows),
        "linked_count": sum(1 for row in rows if row.player_id is not None),
        "unlinked_count": sum(1 for row in rows if row.player_id is None),
        "season_min": min(seasons),
        "season_max": max(seasons),
        "distinct_seasons": len(set(seasons)),
        "by_source": {name: by_source[name] for name in sorted(by_source)},
        "position_present": sum(1 for row in rows if row.position is not None),
        "note_present": sum(1 for row in rows if row.note is not None),
        "captains": sum(1 for row in rows if row.is_captain),
        "vice_captains": sum(1 for row in rows if row.is_vice_captain),
        "null_club": sum(1 for row in rows if row.club is None),
        "link_status": {name: statuses[name] for name in sorted(statuses)},
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
        rows = load_all_australian(args.csv)
    except AllAustralianSourceError as exc:
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
