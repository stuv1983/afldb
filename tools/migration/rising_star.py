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

AFLDB-ISSUE-112 closeout (§24) adds the family's SECOND tracked file,
``data/awards/rising-star-winners.csv``: the 33 ``award_winners`` rows for
the ``rising-star`` award, one per decided season 1993-2025. These are a
different record from the ``is_winner`` nomination above — a different
table, a different reload key and a different provenance (``draftguru``,
the legacy award scrape, not FootyWire) — and they were the last winner
rows the legacy ``awards`` group still owned. Tracking them here is what
makes its ``build_winners()`` reload a genuine no-op and lets the whole
awards family rebuild with ``AFLDB_LEGACY_SQLITE`` unset. ``validate_family``
cross-checks the two files: the same 33 seasons, and the same decided
``player_id`` per season. The two sources' *name spellings* legitimately
differ on five seasons, so the cross-check is on player identity, not text.
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


# ---------------------------------------------------------------------------
# The award_winners half of the family (AFLDB-ISSUE-112 §24)
# ---------------------------------------------------------------------------
DEFAULT_WINNERS_CSV_PATH = (
    Path(__file__).resolve().parents[2] / "data" / "awards"
    / "rising-star-winners.csv"
)
WINNERS_HEADER = (
    "source_key",
    "season",
    "club",
    "player",
    "player_id",
    "link_status",
    "candidate_count",
    "votes",
    "source_citation",
)

# Declared coverage, measured read-only against afldb_dev: one winner row
# per decided season, every one linked and clubbed.
EXPECTED_WINNER_ROWS = LAST_DECIDED_SEASON - MIN_SEASON + 1        # 33
WINNERS_MIN_SEASON = MIN_SEASON                                    # 1993
WINNERS_MAX_SEASON = LAST_DECIDED_SEASON                           # 2025

# The winning vote tally is recorded from 1997 on; the first four seasons
# carry none. Enforced in both directions so a stray value or a missing one
# is caught rather than loaded through.
VOTES_FIRST_SEASON = 1997
EXPECTED_WINNER_VOTES_PRESENT = WINNERS_MAX_SEASON - VOTES_FIRST_SEASON + 1  # 29

# The winners' club strings are the DraftGuru scrape's own spellings
# (award_winners.club_name_raw), NOT the canonical clubs.name the
# nominations file carries — "Brisbane" here covers both the Bears (1993,
# 1994) and the Lions (2009, 2014), and the loader's season-aware
# ClubResolver picks the right era identity. Measured collision-free
# round-trip on all 33 rows.
WINNER_CLUBS = {
    "Adelaide", "Brisbane", "Carlton", "Collingwood", "Essendon", "Fremantle",
    "Geelong", "Gold Coast", "Hawthorn", "Melbourne", "North Melbourne",
    "Port Adelaide", "Richmond", "St Kilda", "Sydney", "West Coast",
}

# Winner-row provenance. Deliberately different from the nominations'
# footywire: these rows came from the DraftGuru award scrape and their
# source_id is what scopes the reload, so getting this wrong would move the
# ownership boundary (AFLDB-ISSUE-080).
WINNER_SOURCE_CITATIONS = {"draftguru"}

_MAX_CANDIDATE_COUNT = 9
_WINNER_SOURCE_KEY = re.compile(r"^rising-star:([0-9]{4}):([0-9]+)$")
_VOTES = re.compile(r"^[0-9]{1,3}\.[0-9]{2}$")


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


@dataclass(frozen=True)
class RisingStarWinner:
    source_key: str
    season: int
    club: str
    player: str
    player_id: int | None
    link_status: str
    candidate_count: int
    votes: str | None
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


