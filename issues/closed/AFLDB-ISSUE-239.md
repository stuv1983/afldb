# AFLDB-ISSUE-239 — AFL API human-adjudication recovery outside D15

<!-- afldb-merge-readiness
{"status":"ready","hardBlockers":[],"expectedFiles":["tools/migration/recover_afl_api_adjudications.ts","tools/migration/replay_afl_api_adjudications.ts","tools/migration/rebuild_afl_api_adjudications.ts","tools/migration/recover_afl_api_importer_identities.ts","tests/afl-api-adjudication-recovery.test.ts","tests/afl-api-identity-fake-db.ts","package.json","issues/closed/AFLDB-ISSUE-239.md"],"validation":["see issues/closed/AFLDB-ISSUE-241.md §8 (one combined run)","code_test_db rehearsal attempt 1 (2026-09-26) — FAILED before any 239 check (harness fixture hit external_identities_uq; fixed DB-free, see AFLDB-ISSUE-241.md §9.1)","code_test_db rehearsal attempt 2 (2026-09-26) — 239 validate-only PASS, then the dry-run readback REFUSED rows 9239001-9239003: the hand-built fixture's evidence jsonb text was not PostgreSQL's rendering (key order); rehearsal fixture defect, no production change; fixed DB-free (recovery suite 20/20); ledger sequence may now stand at 9239003","code_test_db rehearsal attempt 3 (2026-09-26, operator-run) — ACCEPTING RUN: 26/26 PASS, all 10 ISSUE-239 checks PASS (fixture jsonb rendering, validate-only, dry-run, apply, D15, actor, idempotence, ledger-lost/outcome-survived, importer-conflict refusal, refused run wrote nothing); residue 0 before and after; code_test_db only; sequence not reset"]}
-->

## 0. Status

**RESOLVED 2026-09-26** (uncommitted). Implemented the same day as part of the ISSUE-238–241 bulk
pass and DB-free validated. Accepted on the combined `code_test_db` rehearsal
(`AFLDB-ISSUE-241.md` §9), **attempt 3: 26/26 PASS**, with every ISSUE-239 check passing on real
PostgreSQL (§7). Shared architecture: `AFLDB-ISSUE-241.md` §2. D15 is unchanged. No DEV run is
required (§7), and none was made. No DEV, PROD, `afldb_test` or retained promotion database was
contacted.

**Rehearsal attempt 2 (2026-09-26, history)** reached this issue: `239 validate-only` PASSED, then the
dry-run's post-write readback refused all three fixture rows. The only differing field was
`evidence`: the hand-built fixture wrote jsonb text in a key order PostgreSQL does not render. That is
a rehearsal fixture defect, not a recovery defect. No production file changed. The harness was fixed
DB-free (`AFLDB-ISSUE-241.md` §9.1), and attempt 3's new first ISSUE-239 check guards it.

## 1. What D15 covers, and the case it does not

**D15 (ISSUE-235, with ISSUE-237) owns the lifecycle.**

- **Promotion:** the ledger is reinstated, remapped by `player_identity`, the outcome is replayed,
  and a bijection gate runs.
- **`db:test:rebuild`:**
  - Stage 2 captures, with a hashed combined capture and a database marker;
  - Stage 18 reinstates and replays;
  - Stage 19 checks the bijection;
  - `capture --recover` handles a rebuild that died mid-way.

**The uncovered case:** a LIVE database loses `afl_api_identity_adjudications` itself, outside
those lifecycles. Examples:

- the table restored from an older backup;
- an accidental truncate;
- a database restored from a dump taken before the decisions.

The outcome rows may or may not survive. The bijection then fails (`row_without_ledger`, or
`ledger_without_row` if the outcomes went too). Every later promotion and rebuild refuses, which is
fail-closed but stuck, and nothing in the lifecycle can bring the decisions back. D15's rebuild
reinstatement cannot be pointed at it: it requires the rebuild marker and an empty rebuilt
database.

## 2. Is a tracked artefact appropriate? No. The smaller design is used.

- **Rejected: a git-tracked export.**
  - The ledger holds admin e-mail addresses and free-text notes.
  - Decisions are made continuously in the live database, so a tracked copy would lag and would
    need a commit per decision.
- **Rejected: reconstructing from surviving outcome rows.** A `resolved` row has no author, note,
  evidence, fingerprint or surname acknowledgement. Rebuilding a ledger row from it would
  **fabricate a human decision**.
- **Chosen: recover from a durable, hash-bound, untracked record of the ledger.**
  - **Durable state that already exists:** every `db:test:rebuild` Stage 2 writes the combined
    capture (`afldb.afl_api_identities.rebuild_capture` v2) and archives it after reinstatement
    (`afl-api-identities.<ts>.<hash>.reinstated.json` under `AFLDB_REBUILD_CAPTURE_ROOT`).
  - **An export on demand:** of any readable copy (the live database pre-emptively, or a backup
    restored into a scratch database), in the same row shape
    (`afldb.afl_api_identity_adjudications.recovery_export` v1). It is written outside every
    checkout and never overwritten.
  - The recovery accepts either and uses only the ledger section.

