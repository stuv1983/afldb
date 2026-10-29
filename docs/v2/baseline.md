# AFLDB V2 — baseline and source preservation (Stage 0)

Recorded 2026-10-19 by the primary session before any V2 change.

## Source

| Item | Value |
|---|---|
| Source worktree | `D:\dev\afldb-afl-api-cutover` (git worktree of `D:\dev\afldb`) |
| Branch | `opus/afl-api-cutover` |
| HEAD | `ff100dc2b8da8523f550ef45a9eaa3ef96d9d840` |
| Uncommitted | 11 modified tracked files + 8 untracked files (ISSUE-316 follow-up 8) |
| Source modified by V2 work | **No.** Only read-only commands (`git rev-parse`, `git status`, `git diff`, `git ls-files`, `sha256sum`, `cp` *from* it) were run against it. Nothing was staged, stashed, reset or cleaned. |

## Preservation

Snapshot directory (outside both checkouts): `D:\tmp\afldbV2-source-snapshot-20261019\`

| File | Content |
|---|---|
| `HEAD.txt`, `BRANCH.txt`, `status.txt` | revision, branch and `git status --porcelain=v1` |
| `tracked-changes.patch` | `git diff HEAD --binary` of the 11 modified tracked files |
| `untracked/…`, `untracked-list.txt` | byte copies of the 8 untracked files |
| `changed-files.txt`, `sha256-worktree.txt` | the 19 paths and their working-tree SHA-256 |
| `eol.txt` | `git ls-files --eol` for the tracked changes (most are `w/crlf`; `issues.md` and `IssuesIndex.md` are `w/lf`) |
| `snapshot-manifest.sha256` | SHA-256 of the patch and the untracked list |

Selected hashes (full list in `sha256-worktree.txt`):

| File | SHA-256 |
|---|---|
| `tools/current-season/afl-api-c4b-rehearsal.ts` | `65550c3f2ce70758bfa8338ed1fdc2e6e52117613c47f26a2f1770e6593a8485` (matches the ISSUE-316 follow-up 8 record) |
| `tests/afl-api-cutover.test.ts` | `271af205d01d6318d00d935e06d3d214ff6827ebf902a5ccdbd71a8715cebfcb` |
| `src/lib/acquisition/settle-trigger.ts` | `161cbe935829dad62537640597700e2f7a1aa7f9555b2ca1ff747ec4b28b3121` |
| `deploy/afldb-settle-afltables.sh` | `b26d16b583f3ed8e13ff3668fe8748d558886902ecd371c460cf70a23f32e80d` |
| `issues/open/AFLDB-ISSUE-316.md` | `fecc6f97388c1f3094cdaadc2265b5f7b72e5f7f3b281aa2ff29b9c837a5da0c` |

## V2 repository

| Item | Value |
|---|---|
| Path | `D:\dev\afldbV2` (did not exist before; created fresh) |
| Created by | `git clone --no-checkout D:\dev\afldb` then `git checkout -b v2/rebuild ff100dc2` |
| Remote | `origin` **removed** immediately: V2 has no remote, so nothing can be pushed by accident |
| Uncommitted work carried | the 19 files byte-copied from the source; `sha256sum -c` 19/19 OK; `git status --porcelain` identical to the source's |
| Secrets | none copied: `.env*` are untracked/ignored and were not copied; the only DSN-like strings in the carried diff are the fake `postgres://u:secret@h/db` redaction fixtures in `tests/afl-api-cutover.test.ts` |
| `node_modules` | V2's own, from `npm ci` (lockfile SHA-256 `435dc97e…8e91`, identical to the main checkout's); not a junction, so V2 test runs cannot write into another checkout |
| Database | none. No `.env`, no DSN, no tunnel. No local PostgreSQL, Docker or psql exists on the workstation. |

## Baseline verification in V2 (before any V2 change)

Commands ran with `DATABASE_URL`, `AFLDB_TEST_DATABASE_URL` and `AFLDB_TEST_IMPORT_DATABASE_URL`
unset, `vitest run --no-cache`, and `TEMP`/`TMP` pointed at the session scratch directory.

| Check | Result |
|---|---|
| Seven-suite set (`admin-current-season-settle`, `fitzroy-acquisition`, `coaches`, `club-list-sources`, `afl-api-ingestion-safety`, `season-rollover`, `afl-api-cutover`) | **829 passed, 2 skipped (831)**, identical to the source's last recorded run |
| `next typegen` + `tsc --noEmit --incremental false` | exit 0 |
| `eslint --no-cache .` (repository-wide) | **pre-existing: 253 errors, 132 warnings** in 111 files (224 `no-explicit-any`, 14 `no-require-imports`, 11 `renders`, 3 `react/no-children-prop`, 1 `react/no-unescaped-entities`). The source's "ESLint passed" claim covered eight files only. V2's lint gate: no increase over this count, and every file V2 creates or edits lints clean. |
| Full `vitest run --no-cache` | **Test files 96 failed, 167 passed, 2 skipped (265); tests 15 failed, 8,950 passed, 48 skipped (9,013)**, 340 s. All failures are pre-existing and environmental; the exact list is `docs/v2/evidence/baseline-failures.txt`. 83 integration files refuse to load ("AFLDB_TEST_DATABASE_URL must be set"), 2 more files plus `admin-coach-actions` and `register-issue224-s9-dev-write-gate` fail to load on "DATABASE_URL is not set". The 15 failing cases are, by their failure messages (classified, not individually re-investigated), Windows-checkout effects (CRLF bytes against regex/byte contracts: `finals-semantics-contract`, `awards-admin` 108 contract, `honours-lifecycle-public-contract`, `site-settings` defaults, `player-link-mutations` I14, `correct-afl-api-identity-cli`, `current-season-import` S6 wiring; POSIX execution of the settle shell script: `current-season-import` ISSUE-130 ×4, `behind-holder`) and git-ignored evidence absent from a fresh clone (`draftguru-acquisition` ×2: `data/sources/draftguru/annual-html-20260826` and the ISSUE-222 Phase 3 artefact). **V2 regression gate: no test outside this list may fail, and no listed test may be weakened to pass.** |

## Production contact

None. No command in the baseline contacted production, DEV, the dev host or `afldb_test`.
`npm ci` contacted only the public npm registry.
