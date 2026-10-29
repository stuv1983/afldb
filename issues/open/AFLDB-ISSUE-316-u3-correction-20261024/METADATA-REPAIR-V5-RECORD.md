# ISSUE-316 U3 metadata repair v5: record

**Outcome (2026-10-25 Sydney; 2026-10-24T21:26–21:30Z): PASS. U3 confirmed.**
The `data_edits` 94.note write is repaired, and one linked audit receipt (id 95) was written. The
single attempt is consumed. No retry and no reversal. U4 stays Route B, Brownlow is untouched, and
production stays NO-GO.

Governing instruction: the 2026-10-25 owner ruling, retained verbatim in `V5-RULING-SECTION.md` and
appended to `metadata-repair-v5/OWNER-RULING.md` (approval SHA-256
`74dfd32397a8d3cc03c55df6302d32b2b5264daf1450bddfca4b2e80e3e9c07c`). That text names Codex. The
session that executed it is Claude Code (claude-opus-5-5), and the audit receipt records that.

## 1. Read-only principal discovery (existing access only)

Evidence: `metadata-repair-v5-discovery/`. The run used `discovery.sh` (SHA-256 `30d3048d…2e1c4a`)
as `arm` through the existing `afldb_backup` credential. It used only catalog ACL and privilege
functions, wrote nothing, printed no credential, and exited 0 with empty stderr.

- `.env` is mode 600 and owned by `arm`. There is no `~/.pgpass`. Every DSN points at
  `localhost:5432/afldb_prod`.
- `afldb_owner` can log in. It is not a superuser and holds no CREATEROLE, CREATEDB, REPLICATION
  or BYPASSRLS. It has no memberships and no role settings. It owns the database, the
  public/staging/afldb_meta schemas and all 28 lock-set relations. It is the existing
  `AFLDB_PROD_DATABASE_URL` and `AFLDB_OWNER_DATABASE_URL` migration principal.
- `data_edits` ACL: `{afldb_owner=arwdDxt/afldb_owner,afldb_auth=ar/afldb_owner,afldb_import=ar/afldb_owner}`.
  The application roles are append-only by design. `afldb_import` cannot update `note` and cannot
  take the lock set.
- Only `afldb_owner`, `pg_write_all_data` (which has no members) and `postgres` can update
  `note`. **Selected principal: `afldb_owner`.** It is the narrowest existing role that can do the
  repair, and it needed no role, grant, sudo rule, authentication change or new credential. The
  independent review (F-007 LOW) notes it is broader than the two writes need.

## 2. Package (frozen v2, v3 and v4 untouched)

`metadata-repair-v5/` was derived by `PREPARE-V5.cjs` from frozen v4 (manifest
`829fc30a…848ecf84`, re-verified unchanged after execution) and frozen by `FREEZE-V5.cjs`
(`V5-FREEZE.json`). The manifest has 43 members, SHA-256
`3e1e329f8d1718b3006dbec4a8076a64e552c99a1aaa35f2e66191962fc06d96`. Its delta from v4 is in
`metadata-repair-v5/V5-DELTA.md` and `V5-DELTA.json`:

- **Byte-identical to v4:** 16 members, including all lock, snapshot, protected-data, drift and
  assertion SQL, and the note.
- **Changed:** 21.
- **Added:** 5 (`principal.sql`, `transport.sh`, `operational-observation.sh`, `V4-REVIEW.md`,
  `V5-DELTA.md`).
