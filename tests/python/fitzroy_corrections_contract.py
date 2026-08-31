#!/usr/bin/env python3
"""AFLDB-ISSUE-093 §H14 — the accepted source corrections reach the import phases.

    python tests/python/fitzroy_corrections_contract.py

The second full clean rebuild died at [stats] with `NameError: name 'corrections'
is not defined`, after 16,838 matches had been imported: import_player_match_stats()
and import_brownlow_round_votes() both call iter_player_stats(files, corrections)
but had lost the parameter in a refactor, and main() did not pass it.

These checks are behavioural, not textual. They bind main()'s real arguments to the
real signatures, and they read the compiled CODE OBJECTS to prove `corrections` is a
closed-over parameter rather than a module global — which is precisely the difference
between the corrections arriving and a NameError. A string search could not tell those
two apart, and that is how the defect survived to a destructive run.

No database, no network, no importer execution.
"""

from __future__ import annotations

import ast
import inspect
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "migration"))

import import_fitzroy_core as fz  # noqa: E402

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' — ' + detail) if detail else ''}")
        failures.append(name)


# ---------------------------------------------------------------------------
# 1. The real corrections object, loaded the way main() loads it
# ---------------------------------------------------------------------------

print("1. the accepted corrections are real and non-empty")

corrections = fz.load_row_corrections()

check("1a load_row_corrections() returns the tracked rules", len(corrections) == 2,
      f"got {len(corrections)}")
check("1b both Jim Stewart 1909 cartesian rules are present",
      sorted(r["id"] for r in corrections)
      == ["1909-r10-jim-stewart-cartesian-a", "1909-r10-jim-stewart-cartesian-b"],
      str(sorted(r.get("id") for r in corrections)))

# The club-era corrections travel on the contract, through ClubResolver, not through
# this object — but they must still be live, so an "empty corrections" repair cannot
# quietly pass this file.
import json  # noqa: E402

contract = json.loads((ROOT / "tools" / "rebuild" / "fitzroy"
                       / "fitzroy-contract.json").read_text(encoding="utf-8"))
club_rules = contract["source_club_normalisation"]["rules"]
eras = {(r["raw"], r["first_season"], r["last_season"]) for r in club_rules}
check("1c Brisbane Lions 1987–1996 era rule is live",
      ("Brisbane Lions", 1987, 1996) in eras, str(sorted(eras)))
check("1d North Melbourne 1999–2007 era rule is live",
      ("North Melbourne", 1999, 2007) in eras, str(sorted(eras)))


# ---------------------------------------------------------------------------
# 2. main()'s call sites bind against the real signatures
# ---------------------------------------------------------------------------

print("\n2. main()'s arguments actually bind to the import phases")

sentinel = object()
fakes = dict(pg=sentinel, rep=sentinel, files=sentinel, matches=sentinel,
             clubs=sentinel, args=sentinel, refs=sentinel)

try:
    bound = inspect.signature(fz.import_player_match_stats).bind(
        fakes["pg"], fakes["rep"], fakes["files"], fakes["matches"],
        fakes["clubs"], fakes["args"], fakes["refs"], corrections)
    stats_ok, stats_err = True, ""
except TypeError as exc:
    stats_ok, stats_err, bound = False, str(exc), None

check("2a import_player_match_stats accepts main()'s argument list", stats_ok, stats_err)
check("2b and the corrections object it receives IS the loaded one",
      bound is not None and bound.arguments["corrections"] is corrections)

try:
    bound_bl = inspect.signature(fz.import_brownlow_round_votes).bind(
        fakes["pg"], fakes["rep"], fakes["files"], fakes["matches"],
        fakes["args"], corrections)
    bl_ok, bl_err = True, ""
except TypeError as exc:
    bl_ok, bl_err, bound_bl = False, str(exc), None

check("2c import_brownlow_round_votes accepts main()'s argument list (SIBLING)",
      bl_ok, bl_err)
check("2d and it receives the same corrections object",
      bound_bl is not None and bound_bl.arguments["corrections"] is corrections)

# Required, not defaulted: a caller that forgets it must fail loudly rather than
# silently importing the source uncorrected.
for fn in (fz.import_player_match_stats, fz.import_brownlow_round_votes):
    param = inspect.signature(fn).parameters["corrections"]
    check(f"2e {fn.__name__}: corrections is REQUIRED (no None default)",
          param.default is inspect.Parameter.empty, repr(param.default))


# ---------------------------------------------------------------------------
# 3. The compiled code proves a closed-over parameter, not a module global
# ---------------------------------------------------------------------------

print("\n3. the name resolves to the parameter, which is why it is no longer a NameError")

check("3a `corrections` is NOT a module-level global",
      not hasattr(fz, "corrections"),
      "a global would have masked the dropped parameter instead of failing")

