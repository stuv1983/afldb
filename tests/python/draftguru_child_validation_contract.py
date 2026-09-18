#!/usr/bin/env python3
"""AFLDB-ISSUE-222 -- DB-free contract checks for
tools/rebuild/draftguru/validate_person_bridge_child.py (deployment-child validation).

    python tests/python/draftguru_child_validation_contract.py

Every behavioural check runs against the hand-built lineage fixture in
tests/python/draftguru_lineage_fixture.py, in a temporary directory -- never the real v1/v2
parent, child, reconciliation or verdict artefacts, none of which this file opens. The
real-lineage checks assert the validator's pinned module constants only.

No database connection, no network request, no importer, no Git command.
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TOOL_DIR = ROOT / "tools" / "rebuild" / "draftguru"
sys.path.insert(0, str(TOOL_DIR))
sys.path.insert(0, str(HERE))

import draftguru_lineage_fixture as fx                # noqa: E402
import validate_person_bridge_child as tool           # noqa: E402

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


def run_validate(fixture: dict, *, child_sha: str | None = None, pinned: dict | None = None) -> dict:
    return tool.validate(
        fixture["root"], child_rel=fixture["child_rel"],
        expect_child_sha256=fixture["child_sha256"] if child_sha is None else child_sha,
        pinned=fixture["pinned_child"] if pinned is None else pinned,
        expect=fixture["expect"], emit=quiet)


def mutate_child(fixture: dict, mutate) -> str:
    """Apply ``mutate(doc)`` to the fixture child, rewrite canonically, return the new sha."""
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
    """True when a check numbered exactly ``number`` (e.g. "5.2", never "5.20") failed."""
    return any(n.startswith(number + " ") for n in names)


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
          "carry_forward": 6, "corrected": 1, "removed": 1, "target_not_registered_v1": 2,
          "target_not_registered_v2": 1, "u_no_href": 3, "registration_count": 99},
      repr(summary.get("counts")))
check("1.3 the transition table names exactly the corrected and the removed person, in URL order",
      [(t["player_url"], t["action"]) for t in summary["transitions"]]
      == [(fx.URL(4), "corrected"), (fx.URL(5), "removed_withheld")],
      repr(summary["transitions"]))
check("1.4 the corrected transition records the structured field, never notes",
      summary["transitions"][0]["structured_field"] == "corrected_identity_candidate"
      and summary["transitions"][0]["v2_target"] == fx.CORRECTED_P04)
check("1.5 every section 1-7 contributed at least one check",
      {c["name"].split(" ", 1)[0].split(".")[0] for c in summary["checks"]}
      == {"1", "2", "3", "4", "5", "6", "7"})
check("1.6 summary_sha256 is 64 lowercase hex",
      len(summary["summary_sha256"]) == 64
      and all(ch in "0123456789abcdef" for ch in summary["summary_sha256"]))
check("1.7 the child sha256 is reported", summary["child_sha256"] == clean["child_sha256"])

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
    doc["target"] = "afldb_dev"


check("2.3 target != afldb_test fails 2.3", has(failing(_target), "2.3"))


def _parent_sha(doc):
    doc["parent_sha256"] = "f" * 64


check("2.4 a tampered parent_sha256 fails 2.5", has(failing(_parent_sha), "2.5"))


def _not_in_parent(doc):
    for row in doc["bridges"]:
        if row["player_url"] == fx.URL(3):
            row["afltables_external_id"] = "players/F/Fix_P033.html"


check("2.5 an accepted mapping absent from the parent fails 4.1",
      has(failing(_not_in_parent), "4.1"))


def _dup_identity(doc):
    doc["bridges"].append({"afltables_external_id": fx.V1_TARGET[1],
                           "player_url": fx.URL(13)})


check("2.6 a duplicate AFL Tables identity fails the schema gate 3.1",
      has(failing(_dup_identity), "3.1"))


def _dup_person(doc):
    doc["bridges"].append({"afltables_external_id": "players/F/Fix_P099.html",
                           "player_url": fx.URL(1)})


check("2.7 a duplicate DraftGuru person fails the schema gate 3.1",
      has(failing(_dup_person), "3.1"))


def _outside(doc):
    doc["withheld"].append({"player_url": fx.URL(13), "reason": "U-no-href"})


check("2.8 a withheld person outside the parent population fails 4.4",
      has(failing(_outside), "4.4"))


def _counts(doc):
    doc["counts"]["bridges"] += 1


check("2.9 a counts drift fails 3.3", has(failing(_counts), "3.3"))


def _rejected_present(doc):
    for row in doc["bridges"]:
        if row["player_url"] == fx.URL(8):
            row["afltables_external_id"] = fx.REJECTED_P05


check("2.10 a rejected target among accepted identities fails 4.5",
      has(failing(_rejected_present), "4.5"))


def _flip(doc):
    doc["bridges"] = [r for r in doc["bridges"] if r["player_url"] != fx.URL(7)]
    doc["withheld"].append({"player_url": fx.URL(7), "reason": "target_not_registered"})
    doc["withheld"].sort(key=lambda r: r["player_url"])
    doc["counts"] = {"parent_bridges": 8, "bridges": 6, "withheld": 6}


flipped = failing(_flip)
check("2.11 an unrelated person changing state fails 5.11 (and the carry-forward count 5.2)",
      has(flipped, "5.11") and has(flipped, "5.2"), str(flipped))


def _registration(doc):
    doc["target_registration"]["count"] = 98


check("2.12 a registration count drift fails 6.1", has(failing(_registration), "6.1"))


def _measured(doc):
    doc["target_registration"]["measured_at"] = "2026-09-18 09:59:26"


check("2.13 a malformed measured_at fails 6.2", has(failing(_measured), "6.2"))


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
(missing["root"] / missing["rel"]["reconciliation_v2"]).unlink()
missing_failures = run_validate(missing)["failures"]
check("2.16 a missing pinned input fails 1.2 without raising",
      missing_failures == ["1.2 every pinned lineage input exists and hash-matches"],
      str(missing_failures))

notes = fx.new_fixture()
verdicts = fx.read_json(notes["root"], notes["rel"]["operator_verdicts_json"])
for row in verdicts["rows"]:
    if row["draftguru_url"] == fx.URL(4):
        row["evidence"]["corrected_identity_candidate"] = "players/F/Fix_P041.html"
        row["operator_notes"] = fx.CORRECTED_P04
new_verdicts_sha = fx.rewrite_json(notes["root"], notes["rel"]["operator_verdicts_json"], verdicts)
repinned = dict(notes["pinned_child"])
repinned["operator_verdicts_json"] = (notes["rel"]["operator_verdicts_json"], new_verdicts_sha)
notes_failures = run_validate(notes, pinned=repinned)["failures"]
check("2.17 a corrected target that matches operator_notes but not the structured "
      "corrected_identity_candidate fails 5.7",
      has(notes_failures, "5.7"), str(notes_failures))


def _provenance(doc):
    doc["provenance"]["label"] = "person-html-other"


check("2.18 a provenance that is not the parent's verbatim fails 2.7",
      has(failing(_provenance), "2.7"))


def _unsorted(doc):
    doc["bridges"][0], doc["bridges"][1] = doc["bridges"][1], doc["bridges"][0]


check("2.19 an unsorted bridges[] fails 3.6", has(failing(_unsorted), "3.6"))


def _extra_key(doc):
    doc["verdicts"] = []


check("2.20 an extra top-level key fails 1.4", has(failing(_extra_key), "1.4"))

check("2.21 a child that is not a JSON object fails 1.3 without raising",
      has(failing(raw=b"[]\n"), "1.3"))

# ---------------------------------------------------------------------------
# 3. Read-only and repeatable
# ---------------------------------------------------------------------------

section("3. Read-only and repeatable")

repeat = fx.new_fixture()
before = fx.snapshot(repeat["root"])
first = run_validate(repeat)
second = run_validate(repeat)
after = fx.snapshot(repeat["root"])
# Repeatability is asserted on its own: a lineage defect is 1.1's finding, never this one's.
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
unstable_sha = mutate_child(unstable, _flip)
fail_first = run_validate(unstable, child_sha=unstable_sha)
fail_second = run_validate(unstable, child_sha=unstable_sha)
check("3.1c a FAILING run is equally repeatable (failure details carry no clock, temp path "
      "or unordered input either)",
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

SRC = (TOOL_DIR / "validate_person_bridge_child.py").read_text(encoding="utf-8")
offenders = sorted(fx.imported_modules(SRC) & fx.FORBIDDEN_MODULES)
check("4.1 the validator imports no database, network, subprocess, GUI, importer or exporter "
      "module", not offenders, str(offenders))
env = fx.env_accesses(SRC)
check("4.2 the validator reads no environment variable", not env, "; ".join(env))
check("4.3 the validator exposes no write path",
      "atomic_write_bytes(" not in SRC and "write_bytes(" not in SRC and "open(" not in SRC
      and "write_text(" not in SRC)

# ---------------------------------------------------------------------------
# 5. Pinned real lineage (constants only -- the real artefacts are never opened here)
# ---------------------------------------------------------------------------

section("5. Pinned real lineage constants")

check("5.1 the default child is the v2 afldb_test deployment child",
      tool.CHILD_REL == "data/reference/draftguru-person-bridge-20260918-v2.afldb_test.json")
check("5.2 the expected child sha256 is the operator-reported value",
      tool.EXPECTED_CHILD_SHA256
      == "b996c60e9d4de3aeb6f250f360b2a66164a2211b9604338a65918e79fa29e1c5")
check("5.3 the pinned v2 parent, v1 parent, v1 child and verdict hashes are the recorded ones",
      tool.PINNED_INPUTS["parent_v2"][1].startswith("ad25d965cba72b97")
      and tool.PINNED_INPUTS["parent_v1"][1].startswith("92ff142ef71d1750")
      and tool.PINNED_INPUTS["child_v1_afldb_test"][1].startswith("596bbb684424b40f")
      and tool.PINNED_INPUTS["operator_verdicts_json"][1].startswith("b2ae2f4022cd3c22")
      and tool.PINNED_INPUTS["b3_manifest"][1].startswith("5e944d0e57985593"))
check("5.4 the expected transition is 3,468 accepted / 1,589 withheld over 5,057, "
      "3,461 carry-forward, 7 corrected, 2 removed, 94 remaining target_not_registered, "
      "13,275 registered",
      tool.EXPECT["population"] == 5057 and tool.EXPECT["parent_bridges"] == 3562
      and tool.EXPECT["child_bridges"] == 3468 and tool.EXPECT["child_withheld"] == 1589
      and tool.EXPECT["carry_forward"] == 3461 and len(tool.CORRECTED) == 7
      and len(tool.REMOVED) == 2 and tool.EXPECT["remaining_target_not_registered"] == 94
      and tool.EXPECT["v1_target_not_registered"] == 101 and tool.EXPECT["u_no_href"] == 1493
      and tool.EXPECT["registration_count"] == 13275
      and 3461 + 7 == 3468 and 1493 + 2 + 94 == 1589 and 3468 + 1589 == 5057)
check("5.5 the seven corrected targets are the structured operator corrections",
      {v[1] for v in tool.CORRECTED.values()} == {
          "players/A/Aaron_Black0.html", "players/A/Alwyn_Davey0.html",
          "players/J/Joel_Smith0.html", "players/J/Josh_Smith0.html",
          "players/S/Sam_Butler0.html", "players/S/Stephen_Schwerdt.html",
          "players/T/Tom_Murphy0.html"}
      and all(v[0] != v[1] for v in tool.CORRECTED.values()))
check("5.6 the two removals are Craig Somerville and David Sullivan with their rejected hrefs",
      tool.REMOVED == {
          "https://www.draftguru.com.au/players/craig_somerville/1":
              "players/C/Craig_Somerville.html",
          "https://www.draftguru.com.au/players/david_sullivan/1":
              "players/D/David_Sullivan.html"})
check("5.7 the validator declares no output path at all",
      not hasattr(tool, "OUTPUTS"))

# ---------------------------------------------------------------------------

print()
if failures:
    print(f"{len(failures)} check(s) FAILED: {failures}")
    raise SystemExit(1)
print("All DraftGuru child-validation checks hold.")
