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
# Population reconciliation safety (AFLDB-ISSUE-092 Sec 4)
# --------------------------------------------------------------------------

# Legitimate run-to-run turnover of an effectively append-only external
# population (the AFL Tables register) should be far below this.
POPULATION_DROP_THRESHOLD = 0.10


class PopulationDropRefused(RuntimeError):
    """An authoritative reconciliation delete was refused fail-closed."""


def check_population_drop(
    *,
    stored_count: int,
    asserted_count: int,
    candidate_delete_count: int,
    label: str,
    acknowledged: bool = False,
    reporter: Any = None,
    threshold: float = POPULATION_DROP_THRESHOLD,
) -> None:
    """Fail-closed population-sanity gate for authoritative reconciliation
    deletes (AFLDB-ISSUE-092 Sec 4).

    A reconciliation pass that deletes stored rows absent from its input is
    correct only if that input is the complete current population. Callers
    must invoke this before the delete, with counts read before this run's
    writes:

    * stored_count            existing rows in the owned population
    * asserted_count          rows this run asserts as the population
    * candidate_delete_count  stored rows the delete would remove

    Check 1: asserting an empty population against existing rows is never
    legitimate and is refused unconditionally (not bypassable). Check 2: a
    drop of more than ``threshold`` of the stored population is refused
    unless ``acknowledged`` (the caller's explicit per-invocation
    ``--acknowledge-population-drop``), in which case the drop is reported
    via ``reporter.warn`` so its use is visible in run output.
    """
    if stored_count <= 0:
        return
    if asserted_count == 0:
        raise PopulationDropRefused(
            f"{label}: this run asserts an EMPTY population against "
            f"{stored_count} stored rows. Refusing the authoritative delete: "
            "the supplied source cannot be the complete population. "
            "This check is not bypassable."
        )
    if candidate_delete_count / stored_count > threshold:
        if not acknowledged:
            raise PopulationDropRefused(
                f"{label}: this run would delete {candidate_delete_count} of "
                f"{stored_count} stored rows "
                f"({candidate_delete_count / stored_count:.1%}), above the "
                f"{threshold:.0%} population-drop threshold. Refusing: the "
                "supplied source is not proven complete. Re-run with "
                "--acknowledge-population-drop only if this drop is genuinely "
                "intended."
            )
        if reporter is not None:
            reporter.warn(
                f"{label}: acknowledged population drop of "
                f"{candidate_delete_count} of {stored_count} stored rows "
                f"({candidate_delete_count / stored_count:.1%}) via "
                "--acknowledge-population-drop"
            )


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


