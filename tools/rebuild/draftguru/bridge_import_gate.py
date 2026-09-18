#!/usr/bin/env python3
"""AFLDB-ISSUE-222 -- read-only pre-import PLAN and post-import VERIFY gates for the DraftGuru
person-page bridge import. Default target ``afldb_test``; ``--target dev`` generalises the same
gate to ``afldb_dev`` under its own, separately-guarded DSN. There is no PROD target.

    python tools/rebuild/draftguru/bridge_import_gate.py plan \\
        --bridge data/reference/draftguru-person-bridge-20260918-v2.afldb_test.json

    python tools/rebuild/draftguru/bridge_import_gate.py verify \\
        --bridge data/reference/draftguru-person-bridge-20260918-v2.afldb_test.json \\
        --expect-after-sha256 <from the plan> --expect-picks-after-sha256 <from the plan> \\
        --expect-newly-linked-sha256 <from the plan> --expect-baseline-sha256 <from the plan> \\
        --expect-batches-before <from the plan>

    # DEV -- --target and an explicit --bridge are both mandatory; there is no default DEV
    # child (the afldb_test child above must never be reused against DEV).
    python tools/rebuild/draftguru/bridge_import_gate.py plan --target dev \\
        --bridge data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json

    python tools/rebuild/draftguru/bridge_import_gate.py verify --target dev \\
        --bridge data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json \\
        --expect-after-sha256 <from the DEV plan> --expect-picks-after-sha256 <from the DEV plan> \\
        --expect-newly-linked-sha256 <from the DEV plan> --expect-baseline-sha256 <from the DEV plan> \\
        --expect-batches-before <from the DEV plan>

Both modes are the same read: the accepted Stage A snapshot is re-verified and re-parsed by
``import_draftguru.validate()`` exactly as the importer does (sha256 of every raw page, the
frozen contracts, the six-decision ledger, the bridge dataset through ``load_bridge``), the
target's registration and live human decisions are read, and ``import_draftguru.apply_authority``
-- the importer's own function, not a re-implementation -- is replayed over the 5,057 persons
with seeding forbidden. The result is the exact row state the importer would write. ``plan``
compares it with what is stored NOW and refuses on anything but the planned link changes;
``verify`` compares it with what is stored AFTER the import and refuses on any difference.

Database discipline (identical in every target):

  * ``--target`` selects the database by name only, from a fixed, closed list (``test`` ->
    ``afldb_test``, ``dev`` -> ``afldb_dev``; no PROD target exists and none can be added by a
    command-line value); the default is ``test``, so every pre-existing invocation with no
    ``--target`` is unchanged;
  * each target reads its OWN DSN environment variable -- ``AFLDB_TEST_DATABASE_URL`` for
    ``test``, ``AFLDB_DEV_DATABASE_URL`` for ``dev`` -- deliberately never the importer's own
    elevated write-role DSN or the migration schema-owner DSN (the latter documented elsewhere
    as "used only by migrations"): a gate that shared a DSN with a writer could silently start
    reading through a connection whose privileges or pooling something else depends on, and a
    future edit to the write DSN must never change what this read-only gate is pointed at. The
    DSN's path must be exactly ``/afldb_test`` or ``/afldb_dev`` respectively; the server's
    ``current_database()`` is checked again after connecting;
  * ``dev`` has no default bridge dataset -- ``--bridge`` is mandatory for ``--target dev`` and
    is refused outright if it resolves to the ``afldb_test`` child path, so a DEV run can never
    silently verify the test child instead; the child's own ``target`` field is also checked
    against the selected database, so an ``afldb_test``-labelled child is refused under
    ``--target dev`` even if some other path pointed at it;
  * the connection is opened with ``default_transaction_read_only=on`` and ``TimeZone=UTC``,
    marked read-only and REPEATABLE READ, and the server's ``transaction_read_only`` and
    ``default_transaction_read_only`` are both asserted ``on`` before any other statement;
  * every statement passes through a cursor wrapper that refuses anything but ``SELECT``;
  * the transaction is rolled back and the connection closed unconditionally;
  * nothing is written to disk -- no artefact, no checkpoint, no log file;
  * the DSN and credentials are never printed; connection errors are reported by class only;
  * every guard above runs, and fails closed, before any target data is read.

Exit status: 0 = every check held (plan: proceed / verify: import proven); 1 = refused (a check
failed -- fail closed); 2 = the gate could not run (structural error, including an unknown
``--target``, a missing DSN, or a missing mandatory ``--bridge``). Two runs over the same state
with the same arguments and target print the same ``summary_sha256``.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable
from urllib.parse import urlparse

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]
sys.path.insert(0, str(TOOL_DIR))
sys.path.insert(0, str(REPO_ROOT / "tools" / "migration"))

import import_draftguru as imp                  # noqa: E402  (the importer's own functions)

TOOL = "tools/rebuild/draftguru/bridge_import_gate.py"
TOOL_VERSION = "1.0.0"

DSN_ENV = "AFLDB_TEST_DATABASE_URL"
REQUIRED_DATABASE = "afldb_test"

CHILD_REL = "data/reference/draftguru-person-bridge-20260918-v2.afldb_test.json"
EXPECTED_CHILD_SHA256 = "b996c60e9d4de3aeb6f250f360b2a66164a2211b9604338a65918e79fa29e1c5"
# The child's withheld[] rows carry (player_url, reason) only; the identity a
# target_not_registered person was withheld FOR is the parent's bridges[] entry, so the
# staleness check (section 4.2) reads the pinned v2 SOURCE-EVIDENCE parent as well.
PARENT_REL = "data/reference/draftguru-person-bridge-20260918-v2.json"
EXPECTED_PARENT_SHA256 = "ad25d965cba72b97be895451dc488bf03a1899421e902394baa52a620abe8e57"
EXPECTED_CHILD_COUNTS = {
    "bridges": 3468, "withheld": 1589,
    "U-no-href": 1493, "target_not_registered": 94, "different_person_wrong_href": 2,
}
EXPECTED_POPULATION = {"persons": imp.EXPECTED_PERSONS, "picks": imp.EXPECTED_ROWS}

# DEV generalises the same gate to a second, separately-guarded database. It reads its OWN DSN
# environment variable -- never the importer's own elevated write-role DSN, whose target this
# gate must never silently follow, and never the migration schema-owner DSN (documented in
# .env.example as "used only by migrations"). Naming it AFLDB_DEV_DATABASE_URL mirrors
# AFLDB_TEST_DATABASE_URL exactly: a bare, database-named DSN dedicated to this gate, enforced
# read-only at the session and cursor level exactly as the test target already is, never by
# relying on a lower-privilege role. There is no PROD entry, deliberately: this dict is the
# closed list of targets this tool will ever connect to, and it cannot be extended from the
# command line.
DEV_DATABASE = "afldb_dev"
DEV_DSN_ENV = "AFLDB_DEV_DATABASE_URL"

TARGETS: dict[str, dict[str, Any]] = {
    "test": {
        "database": REQUIRED_DATABASE, "dsn_env": DSN_ENV,
        "child_rel": CHILD_REL, "expected_child_sha256": EXPECTED_CHILD_SHA256,
        "expected_child_counts": EXPECTED_CHILD_COUNTS,
    },
    "dev": {
        # No default child, no pinned hash, no pinned counts: the DEV deployment child does not
        # exist yet. --bridge and (optionally) --expect-child-sha256 must be supplied explicitly.
        "database": DEV_DATABASE, "dsn_env": DEV_DSN_ENV,
        "child_rel": None, "expected_child_sha256": None, "expected_child_counts": None,
    },
}

_DG = "https://www.draftguru.com.au/players/"
# The two Phase 3 rejections (AFLDB-ISSUE-222.md §11.13/§11.14): neither person may link and
# neither AFL Tables identity may be reached by any DraftGuru person after the import.
REJECTED_IDENTITIES = {
    _DG + "craig_somerville/1": "players/C/Craig_Somerville.html",
    _DG + "david_sullivan/1": "players/D/David_Sullivan.html",
}

EXIT_OK, EXIT_REFUSED, EXIT_ERROR = 0, 1, 2

LINK_COLUMNS = ("player_id", "link_status", "match_method", "confidence_notes", "is_matching_backlog")
PERSON_NONLINK = ("dg_person_id", "display_name_raw", "name_key", "candidate_count",
                  "reported_games", "reported_goals")
PICK_LINK = ("player_id", "link_status_value", "match_method", "confidence_notes")
PICK_NONLINK = tuple(c for c in imp.PICK_COLUMNS
                     if c not in PICK_LINK and c != "import_batch_id")

ALLOWED_PERSON_STATES = {
    ("unique", imp.BRIDGE_MATCH_METHOD, True),
    ("resolved", imp.LEDGER_MATCH_METHOD, True),
    ("unmatched", None, False),
    ("unmatched", imp.LEDGER_MATCH_METHOD, False),
}

SELECT_RE = re.compile(r"^\s*(?:--[^\n]*\n\s*)*SELECT\b", re.IGNORECASE)


class GateError(Exception):
    """The gate could not be carried out (structural). Exit 2, never a verdict."""


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(payload: object) -> bytes:
    return json.dumps(payload, ensure_ascii=True, sort_keys=True,
                      separators=(",", ":")).encode("ascii")


def sha256_canonical(payload: object) -> str:
    return sha256_bytes(canonical(payload))


def url_key(url: str) -> bytes:
    return url.encode("utf-8")


class Report:
    def __init__(self, emit: Callable[[str], None] = print) -> None:
        self.emit = emit
        self.checks: list[tuple[str, bool, str]] = []
        self.failures: list[str] = []
        self.warnings: list[str] = []

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        self.checks.append((name, bool(ok), detail))
        if ok:
            self.emit(f"  PASS  {name}")
        else:
            self.emit(f"  FAIL  {name}{(' -- ' + detail) if detail else ''}")
            self.failures.append(name)
        return bool(ok)

    def warn(self, message: str) -> None:
        self.warnings.append(message)
        self.emit(f"  WARN  {message}")

    def result(self, label: str, value: object) -> None:      # apply_authority's reporter shape
        self.emit(f"        {label}: {value}")

    def section(self, title: str) -> None:
        self.emit(f"\n{title}")


# ---------------------------------------------------------------------------
# Read-only connection discipline
# ---------------------------------------------------------------------------

class SelectOnlyCursor:
    """Refuses every statement that is not a SELECT before it reaches the server."""

    def __init__(self, cur: Any) -> None:
        self._cur = cur

    def execute(self, sql: str, params: Any = None) -> "SelectOnlyCursor":
        if not SELECT_RE.match(sql):
            raise GateError("REFUSED: the gate attempted a non-SELECT statement; nothing was sent")
        self._cur.execute(sql, params)
        return self

    def fetchall(self) -> list:
        return self._cur.fetchall()

    def fetchone(self) -> Any:
        return self._cur.fetchone()

    @property
    def rowcount(self) -> int:
        return self._cur.rowcount

    def __enter__(self) -> "SelectOnlyCursor":
        return self

    def __exit__(self, *_exc) -> bool:
        return False


def resolve_dsn(target: str = "test", environ: dict | None = None) -> str:
    """Resolve the DSN for ``target`` (default ``"test"``, matching every pre-existing
    invocation). Fails closed on an unknown target -- there is no PROD entry to fall through to."""
    if target not in TARGETS:
        raise GateError(f"unknown --target {target!r} -- only {sorted(TARGETS)} exist (no PROD target)")
    cfg = TARGETS[target]
    dsn_env, required_database = cfg["dsn_env"], cfg["database"]
    env = os.environ if environ is None else environ
    dsn = env.get(dsn_env)
    if not dsn:
        raise GateError(f"{dsn_env} is not set -- refusing to plan or verify against an unknown target")
    dsn = dsn.strip()
    parsed = urlparse(dsn)
    if parsed.scheme not in ("postgresql", "postgres"):
        raise GateError(f"{dsn_env} is not a postgresql:// DSN")
    if parsed.path.lstrip("/") != required_database:
        raise GateError(f"{dsn_env} does not target /{required_database} -- refusing")
    return dsn


def open_read_only(dsn: str) -> Any:
    """A psycopg connection that can only read. The DSN never appears in any message."""
    try:
        import psycopg
    except ImportError as exc:
        raise GateError(f"psycopg is not importable: {type(exc).__name__}") from None
    try:
        conn = psycopg.connect(
            dsn,
            options="-c default_transaction_read_only=on -c TimeZone=UTC",
            application_name="afldb-bridge-import-gate",
        )
    except Exception as exc:  # noqa: BLE001 -- class only; the message may name the host/user
        raise GateError(f"connection failed: {type(exc).__name__} (details withheld)") from None
    conn.read_only = True
    conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
    return conn


def assert_read_only(cur: SelectOnlyCursor, required_database: str = REQUIRED_DATABASE) -> dict:
    cur.execute("SELECT current_setting('transaction_read_only'), "
                "current_setting('default_transaction_read_only'), current_database(), "
                "current_setting('TimeZone')")
    txn_ro, default_ro, database, tz = cur.fetchone()
    if txn_ro != "on" or default_ro != "on":
        raise GateError("REFUSED: the server reports the transaction is not read-only")
    if database != required_database:
        raise GateError(f"REFUSED: connected database is not {required_database}")
    return {"transaction_read_only": txn_ro, "default_transaction_read_only": default_ro,
            "current_database": database, "timezone": tz}


def with_read_only(conn_factory: Callable[[], Any], body: Callable[[SelectOnlyCursor, dict], Any],
                    required_database: str = REQUIRED_DATABASE) -> Any:
    """Open, assert, run ``body``, then roll back and close no matter what."""
    conn = conn_factory()
    try:
        with conn.cursor() as raw:
            cur = SelectOnlyCursor(raw)
            settings = assert_read_only(cur, required_database)
            return body(cur, settings)
    finally:
        try:
            conn.rollback()
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Datasets (hash-pinned)
# ---------------------------------------------------------------------------

def load_child(path: Path, expect_sha256: str | None, expect_counts: dict | None,
               required_database: str = REQUIRED_DATABASE) -> tuple[dict, str]:
    if not path.is_file():
        raise GateError(f"bridge dataset not found: {path.as_posix()}")
    data = path.read_bytes()
    digest = sha256_bytes(data)
    if expect_sha256 is not None and digest != expect_sha256:
        raise GateError("REFUSED: the bridge dataset's sha256 is not the pinned child hash "
                        f"(observed {digest[:16]}..., expected {expect_sha256[:16]}...)")
    doc = json.loads(data.decode("utf-8"))
    if doc.get("kind") != "deployment":
        raise GateError("REFUSED: the dataset is not a deployment child (kind != 'deployment')")
    if doc.get("target") != required_database:
        raise GateError(f"REFUSED: the child targets {doc.get('target')!r}, not {required_database}")
    if doc.get("schema_version") != 1:
        raise GateError("REFUSED: unsupported child schema_version")
    withheld = doc.get("withheld") or []
    reasons: dict[str, int] = {}
    for row in withheld:
        reasons[row.get("reason")] = reasons.get(row.get("reason"), 0) + 1
    observed = {"bridges": len(doc.get("bridges") or []), "withheld": len(withheld), **reasons}
    if expect_counts is not None:
        for key, value in expect_counts.items():
            if observed.get(key, 0) != value:
                raise GateError(f"REFUSED: child count {key} is {observed.get(key, 0)}, expected {value}")
    return doc, digest


def load_parent_map(path: Path, child: dict, expect_sha256: str | None) -> dict[str, str]:
    """player_url -> afltables_external_id from the source-evidence parent the child names."""
    if not path.is_file():
        raise GateError(f"parent dataset not found: {path.as_posix()}")
    data = path.read_bytes()
    digest = sha256_bytes(data)
    if expect_sha256 is not None and digest != expect_sha256:
        raise GateError("REFUSED: the parent dataset's sha256 is not the pinned v2 parent hash")
    if child.get("parent_sha256") != digest:
        raise GateError("REFUSED: the child's parent_sha256 does not name this parent")
    doc = json.loads(data.decode("utf-8"))
    return {row["player_url"]: row["afltables_external_id"] for row in doc.get("bridges") or []}


# ---------------------------------------------------------------------------
# Database reads (SELECT only)
# ---------------------------------------------------------------------------

PERSON_SQL = """SELECT id, dg_person_id, player_url, display_name_raw, name_key, player_id,
                       link_status::text, candidate_count, match_method, confidence_notes,
                       reported_games, reported_goals, is_matching_backlog
                  FROM draft_persons WHERE source_id = %s"""
PERSON_FIELDS = ("id", "dg_person_id", "player_url", "display_name_raw", "name_key", "player_id",
                 "link_status", "candidate_count", "match_method", "confidence_notes",
                 "reported_games", "reported_goals", "is_matching_backlog")

PICK_FIELDS = ("id",) + imp.PICK_COLUMNS
_PICK_SELECT = "SELECT id, " + ", ".join(
    f"{c}::text" if c == "link_status_value" else c for c in imp.PICK_COLUMNS)
PICK_SQL = _PICK_SELECT + " FROM draft_picks WHERE source_id = %s"
MANUAL_PICK_SQL = (_PICK_SELECT + " FROM draft_picks WHERE source_id = "
                   "(SELECT id FROM sources WHERE key = 'manual_admin_edit')")

IDENTITY_SQL = """SELECT external_id, external_name, external_url, player_id, status::text,
                         candidate_count, match_method, notes
                    FROM external_identities WHERE source_id = %s"""
IDENTITY_FIELDS = ("external_id", "external_name", "external_url", "player_id", "status",
                   "candidate_count", "match_method", "notes")

OVERRIDES_SQL = """SELECT id, entity_key, field_group, override_values, is_active
                     FROM data_overrides WHERE entity_type = 'draft_picks' ORDER BY id"""
RESOLUTIONS_SQL = """SELECT id, target_id, action, player_id, previous_status::text, admin_user_id,
                            note, created_at::text
                       FROM player_link_resolutions WHERE target_table = 'draft_picks' ORDER BY id"""
CLUBS_SQL = "SELECT slug, id, name FROM clubs"
BATCHES_SQL = """SELECT id, tool, target_table, status::text, records_read, records_inserted,
                        records_updated, records_rejected, error, started_at::text, completed_at::text
                   FROM import_batches WHERE source_id = %s ORDER BY id DESC LIMIT 5"""
BATCH_COUNT_SQL = "SELECT count(*), coalesce(max(id), 0) FROM import_batches WHERE source_id = %s"
IDENTITY_RESOLVE_SQL = """SELECT DISTINCT e.player_id
                            FROM external_identities e JOIN sources s ON s.id = e.source_id
                           WHERE e.status IN ('unique', 'resolved') AND e.player_id IS NOT NULL
                             AND s.key = %s AND e.external_id = %s"""

_ROW_DIGEST = "SELECT count(*), md5(coalesce(string_agg(row_to_json(t)::text, E'\\n' ORDER BY t.{order}), ''))"

# Digests of everything the import must NOT change, computed server-side, ordered by key.
BASELINE_SQL: dict[str, tuple[str, tuple]] = {
    "players": (_ROW_DIGEST.format(order="id") + " FROM players t", ()),
    "clubs": (_ROW_DIGEST.format(order="id") + " FROM clubs t", ()),
    "sources": (_ROW_DIGEST.format(order="id") + " FROM sources t", ()),
    "external_identities_not_draftguru": (
        _ROW_DIGEST.format(order="id") + " FROM external_identities t WHERE t.source_id <> %s", ("dg",)),
    "player_link_resolutions": (_ROW_DIGEST.format(order="id") + " FROM player_link_resolutions t", ()),
    "data_overrides": (_ROW_DIGEST.format(order="id") + " FROM data_overrides t", ()),
    "draft_picks_not_draftguru": (
        _ROW_DIGEST.format(order="id") + " FROM draft_picks t WHERE t.source_id IS DISTINCT FROM %s", ("dg",)),
    "draft_persons_not_draftguru": (
        _ROW_DIGEST.format(order="id") + " FROM draft_persons t WHERE t.source_id <> %s", ("dg",)),
    "draft_persons_draftguru_nonlink": (
        "SELECT count(*), md5(coalesce(string_agg(json_build_object('id', id, 'dg', dg_person_id, "
        "'url', player_url, 'name', display_name_raw, 'key', name_key, 'cc', candidate_count, "
        "'g', reported_games, 'go', reported_goals)::text, E'\\n' ORDER BY id), '')) "
        "FROM draft_persons WHERE source_id = %s", ("dg",)),
    "draft_picks_draftguru_nonlink": (
        "SELECT count(*), md5(coalesce(string_agg(json_build_object("
        + ", ".join(f"'{c}', {c}" for c in ("id",) + PICK_NONLINK)
        + ")::text, E'\\n' ORDER BY id), '')) FROM draft_picks WHERE source_id = %s", ("dg",)),
    "player_career_stats": (_ROW_DIGEST.format(order="player_id") + " FROM player_career_stats t", ()),
}


def read_target(cur: SelectOnlyCursor, rep: Report) -> dict:
    """Everything the gate needs from the database, in one read-only transaction."""
    source_id = imp.resolve_source_id(cur, imp.SOURCE_KEY)
    afl_source_id = imp.resolve_source_id(cur, imp.AFLTABLES_SOURCE_KEY)
    afl_players = imp.resolve_afltables_players(cur, afl_source_id)
    manual_players = imp.resolve_manual_players(cur)
    live = imp.read_live_decisions(cur, source_id)          # HALTs on contradictory picks
    cur.execute("SELECT external_id, player_id FROM external_identities "
                "WHERE source_id = %s AND player_id IS NOT NULL", (source_id,))
    dg_identities = dict(cur.fetchall())

    cur.execute(PERSON_SQL, (source_id,))
    persons: dict[str, dict] = {}
    duplicate_urls = []
    for row in cur.fetchall():
        rec = dict(zip(PERSON_FIELDS, row))
        if rec["player_url"] in persons:
            duplicate_urls.append(rec["player_url"])
        persons[rec["player_url"]] = rec

    cur.execute(PICK_SQL, (source_id,))
    picks: dict[tuple, dict] = {}
    duplicate_pick_keys = []
    for row in cur.fetchall():
        rec = dict(zip(PICK_FIELDS, row))
        key = (rec["player_url"], rec["draft_year"], rec["draft_kind"])
        if key in picks:
            duplicate_pick_keys.append(key)
        picks[key] = rec

    cur.execute(MANUAL_PICK_SQL)
    manual_picks = {}
    for row in cur.fetchall():
        rec = dict(zip(PICK_FIELDS, row))
        manual_picks[rec["player_url"]] = rec

    cur.execute(IDENTITY_SQL, (source_id,))
    identities = {row[0]: dict(zip(IDENTITY_FIELDS, row)) for row in cur.fetchall()}

    cur.execute(OVERRIDES_SQL)
    overrides = [dict(zip(("id", "entity_key", "field_group", "override_values", "is_active"), row))
                 for row in cur.fetchall()]
    cur.execute(RESOLUTIONS_SQL)
    resolutions = [list(row) for row in cur.fetchall()]
    cur.execute(CLUBS_SQL)
    clubs = {slug: (cid, name) for slug, cid, name in cur.fetchall()}
    cur.execute(BATCHES_SQL, (source_id,))
    batches = [dict(zip(("id", "tool", "target_table", "status", "records_read", "records_inserted",
                         "records_updated", "records_rejected", "error", "started_at", "completed_at"),
                        row)) for row in cur.fetchall()]
    cur.execute(BATCH_COUNT_SQL, (source_id,))
    batch_count, batch_max_id = cur.fetchone()

    baseline = {}
    for label, (sql, params) in BASELINE_SQL.items():
        cur.execute(sql, tuple(source_id if p == "dg" else p for p in params))
        count, digest = cur.fetchone()
        baseline[label] = {"count": int(count), "md5": digest}

    target = {
        "source_id": source_id, "afl_source_id": afl_source_id, "afl_players": afl_players,
        "manual_players": manual_players, "live": live, "dg_identities": dg_identities,
        "persons": persons, "duplicate_urls": duplicate_urls,
        "picks": picks, "duplicate_pick_keys": duplicate_pick_keys,
        "manual_picks": manual_picks, "identities": identities, "overrides": overrides,
        "resolutions": resolutions, "clubs": clubs, "batches": batches,
        "batch_count": int(batch_count), "batch_max_id": int(batch_max_id), "baseline": baseline,
    }
    # Needs the cursor (identity resolution), so it runs inside the read-only transaction.
    target["manual_findings"] = manual_pick_findings(
        target, lambda source, external_id: _resolve_identity(cur, source, external_id))
    return target


def _resolve_identity(cur: SelectOnlyCursor, source: str, external_id: str) -> list[int]:
    cur.execute(IDENTITY_RESOLVE_SQL, (source, external_id))
    return [row[0] for row in cur.fetchall()]


# ---------------------------------------------------------------------------
# The importer's decision, replayed
# ---------------------------------------------------------------------------

def registration_findings(bridges: dict[str, str], afl_players: dict[str, list[int]]) -> dict:
    """Every bridge target must be registered exactly once (the importer HALTs otherwise)."""
    unregistered = sorted(u for u, i in bridges.items() if len(afl_players.get(i, [])) == 0)
    ambiguous = sorted((u, i, len(afl_players[i])) for u, i in bridges.items()
                       if len(afl_players.get(i, [])) > 1)
    return {"bridge_unregistered": unregistered, "bridge_ambiguous": ambiguous}


def replay_authority(prepared: dict, target: dict, rep: Report) -> tuple[dict, dict]:
    persons = copy.deepcopy(prepared["persons"])
    dg_identities = dict(target["dg_identities"])
    stats = imp.apply_authority(
        None, rep, persons, prepared["ledger"], target["live"], prepared["bridges"],
        target["afl_players"], target["source_id"], dg_identities,
        seeds_allowed=False, manual_players=target["manual_players"],
    )
    return persons, stats


def expected_person_rows(persons: dict, source_id: int) -> dict:
    out = {}
    for url, p in persons.items():
        out[url] = {
            "source_id": source_id, "dg_person_id": p["dg_person_id"], "player_url": url,
            "display_name_raw": p["display_name_raw"], "name_key": p["name_key"],
            "player_id": p["player_id"], "link_status": p["link_status"], "candidate_count": 0,
            "match_method": p["match_method"], "confidence_notes": p["confidence_notes"],
            "reported_games": p["reported_games"], "reported_goals": p["reported_goals"],
            "is_matching_backlog": p["player_id"] is None and p["reported_games"] > 0,
        }
    return out


def expected_pick_rows(prepared: dict, persons: dict, target: dict) -> dict:
    clubs = target["clubs"]
    stored_persons = target["persons"]
    out = {}
    for pick in prepared["picks"]:
        person = persons[pick["player_url"]]
        slug = pick["club_slug"]
        if slug is not None and slug not in clubs:
            raise GateError(f"club slug {slug!r} is not in clubs; the importer would fail on it")
        stored_person = stored_persons.get(pick["player_url"])
        out[(pick["player_url"], pick["draft_year"], pick["draft_kind"])] = {
            "draft_year": pick["draft_year"], "draft_type": pick["draft_type"],
            "draft_kind": pick["draft_kind"], "pick_number": pick["pick_number"],
            "pick_note": pick["pick_note"], "player_id": person["player_id"],
            "player_name_raw": pick["player_name_raw"], "link_status_value": person["link_status"],
            "candidate_count": 0, "match_method": person["match_method"],
            "confidence_notes": person["confidence_notes"],
            "club_id": clubs[slug][0] if slug else None, "club_name_raw": pick["club_name_raw"],
            "original_club_raw": pick["original_club_raw"], "draft_age": pick["draft_age"],
            "height_cm": pick["height_cm"], "weight_kg": None, "grade": None,
            "competition": pick["competition"], "signing": pick["signing"],
            "signing_kind": pick["signing_kind"], "signing_detail": None, "detail": pick["detail"],
            "source_id": target["source_id"], "source_record_id": pick["source_record_id"],
            "draft_person_id": stored_person["id"] if stored_person else None,
            "dg_person_id": person["dg_person_id"], "player_url": pick["player_url"],
            "reported_games": person["reported_games"], "reported_goals": person["reported_goals"],
        }
    return out


def apply_source_overrides(expected_picks: dict, target: dict) -> int:
    """replay_admin_overrides(draft_picks) step 3, in Python: the source-owned patch keyed on
    source_id|player_url|draft_year|draft_kind, jsonb_exists semantics (absent vs explicit
    null preserved), club via slug with COALESCE fallback. Returns the number of patched rows."""
    clubs = target["clubs"]
    by_key = {f"{r['source_id']}|{r['player_url']}|{r['draft_year']}|{r['draft_kind']}": r
              for r in expected_picks.values()}
    patched = 0
    for o in target["overrides"]:
        if not o["is_active"] or str(o["entity_key"]).startswith("manual_admin_edit:"):
            continue
        row = by_key.get(o["entity_key"])
        if row is None:
            continue
        v = o["override_values"] or {}
        if v.get("player_name_raw") is not None:
            row["player_name_raw"] = v["player_name_raw"]
        for field in ("original_club_raw", "pick_note", "detail"):
            if field in v:
                row[field] = v[field]
        for field in ("draft_age", "height_cm", "weight_kg", "pick_number"):
            if field in v:
                row[field] = int(v[field]) if v[field] is not None else None
        if "club_slug" in v and v["club_slug"] is not None:
            club = clubs.get(v["club_slug"])
            if club is not None:
                row["club_id"], row["club_name_raw"] = club
        patched += 1
    return patched


def manual_pick_findings(target: dict, resolve_identity: Callable[[str, str], list[int]]) -> dict:
    """replay_admin_overrides(draft_picks) steps 1-2: an active manual selection whose row is
    absent would be re-created; one whose payload disagrees with its row would be rewritten.
    Both are changes outside the planned link set and are reported as such."""
    clubs = target["clubs"]
    missing, mismatched, unresolvable, active = [], [], [], 0
    for o in target["overrides"]:
        if not o["is_active"] or not str(o["entity_key"]).startswith("manual_admin_edit:"):
            continue
        active += 1
        token = str(o["entity_key"]).split(":", 1)[1]
        v = o["override_values"] or {}
        identity = v.get("player_identity") or ""
        source, _, external_id = identity.partition(":")
        players = resolve_identity(source, external_id) if source and external_id else []
        club = clubs.get(v.get("club_slug"))
        if len(players) != 1 or club is None or v.get("draft_year") is None:
            unresolvable.append(o["entity_key"])
            continue
        expected = {
            "draft_year": int(v["draft_year"]), "draft_type": v.get("draft_type"),
            "draft_kind": v.get("draft_kind"),
            "pick_number": int(v["pick_number"]) if v.get("pick_number") is not None else None,
            "pick_note": v.get("pick_note"), "player_id": players[0], "link_status_value": "resolved",
            "club_id": club[0], "club_name_raw": club[1], "original_club_raw": v.get("original_club_raw"),
            "draft_age": int(v["draft_age"]) if v.get("draft_age") is not None else None,
            "height_cm": int(v["height_cm"]) if v.get("height_cm") is not None else None,
            "weight_kg": int(v["weight_kg"]) if v.get("weight_kg") is not None else None,
            "detail": v.get("detail"),
        }
        stored = target["manual_picks"].get("manual:" + token)
        if stored is None:
            missing.append(o["entity_key"])
            continue
        diffs = [f for f, val in expected.items() if stored.get(f) != val]
        if v.get("player_name_raw") is not None and stored.get("player_name_raw") != v["player_name_raw"]:
            diffs.append("player_name_raw")
        if diffs:
            mismatched.append((o["entity_key"], diffs))
    return {"active_manual_overrides": active, "manual_rows_missing": missing,
            "manual_rows_mismatched": mismatched, "manual_unresolvable": unresolvable}


# ---------------------------------------------------------------------------
# Classification and hashing
# ---------------------------------------------------------------------------

def link_view(row: dict, columns=LINK_COLUMNS) -> tuple:
    return tuple(row.get(c) for c in columns)


def classify_persons(stored: dict, expected: dict) -> dict:
    classes: dict[str, list] = {
        "newly_linked": [], "already_agreeing_linked_human": [], "already_agreeing_linked_bridge": [],
        "already_agreeing_unlinked": [], "link_dropped": [], "relinked": [], "link_metadata_change": [],
        "unexpected_link_change": [], "missing": [], "extra": [], "nonlink_change": [],
        "dg_person_id_permutation": [],
    }
    for url in sorted(set(stored) | set(expected), key=url_key):
        s, e = stored.get(url), expected.get(url)
        if s is None:
            classes["missing"].append(url)
            continue
        if e is None:
            classes["extra"].append(url)
            continue
        if s["dg_person_id"] != e["dg_person_id"]:
            classes["dg_person_id_permutation"].append(url)
        non_link = [c for c in PERSON_NONLINK if c != "dg_person_id" and s.get(c) != e.get(c)]
        if non_link:
            classes["nonlink_change"].append((url, non_link))
        if link_view(s) == link_view(e):
            if e["player_id"] is None:
                classes["already_agreeing_unlinked"].append(url)
            elif e["match_method"] == imp.BRIDGE_MATCH_METHOD:
                classes["already_agreeing_linked_bridge"].append(url)
            else:
                classes["already_agreeing_linked_human"].append(url)
            continue
        if s["player_id"] is None and e["player_id"] is not None:
            if e["match_method"] == imp.BRIDGE_MATCH_METHOD and e["link_status"] == "unique":
                classes["newly_linked"].append(url)
            else:
                classes["unexpected_link_change"].append(url)
        elif s["player_id"] is not None and e["player_id"] is None:
            classes["link_dropped"].append(url)
        elif s["player_id"] != e["player_id"]:
            classes["relinked"].append(url)
        else:
            classes["link_metadata_change"].append(url)
    return classes


def classify_picks(stored: dict, expected: dict) -> dict:
    classes: dict[str, list] = {"missing": [], "extra": [], "link_change": [], "nonlink_change": []}
    for key in sorted(set(stored) | set(expected), key=lambda k: (url_key(k[0]), k[1], k[2])):
        s, e = stored.get(key), expected.get(key)
        if s is None:
            classes["missing"].append(key)
            continue
        if e is None:
            classes["extra"].append(key)
            continue
        if link_view(s, PICK_LINK) != link_view(e, PICK_LINK):
            classes["link_change"].append(key)
        non_link = [c for c in PICK_NONLINK if s.get(c) != e.get(c)]
        if non_link:
            classes["nonlink_change"].append((key, non_link))
    return classes


def expected_identity_rows(persons: dict, label: str) -> dict:
    out = {}
    for url, p in persons.items():
        out[url] = {
            "external_id": url, "external_name": p["display_name_raw"], "external_url": url,
            "player_id": p["player_id"],
            "status": p["link_status"] if p["player_id"] is not None else "unmatched",
            "candidate_count": 0, "match_method": p["match_method"],
            "notes": f"stage_a_snapshot={label}",
        }
    return out


def classify_identities(stored: dict, expected: dict) -> dict:
    classes: dict[str, list] = {"missing": [], "extra": [], "link_change": [], "other_change": []}
    for url in sorted(set(stored) | set(expected), key=url_key):
        s, e = stored.get(url), expected.get(url)
        if s is None:
            classes["missing"].append(url)
            continue
        if e is None:
            classes["extra"].append(url)
            continue
        link_diff = [c for c in ("player_id", "status", "match_method") if s.get(c) != e.get(c)]
        other_diff = [c for c in ("external_name", "external_url", "candidate_count", "notes")
                      if s.get(c) != e.get(c)]
        if link_diff:
            classes["link_change"].append(url)
        if other_diff:
            classes["other_change"].append((url, other_diff))
    return classes


def after_state_rows(expected_persons: dict) -> list:
    return [[url, r["player_id"], r["link_status"], r["match_method"], r["confidence_notes"],
             r["is_matching_backlog"]]
            for url, r in sorted(expected_persons.items(), key=lambda kv: url_key(kv[0]))]


def picks_after_rows(expected_picks: dict) -> list:
    return [[k[0], k[1], k[2], r["player_id"], r["link_status_value"], r["match_method"]]
            for k, r in sorted(expected_picks.items(),
                               key=lambda kv: (url_key(kv[0][0]), kv[0][1], kv[0][2]))]


def newly_linked_rows(urls, expected_persons: dict, bridges: dict) -> list:
    return [[url, bridges.get(url), expected_persons[url]["player_id"]]
            for url in sorted(urls, key=url_key)]


def totals(expected_persons: dict, expected_picks: dict) -> dict:
    by_person: dict[str, int] = {}
    for r in expected_persons.values():
        key = f"{r['link_status']}|{r['match_method'] or ''}"
        by_person[key] = by_person.get(key, 0) + 1
    by_pick: dict[str, int] = {}
    for r in expected_picks.values():
        by_pick[r["link_status_value"]] = by_pick.get(r["link_status_value"], 0) + 1
    linked_picks = sum(v for k, v in by_pick.items() if k in ("unique", "resolved"))
    return {"persons_by_status_method": dict(sorted(by_person.items())),
            "picks_by_status": dict(sorted(by_pick.items())),
            "linked_persons": sum(1 for r in expected_persons.values() if r["player_id"] is not None),
            "linked_picks": linked_picks,
            "pick_capability_pct": round(100.0 * linked_picks / max(len(expected_picks), 1), 2)}


# ---------------------------------------------------------------------------
# The gate
# ---------------------------------------------------------------------------

def run_gate(mode: str, prepared: dict, child: dict, child_sha256: str, parent_map: dict[str, str],
             label: str, conn_factory: Callable[[], Any], *, expect: dict | None = None,
             population: dict | None = None, rejected: dict | None = None,
             print_manifest: bool = False, emit: Callable[[str], None] = print,
             required_database: str = REQUIRED_DATABASE) -> dict:
    """Shared body of ``plan`` and ``verify``. Returns the summary (with ``failures``).
    ``required_database`` defaults to ``afldb_test``, matching every pre-existing caller that
    does not pass it; ``main()`` passes the selected target's database explicitly."""
    if mode not in ("plan", "verify"):
        raise GateError(f"unknown mode {mode!r}")
    rep = Report(emit)
    expect = dict(expect or {})
    population = population or EXPECTED_POPULATION
    rejected = REJECTED_IDENTITIES if rejected is None else rejected
    bridges: dict[str, str] = prepared["bridges"]
    withheld = child.get("withheld") or []
    withheld_urls = {w["player_url"]: w["reason"] for w in withheld}
    summary: dict[str, Any] = {"tool": TOOL, "tool_version": TOOL_VERSION, "mode": mode,
                               "target_database": required_database,
                               "child_sha256": child_sha256, "stage_a_label": label,
                               "expect": expect}

    rep.section(f"1. {mode}: inputs")
    rep.check("1.1 child sha256 pinned", True, child_sha256[:16])
    rep.check("1.2 bridges[] loads through the importer's load_bridge",
              len(bridges) == len(child.get("bridges") or []))
    rep.check("1.3 no withheld person appears in bridges[]", not (set(withheld_urls) & set(bridges)))
    rep.check("1.4 neither rejected identity appears in bridges[] or the parent",
              not (set(rejected.values()) & (set(bridges.values()) | set(parent_map.values()))))
    rep.check("1.5 every rejected person is withheld different_person_wrong_href",
              all(withheld_urls.get(u) == "different_person_wrong_href" for u in rejected))
    tnr = sorted(u for u, r in withheld_urls.items() if r in ("target_not_registered", "target_ambiguous"))
    rep.check("1.6 every target_not_registered person has its identity in the parent",
              all(u in parent_map for u in tnr), str([u for u in tnr if u not in parent_map][:3]))
    summary["counts"] = {"bridges": len(bridges), "withheld": len(withheld),
                         "withheld_by_reason": {r: sum(1 for w in withheld if w["reason"] == r)
                                                for r in sorted(set(withheld_urls.values()))},
                         "persons_in_snapshot": len(prepared["persons"]),
                         "picks_in_snapshot": len(prepared["picks"])}

    def body(cur: SelectOnlyCursor, settings: dict) -> dict:
        rep.section("2. read-only connection")
        rep.check("2.1 server confirms transaction_read_only=on and default_transaction_read_only=on",
                  settings["transaction_read_only"] == "on"
                  and settings["default_transaction_read_only"] == "on")
        rep.check(f"2.2 current_database() is {required_database}",
                  settings["current_database"] == required_database)
        rep.check("2.3 session TimeZone is UTC (digest stability)", settings["timezone"] == "UTC",
                  str(settings["timezone"]))
        return read_target(cur, rep)

    try:
        target = with_read_only(conn_factory, body, required_database)
    except imp.ImportFailure as exc:
        rep.check("2.4 the target's live decisions are consistent (read_live_decisions)", False, str(exc))
        return _finish(summary, rep, emit)
    rep.check("2.4 the target's live decisions are consistent (read_live_decisions)", True)

    rep.section("3. target state")
    stored_persons, stored_picks = target["persons"], target["picks"]
    rep.check(f"3.1 draftguru draft_persons population is {population['persons']}",
              len(stored_persons) == population["persons"], str(len(stored_persons)))
    rep.check(f"3.2 draftguru draft_picks population is {population['picks']}",
              len(stored_picks) == population["picks"], str(len(stored_picks)))
    rep.check("3.3 no duplicate draftguru person url or pick key stored",
              not target["duplicate_urls"] and not target["duplicate_pick_keys"])
    rep.check("3.4 every stored draftguru pick carries its person's player_id",
              all(p["player_id"] == stored_persons.get(p["player_url"], {}).get("player_id")
                  for p in stored_picks.values()))
    live = target["live"]
    summary["live_decisions"] = len(live)
    if live:
        rep.warn(f"{len(live)} live player_link_resolutions decision(s) on draftguru picks are in "
                 "force and outrank the ledger and the bridge (importer step 1)")
    decided_in_bridge = sorted(u for u in bridges if u in prepared["ledger"] or u in live)
    expected_bridged = sorted((u for u in bridges if u not in prepared["ledger"] and u not in live),
                              key=url_key)
    summary["counts"]["decided_persons_in_bridge"] = decided_in_bridge
    summary["counts"]["expected_bridged"] = len(expected_bridged)
    summary["draft_picks_overrides_active"] = len([o for o in target["overrides"] if o["is_active"]])
    # Both batch counters come from the same read-only snapshot as every other number here
    # (read_target's BATCH_COUNT_SQL), are part of the hashed summary, and are printed because
    # verify's --expect-batches-before consumes the value the operator reads off this output.
    summary["import_batches_before"] = target["batch_count"]
    summary["import_batches_max_id_before"] = target["batch_max_id"]
    emit(f"        import_batches_before: {target['batch_count']} "
         f"(draftguru batches now; max id {target['batch_max_id']})")
    if mode == "plan":
        summary["import_batches_expected_after"] = target["batch_count"] + 1
        emit(f"        import_batches_expected_after: {target['batch_count'] + 1} "
             "(pass import_batches_before as --expect-batches-before to verify)")

    rep.section("4. registration (importer HALT conditions and child staleness)")
    findings = registration_findings(bridges, target["afl_players"])
    rep.check("4.1 every bridge target is registered exactly once (else the importer HALTs)",
              not findings["bridge_unregistered"] and not findings["bridge_ambiguous"],
              f"unregistered {findings['bridge_unregistered'][:5]}, "
              f"ambiguous {findings['bridge_ambiguous'][:5]}")
    now_registered = sorted(
        (u, parent_map[u], len(target["afl_players"][parent_map[u]]))
        for u in tnr if u in parent_map and len(target["afl_players"].get(parent_map[u], [])) >= 1)
    rep.check("4.2 no target_not_registered identity has since become registered (child not stale)",
              not now_registered, str(now_registered[:5]))
    rejected_reach = {}
    for url, identity in rejected.items():
        for pid in target["afl_players"].get(identity, []):
            holders = [u for u, p in stored_persons.items() if p["player_id"] == pid]
            if holders:
                rejected_reach[identity] = holders
    rep.check("4.3 no stored draftguru person reaches a rejected AFL Tables identity",
              not rejected_reach, str(rejected_reach))
    summary["registration"] = {"bridge_unregistered": findings["bridge_unregistered"],
                               "bridge_ambiguous": findings["bridge_ambiguous"],
                               "withheld_now_registered": now_registered}
    if findings["bridge_unregistered"] or findings["bridge_ambiguous"]:
        return _finish(summary, rep, emit)

    rep.section("5. the importer's decision, replayed (apply_authority, seeding forbidden)")
    try:
        persons, stats = replay_authority(prepared, target, rep)
    except imp.ImportFailure as exc:
        seed = "--no-seed forbids" in str(exc)
        rep.check("5.1 apply_authority completes without a HALT", False,
                  ("seed_required: " if seed else "") + str(exc))
        return _finish(summary, rep, emit)
    rep.check("5.1 apply_authority completes without a HALT", True)
    rep.check("5.2 no live decision overrides the tracked ledger", stats["live_override"] == 0,
              str(stats["live_override"]))
    rep.check("5.3 authority: bridge + decided persons in the bridge == bridges.length",
              stats["bridge"] + len(decided_in_bridge) == len(bridges),
              f"bridge {stats['bridge']} + decided {len(decided_in_bridge)} vs {len(bridges)}")
    rep.check("5.4 authority: ledger == the tracked ledger's decision count (+ live decisions)",
              stats["ledger"] == len(set(prepared["ledger"]) | set(live)), str(stats["ledger"]))
    rep.check("5.5 nothing would be seeded", stats["seeded"] == 0)
    summary["authority"] = dict(stats)

    expected_persons = expected_person_rows(persons, target["source_id"])
    expected_picks = expected_pick_rows(prepared, persons, target)
    summary["source_override_patches_applied"] = apply_source_overrides(expected_picks, target)
    expected_ids = expected_identity_rows(persons, label)
    linked_ids: dict[int, list] = {}
    for url, r in expected_persons.items():
        if r["player_id"] is not None:
            linked_ids.setdefault(r["player_id"], []).append(url)
    dup_targets = {pid: urls for pid, urls in linked_ids.items() if len(urls) > 1}
    rep.check("5.6 no canonical player is claimed by two DraftGuru persons after the import",
              not dup_targets, str(list(dup_targets.items())[:3]))
    vocab_bad = [(u, r["link_status"], r["match_method"]) for u, r in expected_persons.items()
                 if (r["link_status"], r["match_method"], r["player_id"] is not None)
                 not in ALLOWED_PERSON_STATES]
    rep.check("5.7 every expected person state is in the allowed vocabulary", not vocab_bad,
              str(vocab_bad[:3]))
    rep.check("5.8 both rejected persons compute to unlinked",
              all(expected_persons.get(u, {}).get("player_id") is None for u in rejected))
    rep.check("5.9 every withheld person computes to unlinked-by-bridge",
              all(expected_persons[u]["match_method"] != imp.BRIDGE_MATCH_METHOD
                  for u in withheld_urls if u in expected_persons))

    rep.section("6. classification: stored vs expected")
    pc = classify_persons(stored_persons, expected_persons)
    kc = classify_picks(stored_picks, expected_picks)
    ic = classify_identities(target["identities"], expected_ids)
    mf = target["manual_findings"]
    summary["persons"] = {k: len(v) for k, v in pc.items()}
    summary["picks"] = {k: len(v) for k, v in kc.items()}
    summary["identities"] = {k: len(v) for k, v in ic.items()}
    summary["manual_picks"] = {"active_manual_overrides": mf["active_manual_overrides"],
                               "missing": len(mf["manual_rows_missing"]),
                               "mismatched": len(mf["manual_rows_mismatched"]),
                               "unresolvable": len(mf["manual_unresolvable"])}
    for group, classes in (("persons", pc), ("picks", kc), ("identities", ic)):
        for name, items in classes.items():
            emit(f"        {group}.{name}: {len(items)}")

    rep.check("6.1 no person missing from or extra to the target",
              not pc["missing"] and not pc["extra"],
              f"missing {pc['missing'][:3]}, extra {pc['extra'][:3]}")
    rep.check("6.2 no pick missing from or extra to the target",
              not kc["missing"] and not kc["extra"],
              f"missing {kc['missing'][:3]}, extra {kc['extra'][:3]}")
    rep.check("6.3 no conflicting link change (dropped / relinked / metadata / unexpected)",
              not pc["link_dropped"] and not pc["relinked"] and not pc["link_metadata_change"]
              and not pc["unexpected_link_change"],
              f"dropped {pc['link_dropped'][:3]}, relinked {pc['relinked'][:3]}, "
              f"metadata {pc['link_metadata_change'][:3]}, unexpected {pc['unexpected_link_change'][:3]}")
    rep.check("6.4 no non-link person column would change", not pc["nonlink_change"],
              str(pc["nonlink_change"][:3]))
    rep.check("6.5 dg_person_id is not permuted", not pc["dg_person_id_permutation"],
              str(len(pc["dg_person_id_permutation"])))
    rep.check("6.6 no non-link pick column would change (after active source-owned overrides)",
              not kc["nonlink_change"], str(kc["nonlink_change"][:3]))
    rep.check("6.7 external_identities(draftguru): no missing/extra row, no change outside link columns",
              not ic["missing"] and not ic["extra"] and not ic["other_change"],
              f"missing {ic['missing'][:3]}, extra {ic['extra'][:3]}, other {ic['other_change'][:3]}")
    rep.check("6.8 external_identities link changes are exactly the newly linked persons",
              set(ic["link_change"]) == set(pc["newly_linked"]),
              f"{len(ic['link_change'])} vs {len(pc['newly_linked'])}")
    pick_change_persons = {k[0] for k in kc["link_change"]}
    rep.check("6.9 pick link changes belong exactly to the newly linked persons",
              pick_change_persons == set(pc["newly_linked"]),
              f"{len(pick_change_persons)} persons vs {len(pc['newly_linked'])}")
    rep.check("6.10 no active manual selection would be re-created or rewritten",
              not mf["manual_rows_missing"] and not mf["manual_rows_mismatched"]
              and not mf["manual_unresolvable"], str(mf))
    rep.check("6.11 newly linked + already bridge-linked == every non-decided bridge person",
              set(pc["newly_linked"]) | set(pc["already_agreeing_linked_bridge"]) == set(expected_bridged),
              f"{len(pc['newly_linked'])} + {len(pc['already_agreeing_linked_bridge'])} vs {len(expected_bridged)}")

    rep.section("7. hashes and totals")
    # plan hashes the PREDICTED post-import state; verify hashes the OBSERVED stored state.
    # The two must agree, which is what the --expect-* comparisons in section 8 assert.
    if mode == "plan":
        after_rows = after_state_rows(expected_persons)
        picks_rows = picks_after_rows(expected_picks)
        newly = newly_linked_rows(expected_bridged, expected_persons, bridges)
    else:
        after_rows = after_state_rows(stored_persons)
        picks_rows = picks_after_rows(stored_picks)
        observed_bridged = [u for u, p in stored_persons.items()
                            if p["match_method"] == imp.BRIDGE_MATCH_METHOD]
        newly = newly_linked_rows(observed_bridged, stored_persons, bridges)
    changes = [[u, list(link_view(stored_persons[u])), list(link_view(expected_persons[u]))]
               for u in sorted(pc["newly_linked"] + pc["link_dropped"] + pc["relinked"]
                               + pc["link_metadata_change"] + pc["unexpected_link_change"], key=url_key)]
    summary["after_state_sha256"] = sha256_canonical(after_rows)
    summary["picks_after_sha256"] = sha256_canonical(picks_rows)
    summary["newly_linked_sha256"] = sha256_canonical(newly)
    summary["changes_sha256"] = sha256_canonical(changes)
    summary["changes"] = len(changes)
    summary["baseline"] = target["baseline"]
    summary["baseline_sha256"] = sha256_canonical(target["baseline"])
    summary["totals_after"] = totals(expected_persons, expected_picks)
    for key in ("after_state_sha256", "picks_after_sha256", "newly_linked_sha256", "changes_sha256",
                "baseline_sha256"):
        emit(f"        {key}: {summary[key]}")
    emit(f"        changes (persons whose link state differs now vs after): {len(changes)}")
    emit(f"        totals_after: {json.dumps(summary['totals_after'], sort_keys=True)}")
    emit(f"        baseline: {json.dumps(target['baseline'], sort_keys=True)}")
    if print_manifest:
        emit(f"        bridge-linked manifest, {'predicted' if mode == 'plan' else 'observed'} "
             "(player_url | afltables_external_id | player_id):")
        for url, identity, pid in newly:
            emit(f"          {url} | {identity} | {pid}")

    if mode == "plan":
        rep.section("8. plan verdict")
        rep.check("8.1 the only change is newly linked persons (and their picks / identity rows)",
                  set(u for u, _, _ in changes) == set(pc["newly_linked"]))
        emit(f"        import_batches_before: {summary['import_batches_before']}")
        emit(f"        import_batches_expected_after: {summary['import_batches_expected_after']}")
    else:
        rep.section("8. post-import verification")
        rep.check("8.1 every person's link state equals the importer's expected state (0 changes)",
                  not changes, f"{len(changes)} differing person(s)")
        rep.check("8.2 every pick's link state equals its person's expected state",
                  not kc["link_change"], str(len(kc["link_change"])))
        rep.check("8.3 external_identities(draftguru) equals the expected rows exactly",
                  not ic["link_change"], str(len(ic["link_change"])))
        bridged_ok = [u for u in expected_bridged
                      if stored_persons.get(u, {}).get("player_id")
                      == (target["afl_players"].get(bridges[u]) or [None])[0]
                      and stored_persons[u]["link_status"] == "unique"
                      and stored_persons[u]["match_method"] == imp.BRIDGE_MATCH_METHOD
                      and stored_persons[u]["confidence_notes"]
                      == f"draftguru person-page bridge -> {bridges[u]}"]
        rep.check("8.4 each admitted bridge resolves to the intended player with the bridge provenance",
                  len(bridged_ok) == len(expected_bridged), f"{len(bridged_ok)} of {len(expected_bridged)}")
        stored_bridge_set = {u for u, p in stored_persons.items()
                             if p["match_method"] == imp.BRIDGE_MATCH_METHOD}
        rep.check("8.5 the persons carrying the bridge match_method are exactly the admitted, "
                  "non-decided bridges", stored_bridge_set == set(expected_bridged),
                  f"{len(stored_bridge_set)} vs {len(expected_bridged)}")
        withheld_ok = all(
            stored_persons.get(u, {}).get("match_method") != imp.BRIDGE_MATCH_METHOD
            and (u in prepared["ledger"] or u in live
                 or (stored_persons.get(u, {}).get("player_id") is None
                     and stored_persons.get(u, {}).get("link_status") == "unmatched"))
            for u in withheld_urls)
        rep.check(f"8.6 all {len(withheld_urls)} withheld persons remain unlinked by this bridge",
                  withheld_ok)
        rep.check("8.7 Craig Somerville and David Sullivan did not re-enter",
                  all(stored_persons.get(u, {}).get("player_id") is None for u in rejected)
                  and not rejected_reach)
        stored_linked: dict[int, list] = {}
        for u, p in stored_persons.items():
            if p["player_id"] is not None:
                stored_linked.setdefault(p["player_id"], []).append(u)
        rep.check("8.8 no duplicate DraftGuru person and no canonical player claimed twice",
                  not target["duplicate_urls"] and all(len(v) == 1 for v in stored_linked.values())
                  and len(target["identities"]) == len(stored_persons))
        stored_vocab_bad = [(u, p["link_status"], p["match_method"]) for u, p in stored_persons.items()
                            if (p["link_status"], p["match_method"], p["player_id"] is not None)
                            not in ALLOWED_PERSON_STATES]
        rep.check("8.9 stored link_status / match_method values are in the allowed vocabulary",
                  not stored_vocab_bad, str(stored_vocab_bad[:3]))
        batches = target["batches"]
        newest = batches[0] if batches else None
        rep.check("8.10 the newest draftguru import_batches row is a completed import_draftguru.py "
                  f"run over {population['picks']} records with no error",
                  bool(newest) and newest["status"] == "completed"
                  and newest["tool"] == "import_draftguru.py"
                  and newest["records_read"] == population["picks"] and newest["error"] is None
                  and newest["completed_at"] is not None, str(newest))
        rep.check("8.11 no draftguru import batch is left running",
                  not any(b["status"] == "running" for b in batches))
        rep.check("8.12 every draftguru pick carries the newest batch id",
                  bool(newest) and all(p["import_batch_id"] == newest["id"]
                                       for p in stored_picks.values()))
        if "batches_before" in expect:
            rep.check("8.13 exactly one draftguru batch was added since the plan",
                      target["batch_count"] == expect["batches_before"] + 1,
                      f"{target['batch_count']} vs {expect['batches_before']} + 1")
        for key in ("after_state_sha256", "picks_after_sha256", "newly_linked_sha256",
                    "baseline_sha256"):
            if key in expect:
                rep.check(f"8.14 {key} equals the plan's value", summary[key] == expect[key],
                          f"observed {summary[key][:16]}..., planned {str(expect[key])[:16]}...")

    return _finish(summary, rep, emit)


