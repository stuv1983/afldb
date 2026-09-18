#!/usr/bin/env python3
"""AFLDB-ISSUE-222 population-wide mislink scan -- DB-free contract checks for
tools/rebuild/draftguru/scan_person_bridge_population.py.

    python tests/python/draftguru_population_scan_contract.py

Exercises classify_population_row(), relisting_signature_match(),
probe_same_person_alternate_identity(), evaluate_candidate() and the
numbered/spelling candidate builders directly
against small hand-built fixtures -- NEVER the real 3,564-row parent bridge --
so every check here runs in well under a second and needs no accepted fitzRoy
bytes on disk. The real-data 3,564-row reconciliation and determinism are
proven separately by the actual population scan run (two full runs with
identical rows_sha256; see the population-scan manifest and sign-off pack).

No database, no network, no subprocess spawn except the CLI refusal checks at
the bottom, which invoke this same script's own CLI against tiny generated
fixture files (never the real, tracked immutable inputs).
"""

from __future__ import annotations

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
import scan_person_bridge_population as scan  # noqa: E402

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' -- ' + detail) if detail else ''}")
        failures.append(name)


URL = "https://www.draftguru.com.au/players/test_person/1"
IDENTITY = "players/T/Test_Person.html"


def profile(identity=IDENTITY, count=1, title="Test Person (born 1969) - Draftguru",
           h2="Test Person"):
    return {
        "player_url": URL, "afltables_href_count": 1,
        "distinct_afltables_identity_count": count, "afltables_identity": identity,
        "page": {"title": title, "h2": h2, "heuristic_fields": {"dob_candidates": []}},
        "raw_filename": "test_person-1.html", "raw_sha256": "0" * 64,
    }


def stage_a_row(**overrides):
    row = {"player_url": URL, "draft_year": 1990, "event_type_raw": "National",
          "pick_number": 68, "club_name_raw": "Brisbane", "age_raw": "21yr",
          "parity_only": {"games": "0", "goals": "0"}}
    row.update(overrides)
    return row


def fitzroy_record(**overrides):
    rec = {
        "fitzroy_ids": ["1"], "distinct_fitzroy_id_count": 1, "players": ["Test Person"],
        "first_names": ["Test"], "surnames": ["Person"], "dob_years": [1969],
        "implied_birth_year": 1969, "debut_date": "1986-03-01", "debut_season": 1986,
        "last_season": 1988, "career_games": 22, "goals_sum": 3, "na_goals": 0,
        "clubs": ["Geelong"],
    }
    rec.update(overrides)
    return rec


def evaluate_population(*, prof=None, stage_a_rows=None, fitzroy_rec=None, child_status="bridged",
                        ledger=None, identity=IDENTITY, fitzroy_extra: dict | None = None):
    profile_by_url = {URL: prof} if prof is not None else {}
    rows = stage_a_rows if stage_a_rows is not None else [stage_a_row()]
    stage_a_rows_by_url = {URL: rows} if rows else {}
    stage_a_persons_by_url = {URL: {"display_names_raw": ["Test Person"], "years": [1990]}}
    fitzroy_index = dict(fitzroy_extra or {})
    if fitzroy_rec is not None:
        fitzroy_index[identity] = fitzroy_rec
    child_bridged = {URL} if child_status == "bridged" else set()
    child_withheld_reason = {URL: "target_not_registered"} if child_status == "target_not_registered" else {}
    base_row = tool.evaluate_row(
        player_url=URL, stratum="population", sample_index=1, ordinal=1,
        parent_identity_by_url={URL: identity}, child_bridged=child_bridged,
        child_withheld_reason=child_withheld_reason, profile_by_url=profile_by_url,
        stage_a_rows_by_url=stage_a_rows_by_url, stage_a_persons_by_url=stage_a_persons_by_url,
        fitzroy_index=fitzroy_index, ledger_by_url=ledger or {},
        aliases_by_identity={}, awards_census_by_identity={},
        numbering_urls=set(), spelling_urls=set(), schwerdt_urls=set(), continuity_paths=set())
    return scan.classify_population_row(base_row, fitzroy_index)


