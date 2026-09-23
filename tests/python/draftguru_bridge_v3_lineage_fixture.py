#!/usr/bin/env python3
"""Shared hand-built lineage fixture for the AFLDB-ISSUE-227 DB-free contract of
``validate_person_bridge_child_v3.py`` (the ISSUE-224 v2 -> v3 deployment-child validator).

This is a WHOLLY SEPARATE fixture from ``draftguru_lineage_fixture.py`` (the ISSUE-222
v1 -> v2 fixture): the schema and field names below are the ISSUE-224 v3 chain's own
(``classification`` / ``operator_decision`` / ``evidence_reference.registered_path_evidence``
/ ``player_id_evidence``), never the ISSUE-222 verdict schema's
(``operator_verdict`` / ``draftguru_url`` / ``corrected_identity_candidate``).

Builds, in a temporary directory laid out like the repository, a 12-person lineage:

    parent v2  bridges p01..p08 (p07, p08 carry their CAPTURED/OLD identity), withheld
               p09, p10 (U-no-href) and p11, p12 (different_person_wrong_href, carried
               from an earlier, out-of-scope removal -- never re-admitted)
    child  v2  bridges p01..p05 (registered under their parent identity); p06, p07, p08
               target_not_registered (p06 is a genuine rollover-deferred debutant; p07/p08
               are the two persons whose captured href will later be parent-evidence
               corrected); p09-p12 carried as in the parent
    classification (94-row artefact's 3-row analogue)
               p06 genuine_post_baseline_afl_debutant / rollover_registration_candidate
               p07, p08 captured_href_differs_from_registered_path_same_person /
               parent_evidence_correction_operator_review
    decisions  p06 defer-to-rollover; p07, p08 route-to-parent-evidence-correction
    parent v3  p07, p08 corrected to their NEW (registered) identity; bridges/withheld
               counts and withheld[] content unchanged from parent v2
    child  v3  p07, p08 now accepted with their NEW identity (now registered); p06 still
               target_not_registered; p09-p12 unchanged
    transition 5 carry-forward (p01-p05), 2 corrected (p07, p08), 0 removed, 1 remaining
               target_not_registered (p06); p09-p12 never move

Never opens a real artefact. Nothing here connects to a database or the network.
"""

from __future__ import annotations

import ast
import hashlib
import json
import tempfile
from pathlib import Path

ISSUE = "AFLDB-ISSUE-224"
URL = "https://www.draftguru.com.au/players/fix_p{:02d}/1".format
CONTRACT_REGEX = r"^https://www\.draftguru\.com\.au/players/[^/]+/[1-9][0-9]*$"
EXPORTER = "tools/rebuild/draftguru/export_person_bridge.py"
V2_GENERATOR = "tools/rebuild/draftguru/build_person_bridge_v2.py"
V3_GENERATOR = "tools/rebuild/draftguru/build_person_bridge_v3_issue224.py"
B3_LABEL = "person-html-fixture"

V2_PARENT_UTC = "2026-09-18T08:43:12Z"
V2_CHILD_UTC = "2026-09-18T09:59:26Z"
CLASSIFICATION_UTC = "2026-09-19T07:58:17.605398+00:00"
FROZEN_UTC = "2026-09-19T08:02:24Z"
V3_CHILD_UTC = "2026-09-19T08:36:12Z"

OLD_TARGET = {i: f"players/F/Fix_P{i:02d}.html" for i in range(1, 9)}
NEW_TARGET = {7: "players/F/Fix_P07X.html", 8: "players/F/Fix_P08X.html"}
PLAYER_ID_EVIDENCE = {7: 4001, 8: 4002}
REGISTRATION_COUNT = 42

REL = {
    "contract": "tools/rebuild/draftguru/draftguru-contract.json",
    "parent_v2": "data/reference/draftguru-person-bridge-fixture-v3lineage-v2.json",
    "child_v2_afldb_test": "data/reference/draftguru-person-bridge-fixture-v3lineage-v2.afldb_test.json",
    "issue224_classification":
        "docs/rebuild-manifests/draftguru/issue224-population-classification-fixture.json",
    "issue224_operator_decisions":
        "docs/rebuild-manifests/draftguru/bridge-operator-verdicts-issue224-fixture-v1.json",
    "parent_v3": "data/reference/draftguru-person-bridge-fixture-v3lineage-v3.json",
    "reconciliation_v3":
        "docs/rebuild-manifests/draftguru/bridge-v3-reconciliation-issue224-fixture-v1.json",
    "diff_v3": "docs/rebuild-manifests/draftguru/bridge-v3-diff-issue224-fixture-v1.csv",
    "child_v3_afldb_test": "data/reference/draftguru-person-bridge-fixture-v3lineage-v3.afldb_test.json",
}


