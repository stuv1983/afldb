#!/usr/bin/env python3
"""Shared hand-built lineage fixture for the AFLDB-ISSUE-222 DB-free contracts of
``validate_person_bridge_child.py`` and ``build_validation_sample.py``.

Builds, in a temporary directory laid out like the repository, a 12-person lineage:

    parent v1  bridges p01..p09, withheld p10..p12 (U-no-href)
    child  v1  bridges p01..p03 and p05..p08; p04 AND p09 target_not_registered
               (p04's original captured target Fix_P04 was not registered in the
               target, exactly like the real lineage's 101 withheld v1 persons)
    verdicts   p04 approve_manual_curation (structured corrected target Fix_P040),
               p05 different_person_wrong_href, p01 audit agree
    parent v2  p04 corrected, p05 withheld different_person_wrong_href  -> 8 bridges
    child  v2  p04 now accepted with Fix_P040, p09 still unregistered   -> 7 bridges
    transition 6 carry-forward, 1 corrected (p04), 1 removed (p05), 1 remaining
               target_not_registered (p09); no accepted target changes in place
    sample v1  census {p01}, random {p02, p03}, salt AFLDB-ISSUE-222/v1
    Stage A    one row per person; p01 (by default) is a National Draft top-10 pick

Never opens a real artefact. Nothing here connects to a database or the network.
"""

from __future__ import annotations

import ast
import hashlib
import json
import tempfile
from pathlib import Path

ISSUE = "AFLDB-ISSUE-222"
URL = "https://www.draftguru.com.au/players/fix_p{:02d}/1".format
CONTRACT_REGEX = r"^https://www\.draftguru\.com\.au/players/[^/]+/[1-9][0-9]*$"
EXPORTER = "tools/rebuild/draftguru/export_person_bridge.py"
V2_GENERATOR = "tools/rebuild/draftguru/build_person_bridge_v2.py"
STAGE_A_LABEL = "annual-html-fixture"
B3_LABEL = "person-html-fixture"
PRIOR_SALT = "AFLDB-ISSUE-222/v1"

V1_PARENT_UTC = "2026-09-18T00:56:17Z"
V1_SAMPLE_UTC = "2026-09-18T00:56:33Z"
V1_CHILD_UTC = "2026-09-18T00:56:58Z"
FROZEN_UTC = "2026-09-18T08:43:12Z"
V2_CHILD_UTC = "2026-09-18T09:59:26Z"

V1_TARGET = {i: f"players/F/Fix_P{i:02d}.html" for i in range(1, 10)}
CORRECTED_P04 = "players/F/Fix_P040.html"
REJECTED_P05 = V1_TARGET[5]
REGISTRATION_COUNT = 99

REL = {
    "contract": "tools/rebuild/draftguru/draftguru-contract.json",
    "b3_manifest": f"docs/rebuild-manifests/draftguru/{B3_LABEL}.json",
    "stage_a_rows": f"data/sources/draftguru/{STAGE_A_LABEL}/parsed/rows.jsonl",
    "parent_v1": "data/reference/draftguru-person-bridge-fixture-v1.json",
    "child_v1_afldb_test": "data/reference/draftguru-person-bridge-fixture-v1.afldb_test.json",
    "operator_verdicts_json":
        "docs/rebuild-manifests/draftguru/bridge-operator-verdicts-fixture-v1.json",
    "parent_v2": "data/reference/draftguru-person-bridge-fixture-v2.json",
    "reconciliation_v2":
        "docs/rebuild-manifests/draftguru/bridge-v2-reconciliation-fixture-v1.json",
    "child_v2_afldb_test": "data/reference/draftguru-person-bridge-fixture-v2.afldb_test.json",
    "review_sample_v1": "docs/rebuild-manifests/draftguru/bridge-review-fixture-v1.json",
}


# ---------------------------------------------------------------------------
# Byte helpers (the exporter's canonical form: sorted keys, ASCII, indent 2, one LF)
# ---------------------------------------------------------------------------

def dump(obj) -> bytes:
    return (json.dumps(obj, ensure_ascii=True, sort_keys=True, indent=2) + "\n").encode("utf-8")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write(root: Path, rel: str, data: bytes) -> str:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return sha(data)


def read_json(root: Path, rel: str) -> dict:
    return json.loads((root / rel).read_text(encoding="utf-8"))


def rewrite_json(root: Path, rel: str, doc) -> str:
    """Canonical rewrite; returns the new sha256."""
    return write(root, rel, dump(doc))


def snapshot(root: Path) -> dict[str, str]:
    return {p.relative_to(root).as_posix(): sha(p.read_bytes())
            for p in sorted(root.rglob("*")) if p.is_file()}


def bridge_rows(pairs: list[tuple[str, str]]) -> list[dict]:
    return [{"afltables_external_id": identity, "player_url": url}
            for url, identity in sorted(pairs, key=lambda p: p[0].encode("utf-8"))]


