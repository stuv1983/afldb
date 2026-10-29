# ISSUE-316 U3 metadata repair v5

Derived from frozen v4 (manifest `829fc30a…848ecf84`) by `../PREPARE-V5.cjs`. v2, v3 and v4 are
frozen evidence and must not execute. v5 changes only the execution transport, the database
principal binding, the single-use attempt boundary and the integration of the no-sudo operational
observation, plus the tests and evidence those changes need. `V5-DELTA.md` lists every changed byte.
U3 stays unconfirmed until execution and a clean postcheck. U4 Route B; Brownlow untouched;
overall production NO-GO.

## Unchanged write and protection contract

`repair-body.sql` still makes exactly two logical metadata writes: the guarded NULL-to-note UPDATE of
`data_edits` 94.note, then one linked audit INSERT. The note is 967 UTF-8 bytes and characters,
SHA-256 `3d2d25ea4919dcdc1cfd8fcaa1b2ede6941e10ab0d07404fa0e2279fcc33621d`. The only change to that
file is the descriptive `execution_operator` literal in the audit record's `new_values`, which must
name the actual operator and transport truthfully. Authority 93, audit row 94's other fields, every
other audit row and every existing protected canonical/derived/Brownlow relation stay immutable,
asserted inside the locked transaction and again by the independent postcheck. Locks, lock ordering
(F-004), snapshots, the F-005 drift contract and all assertions are byte-identical to v4.

## Principal: existing `afldb_owner`, explicitly pinned

Read-only discovery (`../metadata-repair-v5-discovery/`, via the existing `afldb_backup` credential,
catalog privilege functions only) found that only `afldb_owner` and the superuser `postgres` can
update `data_edits.note`. Every application role is append-only on the audit table by design:
`afldb_import`, the normal audited admin path, holds INSERT only, and it also cannot take the
inherited lock set. `afldb_owner` is the existing non-superuser owner of `afldb_prod`, its schemas
and all 28 lock-set relations. It is the established production migration principal
(`AFLDB_PROD_DATABASE_URL`) and is reachable through the existing arm-only `.env`. No role, grant,
sudo rule, authentication change or new credential is needed. It is the narrowest existing role
that can perform the repair; it is broader than the two writes need, because it can also run DDL,
and the transaction runs none.

`identity.sql` keeps the instance binding (`afldb_prod`, OID 66668, system identifier
7674454702926115004) and now requires `session_user = current_user = afldb_owner`. The new
`principal.sql` runs right after it in preflight, repair (after all locks) and postcheck. It
refuses on: a wrong session or current user; superuser, CREATEROLE, CREATEDB, REPLICATION or
BYPASSRLS; any membership in either direction; any role-level setting; a database, data_edits,
id-sequence or lock-set ownership other than `afldb_owner`; any change to the exact data_edits and
sequence ACLs; any column ACL; and any change to the set of non-superuser roles able to update
`note` (exactly `afldb_owner` and `pg_write_all_data`, the latter with no members). It never accepts
a role just because that role holds a privilege. The migration ledger (110) and every v4 guard still
apply.

`operational-guard.sql` gains one directly required control. A non-superuser without
`pg_read_all_stats` cannot see another role's activity state or query text. The guard records that
visibility and refuses unless `update_process_title=on`, the condition that makes the host gate's
PostgreSQL process-title scan meaningful. `pg_locks` and prepared-transaction checks stay fully
visible: real tests show that another role's uncommitted DDL is still refused.

## Transport and credential handling

`transport.sh` runs on the production host after `operational-host.sh`, in the same `bash -c`
script. It reads exactly one `AFLDB_PROD_DATABASE_URL` line from `/home/arm/projects/afldb/.env`,
which must be mode 600 and owned by arm. It refuses unless the DSN names exactly
`afldb_owner@localhost:5432/afldb_prod`, with no parameters. It then clears the inherited
environment and execs `/usr/bin/psql -X … -f -`. The password lives only in `PGPASSWORD`: never in
argv, never printed, never written. The wrapper never reads a credential. The SQL is psql stdin,
never shell source.

