/**
 * The database roles are the last line of defence, so they are tested.
 *
 * The security model rests on afldb_app — the role every public page
 * runs as — holding SELECT and nothing else. That is what makes a SQL
 * injection in a public query a disclosure bug rather than a data-loss
 * one, and what keeps the auth and submission tables invisible to the
 * side of the app that faces the internet.
 *
 * Until now that invariant was asserted only in migration comments. The
 * integration suite connects as afldb_owner, so a regression that
 * widened afldb_app's grants — a stray `GRANT ALL`, a table created by a
 * later migration without a considered grant, a default-privileges
 * change — would have passed CI unnoticed and shipped.
 *
 * These tests interrogate the catalogue rather than connecting as
 * afldb_app, so they need no second password: has_table_privilege and
 * friends answer for any role when asked by the owner. That also means
 * they cover privileges the role holds but has not exercised, which a
 * "try a write and expect it to fail" test would miss.
 */
import './guard';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';

afterAll(async () => {
  await sql.end();
});

/** The role the website runs as. */
const APP_ROLE = 'afldb_app';

/** Schemas holding statistical data the public site reads. */
const DATA_SCHEMAS = ['public', 'aflw'];

/**
 * Operational tables from migrations 023/024/030. The public role should
 * not even be able to read these: sessions, hashed access/invite codes
 * and the audit log never render on a public page.
 *
 * A table landing in this list is not enough on its own to protect it:
 * `public` carries a schema-wide default privilege (see migration 031)
 * that grants afldb_app SELECT on every table afldb_owner creates,
 * statistical or not. Adding a table here without also revoking it in a
 * migration documents the gap; it does not close it.
 */
const OPERATIONAL_TABLES = [
  'auth_users',
  'auth_sessions',
  'auth_audit_log',
  'beta_access_codes',
  'beta_allowed_emails',
  'beta_login_tokens',
  'beta_join_requests',
  'data_submissions',
  'data_submission_rows',
  'admin_invites',
];

beforeAll(async () => {
  const [role] = await sql<{ rolname: string }[]>`
    SELECT rolname FROM pg_roles WHERE rolname = ${APP_ROLE}
  `;
  if (!role) {
    throw new Error(
      `Role ${APP_ROLE} does not exist in this cluster, so the read-only `
      + 'invariant cannot be verified. Create it (tools/db install script) '
      + 'rather than skipping: an unverifiable invariant is not a passing one.',
    );
  }
});

