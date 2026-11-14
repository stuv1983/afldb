# Remediation run 3 — plan review (afldb-reviewer, Fable 5), as returned

## Plan review: remediation run 3 (Duty A)

**Verdict: PROCEED.** 0 CRIT, 0 HIGH, 8 MED, 2 LOW, 2 INFO. The MED mitigations should be folded into the run plan before step 1.

Read from disk in `D:\dev\afldb-rem-20261114` only. I ran no commands and wrote no files. All paths below are relative to that root.

### MED

**F-001. The state-b suite deletes the snapshot row it refuses to adopt (step 1 design and proof).**
- `tests/integration/settle-afl-api-state-b.test.ts:297-298` sets the source ids before the refusal at `:310`.
- `afterAll` (`:364-366`) still calls `cleanup()`, which at `:272` deletes `(afl_api, CD_I297354)` unconditionally. That is the snapshot's real Karl Amon identity.
- Evidence: `docs/v2/evidence/remediation-20261114/run2/tests363/audit-residue.jsonl:40` records `external_identities netRowDelta -1` for the failing state-b run.
- Consequence 1: red is single-shot. A second shared-mode run on the same copy goes green with no fix.
- Consequence 2: the fingerprint cannot catch it, because `before` is unset on refusal (`:368`) and it only counts rows (`:164`).
- Mitigation:
  - Rename the provider player id in the cloned roster and stats to a namespace-owned id (1 occurrence in `03-match-roster.raw.json`, 2 in `02-player-stats.raw.json`), and expect `bundle.buildFailures` to stay `[]`.
  - Scope residue (`:198-200`) and cleanup (`:272-273`) to rows the suite owns (its synthetic player or its own ids).
  - Add an assertion that the snapshot row for `CD_I297354` is identical before and after.
  - Use a fresh copy for every red attempt and every ordering.
  - Do not use delete-and-restore of the snapshot row.

**F-002. `settle-afl-api.test.ts:772` is the other half and is outside the plan.**
- It deletes the same snapshot row. That is why state-b passed in the shared full run.
- After step 1, shared mode still has this cross-file mutation, plus T363-2 and T363-3 (`run2/tests363/README.md:137-138`).
- `settle-afl-api-brownlow.test.ts` also references `CD_I297354`; I did not inspect how.
- Mitigation: step 5 must list these as explicit remainder. ISSUE-363's own criterion is at `issues.md:55123`, so "partially resolved" is the ceiling unless they are fixed.

**F-003. "Standard `db:test:rebuild`" defaults to the shared target.**
- `package.json:20` passes no `--target`; `tools/db/rebuild-test.ts:261` defaults to `afldb_test`.
- The tool loads `.env` from the working directory (`:4819-4827`).
- The isolated path is well guarded (`:904-963`), and `docs/v2/isolated-rebuild.md:28` says `isolated-pg run` cannot spawn `npm` or `npx`.
- Mitigation:
  - Use only `isolated-pg run <name> -- node node_modules/tsx/dist/cli.mjs tools/db/rebuild-test.ts --target isolated --acknowledge-destroy <name>`.
  - Run from a fresh workspace with no `.env`, never with the DEV checkout as working directory.
  - The name must be `afldb_v2_rb_<label>_test` (`:303-304`).
  - Set `AFLDB_REBUILD_CAPTURE_ROOT` to a new directory outside the checkout.

**F-004. Port and shared-mode guard.**
- `tools/v2/isolated-pg.ts:73` defaults to port 55432. `docs/v2/isolated-rebuild.md:3-8,18` records that 55432 was an SSH forward to the shared dev PostgreSQL.
- `tests/integration/guard.ts:69` enforces the isolated checks only when `AFLDB_V2_ISOLATED_PG=1`. A bare shared-mode vitest run with an ambient DSN to `afldb_test` on 5432 would pass the `_test` check.
- Mitigation:
  - Set `AFLDB_V2_PG_PORT` explicitly to an unused port (not 5432, 55432, 55651 or 55660), with a new `AFLDB_V2_PG_ROOT`.
  - Run every vitest invocation, including step 1's shared-mode proofs, through `isolated-pg run`.

**F-005. Name-pinned suites and the per-file prefix.**
- OD-5 refuses per-file names (`run2/qualification-2/integ-failures.tsv:49`).
- The two Brownlow suites pin exact names: `afldb_v2_brownlow_tristate_twelve_test` and `afldb_v2_brownlow_policy_final_test` (line 23 of each test file).
- These must run in shared mode on a named clone, not in per-file mode.
- Do not set `AFLDB_TEST_PER_FILE_DB_PREFIX=afldb_v2_rb_` as a shortcut. It matches the rebuild-name pattern and would silently un-skip `isolated-populated-lifecycle.test.ts:51` (T363-4), changing the test population against Q.
- Run OD-5 on a dedicated `afldb_v2_rb_<x>_test` clone, never on the rebuilt base itself.

