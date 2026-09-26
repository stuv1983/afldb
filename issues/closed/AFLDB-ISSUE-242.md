# AFLDB-ISSUE-242 — Cross-database manual player registration token convergence blocks ISSUE-237 L4

- **Status:** **Resolved (2026-09-26)** on retrospective operator-run acceptance evidence; see §12.
  Opened 2026-09-25. Implemented, DB-free validated, and **rehearsed on `code_test_db`**
  (§8a: 103/103 checks, generated step-2c SQL executed by PostgreSQL 16.15). *(2026-09-26:
  committed `bfafed36` and deployed to DEV. ISSUE-237 L4 PASSED at stamp `20260926-085511`; the
  §11 closure audit kept this issue open until the §12 evidence was supplied.)*
- **Severity:** High. It blocks the only path to ISSUE-237 L4 while `afldb_test` carries the 92
  ISSUE-224 registrations.
- **Area:** promotion lifecycle — `tools/db/promotion-inventory.ts`, `tools/db/promotion-check.ts`,
  the step-2c lineage remap file, `docs/production-promotion.md` §6.
- **Origin:** AFLDB-ISSUE-237 final L4 pre-commit review, FR-2 / A4.2 (runbook §11d.8 points 1 and
  3, §11d.11).
- **Branch / worktree:** `sonnet/issue-242`, `D:\dev\afldb-issue-242`.

## 1. Pre-change failure mode

A `manual_admin_edit` token is minted once per database (`randomUUID`, `createPlayerInTransaction`).
The same person registered on `afldb_test` (the candidate's source) and on DEV therefore carries
two different tokens. ISSUE-237's A4.2 gate (`planPromotionPlayersReplay`, run at B4 =
`--phase restored` and C2 = `--phase candidate`) correctly refuses two states:

- **different token, same path.** Target record `manual_admin_edit:A` names path P, and the
  candidate player holding P already carries token B. The post-swap `replay_admin_overrides(players)`
  would bind A beside B, which gives one person two tokens. `readManualPlayerToken` returns null
  for more than one token, and only one of them has a creation record.
- **candidate-only token.** Candidate token B has no target creation record. The target's
  `data_overrides` replaces the candidate's, so B would survive the swap as a manual identity with
  no creation record. `registrationsFromLive` (ISSUE-245) refuses that state.

`afldb_test` carries 92 such registrations (ISSUE-224, carried through ISSUE-245 and ISSUE-237 L3).
DEV cannot hold the same tokens. Every one of them was therefore a B4 STOP, whether DEV registered
the same people (the first case) or not (the second). No supported mechanism converged them:
tokens are never edited, and no promotion step wrote a rebuilt table.

## 2. Authority / convergence contract

- **Cross-database identity is the accepted, unique AFL Tables profile path**
  (`afltables` / `afltables_profile_url`, status `unique` or `resolved`, held by exactly one
  player). Nothing uses `players.id` across databases, a name, fuzzy matching, or token equality
  across databases.
- **A candidate token is transport-local.** It is never carried as cross-database authority.
- **The target (DEV) is authoritative** for its own registrations. Its creation record survives
  byte for byte (the reinstate is verbatim), and its token is the one the promoted database
  carries.
