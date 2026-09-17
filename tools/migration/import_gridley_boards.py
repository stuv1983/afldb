#!/usr/bin/env python3
"""Import an acquired Gridley snapshot - AFLDB-ISSUE-118 Stage 2.

    python tools/migration/import_gridley_boards.py --dry-run --no-db
    python tools/migration/import_gridley_boards.py --dry-run
    python tools/migration/import_gridley_boards.py
    python tools/migration/import_gridley_boards.py --snapshot data/sources/gridley/history

Reads the immutable snapshot written by ``acquire_gridley_boards.py`` and lands
each captured board in ``external_grids`` / ``external_grid_axes`` (migration
080) with provenance ``gridley_api``.

The other half of the corpus
----------------------------
``import_external_grids.py`` imports the rescued SQLite archive with provenance
``legacy_sqlite``. This one imports the same boards as Gridley serves them
today. They are not alternatives and neither supersedes the other: migration
080 keys the revision chain on ``(source_id, provenance, board_number,
revision)`` precisely so both captures of a board are held at once, one as the
contemporaneous record and one as the richer re-acquisition, each a cross-check
on the other (ISSUE-118 sections 10.1, 20.2). This importer therefore never
reads, updates or supersedes a ``legacy_sqlite`` row, and a board already
imported from the archive is not a conflict here.

What the API capture has that the archive does not
--------------------------------------------------
The legacy capture flattened ``title`` and ``subtitle`` into one label and
discarded the split, the stable criterion ``id``, Gridley's own ``description``
and the item ``type`` - irreversibly, for 1,123 boards (ISSUE-118 section 4.1).
Those four are exactly the columns migration 080 left nullable for archive rows
and they are populated here.

``raw_title`` and ``raw_subtitle`` hold the source strings VERBATIM, unstripped
and un-normalised. ``raw_label`` is different on purpose: it is the legacy
``gridley_label()`` rule reproduced exactly, because it is the only form the
rescued archive has and therefore the only field on which the two provenances
can be compared. The reproduction was proved byte-identical to the archive on
both boards the Stage 0 probe overlapped (#1 and #1123).

Everything the parsed columns do not model - ``correctAnswersPlayerMap`` (the
per-cell answer key), ``correctGuesses``, ``scoreMap``, ``emoji``, ``theme``,
``imgUrl``, ``showOnLaunch`` - is preserved verbatim inside ``raw_payload``.
That is what section 10.3 asks of it: parsed columns are for querying, the
payload is the evidence they were parsed from, and a later stage must be able
to extract more WITHOUT re-fetching. No answer-key table is created here;
``external_grid_answers`` is Stage 6 and its absence is asserted by
``tests/external-grids-import.test.ts``.

Revisions, not overwrites (ISSUE-118 sections 10.4, 13)
--------------------------------------------------------
A capture whose payload hash equals the current revision's is ``unchanged`` - a
no-op, so a re-run of a completed backfill creates nothing. A capture whose
payload DIFFERS becomes a new revision: the previous revision keeps its bytes
and its row and stops being current, and a ``data_issues`` row records the
divergence. ``is_current`` is the only column this importer ever updates, which
is also the only UPDATE migration 080 grants ``afldb_import``.

Import note
-----------
``psycopg`` and ``common`` are imported lazily inside the database path, and
the hash recipe and source lookup are imported from ``import_external_grids``
rather than restated, so both provenances are hashed and classified by one
implementation. ``--dry-run --no-db`` therefore validates a whole snapshot on a
machine with no database and no driver.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any, Sequence

TOOL_DIR = Path(__file__).resolve().parent
if str(TOOL_DIR) not in sys.path:
    sys.path.insert(0, str(TOOL_DIR))

from acquire_gridley_boards import (  # noqa: E402
    DEFAULT_LABEL,
    DEFAULT_SNAPSHOT_ROOT,
    SNAPSHOT_ENV,
    PayloadRejected,
    sha256_hex,
    validate_payload,
)
from import_external_grids import (  # noqa: E402
    INGEST_SOURCE_KEY,
    TargetValidationError,
    canonical_json,
    load_env,
    payload_hash,
    resolve_grid_source_id,
)

PROVENANCE = "gridley_api"
"""``external_grids.provenance`` for every row this importer writes."""

TOOL_NAME = "import_gridley_boards.py"

ORIENTATIONS = (("row", "vItems"), ("col", "hItems"))
"""Rows are the vertical axis, columns the horizontal one.

