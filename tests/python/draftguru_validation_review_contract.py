#!/usr/bin/env python3
"""AFLDB-ISSUE-222 Phase F -- DB-free contract checks for
tools/rebuild/draftguru/review_validation_sample.py (the machine review of the v2 validation
sample) and tools/rebuild/draftguru/validate_validation_review.py (the independent final
validator and acceptance decision).

    python tests/python/draftguru_validation_review_contract.py

Every behavioural check runs against the hand-built lineage fixture in
tests/python/draftguru_lineage_fixture.py, in a temporary directory: the Phase F sample is
generated there by build_validation_sample.py over the fixture lineage (n = 4, salt
AFLDB-ISSUE-222/v2), the retained-evidence inputs are tiny synthetic files, and the fitzRoy
index is injected exactly as the v1 offline-review contract injects it. The REAL sample,
review outputs, parent, child, verdict artefacts and fitzRoy bytes are never opened, and the
real review is never generated here.

No database connection, no network request, no importer, no Git command.
"""

from __future__ import annotations

import csv
import hashlib
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TOOL_DIR = ROOT / "tools" / "rebuild" / "draftguru"
sys.path.insert(0, str(TOOL_DIR))
sys.path.insert(0, str(HERE))

import draftguru_lineage_fixture as fx                # noqa: E402
import build_validation_sample as sampler             # noqa: E402
import review_person_bridge_offline as base           # noqa: E402
import review_validation_sample as tool               # noqa: E402
import validate_person_bridge_child as child_validator  # noqa: E402
import validate_validation_review as final            # noqa: E402

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' -- ' + detail) if detail else ''}")
        failures.append(name)


def section(title: str) -> None:
    print(f"\n{title}")


def quiet(*_args, **_kwargs) -> None:
    return None


def has(names: list[str], number: str) -> bool:
    return any(n.startswith(number + " ") for n in names)


SALT = "AFLDB-ISSUE-222/v2"
N = 4
SUFFIX = "x"
COMPLETED = "2026-09-18T12:00:00Z"
URL = fx.URL


# ---------------------------------------------------------------------------
# Fixture: lineage + Phase F sample + synthetic retained evidence
# ---------------------------------------------------------------------------

def fitzroy_record(i: int, **overrides) -> dict:
    rec = {
        "fitzroy_ids": [str(i)], "distinct_fitzroy_id_count": 1, "players": [f"Fix P{i:02d}"],
        "first_names": ["Fix"], "surnames": [f"P{i:02d}"], "dob_years": [2000],
        "implied_birth_year": 2000, "debut_date": f"{2001 + i}-03-01", "debut_season": 2001 + i,
        "last_season": 2025, "career_games": 10, "goals_sum": 5, "na_goals": 0,
        "clubs": ["Fixture FC"],
    }
    rec.update(overrides)
    return rec


def profile_record(i: int, targets: dict, **overrides) -> dict:
    rec = {
        "player_url": URL(i), "afltables_href_count": 1 if i <= 9 else 0,
        "distinct_afltables_identity_count": 1 if i <= 9 else 0,
        "afltables_identity": targets.get(i),
        "page": {"title": f"Fix P{i:02d} (born 2000) - Draftguru", "h2": f"Fix P{i:02d}",
                 "heuristic_fields": {"dob_candidates": ["1 Jan 2000"]}},
        "raw_filename": f"raw/persons/fix_p{i:02d}__1.html", "raw_sha256": "0" * 64,
    }
    rec.update(overrides)
    return rec


def write_jsonl(root: Path, rel: str, records: list[dict]) -> None:
    fx.write(root, rel, ("\n".join(json.dumps(r, ensure_ascii=True, sort_keys=True)
                                   for r in records) + "\n").encode("utf-8"))


def evidence_hashes(root: Path) -> dict[str, tuple[str, str]]:
    return {key: (rel, fx.sha((root / rel).read_bytes())) for key, (rel, _) in tool.EVIDENCE_INPUTS.items()}


