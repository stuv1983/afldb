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


# --------------------------------------------------------------------------
# Keyed reload (AFLDB-ISSUE-044)
# --------------------------------------------------------------------------
# A repeatable source can be reloaded in two ways. TRUNCATE-and-COPY is the
# simplest, and it is what every honours loader used to do — but it throws the
# target rows away, and with them their surrogate ids. Those ids are not
# private bookkeeping: player_link_resolutions.target_id points at them, so a
# reload discarded every manual identity decision an admin had recorded and
# left its audit row pointing at an id that no longer exists.
#
# reload_keyed() reloads the same source by its own key instead. Matched rows
# are UPDATEd in place, so ``id`` survives; new keys are inserted; keys the
# source no longer carries are deleted. Human decisions recorded in
# player_link_resolutions are then re-applied on top of the refreshed source
# facts, because the honours row itself cannot tell a human link from an
# import-derived one — both end up as player_id + 'resolved'.
#
# Nothing is written until every decision has been classified. A decision that
# cannot be carried safely — because the source name changed under the key, or
# the key disappeared entirely — aborts the reload before the first UPDATE, so
# the caller's transaction rolls back with the target table untouched.


class LinkDecisionLoss(RuntimeError):
    """A reload would discard or reattribute a human identity decision."""


@dataclass
class DiscardedDecision:
    """One human decision a reload cannot carry across, and why."""

    table: str
    target_id: int
    key: str
    name: str | None
    reason: str
    action: str
    player_id: int | None

    def describe(self) -> str:
        who = f"player {self.player_id}" if self.player_id is not None else "no player"
        return (
            f"{self.table} id={self.target_id} key=[{self.key}] "
            f"name={self.name!r} decision={self.action} ({who}): {self.reason}"
        )


@dataclass
class ReloadStats:
    """What a keyed reload actually did, for the run report."""

    inserted: int = 0
    updated: int = 0
    deleted: int = 0
    preserved: int = 0
    disagreements: list[str] = field(default_factory=list)
    discarded: list[DiscardedDecision] = field(default_factory=list)


_INCOMING = "_afldb_incoming"
_DECISIONS = "_afldb_decisions"


def _scope_clause(
    alias: str,
    scope_column: str | None,
    scope_values: Sequence[Any],
    scope_exclude: bool,
) -> str:
    """Predicate limiting a reload to the rows this loader owns.

    An empty value list is resolved here rather than sent to PostgreSQL: an
    empty Python list adapts to an untyped ``'{}'``, which cannot be compared
    with an integer column.
    """
    if scope_column is None:
        return "TRUE"
    if not scope_values:
        return "TRUE" if scope_exclude else "FALSE"
    operator = "<> ALL" if scope_exclude else "= ANY"
    return f"{alias}.{scope_column} {operator}(%s)"


def _key_match(left: str, right: str, key_columns: Sequence[str]) -> str:
    """NULL-safe key equality: hall_of_fame keys on a nullable year."""
    return " AND ".join(
        f"{left}.{col} IS NOT DISTINCT FROM {right}.{col}" for col in key_columns
    )


