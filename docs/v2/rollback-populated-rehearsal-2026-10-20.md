# V2 gate run on real evidence and populated-ledger rollback rehearsal (2026-10-20)

Sanitised record. Counts and digests only; archives, row-level evidence, exports and credentials
stay in the restricted rehearsal store (WSL distribution `AFLDB-V2-Rehearsal-20261020`, under
`/home/rehearsal/evidence/`) and are not in Git. **Production remains NO-GO.** Nothing here is
production, shared-system or live-service evidence: every database is a disposable
`afldb_v2_*_test` copy in the isolated loopback-only PostgreSQL 16.15 cluster.

Code revision under test: `a273b21a8952f91f279d6a18938a49d19be2dd9d` (exact `git archive`; the gate
CLI sources match: `release-gates.ts` `e69630ca…2d63`, `migration-preservation.ts` `92d83437…a9a`).
Three new tools were added for Part 2 and copied into the tested tree: `tools/v2/rollback-populate.ts`,
`rollback-fingerprint.ts`, `rollback-public-probe.ts`.

## Part 1 — release gates on the retained migration evidence

### Integrity (all verified, none assumed)

| Check | Result |
|---|---|
| Archive SHA-256 | `a583fc7d8d4376aa816253adf299a1325da7e65c994576b6b56bfa136ed11b04` (matches sidecar; 110 ledger entries) |
| `evidence-manifest-final.sha256` | 152/152 OK, 0 failures (re-verified again after Part 2 added files) |
| `followup-evidence.sha256` | 20/20 OK |
| Before / after captures | same archive SHA, same query contract `f0bc0b9a…ae4c`, seal 2025, phase `migration` |
| Migration scope | ledger 110 → 115; tables 99 → 104; only the five V2 tables added |
| Preservation | 1,659,903 baseline row hashes, 0 lost, 0 definition changes, 6 projections equal, 0 findings |
| Stored Brownlow reports | before = after = `fea86e5d…346db2`; 98 distinct seasons (1924–2025), all reconciled, stored-only basis |
| Referenced tests | integration 35/35; unit 45 + 55 + 59 = 159/159 |
| Parity | 4 pass, 0 fail, 1 incomplete (staged Brownlow, 0 staged seasons) |
| Live corroboration | baseline and before-clone ledger 110; migration and after-clone ledger 115; 98 seasons and 16,120 `brownlow_season_votes` rows in all four; 0 staged `afl_api_brownlow_vote` rows |

The Brownlow-alternative attestation was **derived by script from the raw artifacts** (47 checks, all
ok), not hand-written and not accepted on readability: `derive-attestation.mjs` recomputes every
figure above. The committed `docs/v2/evidence/brownlow-migration-alternative-attestation.json` was
not used for the real run.

### Actual command (cwd = the `a273b21a` tree; `E` = retained evidence directory)

```
node --import tsx tools/v2/release-gates.ts --before $E/before.preservation.json \
  --after $E/postmig.preservation.json --parity $E/migration.parity.json \
  --functional $E/linux-functional-evidence.json \
  --brownlow-alternative $G/brownlow-alternative-attestation.json --out $G/release-gates-actual.json
```

Exit codes: 0 PASS, 1 FAIL, 2 INCOMPLETE, 3 error.

| Output | sha256 | Exit |
|---|---|---|
| `release-gates-actual.json` | `b8f6da68d71a87b8392f9c3707f552293c19b1cbca14e8286b7e09c6822b482d` | **0** |
| attestation (derived) | `f9578d0d539db74f18111cbbbbfbed266799b26f46df836b78e43ab3f71fb71a` | — |
| derivation (47 checks) | `7d14c2259b231a66f2bc75dbb6d77c30baf3f86273dbca331b6ec91756aef4dc` | — |
| control run, **no** alternative: `release-gates-control-no-alternative.json` | `4517ed9419c7c7a7f2b2ebe855400666711b209d04c1229a1549b5c95449b2ac` | **2** |

### Verdicts (separate)

| Gate | Verdict |
|---|---|
| Backend functional | PASS |
| **Migration compatibility** | **PASS**, basis `APPROVED_BROWNLOW_ALTERNATIVE`, scoped to this archive, 110 → 115, 98 seasons |
| **Staged Brownlow comparator** | **INCOMPLETE**, unchanged (original result preserved; the control run shows it is INCOMPLETE and migration compatibility INCOMPLETE without the alternative) |
| Backend acceptance | PASS (scoped) |
| **Production operational** | **INCOMPLETE** (no operational input exists) |
| Strict Gridley | FAIL 149 (unchanged) |
| Adjudication | 99 approved / 50 unapproved (unchanged) |
| Production decision | **NO-GO** |

The prior historical gate report was left untouched (hash `ad2f3053…1290ec` verified).

## Part 2 — rollback with populated V2 ledgers

### Populated state

A disposable copy of the restored, migrated database (`afldb_v2_shadow_migration_test`, ANALYZEd) was
populated through the production services (`rollback-populate.ts`) with synthetic identities
(`@example.invalid`, no password, no session). Real users' credentials and historical source facts
were not altered; the only real rows touched are the `coleman` award span (last season 2095) and
the Brownlow award metadata.

| Ledger | Rows | Notes |
|---|---|---|
| `award_proposals` | 8 | 4 approved, 1 rejected, 3 superseded; CORRECT and REPLACE revisions |
| `award_proposal_decisions` | 21 | four-eyes approvals, a rejection, an attested self-approval |
| `derived_award_results` | 2 | second supersedes first |
| `brownlow_eligibility_decisions` | 4 | ineligible then superseding eligible; open-season basis |
| `derived_award_projections` | 2 | inserted; then voided + inserted ×3 |

