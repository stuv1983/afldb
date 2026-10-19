/**
 * AFLDB V2 Stage 4 (plan D8, ADR 0008) — curated awards on an in-memory PGlite database.
 *
 * What runs for real here: migration 111 (`src/db/migrations/111_curated_award_proposals.sql`) is
 * applied VERBATIM from disk, its constraints are exercised, its roles/grants run against labelled stub
 * roles, and the actual `@afldb/admin` service SQL runs through the PGlite executor under the
 * `afldb_import` stub role.
 *
 * What does NOT: everything the stub prerequisites below stand in for. They are STUBS written for this
 * test (plan D2, review R-017) — NOT a copy of migrations 001-110, and they are deliberately minimal
 * (no triggers, no `afldb_meta`, no `data_overrides`, no real `award_winners` constraints). The
 * production promotion port (`insertAwardWinner`) therefore does not run here; a STUB promotion port
 * writing a stub `award_winners` row stands in for it, and that is exactly what the rollback test
 * proves the service rolls back. Nothing in this file touches a real PostgreSQL instance: PGlite is
 * in-memory (no dataDir), and the DSN policy (tests/setup.ts) is untouched.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CURATED_AWARD_TRANSITIONS,
  CuratedAwardError,
  PROPOSAL_ACTIONS,
  PROPOSAL_STATUSES,
  approveProposal,
  createProposal,
  createProposalsFromFile,
  isLegalTransition,
  listProposals,
  readProposalHistory,
  rejectProposal,
  reviseProposal,
  validateProposal,
  type AwardPromotionPort,
  type CuratedAwardsViewer,
  type ProposalInput,
} from '@afldb/admin';
import { createInMemoryPglite, pgliteExecutor, type InMemoryPglite } from '@afldb/testing';

const MIGRATION = join(process.cwd(), 'src', 'db', 'migrations', '111_curated_award_proposals.sql');
const NOW = () => new Date('2026-10-19T12:00:00Z');
const OPTIONS = { now: NOW };

const SUPER: CuratedAwardsViewer = { role: 'super_admin', canManageAdmins: true, userId: 1 };
const ADMIN: CuratedAwardsViewer = { role: 'admin', canManageAdmins: false, userId: 2 };
const CONTRIBUTOR: CuratedAwardsViewer = { role: 'contributor', canManageAdmins: false, userId: 3 };

/* ---------------------------------------------------------------------------------------------
 * STUB PREREQUISITES. Minimal stand-ins for the tables migration 111 and the service SQL read.
 * Each is a stub, not the real schema.
 * ------------------------------------------------------------------------------------------- */
const STUB_PREREQUISITES = `
  -- STUB roles: the real ones come from the repository's role setup, not from a migration.
  CREATE ROLE afldb_import NOLOGIN;
  CREATE ROLE afldb_auth NOLOGIN;
  CREATE ROLE afldb_app NOLOGIN;

  -- STUB auth_users (real: migration 023 and later).
  CREATE TABLE auth_users (id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY, email text NOT NULL);
  -- STUB seasons / awards / players / clubs / sources / external_identities (real: migrations 001-077).
  CREATE TABLE seasons (year smallint PRIMARY KEY);
  CREATE TABLE awards (
    id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY, slug text NOT NULL UNIQUE,
    name text NOT NULL, category text NOT NULL);
  CREATE TABLE players (id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY, display_name text NOT NULL);
  CREATE TABLE clubs (id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY, slug text NOT NULL UNIQUE, name text NOT NULL);
  CREATE TABLE sources (id smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, key text NOT NULL UNIQUE);
  -- No UNIQUE (source_id, external_id) in the stub, so the AMBIGUOUS-identity case can be staged.
  CREATE TABLE external_identities (
    id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    source_id smallint NOT NULL REFERENCES sources(id), external_id text NOT NULL,
    player_id integer REFERENCES players(id), match_method text, status text NOT NULL);
  -- STUB award_winners (real: migration 005 + 042 + 101). Only the columns the service reads / the stub port writes.
  CREATE TABLE award_winners (
    id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    award_id integer NOT NULL REFERENCES awards(id), season smallint NOT NULL,
    player_id integer REFERENCES players(id), player_name_raw text NOT NULL,
    club_id integer REFERENCES clubs(id), votes numeric(8,2), position text,
    is_captain boolean NOT NULL DEFAULT false, is_vice_captain boolean NOT NULL DEFAULT false,
    note text, status text NOT NULL DEFAULT 'active', source_record_id text);

  -- STUB reads/writes the real import-writable registry would give afldb_import on these tables.
  GRANT SELECT ON seasons, awards, players, clubs, sources, external_identities, award_winners TO afldb_import;
  GRANT INSERT ON award_winners TO afldb_import;
  GRANT USAGE ON SEQUENCE award_winners_id_seq TO afldb_import;

  -- STUB seed (SYNTHETIC; no real people, results or identities).
  INSERT INTO auth_users (email) VALUES ('super@example.invalid'), ('admin@example.invalid'), ('contributor@example.invalid');
  INSERT INTO seasons (year) VALUES (1990), (1991), (2024), (2025);
  INSERT INTO awards (slug, name, category) VALUES
    ('synthetic-medal', 'Synthetic Medal', 'award'),
    ('brownlow-medal', 'Brownlow Medal', 'award');
  INSERT INTO clubs (slug, name) VALUES ('synthetic-club', 'Synthetic Club');
  INSERT INTO sources (key) VALUES ('afltables'), ('manual_admin_edit');
  INSERT INTO players (display_name) VALUES ('Synthetic Player One'), ('Synthetic Player Two'), ('Synthetic Player Three');
  INSERT INTO external_identities (source_id, external_id, player_id, match_method, status) VALUES
    (1, 'players/s/synthetic_one.html', 1, 'afltables_profile_url', 'unique'),
    (1, 'players/s/synthetic_two.html', 2, 'afltables_profile_url', 'unique'),
    -- two players claim the same identity: the ambiguous case
    (1, 'players/s/synthetic_shared.html', 2, 'afltables_profile_url', 'unique'),
    (1, 'players/s/synthetic_shared.html', 3, 'afltables_profile_url', 'unique');
`;

