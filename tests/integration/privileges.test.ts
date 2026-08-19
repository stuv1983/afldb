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
import { OPERATIONAL_TABLES } from '@/db/queries/db-health';

afterAll(async () => {
  await sql.end();
});

/** The role the website runs as. */
const APP_ROLE = 'afldb_app';

/** The role that owns the auth, beta and admin-content tables. */
const AUTH_ROLE = 'afldb_auth';

/** The ETL role. Writes the statistical tables; nothing else. */
const IMPORT_ROLE = 'afldb_import';

/** Schemas holding statistical data the public site reads. */
const DATA_SCHEMAS = ['public', 'aflw'];

/*
 * OPERATIONAL_TABLES is imported rather than restated. It used to be a
 * hand-copy of the list in db-health.ts, and the two silently diverged
 * the first time one of them was updated on its own.
 *
 * Listing a table there does not protect it, and this file no longer
 * relies on the list to notice a leak. Migration 039 inverted the
 * schema-wide default privilege that granted afldb_app SELECT on
 * everything afldb_owner created -- the mechanism that leaked the auth
 * tables in 023 and site_media in 037, both times past a header saying
 * no grant was intended. The database now carries the positive list
 * (afldb_meta.app_readable_tables), and "reads exactly what the registry
 * allows" below is the assertion that catches an unclassified table,
 * whether or not anyone remembered to add it here.
 */

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
    //
    // The existence check first, because this query joins pg_class: a
    // table missing from the database under test -- a stale test DB that
    // stopped at an earlier migration -- matches no row, and the SELECT
    // assertion would pass green having inspected nothing at all.
    const missing = await sql<{ name: string }[]>`
      SELECT t.name
        FROM unnest(${OPERATIONAL_TABLES}::text[]) AS t(name)
       WHERE to_regclass('public.' || quote_ident(t.name)) IS NULL
       ORDER BY 1
    `;
    expect(
      missing.map((r) => r.name),
      'operational tables absent from this database; run npm run db:migrate:test',
    ).toEqual([]);

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

  it('reads exactly the tables the registry allows, and no others', async () => {
    // The assertion that does not depend on anyone maintaining a list of
    // known-bad names. Every table in `public` is compared against
    // afldb_meta.app_readable_tables (migration 039): registered means it
    // must be readable, unregistered means it must not be.
    //
    // A future migration that creates a table and says nothing about
    // privileges fails HERE, whichever kind of table it is -- which is
    // the property the old known-bad-names check could not have, because
    // a table nobody thought to add to the list was filtered out of the
    // query and passed by default.
    const rows = await sql<{ name: string; registered: boolean; readable: boolean }[]>`
      SELECT c.relname AS name,
             (r.name IS NOT NULL) AS registered,
             has_any_column_privilege(${APP_ROLE}, c.oid, 'SELECT') AS readable
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN afldb_meta.app_readable_tables r ON r.name = c.relname
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       ORDER BY 1
    `;
    expect(rows.length).toBeGreaterThan(0);

    const drift = rows
      .filter((r) => r.registered !== r.readable)
      .map((r) => `${r.name}: ${r.registered ? 'registered but unreadable'
        : 'READABLE BUT NOT REGISTERED'}`);
    expect(
      drift,
      'run npm run db:privileges, or register the table with '
      + "SELECT afldb_meta.grant_app_read('<table>') in its migration",
    ).toEqual([]);
  });

  it('has no default privilege that would grant it a future table', async () => {
    // The root cause of both leaks, asserted directly. While a default
    // privilege on `public` grants afldb_app SELECT, every test above is
    // a snapshot: correct today and silently wrong the moment the next
    // migration runs. Migration 039 removed it.
    //
    // Scoped to `public`: staging, staging_aflw and aflw keep theirs
    // (migrations 014/025/026) and hold no operational table.
    const rows = await sql<{ privilege: string }[]>`
      SELECT a.privilege_type AS privilege
        FROM pg_default_acl d
        JOIN pg_namespace n ON n.oid = d.defaclnamespace
       CROSS JOIN LATERAL aclexplode(d.defaclacl) AS a
        JOIN pg_roles g ON g.oid = a.grantee
       WHERE n.nspname = 'public'
         AND d.defaclobjtype = 'r'
         AND g.rolname = ${APP_ROLE}
       ORDER BY 1
    `;
    expect(rows.map((r) => r.privilege)).toEqual([]);
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
  it('still holds the grants the admin pages depend on', async () => {
    // The counterweight to every revoke in this file, and the one that
    // was missing: nothing asserted that the role which MUST read these
    // tables still can. An over-broad revoke -- `REVOKE ALL ON site_media
    // FROM PUBLIC`, or afldb_auth typed where afldb_app was meant --
    // satisfies all of the negative assertions above and takes
    // /admin/content and Publish down in production instead of in CI.
    //
    // These are the grants migrations 023/024/030/032/034/037 make, each
    // inside an `IF EXISTS (afldb_auth)` guard that is skipped when the
    // role is created after the migrations run. That ordering is exactly
    // how site_media ended up readable by no role at all once 038 landed.
    const rows = await sql<{ name: string; privilege: string; held: boolean }[]>`
      SELECT t.name, t.privilege,
             has_table_privilege(${AUTH_ROLE}, t.name, t.privilege) AS held
        FROM (VALUES
                ('auth_users',           'SELECT'),
                ('auth_users',           'UPDATE'),
                ('auth_sessions',        'INSERT'),
                ('auth_audit_log',       'INSERT'),
                ('beta_access_codes',    'SELECT'),
                ('beta_login_tokens',    'INSERT'),
                ('beta_join_requests',   'SELECT'),
                ('admin_invites',        'INSERT'),
                ('data_submissions',     'UPDATE'),
                ('data_submission_rows', 'DELETE'),
                ('site_settings',        'UPDATE'),
                ('site_media',           'SELECT'),
                ('site_media',           'INSERT'),
                ('site_media',           'DELETE'),
                ('matches',              'SELECT'),
                -- The natural-language surfaces (046, 047, 049). Named here
                -- because the reconciler's afldb_auth section is SUBTRACTIVE:
                -- a table the feature ships without adding to that spec keeps
                -- working until the next restore silently revokes it, and the
                -- public write path swallows the permission error by design.
                ('nl_search_log',        'INSERT'),
                ('nl_search_review',     'UPDATE'),
                ('nl_search_feedback',   'SELECT'),
                ('nl_search_feedback',   'INSERT'),
                -- Player-link review (056): the public suggestion form and
                -- the admin queue both run as afldb_auth.
                ('player_link_suggestions', 'SELECT'),
                ('player_link_suggestions', 'INSERT'),
                ('player_link_resolutions', 'SELECT'),
                ('player_link_resolutions', 'INSERT'),
                -- Manual-edit audit (057).
                ('data_edits',              'SELECT'),
                ('data_edits',              'INSERT')
             ) AS t(name, privilege)
       ORDER BY 1, 2
    `;
    const lost = rows.filter((r) => !r.held).map((r) => `${r.name}.${r.privilege}`);
    expect(
      lost,
      'run tools/maintenance/privileges.sql against this database',
    ).toEqual([]);
  });

  it('cannot rewrite what a reader said', async () => {
    // nl_search_feedback and nl_search_log are append-only, and the ABSENT
    // grant is what enforces that rather than everyone remembering it. A
    // reader having pressed "no" at 8:04pm is a fact that happened; an
    // admin who disagrees records that in nl_search_review, which is the
    // one of the three that is meant to be mutable.
    // player_link_resolutions (056) and data_edits (057) are append-only
    // the same way: a wrong decision gets a new row, never an edit.
    const rows = await sql<{ name: string; privilege: string }[]>`
      SELECT t.name, p.privilege
        FROM unnest(ARRAY['nl_search_feedback', 'nl_search_log',
                          'player_link_resolutions', 'data_edits']) AS t(name)
       CROSS JOIN LATERAL (VALUES ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(privilege)
       WHERE has_table_privilege(${AUTH_ROLE}, t.name, p.privilege)
       ORDER BY 1, 2
    `;
    expect(rows).toEqual([]);
  });

  it('can move a link suggestion through the workflow but never edit its words', async () => {
    // Migration 056's column-scoped UPDATE: the workflow fields are
    // mutable, the reader's own text is not, and the grant is what
    // enforces the split. has_table_privilege stays false because no
    // table-wide UPDATE exists -- the same shape as afldb_import's
    // data_submissions grant asserted below.
    const [privileges] = await sql<{
      tableUpdate: boolean; statusUpdate: boolean; nameUpdate: boolean;
      noteUpdate: boolean; deletes: boolean;
    }[]>`
      SELECT has_table_privilege(${AUTH_ROLE}, 'player_link_suggestions', 'UPDATE')
               AS "tableUpdate",
             has_column_privilege(${AUTH_ROLE}, 'player_link_suggestions', 'status', 'UPDATE')
               AS "statusUpdate",
             has_column_privilege(${AUTH_ROLE}, 'player_link_suggestions', 'suggested_name', 'UPDATE')
               AS "nameUpdate",
             has_column_privilege(${AUTH_ROLE}, 'player_link_suggestions', 'note', 'UPDATE')
               AS "noteUpdate",
             has_table_privilege(${AUTH_ROLE}, 'player_link_suggestions', 'DELETE')
               AS deletes
    `;
    expect(privileges).toEqual({
      tableUpdate: false,
      statusUpdate: true,
      nameUpdate: false,
      noteUpdate: false,
      deletes: false,
    });
  });

  it('advances only the sequences behind the tables it writes', async () => {
    // Migrations 023 and 030 grant `USAGE, SELECT ON ALL SEQUENCES IN
    // SCHEMA public`, which is nextval on every statistical sequence for
    // a role whose table grants are an enumerated two dozen and which
    // inserts into none of them. Migration 045 narrows it to the
    // sequences behind its own tables.
    const rows = await sql<{ sequence: string; privilege: string }[]>`
      SELECT s.name AS sequence, p.privilege
        FROM unnest(ARRAY['players', 'matches', 'clubs', 'import_batches',
                          'player_match_stats']) AS t(name)
       CROSS JOIN LATERAL afldb_meta.owned_sequences(t.name) AS s(name)
       CROSS JOIN LATERAL (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS p(privilege)
       WHERE has_sequence_privilege(${AUTH_ROLE}, 'public.' || quote_ident(s.name), p.privilege)
       ORDER BY 1, 2
    `;
    expect(rows).toEqual([]);

    // The counterweight: the sequence it does need, or no admin can be
    // invited and nobody can log in.
    const [own] = await sql<{ held: boolean }[]>`
      SELECT has_sequence_privilege(${AUTH_ROLE}, 'public.' || quote_ident(s.name), 'USAGE') AS held
        FROM afldb_meta.owned_sequences('auth_users') AS s(name)
    `;
    expect(own?.held).toBe(true);
  });

  it('holds nothing at all on a statistical table outside its list', async () => {
    // The reconciler used to be additive for this role: it re-granted the
    // enumerated list and never revoked, so a hand-typed grant made during
    // an incident, or one left by an abandoned migration, survived every
    // run of the script that claims to reconcile privileges.
    //
    // These five are statistical tables that appear in no afldb_auth grant
    // in any migration, so the role must hold no privilege on them --
    // not even SELECT, which the validation reads are scoped away from.
    const rows = await sql<{ name: string; privilege: string }[]>`
      SELECT c.relname AS name, p.privilege
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL (VALUES ('SELECT'), ('INSERT'), ('UPDATE')) AS p(privilege)
       WHERE n.nspname = 'public'
         AND c.relname IN ('player_match_stats', 'brownlow_season_votes',
                           'draft_picks', 'club_seasons', 'data_issues')
         AND has_any_column_privilege(${AUTH_ROLE}, c.oid, p.privilege)
       ORDER BY 1, 2
    `;
    expect(
      rows,
      'run tools/maintenance/privileges.sql: its afldb_auth section now revokes '
      + 'everything outside the enumerated spec',
    ).toEqual([]);
  });

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

describe('afldb_import is confined to the statistical tables', () => {
  beforeAll(async () => {
    const [role] = await sql<{ rolname: string }[]>`
      SELECT rolname FROM pg_roles WHERE rolname = ${IMPORT_ROLE}
    `;
    if (!role) {
      throw new Error(
        `Role ${IMPORT_ROLE} does not exist in this cluster, so its confinement `
        + 'cannot be verified. Create it (tools/maintenance/00_install_postgres.sh) '
        + 'rather than skipping.',
      );
    }
  });

  it('cannot touch the auth, beta, invite or media tables', async () => {
    // The ETL role was never asserted about at all, and the same default
    // privilege that leaked SELECT to afldb_app had handed this role
    // SELECT/INSERT/UPDATE/DELETE -- and TRUNCATE, from migration 010 --
    // on every operational table the moment each was created. It could
    // rewrite a password hash in auth_users, delete the auth_audit_log
    // rows that would show it, or TRUNCATE site_media, the declared
    // source of truth for the published apex page.
    //
    // data_submissions and data_submission_rows are excluded: migration
    // 023 grants the import role a deliberate, narrow read there for the
    // promotion path, asserted separately below.
    const offLimits = OPERATIONAL_TABLES
      .filter((t) => t !== 'data_submissions' && t !== 'data_submission_rows');

    // Split the same way the afldb_app write test above is: SELECT,
    // INSERT and UPDATE can be granted per column, so the column-aware
    // check is the one that sees them; DELETE and TRUNCATE exist only at
    // table level and has_any_column_privilege rejects them outright.
    const rows = await sql<{ name: string; privilege: string }[]>`
      SELECT c.relname AS name, p.privilege
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL (VALUES ('SELECT'), ('INSERT'), ('UPDATE')) AS p(privilege)
       WHERE n.nspname = 'public'
         AND c.relname::text = ANY(${offLimits})
         AND has_any_column_privilege(${IMPORT_ROLE}, c.oid, p.privilege)
      UNION ALL
      SELECT c.relname, p.privilege
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL (VALUES ('DELETE'), ('TRUNCATE')) AS p(privilege)
       WHERE n.nspname = 'public'
         AND c.relname::text = ANY(${offLimits})
         AND has_table_privilege(${IMPORT_ROLE}, c.oid, p.privilege)
       ORDER BY 1, 2
    `;
    expect(rows).toEqual([]);
  });

  it('reads the submission tables at the width migration 023 asked for', async () => {
    // 023 granted SELECT on both plus UPDATE on four columns of
    // data_submissions, and the promotion path in src/lib/ingest does
    // even less than that -- every submission read and write there runs
    // on the auth pool. The full-table UPDATE the default privilege had
    // silently added made 023's column list decorative.
    const [privileges] = await sql<{
      selects: boolean; columnUpdate: boolean; tableUpdate: boolean;
      inserts: boolean; deletes: boolean; truncates: boolean;
    }[]>`
      SELECT has_table_privilege(${IMPORT_ROLE}, 'data_submissions', 'SELECT')     AS selects,
             has_column_privilege(${IMPORT_ROLE}, 'data_submissions', 'status', 'UPDATE')
                                                                                   AS "columnUpdate",
             has_table_privilege(${IMPORT_ROLE}, 'data_submissions', 'UPDATE')     AS "tableUpdate",
             has_table_privilege(${IMPORT_ROLE}, 'data_submissions', 'INSERT')     AS inserts,
             has_table_privilege(${IMPORT_ROLE}, 'data_submissions', 'DELETE')     AS deletes,
             has_table_privilege(${IMPORT_ROLE}, 'data_submissions', 'TRUNCATE')   AS truncates
    `;
    expect(privileges).toEqual({
      selects: true,
      columnUpdate: true,
      tableUpdate: false,
      inserts: false,
      deletes: false,
      truncates: false,
    });
  });

  it('has no default privilege that would grant it a future table', async () => {
    // The afldb_app half of this was migration 039; the ETL role kept the
    // identical mechanism for six more migrations. While a default
    // privilege on `public` grants afldb_import anything, every other test
    // in this describe is a snapshot: correct today, and silently wrong
    // the moment the next migration creates an operational table.
    // Migration 045 removed it, for TABLES and SEQUENCES both.
    const rows = await sql<{ kind: string; privilege: string }[]>`
      SELECT d.defaclobjtype::text AS kind, a.privilege_type AS privilege
        FROM pg_default_acl d
        JOIN pg_namespace n ON n.oid = d.defaclnamespace
       CROSS JOIN LATERAL aclexplode(d.defaclacl) AS a
        JOIN pg_roles g ON g.oid = a.grantee
       WHERE n.nspname = 'public'
         AND d.defaclobjtype IN ('r', 'S')
         AND g.rolname = ${IMPORT_ROLE}
       ORDER BY 1, 2
    `;
    expect(rows).toEqual([]);
  });

  it('writes exactly the tables the registry allows, and no others', async () => {
    // The counterpart of the afldb_app registry assertion, and the reason
    // migration 045 exists: a future migration that creates a table and
    // says nothing about privileges fails HERE rather than shipping an
    // operational table the ETL role can TRUNCATE.
    //
    // INSERT is the probe because it is the privilege the narrow
    // data_submissions grant (SELECT plus four updatable columns)
    // deliberately withholds -- so that table reads as unregistered here,
    // which it is.
    const rows = await sql<{ name: string; registered: boolean; writable: boolean }[]>`
      SELECT c.relname AS name,
             (w.name IS NOT NULL) AS registered,
             has_table_privilege(${IMPORT_ROLE}, c.oid, 'INSERT') AS writable
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN afldb_meta.import_writable_tables w ON w.name = c.relname
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p')
       ORDER BY 1
    `;
    expect(rows.length).toBeGreaterThan(0);

    const drift = rows
      .filter((r) => r.registered !== r.writable)
      .map((r) => `${r.name}: ${r.registered ? 'registered but not writable'
        : 'WRITABLE BUT NOT REGISTERED'}`);
    expect(
      drift,
      'run npm run db:privileges, or register the table with '
      + "SELECT afldb_meta.grant_import_write('<table>') in its migration",
    ).toEqual([]);
  });

  it('cannot reset the sequence behind an operational table', async () => {
    // Migration 039 revoked the operational TABLES from this role and left
    // their identity sequences reachable, and migration 011 had granted
    // UPDATE on every sequence in `public`. UPDATE on a sequence is what
    // setval() needs: setval('auth_users_id_seq', 1) makes every
    // subsequent insert fail on a duplicate key, which is a way into the
    // auth path from the ETL role without touching the auth table at all.
    const rows = await sql<{ sequence: string; privilege: string }[]>`
      SELECT s.name AS sequence, p.privilege
        FROM unnest(${OPERATIONAL_TABLES}::text[]) AS t(name)
       CROSS JOIN LATERAL afldb_meta.owned_sequences(t.name) AS s(name)
       CROSS JOIN LATERAL (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS p(privilege)
       WHERE has_sequence_privilege(${IMPORT_ROLE}, 'public.' || quote_ident(s.name), p.privilege)
       ORDER BY 1, 2
    `;
    expect(rows).toEqual([]);
  });

  it('can still fast-forward the sequences it bulk-loads', async () => {
    // The counterweight. The importer loads players and matches with the
    // legacy ids so parity checks stay exact, then calls setval() -- which
    // is why UPDATE on these sequences is granted rather than merely USAGE
    // (migration 011).
    const rows = await sql<{ sequence: string; held: boolean }[]>`
      SELECT s.name AS sequence,
             has_sequence_privilege(${IMPORT_ROLE}, 'public.' || quote_ident(s.name), 'UPDATE') AS held
        FROM unnest(ARRAY['players', 'matches', 'import_batches']) AS t(name)
       CROSS JOIN LATERAL afldb_meta.owned_sequences(t.name) AS s(name)
       ORDER BY 1
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => !r.held).map((r) => r.sequence)).toEqual([]);
  });

  it('cannot write the settings the home page renders', async () => {
    // site_settings is app-readable by design (034), and the reconciler
    // used to infer "operational" as the complement of what afldb_app may
    // read -- so it classed site_settings as a statistical table and
    // handed the ETL role DELETE and TRUNCATE on the site's runtime
    // configuration. Two registries instead of one inference (045).
    const [privileges] = await sql<{
      selects: boolean; inserts: boolean; updates: boolean;
      deletes: boolean; truncates: boolean;
    }[]>`
      SELECT has_table_privilege(${IMPORT_ROLE}, 'site_settings', 'SELECT')   AS selects,
             has_table_privilege(${IMPORT_ROLE}, 'site_settings', 'INSERT')   AS inserts,
             has_table_privilege(${IMPORT_ROLE}, 'site_settings', 'UPDATE')   AS updates,
             has_table_privilege(${IMPORT_ROLE}, 'site_settings', 'DELETE')   AS deletes,
             has_table_privilege(${IMPORT_ROLE}, 'site_settings', 'TRUNCATE') AS truncates
    `;
    expect(privileges).toEqual({
      selects: false,
      inserts: false,
      updates: false,
      deletes: false,
      truncates: false,
    });
  });

  it('still writes the statistical tables it reloads', async () => {
    // The counterweight: the revokes above must not have cost the ETL
    // role the access the nightly import actually runs on.
    const rows = await sql<{ name: string; privilege: string; held: boolean }[]>`
      SELECT t.name, p.privilege,
             has_table_privilege(${IMPORT_ROLE}, t.name, p.privilege) AS held
        FROM unnest(ARRAY['players', 'clubs', 'matches', 'seasons',
                          'player_career_stats', 'player_match_stats',
                          'import_batches']) AS t(name)
       CROSS JOIN LATERAL (VALUES ('SELECT'), ('INSERT'), ('UPDATE'),
                                  ('DELETE'), ('TRUNCATE')) AS p(privilege)
       ORDER BY 1, 2
    `;
    const lost = rows.filter((r) => !r.held).map((r) => `${r.name}.${r.privilege}`);
    expect(lost).toEqual([]);
  });
});
