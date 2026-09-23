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
    is refused outright if it is the ``afldb_test`` child by resolved path, by the tracked
    ``.afldb_test.json`` naming convention or by its pinned bytes under any other name, so a DEV
    run can never silently verify the test child instead; the child's own ``target`` field is
    also checked -- against the target specification's ``child_target`` LABEL, never against the
    physical database name -- so an ``afldb_test``-labelled child is refused under ``--target
    dev`` even if some other path pointed at it. The label and the database name are separate
    fields because the exporter's own vocabulary (``export_person_bridge.TARGET_DSN_ENV``) is
    asymmetric: ``--resolve-against afldb_test`` stamps ``target: "afldb_test"`` while
    ``--resolve-against dev`` stamps ``target: "dev"`` on a child for the ``afldb_dev``
    database. Only the ``test`` specification says the two are identical;
  * the connection is opened with ``default_transaction_read_only=on`` and ``TimeZone=UTC``,
    marked read-only and REPEATABLE READ, and the server's ``transaction_read_only`` and
    ``default_transaction_read_only`` are both asserted ``on`` before any other statement;
  * every statement passes through a cursor wrapper that refuses anything but ``SELECT``;
  * the transaction is rolled back and the connection closed unconditionally;
  * nothing is written to disk -- no artefact, no checkpoint, no log file;
  * the DSN and credentials are never printed; connection errors are reported by class only;
  * every guard above runs, and fails closed, before any target data is read.

``--link-only`` (AFLDB-ISSUE-222 Phase 4b, 2026-09-19)
-------------------------------------------------------
Models the importer's ``--link-only`` write set instead of a full reload, for a target whose
accepted Stage A snapshot bytes no longer exist anywhere (``afldb_dev``: loaded from
``annual-html-20260902``, whose Rails-rendered pages carry a per-render CSRF token and cannot
be re-acquired). ``--label`` becomes mandatory and explicit, and the gate proves it against
every stored ``external_identities(draftguru).notes`` value rather than trusting it.

    python tools/rebuild/draftguru/bridge_import_gate.py plan --target dev --link-only \\
        --label annual-html-20260902 \\
        --bridge data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json

No Stage A page, manifest or parsed artefact is opened. Checks 6.4, 6.6 and 6.7 are PROVEN, not
skipped: the write-set half reads the SET clause of the importer's own three UPDATE statements
back through ``import_draftguru.set_clause_columns`` and requires it to be exactly the link
columns and disjoint from the non-link ones; the value half requires the modelled after-state
to differ from the stored rows in nothing else; and ``verify``'s 8.15 re-reads four server-side
digests covering every non-link column -- including ``import_batch_id``, which the full reload
rewrites on all 6,810 picks and this mode must not -- and requires them to equal the plan's.
Every target, database and child-target guard is unchanged and still runs first. The full path
is untouched: its check list, its hashes and its ``baseline_sha256`` are byte-identical to
before this mode existed, because every addition is inside ``if link_only``.

Exit status: 0 = every check held (plan: proceed / verify: import proven); 1 = refused (a check
failed -- fail closed); 2 = the gate could not run (structural error, including an unknown
``--target``, a missing DSN, a missing mandatory ``--bridge``, or ``--link-only`` without an
explicit ``--label``). Two runs over the same state with the same arguments and target print
the same ``summary_sha256``.
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

# The deployment-target LABEL a child artefact carries in its own ``target`` field. This is the
# exporter's ``--resolve-against`` value (``export_person_bridge.TARGET_DSN_ENV`` key), NOT the
# physical database name, and the two are deliberately not the same vocabulary: the accepted
# ``afldb_test`` child carries ``"afldb_test"`` (which happens to equal its database name) while
# the accepted ``afldb_dev`` child carries ``"dev"``. Comparing a child's ``target`` with a
# database name is therefore only ever correct where a target specification says the two are
# identical, which is why they are separate fields in TARGETS below. These literals are pinned
# against the exporter's own source by tests/python/draftguru_import_gate_contract.py and match
# validate_person_bridge_child.TEST_TARGET_LABEL / DEV_TARGET_LABEL exactly.
TEST_CHILD_TARGET = "afldb_test"
DEV_CHILD_TARGET = "dev"

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

