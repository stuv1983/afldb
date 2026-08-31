#!/usr/bin/env python3
"""Import the rescued Gridley board archive — AFLDB-ISSUE-118 Stage 1.

    python tools/migration/import_external_grids.py --dry-run --no-db
    python tools/migration/import_external_grids.py --dry-run
    python tools/migration/import_external_grids.py
    python tools/migration/import_external_grids.py --sqlite /path/to/afl.db

Reads ``historic_grids`` from the Sports Data Lab SQLite archive and lands
each board in ``external_grids`` / ``external_grid_axes`` (migration 080)
with provenance ``legacy_sqlite``.

What this importer is, and is not
---------------------------------
It is a **rescue**. The archive holds 1,123 consecutive Gridley boards
(#1 2023-07-17 to #1123 2026-08-12) captured while they were live. It is
the only contemporaneous record of them, and the scraper that produced it
overwrites a stored board in place whenever it re-fetches a date, so the
archive can lose evidence at any time. Getting those boards into AFLDB,
byte-faithfully, is the whole job.

It is **not** a semantic import. No criterion is mapped to a Grid Solver
builder, normalised, title-cased, deduplicated or classified here. The
archive's label text is stored exactly as the archive holds it. Mapping is
a reviewed decision with its own table and its own stage (ISSUE-118 §11,
§18); inventing one during an import would bury it where nobody reviews it.

Four rules this file exists to keep
-----------------------------------
* **The source is never written to.** The SQLite database is opened
  ``mode=ro`` through a URI *and* pinned with ``PRAGMA query_only=ON``, so
  a write is refused by the connection even if one were ever attempted.
  Nothing here creates a journal, a WAL file or a temporary copy.
* **Malformed input fails closed.** A row whose axes are not exactly three
  non-blank strings, or whose date is not an ISO date, or whose JSON does
  not parse, is REJECTED and named. It is never coerced, padded, trimmed
  into shape or skipped quietly. If any row in the corpus is rejected,
  nothing is written at all: validation completes over the whole archive
  before the first INSERT.
* **A captured board is immutable.** An existing board with identical
  content is ``unchanged`` — a no-op, so reruns are safe. An existing
  board whose content DIFFERS is a ``conflict``: the importer refuses to
  overwrite it, reports it, and continues. Migration 080 backs that with
  grants, not just intent — the import role has no UPDATE on any captured
  column and no DELETE or TRUNCATE at all.
* **A dry run writes nothing.** ``--dry-run`` opens no import batch (which
  would itself be a write), issues no INSERT, and rolls back the read-only
  transaction it used to classify. ``--dry-run --no-db`` goes further and
  never contacts PostgreSQL at all, so the source-side contract can be
  proved on a machine with no database and no driver installed.

Import note
-----------
``psycopg`` and ``common`` are imported lazily, inside the database path
only. Every other importer in this directory imports them at module scope,
because every other importer needs a database to do anything at all. This
one has a genuine, contractual DB-free mode — the ``--no-db`` dry run
above — and a module-scope import would make that mode impossible to run
on exactly the machines it exists for.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, Iterator, Sequence

# ---------------------------------------------------------------------------
# Source contract
# ---------------------------------------------------------------------------

LEGACY_TABLE = "historic_grids"
"""The one table this importer reads. Nothing else in the archive is touched."""

LEGACY_COLUMNS: tuple[str, ...] = (
    "grid_num", "date", "source", "rows_json", "cols_json", "unsupported_json", "note",
)
"""Every column ``historic_grids`` is expected to have, in its declared order."""

LEGACY_SOURCE_VALUE = "Gridley"
"""The only ``source`` value this importer accepts. Anything else is a different game."""

GRID_SOURCE_CODE = "gridley"
"""``external_grid_sources.code`` for the platform these boards belong to."""

INGEST_SOURCE_KEY = "gridley"
"""``sources.key`` the import batch is recorded against (migration 080)."""

PROVENANCE = "legacy_sqlite"
"""``external_grids.provenance`` for every row this importer writes."""

AXIS_LENGTH = 3
"""A Gridley board is 3x3. Not a default, not a maximum: the shape."""

ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
"""``date.fromisoformat`` accepts compact forms like '20230717' on 3.11+, which
would silently admit a differently-formatted archive. The archive's dates are
ISO extended, so require exactly that and let anything else be a rejection."""

TOOL_NAME = "import_external_grids.py"

DEFAULT_SQLITE_ENV = "AFLDB_LEGACY_SQLITE"


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class SourceValidationError(RuntimeError):
    """The archive is not the thing this importer was written for.

    Raised before any row is read. Distinct from a row rejection: a bad row
    is data to report, a bad source is a wrong input to refuse.
    """


class TargetValidationError(RuntimeError):
    """PostgreSQL is not in the state this importer requires (migration 080)."""


@dataclass(frozen=True)
class RowRejection:
    """One source row that could not be imported, and exactly why."""

    grid_num: Any
    reason: str
    detail: str

    def describe(self) -> str:
        return f"grid #{self.grid_num}: {self.reason} - {self.detail}"


# ---------------------------------------------------------------------------
# Parsed board
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LegacyBoard:
    """One archived board, parsed and ready to persist.

    ``raw_payload`` is the archive's own row, verbatim: the JSON columns stay
    as the exact strings SQLite returned rather than as reparsed arrays, so
    the stored evidence is the bytes that were captured and not this
    importer's opinion of them.
    """

    board_number: int
    board_date: date
    rows: tuple[str, ...]
    cols: tuple[str, ...]
    raw_payload: dict[str, Any]
    payload_sha256: str
    unsupported_count: int
    note: str

    def axes(self) -> list[tuple[str, int, str]]:
        """(orientation, position, raw_label) for all six axes, in a fixed order."""
        return (
            [("row", i, label) for i, label in enumerate(self.rows)]
            + [("col", i, label) for i, label in enumerate(self.cols)]
        )


def canonical_json(payload: Any) -> str:
    """The one serialisation ``payload_sha256`` is ever computed over.

    Sorted keys, no insignificant whitespace, UTF-8 kept as UTF-8. jsonb
    normalises key order and whitespace on the way in, so a value read back
    out of PostgreSQL and re-serialised this way reproduces the same hash —
    which is what makes the stored hash checkable rather than merely stored.
    """
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def payload_hash(payload: Any) -> str:
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Source access — strictly read-only
# ---------------------------------------------------------------------------


def load_env(env_path: Path | None = None) -> None:
    """Load ``.env`` into the environment without overwriting anything set.

    A deliberate ten-line copy of ``common.load_env``. Importing that one
    would pull ``common`` — and therefore ``psycopg`` — in at module scope,
    which is exactly what the ``--no-db`` dry run must not require. The
    behaviour is identical; if the two ever diverge, ``common`` is correct.
    """
    path = env_path or Path(__file__).resolve().parents[2] / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def resolve_sqlite_path(explicit: str | None) -> str:
    path = explicit or os.environ.get(DEFAULT_SQLITE_ENV)
    if not path:
        raise SourceValidationError(
            f"no legacy SQLite path: pass --sqlite or set {DEFAULT_SQLITE_ENV}"
        )
    if not Path(path).exists():
        raise SourceValidationError(f"legacy SQLite database not found: {path}")
    return path


def open_legacy(path: str) -> sqlite3.Connection:
    """Open the archive read-only, twice over.

    ``mode=ro`` refuses the write at the VFS layer and ``query_only=ON``
    refuses it at the statement layer. Either alone would do; both are cheap,
    and this database belongs to another project.
    """
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA query_only=ON")
    return con


def validate_source(con: sqlite3.Connection) -> dict[str, Any]:
    """Prove the archive is the expected shape before reading a single board."""
    table = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (LEGACY_TABLE,)
    ).fetchone()
    if table is None:
        raise SourceValidationError(f"table {LEGACY_TABLE!r} is not present in the archive")

    columns = [row["name"] for row in con.execute(f"PRAGMA table_info({LEGACY_TABLE})")]
    missing = [c for c in LEGACY_COLUMNS if c not in columns]
    if missing:
        raise SourceValidationError(
            f"{LEGACY_TABLE} is missing expected column(s): {', '.join(missing)}"
        )

    sources = [row[0] for row in con.execute(f"SELECT DISTINCT source FROM {LEGACY_TABLE}")]
    unexpected = sorted(str(s) for s in sources if s != LEGACY_SOURCE_VALUE)
    if unexpected:
        raise SourceValidationError(
            f"{LEGACY_TABLE} holds non-{LEGACY_SOURCE_VALUE} source value(s): "
            f"{', '.join(unexpected)}. This importer captures Gridley boards only; "
            "importing another game's grids under Gridley provenance would be a lie."
        )

    total = con.execute(f"SELECT count(*) FROM {LEGACY_TABLE}").fetchone()[0]
    return {"table": LEGACY_TABLE, "columns": columns, "rows": total}


def read_rows(con: sqlite3.Connection, limit: int | None = None) -> Iterator[sqlite3.Row]:
    """Deterministic order, so two runs read the archive identically."""
    sql = (
        f"SELECT {', '.join(LEGACY_COLUMNS)} FROM {LEGACY_TABLE} "
        "ORDER BY grid_num ASC"
    )
    if limit is not None:
        sql += f" LIMIT {int(limit)}"
    yield from con.execute(sql)


# ---------------------------------------------------------------------------
# Parsing — deterministic, and never forgiving
# ---------------------------------------------------------------------------


def parse_axis(raw: Any, column: str) -> tuple[str, ...]:
    """Parse one axis array. Every failure mode is named, none is repaired."""
    if raw is None:
        raise ValueError(f"{column}_missing: column is NULL")
    if not isinstance(raw, str):
        raise ValueError(f"{column}_not_text: stored as {type(raw).__name__}")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{column}_malformed: {exc.msg} at position {exc.pos}") from exc
    if not isinstance(parsed, list):
        raise ValueError(f"{column}_not_array: parsed as {type(parsed).__name__}")
    if len(parsed) != AXIS_LENGTH:
        raise ValueError(f"{column}_wrong_length: {len(parsed)} element(s), expected {AXIS_LENGTH}")
    for index, item in enumerate(parsed):
        if not isinstance(item, str):
            raise ValueError(f"{column}_non_string: element {index} is {type(item).__name__}")
        if not item.strip():
            raise ValueError(f"{column}_blank: element {index} is empty or whitespace")
    # Stored exactly as given: no strip(), no case change, no collapse. The raw
    # text is the evidence, and normalising it here would quietly rewrite the
    # source before anyone had classified it.
    return tuple(parsed)


def parse_board(row: sqlite3.Row) -> LegacyBoard:
    """Turn one archive row into a board, or raise ValueError naming the defect."""
    grid_num = row["grid_num"]
    if isinstance(grid_num, bool) or not isinstance(grid_num, int):
        raise ValueError(f"grid_num_not_integer: stored as {type(grid_num).__name__}")
    if grid_num < 1:
        raise ValueError(f"grid_num_out_of_range: {grid_num}")

    raw_date = row["date"]
    if raw_date is None:
        raise ValueError("date_missing: column is NULL")
    if not isinstance(raw_date, str) or not ISO_DATE.match(raw_date):
        raise ValueError(f"date_not_iso: {raw_date!r} is not YYYY-MM-DD")
    try:
        board_date = date.fromisoformat(raw_date)
    except ValueError as exc:
        raise ValueError(f"date_invalid: {raw_date!r} ({exc})") from exc

    if row["source"] != LEGACY_SOURCE_VALUE:
        raise ValueError(f"source_unexpected: {row['source']!r}")

    rows = parse_axis(row["rows_json"], "rows_json")
    cols = parse_axis(row["cols_json"], "cols_json")

    # Vestigial in every one of the 1,123 archived rows, and never populated by
    # the legacy scraper. Validated rather than ignored: if a future archive
    # ever carries content here it must not arrive as unparsed noise. Whatever
    # it holds is preserved verbatim in raw_payload and counted in the report,
    # so it is surfaced rather than dropped.
    unsupported_count = 0
    raw_unsupported = row["unsupported_json"]
    if raw_unsupported not in (None, ""):
        if not isinstance(raw_unsupported, str):
            raise ValueError(
                f"unsupported_json_not_text: stored as {type(raw_unsupported).__name__}"
            )
        try:
            unsupported = json.loads(raw_unsupported)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"unsupported_json_malformed: {exc.msg} at position {exc.pos}"
            ) from exc
        if not isinstance(unsupported, list):
            raise ValueError(
                f"unsupported_json_not_array: parsed as {type(unsupported).__name__}"
            )
        unsupported_count = len(unsupported)

    note = row["note"] if isinstance(row["note"], str) else ""

    payload = {
        "source": LEGACY_SOURCE_VALUE,
        "table": LEGACY_TABLE,
        "row": {column: row[column] for column in LEGACY_COLUMNS},
    }
    return LegacyBoard(
        board_number=grid_num,
        board_date=board_date,
        rows=rows,
        cols=cols,
        raw_payload=payload,
        payload_sha256=payload_hash(payload),
        unsupported_count=unsupported_count,
        note=note,
    )


# ---------------------------------------------------------------------------
# Corpus-level validation
# ---------------------------------------------------------------------------


@dataclass
class SourceReport:
    """Everything the archive said, and everything wrong with it."""

    rows_read: int = 0
    boards: list[LegacyBoard] = field(default_factory=list)
    rejections: list[RowRejection] = field(default_factory=list)
    duplicate_numbers: list[int] = field(default_factory=list)
    duplicate_dates: list[str] = field(default_factory=list)
    missing_numbers: list[int] = field(default_factory=list)
    unsupported_rows: list[int] = field(default_factory=list)
    noted_rows: list[int] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not (self.rejections or self.duplicate_numbers or self.duplicate_dates)


def collect_boards(con: sqlite3.Connection, limit: int | None = None) -> SourceReport:
    """Read and validate the whole archive before anything is persisted.

    Two-phase on purpose: a partial import of a corpus with one malformed row
    would leave the archive half-rescued and the defect unrecorded.
    """
    report = SourceReport()
    by_number: dict[int, LegacyBoard] = {}
    by_date: dict[date, int] = {}

    for row in read_rows(con, limit):
        report.rows_read += 1
        try:
            board = parse_board(row)
        except ValueError as exc:
            reason, _, detail = str(exc).partition(": ")
            report.rejections.append(RowRejection(row["grid_num"], reason, detail or reason))
            continue

        if board.board_number in by_number:
            report.duplicate_numbers.append(board.board_number)
            report.rejections.append(RowRejection(
                board.board_number, "duplicate_grid_num",
                "board number already seen in this archive",
            ))
            continue
        held_by = by_date.get(board.board_date)
        if held_by is not None:
            report.duplicate_dates.append(board.board_date.isoformat())
            report.rejections.append(RowRejection(
                board.board_number, "duplicate_date",
                f"{board.board_date.isoformat()} is already held by board #{held_by}",
            ))
            continue

        by_number[board.board_number] = board
        by_date[board.board_date] = board.board_number
        report.boards.append(board)
        if board.unsupported_count:
            report.unsupported_rows.append(board.board_number)
        if board.note:
            report.noted_rows.append(board.board_number)

    if by_number:
        low, high = min(by_number), max(by_number)
        report.missing_numbers = [n for n in range(low, high + 1) if n not in by_number]

    return report


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


@dataclass
class PersistOutcome:
    """What the importer did, or would do, board by board."""

    inserted: list[int] = field(default_factory=list)
    unchanged: list[int] = field(default_factory=list)
    conflicts: list[tuple[int, str]] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.conflicts


def resolve_grid_source_id(conn: Any) -> int:
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM external_grid_sources WHERE code = %s", (GRID_SOURCE_CODE,))
        row = cur.fetchone()
    if row is None:
        raise TargetValidationError(
            f"external_grid_sources has no row for {GRID_SOURCE_CODE!r}; "
            "apply migration 080 first (npm run db:migrate)"
        )
    return row[0]


def load_current_state(conn: Any, source_id: int) -> tuple[dict[int, str], dict[str, int]]:
    """Current revisions already captured from this provenance.

    Returns board_number -> payload_sha256, and board_date -> board_number. The
    second is what lets a date collision be reported as a conflict instead of
    surfacing as a unique-index violation halfway through a write.
    """
    with conn.cursor() as cur:
        cur.execute(
            """SELECT board_number, board_date, payload_sha256
                 FROM external_grids
                WHERE source_id = %s AND provenance = %s AND is_current""",
            (source_id, PROVENANCE),
        )
        rows = cur.fetchall()
    by_number = {int(r[0]): str(r[2]).strip() for r in rows}
    by_date = {r[1].isoformat(): int(r[0]) for r in rows}
    return by_number, by_date


def classify(
    boards: Sequence[LegacyBoard],
    existing_by_number: dict[int, str],
    existing_by_date: dict[str, int],
) -> PersistOutcome:
    """Decide insert / unchanged / conflict for every board. Writes nothing.

    Shared by the dry run and the real import, so what a dry run reports is
    what the import does, not a parallel implementation of it.
    """
    outcome = PersistOutcome()
    for board in boards:
        held = existing_by_number.get(board.board_number)
        if held is not None:
            if held == board.payload_sha256:
                outcome.unchanged.append(board.board_number)
            else:
                outcome.conflicts.append((
                    board.board_number,
                    f"captured board differs: stored {held[:12]}..., archive "
                    f"{board.payload_sha256[:12]}.... Refusing to overwrite captured evidence.",
                ))
            continue
        date_holder = existing_by_date.get(board.board_date.isoformat())
        if date_holder is not None and date_holder != board.board_number:
            outcome.conflicts.append((
                board.board_number,
                f"{board.board_date.isoformat()} is already held by captured board "
                f"#{date_holder}. Board number and date disagree between captures.",
            ))
            continue
        outcome.inserted.append(board.board_number)
    return outcome


def insert_board(conn: Any, source_id: int, batch_id: int, board: LegacyBoard) -> None:
    """Append one board revision and its six axes. Never an UPDATE.

    revision and is_current take their column defaults (1, true): this
    importer only ever captures a board that is not there yet. Superseding a
    revision belongs to the acquisition path in a later stage, which is why
    the import role's only UPDATE is on is_current.
    """
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO external_grids
                   (source_id, provenance, board_number, board_date,
                    payload_sha256, raw_payload, fetched_at, import_batch_id)
               VALUES (%s, %s, %s, %s, %s, %s::jsonb, NULL, %s)
            RETURNING id""",
            (
                source_id, PROVENANCE, board.board_number, board.board_date,
                board.payload_sha256, canonical_json(board.raw_payload), batch_id,
            ),
        )
        grid_id = cur.fetchone()[0]
        cur.executemany(
            """INSERT INTO external_grid_axes
                   (grid_id, orientation, position, raw_label)
               VALUES (%s, %s, %s, %s)""",
            [(grid_id, orientation, position, label)
             for orientation, position, label in board.axes()],
        )


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def _sample(values: Sequence[Any], limit: int = 10) -> str:
    shown = ", ".join(str(v) for v in values[:limit])
    return shown + (f" (+{len(values) - limit} more)" if len(values) > limit else "")


