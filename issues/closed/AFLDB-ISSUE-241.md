# AFLDB-ISSUE-241 — AFL API bridge artefacts bound to stable identity (and the 238–241 bulk pass)

<!-- afldb-merge-readiness
{"status":"ready","hardBlockers":[],"expectedFiles":["src/lib/acquisition/afl-api-bridge-identity.ts","tools/migration/import_afl_api_player_bridge.ts","tools/migration/import_afl_api_player_bridge.py","tools/migration/recover_afl_api_adjudications.ts","tools/db/afl-api-identity-bulk-rehearsal.ts","tools/migration/replay_afl_api_adjudications.ts","tools/migration/rebuild_afl_api_adjudications.ts","tools/migration/recover_afl_api_importer_identities.ts","tools/current-season/emit-afl-api-player-bridge.ts","tools/migration/build_brownlow_season_artefact_from_afl_api.py","tools/migration/build_afl_api_player_bridge.py","tools/migration/build_afl_api_brownlow_name_bridge.py","src/lib/acquisition/afl-api-player-resolver.ts","tests/afl-api-player-bridge-import.test.ts","tests/afl-api-adjudication-recovery.test.ts","tests/afl-api-identity-fake-db.ts","tests/afl-api-player-bridge-cli.test.ts","tests/player-link-mutations.test.ts","tests/integration/settle-afl-api.test.ts","tests/python/afl_api_bridge_contract.py","tests/python/afl_api_brownlow_season_artefact_contract.py","docs/acquisition/AFLDB-2026-API-ACQUISITION.md","package.json","issues/open/AFLDB-ISSUE-238.md","issues/closed/AFLDB-ISSUE-239.md","issues/closed/AFLDB-ISSUE-240.md","issues/closed/AFLDB-ISSUE-241.md","issues.md","IssuesIndex.md","CHANGELOG.md"],"validation":["vitest focused AFL API identity matrix (9 files) — 947 passed, 2 failed of 949; the 2 failures reproduce identically on a pristine HEAD export (Windows CRLF source scans), pre-existing","python tests/python/afl_api_bridge_contract.py — PASS (47 checks)","python tests/python/afl_api_brownlow_season_artefact_contract.py — PASS (86 checks)","tsc --noEmit — PASS","eslint on every new file — PASS; the 39 errors in two touched pre-existing test files are identical on HEAD","git diff --check — PASS","code_test_db rehearsal attempt 1 (2026-09-26) — 12/12 checks through the 240 distinct-finding check PASS, then REFUSED on external_identities_uq in the harness's own STOP fixture insert (rehearsal fixture bug, fixed DB-free, §9.1); teardown ran, residue 0","code_test_db rehearsal attempt 2 (2026-09-26) — 16/16 checks through 239 validate-only PASS, then the 239 dry-run readback REFUSED rows 9239001-9239003 (fixture evidence jsonb text not PostgreSQL's rendering; rehearsal fixture defect, fixed DB-free, §9.1); residue 0; ledger sequence may stand at 9239003; after fix: two suites 56/56, tsc PASS, eslint PASS, diff --check clean","code_test_db rehearsal attempt 3 (2026-09-26, operator-run) — ACCEPTING RUN: 26/26 checks PASS, rehearsal exit 0; initial and final residue {identities 0, ledger 0, actors 0, findings 0, batches 0}, both exit 0; no DEV, PROD, afldb_test or retained promotion database contacted; ledger sequence intentionally not reset (§9.1)","merge:ready: the runbook is now under issues/closed/, which --issue does not search; pass --runbook issues/closed/AFLDB-ISSUE-241.md"]}
-->

## 0. Status

- **RESOLVED 2026-09-26** (uncommitted). Branch `opus/afl-api-bulk-239-241`, base `be61681b`.
  Implemented and DB-free validated the same day. Accepted on the combined `code_test_db`
  rehearsal (§9), **attempt 3: 26/26 checks PASS**, rehearsal exit 0, zero fixture residue before
  and after (§9.1). ISSUE-240 and ISSUE-239 are resolved on the same run.
- **Databases contacted.** Only `code_test_db`, through the operator's tunnel. No DEV, PROD,
  `afldb_test` or retained promotion database was contacted, during implementation or acceptance.
  No DEV step is required.
- **Rehearsal attempt 1 (2026-09-26) FAILED** on a rehearsal fixture bug. It passed every check
  through the ISSUE-240 distinct-finding check, then hit `external_identities_uq`. Residue was 0.
  The harness is fixed DB-free (§9.1).
- **Rehearsal attempt 2 (2026-09-26) FAILED** on a second rehearsal fixture defect. It passed every
  ISSUE-241/240 check and `239 validate-only`. Then the ISSUE-239 dry-run readback refused the
  hand-built fixture's non-PostgreSQL-rendered jsonb evidence text. Final residue was 0. The harness
  is fixed DB-free (§9.1). No production file changed.
