# Current-production shadow follow-up — 2026-10-29 (D-V2-CURRENT-SHADOW-FOLLOWUP-1)

**Result: every authorised item ran, except the full archive-to-archive drift report against `7fefcd9b…` (item 7).
That report is blocked at full scope and a bounded aggregate comparison is given instead. No unexpected
semantic difference was found.** The strict results of the original run are unchanged: preservation FAIL,
parity FAIL (3/1/1), `migrationCompatibility` FAIL, staged Brownlow INCOMPLETE, `productionDecision` NO-GO.
No acceptance is recorded and no binding was added. **Production remains NO-GO.**

> **Approved, 2026-10-29:** the owner approved the three §9 decisions exactly as scoped, with their limits
> (D-V2-CURRENT-REHEARSAL-1, D-V2-CURRENT-SCHEMA-1, D-V2-BROWNLOW-ALT-3; migration evidence for `a4641ca0…`
> only). They are recorded, and bound in `tools/v2/fresh-rehearsal-acceptance.ts`, in
> [the owner decision record](owner-decision-current-rehearsal-2026-10-29.md). The measured run of that binding
> over the retained evidence passed on 2026-10-29 (D-V2-CURRENT-ACCEPTANCE-RUN-1, that record §10). This record
> is kept as written. Production remains NO-GO.

Executed under the owner's approval D-V2-CURRENT-SHADOW-FOLLOWUP-1 (Claude Code session, 2026-10-29 AEDT). It
completes the bounded follow-up recommended in [the shadow report](current-production-shadow-2026-10-29.md) §9.
Starting HEAD `33547c26` on `v2/rebuild`.

Sanitised evidence is in
[`evidence/current-production-shadow/followup-20261029/`](evidence/current-production-shadow/followup-20261029/).
Its hashes are in `COMMITTED-SHA256SUMS`. All 52 committed evidence files equal their entries in the host manifest. Files added after the independent
review (§10: `grant-exact.json`, `scripts/grant-exact.mjs` and `controls/`) are local, files-only results and
are not in the host manifest.

## 1. Scope, identities and bounds

| Item | Value |
|---|---|
| Host / root | streamanator, user `arm`; `/home/arm/afldb-v2-currentshadow-20261028T192336Z` only. New output directory `followup/`; its `evidence/` is created mode 700 |
| Archive / sidecar | `a4641ca0d1533c30d6670dfa9b555552548a91b736054e941adba75cee0c46fc` / `72f000462a2e7560afee97edf5598723a2ccfa45c9664e7d57ce7b62dddb57d4`. Both were checked in `archive/` and in `xfer/` (`xfer/SHA256SUMS`, all six entries) before and after the run |
| Original evidence | Manifest `ea197fcf40c1b27108bebb1cc9b0a6523e8d79804952f77610f5f4606ac8ac75`, unchanged before and after. On re-check, 37 of 38 entries verify. The only failure is the disclosed live-log entry `shadow.log`, whose final copy still hashes `99b6e575…`. The runner required that this be the only failure, and the limitation is preserved, not repaired |
| Source | The verified private `c478c31b` copy was reused read only, and S2 was **not** repeated. Every non-`node_modules` file (3,722) was re-hashed and equals the run's S2 manifest. Migrations 111–117 equal the seven `FRESH_ACCEPTANCE` pins, there is no migration after 117, and there is no `.env` |
| Runtime | Node v22.23.2 (sha256 `3517c2df…`), PostgreSQL 16.15, Ubuntu 24.04 |
| Cluster | Only the owned cluster was restarted. It had no `postmaster.pid` and no `CREDENTIALS-EXPOSED` marker, and 55467 was free beforehand. Listener `127.0.0.1:55467`, pid 227045, data `-D <root>/cluster/data`. It was stopped afterwards and 55467 is free |
| Space | 10,490,785,792 bytes free at runner start (`space-before.txt`). Budget for the two clones: 3 × 398,605,335 + 1 GiB = 2,269,557,829, with a 2 GiB floor; it passed. 10,448,703,488 bytes free at runner end (`space-after.txt`). Session observations not in the manifest: 10,491,510,784 free at preflight; at sealing, the root was 3,159,668,400 bytes, `followup/` 8,265,968, and 10,449,297,408 free. Nothing retained was removed |
| Timing | Runner 2026-10-28T20:49:09Z–20:50:14Z. `followup.result` SUCCEEDED means the runner completed; by design it does not gate on item results, and three item exits are non-zero (`inventory-compare` and `inventory-equals-tar-members`, attempt 1, §7; `it-privileges`, §5). Attempt 2 of two file-only comparators ran 20:52:19Z–20:52:20Z (§7) |
| New manifest | `followup/evidence/evidence-sha256.txt` **`30b1a2be9757dfca491aa6b72ade183e2237f90759babbbd6a705a950143d010`** (61 files). `seal.sh` took it only after the runner had ended, the cluster was stopped and two listings 5 s apart were identical. It then re-verified the manifest. In this session the copy was also re-verified locally (61/61); that check is not itself retained. The complete runner log is retained inside the evidence as `followup.log`, so no entry hashes a file that was still being written |