def withheld_rows(pairs: list[tuple[str, str]]) -> list[dict]:
    return [{"player_url": url, "reason": reason}
            for url, reason in sorted(pairs, key=lambda p: p[0].encode("utf-8"))]


# ---------------------------------------------------------------------------
# The fixture
# ---------------------------------------------------------------------------

def build_fixture(root: Path, *, top10: tuple[int, ...] = (1,),
                  identity_suffix: str = "") -> dict:
    """``identity_suffix`` is inserted before ``.html`` in every AFL Tables identity
    (default none, i.e. the module constants). The Phase F review contract passes a letter so
    the fixture identities carry no numeric suffix and can reach the clean audit pool."""
    hashes: dict[str, str] = {}
    if identity_suffix:
        targets = {i: f"players/F/Fix_P{i:02d}{identity_suffix}.html" for i in range(1, 10)}
        corrected_p04 = f"players/F/Fix_P040{identity_suffix}.html"
    else:
        targets = dict(V1_TARGET)
        corrected_p04 = CORRECTED_P04
    rejected_p05 = targets[5]

    write(root, REL["contract"], dump({
        "canonical_player_url": {
            "form": "https://www.draftguru.com.au/players/<slug>/<ordinal>",
            "regex": CONTRACT_REGEX,
        },
        "snapshot": {"root": "data/sources/draftguru"},
    }))
    hashes["b3_manifest"] = write(root, REL["b3_manifest"], dump({
        "snapshot_label": B3_LABEL, "pages": 12, "$comment": "fixture B3 manifest"}))

    stage_a_lines = []
    for i in range(1, 13):
        stage_a_lines.append(json.dumps({
            "player_url": URL(i), "draft_year": 2000 + i, "event_type_raw": "National",
            "pick_number": 1 if i in top10 else 20 + i, "club_name_raw": "Fixture FC",
        }, ensure_ascii=True, sort_keys=True))
    hashes["stage_a_rows"] = write(root, REL["stage_a_rows"],
                                   ("\n".join(stage_a_lines) + "\n").encode("utf-8"))

    provenance_v1 = {
        "exporter_version": "1.0.0",
        "label": B3_LABEL,
        "manifest_sha256": hashes["b3_manifest"],
        "person_profile_sha256": "11" * 32,
        "stage_a_label": STAGE_A_LABEL,
        "stage_a_manifest_sha256": "22" * 32,
    }

    parent_v1 = {
        "$comment": "fixture source-evidence parent v1",
        "schema_version": 1,
        "kind": "source-evidence",
        "exporter": EXPORTER,
        "exporter_version": "1.0.0",
        "generated_utc": V1_PARENT_UTC,
        "provenance": provenance_v1,
        "counts": {"bridges": 9, "collisions_acknowledged": 0, "requested": 12, "withheld": 3},
        "bridges": bridge_rows([(URL(i), targets[i]) for i in range(1, 10)]),
        "withheld": withheld_rows([(URL(i), "U-no-href") for i in range(10, 13)]),
    }
    hashes["parent_v1"] = write(root, REL["parent_v1"], dump(parent_v1))

    child_v1 = {
        "$comment": "fixture deployment child v1",
        "schema_version": 1,
        "kind": "deployment",
        "target": "afldb_test",
        "exporter": EXPORTER,
        "exporter_version": "1.0.0",
        "generated_utc": V1_CHILD_UTC,
        "parent_sha256": hashes["parent_v1"],
        "provenance": provenance_v1,
        "target_registration": {"count": REGISTRATION_COUNT, "measured_at": V1_CHILD_UTC},
        # p04 is withheld here, not accepted: its captured v1 target was never registered
        # in the target database, which is the only state the validator admits for a
        # person the operator later corrects (v1 withheld -> v2 accepted with the NEW
        # target). Accepting it here with the old target would make v2 a change in place.
        "counts": {"parent_bridges": 9, "bridges": 7, "withheld": 5},
        "bridges": bridge_rows([(URL(i), targets[i]) for i in (1, 2, 3, 5, 6, 7, 8)]),
        "withheld": withheld_rows([(URL(4), "target_not_registered"),
                                   (URL(9), "target_not_registered")]
                                  + [(URL(i), "U-no-href") for i in range(10, 13)]),
    }
    hashes["child_v1_afldb_test"] = write(root, REL["child_v1_afldb_test"], dump(child_v1))

    verdicts = {
        "issue": ISSUE,
        "label": "fixture-v1",
        "schema_version": 1,
        "review_started_utc": "2026-09-18T05:19:18Z",
        "review_completed_utc": FROZEN_UTC,
        "rows": [
            {
                "draftguru_url": URL(1), "group": "audit", "operator_verdict": "agree",
                "operator_notes": "",
                "evidence": {"captured_afltables_href": targets[1], "draftguru_url": URL(1)},
            },
            {
                "draftguru_url": URL(4), "group": "discrepancy",
                "operator_verdict": "approve_manual_curation", "operator_notes": "",
                "evidence": {"captured_href": targets[4],
                             "corrected_identity_candidate": corrected_p04,
                             "draftguru_url": URL(4)},
            },
            {
                "draftguru_url": URL(5), "group": "relisting",
                "operator_verdict": "different_person_wrong_href",
                "operator_notes": "https://en.wikipedia.org/wiki/Fixture_Person",
                "evidence": {"captured_afltables_href": rejected_p05, "draftguru_url": URL(5)},
            },
        ],
    }
    hashes["operator_verdicts_json"] = write(root, REL["operator_verdicts_json"], dump(verdicts))

    provenance_v2 = dict(provenance_v1)
    provenance_v2.update({
        "v2_generator": V2_GENERATOR,
        "v2_generator_version": "1.0.0",
        "v2_operator_verdicts_path": REL["operator_verdicts_json"],
        "v2_operator_verdicts_sha256": hashes["operator_verdicts_json"],
    })
    bridges_v2 = bridge_rows([(URL(i), targets[i]) for i in (1, 2, 3, 6, 7, 8, 9)]
                             + [(URL(4), corrected_p04)])
    withheld_v2 = withheld_rows([(URL(5), "different_person_wrong_href")]
                                + [(URL(i), "U-no-href") for i in range(10, 13)])
    rows_sha256_v2 = sha(json.dumps(bridges_v2, ensure_ascii=True, sort_keys=True,
                                    separators=(",", ":")).encode("utf-8"))
    parent_v2 = {
        "$comment": "fixture source-evidence parent v2",
        "schema_version": 1,
        "kind": "source-evidence",
        "exporter": V2_GENERATOR,
        "exporter_version": "1.0.0",
        "generated_utc": FROZEN_UTC,
        "generated_utc_basis": "frozen to the verdict artefact's review_completed_utc",
        "provenance": provenance_v2,
        "supersedes": {"path": REL["parent_v1"], "sha256": hashes["parent_v1"]},
        "rows_sha256": rows_sha256_v2,
        "operator_adjudication": {
            "source": {"path": REL["operator_verdicts_json"],
                       "sha256": hashes["operator_verdicts_json"]}},
        "counts": {"bridges": 8, "collisions_acknowledged": 0, "requested": 12, "withheld": 4},
        "bridges": bridges_v2,
        "withheld": withheld_v2,
    }
    hashes["parent_v2"] = write(root, REL["parent_v2"], dump(parent_v2))

    reconciliation = {
        "$comment": "fixture v2 reconciliation manifest",
        "schema_version": 1,
        "parent_v1": {"path": REL["parent_v1"], "sha256": hashes["parent_v1"]},
        "parent_v2": {"path": REL["parent_v2"], "sha256": hashes["parent_v2"],
                      "rows_sha256": rows_sha256_v2},
        "outputs": [{"key": "parent_v2", "path": REL["parent_v2"],
                     "sha256": hashes["parent_v2"]}],
        "counts": {"accepted_v1": 9, "accepted_v2": 8, "population": 12,
                   "withheld_v1": 3, "withheld_v2": 4},
        "child_status_detail": {
            "corrected_parent_targets_pending_db_resolution": [URL(4)],
            "corrected_parent_targets_pending_db_resolution_count": 1,
            "v1_rows_eligible_for_unchanged_carry_forward": 6,
            "v1_resolved_child_path": REL["child_v1_afldb_test"],
            "v1_resolved_child_sha256": hashes["child_v1_afldb_test"],
        },
        "lineage": {"changed_rows": [
            {"action": "corrected", "draftguru_url": URL(4), "group": "discrepancy",
             "operator_verdict": "approve_manual_curation",
             "rejected_afltables_target": None,
             "v1_afltables_external_id": targets[4],
             "v2_afltables_external_id": corrected_p04},
            {"action": "removed_withheld", "draftguru_url": URL(5), "group": "relisting",
             "operator_verdict": "different_person_wrong_href",
             "rejected_afltables_target": rejected_p05,
             "v1_afltables_external_id": rejected_p05,
             "v2_afltables_external_id": None},
        ]},
    }
    hashes["reconciliation_v2"] = write(root, REL["reconciliation_v2"], dump(reconciliation))

    child_v2 = {
        "$comment": "fixture deployment child v2",
        "schema_version": 1,
        "kind": "deployment",
        "target": "afldb_test",
        "exporter": EXPORTER,
        "exporter_version": "1.0.0",
        "generated_utc": V2_CHILD_UTC,
        "parent_sha256": hashes["parent_v2"],
        "provenance": provenance_v2,
        "target_registration": {"count": REGISTRATION_COUNT, "measured_at": V2_CHILD_UTC},
        "counts": {"parent_bridges": 8, "bridges": 7, "withheld": 5},
        "bridges": bridge_rows([(URL(i), targets[i]) for i in (1, 2, 3, 6, 7, 8)]
                               + [(URL(4), corrected_p04)]),
        "withheld": withheld_rows([(URL(5), "different_person_wrong_href"),
                                   (URL(9), "target_not_registered")]
                                  + [(URL(i), "U-no-href") for i in range(10, 13)]),
    }
    hashes["child_v2_afldb_test"] = write(root, REL["child_v2_afldb_test"], dump(child_v2))

    sample_v1 = {
        "$comment": "fixture v1 review sample",
        "exporter": EXPORTER,
        "exporter_version": "1.0.0",
        "generated_utc": V1_SAMPLE_UTC,
        "salt": PRIOR_SALT,
        "n": 2,
        "population": {"bridged_total": 9, "census_stratum_total": 1,
                       "random_stratum_population": 8},
        "census_stratum": [{"player_url": URL(1), "verdict": None}],
        "random_stratum": [{"player_url": URL(2), "verdict": None},
                           {"player_url": URL(3), "verdict": None}],
    }
    hashes["review_sample_v1"] = write(root, REL["review_sample_v1"], dump(sample_v1))

    pinned_child = {key: (REL[key], hashes[key]) for key in (
        "parent_v2", "parent_v1", "child_v1_afldb_test", "reconciliation_v2",
        "operator_verdicts_json", "b3_manifest")}
    pinned_sample = dict(pinned_child)
    pinned_sample.update({key: (REL[key], hashes[key]) for key in (
        "child_v2_afldb_test", "review_sample_v1", "stage_a_rows")})

    expect = {
        "target": "afldb_test",
        "label": B3_LABEL,
        "population": 12,
        "parent_bridges": 8,
        "child_bridges": 7,
        "child_withheld": 5,
        "carry_forward": 6,
        "corrected": {URL(4): (targets[4], corrected_p04)},
        "removed": {URL(5): rejected_p05},
        "v1_target_not_registered": 2,
        "remaining_target_not_registered": 1,
        "u_no_href": 3,
        "registration_count": REGISTRATION_COUNT,
    }

    return {
        "root": root,
        "rel": dict(REL),
        "sha": hashes,
        "pinned_child": pinned_child,
        "pinned_sample": pinned_sample,
        "expect": expect,
        "child_rel": REL["child_v2_afldb_test"],
        "child_sha256": hashes["child_v2_afldb_test"],
        "targets": targets,
        "corrected_p04": corrected_p04,
        "rejected_p05": rejected_p05,
    }