def print_source_report(report: SourceReport, source_info: dict[str, Any]) -> None:
    boards = report.boards
    print("Source")
    print(f"  table                : {source_info['table']} ({source_info['rows']} row(s))")
    print(f"  rows read            : {report.rows_read}")
    print(f"  boards parsed        : {len(boards)}")
    print(f"  rows rejected        : {len(report.rejections)}")
    if boards:
        numbers = [b.board_number for b in boards]
        dates = [b.board_date for b in boards]
        print(f"  board number range   : #{min(numbers)} - #{max(numbers)}")
        print(f"  board date range     : {min(dates).isoformat()} - {max(dates).isoformat()}")
        print(f"  distinct numbers     : {len(set(numbers))}")
        print(f"  distinct dates       : {len(set(dates))}")
        print(f"  axis occurrences     : {len(boards) * 2 * AXIS_LENGTH}")
        labels = [label for b in boards for _, _, label in b.axes()]
        print(f"  distinct raw labels  : {len(set(labels))}")
    print(f"  gaps in number range : {len(report.missing_numbers)}"
          + (f" - {_sample(report.missing_numbers)}" if report.missing_numbers else ""))
    print(f"  duplicate numbers    : {len(report.duplicate_numbers)}"
          + (f" - {_sample(report.duplicate_numbers)}" if report.duplicate_numbers else ""))
    print(f"  duplicate dates      : {len(report.duplicate_dates)}"
          + (f" - {_sample(report.duplicate_dates)}" if report.duplicate_dates else ""))
    print(f"  rows with unsupported: {len(report.unsupported_rows)}"
          + (f" - {_sample(report.unsupported_rows)}" if report.unsupported_rows else ""))
    print(f"  rows with a note     : {len(report.noted_rows)}"
          + (f" - {_sample(report.noted_rows)}" if report.noted_rows else ""))

    if report.rejections:
        print("\nRejected rows (nothing is written while any row is rejected)")
        by_reason: dict[str, int] = {}
        for rejection in report.rejections:
            by_reason[rejection.reason] = by_reason.get(rejection.reason, 0) + 1
        for reason in sorted(by_reason):
            print(f"  {reason:<28} {by_reason[reason]}")
        for rejection in report.rejections[:20]:
            print(f"    {rejection.describe()}")
        if len(report.rejections) > 20:
            print(f"    (+{len(report.rejections) - 20} more)")


