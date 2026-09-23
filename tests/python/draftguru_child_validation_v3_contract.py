#!/usr/bin/env python3
"""AFLDB-ISSUE-227 -- DB-free contract checks for
tools/rebuild/draftguru/validate_person_bridge_child_v3.py (the ISSUE-224 v2 -> v3
deployment-child validator).

    python tests/python/draftguru_child_validation_v3_contract.py

Every behavioural check runs against the hand-built lineage fixture in
tests/python/draftguru_bridge_v3_lineage_fixture.py, in a temporary directory -- never the
real v2/v3 parent, child, classification, decision, reconciliation or diff artefacts.
Section 6 is the one exception: it runs the validator over the real committed repository
lineage and pins the resulting summary_sha256 as a literal established independently (by a
separate, one-off invocation of the validator against the real lineage, not by importing any
value from the module under test).

No database connection, no network request, no importer, no Git command.
"""

from __future__ import annotations

import contextlib
import io
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TOOL_DIR = ROOT / "tools" / "rebuild" / "draftguru"
sys.path.insert(0, str(TOOL_DIR))
sys.path.insert(0, str(HERE))

import draftguru_bridge_v3_lineage_fixture as fx      # noqa: E402
import validate_person_bridge_child_v3 as tool        # noqa: E402

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


def run_validate(fixture: dict, *, child_sha: str | None = None, pinned: dict | None = None,
                 expect: dict | None = None) -> dict:
    return tool.validate(
        fixture["root"], child_rel=fixture["child_rel"],
        expect_child_sha256=fixture["child_sha256"] if child_sha is None else child_sha,
        pinned=fixture["pinned_child"] if pinned is None else pinned,
        expect=fixture["expect"] if expect is None else expect, emit=quiet)


def mutate_child(fixture: dict, mutate) -> str:
    """Apply ``mutate(doc)`` to the fixture v3 child, rewrite canonically, return the new sha."""
    doc = fx.read_json(fixture["root"], fixture["child_rel"])
    mutate(doc)
    return fx.rewrite_json(fixture["root"], fixture["child_rel"], doc)


def failing(mutate=None, *, raw: bytes | None = None) -> list[str]:
    fixture = fx.new_fixture()
    if raw is not None:
        new_sha = fx.write(fixture["root"], fixture["child_rel"], raw)
    elif mutate is not None:
        new_sha = mutate_child(fixture, mutate)
    else:
        new_sha = fixture["child_sha256"]
    return run_validate(fixture, child_sha=new_sha)["failures"]


def has(names: list[str], number: str) -> bool:
    """True when a check numbered exactly ``number`` (e.g. "5.4", never "5.40") failed."""
    return any(n.startswith(number + " ") for n in names)


URL = fx.URL
OLD = fx.OLD_TARGET
NEW = fx.NEW_TARGET
PID = fx.PLAYER_ID_EVIDENCE

# ---------------------------------------------------------------------------
# 1. Clean fixture
# ---------------------------------------------------------------------------

section("1. A clean fixture lineage validates")

clean = fx.new_fixture()
summary = run_validate(clean)
check("1.1 zero failures on the clean lineage", not summary["failures"], str(summary["failures"]))
check("1.2 the measured counts are the fixture's",
      summary.get("counts") == {
          "population": 12, "parent_bridges": 8, "child_bridges": 7, "child_withheld": 5,
          "carry_forward": 5, "corrected": 2, "removed": 0, "target_not_registered_v2": 3,
          "target_not_registered_v3": 1, "u_no_href": 2, "registration_count": 42},
      repr(summary.get("counts")))
check("1.3 the transition table names exactly the two corrected persons, in URL order",
      [(t["player_url"], t["v3_target"]) for t in summary["transitions"]]
      == [(URL(7), NEW[7]), (URL(8), NEW[8])],
      repr(summary["transitions"]))
check("1.4 every section 1-7 contributed at least one check",
      {c["name"].split(" ", 1)[0].split(".")[0] for c in summary["checks"]}
      == {"1", "2", "3", "4", "5", "6", "7"})