Also: sealed-season approval with void and reinstatement; four active synthetic winners plus one
void; Coleman 2095 three active plus one void; `data_edits` groups created 5, corrected 1, voided
2, reinstated 1, Coleman publication 5, eligibility publication 4. The Brownlow eligibility path
was driven at query level (the operations-centre wrapper cannot be imported outside Next), so it
writes no `auth_audit_log` rows; the curated and Coleman paths write their `data_edits` audit
rows.

### Application rollback (additive schema retained) — PASSED

On the populated copy, a fresh previous-release standalone build and the V2 build were run in the
order previous → V2 → previous → V2 (loopback only, 0 external requests).

| Phase | Route/permission checks | Result |
|---|---|---|
| 1 previous | 18 | PASS |
| 2 V2 | 24 | PASS |
| 3 previous | 18 | PASS |
| 4 V2 | 24 | PASS |

- Fingerprint (rows, content/identity/relationship digests, sequences, canonical tables, audit
  log, public digests, cross-references) **IDENTICAL** before and after the whole sequence, except
  the two runtime fixture identities the checks create (`local-release-*`), which are counted
  separately.
- Public pages: 10 routes probed per phase. previous#1 = previous#3 and V2#2 = V2#4 byte-for-byte
  (status, location, text digest). All synthetic winners/results appear in every phase, including
  under the previous release (the additive tables are ignored, the `award_winners` rows are served).
- Permissions (anonymous, admin, super-admin) and `auth_audit_log` preserved in every phase.

### Database reversal, export and recovery

Run on three further disposable copies of the same populated database. The documented
`rollback-111-114.sql` plus the new `rollback-115.sql` (see below) reverse 111–115, followed by the
previous release's `privileges.sql`.

**Expected, explicit loss at reversal** (identical in every run): all five V2 tables and their
sequences are gone: 8 proposals, 21 decisions, 2 results, 4 eligibility decisions, 2 projections
(their content, identity and relationship digests no longer exist); 6 curated-proposal links in
`data_edits` and 6 `approved_entity_key` links to overrides, and 5 projection-to-winner links,
become unresolvable. Retained: `award_winners`, `data_overrides`, `data_edits`, `auth_audit_log`
and every historical table. Gate R5 passed (all five `to_regclass` NULL, ledger 110, 0 rows for
111–115). The reversed schema is **identical** to the restored baseline 110 schema (11,557
normalised lines).

| Procedure | Export | Recovery | Result |
|---|---|---|---|
| **A. Runbook §5 as documented** (per-table CSV, `\copy` back, no sequence handling) | 5 CSVs, ordered by id | `\copy … FROM` in dependency order, one transaction | Rows, IDs, references, content and relationship digests restored **exactly**; **identity sequences NOT restored** (`last_value=1, is_called=false` against `max(id)` 8/21/2/4/2). The next audited write fails with a duplicate primary key. After `setval` from the recorded sequence state, fingerprint **IDENTICAL**. |
| **B. Data-only `pg_dump -Fc` of the five ledgers, `pg_restore --data-only --single-transaction --exit-on-error`** | one archive (`8438fc2c…fdfcfd`); carries `SEQUENCE SET` for all five | single transaction, dependency order from the archive | Fingerprint **IDENTICAL** to before reversal (content, identity, relationships, sequences, canonical tables, public digests, cross-references). Next audited write takes the next id (5). |

Procedure B then verified:
- reapplied migrations 111–115 and grants: schema-and-grants dump **identical** to the first forward state (14,008 lines), re-checked after recovery;
- rerun safety: the same restore run twice **fails closed** (duplicate key) and changes nothing; migrate and privileges reruns are no-ops; the reversal files run twice are no-ops (`IF EXISTS`, name-keyed ledger delete);
- the previous release run against the reversed schema serves public pages identical to its populated-copy run (10/10); the V2 release on the recovered copy serves public pages identical to the populated V2 run (10/10) and passes 24/24 route and permission checks with audit fingerprints unchanged.

### What the rehearsal also found

1. **Runbook defects** (fixed in the runbook): `copy` without the backslash on two export lines,
   `i` instead of `\i`, no sequence-state capture and no restore procedure.
2. **No reversal file for migration 115**; the earlier rehearsal reversed it by hand. Added
   `docs/v2/rollback-115.sql` (idempotent).
3. The CSV procedure in the runbook is recoverable only if the sequence state is also restored
   (Procedure A). Procedure B captures it in the archive and is now the documented route.

### Evidence integrity

Restricted store (not in Git): gate directory manifest `gate-20261020.manifest.sha256`
`20d0d468…c65be611` (13 files); rollback directory manifest `rollback-20261020.manifest.sha256`
`68116c5e…028557` (93 files). Procedure A on its first attempt (`rev1`) was invalidated by the
harness (an unreadable restore script and a faulty schema normaliser that could report "identical"
on empty output) and is retained only as superseded; the normaliser comparison is now guarded and
the whole of A was re-run on a fresh copy (`rev3`). The conclusions above are from `rev2`
(Procedure B) and `rev3` (Procedure A).

## Limitations — what this does not show

- Synthetic data on an archive-derived database. It is not a production dump and says nothing about
  the live database or its drift since the archive.
- The reversal is exercised with V2 writes stopped. Any V2 write between the export and the drop is
  lost; the runbook order (previous release live first, §4, then export, then reverse) must hold.
- Host systemd/Caddy/TLS, the host backup (§2), real redeployment of the previous release and
  production-role privilege differences are not covered.
- The Brownlow eligibility audit is not exercised through the operations-centre wrapper.
- This is unchanged: authentic API Brownlow reconciliation, strict Gridley FAIL 149, adjudication
  50 unapproved, and the production operational acceptance remain outstanding. Production NO-GO.
