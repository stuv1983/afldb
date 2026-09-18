#!/usr/bin/env python3
"""AFLDB-ISSUE-222 Phase F -- offline retained-evidence review of the disjoint new-salt
VALIDATION sample (``bridge-validation-sample-20260918-v2.json``). DB-free.

    python tools/rebuild/draftguru/review_validation_sample.py --validate-only
    python tools/rebuild/draftguru/review_validation_sample.py --write

Mechanism: decision O-4 revision 2, unchanged. The per-row machine rules are EXACTLY those of
``review_person_bridge_offline.py`` (its ``evaluate_row``, ``build_fitzroy_index``,
``build_recheck_queue`` and ``build_residual_report`` are imported and called; nothing is
copied and that file is never edited -- its hash is frozen in the sample's ``tool_hashes`` and
the sample declares that any tool-hash change voids it). This module is only the adapter the
v2 sample needs: the v2 sample carries one ``rows[]`` stratum (ordinal, player_url, parent
identity, child status, selection key) instead of the v1 census/random strata, and its own
review artefacts must live under the ``bridge-validation-*`` names so the v1 review outputs
(``bridge-review-*``) are never touched.

Per row the artefact separates two facts that the v1 outputs carried in one ``outcome``:

* ``deployment_status`` -- the validated v2 ``afldb_test`` child's status for the person
  (``bridged`` or ``target_not_registered``). A ``target_not_registered`` row is a terminal
  deployment status (runbook §5, §7 class 3, §9; correction handoff §10.3): the captured href
  names an identity absent from the accepted 1897-2025 source, no link ships for it, and there
  are no retained target facts to compare. It is NOT an identity contradiction and is never
  described as one here.
* ``outcome`` -- the machine identity outcome, verbatim from the v1 rules (``offline_strong``
  / ``offline_limited`` / ``offline_contradict`` for an identity-evaluable row;
  ``target_unregistered`` for the withheld rows; ``offline_unavailable`` /
  ``tooling_or_schema_error`` when a row could not be evaluated -- surfaced, never excluded).

What counts as a Phase F failure is recorded in the artefact's ``acceptance_rule`` block and
enforced by ``validate_validation_review.py``: a genuine identity contradiction (a machine
``offline_contradict`` the operator does not resolve to ``agree`` with evidence, or any operator
``contradict``) or an ``undetermined`` verdict (not a pass; escalated, never redrawn --
``AFLDB-ISSUE-222.md`` §3.5). Every mandatory recheck row and the deterministic audit need a
terminal operator verdict, recorded in a SEPARATE artefact (never in this one, never in the
sample).

Determinism: ``generated_utc`` is frozen to the sample's (itself frozen to the child's), so all
four outputs are byte-reproducible and ``--write`` is idempotent; an existing non-identical
output is never overwritten. Every pinned input -- the sample JSON/CSV, the whole child
lineage, and the retained-evidence inputs the v1 review measured -- is hash-verified before
anything is compared, and the child is re-validated in-process by
``validate_person_bridge_child.py`` (its ``summary_sha256`` must equal the pinned value).

Opens no database (no psycopg import, no ``*DATABASE_URL*`` read), performs no network
request, runs no importer, never modifies the sample, parent, child, prior review or verdict
artefacts. It authorises nothing: Phase F acceptance is decided only by the final validator
over this artefact plus the operator's verdict artefact.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]
sys.path.insert(0, str(TOOL_DIR))

import build_person_bridge_v2 as v2gen                # noqa: E402  (DB-free)
import build_validation_sample as sampler             # noqa: E402  (DB-free)
import review_person_bridge_offline as base           # noqa: E402  (the v1 rules; DB-free)
import validate_person_bridge_child as validator      # noqa: E402  (DB-free)

TOOL = "tools/rebuild/draftguru/review_validation_sample.py"
TOOL_VERSION = "1.0.0"
SCHEMA_VERSION = 1
ISSUE = "AFLDB-ISSUE-222"
LABEL = "20260918-v2"
PHASE = "F"
STRATUM = "validation"
RUNBOOK = "AFLDB-ISSUE-222-OFFLINE-REVIEW-RUNBOOK.md"
CRITERION = "same human, not same club (AFLDB-ISSUE-222.md §3.5); 0 failures required"
REVIEW_WORDING = "retained fitzRoy/AFLDB comparison plus operator exception/audit review"

DEFAULT_AUDIT_SALT = "AFLDB-ISSUE-222/audit-v2"
FITZROY_LABEL = "full-history-20260902"
FITZROY_SNAPSHOT_DIR = "data/sources/afltables/fitzroy_core/full-history-20260902"

# ---------------------------------------------------------------------------
# Pinned inputs for the real 2026-09-18 v2 sample (operator-reported hashes, confirmed here).
# ---------------------------------------------------------------------------

SAMPLE_JSON_SHA256 = "6523bad65d8d92bb2c1bc792d6799660e681c047fdcb5bc2581d85dbf5665578"
SAMPLE_CSV_SHA256 = "afa2b9172211609d1e3032c0d02d0dd92b435138b58dda2fcf2a570f82a17cf2"
SAMPLE_ROWS_SHA256 = "91be2942255fcf086036e5cac7f38651f6d8948b48d5ca54866e258b2d573b52"
CHILD_SUMMARY_SHA256 = "5bc5336be116cc797b011900b3fdbc010cd4dd59a9eba4c4495c321f7e6ce590"

PINNED_INPUTS: dict[str, tuple[str, str]] = {
    **sampler.PINNED_INPUTS,
    "sample_json": (sampler.OUTPUTS["sample_json"], SAMPLE_JSON_SHA256),
    "sample_csv": (sampler.OUTPUTS["sample_csv"], SAMPLE_CSV_SHA256),
}

# Retained-evidence inputs, pinned to the hashes the v1 review measured and recorded
# (bridge-review-verdicts-20260918-v2.json ``inputs``); a change is a refusal.
EVIDENCE_INPUTS: dict[str, tuple[str, str]] = {
    "profile": (
        "data/sources/draftguru/person-html-20260918/parsed/person_profile.jsonl",
        "bad43909112aae4b318336ca4de8576e67608202dd077fdc2f89188b7a04aa37"),
    "stage_a_manifest": (
        "docs/rebuild-manifests/draftguru/annual-html-20260826.json",
        "d06bf6be358663ad3c44a56066c9096fbc4bdf4760349ed181a642476d374652"),
    "stage_a_persons": (
        "data/sources/draftguru/annual-html-20260826/parsed/persons.jsonl",
        "95c98f2aa272b598543357908c91f8b104b5ff501a66405fb1da0a50a4ebcb9d"),
    "fitzroy_register": (
        "data/reference/fitzroy-accepted-baselines.json",
        "c68083aed64e894566054404b93032698e9664d79db377080ad795724d032eef"),
    "fitzroy_manifest": (
        "docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260902.json",
        "2bd66e3df5ce80411363da9e15c6dddadc9eefe5c5c9eca3f5b7bd7106b0a0c1"),
    "fitzroy_contract": (
        "tools/rebuild/fitzroy/fitzroy-contract.json",
        "e4001a8d3a9ec3afb936f9c09cabf5921cd203978c4061465655d2b756e7a466"),
    "ledger": (
        "data/reference/draftguru-link-decisions.json",
        "13ea051e6620a1320e3e60cc34d58ece9c7f08be3205d248c93787edc9a931a1"),
    "aliases": (
        "data/reference/player-name-aliases.json",
        "c77ccbf8b995c56dd9f33b53bb1907115acefe7b090facf6760b200e1d491ee0"),
}

# Name-only corroboration lists: recorded, not pinned (their working-copy bytes are
# line-ending sensitive on Windows -- correction handoff §1 -- and they never decide a row).
UNPINNED_EVIDENCE: dict[str, str] = {
    "awards_census": "data/awards/player-identity.csv",
    "brownlow_census": "data/brownlow/player-identity.csv",
}

EXPECT: dict = {
    "salt": sampler.DEFAULT_SALT,
    "n": sampler.DEFAULT_N,
    "status_counts": {"bridged": 582, "target_not_registered": 16},
    "rows_sha256": SAMPLE_ROWS_SHA256,
    "child_summary_sha256": CHILD_SUMMARY_SHA256,
}

OUTPUTS: dict[str, str] = {
    "verdicts_json": f"docs/rebuild-manifests/draftguru/bridge-validation-verdicts-{LABEL}.json",
    "verdicts_csv": f"docs/rebuild-manifests/draftguru/bridge-validation-verdicts-{LABEL}.csv",
    "recheck": f"docs/rebuild-manifests/draftguru/bridge-validation-recheck-{LABEL}.json",
    "residual": f"docs/rebuild-manifests/draftguru/bridge-validation-residual-{LABEL}.json",
}
OPERATOR_VERDICTS_REL = (
    f"docs/rebuild-manifests/draftguru/bridge-validation-operator-verdicts-{LABEL}.json")

TOOL_SOURCES: dict[str, str] = {"review_validation_sample": TOOL, **sampler.TOOL_SOURCES}

CSV_COLUMNS = [*base.CSV_COLUMNS, "deployment_status", "identity_evaluable", "selection_key"]

OPERATOR_VERDICT_VALUES = ("agree", "contradict", "undetermined")

ACCEPTANCE_RULE = {
    "review_wording": REVIEW_WORDING,
    "criterion": CRITERION,
    "mechanism": ("decision O-4 revision 2: every row compared offline against retained "
                  "evidence by review_person_bridge_offline.py's rules; the operator adjudicates "
                  "every mandatory recheck row (runbook §7 classes 1-10) plus the deterministic "
                  "audit (class 11) with a terminal verdict; verdicts live in "
                  f"{OPERATOR_VERDICTS_REL}, never in this file or the sample"),
    "failure": ("a genuine identity contradiction: a machine offline_contradict the operator "
                "does not resolve to 'agree' with evidence, or any operator 'contradict' "
                "(runbook §8); an operator 'undetermined' is not a pass and is escalated, never "
                "redrawn (AFLDB-ISSUE-222.md §3.5) -- it blocks acceptance of this dataset"),
    "target_not_registered": ("a terminal DEPLOYMENT status (runbook §5, §7 class 3, §9; "
                              "correction handoff §10.3): no link ships and no retained target "
                              "facts exist to compare; counts toward n (decision O-6) and is "
                              "never treated as an identity contradiction; the operator confirms "
                              "continued withholding with 'agree'"),
    "not_terminal": ("offline_unavailable and tooling_or_schema_error rows block acceptance "
                     "until the input is supplied or the tool fixed and the review rerun "
                     "(runbook §9); they are never excluded"),
    "acceptance": ("granted by validate_validation_review.py only when every row carries a "
                   "terminal outcome, every mandatory recheck row and every audit row has a "
                   "terminal operator verdict, every audit row is 'agree', zero genuine "
                   "contradictions and zero 'undetermined' remain, and every hash, count and "
                   "tool reconciles; no post-hoc exclusion, no survivor-only claim"),
    "statement": ("the achieved one-sided 95% upper bound is stated beside n and the observed "
                  "count, at n (O-6: withheld rows count toward n) AND at the identity-evaluable "
                  "row count (conservative), never rounded to '99.9%'; the comparison target is "
                  "AFL Tables-derived retained evidence, not an independent source; the census "
                  "contributes no bound"),
}

NOT_PERFORMED = [
    "any database connection",
    "any network request",
    "any importer run",
    "any operator verdict (recorded separately, never here)",
    "any modification of the sample, parent, child, prior review or verdict artefacts",
    "any DEV or PROD action",
    "any Git command",
]


class ReviewError(base.ToolError):
    """A refusal. Always fails closed; nothing is written."""


def quiet(*_args, **_kwargs) -> None:
    return None


# ---------------------------------------------------------------------------
# Sample checks (fail closed before any row is evaluated)
# ---------------------------------------------------------------------------

def check_sample(sample: dict, *, hashes: dict[str, str], expect: dict,
                 sample_csv_bytes: bytes) -> None:
    if sample.get("schema_version") != sampler.SCHEMA_VERSION or sample.get("phase") != PHASE \
            or sample.get("issue") != ISSUE:
        raise ReviewError("the sample does not declare schema_version 1, phase F and the issue")
    if sample.get("salt") != expect["salt"]:
        raise ReviewError(f"sample salt {sample.get('salt')!r} != expected {expect['salt']!r}")
    rows = sample.get("rows")
    if not isinstance(rows, list) or sample.get("n") != len(rows) or len(rows) != expect["n"]:
        raise ReviewError(f"sample carries n={sample.get('n')!r} over {len(rows or [])} rows; "
                          f"expected exactly {expect['n']}")
    recomputed = base.sha256_bytes(base.canonical_json_bytes(rows))
    if recomputed != sample.get("rows_sha256"):
        raise ReviewError("the sample's rows_sha256 does not reproduce from its rows[]")
    if expect.get("rows_sha256") and recomputed != expect["rows_sha256"]:
        raise ReviewError(f"sample rows_sha256 {recomputed} != pinned {expect['rows_sha256']}")
    child_block = sample.get("child") or {}
    if child_block.get("sha256") != hashes["child_v2_afldb_test"]:
        raise ReviewError("the sample's child.sha256 is not the pinned v2 child hash")
    for key, entry in (sample.get("inputs") or {}).items():
        if key not in hashes or entry.get("sha256") != hashes[key]:
            raise ReviewError(f"the sample's recorded input hash for {key!r} does not match the "
                              "pinned input verified now")
    for name, entry in (sample.get("tool_hashes") or {}).items():
        current = base.sha256_file(REPO_ROOT / entry["path"])
        if current != entry.get("sha256"):
            raise ReviewError(f"tool {entry['path']} changed since the sample was drawn "
                              "(the sample declares any tool-hash change voids it)")
    overlaps = (sample.get("disjointness") or {}).get("overlap_counts") or {}
    if set(overlaps) != {"census_v2", "v1_census", "v1_random", "adjudicated_pack"} \
            or any(v != 0 for v in overlaps.values()):
        raise ReviewError(f"the sample does not record four zero overlaps: {overlaps!r}")
    urls, identities, keys = set(), set(), []
    for index, row in enumerate(rows):
        if set(row) != {"ordinal", "player_url", "afltables_external_id", "child_status",
                        "selection_key"}:
            raise ReviewError(f"sample row {index + 1} carries an unexpected key set")
        if row["ordinal"] != index + 1:
            raise ReviewError(f"sample ordinals are not 1..n at position {index + 1}")
        if row["child_status"] not in ("bridged", "target_not_registered"):
            raise ReviewError(f"sample row {index + 1} has child_status {row['child_status']!r}")
        if row["selection_key"] != sampler.salted_key(sample["salt"], row["player_url"]):
            raise ReviewError(f"sample row {index + 1} selection_key is not "
                              "sha256(salt|player_url)")
        urls.add(row["player_url"])
        identities.add(row["afltables_external_id"])
        keys.append((row["selection_key"], row["player_url"]))
    if len(urls) != len(rows) or len(identities) != len(rows):
        raise ReviewError("the sample repeats a person or an identity")
    if keys != sorted(keys):
        raise ReviewError("the sample rows are not in selection-key order")
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["child_status"]] = counts.get(row["child_status"], 0) + 1
    if counts != expect["status_counts"] or child_block.get("status_counts_in_sample") != counts:
        raise ReviewError(f"sample child-status counts {counts} != expected "
                          f"{expect['status_counts']} / recorded "
                          f"{child_block.get('status_counts_in_sample')!r}")
    if sampler.render_csv(rows) != sample_csv_bytes:
        raise ReviewError("the sample CSV is not the canonical rendering of the sample rows")


# ---------------------------------------------------------------------------
# The review
# ---------------------------------------------------------------------------

def csv_row(r: dict) -> list:
    """The v1 CSV columns exactly as review_person_bridge_offline.write_csv renders them
    (parity pinned by the contract), plus the Phase F columns."""
    rt = r.get("retained_target") or {}
    birth_year = ((rt.get("dob_years") or [None])[0] if rt.get("dob_years")
                  else rt.get("implied_birth_year"))
    earliest = (r.get("stage_a") or {}).get("earliest_original_recruitment") or {}
    return [
        r["sample_index"], r["stratum"], r["player_url"], r["expected_afltables_identity"],
        r["child_status"], r["outcome"], ";".join(r["reason_codes"]),
        (r.get("draftguru") or {}).get("visible_name"),
        (r.get("draftguru") or {}).get("title_birth_year"),
        birth_year, rt.get("debut_season"), rt.get("last_season"), rt.get("career_games"),
        earliest.get("draft_year"), earliest.get("event_type_raw"),
        r["flags"]["numeric_suffix"], r["flags"]["continuity_rule_url"],
        r["flags"]["name_variant"], r["flags"]["known_exception_class"] or "",
        r["ledger_status"], r["weak_evidence"], r["operator_review_required"],
        ";".join(r["missing_fields"]),
        r["deployment_status"], r["identity_evaluable"], r["selection_key"],
    ]


def render_csv(rows: list[dict]) -> bytes:
    buf = io.StringIO(newline="")
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    for r in rows:
        writer.writerow(csv_row(r))
    return buf.getvalue().encode("utf-8")


def review(root: Path, *, pinned: dict[str, tuple[str, str]] | None = None,
           evidence: dict[str, tuple[str, str]] | None = None,
           unpinned: dict[str, str] | None = None,
           expect: dict | None = None, child_expect: dict | None = None,
           audit_salt: str = DEFAULT_AUDIT_SALT,
           fitzroy_snapshot_dir: str = FITZROY_SNAPSHOT_DIR,
           fitzroy_index: dict | None = None,
           skip_fitzroy_byte_verify: bool = False) -> dict:
    """Compute all four output byte strings. Writes nothing."""
    pinned = dict(PINNED_INPUTS if pinned is None else pinned)
    evidence = dict(EVIDENCE_INPUTS if evidence is None else evidence)
    unpinned = dict(UNPINNED_EVIDENCE if unpinned is None else unpinned)
    expect = dict(EXPECT if expect is None else expect)
    if not audit_salt or "|" in audit_salt:
        raise ReviewError(f"the audit salt must be non-empty and must not contain '|': {audit_salt!r}")

    hashes = v2gen.hash_inputs(root, expected={**pinned, **evidence})
    recorded: dict[str, dict] = {
        key: {"path": rel, "sha256": hashes[key]}
        for key, (rel, _) in {**pinned, **evidence}.items()}
    for key, rel in unpinned.items():
        path = root / rel
        recorded[key] = {"path": rel, "sha256": base.sha256_file(path) if path.is_file() else None,
                         "pinned": False}

    # -- Gate: the child re-validates in-process and matches the pinned summary ------------
    child_rel, child_sha = pinned["child_v2_afldb_test"]
    child_summary = validator.validate(
        root, child_rel=child_rel, expect_child_sha256=child_sha,
        pinned={key: pinned[key] for key in validator.PINNED_INPUTS},
        expect=child_expect, emit=quiet)
    if child_summary["failures"]:
        raise ReviewError("child validation failed; refusing to review a sample over an "
                          f"unvalidated child: {child_summary['failures']}")
    if expect.get("child_summary_sha256") \
            and child_summary["summary_sha256"] != expect["child_summary_sha256"]:
        raise ReviewError(f"child validation summary_sha256 {child_summary['summary_sha256']} "
                          f"!= pinned {expect['child_summary_sha256']}")

    # -- The sample --------------------------------------------------------------------------
    sample = base.load_json(root / pinned["sample_json"][0], "validation sample")
    check_sample(sample, hashes=hashes, expect=expect,
                 sample_csv_bytes=(root / pinned["sample_csv"][0]).read_bytes())
    if child_summary["summary_sha256"] not in ((sample.get("child") or {}).get("validation") or ""):
        raise ReviewError("the sample's recorded child validation does not name the "
                          "summary_sha256 reproduced now")
    sample_rows: list[dict] = sample["rows"]

    # -- Lineage: every sample row agrees with the parent and the validated child ------------
    parent = base.load_json(root / pinned["parent_v2"][0], "v2 parent")
    child = base.load_json(root / child_rel, "v2 child")
    if parent.get("kind") != "source-evidence" or child.get("kind") != "deployment":
        raise ReviewError("parent must be source-evidence and child must be deployment")
    parent_identity_by_url = {b["player_url"]: b["afltables_external_id"]
                              for b in parent["bridges"]}
    child_bridged = {b["player_url"] for b in child["bridges"]}
    child_withheld_reason = {w["player_url"]: w["reason"] for w in child["withheld"]}
    for row in sample_rows:
        url = row["player_url"]
        if parent_identity_by_url.get(url) != row["afltables_external_id"]:
            raise ReviewError(f"lineage: sample identity for {url} is not the v2 parent's")
        status = ("bridged" if url in child_bridged
                  else child_withheld_reason.get(url, "absent_from_child"))
        if status != row["child_status"]:
            raise ReviewError(f"lineage: sample child_status for {url} ({row['child_status']}) "
                              f"is not the validated child's ({status})")

    # -- Retained evidence (exactly what the v1 review loads) --------------------------------
    fitzroy_register = base.load_json(root / evidence["fitzroy_register"][0], "fitzRoy register")
    fitzroy_manifest = base.load_json(root / evidence["fitzroy_manifest"][0], "fitzRoy manifest")
    fitzroy_contract = base.load_json(root / evidence["fitzroy_contract"][0], "fitzRoy contract")
    ledger = base.load_json(root / evidence["ledger"][0], "ledger")
    aliases_doc = base.load_json(root / evidence["aliases"][0], "aliases")
    snapshot_dir = root / fitzroy_snapshot_dir
    files_verified: int | None = None
    if not skip_fitzroy_byte_verify:
        files_verified = base.verify_fitzroy_bytes(fitzroy_manifest, snapshot_dir)["verified_ok"]
    if fitzroy_index is None:
        fitzroy_index = base.build_fitzroy_index(snapshot_dir, fitzroy_manifest, fitzroy_contract)

    profile_by_url = {r["player_url"]: r
                      for r in base.load_jsonl(root / evidence["profile"][0], "profile")}
    stage_a_rows_by_url: dict[str, list[dict]] = {}
    for r in base.load_jsonl(root / pinned["stage_a_rows"][0], "Stage A rows"):
        stage_a_rows_by_url.setdefault(r["player_url"], []).append(r)
    stage_a_persons_by_url = {
        r["player_url"]: r
        for r in base.load_jsonl(root / evidence["stage_a_persons"][0], "Stage A persons")}
    ledger_by_url = {d["player_url"]: d for d in ledger.get("decisions", [])}
    aliases_by_identity: dict[str, list[str]] = {}
    for a in aliases_doc.get("aliases", []):
        if a.get("source") == "afltables":
            aliases_by_identity.setdefault(a["external_id"], []).append(a["alias"])
    awards_census = base.load_census_map(root / unpinned["awards_census"])
    for k, v in base.load_census_map(root / unpinned["brownlow_census"]).items():
        awards_census.setdefault(k, set()).update(v)
    continuity_paths: set[str] = set()
    for rule in fitzroy_contract.get("profile_url_continuity", {}).get("rules", []):
        continuity_paths.add(rule["continuing_url"])
        continuity_paths.add(rule["renumbered_url"])

    # -- Row evaluation: the v1 rules, verbatim, in sample order -------------------------------
    rows_out: list[dict] = []
    for row in sample_rows:
        evaluated = base.evaluate_row(
            player_url=row["player_url"], stratum=STRATUM, sample_index=row["ordinal"],
            ordinal=row["ordinal"], parent_identity_by_url=parent_identity_by_url,
            child_bridged=child_bridged, child_withheld_reason=child_withheld_reason,
            profile_by_url=profile_by_url, stage_a_rows_by_url=stage_a_rows_by_url,
            stage_a_persons_by_url=stage_a_persons_by_url, fitzroy_index=fitzroy_index,
            ledger_by_url=ledger_by_url, aliases_by_identity=aliases_by_identity,
            awards_census_by_identity=awards_census, numbering_urls=base.NUMBERING_SLUGS,
            spelling_urls=base.SPELLING_SLUGS, schwerdt_urls=base.SCHWERDT_SLUGS,
            continuity_paths=continuity_paths)
        if evaluated["outcome"] not in base.OUTCOMES:
            raise ReviewError(f"unknown outcome {evaluated['outcome']!r}")
        evaluated["deployment_status"] = row["child_status"]
        evaluated["identity_evaluable"] = evaluated["outcome"] in (
            "offline_strong", "offline_limited", "offline_contradict")
        evaluated["selection_key"] = row["selection_key"]
        rows_out.append(evaluated)
    if len(rows_out) != len(sample_rows):
        raise ReviewError("row count drifted from the sample during evaluation")

    totals = {o: 0 for o in base.OUTCOMES}
    deployment = {"bridged": 0, "target_not_registered": 0}
    for r in rows_out:
        totals[r["outcome"]] += 1
        deployment[r["deployment_status"]] += 1
    totals["completed"] = len(rows_out)
    totals["remaining"] = 0
    totals["identity_evaluable"] = sum(1 for r in rows_out if r["identity_evaluable"])
    totals["deployment_status"] = deployment
    totals["machine_contradictions_observed"] = totals["offline_contradict"]
    totals["not_terminal"] = totals["offline_unavailable"] + totals["tooling_or_schema_error"]

    rows_sha256 = base.sha256_bytes(base.canonical_json_bytes(rows_out))
    generated_utc = sample["generated_utc"]
    n = len(rows_out)
    evaluable = totals["identity_evaluable"]
    tool_hashes = {name: {"path": rel, "sha256": base.sha256_file(REPO_ROOT / rel)}
                   for name, rel in TOOL_SOURCES.items()}

    header = {
        "$comment": (f"{ISSUE} Phase F machine review of the disjoint new-salt validation "
                     "sample: the v1 offline rules applied row by row in sample order. "
                     "operator_verdict is ALWAYS null here; the operator's verdicts live in "
                     f"{OPERATOR_VERDICTS_REL}. Acceptance is decided only by "
                     "validate_validation_review.py. This file authorises nothing."),
        "schema_version": SCHEMA_VERSION,
        "issue": ISSUE, "label": LABEL, "phase": PHASE,
        "review_method": base.REVIEW_METHOD, "runbook": RUNBOOK,
        "tool": {"path": TOOL, "version": TOOL_VERSION},
        "base_tool": {"path": base.TOOL, "version": base.TOOL_VERSION,
                      "note": "evaluate_row/build_recheck_queue/build_residual_report imported "
                              "verbatim; never copied, never edited"},
        "generated_utc": generated_utc,
        "generated_utc_basis": ("frozen to the sample's generated_utc (itself the validated "
                                "child's) so every output is byte-reproducible; not a wall clock"),
        "status": "MACHINE_REVIEW_COMPLETE; operator adjudication PENDING",
        "sample": {"path": pinned["sample_json"][0], "sha256": hashes["sample_json"],
                   "csv_path": pinned["sample_csv"][0], "csv_sha256": hashes["sample_csv"],
                   "rows_sha256": sample["rows_sha256"], "salt": sample["salt"],
                   "prior_salt": sample.get("prior_salt"), "n": n},
        "child": {"path": child_rel, "sha256": hashes["child_v2_afldb_test"],
                  "generated_utc": child.get("generated_utc"),
                  "validation_summary_sha256": child_summary["summary_sha256"],
                  "validation_checks": len(child_summary["checks"])},
        "inputs": recorded,
        "fitzroy_snapshot": {
            "label": FITZROY_LABEL, "snapshot_dir": fitzroy_snapshot_dir,
            "artefact_set_sha256": next(
                (b["raw_artefacts"]["artefact_set_sha256"]
                 for b in fitzroy_register.get("baselines", [])
                 if b.get("acceptance_status") == "accepted"), None),
            "files_verified": files_verified,
            "index_source": "injected (test-only)" if skip_fitzroy_byte_verify else "snapshot csv scan",
        },
        "tool_hashes": tool_hashes,
        "audit_salt": audit_salt,
        "zero_failure_bound": {
            "formula": sampler.BOUND_FORMULA,
            "n": n,
            "one_sided_95_upper_bound_at_n": round(sampler.zero_failure_upper_bound(n), 6),
            "identity_evaluable_n": evaluable,
            "one_sided_95_upper_bound_at_identity_evaluable_n": (
                round(sampler.zero_failure_upper_bound(evaluable), 6) if evaluable else None),
            "note": ("achievable only with 0 failures after operator adjudication; both figures "
                     "are stated beside the observed count (O-6: withheld rows count toward n; "
                     "the second is the conservative figure over identity-evaluated rows); "
                     "never rounded to '99.9%'"),
        },
        "acceptance_rule": ACCEPTANCE_RULE,
        "operator_verdict_storage": {
            "path": OPERATOR_VERDICTS_REL,
            "template": OUTPUTS["recheck"],
            "allowed_verdicts": list(OPERATOR_VERDICT_VALUES),
            "rule": ("copy the recheck queue, add source_recheck_sha256 (the recheck file's "
                     "sha256) and review_completed_utc, fill operator_verdict/reviewed_utc per "
                     "row; 'contradict' and 'undetermined' require notes AND evidence; the "
                     "machine outcome is never edited"),
        },
        "not_performed": NOT_PERFORMED,
        "total_expected_rows": n,
    }
    verdict_doc = {**header, "rows": rows_out, "totals": totals, "rows_sha256": rows_sha256}
    verdicts_bytes = base.dump_json_lf(verdict_doc)
    verdicts_sha256 = base.sha256_bytes(verdicts_bytes)

    recheck = base.build_recheck_queue(
        rows_out, audit_salt=audit_salt, verdicts_sha256=verdicts_sha256,
        sample_sha256=hashes["sample_json"], parent_sha256=hashes["parent_v2"],
        child_sha256=hashes["child_v2_afldb_test"])
    recheck["generated_utc"] = generated_utc          # frozen, never a wall clock
    recheck["issue"], recheck["label"], recheck["phase"] = ISSUE, LABEL, PHASE
    recheck["verdicts_path"] = OUTPUTS["verdicts_json"]
    mandatory = {ref["player_url"] for key, refs in recheck["classes"].items()
                 if not key.startswith("11_") for ref in refs}
    recheck["mandatory_distinct_rows"] = len(mandatory)
    recheck["operator_verdict_storage"] = header["operator_verdict_storage"]
    recheck_bytes = base.dump_json_lf(recheck)

    residual = base.build_residual_report(rows_out)
    residual["generated_utc"] = generated_utc         # frozen, never a wall clock
    residual["issue"], residual["label"], residual["phase"] = ISSUE, LABEL, PHASE
    residual["verdicts_sha256"] = verdicts_sha256
    residual["sample_sha256"] = hashes["sample_json"]
    residual_bytes = base.dump_json_lf(residual)

    outputs = {"verdicts_json": verdicts_bytes, "verdicts_csv": render_csv(rows_out),
               "recheck": recheck_bytes, "residual": residual_bytes}
    for key, data in outputs.items():
        v2gen.screen_output_bytes(key, data)

    return {"verdict_doc": verdict_doc, "rows": rows_out, "totals": totals,
            "rows_sha256": rows_sha256, "outputs": outputs, "hashes": hashes,
            "recheck": recheck, "residual": residual, "child_summary": child_summary}


# ---------------------------------------------------------------------------
# Output lifecycle (identical policy to build_validation_sample: never overwrite a differing file)
# ---------------------------------------------------------------------------

def compare_outputs(root: Path, outputs: dict[str, bytes]) -> dict[str, str]:
    status: dict[str, str] = {}
    for key, data in outputs.items():
        path = root / OUTPUTS[key]
        if not path.exists():
            status[key] = "absent"
        elif path.read_bytes() == data:
            status[key] = "identical"
        else:
            status[key] = "DIFFERS"
    return status


def write_outputs(root: Path, outputs: dict[str, bytes]) -> dict[str, str]:
    status = compare_outputs(root, outputs)
    differing = sorted(k for k, s in status.items() if s == "DIFFERS")
    if differing:
        raise ReviewError(
            f"existing output(s) {differing} differ from this run; a review artefact is never "
            "overwritten -- a changed input, tool, rule or salt requires a new version")
    for key, data in outputs.items():
        if status[key] == "absent":
            base.atomic_write_bytes(root / OUTPUTS[key], data)
            status[key] = "written"
    return status


def run(root: Path, *, mode: str, emit=print, **kwargs) -> int:
    if mode not in ("validate-only", "write"):
        raise ReviewError(f"unknown mode {mode!r}")
    pinned = dict(PINNED_INPUTS if kwargs.get("pinned") is None else kwargs["pinned"])
    evidence = dict(EVIDENCE_INPUTS if kwargs.get("evidence") is None else kwargs["evidence"])
    try:
        result = review(root, **kwargs)
        if mode == "write":
            status = write_outputs(root, result["outputs"])
            after = v2gen.hash_inputs(root, expected={**pinned, **evidence})
            if after != result["hashes"]:
                raise ReviewError("a pinned input changed during the run")
        else:
            status = compare_outputs(root, result["outputs"])
    except base.ToolError as exc:
        emit(f"REFUSED: {exc}")
        return 1

    doc = result["verdict_doc"]
    report = {
        "mode": mode,
        "n": doc["total_expected_rows"],
        "totals": result["totals"],
        "recheck": {"mandatory_distinct_rows": result["recheck"]["mandatory_distinct_rows"],
                    "audit_rows": result["recheck"]["audit"]["count"],
                    "audit_salt": result["recheck"]["audit"]["salt"],
                    "classes": {k: len(v) for k, v in result["recheck"]["classes"].items()}},
        "rows_sha256": result["rows_sha256"],
        "zero_failure_bound": doc["zero_failure_bound"],
        "outputs": {key: {"path": OUTPUTS[key], "status": status[key],
                          "sha256": base.sha256_bytes(result["outputs"][key])}
                    for key in OUTPUTS},
        "operator_verdicts_path": OPERATOR_VERDICTS_REL,
        "status": doc["status"],
        "written": mode == "write",
    }
    emit(json.dumps(report, ensure_ascii=True, sort_keys=True, indent=2))
    if mode == "validate-only" and any(s == "DIFFERS" for s in status.values()):
        emit("validate-only: an existing output DIFFERS from this run (nothing written)")
        return 1
    emit("validate-only: nothing written" if mode == "validate-only"
         else "write: complete (existing identical outputs left untouched)")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--validate-only", action="store_true",
                      help="compute the review, compare with any existing output, write nothing")
    mode.add_argument("--write", action="store_true",
                      help="write all four outputs (never over a non-identical existing file)")
    ap.add_argument("--audit-salt", default=DEFAULT_AUDIT_SALT)
    ap.add_argument("--fitzroy-snapshot-dir", default=FITZROY_SNAPSHOT_DIR,
                    help="repository-relative directory holding the accepted fitzRoy bytes")
    ap.add_argument("--root", default=str(REPO_ROOT),
                    help="repository root (tests point this at a fixture tree)")
    args = ap.parse_args(argv)
    return run(Path(args.root), mode="write" if args.write else "validate-only",
               audit_salt=args.audit_salt, fitzroy_snapshot_dir=args.fitzroy_snapshot_dir)


if __name__ == "__main__":
    raise SystemExit(main())
