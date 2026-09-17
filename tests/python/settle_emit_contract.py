#!/usr/bin/env python3
"""AFLDB-ISSUE-099 T3 — BEHAVIOURAL contract for the in-season observation bundle.

    python tests/python/settle_emit_contract.py

No database, no psycopg connection, no network. Every scenario drives the REAL
scan_results(), scan_player_stats() and emit_observation_bundle() over temporary
CSV fixtures and the tracked reference data, then asserts what they produced.

Following the tests/python/reference_cascade_contract.py precedent deliberately:
that suite exists because source-string tests passed while the control flow was
wrong. The invariant this file has to protect is exactly the kind a string match
cannot see —

    a source row that was OBSERVED must never become an ABSENT record because
    its projection failed (AFLDB-ISSUE-099 section 19, stop condition SC5)

— so presence enumeration is asserted against the emitted bundle, not against
the shape of the code that builds it.

Exit 0 = every scenario holds. Exit 1 = a scenario failed, and it says which.
"""

from __future__ import annotations

import csv
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "migration"))

import import_fitzroy_core as ifc  # noqa: E402


failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    if not ok:
        if detail:
            print(f"        {detail}")
        failures.append(label)


# ---------------------------------------------------------------------------
# Fixtures. One in-progress season, two regular-round matches, four players.
# ---------------------------------------------------------------------------

SEASON = 2026
SCOPE = f"season={SEASON}"

RESULTS_HEADER = list(ifc.RESULTS_REQUIRED)
PLAYER_HEADER = list(ifc.PLAYER_STATS_REQUIRED)

M1 = {
    "Game": "1", "Date": f"{SEASON}-03-05", "Round": "R1", "Round.Type": "Regular",
    "Round.Number": "1", "Season": str(SEASON),
    "Home.Team": "Sydney", "Away.Team": "Melbourne",
    "Home.Goals": "10", "Home.Behinds": "10", "Home.Points": "70",
    "Away.Goals": "8", "Away.Behinds": "12", "Away.Points": "60",
    "Venue": "S.C.G.", "Margin": "10",
}
M2 = {
    "Game": "2", "Date": f"{SEASON}-05-16", "Round": "R10", "Round.Type": "Regular",
    "Round.Number": "10", "Season": str(SEASON),
    "Home.Team": "Hawthorn", "Away.Team": "Carlton",
    "Home.Goals": "9", "Home.Behinds": "8", "Home.Points": "62",
    "Away.Goals": "14", "Away.Behinds": "15", "Away.Points": "99",
    "Venue": "M.C.G.", "Margin": "-37",
}

#: Cumulative-to-date quarter scores, consistent with the final scores above.
QUARTERS = {
    "1": {"H": [(3, 3, 21), (5, 5, 35), (8, 7, 55), (10, 10, 70)],
          "A": [(2, 2, 14), (4, 5, 29), (6, 9, 45), (8, 12, 60)]},
    "2": {"H": [(2, 2, 14), (4, 4, 28), (7, 6, 48), (9, 8, 62)],
          "A": [(4, 3, 27), (7, 7, 49), (10, 11, 71), (14, 15, 99)]},
}

P_A = {"ID": "101", "First.name": "John", "Surname": "Smith", "Player": "John Smith",
       "url": "https://afltables.com/afl/stats/players/J/John_Smith0.html",
       "DOB": "2-Sep-1999", "Career.Games": "29", "Jumper.No.": "36"}
P_B = {"ID": "102", "First.name": "Ann", "Surname": "Jones", "Player": "Ann Jones",
       "url": "https://afltables.com/afl/stats/players/A/Ann_Jones.html",
       "DOB": "", "Career.Games": "100", "Jumper.No.": "22"}
P_C = {"ID": "", "First.name": "Marcus", "Surname": "Bontempelli",
       "Player": "Marcus Bontempelli",
       "url": "https://afltables.com/afl/stats/players/M/Marcus_Bontempelli.html",
       "DOB": "24-Nov-1995", "Career.Games": "250", "Jumper.No.": "4"}
P_D = {"ID": "104", "First.name": "Jai", "Surname": "Newcombe", "Player": "Jai Newcombe",
       "url": "https://afltables.com/afl/stats/players/J/Jai_Newcombe.html",
       "DOB": "", "Career.Games": "80", "Jumper.No.": "5"}

