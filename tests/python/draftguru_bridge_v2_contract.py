#!/usr/bin/env python3
"""AFLDB-ISSUE-222 -- DB-free contract checks for
tools/rebuild/draftguru/build_person_bridge_v2.py (the bridge-v2 source-evidence
parent generator).

    python tests/python/draftguru_bridge_v2_contract.py

Every behavioural check runs against a small hand-built fixture repository in a
temporary directory -- never the real v1 parent, the real v1 child, the real 83-row
adjudication pack or the real completed operator verdict artefacts, none of which this
file opens. The handful of checks that concern the REAL adjudication (83 decisions, 81
eligible, 2 withheld, the two named wrong-href persons, the seven structured corrected
targets) assert the generator's pinned module constants, which is the DB-free way to
pin them.

No database connection, no network request, no importer, no Git command, no GUI.
"""

from __future__ import annotations

import copy
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOL_DIR = ROOT / "tools" / "rebuild" / "draftguru"
sys.path.insert(0, str(TOOL_DIR))

import build_person_bridge_v2 as tool  # noqa: E402
import review_person_bridge_offline as base  # noqa: E402

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' -- ' + detail) if detail else ''}")
        failures.append(name)


def section(title: str) -> None:
    print(f"\n{title}")


# ---------------------------------------------------------------------------
# Fixture construction
# ---------------------------------------------------------------------------

URL = "https://www.draftguru.com.au/players/fix_p{:02d}/1".format
CONTRACT_REGEX = r"^https://www\.draftguru\.com\.au/players/[^/]+/[1-9][0-9]*$"

# 12-person fixture population.
#   p01 relisting   same_person_valid_relisting   -> confirmed
#   p02 tokenisation same_person_valid_href       -> confirmed
#   p03 audit        agree                        -> confirmed
#   p04 discrepancy  approve_manual_curation      -> corrected
#   p05 relisting    different_person_wrong_href  -> withheld
#   p06 relisting    same_person_valid_relisting  -> confirmed (2 events, same club)
#   p07..p09 untouched bridges
#   p10..p12 untouched v1 withheld (U-no-href)
V1_TARGET = {
    1: "players/F/Fix_P01.html",
    2: "players/F/Fix_P02.html",
    3: "players/F/Fix_P03.html",
    4: "players/F/Fix_P04.html",
    5: "players/F/Fix_P05.html",
    6: "players/F/Fix_P06.html",
    7: "players/F/Fix_P07.html",
    8: "players/F/Fix_P08.html",
    9: "players/F/Fix_P09.html",
}
CORRECTED_P04 = "players/F/Fix_P040.html"
FROZEN_UTC = "2026-09-18T08:43:12Z"


def make_parent_v1() -> dict:
    return {
        "$comment": "fixture source-evidence parent",
        "bridges": [{"afltables_external_id": V1_TARGET[i], "player_url": URL(i)}
                    for i in range(1, 10)],
        "counts": {"bridges": 9, "collisions_acknowledged": 0, "requested": 12, "withheld": 3},
        "exporter": "tools/rebuild/draftguru/export_person_bridge.py",
        "exporter_version": "1.0.0",
        "generated_utc": "2026-09-18T00:56:17Z",
        "kind": "source-evidence",
        "provenance": {"exporter_version": "1.0.0", "label": "person-html-fixture"},
        "schema_version": 1,
        "withheld": [{"player_url": URL(i), "reason": "U-no-href"} for i in range(10, 13)],
    }


def make_child_v1() -> dict:
    """Fixture deployment child: p09 is target_not_registered, the rest bridged."""
    return {
        "$comment": "fixture deployment child",
        "bridges": [{"afltables_external_id": V1_TARGET[i], "player_url": URL(i)}
                    for i in range(1, 9)],
        "counts": {"bridges": 8, "parent_bridges": 9, "withheld": 4},
        "exporter": "tools/rebuild/draftguru/export_person_bridge.py",
        "exporter_version": "1.0.0",
        "generated_utc": "2026-09-18T00:56:58Z",
        "kind": "deployment",
        "parent_sha256": "0" * 64,
        "provenance": {"exporter_version": "1.0.0", "label": "person-html-fixture"},
        "schema_version": 1,
        "target": "afldb_test",
        "target_registration": {"count": 99, "measured_at": "2026-09-18T00:56:58Z"},
        "withheld": ([{"player_url": URL(9), "reason": "target_not_registered"}]
                     + [{"player_url": URL(i), "reason": "U-no-href"} for i in range(10, 13)]),
    }


def verdict_row(order: int, person: int, group: str, verdict: str, *,
                captured_field: str = "captured_afltables_href",
                corrected: str | None = None, notes: str = "",
                event_club: str | None = None,
                derived: str = "not_applicable") -> dict:
    evidence = {
        captured_field: V1_TARGET[person],
        "draftguru_name": f"Fix P{person:02d}",
        "draftguru_url": URL(person),
        "operator_notes": "",
        "operator_verdict": "",
        "retained_birth_year": 1970 + person,
        "retained_career_end": 1995,
        "retained_career_games": 10 + person,
        "retained_career_start": 1990,
        "retained_clubs": ["Fitzroy"],
        "retained_target_name": f"Fix P{person:02d}",
    }
    if corrected is not None:
        evidence["corrected_identity_candidate"] = corrected
    return {
        "decided_utc": "2026-09-18T06:00:00Z",
        "draftguru_url": URL(person),
        "event_club": event_club,
        "event_club_appearance_relationship_derived": derived,
        "event_club_appearance_relationship_message": None,
        "event_club_observation": derived if derived != "not_applicable" else None,
        "event_club_observation_decided_utc": None,
        "event_club_observation_notes": None,
        "evidence": evidence,
        "global_order": order,
        "group": group,
        "group_label": group,
        "machine_classification": "fixture",
        "operator_notes": notes,
        "operator_verdict": verdict,
        "pack_ordinal": order,
        "retained_played_clubs": ["Fitzroy"],
        "row_ordinal_in_group": order,
    }