check("1.5 summary_sha256 is 64 lowercase hex",
      len(summary["summary_sha256"]) == 64
      and all(ch in "0123456789abcdef" for ch in summary["summary_sha256"]))
check("1.6 the child sha256 is reported", summary["child_sha256"] == clean["child_sha256"])

# ---------------------------------------------------------------------------
# 2. Fail-closed refusals -- each mutation names its check
# ---------------------------------------------------------------------------

section("2. Fail-closed refusals")

fixture = fx.new_fixture()
wrong = run_validate(fixture, child_sha="0" * 64)["failures"]
check("2.1 a wrong expected sha256 fails 1.1", has(wrong, "1.1"), str(wrong))
no_expectation = tool.validate(fixture["root"], child_rel=fixture["child_rel"],
                               expect_child_sha256=None, pinned=fixture["pinned_child"],
                               expect=fixture["expect"], emit=quiet)["failures"]
check("2.1a a missing expected sha256 fails closed (never PASS by default)",
      has(no_expectation, "1.1"), str(no_expectation))


def _kind(doc):
    doc["kind"] = "source-evidence"


check("2.2 kind != deployment fails 2.2", has(failing(_kind), "2.2"))


def _target(doc):
    doc["target"] = "dev"


check("2.3 target != afldb_test fails 2.3", has(failing(_target), "2.3"))


def _parent_sha(doc):
    doc["parent_sha256"] = "f" * 64


check("2.4 a tampered parent_sha256 fails 2.5", has(failing(_parent_sha), "2.5"))


def _not_in_parent(doc):
    for row in doc["bridges"]:
        if row["player_url"] == URL(1):
            row["afltables_external_id"] = "players/F/Fix_P01_NOT_IN_PARENT.html"


check("2.5 an accepted mapping absent from the v3 parent fails 4.1",
      has(failing(_not_in_parent), "4.1"))


def _dup_identity(doc):
    doc["bridges"].append({"afltables_external_id": OLD[2], "player_url": URL(13)})


check("2.6 a duplicate AFL Tables identity fails the schema gate 3.1",
      has(failing(_dup_identity), "3.1"))


def _dup_person(doc):
    doc["bridges"].append({"afltables_external_id": "players/F/Fix_P099.html",
                           "player_url": URL(1)})


check("2.7 a duplicate DraftGuru person fails the schema gate 3.1",
      has(failing(_dup_person), "3.1"))


def _outside(doc):
    doc["withheld"].append({"player_url": URL(13), "reason": "U-no-href"})


check("2.8 a withheld person outside the v3 parent population fails 4.4",
      has(failing(_outside), "4.4"))


def _counts(doc):
    doc["counts"]["bridges"] += 1


check("2.9 a counts drift fails 3.3", has(failing(_counts), "3.3"))


def _somerville_reenters(doc):
    doc["bridges"].append({"afltables_external_id": "players/F/Fix_P11_readmitted.html",
                           "player_url": URL(11)})
    doc["withheld"] = [w for w in doc["withheld"] if w["player_url"] != URL(11)]
    doc["counts"]["bridges"] += 1
    doc["counts"]["withheld"] -= 1


somerville_failures = failing(_somerville_reenters)
check("2.10 a wrong-href-rejected person (fixture Craig-Somerville analogue) re-entering as "
      "accepted fails 4.1 (absent from the v3 parent's bridges) and 5.11",
      has(somerville_failures, "4.1") and has(somerville_failures, "5.11"),
      str(somerville_failures))


def _missing_transition(doc):
    doc["bridges"] = [r for r in doc["bridges"] if r["player_url"] != URL(7)]
    doc["withheld"].append({"player_url": URL(7), "reason": "target_not_registered"})
    doc["withheld"].sort(key=lambda r: r["player_url"])
    doc["counts"] = {"parent_bridges": 8, "bridges": 6, "withheld": 6}


missing_failures = failing(_missing_transition)
check("2.11 one of the two parent-evidence transitions missing fails 5.4 and 5.9",
      has(missing_failures, "5.4") and has(missing_failures, "5.9"), str(missing_failures))


