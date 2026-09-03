#!/usr/bin/env python3
"""AFLDB-ISSUE-095 — offline validation of the fitzRoy ladder VALIDATION WITNESS.

    python tools/rebuild/fitzroy/validate_ladder_witness.py --label ladder-20260828
    python tools/rebuild/fitzroy/validate_ladder_witness.py --label ladder-20260828 --compare

The default mode makes **no database connection and no network request**. It proves, from
the tracked manifest plus the acquired raw bytes alone, that the witness is exactly what
the contract says it is, and that every source label resolves to exactly one time-bounded
AFLDB club identity.

`--compare` additionally runs the D7 cross-check against `club_seasons` using
AFLDB_IMPORT_DATABASE_URL. It is READ-ONLY: it issues one SELECT and writes nothing, ever.

WHY THIS EXISTS, AND WHAT IT IS NOT
-----------------------------------
`fetch_ladder_afltables` does not read a published ladder. The pinned fitzRoy 1.8.0
implementation calls `fetch_results_afltables`, keeps `Round.Type == "Regular"`, scores
win=1/draw=0.5/loss=0, sets points = win*4, and sorts by points then percentage. So the
witness is NOT an authority for any AFLDB column — AFLDB derives all of them from its own
canonical matches. Agreement is the acceptance check: it independently validates AFLDB's
home-and-away match set and its `is_final` classification, because a second toolchain
computing the same aggregation over the same upstream source must land on the same numbers.

THE WILDCARD ROUND EXCEPTION (AFLDB-ISSUE-129 §8.4 item 10)
----------------------------------------------------------
fitzRoy's `Round.Type` is computed as
`ifelse(Round %in% c("QF","EF","SF","PF","GF"), "Finals", "Regular")`, so from 2026 it
labels a Wildcard Final row **`Regular`** and folds its result into the ladder. AFLDB does
not: a wildcard final is `is_final = true` and earns no premiership points. For any season
containing one, the witness and `club_seasons` are therefore computing two DIFFERENT
quantities, and a field-by-field diff would be meaningless in both directions — it would
report AFLDB as wrong, or, if the check were loosened to tolerate it, would stop detecting
real ladder defects.

The witness is not weakened to make that disagreement disappear. Instead `--compare` asks
AFLDB (read-only) which seasons actually contain a `wildcard_final` match and declares
those seasons EXPLICITLY UNCOMPARABLE, naming them and the reason. Every other season is
compared exactly as strictly as before. A wildcard season is never silently passed.

This file is the ONE authority for the witness. The rebuild calls it, and
`tests/python/ladder_identity_contract.py` calls it too, so there is no second
implementation to drift.

The generic core validator (`import_fitzroy_core.py --require-full-history`) must NOT be
pointed at this snapshot: a ladder-only acquisition is deliberately not a full-history core
snapshot, and running it there manufactures a false failure.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools" / "migration"))

import import_fitzroy_core as fz  # noqa: E402

CONTRACT = ROOT / "tools" / "rebuild" / "fitzroy" / "fitzroy-contract.json"
CLUBS = ROOT / "data" / "reference" / "clubs.json"
MANIFEST_DIR = ROOT / "docs" / "rebuild-manifests" / "afltables_fitzroy_core"
SNAPSHOT_ROOT = ROOT / "data" / "sources" / "afltables" / "fitzroy_core"

DATASET = "ladder"
EXPECTED_COLUMNS = ["Season", "Team", "Round.Number", "Season.Points",
                    "Score.For", "Score.Against", "Percentage", "Ladder.Position"]


class WitnessError(Exception):
    """The witness is not what the contract says it is. Always terminal."""


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        if ok:
            print(f"  PASS  {name}")
        else:
            print(f"  FAIL  {name}{(' — ' + detail) if detail else ''}")
            self.failures.append(name)
        return ok


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def sha256_bytes(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pct_stored(score_for: int, score_against: int) -> Decimal | None:
    """AFLDB's stored percentage, reconstructed EXACTLY from the witness's integers.

    Deliberately not a comparison of two floating-point percentages. fitzRoy emits a
    ratio (score_for/score_against) as a float; AFLDB stores that ratio x100 rounded to
    4 places as numeric(9,4). Reconstructing from the two integer columns with exact
    decimal arithmetic removes float representation from the comparison entirely, and
    ROUND_HALF_UP matches PostgreSQL's round(numeric, n), which rounds half away from
    zero rather than to even.
    """
    if score_against == 0:
        return None
    return (Decimal(score_for) * 100 / Decimal(score_against)).quantize(
        Decimal("0.0001"), rounding=ROUND_HALF_UP)


def load_witness(label: str, rep: Report, contract_path: Path | None = None,
                 manifest_dir: Path | None = None) -> tuple[dict, list[dict]]:
    """Manifest + raw artefact validation. Returns (manifest, rows).

    AFLDB-ISSUE-101: ``contract_path`` and ``manifest_dir`` default to the tracked
    contract and the tracked manifest directory, so every existing caller is
    unchanged. They exist so the OFFLINE half of this validator can adjudicate a
    candidate witness against a TEMPORARY successor contract before any tracked file
    is written — the tracked contract still names the outgoing witness until then, so
    this validator would otherwise refuse a correct successor acquisition. The
    manifest is still derived as ``<manifest_dir>/<label>.json``, so a manifest whose
    filename is not the label can never be validated in its place.
    """
    manifest_path = (manifest_dir or MANIFEST_DIR) / f"{label}.json"
    if not manifest_path.exists():
        raise WitnessError(f"no tracked manifest at {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    contract = json.loads((contract_path or CONTRACT).read_text(encoding="utf-8"))
    ladder_ds = contract["datasets"].get(DATASET)
    if ladder_ds is None:
        raise WitnessError("the fitzRoy contract declares no 'ladder' dataset")
    cov = ladder_ds["coverage"]

    print("\n1. witness binding")
    rep.check("the contract classifies ladder as a validation witness",
              ladder_ds.get("role") == "VALIDATION_WITNESS")
    rep.check("ladder is NOT a required full-history core dataset",
              DATASET not in contract["full_history"]["required_datasets"])

    accepted = ladder_ds.get("accepted_witness")
    if accepted:
        rep.check("the manifest is the label the contract accepts",
                  accepted.get("snapshot_label") == label,
                  f"contract accepts {accepted.get('snapshot_label')!r}, given {label!r}")
        # Binds the tracked manifest byte-for-byte, so the artefact hash list inside it
        # cannot be edited to cover for tampered bytes without breaking this.
        rep.check("the tracked manifest matches its accepted sha256",
                  sha256_bytes(manifest_path) == accepted.get("manifest_sha256"),
                  f"computed {sha256_bytes(manifest_path)}")
    else:
        rep.check("the contract records an accepted witness binding", False,
                  "datasets.ladder.accepted_witness is absent")

    print("\n2. manifest shape")
    rep.check("manifest is an acquisition, not a probe", manifest.get("mode") == "acquire")
    rep.check("manifest requests the ladder dataset only",
              list(manifest.get("datasets_requested") or []) == [DATASET],
              str(manifest.get("datasets_requested")))
    files = [f for f in manifest.get("files", []) if f.get("dataset") == DATASET]
    rep.check(f"manifest lists exactly {cov['seasons_returned']} ladder files",
              len(files) == cov["seasons_returned"], f"got {len(files)}")
    rep.check(f"manifest row counts total {cov['club_season_rows']}",
              sum(f["row_count"] for f in files) == cov["club_season_rows"],
              f"got {sum(f['row_count'] for f in files)}")

    snapshot_dir = SNAPSHOT_ROOT / label
    if not snapshot_dir.is_dir():
        # The fail-closed case the durability contract exists for: the manifest is
        # tracked, the bytes are not, and the rebuild must refuse rather than proceed.
        raise WitnessError(
            f"the tracked manifest for {label!r} exists but its acquired bytes are absent "
            f"from {snapshot_dir}. Raw snapshots are deliberately gitignored (ISSUE-093 "
            f"convention): re-acquire with\n"
            f"  Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --label {label} "
            f"--datasets ladder --from {cov['first_season']} --to {cov['last_season']}")

    print("\n3. raw artefacts (bytes, schema, per-season structure)")
    seasons_seen: list[int] = []
    rows: list[dict] = []
    bad_hash, bad_count, bad_schema, empty = [], [], [], []
    season_mismatch, blank_team, dup_team, bad_pos, bad_pct = [], [], [], [], []

    for entry in sorted(files, key=lambda f: f["filename"]):
        path = snapshot_dir / entry["filename"]
        if not path.exists():
            bad_hash.append(f"{entry['filename']}: missing")
            continue
        if sha256_file(path) != entry["sha256"]:
            bad_hash.append(f"{entry['filename']}: sha256 differs from the manifest")
            continue

        stem = entry["filename"].removeprefix("ladder_").removesuffix(".csv")
        season = int(stem)
        seasons_seen.append(season)

        with path.open(newline="", encoding="utf-8") as fh:
            data = list(csv.DictReader(fh))
        if not data:
            empty.append(str(season))
            continue
        if list(data[0].keys()) != EXPECTED_COLUMNS:
            bad_schema.append(f"{season}: {list(data[0].keys())}")
            continue
        if len(data) != entry["row_count"]:
            bad_count.append(f"{season}: file {len(data)} vs manifest {entry['row_count']}")

        teams, positions = [], []
        for r in data:
            if int(r["Season"]) != season:
                season_mismatch.append(f"{season}: row says {r['Season']}")
            team = (r["Team"] or "").strip()
            if not team:
                blank_team.append(str(season))
            teams.append(team)
            positions.append(int(r["Ladder.Position"]))
            sf, sa = int(r["Score.For"]), int(r["Score.Against"])
            # The witness's own float must agree with its own integers, or the artefact
            # is internally inconsistent regardless of what AFLDB derives.
            if sa and abs(float(r["Percentage"]) - sf / sa) > 1e-9:
                bad_pct.append(f"{season} {team}")
            rows.append({
                "season": season, "team": team,
                "season_points": int(float(r["Season.Points"])),
                "score_for": sf, "score_against": sa,
                "ladder_position": int(r["Ladder.Position"]),
                "percentage_stored": pct_stored(sf, sa),
            })
        if len(set(teams)) != len(teams):
            dup_team.append(str(season))
        if sorted(positions) != list(range(1, len(data) + 1)):
            bad_pos.append(str(season))

    rep.check("every manifest sha256 matches the file on disk", not bad_hash,
              "; ".join(bad_hash[:3]))
    rep.check("every file row count matches the manifest", not bad_count,
              "; ".join(bad_count[:3]))
    rep.check("every file carries the exact eight-column contract", not bad_schema,
              "; ".join(bad_schema[:3]))
    rep.check("no zero-row season", not empty, "; ".join(empty[:5]))
    rep.check("every row's Season matches its file's season", not season_mismatch,
              "; ".join(season_mismatch[:3]))
    rep.check("Team is non-empty everywhere", not blank_team, "; ".join(blank_team[:5]))
    rep.check("Team is unique within every season", not dup_team, "; ".join(dup_team[:5]))
    rep.check("Ladder.Position is complete and unique within every season", not bad_pos,
              "; ".join(bad_pos[:5]))
    rep.check("the witness's Percentage agrees with its own Score.For/Score.Against",
              not bad_pct, "; ".join(bad_pct[:3]))

    expected_seasons = list(range(cov["first_season"], cov["last_season"] + 1))
    rep.check(f"covers exactly {cov['first_season']}-{cov['last_season']}",
              sorted(seasons_seen) == expected_seasons,
              f"got {len(seasons_seen)} seasons")
    rep.check("no duplicate season file", len(seasons_seen) == len(set(seasons_seen)))
    rep.check(f"total rows = {cov['club_season_rows']}",
              len(rows) == cov["club_season_rows"], f"got {len(rows)}")
    rep.check("no season later than the accepted last season is present",
              not [s for s in seasons_seen if s > cov["last_season"]],
              str(sorted({s for s in seasons_seen if s > cov['last_season']})))
    rep.check("no duplicate (label, season) pair",
              len({(r["team"], r["season"]) for r in rows}) == len(rows))

    return manifest, rows


def resolve_all(rows: list[dict], rep: Report,
                contract_path: Path | None = None) -> dict[tuple[int, str], dict]:
    """Resolve every source label through the REAL ClubResolver. One authority."""
    print("\n4. historical identity resolution")
    contract = json.loads((contract_path or CONTRACT).read_text(encoding="utf-8"))
    clubs = json.loads(CLUBS.read_text(encoding="utf-8"))
    slug_of = {c["hist"]: c["slug"] for c in clubs["identities"]}
    resolver = fz.ClubResolver(clubs, contract["source_club_normalisation"]["rules"])

    unresolved, era_bad = [], []
    by_identity: dict[tuple[int, str], dict] = {}
    collisions = []
    for r in rows:
        try:
            hist = resolver.resolve(r["team"], r["season"], DATASET)
        except Exception as exc:                                   # noqa: BLE001
            unresolved.append(f"{r['team']} {r['season']}: {exc}")
            continue
        if not resolver._era_contains(hist, r["season"]):           # noqa: SLF001
            era_bad.append(f"{r['team']} {r['season']} -> {hist}")
        key = (r["season"], slug_of[hist])
        if key in by_identity:
            collisions.append(f"{r['season']}: {by_identity[key]['team']!r} and "
                              f"{r['team']!r} both -> {hist}")
        by_identity[key] = {**r, "hist": hist, "slug": slug_of[hist]}

    rep.check(f"all {len(rows)} label-season pairs resolve", not unresolved,
              f"{len(unresolved)} failed; first: {unresolved[0] if unresolved else ''}")
    rep.check("every resolution lands inside that identity's own era", not era_bad,
              f"{len(era_bad)}; first: {era_bad[0] if era_bad else ''}")
    rep.check("no season maps two labels onto one club identity", not collisions,
              f"{len(collisions)}; first: {collisions[0] if collisions else ''}")
    rep.check("resolved (club identity, season) pairs are unique",
              len(by_identity) == len(rows) - len(unresolved))
    return by_identity


def compare_to_database(resolved: dict[tuple[int, str], dict], rep: Report) -> None:
    """D7 cross-check. READ-ONLY: one SELECT, no write of any kind."""
    print("\n5. D7 cross-check against club_seasons (read-only)")
    import psycopg                                                  # noqa: PLC0415

    dsn = os.environ.get("AFLDB_IMPORT_DATABASE_URL")
    if not dsn:
        raise WitnessError("--compare needs AFLDB_IMPORT_DATABASE_URL")

    with psycopg.connect(dsn) as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            cur.execute("""
                SELECT cs.season, c.slug, cs.points_for, cs.points_against,
                       cs.premiership_points, cs.ladder_rank, cs.percentage
                  FROM club_seasons cs JOIN clubs c ON c.id = cs.club_id
            """)
            db = {(int(r[0]), r[1]): r for r in cur.fetchall()}
            # See "THE WILDCARD ROUND EXCEPTION" above. Read from AFLDB rather than
            # hard-coded, so a season is excluded only while it genuinely contains one.
            cur.execute("""
                SELECT DISTINCT season FROM matches
                 WHERE round_type = 'wildcard_final'
                 ORDER BY season
            """)
            wildcard_seasons = {int(r[0]) for r in cur.fetchall()}

    if wildcard_seasons:
        print(f"        wildcard-round seasons excluded from the field comparison: "
              f"{sorted(wildcard_seasons)} — fitzRoy labels a WF row Round.Type='Regular' "
              f"and counts it on the ladder; AFLDB does not (AFLDB-ISSUE-129 §8.4).")

    missing = sorted(set(resolved) - set(db))
    extra = sorted(set(db) - set(resolved))
    rep.check("every witness club-season exists in club_seasons", not missing,
              f"{len(missing)} missing; first: {missing[:3]}")
    rep.check("club_seasons has no club-season the witness does not", not extra,
              f"{len(extra)} extra; first: {extra[:3]}")

    # season | team | field | AFLDB | witness — the witness is not authority, so the
    # diagnostic names both sides rather than calling one of them correct.
    diffs: list[str] = []
    comparable = 0
    for key in sorted(set(resolved) & set(db)):
        w, row = resolved[key], db[key]
        season, slug = key
        if season in wildcard_seasons:
            continue
        comparable += 1
        for field, actual, expected in (
            ("points_for", row[2], w["score_for"]),
            ("points_against", row[3], w["score_against"]),
            ("premiership_points", row[4], w["season_points"]),
            ("ladder_rank", row[5], w["ladder_position"]),
            ("percentage", row[6], w["percentage_stored"]),
        ):
            if field == "percentage":
                same = (actual is None and expected is None) or (
                    actual is not None and expected is not None
                    and Decimal(actual) == expected)
            else:
                same = actual == expected
            if not same:
                diffs.append(f"{season} {w['team']} ({slug}) {field}: "
                             f"AFLDB={actual!r} witness={expected!r}")

    rep.check(f"all {comparable} comparable club-seasons agree on every compared field",
              not diffs, f"{len(diffs)} disagreements")
    for d in diffs[:20]:
        print(f"        {d}")
    if len(diffs) > 20:
        print(f"        ... and {len(diffs) - 20} more")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--label", required=True)
    ap.add_argument("--compare", action="store_true",
                    help="also run the D7 cross-check against club_seasons (read-only)")
    ap.add_argument("--contract",
                    help="override the fitzRoy contract path. OFFLINE ONLY (never with "
                         "--compare). AFLDB-ISSUE-101 points it at a TEMPORARY successor "
                         "contract so a candidate witness is proven before any tracked "
                         "file is written. Default: the tracked contract")
    ap.add_argument("--manifest-dir",
                    help="override the directory the '<label>.json' manifest is read from. "
                         "OFFLINE ONLY (never with --compare). Default: "
                         "docs/rebuild-manifests/afltables_fitzroy_core")
    args = ap.parse_args()

    # The D7 cross-check reads the rebuilt database. Its whole meaning is that the
    # TRACKED, accepted witness agrees with canonical club_seasons, so it must never be
    # run against a temporary successor state.
    for flag, value in (("--contract", args.contract),
                        ("--manifest-dir", args.manifest_dir)):
        if value and args.compare:
            ap.error(f"{flag} cannot be combined with --compare: the database cross-check "
                     "adjudicates the tracked accepted witness, never a temporary state.")
        if value and not Path(value).exists():
            ap.error(f"{flag} does not exist: {value}")

    contract_path = Path(args.contract) if args.contract else CONTRACT
    manifest_dir = Path(args.manifest_dir) if args.manifest_dir else MANIFEST_DIR

    rep = Report()
    print(f"AFLDB-ISSUE-095 ladder witness validation - {args.label}")
    if args.contract or args.manifest_dir:
        print(f"  contract     {contract_path}")
        print(f"  manifest dir {manifest_dir}")
    try:
        _, rows = load_witness(args.label, rep, contract_path, manifest_dir)
        resolved = resolve_all(rows, rep, contract_path)
        if args.compare:
            compare_to_database(resolved, rep)
    except WitnessError as exc:
        print(f"\nREFUSED: {exc}")
        return 2

    if rep.failures:
        print(f"\nFAILED: {len(rep.failures)} check(s): {', '.join(rep.failures)}")
        return 1
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
