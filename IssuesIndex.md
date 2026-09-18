# AFLDB Current Issues Index

> Lightweight session index of open issues only.
>
> `issues.md` is the authoritative detailed ledger.

**Open issues:** 5

### AFLDB-ISSUE-220 — Web service credential boundary contradicts the application's `afldb_import` requirement; owner-role code-test DSN and a complete `.env` copy reach the internet-facing process
- **Severity:** High. **Area:** deployment / runtime security.
- **State:** Open (2026-09-17). Implemented in worktree `afldb-issue-220` (Sonnet 5, uncommitted),
  pending operator DEV/PROD verification. §4b established: `writeStandaloneDirectory` in the
  installed Next 16.3.1's own `next/dist/build/index.js` copies `.env`/`.env.production` into
  `.next/standalone/` unconditionally, in a hardcoded loop with no `next.config.ts` knob to
  suppress it — `next.config.ts` correctly left untouched. `deploy/afldb.service` now unsets
  `AFLDB_OWNER_DATABASE_URL AFLDB_TEST_DATABASE_URL AFLDB_TEST_IMPORT_DATABASE_URL
  AFLDB_TEST_AUTH_DATABASE_URL AFLDB_CODE_TEST_DATABASE_URL AFLDB_CODE_TEST_IMPORT_DATABASE_URL
  AFLDB_BACKUP_DATABASE_URL AFLDB_PROD_DATABASE_URL` and keeps exactly `DATABASE_URL`,
  `AFLDB_AUTH_DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL`; `tools/build/prepare-standalone.mjs`
  now deletes any `.env*` under the standalone tree and fails the build if one survives; new
  `tests/deploy-web-unit.test.ts` derives the full DSN name set from `.env.example` (found
  `docs/deployment.md`'s §9 table was itself missing 5 real DSN names — completed it rather than
  deriving from the incomplete table, see `issues.md` Implementation section). PROD still not
  inspected.
- **Key files:** `deploy/afldb.service`, `docs/deployment.md` §9, `tools/build/prepare-standalone.mjs`,
  `tools/build/env-in-standalone.mjs` (new), `tests/deploy-web-unit.test.ts` (new).
- **Local validation (2026-09-17):** `vitest run tests/deploy-web-unit.test.ts` **15/15 passed**;
  `tsc --noEmit` **clean**. DEV/PROD not yet run.
- **Next action:** operator runs the Git/DEV rollout (commit → `merge:ready` → push/merge → `sync-dev.ps1`
  build → manual unit reinstall + restart → names-only checks + Admin Centre write/revert), then PROD
  read-only checks. Resolve only once DEV steps 1–5 and PROD steps 2–3/6 (runbook §8/§9) pass.

### AFLDB-ISSUE-222 — Trusted draft-player linking: DraftGuru Stage B3 person-page acquisition and the person-page bridge into `draft_persons` / `draft_picks`
- **Severity:** High. **Area:** data acquisition / import — `tools/rebuild/draftguru/`,
  `tools/db/rebuild-test.ts`. Successor to `AFLDB-ISSUE-164` D-9 / `AFLDB-ISSUE-093` Stage B3
  (neither reopened; D-9 unchanged), per `AFLDB-ISSUE-221`'s follow-up.
- **State:** Open (2026-09-18). Phases 1–3 each separately authorised and executed (see below).
  **Phase 3 operator adjudication of the 83-row pack COMPLETE and independently validated
  (2026-09-18)** — 81 rows bridge-v2 eligible, 2 withheld (`different_person_wrong_href`); see
  `AFLDB-ISSUE-222.md` §11.13, `issues.md`. **The bridge v2 SOURCE-EVIDENCE parent was generated
  DB-free on 2026-09-18** (§11.14; 3,564 → 3,562 accepted, 1,493 → 1,495 withheld over 5,057
  persons). **The v2 `afldb_test` deployment child was resolved read-only by the operator on
  2026-09-18** (3,468 accepted / 1,589 withheld; §11.15). **Phase 3 acceptance itself remains
  PENDING** — the child's independent DB-free validation has not yet been run, and the disjoint
  new-salt validation sample (Phase F) has not been generated;
  no database import has occurred and `afldb_test`/DEV/PROD are unchanged. Phase 4 (rebuild integration) is not authorised until Phase
  3 acceptance passes. Runbook `AFLDB-ISSUE-222.md` (revision 2). Phase 1 implemented
  in worktree `afldb-issue-222`
  (Sonnet 5, uncommitted): new `stage_b3_population.py` (whole-population sample) and
  `export_person_bridge.py` (`--source-evidence`/`--resolve-against`/`--review-sample`); the
  contract's new `person_stage.b3` block; `profile_person_pages.py`/`acquire_persons.py` extended
  for the B3 shape and the §2.6 by-year/top-10 failure breakdown; `rebuild-test.ts` threads an
  optional `--draftguru-bridge` through preflight, the data stage and FINAL VALIDATION;
  `gridley-corpus.test.ts` gained the scoring-only `AFLDB_GRIDLEY_SCORE_DRAFT=1` override. No
  network request made; no DEV/PROD write; no `apply_authority()`/D-9 change.
- **Key files:** `tools/rebuild/draftguru/{draftguru-contract.json, stage_b3_population.py (new),
  export_person_bridge.py (new), profile_person_pages.py, acquire_persons.py}`,
  `tools/db/rebuild-test.ts`, `tests/integration/gridley-corpus.test.ts`,
  `tests/draftguru-acquisition.test.ts`, `tests/db-test-rebuild.test.ts`,
  `tests/integration/draftguru-import.test.ts`.
- **Local validation (2026-09-18, closed out):** the accepted Stage A DraftGuru snapshot was
  located on `streamanator`, sha256-verified against the tracked manifest (42/42 pages, 0
  mismatches), copied into this worktree and re-verified byte-exact locally, as separately
  authorised (not a fresh acquisition). `npx vitest run tests/integration/draftguru-import.test.ts`
  (session-only DSN port override to the existing 55432 tunnel, `.env` unchanged, no credentials
  printed) then ran for real against `afldb_test`: found and fixed one bug in this issue's own new
  test (wrong expected HALT-message substring — the importer's actual behaviour was already
  correct), then **24/24 passed, 0 failed, 0 skipped** — bridge propagation, idempotency,
  unregistered-target handling on both the importer's own HALT and
  `export_person_bridge.py --resolve-against`, human-decision precedence, and rollback/audit
  behaviour all genuinely confirmed by execution. `afldb_test` reconfirmed settled back to its
  exact baseline afterward. DB-free suites moved to **174 passed / 3 skipped / 178 total** (the 3
  skips need artefacts not authorised for this pass — `full-history-20260826` /
  `person-html-20260826` — still pre-existing, still not B3-specific); `tests/db-test-rebuild.test.ts`
  293/293; `tsc`/`eslint` clean. AFLDB-ISSUE-223 unaffected. **Phase 1 gate: satisfied.**
- **O-1/O-2/O-3 decided 2026-09-18** (n = 598 random stratum + full census; no importer change;
  2%/5%/any-top-10 stop conditions — the latter two already match Phase 1's implemented
  defaults). **Phase 2 authorised, narrowly:** exactly one new whole-population acquisition run;
  no database import, DEV/PROD write, deployment, or Phase 3+. Handoff:
  `AFLDB-ISSUE-222-PHASE2-HANDOFF.md`.
- **Phase 2 executed 2026-09-18** (label `person-html-20260918`): fetch layer completed
  5,057/5,057, 0 failures; post-fetch aggregation then crashed (`KeyError: 'residual_input'` — a
  pre-existing Phase 1 gap: `aggregate()`/`build_manifest()` unconditionally read Stage B1-only
  `sample.json` fields absent from Stage B3's). Fixed same day (both functions now stage-aware; 4
  new regression tests; B1 output unchanged); aggregation resumed with zero network requests.
  Manifest written, both O-3 conditions pass clean (0% failures; no year/top-10 concentration).
  AFL Tables coverage 3,564/5,057 (70.48%); Wikipedia coverage 1,943/5,057 (38.42%).
- **Phase 3 executed 2026-09-18** (derivation + `afldb_test` resolution + reconciliation): parent
  bridge 3,564/1,493 (0 collisions); `afldb_test` deployment child 3,463 bridges/1,594 withheld
  (101 `target_not_registered` — 6 AFL Tables numeric-disambiguation, 2 spelling/name-change found
  by an untracked fuzzy search, `stephen_schwerdt/1` a likely third spelling case, the rest
  concentrated in 2023–2025; **"registration lag" retired 2026-09-18** — an offline measurement
  found 0 of the 101 paths appear in the accepted fitzRoy snapshot's 13,275-URL set while all
  3,463 bridged paths do, so "not registered" means no appearance in the accepted 1897–2025
  source, not `afldb_test` staleness). Person-level 5,057 reconciled exactly (`B-linked` 3,460 +
  3 agreeing human-decision rows = the 3,463 bridged, asserted separately); top-10 420/418 at
  92.62% projected coverage, 0 unexplained finding. §3.5 review sample generated (399 census + 598
  random, disjoint); an automated read-only cross-check (name + age/DOB, no external fetch) found
  0 genuine contradictions across all 997 sampled persons.
- **Independent review 2026-09-18 (Fable):** datasets reproduce exactly and are sound; evidence
  corrections required before review — importer will apply **3,460** net-new links (not 3,463;
  three agreeing human-decision rows), exporter/importer target-resolution divergence, residual
  "registration lag" narrative not reproducible, verdict-storage contradiction. Spec:
  `AFLDB-ISSUE-222-PHASE3-CORRECTION-HANDOFF.md`.
- **Decision O-4 revision 2 (2026-09-18, prospective; revision 1 "Playwright for all 997"
  superseded before execution, never run):** retained fitzRoy/AFLDB evidence is checked **first** —
  all 997 immutable sample rows compared offline against the captured DraftGuru snapshot, the
  accepted fitzRoy `full-history-20260902` snapshot (bytes retained off-tree in the operator's
  backup root, hash-match 131/131) and the `afldb_test` registered identities; operator reviews every
  exception plus a deterministic 30-row audit. **Live AFL Tables acquisition is not authorised**
  (residual reported first, new authorisation required); Playwright is an exception tool only.
  Measured: 969/997 rows join to retained facts with three signals beyond name; 28 are
  `target_not_registered`, and 0 of the 101 such paths appear in the snapshot's 13,275-URL set
  ("not in the accepted 2025 baseline", not lag). Contract: `AFLDB-ISSUE-222-OFFLINE-REVIEW-RUNBOOK.md`.
- **Corrections implemented, offline comparison executed 2026-09-18 (Sonnet 5, High; uncommitted):**
  handoff §6 A–K corrections implemented (exporter/importer match-method + count alignment, an
  `admissibility_reason()` conjunct gap, seven regression tests, DB-free `--validate-only` run on
  the real child, acceptance-arithmetic and "registration lag" documentation corrections); new
  `tools/rebuild/draftguru/review_person_bridge_offline.py` built and run twice over all 997 real
  sample rows with identical `rows_sha256`: `offline_strong` 959, `offline_limited` 1,
  `offline_contradict` 9 (2 predicted birth-year conflicts + 7 new career-ended-before-recruitment
  veteran-redraft findings), `target_unregistered` 28 (exactly as predicted), 0
  unavailable/tooling-error. Verdict/recheck/residual artefacts written
  (`docs/rebuild-manifests/draftguru/bridge-review-{verdicts,recheck,residual}-20260918-v1.*`); 112
  distinct rows need operator recheck; the 30-row audit is drawn and recorded. DB-free tests: 191
  total (187 passed, 1 pre-existing `AFLDB-ISSUE-223`, 3 skipped); `tsc` clean. No database,
  network, Playwright, import, DEV/PROD or Git action. Full record: `AFLDB-ISSUE-222.md` §11.8,
  `issues.md`.
