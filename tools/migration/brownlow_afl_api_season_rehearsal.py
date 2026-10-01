#!/usr/bin/env python3
"""AFLDB-ISSUE-233 D-233-2: the ``code_test_db`` write-path rehearsal of the season-scoped AFL API
Brownlow artefact, with its eight-player prerequisite fixture (runbook §4.9, §4.11.8).

    AFLDB_CODE_TEST_DATABASE_URL=<owner DSN naming code_test_db> \\
    AFLDB_CODE_TEST_IMPORT_DATABASE_URL=<afldb_import DSN naming code_test_db> \\
      python tools/migration/brownlow_afl_api_season_rehearsal.py run --acknowledge code_test_db \\
        --artefact-dir <dir holding the genuine 2026 CSV + manifest> --evidence <new dir> \\
        [--duplicate-pair-dir <dir holding a genuine AFL API pair for a master season>]

    ... restore --acknowledge code_test_db --evidence <dir>   (only after a run that died before
                                                              its own restore)
    ... residue                                               (read-only)

WHAT IT RUNS. The REAL loader, ``import_brownlow_season.py``: ``validate_offline()``, then
``load_artefact()`` / ``load_manifest()`` / ``load_afl_api_artefacts()`` / ``load()``, which is
exactly ``main()``'s DB sequence. Only the two paths ``main()`` pins in DB mode differ: the AFL
API directory is ``<E>/afl_api`` (byte copies of the genuine builder output, re-hashed against
the pinned hashes) and the reviewed availability is ``<E>/stat-availability.json`` (the tracked
file with the rollover's one reviewed edit: 2026 ``brownlow_season_total`` pending -> complete).
Refusals that happen before any DB contact run through the real CLI as child processes, with
every DSN and libpq variable removed from their environment. No loader code is reimplemented.

THE FIXTURE (decision D-233-R, runbook §4.11.8). ``code_test_db`` is a historical rebuild that
stops at 2025 by construction, so eight of the 183 genuine 2026 vote-getters have no canonical
player there (§4.11.6). The loader's only prerequisite for them is profile identity resolution.
The fixture therefore seeds exactly eight ``players`` and exactly eight ``external_identities``
rows in the fitzRoy importer's own shape (source ``afltables``, ``external_id`` = the exact
artefact profile path, ``match_method`` ``afltables_profile_url``, ``status`` ``unique``). It is
NOT a simulation of current-season ingestion: no match, no player_match_stats and no
player_season_stats are seeded, and nothing about the rebuild or current-season architecture
changes. ``display_name`` comes from the genuine artefact. The synthetic fields (``slug``,
``sort_name``, ``search_name``) carry the ``afldb-issue-233-rehearsal-fixture-`` namespace, and
``notes`` carries the fixture marker and the exact path. ``code_test_db`` allocates the ids. No
DEV id, no ``bootstrap_player_id``, no name lookup and no guessed path is ever a target.

DETERMINISM. Before anything is written the target must measure exactly the shape the read-only
preflight measured: 183 artefact paths, 175 uniquely resolved, 8 unresolved, 0 ambiguous, and
the 8 unresolved must be exactly the fixture's paths. If one of the eight has appeared since,
this STOPS rather than seeding seven. The same applies if any fixture slug, note or profile path
already exists in any form.

TARGET. ``code_test_db`` ONLY. The DSNs come only from ``AFLDB_CODE_TEST_DATABASE_URL`` (owner)
and ``AFLDB_CODE_TEST_IMPORT_DATABASE_URL`` (the ``afldb_import`` role the loader runs as). They
are never taken from argv and never printed. Each must be a ``postgresql://`` URL naming exactly
``code_test_db``; ``afldb_dev``, ``afldb_test`` and ``afldb_prod`` are refused by name and every
other name as "not exactly code_test_db". ``--acknowledge code_test_db`` is required for every
writing subcommand. ``current_database()`` is proven on both connections, as the first statement
of every write and restore transaction, and as the first statement of the transaction in which
the loader's own first write happens.

RESTORE. The loader commits itself (``ImportBatch`` commits on creation), so a rollback-only run
is impossible without modelling the loader; the rehearsal commits, then restores exactly, in
``finally``, in ONE owner transaction, in FK order: the ``brownlow_season_votes`` pre-image (its
original ids and batch ownership, ``OVERRIDING SYSTEM VALUE``), the rehearsal's import
rejections and batches, the 2026 ``seasons`` / ``stat_availability`` rows, the fixture's eight
identities, then its eight players, then every sequence the fixture or the loader can advance.
Teardown deletes only exact ids recorded in the journal (or located by their exact planned keys
after a crash), each count asserted. Any row still referencing a fixture player, identity or
rehearsal batch through ANY foreign key makes the restore REFUSE and roll back; there is no
CASCADE. A fresh session must then reproduce the pre-state fingerprint exactly, and the residue
gate must be zero.

JOURNAL. ``<E>/journal.json`` is written before every write step and after it commits. A
separate ``restore`` invocation recovers from it alone: it knows whether the fixture seed, the
setup rows and each load committed.

Planner statistics written by the loader's ``ANALYZE`` and ``pg_stat_*`` counters are not
restorable; they are excluded from the fingerprint and the evidence says so.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from collections.abc import Iterable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_brownlow_season_artefact_from_afl_api as builder
import import_brownlow_season as loader

TOOL = "tools/migration/brownlow_afl_api_season_rehearsal.py"
ISSUE = "AFLDB-ISSUE-233"
REPO_ROOT = Path(__file__).resolve().parents[2]
LOADER_PATH = Path(loader.__file__).resolve()

# --- target ---------------------------------------------------------------------------------
TARGET_DATABASE = "code_test_db"
FORBIDDEN_DATABASES = ("afldb_dev", "afldb_test", "afldb_prod")
OWNER_ENV = "AFLDB_CODE_TEST_DATABASE_URL"
IMPORT_ENV = "AFLDB_CODE_TEST_IMPORT_DATABASE_URL"
IMPORT_ROLE = "afldb_import"
OWNER_ROLE = "afldb_owner"
DSN_SCHEMES = ("postgresql", "postgres")
# libpq URL parameters that could silently point a URL at another database.
DSN_FORBIDDEN_PARAMS = ("dbname", "service")

# --- the genuine input (runbook §4.11.5) ----------------------------------------------------
SEASON = 2026
CSV_NAME = f"{loader.AFL_API_PREFIX}{SEASON}.csv"
MANIFEST_NAME = f"{loader.AFL_API_PREFIX}{SEASON}.manifest.json"
PINNED_CSV_SHA256 = "3ad4257d9a256c86d911b6108f164ace7b30d631cd6be5539215777cd8325af6"
PINNED_MANIFEST_SHA256 = "1d971116f18d0d41ee39e87ef833e881b0d91ea0923d4b5ff113ef9e95c0bbe3"
EXPECTED_ARTEFACT = {"rows": 183, "votes_total": 1242, "winners": 1, "ineligible_rows": 14}

# --- the fixture (D-233-R) ------------------------------------------------------------------
# The exact artefact afltables_profile_url values the code_test_db preflight left unresolved
# (§4.11.6). These paths are the durable identity keys; nothing else selects a fixture row.
FIXTURE_PROFILE_PATHS = (
    "players/D/Dyson_Sharp.html",
    "players/H/Harry_Dean.html",
    "players/J/Jagga_Smith.html",
    "players/J/Joel_Fitzgerald.html",
    "players/M/Milan_Murdock.html",
    "players/P/Phoenix_Gothard.html",
    "players/S/Sam_Swadling.html",
    "players/Z/Zeke_Uwland.html",
)
EXPECTED_PREFLIGHT = {"artefact_paths": 183, "resolved": 175, "unresolved": 8, "ambiguous": 0}
FIXTURE_SLUG_PREFIX = "afldb-issue-233-rehearsal-fixture-"
FIXTURE_NOTE = "AFLDB-ISSUE-233 D-233-2 code_test_db rehearsal fixture (not current-season ingestion)"
AFLTABLES_URL_BASE = "https://afltables.com/afl/stats/"
FIXTURE_PLAYER_COLUMNS = ("display_name", "sort_name", "search_name", "slug", "notes")
FIXTURE_IDENTITY_COLUMNS = ("source_id", "external_id", "external_url", "player_id", "status",
                            "match_method", "notes")
FIXTURE_IDENTITY_STATUS = "unique"
FIXTURE_MATCH_METHOD = "afltables_profile_url"

# --- master load pre-state (§4.9.5) ---------------------------------------------------------
MASTER_EXPECTED = {"rows": 16120, "votes_total": 79113, "winners": 112, "seasons": 98}

# --- what the rehearsal can write, and so must restore --------------------------------------
FIXTURE_TABLES = ("players", "external_identities")
LOADER_TABLES = ("import_batches", "import_rejections", "brownlow_season_votes")
RESTORED_SEQUENCE_TABLES = FIXTURE_TABLES + LOADER_TABLES
REFERENCE_CHECKED_TABLES = ("players", "external_identities", "import_batches")
SETUP_STEPS = ("F1", "F2")
LOAD_STEPS = ("D1", "D2", "A1", "A2")
IMAGE_TABLES = ("brownlow_season_votes", "brownlow_round_votes", "import_batches",
                "import_rejections", "players", "external_identities", "seasons",
                "stat_availability", "sources")
PROJECTION_COLUMNS = ("season", "player_id", "club_id", "votes", "vote_rank", "eligible_rank",
                      "is_ineligible", "is_winner", "games", "three_vote_games", "two_vote_games",
                      "one_vote_games", "polling_games", "link_status_value", "source_id",
                      "source_record_id")
API_BATCH_NOTES = f"AFLDB-ISSUE-233 D-233-2 season-scoped AFL API artefacts: {CSV_NAME}"
ISSUE_BATCH_NOTE_PREFIX = "AFLDB-ISSUE-233 D-233-2"

JOURNAL_FILE = "journal.json"
EVIDENCE_FILE = "evidence.json"
PRE_IMAGE_FILE = "brownlow_season_votes.pre.copy"
JOURNAL_VERSION = 1
TEMP_TABLE = "issue233_bsv_pre_image"

TRACKED_INPUT_FILES = (
    "data/reference/stat-availability.json",
    "data/reference/seasons.json",
)
TRACKED_INPUT_DIRS = ("data/brownlow",)

# --- the exact teardown statements (no LIKE, no wildcard, no CASCADE) -----------------------
SQL_RESTORE_TRUNCATE = "TRUNCATE ONLY brownlow_season_votes"
SQL_TEARDOWN_REJECTIONS = "DELETE FROM import_rejections WHERE import_batch_id = ANY(%s)"
SQL_TEARDOWN_BATCHES = ("DELETE FROM import_batches WHERE id = ANY(%s) AND tool = %s "
                        "AND target_table = %s")
SQL_RESTORE_SEASON = "UPDATE seasons SET status = %s::season_status WHERE year = %s"
SQL_RESTORE_AVAILABILITY = ("UPDATE stat_availability SET coverage = %s::coverage_status, "
                            "is_recorded = %s WHERE stat_key = %s AND season = %s")
SQL_TEARDOWN_IDENTITIES = ("DELETE FROM external_identities WHERE id = ANY(%s) AND source_id = %s "
                           "AND external_id = ANY(%s) AND match_method = %s AND notes = ANY(%s)")
SQL_TEARDOWN_PLAYERS = "DELETE FROM players WHERE id = ANY(%s) AND slug = ANY(%s) AND notes = ANY(%s)"
SQL_SETVAL = "SELECT setval(%s::regclass, %s, %s)"
TEARDOWN_SQL = (SQL_RESTORE_TRUNCATE, SQL_TEARDOWN_REJECTIONS, SQL_TEARDOWN_BATCHES,
                SQL_RESTORE_SEASON, SQL_RESTORE_AVAILABILITY, SQL_TEARDOWN_IDENTITIES,
                SQL_TEARDOWN_PLAYERS, SQL_SETVAL)


class RehearsalRefused(RuntimeError):
    """A guard or an expected measurement failed. Nothing further is written."""


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ============================================================================================
# Pure planning and judging (DB-free; tests/python/brownlow_afl_api_season_rehearsal_contract.py)
# ============================================================================================

def database_of_dsn(dsn: str, env_name: str) -> str:
    """The database a URL DSN names, refused unless it is exactly ``code_test_db``.

    Messages name the variable and the database, never the DSN.
    """
    try:
        parts = urlsplit(dsn)
    except ValueError as exc:
        raise RehearsalRefused(f"{env_name} is not a parseable URL DSN") from exc
    if parts.scheme not in DSN_SCHEMES:
        raise RehearsalRefused(
            f"{env_name} must be a postgresql:// URL (a keyword DSN can hide its database)")
    params = {key.lower() for key in parse_qs(parts.query, keep_blank_values=True)}
    overriding = sorted(params & set(DSN_FORBIDDEN_PARAMS))
    if overriding:
        raise RehearsalRefused(
            f"{env_name} carries {overriding}, which could point it at another database")
    database = unquote(parts.path.removeprefix("/"))
    if database in FORBIDDEN_DATABASES:
        raise RehearsalRefused(f"{env_name} names '{database}', which this rehearsal refuses by name")
    if database != TARGET_DATABASE:
        raise RehearsalRefused(
            f"{env_name} names '{database}', which is not exactly {TARGET_DATABASE}")
    return database


def resolve_dsns(environ: Mapping[str, str]) -> tuple[str, str]:
    """The owner and import DSNs, from the two code_test_db variables only."""
    dsns = []
    for name in (OWNER_ENV, IMPORT_ENV):
        value = environ.get(name)
        if not value:
            raise RehearsalRefused(f"{name} is not set (no other variable names a target here)")
        database_of_dsn(value, name)
        dsns.append(value)
    if dsns[0] == dsns[1]:
        raise RehearsalRefused(
            f"{OWNER_ENV} and {IMPORT_ENV} are identical; the loader must run as {IMPORT_ROLE}")
    return dsns[0], dsns[1]


def resolve_owner_dsn(environ: Mapping[str, str]) -> str:
    """The owner DSN alone (restore and residue never use the import role)."""
    value = environ.get(OWNER_ENV)
    if not value:
        raise RehearsalRefused(f"{OWNER_ENV} is not set (no other variable names a target here)")
    database_of_dsn(value, OWNER_ENV)
    return value


def require_acknowledgement(value: str | None) -> None:
    if value != TARGET_DATABASE:
        raise RehearsalRefused(f"--acknowledge {TARGET_DATABASE} is required")


def redact(text: str, *dsns: str) -> str:
    """Remove any password a driver message might echo."""
    for dsn in dsns:
        try:
            password = urlsplit(dsn).password
        except ValueError:
            password = None
        if password:
            text = text.replace(password, "***")
    return text


@dataclass(frozen=True)
class FixturePlayer:
    profile_path: str
    display_name: str
    slug: str
    note: str

    @property
    def external_url(self) -> str:
        return AFLTABLES_URL_BASE + self.profile_path


@dataclass(frozen=True)
class FixturePlan:
    players: tuple[FixturePlayer, ...]

    @property
    def paths(self) -> list[str]:
        return [p.profile_path for p in self.players]

    @property
    def slugs(self) -> list[str]:
        return [p.slug for p in self.players]

    @property
    def notes(self) -> list[str]:
        return [p.note for p in self.players]

    def to_json(self) -> list[dict]:
        return [{"profile_path": p.profile_path, "display_name": p.display_name,
                 "slug": p.slug, "note": p.note} for p in self.players]


def fixture_slug(profile_path: str) -> str:
    if not loader.PROFILE_URL.fullmatch(profile_path):
        raise RehearsalRefused(f"{profile_path!r} is not an AFL Tables profile path")
    stem = profile_path.rsplit("/", 1)[1][: -len(".html")]
    return FIXTURE_SLUG_PREFIX + stem.lower()


def build_fixture_plan(rows: Sequence[loader.SeasonVoteRow],
                       profile_paths: Sequence[str] = FIXTURE_PROFILE_PATHS) -> FixturePlan:
    """Exactly one fixture player per exact profile path, from the genuine artefact rows."""
    wanted = list(profile_paths)
    if len(wanted) != 8 or len(set(wanted)) != 8:
        raise RehearsalRefused(f"the fixture needs exactly eight distinct profile paths, got {wanted}")
    found: dict[str, list[loader.SeasonVoteRow]] = {path: [] for path in wanted}
    for row in rows:
        if row.afltables_profile_url in found:
            found[row.afltables_profile_url].append(row)
    missing = sorted(path for path, hits in found.items() if not hits)
    if missing:
        raise RehearsalRefused(f"the artefact carries no row for fixture path(s) {missing}")
    repeated = sorted(path for path, hits in found.items() if len(hits) > 1)
    if repeated:
        raise RehearsalRefused(f"the artefact carries more than one row for {repeated}")
    players = []
    for path in sorted(wanted):
        row = found[path][0]
        if row.season != SEASON:
            raise RehearsalRefused(f"{path}: artefact row is season {row.season}, not {SEASON}")
        if not row.display_name or not row.display_name.strip():
            raise RehearsalRefused(f"{path}: the artefact row has no display_name")
        players.append(FixturePlayer(profile_path=path, display_name=row.display_name,
                                     slug=fixture_slug(path), note=f"{FIXTURE_NOTE}: {path}"))
    if len({p.slug for p in players}) != len(players):
        raise RehearsalRefused("two fixture paths map to one fixture slug")
    return FixturePlan(players=tuple(players))


def fixture_player_rows(plan: FixturePlan) -> list[tuple]:
    """INSERT parameters in FIXTURE_PLAYER_COLUMNS order. No id: code_test_db allocates it."""
    return [(p.display_name, p.slug, p.slug, p.slug, p.note) for p in plan.players]


def fixture_identity_rows(plan: FixturePlan, afltables_source_id: int,
                          player_ids: Mapping[str, int]) -> list[tuple]:
    """INSERT parameters in FIXTURE_IDENTITY_COLUMNS order, onto the ids this run created."""
    if set(player_ids) != set(plan.paths):
        raise RehearsalRefused("fixture identities need exactly the eight created player ids")
    return [(afltables_source_id, p.profile_path, p.external_url, player_ids[p.profile_path],
             FIXTURE_IDENTITY_STATUS, FIXTURE_MATCH_METHOD, p.note) for p in plan.players]


def classify_resolution(resolver: loader.ProfileResolver,
                        rows: Sequence[loader.SeasonVoteRow]) -> dict:
    """Every artefact path through the REAL resolver, plus load()'s same-season collision rule."""
    resolved: dict[str, int] = {}
    unresolved: list[str] = []
    ambiguous: list[str] = []
    seen: dict[tuple[int, int], str] = {}
    collisions: list[str] = []
    for row in rows:
        player_id, reason = resolver.resolve(row.afltables_profile_url)
        if player_id is None:
            (unresolved if reason == "no canonical player carries this AFL Tables profile path"
             else ambiguous).append(row.afltables_profile_url)
            continue
        key = (row.season, player_id)
        if key in seen:
            collisions.append(row.afltables_profile_url)
            continue
        seen[key] = row.afltables_profile_url
        resolved[row.afltables_profile_url] = player_id
    return {"artefact_paths": len({row.afltables_profile_url for row in rows}),
            "resolved": len(resolved), "unresolved": len(unresolved), "ambiguous": len(ambiguous),
            "collisions": len(collisions), "unresolved_paths": sorted(unresolved),
            "ambiguous_paths": sorted(ambiguous), "collision_paths": sorted(collisions),
            "resolution": resolved}


