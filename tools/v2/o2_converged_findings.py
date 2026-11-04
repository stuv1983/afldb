#!/usr/bin/env python3
"""Owner decision O2: resolve EXACTLY the 36 converged `canonical_apply_failed` / `foreign_source_owner` findings (data_issues ids 41-76) as
`canonical_apply_not_needed` -- library + one `apply` command, driven ONLY by `tools/v2/o2-converged-findings-production.py`.

    python tools/v2/o2_converged_findings.py apply --plan <plan.json>      (AFLDB_IMPORT_DATABASE_URL in the environment)

What the findings are. On 2026-09-28 the AFL API settle refused to adopt values into 36 `player_match_stats` rows owned by AFL Tables (ISSUE-244
I244-F009; owner stamp AFLDB-ISSUE-122). AFL Tables' later settle (import batch 47) brought every flagged field to the staged AFL API value, so the
disagreement no longer exists, but nothing closes the findings (the AFL API nightly reads only the 2027 scope; the AFL Tables settle is retired).

The comparison (pinned here, read-only, reproducible): for each finding, the staged AFL API projection `staging.afl_api_player_match` of its
`details.external_record_id` (which must still be at the finding's `details.source_version_seq`, and must name the same player, club and match as the
canonical row) versus the canonical `player_match_stats` row `entity_id`, on every field named in `details.fields`: both values non-NULL and equal.

The write, in ONE transaction it controls: SET LOCAL TimeZone=UTC / lock / statement timeouts; identity + UPDATE-privilege proof; the 36 rows
`FOR UPDATE`, their canonical rows and staged rows `FOR SHARE` (no concurrent writer can change what is compared until COMMIT); the whole baseline
re-proven (the 36 rows in every column, every other data_issues row, the canonical and staged rows in every column, the comparison); ONE UPDATE of
exactly those ids setting only `resolved_at = now()` and `resolution = 'canonical_apply_not_needed'` (the settle's own vocabulary for "canonical
state already holds it", src/lib/acquisition/settle-core.ts); rowcount 36 required; then the post-state proof (every other column of the 36 and
every other row unchanged; this transaction wrote nothing but 36 data_issues updates, per pg_stat_xact_user_tables). COMMIT only if all passed.
No import batch, no canonical write, no ownership change.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import issue333_o2_common as oc  # noqa: E402
from issue333_o2_common import Refused  # noqa: E402

OPERATION = "o2-converged-findings"
APP_NAME = "afldb-o2-writer"           # the ceremony's live-writer probe looks for this application_name (review F-001)
IDS = list(range(41, 77))
EXPECT_ROWS = 36
EXPECT_FIELDS = 53      # the flagged field instances measured 2026-11-04 (the earlier record's "50" was an arithmetic error; its own per-field counts sum to 53)
ISSUE_TYPE = "canonical_apply_failed"
OWNER = "AFLDB-ISSUE-122"
REFUSAL = "foreign_source_owner"
SOURCE_KEY = "afl_api"
CANONICAL_OWNER_KEY = "afltables"
RESOLUTION = "canonical_apply_not_needed"
STAT_FIELDS = frozenset(("kicks", "marks", "handballs", "disposals", "goals", "behinds", "hitouts", "tackles", "rebounds", "inside_50s", "clearances",
                         "clangers", "frees_for", "frees_against", "contested", "uncontested", "contested_marks", "marks_inside_50", "one_percenters",
                         "bounces", "goal_assists"))
DI_COLUMNS = ["id", "entity_type", "entity_id", "issue_type", "severity", "description", "details", "detected_at", "resolved_at", "resolution", "issue_key"]
DI_SELECT = "SELECT id, entity_type, entity_id, issue_type, severity::text, description, details, detected_at, resolved_at, resolution, issue_key FROM data_issues"
LOCKED = ("public.data_issues", "public.player_match_stats", "staging.afl_api_player_match")
EXPECTED_WRITES = {"public.data_issues": [0, EXPECT_ROWS, 0]}


def read_state(cur) -> dict:
    cur.execute("SELECT current_setting('TimeZone')")
    if cur.fetchone()[0] != "UTC":
        raise Refused("the session TimeZone is not UTC; row digests would not be comparable")
    cur.execute("SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'data_issues'")
    if list(cur.fetchone()[0]) != DI_COLUMNS:
        raise Refused("data_issues columns differ from the reviewed full-row definition")
    cur.execute("SELECT key, id FROM sources WHERE key = ANY(%s)", ([SOURCE_KEY, CANONICAL_OWNER_KEY],))
    src = {k: int(v) for k, v in cur.fetchall()}
    if set(src) != {SOURCE_KEY, CANONICAL_OWNER_KEY}:
        raise Refused("a source is not registered")
    cur.execute(DI_SELECT + " WHERE id = ANY(%s) ORDER BY id", (IDS,))
    targets = [tuple(r) for r in cur.fetchall()]
    cur.execute(DI_SELECT + " WHERE NOT (id = ANY(%s)) ORDER BY id", (IDS,))
    others = [tuple(r) for r in cur.fetchall()]
    entity_ids = sorted({int(r[2]) for r in targets if r[2] is not None})
    externals = sorted({str((r[6] or {}).get("external_record_id")) for r in targets})
    cur.execute("SELECT p.id, to_jsonb(p) FROM player_match_stats p WHERE p.id = ANY(%s) ORDER BY p.id", (entity_ids,))
    canonical = [(int(i), j) for i, j in cur.fetchall()]
    cur.execute("SELECT s.external_record_id, to_jsonb(s) FROM staging.afl_api_player_match s WHERE s.source_id = %s AND s.family = 'player_match_stats' "
                "AND s.external_record_id = ANY(%s) ORDER BY 1", (src[SOURCE_KEY], externals))
    staged = [(e, j) for e, j in cur.fetchall()]
    keys = sorted({j.get("match_key") for _, j in staged})
    cur.execute("SELECT id, match_key FROM matches WHERE match_key = ANY(%s) ORDER BY id", (keys,))
    matches = {k: int(i) for i, k in cur.fetchall()}
    # import_batches is deliberately NOT part of O2's state: O2 writes none, an O1 apply or a nightly batch must not make an O2 plan stale, and a
    # surplus write to it inside the O2 transaction is caught by the exact pg_stat_xact_user_tables write set.
    return {"sources": src, "targets": targets, "others": others, "canonical": canonical, "staged": staged, "matches": matches,
            "triggers": oc.trigger_inventory(cur, ("public.data_issues",))}


def predicate_problems(s: dict) -> list[str]:
    """Every pinned row is still the reviewed unresolved finding."""
    out = []
    if [int(r[0]) for r in s["targets"]] != IDS:
        out.append(f"the pinned ids are not all present ({len(s['targets'])} of {EXPECT_ROWS})")
    for r in s["targets"]:
        d = r[6] or {}
        if (r[1], r[3], r[8], r[9]) != ("player_match_stats", ISSUE_TYPE, None, None) or d.get("owner") != OWNER or d.get("refusal") != REFUSAL \
                or d.get("source_key") != SOURCE_KEY or d.get("target_table") != "player_match_stats" or d.get("family") != "player_match_stats":
            out.append(f"data_issues {r[0]} is not an unresolved {ISSUE_TYPE}/{REFUSAL} finding of {SOURCE_KEY} owned by {OWNER}")
    return out


def compare(s: dict) -> tuple[list[list], list[str]]:
    """The pinned comparison: one entry per flagged field instance [id, issue_key, entity_id, external_record_id, field, staged, canonical, equal]."""
    canonical = {i: j for i, j in s["canonical"]}
    staged = {e: j for e, j in s["staged"]}
    entries, problems = [], []
    for r in s["targets"]:
        d = r[6] or {}
        ext, pms_id, fields = d.get("external_record_id"), r[2], d.get("fields") or []
        c, st = canonical.get(pms_id), staged.get(ext)
        if c is None or st is None:
            problems.append(f"data_issues {r[0]}: canonical row {pms_id} or staged record {ext} is absent")
            continue
        if st.get("version_seq") != d.get("source_version_seq"):
            problems.append(f"data_issues {r[0]}: the staged record moved from version {d.get('source_version_seq')} to {st.get('version_seq')}")
        if st.get("player_id") != c.get("player_id") or st.get("club_id") != c.get("club_id") or s["matches"].get(st.get("match_key")) != c.get("match_id"):
            problems.append(f"data_issues {r[0]}: the staged record and the canonical row name different players, clubs or matches")
        if c.get("source_id") != s["sources"][CANONICAL_OWNER_KEY]:
            problems.append(f"data_issues {r[0]}: canonical row {pms_id} is no longer owned by {CANONICAL_OWNER_KEY}")
        if not fields:
            problems.append(f"data_issues {r[0]}: no flagged fields")
        for f in fields:
            if f not in STAT_FIELDS:
                problems.append(f"data_issues {r[0]}: flagged field {f!r} is not a player_match_stats statistic")
                continue
            sv, cv = st.get(f), c.get(f)
            entries.append([int(r[0]), r[10], int(pms_id), ext, f, sv, cv, sv is not None and cv is not None and sv == cv])
    if len(entries) != EXPECT_FIELDS:
        problems.append(f"{len(entries)} flagged field instances, expected {EXPECT_FIELDS}")
    unequal = [e for e in entries if not e[7]]
    if unequal:
        problems.append(f"{len(unequal)} flagged fields are NOT equal (or NULL), e.g. data_issues {unequal[0][0]} {unequal[0][4]}: staged {unequal[0][5]} canonical {unequal[0][6]}")
    return entries, problems


def baseline(s: dict) -> dict:
    entries, _ = compare(s)
    operation = {"targets": {"rows": len(s["targets"]), "fullRowDigest": oc.rows_digest(s["targets"])},
                 "canonical": {"rows": len(s["canonical"]), "fullRowDigest": oc.rows_digest(s["canonical"])},
                 "staged": {"rows": len(s["staged"]), "fullRowDigest": oc.rows_digest(s["staged"])},
                 "comparison": {"entries": len(entries), "equal": sum(1 for e in entries if e[7]), "digest": oc.rows_digest(entries)},
                 "triggers": s["triggers"]}
    b = {"operation": operation, "operationDigest": oc.sha(oc.canon(operation)),
         "others": {"rows": len(s["others"]), "maxId": max((int(r[0]) for r in s["others"]), default=0), "fullRowDigest": oc.rows_digest(s["others"])}}
    b["baselineDigest"] = oc.sha(oc.canon(b))
    return b


def others_prefix_digest(s: dict, max_id: int) -> str:
    return oc.rows_digest([r for r in s["others"] if int(r[0]) <= max_id])


def facts(s: dict) -> dict:
    problems = predicate_problems(s)
    entries, cproblems = compare(s)
    if problems or cproblems:
        raise Refused("; ".join((problems + cproblems)[:4]))
    return {"baseline": baseline(s), "comparison": entries,
            "preImage": [[oc.norm(x) for x in r] for r in s["targets"]]}


def classify(plan: dict, s: dict, strict: bool = False) -> tuple[str, list[str]]:
    """'unchanged' / 'applied' / 'other'. Outside the write transaction other findings may be opened or changed by the nightly settle; that is
    reported, and only the operation's own rows decide (strict=False). Inside the write transaction every other row must be unchanged."""
    pb = plan["baseline"]
    nb = baseline(s)
    notes = []
    others_ok = others_prefix_digest(s, pb["others"]["maxId"]) == pb["others"]["fullRowDigest"] and \
        sum(1 for r in s["others"] if int(r[0]) <= pb["others"]["maxId"]) == pb["others"]["rows"]
    if nb["others"] != pb["others"]:
        notes.append(f"note: other data_issues rows changed or were added since the plan (pre-existing rows unchanged: {others_ok})")
    if nb["operation"] == pb["operation"] and (not strict or (nb == pb)):
        return "unchanged", notes
    problems = []
    if not others_ok or (strict and nb["others"] != pb["others"]):
        problems.append("another data_issues row changed")
    for k in ("canonical", "staged", "comparison", "triggers"):
        if nb["operation"][k] != pb["operation"][k]:
            problems.append(f"the {k} state changed")
    pre = {r[0]: r for r in plan["preImage"]}
    resolved = set()
    for r in s["targets"]:
        n = [oc.norm(x) for x in r]
        p = pre.get(n[0])
        if p is None or n[:8] != p[:8] or n[10] != p[10]:
            problems.append(f"data_issues {n[0]}: a column other than resolved_at / resolution changed")
        if n[9] != RESOLUTION or n[8] is None:
            problems.append(f"data_issues {n[0]} is not resolved as {RESOLUTION}")
        resolved.add(n[8])
    if len(s["targets"]) != EXPECT_ROWS or len(resolved) != 1 or (None not in resolved and min(resolved) < plan["createdAt"].replace("Z", "+00:00")[:19]):
        problems.append("the 36 rows are not resolved by one transaction after the plan")
    return ("applied", notes) if not problems else ("other", problems + notes)


