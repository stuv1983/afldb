#!/usr/bin/env python3
"""Acquire Gridley boards into an immutable on-disk snapshot - ISSUE-118 Stage 2.

    python tools/migration/acquire_gridley_boards.py --days 14
    python tools/migration/acquire_gridley_boards.py --all --max-requests 400
    python tools/migration/acquire_gridley_boards.py --all --dry-run
    python tools/migration/acquire_gridley_boards.py --from 2023-07-17 --to 2023-08-16

Fetches ``https://gridleygame.com/data/grids/YYYY-MM-DD.json`` and writes the
exact response bytes under ``data/sources/gridley/<label>/``. It never contacts
PostgreSQL, in any mode. ``import_gridley_boards.py`` is the other half: it
reads this snapshot and lands it in ``external_grids`` (migration 080).

Why the network and the database are two tools
----------------------------------------------
A backfill of ~1,150 boards is a long, interruptible, externally dependent run.
If it wrote straight to PostgreSQL, a connection dropped at board 700 would
leave a half-loaded corpus whose completeness nobody could establish
afterwards, and every re-run would re-request boards already captured. Split in
two, the properties fall out for free:

* a network failure can only ever leave FILES on disk - a partially acquired
  snapshot, which is a visible, resumable state that cannot corrupt anything
  already persisted;
* the import is deterministic, offline and replayable from bytes captured once,
  so a parsing change never means re-hitting the source;
* the snapshot is the forensic record. Parsed columns are a reading of it.

This is the shape ``tools/rebuild/draftguru/acquire_draft.py`` already uses for
the same reasons, and this file follows its HTTP policy deliberately rather
than inventing a second one.

Snapshot layout
---------------
::

    data/sources/gridley/<label>/
      raw/<YYYY-MM-DD>__<sha16>.json    exact response bytes, immutable
      http/<YYYY-MM-DD>__<sha16>.json   the request record for those bytes
      rejected/<YYYY-MM-DD>__<ts>.json  a response that did not validate
      runs/<UTC-timestamp>.json         what one run did, board by board

A capture is named by its own content, not by its date alone. That is what
makes the store immutable rather than merely intended to be: re-fetching a date
whose bytes are unchanged resolves to a filename that already exists and is
skipped, and re-fetching a date whose bytes have CHANGED writes a NEW file
beside the first. No path in this file can overwrite an existing capture, so
the anti-pattern ISSUE-118 section 6.1 records - the legacy scraper's in-place
UPDATE silently destroying an earlier capture - is unreachable here.

Outcomes are named, never collapsed (ISSUE-118 section 13)
-----------------------------------------------------------
``saved``, ``revised``, ``unchanged``, ``skipped``, ``unavailable`` (a clean
404), ``http_error``, ``network_error``, ``malformed_json``, ``shape_invalid``.
The legacy scraper's worst flaw was reporting all of these as "unavailable";
the four failure outcomes set a non-zero exit status, and ``--require-complete``
promotes ``unavailable`` to a failure too, for a backfill that must be whole.

A response that does not validate is written to ``rejected/`` with its body and
the reason, and is NOT written to ``raw/``. It is therefore never visible to
the importer, and the next run retries that date rather than treating a bad
capture as a permanent one.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
import urllib.robotparser
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Sequence
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parents[2]

# ---------------------------------------------------------------------------
# Source contract
# ---------------------------------------------------------------------------

DEFAULT_BASE_URL = "https://gridleygame.com"
PATH_TEMPLATE = "/data/grids/{board_date}.json"

FIRST_BOARD_DATE = date(2023, 7, 17)
"""Gridley board #1. Still served on 2026-08-31 (ISSUE-118 section 6.2.1)."""

BOARD_NUMBER_ANCHOR = date(2023, 7, 16)
"""``level = (board_date - anchor).days``.

Holds across all 1,123 rescued boards and all 21 boards of the Stage 0 live
probe. This is an OBSERVATION about the publisher, and it is used here for
exactly one thing: proving the response is the board that was asked for. The
endpoint is keyed by date and the payload carries no date of its own, so
without this check a server that answered every URL with today's board would
fill the snapshot with 1,123 copies of one board and nothing would say so.
``--allow-level-drift`` records the mismatch and keeps the capture, for the day
the publisher legitimately changes the relationship."""