def reload_keyed(
    conn: psycopg.Connection,
    table: str,
    key_columns: Sequence[str],
    columns: Sequence[str],
    rows: Iterable[Sequence[Any]],
    batch: ImportBatch | None = None,
    *,
    target_table: str | None = None,
    link_columns: Sequence[str] | None = ("player_id", "link_status_value"),
    name_column: str | None = "player_name_raw",
    scope_column: str | None = None,
    scope_values: Sequence[Any] = (),
    scope_exclude: bool = False,
    allow_link_loss: bool = False,
    delete_missing: bool = True,
) -> ReloadStats:
    """Reload ``table`` from ``rows`` by key, preserving ids and decisions.

    ``target_table`` is the player_link_resolutions vocabulary name for this
    table. Passing ``link_columns=None`` — as ``awards`` does — means the table
    bears no player link at all: no resolution is read and no link column is
    referenced, so the helper is usable for plain reference data too.

    ``delete_missing=False`` upserts without removing vanished keys. A parent
    whose children are reconciled by a later call needs this: draft_persons is
    referenced by draft_picks under a NO ACTION foreign key, so a person can
    only be deleted once its picks have been, which is a different statement's
    job (AFLDB-ISSUE-078).
    """
    key_columns = list(key_columns)
    columns = list(columns)
    link_columns = list(link_columns or [])
    if not link_columns:
        target_table = None
        name_column = None
    missing = [c for c in (*key_columns, *link_columns) if c not in columns]
    if missing:
        raise ValueError(f"{table}: key/link columns not loaded: {', '.join(missing)}")

    scope_values = list(scope_values)
    scope_e = _scope_clause("e", scope_column, scope_values, scope_exclude)
    scope_params = [scope_values] if "%s" in scope_e else []
    collist = ", ".join(columns)
    stats = ReloadStats()

    with conn.cursor() as cur:
        cur.execute(f"DROP TABLE IF EXISTS {_INCOMING}")
        cur.execute(
            f"CREATE TEMP TABLE {_INCOMING} AS "
            f"SELECT {collist} FROM public.{table} WITH NO DATA"
        )

    copy_rows(conn, _INCOMING, columns, rows)

    with conn.cursor() as cur:
        # The reload key must actually be a key. migration 059 replaced
        # honour_team_uq with two partial indexes, so a duplicated source key
        # there would no longer be caught by a constraint: it would make the
        # UPDATE pick an arbitrary source row and the INSERT double the row.
        # Fail loudly instead, which is what migration 042 set out to buy.
        cur.execute(
            f"""SELECT {', '.join(f'{c}::text' for c in key_columns)}, count(*)
                  FROM {_INCOMING}
                 GROUP BY {', '.join(str(n) for n in range(1, len(key_columns) + 1))}
                HAVING count(*) > 1
                 LIMIT 5"""
        )
        duplicates = cur.fetchall()
        if duplicates:
            listed = "; ".join(
                f"[{' | '.join(str(v) for v in row[:-1])}] x{row[-1]}"
                for row in duplicates
            )
            raise RuntimeError(
                f"{table}: the source supplied duplicate reload keys "
                f"({', '.join(key_columns)}): {listed}. Nothing has been written."
            )

        if target_table is not None:
            cur.execute(f"DROP TABLE IF EXISTS {_DECISIONS}")
            # The latest decision per target is the operative one: the audit
            # trail is append-only, so a corrected decision is a newer row.
            cur.execute(
                f"""CREATE TEMP TABLE {_DECISIONS} AS
                    SELECT DISTINCT ON (target_id)
                           target_id, action, player_id
                      FROM player_link_resolutions
                     WHERE target_table = %s
                     ORDER BY target_id, created_at DESC, id DESC""",
                (target_table,),
            )

            # ----------------------------------------------------------------
            # Classify every decision BEFORE anything is written.
            # ----------------------------------------------------------------
            key_expr = ", ".join(f"e.{col}::text" for col in key_columns)
            name_expr = f"e.{name_column}" if name_column else "NULL::text"
            incoming_name = f"i.{name_column}" if name_column else "NULL::text"
            cur.execute(
                f"""SELECT e.id,
                           concat_ws(' | ', {key_expr}) AS key_text,
                           {name_expr} AS existing_name,
                           d.action, d.player_id AS decided_player,
                           i.ctid IS NOT NULL AS matched,
                           {incoming_name} AS incoming_name,
                           i.player_id AS incoming_player
                      FROM public.{table} e
                      JOIN {_DECISIONS} d ON d.target_id = e.id
                      LEFT JOIN {_INCOMING} i
                             ON {_key_match('e', 'i', key_columns)}
                     WHERE {scope_e}""",
                tuple(scope_params),
            )
            for (row_id, key_text, existing_name, action, decided_player,
                 matched, incoming_name_value, incoming_player) in cur.fetchall():
                if not matched:
                    stats.discarded.append(DiscardedDecision(
                        table, row_id, key_text, existing_name,
                        "the source no longer carries this key",
                        action, decided_player,
                    ))
                    continue
                if name_column and existing_name != incoming_name_value:
                    stats.discarded.append(DiscardedDecision(
                        table, row_id, key_text, existing_name,
                        f"the source name changed to {incoming_name_value!r}",
                        action, decided_player,
                    ))
                    continue
                stats.preserved += 1
                if (action == "linked" and incoming_player is not None
                        and incoming_player != decided_player):
                    stats.disagreements.append(
                        f"{table} id={row_id} [{key_text}] {existing_name!r}: the "
                        f"source now links player {incoming_player}, an admin "
                        f"linked player {decided_player}; keeping the admin's "
                        f"decision — review it"
                    )
                elif action == "confirmed_unlinked" and incoming_player is not None:
                    stats.disagreements.append(
                        f"{table} id={row_id} [{key_text}] {existing_name!r}: the "
                        f"source now links player {incoming_player}, an admin "
                        f"confirmed this row is genuinely unlinked; keeping it "
                        f"unlinked — review it"
                    )

            if stats.discarded and not allow_link_loss:
                raise LinkDecisionLoss(
                    f"{len(stats.discarded)} human identity decision(s) cannot "
                    f"survive this {table} reload; nothing has been written:\n  "
                    + "\n  ".join(d.describe() for d in stats.discarded)
                    + "\nReview them in /admin/player-links, or rerun with "
                      "--allow-link-loss to discard them deliberately."
                )

            # Carry each decision onto its incoming row so the UPDATE below is
            # a plain two-table join rather than a per-row correlated lookup.
            name_guard = (
                f"e.{name_column} = i.{name_column}" if name_column else "TRUE"
            )
            cur.execute(
                f"""ALTER TABLE {_INCOMING}
                      ADD COLUMN _dec_action text,
                      ADD COLUMN _dec_player integer,
                      ADD COLUMN _dec_status text"""
            )
            cur.execute(
                f"""UPDATE {_INCOMING} i
                       SET _dec_action = d.action,
                           _dec_player = d.player_id,
                           _dec_status = e.link_status_value::text
                      FROM public.{table} e
                      JOIN {_DECISIONS} d ON d.target_id = e.id
                     WHERE {scope_e}
                       AND {_key_match('e', 'i', key_columns)}
                       AND {name_guard}""",
                tuple(scope_params),
            )

        # --------------------------------------------------------------------
        # Write. Matched rows keep their id; only their columns change.
        # --------------------------------------------------------------------
        plain = [c for c in columns if c not in key_columns and c not in link_columns]
        assignments = [f"{c} = i.{c}" for c in plain]
        if link_columns and target_table is not None:
            assignments += [
                "player_id = CASE i._dec_action"
                " WHEN 'linked' THEN i._dec_player"
                " WHEN 'confirmed_unlinked' THEN NULL"
                " ELSE i.player_id END",
                "link_status_value = CASE i._dec_action"
                " WHEN 'linked' THEN 'resolved'::link_status"
                " WHEN 'confirmed_unlinked' THEN i._dec_status::link_status"
                " ELSE i.link_status_value END",
            ]
        else:
            assignments += [f"{c} = i.{c}" for c in link_columns]

        cur.execute(
            f"""UPDATE public.{table} e
                   SET {', '.join(assignments)}
                  FROM {_INCOMING} i
                 WHERE {scope_e}
                   AND {_key_match('e', 'i', key_columns)}""",
            tuple(scope_params),
        )
        stats.updated = cur.rowcount

        cur.execute(
            f"""INSERT INTO public.{table} ({collist})
                SELECT {', '.join('i.' + c for c in columns)}
                  FROM {_INCOMING} i
                 WHERE NOT EXISTS (
                         SELECT 1 FROM public.{table} e
                          WHERE {scope_e}
                            AND {_key_match('e', 'i', key_columns)})""",
            tuple(scope_params),
        )
        stats.inserted = cur.rowcount

        if delete_missing:
            cur.execute(
                f"""DELETE FROM public.{table} e
                     WHERE {scope_e}
                       AND NOT EXISTS (
                             SELECT 1 FROM {_INCOMING} i
                              WHERE {_key_match('e', 'i', key_columns)})""",
                tuple(scope_params),
            )
            stats.deleted = cur.rowcount

        cur.execute(f"DROP TABLE IF EXISTS {_INCOMING}")
        if target_table is not None:
            cur.execute(f"DROP TABLE IF EXISTS {_DECISIONS}")

    if batch is not None:
        batch.records_inserted += stats.inserted
        batch.records_updated += stats.updated

    return stats