def make_verdicts() -> dict:
    rows = [
        # p01's notes deliberately contain a DIFFERENT, perfectly well-formed AFL Tables
        # path. It must never become the target: notes are provenance, not instructions.
        verdict_row(1, 1, "relisting", "same_person_valid_relisting",
                    notes="see players/Z/Never_Use_This.html and "
                          "https://en.wikipedia.org/wiki/Fix_P01",
                    event_club="Fitzroy", derived="no_senior_appearance_ever"),
        verdict_row(2, 2, "tokenisation", "same_person_valid_href"),
        verdict_row(3, 3, "audit", "agree", captured_field="captured_href"),
        verdict_row(4, 4, "discrepancy", "approve_manual_curation",
                    captured_field="captured_href", corrected=CORRECTED_P04),
        verdict_row(5, 5, "relisting", "different_person_wrong_href",
                    notes="different player", event_club="Fitzroy",
                    derived="no_senior_appearance_ever"),
        verdict_row(6, 6, "relisting", "same_person_valid_relisting",
                    event_club="Fitzroy", derived="pre_event_only"),
    ]
    return {
        "completion_status": "complete",
        "issue": "AFLDB-ISSUE-222",
        "label": "fixture",
        "operator_display_name": "fixture",
        "review_completed_utc": FROZEN_UTC,
        "review_started_utc": "2026-09-18T05:19:18Z",
        "rows": rows,
        "schema_version": 1,
        "totals": {"overall": len(rows)},
    }


def stage_a_event(person: int, year: int, row_index: int, club: str) -> dict:
    return {
        "age_raw": "20yr", "club_name_raw": club, "club_slug": club.lower(),
        "draft_year": year, "event_type_raw": None, "pick_number": row_index + 1,
        "parity_only": {"games": "0", "goals": "0"},
        "player_url": URL(person), "row_index": row_index,
        "source_url": f"https://www.draftguru.com.au/years/{year}",
    }


def make_stage_a_rows() -> list[dict]:
    rows = [stage_a_event(i, 1990, i - 1, "Fitzroy") for i in range(1, 10)]
    # p06 is drafted a second time by the SAME club -- a valid same-club re-draft that
    # must not collapse the person into two parent rows, and must not be discarded.
    rows.append(stage_a_event(6, 1994, 0, "Fitzroy"))
    # Every v1-withheld person still has a draft event; the lineage must account for them.
    rows.extend(stage_a_event(i, 1992, i - 10, "Carlton") for i in range(10, 13))
    return rows


def fixture_expectations() -> dict:
    return {
        "by_group": {"relisting": 3, "tokenisation": 1, "discrepancy": 1, "audit": 1},
        "by_verdict": {"same_person_valid_relisting": 2, "same_person_valid_href": 1,
                       "approve_manual_curation": 1, "agree": 1,
                       "different_person_wrong_href": 1},
        "child_v1_bridges": 8,
        "corrected_targets": {URL(4): CORRECTED_P04},
        "decision_total": 6,
        "negative_total": 1,
        "parent_v1_bridges": 9,
        "parent_v1_withheld": 3,
        "parent_v2_bridges": 8,
        "parent_v2_withheld": 4,
        "population": 12,
        "positive_total": 5,
        "stage_a_events": 13,
        "uncertain_total": 0,
        "withheld_urls": [URL(5)],
    }


def write_fixture_repo(tmp: Path, *, parent_v1=None, child_v1=None, verdicts=None,
                       stage_a=None) -> dict:
    """Materialise a minimal repository and return {root, pinned, expect}."""
    (tmp / "tools" / "rebuild" / "draftguru").mkdir(parents=True, exist_ok=True)
    (tmp / "data" / "reference").mkdir(parents=True, exist_ok=True)
    (tmp / "docs" / "rebuild-manifests" / "draftguru").mkdir(parents=True, exist_ok=True)
    (tmp / "data" / "sources" / "draftguru" / "annual-html-20260826" / "parsed").mkdir(
        parents=True, exist_ok=True)

    base.atomic_write_bytes(
        tmp / tool.CONTRACT_PATH,
        base.dump_json_lf({"canonical_player_url": {"regex": CONTRACT_REGEX}}))

    payloads = {
        "parent_v1": base.dump_json_lf(parent_v1 if parent_v1 is not None else make_parent_v1()),
        "child_v1_afldb_test": base.dump_json_lf(
            child_v1 if child_v1 is not None else make_child_v1()),
        "operator_verdicts_json": base.dump_json_lf(
            verdicts if verdicts is not None else make_verdicts()),
        "operator_verdicts_csv": b"draftguru_url,operator_verdict\n",
        "operator_verdicts_md": b"# fixture verdicts\n",
        "adjudication_pack_json": base.dump_json_lf({"rows": [], "label": "fixture"}),
        "review_sample_v1": base.dump_json_lf({"rows": [], "label": "fixture"}),
        "stage_a_rows": ("\n".join(
            json.dumps(r, ensure_ascii=True, sort_keys=True)
            for r in (stage_a if stage_a is not None else make_stage_a_rows())) + "\n"
        ).encode("utf-8"),
    }

    pinned: dict[str, tuple[str, str]] = {}
    for key, data in payloads.items():
        rel = tool.PINNED_INPUTS[key][0]
        path = tmp / rel
        base.atomic_write_bytes(path, data)
        pinned[key] = (rel, base.sha256_bytes(data))

    return {"root": tmp, "pinned": pinned, "expect": fixture_expectations(),
            "payloads": payloads}


def refused(fn) -> str | None:
    """Return the refusal message, or None if the call unexpectedly succeeded."""
    try:
        fn()
    except base.ToolError as exc:
        return str(exc)
    return None


def build_fixture(tmp: Path, **kwargs):
    fx = write_fixture_repo(tmp, **kwargs)
    return fx, tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"])


# ---------------------------------------------------------------------------
# 1. Happy path, lineage arithmetic, reconciliation
# ---------------------------------------------------------------------------

section("1. Baseline generation, lineage and reconciliation")