Retained databases (`afldb_v2_shadow_current_baseline_test`, `_migration_test`) were measured only in read-only
transactions or with `pg_dump`. What was measured at the end:
- **Schema.** Dumps at the start and at the end equal the run's `before.schema.sql` and `postmig.schema.sql`,
  apart from the per-dump `\restrict` token lines. Owners are not in these dumps (`--no-owner`).
- **Receipt catalogue.** The read-only probe on the migration copy gave byte-identical results at the start and
  the end (`f1f951a9…`).
- **Not re-measured at the end:** data content and the baseline copy's catalogue probe. The Brownlow reports
  and other measurements were taken once, between start and end.
- **Physical size.** Each database's `pg_database_size` is exactly 162,312 bytes larger after the first
  connection than at the pre-connection listing:
  - baseline 392,962,575 → 393,124,887;
  - migration 398,443,023 → 398,605,335.

  It is unchanged from then to the end. The identical increment on both suggests the per-database
  relation-cache init file that PostgreSQL writes on first connection after a restart. That is probable, not
  verified.

Both clones were new, marked, and created from the migration copy:
- `afldb_v2_shadow_current_fuprobe_test`;
- `afldb_v2_shadow_current_fuit_test`.

They took every write, and both were dropped through `isolated-pg drop-db --acknowledge-destroy`.

Not done: production access, recapture, deployment, push, rebuild, provider fetch, any production Brownlow
operation, frozen-material change, archive deletion. No guard was lowered, and the original S3 10 GiB guard
was not re-invoked because S2 and S3 were not repeated. ISSUE-327 stays parked.

## 2. Item 3 — the 783 additional source files: explained, no effect on the evidence

**Origin.** The S2 copy came from `/home/arm/afldb-v2-linuxverify-20261028T0310Z/src` and was compared with
that root's `evidence/src-c478c31b.files.sha256` (`a08b7f64…`, 2,939 files). That root's `setup.sh` (2026-10-28 §9 Linux
verification) works in this order:
- line 55 writes the manifest;
- line 61 extracts the approved `inputs.tar` (`42822c75…`, recorded in the committed
  [Linux verification JSON](evidence/linux-verification-2026-10-28.json)) into the **same** tree;
- line 62 checks it against `inputs.sha256` (`b64c8a75…`); `setup.log` reports `inputs OK (785)`.

**Anchor chain.** Only the tar hash `42822c75…` has an earlier committed record. These hashes are recorded for
the first time here (`inventory-origin.txt`), from the host:
- the inventory `b64c8a75…`;
- the verified manifest `a08b7f64…`;
- `setup.log` `f1d5c098…`;
- `setup.sh` `e35ba0e9…`.

Attempt 2 compares the tar's member **names** with the inventory, not member contents. The link from the tar's
contents to the inventory hashes is the host `setup.log` line `inputs OK (785)`, written by line 62's
`sha256sum -c` immediately after extraction.

**Comparison** (`inventory-comparison.attempt2.json`):
- All **783 of 783** additions match the approved inventory by full path **and** hash.
- No addition is missing from the inventory or has a different hash.
- None changed since S2, and none is on a shadow path.
- No verified file is missing from the copy or differs from it.
- The tar members equal the inventory exactly.
- The two inventory entries that are not additions are tracked `c478c31b` files whose hashes are identical
  (`data/sources/afltables/coaches/coaches-20260905/parsed/{coach_pages,coaches_index}.csv`).

