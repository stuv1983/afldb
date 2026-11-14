# Remediation run 3, scope `integ`, phase A: intended database conditions of the 53 integration ids

Branch `claude/rem3-integ-20261114`, base `6d5388ea5305e73b0420fbccfa7b0cea4fe75927` (run-2 candidate tip; executable revision Q =
`f10e47ad`). Local only. Host `streamanator`, workspace `/mnt/ssd/afldb-rem3-integ-20261114`, cluster
`/mnt/ssd/afldb-rem3-integ-20261114-pg`, **port 55673**, host checkout `cand` (HEAD `6d5388ea`, bundle sha256
`0a1b46d1…ccf68` verified, no `.env`, `npm ci` done). Template `afldb_v2_rem3integ_tmpl_test` restored from the approved snapshot
(`afldb_prod-20261104T021037Z.dump`, 30,141,895 bytes, sha256 `e77c307d…2826d`, both verified) with `restore.mjs`, then
`migrate.ts --target test`: ledger `118_fixtures_unconfirmed_participants.sql`, 17,056 matches, 218 fixtures, 5 receipts
(`evidence/a/tmpl-probe.txt`). Every database command ran through `isolated-pg run` on port 55673 with `AFLDB_V2_PG_ROOT`,
`AFLDB_V2_PG_PORT` and `AFLDB_V2_PG_BIN` exported; a fresh `--template` copy per experiment; none of the forbidden ports was touched.
No source file of the application, the tests or the harness was edited in this phase: no defect inside these suites was
demonstrated (see "Defect check"). The deliverables are this record, `run-rebuilt.sh` (phase B), its two helpers and the raw evidence.

## 1. Result in one table

Six-class vocabulary: 1 passes under intended conditions; 2 actual defect; 3 stale assertion (with evidence; never a modelling pin);
4 deliberate refusal (not reproducible from its documented recipe); 5 limitation awaiting owner; 6 not run / blocked.
"Provisional" means phase B (the rebuilt database) decides. The per-id list (53 rows, every id with its intended condition, cite,
what was run and the provisional class) is `ids.tsv`; the groups are:

| Suite (ids) | Intended condition (cite) | What was run in phase A | Class now |
|---|---|---|---|
| `database` war years (1, extra id) | any base on which no earlier file of a SHARED run has recomputed 2026 Brownlow coverage while 2026 is `complete` (section 3) | alone x3 shared + x1 per-file: pass. Mechanism reproduced twice (settle-afl-api-brownlow first; file order with and without the vitest cache) | **1, "not reproduced" as a standalone failure; mechanism found** (finding F-1) |
| `v2-coleman-publication` (1) | a schema-only database (`docs/v2/final-report.md:86` "it passes schema-only"; `local-release-review.md:289-290`; `gap006-linux-qualification-20261101`); refuses any base holding a Coleman 2001 row (`tests/integration/v2-coleman-publication.test.ts:307-310`) | schema-only database built by create-db (no template) + the normal runner + privileges: **28/28**; on the snapshot copy it refuses, 28 skipped | **1** (the refusal on a populated base is by design) |
| `v2-brownlow-eligibility-2025-rehearsal` (1) | fresh clone of the authentic 2025 template, migrations installed separately, name `afldb_v2_brownlow_tristate_twelve_test` (`…rehearsal.test.ts:1-6,22`) | clone built only from the retained recipe and artefacts (section 5): shared mode, **3/3** | **1** |
| `v2-brownlow-production-correction` (1) | same template, name `afldb_v2_brownlow_policy_final_test`, `AFLDB_BROWNLOW_REHEARSAL_SOURCE_ROOT` = retained fixture root (`…correction.test.ts:1-4,23-24,124-131`) | as above, shared mode: **8/8** (2,215 s) | **1** |
| `settle-afl-api` OD-5 (1) | a database named `afldb_v2_rb_<x>_test` (or `afldb_v2_hist_test`) run through `isolated-pg run`, never the rebuilt base itself (`tools/db/rebuild-test.ts:304-318`, `:770-796`) | snapshot copy named `afldb_v2_rb_rem3io5_test`, shared mode, `-t` filter: **1 passed** | **1** (provisional; phase B repeats on a clone of the rebuilt base) |
| `data-editor` (5) | no active `player_match_stats` row in `data_overrides` (`data-editor.test.ts:2447-2451`) | snapshot copy: the 5 fail with the integ-failures text; the snapshot holds **1** such row (`evidence/a/de-precondition.txt`) | **1 provisional**: the published table counts of the rebuild give `data_overrides` 0 |
| `awards-reload-links` (1, two describe-level errors) | 2026 not `complete`, so the derived Coleman loader yields the contract's 46 rows (`coleman-derivation.json` `legacy_transition.expected_rows`; `awards-reload-links.test.ts:5153-5158`, `:5533-5538`) | snapshot copy: 97 passed / 10 skipped + the 2 errors; section 4 settles "47 vs 46" | **6 / 5**: pin not edited; owner decision if the rebuild holds a complete 2026 |
| `settle-afl-api-issue276` (1) | real Hawthorn, Brisbane Lions, M.C.G. and no canonical row matching the fixture identities (`…issue276.test.ts:904-919`, `:946-951`) | snapshot copy: refuses with `matches.id 17266 = 2026\|PF\|2026-09-19\|Hawthorn\|Brisbane Lions` | **6** (phase B) |
| 6 snapshot-oracle files (40 ids: club-comparison 24, database 4, draft-linkage 2, admin-brownlow 1, gridley-corpus 1, release-gates 8) | a rebuilt `afldb_test` (each file says so; `ids.tsv` has the lines) | one fresh snapshot copy, per-file `MODE=all`: **40 failed / 1,429 passed / 7 skipped**, the same 40 ids as `integ-failures.tsv` (section 2) | **6** (phase B); see section 7 for what the published rebuild already shows |
| `settle-afl-api-state-b` (1) | owned by the `stateb` scope | not run | owned by stateb |

