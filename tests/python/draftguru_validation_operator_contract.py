#!/usr/bin/env python3
"""AFLDB-ISSUE-222 Phase F -- DB-free, headless contract checks for
tools/rebuild/draftguru/review_validation_operator.py (the operator-adjudication GUI for the
required recheck rows of the v2 validation sample's machine review).

    python tests/python/draftguru_validation_operator_contract.py

Exercises the GUI-independent session logic (input hash-linking, queue deduplication and
order, navigation, filters, drafts vs saved verdicts, checkpoint/resume, hash mismatch,
atomic writes, the lock, the verdict/notes/evidence contract, evidence-link validation, no
preselection, finalisation gating and deterministic rendering) against a hand-built 8-row
fixture in a temporary directory. When the real Phase F machine artefacts are present in the
checkout they are additionally read (never written) to prove the real 39 + 30 = 69 union.
Never imports tkinter, never opens a display, never touches the real checkpoint, never writes
the real operator artefact, never opens a database or a socket.
"""

from __future__ import annotations

import copy
import json
import os
import socket
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TOOL_DIR = ROOT / "tools" / "rebuild" / "draftguru"
sys.path.insert(0, str(TOOL_DIR))

import review_person_bridge_offline as base           # noqa: E402
import review_validation_sample as reviewer           # noqa: E402
import review_validation_operator as tool             # noqa: E402
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


def refusal(fn, *args, **kwargs) -> str | None:
    try:
        fn(*args, **kwargs)
    except base.ToolError as exc:
        return str(exc)
    return None


class Clock:
    def __init__(self) -> None:
        self.n = 0

    def __call__(self) -> str:
        self.n += 1
        return f"2026-09-18T12:{self.n // 60:02d}:{self.n % 60:02d}Z"


# ---------------------------------------------------------------------------
# Fixture: 8 machine rows -> recheck queue through the v1 builder -> temp repository tree
# ---------------------------------------------------------------------------

def dg_url(slug: str) -> str:
    return f"https://www.draftguru.com.au/players/{slug}/1"


def machine_row(i: int, slug: str, name: str, letter: str, *, outcome: str = "offline_strong",
                registered: bool = True, weak: bool = False, numeric_suffix: bool = False,
                reason_codes: list[str] | None = None) -> dict:
    identity = f"players/{letter}/{name.replace(' ', '_')}{'2' if numeric_suffix else ''}.html"
    retained = None if not registered else {
        "career_games": 100 + i, "clubs": ["Fremantle", "Carlton"], "debut_date": "2010-04-01",
        "debut_season": 2010, "distinct_fitzroy_id_count": 1, "dob_years": [1990],
        "first_names": [name.split()[0]], "fitzroy_ids": [str(12000 + i)], "goals_sum": 10,
        "implied_birth_year": 1990, "last_season": 2018, "na_goals": 0, "players": [name],
        "surnames": [name.split()[1]],
    }
    return {
        "aliases": [], "awards_census_names": [],
        "child_status": "bridged" if registered else "target_not_registered",
        "deployment_status": "bridged" if registered else "target_not_registered",
        "draftguru": {"afltables_href_count": 1, "captured_identity": identity,
                      "distinct_afltables_identity_count": 1, "dob_candidates": ["01 Jan 1990"],
                      "player_url": dg_url(slug), "raw_filename": f"raw/persons/{slug}__1.html",
                      "raw_sha256": "0" * 64, "title": f"{name} (born 1990) - Draftguru",
                      "title_birth_year": 1990, "visible_name": name},
        "expected_afltables_identity": identity,
        "flags": {"continuity_rule_url": False, "known_exception_class": None,
                  "name_variant": False, "numeric_suffix": numeric_suffix},
        "identity_evaluable": outcome in ("offline_strong", "offline_limited", "offline_contradict"),
        "ledger_status": "none", "missing_fields": [],
        "operator_review_required": outcome != "offline_strong", "operator_verdict": None,
        "ordinal": i, "outcome": outcome, "player_url": dg_url(slug),
        "reason_codes": reason_codes or ["BIRTH_YEAR_CONSISTENT", "DEBUT_NOT_BEFORE_EARLIEST_RECRUITMENT",
                                         "GAMES_CONSISTENT", "CLUB_HISTORY_OVERLAPS"],
        "retained_target": retained, "sample_index": i, "selection_key": f"{i:064x}",
        "stage_a": {"display_names_raw": [name.replace(" ", " ")],
                    "earliest_original_recruitment": {"draft_year": 2009, "event_type_raw": "National"},
                    "earliest_trade_year": None,
                    "rows": [{"age_raw": "18yr", "club_name_raw": "Fremantle", "draft_year": 2009,
                              "event_type_raw": "National", "games": 100 + i, "goals": 10, "pick_number": i}],
                    "trade_only": False},
        "stratum": "validation", "weak_evidence": weak,
    }


U = {
    "u1": dg_url("alpha_one"), "u2": dg_url("bravo_two"), "u3": dg_url("charlie_three"),
    "u4": dg_url("delta_four"), "u5": dg_url("echo_five"), "u6": dg_url("foxtrot_six"),
    "u7": dg_url("golf_seven"), "u8": dg_url("hotel_eight"),
}


def fixture_rows() -> list[dict]:
    return [
        machine_row(1, "alpha_one", "Alpha One", "O"),
        machine_row(2, "bravo_two", "Bravo Two", "T", outcome="target_unregistered", registered=False,
                    reason_codes=["TARGET_NOT_REGISTERED"]),
        machine_row(3, "charlie_three", "Charlie Three", "T", outcome="offline_limited", weak=True,
                    reason_codes=["NAME_VARIANT_UNLISTED", "BIRTH_YEAR_CONSISTENT"]),
        machine_row(4, "delta_four", "Delta Four", "F", outcome="offline_contradict",
                    reason_codes=["BIRTH_YEAR_CONFLICT"]),
        machine_row(5, "echo_five", "Echo Five", "F"),
        machine_row(6, "foxtrot_six", "Foxtrot Six", "S", numeric_suffix=True),
        machine_row(7, "golf_seven", "Golf Seven", "S"),
        machine_row(8, "hotel_eight", "Hotel Eight", "E"),
    ]


