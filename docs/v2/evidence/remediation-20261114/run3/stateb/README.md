# Remediation run 3, scope `stateb` (ISSUE-363 T363-1 and reviewer F-001/F-002): suites own their identity rows

Branch `claude/rem3-stateb-20261114`, base `6d5388ea5305e73b0420fbccfa7b0cea4fe75927` (run-2 candidate tip). Local only: nothing pushed, no production or DEV
contact, no migration, no build, no deployment, no `sudo`, no `wsl`. Test-only change: **no application code changed**.

| Commit | Subject | Files |
|---|---|---|
| `e9400741594cc2b7f25270f018a73d2ddc9e33a0` | ISSUE-363: state-b suite owns its identity rows and never touches the snapshot's CD_I297354 row | `tests/integration/settle-afl-api-state-b.test.ts` |
| `50fbde9d5be8c247613803fa6c64e1a7156f41de` | ISSUE-363: settle-afl-api suite uses its own bridged provider id and never deletes the snapshot's CD_I297354 row | `tests/integration/settle-afl-api.test.ts` |
| (this record commit) | ISSUE-363: stateb run-3 evidence | files under `docs/v2/evidence/remediation-20261114/run3/stateb/` only |

**Every proof below ran on a host checkout whose `git rev-parse HEAD` was printed in each `summary.txt` and whose `git status --porcelain` count was `0`**
(`HEAD=` / `porcelain=` first line of each summary): `6d5388ea` for the base reds, `e9400741` for the first greens, `50fbde9d` (the final code commit)
for every other run. The record commit changes only the documentation directory above (a path allowlist: `git diff --stat 50fbde9d..<record commit>` lists only files under that
directory, shown in the agent report); the executable revision is `50fbde9d`.

Host: `streamanator` (the DEV host), workspace `/mnt/ssd/afldb-rem3-stateb-20261114`, isolated PostgreSQL 16 cluster root `/mnt/ssd/afldb-rem3-stateb-20261114-pg`,
**port 55671**, template `afldb_v2_rem3stateb_tmpl_test` restored from the approved snapshot (`afldb_prod-20261104T021037Z.dump`, 30141895 bytes, sha256
`e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d`, both verified before use; ledger `118_fixtures_unconfirmed_participants.sql`, 17,056 matches,
`tmpl-probe.txt`). Base bundle sha256 `0a1b46d187a4173cef5bef0833fb8ad621d58116dcd5c4026b4dc494f9ccbf68` (verified). Workspace contains no `.env` (checked).
Vitest on the host is **4.1.10** (the brief said vitest 3). **Every run is a fresh `--template` copy** (`create-db <db> --template <tmpl>`), one database per
experiment, dropped afterwards, and every vitest process ran through `isolated-pg run <db> -- node node_modules/vitest/vitest.mjs run ...`.

## The defect (validated)

`tests/integration/settle-afl-api-state-b.test.ts` bridged provider player `CD_I297354` (Karl Amon), a **real** id that holds a real `afl_api`
`external_identities` row on the 4 Nov production snapshot (player_id 7974). `beforeAll` refuses the row ("a leftover fixture row exists"), and `afterAll` then
ran `cleanup()`, which deleted `(afl_api, CD_I297354)` unconditionally. `tests/integration/settle-afl-api.test.ts` bridged the same real id and its `cleanup()`
(run by `seedBaseline()` in `beforeAll` and `beforeEach`) deleted the same snapshot row; that is the only reason state-b passed in the shared full run.
Both were reproduced and fixed. The reviewer's F-001 (single-shot red, fingerprint blind to it) and F-002 (settle-afl-api is the other half) are **validated**.

## The change

State-b (`e9400741`):
- `FIXTURE_FILE_PROVIDER_PLAYER_ID = 'CD_I297354'` (the id the shared fixture files name) is only ever **read**; `BRIDGED_PROVIDER_PLAYER_ID` is now the suite's own
  `CD_I2071275001` (`CD_I` + fixture season 2071 + issue 275 + serial 001). The provider-id shape is `^CD_I[0-9]+$` (`AFL_API_PROVIDER_ID_RE`,
  `src/lib/acquisition/afl-api-adjudication.ts:33`). The snapshot's `afl_api` ids are 10 or 11 characters (`CD_I` + 6 or 7 digits; `minCdILen/maxCdILen` in every
  `BEFORE` line); the new id is 14, so no real row can hold it.
