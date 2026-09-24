/**
 * AFLDB-ISSUE-235 I18 (runbook §10.2, OD-5) — the tracked fixture for the guarded `afldb_test`
 * rebuild validation. Seed, verify and teardown are explicit operator steps AROUND
 * `npm run db:test:rebuild`; the rebuild itself never creates, reads or removes this fixture.
 *
 *     npm run db:test:issue235-i18 -- seed [--allow-owner-import-dsn]
 *     npm run db:test:issue235-i18 -- verify --phase pre
 *     npm run db:test:issue235-i18 -- verify --phase post
 *     npm run db:test:issue235-i18 -- teardown
 *
 * (`--conditions=react-server` is in the package script: `seed` calls the real `server-only`
 * query module. `verify` and `teardown` never load it, so they also run under plain
 * `npx tsx tools/migration/afl_api_adjudication_i18_fixture.ts …`; teardown's proof reads the
 * server-neutral `tests/integration/afl-api-fixture-ownership.ts`, never the seeding fixtures.)
 *
 * WHAT IT PROVES. One human `afl_api` adjudication history — linked, revoked, linked — on a REAL
 * baseline player that the rebuild recreates from tracked sources. `verify --phase post` proves
 * the ledger came back under its original ids with every audit field intact, `player_id`
 * re-derived from the stored stable identity (never from the stored number), the actor
 * reconstructed attribution-only, the sequence above the ledger, the human `resolved` identity
 * replayed, a second replay a no-op, the bijection, and the capture archived with its hash.
 * Importer `afl_api` rows (AFLDB-ISSUE-237) are NOT expected to survive and are not checked.
 *
 * WHY A REAL PLAYER. The S6 fixture players are synthetic (`players/Z/Issue235-S6-*`) and the
 * rebuild does not recreate them, so a ledger row on one would stop stage 18 after the reset.
 * The player is named by its AFL Tables identity, resolved through the D15 rule
 * (`resolveAflApiPlayerIdentity`), never by a numeric id.
 *
 * WRITES. The adjudications go through `linkAflApiProvider()` / `revokeAflApiLink()` on the
 * import DSN — the same functions the admin surface calls. Direct INSERTs are fixture setup only:
 * the actor, and the pending `unresolved_identity` evidence a settle would have written (without
 * it a link is T5). No player statistic, Brownlow row or other LINK_DEPENDENT use is ever seeded,
 * so the link stays provably revocable. Teardown runs as the owner (the ledger is append-only for
 * `afldb_import`/`afldb_auth`, migration 104) and removes only the exact ids in `I18_FIXTURE`.
 *
 * TARGET. `afldb_test` only, through `AFLDB_TEST_DATABASE_URL` (owner) and
 * `AFLDB_TEST_IMPORT_DATABASE_URL` (the restricted import role). The development
 * `DATABASE_URL`/`AFLDB_IMPORT_DATABASE_URL` from `.env` are OVERWRITTEN in this process before
 * the query module is loaded, and the connected database is re-checked. No DSN is printed.
 *
 * EVIDENCE. `seed` writes the pre-rebuild baseline to `backups/issue-235-i18/` (gitignored: it
 * holds an actor email and notes, never a credential). Every later step compares against it.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import postgres, { type TransactionSql } from 'postgres';

import {
  AFL_API_ADMIN_MATCH_METHOD,
  AFL_API_PLAYER_REFERENCE_MANIFEST,
  AFL_API_PROVIDER_ID_RE,
} from '../../src/lib/acquisition/afl-api-adjudication';
import { assertRebuildTargetName, databaseOf } from '../db/rebuild-test';
import { redact } from '../db/psql';
import {
  captureDirectory,
  nextIdentityValue,
  observeLiveReinstatement,
  parseLedgerCapture,
  PENDING_CAPTURE_FILE,
  type LiveReinstatementObservation,
} from './rebuild_afl_api_adjudications';
import { resolveAflApiPlayerIdentity } from './replay_afl_api_adjudications';

export class I18FixtureRefused extends Error {}

// ---------------------------------------------------------------------------
// Ownership: exact literals only. Never a prefix: real provider ids are CD_I + 6–7 digits.
// ---------------------------------------------------------------------------

export const I18_FIXTURE = {
  database: 'afldb_test',
  /** CD_I + 10 digits: outside every real Champion Data id and outside S6's `^CD_I999235[0-9]{4}$`. */
  providerId: 'CD_I9991800001',
  /** The spine record the pending evidence hangs off: `<match>|<team>|<provider>`. */
  matchId: 'CD_M9991800001',
  teamId: 'CD_T20',
  externalRecordId: 'CD_M9991800001|CD_T20|CD_I9991800001',
  actorEmail: 'issue235-i18-fixture@example.test',
  actorRole: 'super_admin',
  tool: 'issue235-i18-fixture',
  hashRecipe: 'issue235-i18-fixture:sha256',
  /** The baseline player, by its durable AFL Tables identity (Alan Martello, 1970–1983). */
  stableIdentity: 'players/A/Alan_Martello.html',
  season: 2026,
  notes: {
    firstLink: 'AFLDB-ISSUE-235 I18 rebuild-durability fixture: first link of a synthetic provider.',
    revoke: 'AFLDB-ISSUE-235 I18 rebuild-durability fixture: revoke while provably unused.',
    secondLink: 'AFLDB-ISSUE-235 I18 rebuild-durability fixture: re-link after the revoke.',
  },
} as const;

export const I18_BASELINE_FORMAT = 'afldb.issue235.i18_fixture_baseline';
export const I18_BASELINE_VERSION = 1;
export const I18_EXPECTED_ACTIONS = ['linked', 'revoked', 'linked'] as const;

/** Gitignored (`backups/`), per target; never inside `backups/rebuild/`, which the capture stage owns. */
export function i18BaselineDirectory(repoRoot: string): string {
  return join(repoRoot, 'backups', 'issue-235-i18');
}
export function i18BaselinePath(repoRoot: string, database: string): string {
  return join(i18BaselineDirectory(repoRoot), `${database}.baseline.json`);
}

// ---------------------------------------------------------------------------
// Arguments and DSNs
// ---------------------------------------------------------------------------

export type I18Command =
  | { step: 'seed'; allowOwnerImportDsn: boolean }
  | { step: 'verify'; phase: 'pre' | 'post' }
  | { step: 'teardown' };

export function parseI18Args(argv: readonly string[]): I18Command {
  const [step, ...rest] = argv;
  if (step === 'seed') {
    const unknown = rest.filter((a) => a !== '--allow-owner-import-dsn');
    if (unknown.length > 0) throw new I18FixtureRefused(`Unexpected argument(s) for seed: ${unknown.join(' ')}`);
    return { step, allowOwnerImportDsn: rest.includes('--allow-owner-import-dsn') };
  }
  if (step === 'verify') {
    if (rest.length !== 2 || rest[0] !== '--phase' || (rest[1] !== 'pre' && rest[1] !== 'post')) {
      throw new I18FixtureRefused('verify needs exactly --phase pre or --phase post.');
    }
    return { step, phase: rest[1] };
  }
  if (step === 'teardown') {
    if (rest.length > 0) throw new I18FixtureRefused(`Unexpected argument(s) for teardown: ${rest.join(' ')}`);
    return { step };
  }
  throw new I18FixtureRefused(`Unknown step '${String(step)}': seed, verify --phase pre|post, or teardown.`);
}