#: A distinct value per statistic, so a positional mix-up is visible rather than
#: coincidentally right.
STAT_VALUES = {src: str(i + 3) for i, (src, _) in enumerate(ifc.STAT_MAP)}


def player_row(match: dict, player: dict, playing_for: str,
               **overrides: str) -> dict:
    game = match["Game"]
    row = {
        "Season": str(SEASON), "Round": match["Round.Number"], "Date": match["Date"],
        "Local.start.time": "1930", "Venue": match["Venue"], "Attendance": "40012",
        "Playing.for": playing_for,
        "Home.team": match["Home.Team"], "Away.team": match["Away.Team"],
        "Home.score": match["Home.Points"], "Away.score": match["Away.Points"],
    }
    row.update({k: player[k] for k in
                ("First.name", "Surname", "ID", "Jumper.No.", "Player", "url",
                 "Career.Games", "DOB")})
    row.update(STAT_VALUES)
    for side in ("H", "A"):
        for q, (goals, behinds, points) in enumerate(QUARTERS[game][side], start=1):
            row[f"{side}Q{q}G"] = str(goals)
            row[f"{side}Q{q}B"] = str(behinds)
            row[f"{side}Q{q}P"] = str(points)
    row.update(overrides)
    return row


def write_csv(path: Path, header: list[str], rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=header, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in header})


class Snapshot:
    """A temporary in-season snapshot on disk, plus everything the scans need."""

    def __init__(self, results: list[dict], players: list[dict],
                 player_header: list[str] | None = None) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="issue099-emit-"))
        self.results_path = self.dir / "results.csv"
        self.player_path = self.dir / f"player_stats_{SEASON}.csv"
        write_csv(self.results_path, RESULTS_HEADER, results)
        write_csv(self.player_path, player_header or PLAYER_HEADER, players)
        self.manifest_path = self.dir / "manifest.json"
        self.manifest_path.write_text(json.dumps({
            "mode": "acquire", "snapshot_label": "settle-fixture",
            "acquisition_kind": ifc.IN_SEASON_KIND,
            "requested_range": {"from": SEASON, "to": SEASON},
            "fitzroy_version_pinned": "1.8.0",
        }, indent=2), encoding="utf-8")
        self.files = [
            ifc.SnapshotFile(dataset="results", path=self.results_path, season=None),
            ifc.SnapshotFile(dataset="player_stats", path=self.player_path,
                             season=SEASON),
        ]

    def cleanup(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)


def clubs_resolver() -> ifc.ClubResolver:
    return ifc.ClubResolver(
        json.loads((ROOT / "data" / "reference" / "clubs.json").read_text("utf-8")),
        json.loads(ifc.CONTRACT_PATH.read_text("utf-8"))
        .get("source_club_normalisation", {}).get("rules", []),
    )


def run(snapshot: Snapshot, *, mode: str = ifc.ON_RECORD_ERROR_REJECT,
        vote_seasons: set[int] | None = None, out_name: str = "observations.json"):
    """Drive the real scan + emit path end to end and return the bundle."""
    clubs = clubs_resolver()
    policy = ifc.RecordErrorPolicy(mode, scope_key=SCOPE)
    matches = ifc.scan_results(snapshot.results_path, clubs, policy)
    # AFLDB-ISSUE-136 added a fourth return (the continuity rules applied); in-season
    # `continuity` is None, so it is always empty here.
    players, rows_read, votes, _continuity = ifc.scan_player_stats(
        snapshot.files, matches, clubs, vote_seasons if vote_seasons is not None
        else {SEASON}, [], policy)
    bundle = ifc.emit_observation_bundle(
        out_path=snapshot.dir / out_name, label="settle-fixture",
        manifest_path=snapshot.manifest_path,
        manifest=json.loads(snapshot.manifest_path.read_text("utf-8")),
        files=snapshot.files, matches=matches, clubs=clubs, corrections=[],
        round_vote_seasons=vote_seasons if vote_seasons is not None else {SEASON},
        policy=policy, season=SEASON)
    return bundle, matches, players, policy, rows_read, votes


def enumeration(bundle: dict, family: str) -> dict:
    return next(e for e in bundle["enumerations"] if e["family"] == family)


def records(bundle: dict, family: str) -> list[dict]:
    return [r for r in bundle["records"] if r["family"] == family]


