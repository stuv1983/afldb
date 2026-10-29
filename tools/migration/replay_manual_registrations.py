#!/usr/bin/env python3
"""AFLDB-ISSUE-245 -- replay the manual/post-baseline player registrations on a rebuilt database.

    python tools/migration/replay_manual_registrations.py

Run ONLY by tools/db/rebuild-test.ts, as the stage straight after
``manual-registrations-reinstate`` (which reinstated the captured
``data_overrides('players', 'manual_admin_edit:<token>', 'identity')`` creation records)
and straight before ``manual-registrations-verify`` (which proves the result).

It calls ``replay_admin_overrides(pg, "players")`` -- THE function production promotion
runs at "Post-promotion state" step 1 (docs/production-promotion.md) -- and nothing else.
That function re-creates each administrator-created player, its ``manual_admin_edit``
identity and its attached AFL Tables identity from the creation record, or binds the
token onto the source-owned player this rebuild's ``fitzroy`` stage already created under
that profile path. No second implementation of that lifecycle exists anywhere in the
rebuild: the TypeScript stages around this one only plan (and refuse) before it and
verify after it.

Target safety: the runner hands this process the target NAME in ``AFLDB_REBUILD_TARGET``
and the target's import DSN in ``AFLDB_IMPORT_DATABASE_URL``, as it does every data
stage. The name must be one of the two rebuild targets and the connected database must
be exactly that name, so a development DSN left in ``.env`` can never be written to.
One transaction: any refusal inside the replay rolls everything back.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import connect_pg, load_env, replay_admin_overrides, require_env, safe_dsn  # noqa: E402

# tools/db/rebuild-test.ts REBUILD_TARGETS -- the only databases a rebuild stage may write.
REBUILD_TARGETS = ("afldb_test", "code_test_db")

# V2 Launch F: tools/db/rebuild-test.ts ISOLATED_REBUILD_DATABASE / ISOLATED_REBUILD_NAME_PATTERN,
# admitted only inside an isolated run (AFLDB_V2_ISOLATED_PG=1 and AFLDB_V2_ISOLATED_PORT, as
# tools/v2/isolated-pg.ts run sets them) and only over a loopback DSN on that port.
ISOLATED_REBUILD_DATABASE = "afldb_v2_hist_test"
ISOLATED_REBUILD_NAME_PATTERN = re.compile(r"^afldb_v2_rb_[a-z0-9_]+_test$")
LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")


def isolated_refusal(target: str, dsn: str, env: dict[str, str]) -> str | None:
    """None when ``target`` is an isolated rebuild database this run may write, else why not."""
    if target != ISOLATED_REBUILD_DATABASE and not ISOLATED_REBUILD_NAME_PATTERN.match(target):
        return "not a rebuild target"
    if "prod" in target.lower() or "pre_rebuild" in target.lower():
        return "not a rebuild target"
    port_text = env.get("AFLDB_V2_ISOLATED_PORT", "")
    if env.get("AFLDB_V2_ISOLATED_PG") != "1" or not port_text.isdigit():
        return "an isolated-cluster target outside an isolated run"
    try:
        url = urlparse(dsn)
        port = url.port
    except ValueError:
        return "an isolated-cluster target whose DSN does not parse"
    if url.hostname not in LOOPBACK_HOSTS or port != int(port_text) or url.path.lstrip("/") != target:
        return "an isolated-cluster target whose DSN is not the isolated cluster's loopback DSN"
    return None


def main() -> int:
    load_env()
    target = require_env("AFLDB_REBUILD_TARGET")
    if target not in REBUILD_TARGETS:
        refusal = isolated_refusal(target, os.environ.get("AFLDB_IMPORT_DATABASE_URL", ""), dict(os.environ))
        if refusal is not None:
            sys.exit(f"REFUSED: AFLDB_REBUILD_TARGET '{target}' is {refusal} "
                     f"({', '.join(REBUILD_TARGETS)}). Nothing was written.")
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")
    print("AFLDB-ISSUE-245 manual registration replay")
    print(f"  target: {safe_dsn(dsn)}")

    pg = connect_pg(dsn)
    try:
        with pg.cursor() as cur:
            cur.execute("SELECT current_database()")
            (database,) = cur.fetchone()
            if database != target:
                raise RuntimeError(
                    f"connected to '{database}', not the rebuild target '{target}'. Nothing was written.")
            cur.execute("""
                SELECT count(*) FROM data_overrides
                 WHERE entity_type = 'players' AND field_group = 'identity' AND is_active
                   AND split_part(entity_key, ':', 1) = 'manual_admin_edit'
            """)
            (records,) = cur.fetchone()
        replay_admin_overrides(pg, "players")
        pg.commit()
    except BaseException:
        pg.rollback()
        raise
    finally:
        pg.close()
    print(f"  replayed replay_admin_overrides(players) over {records} creation record(s): committed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