def judge_preflight(classification: Mapping[str, Any],
                    fixture_paths: Sequence[str] = FIXTURE_PROFILE_PATHS) -> None:
    """STOP unless the target still has exactly the measured prerequisite shape."""
    got = {key: classification[key] for key in EXPECTED_PREFLIGHT}
    if got != EXPECTED_PREFLIGHT or classification["collisions"]:
        raise RehearsalRefused(
            f"code_test_db drifted from the measured prerequisite shape: expected "
            f"{EXPECTED_PREFLIGHT} with 0 collisions, measured {got} with "
            f"{classification['collisions']} collision(s). STOP: the fixture is seeded only into "
            "the exact measured gap")
    if sorted(classification["unresolved_paths"]) != sorted(fixture_paths):
        raise RehearsalRefused(
            f"the unresolved paths {classification['unresolved_paths']} are not exactly the "
            f"fixture's {sorted(fixture_paths)}. STOP")


def judge_post_seed(classification: Mapping[str, Any], fixture_ids: Mapping[str, int]) -> None:
    """183/183 through the real resolver, and the eight resolve to exactly the fixture's ids."""
    want = {"artefact_paths": 183, "resolved": 183, "unresolved": 0, "ambiguous": 0}
    got = {key: classification[key] for key in want}
    if got != want or classification["collisions"]:
        raise RehearsalRefused(f"post-seed resolution {got} (collisions "
                               f"{classification['collisions']}) is not {want}")
    resolution = classification["resolution"]
    wrong = sorted(path for path, pid in fixture_ids.items() if resolution.get(path) != pid)
    if wrong:
        raise RehearsalRefused(f"fixture path(s) {wrong} do not resolve to the fixture-created ids")
    fixture_id_set = set(fixture_ids.values())
    stray = sorted(path for path, pid in resolution.items()
                   if pid in fixture_id_set and path not in fixture_ids)
    if stray:
        raise RehearsalRefused(f"non-fixture path(s) {stray} resolve to a fixture player")


def assert_fixture_absent(existing: Mapping[str, Sequence[Any]]) -> None:
    """No fixture slug, note or profile path may exist in any form before the seed."""
    present = {key: list(values) for key, values in existing.items() if values}
    if present:
        raise RehearsalRefused(
            f"fixture key(s) already present in code_test_db: {present}. STOP: the fixture is "
            "seeded whole or not at all")


def sequence_restore_plan(captured: Mapping[str, Mapping[str, Any]]) -> list[tuple[str, int, bool]]:
    """``(sequence, last_value, is_called)`` for every sequence the fixture or loader advances."""
    missing = [table for table in RESTORED_SEQUENCE_TABLES if table not in captured]
    if missing:
        raise RehearsalRefused(f"no captured sequence for {missing}; refusing a partial restore")
    plan = []
    for table in RESTORED_SEQUENCE_TABLES:
        entry = captured[table]
        if not entry.get("sequence"):
            raise RehearsalRefused(f"{table}.id has no owned sequence recorded")
        plan.append((str(entry["sequence"]), int(entry["last_value"]), bool(entry["is_called"])))
    return plan


