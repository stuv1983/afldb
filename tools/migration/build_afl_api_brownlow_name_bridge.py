#!/usr/bin/env python3
"""AFLDB-ISSUE-228 S5b -- offline builder for a NAME + TEAM + SEASON-2025
candidate bridge over the 2025 Brownlow provider-player population that S5's
stat-vector bridge (build_afl_api_player_bridge.py) could not reach.

Why this tool exists (operator request, 2026-09-20)
----------------------------------------------------
S5's stat-vector bridge only ever observes a provider id that appears in the
tracked 14-match sample corpus under data/sources/AFLWebsite/AFLGamesSamples/
(12 historical 2022-2025 matches + 2 2026 preliminary finals; only 3 of the
14 are 2025 matches -- 2025-05-04 SYD v GWS, 2025-05-10 GCFC v WB,
2025-08-15 ESS v STK). The 2025 Brownlow population spans all 207
home-and-away matches of the season. A provider player who never appears in
one of those 3 tracked 2025 matches (or any of the other 11) leaves NO
row in the S5 evidence artefact at all -- not "unresolved", simply never
observed -- so `resolveAflApiPlayer()` reports `no_external_identity`. This
was CONFIRMED by direct inspection: Josh Kelly (CD_I296347) does not appear
anywhere in data/reference/afl-api-player-bridge-2026-09-20.json.

This builder cannot reuse the stat-vector method itself: AFLDB holds no
AFL-API-side per-player box score for the other ~204 2025 matches, only the
Brownlow vote payload's player/team identifiers. It instead implements a
DELIBERATELY WEAKER, clearly separately-labelled evidence class:

    match_method = 'afl_api_name_team_season_bootstrap'

never 'afl_api_stat_vector_bootstrap'. A row this tool proposes must never be
mistaken, in the database or in any report, for the exact-stat-vector class.

Acceptance rule (this tool's own, not S6.3's -- deliberately conservative):
  For a provider id not already resolved (re-checked against LIVE
  afldb_test, exactly the `resolveAflApiPlayer()` predicate, never a cached
  list):
    (a) map the provider's Brownlow-vote team (CD_T...) to a club via the
        SAME data/reference/afl-api-identities.json S1 map S5 uses;
    (b) collect every canonical player who played >=1 afltables-sourced
        match for that club in season 2025 (player_match_stats join
        matches), i.e. real recorded 2025 playing evidence for that club --
        never a whole-of-career or cross-club search;
    (c) normalise both the provider's observed (given_name, surname) and
        each 2025-club-roster player's (given_name, surname) with the exact
        S5 normalise_surname() transform (strip accents/punctuation,
        uppercase, letters only) applied to EACH name part;
    (d) accept as a "linked" CANDIDATE only when EXACTLY ONE 2025-club-roster
        player's normalised (given_name, surname) equals the provider's, and
        that player_id is not also the sole candidate for a different
        still-unresolved provider id in this same run (S5 rule (b), reused);
    (e) zero matches -> disposition "unresolved" (no candidate); more than
        one match, or a player_id shared with another provider id in this
        run -> disposition "ambiguous" or "contradictory" -- NEVER guessed.

Every "linked" row here is candidate evidence for OPERATOR REVIEW, not an
equally-trusted peer of S5's exact stat-vector class -- this tool's own
match_method makes that distinction durable in the database and in every
downstream report. This tool never writes a database; it writes one
artefact: data/reference/afl-api-brownlow-name-bridge-<date>.json, in
exactly the shape import_afl_api_player_bridge.py already reads (that
importer was generalised, Sec S5b, to accept this match_method alongside
S5's; see its module docstring).

Usage:
    python tools/migration/build_afl_api_brownlow_name_bridge.py --validate-only
    python tools/migration/build_afl_api_brownlow_name_bridge.py --write
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
from urllib.parse import urlparse

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402  (tools/migration/common.py)

TOOL = "tools/migration/build_afl_api_brownlow_name_bridge.py"
TOOL_VERSION = "1.0.0"

REPO_ROOT = Path(__file__).resolve().parents[2]
BROWNLOW_SEASON_DIR = REPO_ROOT / "data" / "sources" / "AFLWebsite" / "BrownlowSamples" / "brownlow-samples"
IDENTITIES_PATH = REPO_ROOT / "data" / "reference" / "afl-api-identities.json"
OUT_DIR = REPO_ROOT / "data" / "reference"

DSN_ENV = "AFLDB_TEST_DATABASE_URL"
REQUIRED_DATABASE = "afldb_test"

SOURCE_KEY = "afl_api"
MATCH_METHOD = "afl_api_name_team_season_bootstrap"
SEASON = 2025


class BridgeSourceError(ValueError):
    """The tracked Brownlow capture violates an assumption this builder relies on."""


class BridgeEvidenceError(ValueError):
    """A read-only afldb_test evidence step failed in a way that must halt the run."""


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def resolve_dsn(environ: dict | None = None) -> str:
    """AFLDB_TEST_DATABASE_URL, targeting /afldb_test, nothing else.

    Mirrors build_afl_api_player_bridge.py's resolve_dsn() exactly (D-9).
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
        application_name="afldb-build-afl-api-brownlow-name-bridge",
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


