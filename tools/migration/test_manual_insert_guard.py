#!/usr/bin/env python3
"""Self-test for the AFLDB-ISSUE-160 D-2 manual-player insert guard.

    python3 tools/migration/test_manual_insert_guard.py

No pytest and no database, matching tools/email_intake/test_fetch_and_stage.py:
everything here is a pure function over a date and a set of dates, and it has to
be runnable with whatever python3 is on the host. The half that needs PostgreSQL
-- that the real candidate query finds a real manual player, and that a refusal
really rolls the fitzRoy players batch back -- is
tests/integration/admin-draft.test.ts, which runs these same functions against
afldb_test.

What is being pinned is the SYMMETRY of the DOB rule (operator decision D-2,
approved with modification 2026-09-11). An unknown date distinguishes nobody, so
an unknown date on EITHER side refuses; only two known, different dates prove a
distinct namesake. The guard may refuse an unsafe insert; it may never link.
"""
from __future__ import annotations

import datetime
import importlib.util
import sys
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "import_fitzroy_core", Path(__file__).with_name("import_fitzroy_core.py"))
fz = importlib.util.module_from_spec(_spec)
# Registered before exec: @dataclass resolves its annotations through
# sys.modules[cls.__module__], so an unregistered module fails to import at all.
sys.modules[_spec.name] = fz
_spec.loader.exec_module(fz)

D = datetime.date
failures: list[str] = []


def check(label: str, actual, expected) -> None:
    if actual != expected:
        failures.append(f"{label}: expected {expected!r}, got {actual!r}")


# --- the four DOB shapes, both directions -----------------------------------

check("manual dob unknown, source dob known",
      fz.manual_insert_verdict(None, {D(1990, 1, 1)}), "refuse")
check("manual dob unknown, source dob also unknown",
      fz.manual_insert_verdict(None, set()), "refuse")
check("source dob absent, manual dob known",
      fz.manual_insert_verdict(D(1990, 1, 1), set()), "refuse")
check("source dob absent (None passed rather than an empty set)",
      fz.manual_insert_verdict(D(1990, 1, 1), None), "refuse")
check("both known and equal",
      fz.manual_insert_verdict(D(1990, 1, 1), {D(1990, 1, 1)}), "refuse")
check("both known, several source dates, ONE of them equal",
      fz.manual_insert_verdict(D(1990, 1, 1), {D(1988, 5, 5), D(1990, 1, 1)}), "refuse")
check("both known and every source date different",
      fz.manual_insert_verdict(D(1990, 1, 1), {D(1988, 5, 5), D(1991, 2, 2)}), "allow")

# A source date recorded as a string must compare the same way a date object
# does: the fitzRoy fact layer has carried both shapes over the years, and a
# type mismatch that silently ALLOWED would be the one failure mode that matters.
check("string source date equal to the manual date",
      fz.manual_insert_verdict(D(1990, 1, 1), {"1990-01-01"}), "refuse")
check("string source date different from the manual date",
      fz.manual_insert_verdict(D(1990, 1, 1), {"1991-01-01"}), "allow")
check("a None inside the source set is ignored, not treated as a match",
      fz.manual_insert_verdict(D(1990, 1, 1), {None, D(1991, 1, 1)}), "allow")
check("a source set of nothing but None is an unknown date",
      fz.manual_insert_verdict(D(1990, 1, 1), {None}), "refuse")

# --- the raising wrapper -----------------------------------------------------

# No candidates at all: the normal case on every database where no administrator
# has created a player. The INSERT proceeds, untouched.
fz.refuse_unsafe_manual_insert("players/S/Some_Player0.html", "Some Player", set(), [])

# A candidate that the dates prove is a different person: also safe.
fz.refuse_unsafe_manual_insert(
    "players/S/Some_Player0.html", "Some Player", {D(2006, 3, 3)},
    [(41, "Some Player", D(1975, 9, 9))])

# A candidate the dates cannot distinguish: fail closed, and say enough for the
# operator to act without opening the database.
try:
    fz.refuse_unsafe_manual_insert(
        "players/S/Some_Player0.html", "Some Player", set(),
        [(41, "Some Player", None), (42, "Some Player", D(1975, 9, 9))])
    failures.append("an indistinguishable candidate did not raise")
except RuntimeError as error:
    message = str(error)
    for fragment in ("players/S/Some_Player0.html", "#41", "#42", "/admin/draft",
                     "date of birth", "Nothing has been written"):
        if fragment not in message:
            failures.append(f"refusal message omits {fragment!r}: {message}")
    # #42's date is known and different, so it alone would not have blocked --
    # but it is listed, because the operator has to see every candidate the
    # rerun will meet, not only the one that tripped first.
    if "unrecorded" not in message:
        failures.append(f"refusal message does not say which date is unknown: {message}")

# The whole point of D-2: this guard never writes. A module-level grep is a crude
# check, but it is the one that keeps being true as the file grows.
source = Path(__file__).with_name("import_fitzroy_core.py").read_text(encoding="utf-8")
guard = source[source.index("MANUAL_CANDIDATES_SQL"):source.index("def import_players(")]
for forbidden in ("INSERT INTO", "UPDATE ", "DELETE FROM"):
    if forbidden in guard:
        failures.append(f"the guard contains {forbidden!r}: it must only ever read and refuse")

if failures:
    print("FAIL")
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)
print("ok: AFLDB-ISSUE-160 D-2 manual-player insert guard")