## 2. Baseline confirmation on a fresh snapshot copy

`evidence/a/oracle6-snapshot.json.gz` (copy `afldb_v2_rem3integ_o6_test`, `run-integration-per-file.sh`, `MODE=all`, the six files
in one invocation, under the heavy lock): 6 files failed, **40 tests failed**, 1,429 passed, 7 skipped; 24 + 4 + 2 + 1 + 1 + 8 = 40.
`verdicts-snapshot-probe.tsv` (`node verdicts.js integ-failures.tsv <the JSONs>`): every one of the 48 runnable baseline ids
(40 + data-editor 5 + awards 1 + coleman 1 + issue276 1) is `FAIL`; the 4 ids not run in this probe are state-b (stateb scope), OD-5
(needs the renamed clone, section 1), and the two Brownlow clones (section 5). The failing set therefore still equals
`integ-failures.tsv` for these files, as at Q. This is the phase B baseline.

## 3. `database` "Brownlow correctness separates the war years from merely uncollected seasons"

**Test** (`tests/integration/database.test.ts:320-330`): the `brownlow_season_total` rows with `coverage = 'not_applicable'` and
`season >= 1924` must be exactly `[1942, 1943, 1944, 1945]`. Run 1 failed it with `[1942..1945, 2026]`; it did not recur at Q.

**Reproduction attempts (each on a fresh snapshot copy, shared mode unless stated):** the file alone, 3 times
(`war-shared-1..3`): the war-years id passed each time (only the 4 known snapshot-oracle ids failed); once per-file
(`war-perfile`): passed.

**Mechanism found.** On the snapshot, season 2026 is `complete` and its Brownlow coverage is `pending` with no accepted votes.
`settle-afl-api-brownlow.test.ts` works on the real season 2026 (`SEASON = 2026`, line 105) and its cleanup ends with
`recomputeBrownlowCoverage(tx, 2026)` (lines 395-403). That function (`src/db/queries/player-derived.ts:735-741`) maps a season that
is not `in_progress`, has no `brownlow_season_votes` rows and no workflow decisions to `not_applicable`. So after that one file,
committed and never restored, 2026 `brownlow_season_total` is `not_applicable`: the next file that reads it sees the 2026 row.
- `mech-state-0/1.txt`: before: `brownlow_season_total 2026 pending`; after the file: `not_applicable`
  (`brownlow_round_votes` `partial`, `brownlow_match_votes` `not_applicable`).