GENERATED = "2026-09-18T09:59:26Z"


def new_root(*, rows: list[dict] | None = None) -> Path:
    root = Path(tempfile.mkdtemp(prefix="afldb-i222-operator-"))
    rows = fixture_rows() if rows is None else rows
    rel = tool.default_rel()
    sample_bytes = base.dump_json_lf({"n": len(rows), "rows_sha256": "fixture", "generated_utc": GENERATED})
    storage = {"path": tool.FINAL_REL, "template": rel["recheck"],
               "allowed_verdicts": list(tool.VERDICT_VALUES), "rule": "fixture"}
    verdicts_doc = {"rows": rows, "rows_sha256": base.sha256_bytes(base.canonical_json_bytes(rows)),
                    "operator_verdict_storage": storage, "generated_utc": GENERATED}
    verdicts_bytes = base.dump_json_lf(verdicts_doc)
    recheck = base.build_recheck_queue(
        rows, audit_salt="AFLDB-ISSUE-222/audit-v2", verdicts_sha256=base.sha256_bytes(verdicts_bytes),
        sample_sha256=base.sha256_bytes(sample_bytes), parent_sha256="a" * 64, child_sha256="b" * 64)
    recheck["generated_utc"] = GENERATED
    recheck["issue"], recheck["label"], recheck["phase"] = reviewer.ISSUE, reviewer.LABEL, reviewer.PHASE
    recheck["verdicts_path"] = rel["verdicts_json"]
    recheck["mandatory_distinct_rows"] = len({ref["player_url"] for key, refs in recheck["classes"].items()
                                              if not key.startswith("11_") for ref in refs})
    recheck["operator_verdict_storage"] = storage
    residual = base.build_residual_report(rows)
    residual["generated_utc"] = GENERATED
    residual["verdicts_sha256"] = base.sha256_bytes(verdicts_bytes)
    residual["sample_sha256"] = base.sha256_bytes(sample_bytes)
    for key, data in (("sample_json", sample_bytes), ("verdicts_json", verdicts_bytes),
                      ("verdicts_csv", b"fixture,csv\n"), ("recheck", base.dump_json_lf(recheck)),
                      ("residual", base.dump_json_lf(residual))):
        path = root / rel[key]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return root


CKPT = "data/review/fixture-validation-operator"


def open_session(root: Path, *, clock: Clock | None = None, expect: dict | None = None) -> tool.ReviewSession:
    inputs = tool.load_inputs(root, pinned={}, expect={} if expect is None else expect)
    paths = tool.checkpoint_paths(root, CKPT)
    clock = clock or Clock()
    checkpoint = tool.load_or_create_checkpoint(paths, inputs, clock=clock)
    return tool.ReviewSession(inputs, checkpoint, paths["progress"], clock=clock)


def decide(session: tool.ReviewSession, verdict: str, notes: str = "", evidence: str = "") -> list[str]:
    session.set_draft(verdict=verdict, notes=notes, evidence_text=evidence)
    return session.commit()


def go_to(session: tool.ReviewSession, url: str) -> None:
    session.go_to_queue_position(session.by_url[url]["position"])


def validator_section6(op: dict, recheck: dict, rows_by_url: dict) -> list[str]:
    """A literal mirror of validate_validation_review.py checks 6.2-6.4 over one artefact."""
    problems: list[str] = []
    classes = recheck["classes"]
    op_classes = op.get("classes") or {}
    if not (set(op_classes) == set(classes) and all(
            [r.get("player_url") for r in op_classes.get(k, [])] == [r.get("player_url") for r in classes[k]]
            for k in classes)):
        problems.append("6.3 class sets/order")
    if not isinstance(op.get("review_completed_utc"), str) or not final.UTC_RE.match(op["review_completed_utc"]):
        problems.append("6.2 review_completed_utc")
    seen: dict[str, dict] = {}
    for key, refs in op_classes.items():
        for ref in refs:
            url = ref.get("player_url")
            verdict = ref.get("operator_verdict")
            if url not in rows_by_url:
                problems.append(f"{url}: not in the sample"); continue
            if ref.get("outcome") != rows_by_url[url]["outcome"]:
                problems.append(f"{url}: machine outcome edited")
            if verdict is None:
                continue
            if verdict not in reviewer.OPERATOR_VERDICT_VALUES:
                problems.append(f"{url}: verdict {verdict!r}"); continue
            if not final.UTC_RE.match(str(ref.get("reviewed_utc") or "")):
                problems.append(f"{url}: reviewed_utc")
            if verdict in ("contradict", "undetermined") and not (
                    str(ref.get("notes") or "").strip() and ref.get("evidence")):
                problems.append(f"{url}: {verdict} without notes and evidence")
            prior = seen.get(url)
            if prior is not None and prior["operator_verdict"] != verdict:
                problems.append(f"{url}: conflicting verdicts across classes")
            seen[url] = ref
    return problems


# ---------------------------------------------------------------------------
section("1. Vocabulary, schema and boundaries")
SRC = (TOOL_DIR / "review_validation_operator.py").read_text(encoding="utf-8")
check("1.1 the verdict vocabulary is exactly the reviewer/validator vocabulary",
      tool.VERDICT_VALUES == tuple(reviewer.OPERATOR_VERDICT_VALUES) == ("agree", "contradict", "undetermined"))
check("1.2 the final artefact path is exactly the validator's operator_rel",
      tool.FINAL_REL == reviewer.OPERATOR_VERDICTS_REL
      and tool.FINAL_REL.endswith("bridge-validation-operator-verdicts-20260918-v2.json"))
