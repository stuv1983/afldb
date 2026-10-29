/**
 * The staged AFL API Brownlow leaderboard and the derived 18-team provider mapping on the CORRECTED candidate,
 * produced from the existing SYNTHETIC AFL API fixtures by the existing settle writers. Local only; the successor of
 * candidate-visual-corrected.mts for the one state that run could not show (owner sheet §4).
 *
 *   node node_modules/tsx/dist/cli.mjs tools/v2/candidate-visual-leaderboard.mts <new-output-dir> [--recheck-refused]
 *
 * `--recheck-refused` runs on a clone the full run already staged: it re-stages the refused leaderboard with the same
 * writer, captures LB1 again with its findings expanded, then restores the resolved leaderboard and recaptures LB2.
 *
 * Runs inside `isolated-pg.ts run afldb_v2_visual_leaderboard_test` (a disposable clone of afldb_v2_visual2_test)
 * against the V2 production build serving on 127.0.0.1:3912 from the SAME database. It refuses any other database,
 * and refuses to start unless the standalone bundle holds the season registry, the Coleman contract and the provider
 * identities byte-identical to the repository files.
 *
 * PRODUCER. The three AFL API settle CLIs refuse every writing mode for a sealed season before opening a connection
 * (V2-GAP-006, settle-season-seal.ts), and every season with an AFL API vocabulary (2022-2026) is sealed. That refusal
 * is exercised and logged first and is not bypassed. The state is then produced exactly as
 * tests/integration/settle-afl-api-brownlow.test.ts produces it: synthetic voters with afl_api bridge rows, the real
 * match-family writer `runSettleAflApi` over tests/fixtures/afl_api/match (re-keyed to one synthetic provider match,
 * `inProgressSeasons: [2026]` as that suite passes, so its canonical match write is admitted), then the real Brownlow
 * writer `runSettleAflApiBrownlow` over tests/fixtures/afl_api/brownlow with `apply: true, autoApply: false` and the
 * registry's own in-progress seasons: it stages the vote set, its typed projection and the leaderboard, and writes no
 * canonical Brownlow row. Both writers run as afldb_import. No guard, medal rule or page query is changed or mocked.
 *
 * Every fixture and writer call is a named step whose expected effect is logged beside the observed per-table change.
 * External requests are blocked and counted, in the browser and in this process. Fixture sessions are local
 * `@example.invalid` identities and are never printed.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import https from 'node:https';
import { writeFileSync, mkdirSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { chromium } from '@playwright/test';
import { checkIsolatedTestDsn, checkIsolatedTestServer, ISOLATED_SERVER_FACTS_SQL } from '@afldb/domain';
import { emitAflApiBrownlowLeaderboard, emitAflApiBrownlowMatchVotes, parseAflApiIdentities } from '../../src/lib/acquisition/afl-api-bundle';
import { runSettleAflApiBrownlow } from '../../src/lib/acquisition/afl-api-brownlow';
import { buildAflApiSettleBundle, runSettleAflApi } from '../../src/lib/acquisition/settle-afl-api';
import { parseSourceFamilyRegistry } from '../../src/lib/acquisition/source-families';
import { refuseSealedSeasonForSettle } from '../current-season/settle-season-seal';

const TARGET = 'afldb_v2_visual_leaderboard_test';
const EXPECTED_BUILD = 'XtSgl4BOQZXC2G8qIWJdV';
const [outDir] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const RECHECK = process.argv.includes('--recheck-refused');
if (!outDir || existsSync(outDir)) throw new Error('usage: candidate-visual-leaderboard.mts <new-output-dir> (must not exist)');
const dsn = process.env.AFLDB_TEST_DATABASE_URL ?? '';
const importDsn = process.env.AFLDB_IMPORT_DATABASE_URL ?? '';
const port = Number(process.env.AFLDB_V2_ISOLATED_PORT);
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || checkIsolatedTestDsn(dsn, port).length || checkIsolatedTestDsn(importDsn, port).length) {
  throw new Error('Isolated runner required');
}
const database = new URL(dsn).pathname.slice(1);
if (database !== TARGET || new URL(importDsn).pathname.slice(1) !== TARGET) throw new Error(`This run writes its target: only ${TARGET} is approved`);

// No provider request can leave this process: the writers read only the in-memory fixtures below.
const nodeBlocked = { count: 0 };
const refuseNetwork = (what: string) => (): never => {
  nodeBlocked.count += 1;
  throw new Error(`external network blocked (${what})`);
};
globalThis.fetch = refuseNetwork('fetch') as unknown as typeof fetch;
https.request = refuseNetwork('https.request') as unknown as typeof https.request;
https.get = refuseNetwork('https.get') as unknown as typeof https.get;

const sql = postgres(dsn, { max: 1, onnotice: () => {} });
const importSql = postgres(importDsn, { max: 1, onnotice: () => {}, transform: { undefined: null } });
const secret = createHash('sha256').update(process.env.AFLDB_TEST_AUTH_DATABASE_URL ?? '').digest('hex');
const baseURL = 'http://127.0.0.1:3912';
const DESKTOP = { width: 1280, height: 800, label: 'desktop-1280x800' };
const MOBILE = { width: 390, height: 844, label: 'mobile-390x844' };
const REFERENCE = ['seasons.json', 'coleman-derivation.json', 'afl-api-identities.json'];
const IDENTITIES = resolve('.next/standalone/data/reference/afl-api-identities.json');
const HISTORY = ['award_proposals', 'award_proposal_decisions', 'award_winners', 'derived_award_results',
  'derived_award_projections', 'brownlow_season_votes', 'brownlow_round_votes', 'brownlow_eligibility_decisions',
  'data_edits', 'data_issues', 'data_submissions', 'data_submission_rows', 'matches', 'player_match_stats',
  'match_period_scores', 'players', 'external_identities', 'import_batches', 'canonical_applications',
  'promotion_candidates', 'import_rejections', 'staging.source_records', 'staging.source_record_versions',
  'staging.afl_api_match', 'staging.afl_api_player_match', 'staging.afl_api_brownlow_vote'];
/** Text a V2-GAP-037 refusal must never render: the OS error and any part of the bundle's absolute path. */
const LEAKS = ['ENOENT', 'no such file', 'standalone', resolve('.'), 'could not be read:'];