with tempfile.TemporaryDirectory() as td:
    fx, result = build_fixture(Path(td))
    recon = result["reconciliation"]
    parent_v2 = result["parent_v2"]
    bridges = parent_v2["bridges"]
    withheld = parent_v2["withheld"]
    by_url = {e["player_url"]: e["afltables_external_id"] for e in bridges}

    check("1.1 all pinned inputs validate and the build completes", True)
    check("1.2 v2 accepted count is v1 minus the rejected rows",
          len(bridges) == 8, f"{len(bridges)}")
    check("1.3 v2 withheld count is v1 plus the rejected rows",
          len(withheld) == 4, f"{len(withheld)}")
    check("1.4 bridges + withheld partition the population exactly",
          len(bridges) + len(withheld) == 12 and recon["counts"]["unaccounted_rows"] == 0)

    actions = result["actions"]
    check("1.5 action totals: 3 untouched, 4 confirmed, 1 corrected, 0 added, 1 withheld",
          actions == {"unchanged": 3, "confirmed": 4, "corrected": 1,
                      "added": 0, "removed_withheld": 1}, str(actions))
    check("1.6 reconciliation reports content-unchanged = untouched + confirmed",
          recon["lineage"]["unchanged_content"] == 7)
    check("1.7 reconciliation decision totals balance",
          recon["decisions"] == {"by_verdict": fx["expect"]["by_verdict"],
                                 "negative_excluded": 1, "positive_represented": 5,
                                 "total": 6, "uncertain": 0}, str(recon["decisions"]))
    check("1.8 reconciliation totals balance exactly (no unaccounted row)",
          recon["counts"]["accepted_v2"] + recon["counts"]["withheld_v2"]
          == recon["counts"]["population"]
          and actions["unchanged"] + actions["confirmed"] + actions["corrected"]
          + actions["added"] == recon["counts"]["accepted_v2"]
          and actions["removed_withheld"] == recon["counts"]["withheld_v2"]
          - fx["expect"]["parent_v1_withheld"])

    check("1.9 every changed row is listed in the machine-readable manifest",
          sorted(r["draftguru_url"] for r in recon["lineage"]["changed_rows"])
          == sorted([URL(4), URL(5)]))
    check("1.10 child_status is explicit and no child artefact is produced",
          recon["child_status"] == "requires --resolve-against afldb_test"
          and "child" not in tool.OUTPUTS
          and not any("afldb_test" in p for p in tool.OUTPUTS.values()))
    cd = recon["child_status_detail"]
    check("1.11 child planning figures are carry-forward + pending only",
          cd["v1_resolved_child_accepted"] == 8
          and cd["v1_rows_eligible_for_unchanged_carry_forward"] == 7
          and cd["corrected_parent_targets_pending_db_resolution_count"] == 1)
    check("1.12 no final v2 child accepted/withheld count is published",
          not any(k.startswith("v2_child") for k in cd)
          and "v2_child_accepted" not in json.dumps(recon))
    check("1.13 manifest records that no database/import/DEV/PROD action occurred",
          "target resolution against afldb_test" in recon["not_performed"]
          and "any database connection" in recon["not_performed"]
          and "any importer run" in recon["not_performed"])

    # 3. Every positive verdict represented exactly once in the intended lineage.
    positive_urls = [URL(1), URL(2), URL(3), URL(4), URL(6)]
    check("1.14 every positive verdict is represented exactly once",
          all(sum(1 for e in bridges if e["player_url"] == u) == 1 for u in positive_urls))
    check("1.15 audit-agree row does not duplicate its mapping",
          sum(1 for e in bridges if e["player_url"] == URL(3)) == 1
          and by_url[URL(3)] == V1_TARGET[3])

    # 9/10. Structured targets only.
    check("1.16 tokenisation row uses the structured retained target",
          by_url[URL(2)] == V1_TARGET[2])
    check("1.17 manual-curation row uses the structured corrected target",
          by_url[URL(4)] == CORRECTED_P04)
    check("1.18 operator notes are never parsed as target authority",
          by_url[URL(1)] == V1_TARGET[1]
          and "Never_Use_This" not in json.dumps(bridges))

    # 13. Unaffected v1 rows unchanged.
    v1 = make_parent_v1()
    v1_untouched = [e for e in v1["bridges"] if e["player_url"] in (URL(7), URL(8), URL(9))]
    v2_untouched = [e for e in bridges if e["player_url"] in (URL(7), URL(8), URL(9))]
    check("1.19 unaffected v1 rows are preserved unchanged, content and order",
          v1_untouched == v2_untouched)
    check("1.20 unaffected v1 withheld rows are preserved unchanged",
          all({"player_url": URL(i), "reason": "U-no-href"} in withheld for i in range(10, 13)))

    # 4/5. Rejected row handling (fixture analogue of the two named persons).
    check("1.21 the rejected person is absent from v2 accepted rows",
          URL(5) not in by_url)
    check("1.22 the rejected person is present in withheld with the operator's reason",
          {"player_url": URL(5), "reason": "different_person_wrong_href"} in withheld)
    check("1.23 the rejected AFL Tables target survives in no accepted row",
          V1_TARGET[5] not in set(by_url.values()))

    wdoc = result["withheld_doc"]
    check("1.24 withheld manifest preserves immutable row identity, source URL, "
          "rejected target and operator reason",
          len(wdoc["rows"]) == 1
          and wdoc["rows"][0]["draftguru_url"] == URL(5)
          and wdoc["rows"][0]["rejected_afltables_target"] == V1_TARGET[5]
          and wdoc["rows"][0]["operator_reason"] == "different_person_wrong_href"
          and wdoc["rows"][0]["global_order"] == 5)
    check("1.25 withheld manifest records the v1 child status as lineage evidence",
          wdoc["rows"][0]["v1_afldb_test_child_status"] == "bridged")

    # Event-club provenance preserved, never acted on.
    affected = {a["draftguru_url"]: a for a in parent_v2["operator_adjudication"]["affected_rows"]}
    check("1.26 event-club relationship is preserved as review provenance",
          affected[URL(6)]["event_club_provenance"]
          ["event_club_appearance_relationship_derived"] == "pre_event_only"
          and affected[URL(1)]["event_club_provenance"]
          ["event_club_appearance_relationship_derived"] == "no_senior_appearance_ever")
    check("1.27 event-club provenance does not change identity or add a statistic",
          by_url[URL(6)] == V1_TARGET[6]
          and all(set(e) == {"player_url", "afltables_external_id"} for e in bridges))
    check("1.28 per-row provenance records confirmed/corrected/added/withheld",
          {a["action"] for a in affected.values()}
          == {"confirmed", "corrected", "removed_withheld"})

# ---------------------------------------------------------------------------
# 2. Event reconciliation -- the "one parent, many events" invariant
# ---------------------------------------------------------------------------

