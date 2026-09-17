# AFLDB ISSUE-111 IMPLEMENTATION HANDOFF

**Self-contained.** Assume the reading session has **no access** to any prior conversation.
Written 2026-08-30 at the end of the ISSUE-111 architecture pass.

---

# LANDING STATE — AFLDB-ISSUE-111 IS RESOLVED (2026-08-30)

**Pass 21 (2026-08-30). The operator ran §5 Step 4 and the destructive canonical rebuild of
`afldb_test` SUCCEEDED: `Rebuild complete.`, rebuild exit code 0.** The environment was proven
before anything was destroyed (`AFLDB_PYTHON` = `D:\dev\afldb-issue-102\.venv\Scripts\python.exe`,
`psql` at `C:\Program Files\PostgreSQL\16\bin\psql.exe`, `AFLDB_TEST_DATABASE_URL` →
`afldb_test` / `afldb_owner` / `127.0.0.1`, `AFLDB_TEST_IMPORT_DATABASE_URL` → `afldb_test` /
`afldb_import` / `127.0.0.1`); no production and no `afldb_dev` target was used. PRECHECK PASSED,
78 migrations applied including 078, privileges reconciled, and the canonical stages loaded.
**The `coleman` stage reported `46 winners (46 seasons, 0 updated, 46 inserted, 0 deleted)`** — the
fresh-load INSERT signal §2s predicted, proving the create-if-missing branch rather than the
transition-update path. The ladder witness including the D7 database cross-check PASSED, and FINAL
VALIDATION returned **`AFLDB-FINAL-VALIDATION PASSED: 26 checks`** with all seven Coleman gates
green: `coleman_rows 46`, `coleman_seasons 46`, `coleman_first_season 1980`,
`coleman_unlinked_rows 0`, `coleman_rows_not_derived_from_afltables 0`,
`coleman_rows_keyed_on_a_numeric_id 0`, `coleman_after_accepted_last_season 0`. Full evidence:
`issues/open/AFLDB-ISSUE-111.md` §33.

**G7 was the last unproven gate. All ten §9 gates — G0, G1, G2, G3, G4, G5, G5a, G6, G7, G8, G9 —
are now proven, and `AFLDB-ISSUE-111` is RESOLVED, dated 2026-08-30.**

Durable records updated in the closeout pass:

| File | Change |
|---|---|
| `issues.md` | ISSUE-111 → Status **Resolved**, Resolved **2026-08-30**, "Files (actual)", a gate-by-gate **Validation** table and a **Resolution** section; the row removed from the Open Issues table and the count corrected **5 → 4** |
| `IssuesIndex.md` | ISSUE-111 row removed, count corrected **5 → 4**, and the parent ISSUE-102 row's two now-stale ISSUE-111 statements resynchronised (the `coleman` stage is no longer "unvalidated"; the ISSUE-111 G0 authorisation is no longer a pending operator decision) |
| `CHANGELOG.md` | `Unreleased` → *AFLDB-ISSUE-111 — Coleman Medal derived from canonical AFLDB facts (Resolved) - 30 August 2026* |
| `issues/open/AFLDB-ISSUE-111.md` | §9 gates table updated to PASS with evidence; new §33 pass-21 record; §23 Status set to **RESOLVED** |
| `issues/open/AFLDB-ISSUE-111-HANDOFF.md` | this landing state, §5 **Step 5**, §7 items 17/19/20 closed, §9 issue state, and the landing prompt |

**Deliberately NOT done:** `issues/open/AFLDB-ISSUE-111.md` and this handoff were **not** moved to
`issues/closed/`, although that is the convention for a resolved runbook. The parent
`AFLDB-ISSUE-102` is still open and cites `issues/open/AFLDB-ISSUE-111.md` in eight places across
`issues/open/AFLDB-ISSUE-102.md`, `issues/open/AFLDB-ISSUE-102-HANDOFF.md`, `issues.md` and
`IssuesIndex.md`. Moving the two files means editing parent records the closeout session was fenced
off from, so it is left as a one-line act for the ISSUE-102 closeout. It is a filing decision only —
nothing about the resolution depends on it.

## STEP 5 IS DONE — PASSED ON BOTH LEGS (2026-08-30, pass 22)

**Nothing is owed on `AFLDB-ISSUE-111`.** The operator ran §5 Step 5, the non-destructive
pre-commit confirmation, and it passed:

| Leg | Command | Result |
|---|---|---|
| Environment proof | — | `AFLDB_PYTHON` = `D:\dev\afldb-issue-102\.venv\Scripts\python.exe`; `psycopg` importable; `AFLDB_TEST_DATABASE_URL` → `afldb_test` / `afldb_owner` / `127.0.0.1`; `AFLDB_TEST_IMPORT_DATABASE_URL` → `afldb_test` / `afldb_import` / `127.0.0.1` |
| 1 | `npm test -- tests/integration/awards-reload-links.test.ts -t "AFLDB-ISSUE-111"` | `Test Files  1 passed (1)`, `Tests  29 passed \| 24 skipped (53)`, **exit 0** |
| 2 | `npx tsc --noEmit` | no output, **exit 0** |

All five ISSUE-111 integration groups passed — canonical match-fact derivation 9, synthetic
derivation rules 6, durable-identity refusals 4, legacy → derived transition 6, human-link
preservation 4. **29 + 24 = 53, exactly the number of `it()` cases in the file**, so every case is
accounted for; the 24 skipped are the non-ISSUE-111 cases the `-t` filter excludes plus the two
describes gated on the deliberately-unset `AFLDB_LEGACY_SQLITE`. Leg 2 clears the typecheck owed
since passes 4–7 (§7b). Full record: `issues/open/AFLDB-ISSUE-111.md` §34.

**`AFLDB-ISSUE-111` remains RESOLVED, dated 2026-08-30.** The canonical rebuild must NOT be
repeated, no gate may be relaxed, and no new implementation work is authorised. The only thing left
is landing the branch, which is entirely the operator's.

---

# LANDING MANIFEST — the operator's staging contract (pass 22, 2026-08-30)

Claude ran **no Git command** to produce this. It is derived from direct source inspection of
`D:\dev\afldb-issue-102`, the per-pass "Files changed" records below, and the session-start
`git status` snapshot. **Verify it with `git status --short` before staging anything.**

## 1. Classification of every path

### A — `AFLDB-ISSUE-111` only. MUST LAND.

| Path | State | What it carries |
|---|---|---|
| `data/reference/coleman-derivation.json` | new | The single tracked declaration of the derivation's boundaries — span, method, excluded source, H&A rule, completed-season rule, tie rule, club rule, provenance, key format, identity rule, legacy transition. Loader, gates and tests all read it. |
| `tests/coleman-derivation.test.ts` | new | The 42-case DB-free contract suite over that JSON. |
| `tools/migration/import_awards.py` | modified | The derived `coleman` group, `LEGACY_FREE_GROUPS`, the fail-closed identity keying, and `--rekey-coleman`. |
| `tools/db/rebuild-test.ts` | modified | The `coleman` data stage (after `derived`, before the ladder witness) and its seven Stage-9 gates. |
| `docs/deployment.md` | modified | §7 — the `coleman` ordering rule and the one-time `--rekey-coleman` warning. |
| `tests/under-22-importer.test.ts` | modified | Follows the `under_22` → `LEGACY_FREE_GROUPS` generalisation. |
| `tests/integration/awards-reload-links.test.ts` | modified | The 29 ISSUE-111 integration cases (passes 2–7), the widened `ColemanContract` type and the shared fixture cleanup. |
| `issues/open/AFLDB-ISSUE-111.md` | new | The ISSUE-111 runbook and evidence record, §1–§34. |
| `issues/open/AFLDB-ISSUE-111-HANDOFF.md` | new | This file. |

### B — `AFLDB-ISSUE-114` only. MUST LAND WITH THIS BRANCH.

| Path | State | What it carries |
|---|---|---|
| `tools/rebuild/fitzroy/fitzroy-contract.json` | modified | The repaired `datasets.ladder.accepted_witness.manifest_sha256` (the canonical **LF** hash `604a8a16…8d3f` of the same tracked manifest) and its `$comment`. |

`AFLDB-ISSUE-114` is uncommitted and is a **hard prerequisite** of ISSUE-111's G7: with the stale
CRLF literal in place the ladder witness check failed closed on a correct manifest and the canonical
rebuild could not reach the Coleman stage. It cannot be deferred to a later branch.

### A + B — files that carry BOTH issues. MUST LAND. **Do not attempt to split.**

| Path | State | ISSUE-111 content | ISSUE-114 content |
|---|---|---|---|
| `tests/db-test-rebuild.test.ts` | modified | The `coleman` stage assertions (`:613-750`) and the Coleman gate describe (`:1061`– end) | The ladder-witness **value** binding assertion (`:646-690`) proving the contract literal equals the manifest's LF-normalised bytes and rejecting the CRLF rendering |
| `CHANGELOG.md` | modified | The `Unreleased` ISSUE-111 closeout entry | The `Unreleased` ISSUE-114 closeout entry, immediately below it in the same block |
| `issues.md` | modified | ISSUE-111 Status/Resolved/Files/Validation/Resolution; row removed from the Open Issues table | ISSUE-114 entry and Resolution; row removed from the same table — the two removals share one edited table and one corrected count |
| `IssuesIndex.md` | modified | ISSUE-111 row removed, count corrected, the parent ISSUE-102 row resynchronised | ISSUE-114 row removed from the same list and the same count |

`tests/db-test-rebuild.test.ts` **contains both**, in separate describes. It also carries a third,
smaller change from pass 14 — a **test-only** `AFLDB_PYTHON` save/`delete`/restore around the
"interpreter does not exist" case, which fixed ambient-environment contamination without touching
rebuild code or any assertion. That change belongs with neither issue and is too small to separate.

### D — branch-owned records that are neither 111 nor 114. MUST LAND.

| Path | State | Why it must land |
|---|---|---|
| `issues/open/AFLDB-ISSUE-102.md` | new | Parent architecture/coordination runbook. `IssuesIndex.md:163` and `issues.md` cite it by path. |
| `issues/open/AFLDB-ISSUE-102-HANDOFF.md` | new | ISSUE-102 continuation state. Cited by `IssuesIndex.md:17`. |
| `issues/open/AFLDB-ISSUE-112.md` | new | Child runbook (curated honours manifests). Cited by `IssuesIndex.md:164`. |
| `issues/open/AFLDB-ISSUE-113.md` | new | Child runbook (Brownlow season totals). Cited by `IssuesIndex.md:165`. |

These four were created on this branch in the ISSUE-102 architecture pass. `IssuesIndex.md` and
`issues.md` are in the staged set and reference all four by path, so **omitting them commits
dangling references** to files that exist only in an untracked worktree. They land.

### C — MUST NOT LAND