DEFAULT_SNAPSHOT_ROOT = REPO_ROOT / "data" / "sources" / "gridley"
DEFAULT_LABEL = "history"
SNAPSHOT_ENV = "AFLDB_GRIDLEY_SNAPSHOT"

# HTTP policy. Deliberately the same numbers as
# tools/rebuild/draftguru/draftguru-contract.json: one acquisition manner for
# the whole repository, and both are ordinary single-threaded retrieval.
USER_AGENT = ("AFLDB-corpus/1.0 (AFLDB Grid Solver compatibility corpus; "
              "contact: stuart.villanti@gmail.com)")
TIMEOUT_SECONDS = 20
MAX_RETRIES = 3
BACKOFF_SECONDS = (2.0, 4.0, 8.0)
MIN_DELAY_SECONDS = 1.5
DEFAULT_MAX_REQUESTS = 200
"""A default bound, not a limit of the tool.

The full history is ~1,150 requests; at the minimum delay that is roughly half
an hour of continuous traffic to a small site. Defaulting to a bound makes the
careless invocation the polite one, the run prints exactly how many dates
remain, and completing the backfill becomes a deliberate, repeated act. ``0``
removes the bound."""

# Outcome vocabulary - see the module docstring.
SAVED = "saved"
REVISED = "revised"
UNCHANGED = "unchanged"
SKIPPED = "skipped"
UNAVAILABLE = "unavailable"
HTTP_ERROR = "http_error"
NETWORK_ERROR = "network_error"
MALFORMED_JSON = "malformed_json"
SHAPE_INVALID = "shape_invalid"

OUTCOMES = (SAVED, REVISED, UNCHANGED, SKIPPED, UNAVAILABLE,
            HTTP_ERROR, NETWORK_ERROR, MALFORMED_JSON, SHAPE_INVALID)
FAILURE_OUTCOMES = frozenset({HTTP_ERROR, NETWORK_ERROR, MALFORMED_JSON, SHAPE_INVALID})

AXIS_KEYS = ("vItems", "hItems")
AXIS_LENGTH = 3
"""A Gridley board is 3x3. Not a default, not a maximum: the shape."""


class AcquisitionError(RuntimeError):
    """The run cannot continue. Distinct from a per-date outcome."""