check("1.3 mandatory prefixes, audit class and UTC rule come from the final validator",
      tool.MANDATORY_CLASS_PREFIXES is final.MANDATORY_CLASS_PREFIXES and tool.AUDIT_CLASS == final.AUDIT_CLASS
      and tool.UTC_RE is final.UTC_RE)
check("1.4 the checkpoint lives in a new data/review Phase F directory, separate from the 83-row lineage",
      tool.CHECKPOINT_DIR_REL.startswith("data/review/") and "validation-operator" in tool.CHECKPOINT_DIR_REL
      and tool.CHECKPOINT_DIR_REL != "data/review/draftguru-bridge-operator-20260918-v1")
check("1.5 the source imports no database client, importer, resolver or HTTP client and reads no environment",
      all(token not in SRC for token in ("psycopg", "DATABASE_URL", "import socket", "urllib.request",
                                          "import requests", "import_draftguru", "export_person_bridge",
                                          "reconcile_person_bridge", "os.environ", "import review_bridge_operator")))
check("1.6 no database client module is loaded after importing the tool",
      not any(name.split(".")[0] in ("psycopg", "psycopg2", "asyncpg", "sqlalchemy") for name in sys.modules))
check("1.7 the pinned hashes are the operator-reported 2026-09-18 values",
      tool.PINNED_SHA256["recheck"].startswith("3e509021") and tool.PINNED_SHA256["verdicts_json"].startswith("2caf980b")
      and tool.PINNED_SHA256["verdicts_csv"].startswith("d2a5c336") and tool.PINNED_SHA256["residual"].startswith("d20a3c6f")
      and tool.PINNED_SHA256["sample_json"] == reviewer.SAMPLE_JSON_SHA256
      and tool.EXPECT == {"rows_sha256": "14d918a183fb37c9b214c28d2cd95073b1f26777d40dd0ce06cab659451d3166",
                          "mandatory": 39, "audit": 30, "total": 69})
check("1.8 the eleven queue classes are exactly the v1 builder's class keys, in runbook order",
      list(tool.CLASS_ORDER) == list(base.build_recheck_queue(
          fixture_rows(), audit_salt="s", verdicts_sha256="v", sample_sha256="s", parent_sha256="p",
          child_sha256="c")["classes"]))
check("1.9 the plain-English statement says target_not_registered is not an identity contradiction",
      "NOT itself an identity contradiction" in tool.DEPLOYMENT_STATEMENT
      and tool.DEPLOYMENT_STATEMENT in tool.HELP_TEXT and "never edits the machine identity outcome"
      in tool.DEPLOYMENT_STATEMENT)
check("1.10 every verdict label carries its stored value beneath it in the help and explains all three meanings",
      all(f"[{v}]" in tool.HELP_TEXT for v in tool.VERDICT_VALUES)
      and "escalated" in tool.VERDICT_LABELS["undetermined"] and "DIFFERENT human" in tool.VERDICT_LABELS["contradict"]
      and "SAME human" in tool.VERDICT_LABELS["agree"] and "continued withholding" in tool.VERDICT_LABELS["agree"])
check("1.11 the next command after finalisation is the final validator",
      tool.NEXT_COMMAND == "python tools/rebuild/draftguru/validate_validation_review.py"
      and tool.NEXT_COMMAND in tool.HELP_TEXT)

# ---------------------------------------------------------------------------
section("2. Inputs and the deduplicated queue (fixture)")
root = new_root()
inputs = tool.load_inputs(root, pinned={}, expect={})
queue = inputs["queue"]
urls = [q["player_url"] for q in queue]
check("2.1 8 rows -> 8 unique queue entries = 4 mandatory + 4 audit; a person in two classes appears once",
      len(queue) == 8 == len(set(urls)) and inputs["mandatory"] == 4 and inputs["audit"] == 4
      and urls.count(U["u3"]) == 1)
u3 = inputs["queue"][urls.index(U["u3"])]
check("2.2 the two-class person lists both memberships, in class order",
      u3["classes"] == ["2_offline_limited", "10_weak_or_suffix_or_continuity"] and u3["is_mandatory"]
      and not u3["is_audit"] and u3["classification"] == "mandatory")
check("2.3 queue order is mandatory rows in sample order, then the audit in sample order; positions 1..n",
      urls == [U["u2"], U["u3"], U["u4"], U["u6"], U["u1"], U["u5"], U["u7"], U["u8"]]
      and [q["position"] for q in queue] == list(range(1, 9)))
check("2.4 target_not_registered stays a deployment status with identity_evaluable false and no retained target",
      queue[0]["outcome"] == "target_unregistered" and queue[0]["deployment_status"] == "target_not_registered"
      and queue[0]["identity_evaluable"] is False and queue[0]["machine"]["retained_target"] is None
      and all(q["deployment_status"] == "bridged" for q in queue[1:]))
check("2.5 expected-count mismatch is refused (mandatory 5)",
      "expected mandatory" in (refusal(tool.load_inputs, root, pinned={}, expect={"mandatory": 5}) or ""))
check("2.6 a pinned-hash mismatch is refused before anything is read further",
      "hash mismatch for recheck" in (refusal(tool.load_inputs, root, pinned={"recheck": "f" * 64}, expect={}) or ""))
tampered = new_root()
vpath = tampered / tool.default_rel()["verdicts_json"]
vpath.write_bytes(vpath.read_bytes().replace(b"Alpha One", b"Alpha Won"))
check("2.7 a verdicts artefact that no longer hash-links to the recheck queue is refused",
      "not hash-linked to the verdicts" in (refusal(tool.load_inputs, tampered, pinned={}, expect={}) or ""))
