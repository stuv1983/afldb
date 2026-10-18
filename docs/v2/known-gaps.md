# AFLDB V2 — known gaps, blockers and deferred work

`V2-GAP-NNN` entries (ADR 0003). Each states what is missing, why, the evidence, and what would
close it. An entry is removed only when the closing evidence exists.

| ID | Severity | Area | State |
|---|---|---|---|
| V2-GAP-001 | Medium | test safety | open: unverifiable locally |
| V2-GAP-002 | Medium | frontend build | open: needs a database |
| V2-GAP-003 | Medium | environment | open: inherited, environmental |
| V2-GAP-004 | Low | source worktree hygiene | open: owner action |

## V2-GAP-001 — The present-DSN branch of the test DSN policy is unverified on a live database

- **What.** When `AFLDB_TEST_DATABASE_URL` names a `_test` database, `applyTestDsnPolicy`
  (`packages/testing/src/dsn-policy.ts`) now also removes every other `*DATABASE_URL*` variable
  that does not name a `_test` database (for example an operator `.env`'s
  `AFLDB_IMPORT_DATABASE_URL=…/afldb_dev` or `AFLDB_AUTH_DATABASE_URL`). Inside a test process
  `src/db/client.ts` and `src/db/authClient.ts` refuse non-`_test` databases.
- **Why open.** Proved only on env objects and on this workstation, which has no database
  (`tests/dsn-policy.test.ts`). On the Linux dev host, an integration suite that relied on a
  non-`_test` import or auth DSN from `.env` (instead of setting it from the test DSN, as the
  integration files under `tests/integration/` do) would now fail closed with a "not set" error
  instead of reaching that database. That is the intended direction, but it has not been observed.
- **Close.** Run the integration suite against an isolated `afldb_test` (outside V2's authority)
  and record the result; any failure caused by the strip is a suite that was reaching a non-test
  database and should set its DSN from `AFLDB_TEST_DATABASE_URL`.

## V2-GAP-002 — The production frontend build is unexecuted in V2

- **What.** `npm run build` (`next build --webpack`) was not run.
- **Why.** It needs a database: ten routes export `generateStaticParams` that query PostgreSQL
  (for example `src/app/seasons/[year]/page.tsx:54`, `src/app/venues/[slug]/page.tsx:35`), and
  `src/db/client.ts` builds its pool at import and throws without `DATABASE_URL`. No database is
  available to V2, and pointing a build at any real database is forbidden (plan §1).
- **What was run instead.** `next typegen` and `tsc --noEmit --incremental false` (both exit 0 at
  the Stage 1 close; see `docs/v2/progress.md`).
- **Close.** A build against an isolated, disposable database with `NEXT_TELEMETRY_DISABLED=1`.

## V2-GAP-003 — Integration, Linux and POSIX behaviour is not exercised on the V2 workstation

- **What.** 85 integration suites refuse to load without a `_test` database; 15 unit cases fail
  for Windows-checkout or POSIX-execution reasons or because git-ignored evidence is absent from a
  fresh clone (exact list: `docs/v2/evidence/baseline-failures.txt`).
- **Why.** Environmental, inherited unchanged from the source (`docs/v2/baseline.md`).
- **Close.** A run on Linux against an isolated `afldb_test`. The V2 gate meanwhile is: no failure
  outside the baseline list, and no listed test weakened.

## V2-GAP-004 — A stray empty file `supplies` exists at the source worktree root

- **What.** `D:\dev\afldb-afl-api-cutover\supplies` (0 bytes, created 2026-10-19 09:18:47 +11:00)
  appears as `?? supplies` in the source's `git status`, which therefore no longer equals the
  launch snapshot `D:\tmp\afldbV2-source-snapshot-20261019\status.txt`.
- **Why.** Consistent with the documented workstation `Read`/`Grep` hook defect (it runs `cmd.exe`
  in the session cwd, which is the source worktree, and a redirect-like token in a payload creates
  an empty file). It appeared during the Launch A plan review. V2 work never writes to the source.
- **Close.** Owner removes the file (V2 agents are forbidden to modify the source) and, ideally,
  fixes or disables the hook.
