# V4 proof boundary

V3 F-004 ordering remains: the pre-read prefix contains BEGIN, five literal SET
LOCAL utilities, plain deterministic LOCK commands and psql client directives.
There is no DO, SELECT, expression, catalog query or guard before all locks.
The inherited PostgreSQL16 source checks are postgres.c exec_simple_query,
analyze.c analyze_requires_snapshot, pquery.c PlannedStmtRequiresSnapshot and
lockcmds.c LockTableCommand. Plain transaction, variable-set and lock utilities
do not establish the serializable working data snapshot; a DO block would.

Existing protected relations, actor and migration ledger use SHARE; data_edits
uses SHARE ROW EXCLUSIVE. Existing incompatible writers wait before the first
repair data snapshot, and changed data refuses strict preflight comparison.
Later writers remain excluded until transaction end. Existing optional relations
get the same protection. Catalogs are guard/environment metadata; v4 has no
catalog locks and claims no database-wide CREATE exclusion.

Optional preflight booleans select only plain locks. Post-lock coverage checks
current existence/modes. A disappeared preflight-present relation causes LOCK
failure; an appeared unlocked relation refuses. Later detected environment change
before COMMIT rolls back both metadata writes. Absence is no input to either write;
repair-body.sql is byte-equal to frozen v3.

F-005 was valid against the old absence-through-COMMIT claim. The owner withdrew
that claim. V4 removes both catalog locks; it does not attempt broader locks.
A late unrelated CREATE after final assertions may commit independently. Fresh
postcheck detects optional presence/schema drift, independently validates exact
metadata and existing data, and returns CONCURRENT_SCHEMA_DRIFT with U3 blocked.
That is not corruption or an isolation failure of the two metadata writes. No
retry/reversal is authorised. Any existing protected-data change still stops.
Operational checks observe currently known work/version, never future-DDL exclusion.

Real PostgreSQL validation separates earlier rollback from late committed repair
plus drift detection. The harness splits exact expanded repair immediately before
COMMIT. Production SQL contains no synchronization hook, wait or identity override.
Only client directives and separately tested production-only identity are excluded
in synthetic execution. PGlite makes no multi-session concurrency claim.

Inherited official references:
[LOCK](https://www.postgresql.org/docs/16/sql-lock.html) and
[lock conflict matrix](https://www.postgresql.org/docs/16/explicit-locking.html).