def _finish(summary: dict, rep: Report, emit: Callable[[str], None]) -> dict:
    summary["failures"] = list(rep.failures)
    summary["warnings"] = list(rep.warnings)
    summary["checks"] = [[n, ok] for n, ok, _ in rep.checks]
    summary["summary_sha256"] = sha256_canonical(
        {k: v for k, v in summary.items() if k != "summary_sha256"})
    emit("")
    emit(f"summary_sha256: {summary['summary_sha256']}")
    if summary["failures"]:
        emit(f"{summary['mode'].upper()}: REFUSED -- {len(summary['failures'])} check(s) failed:")
        for name in summary["failures"]:
            emit(f"  - {name}")
    else:
        emit(f"{summary['mode'].upper()}: OK -- every check held; nothing was written")
    return summary


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("mode", choices=("plan", "verify"))
    ap.add_argument("--target", choices=sorted(TARGETS), default="test",
                    help="which database this gate reads (default test = afldb_test; "
                         "dev = afldb_dev; no PROD target exists)")
    ap.add_argument("--bridge", default=None,
                    help="the target's deployment child; defaults to the pinned afldb_test "
                         "child for --target test, and is MANDATORY (no default) for any "
                         "other target")
    ap.add_argument("--parent", default=PARENT_REL, help="the v2 source-evidence parent")
    ap.add_argument("--expect-child-sha256", default=None,
                    help="defaults to the pinned afldb_test child hash for --target test; "
                         "no default for any other target (no DEV child is pinned yet)")
    ap.add_argument("--expect-parent-sha256", default=EXPECTED_PARENT_SHA256)
    ap.add_argument("--label", default=imp.STAGE_A_LABEL)
    ap.add_argument("--snapshot-root", default=None)
    ap.add_argument("--print-manifest", action="store_true",
                    help="print every bridge-linked (player_url, identity, player_id) row to stdout")
    ap.add_argument("--expect-after-sha256")
    ap.add_argument("--expect-picks-after-sha256")
    ap.add_argument("--expect-newly-linked-sha256")
    ap.add_argument("--expect-baseline-sha256")
    ap.add_argument("--expect-batches-before", type=int)
    args = ap.parse_args(argv)
    cfg = TARGETS[args.target]

    print(f"AFLDB DraftGuru bridge import gate -- {args.mode} (read-only, {cfg['database']} "
          f"only) [target={args.target}]")
    if args.bridge is None:
        if cfg["child_rel"] is None:
            print(f"\nERROR: --bridge is required for --target {args.target} "
                  f"(no default {cfg['database']} child exists; the afldb_test child must "
                  "never be reused against it)")
            return EXIT_ERROR
        args.bridge = cfg["child_rel"]
    if args.expect_child_sha256 is None:
        args.expect_child_sha256 = cfg["expected_child_sha256"]

    try:
        from common import load_env
        load_env()
        dsn = resolve_dsn(args.target)
        child_path = Path(args.bridge)
        if not child_path.is_absolute():
            child_path = REPO_ROOT / child_path
        if args.target != "test":
            test_default_child = (REPO_ROOT / CHILD_REL).resolve()
            if child_path.resolve() == test_default_child:
                raise GateError(f"REFUSED: --bridge for --target {args.target} must not be "
                                "the afldb_test child")
        parent_path = Path(args.parent)
        if not parent_path.is_absolute():
            parent_path = REPO_ROOT / parent_path
        child, child_sha = load_child(child_path, args.expect_child_sha256,
                                      cfg["expected_child_counts"], required_database=cfg["database"])
        parent_map = load_parent_map(parent_path, child, args.expect_parent_sha256)
        prepared = imp.validate(SimpleNamespace(label=args.label, snapshot_root=args.snapshot_root,
                                                bridge=str(child_path)))
    except (GateError, imp.ImportFailure, imp.parser_mod.ParseFailure) as exc:
        print(f"\nERROR: {exc}")
        return EXIT_ERROR
    print(f"  snapshot : {args.label} ({prepared['year_count']} year pages, sha256 verified)")
    print(f"  child    : {child_path.relative_to(REPO_ROOT).as_posix()} {child_sha[:16]}...")
    print(f"  parent   : {parent_path.relative_to(REPO_ROOT).as_posix()} (parent_sha256 chain verified)")
    expect = {k: v for k, v in (
        ("after_state_sha256", args.expect_after_sha256),
        ("picks_after_sha256", args.expect_picks_after_sha256),
        ("newly_linked_sha256", args.expect_newly_linked_sha256),
        ("baseline_sha256", args.expect_baseline_sha256),
        ("batches_before", args.expect_batches_before)) if v is not None}
    try:
        summary = run_gate(args.mode, prepared, child, child_sha, parent_map, args.label,
                           lambda: open_read_only(dsn), expect=expect,
                           print_manifest=args.print_manifest, required_database=cfg["database"])
    except GateError as exc:
        print(f"\nERROR: {exc}")
        return EXIT_ERROR
    return EXIT_REFUSED if summary["failures"] else EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