check("2.8 a stray operator verdict inside the machine rows is refused",
      "carries an operator verdict" in (refusal(tool.load_inputs, new_root(rows=[
          {**fixture_rows()[0], "operator_verdict": "agree"}, *fixture_rows()[1:]]), pinned={}, expect={}) or ""))

# ---------------------------------------------------------------------------
section("3. Row presentation (pure helpers)")
u2 = queue[0]
u1 = queue[4]
summary2 = tool.identity_summary(u2)
check("3.1 identity summary shows the DraftGuru person and the proposed AFL Tables identity",
      summary2["draftguru_name"] == "Bravo Two" and summary2["proposed_identity"] == "players/T/Bravo_Two.html"
      and summary2["deployment_status"] == "target_not_registered" and summary2["identity_evaluable"] is False)
comp2 = dict((f, (l, r)) for f, l, r in tool.comparison_rows(u2))
comp1 = dict((f, (l, r)) for f, l, r in tool.comparison_rows(u1))
check("3.2 comparison shows names, birth year, career span, games, clubs and identity; the withheld row "
      "shows 'no retained target facts' on the retained side",
      set(comp1) == {"Names", "Birth year", "Career span", "Games", "Clubs", "Identity"}
      and "1990" in comp1["Birth year"][0] and "DOB year(s) 1990" in comp1["Birth year"][1]
      and "debut 2010" in comp1["Career span"][1] and "career games 101" in comp1["Games"][1]
      and "Fremantle, Carlton" in comp1["Clubs"][1]
      and all("no retained target facts" in comp2[f][1] for f in comp2))
check("3.3 review reasons name every class membership with its plain-English label plus the flags",
      [r for r in tool.review_reasons(u3) if r.startswith("2_offline_limited")] and
      [r for r in tool.review_reasons(u3) if r.startswith("10_weak")] and
      any("weak evidence" in r for r in tool.review_reasons(u3)))
check("3.4 reason codes are explained and contradiction codes are identified",
      any(line.startswith("BIRTH_YEAR_CONFLICT -- CONTRADICTION") for line in tool.reason_code_lines(queue[2]))
      and "BIRTH_YEAR_CONFLICT" in tool.CONTRADICTION_CODES and "DEBUT_BEFORE_EARLIEST_RECRUITMENT"
      not in tool.CONTRADICTION_CODES)
check("3.5 verdict guidance distinguishes audit, mandatory, contradiction-override and withheld rows",
      tool.verdict_guidance(u1).startswith("AUDIT ROW") and "never replaced or redrawn" in tool.verdict_guidance(u1)
      and tool.verdict_guidance(u2).startswith("MANDATORY") and "NOT itself an identity contradiction"
      in tool.verdict_guidance(u2) and "override" in tool.verdict_guidance(queue[2])
      and all("Save verdict for this row" in tool.verdict_guidance(q) for q in queue))
check("3.6 no citation is invented: none on the fixture rows; a genuinely present one is surfaced",
      tool.retained_citations(u1["machine"]) == []
      and tool.retained_citations({**u1["machine"], "wikipedia_citation": "https://en.wikipedia.org/wiki/X"})
      == [("wikipedia_citation", '"https://en.wikipedia.org/wiki/X"')])

# ---------------------------------------------------------------------------
section("4. Evidence links")
links = tool.evidence_links_for(u1)
check("4.1 both links build from the row: DraftGuru URL as captured, AFL Tables from the canonical identity",
      links["draftguru_url"] == U["u1"] and links["afltables_url"] == "https://afltables.com/afl/stats/players/O/Alpha_One.html"
      and links["draftguru_error"] is None and links["afltables_error"] is None)
check("4.2 the AFL Tables builder refuses traversal, query strings, absolute URLs and foreign shapes",
      all(refusal(tool.build_afltables_url, bad) for bad in
          ("../players/A/X.html", "players/A/X.html?x=1", "https://evil.example/players/A/X.html",
           "players/a/X.html", "players/A/X.htm", "", "players/A/X Y.html")))
check("4.3 scheme/host allow-list: javascript:, file:, an unexpected host and a look-alike host are refused",
      all(refusal(tool.validate_evidence_url, bad, tool.DRAFTGURU_ALLOWED_HOSTS) for bad in
          ("javascript:alert(1)", "file:///etc/passwd", "https://example.com/players/x/1",
           "https://draftguru.com.au.evil.example/players/x/1"))
      and refusal(tool.validate_evidence_url, U["u1"], tool.DRAFTGURU_ALLOWED_HOSTS) is None)
opened: list[str] = []
result = tool.open_evidence_url(links["afltables_url"], tool.AFLTABLES_ALLOWED_HOSTS, opener=lambda u: opened.append(u) or True)
bad = tool.open_evidence_url("https://example.com/x", tool.AFLTABLES_ALLOWED_HOSTS, opener=lambda u: opened.append(u) or True)
check("4.4 a valid URL calls the (mocked) opener exactly once; a refused URL never reaches it",
      result["ok"] and opened == [links["afltables_url"]] and not bad["ok"] and "unexpected host" in bad["error"])
apostrophe = tool.evidence_links_for({"machine": {**u1["machine"], "player_url": "https://www.draftguru.com.au/players/balyn_o'brien/1"}})
check("4.5 a DraftGuru URL with an apostrophe or %20 is accepted as captured (never re-encoded)",
      apostrophe["draftguru_url"] == "https://www.draftguru.com.au/players/balyn_o'brien/1")

# ---------------------------------------------------------------------------
section("5. Session: no preselection, navigation, unsaved state")
clock = Clock()
s = open_session(root, clock=clock)
paths = tool.checkpoint_paths(root, CKPT)
before = paths["progress"].read_bytes()
tool.open_evidence_url(links["afltables_url"], tool.AFLTABLES_ALLOWED_HOSTS, opener=lambda u: True)
check("5.1 a fresh session has no verdict selected, reports NO VERDICT, and opening a link changes nothing",
      s.draft == {"verdict": None, "notes": "", "evidence_text": ""} and s.status_text().startswith("NO VERDICT")
      and not s.is_dirty() and paths["progress"].read_bytes() == before)
