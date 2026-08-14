-- =====================================================================
-- AFLDB 011 — Allow the import role to reset sequences
-- =====================================================================
-- After bulk-loading players and matches with explicit ids (preserved
-- from the legacy database so parity checks stay exact), the importer
-- must fast-forward the identity sequences with setval(). setval()
-- requires UPDATE on the sequence, and only USAGE and SELECT had been
-- granted.
--
-- TRUNCATE ... RESTART IDENTITY is not used, because restarting an
-- identity requires ownership of the sequence and the import role
-- deliberately does not own schema objects.
-- =====================================================================

GRANT UPDATE ON ALL SEQUENCES IN SCHEMA public TO afldb_import;

ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO afldb_import;