def new_fixture(prefix: str = "afldb-i222-lineage-", **kwargs) -> dict:
    return build_fixture(Path(tempfile.mkdtemp(prefix=prefix)), **kwargs)


# ---------------------------------------------------------------------------
# AST checks shared by the contracts (same definitions as draftguru_bridge_v2_contract.py)
# ---------------------------------------------------------------------------

FORBIDDEN_MODULES = {
    "psycopg", "psycopg2", "sqlalchemy", "socket", "ssl", "urllib", "urllib2",
    "urllib3", "requests", "httpx", "http", "ftplib", "telnetlib", "asyncio",
    "subprocess", "tkinter", "import_draftguru", "export_person_bridge",
}

ENV_ACCESSORS = frozenset({
    "environ", "environb", "getenv", "getenvb", "putenv", "putenvb", "unsetenv", "unsetenvb",
})
ENV_MODULES = frozenset({"os", "posix", "nt"})


def imported_modules(src: str) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Import):
            names.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                names.add(node.module.split(".")[0])
    return names


def env_accesses(src: str) -> list[str]:
    tree = ast.parse(src)
    found: list[str] = []

    def record(node: ast.AST, why: str) -> None:
        found.append(f"{node.lineno}:{node.col_offset} {why}: {ast.unparse(node)}")

    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and node.attr in ENV_ACCESSORS:
            record(node, "environment attribute")
        elif isinstance(node, ast.ImportFrom) and (node.module or "") in ENV_MODULES:
            if any(alias.name in ENV_ACCESSORS for alias in node.names):
                record(node, "environment import")
        elif isinstance(node, ast.Call):
            if (isinstance(node.func, ast.Name) and node.func.id == "getattr"
                    and len(node.args) >= 2 and isinstance(node.args[1], ast.Constant)
                    and node.args[1].value in ENV_ACCESSORS):
                record(node, "environment getattr")
        elif isinstance(node, ast.Name) and node.id in ENV_ACCESSORS:
            record(node, "environment name")
    return sorted(set(found))
