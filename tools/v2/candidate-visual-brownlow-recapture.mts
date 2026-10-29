/**
 * Recapture, on the CORRECTED candidate, of the seven Brownlow season images the owner sheet marks † (09, S06, S04,
 * B6, B7, B8, B9): they came from candidate 592c6c16 and predate the raw-totals label fix in BrownlowViews.tsx.
 * Local only; the successor of candidate-visual-corrected.mts for those states, which stays unchanged.
 *
 *   node node_modules/tsx/dist/cli.mjs tools/v2/candidate-visual-brownlow-recapture.mts <new-output-dir> [--recheck]
 *
 * `--recheck` runs after the full run: it verifies the full run's recorded decision, recaptures D04 with the
 * corrected no-winner check, and recaptures B6/B7 on a REVERSIBLE fixture (another season's leader, cleared and then
 * restored byte for byte), because the full run's season now carries its decision. It records no decision.
 *
 * Runs inside `isolated-pg.ts run afldb_v2_visual_leaderboard_test` against the V2 production build serving on
 * 127.0.0.1:3912 from the SAME disposable database. It refuses any other database, any build other than
 * XtSgl4BOQZXC2G8qIWJdV, a server that does not serve that build, and a bundle whose reference files differ from the
 * repository. Nothing in the build output is touched.
 *
 * 2023 (the season of B6-B9) already carries pass 2's synthetic decision, so the requires_review flow runs on an
 * EQUIVALENT record: the single, eligible, undecided leader of another season, whose `eligible_rank` is cleared
 * (exactly the pass-2 fixture). The refused decision writes nothing; the synthetic INELIGIBLE ruling is a real,
 * append-only decision and persists, as in pass 2. Every fixture and test action is a named step whose expected
 * effect is logged next to the observed per-table change. External requests are blocked and counted. Fixture
 * sessions are local `@example.invalid` identities and are never printed.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { chromium } from '@playwright/test';
import { checkIsolatedTestDsn, checkIsolatedTestServer, ISOLATED_SERVER_FACTS_SQL } from '@afldb/domain';

const [outDir, mode] = process.argv.slice(2);
const recheck = mode === '--recheck';
if (!outDir || existsSync(outDir)) throw new Error('usage: candidate-visual-brownlow-recapture.mts <new-output-dir> (must not exist)');
const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || checkIsolatedTestDsn(dsn, Number(process.env.AFLDB_V2_ISOLATED_PORT)).length) throw new Error('Isolated runner required');
const database = new URL(dsn).pathname.slice(1);
if (database !== 'afldb_v2_visual_leaderboard_test') throw new Error('This run mutates its target: only afldb_v2_visual_leaderboard_test is approved');
const sql = postgres(dsn, { max: 1, onnotice: () => {} });
const secret = createHash('sha256').update(process.env.AFLDB_TEST_AUTH_DATABASE_URL ?? '').digest('hex');
const baseURL = 'http://127.0.0.1:3912';
const BUILD_ID = 'XtSgl4BOQZXC2G8qIWJdV';
const DESKTOP = { width: 1280, height: 800, label: 'desktop-1280x800' };
const MOBILE = { width: 390, height: 844, label: 'mobile-390x844' };
const REFERENCE = ['seasons.json', 'coleman-derivation.json', 'afl-api-identities.json'];
const HISTORY = ['award_proposals', 'award_proposal_decisions', 'award_winners', 'derived_award_results',
  'derived_award_projections', 'brownlow_season_votes', 'brownlow_round_votes', 'brownlow_eligibility_decisions',
  'data_edits', 'data_issues', 'data_submissions', 'data_submission_rows', 'staging.source_records',
  'staging.source_record_versions', 'staging.afl_api_brownlow_vote'];
/** Seasons this run must not use for the fixture: decided (2023, 2024), the 1996 tie, and L-1's 2022 leader. */
const RESERVED = [1996, 2022, 2023, 2024];
type Role = 'super_admin' | 'admin';
/** `noWinner`: the winner line always renders (BrownlowDeterminationViews.tsx); with no winner it reads "none stated". */
type Checks = { present?: string[]; absent?: string[]; text?: string[]; forbid?: string[]; status?: number; noWinner?: boolean };

const log: string[] = [];
const failures: string[] = [];
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

