/**
 * AFLDB-ISSUE-245 — the tracked fixture for the destructive `db:test:rebuild --target
 * code_test_db` rehearsal of the manual-registration carry-through. Seed, verify and teardown are
 * explicit operator steps AROUND the rebuild; the rebuild itself never creates, reads or removes it.
 *
 *     npm run db:code-test:issue245-rehearsal -- seed [--allow-owner-import-dsn]
 *     npm run db:code-test:issue245-rehearsal -- verify --phase pre
 *     npm run db:code-test:issue245-rehearsal -- verify --phase post
 *     npm run db:code-test:issue245-rehearsal -- teardown
 *     npm run db:code-test:issue245-rehearsal -- residue
 *
 * (`--conditions=react-server` is in the package script: `seed` calls the real `server-only`
 * player-creation primitives. `verify`, `teardown` and `residue` never load them.)
 *
 * WHAT IT PROVES. Two ISSUE-224-style registrations, made exactly as
 * `register_issue224_s9_players.ts` made the 92: `createPlayerInTransaction` (the player, its
 * `manual_admin_edit` token and its `data_overrides('players', …, 'identity')` creation record)
 * and, for the first, `attachAflTablesIdentityInTransaction` (an AFL Tables profile path the
 * accepted fitzRoy baseline does not carry). The first also gets one importer-created `afl_api`
 * provider, written as the importer writes it. `verify --phase post` proves, after a full
 * destructive rebuild, that both registrations came back under the same token with the same
 * creation record, the path on the same player, and the provider on the player its stable
 * identity names NOW — whatever `players.id` that is — through ONE archived combined capture.
 *
 * It runs ALONE on code_test_db: the ISSUE-237 fixture's seed demands zero `afl_api` rows and its
 * verify treats any other provider as foreign, so the two rehearsals are sequential, not combined.
 *
 * IDENTITY. No `players.id` is stored anywhere by this tool. The two registrations are found by
 * their token (from the baseline) or, before a baseline exists, by the fixture's own `notes`
 * marker in the creation record — an exact literal this tool wrote, never a name lookup.
 *
 * NAMESPACE. Provider id `CD_I999245` + 4 digits; the profile path and the notes marker below.
 * The DB-free suite proves all three are absent from every tracked data file.
 *
 * TARGET. `code_test_db` ONLY, through the ISSUE-237 fixture's own DSN resolution
 * (`AFLDB_CODE_TEST_DATABASE_URL`, `AFLDB_CODE_TEST_IMPORT_DATABASE_URL`). No DSN is printed.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import postgres, { type TransactionSql } from 'postgres';

import {
  AFL_API_PROVIDER_ID_RE,
  isAflApiImporterMatchMethod,
  type AflApiForwardIdentityResult,
} from '../../src/lib/acquisition/afl-api-adjudication';
import { resolveCaptureRoot } from '../db/rebuild-test';
import { redact } from '../db/psql';
import {
  REHEARSAL_IMPORT_ENV,
  parseRehearsalArgs,
  resolveRehearsalDsns,
  type RehearsalActor,
  type RehearsalAflApiRow,
  type RehearsalDsns,
} from './afl_api_identity_rebuild_rehearsal_fixture';
import {
  captureDirectory,
  parseCombinedCapture,
  PENDING_CAPTURE_FILE,
  readRebuildMarker,
  type CombinedCapture,
} from './rebuild_afl_api_adjudications';
import {
  insertAttributionOnlyActor,
  readLiveRegistrationState,
  registrationsFromLive,
  REGISTRATION_PROFILE_PATH_RE,
  type CapturedRegistration,
} from './rebuild_manual_registrations';
import { assertAflApiIdentityInvariant, readAflApiForwardIdentities } from './replay_afl_api_adjudications';

export class RegistrationRehearsalRefused extends Error {}

export const REGISTRATION_REHEARSAL_PROVIDER_NAMESPACE = '^CD_I999245[0-9]{4}$';
export const REGISTRATION_REHEARSAL_PROVIDER_NAMESPACE_RE = new RegExp(REGISTRATION_REHEARSAL_PROVIDER_NAMESPACE);

export const REGISTRATION_REHEARSAL_FIXTURE = {
  database: 'code_test_db',
  /** The exact literal every fixture creation record carries in `notes`. */
  note: 'AFLDB-ISSUE-245 rehearsal fixture registration',
  withPath: {
    displayName: 'Issue245 Rehearsalone', givenName: 'Issue245', surname: 'Rehearsalone',
    /** A syntactically valid AFL Tables profile path no tracked source carries. */
    profilePath: 'players/I/Issue245_Rehearsalone.html',
  },
  withoutPath: { displayName: 'Issue245 Rehearsaltwo', givenName: 'Issue245', surname: 'Rehearsaltwo' },
  importer: {
    providerId: 'CD_I9992450001',
    matchMethod: 'afl_api_stat_vector_bootstrap',
    externalName: 'AFLDB-ISSUE-245 rehearsal importer fixture',
    notes: 'AFLDB-ISSUE-245 rehearsal fixture: synthetic importer-created unique row on a registered player.',
  },
  actorEmail: 'issue245-rehearsal-fixture@example.test',
  actorRole: 'super_admin',
} as const;

