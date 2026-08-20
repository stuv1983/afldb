#!/usr/bin/env python3
"""Parse and validate the canonical AFLPA 22under22 source file.

The source is deliberately checked before any database importer sees a row.
Malformed or incomplete seasons raise ``Under22SourceError``; no best-effort
coercion is performed here.
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
    Path(__file__).resolve().parents[2] / "data" / "awards" / "22-under-22.csv"
)
EXPECTED_HEADER = (
    "source_key",
    "season",
    "position",
    "player",
    "club",
    "is_captain",
    "is_vice_captain",
)
EXPECTED_SEASONS = tuple(range(2012, 2027))
POSITION_SLOT_COUNTS = {
    "B": 3,
    "HB": 3,
    "C": 3,
    "HF": 3,
    "F": 3,
    "R": 3,
    "I/C": 4,
}
POSITION_KEY = {
    "B": "b",
    "HB": "hb",
    "C": "c",
    "HF": "hf",
    "F": "f",
    "R": "r",
    "I/C": "ic",
}
KEY_POSITION = {value: key for key, value in POSITION_KEY.items()}
_SOURCE_KEY = re.compile(
    r"^22under22:(?P<season>[0-9]{4}):"
    r"(?P<position>b|hb|c|hf|f|r|ic):(?P<slot>[1-4])$"
)


class Under22SourceError(ValueError):
    """Raised when the canonical source violates its data contract."""


@dataclass(frozen=True)
class Under22Selection:
    source_key: str
    season: int
    position: str
    player: str
    club: str
    is_captain: bool
    is_vice_captain: bool

    @property
    def sort_order(self) -> int:
        """One-based formation order: B, HB, C, HF, F, R, then I/C."""
        match = _SOURCE_KEY.fullmatch(self.source_key)
        if match is None:  # load_under_22 rejects this before constructing rows
            raise Under22SourceError(f"invalid source_key {self.source_key!r}")
        offset = 0
        for position, count in POSITION_SLOT_COUNTS.items():
            if position == self.position:
                return offset + int(match.group("slot"))
            offset += count
        raise Under22SourceError(f"invalid position {self.position!r}")


def _required_text(value: str | None, field: str, line: int) -> str:
    if value is None or not value:
        raise Under22SourceError(f"line {line}: {field} is required")
    if value != value.strip():
        raise Under22SourceError(
            f"line {line}: {field} has leading or trailing whitespace"
        )
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise Under22SourceError(f"line {line}: {field} contains a control character")
    return value


def _season(value: str | None, line: int) -> int:
    text = _required_text(value, "season", line)
    if not re.fullmatch(r"[0-9]{4}", text):
        raise Under22SourceError(f"line {line}: invalid season {text!r}")
    season = int(text)
    if season not in EXPECTED_SEASONS:
        raise Under22SourceError(f"line {line}: season {season} is outside 2012-2026")
    return season


def _flag(value: str | None, field: str, line: int) -> bool:
    if value not in {"0", "1"}:
        raise Under22SourceError(
            f"line {line}: {field} must be exactly '0' or '1', got {value!r}"
        )
    return value == "1"


def _duplicate_name_key(name: str) -> str:
    text = unicodedata.normalize("NFKD", name)
    text = "".join(character for character in text if not unicodedata.combining(character))
    text = re.sub(r"['`.,]", "", text.casefold())
    text = re.sub(r"[-_/]", " ", text)
    return " ".join(text.split())


def load_under_22(path: str | Path = DEFAULT_CSV_PATH) -> list[Under22Selection]:
    """Load a complete canonical 2012-2026 source or fail without partial data."""

    csv_path = Path(path)
    rows: list[Under22Selection] = []
    source_keys: set[str] = set()
    season_players: set[tuple[int, str]] = set()

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, strict=True)
            actual_header = tuple(reader.fieldnames or ())
            if actual_header != EXPECTED_HEADER:
                raise Under22SourceError(
                    "invalid header: expected "
                    f"{','.join(EXPECTED_HEADER)!r}, got {','.join(actual_header)!r}"
                )

            for raw in reader:
                line = reader.line_num
                if None in raw:
                    raise Under22SourceError(f"line {line}: too many columns")

                source_key = _required_text(raw.get("source_key"), "source_key", line)
                season = _season(raw.get("season"), line)
                position = _required_text(raw.get("position"), "position", line)
                player = _required_text(raw.get("player"), "player", line)
                club = _required_text(raw.get("club"), "club", line)
                is_captain = _flag(raw.get("is_captain"), "is_captain", line)
                is_vice_captain = _flag(
                    raw.get("is_vice_captain"), "is_vice_captain", line
                )

                if position not in POSITION_SLOT_COUNTS:
                    raise Under22SourceError(f"line {line}: invalid position {position!r}")
                if is_captain and is_vice_captain:
                    raise Under22SourceError(
                        f"line {line}: one player cannot be captain and vice-captain"
                    )

                key_match = _SOURCE_KEY.fullmatch(source_key)
                if key_match is None:
                    raise Under22SourceError(
                        f"line {line}: invalid source_key {source_key!r}"
                    )
                key_season = int(key_match.group("season"))
                key_position = KEY_POSITION[key_match.group("position")]
                key_slot = int(key_match.group("slot"))
                if key_season != season or key_position != position:
                    raise Under22SourceError(
                        f"line {line}: source_key does not match season and position"
                    )
                if key_slot > POSITION_SLOT_COUNTS[position]:
                    raise Under22SourceError(
                        f"line {line}: source_key slot is invalid for position {position}"
                    )

                if source_key in source_keys:
                    raise Under22SourceError(
                        f"line {line}: duplicate source_key {source_key!r}"
                    )
                player_key = (season, _duplicate_name_key(player))
                if player_key in season_players:
                    raise Under22SourceError(
                        f"line {line}: duplicate season/player {season}/{player!r}"
                    )

                source_keys.add(source_key)
                season_players.add(player_key)
                rows.append(
                    Under22Selection(
                        source_key=source_key,
                        season=season,
                        position=position,
                        player=player,
                        club=club,
                        is_captain=is_captain,
                        is_vice_captain=is_vice_captain,
                    )
                )
    except Under22SourceError:
        raise
    except (OSError, UnicodeError, csv.Error) as exc:
        raise Under22SourceError(f"cannot read {csv_path}: {exc}") from exc

    _validate_complete(rows, source_keys)
    return rows


def _validate_complete(rows: Sequence[Under22Selection], source_keys: set[str]) -> None:
    seasons = {row.season for row in rows}
    expected_seasons = set(EXPECTED_SEASONS)
    if seasons != expected_seasons:
        missing = sorted(expected_seasons - seasons)
        unexpected = sorted(seasons - expected_seasons)
        raise Under22SourceError(
            f"season span must be exactly 2012-2026; missing={missing}, "
            f"unexpected={unexpected}"
        )

    expected_keys = {
        f"22under22:{season}:{POSITION_KEY[position]}:{slot}"
        for season in EXPECTED_SEASONS
        for position, count in POSITION_SLOT_COUNTS.items()
        for slot in range(1, count + 1)
    }
    if source_keys != expected_keys:
        missing = sorted(expected_keys - source_keys)
        unexpected = sorted(source_keys - expected_keys)
        raise Under22SourceError(
            "formation slots are incomplete or unexpected; "
            f"missing={missing[:5]}, unexpected={unexpected[:5]}"
        )

    by_season_position = Counter((row.season, row.position) for row in rows)
    captains = Counter(row.season for row in rows if row.is_captain)
    vice_captains = Counter(row.season for row in rows if row.is_vice_captain)
    for season in EXPECTED_SEASONS:
        season_count = sum(
            by_season_position[season, position] for position in POSITION_SLOT_COUNTS
        )
        if season_count != 22:
            raise Under22SourceError(
                f"season {season}: expected 22 selections, got {season_count}"
            )
        sort_orders = {row.sort_order for row in rows if row.season == season}
        if sort_orders != set(range(1, 23)):
            raise Under22SourceError(
                f"season {season}: formation order must cover every slot from 1 to 22"
            )
        for position, expected_count in POSITION_SLOT_COUNTS.items():
            actual_count = by_season_position[season, position]
            if actual_count != expected_count:
                raise Under22SourceError(
                    f"season {season} position {position}: expected "
                    f"{expected_count}, got {actual_count}"
                )
        if captains[season] != 1:
            raise Under22SourceError(
                f"season {season}: expected 1 captain, got {captains[season]}"
            )
        expected_vice_captains = 0 if season == 2012 else 1
        if vice_captains[season] != expected_vice_captains:
            raise Under22SourceError(
                f"season {season}: expected {expected_vice_captains} vice-captain(s), "
                f"got {vice_captains[season]}"
            )

    expected_total = len(EXPECTED_SEASONS) * 22
    if len(rows) != expected_total:
        raise Under22SourceError(
            f"expected {expected_total} selections, got {len(rows)}"
        )


def summary(rows: Sequence[Under22Selection], path: str | Path) -> dict[str, object]:
    per_season = Counter(row.season for row in rows)
    return {
        "ok": True,
        "path": str(Path(path).resolve()),
        "row_count": len(rows),
        "season_count": len(per_season),
        "seasons": sorted(per_season),
        "rows_per_season": {str(year): per_season[year] for year in sorted(per_season)},
        "captain_count": sum(row.is_captain for row in rows),
        "vice_captain_count": sum(row.is_vice_captain for row in rows),
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
        rows = load_under_22(args.csv)
    except Under22SourceError as exc:
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