def load_rising_star_winners(
    path: str | Path = DEFAULT_WINNERS_CSV_PATH,
) -> list[RisingStarWinner]:
    """Load the complete canonical winners file or fail without partial data."""

    csv_path = Path(path)
    rows: list[RisingStarWinner] = []
    source_keys: set[str] = set()
    natural_keys: set[tuple[int, str]] = set()
    last_source_key: str | None = None

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, strict=True)
            actual_header = tuple(reader.fieldnames or ())
            if actual_header != WINNERS_HEADER:
                raise RisingStarSourceError(
                    "invalid winners header: expected "
                    f"{','.join(WINNERS_HEADER)!r}, got "
                    f"{','.join(actual_header)!r}"
                )

            for raw in reader:
                line = reader.line_num
                if None in raw:
                    raise RisingStarSourceError(f"line {line}: too many columns")

                source_key = _required_text(raw.get("source_key"), "source_key", line)
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
                votes = _optional_text(raw.get("votes"), "votes", line)
                source_citation = _required_text(
                    raw.get("source_citation"), "source_citation", line
                )

                match = _WINNER_SOURCE_KEY.fullmatch(source_key)
                if match is None:
                    raise RisingStarSourceError(
                        f"line {line}: invalid source_key {source_key!r} "
                        f"(expected rising-star:<season>:<row_no>)"
                    )
                if int(match.group(1)) != season:
                    raise RisingStarSourceError(
                        f"line {line}: source_key {source_key!r} embeds season "
                        f"{match.group(1)} but the row's season is {season}"
                    )
                if not (WINNERS_MIN_SEASON <= season <= WINNERS_MAX_SEASON):
                    raise RisingStarSourceError(
                        f"line {line}: season {season} is outside the declared "
                        f"decided range {WINNERS_MIN_SEASON}-{WINNERS_MAX_SEASON}"
                    )
                if club not in WINNER_CLUBS:
                    raise RisingStarSourceError(
                        f"line {line}: unknown club {club!r} (not a measured "
                        f"Rising Star winner club string)"
                    )
                if link_status not in LINK_STATUSES:
                    raise RisingStarSourceError(
                        f"line {line}: invalid link_status {link_status!r}"
                    )
                if not (0 <= candidate_count <= _MAX_CANDIDATE_COUNT):
                    raise RisingStarSourceError(
                        f"line {line}: candidate_count {candidate_count} is outside "
                        f"the plausible range 0-{_MAX_CANDIDATE_COUNT}"
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

                if source_citation not in WINNER_SOURCE_CITATIONS:
                    raise RisingStarSourceError(
                        f"line {line}: source_citation {source_citation!r} must be "
                        f"one of {sorted(WINNER_SOURCE_CITATIONS)} "
                        f"(source-granularity provenance)"
                    )

                # The winning tally is recorded from 1997 on. Both directions,
                # so neither a stray value on a pre-1997 row nor a missing one
                # after it can load through.
                if season >= VOTES_FIRST_SEASON:
                    if votes is None:
                        raise RisingStarSourceError(
                            f"line {line}: season {season} must carry the winner's "
                            f"vote tally (recorded from {VOTES_FIRST_SEASON})"
                        )
                elif votes is not None:
                    raise RisingStarSourceError(
                        f"line {line}: no vote tally is recorded before "
                        f"{VOTES_FIRST_SEASON} (got {votes!r} for {season})"
                    )
                if votes is not None and _VOTES.fullmatch(votes) is None:
                    raise RisingStarSourceError(
                        f"line {line}: votes {votes!r} is not of the measured "
                        f"form 'NN.NN'"
                    )

                # Checked before the ordering rule so a literal repeat is
                # reported as a duplicate rather than masked as disorder.
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
                    RisingStarWinner(
                        source_key=source_key,
                        season=season,
                        club=club,
                        player=player,
                        player_id=player_id,
                        link_status=link_status,
                        candidate_count=candidate_count,
                        votes=votes,
                        source_citation=source_citation,
                    )
                )
    except RisingStarSourceError:
        raise
    except (OSError, UnicodeError, csv.Error) as exc:
        raise RisingStarSourceError(f"cannot read {csv_path}: {exc}") from exc

    _validate_winners_complete(rows)
    return rows


