# Remediation run 4, scope `fixup`: state-b owns its actor; club-comparison 2026 Brownlow coverage from raw tables

Branch `claude/rem4-fixup-20261115`, worktree `D:\dev\afldb-rem4-fixup`, base = integration tip `c9b2c3e78f349e59503e39506888b43f3962642a` (not B4: it already
holds the run-4 brownlow / gates / clubcmp / coleman276 / rbfail changes; bundle prerequisite B4 `7cfbe186e70ca91db67da1aa4e28325ccbc32a86`).
Host `streamanator`, workspace `/mnt/ssd/afldb-rem4-fixup-20261115`, cluster `/mnt/ssd/afldb-rem4-fixup-20261115-pg`, **port 55692**, synthetic prefix `CD_I4080`.
Local only: no push, no production, no DEV service, no shared `afldb_test`, no `sudo`, no `wsl`, no RB-1 path, no lint-baseline change. **Test-only: nothing under `src/` changed.**
Only the two allowed test files changed.

| Commit | Subject | Files |
|---|---|---|
| `a2b553ad` | ISSUE-363: state-b suite creates and removes its own actor instead of borrowing an auth_users row | `tests/integration/settle-afl-api-state-b.test.ts` |
| `0e1a0d9f` | ISSUE-363: club-comparison 2026 Brownlow coverage expectation comes from raw tables, not a literal | `tests/integration/club-comparison.test.ts` |
| (record commit) | ISSUE-363: fixup record (run 4) | files under `docs/v2/evidence/remediation-20261114/run4/fixup/` only |

Every run below executed on a host checkout with `HEAD` printed in each `summary.txt` (`HEAD=` / `porcelain=` on the first line): `c9b2c3e7` for the red, `0e1a0d9f`
(the final code commit) for every green and mutation, porcelain 0 except the mutation runs, which show the one deliberately edited file (porcelain 1) and were restored (`restored porcelain=0`).
Vitest 4.1.10, Node 22.23.2. Both bases were restored fresh and verified: the accepted rebuild `afldb_v2_rb_rem3-6d5388ea.dump` (sha256 `d8397aab...f165c63`, 83-table count diff
**identical** to its published `table-counts.tsv`, `raw/rb-table-counts.diff` empty; 0 `auth_users`, season 2026 `complete`, 2027 `in_progress`, 0 `brownlow_season_votes` for 2026,
2026 Brownlow coverage `pending`) and the 4 Nov snapshot (30,141,895 bytes, sha256 `e77c307d...2826d`, ledger 118; 4 `auth_users`, 0 `brownlow_season_votes` for 2026, coverage `pending`).
Every experiment used a fresh `--template` copy, dropped afterwards; every vitest process ran through `isolated-pg run`. The B4 bundle sha256 `b1e2491b...7a74` was verified against
`/mnt/ssd/afldb-rem4-base/SHA256SUMS` and the clone printed B4's SHA before the scope's own bundle was fetched.

## 1. `settle-afl-api-state-b.test.ts`: the actor is suite-owned

### The defect (validated, class 2: test-harness defect)
`beforeAll` borrowed `SELECT id FROM auth_users ORDER BY id LIMIT 1` as the Match Sheet actor and threw when there was none. The accepted rebuild has 0 `auth_users`, so the file could not run
there at all. The run-3 design (fail closed on any unknown fixture-namespace row, never adopt) is kept; the refusal was never about residue but about borrowing a pre-existing row.

### The change (`a2b553ad`, `settle-afl-api-state-b.test.ts`)
* `ACTOR_EMAIL = CD_I4080-stateb-2071-actor@example.invalid` (`.invalid` is reserved, never deliverable). `auth_users` is unique on `lower(email)`, so every comparison lower-cases both sides.
* The actor is created **after** the pre-existing-row fingerprint: `INSERT INTO auth_users (email, role, password_hash, totp_secret, disabled_at) VALUES (<email>, 'admin', NULL, NULL, now())`.
  Credential-less and disabled, so it cannot sign in even if left behind. No `ORDER BY id LIMIT 1`, no role-based lookup, no borrowed user.
* `residue()` counts the actor (`authUsers`) and now also counts `data_overrides` / `data_edits` rows that reference it; `NO_RESIDUE` has `authUsers: 0`, so `beforeAll` **refuses a leftover actor** with the
  same message as every other leftover ("remove it deliberately, this file will not adopt it").
* `cleanup()` removes the rows that reference the actor (`data_overrides`, `data_edits` by `admin_user_id`, only this file ever writes them) and, last, the actor itself, keyed on the exact email **and** on the
  credential-less shape (`password_hash IS NULL AND totp_secret IS NULL`). A real account can never match; a referencing row this file did not remove fails loudly on the foreign key.