- **Recheck analysis and tool correction 2026-09-18 (Sonnet 5, High; uncommitted):** found and
  fixed a tool defect (`implied_birth_year` trusted a literal `Age="0"` fitzRoy source-data
  sentinel; population check found 10/3,564 bridged identities affected, 2 in-sample); reran the
  997-row comparison twice with identical `rows_sha256` — totals now `offline_strong` 960,
  `offline_limited` 2, `offline_contradict` 7, `target_unregistered` 28 (v2 artefacts; v1 retained
  as superseded evidence). Analysed all 111 v2 recheck rows and wrote a reviewer sign-off pack
  (`bridge-review-signoff-20260918-v1.{md,csv,json}`) with a recommended verdict and reason per
  row: `agree` 76, `withhold` 24, `contradict` 7 (all `CAREER_ENDED_BEFORE_EARLIEST_RECRUITMENT`;
  **this sign-off pack's characterisation of these 7 as "confirmed genuine DraftGuru-side mislinks"
  is WITHDRAWN by the 2026-09-18 independent review below — they are 7 of the 44
  `relisting_signature_review` rows, requiring operator adjudication, not confirmed mislinks**),
  plus 4
  `source_discrepancy_same_person` (3 numbering + Schwerdt, strongly evidenced beyond name but
  routed to operator curation, not auto-applied). No `operator_verdict` set on any row.
- **Population-wide offline mislink scan 2026-09-18 (Sonnet 5, High; uncommitted).**
  **`confirmed_source_mislink` (23) WITHDRAWN — see the correction bullet below.** Scanned all
  **3,564** parent bridge candidates with a new
  `tools/rebuild/draftguru/scan_person_bridge_population.py` (v1.0.0, superseded by v2). Found and
  fixed an inert-on-sample ledger-agreement bug (`TOOL_VERSION` → 1.0.2; sample `rows_sha256`
  reproduced byte-identical). v1 artefacts
  (`docs/rebuild-manifests/draftguru/bridge-population-scan-20260918-v1.{json,csv,md}` + manifest)
  preserved unchanged as superseded evidence. Full record: `AFLDB-ISSUE-222.md` §11.9, `issues.md`.
- **Population-scan decision pack completed 2026-09-18 (Sonnet 5, High; uncommitted).**
  **The `~0.51%`/588-clean-survivor statistical claim in this pack is WITHDRAWN — see the
  correction bullet below.** v1 pack
  (`docs/rebuild-manifests/draftguru/bridge-population-scan-decision-pack-20260918-v1.{md,csv,json}`)
  preserved unchanged as superseded evidence. No file was renamed or deleted
  (`docs/rebuild-manifests/draftguruff-20260918-v1.md` never existed under any name; the earlier
  reference to it was a malformed string).
