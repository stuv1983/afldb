import './guard';

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  confirmUnlinked,
  listConfirmedUnlinked,
  resolveLink,
} from '@/db/queries/player-links';
import { createPlayer } from '@/db/queries/players';

import { lockDraftTables, unlockDraftTables } from './draft-lock';

/**
 * A full draft reload must not discard a human identity decision, and must
 * not touch a row it does not own (AFLDB-ISSUE-078).
 *
 * A sibling of tests/integration/awards-reload-links.test.ts rather than an
 * addition to it: that file documents itself as owning the *honours* ETL
 * boundary and every fixture in it is honours-shaped. The draft harness needs
 * a different importer, a person-grained decision model, and an
 * admin-created-row fixture that has no honours equivalent.
 * tests/player-link-mutations.test.ts is mock-based and never connects, and
 * tests/integration/release-gates.test.ts asserts steady-state draft
 * invariants, not reload survival.
 *
 * Two things make draft different from the honours family:
 *
 *   1. Identity is person-grained. `applyLockedLink` writes `draft_persons`
 *      and EVERY pick of that person, while the audit row names one pick, so
 *      a decision has to be normalised through `draft_person_id` before a
 *      reload can honour it.
 *   2. The source has no stable row identifier at all. Both the SQLite rowid
 *      behind `source_record_id` and `dg_person_id` are regenerated on every
 *      upstream load, so the reload key is `(source_id, player_url,
 *      draft_year, draft_kind)` — DraftGuru's own person page plus the board
 *      the selection sits on.
 *
 * Every write here lands in afldb_test: tests/setup.ts redirects
 * DATABASE_URL, and the two role URLs the product code opens for itself are
 * redirected below.
 */
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;
process.env.AFLDB_AUTH_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;

const root = process.cwd();
const FIXTURE_EMAIL = 'issue-078-draft-reload@example.test';
const NOTE = 'AFLDB-ISSUE-078 draft reload survival';
const ADMIN_PLAYER_NAME = 'Issue078 Draftfixture';

// The dev host keeps psycopg in the repo virtualenv; a bare python3 there
// cannot import it.
const venvPython = join(root, '.venv', 'bin', 'python');
const python = process.env.AFLDB_PYTHON
  ?? (existsSync(venvPython)
    ? venvPython
    : (process.platform === 'win32' ? 'python' : 'python3'));

const legacySqlite = process.env.AFLDB_LEGACY_SQLITE;

