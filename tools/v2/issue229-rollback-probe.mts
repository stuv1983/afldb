/**
 * ISSUE-229 / migration 118 rollback-compatibility probe. Local only; behaviour, not health.
 *
 *   node node_modules/tsx/dist/cli.mjs tools/v2/issue229-rollback-probe.mts <label> <base-url> <new-output-dir> [--mutate]
 *
 * Run inside `isolated-pg.ts run <db> -- ...` against an app (any revision) served on 127.0.0.1 from the
 * SAME disposable database. It drives a headless Chromium with a local admin session and records, for every
 * probed URL, the HTTP status, whether the page rendered an application error, and a few visible facts. With
 * `--mutate` it creates one MANUAL fixture through the real admin form (a round that holds no provider row)
 * and reads the row back, to prove the old or new code can still write beside provider rows. It never
 * touches provider-owned rows. The report is JSON; the output directory must not exist.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { chromium } from '@playwright/test';
import { checkIsolatedTestDsn, checkIsolatedTestServer, ISOLATED_SERVER_FACTS_SQL } from '@afldb/domain';

const [label, baseURL, outDir, flag] = process.argv.slice(2);
if (!label || !baseURL || !outDir || existsSync(outDir)) throw new Error('usage: issue229-rollback-probe.mts <label> <base-url> <new-output-dir> [--mutate]');
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL)) throw new Error('base url must be loopback');
const mutate = flag === '--mutate';
const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || checkIsolatedTestDsn(dsn, Number(process.env.AFLDB_V2_ISOLATED_PORT)).length) throw new Error('Isolated runner required');
const database = new URL(dsn).pathname.slice(1);
const sql = postgres(dsn, { max: 1, onnotice: () => {} });
const secret = createHash('sha256').update(process.env.AFLDB_TEST_AUTH_DATABASE_URL ?? '').digest('hex');
const SEASON = 2027;

const browser = await chromium.launch({ headless: true });
try {
  const [facts] = await sql.unsafe(ISOLATED_SERVER_FACTS_SQL);
  if (checkIsolatedTestServer(database, { clusterName: facts.cluster_name, databaseComment: facts.database_comment,
    currentDatabase: facts.current_database }).length) throw new Error('Live identity proof failed');
  mkdirSync(outDir, { recursive: false });
  const counts = async () => (await sql<Record<string, number>[]>`
    SELECT (SELECT count(*)::int FROM afldb_meta.schema_migrations) AS schema,
           (SELECT count(*)::int FROM fixtures WHERE season = ${SEASON}) AS fixtures2027,
           (SELECT count(*)::int FROM fixtures WHERE season = ${SEASON} AND confirmation = 'unconfirmed') AS unconfirmed,
           (SELECT count(*)::int FROM fixtures WHERE season = ${SEASON} AND (home_club_id IS NULL OR away_club_id IS NULL)) AS labels,
           (SELECT count(*)::int FROM matches) AS matches, (SELECT count(*)::int FROM clubs) AS clubs`)[0];
  const before = await counts();

  const email = `issue229-probe-${label}@example.invalid`;
  let [user] = await sql`SELECT id FROM auth_users WHERE email = ${email}`;
  if (!user) [user] = await sql`INSERT INTO auth_users(email, role) VALUES(${email}, 'super_admin') RETURNING id`;
  await sql`UPDATE auth_users SET can_manage_admins = true, must_change_password = false WHERE id = ${user.id}`;
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
  await context.addCookies([{ name: 'afldb_consent', value: 'declined', url: baseURL, sameSite: 'Lax' }]);
  const blocked: string[] = [];
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { blocked.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const token = randomBytes(32).toString('base64url');
  await sql`INSERT INTO auth_sessions(token_hash, user_id, expires_at) VALUES(${createHash('sha256').update(token).digest('hex')}, ${user.id}, now() + interval '2 hours')`;
  const payload = Buffer.from(JSON.stringify({ v: 1, kind: 'admin', sub: `${user.id}:${token}`, exp: Math.floor(Date.now() / 1000) + 7200, epoch: 1 })).toString('base64url');
  await context.addCookies([{ name: 'afldb_admin', value: `${payload}.${createHmac('sha256', secret).update(Buffer.from(payload, 'base64url')).digest('base64url')}`, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(60_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const pick = async (where: string) => (await sql.unsafe(`SELECT fixture_key AS k FROM fixtures WHERE season = ${SEASON} AND ${where} ORDER BY id LIMIT 1`))[0]?.k as string | undefined;
  const labelKey = await pick('home_club_id IS NULL OR away_club_id IS NULL');
  const unconfirmedKey = await pick("confirmation = 'unconfirmed' AND home_club_id IS NOT NULL AND away_club_id IS NOT NULL");
  const confirmedKey = await pick("confirmation = 'confirmed'");
  const [player] = await sql<{ slug: string; id: number }[]>`SELECT slug, id::int AS id FROM players ORDER BY id LIMIT 1`;
  const [match] = await sql<{ id: number }[]>`SELECT id::int AS id FROM matches ORDER BY id DESC LIMIT 1`;
  const [club] = await sql<{ slug: string }[]>`SELECT slug FROM clubs ORDER BY id LIMIT 1`;
  const urls: [string, string][] = [
    ['public home', '/'], ['public season 2026', '/seasons/2026'], ['public players', '/players'],
    ['public player', `/players/${player.slug}-${player.id}`], ['public match', `/matches/${match.id}`], ['public clubs', '/clubs'], ['public club', `/clubs/${club.slug}`],
    ['public venues', '/venues'], ['public records', '/records'],
    ['admin fixtures index', '/admin/fixtures'], ['admin 2027 list', `/admin/fixtures/${SEASON}`],
    ['admin 2026 list', '/admin/fixtures/2026'], ['admin new fixture', `/admin/fixtures/${SEASON}/new`],
    ['admin data editor', '/admin/data-editor'], ['admin audit', '/admin/audit'],
  ];
  if (confirmedKey) urls.push(['admin detail: confirmed provider row', `/admin/fixtures/${SEASON}/${confirmedKey}`]);
  if (unconfirmedKey) urls.push(['admin detail: unconfirmed real-club row', `/admin/fixtures/${SEASON}/${unconfirmedKey}`]);
  if (labelKey) urls.push(['admin detail: label row', `/admin/fixtures/${SEASON}/${labelKey}`]);

  const results: Record<string, unknown>[] = [];
  for (const [name, path] of urls) {
    pageErrors.length = 0;
    const response = await page.goto(path, { waitUntil: 'networkidle' }).catch((e) => { results.push({ name, path, error: String(e).slice(0, 160) }); return null; });
    if (!response) continue;
    const body = (await page.locator('body').innerText().catch(() => '')) || '';
    const rows = path === `/admin/fixtures/${SEASON}` ? await page.locator('table tbody tr').count() : undefined;
    results.push({
      name, path, status: response.status(),
      applicationError: /Application error|Internal Server Error|This page couldn.t load|Something went wrong/i.test(body),
      pageErrors: pageErrors.length, ...(rows === undefined ? {} : { listedRows: rows }),
      heading: (await page.locator('h1').first().innerText().catch(() => '')).slice(0, 80),
    });
    if (name.startsWith('admin')) await page.screenshot({ path: `${outDir}/${name.replace(/[^a-z0-9]+/gi, '-')}.png`, fullPage: false });
  }

  let mutation: Record<string, unknown> | null = null;
  let mutationBefore = 0;
  if (mutate) {
    const roundNumber = 30;
    await page.goto(`/admin/fixtures/${SEASON}/new`, { waitUntil: 'networkidle' });
    await page.selectOption('select[name="roundType"]', 'home_and_away');
    await page.fill('input[name="roundNumber"]', String(roundNumber));
    const opts = await page.locator('select[name="homeClubId"] option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    // A pair no earlier probe used in round 30 (a repeated pair is a duplicate_fixture refusal, not a create).
    const used = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM fixtures WHERE season = ${SEASON} AND round_code = ${String(roundNumber)}`)[0].n;
    await page.selectOption('select[name="homeClubId"]', opts[2 * used]);
    await page.selectOption('select[name="awayClubId"]', opts[2 * used + 1]);
    mutationBefore = used;
    await page.getByRole('button', { name: 'Create fixture' }).click();
    await page.getByRole('status').filter({ hasText: /./ }).first().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const [row] = await sql<Record<string, unknown>[]>`
      SELECT f.fixture_key, f.round_code, f.confirmation, s.key AS source FROM fixtures f JOIN sources s ON s.id = f.source_id
       WHERE f.season = ${SEASON} AND f.round_code = ${String(roundNumber)} ORDER BY f.id DESC LIMIT 1`;
    const nowCount = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM fixtures WHERE season = ${SEASON} AND round_code = ${String(roundNumber)}`)[0].n;
    mutation = { created: nowCount === mutationBefore + 1, round30Before: mutationBefore, round30After: nowCount, row: row ?? null };
    if (row) {
      await page.goto(`/admin/fixtures/${SEASON}/${row.fixture_key}`, { waitUntil: 'networkidle' });
      mutation.detailHeading = (await page.locator('h1').first().innerText()).slice(0, 80);
      await page.screenshot({ path: `${outDir}/manual-create-detail.png` });
    }
  }

  const after = await counts();
  const bad = results.filter((r) => r.error || (typeof r.status === 'number' && r.status >= 500) || r.applicationError);
  const report = { label, baseURL, database, before, after, results, mutation, externalRequestsBlocked: blocked.length, serverErrorsOrApplicationErrors: bad.length };
  writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
  for (const r of results) console.log(`${String(r.status ?? 'ERR').padEnd(4)} ${String(r.name).padEnd(40)} ${r.applicationError ? 'APPLICATION ERROR ' : ''}${r.listedRows !== undefined ? `rows=${r.listedRows} ` : ''}${r.heading ?? r.error ?? ''}`);
  console.log(`before=${JSON.stringify(before)}\nafter=${JSON.stringify(after)}\nmutation=${JSON.stringify(mutation)}\nbad=${bad.length}`);
  if (bad.length || (mutate && !(mutation as Record<string, unknown> | null)?.created)) process.exitCode = 1;
} finally {
  await browser.close();
  await sql.end({ timeout: 5 });
}