- **Independent statistical review, scanner correction, operator adjudication pack 2026-09-18
  (Fable 5.1 review; Sonnet 5, High correction; uncommitted).** Independent review found
  `confirmed_source_mislink` invalid (DraftGuru's per-entry games figure means games following that
  listing, not career games; Stage A's listed age agrees with the retained birth year on all 23
  rows) and found 21 further rows sharing the identical shape that v1 had called
  `population_clean` only because of an arbitrary one-year career-ended/recruitment boundary.
  Corrected scanner (`SCANNER_VERSION` 2.0.0): removed `confirmed_source_mislink`; added
  `relisting_signature_review` (44 rows = 23 former + 21 companions, one neutral class, uniform
  regardless of which side of the old boundary a row fell on). Reran twice, identical
  `rows_sha256` `ad134d14…` (v1's `ddd5faba…` re-verified unchanged): `population_clean` 3,401,
  **`relisting_signature_review` 44**, `suspected_source_mislink` 2, `source_discrepancy_same_person`
  7, `insufficient_evidence` 107, `human_authority_overlap` 3, `tooling_or_schema_error` 0 (sums to
  3,564). The `~0.51%` bound is withdrawn for two reasons: circularity (bounds the same rule it
  measures) and an arithmetic error (the "588" denominator never subtracted 13
  `insufficient_evidence` random-stratum rows; the true v1-label clean-survivor count was 575, not
  588). No formal residual bound exists. Corrected artefacts:
  `bridge-population-scan-{20260918-v2.json,20260918-v2.csv,manifest-20260918-v2.json,
  signoff-20260918-v2.md,decision-pack-20260918-v2.{md,csv,json}}`; new operator adjudication pack
  `bridge-operator-adjudication-pack-20260918-v1.{md,csv,json}` (44 relisting + 2 tokenisation + 7
  discrepancy + 30 audit rows, every `operator_verdict` blank). Also corrected: a redraw-salt
  conflict between `AFLDB-ISSUE-222-PHASE3-CORRECTION-HANDOFF.md` §7 gate 9 and §3.5 item 4 (§3.5
  item 4's new-salt rule governs). Full record: `AFLDB-ISSUE-222.md` §11.11, `issues.md`.
- **Next action:** the §3.5/§6.5 gate is **PENDING**. The operator works
  `bridge-operator-adjudication-pack-20260918-v1.md` (44 relisting-signature + 2 tokenisation + 7
  source-discrepancy + 30-audit rows) alongside the existing 997-row recheck queue and the
  `bridge-population-scan-decision-pack-20260918-v2.md` §10 decision table (relisting adjudication +
  2 suspected + 7 source-discrepancy + 107 insufficient + 3 human-authority dispositions, whether an
  independent review is required before bridge v2, and sample redraw/top-up policy), decides
  whether/how to generate a corrected bridge v2 parent/child, sets `operator_verdict` on every
  mandatory recheck row, and confirms the 30-row audit. Separately, a future DB-enabled session
  determines whether the exporter/importer alignment changes the generated `afldb_test` child's
  contents (untestable without a database) and may run the tracked read-only registration extract
  for `players.id` values. **No database import, DEV/PROD or Phase 4 action is authorised.** See
  `issues.md` for the full record.
- **Local operator-adjudication GUI helper built 2026-09-18 (Sonnet 5, High; uncommitted).** New
  `tools/rebuild/draftguru/review_bridge_operator.py` (Tkinter, dependency-free) lets the operator
  work the 83-row adjudication pack without hand-editing JSON: read-only against the pack and its
  hash-linked inputs, sets no verdict itself, checkpoints atomically under gitignored
  `data/review/draftguru-bridge-operator-20260918-v1/`, and on finalisation writes
  `docs/rebuild-manifests/draftguru/bridge-operator-verdicts-20260918-v1.{json,csv,md}`. Launch:
  `python tools\rebuild\draftguru\review_bridge_operator.py` (discovered interpreter
  `C:\Users\stuar\AppData\Local\Programs\Python\Python312\python.exe`; no `.venv` present in this
  worktree). New test `tests/python/draftguru_bridge_operator_review_contract.py`. **No operator
  verdict entered; GUI not launched by this pass.** Full record: `AFLDB-ISSUE-222.md` §11.12,
  `issues.md`.
- **Operator adjudication COMPLETE and independently validated (2026-09-18, operator).** All 83
  rows of the adjudication pack decided and independently verified (`py_compile`, the complete
  DraftGuru operator-review contract suite, `--validate-final-output` — all PASS). 81 rows
  bridge-v2 eligible; 2 withheld as `different_person_wrong_href` (Craig Somerville, David
  Sullivan). Bridge v2, target-resolution rerun and the disjoint new-salt validation sample
  (Phase F) are **not** done; no database import; `afldb_test`/DEV/PROD unchanged. Full record:
  `AFLDB-ISSUE-222.md` §11.13, `AFLDB-ISSUE-222-PHASE3-CORRECTION-HANDOFF.md` §13, `issues.md`.
- **Bridge v2 source-evidence parent generated 2026-09-18 (DB-free, operator-executed;
  uncommitted).** New `tools/rebuild/draftguru/build_person_bridge_v2.py` + DB-free contract
  `tests/python/draftguru_bridge_v2_contract.py` applied the 83 verdicts to the frozen v1 parent:
  population 5,057, accepted 3,564 → 3,562, withheld 1,493 → 1,495, unchanged 3,481, confirmed 74,
  corrected 7, removed/withheld 2, added 0, unaccounted 0 — the net accepted change is **−2, not
  +81**. Operator reported `py_compile`, the bridge-v2 contract and the four existing contracts all
  PASS, `--write` then a second `--write` reporting all six artefacts `identical`, and independent
  `Get-FileHash` agreement. Parent `ad25d965…`, `rows_sha256` `ce7816f7…` (all seven hashes in
  `issues.md` / §11.14). `child_status = "requires --resolve-against afldb_test"`; **no child
  artefact exists**, the 7 corrected targets have never been measured against a database, and the
  2 rejected identities are absent from `bridges[]`. Full record: `AFLDB-ISSUE-222.md` §11.14,
  `AFLDB-ISSUE-222-PHASE3-CORRECTION-HANDOFF.md` §14, `issues.md`.
- **Resolver safeguards added 2026-09-18 (not yet exercised):** `export_person_bridge.py`
  `--resolve-against` now refuses a `kind: "deployment"` input and refuses to overwrite `--parent`
  or an existing `--out` without `--allow-overwrite`; `draftguru_bridge_resolution_contract.py`
  gains an AST proof that every executable SQL statement is a SELECT, nothing commits, and the one
  `connect()` forces `default_transaction_read_only=on`.
- **v2 `afldb_test` child resolved 2026-09-18 (operator-executed, read-only; uncommitted):**
  sha256 `b996c60e…`, accepted 3,468 / withheld 1,589 / 5,057, registration 13,275. File-level
  reading agrees with the expected transition (7 corrected in, 2 rejected withheld, 101 → 94
  `target_not_registered`); **the per-row proof is not yet run.** Prepared, not executed:
  `tools/rebuild/draftguru/validate_person_bridge_child.py` (read-only DB-free validator),
  `tools/rebuild/draftguru/build_validation_sample.py` (Phase F, salt `AFLDB-ISSUE-222/v2`,
  `n = 598`, gated on the validator), two `tests/python/` contracts + vitest wiring. Decisions
  O-5/O-6/O-7 in `AFLDB-ISSUE-222.md` §11.15.
- **Child validated and Phase F sample generated 2026-09-18 (operator-executed; uncommitted):**
  real child validation passed twice (`summary_sha256` `5bc5336b…`), importer `--validate-only`
  passed DB-free, and `build_validation_sample.py --write` produced
  `bridge-validation-sample-20260918-v2.{json,csv}` (`6523bad6…` / `afa2b917…`, `rows_sha256`
  `91be2942…`; n 598, frame 2,529, 582 bridged + 16 `target_not_registered`, zero overlaps) under
  O-5/O-6/O-7. The sample is UNREVIEWED. Prepared, not run: `review_validation_sample.py`
  (Phase F machine review, v1 rules imported verbatim), `validate_validation_review.py` (final
  validator/acceptance), contract + vitest wiring. Record: `AFLDB-ISSUE-222.md` §11.16–§11.17.
- **Phase F machine review generated and validated 2026-09-18 (operator-executed; uncommitted):**
  `bridge-validation-verdicts-20260918-v2.{json,csv}` (`2caf980b…` / `d2a5c336…`), recheck
  `3e509021…`, residual `d20a3c6f…`, `rows_sha256` `14d918a1…`; 578 strong / 4 limited / 16
  `target_unregistered` / 0 contradict; 39 mandatory + 30 audit = 69 required rows (O-9 confirmed).
  `validate_validation_review.py` clean, `summary_sha256` `7657fd85…`, exit 2 (pending: 69/69
  rows lack an operator verdict). Built, not run: `tools/rebuild/draftguru/review_validation_operator.py`
  (DB-free operator-adjudication GUI over the 69 rows, checkpoint under
  `data/review/draftguru-validation-operator-20260918-v2/`), contract
  `tests/python/draftguru_validation_operator_contract.py` + vitest wiring. Record:
  `AFLDB-ISSUE-222.md` §11.18.
- **Phase F ACCEPTED (2026-09-18, operator-reported; uncommitted):** operator artefact
  `bridge-validation-operator-verdicts-20260918-v2.json` `b8cf98bb…`; final validator
  `summary_sha256` `63c89265…`, ACCEPTANCE: ACCEPTED — 598 rows, 582 identity-evaluable, 16
  `target_not_registered` terminally withheld, 69/69 verdicts `agree`, 0 contradict, 0
  undetermined, 0 failures; one-sided 95% upper error bound 0.4997% (n 598) / 0.5134% (n 582).
  O-8 resolved by the run as recheck+audit coverage. Deployment child unchanged (`b996c60e…`,
  3,468 / 1,589). Importer `--validate-only` passed, no database contacted.
- **Pre-import assessment and gates BUILT, not run (2026-09-18, Fable 5.1):** code-level
  import-scope/rollback review recorded in `AFLDB-ISSUE-222.md` §11.19; importer commit-order
  correction (`analyze()` moved after the batch block so data + `completed` status commit
  together) with `tests/python/draftguru_import_atomicity_contract.py`; read-only
  `tools/rebuild/draftguru/bridge_import_gate.py plan|verify` (`afldb_test` only, SELECT only,
  replays `apply_authority()`, fail-closed classification, ordered content hashes) with
  `tests/python/draftguru_import_gate_contract.py`; `tools/maintenance/backup-afldb-test.ps1`.
  The 16 sampled / 94 child `target_not_registered` rows are tracked separately as
  `AFLDB-ISSUE-224`.
- **`afldb_test` import COMPLETE and verified twice (2026-09-19, operator-executed; uncommitted):**
  backup `afldb_test-20260919-051022.dump` (`aa4f1cac…`, catalogue-readable, not restore-proven);
  plan `966897b9…` (`import_batches` 191 before the dry-run, 192 after it, 193 after the
  import); import as `afldb_import|afldb_test`, authority ledger 6 /
  bridge 3,465 / unmatched 1,587 / seeded 0; verify `32cf72a5…` VERIFY: OK — 3,470 linked
  persons, 5,115 linked picks (75.11%), `unique|bridge` 3,465, `resolved|ledger` 5, zero
  remaining changes, 1,589 withheld unlinked, rejected identities absent, baseline unchanged.
  **Phase 3 accepted on evidence pending the operator's commit; Phase 4a database acceptance NOT
  yet satisfied** (§6.1 pick level, §6.2, §6.3, remaining §6.4, §6.8 items 2–4, §7.4 outstanding).
  No DEV/PROD action. Record and decisions: `AFLDB-ISSUE-222.md` §11.19.9.
- **Read-only validation run (2026-09-19, operator, no write):** SQL checks PASS;
  `draft-linkage.test.ts` 10/11 — six draft builders and the ISSUE-221 cell populated (388); the
  one failure was a query fan-out onto the second registered path of the four ISSUE-136
  renumbered players (same humans, tracked rules), not a wrong link — corrected in test code with
  a DB-free regression (`tests/draft-linkage-invariants*.ts`); Gridley corpus not yet run.
  Record: `AFLDB-ISSUE-222.md` §11.19.10.
- **Gridley corpus run (2026-09-19, operator, read-only, no write/rollback):** 1,163/1,166;
  report sha256 `7f14ff2c…`. Three failures: two 2026 embedded players unresolved (an ISSUE-224
  register gap the resolver reported as an override mismatch — corpus defect, corrected in test
  code with a DB-free pin), bridges 399/401 (same two), and **99 `incorrect known answer` cells
  pending triage decisions** = 62 draft cells on nine linked players (Brad Crouch 2054 ×39: his
  2011 Mini-Draft pick 2 vs Gridley's "National Draft" TOP 5/10 — Gridley's key; eight
  `pickrookie` players ×23: no Rookie row on their linked DraftGuru pages — source coverage gap
  or Gridley's key, not link/vocabulary/builder) + 37 pre-existing non-draft cells on 14 players
  (2026-09-17 residue). No category reclassified; triage evidence now appended to draft
  findings. **Phase 4a still pending.** Record: `AFLDB-ISSUE-222.md` §11.19.11.
- **Decisions 2026-09-19 (§11.19.12):** D1 approved narrowly — Crouch's 39 cells become an
  evidence-keyed Gridley-key `external source disagreement` (one rule, row named, national
  semantics untouched, DB-free pinned). D2 pending — eight rookie cases unclassified; review pack
  `docs/rebuild-manifests/draftguru/rookie-relisting-independent-review-20260919-v1.md` (no
  network used; citations to be filled). D3 — the 37 non-draft cells are now AFLDB-ISSUE-225.
  D4 completed — read-only query confirmed: max match season 2026, max debut season 2025, no NBSP
  names, no player rows and no AFL Tables identities for Jagga Smith / Willem Duursma
  (ISSUE-224 registration gap; encoding excluded). Full corpus not rerun. Phase 4a pending.
- **D2 completed (2026-09-19, Sonnet 5, §11.19.13):** all eight `pickrookie` players
  independently confirmed **Gridley supported** (six primary AFL/club sources; Davis and Gibbs on
  reputable secondary sources, flagged; Rischitelli's pick number secondary-only) — review pack
  verdicts filled in. Implemented as a per-person tracked outcome artefact
  (`data/players/rookie-relisting-outcomes.csv`, keyed by AFL Tables profile) and one pure,
  evidence-keyed rule (`rookieSourceCoverageGap`, `tests/gridley-corpus-support.ts`) firing only
  for a reviewed `gridley_supported` player on `draft_type_is(rookie)` with triage cause
  `no_linked_row_matches` — no name/id hard-coded, no general rule, D1 unaffected. Wired into
  `tests/integration/gridley-corpus.test.ts` as `source coverage gap` (still `DATA_GAPS`, fails
  strict). Seven new DB-free tests pin the required properties. `tsc`/vitest (42/42)/eslint clean.
  No Git/DB/import/full-corpus command run; §7.4 not touched.
- **Full corpus rerun (2026-09-19, operator-reported, read-only; verified by direct inspection,
  `AFLDB-ISSUE-222.md` §11.19.14):** `incorrect known answer` 99 → **37**, exactly the
  AFLDB-ISSUE-225 cells (confirmed record-for-record: `captain` 20, `teammates-150` 14,
  `teammates-100` 1, `games250sameclub` 1, `games100clubs2` 1), zero draft-criterion cells
  remaining; `source coverage gap` 77, `external source disagreement` 422, `dataset gap` 48,
  `parse` 0 — all exactly as projected. Report sha256 `659e29ed…` (size/hash not yet independently
  recomputed; operator command pending). **§7.4 scope decision:** belongs to Phase 4a
  (`afldb_test` rebuild + rollback, gates Phase 4b DEV/PROD), not to Phase 3 (trusted-linkage
  import, already complete and now corpus-proven) — deferred with the rest of Phase 4a, not
  required for this closure. No DB write/rollback/Git action this pass.
- **Current state:** core trusted-linkage corpus gate satisfied. **Kept Open** — not marked
  Resolved, since the standard lifecycle (commit → `merge:ready` → push/merge → `sync-dev.ps1` →
  DEV smoke → close) has not run; everything remains uncommitted.
- **Next action:** operator reviews and commits the reviewed local change, then
  `npm run merge:ready -- --issue 222`. **Correction (2026-09-19):** DEV promotion is now
  authorised for this pass, so §7.4 (the `afldb_test` S0–S3 rollback exercise) is required
  before the `afldb_dev` import step — it is no longer deferred. Remaining Phase 4a items
  (§6.1 pick level, §6.2, remaining §6.4, §6.8 items 2–4) stay deferred; PROD stays out of scope.
  AFLDB-ISSUE-226/227 do not exist in this repository and are not blocking.
- **§7.4 exercise defined; DEV gate generalised (2026-09-19, Sonnet 5, §11.19.15, uncommitted).**
  The exact operator command sequence for §7.4 on `afldb_test` (two load/reverse cycles, `psql
  \copy` snapshots via the new `tools/rebuild/draftguru/s74-snapshot.sql`, `Compare-Object`
  diffing) is written up but **not executed** by the model. `bridge_import_gate.py` now takes
  `--target {test, dev}` (default `test`, unchanged); `dev` reads a new, dedicated
  `AFLDB_DEV_DATABASE_URL`, requires `afldb_dev`, has no default `--bridge`, and refuses reuse of
  the `afldb_test` child. DB-free validation (`py_compile`, the extended import-gate contract, the
  affected vitest specs including the ISSUE-220 credential-boundary suite after the new DSN was
  added to `.env.example`/`docs/deployment.md`/the three service units' `UnsetEnvironment=`) all
  pass. No DEV child was generated; no database, Git, network or deployment command ran.
- **Sequencing/terminology correction (2026-09-19, Sonnet 5, second pass, documentation only).**
  The operator sequence above put `sync-dev.ps1` before the DEV child was generated and before
  the real DEV import/verify. Corrected order (full detail `AFLDB-ISSUE-222.md` §11.19.15 item 6):
  commit tooling checkpoint → §7.4 on `afldb_test` → record evidence → generate/validate DEV child
  (pre-merge, read-only) → final pre-deployment commit (DEV child + §7.4 evidence) →
  `merge:ready` → merge/push → fresh `afldb_dev` backup → DEV validate-only/dry-run → DEV
  read-only plan (capture hashes + `import_batches_before`) → real DEV import → two independent
  DEV verifies → **only then** `sync-dev.ps1` → smoke → separate closure commit. Also made
  explicit which of S0/S1/S2/S3 is the reconstructed pre-bridge state vs. the backed-up
  post-import starting state, and removed a manual build/restart step duplicating `sync-dev.ps1`.
  No code, test, artefact or database touched.
- **§7.4 exercise/runbook correction — not yet safe to run (2026-09-19, Sonnet 5, third pass).** A
  reviewer stopped the prior operator command block before any database command ran: missing
  `--no-seed`, wrong snapshot/plan order, guessed `--expect-batches-before` instead of each run's
  own printed value, and text-diff instead of fail-closed SHA-256 comparison. Fixed with a new,
  small, tracked script, `tools/rebuild/draftguru/s74-rollback-exercise.ps1` (syntax-checked, not
  executed); full detail `AFLDB-ISSUE-222.md` §11.19.15 item 2. Tooling checkpoint now committed
  (`5987ac2e`); earlier "uncommitted" statements in that section are historical record only. No
  database, Git, network or deployment command ran; the exercise remains not run.
- **`-WhatIf` preflight fix (2026-09-19, Sonnet 5, fourth pass).** `-WhatIf` correctly suppressed
  directory creation and passed the read-only guards, but then invoked a bare `pwsh` for the
  backup, which is not installed on this workstation -- it failed safely only by accident. Fixed:
  new `-PowerShellExe` parameter (edition-defaulted, required to exist), backup invoked through
  it, and an explicit `$WhatIfPreference` early exit moved to immediately after the connection
  guards, before the backup. New static regression `tests/s74-rollback-exercise-static.test.ps1`
  (AST-only, verified to fail against the reintroduced bug). Full detail
  `AFLDB-ISSUE-222.md` §11.19.15. No database, Git, network or deployment command ran.
- **First real §7.4 attempt stopped safely, before confirmation/mutation (2026-09-19).** Backup
  and baseline plan succeeded (batch count 193, four hashes recorded); `Read-GatePlanValues` then
  crashed binding blank gate-output lines to a mandatory `[string[]]` parameter. No importer ran;
  `afldb_test` unchanged at 193. Fixed: a new `Get-GateParseLines` helper filters only the parsing
  copy (never the transcript); `Get-GateValue` also now refuses a duplicated key. New DB-free
  regression `tests/s74-rollback-exercise-gate-parsing.test.ps1` (AST-extracted functions only,
  realistic blank-line fixtures, missing/duplicate/all-blank refusal proofs). Evidence directory
  `s74-20260919-issue222-final` and the backup dump preserved untouched; next attempt needs a new
  `-Label`. Full detail `AFLDB-ISSUE-222.md` §11.19.15. No database, Git, network or deployment
  command ran during the fix.

### AFLDB-ISSUE-225 — Gridley corpus: 37 pre-existing `incorrect known answer` cells on non-draft criteria, present on `afldb_test` before AFLDB-ISSUE-222 and untouched by it
- **Severity:** Medium. **Area:** Grid Solver / canonical data — `captaincies`,
  `player_club_season_stats`, club lineage; `tests/integration/gridley-corpus.test.ts`.
- **State:** Open (2026-09-19, ISSUE-222 decision D3). 37 cells, all "Gridley lists, AFLDB
  omits", identical in the 2026-09-17 pre-import run and the 2026-09-19 run (report
  `7f14ff2c…`): `captain` 20 (Cameron Bruce 2489 ×11, Steven May 12093 ×9), `teammates-150` 14
  (ten players, board #1024), `teammates-100` 1 (Angus Brayshaw 669), `games250sameclub` 1
  (David Swallow 3581), `games100clubs2` 1 (Dylan Shiel 4006). ISSUE-118 closed at 0; the cells
  arrived with the 2026-09-13 `afldb_test` baseline. Root cause not investigated; not a draft
  matter.
- **Key files:** `src/db/queries/grid-solver.ts` (`club_captain_any`, `career_teammates_min`,
  `games_at_*_incl_merged`), `captaincies`, `player_club_season_stats`, the corpus suite.
- **Next action:** targeted read-only queries on `afldb_test` (captaincies rows for 2489/12093;
  teammate recounts for the board-1024/993 players; lineage for 3581/4006), then classify each
  cell from canonical evidence — never by a blanket exception.

### AFLDB-ISSUE-224 — DraftGuru persons whose AFL Tables identity is not registered on the target (`target_not_registered`): post-baseline debutants and numbering/spelling cases cannot link until the identity is registered
- **Severity:** Medium. **Area:** player registration / import — `external_identities`
  (`afltables`, `afltables_profile_url`), fitzRoy core acquisition, current-season settle;
  `tools/rebuild/draftguru/export_person_bridge.py --resolve-against`.
- **State:** Open (2026-09-18, deferred from AFLDB-ISSUE-222 Phase F). 94 bridge-admissible v2
  parent persons are withheld `target_not_registered` in the `afldb_test` child (16 of them in the
  Phase F sample, all operator-verdict `agree`, terminally withheld; none may be added by the
  ISSUE-222 import). Measured (handoff §10.3): 0 of the withheld paths appear in the accepted
  fitzRoy `full-history-20260902` 13,275-URL set, i.e. no appearance in seasons 1897–2025;
  15 of the 16 sampled are 2021–2025 draftees (10 from 2025), 1 is a 1992 spelling case
  (Matthew Capuano). Strong example: Hussien El Achkar (`hussien_el%20achkar/1`, 2025 National
  pick 53, Essendon) — DraftGuru and AFL Tables agree on name, DOB 02 Apr 2007, club, 9 games,
  10 goals; AFLDB search returns no player; he remains withheld. Cause of the registration gap
  (how a post-baseline debutant acquires an `afltables_profile_url` registration) NOT
  investigated here. Confirmed shape (ISSUE-222 D4, read-only query 2026-09-19): `afldb_test`
  holds 2026 matches (max season 2026) while its player register ends at 2025 (max debut 2025);
  Jagga Smith and Willem Duursma have no player row and no AFL Tables identity; no NBSP names.
- **Key files:** `tools/migration/import_fitzroy_core.py` (registration), `deploy/afldb-settle-afltables.sh`
  / current-season import, `data/reference/draftguru-person-bridge-20260918-v2.json` (the 94 identities),
  `docs/rebuild-manifests/draftguru/bridge-validation-verdicts-20260918-v2.csv` (`target_unregistered` rows).
- **Next action:** after ISSUE-222's `afldb_test` import is verified, establish how the 2026
  debutants (and the numbering/spelling cases) become registered identities on each target; then
  re-resolve a new deployment child against that registration (`--resolve-against`, new hash,
  §4.5) — never by editing the child or the importer's HALT.

### AFLDB-ISSUE-223 — Pre-existing test regression from AFLDB-ISSUE-221: `GRID_DRAFT_TYPES` reshaped, a `draftguru-acquisition.test.ts` vocabulary-parity test now fails
- **Severity:** Low. **Area:** test tooling — `tests/draftguru-acquisition.test.ts`,
  `src/search/grid-solver-spec.ts`.
- **State:** Open (2026-09-18, found incidentally during AFLDB-ISSUE-222 Phase 1 validation, not
  caused by it). `AFLDB-ISSUE-221` (commit `f1a8daca`) reshaped `GRID_DRAFT_TYPES` from a bare
  `as const` string array to `{ value; label }[]` (so the Draft-type dropdown lists "National
  Draft" once); the "keeps the mapping's draft_type vocabulary set-equal to GRID_DRAFT_TYPES"
  test's regex extraction no longer matches. DB-free unit test only; no production code affected.
- **Key files:** `tests/draftguru-acquisition.test.ts` (the failing assertion),
  `src/search/grid-solver-spec.ts` (the reshaped export, not itself defective).
- **Next action:** update the test's extraction to the current `{value,label}[]` shape (or import
  the module directly) and re-confirm the vocabulary is still set-equal in both directions.

**AFLDB-ISSUE-221 resolved 2026-09-18** (implemented 2026-09-17 by Fable 5.1; committed, merged
and DEV-verified 2026-09-18 by Sonnet 5) — Grid Solver draft-criteria review: honest "No data"
squares for an axis matching nobody, `draft_type_is` reads `draft_kind`, trade/free-agency rows
excluded from the three "drafted" builders, Gridley `fatherson` remapped to
`father_son_selection`, bounded numeric parameters with a per-square "Invalid value", the form
keyed by the board token so Reset resets, two stale `is_final` test oracles corrected. Committed
`f1a8daca`, merged to `main` at `159518ec`, deployed to DEV (`sync-dev.ps1 -RemoteRef main`,
revision `159518e`; found and corrected the DEV host's Git checkout sitting on a stale `dev`
branch, fast-forwarded 62 commits including AFLDB-ISSUE-220 and the NL-search chain
AFLDB-ISSUE-204–219 that had not reached DEV via this path before). All four required DEV browser
checks plus a valid non-draft answer check passed in a real authenticated `super_admin` session
via Playwright MCP (the operator signed in directly; the audience gate was not bypassed). The
reported symptom's root cause (draft-pick linkage, 5 of 6,810) is unfixed by design and now
tracked as **AFLDB-ISSUE-222** (draft runbook, awaiting operator approval). See `issues.md` for
the full record.

**Fable code review outside NL search — 2026-09-17 (Fable 5.1, review and planning only).**
Reviewed with native inspection: authentication/session/middleware/capabilities and every auth
Server Action (no defect); the admin `*-actions.ts` files the 2026-09-15 mutation audit's glob did
not match, content publish/upload, settle trigger, and the public writers (no defect); all seven
route handlers and every `sql.unsafe` sink traced to a module allowlist (no defect); the tracked
deploy units, cluster entry point, both Caddyfiles, settle chain, build wrapper, DB clients
(**AFLDB-ISSUE-220** opened). Not reviewed: `deploy/sync-dev.ps1` body, `tools/maintenance/*`,
migrations, the admin action modules already covered by the 2026-09-15 audit,
`tools/email_intake/`, page components beyond their query allowlists, `src/db/queries/admin-users.ts`.
Residual, no new ID: `/api/admin/email-intake` still admits `contributor` senders — deferred under
resolved AFLDB-ISSUE-186 Phase B. No project-wide PASS is claimed.

**Fable NL code review — FINAL: PASS (2026-09-17, Fable 5.1, operator-validated on streamanator).**
Lineage: Stage 1 found eight defects (F1–F8) → Stage 2 confirmed them as AFLDB-ISSUE-187..192,
hardening added 193..196, the corpus audit's 40 genuine fail-open rows became 197 (all resolved
2026-09-15/16) → the 168 stale `AMBIGUITY_NOT_DETECTED` expectations (112 team-streak + 56
coach-record, plus 5 Ablett = 173) were corrected under AFLDB-ISSUE-199, then V3/V4/V5 under
201/204/205 → 198..219 hardened further to parser v66. This acceptance pass re-verified every
187..197 fix in the current tree (not from issue status), confirmed the AFLDB-ISSUE-197 family
contract (complete candidates via `resolvePlayerFamily`, 2–12 ranks, >12 declines and is
reachable, direct resolution distinct), and reran the frozen V5 corpus parse+execute on v66:
11997/0/3. The three failures (`verified_finals_without_premiership`, rows 41–43) were adjudicated
`STALE/INVALID EXPECTATION` from current canonical data (Dane Rampe and Nick Dal Santo genuinely
tied at 24 finals, 0 premierships, nobody else at 24) and corrected V5 → V6 by the new fail-closed
script `tools/nl/fix-stale-finals-without-premiership-tie.ts` (3/3 targets, 0 non-targets).
**Final V6: 12000/12000 clean / 0 soft / 0 failed / 0 errors.** V6 is now the stable baseline. No
new issue opened; no production code changed. Volatility note: Rampe is active mid-2026-finals, so
another final would re-stale rows 41–43 honestly (see the script header / `issues.md` ISSUE-219).

**AFLDB-ISSUE-219 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) —
cross-family NL defect: a plural club/venue alias already ending in "s" takes a bare trailing
apostrophe for its possessive ("Bombers'", "Dogs'", "Lions'", the AFLDB-ISSUE-214 §10c residual's
"Suns'"/"Pies'"/"Bulldogs'"), which `canonicalise()`'s existing `'s\b` strip
(`src/search/nl/vocab.ts`) never matched (it requires a literal "s" after the apostrophe).
Club/venue matching itself already resolved these aliases correctly via word-boundary regexes;
only the final leftover-token comparison in `parseNlQuestion` (`src/search/nl/parser.ts`) ever
disagreed, because `meaningfulTokens`' whitespace split kept the apostrophe attached to the word
while the matched/consumed span did not. Confirmed a shared `canonicalise()` defect, not a
per-builder one, by tracing `tools/nl/generate-exploratory-corpus-v2.mjs`'s `possessive()` helper
(line 178) across five families: `team_match_result`, `team_checkpoint_collision`,
`q3_comeback_near_miss`, `club_season_rank` (the ISSUE-214 residual) and `team_streak`. Fixed with
one new generic trailing-apostrophe strip in `canonicalise()`, mirroring the existing `'s` rule
rather than special-casing any club — no apostrophe made globally ignorable (only a trailing one
immediately before whitespace/end-of-string; a mid-word apostrophe like `o'brien` is untouched).
`PARSER_VERSION` 65 → 66 (baseline corrected during reconciliation with `AFLDB-ISSUE-218`, which
already holds 64 → 65 on `dev`). `AFLDB-ISSUE-218` (below) **independently found and deliberately
deferred the identical defect** for its own `team_match_result/0` cluster (56 rows,
"Bombers'"/"Dogs'"/"Brisbane Lions'"), naming this exact cross-family issue as its recorded
follow-up candidate — confirming this issue's root-cause finding a second, independent way,
alongside AFLDB-ISSUE-214 §10c. Local: `tests/nl-parser.test.ts` **605/605**, broader gates
**402/402**, `typecheck` clean. **Host validation (streamanator):** no established mechanism
existed to transport uncommitted code to a host, so a temporary, isolated `git worktree`
(`/home/arm/nl-issue219-validation`, off `origin/dev` at `a98c3e42`) was created and a `git diff`
patch applied — a clean `git apply --check` itself served as the identity proof;
`/home/arm/projects/afldb` and the retained git stash were never touched, and the temp worktree
was removed after validation. Host suites reconfirmed 605/605 + 402/402 + clean typecheck.
Exploratory V2 (29,030 rows, the AFLDB-ISSUE-218-corrected corpus) moved **20512 → 20876 clean**
(+364 / -364 soft / 0 failed), reconciling exactly across five families (`club_season_rank` 210,
`team_streak` 75, `team_match_result` 56, `team_checkpoint_collision` 16,
`q3_comeback_near_miss` 7) — every one of the 364 improved rows confirmed to carry a
trailing-apostrophe alias, zero that don't. The frozen V1/"V5" corpus's three failing rows (a
stale `verified_finals_without_premiership` fact check, Nick Dal Santo → Dane Rampe tie count)
were proven via a decisive v65-vs-v66 control against the same current database to be pre-existing
data drift, **not** a regression — flagged as a stale-corpus-expectation candidate, not opened as
its own issue in this closeout. See `issues.md` and `AFLDB-ISSUE-219.md` §14 for the full record.

**AFLDB-ISSUE-218 resolved 2026-09-17** (Sonnet 5, operator-validated on
streamanator across two host-validation rounds) — `team_match_result/1` (522
rows, "at V, find the widest X win/loss to Y...") and `/2` (569 rows, "by how
much did X lose to Y in their most lopsided meeting...") shared one
wrapper-vocabulary-only mechanism (both already extracted clubs/direction
correctly); fixed with additive vocabulary only (`widest` in `AGG_WORDS`, a
leading scope-clause request-verb strip widened to `at` as well as `for`,
verb forms `lose`/`lost`/`beat` in `TEAM_METRIC_WORDS`, two narrowly-gated
wrapper consumers for "how much"/"lopsided meeting"), no grain-election or
club-role logic touched, `PARSER_VERSION` 64 → 65. Round-1 host validation
(commit `5bcc957`) found V5 green and `/1` fully cleared (522→0), but exposed
`/2` moving from an honest soft decline into a 569-row HARD FAILURE — worse
than the pre-fix state — so the issue was reopened rather than closed.
Re-investigation traced production SQL (`src/db/queries/nl/team-match.ts`'s
clubFor-relative `win_margin`/`loss_margin`) and the parser's pre-existing,
uniformly-applied `clubFor`=subject convention against every pre-issue
directional test, then found and confirmed (empirically, 0 mismatches across
every affected row) a genuine, isolated **exploratory V2 generator/oracle
defect**: `team_match_result`'s templates 0/1/3 all keep club `c` as the
sentence's grammatical subject, but template 2 alone renders `o` as subject
and `c` as object without a corresponding fix to its expected `club`/
`opponent`/`metric` triple. Parser v65 was confirmed correct and untouched;
only the generator's template-2 expectation construction was corrected
(commit `6ed227d`), `PARSER_VERSION` staying at 65 (corpus-only correction).
Round-2 host validation confirmed **0 failed**: frozen V5 stayed
12000/12000/0/0; exploratory V2 moved v64 baseline (19421 clean/8109
soft/0 failed) → v65-corrected (20512 clean/7018 soft/0 failed), net
**+1091 clean/-1091 soft/0 failed**, reconciling exactly to `522 + 569 =
1091`; a determinism/isolation diff confirmed 0 question-text/row-id changes
anywhere in the 29,030-row corpus, with all 569 changed rows confined to
`team_match_result/2`'s own expectation columns. `team_match_result/0` (56
rows, "Bombers'"/"Dogs'"/"Brisbane Lions'" possessive aliases) remains
unchanged at 56 honest declines throughout both rounds — a distinct,
already-known trailing-apostrophe plural possessive-alias defect (the same
mechanism AFLDB-ISSUE-214 already found and left unfixed for
`club_season_rank`), deliberately deferred as a future cross-family issue
candidate, not opened as its own tracked issue in this closeout.
Implementation commits `5bcc957` (parser) and `6ed227d` (exploratory oracle
correction) on `sonnet/issue-218-team-match-result-phrasing`, unmerged.
Local: `tests/nl-parser.test.ts` 595/595, broader gates (`nl-regression-corpus`
163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus` 65/65 = 402/402),
`typecheck` clean. See `issues.md` and `AFLDB-ISSUE-218.md` for the full
record.

**AFLDB-ISSUE-217 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) —
`player_game_single`'s three large exploratory clusters (`/0` 423 rows "biggest `<metric>` haul in one
match", `/4` 422 rows "peak single-game `<metric>`", `/3` 409 rows "which match saw `<player>` collect
the most `<metric>`", combined 1254 rows) share ONE root mechanism, not three, and it is NOT grain/mode
misrouting — a named player's per-game stat already defaults correctly to `grain='player_game',
mode='single'`. The defect was in `candidatePlayerSpan` (`src/search/nl/parser.ts`): it greedily takes
the first four remaining non-stopword alpha tokens with no notion of "stop at a non-name word", so
unconsumed wrapper vocabulary ("haul", "peak"/"single-game", "match"/"saw"/"collect" — none had any
vocabulary entry) got swept into the player-name candidate alongside the real name (e.g. "dustin martin
haul"), which then failed player resolution outright — the polluted span is exactly the reported
`unsupported_term`. The adjacent `player_game_scope_collision/3` (555 rows, "single-match `<metric>`
record for...") was inspected and confirmed to share the identical mechanism (bare "single-match" always
sat immediately before the player name) and was included. Fixed with one generic `IN_ONE_GAME` extension
(bare "single-game"/"single-match" adjective, not only "in ... game/match") plus three new gated
wrapper-word consumers (`WHICH_MATCH_SAW_RE`, `PLAYER_GAME_SINGLE_HAUL_RE`, `PLAYER_GAME_SINGLE_PEAK_RE`)
— no player, club, venue, or metric special-cased. `PARSER_VERSION` 63 → 64. Implementation commit
`879b0e1` ("Fix player game single match phrasing"),
`sonnet/issue-217-player-game-single-phrasing`, unmerged. Local: `tests/nl-parser.test.ts` 575/575 (554 +
21 new), broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus`
65/65 = 402/402), `typecheck` clean. Host validation (streamanator, commit `879b0e1`): frozen V5 stayed
**12000/12000/0/0**; exploratory V2 moved **17612 → 19421 clean (+1809)**, **9918 → 8109 soft (-1809)**,
0 failed throughout. All four target clusters fully cleared: `player_game_single/0` 423 → 0, `/4` 422 →
0, `/3` 409 → 0, `player_game_scope_collision/3` 555 → 0. A direct 29,030-row plan-level comparison (v63
vs. v64) found exactly **1809 changed plans, 0 missing rows**, reconciling exactly to the four target
clusters, zero unrelated movement. A separate, pre-existing `WRONG_PLAYER` scorer-identity artifact (the
already-tracked Gary Ablett Jnr/Snr display-name mismatch from AFLDB-ISSUE-206/210) remains present
across several rows in the affected template families, confirmed independent of this fix and left
untouched. See `issues.md` and `AFLDB-ISSUE-217.md` for the full record.

**AFLDB-ISSUE-216 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) —
`player_season_leaderboard`'s two exploratory clusters (`/0` 576 rows "posted the highest season tally
of `<stat>` for `<club>` `<time>`", `/3` 559 rows "the best seasonal `<stat>` total `<time>`") do NOT
share one root mechanism: both left "posted"/"season"/"tally"/"seasonal" unconsumed as leftover wrapper
vocabulary (shared gap), but `/3` additionally carried an independent grain-election defect — its own
"total" collided with the generic `AGGREGATE_TOTAL_WORDS` scoped-running-total cue and silently
misrouted the unnamed-player question to `player_game`/`sum` instead of `player_season`. Fixed with
three new gated vocabulary entries (`PLAYER_SEASON_LEADERBOARD_TALLY_RE`,
`PLAYER_SEASON_LEADERBOARD_SEASONAL_RE`, `PLAYER_SEASON_LEADERBOARD_POSTED_RE`, all gated on an actual
player-stat `METRIC_WORDS` match) plus a narrow `playerSeasonLeaderboardCue` override on the
`aggregateTotal` grain-election guard — no club, player, or metric special-cased. `PARSER_VERSION` 62 →
63. Implementation commit `8de4a96` ("Fix player season leaderboard phrasing"),
`sonnet/issue-216-player-season-leaderboard-phrasing`, unmerged. Local: `tests/nl-parser.test.ts`
554/554 (541 + 13 new), broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174,
`nl-stress-corpus` 65/65 = 402/402), `typecheck` clean. Host validation (streamanator, commit `8de4a96`):
frozen V5 stayed **12000/12000/0/0**; exploratory V2 moved **16477 → 17612 clean (+1135)**, **11053 →
9918 soft (-1135)**, 0 failed throughout. Both target clusters fully cleared: `/0` 576 → 0, `/3` 559 → 0.
A direct 29,030-row plan-level comparison (v62 vs. v63) found exactly **1135 changed plans, 0 missing
rows**, all in the target family, zero unrelated movement. See `issues.md` and `AFLDB-ISSUE-216.md` for
the full record.

**AFLDB-ISSUE-215 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator, two
host-validation rounds) — `career_numeric_binding`'s two exploratory clusters (`/3` 700 rows "for CLUB,
find players with A plus B", `/2` 552 rows "who has the most career S among players with A and B") do
NOT share one root mechanism — `/3` is a pure wrapper-vocabulary gap ("find" behind a leading "for"
clause, "plus" as an unrecognised conjunction); `/2` shares that gap ("among") plus an independent,
genuine predicate-loss defect (a stat word's earliest occurrence was the only one ever tried, silently
dropping a same-column condition stated after the ranking mention). Both fixed; `PARSER_VERSION` 61 →
62. Round-1 host validation (commit `5eca839`): frozen V5 stayed 12000/12000/0/0; `/2` fully fixed
(552 → 0); `/3` split into 491 `coverage_unavailable` and 209 `unsupported_term: plus`. The 491 were
investigated and classified a **legitimate, currently-real coverage limitation, not a parser/guard
defect** — `conditionSql` (`src/db/queries/nl/player-career.ts`) has no per-club SQL path for any
career condition column except `games`, and `validatePlan`'s club-scoped-career-condition guard
(`src/search/nl/plan.ts`) correctly fails closed rather than silently answer with a whole-career total
— guard NOT weakened, no corpus/scorer file touched, recorded as a future SQL-compiler capability
candidate (see `AFLDB-ISSUE-215.md` §11, §15). The 209 were a second, residual "plus" ownership gap in
`extractCareerConditions` — a 20-character clause-boundary lookback too short for a long comparator
phrase like "no more than " (widened to 40, proven safe by a new three-clause regression control), and
the "no X" negative-condition loop never checking for a neighbouring "plus" — fixed the same session
under the same `PARSER_VERSION` 62 (a correction, not a new semantic feature). Round-2 host validation
(commit `6a341fd`) confirmed the fix: frozen V5 stayed 12000/12000/0/0 again; `career_numeric_binding/3`
final triage is 700 `coverage_unavailable` / 0 `unsupported_term` — **all 700 `/3` rows now produce
structurally valid plans**; a direct round-1-vs-round-2 plan comparison found exactly 209 changed
plans, 0 missing, zero unrelated movement. Implementation commits `5eca839` and `6a341fd` on
`sonnet/issue-215-career-numeric-binding-phrasing`, unmerged. Local: `tests/nl-parser.test.ts`
540/540, broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174,
`nl-stress-corpus` 65/65 = 402/402), `typecheck` clean. See `issues.md` and `AFLDB-ISSUE-215.md` for
the full record.