- **Removed:** 3 (the v4 candidate's PG-TRANSPORT records).

What changed:

- **Principal binding.** `identity.sql` now requires `afldb_owner`. The new `principal.sql` pins
  the role's attributes, memberships, ownership, exact ACLs and writer set in all three streams.
- **Visibility.** `operational-guard.sql` gained a visibility control for the non-superuser
  session.
- **Host gate.** `operational-host.sh` has no sudo, which closes F-006.
- **Transport.** `transport.sh` reads the existing `.env` credential into `PGPASSWORD` only and
  clears the environment to an allowlist.
- **Wrapper.** `run.cjs` runs the stages in this order: fresh observation, read-only prerequisite
  session, `ATTEMPT.json`, then one write session.
- **Records.** Only the operator and approval literals in the audit/binding records changed.

## 3. Validation (fresh private clusters only; no shared DEV, test or production database)

- **PGlite:** `validate.cjs` 20/20.
- **VM wrapper:** `validate-wrapper.cjs` 31/31, covering 30 attempt-boundary cases and a static
  composition check.
- **Real PostgreSQL 16:** private cluster on streamanator, 21 database/transport cases plus the
  static ordering check. Final run: `metadata-repair-v5-validation-7z6NcG`, pinned by
  `metadata-repair-v5/VALIDATION-EVIDENCE.json`. Cleanup PASS and evidence credential scan PASS.
- **Earlier failed harness runs** (retained, not pinned):
  - `-GFhNS5` failed on CREATE DATABASE inside a transaction block. The leak scan caught that
    run's fixture-only `CREATE ROLE … PASSWORD` in that disposable, stopped cluster's server log.
    The harness was fixed to send SCRAM verifiers instead.
  - `-HgahMt`: the probe matched the bash stage.
  - `-2RK1Lx` and `-NABjAE`: the exact psql environment differed because the platform adds
    `SHLVL` and `PGSYSCONFDIR`.

## 4. Independent review

A fresh-context `afldb-closure` reviewer read the package, compared v4 → v5, and wrote
`metadata-repair-v5/REVIEW.md` (`85c70ec1…f2c99bf`) and `REVIEW.json`
(`c365eeb2504fcdefe2366467affd05f85ecc95725fe052d6c03aca90fb68083c`).

**Verdict: GO, 0 stopping findings.** F-006 is closed. There are 8 non-stopping findings, all LOW
or INFO:

- **F-007 LOW:** `afldb_owner` has broad owner scope; this is an owner-judgement item.
- **F-008 LOW:** the operator literal names the model ID. The execution was confirmed as
  `claude-opus-5-5`, which matches.
- **F-009 LOW:** a host or transport stop after the marker consumes the attempt.
- **F-010 LOW:** the host-gate PASS path and production login shell are not exercised
  off-production.
- **F-011 INFO:** the README claims more evidence-scan coverage than the harness provides. The
  reviewer's full scan was clean.
- **F-012 INFO:** `PGPASSWORD` is readable in `/proc` environ by arm and root.
- **F-013 INFO:** stale lineage text in `SEMANTICS.md` and `ACTOR-EVIDENCE.json`.
- **F-014 INFO:** residual host-gate gaps.

## 5. Execution (one invocation; `run.cjs execute 3e1e329f… c365eeb2…`)

1. **Pins.** Manifest, runtime and review pins verified; no prior `ATTEMPT.json` or `execution/`.
2. **Fresh observation** at 21:26:48Z: `I316_OBS_DECISION=PASS`. Identity was `afldb_prod`, OID
   66668, system identifier 7674454702926115004, server 160015, read-only `afldb_backup`.
3. **Read-only prerequisite session.** Evidence: `prerequisite-20261024T212647Z/`, 8 files, all
   hash-matched, stderr empty.
   - Host gate PASS and transport prerequisites PASS.
   - Identity and principal: `afldb_owner`, session and current user, non-superuser, database
     owner, read_only=on.
   - Visibility: `update_process_title=on`; 2 other-role client sessions, state redacted.
   - Operational DB gate PASS and full read-only preflight PASS.
   - `attempt_consumed:false`.
4. **Marker.** `ATTEMPT.json` was written at 21:27:33.683Z. It pins the prerequisite evidence
   (compact-JSON hash `4989fba6…2cc88`, recomputed and matching).
5. **One write session.** All eight markers appeared in order: transaction begun, protected locks
   acquired, post-lock guards passed, before-state captured, metadata writes completed,
   in-transaction assertions passed, commit acknowledged, postcommit verification passed.
   Identity and principal were checked in all three streams, as `afldb_owner` and non-superuser
   each time. SSH exit 0, stderr empty.
6. **Postcheck PASS** (`u3_confirmable:true`):
   - Receipt `data_edits` id 95 was written at 21:28:17Z. Its fields are `field_group
     audit_note_repair` and `target_audit_id 94`. The old values are note NULL and authority 93;
     the new values are the approved note, the approval, manifest and review hashes, and
     session/current user `afldb_owner`.
   - The protected snapshot and the hashes of every other audit row are unchanged.
   - The optional Brownlow schema is absent, so there is no drift.
7. **Result.** `execution/result.json`: verdict PASS, metadata_verified, u3_confirmed,
   attempt_consumed, no automatic retry or reversal, finished 21:30:32Z.
   `execution/EVIDENCE-HASHES.json` pins `result.json` (`5cc447c7…`), `stdout.log`
   (`7ca8c61c…`), `stderr.log` (empty) and `submitted.sql` (`e9fd36c9…`).

No credential, DSN or `PGPASSWORD` value appears in any retained execution or prerequisite file;
the `AFLDB_*` hits in the observation log are only gate label names.

## 6. U3 confirmation

U3 is confirmed with the approved wording: **"2026 is complete, and no further 2026 AFL API settle is
needed or will be done only through an audited correction."**

## Standing

U4 stays Route B, and Brownlow is untouched. None of the following were done: census, seal or
rollover, successor activation, production apply, deployment, rebuild, push or git operation.
No role, grant, sudo rule, authentication change or credential was created or changed.
**Production remains NO-GO.**