- **Rehearsal attempt 3 (2026-09-26) PASSED 26/26.** This is the accepting run (§9.1).
- This runbook also records the **shared architecture** of the bulk pass over ISSUE-238–241.
  ISSUE-240 (`AFLDB-ISSUE-240.md`) and ISSUE-239 (`AFLDB-ISSUE-239.md`) are implemented on the same
  contract. ISSUE-238 (`AFLDB-ISSUE-238.md`) was triaged and stays a separate risk boundary.

## 1. Problem

Three of the four bridge evidence classes carried a bare `candidate_player_id` with no lineage
binding. The fourth (`afl_api_stat_vector_season`) was bound only to a database **name**, which is
no better: an `afldb_test`-built artefact still passed after `afldb_test` itself had been rebuilt.
`players.id` is a surrogate that a rebuild or promotion renumbers. An `--apply` could therefore link
a provider to whoever holds the old integer now.

A second consumer had the same hazard and was not named in the issue.
`build_brownlow_season_artefact_from_afl_api.py` reads the same bridge contract and resolves each
`candidate_player_id` to an AFL Tables path in `afldb_test`. A stale id would attribute Brownlow votes
to the wrong profile in the season CSV.

## 2. Shared architecture (the bulk pass)

**One identity system, reused.** Every change in this pass keys on the ISSUE-237 §5 accepted stable
identity: the unprefixed trusted AFL Tables path, otherwise the `manual_admin_edit` token. Every
lookup goes through the existing implementation:

- Reverse (identity → target player): `classifyAflApiReverseIdentity`, with tracked
  `profile_url_continuity` rules. It is reached through `resolveAflApiPlayerIdentity`, plus a new
  batched twin `resolveAflApiPlayerIdentities` for the loader. The twin uses the same predicate and
  the same classifier and differs only by `= ANY`. A DB-free test and the rehearsal both prove it
  agrees with the single lookup.
- Forward (player → identity): `readAflApiForwardIdentities` / `classifyAflApiForwardIdentity`.

No second identity implementation exists. That is why the loader moved from Python to TypeScript (§4).

**Why it is lineage-safe.** A stable identity names the same footballer in every lineage. The
rebuild reloads AFL Tables paths and replays `manual_admin_edit` tokens (ISSUE-245). Promotion
carries both through the lineage remap. Continuity rules are enforced in both directions, so a
target that splits a continuity pair is refused rather than guessed. A surrogate id is never trusted
across lineages. The only surrogate that appears anywhere as a key is ISSUE-240's `player_id:<n>`.
It is used only when a player has **no** stable identity, and only to keep two findings apart, never
to choose a player.

| Issue | Shares | Mechanism |
|---|---|---|
| 241 | the reverse lookup | artefact contract + TS loader resolving each row by identity |
| 240 | the forward lookup (finding key) | `data_issues.issue_key` (migration 076) + `ON CONFLICT DO NOTHING` |
| 239 | the reverse lookup and D15's reinstatement pieces | standalone recovery tool reusing `planLedgerReinstatement`, `planActorRemap` and the D15 replay |
| 238 | — | triage only: the closure is a canonical-stats mutation (see `AFLDB-ISSUE-238.md`) |

## 3. The artefact contract

- **Top level:** `player_identity_contract: "afldb.afl_api_bridge.stable_identity.v1"`.
- **Every `linked` row:** `candidate_player_identity`, the unprefixed §5 value. It must be
  non-blank, unpadded and unprefixed, and unique within the artefact.
- **Manual class:** if the row declares `canonical_afltables_profile_url`, it must equal the
  identity.