BASE_RESULTS = [M1, M2]
BASE_PLAYERS = [
    player_row(M1, P_A, "Sydney"), player_row(M1, P_B, "Melbourne"),
    player_row(M2, P_C, "Hawthorn"), player_row(M2, P_D, "Carlton"),
]


# ---------------------------------------------------------------------------
# A. The record-error policy
# ---------------------------------------------------------------------------

print("\nA. --on-record-error")

snap = Snapshot(BASE_RESULTS, BASE_PLAYERS)
bundle, matches, players, policy, rows_read, vote_rows = run(snap)
check("A1 a clean in-season snapshot scans and emits",
      len(matches) == 2 and rows_read == 4 and policy.rejections == [],
      f"matches={len(matches)} rows={rows_read} rejections={policy.rejections}")
check("A2 the bundle declares its contract version and in-season kind",
      bundle["bundle_contract_version"] == ifc.BUNDLE_CONTRACT_VERSION
      and bundle["acquisition_kind"] == ifc.IN_SEASON_KIND
      and bundle["season"] == SEASON,
      json.dumps({k: bundle[k] for k in
                  ("bundle_contract_version", "acquisition_kind", "season")}))
check("A3 the bundle binds itself to the manifest by hash",
      bundle["manifest_sha256"] == ifc.sha256_file(snap.manifest_path)
      and len(bundle["manifest_sha256"]) == 64)
snap.cleanup()

# The default policy is `abort`: one bad record kills the pass. That is what a clean
# rebuild needs and it must not change.
check("A4 the CLI default is abort, not reject",
      ifc.RecordErrorPolicy().mode == ifc.ON_RECORD_ERROR_ABORT
      and not ifc.RecordErrorPolicy().collecting)

bad_results = [M1, dict(M2, **{"Home.Points": "63"})]     # scores do not reconcile
snap = Snapshot(bad_results, BASE_PLAYERS)
aborted = None
try:
    ifc.scan_results(snap.results_path, clubs_resolver(),
                     ifc.RecordErrorPolicy(ifc.ON_RECORD_ERROR_ABORT, SCOPE))
except ifc.MatchIdentityError as exc:
    aborted = str(exc)
check("A5 abort re-raises the original per-record error unchanged",
      aborted is not None and "do not reconcile with points" in aborted, str(aborted))

collected = ifc.RecordErrorPolicy(ifc.ON_RECORD_ERROR_REJECT, SCOPE)
kept = ifc.scan_results(snap.results_path, clubs_resolver(), collected)
check("A6 reject collects the bad record and keeps the good one",
      len(kept) == 1 and len(collected.rejections) == 1
      and collected.rejections[0].reason == "match_identity",
      f"kept={len(kept)} rejections={collected.rejections}")
snap.cleanup()

# An unrecognised policy is a refusal, never a silent fallback to either mode.
refused = None
try:
    ifc.RecordErrorPolicy("skip")
except ifc.SnapshotValidationError as exc:
    refused = str(exc)
check("A7 an unknown policy is refused rather than defaulted",
      refused is not None and "skip" in refused, str(refused))


# ---------------------------------------------------------------------------
# B. HARD INVARIANT (section 19) — observed but rejected is never absent
# ---------------------------------------------------------------------------

print("\nB. presence is enumerated independently of projection")

# I1: a results row that fails interpretation but still has a provable identity.
snap = Snapshot([M1, dict(M2, **{"Home.Points": "63"})], BASE_PLAYERS)
bundle, matches, players, policy, _, _ = run(snap)
m_enum = enumeration(bundle, ifc.FAMILY_MATCH)
m_records = {r["external_record_id"]: r for r in records(bundle, ifc.FAMILY_MATCH)}
rejected_id = f"{SEASON}|10|{SEASON}-05-16|Hawthorn|Carlton"
check("B1 (I1) an observed-but-rejected match is still ENUMERATED as present",
      rejected_id in m_enum["external_record_ids"] and len(m_enum["external_record_ids"]) == 2,
      json.dumps(m_enum["external_record_ids"]))
check("B2 (I1) the rejected match has a records[] entry with no projection",
      rejected_id in m_records
      and m_records[rejected_id]["projection"] is None
      and m_records[rejected_id]["rejection"]["reason"] == "match_identity",
      json.dumps(m_records.get(rejected_id, {}).get("rejection")))