def report_reload(rep: Any, label: str, stats: ReloadStats) -> None:
    """Print a keyed reload's decision outcome. Loss is always itemised."""
    if stats.preserved:
        rep.result(f"  {label} decisions preserved", stats.preserved)
    for message in stats.disagreements:
        rep.warn(message)
    if stats.discarded:
        rep.warn(
            f"--allow-link-loss: DISCARDING {len(stats.discarded)} human "
            f"identity decision(s) on {label}:"
        )
        for discarded in stats.discarded:
            rep.warn(f"  {discarded.describe()}")


# Tables the current run undertakes to rebuild. None means "everything":
# a full reload repopulates whatever CASCADE empties, so there is nothing
# to protect against. A partial run sets this to the tables its selected
# groups actually write, and truncate() then refuses to empty anything
# outside it.
_reload_scope: set[str] | None = None


def set_reload_scope(tables: Iterable[str] | None) -> None:
    """Declare which tables this run will rebuild.

    A partial reload is the dangerous case: TRUNCATE ... CASCADE reaches
    every table with a foreign key onto the one being emptied, so
    reloading only the reference group would silently take the match and
    statistics tables with it and then finish, reporting success, with
    the database missing 700K rows.
    """
    global _reload_scope
    _reload_scope = None if tables is None else {normalise_table(t) for t in tables}