## 3. The tool: `tools/migration/recover_afl_api_adjudications.ts`

```text
npm run db:issue239:recover-adjudications -- export --ledger-of <afldb_test|afldb_dev|code_test_db> --output <abs .json>
   (source DSN: AFLDB_AFL_API_ADJUDICATION_EXPORT_SOURCE_DATABASE_URL; READ ONLY; the database read must be the
    ledger database itself or a non-live scratch copy; PROD names refused)
npm run db:issue239:recover-adjudications -- recover --source <file> --expected-payload-sha256 <hex>
   --target <afldb_test|afldb_dev|code_test_db> --validate-only | --dry-run | --apply
   (target DSN: AFLDB_AFL_API_ADJUDICATION_RECOVERY_DATABASE_URL, owner; must name the target)
```

**Preserves the decision semantics.** Each missing ledger row is inserted **verbatim**: id, provider,
action, `player_identity`, `previous_state`, evidence and its sha256, surname acknowledgement,
`supersedes_id`, note and `created_at` to the microsecond. Only the two surrogates change, exactly
as in D15's own reinstatement (`planLedgerReinstatement`):

- `player_id` comes from the row's stable identity, through the shared reverse lookup with
  continuity rules;
- `admin_user_id` comes from the actor e-mail (`planActorRemap`). An existing account is reused
  untouched; otherwise an attribution-only, credential-less, disabled account is created.

**The outcome.** It comes from the **D15 replay itself** (`replayAflApiAdjudications`,
`expectedSupersedes = {}`), which must match the pre-computed plan. Then the bijection and the
combined identity invariant run, all in one transaction.

**Fail-closed.** Every item below refuses the whole run, writing nothing:

- the source is not an export or a v2 capture;
- its own hash fails, or it is not the payload the operator named;
- the superseded ledger-only or pre-ISSUE-245 captures (named);
- the source's ledger database is not the target — decisions are recovered only into the
  deployment that made them;
- the target is not on the closed list (no PROD entry);
- a `db:test:rebuild` capture is pending on the target (D11b marker);
- the target ledger holds a row the source does not (a later decision is never merged
  automatically), or a same-id row that differs;
- a target ledger row's `player_id` is not its identity's player;
- any identity unresolvable, ambiguous or continuity-contradicted;
- an unmappable actor;
- a D15 replay STOP:
  - an importer row (agreeing or not) on the provider;
  - another row on it;
  - the player holding another provider.

  Current importer and human state always wins, and nothing is overwritten;
- the ledger read back unequal to the source;
- a bijection or invariant failure.

**Idempotent.** A rerun finds every row identical and the replay all no-ops. It writes nothing, not
even a batch, and reports `ALREADY_RECOVERED`. A restore that left the id sequence behind has it
raised (only ever raised), and that counts as a write.

**Audit.** A writing apply records one `import_batches` row (source `afl_api`, target
`afl_api_identity_adjudications`, status `completed`). Its `validation_result` carries:

- the source kind, payload sha256, file sha256, ledger and source databases, and captured-at;
- the reinstated ledger ids;
- the actors created;
- any sequence raise;
- the replay counts.

The reinstated rows keep their original authorship and time.

**Outside D15, by construction.** Promotion and rebuild never call it, and no D15 code path changed.
The shared pieces were exported, not altered: `sameLedgerRow` (with `sameLedger` rebuilt on it,
same rule), `ledgerSequenceName`, `readSequenceState`, `readLedgerRows`,
`readCandidateAflApiState`, `writeNewFileAtomically`.

## 4. Acceptance matrix (`tests/afl-api-adjudication-recovery.test.ts`; rehearsal §9 of ISSUE-241)

| Criterion | Proof |
|---|---|
| preserves decision semantics (verbatim rows, surrogates remapped by identity) | "apply restores the decisions verbatim on a renumbered lineage…"; rehearsal 239 apply |
| carries provider id + stable identity + action/state + provenance | export test; source parse; row shape (`CapturedLedgerRow`) |
| validates the source binding | parse: own hash, operator hash, format, v1/legacy capture refused |
| fail-closed on missing/ambiguous/different-player identity | conflict matrix; "player_id is not its identity's player" |
| refuses conflicts with importer/human state | conflict matrix (importer agreeing, importer elsewhere, player holds another provider, later decision) |
| never fabricates a decision | outcome only via D15 replay from ledger rows; no ledger row created from an outcome |
| idempotent | rerun `ALREADY_RECOVERED`; sequence-only repair then rerun |
| validate-only / dry-run / apply | READ ONLY + unchanged world; ROLLED_BACK + unchanged; COMMITTED |
| audit/provenance model | import batch `validation_result`; original authorship kept |
| outside D15 | no lifecycle caller; marker refusal |

