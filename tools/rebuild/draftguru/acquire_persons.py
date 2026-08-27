#!/usr/bin/env python3
"""Acquire AFLDB-ISSUE-093 Stage B1 DraftGuru person pages (runbook §30.6-§30.8).

Stage B1 is a bounded **profiling experiment**, never an import source: it asks whether
a DraftGuru person page carries a deterministic ``player_url -> AFL Tables external
identity`` bridge, including for the identities AFLDB currently lacks.  This adapter
owns the accepted full-run orchestration:

    sample.json
      -> acquire / classify all requested identities
      -> invoke the offline profiler
      -> parsed/person_profile.jsonl + parsed/afltables_link_profile.json
      -> verify every identity carries a terminal classification
      -> build the manifest
      -> final manifest-immutability check
      -> write the manifest LAST

Probe mode performs bounded acquisition only and **never** writes the accepted manifest.

Reuse without modification: the Stage A adapter's ``Fetcher`` (pacing, timeout, retry
classifier, same-host redirects), ``check_robots``, ``atomic_write_bytes``,
``atomic_write_json``, ``sha256_hex`` and ``utc_now`` -- so the settled respectful-HTTP
policy (concurrency 1, 1.5s minimum pacing, 20s timeout, 3 retries at 2/4/8s on
timeout / connection error / 5xx / 429, same-host redirects, robots.txt respected) is
inherited rather than restated.  Stage A behaviour is not changed by this module.

Identity rules: ``player_url`` is byte-exact identity, percent-encoding included and
never decoded; ``<slug>__<ordinal>`` is a storage filename only and is never identity --
``http/persons_index.json`` maps every filename back to its exact ``player_url``.

Stage A is unreachable from here: an annual snapshot label is refused before any write,
and every write target is asserted to resolve inside the Stage B1 snapshot.

No database access of any kind, and no legacy embedded data store.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOL_DIR))
import acquire_draft as acquisition            # noqa: E402  (Stage A HTTP primitives)
import parse_draft_snapshot as snapshot_parser  # noqa: E402
import profile_person_pages as person_profiler  # noqa: E402  (offline profiler)
import stage_b1_sample as sample_tool           # noqa: E402  (label/refusal contract)

REPO_ROOT = TOOL_DIR.parents[2]

ADAPTER = "tools/rebuild/draftguru/acquire_persons.py"
ADAPTER_VERSION = "1.0.0"
ADAPTER_SCHEMA_VERSION = 1

ANNUAL_LABEL_IN_PATH = re.compile(r"annual-html-[0-9]{8}")


class PersonAcquisitionError(Exception):
    """A Stage B1 acquisition contract violation.  Always fails closed."""


# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------

def assert_inside_snapshot(path: Path, person_dir: Path) -> Path:
    """Structural refusal: never write outside this Stage B1 snapshot, and never into
    an accepted annual Stage A snapshot path."""
    resolved = path.resolve()
    if ANNUAL_LABEL_IN_PATH.search(resolved.as_posix()):
        raise PersonAcquisitionError(
            f"refusing to write into an accepted annual Stage A snapshot path: {resolved}")
    if person_dir != resolved and person_dir not in resolved.parents:
        raise PersonAcquisitionError(
            f"refusing to write outside the Stage B1 snapshot {person_dir}: {resolved}")
    return resolved


def ordered_persons(sample: dict) -> list[dict]:
    """Deterministic acquisition order: slug, then ordinal.  Byte-identical per run."""
    return sorted(sample["persons"], key=lambda p: (p["slug"], int(p["ordinal"])))


def plan_entries(contract: dict, sample: dict) -> list[dict]:
    """Filenames are storage names only; this is also where a collision fails closed."""
    entries = []
    seen: dict[str, str] = {}
    for person in ordered_persons(sample):
        stem = person_profiler.person_filename(contract, person)
        folded = stem.casefold()
        if folded in seen:
            raise PersonAcquisitionError(
                f"storage filename collision: {person['player_url']!r} and {seen[folded]!r} "
                f"both map to {stem!r} -- refusing, a filename is never identity")
        seen[folded] = person["player_url"]
        entries.append({
            "player_url": person["player_url"],          # byte-exact identity
            "slug": person["slug"],
            "ordinal": int(person["ordinal"]),
            "primary_cohort": person["primary_cohort"],
            "stem": stem,
            "raw_filename": f"raw/persons/{stem}.html",
            "http_filename": f"http/persons/{stem}.json",
        })
    return entries


# ---------------------------------------------------------------------------
# Fetching with per-attempt evidence
# ---------------------------------------------------------------------------

def fetch_with_evidence(fetcher: acquisition.Fetcher, url: str) -> dict:
    """One identity, under the Stage A retry contract, with attempt evidence recorded.

    This mirrors ``Fetcher.fetch``'s loop exactly -- same pacing (``_attempt``), same
    retry classifier (``_retryable``), same ``max_retries``/``backoff`` values read from
    the same policy object -- and adds the per-attempt record that §30.7 requires a
    terminal failure to carry.  Stage A's own behaviour is untouched.
    """
    attempts: list[dict] = []
    last_status: int | None = None
    last_reason: str | None = None
    for attempt in range(1 + fetcher.max_retries):
        try:
            body, record = fetcher._attempt(url)
        except Exception as exc:                        # noqa: BLE001 -- classified below
            status = getattr(exc, "code", None)
            retryable = fetcher._retryable(exc)
            entry = {
                "attempt": attempt + 1,
                "outcome": "error",
                "error_type": type(exc).__name__,
                "http_status": status,
                "reason": str(exc),
                "retryable": retryable,
            }
            last_status, last_reason = status, str(exc)
            if retryable and attempt < fetcher.max_retries:
                delay = fetcher.backoff[min(attempt, len(fetcher.backoff) - 1)]
                entry["backoff_seconds"] = delay
                attempts.append(entry)
                time.sleep(delay)
                continue
            entry["terminal"] = True
            attempts.append(entry)
            return {"ok": False, "body": None, "record": None, "attempts": attempts,
                    "http_status": last_status, "reason": last_reason,
                    "retryable_exhausted": retryable}
        attempts.append({"attempt": attempt + 1, "outcome": "ok",
                         "http_status": record["http_status"]})
        return {"ok": True, "body": body, "record": record, "attempts": attempts,
                "http_status": record["http_status"], "reason": None,
                "retryable_exhausted": False}
    raise PersonAcquisitionError(f"retry loop fell through for {url!r}")  # unreachable


# ---------------------------------------------------------------------------
# Acquisition with terminal classification + resume (runbook §30.7)
# ---------------------------------------------------------------------------

def existing_state(person_dir: Path, entry: dict) -> tuple[str | None, dict | None]:
    """Terminal state already on disk, if any.  Nothing here is ever rewritten."""
    http_path = person_dir / entry["http_filename"]
    raw_path = person_dir / entry["raw_filename"]
    if not http_path.is_file():
        return None, None
    record = json.loads(http_path.read_bytes().decode("utf-8"))
    classification = record.get("terminal_classification")
    if classification == "fetched" and raw_path.is_file():
        return "fetched", record
    if classification == "failed":
        return "failed", record
    # An http record without its raw bytes is interrupted work, not a terminal state.
    return None, record


def pending_entries(person_dir: Path, entries: list[dict]) -> list[dict]:
    """Entries with no terminal classification yet -- the only ones a run may fetch."""
    return [entry for entry in entries if existing_state(person_dir, entry)[0] is None]


def recorded_robots_sha(person_dir: Path) -> str:
    """Reuse this snapshot's recorded robots.txt evidence.

    A run with nothing left to acquire fetches nothing at all -- there is no request to
    authorise -- so it reuses the evidence the acquiring run recorded rather than
    inventing a fresh one.  A snapshot that never fetched robots.txt cannot be completed.
    """
    path = person_dir / "http" / "robots_txt.json"
    if not path.is_file():
        raise PersonAcquisitionError(
            f"no robots.txt evidence recorded for this snapshot ({path}) -- the first "
            "acquisition run must fetch it before the snapshot can be completed")
    record = json.loads(path.read_bytes().decode("utf-8"))
    sha = record.get("sha256")
    if not sha:
        raise PersonAcquisitionError(f"{path} records no sha256 for robots.txt")
    return sha


def acquire_persons(contract: dict, fetcher: acquisition.Fetcher | None, person_dir: Path,
                    entries: list[dict]) -> dict:
    fetched: list[str] = []
    failed: list[dict] = []
    reused: dict[str, int] = {"fetched": 0, "failed": 0}

    for entry in entries:
        url = entry["player_url"]
        state, record = existing_state(person_dir, entry)
        if state == "fetched":
            reused["fetched"] += 1
            fetched.append(url)
            # Progress goes to stderr; stdout carries only the machine-readable summary.
            print(f"{entry['stem']}: already acquired (terminal), reusing", file=sys.stderr)
            continue
        if state == "failed":
            reused["failed"] += 1
            failed.append({"player_url": url, "http_status": record.get("http_status"),
                           "reason": record.get("reason"),
                           "terminal_classification": "failed"})
            print(f"{entry['stem']}: terminal failure on record, reusing (never silently "
                  "retried)", file=sys.stderr)
            continue

        if fetcher is None:                       # defensive: a no-fetch run must not fetch
            raise PersonAcquisitionError(
                f"{url} is not terminally classified but this run was started with nothing "
                "to acquire -- refusing to fetch outside the authorised path")
        outcome = fetch_with_evidence(fetcher, url)
        http_path = assert_inside_snapshot(person_dir / entry["http_filename"], person_dir)
        raw_path = assert_inside_snapshot(person_dir / entry["raw_filename"], person_dir)
        common = {
            "player_url": url,                       # exact identity, never the filename
            "slug": entry["slug"],
            "ordinal": entry["ordinal"],
            "primary_cohort": entry["primary_cohort"],
            "raw_filename": entry["raw_filename"],
            "attempts": outcome["attempts"],
            "retry_policy": {
                "max_retries": fetcher.max_retries,
                "backoff_seconds": fetcher.backoff,
                "retry_on": contract["http_policy"]["retry_on"],
                "min_delay_seconds": fetcher.min_delay,
                "timeout_seconds": fetcher.timeout,
            },
        }
        if outcome["ok"]:
            # Raw bytes first: a crash between the two writes leaves a NON-terminal
            # state that resumes, never a terminal record without its evidence.
            acquisition.atomic_write_bytes(raw_path, outcome["body"])
            record = dict(outcome["record"])
            record.update(common)
            record["terminal_classification"] = "fetched"
            acquisition.atomic_write_json(http_path, record)
            fetched.append(url)
            print(f"{entry['stem']}: {record['http_status']} {record['byte_size']} bytes",
                  file=sys.stderr)
        else:
            record = dict(common)
            record.update({
                "url": url,
                "final_url": None,
                "http_status": outcome["http_status"],
                "terminal_classification": "failed",
                "reason": outcome["reason"],
                "failed_at": acquisition.utc_now(),
                "$note": "terminal failure -- reused on resume, never silently retried or "
                         "reclassified; retrying requires an explicit decision",
            })
            acquisition.atomic_write_json(http_path, record)
            failed.append({"player_url": url, "http_status": outcome["http_status"],
                           "reason": outcome["reason"],
                           "terminal_classification": "failed"})
            print(f"{entry['stem']}: FAILED — {outcome['reason']}", file=sys.stderr)

    return {"fetched": fetched, "failed": failed, "reused": reused}


def write_persons_index(person_dir: Path, label: str, sample: dict,
                        entries: list[dict]) -> Path:
    """filename -> exact player_url, so a filename can never become identity."""
    path = assert_inside_snapshot(person_dir / "http" / "persons_index.json", person_dir)
    index = {
        "$comment": "AFLDB-ISSUE-093 Stage B1 filename -> player_url map. A stored "
                    "filename is NEVER identity; this file is the only bridge between "
                    "the two.",
        "snapshot_label": label,
        "sample_total": sample["counts"]["total"],
        "entries": [
            {
                "raw_filename": entry["raw_filename"],
                "http_filename": entry["http_filename"],
                "player_url": entry["player_url"],
                "slug": entry["slug"],
                "ordinal": entry["ordinal"],
                "primary_cohort": entry["primary_cohort"],
                "terminal_classification": existing_state(person_dir, entry)[0],
            }
            for entry in entries
        ],
    }
    acquisition.atomic_write_json(path, index)
    return path


# ---------------------------------------------------------------------------
# Manifest (runbook §30.6/§30.7) — written LAST, never by probe mode
# ---------------------------------------------------------------------------

def build_manifest(contract: dict, label: str, *, sample: dict,
                   sample_sha256: str, robots_sha: str, started_utc: str,
                   result: dict, outcome: dict, parsed_paths: dict) -> dict:
    person_stage = contract["person_stage"]
    summary = outcome["aggregate"]
    profile_path = parsed_paths["person_profile"]
    link_path = parsed_paths["afltables_link_profile"]
    profile_bytes = profile_path.read_bytes()
    link_bytes = link_path.read_bytes()

    return {
        "source": "DraftGuru (draftguru.com.au) person pages",
        "stage": "B1",
        "purpose": "PROFILING ONLY — measures whether a person page exposes a "
                   "deterministic player_url -> AFL Tables identity bridge. This snapshot "
                   "is never an import source.",
        "adapter": ADAPTER,
        "adapter_version": ADAPTER_VERSION,
        "adapter_schema_version": ADAPTER_SCHEMA_VERSION,
        "profiler": person_stage["profiler"],
        "profiler_version": person_profiler.PROFILER_VERSION,
        "snapshot_label": label,
        "mode": "acquire-persons",
        "extraction_date": started_utc[:10],
        "extraction_started_utc": started_utc,
        "extraction_completed_utc": acquisition.utc_now(),
        "base_url": contract["base_url"],
        "robots_txt_sha256": robots_sha,
        "working_directory": f"{person_stage['person_snapshot']['root']}/{label}",
        "identity_fields_present": ["player_url"],
        "identity_complete": False,
        "import_capable": False,
        "identity_rules": {
            "identity_field": "player_url",
            "byte_exact": True,
            "percent_encoding": "significant — never decoded for identity",
            "filename_is_identity": False,
            "filename_map": "http/persons_index.json",
            "never_identity": "any rendered name",
        },
        "sample_basis": {
            "sample_file": "sample.json",
            "sample_sha256": sample_sha256,
            "total": sample["counts"]["total"],
            "by_primary_cohort": sample["counts"]["by_primary_cohort"],
            "selection": sample["selection"]["control_ordering"],
            "residual_input_sha256": sample["residual_input"]["sha256"],
            "stage_a_label": sample["stage_a_source"]["label"],
            "stage_a_manifest_sha256": sample["stage_a_source"]["manifest_sha256"],
        },
        "person_pages": {
            "stage": "B1",
            "sample_basis": f"frozen {sample['counts']['total']}-person Stage B1 sample "
                            f"(sha256 {sample_sha256})",
            "requested": len(result["fetched"]) + len(result["failed"]),
            "fetched": len(result["fetched"]),
            "failed": result["failed"],
            "reused_on_resume": result["reused"],
            "completion_rule": "fetched + failed = requested, every identity terminally "
                               "classified; page failures are findings, not incompleteness",
        },
        "afltables_link_profile": summary,
        "parsed_outputs": {
            "person_profile": {
                "path": f"parsed/{profile_path.name}",
                "sha256": acquisition.sha256_hex(profile_bytes),
                "records": len(outcome["records"]),
            },
            "afltables_link_profile": {
                "path": f"parsed/{link_path.name}",
                "sha256": acquisition.sha256_hex(link_bytes),
            },
        },
        "immutable": True,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--label", required=True,
                        help="Stage B1 snapshot label, e.g. person-html-20260826")
    parser.add_argument("--sample", help="override the sample.json path")
    parser.add_argument("--snapshot-root", help="override the contract snapshot root")
    parser.add_argument("--manifest-dir", help="override the manifest directory")
    parser.add_argument("--probe", action="append", metavar="PLAYER_URL",
                        help="bounded probe of specific sampled player_url values; a probe "
                             "NEVER writes the accepted Stage B1 manifest (repeatable)")
    parser.add_argument("--plan", action="store_true",
                        help="print the deterministic acquisition plan and exit; no network")
    parser.add_argument("--no-fetch", action="store_true",
                        help="complete/verify only: never make a request. Fails closed (and "
                             "writes no manifest) if any requested identity is still "
                             "unclassified")
    args = parser.parse_args(argv)

    contract = snapshot_parser.load_contract()
    try:
        person_dir = sample_tool.resolve_person_snapshot_dir(
            contract, args.snapshot_root, args.label)

        manifest_dir = Path(args.manifest_dir) if args.manifest_dir \
            else REPO_ROOT / contract["person_stage"]["person_snapshot"]["manifest_dir"]
        manifest_path = manifest_dir / f"{args.label}.json"
        if manifest_path.exists():
            raise PersonAcquisitionError(
                f"manifest {manifest_path} already exists. Snapshots are immutable — "
                "reacquisition requires a new label; nothing was written and nothing "
                "was fetched")

        sample_path = Path(args.sample) if args.sample else (person_dir / "sample.json")
        sample = person_profiler.load_sample(contract, person_dir, sample_path)
        sample_sha256 = acquisition.sha256_hex(sample_path.read_bytes())
        entries = plan_entries(contract, sample)

        if args.probe:
            known = {entry["player_url"]: entry for entry in entries}
            unknown = [url for url in args.probe if url not in known]
            if unknown:
                raise PersonAcquisitionError(
                    f"probe targets are not in the frozen sample: {unknown} -- Stage B1 "
                    "acquires only sampled identities, byte-exactly")
            selected = [known[url] for url in args.probe]
        else:
            selected = entries

        if args.plan:
            print(json.dumps({
                "label": args.label,
                "mode": "plan",
                "ordering": "slug, then ordinal",
                "requested": len(selected),
                "manifest_written": False,
                "entries": selected,
            }, ensure_ascii=True, sort_keys=True, indent=2))
            return 0

        started_utc = acquisition.utc_now()
        person_dir.mkdir(parents=True, exist_ok=True)
        pending = pending_entries(person_dir, selected)
        if pending and args.no_fetch:
            raise PersonAcquisitionError(
                f"{len(pending)} of {len(selected)} requested identities carry no terminal "
                "classification and --no-fetch forbids acquiring them — the experiment is "
                "incomplete and NO manifest was written; artifacts are retained for resume")
        if pending:
            fetcher = acquisition.Fetcher(contract)
            # robots.txt fresh for this snapshot, with /players/* explicitly checked.
            robots_urls = [entry["player_url"] for entry in pending] \
                + [contract["base_url"] + "/players/"]
            robots_sha = acquisition.check_robots(contract, fetcher, person_dir, robots_urls)
        else:
            fetcher = None
            robots_sha = recorded_robots_sha(person_dir)
            print("all requested identities are already terminally classified — "
                  "nothing is fetched, nothing is rewritten", file=sys.stderr)

        result = acquire_persons(contract, fetcher, person_dir, selected)
        write_persons_index(person_dir, args.label, sample, entries)

        if args.probe:
            print(json.dumps({
                "label": args.label,
                "mode": "probe",
                "requested": [entry["player_url"] for entry in selected],
                "fetched": result["fetched"],
                "failed": result["failed"],
                "manifest_written": False,
                "note": "bounded probe — the accepted Stage B1 manifest is written only by a "
                        "complete run over the frozen sample, after profiling",
            }, ensure_ascii=True, sort_keys=True, indent=2))
            return 0

        requested = len(selected)
        terminal = len(result["fetched"]) + len(result["failed"])
        if terminal != requested:
            print(f"INCOMPLETE — {terminal} of {requested} identities carry a terminal "
                  "classification. No manifest was written; raw/http artifacts are retained "
                  "for resume.", file=sys.stderr)
            return 1

        outcome = person_profiler.run_profile(contract, person_dir, sample,
                                              require_complete=True, write=True)
        parsed_paths = outcome["paths"]
        for key, path in parsed_paths.items():
            if not path.is_file():
                raise PersonAcquisitionError(f"profiler did not produce {key}: {path}")

        manifest = build_manifest(
            contract, args.label, sample=sample, sample_sha256=sample_sha256,
            robots_sha=robots_sha, started_utc=started_utc, result=result,
            outcome=outcome, parsed_paths=parsed_paths)
        if manifest_path.exists():
            raise PersonAcquisitionError(
                f"manifest {manifest_path} appeared during the run — refusing to overwrite; "
                "snapshots are immutable")
        acquisition.atomic_write_json(manifest_path, manifest)

        print(json.dumps({
            "label": args.label,
            "mode": "acquire-persons",
            "requested": requested,
            "fetched": len(result["fetched"]),
            "failed": len(result["failed"]),
            "identity_complete": False,
            "import_capable": False,
            "manifest_written": True,
            "manifest": str(manifest_path),
        }, ensure_ascii=True, sort_keys=True, indent=2))
        return 0
    except (PersonAcquisitionError, acquisition.AcquisitionError,
            person_profiler.ProfileError, sample_tool.SampleError,
            snapshot_parser.ParseFailure) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
