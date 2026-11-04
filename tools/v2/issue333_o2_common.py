"""ISSUE-333 (O1) and O2: what the two narrowly scoped production writers share. No SQL write lives here.

  * a timezone-invariant, type-explicit digest of database rows (timestamps are normalised to UTC ISO, so a session TimeZone never changes a
    digest; plan-review F-001);
  * the in-transaction proof of what THIS transaction wrote, read from pg_stat_xact_user_tables (per-table insert/update/delete counters of the
    current transaction, including anything a trigger wrote), compared with the exact expected write set;
  * the in-transaction identity and privilege proof of the write session;
  * the owner's no-apply window around the nightly timers (plan-review F-002).
"""
from __future__ import annotations

import datetime as _dt
import decimal
import hashlib
import json
from zoneinfo import ZoneInfo

HOST_ZONE = ZoneInfo("Australia/Melbourne")
# Host-local window in which no production apply may start: the AFL Tables timer (disabled today) is 04:30 + up to 15 min and the AFL API timer
# 05:00 + up to 15 min, both Persistent; the capture script's own band is 04:00-05:30. 04:15-05:30 covers both with margin (plan-review F-002).
NO_APPLY_WINDOW = ((4, 15), (5, 30))
WRITER_SETTINGS = (("TimeZone", "UTC"), ("lock_timeout", "5s"), ("statement_timeout", "300s"), ("idle_in_transaction_session_timeout", "120s"))


class Refused(Exception):
    """A precondition failed; nothing was written."""


def norm(v):
    """One stable JSON-able rendering per value type."""
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, _dt.datetime):
        if v.tzinfo is None:
            raise Refused("a timestamp without time zone was read where a timestamptz was expected; refusing to digest it")
        return v.astimezone(_dt.timezone.utc).isoformat()
    if isinstance(v, (_dt.date, _dt.time)):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return str(v)
    if isinstance(v, (dict, list)):
        return json.loads(json.dumps(v, sort_keys=True))
    return str(v)


def canon(v) -> str:
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha(b: bytes | str) -> str:
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode()).hexdigest()


def rows_digest(rows) -> str:
    """sha256 of the canonical JSON of every row (every column, in the order read). The caller orders the rows."""
    return sha(canon([[norm(x) for x in r] for r in rows]))


def in_no_apply_window(t: _dt.datetime) -> bool:
    local = t.astimezone(HOST_ZONE)
    (h0, m0), (h1, m1) = NO_APPLY_WINDOW
    return (h0, m0) <= (local.hour, local.minute) < (h1, m1)


def configure_writer(cur) -> dict:
    """SET LOCAL the writer settings inside the open transaction and read them back."""
    for name, value in WRITER_SETTINGS:
        cur.execute("SELECT set_config(%s, %s, true)", (name, value))
    cur.execute("SELECT current_setting('TimeZone'), current_setting('lock_timeout'), current_setting('statement_timeout'), current_setting('transaction_read_only'), "
                "current_setting('track_counts')")
    tz, lt, st, ro, tc = cur.fetchone()
    if tz != "UTC" or ro != "off":
        raise Refused("the write transaction is not UTC / not writable")
    if tc != "on":
        raise Refused("track_counts is off: the in-transaction write accounting (pg_stat_xact_user_tables) would be blind")
    return {"TimeZone": tz, "lock_timeout": lt, "statement_timeout": st, "transaction_read_only": ro, "track_counts": tc}


ISOLATED_DB = r"afldb_v2_[a-z0-9_]+_test"


def rehearsal_target_ok(plan: dict, database: str) -> None:
    """A rehearsal plan only ever writes an isolated afldb_v2_*_test database, and a production plan never does (review F-003)."""
    import re
    if bool(plan.get("rehearsal")) != bool(re.fullmatch(ISOLATED_DB, database)):
        raise Refused("a rehearsal plan writes only an isolated afldb_v2_*_test database, and a production plan never does")


# The live-writer probe (review F-001). datid, usesysid and application_name of pg_stat_activity are visible to every role, so the read-only
# plan/probe role can see that a writer backend still exists even though it cannot see its state or query. A probe never classifies while one
# exists: a killed writer's COMMIT may still be in flight on the server.
LIVE_WRITER_SQL = ("SELECT pid FROM pg_stat_activity WHERE datid = (SELECT oid FROM pg_database WHERE datname = current_database()) "
                   "AND usesysid = (SELECT oid FROM pg_roles WHERE rolname = 'afldb_import') AND application_name = %s AND pid <> pg_backend_pid() ORDER BY pid")
LIVE_WRITER_WAIT_SECONDS = 30


def prove_write_identity(cur, target: dict, tables: tuple[str, ...]) -> dict:
    """The write session is afldb_import on exactly the reviewed database, and holds UPDATE on every relation it will lock (F-003)."""
    cur.execute("SELECT current_database(), current_user, c.system_identifier::text, d.oid::text, current_setting('cluster_name') "
                "FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database()")
    database, user, system_id, oid, cluster = cur.fetchone()
    if user != "afldb_import":
        raise Refused("the write session is not the afldb_import role")
    if (database, system_id, oid, cluster) != (target["database"], target["systemIdentifier"], target["databaseOid"], target["clusterName"]):
        raise Refused("the write session's database identity differs from the reviewed target")
    missing = []
    for t in tables:
        cur.execute("SELECT has_table_privilege(current_user, %s, 'UPDATE')", (t,))
        if not cur.fetchone()[0]:
            missing.append(t)
    if missing:
        raise Refused(f"the write role lacks UPDATE (needed to lock) on {missing}; no grant is made by this tool")
    return {"database": database, "user": user, "systemIdentifier": system_id, "databaseOid": oid}


def transaction_writes(cur) -> dict[str, list[int]]:
    """{schema.table: [inserted, updated, deleted]} written by THIS transaction so far (triggers included)."""
    cur.execute("SELECT schemaname || '.' || relname, n_tup_ins, n_tup_upd, n_tup_del FROM pg_stat_xact_user_tables "
                "WHERE n_tup_ins + n_tup_upd + n_tup_del > 0 ORDER BY 1")
    return {name: [int(i), int(u), int(d)] for name, i, u, d in cur.fetchall()}


def trigger_inventory(cur, tables: tuple[str, ...]) -> list[list[str]]:
    """Every user trigger on the touched tables (disclosed in the plan; equality is re-proven in the write transaction)."""
    cur.execute("SELECT c.relname::text, t.tgname::text, t.tgenabled::text, pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname || '.' || c.relname = ANY(%s) ORDER BY 1, 2", (list(tables),))
    return [list(r) for r in cur.fetchall()]
