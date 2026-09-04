#!/usr/bin/env python3
"""Load the authoritative season-grain Brownlow totals from the tracked artefact.

AFLDB-ISSUE-113 §8.6. ``brownlow_season_votes`` is the ONLY valid basis for
career Brownlow totals (migration 005), and until this loader existed its sole
writer was the retired legacy SQLite path in ``import_legacy_afl.py``. The
canonical rebuild therefore shipped the table empty, and every downstream
consumer then asserted "no medal that season" for 98 decided seasons (§8.1).

Source
------
``data/brownlow/season-votes.csv`` — a re-keyed, read-only export of the
legacy-loaded authoritative table preserved in ``afldb_prod_auth_recovery``
(class D, §8.5), with ``data/brownlow/season-votes.manifest.json`` recording
where it came from, when, by which exact SQL, and the SHA-256 of the bytes.
Neither this loader nor the rebuild reads a legacy SQLite database or the
network for this slice.

Identity
--------
The artefact never carries a target ``players.id``. Every row is keyed by the
AFL Tables profile path, the one identity the canonical rebuild preserves
(``external_identities`` / ``afltables_profile_url``), and is resolved here
exactly as ``import_awards.PlayerResolver`` resolves the awards census: to
exactly one canonical player, fail-closed, never by name and never through the
review-only ``bootstrap_player_id`` column. The 174 legacy players that had no
profile path in the recovery database were adjudicated in
``data/brownlow/player-identity.csv`` (§8.12); the artefact builder wrote those
paths into the artefact, so this loader sees one rule for every row. Five
further rows in the same file (§8.14.5) are explicit operator overrides of a
recovery-bridge path that AFL Tables does not spell that way; each names the
exact original path it replaces, and the builder applies it to that bootstrap
id only. Nothing here or in the builder matches, corrects or guesses a name.

Contract (§8.6)
---------------
1. Validate the artefact and manifest BEFORE any database contact
   (``--validate-only`` runs just that and prints JSON).
2. Every artefact season must be ``complete`` for ``brownlow_season_total`` in
   ``stat_availability`` and not ``in_progress`` in ``seasons``; every
   ``complete`` season must be present. 2026 (pending) never gets a row.
3. Zero rejections or no write. An unresolved or ambiguous profile path is a
   rejection; any rejection fails the batch and rolls the transaction back.
4. One transaction: ``TRUNCATE ONLY brownlow_season_votes`` then COPY in
   deterministic ``(season, player_id)`` order. ``brownlow_round_votes`` is
   never touched — a different, canonical writer owns it (§5.9).
5. Provenance: ``source_id = afltables`` (operator decision 2026-09-04),
   ``source_record_id = brownlow-season:<season>:<profile path>``,
   ``import_batch_id`` from the batch; ``link_status_value`` carried through;
   ``club_id`` left NULL as the legacy writer left it.
6. Runs as ``afldb_import`` through ``AFLDB_IMPORT_DATABASE_URL`` only.

Rerunnable: an identical rerun yields identical rows and counts.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    Reporter,
    analyze,
    connect_pg,
    copy_rows,
    import_batch,
    load_env,
    require_env,
    safe_dsn,
    scalar,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data" / "brownlow"
ARTEFACT_PATH = DATA_DIR / "season-votes.csv"
MANIFEST_PATH = DATA_DIR / "season-votes.manifest.json"
IDENTITY_PATH = DATA_DIR / "player-identity.csv"

TOOL_NAME = "import_brownlow_season.py"
TARGET_TABLE = "brownlow_season_votes"
SOURCE_KEY = "afltables"
STAT_KEY = "brownlow_season_total"

# §8.6: season, profile path, the 13 substantive columns' worth of facts, the
# link status, then three review-only columns that are never matched on.
HEADER = (
    "season", "afltables_profile_url", "votes", "vote_rank", "eligible_rank",
    "is_ineligible", "is_winner", "games", "three_vote_games", "two_vote_games",
    "one_vote_games", "polling_games", "link_status_value",
    "bootstrap_player_id", "display_name", "legacy_source_record_id",
)
REVIEW_ONLY_COLUMNS = ("bootstrap_player_id", "display_name", "legacy_source_record_id")
NULLABLE_SMALLINTS = ("vote_rank", "eligible_rank", "games", "three_vote_games",
                      "two_vote_games", "one_vote_games", "polling_games")
BOOLEANS = ("is_ineligible", "is_winner")
LINK_STATUSES = ("unique", "resolved", "ambiguous", "unmatched", "implausible")

# §8.12 / §8.14.5: one row per adjudicated legacy player. ``recovery_profile_url``
# is empty for the players that had NO profile path in the recovery database
# (the builder fills the gap) and is the exact recovery-bridge path for the
# explicit overrides (the builder replaces that path, and only that path, for
# that bootstrap id). It is provenance: the original path is never lost.
IDENTITY_HEADER = ("bootstrap_player_id", "display_name", "afltables_profile_url", "evidence",
                   "recovery_profile_url")
IDENTITY_EVIDENCE = ("round_vote_witness", "unique_name_span", "operator")

# The normalised AFL Tables profile path, exactly as external_identities stores it.
PROFILE_URL = re.compile(r"^players/[A-Z]/[^/]+\.html$")
SMALLINT_MAX = 32767

MANIFEST_SCHEMA_VERSION = 1


class BrownlowSeasonSourceError(ValueError):
    """Raised when the artefact, manifest or adjudication file violates its contract."""


@dataclass(frozen=True)
class SeasonVoteRow:
    season: int
    afltables_profile_url: str
    votes: int
    vote_rank: int | None
    eligible_rank: int | None
    is_ineligible: bool
    is_winner: bool
    games: int | None
    three_vote_games: int | None
    two_vote_games: int | None
    one_vote_games: int | None
    polling_games: int | None
    link_status_value: str
    bootstrap_player_id: int
    display_name: str
    legacy_source_record_id: str

    @property
    def source_record_id(self) -> str:
        return f"brownlow-season:{self.season}:{self.afltables_profile_url}"


@dataclass(frozen=True)
class IdentityAdjudication:
    bootstrap_player_id: int
    display_name: str
    afltables_profile_url: str
    evidence: str
    # None: the recovery database had no path (gap fill). A path: the exact
    # recovery-bridge path this adjudication explicitly overrides (§8.14.5).
    recovery_profile_url: str | None = None

    @property
    def is_override(self) -> bool:
        return self.recovery_profile_url is not None


# ---------------------------------------------------------------------------
# Parsing — strict, no coercion, no partial data
# ---------------------------------------------------------------------------

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _text(value: str | None, field: str, line: int, required: bool = True) -> str | None:
    if value is None or value == "":
        if required:
            raise BrownlowSeasonSourceError(f"line {line}: {field} is required")
        return None
    if value != value.strip():
        raise BrownlowSeasonSourceError(
            f"line {line}: {field} has leading or trailing whitespace")
    if any(unicodedata.category(c) == "Cc" for c in value):
        raise BrownlowSeasonSourceError(f"line {line}: {field} contains a control character")
    return value


def _int(value: str | None, field: str, line: int, required: bool = True,
         minimum: int = 0, maximum: int = SMALLINT_MAX) -> int | None:
    text = _text(value, field, line, required)
    if text is None:
        return None
    if not re.fullmatch(r"-?[0-9]+", text) or (len(text) > 1 and text.startswith("0")):
        raise BrownlowSeasonSourceError(
            f"line {line}: {field} must be an integer with no leading zero, got {text!r}")
    number = int(text)
    if number < minimum or number > maximum:
        raise BrownlowSeasonSourceError(
            f"line {line}: {field} {number} is outside {minimum}..{maximum}")
    return number


def _bool(value: str | None, field: str, line: int) -> bool:
    text = _text(value, field, line)
    if text == "t":
        return True
    if text == "f":
        return False
    raise BrownlowSeasonSourceError(f"line {line}: {field} must be 't' or 'f', got {text!r}")


def _url(value: str | None, field: str, line: int) -> str:
    text = _text(value, field, line)
    if PROFILE_URL.fullmatch(text) is None:
        raise BrownlowSeasonSourceError(
            f"line {line}: {field} {text!r} is not a normalised AFL Tables profile path")
    return text


def _open_csv(path: Path, header: Sequence[str]):
    handle = Path(path).open("r", encoding="utf-8", newline="")
    reader = csv.DictReader(handle, strict=True)
    actual = tuple(reader.fieldnames or ())
    if actual != tuple(header):
        handle.close()
        raise BrownlowSeasonSourceError(
            f"{Path(path).name}: invalid header: expected {','.join(header)!r}, "
            f"got {','.join(actual)!r}")
    return handle, reader


def load_identity_adjudications(path: str | Path = IDENTITY_PATH) -> dict[int, IdentityAdjudication]:
    """The §8.12 adjudication file: bootstrap id -> profile path, with its evidence.

    A row with an empty ``recovery_profile_url`` fills a legacy player that had
    no path; a row with one is an explicit §8.14.5 override of exactly that
    recovery-bridge path. Every path in the file — adjudicated or overridden —
    is claimed at most once, and an override never restates the path it replaces.
    """
    rows: dict[int, IdentityAdjudication] = {}
    urls: dict[str, int] = {}
    recovery_urls: dict[str, int] = {}
    last_id: int | None = None
    try:
        handle, reader = _open_csv(Path(path), IDENTITY_HEADER)
        with handle:
            for raw in reader:
                line = reader.line_num
                if None in raw:
                    raise BrownlowSeasonSourceError(f"line {line}: too many columns")
                bootstrap_id = _int(raw.get("bootstrap_player_id"), "bootstrap_player_id",
                                    line, minimum=1, maximum=2**31 - 1)
                display_name = _text(raw.get("display_name"), "display_name", line)
                url = _url(raw.get("afltables_profile_url"), "afltables_profile_url", line)
                evidence = _text(raw.get("evidence"), "evidence", line)
                if evidence not in IDENTITY_EVIDENCE:
                    raise BrownlowSeasonSourceError(
                        f"line {line}: evidence {evidence!r} is not one of "
                        f"{', '.join(IDENTITY_EVIDENCE)}")
                recovery_url: str | None = None
                if _text(raw.get("recovery_profile_url"), "recovery_profile_url", line,
                         required=False) is not None:
                    recovery_url = _url(raw.get("recovery_profile_url"),
                                        "recovery_profile_url", line)
                    if recovery_url == url:
                        raise BrownlowSeasonSourceError(
                            f"line {line}: recovery_profile_url {recovery_url!r} equals the "
                            "adjudicated path; an override must replace a different path")
                if bootstrap_id in rows:
                    raise BrownlowSeasonSourceError(
                        f"line {line}: duplicate bootstrap_player_id {bootstrap_id}")
                if last_id is not None and bootstrap_id <= last_id:
                    raise BrownlowSeasonSourceError(
                        f"line {line}: bootstrap_player_id {bootstrap_id} is out of "
                        f"deterministic order (previous was {last_id})")
                last_id = bootstrap_id
                if url in urls:
                    raise BrownlowSeasonSourceError(
                        f"line {line}: afltables_profile_url {url!r} is already claimed "
                        f"by bootstrap_player_id {urls[url]}")
                urls[url] = bootstrap_id
                if recovery_url is not None:
                    if recovery_url in recovery_urls:
                        raise BrownlowSeasonSourceError(
                            f"line {line}: recovery_profile_url {recovery_url!r} is already "
                            f"overridden for bootstrap_player_id {recovery_urls[recovery_url]}")
                    recovery_urls[recovery_url] = bootstrap_id
                rows[bootstrap_id] = IdentityAdjudication(
                    bootstrap_id, display_name, url, evidence, recovery_url)
    except BrownlowSeasonSourceError:
        raise
    except (OSError, UnicodeError, csv.Error) as exc:
        raise BrownlowSeasonSourceError(f"cannot read {path}: {exc}") from exc
    if not rows:
        raise BrownlowSeasonSourceError(f"{Path(path).name}: no adjudication rows")
    contradicted = sorted(set(recovery_urls) & set(urls))
    if contradicted:
        raise BrownlowSeasonSourceError(
            f"{Path(path).name}: path(s) both overridden and adjudicated: {contradicted}")
    return rows


def load_artefact(path: str | Path = ARTEFACT_PATH) -> list[SeasonVoteRow]:
    """Parse the whole artefact or fail without partial data."""
    rows: list[SeasonVoteRow] = []
    seen: set[tuple[int, str]] = set()
    last_key: tuple[int, str] | None = None
    try:
        handle, reader = _open_csv(Path(path), HEADER)
        with handle:
            for raw in reader:
                line = reader.line_num
                if None in raw:
                    raise BrownlowSeasonSourceError(f"line {line}: too many columns")
                season = _int(raw.get("season"), "season", line, minimum=1897, maximum=2100)
                url = _url(raw.get("afltables_profile_url"), "afltables_profile_url", line)
                votes = _int(raw.get("votes"), "votes", line)
                nullable = {
                    field: _int(raw.get(field), field, line, required=False)
                    for field in NULLABLE_SMALLINTS
                }
                is_ineligible = _bool(raw.get("is_ineligible"), "is_ineligible", line)
                is_winner = _bool(raw.get("is_winner"), "is_winner", line)
                link_status = _text(raw.get("link_status_value"), "link_status_value", line)
                if link_status not in LINK_STATUSES:
                    raise BrownlowSeasonSourceError(
                        f"line {line}: link_status_value {link_status!r} is not a link_status")
                bootstrap_id = _int(raw.get("bootstrap_player_id"), "bootstrap_player_id",
                                    line, minimum=1, maximum=2**31 - 1)
                display_name = _text(raw.get("display_name"), "display_name", line)
                legacy_id = _text(raw.get("legacy_source_record_id"),
                                  "legacy_source_record_id", line)

                key = (season, url)
                if key in seen:
                    raise BrownlowSeasonSourceError(
                        f"line {line}: duplicate (season, afltables_profile_url) {key}")
                if last_key is not None and key <= last_key:
                    raise BrownlowSeasonSourceError(
                        f"line {line}: {key} is out of deterministic (season, "
                        f"afltables_profile_url) order (previous was {last_key})")
                seen.add(key)
                last_key = key
                if is_winner and votes == 0:
                    raise BrownlowSeasonSourceError(
                        f"line {line}: a winner with zero votes")
                rows.append(SeasonVoteRow(
                    season=season, afltables_profile_url=url, votes=votes,
                    vote_rank=nullable["vote_rank"], eligible_rank=nullable["eligible_rank"],
                    is_ineligible=is_ineligible, is_winner=is_winner,
                    games=nullable["games"],
                    three_vote_games=nullable["three_vote_games"],
                    two_vote_games=nullable["two_vote_games"],
                    one_vote_games=nullable["one_vote_games"],
                    polling_games=nullable["polling_games"],
                    link_status_value=link_status, bootstrap_player_id=bootstrap_id,
                    display_name=display_name, legacy_source_record_id=legacy_id,
                ))
    except BrownlowSeasonSourceError:
        raise
    except (OSError, UnicodeError, csv.Error) as exc:
        raise BrownlowSeasonSourceError(f"cannot read {path}: {exc}") from exc
    if not rows:
        raise BrownlowSeasonSourceError(f"{Path(path).name}: no rows")
    return rows


def load_manifest(path: str | Path = MANIFEST_PATH) -> dict:
    try:
        with Path(path).open("r", encoding="utf-8") as handle:
            manifest = json.load(handle)
    except (OSError, UnicodeError, ValueError) as exc:
        raise BrownlowSeasonSourceError(f"cannot read {path}: {exc}") from exc
    if not isinstance(manifest, dict):
        raise BrownlowSeasonSourceError(f"{Path(path).name}: not a JSON object")
    if manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        raise BrownlowSeasonSourceError(
            f"{Path(path).name}: schema_version {manifest.get('schema_version')!r} "
            f"is not {MANIFEST_SCHEMA_VERSION}")
    for key in ("source", "extracted_at_utc", "export_sql", "artefact", "identity"):
        if key not in manifest:
            raise BrownlowSeasonSourceError(f"{Path(path).name}: missing {key!r}")
    return manifest


# ---------------------------------------------------------------------------
# Measurement and offline validation
# ---------------------------------------------------------------------------

def measure(rows: Sequence[SeasonVoteRow]) -> dict:
    """The season-grain facts the manifest records and the Stage-9 gates assert."""
    seasons = sorted({row.season for row in rows})
    return {
        "rows": len(rows),
        "votes_total": sum(row.votes for row in rows),
        "winners": sum(1 for row in rows if row.is_winner),
        "seasons": len(seasons),
        "players": len({row.afltables_profile_url for row in rows}),
        "first_season": seasons[0],
        "last_season": seasons[-1],
        "null_counts": {
            field: sum(1 for row in rows if getattr(row, field) is None)
            for field in NULLABLE_SMALLINTS
        },
        "ineligible_rows": sum(1 for row in rows if row.is_ineligible),
        "link_status_counts": {
            status: sum(1 for row in rows if row.link_status_value == status)
            for status in LINK_STATUSES
            if any(row.link_status_value == status for row in rows)
        },
    }


def _seasons_from_ranges(ranges: Iterable[Sequence[int]]) -> set[int]:
    seasons: set[int] = set()
    for first, last in ranges:
        seasons.update(range(int(first), int(last) + 1))
    return seasons


def expected_seasons(manifest: dict) -> set[int]:
    coverage = manifest["artefact"].get("season_coverage")
    if not isinstance(coverage, list) or not coverage:
        raise BrownlowSeasonSourceError("manifest: artefact.season_coverage is missing")
    return _seasons_from_ranges(coverage)


def validate_offline(
    artefact_path: str | Path = ARTEFACT_PATH,
    manifest_path: str | Path = MANIFEST_PATH,
    identity_path: str | Path = IDENTITY_PATH,
) -> dict:
    """Everything provable without a database. Raises on the first violation."""
    manifest = load_manifest(manifest_path)
    rows = load_artefact(artefact_path)
    identities = load_identity_adjudications(identity_path)

    csv_sha = sha256_file(Path(artefact_path))
    if manifest["artefact"].get("csv_sha256") != csv_sha:
        raise BrownlowSeasonSourceError(
            f"manifest csv_sha256 {manifest['artefact'].get('csv_sha256')!r} does not "
            f"match {Path(artefact_path).name} ({csv_sha})")
    identity_sha = sha256_file(Path(identity_path))
    if manifest["identity"].get("csv_sha256") != identity_sha:
        raise BrownlowSeasonSourceError(
            f"manifest identity.csv_sha256 does not match {Path(identity_path).name} "
            f"({identity_sha})")

    measured = measure(rows)
    for key in ("rows", "votes_total", "winners", "seasons", "players",
                "first_season", "last_season"):
        if manifest["artefact"].get(key) != measured[key]:
            raise BrownlowSeasonSourceError(
                f"manifest artefact.{key} = {manifest['artefact'].get(key)!r} but the "
                f"artefact measures {measured[key]}")
    if manifest["artefact"].get("null_counts") != measured["null_counts"]:
        raise BrownlowSeasonSourceError(
            "manifest artefact.null_counts disagree with the artefact: NULL semantics "
            "must be preserved exactly")

    # Coverage: exactly the declared decided seasons, at least one winner in each.
    declared = expected_seasons(manifest)
    present = {row.season for row in rows}
    if present != declared:
        missing = sorted(declared - present)
        extra = sorted(present - declared)
        raise BrownlowSeasonSourceError(
            f"artefact seasons differ from the manifest coverage: missing {missing}, "
            f"unexpected {extra}")
    winners_by_season: dict[int, int] = {}
    for row in rows:
        if row.is_winner:
            winners_by_season[row.season] = winners_by_season.get(row.season, 0) + 1
    without_winner = sorted(present - set(winners_by_season))
    if without_winner:
        raise BrownlowSeasonSourceError(f"seasons with no winner row: {without_winner}")

    # §8.12: every adjudicated bootstrap id present in the artefact carries exactly
    # the adjudicated path, and the adjudication file carries no id the artefact
    # does not use. Nothing here matches on a name.
    used: set[int] = set()
    for row in rows:
        adjudicated = identities.get(row.bootstrap_player_id)
        if adjudicated is None:
            continue
        used.add(row.bootstrap_player_id)
        if row.afltables_profile_url != adjudicated.afltables_profile_url:
            raise BrownlowSeasonSourceError(
                f"season {row.season} bootstrap_player_id {row.bootstrap_player_id}: "
                f"artefact path {row.afltables_profile_url!r} differs from the "
                f"adjudicated {adjudicated.afltables_profile_url!r}")
    unused = sorted(set(identities) - used)
    if unused:
        raise BrownlowSeasonSourceError(
            f"adjudication rows for bootstrap ids the artefact never uses: {unused}")
    if manifest["identity"].get("players") != len(identities):
        raise BrownlowSeasonSourceError(
            f"manifest identity.players = {manifest['identity'].get('players')!r} but "
            f"the adjudication file has {len(identities)} rows")
    adjudicated_rows = sum(1 for row in rows if row.bootstrap_player_id in identities)
    if manifest["identity"].get("rows") != adjudicated_rows:
        raise BrownlowSeasonSourceError(
            f"manifest identity.rows = {manifest['identity'].get('rows')!r} but "
            f"{adjudicated_rows} artefact rows carry an adjudicated identity")

    # §8.14.5: the explicit overrides. The manifest must list exactly the file's
    # override rows with the original recovery path they replaced, and no
    # overridden recovery path may survive anywhere in the artefact.
    overrides = [i for i in identities.values() if i.is_override]
    all_paths = {row.afltables_profile_url for row in rows}
    surviving = sorted(i.recovery_profile_url for i in overrides
                       if i.recovery_profile_url in all_paths)
    if surviving:
        raise BrownlowSeasonSourceError(
            f"overridden recovery path(s) still present in the artefact: {surviving}")
    expected_overrides = [
        {"bootstrap_player_id": i.bootstrap_player_id, "display_name": i.display_name,
         "recovery_profile_url": i.recovery_profile_url,
         "afltables_profile_url": i.afltables_profile_url, "evidence": i.evidence,
         "rows": sum(1 for row in rows if row.bootstrap_player_id == i.bootstrap_player_id)}
        for i in overrides]
    recorded = manifest["identity"].get("overrides", [])
    recorded_view = [
        {key: entry.get(key) for key in ("bootstrap_player_id", "display_name",
                                         "recovery_profile_url", "afltables_profile_url",
                                         "evidence", "rows")}
        for entry in recorded] if isinstance(recorded, list) else None
    if recorded_view != expected_overrides:
        raise BrownlowSeasonSourceError(
            "manifest identity.overrides does not list exactly the adjudication file's "
            f"override rows: expected {len(expected_overrides)}, recorded "
            f"{len(recorded) if isinstance(recorded, list) else 'malformed'}")
    override_rows = sum(entry["rows"] for entry in expected_overrides)
    for key, value in (("gap_players", len(identities) - len(overrides)),
                       ("gap_rows", adjudicated_rows - override_rows),
                       ("override_players", len(overrides)),
                       ("override_rows", override_rows)):
        if manifest["identity"].get(key) != value:
            raise BrownlowSeasonSourceError(
                f"manifest identity.{key} = {manifest['identity'].get(key)!r} but the "
                f"artefact and adjudication file give {value}")

    # One bootstrap player, one path — across the whole artefact, not just the
    # adjudicated subset.
    path_by_bootstrap: dict[int, str] = {}
    for row in rows:
        previous = path_by_bootstrap.setdefault(row.bootstrap_player_id, row.afltables_profile_url)
        if previous != row.afltables_profile_url:
            raise BrownlowSeasonSourceError(
                f"bootstrap_player_id {row.bootstrap_player_id} carries two profile "
                f"paths: {previous!r} and {row.afltables_profile_url!r}")

    return {
        "ok": True,
        "artefact": str(Path(artefact_path).resolve()),
        "manifest": str(Path(manifest_path).resolve()),
        "identity": str(Path(identity_path).resolve()),
        "csv_sha256": csv_sha,
        "identity_csv_sha256": identity_sha,
        "identity_players": len(identities),
        "identity_rows": adjudicated_rows,
        "identity_gap_players": len(identities) - len(overrides),
        "identity_override_players": len(overrides),
        "identity_override_rows": override_rows,
        "identity_evidence": {
            evidence: sum(1 for i in identities.values() if i.evidence == evidence)
            for evidence in IDENTITY_EVIDENCE
        },
        "source_key": SOURCE_KEY,
        **measured,
    }


# ---------------------------------------------------------------------------
# Database phase
# ---------------------------------------------------------------------------

class BrownlowSeasonLoadRefused(RuntimeError):
    """The database disagrees with the artefact's declared contract; nothing was written."""