| Path | Why |
|---|---|
| `!report.executed.includes(id))` | Zero-byte shell-redirect debris, 2026-08-30 |
| `(draft_type` | Zero-byte shell-redirect debris |
| `(player_id` | Zero-byte shell-redirect debris |
| `0)` | Zero-byte shell-redirect debris |
| `Do` | Zero-byte shell-redirect debris |
| `` `${r.id} `` | Zero-byte shell-redirect debris |
| `` `AFLDB_TEST_IMPORT_DATABASE_URL` `` | Zero-byte shell-redirect debris |
| `on` | Zero-byte shell-redirect debris |
| `p` | Zero-byte shell-redirect debris |
| `to)` | Zero-byte shell-redirect debris |
| `which` | Zero-byte shell-redirect debris |

**Eleven** such files, all confirmed 0 bytes. They are the residue of PowerShell parsing an
unquoted fragment as a redirect target. They are safe to delete, but **the operator decides** —
Claude deleted nothing.

Already **gitignored**, so they cannot appear in `git status` and need no action: `.venv/`
(`.gitignore:66`), `data/sources/**` (the raw fitzRoy / DraftGuru / ladder snapshot bytes —
`.gitignore:45`), `.env`, `node_modules/`, `tsconfig.tsbuildinfo`. Note `.gitignore:47-49` opts
`data/reference/*.json` back **in**, which is why `coleman-derivation.json` is stageable and
correct to stage.

## 2. Expected `git status --short`

Tracked changes first, then untracked, each group in path order:

```
 M CHANGELOG.md
 M IssuesIndex.md
 M docs/deployment.md
 M issues.md
 M tests/db-test-rebuild.test.ts
 M tests/integration/awards-reload-links.test.ts
 M tests/under-22-importer.test.ts
 M tools/db/rebuild-test.ts
 M tools/migration/import_awards.py
 M tools/rebuild/fitzroy/fitzroy-contract.json
?? !report.executed.includes(id))
?? (draft_type
?? (player_id
?? 0)
?? Do
?? `${r.id}
?? `AFLDB_TEST_IMPORT_DATABASE_URL`
?? data/reference/coleman-derivation.json
?? issues/open/AFLDB-ISSUE-102-HANDOFF.md
?? issues/open/AFLDB-ISSUE-102.md
?? issues/open/AFLDB-ISSUE-111-HANDOFF.md
?? issues/open/AFLDB-ISSUE-111.md
?? issues/open/AFLDB-ISSUE-112.md
?? issues/open/AFLDB-ISSUE-113.md
?? on
?? p
?? tests/coleman-derivation.test.ts
?? to)
?? which
```

**10 modified + 19 untracked = 29 entries.** Anything else — an extra `??`, a `D`, a rename — is
unexplained: stop and re-adjudicate rather than staging.

## 3. Exactly what to stage — 18 explicit paths

**Never `git add -A`. Never `git add .`. Never `git add -u`.** Each of those stages the eleven junk
files or hides them behind a wildcard.

```
git add -- data/reference/coleman-derivation.json
git add -- tests/coleman-derivation.test.ts
git add -- tests/integration/awards-reload-links.test.ts
git add -- tests/db-test-rebuild.test.ts
git add -- tests/under-22-importer.test.ts
git add -- tools/migration/import_awards.py
git add -- tools/db/rebuild-test.ts
git add -- tools/rebuild/fitzroy/fitzroy-contract.json
git add -- docs/deployment.md
git add -- issues.md
git add -- IssuesIndex.md
git add -- CHANGELOG.md
git add -- issues/open/AFLDB-ISSUE-111.md
git add -- issues/open/AFLDB-ISSUE-111-HANDOFF.md
git add -- issues/open/AFLDB-ISSUE-102.md
git add -- issues/open/AFLDB-ISSUE-102-HANDOFF.md
git add -- issues/open/AFLDB-ISSUE-112.md
git add -- issues/open/AFLDB-ISSUE-113.md
```

Then confirm: `git status --short` must show **18 staged entries** (`A ` or `M ` in column 1) and
the **eleven `??` junk lines still unstaged**, and nothing else.

## 4. What must remain unstaged

The eleven zero-byte junk files, and nothing else — every other worktree path is either staged
above or already gitignored (`.venv/`, `data/sources/**`, `.env`, `node_modules/`,
`tsconfig.tsbuildinfo`).

## 5. One commit or two?

**ONE commit.** Two is not achievable without partial staging that would produce a broken
intermediate:

- Four files — `tests/db-test-rebuild.test.ts`, `CHANGELOG.md`, `issues.md`, `IssuesIndex.md` —
  carry both issues, and in `issues.md`/`IssuesIndex.md` the two changes share **one** edited Open
  Issues table and **one** corrected open-issue count. A `git add -p` split there cannot produce two
  self-consistent ledgers; one of the two commits would state a wrong count.
- The issues are **causally coupled, not merely co-located**: ISSUE-114 was discovered while running
  ISSUE-111's G7 and is a hard prerequisite of it. An ISSUE-111-only commit would not have passed
  its own canonical rebuild.
- All validation — the canonical rebuild, 29/29, 214/214, 42, 8, `tsc --noEmit` — was measured
  against the **combined** tree. Neither half has been validated alone.

## 6. Recommended commit message

```
Resolve ISSUE-111 Coleman derivation and ISSUE-114 ladder binding

AFLDB-ISSUE-111 - Coleman Medal winners are now derived from AFLDB's own
canonical home-and-away match facts instead of the legacy SQLite award
scrape. The new `coleman` group in tools/migration/import_awards.py sums
player_match_stats.goals over matches WHERE NOT is_final, grouped by
(season, player_id), and persists the per-season maximum to award_winners.
Boundaries live in the tracked data/reference/coleman-derivation.json, which
the loader, the rebuild gates and the tests all read. Winners are born linked
under `afltables` provenance and keyed on the AFL Tables profile path, never
players.id; the loader fails closed on a missing, ambiguous or
separator-bearing identity. Ties all win; a multi-club winner records
club_id IS NULL; an incomplete season produces no row. needs_legacy was
generalised from the single under_22 exemption to LEGACY_FREE_GROUPS, so a
Coleman load runs with AFLDB_LEGACY_SQLITE unset. Adds a `coleman` canonical
rebuild stage after `derived` with seven Stage-9 gates, and a one-time
--rekey-coleman transition that re-owns an existing legacy-loaded family in
place, preserving every award_winners.id.

AFLDB-ISSUE-114 - Re-pointed datasets.ladder.accepted_witness.manifest_sha256
in tools/rebuild/fitzroy/fitzroy-contract.json at the canonical LF hash of the
same tracked manifest. The previous value was the CRLF rendering of an
identical document, captured before ISSUE-108 added the eol=lf attribute, so
the ladder witness check failed closed on a correct manifest and blocked the
canonical rebuild. No new bytes were accepted and no gate was relaxed; a value
assertion now binds the literal to the manifest's LF bytes.

Validation, all operator-run: destructive canonical rebuild of afldb_test
exit 0, coleman stage 46 winners (46 seasons, 0 updated, 46 inserted,
0 deleted), AFLDB-FINAL-VALIDATION PASSED: 26 checks with all seven Coleman
gates green; 29 of 29 ISSUE-111 integration cases against the rebuilt
afldb_test; 214/214 db-test-rebuild, 42 coleman-derivation, 8
under-22-importer; npx tsc --noEmit clean.

DEPLOYMENT: import_awards.py --rekey-coleman must be run ONCE per existing
environment before the derived loader runs there. Skipping it does not fail
loudly - it silently duplicates the Coleman family. See docs/deployment.md
section 7.
```

Optional trailers, if the repository's convention wants them — the operator's call, since existing
history on this branch's baseline does not carry them:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

## 7. Landing sequence — **PLAN ONLY. Do not run any of it yet.**

Claude will not run, and has not run, any of these. Every line is the operator's.

**Phase 1 — verify, in `D:\dev\afldb-issue-102`.** `git status --short`, compared against §2
above. Stop on any discrepancy.

**Phase 2 — stage.** The 18 explicit `git add --` lines in §3.

**Phase 3 — re-verify.** `git status --short` (expect 18 staged, 11 `??`) and
`git diff --cached --stat` (expect 18 files; large line counts on `issues.md`, `IssuesIndex.md` and
`CHANGELOG.md` are correct — they are the ledgers).

**Phase 4 — commit.** The §6 message.

**Phase 5 — push the branch.** Confirm the remote name first (`git remote -v`; it was renamed to
`origin` on 2026-08-18), then `git push -u origin claude/issue-102`.

**Phase 6 — fast-forward `main` in `D:\dev\afldb`.** Inspect first, then merge:

```
git -C D:\dev\afldb status --short
git -C D:\dev\afldb branch --show-current
git -C D:\dev\afldb merge --ff-only claude/issue-102
```

`--ff-only` is the safety: if `main` has moved past `95819a3` it **refuses** rather than creating a
merge commit, and the operator adjudicates. Merging the branch ref while the worktree has it checked
out is read-only on that branch and is safe.

**Phase 7 — push `main`.** `git -C D:\dev\afldb push origin main`.

**Phase 8 — dev.** The normal dev deploy (a `git pull` on the dev host, not a tar copy).
**Before the derived Coleman loader runs on dev, run `import_awards.py --rekey-coleman` there
exactly once** — dev still holds the real `draftguru`-keyed Coleman rows, and skipping the rekey
does not fail loudly, it silently duplicates the family (`docs/deployment.md` §7). Then let the
operator test dev before anything is proposed for production. **No production action is
authorised.**

## 8. The two unrelated NL files in `D:\dev\afldb`

```
D:\dev\afldb\tools\nl\afldb_nl_mass_generator.py
D:\dev\afldb\artifacts\nl-mass-100k.cs
```

They are **not** part of this branch, appear nowhere in the 18 staged paths, and belong to unrelated
NL work (the neighbourhood of the unmerged `AFLDB-ISSUE-110`). Because no path in this commit
touches `tools/nl/` or `artifacts/`, the Phase 6 fast-forward cannot overwrite, stage or delete
them, whether they are untracked or tracked-and-modified; a fast-forward only updates paths the
commit changes. **Preserve them: do not `git clean`, do not `git checkout -- .`, do not `git stash`,
and do not `git reset --hard` in `D:\dev\afldb`.** Confirm they are still present after Phase 6
with `git -C D:\dev\afldb status --short`.

The shared stash stack is another hazard: `D:\dev\afldb` and this worktree share it, and other
sessions may push or pop entries. Do not use bare `git stash` / `git stash pop` at any phase.

## 9. Deliberately NOT part of this landing

- **Do not move** `issues/open/AFLDB-ISSUE-111.md` or this handoff into `issues/closed/`, although
  the issue is Resolved and that is the convention. The parent `AFLDB-ISSUE-102` is still open and
  cites `issues/open/AFLDB-ISSUE-111.md` in eight places across four files. It is a one-line filing
  act for the ISSUE-102 closeout, and nothing about the resolution depends on it.
- **Do not delete** the eleven junk files as part of staging. Deleting them is safe and unrelated;
  it is the operator's call and does not belong in this commit.
- **No production action** of any kind is authorised.

---

## Worktree
`D:\dev\afldb-issue-102`

Work only here. **Do not access or modify `D:\dev\afldb`.** This is a git worktree; the stash stack
is shared with other worktrees and sessions.

## Branch
`claude/issue-102`

## Baseline
`95819a3` — "Resolve ISSUE-109 data override privileges"

## Parent
`AFLDB-ISSUE-102` — parent architecture / dependency-inventory / child-coordination record
(`issues/open/AFLDB-ISSUE-102.md`). Siblings: `AFLDB-ISSUE-112` (curated honours manifests),
`AFLDB-ISSUE-113` (Brownlow season totals). **`AFLDB-ISSUE-110` is unrelated unmerged NL
semantic-mapping work — do not use, modify or invent that id.**

## Scope
Derive and persist Coleman Medal winners from canonical AFLDB **home-and-away** match/player-stat
facts, with no `AFLDB_LEGACY_SQLITE` dependency, preserving every existing reload, ownership and
player-link guarantee, and integrated into the canonical rebuild.

## Implementation status — READ THIS FIRST

**PASS 1 (2026-08-30). Handoff items 1–16 WRITTEN, and the DB-free suite WRITTEN and PASSED.**
**PASS 2 (2026-08-30). The derived-load integration block WRITTEN.**
**PASS 3 (2026-08-30). That block EXECUTED against `afldb_test`: 8 passed, 1 failed (G2,
statement timeout). The G2 oracle was rewritten.**
**PASS 4 (2026-08-30). The re-run PASSED 9 of 9, so the whole derived-load block is green.
Pass 4 then WROTE the derivation-rule fixture block (tie, multi-club, in-progress, finals
exclusion, span boundary).**
**PASS 5 (2026-08-30). That block was EXECUTED: 15 of 15 ISSUE-111 tests PASSED (9 + 6), with
fixture cleanup and restoration proven. Pass 5 then WROTE the G5a identity-refusal block, which
awaits ONE run.**
**PASS 6 (2026-08-30). That block was EXECUTED: 19 of 19 ISSUE-111 tests PASSED (9 + 6 + 4), so
G5a is PROVEN against a real database. Pass 6 then WROTE the legacy → derived transition suite
(handoff items 8–14, §2e), which awaits ONE run.**
**PASS 7 (2026-08-30). That block was EXECUTED: 25 of 25 ISSUE-111 tests PASSED (9 + 6 + 4 + 6),
so the legacy → derived TRANSITION is PROVEN against a real database. Pass 7 then WROTE the
decision-survival block (item 16's manual-link half, §2f), which awaits ONE run.**
**PASS 8 (2026-08-30). That block was EXECUTED: 29 of 29 ISSUE-111 tests PASSED
(9 + 6 + 4 + 6 + 4), so HUMAN LINK DECISIONS are PROVEN to survive the derived reload and
§7 item 16 is CLOSED. The whole ISSUE-111 integration suite is now complete and green.
Pass 8 wrote NO code: it verified the G7 rebuild inputs in source (§2g) and hands over the
canonical rebuild, item 17.**
**PASS 9 (2026-08-30). The canonical rebuild was ATTEMPTED and REFUSED in the fitzRoy
preflight, before any destructive action. `afldb_test` was NOT destroyed and the Coleman stage
was never reached. The cause is a MISSING ACQUIRED SNAPSHOT in this worktree, not an ISSUE-111
defect — see §2h. Pass 9 wrote no code and mutated no database.**
**PASS 10 (2026-08-30). The operator ran §5 Step 1. fitzRoy `full-history-20260827` (131 files,
probe hash MATCHING) and DraftGuru `annual-html-20260826` (90 files) are present in
`D:\dev\afldb`; the ladder witness `ladder-20260828` is present in NEITHER checkout. Pass 10
established the whole prerequisite recovery contract from source — see §2i. It ran no command,
copied/acquired/deleted no snapshot byte, and mutated no database.**
**PASS 11 (2026-08-30). The operator ran §5 Step 1b. **No `ladder_1897.csv` and no `ladder*`
directory exist anywhere under `D:\dev` or `D:\backups`**, and no other worktree holds an alternate
accepted ladder snapshot — §24.7 **outcome 3**. DraftGuru measured exactly 42/42/2/4 = 90 with no
strays, confirming §2i.1. Pass 11 designed the ladder reacquisition and adjudication procedure from
source — see §2j and runbook §25. It ran no command, performed no acquisition, copied/deleted no
snapshot byte, and mutated no database.**
**PASS 12 (2026-08-30). The operator ran §5 Step 1c and it FAILED ON BOTH LEGS: the R
package/version probe died with `Segmentation fault`, and the tracked ladder manifest hashed
`604a8a16…8d3f` against the expected `70cc1776…8b6df`. Pass 12 adjudicated both — see §2k and
runbook §26. THE MANIFEST IS INTACT AND THE CONTRACT LITERAL IS STALE (proven: `70cc…` is the CRLF
rendering of the identical LF document), which is an ISSUE-108 residue now tracked as
`AFLDB-ISSUE-114` and a HARD PREREQUISITE OF STEP 3. The segfault is narrowed to a probe ladder.
Pass 12 ran no acquisition, copied/deleted no snapshot byte, installed no R package, modified no
tracked manifest and mutated no database.**
**PASS 13 (2026-08-30). The operator ran §5 Step 1c-R and it PASSED: R 4.6.1 starts clean with and
without startup files, **fitzRoy is exactly 1.8.0**, `jsonlite` and `openssl` load, `digest` is
absent (allowed — the requirement is `digest` OR `openssl`), and the pass-12 segfault does not
reproduce under isolation. **The acquisition toolchain prerequisites are PROVEN.** Pass 13 then
repaired `AFLDB-ISSUE-114` — the stale CRLF ladder-manifest binding — in two files, so **G7 is now
blocked only on the ladder witness BYTES**. See §2l. Pass 13 performed NO acquisition, no network
call, no database access, no Git command, no package change, and copied/wrote no snapshot byte.**
**PASS 14 (2026-08-30). The operator ran `npm test -- tests/db-test-rebuild.test.ts`: 214 tests,
**213 passed, 1 failed**, and the `AFLDB-ISSUE-114` case — "binds the witness to the canonical LF
bytes of the tracked manifest" — **PASSED**, so that repair is PROVEN. The single failure was the
unrelated *Python interpreter resolution > "refuses with the selected path when that interpreter
does not exist"* case, and it is **ambient `AFLDB_PYTHON` contamination, not a production defect**:
`runPreflight` resolves Python from `process.env` by design and that case stubbed only the
**relative** default as missing. Repaired **in the test only** (save/`delete`/restore
`AFLDB_PYTHON`), with every assertion unchanged and no rebuild code touched. See §2m. Pass 14 ran
no acquisition, no network call, no database access and no Git command; **the ladder witness has
still NOT been acquired**.**
**PASS 15 (2026-08-30). The operator re-ran `npm test -- tests/db-test-rebuild.test.ts`:
**1 file passed, 214 tests, 214 PASSED, 0 failed**, 404 ms. Both cases that mattered are green —
the `AFLDB-ISSUE-114` case *"binds the witness to the canonical LF bytes of the tracked manifest"*,
and the *Python interpreter resolution* case, which passed **with `AFLDB_PYTHON` still exported in
the operator's shell**, exactly the condition its test-only repair had to survive. **`AFLDB-ISSUE-114`
is RESOLVED** (`issues.md` → Resolution 2026-08-30; removed from `IssuesIndex.md` and the Open Issues
table; `CHANGELOG.md` entry added), so §5 **Step 3's contract blocker is gone**. Pass 15 then prepared
§5 Step 1d — see §2n. It ran no acquisition, no network call, no database access, no Git command, and
copied or wrote no snapshot byte. **The ladder witness has still NOT been acquired.**
**PASS 16 (2026-08-30). The operator ran §5 Step 1d and it SUCCEEDED: the controlled network
reacquisition under the temporary label `ladder-recover-20260830` produced **129 ladder CSVs,
seasons 1897–2025, 1,622 rows**, `acquisition_kind: validation_witness (ladder)`,
`completeness: unvalidated`, and the temporary manifest
`docs/rebuild-manifests/afltables_fitzroy_core/ladder-recover-20260830.json` — exactly the §5 Step 1d
expected shape, on every count. No database was contacted, no Git command run, no production
accessed, and the accepted `ladder-20260828` manifest and contract were not changed. The operator
correctly did **not** run the generic `validate_ladder_witness.py --label ladder-recover-20260830`
line the tool prints, and copied, renamed, moved and deleted nothing. **THE RECOVERED BYTES REMAIN
UNTRUSTED.** Pass 16 designed the recovery ADJUDICATION — §2o and the rewritten §5 Step 1e — and
performed **no** adjudication itself: it hashed no file, moved/copied/renamed/deleted nothing,
mutated no database, ran no Git command, accessed no production, and altered no Coleman
implementation, accepted manifest or contract. See §2o.**

**PASS 17 (2026-08-30). The operator ran §5 Step 1e and it returned the ONLY permitted continuation:
`expected=129 present=129 matched=129 missing=0 mismatched=0 unexpected=0`, with the binding proof
holding first — the tracked manifest's `Get-FileHash` equals the contract's accepted
`manifest_sha256` `604a8a16…8d3f` for `snapshot_label ladder-20260828` — and the secondary
diagnostic agreeing (accepted rows 1622, candidate rows 1622). VERDICT: RECOVERED — the reacquired
witness is BYTE-FOR-BYTE IDENTICAL to the accepted `ladder-20260828` witness. It is not merely a
correct witness; it is the accepted witness reproduced, so NO successor-witness decision arises,
`AFLDB-ISSUE-101` is not engaged, and the accepted manifest, its `manifest_sha256`,
`accepted_witness` and `ladderWitnessLabel()` stay exactly as they are. The run was read-only: no
database, no Git, no production, nothing moved/copied/renamed/deleted, no accepted manifest or
contract changed. Pass 17 then prepared §5 Step 1f — the single promotion + canonical-validation
block — and performed no promotion itself: it hashed nothing, moved/copied/renamed/deleted nothing,
mutated no database, ran no Git command, accessed no production, and altered no Coleman
implementation, accepted manifest or contract. See §2p.**

**PASS 18 (2026-08-30). The operator ran §5 Step 1f and it SUCCEEDED. The preconditions passed
(accepted manifest SHA-256 `604a8a162543e19060f426bd189222d32d07726a0b134bdf4f910175cb7a8d3f`,
candidate 129 files), the candidate was PROMOTED by one rename —
`ladder-recover-20260830` → `ladder-20260828`, 129 files present after — the temporary manifest
`docs\rebuild-manifests\afltables_fitzroy_core\ladder-recover-20260830.json` was deleted, and the
accepted manifest remained present and unchanged at the same SHA-256. The canonical validator
`tools/rebuild/fitzroy/validate_ladder_witness.py --label ladder-20260828` then returned
**26 PASS / 0 FAIL, `All checks passed.`, exit 0** — exactly the predicted 4 + 4 + 14 + 4, including
accepted witness binding, `exactly 129 ladder files`, manifest rows `1622`, every manifest SHA-256
matching disk, every row count and the exact eight-column schema, coverage exactly `1897-2025`, and
all 1,622 historical label-season pairs resolving. **THE LADDER WITNESS IS RECOVERED AND CANONICAL
IN THIS WORKTREE, and G7's ladder blocker is CLEARED.** Pass 18 then prepared §5 Step 2 — the single
operator copy block for the two remaining prerequisites. It ran no command, copied/moved/renamed/
deleted no byte, mutated no database, ran no Git command, accessed no production, and altered no
Coleman implementation, accepted manifest or contract. See §2q.**

**PASS 19 (2026-08-30). The operator ran §5 Step 2 and it SUCCEEDED.** Both labels were read from
tracked source (fitzRoy `full-history-20260827`, DraftGuru `annual-html-20260826`), the sources
measured **131** and **90** files in `D:\dev\afldb`, the ladder witness measured **129 files before
the copy**, both directories were copied whole into the same worktree-relative paths with **131** and
**90** files present after, the `player_stats_1897.csv` probe **matched the tracked manifest's
SHA-256**, and the ladder witness measured **129 files after, unchanged**. Final labels present:
`fitzroy_core` → `full-history-20260827`, `ladder-20260828`; `draftguru` → `annual-html-20260826`.
**No `REFUSED` line, no post-copy count mismatch, no database, no Git, no production, and no tracked
manifest or contract changed. All three G7 snapshot prerequisites are now on disk in this worktree,
so the snapshot blocker is CLEARED and only the §5 Step 3 offline adjudication stands between the
worktree and the rebuild.** Pass 19 prepared §5 Step 3 — the three offline canonical validators as
ONE fail-stop operator block, with each validator's expected evidence stated from current source —
and performed no validation itself: it ran no command, copied/moved/renamed/deleted/hashed no byte,
mutated no database, ran no Git command, accessed no production, and altered no Coleman
implementation, accepted manifest or contract. See §2r.**

**PASS 20 (2026-08-30). The operator ran §5 Step 3 and ALL THREE OFFLINE VALIDATORS RETURNED
EXIT 0.** The prerequisite inventory measured **131 / 129 / 90**, then: **1/3** fitzRoy
`full-history-20260827` reproduced the predicted scan summary exactly (`matches 16838`,
`matches_with_player_rows 16838`, `attendance_known 15187`, `players 13275`,
`players_with_dob 855`, `players_with_dob_conflict 0`, `player_match_rows 685471`, `venues 52`,
`seasons 1897-2025`, `brownlow_round_vote_rows 320861`), with `full-history gates PASSED —
identity coverage` (`rows 685473`, `missing_id 83`, `missing_url 0`, `malformed_url 0`,
`distinct_ids 13270`, `distinct_urls 13275`) and `accepted canonical baseline VERIFIED`
(`manifest_sha256 a42c6d5f…21d09`, `artefact_set_sha256 8e14ce61…f4125`, `raw_artefacts 131`,
`acquired_rows 719042`, `contract_version 1`), in **20.8 s with no database access**; **2/3** the
ladder witness returned **26 PASS / 0 FAIL**, accepted manifest binding PASS, exactly **129**
ladder files, manifest rows **1622**, every file SHA-256 matching, every row count and schema
matching, coverage exactly **1897–2025**, all **1622** label-season pairs resolving, `All checks
passed.`; **3/3** DraftGuru `annual-html-20260826` returned **42 year pages sha256 verified,
persons 5057, picks 6810, ledger 6 explicit decisions, bridge 0**, `validate-only: every input
check passed`, no database contacted. **THE SNAPSHOT / INPUT BLOCKER IS THEREFORE CLEARED and the
canonical rebuild is expected to pass PRECHECK.** No database, no network, no Git, no production,
and no snapshot, manifest or contract was changed. Pass 20 then prepared §5 Step 4 — the ONE
destructive `afldb_test` rebuild block, its environment proofs and the expected Coleman evidence,
all reconfirmed from current source — and executed nothing itself: it ran no command, mutated no
database, ran no Git command, accessed no production, and altered no Coleman implementation,
accepted manifest or contract. See §2s.**

> ### Validation state — unambiguous, as of the end of pass 8
>
> **PASSED — operator-run, DB-free, authoritative:**
> - `npm ci` → 419 packages, 0 vulnerabilities.
> - `npm test -- tests/coleman-derivation.test.ts tests/under-22-importer.test.ts
>   tests/db-test-rebuild.test.ts` → **3/3 files, 263/263 tests**, 2.55 s
>   (`db-test-rebuild` 213, `coleman-derivation` 42, `under-22-importer` 8).
> - `npx tsc --noEmit` → **exit 0, zero diagnostics** — measured at the end of pass 1.
>
> The pass-1 code needed **no correction**: the anticipated source-text-assertion failure mode
> did not occur.
>
> **DO NOT RE-RUN** `npm ci` or those 263 DB-free tests: passes 2–8 changed only
> `tests/integration/awards-reload-links.test.ts`, which none of them loads. **`npx tsc --noEmit`
> is the one exception** — passes 4–7 added real TypeScript to that file, so it is worth
> one run before closeout (§7b), though vitest transpiles the same file and will surface any
> syntax error immediately.
>
> **PASSED — operator-run, against `afldb_test` (pass 8):**
> `npm test -- tests/integration/awards-reload-links.test.ts -t "AFLDB-ISSUE-111"` →
> **1 file passed, 29 passed, 0 failed**, 24 unrelated tests filtered out, 24.19 s.
>
> | Test | Gate | Result |
> |---|---|---|
> | derives and loads with `AFLDB_LEGACY_SQLITE` unset | **G9** | PASS |
> | records its batch against `afltables` provenance | — | PASS |
> | owns every row under the derived provenance and the durable key | **G5** | PASS |
> | born linked; goal total in `note`; `votes` / `club_name_raw` NULL | (c)(d) | PASS |
> | independent oracle reproduces the winner set | **G2** | **PASS — 334 ms** |
> | declared span + completed-season rule | — | PASS |
> | home-and-away club rule over the real corpus | **G4** | PASS |
> | three consecutive reloads stable | **G8** | PASS |
> | creates no player-link decision | — | PASS |
> | fixture corpus loads without refusing | — | PASS |
> | every player tied on the season maximum is awarded | `tie_rule` | PASS |
> | two-club winner persists `club_id` NULL | `club_rule` | PASS |
> | in-progress season decides nothing | `completed_seasons_rule` | PASS |
> | never reaches behind the declared first season | `first_season` | PASS |
> | counts home-and-away goals only, never finals | `home_and_away_rule` | PASS |
> | refuses the load when a winner holds no durable identity | **G5a** | PASS |
> | refuses rather than choosing when a winner holds two | **G5a** | PASS |
> | refuses a path containing the key separator, unsanitised | **G5a** | PASS |
> | loads that same winner once the contract is satisfied | **G5a** control | PASS |
> | verifies and no-ops when every Coleman row is already derived | transition retry | PASS |
> | refuses a mixed ownership state and writes nothing | transition abort | PASS |
> | refuses when a season cannot bridge 1:1, aborting the transaction | transition abort | PASS |
> | rekeys an all-legacy family exactly 1:1, preserving every surrogate id | **item 8/12** | PASS |
> | leaves every other award family untouched | **item 13** | PASS |
> | reports 46 updated / 0 inserted / 0 deleted on the first derived load | **item 14** | PASS |
> | keeps an admin's link across the derived reload, disagreement warned | **item 16** | PASS |
> | keeps a confirmed-unlinked decision, disagreement warned | **item 16** | PASS |
> | refuses the reload when a decided row no longer carries the derived name | name guard | PASS |
> | loads again once the name is restored, both decisions standing | recovery | PASS |
>
> **G2, G4, G5, G5a, G8, G9, the LEGACY → DERIVED TRANSITION and BOTH HALVES OF THE PLAYER-LINK
> AUDIT are PROVEN against a real database, and so are `tie_rule`, `club_rule`,
> `completed_seasons_rule`, `home_and_away_rule` and the `first_season` boundary.** Every rule in
> `data/reference/coleman-derivation.json`, the `legacy_transition` block included, now carries
> runtime evidence, and **every row of the runbook's §10 test matrix is satisfied**. No `afterAll`
> restoration, ownership, fingerprint or decision-count failure occurred in any block, so cleanup
> and restoration are measured rather than assumed. No `beforeAll` refused, so `afldb_test` was in
> the expected state throughout.
>
> **The identity contract, the transition choreography and the decision-survival guarantees are
> now settled evidence: do not weaken, rerun or redesign any of them without new evidence.**
>
> **STILL NOT DONE:**
> - **G7, the canonical rebuild (§7 item 17), has not been run.** It was attempted in pass 9 and
>   **REFUSED in the fitzRoy preflight**, before anything was destroyed: this worktree holds no
>   acquired snapshot bytes at all. **G7 is BLOCKED on a rebuild-environment prerequisite
>   (§2h/§5), not on anything ISSUE-111 owns.** Do not weaken the preflight, do not touch the
>   Coleman implementation for it, and do not re-run the rebuild until the snapshot prerequisite
>   is satisfied and proven offline. **Pass 10 narrowed it to ONE snapshot: the ladder witness
>   `ladder-20260828`, absent from both local checkouts (§2i). The other two are present in
>   `D:\dev\afldb` and safe to copy once validated.**
>   **Pass 11: the operator's machine-wide read-only search found the ladder bytes NOWHERE
>   (§2j.1), so recovery requires a NETWORK RE-ACQUISITION under a new label plus file-by-file
>   hash adjudication against the tracked manifest. The exact procedure is §2j / runbook §25;
>   the next action is the offline R + fitzRoy prerequisite preflight (§5 Step 1c).**
>   **Pass 12: Step 1c was RUN and FAILED BOTH LEGS (§2k). (i) The R package probe died with
>   `Segmentation fault`, so no version is established and no acquisition may be attempted;
>   §5 **Step 1c-R** is the isolating replacement. (ii) The manifest-hash "mismatch" is NOT a
>   manifest problem — `604a8a16…8d3f` is the correct canonical LF hash of an intact manifest and
>   `70cc1776…8b6df` (contract `:243`) is the CRLF hash of the identical content, a missed
>   ISSUE-108 renormalisation now tracked as `AFLDB-ISSUE-114`. **That stale literal makes
>   `validate_ladder_witness.py` fail on any LF checkout regardless of the ladder bytes, so
>   `AFLDB-ISSUE-114` must be repaired before §5 Step 3 — even a perfect re-acquisition cannot
>   pass without it.** Do not modify the tracked manifest; the repair is the contract literal.**
>   **Pass 13: Step 1c-R PASSED — R 4.6.1, **fitzRoy exactly 1.8.0**, `jsonlite` + `openssl` load,
>   `digest` absent but not required, no reproducible segfault — so the ACQUISITION TOOLCHAIN
>   PREREQUISITES ARE PROVEN; and `AFLDB-ISSUE-114` IS REPAIRED (contract literal → the canonical LF
>   hash, plus a value assertion in `tests/db-test-rebuild.test.ts`), awaiting one DB-free run.
>   **G7 is therefore blocked ONLY on the ladder witness BYTES (§5 Steps 1d/1e) plus the Step 2
>   copy. NO ACQUISITION HAS BEEN PERFORMED.** See §2l.**
>   **Passes 16–18: the ladder witness is RECOVERED, PROMOTED and CANONICAL.** It was reacquired
>   under a temporary label, adjudicated **129 / 129 / 129 / 0 / 0 / 0** against the tracked
>   manifest (§2p), then promoted by one rename and proven by
>   `validate_ladder_witness.py --label ladder-20260828` = **26 PASS / 0 FAIL, exit 0** (§2q).
>   **Pass 19: §5 Step 2 SUCCEEDED — the fitzRoy (131) and DraftGuru (90) snapshots are now IN this
>   worktree, the probe hash matched, and the ladder witness measured 129 before and after.
>   ALL THREE SNAPSHOT PREREQUISITES ARE PRESENT, so G7's snapshot blocker is CLEARED.**
>   **Pass 20: §5 Step 3 PASSED — all three offline validators returned EXIT 0** (fitzRoy
>   `full-history gates PASSED` + `accepted canonical baseline VERIFIED`, 131 artefacts, 719042
>   acquired rows, `missing_url`/`malformed_url` 0; ladder **26 PASS / 0 FAIL**, 129 files, 1622
>   rows; DraftGuru 42 pages / 5057 persons / 6810 picks / ledger 6 / bridge 0), with no database,
>   network, Git or production access. **THE INPUT PREREQUISITE IS FULLY ADJUDICATED: the rebuild
>   is expected to pass PRECHECK, and G7 is blocked on nothing but being run.** The next and only
>   remaining action for G7 is **§5 Step 4**, the destructive `afldb_test` rebuild. The operator
>   runs it; Claude does not.
> - **NO GIT COMMANDS HAVE BEEN RUN.**
> - The one-time transition has been executed against a **manufactured** legacy state only, never
>   against a real one (`afldb_dev`/production still hold theirs, and both are out of scope).
> - One `npx tsc --noEmit` (§7b), `CHANGELOG.md` (item 19) and the ledger closeout (item 20).
>
> ### `afldb_test` HAS BEEN MUTATED — do not assume the pre-pass-3 state
>
> Every ISSUE-111 run so far has rewritten `award_winners` in `afldb_test` several times over
> (the derived load, three G8 reloads, each fixture load and each restoring load). Its Coleman
> family is now **derived, `afltables`-owned and keyed on profile paths**, not the legacy
> `draftguru` state older text in this file discusses. The pass-5/6/7 runs also inserted and then
> removed synthetic `seasons`, `matches`, `player_match_stats`, `players` and
> `external_identities` rows, one fixture `awards` row with two `award_winners` witnesses, and —
> in the pass-7 run — rewrote the whole Coleman family into the legacy `draftguru` shape and back
> again by id. The **pass-8** run additionally created and deleted two `player_link_resolutions`
> rows and one fixture `auth_users` admin, and rewrote and restored `player_id`,
> `link_status_value` and `player_name_raw` on two real Coleman rows. The measured fingerprints,
> the full ownership snapshot and the Coleman decision count prove it all came back: neither the
> pass-7 nor the pass-8 `afterAll` threw.
>
> **G7 then DESTROYS and rebuilds `afldb_test` outright** — that is the point of item 17, and the
> rebuilt database is the *intended* end state: a canonical corpus whose Coleman family is
> produced by the new rebuild stage rather than by a hand-run loader. `afldb_dev` and production
> are untouched by it; the harness refuses every target but `afldb_test` by name.
>
> **Do NOT run `--rekey-coleman` against `afldb_test` by hand.** Its fail-closed preflight
> demands an all-legacy 46-row `draftguru` state, which `afldb_test` does not have; it would
> correctly refuse (and the pass-6 suite asserts exactly that refusal as its retry/no-op case).
> **The pass-6 transition block manufactures the legacy state itself, from the derived family,
> and restores it by id** — §2e. Let it do that; do not establish the state manually.
>
> `afldb_dev` and production are **untouched**.

**ISSUE-111 is NOT blocked and the architecture is NOT open.** Every design question — G0, G1,
G3, G4, G5, G6, provenance and the legacy transition — was resolved in the design pass and is
recorded verbatim below. **Do not re-litigate it and do not re-run the operator's read-only
measurements.** The next session's job is validation and the integration test suite.

### 1. Implementation completed in this session

| # | Delivered | Where |
|---|---|---|
| 1 | **Tracked derivation contract** — `first_season: 1980` with the basis recorded as *preserving AFLDB's measured legacy award contract* (not a claim about when the medal began), `method_version: 1`, derivation method, excluded source, home-and-away rule, completed-season rule, tie rule, `minimum_goals: 1`, club rule, provenance, `source_record_id` format + example + basis, identity match method/statuses/rule, key-separator rule, emit order, and the full `legacy_transition` block (46 rows, `draftguru`, bridge `(award_id, season)`, columns changed, `46 updated, 0 inserted, 0 deleted`) | `data/reference/coleman-derivation.json` (**new**) |
| 2 | **Coleman loader** — new legacy-free `coleman` group: `load_coleman_contract()`, `COLEMAN_DERIVATION_SQL`, `COLEMAN_NULL_GOALS_SQL`, `coleman_query_params()`, `build_coleman_winners()`, `derive_coleman_winners()`, `coleman_award_id()`, `import_coleman()`. Added to `GROUPS` and `GROUP_ORDER` (after `under_22`); **not** added to `GROUP_REQUIRES` — it runs alone | `tools/migration/import_awards.py` |
| 3 | **One-time transition** — `--rekey-coleman` CLI mode, `coleman_link_decision_count()`, `rekey_coleman()`; three-way retry-safe state machine, exact 46-row fail-closed preflight, 1:1 `(award_id, season)` bridge, single-transaction `UPDATE … WHERE id = <rowId>` touching only `source_id`/`source_record_id` | `tools/migration/import_awards.py` |
| 4 | **Legacy exclusion / legacy-free predicate** — `COLEMAN_SLUG` added to `other_group_awards`; `needs_legacy` generalised from the single `under_22` exemption to `LEGACY_FREE_GROUPS = {"under_22", COLEMAN_GROUP}`; `BATCH_SOURCE_KEYS` replaces the inline `batch_source` conditional | `tools/migration/import_awards.py` |
| 5 | **Canonical rebuild stage** — new `coleman` data stage (`kind: 'data'`, `argv: [python, 'tools/migration/import_awards.py', '--groups', 'coleman']`, `envOverlay: dataEnv`), placed after `derived` and before `ladder-witness` | `tools/db/rebuild-test.ts` |
| 6 | **Stage-9 Coleman gates** — `COLEMAN_CONTRACT` constant, `colemanFirstSeason()` (reads the contract, refuses rather than guessing), `colemanChecks()` wired into `finalValidationChecks()`. Seven gates: `coleman_rows`, `coleman_seasons`, `coleman_first_season`, `coleman_unlinked_rows`, `coleman_rows_not_derived_from_afltables`, `coleman_rows_keyed_on_a_numeric_id`, `coleman_after_accepted_last_season` | `tools/db/rebuild-test.ts` |
| 7 | **DB-free Coleman test suite** — contract assertions, derivation-SQL assertions, and live exercise of the pure `build_coleman_winners()` over synthetic rows via a Python subprocess (key composition, no-`players.id`/no-display-name, display-name-change stability, missing identity refusal, ambiguous identity refusal, `:`-in-path refusal, tie ordering, multi-club NULL), provenance/ownership, legacy independence, and the transition contract | `tests/coleman-derivation.test.ts` (**new**) |
| 8 | **Rebuild test updates** — stage-order list now includes `coleman`; the "no fifth data stage" test became "exactly one data stage beyond the four, and it derives rather than acquires"; new `Coleman derivation stage` describe (ordering after `fitzroy` **and** `derived`, no legacy env, `--groups coleman` only); new `Coleman gates` describe under `final validation` | `tests/db-test-rebuild.test.ts` |
| 9 | **Under-22 contract-test adjustments** — three assertions repointed at the generalised predicates (`LEGACY_FREE_GROUPS`, `BATCH_SOURCE_KEYS`, the three-slug `other_group_awards`), and two `between()` slice end-markers moved from the Rising Star header to the new Coleman header, because the Coleman section was inserted between `import_under_22` and Rising Star | `tests/under-22-importer.test.ts` |
| 10 | **Deployment docs** — §7 refresh sequence gains a post-`rebuild_derived.py` Coleman pass with the reason; a Coleman-only correction paragraph; a one-time `--rekey-coleman` warning stating that skipping it does not fail loudly but silently duplicates the family | `docs/deployment.md` |
| 11 | **Issue / runbook updates** — `AFLDB-ISSUE-111.md` §12 implementation record (per-item map, deviations, not-yet-done) with §13 Status; this handoff; `IssuesIndex.md` ISSUE-111 row rewritten and the ISSUE-102 row's now-stale `needs_legacy` quote corrected | `issues/open/AFLDB-ISSUE-111.md`, this file, `IssuesIndex.md` |

### 2. Exact files changed across passes 1–8

**Created (2)**
- `data/reference/coleman-derivation.json` (pass 1)
- `tests/coleman-derivation.test.ts` (pass 1)

**Modified (9)**
- `tools/migration/import_awards.py` (pass 1)
- `tools/db/rebuild-test.ts` (pass 1)
- `tests/db-test-rebuild.test.ts` (pass 1)
- `tests/under-22-importer.test.ts` (pass 1)
- `docs/deployment.md` (pass 1)
- `tests/integration/awards-reload-links.test.ts` (**the only source/test file passes 2–7
  touched**: pass 2 wrote the derived-load block, pass 3 changed one query inside it, pass 4
  appended a second describe and its module-level fixture helpers, pass 5 appended a third
  describe and extended the shared cleanup, pass 6 appended a fourth describe and extended the
  shared cleanup again, pass 7 appended a fifth describe and changed nothing existing at all.
  **Pass 8 did not touch it**)
- `issues/open/AFLDB-ISSUE-111.md` (passes 1–8)
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` (this file, passes 1–8)
- `IssuesIndex.md` (passes 1, 7 and 8)

**Passes 2–8 changed nothing else.** No loader, no contract, no rebuild stage, no gate,
no migration, no privilege file, no manifest, no `CHANGELOG.md`, no `issues.md`, no
ISSUE-110/112/113 material, no production file. **Pass 8 changed no source or test file at
all** — it recorded the 29/29 result and verified the G7 inputs by reading source. The file
count is unchanged at **eleven**.

**Passes 9–12 changed no source or test file.** **Pass 13 changed two, neither of them ISSUE-111
material:** `tools/rebuild/fitzroy/fitzroy-contract.json` (the `AFLDB-ISSUE-114` ladder
`manifest_sha256` literal and its `$comment`) and `tests/db-test-rebuild.test.ts` (one new binding
assertion inside the existing ladder-witness describe) — plus the durable records `issues.md`,
`IssuesIndex.md` and this file. No loader, no ISSUE-111 contract, no rebuild stage, no gate, no
migration, no privilege file, **no manifest**, and no `CHANGELOG.md` entry (none is written for an
unvalidated repair).

### 2a. Pass 2 — the derived-load integration block

Appended to `tests/integration/awards-reload-links.test.ts` (its existing owner of the awards
ETL boundary, with `import-role-parity`, `./draft-lock` and the shared `sql` pool). New
describe **`Coleman Medal derived from canonical match facts (AFLDB-ISSUE-111)`**, gated on
`canRunFixtureImporter` — Python + psycopg + a validated `AFLDB_TEST_IMPORT_DATABASE_URL` —
and deliberately **not** on `AFLDB_LEGACY_SQLITE`.

Nine tests: G9 legacy-free execution; the `import_batches` provenance row; provenance +
durable-key ownership (every key's path must be a persisted `afltables_profile_url` identity,
no `coleman:<season>:<int>` form, all keys unique); born-linked plus `note`-not-`votes` and
NULL `club_name_raw`; **G2** — an independently shaped oracle reproducing both the winner set
and the goal totals; the declared span and the completed-season rule; **G4** club rule over the
real corpus; **G8** three reloads with 0 inserted / 0 deleted and a byte-identical
`md5(id|source_record_id)` fingerprint; and the no-decision regression.

Two design points the next session must not undo:

1. **`beforeAll` refuses rather than loads** when any Coleman row is owned by a source other
   than the contract's. The derived loader scopes to `afltables`, so running it beside legacy
   `draftguru` rows is exactly the 92-row duplication the transition exists to prevent. The
   suite also does **not** quietly run `--rekey-coleman` for you: the next slice has to observe
   the transition's own **46 updated / 0 inserted / 0 deleted** signal directly.
2. **`runColeman()` does not use `runImporter()`.** That helper's `sqlitePath` parameter
   defaults to the ambient legacy path, so passing `undefined` silently restores it.
   `runColeman()` spawns via `importRole.spawn` with `AFLDB_LEGACY_SQLITE: undefined`, which
   node drops from the child environment — that is what makes G9 a real proof.

**Deliberately NOT touched:** any migration, `tools/maintenance/privileges.sql`, any manifest,
`CHANGELOG.md`, `issues.md`, ISSUE-110/112/113 material, any production file.

### 2b. Pass 3 — the G2 oracle timeout, diagnosed and fixed

**Symptom.** `PostgresError: canceling statement due to statement timeout`, raised by the G2
oracle query. No semantic mismatch was reported, and none could be: the query never returned,
so no winner was ever compared.

**Cause — structural, not a timing guess.**

- The oracle's `totals` CTE was referenced **twice**: once as `t`, and once as `t2` inside
  `(SELECT max(t2.goals) FROM totals t2 WHERE t2.season = t.season)`.
- PostgreSQL 12+ **materialises** any CTE referenced more than once, and a materialised CTE
  has **no index**.
- So the correlated `max` was a full CTE Scan **per outer row**.
- `totals` holds one row per (season, player) with any home-and-away appearance — roughly
  46 seasons x ~750 goalkickers ≈ 34k rows — so the oracle performed ≈ 34k x 34k ≈ **1.2
  billion row comparisons** to produce 46 rows.
- The suite's connection is `sql` from `src/db/client.ts`, whose
  `connection.statement_timeout` is **5000 ms** (`src/db/client.ts:22,37`).

Everything else in the oracle is linear (one scan of `player_match_stats`, a hash join to
`matches`, one hash aggregate). The quadratic rescan was the whole cost.

**The exact source change** — `tests/integration/awards-reload-links.test.ts`, inside
`it('reproduces the persisted winner set with an independent oracle query (G2)')`, **that query
and its comment only**. The per-season maximum is computed once as its own grouped aggregate
and equi-joined back:

```sql
        totals AS (
          SELECT season, player_id, sum(goals)::int AS goals
            FROM ha
           GROUP BY season, player_id
        ),
        maxima AS (                             -- NEW: grouped once, not correlated
          SELECT season, max(goals) AS goals
            FROM totals
           GROUP BY season
        )
        SELECT t.season AS season, t.player_id::int AS "playerId", t.goals AS goals
          FROM totals t
          JOIN maxima mx ON mx.season = t.season AND mx.goals = t.goals
         WHERE t.goals >= ${coleman.minimum_goals}
         ORDER BY t.season, t.player_id
```

The removed clause was `AND t.goals = (SELECT max(t2.goals) FROM totals t2 WHERE t2.season =
t.season)`. `ha`, the `round_type` predicate, the season subquery, the `minimum_goals` floor,
the `ORDER BY` and both `expect()` assertions are **unchanged**.

**Why this is still a valid oracle — do not undo any of it:**

- **Independence preserved.** Three deliberate shape differences from `COLEMAN_DERIVATION_SQL`
  remain: `round_type = 'home_and_away'` instead of `NOT m.is_final` (the migration-003 CHECK
  makes them equivalent, so this cross-checks that too); a season subquery instead of a join to
  `seasons`; and a grouped aggregate joined back instead of the implementation's
  `max(goals) OVER (PARTITION BY season)`. The oracle recomputes the totals from
  `player_match_stats` itself and reads **nothing** the loader wrote — it is not tautological.
- **Comparison not weakened.** Winner identity **and** goal totals are both still compared as
  ordered lists via `toEqual`, with no tolerance and no sampling.
- **Ties still retained.** An equi-join on the season maximum keeps every tied leader, exactly
  as the correlated form did. No `DISTINCT ON`, no `LIMIT`, no row collapsing.
- **Deterministic.** Same `ORDER BY t.season, t.player_id` on both sides.
- **No loader change.** `COLEMAN_DERIVATION_SQL` and the contract were not touched to
  accommodate the oracle.

**Raising `statement_timeout` was rejected**, and should stay rejected. `AFLDB_STATEMENT_TIMEOUT_MS`
is read once by `createClient()` for the whole shared pool, so raising it would relax the bound
for every suite in the run rather than for this query. The repository has explicit precedent
against it (ISSUE-076: *"Do not raise or bypass the normal 5-second `statement_timeout`"*;
ISSUE-103's oracles were captured under the same 5 s bound). A linear query needs no exemption.

### 2c. Pass 4 — the derivation-rule fixture block

The real corpus exercises exactly **one** shape of the derivation. G4 measured 45 of 45
historical winners representing a single home-and-away club; there is no historical tie inside
the declared span, no multi-club winner, no in-progress season that has produced a leader, and
no finals total large enough to reorder a season. After pass 3, four contract rules therefore
carried **no runtime evidence at all**: `tie_rule`, `club_rule`, `completed_seasons_rule` and
`home_and_away_rule`, plus the `first_season` boundary.

Pass 4 appended a **second describe** to `tests/integration/awards-reload-links.test.ts`:
**`Coleman derivation rules that history cannot demonstrate (AFLDB-ISSUE-111)`**, gated on the
same `canRunFixtureImporter`. It builds each case as **synthetic canonical data** and loads it
through the **real** `--groups coleman` importer. Nothing in it reimplements
`COLEMAN_DERIVATION_SQL` — the point is to prove that SQL, so an assertion written against a
hand-rolled copy of it would prove nothing.

| Season | Case | Fixture | Expected |
|---|---|---|---|
| 2090 | tie | A 3+2, B 5, C 4 | **two** rows (A and B, 5 each), distinct keys, tie warned |
| 2091 | multi-club | A 4 for club 1 + 3 for club 2, B 2 | one row, 7 goals, `club_id` **NULL**, warned |
| 2092 | in progress | A 9, season `in_progress` | **no** row |
| 2093 | finals | A 6 H&A; B 4 H&A **+ 10 in a final** | one row, **A**, 6 goals |
| `first_season - 1` | span boundary | A 99 | **no** row |

Five design points the next session must not undo:

1. **The boundary season is computed, not written.** It is `coleman.first_season - 1`, read from
   the contract, so a later span change moves the fixture with it.
2. **The reserved seasons are 2090–2093** — above every real season, below `seasons_year_ck`'s
   2100 ceiling. They cannot collide with the corpus.
3. **Real players, real clubs.** The three players are selected at run time as the
   lowest-numbered players holding **exactly one** `afltables_profile_url` identity. This block
   tests the derivation, not the identity contract; a player holding two would make the loader
   refuse for a reason it is not testing. No player, club, `external_identities` or `awards` row
   is created or modified.
4. **Cleanup runs at both ends.** The release gates count `matches` and `player_match_stats`, so
   a crashed run must leave nothing behind. `removeFixtureCorpus()` deletes in foreign-key order
   (`player_match_stats` → `matches` → fixture-season `award_winners` → `seasons`) and is called
   from `beforeAll` **and** `afterAll`. Synthetic matches are matched on a `match_key` prefix and
   synthetic seasons on a fixture `notes` marker — **never on the year**, so a boundary season
   that already exists in a fully loaded database is never deleted.
5. **`afterAll` proves restoration, not just cleanup.** After removing the corpus it re-runs the
   loader and requires the real family's `md5(id|source_record_id)` fingerprint to come back
   **byte-identical** to the baseline captured in `beforeAll`. That proves both that
   `delete_missing` removed the fixture winners and that no real surrogate id moved. It throws
   rather than asserts, so it still fires when an earlier test has failed.

The 2093 fixture is the sharpest of the five: B leads the season 14–6 and trails home-and-away
4–6, so a derivation that read `player_season_stats` — the contract's `excluded_source` — would
name B.

**Measured in pass 5: all six tests PASS, and `afterAll` restored the real family
byte-identically.** Do not re-run this block on its own; it runs under the same `-t` filter as
everything else.

### 2d. Pass 5 — the G5a identity-refusal block

A **third describe** was appended to `tests/integration/awards-reload-links.test.ts`:
**`Coleman durable-identity refusals against a real database (AFLDB-ISSUE-111 G5a)`**, on the
same `canRunFixtureImporter` gate.

`tests/coleman-derivation.test.ts` already proves all three refusals DB-free, by driving
`build_coleman_winners()` over synthetic rows through a Python subprocess. What it cannot prove
is the same refusal reached through `COLEMAN_DERIVATION_SQL`: that the query's LATERAL really
returns no path for a winner holding no identity, two paths for one holding two, and the stored
path verbatim for one carrying the key separator.

**The fixture.** One reserved season — **2094**, above the pass-4 seasons and below the
`seasons_year_ck` ceiling of 2100 — one synthetic match, and one synthetic player who is that
season's only goalkicker and therefore unambiguously its winner. Only that player's
`external_identities` rows change between cases.

| # | Case | Identity state | Expected |
|---|---|---|---|
| 1 | missing | none | refuse; the batch is marked `failed` with the reason |
| 2 | ambiguous | two `unique` profile paths | refuse, naming both; never picks one |
| 3 | unsafe path | one path containing `:` | refuse — REFUSED, not sanitised |
| 4 | control | exactly one ordinary path | **load succeeds**, keyed on that path |

Four design points the next session must not undo:

1. **The acceptance shape is inverted, and the database is measured.** Each refusal asserts a
   **non-zero exit**, the refusal text (including *"will not fall back to players.id"* and
   *"Nothing has been written."*), and then that nothing moved: the real family's
   `md5(id|source_record_id)` fingerprint and row count unchanged, and no row written for the
   fixture season under any key. A refusal that had already written half a family would be
   worse than no refusal at all, so "nothing was written" is proven, not trusted.
2. **The control case is load-bearing.** Without it, three refusals would be equally consistent
   with a fixture that could never load for some unrelated reason. Giving the same player one
   ordinary identity and requiring the load to succeed *keyed on that path* is what makes the
   refusals evidence about the identity contract. It also pins the whole key, so no surrogate id
   can appear anywhere in it.
3. **One cleanup scheme, not two.** `removeFixtureCorpus()` was **extended, not duplicated**: it
   now also removes the synthetic player and its identities, matched on the same
   `notes = 'AFLDB-ISSUE-111 synthetic fixture'` marker it already matches seasons on, and after
   the `award_winners` delete because a derived winner can point at that player. `CREATED_SEASONS`
   and every pass-4 assertion are untouched — the identity season is added only to the deletion
   scope (`ALL_FIXTURE_SEASONS`).
4. **The synthetic player's id is taken above the corpus** (`coalesce(max(id), 0) + 1`), never
   from the identity sequence: the canonical import seeds `players` with explicit ids, which can
   leave the sequence behind `max(id)` and make a generated id collide.

Also changed: `key_separator` was added to the file's `ColemanContract` type, so the separator in
the assertions is read from the contract rather than written as a literal.

**Measured in pass 6: all four tests PASS.** G5a is proven through `COLEMAN_DERIVATION_SQL`
against a real database, not only through the DB-free pure-function suite. **Do not weaken or
revisit the identity contract without new evidence.**

### 2e. Pass 6 — the legacy → derived transition block

A **fourth describe** was appended to `tests/integration/awards-reload-links.test.ts`:
**`Coleman legacy to derived ownership transition (AFLDB-ISSUE-111)`**, on the same
`canRunFixtureImporter` gate. It covers §7 items **8–14** in one block, because they are one
choreography over one manufactured state rather than seven independent fixtures.

**The state problem, and how it is solved.** The all-`draftguru` state the preflight demands no
longer exists anywhere: `afldb_test`'s Coleman family is already derived and `afltables`-owned.
The block therefore manufactures the legacy state **from the derived family itself** —
`source_id` → `draftguru`, `source_record_id` → `coleman:<season>:<id>` (the row's own id, unique
by construction, so neither uniqueness constraint can object) — and restores it **by id**
afterwards. `--rekey-coleman` is never run against a state this block did not deliberately
establish.

That also sharpens the acceptance test: the derived key each row must arrive at is exactly the
key it started with, so a correct 1:1 rekey restores the baseline `md5(id|source_record_id)`
fingerprint **byte for byte**. The 1:1 claim is measured, not inferred from a count.

| # | Test | State exercised | Expected |
|---|---|---|---|
| 1 | already-derived retry | untouched derived family | exit 0, *"Already rekeyed"*, no mutation reported, ownership unchanged |
| 2 | mixed ownership | one row legacy, 45 derived | **non-zero exit**, *"Mixed ownership state"*, nothing written |
| 3 | unbridgeable season | all legacy, two rows on one season | **non-zero exit**, *"carry more than one legacy row"*, whole transaction aborted |
| 4 | the transition | all 46 legacy | exit 0, 46 exact 1:1 mappings, every id preserved, baseline fingerprint restored |
| 5 | isolation | as above | non-Coleman `award_winners` byte-identical after both the rekey and the load |
| 6 | first derived load | 46 transitioned rows | **46 updated / 0 inserted / 0 deleted**; the unlinked row adopted and linked |

Six design points the next session must not undo:

1. **Every state transition happens in `beforeAll`**, in one ordered choreography; each `it`
   asserts over a captured snapshot. A failing assertion cannot strand `afldb_test` midway
   through a manufactured legacy state.
2. **`afterAll` restores by id, never by reloading.** Restoration must not depend on the loader
   the block is testing. It then proves the restoration twice — the fingerprint **and** the full
   ownership snapshot — and throws rather than asserts, so it still fires after a failure.
3. **The unlinked row is modelled.** One row is left `player_id NULL` / `implausible` in the
   legacy state, mirroring the measured 1982 Malcolm Blight row. Test 4 requires the transition
   to leave it unlinked (ownership moves; no fact is asserted); test 6 requires the first derived
   load to adopt and link it **in place**, id unchanged.
4. **The isolation witnesses are created, not assumed.** A canonically rebuilt `afldb_test` need
   not hold any other award family, which would make an isolation assertion vacuous. The block
   inserts its own award (`afldb-issue-111-isolation`) carrying two witnesses: one owned by
   `draftguru` with a deliberately **legacy-Coleman-shaped key on a different award** — the
   transition scopes by `award_id`, so a key that merely looks like its own must survive verbatim
   — and one with manual/NULL provenance. `removeFixtureCorpus()` was **extended, not
   duplicated**, so one cleanup scheme still removes everything the ISSUE-111 fixtures create,
   defensively at both ends of every block.
5. **The run-time zero is asserted.** Test 4 requires the preflight to print
   `Coleman player_link_resolutions rows 0`: the first derived load rewrites `player_name_raw`,
   which is safe only while no human decision is attached.
6. **`46` is read from the contract, never written as a literal**, including the acceptance
   signal, which is cross-checked against `legacy_transition.first_load_expectation`.

`beforeAll` refuses, naming the actual state, if the family is not exactly `expected_rows` rows,
if any row is not `afltables`-owned, or if any Coleman `player_link_resolutions` row exists.
Those are the three conditions that would make the manufactured legacy state untestable rather
than merely failing.

Also changed: `legacy_transition` was added to the file's `ColemanContract` type.

**Measured in pass 7: all six tests PASS.** The transition is proven against a real database —
retry, both refusals, the exact 1:1 rekey with every surrogate id preserved, isolation, and the
**46 updated / 0 inserted / 0 deleted** first-load signal. `afterAll` restored the real family
byte-identically and its ownership snapshot matched. **Do not rerun or redesign the transition
without new evidence.**

### 2f. Pass 7 — the decision-survival block

A **fifth describe** was appended to `tests/integration/awards-reload-links.test.ts`:
**`Coleman derived reload preserves human link decisions (AFLDB-ISSUE-111)`**, on the same
`canRunFixtureImporter` gate. It is §7 item 16's remaining half: a `linked` and a
`confirmed_unlinked` decision must both survive a derived reload, and the disagreement must be
reported.

**Why this matters more here than for any other awards family.** The derived loader is *born
linked* — it writes `player_id`, `link_status_value` **and** `player_name_raw` for every winner
from the canonical facts — so an admin decision on one of those rows contends with the
derivation on every single reload. `import_coleman` passes `target_table="award_winners"` and
takes `reload_keyed`'s default `name_column="player_name_raw"`
(`tools/migration/common.py:420`), so all three of that helper's decision rules apply, and none
of them had been measured through this loader.

Two real derived rows (earliest and latest season) are returned to the review queue and decided
through the real admin path — `resolveLink` / `confirmUnlinked` lock an UNRESOLVED target and
refuse anything else, which is why the queueing step exists; it is the AFLDB-ISSUE-044 pattern
already in this file. The loader then runs three times.

| # | Test | State | Expected |
|---|---|---|---|
| 1 | `linked` | row linked to a player the derivation does not name | exit 0, `coleman decisions preserved 2`, the admin's player kept, `46 updated / 0 inserted / 0 deleted`, disagreement warned |
| 2 | `confirmed_unlinked` | row vetted as genuinely unlinked | stays `player_id NULL` under its own key and its own unresolved status, its disagreement warned, `listConfirmedUnlinked()` still names it |
| 3 | name guard | that decided row's `player_name_raw` no longer matches the derivation | **non-zero exit**, *"cannot survive"*, *"1 human identity decision(s)"*, and **no reload signal at all** |
| 4 | recovery | the name restored by id | exit 0, both decisions still standing, baseline fingerprint intact |

Five design points the next session must not undo:

1. **Test 3 is the runtime evidence for a transition-design safety claim.** This document states
   (§ "1982 Malcolm Blight — exact treatment") that rewriting `player_name_raw` is safe *only*
   because zero decisions exist, and that with one present the name guard would classify it
   discarded and abort. That was source reading; test 3 measures it, and test 4 measures the
   recovery once the name agrees again.
2. **The decisions must contradict the derivation**, or the warnings would be incidentally
   satisfied. The admin player is chosen at run time as a real player the derivation names for
   neither row.
3. **`afterAll` deletes the fixture decisions FIRST**, then restores the three columns this block
   can move **by id** — never by reloading, which would re-apply an undeleted decision. It throws
   unless the fingerprint, the full link/name snapshot and the Coleman decision count all come
   back. While one fixture decision survives, every other Coleman block's `beforeAll` refuses, so
   this is the cleanup that matters most in the file. The decisions are also deleted **on entry**,
   by the dedicated fixture admin's id (a dedicated `auth_users` row, per the AFLDB-ISSUE-074
   trap).
4. **`beforeAll` refuses rather than adapts**, naming the actual state, on four conditions: a
   family that is not exactly `expected_rows` rows, any row not `afltables`-owned, any Coleman
   decision it did not record, or either chosen row not in the born-linked derived state
   (`player_id` set, `resolved`, `player_name_raw = players.display_name`).
5. **Isolation is asserted, not assumed:** exactly the two decided rows differ from the derived
   baseline after the reload, and the fingerprint is unchanged in every phase — so honouring a
   decision moves no surrogate id, and no decision target is orphaned.

**No existing test, helper, assertion, query or cleanup function was changed.** This block
creates no synthetic corpus of its own; it calls `removeFixtureCorpus()` defensively at both ends
anyway, so one cleanup scheme still covers the whole file.

**Measured in pass 8: all four tests PASS.** A `linked` decision and a `confirmed_unlinked`
decision both survive the derived reload, both disagreements are reported, the name guard refuses
a decided row whose stored name has drifted, and the refusal recovers once the name agrees.
`afterAll` restored the fingerprint, the full link/name snapshot and the Coleman decision count.
**§7 item 16 is CLOSED and the ISSUE-111 integration suite is complete.** Do not rerun or
redesign this block without new evidence.

### 2g. Pass 8 — no code; the G7 rebuild inputs verified in source

Pass 8 wrote nothing. It recorded the 29/29 result and then re-verified, by reading source, the
inputs item 17 depends on — because the canonical rebuild is destructive, long, and the first
ISSUE-111 execution of two paths no test has reached.

| Verified | Where | Result |
|---|---|---|
| The Coleman stage exists, `kind: 'data'`, `--groups coleman`, `envOverlay: dataEnv` | `tools/db/rebuild-test.ts:470-483` | argv **byte-identical** to `runColeman()`'s proven invocation (`tests/integration/awards-reload-links.test.ts:1476`) |
| Stage order | same | `fitzroy → draftguru → derived → **coleman** → ladder-witness → fingerprints` — after `derived`, as deviation (b) requires, so `seasons.status` is computed before the completed-season rule reads it |
| Gates appended, never ahead of their data source | `:689-692` | `colemanChecks(Number(measured.seasons_last))` inside `finalValidationChecks()` |
| The numbers the gates will expect | `:735` and `data/reference/fitzroy-accepted-baselines.json:118` | `seasons_last = 2025`, contract `first_season = 1980` → `span = 46`: `coleman_rows = 46`, `coleman_seasons = 46`, `coleman_first_season = 1980`, and four zero-gates |
| The rebuild honours `AFLDB_PYTHON` | `:389-394` and `:1066-1075` | override, else `.venv\Scripts\python.exe` on win32; a missing interpreter refuses **before** anything is destroyed |
| Create-if-missing is schema-legal | `tools/migration/import_awards.py:1143-1175`, `src/db/migrations/005_brownlow_awards.sql:63-75` | `AWARD_DESCRIPTIONS["coleman"]` exists (`:317`); `category = 'award'` satisfies `awards_category_ck`; `first_season`/`last_season` reference `seasons(year)`, supplied by the derived seasons |

Two consequences the run will measure:

1. **`planStages()` has no awards stage at all.** A canonically rebuilt `afldb_test` holds no
   legacy award family — which is exactly why the pass-6 transition block had to create its own
   isolation witnesses (§2e design point 4). So the Coleman stage runs against an empty `awards`
   table and `coleman_award_id()`'s **create-if-missing** branch — deviation (a) — supplies the
   parent row. **G7 is the acceptance test for that branch**, and for the stage as a whole.
2. **The gates are all-or-nothing scalars.** A 45-row `coleman_rows` result would mean
   `rebuild_derived.py`'s `season_metadata` left 2025 `in_progress`, not that the derivation is
   wrong — the completed-season rule would have worked exactly as declared. Report the gate
   output; do not relax the expectation.

A `--plan` dry run was deliberately **not** requested: `tests/db-test-rebuild.test.ts` already
proves the stage order and the gate construction DB-free (213 tests, passed), and the two numbers
`--plan` would reveal — `seasons_last = 2025` and `first_season = 1980` — were read directly out
of the tracked files above. It would cost a round trip and prove nothing new.

### 2h. Pass 9 — the G7 attempt, REFUSED in preflight for a non-ISSUE-111 reason

`npm run db:test:rebuild -- --acknowledge-destroy afldb_test`, with
`AFLDB_PYTHON=D:\dev\afldb-issue-102\.venv\Scripts\python.exe`, printed the banner and then:

```
ERROR: snapshot file missing:
  D:\dev\afldb-issue-102\data\sources\afltables\fitzroy_core\full-history-20260827\player_stats_1897.csv
REFUSED: fitzRoy preflight failed. Nothing has been destroyed.
```

**Nothing was destroyed, no stage ran, the Coleman stage was never reached, and no Coleman code
is implicated.** The refusal comes from `validate_snapshot()`
(`tools/migration/import_fitzroy_core.py:930-932`) via `runPreflight()`
(`tools/db/rebuild-test.ts:1077-1084`) — which runs **before**
`assertDestructiveAcknowledgement()`. The `resolvePython()` guard (`:1066-1075`) passed, so the
interpreter override is correct; the failure is about **data on disk**.

**Cause: this worktree has no acquired snapshot material.** `data/` holds only tracked files
(`data/awards/22-under-22.csv`, `data/records/first-kick-goal-ids.csv`, `data/reference/*.json`);
`data/sources/` does not exist. `.gitignore:37-48` ignores `/data/*` and re-admits only
`data/reference/*.json` plus those two CSVs, so **raw snapshots are never in a checkout** —
`validate_ladder_witness.py:163-170` states the convention in its own refusal text. A `git
worktree` therefore starts without them, exactly as it starts without `.venv`. Passes 2–8 never
needed them: they ran the awards importer against an already-populated `afldb_test`.

**Three preflight prerequisites are missing, not one.** Fixing only the first moves the refusal:

| # | Prerequisite | Expected path (repo-relative) | Expected contents | Declared in |
|---|---|---|---|---|
| 1 | fitzRoy core `full-history-20260827` | `data/sources/afltables/fitzroy_core/full-history-20260827` | **131 files**, 719,042 rows, `player_stats`/`player_details`/`results`, 1897–2025 | `data/reference/fitzroy-accepted-baselines.json:57-99` (`acceptance_status: accepted`, `selection_policy.rule: exactly_one_accepted`); per-file list in `docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260827.json` |
| 2 | ladder witness `ladder-20260828` | `data/sources/afltables/fitzroy_core/ladder-20260828` | **129 files** | `tools/rebuild/fitzroy/fitzroy-contract.json:239-244`; checked at `tools/db/rebuild-test.ts:1106-1113` |
| 3 | DraftGuru `annual-html-20260826` | `data/sources/draftguru/annual-html-20260826` (`raw/years/`, `http/years/`) | **42 year pages, 5057 persons, 6810 picks** | `tools/rebuild/draftguru/draftguru-contract.json:102`, `parse_draft_snapshot.py:405-421`; `DRAFTGURU_EXPECTED` / `assertDraftguruPreflight` (`tools/db/rebuild-test.ts:554-575`), checked at `:1092-1098` |

**How the bytes are meant to come back.** They are *acquired*, never restored from Git:
`tools/rebuild/fitzroy/acquire_core.R --acquire --label <label> …` (R, fitzRoy **1.8.0** pinned —
register `:70-73`, `acquire_core.R:52`), and the DraftGuru acquisition under
`tools/rebuild/draftguru/`. A re-acquisition is a **network scrape** and is not guaranteed to
reproduce the accepted bytes, so re-acquiring is the *last* resort, not the first: any candidate
set is only acceptable if it hashes to the tracked manifests. The cheap, safe path is that the
same snapshots already exist in **another local checkout of this repository on this machine**
(the ISSUE-093 acquisitions were made once, in `D:\dev\afldb`) and can be **copied** in — a
worktree-local `data/sources/` is untracked, so copying it changes nothing Git sees.

**Integrity chain that must hold before any candidate bytes are used** — nothing may be made to
fit, and every check is re-derived at validate time:

1. `manifest_sha256` over the acquisition manifest (`a42c6d5f…21d09`, register `:68`; enforced
   `import_fitzroy_core.py:549-550`).
2. `artefact_set_sha256` over sorted `'<filename> <sha256> <row_count>\n'` from the manifest's
   `files[]` (`8e14ce61…4125`, register `:84`; enforced `:555-556`).
3. Per file: presence, sha256, exact CSV column list, exact row count (`:930-947`).
4. The full-history gates + identity scan, re-derived from the artefacts
   (`--require-accepted-baseline` implies `--require-full-history`, `:2681`).
5. The ladder witness manifest is bound the same way (contract `:243`), with per-file sha256 at
   `validate_ladder_witness.py:179-185`. **The literal recorded there, `70cc1776…8b6df`, is STALE
   (§2k): the tracked manifest's canonical LF bytes hash `604a8a16…8d3f`, and `70cc…` is the same
   content with CRLF endings.**

So a copy is safe: a partial, stale or edited copy **fails closed** in the same preflight rather
than corrupting a rebuild.

### 2i. Pass 10 — the prerequisite recovery contract, established from source

Pass 10 ran no command and wrote no code. It answers what §2h left open. Full record:
`issues/open/AFLDB-ISSUE-111.md` §24.

**Inventory the operator measured (§5 Step 1):**

| Snapshot | worktree | `D:\dev\afldb` | expected |
|---|---|---|---|
| fitzRoy `full-history-20260827` | ABSENT | **PRESENT, 131 files** | 131 files |
| ladder `ladder-20260828` | ABSENT | **ABSENT** | 129 files |
| DraftGuru `annual-html-20260826` | ABSENT | **PRESENT, 90 files** | 42 **year pages** |

fitzRoy probe `player_stats_1897.csv` = `79f7c8a2…1ef93`, **matching** the manifest.

**1. DraftGuru's 90 files are EXPECTED — the two numbers count different things.** "42 year
pages" is `manifest.source_urls`, one per `expected_years` (1983–85 are declared no-draft gaps),
printed by `import_draftguru.py:921` and asserted by `assertDraftguruPreflight`
(`rebuild-test.ts:554-575`). The directory is written as 42 `raw/years/year_<YYYY>.html`
(`acquire_draft.py:209-221`) + 42 `http/years/year_<YYYY>.json` (`:210-223`) + 2
`http/robots.txt`/`robots_txt.json` (`:186-187`) + 4 `parsed/` files —
`rows.jsonl`, `persons.jsonl`, `schema.json`, `trade_column_profile.json`
(`parse_draft_snapshot.py:825-864`) = **90 exactly**. Only the 42 raw pages are hash-bound;
`parsed/*` is explicitly untrusted (`import_draftguru.py:211-212`) and the parser re-runs over raw
bytes every validate. **Do not treat 90 as contamination, and do not prune the directory.**

**2. Both present snapshots are safe to copy, because adjudication is re-derived here.**
`data/sources/**` is untracked (`.gitignore:37-48`) → a copy changes nothing Git sees and touches
no database, and a stale/partial/edited copy fails closed in the same preflight.
- DraftGuru: copy the **whole** `annual-html-20260826` directory — `http/years/` is read during
  parsing, and `discover_years` **refuses** any non-`year_<YYYY>.html` file in `raw/years/` or any
  year outside `expected_years` (`parse_draft_snapshot.py:417-435`). Do not copy the other
  DraftGuru labels; the frozen CSV-export label is refused as a snapshot (`:408-411`).
- fitzRoy: **the matching probe proves 1 of 131 files and nothing more.** The proof is
  `--validate-only --require-accepted-baseline`, which re-derives `manifest_sha256`
  (`a42c6d5f…21d09`), `artefact_set_sha256` (`8e14ce61…4125`), then per file presence, sha256,
  exact column list and exact row count for all 131, then the full-history gates and identity scan.

**3. The ladder witness is the live blocker, and its recovery is NOT the printed command.**
- Produced by `acquire_core.R` (R, **fitzRoy 1.8.0 pinned**), one
  `fitzRoy::fetch_ladder_afltables(season = s)` per season written as `ladder_<season>.csv`
  (`acquire_core.R:322-341`); 129 seasons 1897–2025, 1,622 rows.
- The re-acquire command printed by both `validate_ladder_witness.py:168-170` and
  `rebuild-test.ts:1111` **cannot run as written**: `acquire_core.R:195-199` aborts when the
  label's manifest already exists (snapshot immutability), and
  `docs/rebuild-manifests/afltables_fitzroy_core/ladder-20260828.json` is **tracked and present**.
  A re-acquisition must use a **new label** and is only usable if its bytes hash to the tracked
  `ladder-20260828` manifest, file by file. *(Recorded, deliberately not fixed — out of scope.)*
- The witness is `LOCALLY_COMPUTED` by fitzRoy from `fetch_results_afltables`
  (`fitzroy-contract.json` `datasets.ladder.provenance`); its value is that a **second toolchain**
  reproduces AFLDB's home-and-away set. **Never synthesise it from AFLDB's own `results.csv` or
  `matches`** — that fails the hashes and destroys the independence the gate exists for.
- The eight ladder columns carry **no timestamp column**, so a fresh acquisition *can* be
  byte-identical for completed seasons. That is a reason to try — never a reason to assume.

**4. What proves a recovered ladder copy canonical — one validator, no alternatives.**
`tools/rebuild/fitzroy/validate_ladder_witness.py --label ladder-20260828` (the contract's own
`validator`, and the exact argv the rebuild re-runs, `rebuild-test.ts:1117-1120`). Offline; no
database, no network. It re-derives the manifest's own sha256 (contract `:243` — **which records the
stale CRLF literal `70cc1776…8b6df`, so this check FAILS TODAY on any LF checkout regardless of the
ladder bytes; §2k**), manifest
shape (129 files / 1,622 rows), then **per file** presence, sha256, the exact eight-column header,
row count, `Season` echo, non-blank unique `Team`, complete unique `Ladder.Position` and
`Percentage = Score.For/Score.Against`; then coverage exactly 1897–2025; then that every
(label, season) resolves through the real `ClubResolver` to one era-correct identity. 26 checks
(ISSUE-095 §13.7). Absent bytes → exit **2** (`:161-170`). Cheap directory probe:
`ladder_1897.csv`, 8 rows, sha256
`0470c6e59a615ea145b49290396ab7f3973f552a7ac82fe25c1ccd6c85817df1`.
**Never** point `import_fitzroy_core.py --require-full-history` at this label (contract
`not_validated_by`).

**5. Where else the bytes could be.** The only documented location is
`data/sources/afltables/fitzroy_core/<label>/`; no cache, mirror or backup location is documented
anywhere in the repository, and `.gitignore:37-48` means the bytes are in **no** Git history — so
no Git recovery exists. ISSUE-095 §13/§13.7 record that the witness **was acquired on this machine
on 2026-08-28** and that the durability gate was exercised by moving the bytes aside and restoring
them, so a local copy existed; no path is recorded, and ISSUE-095 need not have run in
`D:\dev\afldb`. Untried: **other sibling worktrees under `D:\dev`**, and any **moved-aside or
renamed** copy — found by the artefact name `ladder_1897.csv`, not by directory name. That is §5
Step 1b. Claude does not scan outside the repository boundary (CLAUDE.md §2).

### 2j. Pass 11 — the ladder bytes are NOT on this machine; the recovery procedure, from source

Pass 11 ran no command and performed no acquisition. Full record: `issues/open/AFLDB-ISSUE-111.md`
§25.

**1. The operator's §5 Step 1b result — §24.7 outcome 3.**

| Probe | Result |
|---|---|
| `ladder_1897.csv` anywhere under `D:\dev` / `D:\backups` | **NONE FOUND** |
| any directory named `ladder*` under those roots | **NONE FOUND** |
| an alternate accepted ladder snapshot in another worktree | **NONE FOUND** |
| DraftGuru `annual-html-20260826` decomposition | 42 / 42 / 2 / 4 = **90**, no `raw/years` strays — **expected**, §2i.1 confirmed |

**The canonical rebuild is blocked solely because the accepted ladder witness bytes are unavailable
locally.** Do not weaken or bypass the ladder witness gate (`rebuild-test.ts:1106-1113`).

**2. The acquisition, exactly.** Run from the repository root (`acquire_core.R:57-59`):

```
Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --label ladder-recover-20260830 --datasets ladder --from 1897 --to 2025
```

- **A NEW label is forced**: `:195-199` refuses a label whose manifest exists, and
  `ladder-20260828.json` is tracked — so the re-acquire line printed by
  `validate_ladder_witness.py:168-170` and `rebuild-test.ts:1111` cannot run as written.
- **`--datasets ladder`** makes it witness-only (`:367-368`), giving
  `acquisition_kind: validation_witness` and the witness verdict authority (`:471-487`).
- **`--to 2025` is mandatory**: `--to` defaults to the current year (`:206`) = 2026, which would add
  a 130th in-progress season the accepted manifest does not describe.
- **Never `--allow-version-mismatch`** (`:70`, `:83-87`).

**3. Prerequisites, all fail-closed.** `Rscript` on `PATH`; **fitzRoy exactly `1.8.0`**
(`fitzroy-contract.json:186`, enforced `acquire_core.R:76-87`), attachable via `library()` (`:45-48`);
`jsonlite` (`:40,43`); and **`digest` or `openssl`** (`:94-101`). The last is the only expensive
failure: without either, the run fetches all 129 seasons and writes 129 CSVs before dying on the
first hash with no manifest. Recorded environment for every fitzRoy acquisition here: **R 4.6.1**
(`source-families.json:371`) — corroboration, not a gate; the contract pins fitzRoy, not R.

**4. Blast radius: network and `data/sources` only.** **No database access of any kind** — no DSN, no
driver, no `AFLDB_*` read, no Python, no `psql` (`:4-5`). 129 `fetch_ladder_afltables(season)` calls
(`:333-341`). 129 CSVs into the untracked `data/sources/afltables/fitzroy_core/<label>/`. **One
repository-visible file**: `docs/rebuild-manifests/afltables_fitzroy_core/<label>.json` (`:195,490`),
which shows up untracked in `git status` and **must be deleted after adjudication** — it is not an
accepted baseline, and while it exists that label can never be re-acquired.

**5. Expected shape: 129 files, 1897–2025, 1,622 rows** (`fitzroy-contract.json` ladder `coverage`
and `accepted_witness:239-244`), ending `Acquisition complete: 129 file(s); 1622 total rows.` A
zero-row season aborts (`:340`); a fetch failure aborts before any manifest, and the same label may
be retried (`:200-204`).

**6. Adjudication — against the TRACKED `ladder-20260828.json`, before anything moves.** For each of
its 129 `files[]` entries the candidate directory must hold that filename with an identical sha256,
and hold no file the manifest does not list. **129 present / 129 equal / 0 mismatched / 0 unexpected
— nothing less.** Byte equality subsumes row count and header, both re-derived afterwards by the
canonical validator (`validate_ladder_witness.py:228-241`).
**Do NOT adjudicate by running the validator against the temporary label**: `load_witness` derives
the manifest as `<manifest_dir>/<label>.json` (`:118`) and checks the accepted label (`:137-139`) and
`accepted_witness.manifest_sha256` (`:142-144`), so a temp label fails two checks by construction.
The `--contract`/`--manifest-dir` overrides (`:359-382`) are for an ISSUE-101 **successor** witness
against a temporary successor contract — using them here would adjudicate a candidate against a
contract written to fit it. Not authorised.
**The fresh manifest will differ legitimately and proves nothing**: new extraction timestamps
(`:153-154`), and the tracked manifest predates the ISSUE-095 witness-only accounting repair
(`:356-368`), so it still records `seasons_complete: false`, numeric `identity_observations`, the
core `verdict_authority` and no `acquisition_kind`. **Only the 129 CSV hashes are the adjudication.**

**7. What makes the bytes canonical — one outcome only.** All 129 match → the operator renames
`ladder-recover-20260830` → `ladder-20260828`, deletes the temporary manifest, and
`validate_ladder_witness.py --label ladder-20260828` exits **0** with 26 PASS lines. That is the exact
argv the rebuild re-runs (`rebuild-test.ts:1117-1120`). Nothing else confers canonicity.
**Pass 12 amendment:** that validator **cannot** exit 0 until `AFLDB-ISSUE-114` is repaired — its
check 1.3 compares `sha256_bytes(manifest_path)` against the stale CRLF literal at
`fitzroy-contract.json:243` and fails on any LF checkout, whatever the ladder bytes are (§2k). The
129-hash adjudication above is unaffected: those hashes cover gitignored raw CSVs, which Git never
end-of-line translates.

**8. One file differing = fail closed.** Do not move the directory in; do not update
`accepted_witness` (`snapshot_label`, `manifest_sha256`, `files`, `rows`); do not regenerate or edit
`ladder-20260828.json`; do not re-point `ladderWitnessLabel()`, override the contract, or relax the
preflight; never synthesise the witness from AFLDB's own data. The manifest hash exists so the file
list cannot be edited to cover for different bytes — updating it to accommodate fresh upstream bytes
destroys the ISSUE-095 durability gate. Delete the candidate, report the differing filenames, STOP.
Adopting a **successor** witness is ISSUE-101's procedure and an operator decision outside
ISSUE-111's scope.

### 2k. Pass 12 — Step 1c FAILED both legs; the manifest is intact, the contract literal is stale

Pass 12 ran no acquisition, copied/generated/deleted no snapshot byte, installed or changed no R
package, modified no tracked manifest, ran no Git command and mutated no database. Full record:
`issues/open/AFLDB-ISSUE-111.md` §26.

**The operator's Step 1c result.** `Rscript` resolves (`C:\Program Files\R\R-4.6.1\bin\Rscript`);
the package/version probe died immediately with **`Segmentation fault`**, so **no fitzRoy /
jsonlite / digest / openssl version was established**; the tracked manifest hashed
**`604a8a16…8d3f`** against Step 1c's expected `70cc1776…8b6df`; the working area is still absent
(expected); the temp label `ladder-recover-20260830` is free.

**1. The manifest-hash discrepancy is RESOLVED, and it is not a manifest defect.**

Proven by construction, not inferred: the tracked manifest as checked out here is LF-only and hashes
`604a8a162543e19060f426bd189222d32d07726a0b134bdf4f910175cb7a8d3f`; re-encoding **that same
content** with CRLF endings (53,915 → 56,284 bytes, one `\r` per line over 2,369 lines, nothing else
changed) hashes `70cc17768685a3140a428d3eef796bf465ae2fd9dca71a66684f248cdde8b6df` — **exactly** the
contract's value. They are the LF and CRLF renderings of one identical document.

- The manifest was **not** changed by any later ISSUE-095/101 accounting repair, and is not corrupt.
- **`604a8a16…8d3f` is the current authoritative tracked hash.**
- `70cc1776…8b6df` came from `fitzroy-contract.json:243`, recorded 2026-08-28 from a CRLF working
  copy — consistent with ISSUE-095 §13.7's `validate_ladder_witness.py` **26/26 PASS** that day,
  which requires the on-disk bytes to have been CRLF then.
- The handoff and runbook carried that literal forward; every occurrence is now corrected.

**This is exactly the defect ISSUE-108 fixed for the CORE snapshot and missed for the LADDER
witness.** ISSUE-108 §10: `fitzroy-accepted-baselines.json` `manifest_sha256` → canonical LF
`a42c6d5f…`; new `.gitattributes` with `docs/rebuild-manifests/** text eol=lf`;
`tests/db-test-rebuild.test.ts` LF-normalised comparison. The ladder binding was missed because
**nothing tests its value** — `tests/db-test-rebuild.test.ts:646` only asserts
`/^[0-9a-f]{64}$/`.

**Why this BLOCKS Step 3 on its own.** `validate_ladder_witness.py:142-144` compares
`sha256_bytes(manifest_path)` — raw bytes, no normalisation — to the contract literal. On any
checkout honouring `.gitattributes` (now every platform) that check fails **before any ladder CSV is
read**. So a byte-perfect re-acquisition passing the §2j 129/129 adjudication would still fail
Step 3, and `rebuild-test.ts:1117-1120` re-runs the same validator, so **G7 would refuse after a
perfect recovery.**

**The repair, and what it is not.** Set `tools/rebuild/fitzroy/fitzroy-contract.json`
`datasets.ladder.accepted_witness.manifest_sha256` to
`604a8a162543e19060f426bd189222d32d07726a0b134bdf4f910175cb7a8d3f` — the same repair ISSUE-108 made
for the core register. It re-points the binding at the **same document** in canonical LF form: it
accepts no different content, touches none of the 129 per-file hashes, and weakens no check.
Normalising inside `validate_ladder_witness.py` is **rejected** — `import_fitzroy_core.py:549-550`
hashes raw bytes against a stored LF literal and the witness must not diverge from that precedent.
**Pass 12 did not make the edit:** the operator's boundary was *do not modify the tracked ladder
manifest, do not weaken its integrity contract*, and the contract literal is a tracked integrity
binding outside ISSUE-111's scope. It is recorded as **`AFLDB-ISSUE-114`**.

**Nothing else in §2j changes.** The manifest's 129 per-file `sha256` entries hash **gitignored raw
CSVs**, which Git never end-of-line translates, so the Step 1e adjudication rule stands verbatim.

**2. The segfault — narrowed, not yet resolved.** Step 1c's probe conflated four things in one
process (`R.version.string`, plus `requireNamespace()` **and** `packageVersion()` for four
packages), so its crash names none of them. Ranked candidates: (a) **a namespace load, most likely
`fitzRoy`** — `requireNamespace()` `dlopen`s compiled code, and a package built against a different
R ABI crashes rather than errors; this matters directly because `acquire_core.R:48` runs
`library(fitzRoy)`; (b) **R startup itself** — implicated only if a bare `--vanilla` start also
crashes; (c) **a startup file** — there is **no `.Rprofile` in this repository** (verified), so only
a user/R-home `.Rprofile`/`Rprofile.site`/`Renviron.site` could be involved, isolated by comparing a
`--vanilla` start with a default one; (d) **shell rendering** — "Segmentation fault" is the POSIX
form, the Windows analogue being exit `-1073741819` (0xC0000005), so per-probe exit codes matter.

**Version establishment needs no namespace load.** `utils::packageVersion()` reads `DESCRIPTION` via
`packageDescription()`; it never loads a namespace or `dlopen`s a DLL. So all four versions can be
established **even if loading crashes R** — which is what §5 **Step 1c-R** does before attempting one
load per process.

**Do not install, reinstall, update or remove any R package until the crash is isolated** — it would
destroy the evidence and could move fitzRoy off the pinned **1.8.0**. `--allow-version-mismatch`
remains forbidden.

**3. The acquisition gate is now four conditions.** No Step 1d until: `Rscript` starts (exit 0);
**fitzRoy exactly 1.8.0** present *and* loadable; `jsonlite` plus at least one of `digest`/`openssl`;
and the authoritative manifest hash established — **done, `604a8a16…8d3f`**. `AFLDB-ISSUE-114` is
required before **Step 3**, not before Step 1d.

### 2l. Pass 13 — Step 1c-R PASSED; `AFLDB-ISSUE-114` repaired; still NO acquisition

Pass 13 performed **no acquisition, no network call, no database access, no Git command, no package
install or change, and wrote or copied no snapshot byte.** It changed two files, both of them
outside ISSUE-111's own scope, as the authorised `AFLDB-ISSUE-114` prerequisite slice.

**1. The R / fitzRoy acquisition prerequisites are PROVEN.** The operator ran §5 Step 1c-R
(read-only, isolated one process per probe). `Rscript` is `C:\Program Files\R\R-4.6.1\bin\Rscript`,
R 4.6.1. Both a `--vanilla` start and a default start exit **0**, so neither R itself nor any
startup file is implicated. `DESCRIPTION`-only versions (no namespace loaded): **fitzRoy 1.8.0** —
exactly the pinned version, so `acquire_core.R:76-87` will not refuse and
`--allow-version-mismatch` stays forbidden — `jsonlite 2.0.0`, `openssl 2.4.2`, `digest` **not
installed**. One `loadNamespace()` per process then succeeded for `jsonlite`, `openssl` and
**`fitzRoy`** (exit 0 each); `digest` exited 1 for the only reason it can, absence.

- **The missing `digest` is NOT a blocker.** §2j records the hashing requirement as
  *`digest` **or** `openssl`*; `openssl` is installed and loads.
- **The pass-12 segmentation fault is not reproducible under isolation and is not an acquisition
  blocker.** It was an artefact of the combined probe, not of any package this acquisition needs.
  The §2k prohibition on installing, updating or removing R packages still stands — fitzRoy is on
  the pinned 1.8.0 and must not move.

So three of §2k's four acquisition-gate conditions are now met by measurement, and the fourth (the
authoritative manifest hash) was already established as `604a8a16…8d3f`.

**2. `AFLDB-ISSUE-114` is REPAIRED — the Step 3 blocker is gone.**
`tools/rebuild/fitzroy/fitzroy-contract.json:243` now records
`604a8a162543e19060f426bd189222d32d07726a0b134bdf4f910175cb7a8d3f`, the canonical LF hash of the
**same** tracked manifest, with the reason recorded in the block's `$comment`; and
`tests/db-test-rebuild.test.ts` gained a value assertion binding that literal to the manifest's
LF-normalised bytes, rejecting the CRLF rendering of identical content, checking the bound path is
`<manifest_dir>/<snapshot_label>.json`, and re-proving 129 files / 1,622 rows. Full record:
`issues.md` § `AFLDB-ISSUE-114` → "Repair applied 2026-08-30".

**Nothing in §2j or §2k's adjudication rules changes.** `ladder-20260828.json` was **not** edited,
`validate_ladder_witness.py` was **not** normalised, no preflight or gate was relaxed, and
`snapshot_label` / `manifest` / `files` / `rows` / `validator` were not touched. The 129 per-file
hashes cover gitignored raw CSVs, so the Step 1e 129/129 rule stands verbatim, and admitting
*different* bytes remains an `AFLDB-ISSUE-101` successor decision, never an edit to this field.

**That repair is itself awaiting ONE DB-free run** — `npm test -- tests/db-test-rebuild.test.ts`,
expected 214 passed (the measured 213 baseline plus the new case). Do not treat
`validate_ladder_witness.py --label ladder-20260828` as its acceptance command: with the ladder
bytes absent it still exits **2** at the durability refusal, which is the correct shape.

**3. G7 is now blocked on exactly two things, and no acquisition has been performed.**

| Blocker | State |
|---|---|
| `AFLDB-ISSUE-114` contract literal | **REPAIRED and its own regression PASSED** (§2m); one confirming re-run outstanding |
| ladder witness `ladder-20260828` **bytes** | **STILL ABSENT** — §5 Steps 1d (acquire under a new label), 1e (129/129 adjudicate), then the rename |
| fitzRoy + DraftGuru snapshots | present in `D:\dev\afldb`, **not yet copied in** (§5 Step 2) |
| R / fitzRoy toolchain | **PROVEN** (above) |

**No ladder acquisition has occurred.** `data/sources/` still does not exist in this worktree, the
temp label `ladder-recover-20260830` is still free, and no
`docs/rebuild-manifests/afltables_fitzroy_core/<temp>.json` has been created. The next action is §5
Step 1d, in a fresh session.

### 2m. Pass 14 — the `AFLDB-ISSUE-114` regression PASSED; one test-isolation repair; still NO acquisition

Pass 14 performed **no acquisition, no network call, no database access, no Git command and no
production change.** It changed **one file**, `tests/db-test-rebuild.test.ts`, and only test
records besides.

**1. The `AFLDB-ISSUE-114` repair is PROVEN.** The operator ran
`npm test -- tests/db-test-rebuild.test.ts`: **214 tests, 213 passed, 1 failed**, and the new case
*"binds the witness to the canonical LF bytes of the tracked manifest"* **PASSED**. So the contract
literal `604a8a16…8d3f` is proven equal to the tracked manifest's LF-normalised bytes and proven to
reject the CRLF rendering of the identical content. §5 Step 3's contract blocker is settled.

**2. The sole failure was ambient-environment contamination, not a defect.** *Python interpreter
resolution > "refuses with the selected path when that interpreter does not exist"* expected
`/No Python interpreter at .*\.venv.Scripts.python\.exe/` and got
`"DraftGuru preflight did not report 42 year pages. Nothing has been destroyed."` Established from
source: `runPreflight()` (`rebuild-test.ts:1066`) calls `resolvePython()` with no argument and
`resolvePython()` (`:389-394`) reads `process.env` **by design**; the operator shell exports
`AFLDB_PYTHON=D:\dev\afldb-issue-102\.venv\Scripts\python.exe` — the documented setup for this
worktree (§2g) — while that case stubbed only the **relative** `DEFAULT_VENV_PYTHON` as missing. The
absolute override therefore read as present, the interpreter refusal never fired, and the run fell
through to the next gate, the DraftGuru preflight. Its two siblings in the same describe already
save, set and restore the variable; this one alone assumed absence.

**Repaired in the TEST ONLY:** that case now saves `process.env.AFLDB_PYTHON`, `delete`s it for its
duration and restores it in a `finally`, the pattern already used beside it. **Every assertion is
byte-identical** (re-indented only) — the refusal, the interpreter-path regex, the `AFLDB_PYTHON`
mention and `Nothing has been destroyed` are all still required. Nothing was weakened, skipped or
deleted, and **`resolvePython` / `runPreflight` were not changed**: the harness's environment-read
contract is correct and stands.

**3. No ladder acquisition has occurred.** `data/sources/` still does not exist in this worktree,
the temp label `ladder-recover-20260830` is still free, no
`docs/rebuild-manifests/afltables_fitzroy_core/<temp>.json` has been created, and the fitzRoy and
DraftGuru snapshots have not been copied in. The next ISSUE-111 action is unchanged: **§5 Step 1d**,
in a fresh session.

### 2n. Pass 15 — `AFLDB-ISSUE-114` RESOLVED; Step 1d prepared and handed to the operator

Pass 15 performed **no acquisition, no network call, no database access, no Git command and no
production change**, and wrote or copied **no snapshot byte**. It changed durable records only:
`issues.md` (ISSUE-114 → Resolved, final validation, Resolution section), `IssuesIndex.md` (ISSUE-114
row retired; the ISSUE-111 row's state and next action updated), `CHANGELOG.md` (the ISSUE-114
Unreleased entry, deliberately withheld until the repair was validated) and this file.

**1. The blocker table, restated.**

| Blocker | State |
|---|---|
| `AFLDB-ISSUE-114` contract literal | **RESOLVED** — 214/214, both cases green |
| R / fitzRoy toolchain | **PROVEN** (pass 13) |
| ladder witness `ladder-20260828` **bytes** | **STILL ABSENT — the only live blocker** |
| fitzRoy + DraftGuru snapshots | present in `D:\dev\afldb`, not yet copied in (§5 Step 2) |

**2. Step 1d re-verified against current source before it was issued.** `acquire_core.R` was read in
full this pass; nothing in it has moved since §2j:

- `--acquire` requires `--label` matching `^[A-Za-z0-9._-]+$` and **refuses** when
  `docs/rebuild-manifests/afltables_fitzroy_core/<label>.json` already exists (`:192-199`) — which is
  why the accepted label cannot be reused and `ladder-recover-20260830` is the temporary label.
- `--from` defaults to 1897 but **`--to` defaults to the current year** (`:205-206`), so `--to 2025`
  is mandatory; without it 2026 would be fetched as a 130th, in-progress season.
- `--datasets ladder` makes the run **witness-only** (`:367-368`), which sets
  `acquisition_kind: validation_witness` (`:471-477`), scopes the season accounting to the requested
  range (`:376-393`), and records `identity_observations: "not_applicable"` (`:449`).
- The version pin is enforced **before any fetch** (`:76-87`): fitzRoy must equal the contract's
  `pinned_version` (1.8.0) or the run stops. `--allow-version-mismatch` is forbidden here.
- Hashing needs `digest` **or** `openssl` (`:94-101`); `openssl 2.4.2` is installed and loads.
- Raw CSVs land in `data/sources/afltables/fitzroy_core/<label>/` (`:52`, `:252`), one
  `ladder_<season>.csv` per season (`:333-342`), each written and hashed as it goes; a zero-row season
  **stops the run** (`:340`), so a source failure can never be recorded as an absence.
- The manifest is written **last**, after every artefact exists and is hashed (`:489-490`).
- The script **never touches PostgreSQL** (`:1-5`) — no DSN, no driver, no `AFLDB_*` read.

**3. What the operator was told NOT to do at the boundary.** Not to copy, rename, move or delete
anything after the acquisition, and not to run the `validate_ladder_witness.py --label
ladder-recover-20260830` line the tool prints on success: `load_witness` derives the manifest as
`<manifest_dir>/<label>.json` and checks both the accepted `snapshot_label` and its `manifest_sha256`
(`:138-143`), so a temporary label fails two contract-binding checks **by construction**. Adjudication
is §5 Step 1e, against the tracked `ladder-20260828.json`, in a separate session.

### 2o. Pass 16 — the acquisition SUCCEEDED; the recovery adjudication, designed but NOT performed

Pass 16 performed **no acquisition, no adjudication, no hashing, no file move/copy/rename/delete, no
database access, no Git command, no network call and no production access**. It changed durable
records only. **The Coleman implementation, the accepted `ladder-20260828` manifest and
`fitzroy-contract.json` were not touched.**

**1. What the operator's Step 1d run produced — matched against the declared expectation.**

| Expected (§5 Step 1d / §2j.5) | Reported | Verdict |
|---|---|---|
| 129 ladder CSV files | 129 | **as expected** |
| seasons 1897–2025 | 1897–2025 | **as expected** |
| 1,622 total rows | 1,622 | **as expected** |
| `acquisition_kind: validation_witness (ladder)` | as printed | **as expected** — witness-only, never a fact source |
| `completeness: unvalidated (the acquirer does not adjudicate)` | as printed | **as expected**, and it is the point: the acquirer never adjudicates |
| temporary manifest `…/ladder-recover-20260830.json` written last | written | **as expected** (`acquire_core.R:489-490`) |
| raw CSVs under `data/sources/afltables/fitzroy_core/ladder-recover-20260830/` | present | **as expected** (`:52`, `:252`) |
| no database contact | none | **as expected** (`acquire_core.R` holds no DSN, no driver, no `AFLDB_*` read) |

The counts agreeing with `accepted_witness.files = 129` and `accepted_witness.rows = 1622`
(`fitzroy-contract.json:244-245`) is **encouraging, not evidence**. Row and file counts are
aggregate; the acceptance criterion is per-file byte equality. A single corrected historical score
upstream would change one season's CSV and leave both counts identical.

**2. The recovered bytes are UNTRUSTED, and the temporary manifest is NOT authority.**
`ladder-recover-20260830.json` records the hashes `acquire_core.R` computed **over the bytes it had
just written** — it is a self-description of the candidate, so comparing it against itself proves
nothing. The adjudication reads the candidate's **files**, never its manifest. The one authority is
the tracked `docs/rebuild-manifests/afltables_fitzroy_core/ladder-20260828.json`, bound to
`accepted_witness.manifest_sha256` (`604a8a16…8d3f`, the canonical LF hash repaired under
`AFLDB-ISSUE-114`) so its 129-entry `files[]` list cannot be edited to cover for different bytes.

**3. The adjudication contract — nine required proofs, all read-only.** The §5 Step 1e block proves,
in this order:

| # | Proof | How |
|---|---|---|
| 0 | the adjudication is bound to the ACCEPTED contract | `Get-FileHash` of the tracked manifest **must equal** `datasets.ladder.accepted_witness.manifest_sha256`, its `snapshot_label` must be `ladder-20260828`, and its `files[]` count must equal `accepted_witness.files` — otherwise it STOPS and adjudicates nothing. This reproduces `validate_ladder_witness.py:142-144`'s `sha256_bytes` exactly |
| 1 | exactly 129 expected filenames | `expected` is read from the tracked manifest and cross-checked against the contract's `files` — never typed as a literal |
| 2 | every filename corresponds to the accepted manifest | the loop iterates the manifest's `files[]`; the candidate directory is never the source of the expected list |
| 3 | every acquired SHA-256 equals the accepted SHA-256 | `Get-FileHash -Algorithm SHA256`, lowercased, compared to `files[].sha256` |
| 4 | zero expected files missing | `missing` counts manifest entries with no file on disk |
| 5 | zero acquired files mismatch | `mismatched` counts present files whose hash differs |
| 6 | zero unexpected files | a **recursive** scan of the candidate directory; any relative path not in the manifest's filename set is unexpected, so a nested stray cannot hide |
| 7 | the candidate's own manifest is never consulted | `ladder-recover-20260830.json` is not read by the block at all |
| 8 | nothing is written | `Get-Content` / `Get-FileHash` / `Get-ChildItem` / `Test-Path` / `Resolve-Path` only — no move, copy, rename, delete or edit, and no database |

`row_count` and `columns` are reported as a **secondary diagnostic only**, and only where they can
inform: the candidate's total data rows against `accepted_witness.rows`, and — for any mismatched
file — its actual row count and whether its header still matches the accepted column list. Byte
equality against the accepted manifest is the deciding criterion; a row/column agreement never
rescues a hash difference.

**4. The only permitted continuation.** `expected=129, present=129, matched=129, missing=0,
mismatched=0, unexpected=0`. Anything else is §2j.8 / §25.8 **fail closed**: nothing is moved, the
accepted manifest, its `manifest_sha256`, `accepted_witness` and `ladderWitnessLabel()` are never
updated to accommodate fresh upstream bytes, the candidate is deleted, and the differing filenames
are reported. Adopting a **successor** witness is ISSUE-101's documented procedure and an operator
decision outside ISSUE-111's scope.

### 2p. Pass 17 — the adjudication PASSED 129/129; the promotion designed, NOT performed

Pass 17 performed **no adjudication, no hashing, no file move/copy/rename/delete, no database
access, no Git command, no network call and no production access**. It changed durable records only.
**The Coleman implementation, the accepted `ladder-20260828` manifest and `fitzroy-contract.json`
were not touched.**

**1. The operator's Step 1e result — the only continuation §2o.4 permits.**

| Proof | Reported |
|---|---|
| accepted label | `ladder-20260828` |
| accepted `manifest_sha256` (from `fitzroy-contract.json:243`) | `604a8a162543e19060f426bd189222d32d07726a0b134bdf4f910175cb7a8d3f` |
| tracked manifest `Get-FileHash` | `604a8a162543e19060f426bd189222d32d07726a0b134bdf4f910175cb7a8d3f` — **equal**, so proof 0 held and the adjudication was bound to the accepted contract before it adjudicated anything |
| candidate | `data\sources\afltables\fitzroy_core\ladder-recover-20260830` |
| expected / present / matched | **129 / 129 / 129** |
| missing / mismatched / unexpected | **0 / 0 / 0** |
| secondary diagnostic | accepted rows **1622**, candidate rows **1622** |

**VERDICT: RECOVERED — byte-for-byte identical to the accepted `ladder-20260828` manifest.**

**2. What that verdict means, precisely.** The 129 reacquired CSVs are not *a* valid witness — they
are *the* accepted witness, reproduced. Therefore:

- **No successor-witness decision arises.** `AFLDB-ISSUE-101`'s successor procedure is not engaged
  and remains outside ISSUE-111's scope.
- **Nothing about the binding changes.** The accepted manifest, its `manifest_sha256`,
  `accepted_witness`, the snapshot label and `ladderWitnessLabel()` are **not** updated — there are
  no new bytes to accommodate.
- **§2j.8 / §25.8 fail-closed is not reached.** Nothing is deleted, no differing filenames exist.
- The ISSUE-093 durability convention is vindicated by measurement: gitignored raw snapshot bytes
  were reproduced from the tracked manifest alone, two days later, byte for byte.

**3. The remaining recovery operation — §5 Step 1f, one atomic operator block.** It is mechanical,
and it fails closed **before** it changes anything if the canonical target
`data\sources\afltables\fitzroy_core\ladder-20260828` already exists, if the candidate directory or
the temporary manifest is missing, if the candidate no longer holds exactly the 129 adjudicated
files, or if the accepted manifest's SHA-256 no longer equals the contract binding. It then performs
**one rename** — not a copy, so the adjudicated bytes cannot be altered in transit — deletes **only**
`docs/rebuild-manifests/afltables_fitzroy_core/ladder-recover-20260830.json`, and immediately runs
the canonical validator.

Untouched by design: `docs/rebuild-manifests/afltables_fitzroy_core/ladder-20260828.json`,
`tools/rebuild/fitzroy/fitzroy-contract.json`, every Coleman file, every migration, every test.
`data/sources/**` is gitignored (`.gitignore:37-48`) and the temporary manifest is untracked, so Git
sees nothing and no Git command is involved.

**4. The exact expected validator result — counted from current source, not remembered.**
`validate_ladder_witness.py --label ladder-20260828` in default mode makes **no database connection
and no network request** (`:7-8`); `--compare` is deliberately NOT used, because `club_seasons` has
not been rebuilt yet and the D7 cross-check belongs to §5 Step 4's FINAL VALIDATION.

| Section printed | `PASS` lines | Source |
|---|---|---|
| `1. witness binding` | 4 | `:130-133`, `:137-144` |
| `2. manifest shape` | 4 | `:150-159` (`exactly 129 ladder files`, `row counts total 1622` — read from `coverage`) |
| `3. raw artefacts (bytes, schema, per-season structure)` | 14 | `:228-255` (includes `covers exactly 1897-2025`, `total rows = 1622`) |
| `4. historical identity resolution` | 4 | `:286-293` (`all 1622 label-season pairs resolve`) |
| **total** | **26 PASS, 0 FAIL** | then `All checks passed.`, exit **0** (`:398-402`) |

**Why 26/26 is reachable now and was not on an LF checkout before:** `AFLDB-ISSUE-114` is RESOLVED
(§2l–§2n) — `fitzroy-contract.json:243` carries the canonical LF hash, so the manifest-binding check
at `:142-144` passes. That repair and these adjudicated bytes are the two halves of the same gate;
either one alone leaves the validator failing.

**5. What a non-zero exit would mean here.** A `REFUSED:` line (exit 2) means the rename did not land
where the validator looks — `SNAPSHOT_ROOT / label` is
`data/sources/afltables/fitzroy_core/ladder-20260828` (`:53`, `:161-170`); report it, do not
re-acquire. A `FAILED: n check(s)` (exit 1) after a 129/129 adjudication would be genuinely new
information about the validator's own schema/identity checks rather than about the bytes — report the
named checks verbatim and change nothing.

### 2q. Pass 18 — the promotion SUCCEEDED, 26/26; the ladder witness is CANONICAL

Pass 18 performed **no promotion, no hashing, no file move/copy/rename/delete, no database access,
no Git command, no network call and no production access**. The operator ran §5 Step 1f exactly as
written; pass 18 recorded the result and prepared §5 Step 2.

**1. The operator's Step 1f result.**

| Phase | Reported |
|---|---|
| preconditions | passed — accepted manifest SHA-256 `604a8a162543e19060f426bd189222d32d07726a0b134bdf4f910175cb7a8d3f`, candidate 129 files |
| promotion | `…\fitzroy_core\ladder-recover-20260830` → `…\fitzroy_core\ladder-20260828`, **129 files present after the rename** |
| temporary manifest | `docs\rebuild-manifests\afltables_fitzroy_core\ladder-recover-20260830.json` **deleted** — and only that file |
| accepted manifest | still present at `docs\rebuild-manifests\afltables_fitzroy_core\ladder-20260828.json`, **unchanged**, same SHA-256 `604a8a16…8d3f` |
| validator | `validate_ladder_witness.py --label ladder-20260828` → **26 PASS, 0 FAIL**, `All checks passed.`, **exit 0** |

Key proofs inside those 26, as reported: accepted witness binding PASS; the manifest lists exactly
**129** ladder files; manifest rows total **1622**; every manifest SHA-256 matches disk; every row
count and the exact eight-column schema match; coverage is exactly **1897–2025**; total rows
**1622**; all **1622** historical label-season pairs resolve. That is the predicted 4 + 4 + 14 + 4
(§2p.4), with no section 5 — `--compare` was correctly not used.

**2. What this settles.** The accepted ladder witness is **recovered and canonical in this
worktree**. `AFLDB-ISSUE-114`'s contract repair and these adjudicated bytes were the two halves of
the same gate, and both now hold: the same validator argv the rebuild re-runs at
`rebuild-test.ts:1117-1120` passes offline. **G7's ladder-witness blocker is CLEARED.** Nothing
about the binding changed — the accepted manifest, its `manifest_sha256`, `accepted_witness`, the
snapshot label and `ladderWitnessLabel()` are exactly as they were, because the bytes are the
accepted witness reproduced rather than a successor (§2p.2). Do not re-acquire, do not
re-adjudicate, and do not re-run Step 1f: the block now fails closed on its **first** precondition
(the canonical target exists), which is correct behaviour, not a new problem.

**3. On-disk state after Step 1f.**

| Path (worktree-relative) | State |
|---|---|
| `data/sources/afltables/fitzroy_core/ladder-20260828` | **PRESENT, 129 files, canonical, validated** |
| `data/sources/afltables/fitzroy_core/ladder-recover-20260830` | gone — renamed, not copied |
| `data/sources/afltables/fitzroy_core/full-history-20260827` | **ABSENT — §5 Step 2** |
| `data/sources/draftguru/annual-html-20260826` | **ABSENT — §5 Step 2** |
| `docs/rebuild-manifests/afltables_fitzroy_core/ladder-20260828.json` | tracked, present, unchanged |
| `docs/rebuild-manifests/afltables_fitzroy_core/ladder-recover-20260830.json` | deleted (untracked temporary) |

**4. The remaining prerequisite — §5 Step 2, one operator copy block.** The other two snapshots
already exist in `D:\dev\afldb` and were measured there in pass 10 (fitzRoy 131 files with a
matching probe hash; DraftGuru 90 files, 42/42/2/4, no strays — §2i, runbook §24.1/§24.4). Copying
is safe **structurally**, not by judgement: `data/sources/**` is gitignored (`.gitignore:37-48`) so
Git sees nothing, no database is contacted, and every byte is re-adjudicated in Step 3 against
**this** worktree's tracked manifests — fitzRoy by `manifest_sha256` + `artefact_set_sha256` +
per-file sha256/columns/row-count over all 131, DraftGuru by manifest counts + all 42 raw sha256 +
a full re-parse whose `discover_years` refuses any stray file (runbook §24.5). A partial, stale or
polluted copy therefore **fails closed in Step 3 rather than corrupting a rebuild**.

The block reads both labels out of tracked source rather than typing them — the fitzRoy label from
the single `acceptance_status: accepted` baseline in `data/reference/fitzroy-accepted-baselines.json`
(`:57-64`), the DraftGuru label from `draftguruLabel` in `tools/db/rebuild-test.ts:1124` — so it
cannot copy a label the rebuild will not ask for. It **refuses before copying anything** if either
destination already exists, if either source directory is missing, if either source file count is
not its measured value, or if the promoted ladder witness is not present with its 129 files. It
copies **exactly those two directories, whole**, touches no manifest, contract, tracked file,
database or Git, and never names `ladder-20260828` except to measure it before and after.

### 2r. Pass 19 — the Step 2 copy SUCCEEDED; the three Step 3 validators, from current source

Pass 19 performed **no copy, no acquisition, no hashing, no file move/rename/delete, no database
access, no Git command, no network call and no production access**, and changed no Coleman
implementation, no accepted manifest and no contract. It recorded the operator's Step 2 result and
prepared §5 Step 3.

**1. The operator's Step 2 result — SUCCEEDED on every line.**

| Phase | Reported |
|---|---|
| labels | read from tracked source — fitzRoy `full-history-20260827`, DraftGuru `annual-html-20260826` |
| sources (`D:\dev\afldb`) | fitzRoy **131** files; DraftGuru **90** files |
| ladder witness before | **129** files |
| copies | fitzRoy **131** → `D:\dev\afldb-issue-102\data\sources\afltables\fitzroy_core\full-history-20260827`; DraftGuru **90** → `…\data\sources\draftguru\annual-html-20260826` |
| probe | `player_stats_1897.csv` SHA-256 **MATCHES** the tracked manifest |
| ladder witness after | **129** files, unchanged |
| labels present | `fitzroy_core`: `full-history-20260827`, `ladder-20260828`; `draftguru`: `annual-html-20260826` |

No `REFUSED` line, no `REFUSED after copy` line, no post-copy count mismatch. No database was
contacted, no Git command run, no production accessed, and no tracked manifest or contract changed.

**2. What this settles.** `data/sources/` now holds **exactly the three prerequisite snapshots and
nothing else** — the shape §2q predicted (131 + 90 new files, the ladder's 129 untouched). The
pass-9 refusal (`snapshot file missing: …full-history-20260827\player_stats_1897.csv`, §2h) cannot
recur for the same reason. **G7's snapshot prerequisite is CLEARED.** The probe hash is a smoke
check proving **1 of 131 files**; it is not evidence about the snapshot, and nothing here is taken
as adjudication — Step 3 is the proof.

**3. Step 3 — the three offline validators, and what each actually proves (read from current
source this pass).** All three resolve their inputs from the repository root, not the working
directory (`import_fitzroy_core.py:84-95`, `import_draftguru.py:53-73`), so the block still runs
from `D:\dev\afldb-issue-102`. None opens a database connection or a socket on the validate path.

| # | Validator | What it re-derives | Where |
|---|---|---|---|
| 1 | `import_fitzroy_core.py --label full-history-20260827 --validate-only --require-accepted-baseline` | every one of the 131 artefacts re-hashed against the manifest (`validate_snapshot:930-938`); `--require-accepted-baseline` implies `--require-full-history` (`:2681`), so the full-history gates re-derive range, datasets, per-season coverage and identity coverage from the CSVs (`enforce_full_history:802-879`); the acceptance binding re-checks the manifest SHA-256, the `artefact_set_sha256`, the artefact count, the acquired row total, both contract versions, the required range/datasets and the pinned fitzRoy version (`verify_accepted_binding:531-591`); then every measured drift gate must equal the register exactly (`enforce_accepted_fingerprint:594-632`). Returns 0 at `:2804-2807` | `tools/migration/import_fitzroy_core.py` |
| 2 | `validate_ladder_witness.py --label ladder-20260828` | the same argv the rebuild re-runs at `rebuild-test.ts:1117-1120`: witness binding, manifest shape, all 129 raw artefacts (bytes, the exact eight columns, per-season row counts) and historical identity resolution. `--compare` is deliberately **not** passed, so section 5 (the `club_seasons` cross-check, the only database-touching part) never runs | `tools/rebuild/fitzroy/validate_ladder_witness.py:354-402` |
| 3 | `import_draftguru.py --validate-only` | Phase A in full, with no psycopg import on that path (`:927-931`): the Stage A manifest's `total_rows`/`distinct_player_url_count` must equal `EXPECTED_ROWS 6810` / `EXPECTED_PERSONS 5057` (`:198-204`); every raw year page re-hashed against the manifest (`verify_raw_bytes:208-226`); a full re-parse through the tested `parse_draft_snapshot`, whose built `picks`/`persons` must again equal 6810 / 5057 (`:447-450`); the tracked six-decision ledger and the event-kind contract are loaded and checked. The label defaults to `STAGE_A_LABEL = 'annual-html-20260826'` (`:68`, `:899`), so no label is typed | `tools/rebuild/draftguru/import_draftguru.py` |

**4. Why one fail-stop block rather than three prompts.** The three are independent adjudications of
three independent snapshots, they contact nothing, and each is cheap relative to the rebuild. Run in
sequence with `return` on the first non-zero exit, the first failure is the one reported, un-obscured
by a later validator's output — which is the whole point of running them before Step 4 destroys
anything. The block also refuses **before running any validator** if any of the three snapshot
directories is absent or does not hold its expected file count, so a partial Step 2 is named as
such rather than surfacing as a mid-validator traceback.

**5. Failure shapes, and what each would mean.** Report verbatim; change nothing.

- **Validator 1, `SHA-256 mismatch` on a named file** — the copied bytes are not the accepted
  snapshot. Report the filename. Do not re-copy over it, do not edit the manifest or the register.
- **Validator 1, `accepted baseline … no longer matches the acceptance record`** — a binding, not a
  byte, problem: the manifest file's own hash, the artefact-set digest, a contract version or the
  fitzRoy pin has drifted. The ISSUE-108/114 line-ending class is already repaired here — the
  register carries the canonical LF hash `a42c6d5f…21d09` and `.gitattributes` forces
  `docs/rebuild-manifests/** text eol=lf` — so a hash mismatch now would be new information.
- **Validator 1, `has drifted from its measured fingerprint`** — the snapshot, the contract or the
  importer's transformations changed since acceptance. Re-acceptance is an ISSUE-093/101 decision,
  outside ISSUE-111. Never edit the register to fit.
- **Validator 2, `FAILED: n check(s)` (exit 1) or `REFUSED:` (exit 2)** — after a 129/129
  adjudication and a 26/26 pass in Step 1f this would be genuinely new. Report the named checks.
  Never re-point it at a temporary label and never use `--contract`/`--manifest-dir` to make
  anything pass.
- **Validator 3, `REFUSED: …` (exit 1)** — a manifest count, a raw-page hash, a stray file in
  `raw/years/` (`discover_years` refuses one), a parse count or a ledger check. Report it; do not
  prune, re-copy or edit any contract.

### 2s. Pass 20 — Step 3 PASSED (3 × exit 0); the Step 4 rebuild contract, from current source

Pass 20 **ran no command**: no database, no network, no Git, no production, no snapshot byte
copied/moved/renamed/hashed/deleted, and no Coleman implementation, manifest or contract changed.
It recorded the operator's Step 3 result and prepared §5 Step 4 by reading current source.

**1. The operator's Step 3 result — three validators, three exit 0.**

| # | Validator | Reported |
|---|---|---|
| — | inventory | fitzRoy **131**, ladder **129**, DraftGuru **90** — the three `present` lines, no `REFUSED` |
| 1 | fitzRoy `full-history-20260827` | scan summary exactly as predicted (`matches 16838`, `matches_with_player_rows 16838`, `attendance_known 15187`, `players 13275`, `players_with_dob 855`, `players_with_dob_conflict 0`, `player_match_rows 685471`, `venues 52`, `seasons 1897-2025`, `brownlow_round_vote_rows 320861`); `full-history gates PASSED — identity coverage` (`rows 685473`, `missing_id 83`, `missing_url 0`, `malformed_url 0`, `distinct_ids 13270`, `distinct_urls 13275`); `accepted canonical baseline VERIFIED` (`a42c6d5f…21d09`, `8e14ce61…f4125`, `raw_artefacts 131`, `acquired_rows 719042`, `contract_version 1`); **20.8 s, no database access** |
| 2 | ladder `ladder-20260828` | **26 PASS / 0 FAIL**, accepted manifest binding PASS, exactly **129** files, manifest rows **1622**, every file SHA-256 matching, every row count/schema matching, coverage exactly `1897-2025`, all **1622** label-season pairs resolving, `All checks passed.` — and **no section 5** |
| 3 | DraftGuru `annual-html-20260826` | 42 year pages sha256 verified, `persons 5057`, `picks 6810`, `ledger 6`, `bridge 0`, `validate-only: every input check passed`, no database contacted |

**2. What this settles.** These are the *same three checks* `runPreflight()` re-runs
(`rebuild-test.ts:1077-1113`: `fitzroyValidateArgv` with `--require-accepted-baseline`, the
DraftGuru tracked-file existence list plus `draftguruValidateArgv()` and `assertDraftguruPreflight`,
then `ladderWitnessValidateArgv()`), so the pass-9 refusal class is adjudicated rather than assumed
away. **The input prerequisite is closed. G7 is now blocked on nothing but execution.** Nothing here
is evidence about the Coleman derivation — that is what Step 4 measures.

**3. The Step 4 environment, verified in current source.** The harness reads exactly these, in this
order, and every one of the checks below happens **before** anything is destroyed:

| Requirement | Where it is enforced | Consequence if wrong |
|---|---|---|
| `AFLDB_TEST_DATABASE_URL` set and a valid URL | `resolveTarget:186-198` | `REFUSED`, nothing destroyed |
| its database is `afldb_test` | `assertRebuildTargetName:153-176` — rejects the forbidden list, anything matching `/prod/i`, anything not ending `_test`, anything but `SUPPORTED_TARGET`, and any `*pre_rebuild*` | `REFUSED`, nothing destroyed |
| `AFLDB_TEST_IMPORT_DATABASE_URL` set, naming the **same** database | `resolveTarget:205-226` | `REFUSED` (or an explicit owner substitution only under `--allow-owner-import-dsn`, which we do **not** pass) |
| **the import DSN's ROLE is `afldb_import`** | **nowhere in the harness** — it compares database names only | this is why the Step 4 block proves the role itself, before running anything |
| `AFLDB_PYTHON` → an interpreter that exists | `resolvePython:389-394`, `runPreflight:1066-1075` | `REFUSED: No Python interpreter at …`, nothing destroyed |
| `psql` on `PATH` | `runPsql` (`tools/db/psql.ts`), used by the reset and by FINAL VALIDATION | the destructive reset stage fails **after** destruction — so prove it first |
| `--acknowledge-destroy afldb_test` | `assertDestructiveAcknowledgement:232-241`, consumed at `:1244` **after** `runPreflight` at `:1243` | `REFUSED`, nothing destroyed |

Two facts that shape the proof block:

- **`.env` never overrides the shell.** `main()` reads `D:\dev\afldb-issue-102\.env` itself with no
  dotenv dependency and assigns **only** keys not already present (`:1154-1162`,
  `if (!process.env[key.trim()])`). The Step 4 block therefore resolves both DSNs the same way —
  process environment first, `.env` only as a fallback — so what it proves is what the harness will
  use. It prints **database, role and host only**; a password is never read out of `UserInfo`.
- **No child can reach `afldb_dev`.** Every data stage is spawned with
  `env: { ...process.env, ...envOverlay }` (`:1176`) and `dataEnv = { AFLDB_IMPORT_DATABASE_URL:
  target.importDsn }` (`:402`), so the overlay **wins over any ambient development DSN**. Combined
  with the target-name gate, the only database this run can write is `afldb_test`.

**4. The Coleman evidence, reconfirmed from current source (not from the earlier passes' notes).**

| Claim | Verified at | Result |
|---|---|---|
| the stage exists, is a data stage, and runs the derived group only | `rebuild-test.ts:470-483` | `id: 'coleman'`, `name: 'COLEMAN — leading home-and-away goalkicker, derived'`, `argv: [python, 'tools/migration/import_awards.py', '--groups', 'coleman']`, `envOverlay: dataEnv` |
| **stage order** | `planStages:406-507` | `precheck → recreate → migrations → privileges → reference → fitzroy → draftguru → derived → **coleman** → ladder-witness → fingerprints` — after `derived` (so `seasons.status` is computed before the completed-season rule reads it) and before `LADDER WITNESS` and FINAL VALIDATION |
| the first canonical load **INSERTS** | `planStages` has no awards stage at all; `import_coleman:1220-1231` reloads by `(source_id, source_record_id)` scoped to `award_id` **and** `source_id = afltables` | a canonically rebuilt `afldb_test` holds **no** `awards` row and **no** `award_winners` row, so the scope is empty and every winner is an INSERT: expect **0 updated / 46 inserted / 0 deleted**, not the 46-updated first-load signal that belongs to the legacy→derived transition on an already-populated database |
| the award definition is created here for the first time ever | `coleman_award_id:1143-1175` | create-if-missing branch (deviation (a)); `AWARD_DESCRIPTIONS['coleman']`, `category 'award'`, `first_season`/`last_season` from `min`/`max` of the derived winners |
| **the span is read, never hard-coded** | `colemanFirstSeason:704-718` reads `data/reference/coleman-derivation.json` (**`first_season: 1980`**, `:7`) and **refuses** rather than guessing; `colemanChecks:731-735` takes `acceptedLastSeason = Number(measured.seasons_last)` from the accepted register `data/reference/fitzroy-accepted-baselines.json` (**`seasons_last: 2025`**, `:118`) | `span = 2025 − 1980 + 1 = **46**` — a computed contract value, not an assumption |

**5. The exact Stage-9 Coleman gate values** (`colemanChecks:731-782`, emitted by
`buildFinalValidationSql:855-877` as
`WARNING:  AFLDB-FINAL-VALIDATION <key> = <actual> (expected <n>)`):

| Gate | Expected | Fails when |
|---|---|---|
| `coleman_rows` | **46** | the derived family is not one row per declared season |
| `coleman_seasons` | **46** | a season carries two rows (a tie) or none |
| `coleman_first_season` | **1980** | the span filter did not bind from the contract |
| `coleman_unlinked_rows` | **0** | a derived row is not born linked |
| `coleman_rows_not_derived_from_afltables` | **0** | something other than the derivation wrote a Coleman row |
| `coleman_rows_keyed_on_a_numeric_id` | **0** | a key matches `^coleman:[0-9]{4}:[0-9]+$` — the rejected `players.id` form |
| `coleman_after_accepted_last_season` | **0** | a winner exists beyond 2025 |

**6. Failure classification for Step 4 — four classes, three of which destroy nothing.**

1. **PRECHECK refusal, BEFORE destruction.** Printed as `REFUSED: <message>`, exit 1, and — for a
   target/argument refusal — before the banner is even written (`:1218` follows `:1165-1166`).
   Shapes: `Unknown argument`, `AFLDB_TEST_DATABASE_URL is not set / is not a valid connection URL`,
   `Refusing to rebuild '<db>'…`, `AFLDB_TEST_IMPORT_DATABASE_URL …`,
   `No Python interpreter at '…'`, `fitzRoy preflight failed`, `DraftGuru preflight …`,
   `Ladder witness preflight failed`, and `This rebuild DROPS every table … Re-run with
   --acknowledge-destroy afldb_test`. **`afldb_test` is intact; nothing is lost.** Fix the named
   input and re-run. After Step 3's three exit-0 results, a preflight refusal here would be new
   information — report it verbatim.
2. **A stage BEFORE `coleman` fails** (`recreate`, `migrations`, `privileges`, `reference`,
   `fitzroy`, `draftguru`, `derived`). Printed as `    FAILED: <id> exited <n>` then
   `REBUILD FAILED at stage '<id>'.` and `Not run: coleman, ladder-witness, fingerprints`, exit 1.
   `afldb_test` is destroyed and partially rebuilt — expected and recoverable by re-running, and
   **not ISSUE-111 work**: report it and stop rather than repairing another subsystem inside this
   issue.
3. **The `coleman` stage fails.** `    FAILED: coleman exited <n>`,
   `REBUILD FAILED at stage 'coleman'.`, `Not run: ladder-witness, fingerprints`. This is the first
   execution of both the stage and `coleman_award_id()`'s create-if-missing branch, so the traceback
   is genuine new information. Sub-shapes: the award-definition INSERT (deviation (a)); a G5a
   identity refusal (*"will not fall back to players.id"*, *"Nothing has been written."*); the
   per-run NULL-goals guard (deviation (e)) — a real fitzRoy-import finding, not a Coleman defect;
   or `coleman-derivation.json` failing to load. **Report the traceback; change no Coleman code,
   contract, gate or test to get past it.**
4. **A final Coleman GATE mismatch.** Every data stage succeeded and FINAL VALIDATION collects
   **all** failures before raising: `ERROR:  AFLDB-FINAL-VALIDATION FAILED: coleman_rows: got 45,
   expected 46; …`, then `FAILED: FINAL VALIDATION did not pass (psql exited <n>)` and
   `REBUILD FAILED at stage 'fingerprints'.` The database exists but does not match the accepted
   contracts, so **the rebuild is FAILED, not "passed with a caveat"**. `coleman_rows 45` means
   `rebuild_derived.py`'s `season_metadata` left 2025 `in_progress` and the completed-season rule
   worked exactly as declared — report the gate line and the season's status; **never relax the
   gate**. Interpretations for the other six are §6.

### 3. The five implementation deviations, with their direct-source justification

Each of these was reported to the operator during the session. Preserve the justification —
it is the evidence, not an opinion.

**(a) The Coleman award definition is CREATE-IF-MISSING.**
The handoff's original note said to leave the definition to the legacy group and to
`AFLDB-ISSUE-112`. That is preserved in a legacy-loaded database: `coleman_award_id()` returns
an existing definition untouched and contains **no `UPDATE awards`** and no
`ON CONFLICT (slug) DO UPDATE`. But handoff item 14 requires a canonical-rebuild stage, and
`planStages()` in `tools/db/rebuild-test.ts` has **no awards stage at all** — the stage list is
`precheck, recreate, migrations, privileges, reference, fitzroy, draftguru, derived,
ladder-witness, fingerprints`. So in a canonical rebuild the `awards` table would hold no
`coleman` row, and `award_winners.award_id` is `NOT NULL REFERENCES awards(id)`
(`src/db/migrations/005_brownlow_awards.sql:80`) — the derived winners would have no parent and
the stage could not run. Create-if-missing is the smallest change that makes both paths work
without taking ownership of the definition. **This is a gap in the original plan, not a
contradiction of its measured evidence.**

**(b) The rebuild stage runs after `derived`, not immediately after `fitzroy`.**
The handoff said "after FITZROY"; that is satisfied, but it is not sufficient. The
completed-season rule reads `seasons.status`, and `seasons.status` is written by
`tools/migration/rebuild_derived.py`'s `season_metadata` target (`REBUILDS["season_metadata"]`,
which sets `'in_progress'` / `'complete'`). `src/db/migrations/015_brownlow_grain_and_coverage.sql:54`
declares the column `season_status NOT NULL DEFAULT 'complete'`. Placing the Coleman stage
before `derived` would therefore read a **default** rather than a computed status and could name
a winner for a season still being played. The same reasoning moved the Coleman pass after
`rebuild_derived.py` in `docs/deployment.md` §7 (where it is run a second time, deliberately —
the reload is keyed and idempotent, so repeating it costs one query and removes the hazard).

**(c) The goal total is stored in `note`; `votes` remains NULL.**
Design §7.1.3 left `votes` to the derived loader without saying what to write.
`src/app/awards/[slug]/page.tsx:376` labels that column **"Votes"** in the rendered table
(`{ key: 'votes', label: 'Votes', … }`), and `:129` shows the column only when some winner has a
non-NULL value. A goal total is not a vote total, so writing it there would mislabel the fact in
the UI. The total is recorded in `award_winners.note`, which design §6 already names as the home
for the derivation's character.

**(d) `club_name_raw` remains NULL.**
Every other awards loader stores the source's own club spelling. This derivation has none: the
club is a canonical `club_id` computed from `DISTINCT player_match_stats.club_id` over the
winner's own home-and-away match rows, not a name read from a source. Writing a manufactured
name would assert a source string that does not exist.

**(e) A per-run NULL-goals guard was added (`COLEMAN_NULL_GOALS_SQL`).**
Design §2.3 frames zero NULL home-and-away goals as *"a pre-flight invariant, not an
assumption"*. `player_match_stats.goals` is `smallint`, **nullable**
(`src/db/migrations/004_player_match_stats.sql:33`), and `SUM()` skips NULLs, so one unrecorded
row would silently understate a season total. The guard counts NULL-goals rows in exactly the
derivation's own scope and refuses the load. G1 measured **0** such rows, so it should never
fire; if it does, that is real information rather than a nuisance.

### 4. Two further facts the next session must not rediscover

1. **The loader is deliberately split** into `build_coleman_winners()` — pure key composition and
   the fail-closed identity contract — and `derive_coleman_winners()` — the query plus the
   NULL-goals guard. The DB-free suite drives the pure half over synthetic rows through a Python
   subprocess, which is how the three identity refusals are tested with no database at all. Keep
   that split; the tests depend on it.
2. **`tests/coleman-derivation.test.ts` asserts against the Python SOURCE TEXT** in places (the
   `between()` slices `colemanGroup` and `transition`). Re-wrapping a Python string literal
   across lines can break such an assertion without breaking the loader. When one fails, check
   whether the *assertion* or the *code* is wrong before changing behaviour.

---

## Confirmed G0 — Coleman historical span

Measured read-only by the operator, 2026-08-30, against `afldb_dev`.

- `awards.slug = 'coleman'`; `awards.first_season = 1980`; `awards.last_season = 2025`
- **46 winner rows**; `min(season) = 1980`; `max(season) = 2025`
- **exactly one legacy winner row per season, 1980–2025 inclusive, no gaps**
- one row has `player_id IS NULL` (the 1982 row)

**Decision: the derived span begins 1980.** Do **not** backfill 1955–1979. Do **not** extend to
1897 merely because `goals` coverage reaches it. The tracked contract must record
`first_season = 1980` and state that this **preserves AFLDB's measured legacy award contract** —
not an external claim about when the medal began.

## Confirmed G1 — H&A goal completeness

- `player_match_stats` rows: **341,981**
- matches: **7,941**
- seasons: 1980 – 2025
- `goals IS NULL`: **0**
- seasons containing any NULL-goals row: **0**

## Confirmed G3 — independent derivation vs legacy

- MATCH **45** · DERIVED_ONLY **1** · LEGACY_UNLINKED **1** · **LEGACY_ONLY 0**
- Both exceptional rows are the **same 1982 winner**.
- Legacy: `award_winners.id = 9441`, `player_id NULL`, `link_status_value 'implausible'`,
  `source = draftguru`, `source_record_id = 'coleman:1982:537'`, `club_id = 115` (North Melbourne),
  `player_name_raw = 'Malcolm Blight'`.
- Derived: `player_id = 1534` (Malcolm Blight), **94** H&A goals.
- **Conclusion: no football-semantic winner-set disagreement.** Do not raise a `data_issues` row.

## Confirmed G4 — club semantics

- All **45** linked historical winners represented **exactly one** H&A club that season.
- All 45 legacy `club_id`s were present and matched. Zero multi-club winners. Zero mismatches.
  Zero NULL `club_id` among linked winners.
- **Forward rule:** `DISTINCT pms.club_id` over the winner's qualifying H&A matches — exactly one
  → persist it; more than one → persist **NULL**.
- **Do not invent** most-games / most-goals / final-club / first-club / current-club / ordinal.
- `award_winners.club_id` is nullable (migration 005) and `src/db/queries/awards.ts` LEFT JOINs it
  and renders `clubName` nullable — NULL is schema-legal and consumer-safe.
- **A synthetic multi-club fixture is required**, since history supplies no real case.

## Confirmed G6 — human-decision evidence

Measured read-only with role `afldb_import` inside `BEGIN TRANSACTION READ ONLY`.

- `player_link_resolutions` **exists and is readable**. An earlier `information_schema` query as
  `afldb_app` appeared to show it missing — that was **privilege visibility, not absence**.
  Migration 056 creates it, 067 extends it, 068 grants SELECT to `afldb_import`. Columns:
  `id, target_table, target_id, action, player_id, previous_status, admin_user_id, note,
  created_at, match_method, match_score, algorithm_version`. **Do not repeat the false conclusion
  that the table is absent.**
- Coleman `linked` decisions: **0**. `confirmed_unlinked`: **0**. Total Coleman resolution rows:
  **0**. Rows for `target_table='award_winners', target_id=9441`: **0**.
- No human Coleman resolution requires migration.

---

## G5 final decision — RESOLVED

**`players.id` is NOT rebuild-stable.** `AFLDB-ISSUE-108` §9.4, re-verified in source: a canonical
rebuild **re-seeds** `players.id`; `tools/migration/import_fitzroy_core.py` inserts with no
`legacy_player_id` and resolves identity by AFL Tables profile URL. `coleman:<season>:<player_id>`
is therefore **rejected**.

**The canonical rebuild's durable identity is the AFL Tables profile URL.**
`data/reference/fitzroy-accepted-baselines.json`, `identity_scan.$comment`, verbatim: *"Canonical
identity is the AFL Tables profile URL. The fitzRoy numeric ID is optional…"*. Measured in the
accepted baseline: `missing_url = 0`, `malformed_url = 0`, `distinct_urls = 13,275`,
`measured.players = 13,275` → **exactly one profile URL per player, none missing**.
`missing_id = 83` → **the numeric id is unusable**.

**Where it is persisted:** `external_identities`
(`src/db/migrations/002_core_entities.sql:178-194`) with `match_method = 'afltables_profile_url'`,
`status = 'unique'`, `external_id` = the **normalised** path (e.g. `players/B/Malcolm_Blight.html`),
under `external_identities_uq UNIQUE (source_id, external_id)`. Normalisation is
`normalise_profile_url()` (`import_fitzroy_core.py:242-252`), whose docstring states it mirrors
`enrich_birth_dates.py` so both writers agree on the form. Release gates already pin this:
`tests/integration/release-gates.test.ts:748-780` — 13,275 unique profile-URL identities, and
**zero** `external_id` values matching `^[0-9]+$`.

### Chosen `source_record_id`

```
coleman:<season>:<normalised AFL Tables profile path>
```
Example: `coleman:1982:players/B/Malcolm_Blight.html`

Why it survives:
- **repeated reloads** — the key is identity, not position; `reload_keyed` matches and UPDATEs in
  place, preserving surrogate ids
- **ties** — tied winners are different people → different paths → distinct keys; a tied set
  changing size moves no surviving row's key (the defect that killed the ordinal option)
- **canonical rebuild / id reseed** — the profile URL is exactly what the rebuild resolves identity
  by
- **display-name changes** — `players.display_name` is not in the key; the path comes from AFL
  Tables and the accepted baseline is hash-frozen

**`reload_keyed` compatibility:** `award_winners.source_record_id` is `text`, unbounded
(migration 005); `_key_match` compares as text. Uniqueness holds under both
`award_winners_source_uq (source_id, source_record_id)` (migration 042) and
`uq_award_winners_source (award_id, source_record_id) WHERE source_record_id IS NOT NULL`
(migration 023).

**No network access required** — read from `external_identities` in the same database.

**Hashing rejected.** Every row key in this repository is readable (`22under22:2012:b:1`,
`fkg-017`, `season=YYYY;round=NN`). A hash costs auditability and buys nothing on a short `text`
column. ISSUE-108's digest was a *test baseline*, not a row key.

**Escaping:** compose from the **already-normalised** path only, never a raw URL. Following the
`AFLDB-ISSUE-100` delimiter-refusing precedent, **refuse** (do not sanitise) if a normalised path
contains the `:` separator. AFL Tables paths do not — this is a fail-closed guard.

### Remaining risk — G5a, a required pre-flight

Coverage is total in a canonically rebuilt database, but `afldb_dev` is legacy-loaded and its
profile-URL population was written by `enrich_birth_dates.py` — `AFLDB-ISSUE-090` measured
**12,472** there against the canonical **13,275**. **The loader must fail closed** when a winner
has no `afltables_profile_url` identity with `status IN ('unique','resolved')`, and must **never**
fall back to `players.id`, the fitzRoy numeric id, or a name. The G5a SQL is in
`issues/open/AFLDB-ISSUE-111.md` §5.5; `missing_identity` must be **0**.

---

## Legacy-to-derived transition — RESOLVED: rekey in place (model A)

**No row is deleted. All 46 `award_winners.id` values are preserved, including 9441.**

- **Current ownership:** `source_id = draftguru`, `source_record_id = 'coleman:<season>:<int>'`.
- **Future ownership:** `source_id = afltables`, `source_record_id = 'coleman:<season>:<path>'`.
- **Why a transition is mandatory:** `reload_keyed` matches only within its ownership scope. Left
  alone, the derived loader would see an empty `afltables` scope, **INSERT 46 new rows** and leave
  the legacy 46 — **92 Coleman rows**, silently duplicated. Neither uniqueness constraint stops it,
  because the two keys differ.
- **Precedent:** `tools/records/import-first-kick-goal.ts` `--rekey` (`:312-411`) — exact 1:1
  preflight that writes nothing unless every count reconciles; retry-safe by state (all-legacy →
  rekey; all-new → verify and no-op; **mixed → abort**); mutation is `UPDATE … WHERE id = <rowId>`
  in a single transaction, reporting *"every surrogate id is unchanged"*. Coleman adds `source_id`
  to what changes; `afldb_import` holds full DML on `award_winners` (seeded
  `import_writable_tables`, migration 045), and `player_link_resolutions.target_id` is deliberately
  **not** a foreign key.

### Three steps

**1. Stop the legacy group producing Coleman.** `import_awards.py:417-420` already excludes awards
owned by another group via `other_group_awards` + `scope_column="award_id", scope_exclude=True`.
**Add the Coleman slug to that tuple** — the exact mechanism `under_22` uses. After it the legacy
`awards` group can never insert, update or delete a Coleman winner again.
*Note:* the `coleman` **award definition** row still comes from the legacy group and already
carries 1980–2025. Leave it; `AFLDB-ISSUE-112` owns definitions.

**2. One-time rekey.** Fail-closed preconditions: exactly **46** rows in `award_id = coleman`
scope; all owned by `draftguru` (mixed → abort); all keys in the legacy form; seasons 1980–2025 one
each with no gaps; Coleman `player_link_resolutions` count **still 0** (re-verify at run time);
every row bridges 1:1; no target key already present. Bridge by **`(award_id, season)`** — safe
because G0 measured one legacy row per season with no gaps and G3 measured `LEGACY_ONLY = 0`.
Mutation, one transaction: `UPDATE award_winners SET source_id = <afltables>, source_record_id =
<derived key> WHERE id = <rowId>`. **Only those two columns change** — facts are left to the loader,
so the transition moves ownership without asserting data.

**3. First derived load.** Rows are now in scope; `reload_keyed` matches and UPDATEs in place.
**Expected: 46 updated, 0 inserted, 0 deleted** — that report is the acceptance signal. Any insert
or delete means the bridge was wrong.

### Expected before/after

| | Before | After rekey | After first load |
|---|---|---|---|
| Coleman rows | 46 | 46 | **46** |
| row ids (incl. **9441**) | A…Z | **identical** | **identical** |
| `source_id` | `draftguru` ×46 | `afltables` ×46 | `afltables` ×46 |
| `source_record_id` | `coleman:YYYY:<int>` | `coleman:YYYY:<path>` | unchanged |
| `player_id IS NULL` | 1 | 1 | **0** |
| `link_status_value='implausible'` | 1 | 1 | **0** |
| `player_link_resolutions` | 0 | 0 | 0 |

### Isolation

Scoped to `award_id = <coleman>` **and** `source_id = <draftguru>`. Must not touch: non-Coleman
`award_winners`; `manual_admin_edit`/NULL-provenance rows; other `draftguru` families
(All-Australian, club B&F, named medals — ISSUE-112); `award_nominations`; `hall_of_fame`;
`honour_team_members`; `captaincies`; any Brownlow table (ISSUE-113). **A scope count other than
exactly 46 is a refusal, not a warning.**

### 1982 Malcolm Blight — exact treatment

`award_winners.id = 9441` is **preserved**. Rekey changes only `source_id`/`source_record_id`; the
first derived load then sets `player_id = 1534`, `link_status_value = 'resolved'`, `player_name_raw`
to the canonical display name, and `club_id` to North Melbourne (its sole qualifying H&A club — the
same club 115 the legacy row already carried).

This **overrides no human decision**: zero `player_link_resolutions` rows exist for 9441. The
legacy `implausible` status was an import-derived classification from the legacy name matcher, not
an admin judgement, so `reload_keyed`'s decision path is a no-op. `player_name_raw` will change
from the legacy spelling to the canonical display name — safe **only because there are no
decisions**; with one present, the name guard (`common.py:586-592`) would classify it discarded and
abort. **The preflight must re-verify the zero at run time rather than trusting this document.**

---

## Provenance contract

**Derived rows are stamped `source_id = afltables`** — the underlying canonical source of
`player_match_stats` (`import_fitzroy_core.py`, `SOURCE_KEY_AFLTABLES = "afltables"`).

**Proven precedent:** `AFLDB-ISSUE-095`'s `club_seasons` is derived entirely from canonical
`matches` and stamps `(SELECT id FROM sources WHERE key = 'afltables')`
(`tools/migration/rebuild_derived.py`, `REBUILDS["club_seasons"]`), having deliberately moved
provenance `sports_data_lab` → `afltables`. The convention is: **a derived row carries the
underlying canonical source of the facts it was derived from**, not a synthetic "derived" source.

- **`draftguru` is no longer claimed** — correctly, since the goals came from AFL Tables via
  fitzRoy, not from DraftGuru's award scrape. More honest, not a relabelling.
- **No new `sources` row → NO MIGRATION REQUIRED.** `afltables` already exists in
  `data/reference/sources.json`.
- **Ownership scope is exclusive**: no other `award_winners` writer uses `afltables` (the others
  use `draftguru`, `wikipedia`, `wikipedia_22under22`, `footywire`, `manual_admin_edit`).
- Use `require_source()` (`import_awards.py:261-275`) so a missing source fails closed.
- The **derivation character** is recorded in the tracked contract file and `award_winners.note`,
  never in a fabricated source identity.

**Tracked span declaration:** a new JSON contract under `data/reference/` (suggested
`coleman-derivation.json`) carrying `first_season: 1980`, the derivation method, a method version,
the tie rule and the club rule. `data/reference/` is correct **for this file** — ISSUE-112 rejects
that directory for honours *rows* because `load_reference_data.py` TRUNCATEs and has no
link-decision handling, but a contract declaration is never loaded into a link-target table, and
`data/reference/` is the established home for tracked contracts (`fitzroy-accepted-baselines.json`,
`stat-availability.json`, `source-families.json`). **Do not** add it to `load_reference_data.py`'s
`GROUPS` — the Coleman loader and the tests read it directly.

---

## Required implementation work — ordered

1. **Tracked span declaration** — create `data/reference/coleman-derivation.json` with
   `first_season: 1980`, derivation method, method version, tie rule, club rule, and a note that
   the boundary preserves AFLDB's measured legacy contract. Read by both loader and tests so a
   silent divergence is impossible.
2. **New group in `tools/migration/import_awards.py`** — add to `GROUPS` and `GROUP_ORDER`; do
   **not** create a new tool. Reuse `require_source`, `import_batch`, `set_reload_scope`,
   `ClubResolver`.
3. **Extend `needs_legacy` at `import_awards.py:1407`** so the Coleman group, like `under_22`, does
   not demand `AFLDB_LEGACY_SQLITE`.
4. **Derivation query** — `player_match_stats` ⋈ `matches`, `NOT m.is_final`, `sum(goals)` grouped
   by `(m.season, pms.player_id)`, per-season `max`, all tied players retained. **Never**
   `player_season_stats` (it includes finals and backs `getSeasonGoalkickers`).
5. **Completed-season filter** — exclude `seasons.status = 'in_progress'`; mirror
   `rebuild_derived.py`'s Brownlow `pending` treatment.
6. **Span filter** — from the tracked declaration, not a literal.
7. **G5a identity resolution** — join `external_identities` on
   `match_method='afltables_profile_url'` and `status IN ('unique','resolved')`; **refuse** on any
   missing identity; refuse if a normalised path contains `:`.
8. **Key composition** — `coleman:<season>:<normalised path>`; deterministic emit order
   (`season`, then path).
9. **Club logic** — `DISTINCT club_id` over qualifying H&A matches: one → that club; more than one
   → **NULL**.
10. **Provenance** — `source_id = afltables` via `require_source`; `import_batch_id` per run.
11. **`reload_keyed` call** — key `["source_id","source_record_id"]`; `scope_column="award_id"`
    (coleman) **and** `scopes=[("source_id",[afltables_id],False)]`; `delete_missing=True`.
12. **Exclude Coleman from the legacy `awards` group** — add the slug to `other_group_awards`
    (`import_awards.py:417-420`).
13. **One-time transition** — implement the rekey with the fail-closed preflight and three-way
    retry-safe state machine, modelled on `import-first-kick-goal.ts:312-411`.
14. **Canonical rebuild stage** — add to `tools/db/rebuild-test.ts` after FITZROY.
15. **Stage-9 gate** — Coleman row-count / season-span gate in FINAL VALIDATION, **only once the
    stage exists** (adding a gate before its data source would fail every rebuild — the
    `AFLDB-ISSUE-093` §H15.5 rule).
16. **Docs** — update `docs/deployment.md` §7 if the Coleman group changes the refresh sequence.

## Required tests

| Kind | Home | Cases |
|---|---|---|
| DB-free contract | new focused suite, `tests/under-22-importer.test.ts` mould | span read from the declaration; finals excluded; tie → N rows; key format; key contains no `players.id` and no display name; `:`-in-path refused; provenance is `afltables`, not `draftguru`; no legacy symbols in the loader |
| Integration — oracle (**G2**) | `tests/integration/awards-reload-links.test.ts` | an **independent** query shape reproduces the winner set exactly (ISSUE-103 oracle pattern) |
| Integration — tie fixture | same | synthetic two-tied-leader season → two rows, distinct deterministic keys |
| Integration — season boundary | same | the season before the declared first season yields **no** row |
| Integration — in-progress exclusion | same | an `in_progress` season yields no row |
| Integration — finals exclusion | same | a player whose finals goals would change the ranking does not change the winner |
| Integration — multi-club NULL | same | **synthetic** two-club winner → `club_id IS NULL` |
| Integration — identity refusal (**G5a**) | same | a winner with no profile-URL identity makes the loader refuse; no fallback |
| Integration — stable-ID reload (**G8**) | same | three reloads, byte-identical row-id fingerprint |
| Integration — transition preflight | same | all-`draftguru` → rekey 1:1; all-`afltables` → verify/no-op; **mixed → abort, nothing written**; unbridgeable season → abort |
| Integration — transition id preservation | same | all 46 ids incl. **9441** identical before/after transition **and** after first load |
| Integration — transition isolation | same | non-Coleman rows, `manual_admin_edit` rows and other `draftguru` families untouched |
| Integration — first-load signal | same | **46 updated / 0 inserted / 0 deleted** |
| Integration — manual link | same | a `linked` and a `confirmed_unlinked` decision both survive a reload; disagreement reported |
| Integration — no-decision regression | same | Coleman `player_link_resolutions` count 0 before and after |
| Rebuild | `tests/db-test-rebuild.test.ts` | new stage present, correctly ordered, **no legacy reference** (`:716` must still pass) |
| Role parity | integration | importer spawned under restricted `afldb_import` via `tests/integration/import-role-parity.ts` |

## Validation — where the next session starts

### 4a. Integration environment — REQUIRED, established by the pass-3 run

The suite is skipped, not failed, when its Python cannot import psycopg, so getting this wrong
looks like success. Set it explicitly.

- **`AFLDB_PYTHON`** is the variable the harness reads
  (`tests/integration/awards-reload-links.test.ts:54`). **Not `PYTHON`.**
- The proven interpreter is the worktree-local virtualenv:
  `D:\dev\afldb-issue-102\.venv\Scripts\python.exe`, carrying **psycopg 3.3.4**.
- The harness's own fallback probe is `.venv/bin/python` — the POSIX layout, which does not
  exist on Windows. **On Windows `AFLDB_PYTHON` is mandatory.** Recorded as a follow-up
  observation (§7a); deliberately not fixed inside the G2 slice.
- Proven database targets, checked immediately before the pass-3 run:
  - `AFLDB_TEST_DATABASE_URL` → `afldb_test | afldb_owner`
  - `AFLDB_TEST_IMPORT_DATABASE_URL` → `afldb_test | afldb_import`

Both must name the same `_test` database; the second must authenticate as `afldb_import`.

### 5. THE EXACT NEXT COMMAND (operator-run)

**The integration suite is COMPLETE and GREEN — 29 of 29 in pass 8.** Do not re-run it as the
next step, and do not re-run the DB-free suites: passes 2–8 changed only the integration test
file, which none of them loads, and pass 8 changed no code at all.

The remaining gate is **G7, item 17 — the canonical rebuild**. It was attempted in pass 9 and
**REFUSED in the fitzRoy preflight** (§2h): this worktree holds no acquired snapshot bytes.
**Do NOT re-run the rebuild until the prerequisite below is satisfied and proven offline**, and
do not weaken the preflight or touch the Coleman implementation to get past it.

**Step 1 — DONE (pass 10).** The read-only inventory found fitzRoy `full-history-20260827`
(131 files, probe hash **matching**) and DraftGuru `annual-html-20260826` (90 files, which is the
**expected** count — §2i.1) in `D:\dev\afldb`, and the ladder witness `ladder-20260828` in
**neither** checkout. **Do not re-run it.**

**Step 1b — DONE (pass 11).** The operator's read-only machine search found **no `ladder_1897.csv`
and no `ladder*` directory anywhere under `D:\dev` or `D:\backups`**, and no alternate accepted
ladder snapshot in any sibling worktree. DraftGuru measured 42/42/2/4 = 90 with no strays, confirming
§2i.1. That is **§24.7 outcome 3: the accepted ladder bytes are not on this machine.** **Do not
re-run the search and do not re-investigate §2i/§2j.**

**Step 1c — RUN IN PASS 12, and it FAILED BOTH LEGS. Superseded by Step 1c-R below; do not re-run
it.** The block as written was:

```powershell
cd D:\dev\afldb-issue-102
'=== 1. R toolchain ==='
$rs = Get-Command Rscript -ErrorAction SilentlyContinue
if (-not $rs) { 'Rscript: NOT ON PATH' } else {
  'Rscript: ' + $rs.Source
  & Rscript -e "cat(R.version.string, '\n'); for (p in c('fitzRoy','jsonlite','digest','openssl')) cat(sprintf('%-9s %s\n', p, if (requireNamespace(p, quietly=TRUE)) as.character(utils::packageVersion(p)) else 'NOT INSTALLED'))"
}
'=== 2. adjudication target (tracked manifest) ==='
$m = 'docs\rebuild-manifests\afltables_fitzroy_core\ladder-20260828.json'
'computed: ' + (Get-FileHash $m -Algorithm SHA256).Hash.ToLower()
'expected: 70cc17768685a3140a428d3eef796bf465ae2fd9dca71a66684f248cdde8b6df'
'=== 3. snapshot working area + temp label availability ==='
$w = 'data\sources\afltables\fitzroy_core'
if (Test-Path $w) { 'labels present: ' + ((Get-ChildItem $w -Directory).Name -join ', ') } else { 'ABSENT (no snapshot bytes in this worktree)' }
'temp label free: ' + (-not (Test-Path 'docs\rebuild-manifests\afltables_fitzroy_core\ladder-recover-20260830.json'))
```

Result: `Rscript` resolved to `C:\Program Files\R\R-4.6.1\bin\Rscript`; the package probe died with
**`Segmentation fault`** and established no version; the manifest computed `604a8a16…8d3f`; the
working area was absent; the temp label was free.

**Both failures are adjudicated in §2k.** The `expected:` literal in section 2 was **wrong** — it was
the CRLF hash of the identical manifest. **`604a8a16…8d3f` is the correct value and the manifest is
intact.** Section 1's probe was too coarse to name its own crash, and its `requireNamespace()` loads
namespaces when only versions were wanted.

**Step 1c-R — DONE (pass 13), and it PASSED. Do not re-run it.** R 4.6.1 starts clean with and
without startup files; **fitzRoy is exactly 1.8.0**; `jsonlite 2.0.0` and `openssl 2.4.2` load;
`digest` is absent but not required; no probe crashed, so the pass-12 segfault was an artefact of the
combined probe. Probe E confirmed `raw bytes` = `lf re-enc` = `604a8a16…8d3f`. The block as run was
read-only; no network, no database,
no Git, no install, nothing written. Each probe is its **own process**, so a crash isolates instead
of masking the rest, and each reports its exit code (a Windows access violation is `-1073741819`).

```powershell
cd D:\dev\afldb-issue-102
'Rscript: ' + (Get-Command Rscript -ErrorAction SilentlyContinue).Source
function P($label, $rargs) { "--- $label ---"; & Rscript @rargs; "exit=$LASTEXITCODE" }

'=== A. bare start, NO startup files ==='
P 'vanilla-start' @('--vanilla','-e',"cat(R.version.string, '\n', R.home(), '\n')")

'=== B. bare start, normal startup files ==='
P 'default-start' @('-e',"cat(R.version.string, '\n')")

'=== C. versions from DESCRIPTION only — loads NO namespace ==='
P 'describe-only' @('-e',"cat(paste(.libPaths(), collapse=' | '), '\n'); for (p in c('fitzRoy','jsonlite','digest','openssl')) cat(p, tryCatch(as.character(utils::packageVersion(p)), error=function(e) 'NOT INSTALLED'), '\n')")

'=== D. ONE namespace load per process ==='
P 'load-jsonlite' @('-e',"loadNamespace('jsonlite'); cat('ok')")
P 'load-digest'   @('-e',"loadNamespace('digest'); cat('ok')")
P 'load-openssl'  @('-e',"loadNamespace('openssl'); cat('ok')")
P 'load-fitzRoy'  @('-e',"loadNamespace('fitzRoy'); cat('ok')")

'=== E. manifest hash confirmation (read-only) ==='
$p = 'docs\rebuild-manifests\afltables_fitzroy_core\ladder-20260828.json'
$sha = [System.Security.Cryptography.SHA256]::Create()
$hex = { param($b) ([BitConverter]::ToString($sha.ComputeHash($b)) -replace '-','').ToLower() }
'raw bytes : ' + (& $hex ([IO.File]::ReadAllBytes($p)))
$txt = [IO.File]::ReadAllText($p)
'lf  re-enc: ' + (& $hex ([Text.Encoding]::UTF8.GetBytes(($txt -replace "`r`n","`n"))))
'crlf re-en: ' + (& $hex ([Text.Encoding]::UTF8.GetBytes((($txt -replace "`r`n","`n") -replace "`n","`r`n"))))
```

**Reading the result.**

- **A crashes** → the R installation itself is broken. Nothing else in the block is meaningful. Do
  not touch packages; the install (or its sub-architecture launcher) is the subject.
- **A exits 0, B crashes** → a startup file (`~/.Rprofile`, `Rprofile.site`, `Renviron.site`) is
  implicated. There is **no `.Rprofile` in this repository**, so it is a user/R-home file. Run every
  later probe with `--vanilla` (noting `--vanilla` also drops `.Renviron`, so `.libPaths()` in C may
  shrink — compare C's output between modes before concluding a package is missing).
- **A and B exit 0, C prints four versions** → the prerequisite versions are **established without
  loading anything**. Read them: **fitzRoy must be exactly `1.8.0`**; `jsonlite` present; at least
  one of `digest`/`openssl` present.
- **Exactly one D probe crashes** → that package's compiled code is the crasher. If it is
  **fitzRoy**, the acquisition itself cannot run (`acquire_core.R:48` calls `library(fitzRoy)`), and
  the next question is that install — reported, not repaired on the spot.
- **All four D probes exit 0** → the original segfault was in the combined probe's own shape and the
  toolchain is usable; Step 1d is permitted once C's versions satisfy the gate.
- **E** should print `raw bytes` = `lf re-enc` = `604a8a16…8d3f` and `crlf re-en` =
  `70cc1776…8b6df`, confirming §2k on your own machine: one document, two line-ending renderings.
  If `raw bytes` differs from `lf re-enc`, the file carries a BOM or stray CR and §2k must be
  re-derived before anything else.

**Do NOT install, reinstall, update or remove any R package before reporting this output.** It would
destroy the evidence and could move fitzRoy off the pinned 1.8.0.

**What permits the acquisition step (Step 1d) — all four, exactly:**

1. `Rscript` starts (probe A, and B or `--vanilla`);
2. **`fitzRoy 1.8.0`** — any other version fails the contract pin (`acquire_core.R:76-87`) and must
   **not** be worked around with `--allow-version-mismatch` — **and its namespace must load**
   (probe D), because `acquire_core.R:48` does `library(fitzRoy)`;
3. `jsonlite` installed;
4. **`digest` or `openssl`** installed (at least one).

The manifest hash is already established: **`604a8a16…8d3f`**, the manifest is intact, and the temp
label is free. Any other result STOPS the sequence: report it rather than acquiring.

**AND, before Step 3 (not before Step 1d): `AFLDB-ISSUE-114` — NOW RESOLVED (pass 15).**
`fitzroy-contract.json:243` records the canonical LF hash
`604a8a162543e19060f426bd189222d32d07726a0b134bdf4f910175cb7a8d3f`, bound by a value assertion in
`tests/db-test-rebuild.test.ts`, and the operator's run is **214 passed, 0 failed**. The paragraph
below is the pre-repair statement of the problem, retained as lineage:

`fitzroy-contract.json:243` recorded the stale CRLF literal, so
`validate_ladder_witness.py --label ladder-20260828` fails its manifest-binding check on any LF
checkout **regardless of the ladder bytes** (§2k). Repairing that literal to
`604a8a162543e19060f426bd189222d32d07726a0b134bdf4f910175cb7a8d3f` is an operator decision on a
tracked integrity binding outside ISSUE-111's scope — **do not edit the tracked manifest, and do not
weaken or normalise the validator.**

**Step 1d — DONE (pass 16), and it SUCCEEDED. Do not re-run it.** The operator ran exactly the
command below and it produced **129 files, seasons 1897–2025, 1,622 rows**,
`acquisition_kind: validation_witness (ladder)`, `completeness: unvalidated`, and the temporary
manifest — the expected shape on every count (§2o.1). No database, no Git, no production. The
printed `validate_ladder_witness.py --label ladder-recover-20260830` line was correctly **not** run,
and nothing was copied, renamed, moved or deleted. **The bytes are UNTRUSTED until Step 1e
adjudicates them.** All four gate
conditions above are satisfied by measurement (pass 13), so this was permitted. One command, from
the repository root. It contacts **no database** (§2j.4), runs no Git, and writes nothing outside
`data/sources/afltables/fitzroy_core/ladder-recover-20260830/` and the one temporary manifest
`docs/rebuild-manifests/afltables_fitzroy_core/ladder-recover-20260830.json`. **Nothing is copied,
renamed, moved or deleted afterwards — adjudication is Step 1e, in a separate session:**

```
Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --label ladder-recover-20260830 --datasets ladder --from 1897 --to 2025
```

Expect 129 `wrote … ladder_<season>.csv (N rows)` lines for 1897–2025,
`completeness: unvalidated (the acquirer does not adjudicate)` with **no** "observations not
satisfied" line, `acquisition kind: validation_witness (ladder)`, `wrote
docs/rebuild-manifests/afltables_fitzroy_core/ladder-recover-20260830.json`, and
**`Acquisition complete: 129 file(s); 1622 total rows.`**

**Ignore the `Now validate independently: … validate_ladder_witness.py --label
ladder-recover-20260830` line the tool prints** (`acquire_core.R:513-515`). It is generic
witness-mode text and **cannot** be the adjudication here: `load_witness` derives the manifest as
`<manifest_dir>/<label>.json` and then checks the contract's accepted `snapshot_label` and
`manifest_sha256` (`validate_ladder_witness.py:138-143`), so a temporary label fails two
contract-binding checks by construction. Step 1e is the adjudication.

**Step 1e — DONE (pass 17), and it PASSED. Do not re-run it.** The operator ran exactly the block
below and it returned `expected=129 present=129 matched=129 missing=0 mismatched=0 unexpected=0`,
with proof 0 holding first (tracked manifest `Get-FileHash` = the contract's accepted
`manifest_sha256` `604a8a16…8d3f`, `snapshot_label ladder-20260828`) and the secondary diagnostic
agreeing (accepted rows 1622, candidate rows 1622). **VERDICT: RECOVERED — byte-for-byte identical to
the accepted `ladder-20260828` witness**, so no successor-witness decision arises and no binding
changes (§2p). Read-only: no database, no Git, no production, nothing moved, copied, renamed or
deleted. The block is retained below as the record of what was proven. **The bytes are now
ADJUDICATED and TRUSTED; the promotion is Step 1f.**

**Step 1e — THE CURRENT NEXT ACTION: adjudicate the candidate against the TRACKED manifest, before
anything is moved** (§2j.6, §2o). **Read-only: it hashes and reads, and writes, moves, copies,
renames and deletes nothing.** It contacts no database and runs no Git. It does **not** read the
candidate's own `ladder-recover-20260830.json` — a manifest the acquirer wrote over the bytes it had
just written is not authority (§2o.2):

```powershell
Set-Location D:\dev\afldb-issue-102
& {
  $contractPath = 'tools\rebuild\fitzroy\fitzroy-contract.json'
  $manifestPath = 'docs\rebuild-manifests\afltables_fitzroy_core\ladder-20260828.json'
  $candidateDir = 'data\sources\afltables\fitzroy_core\ladder-recover-20260830'

  # The ACCEPTED contract + the ACCEPTED manifest are the only authority.
  $accepted = (Get-Content $contractPath -Raw | ConvertFrom-Json).datasets.ladder.accepted_witness
  $manHash  = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLower()
  $man      = Get-Content $manifestPath -Raw | ConvertFrom-Json
  "accepted label           : $($accepted.snapshot_label)"
  "accepted manifest sha256 : $($accepted.manifest_sha256)"
  "tracked manifest sha256  : $manHash"
  "candidate directory      : $candidateDir"
  if ($manHash -ne $accepted.manifest_sha256.ToLower()) { 'STOP: tracked manifest does not match the accepted binding. Adjudicate nothing.'; return }
  if ($man.snapshot_label -ne $accepted.snapshot_label) { 'STOP: tracked manifest is not the accepted snapshot label.'; return }
  if ($man.files.Count -ne $accepted.files) { "STOP: tracked manifest lists $($man.files.Count) files; contract expects $($accepted.files)."; return }
  if (-not (Test-Path -LiteralPath $candidateDir -PathType Container)) { 'STOP: candidate directory not found.'; return }

  $expected = $man.files.Count
  $present = 0; $matched = 0; $rowsSeen = 0
  $missing = @(); $mismatched = @()

  foreach ($f in $man.files) {
    $p = Join-Path $candidateDir $f.filename
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { $missing += $f.filename; continue }
    $present++
    $actual = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower()
    $lines  = @(Get-Content -LiteralPath $p)
    $rows   = $lines.Count - 1
    $rowsSeen += $rows
    if ($actual -eq $f.sha256.ToLower()) { $matched++; continue }
    $mismatched += [pscustomobject]@{
      filename        = $f.filename
      expected_sha256 = $f.sha256.ToLower()
      actual_sha256   = $actual
      expected_rows   = $f.row_count
      actual_rows     = $rows
      header_matches  = (($lines[0] -replace '"','') -eq ($f.columns -join ','))
    }
  }

  $names      = @($man.files | ForEach-Object { $_.filename })
  $root       = (Resolve-Path -LiteralPath $candidateDir).Path
  $unexpected = @(Get-ChildItem -LiteralPath $candidateDir -Recurse -File |
                  ForEach-Object { $_.FullName.Substring($root.Length + 1) } |
                  Where-Object { $names -notcontains $_ })

  ''
  "expected   : $expected"
  "present    : $present"
  "matched    : $matched"
  "missing    : $($missing.Count)"
  "mismatched : $($mismatched.Count)"
  "unexpected : $($unexpected.Count)"
  ''
  "secondary diagnostic - accepted rows $($accepted.rows) / candidate data rows $rowsSeen"
  if ($missing.Count)    { ''; 'MISSING:';    $missing }
  if ($unexpected.Count) { ''; 'UNEXPECTED:'; $unexpected }
  if ($mismatched.Count) {
    ''; 'MISMATCHED (filename / expected sha256 / actual sha256):'
    $mismatched | Format-List filename, expected_sha256, actual_sha256, expected_rows, actual_rows, header_matches
  }
  ''
  if ($expected -eq $accepted.files -and $present -eq $expected -and $matched -eq $expected -and
      $missing.Count -eq 0 -and $mismatched.Count -eq 0 -and $unexpected.Count -eq 0) {
    'VERDICT: RECOVERED - byte-for-byte identical to the accepted ladder-20260828 manifest. Recovery MAY continue.'
  } else {
    'VERDICT: FAIL CLOSED - this is NOT the accepted witness. Move nothing, rename nothing, change no manifest or contract.'
  }
}
```

**ONLY this permits recovery to continue:**

```
expected=129  present=129  matched=129  missing=0  mismatched=0  unexpected=0
```

Then, and only then, the operator renames `ladder-recover-20260830` → `ladder-20260828`, deletes
`docs\rebuild-manifests\afltables_fitzroy_core\ladder-recover-20260830.json`, proves canonicity with
`validate_ladder_witness.py --label ladder-20260828` (26 PASS lines, exit 0), and proceeds to Step 2.
**Any other result fails closed** — §2j.8 / §25.8: nothing is moved, the accepted manifest, its
`manifest_sha256`, `accepted_witness` and `ladderWitnessLabel()` are never updated, the candidate is
deleted, and the differing filenames are reported. Adopting a successor witness is an operator
decision outside ISSUE-111's scope.

**Step 1f — DONE (pass 18), and it SUCCEEDED. Do not re-run it.** The operator ran exactly the block
below. Preconditions passed (accepted manifest `604a8a16…8d3f`, candidate 129 files); the rename
promoted the candidate to `data\sources\afltables\fitzroy_core\ladder-20260828` with **129 files**;
the temporary manifest was deleted and only it; the accepted manifest stayed present and unchanged;
and `validate_ladder_witness.py --label ladder-20260828` returned **26 PASS / 0 FAIL,
`All checks passed.`, exit 0**. **The ladder witness is CANONICAL in this worktree and G7's ladder
blocker is CLEARED** (§2q). Re-running the block now correctly refuses on its first precondition —
the canonical target exists — which is the guard working, not a fault. The block is retained below
as the record of what was run.

**Step 1f (retained record): promote the adjudicated candidate and prove it canonical.**
Permitted **only** because Step 1e returned `129 / 129 / 129 / 0 / 0 / 0` (§2p). One atomic operator
block. It contacts **no database and no network**, runs **no Git command**, and touches nothing
outside `data\sources\afltables\fitzroy_core\` and the one temporary manifest. `data/sources/**` is
gitignored (`.gitignore:37-48`) and `ladder-recover-20260830.json` is untracked, so Git sees nothing.

**Explicitly NOT touched:** `docs\rebuild-manifests\afltables_fitzroy_core\ladder-20260828.json`,
`tools\rebuild\fitzroy\fitzroy-contract.json`, every Coleman file, every migration, every test. The
block re-proves the first two are intact before it moves anything, and re-proves the accepted
manifest is still present and unchanged after.

It **fails closed before changing anything** if: the canonical target already exists; the candidate
directory is missing; the temporary manifest is missing; the accepted manifest or the contract is
missing; the interpreter is missing; the candidate no longer holds exactly its 129 adjudicated files;
the contract no longer accepts `ladder-20260828`; or the accepted manifest's SHA-256 no longer equals
the contract binding. The promotion is **one rename, not a copy**, so the adjudicated bytes cannot be
altered in transit, and the deletion names **only** the temporary acquisition manifest.

```powershell
Set-Location D:\dev\afldb-issue-102
& {
  $ErrorActionPreference = 'Stop'

  $root         = 'D:\dev\afldb-issue-102'
  $candidateDir = Join-Path $root 'data\sources\afltables\fitzroy_core\ladder-recover-20260830'
  $canonicalDir = Join-Path $root 'data\sources\afltables\fitzroy_core\ladder-20260828'
  $tempManifest = Join-Path $root 'docs\rebuild-manifests\afltables_fitzroy_core\ladder-recover-20260830.json'
  $acceptedMan  = Join-Path $root 'docs\rebuild-manifests\afltables_fitzroy_core\ladder-20260828.json'
  $contractPath = Join-Path $root 'tools\rebuild\fitzroy\fitzroy-contract.json'
  $validator    = Join-Path $root 'tools\rebuild\fitzroy\validate_ladder_witness.py'
  $python       = Join-Path $root '.venv\Scripts\python.exe'

  function Refuse($m) {
    Write-Host "REFUSED: $m"
    Write-Host 'Nothing was renamed, moved or deleted. No manifest or contract was changed.'
  }

  # ---- preconditions: every one fails closed BEFORE anything changes ----
  if (Test-Path -LiteralPath $canonicalDir) {
    Refuse "the canonical target already exists: $canonicalDir. Do not overwrite, merge or delete it."; return }
  if (-not (Test-Path -LiteralPath $candidateDir -PathType Container)) {
    Refuse "the adjudicated candidate directory is missing: $candidateDir"; return }
  if (-not (Test-Path -LiteralPath $tempManifest -PathType Leaf)) {
    Refuse "the temporary acquisition manifest is missing: $tempManifest"; return }
  if (-not (Test-Path -LiteralPath $acceptedMan -PathType Leaf)) {
    Refuse "the ACCEPTED manifest is missing: $acceptedMan"; return }
  if (-not (Test-Path -LiteralPath $contractPath -PathType Leaf)) {
    Refuse "the fitzRoy contract is missing: $contractPath"; return }
  if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    Refuse "no Python interpreter at $python"; return }

  # the candidate must still be exactly what Step 1e adjudicated
  $files = @(Get-ChildItem -LiteralPath $candidateDir -Recurse -File)
  if ($files.Count -ne 129) {
    Refuse ("the candidate holds {0} file(s), not the 129 adjudicated in Step 1e" -f $files.Count); return }

  # the accepted binding must still be intact and untouched
  $acceptedHash = (Get-FileHash -LiteralPath $acceptedMan -Algorithm SHA256).Hash.ToLower()
  $bound = (Get-Content -LiteralPath $contractPath -Raw | ConvertFrom-Json).datasets.ladder.accepted_witness
  if (-not $bound) { Refuse 'the contract records no datasets.ladder.accepted_witness'; return }
  if ($bound.snapshot_label -ne 'ladder-20260828') {
    Refuse ("the contract accepts '{0}', not 'ladder-20260828'" -f $bound.snapshot_label); return }
  if ($acceptedHash -ne ("$($bound.manifest_sha256)").ToLower()) {
    Refuse ("the ACCEPTED manifest no longer matches its contract binding: computed {0}" -f $acceptedHash); return }

  Write-Host "preconditions OK - candidate 129 files; accepted manifest $acceptedHash"

  # ---- promotion: ONE rename (no copy), then ONE deletion ----
  Rename-Item -LiteralPath $candidateDir -NewName 'ladder-20260828'
  $promoted = @(Get-ChildItem -LiteralPath $canonicalDir -Recurse -File)
  if ($promoted.Count -ne 129) {
    Write-Host ("REFUSED after rename: {0} file(s) at {1}. STOP - the temporary manifest was NOT deleted." -f $promoted.Count, $canonicalDir); return }
  Write-Host ("promoted -> {0} ({1} files)" -f $canonicalDir, $promoted.Count)

  Remove-Item -LiteralPath $tempManifest -Force
  Write-Host "removed the temporary acquisition manifest ONLY: $tempManifest"
  Write-Host ("accepted manifest present: {0}  sha256: {1}" -f (Test-Path -LiteralPath $acceptedMan), (Get-FileHash -LiteralPath $acceptedMan -Algorithm SHA256).Hash.ToLower())

  # ---- canonical validation: offline, no database, no network ----
  $env:AFLDB_PYTHON = $python
  & $python $validator --label ladder-20260828
  Write-Host ("validator exit code: {0}" -f $LASTEXITCODE)
}
```

**Expected successful result.** Four preamble lines (`preconditions OK - candidate 129 files;
accepted manifest 604a8a162543e19060f426bd189222d32d07726a0b134bdf4f910175cb7a8d3f`,
`promoted -> D:\dev\afldb-issue-102\data\sources\afltables\fitzroy_core\ladder-20260828 (129 files)`,
`removed the temporary acquisition manifest ONLY: ...`, `accepted manifest present: True  sha256:
604a8a16...8d3f`), then:

```
AFLDB-ISSUE-095 ladder witness validation - ladder-20260828

1. witness binding
  PASS  the contract classifies ladder as a validation witness
  PASS  ladder is NOT a required full-history core dataset
  PASS  the manifest is the label the contract accepts
  PASS  the tracked manifest matches its accepted sha256

2. manifest shape
  PASS  manifest is an acquisition, not a probe
  PASS  manifest requests the ladder dataset only
  PASS  manifest lists exactly 129 ladder files
  PASS  manifest row counts total 1622

3. raw artefacts (bytes, schema, per-season structure)
  PASS  every manifest sha256 matches the file on disk
  PASS  every file row count matches the manifest
  PASS  every file carries the exact eight-column contract
  PASS  no zero-row season
  PASS  every row's Season matches its file's season
  PASS  Team is non-empty everywhere
  PASS  Team is unique within every season
  PASS  Ladder.Position is complete and unique within every season
  PASS  the witness's Percentage agrees with its own Score.For/Score.Against
  PASS  covers exactly 1897-2025
  PASS  no duplicate season file
  PASS  total rows = 1622
  PASS  no season later than the accepted last season is present
  PASS  no duplicate (label, season) pair

4. historical identity resolution
  PASS  all 1622 label-season pairs resolve
  PASS  every resolution lands inside that identity's own era
  PASS  no season maps two labels onto one club identity
  PASS  resolved (club identity, season) pairs are unique

All checks passed.
validator exit code: 0
```

**26 `PASS` lines, zero `FAIL` lines, `All checks passed.`, exit 0** — 4 + 4 + 14 + 4, counted from
`validate_ladder_witness.py:130-133,137-144`, `:150-159`, `:228-255`, `:286-293`. The numbers `129`,
`1622` and `1897-2025` are interpolated by the validator from `datasets.ladder.coverage`
(`fitzroy-contract.json:256-260`), not typed as literals. Section 5 does **not** appear: `--compare`
is deliberately not used, because `club_seasons` has not been rebuilt yet and the D7 cross-check
belongs to §5 Step 4's FINAL VALIDATION.

**Any other result: STOP and report it, change nothing.** `REFUSED: ...` from the block itself means
a precondition failed and nothing was touched. `REFUSED: the tracked manifest for 'ladder-20260828'
exists but its acquired bytes are absent ...` (exit 2) means the rename did not land where
`SNAPSHOT_ROOT / label` looks (`:53`, `:161-170`) — report it, do **not** re-acquire. `FAILED: n
check(s): ...` (exit 1) after a 129/129 adjudication would be new information about the validator's
own schema/identity checks rather than about the bytes — report the named checks verbatim and do not
edit the manifest, the contract or the validator (§2p.5).

**Step 2 — DONE (pass 19), and it SUCCEEDED. Do not re-run it:** both destinations now exist, so the
block correctly refuses on its first precondition. The operator's measured result is §2r.1 — labels
read from tracked source, sources 131 / 90, ladder 129 before, copied 131 / 90, probe hash MATCHING,
ladder 129 after, and exactly the three prerequisite labels present. The block is retained below as
the record of what was run.

**Step 2 (retained record): the operator copies the two remaining prerequisites in**
(Claude does not copy, generate, acquire, rename or delete snapshot data). One atomic block. It
copies **exactly two directories, whole, nothing pruned**, from `D:\dev\afldb` to the same
worktree-relative path under `D:\dev\afldb-issue-102`:

| # | Snapshot | Worktree-relative path | Expected files |
|---|---|---|---|
| 1 | fitzRoy core | `data\sources\afltables\fitzroy_core\full-history-20260827` | **131** |
| 2 | DraftGuru Stage A | `data\sources\draftguru\annual-html-20260826` | **90** (42 raw + 42 http + 2 robots + 4 parsed) |

Both labels are **read from tracked source, never typed**: the fitzRoy label and `snapshot_dir` come
from the single `acceptance_status: accepted` baseline in
`data/reference/fitzroy-accepted-baselines.json` (`:57-64`), and the DraftGuru label from
`draftguruLabel` in `tools/db/rebuild-test.ts:1124` — the same value the rebuild will ask for. So the
block cannot copy a label the rebuild does not want, and it copies **no other snapshot label**.

It contacts **no database and no network**, runs **no Git command**, accesses **no production**, and
touches **no tracked file** — it only *reads* the two tracked declarations and the fitzRoy manifest.
`data/sources/**` is gitignored (`.gitignore:37-48`), so Git sees nothing. **`ladder-20260828` is
never written**: it is measured before and after purely as proof of non-interference.

It **fails closed before copying anything** if either destination already exists, if either source
directory is missing, if either source file count is not its measured value, if the register does not
declare exactly one accepted fitzRoy baseline, if the DraftGuru label cannot be read, or if the
promoted ladder witness is absent or not 129 files.

```powershell
Set-Location D:\dev\afldb-issue-102
& {
  $ErrorActionPreference = 'Stop'

  $dstRoot = 'D:\dev\afldb-issue-102'
  $srcRoot = 'D:\dev\afldb'

  function Refuse($m) {
    Write-Host "REFUSED: $m"
    Write-Host 'Nothing was copied. No snapshot, manifest, contract, database or Git state was touched.'
  }

  # ---- labels come from TRACKED SOURCE, never typed ----
  $baselinePath = Join-Path $dstRoot 'data\reference\fitzroy-accepted-baselines.json'
  $rebuildPath  = Join-Path $dstRoot 'tools\db\rebuild-test.ts'
  $fitzManifest = Join-Path $dstRoot 'docs\rebuild-manifests\afltables_fitzroy_core\full-history-20260827.json'
  if (-not (Test-Path -LiteralPath $baselinePath -PathType Leaf)) { Refuse "missing $baselinePath"; return }
  if (-not (Test-Path -LiteralPath $rebuildPath  -PathType Leaf)) { Refuse "missing $rebuildPath";  return }
  if (-not (Test-Path -LiteralPath $fitzManifest -PathType Leaf)) { Refuse "missing $fitzManifest"; return }

  $accepted = @((Get-Content -LiteralPath $baselinePath -Raw | ConvertFrom-Json).baselines |
                Where-Object { $_.acceptance_status -eq 'accepted' })
  if ($accepted.Count -ne 1) {
    Refuse ("the register declares {0} accepted fitzRoy baseline(s), not exactly 1" -f $accepted.Count); return }
  $fitzLabel = $accepted[0].snapshot_label
  $fitzRel   = ([string]$accepted[0].snapshot_dir).Replace('/', '\')

  $m = [regex]::Match((Get-Content -LiteralPath $rebuildPath -Raw), "draftguruLabel:\s*'([^']+)'")
  if (-not $m.Success) { Refuse 'could not read draftguruLabel from tools\db\rebuild-test.ts'; return }
  $dgLabel = $m.Groups[1].Value
  $dgRel   = "data\sources\draftguru\$dgLabel"

  Write-Host ("labels read from tracked source - fitzRoy '{0}', DraftGuru '{1}'" -f $fitzLabel, $dgLabel)

  $pairs = @(
    [pscustomobject]@{ Name = 'fitzRoy';   Rel = $fitzRel; Expect = 131 },
    [pscustomobject]@{ Name = 'DraftGuru'; Rel = $dgRel;   Expect = 90  }
  )

  # ---- preconditions: every one fails closed BEFORE anything is copied ----
  foreach ($p in $pairs) {
    $s = Join-Path $srcRoot $p.Rel
    $d = Join-Path $dstRoot $p.Rel
    if (Test-Path -LiteralPath $d) {
      Refuse ("the {0} destination already exists: {1}. Do not overwrite, merge or delete it." -f $p.Name, $d); return }
    if (-not (Test-Path -LiteralPath $s -PathType Container)) {
      Refuse ("the {0} source directory is missing: {1}" -f $p.Name, $s); return }
    $n = @(Get-ChildItem -LiteralPath $s -Recurse -File).Count
    if ($n -ne $p.Expect) {
      Refuse ("the {0} source holds {1} file(s), not the expected {2}: {3}" -f $p.Name, $n, $p.Expect, $s); return }
    Write-Host ("source OK   {0,-9} {1,3} file(s)  {2}" -f $p.Name, $n, $s)
  }

  # ---- the promoted ladder witness is READ ONLY here: measured, never written ----
  $ladderDir = Join-Path $dstRoot 'data\sources\afltables\fitzroy_core\ladder-20260828'
  if (-not (Test-Path -LiteralPath $ladderDir -PathType Container)) {
    Refuse "the promoted ladder witness is missing: $ladderDir"; return }
  $ladderBefore = @(Get-ChildItem -LiteralPath $ladderDir -Recurse -File).Count
  if ($ladderBefore -ne 129) {
    Refuse ("the ladder witness holds {0} file(s), not 129: {1}" -f $ladderBefore, $ladderDir); return }
  Write-Host ("ladder witness present and untouched by this block: {0} file(s)" -f $ladderBefore)

  # ---- copy: exactly these two directories, whole ----
  foreach ($p in $pairs) {
    $s = Join-Path $srcRoot $p.Rel
    $d = Join-Path $dstRoot $p.Rel
    $parent = Split-Path -Parent $d
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
      New-Item -ItemType Directory -Path $parent | Out-Null }
    Copy-Item -LiteralPath $s -Destination $d -Recurse
    $n = @(Get-ChildItem -LiteralPath $d -Recurse -File).Count
    if ($n -ne $p.Expect) {
      Write-Host ("REFUSED after copy: {0} holds {1} file(s), not {2}. STOP and report - do not re-copy over it." -f $d, $n, $p.Expect); return }
    Write-Host ("copied      {0,-9} {1,3} file(s)  -> {2}" -f $p.Name, $n, $d)
  }

  # ---- post-copy diagnostics (Step 3 is the proof, not this) ----
  $probe = @((Get-Content -LiteralPath $fitzManifest -Raw | ConvertFrom-Json).files |
             Where-Object { $_.filename -eq 'player_stats_1897.csv' })
  if ($probe.Count -eq 1) {
    $probeHash = (Get-FileHash -LiteralPath (Join-Path (Join-Path $dstRoot $fitzRel) $probe[0].filename) -Algorithm SHA256).Hash.ToLower()
    if ($probeHash -eq ([string]$probe[0].sha256).ToLower()) {
      Write-Host "probe player_stats_1897.csv: sha256 MATCHES the tracked manifest (1 of 131 - Step 3 proves the rest)"
    } else {
      Write-Host ("probe player_stats_1897.csv: sha256 MISMATCH - computed {0}. STOP and report." -f $probeHash)
    }
  } else {
    Write-Host 'probe player_stats_1897.csv: not listed in the tracked manifest - report this.'
  }

  $ladderAfter = @(Get-ChildItem -LiteralPath $ladderDir -Recurse -File).Count
  Write-Host ("ladder witness after: {0} file(s) (was {1})" -f $ladderAfter, $ladderBefore)
  Write-Host ("fitzroy_core labels present: {0}" -f ((Get-ChildItem -LiteralPath (Join-Path $dstRoot 'data\sources\afltables\fitzroy_core') -Directory).Name -join ', '))
  Write-Host ("draftguru labels present:    {0}" -f ((Get-ChildItem -LiteralPath (Join-Path $dstRoot 'data\sources\draftguru')             -Directory).Name -join ', '))
}
```

**Expected successful output**, in order: the label line naming `full-history-20260827` and
`annual-html-20260826`; `source OK   fitzRoy   131 file(s)` and `source OK   DraftGuru  90 file(s)`
under `D:\dev\afldb`; `ladder witness present and untouched by this block: 129 file(s)`;
`copied      fitzRoy   131 file(s)` and `copied      DraftGuru  90 file(s)` into
`D:\dev\afldb-issue-102`; `probe player_stats_1897.csv: sha256 MATCHES the tracked manifest`;
`ladder witness after: 129 file(s) (was 129)`; `fitzroy_core labels present: full-history-20260827,
ladder-20260828`; `draftguru labels present: annual-html-20260826`.

**221 new files land in the worktree (131 + 90) and the ladder's 129 are unchanged**, so
`data/sources/` then holds exactly the three prerequisite snapshots and nothing else.

**Any other result: STOP and report it, change nothing.** A `REFUSED:` line means a precondition
failed and nothing was copied. A `REFUSED after copy:` line means the destination count is wrong —
report it and delete nothing without instruction. A probe `MISMATCH` means the copied bytes are not
the accepted snapshot; report it rather than re-copying, and do **not** edit any manifest or
contract. The single matching probe proves **1 of 131 files** and nothing more — Step 3 is the proof.

**Step 3 — DONE (pass 20), and ALL THREE VALIDATORS RETURNED EXIT 0. Do not re-run it.** The
operator ran exactly the block below and it passed on every line: inventory `131 / 129 / 90`;
fitzRoy `full-history gates PASSED` + `accepted canonical baseline VERIFIED` (131 artefacts,
719042 acquired rows, `missing_url`/`malformed_url` 0, `players 13275`, `seasons 1897-2025`,
manifest `a42c6d5f…21d09`), 20.8 s, no database access; ladder **26 PASS / 0 FAIL**, 129 files,
1622 rows, `All checks passed.`; DraftGuru 42 pages sha256 verified / persons 5057 / picks 6810 /
ledger 6 / bridge 0, `every input check passed. No database was contacted.` **The snapshot/input
blocker is CLEARED and the rebuild is expected to pass PRECHECK** (§2s). Retained record below.

**Step 3 (retained record): prove the prerequisite offline, before any destruction.** One
block, three validators, in order, **stopping on the first non-zero exit** so the first failure is
the one reported rather than being buried under the next validator's output. Offline throughout: no
database (`database_accessed: false` on all three), no network, no Git, no snapshot copied, moved,
renamed, generated or deleted, no manifest or contract touched, and no Coleman code involved. What
each validator re-derives, and why the ordering and the fail-stop are what they are, is §2r.3–§2r.4.

```powershell
Set-Location D:\dev\afldb-issue-102
& {
  $root = 'D:\dev\afldb-issue-102'
  $py   = Join-Path $root '.venv\Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $py -PathType Leaf)) {
    Write-Host "REFUSED: interpreter not found: $py"; return }
  $env:AFLDB_PYTHON = $py

  # ---- the three prerequisite snapshots must already be on disk. This block acquires,
  # ---- copies, renames and deletes NOTHING; it only measures and then validates.
  $need = @(
    [pscustomobject]@{ Name='fitzRoy core';   Rel='data\sources\afltables\fitzroy_core\full-history-20260827'; Files=131 },
    [pscustomobject]@{ Name='ladder witness'; Rel='data\sources\afltables\fitzroy_core\ladder-20260828';       Files=129 },
    [pscustomobject]@{ Name='DraftGuru';      Rel='data\sources\draftguru\annual-html-20260826';               Files=90  }
  )
  foreach ($n in $need) {
    $p = Join-Path $root $n.Rel
    if (-not (Test-Path -LiteralPath $p -PathType Container)) {
      Write-Host ("REFUSED: {0} snapshot missing: {1}" -f $n.Name, $p); return }
    $c = @(Get-ChildItem -LiteralPath $p -Recurse -File).Count
    if ($c -ne $n.Files) {
      Write-Host ("REFUSED: {0} holds {1} file(s), not {2}: {3}" -f $n.Name, $c, $n.Files, $p); return }
    Write-Host ("present  {0,-15} {1,3} file(s)" -f $n.Name, $c)
  }

  $steps = @(
    [pscustomobject]@{ N='1/3  fitzRoy accepted full-history';
      A=@('tools/migration/import_fitzroy_core.py','--label','full-history-20260827',
          '--validate-only','--require-accepted-baseline') },
    [pscustomobject]@{ N='2/3  canonical ladder witness';
      A=@('tools/rebuild/fitzroy/validate_ladder_witness.py','--label','ladder-20260828') },
    [pscustomobject]@{ N='3/3  DraftGuru canonical inputs';
      A=@('tools/rebuild/draftguru/import_draftguru.py','--validate-only') }
  )
  foreach ($s in $steps) {
    Write-Host ''
    Write-Host ("===== {0} =====" -f $s.N)
    $argv = $s.A
    & $py @argv
    if ($LASTEXITCODE -ne 0) {
      Write-Host ''
      Write-Host ("STOP: {0} exited {1}. The remaining validator(s) were NOT run." -f $s.N, $LASTEXITCODE)
      Write-Host 'Report the output verbatim. Change no snapshot, manifest, contract or code.'
      return
    }
    Write-Host ("----- {0}: exit 0 -----" -f $s.N)
  }
  Write-Host ''
  Write-Host 'All three offline validators returned exit 0. No database, network, Git or production access occurred.'
}
```

**Expected successful output.** First the three `present` lines (`fitzRoy core 131`,
`ladder witness 129`, `DraftGuru 90`), then:

**1/3 — fitzRoy `full-history-20260827`.** `snapshot scan summary` followed by the eleven measured
values, then the full-history gates, then the acceptance verdict. Every number is a drift gate that
must equal `data/reference/fitzroy-accepted-baselines.json` exactly (`:113-141`), so these are
predictions, not observations:

```
snapshot scan summary
  matches                      16838
  matches_with_player_rows     16838
  attendance_known             15187
  players                      13275
  players_with_dob             855
  players_with_dob_conflict    0
  player_match_rows            685471
  venues                       52
  seasons                      1897-2025
  club_identities              <the 24 historical club identities, comma-separated>
  brownlow_round_vote_rows     320861
full-history gates PASSED — identity coverage
  rows                         685473
  missing_id                   83
  missing_url                  0
  malformed_url                0
  distinct_ids                 13270
  distinct_urls                13275
accepted canonical baseline VERIFIED
  accepted_label               full-history-20260827
  manifest_sha256              a42c6d5faacbcb6f4ce77a93a01f282577797375d14c60ef17f09bff2ab21d09
  artefact_set_sha256          8e14ce6198685b9fec568ab3c680cab34783e8e202ab0c7e93f45773d96f4125
  raw_artefacts                131
  acquired_rows                719042
  contract_version             1

Validation complete in N.Ns (no database access).
```

The load-bearing lines are **`full-history gates PASSED`** (integrity and identity coverage
re-derived from the CSVs, `missing_url` and `malformed_url` both **0**) and **`accepted canonical
baseline VERIFIED`** (the acceptance still binds THESE bytes: manifest hash, artefact-set digest,
**131** artefacts, **719042** acquired rows, contract version 1). All 131 per-file SHA-256 checks
pass silently — a mismatch is a refusal, not a line of output.

**2/3 — ladder witness `ladder-20260828`.** The same argv the rebuild re-runs:

```
AFLDB-ISSUE-095 ladder witness validation - ladder-20260828

1. witness binding
  PASS  ...                       (4 checks)

2. manifest shape
  PASS  ...                       (4 checks)

3. raw artefacts (bytes, schema, per-season structure)
  PASS  ...                       (14 checks)

4. historical identity resolution
  PASS  ...                       (4 checks)

All checks passed.
```

**26 `PASS` lines, zero `FAIL`, `All checks passed.`, exit 0** — accepted witness binding, exactly
**129** ladder files, manifest rows **1622**, every manifest SHA-256 matching disk, every row count
and the exact eight-column schema, coverage exactly **1897-2025**, and all **1622** historical
label-season pairs resolving. **Section 5 must NOT appear**: `--compare` is not passed, so the
`club_seasons` cross-check — the only database-touching part — never runs. This is the same
26/26 Step 1f already returned; re-running it here is what proves the promoted witness is still
canonical after the Step 2 copy landed beside it.

**3/3 — DraftGuru `annual-html-20260826`.**

```
AFLDB DraftGuru import (Stage B2-4/5)
  snapshot   : annual-html-20260826 (42 year pages, sha256 verified)
  persons    : 5057
  picks      : 6810
  ledger     : 6 explicit decisions
  bridge     : 0 entries (no bridge dataset supplied)

validate-only: every input check passed. No database was contacted.
```

**42 year pages / 5057 persons / 6810 picks** are not cosmetic: `persons` and `picks` are counted
from a full re-parse of the raw HTML and must equal `EXPECTED_PERSONS 5057` / `EXPECTED_ROWS 6810`
(`import_draftguru.py:77-78`, `:447-450`), the manifest is separately held to the same two numbers
(`:198-204`), and all 42 raw pages are re-hashed (`verify_raw_bytes:208-226`). `bridge : 0 entries`
is correct — no `--bridge` dataset is supplied and none is authorised here.

Then the closing line: `All three offline validators returned exit 0.`

**Three exit-0 results are what proves the rebuild will get past PRECHECK.** They are the same
checks `runPreflight()` re-runs itself, so nothing is taken on trust. **Any other result: STOP,
report it verbatim, change nothing** — the failure shapes and what each would mean are §2r.5. Do
not re-copy, do not prune a directory, do not edit a manifest, a contract, the register or a
validator, and do not proceed to Step 4 with any validator unrun or non-zero.

**Step 4 — THE CURRENT NEXT ACTION: the canonical rebuild. IT IS DELIBERATELY DESTRUCTIVE TO
`afldb_test`, AND TO NOTHING ELSE.** Step 3 has adjudicated every input, so PRECHECK is expected to
pass and the run is expected to proceed to the destructive reset. `afldb_dev` and production are
never contacted: `assertRebuildTargetName` (`rebuild-test.ts:153-176`) rejects the forbidden list,
anything matching `/prod/i`, anything not ending `_test` and anything but `afldb_test`, and
`assertDestructiveAcknowledgement` (`:232-241`) demands the database be named back. It is long — a
full 1897–2025 fitzRoy import — so run it where it can finish, and keep the whole transcript.

The block below **proves the environment before it destroys anything**, because the harness itself
proves only part of it: it checks that both DSNs name the same `afldb_test`, but it **never checks
which role either one connects as**. It prints database, role and host only — never a password —
and resolves both DSNs exactly as the harness does (process environment first, `.env` only as a
fallback: `:1154-1162` assigns only keys not already set). Run it from `D:\dev\afldb-issue-102`.

```powershell
Set-Location D:\dev\afldb-issue-102
& {
  $root = 'D:\dev\afldb-issue-102'

  # ---- 1. interpreter: every stage and the preflight are Python children (:389-394).
  $py = Join-Path $root '.venv\Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $py -PathType Leaf)) {
    Write-Host "REFUSED: interpreter not found: $py"; return }
  $env:AFLDB_PYTHON = $py
  Write-Host ("AFLDB_PYTHON                     {0}" -f $env:AFLDB_PYTHON)

  # ---- 2. psql: the destructive reset AND stage 9 FINAL VALIDATION both run through it,
  # ---- so a missing psql must be caught here, not after the database has been dropped.
  $psql = Get-Command psql -ErrorAction SilentlyContinue
  if (-not $psql) { Write-Host 'REFUSED: psql is not on PATH.'; return }
  Write-Host ("psql                             {0}" -f $psql.Source)

  # ---- 3. resolve both DSNs the way rebuild-test.ts main() does: the process
  # ---- environment WINS; .env only fills a variable that is not already set.
  $dotenv  = @{}
  $envFile = Join-Path $root '.env'
  if (Test-Path -LiteralPath $envFile -PathType Leaf) {
    foreach ($line in Get-Content -LiteralPath $envFile) {
      $t = $line.Trim()
      if (-not $t -or $t.StartsWith('#') -or ($t -notmatch '=')) { continue }
      $i = $t.IndexOf('=')
      $k = $t.Substring(0, $i).Trim()
      if (-not $dotenv.ContainsKey($k)) { $dotenv[$k] = $t.Substring($i + 1).Trim() }
    }
  }

  # ---- 4. PROVE the target and the import role. Nothing but database/role/host is printed.
  $want = @(
    [pscustomobject]@{ Var='AFLDB_TEST_DATABASE_URL';        Db='afldb_test'; Role='afldb_owner'  },
    [pscustomobject]@{ Var='AFLDB_TEST_IMPORT_DATABASE_URL'; Db='afldb_test'; Role='afldb_import' }
  )
  foreach ($w in $want) {
    $dsn = [Environment]::GetEnvironmentVariable($w.Var)
    if ([string]::IsNullOrWhiteSpace($dsn) -and $dotenv.ContainsKey($w.Var)) { $dsn = $dotenv[$w.Var] }
    if ([string]::IsNullOrWhiteSpace($dsn)) {
      Write-Host ("REFUSED: {0} is not set (neither in the environment nor in .env)." -f $w.Var); return }
    try { $u = [uri]$dsn } catch {
      Write-Host ("REFUSED: {0} is not a valid connection URL." -f $w.Var); return }
    $db   = $u.AbsolutePath.TrimStart('/')
    $role = [uri]::UnescapeDataString((($u.UserInfo -split ':')[0]))
    if ([string]::IsNullOrWhiteSpace($role)) { $role = '(none)' }
    Write-Host ("{0,-32} database={1}  role={2}  host={3}" -f $w.Var, $db, $role, $u.Host)
    if ($db -ne $w.Db) {
      Write-Host ("REFUSED: {0} names database '{1}', not '{2}'." -f $w.Var, $db, $w.Db); return }
    if ($role -ne $w.Role) {
      Write-Host ("REFUSED: {0} connects as '{1}', not '{2}'." -f $w.Var, $role, $w.Role); return }
  }

  Write-Host ''
  Write-Host 'PROVEN: afldb_test/afldb_owner + afldb_test/afldb_import, interpreter, psql.'
  Write-Host 'afldb_dev and production are unreachable from this run: the harness refuses every'
  Write-Host 'target but afldb_test by name, and every data stage is spawned with an EXPLICIT'
  Write-Host 'AFLDB_IMPORT_DATABASE_URL overlay that overrides any ambient development DSN.'
  Write-Host 'DESTROYING AND REBUILDING afldb_test NOW. This is intended and is the point of G7.'
  Write-Host ''

  npm run db:test:rebuild -- --acknowledge-destroy afldb_test
  Write-Host ''
  Write-Host ("rebuild exit code: {0}" -f $LASTEXITCODE)
}
```

**Expected evidence, in order.** The banner (`target : afldb_test`,
`fitzRoy label : full-history-20260827 (ACCEPTED canonical full-history baseline)`,
`draftguru : annual-html-20260826`) with **no** `WARNING: data stages run as OWNER` line — that
line appears only under `--allow-owner-import-dsn`, which is not passed. Then the eleven stage
banners `==> …` in plan order, with the Coleman stage **between `DERIVED` and `LADDER WITNESS`**:

```
==> COLEMAN — leading home-and-away goalkicker, derived
    coleman winners                           46  (46 seasons, 0 updated, 46 inserted, 0 deleted)
```

**46 INSERTED, not updated** — a canonically rebuilt `afldb_test` has no awards stage at all, so the
`awards` table is empty when this stage starts, `coleman_award_id()` takes its create-if-missing
branch for the first time ever, and `reload_keyed`'s ownership scope is empty. No `WARNING:
coleman: N season(s) produced tied winners` and no multi-club warning are expected over the
historical corpus (G3/G4 measured 45/45 single-club winners and no tie in the declared span), but
either would be a **reported result, not a failure**. Then `==> LADDER WITNESS …` and finally:

```
==> FINAL VALIDATION — per-domain row counts against the accepted contracts
WARNING:  AFLDB-FINAL-VALIDATION coleman_rows = 46 (expected 46)
WARNING:  AFLDB-FINAL-VALIDATION coleman_seasons = 46 (expected 46)
WARNING:  AFLDB-FINAL-VALIDATION coleman_first_season = 1980 (expected 1980)
WARNING:  AFLDB-FINAL-VALIDATION coleman_unlinked_rows = 0 (expected 0)
WARNING:  AFLDB-FINAL-VALIDATION coleman_rows_not_derived_from_afltables = 0 (expected 0)
WARNING:  AFLDB-FINAL-VALIDATION coleman_rows_keyed_on_a_numeric_id = 0 (expected 0)
WARNING:  AFLDB-FINAL-VALIDATION coleman_after_accepted_last_season = 0 (expected 0)
WARNING:  AFLDB-FINAL-VALIDATION PASSED: <n> checks

Rebuild complete.
rebuild exit code: 0
```

**Neither `46` nor `1980` is written anywhere in the harness.** `colemanFirstSeason()`
(`:704-718`) reads `first_season: 1980` from `data/reference/coleman-derivation.json:7` and
**refuses** rather than defaulting; `colemanChecks()` (`:731-735`) takes `seasons_last: 2025` from
the accepted register `data/reference/fitzroy-accepted-baselines.json:118`; the span is
`2025 − 1980 + 1 = 46`. §2s.4–§2s.5 records that derivation, and §2s.6 the four failure classes:
a PRECHECK refusal (nothing destroyed), a pre-Coleman stage failure (destroyed, not ISSUE-111
work), a Coleman-stage failure (first execution of the stage and of create-if-missing — report the
traceback), and a final gate mismatch (the rebuild is FAILED; never relax the gate). §6 gives the
per-gate interpretations.

**Step 4 is DONE (pass 21): the rebuild returned exit code 0 and every Coleman gate passed. Do NOT
re-run it.**

---

**Step 5 — DONE. It PASSED on both legs on 2026-08-30 (pass 22): `29 passed | 24 skipped (53)`,
leg 1 exit 0; `npx tsc --noEmit` no output, leg 2 exit 0. Recorded in the LANDING MANIFEST at
the top of this file and in `issues/open/AFLDB-ISSUE-111.md` §34. The block below is retained
verbatim as the record of what was run. DO NOT RE-RUN IT.**

**Step 5 — the pre-commit confirmation. It is
NON-destructive.** It runs the ISSUE-111 integration suite once against the freshly rebuilt
`afldb_test` and then the owed typecheck. Nothing is dropped, no migration runs, no snapshot byte is
read or written, no network is used, and no Git command is issued.

Why these two and nothing more:

| Leg | Why it is required | Why nothing else is |
|---|---|---|
| `npm test -- tests/integration/awards-reload-links.test.ts -t "AFLDB-ISSUE-111"` | The 29 cases last passed against the **pre-rebuild** `afldb_test`. §7 item 17 requires one re-run against the rebuilt database, because the suite manufactures its legacy/fixture states from whatever the database holds and the database has since been replaced wholesale. | — |
| `npx tsc --noEmit` | Owed since passes 4–7 added five describes, async fixture helpers, module-level snapshot readers and a twice-widened contract type to that file; the last clean run was the end of pass 1 (§7b). | — |
| — | — | The **DB-free** suites (`tests/coleman-derivation.test.ts` 42, `tests/db-test-rebuild.test.ts` 214, `tests/under-22-importer.test.ts` 8) last ran green in pass 15 and **no file they load has changed since**, so re-running them proves nothing new. The **canonical rebuild** must not be repeated: no source contract asks for a second one, and `rebuild-test.ts`, `import_awards.py`, `coleman-derivation.json` and every gate are unchanged since the run that passed. |

The block sets `AFLDB_PYTHON` and proves both DSNs first, because **the suite SKIPS rather than
fails** when `canRunFixtureImporter` is false (`awards-reload-links.test.ts:53-81`: the automatic
probe looks for the POSIX `.venv/bin/python`, which does not exist on Windows, and the role-parity
harness needs a validated `AFLDB_TEST_IMPORT_DATABASE_URL`). A silent 29-skip would look like
success, so the block refuses before running unless the environment is proven. Run it from
`D:\dev\afldb-issue-102`.

```powershell
Set-Location D:\dev\afldb-issue-102
& {
  $root = 'D:\dev\afldb-issue-102'

  # ---- 1. interpreter: the importer children and the psycopg probe both use it.
  $py = Join-Path $root '.venv\Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $py -PathType Leaf)) {
    Write-Host "REFUSED: interpreter not found: $py"; return }
  $env:AFLDB_PYTHON = $py
  Write-Host ("AFLDB_PYTHON                     {0}" -f $env:AFLDB_PYTHON)

  # ---- 2. psycopg must import, or every ISSUE-111 case SKIPS and 0 of 29 run.
  & $py -c "import psycopg" | Out-Null   # a traceback on stderr stays visible
  if ($LASTEXITCODE -ne 0) { Write-Host 'REFUSED: psycopg is not importable by that interpreter.'; return }
  Write-Host 'psycopg                          importable'

  # ---- 3. resolve both DSNs the way the suite does: process environment first,
  # ---- .env only as a fallback. Database/role/host only; never a password.
  $dotenv  = @{}
  $envFile = Join-Path $root '.env'
  if (Test-Path -LiteralPath $envFile -PathType Leaf) {
    foreach ($line in Get-Content -LiteralPath $envFile) {
      $t = $line.Trim()
      if (-not $t -or $t.StartsWith('#') -or ($t -notmatch '=')) { continue }
      $i = $t.IndexOf('=')
      $k = $t.Substring(0, $i).Trim()
      if (-not $dotenv.ContainsKey($k)) { $dotenv[$k] = $t.Substring($i + 1).Trim() }
    }
  }
  $want = @(
    [pscustomobject]@{ Var='AFLDB_TEST_DATABASE_URL';        Db='afldb_test'; Role='afldb_owner'  },
    [pscustomobject]@{ Var='AFLDB_TEST_IMPORT_DATABASE_URL'; Db='afldb_test'; Role='afldb_import' }
  )
  foreach ($w in $want) {
    $dsn = [Environment]::GetEnvironmentVariable($w.Var)
    if ([string]::IsNullOrWhiteSpace($dsn) -and $dotenv.ContainsKey($w.Var)) { $dsn = $dotenv[$w.Var] }
    if ([string]::IsNullOrWhiteSpace($dsn)) {
      Write-Host ("REFUSED: {0} is not set (neither in the environment nor in .env)." -f $w.Var); return }
    try { $u = [uri]$dsn } catch {
      Write-Host ("REFUSED: {0} is not a valid connection URL." -f $w.Var); return }
    $db   = $u.AbsolutePath.TrimStart('/')
    $role = [uri]::UnescapeDataString((($u.UserInfo -split ':')[0]))
    Write-Host ("{0,-32} database={1} role={2} host={3}" -f $w.Var, $db, $role, $u.Host)
    if ($db -ne $w.Db)     { Write-Host ("REFUSED: {0} must name {1}, not '{2}'." -f $w.Var, $w.Db, $db); return }
    if ($role -ne $w.Role) { Write-Host ("REFUSED: {0} must connect as {1}, not '{2}'." -f $w.Var, $w.Role, $role); return }
    [Environment]::SetEnvironmentVariable($w.Var, $dsn)
  }

  Write-Host ''
  Write-Host 'PROVEN: interpreter, psycopg, afldb_test/afldb_owner, afldb_test/afldb_import.'
  Write-Host 'STEP 5 LEG 1 of 2 - ISSUE-111 integration suite against the rebuilt afldb_test.'
  Write-Host ''

  npm test -- tests/integration/awards-reload-links.test.ts -t "AFLDB-ISSUE-111"
  $leg1 = $LASTEXITCODE
  Write-Host ("leg 1 exit code: {0}" -f $leg1)
  if ($leg1 -ne 0) { Write-Host 'STOP: leg 1 failed. Do not run leg 2; report the failure verbatim.'; return }

  Write-Host ''
  Write-Host 'STEP 5 LEG 2 of 2 - the typecheck owed since pass 1.'
  Write-Host ''

  npx tsc --noEmit
  Write-Host ("leg 2 exit code: {0}" -f $LASTEXITCODE)
}
```

**Expected successful result.**

- The four proof lines, then `PROVEN: interpreter, psycopg, afldb_test/afldb_owner,
  afldb_test/afldb_import.`
- **Leg 1:** `Test Files  1 passed (1)` and **`Tests  29 passed | <n> skipped`** out of the file's
  49 cases. **The number that matters is `29 passed` with `0 failed`**, and **`leg 1 exit code: 0`.
  The ~20 skipped are the pre-existing non-ISSUE-111 cases — those the `-t` filter excludes and the
  two legacy describes gated on `AFLDB_LEGACY_SQLITE`, which is deliberately unset — and are
  expected. `29 skipped` or `0 passed` instead would mean the environment proof was bypassed and the
  suite ran against nothing; that is a FAILURE, not a pass.
- **Leg 2:** no output at all, and **`leg 2 exit code: 0`**.

**Anything else STOPS the closeout and REOPENS `AFLDB-ISSUE-111`.** Report the failure verbatim.
Do not relax a gate, edit a Coleman contract, weaken an assertion or re-run the canonical rebuild to
make it pass.

**After a clean Step 5 the issue is landed and the work is ready to commit.** Claude runs no Git
command: staging, commit message, branch and merge are entirely the operator's. `D:\dev\afldb` was
not touched by any pass, and the unrelated files
`D:\dev\afldb\tools\nl\afldb_nl_mass_generator.py` and `D:\dev\afldb\artifacts\nl-mass-100k.cs`
remain outside this issue and must be preserved.

### 6. Expected result, and the remaining failure modes

**Expected: the rebuild completes and FINAL VALIDATION passes**, including the seven Coleman
gates added in pass 1. Their values are not guesses — they are computed from the tracked files
(§2g): `seasons_last = 2025`, contract `first_season = 1980`.

| Gate | Expected |
|---|---|
| `coleman_rows` | **46** |
| `coleman_seasons` | **46** |
| `coleman_first_season` | **1980** |
| `coleman_unlinked_rows` | **0** |
| `coleman_rows_not_derived_from_afltables` | **0** |
| `coleman_rows_keyed_on_a_numeric_id` | **0** |
| `coleman_after_accepted_last_season` | **0** |

Also expect the `COLEMAN — leading home-and-away goalkicker, derived` stage to appear in the
plan between `DERIVED` and `LADDER WITNESS`, and to report **46 inserted** (not updated): it runs
against a database that has never held a Coleman row.

**A real failure here is information — report it, do not tune anything until it agrees.** The
shapes worth naming:

- **A refusal before destruction** (`RebuildRefused`) is the harness working. `No Python
  interpreter at …` means `AFLDB_PYTHON`; `Unknown argument` means the command was mistyped;
  a target refusal means the DSN does not name `afldb_test`; **`snapshot file missing …` /
  `fitzRoy preflight failed` is the pass-9 case — a missing acquired snapshot, §2h/§5.**
  Nothing has been destroyed.
- **The COLEMAN stage failing on the award definition** would be the create-if-missing branch
  (deviation (a)) reached for the first time — §2g verified it is schema-legal, so a failure
  here is genuinely new information. Report the Python traceback verbatim.
- **`coleman_rows 45`** would mean `season_metadata` left 2025 `in_progress`; the derivation
  obeyed the completed-season rule correctly. Report the gate line and the season's status
  rather than relaxing the gate.
- **`coleman_rows_not_derived_from_afltables > 0`** cannot happen from this path — there is no
  legacy awards stage — so it would mean something else wrote Coleman rows.
- **The NULL-goals guard firing** (deviation (e)) would mean the rebuilt corpus contains
  home-and-away rows with `goals IS NULL`, which G1 measured as zero in the legacy corpus. That
  is a real fitzRoy-import finding, not a Coleman defect.
- **A failure in a stage before `coleman`** is not ISSUE-111 work. Report it and stop; do not
  start repairing another subsystem inside this issue.

After the rebuild passes, the ISSUE-111 integration suite should be re-run **once** against the
freshly rebuilt `afldb_test`:

```
npm test -- tests/integration/awards-reload-links.test.ts -t "AFLDB-ISSUE-111"
```

That confirms the suite still holds against a canonically produced Coleman family rather than a
hand-loaded one. **Expect 29 of 29 again.** That confirmation, `npx tsc --noEmit` (§7b),
`CHANGELOG.md` and the ledger closeout are all that remain.

`vitest.config.mts` sets `fileParallelism: false` (ISSUE-108), so `--no-file-parallelism` is
redundant when that re-run happens.

### 7. Remaining work, after the pass-2 integration block passes

Integration home: **`tests/integration/awards-reload-links.test.ts`** — it already owns the
awards ETL boundary and already has the role-parity harness
(`tests/integration/import-role-parity.ts`), the honours table lock (`./draft-lock`) and a
`runImporter()` helper. Extend it; do not create a new integration file.

**Items 1–16 and 18 are WRITTEN and PASSED against `afldb_test` (passes 4–8). The integration
suite is COMPLETE: 29 of 29. Item 17 (G7) is the next command; items 19 and 20 remain.**

**Do not establish an all-`draftguru` state by hand and do not run `--rekey-coleman` yourself:
the pass-6 block manufactures that state from the derived family and restores it by id (§2e),
and pass 7 proved it does so correctly.**

1. ~~**Independent PostgreSQL oracle (G2)**~~ — **WRITTEN pass 2, REWRITTEN pass 3, PASSED
   pass 4 in 351 ms.** `round_type` instead of `NOT is_final`, a season subquery instead of a
   join, and a grouped per-season maximum joined back instead of a window function; compares
   winners *and* goal totals. The original correlated-`max` form was quadratic over a
   materialised CTE and hit the 5 s `statement_timeout` — see §2b. **Do not reintroduce it.**
2. ~~**Tie fixture**~~ — **WRITTEN pass 4** (season 2090), **PASSED pass 5.**
3. ~~**Multi-club NULL fixture**~~ — **WRITTEN pass 4** (season 2091), **PASSED pass 5.**
   History supplies no real case (G4 measured 45/45 single-club).
4. ~~**In-progress season fixture**~~ — **WRITTEN pass 4** (season 2092), **PASSED pass 5.**
5. ~~**Season-boundary fixture**~~ — **WRITTEN pass 4** (`first_season - 1`), **PASSED pass 5.**
6. ~~**Finals-exclusion fixture**~~ — **WRITTEN pass 4** (season 2093), **PASSED pass 5.**
7. ~~**Missing / invalid stable identity (G5a)**~~ — **WRITTEN pass 5** (season 2094, a synthetic
   player), **PASSED pass 6**; see §2d and §7c. A winner with no `afltables_profile_url`
   identity makes the loader refuse; it never falls back to `players.id`, the fitzRoy numeric id
   or a name. The ambiguous (two-identity) and `:`-in-path cases are proven against a real
   database too, with a fourth control case that loads.
8. ~~**Transition 1:1 preflight**~~ — **WRITTEN pass 6, PASSED pass 7** (§2e, test 4).
9. ~~**Transition retry / no-op**~~ — **WRITTEN pass 6, PASSED pass 7** (§2e, test 1). This is the
   state `afldb_test` is actually in, so it is measured before anything is manufactured.
10. ~~**Mixed-state refusal**~~ — **WRITTEN pass 6, PASSED pass 7** (§2e, test 2).
11. ~~**Unbridgeable refusal**~~ — **WRITTEN pass 6, PASSED pass 7** (§2e, test 3), as two legacy
    rows on one season: the `(award_id, season)` bridge is no longer 1:1 and the whole
    transaction aborts.
12. ~~**Preservation of every legacy id**~~ — **WRITTEN pass 6, PASSED pass 7** (§2e, tests 4
    and 6). Note that **id 9441 is an `afldb_dev` id**, not an `afldb_test` one: the assertion is
    that *every* id is preserved, which is the same claim without importing a foreign surrogate.
13. ~~**Transition isolation**~~ — **WRITTEN pass 6, PASSED pass 7** (§2e, test 5), against
    created witnesses rather than whatever `afldb_test` happens to hold.
14. ~~**First derived load signal**~~ — **WRITTEN pass 6, PASSED pass 7** (§2e, test 6).
    **46 updated / 0 inserted / 0 deleted**, read from the contract. Do not weaken this
    acceptance condition without a proven source-level reason.
15. ~~**Three-reload fingerprint (G8)**~~ — **WRITTEN pass 2, PASSED pass 3.** Three reloads,
    0 inserted / 0 deleted on runs 2 and 3, byte-identical `md5(id|source_record_id)`.
16. ~~**Manual-link and no-decision regression audits**~~ — the **no-decision half PASSED in
    pass 3**; the **manual-link half was WRITTEN in pass 7 (§2f) and PASSED in pass 8**. A
    `linked` and a `confirmed_unlinked` decision both survive the derived reload with both
    disagreements warned, the name guard refuses a decided row whose stored name has drifted, and
    the refusal is recoverable. **CLOSED.**
17. ~~**Canonical rebuild (G7)**~~ — **EXECUTED pass 21 and PASSED.**
    `npm run db:test:rebuild -- --acknowledge-destroy afldb_test` returned **exit code 0**, the
    `coleman` stage reported `46 winners (46 seasons, 0 updated, 46 inserted, 0 deleted)` and FINAL
    VALIDATION returned `AFLDB-FINAL-VALIDATION PASSED: 26 checks` with all seven Coleman gates
    green. **Do not re-run it.** The owed follow-on — ONE re-run of
    `npm test -- tests/integration/awards-reload-links.test.ts -t "AFLDB-ISSUE-111"` against the
    rebuilt database, expecting 29 of 29 — is now leg 1 of **§5 Step 5**.
18. ~~**No-`AFLDB_LEGACY_SQLITE` proof (G9)**~~ — **WRITTEN pass 2, PASSED pass 3**, as a real
    `--groups coleman` run spawned with the variable dropped from the child environment.
19. ~~**`CHANGELOG.md`**~~ — **DONE pass 21.** `Unreleased` carries *AFLDB-ISSUE-111 — Coleman
    Medal derived from canonical AFLDB facts (Resolved) - 30 August 2026*.
20. ~~**Final issue / ledger closeout**~~ — **DONE pass 21.** `issues.md` records Status
    **Resolved** / Resolved **2026-08-30** with the gate-by-gate Validation table and the
    Resolution; the row is removed from the Open Issues table and from `IssuesIndex.md`, both
    counts corrected 5 → 4. The transition's `46 updated / 0 inserted / 0 deleted` signal was
    observed in pass 7 against the manufactured legacy family, and the canonical rebuild's
    complementary fresh-load signal `0 updated / 46 inserted / 0 deleted` in pass 21.
21. **§5 Step 5 — the pre-commit confirmation.** The ONE remaining operator action: the ISSUE-111
    integration suite re-run against the rebuilt `afldb_test` (29 of 29) and `npx tsc --noEmit`.
    Not a gate; a failure in either **reopens** the issue.

Also outstanding, not test work: the **transition has been executed against no real legacy
family**. The pass-6 suite executes it against a manufactured one and pass 7 proved that works,
which establishes the mechanism; `afldb_dev` and production still hold the legacy `draftguru`
family and are out of scope here.

### 7a. Follow-up observations — recorded, deliberately NOT fixed in the G2 slice

1. **Windows Python probe.** `tests/integration/awards-reload-links.test.ts:53` probes
   `.venv/bin/python`, the POSIX virtualenv layout. On Windows the interpreter is at
   `.venv/Scripts/python.exe`, so the probe always misses and the fallback is a bare `python`
   from `PATH` — which will usually lack psycopg and silently **skip** the whole suite rather
   than fail it. `AFLDB_PYTHON` overrides it correctly, and that is what the pass-3 run used.
   A one-line fix would be to probe the `Scripts` path too on `win32`. It is a harness
   portability improvement, not an ISSUE-111 defect, and was left alone to keep the G2 slice
   coherent. Decide deliberately whether it belongs to ISSUE-111 or its own issue. **Still
   open after pass 4.**

### 7b. `npx tsc --noEmit` — owed once before closeout

Passes 4–7 added real TypeScript (five describes, async fixture helpers, module-level snapshot
readers and cleanup, a twice-widened contract type) to
`tests/integration/awards-reload-links.test.ts`. The last clean `tsc` run was at the end of
pass 1, so **one `npx tsc --noEmit` is owed before ISSUE-111 closeout**. It is still not the
next command: G7 is, and vitest has now transpiled every line of that file across five green
runs, so no syntax error survives there. Batch it with the closeout checks (items 19–20).

### 7c. Why the identity refusal (G5a) is a separate slice — WRITTEN in pass 5 as §2d

It does not share the pass-4 fixture harness, and merging it in would have made both weaker:

- Every pass-4 fixture reuses a **real** player who already holds exactly one profile identity.
  G5a needs the opposite — a player holding **none**, or **two**, or one whose normalised path
  contains the `:` separator. That means creating and removing a synthetic `players` row (and,
  for the ambiguous case, synthetic `external_identities` rows), which touches identity tables
  the pass-4 block deliberately never writes.
- Every pass-4 fixture asserts a **successful** load (`status === 0`) and then inspects rows.
  G5a must assert a **non-zero exit**, an unwritten database and a specific refusal message —
  the opposite acceptance shape, in the same `beforeAll`.
- The refusal must also prove the loader wrote **nothing at all**, which means capturing the
  fingerprint before and after and requiring it unchanged after a *failed* run.

`build_coleman_winners()`'s three refusals are already proven DB-free over synthetic rows
(`tests/coleman-derivation.test.ts`, via a Python subprocess). What G5a still owes is the same
refusal driven through `COLEMAN_DERIVATION_SQL` against a real database — which is exactly what
the pass-5 block (§2d) does, and what pass 6 measured. **Settled; nothing outstanding here.**

### 8. Integration safety — non-negotiable

- Every mutating or integration run targets **`afldb_test` only**. The integration database name
  must end `_test` (`AFLDB_TEST_DATABASE_URL`; role parity needs
  `AFLDB_TEST_IMPORT_DATABASE_URL`).
- **Never `afldb_dev`.** It may be read **read-only** for the G5a pre-flight and nothing else.
- **No production access of any kind** — no production database, deployment, migration or
  service action.
- Claude does not execute shell, database or Git commands. It prepares exact commands; the
  operator runs them and pastes the output back.

### 9. Issue state

**`AFLDB-ISSUE-111` is RESOLVED, dated 2026-08-30** — the integration suite (29/29), the
transition (proven by fixture, `46 updated / 0 inserted / 0 deleted`, every id preserved) and the
canonical rebuild (exit 0, all seven Coleman gates) have all passed, so all ten §9 gates hold.
**`AFLDB-ISSUE-102` remains OPEN** and is unaffected by this closeout beyond two index
resynchronisations; its other two children, `AFLDB-ISSUE-112` and `AFLDB-ISSUE-113`, are untouched
siblings. `AFLDB-ISSUE-110` is unrelated unmerged NL work — do not use, modify or invent that id.
**§5 Step 5 is DONE and PASSED (2026-08-30, pass 22): 29 of 29 ISSUE-111 integration
cases against the canonically rebuilt `afldb_test`, leg 1 exit 0, and `npx tsc --noEmit` clean, leg 2
exit 0.** Nothing is owed on ISSUE-111. The work is landing-ready and the operator owns the landing;
the exact staging contract is the LANDING MANIFEST at the top of this file.

`AFLDB-ISSUE-114` is also Resolved (2026-08-30) and is **uncommitted in the same worktree**, so it
lands with this branch — it is a hard prerequisite of ISSUE-111's G7, not an unrelated passenger.

### 10. Git

**Claude has run no Git command in any session on this issue**, including the pass-22 landing
pass, which produced its manifest by direct source inspection alone. The operator owns Git entirely
— status, diff, staging, commit, push, branch and merge.

**Eighteen paths are uncommitted and must land** (ten tracked-modified, eight new), and **eleven
zero-byte junk files must not**. The full classification, the expected `git status --short`, the
explicit `git add --` lines, the one-commit rationale, the commit message and the
push → fast-forward → dev plan are in the **LANDING MANIFEST** at the top of this file. **Never
`git add -A` or `git add .` in this worktree.**

## Known read-only evidence environment

Evidence was gathered over a localhost tunnel on **port 55432**. **Do not persist passwords
anywhere.**

- `afldb_app` → `afldb_dev` for ordinary read-only evidence.
- `afldb_import` → `afldb_dev` inside explicit `BEGIN TRANSACTION READ ONLY`, where
  `player_link_resolutions` visibility was required (`afldb_app` cannot see it — privilege
  visibility, not absence).

**The implementing session must use `afldb_test` for any mutation or integration work.**
`afldb_dev` may be read read-only for the G5a pre-flight. **No production access is authorised.**

## Files changed — design pass (2026-08-30)

- `issues/open/AFLDB-ISSUE-111.md` — G0/G1/G3/G4/G6 evidence persisted (§2.3, §3.1–§3.6); G5
  resolved (§5); provenance corrected to `afltables` (§6); transition designed (§7.1); gates and
  test matrix updated; status set to design-complete.
- `issues/open/AFLDB-ISSUE-102-HANDOFF.md` — pass-3 checkpoint added.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — **this file, created.**

No source, test, migration, manifest or ledger file was modified in that pass.

## Files changed — implementation pass 1 (2026-08-30)

See **§2** at the top of this file: two created, eight modified. No migration, privilege,
manifest, `CHANGELOG.md`, `issues.md` or production file was touched.

## Files changed — implementation pass 2 (2026-08-30)

- `tests/integration/awards-reload-links.test.ts` — the Coleman derived-load integration block
  (§2a), plus `readFileSync` added to the existing `node:fs` import. **The only source/test file
  pass 2 touched.**
- `issues/open/AFLDB-ISSUE-111.md` — §14 (the passed DB-free validation), §15 (the pass-2 test
  map and its two design points), §15.1 (what is still not done); the Status section renumbered
  §13 → §16 so it stays last.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — this file: validation state corrected, §2/§2a, §5,
  §6, §7 markers, and this prompt.

Nothing else. Pass 2 changed no loader, contract, rebuild stage, gate, migration, privilege
file, manifest, `CHANGELOG.md`, `issues.md`, `IssuesIndex.md` or ISSUE-110/112/113 material.

## Files changed — implementation pass 3 (2026-08-30)

- `tests/integration/awards-reload-links.test.ts` — **the G2 oracle query and its comment
  only** (§2b). No other test, helper, assertion or import changed.
- `issues/open/AFLDB-ISSUE-111.md` — §15 G2 table row updated; new §16 (the measured 8/1
  result, the G2 diagnosis, the fix and what it preserves, and the pass-3 environment facts);
  Status renumbered §16 → §17 and rewritten.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — this file: validation state rewritten with the
  measured result and the `afldb_test` mutation warning, §2/§2b, §4a, §5, §6, the §7 markers,
  §7a and the next prompt.

Nothing else. Pass 3 changed no loader, contract, rebuild stage, gate, migration, privilege
file, manifest, `CHANGELOG.md`, `issues.md`, `IssuesIndex.md` or ISSUE-110/112/113 material,
and ran no Git command.

## Files changed — implementation pass 4 (2026-08-30)

- `tests/integration/awards-reload-links.test.ts` — **appended only**: the module-level fixture
  constants and `removeFixtureCorpus()`, then a second describe,
  `Coleman derivation rules that history cannot demonstrate (AFLDB-ISSUE-111)` (§2c). **No
  existing test, helper, query, import or assertion was changed** — the pass-2/3 block is
  byte-for-byte what passed 9 of 9.
- `issues/open/AFLDB-ISSUE-111.md` — new §17 (the measured G2 re-run, the fixture design and
  what pass 4 changed); Status renumbered §17 → §18 and rewritten.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — this file: validation state, §2, §2c, §5, §6, the
  §7 markers, §7a/§7b/§7c and the next prompt.

Nothing else. Pass 4 changed no loader, contract, rebuild stage, gate, migration, privilege
file, manifest, `CHANGELOG.md`, `issues.md`, `IssuesIndex.md` or ISSUE-110/112/113 material,
and ran no Git command.

## Files changed — implementation pass 5 (2026-08-30)

- `tests/integration/awards-reload-links.test.ts` — a third describe,
  `Coleman durable-identity refusals against a real database (AFLDB-ISSUE-111 G5a)` (§2d);
  `key_separator` added to the `ColemanContract` type; `removeFixtureCorpus()` extended to remove
  the synthetic player and its identities, and its season scope widened to `ALL_FIXTURE_SEASONS`.
  **No existing test, assertion or query was changed** — the pass-2/3/4 blocks are byte-for-byte
  what passed 15 of 15.
- `issues/open/AFLDB-ISSUE-111.md` — new §18 (the measured 15/15 result and the G5a block
  design); Status renumbered §18 → §19 and rewritten.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — this file: validation state, §2, §2c closing
  measurement, §2d, §5, §6, the §7 markers, §7b/§7c and the next prompt.

Nothing else. Pass 5 changed no loader, contract, rebuild stage, gate, migration, privilege
file, manifest, `CHANGELOG.md`, `issues.md`, `IssuesIndex.md` or ISSUE-110/112/113 material,
and ran no Git command.

## Files changed — implementation pass 6 (2026-08-30)

- `tests/integration/awards-reload-links.test.ts` — a fourth describe,
  `Coleman legacy to derived ownership transition (AFLDB-ISSUE-111)` (§2e); `legacy_transition`
  added to the `ColemanContract` type; `removeFixtureCorpus()` extended with the isolation
  witnesses and their award, and `ISOLATION_AWARD_SLUG` declared beside the other fixture
  markers. **No existing test, assertion or query was changed** — the pass-2/3/4/5 blocks are
  byte-for-byte what passed 19 of 19.
- `issues/open/AFLDB-ISSUE-111.md` — new §19 (the measured 19/19 result and the transition-block
  design); Status renumbered §19 → §20 and rewritten.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — this file: validation state, §2, §2d closing
  measurement, §2e, §5, §6, the §7 markers, §7b and the next prompt.

Nothing else. Pass 6 changed no loader, contract, rebuild stage, gate, migration, privilege
file, manifest, `CHANGELOG.md`, `issues.md`, `IssuesIndex.md` or ISSUE-110/112/113 material,
and ran no Git command.

## Files changed — implementation pass 7 (2026-08-30)

- `tests/integration/awards-reload-links.test.ts` — a fifth describe,
  `Coleman derived reload preserves human link decisions (AFLDB-ISSUE-111)` (§2f), and its two
  fixture constants (`COLEMAN_LINK_EMAIL`, `COLEMAN_LINK_NOTE`), **appended**. **No existing
  test, helper, assertion, query, type or cleanup function was changed** — the pass-2/3/4/5/6
  blocks are byte-for-byte what passed 25 of 25.
- `issues/open/AFLDB-ISSUE-111.md` — new §20 (the measured 25/25 result and the decision-block
  design); Status renumbered §20 → §21 and rewritten.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — this file: validation state, §2, §2e closing
  measurement, §2f, §5, §6, the §7 markers, §7b and the next prompt.
- `IssuesIndex.md` — the ISSUE-111 row's state and **next action**: the transition is proven,
  the decision block is written and unrun, and the expected count moves 25 → 29. No other row
  was touched.

Nothing else. Pass 7 changed no loader, contract, rebuild stage, gate, migration, privilege
file, manifest, `CHANGELOG.md`, `issues.md` or ISSUE-110/112/113 material, and ran no Git
command.

## Files changed — implementation pass 8 (2026-08-30)

**No source or test file was changed.** Pass 8 recorded the measured 29/29 result and verified
the G7 rebuild inputs by reading source (§2g).

- `issues/open/AFLDB-ISSUE-111.md` — new §21 (the measured 29/29 result, item 16 closed, and the
  G7 readiness verification); Status renumbered §21 → §22 and rewritten.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — this file: validation state, §2, §2f closing
  measurement, new §2g, §5 (now the canonical rebuild), §6 (the Coleman gate expectations), the
  §7 markers, §7b/§7c and the next prompt.
- `IssuesIndex.md` — the ISSUE-111 row's state and **next action** only: the integration suite is
  complete at 29/29 and the next gate is G7. No other row was touched.

Nothing else. Pass 8 changed no loader, contract, rebuild stage, gate, migration, privilege file,
manifest, `CHANGELOG.md`, `issues.md` or ISSUE-110/112/113 material, ran no Git command, and
mutated no database.

## Files changed — implementation pass 9 (2026-08-30)

**No source or test file was changed.** Pass 9 diagnosed the G7 preflight refusal by reading
source and tracked contracts only. It ran no command, mutated no database and copied, generated
or deleted no snapshot data.

- `issues/open/AFLDB-ISSUE-111.md` — new §22 (the refusal, its classification, the three missing
  prerequisites, the integrity chain, state after); Status renumbered §22 → §23 and extended.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — this file: validation state, new §2h, §5 rewritten
  as the snapshot-prerequisite sequence, one §6 bullet, this section and the next prompt.
- `IssuesIndex.md` — the ISSUE-111 row's state and next action only.

The file count is unchanged at **eleven**. No loader, contract, rebuild stage, gate, migration,
privilege file, manifest, `CHANGELOG.md`, `issues.md` or ISSUE-110/112/113 material was touched.

## Files changed — implementation pass 10 (2026-08-30)

**No source or test file was changed.** Pass 10 established the snapshot-prerequisite recovery
contract by reading tracked source and contracts only. It ran no command, mutated no database, and
copied, acquired, generated or deleted no snapshot byte.

- `issues/open/AFLDB-ISSUE-111.md` — new §24 (the inventory, ladder production/validator/integrity
  contract, the DraftGuru 90-vs-42 resolution, copy safety, the search space, the decision tree);
  §23 Status extended.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — this file: the pass-10 status line, the G7 bullet,
  new §2i, §5 Steps 1/1b/2 rewritten, this section and the next prompt.
- `IssuesIndex.md` — the ISSUE-111 row's state and next action only.

The file count is unchanged at **eleven**. No loader, contract, rebuild stage, gate, migration,
privilege file, manifest, `CHANGELOG.md`, `issues.md` or ISSUE-110/112/113 material was touched.

## Files changed — implementation pass 11 (2026-08-30)

**No source or test file was changed.** Pass 11 received the operator's §5 Step 1b search result and
designed the ladder reacquisition/adjudication procedure by reading tracked source and contracts
only. It ran no command, performed no acquisition, mutated no database, and copied, generated or
deleted no snapshot byte.

- `issues/open/AFLDB-ISSUE-111.md` — new §25 (the Step 1b result, the exact acquisition command and
  why each flag is forced, the R/fitzRoy prerequisites, the network-and-`data/sources`-only blast
  radius, the expected 129/1897–2025/1,622 shape, adjudication against the tracked manifest, the one
  outcome that confers canonicity, the fail-closed rule, and why the offline preflight comes first);
  §23 Status extended.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — this file: the pass-11 status line, the G7 bullet, new
  §2j, §5 Steps 1b/1c/1d/1e/2 rewritten, this section and the next prompt.
- `IssuesIndex.md` — the ISSUE-111 row's state and next action only.

The file count is unchanged at **eleven**. No loader, contract, rebuild stage, gate, migration,
privilege file, manifest, `CHANGELOG.md`, `issues.md` or ISSUE-110/112/113 material was touched. In
particular **`tools/rebuild/fitzroy/fitzroy-contract.json`, its `accepted_witness` block and
`docs/rebuild-manifests/afltables_fitzroy_core/ladder-20260828.json` were NOT modified**, and must
not be.

## Files changed — implementation pass 18 (2026-08-30)

**No source or test file was changed.** Pass 18 recorded the operator's successful §5 Step 1f
promotion and canonical validation, and designed the §5 Step 2 copy block by reading tracked
declarations only. It ran no command, copied/moved/renamed/deleted no byte, mutated no database, ran
no Git command, made no network call and accessed no production.

- `issues/open/AFLDB-ISSUE-111.md` — new §30 (the Step 1f result, the 26/26 validator breakdown, the
  resulting on-disk state, and the Step 2 copy contract); §23 Status extended.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — this file: the pass-18 status line, the G7 bullet, new
  §2q, §5 Step 1f marked DONE with its block retained, §5 Step 2 rewritten as the exact operator
  block, this section and the next prompt.
- `IssuesIndex.md` — the ISSUE-111 row's state and next action only.

No loader, ISSUE-111 contract, rebuild stage, gate, migration, privilege file, **manifest**,
`CHANGELOG.md`, `issues.md` or ISSUE-110/112/113 material was touched. In particular
`docs/rebuild-manifests/afltables_fitzroy_core/ladder-20260828.json`,
`tools/rebuild/fitzroy/fitzroy-contract.json` and its `accepted_witness` block were **not** modified,
and must not be. No `CHANGELOG.md` entry is written: recovering gitignored local snapshot bytes is a
checkout-state change, not a retained project change — item 19 remains owed at closeout.

## Files changed — implementation pass 19 (2026-08-30)

**No source or test file was changed.** Pass 19 recorded the operator's successful §5 Step 2 copy and
prepared the §5 Step 3 validation block by reading current source only. It ran no command, copied /
moved / renamed / deleted / hashed no byte, mutated no database, ran no Git command, made no network
call and accessed no production.

- `issues/open/AFLDB-ISSUE-111.md` — new §31 (the Step 2 result, the resulting on-disk state, and the
  Step 3 validation contract with each validator's expected evidence); §23 Status extended.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — this file: the pass-19 status line, the G7 bullet, new
  §2r, §5 Step 2 marked DONE with its block retained, §5 Step 3 rewritten as the exact fail-stop
  operator block with its expected output, this section and the next prompt.
- `IssuesIndex.md` — the ISSUE-111 row's state and next action only.

No loader, ISSUE-111 contract, rebuild stage, gate, migration, privilege file, **manifest**,
`CHANGELOG.md`, `issues.md` or ISSUE-110/112/113 material was touched. In particular
`docs/rebuild-manifests/afltables_fitzroy_core/ladder-20260828.json`,
`docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260827.json`,
`data/reference/fitzroy-accepted-baselines.json`, `tools/rebuild/fitzroy/fitzroy-contract.json` and
`tools/rebuild/draftguru/draftguru-contract.json` were **not** modified, and must not be. No
`CHANGELOG.md` entry: copying gitignored local snapshot bytes is a checkout-state change, not a
retained project change — item 19 remains owed at closeout.

## Files changed — implementation pass 20 (2026-08-30)

**No source or test file was changed.** Pass 20 recorded the operator's successful §5 Step 3
adjudication (three validators, three exit 0) and prepared the §5 Step 4 rebuild block by reading
current source only. It ran no command, mutated no database, ran no Git command, made no network
call, accessed no production, and copied / moved / renamed / deleted / hashed no byte.

- `issues/open/AFLDB-ISSUE-111.md` — new §32 (the Step 3 result, the Step 4 environment contract,
  the reconfirmed Coleman stage/gate evidence and the four failure classes); §23 Status extended.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — this file: the pass-20 status line, the G7 bullet,
  new §2s, §5 Step 3 marked DONE with its block retained, §5 Step 4 rewritten as the exact
  destructive operator block with its expected output, this section and the next prompt.
- `IssuesIndex.md` — the ISSUE-111 row's state and next action only.

No loader, ISSUE-111 contract, rebuild stage, gate, migration, privilege file, **manifest**,
`CHANGELOG.md`, `issues.md` or ISSUE-110/112/113 material was touched. `data/sources/**` was not
read, written or measured by Claude. No `CHANGELOG.md` entry: item 19 remains owed at closeout,
after G7 passes.

## Production

**No production access is authorised** — no production database, deployment, migration or service
action, under ISSUE-111 or any sibling as currently scoped.

---

## Files changed — closeout pass 21 (2026-08-30)

No source, test, contract, manifest, migration or privilege file was changed by this pass. Five
records only:

- `issues.md` — ISSUE-111 Status/Resolved/Files/Validation/Resolution; row removed from the Open
  Issues table; count 5 → 4
- `IssuesIndex.md` — ISSUE-111 row removed; count 5 → 4; the parent ISSUE-102 row's two stale
  ISSUE-111 statements resynchronised
- `CHANGELOG.md` — the `Unreleased` ISSUE-111 closeout entry
- `issues/open/AFLDB-ISSUE-111.md` — §9 gates table, new §33, §23 Status → RESOLVED
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — this file

No database was contacted, no Git command was run, no production or `afldb_dev` access occurred,
`D:\dev\afldb` was not touched, and no snapshot byte was read, written, moved or deleted.

## Files changed — landing pass 22 (2026-08-30)

**No source, test, contract, manifest, migration, privilege, `CHANGELOG.md`, `issues.md` or
`IssuesIndex.md` file was changed.** Pass 22 recorded the operator's §5 Step 5 PASS and built the
landing manifest by direct source inspection. Two records only:

- `issues/open/AFLDB-ISSUE-111.md` — new §34 (the Step 5 environment proof, both legs, the 29-case
  breakdown, the 29 + 24 = 53 reconciliation, and the verdict); §23 Status "owed before commit"
  paragraph replaced with the passed result.
- `issues/open/AFLDB-ISSUE-111-HANDOFF.md` — this file: the Step 5 PASS landing state, the LANDING
  MANIFEST, §5 Step 5 marked DONE with its block retained, §9, §10 and this section.

No database was contacted, no test or build was run, no Git command was run, no network call was
made, no production or `afldb_dev` access occurred, `D:\dev\afldb` was not touched, no file was
deleted, and no snapshot byte was read, written, moved or deleted.

## There is no next session

`AFLDB-ISSUE-111` is **RESOLVED** and every gate plus the pre-commit confirmation is proven.
`AFLDB-ISSUE-114` is **RESOLVED**. The remaining work is the operator's landing, and its exact
contract is the **LANDING MANIFEST** at the top of this file.

**If a future session must touch this branch, its boundaries are unchanged:** the operator executes
all shell, database and Git commands; do not run Git, commit, checkout, reset or stash; do not
mutate any database; do not touch `afldb_dev` or production; all work targets `afldb_test` only; do
not modify `D:\dev\afldb`, which holds the unrelated `tools/nl/afldb_nl_mass_generator.py` and
`artifacts/nl-mass-100k.cs` that must be preserved; and do not touch ISSUE-110, ISSUE-112, ISSUE-113
or parent ISSUE-102 implementation.