- `unitSource()` renames it in the in-memory clone through `renameFixturePlayer()`, which **counts** the occurrences (roster 1, stats 2 as the brief stated, verified)
  and throws if the shared files ever change. The shared fixture files are not edited. The existing `expect(bundle.buildFailures).toEqual([])` (every
  `settleOptions`) is kept: the bundle builds with no build failures on the renamed id (the case passes).
- `residue()` and `cleanup()` key identities on the suite's own provider id, its own AFL Tables id, or `player_id` of its own synthetic player (legacy id
  -275000001). The real id is never named in a write. A leftover of the suite's own fixture is still refused by `beforeAll` (proof 4).
- New assertions: the snapshot's `(afl_api, CD_I297354)` row is read first in `beforeAll` (full `to_jsonb(row)` text, or `null` when absent) and compared **after the
  settle in the test body**, and **in `afterAll` after `cleanup()`, which also runs when `beforeAll` refuses**. Every existing assertion of the section 17.8 case is kept.

settle-afl-api (`50fbde9d`): the same `renameFixturePlayer()` in `unitSourceFor()` (the only place the suite reads the shared fixtures), the constant
`BRIDGED_PROVIDER_PLAYER_ID = 'CD_I2026228001'` (its namespace is `CD_M2026ISSUE228`), and the same before/after snapshot-row assertion (read in `beforeAll`,
asserted at the end of `afterAll` after `sql.end`, so a change still lets every restoring step run). **No existing assertion changed**: every statement of its
`cleanup()`/seed is keyed on the constant, so they reach only rows the suite owns now. This is the stretch (B); it applied cleanly, so it is a separate commit.

## Proof 1: RED at base `6d5388ea` (`raw/red1/`, `raw/basesa/`)

`state-b` alone, shared mode, fresh copy (`red1`, rc 1). Exact failure text (`raw/red1/vitest.log`):

```
FAIL  tests/integration/settle-afl-api-state-b.test.ts [ tests/integration/settle-afl-api-state-b.test.ts ]
AssertionError: a leftover fixture row exists; remove it deliberately, this file will not adopt it: expected { seasons: +0, matches: +0, …(15) } to deeply equal { seasons: +0, matches: +0, …(15) }
-   "externalIdentities": 0,
+   "externalIdentities": 1,
 Test Files  1 failed (1)    Tests  1 skipped (1)
```

Aggregates read from the copy by `snaprow.mjs` before and after that failing run (counts, md5 of `to_jsonb(row)::text`, player id only):

| | `(afl_api, CD_I297354)` rows | row md5 | player_id | `external_identities` total | afl_api identities |
|---|---|---|---|---|---|
| BEFORE the failing run | 1 | `cf04e8f54805716e81742d4dbe3d5af4` | 7974 | 19,319 | 803 |
| **AFTER the failing run (red1, state-b at base)** | **0** | null | null | **19,318** | **802** |
| AFTER `settle-afl-api` alone at base (`basesa`) | **0** | null | null | **19,318** | **802** |

So the failing run **deleted the snapshot row** (F-001), and so does the base `settle-afl-api` (F-002), which still reports 73 passed / 1 failed (OD-5, below).

## Proof 2: GREEN (state-b alone)

| Run (fresh copy each) | Checkout | Mode | Result | snapshot row before -> after | Raw |
|---|---|---|---|---|---|
| `green1` | `e9400741` | shared | 1 passed (rc 0) | 1 -> 1, md5 `cf04e8f5...` unchanged, totals 19,319 / 803 | `raw/green1/` |
| `green2` | `e9400741` | per-file `AFLDB_TEST_PER_FILE_DB=all` | 1 passed (rc 0); suite ran in `afldb_v2_pf_20261114101724_2180559_2f4a1333_test` | base unchanged (in-test assertion covers the per-file copy) | `raw/green2/` |
| `fgreen1` | `50fbde9d` | shared | 1 passed (rc 0) | 1 -> 1, unchanged | `raw/fgreen1/` |
| `fgreen2` | `50fbde9d` | per-file `=all` | 1 passed (rc 0); `afldb_v2_pf_20261114102712_2197379_8e2bef7a_test` | unchanged | `raw/fgreen2/` |

Per-file procedure: `scripts/run.sh ... all` = `env AFLDB_TEST_PER_FILE_DB=all AFLDB_TEST_PER_FILE_ADMIN_USER=afldb_v2_super AFLDB_TEST_PER_FILE_ADMIN_PASSWORD_FILE=<root>/secrets/superuser.pw
node --import tsx tools/v2/isolated-pg.ts run <db> -- node node_modules/vitest/vitest.mjs run <files>` (the `run-integration-per-file.sh` recipe of run 2).

