#!/usr/bin/env python3
"""AFLDB-ISSUE-222 Stage B3 bridge export (revised runbook §4.5, §5 Phase 1 item 4).

Three offline/read-only modes, corresponding to the three artefacts of §4.5 and §3.5:

  --source-evidence     offline, over the accepted Stage B3 profiling output
                         (parsed/person_profile.jsonl). Applies every admissibility flag
                         (contract person_stage.b3.admissibility_flags), refuses a
                         collision (one AFL Tables identity claimed by two DraftGuru
                         persons) unless --acknowledge-bridge-collisions, and writes the
                         ONE immutable source-evidence parent bridge dataset.

  --resolve-against T    read-only, bounded, rolled-back registration export against
                         target T (one of "afldb_test", "dev"), filtering the parent's
                         bridges[] down to identities registered EXACTLY ONCE on that
                         target. Writes the per-target deployment dataset.

  --review-sample P      offline, over a bridge dataset P. Emits the §3.5 census stratum
                         (every bridged national top-10 person, exhaustive) and a salted
                         random stratum of the remaining bridged persons, unreviewed.

Both dataset files (parent and deployment) use the importer's existing load_bridge()
schema (schema_version 1, bridges[]) so import_draftguru.py needs no change; the extra
keys (withheld, provenance, parent_sha256, target_registration) are additive and are
ignored by load_bridge().  Every output self-validates against a local reimplementation
of load_bridge()'s own schema check before being written.

Zero writes to any database, ever.  --resolve-against opens exactly one
read-only, rolled-back transaction and never any other database operation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

TOOL_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOL_DIR))
import parse_draft_snapshot as snapshot_parser  # noqa: E402
import stage_b1_sample as b1                     # noqa: E402  (sha256_hex, dump_bytes, atomic_write_bytes)
# import_draftguru.py is deliberately NOT imported here (see self_validate_bridge_schema's
# docstring below): this exporter must never carry a database-import surface transitively,
# even though import_draftguru itself only imports psycopg inside its write-phase functions
# today. AFLDB-ISSUE-222 Phase 3 correction (§B) instead DUPLICATES the two identity
# constants that must stay byte-identical to import_draftguru.py's own
# AFLTABLES_SOURCE_KEY / AFLTABLES_MATCH_METHOD; a source-text test in
# tests/draftguru-acquisition.test.ts pins both files' literals equal so the two tools
# cannot silently diverge again.

REPO_ROOT = TOOL_DIR.parents[2]

EXPORTER = "tools/rebuild/draftguru/export_person_bridge.py"
EXPORTER_VERSION = "1.0.0"
BRIDGE_SCHEMA_VERSION = 1

AFLTABLES_PATH_RE = re.compile(r"^players/[A-Za-z]/[^/]+\.html$")

# Must equal import_draftguru.py's AFLTABLES_SOURCE_KEY / AFLTABLES_MATCH_METHOD exactly
# (§B above; pinned equal by test).
AFLTABLES_SOURCE_KEY = "afltables"
AFLTABLES_MATCH_METHOD = "afltables_profile_url"

# target -> (env var carrying an owner-role DSN, required database name in its path).
# AFLDB_TEST_DATABASE_URL is itself the owner-role DSN for afldb_test (docs/deployment.md
# §9/§14) -- there is no separate "test owner" variable. "prod" is deliberately absent: no
# reviewed read-only DSN path has been established for this tool yet (the revised runbook
# does not prescribe one for Phase 1/3); attempting it is a refusal, not a guess.
TARGET_DSN_ENV = {
    "afldb_test": ("AFLDB_TEST_DATABASE_URL", "afldb_test"),
    "dev": ("AFLDB_OWNER_DATABASE_URL", "afldb_dev"),
}


class BridgeExportError(Exception):
    """A Stage B3 bridge-export contract violation.  Always fails closed."""


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json(path: Path, what: str) -> dict:
    if not path.is_file():
        raise BridgeExportError(f"missing {what}: {path}")
    return json.loads(path.read_bytes().decode("utf-8"))


def load_contract_and_b3() -> tuple[dict, dict]:
    contract = snapshot_parser.load_contract()
    b3 = contract.get("person_stage", {}).get("b3")
    if b3 is None:
        raise BridgeExportError(
            "the contract carries no person_stage.b3 block yet -- the bridge exporter "
            "requires the reviewed contract block (revised runbook §2.2) before it can run")
    return contract, b3


def canonical_url_regex(contract: dict) -> re.Pattern:
    return re.compile(contract["canonical_player_url"]["regex"])


# ---------------------------------------------------------------------------
# load_bridge() schema self-check -- a local, dependency-free reimplementation of
# import_draftguru.py's own schema gate (deliberately NOT imported: that module has a
# database-import surface this offline exporter must never carry transitively). Every
# output this tool writes is re-read through this check before it is written to disk.
# ---------------------------------------------------------------------------

def self_validate_bridge_schema(doc: dict, url_re: re.Pattern) -> None:
    if doc.get("schema_version") != BRIDGE_SCHEMA_VERSION:
        raise BridgeExportError("bridge document does not carry schema_version 1")
    claimed_urls: set[str] = set()
    claimed_identities: set[str] = set()
    for entry in doc.get("bridges", []):
        url = entry["player_url"]
        identity = entry["afltables_external_id"]
        if not url_re.match(url):
            raise BridgeExportError(f"bridge entry is not keyed on a canonical player_url: {url!r}")
        if not AFLTABLES_PATH_RE.match(identity):
            raise BridgeExportError(f"bridge entry names a non-canonical AFL Tables identity: {identity!r}")
        if url in claimed_urls:
            raise BridgeExportError(f"bridge dataset binds {url!r} to multiple AFL Tables identities")
        if identity in claimed_identities:
            raise BridgeExportError(
                f"bridge dataset binds AFL Tables identity {identity!r} to multiple DraftGuru "
                "persons -- self-validation refuses exactly what load_bridge() refuses")
        claimed_urls.add(url)
        claimed_identities.add(identity)


def write_dataset(path: Path, payload: dict, url_re: re.Pattern) -> str:
    self_validate_bridge_schema(payload, url_re)
    data = b1.dump_bytes(payload)
    b1.atomic_write_bytes(path, data)
    readback = path.read_bytes()
    if readback != data:
        raise BridgeExportError(f"{path} readback does not match the bytes written")
    self_validate_bridge_schema(json.loads(readback.decode("utf-8")), url_re)
    return b1.sha256_hex(data)


# ---------------------------------------------------------------------------
# --source-evidence
# ---------------------------------------------------------------------------

def admissibility_reason(record: dict) -> str | None:
    """One §3.3 outcome-code-shaped reason, or None when the person IS admissible
    (B-linked candidate). Mirrors contract person_stage.b3.admissibility_flags exactly.

    AFLDB-ISSUE-222 Phase 3 correction (§C.5): the contract's `canonical_required` is
    "afltables_identity is non-null AND distinct_afltables_identity_count == 1" -- both
    conjuncts, not the first alone. A record with a non-null afltables_identity but a
    distinct_afltables_identity_count other than 1 is not admissible and must fall through
    to the ordinary flag-based reasons below (multiple_afltables_candidates first, since
    that is what such a record almost always means). On the real captured
    person_profile.jsonl the two conditions never diverge (measured 2026-09-18: 3,564
    records with afltables_identity all carry count == 1), so this closes a latent gap
    without changing the accepted parent bridge's contents.
    """
    if record.get("terminal_classification") == "failed":
        return "U-page-failed"
    flags = record.get("flags") or {}
    if flags.get("missing_or_dead_page"):
        return "U-page-failed"
    if record.get("afltables_identity") and record.get("distinct_afltables_identity_count") == 1:
        return None
    if flags.get("multiple_afltables_candidates"):
        return "U-inadmissible:multiple_afltables_candidates"
    if record.get("afltables_identity") and record.get("distinct_afltables_identity_count") != 1:
        # afltables_identity is non-null but the count conjunct failed and no explicit flag
        # named why (an upstream acquisition invariant this exporter does not control) --
        # still fails closed as the ambiguous-candidate case, never as U-no-href.
        return "U-inadmissible:multiple_afltables_candidates"
    if flags.get("malformed_afltables_link"):
        return "U-inadmissible:malformed_afltables_link"
    if flags.get("non_reducing_host"):
        return "U-inadmissible:non_reducing_host"
    if flags.get("self_link_disagreement"):
        return "U-inadmissible:self_link_disagreement"
    if flags.get("parse_error"):
        return "U-inadmissible:parse_error"
    return "U-no-href"


def load_person_profile(profile_path: Path) -> list[dict]:
    if not profile_path.is_file():
        raise BridgeExportError(f"missing Stage B3 profiling output: {profile_path}")
    records = []
    for line in profile_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        records.append(json.loads(line))
    return records


def build_source_evidence(contract: dict, *, label: str, snapshot_root: Path | None,
                          manifest_dir: Path | None,
                          acknowledge_collisions: bool) -> dict:
    url_re = canonical_url_regex(contract)
    root = snapshot_root or (REPO_ROOT / contract["snapshot"]["root"])
    person_dir = (root / label).resolve()
    profile_path = person_dir / "parsed" / "person_profile.jsonl"

    m_dir = manifest_dir or (REPO_ROOT / contract["person_stage"]["person_snapshot"]["manifest_dir"])
    manifest_path = (m_dir / f"{label}.json").resolve()
    manifest = load_json(manifest_path, "Stage B3 acquisition manifest")
    if manifest.get("snapshot_label") != label:
        raise BridgeExportError(
            f"manifest snapshot_label {manifest.get('snapshot_label')!r} does not match "
            f"the requested label {label!r}")
    if manifest.get("stage") != "B3":
        raise BridgeExportError(
            f"manifest declares stage {manifest.get('stage')!r}, expected 'B3' -- the "
            "source-evidence bridge is derived from a Stage B3 population run only")

    profile_bytes = profile_path.read_bytes() if profile_path.is_file() else None
    if profile_bytes is None:
        raise BridgeExportError(f"missing Stage B3 profiling output: {profile_path}")
    expected_sha = manifest.get("parsed_outputs", {}).get("person_profile", {}).get("sha256")
    observed_sha = b1.sha256_hex(profile_bytes)
    if expected_sha and observed_sha != expected_sha:
        raise BridgeExportError(
            f"parsed/person_profile.jsonl sha256 {observed_sha} does not match the tracked "
            f"manifest's recorded {expected_sha} -- refusing to derive a dataset from "
            "unverified profiling output")

    records = load_person_profile(profile_path)
    if not records:
        raise BridgeExportError(f"{profile_path} carries no records")

    candidates: dict[str, dict] = {}   # player_url -> {"identity": ..., "record": ...}
    withheld: list[dict] = []
    for record in records:
        url = record["player_url"]
        reason = admissibility_reason(record)
        if reason is None:
            candidates[url] = record["afltables_identity"]
        else:
            withheld.append({"player_url": url, "reason": reason})

    # Collision detection: one AFL Tables identity claimed by >1 DraftGuru person.
    by_identity: dict[str, list[str]] = {}
    for url, identity in candidates.items():
        by_identity.setdefault(identity, []).append(url)
    collisions = {identity: sorted(urls) for identity, urls in by_identity.items() if len(urls) > 1}

    if collisions and not acknowledge_collisions:
        lines = "; ".join(f"{identity} <- {urls}" for identity, urls in sorted(collisions.items()))
        raise BridgeExportError(
            f"{len(collisions)} AFL Tables identity(ies) are each claimed by more than one "
            f"DraftGuru person -- a finding, never an instruction to merge: {lines}. Pass "
            "--acknowledge-bridge-collisions to withhold both sides on every acknowledged run.")

    colliding_urls = {url for urls in collisions.values() for url in urls}
    bridges = []
    for url, identity in sorted(candidates.items()):
        if url in colliding_urls:
            others = sorted(u for u in by_identity[identity] if u != url)
            withheld.append({
                "player_url": url,
                "reason": f"collision:{','.join(others)}",
            })
            continue
        bridges.append({"player_url": url, "afltables_external_id": identity})

    withheld.sort(key=lambda w: w["player_url"])

    payload = {
        "$comment": "AFLDB-ISSUE-222 Stage B3 SOURCE-EVIDENCE bridge (revised runbook §4.5). "
                    "Immutable per version, database-independent -- every admissible "
                    "(player_url, afltables_external_id) pair from the accepted Stage B3 "
                    "profiling snapshot. Never imported directly: a per-target deployment "
                    "dataset (--resolve-against) is required first.",
        "schema_version": BRIDGE_SCHEMA_VERSION,
        "kind": "source-evidence",
        "exporter": EXPORTER,
        "exporter_version": EXPORTER_VERSION,
        "generated_utc": utc_now(),
        "provenance": {
            "label": label,
            "manifest_sha256": b1.sha256_hex(manifest_path.read_bytes()),
            "person_profile_sha256": observed_sha,
            "stage_a_label": manifest.get("sample_basis", {}).get("stage_a_label"),
            "stage_a_manifest_sha256": manifest.get("sample_basis", {}).get("stage_a_manifest_sha256"),
            "exporter_version": EXPORTER_VERSION,
        },
        "counts": {
            "requested": len(records),
            "bridges": len(bridges),
            "withheld": len(withheld),
            "collisions_acknowledged": len(collisions),
        },
        "bridges": bridges,
        "withheld": withheld,
    }
    return payload


# ---------------------------------------------------------------------------
# --resolve-against (read-only, rolled-back registration export)
# ---------------------------------------------------------------------------

def resolve_target_dsn(target: str, dsn_env_override: str | None) -> tuple[str, str]:
    """Return (dsn, required_db_name). A test may override the env var name that carries
    the DSN (--dsn-env) so it can point resolution at an isolated _test database without
    this tool needing a target literally spelled 'afldb_test' to find it."""
    if target not in TARGET_DSN_ENV and dsn_env_override is None:
        raise BridgeExportError(
            f"--resolve-against target {target!r} is not supported. Supported targets: "
            f"{sorted(TARGET_DSN_ENV)} (or pass --dsn-env explicitly).")
    env_name, required_db = TARGET_DSN_ENV.get(target, (None, None))
    if dsn_env_override:
        env_name = dsn_env_override
    import os
    dsn = os.environ.get(env_name)
    if not dsn:
        raise BridgeExportError(f"{env_name} is not set -- refusing to resolve against {target!r}")
    if required_db is not None:
        parsed = urlparse(dsn)
        if parsed.path.lstrip("/") != required_db:
            raise BridgeExportError(
                f"{env_name} does not target /{required_db} -- refusing a DSN pointed at a "
                "different database")
    return dsn, (required_db or "")


# AFLDB-ISSUE-222 Phase 3 correction (§B): this must select EXACTLY the rows
# import_draftguru.resolve_afltables_players() would resolve an identity against -- same
# source join, same status filter, same player_id IS NOT NULL, and (the divergence an
# independent review found) the SAME match_method filter. Without the match_method filter an
# identity registered under some other match_method (e.g. a manual/fuzzy correction) passed
# this exporter as "registered" but resolved to zero candidates at import (HALT).
#
# The importer does not de-duplicate: resolve_afltables_players() appends one player_id per
# *row* it reads, so a target_id genuinely registered twice under the same match_method --
# even to the same player -- produces a 2-element candidate list and apply_authority() HALTs
# on `len(candidates) != 1`. COUNT(DISTINCT ei.player_id) would hide that duplicate-row case
# (both rows same player -> distinct count 1) and let the exporter call it "registered
# exactly once" while the importer would still HALT on it. COUNT(*) mirrors len(candidates)
# exactly and preserves that fail-closed behaviour instead of papering over it.
REGISTRATION_SQL = f"""
SELECT ei.external_id, count(*) AS registered_rows
  FROM external_identities ei
  JOIN sources s ON s.id = ei.source_id AND s.key = '{AFLTABLES_SOURCE_KEY}'
 WHERE ei.player_id IS NOT NULL AND ei.status IN ('unique', 'resolved')
   AND ei.match_method = '{AFLTABLES_MATCH_METHOD}'
 GROUP BY ei.external_id