* `fingerprint()` gains `authUsers` (count) and `authUsersContent` (md5 of `to_jsonb` of every user **other than** the actor), compared in `afterAll`: a pre-existing user the file touched now fails.
* The settle itself, the saved Match Sheet, every earlier assertion and the run-3 guarantees are unchanged: the snapshot's real `(afl_api, CD_I297354)` identity row is asserted unchanged (content, or absence),
  the file's own leftovers are refused, ids are renamed in an in-memory fixture copy. The fixture ids JSON line now also prints `actorEmail`.

### Red (exact text, the unmodified file at `c9b2c3e7`, fresh accepted-rebuild copy, shared mode; `raw/red1rb/`)
```
 FAIL  tests/integration/settle-afl-api-state-b.test.ts [ tests/integration/settle-afl-api-state-b.test.ts ]
Error: afldb_test has no auth_users row; this file will not create one.
 ❯ tests/integration/settle-afl-api-state-b.test.ts:367:21
 Test Files  1 failed (1)    Tests  1 skipped (1)
```
(rc 1. The refusal is an environment property of the base, not a fixture error: `AUTH_USERS_BEFORE=0`.)

### Green (all at `0e1a0d9f`; per-table count diff `COUNTDIFF=0 tables=83` after every green, i.e. the file leaves all 83 public tables exactly as found)
| Run | Base | Mode | Result | `auth_users` before -> after | `(afl_api, CD_I297354)` before -> after | Raw |
|---|---|---|---|---|---|---|
| `g1rb` | rebuild | shared | 1 passed | 0 -> 0 | 0 rows -> 0 | `raw/g1rb/` |
| `g2rb` | rebuild | per-file `AFLDB_TEST_PER_FILE_DB=all` | 1 passed | 0 -> 0 | 0 -> 0 | `raw/g2rb/` |
| `g1snap` | snapshot | shared | 1 passed | 4 -> 4 (md5 `0f816df1...` unchanged) | 1 -> 1 (md5 `cf04e8f5...` unchanged) | `raw/g1snap/` |
| `g2snap` | snapshot | per-file `=all` | 1 passed | 4 -> 4 (unchanged) | 1 -> 1 (unchanged) | `raw/g2snap/` |

Order with `settle-afl-api.test.ts`: explicit **separate vitest processes on one fresh copy** (`SEQ=1`, one invocation per file, under the heavy lock), the per-step end times printed in each `summary.txt` prove the order:

| Experiment | Order | state-b | settle-afl-api | count diff / users / real row |
|---|---|---|---|---|
| `ordsbfirstrb` | state-b, then settle-afl-api | 1/1 passed | 73 passed / 1 failed (OD-5) | 0 / 0 -> 0 / 0 -> 0 |
| `ordsafirstrb` | settle-afl-api, then state-b | 1/1 passed | 73 / 1 (OD-5) | 0 / 0 -> 0 / 0 -> 0 |
| `ordsbfirstsnap` | state-b, then settle-afl-api | 1/1 passed | 73 / 1 (OD-5) | 0 / 4 -> 4 unchanged / 1 -> 1 unchanged |
| `ordsafirstsnap` | settle-afl-api, then state-b | 1/1 passed | 73 / 1 (OD-5) | 0 / 4 -> 4 unchanged / 1 -> 1 unchanged |

The single `settle-afl-api` failure in all four is the unchanged OD-5 case: `Error: Refusing to rebuild '<db>': the only explicit rebuild targets are 'afldb_test' ... 'code_test_db' ... A target is never
inferred from a DSN.` Class **4, deliberate refusal (rebuild-target name)**, identical to run 3 and not touched by this scope. `settle-afl-api` does not depend on `auth_users`: 73 pass on the 0-user rebuild.

### Own leftover is refused, not adopted (`leftrb`, `leftsnap`)
A fresh copy is seeded with exactly the actor row (`INSERT INTO auth_users ... 'CD_I4080-stateb-2071-actor@example.invalid' ...`; `AUTH_USERS_SEEDED` count 1 on the rebuild, 5 on the snapshot). State-b alone, shared:
```
AssertionError: a leftover fixture row exists; remove it deliberately, this file will not adopt it: expected { seasons: +0, matches: +0, …(16) } to deeply equal { seasons: +0, matches: +0, …(16) }
-   "authUsers": 0,
+   "authUsers": 1,
```
rc 1, `beforeAll` refused, the test skipped. As for every other own-namespace leftover (run-3 Residual 3), `afterAll` then removes the file's own row: `AUTH_USERS_AFTER` 0 on the rebuild and **4 with the original md5 `0f816df1...` on the
snapshot** (the four pre-existing users untouched), count diff 0, real identity row unchanged.