check("5.2 position text and bounds: 'Row 1 of 8', Previous disabled only at the first row",
      s.position_text() == "Row 1 of 8" and not s.can_go_prev() and s.can_go_next())
for _ in range(7):
    s.go_next()
check("5.3 Next disabled only at the last row; Previous enabled there",
      s.position_text() == "Row 8 of 8" and not s.can_go_next() and s.can_go_prev()
      and s.current()["player_url"] == U["u8"])
s.go_next()
check("5.4 Next at the last row is a no-op (never strands or wraps)", s.position_text() == "Row 8 of 8")
go_to(s, U["u1"])
s.set_draft(verdict="agree")
check("5.5 selecting a verdict is UNSAVED until committed and is never reported as saved",
      s.is_dirty() and s.status_text().startswith("UNSAVED") and "'agree' selected" in s.status_text()
      and s.decision_for(U["u1"]) is None and s.progress()["completed"] == 0)
blocked = []
for fn in (s.go_next, s.go_prev, lambda: s.set_filter("classification", "audit"), lambda: s.go_to_queue_position(1)):
    try:
        fn()
        blocked.append(False)
    except tool.UnsavedChanges:
        blocked.append(True)
check("5.6 navigation, filtering and jumping are all blocked while an edit is unsaved (Save or Discard first)",
      blocked == [True, True, True, True] and s.current()["player_url"] == U["u1"])
check("5.7 committing saves the verdict, stamps reviewed_utc, and the status reads SAVED with the stored value",
      s.commit() == [] and not s.is_dirty() and s.status_text().startswith("SAVED: 'agree' (stored value \"agree\")")
      and s.decision_for(U["u1"])["reviewed_utc"].startswith("2026-09-18T12:")
      and json.loads(paths["progress"].read_text(encoding="utf-8"))["decisions"][U["u1"]]["operator_verdict"] == "agree")
s.set_draft(notes="changed my mind")
check("5.8 editing notes after a save is UNSAVED again (notes/evidence changed) and Discard restores the saved state",
      s.is_dirty() and "notes/evidence changed" in s.status_text() and (s.discard() or True)
      and not s.is_dirty() and s.status_text().startswith("SAVED"))
go_to(s, U["u5"])
s.set_draft(verdict="undetermined", notes="half done")
s.stash_draft()
resumed = open_session(root, clock=clock)
go_to(resumed, U["u5"])
check("5.9 a stashed draft survives restart as a DRAFT (still UNSAVED, not counted, not a verdict)",
      resumed.draft["verdict"] == "undetermined" and resumed.draft["notes"] == "half done"
      and resumed.is_dirty() and resumed.status_text().startswith("UNSAVED")
      and resumed.progress()["completed"] == 1 and resumed.decision_for(U["u5"]) is None)
resumed.discard()
check("5.10 discarding the draft clears it from the checkpoint",
      json.loads(paths["progress"].read_text(encoding="utf-8"))["drafts"] == {})

# ---------------------------------------------------------------------------
section("6. Verdict, notes and evidence contract")
s = open_session(root, clock=clock)
go_to(s, U["u4"])  # machine offline_contradict
check("6.1 on a machine-contradiction row, 'agree' (the override) requires notes AND evidence",
      len(decide(s, "agree")) == 2 and s.decision_for(U["u4"]) is None
      and any("override" in p for p in s.draft_problems())
      and decide(s, "agree", notes="DraftGuru DOB and retained DOB agree; conflict was a typo", evidence="retained_target.dob_years") == [])
go_to(s, U["u1"])
check("6.2 'contradict' without notes and evidence is rejected with both problems named; nothing is saved",
      decide(s, "contradict") == ["notes are required for 'contradict'", "at least one evidence line is required for 'contradict'"]
      and s.decision_for(U["u1"])["operator_verdict"] == "agree")
check("6.3 'undetermined' with notes but no evidence is rejected; with both it is recorded (and will block acceptance)",
      decide(s, "undetermined", notes="cannot tell") == ["at least one evidence line is required for 'undetermined'"]
      and decide(s, "undetermined", notes="cannot tell", evidence="span ambiguous\n\nspan ambiguous\n  ") == []
      and s.decision_for(U["u1"])["evidence"] == ["span ambiguous"]
      and s.acceptance_preview()["undetermined"] == [U["u1"]] and not s.acceptance_preview()["would_be_accepted"])
check("6.4 an empty or unknown verdict is rejected",
      decide(s, "") == ["no verdict selected"] and "not one of" in decide(s, "maybe")[0])
check("6.5 'agree' on an ordinary row needs no notes; the saved decision records classes, classification "
      "and the unedited machine outcome",
      decide(s, "agree") == [] and s.decision_for(U["u1"]) == {
          "operator_verdict": "agree", "notes": None, "evidence": None,
          "reviewed_utc": s.decision_for(U["u1"])["reviewed_utc"], "sample_index": 1,
          "classes": ["11_deterministic_audit"], "classification": "audit",
          "machine_outcome": "offline_strong", "deployment_status": "bridged"})
go_to(s, U["u2"])
check("6.6 a target_not_registered row takes an ordinary 'agree' (continued withholding) without touching "
      "its outcome or deployment status",
      decide(s, "agree") == [] and s.current()["outcome"] == "target_unregistered"
      and s.current()["deployment_status"] == "target_not_registered"
      and s.decision_for(U["u2"])["machine_outcome"] == "target_unregistered")
go_to(s, U["u1"])
s.clear_decision()
check("6.7 clearing a saved verdict makes the row incomplete again (explicit action, nothing else changes)",
      s.decision_for(U["u1"]) is None and s.row_state(U["u1"]) == "incomplete"
      and s.decision_for(U["u2"])["operator_verdict"] == "agree")
