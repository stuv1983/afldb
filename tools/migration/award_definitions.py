#!/usr/bin/env python3
"""Parse and validate the shared canonical award-definition manifest.

The source is deliberately checked before any database importer sees a row.
Malformed or incomplete data raises ``AwardDefinitionsSourceError``; no
best-effort coercion is performed here.

AFLDB-ISSUE-112 closeout (§24) — the last award definitions that no manifest
family owned. After phases 1-7 every honours *family* loads from a tracked
manifest, but two ``awards`` rows were still created only by the legacy
``awards`` group reading ``AFLDB_LEGACY_SQLITE``:

* ``all-australian`` — synthesised by ``import_awards.import_awards`` as a
  hardcoded literal whose ``first_season``/``last_season`` came from the two
  legacy SQLite All-Australian tables;
* ``rising-star`` — derived from the legacy SQLite ``awards`` table.

``import_all_australian`` and ``import_rising_star`` both only *guarded* that
their definition already existed and raised "run the 'awards' group first",
so a canonical rebuild with no legacy source could not create either row —
and without the parent ``awards`` row neither family's winners or nominations
can be loaded at all.

``data/awards/award-definitions.csv`` gives both a tracked home. It is one
shared file rather than two one-row files, but it is **not** a shared writer:
each family reconciles only its own slug, through a slug-scoped id-preserving
``reload_keyed`` on ``awards``. The two scopes are disjoint, so there is no
double ownership and no reload can delete the other family's row.

Deliberately **not** in this file:

* ``coleman`` — AFLDB-ISSUE-111 owns it. ``import_awards.ensure_coleman_award``
  creates it if missing from the derivation itself, so it already has a
  tracked, legacy-free home and adding it here would create a second writer.
* ``22-under-22`` — the ``under_22`` group upserts its own definition
  (``import_awards.py``), and the legacy definition reload already excludes
  that slug.
* ``bf-*`` and the 17 named medals — owned by
  ``data/awards/club-best-and-fairest-definitions.csv`` and
  ``data/awards/named-medals-definitions.csv`` respectively (§22.2, §23.2).
  Those stay separate: each is validated against its own winners' span, which
  a shared file could not express.

``club_id`` (always NULL for both rows) and ``description`` (from
``import_awards.AWARD_DESCRIPTIONS``, which already matches ``afldb_dev``
byte-for-byte for both slugs) are constants the loader supplies, not manifest
columns — exactly as in the named-medals definitions file.

``first_season`` / ``last_season`` are the values measured read-only from
``afldb_dev`` (all-australian 1953-2025, rising-star 1993-2025). They are the
row's *initial* span; ``import_all_australian`` still recomputes the
All-Australian span from its own winners after the reload, as it did before.

Provenance is ``draftguru`` at source granularity for both rows (the
operator's §13 policy): both definitions were derived from the legacy
DraftGuru award scrape aggregate, not from a per-page citation PostgreSQL
retains.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


_DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "awards"
DEFAULT_PATH = _DATA_DIR / "award-definitions.csv"

HEADER = (
    "slug",
    "name",
    "category",
    "competition",
    "first_season",
    "last_season",
    "source_citation",
)

ALL_AUSTRALIAN_SLUG = "all-australian"
RISING_STAR_SLUG = "rising-star"

# The exact slug -> category contract measured in afldb_dev. A slug outside
# this map is refused rather than loaded: this file exists to create two
# specific shared rows, and a third one appearing here would silently widen
# the reload scope of whichever family carries it.
AWARD_CATEGORIES = {
    ALL_AUSTRALIAN_SLUG: "honour_team",
    RISING_STAR_SLUG: "award",
}
AWARD_SLUGS = frozenset(AWARD_CATEGORIES)
EXPECTED_DEFINITIONS = len(AWARD_SLUGS)

# Both rows are AFL competition awards. Kept as a declared vocabulary rather
# than a free string so a typo cannot reach the awards table.
COMPETITIONS = frozenset({"AFL"})

# Source-granularity provenance measured for these exact two definitions
# (AFLDB-ISSUE-112 §24.2). Both came from the legacy DraftGuru award scrape;
# accepting another known source would silently falsify provenance rather than
# merely widen a vocabulary.
SOURCE_CITATIONS = {
    ALL_AUSTRALIAN_SLUG: "draftguru",
    RISING_STAR_SLUG: "draftguru",
}

# The VFL/AFL competition's first season, and the last season of the accepted
# historical core. A definition span outside this is malformed by construction.
MIN_SEASON = 1897
MAX_SEASON = 2025


class AwardDefinitionsSourceError(ValueError):
    """Raised when the canonical source file violates its data contract."""


@dataclass(frozen=True)
class AwardDefinition:
    slug: str
    name: str
    category: str
    competition: str | None
    first_season: int
    last_season: int
    source_citation: str


def _required_text(value: str | None, field: str, line: int) -> str:
    if value is None or value == "":
        raise AwardDefinitionsSourceError(f"line {line}: {field} is required")
    if value != value.strip():
        raise AwardDefinitionsSourceError(
            f"line {line}: {field} has leading or trailing whitespace"
        )
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise AwardDefinitionsSourceError(
            f"line {line}: {field} contains a control character"
        )
    return value


def _int(value: str | None, field: str, line: int) -> int:
    text = _required_text(value, field, line)
    if not text.isdigit():
        raise AwardDefinitionsSourceError(
            f"line {line}: {field} must be an integer, got {text!r}"
        )
    return int(text)


def load_award_definitions(
    path: str | Path = DEFAULT_PATH,
) -> list[AwardDefinition]:
    """Load the shared award definitions or fail without partial data."""

    csv_path = Path(path)
    rows: list[AwardDefinition] = []
    slugs: set[str] = set()
    last_slug: str | None = None

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, strict=True)
            actual_header = tuple(reader.fieldnames or ())
            if actual_header != HEADER:
                raise AwardDefinitionsSourceError(
                    "invalid header: expected "
                    f"{','.join(HEADER)!r}, got {','.join(actual_header)!r}"
                )

            for raw in reader:
                line = reader.line_num
                if None in raw:
                    raise AwardDefinitionsSourceError(
                        f"line {line}: too many columns"
                    )

                slug = _required_text(raw.get("slug"), "slug", line)
                name = _required_text(raw.get("name"), "name", line)
                category = _required_text(raw.get("category"), "category", line)
                competition = _required_text(
                    raw.get("competition"), "competition", line
                )
                first_season = _int(raw.get("first_season"), "first_season", line)
                last_season = _int(raw.get("last_season"), "last_season", line)
                source_citation = _required_text(
                    raw.get("source_citation"), "source_citation", line
                )

                if slug not in AWARD_SLUGS:
                    raise AwardDefinitionsSourceError(
                        f"line {line}: unknown slug {slug!r} (this file owns only "
                        f"{sorted(AWARD_SLUGS)}; every other award definition has "
                        f"its own tracked owner)"
                    )
                if category != AWARD_CATEGORIES[slug]:
                    raise AwardDefinitionsSourceError(
                        f"line {line}: award {slug!r} is category "
                        f"{AWARD_CATEGORIES[slug]!r}, got {category!r}"
                    )
                if competition not in COMPETITIONS:
                    raise AwardDefinitionsSourceError(
                        f"line {line}: competition {competition!r} must be one of "
                        f"{sorted(COMPETITIONS)}"
                    )
                if not (MIN_SEASON <= first_season <= last_season <= MAX_SEASON):
                    raise AwardDefinitionsSourceError(
                        f"line {line}: malformed season bounds "
                        f"{first_season}-{last_season} (must satisfy "
                        f"{MIN_SEASON} <= first <= last <= {MAX_SEASON})"
                    )
                if source_citation != SOURCE_CITATIONS[slug]:
                    raise AwardDefinitionsSourceError(
                        f"line {line}: award {slug!r} has source_citation "
                        f"{SOURCE_CITATIONS[slug]!r}, got {source_citation!r}"
                    )

                # Checked before the ordering rule so a literal repeat is
                # reported as a duplicate rather than masked as disorder.
                if slug in slugs:
                    raise AwardDefinitionsSourceError(
                        f"line {line}: duplicate slug {slug!r}"
                    )
                if last_slug is not None and slug <= last_slug:
                    raise AwardDefinitionsSourceError(
                        f"line {line}: slug {slug!r} is out of deterministic order "
                        f"(expected strictly ascending, previous was {last_slug!r})"
                    )
                last_slug = slug
                slugs.add(slug)

                rows.append(
                    AwardDefinition(
                        slug=slug,
                        name=name,
                        category=category,
                        competition=competition,
                        first_season=first_season,
                        last_season=last_season,
                        source_citation=source_citation,
                    )
                )
    except AwardDefinitionsSourceError:
        raise
    except (OSError, UnicodeError, csv.Error) as exc:
        raise AwardDefinitionsSourceError(f"cannot read {csv_path}: {exc}") from exc

    if slugs != set(AWARD_SLUGS):
        missing = sorted(set(AWARD_SLUGS) - slugs)
        extra = sorted(slugs - set(AWARD_SLUGS))
        raise AwardDefinitionsSourceError(
            f"expected exactly the {EXPECTED_DEFINITIONS} shared award "
            f"definitions (missing {missing}, unexpected {extra})"
        )
    return rows


def definition_for(
    slug: str, definitions: Sequence[AwardDefinition] | None = None
) -> AwardDefinition:
    """The one definition a family owns.

    Each family reconciles only its own slug, so this is what keeps the two
    reload scopes disjoint: a caller cannot accidentally write the other
    family's row through this file.
    """
    for definition in definitions if definitions is not None else load_award_definitions():
        if definition.slug == slug:
            return definition
    raise AwardDefinitionsSourceError(
        f"award definition {slug!r} is missing from the manifest"
    )


def summary(
    definitions: Sequence[AwardDefinition], path: str | Path
) -> dict[str, object]:
    return {
        "ok": True,
        "path": str(Path(path).resolve()),
        "definition_count": len(definitions),
        "definitions": {
            definition.slug: {
                "name": definition.name,
                "category": definition.category,
                "competition": definition.competition,
                "first_season": definition.first_season,
                "last_season": definition.last_season,
                "source_citation": definition.source_citation,
            }
            for definition in definitions
        },
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--csv",
        type=Path,
        default=DEFAULT_PATH,
        help=f"canonical definitions path (default: {DEFAULT_PATH})",
    )
    args = parser.parse_args(argv)
    try:
        definitions = load_award_definitions(args.csv)
    except AwardDefinitionsSourceError as exc:
        print(
            json.dumps(
                {"ok": False, "path": str(args.csv.resolve()), "error": str(exc)},
                sort_keys=True,
            )
        )
        return 1

    print(json.dumps(summary(definitions, args.csv), sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