# ---------------------------------------------------------------------------
# 1. The relisting-signature class (independent review, 2026-09-18): a
#    zero-PER-ENTRY-game DraftGuru listing whose captured href resolves to a
#    retained target with a genuine played career that had already ended at
#    or before the listing year. Exercised across the real event-type mix
#    (National, Trade, Pre-Season, Mid-Season) so a Trade-only person (no
#    National row at all) is covered. v1 of this scanner called this
#    `confirmed_source_mislink`; the independent review found that invalid
#    (per-entry games != career games; Stage A age agrees with the retained
#    birth year on every one of these rows -- evidence FOR the same person).
# ---------------------------------------------------------------------------
print("1. relisting_signature_review signature (zero-per-entry-game listing -> already-ended career)")

for event_type, draft_year in [("National", 1990), ("Pre-Season", 1989), ("Mid-Season", 1989)]:
    r = evaluate_population(
        prof=profile(), fitzroy_rec=fitzroy_record(),
        stage_a_rows=[stage_a_row(event_type_raw=event_type, draft_year=draft_year)])
    check(f"1a {event_type} zero-per-entry-game listing, career ended earlier -> relisting_signature_review",
         r["population_outcome"] == "relisting_signature_review",
         str((r["population_outcome"], r["population_reason"])))
    check(f"1a' {event_type} row retains BIRTH_YEAR_CONSISTENT (age agreement, not guessed away)",
         "BIRTH_YEAR_CONSISTENT" in r["reason_codes"], r["reason_codes"])

# Trade-only person (no recruitment row at all): must still surface via the
# earliest_trade_year fallback, mirroring craig_somerville/1, tim_bourke/1,
# gary_keane/1, john_ahern/1 in the real population.
r = evaluate_population(
    prof=profile(), fitzroy_rec=fitzroy_record(last_season=1986),
    stage_a_rows=[stage_a_row(event_type_raw="Trade", draft_year=1988)])
check("1b trade-only zero-per-entry-game entry, career ended before trade year -> relisting_signature_review",
     r["population_outcome"] == "relisting_signature_review", str(r["population_reason"]))
check("1c trade-only row carries the relisting-signature reason",
     scan.POPULATION_REASON_RELISTING == r["population_reason"])
check("1d relisting row's disposition is operator_adjudication_required, never an automatic exclusion",
     r["recommended_disposition"] == "operator_adjudication_required", r["recommended_disposition"])


# ---------------------------------------------------------------------------
# 1e. The arbitrary one-year boundary must not change the classification: a
#     retained career ending exactly IN the listing year (v1: population_clean
#     via SPAN_CONTAINS_EARLIEST_RECRUITMENT_YEAR) and one ending exactly ONE
#     YEAR BEFORE it (v1: confirmed_source_mislink via CAREER_ENDED_BEFORE_
#     EARLIEST_RECRUITMENT) must reach the SAME outcome and reason -- proving
#     the correction is not keyed to that boundary at all.
# ---------------------------------------------------------------------------
print("1e. the one-year career-end/recruitment boundary no longer changes classification")

r_at_boundary = evaluate_population(
    prof=profile(), fitzroy_rec=fitzroy_record(debut_season=1986, last_season=1990, career_games=22),
    stage_a_rows=[stage_a_row(event_type_raw="Pre-Season", draft_year=1990)])
r_before_boundary = evaluate_population(
    prof=profile(), fitzroy_rec=fitzroy_record(debut_season=1986, last_season=1989, career_games=22),
    stage_a_rows=[stage_a_row(event_type_raw="Pre-Season", draft_year=1990)])
check("1e-1 career ended IN the listing year -> relisting_signature_review",
     r_at_boundary["population_outcome"] == "relisting_signature_review", str(r_at_boundary["population_outcome"]))
check("1e-2 career ended ONE YEAR BEFORE the listing year -> the SAME outcome",
     r_before_boundary["population_outcome"] == r_at_boundary["population_outcome"] == "relisting_signature_review",
     str((r_before_boundary["population_outcome"], r_at_boundary["population_outcome"])))
check("1e-3 both reach the identical population_reason (no boundary-dependent wording)",
     r_before_boundary["population_reason"] == r_at_boundary["population_reason"] == scan.POPULATION_REASON_RELISTING)


# ---------------------------------------------------------------------------
# 1f. Per-entry zero games must never be read as zero CAREER games: a person
#     with an early zero-game listing but a LATER DraftGuru entry recording
#     real games, matched to a retained target whose career genuinely
#     continues past both events, must stay population_clean.
# ---------------------------------------------------------------------------
print("1f. per-entry zero games on one listing is not zero career games overall")