## 5. Operator procedure (when the uncovered case actually happens)

1. Stop admin adjudication on the damaged database. Take no promotion or rebuild step.
2. Choose the source:
   - the newest archived `afldb_test` capture (for `afldb_test`); or
   - `export` from a scratch restore of the last good backup (any deployment).

   Record its `payloadSha256`.
3. Run `recover --validate-only`, then `--dry-run`, then `--apply`, with the same source and
   expected hash.
4. Run `recover --validate-only` again: expect `ledger rows to reinstate: 0` and `human outcome rows
   to replay: 0`.
5. Continue the lifecycle. The bijection gates will now pass.

A PROD target needs a separate operator decision and a closed-list change.

## 6. Validation (2026-09-26, DB-free)

Covered by the combined run in `AFLDB-ISSUE-241.md` §8. This suite had 17 tests, all PASS.

After rehearsal attempt 2 it has 20, all PASS. The DB-free fake now models two things real
PostgreSQL does:

- jsonb text is PostgreSQL's rendering (`pgJsonbText`), on insert and on read;
- `setval` outlives a rollback.

The three new tests are:

- the renderer itself;
- the attempt-2 reproduction: a non-PostgreSQL-rendered source passes validate-only, then dry-run and
  apply refuse at the readback, write nothing, and leave the sequence raised;
- a guard that the rehearsal's exported fixture rows are PostgreSQL-rendered and recover cleanly.

The dry-run test now asserts that the sequence raise survives the rollback, and that the later apply
needs no raise.

**Dry-run leaves the sequence raised (by design, now documented).** `recover` calls `setval` before
its readback in dry-run as in apply. PostgreSQL does not roll `setval` back. A dry-run whose source
ids exceed the sequence therefore leaves the sequence at the source's highest id. This is safe: the
sequence is only ever raised, only to ids the source already holds, so the only effect is a gap. The
apply would make the same raise.

## 7. PostgreSQL acceptance and resolution (2026-09-26)

**Resolved on the combined `code_test_db` rehearsal, attempt 3** (`AFLDB-ISSUE-241.md` §9.1):
26/26 checks PASS, rehearsal exit 0, fixture residue
`{"identities":0,"ledger":0,"actors":0,"findings":0,"batches":0}` before and after (both exit 0).
The ten ISSUE-239 checks, all PASS on real PostgreSQL:

| Check | Proven |
|---|---|
| `239 fixture JSONB` | every fixture jsonb text equals PostgreSQL's own rendering (`{"row": N, "rehearsal": "AFLDB-ISSUE-239"}`, `{"status": "resolved"}`), checked before any recovery call |
| `239 validate-only` | 3 ledger rows, 1 actor, 1 outcome; `READ_ONLY` |
| `239 dry-run` | `ROLLED_BACK`, nothing left behind |
| `239 apply` | ledger reinstated with original ids 9239001–9239003; `created_at` to the microsecond (`2026-09-26T0N:00:00.123456Z`); jsonb `evidence` and `previous_state` byte for byte; 9239003 supersedes 9239002 |
| `239 D15` | the D15 replay produced exactly the live outcome |
| `239 actor` | attribution-only, disabled, no credential |
| `239 idempotence` | rerun `ALREADY_RECOVERED`, no new batch |
| `239 ledger lost / outcome survived` | ledger reinstated; the surviving outcome was a no-op |
| `239 conflicting importer row` | recovery refused, nothing written |
| `239 refused recovery wrote nothing` | the refusal left the world unchanged |

Together these prove on PostgreSQL the real `OVERRIDING SYSTEM VALUE` insert, the jsonb and
timestamp round-trip, the actor insert, the replay, the bijection and the invariant.

**No DEV run.** The uncovered case needs none to be proven, and running the tool on DEV without a
loss would be a no-op validate. No DEV, PROD, `afldb_test` or retained promotion database was
contacted.

**The sequence branch.** Attempt 2 very probably raised `code_test_db`'s ledger sequence to 9239003,
so attempt 3's `setval` branch was most likely a no-op. The real-PostgreSQL execution of that branch
rests on attempt 2. Its refusal was thrown by the readback, which runs only after the post-raise
sequence check has passed. So the sequence already handed out ids above 9239003 at that point.
Nothing known put it there before attempt 2, so that was almost certainly attempt 2's own `setval`,
under the owner DSN. That is an inference from code order; no check printed it. The sequence is
intentionally not reset.

**Follow-up.** None required. §5 is the operator procedure if the uncovered case ever happens. A
PROD target still needs a separate operator decision and a closed-list change.
