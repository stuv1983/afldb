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

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import connect_pg, load_env, replay_admin_overrides, require_env, safe_dsn  # noqa: E402

# tools/db/rebuild-test.ts REBUILD_TARGETS -- the only databases a rebuild stage may write.
REBUILD_TARGETS = ("afldb_test", "code_test_db")


def main() -> int:
    load_env()
    target = require_env("AFLDB_REBUILD_TARGET")
    if target not in REBUILD_TARGETS:
        sys.exit(f"REFUSED: AFLDB_REBUILD_TARGET '{target}' is not a rebuild target "
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