- `mech-war-alone` passes; `mech-war-after-settle` fails with **`AssertionError: expected [ 1942, 1943, 1944, 1945, 2026 ] to deeply equal [ 1942, 1943, 1944, 1945 ]`**,
  the exact run-1 text. Running `settle-afl-api.test.ts` first does not prevent it (`mech2-*`: after both files it still fails).
- **Why it is intermittent: vitest's file order.** `mech3-order-with-cache`: the same two files in one invocation, with vitest's results
  cache (database.test.ts previously failed, so it runs first): the war-years case passes. `mech3-order-no-cache` (`--no-cache`, no
  history, so `settle-afl-api-brownlow` runs first): **5 failed, the war-years case among them**. Run 1 and Q both ran
  `settle-afl-api-brownlow` (index 19 and 17) before `database` (34 and 35) in file order; Q ran per-file (`MODE=all`) and so was isolated,
  the tests363 shared control had a result cache that had `database` as a previously failed file. I could not read the run-1 cache
  state, so the statement about run 1 is consistent with, not proved by, the experiment; the mechanism itself is proved.

**Classification:** class 1 for the id as such ("not reproduced" standalone; it fails only after the file that rewrites 2026
coverage on a base where 2026 is complete). On the intended rebuilt base 2026 is `in_progress`, the recompute yields `pending`,
and nothing leaks (provisional: phase B re-runs the mechanism pair, `war-mech-*`). **No code was changed**; see F-1 and the options.