/** The synthetic provider namespace of this run; appears nowhere else in the repository or the clone. */
const SEASON = 2026;
const MATCH = 'CD_M2026V2VLBP';
const MATCH_DATE = '2026-09-24';
/** `afl_api_2026` API round 5 = 'Rd 5' = canonical home-and-away round 6 (the fixture's round 28 is a final). */
const API_ROUND = 5;
/** The leaderboard fixture's own synthetic players, given canonical players and afl_api bridges here. */
const VOTERS = [
  { providerId: 'CD_I900001', given: 'Alpha', legacyId: -291029001 },
  { providerId: 'CD_I900002', given: 'Bravo', legacyId: -291029002 },
  { providerId: 'CD_I900003', given: 'Charlie', legacyId: -291029003 },
];
/** Added to the first staged leaderboard only: no canonical identity, on a provider team with no committed identity. */
const UNRESOLVED_PLAYER = 'CD_I900099';
const UNMAPPED_TEAM = 'CD_T9990';
const FIXTURES = {
  fixture: 'tests/fixtures/afl_api/match/01-fixture-result.json',
  stats: 'tests/fixtures/afl_api/match/02-player-stats.raw.json',
  roster: 'tests/fixtures/afl_api/match/03-match-roster.raw.json',
  season: 'tests/fixtures/afl_api/brownlow/01-brownlow-season-round.json',
  leaderboard: 'tests/fixtures/afl_api/brownlow/02-brownlow-leaderboard-sample.json',
} as const;
type Role = 'super_admin' | 'admin' | 'anonymous';
type Checks = { present?: string[]; absent?: string[]; text?: string[]; forbid?: string[]; count?: Record<string, number>; status?: number };

