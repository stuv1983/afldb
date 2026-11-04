#!/usr/bin/env python3
"""ISSUE-333 / O2 rehearsal helper. Runs ONLY inside `tools/v2/isolated-pg.ts run <afldb_v2_*_test> --` on the guarded loopback cluster (it refuses
anything else). Owner connection from AFLDB_TEST_DATABASE_URL (the isolated runner sets it; never printed).

    target                 print the isolated target identity JSON the ceremonies take as --target
    digests                print tool-INDEPENDENT row digests (row(t.*)::text, TimeZone UTC) of everything the two operations must preserve or change
    fixture <name>         apply one clone-only rehearsal fixture (conflict, drift, rollback triggers, an already-resolved finding)
    hold-lock <what> <s>   hold a conflicting lock for <s> seconds (uncertain-outcome rehearsal); prints LOCKED when held
    wait-writer <app> <wait_event_type> <s>  wait until a backend with application_name <app> waits on <wait_event_type> (Lock, Timeout); prints its pid
    wait-gone <app> <s>    wait until no backend with application_name <app> exists
"""
import json
import os
import re
import sys
import time
from urllib.parse import urlparse

import psycopg

DSN = os.environ.get("AFLDB_TEST_DATABASE_URL", "")
if os.environ.get("AFLDB_V2_ISOLATED_PG") != "1" or not re.fullmatch(r"afldb_v2_[a-z0-9_]+_test", urlparse(DSN).path.lstrip("/")) \
        or urlparse(DSN).hostname not in ("127.0.0.1", "localhost"):
    sys.exit("refused: not inside the guarded isolated runner on an afldb_v2_*_test database")


def conn(autocommit=True):
    c = psycopg.connect(DSN, autocommit=autocommit, application_name="afldb-issue333-o2-rehearsal-helper")
    c.execute("SET TimeZone = 'UTC'")
    with c.cursor() as cur:
        cur.execute("SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()")
        if cur.fetchone()[0] != "afldb-v2-isolated-test":
            sys.exit("refused: the database is not marked as an isolated test database")
    return c


def one(c, q, p=None):
    with c.cursor() as cur:
        cur.execute(q, p)
        return cur.fetchone()