export const REGISTRATION_REHEARSAL_BASELINE_FORMAT = 'afldb.issue245.rehearsal_fixture_baseline';
export const REGISTRATION_REHEARSAL_BASELINE_VERSION = 1;

/** Under the SHARED capture root, beside — never inside — the capture stage's own directory. */
export function registrationRehearsalBaselinePath(captureRoot: string, database: string): string {
  return join(captureRoot, 'issue-245-rehearsal', `${database}.baseline.json`);
}

// ---------------------------------------------------------------------------
// The baseline (pure) — durable fields only, never a surrogate id
// ---------------------------------------------------------------------------

export type BaselineRegistration = Pick<CapturedRegistration,
  'token' | 'overrideValues' | 'afltablesProfilePath' | 'createdAt' | 'updatedAt'>;

export type RegistrationRehearsalBaseline = {
  format: typeof REGISTRATION_REHEARSAL_BASELINE_FORMAT;
  version: typeof REGISTRATION_REHEARSAL_BASELINE_VERSION;
  database: string;
  seededAt: string;
  /** Ordered: the registration WITH the path first, then the one without. */
  registrations: BaselineRegistration[];
  importer: { externalId: string; playerIdentity: string; matchMethod: string; externalName: string; notes: string };
  payloadSha256: string;
};

const baselineTuple = (r: BaselineRegistration) => [r.token, r.overrideValues, r.afltablesProfilePath, r.createdAt, r.updatedAt];

export function registrationRehearsalBaselineSha256(b: Omit<RegistrationRehearsalBaseline, 'payloadSha256'>): string {
  const i = b.importer;
  return createHash('sha256').update(JSON.stringify([b.format, b.version, b.database, b.seededAt,
    b.registrations.map(baselineTuple), [i.externalId, i.playerIdentity, i.matchMethod, i.externalName, i.notes]]), 'utf8')
    .digest('hex');
}

/** The seeded shape: exactly two fixture registrations, the first on the fixture path. */
export function registrationRehearsalShapeProblems(registrations: readonly BaselineRegistration[]): string[] {
  const f = REGISTRATION_REHEARSAL_FIXTURE;
  if (registrations.length !== 2) return [`${registrations.length} fixture registration(s), expected exactly 2`];
  const problems: string[] = [];
  const [withPath, withoutPath] = registrations;
  if (withPath.afltablesProfilePath !== f.withPath.profilePath) problems.push('the first registration does not carry the fixture path');
  if (withoutPath.afltablesProfilePath !== null) problems.push('the second registration carries an AFL Tables path');
  if (withPath.token === withoutPath.token) problems.push('the two registrations share a token');
  for (const r of registrations) {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(r.overrideValues) as Record<string, unknown>; } catch { /* reported below */ }
    if (payload.notes !== f.note) problems.push(`registration ${r.token} does not carry the fixture notes marker`);
  }
  return problems;
}

export function buildRegistrationRehearsalBaseline(input: {
  database: string; seededAt: string; registrations: BaselineRegistration[];
}): RegistrationRehearsalBaseline {
  const problems = registrationRehearsalShapeProblems(input.registrations);
  if (problems.length > 0) throw new RegistrationRehearsalRefused(`The seeded registrations are not the fixture shape: ${problems.join('; ')}`);
  const f = REGISTRATION_REHEARSAL_FIXTURE;
  const body: Omit<RegistrationRehearsalBaseline, 'payloadSha256'> = {
    format: REGISTRATION_REHEARSAL_BASELINE_FORMAT, version: REGISTRATION_REHEARSAL_BASELINE_VERSION,
    database: input.database, seededAt: input.seededAt,
    registrations: input.registrations.map(({ token, overrideValues, afltablesProfilePath, createdAt, updatedAt }) =>
      ({ token, overrideValues, afltablesProfilePath, createdAt, updatedAt })),
    importer: {
      externalId: f.importer.providerId, playerIdentity: f.withPath.profilePath, matchMethod: f.importer.matchMethod,
      externalName: f.importer.externalName, notes: f.importer.notes,
    },
  };
  return { ...body, payloadSha256: registrationRehearsalBaselineSha256(body) };
}

export function parseRegistrationRehearsalBaseline(text: string, expectedDatabase: string): RegistrationRehearsalBaseline {
  let raw: RegistrationRehearsalBaseline;
  try {
    raw = JSON.parse(text) as RegistrationRehearsalBaseline;
  } catch {
    throw new RegistrationRehearsalRefused('The rehearsal baseline is not valid JSON.');
  }
  if (raw.format !== REGISTRATION_REHEARSAL_BASELINE_FORMAT || raw.version !== REGISTRATION_REHEARSAL_BASELINE_VERSION) {
    throw new RegistrationRehearsalRefused('The rehearsal baseline has an unknown format or version.');
  }
  if (raw.database !== expectedDatabase) {
    throw new RegistrationRehearsalRefused(`The rehearsal baseline is for '${String(raw.database)}', not '${expectedDatabase}'.`);
  }
  const rebuilt = buildRegistrationRehearsalBaseline({ database: raw.database, seededAt: raw.seededAt, registrations: raw.registrations });
  if (JSON.stringify(rebuilt.importer) !== JSON.stringify(raw.importer) || rebuilt.payloadSha256 !== raw.payloadSha256) {
    throw new RegistrationRehearsalRefused('The rehearsal baseline does not match its own payload hash or the fixture constants.');
  }
  return rebuilt;
}