check("B3 (I1) the rejected match still carries its full source payload",
      m_records[rejected_id]["payload"]["home_team_raw"] == "Hawthorn"
      and m_records[rejected_id]["payload"]["home_points"] == 63,
      json.dumps(m_records[rejected_id]["payload"]))
check("B4 (I1) the match enumeration stays COMPLETE — the identity was provable",
      m_enum["complete"] is True and m_enum["incomplete_reason"] is None
      and not [u for u in bundle["unkeyed_rejections"]
               if u["family"] == ifc.FAMILY_MATCH],
      json.dumps(bundle["unkeyed_rejections"]))
# The player rows of that match can no longer join a results match, so THEY have no
# provable identity — which must make the player enumeration incomplete, not absent.
p_enum = enumeration(bundle, ifc.FAMILY_PLAYER_MATCH)
check("B5 (I2) player rows orphaned by the rejected match become UNKEYED",
      p_enum["complete"] is False
      and len([u for u in bundle["unkeyed_rejections"]
               if u["family"] == ifc.FAMILY_PLAYER_MATCH]) == 2,
      json.dumps(p_enum))
snap.cleanup()

# I2: a player row with no profile URL at all. Its presence cannot be represented.
snap = Snapshot(BASE_RESULTS,
                BASE_PLAYERS[:3] + [player_row(M2, P_D, "Carlton", url="")])
bundle, matches, players, policy, _, _ = run(snap)
p_enum = enumeration(bundle, ifc.FAMILY_PLAYER_MATCH)
unkeyed = [u for u in bundle["unkeyed_rejections"]
           if u["family"] == ifc.FAMILY_PLAYER_MATCH]
check("B6 (I2) a row with no provable key goes to unkeyed_rejections",
      len(unkeyed) == 1 and unkeyed[0]["reason"] == "no_player_match_identity",
      json.dumps(unkeyed))
check("B7 (I2) and forces complete:false on that family and scope",
      p_enum["complete"] is False and p_enum["incomplete_reason"] is not None
      and p_enum["scope_key"] == SCOPE,
      json.dumps(p_enum))
check("B8 (I2) the OTHER family is unaffected — the refusal is scoped",
      enumeration(bundle, ifc.FAMILY_MATCH)["complete"] is True)
check("B9 an unkeyable row is never smuggled into the enumeration",
      len(p_enum["external_record_ids"]) == 3
      and all("@" in i for i in p_enum["external_record_ids"]),
      json.dumps(p_enum["external_record_ids"]))
snap.cleanup()

# The bundle's own consistency rules (section 8 validation 5 and 6).
snap = Snapshot(BASE_RESULTS, BASE_PLAYERS)
bundle, *_ = run(snap)
consistent = True
detail = ""
for enum in bundle["enumerations"]:
    ids = set(enum["external_record_ids"])
    record_ids = {r["external_record_id"] for r in records(bundle, enum["family"])}
    if record_ids != ids:
        consistent = False
        detail = f"{enum['family']}: records {record_ids ^ ids}"
    if enum["complete"] != (not [u for u in bundle["unkeyed_rejections"]
                                 if u["family"] == enum["family"]]):
        consistent = False
        detail = f"{enum['family']}: complete disagrees with unkeyed_rejections"
check("B10 every enumerated id has exactly one record, and vice versa",
      consistent, detail)
run(snap, out_name="again.json")
check("B11 the emission is deterministic — same snapshot, byte-identical bundle",
      (snap.dir / "observations.json").read_bytes()
      == (snap.dir / "again.json").read_bytes())
snap.cleanup()


# ---------------------------------------------------------------------------
# C. Source semantics: identity, NULL/NA, attendance, quarters
# ---------------------------------------------------------------------------

print("\nC. source semantics")

snap = Snapshot(BASE_RESULTS, BASE_PLAYERS)
bundle, matches, players, policy, _, _ = run(snap)
p_records = {r["external_record_id"]: r for r in records(bundle, ifc.FAMILY_PLAYER_MATCH)}
a_id = ("players/J/John_Smith0.html@"
        f"{SEASON}|1|{SEASON}-03-05|Sydney|Melbourne")
check("C1 the player key is the profile url path plus the match key",
      a_id in p_records, json.dumps(sorted(p_records)))