def main(argv):
    mode = argv[0]
    c = conn()
    if mode == "target":
        u = urlparse(DSN)
        db, user, sysid, oid, cluster, comment = one(c, "SELECT current_database(), current_user, c.system_identifier::text, d.oid::text, current_setting('cluster_name'), "
                                                        "shobj_description(d.oid,'pg_database') FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database()")
        print(json.dumps({"host": u.hostname, "port": u.port or 5432, "database": db, "user": user, "systemIdentifier": sysid, "databaseOid": oid,
                          "clusterName": cluster, "databaseComment": comment}, sort_keys=True))
        return 0
    if mode == "digests":
        q = {
            "match_coaches_not_2026": "SELECT count(*), md5(coalesce(string_agg(row(m.*)::text, '|' ORDER BY m.match_id, m.club_id), '')) FROM match_coaches m JOIN matches x ON x.id = m.match_id WHERE x.season <> 2026",
            "match_coaches_2026": "SELECT count(*), md5(coalesce(string_agg(row(m.match_id, m.club_id, m.coach_id, m.source_id, m.source_record_id)::text, '|' ORDER BY m.match_id, m.club_id), '')) FROM match_coaches m JOIN matches x ON x.id = m.match_id WHERE x.season = 2026",
            "sides_2026_without_coach": "SELECT count(*), '' FROM matches x CROSS JOIN LATERAL (VALUES (x.home_club_id), (x.away_club_id)) s(club_id) WHERE x.season = 2026 AND NOT EXISTS (SELECT 1 FROM match_coaches m WHERE m.match_id = x.id AND m.club_id = s.club_id)",
            "coaches": "SELECT count(*), md5(coalesce(string_agg(row(c.*)::text, '|' ORDER BY c.id), '')) FROM coaches c",
            "import_batches_le_82": "SELECT count(*), md5(coalesce(string_agg(row(b.*)::text, '|' ORDER BY b.id), '')) FROM import_batches b WHERE b.id <= 82",
            "import_batches_gt_82": "SELECT count(*), coalesce(string_agg(b.id::text || ':' || b.tool || ':' || b.status::text || ':' || coalesce(b.records_inserted, -1)::text, ' ' ORDER BY b.id), '') FROM import_batches b WHERE b.id > 82",
            "import_rejections": "SELECT count(*), coalesce(max(id), 0)::text FROM import_rejections",
            "data_issues_41_76_unresolved": "SELECT count(*), md5(coalesce(string_agg(row(d.*)::text, '|' ORDER BY d.id), '')) FROM data_issues d WHERE d.id BETWEEN 41 AND 76 AND d.resolved_at IS NULL",
            "data_issues_41_76_resolved_not_needed": "SELECT count(*), count(DISTINCT resolved_at)::text FROM data_issues d WHERE d.id BETWEEN 41 AND 76 AND d.resolution = 'canonical_apply_not_needed' AND d.resolved_at IS NOT NULL",
            "data_issues_41_76_fixed_columns": "SELECT count(*), md5(coalesce(string_agg(row(d.id, d.entity_type, d.entity_id, d.issue_type, d.severity, d.description, d.details, d.detected_at, d.issue_key)::text, '|' ORDER BY d.id), '')) FROM data_issues d WHERE d.id BETWEEN 41 AND 76",
            "data_issues_other": "SELECT count(*), md5(coalesce(string_agg(row(d.*)::text, '|' ORDER BY d.id), '')) FROM data_issues d WHERE d.id NOT BETWEEN 41 AND 76",
            "player_match_stats_flagged_rows": "SELECT count(*), md5(coalesce(string_agg(row(p.*)::text, '|' ORDER BY p.id), '')) FROM player_match_stats p WHERE p.id IN (SELECT entity_id FROM data_issues WHERE id BETWEEN 41 AND 76)",
            "user_triggers_touched_tables": "SELECT count(*), coalesce(string_agg(c.relname || '.' || t.tgname, ' ' ORDER BY c.relname, t.tgname), '') FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND c.relname IN ('match_coaches', 'coaches', 'import_batches', 'data_issues')",
        }
        out = {k: [str(x) for x in one(c, v)] for k, v in q.items()}
        out["_identity"] = list(one(c, "SELECT current_database(), current_user, current_setting('TimeZone')"))
        print(json.dumps(out, sort_keys=True))
        return 0
    if mode == "fixture":
        name = argv[1]
        if name == "i333-conflict":
            # one pre-existing 2026 assignment with a coach the source does NOT assert for that side (the away side's 2026 coach on the home side)
            r = one(c, "WITH m AS (SELECT id, home_club_id, away_club_id FROM matches WHERE season = 2026 ORDER BY id LIMIT 1) "
                       "SELECT m.id, m.home_club_id, (SELECT min(id) FROM coaches WHERE afltables_coach_path = 'coaches/Josh_Carr.html') FROM m")
            c.execute("INSERT INTO match_coaches (match_id, club_id, coach_id, source_id, source_record_id) VALUES (%s, %s, %s, (SELECT id FROM sources WHERE key = 'afltables'), 'rehearsal-conflict')", r)
            print(f"fixture i333-conflict: match {r[0]} club {r[1]} coach {r[2]}")
        elif name == "i333-drift-coach":
            c.execute("UPDATE coaches SET notes = 'rehearsal drift after plan' WHERE afltables_coach_path = 'coaches/Josh_Fraser.html'")
            print("fixture i333-drift-coach: one coaches.notes changed")
        elif name in ("i333-trigger-commit", "o2-trigger-commit"):
            table = "match_coaches" if name.startswith("i333") else "data_issues"
            event = "INSERT" if table == "match_coaches" else "UPDATE"
            c.execute("CREATE FUNCTION public.rehearsal_fail_at_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'rehearsal: deferred constraint trigger fails at COMMIT'; END $$")
            c.execute(f"CREATE CONSTRAINT TRIGGER rehearsal_fail_at_commit AFTER {event} ON public.{table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.rehearsal_fail_at_commit()")
            print(f"fixture {name}: deferred constraint trigger on {table} raises at COMMIT")
        elif re.fullmatch(r"(i333|o2)-trigger-sleep-[0-9]+", name):
            # review F-001: a deferred constraint trigger that sleeps ONCE at COMMIT (so a killed client's COMMIT is demonstrably in flight)
            table = "match_coaches" if name.startswith("i333") else "data_issues"
            event = "INSERT" if table == "match_coaches" else "UPDATE"
            secs = int(name.rsplit("-", 1)[1])
            c.execute("CREATE FUNCTION public.rehearsal_sleep_at_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
                      "IF current_setting('rehearsal.slept', true) IS DISTINCT FROM 'y' THEN PERFORM set_config('rehearsal.slept', 'y', true); "
                      f"PERFORM pg_sleep({secs}); END IF; RETURN NULL; END $$")
            c.execute(f"CREATE CONSTRAINT TRIGGER rehearsal_sleep_at_commit AFTER {event} ON public.{table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.rehearsal_sleep_at_commit()")
            print(f"fixture {name}: deferred constraint trigger on {table} sleeps {secs} s once at COMMIT")
        elif name == "i333-trigger-preserve":
            # review F-005 4c: a statement trigger that changes ONE pre-existing (2025) assignment's import_batch_id inside the write transaction
            c.execute("CREATE FUNCTION public.rehearsal_touch_old() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
                      "UPDATE match_coaches m SET import_batch_id = NULL WHERE (m.match_id, m.club_id) = (SELECT m2.match_id, m2.club_id FROM match_coaches m2 "
                      "JOIN matches x ON x.id = m2.match_id WHERE x.season = 2025 AND m2.import_batch_id IS NOT NULL ORDER BY 1, 2 LIMIT 1); RETURN NULL; END $$")
            c.execute("CREATE TRIGGER rehearsal_touch_old AFTER INSERT ON public.match_coaches FOR EACH STATEMENT EXECUTE FUNCTION public.rehearsal_touch_old()")
            print("fixture i333-trigger-preserve: AFTER INSERT statement trigger changes one 2025 assignment's import_batch_id")
        elif name == "i333-trigger-surplus":
            c.execute("CREATE FUNCTION public.rehearsal_surplus_batch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
                      "INSERT INTO import_batches (source_id, tool, target_table, notes) VALUES ((SELECT id FROM sources WHERE key = 'afltables'), 'rehearsal-surplus', 'match_coaches', 'surplus write by a clone-only trigger'); "
                      "RETURN NULL; END $$")
            c.execute("CREATE TRIGGER rehearsal_surplus_batch AFTER INSERT ON public.match_coaches FOR EACH STATEMENT EXECUTE FUNCTION public.rehearsal_surplus_batch()")
            print("fixture i333-trigger-surplus: AFTER INSERT statement trigger adds a surplus import_batches row")
        elif name == "o2-trigger-surplus":
            c.execute("CREATE FUNCTION public.rehearsal_surplus_issue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
                      "IF pg_trigger_depth() = 1 THEN UPDATE data_issues SET description = description || ' (rehearsal surplus)' WHERE id = (SELECT min(id) FROM data_issues WHERE id NOT BETWEEN 41 AND 76); END IF; "
                      "RETURN NULL; END $$")
            c.execute("CREATE TRIGGER rehearsal_surplus_issue AFTER UPDATE ON public.data_issues FOR EACH STATEMENT EXECUTE FUNCTION public.rehearsal_surplus_issue()")
            print("fixture o2-trigger-surplus: AFTER UPDATE statement trigger changes one other data_issues row")
        elif name == "o2-drift-canonical":
            d = one(c, "SELECT entity_id, details->'fields'->>0 FROM data_issues WHERE id = 41")
            if not re.fullmatch(r"[a-z_0-9]+", d[1] or ""):
                sys.exit("unexpected field name")
            c.execute(f"UPDATE player_match_stats SET {d[1]} = {d[1]} + 1 WHERE id = %s", (d[0],))
            print(f"fixture o2-drift-canonical: player_match_stats {d[0]} {d[1]} + 1")
        elif name == "o2-resolve-one":
            c.execute("UPDATE data_issues SET resolved_at = now(), resolution = 'rehearsal: resolved by someone else' WHERE id = 41")
            print("fixture o2-resolve-one: data_issues 41 resolved by another actor")
        else:
            sys.exit(f"unknown fixture {name}")
        return 0
    if mode == "hold-lock":
        what, seconds = argv[1], float(argv[2])
        h = conn(autocommit=False)
        with h.cursor() as cur:
            if what == "import_batches":
                cur.execute("LOCK TABLE public.import_batches IN SHARE MODE")
            elif what == "data_issues_41":
                cur.execute("SELECT id FROM data_issues WHERE id = 41 FOR UPDATE")
            else:
                sys.exit("unknown lock")
            print("LOCKED", flush=True)
            time.sleep(seconds)
        h.rollback()
        h.close()
        print("RELEASED", flush=True)
        return 0
    if mode == "wait-writer":
        # as the writer's own role (afldb_import), which sees its sessions' wait events; a fresh transaction per poll (pg_stat_activity is a snapshot)
        app, event_type, seconds = argv[1], argv[2], float(argv[3])
        ic = psycopg.connect(os.environ["AFLDB_IMPORT_DATABASE_URL"], autocommit=True, application_name="afldb-issue333-o2-rehearsal-watch")
        end = time.time() + seconds
        while time.time() < end:
            with ic.cursor() as cur:
                cur.execute("SELECT pid, wait_event_type, wait_event FROM pg_stat_activity WHERE application_name = %s AND wait_event_type = %s", (app, event_type))
                r = cur.fetchone()
            if r:
                print(f"WAITING pid={r[0]}", flush=True)
                return 0
            time.sleep(0.2)
        print("NOT-SEEN")
        return 1
    if mode == "wait-gone":
        app, seconds = argv[1], float(argv[2])
        end = time.time() + seconds
        while time.time() < end:
            if not one(c, "SELECT count(*) FROM pg_stat_activity WHERE application_name = %s", (app,))[0]:
                print("GONE", flush=True)
                return 0
            c.commit() if not c.autocommit else None
            time.sleep(0.5)
        print("STILL-LIVE")
        return 1
    sys.exit("unknown mode")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