# ``database`` is the physical PostgreSQL database this target connects to and asserts through
# ``current_database()``; ``child_target`` is the LABEL the target's deployment child must carry
# in its own ``target`` field. They are separate fields on purpose (see TEST_CHILD_TARGET above):
# they coincide for ``test`` and differ for ``dev``, and nothing in this tool may assume either.
TARGETS: dict[str, dict[str, Any]] = {
    "test": {
        "database": REQUIRED_DATABASE, "child_target": TEST_CHILD_TARGET, "dsn_env": DSN_ENV,
        "child_rel": CHILD_REL, "expected_child_sha256": EXPECTED_CHILD_SHA256,
        "expected_child_counts": EXPECTED_CHILD_COUNTS,
    },
    "dev": {
        # No default child, no pinned hash, no pinned counts: a DEV deployment child is a live
        # per-target registration measurement, so --bridge and (optionally)
        # --expect-child-sha256 are supplied explicitly on every run.
        "database": DEV_DATABASE, "child_target": DEV_CHILD_TARGET, "dsn_env": DEV_DSN_ENV,
        "child_rel": None, "expected_child_sha256": None, "expected_child_counts": None,
    },
}

# A DENY rule only, mirroring validate_person_bridge_child.refuse_test_child_under_dev: the
# tracked naming convention of the afldb_test child. A filename never grants trust here, it can
# only lose it.
TEST_CHILD_SUFFIX = ".afldb_test.json"

# ``LINEAGES`` (AFLDB-ISSUE-227): lineage is a property of the ARTEFACT PAIR -- a source-evidence
# parent and its resolved deployment child -- deliberately NOT a target. Which database a run
# reads (TARGETS) and which artefact vintage it reads (LINEAGES) are orthogonal; TARGETS must
# never grow a lineage-shaped key, and a lineage is never a --target choice. "v2" stays
# DEFAULT_LINEAGE, so an invocation with no --lineage resolves to exactly the same parent/child
# pair every pre-existing invocation has always used: the v2 child is re-exported by reference
# into a pinned Phase F evidence chain (AFLDB-ISSUE-222 Phase 4a/4b) that a silent default bump
# would invalidate. The "v2" entry below is built BY REFERENCE to the pre-existing module
# constants above (never retyped), so the two representations can never drift apart.
V3_PARENT_REL = "data/reference/draftguru-person-bridge-20260918-v3.json"
V3_EXPECTED_PARENT_SHA256 = "1f7413a2ad96e7d026cc521acfdeba3de9cab7066794de99002c9b5928e6e21b"
V3_CHILD_REL = "data/reference/draftguru-person-bridge-20260918-v3.afldb_test.json"
V3_EXPECTED_CHILD_SHA256 = "94aeac74422bea17dbb14913d480055991db4ac79546a2860383e669b5bbdac4"
V3_EXPECTED_CHILD_COUNTS = {
    "bridges": 3470, "withheld": 1587,
    "U-no-href": 1493, "target_not_registered": 92, "different_person_wrong_href": 2,
}

LINEAGES: dict[str, dict[str, Any]] = {
    "v2": {
        "parent_rel": PARENT_REL, "expected_parent_sha256": EXPECTED_PARENT_SHA256,
        "test_child_rel": CHILD_REL, "expected_test_child_sha256": EXPECTED_CHILD_SHA256,
        "expected_test_child_counts": EXPECTED_CHILD_COUNTS,
    },
    "v3": {
        "parent_rel": V3_PARENT_REL, "expected_parent_sha256": V3_EXPECTED_PARENT_SHA256,
        "test_child_rel": V3_CHILD_REL, "expected_test_child_sha256": V3_EXPECTED_CHILD_SHA256,
        "expected_test_child_counts": V3_EXPECTED_CHILD_COUNTS,
    },
}
DEFAULT_LINEAGE = "v2"


