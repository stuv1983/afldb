"""Child loader entry point for tests/python/aflw_staging_race.py (AFLDB-ISSUE-368).

    python [-O] tests/python/aflw_race_loader.py <source root> stock|expanded --load --in <dir>

Runs the real tools/aflw/load_staging.py main() under a per-connection target guard: every connection this
process opens is verified against AFLW_RACE_EXPECTED_DATABASE and the Unix-socket requirement before the
loader's first statement (see aflw_race_guard.py). The loader's own source is not modified; the normal loader
entry point (tools/aflw/load_staging.py) does not import this guard.
"""

import os
import sys

import psycopg

from aflw_race_guard import EXPECTED_ENV, install_connection_guard

source, inventory = sys.argv[1], sys.argv[2]
del sys.argv[1:3]
install_connection_guard(psycopg, os.environ.get(EXPECTED_ENV, ""), "loader")
sys.path.insert(0, source + "/tools/aflw")
import load_staging as ls  # noqa: E402

if inventory == "expanded":
    ls.EXPECTED_SEASON_KEYS = [*ls.EXPECTED_SEASON_KEYS, "2027"]
raise SystemExit(ls.main())