section("2. Event reconciliation (no event-level bridge file exists)")

with tempfile.TemporaryDirectory() as td:
    fx, result = build_fixture(Path(td))
    ev = result["events"]
    check("2.1 relisting rows collapse to one parent with multiple events",
          ev["relisting_persons_holding_exactly_one_parent_row"] == 2
          and ev["relisting_persons_with_multiple_events"] == 1)
    check("2.2 a same-club re-draft remains valid and is preserved",
          ev["persons_with_same_club_repeat_event"] == 1
          and ev["relisting_persons_with_same_club_repeat_event"] == 1)
    check("2.3 no orphan event person and no duplicate event identity",
          ev["orphan_event_persons"] == 0 and ev["duplicate_event_identities"] == 0)
    check("2.4 events belonging to the withheld person resolve to no accepted link",
          ev["events_blocked_by_withheld_rows"] == 1)
    check("2.5 referential integrity result recorded",
          ev["referential_integrity"] == "PASS"
          and result["reconciliation"]["referential_integrity"]["result"] == "PASS")

with tempfile.TemporaryDirectory() as td:
    rows = make_stage_a_rows()
    rows.append(copy.deepcopy(rows[0]))  # identical (draft_year, row_index, source_url)
    fx = write_fixture_repo(Path(td), stage_a=rows)
    fx["expect"]["stage_a_events"] = 14
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("2.6 duplicate immutable event identity is refused",
          msg is not None and "duplicate immutable event identity" in msg, str(msg))

with tempfile.TemporaryDirectory() as td:
    rows = make_stage_a_rows()
    rows.append(stage_a_event(99, 1995, 0, "Fitzroy"))  # a person in no bridge section
    fx = write_fixture_repo(Path(td), stage_a=rows)
    fx["expect"]["stage_a_events"] = 14
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("2.7 an orphan event person is refused",
          msg is not None and "neither v2 bridges[] nor" in msg, str(msg))

# ---------------------------------------------------------------------------
# 3. Fail-closed refusals
# ---------------------------------------------------------------------------

section("3. Fail-closed refusals")

with tempfile.TemporaryDirectory() as td:
    v = make_verdicts()
    v["completion_status"] = "in_progress"
    fx = write_fixture_repo(Path(td), verdicts=v)
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("3.1 incomplete operator output is refused",
          msg is not None and "completion_status" in msg, str(msg))

with tempfile.TemporaryDirectory() as td:
    v = make_verdicts()
    v["rows"][0]["operator_verdict"] = ""
    fx = write_fixture_repo(Path(td), verdicts=v)
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("3.2 a missing accepted decision is refused",
          msg is not None and "no operator_verdict" in msg, str(msg))

with tempfile.TemporaryDirectory() as td:
    v = make_verdicts()
    v["rows"][0]["operator_verdict"] = "agree"  # 'agree' belongs to the audit group only
    fx = write_fixture_repo(Path(td), verdicts=v)
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("3.3 a wrong verdict/group combination is refused",
          msg is not None and "does not allow" in msg, str(msg))

with tempfile.TemporaryDirectory() as td:
    v = make_verdicts()
    v["rows"][0]["operator_verdict"] = "undetermined_withhold"
    v["rows"][0]["operator_notes"] = "insufficient evidence"
    fx = write_fixture_repo(Path(td), verdicts=v)
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("3.4 an unexpected uncertain verdict is refused",
          msg is not None and "uncertain/negative verdict" in msg, str(msg))

with tempfile.TemporaryDirectory() as td:
    v = make_verdicts()
    v["rows"].append(verdict_row(7, 7, "audit", "agree", captured_field="captured_href"))
    fx = write_fixture_repo(Path(td), verdicts=v)
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("3.5 an unexpected extra affected row is refused",
          msg is not None and "rows, expected" in msg, str(msg))

with tempfile.TemporaryDirectory() as td:
    v = make_verdicts()
    v["rows"][3]["evidence"].pop("corrected_identity_candidate")
    fx = write_fixture_repo(Path(td), verdicts=v)
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("3.6 a manual-curation row with no structured corrected target is refused",
          msg is not None and "no structured evidence" in msg, str(msg))

with tempfile.TemporaryDirectory() as td:
    v = make_verdicts()
    v["rows"][3]["evidence"]["corrected_identity_candidate"] = [CORRECTED_P04,
                                                               "players/F/Fix_P041.html"]
    fx = write_fixture_repo(Path(td), verdicts=v)
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("3.7 a manual-curation row with more than one corrected target is refused",
          msg is not None and "exactly one is required" in msg, str(msg))

with tempfile.TemporaryDirectory() as td:
    v = make_verdicts()
    v["rows"][3]["evidence"]["corrected_identity_candidate"] = V1_TARGET[4]
    fx = write_fixture_repo(Path(td), verdicts=v)
    fx["expect"]["corrected_targets"] = {URL(4): V1_TARGET[4]}
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("3.8 a manual-curation row that does not change the target is refused",
          msg is not None and "identical to the captured href" in msg, str(msg))

with tempfile.TemporaryDirectory() as td:
    v = make_verdicts()
    # The corrected target collides with another accepted person's identity.
    v["rows"][3]["evidence"]["corrected_identity_candidate"] = V1_TARGET[7]
    fx = write_fixture_repo(Path(td), verdicts=v)
    fx["expect"]["corrected_targets"] = {URL(4): V1_TARGET[7]}
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("3.9 a conflicting parent target is refused",
          msg is not None and "multiple DraftGuru" in msg, str(msg))

with tempfile.TemporaryDirectory() as td:
    p = make_parent_v1()
    p["bridges"].append({"afltables_external_id": "players/F/Fix_Dup.html",
                         "player_url": URL(1)})
    p["counts"]["bridges"] = 10
    fx = write_fixture_repo(Path(td), parent_v1=p)
    fx["expect"]["parent_v1_bridges"] = 10
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("3.10 a duplicate parent key is refused",
          msg is not None and "duplicate player_url" in msg, str(msg))