### Mutation proofs: the new guarantees bite (one temporary edit of the checkout each, restored; scratch copies)
| Mutation | Result |
|---|---|
| M1 `m1rb`, `m1snap`: the actor `DELETE` in `cleanup()` becomes a `SELECT` | the test passes but `afterAll` fails `AssertionError: no fixture row may remain: expected {...} to deeply equal {...}` (`authUsers: 1`); the copy ends with 1 user (rebuild) / 5 users (snapshot); count diff non-zero |
| M2 `m2snap`: the run also updates a **pre-existing** user (`totp_last_step`) | `AssertionError: a pre-existing row changed: expected { matches: 17056, …(22) } to deeply equal { matches: 17056, …(22) }`; the 4-user md5 changed (`0f816df1...` -> `274ca444...`) |

## 2. `club-comparison.test.ts`: the 2026 coverage expectation (finding F-CC-1 of the `clubcmp` record)

### The change (`0e1a0d9f`)
One assertion replaced (`expect(pending.coverage).toBe('pending')`, was :1845, now :1846-1870) plus the one import it needs (`BROWNLOW_DECLARED_NO_MEDAL_SEASONS`, :77). Nothing else in the file changed.
The expectation is an **independent oracle written in the test from raw tables**, never from `getClubSeasonBrownlowSummary`:

| Oracle input (raw SQL in the test) | Source |
|---|---|
| `count(*) FROM brownlow_season_votes WHERE season = 2026` | the loaded medal |
| `seasons.status` for 2026 | in progress |
| count of `brownlow_vote_entry_state` rows with `status IN ('final','void')` joined to `home_and_away` matches of 2026 | decisions this workflow holds |
| `BROWNLOW_DECLARED_NO_MEDAL_SEASONS` (the authority constant; its own test `tests/reference-data.test.ts` pins it to `data/reference/stat-availability.json`) | declared no-medal season |

Expected value, first match wins (the documented D-365-1 `season_total` rule, `src/db/queries/player-derived.ts` `recomputeBrownlowCoverage` comment; the test re-states it, it does not call it):
votes loaded -> `complete`; season in progress -> `pending`; final/void decisions held -> `partial`; declared no-medal -> `not_applicable`; otherwise `pending`.
The literal `pending` assertion stays, **explicitly guarded** by "no 2026 votes, no decision, not a declared no-medal season", which is today's state on both bases (measured on the two templates, `raw/guard-inputs.txt`: `decided2026=0 status2026=complete votes2026=0` on each, 2026 not declared, so the guarded literal branch is taken; `raw/mctlrb`, `raw/mctlsnap`: it passes).
The existing tie to `stat_availability` (`expect(pending.coverage).toBe(coverageOf.get(2026))`) is unchanged.
Provenance statement: the only literals are `2026` (the season under test) and the five coverage strings of the documented rule; no expected value is computed by the implementation under test.

### Green (`0e1a0d9f`, whole file, count diff 0 / 83 tables each)
`c1rb` rebuild shared **70 / 70**, `c2rb` rebuild per-file **70 / 70**, `c1snap` snapshot shared **70 / 70**, `c2snap` snapshot per-file **70 / 70** (`raw/c*/`). Targeted test on the unmutated bases `mctlrb`, `mctlsnap`: 1 passed.

### Mutation red: 2026 Brownlow results "loaded" (scratch copies only; seed `INSERT INTO brownlow_season_votes (season, player_id, club_id, votes) SELECT 2026, (SELECT min(id) FROM players), NULL, 1` plus `UPDATE stat_availability SET coverage = 'complete', is_recorded = true WHERE stat_key = 'brownlow_season_total' AND season = 2026`, which is what a reload does)
| Run | File | Result |
|---|---|---|
| `mold` (rebuild), `moldsnap` (snapshot) | OLD `c9b2c3e7` | **fails at the old assertion**: `AssertionError: expected 'complete' to be 'pending'` at `club-comparison.test.ts:1845:30` |
| `mnew` (rebuild), `mnewsnap` (snapshot) | NEW `0e1a0d9f` | the new assertion (`:1866`, expected `complete` from the raw votes) **passes**; the test then fails at a LATER, untouched statement: `expected true to be false` at `:1881` (see finding F-FX-1) |
| `mvotes` (rebuild) | NEW | votes inserted but `stat_availability` NOT recomputed (a reload that skipped the recompute): `AssertionError: expected 'pending' to be 'complete'` at `:1866`, so the oracle is independent of the function and detects inconsistent coverage |

## 3. Gate
`next typegen` rc 0; `tsc --noEmit` rc 0 (empty `raw/tsc.log`); `lint:gate` rc 0: `Lint gate (ratchet): 338 error(s) in 43 file(s) now; the ratchet baseline allows 338 in 43 ... PASSED` (`raw/lint-gate.log`);
porcelain 0 before and after. `tools/dev/lint-baseline.json` untouched.