def judge_references(edge_counts: Iterable[Mapping[str, Any]]) -> None:
    """Refuse the teardown while ANY foreign key still references a row it would delete."""
    offenders = [f"{e['table']}.{e['column']} -> {e['referenced_table']} "
                 f"({e['constraint']}): {e['count']} row(s)"
                 for e in edge_counts if int(e["count"]) != 0]
    if offenders:
        raise RehearsalRefused(
            "rows still reference what the teardown would delete; refusing (no CASCADE): "
            + "; ".join(offenders))


def judge_rehearsal_batches(rows_above_pre_max: Sequence[Mapping[str, Any]],
                            journal: Mapping[str, Any]) -> list[int]:
    """The import batches above the pre-max: each must be one of the loader's own, and a load
    intent must have been journaled. Anything else is someone else's batch: refuse."""
    if not rows_above_pre_max:
        return []
    steps = journal.get("steps", {})
    if not any(steps.get(step, {}).get("state") in ("intent", "committed", "refused")
               for step in LOAD_STEPS):
        raise RehearsalRefused(
            f"import_batches holds {len(rows_above_pre_max)} batch(es) above the pre-max but the "
            "journal records no load; refusing to delete them")
    foreign = [dict(row) for row in rows_above_pre_max
               if row["tool"] != loader.TOOL_NAME or row["target_table"] != loader.TARGET_TABLE
               or row["source_key"] not in (loader.SOURCE_KEY, loader.AFL_API_SOURCE_KEY)]
    if foreign:
        raise RehearsalRefused(f"import_batches above the pre-max that are not the loader's: {foreign}")
    ids = [int(row["id"]) for row in rows_above_pre_max]
    listed = {int(i) for step in LOAD_STEPS for i in steps.get(step, {}).get("batch_ids", [])}
    unknown = sorted(listed - set(ids))
    if unknown:
        raise RehearsalRefused(f"journaled batch id(s) {unknown} are missing from import_batches")
    return sorted(ids)


def judge_located_fixture(planned: Sequence[Mapping[str, str]],
                          player_rows: Sequence[Mapping[str, Any]],
                          identity_rows: Sequence[Mapping[str, Any]],
                          pre_max_player_id: int, pre_max_identity_id: int,
                          journal_ids: Mapping[str, Any] | None) -> tuple[list[int], list[int]]:
    """The fixture's rows, located by their exact planned keys: all eight or none at all."""
    if not player_rows and not identity_rows:
        if journal_ids:
            raise RehearsalRefused("the journal records a committed fixture seed but none of its rows exist")
        return [], []
    by_slug = {p["slug"]: p for p in planned}
    if len(player_rows) != len(planned) or len(identity_rows) != len(planned):
        raise RehearsalRefused(
            f"found {len(player_rows)} fixture player(s) and {len(identity_rows)} identity row(s); "
            f"expected all {len(planned)} or none")
    player_by_path: dict[str, int] = {}
    for row in player_rows:
        plan = by_slug.get(row["slug"])
        if plan is None or row["notes"] != plan["note"] or int(row["id"]) <= pre_max_player_id:
            raise RehearsalRefused(f"player row {dict(row)} is not a row this rehearsal created")
        player_by_path[plan["profile_path"]] = int(row["id"])
    by_path = {p["profile_path"]: p for p in planned}
    identity_ids = []
    for row in identity_rows:
        plan = by_path.get(row["external_id"])
        if (plan is None or row["notes"] != plan["note"] or int(row["id"]) <= pre_max_identity_id
                or row["match_method"] != FIXTURE_MATCH_METHOD
                or row["player_id"] != player_by_path.get(row["external_id"])):
            raise RehearsalRefused(f"identity row {dict(row)} is not a row this rehearsal created")
        identity_ids.append(int(row["id"]))
    player_ids = sorted(player_by_path.values())
    if journal_ids and (
            sorted(int(v) for v in journal_ids["players"].values()) != player_ids
            or sorted(int(v) for v in journal_ids["identities"].values()) != sorted(identity_ids)):
        raise RehearsalRefused("the located fixture rows are not the ids the journal recorded")
    return player_ids, sorted(identity_ids)


def recovery_plan(journal: Mapping[str, Any]) -> dict:
    """What a restore must undo, from the journal alone."""
    steps = journal.get("steps", {})
    fixture_state = journal.get("fixture", {}).get("state", "none")
    if fixture_state not in ("none", "intent", "committed"):
        raise RehearsalRefused(f"journal fixture state {fixture_state!r} is unknown")
    return {
        "pre_captured": journal.get("pre") is not None,
        "fixture": {"none": "none", "intent": "locate_exact_keys",
                    "committed": "delete_journal_ids"}[fixture_state],
        "setup_rows": [step for step in SETUP_STEPS
                       if steps.get(step, {}).get("state") in ("intent", "committed")],
        "loads": [step for step in LOAD_STEPS
                  if steps.get(step, {}).get("state") in ("intent", "committed", "refused")],
        "restore": journal.get("restore", {}).get("state", "none"),
    }


def compare_fingerprints(before: Mapping[str, Any], after: Mapping[str, Any]) -> list[str]:
    """Every leaf key whose value differs (or exists on one side only)."""
    diffs: list[str] = []

    def walk(a: Any, b: Any, path: str) -> None:
        if isinstance(a, dict) and isinstance(b, dict):
            for key in sorted(set(a) | set(b)):
                walk(a.get(key, "<absent>"), b.get(key, "<absent>"), f"{path}.{key}" if path else key)
        elif a != b:
            diffs.append(f"{path}: {a!r} -> {b!r}")

    walk(dict(before), dict(after), "")
    return diffs


def make_availability_fixture(text: str) -> str:
    """The tracked availability text with the rollover's ONE reviewed edit, nothing else."""
    lines = text.splitlines(keepends=True)
    hits = [i for i, line in enumerate(lines)
            if '"stat_key": "brownlow_season_total"' in line and f'"first_season": {SEASON}' in line]
    if len(hits) != 1:
        raise RehearsalRefused(f"expected one brownlow_season_total {SEASON} line, found {len(hits)}")
    index = hits[0]
    entry = json.loads(lines[index].strip().rstrip(","))
    if entry != {"stat_key": "brownlow_season_total", "coverage": "pending",
                 "first_season": SEASON, "last_season": SEASON}:
        raise RehearsalRefused(f"the tracked {SEASON} brownlow_season_total range is {entry}, not pending")
    edited = lines[index].replace('"coverage": "pending", ', '"coverage": "complete",', 1)
    if edited == lines[index]:
        raise RehearsalRefused("could not apply the pending -> complete edit")
    result = "".join(lines[:index] + [edited] + lines[index + 1:])
    before, after = json.loads(text), json.loads(result)
    changed = [i for i, (a, b) in enumerate(zip(before["coverage_ranges"], after["coverage_ranges"]))
               if a != b]
    if (len(before["coverage_ranges"]) != len(after["coverage_ranges"]) or changed != [
            before["coverage_ranges"].index(entry)]
            or {k: v for k, v in before.items() if k != "coverage_ranges"}
            != {k: v for k, v in after.items() if k != "coverage_ranges"}):
        raise RehearsalRefused("the availability fixture differs from the tracked file by more than one range")
    return result


# ============================================================================================
# Inputs, evidence and journal (filesystem only)
# ============================================================================================

@dataclass(frozen=True)
class FixtureSource:
    artefact: loader.AflApiSeasonArtefact
    plan: FixturePlan
    continuity: dict


def load_fixture_source(artefact_dir: Path, csv_sha256: str = PINNED_CSV_SHA256,
                        manifest_sha256: str = PINNED_MANIFEST_SHA256) -> FixtureSource:
    """The genuine builder output, verified byte-for-byte and by the loader's own checks."""
    csv_path, manifest_path = Path(artefact_dir) / CSV_NAME, Path(artefact_dir) / MANIFEST_NAME
    for path, pinned in ((csv_path, csv_sha256), (manifest_path, manifest_sha256)):
        if not path.is_file():
            raise RehearsalRefused(f"{path} does not exist")
        actual = loader.sha256_file(path)
        if actual != pinned:
            raise RehearsalRefused(f"{path.name} sha256 {actual} is not the pinned {pinned}")
    try:
        artefact = loader.load_afl_api_artefact(SEASON, csv_path, manifest_path, {SEASON})
    except loader.BrownlowSeasonSourceError as exc:
        raise RehearsalRefused(f"the loader refuses the artefact: {exc}") from exc
    measured = loader.measure(artefact.rows)
    got = {key: measured[key] for key in EXPECTED_ARTEFACT}
    if got != EXPECTED_ARTEFACT:
        raise RehearsalRefused(f"the artefact measures {got}, not {EXPECTED_ARTEFACT}")
    try:
        # The loader ignores identity_evidence; bind the artefact to the exact tracked
        # profile_url_continuity contract (path, sha256, folds) it was built with.
        continuity = builder.verify_continuity_provenance(artefact.manifest, builder.load_continuity_rules())
    except builder.BrownlowArtefactSourceError as exc:
        raise RehearsalRefused(f"the artefact's continuity provenance does not verify: {exc}") from exc
    return FixtureSource(artefact=artefact, plan=build_fixture_plan(artefact.rows), continuity=continuity)


def prepare_evidence_dir(path: Path) -> Path:
    evidence = Path(path).resolve()
    if evidence.exists():
        raise RehearsalRefused(f"evidence directory {evidence} already exists; use a new one")
    if evidence == REPO_ROOT or REPO_ROOT in evidence.parents:
        raise RehearsalRefused("the evidence directory must be outside the repository")
    evidence.mkdir(parents=True)
    return evidence


def tracked_input_hashes() -> dict[str, str]:
    files = [REPO_ROOT / name for name in TRACKED_INPUT_FILES]
    for directory in TRACKED_INPUT_DIRS:
        files.extend(sorted(p for p in (REPO_ROOT / directory).iterdir() if p.is_file()))
    return {p.relative_to(REPO_ROOT).as_posix(): loader.sha256_file(p) for p in files}