const log: string[] = [];
const failures: string[] = [];
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readFixture = (key: keyof typeof FIXTURES): any => JSON.parse(readFileSync(resolve(FIXTURES[key]), 'utf8'));
const json = (value: unknown) => JSON.stringify(value);

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
  let userId: number | null = null;
  if (role !== 'anonymous') {
    const email = `candidate-visual-${role}@example.invalid`;
    const [user] = await sql`SELECT id,role FROM auth_users WHERE email=${email}`;
    if (!user || user.role !== role) throw new Error('Fixture identity missing or has an unexpected role');
    userId = Number(user.id);
    const token = randomBytes(32).toString('base64url');
    await sql`INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(${createHash('sha256').update(token).digest('hex')},${user.id},now()+interval '4 hours')`;
    const payload = Buffer.from(JSON.stringify({ v: 1, kind: 'admin', sub: `${user.id}:${token}`,
      exp: Math.floor(Date.now() / 1000) + 14400, epoch: 1 })).toString('base64url');
    await context.addCookies([{ name: 'afldb_admin', value: `${payload}.${createHmac('sha256', secret).update(Buffer.from(payload, 'base64url')).digest('base64url')}`,
      url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
  }
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(60_000);
  page.setDefaultTimeout(30_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return { role, context, page, errors, counter, userId };
}
type Session = Awaited<ReturnType<typeof signIn>>;

/**
 * The page's visible text with CSS `text-transform` neutralised, whitespace-normalised. `innerText` returns the
 * RENDERED case, so an uppercased badge or table header ("UNKNOWN (NOT RECORDED)") never matched the authored words
 * the checks name: the two L1 failures of candidate-visual-corrected.mts. Scripts and hidden elements stay excluded.
 */
async function authoredText(s: Session): Promise<string> {
  // Through the CSSOM, which the page's CSP does not restrict (an injected <style> element would be refused).
  const text = await s.page.evaluate(() => {
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
  });
  return text.replace(/\s+/g, ' ');
}

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
  const body = await authoredText(s);
  const failed: string[] = [];
  for (const selector of checks.present ?? []) if (await s.page.locator(selector).count() === 0) failed.push(`missing ${selector}`);
  for (const selector of checks.absent ?? []) if (await s.page.locator(selector).count() > 0) failed.push(`unexpected ${selector}`);
  for (const [selector, n] of Object.entries(checks.count ?? {})) {
    const found = await s.page.locator(selector).count();
    if (found !== n) failed.push(`count ${selector}=${found}, expected ${n}`);
  }
  for (const words of checks.text ?? []) if (!body.includes(words)) failed.push(`text not found "${words}"`);
  for (const words of checks.forbid ?? []) if (body.includes(words)) failed.push(`forbidden text "${words}"`);
  if (status !== null && status !== (checks.status ?? 200)) failed.push(`status ${status}`);
  if (overflow > 0) failed.push(`overflow ${overflow}px by ${culprits.join(' | ')}`);
  if (s.errors.length) failed.push(`console ${JSON.stringify(s.errors.slice(0, 3))}`);
  const file = `${name}__${viewport.label}.png`;
  await s.page.evaluate(() => window.scrollTo(0, 0));
  await s.page.waitForTimeout(150);
  await s.page.screenshot({ path: `${outDir}/${file}`, fullPage: true });
  log.push(`${file} as=${s.role} status=${status ?? 'same-page'} final=${finalPath} h1=${JSON.stringify(h1)} horizontalOverflowPx=${overflow} consoleErrors=${s.errors.length} checks=${failed.length ? `FAIL(${failed.join('; ')})` : 'pass'}`);
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

/** Capture an ephemeral client state at desktop, then the same state resized to mobile. */
async function captureState(s: Session, name: string, checks: Checks = {}) {
  await shoot(s, name, DESKTOP, checks, null);
  await shoot(s, name, MOBILE, checks, null);
  await s.page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
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

/** The integration suite's re-key of the match fixtures onto one synthetic home-and-away provider match. */
function matchUnitSource() {
  const fixture = readFixture('fixture');
  const roster = readFixture('roster');
  const stats = readFixture('stats');
  fixture.providerId = MATCH;
  fixture.utcStartTime = `${MATCH_DATE}T07:15:00.000+0000`;
  fixture.round = { ...fixture.round, roundNumber: API_ROUND, abbreviation: `Rd ${API_ROUND}`, name: `Round ${API_ROUND}` };
  roster.match.matchId = MATCH;
  roster.match.venueLocalStartTime = `${MATCH_DATE}T17:15:00`;
  roster.matchRoster.matchId = MATCH;
  roster.matchRoster.roundNumber = API_ROUND;
  roster.matchRoster.homeTeam.matchId = MATCH;
  roster.matchRoster.awayTeam.matchId = MATCH;
  roster.recentMatchScores[0].matchId = MATCH;
  return { fixtureRaw: fixture, rosterRaw: roster, playerStatsRaw: stats };
}
/** The Brownlow fixtures with their final-round match id re-keyed onto the synthetic match. */
function brownlowSeasonRaw() {
  const raw = readFixture('season');
  for (const entry of raw.matchVotes) { entry.matchId = MATCH; entry.roundNumber = API_ROUND; }
  return raw;
}
function leaderboardRaw(withUnresolved: boolean) {
  const raw = readFixture('leaderboard');
  for (const entry of raw.leaderboard) {
    entry.roundByRoundVotes = entry.roundByRoundVotes.map((rv: object) => ({ ...rv, matchId: MATCH, roundNumber: API_ROUND }));
    entry.roundByRoundTotalVotes = entry.roundByRoundTotalVotes.map((rv: object) => ({ ...rv, roundNumber: API_ROUND }));
  }
  if (withUnresolved) {
    const extra = JSON.parse(JSON.stringify(raw.leaderboard[raw.leaderboard.length - 1]));
    extra.player = { ...extra.player, playerId: UNRESOLVED_PLAYER, givenName: 'Delta', jumper: 4 };
    extra.team = { teamId: UNMAPPED_TEAM, teamAbbr: 'SYN', teamName: 'Synthetic Unmapped', teamNickname: 'Synthetics' };
    Object.assign(extra, { leader: false, winner: false, totalVotes: 0, roundByRoundVotes: [], roundByRoundTotalVotes: [] });
    raw.leaderboard.push(extra);
  }
  return raw;
}

const browser = await chromium.launch({ headless: true });
const hiddenFiles = new Set<string>();
let pendingRank: { id: number; rank: number } | null = null;
const BROWNLOW_2026 = '/admin/operations/brownlow?season=2026';
try {
  const [facts] = await sql.unsafe(ISOLATED_SERVER_FACTS_SQL);
  if (checkIsolatedTestServer(database, { clusterName: facts.cluster_name, databaseComment: facts.database_comment,
    currentDatabase: facts.current_database }).length) throw new Error('Live identity proof failed');
  const [importFacts] = await importSql.unsafe(ISOLATED_SERVER_FACTS_SQL);
  if (checkIsolatedTestServer(database, { clusterName: importFacts.cluster_name, databaseComment: importFacts.database_comment,
    currentDatabase: importFacts.current_database }).length) throw new Error('Live identity proof failed (import role)');
  const [listener] = await sql`SELECT inet_server_addr()::text AS addr, inet_server_port() AS port, current_user AS owner_role`;
  const [importRole] = await importSql`SELECT current_user AS role`;
  if (existsSync(`${IDENTITIES}.visual-hidden`)) throw new Error(`A hidden fixture from an earlier run is still present: ${IDENTITIES}.visual-hidden`);
  const referenceSha: Record<string, string> = {};
  for (const file of REFERENCE) {
    const bundled = resolve(`.next/standalone/data/reference/${file}`);
    if (!existsSync(bundled) || sha(bundled) !== sha(resolve(`data/reference/${file}`))) throw new Error(`Standalone ${file} missing or differs from the repository file`);
    referenceSha[file] = sha(bundled);
  }
  const buildId = readFileSync(resolve('.next/BUILD_ID'), 'utf8').trim();
  if (buildId !== EXPECTED_BUILD) throw new Error(`Build ${buildId} is not the verified corrected bundle ${EXPECTED_BUILD}`);
  mkdirSync(outDir, { recursive: false });
  const start = await fingerprint();
  log.push(`start database=${database} cluster=${facts.cluster_name} marker=${JSON.stringify(facts.database_comment)} listener=${listener.addr}:${listener.port} ownerRole=${listener.owner_role} writerRole=${importRole.role} baseURL=${baseURL} buildId=${buildId} referenceSha256=${json(referenceSha)}`);
  log.push(`start history=${json(Object.fromEntries(HISTORY.map((t) => [t, start[t].rows])))}`);
  for (const [key, path] of Object.entries(FIXTURES)) log.push(`fixture ${key} ${path} sha256=${sha(resolve(path))}`);
  log.push(`fixture re-key: provider match CD_M20260142801 (API round 28, a 2026 final) -> ${MATCH} (API round ${API_ROUND}, date ${MATCH_DATE}); voters ${VOTERS.map((v) => v.providerId).join(',')} unchanged; first leaderboard adds ${UNRESOLVED_PLAYER} on ${UNMAPPED_TEAM} (synthetic, no identity)`);

  // --- 0. The guarded CLI route: refused for the sealed fixture season before any connection (not bypassed) ---
  try {
    refuseSealedSeasonForSettle(resolve('.'), SEASON);
    failures.push(`cli seal: season ${SEASON} was NOT refused`);
    log.push(`CLI-ROUTE season=${SEASON} refused=false`);
  } catch (error) {
    log.push(`CLI-ROUTE settle-afl-api.ts / settle-afl-api-fixtures.ts / settle-afl-api-brownlow.ts --apply for season ${SEASON}: refused before any connection: ${(error as Error).name}: ${(error as Error).message.split('\n')[0]}`);
  }

  const registry = parseSourceFamilyRegistry(JSON.parse(readFileSync(resolve('data/reference/source-families.json'), 'utf8')));
  const identities = parseAflApiIdentities(JSON.parse(readFileSync(resolve('data/reference/afl-api-identities.json'), 'utf8')));
  const registryInProgress = (JSON.parse(readFileSync(resolve('data/reference/seasons.json'), 'utf8')) as { in_progress_seasons: number[] }).in_progress_seasons;
  const { records: matchVotes } = emitAflApiBrownlowMatchVotes(brownlowSeasonRaw(), registry);
  const emitBoard = (withUnresolved: boolean) => {
    const { records, observation } = emitAflApiBrownlowLeaderboard(leaderboardRaw(withUnresolved), registry);
    return { records, status: typeof (observation as { status?: unknown }).status === 'string' ? (observation as { status: string }).status : null };
  };

  const sup = await signIn('super_admin');
  const adm = await signIn('admin');
  const anon = await signIn('anonymous');
  const ro = (id: string, work: () => Promise<void>) => step(id, 'read-only captures: no change', [], work);

  log.push(`mode=${RECHECK ? 'recheck-refused (the clone is already staged by the full run)' : 'full'}`);
  if (!RECHECK) {
  // --- 1. Before staging: the only 2026 state the clone had --------------------------------------------------
  await ro('R-before', async () => {
    await capture(sup, 'LB0-brownlow-2026-not-staged', BROWNLOW_2026, {
      present: ['[data-caveat="leaderboard-not-staged"]', '[data-staging-leaderboard="not-staged"]', '[data-staging-mapping="not_attempted"]'],
      text: ['not attempted: no API votes are staged'] });
  });

  // --- 2. Fixtures and producers -------------------------------------------------------------------------------
  const [afl] = await sql`SELECT id::int FROM sources WHERE key = 'afl_api'`;
  await step('F1-voters', `insert the ${VOTERS.length} synthetic voters of the leaderboard fixture as players with afl_api bridge rows (the integration suite's voter fixture)`,
    ['players', 'external_identities'], async () => {
      for (const voter of VOTERS) {
        const name = `${voter.given} Player`;
        const [player] = await sql`
          INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
          VALUES (${voter.legacyId}, ${`${name} (synthetic visual fixture)`}, ${`Player, ${voter.given} (synthetic visual fixture)`},
                  ${`${name.toLowerCase()} synthetic visual fixture`}, ${`${voter.given.toLowerCase()}-player-synthetic-visual-fixture`},
                  ${voter.given}, 'Player')
          RETURNING id`;
        await sql`INSERT INTO external_identities (source_id, external_id, status, match_method, player_id)
                  VALUES (${afl.id}, ${voter.providerId}, 'unique', 'afl_api_stat_vector_bootstrap', ${player.id})`;
      }
    });
  await step('W1-match-settle', `runSettleAflApi apply+autoApply over the re-keyed match fixtures (inProgressSeasons [${SEASON}], as the integration suite): one canonical synthetic match, its typed projection and spine observations; roster players with no afl_api bridge are refused one by one`,
    ['matches', 'staging.afl_api_match', 'staging.source_records', 'staging.source_record_versions', 'import_batches'], async () => {
      const bundle = buildAflApiSettleBundle({ season: SEASON, snapshotLabel: 'v2-visual-leaderboard-synthetic', sources: [matchUnitSource()], registry, identities });
      if (bundle.buildFailures.length) throw new Error(`bundle build failures: ${json(bundle.buildFailures)}`);
      const result = await runSettleAflApi(importSql, { bundle, registry, apply: true, autoApply: true, inProgressSeasons: [SEASON] });
      log.push(`W1 result applied=${result.applied} halt=${json(result.halt)} counters=${json(result.counters)}`);
      if (result.halt || !result.applied) throw new Error(`match settle did not apply: ${json(result.halt)}`);
      const rows = await sql`SELECT m.id::int, m.match_key, m.round_code, m.match_date::text, h.legacy_club_hist AS home, a.legacy_club_hist AS away
        FROM matches m JOIN clubs h ON h.id = m.home_club_id JOIN clubs a ON a.id = m.away_club_id
        WHERE m.season = ${SEASON}`;
      log.push(`W1 canonical ${SEASON} matches=${json(rows)}`);
    }, ['player_match_stats', 'match_period_scores', 'staging.afl_api_player_match', 'canonical_applications', 'promotion_candidates', 'data_issues', 'import_rejections', 'external_identities', 'players']);
  }

  const settleBrownlow = async (label: string, withUnresolved: boolean) => {
    const board = emitBoard(withUnresolved);
    const result = await runSettleAflApiBrownlow(importSql, {
      registry, season: SEASON, matchVotes, leaderboard: board.records, leaderboardStatus: board.status,
      inProgressSeasons: registryInProgress, apply: true, autoApply: false, observeOnly: false,
    });
    log.push(`${label} result applied=${result.applied} halt=${json(result.halt)} counters=${json(result.counters)} reconciliation=${json({ compared: result.reconciliation.compared, mismatches: result.reconciliation.mismatches.length })}`);
    if (result.halt || !result.applied) throw new Error(`Brownlow settle did not commit: ${json(result.halt)}`);
    if (result.counters.canonicalRowsInserted || result.counters.canonicalRowsUpdated) throw new Error('Brownlow settle wrote canonical rows with autoApply off');
  };
  if (!RECHECK) {
    await step('W2-brownlow-stage-unresolved', `runSettleAflApiBrownlow apply, autoApply OFF, in-progress ${json(registryInProgress)}: stages the vote set, its typed projection and a 4-entry leaderboard (one unresolved player on an unmapped team); no canonical Brownlow row`,
      ['staging.source_records', 'staging.source_record_versions', 'staging.afl_api_brownlow_vote', 'import_batches'],
      () => settleBrownlow('W2', true));
  } else {
    await step('W2r-brownlow-restage-unresolved', `runSettleAflApiBrownlow apply, autoApply OFF, in-progress ${json(registryInProgress)}, the same 4-entry leaderboard: the absent entry reappears; the vote set is unchanged; no canonical Brownlow row`,
      ['staging.source_records', 'import_batches'], () => settleBrownlow('W2r', true),
      ['staging.source_record_versions', 'staging.afl_api_brownlow_vote']);
  }

  // --- 3. The staged states ------------------------------------------------------------------------------------
  await ro('R-staged-refused', async () => {
    await capture(sup, 'LB1-brownlow-2026-unresolved-unmapped-refused', BROWNLOW_2026, {
      present: ['[data-caveat="leaderboard-staged"]', '[data-staging-leaderboard="staged"]', '[data-staging-mapping="refused"]'],
      text: ['4 entries (status IN_PROGRESS)', 'Unresolved leaderboard players 1', 'refused: 1 problem(s), no mapping applied',
        'provider_team_unmapped', UNMAPPED_TEAM, `Season ${SEASON}: Refused`, 'refused_whole_set', 'refusal: 1'],
      forbid: ['derived: 18 teams'] });
    // The finding codes sit in a collapsed <details>, which innerText omits: open it and check the refusal itself.
    await sup.page.goto(`${baseURL}${BROWNLOW_2026}`, { waitUntil: 'networkidle' });
    await sup.page.locator('#brownlow-findings details summary').click();
    await captureState(sup, 'LB1b-brownlow-2026-refused-findings-expanded', {
      present: ['#brownlow-findings details[open]'], count: { '#brownlow-findings details tbody tr': 1 },
      text: ['unresolved_player_identity', 'source=leaderboard', 'Inspect 1 diagnostic findings'] });
  });
  await step('W3-brownlow-stage-resolved', 'runSettleAflApiBrownlow again with the fixture\'s own 3-entry leaderboard: the 4th entry is stamped absent; the vote set is unchanged; no canonical Brownlow row',
    ['staging.source_records', 'import_batches'], () => settleBrownlow('W3', false),
    ['staging.source_record_versions', 'staging.afl_api_brownlow_vote']);
  const staged = {
    present: ['[data-caveat="leaderboard-staged"]', '[data-staging-leaderboard="staged"]', '[data-staging-mapping="derived"]'],
    text: ['The API leaderboard is staged (V2-GAP-023).', 'Club consistency is checked through a provider-team-to-club mapping',
      '3 entries (status IN_PROGRESS)', 'Unresolved leaderboard players 0', 'Players no longer listed 1',
      'derived: 18 teams, corroborated by 1 fixtures', 'Inspect the 18 mapped teams'],
    forbid: ['unresolved_player_identity', 'provider_team_unmapped', 'No fixture corroborates'],
    count: { '#brownlow-staging details tbody tr': 18 },
  };
  await ro('R-staged', async () => {
    await capture(sup, 'LB2-brownlow-2026-staged-mapping-derived', BROWNLOW_2026, staged);
    // The finding codes from the DOM (the table is collapsed, so the visible-text forbid above cannot see it).
    const codes = await sup.page.locator('#brownlow-findings tbody tr td:first-child').allTextContents();
    log.push(`LB2 findings codes=${json(codes)}`);
    if (codes.some((code) => ['unresolved_player_identity', 'provider_team_unmapped'].includes(code.trim()))) failures.push(`LB2: refusal finding still present ${json(codes)}`);
  });
  if (!RECHECK) {
  await ro('R-staged-roles', async () => {
    await capture(adm, 'LB3-brownlow-2026-staged-mapping-derived-admin', BROWNLOW_2026, { ...staged, absent: ['[data-decision-workbench] button[type="submit"]'] });
    for (const s of [sup, adm]) {
      await s.page.goto(`${baseURL}${BROWNLOW_2026}`, { waitUntil: 'networkidle' });
      await s.page.locator('#brownlow-staging details summary').click();
      const rows = await s.page.locator('#brownlow-staging details tbody tr').evaluateAll((trs) => trs.map((tr) =>
        [...tr.querySelectorAll('td')].map((td) => (td.textContent ?? '').trim()).join('|')));
      log.push(`mapping as=${s.role} rows=${rows.length} ${json(rows)}`);
      const corroborated = rows.filter((row) => Number(row.split('|')[3]) > 0).map((row) => row.split('|')[0]).sort();
      if (json(corroborated) !== json(['CD_T20', 'CD_T80'])) failures.push(`mapping as=${s.role}: corroborated ${json(corroborated)}, expected CD_T20 and CD_T80 (the synthetic fixture's two teams)`);
      const outcome = await s.page.locator('#brownlow-outcome-heading').textContent();
      const medal = await s.page.locator('[data-medal-status]').first().getAttribute('data-medal-status').catch(() => null);
      log.push(`report as=${s.role} outcomeHeading=${json(outcome)} medalStatus=${json(medal)} decisionSubmitControls=${await s.page.locator('[data-decision-workbench] button[type="submit"]').count()} decisionUnavailable=${await s.page.locator('[data-decision-unavailable]').count()}`);
      await captureState(s, s.role === 'super_admin' ? 'LB4-brownlow-2026-mapping-expanded' : 'LB5-brownlow-2026-mapping-expanded-admin',
        { present: ['#brownlow-staging details[open]'], count: { '#brownlow-staging details tbody tr': 18 }, text: ['Hawthorn', 'Brisbane Lions', 'CD_T80', 'CD_T20'] });
    }
    // Role restriction: without a session the page is never rendered.
    await capture(anon, 'LB6-brownlow-2026-anonymous', BROWNLOW_2026, { absent: ['[data-brownlow-staging]', '[data-brownlow-report]'], forbid: [MATCH, 'Staged leaderboard and club mapping'] });
  });

  // --- 4. Identities unavailable: the mapping is not attempted, generic text, nothing written ------------------
  await step('U8-identities-missing', 'hide the bundle\'s afl-api-identities.json: the leaderboard stays staged, the mapping is "not attempted" with generic text naming the file; nothing written',
    [], async () => {
      await hidden(IDENTITIES, referenceSha['afl-api-identities.json'], async () => {
        await capture(sup, 'LB7-brownlow-2026-identities-unavailable', BROWNLOW_2026, {
          present: ['[data-staging-leaderboard="staged"]', '[data-staging-mapping="not_attempted"]'],
          text: ['not attempted: the committed identities could not be read (data/reference/afl-api-identities.json is unreadable or invalid; see the server log)',
            'The provider-team-to-club mapping was not derived'],
          forbid: [...LEAKS, 'derived: 18 teams'] });
      });
    });

  // --- 5. Rerun of the two corrected L1 assertions (same fixture as candidate-visual-corrected.mts §5) ----------
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
    await capture(sup, 'L1-brownlow-unknown-eligibility-evidence-label', `/admin/operations/brownlow?season=${leader.season}`, {
      present: ['[data-medal-status="requires_review"]', `[data-review-player="${leader.player_id}"]`, '[data-eligibility="missing"]', '[data-evidence-flag-note]', '[data-evidence-flag="true"]'],
      text: ['unknown (not recorded)', 'Ineligibility evidence', 'not marked ineligible'],
      // Negative control: the comparison is on the authored case, so the CSS-uppercased rendering is NOT matched.
      forbid: ['UNKNOWN (NOT RECORDED)', 'INELIGIBILITY EVIDENCE'] });
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
  }

  const stagedRows = await sql`SELECT r.family, r.external_record_id, r.absent_since IS NOT NULL AS absent, r.current_version_seq::int AS seq
    FROM staging.source_records r ORDER BY r.family, r.external_record_id`;
  log.push(`end staging.source_records=${json(stagedRows)}`);
  const votes = await sql`SELECT provider_match_id, provider_player_id, provider_team_id, votes::int, eligible, match_id::int, player_id::int, club_id::int
    FROM staging.afl_api_brownlow_vote ORDER BY votes DESC`;
  log.push(`end staging.afl_api_brownlow_vote=${json(votes)}`);
  const [canonicalVotes] = await sql`SELECT count(*)::int AS n FROM brownlow_round_votes WHERE season = ${SEASON}`;
  log.push(`end brownlow_round_votes season=${SEASON} rows=${canonicalVotes.n}`);
  for (const s of [sup, adm, anon]) {
    log.push(`context ${s.role} blockedRequests=${s.counter.blocked}`);
    if (s.counter.blocked) failures.push(`${s.role}: blocked external requests=${s.counter.blocked}`);
    await s.context.close();
  }
  log.push(`process externalRequestsBlocked=${nodeBlocked.count}`);
  if (nodeBlocked.count) failures.push(`process: blocked external requests=${nodeBlocked.count}`);
  const end = await fingerprint();
  log.push(`end history=${json(Object.fromEntries(HISTORY.map((t) => [t, end[t].rows])))} netChangedTables=[${delta(start, end).join(',')}]`);
  log.push(`failures=${failures.length}${failures.length ? `\n  ${failures.join('\n  ')}` : ''}`);
  console.log(`${log.filter((line) => line.includes('.png ')).length} captures written to ${outDir}; check failures=${failures.length}`);
} finally {
  for (const path of hiddenFiles) if (existsSync(`${path}.visual-hidden`)) renameSync(`${path}.visual-hidden`, path);
  if (pendingRank) await sql`UPDATE brownlow_season_votes SET eligible_rank=${pendingRank.rank} WHERE id=${pendingRank.id} AND eligible_rank IS NULL`;
  if (existsSync(outDir)) writeFileSync(`${outDir}/capture-log.txt`, `${log.join('\n')}\n`, { flag: 'wx' });
  await browser.close(); await sql.end({ timeout: 5 }); await importSql.end({ timeout: 5 });
}
