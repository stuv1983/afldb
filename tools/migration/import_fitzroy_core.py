#!/usr/bin/env python3
"""Import a canonical fitzRoy/AFL Tables snapshot into AFLDB PostgreSQL.

    python tools/migration/import_fitzroy_core.py --label trial-2024 --validate-only
    python tools/migration/import_fitzroy_core.py --label trial-2024 --dry-run
    python tools/migration/import_fitzroy_core.py --label trial-2024
    python tools/migration/import_fitzroy_core.py --label trial-2024 --groups matches stats

AFLDB-ISSUE-093 §13.4a — the historical/core importer of the rebuild path.

It is ALSO the offline adjudicator of an AFLDB-ISSUE-099 in-season snapshot:

    python tools/migration/import_fitzroy_core.py --label settle-2026-08-29 \
        --validate-only --require-in-season

`--require-in-season` and the historical gates (`--require-full-history`,
`--require-accepted-baseline`) adjudicate different acquisition kinds and
refuse each other explicitly. An in-season snapshot is NEVER imported by this
tool — the canonical writers here upsert with no ownership predicate and
delete by match and season, so an in-season snapshot reaches PostgreSQL only
through the reviewed settle pass.

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
# The one authority for which seasons are still being played (AFLDB-ISSUE-099). Read from
# tracked reference data, never derived from the clock.
SEASONS_JSON = REPO_ROOT / "data" / "reference" / "seasons.json"
# The acceptance/promotion register (AFLDB-ISSUE-093). Binds an accepted acquisition to its
# hashes, contract version and measured fingerprint; never a substitute for the gates.
ACCEPTED_BASELINES_PATH = REPO_ROOT / "data" / "reference" / "fitzroy-accepted-baselines.json"
VENUES_JSON = REPO_ROOT / "data" / "reference" / "venue-canonical.json"
AVAILABILITY_JSON = REPO_ROOT / "data" / "reference" / "stat-availability.json"

ADAPTER_SCHEMA_VERSION = 1

# The acquisition kinds acquire_core.R can write. AFLDB-ISSUE-099 added the third; a
# manifest predating the field is a core snapshot by construction, because no other kind
# existed when it was written.
CORE_SNAPSHOT_KIND = "core_snapshot"
VALIDATION_WITNESS_KIND = "validation_witness"
IN_SEASON_KIND = "in_season_partial"

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

#: The fitzRoy datasets a source-normalisation rule may name.
#: `ladder` is acquired as an AFLDB-ISSUE-095 VALIDATION witness only — no
#: ladder column is imported as a fact — but it still needs its own rule
#: scope, because it modernises club labels exactly as `results` does.
KNOWN_DATASETS = ("player_stats", "player_details", "results", "ladder")

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

    def __init__(self, dataset: dict, source_rules: list[dict] | None = None) -> None:
        self.identities: dict[str, ClubIdentity] = {}
        self.alias_to_hist: dict[str, str] = {}
        #: Source-scoped era normalisation, from the fitzRoy contract. Deliberately NOT an
        #: alias: these never enter alias_to_hist, so the identities they name stay
        #: non-interchangeable everywhere else. See fitzroy-contract.json
        #: source_club_normalisation.
        self.source_rules: list[dict] = list(source_rules or [])
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
        self._cache: dict[tuple[str, int, str | None], str] = {}

        # A tracked rule that does not describe a real identity, names a season range
        # outside that identity's own era, names an unknown dataset, or overlaps another
        # rule, is a defect in the contract rather than in the data — refuse it here
        # rather than let it mis-resolve silently.
        for rule in self.source_rules:
            target = rule.get("resolves_to_hist")
            if target not in self.identities:
                raise SnapshotValidationError(
                    f"source_club_normalisation names unknown identity {target!r}")
            dataset = rule.get("dataset")
            if dataset is not None and dataset not in KNOWN_DATASETS:
                raise SnapshotValidationError(
                    f"source_club_normalisation rule for {rule.get('raw')!r} names "
                    f"unknown dataset {dataset!r}")
            ident = self.identities[target]
            last = ident.last_season if ident.last_season is not None else 9999
            if not (ident.first_season <= rule["first_season"]
                    and rule["last_season"] <= last):
                raise SnapshotValidationError(
                    f"source_club_normalisation rule for {rule.get('raw')!r} covers "
                    f"{rule['first_season']}-{rule['last_season']}, outside "
                    f"{target!r}'s own era {ident.first_season}-{last}")

        for i, first in enumerate(self.source_rules):
            for second in self.source_rules[i + 1:]:
                if first["raw"] != second["raw"]:
                    continue
                # Two rules collide when they could both fire: same raw string, ranges
                # overlap, and their dataset scopes are not disjoint.
                scopes_disjoint = (first.get("dataset") is not None
                                   and second.get("dataset") is not None
                                   and first["dataset"] != second["dataset"])
                overlaps = (first["first_season"] <= second["last_season"]
                            and second["first_season"] <= first["last_season"])
                if overlaps and not scopes_disjoint:
                    raise SnapshotValidationError(
                        f"source_club_normalisation has conflicting rules for "
                        f"{first['raw']!r}: overlapping season ranges with compatible "
                        f"dataset scope")

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

    def resolve(self, raw: str, season: int, dataset: str | None = None) -> str:
        # The dataset is part of the cache key: a results-scoped correction must never
        # answer a player_stats lookup for the same string and season.
        key = (raw, season, dataset)
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        # Source-scoped era normalisation first, and ONLY for an exact raw string inside
        # an exact season range. Everything else falls through to the ordinary era rule
        # and still fails closed if that cannot name exactly one identity.
        for rule in self.source_rules:
            scope = rule.get("dataset")
            if scope is not None and scope != dataset:
                continue          # a dataset-scoped rule never leaves its dataset
            if raw == rule["raw"] and rule["first_season"] <= season <= rule["last_season"]:
                self._cache[key] = rule["resolves_to_hist"]
                return rule["resolves_to_hist"]

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


def load_round_vote_seasons(availability_path: Path | None = None) -> set[int]:
    """Seasons allowed to carry brownlow_round_votes rows.

    stat-availability.json is the coverage authority: only seasons whose
    brownlow_round_votes coverage is complete/partial/pending may derive
    round-vote rows. 1931-1934 match votes stay in player_match_stats
    only, matching the baseline's round-vote coverage (1984+).

    AFLDB-ISSUE-101: ``availability_path`` routes this at a REVIEWED SUCCESSOR
    document instead, for offline validation of a candidate rollover before any
    tracked file changes. It matters because this file decides which seasons
    derive round-vote rows, and ``brownlow_round_vote_rows`` is part of the
    measured fingerprint the acceptance register binds — so validating a
    successor acquisition against the OUTGOING availability document could
    record a fingerprint the very next run disagrees with. ``None`` keeps the
    tracked document, so every existing caller is unchanged.
    """
    path = availability_path or AVAILABILITY_JSON
    dataset = json.loads(path.read_text(encoding="utf-8"))
    if dataset.get("status") != "READY":
        raise SnapshotValidationError(f"{path} is not READY")
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


def artefact_set_digest(manifest: dict) -> str:
    """The acceptance register's second binding to the artefact set.

    Independently recomputable from the manifest's file list, so it survives insignificant
    reformatting of the manifest while still pinning every filename, content hash and row
    count. See data/reference/fitzroy-accepted-baselines.json `digest_rule`.
    """
    lines = sorted(f"{f['filename']} {f['sha256']} {f['row_count']}"
                   for f in manifest.get("files", []))
    return hashlib.sha256(("\n".join(lines) + "\n").encode("utf-8")).hexdigest()


def select_accepted_baseline(register: dict, label: str) -> dict:
    """Select THE accepted baseline. Zero and many are both refusals.

    There is no 'latest label', filename-ordering or date tiebreak: deterministic selection
    among several accepted baselines is not tracked policy, so this fails closed instead.
    """
    if register.get("contract") != "afldb.fitzroy.accepted_baselines":
        raise SnapshotValidationError(
            "acceptance register is not an afldb.fitzroy.accepted_baselines document")
    policy = (register.get("selection_policy") or {}).get("rule")
    if policy != "exactly_one_accepted":
        raise SnapshotValidationError(
            f"acceptance register declares selection policy {policy!r}, but the only "
            "policy this rebuild implements is 'exactly_one_accepted'")
    accepted = [b for b in register.get("baselines", [])
                if b.get("acceptance_status") == "accepted"]
    if not accepted:
        raise SnapshotValidationError(
            "no fitzRoy baseline is marked accepted — the rebuild has no canonical core "
            "source and will not choose one for you")
    if len(accepted) > 1:
        names = ", ".join(sorted(str(b.get("snapshot_label")) for b in accepted))
        raise SnapshotValidationError(
            f"{len(accepted)} fitzRoy baselines are marked accepted ({names}). Deterministic "
            "selection among several accepted baselines is not defined policy; mark exactly "
            "one accepted.")
    baseline = accepted[0]
    if baseline.get("snapshot_label") != label:
        raise SnapshotValidationError(
            f"snapshot label {label!r} is not the accepted baseline "
            f"({baseline.get('snapshot_label')!r}). The accepted baseline is not selected by "
            "the label passed on the command line.")
    return baseline


def verify_accepted_binding(baseline: dict, manifest_path: Path, manifest: dict,
                            contract: dict) -> dict:
    """Prove the acceptance record still points at THESE bytes under THIS contract.

    This is binding, not a verdict. It cannot make a snapshot acceptable: full-history
    enforcement is always applied alongside it, re-derived from the artefacts, and every
    artefact SHA-256 is re-verified against the manifest by validate_snapshot(). What this
    adds is that the accepted acquisition, its manifest, and the contract version the
    acceptance was granted under have not since drifted.
    """
    def refuse(what: str, expected, actual) -> None:
        raise SnapshotValidationError(
            f"accepted baseline {baseline.get('snapshot_label')!r}: {what} no longer matches "
            f"the acceptance record (accepted {expected!r}, found {actual!r}). Re-validate "
            "and re-accept deliberately; do not edit the acceptance record to fit.")

    acq = baseline.get("acquisition") or {}
    actual_manifest_sha = sha256_file(manifest_path)
    if actual_manifest_sha != acq.get("manifest_sha256"):
        refuse("the acquisition manifest's SHA-256", acq.get("manifest_sha256"),
               actual_manifest_sha)

    raw = baseline.get("raw_artefacts") or {}
    actual_digest = artefact_set_digest(manifest)
    if actual_digest != raw.get("artefact_set_sha256"):
        refuse("the artefact-set digest", raw.get("artefact_set_sha256"), actual_digest)
    entries = manifest.get("files", [])
    if len(entries) != raw.get("file_count"):
        refuse("the raw artefact count", raw.get("file_count"), len(entries))
    total_rows = sum(int(f.get("row_count") or 0) for f in entries)
    if total_rows != raw.get("total_rows"):
        refuse("the total acquired row count", raw.get("total_rows"), total_rows)

    binding = baseline.get("contract_binding") or {}
    fh = contract.get("full_history") or {}
    if binding.get("contract_version") != contract.get("contract_version"):
        refuse("the fitzRoy contract version", binding.get("contract_version"),
               contract.get("contract_version"))
    if binding.get("contract_full_history_version") != fh.get("contract_full_history_version"):
        refuse("the full-history contract version",
               binding.get("contract_full_history_version"),
               fh.get("contract_full_history_version"))
    rng = binding.get("required_range") or {}
    span = (int(fh["season_range"]["first_season"]), int(fh["season_range"]["last_season"]))
    if (rng.get("first_season"), rng.get("last_season")) != span:
        refuse("the required season range",
               (rng.get("first_season"), rng.get("last_season")), span)
    if list(binding.get("required_datasets") or []) != list(fh.get("required_datasets") or []):
        refuse("the required datasets", binding.get("required_datasets"),
               fh.get("required_datasets"))
    if acq.get("fitzroy_version_pinned") != contract.get("pinned_version"):
        refuse("the pinned fitzRoy version", acq.get("fitzroy_version_pinned"),
               contract.get("pinned_version"))
    return {
        "accepted_label": baseline.get("snapshot_label"),
        "manifest_sha256": actual_manifest_sha,
        "artefact_set_sha256": actual_digest,
        "raw_artefacts": len(entries),
        "acquired_rows": total_rows,
        "contract_version": contract.get("contract_version"),
    }


def enforce_accepted_fingerprint(baseline: dict, summary: dict, coverage: dict) -> None:
    """Compare the freshly measured snapshot against the accepted drift gates.

    Every value here was re-derived from the artefacts on this run; the acceptance record
    only says what it must equal. A mismatch means the accepted snapshot, the contract or
    the importer's transformations have changed, and acceptance no longer covers the result.
    """
    first, _, last = str(summary.get("seasons", "")).partition("-")
    observed = {
        "matches": summary.get("matches"),
        "matches_with_player_rows": summary.get("matches_with_player_rows"),
        "seasons_first": int(first) if first.isdigit() else None,
        "seasons_last": int(last) if last.isdigit() else None,
        "venues": summary.get("venues"),
        "attendance_known": summary.get("attendance_known"),
        "club_identities": len([c for c in str(summary.get("club_identities", "")).split(", ")
                                if c]),
        "players": summary.get("players"),
        "players_with_dob": summary.get("players_with_dob"),
        "players_with_dob_conflict": summary.get("players_with_dob_conflict"),
        "player_match_rows": summary.get("player_match_rows"),
        "brownlow_round_vote_rows": summary.get("brownlow_round_vote_rows"),
    }
    observed.update({k: coverage.get(k) for k in
                     ("rows", "missing_id", "missing_url", "malformed_url",
                      "distinct_ids", "distinct_urls")})
    expected = dict(baseline.get("measured") or {})
    expected.pop("$comment", None)
    scan = dict(baseline.get("identity_scan") or {})
    scan.pop("$comment", None)
    expected.update(scan)

    drift = [(k, v, observed.get(k)) for k, v in expected.items() if observed.get(k) != v]
    if drift:
        detail = "; ".join(f"{k}: accepted {exp}, measured {act}" for k, exp, act in drift)
        raise SnapshotValidationError(
            f"accepted baseline {baseline.get('snapshot_label')!r} has drifted from its "
            f"measured fingerprint ({detail}). The snapshot, contract or importer changed "
            "since acceptance; re-validate and re-accept deliberately.")


def acquisition_kind(manifest: dict) -> str:
    """The acquisition kind a manifest declares.

    Manifests written before the field existed carry none; they are core snapshots by
    construction. Absent therefore reads as `core_snapshot`, never as "unknown, allow".
    """
    return str(manifest.get("acquisition_kind") or CORE_SNAPSHOT_KIND)


def refuse_in_season_for_historical(manifest: dict, gate: str) -> None:
    """AFLDB-ISSUE-099 §10.1 — an in-season partial can never satisfy a historical gate.

    Explicit, and ON TOP OF the existing range check rather than instead of it: it runs
    first so the refusal names the real reason. An in-season snapshot is a partial
    observation of a season still being played, so admitting one to the full-history gates
    or to the accepted-baseline register would weaken the historical fail-closed contract.
    """
    if acquisition_kind(manifest) == IN_SEASON_KIND:
        raise SnapshotValidationError(
            f"{manifest.get('snapshot_label')!r} is an {IN_SEASON_KIND} acquisition and can "
            f"NEVER satisfy {gate}. An in-season snapshot is a partial observation of a "
            "season still in progress; validate it with --require-in-season instead.")


def load_in_progress_seasons() -> set[int]:
    """The seasons AFLDB declares still in progress (AFLDB-ISSUE-099)."""
    if not SEASONS_JSON.exists():
        raise SnapshotValidationError(f"season register not found: {SEASONS_JSON}")
    data = json.loads(SEASONS_JSON.read_text(encoding="utf-8"))
    seasons = data.get("in_progress_seasons")
    if not isinstance(seasons, list) or not seasons:
        raise SnapshotValidationError(
            f"{SEASONS_JSON} declares no in_progress_seasons, so no season may be "
            "validated in-season")
    return {int(s) for s in seasons}


def measure_identity_coverage(entries: list[dict], snapshot_dir: Path,
                              id_rule: dict) -> dict:
    """Measure player identity coverage across the snapshot's player_stats artefacts.

    ONE implementation, shared by the full-history and in-season gates. import_fitzroy_core
    builds players ONLY from player_stats and fails closed on a row with no url, so this is
    measured BEFORE any import runs rather than discovered part-way through one. Names are
    never consulted.

    The canonical durable identity is the AFL Tables profile URL — that is what
    external_identities stores and what players are resolved by. The fitzRoy numeric ID
    never reaches a database column, so its ABSENCE is tolerated; a malformed or missing
    URL is not, and a name is never a fallback. (AFLDB-ISSUE-099 §2.1 measured 82 rows with
    no ID and zero rows with no url in the 2026 in-season population, which is why the
    in-season contract declares ID enrichment-only.)
    """
    url_shape = re.compile(id_rule.get("profile_url_shape", r"^https?://\S+$"))
    coverage = {"rows": 0, "missing_id": 0, "missing_url": 0, "malformed_url": 0,
                "distinct_ids": 0, "distinct_urls": 0}
    ids: set[str] = set()
    urls: set[str] = set()
    for entry in entries:
        if entry.get("dataset") != "player_stats":
            continue
        path = snapshot_dir / entry["filename"]
        with path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                coverage["rows"] += 1
                player_id = (row.get("ID") or "").strip()
                url = (row.get("url") or "").strip()
                if not player_id:
                    coverage["missing_id"] += 1
                else:
                    ids.add(player_id)
                if not url:
                    coverage["missing_url"] += 1
                else:
                    urls.add(url)
                    if not url_shape.match(url):
                        coverage["malformed_url"] += 1
    coverage["distinct_ids"] = len(ids)
    coverage["distinct_urls"] = len(urls)

    if coverage["missing_url"] or coverage["malformed_url"]:
        raise SnapshotValidationError(
            f"identity incomplete: {coverage['missing_url']} row(s) without a profile URL "
            f"and {coverage['malformed_url']} with a non-canonical one. The profile URL is "
            "the durable identity and is never inferred from a name.")
    return coverage


def enforce_in_season(manifest: dict, snapshot_dir: Path, contract: dict) -> dict:
    """Prove a snapshot is a valid IN-SEASON partial (AFLDB-ISSUE-099 §10.1).

    The mirror image of enforce_full_history, and the in-season path's one adjudicator: the
    manifest's own claim is never taken on trust, every gate is re-derived here from the
    contract's `in_season` block, data/reference/seasons.json and the artefacts, and
    acquire_core.R remains a recorder rather than a judge.

    This gate is deliberately NOT a relaxed full-history gate. It is a different, narrower
    contract for a different kind of snapshot, and it refuses anything that is not an
    in_season_partial acquisition just as the historical gates refuse anything that is.

    Returns the measured identity coverage so the caller can report it.
    """
    ins = contract.get("in_season")
    if not ins:
        raise SnapshotValidationError(
            "the fitzRoy contract carries no in_season block, so no snapshot can be "
            "validated as an in-season partial")

    kind = acquisition_kind(manifest)
    if kind != IN_SEASON_KIND:
        raise SnapshotValidationError(
            f"acquisition_kind {kind!r} is not {IN_SEASON_KIND!r}: --require-in-season "
            "adjudicates in-season partials ONLY. A core snapshot is validated with "
            "--require-full-history, and a validation witness by its own validator.")

    rng = manifest.get("requested_range") or {}
    first, last = rng.get("from"), rng.get("to")
    if not isinstance(first, int) or not isinstance(last, int) or first != last:
        raise SnapshotValidationError(
            f"an in-season snapshot covers exactly one season, but requested_range is "
            f"{first}-{last}")
    season = first

    in_progress = load_in_progress_seasons()
    if season not in in_progress:
        raise SnapshotValidationError(
            f"season {season} is not declared in progress by "
            f"data/reference/seasons.json (in_progress_seasons: "
            f"{', '.join(str(s) for s in sorted(in_progress))}). A completed season is "
            "validated as a core snapshot, never in-season.")

    entries = manifest.get("files", [])
    datasets_present = {e.get("dataset") for e in entries}
    missing_datasets = [d for d in (ins.get("required_datasets") or [])
                        if d not in datasets_present]
    if missing_datasets:
        raise SnapshotValidationError(
            f"missing required dataset(s): {', '.join(missing_datasets)}")
    allowed = list(ins.get("allowed_datasets") or [])
    extra = sorted(str(d) for d in datasets_present if d not in allowed)
    if extra:
        raise SnapshotValidationError(
            f"dataset(s) not permitted in an in-season snapshot: {', '.join(extra)} "
            f"(allowed: {', '.join(allowed)})")

    seasons: list[int] = []
    for entry in entries:
        if entry.get("dataset") != "player_stats":
            continue
        match = PLAYER_STATS_FILE.match(entry.get("filename", ""))
        if match:
            seasons.append(int(match.group(1)))
    if sorted(seasons) != [season]:
        found = ", ".join(str(s) for s in sorted(seasons)) or "none"
        raise SnapshotValidationError(
            f"an in-season snapshot needs exactly one player_stats artefact, for season "
            f"{season}; found {found}")

    empty = [e.get("filename") for e in entries if not e.get("row_count")]
    if empty:
        raise SnapshotValidationError(
            f"artefact(s) with zero rows: {', '.join(str(f) for f in empty[:5])}")

    return measure_identity_coverage(entries, snapshot_dir,
                                     ins.get("identity_requirement", {}))


def enforce_full_history(manifest: dict, snapshot_dir: Path, contract: dict) -> dict:
    """Prove a snapshot has EARNED `full_history: true` (AFLDB-ISSUE-093).

    The manifest's own claim is never taken on trust: every gate is re-derived here from
    the contract and the artefacts, so a hand-edited flag, a renamed label or a partial
    acquisition cannot pass. `full_history` is a measured conclusion, not an assertion.

    Returns the measured identity coverage so the caller can report it.
    """
    fh = contract.get("full_history")
    if not fh:
        raise SnapshotValidationError(
            "the fitzRoy contract carries no full_history block, so no snapshot can be "
            "validated as full history")

    # AFLDB-ISSUE-099 §10.1: explicit, and BEFORE the range check, so an in-season partial
    # is refused for what it is rather than incidentally for the range it covers.
    refuse_in_season_for_historical(manifest, "--require-full-history")

    # The manifest's own `full_history` field is NOT consulted as a verdict. The first
    # full-history acquisition published `full_history: true` while this validator
    # rejected the snapshot, because the acquirer implemented a smaller gate set. There is
    # now one adjudicator — this function — and it re-derives every gate below.
    if manifest.get("snapshot_label") in (fh.get("known_trial_labels") or []):
        raise SnapshotValidationError(
            f"{manifest.get('snapshot_label')!r} is a known trial label and can never "
            "satisfy full-history mode, whatever its manifest claims.")

    first = int(fh["season_range"]["first_season"])
    last = int(fh["season_range"]["last_season"])
    gaps = {int(s) for s in (fh.get("approved_source_gaps", {}).get("seasons") or [])}
    required_seasons = {s for s in range(first, last + 1) if s not in gaps}

    rng = manifest.get("requested_range") or {}
    if rng.get("from") != first or rng.get("to") != last:
        raise SnapshotValidationError(
            f"requested_range {rng.get('from')}-{rng.get('to')} does not equal the "
            f"contract's required range {first}-{last}")

    entries = manifest.get("files", [])
    datasets_present = {e.get("dataset") for e in entries}
    missing_datasets = [d for d in fh["required_datasets"] if d not in datasets_present]
    if missing_datasets:
        raise SnapshotValidationError(
            f"missing required dataset(s): {', '.join(missing_datasets)}")

    seasons: list[int] = []
    for entry in entries:
        if entry.get("dataset") != "player_stats":
            continue
        match = PLAYER_STATS_FILE.match(entry.get("filename", ""))
        if match:
            seasons.append(int(match.group(1)))
    duplicates = sorted({s for s in seasons if seasons.count(s) > 1})
    if duplicates:
        raise SnapshotValidationError(
            f"duplicate player_stats artefact(s) for season(s): "
            f"{', '.join(str(s) for s in duplicates[:10])}")

    missing = sorted(required_seasons - set(seasons))
    if missing:
        raise SnapshotValidationError(
            f"{len(missing)} required season(s) absent from the snapshot, and none is an "
            f"approved source gap (first missing: {missing[0]}). A source failure is "
            "terminal, never an absence.")
    outside = sorted(s for s in seasons if not first <= s <= last)
    if outside:
        raise SnapshotValidationError(
            f"season(s) outside the required range: {', '.join(str(s) for s in outside[:10])}")

    empty = [e.get("filename") for e in entries if not e.get("row_count")]
    if empty:
        raise SnapshotValidationError(
            f"artefact(s) with zero rows: {', '.join(str(f) for f in empty[:5])}")

    # Identity coverage, measured by the one shared implementation.
    return measure_identity_coverage(entries, snapshot_dir,
                                     fh.get("identity_requirement", {}))


def validate_snapshot(snapshot_dir: Path, manifest_path: Path,
                      label: str,
                      contract_path: Path | None = None) -> list[SnapshotFile]:
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

    contract = json.loads((contract_path or CONTRACT_PATH).read_text(encoding="utf-8"))
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
# AFLDB-ISSUE-099 — record-error policy and the observation-bundle contract
#
# Everything in this section is DB-FREE by construction: it reads the acquired CSVs and
# the tracked contracts, and writes one JSON file. Observation persistence, reconciliation,
# promotion candidates and every canonical mutation belong to TypeScript.
# ---------------------------------------------------------------------------

#: Default. One bad record aborts the whole pass — correct for a clean rebuild, where a
#: partial import is worse than no import.
ON_RECORD_ERROR_ABORT = "abort"
#: Opt-in, in-season only. A bad record is COLLECTED and the pass continues, because a
#: nightly settle must not be killed by one malformed row (AFLDB-ISSUE-099 F6).
ON_RECORD_ERROR_REJECT = "reject"

BUNDLE_CONTRACT_VERSION = 1
FAMILY_MATCH = "afltables.match"
FAMILY_PLAYER_MATCH = "afltables.player_match_stats"

#: The declared payload column set of `afltables.match`. The payload is the SOURCE
#: observation: raw club and venue strings, the source's own round vocabulary, and the
#: match-grain supplements AFL Tables repeats on every player row. Resolved identities
#: live in the projection, never here.
MATCH_PAYLOAD_COLUMNS = (
    "season", "round_code", "round_number", "round_type", "match_date",
    "venue_raw", "home_team_raw", "away_team_raw",
    "home_goals", "home_behinds", "home_points",
    "away_goals", "away_behinds", "away_points", "margin",
    "attendance", "match_time", "period_scores",
)

#: The declared payload column set of `afltables.player_match_stats`. The statistic keys
#: are STAT_MAP's TARGET names, so the one mapping authority is reused rather than a
#: second naming policy being invented (AFLDB-ISSUE-099 §17.3).
PLAYER_MATCH_PAYLOAD_COLUMNS = (
    "url", "afltables_id", "season", "round_code", "match_key",
    "playing_for_raw", "jumper_number", "career_games",
    "first_name", "surname", "player_name", "dob",
    *(target for _, target in STAT_MAP),
)


@dataclass
class RecordRejection:
    """One source record that was OBSERVED but could not be interpreted.

    `external_record_id` is None when no stable key could be established at all. That case
    is materially different (AFLDB-ISSUE-099 §19): the record's PRESENCE cannot be
    represented, so the affected (family, scope_key) is not safe for absence sweeping and
    the bundle marks its enumeration incomplete.
    """
    family: str
    scope_key: str
    external_record_id: str | None
    reason: str
    detail: str


class RecordErrorPolicy:
    """What happens when one source record cannot be interpreted.

    Under `abort` (the default) the original exception is re-raised, so the historical
    rebuild path behaves exactly as it did before this class existed. Under `reject` the
    failure is collected and the pass continues.

    A rejected record is NEVER an absent record. It was observed; only its projection
    failed. The bundle emitter enumerates presence independently of projection, and this
    object is what tells it which observed records did not project and why.
    """

    def __init__(self, mode: str = ON_RECORD_ERROR_ABORT, scope_key: str = "") -> None:
        if mode not in (ON_RECORD_ERROR_ABORT, ON_RECORD_ERROR_REJECT):
            raise SnapshotValidationError(
                f"unknown --on-record-error policy {mode!r}")
        self.mode = mode
        self.scope_key = scope_key
        self.rejections: list[RecordRejection] = []
        #: url -> reason, for identity contradictions that are only decidable once every
        #: row has been read (a player with no usable name; one fitzRoy ID under two
        #: profile URLs). Their records are enumerated and never projected.
        self.unusable_players: dict[str, str] = {}
        #: The player-match grain keys that were ACCEPTED. A second row carrying an
        #: identity that already succeeded is a duplicate, and rejecting the duplicate
        #: must not retract the record the first row legitimately produced.
        self.accepted_player_match: set = set()

    @property
    def collecting(self) -> bool:
        return self.mode == ON_RECORD_ERROR_REJECT

    def reject(self, exc: Exception, *, family: str, external_record_id: str | None,
               reason: str) -> None:
        """Collect a per-record failure, or re-raise it under the abort policy."""
        if not self.collecting:
            raise exc
        self.rejections.append(RecordRejection(
            family=family, scope_key=self.scope_key,
            external_record_id=external_record_id, reason=reason, detail=str(exc)))

    def refuse_player(self, exc: Exception, url: str, reason: str) -> None:
        """Collect an aggregate player-identity contradiction, or re-raise it."""
        if not self.collecting:
            raise exc
        self.unusable_players.setdefault(url, f"{reason}: {exc}")

    def keyed(self, family: str) -> dict[str, RecordRejection]:
        return {r.external_record_id: r for r in self.rejections
                if r.family == family and r.external_record_id is not None}

    def unkeyed(self, family: str) -> list[RecordRejection]:
        return [r for r in self.rejections
                if r.family == family and r.external_record_id is None]


def reason_for(exc: Exception) -> str:
    """A stable machine reason code for a per-record interpretation failure."""
    if isinstance(exc, PlayerIdentityError):
        return "player_identity"
    if isinstance(exc, MatchIdentityError):
        return "match_identity"
    return "record_invalid"


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
    #: The fitzRoy numeric id. Grouping/provenance ONLY — never written to any column,
    #: and legitimately absent for a handful of recent players (see scan_player_stats).
    afl_id: str | None
    #: The durable canonical identity: the normalised AFL Tables profile path.
    url: str = ""
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


def results_identity(row: dict, clubs: ClubResolver) -> dict | None:
    """The stable source identity of a results row, established WITHOUT projecting it.

    AFLDB-ISSUE-099 §19: presence and projection are separate facts and are carried
    separately. A row whose scores do not reconcile still has an identity and is therefore
    still PRESENT; a row whose season, date, round or club strings cannot be read has no
    provable identity at all, and its presence cannot be represented — that is what forces
    the affected enumeration incomplete rather than letting it be swept as absent.

    The key is byte-identical to `match_key_of()`, so one match observation has one identity
    whichever side of the pass produced it.
    """
    try:
        season = int(row["Season"])
        match_date = parse_iso_date(row["Date"], "identity")
        round_code, round_type = normalise_results_round(row["Round"], "identity")
        home_hist = clubs.resolve(row["Home.Team"], season, "results")
        away_hist = clubs.resolve(row["Away.Team"], season, "results")
    except (MatchIdentityError, SnapshotValidationError, ValueError, TypeError, KeyError):
        return None
    return {
        "season": season, "match_date": match_date,
        "round_code": round_code, "round_type": round_type,
        "home_hist": home_hist, "away_hist": away_hist,
        "external_record_id": "|".join([
            str(season), round_code, match_date.isoformat(),
            clubs.name_of(home_hist), clubs.name_of(away_hist),
        ]),
    }


def scan_results(path: Path, clubs: ClubResolver,
                 policy: "RecordErrorPolicy | None" = None) -> dict[tuple, MatchFact]:
    matches: dict[tuple, MatchFact] = {}
    with path.open(newline="", encoding="utf-8") as fh:
        for i, row in enumerate(csv.DictReader(fh), start=2):
            context = f"results.csv line {i}"
            try:
                key, fact = interpret_results_row(row, context, clubs, matches)
            except (MatchIdentityError, SnapshotValidationError, ValueError) as exc:
                # Under the default abort policy this re-raises, unchanged.
                identity = results_identity(row, clubs)
                policy_or_abort(policy).reject(
                    exc, family=FAMILY_MATCH, reason=reason_for(exc),
                    external_record_id=(identity or {}).get("external_record_id"))
                continue
            matches[key] = fact
    return matches


def policy_or_abort(policy: "RecordErrorPolicy | None") -> "RecordErrorPolicy":
    """The supplied policy, or a fresh abort policy that re-raises."""
    return policy if policy is not None else RecordErrorPolicy(ON_RECORD_ERROR_ABORT)


def interpret_results_row(row: dict, context: str, clubs: ClubResolver,
                          seen: dict[tuple, MatchFact]) -> tuple[tuple, MatchFact]:
    """Interpret one results row into its key and MatchFact, or raise.

    Extracted from scan_results() without changing a check, a message or the order they
    run in, so the historical path fails on exactly the same row for exactly the same
    reason. The extraction exists so one bad record can be REJECTED rather than aborting
    the pass, and for no other purpose.
    """
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

    home_hist = clubs.resolve(row["Home.Team"], season, "results")
    away_hist = clubs.resolve(row["Away.Team"], season, "results")
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
    if key in seen:
        raise MatchIdentityError(
            f"{context}: duplicate match {match_date} "
            f"{home_hist} v {away_hist}")
    venue = clean(row["Venue"])
    if venue is None:
        raise MatchIdentityError(f"{context}: Venue is missing")
    return key, MatchFact(
        game_id=row["Game"].strip(), season=season,
        round_code=round_code, round_number=round_number,
        round_type=round_type, match_date=match_date, venue_raw=venue,
        home_hist=home_hist, away_hist=away_hist,
        home_goals=values["Home.Goals"], home_behinds=values["Home.Behinds"],
        home_points=values["Home.Points"], away_goals=values["Away.Goals"],
        away_behinds=values["Away.Behinds"], away_points=values["Away.Points"],
    )


def load_row_corrections(contract_path: Path | None = None) -> list[dict]:
    """Tracked per-row source corrections from the fitzRoy contract (may be empty).

    ``contract_path`` defaults to the tracked contract (AFLDB-ISSUE-101).
    """
    contract = json.loads((contract_path or CONTRACT_PATH).read_text(encoding="utf-8"))
    return list(contract.get("source_row_corrections", {}).get("rules", []))


def iter_player_stats(files: list[SnapshotFile], corrections: list[dict] | None = None):
    """Yield (context, season, row) across every player_stats file in order.

    Applies the tracked `source_row_corrections` (AFLDB-ISSUE-093). A rule names one
    artefact, one exact set of field values and how many rows must match; a matching row
    is dropped and nothing else is touched. Every rule must match EXACTLY its
    ``expect_rows``, so if a later fitzRoy release fixes the defect upstream — or the
    acquisition differs in any way — the count is wrong and the import fails visibly
    instead of silently double-correcting or silently doing nothing. Identity is never
    inferred here: a rule matches raw field values, never a name.
    """
    # A rule is IN SCOPE only when the artefact it names is part of this snapshot. A
    # snapshot that does not contain that file is simply not the one the correction was
    # written against — a trial covering 2024 must not be refused because a 1909
    # correction found nothing to do.
    present = {f.path.name for f in files if f.dataset == "player_stats"}
    rules = [r for r in (corrections or []) if r.get("file") in present]
    applied: dict[str, int] = {rule["id"]: 0 for rule in rules}

    for f in sorted((f for f in files if f.dataset == "player_stats"),
                    key=lambda f: f.season):
        file_rules = [r for r in rules
                      if r.get("dataset") == "player_stats"
                      and r.get("file") == f.path.name]
        with f.path.open(newline="", encoding="utf-8") as fh:
            for i, row in enumerate(csv.DictReader(fh), start=2):
                dropped = False
                for rule in file_rules:
                    if all(row.get(k) == v for k, v in rule["fingerprint"].items()):
                        if rule.get("action") != "drop_row":
                            raise SnapshotValidationError(
                                f"unknown source_row_corrections action "
                                f"{rule.get('action')!r} in rule {rule['id']!r}")
                        applied[rule["id"]] += 1
                        dropped = True
                        break
                if not dropped:
                    yield f"{f.path.name} line {i}", f.season, row

    for rule in rules:
        expected = rule.get("expect_rows")
        actual = applied[rule["id"]]
        if actual != expected:
            raise SnapshotValidationError(
                f"source_row_corrections rule {rule['id']!r} expected to match "
                f"{expected} row(s) but matched {actual}. The acquired bytes no longer "
                f"match the evidence this correction was written against — if the source "
                f"has been fixed upstream, remove the rule deliberately; do not let a "
                f"correction apply to data it was not reviewed for.")


def player_match_identity(row: dict, clubs: ClubResolver,
                          matches: dict[tuple, MatchFact]) -> dict | None:
    """The stable source identity of a player_stats row, WITHOUT projecting it.

    AFLDB-ISSUE-099 §6.1: `<normalised profile url path>@<match_key>`. Both halves must be
    provable — a row with no `url`, or one whose results join fails so there is no
    match_key, has no representable presence at all. Returning None is what forces the
    affected enumeration incomplete rather than allowing a later absence sweep to conclude
    the record disappeared (§19, stop condition SC5).

    `ID` is never consulted: it is enrichment, and 82 in-season rows carry none (P5).
    """
    url_path = normalise_profile_url(row.get("url"))
    if url_path is None:
        return None
    try:
        season = int(row["Season"])
        match_date = parse_iso_date(row["Date"], "identity")
        key = (match_date,
               clubs.resolve(row["Home.team"], season, "player_stats"),
               clubs.resolve(row["Away.team"], season, "player_stats"))
    except (MatchIdentityError, SnapshotValidationError, ValueError, TypeError, KeyError):
        return None
    match = matches.get(key)
    if match is None:
        return None
    return {
        "url": url_path, "match": match, "match_key": match_key_of(match, clubs),
        "external_record_id": f"{url_path}@{match_key_of(match, clubs)}",
    }


def scan_player_stats(
    files: list[SnapshotFile],
    matches: dict[tuple, MatchFact],
    clubs: ClubResolver,
    round_vote_seasons: set[int],
    corrections: list[dict] | None = None,
    policy: "RecordErrorPolicy | None" = None,
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

    for context, file_season, row in iter_player_stats(files, corrections):
        rows_read += 1
        # Every check below runs in exactly the order it did before, so the historical path
        # still fails on the same row for the same reason. The ONLY change is that the
        # match-grain mutations are deferred to the commit block after the last check, so a
        # record REJECTED under --on-record-error reject leaves no partial trace behind.
        try:
            season = int(row["Season"])
            if season != file_season:
                raise SnapshotValidationError(
                    f"{context}: row season {season} does not match the file season")
            match_date = parse_iso_date(row["Date"], context)
            home_hist = clubs.resolve(row["Home.team"], season, "player_stats")
            away_hist = clubs.resolve(row["Away.team"], season, "player_stats")
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

            playing_for = clubs.resolve(row["Playing.for"], season, "player_stats")
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

            match_time = clean(row["Local.start.time"])
            if match.has_player_rows and match.match_time != match_time:
                raise MatchIdentityError(
                    f"{context}: start time {match_time!r} disagrees with "
                    f"{match.match_time!r} for the same match")

            quarters = tuple(to_int(row[c]) for c in QUARTER_COLUMNS)
            if match.has_player_rows and match.quarters != quarters:
                raise MatchIdentityError(
                    f"{context}: quarter scores disagree between player rows "
                    f"of the same match")

            # Player identity.
            #
            # The AFL Tables profile URL is the durable canonical identity: it is what
            # external_identities stores and what players are resolved by. The fitzRoy
            # numeric `ID` never reaches a database column at all — it is
            # grouping/provenance only — so identity is keyed on the URL and `ID` is
            # optional.
            #
            # Measured on the 1897-2025 acquisition (685,473 rows): 83 rows across 5
            # players, all in 2025, carry a canonical URL and NO ID, and there is not one
            # URL with two IDs or one ID with two URLs anywhere in the source. Requiring
            # both would discard five real players and their matches for a column the
            # schema never keeps. AFLDB-ISSUE-099 §2.1 re-measured the same shape
            # in-season: 82 rows, 5 urls, 0 missing urls.
            afl_id = clean(row["ID"])
            url_path = normalise_profile_url(row["url"])
            if url_path is None:
                raise PlayerIdentityError(
                    f"{context}: player row has no profile URL — identity cannot be "
                    f"registered deterministically, and a name is never identity")
            pm_key = (url_path, key)
            if pm_key in seen_player_match:
                raise MatchIdentityError(
                    f"{context}: duplicate player-match row for {url_path}")
        except (MatchIdentityError, PlayerIdentityError,
                SnapshotValidationError, ValueError) as exc:
            # Under the default abort policy this re-raises, unchanged.
            identity = player_match_identity(row, clubs, matches)
            policy_or_abort(policy).reject(
                exc, family=FAMILY_PLAYER_MATCH, reason=reason_for(exc),
                external_record_id=(identity or {}).get("external_record_id"))
            continue

        # ---- commit: the record is accepted, so the match-grain supplements it carries
        # may now be absorbed. Nothing above this line mutates shared state.
        if attendance is not None:
            match.attendance = attendance
        if not match.has_player_rows:
            match.match_time = match_time
            match.quarters = quarters
        match.has_player_rows = True
        seen_player_match.add(pm_key)
        if policy is not None:
            policy.accepted_player_match.add(pm_key)

        fact = players.get(url_path)
        if fact is None:
            fact = players[url_path] = PlayerFact(afl_id=afl_id, url=url_path)
        # A populated ID is still held to 1:1 with the URL; only its ABSENCE is tolerated.
        if afl_id is not None:
            if fact.afl_id is None:
                fact.afl_id = afl_id
            elif fact.afl_id != afl_id:
                raise PlayerIdentityError(
                    f"{context}: profile URL {url_path} carries conflicting IDs "
                    f"{fact.afl_id} and {afl_id} — refusing to guess which player this is")
        fact.urls.add(url_path)
        fact.given_name = clean(row["First.name"]) or fact.given_name
        fact.surname = clean(row["Surname"]) or fact.surname
        # `Player` is the source's own convenience concatenation of First.name and
        # Surname, and fitzRoy leaves it blank for a handful of recent players whose
        # structured name fields ARE present (measured: 79 rows, 4 players, all 2025).
        # Rebuilding it from those fields uses only data already read on this row — no
        # inference, no name matching, no second naming policy — and a non-blank `Player`
        # always wins. If both components are absent the row still fails closed below.
        display = clean(row["Player"])
        if display is None:
            first, last = clean(row["First.name"]), clean(row["Surname"])
            if first and last:
                display = f"{first} {last}"
        fact.display_name = display or fact.display_name
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

    # Identity is now keyed on the URL, so one URL cannot reach two players by
    # construction. The remaining contradiction to catch is the other direction: one
    # fitzRoy ID appearing under two different profile URLs, which would mean the source
    # disagrees with itself about who someone is.
    #
    # These are AGGREGATE contradictions: they are only decidable once every row has been
    # read, so they cannot be rejected per record inside the loop. Under `abort` they raise
    # exactly as before. Under `reject` they mark the player unusable, and the bundle
    # emitter refuses to PROJECT that player's records while still ENUMERATING them — the
    # §19 rule that an observed record is never turned into an absent one.
    sink = policy_or_abort(policy)
    by_id: dict[str, str] = {}
    for url, fact in players.items():
        if fact.afl_id is not None:
            other = by_id.get(fact.afl_id)
            if other is not None:
                exc = PlayerIdentityError(
                    f"fitzRoy ID {fact.afl_id} is claimed by profile URLs {other!r} and "
                    f"{url!r} — refusing to collapse two players")
                sink.refuse_player(exc, url, "identity_conflict")
                sink.refuse_player(exc, other, "identity_conflict")
            else:
                by_id[fact.afl_id] = url
        if fact.display_name is None or fact.surname is None:
            # Names are display payload, never identity — but a player row with no name
            # at all means the source row was not what it claimed to be.
            sink.refuse_player(PlayerIdentityError(f"{url} has no usable name"),
                               url, "no_usable_name")
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
# AFLDB-ISSUE-099 — observation-bundle emission (still no database)
#
# The bundle is the ONE boundary between Python's AFL Tables interpretation and
# TypeScript's migration-074 persistence. Python owns everything above it: club and player
# identity, the attendance dedupe, the quarter/score reconciliation, NULL/NA semantics and
# the stable external keys. Python owns NOTHING below it: no observation is persisted, no
# reconciliation verb is computed, no promotion candidate is created and no canonical row
# is ever touched here.
# ---------------------------------------------------------------------------


def period_scores_of(quarters: tuple | None) -> list[dict] | None:
    """The 24 QUARTER_COLUMNS as typed period rows, NULLs preserved.

    Cumulative-to-date, exactly as AFL Tables publishes them and exactly as the historical
    importer writes them. Periods 1-4 only: fitzRoy carries extra-time columns and the
    historical path deliberately does not import them, so neither does this.
    """
    if quarters is None:
        return None
    rows: list[dict] = []
    index = 0
    for side in ("home", "away"):
        for period in (1, 2, 3, 4):
            goals, behinds, points = quarters[index:index + 3]
            index += 3
            rows.append({"side": side, "period": period, "goals": goals,
                         "behinds": behinds, "points": points})
    return rows


def match_payload(row: dict, identity: dict, fact: "MatchFact | None") -> dict:
    """The `afltables.match` payload: the SOURCE observation, NULLs preserved.

    Raw club and venue strings, the source's own round vocabulary, and the match-grain
    supplements AFL Tables repeats on every player row. A blank cell stays None — never 0.
    """
    round_number = to_int(row.get("Round.Number")) \
        if identity["round_type"] == "home_and_away" else None
    return {
        "season": identity["season"],
        "round_code": identity["round_code"],
        "round_number": round_number,
        "round_type": identity["round_type"],
        "match_date": identity["match_date"].isoformat(),
        "venue_raw": clean(row.get("Venue")),
        "home_team_raw": clean(row.get("Home.Team")),
        "away_team_raw": clean(row.get("Away.Team")),
        "home_goals": to_int(row.get("Home.Goals")),
        "home_behinds": to_int(row.get("Home.Behinds")),
        "home_points": to_int(row.get("Home.Points")),
        "away_goals": to_int(row.get("Away.Goals")),
        "away_behinds": to_int(row.get("Away.Behinds")),
        "away_points": to_int(row.get("Away.Points")),
        "margin": to_int(row.get("Margin")),
        # Supplements exist only once a player row has been joined to the match.
        "attendance": fact.attendance if fact is not None else None,
        "match_time": fact.match_time if fact is not None else None,
        "period_scores": period_scores_of(fact.quarters) if fact is not None else None,
    }


def match_projection(fact: MatchFact, clubs: ClubResolver) -> dict:
    """The typed `afltables.match` projection: source-resolved identity, typed fields.

    "Resolved" here means resolved as far as an OFFLINE pass can: to a historical club
    identity, not to a database id. Mapping those onto clubs.id / venues.id — and refusing
    when they do not map — is TypeScript's, inside the settle transaction.

    Attendance follows AFLDB-ISSUE-099 §17.1: a non-NULL value (including a legitimate 0)
    cites its source; NULL is `not_collected` and cites nothing. NULL is never 0.
    """
    if fact.home_points > fact.away_points:
        result, winner = "home_win", fact.home_hist
    elif fact.away_points > fact.home_points:
        result, winner = "away_win", fact.away_hist
    else:
        result, winner = "draw", None
    return {
        "match_key": match_key_of(fact, clubs),
        "season": fact.season,
        "round_code": fact.round_code,
        "round_number": fact.round_number,
        "round_type": fact.round_type,
        "is_final": fact.round_type != "home_and_away",
        "match_date": fact.match_date.isoformat(),
        "match_time": fact.match_time,
        "venue_raw": fact.venue_raw,
        "home_club_hist": fact.home_hist,
        "away_club_hist": fact.away_hist,
        "home_club_name": clubs.name_of(fact.home_hist),
        "away_club_name": clubs.name_of(fact.away_hist),
        "home_goals": fact.home_goals, "home_behinds": fact.home_behinds,
        "home_score": fact.home_points,
        "away_goals": fact.away_goals, "away_behinds": fact.away_behinds,
        "away_score": fact.away_points,
        "result": result,
        "winner_club_hist": winner,
        "margin": abs(fact.home_points - fact.away_points),
        "attendance": fact.attendance,
        "attendance_status": "complete" if fact.attendance is not None
                             else "not_collected",
        "attendance_source_key": SOURCE_KEY_AFLTABLES if fact.attendance is not None
                                 else None,
        # A side/period whose goals, behinds AND points are all NULL is *not recorded* and
        # writes no row. That is not the same as 0.
        "period_scores": [p for p in (period_scores_of(fact.quarters) or [])
                          if not (p["goals"] is None and p["behinds"] is None
                                  and p["points"] is None)],
    }


def player_match_payload(row: dict, identity: dict) -> dict:
    """The `afltables.player_match_stats` payload: the source row at its own grain.

    Match-grain fields (attendance, venue, team names, scores) belong to the match family
    and are deliberately absent, so a match-level correction does not appear as a
    correction to every one of its player rows.
    """
    payload = {
        "url": identity["url"],
        "afltables_id": clean(row.get("ID")),
        "season": to_int(row.get("Season")),
        "round_code": clean(row.get("Round")),
        "match_key": identity["match_key"],
        "playing_for_raw": clean(row.get("Playing.for")),
        "jumper_number": clean(row.get("Jumper.No.")),
        "career_games": to_int(row.get("Career.Games")),
        "first_name": clean(row.get("First.name")),
        "surname": clean(row.get("Surname")),
        "player_name": clean(row.get("Player")),
        "dob": clean(row.get("DOB")),
    }
    # STAT_MAP by explicit NAME, never by CSV column position. An empty cell is
    # "not recorded" and stays None all the way through the bundle.
    for source_column, target in STAT_MAP:
        payload[target] = to_int(row.get(source_column))
    return payload


def player_match_projection(row: dict, identity: dict, clubs: ClubResolver,
                            round_vote_seasons: set[int]) -> dict:
    """The typed `afltables.player_match_stats` projection.

    Two canonical targets ride one observation (AFLDB-ISSUE-099 §6.1): the
    player_match_stats fact row, and — only when the source actually published a vote — a
    brownlow_round_votes row. NA is never 0 and never a filler row.
    """
    match = identity["match"]
    stats = {target: to_int(row.get(source_column))
             for source_column, target in STAT_MAP}
    votes = stats.get("brownlow_votes")
    eligible = (match.season in round_vote_seasons
                and match.round_code not in FINALS_CODES)
    return {
        "url": identity["url"],
        "afltables_id": clean(row.get("ID")),
        "match_key": identity["match_key"],
        "season": match.season,
        "round_code": match.round_code,
        "round_number": match.round_number,
        "is_final": match.round_type != "home_and_away",
        "club_hist": clubs.resolve(row["Playing.for"], match.season, "player_stats"),
        "career_game_no": to_int(row.get("Career.Games")),
        "jumper_number": clean(row.get("Jumper.No.")),
        "stats": stats,
        # No vote published, an ungated season, or a final: NO row. Never votes = 0, never
        # a played=true/votes=NULL filler row, never a season total derived from a partial
        # round set.
        "brownlow_round_vote": (
            {"season": match.season, "round_number": int(match.round_code),
             "votes": votes}
            if eligible and votes is not None else None
        ),
    }


def measure_brownlow_votes(files: list[SnapshotFile], corrections: list[dict] | None,
                           round_vote_seasons: set[int]) -> dict:
    """AFLDB-ISSUE-099 F11 / U2 — the bounded OFFLINE Brownlow.Votes measurement.

    Counts what the acquired snapshot actually publishes, over the bytes already on disk.
    No network call and no rerun of probe P5. In-season AFL Tables publishes no votes until
    the count, so `rows_with_votes: 0` is the EXPECTED result and is not a defect: it means
    zero Brownlow candidates, which is the honest outcome. It must never become a zero.
    """
    total = 0
    na = 0
    values: set[int] = set()
    projectable = 0
    for context, _season, row in iter_player_stats(files, corrections):
        total += 1
        votes = to_int(row.get("Brownlow.Votes"))
        if votes is None:
            na += 1
            continue
        values.add(votes)
        season = to_int(row.get("Season"))
        round_code = clean(row.get("Round"))
        if season in round_vote_seasons and round_code not in FINALS_CODES:
            projectable += 1
    return {
        "rows": total,
        "rows_with_votes": total - na,
        "rows_na": na,
        "distinct_values": sorted(values),
        "projectable_round_vote_rows": projectable,
        "seasons_gated_for_round_votes": sorted(
            round_vote_seasons & {f.season for f in files if f.season is not None}),
    }


def emit_observation_bundle(
    *, out_path: Path, label: str, manifest_path: Path, manifest: dict,
    files: list[SnapshotFile], matches: dict[tuple, MatchFact], clubs: ClubResolver,
    corrections: list[dict], round_vote_seasons: set[int],
    policy: RecordErrorPolicy, season: int,
) -> dict:
    """Write the deterministic versioned observation bundle (AFLDB-ISSUE-099 §8).

    THE PRESENCE CONTRACT (§19). `enumerations` is built by re-reading the acquired rows
    and computing each row's stable identity, INDEPENDENTLY of whether that row projected.
    A record that was observed and then rejected is therefore still enumerated, so a later
    absence sweep can never conclude it disappeared. A row whose identity cannot be
    established at all goes to `unkeyed_rejections` and forces `complete: false` on its
    (family, scope_key), which is what makes the affected sweep refuse rather than guess.
    """
    scope_key = f"season={season}"

    # ---- afltables.match: enumerate presence from the raw results rows.
    results_file = next(f for f in files if f.dataset == "results")
    by_match_key = {match_key_of(m, clubs): m for m in matches.values()}
    match_order: list[str] = []
    match_rows: dict[str, dict] = {}
    match_identities: dict[str, dict] = {}
    match_unkeyed: list[dict] = []
    with results_file.path.open(newline="", encoding="utf-8") as handle:
        for line, row in enumerate(csv.DictReader(handle), start=2):
            identity = results_identity(row, clubs)
            if identity is None:
                match_unkeyed.append({
                    "family": FAMILY_MATCH, "scope_key": scope_key,
                    "reason": "no_match_identity",
                    "detail": f"results.csv line {line}",
                })
                continue
            record_id = identity["external_record_id"]
            if record_id not in match_rows:
                match_order.append(record_id)
                match_rows[record_id] = row
                match_identities[record_id] = identity

    # ---- afltables.player_match_stats: same, from the raw player_stats rows.
    player_order: list[str] = []
    player_rows: dict[str, dict] = {}
    player_identities: dict[str, dict] = {}
    player_unkeyed: list[dict] = []
    for context, _file_season, row in iter_player_stats(files, corrections):
        identity = player_match_identity(row, clubs, matches)
        if identity is None:
            player_unkeyed.append({
                "family": FAMILY_PLAYER_MATCH, "scope_key": scope_key,
                "reason": "no_player_match_identity", "detail": context,
            })
            continue
        record_id = identity["external_record_id"]
        if record_id not in player_rows:
            player_order.append(record_id)
            player_rows[record_id] = row
            player_identities[record_id] = identity

    match_rejections = policy.keyed(FAMILY_MATCH)
    player_rejections = policy.keyed(FAMILY_PLAYER_MATCH)
    records: list[dict] = []

    for record_id in match_order:
        row = match_rows[record_id]
        fact = by_match_key.get(record_id)
        rejection = match_rejections.get(record_id)
        projection = None
        if fact is None:
            rejection = rejection or {"reason": "record_invalid",
                                      "detail": "row did not survive interpretation"}
        elif not fact.has_player_rows:
            # §17.1: a match may not be PROPOSED without at least one joined player row
            # proving it was played. It is still a full observation.
            rejection = {"reason": "incomplete_match_evidence",
                         "detail": "no player_stats row joined to this match"}
        else:
            projection = match_projection(fact, clubs)
            rejection = None
        records.append({
            "family": FAMILY_MATCH, "scope_key": scope_key,
            "external_record_id": record_id,
            "payload": match_payload(row, match_identities[record_id], fact),
            "observed_columns": list(MATCH_PAYLOAD_COLUMNS),
            "projection": projection,
            "rejection": rejection_json(rejection),
        })

    for record_id in player_order:
        row = player_rows[record_id]
        identity = player_identities[record_id]
        match = identity["match"]
        accepted = (identity["url"],
                    (match.match_date, match.home_hist, match.away_hist)) \
            in policy.accepted_player_match
        unusable = policy.unusable_players.get(identity["url"])
        projection = None
        if not accepted:
            # A duplicate row's rejection must not retract the record the FIRST row
            # legitimately produced, so a rejection is only applied to a record the
            # scan never accepted.
            rejection = player_rejections.get(record_id) or {
                "reason": "record_invalid",
                "detail": "row did not survive interpretation"}
        elif unusable is not None:
            rejection = {"reason": "unresolved_identity", "detail": unusable}
        else:
            rejection = None
            projection = player_match_projection(row, identity, clubs,
                                                 round_vote_seasons)
        records.append({
            "family": FAMILY_PLAYER_MATCH, "scope_key": scope_key,
            "external_record_id": record_id,
            "payload": player_match_payload(row, identity),
            "observed_columns": list(PLAYER_MATCH_PAYLOAD_COLUMNS),
            "projection": projection,
            "rejection": rejection_json(rejection),
        })

    enumerations = [
        enumeration_of(FAMILY_MATCH, scope_key, match_order, match_unkeyed),
        enumeration_of(FAMILY_PLAYER_MATCH, scope_key, player_order, player_unkeyed),
    ]
    unkeyed = match_unkeyed + player_unkeyed
    rejected = sum(1 for r in records if r["rejection"] is not None)

    bundle = {
        "bundle_contract_version": BUNDLE_CONTRACT_VERSION,
        "generated_by": "tools/migration/import_fitzroy_core.py",
        "snapshot_label": label,
        "manifest_path": str(manifest_path).replace("\\", "/"),
        "manifest_sha256": sha256_file(manifest_path),
        "acquisition_kind": acquisition_kind(manifest),
        "season": season,
        "fitzroy_version": manifest.get("fitzroy_version_pinned"),
        "on_record_error": policy.mode,
        "enumerations": enumerations,
        "records": sorted(records, key=lambda r: (r["family"], r["external_record_id"])),
        "unkeyed_rejections": unkeyed,
        "counts": {
            "matches": len(match_order),
            "player_match_rows": len(player_order),
            "rejections": rejected,
            "unkeyed_rejections": len(unkeyed),
        },
        "measurements": {
            "brownlow_votes": measure_brownlow_votes(files, corrections,
                                                     round_vote_seasons),
        },
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(bundle, indent=2, sort_keys=True) + "\n",
                        encoding="utf-8")
    return bundle


def rejection_json(rejection) -> dict | None:
    """Normalise a rejection to the bundle's shape (or None when the record projected)."""
    if rejection is None:
        return None
    if isinstance(rejection, RecordRejection):
        return {"reason": rejection.reason, "detail": rejection.detail}
    return {"reason": rejection["reason"], "detail": rejection["detail"]}


