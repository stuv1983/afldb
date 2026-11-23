# Fix-branch qualification of Astra's candidate `91c04159`, 23 November 2026

Branch `codex/astra-fix-20261123`, created from `91c04159a5c68bacbd5749725ed089568d9da5bc` in its own worktree. Astra's worktree
`codex/astra-followup-20261123` still holds the exact original tip. Nothing here was pushed, installed, deployed or rebooted. The
primary checkout and its uncommitted changes were not touched. Linux evidence was produced on streamanator in fresh, disposable
`git archive` exports and a private PostgreSQL 16 cluster on `127.0.0.1` (port 52611), all under `/tmp/afldb-fixq-20261123`.

## 1. The ISSUE-333 typecheck failure

**Not reproducible from Git content; no repository defect.** The reported failure is
`tests/issue333-coach-row-selector.test.ts(14,8): error TS2307: Cannot find module
'../docs/v2/evidence/issue333-o2-20261104/scripts/coach-row-selector.mjs'`, from `npm run typecheck` (`next typegen && tsc --noEmit`).

| Question | Finding |
|---|---|
| Is the module missing from Git? | No. The test imports `.mjs`; the file is `coach-row-selector.mts`. TypeScript's bundler resolution maps `.mjs` to `.mts`. This was done deliberately in `9a8b17cf` to clear TS5097 from importing `.mts` directly. No `.mjs` exists, and none is wanted. |
| Provenance | Hand-written evidence script added in `2131428a` (2026-11-04), unchanged since; raw blob SHA-256 `af4dc158818a47f66352236d61bd0c25a84b850469369f4af3ec9a3b4064c440` equals the pin in `docs/v2/evidence/issue333-o2-20261104/SHA256SUMS-postapply`. It is not generated, so there is no setup step to miss. No credentials or production data. |
| Ignored or excluded on export? | `git check-ignore` is empty; no `export-ignore`; `git archive 91c04159 <path>` includes it. `tsconfig.json` excludes `docs/v2/evidence` from `include`, but a direct import still resolves it. |
| Fresh Windows worktree, `npm ci`, `npm run typecheck` | exit 0 |
| Fresh Linux `git archive` export, Node 22.23.2, `npm ci`, `npm run typecheck` | exit 0 |
| Reproduction of Astra's diagnostic | Deleting only the `.mts` from the Windows worktree gives exactly the quoted TS2307 at (14,8); restoring it clears it. Astra's re-review workspaces on streamanator did contain the file, so the failing typecheck workspace (not retained) lacked a tracked file. How it was built is not in the evidence. |
| Consuming test | `npx vitest run tests/issue333-coach-row-selector.test.ts` 12/12 on Windows and on Linux. It asserts concrete values (Josh Carr, 2026, 23 games, 7 W, 0 D, 16 L, 30.4%), column-name mapping, decoy rows, ambiguity refusals, and the markup the real `ClubCoachRecords` component renders. |

No stub, suppression, exclusion or generated copy was added. ISSUE-333 was resolved on 2026-11-04 for data and visibility; this finding
concerns test-workspace completeness, so its status is unchanged (an annotation was added to its ledger entry).
**What Astra should check** if the error recurs: `git cat-file -e <sha>:docs/v2/evidence/issue333-o2-20261104/scripts/coach-row-selector.mts`
and `ls` the same path in the workspace the typecheck ran in.

## 2. The one confirmed local defect

`tests/python/aflw_staging_race.py` (added in `2bec8060`) asserted `params["host"].startswith("/tmp/afldb-astra-")`, so only a cluster
whose socket directory carried that name could run it. The guard now requires an absolute Unix-socket directory and a `*_test`
database; TCP and non-test targets still abort (both exercised), and the invocation is documented in the file's docstring. No loader
code changed, and nothing else in the diff against `91c04159` touches behaviour.

## 3. Qualification (fresh exports, not the primary checkout)

Windows worktree `D:\dev\afldb-astra-fix-20261123` (fresh `npm ci`, Node 26.13.1) and a Linux export on streamanator
(`git archive 91c04159 | tar -x` into a new directory, `npm ci`, Node 22.23.2). Neither used a pre-existing `node_modules` or any ignored
local file. The Linux export was taken before the one-file test repair and the tracking edits, which touch no application code; the
exact-commit confirmation is in section 8.

| Step | Command | Result |
|---|---|---|
| Typecheck, Windows | `npm run typecheck` | exit 0 |
| Typecheck, Linux | `npm run typecheck` | exit 0 |
| Lint ratchet, Linux | `npm run lint:gate` | exit 0: 338 errors in 43 files, equal to the baseline (existing debt, not clean lint) |
| Production build, Linux | `npm run build` (webpack, then `prepare-standalone`) against the private schema-only DB (`DATABASE_URL` and synthetic secrets in a private env file) | exit 0 on the third attempt: compile, TypeScript, page data, 34 static pages, standalone bundle ready |
| Production build, Windows | `npm run build` | not usable: attempt 1 `next/font` error, attempt 2 stopped at `DATABASE_URL is not set` (no database on the workstation). Not a code result. |
| ISSUE-333 consuming test | `vitest run tests/issue333-coach-row-selector.test.ts` | 12/12 on both platforms |

