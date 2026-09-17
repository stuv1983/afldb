#!/usr/bin/env python3
"""Freeze the AFLDB-ISSUE-222 Stage B3 whole-population person-page sample
(revised runbook §2, §5 Phase 1 item 2).

Stage B3 acquires the FULL DraftGuru person population -- unlike Stage B1's
120-person profiling sample, every distinct ``player_url`` in the accepted
Stage A snapshot is selected, with no sampling and no scoring by
``reported_games`` (B2 handoff §18). This module performs only the
population-sample freeze: it reads the accepted Stage A snapshot and writes
``sample.json`` into a Stage B3 ``person-html-<date>`` snapshot, under the
SAME label pattern Stage B1 uses -- ``person-html-20260826`` (the accepted
Stage B1 snapshot) is refused outright, so a Stage B3 write can never collide
with or promote the Stage B1 profiling snapshot in place (B2 handoff §18).

Every selected person carries ``primary_cohort: "population"`` -- there is
exactly one cohort, because the population IS the sample. A descriptive
``games_zero`` / ``games_positive`` tag is still recorded (mirroring Stage
B1's ``reported_games_basis``), for the by-population breakdown the profiler
and Stage B3 acquisition report use -- never a selection criterion, and never
an identity gate.

Determinism: ``sample.json`` carries no timestamp, so a rerun over identical
inputs is byte-identical. Acquisition order is slug then ordinal --
``stage_b1_sample``'s ``sha256(player_url)`` stratified-draw ordering is not
used here because there is no stratified random draw: the population is
taken in full.

Safety: zero network, zero PostgreSQL, zero psycopg, zero legacy SQLite --
identical posture to ``stage_b1_sample.py``. Every write target is asserted
to live inside the Stage B3 snapshot.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOL_DIR))
import parse_draft_snapshot as snapshot_parser  # noqa: E402  (stdlib-only, offline)
import stage_b1_sample as b1                     # noqa: E402  (Stage A loader + helpers)

REPO_ROOT = TOOL_DIR.parents[2]

GENERATOR = "tools/rebuild/draftguru/stage_b3_population.py"
GENERATOR_VERSION = "1.0.0"
SAMPLE_CONTRACT_VERSION = 1

ACCEPTED_STAGE_A_LABEL = b1.ACCEPTED_STAGE_A_LABEL
PRIMARY_COHORT = "population"
DEFAULT_ZERO_GAME_COHORT_TAG = "games_zero"


class PopulationSampleError(Exception):
    """A Stage B3 population-sample contract violation. Always fails closed."""


# ---------------------------------------------------------------------------
# Contract / path resolution
# ---------------------------------------------------------------------------

def _b3_block(contract: dict) -> dict:
    b3 = contract.get("person_stage", {}).get("b3")
    if b3 is None:
        raise PopulationSampleError(
            "the contract carries no person_stage.b3 block yet -- Stage B3 tooling "
            "requires the reviewed contract block (revised runbook §2.2) before it can run")
    return b3


def resolve_person_snapshot_dir(contract: dict, snapshot_root: str | None, label: str) -> Path:
    """Resolve the Stage B3 snapshot directory.

    Reuses Stage B1's label-pattern resolution (the two patterns are identical) and
    additionally refuses every ``b3.person_snapshot.refused_labels`` entry -- above all the
    accepted Stage B1 snapshot itself, which must never be promoted in place.
    """
    b3 = _b3_block(contract)
    for refused in b3.get("person_snapshot", {}).get("refused_labels", []):
        if label == refused["label"]:
            raise PopulationSampleError(
                f"label {label!r} is refused for a Stage B3 population write: "
                f"{refused['reason']}")
    return b1.resolve_person_snapshot_dir(contract, snapshot_root, label)


# ---------------------------------------------------------------------------
# Selection (the whole population, one cohort)
# ---------------------------------------------------------------------------

def games_tag(person: dict) -> str:
    return "games_zero" if max(person["career_games"]) == 0 else "games_positive"


def build_population_sample(contract: dict, *, label: str, stage_a_dir: Path,
                            manifest_path: Path, zero_game_cohort_tag: str) -> tuple[dict, dict]:
    stage_a = b1.load_stage_a(contract, stage_a_dir, manifest_path)
    persons = stage_a["persons"]

    order = sorted(persons, key=lambda url: (persons[url]["slug"], persons[url]["ordinal"]))
    people = []
    zero_count = 0
    for url in order:
        person = persons[url]
        tag = games_tag(person)
        if tag == "games_zero":
            zero_count += 1
        tags = {tag}
        if tag == "games_zero":
            tags.add(zero_game_cohort_tag)
        people.append({
            "player_url": url,
            "slug": person["slug"],
            "ordinal": person["ordinal"],
            "primary_cohort": PRIMARY_COHORT,
            "eligibility_tags": sorted(tags),
            "draft_years": person["draft_years"],
            "decade_basis_year": person["draft_years"][0],
            "stage_a_row_count": person["row_count"],
            "reported_games_basis": b1.reported_games_basis(person),
            "player_url_sha256": b1.selection_key(url),
        })

    payload = {
        "$comment": "AFLDB-ISSUE-222 Stage B3 whole-population person-page sample (revised "
                    "runbook §2, §5 Phase 1 item 2). Every distinct player_url in the accepted "
                    "Stage A snapshot, one primary_cohort ('population') for all -- not a "
                    "sample. Deterministic and timestamp-free, so a rerun over identical "
                    "inputs is byte-identical.",
        "stage": "B3",
        "sample_contract_version": SAMPLE_CONTRACT_VERSION,
        "generator": GENERATOR,
        "generator_version": GENERATOR_VERSION,
        "snapshot_label": label,
        "identity_complete": False,
        "import_capable": False,
        "identity_rules": {
            "identity_field": "player_url",
            "canonical_form": contract["canonical_player_url"]["form"],
            "ordinal": "significant -- /brad_miller/1 and /brad_miller/2 are different people",
            "percent_encoding": "significant -- never decoded or space-normalised",
            "never_identity": "any rendered name",
        },
        "stage_a_source": {
            "label": stage_a_dir.name,
            "snapshot_dir": stage_a_dir.relative_to(REPO_ROOT).as_posix()
                            if stage_a_dir.is_relative_to(REPO_ROOT) else stage_a_dir.as_posix(),
            "manifest_path": manifest_path.relative_to(REPO_ROOT).as_posix()
                             if manifest_path.is_relative_to(REPO_ROOT)
                             else manifest_path.as_posix(),
            "manifest_sha256": stage_a["manifest_sha256"],
            "persons_jsonl_sha256": stage_a["persons_jsonl_sha256"],
            "rows_jsonl_sha256": stage_a["rows_jsonl_sha256"],
            "distinct_person_count": len(persons),
            "row_count": stage_a["row_total"],
            "immutable": True,
        },
        "selection": {
            "population_rule": "every distinct player_url in the accepted Stage A snapshot's "
                                "parsed/persons.jsonl -- not scoped by reported_games",
            "cohort": PRIMARY_COHORT,
            "ordering": "slug then ordinal, byte-identical across runs",
            "zero_game_cohort_tag": zero_game_cohort_tag,
        },
        "counts": {
            "total": len(people),
            "by_primary_cohort": {PRIMARY_COHORT: len(people)},
            "games_zero": zero_count,
            "games_positive": len(people) - zero_count,
        },
        "selected_player_urls": order,
        "persons": people,
    }
    return payload, stage_a


def print_summary(payload: dict, *, sample_path: Path, sample_sha: str, wrote: bool) -> None:
    counts = payload["counts"]
    print("== Stage B3 population sample ==")
    print(f"label                : {payload['snapshot_label']}")
    print(f"stage A label        : {payload['stage_a_source']['label']} "
          f"(manifest sha256 {payload['stage_a_source']['manifest_sha256'][:16]}...)")
    print(f"stage A persons/rows : {payload['stage_a_source']['distinct_person_count']} / "
          f"{payload['stage_a_source']['row_count']}")
    print(f"population total     : {counts['total']} (games_zero {counts['games_zero']}, "
          f"games_positive {counts['games_positive']})")
    print(f"sample.json          : {sample_path} ({'written' if wrote else 'unchanged'})")
    print(f"sample.json sha256   : {sample_sha}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--label", required=True,
                        help="Stage B3 snapshot label, e.g. person-html-20260918")
    parser.add_argument("--stage-a-label", default=ACCEPTED_STAGE_A_LABEL,
                        help="accepted, immutable Stage A snapshot label (read-only input)")
    parser.add_argument("--snapshot-root", help="override the contract snapshot root")
    parser.add_argument("--manifest-dir",
                        help="override the contract manifest directory (Stage A manifest input)")
    parser.add_argument("--out", help="override the sample.json output path")
    parser.add_argument("--zero-game-cohort", default=DEFAULT_ZERO_GAME_COHORT_TAG,
                        help="descriptive tag recorded for every reported-zero-games person "
                             "(never a selection criterion; fixed default 'games_zero')")
    parser.add_argument("--validate-only", action="store_true",
                        help="build and validate, compare with any existing sample.json, "
                             "write nothing")
    parser.add_argument("--overwrite", action="store_true",
                        help="permit replacing an existing sample.json whose bytes differ")
    args = parser.parse_args(argv)

    try:
        contract = snapshot_parser.load_contract()
        person_dir = resolve_person_snapshot_dir(contract, args.snapshot_root, args.label)
        stage_a_dir = b1.resolve_stage_a_dir(contract, args.snapshot_root, args.stage_a_label)
        if person_dir == stage_a_dir:
            raise PopulationSampleError(
                "Stage B3 and Stage A snapshots must be different directories")

        manifest_dir = Path(args.manifest_dir) if args.manifest_dir \
            else (REPO_ROOT / contract["snapshot"]["manifest_dir"])
        manifest_path = (manifest_dir / f"{args.stage_a_label}.json").resolve()

        sample_path = Path(args.out) if args.out else (person_dir / "sample.json")
        sample_path = b1.assert_write_target(sample_path, person_dir, stage_a_dir)

        payload, _stage_a = build_population_sample(
            contract, label=args.label, stage_a_dir=stage_a_dir, manifest_path=manifest_path,
            zero_game_cohort_tag=args.zero_game_cohort)

        data = b1.dump_bytes(payload)
        sample_sha = b1.sha256_hex(data)
        existing = sample_path.read_bytes() if sample_path.is_file() else None

        if args.validate_only:
            if existing is None:
                print("VALIDATE-ONLY: sample is internally valid; no sample.json on disk yet")
            elif existing == data:
                print("VALIDATE-ONLY: on-disk sample.json is byte-identical to a fresh build")
            else:
                raise PopulationSampleError(
                    f"on-disk sample.json differs from a fresh deterministic build "
                    f"(disk sha256 {b1.sha256_hex(existing)}, rebuild sha256 {sample_sha})")
            wrote = False
        elif existing == data:
            wrote = False
        else:
            if existing is not None and not args.overwrite:
                raise PopulationSampleError(
                    f"sample.json already exists with different bytes (disk sha256 "
                    f"{b1.sha256_hex(existing)}, rebuild sha256 {sample_sha}); the frozen "
                    "sample is not silently replaced -- pass --overwrite deliberately")
            b1.atomic_write_bytes(sample_path, data)
            readback = sample_path.read_bytes()
            if readback != data:
                raise PopulationSampleError(
                    "sample.json readback does not match the bytes written")
            wrote = True

        print_summary(payload, sample_path=sample_path, sample_sha=sample_sha, wrote=wrote)
        print("PASS: Stage B3 population sample validated "
              f"({payload['counts']['total']} persons, one primary_cohort 'population')")
        return 0
    except (PopulationSampleError, b1.SampleError, snapshot_parser.ParseFailure) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