export type I18Dsns = { database: string; ownerDsn: string; importDsn: string; importIsOwner: boolean };

/**
 * The owner DSN must name `afldb_test` (the rebuild's own name guard, then the literal); the
 * import DSN must name the same database. Without the import DSN only an explicit
 * `--allow-owner-import-dsn` substitutes the owner — and only `seed` writes through it.
 */
export function resolveI18Dsns(
  env: Record<string, string | undefined>, opts: { allowOwnerImportDsn: boolean },
): I18Dsns {
  const ownerDsn = env.AFLDB_TEST_DATABASE_URL;
  if (!ownerDsn) throw new I18FixtureRefused('AFLDB_TEST_DATABASE_URL is not set.');
  let database: string;
  try {
    database = databaseOf(ownerDsn);
  } catch {
    throw new I18FixtureRefused('AFLDB_TEST_DATABASE_URL is not a valid connection URL.');
  }
  assertRebuildTargetName(database);
  if (database !== I18_FIXTURE.database) {
    throw new I18FixtureRefused(
      `AFLDB_TEST_DATABASE_URL names '${database}'. The I18 fixture runs on '${I18_FIXTURE.database}' only.`);
  }
  const restricted = env.AFLDB_TEST_IMPORT_DATABASE_URL;
  if (restricted) {
    let importDatabase: string;
    try {
      importDatabase = databaseOf(restricted);
    } catch {
      throw new I18FixtureRefused('AFLDB_TEST_IMPORT_DATABASE_URL is not a valid connection URL.');
    }
    if (importDatabase !== database) {
      throw new I18FixtureRefused(
        `AFLDB_TEST_IMPORT_DATABASE_URL names '${importDatabase}', not '${database}'.`);
    }
    return { database, ownerDsn, importDsn: restricted, importIsOwner: false };
  }
  if (opts.allowOwnerImportDsn) return { database, ownerDsn, importDsn: ownerDsn, importIsOwner: true };
  throw new I18FixtureRefused(
    'AFLDB_TEST_IMPORT_DATABASE_URL is not set. Set it to the afldb_import DSN for afldb_test, or pass '
    + '--allow-owner-import-dsn to seed as owner deliberately.');
}

// ---------------------------------------------------------------------------
// Seed preconditions (pure)
// ---------------------------------------------------------------------------

export type I18SeedObservation = {
  /** Distinct players the stable identity resolves to under the D15 rule. */
  resolvedPlayerIds: readonly number[];
  /** Every trusted stable identity the resolved player holds (afltables + manual_admin_edit). */
  playerStableIdentities: readonly { sourceKey: string; externalId: string }[];
  /** Any-status `afl_api` rows naming the resolved player. */
  playerAflApiRows: number;
  /** LINK_DEPENDENT / ledger-check uses of the resolved player through the afl_api source. */
  playerAflApiUses: number;
  /** Ledger rows naming the resolved player, whatever the provider. */
  playerLedgerRows: number;
  /** Any I18-owned row already present (ledger, identity, staging, candidate, batch, actor). */
  fixtureRows: number;
  /** Ledger rows and human `resolved` rows on the whole database (I18 needs both at 0). */
  ledgerRows: number;
  humanResolvedRows: number;
  pendingCaptureExists: boolean;
  baselineExists: boolean;
};

/**
 * Every reason the fixture must NOT be seeded. Fail closed: another player is never chosen
 * silently. The whole-ledger conditions keep post-rebuild counts exact (replay, bijection).
 */
export function i18SeedPreconditionProblems(o: I18SeedObservation): string[] {
  const problems: string[] = [];
  if (o.resolvedPlayerIds.length !== 1) {
    problems.push(`'${I18_FIXTURE.stableIdentity}' resolves to ${o.resolvedPlayerIds.length} players, not exactly one`);
  }
  const stable = o.playerStableIdentities;
  if (o.resolvedPlayerIds.length === 1
      && !(stable.length === 1 && stable[0].sourceKey === 'afltables'
           && stable[0].externalId === I18_FIXTURE.stableIdentity)) {
    problems.push(`the player's trusted stable identities are [${stable.map((s) => `${s.sourceKey}:${s.externalId}`).join(', ')}], `
      + `not exactly afltables:${I18_FIXTURE.stableIdentity} (a second AFL Tables or a manual_admin_edit identity makes D15 ambiguous)`);
  }
  if (o.playerAflApiRows !== 0) problems.push(`the player already holds ${o.playerAflApiRows} afl_api identity row(s)`);
  if (o.playerAflApiUses !== 0) {
    problems.push(`the player has ${o.playerAflApiUses} afl_api LINK_DEPENDENT/ledger use(s), so a revoke could not be proven safe`);
  }
  if (o.playerLedgerRows !== 0) problems.push(`the player already has ${o.playerLedgerRows} adjudication ledger row(s)`);
  if (o.fixtureRows !== 0) problems.push(`${o.fixtureRows} I18 fixture row(s) already exist: run teardown first`);
  if (o.ledgerRows !== 0) problems.push(`the adjudication ledger is not empty (${o.ledgerRows} row(s))`);
  if (o.humanResolvedRows !== 0) problems.push(`${o.humanResolvedRows} human afl_api 'resolved' row(s) already exist`);
  if (o.pendingCaptureExists) problems.push(`a pending rebuild capture (${PENDING_CAPTURE_FILE}) exists: an earlier rebuild did not finish`);
  if (o.baselineExists) problems.push('an I18 baseline file already exists: run teardown (which archives it) first');
  return problems;
}

// ---------------------------------------------------------------------------
// The baseline (pure)
// ---------------------------------------------------------------------------

export type I18LedgerRow = {
  id: number;
  externalId: string;
  action: 'linked' | 'revoked';
  playerId: number;
  playerIdentity: string;
  /** `previous_state::text`: PostgreSQL's canonical jsonb rendering, the reinstate contract's own. */
  previousState: string | null;
  previousStateType: string | null;
  /** `evidence::text`, likewise. */
  evidence: string;
  evidenceType: string;
  evidenceSha256: string;
  surnameAck: boolean;
  supersedesId: number | null;
  adminUserId: number;
  adminEmail: string;
  note: string;
  /** UTC microseconds, `YYYY-MM-DDTHH:MM:SS.ffffffZ`: the precision reinstate round-trips. */
  createdAt: string;
};

export type I18Actor = {
  id: number; email: string; role: string; disabled: boolean; hasPasswordHash: boolean; hasTotpSecret: boolean;
};
export type I18IdentityRow = { id: number; status: string; matchMethod: string | null; playerId: number | null };
export type I18Sequence = { lastValue: number; isCalled: boolean };

