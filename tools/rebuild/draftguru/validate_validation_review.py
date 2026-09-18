#!/usr/bin/env python3
"""AFLDB-ISSUE-222 Phase F -- independent, fail-closed, read-only validation of the Phase F
review and the acceptance decision. DB-free. Writes nothing.

    python tools/rebuild/draftguru/validate_validation_review.py
    python tools/rebuild/draftguru/validate_validation_review.py --require-per-row-operator-verdicts

What is proven (every check prints PASS/FAIL; any FAIL is exit status 1):

  1. bytes and lineage: the sample JSON/CSV hashes and rows_sha256, every pinned lineage input,
     the v2 child re-validated in-process (summary_sha256 must equal the pinned value), the four
     review artefacts present, canonical and free of any DSN / absolute path / credential;
  2. the review header: hash-linked to the sample and child, every recorded input still
     hash-matches its file, every recorded tool hash still matches its source (a drift voids
     the review), generated_utc frozen;
  3. the rows: exactly n, in sample order, each carrying the sample's person, identity, child
     status and selection key; no missing, duplicated or extra row; valid outcomes; identity
     outcome and deployment status kept distinct; no operator verdict inside the machine file;
     rows_sha256 reproduced;
  4. totals and the CSV reconcile with the rows;
  5. the recheck queue and the residual report reproduce exactly from the rows through the v1
     tool's own builders, so every contradiction, limited, unregistered, unavailable and
     tooling row is surfaced and none is silently excluded;
  6. the operator verdict artefact (when present): hash-linked to the recheck queue, the same
     row sets, allowed verdicts, notes and evidence where required, no machine outcome edited;
  7. acceptance, computed under the documented rule only (runbook §8; AFLDB-ISSUE-222.md §3.5;
     review_validation_sample.ACCEPTANCE_RULE) and printed with the achieved bound beside n
     and the observed count.

Exit status: 0 = every check passed AND acceptance is granted; 2 = every check passed but
acceptance is NOT granted (operator adjudication pending, or a blocker stands); 1 = a check
failed or a refusal. Two runs over identical inputs print an identical summary_sha256.

Opens no database, performs no network request, runs no importer, writes no file.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]
sys.path.insert(0, str(TOOL_DIR))

import build_person_bridge_v2 as v2gen                # noqa: E402  (DB-free)
import review_person_bridge_offline as base           # noqa: E402  (DB-free)
import review_validation_sample as reviewer           # noqa: E402  (DB-free)
import validate_person_bridge_child as validator      # noqa: E402  (DB-free)

TOOL = "tools/rebuild/draftguru/validate_validation_review.py"
TOOL_VERSION = "1.0.0"
UTC_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
MANDATORY_CLASS_PREFIXES = tuple(f"{i}_" for i in range(1, 11))
AUDIT_CLASS = "11_deterministic_audit"


def quiet(*_args, **_kwargs) -> None:
    return None


def _load(path: Path):
    return json.loads(path.read_bytes().decode("utf-8"))


def _diff(a: set, b: set, limit: int = 5) -> str:
    return f"only-left={sorted(a - b)[:limit]} only-right={sorted(b - a)[:limit]}"


def _leaks(data: bytes) -> list[str]:
    text = data.decode("utf-8", errors="replace")
    return [what for pattern, what in v2gen.FORBIDDEN_OUTPUT_PATTERNS if pattern.search(text)]


# ---------------------------------------------------------------------------

def validate(root: Path, *, pinned: dict[str, tuple[str, str]] | None = None,
             expect: dict | None = None, child_expect: dict | None = None,
             outputs: dict[str, str] | None = None,
             operator_rel: str = reviewer.OPERATOR_VERDICTS_REL,
             require_per_row: bool = False,
             expect_verdicts_sha256: str | None = None, emit=print) -> dict:
    pinned = dict(reviewer.PINNED_INPUTS if pinned is None else pinned)
    expect = dict(reviewer.EXPECT if expect is None else expect)
    outputs = dict(reviewer.OUTPUTS if outputs is None else outputs)
    rep = validator.Report(emit)
    summary: dict = {"tool": TOOL, "tool_version": TOOL_VERSION,
                     "require_per_row_operator_verdicts": require_per_row}
    acceptance: dict = {"status": "NOT ACCEPTED", "blockers": [], "pending": [],
                        "genuine_contradictions": [], "undetermined": [],
                        "audit_not_agree": [], "statement": None}

    def finish() -> dict:
        summary["checks"] = rep.checks
        summary["failures"] = list(rep.failures)
        if rep.failures:
            acceptance["status"] = "NOT ACCEPTED"
            acceptance["blockers"] = list(acceptance["blockers"]) + [
                f"{len(rep.failures)} validation check(s) failed"]
        summary["acceptance"] = acceptance
        digest = base.sha256_bytes(base.canonical_json_bytes(summary))
        summary["summary_sha256"] = digest
        emit("")
        emit(f"summary_sha256: {digest}")
        emit(f"ACCEPTANCE: {acceptance['status']}")
        for reason in acceptance["blockers"]:
            emit(f"  blocker: {reason}")
        if acceptance["statement"]:
            for line in acceptance["statement"]["lines"]:
                emit(f"  {line}")
        if rep.failures:
            emit(f"PHASE F REVIEW VALIDATION FAILED: {len(rep.failures)} check(s) -- {rep.failures}")
        else:
            emit("All Phase F review-validation checks hold.")
        return summary

    emit(f"{reviewer.ISSUE} Phase F review validation ({TOOL} {TOOL_VERSION}) -- read-only")

    # ------------------------------------------------------------ 1. bytes and lineage
    rep.section("1. Bytes and lineage")
    try:
        hashes = v2gen.hash_inputs(root, expected=pinned)
    except base.ToolError as exc:
        rep.check("1.1 every pinned input (sample JSON/CSV, child, lineage) exists and hash-matches",
                  False, str(exc))
        return finish()
    rep.check("1.1 every pinned input (sample JSON/CSV, child, lineage) exists and hash-matches", True)
    summary["input_sha256"] = hashes
    sample = _load(root / pinned["sample_json"][0])
    sample_rows = sample.get("rows") or []
    sample_rows_sha = base.sha256_bytes(base.canonical_json_bytes(sample_rows))
    rep.check(f"1.2 the sample's rows_sha256 reproduces and equals the pinned value; n == {expect['n']}",
              sample_rows_sha == sample.get("rows_sha256") == expect.get("rows_sha256", sample_rows_sha)
              and len(sample_rows) == sample.get("n") == expect["n"],
              f"recomputed {sample_rows_sha}, recorded {sample.get('rows_sha256')!r}, "
              f"n {len(sample_rows)}")
    child_rel, child_sha = pinned["child_v2_afldb_test"]
    child_summary = validator.validate(
        root, child_rel=child_rel, expect_child_sha256=child_sha,
        pinned={key: pinned[key] for key in validator.PINNED_INPUTS},
        expect=child_expect, emit=quiet)
    rep.check("1.3 the v2 child re-validates in-process and its summary_sha256 equals the pinned value",
              not child_summary["failures"]
              and (not expect.get("child_summary_sha256")
                   or child_summary["summary_sha256"] == expect["child_summary_sha256"]),
              f"failures {child_summary['failures']}, summary {child_summary['summary_sha256']}")
    summary["child_summary_sha256"] = child_summary["summary_sha256"]

    artefacts: dict[str, bytes] = {}
    missing = [key for key, rel in outputs.items() if not (root / rel).is_file()]
    rep.check("1.4 all four review artefacts exist (verdicts JSON/CSV, recheck, residual)",
              not missing, f"missing {missing}")
    if missing:
        return finish()
    for key, rel in outputs.items():
        artefacts[key] = (root / rel).read_bytes()
    try:
        doc = json.loads(artefacts["verdicts_json"].decode("utf-8"))
        recheck = json.loads(artefacts["recheck"].decode("utf-8"))
        residual = json.loads(artefacts["residual"].decode("utf-8"))
        parsed = isinstance(doc, dict) and isinstance(recheck, dict) and isinstance(residual, dict)
    except (UnicodeDecodeError, json.JSONDecodeError):
        parsed = False
    rep.check("1.5 the three JSON artefacts parse as objects", parsed)
    if not parsed:
        return finish()
    csv_utf8 = True
    try:
        artefacts["verdicts_csv"].decode("utf-8")
    except UnicodeDecodeError:
        csv_utf8 = False
    rep.check("1.6 every JSON artefact is its canonical ASCII LF serialisation; the CSV is UTF-8 and LF-only",
              base.dump_json_lf(doc) == artefacts["verdicts_json"]
              and base.dump_json_lf(recheck) == artefacts["recheck"]
              and base.dump_json_lf(residual) == artefacts["residual"]
              and all(artefacts[k].isascii() for k in ("verdicts_json", "recheck", "residual"))
              and all(b"\r" not in d for d in artefacts.values()) and csv_utf8)
    leaks = {key: _leaks(data) for key, data in artefacts.items()}
    leaks = {k: v for k, v in leaks.items() if v}
    rep.check("1.7 no DSN, absolute path, DATABASE_URL name, credential or secret in any artefact",
              not leaks, str(leaks))
    verdicts_sha = base.sha256_bytes(artefacts["verdicts_json"])
    summary["verdicts_sha256"] = verdicts_sha
    summary["artefact_sha256"] = {key: base.sha256_bytes(data) for key, data in artefacts.items()}
    if expect_verdicts_sha256:
        rep.check("1.8 the verdicts artefact hashes to the operator-reported value",
                  verdicts_sha == expect_verdicts_sha256,
                  f"observed {verdicts_sha}, expected {expect_verdicts_sha256}")

    # ------------------------------------------------------------ 2. header
    rep.section("2. Review header")
    rep.check("2.1 issue, label, phase F, schema, review method, runbook and tool path",
              doc.get("issue") == reviewer.ISSUE and doc.get("label") == reviewer.LABEL
              and doc.get("phase") == reviewer.PHASE
              and doc.get("schema_version") == reviewer.SCHEMA_VERSION
              and doc.get("review_method") == base.REVIEW_METHOD
              and doc.get("runbook") == reviewer.RUNBOOK
              and (doc.get("tool") or {}).get("path") == reviewer.TOOL
              and (doc.get("base_tool") or {}).get("path") == base.TOOL)
    hs = doc.get("sample") or {}
    rep.check("2.2 header is hash-linked to the pinned sample JSON/CSV, its rows_sha256, salt and n",
              hs.get("sha256") == hashes["sample_json"] and hs.get("csv_sha256") == hashes["sample_csv"]
              and hs.get("rows_sha256") == sample_rows_sha and hs.get("salt") == expect["salt"]
              and hs.get("n") == expect["n"] and doc.get("total_expected_rows") == expect["n"],
              repr(hs))
    hc = doc.get("child") or {}
    rep.check("2.3 header is hash-linked to the pinned child and to the child validation reproduced now",
              hc.get("sha256") == hashes["child_v2_afldb_test"]
              and hc.get("validation_summary_sha256") == child_summary["summary_sha256"],
              repr(hc))
    stale: list[str] = []
    for key, entry in (doc.get("inputs") or {}).items():
        rel, recorded_sha = entry.get("path"), entry.get("sha256")
        path = root / rel
        if key in pinned and recorded_sha != hashes.get(key):
            stale.append(f"{key}: recorded != pinned")
        elif recorded_sha is not None and (not path.is_file() or base.sha256_file(path) != recorded_sha):
            stale.append(f"{key}: file changed or missing since the review")
    rep.check("2.4 every recorded input still hash-matches its file (pinned ones equal the pinned hashes)",
              not stale and set(pinned) <= set(doc.get("inputs") or {}), "; ".join(stale))
    drift: list[str] = []
    for name, entry in (doc.get("tool_hashes") or {}).items():
        path = REPO_ROOT / entry.get("path", "")
        if not path.is_file() or base.sha256_file(path) != entry.get("sha256"):
            drift.append(name)
    rep.check("2.5 every recorded tool hash still matches its source file (a drift voids the review)",
              not drift and set(reviewer.TOOL_SOURCES) <= set(doc.get("tool_hashes") or {}),
              f"drifted {drift}")
    rep.check("2.6 generated_utc is frozen to the sample's; audit salt recorded without '|'",
              doc.get("generated_utc") == sample.get("generated_utc")
              and bool(doc.get("audit_salt")) and "|" not in doc.get("audit_salt", "|"),
              f"{doc.get('generated_utc')!r} vs {sample.get('generated_utc')!r}")
    rep.check("2.7 operator verdicts are declared to live in the separate operator artefact",
              (doc.get("operator_verdict_storage") or {}).get("path") == operator_rel
              and "PENDING" in str(doc.get("status")))

    # ------------------------------------------------------------ 3. rows
    rep.section("3. Rows")
    rows = doc.get("rows") or []
    n = expect["n"]
    rep.check(f"3.1 exactly {n} reviewed rows", len(rows) == n, f"observed {len(rows)}")
    order_problems: list[str] = []
    for i, (s, r) in enumerate(zip(sample_rows, rows)):
        idx = i + 1
        if not isinstance(r, dict):
            order_problems.append(f"{idx}: not an object"); continue
        if r.get("sample_index") != idx or r.get("ordinal") != idx:
            order_problems.append(f"{idx}: index/ordinal {r.get('sample_index')!r}/{r.get('ordinal')!r}")
        if r.get("stratum") != reviewer.STRATUM:
            order_problems.append(f"{idx}: stratum {r.get('stratum')!r}")
        if r.get("player_url") != s["player_url"]:
            order_problems.append(f"{idx}: person {r.get('player_url')!r} != sample {s['player_url']!r}")
        if r.get("expected_afltables_identity") != s["afltables_external_id"]:
            order_problems.append(f"{idx}: identity differs from the sample")
        if r.get("child_status") != s["child_status"] or r.get("deployment_status") != s["child_status"]:
            order_problems.append(f"{idx}: child/deployment status differs from the sample")
        if r.get("selection_key") != s["selection_key"]:
            order_problems.append(f"{idx}: selection_key differs from the sample")
    rep.check("3.2 every row sits at its sample position with the sample's person, identity, "
              "child status and selection key", not order_problems and len(rows) == len(sample_rows),
              "; ".join(order_problems[:5]))
    urls = [r.get("player_url") for r in rows if isinstance(r, dict)]
    rep.check("3.3 no person is missing, duplicated or extra",
              len(set(urls)) == len(urls) and set(urls) == {s["player_url"] for s in sample_rows},
              _diff(set(urls), {s["player_url"] for s in sample_rows}))
    bad_outcome = [r.get("player_url") for r in rows
                   if not isinstance(r, dict) or r.get("outcome") not in base.OUTCOMES]
    rep.check("3.4 every outcome is one of the six terminal machine outcomes",
              not bad_outcome, str(bad_outcome[:5]))
    inconsistent: list[str] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        evaluable = r.get("outcome") in ("offline_strong", "offline_limited", "offline_contradict")
        if r.get("identity_evaluable") is not evaluable:
            inconsistent.append(f"{r.get('player_url')}: identity_evaluable")
        if (r.get("deployment_status") == "target_not_registered") \
                != (r.get("outcome") == "target_unregistered"):
            inconsistent.append(f"{r.get('player_url')}: deployment status vs outcome")
        if r.get("deployment_status") == "target_not_registered" and r.get("retained_target"):
            inconsistent.append(f"{r.get('player_url')}: withheld row carries retained target facts")
    rep.check("3.5 identity outcome and deployment status are kept distinct and consistent "
              "(target_not_registered <=> target_unregistered, never an identity contradiction)",
              not inconsistent, "; ".join(inconsistent[:5]))
    rep.check("3.6 no operator verdict inside the machine artefact",
              all(isinstance(r, dict) and r.get("operator_verdict") is None for r in rows))
    rows_sha = base.sha256_bytes(base.canonical_json_bytes(rows))
    rep.check("3.7 rows_sha256 reproduces from the rows", rows_sha == doc.get("rows_sha256"),
              f"recomputed {rows_sha}, recorded {doc.get('rows_sha256')!r}")
    summary["rows_sha256"] = rows_sha

    # ------------------------------------------------------------ 4. totals and CSV
    rep.section("4. Totals and CSV")
    counted = {o: 0 for o in base.OUTCOMES}
    deployment = {"bridged": 0, "target_not_registered": 0}
    for r in rows:
        if isinstance(r, dict) and r.get("outcome") in counted:
            counted[r["outcome"]] += 1
        if isinstance(r, dict) and r.get("deployment_status") in deployment:
            deployment[r["deployment_status"]] += 1
    totals = doc.get("totals") or {}
    sample_counts: dict[str, int] = {}
    for s in sample_rows:
        sample_counts[s["child_status"]] = sample_counts.get(s["child_status"], 0) + 1
    evaluable_n = sum(1 for r in rows if isinstance(r, dict) and r.get("identity_evaluable"))
    rep.check("4.1 totals reconcile with the rows, the sample's child-status counts and the expected counts",
              all(totals.get(o) == counted[o] for o in base.OUTCOMES)
              and totals.get("completed") == len(rows) == n and totals.get("remaining") == 0
              and totals.get("identity_evaluable") == evaluable_n
              and totals.get("deployment_status") == deployment == sample_counts == expect["status_counts"]
              and totals.get("machine_contradictions_observed") == counted["offline_contradict"]
              and totals.get("not_terminal") == counted["offline_unavailable"] + counted["tooling_or_schema_error"],
              f"totals {totals!r}; counted {counted}; deployment {deployment}; sample {sample_counts}")
    csv_ok = False
    try:
        csv_ok = reviewer.render_csv(rows) == artefacts["verdicts_csv"]
    except (KeyError, TypeError):
        csv_ok = False
    rep.check("4.2 the CSV is the exact rendering of the rows (same order, all columns)", csv_ok)
    summary["counts"] = {**counted, "n": n, "identity_evaluable": evaluable_n,
                         "deployment_status": deployment}

    # ------------------------------------------------------------ 5. recheck and residual
    rep.section("5. Recheck queue and residual report")
    rep.check("5.1 the recheck queue is hash-linked to the verdicts artefact, sample, parent and child, "
              "and frozen",
              recheck.get("verdicts_sha256") == verdicts_sha
              and recheck.get("sample_sha256") == hashes["sample_json"]
              and recheck.get("parent_sha256") == hashes["parent_v2"]
              and recheck.get("child_sha256") == hashes["child_v2_afldb_test"]
              and recheck.get("generated_utc") == sample.get("generated_utc")
              and recheck.get("verdicts_path") == outputs["verdicts_json"])
    audit = recheck.get("audit") or {}
    rebuilt_ok = False
    rebuilt_detail = ""
    try:
        rebuilt = base.build_recheck_queue(
            rows, audit_salt=audit.get("salt") or "", verdicts_sha256=verdicts_sha,
            sample_sha256=hashes["sample_json"], parent_sha256=hashes["parent_v2"],
            child_sha256=hashes["child_v2_afldb_test"])
        rebuilt_ok = (rebuilt["classes"] == recheck.get("classes")
                      and rebuilt["audit"] == audit and audit.get("salt") == doc.get("audit_salt"))
        if not rebuilt_ok:
            rebuilt_detail = "classes or audit block differ from the rows-derived queue"
    except (KeyError, TypeError) as exc:
        rebuilt_detail = f"rebuild failed: {exc}"
    rep.check("5.2 every recheck class and the deterministic audit reproduce exactly from the rows "
              "through the v1 tool's own builder (nothing excluded, nothing added)",
              rebuilt_ok, rebuilt_detail)
    classes = recheck.get("classes") or {}

    def class_urls(prefix: str) -> set[str]:
        return {ref.get("player_url") for key, refs in classes.items()
                if key.startswith(prefix) for ref in refs}

    mandatory = {ref.get("player_url") for key, refs in classes.items()
                 if key.startswith(MANDATORY_CLASS_PREFIXES) for ref in refs}
    audit_urls = [ref.get("player_url") for ref in classes.get(AUDIT_CLASS, [])]
    rep.check("5.3 every contradiction, limited, unregistered, unavailable and tooling row is in the "
              "mandatory recheck set and the recorded mandatory count agrees",
              len(class_urls("1_")) == counted["offline_contradict"]
              and len(class_urls("2_")) == counted["offline_limited"]
              and len(class_urls("3_")) == counted["target_unregistered"]
              and len(class_urls("4_")) == counted["offline_unavailable"]
              and len(class_urls("5_")) == counted["tooling_or_schema_error"]
              and recheck.get("mandatory_distinct_rows") == len(mandatory)
              and not (set(audit_urls) & mandatory) and len(set(audit_urls)) == len(audit_urls)
              and audit.get("count") == len(audit_urls),
              f"mandatory {len(mandatory)} recorded {recheck.get('mandatory_distinct_rows')!r}, "
              f"audit {len(audit_urls)}")
    residual_ok = False
    try:
        residual_ok = (base.build_residual_report(rows)["categories"] == residual.get("categories")
                       and residual.get("verdicts_sha256") == verdicts_sha
                       and residual.get("sample_sha256") == hashes["sample_json"]
                       and residual.get("generated_utc") == sample.get("generated_utc"))
    except (KeyError, TypeError):
        residual_ok = False
    rep.check("5.4 the residual report reproduces from the rows and is hash-linked", residual_ok)

    # ------------------------------------------------------------ 6. operator verdicts
    rep.section("6. Operator verdict artefact")
    operator_path = root / operator_rel
    verdict_by_url: dict[str, dict] = {}
    operator_present = operator_path.is_file()
    if not operator_present:
        emit(f"  PENDING 6.0 operator verdict artefact not present: {operator_rel}")
        acceptance["pending"].append(f"operator verdict artefact absent ({operator_rel})")
    else:
        try:
            op_bytes = operator_path.read_bytes()
            op = json.loads(op_bytes.decode("utf-8"))
            op_parsed = isinstance(op, dict)
        except (UnicodeDecodeError, json.JSONDecodeError):
            op, op_parsed = {}, False
        rep.check("6.1 the operator artefact parses as an object", op_parsed)
        if op_parsed:
            summary["operator_verdicts_sha256"] = base.sha256_bytes(op_bytes)
            rep.check("6.2 the operator artefact is hash-linked to this recheck queue, verdicts and sample, "
                      "and carries a UTC completion time",
                      op.get("source_recheck_sha256") == base.sha256_bytes(artefacts["recheck"])
                      and op.get("verdicts_sha256") == verdicts_sha
                      and op.get("sample_sha256") == hashes["sample_json"]
                      and isinstance(op.get("review_completed_utc"), str)
                      and bool(UTC_RE.match(op.get("review_completed_utc", ""))),
                      f"recheck {op.get('source_recheck_sha256')!r}, verdicts {op.get('verdicts_sha256')!r}")
            op_classes = op.get("classes") or {}
            same_sets = (set(op_classes) == set(classes) and all(
                [ref.get("player_url") for ref in op_classes.get(key, [])]
                == [ref.get("player_url") for ref in classes.get(key, [])] for key in classes))
            rep.check("6.3 the operator artefact carries exactly the recheck queue's classes and rows "
                      "(no row added, removed or reordered)", same_sets)
            machine_outcome = {r.get("player_url"): r.get("outcome") for r in rows if isinstance(r, dict)}
            problems: list[str] = []
            for key, refs in op_classes.items():
                for ref in refs:
                    url = ref.get("player_url")
                    verdict = ref.get("operator_verdict")
                    if url not in machine_outcome:
                        problems.append(f"{url}: not in the sample"); continue
                    if ref.get("outcome") != machine_outcome[url]:
                        problems.append(f"{url}: machine outcome edited")
                    if verdict is None:
                        continue
                    if verdict not in reviewer.OPERATOR_VERDICT_VALUES:
                        problems.append(f"{url}: verdict {verdict!r}"); continue
                    if not UTC_RE.match(str(ref.get("reviewed_utc") or "")):
                        problems.append(f"{url}: reviewed_utc")
                    if verdict in ("contradict", "undetermined") and not (
                            str(ref.get("notes") or "").strip() and ref.get("evidence")):
                        problems.append(f"{url}: {verdict} without notes and evidence")
                    prior = verdict_by_url.get(url)
                    if prior is not None and prior["operator_verdict"] != verdict:
                        problems.append(f"{url}: conflicting verdicts across classes")
                    verdict_by_url[url] = ref
            rep.check("6.4 every filled verdict is agree/contradict/undetermined with a UTC reviewed_utc, "
                      "contradict/undetermined carry notes and evidence, no machine outcome edited, "
                      "no verdict for a person outside the sample, no conflicting verdicts",
                      not problems, "; ".join(problems[:5]))

    # ------------------------------------------------------------ 7. acceptance
    rep.section("7. Acceptance under the documented rule")
    not_terminal = [r.get("player_url") for r in rows if isinstance(r, dict)
                    and r.get("outcome") in ("offline_unavailable", "tooling_or_schema_error")]
    if not_terminal:
        acceptance["blockers"].append(
            f"{len(not_terminal)} row(s) without a terminal outcome (offline_unavailable / "
            f"tooling_or_schema_error): supply the input or fix the tool and rerun, e.g. {not_terminal[:3]}")
    required = set(mandatory) | set(audit_urls)
    if require_per_row:
        required |= {s["player_url"] for s in sample_rows}
    pending_rows = sorted(u for u in required if u not in verdict_by_url)
    if pending_rows:
        acceptance["pending"].append(
            f"{len(pending_rows)} of {len(required)} required row(s) lack an operator verdict, "
            f"e.g. {pending_rows[:3]}")
    genuine: list[str] = []
    for r in rows:
        if isinstance(r, dict) and r.get("outcome") == "offline_contradict":
            v = verdict_by_url.get(r.get("player_url"))
            if v is not None and v["operator_verdict"] != "agree":
                genuine.append(r["player_url"])
    for url, v in verdict_by_url.items():
        if v["operator_verdict"] == "contradict" and url not in genuine:
            genuine.append(url)
    undetermined = sorted(u for u, v in verdict_by_url.items() if v["operator_verdict"] == "undetermined")
    audit_not_agree = [u for u in audit_urls
                       if u in verdict_by_url and verdict_by_url[u]["operator_verdict"] != "agree"]
    acceptance["genuine_contradictions"] = sorted(genuine)
    acceptance["undetermined"] = undetermined
    acceptance["audit_not_agree"] = audit_not_agree
    if genuine:
        acceptance["blockers"].append(
            f"{len(genuine)} genuine identity contradiction(s) stand (runbook §8): {sorted(genuine)[:5]}")
    if undetermined:
        acceptance["blockers"].append(
            f"{len(undetermined)} 'undetermined' verdict(s): not a pass, escalated, never redrawn "
            f"(§3.5): {undetermined[:5]}")
    if audit_not_agree:
        acceptance["blockers"].append(
            f"{len(audit_not_agree)} audit row(s) not confirmed 'agree': {audit_not_agree[:5]}")
    if acceptance["pending"]:
        acceptance["blockers"].append("operator adjudication incomplete: " + "; ".join(acceptance["pending"]))
    rep.check("7.1 the machine review observed contradictions are all surfaced in the recheck queue "
              "(never silently excluded)",
              set(class_urls("1_")) == {r.get("player_url") for r in rows
                                        if isinstance(r, dict) and r.get("outcome") == "offline_contradict"})
    accepted = not rep.failures and not acceptance["blockers"]
    acceptance["status"] = "ACCEPTED" if accepted else "NOT ACCEPTED"
    acceptance["operator_verdicts_present"] = operator_present
    acceptance["required_rows"] = len(required)
    acceptance["operator_verdicts_filled"] = len(verdict_by_url)
    bound_n = round(1.0 - 0.05 ** (1.0 / n), 6) if n else None
    bound_e = round(1.0 - 0.05 ** (1.0 / evaluable_n), 6) if evaluable_n else None
    failures_observed = len(genuine) + len(undetermined)
    acceptance["statement"] = {
        "wording": reviewer.REVIEW_WORDING,
        "n": n, "identity_evaluable_n": evaluable_n,
        "target_not_registered_n": deployment["target_not_registered"],
        "observed_failures": failures_observed,
        "one_sided_95_upper_bound_at_n": bound_n if accepted else None,
        "one_sided_95_upper_bound_at_identity_evaluable_n": bound_e if accepted else None,
        "lines": [
            f"review: {reviewer.REVIEW_WORDING}; criterion: {reviewer.CRITERION}",
            f"n = {n} (decision O-6: {deployment['target_not_registered']} target_not_registered rows "
            f"count toward n as terminal deployment withholding, not identity failures); "
            f"identity-evaluable rows = {evaluable_n}",
            (f"0 failures observed: one-sided 95% upper bound on the bridge error rate "
             f"{bound_n:.4%} at n = {n}; {bound_e:.4%} at the {evaluable_n} identity-evaluated rows "
             "(conservative figure)" if accepted else
             f"{failures_observed} failure(s)/undetermined observed or adjudication incomplete: "
             "no bound is claimed"),
            "comparison target: AFL Tables-derived retained evidence (fitzRoy/AFLDB), not an "
            "independent source; the census contributes no bound",
        ],
    }
    rep.check("7.2 no post-hoc exclusion: the rows the acceptance rule was applied to are exactly the "
              f"sample's {n} rows",
              len(rows) == n == len(sample_rows) and {r.get("player_url") for r in rows
                                                        if isinstance(r, dict)}
              == {s["player_url"] for s in sample_rows})
    return finish()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=str(REPO_ROOT),
                    help="repository root (tests point this at a fixture tree)")
    ap.add_argument("--operator-verdicts", default=reviewer.OPERATOR_VERDICTS_REL,
                    help="repository-relative path of the operator verdict artefact")
    ap.add_argument("--expect-verdicts-sha256", default=None,
                    help="the operator-reported sha256 of the machine verdicts artefact")
    ap.add_argument("--require-per-row-operator-verdicts", action="store_true",
                    help="stricter rule: every one of the n rows needs an operator verdict "
                         "(decision O-8), not only the mandatory recheck rows and the audit")
    args = ap.parse_args(argv)
    try:
        summary = validate(Path(args.root), operator_rel=args.operator_verdicts,
                           require_per_row=args.require_per_row_operator_verdicts,
                           expect_verdicts_sha256=args.expect_verdicts_sha256)
    except base.ToolError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1
    return exit_status(summary)


def exit_status(summary: dict) -> int:
    """0 = all checks passed and ACCEPTED; 2 = all checks passed, NOT ACCEPTED; 1 = a FAIL."""
    if summary["failures"]:
        return 1
    return 0 if summary["acceptance"]["status"] == "ACCEPTED" else 2


if __name__ == "__main__":
    raise SystemExit(main())