**Effect.** All 783 are under `data/sources/` (782) or `data/records/` (1). No shadow-run tool reads them:
- the captures read the database;
- `coverage-export` reads only `data/reference/seasons.json` and five tracked documents (its registry's
  evidence paths);
- migrations come from `src/db/migrations`.

**Unexplained files: none.**

**Record defect found (LOW).** Five of these paths contain spaces: four `data/sources/Hall of Fame/*.csv` and
`data/sources/representative teams/VFLAFL_Team_of_the_Century.csv`. The run's S2 step
(`awk '{print $1, $3}'`) cut each one at its first space, so the committed `src-vs-c478c31b-manifest.diff`
records them as `./data/sources/Hall` (four times) and `./data/sources/representative`. Attempt 2 reproduces
the committed diff exactly from the complete manifests under that truncation.

The S2 shadow-path guard was not weakened by this. A truncated path keeps its leading directories, so a file
under a shadow path would still have matched. The committed diff is preserved unchanged.

## 3. Item 4 — receipt permissions and normalised schema sections

**4a. Read-only catalogue probe** (`receipt-catalog.migration.json`, 25/25 checks). Every expectation is taken
from the pinned 116/117 text:
- **Receipt table.**
  - Owner `afldb_owner`; 0 rows; `relacl {afldb_owner=arwdDxt/afldb_owner}`, so there is no PUBLIC entry.
  - The eight columns exactly as in 116. Every column is NOT NULL, and `applied_at` defaults to
    `clock_timestamp()`. A primary key plus four checks, and the exact comment.
- **Effective table privileges** (`has_table_privilege`): none for `afldb_app`, `afldb_import` or `afldb_auth`.
  `afldb_backup` has SELECT only, through its `pg_read_all_data` membership, not through a table grant.
- **Function.** `refuse_brownlow_receipt_mutation()` is SECURITY INVOKER, plpgsql, returns trigger, and has
  `proacl` NULL (default PUBLIC EXECUTE; 116 grants or revokes nothing on it).
- **Trigger.** `brownlow_receipt_immutable` is enabled (`O`) with `tgtype` 58: BEFORE, FOR EACH STATEMENT, on
  UPDATE, DELETE and TRUNCATE.
- **117.** `staging.afl_api_brownlow_vote.eligible` is a nullable boolean with no default and the exact
  UNKNOWN comment; 0 rows, 0 NULL.
- **Baseline-110 copy** (5/5): the same column is NOT NULL, without the 117 comment.

**4b. Actual-role mutation probe on a NEW disposable clone** (`receipt-mutation.json`; each attempt in its own
transaction, always rolled back):
- **12/12** INSERT, UPDATE, DELETE and TRUNCATE attempts by `afldb_app`, `afldb_import` and `afldb_auth`
  were denied with `42501`.