**AFLDB-ISSUE-214 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — `club_season_rank`'s "what season had the highest/lowest `<metric>`" and "`<club>`'s highest/lowest seasonal `<metric>`" phrasings declined with `unsupported_term: season`/`seasonal`: neither word was ever consumed by any extractor, so it survived as a leftover token even when the surrounding club-season construction was otherwise fully understood. Confirmed both failing clusters (`club_season_rank/1`, `club_season_rank/3`) are two English phrasings of one already-supported semantic construction, not two mechanisms. Fixed with two new gated vocabulary entries (`CLUB_SEASON_RANK_SEASON_CUE_RE`, `CLUB_SEASON_SEASONAL_ADJECTIVE_RE`) folded into the existing `clubSeasonCuePresent`/single-season-guard logic — no club name, corpus ID, or exact sample string special-cased. `PARSER_VERSION` 60 → 61. Implementation commit `731edd8` on `sonnet/issue-214-club-season-rank-phrasing`, unmerged. Local: `tests/nl-parser.test.ts` 519/519, broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus` 65/65 = 402/402), `typecheck` clean. Operator-validated on streamanator: frozen V5 stayed **12000/12000/0/0**; exploratory V2 moved **14879 → 15925 clean (+1046)**, **12651 → 11605 soft (-1046)**, 0 failed throughout. The full `club_season_rank/3` cluster (642 rows) cleared; 404 of 614 `club_season_rank/1` rows cleared, 210 remaining on a separate, pre-existing possessive-club-alias defect (`Suns'`/`Pies'`/`Bulldogs'`) deliberately **not folded into this issue and not opened as its own tracked issue** — recorded as a follow-up candidate only. A direct 29,030-row plan-level comparison (v60 vs. v61) found exactly **1046 changed plans, 0 missing rows**, all in the target family, zero unrelated movement. See `issues.md` and `AFLDB-ISSUE-214.md` for the full record.