def new_root(*, profile_overrides: dict | None = None) -> dict:
    f = fx.new_fixture(identity_suffix=SUFFIX)
    root = f["root"]
    targets = dict(f["targets"])
    targets[4] = f["corrected_p04"]
    rc = sampler.run(root, mode="write", n=N, pinned=f["pinned_sample"],
                     child_expect=f["expect"], emit=quiet)
    if rc != 0:
        raise RuntimeError("fixture sample generation failed")
    sample_json_rel, sample_csv_rel = sampler.OUTPUTS["sample_json"], sampler.OUTPUTS["sample_csv"]
    pinned = dict(f["pinned_sample"])
    pinned["sample_json"] = (sample_json_rel, fx.sha((root / sample_json_rel).read_bytes()))
    pinned["sample_csv"] = (sample_csv_rel, fx.sha((root / sample_csv_rel).read_bytes()))

    ev = tool.EVIDENCE_INPUTS
    profiles = [profile_record(i, targets, **((profile_overrides or {}).get(i, {})))
                for i in range(1, 13)]
    write_jsonl(root, ev["profile"][0], profiles)
    fx.write(root, ev["stage_a_manifest"][0], fx.dump({"$comment": "fixture Stage A manifest"}))
    write_jsonl(root, ev["stage_a_persons"][0],
                [{"player_url": URL(i), "display_names_raw": [f"Fix P{i:02d}"], "years": [2000 + i]}
                 for i in range(1, 13)])
    fx.write(root, ev["fitzroy_register"][0], fx.dump({"baselines": [
        {"acceptance_status": "accepted", "raw_artefacts": {"artefact_set_sha256": "ab" * 32}}]}))
    fx.write(root, ev["fitzroy_manifest"][0], fx.dump({"files": []}))
    fx.write(root, ev["fitzroy_contract"][0], fx.dump(
        {"source_row_corrections": {"rules": []}, "profile_url_continuity": {"rules": []}}))
    fx.write(root, ev["ledger"][0], fx.dump({"decisions": []}))
    fx.write(root, ev["aliases"][0], fx.dump({"aliases": []}))
    fx.write(root, tool.UNPINNED_EVIDENCE["awards_census"],
             b"player_id,display_name,afltables_profile_url\n")
    fx.write(root, tool.UNPINNED_EVIDENCE["brownlow_census"],
             b"bootstrap_player_id,display_name,afltables_profile_url,evidence,recovery_profile_url\n")
    index = {targets[i]: fitzroy_record(i) for i in range(1, 9)}
    sample = json.loads((root / sample_json_rel).read_text(encoding="utf-8"))
    return {
        "fixture": f, "root": root, "targets": targets, "pinned": pinned,
        "evidence": evidence_hashes(root), "index": index, "sample": sample,
        "expect": {"salt": SALT, "n": N,
                   "status_counts": {"bridged": 3, "target_not_registered": 1},
                   "child_summary_sha256": None},
    }


def review(fixture: dict, **kwargs) -> dict:
    params = {"pinned": fixture["pinned"], "evidence": fixture["evidence"],
              "unpinned": tool.UNPINNED_EVIDENCE, "expect": fixture["expect"],
              "child_expect": fixture["fixture"]["expect"], "fitzroy_index": fixture["index"],
              "skip_fitzroy_byte_verify": True}
    params.update(kwargs)
    return tool.review(fixture["root"], **params)


def run(fixture: dict, mode: str, **kwargs) -> tuple[int, list[str]]:
    lines: list[str] = []
    params = {"pinned": fixture["pinned"], "evidence": fixture["evidence"],
              "unpinned": tool.UNPINNED_EVIDENCE, "expect": fixture["expect"],
              "child_expect": fixture["fixture"]["expect"], "fitzroy_index": fixture["index"],
              "skip_fitzroy_byte_verify": True, "emit": lines.append}
    params.update(kwargs)
    return tool.run(fixture["root"], mode=mode, **params), lines


def refusal(fn, *args, **kwargs) -> str | None:
    try:
        fn(*args, **kwargs)
    except base.ToolError as exc:
        return str(exc)
    return None


def repin_sample(fixture: dict, mutate) -> None:
    """Apply ``mutate(doc)`` to the fixture's sample JSON, rewrite canonically, re-pin its hash."""
    rel = sampler.OUTPUTS["sample_json"]
    doc = json.loads((fixture["root"] / rel).read_text(encoding="utf-8"))
    mutate(doc)
    data = base.dump_json_lf(doc)
    (fixture["root"] / rel).write_bytes(data)
    fixture["pinned"]["sample_json"] = (rel, fx.sha(data))
    fixture["sample"] = doc


def validate(fixture: dict, **kwargs) -> dict:
    params = {"pinned": fixture["pinned"], "expect": fixture["expect"],
              "child_expect": fixture["fixture"]["expect"], "emit": quiet}
    params.update(kwargs)
    return final.validate(fixture["root"], **params)


def operator_artefact(fixture: dict, *, fill: str | None = "agree",
                      override: dict | None = None, header_override: dict | None = None) -> None:
    root = fixture["root"]
    recheck_bytes = (root / tool.OUTPUTS["recheck"]).read_bytes()
    recheck = json.loads(recheck_bytes.decode("utf-8"))
    op = {
        "issue": tool.ISSUE, "label": tool.LABEL, "phase": tool.PHASE, "schema_version": 1,
        "source_recheck_sha256": fx.sha(recheck_bytes),
        "verdicts_sha256": fx.sha((root / tool.OUTPUTS["verdicts_json"]).read_bytes()),
        "sample_sha256": fixture["pinned"]["sample_json"][1],
        "review_completed_utc": COMPLETED,
        "classes": recheck["classes"],
    }
    op.update(header_override or {})
    for refs in op["classes"].values():
        for ref in refs:
            v = (override or {}).get(ref["player_url"], fill)
            if v is None:
                continue
            if isinstance(v, dict):
                ref.update(v)
                continue
            ref["operator_verdict"] = v
            ref["reviewed_utc"] = COMPLETED
            if v in ("contradict", "undetermined"):
                ref["notes"] = "fixture adjudication note"
                ref["evidence"] = {"basis": "fixture retained evidence"}
    fx.write(root, tool.OPERATOR_VERDICTS_REL, base.dump_json_lf(op))


