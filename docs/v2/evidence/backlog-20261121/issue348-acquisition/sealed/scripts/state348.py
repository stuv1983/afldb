"""ISSUE-348 rehearsal: capture the DraftGuru surface of an isolated database (read-only).

Usage (inside isolated-pg run <db> --): python -I state348.py <out.json> <rows-dir>
Writes aggregate state (counts + digests) to out.json and full keyed rows (private) to rows-dir.
The link-state digest is the one the sealed plan uses as production pre/post condition:
  persons  (player_url, player_id, link_status, match_method)        DraftGuru source
  picks    (player_url, draft_year, draft_kind, player_id, link_status_value, match_method)
  idents   (external_id, player_id, status, match_method)            DraftGuru source
"""
import hashlib, json, os, sys
from pathlib import Path
import psycopg

out, rows_dir = Path(sys.argv[1]), Path(sys.argv[2])
rows_dir.mkdir(parents=True, exist_ok=True)
conn = psycopg.connect(os.environ["AFLDB_TEST_DATABASE_URL"], autocommit=False)
cur = conn.cursor()
cur.execute("SET TRANSACTION READ ONLY")
cur.execute("SET TIME ZONE 'Etc/UTC'")
cur.execute("SELECT id FROM sources WHERE key = 'draftguru'")
dg = cur.fetchone()[0]


def q(sql, *a):
    cur.execute(sql, a)
    return cur.fetchall()


def digest(rows):
    h = hashlib.sha256()
    for r in rows:
        h.update((json.dumps(r, default=str, ensure_ascii=False, separators=(",", ":")) + "\n").encode())
    return h.hexdigest()


LINK_SQL = {
    "persons": ("SELECT player_url, player_id, link_status::text, match_method FROM draft_persons "
                "WHERE source_id = %s ORDER BY player_url"),
    "picks": ("SELECT player_url, draft_year, draft_kind, player_id, link_status_value::text, match_method "
              "FROM draft_picks WHERE source_id = %s ORDER BY player_url, draft_year, draft_kind"),
    "idents": ("SELECT external_id, player_id, status::text, match_method FROM external_identities "
               "WHERE source_id = %s ORDER BY external_id"),
}
state = {"source_id": dg, "counts": {}, "link_digest": {}, "link_rows": {}}
for name, sql in LINK_SQL.items():
    rows = [list(r) for r in q(sql, dg)]
    state["link_digest"][name] = digest(rows)
    state["link_rows"][name] = len(rows)
    (rows_dir / f"link-{name}.json").write_text(json.dumps(rows, default=str, ensure_ascii=False))
state["link_digest"]["combined"] = hashlib.sha256(
    "".join(state["link_digest"][k] for k in ("persons", "picks", "idents")).encode()).hexdigest()

for label, sql in {
    "draft_picks_dg": "SELECT count(*) FROM draft_picks WHERE source_id = %s",
    "draft_picks_all": "SELECT count(*) FROM draft_picks WHERE %s IS NOT NULL",
    "draft_persons_dg": "SELECT count(*) FROM draft_persons WHERE source_id = %s",
    "idents_dg": "SELECT count(*) FROM external_identities WHERE source_id = %s",
    "players": "SELECT count(*) FROM players WHERE %s IS NOT NULL",
    "data_edits": "SELECT count(*) FROM data_edits WHERE %s IS NOT NULL",
    "data_overrides": "SELECT count(*) FROM data_overrides WHERE %s IS NOT NULL",
    "import_batches": "SELECT count(*) FROM import_batches WHERE %s IS NOT NULL",
    "player_link_resolutions": "SELECT count(*) FROM player_link_resolutions WHERE %s IS NOT NULL",
    "linked_picks_dg": "SELECT count(*) FROM draft_picks WHERE source_id = %s AND player_id IS NOT NULL",
    "linked_persons_dg": "SELECT count(*) FROM draft_persons WHERE source_id = %s AND player_id IS NOT NULL",
}.items():
    state["counts"][label] = q(sql, dg)[0][0]

# full rows for column diffs (private; contain names)
for name, sql in {
    "draft_picks": "SELECT row_to_json(t)::text FROM (SELECT * FROM draft_picks WHERE source_id = %s ORDER BY id) t",
    "draft_persons": "SELECT row_to_json(t)::text FROM (SELECT * FROM draft_persons WHERE source_id = %s ORDER BY id) t",
    "external_identities": "SELECT row_to_json(t)::text FROM (SELECT * FROM external_identities WHERE source_id = %s ORDER BY id) t",
}.items():
    rows = [json.loads(r[0]) for r in q(sql, dg)]
    (rows_dir / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False))
    state["counts"][f"rows_{name}"] = len(rows)

# whole-surface digest of every non-DraftGuru-scoped table that must not move
state["untouched"] = {}
for t in ("players", "data_edits", "data_overrides", "player_link_resolutions", "matches", "player_match_stats"):
    cur.execute(f"SELECT md5(string_agg(md5(t::text), '' ORDER BY md5(t::text))) FROM {t} t")
    state["untouched"][t] = cur.fetchone()[0]
cur.execute("SELECT md5(string_agg(md5(t::text), '' ORDER BY md5(t::text))) FROM draft_picks t WHERE source_id IS DISTINCT FROM %s", (dg,))
state["untouched"]["draft_picks_non_dg"] = cur.fetchone()[0]
conn.rollback()
out.write_text(json.dumps(state, indent=1, default=str))
print(json.dumps({k: state[k] for k in ("counts", "link_digest")}, default=str))