**AFLDB-ISSUE-213 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — a pre-existing
`extractClubs` defect (`src/search/nl/parser.ts`) exposed by, not caused by, ISSUE-212's corrected
exploratory V2 oracle. `phrasePosition`/`phraseEnd` re-found a matched club's position with a bare
first-match `\b<name>\b` search of the whole original question, so a shorter club's name embedded,
word-bounded, inside a longer club's own name ("Melbourne" inside "North Melbourne") silently rebound
onto the longer club's own span instead of the real, later standalone mention — the computed gap
between the two clubs came out empty, the `versus`/`vs`/`v` separator was never recognised, and
`scope.matchup` never formed for wording like "North Melbourne versus Melbourne" (confirmed row
`#20609919`), falling back to directional `clubFor`/`clubAgainst` instead. Fixed with a new
`firstUnclaimedOccurrence` helper that excludes spans an earlier club match in the same call has
already claimed, generic across any overlapping-name pair — no club special-cased. `PARSER_VERSION`
59 → 60. `Port Adelaide`/`Adelaide` and `Greater Western Sydney`/`Sydney` confirmed to reproduce the
identical mechanism, first by source trace and then empirically by the host plan diff (see below). One
pre-existing negative-control test needed a fixture-only swap (`sydney derby` → `western derby`) after
this issue's new `Sydney`/`Melbourne`/`North Melbourne` fixtures invalidated its "absent club"
assumption — not a parser regression, no production code touched for that correction. Implementation
commit `4f0be951` on `sonnet/issue-213-overlapping-club-matchup`, unmerged. Local: `tests/nl-parser.test.ts`
509/509, broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus`
65/65 = 402/402), `typecheck` clean. Operator-validated on streamanator: frozen V5 stayed
**12000/12000/0/0**; exploratory V2 moved **1 → 0** hard failures (row `#20609919` confirmed clean); a
direct 29,030-row plan-level reconciliation (v59 vs. v60) found **exactly 1 changed plan**, the known
row, with **zero unrelated changes** elsewhere in the corpus. See `issues.md` and
`AFLDB-ISSUE-213.md` for the full record.

