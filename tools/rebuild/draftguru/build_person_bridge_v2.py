#!/usr/bin/env python3
"""AFLDB-ISSUE-222 -- deterministic, DB-free generation of the corrected bridge v2
SOURCE-EVIDENCE parent dataset from the completed operator adjudication.

    python tools/rebuild/draftguru/build_person_bridge_v2.py --validate-only
    python tools/rebuild/draftguru/build_person_bridge_v2.py --write

What this tool is
-----------------
The Phase 3 operator adjudication of the 83-row pack
(`bridge-operator-adjudication-pack-20260918-v1.json`) is COMPLETE and independently
validated (AFLDB-ISSUE-222.md §11.13). This module applies those completed verdicts --
and nothing else -- to the frozen v1 source-evidence parent bridge, producing a new,
immutable, versioned v2 parent plus a reconciliation manifest, a withheld/rejection
manifest and human-readable views.

What this tool is NOT
---------------------
It does NOT produce `…-v2.afldb_test.json`. In this repository the ".<target>.json"
sibling is a *deployment* dataset, defined (runbook §4.5) as "the parent's bridges[]
minus every identity not registered exactly once on that target" -- it is by definition
the output of `export_person_bridge.py --resolve-against afldb_test`, which reads the
target database. Seven of the adjudicated rows change their AFL Tables target, so the
v2 child's contents genuinely change and can only be decided by rerunning that
resolution. Generating a child here would either fabricate a database fact or create a
second resolution authority; both are refused. The reconciliation manifest therefore
records `child_status = "requires --resolve-against afldb_test"` together with lineage
planning figures only.

There is also no event-level ("child event") bridge artefact in this repository: the
bridge is keyed on the DraftGuru person URL, so a person's several Stage A draft/listing
events already collapse onto exactly one bridge row by construction. That collapse is
verified here as an invariant (see `check_event_reconciliation`), not written as a file.

Authority and precedence (runbook / task contract)
--------------------------------------------------
  1. the explicit completed operator verdict;
  2. the STRUCTURED proposed/retained target evidence carried on the adjudication row
     (`evidence.captured_afltables_href` / `evidence.captured_href` /
     `evidence.corrected_identity_candidate`);
  3. the existing verified v1 bridge lineage;
  4. machine classification -- only where no human decision is required.

`operator_notes` is PROVENANCE ONLY. It is copied verbatim into the manifests and is
never parsed, scanned or pattern-matched for a target. A URL pasted into free text, a
player-name equality, an event-club relationship and a machine classification are all
non-authorities here (D-9). The event-club fields
(`no_senior_appearance_ever` / `pre_event_only` / `post_event_appearance`) are preserved
as review provenance and never change player identity or generate a playing statistic.

Determinism
-----------
Every artefact is byte-reproducible. No wall-clock value is written anywhere: the
`generated_utc` recorded in each output is FROZEN to the operator verdict artefact's own
`review_completed_utc`, and `generated_utc_basis` says so explicitly. Content-addressed
`rows_sha256` values accompany every output, matching the existing
`scan_person_bridge_population.py` / `review_person_bridge_offline.py` convention.

Safety
------
NEVER connects to a database (no psycopg import, no *DATABASE_URL* read), NEVER performs
a network request (no socket/urllib/requests/http.client use), NEVER runs an importer,
NEVER modifies the v1 parent, the v1 child, the immutable 997-row sample, the
adjudication pack or the completed operator verdict artefacts -- every one of them is
re-hashed before and after the run and the run fails closed on any difference. Outputs
are written atomically as LF bytes and an existing non-identical v2 artefact is never
overwritten.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]
sys.path.insert(0, str(TOOL_DIR))

# review_person_bridge_offline is the existing DB-free/offline review tool; only its
# small hashing/serialisation helpers and its ToolError refusal type are used here, so
# the two tools cannot drift on canonical bytes. It carries no database or network
# surface (asserted by this module's contract test).
import review_person_bridge_offline as base  # noqa: E402

TOOL = "tools/rebuild/draftguru/build_person_bridge_v2.py"
TOOL_VERSION = "1.0.0"

BRIDGE_SCHEMA_VERSION = 1          # importer load_bridge() schema -- unchanged
RECONCILIATION_SCHEMA_VERSION = 1
WITHHELD_SCHEMA_VERSION = 1

CONTRACT_PATH = "tools/rebuild/draftguru/draftguru-contract.json"
AFLTABLES_PATH_RE = re.compile(r"^players/[A-Za-z]/[^/]+\.html$")

CHILD_STATUS = "requires --resolve-against afldb_test"

# ---------------------------------------------------------------------------
# Pinned immutable inputs (repository-relative path, expected sha256).
# Every one is verified before anything is computed and re-verified after the run.
# ---------------------------------------------------------------------------

PINNED_INPUTS: dict[str, tuple[str, str]] = {
    "operator_verdicts_json": (
        "docs/rebuild-manifests/draftguru/bridge-operator-verdicts-20260918-v1.json",
        "b2ae2f4022cd3c22e91bfe6e399538949c02fe8cada95b5c355e6516c82a8822"),
    "operator_verdicts_csv": (
        "docs/rebuild-manifests/draftguru/bridge-operator-verdicts-20260918-v1.csv",
        "a74c6f185030cba3d58bd54b755eae14db3a006ad45ade19ec0f5bd8eaf17267"),
    "operator_verdicts_md": (
        "docs/rebuild-manifests/draftguru/bridge-operator-verdicts-20260918-v1.md",
        "60c529df55313099f85b52af977512fa4fed8f5076fb7ce7263d04e2c05732c0"),
    "adjudication_pack_json": (
        "docs/rebuild-manifests/draftguru/bridge-operator-adjudication-pack-20260918-v1.json",
        "02d0cbe995b4482cf249fe216a10da18b325de6dfcb0504df2d3dbcba31ae292"),
    "parent_v1": (
        "data/reference/draftguru-person-bridge-20260918-v1.json",
        "92ff142ef71d175046b4949b0a85d5925bc396d3586b5b1fc3f44e51f097320e"),
    "child_v1_afldb_test": (
        "data/reference/draftguru-person-bridge-20260918-v1.afldb_test.json",
        "596bbb684424b40f43c22368f1b77aa4198eec8b56a1109a7bb587c5c7a9a27f"),
    "review_sample_v1": (
        "docs/rebuild-manifests/draftguru/bridge-review-20260918-v1.json",
        "036cc0826428c03a622448d299b803c23bac011bd5cd92eea86c4283e445ba84"),
    "stage_a_rows": (
        "data/sources/draftguru/annual-html-20260826/parsed/rows.jsonl",
        "06936baca3b37133949847e7589008a06be76bbc8f1fb5b4d2fef8b743838a64"),
}

# Inputs that must remain byte-identical across the whole run (task boundary:
# "Source v1 bridges, adjudication pack and operator outputs remain byte-identical").
IMMUTABLE_INPUT_KEYS = tuple(PINNED_INPUTS)

OUTPUTS: dict[str, str] = {
    "parent_v2": "data/reference/draftguru-person-bridge-20260918-v2.json",
    "parent_csv": "docs/rebuild-manifests/draftguru/bridge-v2-parent-20260918-v1.csv",
    "reconciliation": "docs/rebuild-manifests/draftguru/bridge-v2-reconciliation-20260918-v1.json",
    "withheld_json": "docs/rebuild-manifests/draftguru/bridge-v2-withheld-20260918-v1.json",
    "withheld_csv": "docs/rebuild-manifests/draftguru/bridge-v2-withheld-20260918-v1.csv",
    "summary_md": "docs/rebuild-manifests/draftguru/bridge-v2-summary-20260918-v1.md",
}

# ---------------------------------------------------------------------------
# Verdict vocabulary (tools/rebuild/draftguru/README.md §5) and the single action
# each completed verdict authorises.
# ---------------------------------------------------------------------------

ACTION_UNCHANGED = "unchanged"    # no operator verdict touched this row
ACTION_CONFIRMED = "confirmed"    # verdict confirmed the existing mapping; content identical
ACTION_CORRECTED = "corrected"    # verdict replaced the target with a structured corrected one
ACTION_ADDED = "added"            # verdict promoted a previously withheld row
ACTION_WITHHELD = "removed_withheld"

VERDICT_ACTION: dict[str, str] = {
    "same_person_valid_relisting": ACTION_CONFIRMED,
    "same_person_valid_href": ACTION_CONFIRMED,
    "agree": ACTION_CONFIRMED,
    "approve_manual_curation": ACTION_CORRECTED,
    "different_person_wrong_href": ACTION_WITHHELD,
}

POSITIVE_VERDICTS = frozenset(
    v for v, a in VERDICT_ACTION.items() if a in (ACTION_CONFIRMED, ACTION_CORRECTED, ACTION_ADDED))
NEGATIVE_VERDICTS = frozenset(v for v, a in VERDICT_ACTION.items() if a == ACTION_WITHHELD)

# Verdicts the operator could legitimately have recorded but which this generator has no
# rule for; any occurrence is a hard refusal, never a silent skip.
UNCERTAIN_VERDICTS = frozenset({
    "undetermined_withhold", "undetermined", "contradict", "reject_candidate",
})

ALLOWED_VERDICTS_BY_GROUP: dict[str, frozenset[str]] = {
    "relisting": frozenset({"same_person_valid_relisting", "different_person_wrong_href",
                            "undetermined_withhold"}),
    "tokenisation": frozenset({"same_person_valid_href", "different_person_wrong_href",
                               "undetermined_withhold"}),
    "discrepancy": frozenset({"approve_manual_curation", "reject_candidate",
                              "undetermined_withhold"}),
    "audit": frozenset({"agree", "contradict", "undetermined"}),
}

# The one structured field each group carries the ALREADY-VERIFIED v1 target in. Both
# names occur in the completed artefact; exactly one must be present on any row.
CAPTURED_HREF_FIELDS = ("captured_afltables_href", "captured_href")
CORRECTED_TARGET_FIELD = "corrected_identity_candidate"

# Event-club review provenance, preserved verbatim and never acted on.
EVENT_CLUB_FIELDS = (
    "event_club",
    "event_club_appearance_relationship_derived",
    "event_club_appearance_relationship_message",
    "event_club_observation",
    "event_club_observation_notes",
)

# ---------------------------------------------------------------------------
# Expected completed-adjudication shape. Any difference is a refusal.
# ---------------------------------------------------------------------------

EXPECT_DECISION_TOTAL = 83
EXPECT_POSITIVE_TOTAL = 81
EXPECT_NEGATIVE_TOTAL = 2
EXPECT_UNCERTAIN_TOTAL = 0

EXPECT_BY_VERDICT = {
    "same_person_valid_relisting": 42,
    "same_person_valid_href": 2,
    "approve_manual_curation": 7,
    "agree": 30,
    "different_person_wrong_href": 2,
}

EXPECT_BY_GROUP = {"relisting": 44, "tokenisation": 2, "discrepancy": 7, "audit": 30}

EXPECT_WITHHELD_URLS = (
    "https://www.draftguru.com.au/players/craig_somerville/1",
    "https://www.draftguru.com.au/players/david_sullivan/1",
)

# The seven structured corrected targets. These are NOT the authority -- each row's own
# evidence.corrected_identity_candidate is -- but the resulting set must equal this
# expectation exactly, so an unexpected extra or missing correction fails closed.
EXPECT_CORRECTED_TARGETS = {
    "https://www.draftguru.com.au/players/aaron_black/1": "players/A/Aaron_Black0.html",
    "https://www.draftguru.com.au/players/alwyn_davey/1": "players/A/Alwyn_Davey0.html",
    "https://www.draftguru.com.au/players/joel_smith/1": "players/J/Joel_Smith0.html",
    "https://www.draftguru.com.au/players/josh_smith/1": "players/J/Josh_Smith0.html",
    "https://www.draftguru.com.au/players/sam_butler/1": "players/S/Sam_Butler0.html",
    "https://www.draftguru.com.au/players/tom_murphy/1": "players/T/Tom_Murphy0.html",
    "https://www.draftguru.com.au/players/stephen_schwerdt/1": "players/S/Stephen_Schwerdt.html",
}

EXPECT_PARENT_V1_BRIDGES = 3564
EXPECT_PARENT_V1_WITHHELD = 1493
EXPECT_PARENT_V2_BRIDGES = 3562
EXPECT_PARENT_V2_WITHHELD = 1495
EXPECT_POPULATION = 5057
EXPECT_CHILD_V1_BRIDGES = 3463
EXPECT_STAGE_A_EVENTS = 6810

# Absolute-path / credential screen. draftguru.com.au, afltables.com and wikipedia.org
# URLs are legitimate content; a DSN, an env var name carrying one, a Windows drive path
# or a POSIX home path is not.
#
# A local Windows path has to be caught in BOTH forms this tool actually emits: the raw
# form a CSV or Markdown view carries (``C:\dir\file``) and the backslash-doubled form a
# JSON view carries once json.dumps() has escaped it (``C:\\dir\\file``). Screening only
# the raw form left every JSON artefact unscreened, so one or two separators are accepted.
# Two guards keep the broadened pattern off legitimate content:
#   * the lookbehind rejects a URL scheme -- the ``s:/`` inside ``https://`` is preceded by
#     a letter, an operator-pasted ``C:/`` or ``C:\`` never is;
#   * the lookahead rejects a JSON ``\uXXXX`` escape -- source text such as the Stage A
#     award string ``B&F:\u00a01983`` is an escaped non-breaking space, not a drive path.
# The drive pattern is listed before the UNC pattern so an escaped drive path (which also
# contains ``\\``) is reported as what it is.
WINDOWS_DRIVE_PATH_RE = re.compile(
    r"(?<![A-Za-z0-9])[A-Za-z]:(?:\\{2}|\\(?!u[0-9A-Fa-f]{4})|/)")
WINDOWS_UNC_PATH_RE = re.compile(r"\\{2,4}[A-Za-z0-9._-]+\\{1,2}[A-Za-z0-9._$-]")

FORBIDDEN_OUTPUT_PATTERNS = (
    (re.compile(r"postgres(?:ql)?://", re.I), "a PostgreSQL DSN"),
    (WINDOWS_DRIVE_PATH_RE, "an absolute Windows path"),
    (WINDOWS_UNC_PATH_RE, "a UNC network path"),
    (re.compile(r"(?<![\w.])/(?:home|Users|root|mnt|var)/"), "an absolute POSIX path"),
    (re.compile(r"DATABASE_URL"), "a database environment variable name"),
    (re.compile(r"\bpass(?:word|wd)\s*[=:]", re.I), "a credential assignment"),
    (re.compile(r"\b(?:secret|api[_-]?key|token)\s*[=:]\s*\S", re.I), "a secret assignment"),
)


class BuildError(base.ToolError):
    """A refusal. Always fails closed; nothing is written."""


# ---------------------------------------------------------------------------
# Input loading and hash pinning
# ---------------------------------------------------------------------------

def hash_inputs(root: Path, *, expected: dict[str, tuple[str, str]]) -> dict[str, str]:
    """Hash every pinned input, refusing on a missing file or any hash mismatch."""
    observed: dict[str, str] = {}
    for key, (rel, want) in expected.items():
        path = root / rel
        if not path.is_file():
            raise BuildError(f"missing pinned input {key}: {rel}")
        got = base.sha256_file(path)
        if got != want:
            raise BuildError(
                f"pinned input {key} ({rel}) sha256 mismatch -- expected {want}, observed {got}. "
                "An immutable input changed; nothing was computed or written.")
        observed[key] = got
    return observed


def load_canonical_url_regex(root: Path) -> re.Pattern:
    contract_path = root / CONTRACT_PATH
    contract = base.load_json(contract_path, "DraftGuru contract")
    try:
        return re.compile(contract["canonical_player_url"]["regex"])
    except KeyError as exc:
        raise BuildError(f"contract carries no canonical_player_url.regex: {exc}") from exc


# ---------------------------------------------------------------------------
# load_bridge() schema self-check -- a local reimplementation of the importer's own
# schema gate. import_draftguru.py is deliberately NOT imported (it carries a database
# surface); export_person_bridge.py set this precedent for the same reason.
# ---------------------------------------------------------------------------

def self_validate_bridge_schema(doc: dict, url_re: re.Pattern) -> None:
    if doc.get("schema_version") != BRIDGE_SCHEMA_VERSION:
        raise BuildError("bridge document does not carry schema_version 1")
    claimed_urls: set[str] = set()
    claimed_identities: set[str] = set()
    for entry in doc.get("bridges", []):
        url = entry["player_url"]
        identity = entry["afltables_external_id"]
        if not url_re.match(url):
            raise BuildError(f"bridge entry is not keyed on a canonical player_url: {url!r}")
        if not AFLTABLES_PATH_RE.match(identity):
            raise BuildError(f"bridge entry names a non-canonical AFL Tables identity: {identity!r}")
        if url in claimed_urls:
            raise BuildError(f"bridge dataset binds {url!r} to multiple AFL Tables identities")
        if identity in claimed_identities:
            raise BuildError(
                f"bridge dataset binds AFL Tables identity {identity!r} to multiple DraftGuru "
                "persons -- self-validation refuses exactly what load_bridge() refuses")
        claimed_urls.add(url)
        claimed_identities.add(identity)
    for entry in doc.get("withheld", []):
        url = entry["player_url"]
        if not url_re.match(url):
            raise BuildError(f"withheld entry is not keyed on a canonical player_url: {url!r}")
        if not entry.get("reason"):
            raise BuildError(f"withheld entry carries no reason: {url!r}")
        if url in claimed_urls:
            raise BuildError(
                f"{url!r} appears in both bridges[] and withheld[] -- the two sections must "
                "partition the population exactly")
        claimed_urls.add(url)


# ---------------------------------------------------------------------------
# Verdict extraction -- STRUCTURED evidence only
# ---------------------------------------------------------------------------

def captured_href_of(row: dict) -> tuple[str, str]:
    """The structured, already-verified v1 target this row was adjudicated against.

    Exactly one of the two structured field names must be present and non-empty.
    operator_notes is never consulted.
    """
    evidence = row.get("evidence") or {}
    found = [(f, evidence[f]) for f in CAPTURED_HREF_FIELDS
             if isinstance(evidence.get(f), str) and evidence[f].strip()]
    if len(found) != 1:
        raise BuildError(
            f"row {row.get('draftguru_url')!r} carries {len(found)} structured captured-href "
            f"field(s) ({[f for f, _ in found]}); exactly one of {list(CAPTURED_HREF_FIELDS)} "
            "is required")
    field, value = found[0]
    if not AFLTABLES_PATH_RE.match(value):
        raise BuildError(
            f"row {row.get('draftguru_url')!r} captured href {value!r} is not a canonical "
            "AFL Tables identity path")
    return value, field


def corrected_target_of(row: dict) -> str:
    """The single structured corrected target for an approve_manual_curation row.

    Fails closed when the row carries zero, more than one, or a malformed corrected
    target. The value is NEVER parsed out of operator_notes.
    """
    evidence = row.get("evidence") or {}
    raw = evidence.get(CORRECTED_TARGET_FIELD)
    if isinstance(raw, (list, tuple, set)):
        raise BuildError(
            f"row {row.get('draftguru_url')!r} carries {len(raw)} structured corrected targets; "
            "exactly one is required for approve_manual_curation")
    if not isinstance(raw, str) or not raw.strip():
        raise BuildError(
            f"row {row.get('draftguru_url')!r} has verdict approve_manual_curation but carries no "
            f"structured evidence.{CORRECTED_TARGET_FIELD}; refusing to infer a target from notes, "
            "names or machine classification")
    value = raw.strip()
    if not AFLTABLES_PATH_RE.match(value):
        raise BuildError(
            f"row {row.get('draftguru_url')!r} corrected target {value!r} is not a canonical "
            "AFL Tables identity path")
    return value


def read_decisions(verdicts_doc: dict, url_re: re.Pattern, *, expect: dict) -> list[dict]:
    """Normalise the completed verdict artefact into one decision record per row.

    Every totals/vocabulary expectation is enforced here, before any lineage change is
    computed.
    """
    if verdicts_doc.get("completion_status") != "complete":
        raise BuildError(
            f"operator verdict artefact completion_status is "
            f"{verdicts_doc.get('completion_status')!r}, not 'complete'")
    rows = verdicts_doc.get("rows")
    if not isinstance(rows, list):
        raise BuildError("operator verdict artefact carries no rows[]")
    if len(rows) != expect["decision_total"]:
        raise BuildError(
            f"operator verdict artefact carries {len(rows)} rows, expected "
            f"{expect['decision_total']}")

    decisions: list[dict] = []
    seen_urls: set[str] = set()
    seen_order: set[int] = set()
    by_verdict: dict[str, int] = {}
    by_group: dict[str, int] = {}

    for row in rows:
        url = row.get("draftguru_url")
        if not isinstance(url, str) or not url_re.match(url):
            raise BuildError(f"verdict row is not keyed on a canonical player_url: {url!r}")
        if url in seen_urls:
            raise BuildError(f"operator verdict artefact carries a duplicate row identity: {url!r}")
        seen_urls.add(url)

        order = row.get("global_order")
        if not isinstance(order, int):
            raise BuildError(f"verdict row {url!r} carries no integer global_order")
        if order in seen_order:
            raise BuildError(f"operator verdict artefact carries a duplicate global_order: {order}")
        seen_order.add(order)

        group = row.get("group")
        if group not in ALLOWED_VERDICTS_BY_GROUP:
            raise BuildError(f"verdict row {url!r} carries an unknown group {group!r}")

        verdict = row.get("operator_verdict")
        if not isinstance(verdict, str) or not verdict:
            raise BuildError(f"verdict row {url!r} carries no operator_verdict -- output incomplete")
        if verdict not in ALLOWED_VERDICTS_BY_GROUP[group]:
            raise BuildError(
                f"verdict row {url!r} carries verdict {verdict!r}, which group {group!r} does not "
                f"allow ({sorted(ALLOWED_VERDICTS_BY_GROUP[group])})")
        if verdict in UNCERTAIN_VERDICTS:
            raise BuildError(
                f"verdict row {url!r} carries the uncertain/negative verdict {verdict!r}; this "
                "generator has no rule for it and refuses rather than guessing")
        if verdict not in VERDICT_ACTION:
            raise BuildError(f"verdict row {url!r} carries an unhandled verdict {verdict!r}")

        captured, captured_field = captured_href_of(row)
        corrected = corrected_target_of(row) if verdict == "approve_manual_curation" else None
        if corrected is not None and corrected == captured:
            raise BuildError(
                f"row {url!r} proposes a corrected target identical to the captured href "
                f"({captured!r}); a manual-curation row must change the target")

        by_verdict[verdict] = by_verdict.get(verdict, 0) + 1
        by_group[group] = by_group.get(group, 0) + 1

        decisions.append({
            "action": VERDICT_ACTION[verdict],
            "captured_afltables_target": captured,
            "captured_target_field": captured_field,
            "corrected_afltables_target": corrected,
            "decided_utc": row.get("decided_utc"),
            "draftguru_url": url,
            "event_club_provenance": {f: row.get(f) for f in EVENT_CLUB_FIELDS},
            "global_order": order,
            "group": group,
            "group_label": row.get("group_label"),
            "machine_classification": row.get("machine_classification"),
            "operator_notes_verbatim": row.get("operator_notes"),
            "operator_verdict": verdict,
            "pack_ordinal": row.get("pack_ordinal"),
            "row_ordinal_in_group": row.get("row_ordinal_in_group"),
        })

    if by_verdict != expect["by_verdict"]:
        raise BuildError(
            f"verdict totals {by_verdict} do not equal the expected {expect['by_verdict']}")
    if by_group != expect["by_group"]:
        raise BuildError(
            f"group totals {by_group} do not equal the expected {expect['by_group']}")

    positives = sum(1 for d in decisions if d["operator_verdict"] in POSITIVE_VERDICTS)
    negatives = sum(1 for d in decisions if d["operator_verdict"] in NEGATIVE_VERDICTS)
    uncertain = len(decisions) - positives - negatives
    if positives != expect["positive_total"]:
        raise BuildError(f"{positives} positive decisions, expected {expect['positive_total']}")
    if negatives != expect["negative_total"]:
        raise BuildError(f"{negatives} withheld decisions, expected {expect['negative_total']}")
    if uncertain != expect["uncertain_total"]:
        raise BuildError(f"{uncertain} uncertain decisions, expected {expect['uncertain_total']}")

    withheld_urls = tuple(sorted(d["draftguru_url"] for d in decisions
                                 if d["action"] == ACTION_WITHHELD))
    if withheld_urls != tuple(sorted(expect["withheld_urls"])):
        raise BuildError(
            f"withheld row identities {list(withheld_urls)} do not equal the expected "
            f"{sorted(expect['withheld_urls'])}")

    corrected_map = {d["draftguru_url"]: d["corrected_afltables_target"] for d in decisions
                     if d["action"] == ACTION_CORRECTED}
    if corrected_map != expect["corrected_targets"]:
        raise BuildError(
            "the structured corrected targets do not equal the expected set -- observed "
            f"{corrected_map}, expected {expect['corrected_targets']}")

    decisions.sort(key=lambda d: d["global_order"])
    return decisions


# ---------------------------------------------------------------------------
# Lineage transformation
# ---------------------------------------------------------------------------

def apply_decisions(parent_v1: dict, decisions: list[dict], *, expect: dict) -> dict:
    """Produce the v2 bridges[]/withheld[] plus a per-row lineage record.

    Ordering is inherited exactly from v1 (both sections ascending by player_url, the
    ordering export_person_bridge.py itself produces), so an unaffected row keeps both
    its content and its position and a corrected row is an in-place target replacement.
    """
    v1_bridges = parent_v1.get("bridges") or []
    v1_withheld = parent_v1.get("withheld") or []
    if len(v1_bridges) != expect["parent_v1_bridges"]:
        raise BuildError(
            f"v1 parent carries {len(v1_bridges)} bridges, expected {expect['parent_v1_bridges']}")
    if len(v1_withheld) != expect["parent_v1_withheld"]:
        raise BuildError(
            f"v1 parent carries {len(v1_withheld)} withheld, expected "
            f"{expect['parent_v1_withheld']}")

    v1_by_url = {e["player_url"]: e["afltables_external_id"] for e in v1_bridges}
    if len(v1_by_url) != len(v1_bridges):
        raise BuildError("v1 parent bridges[] carries a duplicate player_url")
    v1_withheld_urls = {e["player_url"] for e in v1_withheld}
    if len(v1_withheld_urls) != len(v1_withheld):
        raise BuildError("v1 parent withheld[] carries a duplicate player_url")
    overlap = v1_withheld_urls & set(v1_by_url)
    if overlap:
        raise BuildError(f"v1 parent lists {len(overlap)} player_url(s) as both bridged and withheld")

    by_url = {d["draftguru_url"]: d for d in decisions}

    lineage: list[dict] = []
    bridges: list[dict] = []
    withheld_new: list[dict] = []

    for entry in v1_bridges:
        url = entry["player_url"]
        v1_target = entry["afltables_external_id"]
        decision = by_url.get(url)

        if decision is None:
            bridges.append({"player_url": url, "afltables_external_id": v1_target})
            continue

        if decision["captured_afltables_target"] != v1_target:
            raise BuildError(
                f"adjudicated row {url!r} was decided against captured target "
                f"{decision['captured_afltables_target']!r} but the v1 parent maps it to "
                f"{v1_target!r} -- the verdict does not apply to this lineage")

        action = decision["action"]
        if action == ACTION_CONFIRMED:
            bridges.append({"player_url": url, "afltables_external_id": v1_target})
            v2_target: str | None = v1_target
        elif action == ACTION_CORRECTED:
            v2_target = decision["corrected_afltables_target"]
            bridges.append({"player_url": url, "afltables_external_id": v2_target})
        elif action == ACTION_WITHHELD:
            v2_target = None
            withheld_new.append({"player_url": url, "reason": decision["operator_verdict"]})
        else:
            raise BuildError(f"row {url!r} resolved to unsupported action {action!r}")

        lineage.append({
            "action": action,
            "draftguru_url": url,
            "group": decision["group"],
            "operator_verdict": decision["operator_verdict"],
            "rejected_afltables_target": v1_target if action == ACTION_WITHHELD else None,
            "v1_afltables_external_id": v1_target,
            "v2_afltables_external_id": v2_target,
        })

    # A decision naming a person the v1 parent never bridged would be an ADDED row. None
    # exists in this adjudication; the branch is kept explicit so an unexpected one is a
    # refusal, not a silent omission.
    unmatched = sorted(set(by_url) - set(v1_by_url))
    if unmatched:
        previously_withheld = [u for u in unmatched if u in v1_withheld_urls]
        raise BuildError(
            f"{len(unmatched)} adjudicated row(s) name a person the v1 parent does not bridge "
            f"({unmatched[:5]}{'…' if len(unmatched) > 5 else ''}); "
            f"{len(previously_withheld)} of them are v1-withheld. Promoting a withheld row is "
            "not part of this adjudication and is refused rather than guessed.")

    withheld = [dict(e) for e in v1_withheld] + withheld_new
    withheld.sort(key=lambda w: w["player_url"])

    if len(bridges) != expect["parent_v2_bridges"]:
        raise BuildError(
            f"v2 parent would carry {len(bridges)} bridges, expected "
            f"{expect['parent_v2_bridges']}")
    if len(withheld) != expect["parent_v2_withheld"]:
        raise BuildError(
            f"v2 parent would carry {len(withheld)} withheld, expected "
            f"{expect['parent_v2_withheld']}")
    if len(bridges) + len(withheld) != expect["population"]:
        raise BuildError(
            f"v2 bridges ({len(bridges)}) + withheld ({len(withheld)}) = "
            f"{len(bridges) + len(withheld)}, which does not partition the "
            f"{expect['population']}-person population")

    rejected_targets = {ln["rejected_afltables_target"] for ln in lineage
                        if ln["action"] == ACTION_WITHHELD}
    accepted_pairs = {(e["player_url"], e["afltables_external_id"]) for e in bridges}
    for ln in lineage:
        if ln["action"] != ACTION_WITHHELD:
            continue
        pair = (ln["draftguru_url"], ln["rejected_afltables_target"])
        if pair in accepted_pairs:
            raise BuildError(
                f"rejected mapping {pair} survives in the v2 accepted bridge rows")
        if any(e["player_url"] == ln["draftguru_url"] for e in bridges):
            raise BuildError(
                f"withheld person {ln['draftguru_url']!r} still appears in v2 bridges[]")

    # A rejected TARGET may legitimately belong to another person only if some other
    # DraftGuru identity was independently bridged to it in v1; neither of ours is.
    for target in sorted(t for t in rejected_targets if t):
        holders = sorted(e["player_url"] for e in bridges if e["afltables_external_id"] == target)
        if holders:
            raise BuildError(
                f"rejected AFL Tables target {target!r} re-enters the v2 accepted rows through "
                f"{holders} -- carry-forward must not reintroduce a rejected mapping")

    lineage.sort(key=lambda ln: ln["draftguru_url"])
    return {"bridges": bridges, "withheld": withheld, "lineage": lineage}


def action_totals(lineage: list[dict], *, bridges: list[dict]) -> dict[str, int]:
    counts = {a: 0 for a in (ACTION_UNCHANGED, ACTION_CONFIRMED, ACTION_CORRECTED,
                             ACTION_ADDED, ACTION_WITHHELD)}
    for ln in lineage:
        counts[ln["action"]] += 1
    touched_accepted = counts[ACTION_CONFIRMED] + counts[ACTION_CORRECTED] + counts[ACTION_ADDED]
    counts[ACTION_UNCHANGED] = len(bridges) - touched_accepted
    return counts


# ---------------------------------------------------------------------------
# Stage A event reconciliation (the "one parent, many events" invariant)
# ---------------------------------------------------------------------------

def check_event_reconciliation(stage_a_rows: list[dict], *, bridges: list[dict],
                               withheld: list[dict], decisions: list[dict],
                               expect: dict) -> dict:
    """Verify that Stage A's draft/listing events collapse onto the person-keyed bridge.

    There is no event-level bridge file; this proves the invariant that one would have
    to satisfy: every event resolves to exactly one person row, no person row is
    duplicated, a person with several events still holds exactly one bridge row, and a
    same-club re-draft is preserved rather than collapsed away.
    """
    if len(stage_a_rows) != expect["stage_a_events"]:
        raise BuildError(
            f"Stage A carries {len(stage_a_rows)} events, expected {expect['stage_a_events']}")

    accepted_urls = {e["player_url"] for e in bridges}
    withheld_urls = {e["player_url"] for e in withheld}
    population = accepted_urls | withheld_urls

    event_ids: set[tuple] = set()
    events_by_url: dict[str, list[dict]] = {}
    for row in stage_a_rows:
        url = row.get("player_url")
        ident = (row.get("draft_year"), row.get("row_index"), row.get("source_url"))
        if None in ident[:2]:
            raise BuildError(f"Stage A event for {url!r} carries no (draft_year, row_index) identity")
        if ident in event_ids:
            raise BuildError(f"Stage A carries a duplicate immutable event identity: {ident}")
        event_ids.add(ident)
        events_by_url.setdefault(url, []).append(row)

    orphans = sorted(u for u in events_by_url if u not in population)
    if orphans:
        raise BuildError(
            f"{len(orphans)} Stage A event person(s) appear in neither v2 bridges[] nor "
            f"withheld[] (e.g. {orphans[:3]}) -- the lineage does not account for every event")

    multi_event_persons = {u: rows for u, rows in events_by_url.items() if len(rows) > 1}
    same_club_redraft = 0
    for rows in multi_event_persons.values():
        clubs = [(r.get("club_name_raw") or "").strip().casefold() for r in rows]
        if len(clubs) != len(set(clubs)):
            same_club_redraft += 1

    relisting_urls = [d["draftguru_url"] for d in decisions
                      if d["operator_verdict"] == "same_person_valid_relisting"]
    collapse_failures = []
    for url in relisting_urls:
        rows_held = [e for e in bridges if e["player_url"] == url]
        if len(rows_held) != 1:
            collapse_failures.append((url, len(rows_held)))
    if collapse_failures:
        raise BuildError(
            f"{len(collapse_failures)} relisting person(s) do not hold exactly one v2 parent row: "
            f"{collapse_failures[:5]}")

    relisting_multi_event = sum(1 for url in relisting_urls if len(events_by_url.get(url, [])) > 1)
    relisting_same_club = 0
    for url in relisting_urls:
        clubs = [(r.get("club_name_raw") or "").strip().casefold()
                 for r in events_by_url.get(url, [])]
        if len(clubs) != len(set(clubs)):
            relisting_same_club += 1

    blocked = sorted(d["draftguru_url"] for d in decisions if d["action"] == ACTION_WITHHELD)
    events_blocked = sum(len(events_by_url.get(u, [])) for u in blocked)

    return {
        "distinct_event_persons": len(events_by_url),
        "duplicate_event_identities": 0,
        "events_blocked_by_withheld_rows": events_blocked,
        "events_total": len(stage_a_rows),
        "orphan_event_persons": 0,
        "persons_with_multiple_events": len(multi_event_persons),
        "persons_with_same_club_repeat_event": same_club_redraft,
        "referential_integrity": "PASS",
        "relisting_persons_holding_exactly_one_parent_row": len(relisting_urls),
        "relisting_persons_with_multiple_events": relisting_multi_event,
        "relisting_persons_with_same_club_repeat_event": relisting_same_club,
    }


# ---------------------------------------------------------------------------
# Output construction
# ---------------------------------------------------------------------------

def build_parent_v2(parent_v1: dict, result: dict, *, frozen_utc: str,
                    verdicts_sha256: str, verdicts_path: str,
                    parent_v1_sha256: str, parent_v1_path: str,
                    decisions: list[dict], actions: dict[str, int]) -> dict:
    provenance = dict(parent_v1.get("provenance") or {})
    provenance.update({
        "v2_generator": TOOL,
        "v2_generator_version": TOOL_VERSION,
        "v2_operator_verdicts_path": verdicts_path,
        "v2_operator_verdicts_sha256": verdicts_sha256,
    })

    affected = []
    by_url = {d["draftguru_url"]: d for d in decisions}
    for ln in result["lineage"]:
        d = by_url[ln["draftguru_url"]]
        affected.append({
            "action": ln["action"],
            "draftguru_url": ln["draftguru_url"],
            "event_club_provenance": d["event_club_provenance"],
            "group": ln["group"],
            "operator_verdict": ln["operator_verdict"],
            "structured_target_field": (CORRECTED_TARGET_FIELD if ln["action"] == ACTION_CORRECTED
                                        else d["captured_target_field"]),
            "v1_afltables_external_id": ln["v1_afltables_external_id"],
            "v2_afltables_external_id": ln["v2_afltables_external_id"],
        })
    affected.sort(key=lambda a: a["draftguru_url"])

    doc = {
        "$comment": (
            "AFLDB-ISSUE-222 Stage B3 SOURCE-EVIDENCE bridge, version 2 -- the frozen v1 "
            "source-evidence parent with the COMPLETED Phase 3 operator adjudication applied ("
            f"{actions[ACTION_CONFIRMED] + actions[ACTION_CORRECTED] + actions[ACTION_ADDED]} "
            f"eligible decisions; {actions[ACTION_WITHHELD]} different_person_wrong_href "
            "mapping(s) withheld). "
            "Immutable per version, database-independent. Never imported directly: a per-target "
            "deployment dataset (export_person_bridge.py --resolve-against) is required first, "
            "and for v2 that resolution has NOT been run -- see "
            "docs/rebuild-manifests/draftguru/bridge-v2-reconciliation-20260918-v1.json."),
        "bridges": result["bridges"],
        "counts": {
            "bridges": len(result["bridges"]),
            "collisions_acknowledged": (parent_v1.get("counts") or {}).get(
                "collisions_acknowledged", 0),
            "requested": (parent_v1.get("counts") or {}).get("requested"),
            "withheld": len(result["withheld"]),
        },
        "exporter": TOOL,
        "exporter_version": TOOL_VERSION,
        "generated_utc": frozen_utc,
        "generated_utc_basis": (
            "frozen to the operator verdict artefact's review_completed_utc so this versioned "
            "artefact is byte-reproducible; it is not a wall-clock generation time"),
        "kind": "source-evidence",
        "operator_adjudication": {
            "actions_by_type": actions,
            "affected_rows": affected,
            "event_club_fields_are_review_provenance": (
                "no_senior_appearance_ever / pre_event_only / post_event_appearance are preserved "
                "review provenance only; they never change player identity and never generate a "
                "player-club playing statistic"),
            "source": {"path": verdicts_path, "sha256": verdicts_sha256},
        },
        "provenance": provenance,
        "schema_version": BRIDGE_SCHEMA_VERSION,
        "supersedes": {"path": parent_v1_path, "sha256": parent_v1_sha256},
        "withheld": result["withheld"],
    }
    doc["rows_sha256"] = base.sha256_bytes(base.canonical_json_bytes(
        {"bridges": doc["bridges"], "withheld": doc["withheld"]}))
    return doc


def build_withheld_manifest(decisions: list[dict], *, frozen_utc: str,
                            verdicts_doc: dict, child_v1: dict,
                            hashes: dict[str, str]) -> dict:
    raw_by_url = {r["draftguru_url"]: r for r in verdicts_doc["rows"]}
    child_bridged = {e["player_url"] for e in child_v1.get("bridges") or []}
    child_withheld = {e["player_url"]: e.get("reason")
                      for e in child_v1.get("withheld") or []}

    rows = []
    for d in decisions:
        if d["action"] != ACTION_WITHHELD:
            continue
        url = d["draftguru_url"]
        raw = raw_by_url[url]
        evidence = raw.get("evidence") or {}
        rows.append({
            "decided_utc": d["decided_utc"],
            "draftguru_name": evidence.get("draftguru_name"),
            "draftguru_url": url,
            "event_club_provenance": d["event_club_provenance"],
            "global_order": d["global_order"],
            "group": d["group"],
            "machine_classification": d["machine_classification"],
            "operator_notes_verbatim": d["operator_notes_verbatim"],
            "operator_reason": d["operator_verdict"],
            "pack_ordinal": d["pack_ordinal"],
            "rejected_afltables_target": d["captured_afltables_target"],
            "retained_target_evidence": {
                "retained_birth_year": evidence.get("retained_birth_year"),
                "retained_career_end": evidence.get("retained_career_end"),
                "retained_career_games": evidence.get("retained_career_games"),
                "retained_career_start": evidence.get("retained_career_start"),
                "retained_clubs": evidence.get("retained_clubs"),
                "retained_target_name": evidence.get("retained_target_name"),
            },
            "row_ordinal_in_group": d["row_ordinal_in_group"],
            "v1_afldb_test_child_status": (
                "bridged" if url in child_bridged
                else f"withheld:{child_withheld.get(url)}" if url in child_withheld
                else "absent"),
            "withheld_in": "bridge v2 source-evidence parent",
        })
    rows.sort(key=lambda r: r["draftguru_url"])

    doc = {
        "$comment": (
            "AFLDB-ISSUE-222 bridge v2 withheld/rejection manifest. Every row here was an "
            "ACCEPTED v1 parent mapping that the completed operator adjudication rejected as "
            "different_person_wrong_href. The rejected AFL Tables target is recorded for audit "
            "only and is never an accepted link; no alternative identity is guessed. These "
            "persons remain withheld pending a curator."),
        "generated_utc": frozen_utc,
        "generated_utc_basis": (
            "frozen to the operator verdict artefact's review_completed_utc; not a wall clock"),
        "issue": "AFLDB-ISSUE-222",
        "label": "20260918-v1",
        "rows": rows,
        "schema_version": WITHHELD_SCHEMA_VERSION,
        "source_hash_links": [
            {"label": key, "path": PINNED_INPUTS[key][0], "sha256": hashes[key]}
            for key in sorted(("operator_verdicts_json", "parent_v1", "child_v1_afldb_test"))
        ],
        "tool": {"path": TOOL, "version": TOOL_VERSION},
        "totals": {"withheld": len(rows)},
    }
    doc["rows_sha256"] = base.sha256_bytes(base.canonical_json_bytes(rows))
    return doc


def build_reconciliation(*, frozen_utc: str, hashes: dict[str, str],
                         parent_v1: dict, parent_v2: dict, child_v1: dict,
                         decisions: list[dict], result: dict, actions: dict[str, int],
                         events: dict, output_hashes: dict[str, str],
                         deterministic: str, expect: dict) -> dict:
    v1_bridges = parent_v1["bridges"]
    v2_bridges = parent_v2["bridges"]
    v1_withheld = parent_v1["withheld"]
    v2_withheld = parent_v2["withheld"]

    by_verdict: dict[str, int] = {}
    for d in decisions:
        by_verdict[d["operator_verdict"]] = by_verdict.get(d["operator_verdict"], 0) + 1

    changed_rows = []
    for ln in result["lineage"]:
        if ln["action"] == ACTION_CONFIRMED:
            continue
        changed_rows.append(ln)

    child_bridged = len(child_v1.get("bridges") or [])
    withheld_urls = {ln["draftguru_url"] for ln in result["lineage"]
                     if ln["action"] == ACTION_WITHHELD}
    child_bridged_urls = {e["player_url"] for e in child_v1.get("bridges") or []}
    carry_forward_certain = len(child_bridged_urls - withheld_urls)
    corrected_urls = {ln["draftguru_url"] for ln in result["lineage"]
                      if ln["action"] == ACTION_CORRECTED}

    unaccounted = (len(v2_bridges) + len(v2_withheld)) - expect["population"]
    positives = sum(1 for d in decisions if d["operator_verdict"] in POSITIVE_VERDICTS)
    negatives = sum(1 for d in decisions if d["operator_verdict"] in NEGATIVE_VERDICTS)
    duplicate_parent_keys = len(v2_bridges) - len({e["player_url"] for e in v2_bridges})
    duplicate_targets = len(v2_bridges) - len({e["afltables_external_id"] for e in v2_bridges})

    doc = {
        "$comment": (
            "AFLDB-ISSUE-222 bridge v2 reconciliation manifest. Machine-readable record of the "
            "exact v1 -> v2 source-evidence parent transformation produced from the completed "
            "operator adjudication. NO database resolution, network request, importer run, "
            "DEV/PROD action or Git command was performed."),
        "child_status": CHILD_STATUS,
        "child_status_detail": {
            "$comment": (
                "PLANNING FIGURES ONLY. No v2 child artefact exists and none was generated. "
                "These numbers do not predict how many corrected targets will resolve, and no "
                "final v2 child accepted/withheld count is published here."),
            "corrected_parent_targets_pending_db_resolution": sorted(corrected_urls),
            "corrected_parent_targets_pending_db_resolution_count": len(corrected_urls),
            "regeneration_command": (
                "python tools/rebuild/draftguru/export_person_bridge.py --resolve-against "
                "afldb_test (against a backed-up afldb_test)"),
            "v1_resolved_child_accepted": child_bridged,
            "v1_resolved_child_path": PINNED_INPUTS["child_v1_afldb_test"][0],
            "v1_resolved_child_sha256": hashes["child_v1_afldb_test"],
            "v1_rows_eligible_for_unchanged_carry_forward": carry_forward_certain,
        },
        "completion_status": "bridge_v2_source_evidence_parent_generated",
        "counts": {
            "accepted_v1": len(v1_bridges),
            "accepted_v2": len(v2_bridges),
            "accepted_delta": len(v2_bridges) - len(v1_bridges),
            "distinct_persons_v1": len({e["player_url"] for e in v1_bridges}),
            "distinct_persons_v2": len({e["player_url"] for e in v2_bridges}),
            "distinct_targets_v1": len({e["afltables_external_id"] for e in v1_bridges}),
            "distinct_targets_v2": len({e["afltables_external_id"] for e in v2_bridges}),
            "population": expect["population"],
            "unaccounted_rows": unaccounted,
            "withheld_v1": len(v1_withheld),
            "withheld_v2": len(v2_withheld),
            "withheld_delta": len(v2_withheld) - len(v1_withheld),
        },
        "decisions": {
            "by_verdict": by_verdict,
            "negative_excluded": negatives,
            "positive_represented": positives,
            "total": len(decisions),
            "uncertain": len(decisions) - positives - negatives,
        },
        "deterministic_generation": deterministic,
        "event_reconciliation": events,
        "generated_utc": frozen_utc,
        "generated_utc_basis": (
            "frozen to the operator verdict artefact's review_completed_utc so every artefact is "
            "byte-reproducible; not a wall-clock generation time"),
        "issue": "AFLDB-ISSUE-222",
        "label": "20260918-v1",
        "lineage": {
            "actions_by_type": actions,
            "added": actions[ACTION_ADDED],
            "changed_rows": changed_rows,
            "confirmed_no_content_change": actions[ACTION_CONFIRMED],
            "corrected": actions[ACTION_CORRECTED],
            "removed_withheld": actions[ACTION_WITHHELD],
            "unchanged_content": actions[ACTION_UNCHANGED] + actions[ACTION_CONFIRMED],
            "unchanged_untouched": actions[ACTION_UNCHANGED],
        },
        "no_absolute_paths_or_credentials": "PASS",
        "not_performed": [
            "target resolution against afldb_test",
            "any database connection",
            "any network request",
            "any importer run",
            "generation of the v2 afldb_test child deployment dataset",
            "generation of the new disjoint-salt validation sample",
            "any DEV or PROD action",
            "any Git command",
        ],
        "output_paths": {key: OUTPUTS[key] for key in sorted(OUTPUTS)},
        "outputs": [
            # Every artefact whose hash is known at the moment this manifest is built. The
            # manifest and the Markdown summary are derived from it and therefore cannot
            # carry their own hashes here; they are reported by the tool on write and are
            # listed in output_paths above.
            {"key": key, "path": OUTPUTS[key], "sha256": output_hashes[key]}
            for key in sorted(output_hashes)
        ],
        "parent_v1": {"path": PINNED_INPUTS["parent_v1"][0], "sha256": hashes["parent_v1"]},
        "parent_v2": {"path": OUTPUTS["parent_v2"],
                      "rows_sha256": parent_v2["rows_sha256"],
                      "sha256": output_hashes.get("parent_v2")},
        "referential_integrity": {
            "bridges_withheld_partition_population": "PASS" if unaccounted == 0 else "FAIL",
            "duplicate_parent_key": duplicate_parent_keys,
            "duplicate_target": duplicate_targets,
            "orphan_event_persons": events["orphan_event_persons"],
            "parent_to_stage_a_events": events["referential_integrity"],
            "result": ("PASS" if unaccounted == 0 and duplicate_parent_keys == 0
                       and duplicate_targets == 0 and events["orphan_event_persons"] == 0
                       else "FAIL"),
        },
        "schema_version": RECONCILIATION_SCHEMA_VERSION,
        "source_hash_links": [
            {"label": key, "path": rel, "sha256": hashes[key]}
            for key, (rel, _) in sorted(PINNED_INPUTS.items())
        ],
        "tool": {"path": TOOL, "version": TOOL_VERSION},
        "withheld_rows": [
            {
                "draftguru_url": ln["draftguru_url"],
                "global_order": next(d["global_order"] for d in decisions
                                     if d["draftguru_url"] == ln["draftguru_url"]),
                "operator_verdict": ln["operator_verdict"],
                "rejected_afltables_target": ln["rejected_afltables_target"],
            }
            for ln in sorted(
                (ln for ln in result["lineage"] if ln["action"] == ACTION_WITHHELD),
                key=lambda ln: ln["draftguru_url"])
        ],
    }
    return doc


PARENT_CSV_COLUMNS = [
    "player_url", "status", "withheld_reason", "afltables_external_id",
    "v1_afltables_external_id", "action", "operator_verdict", "operator_group",
]

WITHHELD_CSV_COLUMNS = [
    "draftguru_url", "draftguru_name", "operator_reason", "rejected_afltables_target",
    "group", "global_order", "pack_ordinal", "decided_utc",
    "event_club", "event_club_appearance_relationship_derived", "event_club_observation",
    "retained_target_name", "retained_career_start", "retained_career_end",
    "retained_career_games", "v1_afldb_test_child_status", "operator_notes_verbatim",
]


def render_parent_csv(parent_v2: dict, lineage: list[dict], parent_v1: dict) -> bytes:
    v1_by_url = {e["player_url"]: e["afltables_external_id"] for e in parent_v1["bridges"]}
    lineage_by_url = {ln["draftguru_url"]: ln for ln in lineage}

    buf = io.StringIO(newline="")
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(PARENT_CSV_COLUMNS)

    rows: list[list[str]] = []
    for entry in parent_v2["bridges"]:
        url = entry["player_url"]
        ln = lineage_by_url.get(url)
        rows.append([
            url, "accepted", "", entry["afltables_external_id"], v1_by_url.get(url, ""),
            ln["action"] if ln else ACTION_UNCHANGED,
            ln["operator_verdict"] if ln else "",
            ln["group"] if ln else "",
        ])
    for entry in parent_v2["withheld"]:
        url = entry["player_url"]
        ln = lineage_by_url.get(url)
        rows.append([
            url, "withheld", entry["reason"], "", v1_by_url.get(url, ""),
            ln["action"] if ln else ACTION_UNCHANGED,
            ln["operator_verdict"] if ln else "",
            ln["group"] if ln else "",
        ])
    rows.sort(key=lambda r: (r[0], r[1]))
    for row in rows:
        writer.writerow(row)
    return buf.getvalue().encode("utf-8").replace(b"\r\n", b"\n")


def render_withheld_csv(withheld_doc: dict) -> bytes:
    buf = io.StringIO(newline="")
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(WITHHELD_CSV_COLUMNS)
    for row in withheld_doc["rows"]:
        ec = row["event_club_provenance"]
        rt = row["retained_target_evidence"]
        writer.writerow([
            row["draftguru_url"], row["draftguru_name"] or "", row["operator_reason"],
            row["rejected_afltables_target"], row["group"], row["global_order"],
            row["pack_ordinal"] if row["pack_ordinal"] is not None else "",
            row["decided_utc"] or "",
            ec.get("event_club") or "",
            ec.get("event_club_appearance_relationship_derived") or "",
            ec.get("event_club_observation") or "",
            rt.get("retained_target_name") or "",
            rt.get("retained_career_start") if rt.get("retained_career_start") is not None else "",
            rt.get("retained_career_end") if rt.get("retained_career_end") is not None else "",
            rt.get("retained_career_games") if rt.get("retained_career_games") is not None else "",
            row["v1_afldb_test_child_status"],
            (row["operator_notes_verbatim"] or "").replace("\r\n", "\n").replace("\n", " ").strip(),
        ])
    return buf.getvalue().encode("utf-8").replace(b"\r\n", b"\n")


def render_summary_markdown(*, reconciliation: dict, withheld_doc: dict,
                            output_hashes: dict[str, str]) -> bytes:
    c = reconciliation["counts"]
    ln = reconciliation["lineage"]
    d = reconciliation["decisions"]
    lines: list[str] = []
    lines.append("# AFLDB-ISSUE-222 — bridge v2 source-evidence parent (20260918-v1 summary)")
    lines.append("")
    lines.append(f"Generated from the COMPLETED Phase 3 operator adjudication "
                 f"({d['total']}/{d['total']} rows). No database connection, network request, "
                 "importer run, DEV/PROD action or Git command occurred.")
    lines.append("")
    lines.append("## 1. Lineage")
    lines.append("")
    lines.append("| Quantity | v1 | v2 | Delta |")
    lines.append("|---|---:|---:|---:|")
    lines.append(f"| Accepted bridges (persons) | {c['accepted_v1']} | {c['accepted_v2']} | "
                 f"{c['accepted_delta']:+d} |")
    lines.append(f"| Withheld (persons) | {c['withheld_v1']} | {c['withheld_v2']} | "
                 f"{c['withheld_delta']:+d} |")
    lines.append(f"| Distinct persons accepted | {c['distinct_persons_v1']} | "
                 f"{c['distinct_persons_v2']} | "
                 f"{c['distinct_persons_v2'] - c['distinct_persons_v1']:+d} |")
    lines.append(f"| Distinct AFL Tables targets accepted | {c['distinct_targets_v1']} | "
                 f"{c['distinct_targets_v2']} | "
                 f"{c['distinct_targets_v2'] - c['distinct_targets_v1']:+d} |")
    lines.append("")
    lines.append("| Action | Rows |")
    lines.append("|---|---:|")
    lines.append(f"| unchanged (no verdict touched the row) | {ln['unchanged_untouched']} |")
    lines.append(f"| confirmed (verdict confirmed the existing mapping, content identical) | "
                 f"{ln['confirmed_no_content_change']} |")
    lines.append(f"| corrected (structured corrected target applied) | {ln['corrected']} |")
    lines.append(f"| added | {ln['added']} |")
    lines.append(f"| removed / withheld | {ln['removed_withheld']} |")
    lines.append(f"| **content-unchanged total** | **{ln['unchanged_content']}** |")
    lines.append("")
    lines.append(f"Decisions incorporated: **{d['total']}** "
                 f"({d['positive_represented']} eligible, {d['negative_excluded']} withheld, "
                 f"{d['uncertain']} uncertain). By verdict: "
                 + ", ".join(f"`{k}` {v}" for k, v in sorted(d["by_verdict"].items())) + ".")
    lines.append("")
    lines.append(
        f"The net accepted change is **{c['accepted_delta']:+d}**, not "
        f"+{d['positive_represented']}: {ln['confirmed_no_content_change']} positive decisions "
        f"confirmed an existing mapping without changing it, {ln['corrected']} corrected a target "
        f"in place, {ln['added']} promoted a previously withheld row, and "
        f"{ln['removed_withheld']} rejected a mapping.")
    lines.append("")
    lines.append("## 2. Withheld (different_person_wrong_href)")
    lines.append("")
    lines.append("| DraftGuru person | Rejected AFL Tables target | Reason |")
    lines.append("|---|---|---|")
    for row in withheld_doc["rows"]:
        lines.append(f"| {row['draftguru_name']} (`{row['draftguru_url']}`) | "
                     f"`{row['rejected_afltables_target']}` | `{row['operator_reason']}` |")
    lines.append("")
    lines.append("The rejected target is recorded for audit only; it is never an accepted link, "
                 "no alternative identity is guessed, and no accepted v2 row can reintroduce it.")
    lines.append("")
    lines.append("## 3. Event reconciliation (no event-level bridge file exists)")
    lines.append("")
    ev = reconciliation["event_reconciliation"]
    lines.append(f"- Stage A events: {ev['events_total']} across {ev['distinct_event_persons']} "
                 "persons; 0 duplicate immutable event identities; 0 orphan event persons.")
    lines.append(f"- Persons holding more than one draft/listing event: "
                 f"{ev['persons_with_multiple_events']}, of which "
                 f"{ev['persons_with_same_club_repeat_event']} include a repeat event at the same "
                 "club (a same-club re-draft remains valid and is preserved).")
    lines.append(f"- All {ev['relisting_persons_holding_exactly_one_parent_row']} "
                 "`same_person_valid_relisting` persons hold exactly one v2 parent row "
                 f"({ev['relisting_persons_with_multiple_events']} of them carry several events, "
                 f"{ev['relisting_persons_with_same_club_repeat_event']} at the same club).")
    lines.append(f"- {ev['events_blocked_by_withheld_rows']} event(s) belong to the "
                 f"{ln['removed_withheld']} withheld person(s) and therefore resolve to no "
                 "accepted link.")
    lines.append("")
    lines.append("## 4. afldb_test child — NOT generated")
    lines.append("")
    lines.append(f"`child_status` = `{reconciliation['child_status']}`.")
    lines.append("")
    cd = reconciliation["child_status_detail"]
    lines.append(f"- v1 resolved child accepted: {cd['v1_resolved_child_accepted']}.")
    lines.append(f"- v1 rows eligible for unchanged carry-forward after removing the "
                 f"{ln['removed_withheld']} rejected link(s): "
                 f"{cd['v1_rows_eligible_for_unchanged_carry_forward']}.")
    lines.append(f"- Corrected parent targets pending database resolution: "
                 f"{cd['corrected_parent_targets_pending_db_resolution_count']}.")
    lines.append(f"- These are planning figures only. No prediction is made that all "
                 f"{cd['corrected_parent_targets_pending_db_resolution_count']} will resolve, no "
                 "final v2 child accepted/withheld count is published, and no child artefact was "
                 "generated.")
    lines.append("")
    lines.append("## 5. Artefacts")
    lines.append("")
    lines.append("| Artefact | sha256 |")
    lines.append("|---|---|")
    for key in sorted(output_hashes):
        lines.append(f"| `{OUTPUTS[key]}` | `{output_hashes[key]}` |")
    lines.append("")
    lines.append("## 6. Status")
    lines.append("")
    lines.append("Bridge v2 source-evidence parent generated and validated; afldb_test-resolved "
                 "child deferred pending backed-up database target resolution.")
    lines.append("")
    lines.append("Bridge v2 is **not** deployment-ready until the child is generated through the "
                 "existing `--resolve-against afldb_test` path. Phase 3 is not marked accepted by "
                 "this artefact and AFLDB-ISSUE-222 is not complete.")
    lines.append("")
    return ("\n".join(lines)).encode("utf-8")


# ---------------------------------------------------------------------------
# Output screening
# ---------------------------------------------------------------------------

def screen_output_bytes(name: str, data: bytes) -> None:
    text = data.decode("utf-8", errors="replace")
    for pattern, what in FORBIDDEN_OUTPUT_PATTERNS:
        match = pattern.search(text)
        if match:
            raise BuildError(
                f"output {name} contains {what} ({match.group(0)!r}); refusing to write")


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def default_expectations() -> dict:
    return {
        "by_group": dict(EXPECT_BY_GROUP),
        "by_verdict": dict(EXPECT_BY_VERDICT),
        "child_v1_bridges": EXPECT_CHILD_V1_BRIDGES,
        "corrected_targets": dict(EXPECT_CORRECTED_TARGETS),
        "decision_total": EXPECT_DECISION_TOTAL,
        "negative_total": EXPECT_NEGATIVE_TOTAL,
        "parent_v1_bridges": EXPECT_PARENT_V1_BRIDGES,
        "parent_v1_withheld": EXPECT_PARENT_V1_WITHHELD,
        "parent_v2_bridges": EXPECT_PARENT_V2_BRIDGES,
        "parent_v2_withheld": EXPECT_PARENT_V2_WITHHELD,
        "population": EXPECT_POPULATION,
        "positive_total": EXPECT_POSITIVE_TOTAL,
        "stage_a_events": EXPECT_STAGE_A_EVENTS,
        "uncertain_total": EXPECT_UNCERTAIN_TOTAL,
        "withheld_urls": list(EXPECT_WITHHELD_URLS),
    }


def build(root: Path, *, pinned: dict[str, tuple[str, str]] | None = None,
          expect: dict | None = None) -> dict:
    """Compute the whole v2 result. Writes nothing. Raises BuildError on any refusal."""
    pinned = pinned or PINNED_INPUTS
    expect = expect or default_expectations()

    hashes = hash_inputs(root, expected=pinned)
    paths = {key: root / rel for key, (rel, _) in pinned.items()}
    url_re = load_canonical_url_regex(root)

    verdicts_doc = base.load_json(paths["operator_verdicts_json"], "operator verdict artefact")
    parent_v1 = base.load_json(paths["parent_v1"], "v1 source-evidence parent bridge")
    child_v1 = base.load_json(paths["child_v1_afldb_test"], "v1 afldb_test deployment child")
    stage_a_rows = base.load_jsonl(paths["stage_a_rows"], "Stage A parsed rows")

    frozen_utc = verdicts_doc.get("review_completed_utc")
    if not isinstance(frozen_utc, str) or not frozen_utc.endswith("Z"):
        raise BuildError(
            "operator verdict artefact carries no usable review_completed_utc to freeze the "
            "generation timestamp to; refusing to introduce wall-clock variation")

    if len(child_v1.get("bridges") or []) != expect["child_v1_bridges"]:
        raise BuildError(
            f"v1 child carries {len(child_v1.get('bridges') or [])} bridges, expected "
            f"{expect['child_v1_bridges']}")

    decisions = read_decisions(verdicts_doc, url_re, expect=expect)
    result = apply_decisions(parent_v1, decisions, expect=expect)
    actions = action_totals(result["lineage"], bridges=result["bridges"])
    events = check_event_reconciliation(stage_a_rows, bridges=result["bridges"],
                                        withheld=result["withheld"], decisions=decisions,
                                        expect=expect)

    parent_v2 = build_parent_v2(
        parent_v1, result, frozen_utc=frozen_utc,
        verdicts_sha256=hashes["operator_verdicts_json"],
        verdicts_path=pinned["operator_verdicts_json"][0],
        parent_v1_sha256=hashes["parent_v1"], parent_v1_path=pinned["parent_v1"][0],
        decisions=decisions, actions=actions)
    self_validate_bridge_schema(parent_v2, url_re)

    withheld_doc = build_withheld_manifest(decisions, frozen_utc=frozen_utc,
                                           verdicts_doc=verdicts_doc, child_v1=child_v1,
                                           hashes=hashes)

    payloads: dict[str, bytes] = {
        "parent_v2": base.dump_json_lf(parent_v2),
        "parent_csv": render_parent_csv(parent_v2, result["lineage"], parent_v1),
        "withheld_json": base.dump_json_lf(withheld_doc),
        "withheld_csv": render_withheld_csv(withheld_doc),
    }
    output_hashes = {k: base.sha256_bytes(v) for k, v in payloads.items()}

    reconciliation = build_reconciliation(
        frozen_utc=frozen_utc, hashes=hashes, parent_v1=parent_v1,
        parent_v2=parent_v2, child_v1=child_v1, decisions=decisions, result=result,
        actions=actions, events=events, output_hashes=dict(output_hashes),
        deterministic="PASS (frozen timestamp; content-addressed rows_sha256)", expect=expect)
    payloads["reconciliation"] = base.dump_json_lf(reconciliation)
    output_hashes["reconciliation"] = base.sha256_bytes(payloads["reconciliation"])

    payloads["summary_md"] = render_summary_markdown(
        reconciliation=reconciliation, withheld_doc=withheld_doc, output_hashes=output_hashes)
    output_hashes["summary_md"] = base.sha256_bytes(payloads["summary_md"])

    for key, data in payloads.items():
        screen_output_bytes(OUTPUTS[key], data)

    # Immutable inputs must be byte-identical at the end of the run as well.
    hash_inputs(root, expected=pinned)

    return {
        "actions": actions,
        "decisions": decisions,
        "events": events,
        "frozen_utc": frozen_utc,
        "input_hashes": hashes,
        "output_hashes": output_hashes,
        "parent_v2": parent_v2,
        "payloads": payloads,
        "reconciliation": reconciliation,
        "withheld_doc": withheld_doc,
    }


def write_outputs(root: Path, payloads: dict[str, bytes], *,
                  outputs: dict[str, str] | None = None) -> dict[str, str]:
    """Write every artefact atomically.

    Refuses to overwrite an existing non-identical artefact. An identical rerun is
    idempotent and reports `identical`.
    """
    outputs = outputs or OUTPUTS
    states: dict[str, str] = {}
    targets = {key: root / outputs[key] for key in payloads}

    # Check every target before writing any of them, so a refusal leaves nothing partially
    # applied.
    for key, path in targets.items():
        if path.exists():
            if path.read_bytes() == payloads[key]:
                states[key] = "identical"
            else:
                raise BuildError(
                    f"{outputs[key]} already exists with different content; an immutable versioned "
                    "artefact is never overwritten. Nothing was written. Bump the version or "
                    "remove the stale file deliberately.")
        else:
            states[key] = "written"

    for key, path in targets.items():
        if states[key] == "identical":
            continue
        base.atomic_write_bytes(path, payloads[key])
        if path.read_bytes() != payloads[key]:
            raise BuildError(f"{outputs[key]} readback does not match the bytes written")
    return states


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--validate-only", action="store_true",
                      help="verify every input and hash, compute the intended v2 result, report "
                           "counts and deltas, and write nothing")
    mode.add_argument("--write", action="store_true",
                      help="rerun every validation, then write the versioned outputs atomically")
    parser.add_argument("--root", default=None,
                        help="repository root (default: this tool's repository)")
    parser.add_argument("--print-parent-rows-sha256-only", action="store_true")
    args = parser.parse_args(argv)

    root = Path(args.root).resolve() if args.root else REPO_ROOT

    try:
        result = build(root)
    except base.ToolError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1

    if args.print_parent_rows_sha256_only:
        print(result["parent_v2"]["rows_sha256"])
        return 0

    recon = result["reconciliation"]
    summary = {
        "actions_by_type": result["actions"],
        "child_status": recon["child_status"],
        "counts": recon["counts"],
        "decisions": recon["decisions"],
        "event_reconciliation": result["events"],
        "output_sha256": result["output_hashes"],
        "parent_v2_rows_sha256": result["parent_v2"]["rows_sha256"],
    }
    print(json.dumps(summary, indent=2, sort_keys=True))

    if args.validate_only:
        print("VALIDATE-ONLY: nothing written.")
        return 0

    try:
        states = write_outputs(root, result["payloads"])
    except base.ToolError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1

    for key in sorted(states):
        print(f"{states[key]:<10} {OUTPUTS[key]}  sha256={result['output_hashes'][key]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