check("6.8 no bulk-positive action exists in the tool",
      not any(token in SRC for token in ("agree_all", "def _bulk", "mark_all", "accept_all", "Agree all")))

# ---------------------------------------------------------------------------
section("7. Filters preserve deterministic queue order")
s = open_session(root, clock=clock)  # saved: u2 agree, u4 agree
s.set_filter("classification", "mandatory")
check("7.1 classification=mandatory shows the 4 mandatory rows in queue order and keeps the current row",
      [q["position"] for q in s.visible()] == [1, 2, 3, 4] and s.current()["player_url"] == U["u2"]
      and s.position_text() == "Row 1 of 4 shown (queue position 1 of 8)")
s.set_filter("classification", "audit")
check("7.2 classification=audit shows the 4 audit rows in queue order; current falls to the first shown",
      [q["position"] for q in s.visible()] == [5, 6, 7, 8] and s.current()["player_url"] == U["u1"])
s.set_filter("classification", "all")
s.set_filter("completion", "incomplete")
check("7.3 completion=incomplete hides the saved rows and preserves order",
      [q["player_url"] for q in s.visible()] == [U["u3"], U["u6"], U["u1"], U["u5"], U["u7"], U["u8"]])
s.set_filter("completion", "complete")
check("7.4 completion=complete shows exactly the saved rows in order",
      [q["player_url"] for q in s.visible()] == [U["u2"], U["u4"]])
s.set_filter("completion", "all")
s.set_filter("outcome", "target_unregistered")
one = [q["player_url"] for q in s.visible()]
s.set_filter("outcome", "all")
s.set_filter("deployment", "target_not_registered")
check("7.5 machine-outcome and deployment-status filters are separate controls that each isolate the withheld row",
      one == [U["u2"]] == [q["player_url"] for q in s.visible()])
s.set_filter("deployment", "bridged")
check("7.6 deployment=bridged shows the other 7 in order",
      [q["position"] for q in s.visible()] == [2, 3, 4, 5, 6, 7, 8])
s.set_filter("deployment", "all")
s.set_filter("outcome", "offline_unavailable")
check("7.7 an empty filter result reports no rows without crashing; navigation is inert",
      s.current() is None and "No rows match" in s.position_text() and not s.can_go_next()
      and not s.can_go_prev() and s.go_next() is None)
check("7.8 an unknown filter value is refused", bool(refusal(s.set_filter, "outcome", "anything")))
check("7.9 the filter vocabulary is the six machine outcomes and the two deployment statuses",
      tool.FILTER_VALUES["outcome"] == ("all",) + tuple(base.OUTCOMES)
      and tool.FILTER_VALUES["deployment"] == ("all", "bridged", "target_not_registered"))

# ---------------------------------------------------------------------------
section("8. Checkpoint: resume, hash-linking, refusals, atomicity, lock")
s = open_session(root, clock=clock)
check("8.1 every saved decision is preserved across restart and the checkpoint is hash-linked to all artefacts",
      s.progress()["completed"] == 2 and s.checkpoint["source"] == tool.source_block(s.inputs)
      and set(s.checkpoint["source"]) >= {"recheck_sha256", "verdicts_json_sha256", "verdicts_csv_sha256",
                                          "residual_sha256", "sample_sha256", "rows_sha256", "queue_sha256"})
cp = copy.deepcopy(s.checkpoint)
cp["source"]["recheck_sha256"] = "e" * 64
check("8.2 a checkpoint recorded against different artefacts is refused (no resume)",
      "refusing to resume" in (refusal(tool.validate_checkpoint_matches_inputs, cp, s.inputs) or ""))
cp = copy.deepcopy(s.checkpoint)
cp["decisions"]["https://www.draftguru.com.au/players/nobody/1"] = dict(cp["decisions"][U["u2"]])
check("8.3 a decision for a person outside the queue is refused",
      "outside the queue" in (refusal(tool.validate_checkpoint_matches_inputs, cp, s.inputs) or ""))
cp = copy.deepcopy(s.checkpoint)
cp["decisions"][U["u2"]]["machine_outcome"] = "offline_strong"
check("8.4 a decision whose recorded machine outcome differs from the artefact is refused",
      "machine outcome" in (refusal(tool.validate_checkpoint_matches_inputs, cp, s.inputs) or ""))
cp = copy.deepcopy(s.checkpoint)
cp["schema_version"] = 2
old_style = {"schema_version": 1, "source_pack_sha256": "x" * 64, "decisions": {}, "bulk_actions_log": []}
check("8.5 an unknown schema version and the earlier 83-row checkpoint shape are both refused; nothing migrates",
      "migrates nothing" in (refusal(tool.validate_checkpoint_matches_inputs, cp, s.inputs) or "")
      and "refusing to resume" in (refusal(tool.validate_checkpoint_matches_inputs, old_style, s.inputs) or "")
      and "def migrate" not in SRC and "migrate_checkpoint" not in SRC)
original = paths["progress"].read_bytes()
real_replace = os.replace


def failing_replace(*_a, **_k):
    raise OSError("simulated replace failure")


os.replace = failing_replace
try:
    failed = False
    try:
        s.checkpoint["decisions"][U["u6"]] = dict(s.checkpoint["decisions"][U["u2"]])
        s.save()
    except OSError:
        failed = True
finally:
    os.replace = real_replace
check("8.6 atomic write: a failed replace leaves the previous checkpoint byte-identical and no temp file behind",
      failed and paths["progress"].read_bytes() == original
      and not [p for p in paths["dir"].iterdir() if p.name.startswith(".progress.json.tmp")])