class ReloadOwnershipCollision(RuntimeError):
    """An incoming reload key is already held by a row this loader does not own.

    A scoped reload's INSERT suppression test only sees in-scope rows, so an
    incoming key held by an out-of-scope row would reach INSERT and fail a
    unique constraint — or, on a table without a total constraint, silently
    duplicate the fact (AFLDB-ISSUE-080). Refusing before any write names the
    colliding rows instead of leaving a raw constraint error.
    """


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
    scopes: Sequence[tuple[str, Sequence[Any], bool]],
) -> tuple[str, list[Any]]:
    """Conjunction of predicates limiting a reload to the rows this loader owns.

    Each ``(column, values, exclude)`` entry becomes one predicate; entries are
    AND-joined so a domain predicate and a provenance predicate compose rather
    than replace each other (AFLDB-ISSUE-080). An empty value list is resolved
    here rather than sent to PostgreSQL: an empty Python list adapts to an
    untyped ``'{}'``, which cannot be compared with an integer column.
    """
    parts: list[str] = []
    params: list[Any] = []
    for column, values, exclude in scopes:
        values = list(values)
        if not values:
            parts.append("TRUE" if exclude else "FALSE")
            continue
        operator = "<> ALL" if exclude else "= ANY"
        parts.append(f"{alias}.{column} {operator}(%s)")
        params.append(values)
    if not parts:
        return "TRUE", []
    return " AND ".join(parts), params


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
    scopes: Sequence[tuple[str, Sequence[Any], bool]] = (),
    refuse_out_of_scope_key: bool = False,
    allow_link_loss: bool = False,
    delete_missing: bool = True,
) -> ReloadStats:
    """Reload ``table`` from ``rows`` by key, preserving ids and decisions.

    ``target_table`` is the player_link_resolutions vocabulary name for this
    table. Passing ``link_columns=None`` — as ``awards`` does — means the table
    bears no player link at all: no resolution is read and no link column is
    referenced, so the helper is usable for plain reference data too.

    ``scope_column``/``scope_values``/``scope_exclude`` is the single-predicate
    shorthand; ``scopes`` adds further ``(column, values, exclude)`` predicates,
    AND-joined with it, for loaders whose ownership is a conjunction of domain
    and provenance (AFLDB-ISSUE-080).

    ``refuse_out_of_scope_key=True`` (opt-in) refuses before any write when an
    incoming reload key is already held by an out-of-scope row, which the
    scoped INSERT suppression test cannot see. Only opt in where the reload key
    really is globally unique real-world identity — hall_of_fame's
    (name, inducted_year) qualifies; honour_team_members' raw name does not
    (migration 059 stopped treating raw name as identity). The check reads the
    table's ``source_id`` column to name the colliding row's owner.

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

    all_scopes: list[tuple[str, Sequence[Any], bool]] = []
    if scope_column is not None:
        all_scopes.append((scope_column, list(scope_values), scope_exclude))
    all_scopes.extend(scopes)
    scope_e, scope_params = _scope_clause("e", all_scopes)
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

        if refuse_out_of_scope_key:
            # AFLDB-ISSUE-080 check 1: an incoming key held by a row outside
            # the ownership scope would reach the scoped INSERT below and fail
            # its unique constraint with a raw error naming neither row. Key
            # equality is _key_match's, so this cannot disagree with the
            # UPDATE/INSERT/DELETE steps about what "the same key" means.
            # ``IS NOT TRUE`` is the scope's exact complement: a NULL-source
            # row makes ``source_id = ANY(...)`` evaluate NULL, not FALSE, and
            # such rows are precisely the ones this check exists to find.
            cur.execute(
                f"""SELECT e.id, e.source_id,
                           {', '.join(f'i.{c}::text' for c in key_columns)}
                      FROM {_INCOMING} i
                      JOIN public.{table} e
                        ON {_key_match('e', 'i', key_columns)}
                     WHERE ({scope_e}) IS NOT TRUE
                     ORDER BY e.id
                     LIMIT 5""",
                tuple(scope_params),
            )
            collisions = cur.fetchall()
            if collisions:
                listed = "; ".join(
                    f"row id={row[0]} source_id={row[1]} "
                    f"key=[{' | '.join(str(v) for v in row[2:])}]"
                    for row in collisions
                )
                raise ReloadOwnershipCollision(
                    f"{table}: the incoming source supplies reload key(s) "
                    f"({', '.join(key_columns)}) already held by row(s) this "
                    f"loader does not own: {listed}. Nothing has been written. "
                    f"A curator must reconcile each pair — merge the records "
                    f"or correct the existing row's provenance — before this "
                    f"reload can run."
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


def selectable(conn: psycopg.Connection, tables: Sequence[str]) -> set[str]:
    """Of `tables`, the ones the CURRENT role may SELECT.

    AFLDB-ISSUE-093 §H12. Asked of the catalogue, not of the tables:
    has_table_privilege() needs no privilege on its argument, so this can
    classify a relation the caller is forbidden to read without provoking
    the InsufficientPrivilege error it exists to avoid. One round trip,
    whatever the size of the list.

    A caller that instead probed each table with `SELECT count(*)` would
    fail on the first revoked relation -- which is precisely how the first
    clean rebuild died at the REFERENCE stage.
    """
    if not tables:
        return set()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT t FROM unnest(%s::text[]) AS t WHERE has_table_privilege(t, 'SELECT')",
            (list(tables),),
        )
        return {normalise_table(r[0]) for r in cur.fetchall()}


def any_rows(conn: psycopg.Connection, tables: Sequence[str]) -> list[str]:
    """Of `tables`, the ones that currently hold at least one row.

    EXISTS, not count(*): the question is only ever "is this empty", and on
    a large table the count is wasted work. The caller must have SELECT on
    every table it passes -- use selectable() first.
    """
    populated: list[str] = []
    for table in tables:
        if scalar(conn, f"SELECT EXISTS (SELECT 1 FROM {table})"):
            populated.append(table)
    return populated


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

# The frozen DraftGuru event-kind enumeration (migration 069). The ONE authority
# is data/reference/draftguru-event-kinds.json; this copy exists because the
# replay must fail closed WITHOUT reading a repository file at import time, and
# tests/data-overrides-source-contract.test.ts asserts the two are equal so they
# cannot drift. draft_kind is an enumeration and is NEVER derived from
# draft_type -- the 1981/1982/1987 pages carry no Draft column at all, and those
# 113 rows are ('National Draft', 'national') while every other national row is
# ('National', 'national').
MANUAL_DRAFT_KINDS = (
    "free_agency",
    "midseason",
    "mini_draft",
    "national",
    "post_draft",
    "pre_draft",
    "preseason",
    "rookie",
    "trade",
    "training_squad_selection",
)

# The season_list_members.origin enumeration (migration 096, AFLDB-ISSUE-161).
# The ONE authority is the CHECK constraint in that migration; this copy exists
# because the replay must fail closed WITHOUT reading the database schema, and
# tests/data-overrides-source-contract.test.ts asserts the two are equal so they
# cannot drift. There is deliberately no appearance-derived origin: D-2 forbids
# promoting match appearances into authoritative membership, so a player picked
# out of the non-authoritative appearances review panel is an ordinary 'added'
# row whose payload records candidate_source as evidence only.
SEASON_LIST_ORIGINS = (
    "added",
    "copied_list",
    "transferred",
    "imported",
)

# The fixtures.status enumeration (migration 097, AFLDB-ISSUE-162 D-2) and the
# round_type enum as migrations 003 and 084 leave it. The ONE authority for each
# is the database itself; these copies exist because the replay must fail closed
# WITHOUT reading the schema, and tests/data-overrides-source-contract.test.ts
# asserts they agree with the migrations so they cannot drift.
#
# 'cancelled' (a real scheduled event that did not happen) and 'void' (a row
# entered in error that was never a real event) are deliberately distinct and
# neither is a DELETE: a fixture row persists forever so its data_edits audit
# rows stay resolvable at the next promotion lineage remap.
FIXTURE_STATUSES = (
    "scheduled",
    "cancelled",
    "void",
)

FIXTURE_ROUND_TYPES = (
    "home_and_away",
    "wildcard_final",
    "elimination_final",
    "qualifying_final",
    "semi_final",
    "preliminary_final",
    "grand_final",
)


def replay_admin_overrides(conn: psycopg.Connection, table: str) -> None:
    """Replay durable admin overrides for the given table over newly imported rows.

    For DraftGuru integration (AFLDB-ISSUE-093), this helper can be called
    directly by the new draft importer without redesign. The canonical DraftGuru importer
    usage here is retained for historical compatibility on this branch.
    """
    with conn.cursor() as cur:
        if table == "players":
            # AFLDB-ISSUE-160 §8.1. Two key shapes share entity_type 'players':
            #
            #   'afltables:players/S/Some_Player0.html'  a source-owned player whose
            #                                            fields a human corrected
            #   'manual_admin_edit:<token>'              an admin-CREATED player, whose
            #                                            canonical row this replay is
            #                                            what re-creates after a
            #                                            destructive reload or a
            #                                            promotion
            #
            # The manual branch is the only place in the players replay that INSERTs a
            # canonical row, and it must be: players is rebuilt on promotion, so without
            # it an admin-created footballer does not survive the swap, and their
            # data_edits rows resolve to nothing and STOP the promotion (DEF-4a).
            #
            # Identity is never name-derived. The token is a randomUUID minted once by
            # createPlayerInTransaction() and never edited.
            #
            # Fail closed FIRST, over the whole active manual set, before anything is
            # written. An override whose payload cannot re-create a row is a human
            # decision this reload cannot honour, and a reload that silently drops one
            # is worse than a reload that stops.
            cur.execute("""
                SELECT o.entity_key,
                       CASE
                           WHEN o.override_values->>'display_name' IS NULL
                               THEN 'manual player override carries no display_name to re-create the row with'
                           WHEN length(substring(o.entity_key from position(':' in o.entity_key) + 1)) = 0
                               THEN 'entity_key carries no token'
                           WHEN o.override_values->>'dob' IS NOT NULL
                                 AND COALESCE(o.override_values->>'dob_confidence', 'unknown') = 'unknown'
                               THEN 'manual player override carries a dob with no dob_confidence '
                                    '(players_dob_confidence_ck, migration 018)'
                           WHEN jsonb_exists(o.override_values, 'afltables_profile_path')
                                 AND o.override_values->>'afltables_profile_path' IS NOT NULL
                                 AND (SELECT count(DISTINCT e.player_id)
                                        FROM external_identities e
                                        JOIN sources s ON s.id = e.source_id
                                       WHERE s.key = 'afltables'
                                         AND e.match_method = 'afltables_profile_url'
                                         AND e.status IN ('unique', 'resolved')
                                         AND e.player_id IS NOT NULL
                                         AND e.external_id = o.override_values->>'afltables_profile_path') > 1
                               THEN 'afltables_profile_path resolves to more than one player'
                       END AS problem
                  FROM data_overrides o
                 WHERE o.entity_type = 'players' AND o.is_active = true
                   AND split_part(o.entity_key, ':', 1) = 'manual_admin_edit'
            """)
            unresolvable = [(key, problem) for key, problem in cur.fetchall() if problem]
            if unresolvable:
                raise RuntimeError(
                    "replay_admin_overrides(players): refusing to commit, "
                    + str(len(unresolvable)) + " active manual override(s) do not resolve: "
                    + "; ".join(f"{key} -- {problem}" for key, problem in unresolvable[:10]))

            # Every manual override whose token names no identity in THIS database --
            # i.e. the player is missing, which is exactly the state a rebuilt candidate
            # is in. Guarded by NOT EXISTS rather than ON CONFLICT: players has no
            # natural unique key for a conflict target to name.
            cur.execute("""
                SELECT substring(o.entity_key from position(':' in o.entity_key) + 1) AS token,
                       o.override_values,
                       (SELECT min(e.player_id)
                          FROM external_identities e
                          JOIN sources s ON s.id = e.source_id
                         WHERE s.key = 'afltables'
                           AND e.match_method = 'afltables_profile_url'
                           AND e.status IN ('unique', 'resolved')
                           AND e.player_id IS NOT NULL
                           AND e.external_id = o.override_values->>'afltables_profile_path')
                           AS bound_player_id
                  FROM data_overrides o
                 WHERE o.entity_type = 'players' AND o.is_active = true
                   AND split_part(o.entity_key, ':', 1) = 'manual_admin_edit'
                   AND NOT EXISTS (
                         SELECT 1 FROM external_identities e
                           JOIN sources s ON s.id = e.source_id
                          WHERE s.key = 'manual_admin_edit'
                            AND e.external_id = substring(o.entity_key from position(':' in o.entity_key) + 1)
                            AND e.player_id IS NOT NULL)
                 ORDER BY o.entity_key
            """)
            pending_manual_players = cur.fetchall()

            for token, payload, bound_player_id in pending_manual_players:
                if bound_player_id is not None:
                    # The player ALREADY exists in this database under their AFL Tables
                    # profile, because they debuted and the rebuild created them from the
                    # source. Bind the token onto that row instead of creating a twin.
                    # This is what makes a promotion AFTER the debut produce one player,
                    # not two -- and it must happen before the data_edits remap, which is
                    # why the ordering players -> draft_picks is binding.
                    player_id = bound_player_id
                else:
                    # search_name, slug and sort_name are derived by the SAME expressions
                    # import_fitzroy_core.import_players() and createPlayerInTransaction()
                    # use, so a replayed twin is byte-identical to the row the admin typed.
                    cur.execute("""
                        INSERT INTO players
                              (display_name, given_name, surname, sort_name, search_name, slug,
                               dob, dob_confidence, birth_year, birth_year_confidence,
                               height_cm, weight_kg, notes)
                        SELECT %(display_name)s, %(given_name)s, %(surname)s,
                               CASE
                                   WHEN %(surname)s::text IS NULL THEN %(display_name)s::text
                                   WHEN %(given_name)s::text IS NULL THEN %(surname)s::text
                                   ELSE %(surname)s::text || ', ' || %(given_name)s::text
                               END,
                               afldb_normalise_name(%(display_name)s),
                               regexp_replace(afldb_normalise_name(%(display_name)s), '\\s+', '-', 'g'),
                               %(dob)s::date,
                               COALESCE(%(dob_confidence)s::value_confidence, 'unknown'),
                               %(birth_year)s::smallint,
                               COALESCE(%(dob_confidence)s::value_confidence, 'unknown'),
                               %(height_cm)s::smallint, %(weight_kg)s::smallint, %(notes)s
                        RETURNING id
                    """, {
                        "display_name": payload.get("display_name"),
                        "given_name": payload.get("given_name"),
                        "surname": payload.get("surname"),
                        "dob": payload.get("dob"),
                        "dob_confidence": payload.get("dob_confidence"),
                        "birth_year": payload.get("birth_year"),
                        "height_cm": payload.get("height_cm"),
                        "weight_kg": payload.get("weight_kg"),
                        "notes": payload.get("notes"),
                    })
                    player_id = cur.fetchone()[0]
                    # The derived rebuild regenerates the real figures; this is the same
                    # zero row createPlayerInTransaction() seeds.
                    cur.execute("""
                        INSERT INTO player_career_stats
                              (player_id, games, goals, finals, premierships, wins, draws, losses,
                               brownlow_votes, brownlow_medals, clubs_played, seasons_played,
                               behinds_recorded_games, kicks_recorded_games, handballs_recorded_games,
                               disposals_recorded_games, marks_recorded_games, tackles_recorded_games,
                               hitouts_recorded_games)
                        VALUES (%s, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
                        ON CONFLICT (player_id) DO NOTHING
                    """, (player_id,))

                cur.execute("""
                    INSERT INTO external_identities
                          (source_id, external_id, external_name, player_id,
                           status, candidate_count, match_method, notes)
                    VALUES ((SELECT id FROM sources WHERE key = 'manual_admin_edit'),
                            %s, %s, %s, 'resolved', 0, 'manual_admin_edit',
                            'Re-created from the durable admin record (AFLDB-ISSUE-160 §8.1).')
                    ON CONFLICT (source_id, external_id) DO NOTHING
                """, (token, payload.get("display_name"), player_id))

                # An attached AFL Tables path is a human decision too, and a rebuilt
                # candidate that lacks it would leave the player unreachable by the
                # source on the next import. Registered only when no other player
                # already holds it -- the pre-check proved at most one does.
                afl_path = payload.get("afltables_profile_path")
                if afl_path and bound_player_id is None:
                    cur.execute("""
                        INSERT INTO external_identities
                              (source_id, external_id, external_name, external_url, player_id,
                               status, candidate_count, match_method, notes)
                        SELECT (SELECT id FROM sources WHERE key = 'afltables'),
                               %(path)s, %(name)s,
                               'https://afltables.com/afl/stats/' || %(path)s, %(player_id)s,
                               'resolved', 0, 'afltables_profile_url',
                               'Re-created from the durable admin record (AFLDB-ISSUE-160 §8.1).'
                         WHERE NOT EXISTS (
                                 SELECT 1 FROM external_identities e
                                   JOIN sources s ON s.id = e.source_id
                                  WHERE s.key = 'afltables' AND e.external_id = %(path)s)
                    """, {"path": afl_path, "name": payload.get("display_name"),
                          "player_id": player_id})

            # display_name is NOT NULL (explicit NULL forbidden), so COALESCE is safe.
            # given_name, surname, dob, height_cm, weight_kg, notes are nullable (explicit NULL permitted),
            # so they must use jsonb_exists to distinguish absent vs explicit JSON null.
            cur.execute("""
                WITH active_overrides AS (
                    SELECT e.player_id, o.override_values
                      FROM data_overrides o
                      JOIN sources s ON s.key = split_part(o.entity_key, ':', 1)
                      JOIN external_identities e ON e.external_id = substring(o.entity_key from position(':' in o.entity_key) + 1)
                                                AND e.source_id = s.id
                                                AND e.status IN ('unique', 'resolved')
                     WHERE o.entity_type = 'players' AND o.is_active = true
                )
                UPDATE players p
                   SET display_name = COALESCE(o.override_values->>'display_name', p.display_name),
                       given_name = CASE WHEN jsonb_exists(o.override_values, 'given_name') THEN o.override_values->>'given_name' ELSE p.given_name END,
                       surname = CASE WHEN jsonb_exists(o.override_values, 'surname') THEN o.override_values->>'surname' ELSE p.surname END,
                       dob = CASE WHEN jsonb_exists(o.override_values, 'dob') THEN (o.override_values->>'dob')::date ELSE p.dob END,
                       dob_confidence = COALESCE((o.override_values->>'dob_confidence')::value_confidence, p.dob_confidence),
                       birth_year = CASE WHEN jsonb_exists(o.override_values, 'birth_year') THEN (o.override_values->>'birth_year')::smallint ELSE p.birth_year END,
                       birth_year_min = CASE WHEN jsonb_exists(o.override_values, 'birth_year_min') THEN (o.override_values->>'birth_year_min')::smallint ELSE p.birth_year_min END,
                       birth_year_max = CASE WHEN jsonb_exists(o.override_values, 'birth_year_max') THEN (o.override_values->>'birth_year_max')::smallint ELSE p.birth_year_max END,
                       birth_year_confidence = COALESCE((o.override_values->>'birth_year_confidence')::value_confidence, p.birth_year_confidence),
                       height_cm = CASE WHEN jsonb_exists(o.override_values, 'height_cm') THEN (o.override_values->>'height_cm')::smallint ELSE p.height_cm END,
                       weight_kg = CASE WHEN jsonb_exists(o.override_values, 'weight_kg') THEN (o.override_values->>'weight_kg')::smallint ELSE p.weight_kg END,
                       notes = CASE WHEN jsonb_exists(o.override_values, 'notes') THEN o.override_values->>'notes' ELSE p.notes END
                  FROM active_overrides o
                 WHERE p.id = o.player_id
            """)
            cur.execute("""
                UPDATE players
                   SET search_name = afldb_normalise_name(display_name),
                       sort_name = CASE
                           WHEN surname IS NULL THEN display_name
                           WHEN given_name IS NULL THEN surname
                           ELSE surname || ', ' || given_name
                       END
                 WHERE id IN (
                    SELECT e.player_id
                      FROM data_overrides o
                      JOIN sources s ON s.key = split_part(o.entity_key, ':', 1)
                      JOIN external_identities e ON e.external_id = substring(o.entity_key from position(':' in o.entity_key) + 1)
                                                AND e.source_id = s.id
                                                AND e.status IN ('unique', 'resolved')
                     WHERE o.entity_type = 'players' AND o.is_active = true
                 )
            """)

        elif table == "matches":
            # home_goals, away_goals are NOT NULL. attendance is nullable.
            cur.execute("""
                UPDATE matches m
                   SET attendance = CASE WHEN jsonb_exists(o.override_values, 'attendance') THEN (o.override_values->>'attendance')::integer ELSE m.attendance END,
                       attendance_status = CASE
                           WHEN jsonb_exists(o.override_values, 'attendance') THEN
                               CASE WHEN (o.override_values->>'attendance') IS NULL THEN 'not_collected'::coverage_status ELSE 'complete'::coverage_status END
                           ELSE m.attendance_status
                       END,
                       attendance_source_id = CASE
                           WHEN jsonb_exists(o.override_values, 'attendance') THEN
                               CASE WHEN (o.override_values->>'attendance') IS NULL THEN NULL ELSE (SELECT id FROM sources WHERE key = 'manual_admin_edit') END
                           ELSE m.attendance_source_id
                       END,
                       match_time = CASE WHEN jsonb_exists(o.override_values, 'match_time') THEN o.override_values->>'match_time' ELSE m.match_time END,
                       match_event = CASE WHEN jsonb_exists(o.override_values, 'match_event') THEN o.override_values->>'match_event' ELSE m.match_event END,
                       notes = CASE WHEN jsonb_exists(o.override_values, 'notes') THEN o.override_values->>'notes' ELSE m.notes END,
                       home_goals = COALESCE((o.override_values->>'home_goals')::smallint, m.home_goals),
                       home_behinds = COALESCE((o.override_values->>'home_behinds')::smallint, m.home_behinds),
                       away_goals = COALESCE((o.override_values->>'away_goals')::smallint, m.away_goals),
                       away_behinds = COALESCE((o.override_values->>'away_behinds')::smallint, m.away_behinds)
                  FROM data_overrides o
                 WHERE o.entity_type = 'matches' AND o.entity_key = m.match_key AND o.is_active = true
            """)
            # Recalculate derived score fields for overridden matches
            cur.execute("""
                UPDATE matches m
                   SET home_score = (home_goals * 6 + home_behinds)::smallint,
                       away_score = (away_goals * 6 + away_behinds)::smallint,
                       margin = abs((home_goals * 6 + home_behinds) - (away_goals * 6 + away_behinds))::smallint,
                       result = CASE
                           WHEN (home_goals * 6 + home_behinds) > (away_goals * 6 + away_behinds) THEN 'home_win'::match_result
                           WHEN (home_goals * 6 + home_behinds) < (away_goals * 6 + away_behinds) THEN 'away_win'::match_result
                           ELSE 'draw'::match_result
                       END,
                       winner_club_id = CASE
                           WHEN (home_goals * 6 + home_behinds) > (away_goals * 6 + away_behinds) THEN home_club_id
                           WHEN (home_goals * 6 + home_behinds) < (away_goals * 6 + away_behinds) THEN away_club_id
                           ELSE NULL
                       END
                 WHERE m.match_key IN (
                     SELECT entity_key FROM data_overrides
                      WHERE entity_type = 'matches' AND field_group = 'score' AND is_active = true
                 )
            """)
            # Period scores injection for score overrides
            cur.execute("""
                WITH overrides AS (
                    SELECT m.id AS match_id, m.home_club_id, m.away_club_id,
                           (o.override_values->>'home_goals')::int AS hg,
                           (o.override_values->>'home_behinds')::int AS hb,
                           (o.override_values->>'away_goals')::int AS ag,
                           (o.override_values->>'away_behinds')::int AS ab,
                           (SELECT GREATEST(COALESCE(max(period), 4), 4)::int FROM match_period_scores WHERE match_id = m.id) AS final_period
                      FROM data_overrides o
                      JOIN matches m ON m.match_key = o.entity_key
                     WHERE o.entity_type = 'matches' AND o.field_group = 'score' AND o.is_active = true
                )
                INSERT INTO match_period_scores (match_id, club_id, period, goals, behinds, points)
                SELECT match_id, home_club_id, final_period, hg, hb, (hg * 6 + hb) FROM overrides
                UNION ALL
                SELECT match_id, away_club_id, final_period, ag, ab, (ag * 6 + ab) FROM overrides
                ON CONFLICT (match_id, club_id, period) DO UPDATE SET
                  goals = EXCLUDED.goals,
                  behinds = EXCLUDED.behinds,
                  points = EXCLUDED.points
            """)

        elif table == "draft_picks":
            # AFLDB-ISSUE-160 §8.2. Two key shapes share entity_type 'draft_picks':
            #
            #   '<source_id>|<player_url>|<year>|<kind>'  a source-owned DraftGuru
            #                                             selection a human corrected
            #                                             (migration 069's reload key,
            #                                             unchanged -- R-7)
            #   'manual_admin_edit:<token>'               an admin-CREATED selection,
            #                                             whose canonical row this
            #                                             replay is what re-creates
            #
            # draft_picks is rebuilt on promotion, so without the manual branch an
            # admin-recorded selection simply does not exist in the promoted database
            # (DEF-4b). The manual row carries player_url = 'manual:<token>', which the
            # DraftGuru URL contract regex cannot match, so it lives inside 069's
            # partial unique index without ever colliding with a source row.
            #
            # ORDERING IS BINDING: replay_admin_overrides(players) runs FIRST, because a
            # manual selection's payload names its player by IDENTITY -- a token or an
            # AFL Tables path -- and that identity has to exist before this can resolve it.
            #
            # Fail closed FIRST, over the whole active manual set.
            cur.execute("""
                SELECT o.entity_key,
                       CASE
                           WHEN length(substring(o.entity_key from position(':' in o.entity_key) + 1)) = 0
                               THEN 'entity_key carries no token'
                           WHEN o.override_values->>'player_identity' IS NULL
                               THEN 'manual selection override names no player identity'
                           WHEN o.override_values->>'club_slug' IS NULL
                               THEN 'manual selection override names no club'
                           WHEN (SELECT count(*) FROM clubs c
                                  WHERE c.slug = o.override_values->>'club_slug') <> 1
                               THEN 'club_slug does not resolve to exactly one club'
                           WHEN o.override_values->>'draft_year' IS NULL
                                 OR o.override_values->>'draft_kind' IS NULL
                                 OR o.override_values->>'draft_type' IS NULL
                               THEN 'manual selection override is missing draft_year, draft_kind or draft_type'
                           WHEN NOT (o.override_values->>'draft_kind' = ANY(%(kinds)s))
                               THEN 'draft_kind is not one of the frozen draft event kinds'
                           WHEN (SELECT count(DISTINCT e.player_id)
                                   FROM external_identities e
                                   JOIN sources s ON s.id = e.source_id
                                  WHERE e.status IN ('unique', 'resolved')
                                    AND e.player_id IS NOT NULL
                                    AND s.key = split_part(o.override_values->>'player_identity', ':', 1)
                                    AND e.external_id = substring(o.override_values->>'player_identity'
                                                                  from position(':' in o.override_values->>'player_identity') + 1)
                                 ) <> 1
                               THEN 'player_identity does not resolve to exactly one player'
                       END AS problem
                  FROM data_overrides o
                 WHERE o.entity_type = 'draft_picks' AND o.is_active = true
                   AND split_part(o.entity_key, ':', 1) = 'manual_admin_edit'
            """, {"kinds": list(MANUAL_DRAFT_KINDS)})
            unresolvable = [(key, problem) for key, problem in cur.fetchall() if problem]
            if unresolvable:
                raise RuntimeError(
                    "replay_admin_overrides(draft_picks): refusing to commit, "
                    + str(len(unresolvable)) + " active manual override(s) do not resolve: "
                    + "; ".join(f"{key} -- {problem}" for key, problem in unresolvable[:10]))

            # The manual set, decoded once: the identity resolution and the two writes
            # below must never be able to disagree about what a key means.
            manual_decoded = """
                manual AS (
                    SELECT substring(o.entity_key from position(':' in o.entity_key) + 1) AS token,
                           o.override_values AS v,
                           (SELECT DISTINCT e.player_id
                              FROM external_identities e
                              JOIN sources s ON s.id = e.source_id
                             WHERE e.status IN ('unique', 'resolved')
                               AND e.player_id IS NOT NULL
                               AND s.key = split_part(o.override_values->>'player_identity', ':', 1)
                               AND e.external_id = substring(o.override_values->>'player_identity'
                                                             from position(':' in o.override_values->>'player_identity') + 1)
                           ) AS player_id,
                           (SELECT c.id FROM clubs c WHERE c.slug = o.override_values->>'club_slug') AS club_id,
                           (SELECT c.name FROM clubs c WHERE c.slug = o.override_values->>'club_slug') AS club_name
                      FROM data_overrides o
                     WHERE o.entity_type = 'draft_picks' AND o.is_active = true
                       AND split_part(o.entity_key, ':', 1) = 'manual_admin_edit'
                )
            """

            # 1. Re-create every admin-created selection the reload removed or that a
            #    rebuilt database never had.
            cur.execute("WITH " + manual_decoded + """
                INSERT INTO draft_picks
                      (draft_year, draft_type, draft_kind, pick_number, pick_note,
                       player_id, player_name_raw, link_status_value, candidate_count, match_method,
                       club_id, club_name_raw, original_club_raw,
                       draft_age, height_cm, weight_kg, detail,
                       source_id, source_record_id, player_url)
                SELECT (m.v->>'draft_year')::smallint, m.v->>'draft_type', m.v->>'draft_kind',
                       (m.v->>'pick_number')::smallint, m.v->>'pick_note',
                       m.player_id, COALESCE(m.v->>'player_name_raw', p.display_name),
                       'resolved', 0, 'manual_admin_edit',
                       m.club_id, m.club_name, m.v->>'original_club_raw',
                       (m.v->>'draft_age')::smallint, (m.v->>'height_cm')::smallint,
                       (m.v->>'weight_kg')::smallint, m.v->>'detail',
                       (SELECT id FROM sources WHERE key = 'manual_admin_edit'),
                       m.token, 'manual:' || m.token
                  FROM manual m
                  JOIN players p ON p.id = m.player_id
                 WHERE NOT EXISTS (
                         SELECT 1 FROM draft_picks d
                           JOIN sources s ON s.id = d.source_id
                          WHERE s.key = 'manual_admin_edit'
                            AND d.player_url = 'manual:' || m.token)
            """)

            # 2. Apply the payload to every manual row, so a corrected year, kind, pick,
            #    club or player link replays too. The override IS the row for a manual
            #    selection -- unlike a source-owned correction, which is a delta -- so
            #    this is an unconditional whole-row UPDATE, not a jsonb_exists patch.
            cur.execute("WITH " + manual_decoded + """
                UPDATE draft_picks d
                   SET draft_year = (m.v->>'draft_year')::smallint,
                       draft_type = m.v->>'draft_type',
                       draft_kind = m.v->>'draft_kind',
                       pick_number = (m.v->>'pick_number')::smallint,
                       pick_note = m.v->>'pick_note',
                       player_id = m.player_id,
                       player_name_raw = COALESCE(m.v->>'player_name_raw', d.player_name_raw),
                       link_status_value = 'resolved',
                       club_id = m.club_id,
                       club_name_raw = m.club_name,
                       original_club_raw = m.v->>'original_club_raw',
                       draft_age = (m.v->>'draft_age')::smallint,
                       height_cm = (m.v->>'height_cm')::smallint,
                       weight_kg = (m.v->>'weight_kg')::smallint,
                       detail = m.v->>'detail'
                  FROM manual m
                 WHERE d.player_url = 'manual:' || m.token
                   AND d.source_id = (SELECT id FROM sources WHERE key = 'manual_admin_edit')
            """)

            # 3. The source-owned patch, unchanged in shape and extended with the
            #    selection_facts group (pick_number, club) ISSUE-160 added to the editor
            #    spec. Every field is nullable, so absent-vs-explicit-null is preserved
            #    by jsonb_exists -- the migration-086 discipline. player_name_raw is
            #    NOT NULL, so it COALESCEs.
            cur.execute("""
                UPDATE draft_picks d
                   SET player_name_raw = COALESCE(o.override_values->>'player_name_raw', d.player_name_raw),
                       original_club_raw = CASE WHEN jsonb_exists(o.override_values, 'original_club_raw') THEN o.override_values->>'original_club_raw' ELSE d.original_club_raw END,
                       draft_age = CASE WHEN jsonb_exists(o.override_values, 'draft_age') THEN (o.override_values->>'draft_age')::integer ELSE d.draft_age END,
                       height_cm = CASE WHEN jsonb_exists(o.override_values, 'height_cm') THEN (o.override_values->>'height_cm')::integer ELSE d.height_cm END,
                       weight_kg = CASE WHEN jsonb_exists(o.override_values, 'weight_kg') THEN (o.override_values->>'weight_kg')::integer ELSE d.weight_kg END,
                       pick_note = CASE WHEN jsonb_exists(o.override_values, 'pick_note') THEN o.override_values->>'pick_note' ELSE d.pick_note END,
                       detail = CASE WHEN jsonb_exists(o.override_values, 'detail') THEN o.override_values->>'detail' ELSE d.detail END,
                       pick_number = CASE WHEN jsonb_exists(o.override_values, 'pick_number') THEN (o.override_values->>'pick_number')::smallint ELSE d.pick_number END,
                       club_id = CASE
                           WHEN jsonb_exists(o.override_values, 'club_slug')
                                AND o.override_values->>'club_slug' IS NOT NULL
                               THEN COALESCE((SELECT c.id FROM clubs c WHERE c.slug = o.override_values->>'club_slug'), d.club_id)
                           ELSE d.club_id END,
                       club_name_raw = CASE
                           WHEN jsonb_exists(o.override_values, 'club_slug')
                                AND o.override_values->>'club_slug' IS NOT NULL
                               THEN COALESCE((SELECT c.name FROM clubs c WHERE c.slug = o.override_values->>'club_slug'), d.club_name_raw)
                           ELSE d.club_name_raw END
                  FROM data_overrides o
                 WHERE o.entity_type = 'draft_picks'
                   AND o.entity_key = d.source_id::text || '|' || d.player_url || '|' || d.draft_year::text || '|' || d.draft_kind
                   AND o.is_active = true
            """)

        elif table == "coaches":
            # AFLDB-ISSUE-159 §6.1. Two key shapes, one entity_type:
            #
            #   'afltables:coaches/Chris_Fagan0.html'  a source-owned coach whose
            #                                          fields a human corrected
            #   'manual_admin_edit:<token>'            an admin-CREATED coach, whose
            #                                          canonical row this replay is
            #                                          what re-creates after a
            #                                          destructive reload or a promotion
            #
            # The manual branch is the only place in this function that INSERTs a
            # canonical row, and it must be: coaches is rebuilt on promotion, so
            # without it a manually created coach does not survive the swap.
            #
            # Identity is never name-derived. A manual coach's path and name_key are
            # both 'manual:' || <the token from the entity_key>, which migration 095's
            # coaches_path_namespace_ck / coaches_manual_identity_ck enforce.

            # Fail closed FIRST, on the whole active set, before anything is written.
            # An override whose key does not resolve is not skipped: it is a human
            # decision this reload cannot honour, and a reload that silently drops one
            # is worse than a reload that stops.
            cur.execute("""
                SELECT o.entity_key,
                       CASE
                           WHEN split_part(o.entity_key, ':', 1) NOT IN ('afltables', 'manual_admin_edit')
                               THEN 'entity_key does not name a known source'
                           WHEN position(':' in o.entity_key) = 0
                                 OR length(substring(o.entity_key from position(':' in o.entity_key) + 1)) = 0
                               THEN 'entity_key carries no external id'
                           WHEN split_part(o.entity_key, ':', 1) = 'afltables'
                                 AND NOT EXISTS (
                                     SELECT 1 FROM coaches c
                                      WHERE c.afltables_coach_path
                                            = substring(o.entity_key from position(':' in o.entity_key) + 1)
                                 )
                               THEN 'no coaches row carries that AFL Tables path'
                           WHEN split_part(o.entity_key, ':', 1) = 'manual_admin_edit'
                                 AND o.override_values->>'display_name' IS NULL
                               THEN 'manual coach override carries no display_name to re-create the row with'
                           WHEN jsonb_exists(o.override_values, 'player_id_identity')
                                 AND o.override_values->>'player_id_identity' IS NOT NULL
                                 AND (SELECT count(DISTINCT e.player_id)
                                        FROM external_identities e
                                        JOIN sources s ON s.id = e.source_id
                                       WHERE s.key = 'afltables'
                                         AND e.status IN ('unique', 'resolved')
                                         AND e.player_id IS NOT NULL
                                         AND e.external_id = o.override_values->>'player_id_identity') <> 1
                               THEN 'player_id_identity does not resolve to exactly one player'
                       END AS problem
                  FROM data_overrides o
                 WHERE o.entity_type = 'coaches' AND o.is_active = true
            """)
            unresolvable = [(key, problem) for key, problem in cur.fetchall() if problem]
            if unresolvable:
                raise RuntimeError(
                    "replay_admin_overrides(coaches): refusing to commit, "
                    + str(len(unresolvable)) + " active override(s) do not resolve: "
                    + "; ".join(f"{key} -- {problem}" for key, problem in unresolvable[:10]))

            # 1. Re-create every admin-created coach that the reload removed or that a
            #    rebuilt database never had. display_name is NOT NULL, so it is required
            #    rather than COALESCEd; everything else is nullable and absent-vs-explicit-
            #    null is preserved by jsonb_exists on the UPDATE arm.
            cur.execute("""
                INSERT INTO coaches (afltables_coach_path, name_key, display_name, given_name, surname, dob,
                                     source_id, source_record_id, notes)
                SELECT 'manual:' || substring(o.entity_key from position(':' in o.entity_key) + 1),
                       'manual:' || substring(o.entity_key from position(':' in o.entity_key) + 1),
                       o.override_values->>'display_name',
                       o.override_values->>'given_name',
                       o.override_values->>'surname',
                       (o.override_values->>'dob')::date,
                       (SELECT id FROM sources WHERE key = 'manual_admin_edit'),
                       substring(o.entity_key from position(':' in o.entity_key) + 1),
                       o.override_values->>'notes'
                  FROM data_overrides o
                 WHERE o.entity_type = 'coaches' AND o.is_active = true
                   AND split_part(o.entity_key, ':', 1) = 'manual_admin_edit'
                ON CONFLICT (afltables_coach_path) DO NOTHING
            """)

            # 2. Apply the overridden fields to both shapes. afltables_coach_path and
            #    name_key are identity and are never in override_values: the WHERE is
            #    what binds a decision to a row, so an override cannot move one.
            #    display_name is NOT NULL (COALESCE); the rest are nullable, so an
            #    explicit JSON null must clear the column and an ABSENT key must leave
            #    it alone -- the migration-086 discipline, jsonb_exists.
            cur.execute("""
                WITH active_overrides AS (
                    SELECT c.id AS coach_id, o.override_values
                      FROM data_overrides o
                      JOIN coaches c
                        ON c.afltables_coach_path = CASE split_part(o.entity_key, ':', 1)
                               WHEN 'manual_admin_edit'
                                   THEN 'manual:' || substring(o.entity_key from position(':' in o.entity_key) + 1)
                               ELSE substring(o.entity_key from position(':' in o.entity_key) + 1)
                           END
                     WHERE o.entity_type = 'coaches' AND o.is_active = true
                )
                UPDATE coaches c
                   SET display_name = COALESCE(o.override_values->>'display_name', c.display_name),
                       given_name = CASE WHEN jsonb_exists(o.override_values, 'given_name') THEN o.override_values->>'given_name' ELSE c.given_name END,
                       surname = CASE WHEN jsonb_exists(o.override_values, 'surname') THEN o.override_values->>'surname' ELSE c.surname END,
                       dob = CASE WHEN jsonb_exists(o.override_values, 'dob') THEN (o.override_values->>'dob')::date ELSE c.dob END,
                       notes = CASE WHEN jsonb_exists(o.override_values, 'notes') THEN o.override_values->>'notes' ELSE c.notes END,
                       -- Linkage moves as one fact or not at all: coaches_link_ck admits
                       -- only (player_id, 'unique') or (NULL, <> 'unique'), and
                       -- coaches_profile_link_ck requires a profile path alongside a
                       -- player. The decision is stored as the profile PATH, never a
                       -- player id -- player ids are rebuilt on promotion, paths are not.
                       player_id = CASE
                           WHEN NOT jsonb_exists(o.override_values, 'player_id_identity') THEN c.player_id
                           WHEN o.override_values->>'player_id_identity' IS NULL THEN NULL
                           -- Exactly one player, proven by the refusal above; no LIMIT,
                           -- so a second one would raise rather than be picked silently.
                           ELSE (SELECT DISTINCT e.player_id
                                   FROM external_identities e
                                   JOIN sources s ON s.id = e.source_id
                                  WHERE s.key = 'afltables'
                                    AND e.status IN ('unique', 'resolved')
                                    AND e.player_id IS NOT NULL
                                    AND e.external_id = o.override_values->>'player_id_identity')
                       END,
                       link_status_value = CASE
                           WHEN NOT jsonb_exists(o.override_values, 'player_id_identity') THEN c.link_status_value
                           WHEN o.override_values->>'player_id_identity' IS NULL THEN 'unmatched'::link_status
                           ELSE 'unique'::link_status
                       END,
                       afltables_profile_path = CASE
                           WHEN NOT jsonb_exists(o.override_values, 'player_id_identity') THEN c.afltables_profile_path
                           WHEN o.override_values->>'player_id_identity' IS NULL THEN NULL
                           ELSE o.override_values->>'player_id_identity'
                       END
                  FROM active_overrides o
                 WHERE c.id = o.coach_id
            """)

        elif table == "match_coaches":
            # AFLDB-ISSUE-159 §6.1 / D-4. entity_key is '<match_key>|<club slug>' and
            # override_values.coach_identity is an afltables_coach_path (a real one or a
            # 'manual:<token>' one) -- never a coach id, which a rebuild renumbers.
            #
            # This replay runs AFTER the source's own assignment upsert
            # (import_match_coaches.py §6.2) precisely so the human decision wins: the
            # (match_id, club_id) primary key carries no source, so the snapshot WILL
            # overwrite a manual assignment on a team-match the source later covers.
            # Replaying afterwards restores it, visibly and durably.
            #
            # DECODING THE COMPOSITE KEY. matches.match_key is ITSELF pipe-delimited --
            # 'season|round|date|home|away' (migration 003) -- so '<match_key>|<club
            # slug>' carries five delimiters, not one, and the club slug is the segment
            # after the LAST of them. split_part(entity_key, '|', 1) / (..., 2) reads
            # '1902' and '1' out of '1902|1|1902-05-03|Carlton|Geelong|carlton', which
            # resolves to nothing and refuses a perfectly good override.
            #
            # clubs.slug carries no '|', so the last delimiter is the only unambiguous
            # split point. The decode lives HERE, once, and both statements below read
            # it from the CTE: the refusal check and the write must never be able to
            # disagree about what a key means.
            decoded_overrides = """
                decoded AS (
                    SELECT o.entity_key,
                           o.override_values,
                           strpos(reverse(o.entity_key), '|')                          AS tail,
                           left(o.entity_key,
                                length(o.entity_key) - strpos(reverse(o.entity_key), '|')) AS match_key,
                           right(o.entity_key, strpos(reverse(o.entity_key), '|') - 1) AS club_slug
                      FROM data_overrides o
                     WHERE o.entity_type = 'match_coaches' AND o.is_active = true
                )
            """
            cur.execute("WITH " + decoded_overrides + """
                SELECT d.entity_key,
                       CASE
                           -- No final delimiter at all: the key is not a composite key,
                           -- so there is no club slug to read and nothing to resolve.
                           WHEN d.tail = 0
                               THEN 'entity_key is not <match_key>|<club slug>'
                           WHEN d.club_slug = ''
                               THEN 'entity_key ends in the delimiter and names no club'
                           WHEN NOT EXISTS (SELECT 1 FROM matches m WHERE m.match_key = d.match_key)
                               THEN 'no match carries that match_key'
                           WHEN NOT EXISTS (SELECT 1 FROM clubs cl WHERE cl.slug = d.club_slug)
                               THEN 'no club carries that slug'
                           WHEN NOT jsonb_exists(d.override_values, 'coach_identity')
                                 OR d.override_values->>'coach_identity' IS NULL
                               THEN 'override carries no coach_identity'
                           WHEN NOT EXISTS (SELECT 1 FROM coaches c
                                             WHERE c.afltables_coach_path = d.override_values->>'coach_identity')
                               THEN 'coach_identity resolves to no coach'
                       END AS problem
                  FROM decoded d
            """)
            unresolvable = [(key, problem) for key, problem in cur.fetchall() if problem]
            if unresolvable:
                raise RuntimeError(
                    "replay_admin_overrides(match_coaches): refusing to commit, "
                    + str(len(unresolvable)) + " active override(s) do not resolve: "
                    + "; ".join(f"{key} -- {problem}" for key, problem in unresolvable[:10]))

            # Every column of match_coaches is a key or provenance, so there is no
            # absent-vs-explicit-null field here: the one mutable fact is WHICH coach,
            # and it is required above. source_id names manual_admin_edit, which is also
            # what keeps the importer's stale-delete (scoped to the afltables source)
            # from ever removing a human assignment.
            cur.execute("WITH " + decoded_overrides + """
                INSERT INTO match_coaches (match_id, club_id, coach_id, source_id, source_record_id, import_batch_id)
                SELECT m.id, cl.id, c.id,
                       (SELECT id FROM sources WHERE key = 'manual_admin_edit'),
                       d.entity_key,
                       NULL
                  FROM decoded d
                  JOIN matches m ON m.match_key = d.match_key
                  JOIN clubs cl ON cl.slug = d.club_slug
                  JOIN coaches c ON c.afltables_coach_path = d.override_values->>'coach_identity'
                ON CONFLICT (match_id, club_id) DO UPDATE SET
                  coach_id = EXCLUDED.coach_id,
                  source_id = EXCLUDED.source_id,
                  source_record_id = EXCLUDED.source_record_id,
                  import_batch_id = EXCLUDED.import_batch_id
            """)

        elif table == "season_list_members":
            # AFLDB-ISSUE-161 §19. ONE key shape, and it is NATURAL rather than a
            # minted token:
            #
            #   '<club_slug>|<season>|<player identity>'
            #
            #      richmond|2027|afltables:players/D/Dustin_Martin0.html
            #      gold-coast|2027|manual_admin_edit:2f6c...
            #
            # A membership HAS a natural key, so minting one per row would let the
            # same player be recorded twice under two tokens and would make
            # copy-forward non-idempotent. Because the key is natural, re-adding a
            # removed player reactivates the SAME record instead of creating a
            # second one.
            #
            # season_list_members is an import-writable registry table: a promotion
            # rebuilds it and a destructive reload can empty it, so without this
            # branch an admin-authored playing list simply does not exist in the
            # promoted or rebuilt database. This is the only thing that puts it
            # back, and the list is not derivable from anything else -- "listed" is
            # not "played", and no source publishes historical lists.
            #
            # ORDERING IS BINDING: replay_admin_overrides(players) runs FIRST,
            # because a membership names its player by IDENTITY -- an AFL Tables
            # profile path or a manual_admin_edit token -- and that identity has to
            # exist before this can resolve it. It is independent of draft_picks,
            # coaches and match_coaches, and it needs no matches, no fixture and no
            # club_seasons row for the season: a list is administrative intent
            # about a season that may not have been played yet (§9.4).
            #
            # TOMBSTONES. Unlike every other branch in this function, this one acts
            # on INACTIVE overrides too. An inactive membership override is not an
            # absence of a decision -- it is the decision "this player is
            # deliberately NOT on that list", and it outranks every source (§7
            # precedence rule 1). So the replay DELETES any row it finds for a
            # tombstoned key, including one a future importer wrote, and it does so
            # BEFORE the active inserts: a stale row for the same (season, player)
            # at the club the player was moved away from would otherwise collide
            # with the UNIQUE and abort a reload that was about to become correct.
            membership_decoded = """
                raw AS (
                    SELECT o.is_active,
                           o.override_values AS v,
                           regexp_match(o.entity_key, '^([^|]+)\\|([0-9]{4})\\|(.+)$') AS parts,
                           o.entity_key
                      FROM data_overrides o
                     WHERE o.entity_type = 'season_list_members'
                ),
                -- The eligible identities per season, taken from the ONE rule the
                -- writers use (migration 096). LATERAL against a preceding FROM
                -- item, so the set-returning function is never called with an
                -- outer reference. A club renamed between the dump and the replay
                -- therefore resolves to the identity that is era-correct NOW.
                seasons_in_play AS (
                    SELECT DISTINCT (parts)[2]::smallint AS season FROM raw WHERE parts IS NOT NULL
                ),
                eligible AS (
                    SELECT sp.season, e.id, e.organization_id
                      FROM seasons_in_play sp, LATERAL afldb_season_list_clubs(sp.season) e
                ),
                membership AS (
                    SELECT r.entity_key, r.is_active, r.v, r.parts,
                           (r.parts)[2]::smallint AS season,
                           src.id AS source_club_id,
                           el.id AS club_id,
                           (SELECT count(DISTINCT ei.player_id)
                              FROM external_identities ei
                              JOIN sources s ON s.id = ei.source_id
                             WHERE ei.status IN ('unique', 'resolved')
                               AND ei.player_id IS NOT NULL
                               AND s.key = split_part((r.parts)[3], ':', 1)
                               AND ei.external_id = substring((r.parts)[3]
                                                              from position(':' in (r.parts)[3]) + 1)
                           ) AS identity_matches,
                           -- min(), not SELECT DISTINCT: the refusal above has
                           -- already proven there is exactly one, and min() cannot
                           -- raise a cardinality error that would be reported as a
                           -- crash instead of as the refusal it really is.
                           (SELECT min(ei.player_id)
                              FROM external_identities ei
                              JOIN sources s ON s.id = ei.source_id
                             WHERE ei.status IN ('unique', 'resolved')
                               AND ei.player_id IS NOT NULL
                               AND s.key = split_part((r.parts)[3], ':', 1)
                               AND ei.external_id = substring((r.parts)[3]
                                                              from position(':' in (r.parts)[3]) + 1)
                           ) AS player_id
                      FROM raw r
                      LEFT JOIN clubs src ON src.slug = (r.parts)[1]
                      LEFT JOIN eligible el ON el.season = (r.parts)[2]::smallint
                                           AND el.organization_id = src.organization_id
                )
            """

            # Fail closed FIRST, over EVERY override -- active AND inactive -- and
            # before anything is written. An override whose key does not resolve is
            # not skipped: it is a human decision this reload cannot honour, and a
            # reload that silently drops one is worse than a reload that stops.
            # A tombstone that cannot be resolved is just as serious as a membership
            # that cannot: failing to apply it RESURRECTS a player somebody
            # deliberately removed.
            cur.execute("WITH " + membership_decoded + """
                SELECT d.entity_key,
                       CASE
                           WHEN d.parts IS NULL
                               THEN 'entity_key is not <club_slug>|<season>|<player identity>'
                           WHEN d.season NOT BETWEEN 1897 AND 2100
                               THEN 'entity_key names a season outside the supported range'
                           WHEN d.source_club_id IS NULL
                               THEN 'club_slug does not resolve to exactly one club'
                           WHEN d.club_id IS NULL
                               THEN 'no club identity of that organisation is eligible in that season'
                           WHEN d.v->>'origin' IS NULL
                                 OR NOT (d.v->>'origin' = ANY(%(origins)s))
                               THEN 'membership override carries no valid origin'
                           WHEN d.identity_matches <> 1
                               THEN 'player_identity does not resolve to exactly one player'
                       END AS problem
                  FROM membership d
            """, {"origins": list(SEASON_LIST_ORIGINS)})
            unresolvable = [(key, problem) for key, problem in cur.fetchall() if problem]
            if unresolvable:
                raise RuntimeError(
                    "replay_admin_overrides(season_list_members): refusing to commit, "
                    + str(len(unresolvable)) + " override(s) do not resolve: "
                    + "; ".join(f"{key} -- {problem}" for key, problem in unresolvable[:10]))

            # 1. Tombstones win, and win first. Any row for an intentionally removed
            #    key goes -- whoever wrote it.
            cur.execute("WITH " + membership_decoded + """
                DELETE FROM season_list_members m
                 USING membership d
                 WHERE d.is_active = false
                   AND m.season = d.season
                   AND m.club_id = d.club_id
                   AND m.player_id = d.player_id
            """)

            # 2. Re-create every membership the reload removed, or that a rebuilt
            #    database never had. Guarded by NOT EXISTS on the (season, club,
            #    player) triple rather than ON CONFLICT: the UNIQUE is on (season,
            #    player), so a row for the SAME player at a DIFFERENT club is not a
            #    conflict to swallow -- it is a contradiction between two durable
            #    records, and it must surface as the error it is instead of being
            #    silently skipped.
            cur.execute("WITH " + membership_decoded + """
                INSERT INTO season_list_members
                      (season, club_id, player_id, source_id, origin, copied_from_season, note)
                SELECT d.season, d.club_id, d.player_id,
                       (SELECT id FROM sources WHERE key = 'manual_admin_edit'),
                       d.v->>'origin',
                       (d.v->>'copied_from_season')::smallint,
                       d.v->>'note'
                  FROM membership d
                 WHERE d.is_active = true
                   AND NOT EXISTS (
                         SELECT 1 FROM season_list_members m
                          WHERE m.season = d.season
                            AND m.club_id = d.club_id
                            AND m.player_id = d.player_id)
            """)

            # 3. The override IS the row for a membership -- there is no
            #    source-owned delta to preserve -- so this is an unconditional
            #    whole-row UPDATE of the three carried fields, not a jsonb_exists
            #    patch. A corrected origin or note replays too.
            cur.execute("WITH " + membership_decoded + """
                UPDATE season_list_members m
                   SET origin = d.v->>'origin',
                       copied_from_season = (d.v->>'copied_from_season')::smallint,
                       note = d.v->>'note',
                       updated_at = now()
                  FROM membership d
                 WHERE d.is_active = true
                   AND m.season = d.season
                   AND m.club_id = d.club_id
                   AND m.player_id = d.player_id
            """)

        elif table == "fixtures":
            # AFLDB-ISSUE-162 §20. ONE key shape, and it is a MINTED TOKEN
            # rather than a natural key:
            #
            #   'manual_admin_edit:<fixture_key>'
            #
            #      manual_admin_edit:3f8c2b1e-....-9d2a
            #
            # That is the OPPOSITE of the season_list_members choice above, and
            # for the opposite reason. A membership HAS a natural key (club,
            # season, player) that no edit can change. Every candidate natural
            # key for a fixture -- the date, the venue, even the round and the
            # club pair -- is a fact an administrator is EXPECTED to correct,
            # so a natural key would change identity on a reschedule, which is
            # exactly what fixture_key exists to prevent. The token is minted
            # once by createFixture() and never edited, and a played-match
            # association never replaces it with a match_key (the operator
            # constraint of 2026-09-11): fixtures carries no match_key and no
            # match_id column, and nothing in this branch renders, copies or
            # compares one.
            #
            # fixtures is an import-writable registry table: a promotion
            # rebuilds it and a destructive reload can empty it, so without
            # this branch an administered schedule simply does not exist in the
            # promoted or rebuilt database. This is the only thing that puts it
            # back, and it is not derivable from anything else -- a fixture is
            # what was SCHEDULED, matches holds what was PLAYED, and no source
            # publishes AFLDB-normalised historical schedules.
            #
            # ORDERING IS NOT BINDING. A fixture names its clubs by SLUG and
            # its venue by SLUG -- both tracked reference data loaded long
            # before any replay -- and it names no player, no match and no
            # draft selection. It therefore depends on no other replay branch
            # and may run anywhere in the loop. It is grouped with 'matches' at
            # the call site only to keep every match-shaped thing together.
            #
            # NO TOMBSTONES. Unlike season_list_members, every fixture override
            # is ACTIVE: the lifecycle lives in the payload's status, because a
            # cancelled or void fixture must be RE-CREATED here, not suppressed.
            # A fixture is never deleted (§16) precisely so that its data_edits
            # rows stay resolvable at the next promotion lineage remap, and a
            # replay that dropped the void rows would break that the moment it
            # ran.
            fixture_decoded = """
                raw AS (
                    SELECT o.entity_key,
                           o.override_values AS v,
                           split_part(o.entity_key, ':', 1) AS namespace,
                           substring(o.entity_key from position(':' in o.entity_key) + 1) AS token
                      FROM data_overrides o
                     WHERE o.entity_type = 'fixtures'
                       AND o.field_group = 'fixture'
                ),
                -- The season is decoded ONCE, guarded, before anything joins on
                -- it: an unparseable season must be reported as the refusal it
                -- is, not crash the replay with a cast error that names no key.
                decoded AS (
                    SELECT r.entity_key, r.v, r.namespace, r.token,
                           CASE WHEN (r.v->>'season') ~ '^[0-9]{4}$'
                                THEN (r.v->>'season')::smallint END AS season,
                           count(*) OVER (PARTITION BY r.token) AS token_count
                      FROM raw r
                ),
                -- The eligible identities per season, taken from the ONE rule
                -- the writers use (migration 096, AFLDB-ISSUE-161). LATERAL
                -- against a preceding FROM item, so the set-returning function
                -- is never called with an outer reference. A club renamed
                -- between the dump and the replay therefore resolves to the
                -- identity that is era-correct NOW.
                seasons_in_play AS (
                    SELECT DISTINCT season FROM decoded WHERE season IS NOT NULL
                ),
                eligible AS (
                    SELECT sp.season, e.id, e.organization_id
                      FROM seasons_in_play sp, LATERAL afldb_season_list_clubs(sp.season) e
                ),
                fixture AS (
                    SELECT d.entity_key, d.v, d.namespace, d.token, d.season, d.token_count,
                           hsrc.id AS home_source_club_id,
                           asrc.id AS away_source_club_id,
                           hel.id  AS home_club_id,
                           ael.id  AS away_club_id,
                           -- Venue is ENRICHMENT, not identity (003:74-75): an
                           -- unresolved slug degrades to the stored name and is
                           -- REPORTED, never fatal. A promotion is not stopped
                           -- by a venue rename.
                           ven.id  AS venue_id,
                           ven.canonical_name AS venue_canonical_name
                      FROM decoded d
                      LEFT JOIN clubs hsrc ON hsrc.slug = d.v->>'home_club_slug'
                      LEFT JOIN clubs asrc ON asrc.slug = d.v->>'away_club_slug'
                      LEFT JOIN eligible hel ON hel.season = d.season
                                            AND hel.organization_id = hsrc.organization_id
                      LEFT JOIN eligible ael ON ael.season = d.season
                                            AND ael.organization_id = asrc.organization_id
                      LEFT JOIN venues ven ON ven.slug = d.v->>'venue_slug'
                )
            """

            # Fail closed FIRST, over EVERY override, and before anything is
            # written. An override whose payload cannot re-create a row is a
            # human decision this reload cannot honour, and a reload that
            # silently drops one is worse than a reload that stops. There is no
            # fuzzy fallback anywhere: no name matching, no date tolerance and
            # no "nearest round".
            cur.execute("WITH " + fixture_decoded + """
                SELECT f.entity_key,
                       CASE
                           WHEN f.namespace <> 'manual_admin_edit' OR length(f.token) = 0
                               THEN 'entity_key is not manual_admin_edit:<token>'
                           WHEN f.token_count > 1
                               THEN 'more than one durable record claims this fixture_key'
                           WHEN f.v->>'fixture_key' IS DISTINCT FROM f.token
                               THEN 'payload fixture_key does not match the entity_key token'
                           WHEN f.season IS NULL OR f.season NOT BETWEEN 1897 AND 2100
                               THEN 'payload names no season in the supported range'
                           WHEN f.v->>'round_type' IS NULL
                                 OR NOT (f.v->>'round_type' = ANY(%(round_types)s))
                               THEN 'payload carries no valid round_type'
                           WHEN COALESCE(f.v->>'round_code', '') = ''
                               THEN 'payload carries no round_code'
                           WHEN f.v->>'round_type' = 'home_and_away'
                                 AND (f.v->>'round_number' IS NULL
                                      OR f.v->>'round_number' !~ '^[0-9]+$'
                                      OR f.v->>'round_code' <> f.v->>'round_number')
                               THEN 'a home-and-away fixture needs a round_number whose text is the round_code'
                           WHEN f.v->>'round_type' <> 'home_and_away'
                                 AND f.v->>'round_number' IS NOT NULL
                               THEN 'a finals fixture carries no round_number'
                           WHEN f.v->>'status' IS NULL
                                 OR NOT (f.v->>'status' = ANY(%(statuses)s))
                               THEN 'payload carries no valid status'
                           WHEN f.v->>'status' <> 'scheduled'
                                 AND COALESCE(f.v->>'status_reason', '') = ''
                               THEN 'a cancelled or void fixture needs a status_reason'
                           WHEN f.v->>'match_date' IS NOT NULL
                                 AND f.v->>'match_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                               THEN 'match_date is not YYYY-MM-DD'
                           WHEN f.v->>'match_time' IS NOT NULL AND f.v->>'match_date' IS NULL
                               THEN 'a start time cannot be stored without a date'
                           WHEN f.home_source_club_id IS NULL
                               THEN 'home_club_slug does not resolve to exactly one club'
                           WHEN f.away_source_club_id IS NULL
                               THEN 'away_club_slug does not resolve to exactly one club'
                           WHEN f.home_club_id IS NULL
                               THEN 'no home club identity is eligible in that season'
                           WHEN f.away_club_id IS NULL
                               THEN 'no away club identity is eligible in that season'
                           WHEN f.home_club_id = f.away_club_id
                               THEN 'both club slugs resolve to the same identity'
                       END AS problem
                  FROM fixture f
            """, {
                "round_types": list(FIXTURE_ROUND_TYPES),
                "statuses": list(FIXTURE_STATUSES),
            })
            unresolvable = [(key, problem) for key, problem in cur.fetchall() if problem]
            if unresolvable:
                raise RuntimeError(
                    "replay_admin_overrides(fixtures): refusing to commit, "
                    + str(len(unresolvable)) + " override(s) do not resolve: "
                    + "; ".join(f"{key} -- {problem}" for key, problem in unresolvable[:10]))

            # Venue degrades LOUDLY rather than silently: the fixture is still
            # re-created and its name still renders, and the count says how many
            # need a venue mapping in this database.
            cur.execute("WITH " + fixture_decoded + """
                SELECT count(*) FROM fixture f
                 WHERE f.v->>'venue_slug' IS NOT NULL AND f.venue_id IS NULL
            """)
            degraded = cur.fetchone()[0]
            if degraded:
                print("    WARNING: replay_admin_overrides(fixtures): "
                      + f"{degraded:,} fixture(s) name a venue slug this database does not "
                      + "have; kept as an unmapped venue name (venue_id NULL).", flush=True)

            # 1. Re-create every fixture the reload removed, or that a rebuilt
            #    database never had. Guarded by NOT EXISTS on fixture_key rather
            #    than ON CONFLICT so that a contradiction between two durable
            #    records surfaces through the uniqueness constraint as the error
            #    it is, instead of being silently swallowed.
            cur.execute("WITH " + fixture_decoded + """
                INSERT INTO fixtures
                      (fixture_key, season, round_code, round_number, round_type,
                       match_date, match_time, venue_id, venue_raw,
                       home_club_id, away_club_id, status, status_reason, notes,
                       source_id, source_record_id)
                SELECT f.token, f.season, f.v->>'round_code',
                       (f.v->>'round_number')::smallint,
                       (f.v->>'round_type')::round_type,
                       (f.v->>'match_date')::date,
                       f.v->>'match_time',
                       f.venue_id,
                       CASE WHEN f.venue_id IS NOT NULL THEN f.venue_canonical_name
                            ELSE f.v->>'venue_raw' END,
                       f.home_club_id, f.away_club_id,
                       f.v->>'status', f.v->>'status_reason', f.v->>'notes',
                       (SELECT id FROM sources WHERE key = 'manual_admin_edit'),
                       f.token
                  FROM fixture f
                 WHERE NOT EXISTS (
                         SELECT 1 FROM fixtures x WHERE x.fixture_key = f.token)
            """)

            # 2. The override IS the row for a fixture -- there is no
            #    source-owned delta to preserve -- so this is an unconditional
            #    whole-row UPDATE, not a jsonb_exists patch. It makes the replay
            #    idempotent, and it is what carries a reschedule, a venue
            #    change, a round correction, a club correction, a cancellation
            #    and a voiding across a rebuild. fixture_key is never in the SET
            #    list: the identity is the one thing a replay may not move.
            cur.execute("WITH " + fixture_decoded + """
                UPDATE fixtures x
                   SET season = f.season,
                       round_code = f.v->>'round_code',
                       round_number = (f.v->>'round_number')::smallint,
                       round_type = (f.v->>'round_type')::round_type,
                       match_date = (f.v->>'match_date')::date,
                       match_time = f.v->>'match_time',
                       venue_id = f.venue_id,
                       venue_raw = CASE WHEN f.venue_id IS NOT NULL THEN f.venue_canonical_name
                                        ELSE f.v->>'venue_raw' END,
                       home_club_id = f.home_club_id,
                       away_club_id = f.away_club_id,
                       status = f.v->>'status',
                       status_reason = f.v->>'status_reason',
                       notes = f.v->>'notes',
                       updated_at = now()
                  FROM fixture f
                 WHERE x.fixture_key = f.token
            """)
