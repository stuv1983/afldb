# AFLDB-ISSUE-316: successor activation separated from the production apply (2026-10-25)

**Status: implemented locally; focused validation green (§9); design and the three MED rulings accepted by the owner
2026-10-25 (§11). Fresh-context independent review: GO, no CRIT/HIGH.** Production remains **NO-GO**. Nothing in this document authorises a census, a
D/P choice, a seal or rollover, an activation, the apply, a deployment, a rebuild or a push.

## 1. Owner ruling implemented (2026-10-25)

Successor activation must be controllable independently of the production rollover/apply:

1. the apply completes with the successor inactive;
2. post-apply validation runs while it is inactive;
3. activation is a separately authorised action;
4. the activation state is separately testable and reversible.

The ruling also requires that the J2 rebuild semantics stay unchanged and that no proof is weakened.

## 2. Old and new mechanism

| | Before (coupled) | After (separated) |
|---|---|---|
| What makes the successor active | `SUCCESSOR_LADDER_TUPLES_JSON` in `tools/db/rebuild-test.ts` lists the tuple (the closed table `resolveLadderRebuildExpectation` and `isAdoptedSuccessorBinding` read) | **Unchanged.** The same literal is the only activation state |
| Who writes it | The rollover apply. `planSeasonRollover` appended the tuple (`planSuccessorTuplesEdit`), and `rebuild-test.ts` was the 8th file of the apply write set, pinned in `final_sha256` | **Only** `tools/db/successor-activation.ts --apply`, under a bound authority. The apply never writes `rebuild-test.ts` for a successor |
| Apply write set (successor) | 8 files: the AFL Tables switch, register, seasons, fitzRoy contract, stat-availability, `rebuild-test.ts`, the AFL API contract and the AFL Tables contract | 7 files: the same list **without** `rebuild-test.ts`. A successor change set naming it in `write_set` or `final_sha256` is refused |
| What the dry run validates | The proposed 8 files (the activated state) | The 7 files plus the **projected** one-line append, computed by the same function from the same bytes. This is the same activated state. `rebuild-test.ts` is bound read-only until the write, and the inactive table is proven not to list the profile |
| State after the apply | Activated (C) | **Applied, inactive (B).** Every rebuild refuses the installed profile ("Unsupported ladder expectation") |
| Activation | Implicit in the apply | Separate CLI. Its dry run is also the post-apply inspection of state B |
| Deactivation | Revert the whole rollover commit | `deactivate` authority: the exact inverse edit (`planSuccessorTuplesRemoval`), back to the B bytes. The rollover files are untouched. Reverting the activation commit is the equivalent Git route |
| Apply recovery (journal) | Restored all 8 files, the tuple line included | Covers the 7 files only. It can never restore or reverse the activation state |

`rebuild-test.ts` code (resolution, guards, stage 9) is **not changed**. State C's `rebuild-test.ts` is the same
one-line edit (`planSuccessorTuplesEdit(base, tuple)`) that the coupled apply would have made on the same base
bytes. This is equality of the edit, not of the J2 pin. `rebuild-test.ts` has moved since the J2 base, so its
inactive and active pins are re-derived at P. The operator compares the `rebuild_sha256.active` printed by the dry
run against the authority before `--apply` (review F5).

## 3. Every file or field that was responsible for implicit activation

| # | File / field | Role | Before | After |
|---|---|---|---|---|
| 1 | `tools/db/rebuild-test.ts` `SUCCESSOR_LADDER_TUPLES_JSON` | **Authority / enablement** (closed table) | Written by the apply | Written only by the activation CLI |
| 2 | Change set `write_set` entry `tools/db/rebuild-test.ts` | Made (1) part of the apply | Required | Refused for a successor (`prepareTransition`) |
| 3 | Change set `final_sha256["tools/db/rebuild-test.ts"]` | Pinned the activated bytes for the apply | Required | Refused for a successor. The pin moves to the activation authority (`rebuild_sha256.active`) |
| 4 | Change set `ladder_successor_tuple` | The reviewed tuple | Consumed by the apply to write (1) | Consumed by the apply only for the projection and its validation, and by the activation, which binds it by change-set SHA-256 and tuple SHA-256 |
| 5 | `PLANNER_OWNED_WRITES` / `assertTransitionWriteSet` planned-set check | Required the planner to emit (1) | Included `rebuild-test.ts` | `plannerOwnedWrites(true)` excludes it, and a planner output containing it is refused |
| 6 | `planSeasonRollover` `rebuildNext = planSuccessorTuplesEdit(...)` | The edit itself | Written | Projected into `RolloverPlan.activation` only |
| 7 | `fitzroy-contract.json` `/datasets/ladder/rebuild_expectation` | **Selector request** (names the profile and fingerprints) | Written by the apply (reviewed base) | **Still written by the apply.** It grants nothing by design: resolution refuses unless (1) lists the tuple. This is the installed "successor-capable data" of state B |
| 8 | Register accepted entry, contract witness/range/exclusion, `seasons.json` | Coherence prerequisites (`assertSuccessorTransition`) | Written by the apply | Written by the apply. Prerequisites, not enablers |
| 9 | `isAdoptedSuccessorBinding`, `readStageNineExpectedRows` | Read (1) | Followed (1) | Follow (1). In B, stage 9 reads the predecessor constant, so a further rollover from B is incoherent and refuses |

