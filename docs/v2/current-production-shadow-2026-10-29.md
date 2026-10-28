# Current-production shadow report — 2026-10-29 (D-V2-CURRENT-SHADOW-CAPTURE-1)

**Result: `shadow.result = SUCCEEDED`. Classification `ONLY_EXPECTED_116_117_DELTAS`. Strict results unchanged:
preservation FAIL, parity FAIL (3 pass / 1 fail / 1 incomplete), `migrationCompatibility` FAIL,
`productionDecision` NO-GO.** The classification is not an acceptance. **Production remains NO-GO.**

Executed from the reviewed [release decision package](release-decision-package-2026-10-28.md) §2 under the
owner's approval D-V2-CURRENT-SHADOW-CAPTURE-1, in the Claude Code session of 2026-10-29 (AEDT). The session's
starting HEAD was `b144ee9a` on `v2/rebuild`. Sanitised evidence:
[`evidence/current-production-shadow/run-20261028T192336Z/`](evidence/current-production-shadow/run-20261028T192336Z/).
Its own hashes are in `COMMITTED-SHA256SUMS`.

## 1. Pinned inputs and binding

| Item | Value |
|---|---|
| `capture-prod.sh` | `44609914b403ab4bdea2704f45a14c7db34c164e544914827ece0aa3d1df13c2`, verified before use |
| `transfer.ps1` | `a0073e466f632b75dd89621b3df511a28c8148d066987fb122a5b991b7114df4`, verified before use |
| `shadow-restore.sh` | `1530d24c53e7ccc20aa14eb2952784c33470576a85c5cbe55476d7ce753915df`, verified locally, on streamanator after transfer, and again just before launch |
| `expected-deltas.mjs` | `4f516cb8d73e6380f9d8bb5baf4b93b5cbf4f390b5ba4b0f48d2ad3e69777ec1`, verified at the same three points |
| Source binding | `git diff --quiet c478c31b HEAD -- tools/v2 tools/db src packages docs/v2/preservation-queries.json docs/v2/migration-functional-evidence.json package.json package-lock.json tsconfig.json` exited 0 at HEAD `b144ee9a` |
| Migrations 111–117 | The private `c478c31b` copy's seven files hash exactly to the `FRESH_ACCEPTANCE` pins in `tools/v2/fresh-rehearsal-acceptance.ts` (`2ed29d95…`, `e0aa0c7e…`, `79e7b9d1…`, `1c33324f…`, `2f16efb9…`, `c61953b7…`, `a7dff2bd…`) |

## 2. Production capture, P0–P8 (2026-10-28T19:23:36Z–19:23:47Z; 11 s)

`RESULT PASS stamp=20261028T192336Z`, first attempt, no re-run ([`capture.log`](evidence/current-production-shadow/run-20261028T192336Z/capture.log)).

- **Identity.** `afldb-prod`, user `arm`. `afldb_prod` OID `66668`, system identifier `7674454702926115004`,
  PostgreSQL 16.15. Owner `afldb_owner`. Role `afldb_backup`: not superuser, member of `pg_read_all_data`.
  `transaction_read_only=on`.
- **Extensions:** `pg_trgm=1.6 plpgsql=1.0 unaccent=1.1`.
- **Ledger.** 110 rows; last `110_match_sheet_player_match_stats_authority.sql`. Digest `789946fe…8f055153`
  before and after the dump, so no change.
- **Inspection.** AccessExclusive locks 0; visible non-idle sessions 0; staging default ACL entries 0. Staged
  Brownlow seasons `none`. Public base tables 77.
- **Writers.** `afldb.service` active. `afldb-settle-afltables.service` inactive; its timer enabled/active
  before and after. AFL API and email units not installed. Deployed checkout `ff100dc2…`, BUILD_ID
  `vcxM_SyDxFCP0sj9n9W1t`.
- **Timer guard.** `systemctl show --timestamp=unix` was not honoured; it printed `Fri 2026-10-30 04:44:53 AEDT`.
  The script therefore used its documented fallback band. Host time 06:23 AEDT was outside 04:00–05:30, so it
  passed. The printed next fire was about 22 h away.
- **Archive.** `afldb_prod-20261028T192336Z.dump`, 29,781,203 bytes.
  - SHA-256 `a4641ca0d1533c30d6670dfa9b555552548a91b736054e941adba75cee0c46fc`.
  - 1,549 TOC entries.
  - `pg_dump` exit 0, empty stderr, about 9.8 s.
