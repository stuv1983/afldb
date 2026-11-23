"""Live-connection target guard for the destructive AFLW race test (AFLDB-ISSUE-368).

Scope: tests/python/aflw_staging_race.py and its child loader entry point tests/python/aflw_race_loader.py only.
tools/aflw/load_staging.py is untouched, so the normal loader keeps supporting its real targets.

Every connection that can write (the harness's writer, and every connection the child loader opens) is
checked on the connection itself, before its first statement of consequence:

  * the server-reported database (current_database()) equals the intended disposable database and ends in _test;
  * the transport is a Unix socket: the server sees no inet address for either end, and libpq reports an
    absolute socket directory as the host actually connected to.

The checks are explicit `if ...: refuse(...)`, never `assert`, so they hold under `python -O`. A refusal, or
any failure while checking, closes the connection and exits with REFUSAL_EXIT. A parent-process check or a
separate observer cannot establish where a child writes, which is why the child installs its own guard.
"""

import sys

REFUSAL_EXIT = 3
EXPECTED_ENV = "AFLW_RACE_EXPECTED_DATABASE"


def refuse(conn, label, reason):
    try:
        if conn is not None:
            conn.close()
    except Exception:
        pass
    print(f"REFUSED [{label}]: {reason}", file=sys.stderr)
    raise SystemExit(REFUSAL_EXIT)


def enforce(conn, expected_db, label):
    """Fail closed unless `conn` is a Unix-socket connection to the intended *_test database."""
    if not expected_db or not expected_db.endswith("_test"):
        refuse(conn, label, "the intended database is missing or does not end in _test")
    try:
        actual, server_no_inet, client_no_inet = conn.execute(
            "SELECT current_database(), inet_server_addr() IS NULL, inet_client_addr() IS NULL"
        ).fetchone()
        host = conn.info.host or ""
        conn.rollback()
    except Exception as exc:
        refuse(conn, label, f"could not verify the live connection ({type(exc).__name__})")
    if actual != expected_db:
        refuse(conn, label, f"the server reports database {actual!r}, not the intended {expected_db!r}")
    if not actual.endswith("_test"):
        refuse(conn, label, f"the server reports database {actual!r}, which does not end in _test")
    if not (server_no_inet and client_no_inet and host.startswith("/")):
        refuse(conn, label, "the connection is not over a Unix socket")


def connect_writer(psycopg, dsn, expected_db):
    conn = psycopg.connect(dsn)
    enforce(conn, expected_db, "writer")
    return conn


def install_connection_guard(psycopg, expected_db, label):
    """Make every psycopg connection opened in this process pass enforce() before it is returned."""
    original = psycopg.Connection.connect.__func__

    def guarded(cls, *args, **kwargs):
        conn = original(cls, *args, **kwargs)
        enforce(conn, expected_db, label)
        return conn

    psycopg.Connection.connect = classmethod(guarded)
    psycopg.connect = psycopg.Connection.connect