def save_json_atomic(path: Path, document: Mapping[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(document, indent=2, sort_keys=True, default=str) + "\n",
                         encoding="utf-8")
    os.replace(temporary, path)


def load_journal(evidence: Path) -> dict:
    path = Path(evidence) / JOURNAL_FILE
    try:
        journal = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RehearsalRefused(f"cannot read {path}: {exc}") from exc
    if journal.get("journal_version") != JOURNAL_VERSION or journal.get("database") != TARGET_DATABASE:
        raise RehearsalRefused(f"{path} is not an {ISSUE} code_test_db rehearsal journal")
    return journal


def mark_step(evidence: Path, journal: dict, step: str, state: str, **extra: Any) -> None:
    entry = journal.setdefault("steps", {}).setdefault(step, {})
    entry.update({"state": state, f"{state}_at_utc": utc_now(), **extra})
    save_json_atomic(Path(evidence) / JOURNAL_FILE, journal)


def stage_inputs(source: FixtureSource, evidence: Path) -> tuple[Path, Path]:
    """``<E>/afl_api`` (byte copies, re-hashed) and ``<E>/stat-availability.json``."""
    afl_api_dir = evidence / "afl_api"
    afl_api_dir.mkdir()
    for src, pinned in ((source.artefact.csv_path, PINNED_CSV_SHA256),
                        (source.artefact.manifest_path, PINNED_MANIFEST_SHA256)):
        target = afl_api_dir / src.name
        shutil.copyfile(src, target)
        if loader.sha256_file(target) != pinned:
            raise RehearsalRefused(f"the staged copy of {src.name} does not hash to the pinned value")
    tracked = loader.AVAILABILITY_PATH.read_bytes().decode("utf-8")
    availability = evidence / "stat-availability.json"
    availability.write_bytes(make_availability_fixture(tracked).encode("utf-8"))
    complete_tracked = loader.load_reviewed_complete_seasons(loader.AVAILABILITY_PATH)
    complete_fixture = loader.load_reviewed_complete_seasons(availability)
    if complete_fixture != complete_tracked | {SEASON} or SEASON in complete_tracked:
        raise RehearsalRefused("the availability fixture does not add exactly the 2026 season")
    return afl_api_dir, availability


# ============================================================================================
# Offline cases through the real CLI (no DB contact possible)
# ============================================================================================

def scrubbed_environment() -> dict[str, str]:
    """The child's environment with every DSN and libpq variable removed."""
    return {key: value for key, value in os.environ.items()
            if "DATABASE_URL" not in key.upper() and not key.upper().startswith("PG")}


def run_loader_cli(args: Sequence[str]) -> tuple[int, dict]:
    completed = subprocess.run([sys.executable, str(LOADER_PATH), *args], capture_output=True,
                               text=True, env=scrubbed_environment(), cwd=REPO_ROOT, timeout=900,
                               check=False)
    try:
        payload = json.loads(completed.stdout.strip().splitlines()[-1]) if completed.stdout.strip() else {}
    except ValueError:
        payload = {"unparsed_stdout": completed.stdout[-2000:]}
    return completed.returncode, payload


def expect_cli_refusal(name: str, args: Sequence[str], needle: str) -> dict:
    code, payload = run_loader_cli(args)
    error = str(payload.get("error", ""))
    if code != 1 or payload.get("ok") is not False or needle not in error:
        raise RehearsalRefused(f"{name}: expected a refusal containing {needle!r}, got exit {code}: {payload}")
    return {"case": name, "exit": code, "error": error}


def offline_cases(evidence: Path, afl_api_dir: Path, availability: Path,
                  duplicate_pair_dir: Path | None) -> list[dict]:
    results = []
    # N1: both seams, must PASS and list exactly 2026 with the manifest's counts.
    code, summary = run_loader_cli(["--validate-only", "--afl-api-dir", str(afl_api_dir),
                                    "--stat-availability", str(availability)])
    entries = summary.get("afl_api_artefacts", [])
    if (code != 0 or summary.get("ok") is not True or len(entries) != 1
            or entries[0].get("season") != SEASON or entries[0].get("csv_sha256") != PINNED_CSV_SHA256
            or {k: entries[0].get(k) for k in ("rows", "votes_total", "winners", "players")}
            != {"rows": 183, "votes_total": 1242, "winners": 1, "players": 183}):
        raise RehearsalRefused(f"N1 validate-only did not pass with exactly 2026: exit {code}: {summary}")
    results.append({"case": "N1 validate-only", "exit": code, "afl_api_artefacts": entries})

    # N2 (case 3): one byte flipped in a copy of the CSV.
    n2 = evidence / "n2-changed-csv" / "afl_api"
    n2.mkdir(parents=True)
    data = bytearray((afl_api_dir / CSV_NAME).read_bytes())
    index = data.rindex(b"2026")
    data[index + 3] = ord("7")
    (n2 / CSV_NAME).write_bytes(bytes(data))
    shutil.copyfile(afl_api_dir / MANIFEST_NAME, n2 / MANIFEST_NAME)
    results.append(expect_cli_refusal("N2 changed CSV", ["--validate-only", "--afl-api-dir", str(n2),
                                      "--stat-availability", str(availability)], "does not match"))

    # N3 (case 4): votes_total + 1 in a copy of the manifest.
    n3 = evidence / "n3-changed-manifest" / "afl_api"
    n3.mkdir(parents=True)
    shutil.copyfile(afl_api_dir / CSV_NAME, n3 / CSV_NAME)
    manifest = json.loads((afl_api_dir / MANIFEST_NAME).read_text(encoding="utf-8"))
    manifest["artefact"]["votes_total"] += 1
    (n3 / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    results.append(expect_cli_refusal("N3 changed manifest", ["--validate-only", "--afl-api-dir", str(n3),
                                      "--stat-availability", str(availability)], "artefact.votes_total"))

    # N4 (case 1, offline half): the tracked availability, 2026 still pending.
    results.append(expect_cli_refusal("N4 pending availability", ["--validate-only", "--afl-api-dir",
                                      str(afl_api_dir)], "is not 'complete'"))

    # N5 (case 5): a genuine pair for a master season beside the 2026 pair.
    if duplicate_pair_dir is None:
        results.append({"case": "N5 duplicate season", "status": "NOT RUN",
                        "reason": "no genuine AFL API pair for a master season was supplied; the "
                                  "refusal stays proven DB-free only (a renamed copy is never used)"})
    else:
        found = loader.discover_afl_api_artefacts(duplicate_pair_dir)
        if len(found) != 1:
            raise RehearsalRefused(f"--duplicate-pair-dir must hold exactly one genuine pair, found {len(found)}")
        season, dup_csv, dup_manifest = found[0]
        dup = json.loads(Path(dup_manifest).read_text(encoding="utf-8"))
        if (dup.get("season") != season or dup.get("source_key") != loader.AFL_API_SOURCE_KEY
                or Path(str(dup.get("artefact", {}).get("file", ""))).name != Path(dup_csv).name
                or dup.get("artefact", {}).get("csv_sha256") != loader.sha256_file(Path(dup_csv))):
            raise RehearsalRefused("the duplicate pair is not a genuine, self-consistent builder output")
        n5 = evidence / "n5-duplicate-season" / "afl_api"
        n5.mkdir(parents=True)
        for path in (afl_api_dir / CSV_NAME, afl_api_dir / MANIFEST_NAME, Path(dup_csv), Path(dup_manifest)):
            shutil.copyfile(path, n5 / path.name)
        results.append(expect_cli_refusal("N5 duplicate season", ["--validate-only", "--afl-api-dir", str(n5),
                                          "--stat-availability", str(availability)],
                                          f"[{season}] appear in BOTH"))

    # N6: the seams without --validate-only: exit 1, there is no DB bypass.
    results.append(expect_cli_refusal("N6 seams without --validate-only",
                                      ["--afl-api-dir", str(afl_api_dir)], "offline-validation only"))
    return results


# ============================================================================================
# Database phases
# ============================================================================================

def connect(dsn: str, env_name: str):
    try:
        return loader.connect_pg(dsn)
    except Exception as exc:  # noqa: BLE001 - re-raised without the DSN
        raise RehearsalRefused(f"cannot connect through {env_name}: {type(exc).__name__}: "
                               f"{redact(str(exc).splitlines()[0] if str(exc) else '', dsn)}") from None


def assert_current_database(cur) -> None:
    cur.execute("SELECT current_database()")
    database = cur.fetchone()[0]
    if database != TARGET_DATABASE:
        raise RehearsalRefused(f"connected to '{database}', not {TARGET_DATABASE}; nothing was written")


@contextmanager
def read_only(conn, repeatable: bool = False) -> Iterator[Any]:
    conn.rollback()
    with conn.cursor() as cur:
        cur.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY" if repeatable
                    else "SET TRANSACTION READ ONLY")
        assert_current_database(cur)
        try:
            yield cur
        finally:
            conn.rollback()


@contextmanager
def write_transaction(conn) -> Iterator[Any]:
    conn.rollback()
    with conn.cursor() as cur:
        assert_current_database(cur)  # the first statement of every write transaction
        try:
            yield cur
            conn.commit()
        except BaseException:
            conn.rollback()
            raise


def other_client_sessions(cur, own_pids: Sequence[int]) -> int:
    cur.execute("""SELECT count(*) FROM pg_stat_activity
                    WHERE datname = current_database() AND backend_type = 'client backend'
                      AND NOT (pid = ANY(%s))""", (list(own_pids),))
    return int(cur.fetchone()[0])


def require_no_other_sessions(cur, own_pids: Sequence[int]) -> None:
    others = other_client_sessions(cur, own_pids)
    if others:
        raise RehearsalRefused(f"{others} other client session(s) are attached to {TARGET_DATABASE}")


def fingerprint(cur) -> dict:
    """F0 / Z. Excludes planner statistics and pg_stat_* counters (not restorable)."""
    from psycopg import sql

    cur.execute("""SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname""")
    tables = [row[0] for row in cur.fetchall()]
    counts = {}
    for table in tables:
        cur.execute(sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier("public", table)))
        counts[table] = int(cur.fetchone()[0])
    images = {}
    for table in IMAGE_TABLES:
        cur.execute(sql.SQL("SELECT md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '')) "
                            "FROM {} t").format(sql.Identifier("public", table)))
        images[table] = cur.fetchone()[0]
    cur.execute("SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' ORDER BY 1")
    sequences = {}
    for (name,) in cur.fetchall():
        cur.execute(sql.SQL("SELECT last_value, is_called FROM {}").format(sql.Identifier("public", name)))
        last_value, is_called = cur.fetchone()
        sequences[name] = [int(last_value), bool(is_called)]
    cur.execute("""SELECT nspname FROM pg_namespace
                    WHERE left(nspname, 8) <> 'pg_temp_' AND left(nspname, 14) <> 'pg_toast_temp_'
                    ORDER BY 1""")
    schemas = [row[0] for row in cur.fetchall()]
    cur.execute("SELECT count(*) FROM pg_prepared_xacts WHERE database = current_database()")
    prepared = int(cur.fetchone()[0])
    cur.execute("SELECT shobj_description(oid, 'pg_database') FROM pg_database "
                "WHERE datname = current_database()")
    comment = cur.fetchone()[0]
    document = {"table_counts": counts, "images_md5": images, "sequences": sequences,
                "schemas": schemas, "prepared_transactions": prepared, "database_comment": comment}
    document["sha256"] = hashlib.sha256(
        json.dumps(document, sort_keys=True, default=str).encode("utf-8")).hexdigest()
    return document


def sequence_state(cur) -> dict:
    from psycopg import sql

    state = {}
    for table in RESTORED_SEQUENCE_TABLES:
        cur.execute("SELECT pg_get_serial_sequence(%s, 'id')", (f"public.{table}",))
        sequence = cur.fetchone()[0]
        if sequence is None:
            raise RehearsalRefused(f"public.{table}.id owns no sequence")
        schema, name = sequence.split(".", 1)
        cur.execute(sql.SQL("SELECT last_value, is_called FROM {}").format(
            sql.Identifier(schema.strip('"'), name.strip('"'))))
        last_value, is_called = cur.fetchone()
        cur.execute(sql.SQL("SELECT coalesce(max(id), 0) FROM {}").format(sql.Identifier("public", table)))
        max_id = int(cur.fetchone()[0])
        next_value = int(last_value) + 1 if is_called else int(last_value)
        if next_value <= max_id:
            raise RehearsalRefused(f"{sequence} would next issue {next_value}, at or below "
                                   f"max(public.{table}.id) = {max_id}; refusing")
        state[table] = {"sequence": sequence, "last_value": int(last_value),
                        "is_called": bool(is_called), "max_id": max_id}
    return state