// ---------------------------------------------------------------------------
// Verification (pure)
// ---------------------------------------------------------------------------

export type RegistrationRehearsalObservation = {
  database: string;
  markerPresent: boolean;
  pendingCaptureExists: boolean;
  /** `registrationsFromLive` over the WHOLE database: what the next capture would refuse on. */
  registrationProblems: readonly string[];
  /** The live registrations whose token is a baseline token. */
  fixtureRegistrations: readonly CapturedRegistration[];
  /** Distinct players each identity names now. */
  withPathTokenPlayers: readonly number[];
  withPathPathPlayers: readonly number[];
  withPathForward: AflApiForwardIdentityResult | null;
  withoutPathTokenPlayers: readonly number[];
  /** AFL Tables paths the path-less registration's player holds (must be none). */
  withoutPathAfltablesPaths: readonly string[];
  /** Every `afl_api` identity in the fixture namespace. */
  aflApiRows: readonly RehearsalAflApiRow[];
  actors: readonly RehearsalActor[];
  invariant: 'ok' | { error: string };
  archivedCaptures: readonly { file: string; fileSha256: string; payloadSha256: string; carriesFixture: boolean }[];
};

/** True when a parsed combined capture carries both fixture registrations and the importer row exactly. */
export function captureCarriesRegistrationFixture(capture: Pick<CombinedCapture, 'registrations' | 'importerRows'>,
  baseline: RegistrationRehearsalBaseline): boolean {
  const registrationsOk = baseline.registrations.every((b) => capture.registrations.some((r) =>
    JSON.stringify(baselineTuple(r)) === JSON.stringify(baselineTuple(b))));
  const i = baseline.importer;
  const importerOk = capture.importerRows.some((r) => r.externalId === i.externalId && r.playerIdentity === i.playerIdentity
    && r.matchMethod === i.matchMethod && r.status === 'unique' && r.candidateCount === 1 && r.externalUrl === null
    && r.externalName === i.externalName && r.notes === i.notes);
  return registrationsOk && importerOk;
}

/**
 * Every way the database differs from the fixture contract. No check compares a `players.id`
 * with a stored one: each is compared with the player a stable identity names in the SAME
 * snapshot, so a renumbered player passes and a retargeted identity fails.
 */