r = evaluate_population(
    prof=profile(title="Test Person (born 1969) - Draftguru"),
    fitzroy_rec=fitzroy_record(debut_season=1990, last_season=1998, career_games=120),
    stage_a_rows=[
        stage_a_row(event_type_raw="National", draft_year=1989, parity_only={"games": "0", "goals": "0"}),
        stage_a_row(event_type_raw="Pre-Season", draft_year=1990, parity_only={"games": "120", "goals": "10"}),
    ])
check("1f a later DraftGuru entry recording real games keeps the row population_clean",
     r["population_outcome"] == "population_clean", str((r["population_outcome"], r["reason_codes"])))


# ---------------------------------------------------------------------------
# 1g. A genuine DOB/career contradiction sharing the same zero-games/
#     career-ended shape must still be represented as suspected_source_mislink,
#     never guessed away into the neutral relisting class (independent review
#     item 5).
# ---------------------------------------------------------------------------
print("1g. a genuine birth-year contradiction is never absorbed into relisting_signature_review")

r = evaluate_population(
    prof=profile(title="Test Person (born 1990) - Draftguru"),
    fitzroy_rec=fitzroy_record(dob_years=[1930], implied_birth_year=1930),
    stage_a_rows=[stage_a_row(event_type_raw="National", draft_year=1990)])
check("1g a real birth-year conflict on the same shape -> suspected_source_mislink, not relisting",
     r["population_outcome"] == "suspected_source_mislink", str(r["population_outcome"]))
check("1g' the fired contradiction reason names BIRTH_YEAR_CONFLICT explicitly",
     "BIRTH_YEAR_CONFLICT" in r["population_reason"], r["population_reason"])


# ---------------------------------------------------------------------------
# 2. A genuine later veteran / re-draft must NOT be flagged.
# ---------------------------------------------------------------------------
print("2. genuine later re-draft / veteran is never flagged")

r = evaluate_population(
    prof=profile(title="Test Person (born 1969) - Draftguru"),
    fitzroy_rec=fitzroy_record(debut_season=1986, last_season=2000, career_games=180),
    stage_a_rows=[stage_a_row(event_type_raw="National", draft_year=1990,
                              parity_only={"games": "180", "goals": "3"})])
check("2a career continues through and past the recruitment year -> population_clean",
     r["population_outcome"] == "population_clean", str((r["population_outcome"], r["reason_codes"])))


# ---------------------------------------------------------------------------
# 3. A trade/re-listing of an established player (nonzero games, career spans
#    the trade year) must not be flagged.
# ---------------------------------------------------------------------------
print("3. trade/re-listing of an established player is never flagged")

r = evaluate_population(
    prof=profile(title="Test Person (born 1978) - Draftguru"),
    fitzroy_rec=fitzroy_record(dob_years=[1978], debut_season=1997, last_season=2009,
                               career_games=219, clubs=["Richmond", "Western Bulldogs"]),
    stage_a_rows=[
        stage_a_row(event_type_raw="National", draft_year=1996, club_name_raw="Western Bulldogs",
                    parity_only={"games": "219", "goals": "1"}),
        stage_a_row(event_type_raw="Trade", draft_year=2003, club_name_raw="Richmond",
                    parity_only={"games": "219", "goals": "1"}),
    ])
check("3a established player later traded -> population_clean",
     r["population_outcome"] == "population_clean", str(r["population_outcome"]))


# ---------------------------------------------------------------------------
# 4. Age="0" sentinel: the population scanner reuses build_fitzroy_index
#    verbatim, so the AGE_ARTIFACT_FLOOR correction is inherited unchanged.
# ---------------------------------------------------------------------------
print("4. Age=\"0\" sentinel correction is inherited from the reused review tool")

check("4a AGE_ARTIFACT_FLOOR constant is shared (single source of truth)",
     scan.base.AGE_ARTIFACT_FLOOR == tool.AGE_ARTIFACT_FLOOR == 5.0)
_scan_src = (TOOL_DIR / "scan_person_bridge_population.py").read_text(encoding="utf-8")
check("4b scan module does not define its own AGE_ARTIFACT_FLOOR constant (mentions in prose only)",
     not re.search(r"^AGE_ARTIFACT_FLOOR\s*=", _scan_src, re.MULTILINE))


# ---------------------------------------------------------------------------
# 5. DOB / birth-year tolerance in the alternate-identity probe.
# ---------------------------------------------------------------------------
print("5. birth-year tolerance in evaluate_candidate()")