def _validate_winners_complete(rows: Sequence[RisingStarWinner]) -> None:
    if len(rows) != EXPECTED_WINNER_ROWS:
        raise RisingStarSourceError(
            f"expected {EXPECTED_WINNER_ROWS} Rising Star winner rows, "
            f"got {len(rows)}"
        )

    seasons = {row.season for row in rows}
    if len(seasons) != EXPECTED_WINNER_ROWS:
        raise RisingStarSourceError(
            f"expected one winner row per decided season "
            f"({EXPECTED_WINNER_ROWS}), got {len(seasons)} distinct seasons"
        )
    if min(seasons) != WINNERS_MIN_SEASON or max(seasons) != WINNERS_MAX_SEASON:
        raise RisingStarSourceError(
            f"winner season span {min(seasons)}-{max(seasons)} does not match "
            f"the declared {WINNERS_MIN_SEASON}-{WINNERS_MAX_SEASON}"
        )

    unlinked = [row.source_key for row in rows if row.player_id is None]
    if unlinked:
        raise RisingStarSourceError(
            f"every Rising Star winner is linked in the measured source; "
            f"{len(unlinked)} row(s) carry no player_id ({unlinked[:3]})"
        )

    votes_present = sum(1 for row in rows if row.votes is not None)
    if votes_present != EXPECTED_WINNER_VOTES_PRESENT:
        raise RisingStarSourceError(
            f"expected {EXPECTED_WINNER_VOTES_PRESENT} winner rows with a vote "
            f"tally, got {votes_present}"
        )

    citations = {row.source_citation for row in rows}
    if citations != set(WINNER_SOURCE_CITATIONS):
        raise RisingStarSourceError(
            f"winner source_citation vocabulary {sorted(citations)} does not "
            f"match the declared {sorted(WINNER_SOURCE_CITATIONS)}"
        )


def validate_family(
    nominations: Sequence[RisingStarNomination],
    winners: Sequence[RisingStarWinner],
) -> None:
    """Cross-check the two tracked files against each other.

    The award_winners row and the ``is_winner`` nomination are different
    records from different sources, but they describe the same fact, so a
    disagreement is a curation error rather than something to resolve
    silently at load time. The check is on **player identity**, not on the
    name text: the DraftGuru and FootyWire spellings legitimately differ on
    five of the thirty-three seasons.
    """
    decided = {row.season: row for row in nominations if row.is_winner}
    by_season = {row.season: row for row in winners}

    if set(decided) != set(by_season):
        only_nomination = sorted(set(decided) - set(by_season))
        only_winner = sorted(set(by_season) - set(decided))
        raise RisingStarSourceError(
            f"the decided seasons disagree between the two files "
            f"(nominations only {only_nomination}, winners only {only_winner})"
        )

    for season in sorted(by_season):
        nomination = decided[season]
        winner = by_season[season]
        if nomination.player_id != winner.player_id:
            raise RisingStarSourceError(
                f"season {season}: the winning nomination resolves to player "
                f"{nomination.player_id} but the winner row carries "
                f"{winner.player_id}"
            )


def winners_summary(
    rows: Sequence[RisingStarWinner], path: str | Path
) -> dict[str, object]:
    seasons = [row.season for row in rows]
    statuses = Counter(row.link_status for row in rows)
    return {
        "path": str(Path(path).resolve()),
        "row_count": len(rows),
        "linked_count": sum(1 for row in rows if row.player_id is not None),
        "season_min": min(seasons),
        "season_max": max(seasons),
        "distinct_seasons": len(set(seasons)),
        "votes_present": sum(1 for row in rows if row.votes is not None),
        "distinct_clubs": len({row.club for row in rows}),
        "link_status": {name: statuses[name] for name in sorted(statuses)},
    }


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
    parser.add_argument(
        "--winners",
        type=Path,
        default=DEFAULT_WINNERS_CSV_PATH,
        help=f"canonical winners path (default: {DEFAULT_WINNERS_CSV_PATH})",
    )
    args = parser.parse_args(argv)
    try:
        rows = load_rising_star(args.csv)
        winners = load_rising_star_winners(args.winners)
        validate_family(rows, winners)
    except RisingStarSourceError as exc:
        print(
            json.dumps(
                {"ok": False, "path": str(args.csv.resolve()), "error": str(exc)},
                sort_keys=True,
            )
        )
        return 1

    report = summary(rows, args.csv)
    # NOT "winners": summary() already reports the is_winner nomination count
    # under that key, and the two are different records.
    report["winner_rows"] = winners_summary(winners, args.winners)
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