# P5: `ID` is enrichment. P_C carries none and must still project.
c_record = next(r for r in p_records.values() if r["payload"]["afltables_id"] is None)
check("C2 (P5) a row with no fitzRoy ID still projects, keyed on the url",
      c_record["projection"] is not None
      and c_record["projection"]["url"].endswith("Marcus_Bontempelli.html")
      and c_record["projection"]["afltables_id"] is None)
check("C3 no payload or projection key is a player NAME",
      all(k not in ("player", "name") for k in c_record["payload"])
      and "player_name" in c_record["payload"])

# STAT_MAP by explicit name.
payload = p_records[a_id]["payload"]
mapped = all(payload[target] == int(STAT_VALUES[src]) for src, target in ifc.STAT_MAP)
check("C4 every STAT_MAP column maps by name into the payload", mapped,
      json.dumps({t: payload[t] for _, t in ifc.STAT_MAP}))
check("C5 Time.on.Ground is not projected (it has no target column)",
      "time_on_ground" not in payload and "Time.on.Ground" not in payload)
snap.cleanup()

# Same values, stat columns written in REVERSE header order: a positional reader
# would now be wrong on every column.
shuffled_header = [c for c in PLAYER_HEADER if c not in STAT_VALUES]
shuffled_header += list(reversed(list(STAT_VALUES)))
snap = Snapshot(BASE_RESULTS, BASE_PLAYERS, player_header=shuffled_header)
bundle, *_ = run(snap)
payload = next(r["payload"] for r in records(bundle, ifc.FAMILY_PLAYER_MATCH)
               if r["external_record_id"] == a_id)
check("C6 reordering the CSV stat columns changes nothing — the map is by name",
      all(payload[target] == int(STAT_VALUES[src]) for src, target in ifc.STAT_MAP),
      json.dumps({t: payload[t] for _, t in ifc.STAT_MAP}))
snap.cleanup()

# NULL is not recorded, and is never 0.
snap = Snapshot(BASE_RESULTS,
                [player_row(M1, P_A, "Sydney", **{"Kicks": "", "Goals": "0"})]
                + BASE_PLAYERS[1:])
bundle, *_ = run(snap)
record = next(r for r in records(bundle, ifc.FAMILY_PLAYER_MATCH)
              if r["external_record_id"] == a_id)
check("C7 a blank statistic stays NULL in the payload, never 0",
      record["payload"]["kicks"] is None and record["payload"]["goals"] == 0)
check("C8 and stays NULL through the projection",
      record["projection"]["stats"]["kicks"] is None
      and record["projection"]["stats"]["goals"] == 0)
snap.cleanup()

# Attendance: blank is no observation, 0 is real, two values fail the record closed.
snap = Snapshot(BASE_RESULTS, [
    player_row(M1, P_A, "Sydney", Attendance=""),
    player_row(M1, P_B, "Melbourne", Attendance="40012"),
    *BASE_PLAYERS[2:],
])
bundle, matches, *_ = run(snap)
m1_id = f"{SEASON}|1|{SEASON}-03-05|Sydney|Melbourne"
m1 = next(r for r in records(bundle, ifc.FAMILY_MATCH)
          if r["external_record_id"] == m1_id)
check("C9 a blank attendance cell is no observation, not a contradiction",
      m1["projection"]["attendance"] == 40012
      and m1["projection"]["attendance_status"] == "complete"
      and m1["projection"]["attendance_source_key"] == "afltables")
snap.cleanup()

snap = Snapshot(BASE_RESULTS, [
    player_row(M1, P_A, "Sydney", Attendance="0"),
    player_row(M1, P_B, "Melbourne", Attendance="0"),
    *BASE_PLAYERS[2:],
])
bundle, *_ = run(snap)
m1 = next(r for r in records(bundle, ifc.FAMILY_MATCH)
          if r["external_record_id"] == m1_id)
check("C10 a recorded 0 attendance is a real value that cites its source",
      m1["projection"]["attendance"] == 0
      and m1["projection"]["attendance_status"] == "complete"
      and m1["projection"]["attendance_source_key"] == "afltables")
snap.cleanup()

snap = Snapshot(BASE_RESULTS, [
    player_row(M1, P_A, "Sydney", Attendance="40012"),
    player_row(M1, P_B, "Melbourne", Attendance="50000"),
    *BASE_PLAYERS[2:],
])
bundle, matches, players, policy, _, _ = run(snap)
conflict = [r for r in policy.rejections if "attendance" in r.detail]
check("C11 two distinct non-null attendances fail the RECORD closed, not the pass",
      len(conflict) == 1 and conflict[0].external_record_id is not None
      and len(matches) == 2,
      json.dumps([r.detail for r in policy.rejections]))