**No remaining implicit path:**
- Without a change set, the planner gets no tuple and edits only the ISSUE-101 constant.
- With a change set:
  - `replace` is limited to the two source contracts;
  - `base` is limited to the fitzRoy contract;
  - the planner emits no `rebuild-test.ts`;
  - membership and pins refuse it;
  - the write binding holds it read-only;
  - the journal never contains it.
- A repository search finds only two writers of `rebuild-test.ts`: the ISSUE-101 constant edit (non-successor) and
  `successor-activation.ts`.

## 4. States

| State | Exact representation |
|---|---|
| A pre-apply | The predecessor documents. The table does not list the profile (the apply refuses otherwise: "already lists") |
| B applied, inactive | Every `final_sha256` pin of the bound change set holds. The register accepts the tuple's core on `rollover_date`. The AFL Tables switch is retired with `changed_at = rollover_date`. `sha256(rebuild-test.ts) = rebuild_sha256.inactive` |
| C activated | B's pins unchanged. `sha256(rebuild-test.ts) = rebuild_sha256.active`, which equals B plus exactly the bound tuple, re-derived both ways |
| D deactivated | Byte-identical to B |

Rollback order is last-in, first-out: deactivate (C→B), then apply recovery (B→A). The activation tool refuses both
directions on a tree whose rollover files are not the applied pins.

## 5. Activation authority (`afldb.rollover.successor_activation/1`) and binding

| Field | Binding | Enforced by |
|---|---|---|
| `action` | `activate` / `deactivate` | A second activation, or deactivating an inactive state, **refuses**. It is never a no-op |
| `decision` | Owner decision id | Recorded and shape-checked |
| `season`, `profile`, `tuple_sha256` | Exact tuple of the pinned change set | Equality with the parsed change set |
| `transition_change_set_sha256` | The pinned change set, whole bytes | SHA-256 of the file supplied |
| `rollover_date` | D | Applied register `accepted_on` and AFL Tables switch `changed_at` |
| `head_commit` | The reviewed commit the activation is made on | `git rev-parse --verify HEAD^{commit}` must be equal, re-checked before the rename |
| `source_commit` | Production candidate P | `git merge-base --is-ancestor P HEAD` must succeed |
| `migrations` | Count, last name and set digest of `src/db/migrations` (LF-normalised) | Recomputed and compared. The production ledger stays the release preflight's check |
| `rebuild_sha256.inactive` / `.active` | Both activation states | Byte hashes, each re-derived from the other by the reviewed edit |

The dry run of `npx tsx tools/db/rollover-season.ts …` prints `tuple_sha256`, `rebuild_sha256.inactive` and
`rebuild_sha256.active` for the authority. Activation reruns no migration, rebuild, census, rollover or database
access. It does run the rebuild's own in-memory validators:
- the activated state must resolve exactly the profile and 1,640;
- the inactive state must refuse it.

## 6. Test mapping (`tests/season-rollover.test.ts`)

| Owner requirement | Test |
|---|---|
| 1 Apply completes inactive | "completes a pinned apply with rebuild-test.ts neither planned, pinned, journaled nor written" |
| 2 No implicit selector | "never populates the selector table…"; "refuses a successor change set that names rebuild-test.ts…"; "refuses a planner output that would write rebuild-test.ts…"; "leaves no other route…"; "PROJECTS the tuple append but never writes…" |
| 3 Post-apply validation inactive | "state B: runs the post-apply validation inactive…" |
| 4 Activation changes only its state | "state C: activation changes only rebuild-test.ts, from the inactive pin to the active pin…" |
| 5 Wrong candidate refuses | "refuses a different candidate, and writes nothing" (16 cases) and the change-set cases (3) |
| 6 Second activation | "state C: refuses a second activation and writes nothing" |
| 7 Deactivation only activation state | "state D: deactivation changes only rebuild-test.ts back to the inactive pin (B) and leaves the rollover applied" |
| 8 Rollbacks not conflated | "keeps apply rollback and activation rollback apart…", plus the journal assertion in test 1 |

## 7. J2 proof standing

- Rebuild semantics are unchanged: no `rebuild-test.ts` code edit, no change to rebuild inputs or decisions.
- State C is the same activated shape the J2 transition produced: the documents plus the one tuple line. No new
  rebuild is indicated.