def _unexpected_third(doc):
    doc["bridges"].append({"player_url": URL(6), "afltables_external_id": OLD[6]})
    doc["bridges"].sort(key=lambda r: r["player_url"].encode("utf-8"))
    doc["withheld"] = [w for w in doc["withheld"] if w["player_url"] != URL(6)]
    doc["counts"] = {"parent_bridges": 8, "bridges": 8, "withheld": 4}


unexpected_failures = failing(_unexpected_third)
check("2.12 an unexpected third newly-accepted person (also: one of the deferred-rollover "
      "rows unexpectedly accepted) fails 5.4 and 5.9",
      has(unexpected_failures, "5.4") and has(unexpected_failures, "5.9"),
      str(unexpected_failures))


def _reverted_identity(doc):
    for row in doc["bridges"]:
        if row["player_url"] == URL(7):
            row["afltables_external_id"] = OLD[7]
    doc["bridges"].sort(key=lambda r: r["player_url"].encode("utf-8"))


reverted_failures = failing(_reverted_identity)
check("2.13 a corrected identity changed back to its captured/wrong path fails 4.1 and 5.8",
      has(reverted_failures, "4.1") and has(reverted_failures, "5.8"), str(reverted_failures))


def _dsn(doc):
    doc["$comment"] = "resolved against postgresql://afldb_owner:pw@localhost/afldb_test"


check("2.14 a DSN in the child fails 7.1", has(failing(_dsn), "7.1"))

crlf_fixture = fx.new_fixture()
crlf = (crlf_fixture["root"] / crlf_fixture["child_rel"]).read_bytes().replace(b"\n", b"\r\n")
crlf_sha = fx.write(crlf_fixture["root"], crlf_fixture["child_rel"], crlf)
crlf_failures = run_validate(crlf_fixture, child_sha=crlf_sha)["failures"]
check("2.15 CRLF bytes fail 7.2 and the canonical-bytes check 7.3",
      has(crlf_failures, "7.2") and has(crlf_failures, "7.3"), str(crlf_failures))

missing = fx.new_fixture()
(missing["root"] / missing["rel"]["issue224_classification"]).unlink()
missing_input_failures = run_validate(missing)["failures"]
check("2.16 a missing pinned input (the classification artefact) fails 1.2 without raising",
      missing_input_failures == ["1.2 every pinned lineage input exists and hash-matches"],
      str(missing_input_failures))


recon_fixture = fx.new_fixture()
recon_doc = fx.read_json(recon_fixture["root"], recon_fixture["rel"]["reconciliation_v3"])
recon_doc["diff_report"]["sha256"] = "e" * 64
new_recon_sha = fx.rewrite_json(recon_fixture["root"], recon_fixture["rel"]["reconciliation_v3"], recon_doc)
repinned = dict(recon_fixture["pinned_child"])
repinned["reconciliation_v3"] = (recon_fixture["rel"]["reconciliation_v3"], new_recon_sha)
recon_failures = run_validate(recon_fixture, pinned=repinned)["failures"]
check("2.17 a reconciliation manifest whose diff_report.sha256 drifts from the real diff CSV "
      "fails 5.13", has(recon_failures, "5.13"), str(recon_failures))


def _provenance(doc):
    doc["provenance"] = dict(doc["provenance"])
    doc["provenance"]["label"] = "person-html-other"


check("2.18 a provenance that is not the v3 parent's verbatim fails 2.8", has(failing(_provenance), "2.8"))


def _unsorted(doc):
    doc["bridges"][0], doc["bridges"][1] = doc["bridges"][1], doc["bridges"][0]


check("2.19 an unsorted bridges[] fails 3.6", has(failing(_unsorted), "3.6"))


def _extra_key(doc):
    doc["verdicts"] = []


check("2.20 an extra top-level key fails 1.4", has(failing(_extra_key), "1.4"))

check("2.21 a child that is not a JSON object fails 1.3 without raising",
      has(failing(raw=b"[]\n"), "1.3"))


def _registration(doc):
    doc["target_registration"]["count"] = 41