This is the payload's own orientation, and it is the orientation the rescued
archive stored, verified against both overlapping boards rather than inferred
from the legacy column names (ISSUE-118 section 3)."""

REVISION_ISSUE_TYPE = "external_grid_revision"
REVISION_ENTITY_TYPE = "external_grid"


class SnapshotError(RuntimeError):
    """The snapshot is not the thing this importer was written for."""


@dataclass(frozen=True)
class Rejection:
    """One capture that could not be imported, and exactly why."""

    capture: str
    reason: str
    detail: str

    def describe(self) -> str:
        return f"{self.capture}: {self.reason} - {self.detail}"


@dataclass(frozen=True)
class AxisCapture:
    orientation: str
    position: int
    criterion_key: str
    raw_title: str | None
    raw_subtitle: str | None
    raw_description: str | None
    raw_label: str
    item_type: str | None


@dataclass(frozen=True)
class BoardCapture:
    """One captured board revision, parsed and ready to persist."""

    board_number: int
    board_date: date
    fetched_at: str
    body_sha256: str
    raw_payload: dict[str, Any]
    payload_sha256: str
    axes: tuple[AxisCapture, ...]
    answer_cells: int
    answer_players: int
    stem: str


# ---------------------------------------------------------------------------
# The legacy label rule, reproduced exactly
# ---------------------------------------------------------------------------


def gridley_label(item: dict[str, Any]) -> str:
    """Flatten a Gridley item the way the legacy scraper did.

    A deliberate, literal reproduction of ``gridley_label()`` in
    ``sports_data_lab/utils/fetch_grids.py``, including its ``or`` fallback to
    ``id`` and its ``strip()``. It is lossy - it drops the title whenever the
    title is a casefold substring of the subtitle - and that loss is the whole
    reason the API capture also stores ``raw_title`` and ``raw_subtitle``
    separately. It is reproduced anyway, unimproved, because ``raw_label`` is
    the ONLY field the rescued archive and the API capture share, so a "better"
    label here would silently break the cross-check both provenances exist for.
    """
    title = str(item.get("title") or item.get("id") or "").strip()
    subtitle = str(item.get("subtitle") or "").strip()
    if not subtitle:
        return title
    if title.casefold() in subtitle.casefold():
        return subtitle
    return f"{title} {subtitle}".strip()


# ---------------------------------------------------------------------------
# Snapshot reading
# ---------------------------------------------------------------------------


def resolve_snapshot(explicit: str | None, label: str) -> Path:
    if explicit:
        return Path(explicit)
    root = os.environ.get(SNAPSHOT_ENV) or DEFAULT_SNAPSHOT_ROOT
    return Path(root) / label


def optional_text(item: dict[str, Any], key: str, where: str) -> str | None:
    """A source field that must be a string or absent. Never coerced.

    ``str(value)`` here would turn a number, a list or a dict into a plausible
    looking criterion description and store it as though Gridley had said it.
    An unexpected type is a finding about the source and is refused.
    """
    value = item.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise PayloadRejected(
            "shape_invalid",
            f"{where}.{key} is {type(value).__name__}, expected a string or null")
    return value


def parse_capture(raw_path: Path, http_path: Path, allow_level_drift: bool) -> BoardCapture:
    """Parse one capture from its bytes. Raises ``PayloadRejected`` on any fault.

    The snapshot's own ``http/`` record is read for the fetch timestamp and is
    CROSS-CHECKED against the bytes, never trusted: the payload is re-validated
    from the raw file, the body hash is recomputed, and a record that disagrees
    with the file it describes is a rejection. An importer that believed the
    acquisition's summary would be unable to detect a snapshot that had been
    edited after capture.
    """
    stem = raw_path.stem
    board_date_text, _, sha16 = stem.partition("__")
    try:
        board_date = date.fromisoformat(board_date_text)
    except ValueError as exc:
        raise PayloadRejected("capture_name_invalid",
                              f"{raw_path.name} does not start with an ISO date") from exc

    if not http_path.is_file():
        raise PayloadRejected(
            "http_record_missing",
            f"{raw_path.name} has no matching http/{http_path.name}; the capture "
            "cannot state when it was fetched and a timestamp will not be invented")
    try:
        record = json.loads(http_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise PayloadRejected("http_record_malformed",
                              f"http/{http_path.name} is not JSON: {exc}") from exc
    if not isinstance(record, dict):
        raise PayloadRejected("http_record_malformed",
                              f"http/{http_path.name} is not an object")

    body = raw_path.read_bytes()
    payload = validate_payload(body, board_date, allow_level_drift)

    body_sha256 = sha256_hex(body)
    if not body_sha256.startswith(sha16):
        raise PayloadRejected(
            "capture_name_mismatch",
            f"{raw_path.name} is named for {sha16} but its bytes hash to "
            f"{body_sha256[:16]}; the file has changed since it was captured")
    recorded_sha = record.get("body_sha256")
    if recorded_sha is not None and recorded_sha != body_sha256:
        raise PayloadRejected(
            "http_record_mismatch",
            f"http/{http_path.name} records body_sha256 {recorded_sha} but the raw "
            f"bytes hash to {body_sha256}")

    fetched_at = record.get("fetched_at")
    if not isinstance(fetched_at, str) or not fetched_at.strip():
        raise PayloadRejected(
            "fetched_at_missing",
            f"http/{http_path.name} records no fetched_at. A capture time is either "
            "truthful or absent; one will not be manufactured here")
    try:
        datetime.strptime(fetched_at, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as exc:
        raise PayloadRejected("fetched_at_invalid",
                              f"fetched_at {fetched_at!r} is not an ISO UTC instant") from exc

    axes: list[AxisCapture] = []
    for orientation, key in ORIENTATIONS:
        for position, item in enumerate(payload[key]):
            where = f"{key}[{position}]"
            label = gridley_label(item)
            if not label.strip():
                raise PayloadRejected(
                    "shape_invalid",
                    f"{where} produced an empty label from title "
                    f"{item.get('title')!r} and id {item.get('id')!r}")
            axes.append(AxisCapture(
                orientation=orientation,
                position=position,
                criterion_key=item["id"],
                raw_title=optional_text(item, "title", where),
                raw_subtitle=optional_text(item, "subtitle", where),
                raw_description=optional_text(item, "description", where),
                raw_label=label,
                item_type=optional_text(item, "type", where),
            ))

    answers = payload.get("correctAnswersPlayerMap")
    answer_cells = 0
    answer_players = 0
    if isinstance(answers, list):
        for row in answers:
            for cell in row:
                answer_cells += 1
                answer_players += len(cell)

    envelope = {
        "source": PROVENANCE,
        "url": record.get("url"),
        "board_date": board_date.isoformat(),
        "body_sha256": body_sha256,
        "payload": payload,
    }
    # The envelope is content only. fetched_at is deliberately NOT in it: it
    # goes to its own column, because a capture time inside the hashed payload
    # would make every re-fetch of an unchanged board look like a new revision.
    return BoardCapture(
        board_number=payload["level"],
        board_date=board_date,
        fetched_at=fetched_at,
        body_sha256=body_sha256,
        raw_payload=envelope,
        payload_sha256=payload_hash(envelope),
        axes=tuple(axes),
        answer_cells=answer_cells,
        answer_players=answer_players,
        stem=stem,
    )


@dataclass
class SnapshotReport:
    snapshot: Path
    captures: list[BoardCapture] = field(default_factory=list)
    rejections: list[Rejection] = field(default_factory=list)
    files_read: int = 0
    dates: set[str] = field(default_factory=set)

    @property
    def ok(self) -> bool:
        return not self.rejections


def collect_captures(snapshot: Path, allow_level_drift: bool,
                     limit: int | None = None) -> SnapshotReport:
    """Read and validate every capture in the snapshot, oldest fetch first.

    Deterministic: captures are ordered by (board date, fetch time, content
    hash), so the revision chain this importer builds is the order the captures
    were taken and does not depend on the filesystem.
    """
    report = SnapshotReport(snapshot=snapshot)
    raw_dir = snapshot / "raw"
    if not raw_dir.is_dir():
        raise SnapshotError(
            f"{raw_dir} does not exist. Acquire a snapshot first: "
            "python tools/migration/acquire_gridley_boards.py --days 14")

    paths = sorted(raw_dir.glob("*__*.json"))
    if not paths:
        raise SnapshotError(f"{raw_dir} holds no captures")

    parsed: list[BoardCapture] = []
    for raw_path in paths:
        report.files_read += 1
        http_path = snapshot / "http" / raw_path.name
        try:
            parsed.append(parse_capture(raw_path, http_path, allow_level_drift))
        except PayloadRejected as exc:
            report.rejections.append(Rejection(raw_path.name, exc.outcome, exc.detail))

    parsed.sort(key=lambda c: (c.board_date, c.fetched_at, c.payload_sha256))
    report.captures = parsed[:limit] if limit is not None else parsed
    report.dates = {c.board_date.isoformat() for c in report.captures}
    return report


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

INSERTED = "inserted"
UNCHANGED = "unchanged"
REVISED = "revised"
CONFLICT = "conflict"


PENDING_ID = -1
"""Placeholder for a row this run has decided to write but has not written yet.

