#!/usr/bin/env python3
"""Build the AFLDB-ISSUE-224 S9 player-registration target set.

OFFLINE ONLY. No database, no network, no ``.env``. Every input is a file on
disk, and every input whose hash is known in advance is verified before it is
read.

What this tool establishes
--------------------------
ISSUE-228's S9 unblock needs a *named* set of AFL API providers that may be
registered as canonical players. Two populations were measured independently:

* **Population A** — ISSUE-224's classification artefact: 92 rows classified
  ``genuine_post_baseline_afl_debutant`` (Category A), each carrying an AFL
  Tables profile path, plus 2 Category B rows that are already-registered
  people needing a parent-evidence correction instead.
* **Population B** — the accepted AFL API player bridge's 92 ``unresolved``
  providers.

"92 == 92" is a count, not identity evidence. This tool discharges that gap by
re-running the bridge's *own* accepted evidence class source-to-source, with
the AFL Tables 2026 snapshot standing in for the canonical database:

    key = (club, jumper number, exact 13-column core stat vector)

``name_based_candidate_discovery`` is **false**: names never discover, propose
or break a tie. They are retained on each row as human-readable metadata and
compared only as an after-the-fact validation signal.

Determinism
-----------
Output bytes are a pure function of the inputs plus ``--generated-at``, whose
default is frozen to the pass that produced this artefact. Ordering is by AFL
API provider id; JSON is emitted with sorted keys, a fixed indent, ASCII
escaping and LF newlines. Re-running with the same inputs reproduces the file
byte for byte. If the output path already exists with different bytes the tool
refuses rather than overwriting.

Snapshot neutrality
-------------------
The AFL API snapshot directory is a required argument and the tool records
whatever label that snapshot's own manifest declares. It does **not** assert
that any particular snapshot is the S9 acceptance snapshot. Re-run it against
the ``-011148`` bytes unchanged if they are recovered.

Usage
-----
    python tools/rebuild/draftguru/build_issue224_s9_target_set.py \
      --afl-api-snapshot-dir <dir holding manifest.json + CD_M*/> \
      --player-stats-dir <dir holding player_stats_2026.csv>
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from pathlib import Path

TOOL_PATH = "tools/rebuild/draftguru/build_issue224_s9_target_set.py"
TOOL_VERSION = "1.0.0"

# Frozen so re-runs are byte-identical. Overridable with --generated-at.
GENERATED_AT_DEFAULT = "2026-09-22T00:00:00Z"

# ---------------------------------------------------------------------------
# Byte-bound inputs. These files are historical evidence: if their bytes have
# moved, the conclusion this tool draws is no longer the one that was reviewed,
# so the tool refuses instead of silently rebuilding against new evidence.
# ---------------------------------------------------------------------------
BYTE_BOUND = {
    "classification": {
        "rel": "docs/rebuild-manifests/draftguru/issue224-population-classification-20260919.json",
        "bytes": 52845,
        "sha256": "0765392a26624c54a2d2525c8fafd14f9521989b533fb773d3134a934ac74a6a",
    },
    "phase3_verdicts": {
        "rel": "docs/rebuild-manifests/draftguru/bridge-operator-verdicts-issue224-20260919-v1.json",
        "bytes": 79486,
        "sha256": "3c7b5aff6649047ef0a727feffe4303ac7ea618a6cba3ca4f32b718636875038",
    },
}

DEFAULT_BRIDGE_REL = "data/reference/afl-api-player-bridge-2026-full-2026-09-21.json"
DEFAULT_IDENTITIES_REL = "data/reference/afl-api-identities.json"
DEFAULT_AFLTABLES_MANIFEST_REL = (
    "docs/rebuild-manifests/afltables_fitzroy_core/issue224-inseason-20260919.json"
)
DEFAULT_OUT_REL = "docs/rebuild-manifests/draftguru/issue224-s9-target-set-20260922.json"

# The bridge's own CORE_STAT_COLUMNS
# (src/lib/acquisition/afl-api-player-evidence.ts:107-111), paired with the AFL
# API snapshot field it is read from (src/lib/acquisition/afl-api-bundle.ts:517-534)
# and the AFL Tables player_stats_2026.csv column it is compared against.
CORE_VECTOR = [
    ("kicks", ("stats", "kicks"), "Kicks"),
    ("handballs", ("stats", "handballs"), "Handballs"),
    ("marks", ("stats", "marks"), "Marks"),
    ("tackles", ("stats", "tackles"), "Tackles"),
    ("goals", ("stats", "goals"), "Goals"),
    ("behinds", ("stats", "behinds"), "Behinds"),
    ("hitouts", ("stats", "hitouts"), "Hit.Outs"),
    ("frees_for", ("stats", "freesFor"), "Frees.For"),
    ("frees_against", ("stats", "freesAgainst"), "Frees.Against"),
    ("inside_50s", ("stats", "inside50s"), "Inside.50s"),
    ("clearances", ("stats", "clearances", "totalClearances"), "Clearances"),
    ("rebounds", ("stats", "rebound50s"), "Rebounds"),
    ("goal_assists", ("stats", "goalAssists"), "Goal.Assists"),
]

AFLTABLES_URL_PREFIX = "https://afltables.com/afl/stats/"

EXPECTED_CATEGORY_A = 92
EXPECTED_UNRESOLVED_PROVIDERS = 92

CATEGORY_A_CLASSIFICATION = "genuine_post_baseline_afl_debutant"

EVIDENCE_GRADE = "STRONG_IDENTITY_EVIDENCE"
DISPOSITION = "REGISTER"


class Refusal(Exception):
    """A fail-closed condition. Nothing is written."""


def refuse(message: str) -> "Refusal":
    return Refusal(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> object:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def canonical_bytes(value: object) -> bytes:
    """The deterministic representation every rows_sha256 is taken over."""
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("utf-8")


def verify_byte_bound(repo_root: Path) -> dict[str, dict[str, object]]:
    verified: dict[str, dict[str, object]] = {}
    for name, spec in sorted(BYTE_BOUND.items()):
        path = repo_root / spec["rel"]
        if not path.is_file():
            raise refuse(f"byte-bound input missing: {spec['rel']}")
        size = path.stat().st_size
        if size != spec["bytes"]:
            raise refuse(
                f"byte-bound input changed size: {spec['rel']} "
                f"expected {spec['bytes']} bytes, found {size}"
            )
        digest = sha256_file(path)
        if digest != spec["sha256"]:
            raise refuse(
                f"byte-bound input changed content: {spec['rel']} "
                f"expected sha256 {spec['sha256']}, found {digest}"
            )
        verified[name] = {"path": spec["rel"], "bytes": size, "sha256": digest}
    return verified


def nested(container: object, path: tuple[str, ...], where: str) -> object:
    cursor = container
    for key in path:
        if cursor is None:
            return None
        if not isinstance(cursor, dict):
            raise refuse(f"{where}: expected an object at {'.'.join(path)}")
        cursor = cursor.get(key)
    return cursor


def as_int(value: object, where: str) -> int | None:
    """Every core stat is an integral count in both schemas.

    The AFL API serialises them as JSON floats and AFL Tables as decimal
    strings; a non-integral value in either would mean the column is not the
    count this comparison assumes, so it is refused rather than rounded.
    """
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise refuse(f"{where}: boolean is not a statistic")
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if value != int(value):
            raise refuse(f"{where}: non-integral statistic {value!r}")
        return int(value)
    if isinstance(value, str):
        text = value.strip()
        if text in {"", "NA", "NaN"}:
            return None
        try:
            number = float(text)
        except ValueError as error:
            raise refuse(f"{where}: unparseable statistic {value!r}") from error
        if number != int(number):
            raise refuse(f"{where}: non-integral statistic {value!r}")
        return int(number)
    raise refuse(f"{where}: unsupported statistic type {type(value).__name__}")


# ---------------------------------------------------------------------------
# AFL Tables side
# ---------------------------------------------------------------------------


def profile_path_from_url(url: str, where: str) -> str:
    if not url.startswith(AFLTABLES_URL_PREFIX):
        raise refuse(f"{where}: unexpected AFL Tables url {url!r}")
    return url[len(AFLTABLES_URL_PREFIX) :]


def read_afltables(csv_path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = [
            column
            for _, _, column in CORE_VECTOR
            if column not in (reader.fieldnames or [])
        ]
        if missing:
            raise refuse(
                "player_stats_2026.csv is missing core columns: " + ", ".join(missing)
            )
        for index, raw in enumerate(reader):
            where = f"player_stats_2026.csv row {index + 2}"
            vector = tuple(
                as_int(raw[column], f"{where}.{column}") for _, _, column in CORE_VECTOR
            )
            rows.append(
                {
                    "profile_path": profile_path_from_url(raw["url"], where),
                    "club": raw["Playing.for"],
                    "jumper": as_int(raw["Jumper.No."], f"{where}.Jumper.No."),
                    "vector": vector,
                    "career_games": as_int(
                        raw["Career.Games"], f"{where}.Career.Games"
                    ),
                    "round": raw["Round"],
                    "date": raw["Date"],
                    "player": raw["Player"],
                    "surname": raw["Surname"],
                }
            )
    return rows


# ---------------------------------------------------------------------------
# AFL API side
# ---------------------------------------------------------------------------


def read_afl_api_rows(
    snapshot_dir: Path, team_hist: dict[str, str], wanted: set[str]
) -> tuple[dict[str, object], list[dict[str, object]]]:
    """Read every snapshot row belonging to a wanted provider.

    Each ``player-stats.json`` is hash-verified against the snapshot's own
    manifest before it is parsed, so a snapshot that has drifted from its
    manifest cannot contribute evidence.
    """
    manifest_path = snapshot_dir / "manifest.json"
    if not manifest_path.is_file():
        raise refuse(f"AFL API snapshot has no manifest.json: {snapshot_dir}")
    manifest = load_json(manifest_path)
    if not isinstance(manifest, dict):
        raise refuse("AFL API snapshot manifest.json is not an object")

    expected_hashes = {
        entry["file"]: entry["sha256"]
        for entry in manifest.get("files", [])
        if isinstance(entry, dict) and "file" in entry and "sha256" in entry
    }

    match_dirs = sorted(
        child.name for child in snapshot_dir.iterdir() if child.is_dir()
    )
    if not match_dirs:
        raise refuse(f"AFL API snapshot holds no match directories: {snapshot_dir}")

    rows: list[dict[str, object]] = []
    unknown_teams: set[str] = set()
    for match_id in match_dirs:
        rel = f"{match_id}/player-stats.json"
        stats_path = snapshot_dir / match_id / "player-stats.json"
        if not stats_path.is_file():
            # A fixture-only directory carries no player evidence; the manifest
            # is the authority on what the snapshot claims to contain.
            if rel in expected_hashes:
                raise refuse(f"AFL API snapshot is missing a manifested file: {rel}")
            continue
        digest = sha256_file(stats_path)
        expected = expected_hashes.get(rel)
        if expected is None:
            raise refuse(f"AFL API snapshot file is absent from its manifest: {rel}")
        if digest != expected:
            raise refuse(
                f"AFL API snapshot file does not match its manifest: {rel} "
                f"expected {expected}, found {digest}"
            )
        payload = load_json(stats_path)
        if not isinstance(payload, dict):
            raise refuse(f"{rel}: not an object")
        for side in ("homeTeamPlayerStats", "awayTeamPlayerStats"):
            entries = payload.get(side)
            if entries is None:
                continue
            if not isinstance(entries, list):
                raise refuse(f"{rel}.{side}: expected an array")
            for index, entry in enumerate(entries):
                where = f"{rel}.{side}[{index}]"
                if not isinstance(entry, dict):
                    raise refuse(f"{where}: expected an object")
                block = entry.get("playerStats")
                if not isinstance(block, dict):
                    raise refuse(f"{where}.playerStats: expected an object")
                player = block.get("player")
                if not isinstance(player, dict):
                    raise refuse(f"{where}.playerStats.player: expected an object")
                provider_id = player.get("playerId")
                if not isinstance(provider_id, str) or not provider_id:
                    raise refuse(f"{where}.playerStats.player.playerId: expected a string")
                if provider_id not in wanted:
                    continue
                team_id = entry.get("teamId")
                if not isinstance(team_id, str) or not team_id:
                    raise refuse(f"{where}.teamId: expected a string")
                club = team_hist.get(team_id)
                if club is None:
                    unknown_teams.add(team_id)
                    continue
                name = player.get("playerName")
                display = None
                if isinstance(name, dict):
                    given = name.get("givenName")
                    surname = name.get("surname")
                    display = " ".join(
                        part for part in (given, surname) if isinstance(part, str) and part
                    ) or None
                rows.append(
                    {
                        "provider_id": provider_id,
                        "provider_match_id": match_id,
                        "club": club,
                        "provider_team_id": team_id,
                        "jumper": as_int(
                            player.get("playerJumperNumber"),
                            f"{where}.playerStats.player.playerJumperNumber",
                        ),
                        "vector": tuple(
                            as_int(nested(block, field, where), f"{where}.{'.'.join(field)}")
                            for _, field, _ in CORE_VECTOR
                        ),
                        "observed_name": display,
                    }
                )
    if unknown_teams:
        raise refuse(
            "AFL API snapshot carries team ids absent from afl-api-identities.json: "
            + ", ".join(sorted(unknown_teams))
        )
    rows.sort(key=lambda row: (row["provider_id"], row["provider_match_id"]))
    return manifest, rows


# ---------------------------------------------------------------------------
# Reconciliation
# ---------------------------------------------------------------------------


def hamming(left: tuple[int | None, ...], right: tuple[int | None, ...]) -> int:
    return sum(1 for a, b in zip(left, right) if a != b)


def differing_columns(
    left: tuple[int | None, ...], right: tuple[int | None, ...]
) -> list[dict[str, object]]:
    out: list[dict[str, object]] = []
    for (name, _, column), api_value, at_value in zip(CORE_VECTOR, left, right):
        if api_value != at_value:
            out.append(
                {
                    "core_column": name,
                    "afltables_column": column,
                    "afl_api_value": api_value,
                    "afltables_value": at_value,
                }
            )
    return out


def build(args: argparse.Namespace) -> tuple[Path, dict[str, object]]:
    repo_root = args.repo_root.resolve()

    byte_bound = verify_byte_bound(repo_root)

    classification = load_json(repo_root / BYTE_BOUND["classification"]["rel"])
    if not isinstance(classification, dict):
        raise refuse("classification artefact is not an object")
    category_a: dict[str, dict[str, object]] = {}
    for row in classification.get("rows", []):
        if row.get("classification") != CATEGORY_A_CLASSIFICATION:
            continue
        path = row.get("afltables_external_id")
        if not isinstance(path, str) or not path:
            raise refuse("a Category A classification row carries no AFL Tables path")
        if path in category_a:
            raise refuse(f"Category A names the same AFL Tables path twice: {path}")
        category_a[path] = row
    if len(category_a) != EXPECTED_CATEGORY_A:
        raise refuse(
            f"Population A coverage: expected {EXPECTED_CATEGORY_A} Category A paths, "
            f"found {len(category_a)}"
        )

    # --- Population B: the accepted bridge's unresolved providers -----------
    bridge_path = repo_root / args.bridge
    bridge = load_json(bridge_path)
    if not isinstance(bridge, dict):
        raise refuse("AFL API player bridge artefact is not an object")
    providers = bridge.get("providers")
    if not isinstance(providers, dict):
        raise refuse("AFL API player bridge artefact carries no providers object")
    unresolved = {
        provider_id: entry
        for provider_id, entry in providers.items()
        if isinstance(entry, dict) and entry.get("disposition") != "linked"
    }
    if len(unresolved) != EXPECTED_UNRESOLVED_PROVIDERS:
        raise refuse(
            f"Population B coverage: expected {EXPECTED_UNRESOLVED_PROVIDERS} unresolved "
            f"providers, found {len(unresolved)}"
        )
    if len(set(unresolved)) != len(unresolved):
        raise refuse("duplicate AFL API provider in the bridge artefact")

    identities = load_json(repo_root / args.identities)
    if not isinstance(identities, dict):
        raise refuse("afl-api-identities.json is not an object")
    teams = identities.get("teams")
    if not isinstance(teams, dict):
        raise refuse("afl-api-identities.json carries no teams object")
    team_hist = {
        team_id: entry["hist"]
        for team_id, entry in teams.items()
        if isinstance(entry, dict) and isinstance(entry.get("hist"), str)
    }

    # --- AFL Tables snapshot, hash-verified against its tracked manifest ----
    at_manifest_rel = args.afltables_manifest
    at_manifest = load_json(repo_root / at_manifest_rel)
    if not isinstance(at_manifest, dict):
        raise refuse("AFL Tables manifest is not an object")
    player_stats_entry = next(
        (
            entry
            for entry in at_manifest.get("files", [])
            if isinstance(entry, dict) and entry.get("dataset") == "player_stats"
        ),
        None,
    )
    if player_stats_entry is None:
        raise refuse("AFL Tables manifest declares no player_stats dataset")
    csv_path = args.player_stats_dir / player_stats_entry["filename"]
    if not csv_path.is_file():
        raise refuse(f"AFL Tables player stats file not found: {csv_path}")
    csv_sha256 = sha256_file(csv_path)
    if csv_sha256 != player_stats_entry["sha256"]:
        raise refuse(
            f"{player_stats_entry['filename']} does not match its tracked manifest: "
            f"expected {player_stats_entry['sha256']}, found {csv_sha256}"
        )
    at_rows = read_afltables(csv_path)
    if len(at_rows) != player_stats_entry["row_count"]:
        raise refuse(
            f"{player_stats_entry['filename']} row count {len(at_rows)} does not match "
            f"the manifest's {player_stats_entry['row_count']}"
        )

    # --- Key soundness, measured over every AFL Tables row ------------------
    key_to_paths: dict[tuple[str, int | None, tuple[int | None, ...]], set[str]] = {}
    for row in at_rows:
        key = (row["club"], row["jumper"], row["vector"])
        key_to_paths.setdefault(key, set()).add(row["profile_path"])
    ambiguous_keys = sorted(
        {
            f"{club}|{jumper}"
            for (club, jumper, _), paths in key_to_paths.items()
            if len(paths) > 1
        }
    )
    ambiguous_key_rows = sum(
        1
        for row in at_rows
        if len(key_to_paths[(row["club"], row["jumper"], row["vector"])]) > 1
    )
    if ambiguous_key_rows:
        raise refuse(
            f"the (club, jumper, core-vector) key is not unique: {ambiguous_key_rows} of "
            f"{len(at_rows)} AFL Tables rows resolve to more than one profile "
            f"({', '.join(ambiguous_keys[:10])})"
        )

    by_path: dict[str, list[dict[str, object]]] = {}
    for row in at_rows:
        by_path.setdefault(row["profile_path"], []).append(row)
    by_club_jumper: dict[tuple[str, int | None], list[dict[str, object]]] = {}
    for row in at_rows:
        by_club_jumper.setdefault((row["club"], row["jumper"]), []).append(row)

    # --- AFL API snapshot ---------------------------------------------------
    api_manifest, api_rows = read_afl_api_rows(
        args.afl_api_snapshot_dir.resolve(), team_hist, set(unresolved)
    )
    api_by_provider: dict[str, list[dict[str, object]]] = {}
    for row in api_rows:
        api_by_provider.setdefault(row["provider_id"], []).append(row)

    # --- Per-provider resolution -------------------------------------------
    target_rows: list[dict[str, object]] = []
    claimed_paths: dict[str, str] = {}
    unanimous = 0
    single_candidate_non_unanimous = 0

    for provider_id in sorted(unresolved):
        bridge_entry = unresolved[provider_id]
        rows_for_provider = api_by_provider.get(provider_id, [])
        if not rows_for_provider:
            raise refuse(
                f"{provider_id}: the AFL API snapshot carries no rows for this provider"
            )

        candidates: dict[str, int] = {}
        hits: list[str | None] = []
        for row in rows_for_provider:
            paths = key_to_paths.get((row["club"], row["jumper"], row["vector"]))
            if not paths:
                hits.append(None)
                continue
            # Ambiguity was refused above, so this set holds exactly one path.
            (path,) = tuple(paths)
            hits.append(path)
            candidates[path] = candidates.get(path, 0) + 1

        if not candidates:
            raise refuse(f"{provider_id}: zero candidate AFL Tables profiles")
        if len(candidates) > 1:
            raise refuse(
                f"{provider_id}: {len(candidates)} competing candidate AFL Tables "
                f"profiles ({', '.join(sorted(candidates))})"
            )
        (target_path,) = tuple(candidates)
        if target_path not in category_a:
            raise refuse(
                f"{provider_id}: resolved AFL Tables profile {target_path} lies outside "
                "ISSUE-224 Category A"
            )
        if target_path in claimed_paths:
            raise refuse(
                f"duplicate AFL Tables target {target_path}: claimed by both "
                f"{claimed_paths[target_path]} and {provider_id}"
            )
        claimed_paths[target_path] = provider_id

        agreeing = candidates[target_path]
        non_agreeing = len(rows_for_provider) - agreeing

        # Diagnose each non-agreeing row without reference to a name: either the
        # target profile has an AFL Tables row no API row accounts for (a real
        # vector disagreement on the same fixture), or it does not (the AFL
        # Tables extraction simply has no row for that game).
        target_rows_at = by_path[target_path]
        matched_at_vectors: dict[tuple[str, int | None, tuple[int | None, ...]], int] = {}
        for row, hit in zip(rows_for_provider, hits):
            if hit == target_path:
                key = (row["club"], row["jumper"], row["vector"])
                matched_at_vectors[key] = matched_at_vectors.get(key, 0) + 1
        unaccounted: list[dict[str, object]] = []
        for row in target_rows_at:
            key = (row["club"], row["jumper"], row["vector"])
            if matched_at_vectors.get(key):
                matched_at_vectors[key] -= 1
            else:
                unaccounted.append(row)

        disagreements: list[dict[str, object]] = []
        remaining = list(unaccounted)
        for row, hit in zip(rows_for_provider, hits):
            if hit == target_path:
                continue
            same_slot = [
                other
                for other in remaining
                if other["club"] == row["club"] and other["jumper"] == row["jumper"]
            ]
            if same_slot:
                nearest = min(
                    same_slot,
                    key=lambda other: (
                        hamming(row["vector"], other["vector"]),
                        other["date"],
                        other["round"],
                    ),
                )
                remaining.remove(nearest)
                disagreements.append(
                    {
                        "provider_match_id": row["provider_match_id"],
                        "nature": "core_vector_disagreement_same_fixture",
                        "afltables_round": nearest["round"],
                        "afltables_date": nearest["date"],
                        "core_columns_identical": len(CORE_VECTOR)
                        - hamming(row["vector"], nearest["vector"]),
                        "core_columns_total": len(CORE_VECTOR),
                        "differing_columns": differing_columns(
                            row["vector"], nearest["vector"]
                        ),
                    }
                )
            else:
                disagreements.append(
                    {
                        "provider_match_id": row["provider_match_id"],
                        "nature": "no_afltables_row_for_this_fixture",
                        "note": (
                            "absence, not contradiction: the AFL Tables extraction "
                            "carries no row for this game at the target profile"
                        ),
                    }
                )

        if non_agreeing == 0:
            unanimous += 1
            agreement = "unanimous"
        else:
            single_candidate_non_unanimous += 1
            agreement = "single_candidate_non_unanimous"

        career_games = [
            row["career_games"]
            for row in target_rows_at
            if row["career_games"] is not None
        ]
        if not career_games:
            raise refuse(f"{target_path}: no Career.Games evidence in the 2026 snapshot")
        min_career_games = min(career_games)

        observed_names = sorted(
            {row["observed_name"] for row in rows_for_provider if row["observed_name"]}
        )
        afltables_names = sorted({row["player"] for row in target_rows_at})
        api_surnames = {
            name.rsplit(" ", 1)[-1].casefold() for name in observed_names if name
        }
        at_surnames = {row["surname"].casefold() for row in target_rows_at}

        target_rows.append(
            {
                "afl_api_provider_id": provider_id,
                "afl_api_observed_name": bridge_entry.get("observed_name"),
                "afl_api_snapshot_observed_names": observed_names,
                "afltables_external_id": target_path,
                "afltables_observed_names": afltables_names,
                "club_evidence": sorted(
                    {row["club"] for row in rows_for_provider}
                ),
                "provider_team_ids": sorted(
                    {row["provider_team_id"] for row in rows_for_provider}
                ),
                "jumper_evidence": sorted(
                    {row["jumper"] for row in rows_for_provider if row["jumper"] is not None}
                ),
                "afltables_club_evidence": sorted({row["club"] for row in target_rows_at}),
                "afltables_jumper_evidence": sorted(
                    {row["jumper"] for row in target_rows_at if row["jumper"] is not None}
                ),
                "comparable_match_observations": len(rows_for_provider),
                "agreeing_core_vector_observations": agreeing,
                "non_agreeing_observations": non_agreeing,
                "competing_candidate_count": len(candidates) - 1,
                "afltables_rows_at_target": len(target_rows_at),
                "agreement": agreement,
                "career_games_first_2026_minimum": min_career_games,
                "career_games_discriminator": (
                    "PASS_FIRST_2026_APPEARANCE_CAREER_GAMES_1"
                    if min_career_games == 1
                    else "FAIL"
                ),
                "category_a_classification": category_a[target_path].get("classification"),
                "category_a_reason": category_a[target_path].get("reason"),
                "category_a_first_2026_match_date": category_a[target_path].get(
                    "first_2026_match_date"
                ),
                "category_a_first_2026_career_games": category_a[target_path].get(
                    "first_2026_career_games"
                ),
                "draftguru_player_url": category_a[target_path].get("player_url"),
                "surname_agreement_validation_only": bool(api_surnames & at_surnames),
                "evidence_grade": EVIDENCE_GRADE,
                "disposition": DISPOSITION,
                "non_unanimous_explanation": disagreements or None,
                "bridge_unresolved_reason": bridge_entry.get("reason"),
                "bridge_snapshot_row_count": bridge_entry.get("snapshot_row_count"),
            }
        )

    if len(target_rows) != EXPECTED_UNRESOLVED_PROVIDERS:
        raise refuse(
            f"target rows {len(target_rows)} != Population B {EXPECTED_UNRESOLVED_PROVIDERS}"
        )
    if len(claimed_paths) != EXPECTED_CATEGORY_A:
        raise refuse(
            f"claimed AFL Tables paths {len(claimed_paths)} != Category A "
            f"{EXPECTED_CATEGORY_A}"
        )
    uncovered = sorted(set(category_a) - set(claimed_paths))
    if uncovered:
        raise refuse(
            "Category A paths claimed by no provider: " + ", ".join(uncovered[:10])
        )

    failed_discriminator = [
        row["afl_api_provider_id"]
        for row in target_rows
        if row["career_games_discriminator"] != "PASS_FIRST_2026_APPEARANCE_CAREER_GAMES_1"
    ]
    if failed_discriminator:
        raise refuse(
            "Career.Games first-2026 discriminator failed for: "
            + ", ".join(failed_discriminator)
        )

    acceptance_rule = bridge.get("acceptance_rule")
    if not isinstance(acceptance_rule, dict):
        raise refuse("AFL API player bridge artefact carries no acceptance_rule")
    if acceptance_rule.get("name_based_candidate_discovery") is not False:
        raise refuse(
            "the bridge artefact's acceptance_rule no longer declares "
            "name_based_candidate_discovery: false"
        )

    artefact: dict[str, object] = {
        "schema_version": 1,
        "kind": "issue224_s9_target_set",
        "issue": "AFLDB-ISSUE-224",
        "purpose": "ISSUE-228 S9 player-registration target set",
        "generated_at": args.generated_at,
        "generated_at_basis": (
            "frozen argument, not a wall-clock time, so the artefact is byte-reproducible"
        ),
        "tool": {"path": TOOL_PATH, "version": TOOL_VERSION},
        "read_only": True,
        "database_access": "NOT_PERFORMED",
        "network_access": "NOT_PERFORMED",
        "afl_api_source": {
            "snapshot_label": api_manifest.get("label"),
            "snapshot_dir": str(args.afl_api_snapshot_dir),
            "snapshot_manifest_sha256": sha256_file(
                args.afl_api_snapshot_dir.resolve() / "manifest.json"
            ),
            "snapshot_acquired_at": api_manifest.get("acquired_at"),
            "snapshot_matches_selected": (api_manifest.get("counts") or {}).get(
                "matches_selected"
            ),
            "per_file_hashes_verified_against_snapshot_manifest": True,
            "acceptance_snapshot_note": (
                "This tool records the label this snapshot's own manifest declares and "
                "asserts NOTHING about which snapshot is the ISSUE-228 S9 acceptance "
                "snapshot. The accepted bridge artefact pins "
                "afl-api-2026-2026-09-21-011148 (manifest sha256 "
                "dcbd0626e64a6fcf0ed9c73e910b8b83c10aae50a8552e69be172df184c33ecb), whose "
                "raw bytes were NOT available on any local root at generation time. The "
                "snapshot actually read here is named above. Substantive equivalence is "
                "not byte identity; promoting or recovering a snapshot is ISSUE-228 "
                "decision D-9b and is NOT resolved by this artefact."
            ),
            "acceptance_snapshot_pinned_by_bridge": bridge.get("snapshot_label"),
            "acceptance_snapshot_manifest_sha256_pinned_by_bridge": bridge.get(
                "snapshot_manifest_sha256"
            ),
            "acceptance_snapshot_bytes_available": False,
        },
        "afl_api_bridge": {
            "path": args.bridge,
            "sha256": sha256_file(bridge_path),
            "tool": bridge.get("tool"),
            "built_from_database": bridge.get("built_from_database"),
            "generated_utc": bridge.get("generated_utc"),
            "providers_total": len(providers),
            "providers_linked": (bridge.get("counts") or {}).get("providersLinked"),
            "providers_unresolved": (bridge.get("counts") or {}).get("providersUnresolved"),
            "player_match_rows_uncovered": (bridge.get("counts") or {}).get(
                "playerMatchRowsUncovered"
            ),
            "acceptance_rule": acceptance_rule,
        },
        "afltables_source": {
            "snapshot_label": at_manifest.get("snapshot_label"),
            "tracked_manifest_path": at_manifest_rel,
            "tracked_manifest_sha256": sha256_file(repo_root / at_manifest_rel),
            "player_stats_filename": player_stats_entry["filename"],
            "player_stats_dir": str(args.player_stats_dir),
            "player_stats_sha256": csv_sha256,
            "player_stat_row_count": len(at_rows),
            "match_count": (at_manifest.get("in_season") or {}).get("matches"),
            "completeness": at_manifest.get("completeness"),
            "verdict_authority": at_manifest.get("verdict_authority"),
            "verdict_authority_run": False,
        },
        "byte_bound_inputs": byte_bound,
        "supporting_inputs": [
            {
                "path": args.identities,
                "sha256": sha256_file(repo_root / args.identities),
                "role": "AFL API CD_T<team> -> AFL Tables club name mapping",
            }
        ],
        "matching": {
            "algorithm": (
                "The accepted AFL API bridge's own evidence class, run source-to-source "
                "with the AFL Tables 2026 snapshot in place of the canonical database. A "
                "provider match row and an AFL Tables player-match row are the same "
                "observation when club, jumper number and all 13 core statistics are "
                "equal. A provider's candidate set is every AFL Tables profile any of its "
                "rows keys to; exactly one candidate and zero competing candidates is "
                "required. Names never discover, propose or disambiguate a candidate."
            ),
            "key_fields": ["club", "jumper_number", "core_stat_vector"],
            "core_vector_fields_afl_api": [
                ".".join(field) for _, field, _ in CORE_VECTOR
            ],
            "core_vector_fields_afltables": [column for _, _, column in CORE_VECTOR],
            "core_vector_field_names": [name for name, _, _ in CORE_VECTOR],
            "core_vector_source_of_truth": (
                "src/lib/acquisition/afl-api-player-evidence.ts:107-111 "
                "(CORE_STAT_COLUMNS); AFL API field paths per "
                "src/lib/acquisition/afl-api-bundle.ts:517-534"
            ),
            "club_mapping": (
                "afl-api-identities.json teams CD_T<id>.hist, compared to "
                "player_stats_2026.csv Playing.for; all 18 clubs map exactly, no alias "
                "normalisation applied"
            ),
            "name_based_candidate_discovery": False,
            "surname_equality_is_validation_only": True,
            "ambiguous_candidate_key_rows": ambiguous_key_rows,
            "ambiguous_candidate_keys": ambiguous_keys,
            "afltables_rows_scanned_for_key_uniqueness": len(at_rows),
        },
        "counts": {
            "afl_api_unresolved_providers_total": len(unresolved),
            "target_rows": len(target_rows),
            "unique_afl_api_providers": len({row["afl_api_provider_id"] for row in target_rows}),
            "unique_afltables_paths": len({row["afltables_external_id"] for row in target_rows}),
            "unanimous": unanimous,
            "single_candidate_non_unanimous": single_candidate_non_unanimous,
            "ambiguous": 0,
            "unmatched": 0,
            "competing_candidates_any_row": 0,
            "population_a_category_a_total": len(category_a),
            "population_a_category_a_covered": len(claimed_paths),
            "population_a_only": len(uncovered),
            "population_b_only": 0,
            "career_games_discriminator_pass": len(target_rows)
            - len(failed_discriminator),
            "register": sum(1 for row in target_rows if row["disposition"] == DISPOSITION),
            "withhold": 0,
            "halt": 0,
        },
        "phase3_disposition_not_superseded": {
            "artefact": BYTE_BOUND["phase3_verdicts"]["rel"],
            "register": 0,
            "defer_to_rollover": 92,
            "note": (
                "The Phase 3 operator disposition is unchanged by this artefact. This "
                "target set establishes IDENTITY evidence only. Superseding the Phase 3 "
                "disposition is operator decision D-7; the registration sequencing is "
                "D-8. Nothing here authorises registration."
            ),
        },
        "authorisation": {
            "identity_evidence": "ESTABLISHED for 92 of 92",
            "registration_authorised": False,
            "blocking_decisions": ["D-7", "D-8"],
            "not_owned_here": ["D-9b (ISSUE-228)"],
        },
        "rows": target_rows,
    }
    artefact["rows_sha256"] = hashlib.sha256(canonical_bytes(target_rows)).hexdigest()

    out_path = (
        args.out if args.out.is_absolute() else repo_root / args.out
    )
    payload = json.dumps(artefact, indent=2, sort_keys=True, ensure_ascii=True) + "\n"
    encoded = payload.encode("utf-8")
    if out_path.exists():
        existing = out_path.read_bytes()
        if existing != encoded:
            raise refuse(
                f"{out_path} already exists with different bytes; refusing to overwrite "
                "an immutable evidence artefact"
            )
        return out_path, artefact
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("wb") as handle:
        handle.write(encoded)
    return out_path, artefact


def main(argv: list[str] | None = None) -> int:
    default_root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=default_root)
    parser.add_argument(
        "--afl-api-snapshot-dir",
        type=Path,
        required=True,
        help="Directory holding the AFL API snapshot's manifest.json and CD_M* folders.",
    )
    parser.add_argument(
        "--player-stats-dir",
        type=Path,
        required=True,
        help="Directory holding the AFL Tables player_stats_2026.csv named by the manifest.",
    )
    parser.add_argument("--afltables-manifest", default=DEFAULT_AFLTABLES_MANIFEST_REL)
    parser.add_argument("--bridge", default=DEFAULT_BRIDGE_REL)
    parser.add_argument("--identities", default=DEFAULT_IDENTITIES_REL)
    parser.add_argument("--out", type=Path, default=Path(DEFAULT_OUT_REL))
    parser.add_argument("--generated-at", default=GENERATED_AT_DEFAULT)
    args = parser.parse_args(argv)

    try:
        out_path, artefact = build(args)
    except Refusal as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        return 2

    counts = artefact["counts"]
    print(f"wrote {out_path}")
    print(f"  file sha256 : {sha256_file(out_path)}")
    print(f"  rows_sha256 : {artefact['rows_sha256']}")
    for key in (
        "target_rows",
        "unique_afl_api_providers",
        "unique_afltables_paths",
        "unanimous",
        "single_candidate_non_unanimous",
        "ambiguous",
        "unmatched",
        "register",
        "withhold",
        "halt",
    ):
        print(f"  {key:32s}: {counts[key]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