check("2.22 a registration count drift fails 6.1", has(failing(_registration), "6.1"))


def _measured(doc):
    doc["target_registration"]["measured_at"] = "2026-09-19 08:36:12"


check("2.23 a malformed measured_at fails 6.2", has(failing(_measured), "6.2"))

parent_fixture = fx.new_fixture()
parent_doc = fx.read_json(parent_fixture["root"], parent_fixture["rel"]["parent_v3"])
parent_doc["withheld"].append({"player_url": URL(13), "reason": "U-no-href"})
new_parent_sha = fx.rewrite_json(parent_fixture["root"], parent_fixture["rel"]["parent_v3"], parent_doc)
repinned_parent = dict(parent_fixture["pinned_child"])
repinned_parent["parent_v3"] = (parent_fixture["rel"]["parent_v3"], new_parent_sha)


def _child_parent_sha(doc):
    doc["parent_sha256"] = new_parent_sha


parent_child_sha = mutate_child(parent_fixture, _child_parent_sha)
parent_mismatch_failures = run_validate(
    parent_fixture, child_sha=parent_child_sha, pinned=repinned_parent)["failures"]
check("2.24 a v3 parent whose withheld[] no longer matches the v2 parent's fails 4.6",
      has(parent_mismatch_failures, "4.6"), str(parent_mismatch_failures))


class_fixture = fx.new_fixture()
class_doc = fx.read_json(class_fixture["root"], class_fixture["rel"]["issue224_classification"])
class_doc["rows"].append(dict(class_doc["rows"][0]))
new_class_sha = fx.rewrite_json(class_fixture["root"], class_fixture["rel"]["issue224_classification"], class_doc)
repinned_class = dict(class_fixture["pinned_child"])
repinned_class["issue224_classification"] = (class_fixture["rel"]["issue224_classification"], new_class_sha)
class_dup_failures = run_validate(class_fixture, pinned=repinned_class)["failures"]
check("2.25 a duplicate player_url in the classification artefact fails 5.6",
      has(class_dup_failures, "5.6"), str(class_dup_failures))

dec_fixture = fx.new_fixture()
dec_doc = fx.read_json(dec_fixture["root"], dec_fixture["rel"]["issue224_operator_decisions"])
dec_doc["rows"].append(dict(dec_doc["rows"][0]))
new_dec_sha = fx.rewrite_json(dec_fixture["root"], dec_fixture["rel"]["issue224_operator_decisions"], dec_doc)
repinned_dec = dict(dec_fixture["pinned_child"])
repinned_dec["issue224_operator_decisions"] = (dec_fixture["rel"]["issue224_operator_decisions"], new_dec_sha)
dec_dup_failures = run_validate(dec_fixture, pinned=repinned_dec)["failures"]
check("2.26 a duplicate player_url in the operator-decision artefact fails 5.7",
      has(dec_dup_failures, "5.7"), str(dec_dup_failures))

# The whole-file sha256 and rows_sha256 are complementary invariants: a stale/wrong
# source_adjudication_pack.sha256 must fail 5.7 even though every row, rows_sha256 and
# source_hash_links entry is left completely untouched and still correct -- rows_sha256
# agreement alone must never be accepted as a substitute for the whole-file hash-link.
stale_pack_fixture = fx.new_fixture()
stale_dec_doc = fx.read_json(stale_pack_fixture["root"],
                             stale_pack_fixture["rel"]["issue224_operator_decisions"])
stale_dec_doc["source_adjudication_pack"] = dict(stale_dec_doc["source_adjudication_pack"])
stale_dec_doc["source_adjudication_pack"]["sha256"] = "d" * 64
new_stale_dec_sha = fx.rewrite_json(
    stale_pack_fixture["root"], stale_pack_fixture["rel"]["issue224_operator_decisions"],
    stale_dec_doc)
repinned_stale = dict(stale_pack_fixture["pinned_child"])
repinned_stale["issue224_operator_decisions"] = (
    stale_pack_fixture["rel"]["issue224_operator_decisions"], new_stale_dec_sha)
