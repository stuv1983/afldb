#!/usr/bin/env python3
"""Freeze the AFLDB-ISSUE-093 Stage B1 person-page profiling sample (runbook §30.3/§30.5).

Stage B1 answers one question: does the DraftGuru *person* page carry a reliable,
deterministic `player_url -> AFL Tables external identity` bridge, including for the
identities AFLDB currently lacks?  This module performs only the *sample freeze*: it
selects exactly 120 distinct DraftGuru persons under the frozen contract and writes
`sample.json` into the Stage B1 snapshot.

Inputs (all read-only):

  * the accepted, immutable Stage A snapshot `annual-html-20260826`
    (`parsed/persons.jsonl`, `parsed/rows.jsonl`) and its tracked manifest;
  * `input/residual_player_urls.txt` — the 68 Residual-A `player_url` values written
    directly by psql during the bounded read-only `afldb_dev` query (runbook §30.4).

Output:

  * `data/sources/draftguru/person-html-20260826/sample.json`

Cohorts are drawn in a fixed order, each excluding already-selected URLs, so every
selected person carries exactly one `primary_cohort`:

  1. convergence        =  8   the four proven historical convergence pairs
  2. residual           = 68   complete census, never a sample
  3. decade_control     = 30   6 per decade (1980s-2020s), reported games > 0
  4. zero_game_control  = 14   every row reports games "0"
                        -----
                          120

Determinism: strata 3 and 4 order candidates by `sha256(player_url utf-8)` hex
ascending and take the first N.  No randomness, no name-based selection, ever.
`sample.json` carries no timestamp, so a rerun over identical inputs is byte-identical.

Identity rules (U1, settled): `player_url` is the durable person identity in its exact
canonical form.  The ordinal is meaningful (`brad_miller/1` and `brad_miller/2` are
different people).  Percent-encoding (`%20`, `%C3%A1`) is significant and is never
decoded or space-normalised.  A rendered name is never identity.

Safety: zero network, zero PostgreSQL, zero psycopg, zero legacy SQLite.  Every write
target is asserted to live inside the Stage B1 snapshot, so this tool is structurally
incapable of writing into the accepted Stage A snapshot or its manifest.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOL_DIR))
import parse_draft_snapshot as snapshot_parser  # noqa: E402  (stdlib-only, offline)

REPO_ROOT = TOOL_DIR.parents[2]

GENERATOR = "tools/rebuild/draftguru/stage_b1_sample.py"
GENERATOR_VERSION = "1.0.0"
SAMPLE_CONTRACT_VERSION = 1

# The accepted, immutable Stage A snapshot this sample derives from (runbook §28).
ACCEPTED_STAGE_A_LABEL = "annual-html-20260826"

# Stage B1 label shape (runbook §30.2).  Kept identical to the `person_stage` contract
# block; when that block exists it wins, so the two can never drift apart.
PERSON_LABEL_PATTERN = r"^person-html-[0-9]{8}$"

# Residual input evidence measured by the runbook §30.4 query, 2026-08-26.  A mismatch
# means the residual population changed and is a HALT finding (§30.10), never something
# to absorb silently.
EXPECTED_RESIDUAL_LINES = 68
EXPECTED_RESIDUAL_BYTES = 3580
EXPECTED_RESIDUAL_SHA256 = \
    "df6c9a7559bceb649e8e28e457fbe91d3351d8c1737a9042f233b1f1e3c5e841"

# Cohort 1 — the four proven convergence pairs (runbook §30.3).  Order is fixed and is
# the file order for this stratum.  All eight must be present in Stage A.
CONVERGENCE_PLAYER_URLS = (
    "https://www.draftguru.com.au/players/adam_houlihan/1",
    "https://www.draftguru.com.au/players/adam_houlihan/2",
    "https://www.draftguru.com.au/players/andrew_hill/1",
    "https://www.draftguru.com.au/players/andrew_hill/2",
    "https://www.draftguru.com.au/players/brad_miller/1",
    "https://www.draftguru.com.au/players/brad_miller/2",
    "https://www.draftguru.com.au/players/michael_brown/1",
    "https://www.draftguru.com.au/players/michael_brown/2",
)

CONTROL_DECADES = (1980, 1990, 2000, 2010, 2020)
DECADE_CONTROL_QUOTA = 6                       # per decade -> 30 total
ZERO_GAME_CONTROL_QUOTA = 14

PRIMARY_COHORTS = ("convergence", "residual", "decade_control", "zero_game_control")
EXPECTED_COHORT_COUNTS = {
    "convergence": len(CONVERGENCE_PLAYER_URLS),
    "residual": EXPECTED_RESIDUAL_LINES,
    "decade_control": DECADE_CONTROL_QUOTA * len(CONTROL_DECADES),
    "zero_game_control": ZERO_GAME_CONTROL_QUOTA,
}
EXPECTED_TOTAL = sum(EXPECTED_COHORT_COUNTS.values())   # 120

# `parity_only.games` is a DraftGuru display string: a career total, optionally followed
# by a club split in parentheses ("135", "65 (0)").  Measured across all 6,810 accepted
# Stage A rows: 5,292 + 1,518 = 6,810, no nulls, no third form.  Career games is the
# leading integer; anything else fails closed rather than being coerced.
GAMES_RE = re.compile(r"^(\d+)(?: \((\d+)\))?$")

SHA256_HEX_RE = re.compile(r"^[0-9a-f]{64}$")


class SampleError(Exception):
    """A Stage B1 sample-contract violation.  Always fails closed."""


# ---------------------------------------------------------------------------
# Small helpers (stdlib only; deliberately not imported from the acquisition
# adapter so this tool cannot reach network code even transitively)
# ---------------------------------------------------------------------------

def sha256_hex(data: bytes) -> str:
    digest = hashlib.sha256(data).hexdigest()
    if not SHA256_HEX_RE.match(digest):
        raise SampleError(f"sha256 did not validate as 64-char lowercase hex: {digest!r}")
    return digest


def selection_key(player_url: str) -> str:
    """The frozen deterministic ordering key: sha256 of the URL's UTF-8 bytes."""
    return sha256_hex(player_url.encode("utf-8"))


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def dump_bytes(obj) -> bytes:
    """Canonical serialisation: sorted keys, ASCII-safe, trailing newline."""
    return (json.dumps(obj, ensure_ascii=True, sort_keys=True, indent=2) + "\n").encode("utf-8")