for fn in (fz.import_player_match_stats, fz.import_brownlow_round_votes):
    code = fn.__code__
    params = code.co_varnames[:code.co_argcount]
    check(f"3b {fn.__name__}: corrections is a real parameter",
          "corrections" in params, str(params))

    # The two phases differ in shape, and the check must cover both rather than
    # assume one: import_player_match_stats calls iter_player_stats from inside a
    # nested build() closure, so the parameter becomes a CELL the nested code object
    # closes over; import_brownlow_round_votes calls it directly, so the parameter
    # stays a plain local. Either way the name must resolve to the PARAMETER. Read
    # from module scope it would be in neither, and would be the NameError again.
    if "corrections" in code.co_cellvars:
        nested = [c for c in code.co_consts
                  if "corrections" in getattr(c, "co_freevars", ())]
        check(f"3c {fn.__name__}: a nested builder captures it as a free variable",
              nested != [], "no nested code object closes over corrections")
        check(f"3d {fn.__name__}: that nested builder calls iter_player_stats",
              any("iter_player_stats" in c.co_names for c in nested))
    else:
        check(f"3c {fn.__name__}: it is a local, and the body itself calls "
              "iter_player_stats",
              "iter_player_stats" in code.co_names, str(code.co_names))
        check(f"3d {fn.__name__}: it is bound as a parameter, not a global",
              "corrections" not in code.co_names, "resolved through module scope")


# ---------------------------------------------------------------------------
# 4. The pre-repair code really did raise NameError — reconstructed, not asserted
# ---------------------------------------------------------------------------

print("\n4. the previous implementation fails with exactly this NameError")

# Rebuild the defect faithfully: same shape (nested builder reading `corrections`),
# same absence of a parameter and of a module global. Executing it must reproduce
# NameError, which is what proves the parameter is load-bearing rather than cosmetic.
broken = compile(
    "def outer(files):\n"
    "    def build():\n"
    "        return iter_player_stats(files, corrections)\n"
    "    return build()\n",
    "<pre-repair-shape>", "exec")
scope: dict = {"iter_player_stats": lambda f, c: c}
exec(broken, scope)
try:
    scope["outer"]([])
    raised = None
except NameError as exc:
    raised = str(exc)

check("4a the pre-repair shape raises NameError",
      raised is not None and "corrections" in raised, str(raised))

# The repaired shape, same builder, parameter restored: the object flows through.
fixed = compile(
    "def outer(files, corrections):\n"
    "    def build():\n"
    "        return iter_player_stats(files, corrections)\n"
    "    return build()\n",
    "<post-repair-shape>", "exec")
scope2: dict = {"iter_player_stats": lambda f, c: c}
exec(fixed, scope2)
check("4b the repaired shape passes the object straight to iter_player_stats",
      scope2["outer"]([], corrections) is corrections)

# and iter_player_stats really does accept it
try:
    list(fz.iter_player_stats([], corrections))
    accepted, accept_err = True, ""
except Exception as exc:                       # pragma: no cover - a failure path
    accepted, accept_err = False, f"{type(exc).__name__}: {exc}"
check("4c iter_player_stats accepts the real corrections object", accepted, accept_err)


# ---------------------------------------------------------------------------
# 5. Sibling audit: no other function reads a name it was never given
# ---------------------------------------------------------------------------

print("\n5. no sibling carries the same dropped-parameter defect")

source = (ROOT / "tools" / "migration" / "import_fitzroy_core.py").read_text(
    encoding="utf-8")
tree = ast.parse(source)

# Every name main() threads into a phase, checked against every phase that reads it.
PHASE_PREFIX = "import_"
offenders: list[str] = []
for node in tree.body:
    if not isinstance(node, ast.FunctionDef) or not node.name.startswith(PHASE_PREFIX):
        continue
    params = {a.arg for a in [*node.args.posonlyargs, *node.args.args,
                              *node.args.kwonlyargs]}
    assigned = {n.id for n in ast.walk(node)
                if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)}
    for threaded in ("corrections", "clubs", "refs", "matches", "files"):
        reads = any(isinstance(n, ast.Name) and n.id == threaded
                    and isinstance(n.ctx, ast.Load) for n in ast.walk(node))
        if reads and threaded not in params and threaded not in assigned:
            offenders.append(f"{node.name}() reads {threaded} without a parameter")

check("5a every import_* phase owns every threaded name it reads",
      offenders == [], "; ".join(offenders))

# The property that actually matters, read off the call itself: wherever
# iter_player_stats is invoked, `corrections` is one of its arguments.
call_sites: list[str] = []
for node in ast.walk(tree):
    if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
            and node.func.id == "iter_player_stats"):
        names = [a.id for a in node.args if isinstance(a, ast.Name)]
        call_sites.append(",".join(names))
check("5c every iter_player_stats call passes corrections",
      len(call_sites) >= 3 and all("corrections" in c for c in call_sites),
      str(call_sites))

# And main() must pass corrections to BOTH phases that read it.
main_fn = next(n for n in tree.body
               if isinstance(n, ast.FunctionDef) and n.name == "main")
passed_to = {
    call.func.id for call in ast.walk(main_fn)
    if isinstance(call, ast.Call) and isinstance(call.func, ast.Name)
    and any(isinstance(a, ast.Name) and a.id == "corrections" for a in call.args)
}
check("5b main() passes corrections to both stats and brownlow",
      {"import_player_match_stats", "import_brownlow_round_votes"} <= passed_to,
      str(sorted(passed_to)))

print()
if failures:
    print(f"FAILED: {len(failures)} check(s): {', '.join(failures)}")
    raise SystemExit(1)
print("All fitzRoy corrections-threading checks hold.")