## Operational observation and host gate

`operational-observation.sh` is a byte copy of the replacement observation that passed on
production at 2026-10-24T20:28Z. It uses no sudo, checks each producer's exit status, validates
full process visibility, observes database activity read-only and checks service and deployment
state. `run.cjs` runs it fresh, with the corrected text OID comparison, before any other
production contact. `operational-host.sh` replaces the v4 `sudo -n ps` pipeline (F-006). It is the
host part of that observation, fail-closed, and prints no command arguments.

## Single-use boundary (`run.cjs`)

```
node issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v5/run.cjs verify REVIEWED_MANIFEST_HASH
node issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v5/run.cjs execute REVIEWED_MANIFEST_HASH REVIEWED_DECISION_HASH
```

1. Verify the manifest, runtime and review pins (GO, zero stopping findings).
2. Refuse at once if `ATTEMPT.json` or `execution/` exists.
3. Run the fresh observation.
4. Open the read-only prerequisite session: host gate, transport prerequisites, the identity and
   principal connection, and the exact read-only preflight, with
   `default_transaction_read_only=on` set. Evidence goes to a new `prerequisite-<utc>/`
   directory. Any failure in steps 3–4 stops with **no attempt consumed** and no write-capable
   session opened.
5. Persist `ATTEMPT.json` (exclusive create), immediately before the single write-capable invocation.
6. Invoke the write session exactly once: host gate, transport, then the v4-identical stream of
   preflight, repair and postcheck. From step 5 on, the attempt is consumed whatever the outcome.
   Nothing retries or reverses automatically.

`prerequisite` mode runs steps 1–4 only. Verdicts are those of v4: PASS (U3 confirmable),
CONCURRENT_SCHEMA_DRIFT (metadata verified, U3 unconfirmed, owner adjudication) or STOP_NO_RETRY.
A failed INSERT may consume a sequence value; never reset it or delete audit history.

## Validation (final run pinned by `VALIDATION-EVIDENCE.json`)

- `validate.cjs` (PGlite): the 19 inherited semantic and rollback cases, plus the principal
  refusing a non-`afldb_owner` superuser session.
- `validate-pg.cjs` runs on a fresh private PostgreSQL 16 cluster on streamanator: Unix socket for
  fixture setup, plus `127.0.0.1` only with scram-sha-256 for the real transport. The cluster
  reproduces the production role model, with the production ACL text exactly. The 10 inherited
  F-004/F-005/rollback cases now run as non-superuser `afldb_owner` and include `principal.sql`.
  Added: wrong session user (importer, superuser, superuser with `SET ROLE`); wrong current user;
  attribute, setting, membership, privilege and ownership refusals; reduced-visibility behaviour;
  real `transport.sh` and psql, with an accepted read-only prerequisite and a write-capable
  execute; ten credential prerequisite stops before connection; authentication failure;
  off-production host-gate refusal. Credential checks cover every process argv, psql's exact
  environment (allowlist plus platform-added `SHLVL` and `PGSYSCONFDIR`), stdout/stderr and every
  retained evidence file.
- `validate-wrapper.cjs` (VM, stubbed transport): 30 boundary cases plus a static composition check.
  Observation, prerequisite, transport, credential, connection and principal failures never create
  the marker. The marker exists before the write invocation. A write-session failure consumes the
  attempt, and a relaunch is refused before any production contact.
- `validate-order.cjs`: unchanged from v4.

Limits: synthetic shapes; no production transport or live-schema acceptance; installed remote
binaries, including the Debian `/usr/bin/psql` wrapper, are trusted platform. These are bounded
stop/go observations, not exclusion of future DDL.

No census, seal/rollover, successor activation, production apply, deployment, rebuild or push.
Production remains NO-GO regardless of metadata-only success.