**F-1 (MED, outside this scope: app code, no fix attempted).** `recomputeBrownlowCoverage` writes `not_applicable` ("there was
nothing to collect": no medal) for the `brownlow_season_total` of a **completed** season whose Brownlow votes simply are not
accepted yet, unless the Brownlow workflow already holds decisions for it. The AFL API Brownlow settle calls the same function after
any canonical Brownlow change (`src/lib/acquisition/afl-api-brownlow.ts:1722`, guarded only by "something changed"). Whether production
can reach that state depends on settle gating I did not trace, but the persisted result of one call is the semantics the ISSUE-316
pending suppression exists to prevent ("reports 2026 Brownlow as pending, never as zero"). Options for the owner/orchestrator:
(a) app: in the season-total `CASE`, keep a `complete` season with no accepted votes at `pending` unless the season is a known
no-medal season; needs a decision because `not_applicable` also locks the admin workflow (`lockMatch`);
(b) test hygiene only: `settle-afl-api-brownlow.test.ts` captures and restores the 2026 `stat_availability` rows byte for byte instead
of recomputing them (hides the symptom, not the semantics); (c) do nothing: per-file mode already isolates the suites.
Recommendation: (a) after a targeted regression test on a base with a complete season; (c) until then.

## 4. `awards-reload-links`: snapshot 47 winner rows vs the contract's 46

The two errors (`evidence/a/awards-snapshot.log.txt.gz`): `afldb_test holds 47 Coleman winner row(s); the tracked contract declares exactly 46`
(`awards-reload-links.test.ts:5153-5158` for the legacy transition, `:5533-5538` for the human-link-decision block).
Evidence (`awards-aggregates.txt`, aggregates only):
- before the run the snapshot holds **46** Coleman rows, one per season 1980-2025, all `afltables`-owned; `awards.first_season/last_season` 1980/2025;
  `seasons` 2026 is `complete`; no 2026 Coleman row exists in the snapshot's `award_winners`;
- the **first** describe of the file runs the derived loader (`legacy/offline/coleman.py`), which by contract materialises a winner for
  **every season with `status = 'complete'`** (`coleman-derivation.json`: `completed_seasons_only`), so with 2026 complete it inserts the
  2026 winner: after the run the family has **47** rows (`coleman rows after run=47`);
- the later describes then refuse, because their preflight compares the family size with `legacy_transition.expected_rows = 46`.

**Which side is right:** neither is wrong in itself. The contract's 46 is a measurement taken on 2026-08-30 ("exactly one per season from
1980 to 2025", the contract's own `first_season_basis`), and the loader's 47 is the contract's own rule applied to a base where 2026 is
complete. The pin is data-state dependent: it holds while 2026 is in progress and cannot hold on any base with a complete 2026
(including the snapshot, the published c2 rebuild if 2026 is complete there, and production). **Not edited** (Coleman contract =
modelling pin). Owner decision if phase B shows 47 on the rebuild: options (1) keep the pin and run the suite only on a base with 2026
in progress (the rebuild at `full-history-20260902`; not available while the register accepts only `c2-2026-final-core-v1`);
(2) re-pin `expected_rows` to the then-complete season count and derive the legacy-transition expectation from the family
(recommended, but a contract change); (3) record it as an accepted limitation.

## 5. The two Brownlow dedicated-clone suites (recipe and artefacts)

The documented recipe is the retained script `/home/arm/afldb-v2-brownlowverify-20261028/xfer/brownlow.sh` (read-only copy committed
as `host-scripts/brownlow.sh`'s ancestor; see `docs/v2/gap006-release-readiness-2026-11-01.md` section "Authentic Brownlow inputs" and
`docs/v2/linux-verification-2026-10-28.md` section 2, whose 2026-10-28/11-01 runs were 3/3 and 8/8). Retained artefacts, copied
read-only into `$W/brownlow/in` and verified against the retained `SHA256SUMS` and the hashes recorded in
`gap006-release-readiness-2026-11-01.md`: `afldb_v2_rb_brownlow2025_test.dump` (29,920,966 B, `5be45eab…3ba4b`),
`fixture-root.tar` (`23cc8b76…ce23`; 483 members, member paths checked, extracted, 258 files), `acquisition-014218.tar`
(`3ed1b46b…aa1b`; byte-identical to the fixture root's copy). Preparatory statements, all from the recipe and nothing else:
1. `isolated-pg create-db afldb_v2_rem3integ_bl2025_tmpl_test`, `pg_restore --exit-on-error --use-list` (TOC 1,640 entries, the 4
   `pg_trgm`/`unaccent` entries excluded, as in the recipe), `vacuumdb --analyze-only`;
2. the restored template's identity query equals the exported `template-identity.txt` (ledger 115, `brownlow_round_votes` 330,383 `097a9f86…`,
   `brownlow_season_votes` 16,120 `252aa832…`, staged votes 621 `48fc8ff0…`, players 13,365, matches 17,056) and `isolated-pg verify` passes;
3. per clone: `isolated-pg create-db <name> --template <tmpl>`, `migrate.ts --target test` through the normal runner, `privileges.ts --target test`.
   **Difference from the recipe, disclosed:** the recipe ran at a tree whose newest migration was 117 ("116 and 117 installed separately");
   at this checkout the normal runner also applies `118_fixtures_unconfirmed_participants.sql` (`afldb_v2_brownlow_*-migrate.log`:
   "Applied 3 migration(s)"). `migrate.ts` has no upper bound, and I did not hand-pick migrations.
Results: `b2-eligibility-2025` **3 passed** (150 s); `b1-production-correction` **8 passed, 0 failed, 0 skipped** (2,215 s wall: cases 85-471 s each; the retained 2026-11-01 run took 995 s in total on an idle host, this host was shared; every case is a vitest `--no-cache` shared-mode run under the heavy lock).

## 6. `v2-coleman-publication`, `settle-afl-api-issue276`, `data-editor`, OD-5

- **Coleman:** intended base = schema-only (section 1). Built exactly as the gap006 run did (`coleschema.sh`; `AFLDB_TEST_PYTHON` = the host venv, which the
  suite needs for its offline-loader cases): **28/28**. On the snapshot copy: `refusing to run: 1 Coleman 2001 row(s) already exist that this suite did
  not create`, all 28 skipped. The rebuilt base holds Coleman 1980-2025 in `award_winners`, so the suite will refuse there too: by design.
- **issue276:** the refusal names exactly one foreign row, `matches.id 17266`, key `2026|PF|2026-09-19|Hawthorn|Brisbane Lions` (`issue276-conflict.txt`).
  The fixtures use the real club pair Hawthorn / Brisbane Lions with round code `PF`, so the suite can never run on any database that
  holds the real 2026 preliminary final of those two clubs. It is fail-closed on purpose. Phase B decides: if the rebuild lacks that
  row it runs (class 1); if the rebuild holds it, the suite cannot run on any base with the final 2026 data, which is a test-design
  finding (choose a club pair/round that cannot occur in a 2026 final; a fixture change, not a pin) for the orchestrator to schedule.
- **data-editor:** precondition stated exactly in section 1; the snapshot has 1 active `player_match_stats` authority row, a real admin
  Match Sheet edit made on production. The rebuilt base is built from sources with no admin edits, so it satisfies the precondition
  naturally; the published `table-counts.tsv` already shows `data_overrides` 0.
- **OD-5:** the first attempt (`od5-snapshot-rbname`) used the filter `-t "OD-5 reinstate (rolled back, no rebuild)"` and **skipped all 74 cases**: `-t` is a
  regular expression and the case name's parentheses are literal. With the parentheses escaped (`od5-snapshot-rbname-2`) the one case passes on a snapshot
  copy named `afldb_v2_rb_rem3io5_test` (shared mode, through `isolated-pg run`). The condition is the database **name**; the case's own
  transaction is rolled back, but the file-level hooks run broad cleanups, which is why it must be a dedicated clone, never the base itself.

## 7. What the sibling's published rebuild already says (named input, read only; nothing was run on it)

`/mnt/ssd/afldb-rem3-base/rebuilt/` was published while phase A ran: dump `afldb_v2_rb_rem3-6d5388ea.dump` sha256
`d8397aab…65c63`, `RESTORE.md`, `restore-dump.mjs`, `table-counts.tsv`, the DraftGuru bridge child (`…child-v3-6d5388ea.json`, sha256 `1200e702…b9d`).
`RESTORE.md` records: commit `6d5388ea`, **fitzRoy baseline `c2-2026-final-core-v1`** (not the retired `full-history-20260902` that
`fitzroy-core-import` pins), DraftGuru `annual-html-20260826`, ledger head 118, 91 final-validation checks, `seasons` 131 (1897-2027).
Its table counts are exact facts that bear on phase B (these are readings of the published file, not test results):
- `player_match_stats` **695,499**, the same number as the production snapshot, **not** the 685,471 that `database.test.ts:452-454` pins
  ("the accepted full-history-20260827 fact table"); `matches` 17,056, equal to the snapshot's. So the snapshot-oracle pins were measured on an
  **older fitzRoy baseline** than the accepted one, and the pin-versus-rebuild mismatch is the same for the rebuild as for the snapshot:
  per the run-3 plan review (F-007) a mismatch on a differently-based rebuild proves neither a defect nor a stale oracle. Expect the
  `database` full-dataset id, the cohort counts and probably the `club-comparison` witnesses and the 2026 gates to fail there too.
  These are modelling pins: **frozen, owner decision** (options: re-pin to the accepted baseline c2; keep and run on a base built at the label
  the pins were measured on, which the accepted-baseline register does not admit; accept as a limitation).
- `brownlow_round_votes` 320,861 = the floor in `admin-brownlow.test.ts:380-392`; `data_overrides` 0; `fixtures` 0; `external_identities` 18,424.

## 8. Phase B runner

`run-rebuilt.sh` (+ `verdicts.js`, `brownlow-clones.sh`): given `--dump`, `--sha256`, `--bridge` it follows the sibling's `RESTORE.md`
exactly (`create-db`, `isolated-pg run <db> -- node restore-dump.mjs <dump> <sha>`, `verify`, the 83-table count diff), imports the bridge
child into a copy used only by the `oracle6` group (after verifying the 42 Stage A raw pages against the committed manifest; copied
read-only from the DEV checkout data), writes the base's identity (ledger, seasons in progress, 2026 state, Coleman rows, authority rows,
the 2026 PF row, 2026 Brownlow coverage), then runs: `oracle6` (per-file `MODE=all`, bridged copy), `data-editor`, `awards`, `war-years`
(3 shared + 1 per-file + the mechanism pair), `coleman` (rebuilt copy and schema-only), `issue276` (per-file), `od5` (dedicated `afldb_v2_rb_rem3io5_test`
clone, shared, escaped `-t`), optionally the Brownlow clones from the retained recipe (`--with-brownlow`; they cannot use the rebuilt base). It
refuses an ambient DSN, `AFLDB_TEST_PER_FILE_DB_PREFIX`, the forbidden ports, a workspace with a `.env`, and a dump that is not the
`SHA256SUMS` entry; `--dry-run` runs every check and changes nothing. Dry-run proofs (`evidence/a/runner-dryrun.txt`, 16 cases, 0 mismatches) are two accepted runs on the real
published files and 14 refusal cases (bad/malformed sha, missing dump or bridge, ports 5432/55651/55660/80, per-file prefix, ambient DSN, foreign workspace, unknown group/argument, bad tag). The full run is phase B.
Usage:

