/**
 * Visual evidence for V2-GAP-006 (owner decision D-V2-GAP006-EDITORS, Option E1). Local only.
 *
 *   node node_modules/tsx/dist/cli.mjs tools/v2/gap006-editor-visual.mts <new-output-dir>
 *
 * Run inside `isolated-pg.ts run <db>` against a production build served on 127.0.0.1:3912
 * (`tools/v2/local-release.mjs start v2`) from the SAME disposable database. HEADED Chromium: the
 * screenshots are of what an administrator sees. The output directory must not exist (retained
 * evidence is never overwritten). The session is a local `@example.invalid` fixture identity; no
 * token is printed. External requests are blocked and counted.
 *
 * What it proves in the browser, on a real sealed-season (1990) match of the disposable database:
 *   1. the data editor shows the shared correction-note field with its rule;
 *   2. a save with no note is REFUSED with the sealed-season message, the page keeps the form, and
 *      the database row and the data_edits count are unchanged (read back, not assumed);
 *   3. a save with a valid note succeeds, and the data_edits row carries that note and the actor;
 *   4. the other editors that gained a note field render it (create match, award winner, draft
 *      wizard, coach assignment, season-list, special records, player links, Brownlow editor).
 * The match's original `notes` value is restored through the database afterwards (the audit rows
 * written by this run are left: the database is disposable and the rows are the evidence).
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import postgres from 'postgres';
import { chromium } from '@playwright/test';
import { checkIsolatedTestDsn, checkIsolatedTestServer, ISOLATED_SERVER_FACTS_SQL } from '@afldb/domain';

const [outDir] = process.argv.slice(2);
if (!outDir || existsSync(outDir)) throw new Error('usage: gap006-editor-visual.mts <new-output-dir> (must not exist)');
const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || checkIsolatedTestDsn(dsn, Number(process.env.AFLDB_V2_ISOLATED_PORT)).length) throw new Error('Isolated runner required');
const database = new URL(dsn).pathname.slice(1);
const sql = postgres(dsn, { max: 1, onnotice: () => {} });
const secret = createHash('sha256').update(process.env.AFLDB_TEST_AUTH_DATABASE_URL ?? '').digest('hex');
const baseURL = 'http://127.0.0.1:3912';
const log: string[] = [];
const note = (line: string) => { log.push(line); console.log(line); };

const browser = await chromium.launch({ headless: false, slowMo: 150 });
try {
  const [facts] = await sql.unsafe(ISOLATED_SERVER_FACTS_SQL);
  if (checkIsolatedTestServer(database, { clusterName: facts.cluster_name, databaseComment: facts.database_comment,
    currentDatabase: facts.current_database }).length) throw new Error('Live identity proof failed');
  mkdirSync(outDir, { recursive: false });

  const email = 'gap006-visual-super_admin@example.invalid';
  let [user] = await sql`SELECT id, role FROM auth_users WHERE email = ${email}`;
  if (!user) [user] = await sql`INSERT INTO auth_users(email, role) VALUES(${email}, 'super_admin') RETURNING id, role`;
  await sql`UPDATE auth_users SET can_manage_admins = true, must_change_password = false WHERE id = ${user.id}`;

  const open = async (viewport: { width: number; height: number }) => {
    const context = await browser.newContext({ baseURL, viewport });
    await context.addCookies([{ name: 'afldb_consent', value: 'declined', url: baseURL, sameSite: 'Lax' }]);
    let blocked = 0;
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).hostname !== '127.0.0.1') { blocked++; return route.abort(); }
      return route.continue();
    });
    const token = randomBytes(32).toString('base64url');
    await sql`INSERT INTO auth_sessions(token_hash, user_id, expires_at) VALUES(${createHash('sha256').update(token).digest('hex')}, ${user.id}, now() + interval '2 hours')`;
    const payload = Buffer.from(JSON.stringify({ v: 1, kind: 'admin', sub: `${user.id}:${token}`,
      exp: Math.floor(Date.now() / 1000) + 7200, epoch: 1 })).toString('base64url');
    await context.addCookies([{ name: 'afldb_admin', value: `${payload}.${createHmac('sha256', secret).update(Buffer.from(payload, 'base64url')).digest('base64url')}`,
      url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(60_000);
    return { context, page, blocked: () => blocked };
  };

  // ---- 1-3: the sealed-season refusal and the valid correction, end to end -----------------------
  const [match] = await sql<{ id: number; notes: string | null }[]>`
    SELECT id, notes FROM matches WHERE season = 1990 ORDER BY id LIMIT 1`;
  if (!match) throw new Error('No 1990 match in the disposable database');
  const auditCount = async () => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM data_edits`)[0].n;
  const matchNotes = async () => (await sql<{ notes: string | null }[]>`SELECT notes FROM matches WHERE id = ${match.id}`)[0].notes;
  const original = match.notes;
  const desktop = await open({ width: 1280, height: 800 });
  const page = desktop.page;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`/admin/data-editor?entity=matches&id=${match.id}`, { waitUntil: 'networkidle' });
  const notesForm = page.locator('form').filter({ has: page.locator('input[name="group"][value="notes"]') }).first();
  await notesForm.scrollIntoViewIfNeeded();
  const field = notesForm.locator('textarea[name="note"]');
  note(`editor shows the correction-note field: ${await field.count() === 1}`);
  await page.screenshot({ path: `${outDir}/01-data-editor-note-field__desktop.png`, fullPage: true });

  const auditBefore = await auditCount();
  const probe = `gap006 visual probe ${Date.now()}`;
  const probeField = notesForm.locator('[name="notes"]').first();
  await probeField.fill(probe);
  await notesForm.locator('button[type="submit"]').click();
  await page.getByText('is sealed historical data').first().waitFor({ timeout: 30_000 });
  const kept = await probeField.inputValue();
  note(`REFUSAL shown; matches.notes unchanged=${(await matchNotes()) === original}; data_edits unchanged=${(await auditCount()) === auditBefore}; typed edit kept in the form=${kept === probe}`);
  if (kept !== probe) throw new Error('The refused save wiped the typed edit from the form');
  if ((await matchNotes()) !== original || (await auditCount()) !== auditBefore) throw new Error('A refused save changed the database');
  await notesForm.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${outDir}/02-data-editor-refusal-no-note__desktop.png`, fullPage: true });

  const goodNote = 'Visual evidence run: corrected the match notes against the printed scoreboard.';
  await notesForm.locator('textarea[name="note"]').fill(goodNote);
  await notesForm.locator('button[type="submit"]').click();
  await page.waitForTimeout(2500);
  const after = await sql<{ note: string; adminUserId: number; fieldGroup: string }[]>`
    SELECT note, admin_user_id AS "adminUserId", field_group AS "fieldGroup" FROM data_edits
     WHERE table_name = 'matches' AND row_id = ${match.id} ORDER BY id DESC LIMIT 1`;
  note(`VALID NOTE saved; audit row bound: ${after[0]?.note === goodNote && after[0]?.adminUserId === user.id}; matches.notes now=${JSON.stringify(await matchNotes())}`);
  if (after[0]?.note !== goodNote || after[0]?.adminUserId !== user.id || (await matchNotes()) !== probe) throw new Error('The valid sealed correction was not applied and audited');
  await page.screenshot({ path: `${outDir}/03-data-editor-valid-note-saved__desktop.png`, fullPage: true });
  await sql`UPDATE matches SET notes = ${original} WHERE id = ${match.id}`;
  note(`restored matches.notes via the database: ${(await matchNotes()) === original}`);

  // ---- 4: every other editor that gained the field renders it -----------------------------------
  const [coach] = await sql<{ id: number }[]>`SELECT id FROM coaches ORDER BY id LIMIT 1`;
  const [club] = await sql<{ slug: string; id: number }[]>`SELECT slug, id FROM clubs WHERE afldb_identity_for_season(organization_id, 2025::smallint) = id ORDER BY id LIMIT 1`;
  const [pick] = await sql<{ id: number }[]>`SELECT id FROM draft_picks WHERE source_id IS NOT NULL ORDER BY id LIMIT 1`;
  const [winner] = await sql<{ id: number }[]>`SELECT id FROM award_winners ORDER BY id DESC LIMIT 1`;
  const [fkg] = await sql<{ id: number }[]>`SELECT id FROM player_achievements ORDER BY id LIMIT 1`;
  const screens: [string, string | null][] = [
    ['05-award-winner-new', '/admin/awards/winners/new'],
    ['06-award-winner-detail', winner ? `/admin/awards/winners/${winner.id}` : null],
    ['07-draft-new-pick', '/admin/draft/new'],
    ['08-draft-pick-detail', pick ? `/admin/draft/${pick.id}` : null],
    ['11-first-kick-goal-new', '/admin/records/first-kick-goal/new'],
    ['12-first-kick-goal-detail', fkg ? `/admin/records/first-kick-goal/${fkg.id}` : null],
  ];
  for (const [name, path] of screens) {
    if (!path) { note(`${name}: skipped (no fixture row)`); continue; }
    errors.length = 0;
    const response = await page.goto(path, { waitUntil: 'networkidle' }).catch((error) => { note(`${name}: navigation failed ${String(error).slice(0, 120)}`); return null; });
    const fields = await page.locator('textarea[id^="correction-note"]').count();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: `${outDir}/${name}__desktop.png`, fullPage: true });
    note(`${name}: ${path} status=${response?.status()} correctionNoteFields=${fields} horizontalOverflowPx=${overflow} pageErrors=${errors.length}`);
  }

  // The create-match form is collapsed until opened.
  await page.goto('/admin/data-editor', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Add new match/ }).click();
  await page.locator('textarea[id^="correction-note"]').first().waitFor({ timeout: 15_000 });
  await page.screenshot({ path: `${outDir}/04-create-match__desktop.png`, fullPage: true });
  note(`04-create-match: correctionNoteFields=${await page.locator('textarea[id^="correction-note"]').count()}`);

  // Coach assignment on a sealed (2025) club season: Set without a note is refused and changes nothing.
  if (coach && club) {
    await page.goto(`/admin/coaches/${coach.id}?assignClub=${club.id}&assignSeason=2025`, { waitUntil: 'networkidle' });
    const coachRowsBefore = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM match_coaches`)[0].n;
    const auditsBefore = await auditCount();
    await page.getByRole('button', { name: 'Set', exact: true }).first().click();
    await page.getByText('is sealed historical data').first().waitFor({ timeout: 30_000 });
    const unchanged = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM match_coaches`)[0].n === coachRowsBefore && (await auditCount()) === auditsBefore;
    note(`09-coach-assignments: REFUSAL shown for Set without a note; match_coaches and data_edits unchanged=${unchanged}; correctionNoteFields=${await page.locator('textarea[id^="correction-note"]').count()}`);
    if (!unchanged) throw new Error('A refused coach assignment changed the database');
    await page.screenshot({ path: `${outDir}/09-coach-assignments-refusal__desktop.png`, fullPage: true });
  }
  note('season-lists and player-links notes: not captured (the disposable database has no 2027 club identity and no open review target); source and typecheck only: VISUAL: UNVERIFIED');

  // Mobile (390x844) for the editor form that carries the refusal copy.
  const mobile = await open({ width: 390, height: 844 });
  await mobile.page.goto(`/admin/data-editor?entity=matches&id=${match.id}`, { waitUntil: 'networkidle' });
  const mobileOverflow = await mobile.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await mobile.page.screenshot({ path: `${outDir}/14-data-editor-note-field__mobile.png`, fullPage: true });
  note(`14-data-editor mobile: horizontalOverflowPx=${mobileOverflow}`);

  note(`blockedExternalRequests desktop=${desktop.blocked()} mobile=${mobile.blocked()}`);
  if (desktop.blocked() || mobile.blocked()) throw new Error('External requests were blocked');
  await desktop.context.close(); await mobile.context.close();
  note(`database=${database} baseURL=${baseURL}`);
} finally {
  if (existsSync(outDir)) writeFileSync(`${outDir}/capture-log.txt`, `${log.join('\n')}\n`, { flag: 'wx' });
  await browser.close(); await sql.end({ timeout: 5 });
}
