#!/usr/bin/env python3
"""AFLDB-ISSUE-222 -- DB-free, fail-closed validation of a per-target DEPLOYMENT child
bridge dataset against its pinned lineage.

    python tools/rebuild/draftguru/validate_person_bridge_child.py
    python tools/rebuild/draftguru/validate_person_bridge_child.py --expect-sha256 <hex>

Default lineage: the 2026-09-18 v2 ``afldb_test`` child
(``data/reference/draftguru-person-bridge-20260918-v2.afldb_test.json``) against the v2
SOURCE-EVIDENCE parent, the v1 ``afldb_test`` child, the v2 reconciliation manifest, the
completed operator verdict artefact and the B3 snapshot manifest. Every pinned input is
hash-verified before anything is compared; a mismatch is a refusal.

What is proven (every check prints PASS/FAIL; any FAIL is exit status 1):

  1. bytes and pinned lineage (child sha256, every input hash, top-level shape);
  2. identity of the child (kind, target, exporter, parent_sha256 chain, provenance);
  3. schema, partition and uniqueness (importer-equivalent schema gate, counts, sort order);
  4. parent containment (every accepted mapping exists identically in the parent; the
     parent's withheld rows are carried verbatim; the rejected targets appear nowhere);
  5. the exact v1 -> v2 child transition (carry-forward count, the corrected identities via
     the STRUCTURED ``evidence.corrected_identity_candidate`` field only, the removed
     identities, the surviving ``target_not_registered`` set, and that no other person
     changed accepted/withheld state or target);
  6. registration measurement and timestamps;
  7. hygiene (no DSN / absolute path / credential; canonical LF bytes).

The tool READS ONLY. It writes no file, opens no database (no psycopg import, no
``*DATABASE_URL*`` read), performs no network request and never modifies the child, the
parent or any lineage artefact. Two runs over identical inputs print an identical
``summary_sha256``.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]
sys.path.insert(0, str(TOOL_DIR))

import build_person_bridge_v2 as v2gen          # noqa: E402  (DB-free; proven by its own contract)
import review_person_bridge_offline as base    # noqa: E402  (DB-free shared helpers)

TOOL = "tools/rebuild/draftguru/validate_person_bridge_child.py"
TOOL_VERSION = "1.0.0"

EXPORTER = "tools/rebuild/draftguru/export_person_bridge.py"
UTC_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
MAX_MEASUREMENT_SKEW_SECONDS = 60

CHILD_TOP_LEVEL_KEYS = frozenset({
    "$comment", "schema_version", "kind", "target", "exporter", "exporter_version",
    "generated_utc", "parent_sha256", "provenance", "target_registration", "counts",
    "bridges", "withheld",
})
BRIDGE_ROW_KEYS = frozenset({"afltables_external_id", "player_url"})
WITHHELD_ROW_KEYS = frozenset({"player_url", "reason"})
PARENT_WITHHELD_REASONS = frozenset({"U-no-href", "different_person_wrong_href"})
TARGET_WITHHELD_REASONS = frozenset({"target_not_registered", "target_ambiguous"})

# ---------------------------------------------------------------------------
# Pinned lineage for the 2026-09-18 v2 afldb_test child.
# The child hash is the operator-reported value; it is confirmed, never assumed.
# ---------------------------------------------------------------------------

CHILD_REL = "data/reference/draftguru-person-bridge-20260918-v2.afldb_test.json"
EXPECTED_CHILD_SHA256 = "b996c60e9d4de3aeb6f250f360b2a66164a2211b9604338a65918e79fa29e1c5"

PINNED_INPUTS: dict[str, tuple[str, str]] = {
    "parent_v2": (
        "data/reference/draftguru-person-bridge-20260918-v2.json",
        "ad25d965cba72b97be895451dc488bf03a1899421e902394baa52a620abe8e57"),
    "parent_v1": (
        "data/reference/draftguru-person-bridge-20260918-v1.json",
        "92ff142ef71d175046b4949b0a85d5925bc396d3586b5b1fc3f44e51f097320e"),
    "child_v1_afldb_test": (
        "data/reference/draftguru-person-bridge-20260918-v1.afldb_test.json",
        "596bbb684424b40f43c22368f1b77aa4198eec8b56a1109a7bb587c5c7a9a27f"),
    "reconciliation_v2": (
        "docs/rebuild-manifests/draftguru/bridge-v2-reconciliation-20260918-v1.json",
        "01b7c65f63152a3458af7a10c3572478cd7cda570fbe9aad0a299a06ed8f100c"),
    "operator_verdicts_json": (
        "docs/rebuild-manifests/draftguru/bridge-operator-verdicts-20260918-v1.json",
        "b2ae2f4022cd3c22e91bfe6e399538949c02fe8cada95b5c355e6516c82a8822"),
    "b3_manifest": (
        "docs/rebuild-manifests/draftguru/person-html-20260918.json",
        "5e944d0e57985593cbe35f15d5b46613d1d8e0843895a47db3dcd99f1f2538a7"),
}

_DG = "https://www.draftguru.com.au/players/"

# The seven structured corrections (v1 target -> v2 target) and the two removals
# (rejected v1 target), exactly as the reconciliation manifest and the operator verdict
# artefact record them.
CORRECTED: dict[str, tuple[str, str]] = {
    _DG + "aaron_black/1": ("players/A/Aaron_Black.html", "players/A/Aaron_Black0.html"),
    _DG + "alwyn_davey/1": ("players/A/Alwyn_Davey.html", "players/A/Alwyn_Davey0.html"),
    _DG + "joel_smith/1": ("players/J/Joel_Smith.html", "players/J/Joel_Smith0.html"),
    _DG + "josh_smith/1": ("players/J/Josh_Smith.html", "players/J/Josh_Smith0.html"),
    _DG + "sam_butler/1": ("players/S/Sam_Butler.html", "players/S/Sam_Butler0.html"),
    _DG + "stephen_schwerdt/1": ("players/S/Steven_Schwerdt.html",
                                 "players/S/Stephen_Schwerdt.html"),
    _DG + "tom_murphy/1": ("players/T/Tom_Murphy.html", "players/T/Tom_Murphy0.html"),
}
REMOVED: dict[str, str] = {
    _DG + "craig_somerville/1": "players/C/Craig_Somerville.html",
    _DG + "david_sullivan/1": "players/D/David_Sullivan.html",
}

EXPECT: dict = {
    "target": "afldb_test",
    "label": "person-html-20260918",
    "population": 5057,
    "parent_bridges": 3562,
    "child_bridges": 3468,
    "child_withheld": 1589,
    "carry_forward": 3461,
    "corrected": CORRECTED,
    "removed": REMOVED,
    "v1_target_not_registered": 101,
    "remaining_target_not_registered": 94,
    "u_no_href": 1493,
    "registration_count": 13275,
}


class ValidationError(base.ToolError):
    """A structural refusal: the validation could not even be carried out."""


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def parse_utc(value) -> datetime | None:
    if not isinstance(value, str) or not UTC_RE.match(value):
        return None
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def url_bytes(url: str) -> bytes:
    return url.encode("utf-8")


def slug_of(url: str) -> str:
    return url[len(_DG):] if url.startswith(_DG) else url


def bridge_map(doc: dict) -> dict[str, str]:
    return {e["player_url"]: e["afltables_external_id"] for e in doc.get("bridges", [])}


def withheld_map(doc: dict) -> dict[str, str]:
    return {e["player_url"]: e["reason"] for e in doc.get("withheld", [])}


def state_map(doc: dict) -> dict[str, tuple[str, str]]:
    states: dict[str, tuple[str, str]] = {}
    for url, identity in bridge_map(doc).items():
        states[url] = ("accepted", identity)
    for url, reason in withheld_map(doc).items():
        states[url] = ("withheld", reason)
    return states


def is_sorted_by_url(rows: list[dict]) -> bool:
    keys = [url_bytes(r["player_url"]) for r in rows]
    return keys == sorted(keys)


def canonical_bytes(doc: object) -> bytes:
    """The exporter's own serialisation (stage_b1_sample.dump_bytes): sorted keys,
    ASCII-safe, two-space indent, one trailing LF."""
    return (json.dumps(doc, ensure_ascii=True, sort_keys=True, indent=2) + "\n").encode("utf-8")


class Report:
    def __init__(self, emit) -> None:
        self.emit = emit
        self.checks: list[dict] = []
        self.failures: list[str] = []

    def section(self, title: str) -> None:
        self.emit(f"\n{title}")

    def check(self, name: str, condition: bool, detail: str = "") -> bool:
        ok = bool(condition)
        self.checks.append({"name": name, "pass": ok, "detail": "" if ok else detail})
        if ok:
            self.emit(f"  PASS  {name}")
        else:
            self.emit(f"  FAIL  {name}{(' -- ' + detail) if detail else ''}")
            self.failures.append(name)
        return ok


def _diff(a: set, b: set, limit: int = 6) -> str:
    only_a = sorted(a - b)[:limit]
    only_b = sorted(b - a)[:limit]
    return f"only-left={only_a} only-right={only_b}"


# ---------------------------------------------------------------------------
# The validation
# ---------------------------------------------------------------------------

def validate(root: Path, *, child_rel: str = CHILD_REL,
             expect_child_sha256: str | None = EXPECTED_CHILD_SHA256,
             pinned: dict[str, tuple[str, str]] | None = None,
             expect: dict | None = None, emit=print) -> dict:
    """Run every check. Returns the summary dict (``failures`` empty means PASS).

    Raises ValidationError only when the child file itself is missing; every other
    problem is reported as a FAIL so the operator sees the complete picture.
    """
    pinned = dict(PINNED_INPUTS if pinned is None else pinned)
    expect = dict(EXPECT if expect is None else expect)
    rep = Report(emit)
    summary: dict = {"tool": TOOL, "tool_version": TOOL_VERSION, "child": child_rel}
    transitions: list[dict] = []

    def finish() -> dict:
        summary["checks"] = rep.checks
        summary["failures"] = list(rep.failures)
        summary["transitions"] = transitions
        digest = base.sha256_bytes(base.canonical_json_bytes(summary))
        summary["summary_sha256"] = digest
        emit("")
        emit(f"summary_sha256: {digest}")
        if rep.failures:
            emit(f"CHILD VALIDATION FAILED: {len(rep.failures)} check(s) -- {rep.failures}")
        else:
            emit("All DraftGuru child-validation checks hold.")
        return summary

    emit(f"AFLDB-ISSUE-222 deployment-child validation ({TOOL} {TOOL_VERSION}) -- read-only")

    # ------------------------------------------------------------------ 1. bytes
    rep.section("1. Bytes and pinned lineage")
    child_path = root / child_rel
    if not child_path.is_file():
        raise ValidationError(f"missing child: {child_rel}")
    child_bytes = child_path.read_bytes()
    child_sha = base.sha256_bytes(child_bytes)
    summary["child_sha256"] = child_sha
    rep.check("1.1 child sha256 equals the expected (operator-reported) value",
              expect_child_sha256 is not None and child_sha == expect_child_sha256,
              f"observed {child_sha}, expected {expect_child_sha256}")
    try:
        hashes = v2gen.hash_inputs(root, expected=pinned)
    except base.ToolError as exc:
        rep.check("1.2 every pinned lineage input exists and hash-matches", False, str(exc))
        return finish()
    rep.check("1.2 every pinned lineage input exists and hash-matches", True)
    summary["input_sha256"] = hashes

    try:
        child = json.loads(child_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        rep.check("1.3 child parses as a JSON object", False, str(exc))
        return finish()
    if not isinstance(child, dict):
        rep.check("1.3 child parses as a JSON object", False, type(child).__name__)
        return finish()
    rep.check("1.3 child parses as a JSON object", True)
    rep.check("1.4 child carries exactly the deployment top-level keys",
              set(child) == CHILD_TOP_LEVEL_KEYS, _diff(set(child), set(CHILD_TOP_LEVEL_KEYS)))

    parent = base.load_json(root / pinned["parent_v2"][0], "v2 parent")
    parent_v1 = base.load_json(root / pinned["parent_v1"][0], "v1 parent")
    child_v1 = base.load_json(root / pinned["child_v1_afldb_test"][0], "v1 child")
    recon = base.load_json(root / pinned["reconciliation_v2"][0], "v2 reconciliation")
    verdicts = base.load_json(root / pinned["operator_verdicts_json"][0], "operator verdicts")

    # --------------------------------------------------------------- 2. identity
    rep.section("2. Identity of the child")
    rep.check("2.1 schema_version == 1", child.get("schema_version") == 1,
              repr(child.get("schema_version")))
    rep.check("2.2 kind == 'deployment'", child.get("kind") == "deployment",
              repr(child.get("kind")))
    rep.check(f"2.3 target == {expect['target']!r}", child.get("target") == expect["target"],
              repr(child.get("target")))
    rep.check("2.4 exporter is export_person_bridge.py with a dotted version",
              child.get("exporter") == EXPORTER
              and bool(VERSION_RE.match(str(child.get("exporter_version")))),
              f"{child.get('exporter')!r} {child.get('exporter_version')!r}")
    recon_parent = recon.get("parent_v2") or {}
    recon_outputs = {o.get("key"): o for o in recon.get("outputs", []) if isinstance(o, dict)}
    rep.check("2.5 parent_sha256 equals the pinned v2 parent hash and the reconciliation's",
              child.get("parent_sha256") == hashes["parent_v2"] == recon_parent.get("sha256")
              == (recon_outputs.get("parent_v2") or {}).get("sha256"),
              f"child {child.get('parent_sha256')!r}, pinned {hashes['parent_v2']!r}, "
              f"reconciliation {recon_parent.get('sha256')!r}")
    supersedes = parent.get("supersedes") or {}
    rep.check("2.6 parent is source-evidence, supersedes the pinned v1 parent, rows_sha256 agrees",
              parent.get("kind") == "source-evidence"
              and supersedes.get("sha256") == hashes["parent_v1"]
              and parent.get("rows_sha256") == recon_parent.get("rows_sha256"),
              f"kind {parent.get('kind')!r}, supersedes {supersedes.get('sha256')!r}, "
              f"rows_sha256 {parent.get('rows_sha256')!r} vs {recon_parent.get('rows_sha256')!r}")
    prov = child.get("provenance") or {}
    rep.check("2.7 provenance is the parent's provenance verbatim and hash-links the B3 "
              "manifest and the operator verdict artefact",
              isinstance(prov, dict) and prov == (parent.get("provenance") or {})
              and prov.get("label") == expect["label"]
              and prov.get("manifest_sha256") == hashes["b3_manifest"]
              and prov.get("v2_operator_verdicts_sha256") == hashes["operator_verdicts_json"]
              and prov.get("v2_operator_verdicts_path") == pinned["operator_verdicts_json"][0],
              f"label {prov.get('label')!r}, manifest {prov.get('manifest_sha256')!r}, "
              f"verdicts {prov.get('v2_operator_verdicts_sha256')!r} / "
              f"{prov.get('v2_operator_verdicts_path')!r}, "
              f"equals parent provenance: {prov == (parent.get('provenance') or {})}")

    # ----------------------------------------------------------------- 3. schema
    rep.section("3. Schema, partition and uniqueness")
    url_re = v2gen.load_canonical_url_regex(root)
    try:
        v2gen.self_validate_bridge_schema(child, url_re)
        schema_ok = True
        schema_detail = ""
    except (base.ToolError, KeyError, TypeError) as exc:
        schema_ok = False
        schema_detail = str(exc)
    rep.check("3.1 importer-equivalent schema gate: canonical URLs and identities, no "
              "duplicate person, no duplicate identity, bridges/withheld disjoint",
              schema_ok, schema_detail)
    if not schema_ok:
        return finish()
    bridges = child.get("bridges", [])
    withheld = child.get("withheld", [])
    rep.check("3.2 every bridge row has exactly {afltables_external_id, player_url} and every "
              "withheld row exactly {player_url, reason}",
              all(set(r) == BRIDGE_ROW_KEYS for r in bridges)
              and all(set(r) == WITHHELD_ROW_KEYS for r in withheld))
    counts = child.get("counts") or {}
    rep.check("3.3 counts block equals the observed lengths",
              counts == {"bridges": len(bridges), "withheld": len(withheld),
                         "parent_bridges": len(parent.get("bridges", []))},
              f"counts {counts!r}, observed bridges {len(bridges)}, withheld {len(withheld)}, "
              f"parent bridges {len(parent.get('bridges', []))}")
    population = len(bridges) + len(withheld)
    parent_population = len(parent.get("bridges", [])) + len(parent.get("withheld", []))
    rep.check(f"3.4 accepted + withheld == {expect['population']} == parent population; "
              f"parent bridges {expect['parent_bridges']}, child bridges "
              f"{expect['child_bridges']}, child withheld {expect['child_withheld']}",
              population == expect["population"] == parent_population
              and len(parent.get("bridges", [])) == expect["parent_bridges"]
              and len(bridges) == expect["child_bridges"]
              and len(withheld) == expect["child_withheld"],
              f"population {population}, parent population {parent_population}, parent "
              f"bridges {len(parent.get('bridges', []))}, bridges {len(bridges)}, withheld "
              f"{len(withheld)}")
    all_urls = [r["player_url"] for r in bridges] + [r["player_url"] for r in withheld]
    rep.check("3.5 bridges and withheld partition the population exactly (no person twice)",
              len(set(all_urls)) == population,
              f"{len(set(all_urls))} distinct of {population}")
    rep.check("3.6 bridges and withheld are each sorted by player_url (byte order)",
              is_sorted_by_url(bridges) and is_sorted_by_url(withheld))
    reasons = {r["reason"] for r in withheld}
    ambiguous = sum(1 for r in withheld if r["reason"] == "target_ambiguous")
    rep.check("3.7 withheld reasons are limited to the parent's reasons plus the target "
              "reasons, and target_ambiguous == 0",
              reasons <= (PARENT_WITHHELD_REASONS | TARGET_WITHHELD_REASONS) and ambiguous == 0,
              f"reasons {sorted(reasons)}, target_ambiguous {ambiguous}")

    # ------------------------------------------------------------ 4. containment
    rep.section("4. Parent containment")
    v2_acc = bridge_map(child)
    v2_wh = withheld_map(child)
    p2_acc = bridge_map(parent)
    p2_wh = withheld_map(parent)
    mismatched = sorted(u for u, i in v2_acc.items() if p2_acc.get(u) != i)
    rep.check("4.1 every accepted child mapping exists identically in the v2 parent",
              not mismatched, f"{len(mismatched)} mismatched, e.g. {mismatched[:5]}")
    target_withheld = {u for u, r in v2_wh.items() if r in TARGET_WITHHELD_REASONS}
    parent_minus_child = set(p2_acc) - set(v2_acc)
    rep.check("4.2 parent bridges minus child bridges is exactly the child's target-withheld set",
              parent_minus_child == target_withheld, _diff(parent_minus_child, target_withheld))
    carried = {u: r for u, r in v2_wh.items() if u in p2_wh}
    rep.check("4.3 the parent's withheld rows are carried verbatim (url and reason) into the child",
              carried == p2_wh and all(r in PARENT_WITHHELD_REASONS for r in p2_wh.values()),
              f"{len(carried)} carried of {len(p2_wh)} parent withheld; reasons "
              f"{sorted(set(p2_wh.values()))}")
    parent_population_urls = set(p2_acc) | set(p2_wh)
    outside = sorted(set(v2_wh) - parent_population_urls)
    rep.check("4.4 every child-withheld person belongs to the v2 parent population",
              not outside, f"{len(outside)} outside, e.g. {outside[:5]}")
    rejected = set(expect["removed"].values())
    rep.check("4.5 neither rejected target appears among the accepted identities of the child "
              "or of the v2 parent",
              not (rejected & set(v2_acc.values())) and not (rejected & set(p2_acc.values())),
              f"child hits {sorted(rejected & set(v2_acc.values()))}, parent hits "
              f"{sorted(rejected & set(p2_acc.values()))}")

    # -------------------------------------------------------------- 5. transition
    rep.section("5. Transition from the v1 child")
    v1_acc = bridge_map(child_v1)
    v1_wh = withheld_map(child_v1)
    p1_acc = bridge_map(parent_v1)
    rep.check("5.1 the v1 child is the afldb_test deployment of the pinned v1 parent",
              child_v1.get("kind") == "deployment"
              and child_v1.get("target") == expect["target"]
              and child_v1.get("parent_sha256") == hashes["parent_v1"],
              f"kind {child_v1.get('kind')!r}, target {child_v1.get('target')!r}, "
              f"parent_sha256 {child_v1.get('parent_sha256')!r}")
    carry = {u for u, i in v2_acc.items() if v1_acc.get(u) == i}
    changed_in_place = sorted(u for u, i in v2_acc.items() if u in v1_acc and v1_acc[u] != i)
    added = set(v2_acc) - set(v1_acc)
    removed = set(v1_acc) - set(v2_acc)
    corrected_expect: dict[str, tuple[str, str]] = dict(expect["corrected"])
    removed_expect: dict[str, str] = dict(expect["removed"])
    rep.check(f"5.2 exactly {expect['carry_forward']} v1-child mappings carry forward unchanged",
              len(carry) == expect["carry_forward"], f"observed {len(carry)}")
    rep.check("5.3 no accepted person changed target in place",
              not changed_in_place, f"{changed_in_place[:5]}")
    rep.check(f"5.4 the persons newly accepted are exactly the {len(corrected_expect)} "
              "corrected identities",
              added == set(corrected_expect), _diff(added, set(corrected_expect)))
    rep.check(f"5.5 the persons no longer accepted are exactly the {len(removed_expect)} "
              "rejected identities",
              removed == set(removed_expect), _diff(removed, set(removed_expect)))

    verdict_rows: dict[str, dict] = {}
    duplicate_verdict_urls: list[str] = []
    for row in verdicts.get("rows", []):
        url = row.get("draftguru_url")
        if url in verdict_rows:
            duplicate_verdict_urls.append(url)
        verdict_rows[url] = row
    rep.check("5.6 the operator verdict artefact carries one row per person",
              not duplicate_verdict_urls, f"{duplicate_verdict_urls[:5]}")
    changed_rows = {r.get("draftguru_url"): r
                    for r in ((recon.get("lineage") or {}).get("changed_rows") or [])}

    for url in sorted(corrected_expect):
        v1_target, v2_target = corrected_expect[url]
        row = verdict_rows.get(url) or {}
        changed = changed_rows.get(url) or {}
        problems: list[str] = []
        if v1_wh.get(url) != "target_not_registered":
            problems.append(f"v1 child state {state_map(child_v1).get(url)!r}")
        if p1_acc.get(url) != v1_target:
            problems.append(f"v1 parent target {p1_acc.get(url)!r}")
        if v2_acc.get(url) != v2_target:
            problems.append(f"v2 child target {v2_acc.get(url)!r}")
        if p2_acc.get(url) != v2_target:
            problems.append(f"v2 parent target {p2_acc.get(url)!r}")
        if v2_target == v1_target:
            problems.append("corrected target equals the v1 target")
        if row.get("operator_verdict") != "approve_manual_curation" \
                or row.get("group") != "discrepancy":
            problems.append(f"verdict {row.get('operator_verdict')!r}/{row.get('group')!r}")
        try:
            structured = v2gen.corrected_target_of(row)
            if structured != v2_target:
                problems.append(f"structured corrected_identity_candidate {structured!r}")
        except base.ToolError as exc:
            problems.append(f"no structured corrected target: {exc}")
        if changed.get("action") != "corrected" \
                or changed.get("v1_afltables_external_id") != v1_target \
                or changed.get("v2_afltables_external_id") != v2_target \
                or changed.get("rejected_afltables_target") is not None:
            problems.append(f"reconciliation changed_row {changed!r}")
        rep.check(f"5.7 {slug_of(url)}: v1 target_not_registered -> v2 accepted "
                  f"{v2_target} via the structured corrected_identity_candidate field",
                  not problems, "; ".join(problems))
        transitions.append({
            "player_url": url, "action": "corrected",
            "v1_child_state": "target_not_registered", "v1_target": v1_target,
            "v2_child_state": "accepted", "v2_target": v2_target,
            "operator_verdict": row.get("operator_verdict"), "group": row.get("group"),
            "structured_field": v2gen.CORRECTED_TARGET_FIELD,
        })

    for url in sorted(removed_expect):
        rejected_target = removed_expect[url]
        row = verdict_rows.get(url) or {}
        changed = changed_rows.get(url) or {}
        problems = []
        if v1_acc.get(url) != rejected_target:
            problems.append(f"v1 child target {v1_acc.get(url)!r}")
        if v2_wh.get(url) != "different_person_wrong_href":
            problems.append(f"v2 child state {state_map(child).get(url)!r}")
        if p2_wh.get(url) != "different_person_wrong_href":
            problems.append(f"v2 parent state {p2_wh.get(url)!r}")
        if row.get("operator_verdict") != "different_person_wrong_href":
            problems.append(f"verdict {row.get('operator_verdict')!r}")
        try:
            captured, _field = v2gen.captured_href_of(row)
            if captured != rejected_target:
                problems.append(f"structured captured href {captured!r}")
        except base.ToolError as exc:
            problems.append(f"no structured captured href: {exc}")
        if changed.get("action") != "removed_withheld" \
                or changed.get("rejected_afltables_target") != rejected_target \
                or changed.get("v2_afltables_external_id") is not None:
            problems.append(f"reconciliation changed_row {changed!r}")
        rep.check(f"5.8 {slug_of(url)}: v1 accepted {rejected_target} -> v2 withheld "
                  "different_person_wrong_href",
                  not problems, "; ".join(problems))
        transitions.append({
            "player_url": url, "action": "removed_withheld",
            "v1_child_state": "accepted", "v1_target": rejected_target,
            "v2_child_state": "withheld:different_person_wrong_href", "v2_target": None,
            "operator_verdict": row.get("operator_verdict"), "group": row.get("group"),
            "structured_field": None,
        })
    transitions.sort(key=lambda t: url_bytes(t["player_url"]))

    v1_tnr = {u for u, r in v1_wh.items() if r == "target_not_registered"}
    v2_tnr = {u for u, r in v2_wh.items() if r == "target_not_registered"}
    rep.check(f"5.9 v1 target_not_registered == {expect['v1_target_not_registered']} and the "
              f"surviving set is exactly v1 minus the corrected "
              f"({expect['remaining_target_not_registered']} remain withheld)",
              len(v1_tnr) == expect["v1_target_not_registered"]
              and v2_tnr == v1_tnr - set(corrected_expect)
              and len(v2_tnr) == expect["remaining_target_not_registered"],
              f"v1 {len(v1_tnr)}, v2 {len(v2_tnr)}, {_diff(v2_tnr, v1_tnr - set(corrected_expect))}")
    v1_nohref = {u for u, r in v1_wh.items() if r == "U-no-href"}
    v2_nohref = {u for u, r in v2_wh.items() if r == "U-no-href"}
    rep.check(f"5.10 the U-no-href set is unchanged ({expect['u_no_href']})",
              v1_nohref == v2_nohref and len(v2_nohref) == expect["u_no_href"],
              f"v1 {len(v1_nohref)}, v2 {len(v2_nohref)}")
    nine = set(corrected_expect) | set(removed_expect)
    s1 = state_map(child_v1)
    s2 = state_map(child)
    universe = set(s1) | set(s2)
    drift = sorted(u for u in universe - nine if s1.get(u) != s2.get(u))
    rep.check(f"5.11 no other person changed accepted/withheld state or target "
              f"({expect['population'] - len(nine)} persons compared)",
              not drift and len(universe - nine) == expect["population"] - len(nine),
              f"{len(drift)} drifted, e.g. {drift[:5]}; compared {len(universe - nine)}")
    detail = recon.get("child_status_detail") or {}
    pending = detail.get("corrected_parent_targets_pending_db_resolution") or []
    rep.check("5.12 the reconciliation manifest agrees (pending corrected targets, eligible "
              "carry-forward, accepted_v2, changed_rows)",
              set(pending) == set(corrected_expect)
              and detail.get("v1_rows_eligible_for_unchanged_carry_forward") == len(carry)
              and (recon.get("counts") or {}).get("accepted_v2") == len(p2_acc)
              and set(changed_rows) == nine
              and detail.get("v1_resolved_child_sha256") == hashes["child_v1_afldb_test"],
              f"pending {len(pending)}, eligible "
              f"{detail.get('v1_rows_eligible_for_unchanged_carry_forward')!r} vs {len(carry)}, "
              f"accepted_v2 {(recon.get('counts') or {}).get('accepted_v2')!r} vs {len(p2_acc)}, "
              f"changed_rows {len(changed_rows)}")

    # -------------------------------------------------------- 6. registration/time
    rep.section("6. Registration measurement and timestamps")
    reg = child.get("target_registration") or {}
    reg_v1 = child_v1.get("target_registration") or {}
    rep.check(f"6.1 target_registration.count == {expect['registration_count']} and equals "
              "the v1 child's measurement",
              reg.get("count") == expect["registration_count"] == reg_v1.get("count"),
              f"v2 {reg.get('count')!r}, v1 {reg_v1.get('count')!r}")
    gen = parse_utc(child.get("generated_utc"))
    measured = parse_utc(reg.get("measured_at"))
    parent_gen = parse_utc(parent.get("generated_utc"))
    v1_gen = parse_utc(child_v1.get("generated_utc"))
    ordered = bool(gen and measured and parent_gen and v1_gen
                   and abs((measured - gen).total_seconds()) <= MAX_MEASUREMENT_SKEW_SECONDS
                   and gen > parent_gen and gen > v1_gen)
    rep.check("6.2 generated_utc and measured_at are UTC 'Z' timestamps, agree within "
              f"{MAX_MEASUREMENT_SKEW_SECONDS}s, and follow the v2 parent and the v1 child",
              ordered,
              f"generated {child.get('generated_utc')!r}, measured {reg.get('measured_at')!r}, "
              f"parent {parent.get('generated_utc')!r}, v1 child "
              f"{child_v1.get('generated_utc')!r}")
    rep.check("6.3 the v2 parent's frozen generated_utc equals the verdict artefact's "
              "review_completed_utc",
              parent.get("generated_utc") == verdicts.get("review_completed_utc")
              and parse_utc(verdicts.get("review_completed_utc")) is not None,
              f"parent {parent.get('generated_utc')!r}, verdicts "
              f"{verdicts.get('review_completed_utc')!r}")

    # ----------------------------------------------------------------- 7. hygiene
    rep.section("7. Hygiene")
    text = child_bytes.decode("utf-8", errors="replace")
    leaks = [what for pattern, what in v2gen.FORBIDDEN_OUTPUT_PATTERNS if pattern.search(text)]
    rep.check("7.1 no DSN, absolute path, DATABASE_URL name, credential or secret appears",
              not leaks, ", ".join(leaks))
    rep.check("7.2 child bytes are ASCII, LF-only and end with exactly one newline",
              b"\r" not in child_bytes and child_bytes.endswith(b"\n")
              and not child_bytes.endswith(b"\n\n") and child_bytes.isascii())
    rep.check("7.3 child bytes are the exporter's canonical serialisation of their content "
              "(sorted keys, indent 2, ASCII-safe)",
              canonical_bytes(child) == child_bytes)

    summary["counts"] = {
        "population": population,
        "parent_bridges": len(p2_acc),
        "child_bridges": len(v2_acc),
        "child_withheld": len(v2_wh),
        "carry_forward": len(carry),
        "corrected": len(added),
        "removed": len(removed),
        "target_not_registered_v1": len(v1_tnr),
        "target_not_registered_v2": len(v2_tnr),
        "u_no_href": len(v2_nohref),
        "registration_count": reg.get("count"),
    }

    emit("")
    emit("Transition table -- the persons whose child state changed between v1 and v2:")
    emit(f"  {'person':<24} {'v1 child':<44} {'v2 child':<46} verdict")
    for t in transitions:
        v1_desc = (f"{t['v1_child_state']} ({t['v1_target']})"
                   if t["action"] == "corrected" else f"accepted {t['v1_target']}")
        v2_desc = (f"accepted {t['v2_target']}"
                   if t["action"] == "corrected" else t["v2_child_state"])
        emit(f"  {slug_of(t['player_url']):<24} {v1_desc:<44} {v2_desc:<46} "
             f"{t['operator_verdict']}")
    return finish()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--child", default=CHILD_REL,
                    help="repository-relative path of the deployment child to validate")
    ap.add_argument("--expect-sha256", default=EXPECTED_CHILD_SHA256,
                    help="the operator-reported sha256 the child must hash to")
    ap.add_argument("--root", default=str(REPO_ROOT),
                    help="repository root (tests point this at a fixture tree)")
    args = ap.parse_args(argv)
    try:
        summary = validate(Path(args.root), child_rel=args.child,
                           expect_child_sha256=args.expect_sha256)
    except base.ToolError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1
    return 1 if summary["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
