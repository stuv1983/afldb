# D-V2-RESIDUALS-1 — known residuals recorded at artifact lock (2026-10-29)

**Production: NO-GO.** This record carries out release choice 1 of
[the release choices](owner-decision-release-choices-2026-10-29.md) §2. It records three residuals as
**KNOWN AND OPEN** for the release artifact. It waives nothing, skips nothing, restates no result, edits no
test and grants no release authority. A residual is not a pass.

## 1. Approval

Given by the owner in the Claude Code session of 2026-10-29:

```text
D-V2-RESIDUALS-1 — APPROVED as prepared in docs/v2/owner-decision-release-choices-2026-10-29.md §2, choice 1.
```

The same message authorised local inspection, command execution with installed tools, directly related
documentation changes, selective staging and local commits. It excluded push, merge, build, deployment,
host or database access, production mutation, writer retirement, activation or deactivation, deletion and
any Brownlow operation. Privileges stay 42/43 and unwaived. EXEC, frozen P/H and the parked source
ISSUE-327 are unchanged.

## 2. Lint measured at the candidate

| Item | Value |
|---|---|
| Commit | `461f43726c828f0240a4fc12d9bb79b5f40e2a25` on `v2/rebuild`. Tracked files equal the commit; only the pre-existing untracked `.codex/` is present (3 files linted, 0 findings) |
| Command | `node node_modules/eslint/bin/eslint.js . --format json`, which is the `lint` script (`eslint .`) with JSON output. ESLint 9.39.5 as installed, `eslint.config.mjs` unchanged, no `--fix` |
| Result | exit 1: **508 errors / 136 warnings / 0 fatal**, in 156 of 1,221 linted files |
| Evidence | [`evidence/release-residuals-lint-2026-10-29.json`](evidence/release-residuals-lint-2026-10-29.json): every finding by file, line, rule and message, without the embedded source text |

This measurement supersedes the stale 2026-10-20 count of 234 errors / 131 warnings
([`local-repository-lint-complete.json`](evidence/local-repository-lint-complete.json)). It is not a clean
lint result.

### 2.1 Existing debt compared with the findings that arrived later

Findings are matched per file against the 2026-10-20 baseline by rule, severity and message, ignoring line
numbers. Every baseline finding is still present. **274 errors and 5 warnings are new since then**, and
all of them sit outside the shipped runtime:

| Area | All findings | New since 2026-10-20 | Where the new findings come from |
|---|---|---|---|
| Runtime: `src/`, `packages/` | 17 E / 73 W | **0** | none |
| `tests/` | 245 E / 38 W | 41 E / 2 W | `tests/db-test-rebuild.test.ts` (39 E, 2 W) and `tests/reference-data.test.ts` (2 E). Both were last changed by `955d0e85`, the ISSUE-316 State C restatements, whose blobs are byte-pinned to `C_sha256_lf` |
| `tools/` | 8 E / 16 W | 7 E | `tools/db/rebuild-test.ts` (6 E; byte-pinned blob `11308f06…`, `1a6de4b6`) and `tools/v2/rehearsal-package.d.mts` (1 E) |
| `issues/` retained evidence scripts | 226 E / 3 W | 226 E / 3 W | 56 ISSUE-316 evidence `.cjs` scripts added on 2026-10-25; almost all are `no-require-imports` in CommonJS files |
| `.phaneslight/` | 12 E / 6 W | 0 | inherited |

By rule: `no-explicit-any` 252 E, `no-require-imports` 240 E, `no-unused-vars` 123 W,
`react-hooks/set-state-in-effect` 11 E, 6 unused `eslint-disable` directives (W), and 11 others.

### 2.2 Findings that touch the release changes

The release changes are the files changed between the `main` merge-base `ff100dc2` (the deployed
production checkout) and the candidate.

- **Shipped runtime code changed by the release: 0 errors and 11 warnings in 8 files.** All 11 are
  `no-unused-vars` or unused-directive warnings that the 2026-10-20 baseline already held. None is new.
  The 8 files include `src/db/queries/brownlow.ts`, `players.ts`, `club-comparison.ts`, `src/db/client.ts`,
  `authClient.ts`, `src/lib/acquisition/afl-api-bundle.ts`, `src/search/nl/parser.ts` and
  `src/app/awards/[slug]/page.tsx`.
- **Release-changed non-runtime files: 427 errors and 30 warnings.** These are tests, tools and retained
  issue evidence. They hold all 279 new findings. The test and `tools/db` files are byte-pinned State C
  integration blobs, and the `issues/` scripts are retained evidence of reviewed or executed operations.
  Cleaning them would alter pinned or retained bytes and is outside this decision, so they are recorded
  and not cleaned.
- The runtime debt in files the release does not change (17 E / 62 W) is inherited from `main`.

No check was weakened. No rule, ignore entry, disable comment or file changed.

## 3. Residuals recorded as KNOWN AND OPEN

| Residual | State at the candidate | Tracking |
|---|---|---|
| **Three strict Gridley failures** | V2-GAP-029: **149 strict / 99 approved / 50 unapproved** (42 event, 8 board-date membership). Linux 2026-10-28 reproduced the set key for key: 14,888 passed / 3 failed / 63 skipped ([record](linux-verification-2026-10-28.md)) | [V2-GAP-029](known-gaps.md) stays **OPEN** as data-quality debt; source requests unchanged |
| **Lint debt** | **508 errors / 136 warnings / 0 fatal**, as measured in §2 | RISK-12; [go/no-go](go-no-go.md) row 13 stays NOT GREEN |
| **`external-grids-import` NOT RUN** | The case `validates all 1,123 archived boards` (`tests/external-grids-import.test.ts:599`) needs the original rescued 2026-08-12 archive, which is unavailable. The only available `afl.db` is a later snapshot and is not a pass ([Linux record §10.6](linux-verification-2026-10-28.md); [package §3.3](release-decision-package-2026-10-28.md)) | Stays NOT RUN until the archive is supplied. Optional X-GRIDS-1 (choice 1a) is separate and is not a release blocker |

What this does **not** do: it does not make the workflow green; it does not close or narrow V2-GAP-029; it
does not change the original 1,123-board case; and it is not owner visual acceptance (choice 2), an
artifact lock (choice 3) or any production approval. Release gate 2 is **recorded**. Production stays
**NO-GO**.
