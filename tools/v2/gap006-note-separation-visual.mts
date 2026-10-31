/**
 * Visual evidence for V2-GAP-006 review F-003 (corrected): the human correction justification is the private audit
 * record's alone and never becomes a list entry's or an appointment's own note. Local only.
 *
 *   node node_modules/tsx/dist/cli.mjs tools/v2/gap006-note-separation-visual.mts <new-output-dir> [run-tag]
 *
 * Run inside `isolated-pg.ts run <db> -- ...` against a production build served on 127.0.0.1:3912
 * (`tools/v2/local-release.mjs start v2`) from the SAME disposable database. HEADED Chromium. The output directory
 * must not exist. Local `@example.invalid` fixture session; no cookie, token or DSN is printed or written. External
 * requests are blocked and counted.
 *
 * SYNTHETIC-REGISTRY: the real registry keeps 2027 (the only administrable season) open, so the sealed half switches
 * the build COPY of data/reference/seasons.json (.next/standalone, a git-ignored artefact) to a registry sealing 2027,
 * and restores it afterwards. Screenshots of that half carry the SYNTHETIC-REGISTRY label.
 *
 * WHAT IT PROVES, read back from the database and from the rendered pages:
 *   - sealed season, an entry note and NO correction note: the add is refused, nothing is written, the typed values stay;
 *   - entry note + correction note: the entry stores ONLY its own note; the audit row stores ONLY the correction note;
 *   - the same for a leadership appointment; the leadership panel renders the appointment's own note;
 *   - the private correction text appears nowhere on the rendered admin list page, on the club's public page, or in the
 *     durable override payloads; no horizontal overflow at 390px.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { chromium, type Locator, type Page } from '@playwright/test';
import { checkIsolatedTestDsn, checkIsolatedTestServer, ISOLATED_SERVER_FACTS_SQL } from '@afldb/domain';

const [outDir, runTag = 'n1'] = process.argv.slice(2);
if (!outDir || existsSync(outDir)) throw new Error('usage: gap006-note-separation-visual.mts <new-output-dir> [run-tag] (dir must not exist)');
const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || checkIsolatedTestDsn(dsn, Number(process.env.AFLDB_V2_ISOLATED_PORT)).length) throw new Error('Isolated runner required');
const database = new URL(dsn).pathname.slice(1);
const sql = postgres(dsn, { max: 1, onnotice: () => {} });
const secret = createHash('sha256').update(process.env.AFLDB_TEST_AUTH_DATABASE_URL ?? '').digest('hex');
const baseURL = 'http://127.0.0.1:3912';
const REGISTRY = join(process.cwd(), '.next', 'standalone', 'data', 'reference', 'seasons.json');
const REGISTRY_BACKUP = join(outDir, '.registry-original.json.tmp');
const NAME = { entry: `Gapnote Entryson ${runTag}`, lead: `Gapnote Leadson ${runTag}` };
const PRIVATE = `PRIVATE-REASON-${runTag}`;
const CORRECTION = `${PRIVATE}: verified against the club-supplied squad sheet and the printed list.`;
const ENTRY_NOTE = `Entry note ${runTag}: listed as a rookie`;
const APPT_NOTE = `Appointment note ${runTag}: announced at the launch`;
const log: string[] = [];
const say = (line: string) => { log.push(line); console.log(line); };
const check = (ok: boolean, what: string) => { say(`${ok ? 'OK  ' : 'FAIL'} ${what}`); if (!ok) throw new Error(`Check failed: ${what}`); };

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
    await sql`INSERT INTO external_identities (source_id, external_id, player_id, status, match_method, notes)
              VALUES ((SELECT id FROM sources WHERE key = 'afltables'), ${`players/G/${slug}.html`}, ${row.id}, 'unique', 'afltables_profile_url', 'GAP-006 synthetic visual-evidence identity')`;
    return row.id;
  };
  const entryId = await makePlayer(NAME.entry);
  const leadId = await makePlayer(NAME.lead);
  const [club] = await sql<{ slug: string; name: string }[]>`SELECT slug, name FROM afldb_season_list_clubs(2027::smallint) ORDER BY name LIMIT 1`;
  if (!club) throw new Error('No 2027 list club in the disposable database');
  say(`fixtures: entry player=${entryId} lead player=${leadId}; list club=${club.slug}`);

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
  const overflowOf = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const pickPlayer = async (scope: Locator, label: string, name: string) => {
    await scope.getByRole('combobox', { name: label }).first().fill(name);
    await scope.page().getByRole('option', { name: new RegExp(name) }).first().click();
  };
  const listPath = `/admin/season-lists/2027/${club.slug}`;
  const bodyHasPrivate = async (page: Page) => (await page.content()).includes(PRIVATE) || (await page.locator('body').innerText()).includes(PRIVATE);

  // SYNTHETIC-REGISTRY: seal 2027 in the build copy only
  copyFileSync(REGISTRY, REGISTRY_BACKUP);
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  registry.in_progress_seasons = (registry.in_progress_seasons ?? []).filter((s: number) => s !== 2027);
  writeFileSync(REGISTRY, `${JSON.stringify(registry, null, 2)}\n`);
  registrySwapped = true;
  say('SYNTHETIC-REGISTRY in effect: 2027 sealed (the build copy of seasons.json only)');

  const desktop = await open({ width: 1280, height: 800 });
  const page = desktop.page;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // ---- list entry: add ---------------------------------------------------------------------
  const addPanel = () => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Add a player' }) }).first();
  const addFor = async (name: string) => {
    const panel = addPanel();
    await panel.scrollIntoViewIfNeeded();
    await pickPlayer(panel, 'Search players…', name);
    return {
      panel,
      entryBox: panel.getByLabel('List entry note'),
      correctionBox: panel.locator('#season-list-add-correction-note'),
      button: panel.getByRole('button', { name: /Add to the list/ }),
    };
  };
  const memberRow = async (playerId: number) => (await sql<{ note: string | null }[]>`SELECT note FROM season_list_members WHERE season = 2027 AND player_id = ${playerId}`);

  await page.goto(listPath, { waitUntil: 'networkidle' });
  let ui = await addFor(NAME.entry);
  await ui.entryBox.fill(ENTRY_NOTE);
  const editsBefore = await count('data_edits');
  await page.screenshot({ path: `${outDir}/01-add-form-two-note-fields__SYNTHETIC-REGISTRY__desktop.png`, fullPage: true });
  await ui.button.click();
  await page.getByText('is sealed historical data').first().waitFor();
  check((await memberRow(entryId)).length === 0 && await count('data_edits') === editsBefore,
    'SYNTHETIC-REGISTRY, entry note only: the add is refused (the entry note never satisfies the seal); nothing written');
  check((await ui.entryBox.inputValue()) === ENTRY_NOTE, 'the typed entry note is still in the form after the refusal');
  await page.screenshot({ path: `${outDir}/02-add-refused-entry-note-only__SYNTHETIC-REGISTRY__desktop.png`, fullPage: true });

  await ui.correctionBox.fill(CORRECTION);
  await ui.button.click();
  await page.waitForTimeout(3500);
  const rows = await memberRow(entryId);
  const [added] = await sql<{ note: string | null; adminUserId: number }[]>`
    SELECT note, admin_user_id AS "adminUserId" FROM data_edits WHERE table_name = 'players' AND row_id = ${entryId} AND field_group = 'season_list_added' ORDER BY id DESC LIMIT 1`;
  check(rows.length === 1 && rows[0].note === ENTRY_NOTE, 'both notes: the entry stores ONLY its own note');
  check(added?.note === CORRECTION && added.adminUserId === user.id, 'both notes: the audit row stores ONLY the correction note, bound to the actor');
  const [override] = await sql<{ v: string }[]>`SELECT override_values::text AS v FROM data_overrides WHERE entity_type = 'season_list_members' AND override_values->>'player_identity' LIKE ${`%/${NAME.entry.toLowerCase().replace(/\s+/g, '-')}.html`} ORDER BY id DESC LIMIT 1`;
  check(!!override && !override.v.includes(PRIVATE) && override.v.includes(ENTRY_NOTE), 'the durable override carries the entry note and never the correction text');
  await page.goto(listPath, { waitUntil: 'networkidle' });
  check(!(await bodyHasPrivate(page)), 'the rendered admin list page never shows the correction text');
  await page.screenshot({ path: `${outDir}/03-list-after-add-no-private-text__SYNTHETIC-REGISTRY__desktop.png`, fullPage: true });

  // ---- leadership appointment (needs the appointee on the list) -----------------------------
  ui = await addFor(NAME.lead);
  await ui.correctionBox.fill(CORRECTION);
  await ui.button.click();
  await page.waitForTimeout(3500);
  check((await memberRow(leadId)).length === 1, 'appointee added to the synthetic list (correction note only: the entry stores no note)');
  check((await memberRow(leadId))[0].note === null, 'a correction note alone leaves the entry note empty');
  await page.goto(listPath, { waitUntil: 'networkidle' });
  const appoint = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Appoint' }) }).first();
  await appoint.scrollIntoViewIfNeeded();
  await appoint.getByLabel('Player to appoint').selectOption({ label: NAME.lead });
  await appoint.getByLabel('Appointment note').fill(APPT_NOTE);
  const leadEdits = await count('data_edits');
  await appoint.getByRole('button', { name: 'Appoint', exact: true }).click();
  await page.getByText('is sealed historical data').first().waitFor();
  check(await count('data_edits') === leadEdits && (await sql`SELECT 1 FROM club_leadership WHERE player_id = ${leadId}`).length === 0,
    'SYNTHETIC-REGISTRY, appointment note only: refused, nothing written');
  await page.screenshot({ path: `${outDir}/04-appoint-refused-appointment-note-only__SYNTHETIC-REGISTRY__desktop.png`, fullPage: true });
  await appoint.locator('#leadership-appoint-note').fill(CORRECTION);
  await appoint.getByRole('button', { name: 'Appoint', exact: true }).click();
  await page.waitForTimeout(3500);
  const [appt] = await sql<{ note: string | null; id: number }[]>`SELECT note, id::int AS id FROM club_leadership WHERE player_id = ${leadId} AND season = 2027`;
  const [apptAudit] = await sql<{ note: string | null }[]>`SELECT note FROM data_edits WHERE table_name = 'club_leadership' AND row_id = ${appt?.id ?? 0} AND field_group = 'leadership_appointed' ORDER BY id DESC LIMIT 1`;
  check(appt?.note === APPT_NOTE, 'appointment: the row stores ONLY its own note');
  check(apptAudit?.note === CORRECTION, 'appointment: the audit row stores ONLY the correction note');
  await page.goto(listPath, { waitUntil: 'networkidle' });
  check((await page.locator('body').innerText()).includes(APPT_NOTE), 'the leadership panel renders the appointment\'s own note');
  check(!(await bodyHasPrivate(page)), 'the leadership panel and list page never show the correction text');
  await page.screenshot({ path: `${outDir}/05-leadership-shows-appointment-note-only__SYNTHETIC-REGISTRY__desktop.png`, fullPage: true });

  // ---- public page ---------------------------------------------------------------------------
  const publicResponse = await page.goto(`/clubs/${club.slug}`, { waitUntil: 'load' });
  check(!(await bodyHasPrivate(page)), `the club's public page (HTTP ${publicResponse?.status()}) never shows the correction text`);

  // ---- mobile --------------------------------------------------------------------------------
  const mobile = await open({ width: 390, height: 844 });
  await mobile.page.goto(listPath, { waitUntil: 'networkidle' });
  const overflow = await overflowOf(mobile.page);
  check(overflow <= 0 && !(await bodyHasPrivate(mobile.page)), `mobile 390px: no horizontal overflow (${overflow}px) and no correction text`);
  await mobile.page.screenshot({ path: `${outDir}/06-list-page__SYNTHETIC-REGISTRY__mobile.png`, fullPage: true });
  say(`pageErrors=${errors.length} blockedExternalRequests desktop=${desktop.blocked()} mobile=${mobile.blocked()}`);
  if (errors.length || desktop.blocked() || mobile.blocked()) throw new Error('Page errors or external requests');
  await desktop.context.close(); await mobile.context.close();
  say(`database=${database} baseURL=${baseURL}`);
} finally {
  if (registrySwapped) {
    copyFileSync(REGISTRY_BACKUP, REGISTRY);
    unlinkSync(REGISTRY_BACKUP);
    say('build copy of seasons.json restored from its backup');
  }
  if (existsSync(outDir)) writeFileSync(`${outDir}/capture-log.txt`, `${log.join('\n')}\n`, { flag: 'wx' });
  await browser.close(); await sql.end({ timeout: 5 });
}