Two captures of the same board inside one run form a chain: the second must
supersede the first, whose id does not exist until the insert happens. The
decision therefore carries ``supersedes_id = None`` and the write loop resolves
it from the id the previous insert returned. Leaving a placeholder in the SQL
would demote nothing and then leave two current revisions, which the partial
unique index would reject halfway through the run."""


@dataclass(frozen=True)
class Decision:
    capture: BoardCapture
    action: str
    revision: int = 1
    supersedes_id: int | None = None
    supersedes_sha: str | None = None
    detail: str = ""


@dataclass
class Outcome:
    decisions: list[Decision] = field(default_factory=list)

    def count(self, action: str) -> int:
        return sum(1 for d in self.decisions if d.action == action)

    @property
    def conflicts(self) -> list[Decision]:
        return [d for d in self.decisions if d.action == CONFLICT]

    @property
    def ok(self) -> bool:
        return not self.conflicts

    def to_write(self) -> list[Decision]:
        return [d for d in self.decisions if d.action in (INSERTED, REVISED)]


def classify(captures: Sequence[BoardCapture],
             current_by_number: dict[int, tuple[str, int]],
             chain_hashes: dict[int, set[str]],
             max_revision: dict[int, int],
             current_by_date: dict[str, int]) -> Outcome:
    """Decide insert / unchanged / revise / conflict for every capture.

    Shared by the dry run and the real import, so what a dry run reports is
    what the import does rather than a parallel implementation of it. The
    working state is advanced as decisions are made, so two captures of the
    same board within one run form a revision chain instead of colliding.

    ``unchanged`` is decided against the WHOLE revision chain, not just the
    current revision. A snapshot accumulates captures and keeps every one of
    them, so once a board has been revised the snapshot permanently holds a
    superseded capture. Comparing only against the current revision would read
    that capture as new content on every later run and file it as yet another
    revision, so a completed backfill would grow a revision per re-run forever
    - which is exactly the duplicate-current-revision failure a re-run must not
    have.

    That leaves one case the per-capture rule cannot see: upstream serving
    content it has served before, after serving something else in between. The
    per-board pass below catches it.
    """
    outcome = Outcome()
    current_by_number = dict(current_by_number)
    chain_hashes = {number: set(hashes) for number, hashes in chain_hashes.items()}
    max_revision = dict(max_revision)
    current_by_date = dict(current_by_date)

    for capture in captures:
        number = capture.board_number
        date_key = capture.board_date.isoformat()
        held = current_by_number.get(number)

        if capture.payload_sha256 in chain_hashes.get(number, ()):
            outcome.decisions.append(Decision(capture, UNCHANGED))
            continue

        date_holder = current_by_date.get(date_key)
        if date_holder is not None and date_holder != number:
            outcome.decisions.append(Decision(
                capture, CONFLICT,
                detail=(f"{date_key} is already held by captured board #{date_holder} "
                        f"under this provenance, but this capture is board #{number}. "
                        "Board number and date disagree between captures.")))
            continue

        if held is None:
            revision = max_revision.get(number, 0) + 1
            outcome.decisions.append(Decision(capture, INSERTED, revision=revision))
        else:
            revision = max_revision.get(number, 1) + 1
            outcome.decisions.append(Decision(
                capture, REVISED, revision=revision,
                supersedes_id=held[1] if held[1] != PENDING_ID else None,
                supersedes_sha=held[0],
                detail=(f"upstream content changed: stored {held[0][:12]}..., "
                        f"capture {capture.payload_sha256[:12]}...")))

        max_revision[number] = revision
        current_by_number[number] = (capture.payload_sha256, PENDING_ID)
        chain_hashes.setdefault(number, set()).add(capture.payload_sha256)
        current_by_date[date_key] = number

    outcome.decisions.extend(_reverted_boards(captures, current_by_number))
    return outcome


def _reverted_boards(captures: Sequence[BoardCapture],
                     current_by_number: dict[int, tuple[str, int]]) -> list[Decision]:
    """Boards whose newest capture is not the revision that ends up current.

    On any ordinary run - a first import, a partial one, a re-run of a finished
    backfill - the newest capture IS the current revision and this returns
    nothing. It fires only when upstream has served content it served before,
    after serving something else in between, which would leave AFLDB current on
    the middle version while the source shows the first. Whether a revert
    should be recorded as a further revision is a decision about historical
    evidence and not one an importer should settle on its own, so the board is
    refused and reported.
    """
    newest: dict[int, BoardCapture] = {}
    for capture in captures:
        newest[capture.board_number] = capture  # captures arrive oldest first
    conflicts = []
    for number, capture in newest.items():
        held = current_by_number.get(number)
        if held is not None and held[0] != capture.payload_sha256:
            conflicts.append(Decision(
                capture, CONFLICT,
                detail=(f"the newest capture of board #{number} ({capture.stem}) is "
                        "content already held as an earlier revision, so upstream "
                        "appears to have reverted. Refusing to renumber history; "
                        "decide explicitly what the current revision should be.")))
    return conflicts


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def load_current_state(conn: Any, source_id: int) -> tuple[
        dict[int, tuple[str, int]], dict[int, set[str]], dict[int, int], dict[str, int]]:
    """The gridley_api revision state already in PostgreSQL.

    Scoped to this provenance throughout. ``legacy_sqlite`` rows are never read
    and never touched: the two chains are independent by design (section 20.2).
    """
    with conn.cursor() as cur:
        cur.execute(
            """SELECT board_number, board_date, payload_sha256, id
                 FROM external_grids
                WHERE source_id = %s AND provenance = %s AND is_current""",
            (source_id, PROVENANCE))
        current = cur.fetchall()
        cur.execute(
            """SELECT board_number, max(revision), array_agg(payload_sha256)
                 FROM external_grids
                WHERE source_id = %s AND provenance = %s
                GROUP BY board_number""",
            (source_id, PROVENANCE))
        revisions = cur.fetchall()
    by_number = {int(r[0]): (str(r[2]).strip(), int(r[3])) for r in current}
    by_date = {r[1].isoformat(): int(r[0]) for r in current}
    max_revision = {int(r[0]): int(r[1]) for r in revisions}
    # Every hash the board has ever been captured under, current or superseded.
    chain_hashes = {int(r[0]): {str(h).strip() for h in r[2]} for r in revisions}
    return by_number, chain_hashes, max_revision, by_date


def write_decision(conn: Any, source_id: int, batch_id: int, decision: Decision,
                   supersedes_id: int | None) -> int:
    """Append one board revision and its six axes. Returns the new grid id.

    A revision demotes the previous row BEFORE inserting the new one: the
    partial unique index admits exactly one current revision per board per
    provenance, so the order is a correctness requirement, not a preference.
    ``is_current`` is the only column updated anywhere in this file - no
    captured byte is ever rewritten, and migration 080 grants no other UPDATE.
    """
    capture = decision.capture
    if decision.action == REVISED and supersedes_id is None:
        raise TargetValidationError(
            f"board #{capture.board_number} revision {decision.revision} has no row "
            "to supersede; refusing to leave two current revisions")
    with conn.cursor() as cur:
        if supersedes_id is not None:
            cur.execute(
                "UPDATE external_grids SET is_current = false WHERE id = %s",
                (supersedes_id,))
        cur.execute(
            """INSERT INTO external_grids
                   (source_id, provenance, board_number, board_date, revision,
                    is_current, payload_sha256, raw_payload, fetched_at, import_batch_id)
               VALUES (%s, %s, %s, %s, %s, true, %s, %s::jsonb, %s, %s)
            RETURNING id""",
            (source_id, PROVENANCE, capture.board_number, capture.board_date,
             decision.revision, capture.payload_sha256,
             canonical_json(capture.raw_payload), capture.fetched_at, batch_id))
        grid_id = cur.fetchone()[0]
        cur.executemany(
            """INSERT INTO external_grid_axes
                   (grid_id, orientation, position, criterion_key, raw_title,
                    raw_subtitle, raw_description, raw_label, item_type)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            [(grid_id, axis.orientation, axis.position, axis.criterion_key,
              axis.raw_title, axis.raw_subtitle, axis.raw_description,
              axis.raw_label, axis.item_type)
             for axis in capture.axes])
        if decision.action == REVISED:
            cur.execute(
                """INSERT INTO data_issues
                     (entity_type, entity_id, issue_type, severity, description, details)
                   VALUES (%s, %s, %s, 'warning', %s, %s)""",
                (REVISION_ENTITY_TYPE, grid_id, REVISION_ISSUE_TYPE,
                 f"Gridley board #{capture.board_number} "
                 f"({capture.board_date.isoformat()}) was re-served with different "
                 "content. The earlier capture is kept and is no longer current.",
                 json.dumps({
                     "board_number": capture.board_number,
                     "board_date": capture.board_date.isoformat(),
                     "revision": decision.revision,
                     "superseded_grid_id": supersedes_id,
                     "superseded_payload_sha256": decision.supersedes_sha,
                     "payload_sha256": capture.payload_sha256,
                     "body_sha256": capture.body_sha256,
                     "capture": capture.stem,
                 }, sort_keys=True)))
    return grid_id


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def _sample(values: Sequence[Any], limit: int = 10) -> str:
    shown = ", ".join(str(value) for value in values[:limit])
    return shown + (f" (+{len(values) - limit} more)" if len(values) > limit else "")