# ---------------------------------------------------------------------------
# Byte helpers
# ---------------------------------------------------------------------------

def dump(obj) -> bytes:
    """The exporter's canonical form: sorted keys, ASCII, indent 2, one LF."""
    return (json.dumps(obj, ensure_ascii=True, sort_keys=True, indent=2) + "\n").encode("utf-8")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canon_rows(rows) -> str:
    return sha(json.dumps(rows, ensure_ascii=True, sort_keys=True,
                          separators=(",", ":")).encode("utf-8"))


def write(root: Path, rel: str, data: bytes) -> str:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return sha(data)


def write_text(root: Path, rel: str, text: str) -> str:
    return write(root, rel, text.encode("utf-8"))


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

def build_fixture(root: Path) -> dict:
    hashes: dict[str, str] = {}

    write(root, REL["contract"], dump({
        "canonical_player_url": {
            "form": "https://www.draftguru.com.au/players/<slug>/<ordinal>",
            "regex": CONTRACT_REGEX,
        },
        "snapshot": {"root": "data/sources/draftguru"},
    }))

    provenance_v2 = {
        "exporter_version": "1.0.0",
        "label": B3_LABEL,
        "manifest_sha256": "11" * 32,
        "person_profile_sha256": "22" * 32,
        "stage_a_label": "annual-html-fixture",
        "stage_a_manifest_sha256": "33" * 32,
        "v2_generator": V2_GENERATOR,
        "v2_generator_version": "1.0.0",
        "v2_operator_verdicts_path":
            "docs/rebuild-manifests/draftguru/bridge-operator-verdicts-fixture-v1.json",
        "v2_operator_verdicts_sha256": "44" * 32,
    }

    parent_v2_bridges = bridge_rows([(URL(i), OLD_TARGET[i]) for i in range(1, 9)])
    parent_v2_withheld = withheld_rows(
        [(URL(9), "U-no-href"), (URL(10), "U-no-href"),
         (URL(11), "different_person_wrong_href"), (URL(12), "different_person_wrong_href")])
    rows_sha256_v2 = canon_rows({"bridges": parent_v2_bridges, "withheld": parent_v2_withheld})
    parent_v2 = {
        "$comment": "fixture source-evidence parent v2",
        "schema_version": 1,
        "kind": "source-evidence",
        "exporter": V2_GENERATOR,
        "exporter_version": "1.0.0",
        "generated_utc": V2_PARENT_UTC,
        "generated_utc_basis": "frozen to the fixture verdict artefact's review_completed_utc",
        "provenance": provenance_v2,
        "supersedes": {"path": "data/reference/draftguru-person-bridge-fixture-v1.json",
                       "sha256": "55" * 32},
        "rows_sha256": rows_sha256_v2,
        "operator_adjudication": {"source": {"path": "fixture-v2-verdicts.json", "sha256": "66" * 32}},
        "counts": {"bridges": 8, "collisions_acknowledged": 0, "requested": 12, "withheld": 4},
        "bridges": parent_v2_bridges,
        "withheld": parent_v2_withheld,
    }
    hashes["parent_v2"] = write(root, REL["parent_v2"], dump(parent_v2))

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
        "counts": {"parent_bridges": 8, "bridges": 5, "withheld": 7},
        "bridges": bridge_rows([(URL(i), OLD_TARGET[i]) for i in range(1, 6)]),
        "withheld": withheld_rows(
            [(URL(6), "target_not_registered"), (URL(7), "target_not_registered"),
             (URL(8), "target_not_registered"), (URL(9), "U-no-href"), (URL(10), "U-no-href"),
             (URL(11), "different_person_wrong_href"), (URL(12), "different_person_wrong_href")]),
    }
    hashes["child_v2_afldb_test"] = write(root, REL["child_v2_afldb_test"], dump(child_v2))

    classification_rows = [
        {
            "player_url": URL(6), "afltables_external_id": OLD_TARGET[6],
            "classification": "genuine_post_baseline_afl_debutant",
            "reason": "FIRST_2026_APPEARANCE_CAREER_GAMES_1",
            "registered_path_evidence": None, "player_id_evidence": None,
            "phase1_snapshot_label": "fixture-inseason", "first_2026_match_date": "2026-04-01",
            "first_2026_career_games": 1, "route": "rollover_registration_candidate",
        },
    ] + [
        {
            "player_url": URL(i), "afltables_external_id": OLD_TARGET[i],
            "classification": "captured_href_differs_from_registered_path_same_person",
            "reason": "ALREADY_REGISTERED_UNDER_DIFFERENT_AFLTABLES_PATH",
            "registered_path_evidence": NEW_TARGET[i], "player_id_evidence": PLAYER_ID_EVIDENCE[i],
            "phase1_snapshot_label": None, "first_2026_match_date": None,
            "first_2026_career_games": None, "route": "parent_evidence_correction_operator_review",
        }
        for i in (7, 8)
    ]
    class_rows_sha = canon_rows(classification_rows)
    classification = {
        "schema_version": 1, "kind": "issue224_population_classification", "issue": ISSUE,
        "generated_utc": CLASSIFICATION_UTC,
        "classification_basis": {
            "category_a": "fixture debutant rule", "category_b": "fixture correction rule"},
        "inputs": {"snapshot_label": "fixture-inseason",
                  "parent": {"path": REL["parent_v2"], "sha256": hashes["parent_v2"]},
                  "target_child": {"path": REL["child_v2_afldb_test"],
                                   "sha256": hashes["child_v2_afldb_test"]},
                  "player_stats": {"path": "fixture-player-stats.csv", "sha256": "77" * 32}},
        "counts": {"rows": 3, "genuine_post_baseline_afl_debutant": 1,
                  "captured_href_differs_from_registered_path_same_person": 2,
                  "continuity": 0, "unresolved": 0, "absent": 0},
        "rows_sha256": class_rows_sha,
        "rows": classification_rows,
    }
    hashes["issue224_classification"] = write(root, REL["issue224_classification"], dump(classification))

    decision_rows = [
        {
            "decided_utc": FROZEN_UTC, "player_url": URL(6), "afltables_external_id": OLD_TARGET[6],
            "classification": "genuine_post_baseline_afl_debutant",
            "operator_decision": "defer-to-rollover",
            "justification": "fixture: use the canonical end-of-season rollover",
            "evidence_reference": {"phase2_rows_sha256": class_rows_sha,
                                   "snapshot_label": "fixture-inseason",
                                   "first_2026_match_date": "2026-04-01",
                                   "first_2026_career_games": 1},
        },
    ] + [
        {
            "decided_utc": FROZEN_UTC, "player_url": URL(i), "afltables_external_id": OLD_TARGET[i],
            "classification": "captured_href_differs_from_registered_path_same_person",
            "operator_decision": "route-to-parent-evidence-correction",
            "justification": "fixture: route through the reviewed parent-correction mechanism",
            "evidence_reference": {"phase2_rows_sha256": class_rows_sha,
                                   "registered_path_evidence": NEW_TARGET[i],
                                   "player_id_evidence": PLAYER_ID_EVIDENCE[i]},
        }
        for i in (7, 8)
    ]
    dec_rows_sha = canon_rows(decision_rows)
    decisions = {
        "schema_version": 1, "tool": "issue224_phase3_operator_decisions_fixture", "issue": ISSUE,
        "label": "fixture-v1", "operator_display_name": "Fixture",
        "review_started_utc": FROZEN_UTC, "review_completed_utc": FROZEN_UTC,
        "completion_status": "complete",
        "source_adjudication_pack": {"path": REL["issue224_classification"],
                                     "sha256": hashes["issue224_classification"],
                                     "rows_sha256": class_rows_sha},
        "source_hash_links": {"phase2_classification_rows_sha256": class_rows_sha},
        "totals": {"rows": 3, "defer_to_rollover": 1, "route_to_parent_evidence_correction": 2,
                  "register": 0, "route_to_issue_136": 0, "reject": 0, "unresolved": 0},
        "rows_sha256": dec_rows_sha,
        "rows": decision_rows,
    }
    hashes["issue224_operator_decisions"] = write(root, REL["issue224_operator_decisions"], dump(decisions))

    provenance_v3 = dict(provenance_v2)
    provenance_v3.update({
        "v3_generator": V3_GENERATOR, "v3_generator_version": "1.0.0",
        "v3_operator_decisions_path": REL["issue224_operator_decisions"],
        "v3_operator_decisions_sha256": hashes["issue224_operator_decisions"],
        "v3_operator_decisions_rows_sha256": dec_rows_sha,
    })
    parent_v3_bridges = bridge_rows(
        [(URL(i), OLD_TARGET[i]) for i in range(1, 7)]
        + [(URL(i), NEW_TARGET[i]) for i in (7, 8)])
    rows_sha256_v3 = canon_rows({"bridges": parent_v3_bridges, "withheld": parent_v2_withheld})
    parent_v3 = {
        "$comment": "fixture source-evidence parent v3",
        "schema_version": 1,
        "kind": "source-evidence",
        "exporter": V3_GENERATOR,
        "exporter_version": "1.0.0",
        "generated_utc": FROZEN_UTC,
        "generated_utc_basis": "frozen to the fixture Phase 3 operator decision artefact's "
                               "review_completed_utc",
        "provenance": provenance_v3,
        "supersedes": {"path": REL["parent_v2"], "sha256": hashes["parent_v2"]},
        "rows_sha256": rows_sha256_v3,
        "operator_adjudication": parent_v2["operator_adjudication"],
        "counts": {"bridges": 8, "collisions_acknowledged": 0, "requested": 12, "withheld": 4},
        "bridges": parent_v3_bridges,
        "withheld": parent_v2_withheld,
        "issue224_parent_correction": {
            "issue": ISSUE, "operator_display_name": "Fixture", "decided_utc": FROZEN_UTC,
            "source": {"path": REL["issue224_operator_decisions"],
                      "sha256": hashes["issue224_operator_decisions"],
                      "rows_sha256": dec_rows_sha},
            "actions_by_type": {"corrected": 2, "unchanged": 6, "withheld_unchanged": 4},
            "affected_rows": [
                {"action": "corrected", "draftguru_url": URL(i),
                 "operator_decision": "route-to-parent-evidence-correction",
                 "player_id_evidence": PLAYER_ID_EVIDENCE[i],
                 "v2_afltables_external_id": OLD_TARGET[i], "v3_afltables_external_id": NEW_TARGET[i]}
                for i in (7, 8)
            ],
        },
    }
    hashes["parent_v3"] = write(root, REL["parent_v3"], dump(parent_v3))

    changed_rows = [
        {"player_url": URL(i), "v2_afltables_external_id": OLD_TARGET[i],
         "v3_afltables_external_id": NEW_TARGET[i],
         "operator_decision": "route-to-parent-evidence-correction",
         "player_id_evidence": PLAYER_ID_EVIDENCE[i]}
        for i in (7, 8)
    ]
    recon_rows_sha = canon_rows(changed_rows)
    diff_lines = ["player_url,v2_afltables_external_id,v3_afltables_external_id,"
                 "operator_decision,player_id_evidence"]
    for row in changed_rows:
        diff_lines.append(",".join([row["player_url"], row["v2_afltables_external_id"],
                                    row["v3_afltables_external_id"], row["operator_decision"],
                                    str(row["player_id_evidence"])]))
    diff_text = "\n".join(diff_lines) + "\n"
    hashes["diff_v3"] = write_text(root, REL["diff_v3"], diff_text)

    reconciliation = {
        "schema_version": 1, "issue": ISSUE, "label": "fixture-v1",
        "tool": {"path": V3_GENERATOR, "version": "1.0.0"},
        "generated_utc": FROZEN_UTC,
        "generated_utc_basis": "frozen to the fixture Phase 3 decision artefact's "
                               "review_completed_utc",
        "parent_v2": {"path": REL["parent_v2"], "sha256": hashes["parent_v2"],
                     "rows_sha256": rows_sha256_v2},
        "phase3_decisions": {"path": REL["issue224_operator_decisions"],
                            "sha256": hashes["issue224_operator_decisions"],
                            "rows_sha256": dec_rows_sha},
        "parent_v3": {"path": REL["parent_v3"], "sha256": hashes["parent_v3"],
                     "rows_sha256": rows_sha256_v3},
        "diff_report": {"path": REL["diff_v3"], "sha256": hashes["diff_v3"], "changed_rows": 2},
        "counts": {"bridges": 8, "withheld": 4, "population": 12, "changed_bridges": 2,
                  "unchanged_bridges": 6, "changed_withheld": 0},
        "changed_rows": changed_rows,
        "invariants": {
            "only_phase3_named_bridges_changed": "PASS", "withheld_content_unchanged": "PASS",
            "bridge_count_unchanged": "PASS", "withheld_count_unchanged": "PASS",
            "population_partition_unchanged": "PASS", "schema_validation": "PASS",
            "database_access": "NOT_PERFORMED", "network_access": "NOT_PERFORMED",
        },
        "rows_sha256": recon_rows_sha,
    }
    hashes["reconciliation_v3"] = write(root, REL["reconciliation_v3"], dump(reconciliation))

    child_v3 = {
        "$comment": "fixture deployment child v3",
        "schema_version": 1,
        "kind": "deployment",
        "target": "afldb_test",
        "exporter": EXPORTER,
        "exporter_version": "1.0.0",
        "generated_utc": V3_CHILD_UTC,
        "parent_sha256": hashes["parent_v3"],
        "provenance": provenance_v3,
        "target_registration": {"count": REGISTRATION_COUNT, "measured_at": V3_CHILD_UTC},
        "counts": {"parent_bridges": 8, "bridges": 7, "withheld": 5},
        "bridges": bridge_rows(
            [(URL(i), OLD_TARGET[i]) for i in range(1, 6)]
            + [(URL(i), NEW_TARGET[i]) for i in (7, 8)]),
        "withheld": withheld_rows(
            [(URL(6), "target_not_registered"), (URL(9), "U-no-href"), (URL(10), "U-no-href"),
             (URL(11), "different_person_wrong_href"), (URL(12), "different_person_wrong_href")]),
    }
    hashes["child_v3_afldb_test"] = write(root, REL["child_v3_afldb_test"], dump(child_v3))

    pinned_child = {key: (REL[key], hashes[key]) for key in (
        "parent_v2", "child_v2_afldb_test", "issue224_classification",
        "issue224_operator_decisions", "parent_v3", "reconciliation_v3", "diff_v3")}

    expect = {
        "target": "afldb_test",
        "label": B3_LABEL,
        "population": 12,
        "parent_bridges": 8,
        "child_bridges": 7,
        "child_withheld": 5,
        "carry_forward": 5,
        "corrected": {URL(7): (OLD_TARGET[7], NEW_TARGET[7], PLAYER_ID_EVIDENCE[7]),
                     URL(8): (OLD_TARGET[8], NEW_TARGET[8], PLAYER_ID_EVIDENCE[8])},
        "rejected": {URL(11): "fixture-rejected-11", URL(12): "fixture-rejected-12"},
        "v2_target_not_registered": 3,
        "remaining_target_not_registered": 1,
        "u_no_href": 2,
        "registration_count": REGISTRATION_COUNT,
        "classification_rows": 3,
        "classification_debutant": 1,
        "classification_correction": 2,
    }

    return {
        "root": root,
        "rel": dict(REL),
        "sha": hashes,
        "pinned_child": pinned_child,
        "expect": expect,
        "child_rel": REL["child_v3_afldb_test"],
        "child_sha256": hashes["child_v3_afldb_test"],
        "old_target": dict(OLD_TARGET),
        "new_target": dict(NEW_TARGET),
        "player_id_evidence": dict(PLAYER_ID_EVIDENCE),
    }


def new_fixture(prefix: str = "afldb-i227-v3lineage-") -> dict:
    return build_fixture(Path(tempfile.mkdtemp(prefix=prefix)))


# ---------------------------------------------------------------------------
# AST checks (same definitions as draftguru_lineage_fixture.py)
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
