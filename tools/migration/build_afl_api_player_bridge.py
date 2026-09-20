#!/usr/bin/env python3
"""AFLDB-ISSUE-228 Stage S5 -- offline builder for the afl_api player-identity
bootstrap bridge (runbook Sec 6.3).

Turns stable AFL provider player ids (``CD_I...``) observed in the tracked
AFL.com.au sample corpus into DETERMINISTIC candidate links to canonical
``players.id`` rows, by joining each provider player-stat row to the
afltables-owned canonical ``player_match_stats`` row for the same match, club
and jumper number, and requiring EXACT equality of the core stat vector.

This tool never writes a database. It reads:

* the tracked local sample corpus under
  ``data/sources/AFLWebsite/AFLGamesSamples/`` (14 matches: 12 historical
  2022-2025 + 2 2026 preliminary finals -- the same corpus the S3 backtest
  manifest ``docs/rebuild-manifests/afl_api/backtest-20260919.json`` already
  hash-binds);
* ``data/reference/afl-api-identities.json`` (S1) for the CD_T -> hist team
  map;
* ``afldb_test`` READ-ONLY (``AFLDB_TEST_DATABASE_URL``), for the canonical
  ``matches`` / ``player_match_stats`` / ``players`` / ``clubs`` evidence this
  bridge bootstraps FROM.

It writes one file: ``data/reference/afl-api-player-bridge-<date>.json`` (the
evidence artefact). Nothing is inserted, updated or deleted in any database.
Whether a candidate is durably written to ``external_identities`` is decided
later, by ``import_afl_api_player_bridge.py``, which re-checks the live
database state at import time (this builder's artefact can go stale between
runs, and idempotency/contradiction detection therefore lives at import time,
never here).

Runbook contract this builder implements (Sec 6.3):

  Accept ``CD_I -> player_id`` only when:
    (a) every observed match of that CD_I maps to the same player_id;
    (b) that player_id maps to no other CD_I;
    (c) >= 2 matched matches, or 1 match with >= 10 non-NULL agreeing
        statistics;
    (d) normalised surname equality holds (validation only -- a failure
        withholds the pair, it never resolves anything).

A "matched match" requires the AFL API row and the canonical row to agree on
the SAME club (via the provider team map), the SAME jumper number, and EXACT
equality of the 13-column core stat vector, with every one of those 13
columns non-NULL on both sides. Names are read for (d) only -- diagnostics,
never the decisive identity key. No fuzzy or name-based resolution exists
anywhere in this file.

Match identity for this bootstrap evidence step is resolved by
(season, match_date, home club hist, away club hist) -- NOT full provider-id
/ match_key resolution (that is Stage S6's settle concern, per Sec 6.1). Each
AFL two-team fixture plays at most one match per date, so this is an
unambiguous, deterministic identifier for the tracked sample corpus; a
collision is refused (HALT), never guessed. The sample folder name (already
verified against the raw payload by the S3 backtest, assertion 2, 12/12
pass) supplies the date; every folder-derived field is cross-checked against
the raw ``01-fixture-result.json`` payload before use, and a mismatch is a
hard refusal.

Usage:
    python tools/migration/build_afl_api_player_bridge.py --validate-only
    python tools/migration/build_afl_api_player_bridge.py --write
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402  (tools/migration/common.py)

TOOL = "tools/migration/build_afl_api_player_bridge.py"
TOOL_VERSION = "1.0.0"

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLES_ROOT = REPO_ROOT / "data" / "sources" / "AFLWebsite" / "AFLGamesSamples"
BACKTEST_MANIFEST = REPO_ROOT / "docs" / "rebuild-manifests" / "afl_api" / "backtest-20260919.json"
IDENTITIES_PATH = REPO_ROOT / "data" / "reference" / "afl-api-identities.json"
OUT_DIR = REPO_ROOT / "data" / "reference"

DSN_ENV = "AFLDB_TEST_DATABASE_URL"
REQUIRED_DATABASE = "afldb_test"

SOURCE_KEY = "afl_api"
MATCH_METHOD = "afl_api_stat_vector_bootstrap"

# Sec 6.3: the exact-equality core stat vector. Order matches the runbook's
# own listing. Every entry is a canonical player_match_stats / staging
# afl_api_player_match column name (the two schemas share these names
# exactly -- migration 004 vs migration 103).
CORE_STAT_COLUMNS: tuple[str, ...] = (
    "kicks", "handballs", "marks", "tackles", "goals", "behinds",
    "hitouts", "frees_for", "frees_against", "inside_50s", "clearances",
    "rebounds", "goal_assists",
)

# The wider comparable set used only for criterion (c)'s "non-NULL agreeing
# statistics" count on a single-match acceptance. A superset of
# CORE_STAT_COLUMNS with the remaining columns both schemas carry.
AGREEMENT_STAT_COLUMNS: tuple[str, ...] = CORE_STAT_COLUMNS + (
    "contested", "uncontested", "contested_marks", "marks_inside_50",
    "one_percenters", "bounces", "clangers",
)

MIN_MATCHES_FOR_LINK = 2
MIN_SINGLE_MATCH_AGREEMENT = 10

FOLDER_RE = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2})_(?:R(?P<round>\d+)_)?"
    r"(?P<home>[A-Z0-9]+)_v_(?P<away>[A-Z0-9]+)_(?P<match_id>CD_M\d+)$"
)


class BridgeSourceError(ValueError):
    """The tracked sample corpus violates an assumption this builder relies on."""


class BridgeEvidenceError(ValueError):
    """A read-only afldb_test evidence step failed in a way that must halt the run."""


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def resolve_dsn(environ: dict | None = None) -> str:
    """AFLDB_TEST_DATABASE_URL, targeting /afldb_test, nothing else.

    Mirrors tools/rebuild/draftguru/bridge_import_gate.py's resolve_dsn: no
    PROD entry, no DEV entry, no default -- an unset or wrongly-targeted
    variable refuses before any connection is attempted (CLAUDE.md Sec 5's
    D-9 discipline, repository-wide).
    """
    env = os.environ if environ is None else environ
    dsn = env.get(DSN_ENV)
    if not dsn:
        raise BridgeEvidenceError(
            f"{DSN_ENV} is not set -- refusing to read evidence from an unknown target"
        )
    dsn = dsn.strip()
    parsed = urlparse(dsn)
    if parsed.scheme not in ("postgresql", "postgres"):
        raise BridgeEvidenceError(f"{DSN_ENV} is not a postgresql:// DSN")
    if parsed.path.lstrip("/") != REQUIRED_DATABASE:
        raise BridgeEvidenceError(f"{DSN_ENV} does not target /{REQUIRED_DATABASE} -- refusing")
    return dsn


def open_read_only(dsn: str) -> psycopg.Connection:
    conn = psycopg.connect(
        dsn,
        options="-c default_transaction_read_only=on -c TimeZone=UTC",
        application_name="afldb-build-afl-api-player-bridge",
    )
    with conn.cursor() as cur:
        cur.execute(
            "SELECT current_setting('transaction_read_only'), "
            "current_setting('default_transaction_read_only'), current_database()"
        )
        txn_ro, default_ro, database = cur.fetchone()
    if txn_ro != "on" or default_ro != "on":
        raise BridgeEvidenceError("REFUSED: the server reports the transaction is not read-only")
    if database != REQUIRED_DATABASE:
        raise BridgeEvidenceError(f"REFUSED: connected database is not {REQUIRED_DATABASE}")
    return conn


def normalise_surname(raw: str | None) -> str:
    """Strip accents and punctuation, uppercase. Comparison only -- never a match key."""
    if not raw:
        return ""
    text = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z]", "", text.upper())


# ---------------------------------------------------------------------------
# Sample corpus discovery and parsing
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SampleMatch:
    folder: Path
    match_date: date
    season: int
    home_abbr: str
    away_abbr: str
    provider_match_id: str
    fixture_path: Path
    player_stats_path: Path


def discover_sample_matches() -> list[SampleMatch]:
    """Every tracked one-match sample directory, folder name cross-checked against payload.

    Deliberately excludes any ``monitor-*`` directory: those are re-polls of
    a match already covered by its own dated directory (Sec 2.4), and
    including them would double-count one match's evidence.
    """
    matches: list[SampleMatch] = []
    if not SAMPLES_ROOT.is_dir():
        raise BridgeSourceError(f"sample corpus not found: {SAMPLES_ROOT}")

    for fixture_path in sorted(SAMPLES_ROOT.rglob("01-fixture-result.json")):
        folder = fixture_path.parent
        if "monitor-" in str(folder):
            continue
        m = FOLDER_RE.match(folder.name)
        if not m:
            raise BridgeSourceError(
                f"sample folder name does not match the tracked naming convention: {folder.name}"
            )
        match_date = date.fromisoformat(m.group("date"))
        provider_match_id = m.group("match_id")
        player_stats_path = folder / "02-player-stats.raw.json"
        if not player_stats_path.exists():
            raise BridgeSourceError(f"missing player-stats sample beside {fixture_path}")

        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        observed_match_id = fixture.get("providerId")
        home_abbr = ((fixture.get("home") or {}).get("team") or {}).get("abbreviation")
        away_abbr = ((fixture.get("away") or {}).get("team") or {}).get("abbreviation")
        if observed_match_id != provider_match_id:
            raise BridgeSourceError(
                f"{folder}: folder name match id {provider_match_id!r} disagrees with "
                f"payload providerId {observed_match_id!r}"
            )
        if home_abbr != m.group("home") or away_abbr != m.group("away"):
            raise BridgeSourceError(
                f"{folder}: folder name home/away ({m.group('home')}/{m.group('away')}) "
                f"disagrees with payload abbreviations ({home_abbr}/{away_abbr})"
            )

        matches.append(SampleMatch(
            folder=folder, match_date=match_date, season=match_date.year,
            home_abbr=home_abbr, away_abbr=away_abbr,
            provider_match_id=provider_match_id,
            fixture_path=fixture_path, player_stats_path=player_stats_path,
        ))

    if not matches:
        raise BridgeSourceError(f"no sample matches discovered under {SAMPLES_ROOT}")
    return matches


def load_team_identities() -> dict[str, str]:
    """CD_T<id> -> clubs.legacy_club_hist, from the S1 reference map."""
    data = json.loads(IDENTITIES_PATH.read_text(encoding="utf-8"))
    teams = data.get("teams") or {}
    out: dict[str, str] = {}
    for provider_id, entry in teams.items():
        if provider_id.startswith("$"):
            continue
        hist = entry.get("hist")
        if not hist:
            raise BridgeSourceError(f"{IDENTITIES_PATH}: team {provider_id} has no 'hist' entry")
        out[provider_id] = hist
    if not out:
        raise BridgeSourceError(f"{IDENTITIES_PATH}: no team identities declared")
    return out


def num_or_none(value: Any) -> int | None:
    """Sec 4.4: every count is a JSON float; an integral float is the integer.

    Mirrors afl-api-bundle.ts numOrNull() exactly, including the
    non-integral refusal, so this builder never silently disagrees with the
    S3 emitter about what a stat value means.
    """
    if value is None:
        return None
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise BridgeSourceError(f"expected a number or null, got {value!r}")
    if float(value) != int(value):
        raise BridgeSourceError(f"non-integral statistic: {value!r}")
    return int(value)


@dataclass
class ProviderStatRow:
    provider_match_id: str
    provider_team_id: str
    provider_player_id: str
    given_name: str | None
    surname: str | None
    jumper_number: int | None
    stats: dict[str, int | None]


def parse_player_stats(match: SampleMatch) -> list[ProviderStatRow]:
    raw = json.loads(match.player_stats_path.read_text(encoding="utf-8"))
    rows: list[ProviderStatRow] = []
    for side_key in ("homeTeamPlayerStats", "awayTeamPlayerStats"):
        side = raw.get(side_key)
        if side is None:
            continue
        if not isinstance(side, list):
            raise BridgeSourceError(f"{match.player_stats_path}: {side_key} must be an array")
        for index, entry in enumerate(side):
            path = f"{match.player_stats_path}:{side_key}[{index}]"
            team_id = entry.get("teamId")
            if not team_id:
                raise BridgeSourceError(f"{path}: missing teamId")
            player_stats_block = entry.get("playerStats") or {}
            player = player_stats_block.get("player") or {}
            player_id = player.get("playerId")
            if not player_id:
                raise BridgeSourceError(f"{path}: missing playerStats.player.playerId")
            stats = player_stats_block.get("stats") or {}
            clearances = stats.get("clearances") or {}
            rows.append(ProviderStatRow(
                provider_match_id=match.provider_match_id,
                provider_team_id=team_id,
                provider_player_id=player_id,
                given_name=(player.get("playerName") or {}).get("givenName"),
                surname=(player.get("playerName") or {}).get("surname"),
                jumper_number=num_or_none(player.get("playerJumperNumber")),
                stats={
                    "kicks": num_or_none(stats.get("kicks")),
                    "handballs": num_or_none(stats.get("handballs")),
                    "marks": num_or_none(stats.get("marks")),
                    "tackles": num_or_none(stats.get("tackles")),
                    "goals": num_or_none(stats.get("goals")),
                    "behinds": num_or_none(stats.get("behinds")),
                    "hitouts": num_or_none(stats.get("hitouts")),
                    "frees_for": num_or_none(stats.get("freesFor")),
                    "frees_against": num_or_none(stats.get("freesAgainst")),
                    "inside_50s": num_or_none(stats.get("inside50s")),
                    "clearances": num_or_none(clearances.get("totalClearances")),
                    "rebounds": num_or_none(stats.get("rebound50s")),
                    "goal_assists": num_or_none(stats.get("goalAssists")),
                    "contested": num_or_none(stats.get("contestedPossessions")),
                    "uncontested": num_or_none(stats.get("uncontestedPossessions")),
                    "contested_marks": num_or_none(stats.get("contestedMarks")),
                    "marks_inside_50": num_or_none(stats.get("marksInside50")),
                    "one_percenters": num_or_none(stats.get("onePercenters")),
                    "bounces": num_or_none(stats.get("bounces")),
                    "clangers": num_or_none(stats.get("clangers")),
                },
            ))

    seen = set()
    for row in rows:
        key = (row.provider_team_id, row.provider_player_id)
        if key in seen:
            raise BridgeSourceError(
                f"{match.player_stats_path}: duplicate player {row.provider_player_id} "
                f"(team {row.provider_team_id})"
            )
        seen.add(key)
    return rows


# ---------------------------------------------------------------------------
# afldb_test canonical evidence (read-only)
# ---------------------------------------------------------------------------


@dataclass
class CanonicalRow:
    player_id: int
    surname: str | None
    stats: dict[str, int | None]


def resolve_canonical_match(cur, match: SampleMatch, team_identities: dict[str, str],
                             fixture: dict) -> tuple[int | None, str | None]:
    """(canonical match_id, refusal_reason). One of the two is always None."""
    home_provider = ((fixture.get("home") or {}).get("team") or {}).get("providerId")
    away_provider = ((fixture.get("away") or {}).get("team") or {}).get("providerId")
    if not home_provider or not away_provider:
        return None, "missing_team_provider_id"
    home_hist = team_identities.get(home_provider)
    away_hist = team_identities.get(away_provider)
    if home_hist is None or away_hist is None:
        return None, f"unmapped_team_provider_id({home_provider},{away_provider})"

    cur.execute(
        """SELECT m.id FROM matches m
             JOIN clubs hc ON hc.id = m.home_club_id
             JOIN clubs ac ON ac.id = m.away_club_id
            WHERE m.season = %s AND m.match_date = %s
              AND hc.legacy_club_hist = %s AND ac.legacy_club_hist = %s""",
        (match.season, match.match_date, home_hist, away_hist),
    )
    rows = cur.fetchall()
    if not rows:
        return None, "no_canonical_match"
    if len(rows) > 1:
        raise BridgeEvidenceError(
            f"{match.provider_match_id}: {len(rows)} canonical matches found for "
            f"season={match.season} date={match.match_date} {home_hist} v {away_hist} "
            "-- ambiguous, refusing rather than guessing"
        )
    return rows[0][0], None


def load_canonical_player_match(cur, match_id: int) -> dict[tuple[int, str], CanonicalRow]:
    """(club_id, jumper_number) -> CanonicalRow, for every player who played this match."""
    cur.execute(
        f"""SELECT pms.club_id, pms.jumper_number, pms.player_id, p.surname,
                   {", ".join("pms." + c for c in AGREEMENT_STAT_COLUMNS)}
              FROM player_match_stats pms
              JOIN players p ON p.id = pms.player_id
             WHERE pms.match_id = %s""",
        (match_id,),
    )
    out: dict[tuple[int, str], CanonicalRow] = {}
    for row in cur.fetchall():
        club_id, jumper_number, player_id, surname = row[0], row[1], row[2], row[3]
        if jumper_number is None:
            continue
        stats = dict(zip(AGREEMENT_STAT_COLUMNS, row[4:]))
        out[(club_id, jumper_number)] = CanonicalRow(player_id=player_id, surname=surname, stats=stats)
    return out


def load_club_id_by_hist(cur, hist_values: set[str]) -> dict[str, int]:
    if not hist_values:
        return {}
    cur.execute(
        "SELECT legacy_club_hist, id FROM clubs WHERE legacy_club_hist = ANY(%s)",
        (list(hist_values),),
    )
    return {hist: club_id for hist, club_id in cur.fetchall()}


# ---------------------------------------------------------------------------
# Evidence accumulation and acceptance (Sec 6.3)
# ---------------------------------------------------------------------------


@dataclass
class MatchHit:
    provider_match_id: str
    player_id: int
    agreeing_count: int
    core_agrees: bool


@dataclass
class ProviderEvidence:
    provider_player_id: str
    observed_given_name: str | None = None
    observed_surname: str | None = None
    hits: list[MatchHit] = field(default_factory=list)
    misses: list[str] = field(default_factory=list)  # provider_match_id: reason


def build_evidence(matches: list[SampleMatch], team_identities: dict[str, str],
                    conn: psycopg.Connection, rep: "Reporter") -> tuple[dict, list[dict]]:
    providers: dict[str, ProviderEvidence] = {}
    match_reports: list[dict] = []

    with conn.cursor() as cur:
        for match in matches:
            fixture = json.loads(match.fixture_path.read_text(encoding="utf-8"))
            canonical_match_id, reason = resolve_canonical_match(cur, match, team_identities, fixture)
            match_reports.append({
                "provider_match_id": match.provider_match_id,
                "season": match.season,
                "match_date": match.match_date.isoformat(),
                "home_abbr": match.home_abbr,
                "away_abbr": match.away_abbr,
                "canonical_match_id": canonical_match_id,
                "resolution": "resolved" if canonical_match_id else "unresolved",
                "reason": reason,
            })
            if canonical_match_id is None:
                rep.warn(f"{match.provider_match_id}: {reason} -- skipped, no evidence contributed")
                continue

            canonical_by_jumper = load_canonical_player_match(cur, canonical_match_id)
            home_hist = team_identities[((fixture["home"]["team"]["providerId"]))]
            away_hist = team_identities[((fixture["away"]["team"]["providerId"]))]
            club_ids = load_club_id_by_hist(cur, {home_hist, away_hist})

            for stat_row in parse_player_stats(match):
                provider = providers.setdefault(
                    stat_row.provider_player_id,
                    ProviderEvidence(provider_player_id=stat_row.provider_player_id),
                )
                if provider.observed_surname is None:
                    provider.observed_given_name = stat_row.given_name
                    provider.observed_surname = stat_row.surname

                club_hist = team_identities.get(stat_row.provider_team_id)
                club_id = club_ids.get(club_hist) if club_hist else None
                if club_id is None or stat_row.jumper_number is None:
                    provider.misses.append(
                        f"{match.provider_match_id}:missing_club_or_jumper"
                    )
                    continue

                canonical = canonical_by_jumper.get((club_id, str(stat_row.jumper_number)))
                if canonical is None:
                    provider.misses.append(f"{match.provider_match_id}:no_canonical_row_at_jumper")
                    continue

                core_agrees = all(
                    stat_row.stats[c] is not None and canonical.stats[c] is not None
                    and stat_row.stats[c] == canonical.stats[c]
                    for c in CORE_STAT_COLUMNS
                )
                agreeing_count = sum(
                    1 for c in AGREEMENT_STAT_COLUMNS
                    if stat_row.stats[c] is not None and canonical.stats[c] is not None
                    and stat_row.stats[c] == canonical.stats[c]
                )
                if not core_agrees:
                    provider.misses.append(f"{match.provider_match_id}:core_stat_mismatch")
                    continue

                provider.hits.append(MatchHit(
                    provider_match_id=match.provider_match_id,
                    player_id=canonical.player_id,
                    agreeing_count=agreeing_count,
                    core_agrees=core_agrees,
                ))
                # Surname (d) is validation only, applied in classify_providers
                # against the accepted candidate's canonical surname -- never
                # used here to accept or reject the stat-vector match itself.

    return providers, match_reports


def classify_providers(providers: dict[str, ProviderEvidence],
                        conn: psycopg.Connection) -> dict[str, dict]:
    """Sec 6.3 (a)-(d), applied in order. Returns the per-provider report dict."""
    # Pass 1: provisional single-candidate acceptance, rule (a).
    provisional: dict[str, int] = {}
    reasons: dict[str, str] = {}
    contradictory: set[str] = set()
    for external_id, evidence in providers.items():
        candidate_ids = {hit.player_id for hit in evidence.hits}
        if not candidate_ids:
            reasons[external_id] = "no_matching_evidence"
            continue
        if len(candidate_ids) > 1:
            # Sec 6.3(h): a CD_I whose stat vector matches two different
            # players across matches -- withheld, never picked.
            reasons[external_id] = (
                f"multiple_candidate_players({sorted(candidate_ids)})"
            )
            contradictory.add(external_id)
            continue
        provisional[external_id] = next(iter(candidate_ids))

    # Rule (b): a player_id must map to no other CD_I. Any player_id claimed
    # by more than one provisional CD_I voids ALL of them (Sec 6.3(h): two
    # CD_I matching one player -- both withheld).
    by_player: dict[int, list[str]] = {}
    for external_id, player_id in provisional.items():
        by_player.setdefault(player_id, []).append(external_id)
    shared_player_ids = {pid: ids for pid, ids in by_player.items() if len(ids) > 1}
    for pid, ids in shared_player_ids.items():
        for external_id in ids:
            reasons[external_id] = f"shared_player_id({pid}: {', '.join(sorted(ids))})"
            contradictory.add(external_id)
            del provisional[external_id]

    # Fetch canonical surnames for the survivors, for rule (d).
    surnames: dict[int, str | None] = {}
    if provisional:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, surname FROM players WHERE id = ANY(%s)",
                (list(set(provisional.values())),),
            )
            surnames = dict(cur.fetchall())

    report: dict[str, dict] = {}
    for external_id, evidence in providers.items():
        base = {
            "observed_name": " ".join(
                part for part in (evidence.observed_given_name, evidence.observed_surname) if part
            ) or None,
            "matches": [
                {
                    "provider_match_id": hit.provider_match_id,
                    "canonical_player_id": hit.player_id,
                    "agreeing_stat_count": hit.agreeing_count,
                }
                for hit in evidence.hits
            ],
            "unmatched": list(evidence.misses),
        }
        if external_id not in provisional:
            base["disposition"] = "contradictory" if external_id in contradictory else "unresolved"
            base["reason"] = reasons.get(external_id, "no_matching_evidence")
            report[external_id] = base
            continue

        player_id = provisional[external_id]
        num_hits = len(evidence.hits)
        best_agree = max((hit.agreeing_count for hit in evidence.hits), default=0)
        if not (num_hits >= MIN_MATCHES_FOR_LINK or
                (num_hits == 1 and best_agree >= MIN_SINGLE_MATCH_AGREEMENT)):
            base["disposition"] = "unresolved"
            base["reason"] = (
                f"insufficient_evidence({num_hits} match(es), best {best_agree} agreeing stats)"
            )
            report[external_id] = base
            continue

        canonical_surname = surnames.get(player_id)
        if normalise_surname(canonical_surname) != normalise_surname(evidence.observed_surname):
            base["disposition"] = "unresolved"
            base["reason"] = (
                f"surname_disagrees(observed={evidence.observed_surname!r}, "
                f"canonical={canonical_surname!r})"
            )
            report[external_id] = base
            continue

        base["disposition"] = "linked"
        base["reason"] = None
        base["candidate_player_id"] = player_id
        base["canonical_surname"] = canonical_surname
        base["evidence_summary"] = (
            f"{num_hits} match(es), {sum(h.agreeing_count for h in evidence.hits)} total "
            f"agreeing statistic(s), core stat vector exact on every matched game"
        )
        report[external_id] = base

    return report


# ---------------------------------------------------------------------------
# Reporting and artefact
# ---------------------------------------------------------------------------


class Reporter:
    def __init__(self, verbose: bool = True) -> None:
        self.verbose = verbose

    def step(self, message: str) -> None:
        if self.verbose:
            print(f"  {message}", flush=True)

    def result(self, label: str, count: int) -> None:
        if self.verbose:
            print(f"    {label:<40} {count:>9,}", flush=True)

    def warn(self, message: str) -> None:
        print(f"    WARNING: {message}", flush=True)


def build_artefact(match_reports: list[dict], provider_report: dict[str, dict],
                    input_hashes: list[dict]) -> dict:
    counts = {"providers_observed": len(provider_report)}
    for disposition in ("linked", "unresolved", "contradictory"):
        counts[disposition] = sum(
            1 for r in provider_report.values() if r["disposition"] == disposition
        )
    return {
        "tool": TOOL,
        "tool_version": TOOL_VERSION,
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_key": SOURCE_KEY,
        "match_method": MATCH_METHOD,
        "core_stat_columns": list(CORE_STAT_COLUMNS),
        "agreement_stat_columns": list(AGREEMENT_STAT_COLUMNS),
        "acceptance_rule": {
            "min_matches_for_link": MIN_MATCHES_FOR_LINK,
            "min_single_match_agreement": MIN_SINGLE_MATCH_AGREEMENT,
        },
        "inputs": input_hashes,
        "matches_processed": match_reports,
        "providers": provider_report,
        "counts": counts,
    }


def input_hashes() -> list[dict]:
    hashes = [{"file": str(BACKTEST_MANIFEST.relative_to(REPO_ROOT)), "sha256": sha256_file(BACKTEST_MANIFEST)}]
    for path in sorted(SAMPLES_ROOT.rglob("01-fixture-result.json")):
        if "monitor-" in str(path.parent):
            continue
        for name in ("01-fixture-result.json", "02-player-stats.raw.json"):
            f = path.parent / name
            hashes.append({"file": str(f.relative_to(REPO_ROOT)), "sha256": sha256_file(f)})
    return hashes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--validate-only", action="store_true",
                        help="Build the evidence artefact in memory and print the report; write nothing.")
    group.add_argument("--write", action="store_true",
                        help="Build the evidence artefact and write it to data/reference/.")
    parser.add_argument("--out", type=Path, default=None,
                        help="Output path (default: data/reference/afl-api-player-bridge-<date>.json)")
    args = parser.parse_args(argv)

    common.load_env()
    rep = Reporter()
    try:
        dsn = resolve_dsn()
        matches = discover_sample_matches()
        team_identities = load_team_identities()
        rep.step(f"discovered {len(matches)} sample match(es)")

        conn = open_read_only(dsn)
        try:
            providers, match_reports = build_evidence(matches, team_identities, conn, rep)
            provider_report = classify_providers(providers, conn)
        finally:
            conn.rollback()
            conn.close()

        artefact = build_artefact(match_reports, provider_report, input_hashes())
    except (BridgeSourceError, BridgeEvidenceError) as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1

    rep.result("matches processed", len(match_reports))
    rep.result("matches resolved", sum(1 for m in match_reports if m["resolution"] == "resolved"))
    for label, count in artefact["counts"].items():
        rep.result(label, count)

    if args.write:
        out_path = args.out or (OUT_DIR / f"afl-api-player-bridge-{date.today().isoformat()}.json")
        if out_path.exists():
            existing = json.loads(out_path.read_text(encoding="utf-8"))
            existing_comparable = {k: v for k, v in existing.items() if k != "generated_utc"}
            new_comparable = {k: v for k, v in artefact.items() if k != "generated_utc"}
            if existing_comparable == new_comparable:
                rep.step(f"{out_path} already exists and is identical -- not rewritten")
                return 0
            print(f"REFUSED: {out_path} already exists with DIFFERENT content. "
                  "Use --out to write a new file, or remove the stale one deliberately.",
                  file=sys.stderr)
            return 1
        out_path.write_text(json.dumps(artefact, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        rep.step(f"wrote {out_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