common = dict(candidate="players/A/Alt_Name.html", visible_name="Alt Name",
             dg_games=20, dg_clubs={"Essendon"}, stage_a_block={
                 "earliest_original_recruitment": {"draft_year": 2000, "event_type_raw": "National"}},
             recruitment_year=2000)
target = fitzroy_record(players=["Alt Name"], surnames=["Name"], first_names=["Alt"],
                        dob_years=[], implied_birth_year=1981, debut_season=2000,
                        last_season=2010, career_games=20, clubs=["Essendon"])
m = scan.evaluate_candidate(dg_birth_year=1982, retained_target=target, **common)
check("5a |delta|==1 is consistent -> candidate accepted", m is not None, str(m))

m = scan.evaluate_candidate(dg_birth_year=1979, retained_target=target, **common)
check("5b |delta|==2 conflicts -> candidate rejected", m is None, str(m))

m = scan.evaluate_candidate(dg_birth_year=None, retained_target=target, **common)
check("5c missing DraftGuru birth year -> candidate rejected (never guessed)", m is None, str(m))

target_no_dob = fitzroy_record(players=["Alt Name"], surnames=["Name"], first_names=["Alt"],
                               dob_years=[], implied_birth_year=None, debut_season=2000,
                               last_season=2010, career_games=20, clubs=["Essendon"])
m = scan.evaluate_candidate(dg_birth_year=1982, retained_target=target_no_dob, **common)
check("5d missing retained birth year -> candidate rejected (never guessed)", m is None, str(m))


# ---------------------------------------------------------------------------
# 6. Same exact name, career already ended -> still requires operator
#    adjudication, never cleared to population_clean by name equality alone.
# ---------------------------------------------------------------------------
print("6. same exact name, career already ended -> relisting_signature_review, not clean")

r = evaluate_population(
    prof=profile(title="Test Person (born 1969) - Draftguru", h2="Test Person"),
    fitzroy_rec=fitzroy_record(players=["Test Person"], surnames=["Person"], first_names=["Test"]),
    stage_a_rows=[stage_a_row(event_type_raw="National", draft_year=1990)])
check("6a exact-name match with 0 games vs. an earlier-ended established career still requires review",
     r["population_outcome"] == "relisting_signature_review", r["population_outcome"])


# ---------------------------------------------------------------------------
# 7. Same person with a spelling variation -> source_discrepancy_same_person
#    (mirrors stephen_schwerdt/1 -> players/S/Steven_Schwerdt.html).
# ---------------------------------------------------------------------------
print("7. spelling-variant href -> source_discrepancy_same_person via the alternate probe")

schwerdt_target = fitzroy_record(
    players=["Stephen Schwerdt"], surnames=["Schwerdt"], first_names=["Stephen"],
    dob_years=[1968], implied_birth_year=1968, debut_season=1992, last_season=1994,
    career_games=25, clubs=["Adelaide"])
r = evaluate_population(
    prof=profile(identity="players/S/Steven_Schwerdt.html",
                title="Stephen Schwerdt (born 1968) - Draftguru", h2="Stephen Schwerdt"),
    identity="players/S/Steven_Schwerdt.html", child_status="target_not_registered",
    stage_a_rows=[stage_a_row(event_type_raw="National", draft_year=1989, club_name_raw="West Coast",
                              parity_only={"games": "25", "goals": "4"})],
    fitzroy_extra={"players/S/Stephen_Schwerdt.html": schwerdt_target})
check("7a Steven-href/Stephen-page resolves to the correctly-spelled registered identity",
     r["population_outcome"] == "source_discrepancy_same_person", str(r["population_outcome"]))
check("7b corrected_identity names the real registered path",
     r.get("corrected_identity") == "players/S/Stephen_Schwerdt.html", r.get("corrected_identity"))
check("7c disposition is manual_curation, never an auto-applied bridge",
     r["recommended_disposition"] == "manual_curation", r["recommended_disposition"])


# ---------------------------------------------------------------------------
# 8. A numeric-suffix identity is only promoted with club overlap; without it
#    the probe must not force a match.
# ---------------------------------------------------------------------------
print("8. numeric-suffix candidates require club overlap; ambiguity is never forced")

suffix_target = fitzroy_record(
    players=["Keith Thomas"], surnames=["Thomas"], first_names=["Keith"], dob_years=[1961],
    implied_birth_year=1961, debut_season=1987, last_season=1988, career_games=28,
    clubs=["Fitzroy"])