def check_database_coverage(pg, declared: set[int]) -> None:
    """§8.6 item 1, database half: the declared seasons are exactly the decided ones."""
    with pg.cursor() as cur:
        cur.execute(
            "SELECT season FROM stat_availability WHERE stat_key = %s AND coverage = 'complete'",
            (STAT_KEY,))
        complete = {int(r[0]) for r in cur.fetchall()}
        cur.execute("SELECT year FROM seasons WHERE status = 'in_progress'")
        in_progress = {int(r[0]) for r in cur.fetchall()}
        cur.execute("SELECT year FROM seasons")
        known = {int(r[0]) for r in cur.fetchall()}
    if not complete:
        raise BrownlowSeasonLoadRefused(
            f"stat_availability has no 'complete' seasons for {STAT_KEY}; the reference "
            "coverage grid has not been loaded, so the artefact cannot be checked against it")
    if declared != complete:
        raise BrownlowSeasonLoadRefused(
            f"artefact coverage {sorted(declared - complete)} beyond / "
            f"{sorted(complete - declared)} short of the {STAT_KEY} 'complete' seasons")
    pending = sorted(declared & in_progress)
    if pending:
        raise BrownlowSeasonLoadRefused(
            f"artefact carries rows for in-progress season(s) {pending}; a pending season "
            "must never read as decided")
    unknown = sorted(declared - known)
    if unknown:
        raise BrownlowSeasonLoadRefused(f"artefact seasons absent from seasons: {unknown}")


