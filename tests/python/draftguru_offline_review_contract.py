#!/usr/bin/env python3
"""AFLDB-ISSUE-222 Phase 3 correction handoff §J -- DB-free contract checks for
tools/rebuild/draftguru/review_person_bridge_offline.py.

    python tests/python/draftguru_offline_review_contract.py

Exercises evaluate_row(), earliest_original_recruitment(), build_fitzroy_index(),
build_recheck_queue() and the whole run()/main() plumbing directly against small
hand-built fixtures -- never the real 997-row sample -- so every check here runs in
well under a second and needs no accepted fitzRoy bytes on disk.

No database, no network, no subprocess spawn except the two end-to-end refusal checks
at the bottom, which invoke this same script's own CLI against tiny generated fixture
files (never the real, tracked immutable inputs).
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOL_DIR = ROOT / "tools" / "rebuild" / "draftguru"
sys.path.insert(0, str(TOOL_DIR))

import review_person_bridge_offline as tool  # noqa: E402

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' -- ' + detail) if detail else ''}")
        failures.append(name)


URL = "https://www.draftguru.com.au/players/test_person/1"
IDENTITY = "players/T/Test_Person.html"


def base_profile(identity=IDENTITY, count=1, title="Test Person (born 2000) - Draftguru",
                 h2="Test Person"):
    return {
        "player_url": URL, "afltables_href_count": 1,
        "distinct_afltables_identity_count": count, "afltables_identity": identity,
        "page": {"title": title, "h2": h2, "heuristic_fields": {"dob_candidates": ["1 Jan 2000"]}},
        "raw_filename": "test_person-1.html", "raw_sha256": "0" * 64,
    }


def base_stage_a_row(**overrides):
    row = {"player_url": URL, "draft_year": 2018, "event_type_raw": "National",
          "pick_number": 5, "club_name_raw": "Essendon", "age_raw": "18yr",
          "parity_only": {"games": "100", "goals": "50"}}
    row.update(overrides)
    return row


def base_fitzroy_record(**overrides):
    rec = {
        "fitzroy_ids": ["1"], "distinct_fitzroy_id_count": 1, "players": ["Test Person"],
        "first_names": ["Test"], "surnames": ["Person"], "dob_years": [2000],
        "implied_birth_year": 2000, "debut_date": "2018-03-01", "debut_season": 2018,
        "last_season": 2025, "career_games": 100, "goals_sum": 50, "na_goals": 0,
        "clubs": ["Essendon"],
    }
    rec.update(overrides)
    return rec


def evaluate(*, profile=None, stage_a_rows=None, fitzroy_record=None, child_status="bridged",
            ledger=None, numbering_urls=None, spelling_urls=None, schwerdt_urls=None,
            continuity_paths=None, identity=IDENTITY):
    profile_by_url = {URL: profile} if profile is not None else {}
    stage_a = stage_a_rows if stage_a_rows is not None else [base_stage_a_row()]
    stage_a_rows_by_url = {URL: stage_a} if stage_a else {}
    stage_a_persons_by_url = {URL: {"display_names_raw": ["Test Person"], "years": [2018]}}
    fitzroy_index = {identity: fitzroy_record} if fitzroy_record is not None else {}
    child_bridged = {URL} if child_status == "bridged" else set()
    child_withheld_reason = {URL: "target_not_registered"} if child_status == "target_not_registered" else {}
    return tool.evaluate_row(
        player_url=URL, stratum="random", sample_index=1, ordinal=1,
        parent_identity_by_url={URL: identity}, child_bridged=child_bridged,
        child_withheld_reason=child_withheld_reason, profile_by_url=profile_by_url,
        stage_a_rows_by_url=stage_a_rows_by_url, stage_a_persons_by_url=stage_a_persons_by_url,
        fitzroy_index=fitzroy_index, ledger_by_url=ledger or {},
        aliases_by_identity={}, awards_census_by_identity={},
        numbering_urls=numbering_urls or set(), spelling_urls=spelling_urls or set(),
        schwerdt_urls=schwerdt_urls or set(), continuity_paths=continuity_paths or set())


# ---------------------------------------------------------------------------
# 1. One fixture row per outcome
# ---------------------------------------------------------------------------
print("1. one fixture row per outcome")

r = evaluate(profile=base_profile(), fitzroy_record=base_fitzroy_record())
check("1a clean corroborated row -> offline_strong", r["outcome"] == "offline_strong", r["outcome"])

r = evaluate(profile=base_profile(), fitzroy_record=base_fitzroy_record(),
            stage_a_rows=[base_stage_a_row(parity_only={"games": None, "goals": None})],
            child_status="bridged")
r2 = evaluate(profile=base_profile(title="Test Person - Draftguru"),   # no (born YYYY)
              fitzroy_record=base_fitzroy_record())
check("1b no birth-year evidence, name-only otherwise -> offline_limited",
      r2["outcome"] == "offline_limited", r2["outcome"])

r = evaluate(profile=base_profile(), fitzroy_record=base_fitzroy_record(dob_years=[1970]))
check("1c birth-year delta >= 2 -> offline_contradict", r["outcome"] == "offline_contradict",
      str((r["outcome"], r["reason_codes"])))

r = evaluate(profile=base_profile(), child_status="target_not_registered")
check("1d child target_not_registered -> target_unregistered",
      r["outcome"] == "target_unregistered", r["outcome"])

r = evaluate(profile=None)
check("1e missing DraftGuru profile -> offline_unavailable", r["outcome"] == "offline_unavailable",
      r["outcome"])

r = evaluate(profile=base_profile(), fitzroy_record=None)
check("1f registered but no retained snapshot rows -> offline_unavailable",
      r["outcome"] == "offline_unavailable", r["outcome"])

r = evaluate(profile=base_profile(count=2))
check("1g distinct_afltables_identity_count != 1 -> tooling_or_schema_error",
      r["outcome"] == "tooling_or_schema_error", r["outcome"])

print()
print("2. name-only equality yields offline_limited (no birth year, no debut/span/games signal)")
r = evaluate(profile=base_profile(title="Test Person - Draftguru"),
            stage_a_rows=[base_stage_a_row(event_type_raw="Trade")],
            fitzroy_record=base_fitzroy_record(debut_season=None, last_season=None, career_games=0))
check("2a", r["outcome"] == "offline_limited", str((r["outcome"], r["reason_codes"])))

print()
print("3. a club difference alone never contradicts")
r = evaluate(profile=base_profile(), fitzroy_record=base_fitzroy_record(clubs=["Richmond"]))
check("3a different club, everything else consistent -> still offline_strong",
      r["outcome"] == "offline_strong", str((r["outcome"], r["reason_codes"])))
check("3b CLUB_HISTORY_OVERLAPS absent, no contradiction code from it",
      "CLUB_HISTORY_OVERLAPS" not in r["reason_codes"], str(r["reason_codes"]))

print()
print("4. DEBUT_BEFORE_EARLIEST_RECRUITMENT is informational; "
     "CAREER_ENDED_BEFORE_EARLIEST_RECRUITMENT contradicts")
r = evaluate(profile=base_profile(),
            fitzroy_record=base_fitzroy_record(debut_season=2010, last_season=2025))
check("4a debut before recruitment year, span still contains it -> offline_strong",
      r["outcome"] == "offline_strong", str((r["outcome"], r["reason_codes"])))
check("4b DEBUT_BEFORE_EARLIEST_RECRUITMENT recorded, not blocking",
      "DEBUT_BEFORE_EARLIEST_RECRUITMENT" in r["reason_codes"], str(r["reason_codes"]))

r = evaluate(profile=base_profile(),
            fitzroy_record=base_fitzroy_record(debut_season=2010, last_season=2012))
check("4c career ended before recruitment year -> offline_contradict",
      r["outcome"] == "offline_contradict", str((r["outcome"], r["reason_codes"])))
check("4d CAREER_ENDED_BEFORE_EARLIEST_RECRUITMENT recorded",
      "CAREER_ENDED_BEFORE_EARLIEST_RECRUITMENT" in r["reason_codes"], str(r["reason_codes"]))

print()
print("5. earliest-original-recruitment selection")
rows = [base_stage_a_row(draft_year=2015, event_type_raw="Trade"),
       base_stage_a_row(draft_year=2016, event_type_raw="National")]
earliest = tool.earliest_original_recruitment(rows)
check("5a skips Trade, picks the National row", earliest["draft_year"] == 2016, str(earliest))

rows_null = [base_stage_a_row(draft_year=1981, event_type_raw=None)]
earliest_null = tool.earliest_original_recruitment(rows_null)
check("5b a null event_type_raw (1981/1982/1987 absent-column years) counts as recruitment",
      earliest_null is not None and earliest_null["draft_year"] == 1981, str(earliest_null))

trade_only_rows = [base_stage_a_row(draft_year=1995, event_type_raw="Trade"),
                   base_stage_a_row(draft_year=1998, event_type_raw="Free Agency")]
check("5c trade-only person -> no earliest_original_recruitment",
      tool.earliest_original_recruitment(trade_only_rows) is None)
check("5d trade-only person -> earliest_trade_row picks the earliest by year",
      tool.earliest_trade_row(trade_only_rows)["draft_year"] == 1995,
      str(tool.earliest_trade_row(trade_only_rows)))

r = evaluate(profile=base_profile(), stage_a_rows=trade_only_rows,
            fitzroy_record=base_fitzroy_record(debut_season=1995, last_season=1999))
check("5e trade-only row reaches offline_strong via SPAN_CONTAINS using the trade year",
      r["outcome"] == "offline_strong", str((r["outcome"], r["reason_codes"])))
check("5f trade_only flag set", r["stage_a"]["trade_only"] is True)

print()
print("6. name-variant table, including Stephen/Steven, and the unlisted-variant path")
r = evaluate(profile=base_profile(h2="Dan Curtin", title="Dan Curtin (born 2000) - Draftguru"),
            fitzroy_record=base_fitzroy_record(first_names=["Daniel"], surnames=["Curtin"],
                                                players=["Daniel Curtin"]))
check("6a Dan/Daniel is a listed variant -> offline_strong with NAME_VARIANT",
      r["outcome"] == "offline_strong" and "NAME_VARIANT" in r["reason_codes"],
      str((r["outcome"], r["reason_codes"])))
check("6a-flag flags.name_variant is set", r["flags"]["name_variant"] is True)

r = evaluate(profile=base_profile(h2="Stephen Test", title="Stephen Test (born 2000) - Draftguru"),
            fitzroy_record=base_fitzroy_record(first_names=["Steven"], surnames=["Test"],
                                                players=["Steven Test"]))
check("6b Stephen/Steven is a listed variant -> offline_strong with NAME_VARIANT",
      r["outcome"] == "offline_strong" and "NAME_VARIANT" in r["reason_codes"],
      str((r["outcome"], r["reason_codes"])))

r = evaluate(profile=base_profile(h2="Jimmy Test", title="Jimmy Test (born 2000) - Draftguru"),
            fitzroy_record=base_fitzroy_record(first_names=["James"], surnames=["Test"],
                                                players=["James Test"]))
check("6c Jimmy/James is NOT a listed variant -> NAME_VARIANT_UNLISTED, offline_limited",
      r["outcome"] == "offline_limited" and "NAME_VARIANT_UNLISTED" in r["reason_codes"],
      str((r["outcome"], r["reason_codes"])))

r = evaluate(profile=base_profile(h2="Jordan De Goey", title="Jordan De Goey (born 2000) - Draftguru"),
            fitzroy_record=base_fitzroy_record(surnames=["de Goey"], first_names=["Jordan"],
                                                players=["Jordan de Goey"]))
check("6d multi-word surname ('de Goey') suffix-matches, not a false SURNAME_DIFFERENT",
      r["outcome"] == "offline_strong" and "SURNAME_DIFFERENT" not in r["reason_codes"],
      str((r["outcome"], r["reason_codes"])))

print()
print("6e known_exception_class actually flags a real slug against the module's own "
     "NUMBERING_SLUGS/SPELLING_SLUGS/SCHWERDT_SLUGS constants (regression: _matches_slug() "
     "was defined but never called from evaluate_row(), so every known_exception_class "
     "flag silently stayed None on the real 997-row run until this was wired in)")
check("6e-1 _matches_slug matches a full URL against a bare slug",
      tool._matches_slug("https://www.draftguru.com.au/players/joel_smith/1", {"joel_smith/1"}))
check("6e-2 _matches_slug does not match an unrelated URL",
      not tool._matches_slug("https://www.draftguru.com.au/players/joel_smith/1", {"tom_murphy/1"}))

numbering_url = "https://www.draftguru.com.au/players/joel_smith/1"
r = tool.evaluate_row(
    player_url=numbering_url, stratum="census", sample_index=1, ordinal=1,
    parent_identity_by_url={numbering_url: "players/J/Joel_Smith.html"},
    child_bridged=set(), child_withheld_reason={numbering_url: "target_not_registered"},
    profile_by_url={numbering_url: base_profile(identity="players/J/Joel_Smith.html")},
    stage_a_rows_by_url={numbering_url: [base_stage_a_row()]},
    stage_a_persons_by_url={numbering_url: {"display_names_raw": ["Joel Smith"], "years": [2018]}},
    fitzroy_index={}, ledger_by_url={}, aliases_by_identity={}, awards_census_by_identity={},
    numbering_urls=tool.NUMBERING_SLUGS, spelling_urls=tool.SPELLING_SLUGS,
    schwerdt_urls=tool.SCHWERDT_SLUGS, continuity_paths=set())
check("6e-3 a real numbering-class url is flagged known_exception_class == 'numbering'",
      r["flags"]["known_exception_class"] == "numbering", str(r["flags"]))

schwerdt_url = "https://www.draftguru.com.au/players/stephen_schwerdt/1"
r = tool.evaluate_row(
    player_url=schwerdt_url, stratum="random", sample_index=1, ordinal=1,
    parent_identity_by_url={schwerdt_url: "players/S/Stephen_Schwerdt.html"},
    child_bridged=set(), child_withheld_reason={schwerdt_url: "target_not_registered"},
    profile_by_url={schwerdt_url: base_profile(identity="players/S/Stephen_Schwerdt.html")},
    stage_a_rows_by_url={schwerdt_url: [base_stage_a_row()]},
    stage_a_persons_by_url={schwerdt_url: {"display_names_raw": ["Stephen Schwerdt"], "years": [1989]}},
    fitzroy_index={}, ledger_by_url={}, aliases_by_identity={}, awards_census_by_identity={},
    numbering_urls=tool.NUMBERING_SLUGS, spelling_urls=tool.SPELLING_SLUGS,
    schwerdt_urls=tool.SCHWERDT_SLUGS, continuity_paths=set())
check("6e-4 stephen_schwerdt/1 is flagged known_exception_class == 'schwerdt'",
      r["flags"]["known_exception_class"] == "schwerdt", str(r["flags"]))

print()
print("7. numeric-suffix and continuity-path rows require club overlap for offline_strong")
r = evaluate(profile=base_profile(identity="players/T/Test_Person3.html"),
            fitzroy_record=base_fitzroy_record(clubs=["Richmond"]),
            identity="players/T/Test_Person3.html")
check("7a numeric-suffix identity, no club overlap -> withheld from offline_strong",
      r["outcome"] != "offline_strong", str((r["outcome"], r["reason_codes"])))
check("7b numeric_suffix flag set", r["flags"]["numeric_suffix"] is True)

r = evaluate(profile=base_profile(identity="players/T/Test_Person3.html"),
            fitzroy_record=base_fitzroy_record(clubs=["Essendon"]),
            identity="players/T/Test_Person3.html")
check("7c numeric-suffix identity WITH club overlap -> offline_strong",
      r["outcome"] == "offline_strong", str((r["outcome"], r["reason_codes"])))

r = evaluate(profile=base_profile(), fitzroy_record=base_fitzroy_record(clubs=["Richmond"]),
            continuity_paths={IDENTITY})
check("7d continuity-rule path, no club overlap -> withheld from offline_strong",
      r["outcome"] != "offline_strong", str((r["outcome"], r["reason_codes"])))
check("7e continuity_rule_url flag set", r["flags"]["continuity_rule_url"] is True)

print()
print("8. birth-year tolerance; DOB preferred over Age-implied year")
r = evaluate(profile=base_profile(title="Test Person (born 2001) - Draftguru"),
            fitzroy_record=base_fitzroy_record(dob_years=[2000]))
check("8a |delta|==1 is consistent (tolerance)", r["outcome"] == "offline_strong",
      str((r["outcome"], r["reason_codes"])))
check("8b tolerance reason code recorded",
      "BIRTH_YEAR_CONSISTENT_TOLERANCE" in r["reason_codes"], str(r["reason_codes"]))

r = evaluate(profile=base_profile(title="Test Person (born 2003) - Draftguru"),
            fitzroy_record=base_fitzroy_record(dob_years=[2000]))
check("8c |delta|==3 conflicts", r["outcome"] == "offline_contradict",
      str((r["outcome"], r["reason_codes"])))

r = evaluate(profile=base_profile(title="Test Person (born 1999) - Draftguru"),
            fitzroy_record=base_fitzroy_record(dob_years=[], implied_birth_year=2000))
check("8d DOB absent, falls back to Age-implied birth year (delta 1, tolerated)",
      r["outcome"] == "offline_strong", str((r["outcome"], r["reason_codes"])))

print()
print("9. the games consistency rule")
r = evaluate(profile=base_profile(),
            stage_a_rows=[base_stage_a_row(parity_only={"games": "100", "goals": "50"})],
            fitzroy_record=base_fitzroy_record(career_games=100, last_season=2024))
check("9a equal games, last_season<=2024 -> GAMES_CONSISTENT",
      "GAMES_CONSISTENT" in r["reason_codes"], str(r["reason_codes"]))

r = evaluate(profile=base_profile(),
            stage_a_rows=[base_stage_a_row(parity_only={"games": "100", "goals": "50"})],
            fitzroy_record=base_fitzroy_record(career_games=90, last_season=2024))
check("9b retained < draftguru but last_season<=2024 requires equality -> GAMES_INCONSISTENT",
      "GAMES_INCONSISTENT" in r["reason_codes"], str(r["reason_codes"]))

r = evaluate(profile=base_profile(),
            stage_a_rows=[base_stage_a_row(parity_only={"games": "100", "goals": "50"})],
            fitzroy_record=base_fitzroy_record(career_games=90, last_season=2025))
check("9c retained <= draftguru, last_season 2025 -> GAMES_CONSISTENT (no equality required)",
      "GAMES_CONSISTENT" in r["reason_codes"], str(r["reason_codes"]))

r = evaluate(profile=base_profile(),
            stage_a_rows=[base_stage_a_row(parity_only={"games": "100", "goals": "50"})],
            fitzroy_record=base_fitzroy_record(career_games=150, last_season=2024))
check("9d retained > draftguru -> GAMES_INCONSISTENT",
      "GAMES_INCONSISTENT" in r["reason_codes"], str(r["reason_codes"]))
check("9e games leading-integer parse: '76 (31)' -> 76",
      tool.parse_leading_int("76 (31)") == 76, str(tool.parse_leading_int("76 (31)")))

print()
print("10. deterministic audit selection, pinned digest, excludes classes 1-10")
pinned = hashlib.sha256(
    f"AFLDB-ISSUE-222/audit-v1|{URL}".encode("utf-8")).hexdigest()
computed = tool.salted_key("AFLDB-ISSUE-222/audit-v1", URL)
check("10a salted_key matches an independently computed sha256(salt+\"|\"+url)",
      pinned == computed, f"{pinned} vs {computed}")

strong_row = {"player_url": "https://x/strong", "stratum": "random", "sample_index": 1,
             "outcome": "offline_strong", "reason_codes": [],
             "flags": {"numeric_suffix": False, "continuity_rule_url": False,
                       "name_variant": False, "known_exception_class": None},
             "ledger_status": "none", "weak_evidence": False}
weak_row = {**strong_row, "player_url": "https://x/weak", "weak_evidence": True}
contradict_row = {**strong_row, "player_url": "https://x/contradict", "outcome": "offline_contradict"}
recheck = tool.build_recheck_queue(
    [strong_row, weak_row, contradict_row], audit_salt="AFLDB-ISSUE-222/audit-v1",
    verdicts_sha256="a" * 64, sample_sha256="b" * 64, parent_sha256="c" * 64, child_sha256="d" * 64)
audit_urls = {r["player_url"] for r in recheck["classes"]["11_deterministic_audit"]}
check("10b weak_evidence row excluded from the audit pool (already in class 10)",
      "https://x/weak" not in audit_urls, str(audit_urls))
check("10c contradict row excluded from the audit pool (already in class 1)",
      "https://x/contradict" not in audit_urls, str(audit_urls))
check("10d the clean strong row IS eligible for the audit pool",
      "https://x/strong" in audit_urls, str(audit_urls))
check("10e class 1 carries the contradict row", len(recheck["classes"]["1_offline_contradict"]) == 1)
check("10f class 10 carries the weak row", len(recheck["classes"]["10_weak_or_suffix_or_continuity"]) == 1)

print()
print("11. deterministic rows_sha256 across two independent runs (tiny fixture, no CSV scan)")


def build_fixture_run():
    tmp = Path(tempfile.mkdtemp(prefix="afldb-i222-offline-"))
    label = "fixturev1"
    sample = {"census_stratum": [{"player_url": URL, "verdict": None}], "random_stratum": []}
    parent = {"kind": "source-evidence",
             "bridges": [{"player_url": URL, "afltables_external_id": IDENTITY}], "withheld": []}
    child = {"kind": "deployment",
            "bridges": [{"player_url": URL, "afltables_external_id": IDENTITY}], "withheld": []}
    (tmp / f"bridge-review-{label}.json").write_text(json.dumps(sample), encoding="utf-8")
    (tmp / f"draftguru-person-bridge-{label}.json").write_text(json.dumps(parent), encoding="utf-8")
    (tmp / f"draftguru-person-bridge-{label}.afldb_test.json").write_text(json.dumps(child), encoding="utf-8")
    profile_path = tmp / "person_profile.jsonl"
    profile_path.write_text(json.dumps(base_profile()) + "\n", encoding="utf-8")
    rows_path = tmp / "rows.jsonl"
    rows_path.write_text(json.dumps(base_stage_a_row()) + "\n", encoding="utf-8")
    persons_path = tmp / "persons.jsonl"
    persons_path.write_text(
        json.dumps({"player_url": URL, "display_names_raw": ["Test Person"], "years": [2018]}) + "\n",
        encoding="utf-8")
    for name in ("b3_manifest", "stage_a_manifest", "fitzroy_register", "fitzroy_manifest",
                "fitzroy_contract", "ledger", "aliases"):
        (tmp / f"{name}.json").write_text("{}", encoding="utf-8")
    (tmp / "fitzroy_contract.json").write_text(json.dumps(
        {"source_row_corrections": {"rules": []}, "profile_url_continuity": {"rules": []}}),
        encoding="utf-8")
    (tmp / "ledger.json").write_text(json.dumps({"decisions": []}), encoding="utf-8")
    (tmp / "aliases.json").write_text(json.dumps({"aliases": []}), encoding="utf-8")
    (tmp / "fitzroy_index.json").write_text(
        json.dumps({IDENTITY: base_fitzroy_record()}), encoding="utf-8")
    (tmp / "awards.csv").write_text("player_id,display_name,afltables_profile_url\n", encoding="utf-8")
    (tmp / "brownlow.csv").write_text(
        "bootstrap_player_id,display_name,afltables_profile_url,evidence,recovery_profile_url\n",
        encoding="utf-8")
    return tmp, label


fixture_dir, fixture_label = build_fixture_run()


def run_fixture_cli(extra: list[str]) -> subprocess.CompletedProcess:
    d = fixture_dir
    cmd = [sys.executable, str(TOOL_DIR / "review_person_bridge_offline.py"),
          "--label", fixture_label,
          "--sample", str(d / f"bridge-review-{fixture_label}.json"),
          "--parent", str(d / f"draftguru-person-bridge-{fixture_label}.json"),
          "--child", str(d / f"draftguru-person-bridge-{fixture_label}.afldb_test.json"),
          "--b3-manifest", str(d / "b3_manifest.json"), "--profile", str(d / "person_profile.jsonl"),
          "--stage-a-manifest", str(d / "stage_a_manifest.json"),
          "--stage-a-rows", str(d / "rows.jsonl"), "--stage-a-persons", str(d / "persons.jsonl"),
          "--fitzroy-register", str(d / "fitzroy_register.json"),
          "--fitzroy-manifest", str(d / "fitzroy_manifest.json"),
          "--fitzroy-contract", str(d / "fitzroy_contract.json"),
          "--ledger", str(d / "ledger.json"), "--aliases", str(d / "aliases.json"),
          "--awards-census", str(d / "awards.csv"), "--brownlow-census", str(d / "brownlow.csv"),
          "--fitzroy-index-json", str(d / "fitzroy_index.json"),
          "--skip-fitzroy-byte-verify", "--expect-total-rows", "1",
          "--print-rows-sha256-only", *extra]
    return subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT)


run1 = run_fixture_cli([])
run2 = run_fixture_cli([])
check("11a both fixture runs exit 0", run1.returncode == 0 and run2.returncode == 0,
      f"{run1.returncode} {run1.stderr}\n{run2.returncode} {run2.stderr}")
check("11b identical rows_sha256 across two independent process runs",
      run1.stdout.strip() == run2.stdout.strip() and run1.stdout.strip() != "",
      f"{run1.stdout!r} vs {run2.stdout!r}")

print()
print("12. refusal on input-hash mismatch, row-count mismatch, deployment-as-parent")

wrong_hash = run_fixture_cli(["--expect-sample-sha256", "0" * 64])
check("12a wrong --expect-sample-sha256 refuses (exit 1)", wrong_hash.returncode == 1,
      str(wrong_hash.returncode))
check("12b refusal message names the mismatch", "does not match expected" in wrong_hash.stderr,
      wrong_hash.stderr)

wrong_count = run_fixture_cli(["--expect-total-rows", "997"])
check("12c wrong row count refuses (exit 1)", wrong_count.returncode == 1, str(wrong_count.returncode))

# deployment passed as --parent
dep_as_parent = fixture_dir / f"draftguru-person-bridge-{fixture_label}.afldb_test.json"
d = fixture_dir
cmd = [sys.executable, str(TOOL_DIR / "review_person_bridge_offline.py"),
      "--label", fixture_label,
      "--sample", str(d / f"bridge-review-{fixture_label}.json"),
      "--parent", str(dep_as_parent),   # deliberately the DEPLOYMENT child
      "--child", str(d / f"draftguru-person-bridge-{fixture_label}.afldb_test.json"),
      "--b3-manifest", str(d / "b3_manifest.json"), "--profile", str(d / "person_profile.jsonl"),
      "--stage-a-manifest", str(d / "stage_a_manifest.json"),
      "--stage-a-rows", str(d / "rows.jsonl"), "--stage-a-persons", str(d / "persons.jsonl"),
      "--fitzroy-register", str(d / "fitzroy_register.json"),
      "--fitzroy-manifest", str(d / "fitzroy_manifest.json"),
      "--fitzroy-contract", str(d / "fitzroy_contract.json"),
      "--ledger", str(d / "ledger.json"), "--aliases", str(d / "aliases.json"),
      "--awards-census", str(d / "awards.csv"), "--brownlow-census", str(d / "brownlow.csv"),
      "--fitzroy-index-json", str(d / "fitzroy_index.json"),
      "--skip-fitzroy-byte-verify", "--expect-total-rows", "1", "--print-rows-sha256-only"]
dep_result = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT)
check("12d a deployment child passed as --parent refuses (exit 1)", dep_result.returncode == 1,
      str(dep_result.returncode))
check("12e refusal names the deployment kind", "deployment" in dep_result.stderr, dep_result.stderr)

print()
print("13. no socket opened, no database module imported")
tool_source_full = (TOOL_DIR / "review_person_bridge_offline.py").read_text(encoding="utf-8")
# Strip the module docstring (which DESCRIBES these prohibitions in prose, mentioning the
# very tokens being scanned for) before checking the executable source for real usage.
_docstring_match = re.match(r'\s*#![^\n]*\n"""[\s\S]*?"""', tool_source_full)
tool_source = tool_source_full[_docstring_match.end():] if _docstring_match else tool_source_full
check("13a no top-level or nested psycopg import", "psycopg" not in tool_source, tool_source[:0])
check("13b no *DATABASE_URL* environment read", "DATABASE_URL" not in tool_source)
check("13c no socket module import", not any(
    line.strip().startswith(("import socket", "from socket")) for line in tool_source.splitlines()))
check("13d no urllib/requests/http.client network import", not any(
    tok in tool_source for tok in ("import requests", "import urllib.request", "http.client")))


def raiser(*args, **kwargs):  # noqa: ANN002, ANN003
    raise AssertionError("network attempted")


import socket as _socket  # noqa: E402
_orig_socket = _socket.socket
_socket.socket = raiser
try:
    tool.evaluate_row(
        player_url=URL, stratum="random", sample_index=1, ordinal=1,
        parent_identity_by_url={URL: IDENTITY}, child_bridged={URL}, child_withheld_reason={},
        profile_by_url={URL: base_profile()}, stage_a_rows_by_url={URL: [base_stage_a_row()]},
        stage_a_persons_by_url={URL: {"display_names_raw": ["Test Person"], "years": [2018]}},
        fitzroy_index={IDENTITY: base_fitzroy_record()}, ledger_by_url={},
        aliases_by_identity={}, awards_census_by_identity={},
        numbering_urls=set(), spelling_urls=set(), schwerdt_urls=set(), continuity_paths=set())
    check("13e evaluate_row runs with socket.socket poisoned to raise -- no socket opened", True)
except AssertionError:
    check("13e evaluate_row runs with socket.socket poisoned to raise -- no socket opened", False)
finally:
    _socket.socket = _orig_socket

print()
print("14. build_fitzroy_index() skips a literal Age=\"0\" sentinel row when implying a "
     "birth year (AFLDB-ISSUE-222 recheck finding: Darren_Mead.html / Tim_Walsh.html)")


def write_player_stats_csv(path: Path, rows: list[dict]) -> None:
    fieldnames = ["url", "ID", "Player", "First.name", "Surname", "DOB", "Date", "Age",
                  "Playing.for", "Career.Games", "Goals"]
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


age_artifact_url = "https://afltables.com/afl/stats/players/A/Age_Artifact.html"
age_artifact_identity = "players/A/Age_Artifact.html"
never_valid_url = "https://afltables.com/afl/stats/players/A/Always_Zero.html"
never_valid_identity = "players/A/Always_Zero.html"

fitzroy_tmp = Path(tempfile.mkdtemp(prefix="afldb-i222-fitzroy-"))
write_player_stats_csv(fitzroy_tmp / "player_stats_1997.csv", [
    {"url": age_artifact_url, "ID": "1", "Player": "Age Artifact", "First.name": "Age",
     "Surname": "Artifact", "DOB": "", "Date": "1997-03-29", "Age": "0",
     "Playing.for": "Port Adelaide", "Career.Games": "1", "Goals": "0"},
    {"url": age_artifact_url, "ID": "1", "Player": "Age Artifact", "First.name": "Age",
     "Surname": "Artifact", "DOB": "", "Date": "1997-04-06", "Age": "26.0219028062971",
     "Playing.for": "Port Adelaide", "Career.Games": "2", "Goals": "0"},
    {"url": never_valid_url, "ID": "2", "Player": "Always Zero", "First.name": "Always",
     "Surname": "Zero", "DOB": "", "Date": "2005-05-14", "Age": "0",
     "Playing.for": "Western Bulldogs", "Career.Games": "1", "Goals": "1"},
])
fitzroy_manifest_fixture = {"files": [{"dataset": "player_stats", "filename": "player_stats_1997.csv"}]}
fitzroy_contract_fixture = {"source_row_corrections": {"rules": []},
                            "profile_url_continuity": {"rules": []}}
fitzroy_index_fixture = tool.build_fitzroy_index(
    fitzroy_tmp, fitzroy_manifest_fixture, fitzroy_contract_fixture)

check("14a earliest row (Age=\"0\") is skipped; implied_birth_year comes from the next valid row",
      fitzroy_index_fixture[age_artifact_identity]["implied_birth_year"] == 1971,
      str(fitzroy_index_fixture[age_artifact_identity]))
check("14b debut_date/debut_season still reflect the TRUE earliest row, not the valid-age row",
      fitzroy_index_fixture[age_artifact_identity]["debut_date"] == "1997-03-29"
      and fitzroy_index_fixture[age_artifact_identity]["debut_season"] == 1997,
      str(fitzroy_index_fixture[age_artifact_identity]))
check("14c a person whose every dated row is Age=\"0\" gets implied_birth_year=None, never a guess",
      fitzroy_index_fixture[never_valid_identity]["implied_birth_year"] is None,
      str(fitzroy_index_fixture[never_valid_identity]))
check("14d that person's debut_date is still recorded (the row exists; only the age is untrusted)",
      fitzroy_index_fixture[never_valid_identity]["debut_date"] == "2005-05-14")

print()
if failures:
    print(f"FAILED: {len(failures)} check(s): {', '.join(failures)}")
    raise SystemExit(1)
print("All DraftGuru offline-review checks hold.")
