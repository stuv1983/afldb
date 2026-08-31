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
# 7. The acquired witness, when its bytes are present
# ---------------------------------------------------------------------------
# Everything above runs on a bare checkout, because it works from the TRACKED label
# contract rather than from acquired bytes. This section closes the loop when the
# acquisition is present: it defers to validate_ladder_witness.py, which is the ONE
# authority for the artefact, and then proves the tracked label universe still matches
# what the source actually emitted. Without that second check ladder-source-labels.json
# could drift from reality and every assertion above would keep passing against a stale
# picture of the source.
print("\n7. acquired witness")
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
