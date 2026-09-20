#!/usr/bin/env python3
"""AFLDB-ISSUE-228 Stage S7 -- DB-free contract checks for
tools/migration/build_brownlow_season_artefact_from_afl_api.py (the offline
completed-season Brownlow artefact builder).

    python tests/python/afl_api_brownlow_season_artefact_contract.py

Every check exercises the module's pure functions against fabricated feed
payloads, a fabricated Stage S5 bridge artefact, or a temporary directory
standing in for a snapshot/output path. No real AFL API snapshot, no real
afldb_test connection, no network request, no Git command.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOL_DIR = ROOT / "tools" / "migration"
sys.path.insert(0, str(TOOL_DIR))

import build_brownlow_season_artefact_from_afl_api as m  # noqa: E402

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' -- ' + detail) if detail else ''}")
        failures.append(name)


def section(title: str) -> None:
    print(f"\n{title}")


def raises(exc_type, fn, *args, **kwargs) -> bool:
    try:
        fn(*args, **kwargs)
        return False
    except exc_type:
        return True


# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------


def vote_entry(player_id: str, team_id: str, votes: float) -> dict:
    return {"player": {"playerId": player_id}, "team": {"teamId": team_id}, "votes": votes}


def match_votes_payload(status: str, matches: list[dict]) -> dict:
    return {"seasonId": "CD_S2025014", "status": status, "matchVotes": matches}


def leaderboard_payload(status: str, entries: list[dict]) -> dict:
    return {"seasonId": "CD_S2025014", "status": status, "teamFilter": "ALL", "leaderboard": entries}


def leaderboard_entry(player_id: str, total_votes: float, eligible: bool = True) -> dict:
    return {
        "player": {"playerId": player_id}, "team": {"teamId": "CD_T10"},
        "totalVotes": total_votes, "eligible": eligible, "winner": False, "leader": False,
        "roundByRoundVotes": [],
    }


# A well-formed one-match season: 3 players, standard 3-2-1, both feeds CONCLUDED.
STANDARD_MATCH = {
    "matchId": "CD_M1", "roundNumber": 5.0,
    "votes": [
        vote_entry("CD_I1", "CD_T10", 3.0),
        vote_entry("CD_I2", "CD_T20", 2.0),
        vote_entry("CD_I3", "CD_T10", 1.0),
    ],
}


# ---------------------------------------------------------------------------
# parse_match_votes / parse_leaderboard -- shape and vote-set integrity
# ---------------------------------------------------------------------------

section("parse_match_votes")

sets, status = m.parse_match_votes(match_votes_payload("CONCLUDED", [STANDARD_MATCH]))
check("one well-formed match parses", len(sets) == 1)
check("status carried through", status == "CONCLUDED")
check("api_round_number coerced to int", sets[0].api_round_number == 5 and isinstance(sets[0].api_round_number, int))
check("three vote rows parsed in order", [v.votes for v in sets[0].votes] == [3, 2, 1])

section("D: malformed 3-2-1 vote set refuses")

bad_values = {**STANDARD_MATCH, "votes": [
    vote_entry("CD_I1", "CD_T10", 3.0), vote_entry("CD_I2", "CD_T20", 3.0), vote_entry("CD_I3", "CD_T10", 1.0),
]}
check("wrong vote values [3,3,1] refuses",
      raises(m.BrownlowArtefactSourceError, m.parse_match_votes, match_votes_payload("CONCLUDED", [bad_values])))

short_set = {**STANDARD_MATCH, "votes": STANDARD_MATCH["votes"][:2]}
check("only 2 vote rows refuses",
      raises(m.BrownlowArtefactSourceError, m.parse_match_votes, match_votes_payload("CONCLUDED", [short_set])))

non_integral = {**STANDARD_MATCH, "votes": [
    vote_entry("CD_I1", "CD_T10", 3.5), vote_entry("CD_I2", "CD_T20", 2.0), vote_entry("CD_I3", "CD_T10", 1.0),
]}
check("non-integral vote value refuses",
      raises(m.BrownlowArtefactSourceError, m.parse_match_votes, match_votes_payload("CONCLUDED", [non_integral])))

section("E: duplicate player in one vote set refuses")

dup_player = {**STANDARD_MATCH, "votes": [
    vote_entry("CD_I1", "CD_T10", 3.0), vote_entry("CD_I1", "CD_T10", 2.0), vote_entry("CD_I3", "CD_T10", 1.0),
]}
check("duplicate provider player id within a match refuses",
      raises(m.BrownlowArtefactSourceError, m.parse_match_votes, match_votes_payload("CONCLUDED", [dup_player])))

dup_match_id = [STANDARD_MATCH, {**STANDARD_MATCH}]
check("duplicate matchId across matchVotes refuses",
      raises(m.BrownlowArtefactSourceError, m.parse_match_votes, match_votes_payload("CONCLUDED", dup_match_id)))

section("parse_leaderboard")

entries, lb_status = m.parse_leaderboard(leaderboard_payload("CONCLUDED", [
    leaderboard_entry("CD_I1", 3.0), leaderboard_entry("CD_I2", 2.0, eligible=False),
]))
check("two leaderboard entries parsed", len(entries) == 2)
check("leaderboard status carried through", lb_status == "CONCLUDED")
check("eligible=false carried", entries[1].eligible is False)
check("eligible defaults true", entries[0].eligible is True)

check("duplicate leaderboard player refuses",
      raises(m.BrownlowArtefactSourceError, m.parse_leaderboard,
             leaderboard_payload("CONCLUDED", [leaderboard_entry("CD_I1", 3.0), leaderboard_entry("CD_I1", 1.0)])))


# ---------------------------------------------------------------------------
# C: completion gate -- LIVE/in-progress source refuses
# ---------------------------------------------------------------------------

section("C: completion gate")

check("both CONCLUDED passes", m.require_concluded("CONCLUDED", "CONCLUDED") is None)
check("match feed LIVE refuses",
      raises(m.BrownlowArtefactSourceError, m.require_concluded, "LIVE", "CONCLUDED"))
check("leaderboard not CONCLUDED refuses",
      raises(m.BrownlowArtefactSourceError, m.require_concluded, "CONCLUDED", None))
check("both missing refuses",
      raises(m.BrownlowArtefactSourceError, m.require_concluded, None, None))


# ---------------------------------------------------------------------------
# reconcile_leaderboard
# ---------------------------------------------------------------------------

section("reconcile_leaderboard")

match_sets = m.parse_match_votes(match_votes_payload("CONCLUDED", [STANDARD_MATCH]))[0]
lb_ok = m.parse_leaderboard(leaderboard_payload(
    "CONCLUDED", [leaderboard_entry("CD_I1", 3.0), leaderboard_entry("CD_I2", 2.0), leaderboard_entry("CD_I3", 1.0)],
))[0]
check("matching totals: no mismatches", m.reconcile_leaderboard(match_sets, lb_ok) == [])

lb_bad = m.parse_leaderboard(leaderboard_payload("CONCLUDED", [leaderboard_entry("CD_I1", 99.0)]))[0]
mismatches = m.reconcile_leaderboard(match_sets, lb_bad)
check("mismatched total is reported", mismatches == [("CD_I1", 3, 99)])


# ---------------------------------------------------------------------------
# load_bridge -- linked rows only, S5 rule (b) re-checked defensively
# ---------------------------------------------------------------------------

section("load_bridge")

with tempfile.TemporaryDirectory() as tmp:
    bridge_path = Path(tmp) / "bridge.json"
    bridge_path.write_text(json.dumps({
        "providers": {
            "CD_I1": {"disposition": "linked", "candidate_player_id": 101},
            "CD_I2": {"disposition": "unresolved"},
            "CD_I3": {"disposition": "contradictory"},
            "CD_I4": {"disposition": "linked", "candidate_player_id": 104},
        },
    }))
    linked = m.load_bridge(bridge_path)
    check("only linked providers are loaded", set(linked) == {"CD_I1", "CD_I4"})
    check("candidate player ids carried through", linked["CD_I1"] == 101 and linked["CD_I4"] == 104)

    shared_path = Path(tmp) / "shared.json"
    shared_path.write_text(json.dumps({
        "providers": {
            "CD_I5": {"disposition": "linked", "candidate_player_id": 500},
            "CD_I6": {"disposition": "linked", "candidate_player_id": 500},
        },
    }))
    check("a player id claimed by two linked providers refuses",
          raises(m.BrownlowArtefactSourceError, m.load_bridge, shared_path))

    empty_path = Path(tmp) / "empty.json"
    empty_path.write_text(json.dumps({"providers": {"CD_I9": {"disposition": "unresolved"}}}))
    check("a bridge with zero linked providers refuses",
          raises(m.BrownlowArtefactSourceError, m.load_bridge, empty_path))


# ---------------------------------------------------------------------------
# load_bridges -- combining trusted bridge artefacts (2026-09-20 identity-union fix,
# see build_brownlow_season_artefact_from_afl_api.py's "Identity resolution" module doc)
# ---------------------------------------------------------------------------

section("load_bridges -- combining trusted bridge artefacts")

with tempfile.TemporaryDirectory() as tmp:
    bridge_a = Path(tmp) / "bridge-a.json"
    bridge_a.write_text(json.dumps({
        "match_method": "afl_api_stat_vector_bootstrap",
        "providers": {
            "CD_I1": {"disposition": "linked", "candidate_player_id": 101},
            "CD_I2": {"disposition": "unresolved"},
        },
    }))
    bridge_b = Path(tmp) / "bridge-b.json"
    bridge_b.write_text(json.dumps({
        "match_method": "afl_api_name_team_season_bootstrap",
        "providers": {
            "CD_I3": {"disposition": "linked", "candidate_player_id": 103},
            "CD_I1": {"disposition": "linked", "candidate_player_id": 101},  # identical to bridge_a
        },
    }))

    # 1. one bridge file still works
    single, single_prov = m.load_bridges([bridge_a])
    check("a single bridge file still loads via load_bridges()", single == {"CD_I1": 101})
    check("single-file provenance names that one file", single_prov["CD_I1"] == [bridge_a])

    # 2. two compatible bridge artefacts combine successfully
    combined, prov = m.load_bridges([bridge_a, bridge_b])
    check("two compatible bridges combine into a union of their linked rows",
          combined == {"CD_I1": 101, "CD_I3": 103})

    # 3. identical mapping repeated across artefacts is harmless
    check("an identical mapping repeated in both files is harmless, not a contradiction",
          combined["CD_I1"] == 101)

    # 6. provenance records which bridge(s) supplied the mapping
    check("provenance records BOTH contributing files for a mapping repeated identically",
          set(prov["CD_I1"]) == {bridge_a, bridge_b})
    check("provenance records the single contributing file for a mapping only one file supplies",
          prov["CD_I3"] == [bridge_b])

    # 4. same provider mapped to different players refuses
    bridge_c = Path(tmp) / "bridge-c.json"
    bridge_c.write_text(json.dumps({
        "providers": {"CD_I1": {"disposition": "linked", "candidate_player_id": 999}},
    }))
    check("the same provider id linked to a DIFFERENT player by another file refuses",
          raises(m.BrownlowArtefactSourceError, m.load_bridges, [bridge_a, bridge_c]))

    # 5. player-uniqueness (Sec 6.3 rule (b)) is preserved ACROSS artefacts, not just within one
    bridge_d = Path(tmp) / "bridge-d.json"
    bridge_d.write_text(json.dumps({
        "providers": {"CD_I9": {"disposition": "linked", "candidate_player_id": 101}},
    }))
    check("a player id claimed by two DIFFERENT provider ids across two otherwise-consistent "
          "files refuses (rule (b), re-checked over the combined set)",
          raises(m.BrownlowArtefactSourceError, m.load_bridges, [bridge_a, bridge_d]))

    # 7. zero trusted mappings still refuses
    check("no --bridge paths at all refuses",
          raises(m.BrownlowArtefactSourceError, m.load_bridges, []))


# ---------------------------------------------------------------------------
# F: unresolved trusted identity refuses (whole match, all-or-none)
# ---------------------------------------------------------------------------

section("F: resolve_season_facts -- unresolved identity refuses the whole match")

bridge_full = {"CD_I1": 101, "CD_I2": 102, "CD_I3": 103}
facts, refusals = m.resolve_season_facts(match_sets, bridge_full)
check("fully-resolved match contributes all 3 facts", len(facts) == 3 and not refusals)

bridge_partial = {"CD_I1": 101, "CD_I3": 103}  # CD_I2 missing
facts2, refusals2 = m.resolve_season_facts(match_sets, bridge_partial)
check("a match with one unresolved player contributes ZERO facts", facts2 == [])
check("the refusal names the match and the unresolved provider id",
      len(refusals2) == 1 and refusals2[0].provider_match_id == "CD_M1" and "CD_I2" in refusals2[0].reason)

bridge_dup = {"CD_I1": 101, "CD_I2": 101, "CD_I3": 103}  # two providers -> one canonical player
facts3, refusals3 = m.resolve_season_facts(match_sets, bridge_dup)
check("two providers resolving to the same canonical player refuses the match", facts3 == [])
check("refusal reason names duplicate_player_canonical_identity",
      len(refusals3) == 1 and "duplicate_player_canonical_identity" in refusals3[0].reason)


# ---------------------------------------------------------------------------
# resolve_ineligible_player_ids
# ---------------------------------------------------------------------------

section("resolve_ineligible_player_ids")

lb_mixed = m.parse_leaderboard(leaderboard_payload("CONCLUDED", [
    leaderboard_entry("CD_I1", 3.0, eligible=True),
    leaderboard_entry("CD_I2", 2.0, eligible=False),
    leaderboard_entry("CD_I3", 1.0, eligible=True),
]))[0]
ineligible = m.resolve_ineligible_player_ids({101, 102, 103}, bridge_full, lb_mixed)
check("only the leaderboard-ineligible player is flagged", ineligible == {102})

check("a tallied player missing from the leaderboard refuses",
      raises(m.BrownlowArtefactSourceError, m.resolve_ineligible_player_ids,
             {101, 999}, {**bridge_full, "CD_I9": 999}, lb_mixed))


# ---------------------------------------------------------------------------
# competition_ranks / derive_season_rows
# ---------------------------------------------------------------------------

section("competition_ranks")

check("distinct values rank 1,2,3,4", m.competition_ranks([10, 8, 6, 4]) == [1, 2, 3, 4])
check("a two-way tie shares rank, next rank skips", m.competition_ranks([10, 8, 8, 4]) == [1, 2, 2, 4])
check("all tied share rank 1", m.competition_ranks([5, 5, 5]) == [1, 1, 1])

section("derive_season_rows")

facts_a = [(101, 3), (102, 2), (103, 1), (101, 3), (104, 3)]  # 101 polled twice
rows = m.derive_season_rows(facts_a, ineligible_player_ids=set(),
                             home_and_away_games={101: 20, 102: 18, 103: 22, 104: 21})
by_id = {r.player_id: r for r in rows}
check("votes summed across matches", by_id[101].votes == 6)
check("three_vote_games counted, NULL-for-zero elsewhere",
      by_id[101].three_vote_games == 2 and by_id[101].one_vote_games is None)
check("polling_games counts matches, not vote total", by_id[101].polling_games == 2)
check("vote_rank is competition rank over ALL players",
      by_id[101].vote_rank == 1 and by_id[104].vote_rank == 2)
check("eligible_rank populated for an eligible leader", by_id[101].eligible_rank == 1)
check("is_winner true only for the top eligible_rank", by_id[101].is_winner is True
      and by_id[104].is_winner is False)

section("derive_season_rows -- ineligible handling")

rows_ineligible = m.derive_season_rows(
    [(101, 3), (102, 3), (102, 2), (103, 1)], ineligible_player_ids={102},
    home_and_away_games={101: 20, 102: 18, 103: 22},
)
by_id2 = {r.player_id: r for r in rows_ineligible}
check("ineligible player carries NULL eligible_rank", by_id2[102].eligible_rank is None)
check("ineligible player is never the winner even with the most votes", by_id2[102].is_winner is False)
check("the next eligible player becomes eligible_rank 1", by_id2[101].eligible_rank == 1
      and by_id2[101].is_winner is True)

check("an ineligible id with zero polled votes refuses",
      raises(m.BrownlowArtefactSourceError, m.derive_season_rows,
             [(101, 3)], {999}, {101: 20, 999: 10}))

check("a polled player missing a games record refuses",
      raises(m.BrownlowArtefactSourceError, m.derive_season_rows, [(101, 3)], set(), {}))

check("an invalid vote value refuses",
      raises(m.BrownlowArtefactSourceError, m.derive_season_rows, [(101, 4)], set(), {101: 20}))


# ---------------------------------------------------------------------------
# A/G/H: build_rows -- provenance, ordering, full-pipeline shape
# ---------------------------------------------------------------------------

section("A/G/H: build_rows")

identities = {
    101: m.PlayerIdentity("players/B/Bravo1.html", "Bravo Player"),
    102: m.PlayerIdentity("players/A/Alpha1.html", "Alpha Player"),
    104: m.PlayerIdentity("players/C/Charlie1.html", "Charlie Player"),
}
bridge_for_rows = {"CD_I101": 101, "CD_I102": 102, "CD_I104": 104}
derived_for_rows = m.derive_season_rows(
    [(101, 3), (102, 2), (104, 3)], ineligible_player_ids=set(),
    home_and_away_games={101: 20, 102: 18, 104: 21},
)
csv_rows = m.build_rows(2025, derived_for_rows, identities, bridge_for_rows, "afl-api-brownlow-2025-x")

check("row count matches derived count", len(csv_rows) == len(derived_for_rows))
check("H: rows are ordered by (season, afltables_profile_url) ascending",
      [r["afltables_profile_url"] for r in csv_rows]
      == sorted(r["afltables_profile_url"] for r in csv_rows))
check("H: ordering is independent of derivation/tally order (Alpha, Bravo, Charlie)",
      [r["display_name"] for r in csv_rows] == ["Alpha Player", "Bravo Player", "Charlie Player"])
check("A: season column carried through", all(r["season"] == "2025" for r in csv_rows))
check("A: link_status_value is 'unique'", all(r["link_status_value"] == "unique" for r in csv_rows))
row_101 = next(r for r in csv_rows if r["display_name"] == "Bravo Player")
check("G: afltables_profile_url survives into the row", row_101["afltables_profile_url"] == "players/B/Bravo1.html")
check("G: bootstrap_player_id carries the canonical player id", row_101["bootstrap_player_id"] == "101")
check("G: legacy_source_record_id carries season, provider id and snapshot label",
      row_101["legacy_source_record_id"] == "afl_api-brownlow-season:2025:CD_I101:afl-api-brownlow-2025-x")
check("every HEADER column is present on every row",
      all(set(r.keys()) == set(m.HEADER) for r in csv_rows))


# ---------------------------------------------------------------------------
# B: determinism
# ---------------------------------------------------------------------------

section("B: determinism")

csv_a = m.render_csv(m.build_rows(2025, derived_for_rows, identities, bridge_for_rows, "label-x"))
csv_b = m.render_csv(m.build_rows(2025, list(reversed(derived_for_rows)), identities, bridge_for_rows, "label-x"))
check("re-running the render over reordered input produces byte-identical CSV", csv_a == csv_b)
check("a second identical render is byte-identical", csv_a == m.render_csv(
    m.build_rows(2025, derived_for_rows, identities, bridge_for_rows, "label-x")))


# ---------------------------------------------------------------------------
# I: rescheduled-round semantics do not regress (the artefact carries no
# round column at all, so a reschedule cannot corrupt a season total)
# ---------------------------------------------------------------------------

section("I: rescheduled-round semantics")

check("HEADER carries no round column", not any("round" in col for col in m.HEADER))

normal_round_match = STANDARD_MATCH  # roundNumber 5.0
rescheduled_match = {**STANDARD_MATCH, "matchId": "CD_M2", "roundNumber": 23.0}
sets_two, _ = m.parse_match_votes(match_votes_payload("CONCLUDED", [normal_round_match, rescheduled_match]))
facts_resched, refusals_resched = m.resolve_season_facts(sets_two, bridge_full)
check("a match with an unusual api_round_number still contributes its votes",
      not refusals_resched and sum(v for _, v in facts_resched) == 12)
rows_resched = m.derive_season_rows(facts_resched, set(), {101: 20, 102: 18, 103: 22})
check("season totals double-count correctly across two matches regardless of round number",
      next(r for r in rows_resched if r.player_id == 101).votes == 6)


# ---------------------------------------------------------------------------
# J: existing destination cannot be silently overwritten with different content
# ---------------------------------------------------------------------------

section("J: write_artefact -- never a silent overwrite")

with tempfile.TemporaryDirectory() as tmp:
    csv_path = Path(tmp) / "season-votes-afl_api-2025.csv"
    manifest_path = Path(tmp) / "season-votes-afl_api-2025.manifest.json"
    manifest_1 = {"schema_version": 1, "built_at_utc": "2026-01-01T00:00:00+00:00", "artefact": {"rows": 1}}
    manifest_2 = {"schema_version": 1, "built_at_utc": "2026-01-02T00:00:00+00:00", "artefact": {"rows": 1}}

    outcome_1 = m.write_artefact("a,b\n1,2\n", manifest_1, csv_path, manifest_path)
    check("first write succeeds", outcome_1 == "written" and csv_path.exists() and manifest_path.exists())

    outcome_2 = m.write_artefact("a,b\n1,2\n", manifest_2, csv_path, manifest_path)
    check("identical content (modulo built_at_utc) is a no-op, not a rewrite", outcome_2 == "unchanged")

    check("different CSV content refuses rather than overwriting",
          raises(m.BrownlowArtefactRefused, m.write_artefact, "a,b\n9,9\n", manifest_1, csv_path, manifest_path))

    check("the original file is untouched after a refused overwrite",
          csv_path.read_text(encoding="utf-8") == "a,b\n1,2\n")

    different_manifest = {"schema_version": 1, "built_at_utc": "2026-01-03T00:00:00+00:00", "artefact": {"rows": 2}}
    check("identical CSV but different manifest content also refuses",
          raises(m.BrownlowArtefactRefused, m.write_artefact, "a,b\n1,2\n", different_manifest, csv_path, manifest_path))

    # 8/9: the Path.read_text(newline=...) fix -- write_artefact()'s overwrite-equality check must
    # read the existing file with newline="" (exact bytes), never Path.read_text()'s universal-
    # newline translation, so this comparison is never silently weakened by the fix.
    crlf_path = Path(tmp) / "crlf-check.csv"
    crlf_manifest_path = Path(tmp) / "crlf-check.manifest.json"
    crlf_manifest = {"schema_version": 1, "built_at_utc": "2026-01-01T00:00:00+00:00", "artefact": {"rows": 1}}
    outcome_crlf = m.write_artefact("a,b\r\n1,2\r\n", crlf_manifest, crlf_path, crlf_manifest_path)
    check("an existing CRLF-newline file can be written", outcome_crlf == "written")
    check("re-comparing against LF-only content of otherwise-equal text refuses rather than "
          "treating CRLF and LF as equal (newline='' preserves exact bytes)",
          raises(m.BrownlowArtefactRefused, m.write_artefact, "a,b\n1,2\n", crlf_manifest, crlf_path, crlf_manifest_path))
    check("re-comparing against the SAME CRLF content is still a no-op",
          m.write_artefact("a,b\r\n1,2\r\n", crlf_manifest, crlf_path, crlf_manifest_path) == "unchanged")


# ---------------------------------------------------------------------------

print()
if failures:
    print(f"{len(failures)} afl_api Brownlow season artefact contract check(s) FAILED:")
    for name in failures:
        print(f"  - {name}")
    raise SystemExit(1)
print("All afl_api Brownlow season artefact contract checks passed.")
