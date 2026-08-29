#!/usr/bin/env python3
"""RETIRED — the legacy DraftGuru importer (AFLDB-ISSUE-093 Stage B2-7).

This command no longer exists. It is a tombstone: it reads nothing, writes nothing, and
exits non-zero.

The supported importer is:

    tools/rebuild/draftguru/import_draftguru.py

Why this file is a tombstone rather than simply deleted
-------------------------------------------------------
The legacy implementation loaded draft facts from ``AFLDB_LEGACY_SQLITE`` and resolved links
through ``players.legacy_player_id``. Neither is available on the rebuilt path:
``import_fitzroy_core.py`` never populates ``legacy_player_id``, and the DraftGuru source of
truth is now the accepted Stage A snapshot.

Running the old command against a rebuilt database would therefore not be a no-op. It would
replace the accepted Stage A-derived population (5,057 persons / 6,810 picks) with
legacy-derived rows, and wipe every link, because the identity mapping it depends on resolves
nothing. Two operator documents printed this command for a long time, so a deterministic
failure that names the replacement is safer than ``File Not Found`` and far safer than silent
execution.

The legacy implementation is NOT retained behind this wrapper, and nothing here delegates to
the replacement: the two take different arguments and read different sources, so a silent
hand-off would be a trap of its own.

What replaced it
----------------
``tools/rebuild/draftguru/import_draftguru.py`` imports the same 5,057 persons / 6,810 picks
from tracked, reproducible inputs with **zero** ``AFLDB_LEGACY_SQLITE`` dependency:

    * the accepted Stage A snapshot + manifest (every raw page sha256-verified, then re-parsed
      with the tested ``parse_draft_snapshot`` parser);
    * ``data/reference/draftguru-event-kinds.json`` — frozen event/signing contract;
    * ``tools/rebuild/draftguru/draftguru-contract.json`` — identity and club resolution;
    * ``data/reference/clubs.json`` / ``seasons.json``;
    * ``data/reference/draftguru-link-decisions.json`` — the explicit human decisions;
    * optionally, an approved bridge dataset via ``--bridge``.

Its behaviour is proven by ``tests/draftguru-import.test.ts`` and
``tests/integration/draftguru-import.test.ts``, which together carry every invariant this
file's own regression suite used to protect: migration-069 stable person and pick identity,
source ownership, manual link preservation, confirmed_unlinked, contradictory-decision
refusal, foreign-row preservation and idempotence. The mapping is recorded in
issues/closed/AFLDB-ISSUE-093-DRAFTGURU-B2-HANDOFF.md §89.

Historical records in ``issues.md``, ``CHANGELOG.md`` and the ISSUE-078/079/080/084 runbooks
deliberately still describe this file as it was. They are history and remain accurate.
"""

from __future__ import annotations

import sys

REPLACEMENT = "tools/rebuild/draftguru/import_draftguru.py"


def main() -> int:
    print(
        "tools/migration/import_draft.py is RETIRED (AFLDB-ISSUE-093 Stage B2-7).\n"
        "\n"
        "Nothing was read and nothing was written.\n"
        "\n"
        f"Use the supported DraftGuru importer instead:\n"
        f"\n"
        f"    python {REPLACEMENT} --validate-only     # check every input, no database\n"
        f"    python {REPLACEMENT} --dry-run           # full run, rolled back\n"
        f"    python {REPLACEMENT}\n"
        "\n"
        "It loads the same 5,057 persons / 6,810 picks from the accepted Stage A snapshot and\n"
        "the tracked reference/decision artefacts, with zero AFLDB_LEGACY_SQLITE dependency.\n"
        "\n"
        "This command is not a wrapper: the two take different arguments and read different\n"
        "sources, so it will not run the replacement for you.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