- **The candidate's creation record is never carried into the target.** Doing so would promote a
  decision DEV never took, under an actor DEV does not hold (`afldb_test`'s recovery actor 144).
- Convergence is **planned at `--phase restored`** (B4), which reads both databases. It is
  **written at plan step 2c** inside the lineage remap file's single transaction, and it is
  **re-proven at `--phase candidate`** (C2) by the unchanged A4.2 planner over the real candidate.

For each candidate token B that no active target creation record names, let X be the candidate
player it is on and P the one accepted AFL Tables path X holds:

| Outcome | Condition | Write at step 2c |
|---|---|---|
| **rebind** | exactly one target creation record names P, and its token A is held by no candidate identity | one statement: `DELETE` B from X, feeding `INSERT` of A onto X (`resolved`, `manual_admin_edit`), as the replay's bind would write it |
| **retire** | no target creation record names P, and the TARGET holds P as an accepted identity on exactly one player that carries no manual token | `DELETE` B from X; X stays source-owned by P |
| **STOP** | anything else | none (the restored run FAILs, so no remap file is published) |

## 3. The ten identity cases

| # | Case | Behaviour |
|---|---|---|
| 1 | same path, same token | no convergence; the replay finds it *present* |
| 2 | same path, different token | **rebind**: B retires, A binds to X in one statement; the replay then finds A *present*; one player, one token |
| 3 | candidate P + B, target holds P but no registration | **retire**: B is deleted and X stays owned by P. The target must prove P source-owned: an accepted identity on exactly one target player with no manual token. Otherwise STOP. |
| 4 | target P + A, candidate P with no token | no convergence; the existing ISSUE-160 replay bind attaches A to X after the swap, predicted and gated as *bind* |
| 5 | same token, different path | STOP (unchanged A4.2); also STOP if the target token for P is already held by another candidate player |
| 6 | two target tokens → one candidate player | STOP: the player holds two paths, or two records name one path, or the replay's own "converges on" STOP applies |
| 7 | ambiguous AFL Tables path | STOP: P is held by another candidate player too |
| 8 | unaccepted / non-unique AFL Tables identity | STOP: no accepted path, or P has an unaccepted row, on either side |
| 9 | manual-only player | candidate-only manual-only token: STOP, because there is no durable cross-database identity and no name is read. A target manual-only record keeps its own token contract: *present* if the candidate holds the token, otherwise the replay *creates* it. |
| 10 | missing candidate path | the target record *creates* the player through the existing production replay contract; STOP if P is present but not bindable |

The **candidate-only orphan** (B + P, and the target neither records nor holds P) is a STOP: the
token is candidate-only provenance DEV never took.

## 4. Implementation

- `tools/db/promotion-inventory.ts`
  - New section: `planManualIdentityConvergence`, `convergencePathsToRead`,
    `applyManualIdentityConvergence`, `manualIdentityConvergenceSql`, and the types
    `ManualIdentityConvergenceEntry` / `ManualIdentityConvergencePlan`. All are pure, sorted and
    deterministic.
  - `LineageRemapInput.convergence`: `lineageRemapSql` emits the convergence section inside the
    remap transaction, after the per-row remaps and before `COMMIT`, with a post-COMMIT
    verification query. With no convergence, the file is byte-identical to before.
  - The `planPromotionPlayersReplay` doc and two STOP messages now name ISSUE-242. Its logic is
    unchanged.
- `tools/db/promotion-check.ts`
  - `PROMOTION_CONVERGENCE_TARGET_IDENTITIES_SQL` is the target's afltables rows for the relevant
    paths, plus manual tokens on their holders. Target ids never leave the read.
  - `gateOverrideReplayTargets(..., convergence?)` gains a new gate line, "manual player
    registration token convergence planned (AFLDB-ISSUE-242)". A4.2 is predicted over
    `applyManualIdentityConvergence(candidate, entries)`, and the function returns
    `convergence`.
  - `--phase restored` now runs A4.2/A4.3 **before** `gateLineageIdentity` and passes the entries
    into it. If the database has no lineage-bound table (no remap step exists), a non-empty
    convergence FAILs.
  - `--phase candidate` is unchanged: it plans nothing, and a token step 2c did not converge is
    the A4.2 STOP.
- `docs/production-promotion.md` §6: the convergence contract replaces "token convergence, not
  implemented".
- `tests/db-promotion-check.test.ts`: a new describe block (22 cases, §6 below).

**Not changed:**

- `tools/migration/rebuild_manual_registrations.ts`: `registrationsFromLive` is used as the
  final-state oracle and is not modified.
- `replay_admin_overrides(players)`.
- `src/lib/acquisition/afl-api-adjudication.ts`: G2 already refuses a manual-token ledger
  identity (`UNEVALUABLE`), and the convergence changes no AFL Tables path.
- The `afldb_test` rebuild (`tools/db/rebuild-test.ts`) in general.

## 5. Final-state invariants (asserted by the step-2c SQL before COMMIT, and by C2)

- **One canonical player per path.** X holds P as an accepted identity, and no other row for P
  exists (per entry).
- **At most one manual identity per player.** `rebind`: the tokens on X are exactly `{A}`.
  `retire`: X has none. Globally, no player has two.
- **Every surviving manual token has exactly one active creation record.** This is a global
  assertion over the reinstated DEV `data_overrides`.
- **No candidate-only orphan manual identity remains.** Every retired B is absent from the whole
  candidate.
- **No target-authoritative registration is silently dropped.** `rebind` requires the active
  record `manual_admin_edit:A` / `identity` with `afltables_profile_path = P` to be present.
  `retire` requires that no active record names B or P. Every other record is still A4.2's
  present / bind / create.
- **The path and the token agree on one player.** This is the per-entry assertion, and
  `registrationsFromLive` accepts the final state (tested).
- **No surrogate id crosses the lineage boundary.** Candidate player ids appear only in
  candidate-side SQL. Target ids are compared only inside the target read.
- **Rebuild and next promotion.** `registrationsFromLive` (the ISSUE-245 capture refusal) passes
  on the final state. Planning convergence again over the promoted state yields nothing.

## 6. Idempotence and retry

- **Deterministic.** Entries are sorted by candidate token. The same readings in any row order
  give the same plan and byte-identical SQL, so a retried candidate preparation (drop, re-restore,
  re-run `--phase restored`) publishes the same file.
- **One transaction, fail-closed.** The whole remap file is `BEGIN … COMMIT` under
  `ON_ERROR_STOP`. The candidate-token cleanup and the target-token binding are the same
  statement, and the final-state assertion `RAISE`s inside the transaction. A partial failure
  therefore commits nothing and cannot strand an unsupported token.
- **Re-run is a no-op.** The `rebind` INSERT reads only the rows its DELETE just retired
  (`WITH retired AS (DELETE … RETURNING …) INSERT … FROM retired`), so a re-run inserts nothing.
  There is no `ON CONFLICT`: a target token already present anywhere raises. The assertions pass
  again. `applyManualIdentityConvergence` is idempotent (tested).
- **No post-swap cleanup.** The candidate is fully converged before C2 and before the swap. The
  post-swap replay only finds A *present*.

## 7. Tests (DB-free, `tests/db-promotion-check.test.ts`, "AFLDB-ISSUE-242 …")

The block has 22 cases:

- **Identity cases (1)–(10).** These include the retire proof failures and the manual-only
  variants.
- **Candidate-only orphan, and control-character refusal.**
- **Retry and idempotence.** Plan, apply, SQL and the converged state are covered.
- **SQL shape.** The block checks ordering inside the transaction, the one-statement rebind, no
  `ON CONFLICT`, the assertions, no name, the structural remap guard, and that an empty
  convergence gives the unchanged file.
- **DEV plan.** Step 2c follows the `data_overrides` restore.
- **B4 restored.** The benign case now PASSes and publishes a file carrying the convergence. The
  retire case reads the target for P only. Six contradictory cases FAIL and publish nothing.
- **C2 candidate.** It PASSes after 2c, and STOPs when 2c was not applied.
- **Scale.** A 92-player set (46 rebind, 46 retire) converges through the gate, and the final
  state passes `registrationsFromLive` and `readManualPlayerToken`.
- **Wiring.** Restored plans before the lineage gate; candidate plans nothing.

`registrationsFromLive()` and `readManualPlayerToken()` are exercised on the final state in cases
2, 3, 4 and the scale case. `readManualPlayerToken` runs over a fake tagged-template transaction
that answers its one query from the simulated identity set.

## 8. Validation (2026-09-25, DB-free, Claude-run)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run tests/db-promotion-check.test.ts` | 186 passed (164 before + 22 ISSUE-242) |
| `npx vitest run tests/player-link-mutations.test.ts` | 112 passed |
| `npx vitest run tests/db-test-rebuild.test.ts -t "AFLDB-ISSUE-245"` | 29 passed |
| `npx vitest run tests/db-test-rebuild.test.ts -t "AFLDB-ISSUE-237"` | 111 passed, **1 failed** (pre-existing, environmental; see below) |
| `npx eslint` on the three changed TypeScript files | clean |
| `git diff --check` | clean |

The single `-t "AFLDB-ISSUE-237"` failure is "never populates a credential or auth-token field…"
(`tests/db-test-rebuild.test.ts:8238-8240`). It slices `rebuild_afl_api_adjudications.ts` at
`'\n}\n'`, which does not exist in this worktree's CRLF checkout (`core.autocrlf=true`). The slice
therefore runs to the end of the file and meets an unrelated `INSERT INTO`. ISSUE-242 touches
neither that test nor that file. This is the known Windows CRLF contract-test class; it passes on
LF/Linux.

**Re-validation after the §8a rehearsal (2026-09-25, Claude-run).**

| Command | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run tests/db-promotion-check.test.ts` | 189 passed (186 + 3 harness cases: acknowledgement/argument refusals, namespace, scale mix) |
| `npx vitest run tests/player-link-mutations.test.ts` | 112 passed |
| `npx vitest run tests/db-test-rebuild.test.ts -t "AFLDB-ISSUE-245"` | 29 passed |
| `npx vitest run tests/db-test-rebuild.test.ts -t "AFLDB-ISSUE-237"` | 111 passed, 1 failed (the same CRLF baseline failure below) |
| `npx eslint` on the four changed/new TypeScript files | clean |
| `git diff --check` | clean |

**The baseline proof for the one failure.** `tests/db-test-rebuild.test.ts` and
`tools/migration/rebuild_afl_api_adjudications.ts` have no diff against HEAD
(`git diff HEAD` is empty), and HEAD equals `main` (`e826dd56`) for both. The working file's
blob hash equals HEAD's (`063af6d7…`). `git ls-files --eol` reports `i/lf w/crlf`.
- In the CRLF checkout, `indexOf('\n}\n')` is -1 (the `\r\n}\r\n` form is at 847), so
  `slice(0, -1)` runs to the end of the file and meets a later `INSERT INTO`.
- With LF normalised, the `remapActors` body contains `insertAttributionOnlyActor(tx, actor)` and
  no `INSERT INTO`, so both assertions pass.

The failure is environmental and belongs to the known Windows CRLF class. It is not an ISSUE-242
regression.

The worktree had no `node_modules`. A directory junction to `D:\dev\afldb\node_modules` (an
identical `package-lock.json` hash) was created to run the checks. It is gitignored.

**Why DB-free proof suffices for this pass.** The planner, the SQL generator and the gates are
pure or run over fake query functions. The final state is checked by the real ISSUE-245 and
`readManualPlayerToken` code. What DB-free proof cannot show is PostgreSQL executing the generated
DO-block and CTE. That is a syntax/semantics check of generated SQL, and it belongs in a
`code_test_db` rehearsal (§9), not DEV.

## 8a. `code_test_db` rehearsal (2026-09-25, operator-authorised, Claude-run)

**Harness.** `tools/db/promotion-convergence-rehearsal.ts` (new, tracked):
`npx tsx --conditions=react-server tools/db/promotion-convergence-rehearsal.ts run --acknowledge
code_test_db --out <dir> [--scale 92]`, plus `residue` and `teardown --acknowledge code_test_db`.
It reads only `AFLDB_CODE_TEST_DATABASE_URL`, through the shared `resolveRehearsalDsns`, which
refuses any database but `code_test_db`. It re-checks `current_database()` inside every write
transaction. It re-implements nothing:

- **Planning** is the real `gateOverrideReplayTargets` with a `convergence` target, which is
  exactly `--phase restored`'s A4.2 call.
- **The file** is the real `lineageRemapSql({ candidate: 'code_test_db', plans: [], convergence })`.
  There are no lineage plans, so the file carries the `$bind$` guard, the convergence section and
  the post-COMMIT query, and the convergence section is exactly what the generator emits inside a
  real remap file.
- **Execution** is `psql -X -v ON_ERROR_STOP=1 -f <file>`, as step 2c runs it.
- **C2** is the real `gateOverrideReplayTargets` with no convergence, over the candidate alone.
- **Oracles** are the real `registrationsFromLive(readLiveRegistrationState())` and
  `readManualPlayerToken()`.
- **The target** is simulated, because DEV was never contacted. It is the schema
  `issue242_rehearsal_target` inside `code_test_db` (`sources`, `external_identities`,
  `data_overrides`), read through a connection whose `search_path` is that schema only, so the
  checker's own target SQL runs unchanged. Target player ids are synthetic and never leave that
  read.
- **Plan step 2a** (the target's `data_overrides` replacing the candidate's) is simulated for the
  fixture rows only.

**Preflight** (before any write): `current_database=code_test_db`, `current_user=afldb_owner`,
`transaction_read_only=off`, server 16.15. Isolation PASS: 0 fixture residue, 0
`manual_admin_edit` identities and 0 replayable `data_overrides` outside the fixture (so the
step-2c global assertions saw only fixture rows), no other session, and no rebuild marker. The
baseline was 13,273 players, 18,332 identities, 0 `data_overrides` and 0 `auth_users`.

**Namespace.** Player slugs `issue242-rehearsal-…`, AFL Tables paths `players/Z/Zz242_…`, tokens
`2420cccc-…` (candidate) and `2420dddd-…` (target), the target schema, and one attribution-only
actor (`issue242-rehearsal-fixture@example.test`). Each world is seeded, run and torn down, with
a zero-residue check before the next.

**Result: 103/103 checks PASS** (evidence: `D:\tmp\afldb-issue242-rehearsal\run.log` and the
`*.step2c.sql` artefacts beside it).

| Case | Result |
|---|---|
| **A rebind** | B4 planned 1 rebind; gates PASS. 2c: `BEGIN, DO x2, INSERT 0 1, COMMIT`, exit 0. X is the same `players.id`, P is unchanged and accepted on X, B is absent everywhere, A is on X (`resolved` / `manual_admin_edit`, the convergence note), and X has exactly one token. Target record A is present and byte-identical to the target's; candidate record B is absent. Global: 1 token, 0 orphans, 0 multi-token players, 0 duplicate paths, 0 records without a token. `registrationsFromLive` has no problems (A on X with P); `readManualPlayerToken(X) = A`; C2 A4.2 PASS. |
| **B retire** | 1 retire; 2c `DELETE 1`, exit 0. X remains and P remains accepted on X; B is removed; X has no token; there is no record for B or P. Global all 0; `registrationsFromLive` is clean (0 registrations); `readManualPlayerToken(X) = null`; C2 PASS. |
| **C same path, same token** | No convergence planned (A4.2 *present*). The file has no convergence section, and running it changes nothing (census identical). `registrationsFromLive` and C2 PASS. |
| **D different-token collision** | B4 FAILs at the convergence gate: "target token … is already held by candidate player(s) …; same token, different person". No file; census unchanged. |
| **E1 two target records, one path** | STOP: "is named by 2 target creation records". |
| **E2 two target tokens, one candidate player** | STOP: "holds 2 AFL Tables profile paths". |
| **F same token, different path** | Convergence plans nothing; A4.2 STOP: "same token, different path". |
| **G1 / G2 ambiguous path** | Candidate side STOP: "holds no accepted AFL Tables profile path". Target side STOP: "holds … ambiguously". |
| **H orphan** | STOP: "the target neither records a registration … nor holds it". |

Every STOP world ends with `--phase restored` FAIL, no entry and no file, and a byte-identical
census.

**Refusal and rollback (the real-transaction proof).** Each world compares a before/after census
(sha256 over every fixture identity, creation record and player row).

- **R1, collision at execution.** A file was planned while A was free. After 2a, a second
  candidate player took A (drift), then the file ran.
  - Under `ON_ERROR_STOP`: exit 3, `duplicate key value violates unique constraint
    "external_identities_uq"`, raised by the rebind statement itself (no `INSERT` tag).
  - The census is identical: B is still on X, P is still on X, A is only on the drift player, and
    the records are unchanged.
  - **The CTE's `DELETE` of B did not survive its failed `INSERT`.**
- **R2, assertion after a successful CTE.** The same file ran without the 2a reinstate.
  - Under `ON_ERROR_STOP`: `INSERT 0 1` executed, then `DO $converge$` raised "rebind of … did
    not reach its planned state", exit 3.
  - The census is identical: B is back on X, A is absent, and record B is still present.
  - **A completed `DELETE … RETURNING … INSERT` is rolled back by the later assertion.**
- **Without `ON_ERROR_STOP`**, R1 and R2 again: psql continues, the aborted transaction's
  `COMMIT` returns `ROLLBACK`, and the census is identical. The file is atomic in both modes.

**Same artefact executed twice.** Safe no-op, committed.

- Rebind re-run: `INSERT 0 0`. Retire re-run: `DELETE 0`. Scale re-run: `INSERT 0 0` x62 and
  `DELETE 0` x30.
- The assertions pass again, and the census is byte-identical.

**Normal retry / re-plan.** `--phase restored` re-planned over the converged candidate yields 0
entries with gates PASS. Its file has no convergence section, and running it is a no-op.

**92-player scale** (`scaleWorld(n)`: every third retires, so 62 rebind and 30 retire; nothing
depends on 92):

- B4 planned 92 entries; gates PASS. The file is 1,051 lines (sha256 `262bea2b…8433`).
- 2a reinstated 62 records. 2c: `INSERT 0 1` x62, `DELETE 1` x30, `COMMIT`, exit 0.
- 92/92 players were verified individually: the candidate token is gone, the expected token (or
  none) is on the same row, and the path is on the same row.
- Global: 62 tokens, 0 orphans, 0 players with more than one token, 0 duplicate paths, 0 records
  without a token.
- `registrationsFromLive` has no problems (62 registrations); C2 PASS; the re-plan is empty; the
  re-execution is a no-op.
- The world ran in about 22 s over the 55432 tunnel.

**Cleanup.** The final residue is `{players 0, identities 0, records 0, actors 0, targetSchema 0,
dataEdits 0}`. An independent read-only psql census afterwards matched the baseline exactly
(13,273 players, 18,332 identities, 0 `data_overrides`, 0 `auth_users`, 0 `data_edits`, no
`issue242*` schema, 0 manual tokens, database comment `<NULL>`). `code_test_db` was not dropped.
Only the `players` identity sequence advanced (sequences do not roll back); that is harmless.

**First attempt (recorded honestly).** The first run was 71/103. The cause was a **fixture**
defect: the harness bound creation-record payloads as `$n::jsonb` from a JS string, which
postgres.js double-encodes into a jsonb *string*. Every rebind path therefore STOPped at planning
("the override payload is not a JSON object"), and the checker behaved correctly. The harness
also executed files for worlds whose plan had FAILed. That file was never published by the
checker, but the run is incidental evidence of rollback anyway: the scale file executed `DELETE
1` x30, then the global assertion raised and all 30 were rolled back. The fix was
`::text::jsonb`, a jsonb-object guard at seed, and "no file unless the plan passes". Then came the
103/103 run. Cleanup was complete after both runs. Log: `run-1-fixture-bug.log`.

**Scope limits.** This rehearses the step-2c SQL and the B4/C2 gates against real PostgreSQL. It
does not rehearse a real `afldb_test` → DEV lineage file with lineage plans, DEV's live values,
the swap, or the post-swap `replay_admin_overrides(players)`. The file header reads
`(prod)` because the harness passes no `--environment`; that affects only a comment line.

## 9. Remaining before ISSUE-237 L4

1. **Operator review and commit** of ISSUE-242 (uncommitted, now including the rehearsal harness
   and its three DB-free tests), then `merge:ready`, the merge and the DEV checkout, together
   with ISSUE-237's uncommitted L4 hardening.
2. **Done:** the `code_test_db` rehearsal of the step-2c file (§8a).
3. **L4's live values still decide.** B4 PASSes the benign cases only.
   - If DEV holds a 92-cohort path under a token that `afldb_test` also holds elsewhere, or holds
     P ambiguously, B4 STOPs.
   - If DEV neither registered nor holds a path, B4 STOPs (orphan).
   - A4.3 (2026-keyed overrides) is unchanged and can still STOP L4.
   - G2 still refuses a DEV ledger entry whose stored identity is a bare manual token
     (`UNEVALUABLE`); ISSUE-242 does not weaken it.
4. ISSUE-237's runbook §11d must be read with this issue. B4 stays fail-closed on the code
   actually deployed until ISSUE-242 is merged.

## 10. Confirmation

- **2026-09-25 implementation pass.** No database was contacted, and there was no SSH, no
  DEV/PROD action and no L4. The only Git command run was `git diff --check`, and nothing was
  committed.
- **2026-09-25 rehearsal pass (§8a).** Only `code_test_db` was contacted, over the existing
  127.0.0.1:55432 tunnel with the database name swapped from the `afldb_test` DSN; no connection
  was opened to `afldb_test` itself. There was no `afldb_dev` or production contact and no SSH,
  and ISSUE-237 L4 was not run. The only Git commands were read-only: `status`, `diff`,
  `ls-files --eol`, `hash-object`, `rev-parse`, `merge-base` and `diff --check`. No Git write,
  no commit.

## 11. Closure audit against ISSUE-237 L4 (2026-09-26, DB-free, Claude-run): REMAINS OPEN

*(Historical. Superseded by the §12 resolution the same day.)*

The audit covered the accepted L4 record: ISSUE-237 runbook §11d.12–§11d.15, the `issues.md`
ISSUE-237/249 entries, and `issues/closed/AFLDB-ISSUE-249.md` §9. No database was contacted, and
there was no SSH.

- **Implementation state.** Committed `bfafed36`, which is contained in every later DEV deployment
  (`4bb23a8f`, `397f422d`, `6ae70722`). The first L4 A2 attempt already ran on DEV at `bfafed36`.
- **Recorded L4 evidence** (stamp `20260926-085511`):
  - "A/B/C gates (candidate, pre-swap, swap) passed after the documented targeted grid repair";
  - E1, the admin-override replay, PASSED;
  - A4.2 was recorded earlier as DEV 92 / source 92 (§11d.12–§11d.14).
- **What that implies, not what it records.** Tokens are minted per database, and both sides carry
  the 92 ISSUE-224 registrations. So a B4 PASS on this code is only reachable through a planned
  convergence, and a C2 PASS re-proves it. **The L4 run therefore very probably exercised this
  issue.** But the recorded evidence is a summary line, not the contract's evidence.
- **Missing (NOT RECORDED; the step ran):**
  1. the B4 `[PASS] data_overrides players replay predicted … (A4.2)` line with its
     present/bind/create counts and its convergence (rebind/retire) counts, which §11d B4 says to
     "Record all of it";
  2. evidence that step 2c applied the convergence: the `$LFILE` convergence section and the psql
     result of C1's 2c;
  3. the C2 A4.2 PASS line, with the same counts as B4.

  No record names a rebind or retire count. The "documented targeted grid repair" inside A–C is
  not documented anywhere in the repository.
- **Closure path (operator; the retained files are read-only material on the DEV host):**
  - `~/backups/afldb/promotion-dev-lineage-20260926-085511.sql` (its convergence entries);
  - `~/backups/afldb/promotion-dev-20260926-085511.sha256`;
  - the B4 and C2 console output, if kept.

  Resolve on the counts that those show. Do not resolve on "L4 passed" alone.

## 12. Resolution (2026-09-26): RESOLVED on retrospective operator-run acceptance evidence

The implementation was already committed and deployed. The DB-free (§8) and `code_test_db`
rehearsal (§8a) evidence remains valid and was not rerun. This record was written from
operator-supplied evidence; no database, host or acceptance command was run to write it.

- **Accepted L4 stamp:** `20260926-085511`.
- **Retained step-2c lineage file:** `~/backups/afldb/promotion-dev-lineage-20260926-085511.sql`.
  - Recorded SHA256 `784e97594f810fe66cddc996d08a1654d7351e7f8a554571557b9e4bb7b2dbb9`. The
    file's current SHA256 matched it.
  - Its convergence entries: **92** candidate `manual_admin_edit` tokens are transport-local;
    **92 rebind** onto the target token for the same AFL Tables path; **0 retire**.
- **Read-only DEV verification** (deployed revision `dd7e28a6`):
  - `database = afldb_dev`, role `afldb_import`, `transaction_read_only = on`;
  - `manual_tokens = 92`, `distinct_players = 92`;
  - ISSUE-242 convergence-note rows = **92**, with the exact note "Bound at the promotion boundary
    by manual identity convergence (AFLDB-ISSUE-242).";
  - `tokens_without_exactly_one_creation_record = 0`;
  - `players_with_multiple_manual_tokens = 0`;
  - the invariant exception query returned no rows.
- **Closure basis.** The immutable retained step-2c plan proves 92 rebind / 0 retire, and the
  promoted DEV state proves that all 92 planned convergences are present and satisfy the §5
  final-state token invariants (one creation record per surviving manual token, at most one manual
  token per player). This is the counts-based evidence §11 asked for, not "L4 passed" alone.
- **Not available.** The original B4 A4.2 and C2 console lines (present/bind/create and
  rebind/retire counts as printed), and the psql result of C1's 2c, were not retained. They are
  **not** claimed as recovered; the counts above come from the retained plan file and the current
  DEV state.
- **Scope.** This resolves ISSUE-242 only. AFLDB-ISSUE-237 remains OPEN (L5 PROD not run). No PROD
  action is implied.