def print_outcome(outcome: PersistOutcome, dry_run: bool) -> None:
    verb = "would insert" if dry_run else "inserted"
    print("\nPostgreSQL")
    print(f"  {verb:<21}: {len(outcome.inserted)}")
    print(f"  {'unchanged':<21}: {len(outcome.unchanged)}")
    print(f"  {'conflicts':<21}: {len(outcome.conflicts)}")
    for number, detail in outcome.conflicts[:20]:
        print(f"    board #{number}: {detail}")
    if len(outcome.conflicts) > 20:
        print(f"    (+{len(outcome.conflicts) - 20} more)")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Import the rescued Gridley board archive (AFLDB-ISSUE-118 Stage 1).",
    )
    parser.add_argument("--sqlite", metavar="PATH",
                        help=f"legacy SQLite archive (default: ${DEFAULT_SQLITE_ENV})")
    parser.add_argument("--dry-run", action="store_true",
                        help="validate and classify without writing anything")
    parser.add_argument("--no-db", action="store_true",
                        help="source-side validation only; never contacts PostgreSQL "
                             "(requires --dry-run)")
    parser.add_argument("--limit", type=int, metavar="N",
                        help="read only the first N boards by number (diagnostics)")
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
        # A partial rescue that reports "OK" is how a half-imported corpus
        # gets mistaken for a complete one. Diagnostics only.
        print("ERROR: --limit is a dry-run diagnostic; pass --dry-run as well.",
              file=sys.stderr)
        return 2

    load_env()
    try:
        sqlite_path = resolve_sqlite_path(args.sqlite)
    except SourceValidationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    mode = "dry run (no database)" if args.no_db else "dry run" if args.dry_run else "import"
    print(f"AFLDB external grid import - {mode}")
    print(f"  archive : {sqlite_path} (read-only)")
    print(f"  target  : external_grids / external_grid_axes, provenance {PROVENANCE}\n")

    con = open_legacy(sqlite_path)
    try:
        source_info = validate_source(con)
        report = collect_boards(con, args.limit)
    except SourceValidationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        con.close()

    print_source_report(report, source_info)

    if not report.ok:
        print("\nFAILED: the archive did not validate. Nothing was written.", file=sys.stderr)
        return 1
    if not report.boards:
        print("\nFAILED: the archive produced no boards.", file=sys.stderr)
        return 1

    if args.no_db:
        print("\nPostgreSQL")
        print("  skipped              : --no-db, so nothing was classified or written")
        print(f"\nOK: {len(report.boards)} board(s) validated. No database was contacted.")
        return 0

    # Database path. Imported here, not at module scope: see the module
    # docstring — --no-db must run where psycopg is not installed.
    from common import connect_pg, import_batch  # noqa: PLC0415

    conn = connect_pg()
    try:
        source_id = resolve_grid_source_id(conn)
        existing_by_number, existing_by_date = load_current_state(conn, source_id)
        outcome = classify(report.boards, existing_by_number, existing_by_date)

        if args.dry_run:
            # No import batch: opening one INSERTs a row and commits it, which
            # is a write. Nothing above this point wrote anything either, so
            # the rollback is belt and braces over a read-only transaction.
            conn.rollback()
            print_outcome(outcome, dry_run=True)
            if not outcome.ok:
                print("\nFAILED: captured boards conflict with the archive. "
                      "Nothing would be written.", file=sys.stderr)
                return 1
            print(f"\nOK: {len(report.boards)} board(s) validated, "
                  f"{len(outcome.inserted)} would be inserted, "
                  f"{len(outcome.unchanged)} already captured. Nothing was written.")
            return 0

        to_insert = set(outcome.inserted)
        with import_batch(conn, INGEST_SOURCE_KEY, TOOL_NAME, "external_grids") as batch:
            batch.records_read = report.rows_read
            for board in report.boards:
                if board.board_number not in to_insert:
                    continue
                insert_board(conn, source_id, batch.id, board)
                batch.records_inserted += 1
            for number, detail in outcome.conflicts:
                batch.reject(str(number), "captured_board_conflict", {"detail": detail})
            conn.commit()

        print_outcome(outcome, dry_run=False)
        if not outcome.ok:
            print("\nCOMPLETED WITH CONFLICTS: captured evidence was left untouched. "
                  "Each conflict is recorded against the import batch.", file=sys.stderr)
            return 1
        print(f"\nOK: {len(outcome.inserted)} board(s) inserted, "
              f"{len(outcome.unchanged)} already captured.")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(run())
