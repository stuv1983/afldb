"""ISSUE-348: characterise every non-guard fact change of the rehearsed load (aggregates only)."""
import json, sys
from collections import Counter, defaultdict
from pathlib import Path

P = Path(sys.argv[1])
def load(tag, name):
    return {r["id"]: r for r in json.loads((P / f"rows-{tag}" / f"{name}.json").read_text())}

out = {}
for name, cols in (("draft_picks", ("source_record_id", "reported_games", "reported_goals", "draft_age", "height_cm")),
                   ("draft_persons", ("reported_games", "reported_goals"))):
    pre, a = load("pre", name), load("reh1", name)
    for c in cols:
        trans = Counter(); years = Counter(); deltas = Counter(); shape = Counter()
        for i, r in a.items():
            b, v = pre[i].get(c), r.get(c)
            if b == v:
                continue
            kind = "null->value" if b is None else "value->null" if v is None else "value->value"
            trans[kind] += 1
            if "draft_year" in r:
                years[r["draft_year"]] += 1
            if kind == "value->value" and isinstance(b, (int, float)) and isinstance(v, (int, float)):
                d = v - b
                deltas["+" if d > 0 else "-"] += 1
                deltas[f"abs<={1 if abs(d) <= 1 else 5 if abs(d) <= 5 else 'big'}"] += 1
            if c == "source_record_id" and b and v:
                shape["same_url_index_shift" if b.split("#")[0] == v.split("#")[0] else "url_changed"] += 1
        key = f"{name}.{c}"
        out[key] = {"transitions": dict(trans), "years": dict(sorted(years.items())),
                    "numeric_deltas": dict(deltas), "shape": dict(shape)}
print(json.dumps(out, indent=1))