def print_snapshot_report(report: SnapshotReport) -> None:
    captures = report.captures
    print("Snapshot")
    print(f"  path                 : {report.snapshot}")
    print(f"  capture files read   : {report.files_read}")
    print(f"  captures parsed      : {len(captures)}")
    print(f"  captures rejected    : {len(report.rejections)}")
    if not captures:
        return
    numbers = sorted({c.board_number for c in captures})
    dates = sorted({c.board_date for c in captures})
    print(f"  board number range   : #{numbers[0]} - #{numbers[-1]}")
    print(f"  board date range     : {dates[0].isoformat()} - {dates[-1].isoformat()}")
    print(f"  distinct boards      : {len(numbers)}")
    print(f"  distinct dates       : {len(dates)}")
    multi = [d for d in report.dates
             if sum(1 for c in captures if c.board_date.isoformat() == d) > 1]
    print(f"  dates with >1 capture: {len(multi)}"
          + (f"   {_sample(sorted(multi))}" if multi else ""))

    missing = [n for n in range(numbers[0], numbers[-1] + 1) if n not in set(numbers)]
    print(f"  gaps in number range : {len(missing)}"
          + (f"   {_sample(missing)}" if missing else ""))

    keys = {axis.criterion_key for c in captures for axis in c.axes}
    described = sum(1 for c in captures for axis in c.axes if axis.raw_description)
    subtitled = sum(1 for c in captures for axis in c.axes if axis.raw_subtitle)
    typed = sum(1 for c in captures for axis in c.axes if axis.item_type)
    axis_count = sum(len(c.axes) for c in captures)
    print(f"  axis occurrences     : {axis_count}")
    print(f"  distinct criterion ids: {len(keys)}")
    print(f"  axes with description : {described}")
    print(f"  axes with subtitle    : {subtitled}")
    print(f"  axes with item type   : {typed}")

    with_answers = [c for c in captures if c.answer_cells]
    print(f"  captures with answer key: {len(with_answers)} of {len(captures)}")
    if with_answers:
        players = sum(c.answer_players for c in with_answers)
        cells = sum(c.answer_cells for c in with_answers)
        print(f"  answer-key cells        : {cells}")
        print(f"  answer-key player refs  : {players}")
        print("  (preserved inside raw_payload; no answer table exists before Stage 6)")

    if report.rejections:
        print("\nRejections")
        for rejection in report.rejections[:20]:
            print(f"  - {rejection.describe()}")
        if len(report.rejections) > 20:
            print(f"    (+{len(report.rejections) - 20} more)")


