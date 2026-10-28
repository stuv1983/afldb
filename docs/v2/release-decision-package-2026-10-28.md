# V2 release decision package — 2026-10-28

**Production: NO-GO.** This package prepares the remaining owner decisions. It authorises nothing.
Prepared under the standing authority of the 2026-10-28 session. Production was not accessed. No
push, deployment, rebuild, provider fetch, migration, privilege or timer change took place. EXEC,
P/H, the frozen stores and all retained evidence were not modified.

Preparation actions, all outside production:
- native reads of the release records and scripts;
- one read-only, names-only credential-scope check on streamanator (§4.2);
- a self-test of the new classifier on **copies** of today's §10.5 reports, in the new directory
  `/home/arm/afldb-v2-classifier-selftest-20261028`;
- read-only hashes of the two stopped WSL disks (§4.1);
- one independent read-only review of the capture procedure (§2.7).

Sources: [ordered release plan](production-release-plan-2026-10-21.md) (the approved sequencing
record), [owner decisions of 2026-10-21](owner-decision-fresh-rehearsal-2026-10-21.md),
[D-V2-MIGRATION-SEPARATION](migration-acceptance-2026-10-20.md), [go/no-go](go-no-go.md),
[Linux verification](linux-verification-2026-10-28.md) and the ISSUE-316 record.

## 1. Gate table

Stages: **A** = V2 application, inert installation. **B** = production schema/data acceptance.
**C** = operational source retirement and the AFL API cutover. **D** = first authentic 2027
fixture ingestion. "Plan" means `production-release-plan-2026-10-21.md`.

| # | Gate | Stage | State | Required by the plan for |
|---|---|---|---|---|
| 1 | Integrated V2 code on Linux (full workflow, NL, browser, Brownlow B1/B2, ISSUE-265 Phase B) | A | **DONE**: 14,888 passed / 3 failed (GAP-029) / 63 skipped; rendered gate 1,844/1,844 | A |
| 2 | Known residuals: the 3 strict Gridley failures, lint debt, and the env-gated cases still not run (`external-grids-import`) | A | **Owner decision pending** (plan step 1, "accept known test/lint residuals"). Recording a residual is not a waiver | A |
| 3 | Owner visual acceptance (V2-GAP-022), merge of `v2/rebuild`, exact execution commit and production build hash | A | Pending | A |
| 4 | **Current-production shadow capture and report** (§2) | B | **READY FOR APPROVAL**: D-V2-CURRENT-SHADOW-CAPTURE-1 | B: production has drifted since archive `7fefcd9b…` (for example the 2026-10-24 U3 removal of PMS 705437), and step 5 says "drift requires a fresh migration rehearsal/acceptance" |
| 5 | Archive-bound owner acceptance of the new shadow's 116/117 deltas and its Brownlow comparator | B | Pending the gate 4 result. D-V2-FRESH-SCHEMA-1 and BROWNLOW-ALT-2 do not extend to a new archive | B |
| 6 | Window preflight; frozen, non-pruning backup with off-host copy and proven restore; comparison with the accepted shadow (A-BACKUP) | A+B window | Pending; separate window authority | A, B |
| 7 | A-REL (111–117 plus both staging default grants), target/revision-bound 116/117 schema approval, A-ROLLBACK, A-GO | A+B | Pending | A, B |
| 8 | A-AFLT: AFL Tables timer and polkit retirement; `legacy-writers` PASS | C, but **ordered before** A/B | Pending. Plan steps 3 and 5 put it before schema and code; the cutover preflight refuses release until it is done | A, B, C |
| 9 | Host prerequisites: Caddy/systemd/TLS, backup recovery routing (plan step 2) | A | Pending; own authority | A |
| 10 | C3 inert AFL API units (D-316-2) | C | Pending | C only |
| 11 | C4 / C4b / C5 (D-316-3, D-316-13, D-316-4) | C | Blocked until authentic 2027 rounds/venues are published and C4 is deployed | C only |
| 12 | ISSUE-229 B2 first fixture apply | D | Blocked until the first authentic 2027 pre-match feed, reviewed dry run and first-apply approval | D only |
| 13 | Brownlow operations: observe, backfill, adopt, eligibility, resolve (V2-GAP-030/031) | after A+B (plan step 10) | Five separate later approvals | After install; not A/B |
| 14 | Credential disclosure containment (§4) | hygiene | Stores stopped. The copy is marked; the original is unmarked (owner action) | No release stage |