export type I18Baseline = {
  format: typeof I18_BASELINE_FORMAT;
  version: typeof I18_BASELINE_VERSION;
  database: string;
  seededAt: string;
  providerId: string;
  stableIdentity: string;
  /** The PRE-rebuild surrogate. Audit only: post-rebuild it may name another player or none. */
  playerId: number;
  actor: { id: number; email: string; role: string };
  ledger: I18LedgerRow[];
  identity: I18IdentityRow;
  sequence: I18Sequence & { next: number };
  payloadSha256: string;
};

/** The three-row history seed must have produced: linked, revoked (superseding it), linked. */
export function i18LedgerShapeProblems(rows: readonly I18LedgerRow[]): string[] {
  const problems: string[] = [];
  const actions = rows.map((r) => r.action);
  if (JSON.stringify(actions) !== JSON.stringify(I18_EXPECTED_ACTIONS)) {
    problems.push(`ledger actions are [${actions.join(', ')}], not [${I18_EXPECTED_ACTIONS.join(', ')}]`);
    return problems;
  }
  const [first, revoked, second] = rows;
  if (!(first.id < revoked.id && revoked.id < second.id)) problems.push('ledger ids are not strictly ascending');
  if (first.supersedesId !== null) problems.push('the first linked row has a supersedes_id');
  if (revoked.supersedesId !== first.id) {
    problems.push(`the revoked row supersedes ${String(revoked.supersedesId)}, not the first linked row ${first.id}`);
  }
  if (second.supersedesId !== null) problems.push('the second linked row has a supersedes_id');
  for (const r of rows) {
    const at = `ledger row ${r.id}`;
    if (r.externalId !== I18_FIXTURE.providerId) problems.push(`${at}: provider is ${r.externalId}`);
    if (r.playerIdentity !== I18_FIXTURE.stableIdentity) problems.push(`${at}: player_identity is ${r.playerIdentity}`);
    if (r.adminEmail.toLowerCase() !== I18_FIXTURE.actorEmail) problems.push(`${at}: actor is not the I18 actor`);
    if (r.evidenceType !== 'object') problems.push(`${at}: evidence is jsonb ${r.evidenceType}, not an object`);
    if (r.previousState !== null && r.previousStateType !== 'object') {
      problems.push(`${at}: previous_state is jsonb ${String(r.previousStateType)}, not an object`);
    }
  }
  if (first.previousState !== null) problems.push('the first link records a previous state, but the provider had no row');
  if (revoked.previousState === null) problems.push('the revoke records no previous state');
  if (second.previousState !== null) problems.push('the re-link records a previous state, but the revoke deleted the row');
  if (new Set(rows.map((r) => r.playerId)).size !== 1) problems.push('the ledger rows name different player ids');
  return problems;
}

function baselineBody(b: Omit<I18Baseline, 'payloadSha256'>): unknown[] {
  return [b.format, b.version, b.database, b.seededAt, b.providerId, b.stableIdentity, b.playerId,
    [b.actor.id, b.actor.email, b.actor.role],
    b.ledger.map((r) => [r.id, r.externalId, r.action, r.playerId, r.playerIdentity, r.previousState,
      r.previousStateType, r.evidence, r.evidenceType, r.evidenceSha256, r.surnameAck, r.supersedesId,
      r.adminUserId, r.adminEmail, r.note, r.createdAt]),
    [b.identity.id, b.identity.status, b.identity.matchMethod, b.identity.playerId],
    [b.sequence.lastValue, b.sequence.isCalled, b.sequence.next]];
}

export function i18BaselineSha256(b: Omit<I18Baseline, 'payloadSha256'>): string {
  return createHash('sha256').update(JSON.stringify(baselineBody(b)), 'utf8').digest('hex');
}

export function buildI18Baseline(input: Omit<I18Baseline, 'format' | 'version' | 'payloadSha256'>): I18Baseline {
  const problems = i18LedgerShapeProblems(input.ledger);
  if (problems.length > 0) {
    throw new I18FixtureRefused(`The seeded ledger is not the I18 shape: ${problems.join('; ')}`);
  }
  const body = { format: I18_BASELINE_FORMAT, version: I18_BASELINE_VERSION, ...input } as const;
  return { ...body, payloadSha256: i18BaselineSha256(body) };
}

/** Parse and prove a baseline file: format, target, shape, and its own hash. */
export function parseI18Baseline(text: string, expectedDatabase: string): I18Baseline {
  let raw: I18Baseline;
  try {
    raw = JSON.parse(text) as I18Baseline;
  } catch {
    throw new I18FixtureRefused('The I18 baseline file is not valid JSON.');
  }
  if (raw.format !== I18_BASELINE_FORMAT || raw.version !== I18_BASELINE_VERSION) {
    throw new I18FixtureRefused('The I18 baseline file has an unknown format or version.');
  }
  if (raw.database !== expectedDatabase) {
    throw new I18FixtureRefused(`The I18 baseline was taken from '${String(raw.database)}', not '${expectedDatabase}'.`);
  }
  const { payloadSha256, ...body } = raw;
  if (i18BaselineSha256(body) !== payloadSha256) {
    throw new I18FixtureRefused('The I18 baseline file does not match its own payload hash: it was altered.');
  }
  const problems = i18LedgerShapeProblems(raw.ledger);
  if (problems.length > 0) throw new I18FixtureRefused(`The I18 baseline ledger is malformed: ${problems.join('; ')}`);
  return raw;
}

// ---------------------------------------------------------------------------
// Verification (pure)
// ---------------------------------------------------------------------------

export type I18ArchivedCapture = { file: string; fileSha256: string; payloadSha256: string; matchesBaseline: boolean };

export type I18Observation = {
  database: string;
  resolvedPlayerIds: readonly number[];
  /** The provider's ledger rows, in id order. */
  ledger: readonly I18LedgerRow[];
  ledgerTotal: number;
  ledgerMaxId: number;
  /** Any-status `afl_api` rows for the provider. */
  providerIdentities: readonly I18IdentityRow[];
  /** `afl_api` rows naming the resolved player (any provider). */
  playerAflApiProviders: readonly string[];
  humanResolvedTotal: number;
  /** Every `auth_users` row with the actor's email, case-insensitive. */
  actors: readonly I18Actor[];
  live: LiveReinstatementObservation;
  pendingCaptureExists: boolean;
  archivedCaptures: readonly I18ArchivedCapture[];
};

/** The fields a reinstatement must carry byte-for-byte (every column but the two surrogates). */
function durableFields(r: I18LedgerRow): unknown[] {
  return [r.id, r.externalId, r.action, r.playerIdentity, r.previousState, r.previousStateType, r.evidence,
    r.evidenceType, r.evidenceSha256, r.surnameAck, r.supersedesId, r.adminEmail.toLowerCase(), r.note, r.createdAt];
}
const DURABLE_FIELD_NAMES = ['id', 'external_id', 'action', 'player_identity', 'previous_state',
  'previous_state type', 'evidence', 'evidence type', 'evidence_sha256', 'surname_disagreement_acknowledged',
  'supersedes_id', 'actor email', 'note', 'created_at'];