- **3/3** owner UPDATE, DELETE and TRUNCATE attempts were refused by the trigger (`P0001`, "Brownlow
  correction receipts are append-only").
- The owner's synthetic insert was visible inside its transaction. An UPDATE with that row present was also
  refused, and after the rollback the count was 0 again.

This is the same profile as the `7fefcd9b…` record: 12 denials, 3 refusals, the synthetic insert rolled back.

**4c. Normalised schema sections** (`schema-sections.attempt2.json`; files only). The inputs are:
- the archive's own DDL and ACLs, from `pg_restore --schema-only --no-owner -f`, with no database involved;
- the run's before and after dumps.

Normalisation is limited to five things:
- dropping the `\restrict` token lines;
- dropping blank and `--` lines;
- trimming trailing whitespace;
- sorting the lines inside each ACL section;
- **ignoring ownership.** All three inputs are `--no-owner`, and the section key leaves out the `Owner:` field,
  so object ownership is not compared (see Limits).

The comparison:

| Comparison | Result |
|---|---|
| A. Archive → restored baseline (non-ACL) | **1,194 / 1,194 sections identical**; nothing only on one side; nothing changed |
| B. Baseline → migrated (non-ACL) | 1,193 unchanged, **0 removed**. **1 changed:** `staging.afl_api_brownlow_vote`, exactly `eligible boolean NOT NULL,` → `eligible boolean,` (117 `DROP NOT NULL`). **71 added:** 6 tables, 9 constraints, 10 FK constraints, 19 indexes, 5 sequences, 20 comments, 1 function, 1 trigger. **All 72 differences are MIGRATION_SUPPORTED by a pinned 111–117 statement. 0 UNCLASSIFIED** |

Two of the B rows need a note:
- **The 115 index** is matched by its name in the pinned file.
- **The 117 comment** is a comment on a pre-existing column, so it is matched by its exact statement **and
  its text**. A negative control with changed text was reported UNCLASSIFIED
  (`controls/schema-sections/neg1.sql`, `attempt1.neg1.json`).

**Permissions omitted during restore, counted separately.** The restore used `--no-privileges`, so the
baseline dump has no ACLs except the default `SCHEMA public` one.
- **Archive ACLs.** The archive holds 193 ACL sections (production's stored ACLs at capture). **All 193 are
  identical** to the migrated copy's ACLs after `tools/db/privileges.ts` reconciliation. None differs, none is
  missing, and none exists only in the archive.
- **New objects.** The migrated copy's other 16 ACL sections (21 GRANT/REVOKE lines) all belong to objects
  that 111–117 added. **Every line is matched to a pinned 111–117 statement.** The 4c comparator matches
  only verb, object and grantee for these lines, not the privilege list (review MED-3, §10). A separate local
  check closes that gap: `scripts/grant-exact.mjs` → `grant-exact.json`. It compares each line's exact
  privileges, per column for column grants, with the pinned statements, including grants inside `DO` blocks.
  - **21/21 match exactly.**
  - Three negative controls were each reported unmatched, and nothing else was (`controls/grant-exact/`):
    - a widened table grant;
    - an extra column grant;
    - a new grantee.
- **Default ACLs.** The archive has none, and neither does the migrated copy. In particular there are no
  staging default ACLs; see §5.

**Limits.**
- This compares **stored ACLs**. It is **not** a comparison of actual production effective permissions.
- **Object ownership was not compared.** Restored ownership is not compared with production ownership; the
  only exception is the receipt table's owner, checked in 4a.
- Production role attributes, memberships, passwords and superuser state were not compared.
- The role facts above (no AFLDB role is a superuser; only `afldb_backup` is in `pg_read_all_data`) are the
  isolated cluster's roles.
- The section comparison is not byte-comparable with `7fefcd9b…`'s `schema-sections.json` (`518115f1…`). That
  file's format and script were not available under this authority. The comparable figures agree:
  - no section removed;
  - the same single changed existing section;
  - 5 added sequences;
  - the same total of added sections: 87 there, and 71 + 16 = 87 here (non-ACL plus new-object ACL
    sections). That record gives only the total (`addedSchemaSections: 87`), so whether its composition
    matches is unknown.

## 4. Item 5 — complete 98-season stored Brownlow report pair

`brownlow-stored.mts` reuses the verified `c478c31b` read path unchanged:
- `shadow-award-reports.ts`'s session: one REPEATABLE READ READ ONLY transaction on a read-only connection,
  with its state read back, a SELECT-only guard, and an unconditional rollback;
- `loadBrownlowReconciliationInput` with `storedOnlyFallback`, and `stored_eligible_rank_one`;
- `reconcileBrownlowSeason`, and the report validator and serialiser;
- a fixed report time and the unchanged season registry.

It covers every season present in `brownlow_season_votes`.

| | Baseline-110 copy | Migrated-117 copy |
|---|---|---|
| Seasons | 98 (1924–2025) | 98 (1924–2025) |
| Outcomes / presentation | 98 `reconciled` / 98 `determined` | identical |
| Basis / findings / errors | 98 `stored_totals` / 0 / 0 | identical |
| Staged API vote records | 0 | 0 |
| Source rows | season votes 16,120; round votes 330,383; staged votes 0 | identical |
| Report SHA-256 | `e2df67aee27df89d6723681fbd0cdda1938a4311c11fd96b7df69f1a1d5c98aa` | **byte-identical** |

No season is missing or changed. The report is labelled `stored-only-alternative-NOT-staged-comparator`. It proves
that stored totals, rank, eligibility and published outcome read the same across 110→117. It does **not** exercise
real API vote-set identity or API-versus-stored reconciliation.

Its hash cannot be compared with `fea86e5d…` (the `a583fc7d…` and `7fefcd9b…` pair), for two reasons:
- that pair came from a different script (`followup-brownlow.mts`) and source revision, retained only in the
  restricted 2026-10-20 store and not available under this authority;
- this report embeds its own archive SHA (`brownlow-stored.mts`), so its bytes could never equal another
  archive's. The report bodies (2.5 MB each) stay on the host, hashed in the
manifest. Only their summaries are committed.

## 5. Item 6 — focused Linux checks (generic functional tests, kept apart from the archive measurements)

| Check | Target | Result |
|---|---|---|
| Units: `v2-brownlow-eligibility` 65, `v2-brownlow-reconciliation` 59, `v2-shadow-award-reports` 59, `v2-shadow-capture` 82, `v2-shadow-parity` 171, `v2-shadow-target` 72 | No database (all DSN variables unset) | **508/508**, 0 skipped |
| `tests/integration/v2-brownlow-eligibility.test.ts` (synthetic seeded fixtures) | New clone `afldb_v2_shadow_current_fuit_test` | **47/47** |
| `tests/integration/privileges.test.ts` | Same clone | **42/43: one finding, kept as FAIL** |

The failing case is "AFL Tables settle projections are privileged like the rest of staging › inherits that from
migration 014, whose default privilege is pinned here". It expects `pg_default_acl` to hold afldb_owner's two
staging entries (afldb_app SELECT, afldb_import DML+TRUNCATE), and it found **none**.

That is the archived production state, not a 111–117 effect:
- production had 0 staging default ACL entries at capture ([shadow report](current-production-shadow-2026-10-29.md)
  §2, "Inspection"), and the archive itself holds no DEFAULT ACL section (§3 above);
- the two future-table policies are approved (D-V2-STAGING-IMPORT-DEFAULT-1 / APP-DEFAULT-1), but their
  production declarations remain absent and their execution is unauthorised;
- the `7fefcd9b…` run added them "on rehearsal clone only before capture"
  (`fresh-production-rehearsal-2026-10-21.json`, `sourceAclDifference`), and so did the 2026-10-20 rehearsal
  (`linux-rehearsal-2026-10-20.md`, "Application and database rollback", item 4); that is how those suites reached 43/43;
- this run did not install them, because that would have normalised the finding away.

The other 42 cases, including the receipt and new-table privilege assertions, pass.

Not comparable with `7fefcd9b…`'s "306 units": that set's composition is not recorded in Git.

## 6. Item 7 — archive-to-archive drift against `7fefcd9b…`: BLOCKED at full scope; bounded aggregate instead

**Why it is blocked.** The `7fefcd9b…` archive (29,776,493 bytes) is not on streamanator. A search of
`/home/arm` (a session observation; the search output is not retained) found only:
- this archive;
- `a583fc7d…`;
- an older 2026-09-28 off-host dump.

Its other copies are on production (no access) and in the restricted Windows folder. Its preservation snapshot is
in the WSL rehearsal store. Copying a production archive to a new host, or opening that store, is outside this
streamanator-only authority. So no per-table or per-row drift report exists.

**What was measured** (`drift-summary.json`, against the committed
[fresh-rehearsal record](evidence/fresh-production-rehearsal-2026-10-21.json)):

| | `7fefcd9b…` (2026-10-20) | `a4641ca0…` (2026-10-28) | Δ |
|---|---|---|---|
| Baseline tables | 99 | 99 | 0 |
| Rows including the ledger | 1,659,904 | 1,659,922 | **+18** |
| Ledger | 110 | 110 (110-row digest `789946fe…`, from the capture sidecar and the [shadow report](current-production-shadow-2026-10-29.md) §2, not from `drift-summary.json`) | 0 |
| Stored Brownlow seasons | 98 | 98 | 0 |

The +18 net is real drift between the two captures. It cannot be attributed by table or row here. A net count
cannot rule out offsetting inserts, deletes or content changes. The known 2026-10-24 U3 removal of PMS 705437 lies
inside this interval. The current per-table counts are committed for a later comparison.

## 7. Attempts and corrections (disclosed)

Two file-only comparators had defects in attempt 1. Both attempt-1 outputs are kept unchanged in the evidence,
beside attempt 2 (`attempt2.sh`, `SCRIPTS2.SHA256`, `attempt2.log`). Each correction changes parsing only: no
threshold, no expectation and no evidence input.

1. **`inventory-compare.mjs`** read paths from the truncated S2 diff (§2). It reported 778 matched and 5
   "not in inventory", with exit 1, and its tar-member check split names at spaces.
   Attempt 2 derives the additions from the complete manifests and reproduces the committed diff.
2. **`schema-sections.mjs`** looked up pre-existence by section name. pg_dump names a function's DDL section by
   argument types (`assert_viable_super_admin_actor(integer)`) but its ACL section by argument names
   (`(p_actor_id integer)`). So the pre-existing function's ACL was misfiled as a "new object", giving 192/193
   equal and 2 unmatched lines. Attempt 2 instead treats an ACL as belonging to a new object only if B added that
   object; every other ACL must equal the archive. The result is 193/193 equal and 0 unmatched.

The schema comparator's controls were run locally on small synthetic fixtures before use (attempt 1), and again
after the correction (attempt 2). They are now retained in `controls/schema-sections/` (inputs and outputs) and
are not in the host manifest. Each negative was reported:
- `neg1`: a changed 117 comment, UNCLASSIFIED;
- `neg2`: an extra column change, UNCLASSIFIED;
- `neg3`: an unknown table, UNCLASSIFIED;
- `neg4`: a widened grant, reported as a pre-existing ACL differing from the archive.

`neg4` targets a **pre-existing** table. The comparator would not have caught a widened grant on a **new** object.
The separate exact check in §3 closes that gap. The inventory comparator was checked against the real inputs
only. No database item needed a re-run.

## 8. Remaining evidence limits

1. **There is no per-table or per-row drift report against `7fefcd9b…`** (§6). The +18 net rows are unattributed.
2. **There is no authentic staged Brownlow reconciliation** for this archive: production has no staged seasons.
   The 98-season pair is the alternative, not the comparator. Real API vote-set identity, round translation and
   leaderboard reconciliation remain required before Brownlow operational or publication readiness.
3. **Production effective permissions were not compared**, only stored ACLs (§3). The staging default ACLs are
   absent on production, and the privileges suite records that as 1 FAIL (§5).
4. **The archive is a writers-active MVCC snapshot.** It is not a rollback baseline; the frozen window backup
   (gate row 6) is still required.
5. **The original `shadow.log` manifest entry still does not re-verify** (disclosed LOW, preserved).
6. **The original S2 diff truncates five paths** (LOW, §2), preserved as committed.
7. The section and report hashes are not byte-comparable with `7fefcd9b…`'s. Only comparable figures are
   compared, and the composition of its 87 added sections is unknown.
8. **Object ownership was not compared** (`--no-owner` throughout), except the receipt table's owner (§3).
9. **The retained databases' data was not re-measured at the end of the run.** All access was read-only. Each
   database is 162,312 bytes larger after the first connection; the probable cause is the relation-cache init
   file, not verified (§1).

## 9. Proposed archive-bound acceptance (for owner decision; NOT approved, nothing bound in code)

> **APPROVED 2026-10-29 exactly as scoped below** and bound in code since; see
> [the owner decision record](owner-decision-current-rehearsal-2026-10-29.md). The text below is kept as proposed.

### Binding for all three decisions

**Archive and source.**
- Archive `a4641ca0d1533c30d6670dfa9b555552548a91b736054e941adba75cee0c46fc`; sidecar `72f000462a2e7560afee97edf5598723a2ccfa45c9664e7d57ce7b62dddb57d4`.
- Evidence manifests: the original `ea197fcf40c1b27108bebb1cc9b0a6523e8d79804952f77610f5f4606ac8ac75` (38 files, with its
  disclosed live-log entry) and the follow-up `30b1a2be9757dfca491aa6b72ade183e2237f90759babbbd6a705a950143d010` (61 files).
- Baseline 110 (ledger digest `789946fe…8f055153`) through exactly 111–117, with the seven `FRESH_ACCEPTANCE`
  canonical-LF checksums.
- Shadow source `c478c31b2ad84719907e0372d1b94230d3a4c508`. The release candidate commit is to be named at A-REL.

**Measured bytes.**

| File | SHA-256 |
|---|---|
| `schema-sections.attempt2.json` | `edb83b2aa53004f26c363d040eebe5186a86e733e472f14bdcd14b7768ac431b` |
| `receipt-catalog.migration.json` | `f1f951a9cca05be88045e8164951ccb043ab976ed9d2f36120a4d4d52d79ce05` |
| `receipt-mutation.json` | `93bca1f44bbaf1f19cdc17dabc787c63eb8a865b6981e03f475fa28557ec976a` |
| Run `schema.diff` | `b201707ba920f331349128b14e4bf79366918a38ce5fc689f2cef69e3129d230` |
| Stored reports (both) | `e2df67aee27df89d6723681fbd0cdda1938a4311c11fd96b7df69f1a1d5c98aa` |
| `it-v2-brownlow-eligibility.json` | `7935c56a2e4072fa97f0f6081266c0799c436d001e8d249ac7176e1663af6842` |
| `it-privileges.json` | `63c183beec5efc024e385998c9d0923a5608f9e41d4b76331ad726fdb2e7d06e` |
| `unit-focused.json` | `92bcc392cc6d982b9c31edec605cbe6b63e09d3fc970b71a94d9b46fd1ef6dba` |
| `inventory-comparison.attempt2.json` | `d00744c697fd8ce5dc83a0e94145573824996939227378ef11f5ee6e5ad5c32d` |
| `grant-exact.json` (local, after review; not in the host manifest) | `4d41c280d0f4eaaa7787ec513d3656df73c491b6b72d356e7081a6a34508d67d` |

### The three decisions

| Proposed identifier | Proposed decision (exact) | Evidence | Remaining limit the owner accepts by approving |
|---|---|---|---|
| **D-V2-CURRENT-REHEARSAL-1** | Accept this archive's **migration-only** compatibility, baseline 110 through exactly 111–117, as backend migration evidence. It is not operational acceptance. | Run §5: every existing table's rows identical, ledger +7, six new tables empty, six public projections unchanged, Coleman/manifest/coverage pass, `backendFunctional` PASS. Follow-up: restore fidelity 1,194/1,194; retained copies accessed read only, with schema identical at start and end and the migration copy's receipt catalogue byte-identical; source unchanged since S2; 783 additions explained | §6: drift against `7fefcd9b…` is measured only as an aggregate (+18 net rows, unattributed). This decision rests on this archive's own before/after evidence, not on similarity to `7fefcd9b…`. The retained copies' data was not re-measured at the end, and their size grew 162,312 bytes each on first connection (§1, §8.9) |
| **D-V2-CURRENT-SCHEMA-1** | Accept **only** two deltas for this archive. **Migration 116:** the receipt table, `refuse_brownlow_receipt_mutation()` and `brownlow_receipt_immutable`, and its permissions: owner-only table ACL; no table privilege for app/import/auth; the function's default ACL, which is PUBLIC EXECUTE (`proacl` NULL). **Migration 117:** the nullable `eligible` and its comment. The 111–115 additions are already expected by the preservation contract (`V2_ADDED_TABLES`, `tools/v2/migration-preservation.ts`) and fall outside this decision, as with D-V2-FRESH-SCHEMA-1. All other definitions and relationships remain under strict comparison | Preservation's exact two findings. 4c: 0 removed, the 1 changed section is exactly 117, all 71 additions are supported by 111–117, 0 unclassified. All 193 archived ACLs are equal after reconciliation, and all 21 new-object grant lines equal 111–117 statements, with exact privileges (`grant-exact.json`). 4a: 25/25. 4b: 12 denials, 3 refusals, rollback to 0 | **Stored ACLs only**: production effective permissions are not compared. **Object ownership was not compared**, except the receipt table's owner. The two staging default privileges remain absent and are **not** accepted or installed by this. They stay with D-V2-STAGING-*-DEFAULT-1 execution at A-REL |
| **D-V2-BROWNLOW-ALT-3** | For the unavailable staged comparator on this archive, accept as alternative **migration** evidence: complete raw-vote/audit preservation, identical 98-season stored reports, and the focused Linux checks as measured: units 508/508 and eligibility integration 47/47 passing, privileges integration 42/43 with one recorded FAIL (absent staging default ACLs), not waived. This is not authentic API reconciliation and not publication authority | Classifier: all 99 preservation tables row-identical, including `brownlow_round_votes`/`brownlow_season_votes` and audits. Stored pair 98/98 byte-identical, reconciled, 0 findings. Units 508/508; eligibility integration 47/47 | §8.2: no authentic staged reconciliation. Privileges integration is 42/43, and the one failure is the absent staging default ACL (§5); approving ALT-3 does not waive it. The suite composition differs from `7fefcd9b…`'s "306 units" |

**Recommendation.** All three are now supported by measured evidence of the same kind as the 2026-10-21
decisions. Decide them together.

- The schema delta set is exactly the one accepted for `7fefcd9b…` (D-V2-FRESH-SCHEMA-1), measured here
  without an unclassified section.
- If the owner requires per-row drift attribution against `7fefcd9b…` before REHEARSAL-1, that needs a separate
  authority:
  - either to place the restricted Windows copy of `7fefcd9b…` on streamanator,
  - or to read its preservation snapshot from a copy of the WSL store.

**What approval does not change.**
- **It authorises nothing on production:** no schema installation, privilege write, Brownlow operation or
  deployment.
- **The acceptance tool stays as it is until then.** `tools/v2/fresh-rehearsal-acceptance.ts` gains a second
  binding only after an approved decision, as a reviewed code change. Nothing is repinned from observed output.
- **Production remains NO-GO.** The 27 October window work remains complete.

## 10. Independent review and dispositions

The record, proposal, committed evidence and tracking edits were given to one separate read-only agent, which
had no write access. It recomputed:
- the hashes: `COMMITTED-SHA256SUMS` 66/66; the host manifest `30b1a2be…`, 61 entries, 52 committed files equal;
- every count and exit code;
- the clone budget and the section arithmetic;
- the cross-references to the 2026-10-20/21 records and the 111–117 text.

It also confirmed the following:
- **Attempt-2 changes.** Both are parsing-only corrections. Neither changes a threshold or an expectation, and
  the attempt-1 outputs are unchanged.
- **No acceptance recorded.** Nothing marks acceptance or adds a binding. `fresh-rehearsal-acceptance.ts` is
  unmodified.
- **No sensitive content.** No DSN, password, token or raw production row is committed.

Its result: **no CRIT or HIGH findings; four MED, six LOW and three INFO. Every one was dispositioned in this
record before commit.**

| Grade | Finding | Disposition |
|---|---|---|
| MED-1 | "Neither retained database changed" claimed more than was measured. Data was not re-measured at the end, and the 162,312-byte size growth was undisclosed | Restated in §1, §8.9, REHEARSAL-1 and CHANGELOG as exactly what was measured. The probable cause is labelled unverified |
| MED-2 | ALT-3's exact decision text said "passing focused Linux checks" although privileges was 42/43 | The decision text now states 508/508, 47/47 and 42/43 with the FAIL not waived |
| MED-3 | Control claims had no evidence. The 4c new-object matcher ignores the privilege list, so a widened grant on a new object would pass | Controls retained in `controls/schema-sections/`, and §7 states what each one did and did not cover. The gap is closed by `grant-exact.mjs` → `grant-exact.json`: 21/21 exact, three negative controls each reported (`controls/grant-exact/`). Its first local version mis-parsed `DO`-block and per-column grants and reported false mismatches. It was corrected before its result was used, and only the corrected output is retained |
| MED-4 | Object ownership was never compared, and that was undisclosed | Ownership is now listed as a normalisation, in the §3 Limits, in §8.8 and in SCHEMA-1's limit |
| LOW-1 | Space figures did not match the evidence; some figures were session-only | §1 cites `space-before`/`space-after` and labels the session observations. The mode-700 wording is corrected |
| LOW-2 | "All six `SHA256SUMS`" was wrong | Corrected: one `xfer/SHA256SUMS`, six entries |
| LOW-3 | "Unretained" overstated; the new report embeds its archive SHA | §4 corrected |
| LOW-4 | The inventory identity rests on a host-only anchor chain | The anchor chain is stated in §2 |
| LOW-5 | SCHEMA-1 wording was ambiguous | PUBLIC EXECUTE is stated, and the exclusion of the 111–115 additions is stated |
| LOW-6 | "Like-for-like" 87 was an inference | Labelled as the same total with unknown composition |
| INFO ×3 | `followup.result` semantics; private host address in scripts; ledger digest source | Semantics stated in §1. The address is not a secret and is kept. The digest source is cited in §6 |

