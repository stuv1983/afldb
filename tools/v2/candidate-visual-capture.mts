/**
 * Candidate recapture of the stale owner-review screens (D-V2-VISUAL-1, V2-GAP-022). Local only.
 *
 *   node node_modules/tsx/dist/cli.mjs tools/v2/candidate-visual-capture.mts <new-output-dir>
 *
 * Runs inside `isolated-pg.ts run <db>` against the V2 production build already serving on 127.0.0.1:3912
 * (tools/v2/local-release.mjs start v2) from the SAME disposable database. The output directory must not
 * exist: retained evidence (launchF-visual, local-visual, gap025-visual) is never overwritten. Fixture
 * sessions are local `@example.invalid` identities and are never printed. Statistical and audit history
 * are fingerprinted before and after; any change fails the run. External requests are blocked and counted.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import postgres from 'postgres';
import { chromium } from '@playwright/test';
import { checkIsolatedTestDsn, checkIsolatedTestServer, ISOLATED_SERVER_FACTS_SQL } from '@afldb/domain';

const [outDir] = process.argv.slice(2);
if (!outDir || existsSync(outDir)) throw new Error('usage: candidate-visual-capture.mts <new-output-dir> (must not exist)');
const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || checkIsolatedTestDsn(dsn, Number(process.env.AFLDB_V2_ISOLATED_PORT)).length) throw new Error('Isolated runner required');
const database = new URL(dsn).pathname.slice(1);
const sql = postgres(dsn, { max: 1, onnotice: () => {} });
const secret = createHash('sha256').update(process.env.AFLDB_TEST_AUTH_DATABASE_URL ?? '').digest('hex');
const baseURL = 'http://127.0.0.1:3912';
const VIEWPORTS = [{ width: 1280, height: 800, label: 'desktop-1280x800' }, { width: 390, height: 844, label: 'mobile-390x844' }];
// Names follow docs/v2/owner-visual-review-2026-10-29.md §2 (01, 02, 08, 09) and §3 item 9 (R1, R2: empty states).
const SCREENS: Record<string, [string, string][]> = {
  super_admin: [['01-operations', '/admin/operations'], ['08-brownlow', '/admin/operations/brownlow'],
    ['09-brownlow-2025', '/admin/operations/brownlow?season=2025'],
    ['R1-refusals', '/admin/operations/afl-api-refusals'], ['R2-findings', '/admin/operations/afl-api-refusals?section=findings']],
  admin: [['02-operations-admin', '/admin/operations']],
};
const browser = await chromium.launch({ headless: true });
const log: string[] = [];
try {
  const [facts] = await sql.unsafe(ISOLATED_SERVER_FACTS_SQL);
  if (checkIsolatedTestServer(database, { clusterName: facts.cluster_name, databaseComment: facts.database_comment,
    currentDatabase: facts.current_database }).length) throw new Error('Live identity proof failed');
  const fingerprint = async () => {
    const tables = ['brownlow_season_votes', 'brownlow_round_votes', 'brownlow_eligibility_decisions',
      'derived_award_results', 'derived_award_projections', 'award_proposals', 'award_proposal_decisions', 'data_edits', 'data_issues'];
    const values: Record<string, unknown> = {};
    for (const table of tables) {
      const [row] = await sql.unsafe(`SELECT count(*)::int AS rows, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS digest FROM ${table} t`);
      values[table] = row;
    }
    return values;
  };
  const before = await fingerprint();
  mkdirSync(outDir, { recursive: false });
  for (const viewport of VIEWPORTS) {
    for (const [role, screens] of Object.entries(SCREENS)) {
      const context = await browser.newContext({ baseURL, viewport: { width: viewport.width, height: viewport.height } });
      await context.addCookies([{ name: 'afldb_consent', value: 'declined', url: baseURL, sameSite: 'Lax' }]);
      let blocked = 0;
      await context.route('**/*', (route) => {
        if (new URL(route.request().url()).hostname !== '127.0.0.1') { blocked++; return route.abort(); }
        return route.continue();
      });
      const email = `candidate-visual-${role}@example.invalid`;
      let [user] = await sql`SELECT id,role FROM auth_users WHERE email=${email}`;
      if (!user) [user] = await sql`INSERT INTO auth_users(email,role) VALUES(${email},${role}) RETURNING id,role`;
      if (user.role !== role) throw new Error('Fixture identity has an unexpected role');
      await sql`UPDATE auth_users SET can_manage_admins=${role === 'super_admin'}, must_change_password=false WHERE id=${user.id}`;
      const token = randomBytes(32).toString('base64url');
      await sql`INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(${createHash('sha256').update(token).digest('hex')},${user.id},now()+interval '2 hours')`;
      const payload = Buffer.from(JSON.stringify({ v: 1, kind: 'admin', sub: `${user.id}:${token}`,
        exp: Math.floor(Date.now() / 1000) + 7200, epoch: 1 })).toString('base64url');
      await context.addCookies([{ name: 'afldb_admin', value: `${payload}.${createHmac('sha256', secret).update(Buffer.from(payload, 'base64url')).digest('base64url')}`,
        url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(60_000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      for (const [name, path] of screens) {
        errors.length = 0;
        const response = await page.goto(`${baseURL}${path}`, { waitUntil: 'networkidle' });
        const finalPath = new URL(page.url()).pathname + new URL(page.url()).search;
        const h1 = await page.locator('h1').first().textContent().catch(() => null);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const file = `${name}__${viewport.label}.png`;
        await page.screenshot({ path: `${outDir}/${file}`, fullPage: true });
        log.push(`${file} as=${role === 'super_admin' ? 'super' : 'admin'} status=${response?.status()} final=${finalPath} h1=${JSON.stringify(h1)} horizontalOverflowPx=${overflow} consoleErrors=${errors.length}`);
        if (response?.status() !== 200 || finalPath !== path) throw new Error(`Unexpected result: ${role} ${path}: ${response?.status()} ${finalPath}`);
      }
      log.push(`context ${viewport.label}/${role} blockedRequests=${blocked}`);
      if (blocked) throw new Error(`Blocked external requests=${blocked}`);
      await context.close();
    }
  }
  const after = await fingerprint();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Capture changed statistical or audit history');
  log.push(`database=${database} baseURL=${baseURL} history_fingerprint_unchanged=true`);
  console.log(`${log.filter((line) => line.includes('.png ')).length} captures written to ${outDir}`);
} finally {
  if (existsSync(outDir)) writeFileSync(`${outDir}/capture-log.txt`, `${log.join('\n')}\n`, { flag: 'wx' });
  await browser.close(); await sql.end({ timeout: 5 });
}