def normalise_table(name: str) -> str:
    """Compare table names without the public schema qualifier."""
    lowered = name.strip().lower().replace('"', "")
    return lowered[len("public."):] if lowered.startswith("public.") else lowered


def cascade_dependents(conn: psycopg.Connection, tables: Sequence[str]) -> set[str]:
    """Tables TRUNCATE ... CASCADE would also empty, transitively."""
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH RECURSIVE fk AS (
              SELECT c.conrelid::regclass::text  AS child,
                     c.confrelid::regclass::text AS parent
                FROM pg_constraint c
               WHERE c.contype = 'f' AND c.conrelid <> c.confrelid
            ),
            seed AS (
              SELECT unnest(%s::text[])::regclass::text AS t
            ),
            reached AS (
              SELECT fk.child FROM fk JOIN seed ON fk.parent = seed.t
              UNION
              SELECT fk.child FROM fk JOIN reached r ON fk.parent = r.child
            )
            SELECT DISTINCT child FROM reached
            """,
            (list(tables),),
        )
        return {normalise_table(r[0]) for r in cur.fetchall()}


def truncate(conn: psycopg.Connection, *tables: str) -> None:
    """Truncate tables, making reruns idempotent.

    RESTART IDENTITY is deliberately not used: it requires ownership of
    the underlying sequence, and the import role owns no schema objects.
    Tables whose ids must stay stable across reloads (players, matches)
    are loaded with explicit ids and have their sequence fast-forwarded
    with setval() afterwards.

    CASCADE is required — the dependants must go for the parent to be
    replaceable — but it is only safe when this run rebuilds them. See
    set_reload_scope().
    """
    if not tables:
        return

    if _reload_scope is not None:
        dependents = cascade_dependents(conn, list(tables))
        unrebuilt = sorted(dependents - _reload_scope - {normalise_table(t) for t in tables})
        if unrebuilt:
            raise RuntimeError(
                "refusing to TRUNCATE "
                + ", ".join(tables)
                + ": CASCADE would also empty "
                + ", ".join(unrebuilt)
                + ", which this run does not rebuild.\n"
                "Run the full import, add the groups that rebuild those tables, "
                "or pass --allow-cascade if emptying them is genuinely intended."
            )

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