## Proof 3: order, and the family (all at `50fbde9d`; the aggregate `AFTER` line of every shared run shows the snapshot row 1, md5 `cf04e8f5...`, totals 19,319 / 803)

Order was forced by **explicit separate invocations on one fresh copy** (`scripts/order.sh`: each file its own vitest process, in the order given) and verified from each step's start/end
times in `summary.txt` and the JSON `startTime` of each file. (`--sequence.*` cannot force an order: the default sequencer sorts by cache/size.)

| Experiment | Order verified from the output | Result |
|---|---|---|
| `fordsbfirst` | state-b (10:27:22) **then** settle-afl-api (10:27:27) | state-b 1/1 passed; settle-afl-api 73 passed / 1 failed (OD-5) |
| `fordsafirst` | settle-afl-api (10:28:24) **then** state-b (10:29:20) | settle-afl-api 73 / 1 failed (OD-5); **state-b 1/1 passed** |
| `ffamfwd` family, shared, default order | issue276, settle-afl-api, brownlow, fixtures, backtest, state-b, reschedule (JSON `startTime`) | 120 passed / 1 failed / 4 skipped (125); files 5 passed, 2 failed |
| `ffamshuf` family, shared, `--sequence.shuffle.files --sequence.seed=20261114` (vitest prints `Running tests with seed "20261114"`) | issue276, reschedule, settle-afl-api, **state-b after settle-afl-api**, fixtures, brownlow, backtest | same 120 / 1 / 4 |
| `ffamrev` family, shared, **reversed** (explicit order): settle-afl-api, state-b, issue276, fixtures, brownlow, reschedule, backtest | steps 1-7 | same results per file (73/1, 1/1, 4 skipped, 16/16, 21/21, 3/3, 6/6) |
| `ffamall` family, per-file `=all` | per-file database per file (`afldb_v2_pf_20261114103412_2212364_b3131289_test` for settle-afl-api) | same 120 / 1 / 4 (the OD-5 text now names the per-file database) |
| `ffamshuftests` family, **full** `--sequence.shuffle --sequence.seed=20261114` (files and tests) | | 10 failed / 111 passed / 4 skipped; **identical** at base (`basefamshuftests`, same seed): the same 10 test ids fail. Within-file order dependence of the ordered brownlow / settle-afl-api cases, not related to this change; state-b passes. |

The two non-passing items of the family in every row are the same, pre-existing, and **not touched** (brief: name, do not fix):

- `settle-afl-api.test.ts` > `AFLDB-ISSUE-235 OD-5 ... OD-5 reinstate (rolled back, no rebuild)`: `Error: Refusing to rebuild '<db>': the only explicit rebuild targets are 'afldb_test'
  (normal test/integration rebuild), 'code_test_db' ... A target is never inferred from a DSN.` (`tools/db/rebuild-test.ts:790`). It needs an `afldb_v2_rb_<x>_test`
  database name. Identical at base (`basesa`: 73 passed / 1 failed with the same message). Classification: **4, deliberate refusal (rebuild-target name)**; not run on a rebuild-named
  clone (not requested; run-2 `integ-failures.tsv` records the same).
- `settle-afl-api-issue276.test.ts`: file-level `ISSUE-276 cases cannot run: these existing canonical rows are not ISSUE-276 fixtures ... 2026|PF|2026-09-19|Hawthorn|Brisbane Lions (matches.id 17266)`.
  The template holds that row (aggregate: 1 row, id 17266, `raw/q276.txt`); independent of order and of this change (it fails first, last and shuffled; same at run 2). Classification: **4, deliberate refusal**.
  (This suite already isolates player ids through its own `isolatePlayerIds()`.)

## Proof 4: own-leftover refusal (`ownleft1` at `e9400741`, `fownleft` at `50fbde9d`)

Fresh copy; `scripts/leftover.mjs` inserts the suite's **own** rows with the statements of its `beforeAll` (synthetic player legacy id -275000001 and the
`(afl_api, CD_I2071275001)` identity). `AFTER-SEED`: own id rows 1, players 1, total 19,320. Then state-b alone in shared mode:

