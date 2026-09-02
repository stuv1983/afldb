#!/usr/bin/env python3
"""Parse and validate the canonical honour-teams source file.

The source is deliberately checked before any database importer sees a row.
Malformed or incomplete data raises ``HonourTeamsSourceError``; no
best-effort coercion is performed here.

AFLDB-ISSUE-112 §15.4. The bootstrap content was extracted read-only from
``afldb_dev.honour_team_members`` (113 rows, all provenance ``wikipedia``);
``source_citation`` is source-granularity provenance only, per the operator
decision recorded for this slice — it is not a claim that any row identifies
the exact historical page or edition it came from.
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
    Path(__file__).resolve().parents[2] / "data" / "awards" / "honour-teams.csv"
)
EXPECTED_HEADER = (
    "source_key",
    "team_name",
    "player",
    "position",
    "role",
    "club",
    "sort_order",
    "player_id",
    "link_status",
    "note",
    "source_citation",
)

# team_name -> expected row count, measured read-only against afldb_dev
# (AFLDB-ISSUE-112 §14.4/§15.5). A team appearing, missing or resized here
# is a source contract change, not a formatting slip.
TEAM_SIZES = {
    "AFL/VFL Team of the Century": 22,
    "Greek Team of the Century": 20,
    "Indigenous Team of the Century": 24,
    "Italian Team of the Century": 23,
    "Queensland Team of the 20th Century": 24,
}
EXPECTED_TOTAL = 113

POSITIONS = {
    "Back", "Half back", "Centre", "Half forward", "Forward",
    "Follower", "Interchange", "Coach",
}
ROLES = {"Captain", "Vice-captain"}

# The link_status enum (migration 005), and the subset that requires a
# player_id (migration 019/053's invariant, enforced here rather than left
# to the database).
LINK_STATUSES = {"unique", "resolved", "ambiguous", "unmatched", "implausible"}
LINKED_STATUSES = {"unique", "resolved"}

# The operator decision for this slice (AFLDB-ISSUE-112 §14.5 item 1): every
# honour-teams row is sourced from wikipedia, and source_citation records
# that at source granularity only. Widening this set is a new decision, not
# a parser change.
SOURCE_CITATIONS = {"wikipedia"}

_SOURCE_KEY = re.compile(r"^honourteam:(?P<slug>[a-z0-9-]+):(?P<seq>[1-9][0-9]*)$")


def slugify(value: str) -> str:
    """Byte-identical to import_awards.py's slugify — the mint depends on it."""
    text = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return text or "team"


class HonourTeamsSourceError(ValueError):
    """Raised when the canonical source violates its data contract."""


@dataclass(frozen=True)
class HonourTeamMember:
    source_key: str
    team_name: str
    player: str
    position: str | None
    role: str | None
    club: str | None
    sort_order: int
    player_id: int | None
    link_status: str
    note: str | None
    source_citation: str


def _required_text(value: str | None, field: str, line: int) -> str:
    if value is None or value == "":
        raise HonourTeamsSourceError(f"line {line}: {field} is required")
    if value != value.strip():
        raise HonourTeamsSourceError(
            f"line {line}: {field} has leading or trailing whitespace"
        )
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise HonourTeamsSourceError(f"line {line}: {field} contains a control character")
    return value


def _optional_text(value: str | None, field: str, line: int) -> str | None:
    if value is None or value == "":
        return None
    return _required_text(value, field, line)


def _int(value: str | None, field: str, line: int, *, minimum: int | None = None) -> int:
    text = _required_text(value, field, line)
    if not re.fullmatch(r"-?[0-9]+", text):
        raise HonourTeamsSourceError(f"line {line}: {field} must be an integer, got {text!r}")
    number = int(text)
    if minimum is not None and number < minimum:
        raise HonourTeamsSourceError(
            f"line {line}: {field} must be >= {minimum}, got {number}"
        )
    return number


