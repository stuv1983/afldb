#!/usr/bin/env python3
"""Parse and validate the canonical Hall of Fame source file.

The source is deliberately checked before any database importer sees a row.
Malformed or incomplete data raises ``HallOfFameSourceError``; no
best-effort coercion is performed here.

AFLDB-ISSUE-112 phase 2 (§18). The bootstrap content was extracted
read-only from ``afldb_dev.hall_of_fame`` (343 rows, all provenance
``wikipedia``); ``source_citation`` is source-granularity canonical
provenance only, per the operator policy recorded for this family — it is
not a claim that any row identifies the exact historical page or edition
it came from.

Design mirrors ``tools/migration/honour_teams.py`` (ISSUE-112 phase 1):
``hall_of_fame`` also reloads on a *natural* key ``(name, inducted_year)``
and its target table carries no ``source_record_id``. ``source_key`` here
(``hof:<seq>``) is therefore an internal manifest key — a positional
sequence frozen once in the checked-in CSV so it survives a canonical
rebuild and a deterministic reload — **not** the database reload key, and
**not** derived from ``player_id`` or any database surrogate id.
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
    Path(__file__).resolve().parents[2] / "data" / "awards" / "hall-of-fame.csv"
)
EXPECTED_HEADER = (
    "source_key",
    "name",
    "inducted_year",
    "category",
    "is_legend",
    "legend_year",
    "club",
    "state",
    "playing_career",
    "removed_year",
    "player_id",
    "link_status",
    "note",
    "source_citation",
)

# Declared coverage, measured read-only against afldb_dev
# (AFLDB-ISSUE-112 §14.4 / §18). A row count or year span outside this is a
# source contract change, not a formatting slip — bump these when a later
# induction intake is curated in.
EXPECTED_TOTAL = 343
EXPECTED_NULL_INDUCTED_YEAR = 45
MIN_INDUCTED_YEAR = 1996
MAX_INDUCTED_YEAR = 2026

# The hall_of_fame.category vocabulary as measured. 'legend' and 'removed'
# are categories in their own right, distinct from the is_legend flag and
# the removed_year column.
CATEGORIES = {
    "administrator", "coach", "legend", "media",
    "pioneer", "player", "removed", "umpire",
}

# The link_status enum (migration 005), and the subset that requires a
# player_id (the migration 019/053 invariant, enforced here rather than
# left to the database).
LINK_STATUSES = {"unique", "resolved", "ambiguous", "unmatched", "implausible"}
LINKED_STATUSES = {"unique", "resolved"}

# The operator policy for this family (AFLDB-ISSUE-112 §14.5 item 1 /
# §13): every Hall of Fame row is sourced from wikipedia, and
# source_citation records that at source granularity only. Widening this
# set is a new decision, not a parser change.
SOURCE_CITATIONS = {"wikipedia"}

_BOOLEANS = {"true": True, "false": False}
_SOURCE_KEY = re.compile(r"^hof:(?P<seq>[1-9][0-9]*)$")


class HallOfFameSourceError(ValueError):
    """Raised when the canonical source violates its data contract."""


@dataclass(frozen=True)
class HallOfFameInductee:
    source_key: str
    name: str
    inducted_year: int | None
    category: str
    is_legend: bool
    legend_year: int | None
    club: str | None
    state: str | None
    playing_career: str | None
    removed_year: int | None
    player_id: int | None
    link_status: str
    note: str | None
    source_citation: str


def _required_text(value: str | None, field: str, line: int) -> str:
    if value is None or value == "":
        raise HallOfFameSourceError(f"line {line}: {field} is required")
    if value != value.strip():
        raise HallOfFameSourceError(
            f"line {line}: {field} has leading or trailing whitespace"
        )
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise HallOfFameSourceError(f"line {line}: {field} contains a control character")
    return value


def _optional_text(value: str | None, field: str, line: int) -> str | None:
    if value is None or value == "":
        return None
    return _required_text(value, field, line)


def _optional_int(value: str | None, field: str, line: int) -> int | None:
    if value is None or value == "":
        return None
    text = _required_text(value, field, line)
    if not re.fullmatch(r"[0-9]+", text):
        raise HallOfFameSourceError(
            f"line {line}: {field} must be a positive integer, got {text!r}"
        )
    return int(text)


def _optional_year(
    value: str | None, field: str, line: int, *, low: int, high: int
) -> int | None:
    number = _optional_int(value, field, line)
    if number is not None and not (low <= number <= high):
        raise HallOfFameSourceError(
            f"line {line}: {field} {number} is outside the declared range "
            f"{low}-{high}"
        )
    return number


def _bool(value: str | None, field: str, line: int) -> bool:
    text = _required_text(value, field, line)
    if text not in _BOOLEANS:
        raise HallOfFameSourceError(
            f"line {line}: {field} must be 'true' or 'false', got {text!r}"
        )
    return _BOOLEANS[text]


def load_hall_of_fame(path: str | Path = DEFAULT_CSV_PATH) -> list[HallOfFameInductee]:
    """Load the complete canonical Hall of Fame source or fail without partial data."""

    csv_path = Path(path)
    rows: list[HallOfFameInductee] = []
    source_keys: set[str] = set()
    natural_keys: set[tuple[str, int | None]] = set()
    seq_counter = 0
    seen_null_year = False
    last_non_null_year: int | None = None
    current_group: object = object()  # sentinel: no group yet
    last_name_in_group: str | None = None

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, strict=True)
            actual_header = tuple(reader.fieldnames or ())
            if actual_header != EXPECTED_HEADER:
                raise HallOfFameSourceError(
                    "invalid header: expected "
                    f"{','.join(EXPECTED_HEADER)!r}, got {','.join(actual_header)!r}"
                )

            for raw in reader:
                line = reader.line_num
                if None in raw:
                    raise HallOfFameSourceError(f"line {line}: too many columns")

                source_key = _required_text(raw.get("source_key"), "source_key", line)
                name = _required_text(raw.get("name"), "name", line)
                inducted_year = _optional_year(
                    raw.get("inducted_year"), "inducted_year", line,
                    low=MIN_INDUCTED_YEAR, high=MAX_INDUCTED_YEAR,
                )
                category = _required_text(raw.get("category"), "category", line)
                is_legend = _bool(raw.get("is_legend"), "is_legend", line)
                legend_year = _optional_year(
                    raw.get("legend_year"), "legend_year", line,
                    low=MIN_INDUCTED_YEAR, high=MAX_INDUCTED_YEAR,
                )
                club = _optional_text(raw.get("club"), "club", line)
                state = _optional_text(raw.get("state"), "state", line)
                playing_career = _optional_text(
                    raw.get("playing_career"), "playing_career", line
                )
                removed_year = _optional_year(
                    raw.get("removed_year"), "removed_year", line,
                    low=MIN_INDUCTED_YEAR, high=MAX_INDUCTED_YEAR,
                )
                player_id = _optional_int(raw.get("player_id"), "player_id", line)
                link_status = _required_text(raw.get("link_status"), "link_status", line)
                note = _optional_text(raw.get("note"), "note", line)
                source_citation = _required_text(
                    raw.get("source_citation"), "source_citation", line
                )

                if source_citation not in SOURCE_CITATIONS:
                    raise HallOfFameSourceError(
                        f"line {line}: source_citation {source_citation!r} is not an "
                        f"authorised value for this family "
                        f"(only {sorted(SOURCE_CITATIONS)})"
                    )
                if category not in CATEGORIES:
                    raise HallOfFameSourceError(
                        f"line {line}: unknown category {category!r}"
                    )
                if link_status not in LINK_STATUSES:
                    raise HallOfFameSourceError(
                        f"line {line}: invalid link_status {link_status!r}"
                    )

                is_linked_status = link_status in LINKED_STATUSES
                if is_linked_status and player_id is None:
                    raise HallOfFameSourceError(
                        f"line {line}: link_status {link_status!r} requires player_id"
                    )
                if not is_linked_status and player_id is not None:
                    raise HallOfFameSourceError(
                        f"line {line}: link_status {link_status!r} must not carry player_id"
                    )

                if is_legend and legend_year is None:
                    raise HallOfFameSourceError(
                        f"line {line}: is_legend is true but legend_year is empty"
                    )
                if not is_legend and legend_year is not None:
                    raise HallOfFameSourceError(
                        f"line {line}: legend_year {legend_year} is set but "
                        f"is_legend is false"
                    )

                if (removed_year is not None) != (category == "removed"):
                    raise HallOfFameSourceError(
                        f"line {line}: removed_year and category='removed' must agree "
                        f"(removed_year={removed_year!r}, category={category!r})"
                    )

                key_match = _SOURCE_KEY.fullmatch(source_key)
                if key_match is None:
                    raise HallOfFameSourceError(
                        f"line {line}: invalid source_key {source_key!r} "
                        f"(expected 'hof:<n>')"
                    )

                # Checked before the seq rule: a literal repeat of an
                # already-minted key is always also seq-invalid (the counter
                # has moved on), and that would otherwise mask this as an
                # ordering error rather than the duplicate it is.
                if source_key in source_keys:
                    raise HallOfFameSourceError(
                        f"line {line}: duplicate source_key {source_key!r}"
                    )

                seq = int(key_match.group("seq"))
                seq_counter += 1
                if seq != seq_counter:
                    raise HallOfFameSourceError(
                        f"line {line}: source_key seq {seq} is out of sequence "
                        f"(expected {seq_counter})"
                    )

                # Deterministic order: inducted_year ascending with undated
                # rows last, then name ascending by Unicode code point (the
                # manifest is extracted with `name COLLATE \"C\"`).
                if inducted_year is None:
                    seen_null_year = True
                    group: object = None
                else:
                    if seen_null_year:
                        raise HallOfFameSourceError(
                            f"line {line}: a dated row follows an undated row "
                            f"(expected inducted_year ascending, undated rows last)"
                        )
                    if (
                        last_non_null_year is not None
                        and inducted_year < last_non_null_year
                    ):
                        raise HallOfFameSourceError(
                            f"line {line}: inducted_year {inducted_year} is out of "
                            f"order (expected ascending, got < {last_non_null_year})"
                        )
                    group = inducted_year

                if group != current_group:
                    current_group = group
                    last_name_in_group = None
                elif last_name_in_group is not None and name < last_name_in_group:
                    where = "undated rows" if group is None else f"inducted_year {group}"
                    raise HallOfFameSourceError(
                        f"line {line}: row is out of deterministic order within "
                        f"{where} (expected name ascending)"
                    )
                last_name_in_group = name
                if inducted_year is not None:
                    last_non_null_year = inducted_year

                natural_key = (name, inducted_year)
                if natural_key in natural_keys:
                    raise HallOfFameSourceError(
                        f"line {line}: duplicate natural identity "
                        f"(name, inducted_year) = {natural_key!r}"
                    )

                source_keys.add(source_key)
                natural_keys.add(natural_key)

                rows.append(
                    HallOfFameInductee(
                        source_key=source_key,
                        name=name,
                        inducted_year=inducted_year,
                        category=category,
                        is_legend=is_legend,
                        legend_year=legend_year,
                        club=club,
                        state=state,
                        playing_career=playing_career,
                        removed_year=removed_year,
                        player_id=player_id,
                        link_status=link_status,
                        note=note,
                        source_citation=source_citation,
                    )
                )
    except HallOfFameSourceError:
        raise
    except (OSError, UnicodeError, csv.Error) as exc:
        raise HallOfFameSourceError(f"cannot read {csv_path}: {exc}") from exc

    _validate_complete(rows)
    return rows


def _validate_complete(rows: Sequence[HallOfFameInductee]) -> None:
    if len(rows) != EXPECTED_TOTAL:
        raise HallOfFameSourceError(
            f"expected {EXPECTED_TOTAL} Hall of Fame rows, got {len(rows)}"
        )
    null_years = sum(1 for row in rows if row.inducted_year is None)
    if null_years != EXPECTED_NULL_INDUCTED_YEAR:
        raise HallOfFameSourceError(
            f"expected {EXPECTED_NULL_INDUCTED_YEAR} rows with no inducted_year, "
            f"got {null_years}"
        )
    dated = [row.inducted_year for row in rows if row.inducted_year is not None]
    if dated and (min(dated) != MIN_INDUCTED_YEAR or max(dated) != MAX_INDUCTED_YEAR):
        raise HallOfFameSourceError(
            f"inducted_year span {min(dated)}-{max(dated)} does not match the "
            f"declared {MIN_INDUCTED_YEAR}-{MAX_INDUCTED_YEAR}"
        )


def summary(rows: Sequence[HallOfFameInductee], path: str | Path) -> dict[str, object]:
    dated = [row.inducted_year for row in rows if row.inducted_year is not None]
    categories = Counter(row.category for row in rows)
    return {
        "ok": True,
        "path": str(Path(path).resolve()),
        "row_count": len(rows),
        "legend_count": sum(1 for row in rows if row.is_legend),
        "linked_count": sum(1 for row in rows if row.player_id is not None),
        "unlinked_count": sum(1 for row in rows if row.player_id is None),
        "null_inducted_year_count": sum(
            1 for row in rows if row.inducted_year is None
        ),
        "inducted_year_min": min(dated) if dated else None,
        "inducted_year_max": max(dated) if dated else None,
        "categories": {name: categories[name] for name in sorted(categories)},
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
        rows = load_hall_of_fame(args.csv)
    except HallOfFameSourceError as exc:
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
