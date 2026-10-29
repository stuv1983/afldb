/**
 * Candidate capture of the owner-review STATES that need synthetic fixtures or test actions
 * (D-V2-VISUAL-RECAPTURE-1; docs/v2/owner-visual-review-2026-10-29.md §3). Local only.
 *
 *   node node_modules/tsx/dist/cli.mjs tools/v2/candidate-visual-states.mts <new-output-dir>
 *
 * Runs inside `isolated-pg.ts run afldb_v2_visual2_test` against the V2 production build already serving on
 * 127.0.0.1:3912 from the SAME disposable database. Unlike candidate-visual-capture.mts this run DELIBERATELY
 * changes the clone: every fixture and test action is a named step whose expected effect is written to the log
 * next to the observed per-table row-count/digest change, so a deliberate change is never reported as unchanged
 * data. Read-only captures between steps assert that nothing changed. Two fixtures are reverted and verified
 * (the hidden standalone season registry, the emptied award queue) and one privilege change is restored.
 * The output directory must not exist. External requests are blocked and counted. Fixture sessions are local
 * `@example.invalid` identities and are never printed.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { chromium, type Page } from '@playwright/test';
import { checkIsolatedTestDsn, checkIsolatedTestServer, ISOLATED_SERVER_FACTS_SQL } from '@afldb/domain';

const [outDir] = process.argv.slice(2);
if (!outDir || existsSync(outDir)) throw new Error('usage: candidate-visual-states.mts <new-output-dir> (must not exist)');
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
const HISTORY = ['award_proposals', 'award_proposal_decisions', 'award_winners', 'derived_award_results',
  'derived_award_projections', 'brownlow_season_votes', 'brownlow_round_votes', 'brownlow_eligibility_decisions',
  'data_edits', 'data_issues', 'data_submissions', 'data_submission_rows'];
type Role = 'super_admin' | 'admin';
type Checks = { present?: string[]; absent?: string[]; text?: string[]; status?: number };

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
  let [user] = await sql`SELECT id,role FROM auth_users WHERE email=${email}`;
  if (!user) [user] = await sql`INSERT INTO auth_users(email,role) VALUES(${email},${role}) RETURNING id,role`;
  if (user.role !== role) throw new Error('Fixture identity has an unexpected role');
  await sql`UPDATE auth_users SET can_manage_admins=${role === 'super_admin'}, must_change_password=false WHERE id=${user.id}`;
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
  const body = (await s.page.locator('body').innerText()).replace(/\s+/g, ' ');
  const failed: string[] = [];
  for (const selector of checks.present ?? []) if (await s.page.locator(selector).count() === 0) failed.push(`missing ${selector}`);
  for (const selector of checks.absent ?? []) if (await s.page.locator(selector).count() > 0) failed.push(`unexpected ${selector}`);
  for (const words of checks.text ?? []) if (!body.includes(words)) failed.push(`text not found "${words}"`);
  if (status !== null && status !== (checks.status ?? 200)) failed.push(`status ${status}`);
  if (overflow > 0) failed.push(`overflow ${overflow}px`);
  if (s.errors.length) failed.push(`console ${JSON.stringify(s.errors.slice(0, 3))}`);
  const file = `${name}__${viewport.label}.png`;
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
const NOTE = 'SYNTHETIC visual-state check on the disposable afldb_v2_visual2_test clone (D-V2-VISUAL-RECAPTURE-1).';

const browser = await chromium.launch({ headless: true });
let registryHidden = false;
let queueBackedUp = false;
let importRevoked = false;
try {
  const [facts] = await sql.unsafe(ISOLATED_SERVER_FACTS_SQL);
  if (checkIsolatedTestServer(database, { clusterName: facts.cluster_name, databaseComment: facts.database_comment,
    currentDatabase: facts.current_database }).length) throw new Error('Live identity proof failed');
  if (!existsSync(REGISTRY)) throw new Error('Standalone season registry missing; build first');
  const registrySha = sha(REGISTRY);
  if (registrySha !== sha(resolve('data/reference/seasons.json'))) throw new Error('Standalone registry differs from the repository file');
  mkdirSync(outDir, { recursive: false });
  const start = await fingerprint();
  log.push(`start database=${database} baseURL=${baseURL} registrySha256=${registrySha} history=${JSON.stringify(Object.fromEntries(HISTORY.map((t) => [t, start[t].rows])))}`);

  const sup = await signIn('super_admin');
  const adm = await signIn('admin');
  const ro = (id: string, work: () => Promise<void>) => step(id, 'read-only captures: no change', [], work);

  // --- 1. Read-only states over the cloned data (no fixture) ------------------------------------------------
  await ro('R-readonly-1', async () => {
    await capture(adm, 'S01-awards-queue-admin', '/admin/operations/awards', { absent: ['#create-file', '#create-text'], text: ['Super Admin actions'] });
    await capture(adm, 'S02-coleman-admin', '/admin/operations/coleman', { present: ['[data-publish-unavailable]', '#compare-season'], absent: ['#publish-note'] });
    await capture(sup, 'S03-brownlow-1996-tie', '/admin/operations/brownlow?season=1996', { present: ['[data-medal-status="determined"]'] });
    await capture(sup, 'S04-brownlow-2027-refused', '/admin/operations/brownlow?season=2027');
    await capture(sup, 'S05-brownlow-invalid-season', '/admin/operations/brownlow?season=1800');
    await capture(adm, 'S06-brownlow-2025-admin', '/admin/operations/brownlow?season=2025', { present: ['[data-brownlow-determination]'] });
    await capture(adm, 'S07-proposal-1-admin', '/admin/operations/awards/1', { present: ['[data-read-only]'], absent: ['button[value="approve"]'] });
  });

  // Coleman compare is labelled read-only: the derivable, Admin and refusal comparisons must change nothing.
  await ro('R-coleman-compare', async () => {
    for (const [s, name, season, settled] of [[sup, 'S08-coleman-compare-2024', '2024', true], [adm, 'S09-coleman-compare-2024-admin', '2024', true],
      [sup, 'S10-coleman-compare-2027-refused', '2027', true], [sup, 'S11-coleman-compare-unsettled', '2024', false]] as const) {
      await open(s, '/admin/operations/coleman');
      await s.page.fill('#compare-season', season);
      if (settled) await s.page.check('#compare-settled');
      await s.page.locator('#coleman-compare button[type="submit"]').click();
      await outcome(s, '#coleman-compare');
      await captureState(s, name);
    }
  });

  // --- 2. Historical submission (fixture insert) ---------------------------------------------------------------
  let submissionId = 0;
  await step('F-submission', 'insert one synthetic rejected legacy submission with 3 error/warning rows and 2 clean rows',
    ['data_submissions', 'data_submission_rows'], async () => {
      const [uploader] = await sql`SELECT id FROM auth_users WHERE email='visual-admin@example.invalid'`;
      const [reviewer] = await sql`SELECT id FROM auth_users WHERE email='visual-super@example.invalid'`;
      const content = Buffer.from('season,round,home,away\n2019,1,SYNTHETIC,SYNTHETIC\n');
      const [row] = await sql`INSERT INTO data_submissions (id, dataset, filename, content, content_sha256, uploaded_by, uploaded_at, status,
          row_count, validation_report, reviewed_by, reviewed_at, error)
        VALUES ((SELECT coalesce(max(id),0)+1 FROM data_submissions), 'match_results', 'SYNTHETIC-visual-history-2019-round-1.csv', ${content},
          ${createHash('sha256').update(content).digest('hex')}, ${uploader.id}, '2026-08-02T03:00:00Z', 'rejected', 5,
          ${sql.json({ ok: 2, warnings: 1, errors: 2, duplicates: 0 })}, ${reviewer.id}, '2026-08-03T03:00:00Z', NULL)
        RETURNING id`;
      submissionId = Number(row.id);
      const rows = [[1, 'error', ['home club SYNTHETIC is not a known club']], [2, 'error', ['score is not a whole number']],
        [3, 'warning', ['venue not recorded for this match']], [4, 'ok', null], [5, 'ok', null]] as const;
      for (const [rowNo, verdict, reasons] of rows) {
        await sql`INSERT INTO data_submission_rows (submission_id,row_no,payload,verdict,reasons) VALUES (${submissionId},${rowNo},
          ${sql.json({ season: '2019', round: '1', home: 'SYNTHETIC', away: 'SYNTHETIC', note: `row ${rowNo}` })},${verdict},${reasons === null ? null : sql.json({ reasons: [...reasons] })})`;
      }
    });
  await ro('R-submission', async () => {
    const checks = { text: ['This submission is read-only history.', 'Rows needing attention'], absent: ['form button[type="submit"]:not([form])'] };
    await capture(sup, 'S12-submission-history', `/admin/submissions/${submissionId}`, { text: checks.text });
    await capture(adm, 'S13-submission-history-admin', `/admin/submissions/${submissionId}`, { text: checks.text });
  });

  // --- 3. AFL API settle refusals in the production build ------------------------------------------------------
  await step('F-refusals', 'insert 60 synthetic open canonical_apply_failed refusals and 3 open settle findings (source afl_api)',
    ['data_issues'], async () => {
      for (let i = 1; i <= 60; i++) {
        await sql`INSERT INTO data_issues (id, entity_type, entity_id, issue_type, severity, description, details, detected_at)
          VALUES ((SELECT coalesce(max(id),0)+1 FROM data_issues), 'match', NULL, 'canonical_apply_failed', 'warning',
            ${`SYNTHETIC refused canonical application ${i}: the target row disagreed with the observation.`},
            ${sql.json({ owner: 'AFLDB-ISSUE-122', source_key: 'afl_api', family: i % 2 ? 'match_results' : 'player_match_stats',
              external_record_id: `CD_M2026014${String(i).padStart(4, '0')}`, target_table: i % 2 ? 'matches' : 'player_match_stats',
              refusal: i % 3 ? 'target_conflict' : 'identity_unresolved', match_key: `2026-R${(i % 24) + 1}-SYNTHETIC`,
              fields: i % 2 ? ['home_score', 'away_score'] : ['goals', 'behinds', 'disposals'] })},
            ${new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString()})`;
      }
      for (const [i, owner] of [[1, 'settle-afl-api.ts'], [2, 'settle-afl-api.ts'], [3, 'settle-afl-api-brownlow.ts']] as const) {
        await sql`INSERT INTO data_issues (id, entity_type, entity_id, issue_type, severity, description, details, detected_at)
          VALUES ((SELECT coalesce(max(id),0)+1 FROM data_issues), 'match', NULL, 'afl_api_corroboration_mismatch', 'warning',
            ${`SYNTHETIC settle finding ${i}.`},
            ${sql.json({ owner, source_key: 'afl_api', family: owner.includes('brownlow') ? 'brownlow_match_votes' : 'match_results',
              provider_match_id: `CD_M20260149${i}`, reason: 'corroboration_mismatch', fields: ['venue'] })},
            ${new Date(Date.UTC(2026, 9, 2, 0, i)).toISOString()})`;
      }
    });
  await ro('R-refusals', async () => {
    await capture(sup, 'R3-refusals-populated', '/admin/operations/afl-api-refusals', { text: ['60 open'] });
    const older = await sup.page.locator('a[href*="before="]').first().getAttribute('href');
    if (!older) throw new Error('No older-page link on the populated refusals page');
    await capture(sup, 'R4-refusals-page2', older);
    await capture(sup, 'R5-findings-populated', '/admin/operations/afl-api-refusals?section=findings', { text: ['3 open'] });
    await capture(adm, 'R6-refusals-populated-admin', '/admin/operations/afl-api-refusals', { text: ['60 open'] });
  });
  await step('F-refusals-read-failure', 'REVOKE SELECT ON data_issues FROM afldb_import for one capture, then GRANT it back (privilege only, no row change)',
    [], async () => {
      const [{ had }] = await sql`SELECT has_table_privilege('afldb_import','data_issues','SELECT') AS had`;
      if (!had) throw new Error('afldb_import did not hold SELECT on data_issues');
      await sql.unsafe('REVOKE SELECT ON data_issues FROM afldb_import');
      importRevoked = true;
      try {
        await capture(sup, 'R7-refusals-read-failed', '/admin/operations/afl-api-refusals', { text: ['could not be loaded'] });
      } finally {
        await sql.unsafe('GRANT SELECT ON data_issues TO afldb_import');
        importRevoked = false;
      }
      const [{ has }] = await sql`SELECT has_table_privilege('afldb_import','data_issues','SELECT') AS has`;
      log.push(`F-refusals-read-failure afldb_import SELECT restored=${has}`);
      if (!has) throw new Error('SELECT on data_issues was not restored');
    });

  // --- 4. Season registry unreadable (standalone build copy hidden, then restored) ---------------------------
  await step('F-registry-unreadable', 'hide .next/standalone/data/reference/seasons.json (build output, not the repository); an approval attempt must be refused and write no history',
    [], async () => {
      renameSync(REGISTRY, `${REGISTRY}.visual-hidden`);
      registryHidden = true;
      try {
        await capture(sup, 'U1-operations-registry-unreadable', '/admin/operations', { text: ['could not be read'] });
        await capture(adm, 'U2-operations-registry-unreadable-admin', '/admin/operations', { text: ['could not be read'] });
        await capture(sup, 'U3-coleman-registry-unreadable', '/admin/operations/coleman', { text: ['season registry could not be read'] });
        await open(sup, '/admin/operations/awards/1');
        await sup.page.fill('#decision-note', NOTE);
        await sup.page.locator('button[value="approve"]').click();
        await outcome(sup, '');
        await captureState(sup, 'U4-approve-refused-registry-unreadable', { present: ['[data-action-outcome="refused"]'], text: ['season_registry_unavailable'] });
      } finally {
        renameSync(`${REGISTRY}.visual-hidden`, REGISTRY);
        registryHidden = false;
      }
      const restored = sha(REGISTRY) === registrySha;
      log.push(`F-registry-unreadable registry restored sha256 match=${restored}`);
      if (!restored) throw new Error('Season registry not restored byte for byte');
    });

  // --- 5. Award decisions (test actions) ----------------------------------------------------------------------
  await step('A1-approve-sealed-no-note', 'approve validated proposal #1 (season 2026, sealed) with no note: refused season_sealed_correction_invalid, nothing written',
    [], async () => {
      await open(sup, '/admin/operations/awards/1');
      await sup.page.locator('button[value="approve"]').click();
      await outcome(sup, '');
      await captureState(sup, 'A1-approve-sealed-refused', { present: ['[data-action-outcome="refused"]'], text: ['season_sealed_correction_invalid'] });
    });
  await step('A2-approve-sealed-correction', 'approve proposal #1 with a 20+ character correction note: status approved, one decision, one award_winners row',
    ['award_proposals', 'award_proposal_decisions', 'award_winners'], async () => {
      await open(sup, '/admin/operations/awards/1');
      await sup.page.fill('#decision-note', NOTE);
      await sup.page.locator('button[value="approve"]').click();
      await outcome(sup, '');
      await captureState(sup, 'A2-approve-sealed-correction-outcome', { present: ['[data-action-outcome="ok"]'], text: ['audited correction of a sealed season'] });
    });
  await ro('R-approved', async () => {
    await capture(sup, 'A3-proposal-approved-revise-panel', '/admin/operations/awards/1', { text: ['Revise approved winner'] });
    await capture(adm, 'A4-proposal-approved-admin', '/admin/operations/awards/1', { present: ['[data-read-only]'] });
  });
  await step('A5-create-invalid-file', 'create from a file with one invalid row: whole file refused, nothing created', [], async () => {
    await open(sup, '/admin/operations/awards');
    await sup.page.fill('#create-text', JSON.stringify({ format: 'afldb-award-proposals', version: 1,
      defaults: { source_kind: 'offline_file', citation: 'SYNTHETIC offline file', acquired_on: '2026-10-29' },
      proposals: [{ award_slug: 'mark-of-the-year', season: 2027, player_identity: 'afltables:players/A/Aaron_Francis.html', player_name: 'Aaron Francis' },
        { award_slug: 'not-an-award', season: 1800, player_identity: 'nonsense', player_name: '' }] }, null, 1));
    await sup.page.locator('form:has(#create-text) button[type="submit"]').click();
    await outcome(sup, '');
    await captureState(sup, 'A5-create-invalid-file-refused', { present: ['[data-action-outcome="refused"]'] });
  });
  let createdId = 0;
  await step('A6-create-valid-file', 'create one proposal (mark-of-the-year 2027, in progress) from a pasted file: one proposed row and its decision',
    ['award_proposals', 'award_proposal_decisions'], async () => {
      await open(sup, '/admin/operations/awards');
      await sup.page.fill('#create-text', JSON.stringify({ format: 'afldb-award-proposals', version: 1,
        defaults: { source_kind: 'offline_file', citation: 'SYNTHETIC offline file (visual state check)', acquired_on: '2026-10-29' },
        proposals: [{ award_slug: 'mark-of-the-year', season: 2027, player_identity: 'afltables:players/A/Aaron_Francis.html', player_name: 'Aaron Francis' }] }, null, 1));
      await sup.page.locator('form:has(#create-text) button[type="submit"]').click();
      await outcome(sup, '');
      await captureState(sup, 'A6-create-valid-file-outcome', { present: ['[data-action-outcome="ok"]'] });
      const [row] = await sql`SELECT max(id)::int AS id FROM award_proposals WHERE created_by=${sup.userId}`;
      createdId = row.id;
    });
  await step('A7-validate-own', `validate the new proposal as its creator: status validated, one decision`,
    ['award_proposals', 'award_proposal_decisions'], async () => {
      if (!createdId) throw new Error('A6 created no proposal');
      await open(sup, `/admin/operations/awards/${createdId}`);
      await sup.page.locator('button[value="validate"]').click();
      await outcome(sup, '');
      await captureState(sup, 'A7-validate-outcome', { present: ['[data-action-outcome="ok"]'] });
    });
  await ro('R-self-approval', async () => {
    if (!createdId) throw new Error('A6 created no proposal');
    await capture(sup, 'A8-self-approval-attestation', `/admin/operations/awards/${createdId}`, { present: ['[data-self-approval]', '#self-approval-attestation'] });
  });
  await step('A9-reject-short-reason', 'reject the new proposal with a reason under 10 characters: refused, nothing written', [], async () => {
    if (!createdId) throw new Error('A6 created no proposal');
    await open(sup, `/admin/operations/awards/${createdId}`);
    await sup.page.fill('#decision-note', 'too short');
    await sup.page.locator('button[value="reject"]').click();
    await outcome(sup, '');
    await captureState(sup, 'A9-reject-short-reason-refused', { present: ['[data-action-outcome="refused"]'] });
  });

  // --- 6. Coleman publish (test actions) ----------------------------------------------------------------------
  await step('C1-publish-unsettled', 'publish 2024 without the settled attestation: refused, nothing written', [], async () => {
    await open(sup, '/admin/operations/coleman');
    await sup.page.fill('#compare-season', '2024');
    await sup.page.check('#compare-settled');
    await sup.page.locator('#coleman-compare button[type="submit"]').click();
    await outcome(sup, '#coleman-compare');
    await sup.page.fill('#publish-season', '2024');
    await sup.page.fill('#publish-note', NOTE);
    await sup.page.locator('#coleman-publish button[type="submit"]').click();
    await outcome(sup, '#coleman-publish');
    await captureState(sup, 'C1-publish-unsettled-refused', { present: ['#coleman-publish [data-action-outcome="refused"]'] });
  });
  await step('C2-publish-2024', 'publish the derived 2024 Coleman result after compare: one derived_award_results row, its projection, award_winners as previewed',
    ['derived_award_results', 'derived_award_projections', 'award_winners'], async () => {
      await sup.page.check('#publish-settled');
      await sup.page.locator('#coleman-publish button[type="submit"]').click();
      await sup.page.locator('[data-publication-result]').waitFor();
      await sup.page.waitForLoadState('networkidle');
      await captureState(sup, 'C2-publish-outcome', { present: ['[data-publication-result]'] });
    });
  await ro('R-coleman-published', async () => {
    await capture(sup, 'C3-coleman-after-publish', '/admin/operations/coleman', { text: ['2024'] });
  });

  // --- 7. Brownlow eligibility (fixture + test actions) ------------------------------------------------------
  const [leader] = await sql`SELECT id::int, player_id::int, eligible_rank FROM brownlow_season_votes WHERE season=2024 AND vote_rank=1`;
  await step('F-brownlow-missing-eligibility', `clear eligible_rank (was ${leader.eligible_rank}) for the 2024 leader, player ${leader.player_id}: eligibility becomes missing`,
    ['brownlow_season_votes'], async () => {
      await sql`UPDATE brownlow_season_votes SET eligible_rank=NULL WHERE id=${leader.id} AND is_ineligible IS NOT TRUE`;
    });
  await ro('R-requires-review', async () => {
    await capture(sup, 'B1-brownlow-2024-requires-review', '/admin/operations/brownlow?season=2024', { present: ['[data-medal-status="requires_review"]', `[data-review-player="${leader.player_id}"] form`] });
    await capture(adm, 'B2-brownlow-2024-requires-review-admin', '/admin/operations/brownlow?season=2024', { present: ['[data-medal-status="requires_review"]', '[data-decision-unavailable="role"]'] });
  });
  const form = `[data-review-player="${leader.player_id}"] form`;
  await step('B3-decision-invalid', 'submit a decision with a blank citation and a note under 20 characters: refused, nothing written', [], async () => {
    await open(sup, '/admin/operations/brownlow?season=2024');
    await sup.page.locator(`${form} input[value="eligible"]`).check();
    await sup.page.locator(`${form} input[name="citation"]`).fill('   ');
    await sup.page.locator(`${form} textarea[name="note"]`).fill('too short                ');
    await sup.page.locator(`${form} button[type="submit"]`).click();
    await outcome(sup, '[data-decision-workbench]');
    await captureState(sup, 'B3-decision-error', { present: ['[data-action-outcome="refused"]'] });
  });
  await step('B4-decision-eligible', `record player ${leader.player_id} as eligible for 2024 (sealed: audited correction): one decision row; the medal metadata projection may update brownlow_season_votes`,
    ['brownlow_eligibility_decisions', 'brownlow_season_votes'], async () => {
      await open(sup, '/admin/operations/brownlow?season=2024');
      await sup.page.locator(`${form} input[value="eligible"]`).check();
      await sup.page.locator(`${form} input[name="citation"]`).fill('SYNTHETIC citation: visual state check, not a real ruling');
      await sup.page.locator(`${form} textarea[name="note"]`).fill(NOTE);
      await sup.page.locator(`${form} button[type="submit"]`).click();
      await sup.page.locator('[data-decision-result]').waitFor();
      await sup.page.waitForLoadState('networkidle');
      await captureState(sup, 'B4-decision-success', { present: ['[data-decision-result]'] });
    });
  await ro('R-after-decision', async () => {
    await capture(sup, 'B5-brownlow-2024-after-decision', '/admin/operations/brownlow?season=2024', { present: ['[data-medal-status="determined"]', '[data-decision-current="true"]'] });
  });

  // --- 8. Empty award queue (all proposals moved aside, captured, restored, verified) -----------------------
  const beforeQueue = await fingerprint();
  await step('F-empty-queue', 'move every proposal and decision into backup tables, capture the empty queue, restore them; net effect none',
    [], async () => {
      await sql.begin(async (tx) => {
        await tx.unsafe('CREATE TABLE visual_backup_award_proposals AS SELECT * FROM award_proposals');
        await tx.unsafe('CREATE TABLE visual_backup_award_proposal_decisions AS SELECT * FROM award_proposal_decisions');
        await tx.unsafe('DELETE FROM award_proposal_decisions');
        await tx.unsafe('DELETE FROM award_proposals');
      });
      queueBackedUp = true;
      try {
        await capture(sup, 'Q1-awards-queue-empty', '/admin/operations/awards', { present: ['#create-text'] });
        await capture(adm, 'Q2-awards-queue-empty-admin', '/admin/operations/awards', { absent: ['#create-text'] });
      } finally {
        await restoreQueue();
      }
    });
  const afterQueue = await fingerprint();
  log.push(`F-empty-queue restored award_proposals/decisions identical=${beforeQueue.award_proposals.digest === afterQueue.award_proposals.digest && beforeQueue.award_proposal_decisions.digest === afterQueue.award_proposal_decisions.digest}`);

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
  if (registryHidden && existsSync(`${REGISTRY}.visual-hidden`)) renameSync(`${REGISTRY}.visual-hidden`, REGISTRY);
  if (importRevoked) await sql.unsafe('GRANT SELECT ON data_issues TO afldb_import');
  if (queueBackedUp) await restoreQueue();
  if (existsSync(outDir)) writeFileSync(`${outDir}/capture-log.txt`, `${log.join('\n')}\n`, { flag: 'wx' });
  await browser.close(); await sql.end({ timeout: 5 });
}

async function restoreQueue(): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe('INSERT INTO award_proposals OVERRIDING SYSTEM VALUE SELECT * FROM visual_backup_award_proposals');
    await tx.unsafe('INSERT INTO award_proposal_decisions OVERRIDING SYSTEM VALUE SELECT * FROM visual_backup_award_proposal_decisions');
    await tx.unsafe('DROP TABLE visual_backup_award_proposals');
    await tx.unsafe('DROP TABLE visual_backup_award_proposal_decisions');
  });
  queueBackedUp = false;
}