/**
 * Every way the database differs from the I18 contract. `pre`: the baseline exactly, surrogates
 * included, and no pending capture. `post`: the durable fields exactly, `player_id` equal to the
 * player the stable identity resolves to NOW, the actor attribution-only, the capture archived.
 */
export function i18VerifyProblems(baseline: I18Baseline, o: I18Observation, phase: 'pre' | 'post'): string[] {
  const problems: string[] = [];
  if (o.database !== baseline.database) problems.push(`connected to '${o.database}', not '${baseline.database}'`);

  if (o.resolvedPlayerIds.length !== 1) {
    problems.push(`'${baseline.stableIdentity}' resolves to ${o.resolvedPlayerIds.length} players, not exactly one`);
    return problems;
  }
  const playerId = o.resolvedPlayerIds[0];
  if (phase === 'pre' && playerId !== baseline.playerId) {
    problems.push(`before the rebuild the identity resolves to player ${playerId}, not the seeded ${baseline.playerId}`);
  }

  // The actor.
  if (o.actors.length !== 1) {
    problems.push(`${o.actors.length} auth_users row(s) carry the I18 actor email, not exactly one`);
  }
  const actor = o.actors[0];
  if (actor) {
    if (actor.role !== baseline.actor.role) problems.push(`the actor's role is '${actor.role}', not the captured '${baseline.actor.role}'`);
    if (!actor.disabled) problems.push('the actor is not disabled');
    if (actor.hasPasswordHash) problems.push('the actor has a password hash');
    if (actor.hasTotpSecret) problems.push('the actor has a TOTP secret');
    if (phase === 'pre' && actor.id !== baseline.actor.id) problems.push('the actor id changed before the rebuild');
  }

  // The ledger, row for row under the ORIGINAL ids.
  if (o.ledger.length !== baseline.ledger.length) {
    problems.push(`${o.ledger.length} ledger row(s) for ${baseline.providerId}, not ${baseline.ledger.length}`);
  } else {
    baseline.ledger.forEach((expected, i) => {
      const got = o.ledger[i];
      const a = durableFields(expected);
      const b = durableFields(got);
      const diff = DURABLE_FIELD_NAMES.filter((_, k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      if (diff.length > 0) problems.push(`ledger row ${expected.id}: ${diff.join(', ')} differ from the baseline`);
      if (got.playerId !== playerId) {
        problems.push(`ledger row ${expected.id}: player_id ${got.playerId} is not the player the identity resolves to (${playerId})`);
      }
      if (actor && got.adminUserId !== actor.id) {
        problems.push(`ledger row ${expected.id}: admin_user_id ${got.adminUserId} is not the actor (${actor.id})`);
      }
      if (phase === 'pre' && got.playerId !== expected.playerId) problems.push(`ledger row ${expected.id}: player_id changed`);
    });
    problems.push(...i18LedgerShapeProblems(o.ledger).map((p) => `live ledger: ${p}`));
  }
  if (o.ledgerTotal !== baseline.ledger.length) {
    problems.push(`the whole ledger holds ${o.ledgerTotal} row(s), not only the ${baseline.ledger.length} I18 row(s)`);
  }

  // No surviving trust in the stored number when the rebuild renumbered the player.
  if (phase === 'post' && playerId !== baseline.playerId) {
    if (o.ledger.some((r) => r.playerId === baseline.playerId)) {
      problems.push(`a ledger row still names the pre-rebuild player id ${baseline.playerId}`);
    }
    if (o.providerIdentities.some((r) => r.playerId === baseline.playerId)) {
      problems.push(`the provider's identity still names the pre-rebuild player id ${baseline.playerId}`);
    }
  }

  // The human identity: exactly one afl_api row for the provider, the resolved human row.
  if (o.providerIdentities.length !== 1) {
    problems.push(`${o.providerIdentities.length} afl_api identity row(s) for ${baseline.providerId}, not exactly one`);
  } else {
    const row = o.providerIdentities[0];
    if (row.status !== 'resolved') problems.push(`the provider's identity is '${row.status}', not 'resolved'`);
    if (row.matchMethod !== AFL_API_ADMIN_MATCH_METHOD) {
      problems.push(`the provider's identity match_method is '${String(row.matchMethod)}', not '${AFL_API_ADMIN_MATCH_METHOD}'`);
    }
    if (row.playerId !== playerId) problems.push(`the provider's identity names player ${String(row.playerId)}, not ${playerId}`);
    if (phase === 'pre' && row.id !== baseline.identity.id) problems.push('the identity row id changed before the rebuild');
  }
  if (JSON.stringify(o.playerAflApiProviders) !== JSON.stringify([baseline.providerId])) {
    problems.push(`the player holds afl_api rows for [${o.playerAflApiProviders.join(', ')}], not only ${baseline.providerId}`);
  }
  if (o.humanResolvedTotal !== 1) problems.push(`${o.humanResolvedTotal} human afl_api 'resolved' row(s) exist, not exactly one`);

  // Sequence, replay, bijection.
  const next = nextIdentityValue(o.live.sequence);
  if (!(next > o.ledgerMaxId)) problems.push(`the ledger sequence would next hand out ${next}, not above max(id) ${o.ledgerMaxId}`);
  if (phase === 'pre' && next !== baseline.sequence.next) problems.push('the ledger sequence moved after seed');
  if ('error' in o.live.replay) problems.push(`the replay could not run read-only: ${o.live.replay.error}`);
  else if (o.live.replay.inserted !== 0 || o.live.replay.stops.length !== 0 || o.live.replay.noops !== 1) {
    problems.push(`a replay is not a single no-op (inserted ${o.live.replay.inserted}, no-op ${o.live.replay.noops}, `
      + `stops ${o.live.replay.stops.length})`);
  }
  if (o.live.bijection !== 'ok') problems.push(`the bijection does not hold: ${o.live.bijection.error}`);

  // The rebuild capture.
  if (o.pendingCaptureExists) {
    problems.push(phase === 'pre'
      ? `a pending rebuild capture exists: the rebuild's capture stage would refuse or adopt it`
      : 'the pending rebuild capture was not archived: stage 18 did not complete');
  }
  if (phase === 'post' && !o.archivedCaptures.some((c) => c.matchesBaseline)) {
    problems.push('no archived rebuild capture holds the I18 ledger');
  }
  return problems;
}

/** An archived capture holds the I18 ledger when its rows carry the baseline's durable fields. */
export function captureMatchesBaseline(
  rows: readonly { id: number; externalId: string; action: string; evidenceSha256: string; supersedesId: number | null;
    createdAt: string; playerIdentity: string }[],
  baseline: I18Baseline,
): boolean {
  const key = (r: { id: number; externalId: string; action: string; evidenceSha256: string; supersedesId: number | null;
    createdAt: string; playerIdentity: string }) =>
    JSON.stringify([r.id, r.externalId, r.action, r.evidenceSha256, r.supersedesId, r.createdAt, r.playerIdentity]);
  return rows.length === baseline.ledger.length && rows.every((r, i) => key(r) === key(baseline.ledger[i]));
}

// ---------------------------------------------------------------------------
// Database reads
// ---------------------------------------------------------------------------

type Tx = TransactionSql;

async function aflApiSourceId(tx: Tx): Promise<number> {
  const [row] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
  if (!row) throw new I18FixtureRefused("sources.key = 'afl_api' is missing (migration 077).");
  return row.id;
}

async function resolvedPlayerIds(tx: Tx): Promise<number[]> {
  const result = await resolveAflApiPlayerIdentity(tx, I18_FIXTURE.stableIdentity);
  if (result.ok) return [result.newPlayerId];
  if (result.reason === 'unresolvable') return [];
  // Ambiguous: report how many, never pick one.
  const rows = await tx<{ playerId: number }[]>`
    SELECT DISTINCT ei.player_id AS "playerId"
      FROM external_identities ei JOIN sources s ON s.id = ei.source_id
     WHERE ((s.key = 'afltables' AND ei.match_method = 'afltables_profile_url')
            OR (s.key = 'manual_admin_edit' AND ei.match_method = 'manual_admin_edit'))
       AND ei.status IN ('unique', 'resolved') AND ei.external_id = ${I18_FIXTURE.stableIdentity}
  `;
  return rows.map((r) => r.playerId);
}

/** Every I18-owned row, by the exact literals only. */
async function countFixtureRows(tx: Tx, sourceId: number): Promise<number> {
  const f = I18_FIXTURE;
  const [row] = await tx<{ n: number }[]>`
    SELECT
      (SELECT count(*)::int FROM afl_api_identity_adjudications
        WHERE external_id = ${f.providerId}
           OR admin_user_id IN (SELECT id FROM auth_users WHERE lower(email) = ${f.actorEmail}))
    + (SELECT count(*)::int FROM external_identities WHERE source_id = ${sourceId} AND external_id = ${f.providerId})
    + (SELECT count(*)::int FROM promotion_candidates WHERE external_record_id = ${f.externalRecordId})
    + (SELECT count(*)::int FROM staging.source_record_versions WHERE external_record_id = ${f.externalRecordId})
    + (SELECT count(*)::int FROM staging.source_payloads WHERE hash_recipe = ${f.hashRecipe})
    + (SELECT count(*)::int FROM import_batches WHERE tool = ${f.tool})
    + (SELECT count(*)::int FROM auth_users WHERE lower(email) = ${f.actorEmail}) AS n
  `;
  return row.n;
}

/** D10's LINK_DEPENDENT predicates plus the two ledger checks, for the PLAYER side only. */
async function countPlayerAflApiUses(tx: Tx, sourceId: number, playerId: number): Promise<number> {
  let total = 0;
  for (const entry of AFL_API_PLAYER_REFERENCE_MANIFEST) {
    if (entry.class !== 'LINK_DEPENDENT') continue;
    for (const column of entry.playerColumns) {
      const [row] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ${tx(entry.schema)}.${tx(entry.table)}
         WHERE source_id = ${sourceId} AND ${tx(column)} = ${playerId}
      `;
      total += row.n;
    }
  }
  const [ledgerChecks] = await tx<{ n: number }[]>`
    SELECT (SELECT count(*)::int FROM canonical_applications
             WHERE source_id = ${sourceId} AND target_key->>'player_id' = ${String(playerId)})
         + (SELECT count(*)::int FROM promotion_candidates
             WHERE source_id = ${sourceId} AND proposed_fields->>'player_id' = ${String(playerId)}) AS n
  `;
  return total + ledgerChecks.n;
}

export async function observeSeedPreconditions(
  tx: Tx, files: { pendingCaptureExists: boolean; baselineExists: boolean },
): Promise<{ observation: I18SeedObservation; playerId: number | null }> {
  const sourceId = await aflApiSourceId(tx);
  const players = await resolvedPlayerIds(tx);
  const playerId = players.length === 1 ? players[0] : null;
  const stable = playerId === null ? [] : await tx<{ sourceKey: string; externalId: string }[]>`
    SELECT s.key AS "sourceKey", ei.external_id AS "externalId"
      FROM external_identities ei JOIN sources s ON s.id = ei.source_id
     WHERE ((s.key = 'afltables' AND ei.match_method = 'afltables_profile_url')
            OR (s.key = 'manual_admin_edit' AND ei.match_method = 'manual_admin_edit'))
       AND ei.status IN ('unique', 'resolved') AND ei.player_id = ${playerId}
     ORDER BY s.key, ei.external_id
  `;
  const [counts] = await tx<{ playerAflApiRows: number; playerLedgerRows: number; ledgerRows: number; humanResolvedRows: number }[]>`
    SELECT
      (SELECT count(*)::int FROM external_identities WHERE source_id = ${sourceId} AND player_id = ${playerId ?? -1}) AS "playerAflApiRows",
      (SELECT count(*)::int FROM afl_api_identity_adjudications WHERE player_id = ${playerId ?? -1}) AS "playerLedgerRows",
      (SELECT count(*)::int FROM afl_api_identity_adjudications) AS "ledgerRows",
      (SELECT count(*)::int FROM external_identities
        WHERE source_id = ${sourceId} AND status = 'resolved' AND match_method = ${AFL_API_ADMIN_MATCH_METHOD}) AS "humanResolvedRows"
  `;
  return {
    playerId,
    observation: {
      resolvedPlayerIds: players,
      playerStableIdentities: stable,
      playerAflApiRows: counts.playerAflApiRows,
      playerAflApiUses: playerId === null ? 0 : await countPlayerAflApiUses(tx, sourceId, playerId),
      playerLedgerRows: counts.playerLedgerRows,
      fixtureRows: await countFixtureRows(tx, sourceId),
      ledgerRows: counts.ledgerRows,
      humanResolvedRows: counts.humanResolvedRows,
      ...files,
    },
  };
}

async function readI18Ledger(tx: Tx): Promise<I18LedgerRow[]> {
  const rows = await tx<(Omit<I18LedgerRow, 'id' | 'supersedesId'> & { id: string; supersedesId: string | null })[]>`
    SELECT a.id::text AS id, a.external_id AS "externalId", a.action, a.player_id AS "playerId",
           a.player_identity AS "playerIdentity",
           a.previous_state::text AS "previousState", jsonb_typeof(a.previous_state) AS "previousStateType",
           a.evidence::text AS evidence, jsonb_typeof(a.evidence) AS "evidenceType",
           a.evidence_sha256 AS "evidenceSha256", a.surname_disagreement_acknowledged AS "surnameAck",
           a.supersedes_id::text AS "supersedesId", a.admin_user_id AS "adminUserId", u.email AS "adminEmail",
           a.note, to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt"
      FROM afl_api_identity_adjudications a
      JOIN auth_users u ON u.id = a.admin_user_id
     WHERE a.source_key = 'afl_api' AND a.external_id = ${I18_FIXTURE.providerId}
     ORDER BY a.id
  `;
  return rows.map((r) => ({
    ...r, id: Number(r.id), supersedesId: r.supersedesId === null ? null : Number(r.supersedesId),
  }));
}

async function readProviderIdentities(tx: Tx, sourceId: number): Promise<I18IdentityRow[]> {
  return tx<I18IdentityRow[]>`
    SELECT id, status::text AS status, match_method AS "matchMethod", player_id AS "playerId"
      FROM external_identities WHERE source_id = ${sourceId} AND external_id = ${I18_FIXTURE.providerId}
     ORDER BY id
  `;
}

async function readActors(tx: Tx): Promise<I18Actor[]> {
  return tx<I18Actor[]>`
    SELECT id, email, role, disabled_at IS NOT NULL AS disabled,
           password_hash IS NOT NULL AS "hasPasswordHash", totp_secret IS NOT NULL AS "hasTotpSecret"
      FROM auth_users WHERE lower(email) = ${I18_FIXTURE.actorEmail}
     ORDER BY id
  `;
}

async function readSequence(tx: Tx): Promise<I18Sequence> {
  const [s] = await tx<{ lastValue: string; isCalled: boolean }[]>`
    SELECT last_value::text AS "lastValue", is_called AS "isCalled" FROM afl_api_identity_adjudications_id_seq
  `;
  return { lastValue: Number(s.lastValue), isCalled: s.isCalled };
}

/** Everything verify compares, in ONE read-only snapshot (the replay runs in a savepoint and cannot write). */
export async function observeI18(tx: Tx, captureDir: string, baseline: I18Baseline | null): Promise<I18Observation> {
  const sourceId = await aflApiSourceId(tx);
  const [{ database }] = await tx<{ database: string }[]>`SELECT current_database() AS database`;
  const players = await resolvedPlayerIds(tx);
  const [totals] = await tx<{ ledgerTotal: number; ledgerMaxId: string | null; humanResolvedTotal: number }[]>`
    SELECT (SELECT count(*)::int FROM afl_api_identity_adjudications) AS "ledgerTotal",
           (SELECT max(id)::text FROM afl_api_identity_adjudications) AS "ledgerMaxId",
           (SELECT count(*)::int FROM external_identities
             WHERE source_id = ${sourceId} AND status = 'resolved' AND match_method = ${AFL_API_ADMIN_MATCH_METHOD}) AS "humanResolvedTotal"
  `;
  const playerProviders = players.length !== 1 ? [] : (await tx<{ externalId: string }[]>`
    SELECT external_id AS "externalId" FROM external_identities
     WHERE source_id = ${sourceId} AND player_id = ${players[0]} ORDER BY external_id
  `).map((r) => r.externalId);
  return {
    database,
    resolvedPlayerIds: players,
    ledger: await readI18Ledger(tx),
    ledgerTotal: totals.ledgerTotal,
    ledgerMaxId: totals.ledgerMaxId === null ? 0 : Number(totals.ledgerMaxId),
    providerIdentities: await readProviderIdentities(tx, sourceId),
    playerAflApiProviders: playerProviders,
    humanResolvedTotal: totals.humanResolvedTotal,
    actors: await readActors(tx),
    live: await observeLiveReinstatement(tx),
    pendingCaptureExists: existsSync(join(captureDir, PENDING_CAPTURE_FILE)),
    archivedCaptures: baseline === null ? [] : readArchivedCaptures(captureDir, database, baseline),
  };
}

/** Every archived (`….reinstated.json`) capture in the target's capture directory, proven by its own hash. */
export function readArchivedCaptures(dir: string, database: string, baseline: I18Baseline): I18ArchivedCapture[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^afl-api-adjudications\..+\.reinstated\.json$/.test(f))
    .sort()
    .map((file) => {
      const text = readFileSync(join(dir, file), 'utf8');
      const fileSha256 = createHash('sha256').update(text, 'utf8').digest('hex');
      let capture;
      try {
        capture = parseLedgerCapture(text, database);
      } catch {
        // An unrelated or altered archive is never evidence for I18; it is listed, not trusted.
        return { file, fileSha256, payloadSha256: 'unverifiable', matchesBaseline: false };
      }
      return {
        file, fileSha256, payloadSha256: capture.payloadSha256,
        matchesBaseline: captureMatchesBaseline(capture.rows, baseline),
      };
    });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();

/** `.env` without a dotenv dependency, exactly as tools/db/rebuild-test.ts reads it. */
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
  return postgres(dsn, { max: 1, onnotice: () => {}, connection: { application_name: 'afldb-issue235-i18-fixture' } });
}

function readBaseline(database: string): I18Baseline {
  const path = i18BaselinePath(REPO_ROOT, database);
  if (!existsSync(path)) throw new I18FixtureRefused(`No I18 baseline at ${relative(REPO_ROOT, path)}: run seed first.`);
  return parseI18Baseline(readFileSync(path, 'utf8'), database);
}

async function readOnly<T>(dsn: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const sql = connect(dsn);
  try {
    return await sql.begin('isolation level repeatable read read only', fn) as T;
  } finally {
    await sql.end();
  }
}

async function runSeed(dsns: I18Dsns): Promise<void> {
  const captureDir = captureDirectory(REPO_ROOT, dsns.database);
  const baselinePath = i18BaselinePath(REPO_ROOT, dsns.database);

  // 1. Preconditions, read-only. Nothing is written unless every one holds.
  const pre = await readOnly(dsns.ownerDsn, (tx) => observeSeedPreconditions(tx, {
    pendingCaptureExists: existsSync(join(captureDir, PENDING_CAPTURE_FILE)),
    baselineExists: existsSync(baselinePath),
  }));
  const problems = i18SeedPreconditionProblems(pre.observation);
  if (problems.length > 0 || pre.playerId === null) {
    throw new I18FixtureRefused(`I18 seed refused; nothing was written: ${problems.join('; ')}`);
  }
  const playerId = pre.playerId;

  // 2. The import role must really be a different role on afldb_test (unless owner was chosen).
  const importCheck = connect(dsns.importDsn);
  const ownerCheck = connect(dsns.ownerDsn);
  try {
    const [imp] = await importCheck<{ role: string; database: string }[]>`SELECT current_user AS role, current_database() AS database`;
    const [own] = await ownerCheck<{ role: string }[]>`SELECT current_user AS role`;
    if (imp.database !== dsns.database) throw new I18FixtureRefused(`The import DSN connects to '${imp.database}'.`);
    if (!dsns.importIsOwner && imp.role === own.role) {
      throw new I18FixtureRefused(`AFLDB_TEST_IMPORT_DATABASE_URL connects as the owner role '${own.role}'.`);
    }
    console.log(`    import role : ${imp.role}${dsns.importIsOwner ? ' (OWNER substituted: --allow-owner-import-dsn)' : ''}`);
  } finally {
    await importCheck.end();
    await ownerCheck.end();
  }

  // 3. Fixture setup as owner: the actor and the pending evidence a settle would have written.
  const owner = connect(dsns.ownerDsn);
  let actorId: number;
  try {
    actorId = await owner.begin(async (tx) => {
      const sourceId = await aflApiSourceId(tx);
      const [player] = await tx<{ givenName: string | null; surname: string | null }[]>`
        SELECT given_name AS "givenName", surname FROM players WHERE id = ${playerId}
      `;
      const [actor] = await tx<{ id: number }[]>`
        INSERT INTO auth_users (email, role, password_hash, totp_secret, disabled_at)
        VALUES (${I18_FIXTURE.actorEmail}, ${I18_FIXTURE.actorRole}, NULL, NULL, now())
        RETURNING id
      `;
      const [batch] = await tx<{ id: number }[]>`
        INSERT INTO import_batches (source_id, tool, status, completed_at, notes)
        VALUES (${sourceId}, ${I18_FIXTURE.tool}, 'completed', now(), ${I18_FIXTURE.tool})
        RETURNING id
      `;
      const payload = {
        teamId: I18_FIXTURE.teamId,
        playerStats: {
          player: {
            playerId: I18_FIXTURE.providerId, playerJumperNumber: 25,
            playerName: { givenName: player.givenName ?? '', surname: player.surname ?? '' },
          },
          stats: {},
        },
      };
      const payloadHash = createHash('sha256')
        .update(`player_match_stats|${I18_FIXTURE.externalRecordId}|${JSON.stringify(payload)}`).digest('hex');
      await tx`
        INSERT INTO staging.source_payloads (source_id, family, payload_hash, hash_recipe, raw_payload)
        VALUES (${sourceId}, 'player_match_stats', ${payloadHash}, ${I18_FIXTURE.hashRecipe}, ${tx.json(payload as never)})
      `;
      await tx`
        INSERT INTO staging.source_record_versions
              (source_id, family, external_record_id, version_seq, payload_hash, observed_from, opened_by_batch_id)
        VALUES (${sourceId}, 'player_match_stats', ${I18_FIXTURE.externalRecordId}, 1, ${payloadHash}, now(), ${batch.id})
      `;
      await tx`
        INSERT INTO promotion_candidates
              (source_id, family, external_record_id, source_version_seq, verb, season,
               target_table, target_id, proposed_fields, status, created_by_batch_id)
        VALUES (${sourceId}, 'player_match_stats', ${I18_FIXTURE.externalRecordId}, 1, 'unresolved_identity',
                ${I18_FIXTURE.season}, 'player_match_stats', NULL, '{}'::jsonb, 'pending', ${batch.id})
      `;
      return actor.id;
    }) as number;
  } finally {
    await owner.end();
  }

  // 4. The three adjudications, through the real query module on the import DSN. Both
  //    development variables are overwritten, never inherited from .env.
  process.env.DATABASE_URL = dsns.ownerDsn;
  process.env.AFLDB_IMPORT_DATABASE_URL = dsns.importDsn;
  const [{ linkAflApiProvider, revokeAflApiLink, readAflApiProviderEvidence }, { adjudicationFingerprint }, { sql: appSql }] =
    await Promise.all([
      import('@/db/queries/afl-api-player-links'),
      import('@/lib/acquisition/afl-api-adjudication'),
      import('@/db/client'),
    ]);
  try {
    const [{ database }] = await appSql<{ database: string }[]>`SELECT current_database() AS database`;
    if (database !== dsns.database) throw new I18FixtureRefused(`The read client connects to '${database}'.`);

    /** The fingerprints `/admin/player-links/afl-api/[providerId]` renders (page.tsx:52-69). */
    const render = async () => {
      const evidence = await readAflApiProviderEvidence(I18_FIXTURE.providerId);
      if (evidence === null) throw new I18FixtureRefused('The provider has no pending evidence to adjudicate.');
      const base = {
        providerId: I18_FIXTURE.providerId, existing: evidence.existing,
        pendingCandidates: evidence.pendingCandidates, latestAdjudicationId: evidence.latestAdjudicationId,
      };
      return {
        link: adjudicationFingerprint({ ...base, chosenPlayerId: 0, chosenPlayerExistingRows: [] }),
        revoke: evidence.existing === null ? null : adjudicationFingerprint({
          ...base, chosenPlayerId: evidence.existing.playerId ?? 0,
          chosenPlayerExistingRows: [{ id: evidence.existing.id, status: evidence.existing.status, matchMethod: evidence.existing.matchMethod }],
        }),
      };
    };
    const requireOk = (what: string, r: { ok: true } | { ok: false; error: string; code?: string }) => {
      if (!r.ok) {
        throw new I18FixtureRefused(`${what} was refused (${r.code ?? 'no code'}): ${r.error} `
          + 'The fixture is partly seeded; run teardown.');
      }
      console.log(`    ${what}: ok`);
    };
    const link = async (what: string, note: string) => requireOk(what, await linkAflApiProvider({
      providerId: I18_FIXTURE.providerId, playerId, adminUserId: actorId, note,
      surnameAcknowledged: false, fingerprint: (await render()).link,
    }));
    await link('link #1', I18_FIXTURE.notes.firstLink);
    const revokeFingerprint = (await render()).revoke;
    if (revokeFingerprint === null) throw new I18FixtureRefused('The provider has no link to revoke after link #1.');
    requireOk('revoke', await revokeAflApiLink({
      providerId: I18_FIXTURE.providerId, adminUserId: actorId, note: I18_FIXTURE.notes.revoke, fingerprint: revokeFingerprint,
    }));
    await link('link #2', I18_FIXTURE.notes.secondLink);
  } finally {
    await appSql.end({ timeout: 5 });
  }

  // 5. The baseline, read back as owner in one snapshot.
  const baseline = await readOnly(dsns.ownerDsn, async (tx) => {
    const sourceId = await aflApiSourceId(tx);
    const [identity] = await readProviderIdentities(tx, sourceId);
    const [actor] = await readActors(tx);
    const sequence = await readSequence(tx);
    return buildI18Baseline({
      database: dsns.database, seededAt: new Date().toISOString(), providerId: I18_FIXTURE.providerId,
      stableIdentity: I18_FIXTURE.stableIdentity, playerId,
      actor: { id: actor.id, email: actor.email, role: actor.role },
      ledger: await readI18Ledger(tx), identity, sequence: { ...sequence, next: nextIdentityValue(sequence) },
    });
  });
  mkdirSync(i18BaselineDirectory(REPO_ROOT), { recursive: true });
  const text = `${JSON.stringify(baseline, null, 2)}\n`;
  writeFileSync(`${baselinePath}.tmp`, text, 'utf8');
  renameSync(`${baselinePath}.tmp`, baselinePath);
  console.log(`    player      : ${baseline.stableIdentity} = player ${baseline.playerId}`);
  console.log(`    ledger      : ${baseline.ledger.map((r) => `${r.id} ${r.action}${r.supersedesId === null ? '' : ` (supersedes ${r.supersedesId})`}`).join(', ')}`);
  console.log(`    sequence    : last_value ${baseline.sequence.lastValue}, next ${baseline.sequence.next}`);
  console.log(`    baseline    : ${relative(REPO_ROOT, baselinePath)}`);
  console.log(`    file sha256 : ${createHash('sha256').update(text, 'utf8').digest('hex')}`);
  console.log(`    payload     : ${baseline.payloadSha256}`);
}

async function runVerify(dsns: I18Dsns, phase: 'pre' | 'post'): Promise<void> {
  const baseline = readBaseline(dsns.database);
  const captureDir = captureDirectory(REPO_ROOT, dsns.database);
  const observed = await readOnly(dsns.ownerDsn, (tx) => observeI18(tx, captureDir, baseline));
  const problems = i18VerifyProblems(baseline, observed, phase);
  const playerId = observed.resolvedPlayerIds[0];
  console.log(`    player      : ${baseline.stableIdentity} = player ${String(playerId)} (seeded as ${baseline.playerId}`
    + `${playerId === baseline.playerId ? ', unchanged' : ', RENUMBERED'})`);
  console.log(`    ledger      : ${observed.ledger.map((r) => `${r.id} ${r.action}`).join(', ')}; whole ledger ${observed.ledgerTotal} row(s)`);
  console.log(`    sequence    : next ${nextIdentityValue(observed.live.sequence)} > max(id) ${observed.ledgerMaxId}`);
  if (phase === 'post') {
    for (const c of observed.archivedCaptures.filter((x) => x.matchesBaseline)) {
      console.log(`    capture     : ${c.file} sha256 ${c.fileSha256} payload ${c.payloadSha256}`);
    }
  }
  if (problems.length > 0) {
    throw new I18FixtureRefused(`I18 verify --phase ${phase} FAILED (${problems.length}): ${problems.join('; ')}`);
  }
  console.log(`    I18 verify --phase ${phase}: PASS`);
}

async function runTeardown(dsns: I18Dsns): Promise<void> {
  const f = I18_FIXTURE;
  const owner = connect(dsns.ownerDsn);
  try {
    // Every statement is an exact-literal DELETE, so a rerun after a partial teardown removes only
    // what is still there and never needs the missing rows back. Each count is printed.
    const report = (what: string, n: number) => console.log(`    removed     : ${String(n).padStart(3)} ${what}`);
    // Child to parent. One ledger statement, so the revoked row and the row it supersedes go together.
    await owner.begin(async (tx) => {
      // Re-checked on the live connection before the first DELETE, not only from the DSN text.
      const [{ database }] = await tx<{ database: string }[]>`SELECT current_database() AS database`;
      if (database !== dsns.database) throw new I18FixtureRefused(`The owner DSN connects to '${database}'; nothing was deleted.`);
      const sourceId = await aflApiSourceId(tx);
      report('ledger row(s)', (await tx`
        DELETE FROM afl_api_identity_adjudications
         WHERE external_id = ${f.providerId}
            OR admin_user_id IN (SELECT id FROM auth_users WHERE lower(email) = ${f.actorEmail})
      `).count);
      report('afl_api identity row(s)',
        (await tx`DELETE FROM external_identities WHERE source_id = ${sourceId} AND external_id = ${f.providerId}`).count);
      report('canonical application(s)',
        (await tx`DELETE FROM canonical_applications WHERE external_record_id = ${f.externalRecordId}`).count);
      report('promotion candidate(s)',
        (await tx`DELETE FROM promotion_candidates WHERE external_record_id = ${f.externalRecordId}`).count);
      report('staging source record(s)', (await tx`
        DELETE FROM staging.source_records WHERE source_id = ${sourceId} AND external_record_id = ${f.externalRecordId}
      `).count);
      report('staging record version(s)', (await tx`
        DELETE FROM staging.source_record_versions WHERE source_id = ${sourceId} AND external_record_id = ${f.externalRecordId}
      `).count);
      report('staging payload(s)', (await tx`DELETE FROM staging.source_payloads WHERE hash_recipe = ${f.hashRecipe}`).count);
      report('import batch(es)', (await tx`DELETE FROM import_batches WHERE tool = ${f.tool}`).count);
    });
    // Its own transaction: if another row legitimately references the actor, the data teardown
    // above still stands and the refusal names the constraint.
    const actors = await owner.begin((tx) => tx`DELETE FROM auth_users WHERE lower(email) = ${f.actorEmail}`);
    report('fixture actor(s)', actors.count);
  } finally {
    await owner.end();
  }

  // Proof: zero I18 rows, and the shared ISSUE-235 leftover gate (which owns the I18 literals) at
  // zero. The gate module is server-neutral: this CLI runs under plain `tsx`, where anything that
  // reaches `server-only` (`@/db/*`) throws — so never import the seeding fixtures module here.
  const { issue235FixtureResidue, loadS6Refs, ZERO_ISSUE235_RESIDUE } =
    await import('../../tests/integration/afl-api-fixture-ownership');
  const { i18Rows, residue } = await readOnly(dsns.ownerDsn, async (tx) => {
    const refs = await loadS6Refs(tx);
    return { i18Rows: await countFixtureRows(tx, refs.aflApiSourceId), residue: await issue235FixtureResidue(tx, refs) };
  });
  console.log(`    I18 rows    : ${i18Rows}`);
  console.log(`    residue     : ${JSON.stringify(residue)}`);
  if (i18Rows !== 0 || JSON.stringify(residue) !== JSON.stringify(ZERO_ISSUE235_RESIDUE)) {
    throw new I18FixtureRefused('I18 teardown left residue.');
  }

  const baselinePath = i18BaselinePath(REPO_ROOT, dsns.database);
  if (existsSync(baselinePath)) {
    const archived = baselinePath.replace(/\.baseline\.json$/, `.baseline.${new Date().toISOString().replace(/[-:.]/g, '')}.torn-down.json`);
    renameSync(baselinePath, archived);
    console.log(`    baseline    : archived as ${relative(REPO_ROOT, archived)}`);
  }
  console.log('    I18 teardown: PASS');
}

async function main(argv: string[]): Promise<void> {
  const command = parseI18Args(argv);
  loadDotEnv();
  const dsns = resolveI18Dsns(process.env, {
    // Only seed writes through the import DSN; verify and teardown are owner-only.
    allowOwnerImportDsn: command.step === 'seed' ? command.allowOwnerImportDsn : true,
  });
  if (!AFL_API_PROVIDER_ID_RE.test(I18_FIXTURE.providerId)) throw new I18FixtureRefused('I18 provider id is malformed.');
  console.log(`AFLDB-ISSUE-235 I18 fixture — ${command.step}${command.step === 'verify' ? ` --phase ${command.phase}` : ''} on ${dsns.database}`);
  if (command.step === 'seed') return runSeed(dsns);
  if (command.step === 'verify') return runVerify(dsns, command.phase);
  return runTeardown(dsns);
}

if (process.argv[1] && /afl_api_adjudication_i18_fixture\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`    REFUSED: ${redact((error as Error).message)}`);
      process.exit(1);
    });
}
