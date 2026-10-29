# F-004 statement and locking proof

The production repair remains SERIALIZABLE. The complete pre-identity prefix is:
psql `\set`/`\echo`, `BEGIN`, five literal `SET LOCAL` operations, plain `LOCK TABLE`
utilities, and psql `\if`/`\endif` around the two optional locks. There is no SQL
expression, function, `DO`, `SELECT`, catalog query or data guard in that prefix.

PostgreSQL 16 source was checked, including both planning and utility execution:

- [postgres.c, exec_simple_query](https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/tcop/postgres.c)
  calls `analyze_requires_snapshot` before analysis.
- [analyze.c, analyze_requires_snapshot](https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/parser/analyze.c)
  requires analysis snapshots for optimisable statements, not the plain transaction,
  lock and variable-setting utilities used here.
- [pquery.c, PlannedStmtRequiresSnapshot](https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/tcop/pquery.c)
  explicitly exempts `TransactionStmt`, `LockStmt` and `VariableSetStmt` from working
  snapshot acquisition. A `DoStmt` has no exemption. Merely moving identity below
  v2's dynamic lock DO block would therefore not close F-004.
- [lockcmds.c, LockTableCommand](https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/commands/lockcmds.c)
  acquires relation locks by name; internal name/catalog cache access is part of
  the lock utility and does not establish the SERIALIZABLE working data snapshot.
- [LOCK documentation](https://www.postgresql.org/docs/16/sql-lock.html) explicitly
  requires locking before the first read in SERIALIZABLE and documents ordered
  acquisition, retention to transaction end, and SHARE ROW EXCLUSIVE for a writer.
- [Lock conflict matrix](https://www.postgresql.org/docs/16/explicit-locking.html)
  shows SHARE conflicts with ROW EXCLUSIVE, SHARE UPDATE EXCLUSIVE, SHARE ROW
  EXCLUSIVE, EXCLUSIVE and ACCESS EXCLUSIVE. The same transaction's locks do not
  conflict with its own UPDATE/INSERT.

The five settings use literal values: lock_timeout 2s, statement_timeout 10min,
idle_in_transaction_session_timeout 2min, timezone UTC and a literal search_path.
They neither query database state nor call set_config through a SELECT. psql
markers/conditionals operate in the client and issue no server query.

The separate read-only preflight obtains optional-relation booleans in its own
transaction. The repair uses those booleans solely to choose plain lock commands.
They cannot authorise a write. After all commands finish, the repair independently
checks pg_locks for every required/existing optional relation and expected mode.
All original identity, schema, actor, approval, target, authority, canonical and
snapshot-equality gates then run before either metadata write.

Deterministic lock order: pg_class, pg_namespace; data_edits (SHARE ROW EXCLUSIVE);
auth_users; the unchanged 25-member protected.required inventory in its original
order; the two optional relations in their original order when preflight saw them.
All other named locks are SHARE. No protected relation was removed.

The two added catalog SHARE locks block relation creation started after acquisition
(including an optional relation absent at preflight) and schema rename/drop. Existing relation
locks exclude protected DML and incompatible DDL such as ALTER/DROP/TRUNCATE and
CREATE TRIGGER. They can briefly block unrelated DDL in this database too. Waiting
is bounded by the same approved two-second per-lock timeout; a deadlock/timeout
aborts before writes. This is an exceptional metadata repair, not a general online
migration strategy. No catalog rows are written by this repair.

If optional creation commits before the held-lock guard, the subsequent catalog
name lookup and lock-coverage guard refuse the new unlocked relation. If creation
starts after the catalog locks, catalog modification blocks. Real PostgreSQL also
shows a subtler timing case: an already-executed CREATE does not retain catalog
RowExclusiveLock until commit. It can commit after the repair guards while catalog
SHARE locks are held. This case is NOT claimed to be excluded by those locks.
Fresh catalog name resolution in the in-transaction snapshot/assertions detects
the newly visible optional relation and aborts both metadata writes before COMMIT.
The real test proves rollback with note 94 NULL and only the original audit row.
The independent reviewer must assess this limit against the owner's DDL exclusion
requirement; passing regression assertions alone cannot waive that requirement. A formerly present relation that disappeared
causes its plain LOCK to fail. An ordinary protected writer that commits while the
repair waits is visible in the repair's first snapshot, and changed fingerprints
refuse before writes. Writers starting after the locks wait or refuse until the
repair transaction ends. The fresh postcheck is additional evidence, never the
concurrency authority.

`validate-order.cjs` checks the exact prefix, inventory, modes and marker ordering.
PGlite is used only for synthetic SQL/atomicity regression. It is not a multi-session
PostgreSQL concurrency proof. `validate-pg.cjs` creates a new PostgreSQL 16 cluster,
private owner-only Unix socket directory, no TCP listener, synthetic fixtures and
a dedicated `_test` database. It observes repair waits from a third connection,
tests writers on both sides of lock acquisition, tests optional presence/absence
and DDL, and verifies rollback/postcheck. The cluster is stopped and retained;
no rebuild tooling or shared DEV/test/prod database is used.