check("C12 and the conflicting row is still enumerated as present",
      conflict[0].external_record_id
      in enumeration(bundle, ifc.FAMILY_PLAYER_MATCH)["external_record_ids"])
check("C13 the rejected row's attendance never reaches the match projection",
      next(r for r in records(bundle, ifc.FAMILY_MATCH)
           if r["external_record_id"] == m1_id)["projection"]["attendance"] == 40012)
snap.cleanup()

# Quarters: periods 1-4 only, both sides, cumulative as published; an all-NULL
# period writes no projection row but is preserved in the payload.
snap = Snapshot(BASE_RESULTS, BASE_PLAYERS)
bundle, *_ = run(snap)
m1 = next(r for r in records(bundle, ifc.FAMILY_MATCH)
          if r["external_record_id"] == m1_id)
periods = m1["projection"]["period_scores"]
check("C14 period scores are periods 1-4 for both sides and nothing else",
      len(periods) == 8
      and sorted({p["period"] for p in periods}) == [1, 2, 3, 4]
      and sorted({p["side"] for p in periods}) == ["away", "home"])
check("C15 period scores are cumulative-to-date, exactly as published",
      [p["points"] for p in periods if p["side"] == "home"] == [21, 35, 55, 70])
snap.cleanup()

blank_q = {f"HQ{q}{k}": "" for q in (4,) for k in ("G", "B", "P")}
snap = Snapshot(BASE_RESULTS, [
    player_row(M1, P_A, "Sydney", **blank_q),
    player_row(M1, P_B, "Melbourne", **blank_q),
    *BASE_PLAYERS[2:],
])
bundle, *_ = run(snap)
m1 = next(r for r in records(bundle, ifc.FAMILY_MATCH)
          if r["external_record_id"] == m1_id)
check("C16 an all-NULL period writes NO projection row (not recorded is not 0)",
      len(m1["projection"]["period_scores"]) == 7
      and not any(p["side"] == "home" and p["period"] == 4
                  for p in m1["projection"]["period_scores"]))
check("C17 but the payload still preserves the NULL observation",
      any(p["side"] == "home" and p["period"] == 4 and p["points"] is None
          for p in m1["payload"]["period_scores"]))
snap.cleanup()


# ---------------------------------------------------------------------------
# D. Brownlow — NA is never 0, and the F11 offline measurement
# ---------------------------------------------------------------------------

print("\nD. Brownlow votes")

snap = Snapshot(BASE_RESULTS, [
    player_row(M1, P_A, "Sydney", **{"Brownlow.Votes": "3"}),
    player_row(M1, P_B, "Melbourne", **{"Brownlow.Votes": ""}),
    player_row(M2, P_C, "Hawthorn", **{"Brownlow.Votes": "0"}),
    player_row(M2, P_D, "Carlton", **{"Brownlow.Votes": ""}),
])
bundle, *_ = run(snap)
by_id = {r["external_record_id"]: r for r in records(bundle, ifc.FAMILY_PLAYER_MATCH)}
vote_rows = [r["projection"]["brownlow_round_vote"] for r in by_id.values()
             if r["projection"] is not None]
check("D1 an NA vote produces NO brownlow row, ever",
      sum(1 for v in vote_rows if v is None) == 2)
check("D2 a published vote produces one row at the round grain",
      by_id[a_id]["projection"]["brownlow_round_vote"]
      == {"season": SEASON, "round_number": 1, "votes": 3},
      json.dumps(by_id[a_id]["projection"]["brownlow_round_vote"]))
check("D3 a published 0 is a real vote, distinct from NA",
      sum(1 for v in vote_rows if v is not None and v["votes"] == 0) == 1)
check("D4 the NULL stays NULL in the payload too",
      by_id[a_id]["payload"]["brownlow_votes"] == 3
      and any(r["payload"]["brownlow_votes"] is None for r in by_id.values()))

measurement = bundle["measurements"]["brownlow_votes"]
check("D5 (F11) the offline measurement records the NA count and distinct values",
      measurement["rows"] == 4 and measurement["rows_na"] == 2
      and measurement["rows_with_votes"] == 2
      and measurement["distinct_values"] == [0, 3],
      json.dumps(measurement))
