#!/usr/bin/env python3
"""AFLDB-ISSUE-222 Phase F -- the disjoint, new-salt (``AFLDB-ISSUE-222/v2``) bridge
validation sample. DB-free.

    python tools/rebuild/draftguru/build_validation_sample.py --validate-only
    python tools/rebuild/draftguru/build_validation_sample.py --write

Contract (``AFLDB-ISSUE-222.md`` §3.5 item 4 and §11.11 "Phase F"; population-scan decision
pack v2 §9):

* sampling frame = the v2 SOURCE-EVIDENCE parent's ``bridges[]`` -- never a deployment child
  (§4.5; the same guard ``--review-sample`` carries) -- minus the census stratum (every
  bridged National Draft top-10 person, reviewed exhaustively under v1), minus every person
  already drawn into the v1 review sample (399 census + 598 random, salt
  ``AFLDB-ISSUE-222/v1``), minus -- by default -- the 83 persons the operator adjudicated in
  the population-scan pack ("prior discovery rows"; ``--include-adjudicated`` keeps them);
* ordering ``sha256(salt + "|" + player_url)`` hex ascending, ties by ``player_url``
  (identical to ``export_person_bridge.salted_key``, pinned by the contract test);
* the first ``n`` (default 598) form the sample; ``n`` larger than the frame is a refusal;
* the salt must differ from the prior sample's salt;
* the census must be identical to the v1 census (a change would mean the mechanism-scoped
  census re-check of §3.5 item 4 is needed and is an operator matter, so it is a refusal).

Gate: the v2 ``afldb_test`` child must pass ``validate_person_bridge_child.py`` in the same
process, against the same pinned hashes; any failure refuses generation. Every pinned input
is re-hashed after a write.

Determinism: ``generated_utc`` is frozen to the validated child's ``generated_utc`` (the
moment eligibility was frozen), never a wall clock, so both outputs are byte-reproducible and
``--write`` can prove idempotence. Verdicts are NEVER written into the sample; a separate
versioned verdict artefact records them and this file is never edited.

The tool opens no database (no psycopg import, no ``*DATABASE_URL*`` read), performs no
network request, runs no importer and never modifies the parent, child, prior sample or
verdict artefacts. Nothing else is authorised by it: Phase 3 acceptance and Phase 4 remain
pending until the operator reviews the sample under the same criterion as v1.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sys
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]
sys.path.insert(0, str(TOOL_DIR))

import build_person_bridge_v2 as v2gen                # noqa: E402  (DB-free)
import profile_person_pages as profiler               # noqa: E402  (offline, stdlib only)
import review_person_bridge_offline as base           # noqa: E402  (DB-free shared helpers)
import validate_person_bridge_child as validator      # noqa: E402  (DB-free)

TOOL = "tools/rebuild/draftguru/build_validation_sample.py"
TOOL_VERSION = "1.0.0"
SCHEMA_VERSION = 1
ISSUE = "AFLDB-ISSUE-222"
LABEL = "20260918-v2"
PHASE = "F"

DEFAULT_SALT = "AFLDB-ISSUE-222/v2"
DEFAULT_N = 598
ORDERING_FORMULA = 'sha256(salt + "|" + player_url) hex ascending, ties by player_url'
BOUND_FORMULA = "1 - 0.05^(1/n)  (one-sided 95% upper bound on the error rate at 0 failures)"

OUTPUTS: dict[str, str] = {
    "sample_json": "docs/rebuild-manifests/draftguru/bridge-validation-sample-20260918-v2.json",
    "sample_csv": "docs/rebuild-manifests/draftguru/bridge-validation-sample-20260918-v2.csv",
}

PINNED_INPUTS: dict[str, tuple[str, str]] = {
    **validator.PINNED_INPUTS,
    "child_v2_afldb_test": (validator.CHILD_REL, validator.EXPECTED_CHILD_SHA256),
    "review_sample_v1": (
        "docs/rebuild-manifests/draftguru/bridge-review-20260918-v1.json",
        "036cc0826428c03a622448d299b803c23bac011bd5cd92eea86c4283e445ba84"),
    "stage_a_rows": (
        "data/sources/draftguru/annual-html-20260826/parsed/rows.jsonl",
        "06936baca3b37133949847e7589008a06be76bbc8f1fb5b4d2fef8b743838a64"),
}

# Source files whose hashes are frozen into the sample ("tool hashes frozen before review";
# any tool change voids the sample and requires a new version/salt).
TOOL_SOURCES: dict[str, str] = {
    "build_validation_sample": TOOL,
    "validate_person_bridge_child": validator.TOOL,
    "build_person_bridge_v2": v2gen.TOOL,
    "review_person_bridge_offline": base.TOOL,
    "profile_person_pages": "tools/rebuild/draftguru/profile_person_pages.py",
}

CSV_COLUMNS = ["ordinal", "player_url", "afltables_external_id", "child_status", "selection_key"]

NOT_PERFORMED = [
    "any database connection",
    "any network request",
    "any importer run",
    "any review verdict (the sample is UNREVIEWED)",
    "any modification of the v1/v2 parent, child, prior sample or verdict artefacts",
    "any DEV or PROD action",
    "any Git command",
]


class SampleBuildError(base.ToolError):
    """A refusal. Always fails closed; nothing is written."""


# ---------------------------------------------------------------------------
# Selection primitives
# ---------------------------------------------------------------------------

def salted_key(salt: str, player_url: str) -> str:
    """Byte-identical to export_person_bridge.salted_key (the v1 formula)."""
    return hashlib.sha256(f"{salt}|{player_url}".encode("utf-8")).hexdigest()


def zero_failure_upper_bound(n: int) -> float:
    return 1.0 - 0.05 ** (1.0 / n)


def url_bytes(url: str) -> bytes:
    return url.encode("utf-8")


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def build(root: Path, *, salt: str = DEFAULT_SALT, n: int = DEFAULT_N,
          exclude_adjudicated: bool = True,
          pinned: dict[str, tuple[str, str]] | None = None,
          child_expect: dict | None = None) -> dict:
    """Compute the sample and both output byte strings. Writes nothing."""
    pinned = dict(PINNED_INPUTS if pinned is None else pinned)
    if not isinstance(n, int) or n <= 0:
        raise SampleBuildError(f"--n must be a positive integer, got {n!r}")
    if not salt or "|" in salt:
        raise SampleBuildError(f"the salt must be non-empty and must not contain '|': {salt!r}")

    hashes = v2gen.hash_inputs(root, expected=pinned)

    # -- Gate: the child must validate, silently, in this process ------------------------
    child_rel, child_sha = pinned["child_v2_afldb_test"]
    validator_pinned = {key: pinned[key] for key in validator.PINNED_INPUTS}
    child_summary = validator.validate(
        root, child_rel=child_rel, expect_child_sha256=child_sha, pinned=validator_pinned,
        expect=child_expect, emit=lambda *_args, **_kw: None)
    if child_summary["failures"]:
        raise SampleBuildError(
            "child validation failed; refusing to draw a sample over an unvalidated child: "
            f"{child_summary['failures']}")

    url_re = v2gen.load_canonical_url_regex(root)
    contract = base.load_json(root / v2gen.CONTRACT_PATH, "DraftGuru contract")
    parent = base.load_json(root / pinned["parent_v2"][0], "v2 parent")
    child = base.load_json(root / child_rel, "v2 child")
    sample_v1 = base.load_json(root / pinned["review_sample_v1"][0], "v1 review sample")
    verdicts = base.load_json(root / pinned["operator_verdicts_json"][0], "operator verdicts")

    v2gen.self_validate_bridge_schema(parent, url_re)
    if parent.get("kind") != "source-evidence":
        raise SampleBuildError(
            "the sampling frame must be the SOURCE-EVIDENCE parent, never a deployment child "
            f"(input declares kind={parent.get('kind')!r})")

    # -- Census (v2) from the Stage A top-10 index, pinned to the same rows.jsonl -----------
    stage_a_label = (parent.get("provenance") or {}).get("stage_a_label")
    if not stage_a_label:
        raise SampleBuildError("the v2 parent carries no provenance.stage_a_label")
    stage_a_dir = root / contract["snapshot"]["root"] / stage_a_label
    pinned_rows = (root / pinned["stage_a_rows"][0]).resolve()
    if pinned_rows != (stage_a_dir / "parsed" / "rows.jsonl").resolve():
        raise SampleBuildError(
            f"the pinned stage_a_rows path {pinned['stage_a_rows'][0]!r} is not the parent's "
            f"Stage A snapshot ({stage_a_label!r}); refusing to derive the census from a "
            "different snapshot")
    top10 = profiler.load_year_top10_index(stage_a_dir)

    parent_map = {e["player_url"]: e["afltables_external_id"] for e in parent["bridges"]}
    bridged = sorted(parent_map, key=url_bytes)
    census_v2 = {url for url in bridged if (top10.get(url) or {}).get("top10_national")}

    v1_census = {r["player_url"] for r in sample_v1.get("census_stratum", [])}
    v1_random = {r["player_url"] for r in sample_v1.get("random_stratum", [])}
    prior_salt = sample_v1.get("salt")
    if not prior_salt or prior_salt == salt:
        raise SampleBuildError(
            f"the new salt {salt!r} must differ from the prior sample's salt {prior_salt!r} "
            "(§3.5 item 4: a fresh random stratum with a NEW salt)")
    if v1_census & v1_random:
        raise SampleBuildError("the prior sample's census and random strata overlap")
    if census_v2 != v1_census:
        raise SampleBuildError(
            "the v2 census differs from the v1 census -- a mechanism-scoped census re-check "
            "(§3.5 item 4) is an operator matter, not a sampling matter: "
            f"only-v2={sorted(census_v2 - v1_census)[:6]} only-v1={sorted(v1_census - census_v2)[:6]}")

    adjudicated = {row["draftguru_url"] for row in verdicts.get("rows", [])}

    # -- Frame and exclusions -------------------------------------------------------------
    non_census = [url for url in bridged if url not in census_v2]
    exclusions: dict[str, set[str]] = {"v1_census": v1_census, "v1_random": v1_random}
    if exclude_adjudicated:
        exclusions["adjudicated_pack"] = adjudicated
    excluded_union: set[str] = set().union(*exclusions.values())
    frame = [url for url in non_census if url not in excluded_union]
    non_census_set = set(non_census)
    excluded_by_source = {name: len(non_census_set & urls) for name, urls in exclusions.items()}
    if n > len(frame):
        raise SampleBuildError(
            f"n={n} exceeds the eligible frame ({len(frame)} persons after excluding the "
            f"census and {len(non_census_set & excluded_union)} prior rows); refusing")

    ranked = sorted(frame, key=lambda url: (salted_key(salt, url), url))
    selected = ranked[:n]

    child_acc = {e["player_url"] for e in child.get("bridges", [])}
    child_wh = {e["player_url"]: e["reason"] for e in child.get("withheld", [])}

    def child_status(url: str) -> str:
        if url in child_acc:
            return "bridged"
        return child_wh.get(url, "absent_from_child")

    rows = [{
        "ordinal": index + 1,
        "player_url": url,
        "afltables_external_id": parent_map[url],
        "child_status": child_status(url),
        "selection_key": salted_key(salt, url),
    } for index, url in enumerate(selected)]
    if any(r["child_status"] == "absent_from_child" for r in rows):
        raise SampleBuildError("a sampled parent-bridged person is absent from the child")

    # -- Disjointness proofs (by construction, then asserted) ------------------------------
    selected_set = set(selected)
    overlaps = {
        "census_v2": len(selected_set & census_v2),
        "v1_census": len(selected_set & v1_census),
        "v1_random": len(selected_set & v1_random),
        "adjudicated_pack": len(selected_set & adjudicated),
    }
    if len(selected_set) != len(selected):
        raise SampleBuildError("the sample contains a duplicate person")
    if overlaps["census_v2"] or overlaps["v1_census"] or overlaps["v1_random"] \
            or (exclude_adjudicated and overlaps["adjudicated_pack"]):
        raise SampleBuildError(f"the sample is not disjoint from its exclusions: {overlaps}")

    status_counts: dict[str, int] = {}
    for r in rows:
        status_counts[r["child_status"]] = status_counts.get(r["child_status"], 0) + 1

    rows_sha256 = base.sha256_bytes(base.canonical_json_bytes(rows))
    generated_utc = child["generated_utc"]
    tool_hashes = {
        name: {"path": rel, "sha256": base.sha256_file(REPO_ROOT / rel)}
        for name, rel in TOOL_SOURCES.items()}
    inputs = {key: {"path": rel, "sha256": hashes[key]} for key, (rel, _) in pinned.items()}

    payload = {
        "$comment": (f"{ISSUE} Phase F disjoint new-salt bridge VALIDATION sample (runbook §3.5 "
                     "item 4). One random stratum drawn on the v2 SOURCE-EVIDENCE parent, "
                     "excluding the census and every previously reviewed/adjudicated person. "
                     "UNREVIEWED: verdicts are recorded in a separate versioned artefact and "
                     "this file is never edited. It authorises no import, no database "
                     "connection, no network request and no DEV/PROD action."),
        "schema_version": SCHEMA_VERSION,
        "issue": ISSUE,
        "label": LABEL,
        "phase": PHASE,
        "tool": {"path": TOOL, "version": TOOL_VERSION},
        "generated_utc": generated_utc,
        "generated_utc_basis": ("frozen to the validated v2 afldb_test child's generated_utc "
                                "(the moment bridge-v2 eligibility was frozen) so this artefact "
                                "is byte-reproducible; not a wall-clock generation time"),
        "salt": salt,
        "prior_salt": prior_salt,
        "n": n,
        "ordering": ORDERING_FORMULA,
        "zero_failure_bound": {
            "n": n,
            "formula": BOUND_FORMULA,
            "one_sided_95_upper_bound": round(zero_failure_upper_bound(n), 6),
            "note": ("achieved only if every reviewed row is same-person; stated beside the "
                     "observed count, never rounded to '99.9%'; the census contributes no bound"),
        },
        "frame": {
            "basis": "v2 source-evidence parent bridges[] (never the deployment child)",
            "parent_bridges": len(bridged),
            "census_v2": len(census_v2),
            "census_equals_v1_census": True,
            "non_census": len(non_census),
            "excluded_by_source": excluded_by_source,
            "excluded_union": len(non_census_set & excluded_union),
            "eligible": len(frame),
            "exclusion_policy": (
                "census excluded (reviewed exhaustively under v1; re-checked only per "
                "mechanism, §3.5 item 4); v1 census + v1 random excluded (disjoint redraw); "
                + ("the 83 operator-adjudicated pack persons excluded ('prior discovery rows')"
                   if exclude_adjudicated else
                   "the operator-adjudicated pack persons NOT excluded (--include-adjudicated)")),
        },
        "disjointness": {
            "overlap_counts": overlaps,
            "prior_sample": {"path": pinned["review_sample_v1"][0],
                             "sha256": hashes["review_sample_v1"],
                             "census_total": len(v1_census), "random_total": len(v1_random)},
            "adjudicated_pack_persons": len(adjudicated),
        },
        "child": {
            "path": child_rel, "sha256": child_sha, "generated_utc": generated_utc,
            "validation": (f"PASS -- {validator.TOOL} {validator.TOOL_VERSION}, "
                           f"{len(child_summary['checks'])} checks, summary_sha256 "
                           f"{child_summary['summary_sha256']}"),
            "status_counts_in_sample": status_counts,
        },
        "inputs": inputs,
        "tool_hashes": tool_hashes,
        "review": {
            "status": "UNREVIEWED",
            "criterion": "same human, not same club (AFLDB-ISSUE-222.md §3.5); 0 failures required",
            "verdict_storage": ("separate versioned artefact bridge-validation-verdicts-"
                                f"{LABEL}.json; this sample is never edited"),
            "voids_sample": "any change to a tool hash, input hash, salt, n or rule",
        },
        "not_performed": NOT_PERFORMED,
        "rows_sha256": rows_sha256,
        "rows": rows,
    }

    json_bytes = base.dump_json_lf(payload)
    csv_bytes = render_csv(rows)
    v2gen.screen_output_bytes("sample_json", json_bytes)
    v2gen.screen_output_bytes("sample_csv", csv_bytes)

    return {
        "payload": payload,
        "outputs": {"sample_json": json_bytes, "sample_csv": csv_bytes},
        "hashes": hashes,
        "frame": frame,
        "ranked": ranked,
        "census_v2": census_v2,
        "child_summary": child_summary,
    }


def render_csv(rows: list[dict]) -> bytes:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_COLUMNS, lineterminator="\n")
    writer.writeheader()
    for r in rows:
        writer.writerow({c: r[c] for c in CSV_COLUMNS})
    return buf.getvalue().encode("utf-8")


# ---------------------------------------------------------------------------
# Output lifecycle
# ---------------------------------------------------------------------------

def compare_outputs(root: Path, outputs: dict[str, bytes]) -> dict[str, str]:
    """absent / identical / DIFFERS for every declared output, without writing."""
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
        raise SampleBuildError(
            f"existing output(s) {differing} differ from this run; a sample is never "
            "overwritten -- a changed input, tool or rule requires a new version and salt")
    for key, data in outputs.items():
        if status[key] == "absent":
            base.atomic_write_bytes(root / OUTPUTS[key], data)
            status[key] = "written"
    return status


def run(root: Path, *, mode: str, salt: str = DEFAULT_SALT, n: int = DEFAULT_N,
        exclude_adjudicated: bool = True, pinned: dict[str, tuple[str, str]] | None = None,
        child_expect: dict | None = None, emit=print) -> int:
    if mode not in ("validate-only", "write"):
        raise SampleBuildError(f"unknown mode {mode!r}")
    pinned = dict(PINNED_INPUTS if pinned is None else pinned)
    try:
        result = build(root, salt=salt, n=n, exclude_adjudicated=exclude_adjudicated,
                       pinned=pinned, child_expect=child_expect)
        if mode == "write":
            status = write_outputs(root, result["outputs"])
            after = v2gen.hash_inputs(root, expected=pinned)
            if after != result["hashes"]:
                raise SampleBuildError("a pinned input changed during the run")
        else:
            status = compare_outputs(root, result["outputs"])
    except base.ToolError as exc:
        emit(f"REFUSED: {exc}")
        return 1

    payload = result["payload"]
    report = {
        "mode": mode,
        "salt": salt,
        "n": n,
        "frame": payload["frame"],
        "disjointness": payload["disjointness"]["overlap_counts"],
        "child_status_counts": payload["child"]["status_counts_in_sample"],
        "rows_sha256": payload["rows_sha256"],
        "outputs": {key: {"path": OUTPUTS[key], "status": status[key],
                          "sha256": base.sha256_bytes(result["outputs"][key])}
                    for key in OUTPUTS},
        "zero_failure_bound": payload["zero_failure_bound"]["one_sided_95_upper_bound"],
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
                      help="compute the sample, compare with any existing output, write nothing")
    mode.add_argument("--write", action="store_true",
                      help="write both outputs (never over a non-identical existing file)")
    ap.add_argument("--salt", default=DEFAULT_SALT)
    ap.add_argument("--n", type=int, default=DEFAULT_N)
    ap.add_argument("--include-adjudicated", action="store_true",
                    help="do NOT exclude the 83 operator-adjudicated pack persons from the frame")
    ap.add_argument("--root", default=str(REPO_ROOT),
                    help="repository root (tests point this at a fixture tree)")
    args = ap.parse_args(argv)
    return run(Path(args.root), mode="write" if args.write else "validate-only",
               salt=args.salt, n=args.n, exclude_adjudicated=not args.include_adjudicated)


if __name__ == "__main__":
    raise SystemExit(main())