def normalise_name_part(raw: str | None) -> str:
    """Strip accents and punctuation, uppercase. Comparison only -- never a match key.

    Byte-for-byte the same transform as build_afl_api_player_bridge.py's
    normalise_surname(), applied here to BOTH given_name and surname so a
    provider "Nic" vs canonical "Nic" still has to agree exactly -- this
    tool does nickname expansion NOWHERE. A genuine nickname mismatch
    (e.g. provider "Nic" vs canonical "Nicholas") is meant to fall to
    "unresolved" and go to human review, not be guessed past.
    """
    if not raw:
        return ""
    text = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z]", "", text.upper())


# ---------------------------------------------------------------------------
# Brownlow season capture (pinned, hash-checked, cross-validated)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProviderVoter:
    provider_id: str
    given_name: str
    surname: str
    team_provider_id: str
    team_abbr: str


def load_brownlow_population(season: int) -> tuple[dict[str, ProviderVoter], Path, Path]:
    """The tracked, immutable full-season capture -- same file and same
    proven-complete check census-afl-api-brownlow-identities.ts uses
    (06-validation.json: matchVoteRecords, voteRows, brownlowPlayers).
    Refuses if this parse does not reproduce those three counts.
    """
    season_dir = BROWNLOW_SEASON_DIR / str(season)
    season_path = season_dir / "01-brownlow-season.raw.json"
    validation_path = season_dir / "06-validation.json"
    if not season_path.exists():
        raise BridgeSourceError(f"season capture not found: {season_path}")
    if not validation_path.exists():
        raise BridgeSourceError(f"validation manifest not found: {validation_path}")

    raw = json.loads(season_path.read_text(encoding="utf-8"))
    validation = json.loads(validation_path.read_text(encoding="utf-8"))

    match_votes = raw.get("matchVotes")
    if not isinstance(match_votes, list):
        raise BridgeSourceError(f"{season_path}: matchVotes must be an array")

    population: dict[str, ProviderVoter] = {}
    seen_match_ids: set[str] = set()
    vote_rows = 0
    for index, entry in enumerate(match_votes):
        path = f"{season_path}:matchVotes[{index}]"
        match_id = entry.get("matchId")
        if not isinstance(match_id, str):
            raise BridgeSourceError(f"{path}: missing matchId")
        if match_id in seen_match_ids:
            raise BridgeSourceError(f"{path}: duplicate matchId {match_id!r}")
        seen_match_ids.add(match_id)

        votes = entry.get("votes")
        if not isinstance(votes, list) or len(votes) != 3:
            raise BridgeSourceError(
                f"{path}: match {match_id!r} carries "
                f"{len(votes) if isinstance(votes, list) else 'no'} vote row(s); expected exactly 3"
            )
        for vote in votes:
            vote_rows += 1
            player = vote.get("player") or {}
            team = vote.get("team") or {}
            provider_id = player.get("playerId")
            if not isinstance(provider_id, str):
                raise BridgeSourceError(f"{path}: vote row missing player.playerId")
            if provider_id not in population:
                population[provider_id] = ProviderVoter(
                    provider_id=provider_id,
                    given_name=player.get("givenName") or "",
                    surname=player.get("surname") or "",
                    team_provider_id=team.get("teamId") or "",
                    team_abbr=team.get("teamAbbr") or "",
                )

    mismatches = []
    if len(match_votes) != validation.get("matchVoteRecords"):
        mismatches.append(
            f"match vote records: parsed {len(match_votes)}, "
            f"validation.json says {validation.get('matchVoteRecords')}"
        )
    if vote_rows != validation.get("voteRows"):
        mismatches.append(f"vote rows: parsed {vote_rows}, validation.json says {validation.get('voteRows')}")
    if len(population) != validation.get("brownlowPlayers"):
        mismatches.append(
            f"distinct players: parsed {len(population)}, "
            f"validation.json says {validation.get('brownlowPlayers')}"
        )
    if mismatches:
        raise BridgeSourceError(
            f"Parsed population does not match {validation_path}:\n  " + "\n  ".join(mismatches)
            + "\nRefusing to build a bridge over a capture that does not prove itself complete."
        )

    return population, season_path, validation_path


def load_team_identities() -> dict[str, str]:
    """CD_T<id> -> clubs.legacy_club_hist, from the S1 reference map.

    Identical to build_afl_api_player_bridge.py's load_team_identities().
    """
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