const ID_ONE = 'afltables:players/s/synthetic_one.html';
const ID_TWO = 'afltables:players/s/synthetic_two.html';
const ID_SHARED = 'afltables:players/s/synthetic_shared.html';

function proposal(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    awardSlug: 'synthetic-medal',
    season: 1990,
    playerIdentity: ID_ONE,
    playerNameRaw: 'Synthetic Player One',
    clubSlug: 'synthetic-club',
    votes: '12.50',
    sourceKind: 'manual_entry',
    citation: 'SYNTHETIC citation for tests',
    acquiredOn: '2026-10-19',
    ...overrides,
  };
}

/** A STUB promotion port: writes a stub award_winners row. It is NOT insertAwardWinner. */
function stubPromotion(options: { throwAfterWrite?: boolean } = {}): AwardPromotionPort {
  return {
    async promote(tx, request) {
      const [row] = await tx.query<{ id: number }>(
        `INSERT INTO award_winners (award_id, season, player_id, player_name_raw, club_id, votes, position,
                                    is_captain, is_vice_captain, note, status, source_record_id)
         VALUES ($1::int, $2::smallint, $3::int, $4, $5::int, $6::numeric, $7, $8, $9, $10, 'active', $11)
         RETURNING id::int AS id`,
        [request.awardId, request.season, request.playerId, request.playerNameRaw, request.clubId,
          request.votes, request.position, request.isCaptain, request.isViceCaptain, request.note,
          `stub:${request.proposalKey}:${request.revision}`],
      );
      if (options.throwAfterWrite) throw new Error('STUB promotion failed after writing award_winners');
      return { entityKey: `manual_admin_edit:stub-award-winner-${row.id}` };
    },
  };
}

let db: InMemoryPglite;

async function one<T extends object>(text: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(text, params);
  return rows[0];
}
async function count(table: string): Promise<number> {
  return (await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).n;
}

beforeAll(async () => {
  db = await createInMemoryPglite();
  await db.exec(STUB_PREREQUISITES);
  // The migration under test, applied VERBATIM from disk (not edited to suit PGlite).
  await db.exec(readFileSync(MIGRATION, 'utf8'));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.query('RESET ROLE');
  await db.exec(`TRUNCATE award_proposal_decisions, award_proposals, award_winners RESTART IDENTITY CASCADE`);
});

/** Run `fn` as the stub afldb_import role, then restore. */
async function asImport<T>(fn: () => Promise<T>): Promise<T> {
  await db.query('SET ROLE afldb_import');
  try {
    return await fn();
  } finally {
    await db.query('RESET ROLE');
  }
}

async function expectRejected(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(promise).rejects.toThrow(pattern);
}

const INSERT_BASE = `INSERT INTO award_proposals
  (award_slug, season, player_name_raw, source_kind, source_url, citation, acquired_on, created_by`;

/* =============================================================================================
 * 1. Migration 111's constraints, on the real file
 * =========================================================================================== */
