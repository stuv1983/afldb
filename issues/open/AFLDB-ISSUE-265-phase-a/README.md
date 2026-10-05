# AFLDB-ISSUE-265 Phase A tooling (archived, unchanged)

Archived by D-265-15 (2026-10-05) so that the evidence in `issues/open/AFLDB-ISSUE-265.md` §17 keeps the
tooling that produced it. These files are byte-for-byte copies. Do not edit them: the Phase B runner and probe
are separate files outside the repository (`D:\tmp\issue265\Invoke-Issue265PhaseB.ps1`,
`issue265-db-probe-b.mjs`) and do not replace these. Phase A is retired (runbook §17.15), and after the gate
was implemented the Phase A harness no longer exists in the working tree: it is committed at 62f2cd67. To run
Phase A again, check out that commit on its own, with these files.

## Files

Originals are in `D:\tmp\issue265\` (outside Git, left in place). The folder layout matters: the runner
finds the probe and `tools\` through `$PSScriptRoot`, and the skip check finds the preload the same way.

| Archived path | Original path | Bytes | SHA-256 |
|---|---|---:|---|
| `Invoke-Issue265PhaseA.ps1` | `D:\tmp\issue265\Invoke-Issue265PhaseA.ps1` | 23796 | `1150b44e41a905c90d160388b6f084a08fa6a0e986018cb16eb62ef293eb6fbc` |
| `issue265-db-probe.mjs` | `D:\tmp\issue265\issue265-db-probe.mjs` | 46025 | `00d19597deb8c0573dd694c9d0726aa1afdc80342c3dba347eeeee92064b12c6` |
| `tools/import-graph.mjs` | `D:\tmp\issue265\tools\import-graph.mjs` | 4542 | `8976b98307a8cb7aa280ecc32370006dd723d2a6b73ee33bfa4b5c271462668d` |
| `tools/block-network.cjs` | `D:\tmp\issue265\tools\block-network.cjs` | 1710 | `89a50859c4d5aeed36a8e87167487278dc8be3bebb6fe4667a51469747faa5cd` |
| `tools/Invoke-Issue265SkipCheck.ps1` | `D:\tmp\issue265\tools\Invoke-Issue265SkipCheck.ps1` | 5175 | `e7bc6c72f27193d5bec5b465e81d95ec52a1dfea9d9cbf54c65e24a62eb843fb` |

Each copy was verified against its original by SHA-256 and a byte comparison. The files use LF line
endings and no BOM.

**Checkout integrity (verified 2026-10-05, after the S0 commit 62f2cd67).** The five committed blobs, the
working-tree files and the `D:\tmp\issue265\` originals are byte-identical (SHA-256 and `cmp`). Git had
warned of LF-to-CRLF conversion while staging, because the installed Git sets `core.autocrlf=true`. A
simulated `autocrlf=true` checkout of the five files then produced CRLF copies whose hashes all differed from
the table above. `.gitattributes` therefore carries one `-text` entry for each of the five files (not this
README), under the pattern `issues/*/AFLDB-ISSUE-265-phase-a/…` so it survives the move to `issues/closed/`.
The same simulated checkout with the entries is byte-identical to the originals.

Limits of that protection, stated plainly:
- It protects checkouts that include the `.gitattributes` entries. A checkout of 62f2cd67 itself, or any older
  revision, still converts line endings under `core.autocrlf=true`; the blob is right, the working copy is not.
- It does not prove what a window executed (see the provenance section below). The hashes identify these
  files, nothing more.

## Lint exception

`tools/block-network.cjs` is a byte-preserved historical CommonJS preload, retained with the Phase A
reproduction tooling. It uses `require`, which the repository's ESLint config forbids
(`@typescript-eslint/no-require-imports`). `eslint.config.mjs` therefore ignores that one file, and nothing
else in this folder. To lint the rest, pass the **folder**; naming the ignored file makes ESLint warn "File
ignored", which fails `--max-warnings 0`:

```
node node_modules\eslint\bin\eslint.js --max-warnings 0 issues/open/AFLDB-ISSUE-265-phase-a tests/integration/settle-promotion-deadlock.test.ts
```

If this folder moves to `issues/closed/`, move the ignore path with it.

## What they are

- `Invoke-Issue265PhaseA.ps1`: the runner. Phases `SelfTest`, `Preflight`, `Full`, `Census`. It launches
  only `tests/integration/settle-promotion-deadlock.test.ts`, applies and restores no migration, and
  expects 3 tests passed and 3 retained `admin-upload` batches.
- `issue265-db-probe.mjs`: the read-only probe (modes `selftest`, `derive`, `targets`, `preflight`,
  `isolation`, `snapshot`).
- `tools/Invoke-Issue265SkipCheck.ps1` and `tools/block-network.cjs`: the database-free proof that the
  harness skips, and opens no connection, when it is not armed.
- `tools/import-graph.mjs`: a static import scan. It executes nothing.

## Dependencies

- Windows PowerShell 5.1 (`powershell.exe`), `cmd.exe`, and `node` on `PATH`.
- A worktree with `node_modules` (`vitest`, `postgres`, `typescript`) and **no** `.env` in its root.
  The probe loads `postgres` from `<worktree>\node_modules`.
- The Phase A harness `tests/integration/settle-promotion-deadlock.test.ts` **as committed at S0**. The
  runner refuses a suite that lacks `AFLDB_ISSUE265_ARMED_AT` and `const TARGET_DB = 'afldb_test'`, and
  expects 3 tests. Once S7 replaces the Phase A `describe`, re-running Phase A needs the S0 commit.
- Machine-specific defaults, all overridable by parameter: `-WorktreeRoot D:\dev\afldb-issue-265`,
  `-EvidenceRoot D:\tmp\issue265`, and `-EnvFile D:\dev\afldb\.env`.
- `Preflight`, `Full` and `Census` also need `-TunnelHost`, `-TunnelPort`, and an operator-held
  `.env` that the runner reads at run time. That file is never copied, printed or committed.

## Invocation

From the worktree root. `SelfTest` makes no database contact:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File issues\open\AFLDB-ISSUE-265-phase-a\Invoke-Issue265PhaseA.ps1 -Phase SelfTest -EvidenceRoot <scratch directory>
```

The other phases contact `afldb_test` through the tunnel and are operator-run (CLAUDE.md §9). They stop at
the first refusal. Phase A must not run again once the gate lands (runbook §17.15).

## Passing evidence (not in Git)

`D:\tmp\issue265\run-20261005-162235-Full\`: window 2, `-Phase Full`, `OVERALL: PASS (Full)`, 1 file and
3 tests passed, none skipped, census clean. It stays outside the repository and unchanged. Window 1
(`run-20261005-152357-Full\`) is historical evidence of a failed run. No connection setting, credential or
database evidence is stored in this folder.

## Harness provenance: no hash was captured in window 2

Window 2 recorded **no hash of the harness**, and the evidence files hold none. At checkpoint preparation
(2026-10-05) the harness measured:

- SHA-256 `5842a29c5ca32108ccc3fd51a078382ed2939c893af8248c1f5a1526efa2e7c8`, 120805 bytes;
- last write 2026-10-05 16:18:17 (+11:00), before the window 2 launch at 16:22:35.

These are **not independent proof** of the bytes window 2 tested. Neither a current hash nor a filesystem
timestamp can show that the file did not change between the run and now. They detect any change *after* this
checkpoint, and they corroborate the window 2 record (runbook §17.13–§17.14). Likewise the hashes above
identify the archived tooling, not what each window executed.
