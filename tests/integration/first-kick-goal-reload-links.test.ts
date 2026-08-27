import './guard';

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  confirmUnlinked,
  listConfirmedUnlinked,
  resolveLink,
} from '@/db/queries/player-links';

/**
 * A first-kick-goal reload must not discard a human identity decision, must
 * not touch a `player_achievements` row it does not own, and must keep a
 * row's surrogate id across ANY descriptive correction — including a
 * renamed player (AFLDB-ISSUE-078, first-kick-goal half).
 *
 * Its own file rather than an addition to awards-reload-links.test.ts or
 * draftguru-import.test.ts: both of those drive a PYTHON importer through
 * the repo virtualenv and are scoped in their own docstrings to the honours
 * and draft ETL boundaries. This one drives a TypeScript importer through
 * tsx, against a different table, with fixtures — candidate extracts, a
 * tracked identity manifest, a foreign-source achievement row — that have no
 * equivalent there.
 *
 * The identity model under test:
 *
 *   raw extract (gitignored)         = replaceable source material
 *   first-kick-goal-ids.csv (tracked) = durable AFLDB source identity
 *
 * The extract carries no identifier and its clean names are not durable
 * (mojibake, spelling corrections, marker changes), so identity is ASSIGNED
 * in the manifest as `fkg-NNN` and stored as `source_record_id`. The suite
 * works on TEMP COPIES of both files via the importer's env overrides — the
 * real curated extract and the real tracked manifest are never modified.
 *
 * Every write lands in afldb_test: tests/setup.ts redirects DATABASE_URL,
 * and the two role URLs the product code opens for itself are redirected
 * below.
 */
process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;
process.env.AFLDB_AUTH_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;

const root = process.cwd();
const FIXTURE_EMAIL = 'issue-078-fkg-reload@example.test';
const NOTE = 'AFLDB-ISSUE-078 first-kick-goal reload survival';
const REAL_CSV = join(root, 'data', 'records', 'first-kick-goal.csv');

const tsx = join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
);
const canRunImporter = existsSync(REAL_CSV) && existsSync(tsx);

// Temp copies the whole suite works on; created in beforeAll.
let workDir = '';
let extractPath = '';
let manifestPath = '';
let pristineManifest = '';

function runTool(args: string[]) {
  return spawnSync(
    tsx,
    ['--conditions=react-server', 'tools/records/import-first-kick-goal.ts', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        AFLDB_IMPORT_DATABASE_URL: process.env.AFLDB_TEST_DATABASE_URL,
        AFLDB_FIRST_KICK_GOAL_CSV: extractPath,
        AFLDB_FIRST_KICK_GOAL_MANIFEST: manifestPath,
      },
    },
  );
}

const runImporter = (extra: string[] = []) => runTool(['--apply', ...extra]);

function output(run: { stdout: unknown; stderr: unknown; error?: Error; signal?: string | null }): string {
  let out = String(run.stdout ?? '') + String(run.stderr ?? '');
  if (run.error) out += `\nError: ${run.error.message}`;
  if (run.signal) out += `\nSignal: ${run.signal}`;
  return out;
}

function editFile(path: string, from: string, to: string): void {
  const text = readFileSync(path, 'utf8');
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`expected exactly one occurrence of ${JSON.stringify(from)} in ${path}, found ${count}`);
  writeFileSync(path, text.replace(from, to), 'utf8');
}

function appendLine(path: string, line: string): void {
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\n*$/, '\n') + line + '\n', 'utf8');
}

function removeLineContaining(path: string, needle: string): void {
  const lines = readFileSync(path, 'utf8').split('\n');
  const kept = lines.filter((l) => !l.includes(needle));
  if (kept.length !== lines.length - 1) throw new Error(`expected exactly one line containing ${JSON.stringify(needle)} in ${path}`);
  writeFileSync(path, kept.join('\n'), 'utf8');
}

type AchievementRow = {
  id: number;
  nameClean: string;
  playerId: number | null;
  status: string;
  sourceId: number | null;
  sourceRecordId: string | null;
  season: number;
  roundRaw: string;
  clubRaw: string;
};

const COLUMNS = sql`
  id, player_name_clean AS "nameClean", player_id AS "playerId",
  link_status_value::text AS status, source_id AS "sourceId",
  source_record_id AS "sourceRecordId", season, round_raw AS "roundRaw",
  club_name_raw AS "clubRaw"
`;

