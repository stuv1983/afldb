"""Refusal proof for the AFLW race-test target guard (AFLDB-ISSUE-368). Disposable PostgreSQL targets only.

    AFLW_REFUSAL_SOCKET_DIR=/abs/socket/dir AFLW_REFUSAL_PORT=<port> AFLW_REFUSAL_USER=<superuser> \\
    AFLW_REFUSAL_OK_DB=<name>_test AFLW_REFUSAL_PLAIN_DB=<name without _test> AFLW_REFUSAL_OTHER_DB=<other>_test \\
        python tests/python/aflw_race_guard_refusals.py <source root holding tools/aflw and tools/migration>

The cluster must serve the same port on that Unix socket directory and on 127.0.0.1 (trust auth for the
superuser), and the three databases must be migrated, privileged and have EMPTY staging_aflw tables (fresh
clones of one template). The driver first snapshots all three from read-only observer connections. It then seeds
ONLY the two `_test` databases with the reviewed eleven-season generation, through the guarded loader; the
unsuffixed database is never seeded and stays empty. It then tries to load a different generation (twelve seasons,
so a stray write is visible) through each refused path, in normal and `python -O` interpreters, and after setup
and after every refusal group compares every database against its snapshot from an independent read-only
connection (the eight staging_aflw tables and the six aflw public views). Every connection the driver makes to
the unsuffixed database for setup or observation is read-only (default_transaction_read_only, verified with SHOW);
the only other connections to it are the refusal probes, which exist to be refused by the guard under test.

The writer and the child loader are exercised independently: the loader cases invoke
tests/python/aflw_race_loader.py directly, so an early refusal by the writer cannot mask a missing loader guard.
Every refusal must exit with REFUSAL_EXIT and print the guard's own message for that connection (an unrelated
failure does not count). A final control shows the guard admits the intended socket target.
Exit 0 = every refusal held. Exit 1 = one did not, and it says which."""

import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import psycopg
from psycopg.conninfo import make_conninfo

import aflw_staging_race as race
from aflw_race_guard import EXPECTED_ENV, REFUSAL_EXIT, connect_writer
from aflw_staging_contract import REAL_EXPECTED_SEASON_KEYS, write

HERE = Path(__file__).resolve()
LOADER = HERE.with_name("aflw_race_loader.py")
AFLW_VIEWS = ("seasons", "fixtures", "matches", "ladders", "player_match_stats", "player_seasons")


def probe(argv):
    """Child-process mode: one writer-side attempt, so exit status and -O are those of a real process."""
    mode = argv[0]
    if mode == "writer-direct":
        conn = connect_writer(psycopg, argv[1], argv[2])
        conn.close()
        print("ADMITTED")
        return
    if mode == "writer-main":
        redirect = os.environ["AFLW_REFUSAL_REDIRECT_DSN"]
        original = psycopg.Connection.connect.__func__

        def redirected(cls, *args, **kwargs):
            return original(cls, redirect)

        # The DSN handed to the race test looks valid; the connection that is actually made lands elsewhere.
        psycopg.Connection.connect = classmethod(redirected)
        psycopg.connect = psycopg.Connection.connect
        sys.argv = [sys.argv[0], argv[1], "fixed"]
        race.main()
        return
    raise SystemExit(f"unknown probe {mode}")