def table_measure(cur, source_ids: Mapping[str, int]) -> dict:
    cur.execute("""SELECT count(*), coalesce(sum(votes), 0), count(*) FILTER (WHERE is_winner),
                          count(DISTINCT season), count(DISTINCT player_id),
                          count(*) FILTER (WHERE eligible_rank IS NULL),
                          count(*) FILTER (WHERE polling_games IS NULL),
                          coalesce(sum(polling_games), 0),
                          count(*) FILTER (WHERE source_id = %s),
                          count(*) FILTER (WHERE source_id = %s),
                          count(*) FILTER (WHERE source_id IS DISTINCT FROM %s
                                             AND source_id IS DISTINCT FROM %s),
                          count(*) FILTER (WHERE season = %s)
                     FROM brownlow_season_votes""",
                (source_ids["afltables"], source_ids["afl_api"], source_ids["afltables"],
                 source_ids["afl_api"], SEASON))
    keys = ("rows", "votes_total", "winners", "seasons", "players", "null_eligible_rank",
            "null_polling_games", "polling_games_sum", "afltables_rows", "afl_api_rows",
            "other_source_rows", "season_rows")
    return {key: int(value) for key, value in zip(keys, cur.fetchone())}


def projection_md5(cur, source_id: int | None = None) -> dict:
    columns = ", ".join(PROJECTION_COLUMNS)
    where = "WHERE source_id = %s" if source_id is not None else ""
    cur.execute(f"""SELECT md5(coalesce(string_agg(row({columns})::text, E'\\n'
                                                   ORDER BY season, player_id), '')), count(*)
                      FROM brownlow_season_votes {where}""",
                (source_id,) if source_id is not None else None)
    digest, count = cur.fetchone()
    return {"md5": digest, "rows": int(count)}


def residue(cur, plan: FixturePlan) -> dict:
    """ISSUE-233 fixture and Brownlow residue. Read-only; prefix tests use left(), never LIKE."""
    cur.execute("SELECT count(*) FROM players WHERE slug = ANY(%s) OR notes = ANY(%s)",
                (plan.slugs, plan.notes))
    exact_players = int(cur.fetchone()[0])
    cur.execute("""SELECT count(*) FROM players
                    WHERE left(slug, length(%s)) = %s OR left(coalesce(notes, ''), length(%s)) = %s""",
                (FIXTURE_SLUG_PREFIX, FIXTURE_SLUG_PREFIX, FIXTURE_NOTE, FIXTURE_NOTE))
    namespace_players = int(cur.fetchone()[0])
    cur.execute("SELECT count(*) FROM external_identities WHERE external_id = ANY(%s)", (plan.paths,))
    exact_identities = int(cur.fetchone()[0])
    cur.execute("SELECT count(*) FROM external_identities WHERE left(coalesce(notes, ''), length(%s)) = %s",
                (FIXTURE_NOTE, FIXTURE_NOTE))
    namespace_identities = int(cur.fetchone()[0])
    cur.execute("""SELECT count(*) FROM brownlow_season_votes b JOIN sources s ON s.id = b.source_id
                    WHERE s.key = %s""", (loader.AFL_API_SOURCE_KEY,))
    afl_api_rows = int(cur.fetchone()[0])
    cur.execute("SELECT count(*) FROM brownlow_season_votes WHERE season = %s", (SEASON,))
    season_rows = int(cur.fetchone()[0])
    cur.execute("""SELECT count(*) FROM import_batches
                    WHERE tool = %s AND left(coalesce(notes, ''), length(%s)) = %s""",
                (loader.TOOL_NAME, ISSUE_BATCH_NOTE_PREFIX, ISSUE_BATCH_NOTE_PREFIX))
    batches = int(cur.fetchone()[0])
    return {"fixture_players_exact": exact_players, "fixture_players_namespace": namespace_players,
            "fixture_identities_exact": exact_identities,
            "fixture_identities_namespace": namespace_identities,
            "brownlow_afl_api_rows": afl_api_rows, f"brownlow_{SEASON}_rows": season_rows,
            "issue233_brownlow_batches": batches}


def source_ids(cur) -> dict[str, int]:
    cur.execute("SELECT key, id FROM sources WHERE key = ANY(%s)",
                ([loader.SOURCE_KEY, loader.AFL_API_SOURCE_KEY],))
    found = {key: int(value) for key, value in cur.fetchall()}
    missing = sorted({loader.SOURCE_KEY, loader.AFL_API_SOURCE_KEY} - set(found))
    if missing:
        raise RehearsalRefused(f"sources {missing} are not registered")
    return {"afltables": found[loader.SOURCE_KEY], "afl_api": found[loader.AFL_API_SOURCE_KEY]}


def setup_images(cur) -> dict:
    cur.execute("SELECT to_jsonb(s) FROM seasons s WHERE year = %s", (SEASON,))
    season = cur.fetchone()
    cur.execute("SELECT to_jsonb(a) FROM stat_availability a WHERE stat_key = %s AND season = %s",
                (loader.STAT_KEY, SEASON))
    availability = cur.fetchone()
    if season is None or availability is None:
        raise RehearsalRefused(f"seasons / stat_availability carry no {SEASON} row")
    return {"seasons": season[0], "stat_availability": availability[0]}


def capture_pre_state(owner, imp, evidence: Path, source: FixtureSource,
                      master_rows: Sequence[loader.SeasonVoteRow], master_manifest: dict) -> dict:
    """G + the preflight: read-only, one snapshot. Every refusal here writes nothing."""
    from psycopg import sql

    plan = source.plan
    own_pids = [owner.info.backend_pid, imp.info.backend_pid]
    with read_only(imp) as cur:
        cur.execute("SELECT current_user, current_setting('default_transaction_read_only')")
        import_user, import_default_ro = cur.fetchone()
        if import_user != IMPORT_ROLE:
            raise RehearsalRefused(f"{IMPORT_ENV} connects as '{import_user}', not {IMPORT_ROLE}")
        if import_default_ro != "off":
            raise RehearsalRefused(f"{IMPORT_ENV}'s session defaults to read-only; the loader cannot write")
        resolver = loader.ProfileResolver(imp)
        preflight = classify_resolution(resolver, source.artefact.rows)
    judge_preflight(preflight)

    with read_only(owner, repeatable=True) as cur:
        cur.execute("SELECT current_user, current_setting('default_transaction_read_only')")
        owner_user, owner_default_ro = cur.fetchone()
        if owner_user != OWNER_ROLE:
            raise RehearsalRefused(f"{OWNER_ENV} connects as '{owner_user}', not {OWNER_ROLE}")
        if owner_default_ro != "off":
            raise RehearsalRefused(f"{OWNER_ENV}'s session defaults to read-only; the fixture cannot be seeded")
        require_no_other_sessions(cur, own_pids)
        ids = source_ids(cur)
        measure = table_measure(cur, ids)
        manifest_block = master_manifest["artefact"]
        want = {"rows": manifest_block["rows"], "votes_total": manifest_block["votes_total"],
                "winners": manifest_block["winners"], "seasons": manifest_block["seasons"],
                "players": manifest_block["players"],
                "null_eligible_rank": manifest_block["null_counts"]["eligible_rank"],
                "null_polling_games": manifest_block["null_counts"]["polling_games"],
                "afltables_rows": manifest_block["rows"], "afl_api_rows": 0,
                "other_source_rows": 0, "season_rows": 0}
        got = {key: measure[key] for key in want}
        if got != want or {k: measure[k] for k in MASTER_EXPECTED} != MASTER_EXPECTED:
            raise RehearsalRefused(f"brownlow_season_votes is not the master load: {got} vs {want}")
        cur.execute("""SELECT count(*) FROM brownlow_season_votes b JOIN sources s ON s.id = b.source_id
                        WHERE s.key = %s""", (loader.MANUAL_SOURCE_KEY,))
        if int(cur.fetchone()[0]):
            raise RehearsalRefused("brownlow_season_votes holds manual_admin_edit rows")
        cur.execute("SELECT season, coverage::text FROM stat_availability WHERE stat_key = %s",
                    (loader.STAT_KEY,))
        coverage = {int(season): value for season, value in cur.fetchall()}
        complete = {season for season, value in coverage.items() if value == "complete"}
        if complete != loader.expected_seasons(master_manifest) or coverage.get(SEASON) != "pending":
            raise RehearsalRefused(
                f"stat_availability {loader.STAT_KEY}: complete must be exactly the master's "
                f"seasons and {SEASON} pending (it is {coverage.get(SEASON)!r})")
        cur.execute("SELECT status::text FROM seasons WHERE year = %s", (SEASON,))
        row = cur.fetchone()
        if row is None or row[0] != "in_progress":
            raise RehearsalRefused(f"seasons {SEASON} is {row[0] if row else 'absent'}, not in_progress")
        images = setup_images(cur)

        cur.execute("SELECT slug FROM players WHERE slug = ANY(%s)", (plan.slugs,))
        slugs = [r[0] for r in cur.fetchall()]
        cur.execute("SELECT id FROM players WHERE notes = ANY(%s)", (plan.notes,))
        noted = [r[0] for r in cur.fetchall()]
        cur.execute("""SELECT ei.id, s.key, ei.external_id, ei.status::text, ei.match_method, ei.player_id
                         FROM external_identities ei JOIN sources s ON s.id = ei.source_id
                        WHERE ei.external_id = ANY(%s)""", (plan.paths,))
        identities = [list(r) for r in cur.fetchall()]
        pre_residue = residue(cur, plan)
        assert_fixture_absent({"slugs": slugs, "noted_players": noted, "identities": identities,
                               **{k: [v] for k, v in pre_residue.items() if v}})
        cur.execute("SELECT count(*) FROM players WHERE display_name = ANY(%s)",
                    ([p.display_name for p in plan.players],))
        same_name_players = int(cur.fetchone()[0])  # evidence only; names are never identity

        sequences = sequence_state(cur)
        cur.execute("""SELECT column_name FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'brownlow_season_votes'
                          AND is_generated = 'NEVER' ORDER BY ordinal_position""")
        columns = [r[0] for r in cur.fetchall()]
        cur.execute("SELECT coalesce(array_agg(DISTINCT import_batch_id), '{}') FROM brownlow_season_votes")
        pre_batch_ids = sorted(int(i) for i in cur.fetchone()[0] if i is not None)
        pre_image = evidence / PRE_IMAGE_FILE
        copy_out = sql.SQL("COPY (SELECT {} FROM public.brownlow_season_votes ORDER BY id) TO STDOUT").format(
            sql.SQL(", ").join(sql.Identifier(c) for c in columns))
        with pre_image.open("wb") as handle, cur.copy(copy_out) as copy:
            for chunk in copy:
                handle.write(chunk)
        afltables_projection = projection_md5(cur, ids["afltables"])
        cur.execute("SELECT count(*), md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '')) "
                    "FROM brownlow_round_votes t")
        round_count, round_md5 = cur.fetchone()
        f0 = fingerprint(cur)

    return {
        "captured_at_utc": utc_now(),
        "roles": {"owner": owner_user, "import": import_user,
                  "default_transaction_read_only": {"owner": owner_default_ro, "import": import_default_ro}},
        "source_ids": ids,
        "measure": measure,
        "preflight": {k: v for k, v in preflight.items() if k != "resolution"},
        "setup_images": images,
        "fixture_absent": {"slugs": slugs, "noted_players": noted, "identities": identities},
        "same_display_name_players": same_name_players,
        "residue": pre_residue,
        "sequences": sequences,
        "brownlow_pre_image": {"file": PRE_IMAGE_FILE, "sha256": loader.sha256_file(pre_image),
                               "rows": measure["rows"], "columns": columns,
                               "batch_ids": pre_batch_ids},
        "afltables_projection": afltables_projection,
        "round_votes": {"rows": int(round_count), "md5": round_md5},
        "fingerprint": f0,
    }