stale_pack_result = run_validate(stale_pack_fixture, pinned=repinned_stale)
check("2.27 a stale/wrong source_adjudication_pack.sha256 fails 5.7 even though rows_sha256 "
      "and every semantic row are untouched and still correct (whole-file sha256 and "
      "rows_sha256 are complementary invariants, never alternatives)",
      has(stale_pack_result["failures"], "5.7")
      and not has(stale_pack_result["failures"], "5.6"),
      str(stale_pack_result["failures"]))

# ---------------------------------------------------------------------------
# 3. Read-only and repeatable
# ---------------------------------------------------------------------------

section("3. Read-only and repeatable")

repeat = fx.new_fixture()
before = fx.snapshot(repeat["root"])
first = run_validate(repeat)
second = run_validate(repeat)
after = fx.snapshot(repeat["root"])
check("3.1 two runs over identical inputs produce an identical summary_sha256",
      first["summary_sha256"] == second["summary_sha256"],
      f"{first['summary_sha256']} != {second['summary_sha256']}")
check("3.1a the repeated runs are the clean lineage (the digest compared is a PASS digest)",
      not first["failures"] and not second["failures"], str(first["failures"]))
check("3.1b the same lineage in a different temporary root yields the same summary_sha256 "
      "(no absolute path enters the digest)",
      clean["root"] != repeat["root"] and summary["summary_sha256"] == first["summary_sha256"],
      f"{summary['summary_sha256']} != {first['summary_sha256']}")
unstable = fx.new_fixture()
unstable_sha = mutate_child(unstable, _missing_transition)
fail_first = run_validate(unstable, child_sha=unstable_sha)
fail_second = run_validate(unstable, child_sha=unstable_sha)
check("3.1c a FAILING run is equally repeatable (failure details carry no clock, temp path or "
      "unordered input either)",
      fail_first["failures"] and fail_first["summary_sha256"] == fail_second["summary_sha256"],
      f"{fail_first['summary_sha256']} != {fail_second['summary_sha256']}")
check("3.2 validation writes nothing (fixture tree byte-identical before and after)",
      before == after)
check("3.3 the CLI refuses a missing child with exit status 1",
      tool.main(["--root", str(repeat["root"]), "--child", "data/reference/does-not-exist.json",
                 "--expect-sha256", "0" * 64]) == 1)
check("3.4 the CLI exits 1 when the default lineage is validated at a root that lacks it",
      tool.main(["--root", str(repeat["root"])]) == 1)

# ---------------------------------------------------------------------------
# 4. No database / network / import code path
# ---------------------------------------------------------------------------

section("4. No database / network / import code path")

SRC = (TOOL_DIR / "validate_person_bridge_child_v3.py").read_text(encoding="utf-8")
offenders = sorted(fx.imported_modules(SRC) & fx.FORBIDDEN_MODULES)
check("4.1 the validator imports no database, network, subprocess, GUI, importer or exporter "
      "module", not offenders, str(offenders))
env = fx.env_accesses(SRC)
check("4.2 the validator reads no environment variable", not env, "; ".join(env))
check("4.3 the validator exposes no write path",
      "atomic_write_bytes(" not in SRC and "write_bytes(" not in SRC and "open(" not in SRC
      and "write_text(" not in SRC)
check("4.4 the validator is a wholly separate module from the frozen v1 -> v2 validator "
      "(no import of it, and its own TOOL_VERSION/pinned lineage are its own)",
      "import validate_person_bridge_child" not in SRC and "TOOL_VERSION = \"1.0.0\"" in SRC)

# ---------------------------------------------------------------------------
# 5. Pinned v3 lineage constants
# ---------------------------------------------------------------------------

section("5. Pinned v3 lineage constants")

check("5.1 the default child is the v3 afldb_test deployment child",
      tool.CHILD_REL == "data/reference/draftguru-person-bridge-20260918-v3.afldb_test.json")
check("5.2 the expected child sha256 is the independently-computed value",
      tool.EXPECTED_CHILD_SHA256
      == "94aeac74422bea17dbb14913d480055991db4ac79546a2860383e669b5bbdac4")