async function fingerprint(): Promise<Record<string, { rows: number; digest: string }>> {
  const values: Record<string, { rows: number; digest: string }> = {};
  for (const table of HISTORY) {
    const [row] = await sql.unsafe(`SELECT count(*)::int AS rows, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS digest FROM ${table} t`);
    values[table] = { rows: row.rows, digest: row.digest };
  }
  return values;
}
function delta(before: Awaited<ReturnType<typeof fingerprint>>, after: Awaited<ReturnType<typeof fingerprint>>): string[] {
  return HISTORY.filter((t) => before[t].digest !== after[t].digest)
    .map((t) => `${t}:${after[t].rows - before[t].rows >= 0 ? '+' : ''}${after[t].rows - before[t].rows}rows${after[t].rows === before[t].rows ? '(changed)' : ''}`);
}

/** One named fixture or test action: its expected effect is logged with what actually changed. */
async function step(id: string, expected: string, expectTables: string[], work: () => Promise<void>): Promise<void> {
  const before = await fingerprint();
  try {
    await work();
  } catch (error) {
    // A failed state is reported, never hidden; the run continues so every other state is still captured.
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    log.push(`STEP ${id} ERROR ${message}`);
    failures.push(`step ${id}: ERROR ${message}`);
  }
  const observed = delta(before, await fingerprint());
  const changed = observed.map((entry) => entry.split(':')[0]).sort();
  const match = JSON.stringify(changed) === JSON.stringify([...expectTables].sort());
  log.push(`STEP ${id} expected="${expected}" expectedTables=[${expectTables.join(',')}] observed=[${observed.join(',') || 'no change'}] match=${match}`);
  if (!match) failures.push(`step ${id}: expected [${expectTables.join(',')}], observed [${observed.join(',')}]`);
}

async function signIn(role: Role) {
  const context = await browser.newContext({ baseURL, viewport: { width: DESKTOP.width, height: DESKTOP.height } });
  await context.addCookies([{ name: 'afldb_consent', value: 'declined', url: baseURL, sameSite: 'Lax' }]);
  const counter = { blocked: 0 };
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { counter.blocked++; return route.abort(); }
    return route.continue();
  });
  const email = `candidate-visual-${role}@example.invalid`;
  const [user] = await sql`SELECT id,role FROM auth_users WHERE email=${email}`;
  if (!user || user.role !== role) throw new Error('Fixture identity missing or has an unexpected role');
  const token = randomBytes(32).toString('base64url');
  await sql`INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(${createHash('sha256').update(token).digest('hex')},${user.id},now()+interval '4 hours')`;
  const payload = Buffer.from(JSON.stringify({ v: 1, kind: 'admin', sub: `${user.id}:${token}`,
    exp: Math.floor(Date.now() / 1000) + 14400, epoch: 1 })).toString('base64url');
  await context.addCookies([{ name: 'afldb_admin', value: `${payload}.${createHmac('sha256', secret).update(Buffer.from(payload, 'base64url')).digest('base64url')}`,
    url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(60_000);
  page.setDefaultTimeout(30_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', (dialog) => { log.push(`dialog ${role} "${dialog.message().slice(0, 120)}" accepted`); void dialog.accept(); });
  return { role, context, page, errors, counter };
}
type Session = Awaited<ReturnType<typeof signIn>>;

/** Screenshot the CURRENT page state (no navigation) at one viewport, with its checks. */
async function shoot(s: Session, name: string, viewport: typeof DESKTOP, checks: Checks, status: number | null) {
  await s.page.setViewportSize({ width: viewport.width, height: viewport.height });
  await s.page.waitForLoadState('networkidle');
  await s.page.waitForTimeout(250);
  const finalPath = new URL(s.page.url()).pathname + new URL(s.page.url()).search;
  const h1 = await s.page.locator('h1').first().textContent().catch(() => null);
  const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const culprits = overflow > 0 ? await s.page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll('main *')]
      .filter((e) => e.getBoundingClientRect().right > width + 1 && !e.closest('.table-wrap'))
      .slice(-4)
      .map((e) => `${e.tagName.toLowerCase()}"${(e.textContent ?? '').trim().slice(0, 40)}"@${Math.round(e.getBoundingClientRect().right)}`);
  }) : [];
  const body = (await s.page.locator('body').innerText()).replace(/\s+/g, ' ');
  // `text` checks name AUTHORED words: read the visible text with CSS text-transform neutralised (see
  // candidate-visual-corrected.mts; innerText returns the uppercased badges and table headers).
  const authored = (await s.page.evaluate(() => {
    const elements = [document.body, ...document.body.querySelectorAll<HTMLElement>('*')];
    const saved = elements.map((e) => [e.style.getPropertyValue('text-transform'), e.style.getPropertyPriority('text-transform')] as const);
    for (const e of elements) e.style.setProperty('text-transform', 'none', 'important');
    try {
      return document.body.innerText;
    } finally {
      elements.forEach((e, i) => {
        const [value, priority] = saved[i];
        if (value) e.style.setProperty('text-transform', value, priority);
        else e.style.removeProperty('text-transform');
      });
    }
  })).replace(/\s+/g, ' ');
  const failed: string[] = [];
  for (const selector of checks.present ?? []) if (await s.page.locator(selector).count() === 0) failed.push(`missing ${selector}`);
  for (const selector of checks.absent ?? []) if (await s.page.locator(selector).count() > 0) failed.push(`unexpected ${selector}`);
  for (const words of checks.text ?? []) if (!authored.includes(words)) failed.push(`text not found "${words}"`);
  for (const words of checks.forbid ?? []) if (body.includes(words)) failed.push(`forbidden text "${words}"`);
  if (checks.noWinner) {
    const winners = await s.page.locator('[data-medal-winners]').allInnerTexts();
    if (winners.length !== 1 || !winners[0].trim().startsWith('none stated')) failed.push(`winner line ${JSON.stringify(winners)}`);
  }
  if (status !== null && status !== (checks.status ?? 200)) failed.push(`status ${status}`);
  if (overflow > 0) failed.push(`overflow ${overflow}px by ${culprits.join(' | ')}`);
  if (s.errors.length) failed.push(`console ${JSON.stringify(s.errors.slice(0, 3))}`);
  const file = `${name}__${viewport.label}.png`;
  await s.page.evaluate(() => window.scrollTo(0, 0));
  await s.page.waitForTimeout(150);
  await s.page.screenshot({ path: `${outDir}/${file}`, fullPage: true });
  log.push(`${file} as=${s.role === 'super_admin' ? 'super' : 'admin'} status=${status ?? 'same-page'} final=${finalPath} h1=${JSON.stringify(h1)} horizontalOverflowPx=${overflow} consoleErrors=${s.errors.length} checks=${failed.length ? `FAIL(${failed.join('; ')})` : 'pass'}`);
  if (failed.length) failures.push(`${file}: ${failed.join('; ')}`);
  s.errors.length = 0;
}