def print_outcome(outcome: Outcome, dry_run: bool) -> None:
    verb = "would be " if dry_run else ""
    print("\nPostgreSQL")
    print(f"  {verb}inserted   : {outcome.count(INSERTED)}")
    print(f"  {verb}revised    : {outcome.count(REVISED)}")
    print(f"  unchanged     : {outcome.count(UNCHANGED)}")
    print(f"  conflicts     : {len(outcome.conflicts)}")
    for decision in [d for d in outcome.decisions if d.action == REVISED][:10]:
        print(f"  ~ #{decision.capture.board_number} "
              f"{decision.capture.board_date.isoformat()} -> revision "
              f"{decision.revision}: {decision.detail}")
    for decision in outcome.conflicts[:20]:
        print(f"  ! #{decision.capture.board_number} "
              f"{decision.capture.board_date.isoformat()}: {decision.detail}",
              file=sys.stderr)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Import an acquired Gridley snapshot (AFLDB-ISSUE-118 Stage 2).")
    parser.add_argument("--snapshot", metavar="PATH",
                        help=f"snapshot directory (default ${SNAPSHOT_ENV} or "
                             f"{DEFAULT_SNAPSHOT_ROOT}/<label>)")
    parser.add_argument("--label", default=DEFAULT_LABEL,
                        help=f"snapshot label (default {DEFAULT_LABEL})")
    parser.add_argument("--dry-run", action="store_true",
                        help="validate and classify without writing anything")
    parser.add_argument("--no-db", action="store_true",
                        help="snapshot-side validation only; never contacts PostgreSQL "
                             "(requires --dry-run)")
    parser.add_argument("--limit", type=int, metavar="N",
                        help="classify only the first N captures (diagnostics)")
    parser.add_argument("--allow-level-drift", action="store_true",
                        help="accept a capture whose level is not the one its date implies")
    return parser