def seed_fixture(owner, evidence: Path, journal: dict, plan: FixturePlan, afltables_id: int) -> dict:
    """Exactly eight players and eight identities, in one owner transaction."""
    journal["fixture"] = {"state": "intent", "planned": plan.to_json(), "intent_at_utc": utc_now()}
    save_json_atomic(evidence / JOURNAL_FILE, journal)
    pre_max_player = journal["pre"]["sequences"]["players"]["max_id"]
    pre_max_identity = journal["pre"]["sequences"]["external_identities"]["max_id"]
    with write_transaction(owner) as cur:
        player_ids: dict[str, int] = {}
        for player, params in zip(plan.players, fixture_player_rows(plan)):
            cur.execute(f"INSERT INTO players ({', '.join(FIXTURE_PLAYER_COLUMNS)}) "
                        f"VALUES ({', '.join(['%s'] * len(FIXTURE_PLAYER_COLUMNS))}) RETURNING id", params)
            player_ids[player.profile_path] = int(cur.fetchone()[0])
        identity_ids: dict[str, int] = {}
        for player, params in zip(plan.players, fixture_identity_rows(plan, afltables_id, player_ids)):
            cur.execute(f"INSERT INTO external_identities ({', '.join(FIXTURE_IDENTITY_COLUMNS)}) "
                        f"VALUES ({', '.join(['%s'] * len(FIXTURE_IDENTITY_COLUMNS))}) RETURNING id", params)
            identity_ids[player.profile_path] = int(cur.fetchone()[0])
        if (len(player_ids) != 8 or len(identity_ids) != 8
                or min(player_ids.values()) <= pre_max_player
                or min(identity_ids.values()) <= pre_max_identity):
            raise RehearsalRefused("the fixture seed did not create eight new players and identities")
    journal["fixture"].update({"state": "committed", "committed_at_utc": utc_now(),
                               "player_ids": player_ids, "identity_ids": identity_ids})
    save_json_atomic(evidence / JOURNAL_FILE, journal)
    return {"player_ids": player_ids, "identity_ids": identity_ids}


def setup_row(owner, evidence: Path, journal: dict, step: str) -> None:
    """F1 (availability complete) or F2 (season complete): one exact row each."""
    mark_step(evidence, journal, step, "intent")
    with write_transaction(owner) as cur:
        if step == "F1":
            cur.execute("""UPDATE stat_availability SET coverage = 'complete', is_recorded = true
                            WHERE stat_key = %s AND season = %s AND coverage = 'pending'""",
                        (loader.STAT_KEY, SEASON))
        else:
            cur.execute("""UPDATE seasons SET status = 'complete'
                            WHERE year = %s AND status = 'in_progress'""", (SEASON,))
        if cur.rowcount != 1:
            raise RehearsalRefused(f"{step} updated {cur.rowcount} rows, not 1")
    mark_step(evidence, journal, step, "committed")


def run_loader(imp, evidence: Path, journal: dict, step: str, inputs: dict) -> dict:
    """The REAL main() DB sequence on the import connection."""
    pre_max = journal["pre"]["sequences"]["import_batches"]["max_id"]
    mark_step(evidence, journal, step, "intent", import_batches_pre_max=pre_max)
    imp.rollback()
    with imp.cursor() as cur:
        # The first statement of the transaction the loader's first write commits in.
        assert_current_database(cur)
    rows = loader.load_artefact(loader.ARTEFACT_PATH)
    manifest = loader.load_manifest(loader.MANIFEST_PATH)
    afl_api = loader.load_afl_api_artefacts(loader.expected_seasons(manifest), inputs["afl_api_dir"],
                                            inputs["availability"])
    try:
        result = loader.load(imp, loader.Reporter(verbose=True), rows, manifest, afl_api)
    except loader.BrownlowSeasonLoadRefused as exc:
        imp.rollback()
        mark_step(evidence, journal, step, "refused", error=str(exc))
        return {"refused": str(exc)}
    batch_ids = [result["batch_id"], result.get("afl_api_batch_id")]
    mark_step(evidence, journal, step, "committed", batch_ids=[b for b in batch_ids if b is not None],
              result=result)
    return result


def expect_refusal(owner, imp, evidence: Path, journal: dict, step: str, inputs: dict,
                   needle: str) -> dict:
    with read_only(owner) as cur:
        before = {"measure": table_measure(cur, journal["pre"]["source_ids"]),
                  "batches": _max_ids(cur)}
    result = run_loader(imp, evidence, journal, step, inputs)
    with read_only(owner) as cur:
        after = {"measure": table_measure(cur, journal["pre"]["source_ids"]),
                 "batches": _max_ids(cur)}
    if "refused" not in result or needle not in result["refused"]:
        raise RehearsalRefused(f"{step}: expected a refusal containing {needle!r}, got {result}")
    if before != after:
        raise RehearsalRefused(f"{step}: the refusal wrote something: {before} -> {after}")
    return {"step": step, "refused": result["refused"], "unchanged": True}


def _max_ids(cur) -> dict:
    cur.execute("SELECT coalesce(max(id), 0), count(*) FROM import_batches")
    batches = cur.fetchone()
    cur.execute("SELECT coalesce(max(id), 0), count(*) FROM import_rejections")
    rejections = cur.fetchone()
    return {"import_batches": [int(v) for v in batches], "import_rejections": [int(v) for v in rejections]}


def verify_load(owner, journal: dict, step: str, source: FixtureSource,
                resolution: Mapping[str, int], loads_so_far: int) -> dict:
    """V1 / V2: the post-write measurement, provenance and batch ownership."""
    pre = journal["pre"]
    ids = pre["source_ids"]
    result = journal["steps"][step]["result"]
    with read_only(owner) as cur:
        measure = table_measure(cur, ids)
        csv_rows = source.artefact.rows
        ineligible = sum(1 for r in csv_rows if r.is_ineligible)
        winners = sum(1 for r in csv_rows if r.is_winner)
        want = {"rows": pre["measure"]["rows"] + len(csv_rows),
                "votes_total": pre["measure"]["votes_total"] + sum(r.votes for r in csv_rows),
                "winners": pre["measure"]["winners"] + winners,
                "seasons": pre["measure"]["seasons"] + 1,
                "null_eligible_rank": pre["measure"]["null_eligible_rank"] + ineligible,
                "null_polling_games": pre["measure"]["null_polling_games"],
                "polling_games_sum": pre["measure"]["polling_games_sum"]
                + sum(r.polling_games or 0 for r in csv_rows),
                "afltables_rows": pre["measure"]["rows"], "afl_api_rows": len(csv_rows),
                "other_source_rows": 0, "season_rows": len(csv_rows)}
        got = {key: measure[key] for key in want}
        if got != want:
            raise RehearsalRefused(f"{step}: measured {got}, expected {want}")

        if projection_md5(cur, ids["afltables"]) != pre["afltables_projection"]:
            raise RehearsalRefused(f"{step}: the afltables rows are not content-identical to the pre-image")

        cur.execute("""SELECT player_id, season, votes, vote_rank, eligible_rank, is_ineligible, is_winner,
                              games, three_vote_games, two_vote_games, one_vote_games, polling_games,
                              link_status_value::text, source_id, source_record_id, import_batch_id, club_id
                         FROM brownlow_season_votes WHERE season = %s""", (SEASON,))
        actual = {int(r[0]): tuple(r[1:]) for r in cur.fetchall()}
        expected = {}
        for row in csv_rows:
            expected[resolution[row.afltables_profile_url]] = (
                row.season, row.votes, row.vote_rank, row.eligible_rank, row.is_ineligible,
                row.is_winner, row.games, row.three_vote_games, row.two_vote_games,
                row.one_vote_games, row.polling_games, row.link_status_value, ids["afl_api"],
                f"brownlow-season:{row.season}:{row.afltables_profile_url}",
                result["afl_api_batch_id"], None)
        if actual != expected:
            differing = sorted(set(actual) ^ set(expected)
                               | {k for k in set(actual) & set(expected) if actual[k] != expected[k]})
            raise RehearsalRefused(f"{step}: {len(differing)} 2026 row(s) differ from the CSV: {differing[:10]}")
        winner_paths = sorted(path for path, pid in resolution.items()
                              if pid in actual and actual[pid][5])
        csv_winner_paths = sorted(r.afltables_profile_url for r in csv_rows if r.is_winner)

        pre_max = pre["sequences"]["import_batches"]["max_id"]
        cur.execute("""SELECT b.id, s.key, b.tool, b.target_table, b.status::text, b.records_read,
                              b.records_inserted, b.records_updated, b.records_rejected, b.notes
                         FROM import_batches b JOIN sources s ON s.id = b.source_id
                        WHERE b.id > %s ORDER BY b.id""", (pre_max,))
        batches = [dict(zip(("id", "source_key", "tool", "target_table", "status", "records_read",
                             "records_inserted", "records_updated", "records_rejected", "notes"), r))
                   for r in cur.fetchall()]
        if len(batches) != 2 * loads_so_far:
            raise RehearsalRefused(f"{step}: {len(batches)} rehearsal batches, expected {2 * loads_so_far}")
        latest = {b["id"]: b for b in batches[-2:]}
        want_batches = {
            result["batch_id"]: {"source_key": loader.SOURCE_KEY, "records_read": pre["measure"]["rows"],
                                 "records_inserted": pre["measure"]["rows"], "notes": None},
            result["afl_api_batch_id"]: {"source_key": loader.AFL_API_SOURCE_KEY,
                                         "records_read": len(csv_rows),
                                         "records_inserted": len(csv_rows), "notes": API_BATCH_NOTES},
        }
        if set(latest) != set(want_batches):
            raise RehearsalRefused(f"{step}: latest batches {sorted(latest)} are not the loader's "
                                   f"{sorted(want_batches)}")
        for batch in batches:
            if (batch["status"] != "completed" or batch["tool"] != loader.TOOL_NAME
                    or batch["target_table"] != loader.TARGET_TABLE or batch["records_rejected"] != 0
                    or batch["records_updated"] != 0):
                raise RehearsalRefused(f"{step}: batch {batch} is not a clean completed loader batch")
        for batch_id, fields in want_batches.items():
            if {k: latest[batch_id][k] for k in fields} != fields:
                raise RehearsalRefused(f"{step}: batch {latest[batch_id]} differs from {fields}")
        cur.execute("SELECT count(*) FROM import_rejections WHERE import_batch_id = ANY(%s)",
                    ([b["id"] for b in batches],))
        rejections = int(cur.fetchone()[0])
        if rejections:
            raise RehearsalRefused(f"{step}: {rejections} import rejection(s) for rehearsal batches")
        cur.execute("""SELECT coalesce(array_agg(DISTINCT import_batch_id ORDER BY import_batch_id), '{}')
                         FROM brownlow_season_votes""")
        owning = sorted(int(i) for i in cur.fetchone()[0])
        if owning != sorted(want_batches):
            raise RehearsalRefused(f"{step}: rows are owned by batches {owning}, not {sorted(want_batches)}")
        cur.execute("SELECT count(*), md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '')) "
                    "FROM brownlow_round_votes t")
        round_count, round_md5 = cur.fetchone()
        if {"rows": int(round_count), "md5": round_md5} != pre["round_votes"]:
            raise RehearsalRefused(f"{step}: brownlow_round_votes changed")
        projection = projection_md5(cur)
    return {"step": step, "measure": measure, "batches": batches, "winner_paths": winner_paths,
            "csv_winner_paths": csv_winner_paths, "projection": projection,
            "rows_2026_equal_csv": True}