/** Navigate and capture at both viewports (a stateless page: reloaded per viewport). */
async function capture(s: Session, name: string, path: string, checks: Checks = {}) {
  for (const viewport of [DESKTOP, MOBILE]) {
    await s.page.setViewportSize({ width: viewport.width, height: viewport.height });
    s.errors.length = 0;
    const response = await s.page.goto(`${baseURL}${path}`, { waitUntil: 'networkidle' });
    await shoot(s, name, viewport, checks, response?.status() ?? null);
  }
}

/** Capture an ephemeral client state (an action outcome) at desktop, then the same state resized to mobile. */
async function captureState(s: Session, name: string, checks: Checks = {}) {
  await shoot(s, name, DESKTOP, checks, null);
  await shoot(s, name, MOBILE, checks, null);
  await s.page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
}

async function open(s: Session, path: string) {
  await s.page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
  await s.page.goto(`${baseURL}${path}`, { waitUntil: 'networkidle' });
}
const NOTE = 'SYNTHETIC visual-state check on the disposable afldb_v2_visual_leaderboard_test clone (corrected candidate, † recapture).';
/** The corrected raw-totals table (BrownlowViews.tsx, 7670441b): new header, evidence note, evidence-flag cells. */
const CORRECTED_TOTALS: Checks = { present: ['[data-evidence-flag-note]', '[data-evidence-flag]'], text: ['Ineligibility evidence'] };