with tempfile.TemporaryDirectory() as td:
    # p07 already carries the target the operator rejects on p05: the rejected mapping
    # must not survive through an unaffected v1 carry-forward path.
    p = make_parent_v1()
    for entry in p["bridges"]:
        if entry["player_url"] == URL(7):
            entry["afltables_external_id"] = V1_TARGET[5]
    fx = write_fixture_repo(Path(td), parent_v1=p)
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("3.11 a rejected href cannot re-enter through a v1 carry-forward path",
          msg is not None and "re-enters the v2 accepted rows" in msg, str(msg))

with tempfile.TemporaryDirectory() as td:
    v = make_verdicts()
    v["rows"][0]["evidence"]["captured_afltables_href"] = "players/F/Fix_Other.html"
    fx = write_fixture_repo(Path(td), verdicts=v)
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("3.12 a verdict decided against a different captured target is refused",
          msg is not None and "does not apply to this lineage" in msg, str(msg))

with tempfile.TemporaryDirectory() as td:
    v = make_verdicts()
    v["rows"][0]["evidence"].pop("captured_afltables_href")
    fx = write_fixture_repo(Path(td), verdicts=v)
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("3.13 a row with no structured captured href is refused",
          msg is not None and "structured captured-href" in msg, str(msg))

with tempfile.TemporaryDirectory() as td:
    v = make_verdicts()
    v["rows"][0]["evidence"]["captured_href"] = V1_TARGET[1]  # both fields present
    fx = write_fixture_repo(Path(td), verdicts=v)
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("3.14 a row with two structured captured-href fields is refused",
          msg is not None and "structured captured-href" in msg, str(msg))

with tempfile.TemporaryDirectory() as td:
    v = make_verdicts()
    v["rows"][5]["draftguru_url"] = URL(1)
    v["rows"][5]["evidence"]["captured_afltables_href"] = V1_TARGET[1]
    fx = write_fixture_repo(Path(td), verdicts=v)
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("3.15 a duplicate adjudicated row identity is refused",
          msg is not None and "duplicate row identity" in msg, str(msg))

with tempfile.TemporaryDirectory() as td:
    v = make_verdicts()
    v["rows"][5]["draftguru_url"] = URL(11)  # a v1-withheld person
    v["rows"][5]["evidence"]["draftguru_url"] = URL(11)
    fx = write_fixture_repo(Path(td), verdicts=v)
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("3.16 an adjudicated row naming a person the v1 parent does not bridge is refused",
          msg is not None and "the v1 parent does not bridge" in msg, str(msg))

with tempfile.TemporaryDirectory() as td:
    fx = write_fixture_repo(Path(td))
    # Mutate a pinned input after its hash was recorded.
    target = fx["root"] / fx["pinned"]["parent_v1"][0]
    base.atomic_write_bytes(target, target.read_bytes() + b"\n")
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("3.17 a pinned-input hash mismatch is refused before anything is computed",
          msg is not None and "sha256 mismatch" in msg, str(msg))

with tempfile.TemporaryDirectory() as td:
    fx = write_fixture_repo(Path(td))
    (fx["root"] / fx["pinned"]["review_sample_v1"][0]).unlink()
    msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
    check("3.18 a missing pinned input is refused",
          msg is not None and "missing pinned input" in msg, str(msg))

# ---------------------------------------------------------------------------
# 4. Determinism, ordering, atomicity and idempotency
# ---------------------------------------------------------------------------

section("4. Determinism, ordering, atomicity, idempotency")

with tempfile.TemporaryDirectory() as td:
    fx, first = build_fixture(Path(td))
    second = tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"])
    check("4.1 repeat generation is byte-identical",
          first["payloads"] == second["payloads"]
          and first["output_hashes"] == second["output_hashes"])
    check("4.2 no wall-clock value is written; the timestamp is frozen to the verdict artefact",
          first["frozen_utc"] == FROZEN_UTC
          and first["parent_v2"]["generated_utc"] == FROZEN_UTC
          and "not a wall-clock" in first["parent_v2"]["generated_utc_basis"])

    bridges = first["parent_v2"]["bridges"]
    withheld = first["parent_v2"]["withheld"]
    check("4.3 deterministic ordering: both sections ascend by player_url",
          bridges == sorted(bridges, key=lambda e: e["player_url"])
          and withheld == sorted(withheld, key=lambda w: w["player_url"]))
    check("4.4 the reconciliation's changed-row list is deterministically ordered",
          first["reconciliation"]["lineage"]["changed_rows"]
          == sorted(first["reconciliation"]["lineage"]["changed_rows"],
                    key=lambda r: r["draftguru_url"]))
    check("4.5 a content-addressed rows_sha256 accompanies the parent",
          len(first["parent_v2"]["rows_sha256"]) == 64)

    csv_text = first["payloads"]["parent_csv"].decode("utf-8")
    check("4.6 CSV view is LF-only and covers the whole population",
          "\r" not in csv_text and len(csv_text.strip().splitlines()) == 13)

    md_text = first["payloads"]["summary_md"].decode("utf-8")
    check("4.7 Markdown summary states the deferred child status",
          "requires --resolve-against afldb_test" in md_text
          and "not** deployment-ready" in md_text)

    # 29. Source inputs remain byte-identical across the whole run.
    unchanged = all(base.sha256_file(fx["root"] / rel) == want
                    for rel, want in fx["pinned"].values())
    check("4.8 v1 bridges, adjudication pack and operator outputs remain byte-identical",
          unchanged)

with tempfile.TemporaryDirectory() as td:
    fx, result = build_fixture(Path(td))
    states = tool.write_outputs(fx["root"], result["payloads"])
    check("4.9 first write writes every artefact",
          set(states.values()) == {"written"} and len(states) == 6)
    on_disk = {key: (fx["root"] / tool.OUTPUTS[key]).read_bytes() for key in states}
    check("4.10 written bytes equal the computed payloads", on_disk == result["payloads"])
    check("4.11 atomic write leaves no temporary file behind",
          not list((fx["root"] / "data" / "reference").glob(".*tmp*"))
          and not list((fx["root"] / "docs" / "rebuild-manifests" / "draftguru")
                       .glob(".*tmp*")))

    states2 = tool.write_outputs(fx["root"], result["payloads"])
    check("4.12 an identical rerun is idempotent and safe",
          set(states2.values()) == {"identical"})

    mutated = dict(result["payloads"])
    mutated["summary_md"] = mutated["summary_md"] + b"\n<!-- changed -->\n"
    msg = refused(lambda: tool.write_outputs(fx["root"], mutated))
    check("4.13 an existing non-identical artefact refuses overwrite",
          msg is not None and "never overwritten" in msg, str(msg))
    check("4.14 a refused write leaves every existing artefact untouched",
          {key: (fx["root"] / tool.OUTPUTS[key]).read_bytes() for key in states}
          == result["payloads"])

