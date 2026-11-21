"""ISSUE-348 rehearsal comparison: pre (R0 template) vs reh1 vs reh2. Aggregates only on stdout."""
import json, sys
from collections import Counter
from pathlib import Path

E, P = Path(sys.argv[1]), Path(sys.argv[2])
S = {k: json.loads((E / f"state-{k}.json").read_text()) for k in ("pre", "reh1", "reh2")}
out = {}
for k in ("reh1", "reh2"):
    out[f"untouched_equal_{k}"] = {t: S["pre"]["untouched"][t] == S[k]["untouched"][t] for t in S["pre"]["untouched"]}
    out[f"link_persons_equal_{k}"] = S["pre"]["link_digest"]["persons"] == S[k]["link_digest"]["persons"]
    out[f"link_picks_equal_{k}"] = S["pre"]["link_digest"]["picks"] == S[k]["link_digest"]["picks"]
    out[f"counts_delta_{k}"] = {c: S[k]["counts"][c] - S["pre"]["counts"][c] for c in S["pre"]["counts"]
                                if S[k]["counts"][c] != S["pre"]["counts"][c]}
VOL = {"import_batch_id"}


def load(tag, name):
    return {r["id"]: r for r in json.loads((P / f"rows-{tag}" / f"{name}.json").read_text())}


for name in ("draft_picks", "draft_persons", "external_identities"):
    pre, a, b = load("pre", name), load("reh1", name), load("reh2", name)
    cols = Counter(); changed_ids = set()
    for i, r in a.items():
        if i not in pre:
            continue
        for c, v in r.items():
            if c not in VOL and pre[i].get(c) != v:
                cols[c] += 1; changed_ids.add(i)
    batch = sum(1 for i, r in a.items() if i in pre and pre[i].get("import_batch_id") != r.get("import_batch_id"))
    new = sorted(set(a) - set(pre)); gone = sorted(set(pre) - set(a))
    def strip(rows):
        return {i: {c: v for c, v in r.items() if c not in VOL} for i, r in rows.items()}
    sa, sb = strip(a), strip(b)
    # new identity rows get fresh identity ids in each restore; compare them by external_id
    if name == "external_identities":
        ka = sorted(json.dumps({c: v for c, v in r.items() if c != "id"}, sort_keys=True) for r in sa.values())
        kb = sorted(json.dumps({c: v for c, v in r.items() if c != "id"}, sort_keys=True) for r in sb.values())
        det = ka == kb
        newrows = [a[i] for i in new]
        out[f"{name}_new_rows"] = {"n": len(new), "status": dict(Counter(r["status"] for r in newrows)),
                                   "player_id_null": sum(1 for r in newrows if r["player_id"] is None),
                                   "match_method": dict(Counter(str(r["match_method"]) for r in newrows))}
        same_link = sum(1 for i in pre if i in a and all(pre[i][c] == a[i][c] for c in ("player_id", "status", "match_method")))
        out[f"{name}_existing_link_unchanged"] = f"{same_link}/{len(pre)}"
    else:
        det = sa == sb
    out[name] = {"pre": len(pre), "after": len(a), "new": len(new), "gone": len(gone),
                 "rows_with_fact_change": len(changed_ids), "column_changes": dict(cols.most_common()),
                 "import_batch_id_restamped": batch, "reh1_equals_reh2_excl_batch": det}
    if name == "draft_picks":
        aud = [i for i in range(6819, 6854)]
        out["audited_35_present_after"] = all(i in a for i in aud)
        out["audited_35_cols_changed"] = dict(Counter(c for i in aud for c, v in a[i].items()
                                                      if c not in VOL and pre[i].get(c) != v))
        out["three_rulings_after"] = {i: a[i]["original_club_raw"] for i in (5961, 6784, 6626)}
    if name == "draft_persons":
        out["persons_cols_changed_outside_31"] = dict(Counter(c for i, r in a.items() if i in pre and i < 5058
                                                              for c, v in r.items() if c not in VOL and pre[i].get(c) != v))
print(json.dumps(out, indent=1, ensure_ascii=False, default=str))