# ---------------------------------------------------------------------------
# 1. Clean machine review
# ---------------------------------------------------------------------------

section("1. Clean machine review on the fixture lineage")

clean = new_root()
sample_rows = clean["sample"]["rows"]
result = review(clean)
rows = result["rows"]
doc = result["verdict_doc"]
check("1.1 exactly n rows, in sample order, ordinals 1..n, stratum 'validation'",
      len(rows) == N and [r["sample_index"] for r in rows] == [1, 2, 3, 4]
      and [r["ordinal"] for r in rows] == [1, 2, 3, 4]
      and all(r["stratum"] == tool.STRATUM for r in rows))
check("1.2 every row carries the sample's person, parent identity, child status and selection key",
      all(r["player_url"] == s["player_url"]
          and r["expected_afltables_identity"] == s["afltables_external_id"]
          and r["child_status"] == s["child_status"] == r["deployment_status"]
          and r["selection_key"] == s["selection_key"] for r, s in zip(rows, sample_rows)))
by_url = {r["player_url"]: r for r in rows}
check("1.3 bridged rows reach offline_strong; the unregistered row is target_unregistered with "
      "deployment_status target_not_registered, identity_evaluable False and no retained facts",
      all(r["outcome"] == "offline_strong" and r["identity_evaluable"] is True
          for r in rows if r["deployment_status"] == "bridged")
      and by_url[URL(9)]["outcome"] == "target_unregistered"
      and by_url[URL(9)]["deployment_status"] == "target_not_registered"
      and by_url[URL(9)]["identity_evaluable"] is False
      and by_url[URL(9)]["retained_target"] is None,
      repr([(r["player_url"][-9:], r["outcome"], r["reason_codes"]) for r in rows]))
check("1.4 totals reconcile: 3 strong, 1 unregistered, completed 4, identity_evaluable 3, "
      "deployment {3, 1}, 0 contradictions, 0 not-terminal",
      result["totals"] == {
          "offline_strong": 3, "offline_limited": 0, "offline_contradict": 0,
          "target_unregistered": 1, "offline_unavailable": 0, "tooling_or_schema_error": 0,
          "completed": 4, "remaining": 0, "identity_evaluable": 3,
          "deployment_status": {"bridged": 3, "target_not_registered": 1},
          "machine_contradictions_observed": 0, "not_terminal": 0},
      repr(result["totals"]))
check("1.5 rows_sha256 is the sha256 of the canonical rows and is recorded",
      result["rows_sha256"] == base.sha256_bytes(base.canonical_json_bytes(rows))
      == doc["rows_sha256"])
recheck_doc = json.loads(result["outputs"]["recheck"].decode("utf-8"))
residual_doc = json.loads(result["outputs"]["residual"].decode("utf-8"))
check("1.6 generated_utc is frozen to the sample's (the child's) in all three JSON outputs",
      doc["generated_utc"] == recheck_doc["generated_utc"] == residual_doc["generated_utc"]
      == fx.V2_CHILD_UTC == clean["sample"]["generated_utc"])
independent_child = child_validator.validate(
    clean["root"], child_rel=clean["fixture"]["child_rel"],
    expect_child_sha256=clean["fixture"]["child_sha256"], pinned=clean["fixture"]["pinned_child"],
    expect=clean["fixture"]["expect"], emit=quiet)
check("1.7 the header is hash-linked to the sample JSON/CSV, its rows_sha256, the child and the "
      "child validation summary reproduced independently",
      doc["sample"]["sha256"] == clean["pinned"]["sample_json"][1]
      and doc["sample"]["csv_sha256"] == clean["pinned"]["sample_csv"][1]
      and doc["sample"]["rows_sha256"] == clean["sample"]["rows_sha256"]
      and doc["sample"]["salt"] == SALT and doc["sample"]["n"] == N
      and doc["child"]["sha256"] == clean["fixture"]["child_sha256"]
      and doc["child"]["validation_summary_sha256"] == independent_child["summary_sha256"]
      and not independent_child["failures"])
check("1.8 every frozen tool source is recorded with its current hash, including the v1 review tool",
      set(doc["tool_hashes"]) == set(tool.TOOL_SOURCES)
      and "review_person_bridge_offline" in doc["tool_hashes"]
      and all(v["sha256"] == fx.sha((ROOT / v["path"]).read_bytes())
              for v in doc["tool_hashes"].values()))
