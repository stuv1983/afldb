#!/usr/bin/env python3
"""AFLDB-ISSUE-228 Stage S5 -- fail-closed loader for the afl_api player-
identity bootstrap bridge (runbook Sec 6.3, Sec 17).

Reads the evidence artefact ``build_afl_api_player_bridge.py`` produces
(``data/reference/afl-api-player-bridge-<date>.json``) and turns its
``linked`` rows into durable ``external_identities`` rows on ``afldb_test``.

AFLDB-ISSUE-235 (2026-09-23): this loader is no longer the ONLY writer of
``external_identities`` for ``afl_api``. A Super Admin can now write a human
``status='resolved'``, ``match_method='afl_api_admin_adjudication'`` row
through ``/admin/player-links/afl-api`` (``src/db/queries/afl-api-player-links.ts``).
The two writers never race for real ownership of one row: ``UNIQUE
(source_id, external_id)`` (migration 002) allows at most one row per
provider, so precedence is first-trusted-writer-wins, and THIS loader still
never UPDATEs or DELETEs a row belonging to EITHER writer -- that contract,
restated below, now binds against both, not just against itself.

Every provider id is decided against the LIVE database state at the moment
this tool runs, never against the artefact's own record of what was linked
when it was built -- the artefact can go stale between a build and an
import, and idempotency/contradiction detection would be wrong if it
trusted a snapshot instead of re-reading the target.

AFLDB-ISSUE-228 S5b (2026-09-20): generalised to accept a second, distinctly
weaker evidence class alongside S5's stat-vector bootstrap --
``afl_api_name_team_season_bootstrap``, written by
``build_afl_api_brownlow_name_bridge.py``. The two classes are never
conflated: each artefact declares its own ``match_method`` (checked against
``ALLOWED_MATCH_METHODS``, not a single hardcoded constant), and the value
actually written to ``external_identities.match_method`` is the artefact's
own declared method, never a hardcoded one -- so a name+team+season row can
never be mistaken in the database for an exact stat-vector row. Every other
contract below (idempotency, contradiction handling, dry-run/apply,
read-only validate) is unchanged and applies identically to both classes.

AFLDB-ISSUE-228 Sec 9.10 (2026-09-21): a third, distinctly narrower evidence
class, ``afl_api_manual_adjudication``, for a single explicit human decision
that neither bootstrap classifier can produce (e.g. an observed given name
that is a nickname/short form of the canonical player's, such as "Matt"
Taberner for the canonical "Matthew" Taberner -- deliberately NOT folded into
the general name normaliser). An artefact declaring this method carries its
own hand-authored evidence and, for its linked row(s), an optional
``canonical_afltables_profile_url``; the loader then requires, before any
write, that the candidate player exists AND (when the field is present) that
the declared profile URL is already that player's own trusted
``afltables_profile_url`` link in ``external_identities`` -- see
``manual_adjudication_identity_problem()``. This method is never produced by
a bulk classifier and is expected to link a small, explicit set of provider
ids, one artefact at a time.

AFLDB-ISSUE-228 S9 (2026-09-21): generalised target handling and a fourth
evidence class. ``--target`` selects the database by name from a closed list
-- ``afldb_test`` (default, unchanged read/write DSNs and behaviour) or
``dev`` (``DATABASE_URL`` for read, ``AFLDB_IMPORT_DATABASE_URL`` for write,
against ``afldb_dev``, with the live session's own ``current_user`` proven
against the expected role for that target -- ``afldb_app`` read-only,
``afldb_import`` write). There is deliberately no PROD entry anywhere in
``TARGETS``: it is a closed list, not extensible from the command line.
``--artefact`` is now MANDATORY -- there is no "newest artefact under
data/reference/" fallback, which was a hazard once more than one
``afl-api-player-bridge-*.json`` artefact could exist there (an older sample
artefact could otherwise sort after a newer full-season one and be silently
skipped). The fourth evidence class, ``afl_api_stat_vector_season``, is
resolved by ``build_afl_api_player_bridge.py``'s full-season sibling against
``afldb_dev`` read-only, and is accepted ONLY under ``--target dev`` and
ONLY with intact declared provenance (``built_from_database == "afldb_dev"``,
``read_only is True``, a numeric ``season``, a non-empty ``snapshot_label``,
a 64-lowercase-hex ``snapshot_manifest_sha256``, and
``existing_claim_comparison == "unproved_cross_database_id_parity"``) -- see
``_season_evidence_provenance_problem()``. A DEV-built artefact is refused for
``--target afldb_test``: its ``candidate_player_id`` values are resolved
against ``afldb_dev``, and cross-database numeric ``player_id`` parity has
never been proven.

AFLDB-ISSUE-228 S9 tooling gap (2026-09-23): the provenance gate is now
TARGET-BOUND (``SEASON_EVIDENCE_PROVENANCE_BY_TARGET``). ``--target
afldb_test`` accepts season evidence only when ``built_from_database ==
"afldb_test"`` and ``tool`` is the ``afldb_test``-pinned emitter
(``emit-afl-api-player-bridge-test.ts``), whose ids are read from
``afldb_test`` itself; ``--target dev`` still requires ``afldb_dev`` and the
DEV emitter. Neither target accepts the other's artefact. None of this touches write semantics: idempotency,
contradiction handling and the manual-adjudication identity check below are
unchanged and apply identically to all four classes.

Modes:
    --validate-only   Read-only. Reports what an apply WOULD do
                       (link / already_linked / would_HALT_contradiction).
                       Opens no write-role connection, writes nothing.
    --dry-run         Runs the full write path (INSERT INTO
                       external_identities, INSERT INTO data_issues) inside
                       one transaction, then unconditionally rolls back.
                       No import_batches row survives a dry run -- nothing
                       happened, so nothing is recorded as having happened.
    --apply           Same write path, tracked in one import_batches row
                       (source_key=afl_api, tool=this file), committed.

Idempotency (Sec 6.3, Sec 19.4(a); AFLDB-ISSUE-235 Sec 7.4/D4):
  * a provider id not yet in external_identities, and its candidate player
    holds no OTHER afl_api provider row -> INSERT (status=unique,
    match_method=<the artefact's own declared method>, append-only);
  * a provider id not yet in external_identities, but its candidate player
    ALREADY holds a DIFFERENT afl_api provider row -> withheld as
    "player_collision": a data_issues row is opened
    (issue_type=afl_api_identity_contradiction, details.kind=
    'player_already_linked'), reported would_HALT_player_collision. Backstop
    for AFLDB-ISSUE-235 OD-1's one-provider-per-player rule (migration 104's
    partial unique index is the final arbiter for the race this check
    cannot see);
  * a provider id already linked to the SAME player -> no-op, reported
    "already_linked" (or "already_linked (human)" when the existing row's
    status is 'resolved' -- an AFLDB-ISSUE-235 admin adjudication, never a
    bootstrap write);
  * a provider id already linked to a DIFFERENT player -> withheld, a
    data_issues row is opened (issue_type=afl_api_identity_contradiction,
    details gain existing_status/existing_match_method), the existing link
    is never modified or deleted -- whether that existing link is an
    importer 'unique' row or an AFLDB-ISSUE-235 human 'resolved' row makes
    no difference to this rule.
No row is ever UPDATEd or DELETEd by this tool, whichever writer owns it.

Usage (--artefact is mandatory; --target defaults to afldb_test):
    python tools/migration/import_afl_api_player_bridge.py --validate-only --artefact <path>
    python tools/migration/import_afl_api_player_bridge.py --dry-run --artefact <path>
    python tools/migration/import_afl_api_player_bridge.py --apply --artefact <path>
    python tools/migration/import_afl_api_player_bridge.py --target dev --validate-only --artefact <path>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402  (tools/migration/common.py)

TOOL = "tools/migration/import_afl_api_player_bridge.py"
TOOL_VERSION = "1.0.0"

REPO_ROOT = Path(__file__).resolve().parents[2]

# Closed target list (AFLDB-ISSUE-228 S9). No PROD entry exists, and none can be added from
# the command line -- ``--target`` is validated against exactly this dict's keys. ``afldb_test``
# reproduces S5/S5b/Sec 9.10 behaviour unchanged: no role assertion beyond the read-only/database
# checks already in force. ``dev`` reads with the ordinary application role (never the DEV
# evidence emitter's own AFLDB_DEV_DATABASE_URL, and never the migration schema owner) and writes
# with the importer's elevated role, proving BOTH roles live via current_user before any write
# statement is sent.
TARGETS: dict[str, dict[str, Any]] = {
    "afldb_test": {
        "database": "afldb_test",
        "read_dsn_env": "AFLDB_TEST_DATABASE_URL",
        "write_dsn_env": "AFLDB_TEST_IMPORT_DATABASE_URL",
        "read_role": None,
        "write_role": None,
    },
    "dev": {
        "database": "afldb_dev",
        "read_dsn_env": "DATABASE_URL",
        "write_dsn_env": "AFLDB_IMPORT_DATABASE_URL",
        "read_role": "afldb_app",
        "write_role": "afldb_import",
    },
}

SOURCE_KEY = "afl_api"
MATCH_METHOD = "afl_api_stat_vector_bootstrap"
NAME_TEAM_SEASON_MATCH_METHOD = "afl_api_name_team_season_bootstrap"
MANUAL_ADJUDICATION_MATCH_METHOD = "afl_api_manual_adjudication"
# The S9 full-season evidence class (build_afl_api_player_bridge.py's afldb_dev sibling). Its
# candidate_player_id values are resolved against afldb_dev, so it is accepted only under
# --target dev -- see _season_evidence_provenance_problem() and its call from load_artefact().
SEASON_EVIDENCE_MATCH_METHOD = "afl_api_stat_vector_season"
ALLOWED_MATCH_METHODS = frozenset({
    MATCH_METHOD, NAME_TEAM_SEASON_MATCH_METHOD, MANUAL_ADJUDICATION_MATCH_METHOD,
    SEASON_EVIDENCE_MATCH_METHOD,
})
CONTRADICTION_ISSUE_TYPE = "afl_api_identity_contradiction"

# afl_api_stat_vector_season provenance gate (AFLDB-ISSUE-228 S9). These are the ACCEPTANCE
# CONTRACT values, not acceptance evidence for any one artefact -- the season/label/hash of a
# particular run are read from the artefact itself and never hardcoded here.
#
# The gate is TARGET-BOUND: an artefact is accepted only by the target whose own database it was
# built from, and only when its declared `tool` is that database's pinned emitter. A DEV-built
# artefact (candidate_player_id = afldb_dev ids) is therefore still refused for --target
# afldb_test, and an afldb_test-built one is refused for --target dev -- numeric player_id parity
# between the two databases has never been proven, in either direction. The afldb_test entry is the
# S9 tooling-gap remediation (2026-09-23): emit-afl-api-player-bridge-test.ts, pinned to afldb_test.
SEASON_EVIDENCE_PROVENANCE_BY_TARGET: dict[str, dict[str, str]] = {
    "dev": {
        "built_from_database": "afldb_dev",
        "tool": "tools/current-season/emit-afl-api-player-bridge.ts",
    },
    "afldb_test": {
        "built_from_database": "afldb_test",
        "tool": "tools/current-season/emit-afl-api-player-bridge-test.ts",
    },
}
SEASON_EVIDENCE_REQUIRED_CLAIM_COMPARISON = "unproved_cross_database_id_parity"
_SHA256_HEX_RE = re.compile(r"^[0-9a-f]{64}$")

# AFLDB-ISSUE-228 Sec 9.10: a single explicit, human-adjudicated CD_I -> player_id
# decision, evidenced by non-Brownlow repository sources (never by canonical
# brownlow_round_votes/brownlow_season_votes). Unlike the two bootstrap methods
# above, this is not produced by a deterministic classifier; it is authored
# directly into its own artefact by an operator-reviewed pass. The loader
# treats it exactly like the other methods for idempotency/contradiction
# purposes, plus one extra pre-write check (below): the candidate player must
# exist, and if the artefact declares the canonical AFL Tables profile
# identity it relied on, that identity must already be this player's own
# trusted afltables_profile_url link -- never guessed, never silently
# accepted on disagreement.
AFLTABLES_SOURCE_KEY = "afltables"
AFLTABLES_PROFILE_MATCH_METHOD = "afltables_profile_url"


class ImportRefused(RuntimeError):
    """Refused before any statement was sent -- nothing has been written."""


def _resolve_dsn(env_name: str, required_database: str) -> str:
    dsn = os.environ.get(env_name)
    if not dsn:
        raise ImportRefused(f"{env_name} is not set -- refusing")
    dsn = dsn.strip()
    parsed = urlparse(dsn)
    if parsed.scheme not in ("postgresql", "postgres"):
        raise ImportRefused(f"{env_name} is not a postgresql:// DSN")
    if parsed.path.lstrip("/") != required_database:
        raise ImportRefused(f"{env_name} does not target /{required_database} -- refusing")
    return dsn


def open_read_only(target: str) -> psycopg.Connection:
    cfg = TARGETS[target]
    dsn = _resolve_dsn(cfg["read_dsn_env"], cfg["database"])
    conn = psycopg.connect(
        dsn, options="-c default_transaction_read_only=on -c TimeZone=UTC",
        application_name="afldb-import-afl-api-player-bridge-validate",
    )
    with conn.cursor() as cur:
        cur.execute(
            "SELECT current_setting('transaction_read_only'), current_database(), current_user"
        )
        txn_ro, database, current_user = cur.fetchone()
    if txn_ro != "on" or database != cfg["database"]:
        conn.close()
        raise ImportRefused(
            f"REFUSED: connection is not a read-only session against {cfg['database']}"
        )
    if cfg["read_role"] is not None and current_user != cfg["read_role"]:
        conn.close()
        raise ImportRefused(
            f"REFUSED: --target {target} requires current_user={cfg['read_role']!r}, "
            f"got {current_user!r}"
        )
    return conn


def open_write(target: str, app_name: str) -> psycopg.Connection:
    cfg = TARGETS[target]
    dsn = _resolve_dsn(cfg["write_dsn_env"], cfg["database"])
    conn = psycopg.connect(dsn, application_name=app_name)
    with conn.cursor() as cur:
        cur.execute("SELECT current_database(), current_user")
        database, current_user = cur.fetchone()
    if database != cfg["database"]:
        conn.close()
        raise ImportRefused(f"REFUSED: connection is not against {cfg['database']}")
    if cfg["write_role"] is not None and current_user != cfg["write_role"]:
        conn.close()
        raise ImportRefused(
            f"REFUSED: --target {target} requires current_user={cfg['write_role']!r}, "
            f"got {current_user!r}"
        )
    return conn


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _season_evidence_provenance_problem(artefact: dict, target: str) -> str | None:
    """Read-only, DB-free provenance gate for SEASON_EVIDENCE_MATCH_METHOD (AFLDB-ISSUE-228 S9).

    Returns None when the artefact's declared provenance is acceptable, else a human-readable
    refusal reason. Every check is against the artefact's OWN declared fields -- never a live
    database query, so this runs before any connection is opened. Malformed or missing
    provenance is a refusal, never a best-effort pass.
    """
    required = SEASON_EVIDENCE_PROVENANCE_BY_TARGET.get(target)
    if required is None:
        return f"match_method={SEASON_EVIDENCE_MATCH_METHOD!r} has no provenance rule for --target {target!r}"
    if artefact.get("built_from_database") != required["built_from_database"]:
        return (
            f"built_from_database is {artefact.get('built_from_database')!r}, but --target {target!r} "
            f"accepts only evidence built from {required['built_from_database']!r} -- its "
            "candidate_player_id values must be ids of the target database itself; cross-database "
            "numeric player_id parity has never been proven"
        )
    if artefact.get("tool") != required["tool"]:
        return (
            f"tool is {artefact.get('tool')!r}, but --target {target!r} accepts only evidence "
            f"emitted by {required['tool']!r}"
        )
    if artefact.get("read_only") is not True:
        return f"read_only is {artefact.get('read_only')!r}, expected exactly true"
    season = artefact.get("season")
    if isinstance(season, bool) or not isinstance(season, (int, float)):
        return f"season is {season!r}, expected a numeric value"
    snapshot_label = artefact.get("snapshot_label")
    if not isinstance(snapshot_label, str) or not snapshot_label:
        return f"snapshot_label is {snapshot_label!r}, expected a non-empty string"
    snapshot_sha = artefact.get("snapshot_manifest_sha256")
    if not isinstance(snapshot_sha, str) or not _SHA256_HEX_RE.match(snapshot_sha):
        return (
            f"snapshot_manifest_sha256 is {snapshot_sha!r}, expected exactly 64 lowercase hex "
            "characters"
        )
    if artefact.get("existing_claim_comparison") != SEASON_EVIDENCE_REQUIRED_CLAIM_COMPARISON:
        return (
            f"existing_claim_comparison is {artefact.get('existing_claim_comparison')!r}, "
            f"expected {SEASON_EVIDENCE_REQUIRED_CLAIM_COMPARISON!r}"
        )
    return None


def load_artefact(path: Path, target: str) -> dict:
    if not path.exists():
        raise ImportRefused(f"artefact not found: {path}")
    artefact = json.loads(path.read_text(encoding="utf-8"))
    if artefact.get("source_key") != SOURCE_KEY:
        raise ImportRefused(f"{path}: source_key is {artefact.get('source_key')!r}, expected {SOURCE_KEY!r}")
    match_method = artefact.get("match_method")
    if match_method not in ALLOWED_MATCH_METHODS:
        raise ImportRefused(
            f"{path}: match_method is {match_method!r}, "
            f"expected one of {sorted(ALLOWED_MATCH_METHODS)!r}"
        )
    if match_method == SEASON_EVIDENCE_MATCH_METHOD:
        problem = _season_evidence_provenance_problem(artefact, target)
        if problem is not None:
            raise ImportRefused(
                f"{path}: {SEASON_EVIDENCE_MATCH_METHOD} evidence refused -- {problem}"
            )
    for entry in artefact.get("inputs", []):
        file_path = REPO_ROOT / entry["file"]
        if not file_path.exists():
            raise ImportRefused(f"{path}: pinned input missing on disk: {entry['file']}")
        actual = sha256_file(file_path)
        if actual != entry["sha256"]:
            raise ImportRefused(
                f"{path}: pinned input changed on disk since the artefact was built: "
                f"{entry['file']} (expected {entry['sha256']}, got {actual})"
            )
    return artefact


@dataclass
class RunStats:
    linked: int = 0
    already_linked: int = 0
    # AFLDB-ISSUE-235: the same no-op, but the existing row is a human
    # admin adjudication (status='resolved'), not an importer bootstrap
    # write. Counted separately so a report can distinguish the two
    # without reinterpreting `already_linked`.
    already_linked_human: int = 0
    contradictions: list[str] = field(default_factory=list)
    # AFLDB-ISSUE-235 D4/D6-4: the candidate player already holds a
    # DIFFERENT afl_api provider row. Withheld like a contradiction, but
    # distinct because no row exists yet for THIS provider id.
    player_collisions: list[str] = field(default_factory=list)
    skipped_not_linked: int = 0


def linked_rows(artefact: dict) -> dict[str, dict]:
    return {
        external_id: row
        for external_id, row in artefact.get("providers", {}).items()
        if row.get("disposition") == "linked"
    }


def fetch_source_id(cur) -> int:
    cur.execute("SELECT id FROM sources WHERE key = %s", (SOURCE_KEY,))
    row = cur.fetchone()
    if row is None:
        raise ImportRefused(f"unknown source key: {SOURCE_KEY!r}")
    return row[0]


def classify_existing(cur, source_id: int, external_id: str, candidate_player_id: int):
    """Classify (source_id, external_id) against the live external_identities row, if any.

    Returns (status, existing_id, existing_status, existing_match_method). status is
    'would_link' (existing_id/status/match_method all None -- no row for this provider id
    yet), 'already_linked' or 'contradiction'. AFLDB-ISSUE-235 D4/D8: the existing row's
    status/match_method travel with the classification so a caller can report
    "already_linked (human)" vs "already_linked", and so a contradiction finding can name
    existing_status/existing_match_method -- distinguishing a human AFLDB-ISSUE-235
    adjudication from an importer bootstrap write is display/evidence only. Neither writer
    is ever overwritten or deleted here.
    """
    cur.execute(
        "SELECT id, player_id, status, match_method FROM external_identities "
        "WHERE source_id = %s AND external_id = %s",
        (source_id, external_id),
    )
    row = cur.fetchone()
    if row is None:
        return ("would_link", None, None, None)
    existing_id, existing_player_id, existing_status, existing_match_method = row
    if existing_player_id == candidate_player_id:
        return ("already_linked", existing_id, existing_status, existing_match_method)
    return ("contradiction", existing_id, existing_status, existing_match_method)


def find_player_collision(cur, source_id: int, candidate_player_id: int):
    """AFLDB-ISSUE-235 D4/D6-4 backstop. Called only when classify_existing() has already
    returned 'would_link' for THIS provider id (an existing row for the SAME provider id is
    already_linked/contradiction, handled there, never here).

    Does candidate_player_id already hold a DIFFERENT afl_api provider row, under any
    status/match_method, importer or human alike? Returns (existing_id, existing_external_id,
    existing_status, existing_match_method), or None. Migration 104's partial unique index
    (one afl_api row per player) is the final arbiter for the race this read cannot see --
    this check exists so the loader can withhold with a clear finding instead of aborting the
    whole batch on a bare 23505.
    """
    cur.execute(
        "SELECT id, external_id, status, match_method FROM external_identities "
        "WHERE source_id = %s AND player_id = %s",
        (source_id, candidate_player_id),
    )
    return cur.fetchone()


def manual_adjudication_identity_problem(cur, candidate_player_id: int,
                                          canonical_afltables_profile_url: str | None) -> str | None:
    """Read-only pre-write check for MANUAL_ADJUDICATION_MATCH_METHOD rows only.

    Returns None when the row is safe to write, else a human-readable refusal
    reason. Never guesses: a declared profile URL that does not already
    resolve, in external_identities, to exactly this candidate_player_id is a
    refusal, not a best-effort match.
    """
    cur.execute("SELECT 1 FROM players WHERE id = %s", (candidate_player_id,))
    if cur.fetchone() is None:
        return f"candidate player_id={candidate_player_id} does not exist in players"

    if not canonical_afltables_profile_url:
        return None

    cur.execute(
        """SELECT ei.player_id FROM external_identities ei
             JOIN sources s ON s.id = ei.source_id
            WHERE s.key = %s AND ei.match_method = %s AND ei.external_id = %s""",
        (AFLTABLES_SOURCE_KEY, AFLTABLES_PROFILE_MATCH_METHOD, canonical_afltables_profile_url),
    )
    found = cur.fetchone()
    if found is None:
        return (
            f"declared canonical_afltables_profile_url={canonical_afltables_profile_url!r} has no "
            f"trusted {AFLTABLES_PROFILE_MATCH_METHOD!r} external_identities row"
        )
    if found[0] != candidate_player_id:
        return (
            f"declared canonical_afltables_profile_url={canonical_afltables_profile_url!r} resolves to "
            f"player_id={found[0]}, not the candidate player_id={candidate_player_id}"
        )
    return None


def apply_rows(cur, source_id: int, to_link: dict[str, dict], rep: "Reporter",
                batch: "common.ImportBatch | None", match_method: str) -> RunStats:
    stats = RunStats()
    for external_id in sorted(to_link):
        row = to_link[external_id]
        candidate_player_id = row["candidate_player_id"]

        if match_method == MANUAL_ADJUDICATION_MATCH_METHOD:
            problem = manual_adjudication_identity_problem(
                cur, candidate_player_id, row.get("canonical_afltables_profile_url"),
            )
            if problem is not None:
                raise ImportRefused(f"{external_id}: manual adjudication refused -- {problem}")

        status, existing_id, existing_status, existing_match_method = classify_existing(
            cur, source_id, external_id, candidate_player_id,
        )

        if status == "already_linked":
            # AFLDB-ISSUE-235 D1/D4 T11: a status='resolved' row is a human admin
            # adjudication, never a bootstrap write -- report it distinctly, but it is
            # exactly as much a no-op as an importer 'unique' agreement.
            if existing_status == "resolved":
                stats.already_linked_human += 1
                rep.step(f"{external_id}: already_linked (human)")
            else:
                stats.already_linked += 1
            continue

        if status == "contradiction":
            cur.execute(
                """INSERT INTO data_issues
                     (entity_type, entity_id, issue_type, severity, description, details)
                   VALUES ('external_identities', %s, %s, 'warning', %s, %s)""",
                (
                    existing_id,
                    CONTRADICTION_ISSUE_TYPE,
                    f"afl_api provider player {external_id} bootstrap evidence proposes "
                    f"player_id={candidate_player_id}, but external_identities.id={existing_id} "
                    "already links this provider id to a different player_id. Withheld; the "
                    "existing link was not modified.",
                    json.dumps({
                        "source_key": SOURCE_KEY,
                        "external_id": external_id,
                        "proposed_player_id": candidate_player_id,
                        # AFLDB-ISSUE-235 D4/D8: lets a reader tell an importer 'unique'
                        # disagreement from a human 'resolved' one without a second query.
                        "existing_status": existing_status,
                        "existing_match_method": existing_match_method,
                        "evidence_summary": row.get("evidence_summary"),
                    }),
                ),
            )
            stats.contradictions.append(external_id)
            if batch is not None:
                batch.reject(external_id, CONTRADICTION_ISSUE_TYPE, row)
            rep.warn(
                f"{external_id}: HALTed on contradiction against external_identities.id={existing_id} "
                f"(existing status={existing_status}, match_method={existing_match_method})"
            )
            continue

        # status == "would_link": the provider id itself is free. AFLDB-ISSUE-235 D4/D6-4 --
        # before inserting, check whether the CANDIDATE PLAYER already holds a different
        # afl_api provider row (importer or human). Migration 104's partial unique index is
        # the final arbiter for the race this read cannot see; this check lets a genuine
        # collision be withheld with a clear finding instead of aborting the whole batch on
        # a bare 23505.
        collision = find_player_collision(cur, source_id, candidate_player_id)
        if collision is not None:
            collision_id, collision_external_id, collision_status, collision_match_method = collision
            cur.execute(
                """INSERT INTO data_issues
                     (entity_type, entity_id, issue_type, severity, description, details)
                   VALUES ('external_identities', %s, %s, 'warning', %s, %s)""",
                (
                    collision_id,
                    CONTRADICTION_ISSUE_TYPE,
                    f"afl_api provider player {external_id} evidence proposes linking to "
                    f"player_id={candidate_player_id}, but that player already holds afl_api "
                    f"provider {collision_external_id} (external_identities.id={collision_id}). "
                    "Withheld; the existing link was not modified.",
                    json.dumps({
                        "kind": "player_already_linked",
                        "source_key": SOURCE_KEY,
                        "external_id": external_id,
                        "proposed_player_id": candidate_player_id,
                        "existing_external_id": collision_external_id,
                        "existing_status": collision_status,
                        "existing_match_method": collision_match_method,
                        "evidence_summary": row.get("evidence_summary"),
                    }),
                ),
            )
            stats.player_collisions.append(external_id)
            if batch is not None:
                batch.reject(external_id, CONTRADICTION_ISSUE_TYPE, row)
            rep.warn(
                f"{external_id}: HALTed on player_collision -- player_id={candidate_player_id} "
                f"already linked to afl_api provider {collision_external_id} "
                f"(existing status={collision_status}, match_method={collision_match_method})"
            )
            continue

        cur.execute(
            """INSERT INTO external_identities
                 (source_id, external_id, external_name, player_id, status,
                  candidate_count, match_method, notes)
               VALUES (%s, %s, %s, %s, 'unique', 1, %s, %s)""",
            (
                source_id, external_id, row.get("observed_name"), candidate_player_id,
                match_method, row.get("evidence_summary"),
            ),
        )
        stats.linked += 1
        if batch is not None:
            batch.records_inserted += 1

    return stats


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


def run_validate_only(artefact: dict, rep: Reporter, target: str) -> int:
    to_link = linked_rows(artefact)
    match_method = artefact.get("match_method")
    rep.step(f"artefact declares {len(to_link)} 'linked' provider id(s)")
    conn = open_read_only(target)
    try:
        with conn.cursor() as cur:
            source_id = fetch_source_id(cur)
            counts = {
                "would_link": 0, "already_linked": 0, "already_linked_human": 0,
                "would_HALT_contradiction": 0, "would_HALT_player_collision": 0,
                "would_HALT_identity_check_failed": 0,
            }
            for external_id, row in sorted(to_link.items()):
                if match_method == MANUAL_ADJUDICATION_MATCH_METHOD:
                    problem = manual_adjudication_identity_problem(
                        cur, row["candidate_player_id"], row.get("canonical_afltables_profile_url"),
                    )
                    if problem is not None:
                        counts["would_HALT_identity_check_failed"] += 1
                        rep.warn(f"{external_id}: would_HALT_identity_check_failed -- {problem}")
                        continue

                status, existing_id, existing_status, existing_match_method = classify_existing(
                    cur, source_id, external_id, row["candidate_player_id"],
                )

                if status == "would_link":
                    collision = find_player_collision(cur, source_id, row["candidate_player_id"])
                    if collision is not None:
                        collision_id, collision_external_id, collision_status, collision_match_method = collision
                        counts["would_HALT_player_collision"] += 1
                        rep.warn(
                            f"{external_id}: candidate player_id={row['candidate_player_id']} already "
                            f"holds afl_api provider {collision_external_id} "
                            f"(external_identities.id={collision_id}, status={collision_status}, "
                            f"match_method={collision_match_method}) -- withheld"
                        )
                        continue
                    counts["would_link"] += 1
                    continue

                if status == "already_linked":
                    # AFLDB-ISSUE-235 D1: a status='resolved' row is a human admin
                    # adjudication, counted and reported distinctly from an importer
                    # 'unique' agreement.
                    counts["already_linked_human" if existing_status == "resolved" else "already_linked"] += 1
                    continue

                # status == "contradiction"
                counts["would_HALT_contradiction"] += 1
                rep.warn(
                    f"{external_id}: existing external_identities.id={existing_id} "
                    f"(status={existing_status}, match_method={existing_match_method}) links a "
                    f"DIFFERENT player than the artefact's candidate {row['candidate_player_id']}"
                )
        conn.rollback()
    finally:
        conn.close()
    for label, count in counts.items():
        rep.result(label, count)
    return 0


def run_write(artefact: dict, rep: Reporter, mode: str, target: str) -> int:
    to_link = linked_rows(artefact)
    match_method = artefact["match_method"]
    rep.step(f"artefact declares {len(to_link)} 'linked' provider id(s), match_method={match_method!r}")
    conn = open_write(target, app_name=f"afldb-import-afl-api-player-bridge-{mode}")
    try:
        if mode == "apply":
            with common.import_batch(conn, SOURCE_KEY, TOOL, target_table="external_identities",
                                      notes=f"apply match_method={match_method}") as batch:
                with conn.cursor() as cur:
                    source_id = fetch_source_id(cur)
                    stats = apply_rows(cur, source_id, to_link, rep, batch, match_method)
                    batch.records_read = len(to_link)
        else:  # dry-run: never commits, never creates an import_batches row
            with conn.cursor() as cur:
                source_id = fetch_source_id(cur)
                stats = apply_rows(cur, source_id, to_link, rep, None, match_method)
            conn.rollback()
    finally:
        conn.close()

    rep.result("linked", stats.linked)
    rep.result("already_linked", stats.already_linked)
    rep.result("already_linked_human", stats.already_linked_human)
    rep.result("contradictions_withheld", len(stats.contradictions))
    rep.result("player_collisions_withheld", len(stats.player_collisions))
    if stats.contradictions:
        rep.step("contradictory provider ids: " + ", ".join(stats.contradictions))
    if stats.player_collisions:
        rep.step("player-collision provider ids: " + ", ".join(stats.player_collisions))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--validate-only", action="store_true")
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--apply", action="store_true")
    parser.add_argument("--target", choices=sorted(TARGETS), default="afldb_test",
                        help="database target: afldb_test (default) or dev -- no PROD target "
                             "exists and none can be added from the command line")
    parser.add_argument("--artefact", type=Path, required=True,
                        help="Path to the afl-api-player-bridge-*.json artefact (mandatory -- "
                             "there is no default/newest-file selection)")
    args = parser.parse_args(argv)

    common.load_env()
    rep = Reporter()
    try:
        rep.step(f"loading artefact {args.artefact} (target={args.target})")
        artefact = load_artefact(args.artefact, args.target)

        if args.validate_only:
            return run_validate_only(artefact, rep, args.target)
        if args.dry_run:
            return run_write(artefact, rep, "dry-run", args.target)
        return run_write(artefact, rep, "apply", args.target)
    except ImportRefused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
