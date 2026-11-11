"""D-336-3: extract every original_club_raw difference (CSV vs stored) using reconcile.py's exact matching."""
import json, gzip, sys, pathlib, importlib.util, io, contextlib
sys.stdout.reconfigure(encoding="utf-8")
EV = pathlib.Path(sys.argv[1]); SP = pathlib.Path(sys.argv[2])
src = (EV / "reconcile.py").read_text(encoding="utf-8")
# run the recorded matcher verbatim, silently, then reuse its matched list
g = {"__name__": "rec"}
sys.argv = ["reconcile.py", str(SP)]
class _Sink(io.StringIO):
    def reconfigure(self, **k): pass
real = sys.stdout
with contextlib.redirect_stdout(_Sink()):
    exec(compile(src, "reconcile.py", "exec"), g)
sys.stdout = real
n = g["n"]; matched = g["matched"]
out = []
for c, r in matched:
    a, b = n(c["origin"]), n(r["origin"])
    if a != b:
        out.append({"id": r["id"], "year": c["year"], "cat": c["cat"], "player": c["player"], "pick": r["pick"], "club": r["club_raw"],
                    "csv": a, "db": b, "csv_raw": c["origin"], "db_raw": r["origin"], "player_url": r.get("player_url"), "player_id": r.get("player_id")})
out.sort(key=lambda x: x["id"])
(SP / "origin-pairs.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(len(out))