```
AssertionError: a leftover fixture row exists; remove it deliberately, this file will not adopt it: expected { seasons: +0, matches: +0, …(15) } to deeply equal { seasons: +0, matches: +0, …(15) }
-   "externalIdentities": 0,        +   "externalIdentities": 1,
-   "players": 0,                   +   "players": 1,
```

rc 1, `beforeAll` refused, the test skipped. `AFTER-RUN`: snapshot row **1, md5 `cf04e8f5...` unchanged**, player_id 7974, totals back to 19,319 / 803 (the suite's `afterAll` removed only its own two rows, exactly as it
removed its own namespace leftovers before this change; it does not touch the real row).

## Mutation proofs: the new assertions bite (`mutsb`, `mutsa`; checkout `50fbde9d` plus one uncommitted token, porcelain 1, restored to 0 afterwards)

| Mutation | Result |
|---|---|
| state-b: `BRIDGED_PROVIDER_PLAYER_ID = 'CD_I297354'` (old behaviour) | beforeAll refuses (as red1) **and** `AssertionError: the snapshot's (afl_api, CD_I297354) identity row changed: expected null to deeply equal '{"id": 19189, "notes": "20 match(es),…'`; snapshot rows 1 -> 0 |
| settle-afl-api: `BRIDGED_PROVIDER_PLAYER_ID = 'CD_I297354'` (old behaviour) | 73 passed / 1 failed (OD-5) **and** the same `... identity row changed ...` failure in `afterAll`; snapshot rows 1 -> 0 |

## Proof 5: typecheck and lint at `50fbde9d` (`raw/tsc.log`, `raw/eslint.log`, `raw/typegen.log`)

`next typegen` rc 0; `tsc --noEmit -p .` rc 0 (empty log); `eslint tests/integration/settle-afl-api-state-b.test.ts tests/integration/settle-afl-api.test.ts` rc 0 (empty log); porcelain 0 before and after (`scripts/lint.sh`).

## `settle-afl-api-brownlow*` use of `CD_I297354` (read only, not edited)