def main():
    source = sys.argv[1]
    cfg = {k: os.environ[f"AFLW_REFUSAL_{k}"] for k in ("SOCKET_DIR", "PORT", "USER", "OK_DB", "PLAIN_DB", "OTHER_DB")}
    tcp_host = os.environ.get("AFLW_REFUSAL_TCP_HOST", "127.0.0.1")
    ok_db, plain_db, other_db = cfg["OK_DB"], cfg["PLAIN_DB"], cfg["OTHER_DB"]
    if not (ok_db.endswith("_test") and other_db.endswith("_test") and not plain_db.endswith("_test")):
        raise SystemExit("OK_DB and OTHER_DB must end in _test; PLAIN_DB must not")

    def dsn(db, tcp=False, role=False, readonly=False):
        params = dict(user=cfg["USER"], port=cfg["PORT"], dbname=db, host=tcp_host if tcp else cfg["SOCKET_DIR"])
        options = (["-c role=afldb_import"] if role else []) + (["-c default_transaction_read_only=on"] if readonly else [])
        if options:
            params["options"] = " ".join(options)
        return make_conninfo(**params)

    failures, checked = [], 0

    def expect(label, condition, detail=""):
        nonlocal checked
        checked += 1
        print(("PASS " if condition else "FAIL ") + label + (f"  [{detail}]" if detail and not condition else ""))
        if not condition:
            failures.append(label)

    def observe():
        """Independent read-only observer connection per protected database (unguarded, no role, no writes).

        The session is read-only on the server (default_transaction_read_only, confirmed with SHOW), so the
        observer cannot change a database even by mistake. It reads every row of the eight staging_aflw tables and
        of the six aflw public views and returns digests, per-object row counts and the 2027 staging season count."""
        out = {}
        for db in (ok_db, plain_db, other_db):
            with psycopg.connect(dsn(db, readonly=True)) as conn:
                if conn.execute("SHOW transaction_read_only").fetchone()[0] != "on":
                    raise SystemExit(f"{db}: the observer connection is not read-only; refusing to observe")
                staging = race.snapshot(conn)
                views = {v: conn.execute(f"SELECT to_jsonb(t)::text FROM aflw.{v} t ORDER BY 1").fetchall() for v in AFLW_VIEWS}
                out[db] = dict(
                    staging=hashlib.sha256(repr(staging).encode()).hexdigest()[:16],
                    staging_counts={t: len(rows) for t, rows in staging.items()},
                    views=hashlib.sha256(repr(views).encode()).hexdigest()[:16],
                    view_counts={v: len(rows) for v, rows in views.items()},
                    seasons_2027=conn.execute("SELECT count(*) FROM staging_aflw.seasons WHERE season_key = '2027'").fetchone()[0],
                )
        return out

    def rows(snapshot):
        return sum(snapshot["staging_counts"].values()) + sum(snapshot["view_counts"].values())

    with tempfile.TemporaryDirectory() as tmp:
        old_dir, new_dir = Path(tmp) / "old", Path(tmp) / "new"
        write(old_dir, race.fixture(REAL_EXPECTED_SEASON_KEYS))
        write(new_dir, race.fixture([*REAL_EXPECTED_SEASON_KEYS, "2027"]))

        def loader(flags, directory, inventory, import_url, expected):
            env = {k: v for k, v in os.environ.items() if k not in (EXPECTED_ENV, "AFLDB_IMPORT_DATABASE_URL")}
            env["AFLDB_IMPORT_DATABASE_URL"] = import_url
            if expected is not None:
                env[EXPECTED_ENV] = expected
            return subprocess.run([sys.executable, *flags, str(LOADER), source, inventory, "--load", "--in", str(directory)],
                                  env=env, capture_output=True, text=True, timeout=120)

        # Initial read-only snapshot of all three databases, before any fixture setup. All must start EMPTY: the
        # unsuffixed database stays empty for the whole run, so any row that appears in it is a stray write.
        initial = observe()
        for db, snap in initial.items():
            if rows(snap):
                raise SystemExit(f"{db}: staging_aflw or its views are not empty; use fresh clones of a migrated template")
        print(f"initial snapshot (read-only observers): {len(initial)} databases, all eight staging tables and six public views empty")

        # Setup: the two _test databases are seeded with the eleven-season generation through the guarded loader.
        # Nothing here connects to the unsuffixed database for writing; each seed must change only its own target.
        previous = initial
        for db in (ok_db, other_db):
            seeded = loader([], old_dir, "stock", dsn(db, role=True), db)
            expect(f"seed {db} through the guarded loader", seeded.returncode == 0, seeded.stdout[-300:] + seeded.stderr[-300:])
            now = observe()
            others = [d for d in now if d != db]
            expect(f"seed {db}: only {db} changed (the other two databases are identical to their previous snapshot)",
                   rows(now[db]) > 0 and all(now[d] == previous[d] for d in others), f"previous={previous} now={now}")
            previous = now
        baseline = previous
        expect("setup left the unsuffixed database identical to its initial (empty) snapshot",
               baseline[plain_db] == initial[plain_db] and rows(baseline[plain_db]) == 0, repr(baseline[plain_db]))
        expect("the two _test databases are seeded with eleven seasons and no 2027 rows",
               all(rows(baseline[db]) > 0 and baseline[db]["seasons_2027"] == 0 for db in (ok_db, other_db)), repr(baseline))

        def unchanged(label):
            now = observe()
            expect(f"{label}: independent read-only connection sees every protected database unchanged "
                   f"(unsuffixed database still equal to its initial snapshot)",
                   now == baseline and now[plain_db] == initial[plain_db], f"before={baseline} after={now}")

        def refusal(label, result, who):
            ok = result.returncode == REFUSAL_EXIT and f"REFUSED [{who}]" in result.stderr
            first = (result.stderr.strip().splitlines() or [""])[-1][:160]
            expect(f"{label}: exit {result.returncode}, guard message: {first}", ok, result.stdout[-200:] + result.stderr[-300:])

        def writer_probe(flags, *args, env_extra=None):
            env = {k: v for k, v in os.environ.items() if k != "AFLDB_TEST_DATABASE_URL"}
            env.update(env_extra or {})
            return subprocess.run([sys.executable, *flags, str(HERE), "--probe", *args], env=env,
                                  capture_output=True, text=True, timeout=120)

        for flags in ([], ["-O"]):
            tag = "python -O" if flags else "python"
            # LOADER connection, invoked directly (no writer involved).
            refusal(f"[{tag}] loader, TCP to disposable _test database",
                    loader(flags, new_dir, "expanded", dsn(ok_db, tcp=True, role=True), ok_db), "loader")
            unchanged(f"[{tag}] loader TCP")
            refusal(f"[{tag}] loader, Unix socket to disposable database without the suffix",
                    loader(flags, new_dir, "expanded", dsn(plain_db, role=True), plain_db), "loader")
            unchanged(f"[{tag}] loader unsuffixed")
            refusal(f"[{tag}] loader, actual database {other_db} differs from intended {ok_db}",
                    loader(flags, new_dir, "expanded", dsn(other_db, role=True), ok_db), "loader")
            refusal(f"[{tag}] loader, actual database {ok_db} differs from intended {other_db}",
                    loader(flags, new_dir, "expanded", dsn(ok_db, role=True), other_db), "loader")
            unchanged(f"[{tag}] loader mismatch")
            refusal(f"[{tag}] loader, no intended database supplied",
                    loader(flags, new_dir, "expanded", dsn(ok_db, role=True), None), "loader")
            unchanged(f"[{tag}] loader unconfigured")

            # WRITER connection (the harness's own), independent of the loader.
            refusal(f"[{tag}] writer, TCP to disposable _test database",
                    writer_probe(flags, "writer-direct", dsn(ok_db, tcp=True), ok_db), "writer")
            refusal(f"[{tag}] writer, Unix socket to disposable database without the suffix",
                    writer_probe(flags, "writer-direct", dsn(plain_db), plain_db), "writer")
            refusal(f"[{tag}] writer, actual database {other_db} differs from intended {ok_db}",
                    writer_probe(flags, "writer-direct", dsn(other_db), ok_db), "writer")
            refusal(f"[{tag}] race test main(): valid-looking DSN whose live connection is TCP",
                    writer_probe(flags, "writer-main", source, env_extra={
                        "AFLDB_TEST_DATABASE_URL": dsn(ok_db), "AFLW_REFUSAL_REDIRECT_DSN": dsn(ok_db, tcp=True)}), "writer")
            refusal(f"[{tag}] race test main(): valid-looking DSN whose live database differs",
                    writer_probe(flags, "writer-main", source, env_extra={
                        "AFLDB_TEST_DATABASE_URL": dsn(ok_db), "AFLW_REFUSAL_REDIRECT_DSN": dsn(other_db)}), "writer")
            refusal(f"[{tag}] race test main(): TCP DSN (early diagnostic)",
                    writer_probe(flags, "writer-main", source, env_extra={
                        "AFLDB_TEST_DATABASE_URL": dsn(ok_db, tcp=True), "AFLW_REFUSAL_REDIRECT_DSN": dsn(ok_db)}), "dsn")
            unchanged(f"[{tag}] writer")

        # Control: the guard admits the intended Unix-socket target (and only that database changes).
        for flags in ([], ["-O"]):
            admitted = loader(flags, new_dir, "expanded", dsn(ok_db, role=True), ok_db)
            expect(f"control [{'python -O' if flags else 'python'}]: intended socket target admitted, exit {admitted.returncode}",
                   admitted.returncode == 0, admitted.stdout[-300:] + admitted.stderr[-300:])
        final = observe()
        expect("control wrote 2027 only to the intended database; the unsuffixed database still equals its initial snapshot",
               final[ok_db]["seasons_2027"] > 0 and final[ok_db] != baseline[ok_db] and final[other_db] == baseline[other_db]
               and final[plain_db] == initial[plain_db], repr(final))

    if failures:
        print(f"{len(failures)} of {checked} refusal checks FAILED")
        raise SystemExit(1)
    print(f"All {checked} AFLW race guard refusal checks hold.")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--probe":
        probe(sys.argv[2:])
    else:
        main()