const browser = await chromium.launch({ headless: true });
let pendingRank: { id: number; rank: number } | null = null;
let decided = false;
try {
  const [facts] = await sql.unsafe(ISOLATED_SERVER_FACTS_SQL);
  if (checkIsolatedTestServer(database, { clusterName: facts.cluster_name, databaseComment: facts.database_comment,
    currentDatabase: facts.current_database }).length) throw new Error('Live identity proof failed');
  const buildId = readFileSync(resolve('.next/BUILD_ID'), 'utf8').trim();
  if (buildId !== BUILD_ID) throw new Error(`Build ${buildId} is not the verified candidate build ${BUILD_ID}`);
  const referenceSha: Record<string, string> = {};
  for (const file of REFERENCE) {
    const bundled = resolve(`.next/standalone/data/reference/${file}`);
    if (existsSync(`${bundled}.visual-hidden`)) throw new Error(`A hidden fixture from an earlier run is still present: ${file}.visual-hidden`);
    referenceSha[file] = sha(bundled);
    if (referenceSha[file] !== sha(resolve(`data/reference/${file}`))) throw new Error(`Standalone ${file} differs from the repository file`);
  }
  // The server on 3912 must serve THIS build: its build manifest is addressed by the build id.
  const manifest = await fetch(`${baseURL}/_next/static/${BUILD_ID}/_buildManifest.js`);
  if (manifest.status !== 200) throw new Error(`The server on 3912 does not serve build ${BUILD_ID} (manifest status ${manifest.status})`);
  mkdirSync(outDir, { recursive: false });
  const start = await fingerprint();
  log.push(`start database=${database} cluster=${facts.cluster_name} marker=${JSON.stringify(facts.database_comment)} baseURL=${baseURL} buildId=${buildId} servedManifest=${manifest.status} referenceSha256=${JSON.stringify(referenceSha)}`);
  log.push(`start history=${JSON.stringify(Object.fromEntries(HISTORY.map((t) => [t, start[t].rows])))}`);

  const sup = await signIn('super_admin');
  const adm = await signIn('admin');
  const ro = (id: string, work: () => Promise<void>) => step(id, 'read-only captures: no change', [], work);

  if (recheck) {
  // --- R. Recheck: the full run's decision, D04 and B6/B7 with the corrected no-winner check ---------------
  const [recorded] = await sql`SELECT count(*)::int AS n, bool_and(v.is_ineligible) AS ineligible FROM brownlow_eligibility_decisions d
    JOIN brownlow_season_votes v ON v.season = d.season AND v.player_id = d.player_id_at_decision
    WHERE d.season = 2021 AND d.player_id_at_decision = 10130`;
  log.push(`full-run B9 record: decisions for season 2021 player 10130=${recorded.n} projected is_ineligible=${recorded.ineligible}`);
  if (recorded.n !== 1 || recorded.ineligible !== true) failures.push(`full-run B9 record: decisions=${recorded.n} is_ineligible=${recorded.ineligible}`);
  await ro('R-recheck-2027', async () => {
    await capture(sup, 'D04-brownlow-2027-refused', '/admin/operations/brownlow?season=2027', { present: ['[data-brownlow-report]'], noWinner: true });
  });
  const [leader] = await sql`SELECT b.id::int, b.season::int, b.player_id::int, b.eligible_rank::int AS rank FROM brownlow_season_votes b
    WHERE b.season BETWEEN 2000 AND 2021 AND b.season <> ALL(${RESERVED}) AND b.vote_rank = 1 AND b.is_ineligible IS NOT TRUE AND b.eligible_rank = 1
      AND NOT EXISTS (SELECT 1 FROM brownlow_season_votes o WHERE o.season = b.season AND o.vote_rank = 1 AND o.id <> b.id)
      AND NOT EXISTS (SELECT 1 FROM brownlow_eligibility_decisions d WHERE d.season = b.season)
    ORDER BY b.season DESC LIMIT 1`;
  if (!leader) throw new Error('No single, eligible, undecided leader in 2000-2021');
  const form = `[data-review-player="${leader.player_id}"] form`;
  const before = (await fingerprint()).brownlow_season_votes.digest;
  log.push(`reversible record: season=${leader.season} leader player=${leader.player_id} eligible_rank=${leader.rank}`);
  await step('F-requires-review-recheck', `clear eligible_rank (was ${leader.rank}) of the ${leader.season} leader, player ${leader.player_id} (restored below)`,
    ['brownlow_season_votes'], async () => {
      await sql`UPDATE brownlow_season_votes SET eligible_rank=NULL WHERE id=${leader.id} AND eligible_rank=${leader.rank}`;
      pendingRank = { id: leader.id, rank: leader.rank };
    });
  await ro('R-requires-review-recheck', async () => {
    const path = `/admin/operations/brownlow?season=${leader.season}`;
    await capture(sup, 'D-B6-brownlow-requires-review', path, { ...CORRECTED_TOTALS,
      present: [...CORRECTED_TOTALS.present!, '[data-medal-status="requires_review"]', `[data-review-player="${leader.player_id}"]`, form], noWinner: true });
    await capture(adm, 'D-B7-brownlow-requires-review-admin', path, { ...CORRECTED_TOTALS,
      present: [...CORRECTED_TOTALS.present!, '[data-medal-status="requires_review"]', '[data-decision-unavailable="role"]'], absent: [form], noWinner: true });
  });
  await step('F-requires-review-restore', `restore eligible_rank ${leader.rank} of player ${leader.player_id}: brownlow_season_votes byte-identical to before the fixture`,
    ['brownlow_season_votes'], async () => {
      await sql`UPDATE brownlow_season_votes SET eligible_rank=${leader.rank} WHERE id=${leader.id} AND eligible_rank IS NULL`;
      pendingRank = null;
      const restored = (await fingerprint()).brownlow_season_votes.digest === before;
      log.push(`F-requires-review-restore brownlow_season_votes digest restored=${restored}`);
      if (!restored) throw new Error('brownlow_season_votes not restored');
    });
  } else {
  // --- 1. 09 / S06 / S04: season pages with no fixture (supersede A 09, P1 S06, P1 S04) ----------------------
  await ro('R-season-pages', async () => {
    await capture(sup, 'D09-brownlow-2025', '/admin/operations/brownlow?season=2025', { ...CORRECTED_TOTALS, present: [...CORRECTED_TOTALS.present!, '[data-brownlow-report]'] });
    await capture(adm, 'D06-brownlow-2025-admin', '/admin/operations/brownlow?season=2025', { ...CORRECTED_TOTALS, present: [...CORRECTED_TOTALS.present!, '[data-brownlow-report]'] });
    await capture(sup, 'D04-brownlow-2027-refused', '/admin/operations/brownlow?season=2027', { present: ['[data-brownlow-report]'], noWinner: true });
  });

  // --- 2. B6-B9 on an equivalent record --------------------------------------------------------------------
  const [leader] = await sql`SELECT b.id::int, b.season::int, b.player_id::int, b.eligible_rank::int AS rank FROM brownlow_season_votes b
    WHERE b.season BETWEEN 2000 AND 2021 AND b.season <> ALL(${RESERVED}) AND b.vote_rank = 1 AND b.is_ineligible IS NOT TRUE AND b.eligible_rank = 1
      AND NOT EXISTS (SELECT 1 FROM brownlow_season_votes o WHERE o.season = b.season AND o.vote_rank = 1 AND o.id <> b.id)
      AND NOT EXISTS (SELECT 1 FROM brownlow_season_votes o WHERE o.season = b.season AND o.vote_rank = 2 AND o.eligible_rank IS DISTINCT FROM 2)
      AND NOT EXISTS (SELECT 1 FROM brownlow_eligibility_decisions d WHERE d.season = b.season)
    ORDER BY b.season DESC LIMIT 1`;
  if (!leader) throw new Error('No single, eligible, undecided leader with a single eligible runner-up in 2000-2021');
  const brownlow = `/admin/operations/brownlow?season=${leader.season}`;
  const form = `[data-review-player="${leader.player_id}"] form`;
  log.push(`equivalent record: season=${leader.season} leader player=${leader.player_id} eligible_rank=${leader.rank} (single leader, single eligible runner-up, no recorded decision)`);
  await step('F-requires-review', `clear eligible_rank (was ${leader.rank}) of the ${leader.season} leader, player ${leader.player_id}: eligibility becomes missing, the determination requires review`,
    ['brownlow_season_votes'], async () => {
      await sql`UPDATE brownlow_season_votes SET eligible_rank=NULL WHERE id=${leader.id} AND eligible_rank=${leader.rank}`;
      pendingRank = { id: leader.id, rank: leader.rank };
    });
  await ro('R-requires-review', async () => {
    await capture(sup, 'D-B6-brownlow-requires-review', brownlow, { ...CORRECTED_TOTALS,
      present: [...CORRECTED_TOTALS.present!, '[data-medal-status="requires_review"]', `[data-review-player="${leader.player_id}"]`, form], noWinner: true });
    await capture(adm, 'D-B7-brownlow-requires-review-admin', brownlow, { ...CORRECTED_TOTALS,
      present: [...CORRECTED_TOTALS.present!, '[data-medal-status="requires_review"]', '[data-decision-unavailable="role"]'], absent: [form], noWinner: true });
  });
  await step('B8-decision-invalid', 'submit a decision with a blank citation and a note under 20 characters: refused as field errors, nothing written', [], async () => {
    await open(sup, brownlow);
    await sup.page.locator(`${form} input[value="ineligible"]`).check();
    await sup.page.locator(`${form} input[name="citation"]`).fill('   ');
    await sup.page.locator(`${form} textarea[name="note"]`).fill('too short                ');
    await sup.page.locator(`${form} button[type="submit"]`).click();
    await sup.page.locator('[data-decision-workbench] [data-action-outcome]:not([data-action-outcome="idle"])').first().waitFor();
    await sup.page.waitForLoadState('networkidle');
    await captureState(sup, 'D-B8-decision-error', { present: ['[data-decision-workbench] [data-action-outcome="refused"]'], absent: ['[data-decision-result]'] });
  });
  await step('B9-decision-ineligible', `record player ${leader.player_id} as INELIGIBLE for ${leader.season} (synthetic; sealed season: audited correction): one decision, its data_edits audit row and the eligibility/medal projection into brownlow_season_votes`,
    ['brownlow_eligibility_decisions', 'brownlow_season_votes', 'data_edits'], async () => {
      await open(sup, brownlow);
      await sup.page.locator(`${form} input[value="ineligible"]`).check();
      await sup.page.locator(`${form} input[name="citation"]`).fill('SYNTHETIC citation: visual state check, not a real ruling');
      await sup.page.locator(`${form} textarea[name="note"]`).fill(NOTE);
      await sup.page.locator(`${form} button[type="submit"]`).click();
      await sup.page.locator('[data-decision-result]').waitFor();
      await sup.page.waitForLoadState('networkidle');
      decided = true;
      pendingRank = null;
      await captureState(sup, 'D-B9-decision-success', { present: ['[data-decision-result]', '[data-decision-current="true"]'] });
    });
  const [decision] = await sql`SELECT count(*)::int AS n FROM brownlow_eligibility_decisions WHERE season=${leader.season} AND player_id_at_decision=${leader.player_id}`;
  const [projected] = await sql`SELECT is_ineligible, eligible_rank FROM brownlow_season_votes WHERE id=${leader.id}`;
  log.push(`after B9: decisions for season ${leader.season} player ${leader.player_id}=${decision.n} projected is_ineligible=${projected.is_ineligible} eligible_rank=${projected.eligible_rank}`);
  if (decided && (decision.n !== 1 || projected.is_ineligible !== true)) failures.push(`B9 projection: decisions=${decision.n} is_ineligible=${projected.is_ineligible}`);
  }

  for (const s of [sup, adm]) {
    log.push(`context ${s.role} blockedRequests=${s.counter.blocked}`);
    if (s.counter.blocked) failures.push(`${s.role}: blocked external requests=${s.counter.blocked}`);
    await s.context.close();
  }
  for (const file of REFERENCE) {
    const unchanged = sha(resolve(`.next/standalone/data/reference/${file}`)) === referenceSha[file];
    log.push(`end ${file} sha256 unchanged=${unchanged}`);
    if (!unchanged) failures.push(`${file} changed during the run`);
  }
  const end = await fingerprint();
  log.push(`end history=${JSON.stringify(Object.fromEntries(HISTORY.map((t) => [t, end[t].rows])))} netChangedTables=[${delta(start, end).join(',')}]`);
  log.push(`failures=${failures.length}${failures.length ? `\n  ${failures.join('\n  ')}` : ''}`);
  console.log(`${log.filter((line) => line.includes('.png ')).length} captures written to ${outDir}; check failures=${failures.length}`);
} finally {
  // An undecided fixture is never left behind: restore the cleared rank if B9 did not record a decision.
  if (pendingRank && !decided) {
    await sql`UPDATE brownlow_season_votes SET eligible_rank=${(pendingRank as { id: number; rank: number }).rank} WHERE id=${(pendingRank as { id: number; rank: number }).id} AND eligible_rank IS NULL`;
    log.push('finally: undecided fixture restored');
  }
  if (existsSync(outDir)) writeFileSync(`${outDir}/capture-log.txt`, `${log.join('\n')}\n`, { flag: 'wx' });
  await browser.close(); await sql.end({ timeout: 5 });
}