- **Sidecar.** `afldb_prod-20261028T192336Z.provenance.json`, SHA-256 `72f00046…dd57d4`.
- **Only production write.** `/home/arm/backups/afldb/current-shadow-20261028T192336Z/` (mode 700; files 600).

## 3. Transfer, T1–T3

`TRANSFER PASS` ([`transfer.log`](evidence/current-production-shadow/run-20261028T192336Z/transfer.log)).
All six `SHA256SUMS` entries matched at each location:
- the restricted `C:\Users\stuar\backups\afldb\current-shadow-20261028T192336Z\`;
- the new mode-700 streamanator root `/home/arm/afldb-v2-currentshadow-20261028T192336Z/xfer/`.

The archive also matched the `capture.log` RESULT line, and both scripts matched their pins on streamanator.

## 4. Pre-launch disk guard and the owner's narrow exception

- **The problem.** Before S1, streamanator had 11,304,747,008 bytes free. The `c478c31b` source tree that S2
  copies is 1,273,721,342 bytes. S3's unchanged ≥10 GiB guard (10,737,418,240) would have failed
  deterministically, at about 10.03 GB, and a FAILED run may not be re-run. The run was held at the T3 boundary
  and the owner was asked.
- **The exception.** The owner authorised clearing only arm's regenerable npm cache. Hostname, user and
  `/home/arm/.npm` were confirmed to be a plain directory. Then
  `npm --cache /home/arm/.npm cache clean --force` ran (npm 10.9.8, exit 0) and the cache went from
  2,360,761,761 bytes to 1,275,944. Nothing else was deleted and no npm configuration changed.
- **Re-check.** 13,682,827,264 bytes free, projected 12,409,105,922 after S2, so the guard was satisfied
  unchanged. The root was confirmed in its pre-run state (only `xfer/` and the two scripts). The `xfer`
  hashes, both script pins and port 55467 were all checked free or OK.

## 5. Isolated shadow, S1–S7 (streamanator; 2026-10-28T19:45:53Z–20:00:39Z)

`shadow.result`: `SUCCEEDED`. `shadow.done`: `process completed exit=0`. All 27 recorded exits are in
[`exit-codes.txt`](evidence/current-production-shadow/run-20261028T192336Z/exit-codes.txt). Every one is 0
except the strict reporters, parity = 1 and release-gates = 1 (FAIL kept as evidence, as designed).

| Step | Result |
|---|---|
| S1 | `xfer` hashes, sidecar fields, archive SHA and bytes OK |
| S2 | Private `c478c31b` copy. No shadow-path file differs from the verified manifest (see §7.4) |
| S3 | New cluster on `127.0.0.1:55467`, pid 170264, data under this root only; shadow guard OK |
| S4 | 1,549 TOC entries, exactly 4 extension entries excluded. One restore, exit 0. Restored ledger 110/110 equals the sidecar, with no mismatch or missing row |
| S5 | Staged seasons `[]`, which equals production's P4 `none`. Before captures OK. Pending exactly 111–117. Applied 7 (111 in 120 ms … 117 in 5 ms). Privileges OK. `0 pending.` After captures OK |
| S6 | Parity, release-gates and classifier as below. Archive and `xfer` re-checks OK |
| S7 | Cluster stopped and port 55467 free. Both `_test` databases retained. Evidence manifest `ea197fcf40c1b27108bebb1cc9b0a6523e8d79804952f77610f5f4606ac8ac75` (38 files) |

### 5.1 Strict results (unchanged; nothing waived)

- **Preservation** FAIL, with exactly two findings:
  - `staging.afl_api_brownlow_vote: DEFINITION_OR_RELATIONSHIP_CHANGED` (117);
  - `public.brownlow_correction_receipts: UNAPPROVED_TABLE_ADDED` (116).

  Snapshot scope: archive `a4641ca0…`, query contract `f0bc0b9a…`, seal 2025. 99 tables before, 105 after.
- **Parity** (`v2.parity.1`) FAIL, 3 pass / 1 fail / 1 incomplete.
  - `historical_manifest`, `coleman` and `coverage` pass.
  - `table_row_counts` fails only on `UNEXPECTED_TABLE_ADDED public.brownlow_correction_receipts` (0 rows).
    Its infos: ledger 110→117, and five V2 tables added, each with 0 rows.
  - `brownlow` is INCOMPLETE (`INPUT_MISSING` before and after), because production has no staged seasons.
- **Release gates.** `backendFunctional` PASS. `migrationCompatibility` FAIL. `brownlowAlternative` is
  D-V2-BROWNLOW-ALT-1 `NOT_APPLIED`, because its scope is `a583fc7d…` 110→115. `productionDecision` NO-GO.
  Stderr was empty.

### 5.2 Classification

[`expected-deltas.json`](evidence/current-production-shadow/run-20261028T192336Z/expected-deltas.json) is
`ONLY_EXPECTED_116_117_DELTAS` with `reasons: []`. Its checks found:
- every existing table's rows identical;
- the ledger exactly +7;
- the six added tables empty: `award_proposal_decisions`, `award_proposals`, `brownlow_correction_receipts`,
  `brownlow_eligibility_decisions`, `derived_award_projections`, `derived_award_results`;
- every public query output unchanged.

This profile is identical to the documented expectation (§2.4) and to the `7fefcd9b…` and `a583fc7d…` runs.
**It is not an acceptance.** D-V2-FRESH-REHEARSAL-1, D-V2-FRESH-SCHEMA-1 and D-V2-BROWNLOW-ALT-2 remain bound
to `7fefcd9b…` and do not apply to this archive.

## 6. Schema diff (owner review evidence; not classified)

[`schema.diff`](evidence/current-production-shadow/run-20261028T192336Z/schema.diff) compares complete
schema-only dumps of the migration copy before and after: 3 removed / 1,434 added lines.
- **Removed.**
  - `eligible boolean NOT NULL` on `staging.afl_api_brownlow_vote` (117).
  - The two `\restrict`/`\unrestrict` session-token lines. `pg_dump` generates these randomly per dump; they
    are not schema.
- **Added structure (111–117).**
  - 6 tables, 1 function (`refuse_brownlow_receipt_mutation`) and 1 trigger;
  - 19 indexes, including 115's `ix_afl_api_identity_adjudications_supersedes_id`;
  - 20 comments, including 117's comment on `eligible`;
  - the constraint and identity `ALTER`s of the new tables.
- **Added ACLs.** About 324 `GRANT` and 2 `REVOKE` lines. The restore used `--no-privileges` (by design), so
  the "before" dump has no ACLs. These lines are mostly `tools/db/privileges.ts` reconciliation of all
  existing objects, not 111–117 deltas (see §7.2).

## 7. Evidence limitations (stated for the owner; none resolved by this run)

1. **MED-2 remains open.** The evidence is weaker than the `7fefcd9b…` acceptance in these ways:
   - the schema diff has no automatic classification and no normalised schema-section comparison;
   - there is **no 98-season stored-report before/after pair**;
   - **no focused Linux checks** ran on this archive;
   - there is **no archive-to-archive drift report against `7fefcd9b…`**.

   The production ledger is byte-identical to `7fefcd9b…`'s (same 110-row digest), but data drift outside the
   ledger was not measured. Known drift includes the 2026-10-24 U3 removal of PMS 705437.
2. **ACLs not compared.** Because the restore used `--no-privileges`, neither the schema diff nor any probe
   compares production's archived ACLs with the post-`privileges.ts` state. No receipt-table permission probe
   ran (the `7fefcd9b…` run had `receipt-privilege-check.json`). The 116 receipt permissions therefore cannot
   be isolated from the general reconciliation in this evidence. Production has 0 staging default ACL entries,
   so D-V2-STAGING-IMPORT-DEFAULT-1/APP-DEFAULT-1 remain unexecuted there.
3. **Brownlow comparator INCOMPLETE.** Production has zero staged Brownlow seasons, so no authentic staged API
   reconciliation exists for this archive. The run supplied no alternative attestation.
4. **Source-manifest additions outside the shadow paths.** S2 found 783 differing lines between the verified
   `c478c31b` manifest (2,939 files) and the private copy (3,722 files). All are files **present in the copy
   and absent from the manifest**: 782 under `data/sources/`, 1 under `data/records/`. None is changed or
   missing, and none is on a shadow path, so the guard passed by design. Their origin after the manifest was
   taken was not investigated.
5. **Live-log manifest limitation (documented review LOW).** `evidence-sha256.txt` hashes `shadow.log` while
   `tee` is still appending, so that one entry does not re-verify. The final copy hashes `99b6e575…`; the
   manifest records `12e4cf94…`. All other 17 fetched files re-verified against the manifest.
6. **Writers-active snapshot.** No writer pause. Consistency rests on the single MVCC snapshot and the
   unchanged before/after ledger. **Not a rollback baseline** (the sidecar says so); the frozen window backup
   (gate row 6) is still required.
7. The 2026-10-29 failure-propagation correction (`shadow-restore.sh` `1530d24c…`) was validated only by
   synthetic controls and review before this run. This run exercised its success path only.

## 8. Retained state

| Location | Content |
|---|---|
| production `/home/arm/backups/afldb/current-shadow-20261028T192336Z/` | Archive set, mode 700/600. Removal is a later owner decision |
| `C:\Users\stuar\backups\afldb\current-shadow-20261028T192336Z\` | Archive set; ACL owner, SYSTEM and Administrators only |
| streamanator `/home/arm/afldb-v2-currentshadow-20261028T192336Z/` | 3,126,143,411 bytes: `xfer/`, `archive/`, private `src/`, stopped cluster with `afldb_v2_shadow_current_baseline_test` and `afldb_v2_shadow_current_migration_test`, and `evidence/` (38 files plus `shadow.done`/`shadow.result`) |

Afterwards streamanator had 10,493,456,384 bytes free, roughly 9.8 GiB. A future isolated run that repeats
S2's copy will fail its 10 GiB guard unless space is freed first.

Not done: other production access or writes, any production migration, privilege, timer, service or Brownlow
action, deployment, push, provider fetch, rebuild, archive or store deletion, frozen-material change.
ISSUE-327 stays parked.

## 9. Proposed archive-bound acceptance (for owner review; NOT approved)

These have the same shape as the 2026-10-21 decisions. Every item is bound to:
- archive `a4641ca0d1533c30d6670dfa9b555552548a91b736054e941adba75cee0c46fc`;
- sidecar `72f000462a2e7560afee97edf5598723a2ccfa45c9664e7d57ce7b62dddb57d4`;
- evidence manifest `ea197fcf40c1b27108bebb1cc9b0a6523e8d79804952f77610f5f4606ac8ac75`;
- baseline 110 through exactly 111–117, with the seven `FRESH_ACCEPTANCE` file checksums;
- shadow source `c478c31b2ad84719907e0372d1b94230d3a4c508`. The release candidate commit is to be named at
  A-REL.

| Proposed identifier | Proposed decision | Evidence it rests on | Gap the owner should weigh |
|---|---|---|---|
| D-V2-CURRENT-REHEARSAL-1 | Accept this archive's migration-only compatibility, 110 → exactly 111–117 | §5: rows identical, ledger +7, new tables empty, public outputs unchanged, Coleman/manifest/coverage pass, backend PASS | §7.1 drift report absent |
| D-V2-CURRENT-SCHEMA-1 | Accept only the measured 116 receipt objects/permissions and the 117 nullable `eligible`/comment delta for this archive | Preservation's exact two findings; `schema.diff` §6 | §7.2: no receipt permission probe and no normalised schema sections. Recommended before approval: a bounded, read-only follow-up on the **retained** migration copy (restart the stopped cluster, receipt-privilege probe, schema-section comparison against the `7fefcd9b…` pins), under its own authority |
| D-V2-BROWNLOW-ALT-3 | Alternative evidence for the unavailable staged comparator on this archive | All 99 captured preservation tables row-identical (classifier); no staged seasons in production | §7.1/§7.3: there is **no 98-season stored-report pair and no focused Linux checks**, both of which D-V2-BROWNLOW-ALT-2 relied on. **Recommendation: do not approve ALT-3 on this run alone.** Produce the 98-season pair on the retained databases first |

**Recommendation.** Approve, as one bounded follow-up authority on the retained streamanator root only:
- a cluster restart;
- the receipt-privilege probe;
- a schema-section comparison;
- the 98-season Brownlow stored-report pair;
- the focused Linux checks;
- optionally, an archive-to-archive drift report against `7fefcd9b…`.

This needs no new production access. It first needs about 1 GiB of further space, or a run that does not
repeat S2's copy. Then decide the three items above together.

Only after an approved decision may `tools/v2/fresh-rehearsal-acceptance.ts` gain a second binding, as a
reviewed code change. Nothing is repinned from observed output. An unexpected difference returns to the owner.
Production stays **NO-GO**.
