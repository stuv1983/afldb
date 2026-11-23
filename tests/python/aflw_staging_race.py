"""Matched CLI race regression on a fresh, socket-only PostgreSQL test cluster (AFLDB-ISSUE-368).

    AFLDB_TEST_DATABASE_URL='postgresql://<superuser>@/<name>_test?host=/abs/socket/dir&port=<port>' \\
        python tests/python/aflw_staging_race.py <source root holding tools/aflw and tools/migration> base|fixed

The target must be a migrated, privileged, disposable *_test database reached over a Unix socket directory.
Target enforcement is on the live connections, not on the DSN text: the writer and every connection the child
loader (tests/python/aflw_race_loader.py) opens are checked against the server-reported database and the
Unix-socket transport before their first write, with explicit checks that also hold under `python -O`
(tests/python/aflw_race_guard.py; refusals exit 3). The DSN check in main() is only an early diagnostic.
`base` is the expectation for the reviewed c154f36b loader (it reproduces the erased 2027 season); `fixed` is
the expectation for the replacement-lock loader.
Needs psycopg (the project virtual environment). A writer role that can SET ROLE afldb_import is required."""

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

import psycopg
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from aflw_race_guard import EXPECTED_ENV, REFUSAL_EXIT, connect_writer
from aflw_staging_contract import REAL_EXPECTED_SEASON_KEYS, dataset, ls, write

LOADER = Path(__file__).resolve().with_name("aflw_race_loader.py")


def fixture(keys):
    tables = dataset(["2037" if key == "7" else key for key in keys])
    for row in tables["matches"]:
        row["weather_raw"] = "Clear"
    for row in tables["player_match_stats"]:
        row.update(jumper_number="1", position="MID")
    for row in tables["player_seasons"]:
        row.update(kicks="3", handballs="2", disposals="5", contested="1", metres_gained="10",
                   marks="1", tackles="1", hitouts="0", fantasy_points="20",
                   source_page=f"player__{row['player_slug']}.html")
    for rows in tables.values():
        for row in rows:
            if row.get("season_key") == "2037":
                for col, value in row.items():
                    row[col] = value.replace("2037", "2022" if "date" in col or col == "calendar_year" else "7")
    return tables


def snapshot(conn):
    return {
        table: conn.execute(
            f"SELECT to_jsonb(t)::text FROM staging_aflw.{table} t ORDER BY 1"
        ).fetchall()
        for table, _ in ls.TABLES
    }


def public_2027(conn):
    return tuple(
        conn.execute(f"SELECT to_jsonb(t)::text FROM aflw.{view} t WHERE season_key = '2027' ORDER BY 1").fetchall()
        for view in ("seasons", "fixtures", "matches", "ladders", "player_match_stats", "player_seasons")
    )


def main():
    source, expectation = sys.argv[1:]
    dsn = os.environ["AFLDB_TEST_DATABASE_URL"]
    params = conninfo_to_dict(dsn)
    # Early diagnostic only (explicit, so it survives `python -O`). The enforcement is on the live writer and
    # loader connections below; this only fails fast on an obviously wrong DSN.
    expected_db = params.get("dbname", "")
    if not (params.get("host", "").startswith("/") and expected_db.endswith("_test")):
        print("REFUSED [dsn]: AFLDB_TEST_DATABASE_URL must use a Unix socket directory (host=/abs/path) "
              "and a *_test database", file=sys.stderr)
        raise SystemExit(REFUSAL_EXIT)
    old_keys = REAL_EXPECTED_SEASON_KEYS
    new_keys = [*old_keys, "2027"]
    loader_dsn = make_conninfo(dsn, application_name="aflw_staging_race_loader", options="-c role=afldb_import")
    env = dict(os.environ, AFLDB_IMPORT_DATABASE_URL=loader_dsn, **{EXPECTED_ENV: expected_db})
    # The child is a separate interpreter: carry -O across so the child guard is exercised under it too.
    interpreter = [sys.executable, *(["-" + "O" * sys.flags.optimize] if sys.flags.optimize else [])]

    with tempfile.TemporaryDirectory() as tmp, connect_writer(psycopg, dsn, expected_db) as writer:
        old = Path(tmp) / "old"
        complete = Path(tmp) / "complete"
        write(old, fixture(old_keys))
        write(complete, fixture(new_keys))

        def command(directory, inventory="stock"):
            return [*interpreter, str(LOADER), source, inventory, "--load", "--in", str(directory)]

        def run(directory, inventory="stock"):
            return subprocess.run(command(directory, inventory), env=env, capture_output=True, text=True, timeout=20)

        initial = run(old)
        assert initial.returncode == 0, initial.stdout + initial.stderr
        print("PASS complete reviewed eleven-season generation loads through CLI")
        writer.execute("SET LOCAL ROLE afldb_import")
        rows = fixture(new_keys)
        for table, columns in ls.TABLES:
            for row in rows[table]:
                if row.get("season_key") != "2027":
                    continue
                with writer.cursor().copy(f"COPY staging_aflw.{table} ({', '.join(columns)}) FROM STDIN") as copy:
                    copy.write_row([row[c] if row[c] or c in ls.BLANK_IS_EMPTY_STRING else None for c in columns])
        before = snapshot(writer)
        public = public_2027(writer)
        assert all(public), "writer did not produce 2027 public rows"

        with subprocess.Popen(command(old), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) as loader:
            try:
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    writer.execute("SELECT pg_stat_clear_snapshot()")
                    blocked = writer.execute(
                        "SELECT true FROM pg_stat_activity WHERE application_name = 'aflw_staging_race_loader' "
                        "AND pg_backend_pid() = ANY(pg_blocking_pids(pid))"
                    ).fetchone()
                    if blocked:
                        break
                    assert loader.poll() is None, "loader exited before waiting for writer"
                    time.sleep(0.02)
                else:
                    raise AssertionError("loader never blocked behind writer")
                print("PASS PostgreSQL identifies the writer as the CLI loader's blocker before commit")
                writer.commit()
                stdout, stderr = loader.communicate(timeout=20)
            finally:
                if loader.poll() is None:
                    loader.kill()

        if expectation == "base":
            assert loader.returncode == 0, stdout + stderr
            assert not any(public_2027(writer)) and snapshot(writer) != before
            print("REPRODUCED base exits 0 and erases the committed 2027 season and public rows")
            return
        assert expectation == "fixed"
        assert loader.returncode == 1 and "omits existing staging seasons: 2027" in stderr, stdout + stderr
        assert snapshot(writer) == before
        assert public_2027(writer) == public
        print("PASS fixed CLI exits 1 and preserves every staging row and all six 2027 public views")
        writer.commit()
        replacement = run(complete, "expanded")
        assert replacement.returncode == 0, replacement.stdout + replacement.stderr
        assert snapshot(writer) == before and public_2027(writer) == public
        print("PASS complete replacement succeeds with an independently advanced test inventory")


if __name__ == "__main__":
    main()