csv_text = result["outputs"]["verdicts_csv"].decode("utf-8")
parity_dir = Path(tempfile.mkdtemp(prefix="afldb-i222-csv-parity-"))
base.write_csv(rows, parity_dir / "v1.csv")
ours = list(csv.reader(csv_text.splitlines()))
theirs = list(csv.reader((parity_dir / "v1.csv").read_text(encoding="utf-8").splitlines()))
check("1.9 the CSV carries the v1 columns byte-for-byte as review_person_bridge_offline.write_csv "
      "renders them, plus deployment_status, identity_evaluable and selection_key; LF only",
      "\r" not in csv_text and ours[0] == tool.CSV_COLUMNS and len(ours) == N + 1
      and all(o[:len(base.CSV_COLUMNS)] == t for o, t in zip(ours, theirs))
      and [o[-3] for o in ours[1:]] == [r["deployment_status"] for r in rows]
      and [o[-1] for o in ours[1:]] == [r["selection_key"] for r in rows])
bridged_urls = [r["player_url"] for r in rows if r["outcome"] == "offline_strong"]
expected_audit = sorted(bridged_urls, key=lambda u: (
    hashlib.sha256((tool.DEFAULT_AUDIT_SALT + "|" + u).encode("utf-8")).hexdigest(), u))
check("1.10 the recheck queue lists the unregistered row in class 3, the clean strong rows as the "
      "audit under salt AFLDB-ISSUE-222/audit-v2 (independent ordering), is hash-linked to the "
      "verdicts artefact and records 1 mandatory row",
      [r["player_url"] for r in recheck_doc["classes"]["3_target_unregistered"]] == [URL(9)]
      and recheck_doc["audit"]["salt"] == "AFLDB-ISSUE-222/audit-v2"
      and [r["player_url"] for r in recheck_doc["classes"]["11_deterministic_audit"]] == expected_audit
      and recheck_doc["verdicts_sha256"] == fx.sha(result["outputs"]["verdicts_json"])
      and recheck_doc["mandatory_distinct_rows"] == 1
      and recheck_doc["operator_verdict_storage"]["path"] == tool.OPERATOR_VERDICTS_REL,
      repr({k: len(v) for k, v in recheck_doc["classes"].items()}))
check("1.11 the residual report carries the unregistered row and no contradiction, hash-linked",
      residual_doc["categories"]["target_unregistered"] == {"count": 1, "urls": [URL(9)]}
      and residual_doc["categories"]["offline_contradict"]["count"] == 0
      and residual_doc["verdicts_sha256"] == recheck_doc["verdicts_sha256"])
root_text = str(clean["root"])
check("1.12 no absolute path, DSN or credential appears in any output",
      all(root_text not in data.decode("utf-8") and root_text.replace("\\", "\\\\")
          not in data.decode("utf-8") and "postgres" not in data.decode("utf-8").lower()
          for data in result["outputs"].values()))
again = review(clean)
check("1.13 a second review reproduces all four outputs byte-for-byte",
      again["outputs"] == result["outputs"])
check("1.14 operator_verdict is null in every machine row; verdict storage is the separate artefact",
      all(r["operator_verdict"] is None for r in rows)
      and doc["operator_verdict_storage"]["path"] == tool.OPERATOR_VERDICTS_REL
      and "PENDING" in doc["status"])
check("1.15 the acceptance rule block states the failure definition, the target_not_registered "
      "treatment and the bound statement",
      "undetermined" in doc["acceptance_rule"]["failure"]
      and "never treated as an identity contradiction" in doc["acceptance_rule"]["target_not_registered"]
      and doc["zero_failure_bound"]["n"] == N
      and doc["zero_failure_bound"]["identity_evaluable_n"] == 3
      and doc["zero_failure_bound"]["one_sided_95_upper_bound_at_n"] == round(1 - 0.05 ** 0.25, 6))

# ---------------------------------------------------------------------------
# 2. Failures are surfaced, never excluded
# ---------------------------------------------------------------------------

section("2. Observed failures are surfaced")

contradict = new_root()
contradict["index"][contradict["targets"][6]] = fitzroy_record(6, dob_years=[1990], implied_birth_year=1990)
res_c = review(contradict)
rc_doc = json.loads(res_c["outputs"]["recheck"].decode("utf-8"))
rs_doc = json.loads(res_c["outputs"]["residual"].decode("utf-8"))
check("2.1 a birth-year conflict yields offline_contradict, counted, queued in class 1 and listed "
      "in the residual report",
      {r["outcome"] for r in res_c["rows"] if r["player_url"] == URL(6)} == {"offline_contradict"}
      and res_c["totals"]["machine_contradictions_observed"] == 1
      and [r["player_url"] for r in rc_doc["classes"]["1_offline_contradict"]] == [URL(6)]
      and rs_doc["categories"]["offline_contradict"]["urls"] == [URL(6)])
unavailable = new_root()
del unavailable["index"][unavailable["targets"][7]]
res_u = review(unavailable)
check("2.2 a registered identity without retained rows yields offline_unavailable, counted as "
      "not-terminal and queued in class 4",
      {r["outcome"] for r in res_u["rows"] if r["player_url"] == URL(7)} == {"offline_unavailable"}
      and res_u["totals"]["not_terminal"] == 1
      and [r["player_url"] for r in json.loads(res_u["outputs"]["recheck"].decode("utf-8"))
           ["classes"]["4_offline_unavailable"]] == [URL(7)])
