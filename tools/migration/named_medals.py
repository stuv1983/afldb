#!/usr/bin/env python3
"""Parse and validate the canonical named-medals source files.

The source is deliberately checked before any database importer sees a row.
Malformed or incomplete data raises ``NamedMedalsSourceError``; no
best-effort coercion is performed here.

AFLDB-ISSUE-112 phase 7 (§23) — the last family. Two tracked files replace
the ``award_category IN ('award', 'draft_pick')`` slice of the legacy
SQLite ``awards`` table (excluding the four awards owned by other groups —
``all-australian``, ``rising-star``, ``22-under-22``, ``coleman``):

* ``data/awards/named-medals.csv`` — 979 winner rows, one per
  award-season-winner. A tied season carries one row per winner (the
  Brownlow Medal has six such seasons — 1981, 1986, 1987, 1996, 2003×3,
  2012 — and several state-league medals have their own ties). The
  bootstrap was extracted read-only from ``afldb_dev.award_winners``
  joined to the 17 named-medal awards.
* ``data/awards/named-medals-definitions.csv`` — the 17 award definitions
  themselves (``awards`` rows: Brownlow Medal, Norm Smith Medal, Leigh
  Matthews Trophy, Magarey/Sandover/Liston/Morrish/Larke/Hunter Harrison
  medals, the AFLCA and AFLPA awards, the 40-Man Squad, and National Draft
  Pick #1). These were previously derived by
  ``import_awards.import_awards`` from the same legacy table; tracking them
  here is what lets the family run with ``AFLDB_LEGACY_SQLITE`` unset.

Like the All-Australian / club best-and-fairest slices, ``award_winners``
already carries a stable ``source_record_id`` on every row and reloads on
``(source_id, source_record_id)`` — not a natural key. ``source_key`` in
the winners file is therefore the *preserved* database ``source_record_id``,
carried verbatim (``<award-slug>:<season>:<row_no>``, where ``<row_no>``
was the legacy scan-order position and is now a frozen assigned id): it is
**not** re-minted here and the loader keys the reload on it unchanged.

``club`` is the source's own verbatim club string (=
``award_winners.club_name_raw``) — the winner's AFL club, which draftguru
records for the 680 winners who played in the AFL and leaves empty for the
299 who did not (a Magarey/Sandover/Larke winner who never crossed to the
national competition). The loader re-resolves the non-empty value
season-aware through the same ``import_awards.ClubResolver`` the legacy
loader used, so ``club_id`` is reconstructed (rebuild-stable) and
``club_name_raw`` round-trips byte-for-byte; an empty cell loads back NULL.

Provenance is ``draftguru`` for every row, at source granularity (the
operator policy for this family — ``source_citation`` is not a per-page
citation and legacy SQLite is not reopened to reconstruct one).

``votes`` is the Brownlow medallist's winning tally and is present on
exactly those 53 rows — no other named medal records a vote count in this
data. A Brownlow row therefore carries ``votes`` and no ``note``; every
other row carries no ``votes`` and (usually) a "Recruited from …" ``note``.

A player can win the same award in more than one season, and a season can
have more than one winner, so the parser does **not** enforce
``(award_slug, season)`` uniqueness. Nor does it enforce
``(award_slug, season, player)`` — the 2013 All-Australian 40-Man Squad
legitimately lists two different footballers both named "Josh Kennedy". It
enforces ``source_key`` uniqueness and the finer
``(award_slug, season, player, club)`` identity, both measured
collision-free.
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
DEFAULT_WINNERS_PATH = _DATA_DIR / "named-medals.csv"
DEFAULT_DEFINITIONS_PATH = _DATA_DIR / "named-medals-definitions.csv"

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
    "competition",
    "first_season",
    "last_season",
)

# Declared coverage, measured read-only against afldb_dev
# (AFLDB-ISSUE-112 §14.4 / §23). A row count, season span or per-family
# distribution outside this is a source contract change, not a formatting
# slip — bump these when a later season's winners are curated in.
# AFLDB-ISSUE-118 §23.20 (Family A): seven Gridley-facing medals joined the
# family from the Wikipedia winner lists (328 rows, all linked; source_citation
# 'wikipedia'): Anzac, Showdown, Glendinning–Allan, Brett Kirk and Marcus
# Ashcroft medals, Goal of the Year and Mark of the Year (the latter two with
# the Channel Seven / ABC awards of 1970–2000, as Gridley counts them).
EXPECTED_WINNERS = 1307
EXPECTED_DEFINITIONS = 24
MIN_SEASON = 1970
MAX_SEASON = 2025
# 1970-1976 (Mark / Goal of the Year), then 1979/1980 onward — not
# contiguous, so a distinct-count check.
EXPECTED_DISTINCT_SEASONS = 56
EXPECTED_LINKED = 1191
EXPECTED_NOTE_PRESENT = 1109
EXPECTED_VOTES_PRESENT = 53

# The 17 named-medal award slugs, exactly as import_awards.award_slug()
# produces them from the legacy category/slug/name. The winners file may
# reference only these; the definitions file must supply exactly these,
# once each. This same set is imported by import_awards.import_awards() to
# exclude these awards' winners from the legacy reload's scope.
AWARD_SLUGS = frozenset({
    "anzac-medal",
    "showdown-medal",
    "glendinning-allan-medal",
    "brett-kirk-medal",
    "marcus-ashcroft-medal",
    "goal-of-the-year",
    "mark-of-the-year",
    "aflca-best-young-player",
    "aflca-champion",
    "aflpa-best-first-year-player",
    "aflpa-mvp",
    "all-australian-squad",
    "brownlow-medal",
    "gardiner-medal",
    "gary-ayres-award",
    "geoff-christian-medal",
    "hunter-harrison-medal",
    "larke-medal",
    "liston-trophy",
    "magarey-medal",
    "morrish-medal",
    "national-draft-pick-1",
    "norm-smith-medal",
    "sandover-medal",
})

# migration 005's award category vocabulary. Every named-medal definition
# is one of these two; 16 are 'award', National Draft Pick #1 is
# 'draft_pick'. 'club_best_and_fairest' and 'honour_team' are other
# families' categories and are refused here.
DEFINITION_CATEGORIES = {"award", "draft_pick"}

# Source-granularity provenance for the whole family (§13 operator policy).
SOURCE_CITATION = "draftguru"
# Row-level provenance vocabulary: the legacy-extracted rows cite draftguru,
# the AFLDB-ISSUE-118 medal transcriptions cite wikipedia. Each value must be
# a sources.key; import_awards routes every row to its own source_id.
SOURCE_CITATIONS = frozenset({"draftguru", "wikipedia"})
#: Medals whose season can legitimately carry two rows for one player: the
#: per-match derby medals (two derbies a season) and Mark / Goal of the Year
#: in 1970-2000, when Channel Seven and the ABC each made an award. The
#: occasion in `note` distinguishes the rows.
PER_MATCH_MEDALS = frozenset({
    "anzac-medal", "showdown-medal", "glendinning-allan-medal",
    "brett-kirk-medal", "marcus-ashcroft-medal",
    "mark-of-the-year", "goal-of-the-year",
})

# The link_status enum (migration 005) and the subset that requires a
# player_id (the migration 019/053 invariant, enforced here rather than
# left to the database). This family carries 116 legitimately unlinked
# rows (state-league and junior medallists with no AFL career), so
# completeness is a fixed expected linked count, not "every row linked".
LINK_STATUSES = {"unique", "resolved", "ambiguous", "unmatched", "implausible"}
LINKED_STATUSES = {"unique", "resolved"}

# The 20 source club strings measured across all 680 non-empty club cells
# in afldb_dev — the modern AFL club names draftguru uses for a winner's
# AFL club (several with a lineage split import_awards.ClubResolver maps
# season-aware). Adding a value here is a deliberate change, not a parser
# fix. The other 299 winner rows carry no club at all — an empty cell,
# which loads back NULL.
KNOWN_CLUBS = {
    "Adelaide", "Brisbane", "Carlton", "Collingwood", "Essendon", "Fitzroy",
    "Fremantle", "Geelong", "Gold Coast", "GWS", "Hawthorn", "Melbourne",
    "North Melbourne", "Port Adelaide", "Richmond", "South Melbourne",
    "St Kilda", "Sydney", "West Coast", "Western Bulldogs",
}

# Only the Brownlow medallist row records a winning vote tally, on every
# one of its 53 rows; no other named medal in this data carries one. The
# measured shape is a whole number with two decimal places (17.00–45.00).
VOTES_AWARD_SLUG = "brownlow-medal"
_VOTES_RE = re.compile(r"^[0-9]{1,3}\.[0-9]{2}$")

_SOURCE_KEY_RE = re.compile(r"^([a-z0-9-]+):([0-9]{4}):([0-9]+)$")
_MAX_CANDIDATE_COUNT = 9


class NamedMedalsSourceError(ValueError):
    """Raised when a canonical source file violates its data contract."""


@dataclass(frozen=True)
class NamedMedalWinner:
    source_key: str
    award_slug: str
    season: int
    club: str | None
    player: str
    player_id: int | None
    link_status: str
    candidate_count: int
    votes: str | None
    note: str | None
    source_citation: str


@dataclass(frozen=True)
class NamedMedalAward:
    slug: str
    name: str
    category: str
    competition: str | None
    first_season: int
    last_season: int


def _required_text(value: str | None, field: str, line: int) -> str:
    if value is None or value == "":
        raise NamedMedalsSourceError(f"line {line}: {field} is required")
    if value != value.strip():
        raise NamedMedalsSourceError(
            f"line {line}: {field} has leading or trailing whitespace"
        )
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise NamedMedalsSourceError(
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
        raise NamedMedalsSourceError(
            f"line {line}: {field} must be an integer, got {text!r}"
        )
    return int(text)


def _optional_positive_int(value: str | None, field: str, line: int) -> int | None:
    if value is None or value == "":
        return None
    text = _required_text(value, field, line)
    if not re.fullmatch(r"[0-9]+", text):
        raise NamedMedalsSourceError(
            f"line {line}: {field} must be a positive integer, got {text!r}"
        )
    return int(text)


# ---------------------------------------------------------------------------
# Winners
# ---------------------------------------------------------------------------
def load_named_medals(
    path: str | Path = DEFAULT_WINNERS_PATH,
) -> list[NamedMedalWinner]:
    """Load the complete canonical winners file or fail without partial data."""

    csv_path = Path(path)
    rows: list[NamedMedalWinner] = []
    source_keys: set[str] = set()
    natural_keys: set[tuple[str, int, str, str]] = set()
    last_source_key: str | None = None

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, strict=True)
            actual_header = tuple(reader.fieldnames or ())
            if actual_header != WINNERS_HEADER:
                raise NamedMedalsSourceError(
                    "invalid header: expected "
                    f"{','.join(WINNERS_HEADER)!r}, got {','.join(actual_header)!r}"
                )

            for raw in reader:
                line = reader.line_num
                if None in raw:
                    raise NamedMedalsSourceError(f"line {line}: too many columns")

                source_key = _required_text(raw.get("source_key"), "source_key", line)
                award_slug = _required_text(raw.get("award_slug"), "award_slug", line)
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
                votes = _optional_text(raw.get("votes"), "votes", line)
                note = _optional_text(raw.get("note"), "note", line)
                source_citation = _required_text(
                    raw.get("source_citation"), "source_citation", line
                )

                if award_slug not in AWARD_SLUGS:
                    raise NamedMedalsSourceError(
                        f"line {line}: unknown award_slug {award_slug!r} "
                        f"(not one of the {len(AWARD_SLUGS)} named-medal awards)"
                    )

                match = _SOURCE_KEY_RE.fullmatch(source_key)
                if match is None:
                    raise NamedMedalsSourceError(
                        f"line {line}: invalid source_key {source_key!r} "
                        f"(expected <award-slug>:<season>:<row_no>)"
                    )
                if match.group(1) != award_slug:
                    raise NamedMedalsSourceError(
                        f"line {line}: source_key {source_key!r} names award "
                        f"{match.group(1)!r} but award_slug is {award_slug!r}"
                    )
                if int(match.group(2)) != season:
                    raise NamedMedalsSourceError(
                        f"line {line}: source_key {source_key!r} embeds season "
                        f"{match.group(2)} but the row's season is {season}"
                    )

                if not (MIN_SEASON <= season <= MAX_SEASON):
                    raise NamedMedalsSourceError(
                        f"line {line}: season {season} is outside the declared "
                        f"range {MIN_SEASON}-{MAX_SEASON}"
                    )
                if club is not None and club not in KNOWN_CLUBS:
                    raise NamedMedalsSourceError(
                        f"line {line}: unknown club {club!r} "
                        f"(not a measured named-medal source club string)"
                    )
                if link_status not in LINK_STATUSES:
                    raise NamedMedalsSourceError(
                        f"line {line}: invalid link_status {link_status!r}"
                    )
                if not (0 <= candidate_count <= _MAX_CANDIDATE_COUNT):
                    raise NamedMedalsSourceError(
                        f"line {line}: candidate_count {candidate_count} is outside "
                        f"the plausible range 0-{_MAX_CANDIDATE_COUNT}"
                    )

                is_linked_status = link_status in LINKED_STATUSES
                if is_linked_status and player_id is None:
                    raise NamedMedalsSourceError(
                        f"line {line}: link_status {link_status!r} requires player_id"
                    )
                if not is_linked_status and player_id is not None:
                    raise NamedMedalsSourceError(
                        f"line {line}: link_status {link_status!r} must not carry "
                        f"player_id"
                    )

                if source_citation not in SOURCE_CITATIONS:
                    raise NamedMedalsSourceError(
                        f"line {line}: source_citation {source_citation!r} must be "
                        f"one of {sorted(SOURCE_CITATIONS)} (source-granularity provenance)"
                    )

                # votes is the Brownlow medallist's winning tally and is a
                # measured structural contract: present on every brownlow-medal
                # row, absent on every other, and a brownlow-medal row carries
                # no note. Enforced both directions so a stray value or a
                # missing one is caught rather than loaded through.
                if award_slug == VOTES_AWARD_SLUG:
                    if votes is None:
                        raise NamedMedalsSourceError(
                            f"line {line}: a {VOTES_AWARD_SLUG!r} row must carry "
                            f"its winning votes tally"
                        )
                    if note is not None:
                        raise NamedMedalsSourceError(
                            f"line {line}: a {VOTES_AWARD_SLUG!r} row must not carry "
                            f"a note (got {note!r})"
                        )
                elif votes is not None:
                    raise NamedMedalsSourceError(
                        f"line {line}: votes is only recorded for "
                        f"{VOTES_AWARD_SLUG!r} winners (got {votes!r} on "
                        f"{award_slug!r})"
                    )
                if votes is not None and _VOTES_RE.fullmatch(votes) is None:
                    raise NamedMedalsSourceError(
                        f"line {line}: votes {votes!r} is not of the measured "
                        f"form 'NN.NN'"
                    )

                # Checked before the ordering rule: a literal repeat of an
                # earlier key is always also an ordering violation (the file
                # is strictly ascending), so checking duplication first keeps
                # that failure distinctly reported rather than masked.
                if source_key in source_keys:
                    raise NamedMedalsSourceError(
                        f"line {line}: duplicate source_key {source_key!r}"
                    )
                if last_source_key is not None and source_key <= last_source_key:
                    raise NamedMedalsSourceError(
                        f"line {line}: source_key {source_key!r} is out of "
                        f"deterministic order (expected strictly ascending, "
                        f"previous was {last_source_key!r})"
                    )
                last_source_key = source_key

                # NOT (award_slug, season): a tied season legitimately lists
                # more than one winner. NOT (award_slug, season, player): the
                # 2013 40-Man Squad has two different "Josh Kennedy"s.
                # (award_slug, season, player, club) distinguishes every
                # measured row.
                # A per-match medal (two derbies a season) can be won twice in
                # one season by one player (Luke Parker, Brett Kirk Medal 2022),
                # so those rows are distinguished by the occasion in `note`.
                natural_key = (award_slug, season, player, club or "",
                               note if award_slug in PER_MATCH_MEDALS else "")
                if natural_key in natural_keys:
                    raise NamedMedalsSourceError(
                        f"line {line}: duplicate natural identity "
                        f"(award_slug, season, player, club) = "
                        f"{(award_slug, season, player, club)!r}"
                    )

                source_keys.add(source_key)
                natural_keys.add(natural_key)

                rows.append(
                    NamedMedalWinner(
                        source_key=source_key,
                        award_slug=award_slug,
                        season=season,
                        club=club,
                        player=player,
                        player_id=player_id,
                        link_status=link_status,
                        candidate_count=candidate_count,
                        votes=votes,
                        note=note,
                        source_citation=source_citation,
                    )
                )
    except NamedMedalsSourceError:
        raise
    except (OSError, UnicodeError, csv.Error) as exc:
        raise NamedMedalsSourceError(f"cannot read {csv_path}: {exc}") from exc

    _validate_winners_complete(rows)
    return rows


def _validate_winners_complete(rows: Sequence[NamedMedalWinner]) -> None:
    if len(rows) != EXPECTED_WINNERS:
        raise NamedMedalsSourceError(
            f"expected {EXPECTED_WINNERS} named-medal winner rows, got {len(rows)}"
        )

    seasons = {row.season for row in rows}
    if min(seasons) != MIN_SEASON or max(seasons) != MAX_SEASON:
        raise NamedMedalsSourceError(
            f"season span {min(seasons)}-{max(seasons)} does not match the "
            f"declared {MIN_SEASON}-{MAX_SEASON}"
        )
    if len(seasons) != EXPECTED_DISTINCT_SEASONS:
        raise NamedMedalsSourceError(
            f"expected {EXPECTED_DISTINCT_SEASONS} distinct seasons, "
            f"got {len(seasons)}"
        )

    slugs = {row.award_slug for row in rows}
    if slugs != set(AWARD_SLUGS):
        missing = sorted(set(AWARD_SLUGS) - slugs)
        extra = sorted(slugs - set(AWARD_SLUGS))
        raise NamedMedalsSourceError(
            f"winners cover {len(slugs)} of the {len(AWARD_SLUGS)} named-medal awards "
            f"(missing {missing}, unexpected {extra})"
        )

    citations = {row.source_citation for row in rows}
    if citations != SOURCE_CITATIONS:
        raise NamedMedalsSourceError(
            f"source_citation vocabulary {sorted(citations)} does not match the "
            f"declared {sorted(SOURCE_CITATIONS)}"
        )

    linked = sum(1 for row in rows if row.player_id is not None)
    if linked != EXPECTED_LINKED:
        raise NamedMedalsSourceError(
            f"expected {EXPECTED_LINKED} linked rows, got {linked} "
            f"({len(rows) - linked} unlinked)"
        )

    note_present = sum(1 for row in rows if row.note is not None)
    if note_present != EXPECTED_NOTE_PRESENT:
        raise NamedMedalsSourceError(
            f"expected {EXPECTED_NOTE_PRESENT} rows with a note, got {note_present}"
        )

    votes_present = sum(1 for row in rows if row.votes is not None)
    if votes_present != EXPECTED_VOTES_PRESENT:
        raise NamedMedalsSourceError(
            f"expected {EXPECTED_VOTES_PRESENT} rows with a votes tally, "
            f"got {votes_present}"
        )


# ---------------------------------------------------------------------------
# Definitions
# ---------------------------------------------------------------------------
def load_named_medals_definitions(
    path: str | Path = DEFAULT_DEFINITIONS_PATH,
) -> list[NamedMedalAward]:
    """Load the 17 named-medal award definitions or fail without partial data."""

    csv_path = Path(path)
    rows: list[NamedMedalAward] = []
    slugs: set[str] = set()
    last_slug: str | None = None

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, strict=True)
            actual_header = tuple(reader.fieldnames or ())
            if actual_header != DEFINITIONS_HEADER:
                raise NamedMedalsSourceError(
                    "invalid definitions header: expected "
                    f"{','.join(DEFINITIONS_HEADER)!r}, got "
                    f"{','.join(actual_header)!r}"
                )

            for raw in reader:
                line = reader.line_num
                if None in raw:
                    raise NamedMedalsSourceError(f"line {line}: too many columns")

                slug = _required_text(raw.get("slug"), "slug", line)
                name = _required_text(raw.get("name"), "name", line)
                category = _required_text(raw.get("category"), "category", line)
                competition = _optional_text(
                    raw.get("competition"), "competition", line
                )
                first_season = _int(raw.get("first_season"), "first_season", line)
                last_season = _int(raw.get("last_season"), "last_season", line)

                if slug not in AWARD_SLUGS:
                    raise NamedMedalsSourceError(
                        f"line {line}: unknown slug {slug!r} "
                        f"(not one of the {len(AWARD_SLUGS)} named-medal awards)"
                    )
                if category not in DEFINITION_CATEGORIES:
                    raise NamedMedalsSourceError(
                        f"line {line}: category {category!r} must be one of "
                        f"{sorted(DEFINITION_CATEGORIES)}"
                    )
                if not (MIN_SEASON <= first_season <= last_season <= MAX_SEASON):
                    raise NamedMedalsSourceError(
                        f"line {line}: malformed season bounds "
                        f"{first_season}-{last_season} (must satisfy "
                        f"{MIN_SEASON} <= first <= last <= {MAX_SEASON})"
                    )

                if slug in slugs:
                    raise NamedMedalsSourceError(
                        f"line {line}: duplicate slug {slug!r}"
                    )
                if last_slug is not None and slug <= last_slug:
                    raise NamedMedalsSourceError(
                        f"line {line}: slug {slug!r} is out of deterministic order "
                        f"(expected strictly ascending, previous was {last_slug!r})"
                    )
                last_slug = slug
                slugs.add(slug)

                rows.append(
                    NamedMedalAward(
                        slug=slug,
                        name=name,
                        category=category,
                        competition=competition,
                        first_season=first_season,
                        last_season=last_season,
                    )
                )
    except NamedMedalsSourceError:
        raise
    except (OSError, UnicodeError, csv.Error) as exc:
        raise NamedMedalsSourceError(f"cannot read {csv_path}: {exc}") from exc

    if slugs != set(AWARD_SLUGS):
        missing = sorted(set(AWARD_SLUGS) - slugs)
        extra = sorted(slugs - set(AWARD_SLUGS))
        raise NamedMedalsSourceError(
            f"expected exactly the 17 named-medal award definitions "
            f"(missing {missing}, unexpected {extra})"
        )
    return rows


def validate_family(
    winners: Sequence[NamedMedalWinner],
    definitions: Sequence[NamedMedalAward],
) -> None:
    """Cross-check the two files against each other.

    Every winner's award must have a definition, every definition must have
    winners, and each definition's declared span must be exactly the
    min/max season of its winners — a drift between the two files is a
    curation error, not something to resolve silently at load time.
    """
    by_slug = {award.slug: award for award in definitions}
    spans: dict[str, tuple[int, int]] = {}
    for row in winners:
        low, high = spans.get(row.award_slug, (row.season, row.season))
        spans[row.award_slug] = (min(low, row.season), max(high, row.season))

    if set(by_slug) != set(spans):
        raise NamedMedalsSourceError(
            f"definition slugs {sorted(by_slug)} do not match the slugs the "
            f"winners cover {sorted(spans)}"
        )

    for slug, (first, last) in sorted(spans.items()):
        award = by_slug[slug]
        if (award.first_season, award.last_season) != (first, last):
            raise NamedMedalsSourceError(
                f"award {slug!r} definition span "
                f"{award.first_season}-{award.last_season} does not match its "
                f"winners' {first}-{last}"
            )


def summary(
    winners: Sequence[NamedMedalWinner],
    definitions: Sequence[NamedMedalAward],
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
        "votes_present": sum(1 for row in winners if row.votes is not None),
        "note_present": sum(1 for row in winners if row.note is not None),
        "null_club": sum(1 for row in winners if row.club is None),
        "season_min": min(seasons),
        "season_max": max(seasons),
        "distinct_seasons": len(set(seasons)),
        "distinct_awards": len(by_award),
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
        winners = load_named_medals(args.csv)
        definitions = load_named_medals_definitions(args.definitions)
        validate_family(winners, definitions)
    except NamedMedalsSourceError as exc:
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
