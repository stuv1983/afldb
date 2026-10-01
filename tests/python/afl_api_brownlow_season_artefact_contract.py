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

import inspect
import json
import sys
import tempfile
from pathlib import Path, PurePosixPath

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

# AFLDB-ISSUE-241: every bridge fixture declares the stable-identity contract.
_CONTRACT = {"player_identity_contract": m.BRIDGE_IDENTITY_CONTRACT}

with tempfile.TemporaryDirectory() as tmp:
    bridge_path = Path(tmp) / "bridge.json"
    bridge_path.write_text(json.dumps({
        **_CONTRACT,
        "providers": {
            "CD_I1": {"disposition": "linked", "candidate_player_id": 101, "candidate_player_identity": "players/T/Test_101.html"},
            "CD_I2": {"disposition": "unresolved"},
            "CD_I3": {"disposition": "contradictory"},
            "CD_I4": {"disposition": "linked", "candidate_player_id": 104, "candidate_player_identity": "players/T/Test_104.html"},
        },
    }))
    linked = m.load_bridge(bridge_path)
    check("only linked providers are loaded", set(linked) == {"CD_I1", "CD_I4"})
    check("candidate player ids carried through", linked["CD_I1"] == 101 and linked["CD_I4"] == 104)

    shared_path = Path(tmp) / "shared.json"
    shared_path.write_text(json.dumps({
        **_CONTRACT,
        "providers": {
            "CD_I5": {"disposition": "linked", "candidate_player_id": 500, "candidate_player_identity": "players/T/Test_500.html"},
            "CD_I6": {"disposition": "linked", "candidate_player_id": 500, "candidate_player_identity": "players/T/Test_500.html"},
        },
    }))
    check("a player id claimed by two linked providers refuses",
          raises(m.BrownlowArtefactSourceError, m.load_bridge, shared_path))

    empty_path = Path(tmp) / "empty.json"
    empty_path.write_text(json.dumps({**_CONTRACT, "providers": {"CD_I9": {"disposition": "unresolved"}}}))
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
        **_CONTRACT,
        "match_method": "afl_api_stat_vector_bootstrap",
        "providers": {
            "CD_I1": {"disposition": "linked", "candidate_player_id": 101, "candidate_player_identity": "players/T/Test_101.html"},
            "CD_I2": {"disposition": "unresolved"},
        },
    }))
    bridge_b = Path(tmp) / "bridge-b.json"
    bridge_b.write_text(json.dumps({
        **_CONTRACT,
        "match_method": "afl_api_name_team_season_bootstrap",
        "providers": {
            "CD_I3": {"disposition": "linked", "candidate_player_id": 103, "candidate_player_identity": "players/T/Test_103.html"},
            "CD_I1": {"disposition": "linked", "candidate_player_id": 101, "candidate_player_identity": "players/T/Test_101.html"},  # identical to bridge_a
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
        **_CONTRACT,
        "providers": {"CD_I1": {"disposition": "linked", "candidate_player_id": 999, "candidate_player_identity": "players/T/Test_999.html"}},
    }))
    check("the same provider id linked to a DIFFERENT player by another file refuses",
          raises(m.BrownlowArtefactSourceError, m.load_bridges, [bridge_a, bridge_c]))

    # 5. player-uniqueness (Sec 6.3 rule (b)) is preserved ACROSS artefacts, not just within one
    bridge_d = Path(tmp) / "bridge-d.json"
    bridge_d.write_text(json.dumps({
        **_CONTRACT,
        "providers": {"CD_I9": {"disposition": "linked", "candidate_player_id": 101, "candidate_player_identity": "players/T/Test_101.html"}},
    }))
    check("a player id claimed by two DIFFERENT provider ids across two otherwise-consistent "
          "files refuses (rule (b), re-checked over the combined set)",
          raises(m.BrownlowArtefactSourceError, m.load_bridges, [bridge_a, bridge_d]))

    # 7. zero trusted mappings still refuses
    check("no --bridge paths at all refuses",
          raises(m.BrownlowArtefactSourceError, m.load_bridges, []))


# ---------------------------------------------------------------------------
# AFLDB-ISSUE-241: lineage-unbound bridges refuse; a stale candidate_player_id refuses
# ---------------------------------------------------------------------------

section("AFLDB-ISSUE-241 -- bridge identity contract")

with tempfile.TemporaryDirectory() as tmp:
    legacy = Path(tmp) / "legacy.json"
    legacy.write_text(json.dumps({
        "providers": {"CD_I1": {"disposition": "linked", "candidate_player_id": 101}},
    }))
    check("a lineage-unbound bridge (no player_identity_contract) refuses",
          raises(m.BrownlowArtefactSourceError, m.load_bridge, legacy))
    check("... and refuses through load_bridges() too",
          raises(m.BrownlowArtefactSourceError, m.load_bridges, [legacy]))

    wrong_contract = Path(tmp) / "wrong-contract.json"
    wrong_contract.write_text(json.dumps({
        "player_identity_contract": "afldb.afl_api_bridge.stable_identity.v0",
        "providers": {"CD_I1": {"disposition": "linked", "candidate_player_id": 101,
                                "candidate_player_identity": "players/T/Test_101.html"}},
    }))
    check("an unknown contract version refuses",
          raises(m.BrownlowArtefactSourceError, m.load_bridge, wrong_contract))

    no_identity = Path(tmp) / "no-identity.json"
    no_identity.write_text(json.dumps({
        **_CONTRACT, "providers": {"CD_I1": {"disposition": "linked", "candidate_player_id": 101}},
    }))
    check("a linked row without candidate_player_identity refuses",
          raises(m.BrownlowArtefactSourceError, m.load_bridge, no_identity))

    null_identity = Path(tmp) / "null-identity.json"
    null_identity.write_text(json.dumps({
        **_CONTRACT, "providers": {"CD_I1": {"disposition": "linked", "candidate_player_id": 101,
                                             "candidate_player_identity": None}},
    }))
    check("a linked row whose identity is null (emitter could not bind it) refuses",
          raises(m.BrownlowArtefactSourceError, m.load_bridge, null_identity))

    bound = Path(tmp) / "bound.json"
    bound.write_text(json.dumps({
        **_CONTRACT, "providers": {
            "CD_I1": {"disposition": "linked", "candidate_player_id": 101,
                      "candidate_player_identity": "players/B/Bravo1.html"},
            "CD_I2": {"disposition": "linked", "candidate_player_id": 102,
                      "candidate_player_identity": "players/A/Alpha1.html"},
        },
    }))
    ids = m.load_bridge_identities([bound])
    check("load_bridge_identities() maps provider -> identity",
          ids == {"CD_I1": "players/B/Bravo1.html", "CD_I2": "players/A/Alpha1.html"})

    other = Path(tmp) / "other.json"
    other.write_text(json.dumps({
        **_CONTRACT, "providers": {"CD_I1": {"disposition": "linked", "candidate_player_id": 101,
                                             "candidate_player_identity": "players/Z/Someone_Else.html"}},
    }))
    check("the same provider with two different identities across bridges refuses",
          raises(m.BrownlowArtefactSourceError, m.load_bridge_identities, [bound, other]))

    bridge_map = m.load_bridge(bound)
    same_lineage = {
        101: m.PlayerIdentity("players/B/Bravo1.html", "Bravo Player"),
        102: m.PlayerIdentity("players/A/Alpha1.html", "Alpha Player"),
    }
    m.verify_bridge_identities(bridge_map, ids, same_lineage)
    check("same-lineage bridge: every looked-up identity equals the row's declared identity", True)

    renumbered = {
        101: m.PlayerIdentity("players/A/Alpha1.html", "Alpha Player"),  # id 101 now names Alpha
        102: m.PlayerIdentity("players/B/Bravo1.html", "Bravo Player"),
    }
    check("a stale candidate_player_id (the id now names someone else) refuses the build",
          raises(m.BrownlowArtefactEvidenceError, m.verify_bridge_identities, bridge_map, ids, renumbered))


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
# AFLDB-ISSUE-233 D-233-2: the loader (import_brownlow_season.py) reads the
# season-scoped artefacts THIS builder writes, beside the tracked master,
# gated by the reviewed stat-availability document. Every artefact below is a
# real builder output (build_rows / render_csv / build_manifest /
# write_artefact) in a temporary directory; the master is the tracked one.
# ---------------------------------------------------------------------------

import import_brownlow_season as loader  # noqa: E402

section("D-233-2: season-scoped AFL API artefacts beside the master")


def write_afl_api_artefact(directory: Path, season: int, label: str | None = None) -> tuple[Path, Path]:
    """One genuine builder artefact pair for ``season`` (synthetic players, test data)."""
    label = label or f"afl-api-brownlow-{season}-test"
    derived = m.derive_season_rows(
        [(101, 3), (102, 2), (104, 3), (101, 1)], ineligible_player_ids=set(),
        home_and_away_games={101: 20, 102: 18, 104: 21},
    )
    rows = m.build_rows(season, derived, identities, bridge_for_rows, label)
    csv_text = m.render_csv(rows)
    csv_path = directory / f"season-votes-afl_api-{season}.csv"
    manifest_path = directory / f"season-votes-afl_api-{season}.manifest.json"
    manifest = m.build_manifest(
        season=season, label=label,
        snapshot_manifest={"season_provider_id": f"CD_S{season}014", "acquired_at": "test", "files": []},
        snapshot_dir=directory / "snapshot", bridge_paths=[], bridge_provenance={},
        measured=m.measure(season, derived), csv_path=csv_path, csv_text=csv_text,
        db_database="afldb_test", reconciliation_compared=len(derived),
    )
    m.write_artefact(csv_text, manifest, csv_path, manifest_path)
    return csv_path, manifest_path


def availability(directory: Path, complete: set[int], pending: set[int] = frozenset()) -> Path:
    """A READY stat-availability document: the tracked one, with brownlow_season_total edited."""
    tracked = json.loads(loader.AVAILABILITY_PATH.read_text(encoding="utf-8"))
    ranges = [r for r in tracked["coverage_ranges"] if r["stat_key"] != loader.STAT_KEY
              or r["last_season"] < 2026]
    for season in sorted(complete):
        ranges.append({"stat_key": loader.STAT_KEY, "coverage": "complete",
                       "first_season": season, "last_season": season})
    for season in sorted(pending):
        ranges.append({"stat_key": loader.STAT_KEY, "coverage": "pending",
                       "first_season": season, "last_season": season})
    tag = "-".join([f"c{s}" for s in sorted(complete)] + [f"p{s}" for s in sorted(pending)])
    path = directory / f"stat-availability-{tag or 'none'}.json"
    path.write_text(json.dumps({**tracked, "coverage_ranges": ranges}), encoding="utf-8")
    return path


def refusal(fn, *args, **kwargs) -> str:
    try:
        fn(*args, **kwargs)
    except loader.BrownlowSeasonSourceError as exc:
        return str(exc)
    return ""


baseline = loader.validate_offline()
check("D-233-2: today's repository carries no season-scoped AFL API artefact",
      baseline["afl_api_artefacts"] == [])
check("D-233-2: master-only summary is unchanged (16,120 / 79,113 / 112 / 98)",
      (baseline["rows"], baseline["votes_total"], baseline["winners"], baseline["seasons"])
      == (16120, 79113, 112, 98))

with tempfile.TemporaryDirectory() as tmp:
    tmp_dir = Path(tmp)
    empty = tmp_dir / "empty"
    empty.mkdir()
    master_only = loader.validate_offline(afl_api_dir=empty, availability_path=tmp_dir / "absent.json")
    check("D-233-2 master-only: no artefact -> the availability document is never even read",
          master_only["afl_api_artefacts"] == [])
    check("D-233-2 master-only: identical summary to the default run",
          {k: v for k, v in master_only.items() if k != "afl_api_artefacts"}
          == {k: v for k, v in baseline.items() if k != "afl_api_artefacts"})

    # AFL API season only (2026 is in no master row) + reviewed availability complete.
    one = tmp_dir / "one"
    one.mkdir()
    csv_2026, manifest_2026 = write_afl_api_artefact(one, 2026)
    complete_2026 = availability(tmp_dir, {2026})
    summary = loader.validate_offline(afl_api_dir=one, availability_path=complete_2026)
    entries = summary["afl_api_artefacts"]
    check("D-233-2 complete: the 2026 artefact is loaded beside the master",
          [e["season"] for e in entries] == [2026])
    check("D-233-2 complete: it is bound by its own csv and manifest sha256",
          entries[0]["csv_sha256"] == loader.sha256_file(csv_2026)
          and entries[0]["manifest_sha256"] == loader.sha256_file(manifest_2026))
    check("D-233-2 complete: provenance is afl_api, the master summary is untouched",
          entries[0]["source_key"] == "afl_api" and summary["rows"] == baseline["rows"])
    master_manifest = loader.load_manifest()
    loaded = loader.load_afl_api_artefacts(loader.expected_seasons(master_manifest), one, complete_2026)
    expected = loader.expected_after_load(master_manifest, loaded, loader.load_artefact())
    check("D-233-2 complete: the post-write expectation adds the artefact's rows and season",
          expected["rows"] == 16120 + len(loaded[0].rows) and expected["seasons"] == 99
          and expected["afl_api_rows"] == len(loaded[0].rows))
    master_expected = loader.expected_after_load(master_manifest)
    check("D-233-2 master-only: the post-write expectation is the master manifest's own",
          {k: master_expected[k] for k in ("rows", "votes_total", "winners", "seasons", "players")}
          == {k: master_manifest["artefact"][k]
              for k in ("rows", "votes_total", "winners", "seasons", "players")}
          and master_expected["afl_api_rows"] == 0)

    # Present, but the reviewed availability still says pending (today's real document).
    check("D-233-2 pending: an artefact whose season is not 'complete' is refused, never skipped",
          "is not 'complete' for brownlow_season_total" in refusal(
              loader.validate_offline, afl_api_dir=one, availability_path=loader.AVAILABILITY_PATH))
    pending_doc = availability(tmp_dir, set(), {2026})
    check("D-233-2 pending: an explicitly pending season is refused the same way",
          "is not 'complete'" in refusal(
              loader.validate_offline, afl_api_dir=one, availability_path=pending_doc))

    # The same season in BOTH the master and an AFL API artefact.
    dup = tmp_dir / "dup"
    dup.mkdir()
    write_afl_api_artefact(dup, 2025)
    message = refusal(loader.validate_offline, afl_api_dir=dup,
                      availability_path=availability(tmp_dir, {2025}))
    check("D-233-2 duplicate: a season in the master AND an AFL API artefact refuses",
          "[2025] appear in BOTH the master artefact" in message and "no implicit precedence" in message,
          message)

    # Bad manifest / hash.
    def tampered(name: str, mutate) -> str:
        directory = tmp_dir / name
        directory.mkdir()
        csv_path, manifest_path = write_afl_api_artefact(directory, 2026)
        mutate(csv_path, manifest_path)
        return refusal(loader.validate_offline, afl_api_dir=directory, availability_path=complete_2026)

    def flip_bytes(csv_path: Path, _manifest: Path) -> None:
        text = csv_path.read_text(encoding="utf-8")
        assert "Alpha Player" in text
        csv_path.write_text(text.replace("Alpha Player", "Alphb Player", 1), encoding="utf-8", newline="")

    def edit_manifest(**changes):
        def apply(_csv: Path, manifest_path: Path) -> None:
            doc = json.loads(manifest_path.read_text(encoding="utf-8"))
            for dotted, value in changes.items():
                target = doc
                *parents, leaf = dotted.split(".")
                for parent in parents:
                    target = target[parent]
                target[leaf] = value
            manifest_path.write_text(json.dumps(doc), encoding="utf-8")
        return apply

    for name, mutate, expected_text in (
        ("bytes", flip_bytes, "does not match season-votes-afl_api-2026.csv"),
        ("rows", edit_manifest(**{"artefact.rows": 99}), "artefact.rows"),
        ("source", edit_manifest(source_key="afltables"), "source_key 'afltables'"),
        ("season", edit_manifest(season=2027), "its filename names 2026"),
        ("schema", edit_manifest(schema_version=1), "schema_version 1"),
    ):
        message = tampered(name, mutate)
        check(f"D-233-2 bad manifest/hash ({name}) refuses", expected_text in message, message)

    # Multiple artefacts: deterministic ascending order whatever the creation order.
    many = tmp_dir / "many"
    many.mkdir()
    write_afl_api_artefact(many, 2028)
    write_afl_api_artefact(many, 2026)
    write_afl_api_artefact(many, 2027)
    complete_many = availability(tmp_dir, {2026, 2027, 2028})
    first = loader.validate_offline(afl_api_dir=many, availability_path=complete_many)
    second = loader.validate_offline(afl_api_dir=many, availability_path=complete_many)
    check("D-233-2 multiple: discovered in ascending season order",
          [e["season"] for e in first["afl_api_artefacts"]] == [2026, 2027, 2028])
    check("D-233-2 multiple: two runs give identical evidence", first == second)
    check("D-233-2 multiple: discovery is by season, not by filesystem order",
          [s for s, _, _ in loader.discover_afl_api_artefacts(many)] == [2026, 2027, 2028])

    # Half a pair, or an unrecognised name under the prefix, refuses rather than being skipped.
    orphan = tmp_dir / "orphan"
    orphan.mkdir()
    csv_path, manifest_path = write_afl_api_artefact(orphan, 2026)
    manifest_path.unlink()
    check("D-233-2 discovery: a CSV without its manifest refuses",
          "lack their CSV or manifest" in refusal(loader.discover_afl_api_artefacts, orphan))
    stray = tmp_dir / "stray"
    stray.mkdir()
    write_afl_api_artefact(stray, 2026)
    (stray / "season-votes-afl_api-2026.csv.bak").write_text("x", encoding="utf-8")
    check("D-233-2 discovery: an unrecognised name under the prefix refuses",
          "not a season-scoped AFL API Brownlow artefact name" in refusal(
              loader.discover_afl_api_artefacts, stray))

    # The test seams cannot reach a database.
    import contextlib
    import io
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured):
        status = loader.main(["--afl-api-dir", str(one)])
    check("D-233-2 CLI: --afl-api-dir without --validate-only refuses before any database contact",
          status == 1 and "offline-validation only" in captured.getvalue())
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured):
        status = loader.main(["--validate-only", "--afl-api-dir", str(one),
                              "--stat-availability", str(complete_2026)])
    check("D-233-2 CLI: --validate-only reports the loaded artefact as JSON evidence",
          status == 0 and json.loads(captured.getvalue())["afl_api_artefacts"][0]["season"] == 2026)