export function registrationRehearsalVerifyProblems(
  baseline: RegistrationRehearsalBaseline, o: RegistrationRehearsalObservation, phase: 'pre' | 'post',
): string[] {
  const f = REGISTRATION_REHEARSAL_FIXTURE;
  const p: string[] = [];
  if (o.database !== f.database) p.push(`connected to '${o.database}', not '${f.database}'`);
  if (o.markerPresent) p.push(phase === 'post' ? 'a rebuild marker is still present' : 'a rebuild marker is present (a rebuild is in flight)');
  if (o.pendingCaptureExists) p.push(`a pending rebuild capture (${PENDING_CAPTURE_FILE}) exists`);
  for (const x of o.registrationProblems) p.push(`the next capture would refuse: ${x}`);

  // The creation records: durable fields byte for byte, and the actor by email.
  for (const b of baseline.registrations) {
    const live = o.fixtureRegistrations.filter((r) => r.token === b.token);
    if (live.length !== 1) { p.push(`registration ${b.token}: ${live.length} live creation record(s), expected 1`); continue; }
    if (JSON.stringify(baselineTuple(live[0])) !== JSON.stringify(baselineTuple(b))) {
      p.push(`registration ${b.token}: a durable field of the creation record differs from the baseline`);
    }
    if (live[0].adminEmail.toLowerCase() !== f.actorEmail || live[0].adminRole !== f.actorRole) {
      p.push(`registration ${b.token}: not attributed to the fixture actor in role ${f.actorRole}`);
    }
  }

  const one = (label: string, ids: readonly number[]): number | null => {
    if (ids.length === 1) return ids[0];
    p.push(`${label} names ${ids.length} players, not exactly one`);
    return null;
  };
  const withPath = one('the first registration\'s token', o.withPathTokenPlayers);
  const byPath = one(`'${f.withPath.profilePath}'`, o.withPathPathPlayers);
  if (withPath !== null && byPath !== null && withPath !== byPath) {
    p.push(`the token names player ${withPath} but the AFL Tables path names player ${byPath}`);
  }
  if (o.withPathForward !== null
      && (!o.withPathForward.ok || o.withPathForward.via !== 'afltables' || o.withPathForward.identity !== f.withPath.profilePath)) {
    p.push(`D7: the registered player's forward identity is not exactly afltables:${f.withPath.profilePath}`);
  }
  const withoutPath = one('the second registration\'s token', o.withoutPathTokenPlayers);
  if (withoutPath !== null && withoutPath === withPath) p.push('the two registrations resolve to the same player');
  if (o.withoutPathAfltablesPaths.length > 0) p.push('the path-less registration\'s player holds an AFL Tables identity');

  const rows = o.aflApiRows.filter((r) => r.externalId === f.importer.providerId);
  const foreign = o.aflApiRows.filter((r) => r.externalId !== f.importer.providerId);
  if (foreign.length > 0) p.push(`${foreign.length} other fixture-namespace afl_api row(s) exist`);
  if (rows.length !== 1) {
    p.push(`the importer provider ${f.importer.providerId} has ${rows.length} afl_api row(s), expected 1`);
  } else {
    const r = rows[0];
    if (r.status !== 'unique') p.push(`the importer row's status is '${r.status}', not 'unique'`);
    if (r.matchMethod !== f.importer.matchMethod || !isAflApiImporterMatchMethod(r.matchMethod)) {
      p.push(`the importer row's match_method is '${String(r.matchMethod)}', not exactly '${f.importer.matchMethod}'`);
    }
    if (r.candidateCount !== 1) p.push(`D5: the importer row's candidate_count is ${r.candidateCount}, not 1`);
    if (r.externalUrl !== null) p.push('D5: the importer row\'s external_url is not NULL');
    if (r.externalName !== f.importer.externalName || r.notes !== f.importer.notes) p.push('the importer row\'s name/notes were not carried exactly');
    if (byPath !== null && r.playerId !== byPath) {
      p.push(`the importer row names player ${String(r.playerId)}, but '${f.withPath.profilePath}' is player ${byPath} (retargeted)`);
    }
  }
  if (o.invariant !== 'ok') p.push(`D5/D7/D13 standalone invariant failed: ${o.invariant.error}`);

  if (o.actors.length !== 1) {
    p.push(`${o.actors.length} fixture actor row(s), expected 1`);
  } else {
    const a = o.actors[0];
    if (a.role !== f.actorRole) p.push(`the fixture actor's role is '${a.role}', not '${f.actorRole}'`);
    if (!a.disabled || a.hasPasswordHash || a.hasTotpSecret) p.push('the fixture actor is not attribution-only (disabled, no credentials)');
  }

  const carrying = o.archivedCaptures.filter((c) => c.carriesFixture);
  if (phase === 'post' && carrying.length === 0) p.push('no archived combined capture carries both fixture registrations and the importer row');
  if (phase === 'pre' && carrying.length > 0) p.push('an archived capture already carries this seed: a rebuild has run since seed; use --phase post');
  return p;
}

export function readArchivedRegistrationCaptures(dir: string, database: string, baseline: RegistrationRehearsalBaseline) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /^afl-api-identities\..+\.reinstated\.json$/.test(file))
    .sort()
    .map((file) => {
      const text = readFileSync(join(dir, file), 'utf8');
      const fileSha256 = createHash('sha256').update(text, 'utf8').digest('hex');
      try {
        const capture = parseCombinedCapture(text, database);
        return { file, fileSha256, payloadSha256: capture.payloadSha256, carriesFixture: captureCarriesRegistrationFixture(capture, baseline) };
      } catch {
        return { file, fileSha256, payloadSha256: 'unverifiable', carriesFixture: false };
      }
    });
}

// ---------------------------------------------------------------------------
// Database reads
// ---------------------------------------------------------------------------

type Tx = TransactionSql;

async function currentDatabase(tx: Tx): Promise<string> {
  const [{ database }] = await tx<{ database: string }[]>`SELECT current_database() AS database`;
  return database;
}

/** Distinct players an identity of one source names (bindable rows only). */
async function playersFor(tx: Tx, sourceKey: 'afltables' | 'manual_admin_edit', externalId: string): Promise<number[]> {
  const rows = await tx<{ playerId: number }[]>`
    SELECT DISTINCT e.player_id AS "playerId"
      FROM external_identities e JOIN sources s ON s.id = e.source_id
     WHERE s.key = ${sourceKey} AND e.match_method = ${sourceKey === 'afltables' ? 'afltables_profile_url' : 'manual_admin_edit'}
       AND e.status IN ('unique', 'resolved') AND e.player_id IS NOT NULL AND e.external_id = ${externalId}
     ORDER BY 1
  `;
  return rows.map((r) => r.playerId);
}

/** The fixture tokens, found by the exact notes literal this tool writes into each creation record. */
async function fixtureTokens(tx: Tx): Promise<string[]> {
  const rows = await tx<{ token: string }[]>`
    SELECT substring(entity_key from position(':' in entity_key) + 1) AS token
      FROM data_overrides
     WHERE entity_type = 'players' AND field_group = 'identity'
       AND split_part(entity_key, ':', 1) = 'manual_admin_edit'
       AND override_values->>'notes' = ${REGISTRATION_REHEARSAL_FIXTURE.note}
     ORDER BY 1
  `;
  return rows.map((r) => r.token);
}

