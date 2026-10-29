/** Local browser/runtime evidence. Fixture sessions are local and never printed. */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import postgres from 'postgres';
import { chromium } from '@playwright/test';
import { checkIsolatedTestDsn, checkIsolatedTestServer, ISOLATED_SERVER_FACTS_SQL } from '@afldb/domain';

const [version, phase, out, capture] = process.argv.slice(2);
if (!['previous', 'v2'].includes(version) || !phase || !out) throw new Error('version phase output.json [capture] required');
const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || checkIsolatedTestDsn(dsn, Number(process.env.AFLDB_V2_ISOLATED_PORT)).length) throw new Error('Isolated runner required');
const database = new URL(dsn).pathname.slice(1);
const sql = postgres(dsn, { max: 1, onnotice: () => {} });
const secret = createHash('sha256').update(process.env.AFLDB_TEST_AUTH_DATABASE_URL ?? '').digest('hex');
const baseURL = `http://127.0.0.1:${version === 'previous' ? 3911 : 3912}`;
const browser = await chromium.launch({ headless: true });
const checks: object[] = [];
try {
  const [facts] = await sql.unsafe(ISOLATED_SERVER_FACTS_SQL);
  if (checkIsolatedTestServer(database, { clusterName: facts.cluster_name, databaseComment: facts.database_comment,
    currentDatabase: facts.current_database }).length) throw new Error('Live identity proof failed');
  const fingerprint = async () => {
    const tables = ['brownlow_season_votes', 'brownlow_round_votes', 'brownlow_eligibility_decisions',
      'derived_award_results', 'derived_award_projections', 'award_proposals', 'award_proposal_decisions', 'data_edits'];
    const values: Record<string, unknown> = {};
    for (const table of tables) {
      const [row] = await sql.unsafe(`SELECT count(*)::int AS rows, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS digest FROM ${table} t`);
      values[table] = row;
    }
    return values;
  };
  const before = await fingerprint();
  for (const role of ['anonymous', 'admin', 'super_admin']) {
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
    await context.addCookies([{ name: 'afldb_consent', value: 'declined', url: baseURL, sameSite: 'Lax' }]);
    let blocked = 0;
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).hostname !== '127.0.0.1') { blocked++; return route.abort(); }
      return route.continue();
    });
    if (role !== 'anonymous') {
      const email = `local-release-${role}@example.invalid`;
      let [user] = await sql`SELECT id,role FROM auth_users WHERE email=${email}`;
      if (!user) [user] = await sql`INSERT INTO auth_users(email,role) VALUES(${email},${role}) RETURNING id,role`;
      if (user.role !== role) throw new Error('Fixture identity has an unexpected role');
      await sql`UPDATE auth_users SET can_manage_admins=${role === 'super_admin'}, must_change_password=false WHERE id=${user.id}`;
      const token = randomBytes(32).toString('base64url');
      await sql`INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(${createHash('sha256').update(token).digest('hex')},${user.id},now()+interval '2 hours')`;
      const payload = Buffer.from(JSON.stringify({ v: 1, kind: 'admin', sub: `${user.id}:${token}`,
        exp: Math.floor(Date.now()/1000)+7200, epoch: 1 })).toString('base64url');
      await context.addCookies([{ name: 'afldb_admin', value: `${payload}.${createHmac('sha256',secret).update(Buffer.from(payload, 'base64url')).digest('base64url')}`,
        url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
    }
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(60_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const [player] = await sql`SELECT id, slug FROM players ORDER BY id LIMIT 1`;
    const [match] = await sql`SELECT id FROM matches ORDER BY season DESC, id DESC LIMIT 1`;
    if (!player || !match) throw new Error('Historical public-route inputs are required');
    const routes = role === 'anonymous' ? ['/', '/brownlow', '/brownlow/2025', '/awards/coleman', '/seasons/2025', '/search?q=Tony+Lockett',
      `/players/${player.slug}-${player.id}`, `/matches/${match.id}`, '/clubs/adelaide', '/admin',
      ...(version === 'v2' ? ['/awards/brownlow-medal', '/awards/brownlow-medal/2025'] : [])]
      : ['/admin', '/admin/current-season', '/admin/admins', '/admin/settings', ...(version === 'v2' ? ['/admin/operations', '/admin/operations/brownlow?season=2025'] : [])];
    for (const path of routes) {
      const canonicalRedirect = path === '/awards/brownlow-medal' ? '/brownlow'
        : path === '/awards/brownlow-medal/2025' ? '/brownlow/2025' : null;
      if (canonicalRedirect) {
        const direct = await context.request.get(`${baseURL}${path}`, { maxRedirects: 0 });
        if (direct.status() !== 308 || direct.headers().location !== canonicalRedirect) throw new Error('Legacy Brownlow URL did not permanently redirect');
      }
      const response = await page.goto(`${baseURL}${path}`, { waitUntil: 'domcontentloaded' });
      const finalPath = new URL(page.url()).pathname;
      const expectedDenial = role === 'anonymous' && path === '/admin'
        || role === 'admin' && ['/admin/settings', '/admin/current-season'].includes(path);
      if (expectedDenial ? finalPath === path : response?.status() !== 200 || finalPath !== (canonicalRedirect ?? path.split('?')[0])) {
        throw new Error(`Unexpected runtime result: ${role} ${path}: ${response?.status()} ${finalPath}`);
      }
      checks.push({ role, path, status: response?.status(), finalPath, h1: await page.locator('h1').first().textContent().catch(() => null) });
    }
    if (capture && version === 'v2' && role === 'super_admin') {
      mkdirSync('docs/v2/evidence/local-visual', { recursive: true });
      for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        for (const [name, path] of [['08-brownlow','/admin/operations/brownlow'], ['09-brownlow-2025','/admin/operations/brownlow?season=2025']]) {
          await page.goto(`${baseURL}${path}`, { waitUntil: 'domcontentloaded' });
          await page.screenshot({ path: `docs/v2/evidence/local-visual/${name}__${viewport.width}.png`, fullPage: true });
        }
      }
    }
    if (errors.length || blocked) throw new Error(`Browser errors=${errors.length}; blocked external requests=${blocked}`);
    await context.close();
  }
  const after = await fingerprint();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Runtime checks changed statistical or audit history');
  writeFileSync(out, `${JSON.stringify({ version, phase, database, baseURL, checks, before, after,
    auditPreserved: true, externalRequests: 0 }, null, 2)}\n`, { flag: 'wx' });
  console.log(`${phase}: ${checks.length} route/permission checks PASS; statistical and audit fingerprints unchanged`);
} finally { await browser.close(); await sql.end({ timeout: 5 }); }