class ProfileResolver:
    """Profile path -> exactly one canonical player. Fail-closed; never a name."""

    def __init__(self, pg) -> None:
        with pg.cursor() as cur:
            cur.execute(
                """SELECT ei.external_id, ei.player_id
                     FROM external_identities ei
                     JOIN sources s ON s.id = ei.source_id
                    WHERE s.key = %s
                      AND ei.match_method = 'afltables_profile_url'
                      AND ei.status IN ('unique', 'resolved')
                      AND ei.player_id IS NOT NULL""",
                (SOURCE_KEY,))
            pairs = cur.fetchall()
        self._by_url = self._index(pairs)

    @staticmethod
    def _index(pairs: Iterable[tuple[str, int]]) -> dict[str, set[int]]:
        by_url: dict[str, set[int]] = {}
        for url, player_id in pairs:
            by_url.setdefault(url, set()).add(int(player_id))
        return by_url

    @classmethod
    def from_pairs(cls, pairs: Iterable[tuple[str, int]]) -> "ProfileResolver":
        """The same resolver over an in-memory (profile path, player id) bridge.

        Exists so the fail-closed rule can be regression-tested without a
        database; production always builds from ``external_identities``.
        """
        resolver = cls.__new__(cls)
        resolver._by_url = cls._index(pairs)
        return resolver

    def resolve(self, url: str) -> tuple[int | None, str | None]:
        candidates = self._by_url.get(url)
        if not candidates:
            return None, "no canonical player carries this AFL Tables profile path"
        if len(candidates) != 1:
            return None, (f"profile path resolves to {len(candidates)} canonical players: "
                          + ", ".join(str(p) for p in sorted(candidates)))
        return next(iter(candidates)), None