## 4. Findings and notes
* **F-FX-1 (MED, outside this scope's edit allowance, escalated to the orchestrator): the same test still goes stale the day 2026 Brownlow loads.** The statement
  `for (const summary of [notApplicable, pending, missing]) { expect(summary.isAuthoritative).toBe(false); expect(summary.totalVotes).toBeNull(); ... }` (`club-comparison.test.ts:1880-1886`) treats the 2026 summary as
  non-authoritative. Proven by `mnew`/`mnewsnap`: with 2026 loaded the new oracle assertion passes and the test fails at `:1881` instead. The brief limited the edit to the single assertion, so this is **not fixed**.
  Proposed one-hunk change (for the orchestrator or a follow-up, test-only): iterate `[notApplicable, missing, ...(expected2026 === 'complete' ? [] : [pending])]`, and add
  `if (expected2026 === 'complete') { expect(pending.isAuthoritative).toBe(true); expect(pending.totalVotes).toBeGreaterThan(0); }` (totals then pinned against a raw `sum(votes)` oracle if wanted).
* **F-FX-2 (INFO): season 2071.** State-b has used fixture season 2071 since run 3 (`COMMITTING_SUITES` already lists the file; `COMMITTED_FIXTURE_SEASONS` has no 2071 entry and is unchanged). The run-4 brief §3a also
  allocates 2071-2072 to scope `shared`. No collision exists in this change (nothing new committed, prefix `CD_I4080` proven unused by a repository grep before use), but the orchestrator should keep `shared` off 2071.
* **F-FX-3 (INFO):** `settle-afl-api` OD-5 refusal (class 4) is unchanged and appears in every order run.
* The `fixup` host run never touched `settle-afl-api-brownlow*`, which still read the real `CD_I297354` through their own fixture readers (run-3 Residual 1); out of scope.

## 5. Proposed ledger text (ISSUE-363; local-only state, nothing pushed)
> Fixup (run 4): `settle-afl-api-state-b` no longer borrows a pre-existing `auth_users` row (`ORDER BY id LIMIT 1`) and so runs on the accepted rebuild (0 users): it creates a credential-less, disabled actor
> `CD_I4080-stateb-2071-actor@example.invalid` after its fingerprint, refuses a leftover actor in the residue check, removes the actor and the rows referencing it in `afterAll` (keyed on exact email and shape), and its fingerprint now
> covers every other user. `club-comparison`'s 2026 Brownlow coverage expectation is an independent raw-table oracle (votes -> complete; in progress -> pending; decisions -> partial; declared no-medal -> not_applicable; else pending),
> with the literal `pending` kept under a "no 2026 results loaded" guard. Validation: unfixed state-b on a fresh rebuild copy fails `afldb_test has no auth_users row; this file will not create one.`; fixed, 1/1 on the rebuild and the 4 Nov
> snapshot in shared and per-file modes and in both orders with `settle-afl-api`, per-table count diff 0 (83 tables), real `(afl_api, CD_I297354)` row and the four snapshot users unchanged, own leftover refused, two mutations fail;
> `club-comparison` 70/70 on both bases in both modes, and with 2026 results loaded on a scratch copy the old assertion fails (`expected 'complete' to be 'pending'`) while the new one follows; `tsc` rc 0, `lint:gate` PASSED 338/43.
> Open: the later `isAuthoritative` loop in the same `club-comparison` test (F-FX-1) still assumes 2026 is not loaded.

Proposed `CHANGELOG.md` (Unreleased) line: `Test harness: settle-afl-api-state-b creates and removes its own credential-less actor instead of borrowing an auth_users row (it now runs on a database with no users); club-comparison derives the 2026 Brownlow coverage expectation from raw tables instead of a literal.`

## 6. Files and hashes, process, incidents
`SHA256SUMS` lists every committed raw file and script. Raw: `raw/<label>/{summary.txt,vitest.log,counts.diff}` per experiment (`*-raw.log`, vitest JSON and the per-table count TSVs stay on the host in
`/mnt/ssd/afldb-rem4-fixup-20261115/evidence/<label>/`), scripts: `scripts/h4.sh` (host helper), `batch1.sh` (state-b), `batch2.sh` (club-comparison and its mutation), `batch3.sh` (mutations, typecheck, lint gate), `q.sh` (the read-only guard-input probe).
The mutation runs swapped one test file in the checkout and restored it with `git checkout HEAD -- <file>` (`restored ... porcelain=0` in `batch2.out` / `batch3.out`).
Process: single-file focused runs ran without the heavy lock; the two-file order runs, the whole-file club-comparison runs, the restores, `tsc` and `lint:gate` took `flock /mnt/ssd/afldb-rem4-base/heavy.lock`.
Incidents: none (no command outside authority; no orphan process; no database left in the cluster except the two templates).