```bash
R=/mnt/ssd/afldb-rem3-base/rebuilt
bash docs/v2/evidence/remediation-20261114/run3/integ/run-rebuilt.sh --dump $R/afldb_v2_rb_rem3-6d5388ea.dump \
  --sha256 d8397aab92e3ce0cf2a640bb5daeac6594fb0e2c723dc410d82d8e718f165c63 \
  --bridge $R/afldb_v2_rb_rem3-draftguru-bridge-child-v3-6d5388ea.json --with-brownlow --tag phaseB
```

## 9. Defect check, owner decisions, disclosures

No defect inside these suites was demonstrated, so there is no red/green change: every remaining failure is a base condition (snapshot or
accepted-baseline mismatch) or, for `settle-afl-api-brownlow`'s 2026 rewrite, an app finding (F-1) outside this scope.

Owner decisions prepared (not taken): (1) the stale modelling pins versus the c2 baseline (section 7); (2) the Coleman `expected_rows` pin (section 4);
(3) F-1 (section 3). 

Disclosures: (a) `node .phaneslight/scripts/cli.js new-file` was not used: the workstation has no Node, so the new files were created with the
Write tool; (b) the Brownlow artefacts were copied read-only from the retained DEV-host workspace `/home/arm/afldb-v2-brownlowverify-20261028`
(`xfer/` and `identity.sql`), which I read as a retained workspace; nothing there was written; (c) single-file groups ran without the heavy
lock (the brief lists restore, rebuild, full-suite and build as heavy); `oracle6`, the template restore and B1 took the lock; (d) one
`pkill -f` of mine matched its own ssh shell (the known trap); it killed only my queue's lock-waiting child, nothing of another scope;
(e) first OD-5 filter attempt skipped everything (section 6) and is kept as evidence.

