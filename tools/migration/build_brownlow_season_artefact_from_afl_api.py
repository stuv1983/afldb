#!/usr/bin/env python3
"""AFLDB-ISSUE-228 Stage S7 (Sec 10, Sec 16 S7) -- offline builder for the
completed-season Brownlow artefact, sourced from AFL API (AFL.com.au)
Brownlow evidence instead of the ISSUE-113 legacy recovery-database export.

This tool never writes a database and never makes a network request. It
reads:

* one immutable, already-acquired AFL API Brownlow snapshot, hash-verified
  against its own manifest, under
  ``data/sources/afl_api/brownlow/<label>/`` (Sec 5.4, written by
  ``tools/current-season/acquire-afl-api-brownlow.ts``):
  ``01-brownlow-season.raw.json`` (the ``matchVotes`` feed) and
  ``02-brownlow-leaderboard.raw.json`` (the leaderboard feed);
* one or more explicit, already-built trusted identity-bridge artefacts
  (``--bridge``, repeatable), each naming durable ``CD_I... -> players.id``
  links this builder is allowed to trust -- the Stage S5 stat-vector
  bootstrap (``data/reference/afl-api-player-bridge-<date>.json``, built by
  ``tools/migration/build_afl_api_player_bridge.py``) and/or the Stage S5b
  name+team+season bootstrap (``data/reference/afl-api-brownlow-name-bridge-
  <date>.json``, built by ``tools/migration/build_afl_api_brownlow_name_bridge.py``).
  Both artefacts share one ``providers``/``disposition``/``candidate_player_id``
  contract (the same one ``import_afl_api_player_bridge.py`` already reads via
  its ``ALLOWED_MATCH_METHODS``), so they combine as a fail-closed union
  (``load_bridges()``) rather than needing a bridge-specific merge rule;
* ``afldb_test`` READ-ONLY (``AFLDB_TEST_DATABASE_URL`` by default), for two
  facts no tracked file carries: a resolved player's AFL Tables profile path
  (``external_identities``, exactly the identity the ISSUE-113 artefact is
  keyed by) and their home-and-away games played that season
  (``player_season_stats``), the same table and formula the manual Brownlow
  publication path already uses (``writeSeasonRows()`` in
  ``src/db/queries/admin-brownlow.ts``).

It writes at most two files, both season-scoped and never touching the
tracked ISSUE-113 master artefact (``data/brownlow/season-votes.csv``):
``data/brownlow/season-votes-afl_api-<season>.csv`` and its companion
``...manifest.json``. Merging a season-scoped artefact into the master file
is a rollover decision (ISSUE-101/F), deliberately out of scope here.

=============================================================================
Row contract (Sec "do not invent a new artefact format")
=============================================================================

The CSV columns, order, quoting and the ``(season, afltables_profile_url)``
ascending row order are EXACTLY ``tools/migration/import_brownlow_season.py``'s
``HEADER`` and its ``load_artefact()`` ordering check -- the one artefact
shape an AFLDB consumer already defines. A file this builder writes parses
cleanly with that loader's ``load_artefact()`` unchanged. What is NOT reused
is ``import_brownlow_season.py``'s MANIFEST schema and its identity
adjudication file (``player-identity.csv``): both exist to describe one-time
gap-filling of LEGACY recovery-database rows that had no AFL Tables profile
path at all (Sec 8.12). Every row this builder emits already carries a real,
DB-verified ``afltables_profile_url`` -- there is no gap to adjudicate, and
manufacturing an adjudication file with no factual basis just to satisfy that
loader's unrelated ``--validate-only`` shape would be inventing provenance,
not reusing a contract. This manifest instead records this builder's own,
real provenance (snapshot label + hashes, bridge file + hash, DB evidence).

=============================================================================
What the season artefact needs, and what it does not
=============================================================================

``brownlow_season_votes`` (migration 005 / ``SeasonVoteRow`` above) carries
no round number at all -- unlike the round-vote grain
(``brownlow_round_votes``, settled live by ``afl-api-brownlow.ts``), a
season total does not care WHICH week a match was played in, only that its
3-2-1 was awarded and counted. This builder therefore never resolves a vote
set's ``CD_M`` to a canonical match and never calls
``translateAflApiBrownlowRound()``: the Sec 6.4 round-translation contract
and the Sec 10 "legitimate reschedule" handling are match/round-vote
concerns this artefact structurally cannot regress, because it carries no
round field to get wrong (Sec 16 S7 tests, item I). Finals exclusion is
likewise structural: the bfawards feed never publishes finals vote records
(Sec 2.5, Sec 10), so no defensive per-match ``is_final`` check is needed
(or possible without a match resolution this artefact does not otherwise
require).

What this builder DOES faithfully reuse is the season-row DERIVATION
algorithm itself: ``competitionRanks()`` / ``deriveSeasonRows()`` in
``src/lib/brownlow/entry.ts`` is the measured, tested, already-in-production
convention (AFLDB-ISSUE-155 preflight P13, cited there) for turning a set of
per-round vote facts into ``vote_rank`` (competition rank over ALL polled
players), ``eligible_rank`` (competition rank over the eligible only, NULL
for an ineligible player), ``is_winner`` (`eligible_rank == 1`, never the AFL
API leaderboard's own ``winner`` flag), and the NULL-for-zero
``three_vote_games`` / ``two_vote_games`` / ``one_vote_games``. This module
reimplements that algorithm in pure Python (it cannot import TypeScript),
line-for-line the same shape, rather than deriving totals from the AFL API
leaderboard's own ``totalVotes``/``eligible``/``winner`` fields, which are
used ONLY as an advisory reconciliation and eligibility witness (Sec 10:
"reconstructed per-player totals == leaderboard totalVotes ... blocking at
the end").

=============================================================================
Identity resolution (Sec 6.3, T1) -- fail closed, no fuzzy matching
=============================================================================

Every provider player id appearing in a vote set must resolve through the
COMBINED union of the supplied ``--bridge`` artefact(s)' ``disposition:
"linked"`` rows ONLY (``load_bridges()``, 2026-09-20 identity-union fix --
see below), then through a DB-verified, unambiguous ``afltables_profile_url``.
A single unresolved or ambiguous identity anywhere refuses THE WHOLE MATCH'S
3-row vote set (Sec 10: "a match's vote set is one unit, all-or-none"), and
one or more refused vote sets refuses THE WHOLE ARTEFACT BUILD -- nothing is
written -- mirroring ``import_brownlow_season.py``'s own "zero rejections or
no write" contract (Sec 8.6 item 3) rather than silently shipping a partial
season total that loader would reject anyway. Every refusal is reported, not
just the first.

Sec 6.3's T1 bootstrap population happened in two passes with two distinct,
separately-labelled evidence classes -- the S5 exact stat-vector bootstrap
(``afl_api_stat_vector_bootstrap``) and the weaker S5b name+team+season
bootstrap (``afl_api_name_team_season_bootstrap``) -- and each pass wrote its
OWN tracked artefact rather than amending the other's. A builder that trusts
only the S5 artefact therefore sees a materially incomplete identity set for
any season S5b's follow-up population covers. ``--bridge`` is repeatable for
exactly this reason: pass every trusted artefact that applies to the season
being built, and ``load_bridges()`` combines their ``linked`` rows into one
map, refusing (never guessing) on any cross-artefact contradiction -- the
same provider id linked to two different players, or Sec 6.3 rule (b) (one
player_id claimed by more than one provider id) violated only once the sets
are combined. An identical mapping repeated across artefacts is not a
contradiction and is deduplicated; the combined provenance records every
artefact that supplied each mapping. Zero combined trusted mappings across
every supplied ``--bridge`` artefact refuses the whole run.

AFLDB-ISSUE-241 (2026-09-26): a bridge's ``candidate_player_id`` is a
database-local surrogate that a rebuild or promotion may renumber, so it is no
longer trusted on its own. Every ``--bridge`` must declare
``player_identity_contract: "afldb.afl_api_bridge.stable_identity.v1"`` and
every linked row must carry ``candidate_player_identity`` (its accepted stable
identity); a lineage-unbound bridge -- every artefact built before ISSUE-241 --
is refused, never upgraded. The id is still what this builder looks up, but
``verify_bridge_identities()`` then requires the looked-up player's own AFL
Tables profile path to EQUAL the row's identity: a stale id that now names
someone else refuses the whole build. This builder does not re-resolve a
renumbered player (the loader, ``import_afl_api_player_bridge.ts``, does); it
only refuses, which is the fail-closed answer for an offline artefact builder.

=============================================================================
Completion gate (Sec 10, T3)
=============================================================================

Refuses unless BOTH the ``matchVotes`` feed's own ``status`` and the
leaderboard feed's own ``status`` are exactly ``CONCLUDED`` -- a LIVE or
partial count never reaches this builder's output, matching the
canonical-season loader's own refusal of ``in_progress`` seasons
(Sec 8.6 item 2) one layer upstream, before the artefact even exists.

Usage (``--bridge`` is repeatable -- pass every trusted bridge artefact that
applies to the season being built; see "Identity resolution" above):
    python tools/migration/build_brownlow_season_artefact_from_afl_api.py \\
        --label afl-api-brownlow-2025-2025-09-28-153000 \\
        --bridge data/reference/afl-api-player-bridge-2026-09-20.json \\
        --bridge data/reference/afl-api-brownlow-name-bridge-2026-09-20.json \\
        --validate-only

    python tools/migration/build_brownlow_season_artefact_from_afl_api.py \\
        --label afl-api-brownlow-2025-2025-09-28-153000 \\
        --bridge data/reference/afl-api-player-bridge-2026-09-20.json \\
        --bridge data/reference/afl-api-brownlow-name-bridge-2026-09-20.json \\
        --write
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402  (tools/migration/common.py)
from import_brownlow_season import (  # noqa: E402
    HEADER,
    NULLABLE_SMALLINTS,
    BrownlowSeasonSourceError as LoaderContractError,
    load_artefact as load_artefact_via_loader,
)

TOOL = "tools/migration/build_brownlow_season_artefact_from_afl_api.py"
TOOL_VERSION = "1.0.0"

REPO_ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT_ROOT = REPO_ROOT / "data" / "sources" / "afl_api" / "brownlow"
OUT_DIR = REPO_ROOT / "data" / "brownlow"

DSN_ENV_DEFAULT = "AFLDB_TEST_DATABASE_URL"
REQUIRED_DATABASE_DEFAULT = "afldb_test"

SOURCE_KEY = "afl_api"
LINK_STATUS_VALUE = "unique"  # Sec 6.3: the bootstrap bridge writes 'unique' only, never 'resolved'.
VALID_VOTE_VALUES = (3, 2, 1)
MANIFEST_SCHEMA_VERSION = 2  # v2 (2026-09-20): "bridge" is a list of {file, sha256,
# linked_providers_contributed} entries (one per --bridge artefact), not a single object --
# the identity-union fix makes --bridge repeatable.

# AFLDB-ISSUE-241: the stable-identity contract every --bridge must declare, and the per-row
# field it binds (src/lib/acquisition/afl-api-bridge-identity.ts is the one definition).
BRIDGE_IDENTITY_CONTRACT = "afldb.afl_api_bridge.stable_identity.v1"
BRIDGE_CONTRACT_FIELD = "player_identity_contract"
BRIDGE_IDENTITY_FIELD = "candidate_player_identity"


class BrownlowArtefactSourceError(ValueError):
    """The snapshot, bridge artefact, or their contents violate a contract this builder relies on."""


class BrownlowArtefactEvidenceError(ValueError):
    """A read-only DB evidence step failed in a way that must halt the run."""


class BrownlowArtefactRefused(RuntimeError):
    """One or more vote sets failed identity resolution or reconciliation; nothing was written."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _rel(path: Path) -> str:
    """A repo-relative string for a manifest provenance field when possible, the plain path
    otherwise (e.g. a --snapshot-root/--bridge/--out override outside REPO_ROOT, test-only)."""
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