# ---------------------------------------------------------------------------
# 5. Screens: absolute paths and credentials
# ---------------------------------------------------------------------------

section("5. Output screening")

with tempfile.TemporaryDirectory() as td:
    fx, result = build_fixture(Path(td))
    joined = b"".join(result["payloads"].values()).decode("utf-8")
    check("5.1 no absolute local path appears in any output",
          "C:\\" not in joined and "/home/" not in joined and "/Users/" not in joined)
    check("5.2 no credential or DSN appears in any output",
          "postgres://" not in joined and "postgresql://" not in joined
          and "DATABASE_URL" not in joined)
    check("5.3 outputs use repository-relative paths only",
          all(not p.startswith("/") and ":" not in p.split("/")[0]
              for p in tool.OUTPUTS.values()))
    for probe, label in (("C:\\Users\\someone\\secret.json", "an absolute Windows path"),
                         ("postgresql://u:p@h/db", "a PostgreSQL DSN"),
                         ("AFLDB_TEST_DATABASE_URL", "a database environment variable name")):
        msg = refused(lambda probe=probe: tool.screen_output_bytes(
            "probe", json.dumps({"x": probe}).encode("utf-8")))
        check(f"5.4 screen refuses {label}", msg is not None and "refusing to write" in msg)

# Local Windows paths reach an artefact through operator/source-provided text, and this
# tool emits both raw views (CSV, Markdown) and escaped views (JSON). Each form is
# asserted separately, raw and json.dumps()-escaped, so a regression names the exact form
# that stopped being screened.
WINDOWS_PATH_PROBES = (
    ("a backslash drive path", "C:\\Users\\Stu\\file.txt"),
    ("a second backslash drive path", "D:\\dev\\afldb\\file.json"),
    ("a forward-slash drive path", "C:/Users/Stu/file.txt"),
    ("a second forward-slash drive path", "D:/dev/afldb/file.json"),
    ("a UNC network path", "\\\\server\\share\\file.txt"),
    ("a drive path embedded in prose",
     "operator note: copied from D:\\dev\\afldb\\working-notes.txt before deciding"),
    ("a drive path beside a valid evidence URL",
     "https://en.wikipedia.org/wiki/Craig_Somerville and C:\\Users\\Stu\\file.txt"),
)

for label, probe in WINDOWS_PATH_PROBES:
    raw = refused(lambda p=probe: tool.screen_output_bytes("probe", p.encode("utf-8")))
    check(f"5.5 screen refuses {label} (raw view)",
          raw is not None and "refusing to write" in raw, f"{probe!r} -> {raw!r}")
    esc = refused(lambda p=probe: tool.screen_output_bytes(
        "probe", json.dumps({"x": p}).encode("utf-8")))
    check(f"5.5 screen refuses {label} (JSON-escaped view)",
          esc is not None and "refusing to write" in esc, f"{probe!r} -> {esc!r}")

# The screen must not fire on the evidence URLs the operator legitimately pastes, nor on
# the escaped non-breaking space the Stage A award strings carry.
ALLOWED_PROBES = (
    ("a canonical DraftGuru URL", "https://www.draftguru.com.au/players/craig_somerville/1"),
    ("a Wikipedia evidence URL", "https://en.wikipedia.org/wiki/Chris_O%27Dwyer"),
    ("an AFL Tables evidence URL", "https://afltables.com/afl/stats/players/C/Chris_ODwyer.html"),
    ("several evidence URLs in one note",
     "https://www.draftguru.com.au/players/david_williams/1 "
     "https://en.wikipedia.org/wiki/David_Williams https://afltables.com/afl/stats/players/"
     "D/David_Williams.html"),
    ("a repository-relative path", "docs/rebuild-manifests/draftguru/bridge-v2-summary.md"),
    # The Stage A award strings carry a real non-breaking space after "B&F:". Written out,
    # json.dumps() renders it as the escape \u00a0 -- a backslash that must not be read as
    # a path separator.
    ("a non-breaking space in an award string", "B&F:" + "\u00a0" + "1983, 1989"),
)

for label, probe in ALLOWED_PROBES:
    raw = refused(lambda p=probe: tool.screen_output_bytes("probe", p.encode("utf-8")))
    check(f"5.6 screen allows {label} (raw view)", raw is None, f"{probe!r} -> {raw!r}")
    esc = refused(lambda p=probe: tool.screen_output_bytes(
        "probe", json.dumps({"x": p}).encode("utf-8")))
    check(f"5.6 screen allows {label} (JSON-escaped view)", esc is None, f"{probe!r} -> {esc!r}")

# The same award string as it appears verbatim in the Stage A source text: the escape is
# already written out as a single backslash followed by u00a0.
literal_escape = "B&F:\\u00a01983, 1989"
check("5.6 screen allows a written-out \\u00a0 escape in an award string",
      refused(lambda: tool.screen_output_bytes("probe", literal_escape.encode("utf-8"))) is None)

# Every renderer's bytes must actually reach the screen, and every renderer must refuse a
# Windows path in either view. Nothing here depends on which renderer happens to carry
# operator notes today.
with tempfile.TemporaryDirectory() as td:
    fx = write_fixture_repo(Path(td))
    screened: list[tuple[str, bytes]] = []
    real_screen = tool.screen_output_bytes

    def recording_screen(name: str, data: bytes) -> None:
        screened.append((name, data))
        real_screen(name, data)

    tool.screen_output_bytes = recording_screen
    try:
        result = tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"])
    finally:
        tool.screen_output_bytes = real_screen

    check("5.7 every output renderer's bytes pass through the screen",
          sorted(name for name, _ in screened) == sorted(tool.OUTPUTS.values()),
          str(sorted(name for name, _ in screened)))
    check("5.8 the screened bytes are exactly the bytes that would be written",
          dict(screened) == {tool.OUTPUTS[key]: data
                             for key, data in result["payloads"].items()})

    for name, data in screened:
        for view, injected in (("raw view", b"C:\\Users\\Stu\\leak.txt"),
                               ("JSON-escaped view", b"C:\\\\Users\\\\Stu\\\\leak.txt"),
                               ("UNC view", b"\\\\\\\\server\\\\share\\\\leak.txt")):
            # The lambda's defaults are named after the loop variables on purpose: the
            # assertion below reads `name` from this scope, and a differently-named
            # default would exist only inside the lambda.
            msg = refused(lambda name=name, data=data, injected=injected:
                          tool.screen_output_bytes(name, data + b"\n" + injected))
            check(f"5.9 {name} refuses an injected Windows path ({view})",
                  msg is not None and name in msg and "refusing to write" in msg, str(msg))