"""


def read_target_registration(dsn: str) -> dict[str, int]:
    """external_id -> registered-row count under the importer's own resolution semantics
    (§B above -- not a distinct-player count). One rolled-back, read-only transaction;
    nothing is ever written."""
    import psycopg
    conn = psycopg.connect(dsn, options="-c default_transaction_read_only=on")
    try:
        conn.read_only = True
        conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        with conn.cursor() as cur:
            cur.execute("SELECT current_setting('transaction_read_only'), "
                        "current_setting('default_transaction_read_only')")
            txn_ro, default_ro = cur.fetchone()
            if txn_ro != "on" or default_ro != "on":
                raise BridgeExportError("REFUSED: transaction is not read-only")
            cur.execute(REGISTRATION_SQL)
            rows = cur.fetchall()
    finally:
        try:
            conn.rollback()
        finally:
            conn.close()
    return {external_id: count for external_id, count in rows}


def assert_resolvable_parent(parent: dict) -> None:
    """--resolve-against takes the SOURCE-EVIDENCE parent, never a per-target deployment
    child.

    This is the resolve-side twin of the guard --review-sample already carries (§C.4).
    Resolving a child would filter an already-filtered dataset against a second
    registration measurement, silently narrowing bridges[] and re-stamping the result as a
    fresh deployment artefact. With the v2 parent and the v1 afldb_test child now sitting
    in data/reference/ under names that differ by one suffix, that is an ordinary typo, so
    it fails closed here. A dataset that declares no `kind` at all is accepted: the minimal
    hand-built parents used by the integration tests carry only schema_version/bridges.
    """
    kind = parent.get("kind")
    if kind == "deployment":
        raise BridgeExportError(
            "--resolve-against requires the SOURCE-EVIDENCE parent bridge dataset, not a "
            f"per-target deployment child (this input declares kind={kind!r}, target="
            f"{parent.get('target')!r}). Resolving an already-resolved dataset would filter "
            "it a second time. Pass the parent produced by --source-evidence or by "
            "build_person_bridge_v2.py.")


def assert_writable_out(out_path: Path, *, parent_path: Path, allow_overwrite: bool) -> None:
    """Refuse to write over the input, or over any existing file, without an explicit flag.

    atomic_write_bytes() replaces its target silently. The immutable inputs of a completed,
    hash-verified artefact now live in the same directory as this mode's output
    (data/reference/draftguru-person-bridge-20260918-v1.afldb_test.json is a pinned input of
    the v2 reconciliation), so a mistyped --out would destroy tracked evidence with no
    warning. Unlike the v2 generator's outputs, a deployment child carries a wall-clock
    generated_utc and a live target_registration measurement, so a rerun is never
    byte-identical and cannot be proven idempotent -- overwriting is therefore always a
    deliberate operator decision, never an inferred one.
    """
    if out_path.resolve() == parent_path.resolve():
        raise BridgeExportError(
            f"--out and --parent are the same file ({out_path}); refusing to overwrite the "
            "source-evidence parent with its own deployment child")
    if out_path.exists() and not allow_overwrite:
        raise BridgeExportError(
            f"{out_path} already exists; refusing to overwrite it. A deployment child is a "
            "live measurement and a rerun is never byte-identical, so an overwrite cannot be "
            "shown to be idempotent. Choose a new --out, or pass --allow-overwrite "
            "deliberately.")


def build_deployment_dataset(contract: dict, *, parent: dict, target: str,
                             registration: dict[str, int]) -> dict:
    url_re = canonical_url_regex(contract)
    self_validate_bridge_schema(parent, url_re)

    deployment_bridges = []
    withheld = list(parent.get("withheld", []))
    for entry in parent["bridges"]:
        identity = entry["afltables_external_id"]
        count = registration.get(identity, 0)
        if count == 0:
            withheld.append({"player_url": entry["player_url"], "reason": "target_not_registered"})
        elif count > 1:
            withheld.append({"player_url": entry["player_url"], "reason": "target_ambiguous"})
        else:
            deployment_bridges.append(entry)
    withheld.sort(key=lambda w: w["player_url"])

    payload = {
        "$comment": f"AFLDB-ISSUE-222 Stage B3 per-target DEPLOYMENT bridge for target "
                    f"{target!r} (revised runbook §4.5). The parent's bridges[] minus every "
                    "identity not registered exactly once on this target.",
        "schema_version": BRIDGE_SCHEMA_VERSION,
        "kind": "deployment",
        "target": target,
        "exporter": EXPORTER,
        "exporter_version": EXPORTER_VERSION,
        "generated_utc": utc_now(),
        "parent_sha256": parent.get("$parent_sha256"),
        "provenance": parent.get("provenance"),
        "target_registration": {
            "count": len(registration),
            "measured_at": utc_now(),
        },
        "counts": {
            "parent_bridges": len(parent["bridges"]),
            "bridges": len(deployment_bridges),
            "withheld": len(withheld),
        },
        "bridges": deployment_bridges,
        "withheld": withheld,
    }
    return payload


# ---------------------------------------------------------------------------
# --review-sample (§3.5)
# ---------------------------------------------------------------------------

def salted_key(salt: str, player_url: str) -> str:
    return hashlib.sha256(f"{salt}|{player_url}".encode("utf-8")).hexdigest()


def load_top10_national_urls(stage_a_dir: Path) -> set[str]:
    sys.path.insert(0, str(TOOL_DIR))
    import profile_person_pages as profiler  # noqa: E402 (offline, stdlib only)
    index = profiler.load_year_top10_index(stage_a_dir)
    return {url for url, entry in index.items() if entry["top10_national"]}


def build_review_sample(contract: dict, *, parent_or_deployment: dict, snapshot_root: Path | None,
                        salt: str, n: int) -> dict:
    # AFLDB-ISSUE-222 Phase 3 correction (§C.4): the review sample is drawn on the
    # source-evidence PARENT only (revised runbook §4.5, correction handoff §5). A
    # per-target DEPLOYMENT dataset's bridges[] is already filtered by one target's
    # registration, so drawing a sample from it would silently change what "bridged" means
    # mid-review and could omit target_not_registered rows the review must cover. Refuse
    # explicitly rather than rely on a missing/absent provenance field to catch it.
    kind = parent_or_deployment.get("kind")
    if kind == "deployment":
        raise BridgeExportError(
            "--review-sample requires the source-evidence PARENT bridge dataset, not a "
            f"per-target deployment child (this input declares kind={kind!r}, target="
            f"{parent_or_deployment.get('target')!r}). Pass the parent produced by "
            "--source-evidence.")
    stage_a_label = parent_or_deployment.get("provenance", {}).get("stage_a_label")
    if not stage_a_label:
        raise BridgeExportError("the bridge dataset carries no provenance.stage_a_label")
    root = snapshot_root or (REPO_ROOT / contract["snapshot"]["root"])
    stage_a_dir = (root / stage_a_label).resolve()
    top10_urls = load_top10_national_urls(stage_a_dir)

    bridged_urls = sorted(entry["player_url"] for entry in parent_or_deployment["bridges"])
    census = sorted(url for url in bridged_urls if url in top10_urls)
    remaining = [url for url in bridged_urls if url not in top10_urls]
    ranked = sorted(remaining, key=lambda url: (salted_key(salt, url), url))
    random_stratum = ranked[:n]

    return {
        "$comment": "AFLDB-ISSUE-222 §3.5 bridge-precision review sample. Two pre-declared "
                    "strata, unreviewed -- verdicts are recorded separately and this file is "
                    "never edited to add them.",
        "exporter": EXPORTER,
        "exporter_version": EXPORTER_VERSION,
        "generated_utc": utc_now(),
        "salt": salt,
        "n": n,
        "population": {
            "bridged_total": len(bridged_urls),
            "census_stratum_total": len(census),
            "random_stratum_population": len(remaining),
        },
        "census_stratum": [{"player_url": url, "verdict": None} for url in census],
        "random_stratum": [{"player_url": url, "verdict": None} for url in random_stratum],
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--source-evidence", action="store_true")
    mode.add_argument("--resolve-against", metavar="TARGET")
    mode.add_argument("--review-sample", metavar="PARENT_PATH")

    parser.add_argument("--label", help="Stage B3 snapshot label (--source-evidence)")
    parser.add_argument("--snapshot-root", help="override the contract snapshot root")
    parser.add_argument("--manifest-dir", help="override the manifest directory")
    parser.add_argument("--acknowledge-bridge-collisions", action="store_true",
                        help="withhold BOTH sides of every detected collision instead of "
                             "refusing to export (--source-evidence only)")
    parser.add_argument("--out", required=True, help="output dataset path")

    parser.add_argument("--parent", help="the source-evidence parent path (--resolve-against)")
    parser.add_argument("--dsn-env", help="override the DSN environment variable name "
                                          "(--resolve-against; primarily for tests)")
    parser.add_argument("--allow-overwrite", action="store_true",
                        help="permit --resolve-against to replace an existing --out file "
                             "(never inferred: a deployment child is a live measurement)")

    parser.add_argument("--salt", help="the declared random-stratum salt (--review-sample)")
    parser.add_argument("--n", type=int, help="random-stratum size (--review-sample)")

    args = parser.parse_args(argv)

    try:
        contract, _b3 = load_contract_and_b3()
        url_re = canonical_url_regex(contract)
        out_path = Path(args.out)

        if args.source_evidence:
            if not args.label:
                raise BridgeExportError("--source-evidence requires --label")
            payload = build_source_evidence(
                contract, label=args.label,
                snapshot_root=Path(args.snapshot_root) if args.snapshot_root else None,
                manifest_dir=Path(args.manifest_dir) if args.manifest_dir else None,
                acknowledge_collisions=args.acknowledge_bridge_collisions)
            sha = write_dataset(out_path, payload, url_re)
            print(json.dumps({
                "mode": "source-evidence", "label": args.label, "out": str(out_path),
                "sha256": sha, "counts": payload["counts"],
            }, ensure_ascii=True, sort_keys=True, indent=2))
            return 0

        if args.resolve_against:
            if not args.parent:
                raise BridgeExportError("--resolve-against requires --parent")
            parent_path = Path(args.parent)
            parent = load_json(parent_path, "source-evidence parent bridge dataset")
            parent = dict(parent)
            parent["$parent_sha256"] = b1.sha256_hex(parent_path.read_bytes())
            # Both guards run before any DSN is read or any connection is opened, so a
            # refusal here never touches the database.
            assert_resolvable_parent(parent)
            assert_writable_out(out_path, parent_path=parent_path,
                                allow_overwrite=args.allow_overwrite)
            dsn, _db = resolve_target_dsn(args.resolve_against, args.dsn_env)
            registration = read_target_registration(dsn)
            payload = build_deployment_dataset(
                contract, parent=parent, target=args.resolve_against, registration=registration)
            sha = write_dataset(out_path, payload, url_re)
            print(json.dumps({
                "mode": "resolve-against", "target": args.resolve_against, "out": str(out_path),
                "sha256": sha, "counts": payload["counts"],
            }, ensure_ascii=True, sort_keys=True, indent=2))
            return 0

        # --review-sample
        if not args.salt or args.n is None:
            raise BridgeExportError("--review-sample requires --salt and --n")
        parent_path = Path(args.review_sample)
        parent = load_json(parent_path, "bridge dataset")
        payload = build_review_sample(
            contract, parent_or_deployment=parent,
            snapshot_root=Path(args.snapshot_root) if args.snapshot_root else None,
            salt=args.salt, n=args.n)
        data = b1.dump_bytes(payload)
        b1.atomic_write_bytes(out_path, data)
        print(json.dumps({
            "mode": "review-sample", "parent": str(parent_path), "out": str(out_path),
            "sha256": b1.sha256_hex(data), "population": payload["population"],
        }, ensure_ascii=True, sort_keys=True, indent=2))
        return 0
    except (BridgeExportError, snapshot_parser.ParseFailure) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