**F-006. Provenance of the "dedicated clone" and "empty table" conditions.**
- The Brownlow suites use production-shaped ids (for example player 12446) and `AFLDB_BROWNLOW_REHEARSAL_SOURCE_ROOT` (`v2-brownlow-production-correction.test.ts:124,130`).
- `v2-coleman-publication.test.ts:307` and issue276 refuse on existing rows.
- Hand-deleting rows or assembling a clone to make a guard pass is manufacturing the condition.
- Mitigation:
  - Reproduce the clone only from the suite's documented recipe and retained artefacts, with no network.
  - Record the base and every preparatory statement.
  - Otherwise classify as "deliberate refusal, not run", not as passed.

**F-007. The four-class taxonomy cannot hold the expected main outcome.**
- A snapshot-oracle id that passes on the rebuilt database is none of defect, stale assertion, deliberate refusal or owner-limitation.
- Mitigation:
  - Add "passes under intended conditions (environment-only)" and "not run / blocked (stage named)".
  - Fix the id universe at 53: the 52 ids plus "war years", which did not recur at Q (`run2/QUALIFICATION-2.md:75`). It can only be "not reproduced" unless it fails again.
  - Record the fitzRoy baseline label and the ledger the rebuild used. Run 2 says tests pin the retired `full-history-20260902` while the accepted baseline is `c2-2026-final-core-v1` (`QUALIFICATION-2.md:51`).
  - A mismatch on a differently-based rebuild proves neither defect nor stale oracle.

**F-008. Q′ and rebuild staleness, and scripts under `docs/`.**
- The rebuild runs at an intermediate revision R. Step 3 fixes come after it.
- If `git diff R..Q′` touches `tools/db`, `tools/migration`, `tools/rebuild`, `src/db/migrations` or `data/reference`, rebuild again. Otherwise carry by file identity and say so.
- The records-only proof is by path allowlist (`run2/APPROVAL-PACKET-2.md:12,57`), but the qualification wrappers live under `docs/…/tests363/`.
- Any script used to produce Q′ evidence must be committed at or before Q′ with its hash recorded. Otherwise "records-only" is true by path and false in substance.

### LOW

**F-009. Pin freeze is too narrow.** The plan freezes the DraftGuru pins only. Extend it to every data contract: the Coleman contract (the awards 47 vs 46 case, `tests363/README.md:77`), `AWARDS_HONOURS_EXPECTED` (`rebuild-test.ts:2349`) and the ladder witness (`:1173`). A "stale assertion" edit to a modelling pin is an owner decision.

**F-010. Decision (3) wording.** `issues.md:55121` and packet §C (`APPROVAL-PACKET-2.md:165`) say "rebuilt `afldb_test`". Run 3 builds an isolated database. Record it as that, under today's authorisation, and do not mark decision (3) adopted or the shared `afldb_test` rebuilt.

### INFO

**F-011.** No sudo is needed. The cluster is loopback-only with no unix socket (`isolated-pg.ts:223,225`), the root must sit outside the repository (`:71`), and `isolated-pg run` strips ambient `*DATABASE_URL*` and `PG*` variables (`:437`). `rebuild-test.ts` refuses `afldb_dev` and `afldb_prod` by name (`:275`). I did not read the stage bodies; the "no network acquisition" claim rests on `isolated-rebuild.md:96`.

**F-012.** No run-2 document marks steps 1 to 6 as blocked or owner-gated beyond F-010. Read-only copying of hash-verified inputs from the DEV checkout has run-2 precedent (`QUALIFICATION-2.md:49-56`).

(JSON block: role reviewer; findings F-001..F-012 as above; escalated_to none; self_check: re-read from disk state-b :1-440, guard.ts, rebuild-test.ts :200-400/:904-963/:4806-4835, isolated-pg.ts grep, isolated-rebuild.md, package.json scripts, APPROVAL-PACKET-2, QUALIFICATION-2, RESIDUALS, tests363 README, audit-residue.jsonl:40, integ-failures.tsv, the ISSUE-363 entry only. Not verified: rebuild stage bodies (network), vitest afterAll-after-failed-beforeAll semantics, how settle-afl-api-brownlow uses CD_I297354. No commands run, no files written.)
