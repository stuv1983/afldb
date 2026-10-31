/**
 * Visual evidence for V2-GAP-006 (D-V2-GAP006-EDITORS, Option E1): the two journeys the first
 * capture could not reach for want of a target - a player-link review and a season-list edit.
 * Local only.
 *
 *   node node_modules/tsx/dist/cli.mjs tools/v2/gap006-review-visual.mts <new-output-dir>
 *
 * Run inside `isolated-pg.ts run <db> -- ...` against a production build served on 127.0.0.1:3912
 * (`tools/v2/local-release.mjs start v2`) from the SAME disposable database. HEADED Chromium. The
 * output directory must not exist (retained evidence is never overwritten). The session is a local
 * `@example.invalid` fixture identity signed with a locally derived key; no cookie, token or DSN is
 * printed or written. External requests are blocked and counted.
 *
 * SYNTHETIC FIXTURES (all tagged 'Gapsix' and written only to the disposable database):
 *   - a 2027 `seasons` row (copy of 2026) so that the season-list editor has an administrable season;
 *   - four synthetic players and one synthetic UNMATCHED 1990 award-winner row to review.
 *
 * WHAT IT PROVES, each read back from the database and not assumed:
 *   PLAYER LINKS (real registry; 1990 is sealed): linking with no note and with a short note is
 *     REFUSED with the sealed-season message, nothing is written (award row, resolution rows, edits),
 *     the picked player and the typed note stay in the form; a valid note links and the resolution
 *     row binds the actor and the trimmed note.
 *   SEASON LISTS: with the REAL registry 2027 is open, so an add needs no note (control). The
 *     season-list editor only ever works on the newest season, which the real registry keeps open, so
 *     a refusal cannot occur there today. To show the refusal path the editor takes when that season
 *     is sealed, the build's COPY of data/reference/seasons.json (.next/standalone, a git-ignored build
 *     artefact; the repository file is never touched) is switched to a SYNTHETIC registry sealing 2027
 *     for the sealed half only, and restored afterwards. Those screenshots are labelled SYNTHETIC REGISTRY.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { chromium } from '@playwright/test';
import { checkIsolatedTestDsn, checkIsolatedTestServer, ISOLATED_SERVER_FACTS_SQL } from '@afldb/domain';

const [outDir, runTag = 'r1'] = process.argv.slice(2);
if (!outDir || existsSync(outDir)) throw new Error('usage: gap006-review-visual.mts <new-output-dir> [run-tag] (dir must not exist; a new tag per run keeps fixtures fresh)');
const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || checkIsolatedTestDsn(dsn, Number(process.env.AFLDB_V2_ISOLATED_PORT)).length) throw new Error('Isolated runner required');
const database = new URL(dsn).pathname.slice(1);
const sql = postgres(dsn, { max: 1, onnotice: () => {} });
const secret = createHash('sha256').update(process.env.AFLDB_TEST_AUTH_DATABASE_URL ?? '').digest('hex');
const baseURL = 'http://127.0.0.1:3912';
const REGISTRY = join(process.cwd(), '.next', 'standalone', 'data', 'reference', 'seasons.json');
const REGISTRY_BACKUP = join(outDir, '.registry-original.json.tmp');
const NAME = { link: `Gapsix Linkson ${runTag}`, open: `Gapsix Openson ${runTag}`, sealed: `Gapsix Sealson ${runTag}`, mobile: `Gapsix Mobileson ${runTag}` };
const log: string[] = [];
const note = (line: string) => { log.push(line); console.log(line); };
const check = (ok: boolean, what: string) => { note(`${ok ? 'OK  ' : 'FAIL'} ${what}`); if (!ok) throw new Error(`Check failed: ${what}`); };

const browser = await chromium.launch({ headless: false, slowMo: 150 });
let registrySwapped = false;
try {
  const [facts] = await sql.unsafe(ISOLATED_SERVER_FACTS_SQL);
  if (checkIsolatedTestServer(database, { clusterName: facts.cluster_name, databaseComment: facts.database_comment,
    currentDatabase: facts.current_database }).length) throw new Error('Live identity proof failed');
  mkdirSync(outDir, { recursive: false });

  const email = 'gap006-visual-super_admin@example.invalid';
  let [user] = await sql`SELECT id, role FROM auth_users WHERE email = ${email}`;
  if (!user) [user] = await sql`INSERT INTO auth_users(email, role) VALUES(${email}, 'super_admin') RETURNING id, role`;
  await sql`UPDATE auth_users SET can_manage_admins = true, must_change_password = false WHERE id = ${user.id}`;

  // ---- synthetic fixtures ---------------------------------------------------------------------
  await sql`INSERT INTO seasons (year, competition, league, status, notes)
            SELECT 2027, competition, league, status, 'GAP-006 synthetic season row (visual evidence)'
              FROM seasons WHERE year = 2026 ON CONFLICT DO NOTHING`;
  const makePlayer = async (display: string) => {
    const slug = display.toLowerCase().replace(/\s+/g, '-');
    const [existing] = await sql<{ id: number }[]>`SELECT id FROM players WHERE slug = ${slug}`;
    if (existing) return existing.id;
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO players (display_name, sort_name, search_name, slug)
      VALUES (${display}, ${display.split(' ').reverse().join(', ')}, ${display.toLowerCase()}, ${slug}) RETURNING id`;
    // The season-list editor refuses an identity-less player, so each synthetic player holds a (synthetic) AFL Tables identity.
    await sql`INSERT INTO external_identities (source_id, external_id, player_id, status, match_method, notes)
              VALUES ((SELECT id FROM sources WHERE key = 'afltables'), ${`players/G/${slug}.html`}, ${row.id}, 'unique', 'afltables_profile_url', 'GAP-006 synthetic visual-evidence identity')`;
    return row.id;
  };
  const playerLink = await makePlayer(NAME.link);
  const playerOpen = await makePlayer(NAME.open);
  const playerSealed = await makePlayer(NAME.sealed);
  const playerMobile = await makePlayer(NAME.mobile);
  let [target] = await sql<{ id: number }[]>`SELECT id FROM award_winners WHERE player_name_raw = ${NAME.link} AND season = 1990`;
  if (!target) {
    [target] = await sql<{ id: number }[]>`
      INSERT INTO award_winners (award_id, season, player_name_raw, link_status_value, status, source_id, source_record_id)
      VALUES ((SELECT id FROM awards ORDER BY id LIMIT 1), 1990, ${NAME.link}, 'unmatched', 'active', (SELECT id FROM sources WHERE key = 'manual_admin_edit'), ${'gap006-visual-' + runTag + '-link'}) RETURNING id`;
  }
  const [club] = await sql<{ slug: string; name: string }[]>`SELECT slug, name FROM afldb_season_list_clubs(2027::smallint) ORDER BY name LIMIT 1`;
  if (!club) throw new Error('No 2027 list club in the disposable database');
  note(`fixtures: players link=${playerLink} open=${playerOpen} sealed=${playerSealed} mobile=${playerMobile}; award_winners target=${target.id}; list club=${club.slug}`);

  const count = async (table: string) => (await sql.unsafe(`SELECT count(*)::int AS n FROM ${table}`))[0].n as number;
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
    page.setDefaultTimeout(30_000);
    return { context, page, blocked: () => blocked };
  };
  const overflowOf = (page: import('@playwright/test').Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const pickPlayer = async (scope: import('@playwright/test').Locator, label: string, name: string) => {
    const input = scope.getByRole('combobox', { name: label }).first();
    await input.fill(name);
    await scope.page().getByRole('option', { name: new RegExp(name) }).first().click();
  };

  const desktop = await open({ width: 1280, height: 800 });
  const page = desktop.page;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // ======================================================================================
  // PLAYER LINKS: a sealed (1990) award row, real registry
  // ======================================================================================
  await page.goto(`/admin/player-links?table=award_winners&q=${encodeURIComponent(NAME.link)}`, { waitUntil: 'networkidle' });
  const row = page.locator('tr', { hasText: NAME.link }).first();
  await row.waitFor();
  await page.screenshot({ path: `${outDir}/01-player-links-queue__desktop.png`, fullPage: true });

  await row.getByRole('button', { name: /^Resolve/ }).click();
  await page.getByRole('combobox', { name: 'Find AFLDB player' }).first().waitFor();
  const noteField = page.locator('textarea[name="note"]').last();
  await pickPlayer(page.locator('body'), 'Find AFLDB player', NAME.link);
  const submit = page.getByRole('button', { name: 'Link player' }).first();

  const before = { rows: await count('player_link_resolutions'), edits: await count('data_edits') };
  const unchangedNow = async () => (await count('player_link_resolutions')) === before.rows && (await count('data_edits')) === before.edits
    && (await sql`SELECT player_id, link_status_value::text AS s FROM award_winners WHERE id = ${target.id}`)[0].player_id === null;

  // (a) no note
  await submit.click();
  await page.getByText('is sealed historical data').first().waitFor();
  check(await unchangedNow(), 'player link, NO note: refused, award row unlinked, no resolution row, no data_edits row');
  await page.screenshot({ path: `${outDir}/02-player-link-refusal-no-note__desktop.png`, fullPage: true });

  // (b) short note, and the entered values must survive the refusal
  await noteField.fill('too short');
  await submit.click();
  await page.getByText('shorter than 20 characters').first().waitFor();
  check(await unchangedNow(), 'player link, SHORT note: refused, nothing written');
  check((await noteField.inputValue()) === 'too short', 'the typed note is still in the form after the refusal');
  check(await page.getByRole('combobox', { name: 'Find AFLDB player' }).count() === 0 && await page.getByText(NAME.link).count() > 1, 'the picked player is still shown after the refusal');
  await page.screenshot({ path: `${outDir}/03-player-link-refusal-short-note-kept__desktop.png`, fullPage: true });

  // (c) valid note: links, binds the actor and the note
  const goodNote = 'Visual evidence run: synthetic reviewee verified against the 1990 printed award list.';
  await noteField.fill(goodNote);
  await submit.click();
  await page.waitForTimeout(3000);
  const [linked] = await sql<{ playerId: number | null; status: string }[]>`SELECT player_id AS "playerId", link_status_value::text AS status FROM award_winners WHERE id = ${target.id}`;
  const [resolution] = await sql<{ note: string; adminUserId: number; action: string; playerId: number }[]>`
    SELECT note, admin_user_id AS "adminUserId", action, player_id AS "playerId" FROM player_link_resolutions
     WHERE target_table = 'award_winners' AND target_id = ${target.id} ORDER BY id DESC LIMIT 1`;
  check(linked.playerId === playerLink && linked.status === 'resolved', 'valid note: the award row is linked to the picked player');
  check(resolution?.note === goodNote && resolution.adminUserId === user.id && resolution.action === 'linked' && resolution.playerId === playerLink,
    'valid note: the resolution row binds the actor, the action, the player and the trimmed note');
  await page.screenshot({ path: `${outDir}/04-player-link-valid-note-linked__desktop.png`, fullPage: true });
  note(`pageErrors during player-link journey: ${errors.length}`);

  // ======================================================================================
  // SEASON LISTS: 2027
  // ======================================================================================
  const listPath = `/admin/season-lists/2027/${club.slug}`;
  const addFor = async (p: import('@playwright/test').Page, name: string) => {
    const panel = p.locator('section').filter({ has: p.getByRole('heading', { name: 'Add a player' }) }).first();
    await panel.scrollIntoViewIfNeeded();
    await pickPlayer(panel, 'Search players…', name);
    return { panel, noteBox: panel.locator('textarea').first(), button: panel.getByRole('button', { name: /Add to the list/ }) };
  };
  const members = async (playerId: number) => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM season_list_members WHERE season = 2027 AND player_id = ${playerId}`)[0].n;

  // control: the REAL registry keeps 2027 open, so no note is required
  await page.goto(listPath, { waitUntil: 'networkidle' });
  let ui = await addFor(page, NAME.open);
  await page.screenshot({ path: `${outDir}/05-season-list-add-open-season-form__desktop.png`, fullPage: true });
  await ui.button.click();
  await page.waitForTimeout(3500);
  note(`open add alerts: ${JSON.stringify(await page.locator('[role="alert"],[role="status"]').allTextContents())}`);
  await page.screenshot({ path: `${outDir}/06-season-list-add-open-season-no-note-ok__desktop.png`, fullPage: true });
  check(await members(playerOpen) === 1, 'REAL registry (2027 open): an add with no note succeeds, as before');
  await page.screenshot({ path: `${outDir}/06-season-list-add-open-season-no-note-ok__desktop.png`, fullPage: true });

  // sealed half: SYNTHETIC registry sealing 2027 (build copy only)
  copyFileSync(REGISTRY, REGISTRY_BACKUP);
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  registry.in_progress_seasons = (registry.in_progress_seasons ?? []).filter((s: number) => s !== 2027);
  writeFileSync(REGISTRY, `${JSON.stringify(registry, null, 2)}\n`);
  registrySwapped = true;
  note('SYNTHETIC REGISTRY in effect for the next steps: 2027 sealed (the build copy of seasons.json only)');

  await page.goto(listPath, { waitUntil: 'networkidle' });
  ui = await addFor(page, NAME.sealed);
  const editsBefore = await count('data_edits');
  await ui.button.click();
  await page.getByText('is sealed historical data').first().waitFor();
  check(await members(playerSealed) === 0 && await count('data_edits') === editsBefore, 'SYNTHETIC REGISTRY, NO note: the add is refused, no membership, no data_edits row');
  await page.screenshot({ path: `${outDir}/07-season-list-refusal-no-note__SYNTHETIC-REGISTRY__desktop.png`, fullPage: true });

  await ui.noteBox.fill('too short');
  await ui.button.click();
  await page.getByText('shorter than 20 characters').first().waitFor();
  check(await members(playerSealed) === 0 && await count('data_edits') === editsBefore, 'SYNTHETIC REGISTRY, SHORT note: refused, nothing written');
  check((await ui.noteBox.inputValue()) === 'too short' && await ui.panel.getByText(NAME.sealed).count() > 0, 'the typed note and the picked player are kept after the refusal');
  await page.screenshot({ path: `${outDir}/08-season-list-refusal-short-note-kept__SYNTHETIC-REGISTRY__desktop.png`, fullPage: true });

  const listNote = 'Visual evidence run: added to the synthetic list after checking the club-supplied squad sheet.';
  await ui.noteBox.fill(listNote);
  await ui.button.click();
  await page.waitForTimeout(3500);
  const [membership] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM season_list_members WHERE season = 2027 AND player_id = ${playerSealed}`;
  const [audit] = await sql<{ note: string; adminUserId: number; tableName: string; fieldGroup: string }[]>`
    SELECT note, admin_user_id AS "adminUserId", table_name AS "tableName", field_group AS "fieldGroup" FROM data_edits
     WHERE admin_user_id = ${user.id} ORDER BY id DESC LIMIT 1`;
  check(membership.n === 1 && audit?.note === listNote && audit.adminUserId === user.id,
    `SYNTHETIC REGISTRY, valid note: added; the audit row (${audit?.tableName}/${audit?.fieldGroup}) binds the actor and the trimmed note`);
  await page.screenshot({ path: `${outDir}/09-season-list-valid-note-added__SYNTHETIC-REGISTRY__desktop.png`, fullPage: true });

  // ======================================================================================
  // MOBILE (390x844): the refusal state of both editors, no horizontal overflow
  // ======================================================================================
  const mobile = await open({ width: 390, height: 844 });
  const mp = mobile.page;
  await mp.goto(listPath, { waitUntil: 'networkidle' });
  const mu = await addFor(mp, NAME.mobile);
  await mu.button.click();
  await mp.getByText('is sealed historical data').first().waitFor();
  check(await members(playerMobile) === 0, 'mobile, SYNTHETIC REGISTRY: refusal shown, nothing written');
  const mobileListOverflow = await overflowOf(mp);
  await mp.screenshot({ path: `${outDir}/10-season-list-refusal__SYNTHETIC-REGISTRY__mobile.png`, fullPage: true });

  // Player-link mobile: a second synthetic unmatched row so the refusal can be shown again.
  const [target2] = await sql<{ id: number }[]>`
    INSERT INTO award_winners (award_id, season, player_name_raw, link_status_value, status, source_id, source_record_id)
    VALUES ((SELECT id FROM awards ORDER BY id LIMIT 1), 1990, ${NAME.mobile}, 'unmatched', 'active', (SELECT id FROM sources WHERE key = 'manual_admin_edit'), ${'gap006-visual-' + runTag + '-mobile'}) RETURNING id`;
  await mp.goto(`/admin/player-links?table=award_winners&q=${encodeURIComponent(NAME.mobile)}`, { waitUntil: 'load' });
  const mrow = mp.locator('tr', { hasText: NAME.mobile }).first();
  await mrow.waitFor();
  await mrow.getByRole('button', { name: /^Resolve/ }).click();
  await pickPlayer(mp.locator('body'), 'Find AFLDB player', NAME.mobile);
  await mp.getByRole('button', { name: 'Link player' }).first().click();
  await mp.getByText('is sealed historical data').first().waitFor();
  check((await sql`SELECT player_id FROM award_winners WHERE id = ${target2.id}`)[0].player_id === null, 'mobile player link, no note: refused, row unlinked');
  const mobileLinkOverflow = await overflowOf(mp);
  await mp.screenshot({ path: `${outDir}/11-player-link-refusal__mobile.png`, fullPage: true });
  note(`horizontalOverflowPx mobile: season-list=${mobileListOverflow} player-link=${mobileLinkOverflow}; desktop player-links=${await overflowOf(page)}`);
  check(mobileListOverflow <= 0 && mobileLinkOverflow <= 0, 'no horizontal page scroll at 390px');

  note(`blockedExternalRequests desktop=${desktop.blocked()} mobile=${mobile.blocked()}`);
  if (desktop.blocked() || mobile.blocked()) throw new Error('External requests were blocked');
  await desktop.context.close(); await mobile.context.close();
  note(`database=${database} baseURL=${baseURL}`);
} finally {
  if (registrySwapped) {
    copyFileSync(REGISTRY_BACKUP, REGISTRY);
    unlinkSync(REGISTRY_BACKUP);
    note('build copy of seasons.json restored from its backup');
  }
  if (existsSync(outDir)) {
    writeFileSync(`${outDir}/capture-log.txt`, `${log.join('\n')}\n`, { flag: 'wx' });
  }
  await browser.close(); await sql.end({ timeout: 5 });
}