def read_bytes(path: Path, *, what: str) -> bytes:
    if not path.is_file():
        raise SampleError(f"missing {what}: {path}")
    return path.read_bytes()


# ---------------------------------------------------------------------------
# Contract / path resolution
# ---------------------------------------------------------------------------

def person_label_pattern(contract: dict) -> str:
    """Prefer the contract's `person_stage` block once it exists; else the local pin."""
    return (contract.get("person_stage", {})
                    .get("person_snapshot", {})
                    .get("label_pattern", PERSON_LABEL_PATTERN))


def canonical_url_regex(contract: dict) -> re.Pattern:
    return re.compile(contract["canonical_player_url"]["regex"])


def resolve_person_snapshot_dir(contract: dict, snapshot_root: str | None, label: str) -> Path:
    """Resolve the Stage B1 snapshot directory, refusing every non-B1 label."""
    annual_pattern = contract["snapshot"]["label_pattern"]
    if re.match(annual_pattern, label):
        raise SampleError(
            f"label {label!r} is an ANNUAL Stage A snapshot label ({annual_pattern}) -- "
            "Stage A is accepted and immutable; Stage B1 refuses to operate on it")
    if label == snapshot_parser.FROZEN_CSV_LABEL:
        raise SampleError(
            f"{snapshot_parser.FROZEN_CSV_LABEL} is the frozen browser-export CSV parity "
            "oracle, never a snapshot label")
    pattern = person_label_pattern(contract)
    if not re.match(pattern, label):
        raise SampleError(f"label {label!r} does not match the Stage B1 pattern {pattern}")
    root = Path(snapshot_root) if snapshot_root else (REPO_ROOT / contract["snapshot"]["root"])
    return (root / label).resolve()