check("5.3 the pinned v2 parent, v2 child, classification, decisions, v3 parent, "
      "reconciliation and diff hashes are the independently-computed ones",
      tool.PINNED_INPUTS["parent_v2"][1].startswith("ad25d965cba72b97")
      and tool.PINNED_INPUTS["child_v2_afldb_test"][1].startswith("b996c60e9d4de3ae")
      and tool.PINNED_INPUTS["issue224_classification"][1].startswith("0765392a26624c54")
      and tool.PINNED_INPUTS["issue224_operator_decisions"][1].startswith("3c7b5aff6649047e")
      and tool.PINNED_INPUTS["parent_v3"][1].startswith("1f7413a2ad96e7d0")
      and tool.PINNED_INPUTS["reconciliation_v3"][1].startswith("f25a4b5035e25649")
      and tool.PINNED_INPUTS["diff_v3"][1].startswith("a311ba6ecfd884d2"))
check("5.4 the expected v3 transition is 3,470 accepted / 1,587 withheld over 5,057, "
      "3,468 carry-forward, 2 corrected, 0 removed, 92 remaining target_not_registered, "
      "13,275 registered",
      tool.EXPECT["population"] == 5057 and tool.EXPECT["parent_bridges"] == 3562
      and tool.EXPECT["child_bridges"] == 3470 and tool.EXPECT["child_withheld"] == 1587
      and tool.EXPECT["carry_forward"] == 3468 and len(tool.CORRECTED) == 2
      and tool.EXPECT["v2_target_not_registered"] == 94
      and tool.EXPECT["remaining_target_not_registered"] == 92
      and tool.EXPECT["u_no_href"] == 1493 and tool.EXPECT["registration_count"] == 13275
      and 3468 + 2 == 3470 and 1493 + 92 + 2 == 1587 and 3470 + 1587 == 5057)
check("5.5 the two corrections are Dean Laidley and Matthew Capuano with their AFL Tables "
      "identities and evidence IDs",
      tool.CORRECTED == {
          "https://www.draftguru.com.au/players/dean_laidley/1":
              ("players/D/Dean_Laidley.html", "players/D/Dani_Laidley.html", 3208),
          "https://www.draftguru.com.au/players/matthew_capuano/1":
              ("players/M/Matthew_Capuano.html", "players/M/Mathew_Capuano.html", 9198)})
check("5.6 the two preserved wrong-href removals are Craig Somerville and David Sullivan",
      tool.REJECTED == {
          "https://www.draftguru.com.au/players/craig_somerville/1":
              "players/C/Craig_Somerville.html",
          "https://www.draftguru.com.au/players/david_sullivan/1":
              "players/D/David_Sullivan.html"})
check("5.7 the validator declares no output path at all", not hasattr(tool, "OUTPUTS"))

# ---------------------------------------------------------------------------
# 6. Real repository lineage (the only section that opens real committed artefacts)
# ---------------------------------------------------------------------------

section("6. Real repository lineage")


def cli(argv: list[str]) -> tuple[int, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        status = tool.main(argv)
    return status, err.getvalue()


real_summary = tool.validate(ROOT, emit=quiet)
# Established independently: a one-off invocation of
# `python tools/rebuild/draftguru/validate_person_bridge_child_v3.py` against this exact
# committed lineage, read separately from this test, before this literal was written here.
check("6.1 the real committed v2 -> v3 lineage validates with zero failures",
      not real_summary["failures"], str(real_summary["failures"]))
check("6.2 the real lineage's summary_sha256 is the independently-established digest",
      real_summary["summary_sha256"]
      == "f58503bb276c0610ca15ae5d916b5349e13650ea4e7e4dec35715ea931a847a7",
      real_summary["summary_sha256"])
real_status, _ = cli([])
check("6.3 the CLI exits 0 on the real committed lineage", real_status == 0)

# ---------------------------------------------------------------------------

print()
if failures:
    print(f"{len(failures)} check(s) FAILED: {failures}")
    raise SystemExit(1)
print("All ISSUE-224 v3 child-validation contract checks hold.")