def run(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.no_db and not args.dry_run:
        print("ERROR: --no-db is a dry-run mode; pass --dry-run as well.", file=sys.stderr)
        return 2
    if args.limit is not None and args.limit < 1:
        print("ERROR: --limit must be at least 1.", file=sys.stderr)
        return 2
    if args.limit is not None and not args.dry_run:
        # A partial import that reports "OK" is how an incomplete corpus gets
        # mistaken for a complete one. Diagnostics only.
        print("ERROR: --limit is a dry-run diagnostic; pass --dry-run as well.",
              file=sys.stderr)
        return 2

    load_env()
    snapshot = resolve_snapshot(args.snapshot, args.label)

    mode = "dry run (no database)" if args.no_db else "dry run" if args.dry_run else "import"
    print(f"AFLDB Gridley snapshot import - {mode}")
    print(f"  snapshot: {snapshot}")
    print(f"  target  : external_grids / external_grid_axes, provenance {PROVENANCE}\n")

    try:
        report = collect_captures(snapshot, args.allow_level_drift, args.limit)
    except SnapshotError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print_snapshot_report(report)

    if not report.ok:
        # Fail closed over the whole snapshot, as Stage 1 does over the whole
        # archive. The acquisition already refuses to write a response that did
        # not validate, so a rejection here means the snapshot changed after
        # capture - which is a reason to stop, not to import the rest.
        print("\nFAILED: the snapshot did not validate. Nothing was written.",
              file=sys.stderr)
        return 1
    if not report.captures:
        print("\nFAILED: the snapshot produced no captures.", file=sys.stderr)
        return 1

    if args.no_db:
        print("\nPostgreSQL")
        print("  skipped              : --no-db, so nothing was classified or written")
        print(f"\nOK: {len(report.captures)} capture(s) validated. "
              "No database was contacted.")
        return 0

    # Database path. Imported here, not at module scope: --no-db must run where
    # psycopg is not installed.
    from common import connect_pg, import_batch  # noqa: PLC0415

    conn = connect_pg()
    try:
        source_id = resolve_grid_source_id(conn)
        current, chain_hashes, max_revision, by_date = load_current_state(conn, source_id)
        outcome = classify(report.captures, current, chain_hashes, max_revision, by_date)

        if args.dry_run:
            # No import batch: opening one INSERTs a row and commits it, which
            # is a write. Nothing above this point wrote anything either, so
            # the rollback is belt and braces over a read-only transaction.
            conn.rollback()
            print_outcome(outcome, dry_run=True)
            if not outcome.ok:
                print("\nFAILED: captures conflict with what is already persisted. "
                      "Nothing would be written.", file=sys.stderr)
                return 1
            print(f"\nOK: {len(report.captures)} capture(s) validated, "
                  f"{outcome.count(INSERTED)} would be inserted, "
                  f"{outcome.count(REVISED)} would become new revisions, "
                  f"{outcome.count(UNCHANGED)} already captured. Nothing was written.")
            return 0

        with import_batch(conn, INGEST_SOURCE_KEY, TOOL_NAME, "external_grids") as batch:
            batch.records_read = report.files_read
            # Ids of rows this run has already written, so a second capture of
            # the same board supersedes the first rather than a stale id.
            written_current: dict[int, int] = {}
            for decision in outcome.to_write():
                supersedes_id = decision.supersedes_id
                if decision.action == REVISED and supersedes_id is None:
                    supersedes_id = written_current.get(decision.capture.board_number)
                grid_id = write_decision(conn, source_id, batch.id, decision,
                                         supersedes_id)
                written_current[decision.capture.board_number] = grid_id
                if decision.action == REVISED:
                    batch.records_updated += 1
                batch.records_inserted += 1
            for decision in outcome.conflicts:
                batch.reject(str(decision.capture.board_number), "captured_board_conflict",
                             {"detail": decision.detail, "capture": decision.capture.stem})
            conn.commit()

        print_outcome(outcome, dry_run=False)
        if not outcome.ok:
            print("\nCOMPLETED WITH CONFLICTS: captured evidence was left untouched. "
                  "Each conflict is recorded against the import batch.", file=sys.stderr)
            return 1
        print(f"\nOK: {outcome.count(INSERTED)} board(s) inserted, "
              f"{outcome.count(REVISED)} new revision(s), "
              f"{outcome.count(UNCHANGED)} already captured.")
        return 0
    except TargetValidationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(run())