tooling = new_root(profile_overrides={8: {"distinct_afltables_identity_count": 2}})
res_t = review(tooling)
check("2.3 an unexpected href shape yields tooling_or_schema_error and is queued in class 5",
      {r["outcome"] for r in res_t["rows"] if r["player_url"] == URL(8)} == {"tooling_or_schema_error"}
      and [r["player_url"] for r in json.loads(res_t["outputs"]["recheck"].decode("utf-8"))
           ["classes"]["5_tooling_or_schema_error"]] == [URL(8)])

# ---------------------------------------------------------------------------
# 3. Fail-closed refusals
# ---------------------------------------------------------------------------

section("3. Fail-closed refusals")

f3 = new_root()
bad_pin = dict(f3["pinned"])
bad_pin["sample_json"] = (bad_pin["sample_json"][0], "0" * 64)
msg = refusal(review, f3, pinned=bad_pin)
check("3.1 a wrong sample hash is refused before anything is computed",
      msg is not None and "sha256 mismatch" in msg, str(msg))
tampered = new_root()


def _swap(doc):
    doc["rows"][0], doc["rows"][1] = doc["rows"][1], doc["rows"][0]


repin_sample(tampered, _swap)
msg = refusal(review, tampered)
check("3.2 sample rows that no longer reproduce rows_sha256 are refused",
      msg is not None and "rows_sha256" in msg, str(msg))
msg = refusal(review, f3, expect={**f3["expect"], "salt": "AFLDB-ISSUE-222/v3"})
check("3.3 a salt other than the expected one is refused", msg is not None and "salt" in msg, str(msg))
msg = refusal(review, f3, expect={**f3["expect"], "n": 3})
check("3.4 a row count other than the expected n is refused",
      msg is not None and "expected exactly" in msg, str(msg))
lineage = new_root()


def _identity(doc):
    doc["rows"][0]["afltables_external_id"] = "players/F/Fix_P099x.html"
    doc["rows_sha256"] = base.sha256_bytes(base.canonical_json_bytes(doc["rows"]))


repin_sample(lineage, _identity)
msg = refusal(review, lineage)
check("3.5 a sample identity that disagrees with the v2 parent is refused (lineage)",
      msg is not None and ("lineage" in msg or "canonical rendering" in msg), str(msg))
overlap = new_root()


def _overlap(doc):
    doc["disjointness"]["overlap_counts"]["v1_random"] = 1


repin_sample(overlap, _overlap)
msg = refusal(review, overlap)
check("3.6 a recorded non-zero overlap is refused", msg is not None and "overlap" in msg, str(msg))
gate = new_root()
child_rel = gate["fixture"]["child_rel"]
child_doc = fx.read_json(gate["root"], child_rel)
child_doc["kind"] = "source-evidence"
new_child_sha = fx.rewrite_json(gate["root"], child_rel, child_doc)
gate["pinned"]["child_v2_afldb_test"] = (child_rel, new_child_sha)
msg = refusal(review, gate)
check("3.7 a child that fails validation refuses the review (the gate)",
      msg is not None and "child validation failed" in msg, str(msg))
msg = refusal(review, f3, audit_salt="a|b")
check("3.8 an audit salt containing '|' is refused", msg is not None)
drifted = new_root()


def _tool(doc):
    key = next(iter(doc["tool_hashes"]))
    doc["tool_hashes"][key]["sha256"] = "f" * 64


repin_sample(drifted, _tool)
msg = refusal(review, drifted)
check("3.9 a tool hash that no longer matches the sample's frozen hash is refused",
      msg is not None and "changed since the sample" in msg, str(msg))
summary_pin = new_root()
msg = refusal(review, summary_pin, expect={**summary_pin["expect"], "child_summary_sha256": "0" * 64})
check("3.10 a child validation summary_sha256 other than the pinned one is refused",
      msg is not None and "summary_sha256" in msg, str(msg))

# ---------------------------------------------------------------------------
# 4. Output lifecycle
# ---------------------------------------------------------------------------

section("4. Output lifecycle (validate-only writes nothing; write never overwrites)")

life = new_root()
before = fx.snapshot(life["root"])
rc, lines = run(life, "validate-only")
check("4.1 validate-only exits 0, writes nothing and reports all four outputs absent",
      rc == 0 and fx.snapshot(life["root"]) == before
      and all(v["status"] == "absent" for v in json.loads("\n".join(lines[:-1]))["outputs"].values())
      and lines[-1].startswith("validate-only: nothing written"), str(lines[-2:]))
rc, lines = run(life, "write")
check("4.2 write exits 0 and creates all four outputs with the computed bytes",
      rc == 0 and all((life["root"] / tool.OUTPUTS[k]).read_bytes() == review(life)["outputs"][k]
                      for k in tool.OUTPUTS))