## 8. Dependencies returned to the owner (resolved by the 2026-10-25 rulings in §11)

Items 0–4 below are kept as the question the owner ruled on. Their dispositions are in §11.

0. **State B means "nothing rebuilds", not "the predecessor still rebuilds" (review F1, MED).**
   - What the apply writes:
     - the contract's `rebuild_expectation` naming the successor;
     - the register retiring the predecessor.
   - With the table empty, every `db:test:rebuild` refuses in PRECHECK at B ("Unsupported ladder expectation").
     B is fail-closed, but the rebuild tool's behaviour does change at the apply.
   - Post-apply validation at B is the in-memory proof run by the activation dry run:
     - the activated state resolves the profile with 1,640;
     - the inactive state refuses.

     No database rebuild is possible until C.
   - The application is unaffected: nothing in `src/app` reads the table.
   - The alternative is a B in which the predecessor still rebuilds. That would need the apply to leave the
     register and contract on the predecessor, which is a different transition and outside the J2 semantics.
   - This item needs an owner ruling: accept B as defined here, or redesign.
1. **U2 "date-only" condition.** A re-pin at D is no longer date-only against J2:
   - `write_set` and `final_sha256` lose `rebuild-test.ts`;
   - its pin moves to the activation authority.

   The union of apply plus activation is still the J2 state modulo date, but the change-set *shape* differs. That
   needs an owner ruling.
2. **Post-transition simulation and commit 2.** J2's commit 1 and commit 2′ (99 restated tests) assumed the
   activated tree. Separation needs three trees:
   - commit 1 = B, with its own test restatement;
   - the activation commit = C, carrying the restatements of the tests that pin the empty table, for example
     `SUCCESSOR_LADDER_TUPLES` equals `{}`.

   These are regenerated at D anyway (decision package §3 step 4), but their split is new. Example:
   - the empty-table tests (`season-rollover.test.ts` "ships an EMPTY closed table…" and `db-test-rebuild.test.ts`
     "ships an empty successor table…") pass at B and fail at C;
   - the "real repository state resolves the predecessor" tests fail at both B and C (review F3, MED).
4. **Decision package sections now stale (review F2, MED).** These are rewritten when the production material is
   regenerated:
   - §4 coupling text;
   - §6 post-apply criteria ("eight paths", "`rebuild-test.ts` has exactly one changed line", "commit 1 (ten files)");
   - §8 "reversible only by reverting the whole rollover commit".

   The 8-file G/J2 change-set shape is now refused, by both the rollover planner and the activation binding. The
   activation authority is a new reviewed artefact.
3. **P differs from `876dadbf` in code.** Under decision package §3 step 1, the full J2 validation set re-runs at P:
   the DB-free suites, `tsc`, and the focused rollover and rebuild suites.

## 9. Verification (owner-authorised local run, 2026-10-25)

```text
npx vitest run tests/season-rollover.test.ts
npx vitest run tests/db-test-rebuild.test.ts tests/afl-api-cutover.test.ts
npm run typecheck
```

| Command | Result |
|---|---|
| `npx vitest run tests/season-rollover.test.ts` | 1 file passed, **393 tests passed** (393) |
| `npx vitest run tests/db-test-rebuild.test.ts tests/afl-api-cutover.test.ts` | 2 files passed, **1539 passed, 5 skipped** (1544) |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | exit 0 |