function hasPsycopg(): boolean {
  const probe = spawnSync(python, ['-c', 'import psycopg'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

const canRunImporter = Boolean(legacySqlite)
  && existsSync(legacySqlite as string)
  && hasPsycopg();

function runImporter(extra: string[] = []) {
  return spawnSync(
    python,
    ['tools/migration/import_draft.py', '--quiet', ...extra],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        AFLDB_IMPORT_DATABASE_URL: process.env.AFLDB_TEST_DATABASE_URL,
      },
    },
  );
}

type PickRow = {
  id: number;
  personId: number | null;
  name: string;
  playerId: number | null;
  status: string;
  playerUrl: string | null;
  draftYear: number;
  draftKind: string | null;
  sourceId: number | null;
};

type PersonRow = {
  id: number;
  playerUrl: string;
  playerId: number | null;
  status: string;
  backlog: boolean;
};

/**
 * The id set of a table, as one value. Identical fingerprints before and
 * after a reload is the whole point: a surrogate id is durable application
 * identity the moment `player_link_resolutions` names it.
 */
async function fingerprint(table: 'draft_picks' | 'draft_persons'): Promise<string> {
  const [row] = await sql<{ f: string }[]>`
    SELECT md5(string_agg(id::text, ',' ORDER BY id)) AS f FROM ${sql(table)}
  `;
  return row.f;
}

async function countRows(table: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM ${sql(table)}
  `;
  return row.n;
}

async function readPick(id: number): Promise<PickRow | undefined> {
  const [row] = await sql<PickRow[]>`
    SELECT id, draft_person_id AS "personId", player_name_raw AS name,
           player_id AS "playerId", link_status_value::text AS status,
           player_url AS "playerUrl", draft_year AS "draftYear",
           draft_kind AS "draftKind", source_id AS "sourceId"
      FROM draft_picks
     WHERE id = ${id}
  `;
  return row;
}

async function readPerson(id: number): Promise<PersonRow | undefined> {
  const [row] = await sql<PersonRow[]>`
    SELECT id, player_url AS "playerUrl", player_id AS "playerId",
           link_status::text AS status, is_matching_backlog AS backlog
      FROM draft_persons
     WHERE id = ${id}
  `;
  return row;
}

async function picksOfPerson(personId: number): Promise<PickRow[]> {
  return sql<PickRow[]>`
    SELECT id, draft_person_id AS "personId", player_name_raw AS name,
           player_id AS "playerId", link_status_value::text AS status,
           player_url AS "playerUrl", draft_year AS "draftYear",
           draft_kind AS "draftKind", source_id AS "sourceId"
      FROM draft_picks
     WHERE draft_person_id = ${personId}
     ORDER BY id
  `;
}

/**
 * A wholly unresolved draft person with at least `minPicks` picks, skipping
 * any this file has already used. Resolving one pick of such a person is the
 * case where a single lost decision unlinks several rows.
 */
async function takeUnresolvedPerson(
  minPicks: number,
  used: Set<number>,
): Promise<{ person: PersonRow; picks: PickRow[] }> {
  const candidates = await sql<{ personId: number }[]>`
    SELECT p.id AS "personId"
      FROM draft_persons p
      JOIN draft_picks k ON k.draft_person_id = p.id
     WHERE p.player_id IS NULL
       AND p.link_status::text IN ('ambiguous', 'unmatched', 'implausible')
     GROUP BY p.id
    HAVING count(*) >= ${minPicks}
       AND bool_and(k.link_status_value::text
                    IN ('ambiguous', 'unmatched', 'implausible'))
     ORDER BY p.id
     LIMIT 60
  `;
  const chosen = candidates.find((candidate) => !used.has(candidate.personId));
  if (!chosen) {
    throw new Error(`no spare unresolved draft person with ${minPicks}+ picks in afldb_test`);
  }
  used.add(chosen.personId);
  const person = await readPerson(chosen.personId);
  if (!person) throw new Error('draft person vanished between queries');
  return { person, picks: await picksOfPerson(chosen.personId) };
}

/** Re-find a person by the durable source identity, whatever its id became. */
async function findPersonByUrl(playerUrl: string): Promise<PersonRow | undefined> {
  const [row] = await sql<PersonRow[]>`
    SELECT id, player_url AS "playerUrl", player_id AS "playerId",
           link_status::text AS status, is_matching_backlog AS backlog
      FROM draft_persons
     WHERE player_url = ${playerUrl}
  `;
  return row;
}

/** Resolutions whose target no longer exists — the AFLDB-ISSUE-079 shape. */
async function danglingResolutions(adminUserId: number): Promise<number[]> {
  const rows = await sql<{ targetId: number }[]>`
    SELECT r.target_id AS "targetId"
      FROM player_link_resolutions r
     WHERE r.admin_user_id = ${adminUserId}
       AND r.target_table = 'draft_picks'
       AND NOT EXISTS (SELECT 1 FROM draft_picks k WHERE k.id = r.target_id)
     ORDER BY r.target_id
  `;
  return rows.map((row) => row.targetId);
}

describe.skipIf(!canRunImporter)(
  'draft reloads preserve manual player links (AFLDB-ISSUE-078)',
  () => {
    let adminUserId = 0;
    let playerA = 0;
    let playerB = 0;
    const used = new Set<number>();

    beforeAll(async () => {
      // Held for the whole file: every test here links real draft people to
      // fixture players, which is exactly what release-gates.test.ts counts.
      await lockDraftTables();

      // A dedicated fixture admin. Picking the first real admin by id is the
      // trap AFLDB-ISSUE-074 records against the email-intake suite.
      const [admin] = await sql<{ id: number }[]>`
        INSERT INTO auth_users (email, role)
        VALUES (${FIXTURE_EMAIL}, 'admin')
        ON CONFLICT (email) DO UPDATE SET role = 'admin'
        RETURNING id
      `;
      adminUserId = admin.id;

      const players = await sql<{ id: number }[]>`
        SELECT id FROM players ORDER BY id LIMIT 2
      `;
      expect(players.length).toBe(2);
      playerA = players[0].id;
      playerB = players[1].id;
    });

    afterAll(async () => {
      // The runner connects as the table owner, so the append-only grants
      // that protect this table in production do not apply here.
      await sql`
        DELETE FROM player_link_resolutions WHERE admin_user_id = ${adminUserId}
      `;
      const fixtures = await sql<{ id: number }[]>`
        SELECT id FROM players WHERE display_name = ${ADMIN_PLAYER_NAME}
      `;
      for (const player of fixtures) {
        await sql`DELETE FROM draft_picks WHERE player_id = ${player.id}`;
        await sql`DELETE FROM player_career_stats WHERE player_id = ${player.id}`;
        await sql`DELETE FROM data_edits WHERE table_name = 'players' AND row_id = ${player.id}`;
        await sql`DELETE FROM players WHERE id = ${player.id}`;
      }
      await sql`DELETE FROM data_edits WHERE admin_user_id = ${adminUserId}`;
      await sql`DELETE FROM auth_users WHERE id = ${adminUserId}`;

      // Deleting an audit row does not undo the link it already applied, so
      // the draft rows this suite decided still carry a fixture player. One
      // more reload — with no decision left to replay — puts every
      // source-owned row back to pure source state, which
      // tests/integration/release-gates.test.ts then counts.
      const reset = runImporter();
      expect(reset.status, reset.stdout + reset.stderr).toBe(0);

      // Only now may another file read the draft counts.
      await unlockDraftTables();
      await sql.end();
    }, 120_000);

    it('keeps a resolved link on every pick of the person, and every row id', async () => {
      const { person, picks } = await takeUnresolvedPerson(2, used);
      const decidedPick = picks[0];

      const linked = await resolveLink({
        targetTable: 'draft_picks',
        targetId: decidedPick.id,
        playerId: playerA,
        adminUserId,
        note: NOTE,
      });
      expect(linked).toEqual({ ok: true });

      const picksBefore = await fingerprint('draft_picks');
      const personsBefore = await fingerprint('draft_persons');
      const pickCount = await countRows('draft_picks');
      const personCount = await countRows('draft_persons');

      const run = runImporter();
      expect(run.status, run.stdout + run.stderr).toBe(0);

      // The reload must reconcile in place, not rebuild.
      expect(await fingerprint('draft_picks')).toBe(picksBefore);
      expect(await fingerprint('draft_persons')).toBe(personsBefore);
      expect(await countRows('draft_picks')).toBe(pickCount);
      expect(await countRows('draft_persons')).toBe(personCount);

      const afterPerson = await readPerson(person.id);
      expect(afterPerson, 'the decided person must still exist under its own id').toBeDefined();
      expect(afterPerson!.playerUrl).toBe(person.playerUrl);
      expect(afterPerson!.playerId).toBe(playerA);
      expect(afterPerson!.status).toBe('resolved');
      expect(afterPerson!.backlog).toBe(false);

      // Identity is person-grained: every pick of the person carries it.
      const afterPicks = await picksOfPerson(person.id);
      expect(afterPicks.map((p) => p.id)).toEqual(picks.map((p) => p.id));
      for (const pick of afterPicks) {
        expect(pick.playerId).toBe(playerA);
        expect(pick.status).toBe('resolved');
      }

      // And the audit row still names a live row.
      expect(await danglingResolutions(adminUserId)).toEqual([]);
    });

    it('keeps a confirmed-unlinked decision, person-grained, with its target alive', async () => {
      const { person, picks } = await takeUnresolvedPerson(2, used);
      const decidedPick = picks[0];

      const confirmed = await confirmUnlinked({
        targetTable: 'draft_picks',
        targetId: decidedPick.id,
        adminUserId,
        note: NOTE,
      });
      expect(confirmed).toEqual({ ok: true });

      const run = runImporter();
      expect(run.status, run.stdout + run.stderr).toBe(0);

      const afterPerson = await readPerson(person.id);
      expect(afterPerson).toBeDefined();
      // Vetted as genuinely not an AFLDB player: it must stay that way, and
      // no sibling pick may take a source link the admin has rejected.
      expect(afterPerson!.playerId).toBeNull();
      for (const pick of await picksOfPerson(person.id)) {
        expect(pick.playerId).toBeNull();
      }

      // The decision is only useful while it still names a live row: this is
      // exactly what the truncate-and-reload left dangling.
      const vetted = await listConfirmedUnlinked();
      expect(vetted.has(`draft_picks:${decidedPick.id}`)).toBe(true);
      expect(await danglingResolutions(adminUserId)).toEqual([]);
    });

    it("keeps the admin's link when the source names someone else, and says so", async () => {
      // A person the source links confidently, returned to the queue so the
      // real resolveLink path can decide it differently.
      const [candidate] = await sql<PersonRow[]>`
        SELECT id, player_url AS "playerUrl", player_id AS "playerId",
               link_status::text AS status, is_matching_backlog AS backlog
          FROM draft_persons
         WHERE player_id IS NOT NULL AND link_status::text = 'unique'
         ORDER BY id
         LIMIT 1
      `;
      expect(candidate, 'afldb_test needs a source-linked draft person').toBeDefined();
      used.add(candidate.id);
      const sourcePlayerId = candidate.playerId;
      const admins = sourcePlayerId === playerA ? playerB : playerA;

      await sql`
        UPDATE draft_persons
           SET player_id = NULL, link_status = 'ambiguous'
         WHERE id = ${candidate.id}
      `;
      await sql`
        UPDATE draft_picks
           SET player_id = NULL, link_status_value = 'ambiguous'
         WHERE draft_person_id = ${candidate.id}
      `;
      const [pick] = await picksOfPerson(candidate.id);

      const linked = await resolveLink({
        targetTable: 'draft_picks',
        targetId: pick.id,
        playerId: admins,
        adminUserId,
        note: NOTE,
      });
      expect(linked).toEqual({ ok: true });

      const run = runImporter();
      expect(run.status, run.stdout + run.stderr).toBe(0);

      const afterPerson = await readPerson(candidate.id);
      expect(afterPerson!.playerId, "the admin's decision is authoritative").toBe(admins);
      expect(afterPerson!.status).toBe('resolved');
      // A disagreement is never silent: the source still claims someone else.
      expect(run.stdout).toContain(`the source now links player ${sourcePlayerId}`);
      expect(run.stdout).toContain(candidate.playerUrl);
    });

    it('aborts rather than lose a decision when the source name changes under the key', async () => {
      const { person, picks } = await takeUnresolvedPerson(1, used);
      const decidedPick = picks[0];

      const linked = await resolveLink({
        targetTable: 'draft_picks',
        targetId: decidedPick.id,
        playerId: playerA,
        adminUserId,
        note: NOTE,
      });
      expect(linked).toEqual({ ok: true });

      // The name guard is what makes the key safe: if the row under the key
      // is no longer the same person, the reload must stop rather than move
      // the decision onto whoever is there now.
      await sql`
        UPDATE draft_picks
           SET player_name_raw = ${`${decidedPick.name} (renamed)`}
         WHERE id = ${decidedPick.id}
      `;
      const picksBefore = await fingerprint('draft_picks');
      const pickCount = await countRows('draft_picks');

      const run = runImporter();
      expect(run.status, 'the reload must fail closed').toBe(1);
      expect(run.stdout).toContain('cannot survive');
      expect(run.stdout).toContain(String(decidedPick.id));

      // Nothing written: the decision is neither discarded nor reattributed.
      const after = await readPick(decidedPick.id);
      expect(after!.name).toBe(`${decidedPick.name} (renamed)`);
      expect(after!.playerId).toBe(playerA);
      expect(await fingerprint('draft_picks')).toBe(picksBefore);
      expect(await countRows('draft_picks')).toBe(pickCount);

      // --allow-link-loss is the deliberate escape hatch, and it itemises
      // what it discards rather than proceeding quietly.
      const forced = runImporter(['--allow-link-loss']);
      expect(forced.status, forced.stdout + forced.stderr).toBe(0);
      expect(forced.stdout).toContain('DISCARDING');
      expect(forced.stdout).toContain(`player ${playerA}`);

      // The source name is authoritative again once the decision is gone.
      const healed = await findPersonByUrl(person.playerUrl);
      expect(healed).toBeDefined();
    });

    it('aborts before mutation when one person carries contradictory decisions', async () => {
      const { person, picks } = await takeUnresolvedPerson(2, used);

      // Reachable today: confirmUnlinked takes no lock and does not re-read
      // the target, so a stale form can vet one pick of a person another
      // pick has just linked.
      const linked = await resolveLink({
        targetTable: 'draft_picks',
        targetId: picks[0].id,
        playerId: playerA,
        adminUserId,
        note: NOTE,
      });
      expect(linked).toEqual({ ok: true });
      const confirmed = await confirmUnlinked({
        targetTable: 'draft_picks',
        targetId: picks[1].id,
        adminUserId,
        note: NOTE,
      });
      expect(confirmed).toEqual({ ok: true });

      const picksBefore = await fingerprint('draft_picks');
      const run = runImporter();
      expect(run.status, 'contradictory decisions must stop the reload').toBe(1);
      expect(run.stdout).toContain('contradict');
      expect(run.stdout).toContain(person.playerUrl);
      expect(await fingerprint('draft_picks')).toBe(picksBefore);

      // Undo the contradiction so the remaining tests see a clean queue: the
      // latest decision per pick is what counts, so re-vetting the linked
      // pick is not enough — the audit rows are removed instead.
      await sql`
        DELETE FROM player_link_resolutions
         WHERE admin_user_id = ${adminUserId}
           AND target_id IN (${picks[0].id}, ${picks[1].id})
      `;
      await sql`
        UPDATE draft_picks SET player_id = NULL, link_status_value = ${picks[0].status}::link_status
         WHERE draft_person_id = ${person.id}
      `;
      await sql`
        UPDATE draft_persons SET player_id = NULL, link_status = ${person.status}::link_status
         WHERE id = ${person.id}
      `;
    });

    it('leaves an admin-created draft pick untouched, with no decision of its own', async () => {
      // The ownership half of this issue. An admin-created pick has
      // source_id NULL and no draft_person_id, so lockUnresolvedTarget
      // refuses to resolve it and it can NEVER carry a decision — only
      // source scoping can protect it from the reload.
      const player = await createPlayer(
        {
          displayName: ADMIN_PLAYER_NAME,
          debutSeason: 2001,
          draftInfo: { draftYear: 2000, draftType: 'National Draft', pickNumber: 999 },
        },
        { adminUserId, note: NOTE },
      );

      const [before] = await sql<PickRow[]>`
        SELECT id, draft_person_id AS "personId", player_name_raw AS name,
               player_id AS "playerId", link_status_value::text AS status,
               player_url AS "playerUrl", draft_year AS "draftYear",
               draft_kind AS "draftKind", source_id AS "sourceId"
          FROM draft_picks
         WHERE player_id = ${player.id}
      `;
      expect(before, 'the admin pick must exist before the reload').toBeDefined();
      expect(before.sourceId, 'admin rows carry no source').toBeNull();
      expect(before.personId).toBeNull();

      const run = runImporter();
      expect(run.status, run.stdout + run.stderr).toBe(0);

      const after = await readPick(before.id);
      expect(after, 'a row the importer does not own must survive it').toBeDefined();
      expect(after!.name).toBe(before.name);
      expect(after!.playerId).toBe(player.id);
      expect(after!.status).toBe(before.status);
      expect(after!.sourceId).toBeNull();
    });

    // Two full reloads back to back, so this one needs more than the
    // suite-wide 30 s.
    it('is idempotent: two further reloads change no row id', async () => {
      const first = runImporter();
      expect(first.status, first.stdout + first.stderr).toBe(0);
      const picksFingerprint = await fingerprint('draft_picks');
      const personsFingerprint = await fingerprint('draft_persons');
      const pickCount = await countRows('draft_picks');
      const personCount = await countRows('draft_persons');

      const second = runImporter();
      expect(second.status, second.stdout + second.stderr).toBe(0);
      expect(await fingerprint('draft_picks')).toBe(picksFingerprint);
      expect(await fingerprint('draft_persons')).toBe(personsFingerprint);
      expect(await countRows('draft_picks')).toBe(pickCount);
      expect(await countRows('draft_persons')).toBe(personCount);

      // The importer files its own data_issues; re-running must not stack
      // duplicates, the invariant release-gates.test.ts also guards.
      const [issues] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM (SELECT entity_id, issue_type FROM data_issues
                 WHERE entity_type = 'draft_person' AND resolved_at IS NULL
                 GROUP BY 1, 2 HAVING count(*) > 1) d
      `;
      expect(issues.n).toBe(0);
    }, 120_000);
  },
);