# ---------------------------------------------------------------------------
# afldb_test canonical evidence (read-only)
# ---------------------------------------------------------------------------


def fetch_source_id(cur) -> int:
    cur.execute("SELECT id FROM sources WHERE key = %s", (SOURCE_KEY,))
    row = cur.fetchone()
    if row is None:
        raise BridgeEvidenceError(f"unknown source key: {SOURCE_KEY!r}")
    return row[0]


def already_resolved(cur, source_id: int, provider_ids: list[str]) -> set[str]:
    """Exactly resolveAflApiPlayer()'s predicate (afl-api-player-resolver.ts),
    re-checked against LIVE afldb_test -- never a cached/hardcoded list, so
    this builder stays correct if external_identities changes between runs.
    """
    cur.execute(
        """SELECT external_id FROM external_identities
            WHERE source_id = %s AND external_id = ANY(%s)
              AND status IN ('unique', 'resolved') AND player_id IS NOT NULL""",
        (source_id, provider_ids),
    )
    return {row[0] for row in cur.fetchall()}


def club_id_by_hist(cur, hist_values: set[str]) -> dict[str, int]:
    if not hist_values:
        return {}
    cur.execute(
        "SELECT legacy_club_hist, id FROM clubs WHERE legacy_club_hist = ANY(%s)",
        (list(hist_values),),
    )
    return {hist: club_id for hist, club_id in cur.fetchall()}


@dataclass
class RosterPlayer:
    player_id: int
    given_name: str | None
    surname: str | None