r = evaluate_population(
    prof=profile(identity="players/K/Keith_Thomas.html", title="Keith Thomas (born 1961) - Draftguru",
                h2="Keith Thomas"),
    identity="players/K/Keith_Thomas.html", child_status="target_not_registered",
    stage_a_rows=[stage_a_row(event_type_raw="National", draft_year=1982, club_name_raw="Melbourne",
                              parity_only={"games": "28", "goals": "15"})],
    fitzroy_extra={"players/K/Keith_Thomas0.html": suffix_target})
check("8a suffix candidate without club overlap -> insufficient_evidence, never forced",
     r["population_outcome"] == "insufficient_evidence", str(r["population_outcome"]))

# Two equally-corroborated candidates: still never forced.
alt_target = dict(suffix_target)
r2 = evaluate_population(
    prof=profile(identity="players/K/Keith_Thomas.html", title="Keith Thomas (born 1961) - Draftguru",
                h2="Keith Thomas"),
    identity="players/K/Keith_Thomas.html", child_status="target_not_registered",
    stage_a_rows=[stage_a_row(event_type_raw="National", draft_year=1982, club_name_raw="Fitzroy",
                              parity_only={"games": "28", "goals": "15"})],
    fitzroy_extra={"players/K/Keith_Thomas0.html": suffix_target,
                  "players/K/Keith_Thomas1.html": alt_target})
check("8b two equally-strong candidates -> ambiguous, insufficient_evidence (never guessed)",
     r2["population_outcome"] == "insufficient_evidence", str(r2["population_outcome"]))


# ---------------------------------------------------------------------------
# 9. A genuine zero-game legitimate draftee with no retained evidence at all
#    (unregistered, no plausible alternate) is withheld, never force-flagged.
# ---------------------------------------------------------------------------
print("9. legitimate zero-game / unregistered draftee -> insufficient_evidence, not a mislink")

r = evaluate_population(
    prof=profile(identity="players/N/Nobody_Special.html", title="Nobody Special (born 2007) - Draftguru",
                h2="Nobody Special"),
    identity="players/N/Nobody_Special.html", child_status="target_not_registered",
    stage_a_rows=[stage_a_row(event_type_raw="National", draft_year=2025, club_name_raw="Essendon",
                              parity_only={"games": "0", "goals": "0"})],
    fitzroy_extra={})
check("9a no retained evidence anywhere -> insufficient_evidence",
     r["population_outcome"] == "insufficient_evidence", str(r["population_outcome"]))
check("9b recommended disposition is withhold (no forced match)",
     r["recommended_disposition"] == "withhold", r["recommended_disposition"])


# ---------------------------------------------------------------------------
# 10. Snapshot-cutoff (2025 draftee not yet in the accepted 1897-2025
#     baseline) -> insufficient_evidence, not mislabelled staleness.
# ---------------------------------------------------------------------------
print("10. snapshot-cutoff draftee -> insufficient_evidence (TARGET_NOT_REGISTERED_NO_EVIDENCE)")

r = evaluate_population(
    prof=profile(identity="players/Z/Zoe_Future.html", title="Zoe Future (born 2007) - Draftguru",
                h2="Zoe Future"),
    identity="players/Z/Zoe_Future.html", child_status="target_not_registered",
    stage_a_rows=[stage_a_row(event_type_raw="National", draft_year=2025, club_name_raw="Carlton",
                              parity_only={"games": "10", "goals": "2"})],
    fitzroy_extra={})
check("10a not yet registered, zero candidates -> TARGET_NOT_REGISTERED_NO_EVIDENCE",
     r["population_reason"] == "TARGET_NOT_REGISTERED_NO_EVIDENCE", r["population_reason"])


# ---------------------------------------------------------------------------
# 11. Human authority overlap: an agreeing ledger decision on a clean row is
#     surfaced distinctly, never silently absorbed into population_clean.
# ---------------------------------------------------------------------------
print("11. human ledger overlap is surfaced distinctly")

ledger_agree = {URL: {"player_url": URL, "decision": "linked",
                      "target": {"source": "afltables", "external_id": IDENTITY}}}
r = evaluate_population(prof=profile(), fitzroy_rec=fitzroy_record(
    debut_season=1986, last_season=2000, career_games=180),
    stage_a_rows=[stage_a_row(event_type_raw="National", draft_year=1990,
                              parity_only={"games": "180", "goals": "3"})],
    ledger=ledger_agree)
