#!/usr/bin/env python3
"""RETIRED (AFLDB-ISSUE-241, 2026-09-26) -- the AFL API player-identity bridge loader is now
``tools/migration/import_afl_api_player_bridge.ts``.

This file used to be the fail-closed loader for the four AFL API bridge evidence classes
(AFLDB-ISSUE-228 S5/S5b/Sec 9.10/S9). It linked each provider to the artefact's bare,
database-local ``candidate_player_id``. After a rebuild or promotion renumbers ``players.id``,
that integer can name a different person, so an ``--apply`` could link a provider to the wrong
player (AFLDB-ISSUE-241).

The replacement resolves every row through its stable identity on the target, using the one
reverse-identity implementation every AFL API lifecycle already shares (ISSUE-237 Sec 5,
``classifyAflApiReverseIdentity``). That implementation is TypeScript; a Python copy would be a
second identity implementation, so the loader moved instead. It keeps every contract this file
enforced (closed target list, DSN and role proof, the season provenance gate, pinned-input
hashes, never UPDATE/DELETE) and adds the ISSUE-241 identity contract and the ISSUE-240
contradiction dedup.

This stub refuses every invocation, writes nothing and opens no connection:

    npx tsx tools/migration/import_afl_api_player_bridge.ts --validate-only --artefact <path> [--target afldb_test|dev]
"""

from __future__ import annotations

import sys

REPLACEMENT = "tools/migration/import_afl_api_player_bridge.ts"


def main(argv: list[str] | None = None) -> int:
    print(
        "REFUSED: tools/migration/import_afl_api_player_bridge.py is retired (AFLDB-ISSUE-241). "
        f"Use: npx tsx {REPLACEMENT} --validate-only|--dry-run|--apply --artefact <path> "
        "[--target afldb_test|dev]. Nothing was read or written.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
