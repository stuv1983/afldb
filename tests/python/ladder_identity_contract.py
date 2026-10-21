#!/usr/bin/env python3
"""AFLDB-ISSUE-095 D5 — the ladder witness's club labels resolve to one historical identity.

    python tests/python/ladder_identity_contract.py

The fitzRoy ladder dataset emits ONE MODERNISED label per organization across all time,
in both directions: `Sydney` back to 1897 (before the 1982 rename), `Brisbane Lions` back
to 1987 (the Bears era), `Footscray` forward to 2025 (after the 1997 rename), and
`North Melbourne` right across 1999-2007, when the club traded as the Kangaroos. The
`Kangaroos` label is never emitted at all.

Three of those four families were already safe. The fourth was not, and it FAILED OPEN:
North Melbourne's canonical span (1925-present) CONTAINS the Kangaroos era, so the
ordinary era check succeeds, no organization walk is attempted, and the row resolves
silently to the modern identity with no error at all. The existing repair for that defect
is scoped `dataset: "results"`, so it does not fire for a ladder lookup.

These checks run the REAL ClubResolver against the REAL contract and the REAL
clubs.json, over every one of the 1,622 (label, season) pairs the source emits — not
the four boundary examples. Test 6 is the regression proof: it rebuilds a resolver with
the ladder rule removed and asserts the wrong answer comes back, so a future edit that
drops or re-scopes the rule cannot pass quietly.

No database, no network, no importer execution.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "migration"))

import import_fitzroy_core as fz  # noqa: E402

CONTRACT = ROOT / "tools" / "rebuild" / "fitzroy" / "fitzroy-contract.json"
LABELS = ROOT / "tools" / "rebuild" / "fitzroy" / "ladder-source-labels.json"
CLUBS = ROOT / "data" / "reference" / "clubs.json"

DATASET = "ladder"

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' — ' + detail) if detail else ''}")
        failures.append(name)


contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
labels_doc = json.loads(LABELS.read_text(encoding="utf-8"))
clubs = json.loads(CLUBS.read_text(encoding="utf-8"))
rules = contract["source_club_normalisation"]["rules"]


def resolver(source_rules: list[dict]) -> fz.ClubResolver:
    return fz.ClubResolver(clubs, source_rules)


def pairs() -> list[tuple[str, int]]:
    """Regenerate the exact (label, season) universe from the tracked spans."""
    out: list[tuple[str, int]] = []
    for row in labels_doc["labels"]:
        missing = set(row["missing"])
        for season in range(row["first"], row["last"] + 1):
            if season not in missing:
                out.append((row["label"], season))
    return out


# ---------------------------------------------------------------------------
# 1. `ladder` is a dataset a rule may legally name
# ---------------------------------------------------------------------------
print("\n1. dataset registration")
check("KNOWN_DATASETS includes 'ladder'", DATASET in fz.KNOWN_DATASETS,
      f"got {fz.KNOWN_DATASETS!r}")
check("contract declares a 'ladder' dataset", DATASET in contract["datasets"])
check("'ladder' is NOT a required full-history dataset",
      DATASET not in contract["full_history"]["required_datasets"],
      "adding it would retroactively invalidate every accepted baseline")
check("'ladder' is declared a validation witness",
      contract["datasets"][DATASET].get("role") == "VALIDATION_WITNESS")
check("'ladder' provenance is recorded as locally computed",
      contract["datasets"][DATASET]["provenance"]["verdict"] == "LOCALLY_COMPUTED")

# ---------------------------------------------------------------------------
# 2. The tracked label universe is the measured one
# ---------------------------------------------------------------------------
print("\n2. source label universe")
all_pairs = pairs()
check("regenerates exactly 1,622 (label, season) pairs",
      len(all_pairs) == labels_doc["club_season_pairs"] == 1622,
      f"got {len(all_pairs)}")
check("covers exactly 20 distinct labels",
      len({label for label, _ in all_pairs}) == 20)
check("no pair falls outside 1897-2025",
      all(1897 <= s <= 2025 for _, s in all_pairs))
check("'Kangaroos' is never emitted by the source",
      not any(label == "Kangaroos" for label, _ in all_pairs))

# ---------------------------------------------------------------------------
# 3. The four rename/merger boundary families
# ---------------------------------------------------------------------------
print("\n3. rename and merger boundaries")
r = resolver(rules)

BOUNDARIES = [
    ("Sydney", 1897, "South Melbourne"), ("Sydney", 1981, "South Melbourne"),
    ("Sydney", 1982, "Sydney"), ("Sydney", 2025, "Sydney"),
    ("Footscray", 1925, "Footscray"), ("Footscray", 1996, "Footscray"),
    ("Footscray", 1997, "Western Bulldogs"), ("Footscray", 2025, "Western Bulldogs"),
    ("North Melbourne", 1998, "North Melbourne"),
    ("North Melbourne", 1999, "Kangaroos"), ("North Melbourne", 2007, "Kangaroos"),
    ("North Melbourne", 2008, "North Melbourne"),
    ("Brisbane Lions", 1987, "Brisbane Bears"), ("Brisbane Lions", 1996, "Brisbane Bears"),
    ("Brisbane Lions", 1997, "Brisbane Lions"), ("Brisbane Lions", 2025, "Brisbane Lions"),
]
for label, season, expected in BOUNDARIES:
    try:
        got = r.resolve(label, season, DATASET)
    except Exception as exc:                                  # noqa: BLE001
        got = f"RAISED {type(exc).__name__}: {exc}"
    check(f"{label!r} + {season} -> {expected}", got == expected, f"got {got!r}")

# ---------------------------------------------------------------------------
# 4. Every one of the 1,622 pairs resolves to exactly one identity
# ---------------------------------------------------------------------------
print("\n4. exhaustive resolution over the whole source universe")
unresolved: list[str] = []
resolved: dict[tuple[str, int], str] = {}
for label, season in all_pairs:
    try:
        resolved[(label, season)] = r.resolve(label, season, DATASET)
    except Exception as exc:                                  # noqa: BLE001
        unresolved.append(f"{label} {season}: {type(exc).__name__}: {exc}")

check("all 1,622 pairs resolve", not unresolved,
      f"{len(unresolved)} failed, first: {unresolved[0] if unresolved else ''}")
check("every resolved value is a real club identity",
      all(v in r.identities for v in resolved.values()))

# The era each resolved identity claims must actually contain the season.
era_violations = [
    f"{label} {season} -> {hist}"
    for (label, season), hist in resolved.items()
    if not r._era_contains(hist, season)                      # noqa: SLF001
]
check("every resolution lands inside that identity's own era", not era_violations,
      f"{len(era_violations)} violations, first: {era_violations[0] if era_violations else ''}")

# A season must never resolve two labels onto the same identity: that would be two
# ladder rows for one club, breaking club_seasons' UNIQUE (season, club_id).
collisions = []
for season in range(1897, 2026):
    seen: dict[str, str] = {}
    for (label, s), hist in resolved.items():
        if s != season:
            continue
        if hist in seen:
            collisions.append(f"{season}: {seen[hist]!r} and {label!r} both -> {hist}")
        seen[hist] = label
check("no season maps two labels onto one identity", not collisions,
      f"{len(collisions)} collisions, first: {collisions[0] if collisions else ''}")

# ---------------------------------------------------------------------------
# 5. Mergers are never combined
# ---------------------------------------------------------------------------
print("\n5. distinct organizations stay distinct")
fitzroy_seasons = {s for (label, s) in resolved if label == "Fitzroy"}
check("Fitzroy holds exactly its 100 seasons, 1897-1996",
      len(fitzroy_seasons) == 100 and max(fitzroy_seasons) == 1996,
      f"got {len(fitzroy_seasons)} seasons, last {max(fitzroy_seasons)}")
check("no Fitzroy row ever resolves to a Brisbane identity",
      all(hist == "Fitzroy" for (label, _), hist in resolved.items() if label == "Fitzroy"))
check("Brisbane Bears holds exactly 1987-1996",
      {s for (l, s), h in resolved.items() if h == "Brisbane Bears"} == set(range(1987, 1997)))
check("Brisbane Lions starts in 1997",
      min(s for (l, s), h in resolved.items() if h == "Brisbane Lions") == 1997)
check("Kangaroos holds exactly 1999-2007",
      {s for (l, s), h in resolved.items() if h == "Kangaroos"} == set(range(1999, 2008)))

# The era partitions must be complete and non-overlapping.
for org, members, total in [
    ("Footscray/Western Bulldogs", ("Footscray", "Western Bulldogs"), 101),
    ("South Melbourne/Sydney", ("South Melbourne", "Sydney"), 128),
    ("Kangaroos/North Melbourne", ("Kangaroos", "North Melbourne"), 101),
]:
    seasons = [s for (_, s), h in resolved.items() if h in members]
    check(f"{org} partitions into {total} seasons with no overlap",
          len(seasons) == len(set(seasons)) == total, f"got {len(seasons)}")

# ---------------------------------------------------------------------------
# 6. REGRESSION — without the ladder rule the Kangaroos era fails OPEN
# ---------------------------------------------------------------------------
print("\n6. the ladder rule is load-bearing")
ladder_rule = [
    rule for rule in rules
    if rule.get("dataset") == DATASET and rule["raw"] == "North Melbourne"
]
check("the ladder-scoped North Melbourne rule exists", len(ladder_rule) == 1)
check("it covers exactly 1999-2007 and names Kangaroos",
      bool(ladder_rule)
      and ladder_rule[0]["first_season"] == 1999
      and ladder_rule[0]["last_season"] == 2007
      and ladder_rule[0]["resolves_to_hist"] == "Kangaroos")

without = resolver([rule for rule in rules if rule not in ladder_rule])
check("WITHOUT it, 'North Melbourne' + 2003 silently returns the WRONG identity",
      without.resolve("North Melbourne", 2003, DATASET) == "North Melbourne",
      "if this now raises or returns Kangaroos, the fail-open hazard has changed shape "
      "and this test must be re-derived rather than deleted")

# The Brisbane rule is deliberately unscoped; narrowing it would fail CLOSED, not open.
brisbane_only = resolver([rule for rule in rules if rule.get("raw") != "Brisbane Lions"])
try:
    brisbane_only.resolve("Brisbane Lions", 1990, DATASET)
    raised = False
except fz.MatchIdentityError:
    raised = True
check("WITHOUT the Brisbane rule, the Bears era fails CLOSED rather than merging orgs",
      raised, "the organization model must refuse to bridge a merger")

# ---------------------------------------------------------------------------
# 7. Local wildcard-final comparison regression (no database/network)
# ---------------------------------------------------------------------------
import copy  # noqa: E402
import contextlib  # noqa: E402
import datetime  # noqa: E402
import io  # noqa: E402
import types  # noqa: E402
import tempfile  # noqa: E402
from decimal import Decimal  # noqa: E402
from unittest.mock import patch  # noqa: E402

sys.path.insert(0, str(ROOT / "tools/rebuild/fitzroy"))
import validate_ladder_witness as lw  # noqa: E402

print("\n7. strict wildcard reconciliation (local fixtures, mocked SELECTs)")
fixture = json.loads((Path(__file__).with_name("ladder_wildcard_fixture.json"))
                     .read_text(encoding="utf-8"))
slug_of = {c["hist"]: c["slug"] for c in clubs["identities"]}
def slug(label):
    return slug_of[r.resolve(label, 2026, "results")]

raw = {}
for team, points, sf, sa, pos in fixture["ladder"]:
    sf, sa = int(sf), int(sa)
    raw[(2026, slug(team))] = dict(team=team, season_points=int(points),
        score_for=sf, score_against=sa, ladder_position=int(pos),
        percentage_stored=lw.pct_stored(sf, sa))
raw_before = copy.deepcopy(raw)

canonical, source_wf = [], []
for date, code, home, away, hs, aws, source_type in fixture["matches"]:
    _, kind = fz.normalise_results_round(code, "test")
    hs, aws = int(hs), int(aws)
    match = dict(season=2026, date=date, home=slug(home), away=slug(away),
                 home_score=hs, away_score=aws, round_type=kind,
                 is_final=kind != "home_and_away", result="draw" if hs == aws else "win",
                 winner=None if hs == aws else slug(home if hs > aws else away))
    canonical.append(match)
    if kind == "wildcard_final":
        source_wf.append({**match, "source_round_type": source_type})

# Independently pinned diagnostic values, not generated by the implementation under test.
policy = copy.deepcopy(raw)
for team, points, sf, sa, pct, pos in [
    ("Melbourne", 60, 2301, 2099, "109.6236", 7),
    ("Footscray", 54, 1901, 1992, "95.4317", 8),
    ("Carlton", 50, 2007, 1978, "101.4661", 10),
    ("Collingwood", 52, 2021, 1974, "102.3810", 9),
]:
    policy[(2026, slug(team))].update(season_points=points, score_for=sf,
        score_against=sa, percentage_stored=Decimal(pct), ladder_position=pos)

def comparison(witness=raw, matches=canonical, source=source_wf, derived=policy):
    """Exercise the real D7 adapter; no real driver, connection or source selection."""
    report = lw.Report()
    queries = []
    class Cursor:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def execute(self, sql, params=None): queries.append((sql, params))
        def fetchall(self):
            if len(queries) == 1:
                return [(key[0], key[1], row["score_for"], row["score_against"],
                         row["season_points"], row["ladder_position"], row["percentage_stored"])
                        for key, row in derived.items()]
            return [(m["season"], datetime.date.fromisoformat(m["date"]), m["home"],
                     m["away"], m["home_score"], m["away_score"], m["round_type"],
                     m["is_final"], m["result"], m["winner"]) for m in matches]
    class Connection:
        read_only = False
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def cursor(self):
            assert self.read_only is True
            return Cursor()
    output = io.StringIO()
    with patch.dict(sys.modules, psycopg=types.SimpleNamespace(connect=lambda _: Connection())), \
         patch.dict(lw.os.environ, AFLDB_IMPORT_DATABASE_URL="mock-local-only"), \
         patch.object(lw, "load_source_wildcards", return_value=source), \
         contextlib.redirect_stdout(output):
        lw.compare_to_database(witness, report)
    assert len(queries) == 2 and all(q.lstrip().startswith("SELECT") for q, _ in queries)
    return report.failures, output.getvalue()

bad, output = comparison()
check("all 18 rows reconcile, including all four WF clubs", not bad, str(bad))
check("PASS explicitly requires raw H&A-plus-WF reconstruction",
      "PASS  2026 H&A-plus-WF reconstruction" in output)
check("every club is printed in the raw-versus-policy diagnostic",
      all(f"        {key[1]} | " in output for key in raw))
check("Carlton/Collingwood swap 9/10 to 10/9",
      policy[(2026, slug("Carlton"))]["ladder_position"] == 10
      and policy[(2026, slug("Collingwood"))]["ladder_position"] == 9)
with contextlib.redirect_stdout(io.StringIO()):
    corrected = lw.wildcard_policy(raw, canonical, source_wf, lw.Report())
check("14 unaffected clubs retain all five raw fields",
      all(corrected[k] == raw[k] for k in raw
          if k[1] not in {slug(t) for t in ("Melbourne", "Footscray", "Carlton", "Collingwood")}))
check("comparison never mutates witness rows", raw == raw_before)

wf_index = next(i for i, m in enumerate(canonical) if m["round_type"] == "wildcard_final")
def changed_match(index, **values):
    rows = copy.deepcopy(canonical)
    rows[index].update(values)
    return rows

negative_cases = [
    ("missing canonical WF", dict(matches=canonical[:wf_index] + canonical[wf_index+1:])),
    ("extra canonical WF", dict(matches=canonical + [canonical[wf_index]])),
    ("missing source WF", dict(source=source_wf[:1])),
    ("extra source WF", dict(source=source_wf + [source_wf[0]])),
    ("both sides duplicating WF", dict(matches=canonical + [canonical[wf_index]],
                                        source=source_wf + [source_wf[0]])),
    ("no canonical WF", dict(matches=[m for m in canonical if m["round_type"] != "wildcard_final"])),
    ("no source WF", dict(source=[])),
    ("WF score mismatch", dict(matches=changed_match(wf_index, home_score=97))),
    ("WF date mismatch", dict(matches=changed_match(wf_index, date="2026-08-27"))),
    ("WF sides reversed", dict(matches=changed_match(wf_index,
        home=canonical[wf_index]["away"], away=canonical[wf_index]["home"]))),
    ("WF not final", dict(matches=changed_match(wf_index, is_final=False))),
    ("WF labelled Finals upstream", dict(source=[{**m, "source_round_type": "Finals"} for m in source_wf])),
    ("unrelated round misclassified regular", dict(matches=changed_match(0, round_type="qualifying_final"))),
    ("unexplained H&A score drift", dict(matches=changed_match(0, home_score=999))),
    ("WF winner contradicts scores", dict(matches=changed_match(wf_index, winner=canonical[wf_index]["away"]))),
    ("whole-season exemption cannot pass raw derived table", dict(derived=raw)),
]
for label, args in negative_cases:
    check(f"strict FAIL: {label}", bool(comparison(**args)[0]))
for label, table in (("raw witness", raw), ("derived policy", policy)):
    for field in ("season_points", "score_for", "score_against", "percentage_stored", "ladder_position"):
        modified = copy.deepcopy(table)
        modified[(2026, slug("Fremantle"))][field] += 1
        check(f"strict FAIL: unaffected club {label} {field}", bool(comparison(
            **{"witness" if label == "raw witness" else "derived": modified})[0]))
for team in ("Melbourne", "Footscray", "Carlton", "Collingwood"):
    for field in ("season_points", "score_for", "score_against", "percentage_stored", "ladder_position"):
        modified = copy.deepcopy(policy)
        modified[(2026, slug(team))][field] += 1
        check(f"strict FAIL: {team} policy {field}", bool(comparison(derived=modified)[0]))
missing_club = copy.deepcopy(policy)
del missing_club[next(iter(missing_club))]
extra_club = {**policy, (2026, "extra-club"): next(iter(policy.values()))}
check("missing derived club fails", bool(comparison(derived=missing_club)[0]))
check("extra derived club fails", bool(comparison(derived=extra_club)[0]))

ordinary = {(2025, k[1]): dict(v) for k, v in raw.items()}
check("ordinary season retains exact five-field comparison",
      not comparison(witness=ordinary, matches=[], source=[], derived=ordinary)[0])
ordinary_bad = copy.deepcopy(ordinary)
ordinary_bad[next(iter(ordinary_bad))]["percentage_stored"] += Decimal("0.0001")
check("ordinary season percentage mismatch fails without new tolerance",
      bool(comparison(witness=ordinary, matches=[], source=[], derived=ordinary_bad)[0]))

# Test the actual source-binding reader in a temporary local tree. These synthetic
# records are fixtures only: no candidate or accepted entry is written to the repo.
with tempfile.TemporaryDirectory(prefix="ladder-binding-") as scratch:
    scratch = Path(scratch)
    (scratch / "data/reference").mkdir(parents=True)
    csv_path, manifest_path = scratch / "results.csv", scratch / "manifest.json"
    csv_path.write_text('Season,Date,Round,Home.Team,Away.Team,Home.Points,Away.Points,Round.Type\n'
        '2026,2026-08-28,WF,Footscray,Collingwood,96,93,Regular\n', encoding="utf-8")
    manifest = {"files": [{"filename": "results.csv", "row_count": 1,
                           "sha256": lw.sha256_file(csv_path)}]}
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    baseline = dict(snapshot_label="test-only", acceptance_status="accepted", snapshot_dir=".",
        acquisition=dict(manifest_path="manifest.json", manifest_sha256=lw.sha256_file(manifest_path),
                         fitzroy_version_pinned=contract["pinned_version"]),
        raw_artefacts=dict(file_count=1, total_rows=1, artefact_set_sha256=fz.artefact_set_digest(manifest)),
        contract_binding=dict(contract_version=contract["contract_version"],
            contract_full_history_version=contract["full_history"]["contract_full_history_version"],
            required_range=contract["full_history"]["season_range"],
            required_datasets=contract["full_history"]["required_datasets"]))
    register_path = scratch / "data/reference/fitzroy-accepted-baselines.json"
    test_register = dict(contract="afldb.fitzroy.accepted_baselines",
        selection_policy=dict(rule="exactly_one_accepted"), baselines=[baseline])
    register_path.write_text(json.dumps(test_register), encoding="utf-8")
    with patch.object(lw, "ROOT", scratch):
        loaded = lw.load_source_wildcards()
        check("source loader resolves hash-bound WF with real club rules",
              len(loaded) == 1 and loaded[0]["home"] == slug("Footscray"))
        def refuses_source():
            try:
                lw.load_source_wildcards()
                return False
            except (lw.WitnessError, fz.SnapshotValidationError, OSError):
                return True
        csv_bytes, manifest_bytes = csv_path.read_bytes(), manifest_path.read_bytes()
        csv_path.write_bytes(csv_bytes + b'\n')
        check("source CSV byte drift refuses", refuses_source())
        csv_path.write_bytes(csv_bytes)
        manifest_path.write_bytes(manifest_bytes + b'\n')
        check("source manifest byte drift refuses", refuses_source())
        manifest_path.write_bytes(manifest_bytes)
        for entries in ([], [baseline, baseline], [{**baseline, "acceptance_status": "candidate"}]):
            test_register["baselines"] = entries
            register_path.write_text(json.dumps(test_register), encoding="utf-8")
            check("source selection refuses zero/multiple/candidate accepted entries", refuses_source())

# ---------------------------------------------------------------------------
# 8. The acquired witness, when its bytes are present
# ---------------------------------------------------------------------------
# Everything above runs on a bare checkout, because it works from the TRACKED label
# contract rather than from acquired bytes. This section closes the loop when the
# acquisition is present: it defers to validate_ladder_witness.py, which is the ONE
# authority for the artefact, and then proves the tracked label universe still matches
# what the source actually emitted. Without that second check ladder-source-labels.json
# could drift from reality and every assertion above would keep passing against a stale
# picture of the source.
print("\n8. acquired witness")
import subprocess  # noqa: E402

CONTRACT_DOC = json.loads(CONTRACT.read_text(encoding="utf-8"))
accepted = CONTRACT_DOC["datasets"][DATASET].get("accepted_witness")
check("the contract accepts a ladder witness snapshot", bool(accepted))

snapshot = (ROOT / "data" / "sources" / "afltables" / "fitzroy_core"
            / str(accepted["snapshot_label"])) if accepted else None

if snapshot is None or not snapshot.is_dir():
    print("  SKIP  acquired bytes are not present in this checkout "
          "(they are gitignored by design; the rebuild's preflight is what refuses)")
else:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "rebuild" / "fitzroy"
                             / "validate_ladder_witness.py"),
         "--label", str(accepted["snapshot_label"])],
        capture_output=True, text=True,
    )
    check("validate_ladder_witness.py passes offline", proc.returncode == 0,
          (proc.stdout or "").strip().splitlines()[-1] if proc.stdout else proc.stderr)

    # The tracked universe must equal the acquired one, exactly.
    emitted: set[tuple[str, int]] = set()
    for path in sorted(snapshot.glob("ladder_*.csv")):
        season = int(path.stem.removeprefix("ladder_"))
        import csv as _csv
        with path.open(newline="", encoding="utf-8") as fh:
            for row in _csv.DictReader(fh):
                emitted.add((row["Team"].strip(), season))
    tracked = set(all_pairs)
    check("the tracked label contract matches the acquired witness exactly",
          emitted == tracked,
          f"only-acquired={sorted(emitted - tracked)[:3]} "
          f"only-tracked={sorted(tracked - emitted)[:3]}")

print(f"\n{'FAILED: ' + ', '.join(failures) if failures else 'All checks passed.'}")
sys.exit(1 if failures else 0)