check("11a agreeing ledger decision on an otherwise-clean row -> human_authority_overlap",
     r["population_outcome"] == "human_authority_overlap", str(r["population_outcome"]))

ledger_disagree = {URL: {"player_url": URL, "decision": "linked",
                         "target": {"source": "afltables", "external_id": "players/X/Someone_Else.html"}}}
r = evaluate_population(prof=profile(), fitzroy_rec=fitzroy_record(
    debut_season=1986, last_season=2000, career_games=180),
    stage_a_rows=[stage_a_row(event_type_raw="National", draft_year=1990,
                              parity_only={"games": "180", "goals": "3"})],
    ledger=ledger_disagree)
check("11b disagreeing ledger decision surfaces as a mislink signal, not silently overlapped",
     r["population_outcome"] == "suspected_source_mislink", str(r["population_outcome"]))


# ---------------------------------------------------------------------------
# 12. Pure candidate builders.
# ---------------------------------------------------------------------------
print("12. numbered_candidates() / spelling_candidate() pure functions")

nc = scan.numbered_candidates("players/T/Tom_Murphy.html")
check("12a numbered candidates include the real suffix 0", "players/T/Tom_Murphy0.html" in nc)
check("12b numbered candidates never include the original identity", "players/T/Tom_Murphy.html" not in nc)

sc = scan.spelling_candidate("players/S/Steven_Schwerdt.html", "Stephen Schwerdt")
check("12c spelling candidate substitutes the visible name into the same directory",
     sc == "players/S/Stephen_Schwerdt.html", sc)
check("12d spelling candidate is None without a visible name",
     scan.spelling_candidate("players/S/Steven_Schwerdt.html", None) is None)


# ---------------------------------------------------------------------------
# 13. Deterministic ordering and hashing.
# ---------------------------------------------------------------------------
print("13. deterministic rows_sha256 across two independent constructions")

fixture_rows = [
    evaluate_population(prof=profile(), fitzroy_rec=fitzroy_record()),
    evaluate_population(prof=profile(title="Test Person (born 2005) - Draftguru"),
                        fitzroy_rec=fitzroy_record(debut_season=1986, last_season=2005,
                                                   career_games=180),
                        stage_a_rows=[stage_a_row(parity_only={"games": "180", "goals": "3"})]),
]
h1 = tool.sha256_bytes(tool.canonical_json_bytes(fixture_rows))
fixture_rows_2 = [
    evaluate_population(prof=profile(), fitzroy_rec=fitzroy_record()),
    evaluate_population(prof=profile(title="Test Person (born 2005) - Draftguru"),
                        fitzroy_rec=fitzroy_record(debut_season=1986, last_season=2005,
                                                   career_games=180),
                        stage_a_rows=[stage_a_row(parity_only={"games": "180", "goals": "3"})]),
]
h2 = tool.sha256_bytes(tool.canonical_json_bytes(fixture_rows_2))
check("13a identical fixture inputs reproduce an identical rows_sha256", h1 == h2, f"{h1} != {h2}")


# ---------------------------------------------------------------------------
# 14. No network, no database.
# ---------------------------------------------------------------------------
print("14. no network, no database module use")

import ast as _ast  # noqa: E402

src = (TOOL_DIR / "scan_person_bridge_population.py").read_text(encoding="utf-8")
_tree = _ast.parse(src)
_module_docstring = _ast.get_docstring(_tree) or ""
_src_without_docstring = src.replace(_module_docstring, "")
_import_lines = [ln for ln in src.splitlines() if re.match(r"^\s*(import|from)\s+\S", ln)]
check("14a no psycopg import", not any("psycopg" in ln for ln in _import_lines), _import_lines)
check("14b no *DATABASE_URL* environment read outside the docstring",
     "DATABASE_URL" not in _src_without_docstring)
check("14c no socket/urllib/requests/http.client import", not any(
    re.search(r"\b(socket|urllib|requests|http\.client)\b", ln) for ln in _import_lines), _import_lines)


# ---------------------------------------------------------------------------
# 15. CLI refusal checks against tiny generated fixture files (never the real
#     tracked immutable inputs).
# ---------------------------------------------------------------------------
print("15. CLI refusals on bad input")

SCAN_SCRIPT = TOOL_DIR / "scan_person_bridge_population.py"