snap.cleanup()

# An ungated season publishes nothing, and that is the expected in-season outcome.
snap = Snapshot(BASE_RESULTS, [
    player_row(M1, P_A, "Sydney", **{"Brownlow.Votes": "3"}),
    *BASE_PLAYERS[1:],
])
bundle, *_ = run(snap, vote_seasons=set())
projected = [r["projection"]["brownlow_round_vote"]
             for r in records(bundle, ifc.FAMILY_PLAYER_MATCH)
             if r["projection"] is not None]
check("D6 an ungated season produces ZERO brownlow rows, never a 0-vote filler",
      all(v is None for v in projected)
      and bundle["measurements"]["brownlow_votes"]["projectable_round_vote_rows"] == 0,
      json.dumps(projected))
check("D7 the source evidence is retained even when nothing is projectable",
      bundle["measurements"]["brownlow_votes"]["rows_with_votes"] == 4)
snap.cleanup()


# ---------------------------------------------------------------------------
# E. Projection refusals, and the DB-free boundary
# ---------------------------------------------------------------------------

print("\nE. projection refusals and the database boundary")

# section 17.1: a match with no joined player row is not proposed, but IS observed.
snap = Snapshot(BASE_RESULTS, BASE_PLAYERS[:2])
bundle, *_ = run(snap)
m2_id = f"{SEASON}|10|{SEASON}-05-16|Hawthorn|Carlton"
m2 = next(r for r in records(bundle, ifc.FAMILY_MATCH)
          if r["external_record_id"] == m2_id)
check("E1 a match with no player rows is enumerated but NOT projected",
      m2["projection"] is None
      and m2["rejection"]["reason"] == "incomplete_match_evidence"
      and m2_id in enumeration(bundle, ifc.FAMILY_MATCH)["external_record_ids"],
      json.dumps(m2["rejection"]))
snap.cleanup()

# A player with no usable name at all is an aggregate contradiction. It must refuse
# the PROJECTION and still enumerate the record.
nameless = dict(P_D, **{"First.name": "", "Surname": "", "Player": ""})
snap = Snapshot(BASE_RESULTS, BASE_PLAYERS[:3] + [player_row(M2, nameless, "Carlton")])
bundle, matches, players, policy, _, _ = run(snap)
bad = next(r for r in records(bundle, ifc.FAMILY_PLAYER_MATCH)
           if r["payload"]["url"].endswith("Jai_Newcombe.html"))
check("E2 a nameless player refuses its PROJECTION, not the pass",
      bad["projection"] is None
      and bad["rejection"]["reason"] == "unresolved_identity"
      and len(policy.unusable_players) == 1,
      json.dumps(bad["rejection"]))
check("E3 and its record is still enumerated as present",
      bad["external_record_id"]
      in enumeration(bundle, ifc.FAMILY_PLAYER_MATCH)["external_record_ids"]
      and enumeration(bundle, ifc.FAMILY_PLAYER_MATCH)["complete"] is True)

aborting = ifc.RecordErrorPolicy(ifc.ON_RECORD_ERROR_ABORT, SCOPE)
clubs = clubs_resolver()
raised = None
try:
    ifc.scan_player_stats(snap.files,
                          ifc.scan_results(snap.results_path, clubs, aborting),
                          clubs, {SEASON}, [], aborting)
except ifc.PlayerIdentityError as exc:
    raised = str(exc)
check("E4 under abort the same case still raises, unchanged",
      raised is not None and "has no usable name" in raised, str(raised))
snap.cleanup()

check("E5 emitting a bundle opens no database driver",
      "psycopg" not in sys.modules and "common" not in sys.modules,
      ", ".join(sorted(m for m in sys.modules if m in ("psycopg", "common"))))
check("E6 no canonical writer is reachable from the emit path",
      not any(name in ifc.emit_observation_bundle.__code__.co_names
              for name in ("import_matches", "import_players", "import_venues",
                           "import_player_match_stats", "import_brownlow_round_votes",
                           "connect_pg")))

print()
if failures:
    print(f"FAILED: {len(failures)} scenario(s): {', '.join(failures)}")
    raise SystemExit(1)
print("All in-season observation-bundle scenarios hold.")
