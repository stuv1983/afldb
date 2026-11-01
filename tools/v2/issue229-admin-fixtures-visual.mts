/**
 * Visual evidence for the ISSUE-229 admin fixture list (unconfirmed and label fixtures) and the L1 refusal. Local only.
 *
 *   node node_modules/tsx/dist/cli.mjs tools/v2/issue229-admin-fixtures-visual.mts <new-output-dir>
 *
 * Run inside `isolated-pg.ts run <db> -- ...` against a production build served on 127.0.0.1:3912
 * (`tools/v2/local-release.mjs start v2`) from the SAME disposable database, which must already carry the
 * retained 2027 feed (`tools/v2/issue229-retained-feed-proof.ts --mode apply`). Headless Chromium at a desktop
 * (1280x800) and a mobile (390x844) viewport. The output directory must not exist (evidence is never
 * overwritten). The session is a local `@example.invalid` identity; no token is printed. External requests are
 * blocked and counted. Every claim below is read back from the DOM and the database, not assumed.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { chromium, type Page } from '@playwright/test';
import { checkIsolatedTestDsn, checkIsolatedTestServer, ISOLATED_SERVER_FACTS_SQL } from '@afldb/domain';

const [outDir] = process.argv.slice(2);
if (!outDir || existsSync(outDir)) throw new Error('usage: issue229-admin-fixtures-visual.mts <new-output-dir> (must not exist)');
const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || checkIsolatedTestDsn(dsn, Number(process.env.AFLDB_V2_ISOLATED_PORT)).length) throw new Error('Isolated runner required');
const database = new URL(dsn).pathname.slice(1);
const sql = postgres(dsn, { max: 1, onnotice: () => {} });
const secret = createHash('sha256').update(process.env.AFLDB_TEST_AUTH_DATABASE_URL ?? '').digest('hex');
const baseURL = 'http://127.0.0.1:3912';
const SEASON = 2027;
const lines: string[] = [];
const checks: { name: string; pass: boolean; detail?: string }[] = [];
const say = (line: string) => { lines.push(line); console.log(line); };
const check = (name: string, pass: boolean, detail?: string) => {
  checks.push({ name, pass, detail });
  say(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
};

const browser = await chromium.launch({ headless: true });
try {
  const [facts] = await sql.unsafe(ISOLATED_SERVER_FACTS_SQL);
  if (checkIsolatedTestServer(database, { clusterName: facts.cluster_name, databaseComment: facts.database_comment,
    currentDatabase: facts.current_database }).length) throw new Error('Live identity proof failed');
  mkdirSync(outDir, { recursive: false });

  const [{ n: schema }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM afldb_meta.schema_migrations`;
  const [db] = await sql<Record<string, number>[]>`
    SELECT count(*)::int AS total,
           (count(*) FILTER (WHERE confirmation = 'confirmed'))::int AS confirmed,
           (count(*) FILTER (WHERE confirmation = 'unconfirmed'))::int AS unconfirmed,
           (count(*) FILTER (WHERE home_club_id IS NULL OR away_club_id IS NULL))::int AS labels,
           (count(*) FILTER (WHERE venue_id IS NULL AND venue_raw IS NULL))::int AS "venueTbc"
      FROM fixtures WHERE season = ${SEASON}`;
  say(`database=${database} schemaLedger=${schema} fixtures${SEASON}=${JSON.stringify(db)}`);
  if (db.total !== 218) throw new Error('The retained 2027 feed is not applied (expected 218 fixtures)');

  const email = 'issue229-visual-super_admin@example.invalid';
  let [user] = await sql`SELECT id, role FROM auth_users WHERE email = ${email}`;
  if (!user) [user] = await sql`INSERT INTO auth_users(email, role) VALUES(${email}, 'super_admin') RETURNING id, role`;
  await sql`UPDATE auth_users SET can_manage_admins = true, must_change_password = false WHERE id = ${user.id}`;

  const open = async (viewport: { width: number; height: number }) => {
    const context = await browser.newContext({ baseURL, viewport });
    await context.addCookies([{ name: 'afldb_consent', value: 'declined', url: baseURL, sameSite: 'Lax' }]);
    const blocked: string[] = [];
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).hostname !== '127.0.0.1') { blocked.push(route.request().url()); return route.abort(); }
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
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    return { context, page, blocked, errors };
  };

  const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  // A round that really carries label slots: the L1 scenario is run against it.
  const [slotRound] = await sql<{ roundCode: string; roundType: string; n: number }[]>`
    SELECT round_code AS "roundCode", round_type::text AS "roundType", count(*)::int AS n FROM fixtures
     WHERE season = ${SEASON} AND (home_club_id IS NULL OR away_club_id IS NULL)
     GROUP BY round_code, round_type ORDER BY count(*) DESC, round_code LIMIT 1`;
  say(`label-slot round: ${JSON.stringify(slotRound)}`);

  for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]] as const) {
    const { page, blocked, errors } = await open(viewport);
    say(`---- ${label} ${viewport.width}x${viewport.height}`);
    const visible = (selector: string) => page.locator(selector).evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).length);

    // 1. season index counts
    await page.goto('/admin/fixtures', { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${outDir}/01-fixtures-index__${label}.png`, fullPage: true });
    check(`${label}: index loads, no page error`, errors.length === 0, errors.join('; '));

    // 2. the 2027 list, whole
    await page.goto(`/admin/fixtures/${SEASON}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${outDir}/02-list-2027-top__${label}.png` });
    await page.screenshot({ path: `${outDir}/03-list-2027-full__${label}.png`, fullPage: true });
    const unconfirmedBadges = await visible('[data-confirmation="unconfirmed"]');
    const confirmedBadges = await visible('[data-confirmation="confirmed"]');
    check(`${label}: ${db.unconfirmed} unconfirmed and ${db.confirmed} confirmed fixtures are each shown with a visible state`,
      unconfirmedBadges === db.unconfirmed && confirmedBadges === db.confirmed, `unconfirmed=${unconfirmedBadges} confirmed=${confirmedBadges}`);
    const tbcParticipants = await visible('[data-participant="tbc"]');
    check(`${label}: label participants render as TBC (${db.labels} fixtures, up to 2 sides each)`, tbcParticipants >= db.labels, `visible tbc participant cells=${tbcParticipants}`);
    const text = await page.locator('main, body').first().innerText();
    check(`${label}: a label is shown only inside "TBC (...)", never as a bare team name`,
      !/\b(Winner of QF1|Lowest-ranked WF Winner)\b/.test(text.replace(/TBC \([^)]*\)/g, '')), '');
    // The round that carries the label slots, as its own readable image (the full page is too tall to review).
    const slotHeading = { elimination_final: 'Elimination Final', qualifying_final: 'Qualifying Final', semi_final: 'Semi Final', preliminary_final: 'Preliminary Final', wildcard_final: 'Wildcard Final', grand_final: 'Grand Final' }[slotRound.roundType] ?? slotRound.roundType;
    const slotSection = page.locator('section.section').filter({ has: page.getByRole('heading', { name: slotHeading, exact: true }) }).first();
    await slotSection.scrollIntoViewIfNeeded();
    await slotSection.screenshot({ path: `${outDir}/03b-label-round-section__${label}.png` });
    check(`${label}: the label round section is shown with TBC participants and an Unconfirmed state`,
      (await slotSection.locator('[data-participant="tbc"]').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).length)) >= 2
      && (await slotSection.locator('[data-confirmation="unconfirmed"]').count()) >= 2, slotHeading);
    check(`${label}: no horizontal overflow on the list`, (await overflow(page)) <= 0, `overflowPx=${await overflow(page)}`);

    // 3. unconfirmed-only filter: every visible row is unconfirmed and has a TBC date
    await page.goto(`/admin/fixtures/${SEASON}?confirmation=unconfirmed`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${outDir}/04-filter-unconfirmed__${label}.png`, fullPage: true });
    const filteredUnconfirmed = await visible('[data-confirmation="unconfirmed"]');
    const filteredConfirmed = await visible('[data-confirmation="confirmed"]');
    check(`${label}: confirmation=unconfirmed lists only unconfirmed fixtures`, filteredUnconfirmed === db.unconfirmed && filteredConfirmed === 0, `unconfirmed=${filteredUnconfirmed} confirmed=${filteredConfirmed}`);
    const tableDates = await page.locator('table tbody tr td:first-child').evaluateAll((cells) => cells.filter((c) => (c as HTMLElement).offsetParent !== null).map((c) => (c as HTMLElement).innerText.trim()));
    const cardDates = await page.locator('.admin-card-fields dd').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null && /^Date:|^\d{4}-\d{2}-\d{2}/.test((e as HTMLElement).innerText.trim())).map((e) => (e as HTMLElement).innerText.trim()));
    const dates = [...tableDates, ...cardDates];
    check(`${label}: every unconfirmed fixture shows its date as TBC, none a provisional timestamp`,
      dates.length > 0 && dates.every((d) => d === 'Date: TBC'), `rows=${dates.length} nonTBC=${dates.filter((d) => d !== 'Date: TBC').length}`);

    // 4. confirmed-only filter
    await page.goto(`/admin/fixtures/${SEASON}?confirmation=confirmed`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${outDir}/05-filter-confirmed__${label}.png` });
    const confUnc = await visible('[data-confirmation="unconfirmed"]');
    const confConf = await visible('[data-confirmation="confirmed"]');
    check(`${label}: confirmation=confirmed lists only confirmed fixtures`, confUnc === 0 && confConf === db.confirmed, `unconfirmed=${confUnc} confirmed=${confConf}`);

    // 5. detail pages: a label fixture, an unconfirmed real-club fixture, a confirmed provider fixture
    const pick = async (where: string) => (await sql.unsafe(`SELECT fixture_key AS k FROM fixtures WHERE season = ${SEASON} AND ${where} ORDER BY id LIMIT 1`))[0]?.k as string | undefined;
    const keys: [string, string | undefined][] = [
      ['06-detail-label-fixture', await pick('home_club_id IS NULL OR away_club_id IS NULL')],
      ['07-detail-unconfirmed-real-clubs', await pick("confirmation = 'unconfirmed' AND home_club_id IS NOT NULL AND away_club_id IS NOT NULL")],
      ['08-detail-confirmed-provider', await pick("confirmation = 'confirmed'")],
    ];
    for (const [name, key] of keys) {
      if (!key) { check(`${label}: ${name} has a sample`, false, 'none'); continue; }
      errors.length = 0;
      const response = await page.goto(`/admin/fixtures/${SEASON}/${key}`, { waitUntil: 'networkidle' });
      await page.screenshot({ path: `${outDir}/${name}__${label}.png`, fullPage: true });
      const body = await page.locator('main, body').first().innerText();
      const panels = await page.locator('form').count();
      check(`${label}: ${name} renders (200), read-only for a provider-managed row, no page error`, response?.status() === 200 && errors.length === 0 && panels <= 1,
        `status=${response?.status()} forms=${panels} providerNote=${/managed by the fixture importer/.test(body)}`);
      check(`${label}: ${name} shows TBC date/time when unconfirmed`, name.includes('confirmed-provider') || /TBC/.test(body), '');
    }

    // 6. L1: a manual final beside the provider's label slots is refused in the UI, and nothing is written
    const manualBefore = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM fixtures WHERE season = ${SEASON} AND source_id = (SELECT id FROM sources WHERE key = 'manual_admin_edit')`)[0].n;
    await page.goto(`/admin/fixtures/${SEASON}/new`, { waitUntil: 'networkidle' });
    await page.selectOption('select[name="roundType"]', slotRound.roundType);
    const clubOptions = await page.locator('select[name="homeClubId"] option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    await page.selectOption('select[name="homeClubId"]', clubOptions[0]);
    await page.selectOption('select[name="awayClubId"]', clubOptions[1]);
    await page.screenshot({ path: `${outDir}/09-l1-form-filled__${label}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Create fixture' }).click();
    await page.getByRole('alert').filter({ hasText: 'provider-managed' }).first().waitFor({ timeout: 30_000 });
    await page.screenshot({ path: `${outDir}/10-l1-refusal__${label}.png`, fullPage: true });
    const refusal = await page.getByRole('alert').filter({ hasText: 'provider-managed' }).first().innerText();
    const manualAfter = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM fixtures WHERE season = ${SEASON} AND source_id = (SELECT id FROM sources WHERE key = 'manual_admin_edit')`)[0].n;
    check(`${label}: L1 manual final beside a provider label slot is refused in the UI, nothing written`, manualAfter === manualBefore && /read-only here/.test(refusal),
      `manualRows ${manualBefore}->${manualAfter}; "${refusal.slice(0, 110)}"`);
    check(`${label}: no external request was made`, blocked.length === 0, blocked.join(', '));
    check(`${label}: no horizontal overflow on the new-fixture page`, (await overflow(page)) <= 0, `overflowPx=${await overflow(page)}`);
  }

  const failed = checks.filter((c) => !c.pass);
  writeFileSync(`${outDir}/report.json`, JSON.stringify({ database, schemaLedger: schema, fixtures2027: db, checks, failed: failed.length }, null, 2));
  writeFileSync(`${outDir}/log.txt`, lines.join('\n') + '\n');
  say(`SUMMARY ${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exitCode = 1;
} finally {
  await browser.close();
  await sql.end({ timeout: 5 });
}