def fk_edges(cur) -> list[dict]:
    cur.execute("""SELECT con.conname, sn.nspname, src.relname, att.attname, tgt.relname,
                          tatt.attname, cardinality(con.conkey)
                     FROM pg_constraint con
                     JOIN pg_class src ON src.oid = con.conrelid
                     JOIN pg_namespace sn ON sn.oid = src.relnamespace
                     JOIN pg_class tgt ON tgt.oid = con.confrelid
                     JOIN pg_namespace tn ON tn.oid = tgt.relnamespace
                     JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
                     JOIN pg_attribute tatt ON tatt.attrelid = con.confrelid AND tatt.attnum = con.confkey[1]
                    WHERE con.contype = 'f' AND tn.nspname = 'public' AND tgt.relname = ANY(%s)
                    ORDER BY con.conname""", (list(REFERENCE_CHECKED_TABLES),))
    edges = []
    for name, schema, table, column, referenced, referenced_column, width in cur.fetchall():
        if int(width) != 1 or referenced_column != "id":
            raise RehearsalRefused(f"foreign key {name} on {schema}.{table} is not a single-column "
                                   "reference to id; the reference check cannot judge it")
        edges.append({"constraint": name, "schema": schema, "table": table, "column": column,
                      "referenced_table": referenced})
    return edges


def reference_counts(cur, referenced_table: str, ids: Sequence[int],
                     exclusions: Mapping[tuple[str, str, str], Sequence[int]] | None = None) -> list[dict]:
    """Rows referencing ``ids`` of ``referenced_table`` through every foreign key, minus exact
    excluded rows (by their own id) that the same teardown deletes first."""
    from psycopg import sql

    counts = []
    if not ids:
        return counts
    for edge in fk_edges(cur):
        if edge["referenced_table"] != referenced_table:
            continue
        excluded = list((exclusions or {}).get((edge["schema"], edge["table"], edge["column"]), []))
        query = sql.SQL("SELECT count(*) FROM {} WHERE {} = ANY(%s)").format(
            sql.Identifier(edge["schema"], edge["table"]), sql.Identifier(edge["column"]))
        params: list[Any] = [list(ids)]
        if excluded:
            query = query + sql.SQL(" AND NOT (id = ANY(%s))")
            params.append(excluded)
        cur.execute(query, params)
        counts.append({**edge, "count": int(cur.fetchone()[0])})
    return counts


def restore(owner, evidence: Path, journal: dict, owner_dsn: str, own_pids: Sequence[int]) -> dict:
    """§4.9.6 + the fixture teardown, in ONE owner transaction, then the fresh-session proof."""
    from psycopg import sql

    plan = recovery_plan(journal)
    if not plan["pre_captured"]:
        return {"restored": False, "reason": "no pre-state was captured, so nothing was written"}
    pre = journal["pre"]
    journal.setdefault("restore", {}).update({"state": "started", "started_at_utc": utc_now(),
                                              "plan": plan})
    save_json_atomic(evidence / JOURNAL_FILE, journal)
    planned = journal.get("fixture", {}).get("planned", [])
    fixture_ids = (journal["fixture"] if plan["fixture"] == "delete_journal_ids" else None)
    report: dict[str, Any] = {"plan": plan}
    pre_image = evidence / pre["brownlow_pre_image"]["file"]
    if loader.sha256_file(pre_image) != pre["brownlow_pre_image"]["sha256"]:
        raise RehearsalRefused("the saved brownlow_season_votes pre-image does not hash to its journal value")

    with write_transaction(owner) as cur:
        require_no_other_sessions(cur, own_pids)

        # 1. brownlow_season_votes: exact pre-image, original ids and batch ownership.
        pre_max_batch = pre["sequences"]["import_batches"]["max_id"]
        cur.execute("""SELECT b.id, s.key, b.tool, b.target_table FROM import_batches b
                         JOIN sources s ON s.id = b.source_id WHERE b.id > %s ORDER BY b.id""",
                    (pre_max_batch,))
        above = [dict(zip(("id", "source_key", "tool", "target_table"), r)) for r in cur.fetchall()]
        rehearsal_batches = judge_rehearsal_batches(above, journal)
        cur.execute("SELECT DISTINCT import_batch_id FROM brownlow_season_votes")
        present = {int(r[0]) for r in cur.fetchall() if r[0] is not None}
        foreign = sorted(present - set(pre["brownlow_pre_image"]["batch_ids"]) - set(rehearsal_batches))
        if foreign:
            raise RehearsalRefused(f"brownlow_season_votes holds rows of foreign batch(es) {foreign}")
        columns = pre["brownlow_pre_image"]["columns"]
        column_list = sql.SQL(", ").join(sql.Identifier(c) for c in columns)
        cur.execute("SELECT md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '')) "
                    "FROM brownlow_season_votes t")
        if cur.fetchone()[0] != pre["fingerprint"]["images_md5"]["brownlow_season_votes"]:
            cur.execute(sql.SQL("CREATE TEMP TABLE {} (LIKE public.brownlow_season_votes) ON COMMIT DROP")
                        .format(sql.Identifier(TEMP_TABLE)))
            with cur.copy(sql.SQL("COPY {} ({}) FROM STDIN").format(sql.Identifier(TEMP_TABLE),
                                                                     column_list)) as copy:
                copy.write(pre_image.read_bytes())
            cur.execute(SQL_RESTORE_TRUNCATE)
            cur.execute(sql.SQL("INSERT INTO public.brownlow_season_votes ({}) OVERRIDING SYSTEM VALUE "
                                "SELECT {} FROM {} ORDER BY id").format(
                                    column_list, column_list, sql.Identifier(TEMP_TABLE)))
            if cur.rowcount != pre["brownlow_pre_image"]["rows"]:
                raise RehearsalRefused(f"restored {cur.rowcount} rows, not {pre['brownlow_pre_image']['rows']}")
            cur.execute("SELECT md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '')) "
                        "FROM brownlow_season_votes t")
            if cur.fetchone()[0] != pre["fingerprint"]["images_md5"]["brownlow_season_votes"]:
                raise RehearsalRefused("the restored brownlow_season_votes image differs from the pre-image")
            report["brownlow_season_votes"] = "restored from the pre-image"
        else:
            report["brownlow_season_votes"] = "already equal to the pre-image"

        # 2. The rehearsal's import rejections, then its batches (exact ids, counts asserted).
        pre_max_rejection = pre["sequences"]["import_rejections"]["max_id"]
        cur.execute("""SELECT count(*) FROM import_rejections
                        WHERE id > %s AND NOT (import_batch_id = ANY(%s))""",
                    (pre_max_rejection, rehearsal_batches))
        if int(cur.fetchone()[0]):
            raise RehearsalRefused("import_rejections above the pre-max belong to a foreign batch")
        if rehearsal_batches:
            cur.execute("SELECT count(*) FROM import_rejections WHERE import_batch_id = ANY(%s)",
                        (rehearsal_batches,))
            want_rejections = int(cur.fetchone()[0])
            cur.execute(SQL_TEARDOWN_REJECTIONS, (rehearsal_batches,))
            if cur.rowcount != want_rejections:
                raise RehearsalRefused("import_rejections delete count mismatch")
            judge_references(reference_counts(cur, "import_batches", rehearsal_batches))
            cur.execute(SQL_TEARDOWN_BATCHES, (rehearsal_batches, loader.TOOL_NAME, loader.TARGET_TABLE))
            if cur.rowcount != len(rehearsal_batches):
                raise RehearsalRefused(f"deleted {cur.rowcount} import batches, not {len(rehearsal_batches)}")
        report["import_batches_deleted"] = rehearsal_batches

        # 3. The 2026 seasons / stat_availability rows, exactly as captured.
        images = pre["setup_images"]
        cur.execute(SQL_RESTORE_SEASON, (images["seasons"]["status"], SEASON))
        cur.execute(SQL_RESTORE_AVAILABILITY, (images["stat_availability"]["coverage"],
                                               images["stat_availability"]["is_recorded"],
                                               loader.STAT_KEY, SEASON))
        if setup_images(cur) != images:
            raise RehearsalRefused("the 2026 seasons / stat_availability rows differ from their images")

        # 4–5. The fixture: identities, then players, exact rows only, references refused.
        cur.execute("SELECT id, slug, notes FROM players WHERE slug = ANY(%s)",
                    ([p["slug"] for p in planned],))
        player_rows = [dict(zip(("id", "slug", "notes"), r)) for r in cur.fetchall()]
        cur.execute("""SELECT id, external_id, player_id, notes, match_method FROM external_identities
                        WHERE source_id = %s AND external_id = ANY(%s)""",
                    (pre["source_ids"]["afltables"], [p["profile_path"] for p in planned]))
        identity_rows = [dict(zip(("id", "external_id", "player_id", "notes", "match_method"), r))
                         for r in cur.fetchall()]
        player_ids, identity_ids = judge_located_fixture(
            planned, player_rows, identity_rows, pre["sequences"]["players"]["max_id"],
            pre["sequences"]["external_identities"]["max_id"],
            {"players": fixture_ids["player_ids"], "identities": fixture_ids["identity_ids"]}
            if fixture_ids else None)
        if identity_ids:
            judge_references(reference_counts(cur, "external_identities", identity_ids))
            judge_references(reference_counts(cur, "players", player_ids,
                                              {("public", "external_identities", "player_id"): identity_ids}))
            cur.execute(SQL_TEARDOWN_IDENTITIES, (identity_ids, pre["source_ids"]["afltables"],
                                                  [p["profile_path"] for p in planned],
                                                  FIXTURE_MATCH_METHOD, [p["note"] for p in planned]))
            if cur.rowcount != len(identity_ids):
                raise RehearsalRefused(f"deleted {cur.rowcount} fixture identities, not {len(identity_ids)}")
            judge_references(reference_counts(cur, "players", player_ids))
            cur.execute(SQL_TEARDOWN_PLAYERS, (player_ids, [p["slug"] for p in planned],
                                               [p["note"] for p in planned]))
            if cur.rowcount != len(player_ids):
                raise RehearsalRefused(f"deleted {cur.rowcount} fixture players, not {len(player_ids)}")
        report["fixture_deleted"] = {"players": player_ids, "identities": identity_ids}

        # 6. Every sequence the fixture or the loader can advance.
        for sequence, last_value, is_called in sequence_restore_plan(pre["sequences"]):
            cur.execute(SQL_SETVAL, (sequence, last_value, is_called))
        report["sequences_restored"] = [s for s, _, _ in sequence_restore_plan(pre["sequences"])]

    # Z: a fresh session must reproduce F0, and the residue must be zero.
    fresh = connect(owner_dsn, OWNER_ENV)
    try:
        with read_only(fresh, repeatable=True) as cur:
            z = fingerprint(cur)
            plan_obj = FixturePlan(players=tuple(FixturePlayer(**p) for p in planned)) if planned else None
            after_residue = residue(cur, plan_obj) if plan_obj else None
    finally:
        fresh.close()
    diffs = compare_fingerprints(pre["fingerprint"], z)
    report.update({"fingerprint_z": z, "fingerprint_diffs": diffs, "residue": after_residue})
    if diffs:
        raise RehearsalRefused(f"the fresh-session fingerprint differs from F0: {diffs[:20]}")
    if after_residue and any(after_residue.values()):
        raise RehearsalRefused(f"residue after restore: {after_residue}")
    journal["restore"].update({"state": "complete", "completed_at_utc": utc_now(),
                               "fingerprint_sha256": z["sha256"]})
    save_json_atomic(evidence / JOURNAL_FILE, journal)
    return report


