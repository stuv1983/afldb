# Run 2 — retained test fixtures (read-only search, 2026-11-14)

Search by the orchestrator (the `fixtures` mechanic identified the required files and pins read-only but declined host
commands; its findings are reproduced below). Script `search.sh`, full output `search-out.txt` (names, sizes, sha256 only;
roots per RUN-PLAN-2 P2-04; `private/` pruned; nothing copied, opened or modified; no workstation search).

## Required files and pins

| Test | Expected path (repo-relative, hard-coded) | Pin |
|---|---|---|
| `tests/fitzroy-core-import.test.ts` (4 cases; `:1774-1775`, `:2085-2086`) | `data/sources/afltables/fitzroy_core/full-history-20260902/` (131 files) | manifest `docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260902.json` sha256 `2bd66e3d…a0c1` (`data/reference/fitzroy-accepted-baselines.json:261`), per-file sha256 inside it; artefact set `15ba5dc6…dd6c`, 131 files, 719,042 rows (`:289-291`) |
| `tests/draftguru-acquisition.test.ts` (2 cases; `:1751-1757`) | `data/sources/draftguru/person-html-20260826/sample.json` | sha256 `d8d743fbcfca39a4c9e708a1198c7e34592270d32628d4fc0003aea88068db28` (`docs/rebuild-manifests/draftguru/person-html-20260826.json:328`, `:344`) |

Note (mechanic F-003, LOW): the fitzRoy test reads `full-history-20260902`, which the register marks retired
(`fitzroy-accepted-baselines.json:224`); the accepted baseline is `c2-2026-final-core-v1` (`:449`). The test pins the
historical snapshot deliberately for its import-contract cases; no change proposed here.

## Hits

| Fixture | Location (read-only) | Verification | Result |
|---|---|---|---|
| fitzRoy `full-history-20260902` | `/home/arm/projects/afldb/data/sources/afltables/fitzroy_core/full-history-20260902` (DEV checkout data, gitignored) | `sha256sum -c` of all 131 files against the per-file hashes extracted from the committed manifest (`fh-expected.sha256`): rc 0, 0 failures; 131 files present, none extra | **MATCH** |
| DraftGuru `person-html-20260826/sample.json` | `/mnt/ssd/afldb/workspaces/i336-preview2-20261106/checkout/data/sources/draftguru/person-html-20260826/sample.json` (102,052 bytes, mtime 2026-10-19) | sha256 | **MATCH** `d8d743fb…db28` |

Also present (not needed by the failing cases): four retained copies of `c2-2026-final-core-v1` (132 files each) and
Stage A `annual-html-20260826` copies; committed copies of both fitzRoy manifests in many retained checkouts, all with
the pinned hashes.

## Use in final qualification

The integration workspace takes a hash-verified, read-only (`chmod -R a-w`) copy of each hit into its own checkout's
`data/sources/...` path, re-verified after copying, so no test can write to the DEV checkout. Unit results are reported
with and without these fixtures.