# ---------------------------------------------------------------------------
# AFLDB-ISSUE-233: stable AFL Tables identity. One accepted path, or exactly one
# tracked profile_url_continuity pair -> its continuing_url; everything else
# refuses. Rules come only through the fitzRoy importer's own validator.
# ---------------------------------------------------------------------------

section("ISSUE-233: stable AFL Tables identity under the fitzRoy continuity contract")


def continuity_rule(**over) -> dict:
    """One well-formed profile_url_continuity rule (synthetic paths; mirrors the TS fixture)."""
    rule = {
        "id": "test-renumbered-profile", "dataset": "player_stats", "file": "player_stats_2025.csv",
        "continuing_url": "players/Q/Quinn_Test.html", "renumbered_url": "players/Q/Quinn_Test2.html",
        "expect": {
            "continuing_id": "99001", "continuing_last_season": 2024, "continuing_last_career_game": 10,
            "renumbered_first_season": 2025, "renumbered_last_season": 2025,
            "renumbered_first_career_game": 11, "renumbered_rows": 3,
        },
        "authority": "test authority", "reason": "test reason",
    }
    rule.update(over)
    return rule


def contract_file(directory: Path, name: str, document) -> Path:
    path = directory / name
    path.write_text(document if isinstance(document, str) else json.dumps(document), encoding="utf-8")
    return path


