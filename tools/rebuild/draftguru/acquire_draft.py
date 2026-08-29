#!/usr/bin/env python3
"""AFLDB-ISSUE-093 §13.5 — DraftGuru Stage A annual-page acquisition adapter.

Acquires the 42 server-rendered annual draft/trade pages (1981, 1982,
1986–2025; 1983–1985 are positive no-draft-held coverage gaps and are never
requested) into an immutable raw snapshot:

    data/sources/draftguru/<label>/raw/years/year_<YYYY>.html   exact response bytes
    data/sources/draftguru/<label>/http/years/year_<YYYY>.json  per-request record
    data/sources/draftguru/<label>/parsed/...                   via parse_draft_snapshot
    docs/rebuild-manifests/draftguru/<label>.json               written LAST, only on
                                                                complete validated success

Contract (issues/closed/AFLDB-ISSUE-093-DRAFTGURU-ACQUISITION-HANDOFF.md §1–§5, §11–§13):

  * ordinary, respectful, single-threaded retrieval: explicit identifying
    User-Agent, 20s timeout, max 3 retries with 2s/4s/8s backoff (retrying only
    timeouts, connection errors, HTTP 5xx and 429), a minimum 1.5s delay before
    every request including retries, deterministic ascending-year ordering;
  * robots.txt is fetched once, hashed into the manifest, and honoured — a
    disallow on the target paths stops the run entirely;
  * redirects are followed same-host only; a cross-host redirect is a failure;
  * raw response bytes are written in binary mode exactly as received;
    existing raw files are never re-fetched and never rewritten (resumability);
  * a snapshot is not complete if any required year fails: raw files are
    written as they arrive, the manifest is written LAST and only after the
    full parse + identity validation + CSV parity all pass. A directory with
    raw files and no manifest is the only state a partial run leaves behind;
  * an existing manifest label is immutable — the adapter aborts before any
    network activity and writes nothing;
  * no database connection of any kind, in any mode; the acquisition path
    performs no destructive operation anywhere — it only adds files under its
    own fresh snapshot label and never touches the frozen browser-export CSV
    artifact (label pattern enforcement makes that path unreachable).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
import urllib.robotparser
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

TOOL_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOL_DIR))
import parse_draft_snapshot as snapshot_parser  # noqa: E402

REPO_ROOT = TOOL_DIR.parents[2]
SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")


class AcquisitionError(Exception):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_hex(data: bytes) -> str:
    digest = hashlib.sha256(data).hexdigest()
    if not SHA256_HEX.match(digest):
        raise AcquisitionError(f"sha256 did not validate as 64-char lowercase hex: {digest!r}")
    return digest


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def atomic_write_json(path: Path, obj) -> None:
    payload = json.dumps(obj, ensure_ascii=True, sort_keys=True, indent=2) + "\n"
    atomic_write_bytes(path, payload.encode("utf-8"))


# ---------------------------------------------------------------------------
# HTTP (runbook §4)
# ---------------------------------------------------------------------------

class _SameHostRedirect(urllib.request.HTTPRedirectHandler):
    """Follow redirects on the source host only; anything else is a failure."""

    allowed_host: str = ""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        host = urlparse(newurl).netloc
        if host and host != self.allowed_host:
            raise AcquisitionError(f"cross-host redirect to {newurl!r} refused")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Fetcher:
    def __init__(self, contract: dict) -> None:
        policy = contract["http_policy"]
        self.user_agent = policy["user_agent"]
        self.timeout = policy["timeout_seconds"]
        self.max_retries = policy["max_retries"]
        self.backoff = list(policy["backoff_seconds"])
        self.min_delay = policy["min_delay_seconds"]
        self._last_request = 0.0
        redirect = _SameHostRedirect()
        redirect.allowed_host = urlparse(contract["base_url"]).netloc
        self.opener = urllib.request.build_opener(redirect)

    def _pace(self) -> None:
        elapsed = time.monotonic() - self._last_request
        if elapsed < self.min_delay:
            time.sleep(self.min_delay - elapsed)

    def _attempt(self, url: str) -> tuple[bytes, dict]:
        self._pace()
        self._last_request = time.monotonic()
        request = urllib.request.Request(url, headers={"User-Agent": self.user_agent})
        with self.opener.open(request, timeout=self.timeout) as response:
            body = response.read()
            headers = response.headers
            record = {
                "url": url,
                "final_url": response.geturl(),
                "http_status": response.status,
                "content_type": headers.get("Content-Type"),
                "content_length": headers.get("Content-Length"),
                "last_modified": headers.get("Last-Modified"),
                "etag": headers.get("ETag"),
                "fetched_at": utc_now(),
                "byte_size": len(body),
                "sha256": sha256_hex(body),
            }
        if len(body) == 0:
            raise AcquisitionError(f"zero-byte body from {url}")
        return body, record

    @staticmethod
    def _retryable(exc: Exception) -> bool:
        if isinstance(exc, urllib.error.HTTPError):
            return exc.code == 429 or 500 <= exc.code <= 599
        if isinstance(exc, AcquisitionError):
            return "zero-byte body" in str(exc)
        return isinstance(exc, (urllib.error.URLError, TimeoutError))

    def fetch(self, url: str) -> tuple[bytes, dict]:
        """One page: initial attempt plus up to max_retries retries, backing off
        2s/4s/8s, retrying only timeouts, connection errors, HTTP 5xx and 429."""
        last: Exception | None = None
        for attempt in range(1 + self.max_retries):
            try:
                return self._attempt(url)
            except Exception as exc:  # noqa: BLE001 — classified below
                last = exc
                if not self._retryable(exc) or attempt == self.max_retries:
                    break
                time.sleep(self.backoff[min(attempt, len(self.backoff) - 1)])
        raise AcquisitionError(f"failed to fetch {url}: {last}")


# ---------------------------------------------------------------------------
# robots.txt (runbook §4)
# ---------------------------------------------------------------------------

def check_robots(contract: dict, fetcher: Fetcher, snapshot_dir: Path,
                 year_urls: list[str]) -> str:
    robots_url = contract["base_url"] + "/robots.txt"
    try:
        body, record = fetcher.fetch(robots_url)
    except AcquisitionError as exc:
        if "HTTP Error 404" in str(exc):
            # No robots.txt means no restrictions; record the absence honestly.
            body = b""
            record = {"url": robots_url, "http_status": 404, "fetched_at": utc_now(),
                      "byte_size": 0, "sha256": sha256_hex(b""),
                      "note": "robots.txt absent (404) -- no restrictions declared"}
        else:
            raise AcquisitionError(
                f"robots.txt could not be fetched -- stopping: {exc}") from exc
    atomic_write_bytes(snapshot_dir / "http" / "robots.txt", body)
    atomic_write_json(snapshot_dir / "http" / "robots_txt.json", record)
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(body.decode("utf-8", errors="replace").splitlines())
    blocked = [u for u in year_urls if not rp.can_fetch(fetcher.user_agent, u)]
    if blocked:
        raise AcquisitionError(
            "robots.txt disallows the target paths — stopping and reporting, not "
            f"working around it: {blocked}")
    return record["sha256"]


# ---------------------------------------------------------------------------
# Stage A acquisition
# ---------------------------------------------------------------------------

def acquire_years(contract: dict, fetcher: Fetcher, snapshot_dir: Path,
                  years: list[int]) -> tuple[list[int], list[tuple[int, str]]]:
    """Deterministic ascending-year acquisition with resume semantics: a year
    whose raw file AND http record already exist is skipped, never re-fetched
    and never rewritten."""
    fetched, failed = [], []
    for year in sorted(years):
        raw_path = snapshot_dir / "raw" / "years" / f"year_{year}.html"
        http_path = snapshot_dir / "http" / "years" / f"year_{year}.json"
        if raw_path.is_file() and http_path.is_file():
            print(f"year {year}: already acquired, skipping")
            continue
        url = snapshot_parser.build_year_url(contract, year)
        try:
            body, record = fetcher.fetch(url)
        except AcquisitionError as exc:
            print(f"year {year}: FAILED — {exc}", file=sys.stderr)
            failed.append((year, str(exc)))
            continue
        atomic_write_bytes(raw_path, body)
        record["raw_filename"] = f"raw/years/year_{year}.html"
        atomic_write_json(http_path, record)
        fetched.append(year)
        print(f"year {year}: {record['http_status']} {record['byte_size']} bytes")
    return fetched, failed


# ---------------------------------------------------------------------------
# Manifest (runbook §11) — written LAST, only on complete validated success
# ---------------------------------------------------------------------------

def build_manifest(contract: dict, label: str, snapshot_dir: Path, robots_sha: str,
                   started_utc: str, result: dict, identity_report: dict,
                   parity_report: dict, trade_profile: dict) -> dict:
    source_urls = []
    for year in sorted(result["rows_by_year"]):
        with open(snapshot_dir / "http" / "years" / f"year_{year}.json",
                  "r", encoding="utf-8") as fh:
            record = json.load(fh)
        info = result["schema_by_year"][year]
        source_urls.append({
            "year": year,
            "url": record["url"],
            "final_url": record["final_url"],
            "http_status": record["http_status"],
            "fetched_at": record["fetched_at"],
            "raw_filename": record["raw_filename"],
            "byte_size": record["byte_size"],
            "sha256": record["sha256"],
            "content_type": record["content_type"],
            "parsed_row_count": info["row_count"],
            "schema_fingerprint": info["fingerprint"],
        })

    variants: dict[str, dict] = {}
    for year in sorted(result["schema_by_year"]):
        info = result["schema_by_year"][year]
        variant = variants.setdefault(info["fingerprint"], {
            "fingerprint": info["fingerprint"],
            "columns": info["header"],
            "years": [],
        })
        variant["years"].append(year)

    return {
        "source": "DraftGuru (draftguru.com.au) annual draft/trade pages",
        "adapter": contract["adapter"],
        "adapter_version": contract["adapter_version"],
        "adapter_schema_version": contract["adapter_schema_version"],
        "parser_contract_version": contract["parser_contract_version"],
        "snapshot_label": label,
        "mode": "acquire",
        "extraction_date": started_utc[:10],
        "extraction_started_utc": started_utc,
        "extraction_completed_utc": utc_now(),
        "base_url": contract["base_url"],
        "robots_txt_sha256": robots_sha,
        "requested_range": {"from": min(contract["expected_years"]),
                            "to": max(contract["expected_years"])},
        "expected_years": contract["expected_years"],
        "known_coverage_gaps": contract["known_coverage_gaps"],
        "working_directory": f"{contract['snapshot']['root']}/{label}",
        "source_urls": source_urls,
        "schema_variants": [variants[k] for k in sorted(variants)],
        "total_rows": result["total_rows"],
        "distinct_player_url_count": result["distinct_person_count"],
        "identity_fields_present": ["player_url", "club_href"],
        "identity_complete": True,
        "import_capable": True,
        "identity_validation": identity_report,
        "parity": {
            "status": parity_report["status"],
            "compared_years": parity_report["compared_years"],
            "documented_exceptions": parity_report["documented_exceptions"],
            "mojibake_repairs_applied": parity_report["mojibake_repairs_applied"],
            "corpus_checks": parity_report["corpus_checks"],
        },
        "person_pages": {"stage": "A", "requested": 0, "fetched": 0, "failed": [],
                         "sample_basis": "Stage B1 not executed in this acquisition"},
        "afltables_link_profile": {"status": "not measured — Stage A acquires annual pages only"},
        "trade_column_profile": trade_profile,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--label", required=True,
                        help="snapshot label, e.g. annual-html-20260827")
    parser.add_argument("--years",
                        help="comma-separated subset for a bounded probe; a subset run "
                             "NEVER writes a manifest")
    parser.add_argument("--snapshot-root",
                        help="override the snapshot root (default: data/sources/draftguru)")
    parser.add_argument("--manifest-dir",
                        help="override the manifest directory "
                             "(default: docs/rebuild-manifests/draftguru)")
    parser.add_argument("--accept-baseline-drift", action="store_true",
                        help="explicitly accept an investigated drift from the 6,810-row / "
                             "5,057-person baseline (recorded in the manifest)")
    args = parser.parse_args(argv)

    contract = snapshot_parser.load_contract()
    try:
        if not re.match(contract["snapshot"]["label_pattern"], args.label):
            raise AcquisitionError(
                f"label {args.label!r} does not match the required pattern "
                f"{contract['snapshot']['label_pattern']} — this also keeps the frozen "
                "browser-export CSV artifact unreachable")

        manifest_dir = Path(args.manifest_dir) if args.manifest_dir \
            else REPO_ROOT / contract["snapshot"]["manifest_dir"]
        manifest_path = manifest_dir / f"{args.label}.json"
        if manifest_path.exists():
            raise AcquisitionError(
                f"manifest {manifest_path} already exists. Snapshots are immutable — "
                "reacquisition requires a new label; nothing was written and nothing "
                "was fetched")

        snapshot_root = Path(args.snapshot_root) if args.snapshot_root \
            else REPO_ROOT / contract["snapshot"]["root"]
        snapshot_dir = snapshot_root / args.label

        expected_years = list(contract["expected_years"])
        gap_years = {gap["year"] for gap in contract["known_coverage_gaps"]}
        if args.years:
            years = sorted({int(y) for y in args.years.split(",")})
            bad = [y for y in years if y not in expected_years]
            if bad:
                blocked_gaps = sorted(set(bad) & gap_years)
                if blocked_gaps:
                    raise AcquisitionError(
                        f"years {blocked_gaps} are intentional coverage gaps (no draft "
                        "held) and must never be requested")
                raise AcquisitionError(f"years {bad} are outside the expected 42-year set")
            partial = True
        else:
            years = expected_years
            partial = False

        started_utc = utc_now()
        fetcher = Fetcher(contract)
        year_urls = [snapshot_parser.build_year_url(contract, y) for y in years]
        snapshot_dir.mkdir(parents=True, exist_ok=True)
        robots_sha = check_robots(contract, fetcher, snapshot_dir, year_urls)

        fetched, failed = acquire_years(contract, fetcher, snapshot_dir, years)
        if failed:
            print("ACQUISITION FAILED — a snapshot is not complete if any required year "
                  "fails. No manifest was written; successful raw files are retained "
                  "for resume:", file=sys.stderr)
            for year, reason in failed:
                print(f"  year {year}: {reason}", file=sys.stderr)
            return 1

        if partial:
            print(json.dumps({
                "label": args.label,
                "mode": "partial-probe",
                "years_requested": years,
                "years_fetched_now": fetched,
                "manifest_written": False,
                "note": "partial/probe acquisition — the manifest is written only by a "
                        "complete validated 42-year run",
            }, ensure_ascii=True, sort_keys=True))
            return 0

        # Complete Stage A: parse, validate identity, profile Trade, run CSV
        # parity — the manifest is written LAST and only if every gate passes.
        result = snapshot_parser.parse_snapshot(contract, snapshot_dir,
                                                require_complete=True)
        identity_report = snapshot_parser.validate_identity(
            contract, result, require_complete=True,
            accept_baseline_drift=args.accept_baseline_drift)
        trade_profile = snapshot_parser.build_trade_profile(result)
        snapshot_parser.write_parsed(snapshot_dir, result, trade_profile)
        parity_report = snapshot_parser.run_parity(
            contract, result,
            REPO_ROOT / contract["csv_artifact"]["path"],
            require_complete=True)

        manifest = build_manifest(contract, args.label, snapshot_dir, robots_sha,
                                  started_utc, result, identity_report,
                                  parity_report, trade_profile)
        if manifest_path.exists():
            raise AcquisitionError(
                f"manifest {manifest_path} appeared during the run. Snapshots are "
                "immutable — refusing to overwrite")
        atomic_write_json(manifest_path, manifest)
        print(json.dumps({
            "label": args.label,
            "mode": "acquire",
            "total_rows": result["total_rows"],
            "distinct_player_url_count": result["distinct_person_count"],
            "parity": parity_report["status"],
            "manifest": str(manifest_path),
            "manifest_written": True,
        }, ensure_ascii=True, sort_keys=True))
        return 0
    except (AcquisitionError, snapshot_parser.ParseFailure) as exc:
        print(f"ACQUISITION FAILURE: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