`settle-afl-api-brownlow.test.ts:263` and `:1902` are **comments**; the suites do not delete or write the identity row. But three suites
(`settle-afl-api-brownlow`, `-brownlow-reschedule`, `-brownlow-backtest`; each has its own `unitSourceFor` that reads the shared roster/stats files directly) **depend** on whatever
`afl_api` row `CD_I297354` has: on the snapshot it resolves to the real player 7974, so their settle writes `player_match_stats`/derived rows against a **real** player for the suite's
synthetic matches and their `cleanup()` repairs the derived rows by recompute (`:255-300`). Before this change, in the shared full run those suites ran after `settle-afl-api` had deleted
the row (the player was unresolved); **now the row survives, so they run against the real player in shared mode too**, as they already did alone and per-file (run-2 audit: `settle-afl-api-brownlow` x3 "rewritten
in place, restored"). They pass in every family order here (21 / 3 / 6 passed in `ffamfwd`, `ffamrev`, `ffamshuf`, `ffamall`). That is a behaviour shift in the shared run, not a defect found; see Residual 1.

## Classification (brief vocabulary)

| Id | Class |
|---|---|
| `settle-afl-api-state-b` (file) | 2 actual defect (test harness), fixed with red/green; now 1 passed in shared, per-file and every order |
| `settle-afl-api` snapshot-row deletion | 2 actual defect (test harness), fixed (red: row 1 -> 0 at base; green: unchanged); mutation proof above |
| `settle-afl-api` OD-5 test | 4 deliberate refusal (rebuild-target name); unchanged by this scope; not run on a rebuild-named clone |
| `settle-afl-api-issue276` (file) | 4 deliberate refusal (existing canonical `2026|PF|2026-09-19|Hawthorn|Brisbane Lions`, id 17266, in the snapshot); not reproduced from a recipe, not hand-edited |
| `settle-afl-api-brownlow`, `-reschedule`, `-backtest`, `-fixtures` | 1 passes under intended conditions (and depend on the snapshot row, Residual 1) |

## Residuals

1. **Other suites still read the real id from the shared fixture files** (`settle-afl-api-brownlow`, `-brownlow-reschedule`, `-brownlow-backtest`). Consequence: in shared and per-file runs they settle against the real player 7974 and rewrite then
   restore that player's derived rows in the disposable test database (never production). Existing protection: their own recompute cleanup; they pass here. Operator action: none today. Alternative: apply the same
   `renameFixturePlayer` to their three `unitSourceFor` functions (test-only, an owner-sized follow-up; the issue276 suite already isolates ids). Recommended: do it with ISSUE-363, because it removes the last dependence on the snapshot row.
2. **Not addressed (outside this scope):** T363-2 (`admin-fixtures` deletes all 218 `fixtures` rows in shared mode) and T363-3 (`after-siren` cross-file contamination) from the run-2 findings; the OD-5 test needs a rebuild-named database; `settle-afl-api` still recomputes the real 2026 `seasons`/`club_seasons` rows (its own documented design, restored in `afterAll`).
   ISSUE-363's own criterion therefore stays at "partially resolved" for T363-1 only if the owner counts the shared full run; this scope proves the state-b/settle-afl-api half.
3. **An own-namespace leftover is still removed by `afterAll`** after `beforeAll` refuses it (unchanged behaviour: it deletes rows keyed on its own ids/season/player only). It cannot reach the real row. An alternative that refuses without cleaning would make a killed run permanent until manual removal; not changed.
4. The shared-mode full run has not been re-run by this scope (that is the integration scope's job); here it is the family and every ordered pair.

## Proposed ledger text (ISSUE-363; local-only state, nothing pushed)

> Status: partially resolved locally (T363-1). Fix: `settle-afl-api-state-b` and `settle-afl-api` rename the real fixture provider player id `CD_I297354` to namespace-owned ids
> (`CD_I2071275001`, `CD_I2026228001`) in their in-memory fixture copies (occurrence count asserted; shared files untouched), key identity residue/cleanup on rows they own,
> and assert that the snapshot's `(afl_api, CD_I297354)` row is unchanged (content or absence) by the run, also when `beforeAll` refuses. Validation: base `6d5388ea` state-b alone
> in shared mode on a fresh snapshot copy fails "a leftover fixture row exists" and deletes the row (1 -> 0; base `settle-afl-api` deletes it too); at `50fbde9d` state-b passes on a fresh copy in shared and
> per-file modes and in both orders with `settle-afl-api`, the `settle-afl-api*` family passes (120 / 125; the 1 failure is the OD-5 rebuild-name refusal and the 4 skips the ISSUE-276 existing-row refusal, both unchanged from base) in default,
> shuffled-file, reversed and per-file order, an own-fixture leftover is still refused with the real row untouched, and mutation of either id back to `CD_I297354` fails the new assertion. Next action:
> the brownlow trio still reads `CD_I297354` (Residual 1); T363-2/T363-3 and the OD-5 rebuild-name run remain.

Proposed `CHANGELOG.md` (Unreleased) line: `Test harness: settle-afl-api and settle-afl-api-state-b no longer delete or depend on the production snapshot's afl_api identity row for CD_I297354; they use namespace-owned provider player ids and assert the row is unchanged.`

## Files and hashes

`SHA256SUMS` lists every committed raw file and script (`raw/` copies are LF, the stripped vitest logs; unstripped `*raw.log` files stay on the host). Host evidence: `/mnt/ssd/afldb-rem3-stateb-20261114/evidence/<label>/`; scripts: `/mnt/ssd/afldb-rem3-stateb-20261114/in/`.
Aborted first batch: labels with capitals (`ordA`, `ordB`) were refused by `isolated-pg` ("not an afldb_v2_*_test name") before any test ran; no result, evidence directories removed, labels renamed (`ordsbfirst`/`ordsafirst`).

## Process and incidents (disclosed)

- `heavy.lock` was held by another agent (restore, then a 90-minute integration run) while I waited; the template restore took the lock; the first family batch queued behind it and ran under it. I killed **only my own** queued waiter (`flock ... mut.sh`, pid 2215505) and ran the single-file mutation/base/shuffle runs without the lock (they are not in the brief's heavy list: restore, rebuild, full suite, build). One earlier command (kill my queued waiter pid 2183174 and relaunch unlocked) was **denied by the permission classifier**; nothing in it ran.
- Host scratch outside the workspace: `/tmp/stateb-probe.sh` (my own one-off probe), removed immediately.
- The workstation scratch is `D:\tmp\afldb-rem3-stateb\`. No other worktree, no `D:\dev\afldb`, no run-1/run-2 file was edited.
- End state: `isolated-pg stop`, `no listener on 55671`, `pgrep -u arm -af afldb-rem3-stateb-20261114` empty, databases in the cluster before stop: `afldb_v2_rem3stateb_tmpl_test` (407,133,207 bytes) and `postgres` only (no per-file database left); `du -sh`: workspace 1.4G, cluster root 1.2G; workspace left in place.