# ---------------------------------------------------------------------------
# Snapshot: manifest verification (mirrors settle-afl-api-brownlow.ts
# verifyManifest() -- every file re-hashed before it is trusted) and parsing
# (mirrors afl-api-bundle.ts emitAflApiBrownlowMatchVotes() /
# emitAflApiBrownlowLeaderboard()'s validation exactly, reimplemented in
# Python because this builder cannot import TypeScript).
# ---------------------------------------------------------------------------


def verify_snapshot_manifest(snapshot_dir: Path) -> dict[str, Any]:
    manifest_path = snapshot_dir / "manifest.json"
    if not manifest_path.exists():
        raise BrownlowArtefactSourceError(
            f"no manifest.json under {snapshot_dir} -- the Brownlow acquisition did not complete")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise BrownlowArtefactSourceError(f"{manifest_path}: not a JSON object")
    if manifest.get("source_key") != "afl_api":
        raise BrownlowArtefactSourceError(
            f"{manifest_path}: source_key is {manifest.get('source_key')!r}, expected 'afl_api'")
    if manifest.get("acquisition_kind") != "afl_api_brownlow_snapshot":
        raise BrownlowArtefactSourceError(
            f"{manifest_path}: acquisition_kind is {manifest.get('acquisition_kind')!r}, "
            "expected 'afl_api_brownlow_snapshot'")
    season = manifest.get("season")
    if not isinstance(season, int):
        raise BrownlowArtefactSourceError(f"{manifest_path}: carries no integer season")
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise BrownlowArtefactSourceError(f"{manifest_path}: no files declared")
    for entry in files:
        if not isinstance(entry, dict) or "file" not in entry or "sha256" not in entry:
            raise BrownlowArtefactSourceError(f"{manifest_path}: malformed file entry {entry!r}")
        full = snapshot_dir / entry["file"]
        if not full.exists():
            raise BrownlowArtefactSourceError(f"manifest names {entry['file']!r} but it is not on disk")
        actual = sha256_file(full)
        if actual != entry["sha256"]:
            raise BrownlowArtefactSourceError(
                f"{entry['file']!r} has changed since acquisition (sha256 mismatch) -- refusing to "
                "build from a snapshot that is no longer immutable")
    return manifest


