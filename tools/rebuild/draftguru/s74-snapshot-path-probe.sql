-- AFLDB-ISSUE-222 §7.4 -- read-only preflight probe for the ONE contract s74-snapshot.sql
-- depends on and that nothing else in the exercise proves: `\copy ... TO '<relative name>'`
-- writes to psql's own working directory, which s74-rollback-exercise.ps1 sets per stage.
--
-- Run by s74-rollback-exercise.ps1 through exactly the same helper, the same psql flags and the
-- same forced-read-only session as a real S0/S1/S2/S3 capture, but BEFORE the typed confirmation
-- and before any mutation. If the working-directory contract does not hold on this machine, the
-- exercise refuses while afldb_test is still untouched, instead of discovering it after REVERSE #1
-- has already reversed the bridge.
--
-- Reads no application table. Issues no write to the database.

\pset format unaligned
\pset fieldsep ','
\pset null ''

\copy (SELECT 1 AS probe) TO 'snapshot-path-probe.csv' CSV HEADER
