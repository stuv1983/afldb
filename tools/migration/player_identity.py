#!/usr/bin/env python3
"""Parse and validate the awards player-identity census.

The source is deliberately checked before any database importer sees a row.
Malformed or incomplete data raises ``PlayerIdentitySourceError``; no
best-effort coercion is performed here.

AFLDB-ISSUE-112 closeout (§24.5) — the rebuild-stability fix.

Every awards/honours manifest carries a ``player_id`` taken verbatim from the
bootstrap source (the legacy-loaded ``afldb_dev``). **That integer is not a
target-database id.** ``players.id`` is re-seeded by the canonical rebuild
(AFLDB-ISSUE-108 §9.4 / AFLDB-ISSUE-111 G5), and the disagreement is total, not
partial: measured 2026-09-02 against a canonically rebuilt ``afldb_test``,
**0 of 12,392** ids present in both databases denoted the same footballer.

The loaders' original guard — keep ``player_id`` if the target database has a
row with that id — therefore did not protect anything. Every id existed, so
every link was kept, and **5,141 of 5,194** manifest links would have been
silently attached to a different player.

This file is the bridge. It maps each bootstrap ``player_id`` the manifests
reference to the identity the rebuild actually preserves: the AFL Tables
profile URL, held in ``external_identities`` with
``match_method = 'afltables_profile_url'`` — the same durable key
AFLDB-ISSUE-111 chose for the Coleman derivation, for the same reason.

``import_awards.PlayerResolver`` resolves through it and **fails closed**:

* a manifest ``player_id`` absent from this census is a hard refusal — the
  census and the manifests disagree, and guessing is exactly what must not
  happen;
* a census row with **no** URL loads the awards row **unlinked**, reported by
  count and never inferred from a name. Eighteen players remain in this state
  (33 manifest rows). They are enumerated here rather
  than hidden, and re-linking them is a curator decision, not a parser rule;
* a URL the target database does not carry loads the row unlinked too, for the
  same reason.

``display_name`` is carried for review and adjudication only. **It is never
used to match.** No fuzzy or name-based resolution exists anywhere in this
path, deliberately.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


_DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "awards"
DEFAULT_PATH = _DATA_DIR / "player-identity.csv"

HEADER = ("player_id", "display_name", "afltables_profile_url")

# The census covers exactly the distinct linked player_id values the eight
# awards/honours manifests reference, measured 2026-09-02, plus the seven
# 1983-1988 VFL Team of the Year players censused under AFLDB-ISSUE-118
# §23.14 (2026-09-05). A row count outside
# this is a manifest change that has not been re-censused — refuse rather than
# load a bridge that no longer spans the whole family.
EXPECTED_ROWS = 1745
EXPECTED_WITHOUT_IDENTITY = 18

# The normalised AFL Tables profile path, exactly as external_identities
# stores it (see AFLDB-ISSUE-111 G5). Raw, not hashed: every row key in this
# repository is readable.
_URL = re.compile(r"^players/[A-Z]/[^/]+\.html$")


class PlayerIdentitySourceError(ValueError):
    """Raised when the canonical source file violates its data contract."""


@dataclass(frozen=True)
class PlayerIdentity:
    player_id: int
    display_name: str
    afltables_profile_url: str | None


def _required_text(value: str | None, field: str, line: int) -> str:
    if value is None or value == "":
        raise PlayerIdentitySourceError(f"line {line}: {field} is required")
    if value != value.strip():
        raise PlayerIdentitySourceError(
            f"line {line}: {field} has leading or trailing whitespace"
        )
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise PlayerIdentitySourceError(
            f"line {line}: {field} contains a control character"
        )
    return value


def load_player_identities(
    path: str | Path = DEFAULT_PATH,
) -> dict[int, PlayerIdentity]:
    """Load the whole census or fail without partial data."""

    csv_path = Path(path)
    rows: dict[int, PlayerIdentity] = {}
    urls: dict[str, int] = {}
    last_player_id: int | None = None

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, strict=True)
            actual_header = tuple(reader.fieldnames or ())
            if actual_header != HEADER:
                raise PlayerIdentitySourceError(
                    "invalid header: expected "
                    f"{','.join(HEADER)!r}, got {','.join(actual_header)!r}"
                )

            for raw in reader:
                line = reader.line_num
                if None in raw:
                    raise PlayerIdentitySourceError(
                        f"line {line}: too many columns"
                    )

                text_id = _required_text(raw.get("player_id"), "player_id", line)
                if not text_id.isdigit() or text_id.lstrip("0") != text_id:
                    raise PlayerIdentitySourceError(
                        f"line {line}: player_id must be a positive integer with "
                        f"no leading zero, got {text_id!r}"
                    )
                player_id = int(text_id)
                display_name = _required_text(
                    raw.get("display_name"), "display_name", line
                )
                url_cell = raw.get("afltables_profile_url") or ""
                url = _required_text(url_cell, "afltables_profile_url", line) \
                    if url_cell else None

                if url is not None and _URL.fullmatch(url) is None:
                    raise PlayerIdentitySourceError(
                        f"line {line}: afltables_profile_url {url!r} is not a "
                        f"normalised AFL Tables profile path"
                    )

                if player_id in rows:
                    raise PlayerIdentitySourceError(
                        f"line {line}: duplicate player_id {player_id}"
                    )
                if last_player_id is not None and player_id <= last_player_id:
                    raise PlayerIdentitySourceError(
                        f"line {line}: player_id {player_id} is out of "
                        f"deterministic order (expected strictly ascending, "
                        f"previous was {last_player_id})"
                    )
                last_player_id = player_id

                # Two bootstrap ids claiming one profile URL would silently
                # merge two awards populations onto one footballer.
                if url is not None:
                    if url in urls:
                        raise PlayerIdentitySourceError(
                            f"line {line}: afltables_profile_url {url!r} is "
                            f"already claimed by player_id {urls[url]}"
                        )
                    urls[url] = player_id

                rows[player_id] = PlayerIdentity(
                    player_id=player_id,
                    display_name=display_name,
                    afltables_profile_url=url,
                )
    except PlayerIdentitySourceError:
        raise
    except (OSError, UnicodeError, csv.Error) as exc:
        raise PlayerIdentitySourceError(f"cannot read {csv_path}: {exc}") from exc

    if len(rows) != EXPECTED_ROWS:
        raise PlayerIdentitySourceError(
            f"expected {EXPECTED_ROWS} censused players, got {len(rows)}"
        )
    without = sum(1 for row in rows.values() if row.afltables_profile_url is None)
    if without != EXPECTED_WITHOUT_IDENTITY:
        raise PlayerIdentitySourceError(
            f"expected {EXPECTED_WITHOUT_IDENTITY} censused players with no "
            f"rebuild-stable identity, got {without}"
        )
    return rows


def summary(
    rows: dict[int, PlayerIdentity], path: str | Path
) -> dict[str, object]:
    without = [row for row in rows.values() if row.afltables_profile_url is None]
    return {
        "ok": True,
        "path": str(Path(path).resolve()),
        "player_count": len(rows),
        "with_identity": len(rows) - len(without),
        "without_identity": len(without),
        "without_identity_players": [
            {"player_id": row.player_id, "display_name": row.display_name}
            for row in sorted(without, key=lambda row: row.player_id)
        ],
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--csv",
        type=Path,
        default=DEFAULT_PATH,
        help=f"canonical census path (default: {DEFAULT_PATH})",
    )
    args = parser.parse_args(argv)
    try:
        rows = load_player_identities(args.csv)
    except PlayerIdentitySourceError as exc:
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