rc2, lines2 = run(life, "write")
check("4.3 a second write exits 0 and reports every output identical",
      rc2 == 0 and all(v["status"] == "identical"
                       for v in json.loads("\n".join(lines2[:-1]))["outputs"].values()))
csv_path = life["root"] / tool.OUTPUTS["verdicts_csv"]
csv_path.write_bytes(csv_path.read_bytes() + b"tampered\n")
json_before = (life["root"] / tool.OUTPUTS["verdicts_json"]).read_bytes()
rc4, lines4 = run(life, "write")
check("4.4 write refuses when an existing output differs and touches nothing",
      rc4 == 1 and csv_path.read_bytes().endswith(b"tampered\n")
      and (life["root"] / tool.OUTPUTS["verdicts_json"]).read_bytes() == json_before
      and lines4[-1].startswith("REFUSED"))
rc5, lines5 = run(life, "validate-only")
check("4.5 validate-only exits 1 when an existing output differs",
      rc5 == 1 and any("DIFFERS" in line for line in lines5))

# ---------------------------------------------------------------------------
# 5. No database / network / import code path; reuse, not duplication
# ---------------------------------------------------------------------------

section("5. No database / network / import code path; reuse of the v1 rules")

REVIEW_SRC = (TOOL_DIR / "review_validation_sample.py").read_text(encoding="utf-8")
FINAL_SRC = (TOOL_DIR / "validate_validation_review.py").read_text(encoding="utf-8")
for name, src in (("review tool", REVIEW_SRC), ("final validator", FINAL_SRC)):
    offenders = sorted(fx.imported_modules(src) & fx.FORBIDDEN_MODULES)
    check(f"5.1 the {name} imports no database, network, subprocess, GUI, importer or exporter module",
          not offenders, str(offenders))
    env = fx.env_accesses(src)
    check(f"5.2 the {name} reads no environment variable", not env, "; ".join(env))
check("5.3 the review tool defines none of the v1 rules itself (evaluate_row, build_fitzroy_index, "
      "build_recheck_queue, build_residual_report are imported from review_person_bridge_offline)",
      "import review_person_bridge_offline as base" in REVIEW_SRC
      and not any(f"def {fn}(" in REVIEW_SRC for fn in (
          "evaluate_row", "build_fitzroy_index", "build_recheck_queue", "build_residual_report")))
check("5.4 the review tool freezes the v1 review tool's hash and never writes it",
      tool.TOOL_SOURCES["review_person_bridge_offline"] == base.TOOL
      and "review_person_bridge_offline.py" not in "".join(tool.OUTPUTS.values()))
check("5.5 the final validator exposes no write path",
      "atomic_write_bytes(" not in FINAL_SRC and "write_bytes(" not in FINAL_SRC
      and "write_text(" not in FINAL_SRC and " open(" not in FINAL_SRC
      and not hasattr(final, "OUTPUTS"))
check("5.6 the review outputs live under bridge-validation-* names, never the v1 bridge-review-* names",
      all("bridge-validation-" in rel and "bridge-review-" not in rel for rel in tool.OUTPUTS.values())
      and "bridge-validation-operator-verdicts" in tool.OPERATOR_VERDICTS_REL)

# ---------------------------------------------------------------------------
# 6. The independent final validator and the acceptance decision
# ---------------------------------------------------------------------------

section("6. Final validator and acceptance")

fv = new_root()
run(fv, "write")
s = validate(fv)
check("6.1 with no operator artefact every structural check passes, acceptance is NOT granted, the "
      "decision is 'pending' and the exit status is 2",
      not s["failures"] and s["acceptance"]["status"] == "NOT ACCEPTED"
      and s["acceptance"]["pending"] and not s["acceptance"]["genuine_contradictions"]
      and final.exit_status(s) == 2, str(s["failures"]) + str(s["acceptance"]["blockers"]))
check("6.2 the structural sections all contributed checks (1-7)",
      {c["name"].split(".")[0] for c in s["checks"]} == {"1", "2", "3", "4", "5", "6", "7"}
      or {c["name"].split(".")[0] for c in s["checks"]} == {"1", "2", "3", "4", "5", "7"})
operator_artefact(fv)
s = validate(fv)
check("6.3 with every mandatory and audit row 'agree', acceptance is ACCEPTED with exit 0, 0 "
      "failures, and the bound stated at n and at the identity-evaluable count",
      not s["failures"] and s["acceptance"]["status"] == "ACCEPTED" and final.exit_status(s) == 0
      and s["acceptance"]["statement"]["one_sided_95_upper_bound_at_n"] == round(1 - 0.05 ** 0.25, 6)
      and s["acceptance"]["statement"]["one_sided_95_upper_bound_at_identity_evaluable_n"]
      == round(1 - 0.05 ** (1 / 3), 6)
      and s["acceptance"]["statement"]["target_not_registered_n"] == 1
      and s["acceptance"]["required_rows"] == 4 and s["acceptance"]["operator_verdicts_filled"] == 4,
      str(s["failures"]) + str(s["acceptance"]["blockers"]))
