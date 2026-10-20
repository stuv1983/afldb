// ISSUE-316 DEV candidate stale-action check (D-DEV-316-C1-APP-1).
//
// Reaches the REAL `startSettleRunAction` Server Action of the candidate application with a
// stale-client-style POST (the action id comes from the build's own server-reference manifest),
// as three callers, against the candidate database only:
//
//   N1  anonymous (no cookie)            -> must NOT be refused-and-audited; audit delta 0
//   N2  synthetic `admin` session        -> must NOT be refused-and-audited; audit delta 0
//   P1  synthetic `super_admin` session  -> {refused:true, code:'legacy_retired',
//                                            surface:'admin.afltables_settle_trigger'} and
//                                           exactly ONE new auth_audit_log row:
//                                           action admin.legacy_retired_refused,
//                                           detail {surface, export:'startSettleRunAction'},
//                                           actor = the synthetic super admin.
//
// The audit rows are counted through a separate READ-ONLY connection, never through the
// application. A missing expected row is a FAIL; nothing here ever writes an audit row.
//
// Writes (candidate database only): two synthetic auth_users rows (no password, no TOTP: they
// cannot log in), their auth_sessions rows, and, at the end, the sessions are revoked and the
// users disabled. No acquisition, no systemctl, no network beyond 127.0.0.1.
//
// Usage (from <package>/kit, with config/ops.env sourced):  node ops/check.mjs --out <file.json>
import { createHash, createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';

const EXPECT = { refused: true, code: 'legacy_retired', surface: 'admin.afltables_settle_trigger' };
const AUDIT_ACTION = 'admin.legacy_retired_refused';
const AUDIT_DETAIL = { surface: 'admin.afltables_settle_trigger', export: 'startSettleRunAction' };
const SUPER_EMAIL = 'issue316-superadmin-check@example.invalid';
const ADMIN_EMAIL = 'issue316-admin-check@example.invalid';
const ACTION_PAGE = '/admin/current-season';
const COOKIE_NAME = 'afldb_admin';
const SESSION_TTL_S = 3600;

const outIndex = process.argv.indexOf('--out');
const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : null;

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const BASE = new URL(need('CAND_BASE_URL'));
const CAND_DB = need('CAND_DB');
const APP_DIR = need('CAND_APP_DIR');
const SECRET = need('AFLDB_SESSION_SECRET');
const AUTH_URL = need('AFLDB_AUTH_DATABASE_URL');
const RO_URL = need('AFLDB_BACKUP_DATABASE_URL');

function assertCandidateOnly() {
  if (BASE.hostname !== '127.0.0.1') throw new Error('base URL must be 127.0.0.1');
  if (!CAND_DB.endsWith('_test') || ['afldb_dev', 'afldb_prod', 'afldb_test', 'code_test_db'].includes(CAND_DB)) {
    throw new Error(`refusing candidate database name ${CAND_DB}`);
  }
  for (const [name, url] of [['AFLDB_AUTH_DATABASE_URL', AUTH_URL], ['AFLDB_BACKUP_DATABASE_URL', RO_URL]]) {
    const db = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
    if (db !== CAND_DB) throw new Error(`${name} names '${db}', expected '${CAND_DB}'`);
  }
  if (SECRET.length < 32) throw new Error('AFLDB_SESSION_SECRET too short');
}

// jsonb does not preserve key order, so compare canonically (sorted keys), never by raw stringify.
const canon = (value) => JSON.stringify(value, (_key, v) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
    : v);

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');

// Same construction as src/lib/auth/tokens.ts signClaim(): base64url(payload).base64url(HMAC-SHA256).
function mintCookie(userId, token) {
  const claim = { v: 1, kind: 'admin', sub: `${userId}:${token}`, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S, epoch: 1 };
  const payload = Buffer.from(JSON.stringify(claim));
  const mac = createHmac('sha256', SECRET).update(payload).digest();
  return `${b64url(payload)}.${b64url(mac)}`;
}

function actionIdFromManifest() {
  const path = join(APP_DIR, '.next', 'server', 'server-reference-manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const hits = Object.entries(manifest.node ?? {}).filter(([, e]) =>
    e.exportedName === 'startSettleRunAction' && String(e.filename).endsWith('app/admin/current-season/actions.ts'));
  if (hits.length !== 1) throw new Error(`expected exactly one startSettleRunAction in the manifest, found ${hits.length}`);
  return hits[0][0];
}

function postAction(actionId, cookie) {
  return new Promise((resolve, reject) => {
    const body = '[]';
    const headers = {
      'Next-Action': actionId,
      'Content-Type': 'text/plain;charset=UTF-8',
      Accept: 'text/x-component',
      Origin: BASE.origin,
      Host: BASE.host,
      'X-Forwarded-For': '127.0.0.1',
      'Content-Length': Buffer.byteLength(body),
    };
    if (cookie) headers.Cookie = `${COOKIE_NAME}=${cookie}`;
    const req = http.request({ host: BASE.hostname, port: BASE.port, path: ACTION_PAGE, method: 'POST', headers, agent: false, timeout: 30000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

// Flight (text/x-component) rows look like `1:{...}`; find any JSON object carrying `refused`.
function findRefusal(body) {
  for (const line of body.split('\n')) {
    const m = /^[0-9a-f]+:(.*)$/i.exec(line);
    if (!m) continue;
    try {
      const value = JSON.parse(m[1]);
      if (value && typeof value === 'object' && 'refused' in value) return value;
    } catch { /* not a JSON row */ }
  }
  return null;
}

async function snapshot(ro) {
  const [r] = await ro`
    SELECT (SELECT count(*) FROM auth_audit_log)                                          AS audit_total,
           (SELECT coalesce(max(id), 0) FROM auth_audit_log)                              AS audit_max_id,
           (SELECT count(*) FROM auth_audit_log WHERE action = ${AUDIT_ACTION})           AS refused_rows,
           (SELECT count(*) FROM auth_users)                                              AS users,
           (SELECT count(*) FROM auth_sessions)                                           AS sessions,
           (SELECT count(*) FROM afldb_meta.schema_migrations)                            AS ledger,
           (SELECT count(*) FROM import_batches)                                          AS import_batches,
           (SELECT count(*) FROM matches)                                                 AS matches`;
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
}

async function waitForAuditDelta(ro, before, want, ms = 6000) {
  const end = Date.now() + ms;
  let snap = await snapshot(ro);
  while (snap.audit_total - before.audit_total < want && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 250));
    snap = await snapshot(ro);
  }
  return snap;
}

async function ensureUser(auth, email, role) {
  const [existing] = await auth`SELECT id FROM auth_users WHERE email = ${email}`;
  if (existing) throw new Error(`synthetic user ${email} already exists (id ${existing.id}); refusing to reuse it`);
  const [row] = await auth`
    INSERT INTO auth_users (email, role, can_manage_admins, must_change_password)
    VALUES (${email}, ${role}, false, false) RETURNING id`;
  return row.id;
}

async function openSession(auth, userId) {
  const token = randomBytes(32).toString('hex');
  const [row] = await auth`
    INSERT INTO auth_sessions (token_hash, user_id, expires_at, ip, user_agent)
    VALUES (${sha256Hex(token)}, ${userId}, now() + ${SESSION_TTL_S} * interval '1 second', '127.0.0.1', 'issue316-dev-check')
    RETURNING id`;
  return { sessionId: Number(row.id), cookie: mintCookie(userId, token) };
}

function httpSummary(res) {
  return {
    status: res.status,
    contentType: res.headers['content-type'] ?? null,
    location: res.headers.location ?? null,
    actionRedirect: res.headers['x-action-redirect'] ?? null,
    bodyBytes: Buffer.byteLength(res.body),
    mentionsLegacyRetired: res.body.includes('legacy_retired'),
  };
}

async function main() {
  assertCandidateOnly();
  const failures = [];
  const fail = (msg) => { failures.push(msg); console.error(`FAIL: ${msg}`); };
  const buildId = existsSync(join(APP_DIR, '.next', 'BUILD_ID')) ? readFileSync(join(APP_DIR, '.next', 'BUILD_ID'), 'utf8').trim() : null;
  const actionId = actionIdFromManifest();

  const ro = postgres(RO_URL, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: 'on', application_name: 'issue316-check-ro' } });
  const auth = postgres(AUTH_URL, { max: 1, onnotice: () => {}, connection: { application_name: 'issue316-check-auth' } });
  const evidence = { check: 'issue316-dev-stale-action', generatedAt: new Date().toISOString(), buildId, actionId, base: BASE.origin, database: CAND_DB, phases: [] };
  const created = { userIds: [], sessionIds: [] };

  try {
    const [{ ro_flag }] = await ro`SELECT current_setting('transaction_read_only') AS ro_flag`;
    if (ro_flag !== 'on') throw new Error('read-only connection is not read-only');
    evidence.before = await snapshot(ro);
    if (evidence.before.ledger !== 117) fail(`candidate ledger is ${evidence.before.ledger}, expected 117`);
    if (evidence.before.refused_rows !== 0) fail(`candidate already holds ${evidence.before.refused_rows} ${AUDIT_ACTION} rows before the check`);

    const superId = await ensureUser(auth, SUPER_EMAIL, 'super_admin'); created.userIds.push(superId);
    const adminId = await ensureUser(auth, ADMIN_EMAIL, 'admin'); created.userIds.push(adminId);
    const superSession = await openSession(auth, superId); created.sessionIds.push(superSession.sessionId);
    const adminSession = await openSession(auth, adminId); created.sessionIds.push(adminSession.sessionId);
    evidence.synthetic = { superAdminId: superId, adminId };
    evidence.afterSetup = await snapshot(ro);

    // N1 / N2: callers who must not reach the refusal. Counted against the post-setup baseline.
    for (const [name, cookie] of [['N1 anonymous', null], ['N2 synthetic admin', adminSession.cookie]]) {
      const base = await snapshot(ro);
      const res = await postAction(actionId, cookie);
      const after = await waitForAuditDelta(ro, base, 1, 1500);
      const refusal = findRefusal(res.body);
      const phase = { name, http: httpSummary(res), refusal, auditDelta: after.audit_total - base.audit_total, refusedRowsDelta: after.refused_rows - base.refused_rows };
      evidence.phases.push(phase);
      if (refusal?.refused === true) fail(`${name}: an unauthorised caller received the refusal`);
      if (phase.auditDelta !== 0) fail(`${name}: audit delta ${phase.auditDelta}, expected 0`);
    }
    if (failures.length > 0) throw new Error('negative controls failed; the positive request was not sent');

    // P1: the authorised Super Admin stale-action request.
    const base = await snapshot(ro);
    const res = await postAction(actionId, superSession.cookie);
    const after = await waitForAuditDelta(ro, base, 1);
    const refusal = findRefusal(res.body);
    const newRows = (await ro`
      SELECT id, at, actor_user_id, actor_label, action, detail, ip::text AS ip
        FROM auth_audit_log WHERE id > ${base.audit_max_id} ORDER BY id`)
      .map((r) => ({ id: Number(r.id), at: r.at instanceof Date ? r.at.toISOString() : r.at, actor_user_id: r.actor_user_id, actor_label: r.actor_label, action: r.action, detail: r.detail, ip: r.ip }));
    const phase = { name: 'P1 synthetic super_admin', http: httpSummary(res), refusal, auditDelta: after.audit_total - base.audit_total, refusedRowsDelta: after.refused_rows - base.refused_rows, newAuditRows: newRows };
    evidence.phases.push(phase);

    if (res.status !== 200) fail(`P1: HTTP ${res.status}, expected 200`);
    for (const [k, v] of Object.entries(EXPECT)) if (refusal?.[k] !== v) fail(`P1: refusal.${k} = ${JSON.stringify(refusal?.[k])}, expected ${JSON.stringify(v)}`);
    if (typeof refusal?.error !== 'string' || refusal.error.length === 0) fail('P1: refusal.error is missing');
    else if (/\/home\/|\/etc\/|postgres(ql)?:\/\/|password|secret/i.test(refusal.error)) fail('P1: refusal.error carries a path, DSN or secret');
    if (phase.auditDelta !== 1) fail(`P1: total audit delta ${phase.auditDelta}, expected exactly 1`);
    if (phase.refusedRowsDelta !== 1) fail(`P1: ${AUDIT_ACTION} delta ${phase.refusedRowsDelta}, expected exactly 1`);
    const row = newRows.find((r) => r.action === AUDIT_ACTION);
    if (!row) fail(`P1: no new ${AUDIT_ACTION} row`);
    else {
      if (canon(row.detail) !== canon(AUDIT_DETAIL)) fail(`P1: audit detail ${canon(row.detail)} != ${canon(AUDIT_DETAIL)}`);
      if (!String(row.ip ?? '').startsWith('127.0.0.1')) fail(`P1: audit ip ${row.ip} != 127.0.0.1`);
      if (row.actor_user_id !== superId) fail(`P1: audit actor_user_id ${row.actor_user_id} != synthetic super admin ${superId}`);
      if (row.actor_label !== SUPER_EMAIL) fail(`P1: audit actor_label ${row.actor_label} != ${SUPER_EMAIL}`);
    }

    evidence.after = await snapshot(ro);
    for (const k of ['import_batches', 'matches', 'ledger']) {
      if (evidence.after[k] !== evidence.before[k]) fail(`${k} changed during the check (${evidence.before[k]} -> ${evidence.after[k]})`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    try {
      if (created.sessionIds.length) await auth`UPDATE auth_sessions SET revoked_at = now() WHERE id = ANY(${created.sessionIds}) AND revoked_at IS NULL`;
      if (created.userIds.length) await auth`UPDATE auth_users SET disabled_at = now() WHERE id = ANY(${created.userIds}) AND disabled_at IS NULL`;
      evidence.cleanup = { sessionsRevoked: created.sessionIds.length, usersDisabled: created.userIds.length };
    } catch (error) {
      evidence.cleanup = { error: error instanceof Error ? error.message : String(error) };
      failures.push('cleanup failed');
    }
    await ro.end({ timeout: 5 }).catch(() => {});
    await auth.end({ timeout: 5 }).catch(() => {});
  }

  evidence.verdict = failures.length === 0 ? 'PASS' : 'FAIL';
  evidence.failures = failures;
  const text = JSON.stringify(evidence, null, 2);
  if (outPath) writeFileSync(outPath, text + '\n', { mode: 0o600 });
  console.log(text);
  console.log(`\nVERDICT: ${evidence.verdict}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(2); });