**AFLDB-ISSUE-212 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(4) of `AFLDB-ISSUE-206.md`'s six proposals: corrected the exploratory NL corpus/scorer's three
confirmed V1 oracle defects (496-row symmetric "versus" matchup, 283-row achievement-summary
aggregation, 351-row Gary Ablett Jnr/Snr identity, all at parser v54) in a new versioned
`tools/nl/generate-exploratory-corpus-v2.mjs` + `tools/nl/corpus.ts` scorer contract. Not a
parser-feature issue: `PARSER_VERSION` unchanged at 59, no `src/search/nl/{parser,vocab,
semantic-intents}.ts` file touched. Operator-validated on streamanator: V2 (29,030 rows, seed
`2060542026`, SHA256 `bb75e4b5067942117c60f8eab6cfd01de4d8fc1e0c4fee07e10650fae97edb4a`, deterministic
replay confirmed, V5 exact/normalized overlap 0/0, 1,500 audit-required) scored against parser v59:
**27530 scored / 14878 clean / 12651 soft / 1 failed**; the frozen V1 12,000-row corpus stayed
**12000/12000/0/0** under the updated scorer, no regression. A same-corpus, same-parser (v59)
reconciliation of the pre- vs. post-ISSUE-212 oracle found **1308 old false hard failures removed**
(545 `team_match_result` matchup + 320 `achievement_summary` aggregation + 443 player-identity, split
225 Gary Ablett Snr / 218 Jnr) **and 1 newly exposed genuine hard failure** — net failed count change
-1307, not "1307 fixed". The v54→v59 counts (496→545, 283→320, 351→443) grew because
AFLDB-ISSUE-207..211 landed in between and let more previously-declined rows reach a scored plan for
the first time, exposing more instances of the same three pre-existing defects — none of those five
fixes touched matchup detection, achievement aggregation, or player-identity resolution themselves.
The one newly exposed hard failure (row #20609919, "... margin for North Melbourne versus Melbourne at
Adelaide Oval ...") is a genuine, distinct, pre-existing `extractClubs` defect (`phrasePosition`/
`phraseEnd` re-finding a club's position via a bare word-boundary search of the whole original text can
find a shorter club's name embedded inside a longer club's own name, here "Melbourne" inside "North
Melbourne", instead of the real second mention, silently preventing the unordered matchup from
forming) — confirmed identical parser plan in V1 and V2, not a corpus/scorer defect and not introduced
by this issue, deliberately left unfixed and **not opened as its own tracked issue in this closeout**.
Two structurally similar pairs (`Port Adelaide`/`Adelaide`, `Greater Western Sydney`/`Sydney`) are
**unreproduced hypotheses only** — the actual host run found exactly one failure total, so neither is
confirmed to have been drawn by this seed or to reproduce the mechanism. See `issues.md` and
`AFLDB-ISSUE-212.md` (§6a, §8) for the full record.

**AFLDB-ISSUE-211 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(5) of `AFLDB-ISSUE-206.md`'s six proposals, the largest single unimplemented soft-decline vocabulary
family it found: `extractSeasons` (`src/search/nl/parser.ts`, `src/search/nl/vocab.ts` new `AFTER_RE`)
had no form for `after YEAR` as an exclusive lower season bound (`scope.seasonMin = YEAR + 1`,
deliberately distinct from inclusive `since YEAR`). Fix extends the existing single season extractor
with one new anchored regex and one new `else` branch alongside the existing `since` check — no second
parser, no vocabulary/stage reordering, `after the siren`/`AFTER_THE_ACHIEVEMENT` unaffected because
neither ever puts a literal year immediately after the word. `PARSER_VERSION` 58 → 59. Implementation
commit `c113e6a`, unmerged on `sonnet/issue-211-after-year-season-bound`. Operator-validated on
streamanator: frozen V5 stable-corpus rerun stayed **12000/12000/0/0**, and a direct structured-plan diff
of the retained ISSUE-206 29,030-row exploratory corpus (pre-fix v58 vs post-fix v59) found exactly
**1406 changed plans**, all genuine `after <4-digit year>` wording, 0 unrelated — reconciled in full:
**1262 `soft_fail→clean`** (the genuine usability gain), **136 `soft_fail→soft_fail`** (95
`career_boundary` / 23 `head_to_head` / 18 `unsupported_composition`, correctly declined under the
existing compiler/coverage contract once the temporal clause parses), **8 `audit→audit`**
(`malformed_input` rows, intentionally still manual-audit by corpus design), and **0 `soft_fail→fail`**.
118 changed rows compose `after the siren` with a separate genuine `after YEAR` clause; both meanings
coexist correctly in every one. See `issues.md` and `AFLDB-ISSUE-211.md` for the full record.

**AFLDB-ISSUE-210 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(6) of `AFLDB-ISSUE-206.md`'s six proposals: a leading imperative/request-wrapper verb ("find", bare
"show", "list", "give me" — "show me"/"tell me" already worked) survived `canonicalise()`
(`src/search/nl/vocab.ts`) as an unmatched leftover token and tripped the generic decline gate even when
the rest of the question was otherwise fully supported — the dominant soft-decline mechanism ISSUE-206
found (~10,000+ of 15,275 soft-decline exploratory rows). Fix: one new anchored
`LEADING_REQUEST_PREFIX_RE`, consumed at most once at the very start of the string; `find` carries a
negative lookahead protecting the pre-existing "find the (big) sticks" goals idiom, the one real
vocabulary collision found. `PARSER_VERSION` 57→58. Implementation commit `8324d2a`, unmerged on
`sonnet/issue-210-imperative-nl-phrasing`. Operator-validated on streamanator: frozen V5 stable-corpus
rerun stayed **12000/12000/0/0**, and a direct structured-plan diff of the retained ISSUE-206 29,030-row
exploratory corpus (pre-fix v57 vs post-fix v58) found exactly **1408 changed plans**
(`663 find / 378 list / 367 show / 0 other`, zero unrelated wording family), reconciled in full: **1288
`soft_fail→clean`** (the genuine usability gain), **48 `soft_fail→fail`** (all `show`-prefixed
`player_game_single` rows, all the pre-existing Gary Ablett Jnr/Snr canonical-display-name scorer
artifact from `AFLDB-ISSUE-206.md`, exposed by new reachability rather than caused by this fix), and
**72 audit-required `decline→success`** ("List sons of X with Y" `relationship_conditions` rows, now
valid typed `player_career` plans but still intentionally manual-audit by corpus design). See
`issues.md` and `AFLDB-ISSUE-210.md` for the full record.

