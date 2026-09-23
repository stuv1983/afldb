#!/usr/bin/env python3
"""AFLDB-ISSUE-227 -- DB-free, fail-closed validation of the ISSUE-224 v3 ``afldb_test``
DEPLOYMENT bridge child against its pinned v2 -> v3 lineage.

    python tools/rebuild/draftguru/validate_person_bridge_child_v3.py
    python tools/rebuild/draftguru/validate_person_bridge_child_v3.py --expect-sha256 <hex>

This is a WHOLLY SEPARATE validator from ``validate_person_bridge_child.py`` (the frozen
ISSUE-222 v1 -> v2 validator, unmodified). It encodes the ISSUE-224 v2 -> v3 lineage on its
own terms:

  * the v3 SOURCE-EVIDENCE parent (``draftguru-person-bridge-20260918-v3.json``), which
    ``build_person_bridge_v3_issue224.py`` derives from the v2 parent plus exactly two
    operator-approved parent-evidence corrections (Dean Laidley -> Dani Laidley, Matthew
    Capuano -> Mathew Capuano);
  * the v3 ``afldb_test`` DEPLOYMENT child (``draftguru-person-bridge-20260918-v3.afldb_test.json``),
    produced by ``export_person_bridge.py --resolve-against afldb_test`` against that parent;
  * the ISSUE-224 population-classification artefact (94 rows: 92
    ``genuine_post_baseline_afl_debutant`` / 92 ``rollover_registration_candidate``, plus the 2
    ``captured_href_differs_from_registered_path_same_person`` / ``parent_evidence_correction_
    operator_review`` rows for Laidley and Capuano);
  * the ISSUE-224 operator-decision artefact (94 rows: 92 ``defer-to-rollover``, 2
    ``route-to-parent-evidence-correction``);
  * the v3 reconciliation manifest and its diff CSV (exactly 2 changed bridge rows).

The pinned v1 -> v2 lineage (``validate_person_bridge_child.py``'s own subject) is out of
scope here: this tool's baseline is the v2 parent and the pinned v2 ``afldb_test`` child, not
the v1 artefacts. Its checks are 5.7/5.12-shaped only in the sense that a transition is
proven end to end; the underlying fields (``classification``, ``operator_decision``,
``evidence_reference.registered_path_evidence``/``player_id_evidence``) are the ISSUE-224
chain's own, never the ISSUE-222 verdict schema's ``operator_verdict``/``draftguru_url``/
``corrected_identity_candidate``.

What is proven (every check prints PASS/FAIL; any FAIL is exit status 1):

  1. bytes and pinned lineage (child sha256, every pinned input hash, top-level shape);
  2. identity of the child (kind, target, exporter, parent_sha256 chain, the full v2+v3
     provenance chain);
  3. schema, partition and uniqueness (importer-equivalent schema gate, counts, sort order);
  4. parent containment (every accepted mapping exists identically in the v3 parent; the
     v3 parent's withheld[] is byte-identical to the v2 parent's; the two rejected
     wrong-href targets appear nowhere as an accepted identity);
  5. the exact v2 -> v3 transition (the population-classification and operator-decision
     artefacts, the two parent-evidence corrections end to end, the 92 deferred rollover
     candidates, the two preserved wrong-href removals, that no other person moved, and
     that the reconciliation manifest plus its diff CSV agree);
  6. registration measurement and timestamp ordering;
  7. hygiene (no DSN / absolute path / credential; canonical LF bytes).

The tool READS ONLY. It writes no file, opens no database (no psycopg import, no
``*DATABASE_URL*`` read), performs no network request and never modifies the child, either
parent or any lineage artefact. Two runs over identical inputs print an identical
``summary_sha256``.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]
sys.path.insert(0, str(TOOL_DIR))

import build_person_bridge_v2 as v2gen          # noqa: E402  (DB-free; proven by its own contract)
import review_person_bridge_offline as base    # noqa: E402  (DB-free shared helpers)

TOOL = "tools/rebuild/draftguru/validate_person_bridge_child_v3.py"
TOOL_VERSION = "1.0.0"

EXPORTER = "tools/rebuild/draftguru/export_person_bridge.py"
V3_GENERATOR = "tools/rebuild/draftguru/build_person_bridge_v3_issue224.py"
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

TARGET_LABEL = "afldb_test"

# ---------------------------------------------------------------------------
# Pinned lineage for the 2026-09-19 ISSUE-224 v3 afldb_test child. Every hash below was
# independently computed from the committed bytes, not copied from another tool's constants.
# ---------------------------------------------------------------------------

CHILD_REL = "data/reference/draftguru-person-bridge-20260918-v3.afldb_test.json"
EXPECTED_CHILD_SHA256 = "94aeac74422bea17dbb14913d480055991db4ac79546a2860383e669b5bbdac4"

PINNED_INPUTS: dict[str, tuple[str, str]] = {
    "parent_v2": (
        "data/reference/draftguru-person-bridge-20260918-v2.json",
        "ad25d965cba72b97be895451dc488bf03a1899421e902394baa52a620abe8e57"),
    "child_v2_afldb_test": (
        "data/reference/draftguru-person-bridge-20260918-v2.afldb_test.json",
        "b996c60e9d4de3aeb6f250f360b2a66164a2211b9604338a65918e79fa29e1c5"),
    "issue224_classification": (
        "docs/rebuild-manifests/draftguru/issue224-population-classification-20260919.json",
        "0765392a26624c54a2d2525c8fafd14f9521989b533fb773d3134a934ac74a6a"),
    "issue224_operator_decisions": (
        "docs/rebuild-manifests/draftguru/bridge-operator-verdicts-issue224-20260919-v1.json",
        "3c7b5aff6649047ef0a727feffe4303ac7ea618a6cba3ca4f32b718636875038"),
    "parent_v3": (
        "data/reference/draftguru-person-bridge-20260918-v3.json",
        "1f7413a2ad96e7d026cc521acfdeba3de9cab7066794de99002c9b5928e6e21b"),
    "reconciliation_v3": (
        "docs/rebuild-manifests/draftguru/bridge-v3-reconciliation-issue224-20260919-v1.json",
        "f25a4b5035e25649da8f83be7279a91c623ae8d025a19e6cee693a5fc0abce67"),
    "diff_v3": (
        "docs/rebuild-manifests/draftguru/bridge-v3-diff-issue224-20260919-v1.csv",
        "a311ba6ecfd884d2a41ce39347420aa4520a5a0f42fff7fc0e58327bb981d10a"),
}

_DG = "https://www.draftguru.com.au/players/"

# The two operator-approved parent-evidence corrections: url -> (v2 target, v3 target,
# player_id_evidence), exactly as the classification, operator-decision and reconciliation
# artefacts record them.
CORRECTED: dict[str, tuple[str, str, int]] = {
    _DG + "dean_laidley/1": ("players/D/Dean_Laidley.html", "players/D/Dani_Laidley.html", 3208),
    _DG + "matthew_capuano/1": (
        "players/M/Matthew_Capuano.html", "players/M/Mathew_Capuano.html", 9198),
}

# The two wrong-href removals carried unchanged from v2: never re-admitted by the v3
# correction, which touches only the two URLs above.
REJECTED: dict[str, str] = {
    _DG + "craig_somerville/1": "players/C/Craig_Somerville.html",
    _DG + "david_sullivan/1": "players/D/David_Sullivan.html",
}

EXPECT: dict = {
    "target": TARGET_LABEL,
    "label": "person-html-20260918",
    "population": 5057,
    "parent_bridges": 3562,
    "child_bridges": 3470,
    "child_withheld": 1587,
    "carry_forward": 3468,
    "corrected": CORRECTED,
    "rejected": REJECTED,
    "v2_target_not_registered": 94,
    "remaining_target_not_registered": 92,
    "u_no_href": 1493,
    "registration_count": 13275,
    "classification_rows": 94,
    "classification_debutant": 92,
    "classification_correction": 2,
}


class ValidationError(base.ToolError):
    """A structural refusal: the validation could not even be carried out."""


# ---------------------------------------------------------------------------
# Small helpers (generic; no ISSUE-222/v2-transition-specific semantics)
# ---------------------------------------------------------------------------

def parse_utc(value) -> datetime | None:
    if not isinstance(value, str) or not UTC_RE.match(value):
        return None
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def parse_iso_utc(value) -> datetime | None:
    """A looser ISO-8601 UTC parser for the classification artefact's own timestamp shape
    (fractional seconds, explicit ``+00:00`` offset rather than a literal ``Z``)."""
    if not isinstance(value, str):
        return None
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None or dt.utcoffset() != timedelta(0):
        return None
    return dt.astimezone(timezone.utc)


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


def _rows_by_url(rows: list[dict]) -> tuple[dict[str, dict], list[str]]:
    by_url: dict[str, dict] = {}
    dupes: list[str] = []
    for row in rows:
        url = row.get("player_url")
        if url in by_url:
            dupes.append(url)
        by_url[url] = row
    return by_url, dupes


def _parse_diff_csv(data: bytes) -> list[dict]:
    text = data.decode("utf-8")
    return list(csv.DictReader(io.StringIO(text)))


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
            emit("All ISSUE-224 v3 child-validation checks hold.")
        return summary

    emit(f"AFLDB-ISSUE-227 v3 deployment-child validation ({TOOL} {TOOL_VERSION}) -- read-only")

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

    parent_v2 = base.load_json(root / pinned["parent_v2"][0], "v2 parent")
    child_v2 = base.load_json(root / pinned["child_v2_afldb_test"][0], "v2 afldb_test child")
    classification = base.load_json(root / pinned["issue224_classification"][0],
                                    "ISSUE-224 population classification")
    decisions = base.load_json(root / pinned["issue224_operator_decisions"][0],
                               "ISSUE-224 operator decisions")
    parent_v3 = base.load_json(root / pinned["parent_v3"][0], "v3 parent")
    recon = base.load_json(root / pinned["reconciliation_v3"][0], "v3 reconciliation")
    diff_bytes = (root / pinned["diff_v3"][0]).read_bytes()

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
    recon_parent_v3 = recon.get("parent_v3") or {}
    rep.check("2.5 parent_sha256 equals the pinned v3 parent hash and the reconciliation's",
              child.get("parent_sha256") == hashes["parent_v3"] == recon_parent_v3.get("sha256"),
              f"child {child.get('parent_sha256')!r}, pinned {hashes['parent_v3']!r}, "
              f"reconciliation {recon_parent_v3.get('sha256')!r}")
    supersedes = parent_v3.get("supersedes") or {}
    rep.check("2.6 v3 parent is source-evidence, supersedes the pinned v2 parent, and its "
              "rows_sha256 agrees with the reconciliation's",
              parent_v3.get("kind") == "source-evidence"
              and supersedes.get("path") == pinned["parent_v2"][0]
              and supersedes.get("sha256") == hashes["parent_v2"]
              and parent_v3.get("rows_sha256") == recon_parent_v3.get("rows_sha256"),
              f"kind {parent_v3.get('kind')!r}, supersedes {supersedes!r}, rows_sha256 "
              f"{parent_v3.get('rows_sha256')!r} vs {recon_parent_v3.get('rows_sha256')!r}")

    prov_v2 = parent_v2.get("provenance") or {}
    prov_v3 = parent_v3.get("provenance") or {}
    v3_only_keys = {"v3_generator", "v3_generator_version", "v3_operator_decisions_path",
                    "v3_operator_decisions_sha256", "v3_operator_decisions_rows_sha256"}
    prov_v3_base = {k: v for k, v in prov_v3.items() if k not in v3_only_keys}
    rep.check("2.7 the v3 parent's provenance is the v2 parent's verbatim, plus exactly the "
              "v3 generator/operator-decision hash-links",
              prov_v3_base == prov_v2
              and prov_v3.get("v3_generator") == V3_GENERATOR
              and bool(VERSION_RE.match(str(prov_v3.get("v3_generator_version"))))
              and prov_v3.get("v3_operator_decisions_path") == pinned["issue224_operator_decisions"][0]
              and prov_v3.get("v3_operator_decisions_sha256") == hashes["issue224_operator_decisions"]
              and prov_v3.get("v3_operator_decisions_rows_sha256") == decisions.get("rows_sha256"),
              f"base-diff {_diff(set(prov_v3_base), set(prov_v2))}, v3_generator "
              f"{prov_v3.get('v3_generator')!r}, decisions_sha256 "
              f"{prov_v3.get('v3_operator_decisions_sha256')!r} vs "
              f"{hashes['issue224_operator_decisions']!r}")
    rep.check("2.8 the child's provenance is the v3 parent's provenance verbatim",
              (child.get("provenance") or {}) == prov_v3,
              f"child {child.get('provenance')!r} vs parent {prov_v3!r}")

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
                         "parent_bridges": len(parent_v3.get("bridges", []))},
              f"counts {counts!r}, observed bridges {len(bridges)}, withheld {len(withheld)}, "
              f"parent bridges {len(parent_v3.get('bridges', []))}")
    population = len(bridges) + len(withheld)
    parent_population = len(parent_v3.get("bridges", [])) + len(parent_v3.get("withheld", []))
    rep.check(f"3.4 accepted + withheld == {expect['population']} == parent population; "
              f"parent bridges {expect['parent_bridges']}, child bridges "
              f"{expect['child_bridges']}, child withheld {expect['child_withheld']}",
              population == expect["population"] == parent_population
              and len(parent_v3.get("bridges", [])) == expect["parent_bridges"]
              and len(bridges) == expect["child_bridges"]
              and len(withheld) == expect["child_withheld"],
              f"population {population}, parent population {parent_population}, parent "
              f"bridges {len(parent_v3.get('bridges', []))}, bridges {len(bridges)}, withheld "
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
    v3_acc = bridge_map(child)
    v3_wh = withheld_map(child)
    p3_acc = bridge_map(parent_v3)
    p3_wh = withheld_map(parent_v3)
    mismatched = sorted(u for u, i in v3_acc.items() if p3_acc.get(u) != i)
    rep.check("4.1 every accepted child mapping exists identically in the v3 parent",
              not mismatched, f"{len(mismatched)} mismatched, e.g. {mismatched[:5]}")
    target_withheld = {u for u, r in v3_wh.items() if r in TARGET_WITHHELD_REASONS}
    parent_minus_child = set(p3_acc) - set(v3_acc)
    rep.check("4.2 v3 parent bridges minus v3 child bridges is exactly the child's "
              "target-withheld set",
              parent_minus_child == target_withheld, _diff(parent_minus_child, target_withheld))
    carried = {u: r for u, r in v3_wh.items() if u in p3_wh}
    rep.check("4.3 the v3 parent's withheld rows are carried verbatim (url and reason) into "
              "the child",
              carried == p3_wh and all(r in PARENT_WITHHELD_REASONS for r in p3_wh.values()),
              f"{len(carried)} carried of {len(p3_wh)} parent withheld; reasons "
              f"{sorted(set(p3_wh.values()))}")
    parent_population_urls = set(p3_acc) | set(p3_wh)
    outside = sorted(set(v3_wh) - parent_population_urls)
    rep.check("4.4 every child-withheld person belongs to the v3 parent population",
              not outside, f"{len(outside)} outside, e.g. {outside[:5]}")
    rejected_targets = set(expect["rejected"].values())
    rep.check("4.5 neither rejected wrong-href target appears among the accepted identities "
              "of the child or of the v3 parent",
              not (rejected_targets & set(v3_acc.values()))
              and not (rejected_targets & set(p3_acc.values())),
              f"child hits {sorted(rejected_targets & set(v3_acc.values()))}, parent hits "
              f"{sorted(rejected_targets & set(p3_acc.values()))}")
    rep.check("4.6 the v3 parent's withheld[] is byte-identical to the v2 parent's (Phase 4 "
              "forbids any withheld[] change)",
              parent_v3.get("withheld") == parent_v2.get("withheld"))

    # -------------------------------------------------------------- 5. transition
    rep.section("5. Transition from the pinned v2 afldb_test child")
    v2_acc = bridge_map(child_v2)
    v2_wh = withheld_map(child_v2)
    p2_acc = bridge_map(parent_v2)
    rep.check("5.1 the pinned v2 child is the afldb_test deployment of the pinned v2 parent",
              child_v2.get("kind") == "deployment"
              and child_v2.get("target") == TARGET_LABEL
              and child_v2.get("parent_sha256") == hashes["parent_v2"],
              f"kind {child_v2.get('kind')!r}, target {child_v2.get('target')!r}, "
              f"parent_sha256 {child_v2.get('parent_sha256')!r}")

    carry = {u for u, i in v3_acc.items() if v2_acc.get(u) == i}
    changed_in_place = sorted(u for u, i in v3_acc.items() if u in v2_acc and v2_acc[u] != i)
    added = set(v3_acc) - set(v2_acc)
    removed = set(v2_acc) - set(v3_acc)
    corrected_expect = dict(expect["corrected"])
    rep.check(f"5.2 exactly {expect['carry_forward']} v2-child mappings carry forward "
              "unchanged into v3",
              len(carry) == expect["carry_forward"] == len(v2_acc), f"observed {len(carry)}")
    rep.check("5.3 no v2-accepted person changed target in place",
              not changed_in_place, f"{changed_in_place[:5]}")
    rep.check(f"5.4 the persons newly accepted in v3 are exactly the {len(corrected_expect)} "
              "parent-evidence corrections",
              added == set(corrected_expect), _diff(added, set(corrected_expect)))
    rep.check("5.5 no person is newly removed from accepted between v2 and v3",
              not removed, f"{sorted(removed)[:5]}")

    class_rows = classification.get("rows") or []
    class_by_url, class_dupes = _rows_by_url(class_rows)
    debutant = [r for r in class_rows if r.get("classification") == "genuine_post_baseline_afl_debutant"]
    correction_class = [r for r in class_rows
                        if r.get("classification") == "captured_href_differs_from_registered_path_same_person"]
    class_rows_sha = base.sha256_bytes(base.canonical_json_bytes(class_rows))
    rep.check(f"5.6 the ISSUE-224 classification artefact carries exactly "
              f"{expect['classification_rows']} rows ({expect['classification_debutant']} "
              f"genuine_post_baseline_afl_debutant/rollover_registration_candidate, "
              f"{expect['classification_correction']} "
              "captured_href_differs_from_registered_path_same_person/"
              "parent_evidence_correction_operator_review), no duplicate player_url, "
              "rows_sha256 reproduces",
              len(class_rows) == expect["classification_rows"] and not class_dupes
              and len(debutant) == expect["classification_debutant"]
              and all(r.get("route") == "rollover_registration_candidate" for r in debutant)
              and len(correction_class) == expect["classification_correction"]
              and all(r.get("route") == "parent_evidence_correction_operator_review"
                      for r in correction_class)
              and classification.get("rows_sha256") == class_rows_sha,
              f"rows {len(class_rows)}, dupes {class_dupes[:3]}, debutant {len(debutant)}, "
              f"correction {len(correction_class)}, rows_sha256 "
              f"{classification.get('rows_sha256')!r} vs {class_rows_sha!r}")

    dec_rows = decisions.get("rows") or []
    dec_by_url, dec_dupes = _rows_by_url(dec_rows)
    dec_rows_sha = base.sha256_bytes(base.canonical_json_bytes(dec_rows))
    dec_totals = decisions.get("totals") or {}
    expect_totals = {
        "rows": expect["classification_rows"],
        "defer_to_rollover": expect["classification_debutant"],
        "route_to_parent_evidence_correction": expect["classification_correction"],
        "register": 0, "route_to_issue_136": 0, "reject": 0, "unresolved": 0,
    }
    # The whole-file sha256 and the content-identity rows_sha256 are complementary
    # invariants, not alternatives: source_adjudication_pack must name the classification
    # artefact's own pinned path and hash to the pinned whole-file sha256 (proving the
    # decisions were adjudicated against exactly this artefact's bytes), AND its
    # rows_sha256 (together with source_hash_links.phase2_classification_rows_sha256) must
    # match the classification artefact's own recomputed rows_sha256 (proving the adjudicated
    # content itself matches). Neither substitutes for the other.
    pack = decisions.get("source_adjudication_pack") or {}
    rep.check(f"5.7 the ISSUE-224 operator-decision artefact carries exactly "
              f"{expect['classification_rows']} rows hash-linked to the classification "
              "artefact by both its whole-file sha256 and its rows_sha256, totals "
              f"{expect['classification_debutant']} defer-to-rollover / "
              f"{expect['classification_correction']} route-to-parent-evidence-correction / "
              "zero elsewhere, completion_status complete, rows_sha256 reproduces, no "
              "duplicate player_url",
              len(dec_rows) == expect["classification_rows"] and not dec_dupes
              and dec_totals == expect_totals
              and decisions.get("completion_status") == "complete"
              and decisions.get("rows_sha256") == dec_rows_sha
              and pack.get("path") == pinned["issue224_classification"][0]
              and pack.get("sha256") == hashes["issue224_classification"]
              and pack.get("rows_sha256") == class_rows_sha
              and (decisions.get("source_hash_links") or {}).get("phase2_classification_rows_sha256")
                  == class_rows_sha,
              f"rows {len(dec_rows)}, dupes {dec_dupes[:3]}, totals {dec_totals!r}, "
              f"completion {decisions.get('completion_status')!r}, rows_sha256 "
              f"{decisions.get('rows_sha256')!r} vs {dec_rows_sha!r}, source_adjudication_pack "
              f"{pack!r} vs path {pinned['issue224_classification'][0]!r} / sha256 "
              f"{hashes['issue224_classification']!r}")

    recon_changed = {r.get("player_url"): r for r in (recon.get("changed_rows") or [])}
    for url in sorted(corrected_expect):
        v2_target, v3_target, player_id = corrected_expect[url]
        crow = class_by_url.get(url) or {}
        drow = dec_by_url.get(url) or {}
        ev = drow.get("evidence_reference") or {}
        rrow = recon_changed.get(url) or {}
        problems: list[str] = []
        if v2_wh.get(url) != "target_not_registered":
            problems.append(f"v2 child state {state_map(child_v2).get(url)!r}")
        if p2_acc.get(url) != v2_target:
            problems.append(f"v2 parent target {p2_acc.get(url)!r}")
        if v3_acc.get(url) != v3_target:
            problems.append(f"v3 child target {v3_acc.get(url)!r}")
        if p3_acc.get(url) != v3_target:
            problems.append(f"v3 parent target {p3_acc.get(url)!r}")
        if crow.get("classification") != "captured_href_differs_from_registered_path_same_person" \
                or crow.get("afltables_external_id") != v2_target \
                or crow.get("registered_path_evidence") != v3_target \
                or crow.get("player_id_evidence") != player_id:
            problems.append(f"classification row {crow!r}")
        if drow.get("operator_decision") != "route-to-parent-evidence-correction" \
                or drow.get("afltables_external_id") != v2_target \
                or ev.get("registered_path_evidence") != v3_target \
                or ev.get("player_id_evidence") != player_id:
            problems.append(f"operator decision row {drow!r}")
        if rrow.get("v2_afltables_external_id") != v2_target \
                or rrow.get("v3_afltables_external_id") != v3_target \
                or rrow.get("player_id_evidence") != player_id \
                or rrow.get("operator_decision") != "route-to-parent-evidence-correction":
            problems.append(f"reconciliation changed_row {rrow!r}")
        rep.check(f"5.8 {slug_of(url)}: v2 target_not_registered -> v3 accepted {v3_target} "
                  "via the parent-evidence correction chain",
                  not problems, "; ".join(problems))
        transitions.append({
            "player_url": url, "action": "corrected",
            "v2_child_state": "target_not_registered", "v2_target": v2_target,
            "v3_child_state": "accepted", "v3_target": v3_target,
            "player_id_evidence": player_id,
        })
    transitions.sort(key=lambda t: url_bytes(t["player_url"]))

    v2_tnr = {u for u, r in v2_wh.items() if r == "target_not_registered"}
    v3_tnr = {u for u, r in v3_wh.items() if r == "target_not_registered"}
    deferred_class = {r["player_url"] for r in debutant}
    deferred_decisions = {u for u, r in dec_by_url.items() if r.get("operator_decision") == "defer-to-rollover"}
    rep.check(f"5.9 v2 target_not_registered == {expect['v2_target_not_registered']}, the "
              f"deferred set is exactly the classification/decision "
              f"defer-to-rollover set, and {expect['remaining_target_not_registered']} remain "
              "target_not_registered unchanged in both v2 and v3",
              len(v2_tnr) == expect["v2_target_not_registered"]
              and deferred_class == deferred_decisions
              and v2_tnr - set(corrected_expect) == deferred_class
              and v3_tnr == deferred_class
              and len(v3_tnr) == expect["remaining_target_not_registered"],
              f"v2 {len(v2_tnr)}, v3 {len(v3_tnr)}, class {len(deferred_class)}, decisions "
              f"{len(deferred_decisions)}, {_diff(v3_tnr, deferred_class)}")
    v2_nohref = {u for u, r in v2_wh.items() if r == "U-no-href"}
    v3_nohref = {u for u, r in v3_wh.items() if r == "U-no-href"}
    rep.check(f"5.10 the U-no-href set is unchanged ({expect['u_no_href']})",
              v2_nohref == v3_nohref and len(v3_nohref) == expect["u_no_href"],
              f"v2 {len(v2_nohref)}, v3 {len(v3_nohref)}")

    rejected_expect = dict(expect["rejected"])
    v2p_wh = withheld_map(parent_v2)
    problems = []
    for url, rejected_target in rejected_expect.items():
        if v2_wh.get(url) != "different_person_wrong_href" \
                or v3_wh.get(url) != "different_person_wrong_href" \
                or p2_acc.get(url) is not None or p3_acc.get(url) is not None \
                or v2p_wh.get(url) != "different_person_wrong_href" \
                or p3_wh.get(url) != "different_person_wrong_href":
            problems.append(f"{slug_of(url)}: v2 child {state_map(child_v2).get(url)!r}, "
                            f"v3 child {state_map(child).get(url)!r}")
    rep.check("5.11 Craig Somerville and David Sullivan remain withheld as "
              "different_person_wrong_href in the v2 parent/child and the v3 parent/child, "
              "and neither rejected identity re-enters as accepted anywhere",
              not problems, "; ".join(problems))

    moved = set(corrected_expect)
    s2 = state_map(child_v2)
    s3 = state_map(child)
    universe = set(s2) | set(s3)
    drift = sorted(u for u in universe - moved if s2.get(u) != s3.get(u))
    rep.check(f"5.12 no other person outside the {len(moved)} corrected persons changed "
              f"accepted/withheld state or target between v2 and v3 "
              f"({expect['population'] - len(moved)} persons compared)",
              not drift and len(universe - moved) == expect["population"] - len(moved),
              f"{len(drift)} drifted, e.g. {drift[:5]}; compared {len(universe - moved)}")

    recon_counts = recon.get("counts") or {}
    recon_invariants = recon.get("invariants") or {}
    diff_report = recon.get("diff_report") or {}
    phase3 = recon.get("phase3_decisions") or {}
    parent_v2_block = recon.get("parent_v2") or {}
    rep.check("5.13 the v3 reconciliation manifest agrees end to end: parent/decisions/"
              "parent_v3/diff hash-links, changed_rows exactly the 2 corrections, matching "
              "counts, and every invariant PASS with database/network access NOT_PERFORMED",
              parent_v2_block.get("sha256") == hashes["parent_v2"]
              and phase3.get("sha256") == hashes["issue224_operator_decisions"]
              and phase3.get("rows_sha256") == dec_rows_sha
              and recon_parent_v3.get("sha256") == hashes["parent_v3"]
              and diff_report.get("sha256") == hashes["diff_v3"]
              and diff_report.get("changed_rows") == len(corrected_expect)
              and {r.get("player_url") for r in (recon.get("changed_rows") or [])}
                  == set(corrected_expect)
              and recon_counts.get("bridges") == expect["parent_bridges"]
              and recon_counts.get("withheld") == len(parent_v3.get("withheld", []))
              and recon_counts.get("population") == expect["population"]
              and recon_counts.get("changed_bridges") == len(corrected_expect)
              and recon_counts.get("changed_withheld") == 0
              and all(v == "PASS" for k, v in recon_invariants.items()
                      if k not in ("database_access", "network_access"))
              and recon_invariants.get("database_access") == "NOT_PERFORMED"
              and recon_invariants.get("network_access") == "NOT_PERFORMED",
              f"parent_v2 {parent_v2_block!r}, phase3 {phase3!r}, parent_v3 {recon_parent_v3!r}, "
              f"diff_report {diff_report!r}, counts {recon_counts!r}, invariants "
              f"{recon_invariants!r}")

    diff_rows = _parse_diff_csv(diff_bytes)
    diff_set = {(r.get("player_url"), r.get("v2_afltables_external_id"),
                r.get("v3_afltables_external_id"), r.get("operator_decision"),
                r.get("player_id_evidence")) for r in diff_rows}
    expect_diff_set = {(url, v2_target, v3_target, "route-to-parent-evidence-correction",
                        str(player_id))
                       for url, (v2_target, v3_target, player_id) in corrected_expect.items()}
    rep.check("5.14 the diff CSV rows reproduce the reconciliation manifest's changed_rows "
              "exactly",
              diff_set == expect_diff_set, _diff(diff_set, expect_diff_set))

    # -------------------------------------------------------- 6. registration/time
    rep.section("6. Registration measurement and timestamps")
    reg = child.get("target_registration") or {}
    reg_v2 = child_v2.get("target_registration") or {}
    rep.check(f"6.1 target_registration.count == {expect['registration_count']} and equals "
              "the pinned v2 afldb_test child's own measurement",
              reg.get("count") == expect["registration_count"] == reg_v2.get("count"),
              f"v3 {reg.get('count')!r}, v2 {reg_v2.get('count')!r}")
    gen_v3_child = parse_utc(child.get("generated_utc"))
    measured = parse_utc(reg.get("measured_at"))
    gen_v3_parent = parse_utc(parent_v3.get("generated_utc"))
    gen_v2_child = parse_utc(child_v2.get("generated_utc"))
    gen_v2_parent = parse_utc(parent_v2.get("generated_utc"))
    ordered = bool(gen_v3_child and measured and gen_v3_parent and gen_v2_child and gen_v2_parent
                   and abs((measured - gen_v3_child).total_seconds()) <= MAX_MEASUREMENT_SKEW_SECONDS
                   and gen_v3_child > gen_v3_parent > gen_v2_child > gen_v2_parent)
    rep.check("6.2 generated_utc and measured_at are UTC 'Z' timestamps, agree within "
              f"{MAX_MEASUREMENT_SKEW_SECONDS}s, and strictly follow v3 parent > v2 child > "
              "v2 parent",
              ordered,
              f"v3 child {child.get('generated_utc')!r}, measured {reg.get('measured_at')!r}, "
              f"v3 parent {parent_v3.get('generated_utc')!r}, v2 child "
              f"{child_v2.get('generated_utc')!r}, v2 parent {parent_v2.get('generated_utc')!r}")
    class_gen = parse_iso_utc(classification.get("generated_utc"))
    decisions_completed = parse_utc(decisions.get("review_completed_utc"))
    rep.check("6.3 the v3 parent's frozen generated_utc equals the operator-decision "
              "artefact's review_completed_utc and the reconciliation manifest's "
              "generated_utc, and the classification artefact's own generated_utc precedes it",
              parent_v3.get("generated_utc") == decisions.get("review_completed_utc")
              == recon.get("generated_utc") and decisions_completed is not None
              and class_gen is not None and class_gen < decisions_completed,
              f"parent_v3 {parent_v3.get('generated_utc')!r}, decisions "
              f"{decisions.get('review_completed_utc')!r}, reconciliation "
              f"{recon.get('generated_utc')!r}, classification {classification.get('generated_utc')!r}")

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
        "parent_bridges": len(p3_acc),
        "child_bridges": len(v3_acc),
        "child_withheld": len(v3_wh),
        "carry_forward": len(carry),
        "corrected": len(added),
        "removed": len(removed),
        "target_not_registered_v2": len(v2_tnr),
        "target_not_registered_v3": len(v3_tnr),
        "u_no_href": len(v3_nohref),
        "registration_count": reg.get("count"),
    }

    emit("")
    emit("Transition table -- the persons whose child state changed between v2 and v3:")
    emit(f"  {'person':<24} {'v2 child':<30} {'v3 child':<30} player_id_evidence")
    for t in transitions:
        emit(f"  {slug_of(t['player_url']):<24} "
             f"target_not_registered ({t['v2_target']}) {t['v3_target']:<30} "
             f"{t['player_id_evidence']}")
    return finish()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--child", default=CHILD_REL,
                    help="repository-relative path of the v3 afldb_test deployment child to "
                         "validate (defaults to the pinned artefact)")
    ap.add_argument("--expect-sha256", default=EXPECTED_CHILD_SHA256,
                    help="the operator-reported sha256 the child must hash to (defaults to "
                         "the pinned value)")
    ap.add_argument("--root", default=str(REPO_ROOT),
                    help="repository root (tests point this at a fixture tree)")
    args = ap.parse_args(argv)
    root = Path(args.root)
    try:
        summary = validate(root, child_rel=args.child, expect_child_sha256=args.expect_sha256)
    except base.ToolError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1
    return 1 if summary["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