def post_restore_shape(owner_dsn: str, evidence: Path) -> dict:
    """A fresh session: the real resolver must give back exactly the measured 183/175/8/0 shape,
    with the same eight unresolved paths, over the staged (re-hashed) artefact."""
    staged = evidence / "afl_api" / CSV_NAME
    if loader.sha256_file(staged) != PINNED_CSV_SHA256:
        raise RehearsalRefused(f"{staged} does not hash to the pinned value")
    rows = loader.load_artefact(staged)
    fresh = connect(owner_dsn, OWNER_ENV)
    try:
        with read_only(fresh):
            shape = classify_resolution(loader.ProfileResolver(fresh), rows)
    finally:
        fresh.close()
    judge_preflight(shape)
    return {k: v for k, v in shape.items() if k != "resolution"}


# ============================================================================================
# Subcommands
# ============================================================================================

def command_run(args: argparse.Namespace) -> int:
    require_acknowledgement(args.acknowledge)
    owner_dsn, import_dsn = resolve_dsns(os.environ)
    tracked_before = tracked_input_hashes()
    source = load_fixture_source(Path(args.artefact_dir))
    evidence = prepare_evidence_dir(Path(args.evidence))
    afl_api_dir, availability = stage_inputs(source, evidence)
    inputs = {"afl_api_dir": afl_api_dir, "availability": availability}
    record: dict[str, Any] = {"tool": TOOL, "issue": ISSUE, "started_at_utc": utc_now(),
                              "inputs": {"csv_sha256": PINNED_CSV_SHA256,
                                         "manifest_sha256": PINNED_MANIFEST_SHA256,
                                         "fixture_paths": list(FIXTURE_PROFILE_PATHS),
                                         "profile_url_continuity": source.continuity},
                              "tracked_inputs_before": tracked_before}

    # P0 / N1–N6: offline, through the real CLI; then the in-process validate_offline().
    record["offline"] = offline_cases(evidence, afl_api_dir, availability,
                                      Path(args.duplicate_pair_dir) if args.duplicate_pair_dir else None)
    summary = loader.validate_offline(loader.ARTEFACT_PATH, loader.MANIFEST_PATH, loader.IDENTITY_PATH,
                                      afl_api_dir, availability)
    master_rows = loader.load_artefact(loader.ARTEFACT_PATH)
    master_manifest = loader.load_manifest(loader.MANIFEST_PATH)
    record["validate_offline"] = {k: summary[k] for k in ("rows", "votes_total", "winners", "seasons")}

    journal: dict[str, Any] = {"journal_version": JOURNAL_VERSION, "tool": TOOL, "issue": ISSUE,
                               "database": TARGET_DATABASE, "created_at_utc": utc_now(), "pre": None,
                               "fixture": {"state": "none"}, "steps": {}}
    save_json_atomic(evidence / JOURNAL_FILE, journal)

    owner = connect(owner_dsn, OWNER_ENV)
    imp = None
    own_pids = [owner.info.backend_pid]
    failure: BaseException | None = None
    try:
        imp = connect(import_dsn, IMPORT_ENV)
        # The closed import backend may linger in pg_stat_activity for a moment; it stays ours.
        own_pids.append(imp.info.backend_pid)
        # G + preflight (read-only).
        journal["pre"] = capture_pre_state(owner, imp, evidence, source, master_rows, master_manifest)
        save_json_atomic(evidence / JOURNAL_FILE, journal)
        record["pre"] = {k: v for k, v in journal["pre"].items() if k != "fingerprint"}
        record["f0_sha256"] = journal["pre"]["fingerprint"]["sha256"]

        # S: the eight-player prerequisite fixture.
        record["fixture"] = seed_fixture(owner, evidence, journal, source.plan,
                                         journal["pre"]["source_ids"]["afltables"])
        # PL: the real resolver again: 183/183, the eight on exactly the fixture's ids.
        with read_only(imp):
            post_seed = classify_resolution(loader.ProfileResolver(imp), source.artefact.rows)
        judge_post_seed(post_seed, record["fixture"]["player_ids"])
        resolution = post_seed["resolution"]
        expected = loader.expected_after_load(master_manifest, [source.artefact], master_rows)
        record["plan"] = {"post_seed": {k: v for k, v in post_seed.items() if k != "resolution"},
                          "expected_after_load": expected,
                          "plan_sha256": hashlib.sha256(json.dumps(sorted(resolution.items()))
                                                        .encode("utf-8")).hexdigest()}

        # D1 / F1 / D2 / F2: the DB-side refusals, then the post-rollover state.
        record["D1"] = expect_refusal(owner, imp, evidence, journal, "D1", inputs, "beyond")
        setup_row(owner, evidence, journal, "F1")
        record["D2"] = expect_refusal(owner, imp, evidence, journal, "D2", inputs, "in-progress season(s)")
        setup_row(owner, evidence, journal, "F2")
        # A1 / V1 / A2 / V2.
        record["A1"] = run_loader(imp, evidence, journal, "A1", inputs)
        if "refused" in record["A1"]:
            raise RehearsalRefused(f"A1 refused: {record['A1']['refused']}")
        record["V1"] = verify_load(owner, journal, "A1", source, resolution, 1)
        record["A2"] = run_loader(imp, evidence, journal, "A2", inputs)
        if "refused" in record["A2"]:
            raise RehearsalRefused(f"A2 refused: {record['A2']['refused']}")
        record["V2"] = verify_load(owner, journal, "A2", source, resolution, 2)
        if record["V2"]["projection"] != record["V1"]["projection"]:
            raise RehearsalRefused("the second load's content projection differs from the first's")
        record["second_load_content_equivalent"] = True
    except BaseException as exc:  # noqa: BLE001 - recorded; the restore still runs; exit 1
        failure = exc
        record["failure"] = f"{type(exc).__name__}: {redact(str(exc), owner_dsn, import_dsn)}"
    finally:
        if imp is not None:
            imp.rollback()
            imp.close()
        try:
            if journal.get("pre") is not None:
                record["restore"] = restore(owner, evidence, journal, owner_dsn, own_pids)
        except BaseException as exc:  # noqa: BLE001
            record["restore_failure"] = f"{type(exc).__name__}: {redact(str(exc), owner_dsn, import_dsn)}"
            failure = failure or exc
            print(f"RESTORE FAILED. Recover with: restore --acknowledge {TARGET_DATABASE} "
                  f"--evidence {evidence}", file=sys.stderr)
        finally:
            owner.close()
        if "restore" in record:
            try:
                record["post_restore_shape"] = post_restore_shape(owner_dsn, evidence)
            except BaseException as exc:  # noqa: BLE001
                record["post_restore_shape_failure"] = (
                    f"{type(exc).__name__}: {redact(str(exc), owner_dsn, import_dsn)}")
                failure = failure or exc
                print("POST-RESTORE SHAPE CHECK FAILED (the restore itself completed).", file=sys.stderr)
        record["tracked_inputs_after"] = tracked_input_hashes()
        record["tracked_inputs_unchanged"] = record["tracked_inputs_after"] == tracked_before
        record["finished_at_utc"] = utc_now()
        save_json_atomic(evidence / EVIDENCE_FILE, record)
    if failure is not None or not record["tracked_inputs_unchanged"]:
        print(f"REHEARSAL FAILED: {record.get('failure') or record.get('restore_failure') or record.get('post_restore_shape_failure') or 'tracked inputs changed'}",
              file=sys.stderr)
        return 1
    print(f"REHEARSAL PASS. Evidence: {evidence / EVIDENCE_FILE}")
    return 0


def command_restore(args: argparse.Namespace) -> int:
    require_acknowledgement(args.acknowledge)
    owner_dsn = resolve_owner_dsn(os.environ)
    evidence = Path(args.evidence).resolve()
    journal = load_journal(evidence)
    if journal.get("restore", {}).get("state") == "complete":
        print("The journal records a completed restore; nothing to do.")
        return 0
    owner = connect(owner_dsn, OWNER_ENV)
    try:
        report = restore(owner, evidence, journal, owner_dsn, [owner.info.backend_pid])
    finally:
        owner.close()
    report["post_restore_shape"] = post_restore_shape(owner_dsn, evidence)
    save_json_atomic(evidence / f"restore-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.json", report)
    print(f"RESTORE COMPLETE: {json.dumps({k: report.get(k) for k in ('plan', 'import_batches_deleted', 'fixture_deleted')}, default=str)}")
    return 0


def command_residue(args: argparse.Namespace) -> int:
    owner_dsn = resolve_owner_dsn(os.environ)
    plan = FixturePlan(players=tuple(
        FixturePlayer(profile_path=path, display_name="", slug=fixture_slug(path),
                      note=f"{FIXTURE_NOTE}: {path}") for path in FIXTURE_PROFILE_PATHS))
    owner = connect(owner_dsn, OWNER_ENV)
    try:
        with read_only(owner) as cur:
            found = residue(cur, plan)
    finally:
        owner.close()
    print(json.dumps(found, sort_keys=True))
    return 1 if any(found.values()) else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=f"{ISSUE} D-233-2 code_test_db Brownlow write-path rehearsal.")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="offline cases, fixture, real loads, exact restore")
    run.add_argument("--acknowledge", required=True)
    run.add_argument("--artefact-dir", required=True,
                     help=f"directory holding the genuine {CSV_NAME} and {MANIFEST_NAME}")
    run.add_argument("--evidence", required=True, help="a NEW directory outside the repository")
    run.add_argument("--duplicate-pair-dir", default=None,
                     help="optional: a genuine AFL API pair for a master season (case 5)")
    restore_cmd = sub.add_parser("restore", help="exact restore from a journal")
    restore_cmd.add_argument("--acknowledge", required=True)
    restore_cmd.add_argument("--evidence", required=True)
    sub.add_parser("residue", help="read-only fixture and ISSUE-233 Brownlow residue count")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return {"run": command_run, "restore": command_restore, "residue": command_residue}[args.command](args)
    except (RehearsalRefused, loader.BrownlowSeasonSourceError) as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