def enumeration_of(family: str, scope_key: str, record_ids: list[str],
                   unkeyed: list[dict]) -> dict:
    """One presence enumeration.

    `complete` is FALSE whenever any observed row of this (family, scope_key) had no
    provable identity. Its presence cannot be represented, so the scope is not safe for
    absence sweeping and TypeScript must skip the sweep for it (§19, SC5). This is the one
    place that decision is made, and it fails closed.
    """
    return {
        "family": family,
        "scope_key": scope_key,
        "complete": not unkeyed,
        "incomplete_reason": None if not unkeyed else
                             f"{len(unkeyed)} observed row(s) had no provable identity",
        "external_record_ids": sorted(record_ids),
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
            for fact in sorted(players.values(), key=lambda f: f.url):
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
            for fact in sorted(players.values(), key=lambda f: f.url):
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
                              clubs: ClubResolver, args, refs: dict,
                              corrections: list[dict]) -> None:
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
            for context, _season, row in iter_player_stats(files, corrections):
                batch.records_read += 1
                season = int(row["Season"])
                match_date = parse_iso_date(row["Date"], context)
                key = (match_date, clubs.resolve(row["Home.team"], season, "player_stats"),
                       clubs.resolve(row["Away.team"], season, "player_stats"))
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
                    club_ids[clubs.resolve(row["Playing.for"], season, "player_stats")],
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
                                matches: dict[tuple, MatchFact], args,
                                corrections: list[dict]) -> None:
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
        for context, _season, row in iter_player_stats(files, corrections):
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
    parser.add_argument("--accepted-baselines",
                        help="override the acceptance register path (tests; and the "
                             "AFLDB-ISSUE-101 pre-apply successor validation)")
    parser.add_argument("--contract",
                        help="override the fitzRoy contract path. OFFLINE VALIDATION ONLY "
                             "(requires --validate-only). AFLDB-ISSUE-101 uses it with "
                             "--accepted-baselines to run --require-full-history / "
                             "--require-accepted-baseline against a TEMPORARY successor "
                             "reference state, so a rollover is proven before any tracked "
                             "file is written. Default: the tracked contract")
    parser.add_argument("--stat-availability",
                        help="override data/reference/stat-availability.json. OFFLINE "
                             "VALIDATION ONLY (requires --validate-only). It gates which "
                             "seasons derive brownlow_round_votes, so a successor "
                             "acquisition must be measured against the reviewed successor "
                             "document. Default: the tracked document")
    parser.add_argument("--require-full-history", action="store_true",
                        help="refuse unless the snapshot has EARNED full_history under the "
                             "contract's completeness gates; re-derives every gate from the "
                             "artefacts rather than trusting the manifest's claim")
    parser.add_argument("--require-accepted-baseline", action="store_true",
                        help="refuse unless --label is THE accepted canonical baseline in "
                             "data/reference/fitzroy-accepted-baselines.json, its hash "
                             "bindings still hold and its measured fingerprint has not "
                             "drifted. IMPLIES --require-full-history: the acceptance record "
                             "binds, it never blesses")
    parser.add_argument("--require-in-season", action="store_true",
                        help="refuse unless the snapshot is an in_season_partial "
                             "acquisition of exactly one season that "
                             "data/reference/seasons.json declares in progress; re-derives "
                             "every gate from the contract's in_season block and the "
                             "artefacts. Offline only, and mutually exclusive with the "
                             "historical gates (AFLDB-ISSUE-099)")
    parser.add_argument("--on-record-error", choices=(ON_RECORD_ERROR_ABORT,
                                                      ON_RECORD_ERROR_REJECT),
                        default=ON_RECORD_ERROR_ABORT,
                        help="what to do when one source record cannot be interpreted. "
                             f"{ON_RECORD_ERROR_ABORT!r} (default) aborts the pass, which "
                             "is what a clean rebuild needs. "
                             f"{ON_RECORD_ERROR_REJECT!r} collects the failure and "
                             "continues, so a nightly settle is not killed by one bad "
                             "row; in-season only (AFLDB-ISSUE-099 F6)")
    parser.add_argument("--emit-observations", metavar="PATH",
                        help="write the deterministic AFLDB-ISSUE-099 observation bundle "
                             "to PATH and exit. Offline: no database connection, no "
                             "canonical write. Requires --require-in-season")
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

    # AFLDB-ISSUE-101. The two reference-document overrides exist so a candidate SUCCESSOR
    # state can be adjudicated by the real gates BEFORE any tracked file moves. They are
    # confined to the offline path: a run that can reach PostgreSQL must read the tracked
    # documents, so no import, dry run or settle can ever be redirected at a temporary
    # contract or a temporary availability document.
    contract_path = Path(args.contract) if args.contract else CONTRACT_PATH
    availability_path = Path(args.stat_availability) if args.stat_availability \
        else AVAILABILITY_JSON
    for flag, value in (("--contract", args.contract),
                        ("--stat-availability", args.stat_availability)):
        if value and not args.validate_only:
            parser.error(
                f"{flag} is offline-validation only: pass --validate-only. A run that can "
                "reach a database must read the tracked reference documents.")
        if value and not Path(value).exists():
            parser.error(f"{flag} does not exist: {value}")
    if args.contract or args.stat_availability:
        # Printed before any gate output, so the transcript can never be mistaken for a
        # run against the tracked reference state.
        print("reference documents OVERRIDDEN for this offline validation")
        print(f"  contract                     {contract_path}")
        print(f"  stat-availability            {availability_path}")

    # Acceptance implies full history: a hand-edited acceptance record must never be able
    # to bypass the gates it claims were passed.
    require_full_history = args.require_full_history or args.require_accepted_baseline

    # AFLDB-ISSUE-099: the two gates adjudicate different acquisition kinds, and a run that
    # asked for both is asking for a contradiction. Refuse rather than silently letting one
    # win.
    if args.require_in_season and require_full_history:
        parser.error(
            "--require-in-season cannot be combined with --require-full-history or "
            "--require-accepted-baseline: they adjudicate different acquisition kinds")

    # AFLDB-ISSUE-099 F6: the historical path must keep aborting on a bad record. Making
    # `reject` in-season only means a rebuild cannot silently drop a record even if an
    # operator asks it to.
    if args.on_record_error == ON_RECORD_ERROR_REJECT and not args.require_in_season:
        parser.error(
            "--on-record-error reject is in-season only: pass --require-in-season. A "
            "clean rebuild must abort on a record it cannot interpret, never drop it.")
    if args.emit_observations and not args.require_in_season:
        parser.error(
            "--emit-observations requires --require-in-season: the observation bundle "
            "declares acquisition_kind in_season_partial and an in-progress season, so it "
            "must not be produced from any other snapshot kind")

    started = time.time()
    in_season_coverage: dict | None = None
    full_history_coverage: dict | None = None
    accepted_baseline: dict | None = None
    acceptance_binding: dict | None = None
    try:
        files = validate_snapshot(snapshot_dir, manifest_path, args.label, contract_path)
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        contract = json.loads(contract_path.read_text(encoding="utf-8"))
        # The observation scope is the acquired season. A multi-season snapshot has no
        # single scope, and --emit-observations is refused for one above.
        rng = manifest.get("requested_range") or {}
        season_scope = rng.get("from") if (isinstance(rng.get("from"), int)
                                           and rng.get("from") == rng.get("to")) else None
        policy = RecordErrorPolicy(
            args.on_record_error,
            scope_key=f"season={season_scope}" if season_scope is not None else "")
        if args.require_accepted_baseline:
            # Explicit, and before the register is even opened: an in-season partial is
            # not a candidate for acceptance, so it must not be adjudicated as one.
            refuse_in_season_for_historical(manifest, "--require-accepted-baseline")
            register_path = Path(args.accepted_baselines) if args.accepted_baselines                 else ACCEPTED_BASELINES_PATH
            if not register_path.exists():
                raise SnapshotValidationError(
                    f"acceptance register not found: {register_path}")
            accepted_baseline = select_accepted_baseline(
                json.loads(register_path.read_text(encoding="utf-8")), args.label)
            acceptance_binding = verify_accepted_binding(
                accepted_baseline, manifest_path, manifest, contract)
        if require_full_history:
            full_history_coverage = enforce_full_history(manifest, snapshot_dir, contract)
        if args.require_in_season:
            in_season_coverage = enforce_in_season(manifest, snapshot_dir, contract)
        corrections = load_row_corrections(contract_path)
        clubs = ClubResolver(
            json.loads(CLUBS_JSON.read_text(encoding="utf-8")),
            (json.loads(contract_path.read_text(encoding="utf-8"))
             .get("source_club_normalisation", {}).get("rules", [])),
        )
        round_vote_seasons = load_round_vote_seasons(availability_path)
        results_file = next(f for f in files if f.dataset == "results")
        matches = scan_results(results_file.path, clubs, policy)
        players, rows_read, round_vote_rows = scan_player_stats(
            files, matches, clubs, round_vote_seasons, corrections, policy)
    except (SnapshotValidationError, MatchIdentityError, PlayerIdentityError) as exc:
        raise fail(str(exc))

    summary = summarise(matches, players, rows_read, round_vote_rows)
    if not args.quiet or args.validate_only:
        print("snapshot scan summary")
        for k, v in summary.items():
            print(f"  {k:<28} {v}")
    if full_history_coverage is not None:
        print("full-history gates PASSED — identity coverage")
        for k, v in full_history_coverage.items():
            print(f"  {k:<28} {v}")
    if in_season_coverage is not None:
        print("in-season gates PASSED — identity coverage")
        for k, v in in_season_coverage.items():
            print(f"  {k:<28} {v}")

    if accepted_baseline is not None:
        try:
            enforce_accepted_fingerprint(
                accepted_baseline, summary, full_history_coverage or {})
        except SnapshotValidationError as exc:
            raise fail(str(exc))
        print("accepted canonical baseline VERIFIED")
        for k, v in (acceptance_binding or {}).items():
            print(f"  {k:<28} {v}")

    if args.emit_observations:
        # AFLDB-ISSUE-099 S-B. Offline emission, then exit: nothing below this branch is
        # reached, so no database connection is ever opened on the settle path.
        try:
            bundle = emit_observation_bundle(
                out_path=Path(args.emit_observations), label=args.label,
                manifest_path=manifest_path, manifest=manifest, files=files,
                matches=matches, clubs=clubs, corrections=corrections,
                round_vote_seasons=round_vote_seasons, policy=policy,
                season=season_scope)
        except (SnapshotValidationError, MatchIdentityError,
                PlayerIdentityError) as exc:
            raise fail(str(exc))
        print(f"\nobservation bundle v{bundle['bundle_contract_version']} written to "
              f"{args.emit_observations}")
        for k, v in bundle["counts"].items():
            print(f"  {k:<28} {v}")
        for enumeration in bundle["enumerations"]:
            print(f"  {enumeration['family']:<28} "
                  f"{len(enumeration['external_record_ids'])} record(s), "
                  f"complete={enumeration['complete']}")
        votes = bundle["measurements"]["brownlow_votes"]
        print("  Brownlow.Votes (offline measurement, AFLDB-ISSUE-099 F11)")
        for k, v in votes.items():
            print(f"    {k:<26} {v}")
        print(f"\nEmission complete in {time.time() - started:.1f}s "
              "(no database access).")
        return 0

    if args.validate_only:
        print(f"\nValidation complete in {time.time() - started:.1f}s "
              "(no database access).")
        return 0

    # AFLDB-ISSUE-099 F4/§15. An in-season snapshot is NEVER imported by this tool. The
    # canonical import_* writers upsert with no ownership predicate and delete by match and
    # season — correct for a clean rebuild, destructive and unreviewed in-season — so an
    # in-season snapshot reaches PostgreSQL only through the reviewed settle pass. This
    # guard is the reason --require-in-season can be used safely without --validate-only.
    if args.require_in_season:
        raise fail(
            "--require-in-season is OFFLINE ONLY: an in_season_partial snapshot is never "
            "imported by this tool, because the canonical writers upsert and delete "
            "without an ownership predicate. Use --validate-only to adjudicate it; the "
            "reviewed settle pass (tools/current-season/settle-afltables.ts) is the only "
            "path from an in-season snapshot to PostgreSQL.")

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
            from common import replay_admin_overrides
            replay_admin_overrides(pg, "players")
        elif group == "matches":
            import_matches(pg, rep, matches, clubs, refs)
            replay_admin_overrides(pg, "matches")
        elif group == "stats":
            # `corrections` is threaded explicitly, never read from module scope:
            # both of these functions call iter_player_stats(files, corrections) and
            # both lost the parameter in an earlier refactor, so the name resolved to
            # nothing and the stage died with NameError after 16,838 matches had been
            # imported (AFLDB-ISSUE-093 §H14). It is REQUIRED rather than defaulted to
            # None, so a caller that forgets it fails immediately instead of silently
            # importing the source uncorrected.
            import_player_match_stats(pg, rep, files, matches, clubs, args, refs,
                                      corrections)
        elif group == "brownlow":
            import_brownlow_round_votes(pg, rep, files, matches, args, corrections)

    print(f"\nCompleted in {time.time() - started:.1f}s")
    pg.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