class PayloadRejected(RuntimeError):
    """One response is not a board. Carries the named reason."""

    def __init__(self, outcome: str, detail: str) -> None:
        super().__init__(detail)
        self.outcome = outcome
        self.detail = detail


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_new_bytes(path: Path, data: bytes) -> None:
    """Write a file that must not already exist.

    ``x`` mode, not ``w``: an existing capture is never overwritten, and the
    refusal is enforced by the filesystem rather than by a prior check that a
    later edit could quietly remove.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "xb") as handle:
        handle.write(data)


def write_new_json(path: Path, obj: Any) -> None:
    payload = json.dumps(obj, ensure_ascii=True, sort_keys=True, indent=2) + "\n"
    write_new_bytes(path, payload.encode("utf-8"))


def capture_stem(board_date: date, body_sha256: str) -> str:
    return f"{board_date.isoformat()}__{body_sha256[:16]}"


def expected_board_number(board_date: date) -> int:
    return (board_date - BOARD_NUMBER_ANCHOR).days


# ---------------------------------------------------------------------------
# Payload validation
# ---------------------------------------------------------------------------


def validate_payload(body: bytes, board_date: date, allow_level_drift: bool) -> dict[str, Any]:
    """Return the parsed board, or raise ``PayloadRejected`` naming the fault.

    Nothing here repairs anything. There is no trimming, no defaulting and no
    "close enough": a response either is a Gridley board for the requested date
    or it is refused and kept as evidence under ``rejected/``. A malformed
    response that quietly became a valid board is the one failure this corpus
    could not recover from, because afterwards nothing can tell a rescued board
    from an invented one.
    """
    if not body:
        raise PayloadRejected(MALFORMED_JSON, "empty response body")
    try:
        payload = json.loads(body.decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise PayloadRejected(MALFORMED_JSON, f"body is not UTF-8: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise PayloadRejected(MALFORMED_JSON, f"body is not JSON: {exc}") from exc

    if not isinstance(payload, dict):
        raise PayloadRejected(SHAPE_INVALID,
                              f"top level is {type(payload).__name__}, expected an object")

    level = payload.get("level")
    if isinstance(level, bool) or not isinstance(level, int):
        raise PayloadRejected(SHAPE_INVALID,
                              f"level is {level!r}, expected an integer board number")
    if level < 1:
        raise PayloadRejected(SHAPE_INVALID, f"level is {level}, expected >= 1")

    expected = expected_board_number(board_date)
    if level != expected and not allow_level_drift:
        raise PayloadRejected(
            SHAPE_INVALID,
            f"level {level} is not the board for {board_date.isoformat()} "
            f"(expected #{expected}). The endpoint answered with a different "
            "board than the one requested; pass --allow-level-drift only if the "
            "publisher genuinely changed the number/date relationship.",
        )

    for key in AXIS_KEYS:
        items = payload.get(key)
        if not isinstance(items, list):
            raise PayloadRejected(SHAPE_INVALID,
                                  f"{key} is {type(items).__name__}, expected a list")
        if len(items) != AXIS_LENGTH:
            raise PayloadRejected(SHAPE_INVALID,
                                  f"{key} has {len(items)} item(s), expected {AXIS_LENGTH}")
        for position, item in enumerate(items):
            if not isinstance(item, dict):
                raise PayloadRejected(
                    SHAPE_INVALID,
                    f"{key}[{position}] is {type(item).__name__}, expected an object")
            item_id = item.get("id")
            if not isinstance(item_id, str) or not item_id.strip():
                raise PayloadRejected(
                    SHAPE_INVALID,
                    f"{key}[{position}].id is {item_id!r}; the stable criterion key "
                    "is the whole reason this source is richer than the rescued "
                    "archive, so a board without one is not usable")
            title = item.get("title")
            if title is not None and not isinstance(title, str):
                raise PayloadRejected(
                    SHAPE_INVALID,
                    f"{key}[{position}].title is {type(title).__name__}, expected a string")

    answers = payload.get("correctAnswersPlayerMap")
    if answers is not None:
        # Optional because the corpus must not depend on an undocumented field
        # continuing to be served. Present and misshapen is a different thing
        # from absent, and only the first is a rejection.
        if not isinstance(answers, list) or len(answers) != AXIS_LENGTH:
            raise PayloadRejected(
                SHAPE_INVALID, "correctAnswersPlayerMap is present but is not a 3-row array")
        for row_index, row in enumerate(answers):
            if not isinstance(row, list) or len(row) != AXIS_LENGTH:
                raise PayloadRejected(
                    SHAPE_INVALID,
                    f"correctAnswersPlayerMap[{row_index}] is not a 3-cell array")
            for col_index, cell in enumerate(row):
                if not isinstance(cell, dict):
                    raise PayloadRejected(
                        SHAPE_INVALID,
                        f"correctAnswersPlayerMap[{row_index}][{col_index}] is "
                        f"{type(cell).__name__}, expected an object")
    return payload


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


class _SameHostRedirect(urllib.request.HTTPRedirectHandler):
    """Follow redirects on the source host only; anything else is a failure."""

    allowed_host: str = ""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        host = urlparse(newurl).netloc
        if host and host != self.allowed_host:
            raise AcquisitionError(f"cross-host redirect to {newurl!r} refused")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


@dataclass
class Fetcher:
    """Single-threaded, paced, politely identified retrieval.

    Retries only what a retry can fix - a timeout, a dropped connection, a 5xx
    or a 429. A 404 is a clean answer and is never retried: hammering a source
    that has already said "no" is the behaviour this policy exists to prevent.
    """

    base_url: str
    delay: float = MIN_DELAY_SECONDS
    timeout: float = TIMEOUT_SECONDS
    max_retries: int = MAX_RETRIES
    user_agent: str = USER_AGENT
    requests_made: int = field(default=0, init=False)
    _last_request: float = field(default=0.0, init=False)

    def __post_init__(self) -> None:
        redirect = _SameHostRedirect()
        redirect.allowed_host = urlparse(self.base_url).netloc
        self._opener = urllib.request.build_opener(redirect)

    def url_for(self, board_date: date) -> str:
        return self.base_url.rstrip("/") + PATH_TEMPLATE.format(board_date=board_date.isoformat())

    def _pace(self) -> None:
        elapsed = time.monotonic() - self._last_request
        if self.requests_made and elapsed < self.delay:
            time.sleep(self.delay - elapsed)

    def _attempt(self, url: str) -> tuple[bytes, dict[str, Any]]:
        self._pace()
        self._last_request = time.monotonic()
        self.requests_made += 1
        request = urllib.request.Request(
            url, headers={"User-Agent": self.user_agent, "Accept": "application/json"})
        with self._opener.open(request, timeout=self.timeout) as response:
            body = response.read()
            headers = response.headers
            record = {
                "url": url,
                "final_url": response.geturl(),
                "http_status": response.status,
                "content_type": headers.get("Content-Type"),
                "last_modified": headers.get("Last-Modified"),
                "etag": headers.get("ETag"),
                "fetched_at": utc_now(),
                "byte_size": len(body),
                "body_sha256": sha256_hex(body),
            }
        return body, record

    @staticmethod
    def _retryable(exc: BaseException) -> bool:
        if isinstance(exc, urllib.error.HTTPError):
            return exc.code == 429 or 500 <= exc.code <= 599
        if isinstance(exc, AcquisitionError):
            return False
        return isinstance(exc, (urllib.error.URLError, TimeoutError, OSError))

    def fetch(self, url: str) -> tuple[bytes, dict[str, Any]]:
        last: BaseException | None = None
        for attempt in range(1 + self.max_retries):
            try:
                return self._attempt(url)
            except Exception as exc:  # noqa: BLE001 - classified immediately below
                last = exc
                if not self._retryable(exc) or attempt == self.max_retries:
                    break
                time.sleep(BACKOFF_SECONDS[min(attempt, len(BACKOFF_SECONDS) - 1)])
        assert last is not None
        raise last


def check_robots(fetcher: Fetcher, snapshot: Path, urls: Sequence[str]) -> dict[str, Any]:
    """Fetch robots.txt once, record it, and honour it.

    A disallow stops the run. There is no flag to override it: a source that
    has asked not to be crawled is answered by not crawling it, and the right
    response to that finding is a conversation with the publisher, not a
    command-line argument.
    """
    robots_url = fetcher.base_url.rstrip("/") + "/robots.txt"
    try:
        body, record = fetcher.fetch(robots_url)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            body = b""
            record = {"url": robots_url, "http_status": 404, "fetched_at": utc_now(),
                      "byte_size": 0, "body_sha256": sha256_hex(b""),
                      "note": "robots.txt absent (404) - no restrictions declared"}
        else:
            raise AcquisitionError(
                f"robots.txt could not be fetched (HTTP {exc.code}) - stopping "
                "rather than guessing at the policy") from exc
    except Exception as exc:  # noqa: BLE001 - any transport failure is fatal here
        raise AcquisitionError(
            f"robots.txt could not be fetched - stopping rather than guessing "
            f"at the policy: {type(exc).__name__}: {exc}") from exc

    parser = urllib.robotparser.RobotFileParser()
    parser.parse(body.decode("utf-8", errors="replace").splitlines())
    blocked = [url for url in urls if not parser.can_fetch(fetcher.user_agent, url)]
    record["blocked_sample"] = blocked[:5]
    stem = f"robots__{record['body_sha256'][:16]}"
    for path, payload in ((snapshot / "http" / f"{stem}.txt", body),):
        if not path.exists():
            write_new_bytes(path, payload)
    path = snapshot / "http" / f"{stem}.json"
    if not path.exists():
        write_new_json(path, record)
    if blocked:
        raise AcquisitionError(
            "robots.txt disallows the board endpoint - stopping and reporting, "
            f"not working around it: {blocked[:3]}")
    return record


# ---------------------------------------------------------------------------
# Snapshot
# ---------------------------------------------------------------------------


def resolve_snapshot(root: str | None, label: str) -> Path:
    base = Path(root) if root else Path(os.environ.get(SNAPSHOT_ENV) or DEFAULT_SNAPSHOT_ROOT)
    return base / label


def existing_captures(snapshot: Path) -> tuple[dict[str, set[str]], list[str]]:
    """board date -> the ``sha16`` of every COMPLETE capture already on disk.

    Read once per run from the filenames themselves, so resumability needs no
    index file that could disagree with the bytes it describes.

    A capture counts as held only when its raw bytes AND its request record are
    both present. A run killed between the two writes leaves raw bytes with no
    record - a capture that cannot say when it was fetched, which the importer
    refuses. Treating that as held would skip the date forever and reject it
    forever; treating it as absent means the next run re-requests it and
    completes the record. Incomplete captures are returned separately so the
    run says out loud that it found one.
    """
    found: dict[str, set[str]] = {}
    incomplete: list[str] = []
    raw_dir = snapshot / "raw"
    if not raw_dir.is_dir():
        return found, incomplete
    for path in sorted(raw_dir.glob("*__*.json")):
        stem = path.stem
        board_date, _, sha16 = stem.partition("__")
        if not board_date or not sha16:
            continue
        if not (snapshot / "http" / path.name).is_file():
            incomplete.append(path.name)
            continue
        found.setdefault(board_date, set()).add(sha16)
    return found, incomplete


# ---------------------------------------------------------------------------
# Date selection
# ---------------------------------------------------------------------------


def parse_iso_date(value: str, flag: str) -> date:
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise AcquisitionError(f"{flag} expects YYYY-MM-DD, got {value!r}") from exc
    if value != parsed.isoformat():
        raise AcquisitionError(f"{flag} expects extended ISO YYYY-MM-DD, got {value!r}")
    return parsed


def select_dates(args: argparse.Namespace) -> list[date]:
    """The dates this run will consider, ascending and deduplicated."""
    today = date.today()
    to_date = parse_iso_date(args.to_date, "--to") if args.to_date else today

    if args.dates:
        chosen = {parse_iso_date(value, "--date") for value in args.dates}
    elif args.all:
        chosen = _span(FIRST_BOARD_DATE, to_date)
    elif args.days is not None:
        if args.days < 1:
            raise AcquisitionError("--days must be at least 1")
        chosen = _span(to_date - timedelta(days=args.days - 1), to_date)
    elif args.from_date:
        chosen = _span(parse_iso_date(args.from_date, "--from"), to_date)
    else:
        raise AcquisitionError(
            "choose what to acquire: --days N (rolling window), --from/--to, "
            "--date YYYY-MM-DD, or --all for the whole history")

    early = sorted(d for d in chosen if d < FIRST_BOARD_DATE)
    if early:
        raise AcquisitionError(
            f"{early[0].isoformat()} is before Gridley board #1 "
            f"({FIRST_BOARD_DATE.isoformat()}); there is no board to acquire")
    return sorted(chosen)


def _span(start: date, end: date) -> set[date]:
    if start > end:
        raise AcquisitionError(
            f"empty range: {start.isoformat()} is after {end.isoformat()}")
    return {start + timedelta(days=offset) for offset in range((end - start).days + 1)}


# ---------------------------------------------------------------------------
# Acquisition
# ---------------------------------------------------------------------------


@dataclass
class RunReport:
    outcomes: dict[str, list[str]] = field(
        default_factory=lambda: {name: [] for name in OUTCOMES})
    details: list[dict[str, Any]] = field(default_factory=list)
    not_attempted: list[str] = field(default_factory=list)

    def record(self, board_date: date, outcome: str, **extra: Any) -> None:
        self.outcomes[outcome].append(board_date.isoformat())
        self.details.append({"board_date": board_date.isoformat(),
                             "outcome": outcome, **extra})

    def count(self, outcome: str) -> int:
        return len(self.outcomes[outcome])

    @property
    def failures(self) -> int:
        return sum(self.count(name) for name in FAILURE_OUTCOMES)


def acquire_one(fetcher: Fetcher, snapshot: Path, board_date: date,
                known: set[str], allow_level_drift: bool,
                report: RunReport) -> None:
    """Fetch and persist one board. Every exit path names its outcome."""
    url = fetcher.url_for(board_date)
    try:
        body, record = fetcher.fetch(url)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            report.record(board_date, UNAVAILABLE, http_status=404, url=url)
            return
        report.record(board_date, HTTP_ERROR, http_status=exc.code, url=url,
                      detail=f"HTTP {exc.code} {exc.reason}")
        return
    except AcquisitionError as exc:
        report.record(board_date, NETWORK_ERROR, url=url, detail=str(exc))
        return
    except Exception as exc:  # noqa: BLE001 - transport failures are an outcome
        report.record(board_date, NETWORK_ERROR, url=url,
                      detail=f"{type(exc).__name__}: {exc}")
        return

    record["board_date"] = board_date.isoformat()
    body_sha = record["body_sha256"]

    try:
        payload = validate_payload(body, board_date, allow_level_drift)
    except PayloadRejected as exc:
        rejection = dict(record)
        rejection["rejected_because"] = exc.outcome
        rejection["detail"] = exc.detail
        # The body is kept: a response that failed to validate is evidence
        # about the source, and discarding it would leave only an assertion
        # that something was wrong. It is kept OUT of raw/, so the importer
        # never sees it and the next run retries the date.
        rejection["body"] = body.decode("utf-8", errors="replace")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        write_new_json(snapshot / "rejected" / f"{board_date.isoformat()}__{stamp}.json",
                       rejection)
        report.record(board_date, exc.outcome, url=url, detail=exc.detail,
                      body_sha256=body_sha)
        return

    record["level"] = payload["level"]
    record["expected_level"] = expected_board_number(board_date)
    stem = capture_stem(board_date, body_sha)
    raw_path = snapshot / "raw" / f"{stem}.json"
    http_path = snapshot / "http" / f"{stem}.json"

    if raw_path.exists():
        # Identical bytes resolve to the same filename. Nothing is rewritten:
        # this is the no-op that makes a re-run safe.
        #
        # A raw file with no request record beside it is the one state a run
        # killed mid-write can leave. The record is completed here rather than
        # left missing, because the importer refuses a capture that cannot say
        # when it was fetched - so without this the date would be permanently
        # skipped by acquisition and permanently rejected by import.
        if not http_path.exists():
            record["raw_filename"] = f"raw/{stem}.json"
            record["capture"] = "record_completed"
            write_new_json(http_path, record)
        report.record(board_date, UNCHANGED, url=url, body_sha256=body_sha,
                      level=payload["level"])
        return

    outcome = REVISED if known else SAVED
    record["raw_filename"] = f"raw/{stem}.json"
    record["capture"] = outcome
    if outcome == REVISED:
        record["supersedes"] = sorted(known)
    write_new_bytes(raw_path, body)
    write_new_json(http_path, record)
    report.record(board_date, outcome, url=url, body_sha256=body_sha,
                  level=payload["level"], bytes=len(body))


def acquire(fetcher: Fetcher, snapshot: Path, dates: Sequence[date],
            args: argparse.Namespace) -> RunReport:
    report = RunReport()
    on_disk, _ = existing_captures(snapshot)
    budget = args.max_requests if args.max_requests else None
    attempted = 0

    for board_date in dates:
        key = board_date.isoformat()
        known = on_disk.get(key, set())
        if known and not args.refresh:
            report.record(board_date, SKIPPED, captures=len(known))
            continue
        if budget is not None and attempted >= budget:
            report.not_attempted.append(key)
            continue
        attempted += 1
        acquire_one(fetcher, snapshot, board_date, known, args.allow_level_drift, report)
    return report


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def _sample(values: Sequence[Any], limit: int = 8) -> str:
    shown = ", ".join(str(value) for value in values[:limit])
    return shown + (f" (+{len(values) - limit} more)" if len(values) > limit else "")


def print_report(report: RunReport, dates: Sequence[date], snapshot: Path,
                 requests_made: int) -> None:
    print("\nOutcomes")
    for name in OUTCOMES:
        # Every outcome is printed, including the zeros. A count that is only
        # shown when it is non-zero cannot be read as "this did not happen".
        count = report.count(name)
        sample = f"   {_sample(report.outcomes[name])}" if count else ""
        print(f"  {name:<16}: {count:>5}{sample}")
    print(f"\n  dates considered   : {len(dates)}")
    print(f"  requests made      : {requests_made}")
    print(f"  snapshot           : {snapshot}")
    if report.not_attempted:
        print(f"  NOT attempted      : {len(report.not_attempted)} date(s) left by "
              "--max-requests; re-run to continue")
        print(f"                       next: {report.not_attempted[0]}")
    for detail in report.details:
        if detail["outcome"] in FAILURE_OUTCOMES:
            print(f"  ! {detail['board_date']} {detail['outcome']}: "
                  f"{detail.get('detail', '')}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Acquire Gridley boards into an immutable snapshot "
                    "(AFLDB-ISSUE-118 Stage 2). Never contacts PostgreSQL.")
    parser.add_argument("--days", type=int, metavar="N",
                        help="rolling window of N days ending at --to (default today)")
    parser.add_argument("--from", dest="from_date", metavar="YYYY-MM-DD",
                        help="first board date")
    parser.add_argument("--to", dest="to_date", metavar="YYYY-MM-DD",
                        help="last board date (default today)")
    parser.add_argument("--date", dest="dates", action="append", metavar="YYYY-MM-DD",
                        help="one specific board date; repeatable")
    parser.add_argument("--all", action="store_true",
                        help=f"the whole history from {FIRST_BOARD_DATE.isoformat()}")
    parser.add_argument("--snapshot-root", metavar="PATH",
                        help=f"snapshot root (default ${SNAPSHOT_ENV} or "
                             f"{DEFAULT_SNAPSHOT_ROOT})")
    parser.add_argument("--label", default=DEFAULT_LABEL,
                        help=f"snapshot label (default {DEFAULT_LABEL})")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL,
                        help=f"source base URL (default {DEFAULT_BASE_URL})")
    parser.add_argument("--delay", type=float, default=MIN_DELAY_SECONDS, metavar="SECONDS",
                        help=f"minimum delay between requests (default {MIN_DELAY_SECONDS})")
    parser.add_argument("--max-requests", type=int, default=DEFAULT_MAX_REQUESTS, metavar="N",
                        help=f"stop after N requests (default {DEFAULT_MAX_REQUESTS}; "
                             "0 removes the bound)")
    parser.add_argument("--refresh", action="store_true",
                        help="re-request dates already captured, to detect an upstream "
                             "revision; a changed board is saved beside the original, "
                             "never over it")
    parser.add_argument("--allow-level-drift", action="store_true",
                        help="accept a board whose level is not the one the date implies")
    parser.add_argument("--require-complete", action="store_true",
                        help="treat a clean 404 as a failure too (for a backfill that "
                             "must be whole)")
    parser.add_argument("--dry-run", action="store_true",
                        help="print the plan and make no request of any kind")
    return parser


def run(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.delay < 0:
        print("ERROR: --delay cannot be negative.", file=sys.stderr)
        return 2
    if args.max_requests < 0:
        print("ERROR: --max-requests cannot be negative (0 removes the bound).",
              file=sys.stderr)
        return 2

    try:
        dates = select_dates(args)
    except AcquisitionError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    snapshot = resolve_snapshot(args.snapshot_root, args.label)
    on_disk, incomplete = existing_captures(snapshot)
    pending = [d for d in dates if d.isoformat() not in on_disk] if not args.refresh else dates

    print("AFLDB Gridley acquisition" + (" - dry run" if args.dry_run else ""))
    print(f"  source    : {args.base_url}{PATH_TEMPLATE.format(board_date='YYYY-MM-DD')}")
    print(f"  snapshot  : {snapshot}")
    print(f"  dates     : {dates[0].isoformat()} - {dates[-1].isoformat()} "
          f"({len(dates)} date(s))")
    print(f"  already   : {len(dates) - len(pending)} captured, {len(pending)} to request")
    if incomplete:
        print(f"  INCOMPLETE: {len(incomplete)} capture(s) have raw bytes but no request "
              "record and will be re-requested: " + _sample(incomplete))
    print(f"  policy    : >= {args.delay}s apart, {MAX_RETRIES} retries "
          f"({'/'.join(str(b) for b in BACKOFF_SECONDS)}s), {TIMEOUT_SECONDS}s timeout")
    bound = args.max_requests or len(pending)
    print(f"  bound     : {min(bound, len(pending))} request(s) this run")

    if args.dry_run:
        print("\nDry run: no request was made and nothing was written.")
        if pending:
            print(f"  first to request : {pending[0].isoformat()}")
            print(f"  last to request  : {pending[min(bound, len(pending)) - 1].isoformat()}")
        return 0

    fetcher = Fetcher(base_url=args.base_url, delay=args.delay)
    started = utc_now()
    # The run record's filename carries microseconds while `started_at` stays a
    # readable UTC instant. Two runs inside the same second are ordinary - a
    # bounded backfill resumes immediately, and the test suite runs several -
    # and a second-resolution name made the later one collide with the first
    # and abort AFTER its captures were already safely on disk.
    run_stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    try:
        robots = check_robots(fetcher, snapshot, [fetcher.url_for(d) for d in dates])
    except AcquisitionError as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        return 1

    report = acquire(fetcher, snapshot, dates, args)
    print_report(report, dates, snapshot, fetcher.requests_made)

    unavailable_fatal = args.require_complete and report.count(UNAVAILABLE)
    status = "completed" if not report.failures and not unavailable_fatal else "failed"
    write_new_json(
        snapshot / "runs" / f"{run_stamp}.json",
        {
            "started_at": started,
            "finished_at": utc_now(),
            "status": status,
            "tool": Path(__file__).name,
            "base_url": args.base_url,
            "robots_sha256": robots.get("body_sha256"),
            "user_agent": fetcher.user_agent,
            "delay_seconds": args.delay,
            "requests_made": fetcher.requests_made,
            "dates_considered": [d.isoformat() for d in dates],
            "not_attempted": report.not_attempted,
            "counts": {name: report.count(name) for name in OUTCOMES},
            "details": report.details,
        },
    )

    if report.failures:
        print(f"\nFAILED: {report.failures} date(s) did not acquire. Nothing already "
              "captured was changed.", file=sys.stderr)
        return 1
    if unavailable_fatal:
        print(f"\nFAILED: --require-complete, and {report.count(UNAVAILABLE)} date(s) "
              "returned a clean 404.", file=sys.stderr)
        return 1
    written = report.count(SAVED) + report.count(REVISED)
    print(f"\nOK: {written} capture(s) written, {report.count(SKIPPED)} already on disk, "
          f"{report.count(UNCHANGED)} re-fetched unchanged.")
    if report.not_attempted:
        print(f"    {len(report.not_attempted)} date(s) remain - re-run to continue.")
    return 0


if __name__ == "__main__":
    sys.exit(run())
