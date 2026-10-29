/**
 * Recapture of the CORRECTED candidate (V2-GAP-036/037/038 and the raw-total evidence label) from the genuine
 * production bundle. Local only; the successor of candidate-visual-states.mts (pass 2), which stays unchanged as the
 * record of the broken candidate and of its labelled W-block workaround.
 *
 *   node node_modules/tsx/dist/cli.mjs tools/v2/candidate-visual-corrected.mts <new-output-dir>
 *
 * Runs inside `isolated-pg.ts run afldb_v2_visual2_test` against the V2 production build serving on 127.0.0.1:3912
 * from the SAME disposable database, as pass 2 left it. It REFUSES to start unless the standalone bundle already
 * holds the Coleman contract and the season registry byte-identical to the repository files: nothing is copied into
 * the build output here. Two build-output fixtures HIDE a file (the registry, then the contract) to prove the
 * fail-closed refusals, and are restored and verified byte for byte. One reversible data fixture clears and then
 * restores a single `eligible_rank`. Every fixture and test action is a named step whose expected effect is logged
 * next to the observed per-table change. External requests are blocked and counted. Fixture sessions are local
 * `@example.invalid` identities and are never printed.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { chromium } from '@playwright/test';
import { checkIsolatedTestDsn, checkIsolatedTestServer, ISOLATED_SERVER_FACTS_SQL } from '@afldb/domain';

const [outDir] = process.argv.slice(2);
if (!outDir || existsSync(outDir)) throw new Error('usage: candidate-visual-corrected.mts <new-output-dir> (must not exist)');
const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || checkIsolatedTestDsn(dsn, Number(process.env.AFLDB_V2_ISOLATED_PORT)).length) throw new Error('Isolated runner required');
const database = new URL(dsn).pathname.slice(1);
if (database !== 'afldb_v2_visual2_test') throw new Error('This run mutates its target: only afldb_v2_visual2_test is approved');
const sql = postgres(dsn, { max: 1, onnotice: () => {} });
const secret = createHash('sha256').update(process.env.AFLDB_TEST_AUTH_DATABASE_URL ?? '').digest('hex');
const baseURL = 'http://127.0.0.1:3912';
const DESKTOP = { width: 1280, height: 800, label: 'desktop-1280x800' };
const MOBILE = { width: 390, height: 844, label: 'mobile-390x844' };
const REGISTRY = resolve('.next/standalone/data/reference/seasons.json');
const CONTRACT = resolve('.next/standalone/data/reference/coleman-derivation.json');
const HISTORY = ['award_proposals', 'award_proposal_decisions', 'award_winners', 'derived_award_results',
  'derived_award_projections', 'brownlow_season_votes', 'brownlow_round_votes', 'brownlow_eligibility_decisions',
  'data_edits', 'data_issues', 'data_submissions', 'data_submission_rows'];
/** Text a V2-GAP-037 refusal must never render: the OS error and any part of the bundle's absolute path. */
const LEAKS = ['ENOENT', 'no such file', 'standalone', resolve('.'), 'could not be read:'];
type Role = 'super_admin' | 'admin';
type Checks = { present?: string[]; absent?: string[]; text?: string[]; forbid?: string[]; status?: number };

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
async function step(id: string, expected: string, expectTables: string[], work: () => Promise<void>, mayChange: string[] = []): Promise<void> {
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
  const changed = observed.map((entry) => entry.split(':')[0]).filter((table) => !mayChange.includes(table)).sort();
  const match = JSON.stringify(changed) === JSON.stringify([...expectTables].sort());
  log.push(`STEP ${id} expected="${expected}" expectedTables=[${expectTables.join(',')}]${mayChange.length ? ` mayChange=[${mayChange.join(',')}]` : ''} observed=[${observed.join(',') || 'no change'}] match=${match}`);
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
  return { role, context, page, errors, counter, userId: Number(user.id) };
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
  // Name what overflows: elements reaching past the viewport that are not inside their own scroll box.
  const culprits = overflow > 0 ? await s.page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll('main *')]
      .filter((e) => e.getBoundingClientRect().right > width + 1 && !e.closest('.table-wrap'))
      .slice(-4)
      .map((e) => `${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className ? `.${e.className.trim().split(/\s+/).join('.')}` : ''}"${(e.textContent ?? '').trim().slice(0, 40)}"@${Math.round(e.getBoundingClientRect().right)}`);
  }) : [];
  const body = (await s.page.locator('body').innerText()).replace(/\s+/g, ' ');
  // `text` checks name AUTHORED words, so they read the visible text with CSS text-transform neutralised (through the
  // CSSOM, which the page's CSP allows): innerText returns the uppercased rendering of badges and table headers, which
  // made the two L1 checks fail on correct pages. Rerun in candidate-visual-leaderboard.mts.
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
async function outcome(s: Session, scope: string) {
  await s.page.locator(`${scope} [data-action-outcome]:not([data-action-outcome="idle"])`).first().waitFor();
  await s.page.waitForLoadState('networkidle');
}
async function compare(s: Session, season: string, settled: boolean) {
  await open(s, '/admin/operations/coleman');
  await s.page.fill('#compare-season', season);
  if (settled) await s.page.check('#compare-settled');
  await s.page.locator('#coleman-compare button[type="submit"]').click();
  await outcome(s, '#coleman-compare');
}
async function decide(s: Session, proposalId: number, intent: 'validate' | 'approve' | 'reject', note: string | null) {
  await open(s, `/admin/operations/awards/${proposalId}`);
  if (note !== null) await s.page.fill('#decision-note', note);
  await s.page.locator(`button[value="${intent}"]`).click();
  await outcome(s, '');
}
/** Hide one build-output file for `work`, then restore it and prove it is byte-identical. */
async function hidden(path: string, expectedSha: string, work: () => Promise<void>) {
  renameSync(path, `${path}.visual-hidden`);
  hiddenFiles.add(path);
  try {
    await work();
  } finally {
    renameSync(`${path}.visual-hidden`, path);
    hiddenFiles.delete(path);
  }
  const restored = sha(path) === expectedSha;
  log.push(`restored ${path.slice(resolve('.').length + 1).replaceAll('\\', '/')} sha256 match=${restored}`);
  if (!restored) throw new Error(`${path} not restored byte for byte`);
}
const NOTE = 'SYNTHETIC visual-state check on the disposable afldb_v2_visual2_test clone (corrected candidate).';
const REGISTRY_REFUSAL = 'The season registry (data/reference/seasons.json) could not be read or is not valid';
const CONTRACT_REFUSAL = 'The Coleman derivation contract (data/reference/coleman-derivation.json) could not be read or is not valid';