check("6.4 the acceptance statement uses the O-4 revision 2 wording and names the comparison target",
      any("retained fitzRoy/AFLDB comparison plus operator exception/audit review" in line
          for line in s["acceptance"]["statement"]["lines"])
      and any("not an independent source" in line for line in s["acceptance"]["statement"]["lines"]))
audit_url = json.loads((fv["root"] / tool.OUTPUTS["recheck"]).read_bytes())["classes"]["11_deterministic_audit"][0]["player_url"]
operator_artefact(fv, override={audit_url: "contradict"})
s = validate(fv)
check("6.5 an audit row adjudicated 'contradict' (with notes and evidence) blocks acceptance as a "
      "genuine contradiction and an unconfirmed audit row",
      not s["failures"] and s["acceptance"]["status"] == "NOT ACCEPTED"
      and s["acceptance"]["genuine_contradictions"] == [audit_url]
      and s["acceptance"]["audit_not_agree"] == [audit_url] and final.exit_status(s) == 2)
operator_artefact(fv, override={URL(9): "undetermined"})
s = validate(fv)
check("6.6 an 'undetermined' verdict blocks acceptance (not a pass; escalated, never redrawn)",
      not s["failures"] and s["acceptance"]["status"] == "NOT ACCEPTED"
      and s["acceptance"]["undetermined"] == [URL(9)]
      and any("undetermined" in b for b in s["acceptance"]["blockers"]))
operator_artefact(fv, override={audit_url: {"operator_verdict": "contradict", "reviewed_utc": COMPLETED}})
s = validate(fv)
check("6.7 a 'contradict' without notes and evidence fails check 6.4", has(s["failures"], "6.4"))
operator_artefact(fv, override={URL(9): None})
s = validate(fv)
check("6.8 a required row left without a verdict is pending, not accepted, exit 2",
      not s["failures"] and s["acceptance"]["status"] == "NOT ACCEPTED"
      and any("lack an operator verdict" in p for p in s["acceptance"]["pending"])
      and final.exit_status(s) == 2)


def _extra(op):
    op["classes"]["3_target_unregistered"].append(
        {"player_url": URL(12), "stratum": "validation", "sample_index": 99,
         "outcome": "target_unregistered", "reason_codes": [], "operator_verdict": "agree",
         "reviewed_utc": COMPLETED, "notes": None, "evidence": None})


operator_artefact(fv)
op_doc = fx.read_json(fv["root"], tool.OPERATOR_VERDICTS_REL)
_extra(op_doc)
fx.write(fv["root"], tool.OPERATOR_VERDICTS_REL, base.dump_json_lf(op_doc))
s = validate(fv)
check("6.9 a row added to the operator artefact fails 6.3 (and 6.4 for a person outside the sample)",
      has(s["failures"], "6.3") and has(s["failures"], "6.4"))
operator_artefact(fv, header_override={"source_recheck_sha256": "0" * 64})
s = validate(fv)
check("6.10 an operator artefact not hash-linked to this recheck queue fails 6.2", has(s["failures"], "6.2"))
operator_artefact(fv, override={URL(9): {"operator_verdict": "agree", "reviewed_utc": COMPLETED,
                                         "outcome": "offline_strong"}})
s = validate(fv)
check("6.11 an edited machine outcome inside the operator artefact fails 6.4", has(s["failures"], "6.4"))

operator_artefact(fv)
verdict_rel = tool.OUTPUTS["verdicts_json"]
good_verdicts = (fv["root"] / verdict_rel).read_bytes()


def with_verdicts(mutate) -> dict:
    vdoc = json.loads(good_verdicts.decode("utf-8"))
    mutate(vdoc)
    (fv["root"] / verdict_rel).write_bytes(base.dump_json_lf(vdoc))
    out = validate(fv)
    (fv["root"] / verdict_rel).write_bytes(good_verdicts)
    return out


s = with_verdicts(lambda d: d["rows"].__setitem__(slice(0, 2), d["rows"][0:2][::-1]))
check("6.12 reordered rows fail the order check 3.2 and the rows_sha256 check 3.7",
      has(s["failures"], "3.2") and has(s["failures"], "3.7"))
s = with_verdicts(lambda d: d["rows"].pop())
check("6.13 a removed row fails 3.1", has(s["failures"], "3.1"))
s = with_verdicts(lambda d: d["totals"].__setitem__("offline_strong", 99))
check("6.14 tampered totals fail 4.1", has(s["failures"], "4.1"))
s = with_verdicts(lambda d: d["tool_hashes"]["review_person_bridge_offline"].__setitem__("sha256", "f" * 64))
check("6.15 a recorded tool hash that no longer matches its source fails 2.5 (a drift voids the review)",
      has(s["failures"], "2.5"))
