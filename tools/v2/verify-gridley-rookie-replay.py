"""GAP-029: prove the eight committed rookie repairs survive the REAL override replay.

Run only through isolated-pg.ts run afldb_v2_gap029_replay_test. The fixture removes
only the eight repair rows inside a rollback-only transaction on that disposable
clone; source facts, durable overrides and audits must remain unchanged. It does
not rebuild, reset or delete a database. PostgreSQL sequences may advance on the clone.
"""
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlparse

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "migration"))
from common import replay_admin_overrides  # noqa: E402


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    dsn = os.environ.get("AFLDB_TEST_DATABASE_URL", "")
    target = urlparse(dsn)
    if (os.environ.get("AFLDB_V2_ISOLATED_PG") != "1"
            or target.hostname != "127.0.0.1" or target.port != 55433
            or target.path != "/afldb_v2_gap029_replay_test"):
        raise RuntimeError("Guarded dedicated replay clone on port 55433 required")
    source = ROOT / "data" / "players" / "rookie-relisting-outcomes.csv"
    with source.open(encoding="utf-8", newline="") as handle:
        expected = list(csv.DictReader(handle))
    if len(expected) != 8 or any(row["verdict"] != "gridley_supported" for row in expected):
        raise RuntimeError("Committed rookie population changed")
    with psycopg.connect(dsn) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("""SELECT current_database() AS database, current_setting('cluster_name') AS cluster,
                shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname=current_database()""")
            facts = cur.fetchone()
            if facts != {"database": "afldb_v2_gap029_replay_test", "cluster": "afldb_v2_isolated", "marker": "afldb-v2-isolated-test"}:
                raise RuntimeError("Live isolated replay identity mismatch")

            def selections():
                cur.execute("""SELECT dp.id, ei.external_id AS profile, dp.source_record_id,
                    dp.draft_year, dp.draft_type, dp.draft_kind, dp.pick_number, c.slug,
                    dp.link_status_value, dp.match_method, dp.detail
                    FROM draft_picks dp JOIN sources s ON s.id=dp.source_id
                    JOIN clubs c ON c.id=dp.club_id JOIN external_identities ei ON ei.player_id=dp.player_id
                    JOIN sources es ON es.id=ei.source_id AND es.key='afltables'
                    WHERE s.key='manual_admin_edit' AND dp.detail LIKE 'V2-GAP-029;%'
                    ORDER BY ei.external_id COLLATE "C"
                    """
                )
                return cur.fetchall()

            def durable():
                cur.execute("""SELECT entity_key, override_values, admin_user_id FROM data_overrides
                    WHERE entity_type='draft_picks' AND field_group='selection' AND is_active
                    AND override_values->>'detail' LIKE 'V2-GAP-029;%' ORDER BY entity_key COLLATE "C"
                    """
                )
                return cur.fetchall()

            def audits():
                cur.execute("SELECT * FROM data_edits WHERE note LIKE 'V2-GAP-029:%' ORDER BY id")
                return cur.fetchall()

            before = selections()
            if len(before) != 8 or {row["profile"] for row in before} != {row["afltables_profile"] for row in expected}:
                raise RuntimeError("Eight repaired canonical selections required")
            for row in before:
                fact = next(item for item in expected if item["afltables_profile"] == row["profile"])
                if row["draft_kind"] != "rookie" or row["draft_year"] != int(fact["event_year"]) or row["pick_number"] != int(fact["pick"]):
                    raise RuntimeError("Selection differs from committed source facts")
            prior_durable, prior_audits = durable(), audits()
            if len(prior_durable) != 8 or len(prior_audits) != 8:
                raise RuntimeError("Eight durable overrides and audit rows required")
            semantic = lambda rows: [{k: v for k, v in row.items() if k != "id"} for row in rows]
            with conn.transaction():
                cur.execute("DELETE FROM draft_picks WHERE id = ANY(%s)", ([row["id"] for row in before],))
                if cur.rowcount != 8 or selections():
                    raise RuntimeError("Removal fixture did not remove exactly eight rows")
                replay_admin_overrides(conn, "draft_picks")
                restored = selections()
                if semantic(restored) != semantic(before):
                    raise RuntimeError("Replay failed to restore exact stable-identity selections")
                replay_admin_overrides(conn, "draft_picks")
                if selections() != restored or durable() != prior_durable or audits() != prior_audits:
                    raise RuntimeError("Replay is not idempotent or changed approval/audit history")
                raise psycopg.Rollback()
            if selections() != before or durable() != prior_durable or audits() != prior_audits:
                raise RuntimeError("Rollback failed to preserve the cloned fixture")
            report = {"database": facts["database"], "port": 55433, "removed": 8, "restored": 8,
                "secondReplayIdempotent": True, "auditsUnchanged": 8, "durableOverridesUnchanged": 8,
                "fixtureRolledBack": True, "baselinePreserved": "afldb_v2_rb_final_test",
                "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                "semanticSha256": digest(semantic(before)), "replay": "tools/migration/common.py replay_admin_overrides(draft_picks)"}
            with Path(args.report).open("x", encoding="utf-8") as handle:
                json.dump(report, handle, indent=2)
                handle.write("\n")
            print("GAP-029 actual replay PASS: 8 restored; second replay unchanged; audits and overrides preserved; fixture rolled back")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never echo a psycopg connection error or its connection parameters.
        print(str(error) if isinstance(error, RuntimeError) else type(error).__name__, file=sys.stderr)
        sys.exit(1)
