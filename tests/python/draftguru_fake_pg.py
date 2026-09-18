#!/usr/bin/env python3
"""AFLDB-ISSUE-222 -- a scripted, in-memory stand-in for a psycopg connection.

Used by the DB-free contracts for the DraftGuru importer's transaction order
(``draftguru_import_atomicity_contract.py``) and for the read-only bridge-import gate
(``draftguru_import_gate_contract.py``). It records every statement, commit, rollback,
autocommit toggle and close in the order they happen, answers SELECTs from a list of
``(pattern, handler)`` responders, and can raise on a chosen statement so the caller's
rollback path is exercised. It never opens a socket and knows nothing about SQL semantics --
the responders are the contract author's model of what the real server would return.

No database connection, no network request, no Git command.
"""

from __future__ import annotations

import re
from typing import Any, Callable, Sequence

Responder = Callable[[str, Any], Any]


class InjectedFailure(RuntimeError):
    """Raised by a responder to simulate a server-side error on one statement."""


class FakeCopy:
    def __init__(self, conn: "FakeConnection", sql: str) -> None:
        self.conn = conn
        self.sql = sql
        self.rows: list[Sequence[Any]] = []

    def __enter__(self) -> "FakeCopy":
        return self

    def __exit__(self, *_exc) -> bool:
        self.conn.copies.append((self.sql, list(self.rows)))
        self.conn.log.append(("copy", self.sql, len(self.rows)))
        return False

    def write_row(self, row: Sequence[Any]) -> None:
        self.rows.append(tuple(row))


class FakeCursor:
    def __init__(self, conn: "FakeConnection") -> None:
        self.conn = conn
        self._rows: list[Any] = []
        self.rowcount = -1
        self.closed = False

    # -- context manager -------------------------------------------------
    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *_exc) -> bool:
        self.closed = True
        return False

    # -- execution -------------------------------------------------------
    def execute(self, sql: str, params: Any = None) -> "FakeCursor":
        if self.conn.closed:
            raise RuntimeError("cursor used on a closed connection")
        text = sql if isinstance(sql, str) else str(sql)
        self.conn.log.append(("execute", text, params))
        self.conn.statements.append((text, params))
        if not self.conn.autocommit and not self.conn.in_transaction:
            self.conn.in_transaction = True
            self.conn.log.append(("begin", None, None))
        result = self.conn.answer(text, params)
        if isinstance(result, tuple) and len(result) == 2 and result[0] == "__rowcount__":
            self._rows = []
            self.rowcount = int(result[1])
        else:
            self._rows = list(result or [])
            self.rowcount = len(self._rows)
        return self

    def executemany(self, sql: str, seq: Sequence[Any]) -> None:
        for params in seq:
            self.execute(sql, params)

    def copy(self, sql: str) -> FakeCopy:
        self.conn.log.append(("execute", sql, None))
        self.conn.statements.append((sql, None))
        if not self.conn.autocommit and not self.conn.in_transaction:
            self.conn.in_transaction = True
            self.conn.log.append(("begin", None, None))
        self.conn.answer(sql, None)          # lets a responder inject a failure on COPY
        return FakeCopy(self.conn, sql)

    # -- results ---------------------------------------------------------
    def fetchall(self) -> list[Any]:
        rows, self._rows = self._rows, []
        return rows

    def fetchone(self) -> Any:
        if not self._rows:
            return None
        row = self._rows[0]
        self._rows = self._rows[1:]
        return row

    def __iter__(self):
        return iter(self.fetchall())


class FakeConnection:
    """``responders``: ordered ``(regex, handler)`` pairs; the first regex whose ``search``
    matches the statement text wins. A handler returns a list of rows, or
    ``("__rowcount__", n)`` for a write statement, or raises. Unmatched statements return
    no rows with ``rowcount`` 0, except that an unmatched SELECT returns ``[]``."""

    def __init__(self, responders: Sequence[tuple[str, Responder]] = ()) -> None:
        self.responders: list[tuple[re.Pattern, Responder]] = [
            (re.compile(pattern, re.IGNORECASE | re.DOTALL), handler)
            for pattern, handler in responders
        ]
        self.log: list[tuple[str, Any, Any]] = []
        self.statements: list[tuple[str, Any]] = []
        self.copies: list[tuple[str, list[Sequence[Any]]]] = []
        self.commits = 0
        self.rollbacks = 0
        self.closed = False
        self.in_transaction = False
        self._autocommit = False
        self.read_only = False
        self.isolation_level = None

    # -- psycopg surface ------------------------------------------------
    @property
    def autocommit(self) -> bool:
        return self._autocommit

    @autocommit.setter
    def autocommit(self, value: bool) -> None:
        if value and self.in_transaction:
            raise RuntimeError("autocommit cannot be toggled while a transaction is in progress")
        self._autocommit = bool(value)
        self.log.append(("autocommit", bool(value), None))

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)

    def commit(self) -> None:
        self.commits += 1
        self.in_transaction = False
        self.log.append(("commit", None, None))

    def rollback(self) -> None:
        self.rollbacks += 1
        self.in_transaction = False
        self.log.append(("rollback", None, None))

    def close(self) -> None:
        self.closed = True
        self.log.append(("close", None, None))

    def __enter__(self) -> "FakeConnection":
        return self

    def __exit__(self, *_exc) -> bool:
        self.close()
        return False

    # -- scripting -------------------------------------------------------
    def answer(self, sql: str, params: Any) -> Any:
        for pattern, handler in self.responders:
            if pattern.search(sql):
                return handler(sql, params)
        head = sql.lstrip().split(None, 1)[0].upper() if sql.strip() else ""
        if head in ("SELECT", "WITH"):
            return []
        return ("__rowcount__", 0)

    # -- inspection helpers ---------------------------------------------
    def events(self) -> list[str]:
        """The log reduced to a readable event stream: 'commit', 'rollback',
        'autocommit=True', 'begin', 'close' or the first SQL token(s) of a statement."""
        out: list[str] = []
        for kind, payload, _ in self.log:
            if kind == "execute":
                text = " ".join(str(payload).split())
                out.append(text[:80])
            elif kind == "copy":
                out.append(f"COPY <{_}> rows")
            elif kind == "autocommit":
                out.append(f"autocommit={payload}")
            else:
                out.append(kind)
        return out

    def index_of(self, needle: str, *, start: int = 0) -> int:
        """Position in the log of the first statement containing ``needle`` (case-insensitive),
        or -1."""
        low = needle.lower()
        for i in range(start, len(self.log)):
            kind, payload, _ = self.log[i]
            if kind in ("execute", "copy") and low in str(payload).lower():
                return i
        return -1

    def indexes_of_kind(self, kind: str) -> list[int]:
        return [i for i, (k, _, _) in enumerate(self.log) if k == kind]


def rows(*values: Any) -> Responder:
    """A responder returning fixed rows."""
    fixed = list(values)
    return lambda _sql, _params: list(fixed)


def rowcount(n: int) -> Responder:
    return lambda _sql, _params: ("__rowcount__", n)


def fail(message: str = "injected server error") -> Responder:
    def _raise(_sql, _params):
        raise InjectedFailure(message)
    return _raise