describe(`${APP_ROLE} is read-only`, () => {
  it('is an unprivileged login role', async () => {
    const [role] = await sql<{
      rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean;
    }[]>`
      SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
        FROM pg_roles WHERE rolname = ${APP_ROLE}
    `;
    // A superuser bypasses every grant below, so these four make the rest
    // of this file meaningful rather than decorative.
    expect(role).toMatchObject({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
  });

  it('is not a member of a writing role', async () => {
    // Membership would inherit the writer's grants without any of them
    // appearing against afldb_app in the checks below.
    const rows = await sql<{ writer: string }[]>`
      SELECT r.rolname AS writer
        FROM pg_roles r
       WHERE r.rolname IN ('afldb_owner', 'afldb_import', 'afldb_auth', 'postgres')
         AND pg_has_role(${APP_ROLE}, r.oid, 'USAGE')
    `;
    expect(rows.map((r) => r.writer)).toEqual([]);
  });

  it('holds no write privilege on any table or view', async () => {
    // has_any_column_privilege, not has_table_privilege, because INSERT
    // and UPDATE can be granted per column: a column-scoped grant is a
    // write the table-level check would report as absent.
    const rows = await sql<{ schema: string; name: string; privilege: string }[]>`
      SELECT n.nspname AS schema, c.relname AS name, p.privilege
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL (VALUES ('INSERT'), ('UPDATE')) AS p(privilege)
       WHERE n.nspname::text = ANY(${DATA_SCHEMAS})
         AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND has_any_column_privilege(${APP_ROLE}, c.oid, p.privilege)
      UNION ALL
      SELECT n.nspname, c.relname, p.privilege
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL (VALUES ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(privilege)
       WHERE n.nspname::text = ANY(${DATA_SCHEMAS})
         AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND has_table_privilege(${APP_ROLE}, c.oid, p.privilege)
       ORDER BY 1, 2, 3
    `;
    expect(rows).toEqual([]);
  });

  it('cannot advance a sequence', async () => {
    // USAGE or UPDATE on a sequence is a write, and it is what an INSERT
    // into an identity column needs. Granting it to the read-only role
    // has no legitimate purpose.
    const rows = await sql<{ name: string; privilege: string }[]>`
      SELECT c.relname AS name, p.privilege
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL (VALUES ('USAGE'), ('UPDATE')) AS p(privilege)
       WHERE n.nspname::text = ANY(${DATA_SCHEMAS})
         AND c.relkind = 'S'
         AND has_sequence_privilege(${APP_ROLE}, c.oid, p.privilege)
       ORDER BY 1, 2
    `;
    expect(rows).toEqual([]);
  });

  it('cannot create objects in the data schemas', async () => {
    // PostgreSQL 16 no longer grants CREATE on schema public to PUBLIC
    // (that changed in 15), so this asserts a deliberate grant rather
    // than fighting a server default.
    const rows = await sql<{ schema: string }[]>`
      SELECT n.nspname AS schema
        FROM pg_namespace n
       WHERE n.nspname::text = ANY(${DATA_SCHEMAS})
         AND has_schema_privilege(${APP_ROLE}, n.oid, 'CREATE')
    `;
    expect(rows).toEqual([]);
  });

  it('cannot read the auth or submission tables at all', async () => {
    // Not merely "cannot write": a session token hash or a hashed access
    // code has no business being reachable from the public pool, so the
    // absence of SELECT is the assertion.
    const rows = await sql<{ name: string }[]>`
      SELECT c.relname AS name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname::text = ANY(${OPERATIONAL_TABLES})
         AND has_any_column_privilege(${APP_ROLE}, c.oid, 'SELECT')
       ORDER BY 1
    `;
    expect(rows.map((r) => r.name)).toEqual([]);
  });

  it('still reads the statistical tables it serves', async () => {
    // The counterweight: a role with no privileges at all would pass
    // every test above and serve a blank site.
    //
    // site_settings (migration 034) is in this list rather than in
    // OPERATIONAL_TABLES on purpose: it is the one operational table the
    // public role is MEANT to read, because the home page renders the
    // layout and record choices stored in it. It holds no secret, and the
    // write side of it is afldb_auth's alone — which the "holds no write
    // privilege on any table" test above already enforces for this role.
    const rows = await sql<{ name: string; readable: boolean }[]>`
      SELECT t.name, has_table_privilege(${APP_ROLE}, t.name, 'SELECT') AS readable
        FROM unnest(ARRAY['players', 'clubs', 'matches', 'seasons',
                          'player_career_stats', 'player_match_stats',
                          'site_settings']) AS t(name)
    `;
    expect(rows.every((r) => r.readable)).toBe(true);
  });
});

describe('afldb_auth is confined to the operational tables', () => {
  it('holds no write privilege on the statistical tables', async () => {
    const [role] = await sql<{ rolname: string }[]>`
      SELECT rolname FROM pg_roles WHERE rolname = 'afldb_auth'
    `;
    if (!role) {
      throw new Error(
        'Role afldb_auth does not exist; run tools/maintenance/02_add_auth_role.sh '
        + 'against this cluster so the confinement can be verified.',
      );
    }

    // Migration 023 grants afldb_auth SELECT on the statistical tables
    // that validation resolves names against, and write on nothing there.
    // Promotion is the import role's job precisely so a compromise of the
    // login path cannot rewrite history.
    const rows = await sql<{ name: string; privilege: string }[]>`
      SELECT c.relname AS name, p.privilege
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL (VALUES ('INSERT'), ('UPDATE')) AS p(privilege)
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p')
         AND c.relname IN ('players', 'clubs', 'matches', 'seasons',
                           'player_career_stats', 'player_match_stats',
                           'award_winners', 'award_nominations')
         AND has_any_column_privilege('afldb_auth', c.oid, p.privilege)
       ORDER BY 1, 2
    `;
    expect(rows).toEqual([]);
  });
});
