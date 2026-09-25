# AFLDB-ISSUE-235 — `afl_api` player-link adjudication in `/admin/player-links`

Status: **RESOLVED — 2026-09-24.** Implemented, validated on `afldb_test`, deployed to DEV at
`6c693b92`, and independently closed (typecheck/build/api-diff/doc-hygiene PASS, DB-free and
`afldb_test` integration tests PASS, VISUAL: PASS). Follow-ups F-1/F-2/F-3 accepted and allocated
to AFLDB-ISSUE-238/239/240. AFLDB-ISSUE-237 remains open and independent.

| Stage | State |
|---|---|
| S0 | COMPLETE |
| S1–S5 | COMPLETE |
| S6 | COMPLETE |
| S7 | COMPLETE (documentation correction, 2026-09-24) |
| I18 | COMPLETE |
| S8 | COMPLETE (2026-09-24): committed, merged, deployed to DEV at `6c693b92` |
| S9 | COMPLETE (2026-09-24): independent `afldb-closure` verification PASS, including visual-verification (VISUAL: PASS) |

*(The planning-stage note below, "Open — planning runbook, 2026-09-23 … no product change", is
history. The update blocks that follow it record the implementation.)*

**Update 2026-09-23 (evening).**
- **S0 is complete.** The operator ran it read-only on `afldb_test` and `afldb_dev`; the evidence is
  in §13.1. The OD-1 gate **passes** on both databases.
- **OD-1 to OD-4 are approved** (§14). OD-2 and OD-3 change the plan: D10 is rewritten (§4 D10), and
  promotion/rebuild preservation moves into scope (§4 D15, §7.5). Follow-up F-2 is narrowed to match.
- **One finding is recorded:** the ISSUE-228 "all `resolved`" wording is documentation drift (§2.5,
  E37).
- **The plan review is complete** (§17), run in the main session because the operator narrowed the
  launch under §15. It found no CRIT/HIGH and four MED findings (R1–R4), with the plan corrections
  proposed for acceptance.
- **Operator decisions on the review (2026-09-23, later).**
  - R1–R3 and R5–R8 are accepted and **folded into the normative sections** (D10, D12, D15, §7, §9,
    §10, §13.2).
  - R4 was opened as **AFLDB-ISSUE-237**.
  - **OD-5 is approved: yes.**
  - **Implementation is authorised** within §13.2's scope. It starts at S1, after re-verifying that
    migration 104 is free. No code has been written yet.

**Update 2026-09-23 (late) — OD-5 rebuild wiring implemented; nothing live has run.**
- **Stages.** `db:test:rebuild` now runs three new stages, each through the new
  `tools/migration/rebuild_afl_api_adjudications.ts`:
  - `afl-api-adjudications-capture`, between `precheck` and `recreate`;
  - `afl-api-adjudications-reinstate`, straight after `draftguru`. It is one transaction:
    original ids restored with `OVERRIDING SYSTEM VALUE`, the sequence advanced, `player_id`
    remapped through the replay adapter's newly exported `resolveAflApiPlayerIdentity()`,
    `admin_user_id` remapped by email, the rows read back, then the D15 replay and the bijection;
  - `afl-api-adjudications-bijection`, a read-only validation stage straight after that.
- **Actor attribution.** The runbook did not specify this, so it is decided here. An existing
  `auth_users` row is reused, unchanged, when its email matches case-insensitively. Otherwise an
  attribution-only row is created: role `contributor`, no password hash, no TOTP secret, and
  `disabled_at` set. *(Superseded 2026-09-23, below: the captured role replaces `contributor`.)*
- **Recovery.** A pending capture that no rebuild reinstated makes the next capture refuse. The
  one exception is `--recover-afl-api-adjudications` with an empty live ledger. The operator
  procedure is in `docs/deployment.md`.
- **Validation.** C6 is in `tests/db-test-rebuild.test.ts` (18 cases). DB-free suites pass:
  311/311, and 487/487 across the four ISSUE-235 suites. Typecheck is clean.
- **Not done.** I18 (the guarded live `afldb_test` rebuild) and the rest of the live S6 matrix have
  not run.

**Update 2026-09-23 (night) — OD-5 attribution and recovery corrections; DB-free only.**
- **Actor role.** The capture now records each actor's `auth_users.role` alongside the email.
  Capture format version 2; a version-1 file is refused. The role must pass `isLifecycleRole`,
  which is `auth_users_role_check` from migration 033. Anything else, or one actor carrying two
  roles, refuses the capture. A capture file carrying such a role refuses at parse, before the
  reinstate transaction opens. Nothing is ever coerced.
  - An existing account (case-insensitive email) is reused as it is. Its role, credentials and
    state are untouched, and a differing current role is only counted in the stage output.
  - Otherwise an attribution-only account is created with the **captured** role. The INSERT
    carries literal `NULL` password hash and TOTP secret and `disabled_at = now()`. No session
    and no `can_manage_admins` are written.
  - The row preserves who acted and the role recorded at capture. It is not evidence that the
    role held throughout the ledger's history.
- **Post-commit/pre-archive crash.** Before this change, a re-run found the pending capture equal
  to the live ledger and overwrote it with a fresh capture, unverified. The capture stage now
  runs a read-only check in the same snapshot:
  - the ledger equals the capture;
  - the sequence is above the maximum id;
  - `replayAflApiAdjudications()` itself, in a savepoint of the read-only transaction, would
    insert nothing;
  - `assertAflApiAdjudicationBijection()` holds.

  Only then is the pending capture archived as `.reinstated.json` and the live ledger captured
  for this run. Any failed check refuses with `already_reinstated_unverified`, and the pending
  capture is left in place. `--recover` changes nothing on this path, and the ledger is never
  re-inserted. The reinstate stage's own non-empty-ledger refusal remains the backstop.
- **Validation.** C6 now has 26 cases. `tests/db-test-rebuild.test.ts` passes 319/319, and the four
  ISSUE-235 DB-free suites pass 495/495. Typecheck is clean.
- **S6 gap.** I2–I10, I6b–I6d, I15 and I16 are specified in §10.2 but have no test code yet. Only
  I1, I11–I13, I14 and I17 exist.