def season_club_roster(cur, club_id: int, season: int) -> list[RosterPlayer]:
    """Every canonical player with >=1 recorded match for this club in this
    season -- real 2025 playing evidence, never a whole-of-career search.
    """
    cur.execute(
        """SELECT DISTINCT p.id, p.given_name, p.surname
             FROM player_match_stats pms
             JOIN matches m ON m.id = pms.match_id
             JOIN players p ON p.id = pms.player_id
            WHERE m.season = %s AND pms.club_id = %s""",
        (season, club_id),
    )
    return [RosterPlayer(player_id=r[0], given_name=r[1], surname=r[2]) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Classification (this tool's own acceptance rule -- see module docstring)
# ---------------------------------------------------------------------------


def classify(
    population: dict[str, ProviderVoter],
    unresolved_ids: list[str],
    team_identities: dict[str, str],
    conn: psycopg.Connection,
    season: int,
) -> dict[str, dict]:
    report: dict[str, dict] = {}
    roster_cache: dict[int, list[RosterPlayer]] = {}

    with conn.cursor() as cur:
        hist_values = {
            team_identities[population[pid].team_provider_id]
            for pid in unresolved_ids
            if population[pid].team_provider_id in team_identities
        }
        club_ids = club_id_by_hist(cur, hist_values)

        provisional: dict[str, int] = {}
        candidates_by_id: dict[str, list[dict]] = {}
        for provider_id in unresolved_ids:
            voter = population[provider_id]
            base = {
                "observed_name": " ".join(p for p in (voter.given_name, voter.surname) if p) or None,
                "observed_team_provider_id": voter.team_provider_id,
                "observed_team_abbr": voter.team_abbr,
            }
            hist = team_identities.get(voter.team_provider_id)
            if hist is None:
                report[provider_id] = {
                    **base, "disposition": "unresolved",
                    "reason": f"unmapped_team_provider_id({voter.team_provider_id})",
                    "candidates": [],
                }
                continue
            club_id = club_ids.get(hist)
            if club_id is None:
                report[provider_id] = {
                    **base, "disposition": "unresolved",
                    "reason": f"unmapped_club_hist({hist})",
                    "candidates": [],
                }
                continue

            if club_id not in roster_cache:
                roster_cache[club_id] = season_club_roster(cur, club_id, season)
            roster = roster_cache[club_id]
            target = (normalise_name_part(voter.given_name), normalise_name_part(voter.surname))
            matches = [
                r for r in roster
                if (normalise_name_part(r.given_name), normalise_name_part(r.surname)) == target
                and target != ("", "")
            ]
            candidate_list = [
                {"player_id": m.player_id, "given_name": m.given_name, "surname": m.surname}
                for m in matches
            ]
            candidates_by_id[provider_id] = candidate_list

            if len(matches) == 0:
                report[provider_id] = {
                    **base, "disposition": "unresolved",
                    "reason": f"no_candidate(club_id={club_id}, season={season})",
                    "candidates": [],
                }
            elif len(matches) > 1:
                report[provider_id] = {
                    **base, "disposition": "ambiguous",
                    "reason": f"multiple_candidate_players({sorted(m.player_id for m in matches)})",
                    "candidates": candidate_list,
                }
            else:
                provisional[provider_id] = matches[0].player_id
                report[provider_id] = {**base, "candidates": candidate_list}

        # Rule (b), reused from S5: a player_id claimed by more than one
        # still-unresolved provider id in THIS run voids all of them.
        by_player: dict[int, list[str]] = {}
        for provider_id, player_id in provisional.items():
            by_player.setdefault(player_id, []).append(provider_id)
        for player_id, ids in by_player.items():
            if len(ids) > 1:
                for provider_id in ids:
                    report[provider_id]["disposition"] = "contradictory"
                    report[provider_id]["reason"] = f"shared_player_id({player_id}: {', '.join(sorted(ids))})"
                del_ids = set(ids)
                for provider_id in del_ids:
                    provisional.pop(provider_id, None)

        if provisional:
            cur.execute(
                "SELECT id, surname FROM players WHERE id = ANY(%s)",
                (list(set(provisional.values())),),
            )
            surnames = dict(cur.fetchall())
            for provider_id, player_id in provisional.items():
                report[provider_id]["disposition"] = "linked"
                report[provider_id]["reason"] = None
                report[provider_id]["candidate_player_id"] = player_id
                report[provider_id]["canonical_surname"] = surnames.get(player_id)
                report[provider_id]["evidence_summary"] = (
                    f"unique {season} club-roster name match (given_name+surname, normalised); "
                    "NOT a stat-vector match -- operator review recommended before apply"
                )

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


def build_artefact(provider_report: dict[str, dict], input_hashes: list[dict], season: int) -> dict:
    counts = {"providers_in_scope": len(provider_report)}
    for disposition in ("linked", "unresolved", "ambiguous", "contradictory"):
        counts[disposition] = sum(1 for r in provider_report.values() if r.get("disposition") == disposition)
    return {
        "tool": TOOL,
        "tool_version": TOOL_VERSION,
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_key": SOURCE_KEY,
        "match_method": MATCH_METHOD,
        "season": season,
        "acceptance_rule": (
            "unique normalised (given_name, surname) match within the canonical "
            f"season-{season} club roster of the provider's Brownlow-vote team; "
            "name+team+season evidence, NOT stat-vector evidence"
        ),
        "inputs": input_hashes,
        "providers": provider_report,
        "counts": counts,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--validate-only", action="store_true",
                        help="Build the candidate report in memory and print it; write nothing.")
    group.add_argument("--write", action="store_true",
                        help="Build the candidate artefact and write it to data/reference/.")
    parser.add_argument("--season", type=int, default=SEASON)
    parser.add_argument("--out", type=Path, default=None,
                        help="Output path (default: data/reference/afl-api-brownlow-name-bridge-<date>.json)")
    args = parser.parse_args(argv)

    common.load_env()
    rep = Reporter()
    try:
        dsn = resolve_dsn()
        population, season_path, validation_path = load_brownlow_population(args.season)
        team_identities = load_team_identities()
        rep.step(f"Brownlow {args.season} population: {len(population)} distinct provider player(s), proven complete")

        conn = open_read_only(dsn)
        try:
            with conn.cursor() as cur:
                source_id = fetch_source_id(cur)
                resolved_now = already_resolved(cur, source_id, list(population.keys()))
            unresolved_ids = sorted(set(population.keys()) - resolved_now)
            rep.step(
                f"{len(resolved_now)} already trusted-resolved (recomputed live); "
                f"{len(unresolved_ids)} in scope for this bridge"
            )
            provider_report = classify(population, unresolved_ids, team_identities, conn, args.season)
        finally:
            conn.rollback()
            conn.close()

        input_hashes = [
            {"file": str(season_path.relative_to(REPO_ROOT)), "sha256": sha256_file(season_path)},
            {"file": str(validation_path.relative_to(REPO_ROOT)), "sha256": sha256_file(validation_path)},
            {"file": str(IDENTITIES_PATH.relative_to(REPO_ROOT)), "sha256": sha256_file(IDENTITIES_PATH)},
        ]
        artefact = build_artefact(provider_report, input_hashes, args.season)
    except (BridgeSourceError, BridgeEvidenceError) as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1

    for label, count in artefact["counts"].items():
        rep.result(label, count)
    for provider_id, row in sorted(provider_report.items()):
        if row.get("disposition") != "linked":
            rep.warn(
                f"{provider_id} ({row.get('observed_name')}, {row.get('observed_team_abbr')}): "
                f"{row.get('disposition')} -- {row.get('reason')}"
                + (f" candidates={row.get('candidates')}" if row.get("candidates") else "")
            )

    if args.write:
        out_path = args.out or (OUT_DIR / f"afl-api-brownlow-name-bridge-{date.today().isoformat()}.json")
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
