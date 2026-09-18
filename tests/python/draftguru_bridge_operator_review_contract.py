#!/usr/bin/env python3
"""AFLDB-ISSUE-222 -- DB-free contract checks for
tools/rebuild/draftguru/review_bridge_operator.py (the local operator-adjudication helper).

    python tests/python/draftguru_bridge_operator_review_contract.py

Exercises the GUI-independent logic (pack loading/validation, checkpoint, lock,
finalisation, deterministic CSV/Markdown rendering) directly against small hand-built
fixtures -- never the real 83-row adjudication pack -- so every check here runs in well
under a second. Never imports tkinter directly (the module under test guards its own
tkinter import), never opens a display, never touches the real tracked adjudication pack
or any other repository artefact.
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

import review_bridge_operator as tool  # noqa: E402

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' -- ' + detail) if detail else ''}")
        failures.append(name)


# ---------------------------------------------------------------------------
# Fixture construction
# ---------------------------------------------------------------------------

def make_relisting_row(i: int) -> dict:
    # Vary event club and retained career bounds across the 44 fixture rows to exercise every
    # event-club-appearance-relationship outcome. Row 1 deliberately derives
    # 'post_event_appearance' (no acknowledgement ever required for it) so every pre-existing
    # check below that uses pack_info["rows"][0]/pack_info7["rows"][0] as a plain, ack-free
    # relisting row keeps working unchanged; rows needing acknowledgement use later indices.
    if i == 1:
        event_club, career_start, career_end = "Test Club", 1991, 1995  # post_event_appearance
    elif i % 3 == 0:
        event_club, career_start, career_end = "Away Club", 1988, 1990  # no_senior_appearance_ever
    else:
        event_club, career_start, career_end = "Test Club", 1988, 1990  # pre_event_only
    return {
        "age_birth_evidence_agrees": True,
        "captured_afltables_href": f"players/T/Test_Relisting_{i}.html",
        "draftguru_name": f"Test Relisting {i}",
        "draftguru_per_entry_games": 0,
        "draftguru_url": f"https://www.draftguru.com.au/players/test_relisting_{i}/1",
        "event_club": event_club,
        "event_kind": "Mid-Season",
        "event_pick": i,
        "event_year": 1990,
        "is_original_23_or_companion_21": "original_23" if i % 2 else "companion_21",
        "machine_classification": "relisting_signature_review",
        "operator_notes": "",
        "operator_verdict": "",
        "ordinal": i,
        "recommended_evidence_interpretation": "test interpretation, not an operator decision",
        "retained_birth_year": 1970,
        "retained_career_end": career_end,
        "retained_career_games": 10,
        "retained_career_goals": 5,
        "retained_career_start": career_start,
        "retained_clubs": ["Test Club"],
        "retained_target_name": f"Test Relisting {i}",
        "sample_status": "non_sample",
        "stage_a_implied_birth_year": 1970,
        "stage_a_listed_age": "20yr",
    }


def make_tokenisation_row(i: int) -> dict:
    return {
        "captured_afltables_href": f"players/T/Test_Token_{i}.html",
        "draftguru_birth_year": 1982,
        "draftguru_games": 46,
        "draftguru_name": f"Test Token {i}",
        "draftguru_url": f"https://www.draftguru.com.au/players/test_token_{i}/1",
        "normalisation_note": "test normalisation note, not an operator decision",
        "operator_notes": "",
        "operator_verdict": "",
        "population_reason": "OTHER_CONTRADICTION:SURNAME_DIFFERENT",
        "reason_codes": ["SURNAME_DIFFERENT", "BIRTH_YEAR_CONSISTENT"],
        "retained_birth_year": 1982,
        "retained_career_games": 46,
        "retained_career_span": "2004-2006",
        "retained_clubs": ["Test Club"],
        "retained_target_name": f"Test Token Target {i}",
    }


def make_discrepancy_row(i: int) -> dict:
    return {
        "captured_href": f"players/T/Test_Discrepancy_{i}.html",
        "corrected_identity_birth_year": 1986,
        "corrected_identity_candidate": f"players/T/Test_Discrepancy_{i}0.html",
        "corrected_identity_career_games": 113,
        "corrected_identity_clubs": ["Test Club"],
        "corrected_identity_name": f"Test Discrepancy Target {i}",
        "draftguru_birth_year": 1986,
        "draftguru_games": 113,
        "draftguru_name": f"Test Discrepancy {i}",
        "draftguru_url": f"https://www.draftguru.com.au/players/test_discrepancy_{i}/1",
        "operator_notes": "",
        "operator_verdict": "",
        "why_not_auto_applicable": "test rationale, not an operator decision",
    }


def make_audit_row(i: int) -> dict:
    return {
        "captured_href": f"players/T/Test_Audit_{i}.html",
        "draftguru_birth_year": 1978,
        "draftguru_name": f"Test Audit {i}",
        "draftguru_url": f"https://www.draftguru.com.au/players/test_audit_{i}/1",
        "event_kind": "Pre-Draft",
        "event_year": 1994,
        "operator_notes": "",
        "operator_verdict": "",
        "reason_codes": ["BIRTH_YEAR_CONSISTENT", "GAMES_CONSISTENT"],
        "retained_birth_year": 1978,
        "retained_career_games": 169,
        "retained_career_span": "1996-2006",
        "sample_index": 100 + i,
        "stratum": "random",
    }


def raw_fields(event_club=None, event_year=None, retained_clubs=None,
                career_start=None, career_end=None) -> dict:
    """A minimal row['raw'] dict carrying only the fields
    derive_event_club_appearance_relationship actually reads -- a field is present only when
    an argument is given, so a missing field is genuinely absent (never present-but-None)."""
    d: dict = {}
    if event_club is not None:
        d["event_club"] = event_club
    if event_year is not None:
        d["event_year"] = event_year
    if retained_clubs is not None:
        d["retained_clubs"] = retained_clubs
    if career_start is not None:
        d["retained_career_start"] = career_start
    if career_end is not None:
        d["retained_career_end"] = career_end
    return d


def mock_row(group: str, raw: dict) -> dict:
    return {"group": group, "raw": raw}


def make_pack(hash_links: dict) -> dict:
    return {
        "confirmations": ["fixture pack -- not the real tracked artefact"],
        "hash_links": hash_links,
        "issue": "AFLDB-ISSUE-222",
        "label": "20260918-v1",
        "phase_3_status": "PENDING -- fixture",
        "schema_version": 1,
        "section_1_relisting_signature_rows": {
            "allowed_operator_verdicts": list(tool.SECTION_SPECS["relisting"]["allowed_verdicts"]),
            "count": 44,
            "rows": [make_relisting_row(i) for i in range(1, 45)],
        },
        "section_2_suspected_tokenisation_rows": {
            "allowed_operator_verdicts": list(tool.SECTION_SPECS["tokenisation"]["allowed_verdicts"]),
            "count": 2,
            "rows": [make_tokenisation_row(i) for i in range(1, 3)],
        },
        "section_3_source_discrepancies": {
            "allowed_operator_verdicts": list(tool.SECTION_SPECS["discrepancy"]["allowed_verdicts"]),
            "count": 7,
            "rows": [make_discrepancy_row(i) for i in range(1, 8)],
        },
        "section_4_thirty_row_audit": {
            "allowed_operator_verdicts": list(tool.SECTION_SPECS["audit"]["allowed_verdicts"]),
            "audit_salt": "test-salt",
            "audit_selection": "test selection description",
            "count": 30,
            "rows": [make_audit_row(i) for i in range(1, 31)],
        },
        "title": "fixture operator adjudication pack",
    }


def write_fixture_repo(tmp_dir: Path) -> dict:
    fake_dir = tmp_dir / "fake"
    fake_dir.mkdir(parents=True, exist_ok=True)
    parent_path = fake_dir / "parent.json"
    parent_path.write_bytes(b'{"parent": true}')
    child_path = fake_dir / "child.json"
    child_path.write_bytes(b'{"child": true}')

    hash_links = {
        "parent_bridge_v1": {"path": "fake/parent.json", "sha256": tool.sha256_file(parent_path)},
        "afldb_test_child_v1": {"path": "fake/child.json", "sha256": tool.sha256_file(child_path)},
        "draftguru_snapshot": {"path": "fake/snapshot-not-hashed.json"},
    }
    pack_path = tmp_dir / "bridge-operator-adjudication-pack-20260918-v1.json"
    pack = make_pack(hash_links)
    pack_path.write_bytes(tool.dump_json_lf(pack))
    return {
        "repo_root": tmp_dir,
        "pack_path": pack_path,
        "pack": pack,
        "parent_path": parent_path,
        "child_path": child_path,
    }


def all_decisions_for(pack_info: dict, *, use_negative: bool = False) -> dict:
    decisions = {}
    for row in pack_info["rows"]:
        spec = tool.SECTION_SPECS[row["group"]]
        if use_negative:
            verdict = [v for v in spec["allowed_verdicts"] if v in tool.REQUIRES_NOTES][0]
            notes = "test note for a negative/undetermined verdict"
        else:
            verdict = spec["positive_verdict"]
            notes = ""
        decision = {
            "group": row["group"],
            "row_ordinal_in_group": row["row_ordinal_in_group"],
            "global_order": row["global_order"],
            "draftguru_url": row["draftguru_url"],
            "operator_verdict": verdict,
            "operator_notes": notes,
            "decided_utc": "2026-09-18T00:00:00Z",
        }
        # Auto-acknowledge (agreeing with the derived suggestion) wherever the row's own
        # verdict/derivation combination requires it, so every pre-existing finalisation check
        # below stays a "happy path" for the identity verdict it is actually testing.
        if tool.event_club_observation_required_for(row, verdict):
            derived = tool.derive_event_club_appearance_relationship(row["raw"])
            decision["event_club_observation"] = derived
            decision["event_club_observation_notes"] = ""
            decision["event_club_observation_decided_utc"] = "2026-09-18T00:00:00Z"
        decisions[row["row_id"]] = decision
    return decisions


# ---------------------------------------------------------------------------
# 1. Source-pack validation / exact counts
# ---------------------------------------------------------------------------

tmp1 = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-"))
fx1 = write_fixture_repo(tmp1)
pack_info1 = tool.load_and_validate_pack(fx1["pack_path"], fx1["repo_root"])

check("1a valid fixture pack loads cleanly", len(pack_info1["rows"]) == 83)
check("1b group counts are exactly 44/2/7/30",
      sum(1 for r in pack_info1["rows"] if r["group"] == "relisting") == 44
      and sum(1 for r in pack_info1["rows"] if r["group"] == "tokenisation") == 2
      and sum(1 for r in pack_info1["rows"] if r["group"] == "discrepancy") == 7
      and sum(1 for r in pack_info1["rows"] if r["group"] == "audit") == 30)
check("1c at least one hash-linked input independently verified", len(pack_info1["hash_checks"]) >= 2)
check("1d section 1 ordinals are exactly 1..44",
      sorted(r["pack_ordinal"] for r in pack_info1["rows"] if r["group"] == "relisting") == list(range(1, 45)))


def refused(build_pack_fn) -> str | None:
    tmp = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-"))
    fx = write_fixture_repo(tmp)
    pack = build_pack_fn(copy.deepcopy(fx["pack"]))
    fx["pack_path"].write_bytes(tool.dump_json_lf(pack))
    try:
        tool.load_and_validate_pack(fx["pack_path"], fx["repo_root"])
    except tool.ToolError as exc:
        return str(exc)
    return None


def bad_declared_count(pack: dict) -> dict:
    pack["section_1_relisting_signature_rows"]["count"] = 43
    return pack


def bad_group_total(pack: dict) -> dict:
    # count matches rows[] length but not the required 44 for the group
    pack["section_1_relisting_signature_rows"]["rows"] = pack["section_1_relisting_signature_rows"]["rows"][:43]
    pack["section_1_relisting_signature_rows"]["count"] = 43
    return pack


msg = refused(bad_declared_count)
check("2a declared count != rows[] length is refused", msg is not None, str(msg))

msg = refused(bad_group_total)
check("2b rows[] length != the required group total (44) is refused", msg is not None, str(msg))

# ---------------------------------------------------------------------------
# 3. Hash mismatch refusal
# ---------------------------------------------------------------------------

tmp3 = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-"))
fx3 = write_fixture_repo(tmp3)
fx3["parent_path"].write_bytes(b'{"parent": true, "tampered": true}')
try:
    tool.load_and_validate_pack(fx3["pack_path"], fx3["repo_root"])
    hash_mismatch_msg = None
except tool.ToolError as exc:
    hash_mismatch_msg = str(exc)
check("3 a tampered hash-linked input file is refused with a hash-mismatch message",
      hash_mismatch_msg is not None and "hash mismatch" in hash_mismatch_msg, str(hash_mismatch_msg))

# ---------------------------------------------------------------------------
# 4. Duplicate / already-set-verdict rows
# ---------------------------------------------------------------------------


def duplicate_url(pack: dict) -> dict:
    pack["section_1_relisting_signature_rows"]["rows"][1]["draftguru_url"] = (
        pack["section_1_relisting_signature_rows"]["rows"][0]["draftguru_url"]
    )
    return pack


msg = refused(duplicate_url)
check("4a a duplicate draftguru_url within a group is refused", msg is not None and "duplicate" in msg.lower(), str(msg))


def prefilled_verdict(pack: dict) -> dict:
    pack["section_4_thirty_row_audit"]["rows"][0]["operator_verdict"] = "agree"
    return pack


msg = refused(prefilled_verdict)
check("4b a row with a non-blank source operator_verdict is refused", msg is not None, str(msg))

# ---------------------------------------------------------------------------
# 5/6. Allowed verdicts per group + required notes
# ---------------------------------------------------------------------------

try:
    tool.validate_decision("relisting", "agree", "")
    wrong_group_ok = True
except tool.ToolError:
    wrong_group_ok = False
check("5a an audit-only verdict ('agree') is rejected for the relisting group", not wrong_group_ok)

try:
    tool.validate_decision("relisting", "same_person_valid_relisting", "")
    right_group_ok = True
except tool.ToolError:
    right_group_ok = False
check("5b a group's own positive verdict is accepted with no notes", right_group_ok)

try:
    tool.validate_decision("relisting", "undetermined_withhold", "")
    negative_no_notes_ok = True
except tool.ToolError:
    negative_no_notes_ok = False
check("6a 'undetermined_withhold' without notes is rejected", not negative_no_notes_ok)

try:
    tool.validate_decision("relisting", "undetermined_withhold", "genuine ambiguity, see evidence X")
    negative_with_notes_ok = True
except tool.ToolError:
    negative_with_notes_ok = False
check("6b 'undetermined_withhold' with notes is accepted", negative_with_notes_ok)

check("6c REQUIRES_NOTES covers exactly the five specified negative/undetermined verdicts",
      tool.REQUIRES_NOTES == {
          "different_person_wrong_href", "undetermined_withhold", "reject_candidate",
          "contradict", "undetermined",
      })

# ---------------------------------------------------------------------------
# 7/8. Atomic checkpoint + resume
# ---------------------------------------------------------------------------

tmp7 = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-"))
fx7 = write_fixture_repo(tmp7)
pack_info7 = tool.load_and_validate_pack(fx7["pack_path"], fx7["repo_root"])
ckpt_path = tmp7 / "progress.json"
checkpoint7 = tool.new_checkpoint(pack_info7, "Test Operator", fx7["repo_root"])
first_row = pack_info7["rows"][0]
checkpoint7["decisions"][first_row["row_id"]] = {
    "group": first_row["group"], "row_ordinal_in_group": first_row["row_ordinal_in_group"],
    "global_order": first_row["global_order"], "draftguru_url": first_row["draftguru_url"],
    "operator_verdict": "same_person_valid_relisting", "operator_notes": "",
    "decided_utc": "2026-09-18T00:00:00Z",
}
checkpoint7 = tool.save_checkpoint(ckpt_path, checkpoint7)

leftover_tmp_files = list(ckpt_path.parent.glob(".progress.json.tmp-*"))
check("7a atomic write leaves no leftover temp file", leftover_tmp_files == [], str(leftover_tmp_files))
check("7b checkpoint file exists after save", ckpt_path.is_file())

resumed = tool.load_checkpoint(ckpt_path)
check("8a resumed checkpoint preserves the recorded decision",
      resumed["decisions"][first_row["row_id"]]["operator_verdict"] == "same_person_valid_relisting")
check("8b resumed checkpoint's decided_count is 1 of 83",
      tool.decided_count(pack_info7, resumed) == 1)

tool.validate_checkpoint_matches_pack(resumed, pack_info7)  # must not raise
check("8c resumed checkpoint validates cleanly against the same pack", True)

# ---------------------------------------------------------------------------
# 9. Wrong-pack checkpoint refusal
# ---------------------------------------------------------------------------

tmp9 = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-"))
fx9 = write_fixture_repo(tmp9)
mutated_pack9 = copy.deepcopy(fx9["pack"])
mutated_pack9["title"] = "a genuinely different fixture pack, not fx7's"
fx9["pack_path"].write_bytes(tool.dump_json_lf(mutated_pack9))  # different bytes -> different sha256
pack_info9 = tool.load_and_validate_pack(fx9["pack_path"], fx9["repo_root"])
try:
    tool.validate_checkpoint_matches_pack(resumed, pack_info9)
    wrong_pack_ok = True
except tool.ToolError:
    wrong_pack_ok = False
check("9 a checkpoint from a different pack is refused on resume", not wrong_pack_ok)

# ---------------------------------------------------------------------------
# 10. Incomplete finalisation refusal
# ---------------------------------------------------------------------------

incomplete_checkpoint = tool.new_checkpoint(pack_info1, "Test Operator", fx1["repo_root"])
incomplete_checkpoint["decisions"] = all_decisions_for(pack_info1)
del incomplete_checkpoint["decisions"][pack_info1["rows"][0]["row_id"]]
try:
    tool.build_final_document(pack_info1, incomplete_checkpoint, fx1["repo_root"])
    incomplete_finalise_ok = True
except tool.ToolError:
    incomplete_finalise_ok = False
check("10 finalisation is refused when 82 of 83 rows are decided", not incomplete_finalise_ok)

# ---------------------------------------------------------------------------
# 11/12. Deterministic rendering + final totals (full run through finalize())
# ---------------------------------------------------------------------------

tmp11 = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-"))
fx11 = write_fixture_repo(tmp11)
pack_info11 = tool.load_and_validate_pack(fx11["pack_path"], fx11["repo_root"])
ckpt11_path = tmp11 / "progress.json"
checkpoint11 = tool.new_checkpoint(pack_info11, "Test Operator", fx11["repo_root"])
checkpoint11["decisions"] = all_decisions_for(pack_info11)
checkpoint11 = tool.save_checkpoint(ckpt11_path, checkpoint11)

pack_sha_before = tool.sha256_file(fx11["pack_path"])
result_a = tool.finalize(fx11["pack_path"], checkpoint11, fx11["repo_root"])
json_bytes_a = result_a["paths"]["json"].read_bytes()
csv_bytes_a = result_a["paths"]["csv"].read_bytes()
md_bytes_a = result_a["paths"]["md"].read_bytes()

result_b = tool.finalize(fx11["pack_path"], checkpoint11, fx11["repo_root"])
json_bytes_b = result_b["paths"]["json"].read_bytes()
csv_bytes_b = result_b["paths"]["csv"].read_bytes()
md_bytes_b = result_b["paths"]["md"].read_bytes()

check("11a rerunning finalize() on identical decisions reproduces byte-identical JSON",
      json_bytes_a == json_bytes_b)
check("11b rerunning finalize() reproduces byte-identical CSV", csv_bytes_a == csv_bytes_b)
check("11c rerunning finalize() reproduces byte-identical Markdown", md_bytes_a == md_bytes_b)
check("11d rows_sha256 matches across reruns",
      result_a["doc"]["rows_sha256"] == result_b["doc"]["rows_sha256"])

check("12a totals.overall is 83", result_a["doc"]["totals"]["overall"] == 83)
check("12b totals.by_group sums to 83", sum(result_a["doc"]["totals"]["by_group"].values()) == 83)
check("12c totals.by_verdict sums to 83", sum(result_a["doc"]["totals"]["by_verdict"].values()) == 83)
check("12d exactly 83 rows written in source-pack order",
      [r["global_order"] for r in result_a["doc"]["rows"]] == list(range(1, 84)))
check("12e completion_status is 'complete'", result_a["doc"]["completion_status"] == "complete")

# ---------------------------------------------------------------------------
# 13. Source pack remains byte-identical
# ---------------------------------------------------------------------------

pack_sha_after = tool.sha256_file(fx11["pack_path"])
check("13 the source pack file is byte-identical before and after a full validate+finalize run",
      pack_sha_before == pack_sha_after)

# ---------------------------------------------------------------------------
# 14. No network / database imports or code paths
# ---------------------------------------------------------------------------

source_text = (TOOL_DIR / "review_bridge_operator.py").read_text(encoding="utf-8")
forbidden_substrings = [
    "import socket", "import psycopg", "import requests", "import urllib",
    "http.client", "subprocess", "DATABASE_URL",
]
present = [s for s in forbidden_substrings if s in source_text]
check("14a the tool's own source contains none of the forbidden network/database substrings",
      present == [], str(present))

# ---------------------------------------------------------------------------
# Lock file behaviour
# ---------------------------------------------------------------------------

tmp15 = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-"))
lock_path = tmp15 / "review.lock"
payload = tool.acquire_lock(lock_path)
check("15a acquiring a fresh lock writes pid/hostname/started_utc/session_id",
      set(payload) == {"pid", "hostname", "started_utc", "session_id"})

try:
    tool.acquire_lock(lock_path)
    second_lock_ok = True
except tool.ToolError:
    second_lock_ok = False
check("15b a second acquire without --force-unlock is refused", not second_lock_ok)

forced_payload = tool.acquire_lock(lock_path, force=True)
check("15c --force-unlock removes the stale lock and writes a new one",
      forced_payload["session_id"] != payload["session_id"])

tool.release_lock(lock_path)
check("15d release_lock removes the lock file", not lock_path.is_file())
tool.release_lock(lock_path)  # must not raise on a missing file
check("15e releasing an already-absent lock is a no-op, not an error", True)

# ---------------------------------------------------------------------------
# Negative-verdict finalisation path (every REQUIRES_NOTES verdict actually reachable)
# ---------------------------------------------------------------------------

tmp16 = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-"))
fx16 = write_fixture_repo(tmp16)
pack_info16 = tool.load_and_validate_pack(fx16["pack_path"], fx16["repo_root"])
ckpt16_path = tmp16 / "progress.json"
checkpoint16 = tool.new_checkpoint(pack_info16, "Test Operator", fx16["repo_root"])
checkpoint16["decisions"] = all_decisions_for(pack_info16, use_negative=True)
checkpoint16 = tool.save_checkpoint(ckpt16_path, checkpoint16)
result16 = tool.finalize(fx16["pack_path"], checkpoint16, fx16["repo_root"])
check("16 an all-negative-verdict run (with required notes) finalises cleanly",
      result16["doc"]["totals"]["overall"] == 83
      and all(r["operator_notes"] for r in result16["doc"]["rows"]))

try:
    bad_checkpoint = tool.new_checkpoint(pack_info16, "Test Operator", fx16["repo_root"])
    bad_checkpoint["decisions"] = all_decisions_for(pack_info16, use_negative=True)
    first_key = next(iter(bad_checkpoint["decisions"]))
    bad_checkpoint["decisions"][first_key]["operator_notes"] = ""
    tool.finalize(fx16["pack_path"], bad_checkpoint, fx16["repo_root"])
    missing_notes_ok = True
except tool.ToolError:
    missing_notes_ok = False
check("17 finalisation is refused when a required-notes verdict has blank notes", not missing_notes_ok)

# ---------------------------------------------------------------------------
# 18. Verdict-selection invariants (GUI-independent: the underlying decision model behind
# the combobox verdict control -- fresh/blank state, single active value, independent
# per-row restoration, and clear/re-decide accounting)
# ---------------------------------------------------------------------------

check("18a PLACEHOLDER_VERDICT is not a valid verdict for any group",
      all(tool.PLACEHOLDER_VERDICT not in spec["allowed_verdicts"]
          for spec in tool.SECTION_SPECS.values()))

fresh_checkpoint18 = tool.new_checkpoint(pack_info1, "", fx1["repo_root"])
check("18b a fresh checkpoint has no decisions (blank verdict for every row)",
      fresh_checkpoint18["decisions"] == {})
check("18c decided_count is 0 for a fresh checkpoint (no default verdict)",
      tool.decided_count(pack_info1, fresh_checkpoint18) == 0)

try:
    tool.validate_decision("audit", tool.PLACEHOLDER_VERDICT, "")
    placeholder_rejected = False
except tool.ToolError:
    placeholder_rejected = True
check("18d the placeholder value is rejected as a stored verdict", placeholder_rejected)

nav_checkpoint = tool.new_checkpoint(pack_info1, "Test Operator", fx1["repo_root"])
row_a, row_b = pack_info1["rows"][0], pack_info1["rows"][1]
nav_checkpoint["decisions"][row_a["row_id"]] = {
    "group": row_a["group"], "row_ordinal_in_group": row_a["row_ordinal_in_group"],
    "global_order": row_a["global_order"], "draftguru_url": row_a["draftguru_url"],
    "operator_verdict": "same_person_valid_relisting", "operator_notes": "",
    "decided_utc": "2026-09-18T00:00:00Z",
}
nav_checkpoint["decisions"][row_b["row_id"]] = {
    "group": row_b["group"], "row_ordinal_in_group": row_b["row_ordinal_in_group"],
    "global_order": row_b["global_order"], "draftguru_url": row_b["draftguru_url"],
    "operator_verdict": "different_person_wrong_href", "operator_notes": "distinct from row A",
    "decided_utc": "2026-09-18T00:00:00Z",
}
check("18e navigating rows restores each row's own distinct, independently held verdict",
      nav_checkpoint["decisions"][row_a["row_id"]]["operator_verdict"] == "same_person_valid_relisting"
      and nav_checkpoint["decisions"][row_b["row_id"]]["operator_verdict"] == "different_person_wrong_href")

clear_checkpoint = tool.new_checkpoint(pack_info1, "Test Operator", fx1["repo_root"])
clear_checkpoint["decisions"][row_a["row_id"]] = {
    "group": row_a["group"], "row_ordinal_in_group": row_a["row_ordinal_in_group"],
    "global_order": row_a["global_order"], "draftguru_url": row_a["draftguru_url"],
    "operator_verdict": "same_person_valid_relisting", "operator_notes": "",
    "decided_utc": "2026-09-18T00:00:00Z",
}
before_clear = tool.decided_count(pack_info1, clear_checkpoint)
clear_checkpoint["decisions"][row_a["row_id"]]["operator_verdict"] = ""
after_clear = tool.decided_count(pack_info1, clear_checkpoint)
clear_checkpoint["decisions"][row_a["row_id"]]["operator_verdict"] = "undetermined_withhold"
clear_checkpoint["decisions"][row_a["row_id"]]["operator_notes"] = "cleared and re-decided"
after_redecide = tool.decided_count(pack_info1, clear_checkpoint)
check("18f clearing a verdict drops decided_count, re-deciding counts it exactly once",
      before_clear == 1 and after_clear == 0 and after_redecide == 1,
      f"before={before_clear} after_clear={after_clear} after_redecide={after_redecide}")

check("18g VERDICT_MEANINGS covers every allowed verdict for every group",
      all(v in tool.VERDICT_MEANINGS.get(g, {})
          for g, spec in tool.SECTION_SPECS.items() for v in spec["allowed_verdicts"]))

# ---------------------------------------------------------------------------
# 19. README coverage
# ---------------------------------------------------------------------------

readme_path = TOOL_DIR / "README.md"
readme_exists = readme_path.is_file()
check("19a tools/rebuild/draftguru/README.md exists", readme_exists)
readme_text = readme_path.read_text(encoding="utf-8") if readme_exists else ""
check("19b README documents the exact launch command",
      readme_exists and "review_bridge_operator.py" in readme_text and "--validate-only" in readme_text)
check("19c README documents verdict meanings",
      readme_exists and "same_person_valid_relisting" in readme_text
      and "undetermined_withhold" in readme_text)
check("19d README documents checkpoint/resume behaviour",
      readme_exists and "checkpoint" in readme_text.lower() and "resum" in readme_text.lower())
check("19e README documents finalisation behaviour",
      readme_exists and "Finalis" in readme_text
      and "bridge-operator-verdicts-20260918-v1.json" in readme_text)
check("19f README documents the event-club-appearance-relationship values",
      readme_exists and all(
          v in readme_text for v in tool.EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES
      ))
check("19g README documents the --migrate-checkpoint-only flag",
      readme_exists and "--migrate-checkpoint-only" in readme_text)

# ---------------------------------------------------------------------------
# 20. Event-club appearance relationship -- derivation (usability/data clarification follow-up,
# 2026-09-18). Direct unit checks against derive_event_club_appearance_relationship: every named
# scenario from the follow-up request, using only the fields the pack itself ever carries.
# ---------------------------------------------------------------------------

check("20a drafted but never played for the club -> no_senior_appearance_ever",
      tool.derive_event_club_appearance_relationship(raw_fields(
          event_club="North Melbourne", event_year=1990,
          retained_clubs=["Essendon"], career_start=1991, career_end=1995,
      )) == "no_senior_appearance_ever")

check("20b played before a same-club re-draft but not afterward -> pre_event_only",
      tool.derive_event_club_appearance_relationship(raw_fields(
          event_club="Essendon", event_year=1990,
          retained_clubs=["Essendon"], career_start=1985, career_end=1988,
      )) == "pre_event_only")

check("20c played both before and after re-listing (event year strictly within the whole "
      "career span) -> unknown -- the pack carries no per-club season breakdown to localise it",
      tool.derive_event_club_appearance_relationship(raw_fields(
          event_club="Essendon", event_year=1990,
          retained_clubs=["Essendon"], career_start=1985, career_end=1995,
      )) == "unknown")

check("20d first senior appearance after drafting -> post_event_appearance",
      tool.derive_event_club_appearance_relationship(raw_fields(
          event_club="Carlton", event_year=1990,
          retained_clubs=["Carlton"], career_start=1991, career_end=1998,
      )) == "post_event_appearance")

check("20e different event club, absent from every retained club -> no_senior_appearance_ever",
      tool.derive_event_club_appearance_relationship(raw_fields(
          event_club="Richmond", event_year=1990,
          retained_clubs=["Geelong", "Hawthorn"], career_start=1985, career_end=1995,
      )) == "no_senior_appearance_ever")

check("20f missing event year -> not_applicable (no meaningful comparison exists)",
      tool.derive_event_club_appearance_relationship(raw_fields(
          event_club="Richmond", retained_clubs=["Richmond"], career_start=1985, career_end=1990,
      )) == "not_applicable")

check("20g missing event club (e.g. tokenisation/discrepancy rows) -> not_applicable",
      tool.derive_event_club_appearance_relationship(raw_fields(
          event_year=1990, retained_clubs=["Richmond"], career_start=1985, career_end=1990,
      )) == "not_applicable")

check("20h missing club evidence -- retained clubs absent -> unknown, not guessed",
      tool.derive_event_club_appearance_relationship(raw_fields(
          event_club="Richmond", event_year=1990,
      )) == "unknown")

check("20i missing/ambiguous event timing -- career bounds absent -> unknown",
      tool.derive_event_club_appearance_relationship(raw_fields(
          event_club="Richmond", event_year=1990, retained_clubs=["Richmond"],
      )) == "unknown")

check("20j draft-year vs effective-season boundary: a career starting in the SAME calendar "
      "year as the event is never inferred as post_event_appearance (no destination-season "
      "'+1' assumption -- that exact heuristic is a forbidden mechanism one layer up in this "
      "same DraftGuru contract) -> unknown",
      tool.derive_event_club_appearance_relationship(raw_fields(
          event_club="Richmond", event_year=1990,
          retained_clubs=["Richmond"], career_start=1990, career_end=1995,
      )) == "unknown")

check("20k a career ending exactly in the event year resolves to pre_event_only (inclusive "
      "bound, matching this tool's own relisting-signature section's own defining criterion)",
      tool.derive_event_club_appearance_relationship(raw_fields(
          event_club="Richmond", event_year=1990,
          retained_clubs=["Richmond"], career_start=1985, career_end=1990,
      )) == "pre_event_only")

check("20l club alias: 'Kangaroos' event club matches retained 'North Melbourne' (same-"
      "organization rename) -> pre_event_only, not no_senior_appearance_ever",
      tool.derive_event_club_appearance_relationship(raw_fields(
          event_club="Kangaroos", event_year=1990,
          retained_clubs=["North Melbourne"], career_start=1985, career_end=1988,
      )) == "pre_event_only")

check("20m club merger is never aliased: 'Fitzroy' against retained 'Brisbane Lions' alone "
      "-> no_senior_appearance_ever (a merger is a different organization, per "
      "src/lib/player-matching/club-identity.ts)",
      tool.derive_event_club_appearance_relationship(raw_fields(
          event_club="Fitzroy", event_year=1996,
          retained_clubs=["Brisbane Lions"], career_start=1997, career_end=2000,
      )) == "no_senior_appearance_ever")

# ---------------------------------------------------------------------------
# 21. Event-club appearance relationship -- prominent explanatory messages
# ---------------------------------------------------------------------------

check("21a no_senior_appearance_ever message names the event club",
      tool.event_club_appearance_message(raw_fields(
          event_club="North Melbourne", event_year=1990, retained_clubs=["Essendon"],
          career_start=1991, career_end=1995,
      )) == "Never played a senior game for North Melbourne.")

check("21b pre_event_only message names the club and event year, and states no appearance after",
      tool.event_club_appearance_message(raw_fields(
          event_club="Essendon", event_year=1990, retained_clubs=["Essendon"],
          career_start=1985, career_end=1988,
      )) == "Played for Essendon before this 1990 listing, but made no senior appearance for "
           "Essendon after it.")

check("21c post_event_appearance message names the club and event year",
      tool.event_club_appearance_message(raw_fields(
          event_club="Carlton", event_year=1990, retained_clubs=["Carlton"],
          career_start=1991, career_end=1998,
      )) == "Played for Carlton after this 1990 listing event.")

unknown_message = tool.event_club_appearance_message(raw_fields(
    event_club="Essendon", event_year=1990, retained_clubs=["Essendon"],
    career_start=1985, career_end=1995,
))
check("21d unknown message honestly states the evidence cannot establish the relationship",
      unknown_message is not None and "cannot establish" in unknown_message)

check("21e not_applicable carries no message",
      tool.event_club_appearance_message(
          raw_fields(event_year=1990, retained_clubs=["Richmond"])
      ) is None)

# ---------------------------------------------------------------------------
# 22. Acknowledgement requirement -- identity verdict remains independent
# ---------------------------------------------------------------------------

no_appearance_raw = raw_fields(
    event_club="North Melbourne", event_year=1990, retained_clubs=["Essendon"],
    career_start=1991, career_end=1995,
)
pre_event_raw = raw_fields(
    event_club="Essendon", event_year=1990, retained_clubs=["Essendon"],
    career_start=1985, career_end=1988,
)
post_event_raw = raw_fields(
    event_club="Carlton", event_year=1990, retained_clubs=["Carlton"],
    career_start=1991, career_end=1998,
)

check("22a acknowledgement required: same-person verdict + no_senior_appearance_ever",
      tool.event_club_observation_required_for(
          mock_row("relisting", no_appearance_raw), "same_person_valid_relisting"
      ))
check("22b acknowledgement required: same-person verdict + pre_event_only",
      tool.event_club_observation_required_for(
          mock_row("relisting", pre_event_raw), "same_person_valid_relisting"
      ))
check("22c acknowledgement NOT required for post_event_appearance, even on a same-person "
      "verdict (the ordinary case of a player going on to play)",
      not tool.event_club_observation_required_for(
          mock_row("relisting", post_event_raw), "same_person_valid_relisting"
      ))
check("22d acknowledgement NOT required for a non-same-person verdict, even with a "
      "no_senior_appearance_ever derivation -- the identity verdict stays independent",
      not tool.event_club_observation_required_for(
          mock_row("relisting", no_appearance_raw), "different_person_wrong_href"
      ))
check("22e acknowledgement NOT required with no verdict recorded at all",
      not tool.event_club_observation_required_for(mock_row("relisting", no_appearance_raw), ""))

# End-to-end: a relisted player correctly deriving 'pre_event_only' still correctly receives
# 'same_person_valid_relisting', and questioning the derived observation (a different value,
# with notes) never changes that verdict.
target_row22 = next(r for r in pack_info1["rows"] if r["group"] == "relisting" and r["row_ordinal_in_group"] == 2)
check("22f fixture sanity: row 2 derives pre_event_only",
      tool.derive_event_club_appearance_relationship(target_row22["raw"]) == "pre_event_only")

independence_checkpoint = tool.new_checkpoint(pack_info1, "Test Operator", fx1["repo_root"])
independence_checkpoint["decisions"] = all_decisions_for(pack_info1)
independence_checkpoint["decisions"][target_row22["row_id"]]["operator_verdict"] = "same_person_valid_relisting"
independence_checkpoint["decisions"][target_row22["row_id"]]["event_club_observation"] = "unknown"
independence_checkpoint["decisions"][target_row22["row_id"]]["event_club_observation_notes"] = (
    "operator questions the derived suggestion, see evidence Y"
)
doc22 = tool.build_final_document(pack_info1, independence_checkpoint, fx1["repo_root"])
out_row22 = next(r for r in doc22["rows"] if r["draftguru_url"] == target_row22["draftguru_url"])
check("22g questioning the derived club-appearance observation never changes the identity "
      "verdict, and the derived value is retained alongside the operator's own",
      out_row22["operator_verdict"] == "same_person_valid_relisting"
      and out_row22["event_club_observation"] == "unknown"
      and out_row22["event_club_appearance_relationship_derived"] == "pre_event_only")

# ---------------------------------------------------------------------------
# 23. Finalisation blocks ONLY when a required acknowledgement is genuinely missing
# ---------------------------------------------------------------------------

tmp23 = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-"))
fx23 = write_fixture_repo(tmp23)
pack_info23 = tool.load_and_validate_pack(fx23["pack_path"], fx23["repo_root"])
checkpoint23 = tool.new_checkpoint(pack_info23, "Test Operator", fx23["repo_root"])
checkpoint23["decisions"] = all_decisions_for(pack_info23)

target_row23 = next(
    r for r in pack_info23["rows"] if r["group"] == "relisting" and r["row_ordinal_in_group"] == 2
)
check("23a fixture sanity: row 2's acknowledgement is required for the positive verdict",
      tool.event_club_observation_required_for(target_row23, "same_person_valid_relisting"))

del checkpoint23["decisions"][target_row23["row_id"]]["event_club_observation"]
del checkpoint23["decisions"][target_row23["row_id"]]["event_club_observation_notes"]

check("23b decided_count excludes a row missing only its required club-observation "
      "acknowledgement, with everything else in the pack complete",
      tool.decided_count(pack_info23, checkpoint23) == tool.EXPECTED_TOTAL_ROWS - 1)

try:
    tool.build_final_document(pack_info23, checkpoint23, fx23["repo_root"])
    blocked23 = False
except tool.ToolError as exc:
    blocked23 = "event_club_observation acknowledgement" in str(exc)
check("23c finalisation is refused when only the club-observation acknowledgement is missing "
      "-- the identity verdict itself is complete and valid", blocked23)

checkpoint23["decisions"][target_row23["row_id"]]["event_club_observation"] = "pre_event_only"
checkpoint23["decisions"][target_row23["row_id"]]["event_club_observation_notes"] = ""
checkpoint23["decisions"][target_row23["row_id"]]["event_club_observation_decided_utc"] = "2026-09-18T00:00:00Z"
doc23 = tool.build_final_document(pack_info23, checkpoint23, fx23["repo_root"])
check("23d finalisation succeeds once the required acknowledgement is recorded",
      doc23["totals"]["overall"] == tool.EXPECTED_TOTAL_ROWS)

row1_23 = next(
    r for r in pack_info23["rows"] if r["group"] == "relisting" and r["row_ordinal_in_group"] == 1
)
check("23e a row whose derivation needs no acknowledgement (post_event_appearance) never "
      "carries an event_club_observation key and never blocks finalisation",
      "event_club_observation" not in checkpoint23["decisions"][row1_23["row_id"]])

# ---------------------------------------------------------------------------
# 24. Checkpoint schema migration (v1 -> v2, additive) -- preserves every pre-existing decision
# exactly, backs up the pre-migration file, and refuses on a pack-hash mismatch or an
# unrecognised future schema.
# ---------------------------------------------------------------------------

tmp24 = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-"))
fx24 = write_fixture_repo(tmp24)
pack_info24 = tool.load_and_validate_pack(fx24["pack_path"], fx24["repo_root"])
ckpt24_path = tmp24 / "progress.json"

# Shape matches the REAL pre-migration operator checkpoint exactly: 11 relisting decisions,
# schema_version 1, no event_club_observation keys, no "migrations" key at all.
first_11 = [r for r in pack_info24["rows"] if r["group"] == "relisting"][:11]
v1_decisions = {
    row["row_id"]: {
        "group": row["group"],
        "row_ordinal_in_group": row["row_ordinal_in_group"],
        "global_order": row["global_order"],
        "draftguru_url": row["draftguru_url"],
        "operator_verdict": "same_person_valid_relisting",
        "operator_notes": f"pre-existing note {idx}",
        "decided_utc": f"2026-09-18T05:{30 + idx:02d}:00Z",
    }
    for idx, row in enumerate(first_11, start=1)
}
v1_checkpoint = {
    "schema_version": 1,
    "tool": {"path": tool.TOOL, "version": "1.0.0"},
    "source_pack_path": tool.repo_relative(pack_info24["pack_path"], fx24["repo_root"]),
    "source_pack_sha256": pack_info24["pack_sha256"],
    "operator_display_name": "Stu",
    "review_started_utc": "2026-09-18T05:19:18Z",
    "last_saved_utc": "2026-09-18T05:56:04Z",
    "finalized": False,
    "finalized_utc": None,
    "decisions": v1_decisions,
    "bulk_actions_log": [],
}
v1_bytes_before = tool.dump_json_lf(v1_checkpoint)
tool.atomic_write_bytes(ckpt24_path, v1_bytes_before)

paths24 = {"progress": ckpt24_path, "lock": tmp24 / "review.lock"}
migrated24 = tool.load_or_migrate_checkpoint(paths24, pack_info24)

check("24a migration bumps schema_version to the current version",
      migrated24["schema_version"] == tool.CHECKPOINT_SCHEMA_VERSION)
check("24b all 11 pre-existing decisions survive with an identical verdict, notes, "
      "decided_utc, row_ordinal_in_group, global_order and draftguru_url",
      len(migrated24["decisions"]) == 11 and all(
          migrated24["decisions"][rid]["operator_verdict"] == v1_decisions[rid]["operator_verdict"]
          and migrated24["decisions"][rid]["operator_notes"] == v1_decisions[rid]["operator_notes"]
          and migrated24["decisions"][rid]["decided_utc"] == v1_decisions[rid]["decided_utc"]
          and migrated24["decisions"][rid]["row_ordinal_in_group"] == v1_decisions[rid]["row_ordinal_in_group"]
          and migrated24["decisions"][rid]["global_order"] == v1_decisions[rid]["global_order"]
          and migrated24["decisions"][rid]["draftguru_url"] == v1_decisions[rid]["draftguru_url"]
          for rid in v1_decisions
      ))
check("24c migration adds a blank event_club_observation (and notes/decided_utc) to every "
      "pre-existing decision -- additive only, nothing cleared",
      all(
          migrated24["decisions"][rid].get("event_club_observation") == ""
          and migrated24["decisions"][rid].get("event_club_observation_notes") == ""
          and migrated24["decisions"][rid].get("event_club_observation_decided_utc") is None
          for rid in v1_decisions
      ))
check("24d migration records exactly one migration entry, schema 1 -> current",
      len(migrated24.get("migrations", [])) == 1
      and migrated24["migrations"][0]["from_schema_version"] == 1
      and migrated24["migrations"][0]["to_schema_version"] == tool.CHECKPOINT_SCHEMA_VERSION)

backups24 = list(ckpt24_path.parent.glob("progress.pre-migration-*.json"))
check("24e a pre-migration backup file was written", len(backups24) == 1, str(backups24))
check("24f the backup is byte-identical to the pre-migration checkpoint",
      bool(backups24) and backups24[0].read_bytes() == v1_bytes_before)

migrated24_again = tool.load_or_migrate_checkpoint(paths24, pack_info24)
check("24g re-loading an already-migrated checkpoint is a no-op (no second migration entry)",
      len(migrated24_again.get("migrations", [])) == 1)
check("24h re-loading an already-migrated checkpoint writes no second backup",
      len(list(ckpt24_path.parent.glob("progress.pre-migration-*.json"))) == 1)

# Refusal: a source-pack/checkpoint hash mismatch refuses the migration outright.
tmp24b = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-"))
fx24b = write_fixture_repo(tmp24b)
pack_info24b = tool.load_and_validate_pack(fx24b["pack_path"], fx24b["repo_root"])
ckpt24b_path = tmp24b / "progress.json"
mismatched_v1 = dict(v1_checkpoint)
mismatched_v1["source_pack_sha256"] = "0" * 64
mismatched_v1["decisions"] = {}
tool.atomic_write_bytes(ckpt24b_path, tool.dump_json_lf(mismatched_v1))
try:
    tool.load_or_migrate_checkpoint({"progress": ckpt24b_path, "lock": tmp24b / "review.lock"}, pack_info24b)
    mismatch_refused = False
except tool.ToolError as exc:
    mismatch_refused = "different source pack" in str(exc)
check("24i migration is refused outright on a source-pack/checkpoint hash mismatch", mismatch_refused)
check("24j no backup is written when the migration is refused on a hash mismatch",
      list(ckpt24b_path.parent.glob("progress.pre-migration-*.json")) == [])

# Refusal: an unrecognised future schema_version is never guessed at.
tmp24c = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-"))
fx24c = write_fixture_repo(tmp24c)
pack_info24c = tool.load_and_validate_pack(fx24c["pack_path"], fx24c["repo_root"])
ckpt24c_path = tmp24c / "progress.json"
future_checkpoint = dict(v1_checkpoint)
future_checkpoint["schema_version"] = 999
future_checkpoint["source_pack_sha256"] = pack_info24c["pack_sha256"]
future_checkpoint["decisions"] = {}
tool.atomic_write_bytes(ckpt24c_path, tool.dump_json_lf(future_checkpoint))
try:
    tool.load_or_migrate_checkpoint({"progress": ckpt24c_path, "lock": tmp24c / "review.lock"}, pack_info24c)
    future_refused = False
except tool.ToolError as exc:
    future_refused = "not recognised" in str(exc)
check("24k an unrecognised checkpoint schema_version is refused, not guessed at", future_refused)

# ---------------------------------------------------------------------------
# 25. Evidence-link URL construction and validation (usability correction, 2026-09-18). Pure
# string construction / validation -- no network request, no browser, nothing opened.
# ---------------------------------------------------------------------------

check("25a build_afltables_url constructs the exact full URL from a relative href "
      "(the example given in the usability-correction request)",
      tool.build_afltables_url("players/A/Andrew_Krakouer0.html")
      == "https://afltables.com/afl/stats/players/A/Andrew_Krakouer0.html")

check("25b build_afltables_url passes an already-absolute afltables.com URL through unchanged",
      tool.build_afltables_url("https://afltables.com/afl/stats/players/A/Andrew_Krakouer0.html")
      == "https://afltables.com/afl/stats/players/A/Andrew_Krakouer0.html")

check("25c build_afltables_url accepts the www subdomain",
      tool.build_afltables_url("https://www.afltables.com/afl/stats/players/A/X.html")
      == "https://www.afltables.com/afl/stats/players/A/X.html")

try:
    tool.build_afltables_url("")
    empty_href_ok = True
except tool.ToolError:
    empty_href_ok = False
check("25d build_afltables_url refuses an empty/missing href", not empty_href_ok)

wrong_host_ok, wrong_host_msg = True, ""
try:
    tool.build_afltables_url("https://evil.example.com/players/A/X.html")
except tool.ToolError as exc:
    wrong_host_ok = False
    wrong_host_msg = str(exc)
check("25e build_afltables_url refuses an absolute href on an unexpected host",
      not wrong_host_ok and "unexpected host" in wrong_host_msg)

bad_scheme_ok, bad_scheme_msg = True, ""
try:
    tool.validate_evidence_url("javascript:alert(1)", tool.AFLTABLES_ALLOWED_HOSTS)
except tool.ToolError as exc:
    bad_scheme_ok = False
    bad_scheme_msg = str(exc)
check("25f validate_evidence_url refuses a non-http(s) scheme",
      not bad_scheme_ok and "scheme" in bad_scheme_msg)

check("25g validate_evidence_url accepts the real DraftGuru host",
      tool.validate_evidence_url(
          "https://www.draftguru.com.au/players/andrew_krakouer/1", tool.DRAFTGURU_ALLOWED_HOSTS
      ) is None)

try:
    tool.validate_evidence_url("https://www.draftguru.com.au/players/x/1", tool.AFLTABLES_ALLOWED_HOSTS)
    cross_host_ok = True
except tool.ToolError:
    cross_host_ok = False
check("25h validate_evidence_url refuses a DraftGuru URL against the AFL Tables allow-list "
      "(hosts are never interchangeable)", not cross_host_ok)

links25 = tool.evidence_links_for(pack_info1["rows"][0])
check("25i evidence_links_for builds both URLs for a real fixture row, error fields blank",
      links25["draftguru_url"] is not None and links25["afltables_url"] is not None
      and links25["draftguru_error"] is None and links25["afltables_error"] is None)

no_href_row = copy.deepcopy(pack_info1["rows"][0])
no_href_row["raw"] = dict(no_href_row["raw"])
no_href_row["raw"]["draftguru_url"] = ""
no_href_row["raw"]["captured_afltables_href"] = ""
links25b = tool.evidence_links_for(no_href_row)
check("25j evidence_links_for reports errors (never raises) for a row with missing links",
      links25b["draftguru_url"] is None and links25b["afltables_url"] is None
      and links25b["draftguru_error"] is not None and links25b["afltables_error"] is not None)

# ---------------------------------------------------------------------------
# 26. open_evidence_url -- browser opening only in direct response to an explicit call, always
# mocked here; a failure (bad host/scheme, or the opener itself failing) never raises and never
# touches any checkpoint state (this function accepts no checkpoint at all).
# ---------------------------------------------------------------------------

calls26: list[str] = []


def mock_opener_ok(url: str) -> bool:
    calls26.append(url)
    return True


result26a = tool.open_evidence_url(
    "https://afltables.com/afl/stats/players/A/Andrew_Krakouer0.html",
    tool.AFLTABLES_ALLOWED_HOSTS, opener=mock_opener_ok,
)
check("26a a valid URL calls the (mocked) opener exactly once and reports ok",
      result26a["ok"] is True and calls26 == ["https://afltables.com/afl/stats/players/A/Andrew_Krakouer0.html"])

calls26b: list[str] = []
result26b = tool.open_evidence_url(
    "https://evil.example.com/x", tool.AFLTABLES_ALLOWED_HOSTS,
    opener=lambda u: calls26b.append(u) or True,
)
check("26b an unexpected-host URL is refused WITHOUT ever invoking the opener",
      result26b["ok"] is False and calls26b == [] and "unexpected host" in (result26b["error"] or ""))

calls26c: list[str] = []
result26c = tool.open_evidence_url(
    "ftp://afltables.com/x", tool.AFLTABLES_ALLOWED_HOSTS,
    opener=lambda u: calls26c.append(u) or True,
)
check("26c an unexpected scheme is refused WITHOUT ever invoking the opener",
      result26c["ok"] is False and calls26c == [])


def mock_opener_raises(url: str) -> bool:
    raise OSError("no browser available on this platform")


result26d = tool.open_evidence_url(
    "https://afltables.com/afl/stats/players/A/X.html", tool.AFLTABLES_ALLOWED_HOSTS,
    opener=mock_opener_raises,
)
check("26d a browser-launch failure is caught and reported, never raised",
      result26d["ok"] is False and "no browser available" in (result26d["error"] or ""))

calls26e: list[str] = []
result26e = tool.open_evidence_url(None, tool.DRAFTGURU_ALLOWED_HOSTS,
                                    opener=lambda u: calls26e.append(u) or True)
check("26e a missing URL is refused WITHOUT ever invoking the opener",
      result26e["ok"] is False and calls26e == [])

check("26f a failed browser launch carries no checkpoint reference at all -- open_evidence_url "
      "takes no checkpoint argument, so it structurally cannot alter one",
      "checkpoint" not in tool.open_evidence_url.__code__.co_varnames)

# ---------------------------------------------------------------------------
# 27. Friendly-label maps -- exact coverage and round-trip to the stable stored codes; the
# checkpoint/final-artefact schema is untouched by any of this (still only stored codes).
# ---------------------------------------------------------------------------

check("27a VERDICT_FRIENDLY_LABELS covers exactly SECTION_SPECS' allowed_verdicts, per group",
      all(
          set(tool.VERDICT_FRIENDLY_LABELS[g]) == set(spec["allowed_verdicts"])
          for g, spec in tool.SECTION_SPECS.items()
      ))

check("27b every friendly label round-trips through VERDICT_CODE_BY_LABEL back to its own code",
      all(
          tool.VERDICT_CODE_BY_LABEL[g][label] == code
          for g, labels in tool.VERDICT_FRIENDLY_LABELS.items()
          for code, label in labels.items()
      ))

check("27c relisting friendly labels use the exact wording requested by the operator",
      tool.VERDICT_FRIENDLY_LABELS["relisting"]["same_person_valid_relisting"]
      == "Same player — valid re-draft or re-listing"
      and tool.VERDICT_FRIENDLY_LABELS["relisting"]["different_person_wrong_href"]
      == "Different player — captured AFL Tables link is wrong"
      and tool.VERDICT_FRIENDLY_LABELS["relisting"]["undetermined_withhold"]
      == "Unable to determine — withhold this link")

check("27d EVENT_CLUB_OBSERVATION_FRIENDLY_LABELS covers exactly the five stored relationship "
      "values",
      set(tool.EVENT_CLUB_OBSERVATION_FRIENDLY_LABELS) == set(tool.EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES))

check("27e every event-club friendly label round-trips through EVENT_CLUB_OBSERVATION_CODE_BY_LABEL",
      all(
          tool.EVENT_CLUB_OBSERVATION_CODE_BY_LABEL[label] == code
          for code, label in tool.EVENT_CLUB_OBSERVATION_FRIENDLY_LABELS.items()
      ))

check("27f the checkpoint/final-output schema is untouched by the friendly-label correction: "
      "CHECKPOINT_SCHEMA_VERSION and SCHEMA_VERSION are unchanged from the prior release",
      tool.CHECKPOINT_SCHEMA_VERSION == 2 and tool.SCHEMA_VERSION == 1)

# ---------------------------------------------------------------------------
# 28. Explicit acknowledgement workflow (GUI-independent model): confirming the suggestion
# stores exactly the derived value with no notes; choosing a different relationship requires
# notes; a fresh row's observation is never preselected regardless of the derived value.
# ---------------------------------------------------------------------------

confirm_row = next(
    r for r in pack_info1["rows"] if r["group"] == "relisting" and r["row_ordinal_in_group"] == 2
)
confirm_derived = tool.derive_event_club_appearance_relationship(confirm_row["raw"])
check("28a fixture sanity: the row used below derives pre_event_only",
      confirm_derived == "pre_event_only")

# Simulates clicking "Confirm suggested relationship": commits the derived value verbatim,
# with empty notes, and it must validate cleanly (no notes required to CONFIRM the suggestion).
tool.validate_event_club_observation(confirm_derived, confirm_derived, "")
check("28b confirming the suggested relationship (value == derived, notes == '') validates cleanly",
      True)

# Simulates clicking "Choose a different relationship" and saving without notes: refused.
try:
    tool.validate_event_club_observation("post_event_appearance", confirm_derived, "")
    choose_different_no_notes_ok = True
except tool.ToolError:
    choose_different_no_notes_ok = False
check("28c choosing a different relationship WITHOUT notes is refused", not choose_different_no_notes_ok)

# Simulates the same, but with notes supplied: succeeds.
tool.validate_event_club_observation(
    "post_event_appearance", confirm_derived, "operator has independent evidence of a later game"
)
check("28d choosing a different relationship WITH notes validates cleanly", True)

fresh_checkpoint28 = tool.new_checkpoint(pack_info1, "Test Operator", fx1["repo_root"])
check("28e a freshly created row entry (no decision at all yet) carries no event_club_observation "
      "-- never preselected regardless of what the row would derive",
      fresh_checkpoint28["decisions"].get(confirm_row["row_id"]) is None)

# ---------------------------------------------------------------------------
# 29. Separate identity-verdict / club-acknowledgement / fully-completed counts -- reproduces
# the exact real-world shape that motivated this correction: 11 identity verdicts entered, but
# only the rows whose derivation needs no acknowledgement (or which have one recorded) are fully
# complete. Built on the SAME v1-shaped, 11-decision checkpoint as check 24 (no
# event_club_observation recorded on any of them yet).
# ---------------------------------------------------------------------------

check("29a identity_verdict_entered_count counts all 11 pre-existing verdicts, regardless of "
      "any outstanding club-observation acknowledgement",
      tool.identity_verdict_entered_count(pack_info24, migrated24) == 11)

# Fixture rows 1..11 (see make_relisting_row): row 1 derives post_event_appearance (no
# acknowledgement ever required); rows 2..11 derive pre_event_only or no_senior_appearance_ever
# (acknowledgement required for a same-person verdict) and none of the 11 fixture decisions
# carry event_club_observation, so exactly 1 of the 11 is fully complete and the other 10 still
# need a club-observation acknowledgement.
check("29b decided_count (fully completed) is 1 of the 11 -- only the row needing no "
      "acknowledgement -- reproducing the real '11 entered, 1 complete' shape",
      tool.decided_count(pack_info24, migrated24) == 1)
check("29c club_acknowledgement_required_count is exactly the other 10",
      tool.club_acknowledgement_required_count(pack_info24, migrated24) == 10)
check("29d the three counters are genuinely independent: entered != fully-completed here, and "
      "entered == fully-completed + still-required",
      tool.identity_verdict_entered_count(pack_info24, migrated24)
      != tool.decided_count(pack_info24, migrated24)
      and tool.identity_verdict_entered_count(pack_info24, migrated24)
      == tool.decided_count(pack_info24, migrated24)
      + tool.club_acknowledgement_required_count(pack_info24, migrated24))

# Now simulate an explicit "Confirm suggested relationship" click on one of the 10 outstanding
# rows and show the counters move exactly as expected -- entered stays the same, required drops
# by one, fully-completed rises by one.
target_row29 = next(
    r for r in pack_info24["rows"] if r["group"] == "relisting" and r["row_ordinal_in_group"] == 2
)
derived29 = tool.derive_event_club_appearance_relationship(target_row29["raw"])
after_confirm29 = copy.deepcopy(migrated24)
after_confirm29["decisions"][target_row29["row_id"]]["event_club_observation"] = derived29
after_confirm29["decisions"][target_row29["row_id"]]["event_club_observation_notes"] = ""
after_confirm29["decisions"][target_row29["row_id"]]["event_club_observation_decided_utc"] = "2026-09-18T07:00:00Z"

check("29e after an explicit confirmation on one outstanding row: entered unchanged, "
      "fully-completed +1, still-required -1",
      tool.identity_verdict_entered_count(pack_info24, after_confirm29) == 11
      and tool.decided_count(pack_info24, after_confirm29) == 2
      and tool.club_acknowledgement_required_count(pack_info24, after_confirm29) == 9)

# ---------------------------------------------------------------------------
# 30. All 11 real-shaped identity verdicts survive migration unchanged (extends check 24 with
# the counters above) -- and Finalise's own gate (build_final_document) still requires every one
# of the 83 rows, including every required acknowledgement, exactly as before this correction.
# ---------------------------------------------------------------------------

finalize_11_of_83_ok, finalize_11_of_83_msg = True, ""
try:
    tool.build_final_document(pack_info24, migrated24, fx24["repo_root"])
except tool.ToolError as exc:
    finalize_11_of_83_ok = False
    finalize_11_of_83_msg = str(exc)
check("30a finalisation is still refused with only 11 of 83 rows decided (Finalise gating is "
      "unchanged by the usability correction)",
      not finalize_11_of_83_ok and "no operator decision yet" in finalize_11_of_83_msg)

# ---------------------------------------------------------------------------
# 31. Source adjudication pack remains byte-identical after every GUI-independent function in
# this correction has been exercised against it.
# ---------------------------------------------------------------------------

pack_sha_final = tool.sha256_file(fx1["pack_path"])
check("31 the source pack file is byte-identical after every link/label/counter check above "
      "(compared against its sha256 as recorded at load time in section 1)",
      pack_sha_final == pack_info1["pack_sha256"])

# ---------------------------------------------------------------------------
# 32. README coverage of the usability correction
# ---------------------------------------------------------------------------

readme_text_2 = (TOOL_DIR / "README.md").read_text(encoding="utf-8")
check("32a README documents the Open/Copy evidence-link buttons",
      "Open DraftGuru page" in readme_text_2 and "Open AFL Tables page" in readme_text_2
      and "Copy DraftGuru URL" in readme_text_2 and "Copy AFL Tables URL" in readme_text_2)
check("32b README documents the friendly verdict labels alongside their stored codes",
      "Same player -- valid re-draft or re-listing" in readme_text_2
      and "same_person_valid_relisting" in readme_text_2)
check("32c README documents the explicit confirm/choose-different workflow",
      "Confirm suggested relationship" in readme_text_2
      and "Choose a different relationship" in readme_text_2
      and "NOT YET CONFIRMED" in readme_text_2)
check("32d README documents the three separate progress counters",
      "Identity verdicts entered" in readme_text_2
      and "Club acknowledgements still required" in readme_text_2
      and "Fully completed rows" in readme_text_2)
check("32e README states that opening a link never records a decision, no option is "
      "preselected, and notes are required for a negative/uncertain/overridden choice",
      "opening a link never records a decision" in readme_text_2
      and "no option is preselected" in readme_text_2
      and "notes are required for a negative, uncertain or overridden choice" in readme_text_2)

# ---------------------------------------------------------------------------
# 33. Confirmed-vs-pending club-observation state (real-operator-session usability defect,
# 2026-09-18). club_observation_pending_state is a pure function of plain values -- no
# checkpoint, no widget, nothing mutated -- so it is fully testable here without Tkinter.
# ---------------------------------------------------------------------------

check("33a no pending change when nothing is selected in the combo (pending_code == '')",
      tool.club_observation_pending_state(
          "pre_event_only", "", "", "", derived="pre_event_only"
      )["has_pending"] is False)

check("33b re-selecting the SAME value/notes already persisted is never a pending change",
      tool.club_observation_pending_state(
          "pre_event_only", "", "pre_event_only", "", derived="pre_event_only"
      ) == {"has_pending": False, "is_valid": True, "error": None})

# Reproduces the exact real-operator-session shape found on the Andrew Krakouer row: persisted
# pre_event_only, an in-progress selection of post_event_appearance. With BLANK notes (the
# operator's own account of what they intended -- "no meaningful notes") this is correctly
# flagged pending AND invalid.
krakouer_pending_blank = tool.club_observation_pending_state(
    "pre_event_only", "", "post_event_appearance", "", derived="pre_event_only",
)
check("33c a differing pending selection with blank notes is pending and INVALID -- this is "
      "the case the operator believed had happened",
      krakouer_pending_blank == {
          "has_pending": True, "is_valid": False,
          "error": (
              "event_club_observation notes are required when the operator's observation "
              "differs from the derived suggestion"
          ),
      })

# What the real checkpoint actually recorded: notes "tr" (non-blank, so the EXISTING notes-
# required rule -- unchanged by this fix -- accepts it as a technically-valid, genuinely
# persisted save). This function only decides has_pending vs is_valid for the LIVE widget
# state; once "tr" was actually saved, the persisted value simply IS post_event_appearance and
# the Confirmed line honestly reflects that -- see 33d/33e below for the distinction this fix
# actually targets: a REFUSED (invalid) edit must never look confirmed, and a not-yet-saved
# valid edit must never look confirmed either.
krakouer_pending_short_notes = tool.club_observation_pending_state(
    "pre_event_only", "", "post_event_appearance", "tr", derived="pre_event_only",
)
check("33d a differing pending selection with SOME (even minimal) notes is pending but VALID "
      "-- would be accepted if Save is clicked, matching this tool's existing (unchanged) "
      "notes-required rule",
      krakouer_pending_short_notes == {"has_pending": True, "is_valid": True, "error": None})

check("33e a pending, valid, but NOT YET saved edit is never reported as confirmed -- "
      "has_pending is True until an explicit Save actually runs; the GUI's Confirmed line is "
      "wired to the checkpoint alone, never to this function's output",
      krakouer_pending_short_notes["has_pending"] is True)

check("33f validate_event_club_observation and club_observation_pending_state can never "
      "disagree about what Save would accept (same underlying rule, called the same way)",
      tool.club_observation_pending_state(
          "unknown", "", "post_event_appearance", "real justification here", derived="unknown",
      )["is_valid"] is True)

# ---------------------------------------------------------------------------
# 34. can_leave_row -- navigation/close/finalise gating; never mutates, never silently saves or
# discards.
# ---------------------------------------------------------------------------

check("34a no pending change -> may leave, no message",
      tool.can_leave_row({"has_pending": False, "is_valid": True, "error": None}) == (True, None))

check("34b invalid pending change -> refused with the exact required message",
      tool.can_leave_row({"has_pending": True, "is_valid": False, "error": "x"})
      == (False, tool.CANNOT_LEAVE_INVALID_MESSAGE)
      and tool.CANNOT_LEAVE_INVALID_MESSAGE
      == "Cannot leave this row until the invalid unsaved change is corrected or discarded.")

check("34c valid-but-unsaved pending change -> also refused (never silently saved on the "
      "operator's behalf), with a distinct message directing Save or Discard",
      tool.can_leave_row({"has_pending": True, "is_valid": True, "error": None})
      == (False, tool.CANNOT_LEAVE_UNSAVED_MESSAGE)
      and "Save observation" in tool.CANNOT_LEAVE_UNSAVED_MESSAGE
      and "Discard unsaved changes" in tool.CANNOT_LEAVE_UNSAVED_MESSAGE)

# ---------------------------------------------------------------------------
# 35. nav_button_states / next_cursor -- pure Previous/Next logic, independent of any Tkinter
# widget, covering every case the real bug report named.
# ---------------------------------------------------------------------------

check("35a Previous disabled, with the required status text, on the first displayed row",
      tool.nav_button_states([5, 12, 40], 5)
      == {"prev_enabled": False, "next_enabled": True, "status": "Already at the first displayed row."})

check("35b Next disabled, with the required status text, on the last displayed row",
      tool.nav_button_states([5, 12, 40], 40)
      == {"prev_enabled": True, "next_enabled": False, "status": "Already at the last displayed row."})

check("35c a middle displayed row has both enabled and no status text",
      tool.nav_button_states([5, 12, 40], 12)
      == {"prev_enabled": True, "next_enabled": True, "status": ""})

check("35d a single-row filtered result disables both, with a distinct status message",
      tool.nav_button_states([12], 12)
      == {"prev_enabled": False, "next_enabled": False, "status": "Only one row matches the current filters."})

try:
    tool.nav_button_states([5, 12, 40], 99)
    cursor_not_in_filtered_ok = True
except tool.ToolError:
    cursor_not_in_filtered_ok = False
check("35e a cursor outside the filtered set is refused rather than guessed at",
      not cursor_not_in_filtered_ok)

check("35f next_cursor respects the CURRENTLY DISPLAYED filtered order, not raw row indices "
      "(a non-contiguous filtered set: [5, 12, 40])",
      tool.next_cursor([5, 12, 40], 5, +1) == 12
      and tool.next_cursor([5, 12, 40], 12, +1) == 40)

check("35g next_cursor never advances past the last displayed row (defence in depth behind "
      "the disabled Next button)",
      tool.next_cursor([5, 12, 40], 40, +1) == 40)

check("35h Previous works correctly after navigating forward: forward then back returns to "
      "the original displayed row",
      tool.next_cursor([5, 12, 40], tool.next_cursor([5, 12, 40], 5, +1), -1) == 5)

check("35i next_cursor never retreats past the first displayed row (defence in depth behind "
      "the disabled Previous button)",
      tool.next_cursor([5, 12, 40], 5, -1) == 5)

# ---------------------------------------------------------------------------
# 36. Same-club re-drafting remains fully compatible with pre_event_only and with a
# same-person identity verdict -- the exact pattern from the Andrew L. Krakouer example (played
# for a club, delisted, re-drafted by the SAME club, no further senior games).
# ---------------------------------------------------------------------------

krakouer_raw = raw_fields(
    event_club="North Melbourne", event_year=1992,
    retained_clubs=["North Melbourne"], career_start=1989, career_end=1990,
)
check("36a the Krakouer-shaped pattern (same club, career ended before the re-draft year) "
      "derives pre_event_only, not no_senior_appearance_ever or any club-mismatch outcome",
      tool.derive_event_club_appearance_relationship(krakouer_raw) == "pre_event_only")

check("36b a same-person identity verdict is fully valid for this pattern -- validate_decision "
      "never considers club identity at all, so a same-club re-draft is never disqualified",
      tool.validate_decision("relisting", "same_person_valid_relisting", "") is None)

check("36c the acknowledgement requirement still applies (same-club re-draft is one of the two "
      "relationships needing explicit confirmation) -- this is by design, not a same-club-"
      "specific restriction",
      tool.event_club_observation_required_for(
          mock_row("relisting", krakouer_raw), "same_person_valid_relisting"
      ))

check("36d confirming the suggestion for this exact pattern persists pre_event_only cleanly",
      tool.validate_event_club_observation("pre_event_only", "pre_event_only", "") is None)

# ---------------------------------------------------------------------------
# 37. All 11 real identity verdicts, PLUS the Krakouer row's genuinely persisted (if
# subsequently corrected by the operator) club-observation acknowledgement, survive untouched
# by every pure function introduced in this fix -- none of them accept or require a checkpoint
# argument, so none of them CAN mutate one.
# ---------------------------------------------------------------------------

import inspect  # noqa: E402

for fn_name in (
    "club_observation_pending_state", "can_leave_row", "nav_button_states", "next_cursor",
):
    fn = getattr(tool, fn_name)
    params = list(inspect.signature(fn).parameters)
    check(f"37 {fn_name} takes no checkpoint/pack_info argument, so it structurally cannot "
          "mutate the real checkpoint or pack",
          "checkpoint" not in params and "pack_info" not in params)

real_shaped_decisions = dict(v1_decisions)  # from check 24 -- the real 11-row shape
real_shaped_decisions[first_11[0]["row_id"]] = {
    **real_shaped_decisions[first_11[0]["row_id"]],
    "event_club_observation": "post_event_appearance",
    "event_club_observation_notes": "tr",
    "event_club_observation_decided_utc": "2026-09-18T07:02:52Z",
}
real_shaped_checkpoint = {**v1_checkpoint, "decisions": copy.deepcopy(real_shaped_decisions)}
before_pending_check = copy.deepcopy(real_shaped_checkpoint)
_ = tool.club_observation_pending_state(
    "post_event_appearance", "tr", "pre_event_only", "operator correction with real notes",
    derived="pre_event_only",
)
check("37b calling the new pending-state logic never mutates a real-shaped checkpoint dict "
      "passed nowhere near it",
      real_shaped_checkpoint == before_pending_check)

check("37c all 11 identity verdicts in the real-shaped fixture remain exactly "
      "'same_person_valid_relisting' with their original notes/timestamps, unaffected by this "
      "fix",
      all(
          real_shaped_checkpoint["decisions"][rid]["operator_verdict"] == "same_person_valid_relisting"
          and real_shaped_checkpoint["decisions"][rid]["decided_utc"] == v1_decisions[rid]["decided_utc"]
          for rid in v1_decisions
      ))

# ---------------------------------------------------------------------------
# 38. compute_wraplength -- pure arithmetic behind responsive-width wrapping (screen-size fix,
# 2026-09-18). No Tkinter, no display required.
# ---------------------------------------------------------------------------

check("38a a generous width produces width-minus-margin",
      tool.compute_wraplength(1000) == 1000 - 24)

check("38b compute_wraplength never drops below its floor, even for a near-zero width "
      "(e.g. a stray startup Configure event before the window has a real size)",
      tool.compute_wraplength(1) == 220 and tool.compute_wraplength(0) == 220)

check("38c a custom margin/min_width are honoured",
      tool.compute_wraplength(500, min_width=100, margin=50) == 450
      and tool.compute_wraplength(120, min_width=100, margin=50) == 100)

check("38d compute_wraplength is monotonic in width (wider window -> wider or equal wrap)",
      tool.compute_wraplength(800) <= tool.compute_wraplength(1200))

# ---------------------------------------------------------------------------
# 39. saved_acknowledgement_text / unsaved_change_text -- the exact wording requested after the
# "Confirmed" mislabelling was reported (2026-09-18). Pure string formatting, no widget.
# ---------------------------------------------------------------------------

check("39a saved_acknowledgement_text never contains the word 'Confirmed'",
      "Confirmed" not in tool.saved_acknowledgement_text("Played for Essendon after this 1990 event.")
      and tool.saved_acknowledgement_text("Played for Essendon after this 1990 event.")
      == "Saved acknowledgement: Played for Essendon after this 1990 event.")

check("39b unsaved_change_text for a currently-valid pending selection never says 'Confirmed' "
      "either, and is textually distinct from saved_acknowledgement_text",
      "Confirmed" not in tool.unsaved_change_text("Played for this club after this event", True, None)
      and tool.unsaved_change_text("Played for this club after this event", True, None)
      == "Unsaved change — not recorded: Played for this club after this event (click Save "
         "observation to persist it).")

check("39c unsaved_change_text for an invalid pending selection includes the refusal reason",
      tool.unsaved_change_text("Played for this club after this event", False, "notes required")
      == "Unsaved change — not recorded: Played for this club after this event — notes required")

check("39d the two wording functions never produce the same text for the same underlying "
      "relationship -- a saved value and an unsaved one can never look identical",
      tool.saved_acknowledgement_text("Played for this club after this event.")
      != tool.unsaved_change_text("Played for this club after this event", True, None))

# ---------------------------------------------------------------------------
# 40. Integration: the exact Andrew Krakouer scenario, end to end through the wording layer --
# persisted post_event_appearance/"tr" (what the real checkpoint holds), a pending correction to
# pre_event_only with blank notes (invalid), confirming instead (valid, no notes needed).
# ---------------------------------------------------------------------------

# Krakouer's row always derives pre_event_only (a fixed fact of the retained evidence -- see
# check 36a). Simulates re-opening the row exactly as the real checkpoint has it (persisted
# post_event_appearance/"tr") and clearing the notes text: still differs from the derived
# suggestion, now with genuinely blank notes -- correctly invalid.
krakouer_state_blank = tool.club_observation_pending_state(
    "post_event_appearance", "tr", "post_event_appearance", "", derived="pre_event_only",
)
krakouer_text_blank = tool.unsaved_change_text(
    tool.EVENT_CLUB_OBSERVATION_FRIENDLY_LABELS["post_event_appearance"],
    krakouer_state_blank["is_valid"], krakouer_state_blank["error"],
)
check("40a re-opening the row with the notes cleared is pending (notes text differs from "
      "persisted) and INVALID (still differs from the derived suggestion with blank notes), "
      "and its wording never says 'Confirmed'",
      krakouer_state_blank["has_pending"] and not krakouer_state_blank["is_valid"]
      and "Confirmed" not in krakouer_text_blank
      and krakouer_text_blank.startswith("Unsaved change"))

krakouer_persisted_sentence = tool.confirmed_observation_sentence(
    "post_event_appearance", "North Melbourne", 1992,
)
check("40b the currently-persisted (wrong, pending operator correction) value still renders "
      "as a SAVED acknowledgement, honestly reflecting what is actually in the checkpoint",
      tool.saved_acknowledgement_text(krakouer_persisted_sentence)
      == "Saved acknowledgement: Played for North Melbourne after this 1992 event.")

check("40c explicit confirmation (Confirm suggested relationship) targets pre_event_only with "
      "no notes required, and validates cleanly -- this is the operator's own correction path, "
      "never taken automatically by this tool",
      tool.validate_event_club_observation("pre_event_only", "pre_event_only", "") is None)

# ---------------------------------------------------------------------------
# 41. --validate-final-output (Phase 3 independent final-output validation, 2026-09-18). Every
# mutation test below builds its own small fixture pack + a REAL finalize() output (never the
# tracked 83-row artefacts) via build_valid_final_output_fixture, then rewrites just the
# canonical JSON (or a rendered CSV/MD) and recomputes the matching expected hash/size --
# UNLESS the check under test is specifically a hash/size mismatch, in which case the file is
# left untouched and a wrong expected hash/size is passed instead. Only check 41z below reads
# the real, tracked artefacts, and only to assert PASS -- it never mutates them.
# ---------------------------------------------------------------------------

def build_valid_final_output_fixture(
    tmp_dir: Path, *, use_negative: bool = False, mutate_decisions_fn=None
) -> dict:
    """mutate_decisions_fn, when given, is applied to (pack_info, decisions) BEFORE finalize()
    runs -- so any decision content it injects (e.g. operator_notes) flows into finalize()'s own
    canonical JSON/CSV/Markdown rendering and all three stay mutually consistent by construction.
    Never mutate the JSON returned by finalize() afterward to simulate a decision change: the
    derived CSV/Markdown would then be stale relative to it, and deterministic validation is
    supposed to refuse that (see section 41's mutation tests, which mutate post-finalize on
    purpose to prove exactly that refusal)."""
    fx = write_fixture_repo(tmp_dir)
    pack_info = tool.load_and_validate_pack(fx["pack_path"], fx["repo_root"])
    checkpoint = tool.new_checkpoint(pack_info, "Test Operator", fx["repo_root"])
    checkpoint["decisions"] = all_decisions_for(pack_info, use_negative=use_negative)
    if mutate_decisions_fn is not None:
        mutate_decisions_fn(pack_info, checkpoint["decisions"])
    result = tool.finalize(fx["pack_path"], checkpoint, fx["repo_root"])
    expected = {
        "expected_source_pack_sha256": pack_info["pack_sha256"],
        "expected_json_sha256": result["json_sha256"],
        "expected_csv_sha256": result["csv_sha256"],
        "expected_md_sha256": result["md_sha256"],
        "expected_json_size": result["paths"]["json"].stat().st_size,
        "expected_csv_size": result["paths"]["csv"].stat().st_size,
        "expected_md_size": result["paths"]["md"].stat().st_size,
    }
    return {"fx": fx, "pack_info": pack_info, "result": result, "expected": expected}


def rewrite_json_with(paths: dict, mutate_fn) -> dict:
    """Loads the finalized JSON, applies mutate_fn(doc) in place, writes it back, and returns
    the mutated bytes' own sha256/size -- so a test can pass these as the new 'expected' pin
    when it wants everything EXCEPT the mutated invariant to still validate cleanly."""
    doc = json.loads(paths["json"].read_bytes().decode("utf-8"))
    mutate_fn(doc)
    new_bytes = tool.dump_json_lf(doc)
    tool.atomic_write_bytes(paths["json"], new_bytes)
    return {"sha256": tool.sha256_bytes(new_bytes), "size": len(new_bytes)}


def validate_fixture(fixture: dict, **overrides) -> dict:
    kwargs = dict(fixture["expected"])
    kwargs.update(overrides)
    return tool.validate_final_output(
        fixture["fx"]["repo_root"], pack_path=fixture["fx"]["pack_path"], **kwargs
    )


def refused_validation(fixture: dict, **overrides) -> str | None:
    try:
        validate_fixture(fixture, **overrides)
    except tool.ToolError as exc:
        return str(exc)
    return None


# -- 41a. Happy path ---------------------------------------------------------------------

tmp41a = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41a = build_valid_final_output_fixture(tmp41a)
report41a = validate_fixture(fixture41a)
check("41a a valid, completed final output passes independent validation",
      sum(report41a["by_group"].values()) == 83
      and report41a["json_sha256"] == fixture41a["expected"]["expected_json_sha256"])
check("41a2 the PASS report never leaks the operator's display name into console output "
      "(present in the returned dict for programmatic use only, per the report function)",
      report41a["operator_display_name"] == "Test Operator")

# -- 41b. Reported JSON/CSV/Markdown hash mismatch is refused ----------------------------

tmp41b = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41b = build_valid_final_output_fixture(tmp41b)
msg = refused_validation(fixture41b, expected_json_sha256="0" * 64)
check("41b1 a reported canonical-JSON hash mismatch is refused",
      msg is not None and "canonical JSON" in msg, str(msg))

msg = refused_validation(fixture41b, expected_csv_sha256="0" * 64)
check("41b2 a reported CSV hash mismatch is refused",
      msg is not None and "CSV" in msg, str(msg))

msg = refused_validation(fixture41b, expected_md_sha256="0" * 64)
check("41b3 a reported Markdown hash mismatch is refused",
      msg is not None and "Markdown" in msg, str(msg))

# -- 41c. Source-pack hash mismatch is refused --------------------------------------------

tmp41c = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41c = build_valid_final_output_fixture(tmp41c)
msg = refused_validation(fixture41c, expected_source_pack_sha256="0" * 64)
check("41c a reported source-pack hash mismatch is refused",
      msg is not None and "source adjudication pack sha256" in msg, str(msg))

# -- 41d. Missing / duplicate / reordered decision is refused ----------------------------

tmp41d = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41d = build_valid_final_output_fixture(tmp41d)
mutated = rewrite_json_with(fixture41d["result"]["paths"], lambda doc: doc["rows"].pop(5))
msg = refused_validation(
    fixture41d, expected_json_sha256=mutated["sha256"], expected_json_size=mutated["size"],
)
check("41d1 a missing decision (a dropped row) is refused", msg is not None, str(msg))

tmp41d2 = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41d2 = build_valid_final_output_fixture(tmp41d2)


def _duplicate_row(doc: dict) -> None:
    doc["rows"][1] = copy.deepcopy(doc["rows"][0])
    doc["rows"][1]["global_order"] = doc["rows"][0]["global_order"]


mutated = rewrite_json_with(fixture41d2["result"]["paths"], _duplicate_row)
msg = refused_validation(
    fixture41d2, expected_json_sha256=mutated["sha256"], expected_json_size=mutated["size"],
)
check("41d2 a duplicated decision (same row twice, another row's identity missing) is refused",
      msg is not None, str(msg))

tmp41d3 = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41d3 = build_valid_final_output_fixture(tmp41d3)


def _reorder_rows(doc: dict) -> None:
    doc["rows"][0], doc["rows"][1] = doc["rows"][1], doc["rows"][0]


mutated = rewrite_json_with(fixture41d3["result"]["paths"], _reorder_rows)
msg = refused_validation(
    fixture41d3, expected_json_sha256=mutated["sha256"], expected_json_size=mutated["size"],
)
check("41d3 a reordered decision (out of source-pack order) is refused", msg is not None, str(msg))

# -- 41e. Blank verdict is refused --------------------------------------------------------

tmp41e = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41e = build_valid_final_output_fixture(tmp41e)
mutated = rewrite_json_with(
    fixture41e["result"]["paths"], lambda doc: doc["rows"].__setitem__(
        0, {**doc["rows"][0], "operator_verdict": ""}
    )
)
msg = refused_validation(
    fixture41e, expected_json_sha256=mutated["sha256"], expected_json_size=mutated["size"],
)
check("41e a blank operator_verdict is refused",
      msg is not None and "blank operator_verdict" in msg, str(msg))

# -- 41f. Invalid group verdict is refused -------------------------------------------------

tmp41f = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41f = build_valid_final_output_fixture(tmp41f)


def _wrong_group_verdict(doc: dict) -> None:
    relisting_row = next(r for r in doc["rows"] if r["group"] == "relisting")
    relisting_row["operator_verdict"] = "agree"  # an audit-only verdict


mutated = rewrite_json_with(fixture41f["result"]["paths"], _wrong_group_verdict)
msg = refused_validation(
    fixture41f, expected_json_sha256=mutated["sha256"], expected_json_size=mutated["size"],
)
check("41f an allowed-verdict-for-a-different-group value is refused", msg is not None, str(msg))

# -- 41g. Required notes missing is refused ------------------------------------------------

tmp41g = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41g = build_valid_final_output_fixture(tmp41g)


def _negative_verdict_blank_notes(doc: dict) -> None:
    relisting_row = next(r for r in doc["rows"] if r["group"] == "relisting")
    relisting_row["operator_verdict"] = "different_person_wrong_href"
    relisting_row["operator_notes"] = ""


mutated = rewrite_json_with(fixture41g["result"]["paths"], _negative_verdict_blank_notes)
msg = refused_validation(
    fixture41g, expected_json_sha256=mutated["sha256"], expected_json_size=mutated["size"],
)
check("41g a required-notes verdict with blank notes is refused", msg is not None, str(msg))

# -- 41h. Required club acknowledgement missing is refused ---------------------------------

tmp41h = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41h = build_valid_final_output_fixture(tmp41h)
ack_row_url41h = next(
    r["draftguru_url"] for r in fixture41h["pack_info"]["rows"]
    if r["group"] == "relisting" and tool.event_club_observation_required_for(
        r, "same_person_valid_relisting"
    )
)


def _drop_required_ack(doc: dict) -> None:
    row = next(r for r in doc["rows"] if r["draftguru_url"] == ack_row_url41h)
    row["event_club_observation"] = None
    row["event_club_observation_notes"] = None


mutated = rewrite_json_with(fixture41h["result"]["paths"], _drop_required_ack)
msg = refused_validation(
    fixture41h, expected_json_sha256=mutated["sha256"], expected_json_size=mutated["size"],
)
check("41h a same-person verdict missing its required club-observation acknowledgement is refused",
      msg is not None and "acknowledgement" in msg, str(msg))

# -- 41i. Differing club acknowledgement without notes is refused --------------------------

tmp41i = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41i = build_valid_final_output_fixture(tmp41i)
ack_row_url41i = next(
    r["draftguru_url"] for r in fixture41i["pack_info"]["rows"]
    if r["group"] == "relisting" and tool.event_club_observation_required_for(
        r, "same_person_valid_relisting"
    )
)


def _override_ack_without_notes(doc: dict) -> None:
    row = next(r for r in doc["rows"] if r["draftguru_url"] == ack_row_url41i)
    derived = row["event_club_appearance_relationship_derived"]
    alternative = next(
        v for v in tool.EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES if v != derived
    )
    row["event_club_observation"] = alternative
    row["event_club_observation_notes"] = ""


mutated = rewrite_json_with(fixture41i["result"]["paths"], _override_ack_without_notes)
msg = refused_validation(
    fixture41i, expected_json_sha256=mutated["sha256"], expected_json_size=mutated["size"],
)
check("41i a club-observation differing from the derived suggestion with blank notes is refused",
      msg is not None, str(msg))

# -- 41j. Totals mismatch is refused --------------------------------------------------------

tmp41j = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41j = build_valid_final_output_fixture(tmp41j)
mutated = rewrite_json_with(
    fixture41j["result"]["paths"],
    lambda doc: doc["totals"]["by_verdict"].__setitem__("same_person_valid_relisting", 999),
)
msg = refused_validation(
    fixture41j, expected_json_sha256=mutated["sha256"], expected_json_size=mutated["size"],
)
check("41j a totals.by_verdict mismatch against the actual decision rows is refused",
      msg is not None and "totals.by_verdict" in msg, str(msg))

# -- 41k. Completion status other than complete is refused ---------------------------------

tmp41k = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41k = build_valid_final_output_fixture(tmp41k)
mutated = rewrite_json_with(
    fixture41k["result"]["paths"], lambda doc: doc.__setitem__("completion_status", "in_progress"),
)
msg = refused_validation(
    fixture41k, expected_json_sha256=mutated["sha256"], expected_json_size=mutated["size"],
)
check("41k a completion_status other than 'complete' is refused",
      msg is not None and "completion_status" in msg, str(msg))

# -- 41l. Absolute local path is refused -----------------------------------------------------

tmp41l = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41l = build_valid_final_output_fixture(tmp41l)
mutated = rewrite_json_with(
    fixture41l["result"]["paths"],
    lambda doc: doc["tool"].__setitem__("path", "C:\\Users\\test\\review_bridge_operator.py"),
)
msg = refused_validation(
    fixture41l, expected_json_sha256=mutated["sha256"], expected_json_size=mutated["size"],
)
check("41l an absolute local path in a path-bearing field is refused",
      msg is not None and "absolute local path" in msg, str(msg))

# -- 41m. Credential-like forbidden fields are refused ---------------------------------------

tmp41m = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41m = build_valid_final_output_fixture(tmp41m)
mutated = rewrite_json_with(
    fixture41m["result"]["paths"],
    lambda doc: doc.__setitem__("operator_display_name", "operator@example.com"),
)
msg = refused_validation(
    fixture41m, expected_json_sha256=mutated["sha256"], expected_json_size=mutated["size"],
)
check("41m1 an email address in operator_display_name is refused",
      msg is not None and "forbidden content" in msg, str(msg))

tmp41m2 = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41m2 = build_valid_final_output_fixture(tmp41m2)
mutated = rewrite_json_with(
    fixture41m2["result"]["paths"],
    lambda doc: doc["rows"].__setitem__(
        0, {**doc["rows"][0], "operator_notes": "internal password: hunter2"}
    ),
)
msg = refused_validation(
    fixture41m2, expected_json_sha256=mutated["sha256"], expected_json_size=mutated["size"],
)
check("41m2 a credential-like keyword in operator_notes is refused",
      msg is not None and "forbidden content" in msg, str(msg))

# -- 41n. CSV byte mismatch is refused ---------------------------------------------------

tmp41n = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41n = build_valid_final_output_fixture(tmp41n)
tampered_csv = fixture41n["result"]["paths"]["csv"].read_bytes() + b"tampered,row,data\n"
tool.atomic_write_bytes(fixture41n["result"]["paths"]["csv"], tampered_csv)
msg = refused_validation(
    fixture41n,
    expected_csv_sha256=tool.sha256_bytes(tampered_csv),
    expected_csv_size=len(tampered_csv),
)
check("41n a CSV that no longer matches the deterministic re-render is refused",
      msg is not None and "CSV" in msg, str(msg))

# -- 41o. Markdown byte mismatch is refused ------------------------------------------------

tmp41o = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41o = build_valid_final_output_fixture(tmp41o)
tampered_md = fixture41o["result"]["paths"]["md"].read_bytes() + b"\ntampered\n"
tool.atomic_write_bytes(fixture41o["result"]["paths"]["md"], tampered_md)
msg = refused_validation(
    fixture41o,
    expected_md_sha256=tool.sha256_bytes(tampered_md),
    expected_md_size=len(tampered_md),
)
check("41o a Markdown that no longer matches the deterministic re-render is refused",
      msg is not None and "Markdown" in msg, str(msg))

# -- 41p. Validation performs no writes ----------------------------------------------------

tmp41p = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41p = build_valid_final_output_fixture(tmp41p)
before_files = sorted(str(p) for p in tmp41p.rglob("*") if p.is_file())
before_hashes = {p: tool.sha256_file(Path(p)) for p in before_files}
validate_fixture(fixture41p)
after_files = sorted(str(p) for p in tmp41p.rglob("*") if p.is_file())
after_hashes = {p: tool.sha256_file(Path(p)) for p in after_files}
check("41p a successful validation run writes no file and creates no new file",
      before_files == after_files and before_hashes == after_hashes)

# -- 41q. Negative/uncertain verdicts and overrides are surfaced for human awareness ------

tmp41q = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture41q = build_valid_final_output_fixture(tmp41q, use_negative=True)
report41q = validate_fixture(fixture41q)
check("41q an all-negative-verdict fixture surfaces every row in negative_rows for awareness "
      "(never silently dropped, never itself a validation failure)",
      len(report41q["negative_rows"]) == 83 and report41q["uncertain_rows"] == [])

# -- 41z. The REAL completed ISSUE-222 Phase 3 verdict artefacts remain byte-identical ------
# The one check in this section that reads the real, tracked artefacts -- read-only, asserting
# PASS against the pinned hashes given for this validation task. Never mutates them.

try:
    report41z = tool.validate_final_output(tool.REPO_ROOT)
    real_ok = (
        report41z["json_sha256"] == tool.EXPECTED_FINAL_JSON_SHA256
        and report41z["csv_sha256"] == tool.EXPECTED_FINAL_CSV_SHA256
        and report41z["md_sha256"] == tool.EXPECTED_FINAL_MD_SHA256
        and report41z["pack_sha256"] == tool.EXPECTED_SOURCE_PACK_SHA256
        and sum(report41z["by_group"].values()) == 83
    )
    real_detail = "" if real_ok else str(report41z)
except tool.ToolError as exc:
    real_ok = False
    real_detail = str(exc)
check("41z the REAL completed AFLDB-ISSUE-222 Phase 3 verdict artefacts independently validate "
      "and remain byte-identical to the pinned, operator-reported hashes (83/83 decisions)",
      real_ok, real_detail)

# ---------------------------------------------------------------------------
# 42. URL-aware local-path detection (correction, 2026-09-18). A real operator run found
# check_no_forbidden_content false-positiving on ordinary "https://..." evidence-citation
# URLs in operator_notes -- the letter+colon+slash immediately before "//" in "https://"
# itself matches the Windows-drive-letter branch of _ABSOLUTE_PATH_PATTERN. Every check here
# exercises the real, non-private tool.check_no_forbidden_content / tool.check_no_absolute_paths
# functions directly against small hand-built docs -- never the tracked artefacts (42z is the
# one exception, confirming the exact real-world regression end to end).
# ---------------------------------------------------------------------------

def _doc_with_notes(notes: str) -> dict:
    return {
        "operator_display_name": "Test Operator",
        "rows": [{
            "draftguru_url": "https://www.draftguru.com.au/players/test/1",
            "operator_notes": notes,
            "event_club_observation_notes": None,
        }],
    }


check("42a a standalone HTTPS AFL Tables URL in operator_notes is allowed "
      "(the exact URL from the operator's bug report)",
      tool.check_no_forbidden_content(_doc_with_notes(
          "https://afltables.com/afl/stats/players/A/Andrew_Krakouer0.html"
      )) == [])

check("42b an HTTPS URL embedded in prose is allowed",
      tool.check_no_forbidden_content(_doc_with_notes(
          "See https://afltables.com/afl/stats/players/A/Andrew_Krakouer0.html for details."
      )) == [])

check("42c multiple HTTP/HTTPS URLs in one note are allowed (the real Chris O'Dwyer row shape: "
      "three newline-separated citation URls)",
      tool.check_no_forbidden_content(_doc_with_notes(
          "https://www.draftguru.com.au/players/chris_o'dwyer/1\n"
          "https://en.wikipedia.org/wiki/Chris_O%27Dwyer\n"
          "https://afltables.com/afl/stats/players/C/Chris_ODwyer.html"
      )) == [])

check("42d a URL containing underscores and apostrophes is allowed",
      tool.check_no_forbidden_content(_doc_with_notes(
          "https://www.draftguru.com.au/players/chris_o'dwyer/1"
      )) == [])

check("42e URL query strings and fragments are allowed",
      tool.check_no_forbidden_content(_doc_with_notes(
          "https://example.com/path?query=1&other=two#fragment-section"
      )) == [])

check("42f a Windows drive path (backslash form) is still refused",
      tool.check_no_forbidden_content(
          _doc_with_notes("see C:\\Users\\name\\file.txt")
      ) != [])

check("42g a forward-slash Windows drive path is still refused",
      tool.check_no_forbidden_content(
          _doc_with_notes("see D:/dev/project/file.json")
      ) != [])

check("42h a UNC path is still refused",
      tool.check_no_forbidden_content(
          _doc_with_notes("see \\\\server\\share\\file")
      ) != [])

check("42i a POSIX /home path is still refused",
      tool.check_no_forbidden_content(_doc_with_notes("see /home/name/file")) != [])

check("42i2 a POSIX /Users path is still refused",
      tool.check_no_forbidden_content(_doc_with_notes("see /Users/name/file")) != [])

check("42j a file:// URL over a Windows path is still refused",
      tool.check_no_forbidden_content(_doc_with_notes("file:///C:/Users/name/file")) != [])

check("42j2 a file:// URL over a POSIX path is still refused",
      tool.check_no_forbidden_content(_doc_with_notes("file:///home/name/file")) != [])

check("42k a note carrying both a valid HTTPS URL and a separate local path is still refused",
      tool.check_no_forbidden_content(_doc_with_notes(
          "See https://afltables.com/afl/stats/players/A/Andrew_Krakouer0.html and "
          "C:\\Users\\name\\file.txt"
      )) != [])

check("42l a malformed URL smuggling a Windows path into its own netloc does not bypass "
      "validation (backslashes are never valid inside a URL)",
      tool.check_no_forbidden_content(_doc_with_notes("https://C:\\Users\\name\\file.txt")) != [])

check("42l2 a host-less, malformed 'https:///...' string does not bypass validation",
      tool.check_no_forbidden_content(_doc_with_notes("https:///C:/Users/name/file")) != [])

check("42l3 _is_valid_web_url rejects a candidate containing a backslash outright",
      tool._is_valid_web_url("https://C:\\Users\\name\\file.txt") is False)

check("42l4 _is_valid_web_url rejects a candidate with no hostname",
      tool._is_valid_web_url("https:///path") is False)

check("42l5 _is_valid_web_url accepts a genuine http(s) URL with a valid hostname",
      tool._is_valid_web_url("https://afltables.com/afl/stats/players/A/X.html") is True)

check("42m structured path-bearing fields (tool.path etc.) still require a relative repository "
      "path -- unaffected by the URL-awareness fix, since they are never URLs",
      tool.check_no_absolute_paths({
          "tool": {"path": "C:\\Users\\test\\review_bridge_operator.py"},
          "source_adjudication_pack": {"path": "docs/rebuild-manifests/draftguru/x.json"},
          "source_hash_links": [],
      }) != [])

check("42n a '..' path-traversal segment in a structured path field is refused",
      tool.check_no_absolute_paths({
          "tool": {"path": "tools/rebuild/../../../etc/passwd"},
          "source_adjudication_pack": {"path": "docs/rebuild-manifests/draftguru/x.json"},
          "source_hash_links": [],
      }) != [])

check("42o a well-formed, relative structured path field set passes cleanly",
      tool.check_no_absolute_paths({
          "tool": {"path": "tools/rebuild/draftguru/review_bridge_operator.py"},
          "source_adjudication_pack": {
              "path": "docs/rebuild-manifests/draftguru/"
                      "bridge-operator-adjudication-pack-20260918-v1.json"
          },
          "source_hash_links": [{"path": "data/reference/x.json"}],
      }) == [])

# -- 42z. End-to-end through validate_final_output: a row whose notes carry a real
# evidence-citation URL (the operator's actual regression) no longer false-positives, and the
# run remains fully read-only. The URL note is injected into the decision BEFORE finalize() runs
# (not patched into the canonical JSON afterward) so finalize() itself renders a mutually
# consistent JSON/CSV/Markdown triple -- exactly how a real operator run produces this fixture.


def _inject_url_citation_notes(pack_info: dict, decisions: dict) -> None:
    first_row_id = pack_info["rows"][0]["row_id"]
    decisions[first_row_id]["operator_notes"] = (
        "https://afltables.com/afl/stats/players/A/Andrew_Krakouer0.html"
    )


tmp42z = Path(tempfile.mkdtemp(prefix="afldb-i222-bridge-operator-validate-"))
fixture42z = build_valid_final_output_fixture(
    tmp42z, use_negative=True, mutate_decisions_fn=_inject_url_citation_notes,
)
before_files42z = sorted(str(p) for p in tmp42z.rglob("*") if p.is_file())
before_hashes42z = {p: tool.sha256_file(Path(p)) for p in before_files42z}
report42z = validate_fixture(fixture42z)
after_files42z = sorted(str(p) for p in tmp42z.rglob("*") if p.is_file())
after_hashes42z = {p: tool.sha256_file(Path(p)) for p in after_files42z}
check("42z an operator note carrying a real evidence-citation URL no longer false-positives "
      "end-to-end through validate_final_output (the exact regression the operator hit), and "
      "the run remains fully read-only",
      sum(report42z["by_group"].values()) == 83
      and before_files42z == after_files42z and before_hashes42z == after_hashes42z)

print()
if failures:
    print(f"FAILED: {len(failures)} check(s): {', '.join(failures)}")
    raise SystemExit(1)
print("All DraftGuru operator-adjudication-review checks hold.")