**Update 2026-09-24 — S6 integration cases written; NOTHING LIVE HAS RUN; four implementation
defects found by reading the code, none fixed (test-implementation-only session).**
- **Added.** The cases below; runbook numbering is used where this runbook and the operator's
  S6 brief number a case differently. The brief's cases are all covered too.
  - `tests/integration/settle-afl-api.test.ts`
    - One ordered lifecycle case, run through the real settle: I2, then I6 (revoke before I5), then a
      re-link (the brief's I6), then I5, then I6 (revoke after I5, refused as used), then I6c. It
      runs as one `it` because the file's root `beforeEach` rebuilds the settle baseline before
      every case.
    - An I2 D8 audit-shape case.
    - I3 (atomicity).
    - I4/T2–T9. T2 is the brief's I3, T3 the brief's I4, and T6 the brief's I7.
    - I6b (Brownlow), I6d (lock), I6-LI (LINK_INDEPENDENT; the brief's I6d) and I7 (BRIDGED).
    - Six I15 stop cases and I16 (replay idempotence; the brief's I16).
    - Five OD-5 cases against real PostgreSQL:
      - `observeLiveReinstatement()` verified-and-archived;
      - three refusals: a missing identity, a human row with no ledger entry, and ledger drift.
        Each is observed in a read-only transaction that is rolled back;
      - `reinstateAndReplay()` itself, inside a transaction that is always rolled back, with the
        sequence restored afterwards. This is not a rebuild and not I18.
    - A fixture-leftover gate.
  - `tests/integration/player-link-concurrency.test.ts`
    - I8, I9 and I10 (a bridge-style INSERT race), plus the brief's revoke race (I10).
    - A leftover gate.
  - `tests/integration/afl-api-adjudication-fixtures.ts` (new, not a test file). It holds the
    shared namespace (`CD_I999235…`, `CD_M999235…`, legacy ids `-2352xxxxx`, one disabled actor),
    the seeding, the owner-only teardown and the residue gate.
  - `tests/db-promotion-check.test.ts` gains **C4/C5**. §10.1 specified them, but they were missing
    from the tree. They include the planner's remapped-identity-mismatch STOP.
- **Ran.** `npm run typecheck`: clean. `npx vitest run tests/db-promotion-check.test.ts`: 109/109.
  No integration command has run, and nothing touched a database.
- **Not a live case, by design.**
  - *A remap whose identity differs from the stored `player_identity`* is unreachable live.
    `resolveAflApiPlayerIdentity()` looks the player up by the stored identity and returns that
    same string. The branch is pinned DB-free by C4.
  - The replay planner has **no ledger-sequence stop**: it keeps the latest action by id. Ledger
    structure is checked where a ledger is moved (`capturedRowProblems`, C6).
  - *Sequence behind the maximum id* is not altered live, because `setval()` is non-transactional.
- **Defects found (source-verified against `node_modules/postgres`; expected to fail the named
  cases until fixed):**
  - **HIGH — every revoke fails.** `revokeAflApiLink()` runs
    ``tx`SET LOCAL lock_timeout = ${REVOKE_LOCK_TIMEOUT}` ``. postgres.js sends the value as `$1`,
    and `SET` takes no bind parameter. It fails closed and writes nothing. Cases hit: the lifecycle,
    I6b, I6d, I6-LI, I4/T6 (revoke part), I4/T8, I7, I16, every OD-5 case (their `beforeEach`
    revokes), and the revoke race.
  - **HIGH — blocks I18.** `reinstateAndReplay()` binds ``${r.evidence}::jsonb`` and
    ``${r.previousState}::jsonb``. The driver's jsonb serializer JSON.stringifies that text a
    second time. It also binds ``${r.createdAt}::timestamptz``, which the driver's date serializer
    truncates to milliseconds. The function's own byte-for-byte read-back therefore refuses **any
    non-empty ledger**, and `db:test:rebuild` would stop at `afl-api-adjudications-reinstate` after
    the reset. The rolled-back OD-5 reinstate case is expected to show this.
  - **MED.** `linkAflApiProvider()`/`revokeAflApiLink()` pass `JSON.stringify(…)` text for
    `evidence`/`previous_state`, so those columns hold jsonb **strings**, not objects (D8). Cases
    hit: the I2 D8 audit-shape case.
  - **MED.** postgres.js `begin()` rethrows any failed query even when the callback caught it
    (`index.js:291-292`). The in-transaction 23505→T6 and 55P03→T19 mappings therefore never
    surface: both refuse as a generic "could not be applied", still with no write. Cases hit: I10
    and I6d.
- **Findings, not failing tests.**
  - The T8 revoke refusal is unreachable from the page. The page renders the NULL-player row with
    `0`/`[row]`; the server recomputes `-1`/`[]`, so it answers T6.
  - JavaScript note length (UTF-16 units) and PostgreSQL `length()` (characters) disagree for
    astral characters. I3 relies on this; the CHECK still refuses the row.
  - `proveNonUse()` omits D10's staging predicate `OR provider_player_id = CD_I`.
  - The `revoked` row's `nonUseProof` holds only `{proven: true}`. D10 point 3 asks for the
    manifest version, the tables checked and the zero counts.
- **I18 is NOT ready.** Fix the HIGH items, then run the non-destructive S6 matrix green, then
  seek operator approval for I18.

**Update 2026-09-24 (later) — the four driver defects are fixed; DB-free validation only; S6 NOT run.**
- **Revoke `SET`.** `revokeAflApiLink()` now runs `SELECT set_config('lock_timeout', $1, true)`.
  That is transaction-local and parameterisable, with the same `'2s'` at the same point: after the
  advisory locks and before `LOCK TABLE`.
- **OD-5 reinstate.** `reinstateAndReplay()` binds `previous_state`, `evidence` and `created_at` as
  `${…}::text::jsonb` / `::text::timestamptz`, so PostgreSQL parses the captured text itself. The
  capture (`::text`, `to_char(… .US"Z")`) and the exact read-back are unchanged.
- **D8 jsonb objects.** Link and revoke pass `previous_state`/`evidence` through
  `jsonb(tx, obj)` = `tx.json(…)` (the repository idiom). `sqlJson()`/`JSON.stringify` are gone.
  Contents and `evidence_sha256` are unchanged.
- **23505 / 55P03.** Both in-transaction `catch` blocks are removed. The error aborts the
  transaction; postgres.js `begin()` issues `ROLLBACK` and rethrows. Only then does the outer
  `catch` classify it:
  - `55P03` → T19 "retry", no write.
  - `23505` → `classifyLinkUniqueViolation()`, which re-reads committed state on the pool (not the
    dead transaction): its own provider row → T6; the chosen player holding another provider → T4
    (a bridge insert for a different provider can surface this); anything else, or a failed
    re-read → T6.
- **Tests.**
  - `player-link-mutations.test.ts`: A10 now pins `set_config`. Three new source pins: no
    parameterised `SET`; no `JSON.stringify` on either audit path; no `catch` inside either
    transaction, with classification after the outer rollback.
  - `db-test-rebuild.test.ts`: one new pin for the `::text::` casts and the retained exact read-back.
- **Ran.** `npm run typecheck`: clean. vitest, DB-free:
  - `player-link-mutations` 64/64;
  - `db-test-rebuild` 320/320;
  - `db-promotion-check` 109/109;
  - `player-links-page` 8/8.
  No integration test, migration, SQL or rebuild ran.
- **Still open (deferred, need a contract review):** the T8 page/server fingerprint mismatch;
  UTF-16 vs `length()` note length; `proveNonUse()` missing D10's `provider_player_id` staging
  branch; and `nonUseProof` not recording the manifest version, tables and counts.
- **Next.** Run the non-destructive S6 matrix on `afldb_test`. I18 still needs explicit operator
  approval after S6 is green.

**Update 2026-09-24 (evening) — first live S6 run: two defects found and fixed; DB-free validation
only; S6 still live-unproven.**
- **Live evidence (operator-run on `afldb_test`).**
  - Before the run: migration 104 and `db:privileges:test` applied. I11–I13 passed 1/1 and I1 3/3.
  - The first S6 functional group of 15 tests: 8 passed, 7 failed.
  - Six failures were revokes. Each stopped safely with
    `T19_revoke_unprovable: … the player-reference manifest does not match the live catalogue`.
  - The seventh was I7: the T2 link against the bridged importer (`L-I`) row returned `ok: false`
    **without** a refusal code.
- **Defect 1 (the six revoke failures): D10 manifest omission.**
  - I17 reported one `unclassified_table`: `public.player_club_season_stats(player_id)`.
    `validateManifestAgainstCatalogue()` was right to refuse.
  - Root cause: the table is 007's `player_season_stats`, renamed by 015
    (`ALTER TABLE … RENAME TO`). A11b's migration scanner followed only `CREATE TABLE` lines, so it
    never saw the rename.
  - Fix: the entry is added as `NOT_SOURCE_BEARING` with `provenanceColumns: []`, matching its
    derived neighbours `player_season_stats`, `player_career_stats` and `player_clubs`.
    - It has no provenance column in 007, 015 or 065 (065 adds only the frees columns). 015
      comments the table `DERIVED`.
    - It is recomputed from `player_match_stats` + `matches` by `recomputePlayerDerivedStats()`
      (`player-derived.ts`) and rebuilt wholesale by `rebuild_derived.py`
      (`REBUILDS['player_club_season_stats']`).
  - The validator and the live check are unchanged.
- **Defect 2 (I7): the T2/T3 code was lost in the query layer, not in the pure rule.**
  - Root cause: `linkAflApiProvider()` ran `validateAdjudicationInput()` **before**
    `decideAflApiLink()`. That check includes `missing_surname_acknowledgement`, which is the same
    fact as T9, and returned `Invalid submission: …` with no code.
  - Whenever the provider has a pending `unresolved_identity` candidate whose payload surname
    differs from the chosen player's, that duplicate check pre-empts T6/T8/T2/T3. The pure rule
    ranks T9 last.
  - I7's fixture player has surname `Amon-Issue228Test` (normalised `AMONISSUETEST`), and the
    provider payload says `Amon`. `readPendingCandidates()` is not limited to the fixture
    namespace, so any pending `CD_I297354` candidate in `afldb_test` triggers the check.
  - This is inferred from the code and the observed code-less result, with no DB query. It is the
    only code-less return reachable before the decision with I7's valid provider id, player id and
    note. It can be confirmed read-only with
    `SELECT count(*) FROM promotion_candidates WHERE verb = 'unresolved_identity' AND status = 'pending' AND split_part(external_record_id, '|', 3) = 'CD_I297354';`
  - Fix: the pre-decision check now drops that one item
    (`.filter((problem) => problem !== 'missing_surname_acknowledgement')`), leaving only
    field-shape checks. `decideAflApiLink()` owns T9 and returns it **with** its code. The pure
    rules, the T20 revoke rule and every write path are unchanged. A T2/T3 refusal returns before
    any INSERT, so the importer row keeps `unique`, its `player_id` and its `match_method`.
- **Tests changed.**
  - `tests/player-link-mutations.test.ts`:
    - A11b now follows `ALTER TABLE … RENAME TO`.
    - New pin: `player_club_season_stats.player_id` is `NOT_SOURCE_BEARING` with no provenance
      columns. The I17 catalogue row validates clean, and a gained `source_id` still refuses.
    - New pin (I7): the pure T2/T3-over-T9 precedence for `L-I` and `L-H`, plus a source pin that
      the pre-decision check drops the surname item and the refusal returns `decision.code`
      before any INSERT.
  - `tests/integration/settle-afl-api.test.ts` I4/T9: its first assertion expected the old
    code-less `missing_surname_acknowledgement` text. It now asserts
    `{ ok: false, code: 'T9_surname_ack_required' }`. It is the same refusal, with the same no-write
    snapshot check. The I7 expectation is unchanged.
- **Ran.** `npm run typecheck`: clean. vitest, DB-free:
  - `player-link-mutations` 66/66;
  - `db-promotion-check` 109/109;
  - `db-test-rebuild` 320/320;
  - `player-links-page` 8/8.

  That is 503/503. No integration test, migration, privilege script, SQL or rebuild ran.
- **Unchanged (deferred, as before).** The T8/NULL-player revoke fingerprint mismatch; UTF-16 vs
  `length()` note length; `proveNonUse()` missing D10's `provider_player_id` staging branch; and
  `nonUseProof` holding only `{proven: true}`.
- **Next.** The operator reruns I17, then the 15-test S6 functional group. The revokes now reach
  the D10 proof proper for the first time live, so new findings there are possible. The concurrency
  cases, replay/recovery and I18 have not been run.

**Update 2026-09-24 (night) — live S6 nearly green; two test-harness defects fixed; DB-free
validation only; S6 still incomplete.**
- **Live evidence (operator-run on `afldb_test`).**

  | Group | Result |
  |---|---|
  | I17 | PASS |
  | I2–I7 / I6b–I6d functional group | 15/15 PASS |
  | I8–I10 concurrency group | 4/4 PASS |
  | I15/I16 replay group | 7/7 PASS |
  | OD-5 observe/reinstate group | 5/5 PASS |
  | Full two-suite run | 66 passed, 3 failed |

  The three failures were I14 and both leftover gates. Neither is a product defect, and no
  production code changed in this pass.
- **Defect 1 — I14 fixture violated migration 104's FK.**
  - The net-linked ledger row stored `player_id = 999999999`. Migration 104 declares
    `player_id integer NOT NULL REFERENCES players(id)`, so PostgreSQL refused the fixture before
    `replayAflApiAdjudications()` ran.
  - Fix: the row now models numeric-id reuse across a destructive rebuild. It stores
    `player_id = playerIdB`, a real fixture player, with `player_identity` = player A's AFL Tables
    identity. The shape comes from the new `i14StaleLedgerRow()`.
  - The replay must link the provider to `playerIdA`. I14 now also asserts that the resolved id is
    not the stored id, and that player B gained no `afl_api` row. A replay that trusted the column
    would link a wrong but existing player, so this is stronger than the dangling id it replaces.
  - The linked→revoked control, idempotence and bijection assertions are unchanged. So are the FK
    and the replay logic.
- **Defect 2 — the leftover gates counted real `afldb_test` rows (false positives, not
  leftovers).** Both gates returned `aflApiIdentities 6`, `dependentRows 57`,
  `pendingCandidates 81`, and 0 for everything else.
  - The predicates behind the three counters:
    - `aflApiIdentities`: `external_identities WHERE source_id = <afl_api> AND external_id LIKE 'CD_I999%'`.
    - `pendingCandidates`: `promotion_candidates WHERE source_id = <afl_api> AND status = 'pending'
      AND split_part(external_record_id, '|', 3) LIKE 'CD_I999%'`.
    - `dependentRows`: `players` was 0, so every `player_id IN (<fixture players>)` term was 0.
      `fixtureCandidates` and `spineRows` were 0, so the Brownlow term's `CD_M999235%` branch was
      0 too. That leaves `staging.afl_api_player_match WHERE provider_player_id LIKE 'CD_I999%'`.
  - Why they are false positives: `CD_I999%` is a prefix of real Champion Data ids. Real ids are
    `CD_I` + 6–7 digits, and the tracked bridges hold seven 2026 players in that range.
    - Six are linked in the post-D8 `afldb_test` bridge: `CD_I999321`, `CD_I999326`,
      `CD_I999331`, `CD_I999391`, `CD_I999715` and `CD_I999827`. That exactly matches
      `aflApiIdentities = 6`.
    - `CD_I999724` (Declan Mountford) is deliberately unresolved.
    - The fixture ids are `CD_I` + 10 digits.
  - Other evidence that these rows are not leftovers:
    - Two gates in separate files returned identical counts.
    - Every counter that only a fixture row can satisfy was 0: players, adjudications, actor,
      batches, spine rows and fixture candidates.
  - Nothing was deleted.
  - The same flaw also affected other selectors:
    - `assertS6LedgerIsolated()` counted any `CD_I999…` row as fixture, which weakened the
      precondition.
    - `cleanupS6Fixtures()` used `LIKE 'CD_I999235%'`, which would also delete a real 6-digit
      `CD_I999235`.
  - Optional read-only confirmation:
    `SELECT provider_player_id, count(*) FROM staging.afl_api_player_match WHERE provider_player_id LIKE 'CD_I999%' GROUP BY 1 ORDER BY 1;`
    (the same `GROUP BY split_part(external_record_id,'|',3)` works for the pending candidates).
- **Fix — one exact ownership definition** (`tests/integration/afl-api-adjudication-fixtures.ts`).
  - `S6_OWNERSHIP` is what teardown removes. `ISSUE235_OWNERSHIP` is S6 plus I1's and I14's literal
    ids (now `I1_FIXTURE`/`I14_FIXTURE`, imported by those cases); it is what the gate counts.
  - Providers match `^CD_I999235[0-9]{4}$` or the literal I1/I14 ids.
  - Match records match `^CD_M999235[0-9]{4}(\||$)`.
  - Players are the exact `seedS6Player()` range plus the literal I1/I14 legacy ids. The old
    `-235999999…-235000000` span is gone.
  - AFL Tables ids match `^players/Z/Issue235-S6-[0-9]{1,4}\.html$` or the literal I1/I14 ids.
  - Each rule exists in two forms, both built from the same constants: a JS predicate
    (`ownsProviderId` etc.) and a SQL builder. The builders are used by `cleanupS6Fixtures()`,
    `issue235FixtureResidue()` and `assertS6LedgerIsolated()`, and no `LIKE` selector remains.
  - Counter by counter:
    - `pendingCandidates`, `aflApiIdentities` and the staging term now match only owned provider
      ids.
    - `canonicalApplications` now tests each `|` segment for exact ownership.
    - `s6ProviderId()`/`s6MatchId()` refuse keys outside 1…9999.
  - The zero expectations are unchanged. Teardown still removes exactly the S6 rows, and it deletes
    nothing new.
- **DB-free pins (`tests/player-link-mutations.test.ts`, +5).**
  - Ownership accepts every fixture id and rejects the real `CD_I999xxx` ids, `CD_I1002231`,
    near-miss lengths and suffixes.
  - A scan of every tracked `data/reference/afl-api-*.json` finds no owned provider id. The scan
    is not vacuous: it sees `CD_I999321`.
  - A recording fake of postgres.js proves three things. Teardown, the gate and the isolation check
    contain no `LIKE`. They bind exactly the registry's patterns and ids. Teardown binds no I1/I14
    id.
  - I14 uses an FK-valid but wrong id with a different stable identity, and no `999999999` remains.
- **Ran.** `npm run typecheck`: clean. vitest, DB-free:
  - `player-link-mutations` 71/71;
  - `db-promotion-check` 109/109;
  - `db-test-rebuild` 320/320;
  - `player-links-page` 8/8.

  That is 508/508. No integration test, migration, privilege script, SQL or rebuild ran.
- **S6 is still incomplete.** The operator must rerun I14 and both leftover gates on `afldb_test`.
  I18 still needs explicit operator approval after that.

**Update 2026-09-24 (late night) — S6 COMPLETE; I18 prepared, NOT run, NOT ready.**
- **S6 live evidence (operator-run on `afldb_test`).**
  - Migration 104 applied and privileges reconciled; the human-ledger privilege test passed.
  - I1, I17, I2–I7/I6b–I6d, I8–I10, I14, I15, I16, OD-5 observe/reinstate, and both leftover gates
    all passed.
  - Final two-suite run: 69/69 (`settle-afl-api` 61/61, `player-link-concurrency` 8/8), with no
    fixture residue.
  - DB-free: typecheck clean and 508/508.
- **Read-only `afldb_test` state before I18 (2026-09-24).**
  - `afldb_test` / `afldb_owner`; last migration `104_afl_api_identity_adjudications.sql`, 104
    applied.
  - Ledger 0 rows; `afl_api_identity_adjudications_id_seq` = 198, `is_called` (S6 consumed ids);
    no S6 actor.
  - `afl_api` identities: 802 `unique` importer rows (`afl_api_manual_adjudication` 3,
    `…name_team_season_bootstrap` 129, `…stat_vector_bootstrap` 397, `…stat_vector_season` 273);
    **0** `resolved`. The bijection is trivially satisfied. No `backups/rebuild/afldb_test/` exists,
    so there is no pending capture.
- **Stage order, verified from `planStages()` (`--plan`, DB-free).** 25 stages:
  1 `precheck`, 2 `afl-api-adjudications-capture` (owner DSN, read-only transaction), 3 `recreate`
  (**the first destructive statement**), 4 `migrations`, 5 `privileges`, 6–16 the data and
  after-siren stages, 17 `draftguru`, 18 `afl-api-adjudications-reinstate`, 19
  `afl-api-adjudications-bijection` (import DSN, read-only), 20 `awards-honours` … 25
  `fingerprints`.
  - Replay and the in-transaction bijection run **inside** stage 18.
  - Capture archival (`….reinstated.json`) happens at the end of stage 18, after the commit.
    That is after the in-transaction read-back, replay and bijection, but **before** stage 19
    and final validation.
- **Blockers before I18 can be approved.**
  1. **Acquired snapshots are not staged.** The worktree holds only `coaches-20260905/parsed`.
     A bounded search of `D:\dev\afldb\data`, `D:\backups\afldb` and the two local artefact
     directories found the following.
     - Found: fitzRoy `full-history-20260902` bytes, under the old directory name
       `…issue-112-staging-20260902\stage-fitzroy\…\full-history-20260827`; the
       `coaches-20260905` raw bytes (`D:\dev\afldb`); and DraftGuru `annual-html-20260826`.
     - **Not found:** `issue129-t7-20260903` (heights supplement), `rosters-20260905` (AFL API
       rosters), `club-lists-20260905`, `ladder-20260828`, and DraftGuru `annual-html-20260902`.
       The preflight refuses without them, before destruction.
  2. **No tracked I18 seed/verify/teardown harness exists.**
     - The S6 fixtures cannot be reused: their players are synthetic (`players/Z/Issue235-S6-*`,
       negative legacy ids), and the rebuild does not recreate them. A ledger row on one of them
       would stop stage 18 *after* the reset, leaving `afldb_test` part-built.
     - The synthetic id this section suggests (`CD_I9990000001`) is outside `ISSUE235_OWNERSHIP`,
       so the residue gate would not see it.
     - This section seeds a single `linked` row, which cannot prove `supersedes_id`.
  3. **DraftGuru label.** The runner defaults to `annual-html-20260826`, which is present locally.
     The previous full rebuilds (ISSUE-113/118/136) passed `annual-html-20260902`, whose bytes
     are not on the workstation. The operator decides. Without `--draftguru-bridge`, the current
     DraftGuru bridge links are dropped.
  4. **Import DSN.** `AFLDB_TEST_IMPORT_DATABASE_URL` is not in the shared `.env`. It must be set
     in the process, or the run falls back to `--allow-owner-import-dsn`.
- **Proposed I18 fixture (needs authorisation to write the harness).**
  - Player: a real baseline player with exactly one AFL Tables identity and no `afl_api` or
    `manual_admin_edit` identity. Read-only candidate: id 144, `players/A/Alan_Martello.html`
    (1970–1983, 255 games).
  - Provider: a new literal `I18_FIXTURE` id (10 digits, outside `^CD_I999235[0-9]{4}$`). It is
    added to `ISSUE235_OWNERSHIP` for the gate but not to `S6_OWNERSHIP`, like I1 and I14.
  - Actor: a dedicated `@example.test` email.
  - Seeded through the real `linkAflApiProvider()` → `revokeAflApiLink()` → `linkAflApiProvider()`,
    so the ledger holds linked, revoked (with `supersedes_id`) and linked rows, and the provider
    is net-linked.
  - Verify after the rebuild:
    - the tuples equal the archived capture;
    - `player_id` is the current id for the identity;
    - the actor is attribution-only;
    - sequence next > max id;
    - a second replay is a no-op;
    - bijection holds;
    - exactly one `afl_api` row, which is the human row.
  - Teardown as owner returns the ledger to empty and zero residue.

**Update 2026-09-24 (I18 preparation, non-destructive) — harness written; I18 NOT RUN, NOT approved.**
Nothing in this pass touched a database. The only command runs were `npm run typecheck`, four
DB-free vitest suites, and `db:test:rebuild --plan` with placeholder DSNs on an unreachable port.
The no-ack preflight was **not** run.

- **The harness (blocker 2 cleared, DB-free only).**
  `tools/migration/afl_api_adjudication_i18_fixture.ts`, run through the package script
  `db:test:issue235-i18` (`tsx --conditions=react-server`):

  ```text
  npm run db:test:issue235-i18 -- seed [--allow-owner-import-dsn]
  npm run db:test:issue235-i18 -- verify --phase pre
  npm run db:test:issue235-i18 -- verify --phase post
  npm run db:test:issue235-i18 -- teardown
  ```

  - **Target.** `afldb_test` only, through `AFLDB_TEST_DATABASE_URL` (owner) and
    `AFLDB_TEST_IMPORT_DATABASE_URL`. The DSN name goes through the rebuild's own
    `assertRebuildTargetName()`, then must equal `afldb_test` literally.
    - The `.env` development `DATABASE_URL` and `AFLDB_IMPORT_DATABASE_URL` are overwritten
      in-process before the query module loads. The connected database is then re-checked, and the
      import role must differ from the owner role.
    - The owner substitute needs an explicit `--allow-owner-import-dsn`.
  - **Ownership (`I18_FIXTURE`, exact literals, no `LIKE`).**
    - Provider `CD_I9991800001`: `CD_I` + 10 digits, outside every real 6–7-digit id and outside
      S6's `^CD_I999235[0-9]{4}$`.
    - Spine record `CD_M9991800001|CD_T20|CD_I9991800001`.
    - Actor `issue235-i18-fixture@example.test`, as `super_admin`.
    - Batch tool `issue235-i18-fixture`, payload recipe `issue235-i18-fixture:sha256`.
    - The provider is in `ISSUE235_OWNERSHIP.providerIds`. The residue gate counts every I18 literal.
    - S6 teardown touches none of them.
    - `assertS6LedgerIsolated()` now **refuses** while I18 is seeded, so S6's ledger-global counts
      stay exact.
    - I18 owns **no** player.
  - **Player.** `players/A/Alan_Martello.html` is resolved through `resolveAflApiPlayerIdentity()`,
    the D15 rule itself. It never uses a numeric id; the source contains no `144`.
    `seed` refuses, and never picks another player, unless every one of these holds:
    - the identity resolves to exactly one player;
    - that player's trusted stable identities are exactly this one `afltables` identity (no second
      profile, no `manual_admin_edit`);
    - the player has no `afl_api` row of any status and no ledger row;
    - the player has zero `afl_api`-sourced LINK_DEPENDENT uses (the D10 manifest's player
      predicates plus the two ledger checks);
    - no I18 row exists, the whole ledger is empty, and there are zero human `resolved` rows;
    - there is no pending rebuild capture and no baseline file.
  - **Seed.**
    - Fixture setup, as owner, in one transaction: the disabled, credential-less actor, plus the
      pending `unresolved_identity` evidence a settle would write. The payload carries the player's
      own surname, and a link without pending evidence is T5.
    - Then three real mutations on the import DSN, each with the fingerprint the detail page
      renders (`page.tsx:52-69`): `linkAflApiProvider()` → `revokeAflApiLink()` →
      `linkAflApiProvider()`. The revoke's `supersedes_id` comes from the API's own
      `latestAdjudicationId`.
    - No statistic, Brownlow or height row is seeded.
    - Any refusal stops the seed and names `teardown`.
  - **Baseline** `backups/issue-235-i18/afldb_test.baseline.json` (gitignored, outside
    `backups/rebuild/`), hash-bound (`payloadSha256`). It records:
    - the provider, the stable identity and the pre-rebuild `player_id`;
    - the actor's id, email and role;
    - per ledger row: id, action, `supersedes_id`, `evidence_sha256`, `previous_state::text` and
      `evidence::text` (PostgreSQL's canonical jsonb rendering, the same text the reinstate binds)
      with their `jsonb_typeof`, the note, and `created_at` as UTC microseconds (the capture's own
      `to_char` format);
    - the identity row;
    - the sequence (`last_value`, `is_called`, next).

    No credential is recorded.
  - **`verify`** reads one repeatable-read, read-only snapshot. The replay and bijection come from
    `observeLiveReinstatement()`: the replay runs in a savepoint and cannot write.
    - `pre` requires the baseline exactly, surrogates included, and no pending capture.
    - `post` requires:
      - the identity resolves to exactly one player, and its number may differ;
      - all three rows under their original ids, in the same order, with every durable field
        byte-equal (`supersedes_id`, both jsonb texts and types, `evidence_sha256`, note, actor
        email, `created_at` to the microsecond);
      - `player_id` equal to the player resolved now, and `admin_user_id` equal to the actor's
        current id;
      - no row still naming a renumbered pre-rebuild id;
      - exactly one `afl_api` row for the provider: `resolved`, `afl_api_admin_adjudication`, on
        that player, which holds no other `afl_api` row;
      - exactly one human `resolved` row overall;
      - the actor unique by email, disabled, with no password hash, no TOTP secret, and the
        captured role;
      - the sequence's next value above `max(id)`;
      - a replay that is exactly one no-op;
      - the bijection;
      - no pending capture, and an archived `….reinstated.json` capture that parses, proves its own
        hash and holds the I18 rows. Its file sha256 and payload hash are printed.

      Importer rows (ISSUE-237) are not expected and not checked.
    - If the rebuild keeps the same numeric id, the stale-id check is vacuous. I14 proves the
      renumbering case at function level.
  - **Teardown** runs as owner.
    - Transaction 1 deletes, in FK-safe order: ledger (one statement), identity, applications,
      candidate, staging records/versions/payload, batch.
    - Transaction 2 deletes the actor. A referencing row refuses there and names the constraint.
    - It then proves zero I18 rows and `issue235FixtureResidue()` = zero, and archives the baseline
      as `….torn-down.json`.
    - No baseline-player or canonical row is touched.
  - **DB-free validation.** `npm run typecheck` is clean. `db-test-rebuild`, `player-link-mutations`,
    `db-promotion-check` and `player-links-page` passed 518/518. That is +10 new I18 cases, plus the
    ownership test extended to I18. No live seed has run.
- **Operator flow (the rebuild never runs the fixture).** The runner has no I18 reference, which
  is asserted DB-free. Keeping seed, verify and teardown explicit gives the operator a
  before/after evidence pair, and keeps a fixture out of the destructive entry point.
  1. `seed`
  2. `verify --phase pre`
  3. `db:test:rebuild -- --plan --draftguru-label annual-html-20260826`
  4. the no-ack preflight: the same command without `--plan`/`--acknowledge-destroy`, which
     refuses at the acknowledgement after `runPreflight()`
  5. explicit operator approval
  6. `--acknowledge-destroy afldb_test`
  7. `verify --phase post`
  8. `teardown`
  9. the residue gates
- **D1 — DraftGuru label: `annual-html-20260826`.** It is contract-valid:
  - it is the runner's `DEFAULT_DRAFTGURU_LABEL` and the importer's `STAGE_A_LABEL`;
  - `draftguru-contract.json` measured against it, and `draftguru-event-kinds.json` names it as
    `stage_a_snapshot`;
  - `DRAFTGURU_EXPECTED` (42 pages, 5,057 persons, 6,810 picks) matches it;
  - no tracked rebuild contract names `annual-html-20260902`;
  - `tools/rebuild/draftguru/README.md` "`--link-only`" records that `annual-html-20260902`'s pages
    cannot be re-acquired, that no copy survives, and that repointing the defaults "was not made".

  The earlier ISSUE-113/118/136 runs chose `20260902` while its bytes existed. That is history,
  not contract.
- **D2 — no `--draftguru-bridge`.** Nothing in the rebuild contract requires it:
  `finalValidationSql()` adds the bridged count only when a bridge is given. I18 tests the human
  D15 state only.
  - The rebuild drops the current 802 importer `unique` `afl_api` identities (ISSUE-237) and the
    DraftGuru bridge links.
  - Neither loss is an I18 failure, and `verify --phase post` checks neither.
- **D3 — archive timing (no code change; inspected `rebuild_afl_api_adjudications.ts`).**
  - `runReinstate()` archives only after `sql.begin(reinstateAndReplay)` has **committed**.
  - Inside that transaction, in order: the exact read-back (`reinstatedLedgerProblems`), the
    sequence assertion, the replay, and the bijection.
  - The recovery path (`verify-reinstated` in the capture step) is unchanged.

  **Success criterion, precisely:** the pending capture may be archived only after the reinstate
  transaction has committed and the stage-18 exact read-back, sequence, replay and bijection
  verification have succeeded. A later unrelated stage failure (19–25) does not require the capture
  to stay pending: the durable ledger is already live, and the next rebuild captures it again.
- **Snapshot inventory for this invocation** (`--plan`, 25 stages, verified). Paths are
  repository-relative to the worktree.

  | Stage(s) | Required label | Expected path | In worktree? | Known retained copy | Required for I18? |
  |---|---|---|---|---|---|
  | 7 fitzroy, 8 heights (register), 12 coaches (Coach column) | `full-history-20260902` | `data/sources/afltables/fitzroy_core/full-history-20260902/` | No | Yes: `D:\backups\afldb\issue-112-staging-20260902\stage-fitzroy\data\sources\afltables\fitzroy_core\full-history-20260827\` (131 files; hash-matched to the 20260902 manifest on 2026-09-18) | Yes (the accepted baseline, `exactly_one_accepted`) |
  | 8 heights, 12 coaches (`--supplement-label`) | `issue129-t7-20260903` | `data/sources/afltables/fitzroy_core/issue129-t7-20260903/` | No | **None found** | Yes, pinned by `fitzroy-contract.json` `height_enrichment` |
  | 9 heights-afl-api | `rosters-20260905` | `data/sources/afl_api/rosters/rosters-20260905/` | No | **None found** | Yes, pinned by `afl-api-contract.json` `roster.accepted_snapshot` |
  | 11 birth-dates | `club-lists-20260905` | `data/sources/afltables/club_lists/club-lists-20260905/` | No | **None found** | Yes, pinned by `afltables-contract.json` `club_player_lists.accepted_snapshot` |
  | 12 coaches | `coaches-20260905` | `data/sources/afltables/coaches/coaches-20260905/parsed/` | **Yes** (tracked parsed artefacts; the loader accepts a missing `raw/`) | raw bytes in the main checkout (earlier search) | Yes, satisfied |
  | 17 draftguru | `annual-html-20260826` | `data/sources/draftguru/annual-html-20260826/` | No | Reported by the earlier read-only search; **path not recorded, not re-located this pass** | Yes: `--validate-only` hashes the 42 year pages |
  | 24 ladder-witness + preflight | `ladder-20260828` | `data/sources/afltables/fitzroy_core/ladder-20260828/` | No | **None found** | Yes, pinned by `fitzroy-contract.json` `ladder.accepted_witness` |

  - **No stage accepts a substitute label.** Each pin is bound by a manifest sha256 in a tracked
    contract, and a changed pin is by rule "a successor decision, never a default".
  - **Acquisition cannot regenerate an accepted label.** `acquire_core.R` never overwrites an
    existing manifest label ("a reacquisition is a new snapshot with a new label").
  - A new capture of 2026 in-season stats, 2026 rosters or club lists would carry different
    bytes. Accepting one re-pins a tracked contract and changes the measured final-validation
    counts. That is an operator decision outside ISSUE-235.
  - The ladder witness (1897–2025) is the only plausibly reproducible set. It would still arrive
    under a new label.
  - The one remaining non-destructive route is a retained copy: the DEV host checkout
    (`~/projects/afldb/data/sources/...`) is the unchecked candidate. Operator commands are in the
    session report.
- **Import DSN.** The preferred I18 configuration is a genuine `afldb_import` DSN. It is derivable
  from the DEV `AFLDB_IMPORT_DATABASE_URL` by swapping `/afldb_dev` for `/afldb_test`, as memory and
  ISSUE-165 record, set in the process only.
  - Owner mode is not needed for any stage by design: capture and reinstate already use the owner
    DSN, and the privileges stage reconciles grants before the data stages.
  - **Unproven:** no full rebuild under the restricted role is recorded. The runs this pass could
    find used `--allow-owner-import-dsn`. A missing grant would therefore surface as a data-stage
    failure **after** the reset.
  - The seed prints the import role it connected as, and refuses the owner role.
- **Discrepancies found (runbook vs implementation).**
  1. §10.2's suggested id `CD_I9990000001` is I1's `providerA`. It is replaced by `CD_I9991800001`.
  2. §10.2 describes a single seeded `linked` row. It is superseded by linked, revoked and linked,
     so that `supersedes_id` is proven.
  3. `--plan` makes no database contact, but still needs `AFLDB_TEST_DATABASE_URL` and an import
     DSN or the flag: `resolveTarget()` runs before the plan branch.
  4. The `coaches` stage also reads `issue129-t7-20260903`, not only `heights`.
  5. The runner's Python default is `.venv\Scripts\python.exe`, and the worktree has no `.venv`, so
     `AFLDB_PYTHON` must be set or PRECHECK refuses.
  6. §10.2 cites 803 importer identities. The read-only census before I18 counted 802.
- **Still blocking the destructive run.**
  - The four missing snapshots, and the staging of fitzRoy and DraftGuru.
  - `AFLDB_TEST_IMPORT_DATABASE_URL` and `AFLDB_PYTHON` in the process.
  - Then the operator reviews the no-ack preflight and approves I18 explicitly.
  - **I18 remains NOT RUN.**

**Update 2026-09-24 (I18 fixture seed + no-ack preflight, operator-authorised) — fixture READY; I18
NOT RUN; destructive approval PENDING.** S6 is COMPLETE (69/69, DB-free 518/518, typecheck clean).
All four previously-blocking items above are cleared.

- **DSNs (process-only, never written).** Owner `AFLDB_TEST_DATABASE_URL`: 127.0.0.1:55432 /
  `afldb_test`, `current_user = afldb_owner`. Import `AFLDB_TEST_IMPORT_DATABASE_URL`: the DEV import
  DSN with database **and port** rewritten (the main `.env` import DSN says port 5432, not the
  55432 tunnel): 127.0.0.1:55432 / `afldb_test`, `current_user = afldb_import`. Both
  `transaction_read_only = off` (read-write roles). `--allow-owner-import-dsn` was NOT used.
  `AFLDB_PYTHON` = the Python 3.12 install.
- **Snapshots: all seven present and verified by the runner's own offline preflight**
  (`runPreflight`, every child `--validate-only`, no database contact): `full-history-20260902`
  (accepted baseline VERIFIED, manifest `2bd66e3d…`, 131 artefacts), `issue129-t7-20260903`
  (heights + coaches supplement), `rosters-20260905` (15 artefacts), `club-lists-20260905`
  (21 artefacts), `coaches-20260905` (386 pages, parsed), DraftGuru `annual-html-20260826`
  (42 pages sha256-verified, 0-entry bridge), `ladder-20260828` (witness, all checks PASS). No
  manifest or hash was edited.
- **Pre-seed state (read-only, one REPEATABLE READ snapshot).** `ISSUE235_OWNERSHIP` residue all
  zero (adjudications, afl_api/afltables identities, players, pending/fixture candidates, spine,
  staging, batches, actors); whole ledger 0 rows; human `resolved` 0; ledger sequence last_value
  198; no pending capture (`backups/rebuild/afldb_test/` absent); no baseline file.
  `players/A/Alan_Martello.html` resolves to exactly one player, with that `afltables` identity as
  its only trusted stable identity and no `afl_api` row. The seed's own precondition gate (D10
  non-use included) then passed.
- **Seed (`db:test:issue235-i18 seed`, real mutation APIs on the `afldb_import` DSN): PASS.**
  - Player **144** (resolved from the stable identity, not assumed).
  - Ledger **199 `linked`**, **200 `revoked`** (`supersedes_id = 199`), **201 `linked`**; all
    `external_id = CD_I9991800001`, `player_id = 144`, `admin_user_id = 560`.
  - One active identity: id 286595, `CD_I9991800001` → 144, `resolved`,
    `afl_api_admin_adjudication`. Zero LINK_DEPENDENT use (no `player_match_stats` via afl_api,
    no staging player-match row for the provider).
  - Actor 560 `issue235-i18-fixture@example.test`: `super_admin`, disabled, no password, no TOTP.
  - Sequence last_value 201, next 202.
  - Baseline `backups/issue-235-i18/afldb_test.baseline.json`: file sha256 `f1a18fc5…a609a`,
    payload `e7948528…d03a3`; no credential pattern in the file.
  - Residue after seed = exactly the I18 literals (3 ledger, 1 identity, 1 pending candidate,
    2 spine rows, 1 batch, 1 actor); S6/I1/I14 remain zero. These rows are INTENDED to stay for
    stage 2 to capture.
- **`verify --phase pre`: PASS** (player 144 unchanged; 199/200/201; whole ledger 3; next 202 >
  max 201).
- **No-ack rebuild preflight** (`db:test:rebuild --draftguru-label annual-html-20260826`, no
  `--acknowledge-destroy`, no `--draftguru-bridge`, no owner override): every input check passed,
  then `REFUSED: This rebuild DROPS every table … Re-run with --acknowledge-destroy afldb_test`.
  `main()` runs `runPreflight` then `assertDestructiveAcknowledgement` before `executeRebuild`, and
  the log holds **zero** `==> ` stage headers: no stage ran, including 1 precheck, 2 capture and
  3 recreate.
- **After the preflight:** `current_database() = afldb_test`; `verify --phase pre` PASS again;
  ledger 3 rows, human `resolved` 1, sequence 201; no pending capture file; baseline sha256
  unchanged.
- **Next (needs separate explicit operator approval):** the destructive I18 rebuild
  `npm run db:test:rebuild -- --acknowledge-destroy afldb_test --draftguru-label annual-html-20260826`
  (launched detached, same two DSNs and `AFLDB_PYTHON`), then `verify --phase post`, then
  `teardown`. A missing `afldb_import` grant would surface only after the reset (see Import DSN).
  **I18 remains NOT RUN.**

**Update 2026-09-24 (I18 executed; post-rebuild cleanup and validation) — I18 COMPLETE.**
The destructive rebuild was operator-approved and operator-run. The durability path passed first
time. Two harness defects surfaced only AFTER it, in cleanup and in an unrelated suite's fixture.
Neither was a rebuild failure.

- **I18 destructive rebuild: PASS** (operator evidence, recorded unchanged).
  - Before: `players/A/Alan_Martello.html` = player 144; `CD_I9991800001`; ledger 199 linked,
    200 revoked (supersedes 199), 201 linked.
  - Safety backup: `D:\backups\afldb\issue-235\afldb_test-pre-i18-20260924-094554.dump`, SHA256
    `B6552DC4…3C436`. It was not restored.
  - Stage 2 captured 3 rows to `backups/rebuild/afldb_test/afl-api-adjudications.capture.json`:
    file sha256 `6b7b5446…d1135d`, payload `c15e80fb…efd8c1c7`.
  - Stage 18 reinstated 3 rows under their original ids, next id 202. Actors: 0 reused, 1 created
    attribution-only (the captured role, disabled, no credentials). Replay: 1 inserted, 0 no-op.
    Bijection OK. The capture was archived as
    `afl-api-adjudications.20260923T234747211Z.c15e80fb485d.reinstated.json`.
  - Stage 19 standalone bijection: OK. Final validation: **85/85**. Rebuild complete.
- **`verify --phase post`: PASS.** Player 144 unchanged; ledger 199/200/201; next 202 > max 201;
  the archived capture matched by file hash and payload hash.
- **Post-I18 defect 1 — teardown refused under plain `tsx`.**
  - `npx tsx tools/migration/afl_api_adjudication_i18_fixture.ts teardown` printed
    `REFUSED: This module cannot be imported from a Client Component module…`.
  - **Read-only diagnosis (before any fix, one REPEATABLE READ READ ONLY snapshot as
    `afldb_owner` on `afldb_test`).** Zero rows remained for every I18 literal: ledger (no 199,
    200, 201, whole ledger 0 rows), `CD_I9991800001` identities in any source, pending candidate
    and canonical applications for `CD_M9991800001|CD_T20|CD_I9991800001`,
    `staging.source_records`/`source_record_versions`/`source_payloads` (`issue235-i18-fixture:sha256`),
    `staging.afl_api_player_match`, import batch `issue235-i18-fixture`, and actor
    `issue235-i18-fixture@example.test` (`auth_users` 0 rows in total). Player 144 still held only its
    `afltables` identity. The ledger sequence stood at 219, consumed by the post-rebuild I15/I16 run.
    The baseline `backups/issue-235-i18/afldb_test.baseline.json` still existed, with no torn-down
    archive.
  - **So the teardown had committed fully,** not partly. Both of its transactions committed: the
    data DELETEs (ledger through import batch) and then the actor DELETE. It refused afterwards, in
    the proof step, before it could archive the baseline. That is why both leftover gates already
    read zero.
  - **Root cause.** The proof step dynamically imported
    `tests/integration/afl-api-adjudication-fixtures.ts` to reach the residue gate. That module
    statically imports `@/db/queries/afl-api-player-links`, which imports `server-only`. The
    `server-only` package throws unless the `react-server` export condition is set. The package
    script `db:test:issue235-i18` sets it; the plain `npx tsx` invocation did not.
  - **Fix.** `tests/integration/afl-api-fixture-ownership.ts` (new) is server-neutral: it imports
    only the `postgres` types and the I18 literals. It holds the namespace, `ISSUE235_OWNERSHIP`,
    `loadS6Refs`, the S6 and I14 teardowns, the isolation check and the residue gate.
    `afl-api-adjudication-fixtures.ts` re-exports it and keeps only the seeding and rendering, which
    do need the query module. Teardown now loads the neutral module and no longer touches
    `@/db/client`. No `server-only` guard in application code was changed.
  - **Hardening.** Teardown re-checks `current_database()` on the live connection before its first
    DELETE, and prints each DELETE's count. Every DELETE matches exact literals, so a rerun removes
    only what is still there.
- **Post-I18 defect 2 — I14/I17 could not execute on the rebuilt database.**
  - `vitest -t "I17|I14"` ran neither case. The shared `beforeAll` threw
    `afldb_test must have at least one auth_users row for this fixture`. Its `afterAll` then threw
    `UNDEFINED_VALUE`, because the cleanup interpolated `i14AflApiSourceId`, which setup never
    assigned.
  - **Root cause.** I14 borrowed an arbitrary existing `auth_users` row (`ORDER BY id LIMIT 1`) as its
    ledger actor. A freshly rebuilt `afldb_test` legitimately has none. I17, a read-only catalogue
    check, shared that setup only because it shared the `describe` block.
  - **Fix (`tests/integration/settle-afl-api.test.ts`).**
    - I14 has its own `describe`. It creates its own actor through `seedI14Actor()`:
      `I14_FIXTURE.actorEmail = issue235-i14-fixture@example.test`, `super_admin`, disabled, no
      password, no TOTP.
    - `cleanupI14Fixtures(db)` takes no setup value. It resolves the source ids inside SQL and
      matches I14 literals only, so it is safe after a partial `beforeAll`. It runs before setup
      and in `afterAll`. The residue gate now counts the I14 actor.
    - I17 has its own setup-free `describe`.
- **DB-free validation:** typecheck clean; `player-link-mutations` 72/72 (new: the I14 actor and
  literal-only cleanup, with no `undefined` bound and no borrowed account); `db-test-rebuild` 331/331
  (new: a static import-graph walk proving that neither the I18 tool nor the ownership module
  reaches `server-only` or `@/db/*`, and that teardown loads only the neutral module); `db-promotion-check`
  109/109; `player-links-page` 8/8.
- **Corrected teardown (operator-authorised, `current_database() = afldb_test` proven first),
  under plain `npx tsx`: PASS.** It removed 0 rows in every category, which confirms the earlier
  committed teardown. I18 rows 0; `issue235FixtureResidue` all zero. The baseline was archived as
  `backups/issue-235-i18/afldb_test.baseline.20260924T002527662Z.torn-down.json`.
- **Leftover gates:** S6 gate 1 passed / 60 skipped; I8–I10 gate 1 passed / 7 skipped. Both were
  green again after I14 ran, and `auth_users` was back to 0 rows.
- **I14** (`-t "I14 — the replay"`, verbose): **1 passed** / 60 skipped. The named case executed.
- **I17** (`-t "I17 .*live afldb_test catalogue"`, verbose): **1 passed** / 60 skipped. The named
  case executed.
- I15/I16 (7 passed after the rebuild) were not rerun; the change does not touch the replay suite.
  No ISSUE-235 production logic changed.
- **I18: COMPLETE.** The issue stays open. CHANGELOG, commit and closure are the operator's.

**Update 2026-09-24 (S7 documentation correction + post-I18 loader regression) — S7 COMPLETE.**

- **S7.** `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` still carried the paragraph "Not yet
  wired: the `db:test:rebuild` … side of OD-5", which said a destructive rebuild discards the
  ledger. That paragraph was replaced. It now describes the implemented stages:
  - capture before `recreate`;
  - reinstate after `draftguru`, under the original ids and `supersedes_id`;
  - `player_id` re-derived from `player_identity`;
  - safe actor attribution;
  - the sequence repaired;
  - readback, replay and bijection before the capture is archived;
  - the standalone bijection stage.

  It records what I18 proved and what it did not. The fixture id happened to stay 144, and I14
  separately proves stale ids are not trusted. Importer `unique` rows are not preserved, which
  is ISSUE-237. The S7 items the doc already covered are unchanged: two-writer precedence, D10
  revoke and the ~2 s stall, D15 promotion replay, and the ISSUE-237 boundary.
- **Loader regression, option (b)** (operator decision). Validate-only against the rebuilt
  `afldb_test`. The bridge was NOT re-imported, the 802 importer links were NOT restored, and
  `--draftguru-bridge` was not used.
  - **Why the expectation changed.** The §10.2 expectation "every provider `already_linked`" was
    written for a database that held the imported bridge. After I18, `afldb_test` holds 0
    `afl_api` identities (the ISSUE-237 gap), so the expected disposition is `would_link`.
  - **Artefact.** `data/reference/afl-api-player-bridge-2026-full-afldb-test-post-d8-2026-09-23.json`,
    sha256 `b71ac61a…b715e9`. The ISSUE-228 closure record (§C) names it the accepted TEST bridge,
    imported as batch 2423. It has 669 providers, all `linked`, with 669 distinct candidate
    players and no duplicate. Its two pinned inputs passed the loader's hash check.
  - **Command.** `python tools/migration/import_afl_api_player_bridge.py --validate-only --target
    afldb_test --artefact <artefact>`. Only `AFLDB_TEST_DATABASE_URL` was exported, as
    `afldb_owner` at 127.0.0.1:55432/afldb_test. No import DSN was set, so no write connection was
    possible.
  - **Result (exit 0):**

    | Disposition | Count |
    |---|---|
    | `would_link` | 669 |
    | `already_linked` | 0 |
    | `already_linked_human` | 0 |
    | `would_HALT_contradiction` | 0 |
    | `would_HALT_player_collision` | 0 |
    | `would_HALT_identity_check_failed` | 0 |

  - **No writes.** Validate-only opens a `default_transaction_read_only=on` session, asserts
    `transaction_read_only = on`, and rolls back.
  - **Not re-run.** `--dry-run` would roll back too, but option (b) is validate-only.
  - **Limit.** Validate-only does not check that each `candidate_player_id` still names the same
    person after the rebuild. Applying this artefact to a rebuilt database would need that proven
    first. That is ISSUE-237 territory and is not an ISSUE-235 acceptance item.
- **DB-free validation after these edits:**
  - `npm run typecheck`: clean.
  - `player-link-mutations`: 72/72.
  - `db-test-rebuild`: 331/331.
  - `db-promotion-check`: 109/109.
  - `player-links-page`: 8/8.
  - Total 520/520. No code changed in this pass.
- **Acceptance before S8.** No ISSUE-235 gap remains open on `afldb_test`. Everything left is
  S8 or S9 work:
  - the DEV rollout and its §11 read-only checks, including the DEV loader validate-only
    expected at 669/0/0/0;
  - V1–V4, captured on DEV;
  - V5–V8, captured on `afldb_test` or marked `VISUAL: UNVERIFIED`;
  - closure.

  Pre-commit hygiene gate (2026-09-24): COMPLETE. The 13 zero-byte root junk files were each
  verified as repository-root only, untracked, zero bytes and unrelated to this issue, then
  removed individually before the ISSUE-235 commit. No wildcard cleanup and no `git clean` was
  used. The worktree now holds only the 33 intended ISSUE-235 files.
- **Next operator action:** the S8 gate. The operator reviews and commits the ISSUE-235 files,
  then runs `npm run merge:ready -- --issue 235`.

Tier: **T3**. It needs a migration, touches the admin UI, `src/db/queries/`, `src/lib/acquisition/`
and the Python bridge loader, and changes identity-adjudication semantics. The execution sequence in
§13 has more than four steps, so under CLAUDE.md §15 launching it engages `afldb-orchestrator`, whose
first act is an `afldb-reviewer` review of this plan. That applies unless the operator narrows the
launch.

**Update 2026-09-24 (bookkeeping correction) — S8 COMPLETE; S9 in progress, NOT COMPLETE.**

This update corrects the stale "S8 NOT STARTED" status above against the disposition of the revised
`afldb-closure` S9 findings (F-235-S9-01 INFO accepted, no fix needed; F-235-S9-02 MED accepted, this
correction; F-235-S9-03 VISUAL: UNVERIFIED retained, not resolved).

- **S8 — DEV rollout, COMPLETE.**
  - `main`/`origin/main` at `6c693b92` (`fix(issue-235): harden adjudication UI runtime and mobile
    tables`, on top of `c2e6b1ac`, `7e433603`, `717f661d`, `659474db`).
  - DEV deployed at `6c693b92`.
  - Migration state 104/104 on DEV.
  - `db:privileges` on DEV: PASS.
  - The §11 DEV read-only checks: PASS.
    - OD-1 index present.
    - `afl_api_identity_adjudications` ledger: 0 rows (expected — no human adjudication has run on
      DEV yet).
    - The re-run S0 census: 669/669/669 `afl_api` identities, unchanged from S0.
    - The D15 bijection check: PASS (empty, as expected — no promotion/rebuild replay has occurred
      on DEV since deployment).
  - DEV bridge loader validate-only (against the deployed 669-provider bridge state): 669
    `already_linked`; `already_linked_human`, contradiction, player-collision, identity-check HALT
    and `would_link` counters all 0.
  - Final deployed UI smoke performed by the operator on DEV.
- **S9 — Closure, IN PROGRESS, NOT COMPLETE.** Revised `afldb-closure` results:
  - `npm run typecheck`: PASS.
  - `npm run build`: PASS.
  - API-diff: PASS/reconciled.
  - `doc-index`/`doc-check`: PASS.
  - 90 DB-free tests: PASS.
  - 38 filtered `afldb_test` integration tests: PASS.
  - Migration 104 unchanged across `c2e6b1ac..6c693b92`.
  - **VISUAL: UNVERIFIED** — for the independent `afldb-closure` visual-verification capture only.
    The S8 operator UI smoke above is a separate, already-satisfied duty and does not substitute for
    it.
  - **S9 is NOT COMPLETE**, solely because the independent closure visual-verification duty remains
    unverified (F-235-S9-03). No other gap is open.
- **Not done in this pass, deliberately:** `issues.md` resolution status, the `CHANGELOG.md` closure
  entry, the move to `issues/closed/`, and allocation of F-1/F-2/F-3 at closure. These remain S9
  closeout work, pending the visual-verification gate.
- **ISSUE-237** remains open and independent of this issue, unchanged by this update.
- **Next operator action:** the independent `afldb-closure` visual-verification capture (F-235-S9-03),
  not merge or deploy — both are already done.

**Update 2026-09-24 (final) — S9 COMPLETE; ISSUE-235 RESOLVED.**

The independent `afldb-closure` visual-verification duty (F-235-S9-03) is now satisfied. S9 is
COMPLETE and no gap remains open.

- **Visual verification: VISUAL: PASS.** Captured with the repository's own Playwright via `npx`
  (no browser MCP), at 1440x900 and 390x844, for:
  1. `/admin/player-links`
  2. `/admin/player-links/afl-api`
  3. `/admin/player-links/afl-api/CD_I1002232`

  All six captures: HTTP 200, no auth bounce, 0 console errors, 0 page errors, 0px document-level
  horizontal overflow. AFL API link present; unresolved list correctly empty; Andrew Brayshaw /
  CD_I1002232 renders importer-linked/read-only, with no adjudication/link/revoke controls for the
  L-I state; evidence/recomputation renders; phone tables sit inside `.table-wrap`. Evidence
  retained under `reports/ui-evidence/2026-09-24-issue-235/` (the six PNGs are present in the
  worktree: `player-links-desktop.png`, `player-links-phone.png`, `afl-api-list-desktop.png`,
  `afl-api-list-phone.png`, `provider-CD_I1002232-desktop.png`, `provider-CD_I1002232-phone.png`).
  The cookie-consent banner visible in the captures is INFO only, caused by the manually created
  Playwright storage state carrying no `afldb_consent` decision — not an ISSUE-235 defect.
  Credential-bearing storage state and ephemeral capture scripts were deleted after capture.
- **Independent `afldb-closure` verification (revised, unchanged from the prior update, now
  final):** `regen-registry` performed; `api-diff c2e6b1ac..6c693b92` performed and reconciled;
  typecheck PASS; build PASS; documentation hygiene PASS; 90 DB-free tests PASS; 38 filtered
  `afldb_test` integration tests PASS; migration 104 history checked (one implementation commit, no
  corrective-slice edit); no unresolved code defect; no MED/HIGH technical blocker.
- **DEV re-confirmation at closure.** `main`/`origin/main` = DEV checkout = `6c693b92`; DEV branch
  `main`; service `node deploy/server-cluster.mjs` from `/home/arm/projects/afldb`, started after
  the current `BUILD_ID` (`GTVouxhTzkePDhSe6yXxw`); health `HTTP 200`, `status=ok`, `database=ok`;
  migration 104/104; `db:privileges` PASS. DEV data acceptance unchanged from the S8 update: OD-1
  index present, ledger 0 rows, census 669/669/669, 0 players with multiple `afl_api` identities, 0
  pending unresolved, 0 open contradictions, D15 bijection PASS. Bridge loader validate-only
  against DEV (`data/reference/afl-api-player-bridge-2026-full-2026-09-22.json`, snapshot
  `afl-api-2026-2026-09-21-031725`): `would_link` 0, `already_linked` 669, `already_linked_human`
  0, all HALT counters 0.
- **F-1/F-2/F-3 accepted and allocated (§15).** The operator accepted all three follow-ups as
  written in §15. They are recorded as separate tracked issues, not implemented here:
  - F-1 → **AFLDB-ISSUE-238** (correcting a consumed trusted `afl_api` link with canonical
    reattribution).
  - Narrowed F-2 → **AFLDB-ISSUE-239** (AFL API human-adjudication recovery outside D15; D15
    itself already implements promotion/rebuild preservation and is not reopened by this
    successor).
  - F-3 → **AFLDB-ISSUE-240** (dedup keys for repeated `afl_api_identity_contradiction`
    findings).
- **AFLDB-ISSUE-237 remains open and independent,** unchanged and not resolved or partially
  implemented by this closure. It is the next development issue after ISSUE-235.
- **I18 safety backup retained:**
  `D:\backups\afldb\issue-235\afldb_test-pre-i18-20260924-094554.dump`, SHA256
  `B6552DC4583AFCBE28C61EE605FC995146D112FDB3424FCE4A82144BBAE3C436`. Kept per operator
  instruction; not deleted by this closure.
- **Resolution.** ISSUE-235 is RESOLVED. See `issues.md` for the ledger's root-cause/resolution/
  validation record.

---

## 0. Scope boundary

**In scope.** A Super Admin path in `/admin/player-links` that:

- lists the `afl_api` provider player ids (`CD_I…`) that ingestion could not resolve;
- shows the bridge-class evidence for each one;
- records a human `status = 'resolved'` link in `external_identities`, with a durable same-transaction
  audit trail and collision, concurrency and stale-submission guards;
- defines, and pins in tests, how that human link interacts with the bridge loader's append-only
  semantics and with later bridge runs.

**Out of scope.**

| Item | Owner |
|---|---|
| Registering a new canonical player, such as a 2026 debutant with no `players` row | ISSUE-224's registration surface (resolved 2026-09-23): `tools/rebuild/draftguru/register_issue224_s9_players.ts`, `/admin/draft`, the data editor. This issue never creates a player. |
| Bridge/settle **status display**, timers, `/admin/current-season` unit status, `revalidateSeason()` after settle | ISSUE-232 |
| Correcting an **existing trusted link** (importer or human) that has already been used to write canonical rows. This means reattributing `player_match_stats` and derived rows. | Follow-up F-1 (§15). It is refused here (D2). |
| Broader replay/recovery beyond D15's invariant: for example exporting adjudications to a tracked artefact, or recovering after a restore that lost the audit table | Follow-up F-2 (§15), **narrowed by OD-3**. Carrying human decisions and their `resolved` identity rows through promotion and rebuild is **in scope** (D15). |
| Carrying importer-created `unique` `afl_api` identities through promotion or the `afldb_test` rebuild | **AFLDB-ISSUE-237** (opened 2026-09-23 from plan-review R4). It is not a dependency of this issue. |
| ISSUE-231 (retired-identity rekey), ISSUE-229 (fixtures), ISSUE-233/234 | Their own issues |
| Deduplicating the bridge's repeated `afl_api_identity_contradiction` rows (G5) | Follow-up F-3 (§15), recorded only |

---

## 1. Objective

Close the gap ISSUE-228 §6.3 left open ("an `afl_api` adjudication path there is a successor item",
`issues/closed/AFLDB-ISSUE-228.md:611-612`). A human can link a provider that the deterministic
bridge could not prove, **without**:

- weakening the no-name-only automatic linking rule;
- letting either writer overwrite, downgrade or delete the other's decision;
- creating a state that silently hides the settle's `unresolved_identity` backlog.

---

## 2. Current-state evidence (verified in the tree at `cd0850da`)

### 2.1 The bridge loader: `tools/migration/import_afl_api_player_bridge.py`

| # | Fact | Location |
|---|---|---|
| E1 | The loader describes itself as the ONLY `external_identities` writer for `afl_api`, and the ledger entry repeats that. | `:8`; `issues.md:41222-41223` |
| E2 | Four artefact evidence classes are accepted: `afl_api_stat_vector_bootstrap`, `afl_api_name_team_season_bootstrap`, `afl_api_manual_adjudication` and `afl_api_stat_vector_season`. The value written to `match_method` is the one the artefact declares. | `:153-164`, `:322-333` |
| E3 | Every INSERT writes `status = 'unique'` and `candidate_count = 1`. That includes `afl_api_manual_adjudication`, which is a human decision written as `unique`. | `:468-477` |
| E4 | `classify_existing()` looks up `(source_id, external_id)` and compares **`player_id` only**. It ignores `status` and `match_method`. A row with `player_id NULL`, or in any status, that differs from the candidate is classified `contradiction`. | `:371-382` |
| E5 | On a contradiction the loader inserts a `data_issues` row (`afl_api_identity_contradiction`, `entity_id` = the existing row id, `details` = proposed player and evidence summary), records `batch.reject`, and **leaves the existing row unmodified**. | `:441-465` |
| E6 | The loader never issues `UPDATE` or `DELETE` ("No row is ever UPDATEd or DELETEd by this tool"). | `:97`; body `:421-482` |
| E7 | **Rule (b) ("that player_id maps to no other CD_I") is NOT enforced at write time.** The loader checks only the provider key. Rule (b) lives in the offline evidence engine and applies only within one artefact. | loader `:421-482`; engine `src/lib/acquisition/afl-api-player-evidence.ts:32`, `:689-719` |
| E8 | The contradiction `data_issues` row carries no dedup key. A re-run with the same disagreement inserts another open row. | `:443-460`; `data_issues` schema `001_foundations.sql:91-102` |
| E9 | `--validate-only` uses a read-only role. `--dry-run` runs the full path and rolls back. `--apply` runs in one `import_batches` row. Targets are a closed list, `afldb_test` and `dev`, and there is deliberately no PROD entry. | `:77-87`, `:136-151`, `:501-566` |
| E10 | The loader requires a manual-adjudication candidate player to exist, and to own the declared AFL Tables profile identity. | `:385-418` |

### 2.2 The schema and the runtime reader

| # | Fact | Location |
|---|---|---|
| E11 | `external_identities` has `UNIQUE (source_id, external_id)`. There is **no** uniqueness on `(source_id, player_id)`. The table comment says `player_id` is NULL unless the status is `unique`/`resolved`, but no CHECK enforces it. | `002_core_entities.sql:178-194`; index widened `044_schema_integrity.sql:193-195` |
| E12 | `link_status` has five values: `unique` and `resolved` are trusted; `ambiguous`, `unmatched` and `implausible` are not. The type comment says only `unique`/`resolved` may be treated as confirmed. | `001_foundations.sql:23-31` |
| E13 | The runtime resolver trusts `status IN ('unique','resolved') AND player_id IS NOT NULL` and **deliberately does not filter on `match_method`**, so a future human link is trusted identically. | `src/lib/acquisition/afl-api-player-resolver.ts:17-22`, `:51-78` |
| E14 | An unresolved provider produces a `refused` player unit (`unresolved_identity`). The match unit still applies. | `src/lib/acquisition/afl-api-settle-plan.ts:417-432` |
| E15 | The settle writes a pending `promotion_candidates` row (verb `unresolved_identity`, family `player_match_stats`, `external_record_id = CD_M|CD_T|CD_I`) and an `import_rejections` row. **No `external_identities` row is written for an unresolved provider.** | `src/lib/acquisition/settle-afl-api.ts:1523-1549`; ISSUE-228 §6.3 `:586-591` |
| E16 | Under the F7 invariant, the machine never retires a pending candidate. A candidate becomes *moot* once its `(record, target)` is applied at the same or a later version. | `src/lib/acquisition/settle-report.ts:9-34`, `:158-174` |
| E17 | The resolver is called per player row on every settle run, so a newly written trusted link takes effect on the next settle with no settle code change. | `afl-api-settle-plan.ts:417` |
| E18 | `afl_api` source row created by migration 077. | `077_afl_api_lineups.sql:61` |
| E19 | The only writers of `external_identities` that `UPDATE` or `DELETE` are scoped to other sources (`afltables`, DraftGuru). None touches `afl_api`. | `import_fitzroy_core.py:2812-2827`, `enrich_birth_dates.py:557-563`, `import_draftguru.py:870,1184` |
| E20 | Every spine and projection table an evidence view needs is readable by `afldb_app`: `staging.source_record_versions`, `staging.source_payloads`, `staging.source_records`, `staging.afl_api_player_match` and `staging.afl_api_brownlow_vote`. The two projections carry `provider_player_id` and a resolved `player_id`. `promotion_candidates` is readable by `afldb_auth`. | `074_source_observation_spine.sql:306-308,336`; `103_afl_api_match_projections.sql:311-325,463-487,569-571`; `privileges.sql:469` |
| E21 | `canonical_applications` records every automatic canonical write by `(source_id, family, external_record_id, target_table)`. | `083_canonical_auto_apply.sql:76-95` |
| E22 | Provider ids are stable across seasons (roster contract). | `tools/rebuild/afl_api/afl-api-contract.json:83` |

### 2.3 The existing `/admin/player-links` workflow

| # | Fact | Location |
|---|---|---|
| E23 | Every action calls `requireCapability('data.playerLinks')`, which is `SUPER_ADMIN_ONLY`. | `src/app/admin/player-links/actions.ts:64,102,128,150,252,305,390`; `src/lib/auth/capabilities.ts:79` |
| E24 | Link targets are exactly seven honours tables (`LINK_TARGET_TABLES`). A migration CHECK mirrors them. The queue holds rows in `ambiguous`/`unmatched`/`implausible`. | `src/db/queries/player-links.ts:37-64`; `056_player_link_review.sql:56-59` |
| E25 | A write locks the **existing target row** (`FOR UPDATE`). Draft picks lock the durable `draft_persons` identity first. The write refuses unless the row is still unresolved, which is the stale-form guard. | `player-links.ts:267-319` |
| E26 | `classifyLogicalDecision` reads the latest `player_link_resolutions` decision and refuses a stale link after a prior `linked`/`confirmed_unlinked` decision. | `player-links.ts:327-372`, `:470-493` |
| E27 | An import-confirmed `unique` link can never be overwritten from this surface. | `player-links.ts:446-450` |
| E28 | The statistical write runs as `afldb_import` on a short-lived connection. The required audit row is inserted **in the same transaction**, so an audit failure rolls the link back (ISSUE-027). | `player-links.ts:412-444`, `:495-514`; `066_atomic_audit_import_grants.sql` |
| E29 | `confirmed_unlinked` is audit-only. It means "vetted, genuinely not an AFLDB player", leaves the honours row `unmatched`, and drops the row from the queue. | `player-links.ts:590-649`; `056:73-74` |
| E30 | The activity log (`audit()`) runs after commit and is best-effort, with a warning. | `actions.ts:24-30,85-91` |
| E31 | Suggestions come from a name-based scorer. Approval rescores inside the transaction. Bulk approval exists. | `actions.ts:233-377`; `page.tsx:75-121` |
| E32 | The page avoids `revalidatePath` for suggestion actions; the client refreshes instead. The known Next hang is recorded in project memory. | `actions.ts:245-246` |

### 2.4 The audit table `player_link_resolutions`

| # | Fact | Location |
|---|---|---|
| E33 | Columns are `target_table` (CHECK over the 7 tables), `target_id` bigint, `action ∈ {linked, confirmed_unlinked}`, `player_id`, `previous_status link_status NOT NULL`, `admin_user_id`, `note`, and later `match_method ∈ {manual, suggested, bulk_suggested}`, `match_score` and `algorithm_version`. It is append-only by grant. | `056:54-76`; `067:106-118`; `066`; `068` |
| E34 | In the promotion inventory, `target_id` identity is `none` for six of the seven tables. The table is `historicalOnly` on DEV (ISSUE-139 D1). Every public table must be classified, or the gate refuses every phase. | `tools/db/promotion-inventory.ts:545-620`, `:2212-2238` |

### 2.5 Measured population facts (S0, operator-run 2026-09-23; full evidence in §13.1)

| # | Fact | Location |
|---|---|---|
| E35 | **`afldb_test`:** 803 `afl_api` identities covering 803 distinct providers and 803 distinct players. **All 803 are `unique`, 0 are `resolved`.** There are 0 players holding more than one `afl_api` id, 0 `NULL`-player rows and 0 untrusted statuses. S0 confirms the closed record's counts and corrects its status wording (E37). | §13.1; `issues/closed/AFLDB-ISSUE-228.md:2612-2619` |
| E36 | **`afldb_dev`:** 669 `afl_api` identities covering 669 providers and 669 players. All are `unique` / `afl_api_stat_vector_season`. There are 0 pending `unresolved_identity` candidates and 0 open contradictions. This agrees with ISSUE-224's 669/0/0. | §13.1; `issues.md:37573-37580` |
| E37 | **Documentation drift in the closed ISSUE-228 record.** Section H says the `afldb_test` `afl_api` identities are "all `resolved`" (`:2613`). S0 measures **803 `unique` / 0 `resolved`** on `afldb_test` and **669 `unique` / 0 `resolved`** on DEV. That matches the tracked loader, which writes only `'unique'` (E3), and the record's own §6.3 (`:584-585`, `:613-614`). The "all `resolved`" wording is wrong. **This is recorded here as an evidence correction.** The closed record is not edited, and ISSUE-235's semantics are **not** changed to fit the old wording. | S0 §13.1; loader `:469-472` |
| E38 | The **3** `afldb_test` rows with `match_method = 'afl_api_manual_adjudication'` are `status = 'unique'`. They are loader-written artefact links (E2, E3), **not** human `resolved` decisions. **They are not a precedent for** ISSUE-235's human state (D1). | S0 §13.1 |
| E39 | **`afldb_test`** has **3,179** pending `unresolved_identity` candidate rows covering **274** distinct providers, all in season 2026. **274** is also the number of links batch 2423 inserted (ISSUE-228 §22.15 G, `:2604-2610`). S0 did **not** join the two sets, so it is unproven whether these are the same providers. If they are, the providers are already linked and only await a settle (L-I "awaiting settle"), and the queue has no real U1 entries. §13.1 S0b measures this before any test or visual step relies on U1 rows existing on `afldb_test`. | S0 §13.1 |

### 2.6 ISSUE-244 constraints

This issue changes **no settle code**: no resolver, planner, applier, Brownlow or F030 guard. All
ISSUE-244 contracts stand unchanged: F001 derived recomputes, F007 vote-set integrity, F009 durable
apply-refusal findings and F010 withheld identity corrections. The only behavioural effect on
ingestion is E13/E17: a new trusted row resolves a provider on the next settle, through the path
ISSUE-228 already designed for `resolved`. The existing `settle-afl-api` integration suite is re-run
as the regression gate (§10.2).

---

## 3. Gaps the design must close

- **G1 — no human path.** The only human route is an artefact authored by hand under
  `afl_api_manual_adjudication` (E2, E10). It is written as `unique` (E3), so the database cannot
  tell it from a bootstrap classification by status.
- **G2 — the audit model does not fit.** An unresolved provider has **no row** (E15).
  `player_link_resolutions` is keyed on an existing surrogate `target_id` with a `NOT NULL
  previous_status` (E33). Its promotion identity for such a key is `none` (E34). It is also read by
  queue helpers that would start matching new rows (E26).
- **G3 — one player may silently gain two `afl_api` ids.** Neither the loader (E7) nor the schema
  (E11) enforces rule (b) across writers. With two writers, a human link to P for `CD_I_1` and a later
  bridge write of `CD_I_2 → P` would both be trusted by the resolver.
- **G4 — `classify_existing` is status-blind (E4).** Any `NULL`-player row written for an `afl_api`
  provider would become a permanent contradiction for every later bridge run.
- **G5 — contradiction findings repeat (E8).** Recorded (F-3), not fixed here.
- **G6 — human decisions are not rebuild-durable.** `afl_api` identities are re-imported by an
  operator from artefacts. A DB-only human decision would not survive a rebuild or promotion
  without a replay (F-2).

---

## 4. Decisions

### D1 — Precedence between importer `unique` and human `resolved`

**There is no ranking, because two rows can never coexist.** `UNIQUE (source_id, external_id)`
(E11) allows at most one `afl_api` row per provider. Precedence is therefore **first trusted writer
wins, and neither writer may change the other's row.** Both statuses are trusted identically by
ingestion (E13). That is the ISSUE-228 contract and is not changed.

- `status = 'resolved'` **with** `match_method = 'afl_api_admin_adjudication'` means a human decision
  made through this surface. That pair is the only one this issue writes.
- `status = 'unique'` means a loader write, whatever its artefact class. The legacy
  `afl_api_manual_adjudication` artefact rows (E3) stay `unique`. They are not rewritten, they
  remain loader-owned links, and this surface treats them as importer links. S0 confirms there are
  3 on `afldb_test`, all `unique` (E38). **They are not a precedent for the human state.**
- `unique` and `resolved` are **both trusted, and neither is "higher confidence".** They differ
  only in provenance: `unique` is a deterministic importer decision, and `resolved` is an explicit
  human adjudication (operator direction, 2026-09-23).
- Disagreement between the two writers is never settled by overriding. It is refused on the human
  side (D2) and withheld with a finding on the loader side (D4).

### D2 — A human resolution cannot replace an existing importer `unique` link

It is **refused.** Only an unlinked provider can be adjudicated. The reasons:

1. **The row has been consumed.** A trusted link is used by every settle (E17) to write
   `player_match_stats` under that `player_id` (E21), and derived tables are recomputed from them
   (ISSUE-244 F001). Changing the mapping without reattributing those rows would leave
   canonical statistics filed under the wrong person. That is a data correction, not an identity
   decision.
2. **It matches E27**, the existing surface's rule that an import-confirmed `unique` link is never
   overwritten from the admin UI.
3. **ISSUE-228 §6.3 is explicit:** "Once written, a link is trusted by ingestion forever"
   (`:579-580`).

A suspected wrong importer link is shown read-only with its open contradiction findings. Correcting
it is follow-up F-1.

### D3 — The importer never overwrites, deletes or downgrades a human resolution

This is already true by construction (E6), because the loader issues no `UPDATE` or `DELETE`. It
becomes a **pinned contract**: a Python static and fake-cursor test (§10.1 P1–P4) plus an
`afldb_test` assertion (§10.2 I7). A bridge run that agrees with a human link leaves the row
`resolved` and does not "upgrade" it to `unique`.

### D4 — A later bridge run that disagrees with a human resolution

| Bridge proposes | Loader outcome (after §7.4) | Human row |
|---|---|---|
| Same provider → **same** player | `already_linked` no-op, reported as `already_linked (human)` | Untouched, stays `resolved` |
| Same provider → **different** player | Existing contradiction path (E5): withheld, `data_issues` `afl_api_identity_contradiction`, `batch.reject`. `details` gains `existing_status` and `existing_match_method`. | Untouched |
| **Different** provider → the human-linked player | **New:** withheld as a player collision. `data_issues` of the same type with `details.kind = 'player_already_linked'` and `batch.reject`. Enforced in the loader and backstopped by the DB index (D6). | Untouched |

The admin detail page lists every open `afl_api_identity_contradiction` finding for the provider
and for the linked player, read-only. Resolving the disagreement is a human review. It is follow-up
F-1 when the human link is the wrong one.

### D5 — When provider evidence disappears

- **After a link:** nothing changes. A trusted link is independent of evidence availability
  (ISSUE-228 §6.3 `:579-580`). The audit row stores a **snapshot of the evidence the admin saw**
  (D8), so the decision stays explainable if the spine is pruned or the database is rebuilt.
- **Before a link:** the action requires evidence **at submit time**, meaning at least one
  pending `unresolved_identity` candidate for this provider in this database (E15). If the evidence
  is gone, superseded or already linked, the request is refused as stale (D7). A provider with no
  evidence is not actionable and does not appear in the queue.
- **Environment consequence:** a database with no AFL API settle history (PROD today) has an empty
  queue, and every link attempt there is refused. No environment flag is needed, and this mirrors the
  loader's no-PROD stance (E9) without hardcoding it.

### D6 — Collisions

All of the following are checked **inside the write transaction, after the locks in D7**. Any one of
them refuses with no write.

1. **Provider already has an `afl_api` row.** A trusted row for the same player returns "already
   linked (by importer or by <admin> at <time>)" as a no-op. A trusted row for a different player
   returns "linked to another player — correction is out of scope (F-1)". An untrusted or `NULL`
   row is an anomaly (state X, §5) and refuses fail-closed.
2. **The chosen player already holds a different `afl_api` provider row** (any status, `player_id =
   P`). The refusal names that provider.
3. **The chosen player does not exist, or has no stable identity.** The player must hold a trusted
   `afltables`/`afltables_profile_url` or `manual_admin_edit` identity, which is what D8 and F-2 key
   on. Otherwise the request is refused. There is no fallback.
4. **DB backstop (migration 104; OD-1 APPROVED 2026-09-23):** a partial unique index,
   **one `afl_api` provider per player**. It closes G3 across both writers, including the race the
   application checks cannot see. Rule (b) already treats two `CD_I` for one player as a
   contradiction (E7).
   - **S0 passed:** 0 players hold more than one `afl_api` id, on both `afldb_test` (803/803/803)
     and DEV (669/669/669); §13.1.
   - The migration still **re-checks for duplicates itself and fails closed** (§8.3). The S0 pass
     does not stand in for that check at migration time.

### D7 — Concurrency and stale submissions

- **Fingerprint.** The detail page renders a server-computed `evidence_sha256` over the canonical
  JSON (`canonicalJson`, `observations.ts`) of:
  - the provider id;
  - the existing `afl_api` row for it, if any (id, status, `player_id`, `match_method`);
  - the sorted `(candidate id, source_version_seq)` of its pending `unresolved_identity` candidates;
  - the id of its latest adjudication audit row;
  - the chosen player's id, their existing `afl_api` rows, and their stable identity.

  The form posts the provider id, player id, note, surname acknowledgement and fingerprint. Nothing
  else is trusted. Player names, evidence, scores and statuses are never read from the request.
- **Recompute under lock.** The action takes `pg_advisory_xact_lock` on
  `hashtextextended('afl_api_identity:provider:'||CD_I, 0)`, then on
  `hashtextextended('afl_api_identity:player:'||P, 0)`. Every writer in this issue locks in this fixed
  order, so there is no deadlock. The action then recomputes the fingerprint. **Any mismatch refuses
  with no write**: "The evidence changed after this page was loaded; reload and review again." This
  is stricter than the suggestion path's staleness *notice* (E31), deliberately, because this is a
  first-writer identity decision.
- **Two admins, same provider:** the second one waits on the lock, then sees the row (D6-1) or a
  changed fingerprint, and is refused. Exactly one audit row results.
- **Two admins, same player, different providers:** the player lock serialises them. The second sees
  D6-2 and is refused.
- **Admin vs a concurrent bridge `--apply`:** the loader takes no advisory lock. The unique
  constraints are the arbiter: provider uniqueness (E11) and the D6-4 player index. If the admin
  transaction loses, the unique violation is caught and reported as stale. If the loader loses, its
  batch fails closed under existing psycopg behaviour, and a re-run then reports `already_linked` or
  a withheld contradiction or collision. Nothing is partially written on either side.
- **Double submit:** handled as "two admins, same provider".

### D8 — Audit requirements: a new table, not `player_link_resolutions`

`player_link_resolutions` does not fit (G2): there is no target row, `previous_status` is
`NOT NULL`, a surrogate `target_id` would carry promotion identity `none` (E34), its CHECK would need
changing, and its queue helpers would silently start seeing `afl_api` rows (E26). The replacement
is a new **append-only** table, `afl_api_identity_adjudications` (migration 104, §8):

- **Keyed on stable identities only:** `external_id` (`CD_I…`, stable across seasons, E22) and
  `player_identity` (`afltables:<profile path>` or `manual_admin_edit:<token>`). `player_id` is kept
  for joins and for lineage remap in the promotion inventory. There is no surrogate `target_id`.
- **Durable identity authority (OD-3).** The table is the source that D15 replays human `resolved`
  rows from after a promotion. Its audit rows and the identity rows are kept consistent in both
  directions.
- **`action ∈ {linked, revoked}`.** `revoked` rows carry `supersedes_id` pointing at the `linked`
  row they undo (D10).
- **`previous_state jsonb`:** the provider's `afl_api` row before the action (NULL for a first link).
- **`evidence jsonb NOT NULL` + `evidence_sha256`:** the snapshot the admin was shown (§6) and its
  fingerprint.
- **`surname_disagreement_acknowledged boolean NOT NULL`**, **`note text NOT NULL`** (20–2000
  characters; OD-4), **`admin_user_id NOT NULL`** and `created_at`.
- **Written as `afldb_import` in the same transaction as the `external_identities` write** (the E28
  pattern). A failed audit insert rolls the link back.
- **Grants:** `afldb_import` gets `SELECT, INSERT` + sequence `USAGE`, and deliberately **not** the
  `import_writable_tables` registry (the 066 reason). `afldb_auth` gets `SELECT`, for the history
  view. `afldb_app` gets nothing. No role gets `UPDATE`/`DELETE`/`TRUNCATE`.
- **Activity log:** `audit('player_link.afl_api_linked' | 'player_link.afl_api_revoked', …)` after
  commit, best-effort with the existing warning (E30).
- **The `external_identities` row itself:** `status 'resolved'`, `match_method
  'afl_api_admin_adjudication'`, `candidate_count 0` (no classifier produced candidates),
  `external_name` = the provider's observed display name (display only), and `notes = 'AFLDB-ISSUE-235
  admin adjudication; see afl_api_identity_adjudications'`.

### D9 — Confirmed-unlinked is NOT valid for `afl_api` identities

There is **no** "confirm unlinked" or "dismiss" action for `afl_api` providers. The reasons:

1. **The semantics are false by construction.** `confirmed_unlinked` means "genuinely not an AFLDB
   player" (E29), for example a state-league name on an honours list. Every queued `CD_I` comes from a
   VFL/AFL senior match stat line (E15). AFLDB must eventually hold that person, so the only correct
   end state is *linked*, once the player is registered (ISSUE-224 surface) or evidenced.
2. **It would poison the bridge.** A `NULL`-player row would be read as a contradiction on every later
   loader run (E4, G4), which blocks a correct link forever and repeats findings (E8).
3. **It would hide real backlog.** An audit-only suppression would drop a provider from view while
   the settle still refuses its rows. ISSUE-228 S9 required `unresolvedIdentityPlayer = 0`, so hiding
   that count is the opposite of fail-closed.

The page states the non-link reasons honestly instead, for example "no canonical player to link:
register the player first (ISSUE-224 surface), then return". The provider stays listed until a human
or the bridge links it.

### D10 — Reversal of a human link: revoke only on a PROVEN non-use (OD-2, approved with hard guard)

**Rule (OD-2, 2026-09-23).** A human `resolved` link may be revoked only when database and code
evidence **proves** it has never been used to attach canonical or source-derived facts. Revoke
refuses when use exists, **and also when non-use cannot be proven**. There is no force override, no
operator assertion and no checkbox. Correcting a used link belongs to F-1.

**Why the original D10 test is insufficient (superseded).** The first version called a link
consumed only if one of two things existed:
- a staging projection row for the provider, or
- a `canonical_applications` row whose `external_record_id` ends `'|' || CD_I`.

That test fails open in two ways:
1. **Brownlow is invisible to the second check.** The Brownlow settle keys its observations and its
   `canonical_applications` rows by provider **match** id, not by `CD_I`
   (`afl-api-brownlow.ts:1038`, `:1469`). A vote that settle applied under the link does not end in
   `'|' || CD_I`, so the second check never sees it.
2. **An absent projection is not proof of non-use.** Projections are upserted by the settle
   (`afl-api-brownlow.ts:55-62`; `settle-afl-api.ts:718`), and a missing row can mean the settle
   never ran or that the evidence has since been superseded.

**Revised non-use proof.** This is a requirement set. The plan review may tighten it; it may not
loosen it.

1. **Serialise against in-flight consumers first.** Both AFL API consumers resolve players inside
   the same single write transaction that writes their facts:
   - the match settle: `settle-afl-api.ts:1722` → `:1137` → `afl-api-settle-plan.ts:417`;
   - the Brownlow settle: `afl-api-brownlow.ts:1438` → `:1499` → `:707`.

   That transaction's read of `external_identities` holds `ACCESS SHARE` on the table until it
   commits. The revoke transaction therefore runs `SET LOCAL lock_timeout = '2s'` (R6), then takes
   `LOCK TABLE external_identities IN ACCESS EXCLUSIVE MODE`, after the D7 advisory locks. The
   effects:
   - every settle that might have read the link has finished, and its writes are visible to the
     revoke's next statement (READ COMMITTED);
   - every later settle blocks until the revoke commits, and then does not see the link;
   - if the lock times out (`55P03`), the revoke is refused with **no write**, as "an AFL API
     ingestion run or another identity transaction is in progress; retry". A refusal is preferred to
     waiting indefinitely or weakening the lock.

   **Documented side effect (R6).** While the revoke waits, any new reader of `external_identities`
   queues behind the pending `ACCESS EXCLUSIVE` request. That includes player-identity reads in
   `src/db/queries/*`, and it lasts for **at most about 2 s**, plus the revoke's own short proof
   queries once the lock is granted. This is accepted as a rare, Super Admin-initiated stall.

   No settle code changes. The privilege is already in place: `external_identities` is
   import-writable, so `afldb_import` holds `DELETE`/`TRUNCATE`, which `LOCK … ACCESS EXCLUSIVE`
   needs (`045_import_write_is_fail_closed.sql:99-114`, `:137-139`; I1). A DB-free test pins the
   premise that resolution runs on the settle's own write `tx` (A12).
2. **Prove non-use through an explicit, test-pinned classification (R1, R2, R5; accepted
   2026-09-23).**

   **Why not a blanket scan.** A row with `source_id = afl_api` naming P does **not** by itself
   prove that the link was used. `player_height_evidence` (`086_player_height_evidence.sql:27-30`)
   holds `afl_api`-sourced rows whose player was chosen by name + club + season matching
   (`enrich_heights_afl_api.py:23-27`, `:187-216`), which never reads `external_identities`. "Used"
   is therefore **never** inferred from `source_id = afl_api` plus the same `player_id` alone.

   **The manifest.** One module (§7.1) holds a test-pinned manifest. It covers **every** table, in
   **every non-system schema**, that has a column with an FK to `players(id)`. "Non-system" means
   every schema except `pg_catalog`, `information_schema`, `pg_toast` and `pg_temp_*`/
   `pg_toast_temp_*`; it includes at least `public` and `staging` (R2). The catalogue is read at run
   time. There is no hard-coded public-only inventory. Each entry names its player column(s) and its
   provenance column(s), and carries exactly one class:

   | Class | Meaning | Effect on revoke |
   |---|---|---|
   | **`LINK_DEPENDENT`** | The player attribution of an `afl_api`-provenance row was established **through** the `afl_api` `external_identities` provider → player link. Initial set, to be confirmed at implementation by tracing every AFL API settle writer: `player_match_stats` and `brownlow_round_votes` (a F002-demoted `votes = 0` row still counts) in `public`; `staging.afl_api_player_match` and `staging.afl_api_brownlow_vote` (`103:311-325`, `:456-480`). | A row matching the entry's declared use predicate **is use** and refuses the revoke. For source-bearing tables the predicate is `source_id = <afl_api> AND <player column> = P`; for the staging projections it is also `OR provider_player_id = CD_I`. |
   | **`LINK_INDEPENDENT`** | The row may carry `afl_api` provenance, but its player was attributed **independently** of `external_identities`. Initial member: `player_height_evidence`. | Never counted as use by itself. |
   | **`NOT_SOURCE_BEARING`** | The row has a player reference but no source or provenance information that could record an `afl_api` attribution. Examples: derived tables recomputed from `LINK_DEPENDENT` base rows, identity tables, audit tables. The entry must state its reason. | Not a use source. It is listed so that the manifest is exhaustive. |

   **Fail-closed rules**, each of which refuses as "non-use cannot be proven":
   - a catalogue table with a player FK that is **absent** from the manifest;
   - a manifest entry whose declared columns do not exist in the catalogue;
   - a `NOT_SOURCE_BEARING` entry that has since gained a `source_id` column.

   A DB-free test pins the manifest against the migration set, and an `afldb_test` test pins it
   against the live catalogue. Either one fails when a new player-referencing table appears
   unclassified.

   **Ledger checks.** These are always run. They are `LINK_DEPENDENT` because only the AFL API
   settle's link-resolved writes produce `afl_api` rows in them. S4 must confirm that claim by
   tracing their writers, and a test pins it: if any `LINK_INDEPENDENT` writer is found recording
   into them, the predicate excludes that writer's rows by their `import_batch_id` → `tool`.
   - (b) **`canonical_applications`** with `source_id = afl_api` and **either**
     `target_key->>'player_id' = P` **or** `external_record_id LIKE '%|' || CD_I`. The table is
     append-only, so this proves use even after a canonical row was rewritten by another owner or
     its projection is gone. It catches the Brownlow case, whose `external_record_id` is a match id.
   - (d) **`promotion_candidates`** for `afl_api` with `proposed_fields->>'player_id' = P`, **or**
     with a verb other than `unresolved_identity` and `external_record_id LIKE '%|' || CD_I`.
     **`target_id` is not used (R5):** it is the target row's id (`074:163-164`), not a player id.
     Pending `unresolved_identity` candidates are the queue's own evidence and are not use.

   **Conservatism is accepted.** A `LINK_DEPENDENT` `afl_api` row for P that was attributed through
   some **other**, earlier link would also refuse. A false "used" is safe. A false "unused" is not.

   **An absent projection proves nothing.** A missing staging projection row is never evidence of
   non-use. Only the complete manifest plus the ledger checks, run under the point-1 lock, prove
   non-use.
3. **Only then write.** Delete the `external_identities` row and append a `revoked` audit row
   (`supersedes_id`, `previous_state`, plus a `non_use_proof` summary in `evidence`: the manifest
   version, every table and ledger checked, and the zero counts), under the D7 locks and
   fingerprint.

**Scope of revoke.** Only a human (L-H) link can be revoked. Every importer (L-I) link, and every
used human link, is refused (F-1). A revoke returns the provider to U1, or to U0 if its evidence has
gone.

**Fallback that complies with OD-2.** If the plan review or implementation cannot establish points
1–2 soundly, **revoke ships refusing unconditionally**, with the message "revocation unavailable:
non-use cannot be proven". It is never shipped with a weaker test.

### D11 — Evidence shown before adjudication

See §6. The name is displayed as a **display-only** fact and never discovers or ranks a candidate.

### D12 — The no-name-only rule is not weakened

- **No automatic linking.** No scorer, no suggestion approval, no bulk path and no pre-selected
  player. The server never picks a player.
- **Candidates come from evidence only.** The candidate list is exactly what the bridge's own
  discovery rule produces: same canonical match, same canonical club, same jumper
  (`afl-api-player-evidence.ts:28-29`). The PlayerPicker free search stays available because the
  admin is the decision-maker, but a free-searched player is labelled "chosen by admin, not
  evidence-derived".
- **A dedicated component, with an empty search (R7, accepted).** AFL API adjudication uses a new
  `AflApiAdjudicationForm`. It **never** reuses the honours `ResolveControls`, which carries
  create-and-link and seeds name fields from the honours row (`ResolveControls.tsx:166-167`,
  `:443-466`). Its PlayerPicker starts **empty**, and is never seeded, pre-filled, ranked or
  filtered from the provider's observed name.
- **Surname disagreement.** When rule (d) disagrees (for example a nickname), the form requires an
  explicit acknowledgement checkbox. The server re-derives the disagreement itself and refuses if it
  holds but the acknowledgement is absent.
- **The note must state the non-name evidence relied on.** It is mandatory and at least 20
  characters (OD-4).
- **No classifier becomes a writer.** The four existing loader evidence classes and their gates are
  unchanged.

### D13 — Scope boundary with ISSUE-224 and ISSUE-232

- **ISSUE-224 (resolved)** owns creating canonical players. This surface only links to an existing
  player with a stable identity (D6-3). It has no create-and-link, unlike the honours queue's
  `createAndLinkPlayer` (`actions.ts:146-231`).
- **ISSUE-232** owns operational status display: units, timers, last run, settle triggers. This
  surface shows only identity-adjudication state for providers. The "awaiting next settle" badge is
  derived from the pending candidate and the link, not from unit status.

### D14 — Pending promotion candidates are not touched

Adjudication never changes a `promotion_candidates` row (the F7 invariant, E16). After a link, the
next settle resolves the provider (E17), applies the player rows, and the candidates classify as
*moot*. The provider moves from "linked — awaiting settle" to "linked". §10.2 I5 proves this.

### D15 — Human decisions survive promotion and rebuild, together with their identity outcome (OD-3)

**Rule (OD-3, approved 2026-09-23).**
- `afl_api_identity_adjudications` is **durable identity authority**. It survives a database
  promotion or rebuild **together with** the `resolved` `external_identities` rows that ingestion
  relies on, with every `player_id` remapped.
- An audit row must never be preserved while its identity outcome is dropped, and an outcome must
  never exist without its audit row.
- If either side cannot be remapped or reinstated consistently, the promotion or rebuild **fails
  closed**.
- The table does **not** inherit `player_link_resolutions`'s DEV `historicalOnly` exemption
  (`promotion-inventory.ts:609-624`).

**Why a replay, not a table copy.** `external_identities` is import-writable and rebuilt, so it is
not a reinstated operations table. Neither the promotion runbook nor `db:test:rebuild` contains any
`afl_api` identity step. Carrying importer `unique` links is **AFLDB-ISSUE-237** and is out of scope
here. The design therefore splits the human side into a ledger that is reinstated and an outcome
that is replayed from it.

1. **The ledger is reinstated, and remapped through the existing lineage (R8).**
   `afl_api_identity_adjudications` is a reinstated operations table in **every** environment, with
   no `historicalOnly` entry.
   - `player_id` is remapped by the inventory's **existing** `afltables_profile_url` lineage ref
     (`promotion-inventory.ts:1591-1630`), which already resolves both AFL Tables profile paths and
     `manual_admin_edit` tokens. `player_id` is `NOT NULL`, so the existing NOT-NULL staging handles
     it (`:1378-1395`). **No new remap mechanism is introduced.**
   - **An extra fail-closed check:** after the remap, the remapped player's identity must equal the
     row's own stored `player_identity`. A mismatch stops the run.
   - A row whose identity does not resolve to **exactly one** candidate player also stops the run.
     It is never nulled, dropped or retargeted.
   - `supersedes_id` is an intra-table reference, so it is carried with the reinstated ids.
2. **The outcome is replayed from the ledger, right after the `players` override replay (R3).**
   - **Where.** In `docs/production-promotion.md` "Post-promotion state" step 1, **immediately
     after** `replay_admin_overrides('players')` (`:641-667`). That is the first point where the
     `manual_admin_edit` identities the remap needs exist in the candidate (`:641-648`, `:751-755`).
     It runs before the `data_edits` remap.
   - **What.** For every `external_id` whose latest non-superseded action is `linked`, the replay
     re-creates exactly one `external_identities` row: `afl_api`, `resolved`,
     `afl_api_admin_adjudication`, pointing at the remapped player.
   - **Precedent:** `replay_admin_overrides()` (`tools/migration/common.py:1160`, `:1311-1337`),
     which re-creates human `manual_admin_edit`/`afltables` identities from the durable admin record
     (ISSUE-160 §8.1).
   - **Replay decisions per provider.** The replay never overwrites either side:

     | Candidate state | Replay outcome |
     |---|---|
     | No `afl_api` row for the `CD_I`, and no `afl_api` row for the player | INSERT the human row |
     | Identical human row already present (same `CD_I`, player, `resolved`, `afl_api_admin_adjudication`) | Idempotent no-op |
     | Conflicting row for the `CD_I` (an importer row or a human row, any other player/status/method) | **STOP** |
     | The player already holds another `afl_api` row (OD-1) | **STOP** |
     | The player identity is unresolvable or ambiguous | **STOP** |

     A stop rolls the replay back as a whole and names every offending `CD_I`.
3. **Consistency proof.** The promotion or rebuild checker asserts a bijection in both directions,
   and any mismatch refuses:
   - every net-`linked` ledger entry has its matching `resolved` row;
   - every `resolved`/`afl_api_admin_adjudication` row has a net-`linked` ledger entry.

   **No audit row is retained without its effective human identity**, and no human identity exists
   without its audit row. The same assertion is a standalone read-only invariant check, usable on
   DEV and `afldb_test`.

**OD-5 — APPROVED (2026-09-23): OD-3 also binds the destructive `afldb_test` rebuild.**
`db:test:rebuild` (`tools/db/rebuild-test.ts`) resets `afldb_test` in place and rebuilds it from
tracked sources. Today it reinstates **no** operations table. For this table it must instead:

- (i) **Capture before destruction.** A new stage, run before the `destructive` stage, exports every
  `afl_api_identity_adjudications` row together with each row's `player_identity` to a hashed
  capture file in the run's output directory.
  - A capture failure refuses the rebuild **before** anything is destroyed.
  - An empty ledger is recorded as empty.
  - If the rebuild later fails, the capture file is the recovery source for a re-run.
- (ii) **Reinstate and replay after the players exist.** A new data stage runs after the stages that
  load players and their `afltables_profile_url` identities. It reinstates the captured ledger, with
  `player_id` remapped by `player_identity` in the rebuilt database and the same fail-closed checks
  as point 1, then runs the point-2 replay.
  - `afldb_test` has no reinstated `data_overrides`, so a ledger row keyed on a
    `manual_admin_edit:<token>` player cannot remap there, and the rebuild **stops**. That is the
    intended fail-closed outcome, not a skip.
- (iii) **Validate.** The rebuild's validation stage runs the point-3 bijection check.

**Consequence for tests.** Integration fixtures that write adjudications on `afldb_test` (I2–I10,
I14–I16) must remove them in teardown as the owner role. Otherwise the next rebuild carries them or
stops on them. The ledger is append-only only for `afldb_import`/`afldb_auth`.

**Importer rows through a rebuild or promotion.** These are AFLDB-ISSUE-237. After a rebuild or
promotion, importer `unique` rows exist only if an operator re-imports the bridge. The loader then
meets the replayed human rows through D4: an agreeing row is a no-op, and a disagreeing row or a
player collision is withheld with a finding. ISSUE-235 does not implement that lifecycle.

*[Correction 2026-09-24, AFLDB-ISSUE-237 F3. A bridge re-import is **not** a safe way to restore
importer rows after a rebuild or promotion. Three of the four artefact classes
(`afl_api_stat_vector_bootstrap`, `afl_api_name_team_season_bootstrap` and
`afl_api_manual_adjudication`) carry a bare, database-local `candidate_player_id` with no lineage
binding. The loader checks provenance only for `afl_api_stat_vector_season`. After a renumbering
reset, `--apply` could link a provider to whichever player now holds that integer. The paragraph
above describes the loader's D4 behaviour if a re-import happened; it is not a recovery procedure.
ISSUE-237 owns lifecycle carry-through, by stable identity and never from old artefacts. The
artefact hardening is AFLDB-ISSUE-241. The rest of this record is unchanged.]*

---

## 5. State model and transition table

States are per `afl_api` provider id in one database.

| State | Definition |
|---|---|
| **U0** unobserved | No pending `unresolved_identity` candidate and no `afl_api` row. Not listed and not actionable. |
| **U1** unresolved | At least one pending `unresolved_identity` candidate and no `afl_api` row. **Actionable (link).** |
| **L-I** importer-linked | A row with `status 'unique'` (any loader class). Read-only. |
| **L-H** human-linked | A row with `status 'resolved'` and `match_method 'afl_api_admin_adjudication'`. Read-only, except revoke while unconsumed. |
| **X** anomalous | A row with `player_id NULL`, an untrusted status, or `resolved` under any other method. No current writer produces this. Every action is refused and the row is flagged. |

"Awaiting settle" is a display sub-state of L-I/L-H: the row exists and active pending candidates
remain.

| # | Event | From | To | Effect |
|---|---|---|---|---|
| T1 | Admin link, all D6/D7 checks pass | U1 | L-H | INSERT the `external_identities` row and a `linked` audit row in one transaction |
| T2 | Admin link, provider already linked to the same player | L-I / L-H | same | Refused as "already linked"; no write, no audit |
| T3 | Admin link, provider linked to a different player | L-I / L-H | same | Refused (D2, F-1) |
| T4 | Admin link, player holds another `afl_api` provider | U1 | U1 | Refused (D6-2) |
| T5 | Admin link, no evidence at submit time | U0 | U0 | Refused (D5) |
| T6 | Admin link or revoke, fingerprint mismatch | any | same | Refused as stale (D7) |
| T7 | Admin link, player missing or without stable identity | U1 | U1 | Refused (D6-3) |
| T8 | Any admin action | X | X | Refused as an anomaly |
| T9 | Surname disagreement without acknowledgement | U1 | U1 | Refused (D12) |
| T10 | Bridge apply, provider free and player free | U0 / U1 | L-I | Unchanged loader behaviour |
| T11 | Bridge apply, same provider, same player | L-H | L-H | `already_linked (human)` no-op; status stays `resolved` |
| T12 | Bridge apply, same provider, different player | L-I / L-H | same | Withheld + `data_issues` (E5, enriched `details`) |
| T13 | Bridge apply, provider free, player held by another provider | U0 / U1 | same | **New:** withheld + `data_issues` `kind player_already_linked`; the index is the backstop |
| T14 | Bridge apply, row with `NULL` player | X | X | Existing contradiction path (E4), unchanged |
| T15 | Settle run | L-I / L-H | same | Resolver resolves (E13) and player rows apply; candidates go moot (D14) |
| T16 | Evidence pruned or superseded | L-* | same | No change (D5) |
| T17 | Evidence pruned or superseded | U1 | U0 | Leaves the queue |
| T18 | Admin revoke, non-use **proven** (D10 points 1–2) | L-H | U1 / U0 | DELETE the row and append a `revoked` audit row with the non-use proof (D10) |
| T19 | Admin revoke: used, non-use unprovable, or the table lock timed out | L-H | L-H | Refused (F-1, or "retry"); no write |
| T20 | Admin revoke | L-I | L-I | Refused (D2) |

---

## 6. Evidence shown to the Super Admin before adjudication

The detail page `/admin/player-links/afl-api/[providerId]` builds this server-side and read-only.
Each block states its source.

1. **Provider facts**, from the spine payload each pending candidate cites
   (`staging.source_record_versions` + `source_payloads`, the `settle-report.ts:294-347` pattern):
   - `CD_I`;
   - observed given name and surname, **labelled display-only**;
   - provider team(s) resolved to a canonical club through the `afl-api-identities.json` map (§6.2
     of ISSUE-228, never by name);
   - jumper number(s), seasons, and the count of refused player-stat records.
2. **Per observed match:** `match_key`, season, round, whether the canonical match exists and its
   owner, and the provider's core stat vector.
3. **Bridge-rule recomputation.** Assemble `AflApiMatchEvidenceInput` for the provider's matches:
   all provider rows of each match from the spine, plus that match's canonical `player_match_stats`,
   read exactly as the emitter reads them (`emit-afl-api-player-bridge.ts:357-396`). Run the pure
   engine `buildAflApiPlayerEvidence`, and display **this provider's classification**:
   - disposition and reason (for example `surname_disagrees(…)`, no core-vector match,
     single-match below 10 agreeing stats, all-zero single match, duplicate canonical jumper key);
   - per-match hits (candidate player, agreeing-stat count) and misses;
   - competing candidates.

   The heading says it plainly: *"This is the bridge's own rule applied to this database's current
   data. It is evidence, not a decision; rule (b) is evaluated only within these matches — see block
   5 for links elsewhere."*
4. **Candidate players**, taken only from block 3's hits and competitors. Each shows the career
   summary (`readPlayerSummaries`), the stable identity (AFL Tables path or manual token), the rule-(d)
   surname verdict, and any existing `afl_api` provider row.
5. **Collisions and contradictions:**
   - existing `afl_api` rows for each candidate player;
   - open `afl_api_identity_contradiction` findings naming the provider (`details->>'external_id'`)
     or the candidate player;
   - the provider's adjudication history from `afl_api_identity_adjudications`.
6. **Why it is unresolved, in words**, derived from blocks 3–5. Examples: "no candidate: likely an
   unregistered player — register via the ISSUE-224 surface first", "exact vector in 1 match with 8
   agreeing stats (rule c needs ≥ 10)", "surname disagrees: `Matt` / `Matthew`".
7. **Form:** a candidate radio list from block 4, or a PlayerPicker choice marked "admin-chosen"; the
   surname acknowledgement when block 3 or the chosen player shows a disagreement; the mandatory
   note; and the hidden fingerprint.

The evidence snapshot persisted in the audit row is blocks 1–5 in reduced form (ids, versions,
verdicts and counts, with no raw payloads) plus the fingerprint.

---

## 7. Design

### 7.1 Pure module: `src/lib/acquisition/afl-api-adjudication.ts`

This module has no DB, clock or network access. It holds:

- state classification (§5) from `{row | null, pendingCandidates, consumed}`;
- `adjudicationFingerprint(input)` over `canonicalJson`;
- input validation: `^CD_I[0-9]+$`, a positive integer player id, note bounds, and the
  acknowledgement flag;
- refusal decision and message mapping for T2–T9, T19 and T20;
- `extractProviderClassification(evidenceResult, providerId)`;
- the evidence-snapshot reducer;
- **the D10 player-reference manifest (R1, R2).** Every player-FK table in every non-system schema is
  classed `LINK_DEPENDENT`, `LINK_INDEPENDENT` or `NOT_SOURCE_BEARING`, with its columns, use
  predicate and reason. It also holds `validateManifestAgainstCatalogue(catalogueRows)` and the
  proof-result evaluator. These are pure: the catalogue rows and counts are passed in;
- **the D15 replay planner:** it takes `(ledger rows, remap results, candidate afl_api rows)` and
  returns the inserts, idempotent no-ops or a STOP with reasons, following D15's decision table. It
  also holds the bijection checker.

### 7.2 Query module: `src/db/queries/afl-api-player-links.ts` (`server-only`)

- **Reads:**
  - `listAflApiUnresolvedProviders()`: pending afl_api `unresolved_identity` candidates, grouped by
    `split_part(external_record_id,'|',3)`, left-joined to `external_identities`, via `authSql` for
    candidates and `sql` for the rest;
  - `readAflApiProviderEvidence(providerId)`, which builds §6 blocks 1–6;
  - `readAflApiAdjudicationHistory(providerId)`.
- **Writes**, each on a short-lived `AFLDB_IMPORT_DATABASE_URL` connection in one transaction (the
  E28 pattern):
  - `linkAflApiProvider({providerId, playerId, adminUserId, note, surnameAck, fingerprint})`: lock
    (D7), re-read, recompute the fingerprint, run the checks (D6, D12), then INSERT the
    `external_identities` row and INSERT the audit row. `23505` maps to stale.
  - `revokeAflApiLink({providerId, adminUserId, note, fingerprint})`:
    1. take the D7 advisory locks;
    2. `SET LOCAL lock_timeout = '2s'`, then `LOCK TABLE external_identities IN ACCESS EXCLUSIVE
       MODE` (D10 point 1, R6). On `55P03`, refuse as "retry" with no write;
    3. re-read the state and recompute the fingerprint;
    4. check the method;
    5. run the non-use proof (D10 point 2):
       - read the catalogue across all non-system schemas;
       - validate it against the pinned manifest, failing closed on any unclassified, missing or
         reclassified table;
       - run each `LINK_DEPENDENT` use predicate;
       - run the ledger checks (b) and (d);
    6. DELETE the row and INSERT the `revoked` audit row carrying the proof summary.

    **Grants:** none to add. `afldb_import` already holds `DELETE`/`TRUNCATE` on the import-writable
    `external_identities`, which `LOCK … ACCESS EXCLUSIVE` needs (I1).

### 7.3 Admin UI: `/admin/player-links/afl-api` and `/admin/player-links/afl-api/[providerId]`

- Both pages gate on `requireCapability('data.playerLinks')`.
- The list shows U1 and "awaiting settle" providers, a read-only section for open contradiction
  findings on L-* providers, and an honest empty state.
- The detail page shows §6.
- `actions.ts` holds `linkAflApiPlayer` and `revokeAflApiPlayerLink`. Neither calls `revalidatePath`;
  the client calls `router.refresh()` as `SuggestionControls` does (E32).
- `AflApiAdjudicationForm.tsx` is new (R7). It does not import `ResolveControls`. Its PlayerPicker
  starts empty and is never seeded from the provider's name. It requires a 20–2000-character note
  on every adjudication, and a surname-disagreement acknowledgement when the server reports a
  disagreement (OD-4). There is no confirmed-unlinked, bulk or suggestion control (D9, D12).
- The existing `/admin/player-links` page gains **only** a link to the new section. `LINK_TARGET_TABLES`,
  the honours queue, suggestions and bulk paths are untouched.
- **Before writing any route code,** read `node_modules/next/dist/docs/` for dynamic-segment
  `params` and for Server Actions in the installed Next 16.3.1 (the CLAUDE.md warning).

### 7.4 Loader hardening: `tools/migration/import_afl_api_player_bridge.py`

- `classify_existing` also returns the existing row's `status`, `match_method` and `player_id`, so
  output can report `already_linked (human)` vs `already_linked`. The contradiction `details` gain
  `existing_status` and `existing_match_method`.
- **New `player_collision` classification:** the candidate player already holds a different
  `afl_api` row. It is withheld, gets a `data_issues` row with `details.kind =
  'player_already_linked'`, and is recorded with `batch.reject`. It is reported by `--validate-only`
  as `would_HALT_player_collision`.
- The docstring is corrected: the loader is no longer the only `afl_api` writer. The admin
  adjudication path is named, and the no-`UPDATE`/`DELETE` contract is restated as binding against
  human rows.
- The loader **never** writes `resolved`, and the four evidence classes are unchanged.

### 7.5 Privileges and promotion

- **`privileges.sql`:** add the narrow `afldb_import` `SELECT, INSERT` + sequence block beside the
  066/068 blocks (`:296`, `:331`). Add `['afl_api_identity_adjudications','SELECT']` to the
  `afldb_auth` spec array (`:437-490`). Do not add it to `written`.
- **`promotion-inventory.ts` (OD-3, D15):**
  - Classify the new table as an operations table, reinstated **in every environment with no
    `historicalOnly` entry**.
  - It carries `footballRefs`/`lineageRefs` on `player_id` through the **existing**
    `afltables_profile_url` lineage ref, exactly like `player_link_resolutions` (`:545-560`). That
    lineage covers `manual_admin_edit` tokens too (`:1591-1630`), and there is no new mechanism
    (R8).
  - An added fail-closed assertion checks the remapped player's identity against the row's stored
    `player_identity`.
  - A row that does not remap uniquely stops the promotion.
- **Replay and consistency proof (D15, R3).** The replay re-creates human `resolved` rows from the
  reinstated ledger.
  - It runs **immediately after** `replay_admin_overrides('players')` in "Post-promotion state"
    step 1 (`docs/production-promotion.md:641-667`), and before the `data_edits` remap.
  - It follows the `replay_admin_overrides()` precedent, uses the D15 decision table, and never
    overwrites.
  - A read-only bijection check gates the promotion checker and is also usable standalone.
- **`db:test:rebuild` (OD-5):**
  - a pre-destruction capture stage for the ledger;
  - a post-player-load reinstate + replay stage;
  - a bijection check in the validation stage (D15 (i)–(iii)).

---

## 8. Migration decision

**A migration is required: `104_afl_api_identity_adjudications.sql`.** The number is provisional.
103 was the latest file on 2026-09-23, in this worktree and in the `D:\dev\afldb` checkout, and it
is the latest applied migration on both `afldb_test` and `afldb_dev` (S0). Re-verify when S1
starts, because a sibling branch may land first.

1. **`CREATE TABLE afl_api_identity_adjudications`:**

   | Column | Definition |
   |---|---|
   | `id` | bigint identity PK |
   | `source_key` | text NOT NULL CHECK (`= 'afl_api'`) |
   | `external_id` | text NOT NULL CHECK (`~ '^CD_I[0-9]+$'`) |
   | `action` | text NOT NULL CHECK (`IN ('linked','revoked')`) |
   | `player_id` | integer NOT NULL REFERENCES players |
   | `player_identity` | text NOT NULL |
   | `previous_state` | jsonb |
   | `evidence` | jsonb NOT NULL |
   | `evidence_sha256` | text NOT NULL CHECK (64 lowercase hex) |
   | `surname_disagreement_acknowledged` | boolean NOT NULL |
   | `supersedes_id` | bigint REFERENCES `afl_api_identity_adjudications(id)` |
   | `admin_user_id` | integer NOT NULL REFERENCES auth_users |
   | `note` | text NOT NULL CHECK (length 20–2000) |
   | `created_at` | timestamptz NOT NULL DEFAULT now() |

   Plus `CHECK ((action = 'revoked') = (supersedes_id IS NOT NULL))`, indexes on `external_id`,
   `player_id` and `admin_user_id` (the 071 FK-index precedent), and a table comment stating the
   append-only rule.
2. **Grants** as in D8, guarded by `IF EXISTS (pg_roles …)`, mirrored in `privileges.sql`.
3. **OD-1 (APPROVED), the player-uniqueness backstop.** S0 found 0 violations on both databases
   (§13.1). The migration keeps its own fail-closed pre-check regardless. It is a `DO` block:
   - resolves `sources.id` for `afl_api` (created by 077);
   - **refuses** if any `afl_api` `player_id` is held by more than one row, with an inspection
     query in the exception (the 044 pattern);
   - then `EXECUTE format('CREATE UNIQUE INDEX uq_external_identities_afl_api_player ON
     external_identities (player_id) WHERE source_id = %s AND player_id IS NOT NULL', id)`;
   - `COMMENT ON INDEX` names the source key and ISSUE-235.

   The source-id predicate binds **every** `afl_api` row whatever its `match_method`, unlike a
   `match_method LIKE 'afl_api_%'` convention, which a future writer could escape.

No `ALTER TYPE`: `resolved` already exists (E12). No change to `player_link_resolutions`.
Deployment order follows the ISSUE-027 lesson: migration and `db:privileges` **before** the code
that writes the table, or every link fails closed.

---

## 9. Implementation files expected to change

**New:**
- `src/db/migrations/104_afl_api_identity_adjudications.sql`
- `src/lib/acquisition/afl-api-adjudication.ts`
- `src/db/queries/afl-api-player-links.ts`
- `src/app/admin/player-links/afl-api/page.tsx`
- `src/app/admin/player-links/afl-api/[providerId]/page.tsx`
- `src/app/admin/player-links/afl-api/actions.ts`
- `src/app/admin/player-links/afl-api/AflApiAdjudicationForm.tsx` (client; link + revoke controls)

**Changed:**
- `tools/migration/import_afl_api_player_bridge.py` (§7.4)
- `tools/maintenance/privileges.sql` (§7.5)
- `tools/db/promotion-inventory.ts` (§7.5, OD-3: reinstated everywhere, remapped through
  `player_identity`)
- **OD-3/OD-5 replay and consistency check (D15).**
  - The replay code goes beside `replay_admin_overrides()` in `tools/migration/common.py`, or in a
    dedicated `tools/migration/replay_afl_api_adjudications.py`. The choice is made at S4b by
    whichever reuses the existing precedent more directly; the choice is disclosed.
  - The promotion checker in `tools/db/`.
  - `docs/production-promotion.md` (the post-promotion step 1 placement).
  - `tools/db/rebuild-test.ts`: the capture, reinstate/replay and validation stages. Its DB-free
    stage-order tests go in `tests/db-test-rebuild.test.ts`.
- `src/app/admin/player-links/page.tsx` (section link only)
- `src/lib/acquisition/afl-api-player-resolver.ts` (doc comment only: name the human writer; no logic)
- `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` (a dated note that `afl_api` has two identity
  writers and what their precedence is)
- **Tests** (§10), extending existing suites only: `tests/python/afl_api_bridge_contract.py`,
  `tests/player-link-mutations.test.ts`, `tests/player-links-page.test.ts`,
  `tests/db-promotion-check.test.ts`, `tests/integration/settle-afl-api.test.ts`,
  `tests/integration/player-link-concurrency.test.ts`, `tests/integration/privileges.test.ts`
- **At closure:** `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`

**Explicitly unchanged:**
- `settle-afl-api.ts`, `afl-api-settle-plan.ts`, `afl-api-player-evidence.ts` (consumed, not
  modified)
- `player-links.ts`, `player_link_resolutions`, `LINK_TARGET_TABLES`
- the builders/emitters, `deploy/`

---

## 10. Tests

### 10.1 DB-free

**Vitest: `tests/player-link-mutations.test.ts`, new `describe` blocks** (the suite already mocks
`postgres`, `authSql`, `sql` and the session):

- **A1.** The fingerprint is deterministic and independent of input order. Any field change
  (row, candidate version, audit id, player links) changes it.
- **A2.** Validation rejects a bad provider id, a non-integer player id, a note under 20 or over 2000
  characters, and a missing acknowledgement when a disagreement holds.
- **A3.** State classification covers U0, U1, L-I (each loader method, including legacy
  `afl_api_manual_adjudication`), L-H, and X (`NULL` player, untrusted status, `resolved` with a
  foreign method).
- **A4.** Refusal mapping covers T2–T9, T19 and T20, each with no write statement issued (the mocked
  `tx` records statements).
- **A5.** `linkAflApiProvider` issues, in order: provider lock, player lock, re-reads, the
  `external_identities` INSERT (`'resolved'`, `'afl_api_admin_adjudication'`), then the audit
  INSERT. An audit failure propagates, so the mocked `begin` rejects.
- **A6.** Both actions reject a non-super-admin: `requireCapability` throws, and there is no query
  call.
- **A7.** The actions ignore posted names, scores and status fields. Only the provider id, player id,
  note, acknowledgement and fingerprint reach the query layer.
- **A8.** Neither action calls `revalidatePath`.
- **A9.** `extractProviderClassification` over a fabricated engine result: a hit, a surname
  disagreement, and competitors.

**Vitest: `tests/player-links-page.test.ts`:**

- **B1.** The AFL API pages render no bulk, suggestion-approve or confirm-unlinked control.
- **B2.** The empty state renders.
- **B3.** An admin-chosen player is labelled as such.
- **B3b (R7).** `AflApiAdjudicationForm`:
  - it does not import `ResolveControls`;
  - its PlayerPicker renders with an empty query even when the provider's observed name is present
    in the page data;
  - it sends no name field to the action.
- **B4.** The honours queue and `LINK_TARGET_TABLES` are unchanged (`afl_api` is not a link target
  table).

**Vitest: `tests/db-promotion-check.test.ts`:**

- **C1.** The new table is classified, so `classifyPublicTables` reports no `unclassified` entry.
- **C2.** Its lineage ref is declared on `player_id`.
- **C3 (OD-3).** `historicalOnlyFor(table, env)` is `undefined` for **every** environment,
  including `dev`. The table is `reinstate` everywhere.
- **C2b (R8).** The lineage ref uses the existing `afltables_profile_url` identity, and no new
  identity kind is added. The post-remap assertion refuses a remapped player whose identity differs
  from the stored `player_identity`.
- **C4 (OD-3, R3).** The replay's pure planner covers every row of the D15 decision table, DB-free:
  - a net-`linked` entry produces one `resolved` INSERT;
  - a `revoked` entry produces none;
  - an identical human row already present is an idempotent no-op;
  - each of these produces a **stop**, never a skip or an overwrite:
    - a conflicting importer `unique` row for the `CD_I`;
    - a conflicting human row;
    - a player already holding another `afl_api` row;
    - an unresolvable or ambiguous identity.
- **C5 (OD-3).** The bijection checker reports both directions: a ledger entry without its row, and
  a row without its ledger entry.
- **C6 (OD-5), in `tests/db-test-rebuild.test.ts`.** The planned stage graph places:
  - the ledger capture **before** the `destructive` stage;
  - the reinstate/replay stage **after** the player-identity-loading stages;
  - the bijection check in validation.

  A capture failure refuses before destruction.

**Vitest: `tests/player-link-mutations.test.ts`, OD-2 additions:**

- **A10.** The revoke issues, in order: advisory locks, `SET LOCAL lock_timeout = '2s'`, the
  `LOCK TABLE … ACCESS EXCLUSIVE`, the re-reads, then the proof queries. The DELETE comes only after
  every proof count is 0.
- **A11 (R1, R2, R5).** The manifest proof fails closed:
  - a catalogue player-FK table absent from the manifest (in **any** non-system schema, including a
    `staging` table) refuses as unprovable;
  - a manifest entry whose columns are missing refuses;
  - a `NOT_SOURCE_BEARING` table that has gained `source_id` refuses;
  - a `LINK_INDEPENDENT` `afl_api` row for P, such as `player_height_evidence`, does **not** count as
    use on its own;
  - a `LINK_DEPENDENT` row, a `canonical_applications` hit or a `promotion_candidates`
    `proposed_fields` hit counts as use;
  - `promotion_candidates.target_id` is never read;
  - a lock timeout (`55P03`) refuses as "retry".
- **A11b.** A manifest pin against the migration set:
  - every `REFERENCES players` column created by `src/db/migrations/*.sql` appears in the manifest;
  - the classes are those D10 declares.
- **A12.** A premise pin: `resolveAflApiPlayer` is called with the settle's own write transaction
  handle in both consumers. This is a static or source assertion over `afl-api-settle-plan.ts:417`
  and `afl-api-brownlow.ts:707` call chains.

**Python: `tests/python/afl_api_bridge_contract.py`** (fake cursor):

- **P1.** An existing `resolved` row for the same player gives `already_linked (human)`, with no
  INSERT, UPDATE or DELETE issued.
- **P2.** A different player gives a contradiction `data_issues` row whose `details` include
  `existing_status`/`existing_match_method`, and the existing row is untouched.
- **P3.** A player held by another provider gives `player_collision`: withheld, `data_issues`
  `kind player_already_linked`, and no INSERT into `external_identities`.
- **P4.** Static scan: the loader source contains no `UPDATE external_identities` or `DELETE FROM
  external_identities`.
- **P5.** `--validate-only` counts include `would_HALT_player_collision`.

The existing checks must stay green.

### 10.2 `afldb_test` integration

These run after `db:migrate:test` and `db:privileges:test`.

**`tests/integration/settle-afl-api.test.ts`, new `describe`.** It reuses the suite's `afl_api`
fixtures: the synthetic player, `BRIDGED_PROVIDER_PLAYER_ID` and `UNBRIDGED_PROVIDER_PLAYER_ID`
(`:786-790`, `:1342-1346`).

- **I1.** Migration 104: the index exists with predicate `source_id = <afl_api id>`. A second
  `afl_api` row for the same player raises `23505`. Two rows for the same player under another
  source are still allowed.
- **I2.** Settle leaves `UNBRIDGED` in U1. `linkAflApiProvider` then writes one `resolved` row and
  one `linked` audit row with matching `evidence_sha256`.
- **I3.** Atomicity: force the audit insert to fail (a note that violates the CHECK, bypassing
  validation). The result is zero `external_identities` rows and zero audit rows.
- **I4.** Refusals T3, T4, T5, T6, T7 and T8 (T8 uses a fixture `NULL`-player row) each leave
  table counts unchanged.
- **I5.** After I2, re-run the golden settle case. The player row lands under the chosen player, the
  earlier pending candidate classifies `moot` (`classifyCandidate`), and `unresolvedIdentityPlayer`
  drops. The existing suite cases stay green.
- **I6.** Revoke before I5 deletes the row and appends a `revoked` row with `supersedes_id` and a
  non-use proof. Revoke after I5 is refused as used. Three extra cases:
  - **I6b (Brownlow, OD-2).** A human link consumed **only** by a Brownlow settle, with its
    `brownlow_round_votes` row present and its projection row deleted by the test, is still refused
    as used, through D10 (a) and (b).
  - **I6c.** The same link with the canonical row's provenance rewritten to another source is still
    refused, through `canonical_applications` (b).
  - **I6d (lock).** A second session holds an open transaction that has read `external_identities`.
    The revoke refuses on `lock_timeout` and writes nothing.
- **I7.** Revoke or link against the `BRIDGED` (`unique`) provider is refused. That row's
  `status`, `player_id` and `match_method` are unchanged.

**`tests/integration/player-link-concurrency.test.ts`, new interleavings** (in the existing A/B/C
style):

- **I8.** Two links for the same provider to different players, where the first holds its lock:
  one row and one audit row result, and the second is refused as stale or already linked.
- **I9.** Two providers to the same player: one wins and the other is refused as a collision.
- **I10.** An admin link racing a raw bridge-style `INSERT` of the same provider (simulating the
  loader): exactly one row exists, and the admin side reports stale on `23505`.

**`tests/integration/privileges.test.ts`:**

- **I11.** `afldb_import` has `SELECT, INSERT` on `afl_api_identity_adjudications`, and no
  `UPDATE`/`DELETE`/`TRUNCATE`.
- **I12.** `afldb_auth` has `SELECT` only.
- **I13.** `afldb_app` has nothing.

**OD-3/OD-5 replay, in `tests/integration/settle-afl-api.test.ts` (new `describe`).** This follows
the repository's precedent that each feature's own integration suite tests its replay, as
`admin-coaches.test.ts`, `admin-draft.test.ts` and `admin-season-lists.test.ts` do for
`replay_admin_overrides`.

- **I14.** From a fixture ledger, with a `linked` entry, a `linked`+`revoked` pair, and a player
  whose ids differ from the ledger's `player_id`:
  - the replay creates exactly the net-linked `resolved` rows, under remapped players;
  - the bijection check passes;
  - a second run is an idempotent no-op.
- **I15.** Each fail-closed condition stops the replay with no partial write. In every case both the
  existing row and the ledger are left untouched:
  - an unresolvable or ambiguous identity;
  - a remap whose identity differs from the stored `player_identity`;
  - a pre-existing importer `unique` row for the `CD_I` naming a different player;
  - a pre-existing importer `unique` row for the same `CD_I` and **the same** player (it is not the
    identical human row, so it still stops);
  - a conflicting human row;
  - a player already holding an `afl_api` row.
- **I16.** After the replay, the loader `--dry-run` reports agreeing providers as `already_linked
  (human)`.
- **I17 (R1/R2 live pin).** The live `afldb_test` catalogue, across all non-system schemas, matches
  the D10 manifest exactly.
- **I18 (OD-5), a guarded `afldb_test` rebuild validation.** This is operator-run and authorised for
  `afldb_test` only. Seed one fixture human adjudication, on a player with an AFL Tables identity,
  then run `db:test:rebuild`. Afterwards:
  - the ledger row is reinstated under the rebuilt player id;
  - the `resolved` row is re-created;
  - the bijection check passes;
  - the capture file's hash is recorded.

  The **negative** paths (an unresolvable `manual_admin_edit` key, and a conflict) are proven at
  function level by I15 and at stage-order level by C6. A deliberately failing destructive rebuild
  is **not** run, because it would leave `afldb_test` half-rebuilt for no additional evidence.
  Afterwards the fixture is removed, leaving the ledger empty.

  **Fixture choice** (superseded 2026-09-24 by the tracked harness
  `npm run db:test:issue235-i18`; see the "I18 preparation" update near the top).
  - The provider is `CD_I9991800001`. The earlier example `CD_I9990000001` is I1's own
    `providerA`.
  - The history is linked, revoked and linked, so `supersedes_id` is proven.
  - The player is `players/A/Alan_Martello.html`, resolved by the D15 rule. It has an AFL Tables
    identity and holds **no** `afl_api` row, so OD-1 cannot trip.
  - Stage-18 success criterion: the pending capture may be archived only after the reinstate
    transaction has committed and the stage-18 exact read-back, sequence, replay and bijection
    verification have succeeded.

  **Side effects: confirm with the operator immediately before running.** `db:test:rebuild` is the
  whole ~21-minute destructive reset.
  - It discards `afldb_test`'s current 803 importer `afl_api` identities (the ISSUE-237 gap) and the
    other ISSUE-228 S9 `afldb_test` state that is not rebuilt from tracked sources.
  - It needs the accepted source snapshots staged in the worktree.

  I18 is authorised by the operator's 2026-09-23 scope, but its timing is confirmed at S6, because
  it resets a shared test database.

**U1 population on `afldb_test` (E39).** Before relying on real U1 rows for V5–V8, run S0b (§13.1).
If the 274 pending candidates belong to already-linked providers, `afldb_test` has no genuine U1
provider. The tests then use fixture providers only. The V5–V8 captures either use a fixture
provider on `afldb_test` or are marked `VISUAL: UNVERIFIED`.

**Bridge regression on `afldb_test` (operator-run, rollback only).** Run the loader
`--validate-only`, then `--dry-run`, against the accepted `afldb_test` artefact(s). The expected
result is every provider `already_linked`, with 0 `would_link`, 0 contradiction and 0
`would_HALT_player_collision`. *(Superseded 2026-09-24 by operator option (b): after I18,
`afldb_test` holds no `afl_api` identities, so validate-only expects every provider `would_link`
with 0 HALT/conflict. Result 669/0/0/0/0/0 is in the S7 update above.)*

**Regression gates:** the existing `settle-afl-api*.test.ts` integration suites (ISSUE-244
contracts), and `npm run typecheck`.

---

## 11. DEV browser validation (Visual Evidence Mandate declaration)

**Target viewports.** Desktop 1440×900 is primary. Phone 390×844 is secondary: the table must not
overflow the page, and the evidence blocks must stack. This follows the ISSUE-161 order, desktop >
tablet > phone.

**Reference design.** The existing `/admin/player-links` page: `page-header`, `section`,
`table-wrap`, `badge`/`badge-warn` and `section-note`. No new visual language.

**Screens and states to capture:**

- **V1.** `/admin/player-links`, showing the new section link.
- **V2.** `/admin/player-links/afl-api`, in its expected empty state on DEV (E36: 0 unresolved) or
  with real rows if a provider has become unresolved since.
- **V3.** The detail page for one real **bridged** DEV provider, read-only. Evidence blocks 1–5
  must render, and block 3's recomputed disposition must agree with the existing link (a live
  consistency check with no write). There is no link form, and "linked by importer" is shown.
- **V4.** The same URLs signed in as a non-super-admin show the capability refusal.
- **V5–V8, the mutation states:** link success ("linked — awaiting settle"), the collision
  refusal, the stale refusal, and revoke available vs refused.
  - These are captured on a **local `next dev` pointed at `afldb_test`** (operator-run, test
    database only), because DEV holds no unresolved provider and **no synthetic data may be created on
    DEV**.
  - If a genuine unresolved provider exists on DEV at validation time, the operator decides whether
    to adjudicate it for real. Otherwise V5–V8 on DEV are marked `VISUAL: UNVERIFIED (no DEV
    population)`, with the `afldb_test` captures as the evidence.

**Capture tooling.** The repository's own Playwright via `npx`, as §15 requires. A failure is
recorded in `.phaneslight/config.json` `capabilities.failures[]` and the session summary, and the
state is marked `VISUAL: UNVERIFIED`. Prose approval is not acceptance.

**DEV read-only post-deploy checks (operator-run):**

- the index exists;
- `afl_api_identity_adjudications` has 0 rows;
- the S0 census (§13) is unchanged;
- loader `--target dev --validate-only` against the accepted 669-provider DEV artefact returns
  669 `already_linked`, 0 `would_link`, 0 `would_HALT_contradiction` and 0
  `would_HALT_player_collision`.

---

## 12. Rollback and reversibility

- **Code.** Reverting the UI, actions, query and pure modules is safe at any time. Existing human
  rows stay trusted: the resolver needs no code to honour `resolved`.
- **Loader change.** Reverting it restores the old reporting. With the index in place, a collision
  would then abort the loader batch instead of being withheld, which is still fail-closed. The index
  must not be dropped merely because the loader is reverted.
- **Migration 104 is forward-only**, per project practice. Reversal is a new migration:
  - dropping the index is safe;
  - the audit table may be dropped **only when it holds 0 rows**. Otherwise export it first,
    because it is the record of human identity decisions.
- **Data.**
  - An unconsumed human link is reversed in-product (D10), with a `revoked` audit row.
  - A consumed human link, or any importer link, is not reversible here (F-1).
  - No action deletes or rewrites an audit row.
- **Deployment order.** Migration 104, then `db:privileges`, then the code. If the code is deployed
  first, every action fails closed (the ISSUE-027 lesson); nothing is written.

---

## 13. Execution sequence (implementation task; commands are user-executed per CLAUDE.md §9)

**S0 — Read-only census (operator, before any code).** Run on `afldb_test` (`$AFLDB_TEST_DATABASE_URL`)
and on DEV. It confirms E35/E36 and the OD-1 precondition, and the result is recorded here.

```sql
BEGIN READ ONLY;
SELECT ei.status, ei.match_method, count(*) AS n, count(ei.player_id) AS with_player
  FROM external_identities ei JOIN sources s ON s.id = ei.source_id
 WHERE s.key = 'afl_api' GROUP BY 1, 2 ORDER BY 1, 2;
SELECT count(*) AS players_with_multiple_afl_api_ids
  FROM (SELECT ei.player_id FROM external_identities ei JOIN sources s ON s.id = ei.source_id
         WHERE s.key = 'afl_api' AND ei.player_id IS NOT NULL
         GROUP BY 1 HAVING count(*) > 1) d;
SELECT c.season, count(*) AS pending_rows,
       count(DISTINCT split_part(c.external_record_id, '|', 3)) AS providers
  FROM promotion_candidates c JOIN sources s ON s.id = c.source_id
 WHERE s.key = 'afl_api' AND c.verb = 'unresolved_identity' AND c.status = 'pending'
 GROUP BY 1 ORDER BY 1;
SELECT count(*) AS open_afl_api_contradictions
  FROM data_issues WHERE issue_type = 'afl_api_identity_contradiction' AND resolved_at IS NULL;
ROLLBACK;
```

If `players_with_multiple_afl_api_ids > 0` on either target, **stop**. OD-1 cannot be applied as
designed until each case is adjudicated.

### 13.1 S0 evidence — COMPLETE, OD-1 gate PASS (operator-run, 2026-09-23)

**How it was run.** The census ran the four runbook queries above unchanged, plus read-only
extensions (session identity, totals, provider multiplicity, OD-1 conflict rows, stable-identity
coverage, the index inventory, and the absence of the proposed objects). Each database was measured
in `BEGIN READ ONLY … ROLLBACK` with `PGOPTIONS='-c default_transaction_read_only=on'`, from the DEV
host, and nothing was written. The session scratch file `issue235-s0-census.sql` is not tracked.

| Measure | `afldb_test` | `afldb_dev` |
|---|---|---|
| Measured at | 2026-09-23 21:17:41 +10 | 2026-09-23 21:18:18 +10 |
| Role / `transaction_read_only` | `afldb_owner` / `on` | `afldb_owner` / `on` |
| Latest applied migration | `103_afl_api_match_projections.sql` | `103_afl_api_match_projections.sql` |
| `afl_api` `sources.id` | 6 | 6 |
| `unique` / `afl_api_manual_adjudication` | 3 | 0 |
| `unique` / `afl_api_name_team_season_bootstrap` | 129 | 0 |
| `unique` / `afl_api_stat_vector_bootstrap` | 397 | 0 |
| `unique` / `afl_api_stat_vector_season` | 274 | 669 |
| **Rows / distinct providers / distinct players** | **803 / 803 / 803** | **669 / 669 / 669** |
| `unique` rows / **`resolved` rows** | 803 / **0** | 669 / **0** |
| `NULL`-player rows; untrusted statuses | 0; 0 | 0; 0 |
| Non-`CD_I` ids; unknown `match_method`; `candidate_count <> 1` | 0; 0; 0 | 0; 0; 0 |
| **`players_with_multiple_afl_api_ids`** | **0** | **0** |
| Providers with multiple rows or players | 0 | 0 |
| OD-1 conflicting-row listing | 0 rows | 0 rows |
| Pending `unresolved_identity` candidates | 3,179 rows, 274 providers, season 2026 | 0 |
| Open `afl_api_identity_contradiction` | 0 | 0 |
| `afl_api` rows whose player lacks a stable identity | 0 | 0 |
| `external_identities` indexes | `external_identities_pkey`; `external_identities_uq` UNIQUE (`source_id`, `external_id`); `ix_external_identities_player` (`player_id`) WHERE `player_id IS NOT NULL` | same |
| `afl_api_identity_adjudications` / OD-1 index | absent / absent | absent / absent |

**Conclusions.**

1. **OD-1 gate: PASS on both databases.** The `afl_api` population is strictly one-to-one
   (provider ↔ row ↔ player). No existing data blocks the index. The migration still re-checks for
   duplicates itself and fails closed (§8.3).
2. **Every existing `afl_api` identity is `unique`**, and none is `resolved`. That matches the only
   tracked writer, which writes only `'unique'` (E3, loader `:469-472`). A repository search found
   no other `afl_api` writer and no `UPDATE`/`DELETE` of `afl_api` rows.
3. **The ISSUE-228 "all `resolved`" wording is documentation drift (E37).** It is recorded as an
   evidence correction here, and the closed record is not edited. The implementation semantics are
   unchanged.
4. **The 3 legacy `afl_api_manual_adjudication` rows are `unique` (E38).** They are loader-owned
   importer links (L-I), not human decisions, and not a precedent for L-H.
5. **Every linked player has a stable identity** (0 without one) on both databases, so D6-3 and the
   D15 remap key are satisfiable for the whole current population.
6. **DEV has an empty U1 queue** (0 pending), which is consistent with E36. **`afldb_test`'s 274
   pending providers need S0b** before they are treated as U1 (E39).

**S0b — optional read-only follow-up for E39 (operator-run; it gates nothing in S1).**

```sql
BEGIN READ ONLY;
SELECT count(*) FILTER (WHERE ei.id IS NOT NULL) AS pending_providers_already_linked,
       count(*) FILTER (WHERE ei.id IS NULL)     AS pending_providers_genuinely_unresolved
  FROM (SELECT DISTINCT split_part(c.external_record_id, '|', 3) AS cd_i
          FROM promotion_candidates c JOIN sources s ON s.id = c.source_id
         WHERE s.key = 'afl_api' AND c.verb = 'unresolved_identity' AND c.status = 'pending') p
  LEFT JOIN external_identities ei
         ON ei.source_id = (SELECT id FROM sources WHERE key = 'afl_api') AND ei.external_id = p.cd_i;
ROLLBACK;
```

### 13.2 Execution sequence: final reconciliation with OD-1 to OD-5 and R1–R8 (2026-09-23)

**Implementation authorisation (operator, 2026-09-23).**

| Authorised | Not authorised |
|---|---|
| Implementation in `D:\dev\afldb-issue-235` | Any production mutation or production deployment |
| Migration 104, **only** if it is still the next free number immediately before it is created | Synthetic data on DEV |
| DB-free tests | Merge to `main`, or push |
| The guarded `afldb_test` integration and rebuild validation specified here (I1–I18); I18's timing is confirmed at S6 | Deleting or rewriting existing human or importer identity decisions outside this runbook |
| Local browser validation against `afldb_test` | Solving ISSUE-237 inside ISSUE-235 |

Git commits remain operator-controlled. Under CLAUDE.md §9, this grant is the per-task exception for
exactly the commands in the left column.

**S1 — Schema, privileges and inventory.**
- Re-verify that migration 104 is free (the migration directory, plus `afldb_meta.schema_migrations`
  on `afldb_test`), then write migration 104:
  - the table, with the note CHECK 20–2000 (OD-4);
  - the OD-1 index with its own fail-closed duplicate pre-check.
- Add the `privileges.sql` mirror. There is no `external_identities` grant change (I1).
- Add the promotion-inventory entry: reinstated in every environment, the **existing**
  `afltables_profile_url` lineage ref, and the stored-identity assertion hook (OD-3, R8).
- Tests: C1–C3, C2b, I1, I11–I13.

**S2 — Loader hardening (§7.4),** plus P1–P5.

**S3 — Pure module (§7.1),** plus A1–A4, A9 and A11b. The module holds:
- the D10 manifest, its catalogue validator and the proof evaluator (R1, R2, R5);
- the D15 replay planner and the bijection checker (C4, C5).

**S4 — Query module (§7.2),** plus A5, A10–A12 and I17.
- The link path.
- The revoke, with `lock_timeout = '2s'`, the table lock, the manifest-validated proof and the
  ledger checks (b) and (d), without `target_id`.
- Confirm by tracing that the ledgers have no `LINK_INDEPENDENT` writer.
- **Gate:** if the D10 proof cannot be implemented soundly, revoke ships refusing unconditionally.
  It is never shipped with a weaker test.

**S4b — Replay, bijection check, promotion and rebuild integration (D15; OD-3, OD-5, R3, R8),** plus
C6 and I14–I16.
- The replay step runs immediately after `replay_admin_overrides('players')`, and is documented in
  `docs/production-promotion.md` "Post-promotion state" step 1.
- The bijection check gates the promotion checker.
- In `db:test:rebuild`: pre-destruction capture, post-player-load reinstate and replay, and the
  validation-stage bijection check.
- Nothing is added for importer `unique` rows (ISSUE-237).

**S5 — Actions and UI routes (§7.3),** after reading the Next 16 docs, plus A6–A8, B1–B4 and B3b.
- A dedicated `AflApiAdjudicationForm` with an empty, never-seeded PlayerPicker. It does not reuse
  `ResolveControls` (R7).
- The OD-4 note (20–2000 characters) and the surname acknowledgement.
- No confirmed-unlinked, bulk or suggestion control (D9, D12).

**S6 — `afldb_test` validation.**
- Run `db:migrate:test`, then `db:privileges:test`.
- Run I2–I10, I6b–I6d and I14–I17.
- Run the settle regression suites, the loader validate-only and dry-run, and typecheck.
- Run S0b before any V5–V8 capture relies on real U1 rows.
- Run **I18** (the guarded rebuild) only after the operator confirms its timing and side effects.

**S7 — Documentation note (§9):**
- the two-writer precedence;
- D10's revoke semantics, including the manifest and the ~2 s read stall;
- the D15 promotion and rebuild replay;
- the ISSUE-237 boundary.

**S8 — DEV rollout.** This is operator-controlled and **not** covered by the 2026-09-23 grant beyond
local work.
- The operator commits, runs `merge:ready`, then pushes/merges and runs `sync-dev.ps1`.
- `db:privileges` on DEV.
- The §11 read-only checks, including a re-run of the S0 census, which must be unchanged apart from
  the new index and table.
- The D15 bijection check on DEV, which is expected to be empty.
- V1–V4 captures. V5–V8 are captured on `afldb_test`, with no synthetic DEV data.

**S9 — Closure.**
- `afldb-closure` flags.
- `issues.md` resolution, removal from `IssuesIndex.md`, and a `CHANGELOG.md` entry.
- Open F-1 and the narrowed F-2/F-3 if the operator accepts them.
- ISSUE-237 stays open, independently.

---

## 14. Operator decisions (approved 2026-09-23)

| # | Decision | Status and effect on the plan |
|---|---|---|
| OD-1 | A DB index enforcing one `afl_api` provider per player (D6-4, §8.3) | **APPROVED.** The S0 gate passed on both databases (§13.1). The migration independently fails closed if duplicates exist when it runs. |
| OD-2 | Revoke of a human link | **APPROVED WITH HARD GUARD.** Revoke is allowed only on a proven non-use, determined from DB and code evidence, never from an operator assertion or checkbox. It refuses on use **and** when non-use cannot be proven. There is no force override. It is transactional and append-only audited, and it returns the provider to the queue. The original D10 test was insufficient (the Brownlow keys are match-based; an absent projection is not proof), so **D10 is rewritten**. |
| OD-3 | Promotion/rebuild treatment of `afl_api_identity_adjudications` | **APPROVED.** The table is durable identity authority and survives **together with** its `resolved` `external_identities` outcome, remapped. Either side failing to remap or reinstate consistently fails closed. There is no DEV `historicalOnly` exemption. **New D15**; F-2 is narrowed. |
| OD-4 | Note and acknowledgement (D12) | **APPROVED.** Every manual adjudication needs a 20–2000-character note, even when the surnames agree. A surname disagreement additionally requires the acknowledgement checkbox. |
| OD-5 | Does OD-3 bind `db:test:rebuild` (the destructive `afldb_test` reset)? (D15) | **APPROVED: YES (2026-09-23).** The human `resolved` identity and its ledger survive the rebuild together: capture before destruction, then reinstate and replay after player load, with the bijection check in validation. Proven by C6, I14–I16 and I18. The earlier recommendation (a) was **not** adopted. |
| R1–R8 | Plan-review findings (§17) | **R1–R3 and R5–R8 ACCEPTED and folded** into D10, D12, D15, §7, §9, §10 and §13.2. **R4 became AFLDB-ISSUE-237** (importer `unique` identities through promotion and rebuild). It is not an ISSUE-235 dependency, provided D15 preserves human state independently and fails closed. |

**Standing operator directions (2026-09-23).** These are recorded as binding:
- There is no name-only automatic linking, no generic name-based suggestions, no bulk approval, no
  automatic human-equivalent adjudication and no create-and-link. ISSUE-224 owns player creation,
  and ISSUE-232 owns operational status.
- An importer `unique` link is never re-pointed through this UI (D2).
- The importer never overwrites, deletes or downgrades a human `resolved` link. An agreeing bridge
  run is a no-op that preserves `resolved`. A contradicting run preserves the human row and surfaces
  the contradiction (D3, D4).
- `unique` and `resolved` are equally trusted and differ only in provenance (D1).
- Confirmed-unlinked is **not** approved for `afl_api` (D9).

D1–D15 are otherwise this plan's decisions. The reviewer may challenge them.

---

## 15. Follow-ups: record at closure, do not implement here

- **F-1:** correcting a consumed trusted `afl_api` link (importer or human) with canonical
  reattribution of `player_match_stats` and derived tables.
  **Allocated at closure (2026-09-24): AFLDB-ISSUE-238.**
- **F-2 (narrowed by OD-3):** only the replay and recovery that fall **outside** D15's invariant. For
  example:
  - exporting adjudications to a tracked artefact, which a destructive `afldb_test` reset could
    replay if OD-5 later wants that;
  - recovering human decisions after a restore that lost the audit table itself.

  Carrying the ledger and its `resolved` outcome through promotion **and** the `afldb_test` rebuild
  is **in scope** (D15, OD-5) and is not deferred.
  **Allocated at closure (2026-09-24): AFLDB-ISSUE-239.**
- **AFLDB-ISSUE-237 (opened 2026-09-23, plan-review R4):** carrying importer-created `unique`
  `afl_api` identities through promotion and rebuild. It is a separate issue, and ISSUE-235 does not
  implement it.
- **F-3:** dedup keys for the loader's repeated `afl_api_identity_contradiction` findings (G5).
  **Allocated at closure (2026-09-24): AFLDB-ISSUE-240.**

---

## 16. Acceptance criteria

1. A Super Admin can link a U1 provider to an existing player with a stable identity. That writes
   exactly one `external_identities` row (`resolved`, `afl_api_admin_adjudication`) and one `linked`
   audit row, atomically (I2, I3).
2. Every refusal T2–T9, T19 and T20 writes nothing (A4, I4, I6, I7).
3. The bridge loader never updates, deletes or downgrades a human row. It reports agreement as
   `already_linked (human)`, withholds disagreement and collisions with findings, and still links free
   providers exactly as before (P1–P5, I7, the §10.2 and §11 validate-only runs).
4. One `afl_api` provider per player is enforced in the database (OD-1) and in both writers (I1, I9,
   P3).
5. Concurrent and stale submissions produce at most one row and one audit record (I8–I10, A1).
6. After a human link, the next settle applies the provider's rows with **no settle code change**,
   and the pending candidates turn moot (I5). The ISSUE-244 regression suites stay green.
7. There is no confirm-unlinked, bulk, suggestion or automatic path for `afl_api`. Candidates are
   evidence-derived only, and name is display-only (B1, B3, A7, D12).
8. Only `data.playerLinks` (Super Admin) can view or act (A6, V4).
9. The audit table is append-only by grant (I11–I13) and is classified in the promotion inventory
   (C1–C2).
10. DEV:
    - the migration and privileges are applied;
    - the §11 read-only checks pass;
    - V1–V4 are captured;
    - V5–V8 are captured on `afldb_test`, or marked `VISUAL: UNVERIFIED` with the reason;
    - the loader validate-only returns 669/0/0/0.
11. `issues.md`, `IssuesIndex.md` and `CHANGELOG.md` are updated at resolution, and F-1/F-2/F-3 are
    recorded.
12. **(OD-2)** Revoke succeeds only on a proven non-use (D10). Each of the following refuses with no
    write:
    - a link used by the match settle or **only** by the Brownlow settle;
    - a link whose projection is gone but whose canonical rows or ledger rows remain;
    - an unclassified player-FK table;
    - an in-flight settle, detected by the lock timeout.

    Evidence: A10–A12, I6, I6b–I6d. Otherwise revoke ships refusing unconditionally.
13. **(OD-3, OD-5, R3, R8)** The ledger is reinstated in every environment through the existing
    `afltables_profile_url` lineage ref, with a stored-identity assertion. Right after the
    `players` override replay, the replay re-creates exactly the net-linked `resolved` rows. An
    identical row is an idempotent no-op. Every conflicting importer or human row, every
    unresolvable identity and every OD-1 collision stops the run without overwriting. The bijection
    check passes. The same holds through `db:test:rebuild` (capture before destruction, then
    reinstate and replay after player load). Evidence: C2b, C3–C6, I14–I16, I18.
14. **(R1, R2, R5)** Revoke's non-use proof uses the test-pinned manifest across all non-system
    schemas (`LINK_DEPENDENT` / `LINK_INDEPENDENT` / `NOT_SOURCE_BEARING`). It never infers use from
    `source_id` plus `player_id` alone, and never reads `promotion_candidates.target_id`. An
    unclassified table fails closed (A11, A11b, I17).
15. **(R7)** The AFL API form is a dedicated component with an empty, never-seeded player search
    (B3b).
16. **(OD-4)** The note is 20–2000 characters on every adjudication, and the surname acknowledgement
    is enforced server-side (A2, the migration CHECK).

---

## 17. Plan review (CLAUDE.md §15)

**COMPLETE (2026-09-23, Opus 5.5, main session).**

**How the review was run.** The operator **narrowed the launch under §15**. The two
`afldb-orchestrator` → `afldb-reviewer` launches were stopped before either returned any finding.
The review was then done directly in the main session instead, **not** by `afldb-reviewer`/Fable.
It used native reads and searches only: no shell, database or Git command, and no code edit.

**Verdict: no CRIT and no HIGH findings.** Nothing stops the run. There are four MED findings and
several LOW/INFO findings, listed below. The MED plan corrections are proposed here for operator
acceptance, and the sections they name are **superseded by these findings until the operator
accepts them.**

**Claims verified against the tree.** Every file:line that a decision rests on was re-checked, and
all of them hold:
- loader: `:371-382`, `:469-472`;
- `afl-api-brownlow.ts`: `:55-62`, `:640-647`, `:707`, `:1038`, `:1438-1453`, `:1469`, `:1499`;
- `settle-afl-api.ts`: `:718`, `:1137-1138`, `:1722-1731`;
- `afl-api-settle-plan.ts`: `:388`, `:417`, `:472-497`;
- `common.py`: `:1160`, `:1311-1337`;
- `promotion-inventory.ts`: `:545-624`, `:1021`, `:1591-1630`;
- `001_foundations.sql`: `:110-118`;
- `player-links.ts`: `:446-450`;
- ISSUE-228: `:584-585`, `:613-614`, `:2613`.

The D10 premise holds as well: the only two callers of `resolveAflApiPlayer` run it on the settle's
own write `tx`, and each settle is exactly one `sql.begin`.

### 17.1 Findings

| # | Grade | Finding | Evidence | Proposed runbook change |
|---|---|---|---|---|
| R1 | **MED** | **D10(a)'s premise is false.** "Any row with `source_id = afl_api` naming P came through this link" does not hold. `player_height_evidence` holds `afl_api`-sourced rows attached by **name + club + season** matching (`enrich_heights_afl_api.py:187-216`), which never reads `external_identities`. Enumerating the catalog as written would count those rows as "use", so revoke would refuse for almost every current player. That fails safe, but it makes OD-2's revoke unusable and records a false reason. | `086_player_height_evidence.sql:27-30`; `enrich_heights_afl_api.py:23-27`, `:187-216` | Keep the catalog enumeration, but as a **classifier**, not as the use test. Every table with a player FK (any schema) and a `source_id` column must be declared, in a test-pinned list, as either **identity-attached** or **independently attached** (the second class, e.g. `player_height_evidence`, is never use). An identity-attached table counts as used on any `afl_api` row for P. An **unclassified** table refuses as unprovable. The initial identity-attached set is `player_match_stats`, `brownlow_round_votes`, `staging.afl_api_player_match` and `staging.afl_api_brownlow_vote`; the implementation must confirm the complete set from the settle writers. |
| R2 | **MED** | **D10(a) says "any public table".** The identity-attached staging projections live in the **`staging`** schema and carry both `source_id` and a player FK (`103:311-325`, `:456-480`). | `103_afl_api_match_projections.sql:311-325`, `:456-480` | Enumerate **every** non-system schema (at least `public` and `staging`). Test A11 asserts that a staging table is seen. |
| R3 | **MED** | **D15's ordering, "replay before any `afl_api` bridge import", is not enforceable as written.** `docs/production-promotion.md` has **no** `afl_api` identity step at all (its only post-promotion identity work is `replay_admin_overrides()`, `:637-667`), and `db:test:rebuild` has no bridge stage either (`rebuild-test.ts` mentions `afl_api` only for heights, `:209-213`, `:619-625`). The `player_identity` remap also needs `manual_admin_edit` tokens, which exist in a candidate only **after** the `players` override replay (`production-promotion.md:641-648`, `:751-755`). | as cited | Place the D15 replay in "Post-promotion state" step 1, **after** `replay_admin_overrides('players')` and before the `data_edits` remap. Give the replay a hard **precondition**: it refuses unless the candidate holds **no** `afl_api` row other than an identical human row (so a re-run is idempotent). That makes "before any bridge import" a checked fact rather than an operator habit. |
| R4 | **MED** | **Pre-existing gap outside ISSUE-235: no promotion or rebuild step carries `afl_api` importer links.** DEV's 669 `unique` links (S0) survive a promotion only if an operator re-runs the bridge import, and no runbook says so. After a promotion, every importer-linked provider would settle as `unresolved_identity` while D15's human rows would survive: correct, but a surprising asymmetry. **ISSUE-235 does not own this** (the importer links are ISSUE-228's). | `production-promotion.md` (no `afl_api` or `external_identities` promotion step; one unrelated mention at `:492`); `rebuild-test.ts` | **Operator decision:** allocate a new tracked issue (the ISSUE-228 successor class, "AFL API importer identities through promotion"), or accept the gap and record it. ISSUE-235's D15 wording should name the gap and not imply that a bridge-import step exists. |
| R5 | LOW | **D10(d) misreads `promotion_candidates.target_id`.** It is the **target row's** id (`074:163-164`), not a player id, so "or `target_id` names P" is wrong. | `074_source_observation_spine.sql:163-164` | Drop `target_id` from (d) and keep `proposed_fields->>'player_id' = P`. For a non-`unresolved_identity` verb, also keep `external_record_id LIKE '%|' || CD_I`. |
| R6 | LOW | **The lock bound is unspecified.** While the revoke waits on `ACCESS EXCLUSIVE`, every new reader of `external_identities` (player-identity reads in `src/db/queries/*`) queues behind it. | PostgreSQL lock-queue semantics | Fix `lock_timeout` at a small constant (proposed: 2 s) in §7.2, and say that site readers can stall for up to that bound. |
| R7 | LOW | **PlayerPicker vs the "no generic name-based suggestions" direction.** An admin-typed search is a lookup, not a suggestion. But the honours `ResolveControls` also seeds name fields for create-and-link (`ResolveControls.tsx:166-167`, `:443-466`), which is excluded here. | `ResolveControls.tsx` | The AFL API form is a **new** component and must not reuse `ResolveControls`. The PlayerPicker starts **empty**, never pre-seeded or ranked from the provider's name (B3 extended). |
| R8 | LOW | **D15 remap mechanism.** Remapping through the row's own `player_identity` would be a new mechanism. The inventory's existing lineage ref (`afltables_profile_url`, which already covers `manual_admin_edit`, `promotion-inventory.ts:1591-1630`) plus NOT-NULL staging (`:1378-1395`) already remap `player_id`. | as cited | Use the existing lineage ref, plus an assertion that the remapped player's identity equals the row's stored `player_identity`. Add no new identity kind. |
| I1 | INFO | The `LOCK TABLE` privilege is satisfied. `external_identities` is registered import-writable, and `afldb_import` holds `DELETE`/`TRUNCATE` (`045_import_write_is_fail_closed.sql:99-114`, `:137-139`). | as cited | Replace the §7.2 "confirm" note with this fact. |
| I2 | INFO | There is no deadlock cycle between link, revoke and settle. The link takes no table lock before its advisory locks. The settle takes no advisory lock. `lock_timeout` bounds the rest. | D7, §7.2 | None. |
| I3 | INFO | The artefact-based Brownlow season-totals builder, `build_brownlow_season_artefact_from_afl_api.py`, does not read DB `afl_api` identities. It resolves providers through bridge **artefacts** (`:15-25`). A human link therefore does not reach AFL-API-sourced Brownlow **season totals**. That is ISSUE-233's rollover concern, not a D10 hole. | as cited | Note the interaction in §2 for ISSUE-233. No ISSUE-235 change. |
| I4 | INFO | The partial OD-1 index embeds the per-database `sources.id` literal. That is correct per database, and S0 measured `6` on both. | §8.3; S0 | None. |

### 17.1a Operator disposition (2026-09-23)

- **Nature of the review.** It was a **direct current-tree plan review in the main session (Opus
  5.5)**, **not** an `afldb-reviewer`/Fable review. Both `afldb-orchestrator` → `afldb-reviewer`
  launches were stopped before either returned a finding.
- **R1, R2, R3, R5, R6, R7, R8: ACCEPTED, and folded into the normative plan:**
  - R1, R2, R5, R6 → D10 and §7.2;
  - R3, R8 → D15 and §7.5;
  - R7 → D12 and §7.3;
  - tests → §10 (A10, A11, A11b, B3b, C2b, C4, C6, I14–I18);
  - sequence → §13.2.

  The findings table above is kept as the historical record, and the normative sections govern.
- **R4 → AFLDB-ISSUE-237.** It is not an ISSUE-235 dependency.
- **OD-5 → approved: yes.**
- **Implementation authorised** (§13.2).

### 17.2 Blockers before S1 (as recorded at review time; resolved by §17.1a)

- **None of the review findings blocks S1** (migration 104, `privileges.sql`, the inventory entry).
- **R1–R3 must be folded into D10/D15 before S3/S4/S4b** are implemented.
- **OD-5 (open)** gates S4b only.
- **R4 is a new operator decision:** allocate a separate issue, or record the gap. It does not
  block ISSUE-235's S1.
- Implementation still needs the operator's explicit authorisation.