def effective_config(target: str, lineage: str) -> dict[str, Any]:
    """A NEW per-invocation config: a copy of ``TARGETS[target]`` with its parent/child fields
    substituted from ``LINEAGES[lineage]`` -- for the ``child_rel`` / ``expected_child_sha256`` /
    ``expected_child_counts`` triple, substitution applies to the ``test`` target ONLY; ``dev``
    keeps those three fields ``None`` regardless of lineage, because a DEV deployment child is
    always a live per-target measurement (see TARGETS above), never a pinned artefact.

    This returns a fresh dict on every call and never assigns into ``TARGETS``, ``CHILD_REL``,
    ``EXPECTED_CHILD_SHA256``, ``EXPECTED_CHILD_COUNTS``, ``PARENT_REL`` or
    ``EXPECTED_PARENT_SHA256`` -- so a ``--lineage v3`` invocation can never leak state into a
    later, unrelated call within the same process (the contracts call ``main()`` repeatedly in
    one process; module-level mutation here would leak v3 into every later call and into every
    contract that reads ``TARGETS`` directly). Fails closed on an unknown target or an unknown
    lineage, naming the closed set."""
    if target not in TARGETS:
        raise GateError(f"unknown --target {target!r} -- only {sorted(TARGETS)} exist (no PROD target)")
    if lineage not in LINEAGES:
        raise GateError(f"unknown --lineage {lineage!r} -- only {sorted(LINEAGES)} exist")
    cfg = dict(TARGETS[target])
    lin = LINEAGES[lineage]
    cfg["parent_rel"] = lin["parent_rel"]
    cfg["expected_parent_sha256"] = lin["expected_parent_sha256"]
    if target == "test":
        cfg["child_rel"] = lin["test_child_rel"]
        cfg["expected_child_sha256"] = lin["expected_test_child_sha256"]
        cfg["expected_child_counts"] = lin["expected_test_child_counts"]
    return cfg


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
IDENTITY_NONLINK = ("external_name", "external_url", "candidate_count", "notes")

# AFLDB-ISSUE-222 --link-only. The gate's own link vocabulary and the importer's link-only
# write set must be the SAME set, or the gate would be modelling a write the importer does not
# make (or missing one it does). Proven at import time rather than by comment, so a change to
# either side fails immediately and everywhere.
assert imp.PERSON_LINK_COLUMNS == LINK_COLUMNS
assert imp.PICK_LINK_COLUMNS == PICK_LINK
assert not set(imp.PERSON_LINK_COLUMNS) & set(PERSON_NONLINK)
assert not set(imp.PICK_LINK_COLUMNS) & set(PICK_NONLINK)
assert not set(imp.IDENTITY_LINK_COLUMNS) & set(IDENTITY_NONLINK)

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
               expect_child_target: str = TEST_CHILD_TARGET) -> tuple[dict, str]:
    """Load and pin a deployment child. ``expect_child_target`` is the target specification's
    ``child_target`` LABEL -- the exporter's own ``--resolve-against`` value -- never the
    physical database name (they differ for DEV; see TEST_CHILD_TARGET)."""
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
    if doc.get("target") != expect_child_target:
        raise GateError(f"REFUSED: the child targets {doc.get('target')!r}, not "
                        f"{expect_child_target!r} (the exporter's deployment-target label for "
                        "this --target; a child is never labelled with a database name unless "
                        "the target specification says the two are identical)")
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


def refuse_test_child_under(target: str, child_path: Path) -> None:
    """Refuse EVERY lineage's pinned ``afldb_test`` child under any non-``test`` target -- by
    resolved path, by the tracked ``.afldb_test.json`` naming convention, and by pinned bytes
    under any other name. All three are DENY rules: a name can never make a file trusted here,
    only refused, and the bytes rule is what stops a rename from laundering a test child into a
    DEV deployment child. This deliberately does NOT resolve the caller's own ``--lineage`` and
    check only that one -- it enumerates ``LINEAGES`` itself, so adding a lineage only ever ADDS
    to this DENY set and the v2 rule stays exactly as strong as it was before lineages existed.
    This runs before any DSN is read and before any connection is opened."""
    if target == "test":
        return
    if child_path.name.endswith(TEST_CHILD_SUFFIX):
        raise GateError(f"REFUSED: --bridge for --target {target} must not be the afldb_test "
                        f"child (the {TEST_CHILD_SUFFIX!r} naming convention)")
    child_bytes = child_path.read_bytes() if child_path.is_file() else None
    for lineage_name, lin in LINEAGES.items():
        pinned_rel = lin["test_child_rel"]
        pinned_sha = lin["expected_test_child_sha256"]
        try:
            same_file = child_path.resolve() == (REPO_ROOT / pinned_rel).resolve()
        except OSError:                                   # unresolvable path: treat as different
            same_file = False
        if same_file:
            raise GateError(f"REFUSED: --bridge for --target {target} must not be the afldb_test "
                            f"child (pinned lineage {lineage_name}: {pinned_rel})")
        if child_bytes is not None and sha256_bytes(child_bytes) == pinned_sha:
            raise GateError(f"REFUSED: --bridge for --target {target} must not be the afldb_test "
                            f"child -- these bytes are the pinned lineage {lineage_name} "
                            f"afldb_test child's (sha256 {pinned_sha}), whatever the file is "
                            "called")