export type RegistrationRehearsalResidue = {
  aflApiIdentities: number; creationRecords: number; manualIdentities: number; pathIdentities: number;
  dataEdits: number; actors: number;
};
export const ZERO_REGISTRATION_REHEARSAL_RESIDUE: RegistrationRehearsalResidue = {
  aflApiIdentities: 0, creationRecords: 0, manualIdentities: 0, pathIdentities: 0, dataEdits: 0, actors: 0,
};

export async function readRegistrationRehearsalResidue(tx: Tx): Promise<RegistrationRehearsalResidue> {
  const f = REGISTRATION_REHEARSAL_FIXTURE;
  const [row] = await tx<RegistrationRehearsalResidue[]>`
    SELECT
      (SELECT count(*)::int FROM external_identities e JOIN sources s ON s.id = e.source_id
        WHERE s.key = 'afl_api' AND e.external_id ~ ${REGISTRATION_REHEARSAL_PROVIDER_NAMESPACE}) AS "aflApiIdentities",
      (SELECT count(*)::int FROM data_overrides
        WHERE entity_type = 'players' AND override_values->>'notes' = ${f.note}) AS "creationRecords",
      (SELECT count(*)::int FROM external_identities e JOIN sources s ON s.id = e.source_id
        WHERE s.key = 'manual_admin_edit' AND e.external_id IN (
          SELECT substring(entity_key from position(':' in entity_key) + 1) FROM data_overrides
           WHERE entity_type = 'players' AND override_values->>'notes' = ${f.note})) AS "manualIdentities",
      (SELECT count(*)::int FROM external_identities e JOIN sources s ON s.id = e.source_id
        WHERE s.key = 'afltables' AND e.external_id = ${f.withPath.profilePath}) AS "pathIdentities",
      (SELECT count(*)::int FROM data_edits
        WHERE admin_user_id IN (SELECT id FROM auth_users WHERE lower(email) = ${f.actorEmail})) AS "dataEdits",
      (SELECT count(*)::int FROM auth_users WHERE lower(email) = ${f.actorEmail}) AS "actors"
  `;
  return row;
}

export function registrationResidueTotal(r: RegistrationRehearsalResidue): number {
  return Object.values(r).reduce((sum, n) => sum + n, 0);
}