s = with_verdicts(lambda d: d["rows"][0].__setitem__("operator_verdict", "agree"))
check("6.16 an operator verdict inside the machine artefact fails 3.6", has(s["failures"], "3.6"))
s = with_verdicts(lambda d: d["sample"].__setitem__("sha256", "0" * 64))
check("6.17 a header not hash-linked to the pinned sample fails 2.2", has(s["failures"], "2.2"))
bad_pin = dict(fv["pinned"])
bad_pin["sample_json"] = (bad_pin["sample_json"][0], "0" * 64)
s = validate(fv, pinned=bad_pin)
check("6.18 a wrong pinned sample hash fails 1.1 and stops", s["failures"] == [s["checks"][0]["name"]]
      and has(s["failures"], "1.1"), str(s["failures"]))

fc = new_root()
fc["index"][fc["targets"][6]] = fitzroy_record(6, dob_years=[1990], implied_birth_year=1990)
run(fc, "write")
s = validate(fc)
check("6.19 a machine contradiction is surfaced (7.1) and, without an operator verdict, acceptance "
      "is pending with the contradiction listed in the recheck queue",
      not s["failures"] and s["acceptance"]["status"] == "NOT ACCEPTED"
      and s["counts"]["offline_contradict"] == 1)
operator_artefact(fc)
s = validate(fc)
check("6.20 a machine offline_contradict the operator resolves to 'agree' with evidence is not genuine: "
      "ACCEPTED", not s["failures"] and s["acceptance"]["status"] == "ACCEPTED"
      and s["acceptance"]["genuine_contradictions"] == [], str(s["acceptance"]["blockers"]))
operator_artefact(fc, override={URL(6): "contradict"})
s = validate(fc)
check("6.21 a machine offline_contradict the operator confirms is genuine: NOT ACCEPTED",
      not s["failures"] and s["acceptance"]["status"] == "NOT ACCEPTED"
      and s["acceptance"]["genuine_contradictions"] == [URL(6)])

fu = new_root()
del fu["index"][fu["targets"][7]]
run(fu, "write")
operator_artefact(fu)
s = validate(fu)
check("6.22 an offline_unavailable row blocks acceptance even when every operator verdict is 'agree' "
      "(rerun required, never excluded)",
      not s["failures"] and s["acceptance"]["status"] == "NOT ACCEPTED"
      and any("without a terminal outcome" in b for b in s["acceptance"]["blockers"]))

operator_artefact(fv)
s = validate(fv, require_per_row=True)
check("6.23 --require-per-row-operator-verdicts counts every sample row as required",
      not s["failures"] and s["acceptance"]["required_rows"] == N
      and s["acceptance"]["status"] == "ACCEPTED")
before = fx.snapshot(fv["root"])
s1 = validate(fv)
s2 = validate(fv)
check("6.24 validation writes nothing and two runs produce an identical summary_sha256",
      fx.snapshot(fv["root"]) == before and s1["summary_sha256"] == s2["summary_sha256"])

# ---------------------------------------------------------------------------
# 7. Pinned real constants (the real artefacts are never opened here)
# ---------------------------------------------------------------------------

section("7. Pinned real Phase F constants")

check("7.1 the review pins the operator-reported sample JSON/CSV hashes and rows_sha256",
      tool.SAMPLE_JSON_SHA256.startswith("6523bad65d8d92bb")
      and tool.SAMPLE_CSV_SHA256.startswith("afa2b9172211609d")
      and tool.SAMPLE_ROWS_SHA256.startswith("91be2942255fcf08")
      and tool.EXPECT["rows_sha256"] == tool.SAMPLE_ROWS_SHA256)
check("7.2 the review pins the validated child and its summary_sha256",
      tool.PINNED_INPUTS["child_v2_afldb_test"][1].startswith("b996c60e9d4de3ae")
      and tool.CHILD_SUMMARY_SHA256.startswith("5bc5336be116cc79"))
check("7.3 the expected sample is n = 598, salt AFLDB-ISSUE-222/v2, 582 bridged + 16 target_not_registered",
      tool.EXPECT["n"] == 598 and tool.EXPECT["salt"] == "AFLDB-ISSUE-222/v2"
      and tool.EXPECT["status_counts"] == {"bridged": 582, "target_not_registered": 16})
check("7.4 the retained-evidence inputs are pinned to the hashes the v1 review recorded",
      tool.EVIDENCE_INPUTS["profile"][1].startswith("bad43909112aae4b")
      and tool.EVIDENCE_INPUTS["fitzroy_manifest"][1].startswith("2bd66e3df5ce8041")
      and tool.EVIDENCE_INPUTS["ledger"][1].startswith("13ea051e6620a132")
      and tool.EVIDENCE_INPUTS["aliases"][1].startswith("c77ccbf8b995c56d"))
check("7.5 no output path is a pinned input path",
      not (set(tool.OUTPUTS.values()) | {tool.OPERATOR_VERDICTS_REL})
      & {rel for rel, _ in {**tool.PINNED_INPUTS, **tool.EVIDENCE_INPUTS}.values()})

# ---------------------------------------------------------------------------

print()
if failures:
    print(f"{len(failures)} check(s) FAILED: {failures}")
    raise SystemExit(1)
print("All DraftGuru Phase F review checks hold.")