- **`candidate_player_id` is optional and NON-AUTHORITATIVE.** This is the single documented rule:
  it is never read to choose a player. A hint that differs from the resolved player is reported
  (`candidate_player_id_hint_ignored`, and in the batch's `validation_result`), never trusted and
  never a refusal. This is what lets a renumbered player resolve correctly.
- **Backward compatibility, an explicit decision: REFUSE.** Every artefact built before ISSUE-241 is
  refused with a message naming the issue. That covers all 13 tracked
  `data/reference/afl-api-{player-bridge,brownlow-name-bridge,player-adjudication}-*.json` files,
  and a DB-free test proves it for each. None is upgraded.
  - A bare id cannot be proven, after the fact, to name the same person in any database since
    rebuilt or promoted.
  - The populations those artefacts produced are carried by stable identity through every lifecycle
    (ISSUE-237), so nothing needs re-importing.
- The pure contract and planner live in `src/lib/acquisition/afl-api-bridge-identity.ts`.

## 4. The loader: `tools/migration/import_afl_api_player_bridge.ts`

Run it as `npm run import:afl-api-player-bridge -- --validate-only|--dry-run|--apply --artefact <path>
[--target afldb_test|dev]`. The `.py` loader is now a stub that refuses and names the replacement.

**Kept unchanged:**

- the closed target list with its DSN variables and role gates;
- mandatory `--artefact`;
- the class allow-list (`AFL_API_IMPORTER_MATCH_METHODS`, now imported rather than copied);
- the S9 target-bound season provenance gate, case for case;
- pinned-input hashes;
- the rows written (`unique`, `candidate_count 1`, the artefact's own method, `observed_name`,
  `evidence_summary`);
- never UPDATE or DELETE.

**Per-row decision table.** The pure function is `planAflApiBridgeImport`. Rows are decided in
provider order, and a planned insert is visible to later rows:

| Target state | Outcome |
|---|---|
| identity unresolvable, ambiguous, continuity-contradicted, or re-rendered | **STOP: whole run refused, nothing written** |
| provider row exists for the resolved player | already linked (human if `resolved`) |
| provider row exists for another or no player | withheld: `provider_already_linked` finding |
| provider free, resolved player holds another `afl_api` row | withheld: `player_already_linked` finding |
| provider free, player free | INSERT |

**Modes:**

- `--validate-only`: one READ ONLY REPEATABLE READ transaction, as the read role. It reports how
  many findings would be new and how many are already open.
- `--dry-run`: the whole write path, then a rollback. No batch survives.
- `--apply`: one transaction. The `import_batches` row is created and completed inside it, links are
  written first, then findings, then `import_rejections` for **every** detection, deduplicated ones
  included. A STOP exits non-zero in every mode.

**Deliberate differences from the `.py` loader:**

- A failed apply leaves no `failed` batch row. Everything is in one transaction, the settle's F008
  pattern.
- A manual-class row no longer needs a separate "player exists" check. The identity must resolve to
  exactly one player, which is strictly stronger.

## 5. The consumers

- **The TS season emitters** (`emit-afl-api-player-bridge.ts` and its `-test` entry) now bind every
  linked candidate through `readAflApiForwardIdentities` and declare the contract.
  - A candidate with no accepted identity is written with `candidate_player_identity: null` plus the
    reason, and the loader refuses that artefact whole.
  - The artefact records `player_identity_binding: {bound, unbound}`.
  - The identity read is a separate READ ONLY REPEATABLE READ transaction on the same pinned
    read-only session.
- **`build_brownlow_season_artefact_from_afl_api.py`** refuses a lineage-unbound bridge. After its
  existing single-path lookup, `verify_bridge_identities()` requires each looked-up player's AFL Tables
  path to equal the row's identity. A stale id refuses the build. It does not re-resolve; refusing is
  the fail-closed answer for an offline builder.
- **The historical Python builders** (`build_afl_api_player_bridge.py`,
  `build_afl_api_brownlow_name_bridge.py`) still write lineage-unbound artefacts, and both consumers
  refuse them. Their docstrings say so. Re-running them is not a supported path, because their
  populations are carried by ISSUE-237.
- `audit-afl-api-player-bridge-persisted.ts` is a read-only D-8 diagnostic that compares ids. It
  writes nothing, so it cannot mislink. It is unchanged and out of scope.

## 6. Acceptance matrix (ISSUE-241)

| Criterion | DB-free proof (`tests/afl-api-player-bridge-import.test.ts` unless named) | Rehearsal (§9) |
|---|---|---|
| same-lineage valid artefact imports | planner "same lineage"; adapter apply | 241 apply |
| renumbered player resolves by identity | planner "renumbered lineage" | (identity decides; hint differs) |
| stale surrogate ignored | planner "stale hint naming ANOTHER real player"; `hintMismatches` | 241 validate-only + apply |
| missing identity refuses | contract (artefact) + planner/adapter (target) | 241 STOP |
| ambiguous identity refuses | planner + adapter STOP | 241 STOP |
| hint vs identity: one rule | contract §3, planner, report | 241 validate-only |
| provider collision refuses | planner + adapter apply | 241 apply |
| target-player collision refuses | planner + adapter (incl. same-run insert) | 241 apply |
| human resolved never overwritten | planner (same/other player), static no-UPDATE/DELETE scan | — |
| wrong database/target refuses | adapter (database, role), DSN, CLI | 241 wrong database |
| validate-only writes nothing | adapter (READ ONLY, world unchanged) | 241 validate-only |
| dry-run rolls back | adapter | 241 dry-run |
| apply idempotent | adapter replay | 241 apply ×2 |
| all tracked pre-241 artefacts refused | contract test over the 13 files | — |
| Brownlow consumer refuses unbound/stale | `tests/python/afl_api_brownlow_season_artefact_contract.py` | — |

## 7. Files

- **New:**
  - `src/lib/acquisition/afl-api-bridge-identity.ts`
  - `tools/migration/import_afl_api_player_bridge.ts`
  - `tools/migration/recover_afl_api_adjudications.ts` (ISSUE-239)
  - `tools/db/afl-api-identity-bulk-rehearsal.ts`
  - `tests/afl-api-player-bridge-import.test.ts`
  - `tests/afl-api-adjudication-recovery.test.ts`
  - `tests/afl-api-identity-fake-db.ts`
- **Changed:**
  - `tools/migration/import_afl_api_player_bridge.py` (now a refusing stub)
  - `tools/migration/replay_afl_api_adjudications.ts` (batched reverse lookup; two readers exported)
  - `tools/migration/rebuild_afl_api_adjudications.ts` (`sameLedgerRow` and the sequence readers
    exported; no behaviour change)
  - `tools/migration/recover_afl_api_importer_identities.ts` (`writeNewFileAtomically` exported)
  - `tools/current-season/emit-afl-api-player-bridge.ts`
  - `tools/migration/build_brownlow_season_artefact_from_afl_api.py`
  - the two historical builders' docstrings
  - `src/lib/acquisition/afl-api-player-resolver.ts` (comment)
  - `tests/afl-api-player-bridge-cli.test.ts`, `tests/player-link-mutations.test.ts`,
    `tests/integration/settle-afl-api.test.ts` (comment)
  - the two Python contracts
  - `docs/acquisition/AFLDB-2026-API-ACQUISITION.md`
  - `package.json` (3 scripts)

## 8. Validation run (2026-09-26, Claude-run, DB-free)

**Focused vitest matrix.** One run covering:

- `tests/afl-api-player-bridge-import.test.ts`, `tests/afl-api-adjudication-recovery.test.ts`
- `tests/afl-api-player-bridge-cli.test.ts`, `tests/player-link-mutations.test.ts`
- `tests/db-test-rebuild.test.ts`, `tests/db-promotion-check.test.ts`
- `tests/afl-api-player-evidence.test.ts`, `tests/afl-api-adjudication-actions-contract.test.ts`
- `tests/census-afl-api-brownlow-identities.test.ts`

Result: **947 passed, 2 failed (949)**. The two new suites account for 51 of them (34 + 17). The 2 failures are `db-test-rebuild.test.ts` source scans ("teardown
and verify run under plain tsx…" and "never populates a credential…"). Both fail **identically on a
pristine `git archive HEAD` export**, from Windows CRLF and the scan's `.json` resolver. They are
pre-existing and platform-specific.

**The rest:**

- Python: `afl_api_bridge_contract.py` 47 PASS; `afl_api_brownlow_season_artefact_contract.py`
  86 PASS.
- `tsc --noEmit` PASS.
- ESLint: every new file is clean. The two touched legacy test files carry 39 `no-explicit-any`
  errors, identical on HEAD.
- `git diff --check` clean.

## 9. Operator acceptance — ONE combined sequence for ISSUE-239/240/241

Run from this worktree, with the operator's tunnel open. This touches `code_test_db` only; it never
contacts DEV, PROD or `afldb_test`.

```powershell
$env:AFLDB_CODE_TEST_DATABASE_URL        = '<owner DSN naming code_test_db>'
$env:AFLDB_CODE_TEST_IMPORT_DATABASE_URL = '<afldb_import DSN naming code_test_db>'
npm run db:code-test:issue239-241-rehearsal -- residue                            # expect all 0
npm run db:code-test:issue239-241-rehearsal -- run --acknowledge code_test_db     # expect 26/26 checks PASS
npm run db:code-test:issue239-241-rehearsal -- residue                            # expect all 0
```

The rehearsal refuses to start unless all of these hold:

- code_test_db's adjudication ledger is empty;
- the combined identity invariant already holds;
- there is no fixture residue.

It proves each of the following on real PostgreSQL, then tears down and proves zero residue:

- the batched lookup;
- loader validate-only, dry-run, apply and idempotent re-apply, under `afldb_import`;
- ON CONFLICT dedup, with the first finding byte-identical;
- a distinct finding for a materially different contradiction;
- STOP on ambiguous or missing identity, with nothing written;
- the wrong-database refusal;
- the ISSUE-239 recovery:
  - validate-only, dry-run and apply;
  - original ids, microsecond times, jsonb and supersedes kept;
  - the attribution-only actor;
  - the D15 outcome;
  - idempotent rerun;
  - ledger-lost / outcome-survived;
  - the importer-conflict refusal.

The ledger id sequence, once raised to 9239003, is intentionally not lowered.

If the run dies before its own teardown:

```powershell
npm run db:code-test:issue239-241-rehearsal -- teardown --acknowledge code_test_db
```

**On PASS:** resolve ISSUE-240 and ISSUE-241, and ISSUE-239 per its runbook §7. Record the check
count here and in `issues.md`. No DEV step is required for any of the three. Nothing in this pass
runs automatically, and each tool is operator-invoked on demand. **Done 2026-09-26:** attempt 3
passed 26/26 (§9.1) and all three are resolved.

### 9.1 Rehearsal attempts

**Attempt 1 (2026-09-26, operator-run, import role `afldb_import`): FAILED, cleanly, residue 0.**

Operator output, in order. Every check up to the ISSUE-240 distinct-finding check passed:

```text
PASS  241: resolveAflApiPlayerIdentities agrees with resolveAflApiPlayerIdentity on real rows
PASS  241 validate-only: READ_ONLY with 2 links, 1 contradiction, 1 collision, 2 new findings
PASS  241 validate-only: the stale hint is reported and ignored
PASS  241 validate-only wrote nothing
PASS  241 dry-run: ROLLED_BACK after the full write path
PASS  241 dry-run left nothing behind
PASS  241 apply: each provider links to the player its IDENTITY names
PASS  240 apply: two keyed open findings recorded
PASS  241 apply is idempotent: nothing linked on the replay
PASS  240 replay: no duplicate open finding and the first findings are byte-identical
PASS  240 every detection, the deduplicated replay included, stays inspectable in import_rejections
PASS  240 a materially different contradiction (another evidence class) is recorded separately
PASS  zero fixture residue after teardown
REFUSED: duplicate key value violates unique constraint "external_identities_uq"
exit = 1
```

- The `finally` teardown ran before the error surfaced, so its residue check printed first.
- A separate `residue` run afterwards gave
  `{"identities":0,"ledger":0,"actors":0,"findings":0,"batches":0}`, exit 0.
- No ISSUE-239 step ran. The recovery never executed, so the ledger id sequence was **not**
  raised by this attempt.
- The unrun checks were: the two STOP checks, the wrong-database check, the nine ISSUE-239 checks.

**Failing step (proved by reading the harness).** The failing statement was the rehearsal's own
owner-role fixture insert for the "241 ambiguous and missing identities refuse the whole run" STOP.
It came straight after the 240 distinct-finding check and before any loader call:

```sql
INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
SELECT (SELECT id FROM sources WHERE key = 'afltables'), 'players/Z/Zz239_Ambiguous.html', p, 'unique', 1, 'afltables_profile_url'
  FROM unnest(ARRAY[P[4], P[5]]::int[]) AS p
```

- That statement writes two rows with the same key: (`afltables` source id,
  `players/Z/Zz239_Ambiguous.html`).
- `external_identities_uq UNIQUE (source_id, external_id)` (migration 002) refuses the second row.
  The failure did not depend on the data.
- No other fixture row exists under that path, before or after. The census counts every
  `players/Z/Zz239_%` row, and it was 0 before the run.

**Classification: A, a rehearsal fixture construction bug.** It is not B and not C:

- **Not B.** No production code had run for the STOP scenario yet: `importAflApiBridge` is called
  only after the insert. The resolver (`resolveAflApiPlayerIdentit{y,ies}`) unions the
  `afltables`/`afltables_profile_url` and `manual_admin_edit`/`manual_admin_edit` lineages. So an
  `ambiguous` reverse identity IS reachable in the schema, as one row in each lineage on two
  different players. The production classifier and loader STOP are unchanged.
- **Not C.** The acceptance criterion "ambiguous identity refuses" (§6) still holds, and it is
  reachable. Only the fixture's shape for it was wrong.
- **Contributing DB-free gap.** The fake database's seeding helpers (`afltablesIdentity`,
  `aflApiRow`) did not enforce `external_identities_uq`. Three DB-free "ambiguous" cases therefore
  seeded the same unreachable same-source shape, and that is how the assumption got through:
  - bridge STOP;
  - batched-lookup agreement;
  - recovery "an identity is ambiguous".

**Fix (harness and test helpers only; no production file, no constraint, no semantics touched):**

- `tools/db/afl-api-identity-bulk-rehearsal.ts`:
  - The new exported `ambiguousIdentityFixtureRows(path, [a, b])` builds one `afltables`
    `unique` row and one `manual_admin_edit` `resolved` row.
  - The STOP fixture now inserts exactly those, one statement per row.
  - The ambiguity fixture is deleted after the two STOP checks, so the ISSUE-239 section starts
    without it. Teardown still covers the path.
- `tests/afl-api-identity-fake-db.ts`:
  - Every seeding helper now goes through `seedIdentity`, which throws the PostgreSQL
    `external_identities_uq` error on a duplicate (source, external_id).
  - A new `manualAdminIdentity` helper was added.
- The three DB-free ambiguity cases now use the reachable cross-lineage shape.
- New DB-free guards (in `tests/afl-api-player-bridge-import.test.ts`):
  - the fake refuses the same-source duplicate;
  - the rehearsal's exported fixture rows are distinct per (source, external_id), name two
    players, and really resolve as `ambiguous` through both lookups.

**DB-free validation after the fix (2026-09-26, Claude-run):**

- the two suites: 53/53 PASS;
- `tsc --noEmit` PASS;
- ESLint on the four changed files PASS;
- `git diff --check` clean.

**Attempt 2 (2026-09-26, operator-run): FAILED, cleanly, residue 0.**

- Pre-run residue: `{"identities":0,"ledger":0,"actors":0,"findings":0,"batches":0}`.
- PASS: all 15 ISSUE-241/240 checks, through `241 a session on another database than the named
  target refuses`.
- PASS: `239 validate-only: 3 ledger rows, 1 actor, 1 outcome, READ_ONLY`.
- Then: `REFUSED: The recovered ledger does not equal its source (rows 9239001, 9239002, 9239003
  differ; 3 row(s) present for 3 in the source).` Exit 1.
- The `finally` teardown's residue, and a separate `residue` run (exit 0), were both
  `{"identities":0,"ledger":0,"actors":0,"findings":0,"batches":0}`.

**Failing phase (proved by reading the code).**

- The refusal was emitted in the **dry-run** call, the second `recoverAflApiAdjudications` call. No
  `239 dry-run` check printed, so the throw came from that call, not from apply.
- It is thrown by `recoverAflApiAdjudications`'s post-write readback
  (`tools/migration/recover_afl_api_adjudications.ts`, "Every source row must now be present"). That
  readback compares each source row with `readLedger`'s row through D15's own `sameLedgerRow`.
- The rows are compared after the actor insert, the three `OVERRIDING SYSTEM VALUE` inserts and the
  sequence raise, and before the D15 replay.

**Field-by-field, source vs read back.** The same for rows 9239001, 9239002 and 9239003:

| Field | Source (fixture) | Read back | Class |
|---|---|---|---|
| `id`, `supersedes_id` | 9239001-3; null, null, 9239002 | same (`::text` then integer) | equal |
| `source_key`, `external_id`, `action` | as written | same (text) | equal |
| `player_id` | P6/P7 | the identity's player | A: remapped surrogate, excluded by `sameLedgerRow` |
| `admin_user_id` | 1 | the new attribution-only actor | A: remapped surrogate, excluded |
| actor e-mail | fixture e-mail | same (compared lower-cased) | equal |
| actor role | `super_admin` | not compared (lives on `auth_users`) | n/a |
| `player_identity` | the `players/…` path | same (text, no trigger) | equal |
| `previous_state` | null, null, `{"status": "resolved"}` | same: one key is already PostgreSQL's rendering | equal |
| **`evidence`** | `{"rehearsal": "AFLDB-ISSUE-239", "row": N}` | `{"row": N, "rehearsal": "AFLDB-ISSUE-239"}` | **B: representation only** |
| `evidence_sha256` | `N` × 64 | same (text, regex CHECK only) | equal |
| `surname_disagreement_acknowledged` | false, true, false | same (boolean) | equal |
| `note` | as written | same (text) | equal |
| `created_at` | `2026-09-26T0N:00:00.123456Z` | same | equal |

- **`evidence`.** jsonb keeps no key order. It stores and renders keys shorter-first, then
  bytewise. `row` (3 bytes) therefore precedes `rehearsal` (9 bytes). This was the only differing
  field. It explains why all three rows were reported: every row carried both keys.
- **`created_at`.** It is bound as text and cast `::text::timestamptz`. `timestamptz` holds
  microseconds, and `readLedger` renders it back in UTC with `.US`. No JavaScript `Date` is involved
  anywhere, so there is no millisecond truncation.
- **`bigint`.** Ids are read as `::text` and parsed to safe integers on both sides, so there is no
  string-vs-number split.
- No `NULL`-vs-`undefined` split, no `bytea` and no enum type is involved.

No semantic data was lost: the stored jsonb value equals the fixture's value.

**Classification: A, a rehearsal fixture defect.** Not B, not C, not D:

- **Not B or C.** Every legitimate recovery source is written by `readLedger` (`evidence::text`,
  `previous_state::text`). That is true of an `export` and of a v2 rebuild capture. So the source's
  jsonb text is PostgreSQL's own rendering. PostgreSQL's rendering of that rendering is itself. The
  byte-exact text comparison is D15's existing notion of equality (`sameLedgerRow`, also behind
  `sameLedger`'s verify-reinstated decision), and it is correct for every real source.
  `CapturedLedgerRow.evidence` is documented as "`evidence::text`, exactly as PostgreSQL rendered it".
  The fixture broke that contract; the payload hash cannot catch this, because the fixture hashed its
  own text. Weakening the comparison would let a source that no export can produce pass as verbatim.
- **Not D.** The acceptance criterion (jsonb preserved exactly) stands and is checkable. Only the
  fixture's text was wrong.
- **The apply check would have failed too.** The old apply check compared
  `JSON.stringify(<postgres.js-decoded evidence>)` against `JSON.stringify(JSON.parse(<fixture text>))`.
  Those serialise in the two different key orders.
- **Contributing DB-free gap.** `tests/afl-api-identity-fake-db.ts` stored and returned jsonb text
  verbatim. The DB-free suite's own fixture (`{"provider": …, "row": N}`) was therefore
  non-canonical too, and passed.

**Sequence side effect.** Attempt 2 very probably raised the ledger sequence to 9239003:

- In dry-run, as in apply, `setval(…, max(source id), true)` runs before the readback. PostgreSQL does
  not roll `setval` back.
- The readback only runs after the post-raise check (`next id > 9239003`) passes. So the sequence
  handed out ids above 9239003 when the refusal was thrown.
- This is expected and safe. The sequence is only ever raised, only to ids the source holds, and the
  sole effect is a gap. It is not lowered (§9).
- A rerun works with the sequence at or above 9239003:
  - `next id` is 9239004 or more, so no `setval` is issued;
  - the three rows are inserted with explicit ids (`OVERRIDING SYSTEM VALUE`);
  - `wrote` is still true through the inserts, so apply commits one batch;
  - the idempotent rerun remains `ALREADY_RECOVERED`.
- No rehearsal check reads the sequence.

**Fix (harness and test helpers only; no production file, no comparison, no semantics touched):**

- `tools/db/afl-api-identity-bulk-rehearsal.ts`:
  - The new exported `recoveryFixtureLedgerRows(players)` builds the three rows. Its evidence is
    written in PostgreSQL's rendering, `{"row": N, "rehearsal": "AFLDB-ISSUE-239"}`. Every other field
    is unchanged.
  - A new first ISSUE-239 check, `239 fixture: every jsonb text is exactly what PostgreSQL renders`,
    asks real PostgreSQL (`x::jsonb::text`). It stops with a named refusal before any recovery call.
  - The apply check now compares `evidence::text` and `previous_state::text` byte for byte with the
    source, instead of re-serialising decoded objects.
  - The check count is now 26.
- `tests/afl-api-identity-fake-db.ts`:
  - The new `pgJsonbText` renders jsonb as PostgreSQL does. The ledger insert and read apply it.
  - A thrown transaction no longer rolls back the sequence (`setval` is non-transactional).
- `tests/afl-api-adjudication-recovery.test.ts`:
  - The suite's fixture evidence is now PostgreSQL-rendered.
  - There are three new tests: the renderer; the attempt-2 reproduction; and the guard on the
    rehearsal's exported fixture rows.
  - The attempt-2 reproduction: validate-only passes, then dry-run and apply refuse with the exact
    attempt-2 message. Nothing is written, the sequence stays raised, and only `evidence` differs.
  - The guard: the rehearsal's exported rows are PostgreSQL-rendered, and they dry-run and apply
    cleanly.
  - The dry-run test now asserts the surviving sequence raise.

**DB-free validation after the fix (2026-09-26, Claude-run):**

- `tests/afl-api-adjudication-recovery.test.ts` + `tests/afl-api-player-bridge-import.test.ts`:
  56/56 PASS (recovery 20);
- `tsc --noEmit` PASS;
- ESLint on the three changed files PASS;
- `git diff --check` clean.

**Attempt 3 (2026-09-26, operator-run): PASSED 26/26. This is the accepting run.**

Environment, as reported by the operator:

- `AFLDB_CODE_TEST_DATABASE_URL` and `AFLDB_CODE_TEST_IMPORT_DATABASE_URL` set;
- the SSH tunnel `127.0.0.1:55432` reachable;
- the owner target previously proved `code_test_db|afldb_owner`, the import target
  `code_test_db|afldb_import`.

Sequence and exits:

```text
residue                                  {"identities":0,"ledger":0,"actors":0,"findings":0,"batches":0}   exit 0
run --acknowledge code_test_db           26/26 checks PASS                                                 exit 0
residue                                  {"identities":0,"ledger":0,"actors":0,"findings":0,"batches":0}   exit 0
INITIAL_RESIDUE_EXIT=0  REHEARSAL_EXIT=0  FINAL_RESIDUE_EXIT=0
```

Operator output, in order (wording as reported):

```text
PASS  241: resolveAflApiPlayerIdentities agrees with resolveAflApiPlayerIdentity on real rows
PASS  241 validate-only: READ_ONLY, 2 links, 1 contradiction, 1 collision, 2 new findings
PASS  241 stale candidate_player_id hint reported and ignored
PASS  241 validate-only wrote nothing
PASS  241 dry-run rolled back after the full write path
PASS  241 dry-run left nothing behind
PASS  241 apply: each provider linked to the player its STABLE IDENTITY named; stale hint never used
PASS  240 apply: two keyed open findings recorded
PASS  241 apply idempotence: nothing linked on replay
PASS  240 replay: no duplicate open finding; first findings byte-identical; ON CONFLICT DO NOTHING as designed
PASS  240 provenance: every detection, deduplicated replay included, inspectable in import_rejections (count 4)
PASS  240 materially different contradiction: another evidence class recorded separately
PASS  241 ambiguous + missing identities: whole run refused, nothing written
PASS  241 refused run wrote nothing
PASS  241 wrong-database session refused
PASS  239 fixture JSONB: every jsonb text exactly matched PostgreSQL rendering
PASS  239 validate-only: 3 ledger rows, 1 actor, 1 outcome, READ_ONLY
PASS  239 dry-run: ROLLED_BACK, nothing left behind
PASS  239 apply: ledger reinstated; ids, microsecond created_at, jsonb, previous_state and supersedes preserved
PASS  239 D15: replay produced exactly the live outcome
PASS  239 actor: attribution-only, disabled, no credential
PASS  239 idempotence: rerun = ALREADY_RECOVERED, no new batch
PASS  239 ledger lost / outcome survived: ledger reinstated, surviving outcome a no-op
PASS  239 conflicting importer row: recovery refused, nothing written
PASS  239 refused recovery wrote nothing
PASS  teardown: fixture residue {"identities":0,"ledger":0,"actors":0,"findings":0,"batches":0}
AFLDB-ISSUE-239/240/241 code_test_db rehearsal: 26/26 checks PASS
```

Detail the operator recorded for the ISSUE-239 checks:

- **Fixture jsonb, as PostgreSQL rendered it:** `{"row": 1, "rehearsal": "AFLDB-ISSUE-239"}`,
  `{"row": 2, …}`, `{"row": 3, …}`, and `previous_state` `{"status": "resolved"}`. This is the
  attempt-2 defect's guard, and it passed before any recovery call.
- **Apply preserved:**
  - ids 9239001, 9239002, 9239003;
  - `created_at` to the microsecond: `2026-09-26T01:00:00.123456Z`, `…02:00:00.123456Z`,
    `…03:00:00.123456Z`;
  - jsonb `evidence` and `previous_state`, byte for byte;
  - the supersedes relationship: 9239003 supersedes 9239002.

**What attempt 3 proves on real PostgreSQL.** Every criterion §9 lists:

- ISSUE-241: the batched lookup agrees with the single lookup; validate-only, dry-run, apply and
  idempotent re-apply under `afldb_import`; stable identity decides and a stale surrogate is never
  authoritative; STOP on ambiguous or missing identity with nothing written; the wrong-database
  refusal.
- ISSUE-240: keyed dedup through the real `ON CONFLICT` inference and the `afldb_import` grants;
  the first finding byte-identical; provenance kept in `import_rejections`; a distinct key for a
  materially different contradiction.
- ISSUE-239: the recovery end to end; the D15 outcome; the attribution-only actor; idempotence;
  ledger-lost / outcome-survived; the importer-conflict refusal.

**Scope of contact.** `code_test_db` only. No DEV, PROD, `afldb_test` or retained promotion
database was contacted by this acceptance.

**Sequence.** The ledger id sequence was left where attempts 2 and 3 put it (at or above 9239003).
It is intentionally not reset, per §9. No check reads it.

**Attempts 1 and 2 above are kept unchanged as history.** Both were harness fixture defects,
fixed DB-free, with no production semantic change. Attempt 3 is the run the resolution rests on.

## 10. Remaining limits and follow-up

- Legacy (pre-ISSUE-240) duplicate contradiction rows carry a NULL `issue_key` and are left
  untouched. See `AFLDB-ISSUE-240.md` §4.
- The historical Python builders are not identity-binding (§5). This is recorded, not a follow-up
  issue.
- ISSUE-238 remains separate and **open** (`issues/open/AFLDB-ISSUE-238.md`).
- **Merge readiness.** This runbook now lives in `issues/closed/`, and `merge:ready -- --issue 241`
  looks only in `issues/open/`. Run
  `npm run merge:ready -- --runbook issues/closed/AFLDB-ISSUE-241.md` instead.