These ran before the F3 test renames in §11.2. After the renames (titles and comments only, no assertion changed):
- `season-rollover.test.ts` re-ran: **393 passed**. `npm run typecheck` re-ran: exit 0.
- The rebuild/cutover re-run was blocked by an environment fault: the C: volume ran out of space (0 MB free, `ENOSPC`).
  With temp redirected to D:, **1517 passed** and every test that ran passed. The one failure was
  `db-test-rebuild.test.ts:351`, which asserts that the temp directory is on `C:\`, so the redirect itself caused it.
  That block's other 22 tests were skipped when its `beforeAll` failed. They passed in the first run and no assertion
  of theirs changed. **A clean re-run of that file needs free space on C:.**

## 10. Independent review (fresh context, read-only, 2026-10-25)

**Verdict: GO for the structural gate; no CRIT or HIGH.**

- The reviewer enumerated the activation-capable fields and paths independently:
  - the table is the only authority;
  - the contract `rebuild_expectation` is a name that grants nothing;
  - no apply, no-change-set, `replace`, `base`, planner, journal or recovery path can write the table for a
    successor.
- Findings:

| ID | Grade | Finding | Disposition |
|---|---|---|---|
| F1 | MED | State B: every rebuild refuses. Post-apply validation is in-memory only | **Returned to owner** (§8.0) |
| F2 | MED | Change set must be re-pinned structurally, not date-only. Decision package §4/§6/§8 stale | **Returned to owner** (§8.1, §8.4) |
| F3 | MED | Test restatements split between B and C | **Returned to owner** (§8.2) |
| F4 | LOW | Leftover `.activation-tmp` invisible to the rollover's leftover scan | **Fixed**: `pendingTransactionProblem` now refuses on it, with a test |
| F5 | LOW | "C equals the J2 shape" test is a determinism check only | **Fixed**: comment and §2 corrected. The operator compares the printed active pin |
| F6 | LOW | Two stale comments | **Fixed** |
| F7 | INFO | `decision` is shape-checked; `source_commit` is "an ancestor of HEAD"; `migrations` binds the files, not the production ledger | Accepted and recorded (§5) |
| F8 | INFO | Rollback order must be deactivate, then apply recovery | Recorded (§4) |
| F9 | INFO | CLI `main` (Git, real filesystem, manifest read) is tested only by source-text checks | Accepted. It is exercised by the first real dry run |

- Disposition of the MED items:
  - none is a code defect in isolation, binding, rollback or apply independence;
  - F1 bears on the owner's definition of state B, so it is not self-accepted here;
  - production stays NO-GO pending the owner's rulings on §8.

## 11. Owner rulings on F1–F3 and what was done (2026-10-25)

The design is accepted. The fresh-context GO stands subject to the rulings below. Production stays NO-GO.

### 11.1 F1 and F2: ruled, no code change

- **F1: State B accepted as defined**: applied / successor installed / successor inactive / **rebuild-ineligible**.
  B is not redesigned to keep the predecessor rebuildable. The application is unaffected (the web runtime does not
  consume the activation table). The successor's database rebuild proof waits for State C. B's validation is
  non-database: exact apply write set, `rebuild-test.ts` byte-identical to its inactive pin, tuple absent, the
  activation dry run valid for the projected C, the inactive validator refusing as expected, healthy application and
  read-only production checks. **B is never labelled as having passed successor database rebuild proof.**
- **F2: the U2 date-only exception is superseded.** The production candidate is structural: 7 files instead of 8,
  new transition and change-set semantics, production apply validation, recovery boundaries, post-apply criteria and
  an activation authority artefact. It is never described as "date-only". At the production window, P is regenerated
  from this code and re-pins the commit P, the date D, the 7-file write set, the change set and its SHA-256, the tuple
  and its SHA-256, the inactive and projected-active `rebuild-test.ts` SHA-256, the activation authority, the migration
  binding, every date-bearing document and every decision-package hash that consumes them.
- **Validation at P:** the full J2 DB-free set (full relevant suites, focused rollover tests, focused rebuild and
  cutover tests, typecheck, static package and pin checks) and the enforced production-candidate dry run. No new
  disposable rebuild is required on its own: resolution code, tuple meaning and the successor data and reconstruction
  semantics are unchanged, so J2 still proves the rebuild semantics. A later change touching rebuild semantics, rebuild
  inputs, expected reconstruction, canonical data or the validators J2 relied on returns to the owner.
- **Decision package updated.** `issue316-production-readiness-decision-2026-10-24.md` §0a (new), §2, §3, §4, §6, §8 and
  §9 (U2, U7) no longer describe activation inside the apply, an eight-file apply, `rebuild-test.ts` changing in the
  apply, or activation rollback inside whole-rollover recovery.

### 11.2 F3: tests classified by state

| Class | Tests | Action |
|---|---|---|
| Invariant (true in B and C) | Successor documents and provenance, change-set bindings not about activation, rebuild semantics not reading the tuple, canonical data | Unchanged |
| State B | The "apply leaves the successor inactive" block; "never populates the selector table"; the post-apply validation test; the empty-table tests (`ships an EMPTY closed table…`, `ships an empty successor table…`, `the shipped empty table refuses…`) | Names now say **state B** or **states A and B**. Assertions unchanged |
| State C | "bound, single-file, reversible": the activation test (tuple present, active hash equal, one file changed), the second-activation refusal, `accepts the same state with the table injected` | Names now say **state C**. The deactivation test says **state D** and returns to B. Assertions unchanged |
| State A (the real tracked tree, pre-apply) | `accepts the real repository state…` (predecessor profile, 1622 rows) | Name now says **state A** |

- No empty-table test was rewritten to pass after activation. No test claims that B and C are one tree.
- Tests that read the real tracked tree as the *predecessor* are state A tests. At the production window the
  post-transition simulation is regenerated as two trees (B, then C) and these restate per state.

### 11.3 Review follow-up

The fixes made after the first review are the already-disclosed LOW fixes (F4–F6). The post-review changes are the F3
renames (titles and comments) and these documents, with no assertion or code change, so no second fresh review is
triggered.