# End-to-end: operator-provided free text is copied verbatim into the manifests, so a
# Windows path pasted into an operator note must fail the whole build closed. The note
# lands in a JSON artefact (escaped) and a CSV artefact (raw), which is precisely the
# escaped form the earlier screen missed.
for note_label, poison in (("a backslash drive path", "checked C:\\Users\\Stu\\bridge.xlsx"),
                           ("a forward-slash drive path", "checked D:/dev/afldb/bridge.xlsx"),
                           ("a UNC network path", "checked \\\\nas\\afldb\\bridge.xlsx")):
    with tempfile.TemporaryDirectory() as td:
        poisoned_verdicts = make_verdicts()
        for row in poisoned_verdicts["rows"]:
            if row["operator_verdict"] == "different_person_wrong_href":
                row["operator_notes"] = poison
        fx = write_fixture_repo(Path(td), verdicts=poisoned_verdicts)
        msg = refused(lambda: tool.build(fx["root"], pinned=fx["pinned"], expect=fx["expect"]))
        check(f"5.10 the build fails closed when an operator note carries {note_label}",
              msg is not None and "refusing to write" in msg, str(msg))
        check(f"5.11 the refused build wrote no artefact ({note_label})",
              not any((fx["root"] / rel).exists() for rel in tool.OUTPUTS.values()))

# ---------------------------------------------------------------------------
# 6. No database, network or import code path
# ---------------------------------------------------------------------------

section("6. No database / network / import code path")

GENERATOR_SRC = (TOOL_DIR / "build_person_bridge_v2.py").read_text(encoding="utf-8")
BASE_SRC = (TOOL_DIR / "review_person_bridge_offline.py").read_text(encoding="utf-8")

FORBIDDEN_MODULES = {
    "psycopg", "psycopg2", "sqlalchemy", "socket", "ssl", "urllib", "urllib2",
    "urllib3", "requests", "httpx", "http", "ftplib", "telnetlib", "asyncio",
    "subprocess", "tkinter", "import_draftguru", "export_person_bridge",
}


def imported_modules(src: str) -> set[str]:
    """Every module name this source actually imports -- docstring prose is not an
    import, so this is the only honest way to assert the absence of a code path."""
    import ast
    names: set[str] = set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Import):
            names.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                names.add(node.module.split(".")[0])
    return names


for name, src in (("build_person_bridge_v2.py", GENERATOR_SRC),
                  ("review_person_bridge_offline.py", BASE_SRC)):
    offenders = sorted(imported_modules(src) & FORBIDDEN_MODULES)
    check(f"6.1 {name} imports no database, network, subprocess or GUI module",
          not offenders, f"imports {offenders}")

ENV_ACCESSORS = frozenset({
    "environ", "environb", "getenv", "getenvb", "putenv", "putenvb", "unsetenv", "unsetenvb",
})
ENV_MODULES = frozenset({"os", "posix", "nt"})


def env_accesses(src: str) -> list[str]:
    """Every AST node that actually touches the process environment.

    This is deliberately an AST check and not a text search: the generator's own output
    screen carries the string "a database environment variable name", and a grep for
    "environ" therefore reports a refusal message as an environment read. Equally, a
    filesystem-safe call such as os.replace/os.fsync/os.listdir/os.getpid is not an
    environment read and must not be reported. Only a real accessor -- an attribute, a
    direct import, a bare imported name or a getattr() by that name -- counts. Each hit is
    returned as "line:col node" so a failure names the exact offending node.
    """
    import ast

    tree = ast.parse(src)
    found: list[str] = []

    def record(node: "ast.AST", why: str) -> None:
        found.append(f"{node.lineno}:{node.col_offset} {why}: {ast.unparse(node)}")

    for node in ast.walk(tree):
        # os.environ / os.getenv(...) -- any attribute by that name, whatever the object.
        if isinstance(node, ast.Attribute) and node.attr in ENV_ACCESSORS:
            record(node, "environment attribute")
        # from os import environ / getenv
        elif isinstance(node, ast.ImportFrom) and (node.module or "") in ENV_MODULES:
            if any(alias.name in ENV_ACCESSORS for alias in node.names):
                record(node, "environment import")
        elif isinstance(node, ast.Call):
            # getattr(os, "environ")
            if (isinstance(node.func, ast.Name) and node.func.id == "getattr"
                    and len(node.args) >= 2 and isinstance(node.args[1], ast.Constant)
                    and node.args[1].value in ENV_ACCESSORS):
                record(node, "environment getattr")
        # a directly imported accessor used as a bare name
        elif isinstance(node, ast.Name) and node.id in ENV_ACCESSORS:
            record(node, "environment name")
    return sorted(set(found))


generator_env = env_accesses(GENERATOR_SRC)
check("6.2 the generator reads no environment variable at all",
      not generator_env, "; ".join(generator_env))
base_env = env_accesses(BASE_SRC)
check("6.2a the shared offline base module reads no environment variable either",
      not base_env, "; ".join(base_env))
check("6.2b the environment check ignores filesystem os calls and the word 'environment'",
      not env_accesses(
          "import os\n"
          "os.replace(a, b)\n"
          "os.fsync(handle)\n"
          "os.listdir(d)\n"
          "os.getpid()\n"
          "LABEL = 'a database environment variable name'\n"
          "# no DATABASE_URL is ever read from the environment\n"))
check("6.2c the environment check still catches a real environment read",
      len(env_accesses("import os\nv = os.environ['X']\n")) == 1
      and len(env_accesses("import os\nv = os.getenv('X')\n")) == 1
      and len(env_accesses("from os import getenv\nv = getenv('X')\n")) == 2
      and len(env_accesses("import os as _o\nv = _o.environ['X']\n")) == 1
      and len(env_accesses("import os\nv = getattr(os, 'environ')\n")) == 1)