def _require_object(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise BrownlowArtefactSourceError(f"{path} must be an object")
    return value


def _require_str(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value:
        raise BrownlowArtefactSourceError(f"{path} missing or empty")
    return value


def _require_int_from_number(value: Any, path: str) -> int:
    """Sec 4.4: AFL counts are JSON floats; an integral float is the integer, never coerced from a fraction."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise BrownlowArtefactSourceError(f"{path} must be a number, got {value!r}")
    if float(value) != int(value):
        raise BrownlowArtefactSourceError(f"{path}: non-integral value {value!r}")
    return int(value)


@dataclass(frozen=True)
class VoteRow:
    provider_player_id: str
    provider_team_id: str
    votes: int


@dataclass(frozen=True)
class MatchVoteSet:
    provider_match_id: str
    api_round_number: int
    votes: tuple[VoteRow, ...]


def parse_match_votes(raw: Any) -> tuple[list[MatchVoteSet], str | None]:
    row = _require_object(raw, "brownlowSeason")
    match_votes = row.get("matchVotes")
    if not isinstance(match_votes, list):
        raise BrownlowArtefactSourceError("brownlowSeason.matchVotes must be an array")

    sets: list[MatchVoteSet] = []
    seen_match_ids: set[str] = set()
    for index, entry_raw in enumerate(match_votes):
        path = f"matchVotes[{index}]"
        entry = _require_object(entry_raw, path)
        provider_match_id = _require_str(entry.get("matchId"), f"{path}.matchId")
        if provider_match_id in seen_match_ids:
            raise BrownlowArtefactSourceError(
                f"duplicate matchId {provider_match_id!r} in brownlowSeason.matchVotes")
        seen_match_ids.add(provider_match_id)

        votes_raw = entry.get("votes")
        if not isinstance(votes_raw, list) or len(votes_raw) != 3:
            got = len(votes_raw) if isinstance(votes_raw, list) else "no"
            raise BrownlowArtefactSourceError(
                f"match {provider_match_id!r} carries {got} vote row(s); expected exactly 3")

        rows: list[VoteRow] = []
        for vote_index, vote_raw in enumerate(votes_raw):
            vpath = f"{path}.votes[{vote_index}]"
            vote = _require_object(vote_raw, vpath)
            player = _require_object(vote.get("player"), f"{vpath}.player")
            team = _require_object(vote.get("team"), f"{vpath}.team")
            rows.append(VoteRow(
                provider_player_id=_require_str(player.get("playerId"), f"{vpath}.player.playerId"),
                provider_team_id=_require_str(team.get("teamId"), f"{vpath}.team.teamId"),
                votes=_require_int_from_number(vote.get("votes"), f"{vpath}.votes"),
            ))

        values = sorted((r.votes for r in rows), reverse=True)
        if values != list(VALID_VOTE_VALUES):
            raise BrownlowArtefactSourceError(
                f"match {provider_match_id!r} vote values are {values}; expected exactly [3, 2, 1]")

        players = [r.provider_player_id for r in rows]
        if len(set(players)) != len(players):
            raise BrownlowArtefactSourceError(
                f"match {provider_match_id!r} has a duplicate player within its vote set")

        api_round_number = _require_int_from_number(entry.get("roundNumber"), f"{path}.roundNumber")
        sets.append(MatchVoteSet(provider_match_id=provider_match_id, api_round_number=api_round_number,
                                  votes=tuple(rows)))

    status = row.get("status")
    return sets, status if isinstance(status, str) else None


@dataclass(frozen=True)
class LeaderboardEntry:
    provider_player_id: str
    votes: int
    eligible: bool


def parse_leaderboard(raw: Any) -> tuple[list[LeaderboardEntry], str | None]:
    row = _require_object(raw, "brownlowLeaderboard")
    leaderboard = row.get("leaderboard")
    if not isinstance(leaderboard, list):
        raise BrownlowArtefactSourceError("brownlowLeaderboard.leaderboard must be an array")

    entries: list[LeaderboardEntry] = []
    seen: set[str] = set()
    for index, entry_raw in enumerate(leaderboard):
        path = f"leaderboard[{index}]"
        entry = _require_object(entry_raw, path)
        player = _require_object(entry.get("player"), f"{path}.player")
        provider_player_id = _require_str(player.get("playerId"), f"{path}.player.playerId")
        if provider_player_id in seen:
            raise BrownlowArtefactSourceError(
                f"duplicate leaderboard entry for provider player {provider_player_id!r}")
        seen.add(provider_player_id)
        entries.append(LeaderboardEntry(
            provider_player_id=provider_player_id,
            votes=_require_int_from_number(entry.get("totalVotes"), f"{path}.totalVotes"),
            eligible=entry.get("eligible") is True,
        ))

    status = row.get("status")
    return entries, status if isinstance(status, str) else None


def require_concluded(match_status: str | None, leaderboard_status: str | None) -> None:
    """Sec 10, T3: refuse a LIVE/partial count outright; never build a completed-season
    artefact from anything but a provider-confirmed CONCLUDED count on both feeds."""
    if match_status != "CONCLUDED":
        raise BrownlowArtefactSourceError(
            f"brownlowSeason.status is {match_status!r}, not 'CONCLUDED' -- refusing to build a "
            "completed-season artefact from a LIVE or partial count")
    if leaderboard_status != "CONCLUDED":
        raise BrownlowArtefactSourceError(
            f"brownlowLeaderboard.status is {leaderboard_status!r}, not 'CONCLUDED' -- refusing to "
            "build a completed-season artefact from a LIVE or partial count")


def reconcile_leaderboard(
    match_votes: list[MatchVoteSet], leaderboard: list[LeaderboardEntry],
) -> list[tuple[str, int, int]]:
    """Sec 10: reconstructed per-player totals from matchVotes must equal the leaderboard's own
    total. Pure comparison, mirrors reconcileBrownlowLeaderboard() (afl-api-bundle.ts). Returns
    (provider_player_id, reconstructed_total, leaderboard_total) for every mismatch."""
    totals: dict[str, int] = {}
    for match in match_votes:
        for vote in match.votes:
            totals[vote.provider_player_id] = totals.get(vote.provider_player_id, 0) + vote.votes
    mismatches: list[tuple[str, int, int]] = []
    for entry in leaderboard:
        reconstructed = totals.get(entry.provider_player_id, 0)
        if reconstructed != entry.votes:
            mismatches.append((entry.provider_player_id, reconstructed, entry.votes))
    return mismatches


# ---------------------------------------------------------------------------
# Stage S5 bridge: CD_I -> player_id, linked rows only (Sec 6.3, T1).
# ---------------------------------------------------------------------------


def _linked_bridge_rows(path: Path) -> list[tuple[str, int, str]]:
    """(provider id, candidate_player_id, candidate_player_identity) for every linked row, after
    the AFLDB-ISSUE-241 contract check. A lineage-unbound bridge refuses outright."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise BrownlowArtefactSourceError(f"{path}: not a JSON object")
    if data.get(BRIDGE_CONTRACT_FIELD) != BRIDGE_IDENTITY_CONTRACT:
        raise BrownlowArtefactSourceError(
            f"{path}: declares {BRIDGE_CONTRACT_FIELD}={data.get(BRIDGE_CONTRACT_FIELD)!r}, not "
            f"{BRIDGE_IDENTITY_CONTRACT!r}. It is lineage-unbound: its candidate_player_id values are "
            "database-local surrogates a rebuild or promotion may have renumbered, so it is refused, "
            "never upgraded (AFLDB-ISSUE-241)")
    providers = data.get("providers")
    if not isinstance(providers, dict) or not providers:
        raise BrownlowArtefactSourceError(f"{path}: no 'providers' in the bridge artefact")
    rows: list[tuple[str, int, str]] = []
    for provider_player_id, entry in providers.items():
        if not isinstance(entry, dict) or entry.get("disposition") != "linked":
            continue
        candidate = entry.get("candidate_player_id")
        if not isinstance(candidate, int) or isinstance(candidate, bool):
            raise BrownlowArtefactSourceError(
                f"{path}: {provider_player_id!r} is 'linked' but candidate_player_id is not an integer")
        identity = entry.get(BRIDGE_IDENTITY_FIELD)
        if not isinstance(identity, str) or not identity or identity != identity.strip():
            raise BrownlowArtefactSourceError(
                f"{path}: {provider_player_id!r} is 'linked' but carries no usable {BRIDGE_IDENTITY_FIELD}")
        rows.append((provider_player_id, candidate, identity))
    return rows


def load_bridge(path: Path) -> dict[str, int]:
    linked: dict[str, int] = {}
    for provider_player_id, candidate, _identity in _linked_bridge_rows(path):
        linked[provider_player_id] = candidate
    if not linked:
        raise BrownlowArtefactSourceError(f"{path}: the bridge artefact has no 'linked' providers")
    # Sec 6.3 rule (b): a player_id must map to no other CD_I. The S5 builder already enforces
    # this when it writes the artefact; checked again here defensively -- never trust a file on
    # disk to still satisfy an invariant its own writer proved once.
    by_player: dict[int, list[str]] = {}
    for provider_player_id, player_id in linked.items():
        by_player.setdefault(player_id, []).append(provider_player_id)
    shared = {pid: ids for pid, ids in by_player.items() if len(ids) > 1}
    if shared:
        raise BrownlowArtefactSourceError(
            f"{path}: player id(s) claimed by more than one linked provider id: {shared}")
    return linked


def load_bridges(paths: list[Path]) -> tuple[dict[str, int], dict[str, list[Path]]]:
    """Combine one or more trusted bridge artefacts (Sec 6.3, T1) into a single provider ->
    player_id map -- the ISSUE-228 identity-union design (2026-09-20 fix). The S5 stat-vector
    bootstrap and the S5b name+team+season bootstrap share one ``providers``/``disposition``/
    ``candidate_player_id`` contract (the same one ``import_afl_api_player_bridge.py`` already
    reads via its ``ALLOWED_MATCH_METHODS``), so they combine as a plain union of ``linked`` rows
    rather than needing a bridge-specific merge rule.

    Each file is loaded through ``load_bridge()`` (linked-only; its Sec 6.3 rule-(b) uniqueness
    check already applies within that one file). Across files:
      - an identical provider -> player mapping repeated in more than one file is harmless and
        deduplicates, with provenance recording every file that supplied it;
      - the SAME provider id mapped to DIFFERENT players by different files is a contradiction --
        refuses the whole load rather than silently preferring either file;
      - rule (b) (a player_id claimed by more than one provider id) is re-checked over the
        COMBINED set, because two files can each be internally consistent yet jointly violate it;
      - zero combined trusted mappings refuses (fail closed), matching the single-file behaviour.
    """
    if not paths:
        raise BrownlowArtefactSourceError(
            "no --bridge artefact supplied -- refusing to run with zero trusted identities")

    combined: dict[str, int] = {}
    provenance: dict[str, list[Path]] = {}
    for path in paths:
        for provider_player_id, player_id in load_bridge(path).items():
            if provider_player_id in combined:
                if combined[provider_player_id] != player_id:
                    raise BrownlowArtefactSourceError(
                        f"provider {provider_player_id!r} is linked to player "
                        f"{combined[provider_player_id]} by {provenance[provider_player_id][0]} but "
                        f"to player {player_id} by {path} -- refusing to guess which bridge is correct")
                provenance[provider_player_id].append(path)
                continue
            combined[provider_player_id] = player_id
            provenance[provider_player_id] = [path]

    by_player_combined: dict[int, list[str]] = {}
    for provider_player_id, player_id in combined.items():
        by_player_combined.setdefault(player_id, []).append(provider_player_id)
    shared_combined = {pid: ids for pid, ids in by_player_combined.items() if len(ids) > 1}
    if shared_combined:
        raise BrownlowArtefactSourceError(
            f"combining {[str(p) for p in paths]}: player id(s) claimed by more than one linked "
            f"provider id across the combined bridge set: {shared_combined}")

    if not combined:
        raise BrownlowArtefactSourceError("the combined bridge artefacts have no 'linked' providers")

    return combined, provenance


def load_bridge_identities(paths: list[Path]) -> dict[str, str]:
    """provider id -> candidate_player_identity over every --bridge (AFLDB-ISSUE-241). The same
    provider carrying two different identities across files refuses, like two different ids."""
    identities: dict[str, str] = {}
    for path in paths:
        for provider_player_id, _candidate, identity in _linked_bridge_rows(path):
            earlier = identities.get(provider_player_id)
            if earlier is not None and earlier != identity:
                raise BrownlowArtefactSourceError(
                    f"provider {provider_player_id!r} carries identity {earlier!r} in one bridge but "
                    f"{identity!r} in {path} -- refusing to guess which bridge is correct")
            identities[provider_player_id] = identity
    return identities


def verify_bridge_identities(
    bridge: dict[str, int], identities_by_provider: dict[str, str],
    db_identities: dict[int, "PlayerIdentity"],
) -> None:
    """AFLDB-ISSUE-241: every looked-up player's own AFL Tables profile path must equal the
    identity its bridge row declares. A stale candidate_player_id -- one a rebuild or promotion
    has since given to someone else -- therefore refuses rather than attributing votes to the
    wrong profile. Only the players this build actually reads are checked; each is named by
    exactly one provider (Sec 6.3 rule (b), re-checked by load_bridges())."""
    provider_by_player = {player_id: provider for provider, player_id in bridge.items()}
    stale = []
    for player_id, identity in sorted(db_identities.items()):
        provider = provider_by_player.get(player_id)
        declared = identities_by_provider.get(provider) if provider is not None else None
        if declared != identity.afltables_profile_url:
            stale.append((provider, player_id, declared, identity.afltables_profile_url))
    if stale:
        raise BrownlowArtefactEvidenceError(
            f"{len(stale)} bridge row(s) name a player whose AFL Tables identity is not the one the row "
            "declares -- the candidate_player_id is stale for this database lineage (AFLDB-ISSUE-241); "
            f"refusing: {stale[:10]}{' ...' if len(stale) > 10 else ''}")


# ---------------------------------------------------------------------------
# Per-match-set identity resolution (Sec 10: all-or-none per match) and
# season-fact accumulation.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RefusedVoteSet:
    provider_match_id: str
    reason: str


def resolve_season_facts(
    match_votes: list[MatchVoteSet], bridge: dict[str, int],
) -> tuple[list[tuple[int, int]], list[RefusedVoteSet]]:
    """Returns (facts, refusals). facts are (player_id, votes) pairs, one per resolved vote row.
    A single unresolved or duplicate-canonical-identity player refuses the WHOLE match's 3-row
    set (Sec 10) -- none of its rows contribute a fact."""
    facts: list[tuple[int, int]] = []
    refusals: list[RefusedVoteSet] = []
    for match in match_votes:
        resolved: list[tuple[int, int]] = []
        refused = False
        for vote in match.votes:
            player_id = bridge.get(vote.provider_player_id)
            if player_id is None:
                refusals.append(RefusedVoteSet(
                    match.provider_match_id, f"unresolved_identity({vote.provider_player_id})"))
                refused = True
                break
            resolved.append((player_id, vote.votes))
        if refused:
            continue
        player_ids = [pid for pid, _ in resolved]
        if len(set(player_ids)) != len(player_ids):
            refusals.append(RefusedVoteSet(
                match.provider_match_id, f"duplicate_player_canonical_identity({sorted(set(player_ids))})"))
            continue
        facts.extend(resolved)
    return facts, refusals


def resolve_ineligible_player_ids(
    tallied_player_ids: set[int], bridge: dict[str, int], leaderboard: list[LeaderboardEntry],
) -> set[int]:
    """Sec 10: 'eligible=false is carried to the season artefact as is_ineligible'. Resolved
    only for players who actually polled (tallied) -- an ineligible player who never polled a
    vote never appears in the artefact (deriveSeasonRows is sparse by construction) and so is
    never required to resolve an identity that would go unused."""
    player_id_to_provider: dict[int, str] = {}
    for provider_player_id, player_id in bridge.items():
        player_id_to_provider[player_id] = provider_player_id
    eligible_by_provider = {entry.provider_player_id: entry.eligible for entry in leaderboard}

    ineligible: set[int] = set()
    for player_id in sorted(tallied_player_ids):
        provider_player_id = player_id_to_provider.get(player_id)
        if provider_player_id is None or provider_player_id not in eligible_by_provider:
            raise BrownlowArtefactSourceError(
                f"player {player_id} polled votes but has no leaderboard entry to confirm "
                "eligibility -- refusing rather than assuming eligible")
        if not eligible_by_provider[provider_player_id]:
            ineligible.add(player_id)
    return ineligible


# ---------------------------------------------------------------------------
# Season-row derivation: a faithful Python port of competitionRanks() /
# deriveSeasonRows() (src/lib/brownlow/entry.ts), the measured (preflight
# P13), already-in-production convention this builder must not diverge from.
# ---------------------------------------------------------------------------


def competition_ranks(sorted_descending: list[int]) -> list[int]:
    ranks: list[int] = []
    current_rank = 0
    previous: int | None = None
    for index, value in enumerate(sorted_descending):
        if previous is None or value != previous:
            current_rank = index + 1
            previous = value
        ranks.append(current_rank)
    return ranks


@dataclass(frozen=True)
class DerivedSeasonRow:
    player_id: int
    votes: int
    vote_rank: int
    eligible_rank: int | None
    is_ineligible: bool
    is_winner: bool
    games: int
    three_vote_games: int | None
    two_vote_games: int | None
    one_vote_games: int | None
    polling_games: int


def derive_season_rows(
    facts: list[tuple[int, int]],
    ineligible_player_ids: set[int],
    home_and_away_games: dict[int, int],
) -> list[DerivedSeasonRow]:
    tallies: dict[int, dict[str, int]] = {}
    for player_id, votes in facts:
        if votes not in VALID_VOTE_VALUES:
            raise BrownlowArtefactSourceError(
                f"a round fact for player {player_id} carries {votes} votes; only 1, 2 or 3 are possible")
        tally = tallies.setdefault(player_id, {"votes": 0, "three": 0, "two": 0, "one": 0, "polling": 0})
        tally["votes"] += votes
        tally["polling"] += 1
        if votes == 3:
            tally["three"] += 1
        elif votes == 2:
            tally["two"] += 1
        else:
            tally["one"] += 1

    for player_id in ineligible_player_ids:
        if player_id not in tallies:
            raise BrownlowArtefactSourceError(
                f"player {player_id} is marked ineligible but polled no votes this season")

    missing_games = sorted(pid for pid in tallies if pid not in home_and_away_games)
    if missing_games:
        raise BrownlowArtefactSourceError(
            f"no season games record for polled player(s) {missing_games}; the season cannot be "
            "built until their playing record is present")

    ordered = sorted(tallies.items(), key=lambda kv: (-kv[1]["votes"], kv[0]))
    overall_ranks = competition_ranks([tally["votes"] for _, tally in ordered])
    eligible_ordered = [(pid, tally) for pid, tally in ordered if pid not in ineligible_player_ids]
    eligible_ranks = competition_ranks([tally["votes"] for _, tally in eligible_ordered])
    eligible_rank_by_player = {
        pid: rank for (pid, _), rank in zip(eligible_ordered, eligible_ranks)
    }

    rows: list[DerivedSeasonRow] = []
    for index, (player_id, tally) in enumerate(ordered):
        is_ineligible = player_id in ineligible_player_ids
        eligible_rank = None if is_ineligible else eligible_rank_by_player.get(player_id)
        rows.append(DerivedSeasonRow(
            player_id=player_id,
            votes=tally["votes"],
            vote_rank=overall_ranks[index],
            eligible_rank=eligible_rank,
            is_ineligible=is_ineligible,
            is_winner=(not is_ineligible and eligible_rank == 1),
            games=home_and_away_games[player_id],
            three_vote_games=tally["three"] or None,
            two_vote_games=tally["two"] or None,
            one_vote_games=tally["one"] or None,
            polling_games=tally["polling"],
        ))
    return rows


# ---------------------------------------------------------------------------
# DB evidence (read-only): afltables_profile_url + display_name +
# home-and-away games, for exactly the resolved player ids. Mirrors
# build_afl_api_player_bridge.py's resolve_dsn()/open_read_only() pattern.
# ---------------------------------------------------------------------------


def resolve_dsn(env_name: str, required_database: str, environ: dict | None = None) -> str:
    env = os.environ if environ is None else environ
    dsn = env.get(env_name)
    if not dsn:
        raise BrownlowArtefactEvidenceError(
            f"{env_name} is not set -- refusing to read evidence from an unknown target")
    dsn = dsn.strip()
    parsed = urlparse(dsn)
    if parsed.scheme not in ("postgresql", "postgres"):
        raise BrownlowArtefactEvidenceError(f"{env_name} is not a postgresql:// DSN")
    if parsed.path.lstrip("/") != required_database:
        raise BrownlowArtefactEvidenceError(f"{env_name} does not target /{required_database} -- refusing")
    return dsn


def open_read_only(dsn: str, required_database: str) -> psycopg.Connection:
    conn = psycopg.connect(
        dsn, options="-c default_transaction_read_only=on -c TimeZone=UTC",
        application_name="afldb-build-brownlow-season-artefact-from-afl-api",
    )
    with conn.cursor() as cur:
        cur.execute(
            "SELECT current_setting('transaction_read_only'), "
            "current_setting('default_transaction_read_only'), current_database()")
        txn_ro, default_ro, database = cur.fetchone()
    if txn_ro != "on" or default_ro != "on":
        raise BrownlowArtefactEvidenceError("REFUSED: the server reports the transaction is not read-only")
    if database != required_database:
        raise BrownlowArtefactEvidenceError(f"REFUSED: connected database is not {required_database}")
    return conn


@dataclass(frozen=True)
class PlayerIdentity:
    afltables_profile_url: str
    display_name: str


def load_identity_and_games(
    cur, player_ids: set[int], season: int,
) -> tuple[dict[int, PlayerIdentity], dict[int, int]]:
    """(player_id -> identity, player_id -> home-and-away games) for exactly `player_ids`.

    Refuses (raises) rather than guessing on any ambiguity: more than one
    afltables_profile_url for a player, or a player with none at all.
    """
    if not player_ids:
        return {}, {}
    ids = sorted(player_ids)

    cur.execute("SELECT id, display_name FROM players WHERE id = ANY(%s)", (ids,))
    display_names = {pid: name for pid, name in cur.fetchall()}
    missing_players = sorted(set(ids) - set(display_names))
    if missing_players:
        raise BrownlowArtefactEvidenceError(
            f"the bridge names canonical player id(s) with no players row: {missing_players}")

    cur.execute(
        """SELECT ei.player_id, ei.external_id
             FROM external_identities ei
             JOIN sources s ON s.id = ei.source_id
            WHERE s.key = 'afltables' AND ei.match_method = 'afltables_profile_url'
              AND ei.status IN ('unique', 'resolved') AND ei.player_id = ANY(%s)""",
        (ids,),
    )
    urls_by_player: dict[int, set[str]] = {}
    for player_id, url in cur.fetchall():
        urls_by_player.setdefault(player_id, set()).add(url)
    ambiguous = {pid: sorted(urls) for pid, urls in urls_by_player.items() if len(urls) > 1}
    if ambiguous:
        raise BrownlowArtefactEvidenceError(
            f"player id(s) resolve to more than one afltables_profile_url: {ambiguous}")
    missing_url = sorted(set(ids) - set(urls_by_player))
    if missing_url:
        raise BrownlowArtefactEvidenceError(
            f"player id(s) have no afltables_profile_url external identity: {missing_url}")
    identities = {
        pid: PlayerIdentity(afltables_profile_url=next(iter(urls)), display_name=display_names[pid])
        for pid, urls in urls_by_player.items()
    }

    # SUM(...) rather than the admin-brownlow.ts Map-overwrite reading: a player traded
    # mid-season carries more than one player_season_stats row (one per club), and every
    # row's games/finals must count, not just the last one read.
    cur.execute(
        """SELECT player_id, SUM(games) - SUM(COALESCE(finals, 0)) AS home_and_away
             FROM player_season_stats
            WHERE season = %s AND player_id = ANY(%s)
            GROUP BY player_id""",
        (season, ids),
    )
    games = {pid: int(home_and_away) for pid, home_and_away in cur.fetchall()}
    return identities, games


# ---------------------------------------------------------------------------
# Rendering + the fail-closed "never silently overwrite" write path.
# ---------------------------------------------------------------------------


def measure(season: int, rows: list[DerivedSeasonRow]) -> dict[str, Any]:
    null_counts = {field: 0 for field in NULLABLE_SMALLINTS}
    null_counts["eligible_rank"] = sum(1 for r in rows if r.eligible_rank is None)
    null_counts["three_vote_games"] = sum(1 for r in rows if r.three_vote_games is None)
    null_counts["two_vote_games"] = sum(1 for r in rows if r.two_vote_games is None)
    null_counts["one_vote_games"] = sum(1 for r in rows if r.one_vote_games is None)
    return {
        "rows": len(rows),
        "votes_total": sum(r.votes for r in rows),
        "winners": sum(1 for r in rows if r.is_winner),
        "seasons": 1,
        "players": len({r.player_id for r in rows}),
        "first_season": season,
        "last_season": season,
        "null_counts": null_counts,
        "ineligible_rows": sum(1 for r in rows if r.is_ineligible),
        "link_status_counts": {LINK_STATUS_VALUE: len(rows)} if rows else {},
    }


def build_rows(
    season: int, derived: list[DerivedSeasonRow], identities: dict[int, PlayerIdentity],
    bridge: dict[str, int], label: str,
) -> list[dict[str, str]]:
    player_id_to_provider = {player_id: cd_i for cd_i, player_id in bridge.items()}
    rows: list[dict[str, str]] = []
    for r in derived:
        identity = identities[r.player_id]
        provider_player_id = player_id_to_provider[r.player_id]
        rows.append({
            "season": str(season),
            "afltables_profile_url": identity.afltables_profile_url,
            "votes": str(r.votes),
            "vote_rank": str(r.vote_rank),
            "eligible_rank": "" if r.eligible_rank is None else str(r.eligible_rank),
            "is_ineligible": "t" if r.is_ineligible else "f",
            "is_winner": "t" if r.is_winner else "f",
            "games": str(r.games),
            "three_vote_games": "" if r.three_vote_games is None else str(r.three_vote_games),
            "two_vote_games": "" if r.two_vote_games is None else str(r.two_vote_games),
            "one_vote_games": "" if r.one_vote_games is None else str(r.one_vote_games),
            "polling_games": str(r.polling_games),
            "link_status_value": LINK_STATUS_VALUE,
            # No legacy recovery-database id exists for an AFL-API-sourced row (module doc):
            # this REVIEW-ONLY column (never matched on by the loader) carries the resolved
            # canonical players.id instead, so a human reviewer can cross-reference it exactly.
            "bootstrap_player_id": str(r.player_id),
            "display_name": identity.display_name,
            "legacy_source_record_id": f"afl_api-brownlow-season:{season}:{provider_player_id}:{label}",
        })
    rows.sort(key=lambda row: (int(row["season"]), row["afltables_profile_url"]))
    return rows


def render_csv(rows: list[dict[str, str]]) -> str:
    import csv
    buf = StringIO()
    writer = csv.DictWriter(buf, fieldnames=HEADER, lineterminator="\n", quoting=csv.QUOTE_MINIMAL)
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue()


def default_out_paths(season: int) -> tuple[Path, Path]:
    return (
        OUT_DIR / f"season-votes-afl_api-{season}.csv",
        OUT_DIR / f"season-votes-afl_api-{season}.manifest.json",
    )


def build_manifest(
    *, season: int, label: str, snapshot_manifest: dict[str, Any], snapshot_dir: Path,
    bridge_paths: list[Path], bridge_provenance: dict[str, list[Path]], measured: dict[str, Any],
    csv_path: Path, csv_text: str, db_database: str, reconciliation_compared: int,
) -> dict[str, Any]:
    bridge_entries = [
        {
            "file": _rel(path),
            "sha256": sha256_file(path),
            "linked_providers_contributed": sum(
                1 for files in bridge_provenance.values() if path in files),
        }
        for path in bridge_paths
    ]
    return {
        "$comment": [
            "AFLDB-ISSUE-228 Stage S7. Provenance for a season-scoped Brownlow artefact built",
            "from AFL API (AFL.com.au) Brownlow evidence -- NOT the ISSUE-113 legacy recovery-",
            "database export, and NOT merged into data/brownlow/season-votes.csv by this tool.",
            "Row shape is byte-compatible with tools/migration/import_brownlow_season.py's HEADER",
            "and load_artefact() ordering. Regenerate only from a fresh acquisition via",
            "tools/current-season/acquire-afl-api-brownlow.ts and this builder.",
        ],
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "issue": "AFLDB-ISSUE-228",
        "builder": TOOL,
        "builder_version": TOOL_VERSION,
        "source_key": SOURCE_KEY,
        "season": season,
        "snapshot": {
            "label": label,
            "dir": _rel(snapshot_dir),
            "season_provider_id": snapshot_manifest.get("season_provider_id"),
            "acquired_at": snapshot_manifest.get("acquired_at"),
            "files": snapshot_manifest.get("files"),
        },
        "bridge": bridge_entries,
        "identity_evidence": {
            "database": db_database,
            "read_only": True,
            "tables": ["players", "external_identities", "player_season_stats"],
        },
        "reconciliation": {
            "leaderboard_players_compared": reconciliation_compared,
            "mismatches": 0,
        },
        "built_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "artefact": {
            "file": _rel(csv_path),
            "csv_sha256": sha256_text(csv_text),
            "columns": list(HEADER),
            "nullable_columns": list(NULLABLE_SMALLINTS),
            "season_coverage": [[season, season]],
            **measured,
        },
    }


def _comparable(doc: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in doc.items() if k != "built_at_utc"}


def write_artefact(
    csv_text: str, manifest: dict[str, Any], csv_path: Path, manifest_path: Path,
) -> str:
    """Sec 'output safety': content-equality no-op, hard refusal on any real difference,
    never a silent overwrite, never a deletion of what is already there -- the same
    convention build_afl_api_player_bridge.py's --write already established for this
    ISSUE-228 stage."""
    manifest_text = json.dumps(manifest, indent=2, sort_keys=True) + "\n"

    if csv_path.exists() or manifest_path.exists():
        if not (csv_path.exists() and manifest_path.exists()):
            raise BrownlowArtefactRefused(
                f"{csv_path} and {manifest_path} must both exist or both be absent; found only one. "
                "Refusing to guess which is stale.")
        # Path.read_text() does not accept newline= (pathlib has no such parameter, unlike
        # open()); open the handle directly so newline="" preserves exact existing bytes for
        # the equality check below instead of letting universal-newline translation silently
        # treat a CRLF file as equal to an LF one.
        with csv_path.open("r", encoding="utf-8", newline="") as handle:
            existing_csv = handle.read()
        existing_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if existing_csv == csv_text and _comparable(existing_manifest) == _comparable(manifest):
            return "unchanged"
        raise BrownlowArtefactRefused(
            f"{csv_path} already exists with DIFFERENT content. This builder never overwrites an "
            "existing artefact; remove the stale file deliberately first, or build under --out to "
            "a new path.")

    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(csv_text)
    with manifest_path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(manifest_text)
    return "written"


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


class Reporter:
    def __init__(self, verbose: bool = True) -> None:
        self.verbose = verbose

    def step(self, message: str) -> None:
        if self.verbose:
            print(f"  {message}", flush=True)

    def result(self, label: str, count: Any) -> None:
        if self.verbose:
            print(f"    {label:<40} {count}", flush=True)

    def warn(self, message: str) -> None:
        print(f"    WARNING: {message}", flush=True)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def build(
    *, label: str, bridge_paths: list[Path], dsn_env: str, required_database: str,
    snapshot_root: Path = SNAPSHOT_ROOT, rep: Reporter | None = None,
) -> dict[str, Any]:
    """The full offline-then-read-only-evidence pipeline. Raises on any refusal; returns a
    summary dict on success (whether or not the caller goes on to write)."""
    rep = rep or Reporter(verbose=False)
    snapshot_dir = snapshot_root / label
    snapshot_manifest = verify_snapshot_manifest(snapshot_dir)
    season = snapshot_manifest["season"]
    rep.step(f"snapshot      : {snapshot_dir} (season {season})")

    season_raw = read_json(snapshot_dir / "01-brownlow-season.raw.json")
    leaderboard_raw = read_json(snapshot_dir / "02-brownlow-leaderboard.raw.json")
    match_votes, match_status = parse_match_votes(season_raw)
    leaderboard, leaderboard_status = parse_leaderboard(leaderboard_raw)
    rep.step(f"parsed        : {len(match_votes)} match vote-set(s), {len(leaderboard)} leaderboard entr(y/ies)")

    require_concluded(match_status, leaderboard_status)

    mismatches = reconcile_leaderboard(match_votes, leaderboard)
    if mismatches:
        raise BrownlowArtefactRefused(
            f"leaderboard reconciliation failed for {len(mismatches)} player(s) on a CONCLUDED count "
            f"(blocking): {mismatches[:10]}{' ...' if len(mismatches) > 10 else ''}")

    bridge, bridge_provenance = load_bridges(bridge_paths)
    bridge_identities = load_bridge_identities(bridge_paths)
    facts, refusals = resolve_season_facts(match_votes, bridge)
    if refusals:
        rep.warn(f"{len(refusals)} vote set(s) refused identity resolution:")
        for refusal in refusals[:20]:
            rep.warn(f"  {refusal.provider_match_id}: {refusal.reason}")
        raise BrownlowArtefactRefused(
            f"{len(refusals)} of {len(match_votes)} match vote set(s) did not resolve to trusted "
            "canonical identities; the artefact is built only at zero refusals, so nothing was "
            "written (mirrors import_brownlow_season.py's 'zero rejections or no write')")

    tallied_player_ids = {pid for pid, _ in facts}
    ineligible_player_ids = resolve_ineligible_player_ids(tallied_player_ids, bridge, leaderboard)

    dsn = resolve_dsn(dsn_env, required_database)
    conn = open_read_only(dsn, required_database)
    try:
        with conn.cursor() as cur:
            identities, games = load_identity_and_games(cur, tallied_player_ids, season)
    finally:
        conn.rollback()
        conn.close()
    verify_bridge_identities(bridge, bridge_identities, identities)

    derived = derive_season_rows(facts, ineligible_player_ids, games)
    rows = build_rows(season, derived, identities, bridge, label)
    csv_text = render_csv(rows)
    measured = measure(season, derived)

    out_csv, out_manifest = default_out_paths(season)
    manifest = build_manifest(
        season=season, label=label, snapshot_manifest=snapshot_manifest, snapshot_dir=snapshot_dir,
        bridge_paths=bridge_paths, bridge_provenance=bridge_provenance, measured=measured,
        csv_path=out_csv, csv_text=csv_text, db_database=required_database,
        reconciliation_compared=len(leaderboard),
    )

    # Prove this builder's own row contract against the loader's own reader before
    # reporting success -- a round-trip self-check, not a duplicate of it.
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, newline="", encoding="utf-8") as tmp:
        tmp.write(csv_text)
        tmp_path = Path(tmp.name)
    try:
        load_artefact_via_loader(tmp_path)
    except LoaderContractError as exc:
        raise BrownlowArtefactRefused(
            f"the built artefact fails import_brownlow_season.py's own load_artefact() contract "
            f"check: {exc}") from exc
    finally:
        tmp_path.unlink(missing_ok=True)

    return {
        "season": season, "rows": rows, "csv_text": csv_text, "manifest": manifest,
        "out_csv": out_csv, "out_manifest": out_manifest, "measured": measured,
        "refusals": [], "reconciliation_compared": len(leaderboard),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--label", required=True,
                         help="the immutable AFL API Brownlow snapshot label under "
                              "data/sources/afl_api/brownlow/<label>/ (never 'latest')")
    parser.add_argument("--bridge", type=Path, action="append", required=True,
                         help="an explicit, already-built trusted identity-bridge artefact "
                              "(e.g. data/reference/afl-api-player-bridge-<date>.json, the S5 "
                              "stat-vector bootstrap, or data/reference/afl-api-brownlow-name-"
                              "bridge-<date>.json, the S5b name+team+season bootstrap); repeat "
                              "--bridge to combine every trusted bridge artefact that applies to "
                              "the season being built (load_bridges() unions their 'linked' rows "
                              "and refuses on any cross-artefact contradiction)")
    parser.add_argument("--snapshot-root", type=Path, default=SNAPSHOT_ROOT)
    parser.add_argument("--dsn-env", default=DSN_ENV_DEFAULT,
                         help=f"environment variable naming the read-only DSN (default {DSN_ENV_DEFAULT})")
    parser.add_argument("--database", default=REQUIRED_DATABASE_DEFAULT,
                         help=f"the exact database name the DSN must target (default {REQUIRED_DATABASE_DEFAULT})")
    parser.add_argument("--out", type=Path, default=None, help="override the output CSV path")
    parser.add_argument("--manifest", type=Path, default=None, help="override the output manifest path")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--validate-only", action="store_true",
                        help="build the artefact in memory (read-only DB evidence included) and "
                             "print the measured summary; write nothing")
    group.add_argument("--write", action="store_true",
                        help="build the artefact and write it, unless an identical file already exists")
    args = parser.parse_args(argv)

    common.load_env()
    rep = Reporter()
    try:
        result = build(
            label=args.label, bridge_paths=args.bridge, dsn_env=args.dsn_env,
            required_database=args.database, snapshot_root=args.snapshot_root, rep=rep,
        )
    except (BrownlowArtefactSourceError, BrownlowArtefactEvidenceError, BrownlowArtefactRefused) as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1

    for label, count in result["measured"].items():
        rep.result(label, count)
    rep.result("leaderboard players compared", result["reconciliation_compared"])

    if args.validate_only:
        print(json.dumps({"ok": True, "season": result["season"], **result["measured"]}, sort_keys=True))
        return 0

    out_csv = args.out or result["out_csv"]
    out_manifest = args.manifest or result["out_manifest"]
    manifest = result["manifest"]
    if out_csv != result["out_csv"]:
        manifest = {**manifest, "artefact": {**manifest["artefact"], "file": str(out_csv)}}
    try:
        outcome = write_artefact(result["csv_text"], manifest, out_csv, out_manifest)
    except BrownlowArtefactRefused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1

    if outcome == "unchanged":
        rep.step(f"{out_csv} already exists and is identical -- not rewritten")
    else:
        rep.step(f"wrote {out_csv}")
        rep.step(f"wrote {out_manifest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