def resolve_stage_a_dir(contract: dict, snapshot_root: str | None, label: str) -> Path:
    annual_pattern = contract["snapshot"]["label_pattern"]
    if not re.match(annual_pattern, label):
        raise SampleError(
            f"Stage A label {label!r} does not match the annual pattern {annual_pattern}")
    root = Path(snapshot_root) if snapshot_root else (REPO_ROOT / contract["snapshot"]["root"])
    stage_a_dir = (root / label).resolve()
    if not stage_a_dir.is_dir():
        raise SampleError(f"accepted Stage A snapshot not found: {stage_a_dir}")
    return stage_a_dir


def assert_write_target(path: Path, person_dir: Path, stage_a_dir: Path) -> Path:
    """Every write must land inside the Stage B1 snapshot.  Structural, not advisory."""
    resolved = path.resolve()
    if stage_a_dir == resolved or stage_a_dir in resolved.parents:
        raise SampleError(
            f"refusing to write inside the accepted Stage A snapshot: {resolved}")
    if person_dir != resolved and person_dir not in resolved.parents:
        raise SampleError(
            f"refusing to write outside the Stage B1 snapshot {person_dir}: {resolved}")
    return resolved


# ---------------------------------------------------------------------------
# Accepted Stage A snapshot (read-only input)
# ---------------------------------------------------------------------------