const browser = await chromium.launch({ headless: true });
const hiddenFiles = new Set<string>();
let pendingRank: { id: number; rank: number } | null = null;
try {
  const [facts] = await sql.unsafe(ISOLATED_SERVER_FACTS_SQL);
  if (checkIsolatedTestServer(database, { clusterName: facts.cluster_name, databaseComment: facts.database_comment,
    currentDatabase: facts.current_database }).length) throw new Error('Live identity proof failed');
  for (const path of [REGISTRY, CONTRACT]) {
    if (existsSync(`${path}.visual-hidden`)) throw new Error(`A hidden fixture from an earlier run is still present: ${path}.visual-hidden`);
  }
  // V2-GAP-036: the bundle must already hold the contract from `npm run build` (prepare-standalone). Nothing is copied.
  if (!existsSync(CONTRACT)) throw new Error('The standalone bundle does not hold the Coleman contract: build with the corrected packaging first');
  const registrySha = sha(REGISTRY);
  const contractSha = sha(CONTRACT);
  if (registrySha !== sha(resolve('data/reference/seasons.json'))) throw new Error('Standalone registry differs from the repository file');
  if (contractSha !== sha(resolve('data/reference/coleman-derivation.json'))) throw new Error('Standalone Coleman contract differs from the repository file');
  const buildId = readFileSync(resolve('.next/BUILD_ID'), 'utf8').trim();
  mkdirSync(outDir, { recursive: false });
  const start = await fingerprint();
  log.push(`start database=${database} baseURL=${baseURL} buildId=${buildId} registrySha256=${registrySha} contractSha256=${contractSha} contractInBundleFromBuild=true history=${JSON.stringify(Object.fromEntries(HISTORY.map((t) => [t, start[t].rows])))}`);

  const sup = await signIn('super_admin');
  const adm = await signIn('admin');
  const ro = (id: string, work: () => Promise<void>) => step(id, 'read-only captures: no change', [], work);

  // --- 1. Coleman compare from the genuine bundle (V2-GAP-036; supersedes K1-K4 and W1-W3) ---------------------
  await ro('R-coleman-compare', async () => {
    await compare(sup, '2024', true);
    await captureState(sup, 'C1-coleman-compare-2024', { present: ['[data-coleman-comparison]', '[data-coleman-projection]'],
      absent: ['#coleman-compare [data-action-outcome="refused"]', '[data-derivation-refused]'] });
    await compare(adm, '2024', true);
    await captureState(adm, 'C2-coleman-compare-2024-admin', { present: ['[data-coleman-comparison]', '[data-publish-unavailable]'],
      absent: ['#coleman-compare [data-action-outcome="refused"]'] });
    await compare(sup, '2027', true);
    await captureState(sup, 'C3-coleman-compare-2027', { forbid: ['coleman_contract_unavailable'] });
    await compare(sup, '2024', false);
    await captureState(sup, 'C4-coleman-compare-unsettled', { forbid: ['coleman_contract_unavailable'] });
    await compare(sup, '1975', true);
    await captureState(sup, 'C5-coleman-compare-1975-refused', { present: ['[data-derivation-refused]'], forbid: ['coleman_contract_unavailable'] });
  });

  // --- 2. Coleman publication from the genuine bundle --------------------------------------------------------
  // 2024 was published in pass 2 (W5, contract copied in). A season with no derived publication proves it afresh.
  const published = new Set((await sql`SELECT DISTINCT season::int AS season FROM derived_award_results`).map((r) => Number(r.season)));
  let season = 0;
  await ro('R-coleman-choose-season', async () => {
    for (const candidate of [2023, 2022, 2021, 2019]) {
      if (published.has(candidate)) continue;
      await compare(sup, String(candidate), true);
      if (await sup.page.locator('[data-derivation-refused]').count() === 0 && await sup.page.locator('#coleman-compare [data-action-outcome="refused"]').count() === 0) {
        season = candidate;
        break;
      }
      log.push(`coleman season ${candidate} not derivable here; trying the next`);
    }
    if (!season) throw new Error('No unpublished derivable season among 2023, 2022, 2021, 2019');
    log.push(`coleman publication season=${season} (derivable, no earlier derived publication)`);
  });
  await step('P1-publish-unattested', `publish ${season} without the settled attestation: refused, nothing written`, [], async () => {
    await compare(sup, String(season), true);
    await sup.page.fill('#publish-season', String(season));
    await sup.page.fill('#publish-note', NOTE);
    await sup.page.locator('#coleman-publish button[type="submit"]').click();
    await outcome(sup, '#coleman-publish');
    await captureState(sup, 'C6-coleman-publish-unattested-refused', { present: ['#coleman-publish [data-action-outcome="refused"]'], forbid: ['coleman_contract_unavailable'] });
  });
  await step('P2-publish', `publish ${season} attested from the genuine bundle: appends the derivation ledger row and its projection (award_winners/data_edits only if the preview showed changes)`,
    ['derived_award_results', 'derived_award_projections'], async () => {
      await sup.page.check('#publish-settled');
      await sup.page.locator('#coleman-publish button[type="submit"]').click();
      await sup.page.locator('[data-publication-result]').waitFor();
      await sup.page.waitForLoadState('networkidle');
      await captureState(sup, 'C7-coleman-publish-outcome', { present: ['[data-publication-result]'] });
    }, ['award_winners', 'data_edits']);
  await ro('R-coleman-after-publish', async () => {
    await capture(sup, 'C8-coleman-after-publish', '/admin/operations/coleman', { text: [String(season)] });
    await capture(adm, 'C9-coleman-after-publish-admin', '/admin/operations/coleman', { text: [String(season)], present: ['[data-publish-unavailable]'] });
  });

  // --- 3. Missing-file refusals: generic text, stable code, fail closed (V2-GAP-037; supersedes U5, K1) -------
  const [validated] = await sql`SELECT id::int FROM award_proposals WHERE status='validated' ORDER BY id DESC LIMIT 1`;
  await step('U6-registry-missing', 'hide the bundle\'s seasons.json; approving a validated proposal and a Coleman compare are both refused season_registry_unavailable with generic text; nothing written',
    [], async () => {
      if (!validated) throw new Error('No validated proposal to attempt');
      await hidden(REGISTRY, registrySha, async () => {
        await decide(sup, validated.id, 'approve', NOTE);
        await captureState(sup, 'G1-approve-refused-registry-missing', { present: ['[data-action-outcome="refused"]'],
          text: [REGISTRY_REFUSAL, 'season_registry_unavailable', 'Nothing was changed'], forbid: LEAKS });
        await compare(sup, '2024', true);
        await captureState(sup, 'G2-coleman-compare-registry-missing', { present: ['#coleman-compare [data-action-outcome="refused"]'],
          text: [REGISTRY_REFUSAL, 'season_registry_unavailable'], forbid: LEAKS });
      });
    });
  await step('U7-contract-missing', 'hide the bundle\'s coleman-derivation.json; a Coleman compare and an attested publish are both refused coleman_contract_unavailable with generic text; nothing written',
    [], async () => {
      await hidden(CONTRACT, contractSha, async () => {
        await compare(sup, '2024', true);
        await captureState(sup, 'G3-coleman-compare-contract-missing', { present: ['#coleman-compare [data-action-outcome="refused"]'],
          text: [CONTRACT_REFUSAL, 'coleman_contract_unavailable'], forbid: LEAKS });
        await open(sup, '/admin/operations/coleman');
        await sup.page.fill('#publish-season', '2024');
        await sup.page.fill('#publish-note', NOTE);
        await sup.page.check('#publish-settled');
        await sup.page.locator('#coleman-publish button[type="submit"]').click();
        await outcome(sup, '#coleman-publish');
        await captureState(sup, 'G4-coleman-publish-contract-missing', { present: ['#coleman-publish [data-action-outcome="refused"]'],
          text: [CONTRACT_REFUSAL, 'coleman_contract_unavailable'], forbid: LEAKS });
      });
    });

  // --- 4. Brownlow status wrap at 390px (V2-GAP-038; supersedes S03, B10, B11) --------------------------------
  await ro('R-brownlow-wrap', async () => {
    const wrapped = { text: ['refused_eligibility_rule_unrecorded'] };
    await capture(sup, 'B12-brownlow-1996-tie', '/admin/operations/brownlow?season=1996', { ...wrapped, present: ['[data-medal-status="determined"]'] });
    await capture(sup, 'B13-brownlow-2023-after-decision', '/admin/operations/brownlow?season=2023', { ...wrapped, present: ['[data-medal-status="determined"]', '[data-decision-current="true"]'] });
    await capture(adm, 'B14-brownlow-2023-after-decision-admin', '/admin/operations/brownlow?season=2023', { ...wrapped, present: ['[data-decision-current="true"]'] });
  });

  // --- 5. The raw totals' evidence flag beside an "unknown (not recorded)" determination (label triage) --------
  const [leader] = await sql`SELECT b.id::int, b.season::int, b.player_id::int, b.eligible_rank::int AS rank FROM brownlow_season_votes b
    WHERE b.season IN (2022, 2021, 2019) AND b.vote_rank = 1 AND b.is_ineligible IS NOT TRUE AND b.eligible_rank = 1
      AND NOT EXISTS (SELECT 1 FROM brownlow_season_votes o WHERE o.season = b.season AND o.vote_rank = 1 AND o.id <> b.id)
      AND NOT EXISTS (SELECT 1 FROM brownlow_eligibility_decisions d WHERE d.season = b.season)
    ORDER BY b.season DESC LIMIT 1`;
  const brownlowBefore = (await fingerprint()).brownlow_season_votes.digest;
  await step('F-evidence-label', `clear eligible_rank (was ${leader?.rank}) of the ${leader?.season} leader, player ${leader?.player_id}: eligibility becomes missing (restored below)`,
    ['brownlow_season_votes'], async () => {
      if (!leader) throw new Error('No single, eligible, undecided leader in 2022, 2021 or 2019');
      await sql`UPDATE brownlow_season_votes SET eligible_rank=NULL WHERE id=${leader.id} AND eligible_rank=${leader.rank}`;
      pendingRank = { id: leader.id, rank: leader.rank };
    });
  await ro('R-evidence-label', async () => {
    if (!leader) throw new Error('No fixture leader');
    const path = `/admin/operations/brownlow?season=${leader.season}`;
    await capture(sup, 'L1-brownlow-unknown-eligibility-evidence-label', path, {
      present: ['[data-medal-status="requires_review"]', `[data-review-player="${leader.player_id}"]`, '[data-eligibility="missing"]', '[data-evidence-flag-note]', '[data-evidence-flag="true"]'],
      text: ['unknown (not recorded)', 'Ineligibility evidence', 'not marked ineligible'] });
  });
  await step('F-evidence-label-restore', `restore eligible_rank ${leader?.rank} of player ${leader?.player_id}: brownlow_season_votes byte-identical to before the fixture`,
    ['brownlow_season_votes'], async () => {
      if (!pendingRank) throw new Error('Nothing to restore');
      await sql`UPDATE brownlow_season_votes SET eligible_rank=${pendingRank.rank} WHERE id=${pendingRank.id} AND eligible_rank IS NULL`;
      pendingRank = null;
      const restored = (await fingerprint()).brownlow_season_votes.digest === brownlowBefore;
      log.push(`F-evidence-label-restore brownlow_season_votes digest restored=${restored}`);
      if (!restored) throw new Error('brownlow_season_votes not restored');
    });

  for (const s of [sup, adm]) {
    log.push(`context ${s.role} blockedRequests=${s.counter.blocked}`);
    if (s.counter.blocked) failures.push(`${s.role}: blocked external requests=${s.counter.blocked}`);
    await s.context.close();
  }
  const end = await fingerprint();
  log.push(`end history=${JSON.stringify(Object.fromEntries(HISTORY.map((t) => [t, end[t].rows])))} netChangedTables=[${delta(start, end).join(',')}]`);
  log.push(`failures=${failures.length}${failures.length ? `\n  ${failures.join('\n  ')}` : ''}`);
  console.log(`${log.filter((line) => line.includes('.png ')).length} captures written to ${outDir}; check failures=${failures.length}`);
} finally {
  for (const path of hiddenFiles) if (existsSync(`${path}.visual-hidden`)) renameSync(`${path}.visual-hidden`, path);
  if (pendingRank) await sql`UPDATE brownlow_season_votes SET eligible_rank=${pendingRank.rank} WHERE id=${pendingRank.id} AND eligible_rank IS NULL`;
  if (existsSync(outDir)) writeFileSync(`${outDir}/capture-log.txt`, `${log.join('\n')}\n`, { flag: 'wx' });
  await browser.close(); await sql.end({ timeout: 5 });
}
