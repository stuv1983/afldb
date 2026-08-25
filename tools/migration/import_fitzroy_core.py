#!/usr/bin/env python3
"""Import a canonical fitzRoy/AFL Tables snapshot into AFLDB PostgreSQL.

    python tools/migration/import_fitzroy_core.py --label trial-2024 --validate-only
    python tools/migration/import_fitzroy_core.py --label trial-2024 --dry-run
    python tools/migration/import_fitzroy_core.py --label trial-2024
    python tools/migration/import_fitzroy_core.py --label trial-2024 --groups matches stats

AFLDB-ISSUE-093 §13.4a — the historical/core importer of the rebuild path.

Source boundary
---------------
The ONLY inputs are an already-acquired canonical snapshot
(``data/sources/afltables/fitzroy_core/<label>/``) and its tracked
manifest (``docs/rebuild-manifests/afltables_fitzroy_core/<label>.json``),
produced by tools/rebuild/fitzroy/acquire_core.R. This importer never
calls live fitzRoy, never touches the network, and has ZERO dependency on
AFLDB_LEGACY_SQLITE or the preserved pre-rebuild database. The manifest's
fitzRoy version pin, SHA-256 fingerprints, row counts and column lists
are all verified fail-closed before anything connects to PostgreSQL.

Identity rules
--------------
* Player identity is the AFL Tables profile URL (normalised to the
  ``players/A/Name.html`` path), registered in external_identities under
  (source ``afltables``, match_method ``afltables_profile_url``) — the
  migration-018 semantics the register pass established. The fitzRoy
  numeric ``ID`` is used only as the in-run grouping key and must map
  1:1 to the URL; any violation fails closed. Names are never identity:
  two players sharing a name but not an ID/URL stay two players.
* Match identity is results.csv (season, round, date, home, away), with
  match_key ``season|round_code|date|home name|away name`` — the same
  natural-key convention current-season-import.ts writes. player_stats
  rows join to a results match on (date, home identity, away identity)
  and every mismatch fails closed.
* Club strings resolve through the canonical clubs.json alias set to a
  historical identity; when the string's own era does not contain the
  match season (fitzRoy reports e.g. "Footscray" for 2024), the one
  identity of the same organization whose era does contain it is used.
  Anything ambiguous or unresolvable fails closed — mergers are separate
  organizations, so e.g. a pre-1997 "Brisbane Lions" row cannot silently
  become Brisbane Bears.

NULL semantics
--------------
An empty CSV cell means "not recorded" and stays NULL — never 0.
``data/reference/stat-availability.json`` remains the coverage
authority; it also gates which seasons may derive brownlow_round_votes
rows. Brownlow.Votes NA (finals, uncollected eras) is never a 0.

external_identities reconciliation runs under the AFLDB-ISSUE-092 §4
fail-closed gate (``check_population_drop``) with the §5 ``--source-key``
containment, reusing tools/migration/common.py.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

REPO_ROOT = Path(__file__).resolve().parents[2]

CONTRACT_PATH = REPO_ROOT / "tools" / "rebuild" / "fitzroy" / "fitzroy-contract.json"
SNAPSHOT_ROOT = REPO_ROOT / "data" / "sources" / "afltables" / "fitzroy_core"
MANIFEST_ROOT = REPO_ROOT / "docs" / "rebuild-manifests" / "afltables_fitzroy_core"
CLUBS_JSON = REPO_ROOT / "data" / "reference" / "clubs.json"
VENUES_JSON = REPO_ROOT / "data" / "reference" / "venue-canonical.json"
AVAILABILITY_JSON = REPO_ROOT / "data" / "reference" / "stat-availability.json"

ADAPTER_SCHEMA_VERSION = 1

# Provenance attribution mirrors the legacy importer's split exactly:
# match facts and Brownlow votes are AFL Tables data; the player-match
# fact table is attributed to the fitzRoy dataset that carries it.
SOURCE_KEY_AFLTABLES = "afltables"
SOURCE_KEY_FITZROY = "fitzroy_afldata"

# The fitzRoy DOB field is its own evidence source, distinct from both
# the legacy register pass (evidence_type club_player_register) and the
# five-club-list pass (club_all_time_list). Recording it under the
# fitzroy_afldata source key keeps its player_birth_evidence rows
# structurally disjoint from the afltables-sourced club-list evidence
# under the (player_id, source_id, dob) unique key.
DOB_EVIDENCE_TYPE = "fitzroy_player_stats"

MATCH_METHOD = "afltables_profile_url"

EARLIEST_PLAUSIBLE_DOB = date(1850, 1, 1)

FINALS_CODES = {
    "EF": "elimination_final",
    "QF": "qualifying_final",
    "SF": "semi_final",
    "PF": "preliminary_final",
    "GF": "grand_final",
}

# Explicit snapshot-column -> player_match_stats-column mapping. The 21
# contract stat columns plus the derived Disposals extra map onto the 21
# schema stat columns plus brownlow_votes; Time.on.Ground has no target
# column in player_match_stats and is deliberately not imported. Never
# rely on CSV column position.
STAT_MAP = [
    ("Kicks", "kicks"),
    ("Marks", "marks"),
    ("Handballs", "handballs"),
    ("Disposals", "disposals"),
    ("Goals", "goals"),
    ("Behinds", "behinds"),
    ("Hit.Outs", "hitouts"),
    ("Tackles", "tackles"),
    ("Rebounds", "rebounds"),
    ("Inside.50s", "inside_50s"),
    ("Clearances", "clearances"),
    ("Clangers", "clangers"),
    ("Frees.For", "frees_for"),
    ("Frees.Against", "frees_against"),
    ("Contested.Possessions", "contested"),
    ("Uncontested.Possessions", "uncontested"),
    ("Contested.Marks", "contested_marks"),
    ("Marks.Inside.50", "marks_inside_50"),
    ("One.Percenters", "one_percenters"),
    ("Bounces", "bounces"),
    ("Goal.Assists", "goal_assists"),
    ("Brownlow.Votes", "brownlow_votes"),
]

RESULTS_REQUIRED = [
    "Game", "Date", "Round", "Round.Type", "Round.Number", "Season",
    "Home.Team", "Away.Team", "Home.Goals", "Home.Behinds", "Home.Points",
    "Away.Goals", "Away.Behinds", "Away.Points", "Venue", "Margin",
]

QUARTER_COLUMNS = [
    f"{side}Q{q}{kind}" for side in ("H", "A") for q in (1, 2, 3, 4)
    for kind in ("G", "B", "P")
]

PLAYER_STATS_REQUIRED = (
    ["Season", "Round", "Date", "Local.start.time", "Venue", "Attendance",
     "First.name", "Surname", "ID", "Jumper.No.", "Playing.for", "Player",
     "url", "Career.Games", "DOB", "Home.team", "Away.team",
     "Home.score", "Away.score"]
    + [src for src, _ in STAT_MAP]
    + QUARTER_COLUMNS
)

ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
DMY_DATE = re.compile(r"^(\d{1,2})-([A-Za-z]{3})-(\d{4})$")
MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun",
     "jul", "aug", "sep", "oct", "nov", "dec"])}

PLAYER_STATS_FILE = re.compile(r"^player_stats_(\d{4})\.csv$")


class SnapshotValidationError(RuntimeError):
    """The snapshot/manifest pair failed fail-closed validation."""


class MatchIdentityError(RuntimeError):
    """A snapshot row cannot map deterministically onto the schema."""


class PlayerIdentityError(RuntimeError):
    """Player identity is ambiguous enough that players could collapse."""


def fail(message: str) -> "SystemExit":
    print(f"ERROR: {message}", file=sys.stderr)
    return SystemExit(1)


def to_int(value: str | None) -> int | None:
    """Empty means not recorded — NULL, never 0."""
    if value is None or value == "":
        return None
    return int(round(float(value)))


def clean(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


def slugify(text: str) -> str:
    """URL slug. Mirrors afldb_normalise_name, then hyphenates."""
    import unicodedata

    normalised = unicodedata.normalize("NFKD", text)
    normalised = "".join(c for c in normalised if not unicodedata.combining(c))
    normalised = normalised.lower()
    normalised = re.sub(r"['`.,]", "", normalised)
    normalised = re.sub(r"[\-_/\s]+", " ", normalised).strip()
    return re.sub(r"\s+", "-", normalised)


def normalise_profile_url(url: str | None) -> str | None:
    """Reduce a profile URL to the ``players/A/Name.html`` path.

    Mirrors enrich_birth_dates.py so both writers of
    match_method='afltables_profile_url' agree on the external_id form.
    """
    if not url:
        return None
    path = url.strip().replace("../", "")
    path = re.sub(r"^https?://afltables\.com/afl/stats/", "", path)
    return path.lstrip("/") or None


def parse_dob(raw: str | None) -> date | None:
    """Parse the snapshot DOB (``2-Sep-1999``, ISO accepted too)."""
    if not raw:
        return None
    text = raw.strip()
    m = DMY_DATE.match(text)
    if m:
        month = MONTHS.get(m.group(2).lower())
        if month is None:
            return None
        try:
            value = date(int(m.group(3)), month, int(m.group(1)))
        except ValueError:
            return None
        return value if value >= EARLIEST_PLAUSIBLE_DOB else None
    m = ISO_DATE.match(text)
    if m:
        try:
            value = date(int(m[1]), int(m[2]), int(m[3]))
        except ValueError:
            return None
        return value if value >= EARLIEST_PLAUSIBLE_DOB else None
    return None


def parse_iso_date(raw: str, context: str) -> date:
    m = ISO_DATE.match(raw.strip())
    if not m:
        raise SnapshotValidationError(f"{context}: unparseable date {raw!r}")
    return date(int(m[1]), int(m[2]), int(m[3]))


# ---------------------------------------------------------------------------
# Canonical reference datasets (the same data the reference loader loads)
# ---------------------------------------------------------------------------


@dataclass
class ClubIdentity:
    hist: str
    name: str
    first_season: int
    last_season: int | None
    successor_hist: str | None


class ClubResolver:
    """Resolve a source club string + season to one historical identity.

    Aliases (hist, name, short_name, abbreviation) come from the
    canonical clubs.json — exactly the strings the reference loader puts
    in club_aliases. fitzRoy normalises team names to one string per
    organization ("Footscray" appears in 2024 finals), so an alias whose
    own era does not contain the season is remapped to the unique
    same-organization identity whose era does. No candidate, or more
    than one, fails closed.
    """

    def __init__(self, dataset: dict) -> None:
        self.identities: dict[str, ClubIdentity] = {}
        self.alias_to_hist: dict[str, str] = {}
        for row in dataset["identities"]:
            ident = ClubIdentity(
                hist=row["hist"], name=row["name"],
                first_season=row["first_season"], last_season=row["last_season"],
                successor_hist=row["successor_hist"],
            )
            self.identities[ident.hist] = ident
            for alias in {row["hist"], row["name"], row["short_name"], row["abbreviation"]}:
                existing = self.alias_to_hist.get(alias)
                if existing is not None and existing != ident.hist:
                    raise SnapshotValidationError(
                        f"clubs.json alias {alias!r} maps to both "
                        f"{existing!r} and {ident.hist!r}")
                self.alias_to_hist[alias] = ident.hist
        self.org_members: dict[str, list[str]] = defaultdict(list)
        for hist in self.identities:
            self.org_members[self._terminal(hist)].append(hist)
        self._cache: dict[tuple[str, int], str] = {}

    def _terminal(self, hist: str) -> str:
        seen = set()
        while True:
            if hist in seen:
                raise SnapshotValidationError(f"clubs.json successor cycle at {hist!r}")
            seen.add(hist)
            successor = self.identities[hist].successor_hist
            if successor is None:
                return hist
            hist = successor

    def _era_contains(self, hist: str, season: int) -> bool:
        ident = self.identities[hist]
        last = ident.last_season if ident.last_season is not None else 9999
        return ident.first_season <= season <= last

    def resolve(self, raw: str, season: int) -> str:
        key = (raw, season)
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        hist = self.alias_to_hist.get(raw)
        if hist is None:
            raise MatchIdentityError(
                f"unmapped club string {raw!r} (season {season})")
        if not self._era_contains(hist, season):
            candidates = [
                m for m in self.org_members[self._terminal(hist)]
                if self._era_contains(m, season)
            ]
            if len(candidates) != 1:
                raise MatchIdentityError(
                    f"club string {raw!r} has no unambiguous identity for "
                    f"season {season}: era candidates {sorted(candidates)!r}")
            hist = candidates[0]
        self._cache[key] = hist
        return hist

    def name_of(self, hist: str) -> str:
        return self.identities[hist].name


def load_round_vote_seasons() -> set[int]:
    """Seasons allowed to carry brownlow_round_votes rows.

    stat-availability.json is the coverage authority: only seasons whose
    brownlow_round_votes coverage is complete/partial/pending may derive
    round-vote rows. 1931-1934 match votes stay in player_match_stats
    only, matching the baseline's round-vote coverage (1984+).
    """
    dataset = json.loads(AVAILABILITY_JSON.read_text(encoding="utf-8"))
    if dataset.get("status") != "READY":
        raise SnapshotValidationError(
            "data/reference/stat-availability.json is not READY")
    seasons: set[int] = set()
    for r in dataset["coverage_ranges"]:
        if (r["stat_key"] == "brownlow_round_votes"
                and r["coverage"] in ("complete", "partial", "pending")):
            seasons.update(range(r["first_season"], r["last_season"] + 1))
    return seasons


# ---------------------------------------------------------------------------
# Manifest / snapshot validation (fail closed, before any DB access)
# ---------------------------------------------------------------------------


@dataclass
class SnapshotFile:
    dataset: str
    path: Path
    season: int | None  # player_stats files only


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_snapshot(snapshot_dir: Path, manifest_path: Path,
                      label: str) -> list[SnapshotFile]:
    if not manifest_path.exists():
        raise SnapshotValidationError(f"manifest not found: {manifest_path}")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise SnapshotValidationError(f"manifest is not valid JSON: {exc}")

    if manifest.get("mode") != "acquire":
        raise SnapshotValidationError("manifest mode is not 'acquire'")
    if manifest.get("snapshot_label") != label:
        raise SnapshotValidationError(
            f"manifest snapshot_label {manifest.get('snapshot_label')!r} "
            f"does not match requested label {label!r}")
    if manifest.get("adapter_schema_version") != ADAPTER_SCHEMA_VERSION:
        raise SnapshotValidationError(
            f"unsupported adapter_schema_version "
            f"{manifest.get('adapter_schema_version')!r} "
            f"(this importer understands {ADAPTER_SCHEMA_VERSION})")

    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    pinned = contract["pinned_version"]
    if manifest.get("fitzroy_version_pinned") != pinned:
        raise SnapshotValidationError(
            f"manifest pinned fitzRoy {manifest.get('fitzroy_version_pinned')!r} "
            f"does not match the contract pin {pinned!r}")
    if manifest.get("fitzroy_version_installed") != pinned or \
            manifest.get("fitzroy_version_match") is not True:
        raise SnapshotValidationError(
            f"snapshot was acquired with fitzRoy "
            f"{manifest.get('fitzroy_version_installed')!r}, not the pinned "
            f"{pinned!r}; refusing an unpinned-source import")

    rng = manifest.get("requested_range") or {}
    range_from, range_to = rng.get("from"), rng.get("to")
    if not isinstance(range_from, int) or not isinstance(range_to, int):
        raise SnapshotValidationError("manifest requested_range is malformed")

    files: list[SnapshotFile] = []
    datasets_seen: dict[str, int] = defaultdict(int)
    for entry in manifest.get("files", []):
        dataset = entry.get("dataset")
        filename = entry.get("filename")
        if dataset not in ("player_stats", "player_details", "results"):
            raise SnapshotValidationError(f"unknown manifest dataset {dataset!r}")
        datasets_seen[dataset] += 1
        path = snapshot_dir / filename
        if not path.exists():
            raise SnapshotValidationError(f"snapshot file missing: {path}")

        actual_sha = sha256_file(path)
        if actual_sha != entry.get("sha256"):
            raise SnapshotValidationError(
                f"{filename}: SHA-256 mismatch (manifest {entry.get('sha256')!r}, "
                f"file {actual_sha!r}) — the snapshot does not match its manifest")

        with path.open(newline="", encoding="utf-8") as fh:
            reader = csv.reader(fh)
            header = next(reader, None)
            row_count = sum(1 for _ in reader)
        if header != entry.get("columns"):
            raise SnapshotValidationError(
                f"{filename}: CSV columns do not match the manifest column list")
        if row_count != entry.get("row_count"):
            raise SnapshotValidationError(
                f"{filename}: row count {row_count} does not match manifest "
                f"{entry.get('row_count')}")

        required = {"results": RESULTS_REQUIRED,
                    "player_stats": PLAYER_STATS_REQUIRED,
                    "player_details": []}[dataset]
        missing = [c for c in required if c not in header]
        if missing:
            raise SnapshotValidationError(
                f"{filename}: missing required column(s): {', '.join(missing)}")

        season = None
        if dataset == "player_stats":
            m = PLAYER_STATS_FILE.match(filename)
            if not m:
                raise SnapshotValidationError(
                    f"{filename}: player_stats filename is not player_stats_<season>.csv")
            season = int(m.group(1))
            if not range_from <= season <= range_to:
                raise SnapshotValidationError(
                    f"{filename}: season {season} outside manifest range "
                    f"{range_from}-{range_to}")
        files.append(SnapshotFile(dataset=dataset, path=path, season=season))

    if datasets_seen["results"] != 1:
        raise SnapshotValidationError(
            f"snapshot must contain exactly one results file "
            f"(found {datasets_seen['results']})")
    if datasets_seen["player_stats"] < 1:
        raise SnapshotValidationError("snapshot contains no player_stats file")
    # player_details is supplemental only (no ID/DOB/URL) and is not
    # consumed by this importer.
    return files


# ---------------------------------------------------------------------------
# Scan phase (no database)
# ---------------------------------------------------------------------------


@dataclass
class MatchFact:
    game_id: str
    season: int
    round_code: str
    round_number: int | None
    round_type: str
    match_date: date
    venue_raw: str
    home_hist: str
    away_hist: str
    home_goals: int
    home_behinds: int
    home_points: int
    away_goals: int
    away_behinds: int
    away_points: int
    # Supplement, deduplicated from player_stats rows:
    attendance: int | None = None
    match_time: str | None = None
    quarters: tuple | None = None
    has_player_rows: bool = False


@dataclass
class PlayerFact:
    afl_id: str
    given_name: str | None = None
    surname: str | None = None
    display_name: str | None = None
    urls: set = field(default_factory=set)
    dobs: dict = field(default_factory=dict)  # date -> occurrences
    bad_dob: set = field(default_factory=set)
    first_season: int | None = None
    last_season: int | None = None


def normalise_results_round(raw: str, context: str) -> tuple[str, str]:
    """results Round ("R1", "EF") -> (round_code, round_type)."""
    code = raw.strip()
    m = re.match(r"^R(\d+)$", code)
    if m:
        return m.group(1), "home_and_away"
    if code in FINALS_CODES:
        return code, FINALS_CODES[code]
    raise MatchIdentityError(f"{context}: unrecognised results round code {raw!r}")


def normalise_stats_round(raw: str, context: str) -> str:
    """player_stats Round ("1", "EF") -> round_code."""
    code = raw.strip()
    if re.match(r"^\d+$", code):
        return code
    if code in FINALS_CODES:
        return code
    raise MatchIdentityError(f"{context}: unrecognised player_stats round code {raw!r}")


def scan_results(path: Path, clubs: ClubResolver) -> dict[tuple, MatchFact]:
    matches: dict[tuple, MatchFact] = {}
    with path.open(newline="", encoding="utf-8") as fh:
        for i, row in enumerate(csv.DictReader(fh), start=2):
            context = f"results.csv line {i}"
            season = int(row["Season"])
            match_date = parse_iso_date(row["Date"], context)
            if match_date.year != season:
                raise MatchIdentityError(
                    f"{context}: date {match_date} is outside season {season}")
            round_code, round_type = normalise_results_round(row["Round"], context)
            round_number = None
            if round_type == "home_and_away":
                round_number = to_int(row["Round.Number"])
                if round_number is None or str(round_number) != round_code:
                    raise MatchIdentityError(
                        f"{context}: Round {row['Round']!r} disagrees with "
                        f"Round.Number {row['Round.Number']!r}")

            home_hist = clubs.resolve(row["Home.Team"], season)
            away_hist = clubs.resolve(row["Away.Team"], season)
            if home_hist == away_hist:
                raise MatchIdentityError(f"{context}: home and away resolve to "
                                         f"the same identity {home_hist!r}")

            values = {}
            for col in ("Home.Goals", "Home.Behinds", "Home.Points",
                        "Away.Goals", "Away.Behinds", "Away.Points", "Margin"):
                v = to_int(row[col])
                if v is None:
                    raise MatchIdentityError(f"{context}: {col} is missing")
                values[col] = v
            for side in ("Home", "Away"):
                if values[f"{side}.Points"] != 6 * values[f"{side}.Goals"] + values[f"{side}.Behinds"]:
                    raise MatchIdentityError(
                        f"{context}: {side} goals/behinds do not reconcile with points")
            if abs(values["Margin"]) != abs(values["Home.Points"] - values["Away.Points"]):
                raise MatchIdentityError(f"{context}: Margin disagrees with the scores")

            key = (match_date, home_hist, away_hist)
            if key in matches:
                raise MatchIdentityError(
                    f"{context}: duplicate match {match_date} "
                    f"{home_hist} v {away_hist}")
            venue = clean(row["Venue"])
            if venue is None:
                raise MatchIdentityError(f"{context}: Venue is missing")
            matches[key] = MatchFact(
                game_id=row["Game"].strip(), season=season,
                round_code=round_code, round_number=round_number,
                round_type=round_type, match_date=match_date, venue_raw=venue,
                home_hist=home_hist, away_hist=away_hist,
                home_goals=values["Home.Goals"], home_behinds=values["Home.Behinds"],
                home_points=values["Home.Points"], away_goals=values["Away.Goals"],
                away_behinds=values["Away.Behinds"], away_points=values["Away.Points"],
            )
    return matches


def iter_player_stats(files: list[SnapshotFile]):
    """Yield (context, season, row) across every player_stats file in order."""
    for f in sorted((f for f in files if f.dataset == "player_stats"),
                    key=lambda f: f.season):
        with f.path.open(newline="", encoding="utf-8") as fh:
            for i, row in enumerate(csv.DictReader(fh), start=2):
                yield f"{f.path.name} line {i}", f.season, row


def scan_player_stats(
    files: list[SnapshotFile],
    matches: dict[tuple, MatchFact],
    clubs: ClubResolver,
    round_vote_seasons: set[int],
) -> tuple[dict[str, PlayerFact], int, int]:
    """First streaming pass: player identity + match-grain supplements.

    Attendance, start time and quarter team scores are repeated on every
    player row of a match and are deduplicated here. For attendance a
    blank cell is no observation (0 is a real value); two distinct
    non-null values fail closed. Start time and quarter scores must
    agree exactly between rows of the same match. Also
    counts the brownlow_round_votes rows the import would derive
    (gated seasons, home-and-away, non-NA votes — a 0 counts, NA never
    does), so the plan report proves the NA/0 distinction statically.
    """
    players: dict[str, PlayerFact] = {}
    seen_player_match: set = set()
    rows_read = 0
    round_vote_rows = 0

    for context, file_season, row in iter_player_stats(files):
        rows_read += 1
        season = int(row["Season"])
        if season != file_season:
            raise SnapshotValidationError(
                f"{context}: row season {season} does not match the file season")
        match_date = parse_iso_date(row["Date"], context)
        home_hist = clubs.resolve(row["Home.team"], season)
        away_hist = clubs.resolve(row["Away.team"], season)
        key = (match_date, home_hist, away_hist)
        match = matches.get(key)
        if match is None:
            raise MatchIdentityError(
                f"{context}: no results.csv match for {match_date} "
                f"{home_hist} v {away_hist}")

        # Cross-checks against the canonical match structure.
        if match.season != season:
            raise MatchIdentityError(f"{context}: season disagrees with results.csv")
        round_code = normalise_stats_round(row["Round"], context)
        if round_code != match.round_code:
            raise MatchIdentityError(
                f"{context}: round {round_code!r} disagrees with results.csv "
                f"round {match.round_code!r}")
        home_score, away_score = to_int(row["Home.score"]), to_int(row["Away.score"])
        if home_score != match.home_points or away_score != match.away_points:
            raise MatchIdentityError(f"{context}: scores disagree with results.csv")
        venue = clean(row["Venue"])
        if venue is not None and venue != match.venue_raw:
            raise MatchIdentityError(
                f"{context}: venue {venue!r} disagrees with results.csv "
                f"{match.venue_raw!r}")

        playing_for = clubs.resolve(row["Playing.for"], season)
        if playing_for not in (home_hist, away_hist):
            raise MatchIdentityError(
                f"{context}: Playing.for {row['Playing.for']!r} is neither "
                f"side of the match")

        # Match-grain attendance: a blank cell is NO observation (not a
        # contradiction, not a 0); 0 is a legitimate recorded value. One
        # distinct non-null observation wins regardless of how many rows
        # are blank; two distinct non-null values fail closed.
        attendance = to_int(row["Attendance"])
        if attendance is not None:
            if match.attendance is not None and match.attendance != attendance:
                raise MatchIdentityError(
                    f"{context}: attendance {attendance} disagrees with "
                    f"{match.attendance} for the same match")
            match.attendance = attendance

        match_time = clean(row["Local.start.time"])
        if match.has_player_rows:
            if match.match_time != match_time:
                raise MatchIdentityError(
                    f"{context}: start time {match_time!r} disagrees with "
                    f"{match.match_time!r} for the same match")
        else:
            match.match_time = match_time

        quarters = tuple(to_int(row[c]) for c in QUARTER_COLUMNS)
        if match.has_player_rows:
            if match.quarters != quarters:
                raise MatchIdentityError(
                    f"{context}: quarter scores disagree between player rows "
                    f"of the same match")
        else:
            match.quarters = quarters
        match.has_player_rows = True

        # Player identity.
        afl_id = clean(row["ID"])
        url_path = normalise_profile_url(row["url"])
        if afl_id is None or url_path is None:
            raise PlayerIdentityError(
                f"{context}: player row has no stable ID/profile URL — "
                f"identity cannot be registered deterministically")
        pm_key = (afl_id, key)
        if pm_key in seen_player_match:
            raise MatchIdentityError(
                f"{context}: duplicate player-match row for ID {afl_id}")
        seen_player_match.add(pm_key)

        fact = players.get(afl_id)
        if fact is None:
            fact = players[afl_id] = PlayerFact(afl_id=afl_id)
        fact.urls.add(url_path)
        if len(fact.urls) > 1:
            raise PlayerIdentityError(
                f"{context}: ID {afl_id} carries multiple profile URLs "
                f"{sorted(fact.urls)!r}")
        fact.given_name = clean(row["First.name"]) or fact.given_name
        fact.surname = clean(row["Surname"]) or fact.surname
        fact.display_name = clean(row["Player"]) or fact.display_name
        raw_dob = clean(row["DOB"])
        if raw_dob is not None:
            dob = parse_dob(raw_dob)
            if dob is None:
                fact.bad_dob.add(raw_dob)
            else:
                fact.dobs[dob] = fact.dobs.get(dob, 0) + 1
        fact.first_season = season if fact.first_season is None \
            else min(fact.first_season, season)
        fact.last_season = season if fact.last_season is None \
            else max(fact.last_season, season)

        if (season in round_vote_seasons and round_code not in FINALS_CODES
                and to_int(row["Brownlow.Votes"]) is not None):
            round_vote_rows += 1

    # A profile URL must belong to exactly one ID.
    by_url: dict[str, str] = {}
    for fact in players.values():
        url = next(iter(fact.urls))
        other = by_url.get(url)
        if other is not None:
            raise PlayerIdentityError(
                f"profile URL {url!r} is claimed by IDs {other} and "
                f"{fact.afl_id} — refusing to collapse two players")
        by_url[url] = fact.afl_id
        if fact.display_name is None or fact.surname is None:
            raise PlayerIdentityError(f"ID {fact.afl_id} has no usable name")
    return players, rows_read, round_vote_rows


def match_key_of(match: MatchFact, clubs: ClubResolver) -> str:
    return "|".join([
        str(match.season), match.round_code, match.match_date.isoformat(),
        clubs.name_of(match.home_hist), clubs.name_of(match.away_hist),
    ])


def summarise(matches: dict[tuple, MatchFact], players: dict[str, PlayerFact],
              rows_read: int, round_vote_rows: int) -> dict:
    seasons = sorted({m.season for m in matches.values()})
    hists = set()
    for m in matches.values():
        hists.update((m.home_hist, m.away_hist))
    dob_players = sum(1 for p in players.values() if len(p.dobs) == 1)
    return {
        "matches": len(matches),
        "matches_with_player_rows": sum(1 for m in matches.values() if m.has_player_rows),
        "attendance_known": sum(1 for m in matches.values() if m.attendance is not None),
        "players": len(players),
        "players_with_dob": dob_players,
        "players_with_dob_conflict": sum(1 for p in players.values() if len(p.dobs) > 1),
        "player_match_rows": rows_read,
        "venues": len({m.venue_raw for m in matches.values()}),
        "seasons": f"{seasons[0]}-{seasons[-1]}" if seasons else "-",
        "club_identities": ", ".join(sorted(hists)),
        "brownlow_round_vote_rows": round_vote_rows,
    }


# ---------------------------------------------------------------------------
# Database phase
# ---------------------------------------------------------------------------


def db_preflight(pg, matches: dict[tuple, MatchFact], clubs: ClubResolver) -> dict:
    """Reference data must be loaded before the core import runs."""
    from common import scalar

    needed_hists = set()
    for m in matches.values():
        needed_hists.update((m.home_hist, m.away_hist))
    with pg.cursor() as cur:
        cur.execute("SELECT key, id FROM sources WHERE key = ANY(%s)",
                    ([SOURCE_KEY_AFLTABLES, SOURCE_KEY_FITZROY],))
        source_ids = dict(cur.fetchall())
        for key in (SOURCE_KEY_AFLTABLES, SOURCE_KEY_FITZROY):
            if key not in source_ids:
                raise fail(
                    f"sources row {key!r} is missing — run "
                    "tools/migration/load_reference_data.py first")
        cur.execute("SELECT legacy_club_hist, id FROM clubs")
        club_ids = dict(cur.fetchall())
        missing = sorted(needed_hists - set(club_ids))
        if missing:
            raise fail(
                f"clubs missing for identities {missing!r} — run "
                "tools/migration/load_reference_data.py first")
        cur.execute("SELECT year FROM seasons")
        seasons = {r[0] for r in cur.fetchall()}
        snapshot_seasons = {m.season for m in matches.values()}
        missing_seasons = sorted(snapshot_seasons - seasons)
        if missing_seasons:
            raise fail(
                f"seasons {missing_seasons!r} are not loaded — run "
                "tools/migration/load_reference_data.py first")
    if scalar(pg, "SELECT count(*) FROM clubs WHERE organization_id IS NULL"):
        raise fail("clubs have no organizations — reference load incomplete")
    return {"sources": source_ids, "clubs": club_ids}


def import_venues(pg, rep, matches: dict[tuple, MatchFact], refs: dict) -> dict[str, int]:
    """Upsert the venues the snapshot needs, keyed by the raw source name."""
    from common import import_batch

    canonical_map = json.loads(VENUES_JSON.read_text(encoding="utf-8"))["canonical_names"]
    spans: dict[str, list[int]] = {}
    for m in matches.values():
        span = spans.setdefault(m.venue_raw, [m.season, m.season])
        span[0] = min(span[0], m.season)
        span[1] = max(span[1], m.season)

    venue_ids: dict[str, int] = {}
    with import_batch(pg, SOURCE_KEY_AFLTABLES, "import_fitzroy_core.py", "venues") as batch:
        with pg.cursor() as cur:
            for legacy, (first, last) in sorted(spans.items()):
                batch.records_read += 1
                canonical = canonical_map.get(legacy, legacy)
                cur.execute("SELECT id FROM venues WHERE legacy_name = %s", (legacy,))
                row = cur.fetchone()
                if row:
                    venue_id = row[0]
                    cur.execute(
                        """UPDATE venues
                              SET first_season = LEAST(COALESCE(first_season, %s), %s),
                                  last_season  = GREATEST(COALESCE(last_season, %s), %s)
                            WHERE id = %s""",
                        (first, first, last, last, venue_id))
                    batch.records_updated += 1
                else:
                    cur.execute(
                        """INSERT INTO venues
                             (slug, canonical_name, legacy_name, first_season, last_season)
                           VALUES (%s,%s,%s,%s,%s) RETURNING id""",
                        (slugify(canonical), canonical, legacy, first, last))
                    venue_id = cur.fetchone()[0]
                    batch.records_inserted += 1
                venue_ids[legacy] = venue_id
                for alias in {legacy, canonical}:
                    cur.execute(
                        """INSERT INTO venue_aliases (venue_id, alias)
                           VALUES (%s,%s) ON CONFLICT DO NOTHING""",
                        (venue_id, alias))
        pg.commit()
    rep.result("venues", len(venue_ids))
    return venue_ids


def import_players(pg, rep, players: dict[str, PlayerFact], args, refs: dict) -> None:
    """Players + DOB evidence + AFL Tables external identities.

    Identity resolution is by profile-URL path through
    external_identities, so a re-run updates the same player rows
    instead of inserting duplicates. players.dob is fill-if-missing
    only; an existing date is never overwritten.
    """
    from common import check_population_drop, import_batch

    with pg.cursor() as cur:
        cur.execute("SELECT id FROM sources WHERE key = %s", (args.source_key,))
        row = cur.fetchone()
        if row is None:
            raise fail(f"no sources row with key {args.source_key!r}")
        afltables_id = row[0]
        cur.execute("SELECT id FROM sources WHERE key = %s", (SOURCE_KEY_FITZROY,))
        fitzroy_id = cur.fetchone()[0]

    with import_batch(pg, args.source_key, "import_fitzroy_core.py", "players") as batch:
        with pg.cursor() as cur:
            # Resolve existing players through their registered identity.
            cur.execute(
                """SELECT external_id, player_id FROM external_identities
                    WHERE source_id = %s AND match_method = %s
                      AND status IN ('unique','resolved')
                      AND player_id IS NOT NULL""",
                (afltables_id, MATCH_METHOD))
            existing_by_url = dict(cur.fetchall())

            player_ids: dict[str, int] = {}   # url path -> players.id
            touched: list[int] = []
            for fact in sorted(players.values(), key=lambda f: int(f.afl_id)):
                batch.records_read += 1
                url = next(iter(fact.urls))
                sort_name = (f"{fact.surname}, {fact.given_name}"
                             if fact.given_name else fact.surname)
                existing_id = existing_by_url.get(url)
                if existing_id is not None:
                    cur.execute(
                        """UPDATE players
                              SET display_name = %s, sort_name = %s,
                                  given_name = %s, surname = %s,
                                  debut_season = LEAST(COALESCE(debut_season, %s), %s),
                                  final_season = GREATEST(COALESCE(final_season, %s), %s)
                            WHERE id = %s""",
                        (fact.display_name, sort_name, fact.given_name,
                         fact.surname, fact.first_season, fact.first_season,
                         fact.last_season, fact.last_season, existing_id))
                    player_ids[url] = existing_id
                    batch.records_updated += 1
                else:
                    cur.execute(
                        """INSERT INTO players
                             (display_name, sort_name, search_name, slug,
                              given_name, surname, debut_season, final_season)
                           VALUES (%s,%s,'','',%s,%s,%s,%s) RETURNING id""",
                        (fact.display_name, sort_name, fact.given_name,
                         fact.surname, fact.first_season, fact.last_season))
                    player_ids[url] = cur.fetchone()[0]
                    batch.records_inserted += 1
                touched.append(player_ids[url])

            # search_name/slug derived in SQL so they can never drift from
            # the normalisation the search queries use.
            cur.execute(
                """UPDATE players
                      SET search_name = afldb_normalise_name(display_name),
                          slug = regexp_replace(afldb_normalise_name(display_name),
                                                '\\s+', '-', 'g')
                    WHERE id = ANY(%s)""", (touched,))
            cur.execute(
                """INSERT INTO player_name_aliases
                     (player_id, alias, search_alias, alias_type)
                   SELECT p.id, p.display_name, p.search_name, 'source_string'
                     FROM players p WHERE p.id = ANY(%s)
                   ON CONFLICT DO NOTHING""", (touched,))

            # 1. DOB evidence — its own source, never merged with the
            #    club-list or register evidence layers.
            evidence_rows = []
            for fact in players.values():
                url = next(iter(fact.urls))
                for dob, occurrences in sorted(fact.dobs.items()):
                    evidence_rows.append((
                        player_ids[url], fitzroy_id, url, dob,
                        DOB_EVIDENCE_TYPE, "sourced", occurrences, batch.id,
                        "fitzRoy fetch_player_stats_afltables DOB field "
                        "(canonical snapshot import).",
                    ))
            cur.executemany(
                """INSERT INTO player_birth_evidence
                     (player_id, source_id, external_id, dob, evidence_type,
                      confidence, occurrences, batch_id, notes)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (player_id, source_id, dob) DO UPDATE
                     SET occurrences = EXCLUDED.occurrences,
                         batch_id    = EXCLUDED.batch_id,
                         observed_at = now()""",
                evidence_rows)

            # 2. Fill only missing dates, from single-valued evidence.
            fill_rows = []
            dob_disagreements = 0
            internal = 0
            cur.execute("SELECT id, dob FROM players WHERE id = ANY(%s)", (touched,))
            current_dob = dict(cur.fetchall())
            for fact in players.values():
                url = next(iter(fact.urls))
                pid = player_ids[url]
                if len(fact.dobs) > 1:
                    internal += 1
                    continue
                if not fact.dobs:
                    continue
                asserted = next(iter(fact.dobs))
                existing = current_dob.get(pid)
                if existing is None:
                    fill_rows.append((asserted, asserted, asserted, asserted,
                                      pid, fitzroy_id, asserted))
                elif existing != asserted:
                    dob_disagreements += 1
            cur.executemany(
                """UPDATE players p
                      SET dob = %s, dob_confidence = 'sourced',
                          birth_year = EXTRACT(YEAR FROM %s::date)::smallint,
                          birth_year_min = EXTRACT(YEAR FROM %s::date)::smallint,
                          birth_year_max = EXTRACT(YEAR FROM %s::date)::smallint,
                          birth_year_confidence = 'sourced',
                          dob_evidence_id = e.id
                     FROM player_birth_evidence e
                    WHERE p.id = %s AND p.dob IS NULL
                      AND e.player_id = p.id AND e.source_id = %s AND e.dob = %s""",
                fill_rows)
            if internal:
                rep.warn(f"{internal} players carry conflicting DOBs inside the "
                         "snapshot; evidence recorded, no date applied")
            if dob_disagreements:
                rep.warn(f"{dob_disagreements} players disagree with an existing "
                         "AFLDB date; existing value kept, evidence recorded")

            # 3. AFL Tables external identities under the AFLDB-ISSUE-092
            #    §4 fail-closed gate. The canonical profile URL is the
            #    stable external identity: an existing row that maps an
            #    asserted URL to a DIFFERENT player is an identity HALT —
            #    abort before any reconciliation delete or upsert. No
            #    heuristic choice, no name merge, no warn-and-continue.
            identity_rows = []
            for fact in sorted(players.values(), key=lambda f: int(f.afl_id)):
                url = next(iter(fact.urls))
                identity_rows.append(
                    (afltables_id, url, f"https://afltables.com/afl/stats/{url}",
                     player_ids[url]))
            asserted_ids = [ext for _, ext, _, _ in identity_rows]
            intended = {ext: pid for _, ext, _, pid in identity_rows}
            cur.execute(
                """SELECT external_id, player_id FROM external_identities
                    WHERE source_id = %s AND external_id = ANY(%s)""",
                (afltables_id, asserted_ids))
            conflicts = [(ext, stored, intended[ext])
                         for ext, stored in cur.fetchall()
                         if stored is not None and stored != intended[ext]]
            if conflicts:
                ext, stored, wanted = conflicts[0]
                # RuntimeError: import_batch rolls back and marks failed.
                raise RuntimeError(
                    f"external-identity conflict: profile {ext!r} already "
                    f"maps to player {stored}, this import would map it to "
                    f"player {wanted} ({len(conflicts)} conflict(s) in total) "
                    f"— refusing to reconcile; resolve the identity manually "
                    f"before rerunning")
            cur.execute(
                """SELECT count(*),
                          count(*) FILTER (WHERE external_id <> ALL(%s::text[]))
                     FROM external_identities
                    WHERE source_id = %s AND match_method = %s""",
                (asserted_ids, afltables_id, MATCH_METHOD))
            stored_count, candidate_delete_count = cur.fetchone()
            check_population_drop(
                stored_count=stored_count,
                asserted_count=len(identity_rows),
                candidate_delete_count=candidate_delete_count,
                label=f"external_identities ({args.source_key}/{MATCH_METHOD})",
                acknowledged=args.acknowledge_population_drop,
                reporter=rep,
            )
            cur.execute(
                """DELETE FROM external_identities
                    WHERE source_id = %s AND match_method = %s
                      AND external_id <> ALL(%s::text[])""",
                (afltables_id, MATCH_METHOD, asserted_ids))
            cur.executemany(
                """INSERT INTO external_identities
                     (source_id, external_id, external_url, player_id, status,
                      match_method, notes)
                   VALUES (%s, %s, %s, %s, 'unique', %s,
                           'Matched on profile URL, not name.')
                   ON CONFLICT (source_id, external_id) DO UPDATE
                     SET status       = EXCLUDED.status,
                         match_method = EXCLUDED.match_method,
                         external_url = EXCLUDED.external_url
                   WHERE external_identities.player_id = EXCLUDED.player_id""",
                [(sid, ext, ext_url, pid, MATCH_METHOD)
                 for sid, ext, ext_url, pid in identity_rows])
        pg.commit()
    rep.result("players", len(players))


def load_player_map(pg, args) -> dict[str, int]:
    with pg.cursor() as cur:
        cur.execute("SELECT id FROM sources WHERE key = %s", (args.source_key,))
        row = cur.fetchone()
        if row is None:
            raise fail(f"no sources row with key {args.source_key!r}")
        cur.execute(
            """SELECT external_id, player_id FROM external_identities
                WHERE source_id = %s AND match_method = %s
                  AND status IN ('unique','resolved') AND player_id IS NOT NULL""",
            (row[0], MATCH_METHOD))
        return dict(cur.fetchall())


def import_matches(pg, rep, matches: dict[tuple, MatchFact],
                   clubs: ClubResolver, refs: dict) -> dict[tuple, int]:
    """Upsert matches by match_key; rebuild their quarter scores."""
    from common import copy_rows, import_batch

    club_ids = refs["clubs"]
    with pg.cursor() as cur:
        cur.execute("SELECT legacy_name, id FROM venues")
        venue_ids = dict(cur.fetchall())
        cur.execute("SELECT id FROM sources WHERE key = %s", (SOURCE_KEY_AFLTABLES,))
        afltables_id = cur.fetchone()[0]

    match_ids: dict[tuple, int] = {}
    with import_batch(pg, SOURCE_KEY_AFLTABLES, "import_fitzroy_core.py", "matches") as batch:
        with pg.cursor() as cur:
            for key, m in sorted(matches.items()):
                batch.records_read += 1
                home_id, away_id = club_ids[m.home_hist], club_ids[m.away_hist]
                if m.home_points > m.away_points:
                    result, winner = "home_win", home_id
                elif m.away_points > m.home_points:
                    result, winner = "away_win", away_id
                else:
                    result, winner = "draw", None
                cur.execute(
                    """INSERT INTO matches
                         (match_key, season, round_code, round_number, round_type,
                          is_final, match_date, match_time, venue_id, venue_raw,
                          home_club_id, away_club_id,
                          home_goals, home_behinds, home_score,
                          away_goals, away_behinds, away_score,
                          result, winner_club_id, margin,
                          attendance, attendance_status, attendance_source_id,
                          source_id, source_record_id, import_batch_id)
                       VALUES (%s,%s,%s,%s,%s::round_type,%s,%s,%s,%s,%s,
                               %s,%s,%s,%s,%s,%s,%s,%s,
                               %s::match_result,%s,%s,
                               %s,%s::coverage_status,%s,%s,%s,%s)
                       ON CONFLICT (match_key) DO UPDATE SET
                         round_number = EXCLUDED.round_number,
                         round_type = EXCLUDED.round_type,
                         is_final = EXCLUDED.is_final,
                         match_time = EXCLUDED.match_time,
                         venue_id = EXCLUDED.venue_id,
                         venue_raw = EXCLUDED.venue_raw,
                         home_goals = EXCLUDED.home_goals,
                         home_behinds = EXCLUDED.home_behinds,
                         home_score = EXCLUDED.home_score,
                         away_goals = EXCLUDED.away_goals,
                         away_behinds = EXCLUDED.away_behinds,
                         away_score = EXCLUDED.away_score,
                         result = EXCLUDED.result,
                         winner_club_id = EXCLUDED.winner_club_id,
                         margin = EXCLUDED.margin,
                         attendance = EXCLUDED.attendance,
                         attendance_status = EXCLUDED.attendance_status,
                         attendance_source_id = EXCLUDED.attendance_source_id,
                         source_id = EXCLUDED.source_id,
                         source_record_id = EXCLUDED.source_record_id,
                         import_batch_id = EXCLUDED.import_batch_id
                       RETURNING id, (xmax = 0)""",
                    (
                        match_key_of(m, clubs), m.season, m.round_code,
                        m.round_number, m.round_type,
                        m.round_type != "home_and_away",
                        m.match_date, m.match_time,
                        venue_ids.get(m.venue_raw), m.venue_raw,
                        home_id, away_id,
                        m.home_goals, m.home_behinds, m.home_points,
                        m.away_goals, m.away_behinds, m.away_points,
                        result, winner, abs(m.home_points - m.away_points),
                        m.attendance,
                        # Missing attendance is NOT zero: not_collected.
                        "complete" if m.attendance is not None else "not_collected",
                        afltables_id if m.attendance is not None else None,
                        afltables_id, m.game_id, batch.id,
                    ))
                row_id, inserted = cur.fetchone()
                match_ids[key] = row_id
                if inserted:
                    batch.records_inserted += 1
                else:
                    batch.records_updated += 1

            # Quarter scores: cumulative-to-date, as published; a fully
            # NULL side/period writes no row (not recorded != 0).
            cur.execute("DELETE FROM match_period_scores WHERE match_id = ANY(%s)",
                        (list(match_ids.values()),))
            period_rows = []
            for key, m in sorted(matches.items()):
                if m.quarters is None:
                    continue
                by_col = dict(zip(QUARTER_COLUMNS, m.quarters))
                for side, hist in (("H", m.home_hist), ("A", m.away_hist)):
                    for q in (1, 2, 3, 4):
                        goals = by_col[f"{side}Q{q}G"]
                        behinds = by_col[f"{side}Q{q}B"]
                        points = by_col[f"{side}Q{q}P"]
                        if goals is None and behinds is None and points is None:
                            continue
                        period_rows.append((match_ids[key], club_ids[hist],
                                            q, goals, behinds, points))
        copy_rows(pg, "match_period_scores",
                  ["match_id", "club_id", "period", "goals", "behinds", "points"],
                  period_rows)
        pg.commit()
    rep.result("matches", len(match_ids))
    rep.result("match_period_scores", len(period_rows))
    return match_ids


def load_match_map(pg, matches: dict[tuple, MatchFact],
                   clubs: ClubResolver) -> dict[tuple, int]:
    keys = {match_key_of(m, clubs): key for key, m in matches.items()}
    with pg.cursor() as cur:
        cur.execute("SELECT match_key, id FROM matches WHERE match_key = ANY(%s)",
                    (list(keys),))
        found = dict(cur.fetchall())
    missing = sorted(set(keys) - set(found))
    if missing:
        raise fail(
            f"{len(missing)} snapshot matches are not in the database "
            f"(first: {missing[0]!r}) — run the matches group first")
    return {keys[mk]: mid for mk, mid in found.items()}


def import_player_match_stats(pg, rep, files: list[SnapshotFile],
                              matches: dict[tuple, MatchFact],
                              clubs: ClubResolver, args, refs: dict) -> None:
    """Second streaming pass: the fact table, with the explicit STAT_MAP.

    Scoped delete-then-COPY: only rows belonging to this snapshot's
    matches are removed, so rows owned by other import paths (e.g. the
    current-season pipeline) are never touched.
    """
    from common import analyze, copy_rows, import_batch

    player_map = load_player_map(pg, args)
    match_map = load_match_map(pg, matches, clubs)
    club_ids = refs["clubs"]
    with pg.cursor() as cur:
        cur.execute("SELECT id FROM sources WHERE key = %s", (SOURCE_KEY_FITZROY,))
        fitzroy_id = cur.fetchone()[0]

    started = time.time()
    with import_batch(pg, SOURCE_KEY_FITZROY, "import_fitzroy_core.py",
                      "player_match_stats") as batch:
        with pg.cursor() as cur:
            cur.execute("DELETE FROM player_match_stats WHERE match_id = ANY(%s)",
                        (list(match_map.values()),))

        def build():
            for context, _season, row in iter_player_stats(files):
                batch.records_read += 1
                season = int(row["Season"])
                match_date = parse_iso_date(row["Date"], context)
                key = (match_date, clubs.resolve(row["Home.team"], season),
                       clubs.resolve(row["Away.team"], season))
                url = normalise_profile_url(row["url"])
                player_id = player_map.get(url)
                if player_id is None:
                    # RuntimeError, not SystemExit: import_batch's
                    # rollback-and-mark-failed handler catches Exception.
                    raise RuntimeError(
                        f"{context}: no registered player for {url!r} — "
                        "run the players group first")
                yield (
                    player_id, match_map[key],
                    club_ids[clubs.resolve(row["Playing.for"], season)],
                    to_int(row["Career.Games"]), clean(row["Jumper.No."]),
                    *(to_int(row[src]) for src, _ in STAT_MAP),
                    fitzroy_id, batch.id,
                )

        copy_rows(
            pg, "player_match_stats",
            ["player_id", "match_id", "club_id", "career_game_no", "jumper_number",
             *(target for _, target in STAT_MAP),
             "source_id", "import_batch_id"],
            build(), batch)
        pg.commit()
    rep.result("player_match_stats", batch.records_inserted,
               f"({time.time() - started:.1f}s)")
    analyze(pg, "player_match_stats")


def import_brownlow_round_votes(pg, rep, files: list[SnapshotFile],
                                matches: dict[tuple, MatchFact], args) -> None:
    """Derive brownlow_round_votes from the player-per-match votes.

    Home-and-away rounds only (a player plays one match per round, so
    the match grain maps 1:1 onto the round grain); NA votes produce NO
    row — never a 0. Seasons are gated by the stat-availability
    coverage authority, so e.g. the partial 1931-1934 match votes stay
    in player_match_stats without inventing round-vote coverage.
    """
    from common import copy_rows, import_batch

    gated_seasons = load_round_vote_seasons()
    player_map = load_player_map(pg, args)
    snapshot_seasons = sorted({m.season for m in matches.values()})

    with import_batch(pg, SOURCE_KEY_AFLTABLES, "import_fitzroy_core.py",
                      "brownlow_round_votes") as batch:
        rows = []
        seen: set = set()
        for context, _season, row in iter_player_stats(files):
            batch.records_read += 1
            season = int(row["Season"])
            if season not in gated_seasons:
                continue
            round_code = normalise_stats_round(row["Round"], context)
            if round_code in FINALS_CODES:
                continue  # finals are never polled
            votes = to_int(row["Brownlow.Votes"])
            if votes is None:
                continue  # NA is not 0
            url = normalise_profile_url(row["url"])
            player_id = player_map.get(url)
            if player_id is None:
                raise RuntimeError(
                    f"{context}: no registered player for {url!r} — "
                    "run the players group first")
            key = (season, player_id, int(round_code))
            if key in seen:
                raise RuntimeError(
                    f"{context}: duplicate round-vote grain {key!r}")
            seen.add(key)
            rows.append((season, player_id, int(round_code), True, votes))

        with pg.cursor() as cur:
            # This importer owns the historical round-vote population for
            # the seasons it imports; the delete is scoped to exactly
            # those seasons.
            cur.execute("DELETE FROM brownlow_round_votes WHERE season = ANY(%s)",
                        (snapshot_seasons,))
        copy_rows(pg, "brownlow_round_votes",
                  ["season", "player_id", "round_number", "played", "votes"],
                  rows, batch)
        pg.commit()
    rep.result("brownlow_round_votes", len(rows))


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

GROUPS = ["venues", "players", "matches", "stats", "brownlow"]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Import a canonical fitzRoy snapshot into AFLDB PostgreSQL.")
    parser.add_argument("--label", required=True,
                        help="snapshot label (data/sources/.../<label> + manifest)")
    parser.add_argument("--snapshot-dir",
                        help="override the snapshot directory (tests)")
    parser.add_argument("--manifest",
                        help="override the manifest path (tests)")
    parser.add_argument("--validate-only", action="store_true",
                        help="validate manifest/snapshot and print the plan; "
                             "no database connection at all")
    parser.add_argument("--dry-run", action="store_true",
                        help="validate + database preflight, write nothing")
    parser.add_argument("--groups", nargs="+", choices=GROUPS,
                        help="import only these groups (dependency order kept)")
    parser.add_argument("--source-key", default=SOURCE_KEY_AFLTABLES,
                        help="sources.key owning the external-identity population "
                             f"(default: {SOURCE_KEY_AFLTABLES}; AFLDB-ISSUE-092 §5)")
    parser.add_argument("--acknowledge-population-drop", action="store_true",
                        help="explicitly permit an external_identities drop above "
                             "the fail-closed threshold (AFLDB-ISSUE-092 §4)")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    snapshot_dir = Path(args.snapshot_dir) if args.snapshot_dir \
        else SNAPSHOT_ROOT / args.label
    manifest_path = Path(args.manifest) if args.manifest \
        else MANIFEST_ROOT / f"{args.label}.json"

    started = time.time()
    try:
        files = validate_snapshot(snapshot_dir, manifest_path, args.label)
        clubs = ClubResolver(json.loads(CLUBS_JSON.read_text(encoding="utf-8")))
        round_vote_seasons = load_round_vote_seasons()
        results_file = next(f for f in files if f.dataset == "results")
        matches = scan_results(results_file.path, clubs)
        players, rows_read, round_vote_rows = scan_player_stats(
            files, matches, clubs, round_vote_seasons)
    except (SnapshotValidationError, MatchIdentityError, PlayerIdentityError) as exc:
        raise fail(str(exc))

    summary = summarise(matches, players, rows_read, round_vote_rows)
    if not args.quiet or args.validate_only:
        print("snapshot scan summary")
        for k, v in summary.items():
            print(f"  {k:<28} {v}")

    if args.validate_only:
        print(f"\nValidation complete in {time.time() - started:.1f}s "
              "(no database access).")
        return 0

    # Database work starts here — and only here.
    from common import Reporter, connect_pg, load_env, require_env, safe_dsn

    load_env()
    rep = Reporter(verbose=not args.quiet)
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")
    print(f"\nAFLDB fitzRoy core import\n  snapshot: {snapshot_dir}\n"
          f"  target: {safe_dsn(dsn)}\n")
    pg = connect_pg(dsn)
    refs = db_preflight(pg, matches, clubs)

    if args.dry_run:
        print("  DRY RUN — preflight passed, nothing written")
        pg.close()
        return 0

    groups = [g for g in GROUPS if not args.groups or g in args.groups]
    for group in groups:
        rep.step(f"[{group}]")
        if group == "venues":
            import_venues(pg, rep, matches, refs)
        elif group == "players":
            import_players(pg, rep, players, args, refs)
        elif group == "matches":
            import_matches(pg, rep, matches, clubs, refs)
        elif group == "stats":
            import_player_match_stats(pg, rep, files, matches, clubs, args, refs)
        elif group == "brownlow":
            import_brownlow_round_votes(pg, rep, files, matches, args)

    print(f"\nCompleted in {time.time() - started:.1f}s")
    pg.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