def load_stage_a(contract: dict, stage_a_dir: Path, manifest_path: Path) -> dict:
    """Load persons + rows + manifest evidence from the accepted Stage A snapshot."""
    url_re = canonical_url_regex(contract)

    persons_path = stage_a_dir / "parsed" / "persons.jsonl"
    rows_path = stage_a_dir / "parsed" / "rows.jsonl"
    persons_bytes = read_bytes(persons_path, what="Stage A parsed/persons.jsonl")
    rows_bytes = read_bytes(rows_path, what="Stage A parsed/rows.jsonl")
    manifest_bytes = read_bytes(manifest_path, what="accepted Stage A manifest")

    manifest = json.loads(manifest_bytes.decode("utf-8"))
    if manifest.get("snapshot_label") != stage_a_dir.name:
        raise SampleError(
            f"manifest snapshot_label {manifest.get('snapshot_label')!r} does not match "
            f"the Stage A snapshot directory {stage_a_dir.name!r}")

    persons: dict[str, dict] = {}
    for lineno, line in enumerate(persons_bytes.decode("utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        record = json.loads(line)
        url = record["player_url"]
        if not url_re.match(url):
            raise SampleError(
                f"persons.jsonl:{lineno}: player_url {url!r} is not canonical")
        if url in persons:
            raise SampleError(f"persons.jsonl:{lineno}: duplicate player_url {url!r}")
        years = sorted(int(y) for y in record["years"])
        if not years:
            raise SampleError(f"persons.jsonl:{lineno}: {url!r} has no draft years")
        persons[url] = {
            "player_url": url,
            "slug": record["slug"],
            "ordinal": int(record["ordinal"]),
            "draft_years": years,
            "row_count": int(record["row_count"]),
            "games_raw": [],
            "career_games": [],
        }

    expected_persons = manifest.get("distinct_player_url_count")
    if expected_persons is not None and len(persons) != expected_persons:
        raise SampleError(
            f"Stage A person count {len(persons)} != manifest distinct_player_url_count "
            f"{expected_persons}")

    row_total = 0
    for lineno, line in enumerate(rows_bytes.decode("utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        row_total += 1
        record = json.loads(line)
        url = record["player_url"]
        person = persons.get(url)
        if person is None:
            raise SampleError(
                f"rows.jsonl:{lineno}: player_url {url!r} is absent from persons.jsonl")
        raw_games = record.get("parity_only", {}).get("games")
        if raw_games is None:
            raise SampleError(
                f"rows.jsonl:{lineno}: {url!r} has no parity_only.games value -- the "
                "reported-games basis for cohorts 3 and 4 is unavailable, refusing")
        match = GAMES_RE.match(raw_games)
        if not match:
            raise SampleError(
                f"rows.jsonl:{lineno}: unrecognised games form {raw_games!r} for {url!r} -- "
                "accepted forms are '<n>' and '<n> (<n>)'; refusing to coerce")
        person["games_raw"].append(raw_games)
        person["career_games"].append(int(match.group(1)))

    for url, person in persons.items():
        if not person["career_games"]:
            raise SampleError(f"{url!r} appears in persons.jsonl but has no rows")

    return {
        "persons": persons,
        "row_total": row_total,
        "manifest": manifest,
        "manifest_sha256": sha256_hex(manifest_bytes),
        "persons_jsonl_sha256": sha256_hex(persons_bytes),
        "rows_jsonl_sha256": sha256_hex(rows_bytes),
    }


# ---------------------------------------------------------------------------
# Residual input (runbook §30.4 output; §30.5 handling)
# ---------------------------------------------------------------------------

def load_residual_input(contract: dict, path: Path, stage_a_persons: dict,
                        *, expect_sha256: str, expect_bytes: int) -> dict:
    """Parse the psql-written residual file.  Bytes in, no transformation but CRLF."""
    url_re = canonical_url_regex(contract)
    data = read_bytes(path, what="residual input file (runbook §30.4)")
    digest = sha256_hex(data)
    if expect_sha256 and digest != expect_sha256:
        raise SampleError(
            f"residual input sha256 {digest} != expected {expect_sha256} -- the residual "
            "population or file changed; this is a HALT finding (§30.10), not a mismatch "
            "to absorb")

    crlf_lines = 0
    urls: list[str] = []
    raw_lines = data.split(b"\n")
    if raw_lines and raw_lines[-1] == b"":
        raw_lines.pop()                       # a single trailing newline is expected
    for index, raw_line in enumerate(raw_lines, start=1):
        if raw_line.endswith(b"\r"):          # psql on Windows may emit CRLF
            raw_line = raw_line[:-1]
            crlf_lines += 1
        if raw_line == b"":
            raise SampleError(f"residual input line {index} is empty")
        url = raw_line.decode("utf-8")
        if not url_re.match(url):
            raise SampleError(
                f"residual input line {index}: {url!r} is not a canonical player_url")
        if url in urls:
            raise SampleError(f"residual input line {index}: duplicate player_url {url!r}")
        if url not in stage_a_persons:
            raise SampleError(
                f"residual input line {index}: {url!r} is absent byte-exactly from the "
                f"accepted Stage A snapshot -- HALT (§30.10), never coerce or normalise")
        urls.append(url)

    if len(urls) != EXPECTED_RESIDUAL_LINES:
        raise SampleError(
            f"residual input holds {len(urls)} non-empty lines, expected "
            f"{EXPECTED_RESIDUAL_LINES}")
    if len(data) != expect_bytes:
        raise SampleError(
            f"residual input is {len(data)} bytes, expected {expect_bytes}")

    return {
        "urls": urls,
        "evidence": {
            "path": path.as_posix(),
            "bytes": len(data),
            "sha256": digest,
            "line_count": len(urls),
            "crlf_stripped_lines": crlf_lines,
            "source": "psql \\o output of the bounded read-only afldb_dev query (runbook §30.4)",
            "handling": "read as bytes; one optional trailing CR stripped per line; no other "
                        "transformation -- percent-encoding is significant and never decoded",
        },
    }


# ---------------------------------------------------------------------------
# Selection (runbook §30.3)
# ---------------------------------------------------------------------------

def decade_of(person: dict) -> int:
    return (person["draft_years"][0] // 10) * 10


def decade_tag(decade: int) -> str:
    return f"decade_{decade}s"


def eligibility_tags(person: dict, *, residual_urls: frozenset[str]) -> list[str]:
    """Descriptive traits only.  Never cohort membership (runbook §30.3)."""
    tags = [decade_tag(decade_of(person))]
    tags.append("games_zero" if max(person["career_games"]) == 0 else "games_positive")
    if person["player_url"] in residual_urls:
        tags.append("residual_census_member")
    if person["player_url"] in CONVERGENCE_PLAYER_URLS:
        tags.append("convergence_pair_member")
    return sorted(tags)


def reported_games_basis(person: dict) -> dict:
    return {
        "raw_values": list(person["games_raw"]),
        "career_games_values": list(person["career_games"]),
        "max_career_games": max(person["career_games"]),
        "all_rows_zero": max(person["career_games"]) == 0,
    }


def select_sample(stage_a: dict, residual_urls: list[str]) -> dict:
    persons = stage_a["persons"]
    residual_set = frozenset(residual_urls)
    selected: dict[str, str] = {}          # player_url -> primary_cohort
    order: list[str] = []                  # file order across all strata
    strata: list[dict] = []

    def take(url: str, cohort: str) -> None:
        if url in selected:
            raise SampleError(
                f"{url!r} was already selected as {selected[url]!r}; a person may carry "
                f"exactly one primary_cohort (attempted {cohort!r})")
        selected[url] = cohort
        order.append(url)

    # --- 1. convergence -----------------------------------------------------
    missing = [u for u in CONVERGENCE_PLAYER_URLS if u not in persons]
    if missing:
        raise SampleError(
            f"convergence player_url values absent from the accepted Stage A snapshot: {missing}")
    for url in CONVERGENCE_PLAYER_URLS:
        take(url, "convergence")
    strata.append({
        "stratum": "convergence",
        "primary_cohort": "convergence",
        "rule": "the four proven historical convergence pairs, both ordinals each",
        "ordering": "fixed contract order",
        "candidates": len(CONVERGENCE_PLAYER_URLS),
        "quota": EXPECTED_COHORT_COUNTS["convergence"],
        "selected": len(CONVERGENCE_PLAYER_URLS),
        "shortfall": 0,
    })

    # --- 2. residual (complete census, never a sample) ----------------------
    overlap = [u for u in residual_urls if u in selected]
    if overlap:
        raise SampleError(
            f"residual census overlaps an earlier stratum: {overlap} -- the census must be "
            "complete at 68 while cohorts stay mutually exclusive; HALT and report")
    for url in residual_urls:
        take(url, "residual")
    strata.append({
        "stratum": "residual",
        "primary_cohort": "residual",
        "rule": "complete census of every Residual-A person, not a sample",
        "ordering": "residual input file order (psql ORDER BY player_url)",
        "candidates": len(residual_urls),
        "quota": EXPECTED_COHORT_COUNTS["residual"],
        "selected": len(residual_urls),
        "shortfall": 0,
    })

    # --- 3. decade controls, reported games > 0, 6 per decade ---------------
    for decade in CONTROL_DECADES:
        candidates = sorted(
            (p["player_url"] for p in persons.values()
             if p["player_url"] not in selected
             and max(p["career_games"]) > 0
             and decade_of(p) == decade),
            key=selection_key)
        chosen = candidates[:DECADE_CONTROL_QUOTA]
        for url in chosen:
            take(url, "decade_control")
        strata.append({
            "stratum": f"decade_control_{decade}s",
            "primary_cohort": "decade_control",
            "rule": f"min(draft_years) in the {decade}s and reported career games > 0",
            "ordering": "sha256(player_url utf-8) hex ascending",
            "candidates": len(candidates),
            "quota": DECADE_CONTROL_QUOTA,
            "selected": len(chosen),
            "shortfall": DECADE_CONTROL_QUOTA - len(chosen),
        })

    # --- 4. zero-game controls ---------------------------------------------
    zero_candidates = sorted(
        (p["player_url"] for p in persons.values()
         if p["player_url"] not in selected
         and max(p["career_games"]) == 0),
        key=selection_key)
    zero_chosen = zero_candidates[:ZERO_GAME_CONTROL_QUOTA]
    for url in zero_chosen:
        take(url, "zero_game_control")
    strata.append({
        "stratum": "zero_game_control",
        "primary_cohort": "zero_game_control",
        "rule": "every accepted Stage A row for the person reports games \"0\"",
        "ordering": "sha256(player_url utf-8) hex ascending",
        "candidates": len(zero_candidates),
        "quota": ZERO_GAME_CONTROL_QUOTA,
        "selected": len(zero_chosen),
        "shortfall": ZERO_GAME_CONTROL_QUOTA - len(zero_chosen),
    })

    people = []
    for url in order:
        person = persons[url]
        decade = decade_of(person)
        people.append({
            "player_url": url,
            "slug": person["slug"],
            "ordinal": person["ordinal"],
            "primary_cohort": selected[url],
            "eligibility_tags": eligibility_tags(person, residual_urls=residual_set),
            "decade": decade_tag(decade),
            "decade_basis_year": person["draft_years"][0],
            "draft_years": person["draft_years"],
            "stage_a_row_count": person["row_count"],
            "reported_games_basis": reported_games_basis(person),
            "player_url_sha256": selection_key(url),
        })

    return {"people": people, "order": order, "strata": strata, "cohorts": selected}


def validate_sample(selection: dict, stage_a: dict) -> dict:
    """Fail closed unless the frozen 120 / 8 / 68 / 30 / 14 contract holds exactly."""
    people = selection["people"]
    persons = stage_a["persons"]

    urls = [p["player_url"] for p in people]
    if len(set(urls)) != len(urls):
        raise SampleError("sample contains duplicate player_url values")
    if len(urls) != EXPECTED_TOTAL:
        raise SampleError(f"sample holds {len(urls)} persons, expected {EXPECTED_TOTAL}")

    counts = {cohort: 0 for cohort in PRIMARY_COHORTS}
    for person in people:
        cohort = person["primary_cohort"]
        if cohort not in counts:
            raise SampleError(f"unknown primary_cohort {cohort!r}")
        counts[cohort] += 1
        if person["player_url"] not in persons:
            raise SampleError(
                f"selected {person['player_url']!r} is absent byte-exactly from the accepted "
                "Stage A snapshot")
    if counts != EXPECTED_COHORT_COUNTS:
        raise SampleError(
            f"primary_cohort counts {counts} != frozen contract {EXPECTED_COHORT_COUNTS}")

    missing = [u for u in CONVERGENCE_PLAYER_URLS if u not in set(urls)]
    if missing:
        raise SampleError(f"convergence persons missing from the sample: {missing}")

    shortfalls = [s for s in selection["strata"] if s["shortfall"] > 0]
    if shortfalls:
        raise SampleError(
            "stratum shortfall(s) recorded, never backfilled from another stratum: "
            + ", ".join(f"{s['stratum']} short by {s['shortfall']}" for s in shortfalls))

    return counts


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

def build_sample(contract: dict, *, label: str, stage_a_dir: Path, manifest_path: Path,
                 residual_path: Path, expect_sha256: str,
                 expect_bytes: int = EXPECTED_RESIDUAL_BYTES) -> tuple[dict, dict]:
    stage_a = load_stage_a(contract, stage_a_dir, manifest_path)
    residual = load_residual_input(contract, residual_path, stage_a["persons"],
                                   expect_sha256=expect_sha256, expect_bytes=expect_bytes)
    selection = select_sample(stage_a, residual["urls"])
    counts = validate_sample(selection, stage_a)

    payload = {
        "$comment": "AFLDB-ISSUE-093 Stage B1 frozen person-page profiling sample "
                    "(runbook §30.3/§30.5). Profiling only: this sample is never an import "
                    "source. Deterministic and timestamp-free, so a rerun over identical "
                    "inputs is byte-identical.",
        "stage": "B1",
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
            "distinct_person_count": len(stage_a["persons"]),
            "row_count": stage_a["row_total"],
            "immutable": True,
        },
        "residual_input": residual["evidence"],
        "selection": {
            "cohort_order": list(PRIMARY_COHORTS),
            "mutual_exclusion": "cohorts are drawn in order, each excluding already-selected "
                                "player_url values, so every person carries exactly one "
                                "primary_cohort",
            "control_ordering": "sha256(player_url utf-8) hex ascending, first N -- no "
                                "randomness, no name-based selection",
            "decade_basis": "min(draft_years) from the accepted Stage A parsed/persons.jsonl",
            "reported_games_basis": "parity_only.games in the accepted Stage A parsed/rows.jsonl; "
                                    "career games is the leading integer of '<n>' / '<n> (<n>)'. "
                                    "DraftGuru coerces games to 0 at source -- parity-only "
                                    "evidence for stratification, never an AFLDB fact",
            "eligibility_tags": "descriptive traits only, never cohort membership",
            "strata": selection["strata"],
        },
        "counts": {
            "total": len(selection["people"]),
            "by_primary_cohort": counts,
            "expected_by_primary_cohort": EXPECTED_COHORT_COUNTS,
        },
        "selected_player_urls": list(selection["order"]),
        "persons": selection["people"],
    }
    return payload, {"stage_a": stage_a, "selection": selection, "counts": counts,
                     "residual": residual}


def print_summary(payload: dict, *, sample_path: Path, sample_sha: str,
                  wrote: bool) -> None:
    counts = payload["counts"]["by_primary_cohort"]
    print("== Stage B1 sample ==")
    print(f"label                : {payload['snapshot_label']}")
    print(f"stage A label        : {payload['stage_a_source']['label']} "
          f"(manifest sha256 {payload['stage_a_source']['manifest_sha256'][:16]}...)")
    print(f"stage A persons/rows : {payload['stage_a_source']['distinct_person_count']} / "
          f"{payload['stage_a_source']['row_count']}")
    residual = payload["residual_input"]
    print(f"residual input       : {residual['line_count']} lines, {residual['bytes']} bytes, "
          f"sha256 {residual['sha256']}")
    print(f"                       CRLF lines stripped: {residual['crlf_stripped_lines']}")
    print("-- primary cohorts (frozen contract 8 / 68 / 30 / 14 = 120) --")
    for cohort in PRIMARY_COHORTS:
        print(f"  {cohort:<18} {counts[cohort]:>4}  (expected "
              f"{payload['counts']['expected_by_primary_cohort'][cohort]})")
    print(f"  {'TOTAL':<18} {payload['counts']['total']:>4}  (expected {EXPECTED_TOTAL})")
    print("-- strata (candidates / quota / selected / shortfall) --")
    for stratum in payload["selection"]["strata"]:
        print(f"  {stratum['stratum']:<26} {stratum['candidates']:>5} / {stratum['quota']:>3} / "
              f"{stratum['selected']:>3} / {stratum['shortfall']}")
    convergence = [p["player_url"] for p in payload["persons"]
                   if p["primary_cohort"] == "convergence"]
    print(f"-- convergence persons present: {len(convergence)}/8 --")
    for url in convergence:
        print(f"  {url}")
    print(f"sample.json          : {sample_path} ({'written' if wrote else 'unchanged'})")
    print(f"sample.json sha256   : {sample_sha}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--label", required=True,
                        help="Stage B1 snapshot label, e.g. person-html-20260826")
    parser.add_argument("--stage-a-label", default=ACCEPTED_STAGE_A_LABEL,
                        help="accepted, immutable Stage A snapshot label (read-only input)")
    parser.add_argument("--snapshot-root",
                        help="override the contract snapshot root")
    parser.add_argument("--manifest-dir",
                        help="override the contract manifest directory (Stage A manifest input)")
    parser.add_argument("--residual-input",
                        help="override the residual player_url input path")
    parser.add_argument("--out",
                        help="override the sample.json output path")
    parser.add_argument("--expect-residual-sha256", default=EXPECTED_RESIDUAL_SHA256,
                        help="pinned residual-input sha256; a mismatch fails closed")
    parser.add_argument("--expect-residual-bytes", type=int, default=EXPECTED_RESIDUAL_BYTES,
                        help="pinned residual-input byte size; a mismatch fails closed")
    parser.add_argument("--validate-only", action="store_true",
                        help="build and validate, compare with any existing sample.json, "
                             "write nothing")
    parser.add_argument("--overwrite", action="store_true",
                        help="permit replacing an existing sample.json whose bytes differ")
    args = parser.parse_args(argv)

    try:
        contract = snapshot_parser.load_contract()
        person_dir = resolve_person_snapshot_dir(contract, args.snapshot_root, args.label)
        stage_a_dir = resolve_stage_a_dir(contract, args.snapshot_root, args.stage_a_label)
        if person_dir == stage_a_dir:
            raise SampleError("Stage B1 and Stage A snapshots must be different directories")

        manifest_dir = Path(args.manifest_dir) if args.manifest_dir \
            else (REPO_ROOT / contract["snapshot"]["manifest_dir"])
        manifest_path = (manifest_dir / f"{args.stage_a_label}.json").resolve()

        residual_path = Path(args.residual_input) if args.residual_input \
            else (person_dir / "input" / "residual_player_urls.txt")
        sample_path = Path(args.out) if args.out else (person_dir / "sample.json")
        sample_path = assert_write_target(sample_path, person_dir, stage_a_dir)

        payload, _evidence = build_sample(
            contract, label=args.label, stage_a_dir=stage_a_dir, manifest_path=manifest_path,
            residual_path=residual_path, expect_sha256=args.expect_residual_sha256,
            expect_bytes=args.expect_residual_bytes)

        data = dump_bytes(payload)
        sample_sha = sha256_hex(data)
        existing = sample_path.read_bytes() if sample_path.is_file() else None

        if args.validate_only:
            if existing is None:
                print("VALIDATE-ONLY: sample is internally valid; no sample.json on disk yet")
            elif existing == data:
                print("VALIDATE-ONLY: on-disk sample.json is byte-identical to a fresh build")
            else:
                raise SampleError(
                    f"on-disk sample.json differs from a fresh deterministic build "
                    f"(disk sha256 {sha256_hex(existing)}, rebuild sha256 {sample_sha})")
            wrote = False
        elif existing == data:
            wrote = False
        else:
            if existing is not None and not args.overwrite:
                raise SampleError(
                    f"sample.json already exists with different bytes (disk sha256 "
                    f"{sha256_hex(existing)}, rebuild sha256 {sample_sha}); the frozen sample "
                    "is not silently replaced -- pass --overwrite deliberately")
            atomic_write_bytes(sample_path, data)
            readback = sample_path.read_bytes()
            if readback != data:
                raise SampleError("sample.json readback does not match the bytes written")
            wrote = True

        print_summary(payload, sample_path=sample_path, sample_sha=sample_sha, wrote=wrote)
        print("PASS: frozen Stage B1 sample validated "
              f"({payload['counts']['total']} persons, one primary_cohort each)")
        return 0
    except (SampleError, snapshot_parser.ParseFailure) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