async function observe(tx: Tx, captureDir: string, baseline: RegistrationRehearsalBaseline): Promise<RegistrationRehearsalObservation> {
  const f = REGISTRATION_REHEARSAL_FIXTURE;
  const database = await currentDatabase(tx);
  const live = registrationsFromLive(await readLiveRegistrationState(tx));
  const tokens = new Set(baseline.registrations.map((r) => r.token));
  const [withPathToken, withoutPathToken] = baseline.registrations.map((r) => r.token);
  const withPathTokenPlayers = await playersFor(tx, 'manual_admin_edit', withPathToken);
  const withPathPathPlayers = await playersFor(tx, 'afltables', f.withPath.profilePath);
  const withoutPathTokenPlayers = await playersFor(tx, 'manual_admin_edit', withoutPathToken);
  const withoutPathAfltablesPaths = withoutPathTokenPlayers.length !== 1 ? [] : (await tx<{ path: string }[]>`
    SELECT e.external_id AS path FROM external_identities e JOIN sources s ON s.id = e.source_id
     WHERE s.key = 'afltables' AND e.player_id = ${withoutPathTokenPlayers[0]}
  `).map((r) => r.path);
  let invariant: RegistrationRehearsalObservation['invariant'] = 'ok';
  try {
    await tx.savepoint((sp) => assertAflApiIdentityInvariant(sp));
  } catch (error) {
    invariant = { error: (error as Error).message };
  }
  return {
    database,
    markerPresent: (await readRebuildMarker(tx, database)) !== null,
    pendingCaptureExists: existsSync(join(captureDir, PENDING_CAPTURE_FILE)),
    registrationProblems: live.problems,
    fixtureRegistrations: live.registrations.filter((r) => tokens.has(r.token)),
    withPathTokenPlayers,
    withPathPathPlayers,
    withPathForward: withPathPathPlayers.length !== 1 ? null
      : (await readAflApiForwardIdentities(tx, withPathPathPlayers)).get(withPathPathPlayers[0]) ?? { ok: false, reason: 'no_identity' },
    withoutPathTokenPlayers,
    withoutPathAfltablesPaths,
    aflApiRows: await tx<RehearsalAflApiRow[]>`
      SELECT e.external_id AS "externalId", e.status::text AS status, e.match_method AS "matchMethod",
             e.player_id AS "playerId", e.candidate_count AS "candidateCount", e.external_url AS "externalUrl",
             e.external_name AS "externalName", e.notes
        FROM external_identities e JOIN sources s ON s.id = e.source_id
       WHERE s.key = 'afl_api' AND e.external_id ~ ${REGISTRATION_REHEARSAL_PROVIDER_NAMESPACE}
       ORDER BY e.external_id
    `,
    actors: await tx<RehearsalActor[]>`
      SELECT email, role, disabled_at IS NOT NULL AS disabled,
             password_hash IS NOT NULL AS "hasPasswordHash", totp_secret IS NOT NULL AS "hasTotpSecret"
        FROM auth_users WHERE lower(email) = ${f.actorEmail} ORDER BY id
    `,
    invariant,
    archivedCaptures: readArchivedRegistrationCaptures(captureDir, database, baseline),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();

function loadDotEnv(): void {
  try {
    for (const line of readFileSync(join(REPO_ROOT, '.env'), 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [key, ...rest] = trimmed.split('=');
      if (!process.env[key.trim()]) process.env[key.trim()] = rest.join('=').trim();
    }
  } catch { /* the variables may be supplied directly */ }
}

function connect(dsn: string) {
  return postgres(dsn, { max: 1, onnotice: () => {}, connection: { application_name: 'afldb-issue245-rehearsal-fixture' } });
}

async function readOnly<T>(dsn: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const sql = connect(dsn);
  try {
    return await sql.begin('isolation level repeatable read read only', fn) as T;
  } finally {
    await sql.end();
  }
}

function paths(database: string) {
  const root = resolveCaptureRoot(process.env, REPO_ROOT);
  return { captureDir: captureDirectory(root, database), baselinePath: registrationRehearsalBaselinePath(root, database) };
}

function readBaseline(path: string, database: string): RegistrationRehearsalBaseline {
  if (!existsSync(path)) throw new RegistrationRehearsalRefused(`No rehearsal baseline at ${path}: run seed first.`);
  return parseRegistrationRehearsalBaseline(readFileSync(path, 'utf8'), database);
}

async function runSeed(dsns: RehearsalDsns): Promise<void> {
  const f = REGISTRATION_REHEARSAL_FIXTURE;
  const { captureDir, baselinePath } = paths(dsns.database);

  // 1. Preconditions, read-only. Nothing is written unless every one holds.
  const problems = await readOnly(dsns.ownerDsn, async (tx) => {
    const out: string[] = [];
    const database = await currentDatabase(tx);
    if (database !== f.database) out.push(`connected to '${database}', not '${f.database}'`);
    const residue = registrationResidueTotal(await readRegistrationRehearsalResidue(tx));
    if (residue !== 0) out.push(`${residue} rehearsal fixture row(s) already exist: run teardown first`);
    const live = registrationsFromLive(await readLiveRegistrationState(tx));
    for (const x of live.problems) out.push(`the database's existing registrations would already refuse the capture: ${x}`);
    if (await readRebuildMarker(tx, database)) out.push('a rebuild marker is present: an earlier rebuild did not finish');
    return out;
  });
  if (existsSync(join(captureDir, PENDING_CAPTURE_FILE))) problems.push(`a pending rebuild capture exists in ${captureDir}`);
  if (existsSync(baselinePath)) problems.push('a rehearsal baseline already exists: run teardown (which archives it) first');
  if (problems.length > 0) throw new RegistrationRehearsalRefused(`Seed refused; nothing was written: ${problems.join('; ')}`);

  // 2. The attribution-only actor, as owner (auth_users is not import-writable).
  const owner = connect(dsns.ownerDsn);
  let actorId: number;
  try {
    actorId = await owner.begin(async (tx) => {
      if (await currentDatabase(tx) !== dsns.database) throw new RegistrationRehearsalRefused('Owner connection moved; nothing was written.');
      return insertAttributionOnlyActor(tx, { email: f.actorEmail, role: f.actorRole });
    }) as number;
  } finally {
    await owner.end();
  }

  // 3. The two registrations through the REAL primitives the ISSUE-224 registration used, and
  //    the importer row, in ONE import-role transaction. The development variables are
  //    overwritten before the server-only modules load.
  process.env.DATABASE_URL = dsns.ownerDsn;
  process.env.AFLDB_IMPORT_DATABASE_URL = dsns.importDsn;
  process.env.AFLDB_AUTH_DATABASE_URL = dsns.ownerDsn;
  const [{ createPlayerInTransaction }, { attachAflTablesIdentityInTransaction }, { sql: appSql }, { authSql }] =
    await Promise.all([
      import('@/db/queries/players'),
      import('@/db/queries/admin-draft'),
      import('@/db/client'),
      import('@/db/authClient'),
    ]);
  const importer = connect(dsns.importDsn);
  try {
    await importer.begin(async (tx) => {
      if (await currentDatabase(tx) !== dsns.database) throw new RegistrationRehearsalRefused('Import connection moved; run teardown.');
      const first = await createPlayerInTransaction(tx, {
        displayName: f.withPath.displayName, givenName: f.withPath.givenName, surname: f.withPath.surname, notes: f.note,
      }, { adminUserId: actorId });
      const attach = await attachAflTablesIdentityInTransaction(tx, {
        playerId: first.id, profilePath: f.withPath.profilePath, adminUserId: actorId, note: f.note,
      });
      if (!attach.ok) throw new RegistrationRehearsalRefused(`The AFL Tables path was refused: ${attach.error}. Run teardown.`);
      await createPlayerInTransaction(tx, {
        displayName: f.withoutPath.displayName, givenName: f.withoutPath.givenName, surname: f.withoutPath.surname, notes: f.note,
      }, { adminUserId: actorId });
      const [source] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
      if (!source) throw new RegistrationRehearsalRefused("sources.key = 'afl_api' is missing; run teardown.");
      // on the player the path names in THIS transaction, as the importer writes it
      const [player] = await playersFor(tx, 'afltables', f.withPath.profilePath);
      await tx`
        INSERT INTO external_identities
              (source_id, external_id, external_name, player_id, status, candidate_count, match_method, notes)
        VALUES (${source.id}, ${f.importer.providerId}, ${f.importer.externalName}, ${player}, 'unique', 1,
                ${f.importer.matchMethod}, ${f.importer.notes})
      `;
    });
    console.log('    registrations: 2 created (1 with an AFL Tables path + importer provider, 1 without)');
  } finally {
    await importer.end();
    await appSql.end({ timeout: 5 });
    await authSql.end({ timeout: 5 });
  }

  // 4. The baseline, read back as owner in one snapshot: durable fields only.
  const baseline = await readOnly(dsns.ownerDsn, async (tx) => {
    const tokens = await fixtureTokens(tx);
    const live = registrationsFromLive(await readLiveRegistrationState(tx)).registrations.filter((r) => tokens.includes(r.token));
    const ordered = [...live].sort((a, b) => Number(a.afltablesProfilePath === null) - Number(b.afltablesProfilePath === null));
    return buildRegistrationRehearsalBaseline({ database: dsns.database, seededAt: new Date().toISOString(), registrations: ordered });
  });
  mkdirSync(dirname(baselinePath), { recursive: true });
  const text = `${JSON.stringify(baseline, null, 2)}\n`;
  writeFileSync(`${baselinePath}.tmp`, text, 'utf8');
  renameSync(`${baselinePath}.tmp`, baselinePath);
  for (const r of baseline.registrations) console.log(`    token        : ${r.token} (${r.afltablesProfilePath ?? 'no AFL Tables path'})`);
  console.log(`    importer     : ${f.importer.providerId} -> ${f.withPath.profilePath} (${f.importer.matchMethod})`);
  console.log(`    baseline     : ${baselinePath}`);
  console.log(`    payload      : ${baseline.payloadSha256}`);
  console.log('    next         : verify --phase pre');
}

async function runVerify(dsns: RehearsalDsns, phase: 'pre' | 'post'): Promise<void> {
  const { captureDir, baselinePath } = paths(dsns.database);
  const baseline = readBaseline(baselinePath, dsns.database);
  const observed = await readOnly(dsns.ownerDsn, (tx) => observe(tx, captureDir, baseline));
  const problems = registrationRehearsalVerifyProblems(baseline, observed, phase);
  console.log(`    registered   : token -> player ${observed.withPathTokenPlayers.join('/') || 'none'}, `
    + `path -> player ${observed.withPathPathPlayers.join('/') || 'none'}; path-less token -> player `
    + `${observed.withoutPathTokenPlayers.join('/') || 'none'}`);
  console.log(`    afl_api      : ${observed.aflApiRows.map((r) => `${r.externalId} -> player ${String(r.playerId)} (${String(r.matchMethod)})`).join('; ') || 'none'}`);
  for (const c of observed.archivedCaptures.filter((x) => x.carriesFixture)) {
    console.log(`    capture      : ${c.file} sha256 ${c.fileSha256} payload ${c.payloadSha256}`);
  }
  if (problems.length > 0) {
    throw new RegistrationRehearsalRefused(`verify --phase ${phase} FAILED (${problems.length}): ${problems.join('; ')}`);
  }
  console.log(`    ISSUE-245 rehearsal verify --phase ${phase}: PASS`);
}

async function runResidue(dsns: RehearsalDsns): Promise<void> {
  const residue = await readOnly(dsns.ownerDsn, async (tx) => {
    if (await currentDatabase(tx) !== dsns.database) throw new RegistrationRehearsalRefused('The owner DSN connects elsewhere.');
    return readRegistrationRehearsalResidue(tx);
  });
  console.log(`    residue      : ${JSON.stringify(residue)}`);
  if (registrationResidueTotal(residue) !== 0) {
    throw new RegistrationRehearsalRefused(`Rehearsal residue gate FAILED: ${registrationResidueTotal(residue)} row(s) remain.`);
  }
  console.log('    ISSUE-245 rehearsal residue gate: PASS (0)');
}

async function runTeardown(dsns: RehearsalDsns): Promise<void> {
  const f = REGISTRATION_REHEARSAL_FIXTURE;
  const { captureDir, baselinePath } = paths(dsns.database);
  // Never mid-lifecycle: a marker or a pending capture means a rebuild still owes a recovery,
  // and deleting fixture rows now would make the recovered state differ from its capture.
  if (existsSync(join(captureDir, PENDING_CAPTURE_FILE))) {
    throw new RegistrationRehearsalRefused(`A pending rebuild capture exists in ${captureDir}: recover the rebuild first; nothing was deleted.`);
  }
  const owner = connect(dsns.ownerDsn);
  try {
    const report = (what: string, n: number) => console.log(`    removed      : ${String(n).padStart(3)} ${what}`);
    await owner.begin(async (tx) => {
      const database = await currentDatabase(tx);
      if (database !== dsns.database) throw new RegistrationRehearsalRefused(`The owner DSN connects to '${database}'; nothing was deleted.`);
      if (await readRebuildMarker(tx, database)) {
        throw new RegistrationRehearsalRefused('A rebuild marker is present: recover the rebuild first; nothing was deleted.');
      }
      // The fixture players, resolved in THIS transaction from the fixture's own identities.
      const tokens = await fixtureTokens(tx);
      const playerIds = [...new Set([
        ...(await Promise.all(tokens.map((t) => playersFor(tx, 'manual_admin_edit', t)))).flat(),
        ...await playersFor(tx, 'afltables', f.withPath.profilePath),
      ])];
      report('afl_api identity row(s)', (await tx`
        DELETE FROM external_identities
         WHERE source_id = (SELECT id FROM sources WHERE key = 'afl_api') AND external_id = ${f.importer.providerId}
      `).count);
      report('manual identity row(s)', (await tx`
        DELETE FROM external_identities
         WHERE source_id = (SELECT id FROM sources WHERE key = 'manual_admin_edit') AND external_id = ANY (${tx.array(tokens)}::text[])
      `).count);
      report('AFL Tables identity row(s)', (await tx`
        DELETE FROM external_identities
         WHERE source_id = (SELECT id FROM sources WHERE key = 'afltables') AND external_id = ${f.withPath.profilePath}
      `).count);
      report('creation record(s)', (await tx`
        DELETE FROM data_overrides WHERE entity_type = 'players' AND override_values->>'notes' = ${f.note}
      `).count);
      report('data_edits audit row(s)', (await tx`
        DELETE FROM data_edits WHERE admin_user_id IN (SELECT id FROM auth_users WHERE lower(email) = ${f.actorEmail})
      `).count);
      report('career-stats row(s)', (await tx`
        DELETE FROM player_career_stats WHERE player_id = ANY (${tx.array(playerIds)}::int[])
      `).count);
      report('player(s)', (await tx`DELETE FROM players WHERE id = ANY (${tx.array(playerIds)}::int[])`).count);
    });
    // Its own transaction: if another row legitimately references the actor, the data teardown
    // above still stands and the refusal names the constraint.
    const actors = await owner.begin((tx) => tx`DELETE FROM auth_users WHERE lower(email) = ${f.actorEmail}`);
    report('fixture actor(s)', actors.count);
  } finally {
    await owner.end();
  }

  await runResidue(dsns);

  if (existsSync(baselinePath)) {
    const archived = baselinePath.replace(/\.baseline\.json$/, `.baseline.${new Date().toISOString().replace(/[-:.]/g, '')}.torn-down.json`);
    renameSync(baselinePath, archived);
    console.log(`    baseline     : archived as ${archived}`);
  }
  console.log('    ISSUE-245 rehearsal teardown: PASS');
}

async function main(argv: string[]): Promise<void> {
  const command = parseRehearsalArgs(argv);
  loadDotEnv();
  const dsns = resolveRehearsalDsns(process.env, {
    // Only seed writes through the import DSN; verify, residue and teardown are owner-only.
    allowOwnerImportDsn: command.step === 'seed' ? command.allowOwnerImportDsn : true,
  });
  const f = REGISTRATION_REHEARSAL_FIXTURE;
  if (!AFL_API_PROVIDER_ID_RE.test(f.importer.providerId) || !REGISTRATION_REHEARSAL_PROVIDER_NAMESPACE_RE.test(f.importer.providerId)) {
    throw new RegistrationRehearsalRefused(`Fixture provider id ${f.importer.providerId} is outside the ISSUE-245 namespace.`);
  }
  if (!REGISTRATION_PROFILE_PATH_RE.test(f.withPath.profilePath)) {
    throw new RegistrationRehearsalRefused(`Fixture path ${f.withPath.profilePath} is not an AFL Tables profile path.`);
  }
  console.log(`AFLDB-ISSUE-245 rehearsal fixture — ${command.step}`
    + `${command.step === 'verify' ? ` --phase ${command.phase}` : ''} on ${dsns.database}`
    + `${command.step === 'seed' && dsns.importIsOwner ? ` (OWNER substituted for ${REHEARSAL_IMPORT_ENV})` : ''}`);
  if (command.step === 'seed') return runSeed(dsns);
  if (command.step === 'verify') return runVerify(dsns, command.phase);
  if (command.step === 'residue') return runResidue(dsns);
  return runTeardown(dsns);
}

if (process.argv[1] && /manual_registration_rebuild_rehearsal_fixture\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`    REFUSED: ${redact((error as Error).message)}`);
      process.exit(1);
    });
}