**AFLDB-ISSUE-209 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(3) of `AFLDB-ISSUE-206.md`'s six proposals: `extractHeadToHeadCue`'s `compare_wins` family
(`src/search/nl/semantic-intents.ts`) recognized only past-tense "won more", so present-tense "has/have
more wins ... head to head" fell through to the generic `head to head` → `record` cue and answered with
a full record instead of naming the leader. Fix added a dedicated "has/have (more|the most) wins head to
head" pattern plus a trailing-"head to head" extension to the existing "won more" pattern, both checked
before the generic record families; `PARSER_VERSION` 56→57. Operator-validated on streamanator (commit
`f2e067f`): frozen V5 stable-corpus rerun stayed **12000/12000/0/0**, and a direct structured-plan diff
of the retained ISSUE-206 29,030-row exploratory corpus (pre-fix v56 vs post-fix v57) found exactly
**199 changed plans**, all `headToHead.kind: record→compare_wins` in the same wording family — 173
matching ISSUE-206's direct estimate, plus 26 that also carried a mechanically-linked `between YEAR and
YEAR` season/havingClause correction (the same atomic "wins" consumption fix incidentally resolved a
misread grouped-threshold on those 26 rows) — zero collateral movement elsewhere, so **the validated
affected surface is 199 rows, not 173**. Implementation commit `f2e067f`, unmerged on
`sonnet/issue-209-head-to-head-more-wins`. Two adjacent wordings ("has more wins between A/B", "has more
wins against the other") investigated and deliberately not fixed — claimed earlier by
`extractClubSeasonMetric`'s "most wins" club_season ranking cue, a different mechanism. See `issues.md`
and `AFLDB-ISSUE-209.md` for the full record.

**AFLDB-ISSUE-208 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(2) of `AFLDB-ISSUE-206.md`'s six proposals: `extractClubs`'s club-role lookback (`src/search/nl/parser.ts`)
tested "does an against-like token exist anywhere in a fixed 20-character window", not "what is the
nearest preposition governing this club" — losing the subject club on 134 after-siren rows ("to win FOR
Club" mis-read the earlier, unrelated "to" as governing) and 117 leading-opponent/checkpoint rows
("Against Opponent, ... Subject's ..." let the opponent's own stripped-out "against" leak into the
subject's shrunken window). One shared mechanism, fixed by a `nearestGoverningPreposition` helper
anchored to the immediately-preceding token, checked against the pre-mutation text — no vocabulary
added, no stage reordered, `scope.matchup` unchanged; `PARSER_VERSION` 55→56. Operator-validated on
streamanator (commit `70b72df`): frozen V5 stable-corpus rerun stayed **12000/12000/0/0**, and a direct
structured-plan diff of the retained ISSUE-206 29,030-row exploratory corpus (pre-fix v55 vs post-fix
v56) found exactly **251 changed plans** (134 `after_siren` + 117 `team_checkpoint_collision`), zero
collateral movement elsewhere, clearing all 251 confirmed parser-defect hard failures (aggregate hard
failures 1381→1130, clean +251, soft unchanged). Implementation commit `70b72df`, unmerged on
`sonnet/issue-208-club-role-ownership`. One structurally similar, undisturbed finding in
`assignCrossDomainClubs` (its own fixed-window `AGAINST_PREPOSITION.test` for the played/coached
opponent refusal) documented but not fixed and not yet opened as its own issue. See `issues.md` and
`AFLDB-ISSUE-208.md` for the full record.

**AFLDB-ISSUE-207 resolved 2026-09-16** (Sonnet 5, operator-validated on streamanator) — follow-on item
(1) of `AFLDB-ISSUE-206.md`'s six proposals, the highest-severity finding (281 silently-wrong-answer
corpus rows). Root cause: `extractHavingClause`'s operator search used an unbounded `±20`-character
window that could reach past a grouped wins/losses/draws/games threshold's own count into an adjacent
margin clause's operator word, and separately let `COMPARE_OP_WORDS`' fixed vocabulary order outrank the
clause's own, correctly-positioned operator word. Both effects silently swapped the two clauses'
comparators while still passing `validatePlan`. Fix bounded the operator search to
`window.slice(0, countEnd)` — no vocabulary added, no stage reordered, no default changed;
`PARSER_VERSION` 54→55. Operator-validated on streamanator: frozen V5 stable-corpus rerun stayed
**12000/12000/0/0**, and a direct structured-plan diff of the retained ISSUE-206 29,030-row exploratory
corpus (pre-fix v54 vs post-fix v55) found exactly **281 changed plans**, all
`havingClause.op: gt->gte` paired with `matchFilter.op: gte->gt` (the intended pairing), zero collateral
movement elsewhere in the corpus. Implementation commit `4ecdd77a`, unmerged on
`sonnet/issue-207-numeric-operator-ownership`. One pre-existing, out-of-scope gap documented but not
fixed: `extractMatchFilter` has no form for trailing "by 50 or more/fewer points". See `issues.md` and
`AFLDB-ISSUE-207.md` for the full record.

**AFLDB-ISSUE-206 resolved 2026-09-16** (Sonnet 5) — final triage of the 29,030-row independent V1
exploratory corpus, re-verified against current branch source rather than taken on the first-pass
(Codex) scorer labels. All 1,381 hard failures reconcile exactly to five root causes: 496
(`team_match_result` symmetric "versus", confirmed corpus-oracle defect — parser already emits a correct
`matchup` scope, template wrongly asserts directional clubs), 283 (`achievement_summary` aggregation,
confirmed corpus/scorer defect — the grain's executor never reads `plan.agg`), 351 (Gary Ablett Jnr/Snr,
confirmed scorer defect — player ID resolves correctly, only display-name string comparison is wrong),
and **251 genuine parser defects** (`after_siren`/`team_checkpoint_collision` clubFor loss, one shared
root mechanism: `AGAINST_PREPOSITION`'s 20-character lookback window in `extractClubs` is not anchored to
the nearest preposition). Two further clusters are silent wrong answers scored `clean`, outside the
1,381: 281 rows (numeric operator ownership crossing between `extractHavingClause`/`extractMatchFilter`,
confirmed parser defect, highest severity) and 173 rows (head-to-head "has more wins" phrasing gap).
Soft declines (15,275) trace mainly to one mechanism (imperative/structural phrasing vocabulary gap,
~10,000+ rows) plus `after YEAR` (unimplemented, ~1,200+ rows) and a deliberate `career_boundary`
compiler restriction (907 rows, fails closed by design). Six follow-on proposals recorded in priority
order in `AFLDB-ISSUE-206.md`, no ISSUE-207+ IDs assigned yet. No parser behaviour, `PARSER_VERSION`, V5
row or production data changed. See `issues.md` and `AFLDB-ISSUE-206.md` for the full record.

**AFLDB-ISSUE-205 resolved 2026-09-16** (Sonnet 5, operator-validated) — AFLDB-ISSUE-200's
`TAXONOMY_DRIFT` disposition for the remaining 70 `WRONG_FAILURE_REASON` rows was incomplete: two
unrelated families, not one benign label mismatch. **Family A (42 rows,** "biggest three quarter time
comeback" **):** genuine parser-ordering defect — `extractScoreCheckpoint` consumed "three quarter time"
before `extractTeamMetric` could match the already-implemented `q3_deficit_overcome` team_match metric.
Fix required two rounds (a `'3QT'`-entry guard, then a `'QT'`-entry follow-up after the operator's first
run found the first guard incomplete — a second, independent fall-through matching the same nested
substring); `PARSER_VERSION` 53→54. **Family B (28 rows,** "comeback from quarter time" **):** genuine
Q1/quarter-time feature gap (no `q1_deficit_overcome` metric exists, and none was added — deliberate
scope decision); stays declined, `expected_failure_reason` corrected `unsupported_topic`→
`unsupported_term`. Two correction-tool validation defects found and fixed along the way (both
test/tooling-only, no parser/runtime defect): an over-broad candidacy design gated on old-state
(`decline`+`unsupported_topic`) before question-text identity, wrongly flagging an unrelated live
fantasy-score row; and a DB-free test fixture that leaked a filler-row default
(`expected_grain='player_game'`) into synthetic decline rows. Operator-validated end-to-end: 446/446
parser tests, 35/35 integration tests (incl. new `q3_deficit_overcome` SQL coverage), clean
`tsc --noEmit`, 15/15 correction-tool tests, real V4→V5 correction (70/70 targets, 0 non-targets
touched, independently re-verified), parser-v54 rerun against V5 = **12000 scored / 12000 clean / 0 soft
/ 0 failed**. V5 is now the stable regression-corpus baseline, superseding V4. Stage 2 remains closed,
not reopened. See `issues.md` and `AFLDB-ISSUE-205.md` §11 for the full record.

**AFLDB-ISSUE-204 resolved 2026-09-16** (Sonnet 5, operator-validated) — guarded V3→V4 corpus
correction for the 180-row `coverage_unavailable|fgf` stale pre-1965/1987 finals-stat coverage
expectations (disposals/marks/tackles, finals/Grand Finals, seasons 1897-1926). Three fail-closed
correction-tool defects were found and fixed across three operator runs before the fourth completed
end-to-end: (1) an over-broad category+template-only selector matched 996 rows, not 180, retargeted to
the row's full structural signature; (2) a singular-only `/\bfinal\b/i` question-text check rejected
real plural "finals" wording, widened to `/\bfinals?\b/i`; (3) a season-shape gate wrongly required
`expected_season_from === expected_season_to` for every row, fixed by branching on
`expected_match_type` (Grand Final rows carry a blank `expected_season_to`). All three were
correction-tool-only; no parser/runtime defect was found. Final run: 180/180 targets corrected, 0
non-targets touched, parser-v53 rerun against V4 = 12000 scored / 11930 clean / 70 soft / 0 failed
(down from 250 soft), the 180 `UNEXPECTED_DECLINE` rows removed with zero new soft rows and zero
semantic changes among the rest; `PARSER_VERSION` unchanged at 53. See `issues.md` and
`AFLDB-ISSUE-204.md` §11 for the full record. AFLDB-ISSUE-187..204 all now resolved. **Stage 2 (the
AFLDB-ISSUE-200 corpus audit and its four follow-ons) is now closed**; the remaining 70
`WRONG_FAILURE_REASON` taxonomy-drift rows are a separate, not-yet-opened cleanup/audit task (see
Stage 2 next task below).

AFLDB-ISSUE-202 (GWS club identity leaks into unsupported-term detection) resolved 2026-09-16
(Sonnet 5, operator-validated) -- see `issues.md` for the full record, including the additional 72
grain-equivalent GWS player-season rows normalized as a byproduct of the same fix.

AFLDB-ISSUE-203 (numeric word "zero" not bound as equality in `player_career` conditions) resolved
2026-09-16 (Sonnet 5, operator-validated) -- root cause was two cooperating gaps in
`extractCareerConditions` (missing `zero` vocabulary entry, and a comparator default wrong for a
bound zero); `PARSER_VERSION` 52→53; 15 zero-word soft findings cleared, 0 new soft rows, 0
semantic changes among the 250 remaining soft rows -- see `issues.md` for the full record.

AFLDB-ISSUE-187..192 were opened 2026-09-15 from the Fable NL Search Stage 1 review (Fable 5.1,
medium effort), re-verified by Stage 2 on main `8a0c4cb`. Subsystem: natural-language search
(`src/search/nl/`, `src/db/queries/nl/`). AFLDB-ISSUE-190 resolved 2026-09-15 (Sonnet 5);
AFLDB-ISSUE-188 resolved 2026-09-15 (Sonnet 5); AFLDB-ISSUE-187 resolved 2026-09-15 (Sonnet 5);
AFLDB-ISSUE-189 resolved 2026-09-15 (Sonnet 5, from the approved runbook, operator-validated);
AFLDB-ISSUE-191 resolved 2026-09-15 (Sonnet 5, operator-validated); see `issues.md`.
AFLDB-ISSUE-193 (opened 2026-09-15 during ISSUE-189 planning) resolved 2026-09-15 (Sonnet 5,
operator-validated); see `issues.md`.
AFLDB-ISSUE-192 resolved 2026-09-15 (Sonnet 5, operator-validated: 31/31 integration tests,
5/5 ISSUE-192 regression tests, clean `tsc --noEmit`); see `issues.md`.
AFLDB-ISSUE-187..193 all remain resolved; the Stage 2 closeout audit (2026-09-16, Sonnet 5 High)
found three neighbouring, unrelated defects while verifying the resolved fixes and opened
AFLDB-ISSUE-194..196. AFLDB-ISSUE-196 resolved 2026-09-16 (Sonnet 5 High, from the approved
runbook — one runbook correction to the `across` regression contract mid-implementation, see
`issues.md` — operator-validated: 389/389 `nl-parser.test.ts`, 167/167 `nl-semantic-mapping.test.ts`,
clean `tsc --noEmit`). AFLDB-ISSUE-195 resolved 2026-09-16 (Sonnet 5 High, from the approved runbook
`AFLDB-ISSUE-195.md`, Option B — subject-gated "won the/a premiership" vocabulary plus a narrow
club-season ownership guard, no runbook correction needed — operator-validated: 398/398
`nl-parser.test.ts`, 167/167 `nl-semantic-mapping.test.ts`, clean `tsc --noEmit`); see `issues.md`.
AFLDB-ISSUE-194 resolved 2026-09-16 (Sonnet 5 Medium, `sonnet/issue-194-team-match-symmetric-matchup`,
unmerged — operator-validated: 34/34 `tests/integration/nl-answers-team-club.test.ts`, clean
`tsc --noEmit`); see `issues.md`. AFLDB-ISSUE-187..196 all now resolved. The Stage 2 corpus triage
of the 208 `AMBIGUITY_NOT_DETECTED` rows (2026-09-16) classified 40 as `GENUINE_FAIL_OPEN`, 168 as
`STALE_CORPUS_EXPECTATION`, and opened AFLDB-ISSUE-197 for the 40 (one root cause).
**AFLDB-ISSUE-197 resolved 2026-09-16** (Sonnet 5, from the approved runbook `AFLDB-ISSUE-197.md` —
Option C, a dedicated `resolvePlayerFamily` resolver mirroring the parser's whole-word-prefix
predicate in SQL; `PARSER_VERSION` 48 → 49; operator-validated: 25/25
`tests/integration/nl-semantic-mapping.test.ts`, 951/951 across the full focused NL suite set,
clean `tsc --noEmit` — see `issues.md` for the full Implementation/Validation/Resolution record,
including one mid-session fixture correction and one integration-path control-flow investigation
that concluded fixture defect, not production defect). AFLDB-ISSUE-187..197 all now resolved.

Stage 2 status: **blocked again, narrowly.** ISSUE-197 resolving its one genuine fail-open root
cause cleared six of the seven generic-surname families (Johnson, Brown, Smith, Williams, Wilson,
Anderson). The v49 regression rerun (2026-09-16) found the seventh, Jones (rows 11626-11630,
5 rows), still hard-failing for a distinct-but-related reason: the parser's own defence-in-depth
`candidateNameWords` re-check does not tokenise hyphenated surnames (`Darcy Byrne-Jones`,
`David Rhys-Jones`) the same way SQL's `afldb_normalise_name` does, undercounting the real 13-member
Jones family to 11 and ranking a wrong answer instead of declining. **AFLDB-ISSUE-198 opened
2026-09-16, resolved 2026-09-16** (Sonnet 5, from the approved runbook `AFLDB-ISSUE-198.md` — one
implementation-time deviation from its §5 Option C code sketch, found empirically: `candidatePlayerSpan`
widens its acceptance test via the new shared `splitNameWords` helper but keeps the original
punctuation-bearing token, rather than exploding it, to stay aligned with the confidence/leftover-token
accounting elsewhere in the parser — see `issues.md`'s Implementation section). `PARSER_VERSION` 49 →
50. Operator-validated 2026-09-16: `tests/integration/nl-semantic-mapping.test.ts` 29/29 (DB-backed,
`afldb_test`), combined focused suite 964/964 across 6 files (`nl-parser.test.ts` 413/413,
`nl-semantic-mapping.test.ts` 167/167, `nl-regression-corpus.test.ts` 163/163,
`nl-audit-acceptance.test.ts` 10/10, `nl-plan.test.ts` 182/182, plus the integration file above),
clean `tsc --noEmit`. AFLDB-ISSUE-187..198 all now resolved.

The unchanged V1 12k-row corpus re-run on parser v50 (post-merge Stage 2 step) has now been run: hard
failures 178 -> 173, confirmed to be exactly the five Jones rows (11626-11630) clearing with zero
collateral movement. **AFLDB-ISSUE-199 resolved 2026-09-16** (Sonnet 5, from the approved runbook
`AFLDB-ISSUE-199.md`, revised mid-implementation after two real-DEV validation failures — see
`issues.md`'s Implementation/Final-patch-revision sections — a self-verifying correction script,
`tools/nl/fix-issue-199-stale-expectations.ts`, corrected exactly the 173 stale-decline rows; operator-
validated: correction-tool summary 173/173 targets modified, 0 non-target rows touched, plus a parser-v50
`nl:stress` re-run showing `AMBIGUITY_NOT_DETECTED`/hard-fail 173 -> 0 with the three soft classes
unchanged at 72/921/70; DB-free unit suite 28/28; `PARSER_VERSION` unchanged at 50). AFLDB-ISSUE-187..199
all now resolved. Stage 2 is **not** closed by this: the three soft classes remain open and unaudited
(item 4 below), and the rest of the Stage 2 closeout sequence remains outstanding.

**AFLDB-ISSUE-200 opened 2026-09-16, resolved 2026-09-16** (all Sonnet 5) for item 4's soft-class
audit. Runbook `AFLDB-ISSUE-200.md` written (planning); `tools/nl/audit-issue-200-extract.ts` and
`tools/nl/audit-issue-200-cluster.ts` (plus a shared constants module) written with DB-free unit
tests (implementation); the operator ran both scripts against the real
`/home/arm/nl-stress-v50-cleaned/` artifacts and found exactly six auto-clusters covering all 1,063
rows, and evidence-backed dispositions for all six were recorded in a checked-in mapping
(`tools/nl/issue-200-dispositions.csv`); **operator-validated resolution:** the final
`audit-issue-200-cluster.ts --apply-dispositions` run against the real
`/home/arm/issue-200-soft-audit.csv` reconciled exactly -- 1063 rows in, 1063 classified, 0
unmapped, 0 stale, `PLANNER_VALIDATOR_BUG` 598 / `STALE_CORPUS_EXPECTATION` 180 / `PARSER_BUG` 143 /
`GRAIN_EQUIVALENT_LEGITIMATE` 72 / `TAXONOMY_DRIFT` 70; local `tsc --noEmit` clean,
37/37 DB-free tests passed. No parser/planner/scorer code changed; neither external corpus file
modified. The three candidate defect follow-ons and the one guarded corpus-correction task (named in
`issues.md`) are recorded but not opened as tracked issues in this closeout.

**AFLDB-ISSUE-201 opened 2026-09-16, resolved 2026-09-16** (all Sonnet 5) for the first of those
follow-ons: the `PLANNER_VALIDATOR_BUG` `coverage_unavailable|boundary` cluster (598 rows).
`validatePlan` now exempts a `raw.boundary` plan from the career season-range rejection;
`player-career.ts` compiles the range against `c.debut_season`/`c.final_season`; `PARSER_VERSION`
50 → 51. Operator-validated: 774/774 focused unit tests, 33/33
`tests/integration/nl-answers.test.ts`, clean `tsc --noEmit`; stable-corpus rerun cleared 596 of the
598 rows, and the remaining 2 (id 9907, id 10294 — both "... Grand Final before 1897", `seasonMax`
genuinely one season before `NL_LIMITS.minSeason`) were confirmed stale corpus expectations, not
implementation defects, and corrected by a new guarded, self-verifying script,
`tools/nl/fix-issue-201-stale-boundary-expectations.ts` (17/17 unit tests passed). Final stable-corpus
result: 12,000 scored / 11,535 clean / 465 soft / 0 failed, with an independent diff confirming zero
collateral movement anywhere else in the corpus. See `issues.md` and `AFLDB-ISSUE-201.md` for the full
record. AFLDB-ISSUE-187..201 all now resolved.

Full entries, evidence, root causes and acceptance criteria are in `issues.md`.

## Stage 2 next task

1. **Done** (2026-09-16) — V1 regression corpus re-run against parser v49 (parse-only): hard
   failures 208 -> 178.
2. **Done** (2026-09-16) — fresh run's semantic rows compared against the retained v48 baseline:
   1271 -> 1241 non-clean rows, 30 rows became clean, 0 new non-clean rows, 0
   changed-but-still-non-clean rows. This comparison is what surfaced the Jones rows (§ above,
   AFLDB-ISSUE-198) as still-hard rather than clean.
3. **Done, resolved 2026-09-16** — the V1 12k corpus was re-run on parser v50: hard failures 178 ->
   173 (only the five Jones rows, 11626-11630, moved; confirmed clean via full semantic diff, zero
   collateral movement). The remaining 173 hard failures (5 Ablett + 112 team-streak + 56 coach-record)
   were all stale expected-decline rows predating shipped features. **AFLDB-ISSUE-199 resolved
   2026-09-16** — corrected via a checked-in, self-verifying script
   (`tools/nl/fix-issue-199-stale-expectations.ts`), operator-run against the real canonical CSV
   (`~/nl-stress-corpus.csv` on the dev host, which has no in-repo generator); `AMBIGUITY_NOT_DETECTED`
   173 -> 0, the three soft classes unchanged. See `issues.md` for full evidence.
4. **Done, resolved 2026-09-16 — AFLDB-ISSUE-200.** All 1,063 soft rows (`GRAIN_EQUIVALENT` 72,
   `UNEXPECTED_DECLINE` 921, `WRONG_FAILURE_REASON` 70) are classified into exactly six real
   clusters, operator-confirmed via the tool's own final `--apply-dispositions` run:
   `PLANNER_VALIDATOR_BUG` 598, `STALE_CORPUS_EXPECTATION` 180, `PARSER_BUG` 143,
   `GRAIN_EQUIVALENT_LEGITIMATE` 72, `TAXONOMY_DRIFT` 70 — no
   `intentional_conservative_decline`/`scorer_harness_artifact`/`duplicate_manifestation` clusters
   turned up in the real data. See `issues.md` for full evidence. Runbook: `AFLDB-ISSUE-200.md`.
5. **(a) done, resolved 2026-09-16 — AFLDB-ISSUE-201.** **(b) done, resolved 2026-09-16 —
   AFLDB-ISSUE-202**: a `PARSER_BUG` fix for "GWS"/"GWS Giants" leaking into unsupported-term
   detection on `team_match` margin questions (128 manifestations). Root cause was a missing
   combined alias (see `issues.md`/`AFLDB-ISSUE-202.md`); fix applied was the one-line
   `CLUB_NICKNAMES` addition, operator-validated against the retained V3 corpus (465 → 265 soft).
   The same fix also normalized all 72 `GRAIN_EQUIVALENT_LEGITIMATE` rows (GWS Giants player-season
   leading-goalkicker questions) to exact expected semantics as a byproduct, so that class is now 0.
   Stage 2 was **not yet** closed after (c): **(c) opened 2026-09-16 as AFLDB-ISSUE-203, resolved
   2026-09-16** (`PARSER_BUG` fix for the word "zero" not binding as numeric-zero in career conditions,
   15 manifestations, operator-validated, `PARSER_VERSION` 52→53); **(d) opened 2026-09-16 as
   AFLDB-ISSUE-204, resolved 2026-09-16** (guarded corpus correction for the 180
   `coverage_unavailable|fgf` disposals/marks/tackles finals/Grand Final rows that asserted a stale
   `expected_status=success` — two coverage floors, not one: disposals/marks before 1965, tackles
   before 1987 — retargeted after the first operator run failed closed on an over-broad 996-row
   selector, then two further fail-closed correction-tool bugs found and fixed; operator-validated:
   180/180 targets corrected, 0 non-targets touched, parser-v53 rerun 250→70 soft with the 180
   `UNEXPECTED_DECLINE` rows removed and zero new soft rows, `PARSER_VERSION` unchanged at 53).
   **Stage 2 is now closed** — (a)-(d) all resolved. The fresh exploratory Codex corpus sweep is now in
   scope, per the original Stage 2 boundary, as a separate not-yet-opened task.
6. **Opened 2026-09-16 as AFLDB-ISSUE-205, resolved 2026-09-16.** The 70 `TAXONOMY_DRIFT` rows were
   **not** accepted diagnostic drift after all — the audit found a real parser-ordering defect silencing
   an already-implemented team_match metric (42 rows, fixed, `PARSER_VERSION` 53→54) plus a genuine
   Q1-comeback feature gap (28 rows, stays declined with a corrected failure-reason label). Corrects, but
   does not reopen, Stage 2 itself. V5 corpus: 12000/12000 clean, 0 soft, 0 failed. See
   `AFLDB-ISSUE-205.md`.

Completed issue runbooks and supporting evidence are archived under `issues/closed/`.
