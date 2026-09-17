#!/usr/bin/env python3
"""Build the tracked season-grain Brownlow artefact from an authorised export.

AFLDB-ISSUE-113 §8.6 / §8.12. Input is the read-only ``\\copy`` export taken from
the preserved authoritative database (``afldb_prod_auth_recovery``) with the
exact SQL recorded in ``EXPORT_SQL`` below, plus the tracked adjudication file
``data/brownlow/player-identity.csv``. Output is ``data/brownlow/season-votes.csv``
and its manifest ``data/brownlow/season-votes.manifest.json``.

What it does, and only this:

* every export row whose ``afltables_profile_url`` is empty (the legacy players
  with no profile path in the recovery database) receives the adjudicated path
  for its ``bootstrap_player_id`` — and the gap-fill adjudication rows must
  cover exactly that set of ids, no more and no fewer;
* a NON-empty recovery-bridge path is authoritative and is carried verbatim,
  unless the adjudication file holds an explicit override row (§8.14.5) for
  that exact ``bootstrap_player_id`` whose ``recovery_profile_url`` equals,
  verbatim, the path the export carries for it. Only then is the path replaced
  with the row's ``afltables_profile_url``. An override row that names a player
  the export lacks, or a path the export does not carry for that player, is a
  hard failure. The replaced path is recorded in the manifest;
* rows are re-sorted into deterministic ``(season, afltables_profile_url)``
  order and written byte-stable (LF, UTF-8, minimal quoting);
* every other value is carried through verbatim. Empty stays empty: SQL NULL
  is never coerced to 0.

No database contact, no network, no name matching, no spelling correction, no
span- or alias-based guessing: a mismatched bridge path with no explicit
override reaches the loader unchanged and is rejected there. The manifest
records the provenance the loader and the Stage-9 rebuild gates verify against.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))

from import_brownlow_season import (  # noqa: E402
    ARTEFACT_PATH,
    HEADER,
    IDENTITY_PATH,
    MANIFEST_PATH,
    MANIFEST_SCHEMA_VERSION,
    NULLABLE_SMALLINTS,
    SOURCE_KEY,
    BrownlowSeasonSourceError,
    load_artefact,
    load_identity_adjudications,
    measure,
    sha256_file,
    validate_offline,
)

# The exact SQL the export was taken with (AFLDB-ISSUE-113 §8.8), read-only, as
# the owner role under default_transaction_read_only = on. Recorded verbatim in
# the manifest so a later reader can reproduce the artefact from the same source.
EXPORT_SQL = (
    "SELECT b.season, ei.external_id AS afltables_profile_url, b.votes, b.vote_rank, "
    "b.eligible_rank, b.is_ineligible, b.is_winner, b.games, b.three_vote_games, "
    "b.two_vote_games, b.one_vote_games, b.polling_games, b.link_status_value, "
    "b.player_id AS bootstrap_player_id, p.display_name, "
    "b.source_record_id AS legacy_source_record_id "
    "FROM brownlow_season_votes b JOIN players p ON p.id = b.player_id "
    "LEFT JOIN (SELECT ei.player_id, ei.external_id FROM external_identities ei "
    "JOIN sources s ON s.id = ei.source_id WHERE s.key = 'afltables' "
    "AND ei.match_method = 'afltables_profile_url' AND ei.status IN ('unique','resolved') "
    "AND ei.player_id IS NOT NULL) ei ON ei.player_id = b.player_id "
    "ORDER BY b.season, ei.external_id, b.player_id"
)


def season_coverage(seasons: Sequence[int]) -> list[list[int]]:
    """Collapse a sorted season set into inclusive [first, last] ranges."""
    ranges: list[list[int]] = []
    for season in sorted(set(seasons)):
        if ranges and ranges[-1][1] == season - 1:
            ranges[-1][1] = season
        else:
            ranges.append([season, season])
    return ranges


def build(export_path: Path, identity_path: Path, artefact_path: Path) -> dict:
    identities = load_identity_adjudications(identity_path)

    with export_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, strict=True)
        if tuple(reader.fieldnames or ()) != HEADER:
            raise BrownlowSeasonSourceError(
                f"{export_path.name}: header is not the §8.6 column list")
        export_rows = list(reader)

    gap_fills = {i: a for i, a in identities.items() if not a.is_override}
    overrides = {i: a for i, a in identities.items() if a.is_override}

    # Rule 1 (§8.12): the gap-fill rows cover exactly the export's empty-path
    # players, no more and no fewer.
    gap_ids = {int(r["bootstrap_player_id"]) for r in export_rows
               if r["afltables_profile_url"] == ""}
    if gap_ids != set(gap_fills):
        raise BrownlowSeasonSourceError(
            "adjudication file does not cover exactly the export's empty-path players: "
            f"unadjudicated {sorted(gap_ids - set(gap_fills))}, "
            f"surplus {sorted(set(gap_fills) - gap_ids)}")

    # Rule 2 (§8.14.5): a non-empty recovery-bridge path is authoritative unless an
    # override row exists for that exact bootstrap id AND names, verbatim, the path
    # the export actually carries for it. Anything else is a hard failure: the
    # builder never infers which legacy player an override was meant for.
    export_paths_by_id: dict[int, set[str]] = {}
    for r in export_rows:
        export_paths_by_id.setdefault(int(r["bootstrap_player_id"]), set()).add(
            r["afltables_profile_url"])
    for bootstrap_id, adjudication in overrides.items():
        carried = export_paths_by_id.get(bootstrap_id)
        if carried is None:
            raise BrownlowSeasonSourceError(
                f"override for bootstrap_player_id {bootstrap_id}: the export has no rows "
                "for this legacy player")
        if carried != {adjudication.recovery_profile_url}:
            raise BrownlowSeasonSourceError(
                f"override for bootstrap_player_id {bootstrap_id}: the export carries "
                f"{sorted(carried)}, not the adjudicated recovery path "
                f"{adjudication.recovery_profile_url!r}; refusing to override a path the "
                "adjudication does not name")
    bridged_ids_by_path: dict[str, set[int]] = {}
    for r in export_rows:
        if r["afltables_profile_url"] != "":
            bridged_ids_by_path.setdefault(r["afltables_profile_url"], set()).add(
                int(r["bootstrap_player_id"]))
    for bootstrap_id, adjudication in overrides.items():
        sharers = bridged_ids_by_path[adjudication.recovery_profile_url] - {bootstrap_id}
        if sharers:
            raise BrownlowSeasonSourceError(
                f"override for bootstrap_player_id {bootstrap_id}: recovery path "
                f"{adjudication.recovery_profile_url!r} is also carried by legacy "
                f"player(s) {sorted(sharers)}; an override names exactly one legacy player")

    # Rule 3: no adjudicated path (gap fill or override) may already be carried by
    # a bridged export player that is not itself being overridden.
    surviving_bridged = {path for path, ids in bridged_ids_by_path.items()
                         if ids - set(overrides)}
    collisions = sorted(i.afltables_profile_url for i in identities.values()
                        if i.afltables_profile_url in surviving_bridged)
    if collisions:
        raise BrownlowSeasonSourceError(
            "adjudicated path(s) already carried by a bridged export player: "
            f"{collisions}")

    filled = 0
    overridden = 0
    for r in export_rows:
        bootstrap_id = int(r["bootstrap_player_id"])
        if r["afltables_profile_url"] == "":
            r["afltables_profile_url"] = gap_fills[bootstrap_id].afltables_profile_url
            filled += 1
        elif bootstrap_id in overrides:
            r["afltables_profile_url"] = overrides[bootstrap_id].afltables_profile_url
            overridden += 1
    export_rows.sort(key=lambda r: (int(r["season"]), r["afltables_profile_url"]))

    artefact_path.parent.mkdir(parents=True, exist_ok=True)
    with artefact_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=HEADER, lineterminator="\n",
                                quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()
        writer.writerows(export_rows)

    # Provenance for the manifest: what each override replaced, and how much.
    override_records = []
    for bootstrap_id, adjudication in sorted(overrides.items()):
        affected = [r for r in export_rows if int(r["bootstrap_player_id"]) == bootstrap_id]
        override_records.append({
            "bootstrap_player_id": bootstrap_id,
            "display_name": adjudication.display_name,
            "recovery_profile_url": adjudication.recovery_profile_url,
            "afltables_profile_url": adjudication.afltables_profile_url,
            "evidence": adjudication.evidence,
            "rows": len(affected),
            "seasons": [int(r["season"]) for r in affected],
            "votes": sum(int(r["votes"]) for r in affected),
        })
    return {"export_rows": len(export_rows), "adjudicated_rows": filled,
            "overridden_rows": overridden, "overrides": override_records}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", type=Path, required=True,
                        help="the raw \\copy export CSV (not tracked)")
    parser.add_argument("--export-sha256", required=True,
                        help="SHA-256 of the export as hashed on the source host")
    parser.add_argument("--identity", type=Path, default=IDENTITY_PATH)
    parser.add_argument("--artefact", type=Path, default=ARTEFACT_PATH)
    parser.add_argument("--manifest", type=Path, default=MANIFEST_PATH)
    parser.add_argument("--source-host", required=True)
    parser.add_argument("--source-database", required=True)
    parser.add_argument("--source-role", required=True)
    parser.add_argument("--postgres-version", required=True)
    parser.add_argument("--extracted-at-utc", required=True,
                        help="ISO-8601 UTC timestamp of the export")
    parser.add_argument("--dump-file", required=True,
                        help="the pre-cutover dump the source database was restored from")
    parser.add_argument("--dump-sha256", required=True)
    args = parser.parse_args(argv)

    actual_export_sha = sha256_file(args.export)
    if actual_export_sha != args.export_sha256:
        print(f"ERROR: export {args.export} hashes to {actual_export_sha}, not "
              f"{args.export_sha256}", file=sys.stderr)
        return 1

    try:
        built = build(args.export, args.identity, args.artefact)
        rows = load_artefact(args.artefact)
    except BrownlowSeasonSourceError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    identities = load_identity_adjudications(args.identity)
    measured = measure(rows)
    manifest = {
        "$comment": [
            "AFLDB-ISSUE-113 §8.6. Provenance for data/brownlow/season-votes.csv: a",
            "re-keyed, read-only export of the legacy-loaded authoritative",
            "brownlow_season_votes preserved in the pre-cutover recovery database.",
            "Every value is carried verbatim; empty = SQL NULL, never 0. The loader",
            "(tools/migration/import_brownlow_season.py) and the Stage-9 rebuild gates",
            "verify the artefact against this file. Regenerate only from a fresh",
            "authorised export via tools/migration/build_brownlow_season_artefact.py.",
        ],
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "issue": "AFLDB-ISSUE-113",
        "builder": "tools/migration/build_brownlow_season_artefact.py",
        "loader": "tools/migration/import_brownlow_season.py",
        "provenance_source_key": SOURCE_KEY,
        "source": {
            "host": args.source_host,
            "database": args.source_database,
            "role": args.source_role,
            "postgres_version": args.postgres_version,
            "read_only": True,
            "restored_from_dump": args.dump_file,
            "dump_sha256": args.dump_sha256,
        },
        "extracted_at_utc": args.extracted_at_utc,
        "export_sql": EXPORT_SQL,
        "export": {
            "rows": built["export_rows"],
            "csv_sha256": actual_export_sha,
            "rows_without_profile_path": built["adjudicated_rows"],
            "rows_with_overridden_profile_path": built["overridden_rows"],
        },
        "identity": {
            "file": "data/brownlow/player-identity.csv",
            "csv_sha256": sha256_file(args.identity),
            "players": len(identities),
            "rows": built["adjudicated_rows"] + built["overridden_rows"],
            "gap_players": sum(1 for i in identities.values() if not i.is_override),
            "gap_rows": built["adjudicated_rows"],
            "override_players": len(built["overrides"]),
            "override_rows": built["overridden_rows"],
            "evidence": {
                evidence: sum(1 for i in identities.values() if i.evidence == evidence)
                for evidence in ("round_vote_witness", "unique_name_span", "operator")
            },
            # §8.14.5: each explicit override, with the recovery-bridge path it
            # replaced, so the original identity claim is never lost.
            "overrides": built["overrides"],
        },
        "artefact": {
            "file": "data/brownlow/season-votes.csv",
            "csv_sha256": sha256_file(args.artefact),
            "columns": list(HEADER),
            "nullable_columns": list(NULLABLE_SMALLINTS),
            "rows": measured["rows"],
            "votes_total": measured["votes_total"],
            "winners": measured["winners"],
            "seasons": measured["seasons"],
            "players": measured["players"],
            "first_season": measured["first_season"],
            "last_season": measured["last_season"],
            "season_coverage": season_coverage([row.season for row in rows]),
            "null_counts": measured["null_counts"],
            "ineligible_rows": measured["ineligible_rows"],
            "link_status_counts": measured["link_status_counts"],
        },
    }
    with args.manifest.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=False)
        handle.write("\n")

    try:
        summary = validate_offline(args.artefact, args.manifest, args.identity)
    except BrownlowSeasonSourceError as exc:
        print(f"ERROR: built artefact fails its own validation: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(summary, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