**2027 evidence blocks rows 11 and 12 only.** It does not block A, B, the A-AFLT retirement or the
C3 inert install. The plan does require A-AFLT before the V2 install. Ending AFL Tables acquisition
during the 2026–27 off-season is the RISK-27 choice that A-AFLT records.

## 2. Current-production shadow capture (D-V2-CURRENT-SHADOW-CAPTURE-1)

Scripts (committed, LF, no BOM): [`capture-prod.sh`](evidence/current-production-shadow/capture-prod.sh),
[`transfer.ps1`](evidence/current-production-shadow/transfer.ps1),
[`shadow-restore.sh`](evidence/current-production-shadow/shadow-restore.sh),
[`expected-deltas.mjs`](evidence/current-production-shadow/expected-deltas.mjs). Their SHA-256
values are pinned in the approval prompt (§5). This procedure supersedes the 111–115 assumptions of
[`production-shadow-commands.md`](production-shadow-commands.md) for a current capture. That
file's layout and the contract it shares with the scripts remain.

### 2.1 Expected identities (any difference stops)

| Item | Expected |
|---|---|
| Production host | ssh alias `afldb` → `arm@209.38.87.252`, hostname `afldb-prod`, user `arm` |
| Cluster / database | PostgreSQL 16 (16.15 observed), `16/main`, port 5432; system identifier `7674454702926115004`; `afldb_prod`, OID `66668`, owner `afldb_owner` |
| Role | `afldb_backup`: not superuser, member of `pg_read_all_data`. The DSN is read from `AFLDB_BACKUP_DATABASE_URL` in `/home/arm/projects/afldb/.env` (mode 600) into `PG*` variables, never into argv or output. This is the channel of the 2026-10-24 U3 precheck and the 2026-10-27 census |
| Session | `default_transaction_read_only=on` for every connection; the identity row must read `transaction_read_only=on` |
| Extensions | exactly `pg_trgm=1.6 plpgsql=1.0 unaccent=1.1` |
| Ledger | exactly 110 rows, last `110_match_sheet_player_match_stats_authority.sql`; the name/checksum digest must be `789946fe…8f055153` (derived from the 2026-10-20 sidecar; the 2026-10-27 census also read 110) |
| Client | `/usr/lib/postgresql/16/bin/{pg_dump,pg_restore,psql}`; Node `/home/arm/.nvm/versions/node/v22.23.2/bin/node` (sidecar only) |
| Isolated host | streamanator `arm@10.0.40.100`; new root `/home/arm/afldb-v2-currentshadow-<STAMP>`; new cluster `afldb_v2_isolated` on **127.0.0.1:55467** (unused: today's roots used 55461–55466; nothing listened on 55460–55479 at 08:54Z); source = the Linux-verified `c478c31b` tree |

### 2.2 Procedure

**Production, P0–P8** (`capture-prod.sh`, streamed with
`cmd /c "ssh -o BatchMode=yes afldb bash -s < capture-prod.sh > capture.log 2>&1"`, then review
`capture.log`):

| Phase | Action |
|---|---|
| P0 | host, user and tool checks; the target directory must not exist |
| P1 | read-only `systemctl` state for app, settle, email and AFL API units. Stop if any writer service is running or the AFL Tables timer fires within 30 minutes. Record the deployed checkout and BUILD_ID |
| P2 | at least 2 GiB free under `/home/arm` |
| P3 | parse the credential; require `afldb_backup@localhost:5432/afldb_prod` |
| P4 | identity, extensions, ledger digest; inspection (AccessExclusive relation locks must be 0, visible active sessions, staging default ACLs, staged Brownlow seasons) |
| P5 | the **only host write**: new mode-700 `/home/arm/backups/afldb/current-shadow-<STAMP>/`. One `pg_dump --format=custom --compress=6 --no-owner --lock-wait-timeout=5s` under `timeout 900`, written as `.partial`, then TOC read and rename |
| P6 | the ledger is re-read and must be unchanged; writer state recorded again |
| P7 | sidecar `afldb_prod-<STAMP>.provenance.json` (exclusive create; no credential) |
| P8 | `SHA256SUMS` over the six files; `RESULT PASS stamp=… archive_sha256=…` |

**Transfer, T1–T3** (`transfer.ps1 -Stamp <STAMP>`): new local folder
`C:\Users\stuar\backups\afldb\current-shadow-<STAMP>\`, restricted to owner, SYSTEM and Administrators
as on 2026-10-20. `scp` reads from production, and every file is checked against `SHA256SUMS`. Then a
new root on streamanator receives the archive set and the two package scripts; `sha256sum --check
--strict` runs there.

**Isolated report, S1–S7** (`shadow-restore.sh <STAMP>`, run detached on streamanator):
- S1: hashes, sidecar fields and bytes re-checked.
- S2: private copy of the verified `c478c31b` source. Any shadow-path file that differs from its
  verified manifest stops the run.
- S3: new cluster, port proof, guard.
- S4: one restore, `--no-owner --no-privileges --exit-on-error --use-list`, excluding only the four
  `pg_trgm`/`unaccent` CREATE/COMMENT entries. The restored ledger must equal the sidecar's 110 rows.
- S5: migration copy cloned from the restored baseline, which stays unchanged. Before captures
  (preservation, manifest, row counts, Coleman 1980–2025, coverage, Brownlow per staged season).
  `--status` must list **exactly 111–117 pending**. Migrate, privileges, `0 pending.`, after captures.
- S6: parity compare, strict `release-gates.ts`, `expected-deltas.mjs`, archive re-check. A parity
  or release-gates exit of 0/1/2 (PASS/FAIL/INCOMPLETE) is kept as evidence. Any other exit, or no
  report file, is a tool failure and stops the run.
- S7: cluster stopped (both databases kept for review); evidence manifest.
- Completion and success are recorded separately. `evidence/shadow.done` records only that the
  process ended, with its exit code. `evidence/shadow.result` reads `SUCCEEDED` only for exit 0,
  and otherwise `FAILED exit=<n> stage=<step>`.

### 2.3 Bounds and stop conditions

- **Production load and locks.** One read-only `pg_dump`, with ACCESS SHARE locks for its
  duration (about 10 s on 2026-10-20, 29.8 MB). It waits at most 5 s for any lock; app reads and
  writes continue. There are a handful of short read-only queries.
- **Time.** The dump is killed at 15 minutes. P0–P8 are expected to take under a minute and are
  flagged for review over 20 minutes.
- **Stops.** Wrong host, user, identity, extensions or ledger; a running writer; the timer due
  within 30 minutes; an AccessExclusive lock; under 2 GiB free; any `pg_dump` error or stderr; an
  unreadable TOC; a ledger change during capture. A hash mismatch at any hop. A busy port. A
  shadow-path source difference. Any restore error (no retry over a partial restore). A pending set
  other than exactly 111–117.
- **Re-run.** Allowed once, only if the run stopped before P5 (no directory created). After P5,
  everything is retained and nothing is re-run without the owner.
- **Isolated-side stops added after review.** A failed staged-season query; a restored season list
  that differs from production's; more or fewer than 4 excluded TOC entries; a failed schema dump;
  a script or archive hash that differs from its pin.
- **Isolated-side failure propagation (pre-execution correction, 2026-10-29, §2.8).** These now stop
  the run with a nonzero exit:
  - any failed capture (preservation, manifest, row counts, Coleman, coverage, Brownlow per season),
    stop 6 before the migration and 7 after it;
  - a failed `--status` before or after the migration, failed privileges, or a schema-diff error
    (stop 7);
  - a missing, empty or unreadable verified source manifest, or any source-comparison error (stop 3);
  - a parity or release-gates tool failure, a failed archive or `xfer` re-check, a failed cluster
    stop, or a port still listening after the stop (stop 8).

  A classification other than `ONLY_EXPECTED_116_117_DELTAS` fails the run with stop 9. It is
  raised only after the re-checks and S7 have run, so the evidence and the stopped cluster are
  retained. On any stop after S3 has proved that the listener is this root's cluster, only that
  cluster is stopped. Evidence is kept and an evidence manifest is written. No database is dropped
  and no guard is changed.
- **Consistency.** The archive is one MVCC snapshot. Writers stay enabled, because there is no
  pause authority. The ledger is read before and after, outside the snapshot, and must be
  identical; the restored ledger is the in-snapshot value and must match.

### 2.4 Expected result: exactly the 116/117 differences

Expected, from the same tools on archive `7fefcd9b…` (2026-10-21) and on the retained `a583fc7d…`
(§10.5 today):

- **Preservation** FAIL, with exactly two findings:
  `staging.afl_api_brownlow_vote: DEFINITION_OR_RELATIONSHIP_CHANGED` (117: `eligible boolean NOT
  NULL` becomes nullable, with the UNKNOWN comment) and `public.brownlow_correction_receipts:
  UNAPPROVED_TABLE_ADDED` (116).
- **Parity** (`v2.parity.1`) FAIL: 3 pass, `table_row_counts` fails only on the receipt table
  ("absent before, present after (0 rows)…"). Brownlow is INCOMPLETE (`INPUT_MISSING`) if production
  still has zero staged seasons; P4 reports this.
- **Release gates**: `backendFunctional` PASS, `migrationCompatibility` FAIL, Brownlow alternative
  NOT_APPLIED, `productionDecision` NO-GO.
- **Rows.** Every existing row is identical, the ledger gains exactly 7, and the six new tables
  are empty. The 115 index and the 116 function and trigger belong to the accepted additions.

`expected-deltas.mjs` classifies this as `ONLY_EXPECTED_116_117_DELTAS` or
`UNEXPECTED_DIFFERENCES`. It is not an acceptance. Self-test on copies of the §10.5 reports:
positive `ONLY_EXPECTED_116_117_DELTAS`. Two negative controls are correctly
`UNEXPECTED_DIFFERENCES`: an extra lost-row finding, and a non-empty receipt table.

**Which acceptance remains required.** D-V2-FRESH-REHEARSAL-1, D-V2-FRESH-SCHEMA-1 and
D-V2-BROWNLOW-ALT-2 are bound to archive `7fefcd9b…` and source `a6400e7d…`.
`tools/v2/fresh-rehearsal-acceptance.ts` hard-codes that binding, so it will refuse the new
archive. After the report, the owner decides on a **new, archive-bound** acceptance with the same
shape: the exact 116/117 deltas, and an alternative for the unavailable staged Brownlow comparator.
That decision is bound to the new archive SHA-256, the candidate commit and 111–117. Only after it
may the acceptance tool gain a second binding, reviewed as a code change. Nothing is repinned from
observed output. An unexpected difference blocks schema acceptance and returns to the owner.

### 2.5 Not covered by this authority

Covered only: production access as described, the local export, and the streamanator root. Not
covered:
- any production write other than the one capture directory;
- any migration, privilege, timer, service, Brownlow or application action;
- deployment, push or provider fetch;
- use of this archive as the rollback baseline (the sidecar says so);
- deleting the remote or local archive copies.

### 2.6 Data handling

The archive includes auth and audit tables (RISK-14). The new archive would go to:
- production `~/backups/afldb/` (mode 700/600);
- the restricted Windows folder;
- one new streamanator root (mode 700).

Today's §10.5 already restored the older `a583fc7d…` production archive on streamanator.
**Approving this places a current production copy there too**, so it is named in the approval.
Removal of all three copies is a later owner action.

### 2.7 Independent review (one focused, read-only review; separate agent; 2026-10-28)

**Verdict: GO once MED-1 is fixed.** The review confirmed:
- every production database action is read-only;
- the only host write follows all pre-checks;
- no credential reaches argv or any file;
- the `pg_control_system()`, boolean, `migrate.ts` and `isolated-pg run` behaviours the scripts rely on;
- no archive-bound acceptance is extended to the new archive.

Dispositions:

| Finding | Disposition |
|---|---|
| MED-1: a failed staged-season query read as "no seasons" could yield a false ONLY_EXPECTED | **Fixed.** The query failure stops the run, and the restored season list must equal production's P4 value from the sidecar |
| MED-2: evidence is weaker than the `7fefcd9b…` acceptance (no normalised schema-section comparison, no 98-season stored-report comparison, no focused Linux checks, no measured drift outside the ledger) | **Partly fixed.** A complete schema-only dump of the migration copy before and after, plus `schema.diff`, is now evidence for the owner. **Remaining limits are stated for the owner**: no automatic classification of the schema diff, no 98-season stored-report pair, no archive-to-archive drift report against `7fefcd9b…`. The owner may require any of them before a new acceptance |
| LOW-1: an unparseable DSN could print the value | **Fixed**: the match runs first and the value is never printed. A synthetic test also exposed a latent percent-decoding error (an unescaped leading `%` anchors the bash pattern). It is **fixed here**, with escaped and plain values tested. The identical expression in the frozen historical `precheck.sh` is left unchanged; it worked because the real value has no escapes, and a wrong decode can only fail authentication |
| LOW-2: P8 failure could still print PASS | **Fixed** (stop 10) |
| LOW-3: the classifier tolerated a missing parity check | **Fixed**: the exact five check IDs are required; a third negative control proves it |
| LOW-4: pinned hashes were never compared | **Fixed**: `transfer.ps1` requires the archive SHA from `capture.log` and both pinned script hashes, and checks them locally and on streamanator |
| LOW-5: sidecar lacked operator, approval reference and seal | **Fixed** |
| LOW-6: the extension-exclusion count was not enforced | **Fixed** (exactly 4) |
| INFO: session count inflated for a non-superuser | **Fixed** (`state IS NOT NULL`) |
| INFO: other writers not gated; `--timestamp=unix` not certain (a fallback band exists); the dump stays on production with no retention rule | Accepted as stated. Removing the production copy is a later owner decision |

Post-fix: bash and PowerShell parse; all four files are LF with no BOM. The classifier
(`4f516cb8…`) gives the positive result on the §10.5 copies and correctly refuses all three
negative controls.

### 2.8 Pre-execution correction: failure propagation in `shadow-restore.sh` (2026-10-29)

**Defect.** Several required commands in `shadow-restore.sh` called `rc()`. That function records
the exit status and returns success, so a failed command did not stop the run, which went on to
write `shadow.done`. This covered every before/after capture, `--status`, privileges, parity,
release-gates, the classifier and the integrity re-checks.

The source-manifest comparison ignored errors. A missing manifest was reported as a "shadow-path
difference". If both manifests had failed to read, the comparison could have found no
differences.

**Correction** (`shadow-restore.sh` `f75ac6c6…` → `1530d24c…`; the other three files keep their
pins: `capture-prod.sh` `44609914…`, `transfer.ps1` `a0073e46…`, `expected-deltas.mjs` `4f516cb8…`):
- `req` records and stops. `report` keeps strict exit codes 0/1/2 as evidence, and stops on any
  other exit or a missing report.
- S2 checks the manifest's presence, reads and the `diff`/`grep`/`awk` statuses.
- The listener-ownership proof moved ahead of `roles`.
- An EXIT handler stops only that proven cluster on failure, writes the evidence manifest, and
  writes `shadow.done` (completion) and `shadow.result` (success).

No bypass switch exists. No strict result, classifier rule or expected-delta definition changed.

**Synthetic controls.** These ran on Windows Git Bash against temporary copies, with only the host
paths rewritten. Fake `node`/`ss`/`hostname`/`pg_restore` stood in for the tools; there was no
database, no network and no production. The pinned classifier ran for real on synthetic reports.

| Control | Corrected script | Original `f75ac6c6…` |
|---|---|---|
| 1. Required capture fails (`before.manifest`) | stop 6 in S5; no migration; owned cluster stopped; `FAILED` | exit 0, migration ran, `done` |
| 2. Source manifest missing / read error (EIO) | stop 3 in S2 ("missing or empty" / "unreadable"); no cluster created | stop 3, misattributed to a shadow-path difference |
| 3. Classifier rejects (an existing row changed) | `UNEXPECTED_DIFFERENCES`; re-checks and S7 ran; stop 9; `FAILED` | exit 0, `done` |
| 4. Documented expected-delta case | exit 0, `SUCCEEDED`, `ONLY_EXPECTED_116_117_DELTAS`; recorded `parity = 1`, `release-gates = 1`; parity FAIL with Brownlow INCOMPLETE, `migrationCompatibility` FAIL, NO-GO all retained | exit 0, `done` |
| Extra: parity tool error (exit 3) / release-gates exit 1 with no report | stop 8; `FAILED` | release-gates case: exit 0, `done` (parity case not run) |
| Extra: `roles` fails after the ownership proof / privileges fail | stop 4 / stop 7; owned cluster stopped | — |
| Extra: a shadow-path file differs | stop 3 | — |
| Extra: a Brownlow capture fails for a staged season | stop 6 | exit 0, `done` |

No control dropped a database or made an unexpected tool call.

**Not exercised by the controls** (correct by reading, per the review): failing `start`, failing
`stop`, a foreign listener, a schema-diff exit 2, and a failing `--status`.

**Review** (one focused, read-only review by a separate agent): **GO**, with no CRIT/HIGH/MED.
LOW and INFO items are accepted as stated:
- If `start` fails after the server has come up, or the listener proof fails, the new cluster is
  not stopped. Ownership is not yet proven at that point, so this is deliberate.
- The failure-path stop does not re-check the port.
- `shadow.log` is hashed while `tee` is still appending, so its manifest entry will not
  re-verify. This was already true of the original script.
- A `tee` failure in the ledger check is not detected.
- A stop 9 records `stage=S7`.

**MED-2 is not changed by this correction.** Its evidence limits remain open for the owner's later
acceptance decision: no automatic classification of the schema diff, no 98-season stored-report
pair, and no archive-to-archive drift report against `7fefcd9b…`.

## 3. Remaining release verdicts

### 3.1 By stage

- **A, V2 application / inert installation.** Code verification is done. Still required by the
  plan:
  - residual acceptance (row 2);
  - visual acceptance, merge, and exact artifact identity;
  - host prerequisites;
  - A-AFLT first (row 8);
  - schema and privileges (B);
  - A-REL, A-ROLLBACK and A-GO.

  ISSUE-316's successor rollover is activated in EXEC and integrated locally. The ISSUE-316
  record's own remaining list is: this shadow report, the `external-grids-import` archive, and the
  push and release decisions. ISSUE-316 stays open. Whether every element of plan step 4 is met for
  the installed artifact is confirmed at A-REL artifact review. 2027 evidence is **not** a
  prerequisite for A.
- **B, production schema/data acceptance.** Required:
  - the current shadow and its new archive-bound acceptance (rows 4–5);
  - then, in the window, the frozen backup compared with that accepted shadow (row 6). Any drift
    means a fresh rehearsal;
  - A-REL with 111–117 and both declarations, plus the 116/117 schema approval.

  The authentic Brownlow reconciliation stays required for Brownlow **operations** (step 10, go/no-go
  criterion 7). It is not a schema prerequisite.
- **C, operational source retirement / cutover.** A-AFLT is needed now, ordered before A/B. C3 is
  inert and independent of 2027 data. C4, C4b and C5 need authentic 2027 rounds and venues; C5
  activates only the match writer. These do not block A or B.
- **D, first authentic 2027 fixture ingestion.** ISSUE-229 B2 blocks only wiring and first
  applying the fixture writer. The plan states that an inactive-writer installation neither
  satisfies nor bypasses B2.

### 3.2 V2-GAP-029

**Preserved, unchanged:** 149 strict / 99 approved / **50 unapproved**. The **three strict Gridley
failures** are in `gridley-corpus` and were reproduced key for key on Linux today. Nothing was
waived, adjudicated or restated.

**Scope of D-V2-MIGRATION-SEPARATION (2026-10-20).** It is a **criteria decision**, not an archive
binding. GAP-029 stops being an *automatic backend-migration blocker* only when the evidence proves
all of the following:
- records, identifiers and relationships are preserved;
- coverage does not decrease;
- public results are equivalent;
- functional contracts hold;
- permissions, audit and rollback hold;
- every change is explained.

The decision does not approve any Gridley finding, any missing data or any production action.

The evidence that met those criteria so far is **archive-bound**: `a583fc7d…` 110→115
(BROWNLOW-ALT-1) and `7fefcd9b…` 110→117 (FRESH-REHEARSAL-1, SCHEMA-1, BROWNLOW-ALT-2). For
current production, the criteria must be shown again from the new capture (§2). That separation
does **not** carry forward automatically.

GAP-029 also remains a known **test residual** that the plan's step 1 asks the owner to accept or
reject at artifact lock (row 2). An acceptance would record the three failures as known and open;
it would not turn them into passes. GAP-029 stays OPEN as data-quality debt. Its 42 event cells
and 8 board-date cells still need source evidence.

### 3.3 `external-grids-import`

- **Current status.** The case `validates all 1,123 archived boards` (`tests/external-grids-import.test.ts:599`)
  is pinned to the rescued ISSUE-118 archive: 1,123 boards, #1–#1123, 2023-07-17 to 2026-08-12,
  no gaps. That archive is absent from both the workstation and streamanator, so the case's status
  is **NOT RUN — archive unavailable**. It is never a pass.
- **The later snapshot is not the same fixture.** The only available file is `D:\dev\afldb\data\afl.db`:
  537,010,176 bytes, sha256 `a56fef4e79f3583a5dfa773190412abd4b4a3eca347a8ec95de6d1b960eac547`,
  mtime 2026-08-14. It is a different, later snapshot: 1,124 boards, #1–#1125 with one gap.
- **Release relevance.** The plan names no `external-grids-import` gate, and the case is skipped by
  design when its archive is absent. It is a residual under row 2, not a release blocker.

**Minimum owner decision** (X-GRIDS-1), only if this coverage is wanted:
1. Keep the original case and its 1,123-board oracle unchanged. Its status stays NOT RUN until
   the rescued archive itself is supplied.
2. Register `a56fef4e…` (exact bytes and size) as a **separately versioned fixture**, "Gridley
   archive, audited local copy 2026-08-14". Give it its own opt-in variable and its own case,
   refusing any other file by hash.
3. Its expected values come from an **independent oracle**: direct read-only SQLite queries of the
   board table (count, number range, the missing number, date range, duplicates). These are
   reviewed before pinning, not copied from the importer's output. The owner states whether the
   one gap is accepted for this version.
4. The later version does not satisfy or replace ISSUE-118's 1,123-board evidence.

## 4. Credential disclosure (2026-10-28, §10.2 of the Linux record)

### 4.1 Affected stores

Values were never printed or reread here.

| Store | Identity | State (verified 2026-10-28) |
|---|---|---|
| Frozen original | WSL `AFLDB-V2-Rehearsal-20261020`, base `D:\afldb-v2-rehearsal-20261020`, `ext4.vhdx` (hash below); isolated cluster `afldb_v2_isolated`, 127.0.0.1:55434 inside netns `afldb-v2-rehearsal`. It holds production-derived databases, including the 2026-10-20 production restore with auth tables, and the authentic 2025 Brownlow template | **Stopped**. **Unmarked**: it was not written, because marking it would change the frozen disk |
| Copy | WSL `AFLDB-V2-BrownlowExport-20261028`, base `C:\afldb-v2-brownlow-export-20261028`, about 38 GB; copy cluster 127.0.0.1:55471 with the **same** role passwords | **Stopped**. `secrets/CREDENTIALS-EXPOSED` was written at the time; it was not re-verified, because that needs a boot. Its second cluster (55473, fresh credentials, used for B1 attempt 3) is not exposed |
| Disclosure record | The operator session output: local Claude Code transcripts under `C:\Users\stuar\.claude\projects\D--dev-afldbV2\` dated 2026-10-28 (most likely `d2922e67-….jsonl`, which also holds the §10.5 scripts), and the conversation as processed by the model provider | Not reread or altered |

Disk hashes, taken read-only on 2026-10-28 with both distros stopped:
- **Original** `D:\afldb-v2-rehearsal-20261020\ext4.vhdx`: 37,885,050,880 bytes, mtime
  2026-10-25T23:15:52Z, sha256 `589597c58cfda75561babb5f19bdc5dc1da63c771981936a190f975e78c3b4af`.
  This equals the size, mtime and `589597c5…` prefix recorded before and after the copy, so the
  original is **unchanged**.
- **Copy** `C:\afldb-v2-brownlow-export-20261028\ext4.vhdx`: 40,905,998,336 bytes, mtime
  2026-10-28T05:38:12Z, sha256 `d01de81d5fb500658a59b5bdcbec4d7af7637946f351dbbe9095a38d26b277d9`.
  It grew after booting, as expected.

### 4.2 Reuse scope

- **Not affected.** Checked by member names only on streamanator at 08:54Z:
  - the exported template dump `5be45eab…` (`pg_dump` never contains role passwords);
  - `fixture-root.tar` (483 members) and `acquisition-014218.tar` (4), with no secret-like members;
  - `src-b1.tar` (source and `.env.example` only);
  - the local `D:\tmp\afldb-v2-b1wsl-20261028` copy (no secret files);
  - the streamanator verification cluster 55464 (its own fresh `roles.json`).

  Nothing listened on 55460–55479.
- **Production and DEV.** `isolated-pg` generates every cluster's passwords with
  `randomBytes(24)` at `roles` time. No record shows these clusters ever being given production or
  DEV credentials. The values were not compared, because that would mean reading secrets.
- **Exposure surface.** Loopback-only listeners, in stopped distros, on this workstation. Anyone
  able to boot either distro can already read its data files directly, so the passwords add little
  beyond filesystem access. They are still treated as compromised.

### 4.3 Containment and replacement proposal (C-CRED-1; needs explicit authority)

1. **Keep** both distros stopped and unused. Record the original as credential-exposed in this
   package, which is done by this commit, without writing its disk. Any future use of the template
   starts from a **new copy**, never the original.
2. **Replacement for future use** (only if the template is needed again). In a fresh copy, rotate
   **offline** before any listener starts:
   - `postgres --single` on the copy's data directory, with the network namespace and no TCP;
   - `ALTER ROLE … PASSWORD` with precomputed SCRAM verifiers, never plaintext;
   - new `secrets/`, then remove the marker in that copy only.

   `isolated-pg rotate-credentials` cannot be used: it needs a live listener, and the marker
   correctly refuses it.
3. **Original**: leave it unchanged. Optional and owner-only: set the read-only attribute on its
   `ext4.vhdx`. That is file metadata, and the hash is unchanged.
4. **Copy**: `wsl --unregister AFLDB-V2-BrownlowExport-20261028` removes the copy and the
   credentials inside it. Its B1 evidence is already preserved locally (manifest `34cf4f8e…`).
   **This does not resolve** the same credentials in the frozen original or the transcripts.
5. **Transcripts**: deleting or redacting session files is the owner's choice and destroys session
   history. Without it, the values remain recoverable from those files. Containment rests on (1)
   and (2), not on deletion.

Nothing in §4.3 is executed by this package: no mutation, rotation or deletion.

## 5. Approval prompt for the next executable phase

To approve, paste the block below into the chat. Edit nothing in it except to strike an item you
withhold.

```text
D-V2-CURRENT-SHADOW-CAPTURE-1 — APPROVED by the owner, effective from this message.

Validity: this chat session only, while I am active in it. Execution starts in this session
immediately after this message. There is no calendar window. If this session ends, or I state that
I am leaving, stop at the next phase boundary (after P8, T3 or S7) and report. A new session needs
a new approval.

Pinned inputs (stop if any differs before use):
  capture-prod.sh      44609914b403ab4bdea2704f45a14c7db34c164e544914827ece0aa3d1df13c2
  transfer.ps1         a0073e466f632b75dd89621b3df511a28c8148d066987fb122a5b991b7114df4
  shadow-restore.sh    1530d24c53e7ccc20aa14eb2952784c33470576a85c5cbe55476d7ce753915df
  expected-deltas.mjs  4f516cb8d73e6380f9d8bb5baf4b93b5cbf4f390b5ba4b0f48d2ad3e69777ec1
  (docs/v2/evidence/current-production-shadow/, branch v2/rebuild)
  Shadow source: the Linux-verified c478c31b tree on streamanator. Before S2, confirm
  `git diff --quiet c478c31b HEAD -- tools/v2 tools/db src packages docs/v2/preservation-queries.json
  docs/v2/migration-functional-evidence.json package.json package-lock.json tsconfig.json`.

1. PRODUCTION, read-only capture, once. Stream capture-prod.sh to ssh alias `afldb` (afldb-prod,
   arm). Database access only as afldb_backup via AFLDB_BACKUP_DATABASE_URL from
   /home/arm/projects/afldb/.env, in PG* variables, never argv or output, every session read-only.
   Required identity: system 7674454702926115004; afldb_prod OID 66668, owner afldb_owner;
   PostgreSQL 16; extensions pg_trgm 1.6 / plpgsql 1.0 / unaccent 1.1; ledger exactly 110,
   digest 789946fe…8f055153.
   One full pg_dump: custom, compress 6, --no-owner, --lock-wait-timeout=5s, 15-minute kill.
   The only production write: new mode-700 /home/arm/backups/afldb/current-shadow-<STAMP>/.
   Re-run once only if it stopped before P5.

2. EXPORT, then the ISOLATED HOST. transfer.ps1 copies with scp to the new restricted
   C:\Users\stuar\backups\afldb\current-shadow-<STAMP>\, then to the new streamanator root
   /home/arm/afldb-v2-currentshadow-<STAMP>. All hashes are checked. A current production copy
   with auth/audit data may be held at these three locations, in restricted modes, outside Git.

3. ISOLATED SHADOW on streamanator only. shadow-restore.sh: new isolated-pg cluster on
   127.0.0.1:55467, two new _test databases. One restore. Migrations exactly 111-117 and the
   privileges reconciliation, on the clone only. Captures, schema dumps, parity, release-gates,
   the expected-delta classification. Then stop the cluster and keep the databases and evidence.
   The run succeeded only if evidence/shadow.result reads SUCCEEDED. shadow.done records only
   that the process ended. A FAILED result is a stop: report it and do not re-run.

4. RECORD. Add a sanitised result record and tracking updates to the repository; commit them
   selectively. No raw rows, archives or credentials go into Git.

Stop conditions: those in docs/v2/release-decision-package-2026-10-28.md §2.3. Report every stop;
do not work around one.

NOT authorised: any other production access or write; migrations, privileges, default grants,
timers, services, Brownlow operations or application changes on production; deployment; push;
provider fetches; rebuilds; deleting any archive copy or store; using this archive as the rollback
baseline; and accepting the result. Acceptance of the report (a new archive-bound 116/117 and
Brownlow-comparator decision) is a separate owner decision after review. Production remains NO-GO.
```

Expected duration: P0–P8 under 1 minute (20-minute review flag). Transfer a few minutes. The
isolated shadow takes about 30–60 minutes, like the §10.5 run.