describe('migration 111 applied verbatim to PGlite: constraints', () => {
  it('created exactly the two tables and their indexes (including every foreign-key column)', async () => {
    const tables = await db.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'award_proposal%' ORDER BY 1`);
    expect(tables.rows.map((r) => r.relname)).toEqual(['award_proposal_decisions', 'award_proposals']);
    // Every FK column is the leading column of some index (the repository's tests/integration/fk-indexes rule).
    const unindexed = await db.query<{ conrelid: string; col: string }>(
      `SELECT c.conrelid::regclass::text AS conrelid, a.attname AS col
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.conrelid::regclass::text LIKE 'award_proposal%'
          AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])`);
    expect(unindexed.rows).toEqual([]);
  });

  it('refuses a proposal with neither a source URL nor a citation (required evidence)', async () => {
    await expectRejected(
      db.query(`${INSERT_BASE}) VALUES ('synthetic-medal', 1990, 'X', 'manual_entry', NULL, NULL, '2026-10-19', 1)`),
      /award_proposals_evidence_ck/,
    );
    // Either one suffices.
    await db.query(`${INSERT_BASE}) VALUES ('synthetic-medal', 1990, 'X', 'manual_entry', 'https://example.invalid/a', NULL, '2026-10-19', 1)`);
    await db.query(`${INSERT_BASE}) VALUES ('synthetic-medal', 1991, 'X', 'manual_entry', NULL, 'a citation', '2026-10-19', 1)`);
    expect(await count('award_proposals')).toBe(2);
  });

  it('refuses a bad status, source kind, season, URL and votes', async () => {
    await expectRejected(db.query(`${INSERT_BASE}, status) VALUES ('s', 1990, 'X', 'manual_entry', NULL, 'c', '2026-10-19', 1, 'bogus')`), /award_proposals_status_ck/);
    await expectRejected(db.query(`${INSERT_BASE}) VALUES ('s', 1990, 'X', 'telepathy', NULL, 'c', '2026-10-19', 1)`), /award_proposals_source_kind_ck/);
    await expectRejected(db.query(`${INSERT_BASE}) VALUES ('s', 1896, 'X', 'manual_entry', NULL, 'c', '2026-10-19', 1)`), /award_proposals_season_ck/);
    await expectRejected(db.query(`${INSERT_BASE}) VALUES ('s', 2101, 'X', 'manual_entry', NULL, 'c', '2026-10-19', 1)`), /award_proposals_season_ck/);
    await expectRejected(db.query(`${INSERT_BASE}) VALUES ('s', 1990, 'X', 'manual_entry', 'ftp://x.invalid/a', NULL, '2026-10-19', 1)`), /award_proposals_source_url_ck/);
    await expectRejected(db.query(`${INSERT_BASE}, votes) VALUES ('s', 1990, 'X', 'manual_entry', NULL, 'c', '2026-10-19', 1, -1)`), /award_proposals_votes_ck/);
    await expectRejected(db.query(`${INSERT_BASE}, player_identity) VALUES ('s', 1990, 'X', 'manual_entry', NULL, 'c', '2026-10-19', 1, 'players/x.html')`), /award_proposals_player_identity_ck/);
    expect(await count('award_proposals')).toBe(0);
  });

  it('Wikipedia-derived input must name a wikipedia.org https page', async () => {
    await expectRejected(
      db.query(`${INSERT_BASE}) VALUES ('s', 1990, 'X', 'wikipedia_offline_file', 'https://example.invalid/a', 'c', '2026-10-19', 1)`),
      /award_proposals_wikipedia_url_ck/);
    await expectRejected(
      db.query(`${INSERT_BASE}) VALUES ('s', 1990, 'X', 'wikipedia_offline_file', NULL, 'c', '2026-10-19', 1)`),
      /award_proposals_wikipedia_url_ck/);
    await db.query(`${INSERT_BASE}) VALUES ('s', 1990, 'X', 'wikipedia_offline_file', 'https://en.wikipedia.org/wiki/Synthetic', 'c', '2026-10-19', 1)`);
    expect(await count('award_proposals')).toBe(1);
  });

  it('enforces the revision chain and "at most one live revision per proposal"', async () => {
    await db.query(`${INSERT_BASE}) VALUES ('s', 1990, 'X', 'manual_entry', NULL, 'c', '2026-10-19', 1)`);
    const first = await one<{ id: number; key: string }>(`SELECT id::int AS id, proposal_key::text AS key FROM award_proposals`);
    // revision 1 may not name a predecessor; revision 2 must.
    await expectRejected(db.query(`${INSERT_BASE}, revision, revision_of_id) VALUES ('s', 1990, 'X', 'manual_entry', NULL, 'c', '2026-10-19', 1, 1, $1)`, [first.id]), /award_proposals_revision_chain_ck/);
    await expectRejected(db.query(`${INSERT_BASE}, proposal_key, revision) VALUES ('s', 1990, 'X', 'manual_entry', NULL, 'c', '2026-10-19', 1, $1::uuid, 2)`, [first.key]), /award_proposals_revision_chain_ck/);
    // A second LIVE row for the same proposal_key is refused...
    await expectRejected(
      db.query(`${INSERT_BASE}, proposal_key, revision, revision_of_id) VALUES ('s', 1990, 'X', 'manual_entry', NULL, 'c', '2026-10-19', 1, $1::uuid, 2, $2)`, [first.key, first.id]),
      /uq_award_proposals_live_revision/);
    // ...but is fine once the earlier revision is superseded (the order reviseProposal uses).
    await db.query(`UPDATE award_proposals SET status = 'superseded' WHERE id = $1`, [first.id]);
    await db.query(`${INSERT_BASE}, proposal_key, revision, revision_of_id) VALUES ('s', 1990, 'X', 'manual_entry', NULL, 'c', '2026-10-19', 1, $1::uuid, 2, $2)`, [first.key, first.id]);
    // The chain is linear: a revision has at most one successor, and (key, revision) is unique.
    await db.query(`UPDATE award_proposals SET status = 'superseded' WHERE revision = 2`);
    await expectRejected(
      db.query(`${INSERT_BASE}, proposal_key, revision, revision_of_id) VALUES ('s', 1990, 'X', 'manual_entry', NULL, 'c', '2026-10-19', 1, $1::uuid, 3, $2)`, [first.key, first.id]),
      /uq_award_proposals_revision_of/);
    await expectRejected(
      db.query(`${INSERT_BASE}, proposal_key, revision, revision_of_id) VALUES ('s', 1990, 'X', 'manual_entry', NULL, 'c', '2026-10-19', 1, $1::uuid, 2, $2)`, [first.key, first.id + 1]),
      /award_proposals_proposal_revision_uq/);
  });

  it('enforces the foreign keys and the approval invariant', async () => {
    await expectRejected(
      db.query(`${INSERT_BASE}) VALUES ('s', 1990, 'X', 'manual_entry', NULL, 'c', '2026-10-19', 999)`),
      /foreign key|violates/i);
    await db.query(`${INSERT_BASE}) VALUES ('s', 1990, 'X', 'manual_entry', NULL, 'c', '2026-10-19', 1)`);
    await expectRejected(
      db.query(`INSERT INTO award_proposal_decisions (proposal_id, action, from_status, to_status, admin_user_id)
                VALUES (999, 'create', NULL, 'proposed', 1)`),
      /foreign key|violates/i);
    await expectRejected(
      db.query(`INSERT INTO award_proposal_decisions (proposal_id, action, from_status, to_status, admin_user_id)
                VALUES (1, 'create', NULL, 'proposed', 999)`),
      /foreign key|violates/i);
    // approved <=> approved_entity_key (and approved_at)
    await expectRejected(db.query(`UPDATE award_proposals SET status = 'approved'`), /award_proposals_approval_ck/);
    await expectRejected(db.query(`UPDATE award_proposals SET approved_entity_key = 'k', approved_at = now()`), /award_proposals_approval_ck/);
    await db.query(`UPDATE award_proposals SET status = 'approved', approved_entity_key = 'k', approved_at = now()`);
  });

  it('a rejection always keeps its reason (ledger CHECK)', async () => {
    await db.query(`${INSERT_BASE}) VALUES ('s', 1990, 'X', 'manual_entry', NULL, 'c', '2026-10-19', 1)`);
    await expectRejected(
      db.query(`INSERT INTO award_proposal_decisions (proposal_id, action, from_status, to_status, admin_user_id)
                VALUES (1, 'reject', 'proposed', 'rejected', 1)`),
      /award_proposal_decisions_reject_note_ck|award_proposal_decisions_transition_ck/);
    await expectRejected(
      db.query(`INSERT INTO award_proposal_decisions (proposal_id, action, from_status, to_status, admin_user_id, note)
                VALUES (1, 'reject', 'proposed', 'rejected', 1, 'short')`),
      /award_proposal_decisions_reject_note_ck/);
  });

  it('the ledger CHECK admits exactly the transitions the TypeScript state machine allows', async () => {
    await db.query(`${INSERT_BASE}) VALUES ('s', 1990, 'X', 'manual_entry', NULL, 'c', '2026-10-19', 1)`);
    const froms = [null, ...PROPOSAL_STATUSES];
    const accepted: string[] = [];
    const expected: string[] = [];
    let attempted = 0;
    await db.transaction(async (tx) => {
      for (const action of PROPOSAL_ACTIONS) {
        for (const from of froms) {
          for (const to of PROPOSAL_STATUSES) {
            attempted += 1;
            if (isLegalTransition(action, from, to)) expected.push(`${action}:${from}:${to}`);
            await tx.query('SAVEPOINT attempt');
            try {
              await tx.query(
                `INSERT INTO award_proposal_decisions (proposal_id, action, from_status, to_status, admin_user_id, note)
                 VALUES (1, $1, $2, $3, 1, 'a reason that is long enough')`, [action, from, to]);
              accepted.push(`${action}:${from}:${to}`);
            } catch {
              // refused by a CHECK: the expected outcome for an illegal triple
            }
            await tx.query('ROLLBACK TO SAVEPOINT attempt');
          }
        }
      }
    });
    expect(attempted).toBe(PROPOSAL_ACTIONS.length * 7 * PROPOSAL_STATUSES.length);
    expect(accepted.sort()).toEqual(expected.sort());
    // And the machine itself is not vacuous.
    expect(expected.length).toBe(Object.values(CURATED_AWARD_TRANSITIONS).reduce((n, e) => n + e.length, 0));
    expect(expected.length).toBeGreaterThan(10);
  });
});

/* =============================================================================================
 * 2. Grants — executed against STUB roles (the real roles and afldb_meta are not available here)
 * =========================================================================================== */
describe('migration 111 grants, executed against stub roles', () => {
  it('has_*_privilege matches the intended least-privilege model', async () => {
    const priv = async (role: string, table: string, privilege: string) =>
      (await one<{ p: boolean }>(`SELECT has_table_privilege($1::name, $2::text, $3::text) AS p`, [role, table, privilege])).p;
    const col = async (role: string, column: string, privilege: string) =>
      (await one<{ p: boolean }>(`SELECT has_column_privilege($1::name, 'award_proposals', $2::text, $3::text) AS p`, [role, column, privilege])).p;

    // afldb_import: SELECT, INSERT; UPDATE only on the workflow columns; never DELETE/TRUNCATE.
    expect(await priv('afldb_import', 'award_proposals', 'SELECT')).toBe(true);
    expect(await priv('afldb_import', 'award_proposals', 'INSERT')).toBe(true);
    expect(await priv('afldb_import', 'award_proposals', 'UPDATE')).toBe(false);
    expect(await priv('afldb_import', 'award_proposals', 'DELETE')).toBe(false);
    expect(await priv('afldb_import', 'award_proposals', 'TRUNCATE')).toBe(false);
    const updatable = (await db.query<{ attname: string }>(
      `SELECT attname FROM pg_attribute WHERE attrelid = 'award_proposals'::regclass AND attnum > 0 AND NOT attisdropped
          AND has_column_privilege('afldb_import', 'award_proposals', attname, 'UPDATE') ORDER BY 1`)).rows.map((r) => r.attname);
    expect(updatable).toEqual(['approved_at', 'approved_entity_key', 'status', 'updated_at', 'validated_at', 'validation_result']);
    expect(await col('afldb_import', 'award_slug', 'UPDATE')).toBe(false);
    expect(await col('afldb_import', 'votes', 'UPDATE')).toBe(false);

    // The ledger: append-only for every role.
    expect(await priv('afldb_import', 'award_proposal_decisions', 'SELECT')).toBe(true);
    expect(await priv('afldb_import', 'award_proposal_decisions', 'INSERT')).toBe(true);
    for (const p of ['UPDATE', 'DELETE', 'TRUNCATE']) expect(await priv('afldb_import', 'award_proposal_decisions', p), p).toBe(false);

    // afldb_auth reads; afldb_app has nothing (proposals never reach the public site).
    for (const t of ['award_proposals', 'award_proposal_decisions']) {
      expect(await priv('afldb_auth', t, 'SELECT')).toBe(true);
      for (const p of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) expect(await priv('afldb_auth', t, p), `${t} ${p}`).toBe(false);
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) expect(await priv('afldb_app', t, p), `app ${t} ${p}`).toBe(false);
    }
    const seq = async (name: string) => (await one<{ p: boolean }>(`SELECT has_sequence_privilege('afldb_import'::name, $1::text, 'USAGE') AS p`, [name])).p;
    expect(await seq('award_proposals_id_seq')).toBe(true);
    expect(await seq('award_proposal_decisions_id_seq')).toBe(true);
  });

  it('as afldb_import: status may change, the proposed value may not, the ledger cannot be rewritten', async () => {
    await db.query(`${INSERT_BASE}) VALUES ('s', 1990, 'X', 'manual_entry', NULL, 'c', '2026-10-19', 1)`);
    await db.query(`INSERT INTO award_proposal_decisions (proposal_id, action, from_status, to_status, admin_user_id)
                    VALUES (1, 'create', NULL, 'proposed', 1)`);
    await asImport(async () => {
      await db.query(`UPDATE award_proposals SET status = 'rejected', updated_at = now() WHERE id = 1`);
      await expectRejected(db.query(`UPDATE award_proposals SET votes = 99 WHERE id = 1`), /permission denied/);
      await expectRejected(db.query(`UPDATE award_proposals SET award_slug = 'other' WHERE id = 1`), /permission denied/);
      await expectRejected(db.query(`DELETE FROM award_proposals WHERE id = 1`), /permission denied/);
      await expectRejected(db.query(`UPDATE award_proposal_decisions SET note = 'edited' WHERE id = 1`), /permission denied/);
      await expectRejected(db.query(`DELETE FROM award_proposal_decisions WHERE id = 1`), /permission denied/);
      await expectRejected(db.query(`TRUNCATE award_proposal_decisions`), /permission denied/);
    });
  });
});

/* =============================================================================================
 * 3. The services' real SQL, through the PGlite executor, as the stub afldb_import role
 * =========================================================================================== */
describe('services on PGlite: the full workflow with ledger rows', () => {
  it('create -> validate -> approve: one ledger row per transition, an approved key, a promoted winner', async () => {
    const exec = pgliteExecutor(db);
    await asImport(async () => {
      const created = await createProposal(SUPER, exec, proposal(), OPTIONS);
      expect(created).toMatchObject({ id: 1, revision: 1, revisionOfId: null, status: 'proposed', season: 1990,
        awardSlug: 'synthetic-medal', playerIdentity: ID_ONE, votes: '12.50', acquiredOn: '2026-10-19', createdBy: 1 });
      expect(created.createdAt).toMatch(/^2\d{3}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

      const validated = await validateProposal(SUPER, exec, { proposalId: created.id }, OPTIONS);
      expect(validated.status).toBe('validated');
      expect(validated.validationResult).toMatchObject({ ok: true, issues: [], checkedAt: '2026-10-19T12:00:00.000Z' });

      const approved = await approveProposal(SUPER, exec, { proposalId: created.id, decisionNote: 'checked against the club annual report' },
        { promotion: stubPromotion() }, OPTIONS);
      expect(approved.proposal.status).toBe('approved');
      expect(approved.proposal.approvedEntityKey).toMatch(/^manual_admin_edit:stub-award-winner-\d+$/);
      expect(approved.promotion.entityKey).toBe(approved.proposal.approvedEntityKey);
    });

    expect(await count('award_winners')).toBe(1);
    const winner = await one<{ player_id: number; club_id: number; votes: string; season: number }>(
      `SELECT player_id, club_id, votes::text AS votes, season::int AS season FROM award_winners`);
    expect(winner).toEqual({ player_id: 1, club_id: 1, votes: '12.50', season: 1990 });

    const ledger = (await db.query<{ action: string; from_status: string | null; to_status: string; admin_user_id: number }>(
      `SELECT action, from_status, to_status, admin_user_id FROM award_proposal_decisions ORDER BY id`)).rows;
    expect(ledger).toEqual([
      { action: 'create', from_status: null, to_status: 'proposed', admin_user_id: 1 },
      { action: 'validate', from_status: 'proposed', to_status: 'validated', admin_user_id: 1 },
      { action: 'approve', from_status: 'validated', to_status: 'approved', admin_user_id: 1 },
    ]);
    // jsonb is stored single-encoded (an object, never a JSON string inside jsonb).
    const types = (await db.query<{ a: string | null; b: string | null; c: string | null }>(
      `SELECT jsonb_typeof(previous_values) AS a, jsonb_typeof(new_values) AS b,
              (SELECT jsonb_typeof(validation_result) FROM award_proposals WHERE id = 1) AS c
         FROM award_proposal_decisions ORDER BY id`)).rows;
    expect(types.every((t) => (t.a === null || t.a === 'object') && t.b === 'object' && t.c === 'object')).toBe(true);
  });

  it('a failing validation moves to validation_failed with the issue codes, and cannot be approved', async () => {
    const exec = pgliteExecutor(db);
    await asImport(async () => {
      const created = await createProposal(SUPER, exec, proposal({
        awardSlug: 'no-such-award', playerIdentity: ID_SHARED, clubSlug: 'no-such-club', season: 2000 }), OPTIONS);
      const validated = await validateProposal(SUPER, exec, { proposalId: created.id }, OPTIONS);
      expect(validated.status).toBe('validation_failed');
      expect(validated.validationResult?.issues.map((i) => i.code).sort()).toEqual([
        'award_not_found', 'club_not_found', 'player_identity_ambiguous', 'season_not_in_register']);
      await expect(approveProposal(SUPER, exec, { proposalId: created.id }, { promotion: stubPromotion() }, OPTIONS))
        .rejects.toMatchObject({ code: 'illegal_transition' });
    });
    expect(await count('award_winners')).toBe(0);
  });

  it('an unresolved player identity is stored but never approvable', async () => {
    const exec = pgliteExecutor(db);
    await asImport(async () => {
      const created = await createProposal(SUPER, exec, proposal({ playerIdentity: null }), OPTIONS);
      expect(created.playerIdentity).toBeNull();
      const validated = await validateProposal(SUPER, exec, { proposalId: created.id }, OPTIONS);
      expect(validated.status).toBe('validation_failed');
      expect(validated.validationResult?.issues.map((i) => i.code)).toEqual(['player_unresolved']);
    });
  });

  it('refuses a duplicate of an active winner unless confirmed, and records a confirmed repeat as a warning', async () => {
    const exec = pgliteExecutor(db);
    await db.query(`INSERT INTO award_winners (award_id, season, player_id, player_name_raw, status)
                    VALUES (1, 1990, 1, 'Synthetic Player One', 'active')`);
    await asImport(async () => {
      const plain = await createProposal(SUPER, exec, proposal(), OPTIONS);
      const failed = await validateProposal(SUPER, exec, { proposalId: plain.id }, OPTIONS);
      expect(failed.status).toBe('validation_failed');
      expect(failed.validationResult?.issues).toMatchObject([{ code: 'duplicate_active_winner', severity: 'error' }]);

      const confirmed = await createProposal(SUPER, exec, proposal({ duplicateConfirmed: true, playerIdentity: ID_ONE, season: 1990 }), OPTIONS);
      const ok = await validateProposal(SUPER, exec, { proposalId: confirmed.id }, OPTIONS);
      expect(ok.status).toBe('validated');
      expect(ok.validationResult?.issues).toMatchObject([
        { code: 'duplicate_active_winner', severity: 'warning' },
        { code: 'duplicate_live_proposal', severity: 'warning' },
      ]);
    });
  });

  it('APPROVE ROLLBACK: a promotion that fails after writing leaves no status change, no ledger row, no winner', async () => {
    const exec = pgliteExecutor(db);
    let proposalId = 0;
    await asImport(async () => {
      const created = await createProposal(SUPER, exec, proposal(), OPTIONS);
      proposalId = created.id;
      await validateProposal(SUPER, exec, { proposalId }, OPTIONS);
    });
    const ledgerBefore = await count('award_proposal_decisions');
    expect(ledgerBefore).toBe(2);

    await asImport(async () => {
      await expect(approveProposal(SUPER, exec, { proposalId, decisionNote: 'note' },
        { promotion: stubPromotion({ throwAfterWrite: true }) }, OPTIONS))
        .rejects.toThrow('STUB promotion failed after writing award_winners');
    });

    // The stub port DID insert into award_winners before throwing; the transaction must have undone it.
    expect(await count('award_winners')).toBe(0);
    expect(await count('award_proposal_decisions')).toBe(ledgerBefore);
    const row = await one<{ status: string; approved_entity_key: string | null }>(
      `SELECT status, approved_entity_key FROM award_proposals WHERE id = $1`, [proposalId]);
    expect(row).toEqual({ status: 'validated', approved_entity_key: null });
  });

  it('refuses a stale approval (the world changed after validation) and writes nothing', async () => {
    const exec = pgliteExecutor(db);
    let proposalId = 0;
    await asImport(async () => {
      proposalId = (await createProposal(SUPER, exec, proposal(), OPTIONS)).id;
      await validateProposal(SUPER, exec, { proposalId }, OPTIONS);
    });
    // Someone records the same winner after validation passed.
    await db.query(`INSERT INTO award_winners (award_id, season, player_id, player_name_raw, status) VALUES (1, 1990, 1, 'Synthetic Player One', 'active')`);
    const ledgerBefore = await count('award_proposal_decisions');
    await asImport(async () => {
      const error = await approveProposal(SUPER, exec, { proposalId }, { promotion: stubPromotion() }, OPTIONS).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CuratedAwardError);
      expect(error).toMatchObject({ code: 'stale_validation' });
      expect((error as CuratedAwardError).issues.map((i) => i.code)).toEqual(['duplicate_active_winner']);
    });
    expect(await count('award_winners')).toBe(1);
    expect(await count('award_proposal_decisions')).toBe(ledgerBefore);
    expect((await one<{ status: string }>(`SELECT status FROM award_proposals WHERE id = $1`, [proposalId])).status).toBe('validated');
  });

  it('reject keeps an audit record with the reason; a rejected proposal is terminal', async () => {
    const exec = pgliteExecutor(db);
    await asImport(async () => {
      const created = await createProposal(SUPER, exec, proposal(), OPTIONS);
      await expect(rejectProposal(SUPER, exec, { proposalId: created.id })).rejects.toMatchObject({ code: 'note_required' });
      await expect(rejectProposal(SUPER, exec, { proposalId: created.id, decisionNote: 'too short' })).rejects.toMatchObject({ code: 'note_required' });
      const rejected = await rejectProposal(SUPER, exec, { proposalId: created.id, decisionNote: 'The citation does not support the claim.' });
      expect(rejected.status).toBe('rejected');
      for (const attempt of [
        () => validateProposal(SUPER, exec, { proposalId: created.id }, OPTIONS),
        () => approveProposal(SUPER, exec, { proposalId: created.id }, { promotion: stubPromotion() }, OPTIONS),
        () => rejectProposal(SUPER, exec, { proposalId: created.id, decisionNote: 'a second rejection reason' }),
        () => reviseProposal(SUPER, exec, { proposalId: created.id, changes: { season: 1991 } }, OPTIONS),
      ]) {
        await expect(attempt()).rejects.toMatchObject({ code: 'illegal_transition' });
      }
    });
    const ledger = (await db.query<{ action: string; note: string | null }>(`SELECT action, note FROM award_proposal_decisions ORDER BY id`)).rows;
    expect(ledger).toEqual([{ action: 'create', note: null }, { action: 'reject', note: 'The citation does not support the claim.' }]);
    expect(await count('award_proposals')).toBe(1);
  });

  it('revisions: n+1 linked to its predecessor, the earlier one superseded and kept, history readable', async () => {
    const exec = pgliteExecutor(db);
    await asImport(async () => {
      const first = await createProposal(SUPER, exec, proposal(), OPTIONS);
      await validateProposal(SUPER, exec, { proposalId: first.id }, OPTIONS);

      await expect(reviseProposal(SUPER, exec, { proposalId: first.id, changes: {} }, OPTIONS)).rejects.toMatchObject({ code: 'no_change' });
      await expect(reviseProposal(SUPER, exec, { proposalId: first.id, changes: { season: 1800 } }, OPTIONS)).rejects.toMatchObject({ code: 'invalid_input' });

      const { superseded, revision } = await reviseProposal(SUPER, exec,
        { proposalId: first.id, changes: { votes: '13', citation: 'SYNTHETIC corrected citation' }, decisionNote: 'Corrected votes.' }, OPTIONS);
      expect(superseded).toMatchObject({ id: first.id, status: 'superseded', revision: 1 });
      expect(revision).toMatchObject({ revision: 2, revisionOfId: first.id, status: 'proposed', proposalKey: first.proposalKey, votes: '13.00' });
      expect(revision.id).not.toBe(first.id);

      // The superseded revision's value is unchanged (never edited, only superseded).
      const original = await one<{ votes: string; citation: string }>(`SELECT votes::text AS votes, citation FROM award_proposals WHERE id = $1`, [first.id]);
      expect(original).toEqual({ votes: '12.50', citation: 'SYNTHETIC citation for tests' });

      // Revision 2 can be revised again (3), but not both predecessors at once.
      await validateProposal(SUPER, exec, { proposalId: revision.id }, OPTIONS);
      const third = await reviseProposal(SUPER, exec, { proposalId: revision.id, changes: { position: 'Synthetic position' } }, OPTIONS);
      expect(third.revision.revision).toBe(3);

      const history = await readProposalHistory(SUPER, exec, { proposalId: first.id });
      expect(history.revisions.map((r) => [r.revision, r.status])).toEqual([[1, 'superseded'], [2, 'superseded'], [3, 'proposed']]);
      expect(history.decisions.map((d) => `${d.proposalId}:${d.action}:${d.fromStatus}>${d.toStatus}`)).toEqual([
        '1:create:null>proposed',
        '1:validate:proposed>validated',
        '1:supersede:validated>superseded',
        '2:revise:null>proposed',
        '2:validate:proposed>validated',
        '2:supersede:validated>superseded',
        '3:revise:null>proposed',
      ]);
      expect(history.decisions.find((d) => d.action === 'revise')?.previousValues).toMatchObject({ votes: '12.50' });
      const live = await one<{ n: number }>(`SELECT count(*)::int AS n FROM award_proposals WHERE status IN ('proposed','validated','validation_failed','approved')`);
      expect(live.n).toBe(1);

      expect((await listProposals(SUPER, exec)).map((r) => r.id)).toEqual([3]);
      expect((await listProposals(SUPER, exec, { includeSuperseded: true })).map((r) => r.id)).toEqual([3, 2, 1]);
    });
  });

  it('an approved proposal cannot be revised here (typed refusal; the existing replace/correct path owns it)', async () => {
    const exec = pgliteExecutor(db);
    await asImport(async () => {
      const created = await createProposal(SUPER, exec, proposal(), OPTIONS);
      await validateProposal(SUPER, exec, { proposalId: created.id }, OPTIONS);
      await approveProposal(SUPER, exec, { proposalId: created.id }, { promotion: stubPromotion() }, OPTIONS);
      await expect(reviseProposal(SUPER, exec, { proposalId: created.id, changes: { votes: '14' } }, OPTIONS))
        .rejects.toMatchObject({ code: 'approved_revision_unsupported' });
    });
    expect(await count('award_proposals')).toBe(1);
    expect(await count('award_proposal_decisions')).toBe(3);
  });

  it('roles: contributor and admin cannot mutate; admin can read; contributor cannot read', async () => {
    const exec = pgliteExecutor(db);
    await asImport(async () => {
      const created = await createProposal(SUPER, exec, proposal(), OPTIONS);
      for (const viewer of [ADMIN, CONTRIBUTOR]) {
        await expect(createProposal(viewer, exec, proposal(), OPTIONS)).rejects.toMatchObject({ code: 'forbidden' });
        await expect(validateProposal(viewer, exec, { proposalId: created.id }, OPTIONS)).rejects.toMatchObject({ code: 'forbidden' });
        await expect(rejectProposal(viewer, exec, { proposalId: created.id, decisionNote: 'a long enough reason' })).rejects.toMatchObject({ code: 'forbidden' });
        await expect(reviseProposal(viewer, exec, { proposalId: created.id, changes: { season: 1991 } }, OPTIONS)).rejects.toMatchObject({ code: 'forbidden' });
        await expect(approveProposal(viewer, exec, { proposalId: created.id }, { promotion: stubPromotion() }, OPTIONS)).rejects.toMatchObject({ code: 'forbidden' });
      }
      expect((await listProposals(ADMIN, exec)).map((r) => r.id)).toEqual([1]);
      expect((await readProposalHistory(ADMIN, exec, { proposalId: 1 })).decisions).toHaveLength(1);
      await expect(listProposals(CONTRIBUTOR, exec)).rejects.toMatchObject({ code: 'forbidden' });
    });
    expect(await count('award_proposals')).toBe(1);
    expect(await count('award_proposal_decisions')).toBe(1);
  });

  it('a locally supplied Wikipedia file only ever creates proposals (all-or-nothing), never an approval', async () => {
    const exec = pgliteExecutor(db);
    const file = JSON.stringify({
      format: 'afldb-award-proposals', version: 1,
      defaults: { source_kind: 'wikipedia_offline_file', source_url: 'https://en.wikipedia.org/wiki/Synthetic_Medal', acquired_on: '2026-10-18' },
      proposals: [
        { award_slug: 'synthetic-medal', season: 1990, player_identity: ID_ONE, player_name: 'Synthetic Player One', votes: 12 },
        { award_slug: 'synthetic-medal', season: 1991, player_identity: ID_TWO, player_name: 'Synthetic Player Two' },
      ],
    });
    await asImport(async () => {
      const created = await createProposalsFromFile(SUPER, exec, { text: file, format: 'json' }, OPTIONS);
      expect(created.map((c) => [c.id, c.status, c.sourceKind])).toEqual([[1, 'proposed', 'wikipedia_offline_file'], [2, 'proposed', 'wikipedia_offline_file']]);
      expect(created[0].votes).toBe('12.00');

      // Wikipedia input is never self-certifying: approving it needs a verification note.
      await validateProposal(SUPER, exec, { proposalId: 1 }, OPTIONS);
      await expect(approveProposal(SUPER, exec, { proposalId: 1 }, { promotion: stubPromotion() }, OPTIONS)).rejects.toMatchObject({ code: 'note_required' });
      await expect(approveProposal(SUPER, exec, { proposalId: 1, decisionNote: 'looks right' }, { promotion: stubPromotion() }, OPTIONS)).rejects.toMatchObject({ code: 'note_required' });

      // Whole-file refusal: one bad row, nothing written.
      const before = await count('award_proposals');
      const bad = JSON.stringify({
        format: 'afldb-award-proposals', version: 1,
        defaults: { source_kind: 'wikipedia_offline_file', source_url: 'https://en.wikipedia.org/wiki/Synthetic_Medal', acquired_on: '2026-10-18' },
        proposals: [
          { award_slug: 'synthetic-medal', season: 1991, player_identity: ID_ONE, player_name: 'Valid Row' },
          { award_slug: 'synthetic-medal', season: 1700, player_identity: ID_ONE, player_name: 'Bad Season' },
        ],
      });
      await expect(createProposalsFromFile(SUPER, exec, { text: bad, format: 'json' }, OPTIONS)).rejects.toMatchObject({ code: 'invalid_file' });
      expect(await count('award_proposals')).toBe(before);
    });
    expect(await count('award_winners')).toBe(0);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM award_proposals WHERE status = 'approved'`)).n).toBe(0);
    expect(await count('award_proposal_decisions')).toBe(3);
  });

  it('a Brownlow proposal is refused at creation (authoritative source elsewhere)', async () => {
    const exec = pgliteExecutor(db);
    await asImport(async () => {
      await expect(createProposal(SUPER, exec, proposal({ awardSlug: 'brownlow-medal' }), OPTIONS)).rejects.toMatchObject({ code: 'invalid_input' });
    });
    expect(await count('award_proposals')).toBe(0);
  });
});