def stable(paths, rules):
    result = m.stable_afltables_identity(paths, rules)
    return None if result is None else result[0]


CONT, RENUM = "players/Q/Quinn_Test.html", "players/Q/Quinn_Test2.html"
OTHER = "players/Z/Unrelated_Profile.html"

with tempfile.TemporaryDirectory() as tmp:
    tmp_dir = Path(tmp)
    rules = m.load_continuity_rules(contract_file(
        tmp_dir, "one.json", {"profile_url_continuity": {"rules": [continuity_rule()]}}))

    check("1. one path -> that path", m.stable_afltables_identity([OTHER], rules) == (OTHER, None))
    check("1. a repeated single path is still one path", stable([OTHER, OTHER], rules) == OTHER)
    check("2. the exact tracked pair -> continuing_url, naming the rule",
          m.stable_afltables_identity([CONT, RENUM], rules) == (CONT, "test-renumbered-profile"))
    check("3. input order reversed -> still continuing_url", stable([RENUM, CONT], rules) == CONT)
    check("3. a set input (no order at all) -> still continuing_url", stable({RENUM, CONT}, rules) == CONT)

    zed_cont, zed_renum = "players/Z/Zed_Zulu9.html", "players/A/Zed_Zulu.html"
    zed_rules = m.load_continuity_rules(contract_file(tmp_dir, "zed.json", {"profile_url_continuity": {
        "rules": [continuity_rule(continuing_url=zed_cont, renumbered_url=zed_renum)]}}))
    check("4. (fixture) continuing_url sorts AFTER renumbered_url", min(zed_cont, zed_renum) == zed_renum)
    check("4. ... and the rule, not sort order, still picks continuing_url (both orders)",
          stable([zed_cont, zed_renum], zed_rules) == zed_cont
          and stable([zed_renum, zed_cont], zed_rules) == zed_cont)

    check("5. two paths no rule names -> REFUSE",
          stable(["players/A/Alpha_One.html", "players/A/Alpha_One2.html"], rules) is None)
    check("5. continuing_url + an unrelated path -> REFUSE", stable([CONT, OTHER], rules) is None)
    check("5. renumbered_url + an unrelated path -> REFUSE", stable([RENUM, OTHER], rules) is None)
    check("5. no suffix stripping: Quinn_Test.html + Quinn_Test3.html is not inferred",
          stable([CONT, "players/Q/Quinn_Test3.html"], rules) is None)

    # ISSUE-237 semantics: a lone path is the player's one accepted identity, whichever it is.
    check("6. only renumbered_url present -> it is the single accepted path (ISSUE-237 semantics)",
          m.stable_afltables_identity([RENUM], rules) == (RENUM, None))

    check("7. three paths (pair + another) -> REFUSE", stable([CONT, RENUM, OTHER], rules) is None)
    check("7. no path at all -> REFUSE", stable([], rules) is None)

    malformed = {
        "a rule missing its expect block": {"profile_url_continuity": {"rules": [
            {k: v for k, v in continuity_rule().items() if k != "expect"}]}},
        "a non-normalised renumbered_url": {"profile_url_continuity": {"rules": [
            continuity_rule(renumbered_url="https://afltables.com/afl/stats/players/Q/Quinn_Test2.html")]}},
        "continuing_url == renumbered_url": {"profile_url_continuity": {"rules": [
            continuity_rule(renumbered_url=CONT)]}},
        "an expect that breaks career-game continuity": {"profile_url_continuity": {"rules": [
            continuity_rule(expect={**continuity_rule()["expect"], "renumbered_first_career_game": 12})]}},
        "an empty authority": {"profile_url_continuity": {"rules": [continuity_rule(authority=" ")]}},
        "a non-object rule": {"profile_url_continuity": {"rules": ["players/Q/Quinn_Test.html"]}},
        "a non-object contract": [continuity_rule()],
        "invalid JSON": "{ not json",
    }
    for index, (label, document) in enumerate(malformed.items()):
        path = contract_file(tmp_dir, f"malformed-{index}.json", document)
        check(f"8. malformed contract ({label}) -> REFUSE",
              raises(m.BrownlowArtefactSourceError, m.load_continuity_rules, path))
    check("8. an unreadable contract -> REFUSE",
          raises(m.BrownlowArtefactSourceError, m.load_continuity_rules, tmp_dir / "absent.json"))
    check("8. a hand-built rule list that skipped the validator is refused",
          raises(TypeError, m.stable_afltables_identity, [CONT, RENUM],
                 (m.ProfileContinuityRule("hand-built", CONT, RENUM),)))
    no_section = m.load_continuity_rules(contract_file(tmp_dir, "no-section.json", {"source_row_corrections": {}}))
    check("8. a contract with no continuity section has no rules, so the pair REFUSES",
          no_section.rules == () and stable([CONT, RENUM], no_section) is None)

    second = continuity_rule(id="second-rule", continuing_url="players/R/Rory_Test.html",
                             renumbered_url="players/R/Rory_Test2.html")
    duplicate_renum = continuity_rule(id="dup-renum", continuing_url="players/S/Sam_Test.html")
    check("9. the same renumbered_url named by two rules -> REFUSE (existing validator)",
          raises(m.BrownlowArtefactSourceError, m.load_continuity_rules, contract_file(
              tmp_dir, "dup-renum.json", {"profile_url_continuity": {"rules": [continuity_rule(), duplicate_renum]}})))
    chained = continuity_rule(id="chain", continuing_url=RENUM, renumbered_url="players/Q/Quinn_Test4.html")
    check("9. a chain (continuing_url is another rule's renumbered_url) -> REFUSE (existing validator)",
          raises(m.BrownlowArtefactSourceError, m.load_continuity_rules, contract_file(
              tmp_dir, "chain.json", {"profile_url_continuity": {"rules": [continuity_rule(), chained]}})))
    check("9. a duplicate rule id -> REFUSE (existing validator)",
          raises(m.BrownlowArtefactSourceError, m.load_continuity_rules, contract_file(
              tmp_dir, "dup-id.json", {"profile_url_continuity": {"rules": [
                  continuity_rule(), continuity_rule(continuing_url="players/S/Sam_Test.html",
                                                     renumbered_url="players/S/Sam_Test2.html")]}})))
    two_rules = m.load_continuity_rules(contract_file(
        tmp_dir, "two.json", {"profile_url_continuity": {"rules": [continuity_rule(), second]}}))
    check("9. a pair spanning two different rules -> REFUSE",
          stable([CONT, "players/R/Rory_Test2.html"], two_rules) is None
          and stable(["players/R/Rory_Test.html", RENUM], two_rules) is None)
    check("9. ... while each rule's own exact pair still folds",
          stable([CONT, RENUM], two_rules) == CONT
          and stable(["players/R/Rory_Test2.html", "players/R/Rory_Test.html"], two_rules) == "players/R/Rory_Test.html")
    check("9. both pairs on one player (four paths) -> REFUSE",
          stable([CONT, RENUM, "players/R/Rory_Test.html", "players/R/Rory_Test2.html"], two_rules) is None)

    # resolve_player_identities(): the builder's per-player reduction, refusing with every offender named.
    resolved = m.resolve_player_identities(
        [1, 2], {1: {RENUM, CONT}, 2: {OTHER}}, {1: "Quinn Test", 2: "Other Player"}, rules)
    check("resolve_player_identities(): a folded pair and a single path both resolve",
          resolved == {1: m.PlayerIdentity(CONT, "Quinn Test", "test-renumbered-profile"),
                       2: m.PlayerIdentity(OTHER, "Other Player", None)})
    check("resolve_player_identities(): an untracked pair refuses the build",
          raises(m.BrownlowArtefactEvidenceError, m.resolve_player_identities,
                 [1], {1: {CONT, OTHER}}, {1: "Quinn Test"}, rules))
    check("resolve_player_identities(): a player with no accepted path refuses the build",
          raises(m.BrownlowArtefactEvidenceError, m.resolve_player_identities, [1], {}, {1: "Quinn Test"}, rules))
    folds = m.continuity_folds(resolved, rules)
    check("continuity_folds(): manifest provenance names the contract, its hash and the one fold",
          folds["folds"] == [{"rule_id": "test-renumbered-profile", "continuing_url": CONT, "renumbered_url": RENUM}]
          and folds["sha256"] == m.sha256_file(tmp_dir / "one.json"))

    # verify_continuity_provenance(): the manifest's continuity provenance is validated, never
    # carried as silently ignored metadata (the loader does not read identity_evidence).
    def with_provenance(block):
        return {"identity_evidence": {"database": "afldb_test", "profile_url_continuity": block}}

    def provenance_refuses(block, the_rules=rules):
        return raises(m.BrownlowArtefactSourceError, m.verify_continuity_provenance,
                      with_provenance(block), the_rules)

    check("provenance: the builder's own continuity_folds() block verifies",
          m.verify_continuity_provenance(with_provenance(folds), rules) == folds)
    check("provenance: a Windows-separator contract path is the same contract",
          m.verify_continuity_provenance(
              with_provenance({**folds, "contract": folds["contract"].replace("/", "\\")}), rules)["sha256"]
          == folds["sha256"])
    check("provenance: a block with no folds (no multi-path player) verifies",
          m.verify_continuity_provenance(with_provenance({**folds, "folds": []}), rules)["folds"] == [])
    check("provenance: a missing block refuses",
          raises(m.BrownlowArtefactSourceError, m.verify_continuity_provenance, {"identity_evidence": {}}, rules)
          and raises(m.BrownlowArtefactSourceError, m.verify_continuity_provenance, {}, rules))
    check("provenance: an extra or missing key refuses",
          provenance_refuses({**folds, "note": "x"})
          and provenance_refuses({k: v for k, v in folds.items() if k != "sha256"}))
    check("provenance: another contract path refuses", provenance_refuses({**folds, "contract": "other.json"}))
    check("provenance: another contract hash refuses (built with different rules)",
          provenance_refuses({**folds, "sha256": "0" * 64}))
    check("provenance: a fold that is not exactly a validated rule refuses",
          provenance_refuses({**folds, "folds": [{**folds["folds"][0], "continuing_url": OTHER}]})
          and provenance_refuses({**folds, "folds": [{**folds["folds"][0], "extra": 1}]})
          and provenance_refuses({**folds, "folds": "not a list"}))
    check("provenance: a duplicated fold refuses",
          provenance_refuses({**folds, "folds": folds["folds"] * 2}))
    two_folds = m.continuity_folds(
        {1: m.PlayerIdentity(CONT, "Quinn Test", "test-renumbered-profile"),
         2: m.PlayerIdentity("players/R/Rory_Test.html", "Rory Test", "second-rule")}, two_rules)
    check("provenance: two folds in continuing_url order verify; reversed order refuses",
          m.verify_continuity_provenance(with_provenance(two_folds), two_rules) == two_folds
          and provenance_refuses({**two_folds, "folds": list(reversed(two_folds["folds"]))}, two_rules))
    check("provenance: an unvalidated rule container is refused",
          raises(TypeError, m.verify_continuity_provenance, with_provenance(folds), list(rules.rules)))
    pair_dir = tmp_dir / "provenance-pair"
    pair_dir.mkdir()
    pair_csv, pair_manifest = write_afl_api_artefact(pair_dir, 2031)
    document = json.loads(pair_manifest.read_text(encoding="utf-8"))
    check("portability: manifest paths are POSIX on every host, so a Linux loader's "
          "Path(artefact.file).name names the CSV",
          "\\" not in document["artefact"]["file"] and "\\" not in folds["contract"]
          and PurePosixPath(document["artefact"]["file"]).name == pair_csv.name)
    check("portability: an in-repo path is repo-relative POSIX",
          m._rel(m.REPO_ROOT / "data" / "brownlow" / "season-votes-afl_api-2026.csv")
          == "data/brownlow/season-votes-afl_api-2026.csv")
    document["identity_evidence"]["profile_url_continuity"] = folds
    pair_manifest.write_text(json.dumps(document), encoding="utf-8")
    accepted = loader.load_afl_api_artefact(2031, pair_csv, pair_manifest, {2031})
    check("provenance: the loader's schema-2 check permits the provenance block (extension field)",
          accepted.manifest["identity_evidence"]["profile_url_continuity"] == folds)
    check("provenance: ... and the loaded manifest's provenance verifies against the rules",
          m.verify_continuity_provenance(accepted.manifest, rules) == folds)
    check("provenance: build() validates its own manifest's provenance before reporting success",
          "verify_continuity_provenance(manifest, continuity_rules)" in inspect.getsource(m.build))

    # load_identity_and_games(): the DB read wired through the same reduction (fake cursor).
    class FakeCursor:
        def __init__(self, results):
            self._results = list(results)
            self._current = None

        def execute(self, sql, params=None):
            self._current = self._results.pop(0)

        def fetchall(self):
            return self._current

    cursor = FakeCursor([
        [(1, "Quinn Test")],
        [(1, RENUM), (1, CONT)],
        [(1, 21)],
    ])
    identities_read, games_read = m.load_identity_and_games(cursor, {1}, 2026, rules)
    check("load_identity_and_games(): the two accepted DB paths fold to continuing_url",
          identities_read[1].afltables_profile_url == CONT and games_read == {1: 21})

    # 10. bridge verification compares the bridge's identity to the FOLDED stable path.
    folded = {7: m.PlayerIdentity(CONT, "Quinn Test", "test-renumbered-profile")}
    m.verify_bridge_identities({"CD_I7": 7}, {"CD_I7": CONT}, folded)
    check("10. bridge identity == folded continuing_url -> accepted", True)
    check("10. bridge identity == the renumbered member of the pair -> REFUSE (not the stable identity)",
          raises(m.BrownlowArtefactEvidenceError, m.verify_bridge_identities, {"CD_I7": 7}, {"CD_I7": RENUM}, folded))
    lone_renum = {7: m.PlayerIdentity(RENUM, "Quinn Test", None)}
    check("10. a bridge declaring continuing_url for a player holding only renumbered_url -> REFUSE",
          raises(m.BrownlowArtefactEvidenceError, m.verify_bridge_identities, {"CD_I7": 7}, {"CD_I7": CONT}, lone_renum))

