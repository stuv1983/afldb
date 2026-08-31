#!/usr/bin/env python3
"""AFLDB-ISSUE-093 §H13 — BEHAVIOURAL contract for the reference loader's cascade guard.

    python tests/python/reference_cascade_contract.py

No database, no psycopg connection, no network: every scenario drives the REAL
guard_cascade() and reload_truncate() against a fake connection that answers the
three queries they issue and records what they asked for.

This exists because §H12's tests were source-string contracts. They asserted the
shape of the code and passed, while the control flow was wrong: the whole-union
emptiness short circuit could not fire, because migrations 015/016 seed
stat_definitions and stat_availability, so a freshly migrated database is never
fully empty. A behavioural test would have caught that; a string match could not.

Exit 0 = every scenario holds. Exit 1 = a scenario failed, and it says which.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "migration"))

import load_reference_data as loader  # noqa: E402


# ---------------------------------------------------------------------------
# The fake connection: answers exactly the queries the guard issues, and no more
# ---------------------------------------------------------------------------


class FakeCursor:
    def __init__(self, conn: "FakeConn") -> None:
        self.conn = conn
        self.rows: list[tuple] = []

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *exc) -> bool:
        return False

    def execute(self, sql: str, params=()) -> None:
        flat = " ".join(sql.split())
        self.conn.sql.append(flat)

        if flat.startswith("SELECT t FROM unnest"):
            self.conn.readability_checks += 1
            self.rows = [(t,) for t in params[0] if t in self.conn.readable]
        elif "WITH RECURSIVE fk" in flat:
            self.conn.closure_checks += 1
            self.conn.closure_roots.append(sorted(params[0]))
            self.rows = [(t,) for t in self.conn.dependents_of(params[0])]
        elif flat.startswith("SELECT EXISTS"):
            table = flat.split("FROM")[-1].strip().rstrip(")").strip()
            if table not in self.conn.readable and table not in self.conn.roots:
                raise AssertionError(
                    f"guard read {table}, which this role may not SELECT")
            self.rows = [(table in self.conn.populated,)]
        elif flat.startswith("TRUNCATE"):
            self.conn.truncated.append(flat)
            self.rows = []
        else:
            raise AssertionError(f"unexpected SQL: {flat}")

    def fetchall(self) -> list[tuple]:
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


class FakeConn:
    def __init__(self, populated, readable, graph, roots) -> None:
        self.populated = set(populated)
        self.readable = set(readable)
        self.graph = graph
        self.roots = set(roots)
        self.sql: list[str] = []
        self.truncated: list[str] = []
        self.readability_checks = 0
        self.closure_checks = 0
        self.closure_roots: list[list[str]] = []

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)

    def dependents_of(self, roots) -> list[str]:
        seen: set[str] = set()
        stack = list(roots)
        while stack:
            for child in self.graph.get(stack.pop(), []):
                if child not in seen:
                    seen.add(child)
                    stack.append(child)
        return sorted(seen)


class FakeReporter:
    def __init__(self) -> None:
        self.warnings: list[str] = []

    def warn(self, message: str) -> None:
        self.warnings.append(message)


ALL_ROOTS = ["clubs", "club_aliases", "seasons", "stat_definitions", "stat_availability"]
ALL_GROUPS = ["sources", "seasons", "clubs", "coverage"]

# The real shape: clubs/seasons reach the admin relations the import role is denied;
# stat_definitions reaches only stat_availability, which the loader rebuilds.
REAL_GRAPH = {
    "clubs": ["matches", "player_clubs", "club_seasons"],
    "seasons": ["matches", "stat_availability"],
    "matches": ["player_match_stats", "player_match_period_stats"],
    "player_clubs": ["players"],
    "players": ["player_link_match_candidates"],
    "stat_definitions": ["stat_availability"],
}
# Everything except the two relations migration 062/067 left unregistered.
REAL_READABLE = ["matches", "player_clubs", "club_seasons", "players",
                 "player_match_stats", "stat_availability"]

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' — ' + detail) if detail else ''}")
        failures.append(name)


def guard(conn, groups=None, allow_cascade=False):
    loader.reset_cascade_state()
    loader.guard_cascade(conn, groups or ALL_GROUPS, FakeReporter(), allow_cascade)


# ---------------------------------------------------------------------------
# A. The clean-rebuild state: migration-seeded coverage roots, everything else empty
# ---------------------------------------------------------------------------

print("A. freshly migrated database (015/016 seed stat_definitions + stat_availability)")

conn = FakeConn(populated=["stat_definitions", "stat_availability"],
                readable=REAL_READABLE, graph=REAL_GRAPH, roots=ALL_ROOTS)
exited = None
try:
    guard(conn)
except SystemExit as exc:            # pragma: no cover - a failure path
    exited = str(exc)

check("A1 the guard does not refuse", exited is None, str(exited))
check("A2 the closure is taken from the POPULATED roots only",
      conn.closure_roots == [["stat_availability", "stat_definitions"]],
      f"got {conn.closure_roots}")
check("A3 no unreadable relation is inspected",
      "player_link_match_candidates" not in " ".join(conn.sql)
      and "player_match_period_stats" not in " ".join(conn.sql))
check("A4 no readability split is needed at all", conn.readability_checks == 0,
      f"{conn.readability_checks} performed")

# The empty roots are skipped; only the seeded coverage pair is truncated.
loader.reload_truncate(conn, "seasons")
loader.reload_truncate(conn, "clubs", "club_aliases")
check("A5 no TRUNCATE is issued for empty roots", conn.truncated == [],
      f"got {conn.truncated}")
loader.reload_truncate(conn, "stat_definitions", "stat_availability")
check("A6 the seeded coverage roots ARE truncated, and only those",
      len(conn.truncated) == 1 and "stat_definitions" in conn.truncated[0])

# A fully empty database must behave the same way, and touch even less.
empty = FakeConn(populated=[], readable=REAL_READABLE, graph=REAL_GRAPH, roots=ALL_ROOTS)
guard(empty)
loader.reload_truncate(empty, "clubs", "club_aliases")
check("A7 a wholly empty database needs no closure query at all",
      empty.closure_checks == 0 and empty.truncated == [])

# ---------------------------------------------------------------------------
# B. A populated root whose cascade reaches a relation this role may not read
# ---------------------------------------------------------------------------

print("\nB. populated clubs + unreadable outside dependent")

conn = FakeConn(populated=["clubs"], readable=REAL_READABLE, graph=REAL_GRAPH,
                roots=ALL_ROOTS)
refused = None
try:
    guard(conn)
except SystemExit as exc:
    refused = str(exc)

check("B1 the loader refuses", refused is not None)
check("B2 it names the relations it could not prove empty",
      refused is not None and "player_link_match_candidates" in refused
      and "player_match_period_stats" in refused, str(refused))
check("B3 it never tried to read them",
      "SELECT EXISTS (SELECT 1 FROM player_link_match_candidates)" not in conn.sql)

# ---------------------------------------------------------------------------
# C. A populated root whose out-of-scope dependents are readable and empty
# ---------------------------------------------------------------------------

print("\nC. populated clubs + readable, empty dependents")

readable_graph = {"clubs": ["matches"], "matches": ["player_match_stats"]}
conn = FakeConn(populated=["clubs"], readable=["matches", "player_match_stats"],
                graph=readable_graph, roots=ALL_ROOTS)
exited = None
try:
    guard(conn)
except SystemExit as exc:            # pragma: no cover - a failure path
    exited = str(exc)

check("C1 the guard allows the load", exited is None, str(exited))
loader.reload_truncate(conn, "clubs", "club_aliases")
check("C2 the guarded TRUNCATE is issued",
      len(conn.truncated) == 1 and conn.truncated[0].startswith("TRUNCATE clubs"))

# and a populated out-of-scope dependent still refuses
conn = FakeConn(populated=["clubs", "matches"], readable=["matches", "player_match_stats"],
                graph=readable_graph, roots=ALL_ROOTS)
refused = None
try:
    guard(conn)
except SystemExit as exc:
    refused = str(exc)
check("C3 a POPULATED readable dependent still refuses",
      refused is not None and "matches" in refused, str(refused))

# ---------------------------------------------------------------------------
# D. The guard and the truncate cannot disagree, and nothing bypasses the guard
# ---------------------------------------------------------------------------

print("\nD. guard/truncate agreement and no --allow-cascade bypass")

conn = FakeConn(populated=["clubs"], readable=REAL_READABLE, graph=REAL_GRAPH,
                roots=ALL_ROOTS)
loader.reset_cascade_state()
refused = None
try:
    loader.reload_truncate(conn, "clubs")
except SystemExit as exc:
    refused = str(exc)
check("D1 a TRUNCATE before the guard has run is refused",
      refused is not None and conn.truncated == [], str(refused))

# A root that was empty when the guard ran, but holds rows by truncate time,
# was never adjudicated and must not be truncated.
conn = FakeConn(populated=[], readable=REAL_READABLE, graph=REAL_GRAPH, roots=ALL_ROOTS)
guard(conn)
conn.populated.add("clubs")
refused = None
try:
    loader.reload_truncate(conn, "clubs")
except SystemExit as exc:
    refused = str(exc)
check("D2 an unadjudicated root is refused, not truncated",
      refused is not None and conn.truncated == [], str(refused))

parser_src = (ROOT / "tools" / "migration" / "load_reference_data.py").read_text(
    encoding="utf-8")
check("D3 --allow-cascade is store_true, so it is off unless asked for",
      'parser.add_argument("--allow-cascade", action="store_true"' in parser_src)

# The refusals are refusals, not warnings, when the flag is absent. Proven by
# driving the guard rather than by reading it.
conn = FakeConn(populated=["clubs"], readable=REAL_READABLE, graph=REAL_GRAPH,
                roots=ALL_ROOTS)
allowed = None
reporter = FakeReporter()
loader.reset_cascade_state()
try:
    loader.guard_cascade(conn, ALL_GROUPS, reporter, True)
except SystemExit as exc:            # pragma: no cover - a failure path
    allowed = str(exc)
check("D4 --allow-cascade downgrades the same case to a warning, so the flag "
      "is what separates them", allowed is None and reporter.warnings != [],
      f"exit={allowed} warnings={reporter.warnings}")

rebuild_src = (ROOT / "tools" / "db" / "rebuild-test.ts").read_text(encoding="utf-8")
check("D5 the canonical rebuild path never passes --allow-cascade",
      "--allow-cascade" not in rebuild_src)

print()
if failures:
    print(f"FAILED: {len(failures)} scenario(s): {', '.join(failures)}")
    raise SystemExit(1)
print("All cascade-guard scenarios hold.")