check("6.2d the environment check reports the offending node with its position",
      env_accesses("import os\nv = os.environ['X']\n")[0].startswith("2:4 ")
      and "os.environ" in env_accesses("import os\nv = os.environ['X']\n")[0])
check("6.3 the generator declares and produces no afldb_test child artefact",
      all(".afldb_test.json" not in p for p in tool.OUTPUTS.values())
      and tool.CHILD_STATUS == "requires --resolve-against afldb_test")
check("6.4 the generator never writes to a v1 artefact path",
      all(rel not in tool.OUTPUTS.values() for rel, _ in tool.PINNED_INPUTS.values()))

# ---------------------------------------------------------------------------
# 7. Pinned real-adjudication constants (no real artefact is opened)
# ---------------------------------------------------------------------------

section("7. Pinned real-adjudication constants")

check("7.1 decision total is pinned at 83", tool.EXPECT_DECISION_TOTAL == 83)
check("7.2 eligible/positive total is pinned at 81", tool.EXPECT_POSITIVE_TOTAL == 81)
check("7.3 withheld total is pinned at 2", tool.EXPECT_NEGATIVE_TOTAL == 2)
check("7.4 uncertain total is pinned at 0", tool.EXPECT_UNCERTAIN_TOTAL == 0)
check("7.5 the verdict breakdown is pinned 42/2/7/30 + 2",
      tool.EXPECT_BY_VERDICT == {"same_person_valid_relisting": 42,
                                 "same_person_valid_href": 2,
                                 "approve_manual_curation": 7,
                                 "agree": 30,
                                 "different_person_wrong_href": 2})
check("7.6 the group breakdown is pinned 44/2/7/30",
      tool.EXPECT_BY_GROUP == {"relisting": 44, "tokenisation": 2,
                               "discrepancy": 7, "audit": 30})
check("7.7 positive + withheld = the decision total",
      tool.EXPECT_POSITIVE_TOTAL + tool.EXPECT_NEGATIVE_TOTAL == tool.EXPECT_DECISION_TOTAL
      and sum(tool.EXPECT_BY_VERDICT.values()) == tool.EXPECT_DECISION_TOTAL
      and sum(tool.EXPECT_BY_GROUP.values()) == tool.EXPECT_DECISION_TOTAL)
check("7.8 Craig Somerville's wrong href is pinned as withheld",
      "https://www.draftguru.com.au/players/craig_somerville/1" in tool.EXPECT_WITHHELD_URLS)
check("7.9 David Sullivan's wrong href is pinned as withheld",
      "https://www.draftguru.com.au/players/david_sullivan/1" in tool.EXPECT_WITHHELD_URLS)
check("7.10 exactly two withheld identities are pinned",
      len(set(tool.EXPECT_WITHHELD_URLS)) == 2)
check("7.11 neither withheld person is also a corrected-target person",
      not (set(tool.EXPECT_WITHHELD_URLS) & set(tool.EXPECT_CORRECTED_TARGETS)))
check("7.12 exactly seven structured corrected targets are pinned, all canonical and distinct",
      len(tool.EXPECT_CORRECTED_TARGETS) == 7
      and len(set(tool.EXPECT_CORRECTED_TARGETS.values())) == 7
      and all(tool.AFLTABLES_PATH_RE.match(v)
              for v in tool.EXPECT_CORRECTED_TARGETS.values()))
check("7.13 the pinned corrected targets are exactly the seven adjudicated basenames",
      sorted(v.rsplit("/", 1)[1] for v in tool.EXPECT_CORRECTED_TARGETS.values())
      == ["Aaron_Black0.html", "Alwyn_Davey0.html", "Joel_Smith0.html", "Josh_Smith0.html",
          "Sam_Butler0.html", "Stephen_Schwerdt.html", "Tom_Murphy0.html"])
check("7.14 the pinned v1 -> v2 arithmetic is 3564/1493 -> 3562/1495 over 5,057 persons",
      tool.EXPECT_PARENT_V1_BRIDGES == 3564 and tool.EXPECT_PARENT_V1_WITHHELD == 1493
      and tool.EXPECT_PARENT_V2_BRIDGES == 3562 and tool.EXPECT_PARENT_V2_WITHHELD == 1495
      and tool.EXPECT_PARENT_V1_BRIDGES + tool.EXPECT_PARENT_V1_WITHHELD
      == tool.EXPECT_POPULATION
      and tool.EXPECT_PARENT_V2_BRIDGES + tool.EXPECT_PARENT_V2_WITHHELD
      == tool.EXPECT_POPULATION)
check("7.15 the accepted delta is -2, not +81",
      tool.EXPECT_PARENT_V2_BRIDGES - tool.EXPECT_PARENT_V1_BRIDGES == -2)
check("7.16 every pinned input hash is 64-char lowercase hex",
      all(len(h) == 64 and h == h.lower() and all(c in "0123456789abcdef" for c in h)
          for _, h in tool.PINNED_INPUTS.values()))
check("7.17 the pinned operator-verdict artefacts are the canonical JSON, CSV and Markdown",
      tool.PINNED_INPUTS["operator_verdicts_json"][1]
      == "b2ae2f4022cd3c22e91bfe6e399538949c02fe8cada95b5c355e6516c82a8822"
      and tool.PINNED_INPUTS["operator_verdicts_csv"][1]
      == "a74c6f185030cba3d58bd54b755eae14db3a006ad45ade19ec0f5bd8eaf17267"
      and tool.PINNED_INPUTS["operator_verdicts_md"][1]
      == "60c529df55313099f85b52af977512fa4fed8f5076fb7ce7263d04e2c05732c0"
      and tool.PINNED_INPUTS["adjudication_pack_json"][1]
      == "02d0cbe995b4482cf249fe216a10da18b325de6dfcb0504df2d3dbcba31ae292")

# ---------------------------------------------------------------------------

print()
if failures:
    print(f"{len(failures)} DraftGuru bridge-v2 contract check(s) FAILED:")
    for name in failures:
        print(f"  - {name}")
    raise SystemExit(1)
print("All DraftGuru bridge-v2 generation checks hold.")
