"""Shared infrastructure for AFLDB migration and import tooling.

Provides connection handling, import-batch tracking and bulk-load
helpers used by every importer.

Design notes
------------
* The legacy SQLite database is opened strictly read-only. AFLDB never
  writes to Sports Data Lab data.
* Every import runs inside an ``ImportBatch``, which records counts and
  status even when the import fails. A batch that raises is marked
  ``failed`` with the error text rather than disappearing.
* Rejected rows are written to ``import_rejections``; they are never
  silently dropped.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

import psycopg

# --------------------------------------------------------------------------
# Environment
# --------------------------------------------------------------------------


def load_env(env_path: Path | None = None) -> None:
    """Load KEY=VALUE pairs from .env into os.environ (no overwrite)."""
    path = env_path or Path(__file__).resolve().parents[2] / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"ERROR: required environment variable {name} is not set.")
    return value


def safe_dsn(dsn: str) -> str:
    """Connection string with the password removed, safe to log."""
    try:
        from urllib.parse import urlparse

        u = urlparse(dsn)
        return f"{u.username}@{u.hostname}:{u.port}{u.path}"
    except Exception:
        return "<connection>"


# --------------------------------------------------------------------------
# Connections
# --------------------------------------------------------------------------


def connect_legacy(path: str | None = None) -> sqlite3.Connection:
    """Open the legacy AFL SQLite database read-only."""
    db_path = path or require_env("AFLDB_LEGACY_SQLITE")
    if not Path(db_path).exists():
        sys.exit(f"ERROR: legacy database not found: {db_path}")
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def connect_pg(dsn: str | None = None) -> psycopg.Connection:
    return psycopg.connect(dsn or require_env("AFLDB_IMPORT_DATABASE_URL"))


# --------------------------------------------------------------------------
# Value coercion
# --------------------------------------------------------------------------


def to_int(value: Any) -> int | None:
    """Coerce a legacy REAL/TEXT counter to int, preserving NULL.

    The legacy schema stores integral counters as REAL and some numeric
    fields as TEXT. NULL must survive as None: a missing statistic means
    "not recorded", never zero.
    """
    if value is None or value == "":
        return None
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def to_bool(value: Any) -> bool:
    return bool(value) and value not in (0, "0", "", "false", "False")


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


# --------------------------------------------------------------------------
# Import batch tracking
# --------------------------------------------------------------------------


@dataclass
class ImportBatch:
    """Tracks one import run in ``import_batches``."""

    conn: psycopg.Connection
    source_key: str
    tool: str
    target_table: str | None = None
    notes: str | None = None

    id: int = field(init=False, default=0)
    records_read: int = field(init=False, default=0)
    records_inserted: int = field(init=False, default=0)
    records_updated: int = field(init=False, default=0)
    _rejections: list[tuple[str | None, str, str | None]] = field(
        init=False, default_factory=list
    )

    def __post_init__(self) -> None:
        with self.conn.cursor() as cur:
            cur.execute("SELECT id FROM sources WHERE key = %s", (self.source_key,))
            row = cur.fetchone()
            if row is None:
                raise ValueError(f"unknown source key: {self.source_key!r}")
            source_id = row[0]
            cur.execute(
                """INSERT INTO import_batches (source_id, tool, target_table, notes)
                   VALUES (%s, %s, %s, %s) RETURNING id""",
                (source_id, self.tool, self.target_table, self.notes),
            )
            self.id = cur.fetchone()[0]
        self.conn.commit()

    def reject(self, source_record_id: str | None, reason: str, payload: Any = None) -> None:
        """Record a row that could not be imported."""
        self._rejections.append(
            (source_record_id, reason, json.dumps(payload, default=str) if payload else None)
        )

    def finish(self, status: str = "completed", error: str | None = None,
               validation: dict[str, Any] | None = None) -> None:
        with self.conn.cursor() as cur:
            if self._rejections:
                cur.executemany(
                    """INSERT INTO import_rejections
                         (import_batch_id, source_record_id, reason, payload)
                       VALUES (%s, %s, %s, %s)""",
                    [(self.id, sid, reason, payload) for sid, reason, payload in self._rejections],
                )
            cur.execute(
                """UPDATE import_batches
                      SET completed_at = now(), status = %s,
                          records_read = %s, records_inserted = %s,
                          records_updated = %s, records_rejected = %s,
                          validation_result = %s, error = %s
                    WHERE id = %s""",
                (
                    status,
                    self.records_read,
                    self.records_inserted,
                    self.records_updated,
                    len(self._rejections),
                    json.dumps(validation) if validation else None,
                    error,
                    self.id,
                ),
            )
        self.conn.commit()


@contextmanager
def import_batch(conn: psycopg.Connection, source_key: str, tool: str,
                 target_table: str | None = None) -> Iterator[ImportBatch]:
    """Run a block as a tracked import batch.

    On success the batch is marked ``completed``; on exception it is
    marked ``failed`` with the error recorded, and the exception
    propagates.
    """
    batch = ImportBatch(conn=conn, source_key=source_key, tool=tool, target_table=target_table)
    try:
        yield batch
    except Exception as exc:  # noqa: BLE001 - recorded then re-raised
        conn.rollback()
        batch.finish(status="failed", error=f"{type(exc).__name__}: {exc}")
        raise
    else:
        batch.finish(status="completed")


# --------------------------------------------------------------------------
# Bulk loading
# --------------------------------------------------------------------------


def copy_rows(conn: psycopg.Connection, table: str, columns: Sequence[str],
              rows: Iterable[Sequence[Any]], batch: ImportBatch | None = None) -> int:
    """Bulk-load rows with COPY. Returns the number of rows written."""
    collist = ", ".join(columns)
    count = 0
    with conn.cursor() as cur:
        with cur.copy(f"COPY {table} ({collist}) FROM STDIN") as copy:
            for row in rows:
                copy.write_row(row)
                count += 1
    if batch is not None:
        batch.records_inserted += count
    return count


def truncate(conn: psycopg.Connection, *tables: str) -> None:
    """Truncate tables, making reruns idempotent.

    RESTART IDENTITY is deliberately not used: it requires ownership of
    the underlying sequence, and the import role owns no schema objects.
    Tables whose ids must stay stable across reloads (players, matches)
    are loaded with explicit ids and have their sequence fast-forwarded
    with setval() afterwards.
    """
    if not tables:
        return
    with conn.cursor() as cur:
        cur.execute(f"TRUNCATE {', '.join(tables)} CASCADE")


def scalar(conn: psycopg.Connection, sql: str, params: Sequence[Any] = ()) -> Any:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
        return row[0] if row else None


def analyze(conn: psycopg.Connection, *tables: str) -> None:
    """ANALYZE after bulk load so the planner has real statistics.

    ANALYZE runs outside a transaction, so any open one is committed
    first: autocommit cannot be toggled while a transaction is in
    progress.
    """
    conn.commit()
    old_autocommit = conn.autocommit
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            for table in tables:
                cur.execute(f"ANALYZE {table}")
    finally:
        conn.autocommit = old_autocommit


# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------


class Reporter:
    """Consistent, quiet-by-default progress output."""

    def __init__(self, verbose: bool = True) -> None:
        self.verbose = verbose

    def step(self, message: str) -> None:
        if self.verbose:
            print(f"  {message}", flush=True)

    def result(self, label: str, count: int, detail: str = "") -> None:
        if self.verbose:
            suffix = f"  {detail}" if detail else ""
            print(f"    {label:<34} {count:>9,}{suffix}", flush=True)

    def warn(self, message: str) -> None:
        print(f"    WARNING: {message}", flush=True)