**Build attempts.** Two Linux attempts and one Windows attempt failed in `next/font` (`Cannot read properties of null (reading '1')` at
`@next/font/dist/google/loader.js:122`, the loader's `.exec(googleFontFileUrl)[1]` on a font URL without a known extension). Fetching the
same three Google Fonts stylesheets with the loader's own URL builder, user agent and parser returned well-formed `.woff2` URLs every time
from both hosts, and a later build on the same tree passed. This is an intermittent external-fetch fault (the application imports IBM Plex
Sans, IBM Plex Mono and Newsreader from `next/font/google`), not a change in the tree; a release build should expect to retry or be run
where the font fetch is stable. Nothing in the repository was changed for it.

## 4. Named behaviours preserved (Linux, from the exact export)

| Area | Evidence |
|---|---|
| AFLW concurrent-write protection (368) | PG16 socket cluster, two real connections, the real loader under `afldb_import`: reviewed `c154f36b` loader **REPRODUCED** erasing the committed 2027 season and its public rows (exit 0); candidate loader exit 1 (`omits existing staging seasons: 2027`), identical row snapshots across the eight staging tables and six public views, and the complete twelve-season replacement exit 0. Staging contract 54/54. |
| Exact sidecar basename, later manual restore rejected (351/352) | `t-352-preverify-selector.sh` 42/42; `t-352-revalidate-accept.sh` 27/27; `t-352-scheduled-origin.sh` 139/139 (real wrapper, observers and both installers, including exit 4/5 rollback reporting); `t-sunday-review.sh` 31/31; `t-offhost-stamp.sh` PASS. |
| Worker identities 1 and 2 (351/362) | `tests/settle-season-revalidation.test.ts` and the release suite inside the broad run below passed in full, including the missing-worker-identity regression; ordinals 3/4, duplicates and a missing worker are covered by the 27/27 revalidate-accept harness. |
| Trace redaction (362) | `tests/deploy-release.test.ts` passed in the broad run (route class kept, numeric path sentinel absent). |
| DraftGuru reviewed pins (348) | `draftguru_reviewed_pin_contract.py` and `draftguru_bridge_operator_review_contract.py` pass. The September direct import stays on hold: no independent digest for `annual-html-20260902` exists in the repository or the checked stores. |

Not re-executed here, because the code and inputs are byte-identical to what Astra already ran (`git diff 91c04159` is the one test file
plus records): the real-supervisor trace run, the printed F-4b run against loopback workers and the public-smoke commands. Astra's results
for them stand.

## 5. Runbook commands and pins

The two bash blocks of section 0 of `ATTENDED-PLAN-R6-20261125.md` were extracted from the document and executed verbatim: the
`git archive` command at `b48a2c5e` exited 0 and `sha256sum -c` printed **14/14 OK**. The same 14 blobs read from the candidate `HEAD`
are byte-identical to `b48a2c5e`, so the printed pins resolve to the documented Git blobs on this branch as well. The later table headed
"previous sitting" is labelled historical and is not used for Wednesday.

## 6. Broad Vitest (kept distinct from every earlier comparison)

See [AFLDB-ASTRA-FIX-2026-11-23-FAILURES.txt](AFLDB-ASTRA-FIX-2026-11-23-FAILURES.txt) for every name. Schema-only database, default
system Python: 535 failed assertions in 319 files, 14,378 passed, 1,131 skipped, plus 32 failing files with no failed assertion body.

* **Against Astra's 490** (a different run, so not a base-versus-tip result): 455 names are common, 35 are Astra-only, 80 are
  candidate-only. All 80 are Python subprocesses failing on `from common import` for want of psycopg; with the project venv first on PATH
  those six files pass 183/183. So nothing in this run is attributable to the candidate.
* **Against the original 476/476:** still not comparable. Its names were never kept, so no claim is made either way.
* No base tree was run in this session, so no new base-versus-tip equality is claimed.
* The raw JSON (6.7 MB) is retained outside the repository at `D:\tmp\astra-fix-evidence\vitest-full.json`.

## 7. Status reconciliation

| Item | Result |
|---|---|
| ISSUE-333 | RESOLVED, unchanged; not reopened. Annotation added to its ledger entry. |
| ISSUE-368 | Stays open for Astra; ledger, individual record, index row and changelog note the repaired race test and the repeated proof. |
| ISSUE-348 | September direct import remains on hold; August pin unchanged. |
| ISSUE-352 | No change. Helpers installed 11:20:29 AEDT; Monday's off-host copy and attended restore passed; scheduled origin unproven. Tuesday 24 Nov 03:10 AEDT is the next scheduled observation. |
| Wednesday 25 Nov reboot | Still NO-GO until Wednesday's own overnight backup, attributable off-host copy, separate verification-service restore and attended recovery checks. |

## 8. Hand-back

EXACT_PLACEHOLDER