s.checkpoint["decisions"].pop(U["u6"], None)
lock = paths["lock"]
tool.acquire_lock(lock)
second = refusal(tool.acquire_lock, lock)
forced = tool.acquire_lock(lock, force=True)
tool.release_lock(lock)
check("8.7 lock: a second session is refused; --force-unlock replaces it; release removes it",
      lock.is_file() is False and "review lock already exists" in (second or "") and forced["tool"] == tool.TOOL)
tool.release_lock(lock)
check("8.8 releasing an absent lock is harmless", not lock.is_file())

# ---------------------------------------------------------------------------
section("9. Finalisation gating and deterministic rendering")
s = open_session(root, clock=clock)
check("9.1 finalisation is disabled until every required row has a valid verdict",
      not s.can_finalize() and len(s.finalize_blockers()) == 6
      and "do not satisfy" in (refusal(s.render_final, "2026-09-18T13:00:00Z") or ""))
for url in (U["u3"], U["u6"], U["u1"], U["u5"], U["u7"], U["u8"]):
    go_to(s, url)
    assert decide(s, "agree") == [], url
check("9.2 with all 8 rows saved, finalisation is enabled and the preview expects no blocker",
      s.can_finalize() and s.acceptance_preview()["would_be_accepted"] and s.progress()["remaining"] == 0)
ts = "2026-09-18T13:00:00Z"
data1 = s.render_final(ts)
data2 = s.render_final(ts)
op = json.loads(data1.decode("utf-8"))
recheck = json.loads((root / tool.default_rel()["recheck"]).read_bytes().decode("utf-8"))
check("9.3 rendering is deterministic (identical bytes), canonical ASCII LF, sorted keys",
      data1 == data2 and data1 == base.dump_json_lf(op) and data1.isascii() and b"\r" not in data1)
check("9.4 the artefact satisfies the validator's section 6 contract: hash-linked to the recheck queue, "
      "verdicts and sample; same classes and row order; verdict values; UTC stamps; no machine outcome edited",
      validator_section6(op, recheck, s.inputs["rows_by_url"]) == []
      and op["source_recheck_sha256"] == s.inputs["sha256"]["recheck"]
      and op["verdicts_sha256"] == s.inputs["sha256"]["verdicts_json"]
      and op["sample_sha256"] == s.inputs["sha256"]["sample_json"] and op["review_completed_utc"] == ts)
refs3 = [ref for key in tool.CLASS_ORDER for ref in op["classes"][key] if ref["player_url"] == U["u3"]]
check("9.5 a person in two classes carries the identical operator block in both (never conflicting)",
      len(refs3) == 2 and refs3[0] == refs3[1] and refs3[0]["operator_verdict"] == "agree")
ref2 = op["classes"]["3_target_unregistered"][0]
ref4 = op["classes"]["1_offline_contradict"][0]
check("9.6 the withheld row keeps outcome target_unregistered beside its 'agree'; the override carries notes+evidence",
      ref2["player_url"] == U["u2"] and ref2["outcome"] == "target_unregistered" and ref2["operator_verdict"] == "agree"
      and ref4["operator_verdict"] == "agree" and ref4["notes"] and ref4["evidence"] == ["retained_target.dob_years"])
check("9.7 every required row's verdict is filled; the summary counts reconcile",
      all(ref["operator_verdict"] is not None and final.UTC_RE.match(ref["reviewed_utc"])
          for key in tool.CLASS_ORDER for ref in op["classes"][key])
      and op["operator_summary"]["verdict_counts"] == {"agree": 8, "contradict": 0, "undetermined": 0}
      and op["operator_summary"]["required_rows"] == 8 and op["operator_tool"]["path"] == tool.TOOL)
result = s.finalize(ts)
final_path = root / tool.FINAL_REL
check("9.8 finalise writes exactly the operator artefact path, records it in the checkpoint, and names the next command",
      final_path.is_file() and final_path.read_bytes() == data1 and result["path"] == tool.FINAL_REL
      and result["sha256"] == base.sha256_bytes(data1) and result["next_command"] == tool.NEXT_COMMAND
      and s.checkpoint["finalized"] and s.checkpoint["final_sha256"] == result["sha256"]
      and not result["already_identical"])
again = s.finalize(ts)
check("9.9 finalising again with identical content is idempotent", again["already_identical"] and final_path.read_bytes() == data1)
final_path.write_bytes(data1 + b"\n")
check("9.10 a differing existing artefact is never overwritten",
      "refusing to overwrite" in (refusal(s.finalize, ts) or "") and final_path.read_bytes() == data1 + b"\n")
final_path.write_bytes(data1)
go_to(s, U["u5"])
assert decide(s, "contradict", notes="postgres://user:pw@host/db in my notes", evidence="x") == []
check("9.11 output hygiene: notes carrying a DSN are refused at render time",
      "PostgreSQL DSN" in (refusal(s.render_final, ts) or ""))
assert decide(s, "contradict", notes="different birth decade", evidence="retained_target.dob_years") == []
preview = s.acceptance_preview()
check("9.12 a 'contradict' on an audit row is rendered honestly and previewed as blocking (not auto-agreed)",
      preview["contradict"] == [U["u5"]] and preview["audit_not_agree"] == [U["u5"]]
      and not preview["would_be_accepted"] and s.can_finalize()
      and "refusing to overwrite" in (refusal(s.finalize, ts) or ""))
check("9.13 finalisation touches nothing else: no import/link/database/deploy symbols in the tool source",
      all(token not in SRC for token in ("connect(", "INSERT ", "UPDATE ", "subprocess", "systemctl", "paramiko")))

# ---------------------------------------------------------------------------
section("10. Network and database isolation across a full lifecycle")
real_socket = socket.socket


def raising_socket(*_a, **_k):
    raise AssertionError("socket opened")


