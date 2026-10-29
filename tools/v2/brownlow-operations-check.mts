/**
 * Brownlow operations-centre application check (AFLDB V2 operational readiness).
 *
 * Drives the REAL running Next application (production build, loopback only) at the real request
 * boundary: signed-in synthetic users load /admin/operations/brownlow in Chromium, submit the real
 * decision form (a React Server Action), and the genuine captured Server Action request is then
 * replayed with a different identity, origin, body or timing. It never calls the operations-centre
 * module directly, never imports a Next module and never reaches the application through its
 * database layer.
 *
 *   node --import tsx tools/v2/brownlow-operations-check.mts <season> <out.json> [capture-dir]
 *
 * Requirements: the isolated runner (`isolated-pg.ts run`), the V2 production build already serving
 * on 127.0.0.1:3912 against the SAME disposable database, `AFLDB_TEST_DATABASE_URL` /
 * `AFLDB_TEST_AUTH_DATABASE_URL` from the runner, and a season whose staged API votes carry
 * eligibility flags that disagree with the stored table (so players require review).
 *
 * Fixture identities are `@example.invalid` with no password and no TOTP; their sessions are inserted
 * directly and signed the way the application signs them. Nothing is printed that would reveal a
 * session. The output records codes, ids, counts and digests, never row content beyond public ids.
 *
 * Fault injection (the failed-publication and failed-audit cases) is done with temporary triggers on
 * the disposable database and removed in a `finally`.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { checkIsolatedTestDsn, checkIsolatedTestServer, ISOLATED_SERVER_FACTS_SQL } from '@afldb/domain';

const [seasonArg, out, captureDir] = process.argv.slice(2);
const season = Number(seasonArg);
if (!Number.isInteger(season) || !out) throw new Error('usage: brownlow-operations-check.mts <season> <out.json> [capture-dir]');
const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || checkIsolatedTestDsn(dsn, Number(process.env.AFLDB_V2_ISOLATED_PORT)).length) {
  throw new Error('Isolated runner required');
}
const database = new URL(dsn).pathname.slice(1);
const sql = postgres(dsn, { max: 2, onnotice: () => {} });
const secret = createHash('sha256').update(process.env.AFLDB_TEST_AUTH_DATABASE_URL ?? '').digest('hex');
const baseURL = 'http://127.0.0.1:3912';
const PAGE = `/admin/operations/brownlow?season=${season}`;

type Result = { id: string; ok: boolean; expected: string; actual: unknown };
const results: Result[] = [];
const record = (id: string, ok: boolean, expected: string, actual: unknown = null): void => {
  results.push({ id, ok, expected, actual });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} -- ${expected}${actual === null ? '' : ` -- ${JSON.stringify(actual)}`}`);
};

/* ---------------------------- database observation ---------------------------- */

const digest = async (query: string): Promise<string> => {
  const [row] = await sql.unsafe(`SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS d FROM (${query}) t`);
  return `${row.n}:${row.d}`;
};

/** Raw votes and provenance: must never change from any operation in this check. */
const rawFingerprint = async () => ({
  roundVotes: await digest(`SELECT * FROM brownlow_round_votes WHERE season = ${season}`),
  seasonVotes: await digest(`SELECT season, player_id, votes, games, three_vote_games, two_vote_games, one_vote_games, polling_games FROM brownlow_season_votes WHERE season = ${season}`),
  staged: await digest(`SELECT * FROM staging.afl_api_brownlow_vote WHERE season = ${season}`),
  matches: await digest(`SELECT id, season, round_number FROM matches WHERE season = ${season}`),
});
/** The publication surface: changes only through a committed decision. */
const publishedFingerprint = async () => ({
  flags: await digest(`SELECT player_id, is_winner, is_ineligible, eligible_rank, vote_rank FROM brownlow_season_votes WHERE season = ${season}`),
  decisions: await digest('SELECT * FROM brownlow_eligibility_decisions'),
  authority: await digest(`SELECT * FROM data_edits WHERE table_name = 'brownlow_season_authority'`),
  edits: await digest('SELECT * FROM data_edits'),
});
const auditCount = async (action?: string): Promise<number> => {
  const [row] = action === undefined
    ? await sql`SELECT count(*)::int AS n FROM auth_audit_log WHERE action LIKE 'admin.brownlow%'`
    : await sql`SELECT count(*)::int AS n FROM auth_audit_log WHERE action = ${action}`;
  return row.n;
};
const state = async () => ({ raw: await rawFingerprint(), pub: await publishedFingerprint(), audit: await auditCount() });
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const decisionRows = () => sql<{ id: number; player_id_at_decision: number; verdict: string; decided_by: number; basis: string; supersedes_id: number | null; correction: unknown }[]>`
  SELECT id::int, player_id_at_decision::int, verdict, decided_by::int, basis, supersedes_id::int, correction FROM brownlow_eligibility_decisions ORDER BY id`;