/** The id set of the owned scope, as one value. */
async function fingerprint(): Promise<string> {
  const [row] = await sql<{ f: string }[]>`
    SELECT md5(string_agg(a.id::text, ',' ORDER BY a.id)) AS f
      FROM player_achievements a JOIN sources s ON s.id = a.source_id
     WHERE a.achievement_type = 'first_kick_goal' AND s.key = 'wikipedia_first_kick_goal'
  `;
  return row.f;
}

async function readById(id: number): Promise<AchievementRow | undefined> {
  const [row] = await sql<AchievementRow[]>`
    SELECT ${COLUMNS} FROM player_achievements WHERE id = ${id}
  `;
  return row;
}

async function readByStableId(stableId: string): Promise<AchievementRow | undefined> {
  const [row] = await sql<AchievementRow[]>`
    SELECT ${COLUMNS} FROM player_achievements
     WHERE achievement_type = 'first_kick_goal' AND source_record_id = ${stableId}
  `;
  return row;
}

async function countOwned(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
      FROM player_achievements a JOIN sources s ON s.id = a.source_id
     WHERE a.achievement_type = 'first_kick_goal' AND s.key = 'wikipedia_first_kick_goal'
  `;
  return row.n;
}

/**
 * Every row this source supplies resolves to a player, so there is no
 * naturally unresolved row to decide. Returning one to the queue is how the
 * honours suite creates the same situation: the product's own resolveLink
 * path then decides it, and because the source still names someone else,
 * preserving the decision and preserving it AGAINST the source are proven by
 * the same test.
 *
 * Rows whose clean name appears more than once as a substring of either file
 * are skipped, so a rename test can edit the files unambiguously.
 */
async function takeSourceLinked(used: Set<number>): Promise<AchievementRow> {
  const rows = await sql<AchievementRow[]>`
    SELECT ${COLUMNS} FROM player_achievements
     WHERE achievement_type = 'first_kick_goal' AND player_id IS NOT NULL
     ORDER BY id
     LIMIT 60
  `;
  const extract = readFileSync(extractPath, 'utf8');
  const manifest = readFileSync(manifestPath, 'utf8');
  const row = rows.find((candidate) => !used.has(candidate.id)
    && extract.split(candidate.nameClean).length === 2
    && manifest.split(candidate.nameClean).length === 2);
  if (!row) throw new Error('no spare source-linked first_kick_goal row in afldb_test');
  used.add(row.id);
  return row;
}

async function returnToQueue(id: number): Promise<void> {
  await sql`
    UPDATE player_achievements
       SET player_id = NULL, link_status_value = 'ambiguous'
     WHERE id = ${id}
  `;
}

/** Resolutions whose target no longer exists — the AFLDB-ISSUE-079 shape. */
async function danglingResolutions(adminUserId: number): Promise<number[]> {
  const rows = await sql<{ targetId: number }[]>`
    SELECT r.target_id::int AS "targetId"
      FROM player_link_resolutions r
     WHERE r.admin_user_id = ${adminUserId}
       AND r.target_table = 'player_achievements'
       AND NOT EXISTS (SELECT 1 FROM player_achievements a WHERE a.id = r.target_id)
     ORDER BY r.target_id
  `;
  return rows.map((row) => row.targetId);
}

describe.skipIf(!canRunImporter)(
  'first-kick-goal reloads preserve identity and manual links (AFLDB-ISSUE-078)',
  () => {
    let adminUserId = 0;
    let playerA = 0;
    let playerB = 0;
    let foreignSourceId = 0;
    let foreignRowId = 0;
    const used = new Set<number>();

    beforeAll(async () => {
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

      // Temp copies of both source files; the tracked/curated files are
      // never touched. The manifest is bootstrapped from the extract copy,
      // which is deterministic, so it matches the committed manifest.
      workDir = mkdtempSync(join(tmpdir(), 'afldb-fkg-'));
      extractPath = join(workDir, 'first-kick-goal.csv');
      manifestPath = join(workDir, 'first-kick-goal-ids.csv');
      writeFileSync(extractPath, readFileSync(REAL_CSV, 'utf8'), 'utf8');
      const bootstrap = runTool(['--assign-ids']);
      expect(bootstrap.status, output(bootstrap)).toBe(0);
      pristineManifest = readFileSync(manifestPath, 'utf8');

      // A first-kick-goal row this importer does NOT own. No product path
      // creates one today — player_achievements has no admin INSERT — but
      // the ownership boundary must hold regardless of who else writes here
      // later, which is the mistake AFLDB-ISSUE-080 records on the honours
      // tables. `manual_admin_edit` is an existing source (migration 057).
      const [foreign] = await sql<{ id: number }[]>`
        SELECT id FROM sources WHERE key = 'manual_admin_edit'
      `;
      expect(foreign, 'afldb_test needs the manual_admin_edit source').toBeDefined();
      foreignSourceId = foreign.id;
      await sql`
        DELETE FROM player_achievements WHERE source_id = ${foreignSourceId}
      `;
      const [inserted] = await sql<{ id: number }[]>`
        INSERT INTO player_achievements (
          achievement_type, player_id, player_name_raw, player_name_clean,
          link_status_value, club_name_raw, season, round_raw,
          source_id, source_record_id
        ) VALUES (
          'first_kick_goal', ${playerA}, 'Issue078 Foreignsource',
          'Issue078 Foreignsource', 'resolved', 'Carlton', 2001, '3',
          ${foreignSourceId}, 'issue-078-foreign'
        ) RETURNING id
      `;
      foreignRowId = inserted.id;
    }, 120_000);

    afterAll(async () => {
      await sql`
        DELETE FROM player_link_resolutions WHERE admin_user_id = ${adminUserId}
      `;
      await sql`
        DELETE FROM player_link_suggestions
         WHERE target_table = 'player_achievements' AND note = ${NOTE}
      `;
      await sql`DELETE FROM auth_users WHERE id = ${adminUserId}`;
      await sql`
        DELETE FROM player_achievements WHERE source_id = ${foreignSourceId}
      `;

      // Deleting an audit row does not undo the link it already applied, so
      // one final reload over the pristine copies — with no decision left to
      // replay — puts every owned row back to pure source state.
      writeFileSync(extractPath, readFileSync(REAL_CSV, 'utf8'), 'utf8');
      writeFileSync(manifestPath, pristineManifest, 'utf8');
      const reset = runImporter();
      expect(reset.status, output(reset)).toBe(0);

      rmSync(workDir, { recursive: true, force: true });
      await sql.end();
    }, 120_000);

    it('rekeys the legacy source_record_id in place, retry-safely', async () => {
      // The DB may be in either state when the suite starts; put it in the
      // known legacy state the one-time transition begins from. The old
      // format is reconstructible from the row itself.
      await sql`
        UPDATE player_achievements
           SET source_record_id = season || '|' || round_raw || '|' || player_name_raw
         WHERE achievement_type = 'first_kick_goal'
           AND source_id <> ${foreignSourceId}
      `;
      const before = await fingerprint();
      const count = await countOwned();

      const rekey = runTool(['--rekey']);
      expect(rekey.status, output(rekey)).toBe(0);
      // The preflight report is part of the contract: the transition only
      // proceeds on an exact bijection.
      expect(rekey.stdout).toContain('exact 1:1 mappings');
      expect(rekey.stdout).toMatch(/exact 1:1 mappings\s+334/);
      expect(rekey.stdout).toMatch(/unmatched manifest rows\s+0/);
      expect(rekey.stdout).toMatch(/unmatched database rows\s+0/);
      expect(rekey.stdout).toContain('every surrogate id is unchanged');

      // In place: same ids, same count, every owned row now stable-keyed.
      expect(await fingerprint()).toBe(before);
      expect(await countOwned()).toBe(count);
      const [bad] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM player_achievements
         WHERE achievement_type = 'first_kick_goal'
           AND source_id <> ${foreignSourceId}
           AND source_record_id !~ '^fkg-[0-9]{3,}$'
      `;
      expect(bad.n).toBe(0);
      expect(await danglingResolutions(adminUserId)).toEqual([]);

      // Second run: verify and no-op.
      const again = runTool(['--rekey']);
      expect(again.status, output(again)).toBe(0);
      expect(again.stdout).toContain('Already rekeyed');
      expect(await fingerprint()).toBe(before);

      // A mixture aborts before mutation.
      const [victim] = await sql<{ id: number; srid: string }[]>`
        SELECT id, source_record_id AS srid FROM player_achievements
         WHERE achievement_type = 'first_kick_goal' AND source_id <> ${foreignSourceId}
         ORDER BY id LIMIT 1
      `;
      await sql`
        UPDATE player_achievements SET source_record_id = 'legacy|1|Mixed State' WHERE id = ${victim.id}
      `;
      const mixed = runTool(['--rekey']);
      expect(mixed.status, output(mixed)).toBe(1);
      expect(output(mixed)).toContain('Mixed identity state');
      await sql`
        UPDATE player_achievements SET source_record_id = ${victim.srid} WHERE id = ${victim.id}
      `;
    }, 120_000);

    it('keeps a resolved link, and the row id, across a reload', async () => {
      const row = await takeSourceLinked(used);
      const admins = row.playerId === playerA ? playerB : playerA;
      await returnToQueue(row.id);

      const linked = await resolveLink({
        targetTable: 'player_achievements',
        targetId: row.id,
        playerId: admins,
        adminUserId,
        note: NOTE,
      });
      expect(linked).toEqual({ ok: true });

      const before = await fingerprint();
      const count = await countOwned();

      const run = runImporter();
      expect(run.status, output(run)).toBe(0);

      // Reconciled in place, not rebuilt.
      expect(await fingerprint()).toBe(before);
      expect(await countOwned()).toBe(count);

      const after = await readById(row.id);
      expect(after, 'the decided row must still exist under its own id').toBeDefined();
      expect(after!.nameClean).toBe(row.nameClean);
      expect(after!.sourceRecordId).toBe(row.sourceRecordId);
      // The source still names its own player; the admin's decision wins.
      expect(after!.playerId).toBe(admins);
      expect(after!.status).toBe('resolved');
      expect(run.stdout).toContain(`the source now links player ${row.playerId}`);
      expect(run.stdout).toContain(row.nameClean);

      expect(await danglingResolutions(adminUserId)).toEqual([]);
    });

    it('keeps a confirmed-unlinked decision, with its audit target alive', async () => {
      const row = await takeSourceLinked(used);
      await returnToQueue(row.id);

      const confirmed = await confirmUnlinked({
        targetTable: 'player_achievements',
        targetId: row.id,
        adminUserId,
        note: NOTE,
      });
      expect(confirmed).toEqual({ ok: true });

      const run = runImporter();
      expect(run.status, output(run)).toBe(0);

      const after = await readById(row.id);
      expect(after).toBeDefined();
      // Vetted as genuinely not an AFLDB player: it must stay that way even
      // though the source supplies a link.
      expect(after!.playerId).toBeNull();
      expect(run.stdout).toContain('confirmed');

      const vetted = await listConfirmedUnlinked();
      expect(vetted.has(`player_achievements:${row.id}`)).toBe(true);
      expect(await danglingResolutions(adminUserId)).toEqual([]);
    });

    it('keeps the row id across a spelling correction (why 078 was reopened)', async () => {
      const row = await takeSourceLinked(used);
      const corrected = `${row.nameClean}ley`;

      // Step 1: the raw extract is corrected. The join now has one unmatched
      // active manifest row AND one unmatched extract row — which may be one
      // spelling correction, so NOTHING is allocated and nothing is written.
      editFile(extractPath, row.nameClean, corrected);
      const before = await fingerprint();
      const blocked = runImporter();
      expect(blocked.status, 'an unmatched active manifest row must stop the reload').toBe(1);
      expect(output(blocked)).toContain('match no extract row');
      expect(output(blocked)).toContain('match no active manifest row');
      expect(output(blocked)).toContain(row.sourceRecordId!);
      expect(await fingerprint()).toBe(before);

      // --assign-ids must refuse for the same reason: allocating here is the
      // rename -> new-identity failure the manifest exists to prevent.
      const manifestBefore = readFileSync(manifestPath, 'utf8');
      const refused = runTool(['--assign-ids']);
      expect(refused.status, 'no id may be allocated while an active row is unmatched').toBe(1);
      expect(readFileSync(manifestPath, 'utf8')).toBe(manifestBefore);

      // Step 2: the curator confirms it is the same person by editing the
      // manifest's Player — keeping the fkg id. The reload now updates the
      // SAME row in place: same surrogate id, corrected name.
      editFile(manifestPath, row.nameClean, corrected);
      const run = runImporter();
      expect(run.status, output(run)).toBe(0);
      expect(run.stdout).toContain('descriptive rename');

      const after = await readById(row.id);
      expect(after, 'the corrected row must keep its surrogate id').toBeDefined();
      expect(after!.nameClean).toBe(corrected);
      expect(after!.sourceRecordId).toBe(row.sourceRecordId);
      expect(await countOwned()).toBe(334);
      const byStable = await readByStableId(row.sourceRecordId!);
      expect(byStable!.id).toBe(row.id);

      // Step 3: revert both files; the rename back is also in place.
      editFile(extractPath, corrected, row.nameClean);
      editFile(manifestPath, corrected, row.nameClean);
      const revert = runImporter();
      expect(revert.status, output(revert)).toBe(0);
      expect((await readById(row.id))!.nameClean).toBe(row.nameClean);
    }, 120_000);

    it('keeps the row id across corrected club, round and season facts', async () => {
      const row = await takeSourceLinked(used);
      // The extract line: Player...,Club,Rd.,Year. Rewrite its facts; the
      // manifest is NOT edited — descriptive drift there is curator context,
      // not identity, so the join is untouched.
      const oldLine = readFileSync(extractPath, 'utf8')
        .split(/\r?\n/).find((l) => l.includes(row.nameClean))!;
      const parts = oldLine.split(',');
      const newLine = [parts[0], 'St Kilda', '7', '1955'].join(',');
      editFile(extractPath, oldLine, newLine);

      const run = runImporter();
      expect(run.status, output(run)).toBe(0);
      const after = await readById(row.id);
      expect(after, 'a factual correction is the same row').toBeDefined();
      expect(after!.clubRaw).toBe('St Kilda');
      expect(after!.roundRaw).toBe('7');
      expect(after!.season).toBe(1955);
      expect(after!.sourceRecordId).toBe(row.sourceRecordId);

      editFile(extractPath, newLine, oldLine);
      const revert = runImporter();
      expect(revert.status, output(revert)).toBe(0);
      expect((await readById(row.id))!.season).toBe(row.season);
    }, 120_000);

    it('refuses a decided rename until that exact id is acknowledged', async () => {
      const row = await takeSourceLinked(used);
      await returnToQueue(row.id);
      const linked = await resolveLink({
        targetTable: 'player_achievements',
        targetId: row.id,
        playerId: playerA,
        adminUserId,
        note: NOTE,
      });
      expect(linked).toEqual({ ok: true });

      const corrected = `${row.nameClean}sen`;
      editFile(extractPath, row.nameClean, corrected);
      editFile(manifestPath, row.nameClean, corrected);

      const refused = runImporter();
      expect(refused.status, 'a decided rename must fail closed').toBe(1);
      expect(output(refused)).toContain(row.sourceRecordId!);
      expect(output(refused)).toContain(row.nameClean);
      expect(output(refused)).toContain(corrected);
      expect(output(refused)).toContain('--accept-rename');
      expect((await readById(row.id))!.nameClean).toBe(row.nameClean);

      // Acknowledgements are validated against THIS run: an unknown id and
      // an id that is not being renamed both fail rather than no-op.
      const unknown = runImporter(['--accept-rename', 'fkg-999']);
      expect(unknown.status).toBe(1);
      expect(output(unknown)).toContain('no rename of that stable id');

      const accepted = runImporter(['--accept-rename', row.sourceRecordId!]);
      expect(accepted.status, output(accepted)).toBe(0);
      expect(accepted.stdout).toContain('acknowledged, decision kept');
      const after = await readById(row.id);
      expect(after, 'same surrogate id').toBeDefined();
      expect(after!.nameClean).toBe(corrected);
      // The human decision survived the acknowledged rename.
      expect(after!.playerId).toBe(playerA);
      expect(after!.status).toBe('resolved');

      // Revert; the rename back is decided too and needs the same gate.
      editFile(extractPath, corrected, row.nameClean);
      editFile(manifestPath, corrected, row.nameClean);
      const revert = runImporter(['--accept-rename', row.sourceRecordId!]);
      expect(revert.status, output(revert)).toBe(0);
      expect((await readById(row.id))!.playerId).toBe(playerA);
    }, 120_000);

    it('allocates new ids only above max-ever-issued, and only when every active row maps', async () => {
      // A genuinely new source row with no manifest id cannot be imported...
      appendLine(extractPath, 'Zzyzx Fixture,Carlton,3,2001');
      const blocked = runImporter();
      expect(blocked.status).toBe(1);
      expect(output(blocked)).toContain('Zzyzx Fixture');

      // ...until --assign-ids allocates for it — touching nothing else.
      const before = readFileSync(manifestPath, 'utf8');
      const assign = runTool(['--assign-ids']);
      expect(assign.status, output(assign)).toBe(0);
      const afterText = readFileSync(manifestPath, 'utf8');
      expect(afterText.startsWith(before)).toBe(true);
      expect(afterText).toContain('fkg-335,Zzyzx Fixture,Carlton,3,2001,active');

      // Unchanged inputs: a repeat run is a no-op.
      const repeat = runTool(['--assign-ids']);
      expect(repeat.status, output(repeat)).toBe(0);
      expect(readFileSync(manifestPath, 'utf8')).toBe(afterText);

      const run = runImporter();
      expect(run.status, output(run)).toBe(0);
      const created = await readByStableId('fkg-335');
      expect(created).toBeDefined();
      expect(await countOwned()).toBe(335);

      // Retire it: the number stays reserved forever.
      removeLineContaining(extractPath, 'Zzyzx Fixture');
      editFile(manifestPath, 'fkg-335,Zzyzx Fixture,Carlton,3,2001,active',
        'fkg-335,Zzyzx Fixture,Carlton,3,2001,retired');
      const retire = runImporter();
      expect(retire.status, output(retire)).toBe(0);
      expect(await readByStableId('fkg-335')).toBeUndefined();
      expect(await countOwned()).toBe(334);

      // The next allocation is ABOVE the retired number, never a reuse.
      appendLine(extractPath, 'Yyy Fixture,Carlton,5,2002');
      const assign2 = runTool(['--assign-ids']);
      expect(assign2.status, output(assign2)).toBe(0);
      expect(readFileSync(manifestPath, 'utf8')).toContain('fkg-336,Yyy Fixture');
      removeLineContaining(extractPath, 'Yyy Fixture');
      removeLineContaining(manifestPath, 'fkg-336,Yyy Fixture');
    }, 120_000);

    it('retirement passes the same preflight as everything else', async () => {
      const row = await takeSourceLinked(used);
      // A durable reference: a reader's tip recorded against this row.
      await sql`
        INSERT INTO player_link_suggestions (target_table, target_id, suggested_name, note)
        VALUES ('player_achievements', ${row.id}, 'Issue078 Tipster', ${NOTE})
      `;
      removeLineContaining(extractPath, row.nameClean);
      editFile(manifestPath, `,${row.nameClean},`, `,${row.nameClean},`); // assert single occurrence
      const manifestText = readFileSync(manifestPath, 'utf8');
      const line = manifestText.split('\n').find((l) => l.includes(`,${row.nameClean},`))!;
      editFile(manifestPath, line, line.replace(/,active$/, ',retired'));

      // "Retired" is not "delete regardless of application history".
      const refused = runImporter();
      expect(refused.status, 'a referenced retirement must fail closed').toBe(1);
      expect(output(refused)).toContain('reader suggestions');
      expect(output(refused)).toContain(`--accept-retirement ${row.sourceRecordId}`);
      expect(await readById(row.id)).toBeDefined();

      // A disposable reference the importer owns, and a durable one it
      // does not: the unresolved issue must go with the row, the
      // adjudicated one is history and is what the gate exists for.
      await sql`
        INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description)
        VALUES ('player_achievements', ${row.id}, 'first_kick_match_unresolved', 'warning', ${NOTE})
      `;
      await sql`
        INSERT INTO data_issues (entity_type, entity_id, issue_type, severity, description, resolved_at)
        VALUES ('player_achievements', ${row.id}, 'career_goals_contradicts_source', 'warning', ${NOTE}, now())
      `;

      const accepted = runImporter(['--accept-retirement', row.sourceRecordId!]);
      expect(accepted.status, output(accepted)).toBe(0);
      expect(accepted.stdout).toContain('ACKNOWLEDGED durable references left behind');
      expect(await readById(row.id)).toBeUndefined();
      expect(await countOwned()).toBe(333);

      // Disposable: cleaned with the row rather than left pointing at it.
      const [unresolved] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM data_issues
         WHERE entity_type = 'player_achievements' AND entity_id = ${row.id}
           AND resolved_at IS NULL
      `;
      expect(unresolved.n, "the importer's own unresolved issues go with the row").toBe(0);
      // Durable: preserved deliberately, and the reason the run had to be
      // acknowledged. Cleaning it would destroy adjudicated history.
      const [adjudicated] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM data_issues
         WHERE entity_type = 'player_achievements' AND entity_id = ${row.id}
           AND resolved_at IS NOT NULL
      `;
      expect(adjudicated.n).toBe(1);
      await sql`
        DELETE FROM data_issues
         WHERE entity_type = 'player_achievements' AND entity_id = ${row.id}
      `;

      // Un-retire: the fact returns as a NEW row under the same stable id.
      appendLine(extractPath, `${row.nameClean},${row.clubRaw},${row.roundRaw},${row.season}`);
      editFile(manifestPath, line.replace(/,active$/, ',retired'), line);
      const back = runImporter();
      expect(back.status, output(back)).toBe(0);
      const revived = await readByStableId(row.sourceRecordId!);
      expect(revived).toBeDefined();
      expect(revived!.id).not.toBe(row.id);
      expect(await countOwned()).toBe(334);
    }, 120_000);

    it('a decided retirement is a decision loss, gated by --allow-link-loss alone', async () => {
      const row = await takeSourceLinked(used);
      await returnToQueue(row.id);

      const confirmed = await confirmUnlinked({
        targetTable: 'player_achievements',
        targetId: row.id,
        adminUserId,
        note: NOTE,
      });
      expect(confirmed).toEqual({ ok: true });

      removeLineContaining(extractPath, row.nameClean);
      const line = readFileSync(manifestPath, 'utf8')
        .split('\n').find((l) => l.includes(`,${row.nameClean},`))!;
      editFile(manifestPath, line, line.replace(/,active$/, ',retired'));

      const refused = runImporter();
      expect(refused.status, 'a decided retirement must fail closed').toBe(1);
      expect(output(refused)).toContain('--allow-link-loss');
      expect(await readById(row.id)).toBeDefined();

      const forced = runImporter(['--allow-link-loss']);
      expect(forced.status, output(forced)).toBe(0);
      expect(forced.stdout).toContain('DISCARDING');
      expect(await readById(row.id)).toBeUndefined();

      // Restore for the remaining tests.
      appendLine(extractPath, `${row.nameClean},${row.clubRaw},${row.roundRaw},${row.season}`);
      editFile(manifestPath, line.replace(/,active$/, ',retired'), line);
      const back = runImporter();
      expect(back.status, output(back)).toBe(0);
      expect(await countOwned()).toBe(334);
    }, 120_000);

    it('leaves a first-kick-goal row owned by another source untouched', async () => {
      const before = await readById(foreignRowId);
      expect(before, 'the foreign-source fixture must exist').toBeDefined();

      const run = runImporter();
      expect(run.status, output(run)).toBe(0);

      const after = await readById(foreignRowId);
      expect(after, 'a row the importer does not own must survive it').toBeDefined();
      expect(after).toEqual(before);

      // `player_achievement_type` currently has exactly one value, so no row
      // of another achievement type can exist to be tested directly. The
      // scope is nonetheless both type- and source-bound, and this fixture
      // proves the source half of it.
      const [types] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'player_achievement_type'
      `;
      expect(types.n, 'add a case here when a second achievement type lands').toBe(1);
    });

    it('rolls the early delete back when a later insert fails', async () => {
      const row = await takeSourceLinked(used);
      // One safe retirement, eligible for the preliminary DELETE...
      removeLineContaining(extractPath, row.nameClean);
      const line = readFileSync(manifestPath, 'utf8')
        .split('\n').find((l) => l.includes(`,${row.nameClean},`))!;
      editFile(manifestPath, line, line.replace(/,active$/, ',retired'));
      // ...plus one new row whose season 1850 violates
      // player_achievements_season_fkey, so a LATER insert fails after the
      // delete has already run inside the same transaction.
      appendLine(extractPath, 'Rollback Fixture,Carlton,3,1850');
      appendLine(manifestPath, 'fkg-900,Rollback Fixture,Carlton,3,1850,active');

      const before = await fingerprint();
      const count = await countOwned();
      const [batches] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM import_batches
         WHERE tool = 'tools/records/import-first-kick-goal.ts'
      `;

      const run = runImporter();
      expect(run.status, 'the failed insert must fail the whole run').toBe(1);

      // Nothing survives: the deleted row is back (it was never gone), the
      // fingerprint is untouched, and — because the batch row is created
      // inside the same transaction — no import_batches row exists either.
      // That last part is architecture, not an accident: the Python loaders
      // commit their batch first and mark it failed; this importer leaves no
      // trace of an aborted run.
      const survivor = await readById(row.id);
      expect(survivor, 'the early DELETE must roll back with the transaction').toBeDefined();
      expect(survivor!.sourceRecordId).toBe(row.sourceRecordId);
      expect(await fingerprint()).toBe(before);
      expect(await countOwned()).toBe(count);
      const [batchesAfter] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM import_batches
         WHERE tool = 'tools/records/import-first-kick-goal.ts'
      `;
      expect(batchesAfter.n).toBe(batches.n);

      // Restore the working copies.
      appendLine(extractPath, `${row.nameClean},${row.clubRaw},${row.roundRaw},${row.season}`);
      removeLineContaining(extractPath, 'Rollback Fixture');
      editFile(manifestPath, line.replace(/,active$/, ',retired'), line);
      removeLineContaining(manifestPath, 'fkg-900');
      const heal = runImporter();
      expect(heal.status, output(heal)).toBe(0);
    }, 120_000);

    it('grants the import role every read its preflight performs', async () => {
      // This suite connects as the OWNER, so a missing afldb_import grant
      // is invisible to every other test here — the retirement preflight
      // reads tables the import role had no privilege on at all, and would
      // have failed closed on "permission denied" the first time a curator
      // retired a record in production. Assert the grants directly.
      const [role] = await sql<{ present: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afldb_import') AS present
      `;
      if (!role.present) return;

      for (const table of ['player_achievements', 'data_issues',
        'player_link_resolutions', 'player_link_suggestions']) {
        const [grant] = await sql<{ ok: boolean }[]>`
          SELECT has_table_privilege('afldb_import', ${table}, 'SELECT') AS ok
        `;
        expect(grant.ok, `afldb_import needs SELECT on ${table}`).toBe(true);
      }
      // ...and stays unable to write the two human-contributed tables.
      for (const table of ['player_link_resolutions', 'player_link_suggestions']) {
        for (const privilege of ['UPDATE', 'DELETE']) {
          const [grant] = await sql<{ ok: boolean }[]>`
            SELECT has_table_privilege('afldb_import', ${table}, ${privilege}) AS ok
          `;
          expect(grant.ok, `afldb_import must not hold ${privilege} on ${table}`).toBe(false);
        }
      }
    });

    it('reads decisions in the bigint representation the driver actually returns', async () => {
      // The cause of a bug this suite once caught: target_id is bigint, and
      // postgres.js hands int8 back as a STRING (an int8 can exceed
      // Number.MAX_SAFE_INTEGER). A number-keyed lookup therefore read every
      // decision and silently dropped all of them. The two decision-survival
      // tests above prove the lookup works; this pins the representation so
      // the mismatch cannot silently return.
      const [column] = await sql<{ type: string }[]>`
        SELECT data_type AS type FROM information_schema.columns
         WHERE table_name = 'player_link_resolutions' AND column_name = 'target_id'
      `;
      expect(column.type).toBe('bigint');

      const [decision] = await sql<{ targetId: unknown }[]>`
        SELECT target_id AS "targetId" FROM player_link_resolutions
         WHERE admin_user_id = ${adminUserId}
         LIMIT 1
      `;
      expect(decision, 'earlier tests recorded decisions for this admin').toBeDefined();
      expect(typeof decision.targetId).toBe('string');
    });

    it('is idempotent: two further reloads change no row id', async () => {
      const first = runImporter();
      expect(first.status, output(first)).toBe(0);
      const before = await fingerprint();
      const count = await countOwned();

      const second = runImporter();
      expect(second.status, output(second)).toBe(0);
      expect(await fingerprint()).toBe(before);
      expect(await countOwned()).toBe(count);

      // The importer files its own data_issues; re-running must not stack
      // duplicates against the ids it just kept.
      const [issues] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM (SELECT entity_id, issue_type FROM data_issues
                 WHERE entity_type = 'player_achievements' AND resolved_at IS NULL
                 GROUP BY 1, 2 HAVING count(*) > 1) d
      `;
      expect(issues.n).toBe(0);
    }, 120_000);
  },
);
