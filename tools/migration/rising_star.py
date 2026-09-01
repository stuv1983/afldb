#!/usr/bin/env python3
"""Parse and validate the canonical Rising Star nominations source file.

The source is deliberately checked before any database importer sees a row.
Malformed or incomplete data raises ``RisingStarSourceError``; no
best-effort coercion is performed here.

AFLDB-ISSUE-112 phase 4 (§20). The bootstrap content was extracted
read-only from ``afldb_dev.award_nominations`` (the ``rising-star`` award,
766 rows, all provenance ``footywire``); ``source_citation`` is
source-granularity canonical provenance only, per the operator policy
recorded for this family — it is not a claim that any row identifies the
exact FootyWire page or edition it came from.

Like ``captaincies`` — and unlike the honour-teams and Hall of Fame
slices — ``award_nominations`` already carries a stable
``source_record_id`` on every row and reloads on
``(source_id, source_record_id)``, not a natural key. ``source_key`` in
this manifest is therefore the *preserved* database ``source_record_id``
(a 24-hex-character digest minted by the original FootyWire scrape),
carried verbatim: it is **not** re-minted here and the loader keys the
reload on it unchanged.

``club`` / ``opponent`` are the canonical ``clubs.name`` for each row's
era identity. They are re-resolved through ``import_awards.ClubResolver``
at load time — exactly the path the legacy loader used for its raw club
strings — so the manifest carries a rebuild-stable club identity rather
than a frozen ``club_id``. Every non-null row was verified to round-trip
(re-resolving the canonical name season-aware reproduces the stored id).
One row has no ``club`` and three have no ``opponent`` in the source;
those cells are left empty and load back as NULL.

``stat_line`` is the exact FootyWire statistic object as stored in the
``jsonb`` column: an object whose keys are a subset of ``STAT_KEYS`` and
whose values are integers. Three rows carry no statistics; those cells
are empty and load back as NULL. Malformed JSON, a non-object, an unknown
key or a non-integer value is rejected — never coerced, never inferred.
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
    Path(__file__).resolve().parents[2] / "data" / "awards" / "rising-star.csv"
)
EXPECTED_HEADER = (
    "source_key",
    "season",
    "round_number",
    "club",
    "opponent",
    "player",
    "player_id",
    "link_status",
    "is_winner",
    "is_ineligible",
    "ineligible_reason",
    "votes",
    "stat_line",
    "source_citation",
)

# Declared coverage, measured read-only against afldb_dev
# (AFLDB-ISSUE-112 §14.4 / §20). A row count, season span or per-family
# distribution outside this is a source contract change, not a formatting
# slip — bump these when a later season's nominations are curated in.
EXPECTED_TOTAL = 766
MIN_SEASON = 1993
MAX_SEASON = 2026
EXPECTED_DISTINCT_SEASONS = 34
# The last decided season carries a winner; MAX_SEASON does not yet.
LAST_DECIDED_SEASON = 2025
EXPECTED_WINNERS = LAST_DECIDED_SEASON - MIN_SEASON + 1  # 33, one per decided season
EXPECTED_STAT_LINE_PRESENT = 763
EXPECTED_INELIGIBLE = 9

# Round grain as measured: every nomination carries a round number, 0-24.
MIN_ROUND = 0
MAX_ROUND = 24

# The canonical clubs represented in the nominations data (club + opponent),
# measured against afldb_dev. Every value is an exact ``clubs.name`` that
# import_awards.ClubResolver resolves deterministically; the era-identity
# pairs (Footscray/Western Bulldogs, South Melbourne→Sydney,
# Fitzroy/Brisbane Bears/Brisbane Lions, North Melbourne/Kangaroos) are all
# present and the loader's season-aware resolver picks the right one.
# Adding a club here is a deliberate change, not a parser fix.
KNOWN_CLUBS = {
    "Adelaide", "Brisbane Bears", "Brisbane Lions", "Carlton", "Collingwood",
    "Essendon", "Fitzroy", "Footscray", "Fremantle", "Geelong", "Gold Coast",
    "Greater Western Sydney", "Hawthorn", "Kangaroos", "Melbourne",
    "North Melbourne", "Port Adelaide", "Richmond", "St Kilda", "Sydney",
    "West Coast", "Western Bulldogs",
}

# The link_status enum (migration 005), and the subset that requires a
# player_id (the migration 019/053 invariant, enforced here rather than
# left to the database). Every nomination row is linked today; a future
# unlinked intake needs LINKED completeness relaxed deliberately.
LINK_STATUSES = {"unique", "resolved", "ambiguous", "unmatched", "implausible"}
LINKED_STATUSES = {"unique", "resolved"}

# The operator policy for this family (AFLDB-ISSUE-112 §14.5 item 1 / §13):
# every nomination row is sourced from FootyWire, and source_citation
# records that at source granularity only. Widening this set is a new
# decision, not a parser change.
SOURCE_CITATIONS = {"footywire"}

# The statistic keys FootyWire supplies. A stat_line may carry any subset
# of these (older seasons collected fewer); it may not carry anything
# else. This is the exact key set measured across all 763 non-empty
# stat_line objects in afldb_dev.
STAT_KEYS = {
    "kicks", "handballs", "disposals", "marks", "goals", "behinds",
    "tackles", "hitouts", "frees_for", "frees_against", "supercoach",
    "afl_fantasy",
}

_SOURCE_KEY = re.compile(r"^[0-9a-f]{24}$")
_BOOLEANS = {"true": True, "false": False}


class RisingStarSourceError(ValueError):
    """Raised when the canonical source violates its data contract."""


@dataclass(frozen=True)
class RisingStarNomination:
    source_key: str
    season: int
    round_number: int
    club: str | None
    opponent: str | None
    player: str
    player_id: int | None
    link_status: str
    is_winner: bool
    is_ineligible: bool
    ineligible_reason: str | None
    votes: int | None
    stat_line: dict[str, int] | None
    source_citation: str


def _required_text(value: str | None, field: str, line: int) -> str:
    if value is None or value == "":
        raise RisingStarSourceError(f"line {line}: {field} is required")
    if value != value.strip():
        raise RisingStarSourceError(
            f"line {line}: {field} has leading or trailing whitespace"
        )
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise RisingStarSourceError(
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
        raise RisingStarSourceError(
            f"line {line}: {field} must be an integer, got {text!r}"
        )
    return int(text)


def _optional_positive_int(value: str | None, field: str, line: int) -> int | None:
    if value is None or value == "":
        return None
    text = _required_text(value, field, line)
    if not re.fullmatch(r"[0-9]+", text):
        raise RisingStarSourceError(
            f"line {line}: {field} must be a positive integer, got {text!r}"
        )
    return int(text)


def _bool(value: str | None, field: str, line: int) -> bool:
    text = _required_text(value, field, line)
    if text not in _BOOLEANS:
        raise RisingStarSourceError(
            f"line {line}: {field} must be 'true' or 'false', got {text!r}"
        )
    return _BOOLEANS[text]


def _stat_line(value: str | None, line: int) -> dict[str, int] | None:
    if value is None or value == "":
        return None
    try:
        parsed = json.loads(value)
    except ValueError as exc:
        raise RisingStarSourceError(
            f"line {line}: stat_line is not valid JSON ({exc})"
        ) from exc
    if not isinstance(parsed, dict):
        raise RisingStarSourceError(
            f"line {line}: stat_line must be a JSON object, got "
            f"{type(parsed).__name__}"
        )
    unknown = set(parsed) - STAT_KEYS
    if unknown:
        raise RisingStarSourceError(
            f"line {line}: stat_line has unknown key(s) {sorted(unknown)} "
            f"(allowed: {sorted(STAT_KEYS)})"
        )
    for key, item in parsed.items():
        # bool is a subclass of int — reject it explicitly.
        if isinstance(item, bool) or not isinstance(item, int):
            raise RisingStarSourceError(
                f"line {line}: stat_line[{key!r}] must be an integer, got "
                f"{item!r}"
            )
    return parsed


def load_rising_star(
    path: str | Path = DEFAULT_CSV_PATH,
) -> list[RisingStarNomination]:
    """Load the complete canonical Rising Star source or fail without partial data."""

    csv_path = Path(path)
    rows: list[RisingStarNomination] = []
    source_keys: set[str] = set()
    natural_keys: set[tuple[int, str]] = set()
    last_source_key: str | None = None

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, strict=True)
            actual_header = tuple(reader.fieldnames or ())
            if actual_header != EXPECTED_HEADER:
                raise RisingStarSourceError(
                    "invalid header: expected "
                    f"{','.join(EXPECTED_HEADER)!r}, got {','.join(actual_header)!r}"
                )

            for raw in reader:
                line = reader.line_num
                if None in raw:
                    raise RisingStarSourceError(f"line {line}: too many columns")

                source_key = _required_text(raw.get("source_key"), "source_key", line)
                season = _int(raw.get("season"), "season", line)
                round_number = _int(raw.get("round_number"), "round_number", line)
                club = _optional_text(raw.get("club"), "club", line)
                opponent = _optional_text(raw.get("opponent"), "opponent", line)
                player = _required_text(raw.get("player"), "player", line)
                player_id = _optional_positive_int(
                    raw.get("player_id"), "player_id", line
                )
                link_status = _required_text(
                    raw.get("link_status"), "link_status", line
                )
                is_winner = _bool(raw.get("is_winner"), "is_winner", line)
                is_ineligible = _bool(raw.get("is_ineligible"), "is_ineligible", line)
                ineligible_reason = _optional_text(
                    raw.get("ineligible_reason"), "ineligible_reason", line
                )
                votes = _optional_positive_int(raw.get("votes"), "votes", line)
                stat_line = _stat_line(raw.get("stat_line"), line)
                source_citation = _required_text(
                    raw.get("source_citation"), "source_citation", line
                )

                if _SOURCE_KEY.fullmatch(source_key) is None:
                    raise RisingStarSourceError(
                        f"line {line}: invalid source_key {source_key!r} "
                        f"(expected 24 hex characters — the preserved "
                        f"source_record_id)"
                    )
                if not (MIN_SEASON <= season <= MAX_SEASON):
                    raise RisingStarSourceError(
                        f"line {line}: season {season} is outside the declared "
                        f"range {MIN_SEASON}-{MAX_SEASON}"
                    )
                if not (MIN_ROUND <= round_number <= MAX_ROUND):
                    raise RisingStarSourceError(
                        f"line {line}: round_number {round_number} is outside the "
                        f"declared range {MIN_ROUND}-{MAX_ROUND}"
                    )
                if club is not None and club not in KNOWN_CLUBS:
                    raise RisingStarSourceError(
                        f"line {line}: unknown club {club!r} "
                        f"(not a canonical AFLDB club name)"
                    )
                if opponent is not None and opponent not in KNOWN_CLUBS:
                    raise RisingStarSourceError(
                        f"line {line}: unknown opponent {opponent!r} "
                        f"(not a canonical AFLDB club name)"
                    )
                if link_status not in LINK_STATUSES:
                    raise RisingStarSourceError(
                        f"line {line}: invalid link_status {link_status!r}"
                    )
                if source_citation not in SOURCE_CITATIONS:
                    raise RisingStarSourceError(
                        f"line {line}: source_citation {source_citation!r} is not an "
                        f"authorised value for this family "
                        f"(only {sorted(SOURCE_CITATIONS)})"
                    )

                is_linked_status = link_status in LINKED_STATUSES
                if is_linked_status and player_id is None:
                    raise RisingStarSourceError(
                        f"line {line}: link_status {link_status!r} requires player_id"
                    )
                if not is_linked_status and player_id is not None:
                    raise RisingStarSourceError(
                        f"line {line}: link_status {link_status!r} must not carry "
                        f"player_id"
                    )

                # ineligible_reason is present exactly when the row is
                # flagged ineligible — both directions, so a stray reason or
                # a missing one is caught rather than silently normalised.
                if is_ineligible and ineligible_reason is None:
                    raise RisingStarSourceError(
                        f"line {line}: is_ineligible is true but "
                        f"ineligible_reason is empty"
                    )
                if not is_ineligible and ineligible_reason is not None:
                    raise RisingStarSourceError(
                        f"line {line}: ineligible_reason is set but is_ineligible "
                        f"is false"
                    )

                # votes is NULL for every nomination in this family; a value
                # is a source contract change, not something to load through.
                if votes is not None:
                    raise RisingStarSourceError(
                        f"line {line}: votes is not expected for Rising Star "
                        f"nominations (got {votes})"
                    )

                # A winner is never also ineligible: the two flags cannot
                # both be true on one row.
                if is_winner and is_ineligible:
                    raise RisingStarSourceError(
                        f"line {line}: a row cannot be both is_winner and "
                        f"is_ineligible"
                    )

                # Checked before the ordering rule below: a literal repeat of
                # an earlier key is always also an ordering violation (the
                # file is strictly ascending), and that would otherwise mask
                # this as an ordering error rather than the duplicate it is.
                if source_key in source_keys:
                    raise RisingStarSourceError(
                        f"line {line}: duplicate source_key {source_key!r}"
                    )
                if last_source_key is not None and source_key <= last_source_key:
                    raise RisingStarSourceError(
                        f"line {line}: source_key {source_key!r} is out of "
                        f"deterministic order (expected strictly ascending, "
                        f"previous was {last_source_key!r})"
                    )
                last_source_key = source_key

                natural_key = (season, player)
                if natural_key in natural_keys:
                    raise RisingStarSourceError(
                        f"line {line}: duplicate natural identity "
                        f"(season, player) = {natural_key!r}"
                    )

                source_keys.add(source_key)
                natural_keys.add(natural_key)

                rows.append(
                    RisingStarNomination(
                        source_key=source_key,
                        season=season,
                        round_number=round_number,
                        club=club,
                        opponent=opponent,
                        player=player,
                        player_id=player_id,
                        link_status=link_status,
                        is_winner=is_winner,
                        is_ineligible=is_ineligible,
                        ineligible_reason=ineligible_reason,
                        votes=votes,
                        stat_line=stat_line,
                        source_citation=source_citation,
                    )
                )
    except RisingStarSourceError:
        raise
    except (OSError, UnicodeError, csv.Error) as exc:
        raise RisingStarSourceError(f"cannot read {csv_path}: {exc}") from exc

    _validate_complete(rows)
    return rows


def _validate_complete(rows: Sequence[RisingStarNomination]) -> None:
    if len(rows) != EXPECTED_TOTAL:
        raise RisingStarSourceError(
            f"expected {EXPECTED_TOTAL} Rising Star rows, got {len(rows)}"
        )
    seasons = {row.season for row in rows}
    if min(seasons) != MIN_SEASON or max(seasons) != MAX_SEASON:
        raise RisingStarSourceError(
            f"season span {min(seasons)}-{max(seasons)} does not match the "
            f"declared {MIN_SEASON}-{MAX_SEASON}"
        )
    if len(seasons) != EXPECTED_DISTINCT_SEASONS:
        raise RisingStarSourceError(
            f"expected {EXPECTED_DISTINCT_SEASONS} distinct seasons, "
            f"got {len(seasons)}"
        )

    unlinked = [row.source_key for row in rows if row.player_id is None]
    if unlinked:
        raise RisingStarSourceError(
            f"every Rising Star row is expected to be linked; "
            f"{len(unlinked)} are not (e.g. {unlinked[0]!r})"
        )

    winners_by_season = Counter(row.season for row in rows if row.is_winner)
    total_winners = sum(winners_by_season.values())
    if total_winners != EXPECTED_WINNERS:
        raise RisingStarSourceError(
            f"expected {EXPECTED_WINNERS} season winners, got {total_winners}"
        )
    decided = set(range(MIN_SEASON, LAST_DECIDED_SEASON + 1))
    missing = sorted(season for season in decided if winners_by_season.get(season) != 1)
    if missing:
        raise RisingStarSourceError(
            f"every decided season {MIN_SEASON}-{LAST_DECIDED_SEASON} must have "
            f"exactly one winner; offending season(s): {missing}"
        )
    undecided = sorted(
        season for season in seasons
        if season > LAST_DECIDED_SEASON and winners_by_season.get(season)
    )
    if undecided:
        raise RisingStarSourceError(
            f"season(s) {undecided} are past the last decided season "
            f"{LAST_DECIDED_SEASON} but already carry a winner"
        )

    ineligible = sum(1 for row in rows if row.is_ineligible)
    if ineligible != EXPECTED_INELIGIBLE:
        raise RisingStarSourceError(
            f"expected {EXPECTED_INELIGIBLE} ineligible rows, got {ineligible}"
        )

    stat_present = sum(1 for row in rows if row.stat_line is not None)
    if stat_present != EXPECTED_STAT_LINE_PRESENT:
        raise RisingStarSourceError(
            f"expected {EXPECTED_STAT_LINE_PRESENT} rows with a stat_line, "
            f"got {stat_present}"
        )

    citations = {row.source_citation for row in rows}
    if citations != SOURCE_CITATIONS:
        raise RisingStarSourceError(
            f"source_citation vocabulary {sorted(citations)} does not match the "
            f"declared {sorted(SOURCE_CITATIONS)}"
        )


def summary(
    rows: Sequence[RisingStarNomination], path: str | Path
) -> dict[str, object]:
    seasons = [row.season for row in rows]
    statuses = Counter(row.link_status for row in rows)
    return {
        "ok": True,
        "path": str(Path(path).resolve()),
        "row_count": len(rows),
        "linked_count": sum(1 for row in rows if row.player_id is not None),
        "unlinked_count": sum(1 for row in rows if row.player_id is None),
        "season_min": min(seasons),
        "season_max": max(seasons),
        "distinct_seasons": len(set(seasons)),
        "winners": sum(1 for row in rows if row.is_winner),
        "ineligible": sum(1 for row in rows if row.is_ineligible),
        "stat_line_present": sum(1 for row in rows if row.stat_line is not None),
        "null_club": sum(1 for row in rows if row.club is None),
        "null_opponent": sum(1 for row in rows if row.opponent is None),
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
        rows = load_rising_star(args.csv)
    except RisingStarSourceError as exc:
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