def load(pg, rep: Reporter, rows: Sequence[SeasonVoteRow], manifest: dict) -> dict:
    """Resolve, refuse on any rejection, then truncate-and-copy in one transaction."""
    declared = expected_seasons(manifest)
    check_database_coverage(pg, declared)

    source_id = scalar(pg, "SELECT id FROM sources WHERE key = %s", (SOURCE_KEY,))
    if source_id is None:
        raise BrownlowSeasonLoadRefused(f"source {SOURCE_KEY!r} is not registered")
    round_rows_before = scalar(pg, "SELECT count(*) FROM brownlow_round_votes")

    resolver = ProfileResolver(pg)
    resolved: list[tuple] = []
    rejections: list[tuple[str, str]] = []
    seen_target: dict[tuple[int, int], str] = {}
    with import_batch(pg, SOURCE_KEY, TOOL_NAME, TARGET_TABLE) as batch:
        for row in rows:
            batch.records_read += 1
            player_id, reason = resolver.resolve(row.afltables_profile_url)
            if player_id is None:
                batch.reject(row.source_record_id, reason,
                             {"season": row.season, "afltables_profile_url": row.afltables_profile_url})
                rejections.append((row.source_record_id, reason))
                continue
            key = (row.season, player_id)
            if key in seen_target:
                reason = (f"two profile paths resolve to player {player_id} in "
                          f"{row.season}: {seen_target[key]!r} and {row.afltables_profile_url!r}")
                batch.reject(row.source_record_id, reason, {"season": row.season})
                rejections.append((row.source_record_id, reason))
                continue
            seen_target[key] = row.afltables_profile_url
            resolved.append((
                row.season, player_id, row.votes, row.vote_rank, row.eligible_rank,
                row.is_ineligible, row.is_winner, row.games, row.three_vote_games,
                row.two_vote_games, row.one_vote_games, row.polling_games,
                row.link_status_value, source_id, row.source_record_id, batch.id,
            ))

        if rejections:
            for record, reason in rejections[:20]:
                rep.warn(f"rejected {record}: {reason}")
            raise BrownlowSeasonLoadRefused(
                f"{len(rejections)} of {len(rows)} artefact rows did not resolve to exactly "
                "one canonical player; the load is accepted only at zero rejections, so "
                "nothing was written (rejections are recorded in import_rejections)")

        # Deterministic target order: (season, player_id).
        resolved.sort(key=lambda r: (r[0], r[1]))

        with pg.cursor() as cur:
            # ONLY this table. brownlow_round_votes has its own canonical writer and is
            # never truncated here — the legacy coupling this loader replaces (§5.9).
            cur.execute("TRUNCATE ONLY brownlow_season_votes")
        written = copy_rows(
            pg, TARGET_TABLE,
            ["season", "player_id", "votes", "vote_rank", "eligible_rank",
             "is_ineligible", "is_winner", "games", "three_vote_games",
             "two_vote_games", "one_vote_games", "polling_games",
             "link_status_value", "source_id", "source_record_id", "import_batch_id"],
            resolved, batch,
        )

        # Prove the write before it is committed: the table must now measure exactly
        # what the manifest declares, and the round table must be untouched.
        expected = manifest["artefact"]
        with pg.cursor() as cur:
            cur.execute(
                """SELECT count(*), coalesce(sum(votes), 0),
                          count(*) FILTER (WHERE is_winner), count(DISTINCT season),
                          count(DISTINCT player_id),
                          count(*) FILTER (WHERE eligible_rank IS NULL),
                          count(*) FILTER (WHERE polling_games IS NULL)
                     FROM brownlow_season_votes""")
            got_rows, got_votes, got_winners, got_seasons, got_players, null_er, null_pg = cur.fetchone()
        actual = {
            "rows": int(got_rows), "votes_total": int(got_votes), "winners": int(got_winners),
            "seasons": int(got_seasons), "players": int(got_players),
        }
        wanted = {k: expected[k] for k in actual}
        if actual != wanted:
            raise BrownlowSeasonLoadRefused(
                f"post-write measurement {actual} differs from the manifest {wanted}; "
                "rolled back")
        if (int(null_er) != expected["null_counts"]["eligible_rank"]
                or int(null_pg) != expected["null_counts"]["polling_games"]):
            raise BrownlowSeasonLoadRefused(
                "post-write NULL counts differ from the manifest (NULL was coerced); rolled back")
        round_rows_after = scalar(pg, "SELECT count(*) FROM brownlow_round_votes")
        if round_rows_after != round_rows_before:
            raise BrownlowSeasonLoadRefused(
                f"brownlow_round_votes changed during the load ({round_rows_before} -> "
                f"{round_rows_after}); rolled back")
        pg.commit()

    analyze(pg, TARGET_TABLE)
    rep.result(TARGET_TABLE, written,
               f"({actual['votes_total']:,} votes, {actual['winners']} winners, "
               f"{actual['seasons']} seasons, {actual['players']} players)")
    rep.result("brownlow_round_votes", int(round_rows_after), "(untouched)")
    return {**actual, "batch_id": batch.id, "round_rows": int(round_rows_after),
            "rejections": 0}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Load brownlow_season_votes from the tracked AFLDB-ISSUE-113 artefact.")
    parser.add_argument("--artefact", type=Path, default=ARTEFACT_PATH)
    parser.add_argument("--manifest", type=Path, default=MANIFEST_PATH)
    parser.add_argument("--identity", type=Path, default=IDENTITY_PATH)
    parser.add_argument("--validate-only", action="store_true",
                        help="validate the artefact, manifest and adjudication file offline "
                             "and print a JSON summary; no database contact")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    try:
        summary = validate_offline(args.artefact, args.manifest, args.identity)
    except BrownlowSeasonSourceError as exc:
        print(json.dumps({"ok": False, "artefact": str(Path(args.artefact).resolve()),
                          "error": str(exc)}, sort_keys=True))
        return 1
    if args.validate_only:
        print(json.dumps(summary, sort_keys=True))
        return 0

    load_env()
    rep = Reporter(verbose=not args.quiet)
    rep.step(f"artefact      : {args.artefact} (sha256 {summary['csv_sha256'][:16]}…)")
    rep.step(f"manifest      : {summary['rows']:,} rows, {summary['votes_total']:,} votes, "
             f"{summary['winners']} winners, {summary['seasons']} seasons")
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")
    rep.step(f"target        : {safe_dsn(dsn)}")
    started = time.time()
    pg = connect_pg(dsn)
    try:
        rows = load_artefact(args.artefact)
        manifest = load_manifest(args.manifest)
        load(pg, rep, rows, manifest)
    except BrownlowSeasonLoadRefused as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        pg.close()
    rep.step(f"completed in {time.time() - started:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