socket.socket = raising_socket  # type: ignore[assignment]
try:
    root2 = new_root()
    s2 = open_session(root2, clock=Clock())
    for url in (U["u2"], U["u3"], U["u6"], U["u1"], U["u5"], U["u7"], U["u8"]):
        go_to(s2, url)
        assert decide(s2, "agree") == []
    go_to(s2, U["u4"])
    assert decide(s2, "agree", notes="n", evidence="e") == []
    isolated = s2.finalize("2026-09-18T14:00:00Z")["sha256"] == base.sha256_bytes(s2.render_final("2026-09-18T14:00:00Z"))
except AssertionError as exc:
    isolated = False
    print(f"    socket/assert: {exc}")
finally:
    socket.socket = real_socket  # type: ignore[assignment]
check("10.1 load -> adjudicate -> finalise opens no socket", isolated)

# ---------------------------------------------------------------------------
section("11. GUI construction guarantees (source-level; tkinter never imported here)")
check("11.1 the GUI is only built when Tcl/Tk is present and never at import time",
      "_AppBase = tk.Tk if TK_AVAILABLE else object" in SRC and "class OperatorApp(_AppBase)" in SRC
      and "if not TK_AVAILABLE:\n            raise ToolError" in SRC)
check("11.2 fixed footer with Previous/Next packed before the expanding body; Alt+Left/Right bound globally "
      "and inside the notes/evidence fields; scroll-to-top on every row change",
      SRC.index("self._build_footer()") < SRC.index("self._build_body()")
      and 'side="bottom"' in SRC and 'self.bind_all("<Alt-Left>"' in SRC and 'self.bind_all("<Alt-Right>"' in SRC
      and 'widget.bind("<Alt-Left>"' in SRC and "self._canvas.yview_moveto(0.0)" in SRC)
check("11.3 Previous/Next are disabled only at the ends, from the session's can_go_prev/can_go_next",
      'self.prev_button.configure(state="normal" if s.can_go_prev() else "disabled")' in SRC
      and 'self.next_button.configure(state="normal" if s.can_go_next() else "disabled")' in SRC)
check("11.4 nothing preselected: the verdict variable starts empty and radios carry stored values beneath",
      'self.verdict_var = tk.StringVar(value="")' in SRC and 'stored value: \\"{value}\\"' in SRC
      and ".select()" not in SRC)
check("11.5 unsaved edits prompt Save / Discard / Stay before leaving a row, filtering, finalising or closing",
      "askyesnocancel" in SRC and SRC.count("self._resolve_unsaved()") >= 5)
check("11.6 focus loss on notes/evidence stashes a draft (never a verdict); Ctrl+S commits",
      'bind("<FocusOut>", self._on_text_focus_out)' in SRC and "self.session.stash_draft()" in SRC
      and 'self.bind_all("<Control-s>", self._kb_save)' in SRC)
check("11.7 Open/Copy buttons exist for both links, validated through the allow-list, and touch no state",
      "open_evidence_url(url, hosts)" in SRC and "self.clipboard_append(url)" in SRC
      and "no verdict changed" in SRC)
check("11.8 labels re-wrap on resize (wraplength follows the canvas width); minimum window size set",
      "widget.configure(wraplength=width)" in SRC and 'self.minsize(900, 620)' in SRC)
check("11.9 the Finalise button is enabled only when the session can finalise and the dialog names the next command",
      'self.finalize_button.configure(state="normal" if s.can_finalize() else "disabled")' in SRC
      and "NEXT_COMMAND" in SRC.split("def _finalize")[1])

# ---------------------------------------------------------------------------
section("12. The real Phase F artefacts (read-only; skipped when absent)")
real_rel = tool.default_rel()
if all((ROOT / rel).is_file() for rel in real_rel.values()):
    try:
        real = tool.load_inputs(ROOT)
        real_urls = [q["player_url"] for q in real["queue"]]
        class3 = [q for q in real["queue"] if "3_target_unregistered" in q["classes"]]
        check("12.1 the real queue is exactly 69 unique rows = 39 mandatory + 30 audit, pinned hashes matching",
              len(real["queue"]) == 69 == len(set(real_urls)) and real["mandatory"] == 39 and real["audit"] == 30
              and real["rows_sha256"] == tool.EXPECT["rows_sha256"] and real["total_sample_rows"] == 598)
        check("12.2 the 16 target_not_registered rows are class 3 with identity_evaluable false; zero machine contradictions",
              len(class3) == 16 and all(q["identity_evaluable"] is False and q["deployment_status"] == "target_not_registered"
                                        and q["outcome"] == "target_unregistered" for q in class3)
              and not [q for q in real["queue"] if q["outcome"] == "offline_contradict"]
              and real["recheck"]["classes"]["1_offline_contradict"] == [])
        check("12.3 the 4 offline_limited rows are mandatory; audit rows are all offline_strong and disjoint from the mandatory set",
              sum(1 for q in real["queue"] if q["outcome"] == "offline_limited" and q["is_mandatory"]) == 4
              and all(q["outcome"] == "offline_strong" for q in real["queue"] if q["is_audit"])
              and not [q for q in real["queue"] if q["is_audit"] and q["is_mandatory"]])
        built = [tool.evidence_links_for(q) for q in real["queue"]]
        check("12.4 every real row builds both evidence links from its own captured URL and canonical identity",
              all(b["draftguru_url"] and b["afltables_url"] and b["afltables_url"].startswith(tool.AFLTABLES_BASE_URL + "players/")
                  for b in built))
        check("12.5 the audit salt is the recorded AFLDB-ISSUE-222/audit-v2", real["audit_salt"] == "AFLDB-ISSUE-222/audit-v2")
    except base.ToolError as exc:
        check("12.0 the real artefacts load against the pinned hashes", False, str(exc))
else:
    print("  SKIP  real Phase F artefacts not present in this checkout")

# ---------------------------------------------------------------------------
print()
if failures:
    print(f"{len(failures)} check(s) FAILED: {failures}")
    raise SystemExit(1)
print("All DraftGuru Phase F operator-adjudication checks hold.")