def run_cli(tmp: Path, *, parent_kind="source-evidence", child_kind="deployment",
           expect_total_rows=1, expect_parent_sha256=None) -> subprocess.CompletedProcess:
    parent = {"bridges": [{"player_url": URL, "afltables_external_id": IDENTITY}], "withheld": []}
    if parent_kind == "deployment":
        parent["kind"] = "deployment"
    child = {"bridges": [{"player_url": URL}], "withheld": []}
    if child_kind == "deployment":
        child["kind"] = "deployment"

    def w(name, payload):
        p = tmp / name
        p.write_text(json.dumps(payload), encoding="utf-8")
        return p

    parent_path = w("parent.json", parent)
    child_path = w("child.json", child)
    b3 = w("b3.json", {})
    profile_path = tmp / "profile.jsonl"
    profile_path.write_text(json.dumps(profile()) + "\n", encoding="utf-8")
    stage_a_manifest = w("stage_a_manifest.json", {})
    stage_a_rows_path = tmp / "stage_a_rows.jsonl"
    stage_a_rows_path.write_text(json.dumps(stage_a_row()) + "\n", encoding="utf-8")
    stage_a_persons_path = tmp / "stage_a_persons.jsonl"
    stage_a_persons_path.write_text(
        json.dumps({"player_url": URL, "display_names_raw": ["Test Person"], "years": [1990]}) + "\n",
        encoding="utf-8")
    fitzroy_register = w("fitzroy_register.json", {"baselines": []})
    fitzroy_manifest = w("fitzroy_manifest.json", {"files": []})
    fitzroy_contract = w("fitzroy_contract.json", {})
    ledger = w("ledger.json", {"decisions": []})
    aliases = w("aliases.json", {"aliases": []})
    awards = tmp / "awards.csv"
    awards.write_text("afltables_profile_url,display_name\n", encoding="utf-8")

    cmd = [sys.executable, str(SCAN_SCRIPT),
          "--parent", str(parent_path), "--child", str(child_path),
          "--b3-manifest", str(b3), "--profile", str(profile_path),
          "--stage-a-manifest", str(stage_a_manifest), "--stage-a-rows", str(stage_a_rows_path),
          "--stage-a-persons", str(stage_a_persons_path), "--fitzroy-register", str(fitzroy_register),
          "--fitzroy-manifest", str(fitzroy_manifest), "--fitzroy-contract", str(fitzroy_contract),
          "--ledger", str(ledger), "--aliases", str(aliases), "--awards-census", str(awards),
          "--fitzroy-index-json", str(w("fitzroy_index.json", {IDENTITY: fitzroy_record()})),
          "--skip-fitzroy-byte-verify", "--expect-total-rows", str(expect_total_rows),
          "--print-rows-sha256-only"]
    if expect_parent_sha256:
        cmd += ["--expect-parent-sha256", expect_parent_sha256]
    return subprocess.run(cmd, capture_output=True, text=True, cwd=str(ROOT))


with tempfile.TemporaryDirectory() as td:
    tmp = Path(td)
    cp = run_cli(tmp)
    check("15a well-formed tiny fixture succeeds", cp.returncode == 0, cp.stderr)

with tempfile.TemporaryDirectory() as td:
    tmp = Path(td)
    cp = run_cli(tmp, parent_kind="deployment")
    check("15b a deployment parent is refused",
         cp.returncode != 0 and "deployment" in cp.stderr, cp.stderr)

with tempfile.TemporaryDirectory() as td:
    tmp = Path(td)
    cp = run_cli(tmp, child_kind="source-evidence")
    check("15c a non-deployment child is refused",
         cp.returncode != 0 and "deployment" in cp.stderr, cp.stderr)

with tempfile.TemporaryDirectory() as td:
    tmp = Path(td)
    cp = run_cli(tmp, expect_total_rows=999)
    check("15d a row-count mismatch is refused",
         cp.returncode != 0 and "carries" in cp.stderr, cp.stderr)

with tempfile.TemporaryDirectory() as td:
    tmp = Path(td)
    cp = run_cli(tmp, expect_parent_sha256="0" * 64)
    check("15e a parent hash mismatch is refused",
         cp.returncode != 0 and "sha256" in cp.stderr, cp.stderr)


# ---------------------------------------------------------------------------
print()
if failures:
    print(f"FAILED: {len(failures)} check(s) -- {failures}")
    sys.exit(1)
print("All checks passed.")
sys.exit(0)