def load_parent_map(path: Path, child: dict, expect_sha256: str | None) -> dict[str, str]:
    """player_url -> afltables_external_id from the source-evidence parent the child names."""
    if not path.is_file():
        raise GateError(f"parent dataset not found: {path.as_posix()}")
    data = path.read_bytes()
    digest = sha256_bytes(data)
    if expect_sha256 is not None and digest != expect_sha256:
        raise GateError("REFUSED: the parent dataset's sha256 is not the pinned parent hash for "
                        "this lineage")
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
                        records_updated, records_rejected, error, started_at::text,
                        completed_at::text, notes
                   FROM import_batches WHERE source_id = %s ORDER BY id DESC LIMIT 5"""
BATCH_FIELDS = ("id", "tool", "target_table", "status", "records_read", "records_inserted",
                "records_updated", "records_rejected", "error", "started_at", "completed_at",
                "notes")
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

# AFLDB-ISSUE-222 --link-only: two further server-side digests, added ONLY in that mode.
#
# They are the after-the-fact proof for checks 6.7 and 6.6 respectively. The default
# BASELINE_SQL above deliberately covers neither, and must not: the full reload rewrites
# `notes` on every identity row and `import_batch_id` on every pick, every run, so pinning them
# there would make every full-mode verify fail. Link-only writes neither, so in that mode both
# are preservation invariants. Keeping them in a separate dict is what leaves the full path's
# `baseline_sha256` bit-identical to every value already recorded against `afldb_test`.
LINK_ONLY_BASELINE_SQL: dict[str, tuple[str, tuple]] = {
    "external_identities_draftguru_nonlink": (
        "SELECT count(*), md5(coalesce(string_agg(json_build_object('id', id, "
        "'ext', external_id, 'name', external_name, 'url', external_url, "
        "'cc', candidate_count, 'notes', notes)::text, E'\\n' ORDER BY id), '')) "
        "FROM external_identities WHERE source_id = %s", ("dg",)),
    "draft_picks_draftguru_batch_ids": (
        "SELECT count(*), md5(coalesce(string_agg(json_build_object('id', id, "
        "'b', import_batch_id)::text, E'\\n' ORDER BY id), '')) "
        "FROM draft_picks WHERE source_id = %s", ("dg",)),
}

LINK_ONLY_PRESERVATION_DIGESTS = (
    "draft_persons_draftguru_nonlink", "draft_picks_draftguru_nonlink",
    "external_identities_draftguru_nonlink", "draft_picks_draftguru_batch_ids",
)


def baseline_sql_for(link_only: bool) -> dict[str, tuple[str, tuple]]:
    return {**BASELINE_SQL, **LINK_ONLY_BASELINE_SQL} if link_only else BASELINE_SQL


def read_target(cur: SelectOnlyCursor, rep: Report, link_only: bool = False) -> dict:
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
    batches = [dict(zip(BATCH_FIELDS, row)) for row in cur.fetchall()]
    cur.execute(BATCH_COUNT_SQL, (source_id,))
    batch_count, batch_max_id = cur.fetchone()

    baseline = {}
    for label, (sql, params) in baseline_sql_for(link_only).items():
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


# ---------------------------------------------------------------------------
# AFLDB-ISSUE-222 --link-only: the expected state models the link-only write set exactly
# ---------------------------------------------------------------------------
# Every non-link value below is COPIED from the stored row rather than derived from a snapshot,
# because that is precisely what the importer's link-only path does: it never names a non-link
# column in a SET clause, so the stored value is the expected value by construction. That makes
# the value-level comparisons (6.4a / 6.6a / 6.7b) a construction guard rather than the
# preservation proof; the preservation proof is the pair of write-set checks (6.4 / 6.6 / 6.7,
# read off the importer's own statements) plus the four server-side digests verify re-reads.

def stored_person_frame(target: dict) -> dict:
    """A ``prepared['persons']``-shaped frame built from the TARGET, for apply_authority."""
    return {url: {"player_url": url, "dg_person_id": row["dg_person_id"],
                  "display_name_raw": row["display_name_raw"], "name_key": row["name_key"],
                  "reported_games": row["reported_games"], "reported_goals": row["reported_goals"]}
            for url, row in target["persons"].items()}


def expected_person_rows_link_only(persons: dict, target: dict) -> dict:
    out = {}
    for url, stored in target["persons"].items():
        p = persons[url]
        row = {field: stored[field] for field in PERSON_FIELDS if field != "id"}
        row["player_id"] = p["player_id"]
        row["link_status"] = p["link_status"]
        row["match_method"] = p["match_method"]
        row["confidence_notes"] = p["confidence_notes"]
        # migration 019's draft_persons_backlog_ck, from the STORED reported_games.
        row["is_matching_backlog"] = (p["player_id"] is None
                                      and (stored["reported_games"] or 0) > 0)
        out[url] = row
    return out


def expected_pick_rows_link_only(persons: dict, target: dict) -> dict:
    out = {}
    for key, stored in target["picks"].items():
        p = persons[stored["player_url"]]
        row = {field: stored[field] for field in PICK_FIELDS if field != "id"}
        row["player_id"] = p["player_id"]
        row["link_status_value"] = p["link_status"]
        row["match_method"] = p["match_method"]
        row["confidence_notes"] = p["confidence_notes"]
        out[key] = row
    return out


def expected_identity_rows_link_only(persons: dict, target: dict) -> dict:
    out = {}
    for url, stored in target["identities"].items():
        p = persons[url]
        row = dict(stored)
        row["player_id"] = p["player_id"]
        row["status"] = p["link_status"] if p["player_id"] is not None else imp.UNLINKED_DEFAULT
        row["match_method"] = p["match_method"]
        out[url] = row
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
             required_database: str = REQUIRED_DATABASE, link_only: bool = False) -> dict:
    """Shared body of ``plan`` and ``verify``. Returns the summary (with ``failures``).
    ``required_database`` defaults to ``afldb_test``, matching every pre-existing caller that
    does not pass it; ``main()`` passes the selected target's database explicitly.

    ``link_only=False`` is the full reload the gate has always modelled; every pre-existing
    caller keeps it and its check list, hashes and ``baseline_sha256`` are unchanged.
    ``link_only=True`` models the importer's ``--link-only`` write set instead."""
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
    if link_only:
        # Only ever added in link-only, so the full path's hashed summary payload -- and
        # therefore its summary_sha256 -- is byte-identical to before this mode existed.
        summary["mode_scope"] = imp.LINK_ONLY_MODE
        summary["link_only_write_set"] = {t: list(c) for t, c in imp.link_only_write_set().items()}

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
                         # In link-only there is no snapshot frame at all; the population is
                         # the target's own, counted in section 3 and pinned by 3.1 / 3.2.
                         "persons_in_snapshot": len(prepared["persons"]) if not link_only else None,
                         "picks_in_snapshot": len(prepared["picks"]) if not link_only else None}
    if link_only:
        rep.check("1.7 link-only: accepted + withheld partition the whole population exactly",
                  len(bridges) + len(withheld) == population["persons"]
                  and not (set(withheld_urls) & set(bridges)),
                  f"{len(bridges)} + {len(withheld)} vs {population['persons']}")
        rep.check("1.8 link-only: the child names its pinned source-evidence parent",
                  bool(re.fullmatch(r"[0-9a-f]{64}", str(child.get("parent_sha256")))))

    def body(cur: SelectOnlyCursor, settings: dict) -> dict:
        rep.section("2. read-only connection")
        rep.check("2.1 server confirms transaction_read_only=on and default_transaction_read_only=on",
                  settings["transaction_read_only"] == "on"
                  and settings["default_transaction_read_only"] == "on")
        rep.check(f"2.2 current_database() is {required_database}",
                  settings["current_database"] == required_database)
        rep.check("2.3 session TimeZone is UTC (digest stability)", settings["timezone"] == "UTC",
                  str(settings["timezone"]))
        return read_target(cur, rep, link_only=link_only)

    try:
        target = with_read_only(conn_factory, body, required_database)
    except imp.ImportFailure as exc:
        rep.check("2.4 the target's live decisions are consistent (read_live_decisions)", False, str(exc))
        return _finish(summary, rep, emit)
    rep.check("2.4 the target's live decisions are consistent (read_live_decisions)", True)

    if link_only:
        # The population IS the frame in this mode. Built here, after the read, because the
        # importer builds it from exactly the same rows at exactly the same point.
        prepared = dict(prepared)
        prepared["persons"] = stored_person_frame(target)

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

    if link_only:
        expected_persons = expected_person_rows_link_only(persons, target)
        expected_picks = expected_pick_rows_link_only(persons, target)
        # The link-only importer does not call replay_admin_overrides at all, so no
        # source-owned override is re-applied and no manual selection is re-created. 6.10
        # below still checks that the target's manual state is coherent; this records that
        # this mode patches nothing.
        summary["source_override_patches_applied"] = 0
        expected_ids = expected_identity_rows_link_only(persons, target)
    else:
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
    if link_only:
        # 6.4 / 6.6 / 6.7 are PROVEN here, not skipped, and they are proven twice over:
        #   * the write-set half reads the SET clause of the importer's own three statements
        #     back through imp.set_clause_columns() and requires it to be exactly the link
        #     columns and disjoint from the non-link ones -- so no non-link column CAN move;
        #   * the value half (6.4a / 6.6a / 6.7b) requires the modelled after-state to differ
        #     from the stored rows in nothing but those columns;
        #   * and verify's 8.15 re-reads four server-side digests over every non-link column
        #     (including import_batch_id, which the full reload rewrites and this mode must
        #     not) and requires them to equal the plan's.
        write_set = imp.link_only_write_set()
        rep.check("6.4 link-only: the draft_persons write set is exactly the person link columns "
                  "and disjoint from every non-link column",
                  write_set["draft_persons"] == LINK_COLUMNS
                  and not set(write_set["draft_persons"]) & set(PERSON_NONLINK),
                  str(write_set["draft_persons"]))
        rep.check("6.4a link-only: no non-link person column differs from the stored row",
                  not pc["nonlink_change"], str(pc["nonlink_change"][:3]))
        rep.check("6.5 dg_person_id is not permuted", not pc["dg_person_id_permutation"],
                  str(len(pc["dg_person_id_permutation"])))
        rep.check("6.6 link-only: the draft_picks write set is exactly the pick link columns, "
                  "disjoint from every non-link column, and never names import_batch_id",
                  write_set["draft_picks"] == PICK_LINK
                  and not set(write_set["draft_picks"]) & set(PICK_NONLINK)
                  and "import_batch_id" not in write_set["draft_picks"],
                  str(write_set["draft_picks"]))
        rep.check("6.6a link-only: no non-link pick column differs from the stored row",
                  not kc["nonlink_change"], str(kc["nonlink_change"][:3]))
        rep.check("6.7 link-only: the external_identities write set is exactly "
                  "(player_id, status, match_method) and never names notes",
                  write_set["external_identities"] == imp.IDENTITY_LINK_COLUMNS
                  and not set(write_set["external_identities"]) & set(IDENTITY_NONLINK),
                  str(write_set["external_identities"]))
        expected_notes = f"{imp.IDENTITY_NOTES_PREFIX}{label}"
        wrong_notes = sorted({str(r["notes"]) for r in target["identities"].values()
                              if r["notes"] != expected_notes})
        summary["identity_notes_label"] = expected_notes
        summary["identity_notes_mismatches"] = len(
            [1 for r in target["identities"].values() if r["notes"] != expected_notes])
        rep.check(f"6.7a link-only: all {len(target['identities'])} stored identity notes are "
                  f"exactly {expected_notes!r} (the label this run asserts)",
                  not wrong_notes and len(target["identities"]) == len(stored_persons),
                  f"{summary['identity_notes_mismatches']} mismatched, e.g. {wrong_notes[:2]}")
        rep.check("6.7b link-only: no identity row is missing, extra or changed outside the "
                  "link columns", not ic["missing"] and not ic["extra"] and not ic["other_change"],
                  f"missing {ic['missing'][:3]}, extra {ic['extra'][:3]}, "
                  f"other {ic['other_change'][:3]}")
    else:
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
        common_batch_ok = (bool(newest) and newest["status"] == "completed"
                           and newest["tool"] == "import_draftguru.py"
                           and newest["records_read"] == population["picks"]
                           and newest["error"] is None and newest["completed_at"] is not None)
        if link_only:
            expected_notes_prefix = f"mode={imp.LINK_ONLY_MODE} {imp.IDENTITY_NOTES_PREFIX}{label}"
            notes = str((newest or {}).get("notes") or "")
            rep.check("8.10 link-only: the newest draftguru import_batches row is a completed "
                      f"import_draftguru.py run over {population['picks']} records with no error, "
                      "and its notes declare mode=link_only and the asserted label",
                      common_batch_ok and notes.startswith(expected_notes_prefix)
                      and f"bridge_sha256={child_sha256}" in notes,
                      str({k: (newest or {}).get(k) for k in ("id", "status", "records_read",
                                                              "error", "notes")}))
            link_only_batches = [b for b in batches
                                 if str(b.get("notes") or "").startswith(f"mode={imp.LINK_ONLY_MODE}")
                                 and b["status"] == "completed"]
            rep.check("8.10a link-only: exactly one completed link-only batch is present among "
                      "the newest draftguru batches, and it is the newest",
                      len(link_only_batches) == 1 and bool(newest)
                      and link_only_batches[0]["id"] == newest["id"],
                      str([(b["id"], b["status"]) for b in link_only_batches]))
        else:
            rep.check("8.10 the newest draftguru import_batches row is a completed import_draftguru.py "
                      f"run over {population['picks']} records with no error",
                      common_batch_ok, str(newest))
        rep.check("8.11 no draftguru import batch is left running",
                  not any(b["status"] == "running" for b in batches))
        if link_only:
            # The exact inverse of the full path's 8.12: link-only never names import_batch_id,
            # so every pick must still carry whatever batch loaded it. Proven by value here and
            # by the pinned digest in 8.15.
            rep.check("8.12 link-only: no draftguru pick was re-stamped with the new batch id "
                      "(import_batch_id is not in the write set)",
                      bool(newest) and not any(p["import_batch_id"] == newest["id"]
                                               for p in stored_picks.values()),
                      str(sorted({p["import_batch_id"] for p in stored_picks.values()})[:5]))
        else:
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
        if link_only:
            missing_digests = [k for k in LINK_ONLY_PRESERVATION_DIGESTS
                               if k not in target["baseline"]]
            rep.check("8.15 link-only: all four non-link preservation digests were read, and the "
                      "baseline they belong to reproduces the plan's baseline_sha256 -- 6.4, 6.6 "
                      "and 6.7 proven after the fact, server-side, over every non-link column",
                      not missing_digests and "baseline_sha256" in expect
                      and summary["baseline_sha256"] == expect["baseline_sha256"],
                      f"missing {missing_digests}, "
                      f"baseline pinned: {'baseline_sha256' in expect}")

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
    ap.add_argument("--lineage", choices=sorted(LINEAGES), default=DEFAULT_LINEAGE,
                    help=f"which source-evidence parent/child artefact vintage to pin against "
                         f"(default {DEFAULT_LINEAGE}); orthogonal to --target -- it is never a "
                         "target choice and TARGETS is never extended with one")
    ap.add_argument("--bridge", default=None,
                    help="the target's deployment child; defaults to the pinned afldb_test "
                         "child for --target test, and is MANDATORY (no default) for any "
                         "other target")
    ap.add_argument("--parent", default=None,
                    help="the source-evidence parent (defaults to the selected --lineage's "
                         "pinned parent)")
    ap.add_argument("--expect-child-sha256", default=None,
                    help="defaults to the pinned afldb_test child hash for --target test; "
                         "no default for any other target (no DEV child is pinned yet)")
    ap.add_argument("--expect-parent-sha256", default=None)
    # Default None then substituted, exactly as the importer does: the effective default is
    # unchanged, and --link-only additionally learns whether the operator stated the label.
    ap.add_argument("--label", default=None,
                    help=f"Stage A snapshot label (default {imp.STAGE_A_LABEL}; mandatory and "
                         "explicit under --link-only, where it is checked against every stored "
                         "external_identities(draftguru).notes value)")
    ap.add_argument("--link-only", action="store_true",
                    help="model the importer's --link-only write set instead of a full reload: "
                         "no Stage A snapshot is opened, and the non-link state is proven "
                         "preserved rather than re-derived. Requires an explicit --label.")
    ap.add_argument("--snapshot-root", default=None)
    ap.add_argument("--print-manifest", action="store_true",
                    help="print every bridge-linked (player_url, identity, player_id) row to stdout")
    ap.add_argument("--expect-after-sha256")
    ap.add_argument("--expect-picks-after-sha256")
    ap.add_argument("--expect-newly-linked-sha256")
    ap.add_argument("--expect-baseline-sha256")
    ap.add_argument("--expect-batches-before", type=int)
    args = ap.parse_args(argv)
    # A NEW per-invocation dict every call (see effective_config): --lineage never mutates
    # TARGETS or any module constant, so a --lineage v3 call cannot leak into a later,
    # unrelated call within the same process.
    cfg = effective_config(args.target, args.lineage)
    if args.parent is None:
        args.parent = cfg["parent_rel"]
    if args.expect_parent_sha256 is None:
        args.expect_parent_sha256 = cfg["expected_parent_sha256"]
    label_explicit = args.label is not None
    if args.label is None:
        args.label = imp.STAGE_A_LABEL

    scope = " --link-only" if args.link_only else ""
    print(f"AFLDB DraftGuru bridge import gate -- {args.mode}{scope} (read-only, "
          f"{cfg['database']} only) [target={args.target}]")
    if args.lineage != DEFAULT_LINEAGE:
        # Stdout only, never hashed: keeping this behind the non-default branch means a
        # --lineage v2 (or omitted --lineage) run's stdout is byte-identical to before
        # lineages existed.
        print(f"  lineage  : {args.lineage}")
    if args.link_only and not label_explicit:
        print("\nERROR: --link-only requires an explicit --label: the mode proves the label "
              "against every stored external_identities(draftguru).notes value, and a default "
              "is not an assertion")
        return EXIT_ERROR
    if args.link_only and args.snapshot_root is not None:
        print("\nERROR: --link-only reads no Stage A snapshot, so --snapshot-root cannot apply")
        return EXIT_ERROR
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
        refuse_test_child_under(args.target, child_path)
        parent_path = Path(args.parent)
        if not parent_path.is_absolute():
            parent_path = REPO_ROOT / parent_path
        child, child_sha = load_child(child_path, args.expect_child_sha256,
                                      cfg["expected_child_counts"],
                                      expect_child_target=cfg["child_target"])
        parent_map = load_parent_map(parent_path, child, args.expect_parent_sha256)
        if args.link_only:
            prepared = imp.validate_link_only(
                SimpleNamespace(label=args.label, snapshot_root=None, bridge=str(child_path)))
        else:
            prepared = imp.validate(SimpleNamespace(label=args.label,
                                                    snapshot_root=args.snapshot_root,
                                                    bridge=str(child_path)))
    except (GateError, imp.ImportFailure, imp.parser_mod.ParseFailure) as exc:
        print(f"\nERROR: {exc}")
        return EXIT_ERROR
    if args.link_only:
        print(f"  snapshot : {args.label} (ASSERTED against the target's stored identity notes; "
              "no Stage A page, manifest or parsed artefact opened)")
        for table, columns in imp.link_only_write_set().items():
            print(f"  write set: {table} -> {', '.join(columns)}")
    else:
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
                           print_manifest=args.print_manifest, required_database=cfg["database"],
                           link_only=args.link_only)
    except GateError as exc:
        print(f"\nERROR: {exc}")
        return EXIT_ERROR
    return EXIT_REFUSED if summary["failures"] else EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