def _optional_int(value: str | None, field: str, line: int) -> int | None:
    if value is None or value == "":
        return None
    text = _required_text(value, field, line)
    if not re.fullmatch(r"[0-9]+", text):
        raise HonourTeamsSourceError(
            f"line {line}: {field} must be a positive integer, got {text!r}"
        )
    return int(text)


def load_honour_teams(path: str | Path = DEFAULT_CSV_PATH) -> list[HonourTeamMember]:
    """Load the complete canonical honour-teams source or fail without partial data."""

    csv_path = Path(path)
    rows: list[HonourTeamMember] = []
    source_keys: set[str] = set()
    natural_keys: set[tuple[str, str]] = set()
    linked_keys: set[tuple[str, int]] = set()
    team_seq: dict[str, int] = {}
    team_order_seen: list[str] = []
    last_team: str | None = None
    last_sort_order: int | None = None
    last_player: str | None = None

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, strict=True)
            actual_header = tuple(reader.fieldnames or ())
            if actual_header != EXPECTED_HEADER:
                raise HonourTeamsSourceError(
                    "invalid header: expected "
                    f"{','.join(EXPECTED_HEADER)!r}, got {','.join(actual_header)!r}"
                )

            for raw in reader:
                line = reader.line_num
                if None in raw:
                    raise HonourTeamsSourceError(f"line {line}: too many columns")

                source_key = _required_text(raw.get("source_key"), "source_key", line)
                team_name = _required_text(raw.get("team_name"), "team_name", line)
                player = _required_text(raw.get("player"), "player", line)
                position = _optional_text(raw.get("position"), "position", line)
                role = _optional_text(raw.get("role"), "role", line)
                club = _optional_text(raw.get("club"), "club", line)
                sort_order = _int(raw.get("sort_order"), "sort_order", line, minimum=0)
                player_id = _optional_int(raw.get("player_id"), "player_id", line)
                link_status = _required_text(raw.get("link_status"), "link_status", line)
                note = _optional_text(raw.get("note"), "note", line)
                source_citation = _required_text(
                    raw.get("source_citation"), "source_citation", line
                )

                if team_name not in TEAM_SIZES:
                    raise HonourTeamsSourceError(
                        f"line {line}: unknown team_name {team_name!r}"
                    )
                if position is not None and position not in POSITIONS:
                    raise HonourTeamsSourceError(
                        f"line {line}: invalid position {position!r}"
                    )
                if role is not None and role not in ROLES:
                    raise HonourTeamsSourceError(f"line {line}: invalid role {role!r}")
                if link_status not in LINK_STATUSES:
                    raise HonourTeamsSourceError(
                        f"line {line}: invalid link_status {link_status!r}"
                    )
                if source_citation not in SOURCE_CITATIONS:
                    raise HonourTeamsSourceError(
                        f"line {line}: source_citation {source_citation!r} is not an "
                        f"authorised value for this slice "
                        f"(only {sorted(SOURCE_CITATIONS)})"
                    )

                is_linked_status = link_status in LINKED_STATUSES
                if is_linked_status and player_id is None:
                    raise HonourTeamsSourceError(
                        f"line {line}: link_status {link_status!r} requires player_id"
                    )
                if not is_linked_status and player_id is not None:
                    raise HonourTeamsSourceError(
                        f"line {line}: link_status {link_status!r} must not carry player_id"
                    )

                key_match = _SOURCE_KEY.fullmatch(source_key)
                if key_match is None:
                    raise HonourTeamsSourceError(
                        f"line {line}: invalid source_key {source_key!r}"
                    )
                expected_slug = slugify(team_name)
                if key_match.group("slug") != expected_slug:
                    raise HonourTeamsSourceError(
                        f"line {line}: source_key slug {key_match.group('slug')!r} does "
                        f"not match team_name {team_name!r} (expected {expected_slug!r})"
                    )

                # Checked before the seq-sequencing rule below: a literal
                # repeat of an already-minted key is always also
                # seq-invalid (the counter has moved on), and that would
                # otherwise mask this as a sequencing error instead of the
                # duplicate it actually is.
                if source_key in source_keys:
                    raise HonourTeamsSourceError(
                        f"line {line}: duplicate source_key {source_key!r}"
                    )

                seq = int(key_match.group("seq"))
                expected_seq = team_seq.get(team_name, 0) + 1
                if seq != expected_seq:
                    raise HonourTeamsSourceError(
                        f"line {line}: source_key seq {seq} is out of sequence for "
                        f"{team_name!r} (expected {expected_seq})"
                    )
                team_seq[team_name] = seq

                if team_name != last_team:
                    if team_name in team_order_seen:
                        raise HonourTeamsSourceError(
                            f"line {line}: team {team_name!r} rows are not contiguous "
                            "in the file"
                        )
                    if last_team is not None and team_name < last_team:
                        raise HonourTeamsSourceError(
                            f"line {line}: team {team_name!r} is out of deterministic "
                            "order (expected team_name ascending)"
                        )
                    team_order_seen.append(team_name)
                    last_sort_order = None
                    last_player = None
                elif (
                    last_sort_order is not None
                    and (
                        sort_order < last_sort_order
                        or (
                            sort_order == last_sort_order
                            and last_player is not None
                            and player < last_player
                        )
                    )
                ):
                    raise HonourTeamsSourceError(
                        f"line {line}: row is out of deterministic order within "
                        f"{team_name!r} (expected sort_order, player ascending)"
                    )
                last_team = team_name
                last_sort_order = sort_order
                last_player = player

                natural_key = (team_name, player)
                if natural_key in natural_keys:
                    raise HonourTeamsSourceError(
                        f"line {line}: duplicate natural identity "
                        f"(team_name, player) = {natural_key!r}"
                    )
                if player_id is not None:
                    linked_key = (team_name, player_id)
                    if linked_key in linked_keys:
                        raise HonourTeamsSourceError(
                            f"line {line}: duplicate linked identity "
                            f"(team_name, player_id) = {linked_key!r}"
                        )
                    linked_keys.add(linked_key)

                source_keys.add(source_key)
                natural_keys.add(natural_key)

                rows.append(
                    HonourTeamMember(
                        source_key=source_key,
                        team_name=team_name,
                        player=player,
                        position=position,
                        role=role,
                        club=club,
                        sort_order=sort_order,
                        player_id=player_id,
                        link_status=link_status,
                        note=note,
                        source_citation=source_citation,
                    )
                )
    except HonourTeamsSourceError:
        raise
    except (OSError, UnicodeError, csv.Error) as exc:
        raise HonourTeamsSourceError(f"cannot read {csv_path}: {exc}") from exc

    _validate_complete(rows)
    return rows


def _validate_complete(rows: Sequence[HonourTeamMember]) -> None:
    if len(rows) != EXPECTED_TOTAL:
        raise HonourTeamsSourceError(
            f"expected {EXPECTED_TOTAL} honour-team rows, got {len(rows)}"
        )
    counts = dict(Counter(row.team_name for row in rows))
    if counts != TEAM_SIZES:
        raise HonourTeamsSourceError(
            f"per-team row counts do not match the declared contract: "
            f"expected {TEAM_SIZES}, got {counts}"
        )


def summary(rows: Sequence[HonourTeamMember], path: str | Path) -> dict[str, object]:
    per_team = Counter(row.team_name for row in rows)
    return {
        "ok": True,
        "path": str(Path(path).resolve()),
        "row_count": len(rows),
        "team_count": len(per_team),
        "rows_per_team": {team: per_team[team] for team in sorted(per_team)},
        "linked_count": sum(1 for row in rows if row.player_id is not None),
        "unlinked_count": sum(1 for row in rows if row.player_id is None),
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
        rows = load_honour_teams(args.csv)
    except HonourTeamsSourceError as exc:
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