# 11/12. The REAL tracked contract (tools/rebuild/fitzroy/fitzroy-contract.json).
real_rules = m.load_continuity_rules()
real_pairs = {
    "2025-charlie-cameron-renumbered-profile": ("players/C/Charlie_Cameron.html", "players/C/Charlie_Cameron3.html"),
    "2025-jack-graham-renumbered-profile": ("players/J/Jack_Graham.html", "players/J/Jack_Graham2.html"),
    "2025-jack-ross-renumbered-profile": ("players/J/Jack_Ross.html", "players/J/Jack_Ross3.html"),
    "2025-jack-williams-renumbered-profile": ("players/J/Jack_Williams.html", "players/J/Jack_Williams3.html"),
}
check("11/12. the tracked contract carries exactly the four measured renumberings",
      {rule.rule_id: (rule.continuing_url, rule.renumbered_url) for rule in real_rules.rules} == real_pairs)
check("11. real witness: player 6519's DB set {Jack_Ross.html, Jack_Ross3.html} -> players/J/Jack_Ross.html",
      m.stable_afltables_identity(["players/J/Jack_Ross.html", "players/J/Jack_Ross3.html"], real_rules)
      == ("players/J/Jack_Ross.html", "2025-jack-ross-renumbered-profile")
      and stable(["players/J/Jack_Ross3.html", "players/J/Jack_Ross.html"], real_rules) == "players/J/Jack_Ross.html")
for rule_id, (cont_url, renum_url) in real_pairs.items():
    check(f"12. {rule_id}: both orders fold to {cont_url}",
          stable([cont_url, renum_url], real_rules) == cont_url and stable([renum_url, cont_url], real_rules) == cont_url)
check("12. no suffix inference on the real contract: Jack_Ross.html + Jack_Ross2.html (1919) -> REFUSE",
      stable(["players/J/Jack_Ross.html", "players/J/Jack_Ross2.html"], real_rules) is None)
check("12. cross-rule real pair (Jack_Ross.html + Jack_Williams3.html) -> REFUSE",
      stable(["players/J/Jack_Ross.html", "players/J/Jack_Williams3.html"], real_rules) is None)


# ---------------------------------------------------------------------------

print()
if failures:
    print(f"{len(failures)} afl_api Brownlow season artefact contract check(s) FAILED:")
    for name in failures:
        print(f"  - {name}")
    raise SystemExit(1)
print("All afl_api Brownlow season artefact contract checks passed.")