/** Names the public season page announces ("Won by X [and Y] with N votes") versus the database. */
const dbWinners = async (): Promise<string[]> =>
  (await sql`SELECT p.display_name AS name FROM brownlow_season_votes b JOIN players p ON p.id = b.player_id WHERE b.season = ${season} AND b.is_winner`)
    .map((r) => r.name as string).sort();
const publicWinners = async (): Promise<string[]> => {
  const text = await (await fetch(`${baseURL}/brownlow/${season}`)).text();
  const m = /Won by (.+?) with [0-9]+ votes/.exec(text);
  if (!m) return [];
  return m[1].replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').split(/, | and /).map((n) => n.trim()).sort();
};
/** Poll until the public page announces the database's winners; returns the requests it took (null = never). */
const publicFollows = async (limit = 10): Promise<{ requests: number | null; shown: string[]; db: string[] }> => {
  const db = await dbWinners();
  let shown: string[] = [];
  for (let i = 1; i <= limit; i += 1) {
    shown = await publicWinners();
    if (JSON.stringify(shown) === JSON.stringify(db)) return { requests: i, shown, db };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { requests: null, shown, db };
};
const refreshPublic = async (actor: Actor): Promise<number> =>
  (await fetch(`${baseURL}/admin/operations/brownlow/revalidate`, { method: 'POST', redirect: 'manual', headers: { cookie: `afldb_admin=${actor.cookie}` } })).status;

/* ---------------------------- fixture identities ---------------------------- */

type Actor = { name: string; email: string; role: string; id: number; cookie: string | null };
const makeActor = async (name: string, role: string, opts: { manage?: boolean; disabled?: boolean; expired?: boolean } = {}): Promise<Actor> => {
  const email = `local-brownlow-${name}@example.invalid`;
  let [user] = await sql`SELECT id, role FROM auth_users WHERE email = ${email}`;
  if (!user) [user] = await sql`INSERT INTO auth_users(email, role) VALUES (${email}, ${role}) RETURNING id, role`;
  if (user.role !== role) throw new Error('Fixture identity has an unexpected role');
  await sql`UPDATE auth_users SET can_manage_admins = ${opts.manage ?? role === 'super_admin'}, must_change_password = false,
    disabled_at = ${opts.disabled ? new Date() : null} WHERE id = ${user.id}`;
  const token = randomBytes(32).toString('base64url');
  const expiry = opts.expired ? "now() - interval '1 hour'" : "now() + interval '2 hours'";
  await sql.unsafe(`INSERT INTO auth_sessions(token_hash, user_id, expires_at) VALUES ('${createHash('sha256').update(token).digest('hex')}', ${user.id}, ${expiry})`);
  const payload = Buffer.from(JSON.stringify({ v: 1, kind: 'admin', sub: `${user.id}:${token}`, exp: Math.floor(Date.now() / 1000) + 7200, epoch: 1 })).toString('base64url');
  const cookie = `${payload}.${createHmac('sha256', secret).update(Buffer.from(payload, 'base64url')).digest('base64url')}`;
  return { name, email, role, id: user.id, cookie };
};

const browser = await chromium.launch({ headless: true });
let external = 0;
const newContext = async (actor: Actor | null): Promise<BrowserContext> => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'afldb_consent', value: 'declined', url: baseURL, sameSite: 'Lax' }]);
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { external += 1; return route.abort(); }
    return route.continue();
  });
  if (actor?.cookie) await context.addCookies([{ name: 'afldb_admin', value: actor.cookie, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
  return context;
};

/* ---------------------------- Server Action capture / replay ---------------------------- */

type Captured = { url: string; headers: Record<string, string>; body: Buffer };
const wire = (page: Page, sink: Captured[]): void => {
  page.on('request', (request) => {
    const headers = request.headers();
    if (request.method() === 'POST' && headers['next-action'] && request.postDataBuffer()) {
      sink.push({ url: request.url(), headers, body: request.postDataBuffer() as Buffer });
    }
  });
};

/** Replace one form field (React prefixes the FormData entries `_1_`) in a captured multipart body. */
const withField = (body: Buffer, field: string, value: string): Buffer => {
  const text = body.toString('latin1');
  const pattern = new RegExp(`(name="_1_${field}"\\r\\n\\r\\n)([\\s\\S]*?)(\\r\\n--)`);
  if (!pattern.test(text)) throw new Error(`field ${field} not found in the captured action body`);
  return Buffer.from(text.replace(pattern, (_m, a: string, _b: string, c: string) => `${a}${Buffer.from(value, 'utf8').toString('latin1')}${c}`), 'latin1');
};
const withFields = (body: Buffer, fields: Record<string, string>): Buffer =>
  Object.entries(fields).reduce((acc, [name, value]) => withField(acc, name, value), body);

type Replay = { status: number; location: string | null; actionRedirect: string | null; text: string; code: string | null; ok: boolean | null };
const replay = async (
  template: Captured, body: Buffer, actor: Actor | null, extraHeaders: Record<string, string> = {},
): Promise<Replay> => {
  const headers: Record<string, string> = {};
  for (const key of ['next-action', 'content-type', 'accept', 'next-router-state-tree', 'origin', 'referer']) {
    if (template.headers[key] !== undefined) headers[key] = template.headers[key];
  }
  if (actor?.cookie) headers.cookie = `afldb_admin=${actor.cookie}; afldb_consent=declined`;
  Object.assign(headers, extraHeaders);
  for (const [key, value] of Object.entries(headers)) if (value === '') delete headers[key];
  const response = await fetch(template.url, { method: 'POST', headers, body: new Uint8Array(body), redirect: 'manual' });
  const text = await response.text();
  const code = /"code":"([a-z_]+)"/.exec(text)?.[1] ?? null;
  const ok = /"ok":true/.test(text) ? true : /"ok":false/.test(text) ? false : null;
  return { status: response.status, location: response.headers.get('location'), actionRedirect: response.headers.get('x-action-redirect'), text, code, ok };
};
const brief = (r: Replay) => ({ status: r.status, redirect: r.actionRedirect ?? r.location, code: r.code, ok: r.ok });

const fill = async (page: Page, playerId: number, verdict: string, citation: string, note: string): Promise<void> => {
  const form = page.locator(`[data-review-player="${playerId}"] form`);
  await form.locator(`input[name="verdict"][value="${verdict}"]`).check();
  await form.locator('input[name="citation"]').fill(citation);
  await form.locator('textarea[name="note"]').fill(note);
};

const VALID_NOTE = 'Synthetic ruling recorded by the operations check to exercise the audited decision path.';
const CITATION = 'https://example.invalid/operations-check';
const cleanup: string[] = [];

try {
  const [facts] = await sql.unsafe(ISOLATED_SERVER_FACTS_SQL);
  const findings = checkIsolatedTestServer(database, { clusterName: facts.cluster_name, databaseComment: facts.database_comment, currentDatabase: facts.current_database });
  record('environment-isolated-live-proof', findings.length === 0, 'live server identity proof passes', { database });

  const actors = {
    contributor: await makeActor('contributor', 'contributor', { manage: false }),
    admin: await makeActor('admin', 'admin', { manage: false }),
    adminManager: await makeActor('admin-manager', 'admin', { manage: true }),
    superA: await makeActor('super-a', 'super_admin'),
    superB: await makeActor('super-b', 'super_admin'),
    disabled: await makeActor('super-disabled', 'super_admin', { disabled: true }),
    expired: await makeActor('super-expired', 'super_admin', { expired: true }),
  };

  /* ---- scenario: the season leader's eligibility is NOT recorded ------------------
   * The restored 2025 rows carry a recorded eligible_rank for every player, so the determination is
   * already 'determined' and offers no decision form. To exercise the decision workflow the
   * disposable copy is put in the state the operator workflow exists for: the leader's stored
   * eligibility statement is absent (eligible_rank NULL). Raw votes are untouched; this is a
   * fixture, not a historical fact, and is applied to this disposable database only. */
  const [{ leader }] = await sql`SELECT player_id::int AS leader FROM brownlow_season_votes WHERE season = ${season} ORDER BY votes DESC, player_id LIMIT 1`;
  await sql`UPDATE brownlow_season_votes SET eligible_rank = NULL WHERE season = ${season} AND player_id = ${leader}`;
  const disagreeing = (await sql`SELECT DISTINCT v.player_id::int AS id FROM staging.afl_api_brownlow_vote v
     WHERE v.season = ${season} AND v.eligible = false
       AND EXISTS (SELECT 1 FROM external_identities e JOIN sources s ON s.id = e.source_id
                    WHERE e.player_id = v.player_id AND s.key = 'afltables' AND e.match_method = 'afltables_profile_url' AND e.status IN ('unique','resolved'))
     ORDER BY 1`).map((r) => r.id as number);
  record('scenario-setup', disagreeing.length >= 6, 'leader eligibility unrecorded; at least six identified vote-getters for replay targets', { leader, replayTargets: disagreeing.length });

  /* ---- A. page access by role -------------------------------------------------- */
  const access: Record<string, unknown> = {};
  for (const [name, actor] of [['anonymous', null], ...Object.entries(actors)] as [string, Actor | null][]) {
    const context = await newContext(actor);
    const page = await context.newPage();
    const response = await page.goto(`${baseURL}${PAGE}`, { waitUntil: 'domcontentloaded' });
    const path = new URL(page.url()).pathname;
    const onPage = path === '/admin/operations/brownlow';
    const forms = onPage ? await page.locator('[data-review-player] form').count() : 0;
    const readOnlyNotes = onPage ? await page.locator('[data-decision-unavailable="role"]').count() : 0;
    access[name] = { status: response?.status(), landed: path, reviewForms: forms, readOnlyNotes };
    await context.close();
  }
  const allowedRead = ['admin', 'adminManager', 'superA', 'superB'];
  const readPolicy = Object.entries(access).every(([name, a]) => {
    const row = a as { landed: string; reviewForms: number; readOnlyNotes: number };
    const onPage = row.landed === '/admin/operations/brownlow';
    if (!allowedRead.includes(name)) return !onPage;
    return onPage && (name.startsWith('super') ? row.reviewForms > 0 && row.readOnlyNotes === 0 : row.reviewForms === 0 && row.readOnlyNotes > 0);
  });
  record('role-policy-page', readPolicy, 'read: admin/super; decision forms: super only; anonymous/contributor/disabled/expired cannot open the page', access);

  /* ---- B. real UI: refused input, capture the genuine action request ------------ */
  const context = await newContext(actors.superA);
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(60_000);
  const captured: Captured[] = [];
  wire(page, captured);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${baseURL}${PAGE}`, { waitUntil: 'networkidle' });
  const status0 = await page.locator('[data-brownlow-determination]').getAttribute('data-medal-status');
  const reviewIds = (await page.locator('[data-review-player]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-review-player')))));
  record('determination-before-decisions', reviewIds.length === 1 && reviewIds[0] === leader && status0 === 'requires_review', 'the leader requires review and is offered the only form', { status: status0, reviewPlayers: reviewIds.length });
  const P1 = reviewIds[0];
  const [P2, P3, P4, P5, P6] = disagreeing.slice(0, 5);
  void P3;

  // The production build persists its ISR output on disk across restarts, so the page may hold a
  // previous run's winner. Use the product's own refresh route (Super Admin) to start from the database.
  const refreshStatus = await refreshPublic(actors.superA);
  const publicBeforeCheck = await publicFollows();
  record('public-baseline-matches-database', refreshStatus === 200 && publicBeforeCheck.requests !== null, 'after the product refresh route the public page announces the stored winner', publicBeforeCheck);
  const base0 = await state();

  // UI-side shape check (client validation is bypassed by a short-but-nonempty note, so the server answers).
  await fill(page, P1, 'ineligible', CITATION, 'too short note');
  await page.evaluate(() => document.querySelectorAll('textarea[name="note"]').forEach((el) => el.removeAttribute('minlength')));
  await page.locator(`[data-review-player="${P1}"] button[type="submit"]`).click();
  await page.waitForSelector('[data-review-player] [role="alert"], [data-review-player] .field-error, [data-review-player] [data-field-error]', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const shortNoteText = await page.locator(`[data-review-player="${P1}"]`).innerText();
  const afterShort = await state();
  record('ui-invalid-note-refused', /at least 20 characters/i.test(shortNoteText) && captured.length >= 1, 'server refuses a note under 20 characters and the form stays', { captured: captured.length });
  record('ui-invalid-note-no-change', same(base0.raw, afterShort.raw) && same(base0.pub, afterShort.pub), 'no raw or published change; no decision row', { auditDelta: afterShort.audit - base0.audit });
  const template = captured[0];
  if (!template) throw new Error('the real Server Action request was not captured');
  record('action-wire-captured', template.headers['next-action'] !== undefined && /multipart\/form-data/.test(template.headers['content-type'] ?? ''), 'a genuine Next Server Action request was captured', {
    method: 'POST', hasOrigin: template.headers.origin !== undefined, path: new URL(template.url).pathname,
  });

  console.log('captured action field names:', [...template.body.toString('latin1').matchAll(/name="([^"]+)"/g)].map((m) => m[1]).join(','));
  const validBody = (playerId: number, extra: Record<string, string> = {}): Buffer =>
    withFields(template.body, { season: String(season), playerId: String(playerId), verdict: 'ineligible', citation: CITATION, note: VALID_NOTE, expectedCurrentDecisionId: '', ...extra });

  /* ---- C. unauthorised replays: no change -------------------------------------- */
  const unauthorised: Record<string, unknown> = {};
  let unauthorisedClean = true;
  for (const [name, actor] of [['anonymous', null], ['contributor', actors.contributor], ['admin', actors.admin], ['adminManager', actors.adminManager], ['disabled', actors.disabled], ['expired', actors.expired]] as [string, Actor | null][]) {
    const before = await state();
    const r = await replay(template, validBody(P2), actor);
    const after = await state();
    const unchanged = same(before.raw, after.raw) && same(before.pub, after.pub);
    unauthorisedClean &&= unchanged && r.ok !== true;
    unauthorised[name] = { ...brief(r), unchanged, auditDelta: after.audit - before.audit };
  }
  record('unauthorised-action-replays-change-nothing', unauthorisedClean, 'anonymous/contributor/admin/delegated-admin/disabled/expired: no decision, no publication, no raw change', unauthorised);

  /* ---- D. origin / CSRF -------------------------------------------------------- */
  const beforeOrigin = await state();
  const evil = await replay(template, validBody(P2), actors.superA, { origin: 'https://evil.example' });
  const afterEvil = await state();
  record('action-foreign-origin-refused', same(beforeOrigin.pub, afterEvil.pub) && same(beforeOrigin.raw, afterEvil.raw) && evil.ok !== true, 'a Server Action POST from a foreign Origin makes no change', brief(evil));
  const noOrigin = await replay(template, validBody(P2), actors.superA, { origin: '', referer: '' });
  const afterNoOrigin = await state();
  const noOriginCommitted = !same(beforeOrigin.pub, afterNoOrigin.pub);
  record('action-missing-origin-behaviour', true, 'documented: framework behaviour when Origin is absent (browsers always send it on cross-site POST)', { ...brief(noOrigin), committed: noOriginCommitted });
  if (noOriginCommitted) {
    // The probe committed a real decision for P2: it is part of the ledger from here on.
    cleanup.push('missing-origin probe committed a decision for P2');
  }
  const revalUnauth = await fetch(`${baseURL}/admin/operations/brownlow/revalidate`, { method: 'POST', redirect: 'manual' });
  const revalAdmin = await fetch(`${baseURL}/admin/operations/brownlow/revalidate`, { method: 'POST', redirect: 'manual', headers: { cookie: `afldb_admin=${actors.admin.cookie}` } });
  const revalEvil = await fetch(`${baseURL}/admin/operations/brownlow/revalidate`, { method: 'POST', redirect: 'manual', headers: { cookie: `afldb_admin=${actors.superA.cookie}`, origin: 'https://evil.example' } });
  record('revalidate-route-requires-capability', revalUnauth.status !== 200 && revalAdmin.status !== 200, 'anonymous and plain admin cannot POST the public-refresh route', { anonymous: revalUnauth.status, admin: revalAdmin.status });
  const afterReval = await state();
  record('revalidate-route-foreign-origin-observed', same(beforeOrigin.raw, afterReval.raw) && same(afterNoOrigin.pub, afterReval.pub), 'observation: the public-refresh route performs no Origin check (as every sibling revalidate route); it writes nothing, and the SameSite=Lax session cookie is not sent on a cross-site POST', { statusWithForeignOrigin: revalEvil.status });

  /* ---- E. successful decision through the real UI -------------------------------- */
  const target = P1;
  const beforeOk = await state();
  const decisionsBefore = (await decisionRows()).length;
  const revalidateCalls: number[] = [];
  page.on('response', (response) => { if (response.url().endsWith('/admin/operations/brownlow/revalidate')) revalidateCalls.push(response.status()); });
  await page.goto(`${baseURL}${PAGE}`, { waitUntil: 'networkidle' });
  await fill(page, target, 'ineligible', CITATION, VALID_NOTE);
  const actionsBefore = captured.length;
  await page.locator(`[data-review-player="${target}"] button[type="submit"]`).click();
  await page.waitForSelector('[data-decision-result]', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const resultText = await page.locator('[data-decision-result]').innerText();
  const afterOk = await state();
  const rows = await decisionRows();
  const newRows = rows.slice(decisionsBefore);
  const decided = newRows.find((row) => row.player_id_at_decision === target);
  record('ui-decision-recorded', decided !== undefined && decided.verdict === 'ineligible' && decided.decided_by === actors.superA.id, 'one decision row, verdict as submitted, decided_by the signed-in Super Admin', { rows: newRows.length, basis: decided?.basis, superseded: decided?.supersedes_id });
  record('ui-decision-sealed-season-audited-correction', decided?.basis === 'audited_correction' && decided.correction !== null, `season ${season} is sealed: the decision is an audited correction`, { basis: decided?.basis });
  record('ui-decision-raw-votes-unchanged', same(beforeOk.raw, afterOk.raw), 'round votes, season totals, staged votes and matches are identical', null);
  const publishChanged = !same(beforeOk.pub.flags, afterOk.pub.flags);
  record('ui-decision-publishes-metadata', publishChanged && !same(beforeOk.pub.authority, afterOk.pub.authority), 'eligibility flags/ranks changed and exactly the publication data_edits row was added', { flagsChanged: publishChanged });
  const [{ n: authorityRows }] = await sql`SELECT count(*)::int AS n FROM data_edits WHERE table_name = 'brownlow_season_authority' AND field_group = 'eligibility_publication' AND admin_user_id = ${actors.superA.id}`;
  record('ui-decision-publication-audited-with-actor', authorityRows >= 1, 'the publication data_edits row names the acting Super Admin', { rows: authorityRows });
  const auditRows = await sql`SELECT actor_user_id, action, detail FROM auth_audit_log WHERE action = 'admin.brownlow_eligibility_decided' ORDER BY id DESC LIMIT 1`;
  record('ui-decision-activity-audit-row', auditRows.length === 1 && auditRows[0].actor_user_id === actors.superA.id && afterOk.audit - beforeOk.audit === 1, 'exactly one admin.brownlow_eligibility_decided auth_audit_log row for the actor', { delta: afterOk.audit - beforeOk.audit });
  record('ui-decision-revalidate-fired', revalidateCalls.length === 1 && revalidateCalls[0] === 200, 'the page asked the server to refresh the public cache once, and it succeeded', { calls: revalidateCalls });
  record('ui-decision-feedback', /Decision #\d+ recorded/.test(resultText), 'the administrator is told the decision id and its effect', { text: resultText.slice(0, 160) });
  const publicAfterUi = await publicFollows();
  record('public-page-refreshed', publicAfterUi.requests !== null && JSON.stringify(publicAfterUi.shown) !== JSON.stringify(publicBeforeCheck.shown),
    'after the UI decision the public season page announces the new stored winner without waiting for the hourly cache',
    { requestsUntilFollowed: publicAfterUi.requests, before: publicBeforeCheck.shown, after: publicAfterUi.shown });
  const successTemplate = template; // the first capture: later captures carry the previous action state in field 0
  void actionsBefore;

  /* ---- F. repeated request (exact replay of the successful submission) ----------- */
  const beforeRepeat = await state();
  const repeat = await replay(successTemplate, validBody(target), actors.superA);
  const afterRepeat = await state();
  record('repeat-request-refused-as-stale', repeat.code === 'stale_decision' && same(beforeRepeat.pub, afterRepeat.pub) && same(beforeRepeat.raw, afterRepeat.raw), 'a repeated identical request is refused stale_decision and publishes nothing', brief(repeat));
  record('repeat-request-audited-as-refusal', afterRepeat.audit - beforeRepeat.audit === 1 && (await auditCount('admin.brownlow_eligibility_refused')) >= 1, 'exactly one refusal row, no second "decided" row', { delta: afterRepeat.audit - beforeRepeat.audit });

  /* ---- G. revision ------------------------------------------------------------- */
  const currentId = (await decisionRows()).filter((row) => row.player_id_at_decision === target).pop()!.id;
  const beforeRev = await state();
  const rev = await replay(successTemplate, validBody(target, { verdict: 'eligible', expectedCurrentDecisionId: String(currentId) }), actors.superB);
  const afterRev = await state();
  const chain = (await decisionRows()).filter((row) => row.player_id_at_decision === target);
  record('revision-supersedes', rev.ok === true && chain.length === 2 && chain[1].supersedes_id === chain[0].id && chain[1].decided_by === actors.superB.id && chain[1].verdict === 'eligible', 'a second Super Admin supersedes the first decision; the chain is linear and both rows survive', { rows: chain.length, ...brief(rev) });
  const stalePublic = await publicWinners();
  const revisionDb = await dbWinners();
  const staleBeforeRefresh = JSON.stringify(stalePublic) !== JSON.stringify(revisionDb);
  const reRefreshed = await refreshPublic(actors.superB);
  const afterRefresh = await publicFollows();
  record('public-refresh-is-a-browser-follow-up', afterRefresh.requests !== null, 'observation: a decision committed without the browser follow-up leaves the public page on the previous winner until the refresh route runs (or the hourly revalidation); the refresh route then brings it level', { publicStaleAfterReplayedRevision: staleBeforeRefresh, shownBeforeRefresh: stalePublic, db: revisionDb, refreshStatus: reRefreshed, requestsAfterRefresh: afterRefresh.requests });
  record('revision-republishes', !same(beforeRev.pub.flags, afterRev.pub.flags) && same(beforeRev.raw, afterRev.raw), 'the published metadata follows the revision; raw votes unchanged', null);
  const staleRev = await replay(successTemplate, validBody(target, { verdict: 'ineligible', expectedCurrentDecisionId: String(currentId) }), actors.superA);
  const afterStale = await state();
  record('revision-with-stale-expectation-refused', staleRev.code === 'stale_decision' && same(afterRev.pub, afterStale.pub), 'revising against a superseded decision id is refused', brief(staleRev));
  const [{ n: linearBreaks }] = await sql`SELECT count(*)::int AS n FROM (SELECT supersedes_id FROM brownlow_eligibility_decisions WHERE supersedes_id IS NOT NULL GROUP BY supersedes_id HAVING count(*) > 1) x`;
  record('ledger-chain-linear', linearBreaks === 0, 'no decision is superseded twice', { breaks: linearBreaks });

  /* ---- H. invalid / refused inputs --------------------------------------------- */
  const noVotes = (await sql`SELECT p.id::int AS id FROM players p WHERE NOT EXISTS (SELECT 1 FROM brownlow_season_votes b WHERE b.season = ${season} AND b.player_id = p.id AND b.votes > 0) AND NOT EXISTS (SELECT 1 FROM staging.afl_api_brownlow_vote v WHERE v.season = ${season} AND v.player_id = p.id) AND EXISTS (SELECT 1 FROM external_identities e JOIN sources s ON s.id = e.source_id WHERE e.player_id = p.id AND s.key = 'afltables' AND e.match_method = 'afltables_profile_url' AND e.status IN ('unique','resolved')) ORDER BY p.id LIMIT 1`)[0].id as number;
  const cases: [string, Record<string, string>, string][] = [
    ['unknown-player', { playerId: '99999999' }, 'unknown_player'],
    ['non-vote-getter', { playerId: String(noVotes) }, 'player_not_vote_getter'],
    ['season-out-of-range', { season: '1700' }, 'invalid_input'],
    ['verdict-invalid', { verdict: 'maybe' }, 'invalid_input'],
    ['citation-empty', { citation: '' }, 'invalid_input'],
    ['citation-too-long', { citation: 'x'.repeat(2001) }, 'invalid_input'],
    ['note-19-chars', { note: 'x'.repeat(19) }, 'invalid_input'],
    ['expected-id-not-numeric', { expectedCurrentDecisionId: 'abc' }, 'invalid_input'],
    ['player-id-not-numeric', { playerId: '12abc' }, 'invalid_input'],
  ];
  let refusalsClean = true; const refusalDetail: Record<string, unknown> = {};
  for (const [name, fields, wantCode] of cases) {
    const before = await state();
    const r = await replay(successTemplate, validBody(P4, fields), actors.superA);
    const after = await state();
    const unchanged = same(before.raw, after.raw) && same(before.pub, after.pub);
    const okCode = r.ok === false || r.code !== null;
    refusalsClean &&= unchanged && okCode && r.ok !== true;
    refusalDetail[name] = { ...brief(r), wantCode, unchanged, auditDelta: after.audit - before.audit };
  }
  record('invalid-input-refused-without-change', refusalsClean, 'every invalid or unresolvable request is refused with no decision and no publication', refusalDetail);
  const codesMatch = cases.every(([name, , want]) => (refusalDetail[name] as { code: string | null }).code === want || (want === 'invalid_input' && (refusalDetail[name] as { code: string | null }).code === 'invalid_input'));
  record('invalid-input-codes-as-documented', codesMatch, 'service refusals carry the documented codes', Object.fromEntries(cases.map(([n]) => [n, (refusalDetail[n] as { code: string | null }).code])));
  const auditByCase = Object.fromEntries(cases.map(([n]) => [n, (refusalDetail[n] as { auditDelta: number }).auditDelta]));
  record('invalid-input-audit-behaviour', true, 'recorded: which refusals write an activity-audit row (service refusals do; shape failures before the service do not)', auditByCase);

  /* ---- I. transactional failure: publication fails after the decision insert ------ */
  const beforeFail = await state();
  await sql.unsafe(`CREATE OR REPLACE FUNCTION pg_temp_noop() RETURNS void LANGUAGE sql AS 'select 1'`).catch(() => undefined);
  await sql.unsafe(`CREATE FUNCTION public.zz_brownlow_check_fail_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected publication failure'; END $$`);
  await sql.unsafe(`CREATE TRIGGER zz_brownlow_check_fail_publication BEFORE INSERT ON data_edits FOR EACH ROW WHEN (NEW.table_name = 'brownlow_season_authority') EXECUTE FUNCTION public.zz_brownlow_check_fail_publication()`);
  let failed: Replay;
  try {
    failed = await replay(successTemplate, validBody(P4), actors.superA);
  } finally {
    await sql.unsafe('DROP TRIGGER IF EXISTS zz_brownlow_check_fail_publication ON data_edits');
    await sql.unsafe('DROP FUNCTION IF EXISTS public.zz_brownlow_check_fail_publication()');
  }
  const afterFail = await state();
  record('failed-publication-rolls-back-decision', failed.ok !== true && same(beforeFail.pub, afterFail.pub) && same(beforeFail.raw, afterFail.raw), 'a publication failure leaves no decision row, no flag change and no data_edits row', brief(failed));
  record('failed-publication-audited-as-refusal', afterFail.audit - beforeFail.audit === 1, 'the failed attempt is recorded once as a refusal', { delta: afterFail.audit - beforeFail.audit });
  const retry = await replay(successTemplate, validBody(P4), actors.superA);
  const afterRetry = await state();
  record('retry-after-failure-succeeds-once', retry.ok === true && (await decisionRows()).filter((row) => row.player_id_at_decision === P4).length === 1, 'after the fault is cleared the same request commits exactly once', brief(retry));
  void afterRetry;

  /* ---- J. activity audit unavailable: decision stands, operator is warned --------- */
  {
    await sql.unsafe(`CREATE FUNCTION public.zz_brownlow_check_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$`);
    await sql.unsafe(`CREATE TRIGGER zz_brownlow_check_fail_audit BEFORE INSERT ON auth_audit_log FOR EACH ROW WHEN (NEW.action = 'admin.brownlow_eligibility_decided') EXECUTE FUNCTION public.zz_brownlow_check_fail_audit()`);
    let warned: Replay;
    const beforeAudit = await state();
    try {
      warned = await replay(successTemplate, validBody(P5), actors.superA);
    } finally {
      await sql.unsafe('DROP TRIGGER IF EXISTS zz_brownlow_check_fail_audit ON auth_audit_log');
      await sql.unsafe('DROP FUNCTION IF EXISTS public.zz_brownlow_check_fail_audit()');
    }
    const afterAudit = await state();
    record('audit-failure-does-not-undo-decision', warned.ok === true && /auditWarning/.test(warned.text) && afterAudit.audit === beforeAudit.audit && !same(beforeAudit.pub.decisions, afterAudit.pub.decisions), 'the decision commits, the audit row is missing and the operator receives auditWarning', brief(warned));
  }

  /* ---- K. concurrency ------------------------------------------------------------ */
  {
    const beforeRace = (await decisionRows()).filter((row) => row.player_id_at_decision === P6).length;
    const [a, b] = await Promise.all([
      replay(successTemplate, validBody(P6, { verdict: 'ineligible' }), actors.superA),
      replay(successTemplate, validBody(P6, { verdict: 'eligible' }), actors.superB),
    ]);
    const afterRace = (await decisionRows()).filter((row) => row.player_id_at_decision === P6);
    record('concurrent-decisions-one-wins', afterRace.length - beforeRace === 1 && [a, b].filter((r) => r.ok === true).length === 1 && [a, b].some((r) => r.code === 'stale_decision'), 'two simultaneous first decisions: one commits, the other is refused stale', { a: brief(a), b: brief(b) });
  }

  /* ---- L. ledger / audit consistency ------------------------------------------- */
  const [{ decidedAudit }] = await sql`SELECT count(*)::int AS "decidedAudit" FROM auth_audit_log WHERE action = 'admin.brownlow_eligibility_decided'`;
  const ledger = await decisionRows();
  const auditGap = ledger.length - decidedAudit;
  record('ledger-vs-audit-consistent', auditGap === 1, 'every committed decision has a "decided" audit row except the one committed with the audit deliberately failed', { decisions: ledger.length, decidedAuditRows: decidedAudit });
  const flags = await sql`SELECT count(*)::int AS n FROM brownlow_season_votes WHERE season = ${season} AND is_winner AND is_ineligible`;
  record('published-flags-coherent', flags[0].n === 0, 'no player is published as both winner and ineligible', null);
  const finalRaw = await rawFingerprint();
  const baseRaw = base0.raw;
  record('raw-votes-unchanged-throughout', same(finalRaw, baseRaw), 'raw votes, staged votes and matches are identical after every operation in this check', null);

  record('page-errors-and-external-requests', pageErrors.length === 0 && external === 0, 'no uncaught browser error; no non-loopback request', { pageErrors: pageErrors.length, external });
  if (captureDir) {
    mkdirSync(captureDir, { recursive: true });
    await page.goto(`${baseURL}${PAGE}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${captureDir}/brownlow-operations-after.png`, fullPage: false });
  }
  await context.close();
} finally {
  await sql.unsafe('DROP TRIGGER IF EXISTS zz_brownlow_check_fail_publication ON data_edits').catch(() => undefined);
  await sql.unsafe('DROP TRIGGER IF EXISTS zz_brownlow_check_fail_audit ON auth_audit_log').catch(() => undefined);
  await sql.unsafe('DROP FUNCTION IF EXISTS public.zz_brownlow_check_fail_publication()').catch(() => undefined);
  await sql.unsafe('DROP FUNCTION IF EXISTS public.zz_brownlow_check_fail_audit()').catch(() => undefined);
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  writeFileSync(out, `${JSON.stringify({ season, database, baseURL, passed: results.length - failed.length, failed: failed.length, notes: cleanup, results }, null, 2)}\n`, { flag: 'wx' });
  console.log(`\nSUMMARY passed=${results.length - failed.length} failed=${failed.length} -> ${out}`);
  await sql.end({ timeout: 5 });
  process.exitCode = failed.length === 0 ? 0 : 1;
}