## 10. Evidence layout (all under this directory)

- `ids.tsv`: the 53 ids (52 from `run2/qualification-2/integ-failures.tsv` + the war-years id), intended condition, what was run, provisional class.
- `evidence/a/`: phase A experiments: vitest JSON (`*.json.gz`), logs with ANSI stripped and any `postgres://` line removed (`*.log.txt.gz`), state and
  precondition aggregates (`mech*-state-*.txt`, `awards-aggregates.txt`, `de-precondition.txt`, `issue276-conflict.txt`), `verdicts-snapshot-probe.tsv`,
  `runner-dryrun.txt`, `phaseA.log.txt`, `queue.log.txt`, `setup.log.txt`, `tmpl-probe.txt`.
- `evidence/brownlow/`: the two dedicated-clone suites (B2 and B1 JSON/logs, template TOC and use-list, restored template identity, migrate/privileges logs, retained-artefact hashes).
- `evidence/host-scripts/`: the exact helper scripts that ran on the host (`setup.sh`, `phaseA.sh`, `queue*.sh`, `coleschema.sh`, `brownlow.sh`, `dryrun.sh`, `actq.sh`).
- `evidence/SHA256SUMS`: sha256 of every file under `evidence/`. Verify a committed file with `git cat-file blob HEAD:<path> | sha256sum`.
- Raw per-run vitest JSON for the oracle file group is `evidence/a/oracle6-snapshot.json.gz`; the Brownlow B1 JSON is `evidence/brownlow/b1-production-correction.json.gz`.