def plan_body_ok(plan: dict) -> None:
    body = {k: v for k, v in plan.items() if k != "digest"}
    if plan.get("digest") != oc.sha(oc.canon(body)) or plan.get("operation") != OPERATION:
        raise Refused("the plan's digest or operation differs; the writer only runs a sealed O2 plan")


def apply(plan: dict, dsn: str) -> dict:
    import psycopg
    plan_body_ok(plan)
    conn = psycopg.connect(dsn, autocommit=False, application_name=APP_NAME)
    try:
        with conn.cursor() as cur:
            settings = oc.configure_writer(cur)
            ident = oc.prove_write_identity(cur, plan["target"], LOCKED)
            oc.rehearsal_target_ok(plan, ident["database"])
            cur.execute("SELECT id FROM data_issues WHERE id = ANY(%s) ORDER BY id FOR UPDATE", (IDS,))
            if [int(r[0]) for r in cur.fetchall()] != IDS:
                raise Refused("not all 36 pinned data_issues rows could be locked")
            pre = read_state(cur)
            ent = sorted({int(r[2]) for r in pre["targets"]})
            cur.execute("SELECT id FROM player_match_stats WHERE id = ANY(%s) ORDER BY id FOR SHARE", (ent,))
            if len(cur.fetchall()) != len(ent):
                raise Refused("not every canonical row could be share-locked")
            ext = sorted({str((r[6] or {}).get("external_record_id")) for r in pre["targets"]})
            cur.execute("SELECT external_record_id FROM staging.afl_api_player_match WHERE source_id = %s AND family = 'player_match_stats' "
                        "AND external_record_id = ANY(%s) ORDER BY 1 FOR SHARE", (pre["sources"][SOURCE_KEY], ext))
            if len(cur.fetchall()) != len(ext):
                raise Refused("not every staged record could be share-locked")
            s = read_state(cur)                                      # re-read under the locks
            f = facts(s)
            if f["baseline"] != plan["baseline"] or f["comparison"] != plan["comparison"] or f["preImage"] != plan["preImage"]:
                raise Refused("baseline drift inside the write transaction; re-plan")
            if oc.transaction_writes(cur):
                raise Refused("the transaction wrote before the update")
            cur.execute("UPDATE data_issues SET resolved_at = now(), resolution = %s WHERE id = ANY(%s) AND resolved_at IS NULL AND issue_type = %s "
                        "AND details->>'owner' = %s AND details->>'refusal' = %s AND details->>'source_key' = %s",
                        (RESOLUTION, IDS, ISSUE_TYPE, OWNER, REFUSAL, SOURCE_KEY))
            if cur.rowcount != EXPECT_ROWS:
                raise Refused(f"updated {cur.rowcount} rows, expected exactly {EXPECT_ROWS}")
            cur.execute("SELECT now()")
            tx_now = oc.norm(cur.fetchone()[0])
            after = read_state(cur)
            seen, problems = classify(plan, after, strict=True)
            writes = oc.transaction_writes(cur)
            if any(oc.norm(r[8]) != tx_now for r in after["targets"]):
                problems.append("resolved_at is not this transaction's time")
                seen = "other"
            if seen != "applied" or writes != EXPECTED_WRITES:
                raise Refused(f"post-state check failed inside the transaction: {problems[:3]}; writes {writes}")
        conn.commit()
        return {"committed": True, "updated": EXPECT_ROWS, "resolvedAt": tx_now, "settings": settings}
    except BaseException:
        try:
            conn.rollback()
        finally:
            conn.close()
        raise
    finally:
        if not conn.closed:
            conn.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="O2 writer; run only through tools/v2/o2-converged-findings-production.py")
    ap.add_argument("mode", choices=("apply",))
    ap.add_argument("--plan", required=True)
    a = ap.parse_args(argv)
    try:
        plan = json.loads(Path(a.plan).read_text(encoding="utf-8"))
        if os.environ.get("AFLDB_O2_PLAN_DIGEST") != plan.get("digest"):
            raise Refused("run only through tools/v2/o2-converged-findings-production.py apply (it sets the reviewed plan digest)")
        result = apply(plan, os.environ.get("AFLDB_IMPORT_DATABASE_URL", ""))
    except Refused as exc:
        print(f"O2 writer: ROLLED BACK / REFUSED: {exc}")
        return 2
    except Exception as exc:  # noqa: BLE001
        print(f"O2 writer: FAILED ({type(exc).__name__}); the transaction was rolled back if it was open")
        return 3
    print("O2 writer: COMMITTED " + json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
