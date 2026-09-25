/**
 * AFLDB-ISSUE-237 L1/L2 (runbook §11, §11b) — the tracked fixture for the destructive
 * `db:test:rebuild --target code_test_db` rehearsals. Seed, verify and teardown are explicit
 * operator steps AROUND the rebuild; the rebuild itself never creates, reads or removes it.
 *
 *     npm run db:code-test:issue237-rehearsal -- seed [--allow-owner-import-dsn]
 *     npm run db:code-test:issue237-rehearsal -- verify --phase pre
 *     npm run db:code-test:issue237-rehearsal -- verify --phase post
 *     npm run db:code-test:issue237-rehearsal -- teardown
 *     npm run db:code-test:issue237-rehearsal -- residue
 *
 * (`--conditions=react-server` is in the package script: `seed` calls the real `server-only`
 * ISSUE-235 query module. `verify`, `teardown` and `residue` never load it.)
 *
 * WHAT IT PROVES. Two DISJOINT `afl_api` identities on two REAL baseline players the rebuild
 * recreates from tracked sources:
 *
 *   importer  one D5-compliant importer-created row (`unique`, candidate_count 1, external_url
 *             NULL, an approved importer `match_method`), written as the importer writes it;
 *   human     one ISSUE-235 adjudication (`linked`), made through `linkAflApiProvider()` — the
 *             mutation the admin surface calls — so the ledger row and its `resolved` identity
 *             are written atomically by the real path.
 *
 * `verify --phase post` proves both came back through ONE combined capture: the importer
 * provider on the player its stable identity names NOW (whatever `players.id` that is), with
 * the exact `match_method`; the ledger row under its original id with its durable fields; the
 * D15 bijection; zero supersedes; the D5/D7/D13 standalone invariant; no rebuild marker; no
 * pending capture; an archived capture carrying both sections.
 *
 * E_rebuild = ∅ BY CONSTRUCTION. The two providers differ and the two players differ, and seed
 * refuses unless the database holds NO other `afl_api` row and NO ledger row. No provider can
 * therefore be both an importer row and a net-LINKED ledger decision (OD-6).
 *
 * IDENTITY. Players are chosen by their accepted AFL Tables profile identity only
 * (`resolveAflApiPlayerIdentity`, the D15 rule), never by a name and never by a numeric id. No
 * `players.id` is stored anywhere by this tool: every step re-resolves the identity in its own
 * snapshot. Seed fails closed if an identity resolves to zero or several players, or if its
 * player's forward identity is not exactly that one AFL Tables path (D7).
 *
 * NAMESPACE. Provider ids `CD_I999237` + 4 digits (14 characters): outside every real Champion
 * Data id (CD_I + 6–7 digits), outside S6's `CD_I999235xxxx` and I18's `CD_I9991800001`. The
 * DB-free suite proves the prefix is absent from every tracked data file. Teardown deletes only
 * the exact literals below; the residue gate counts the whole namespace.
 *
 * TARGET. `code_test_db` ONLY, through `AFLDB_CODE_TEST_DATABASE_URL` (owner) and
 * `AFLDB_CODE_TEST_IMPORT_DATABASE_URL` (the restricted import role). No other variable names a
 * target here, and the target is never inferred: the DSN must NAME `code_test_db`. The
 * development `DATABASE_URL`/`AFLDB_IMPORT_DATABASE_URL`/`AFLDB_AUTH_DATABASE_URL` are OVERWRITTEN
 * in this process before the query module loads, and every client's connected database is
 * re-checked. No DSN is printed.
 *
 * EVIDENCE. `seed` writes a baseline (the ledger row's durable fields; no surrogate id, no
 * credential) under the shared capture root, `<AFLDB_REBUILD_CAPTURE_ROOT>/issue-237-rehearsal/`,
 * so a recovery run from another checkout still verifies against it.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import postgres, { type TransactionSql } from 'postgres';

import {
  AFL_API_ADMIN_MATCH_METHOD,
  AFL_API_PROVIDER_ID_RE,
  isAflApiImporterMatchMethod,
  type AflApiForwardIdentityResult,
} from '../../src/lib/acquisition/afl-api-adjudication';
import { assertRebuildTargetName, databaseOf, resolveCaptureRoot } from '../db/rebuild-test';
import { redact } from '../db/psql';
import {
  captureDirectory,
  observeLiveReinstatement,
  parseCombinedCapture,
  PENDING_CAPTURE_FILE,
  readRebuildMarker,
  type LiveReinstatementObservation,
} from './rebuild_afl_api_adjudications';
import {
  assertAflApiIdentityInvariant,
  readAflApiForwardIdentities,
  resolveAflApiPlayerIdentity,
} from './replay_afl_api_adjudications';

export class RehearsalFixtureRefused extends Error {}

// ---------------------------------------------------------------------------
// Ownership: exact literals, plus the one namespace the residue gate counts.
// ---------------------------------------------------------------------------

/** The ISSUE-237-owned provider namespace. Anchored; never a bare `CD_I999%` prefix, which real ids share. */
export const REHEARSAL_PROVIDER_NAMESPACE = '^CD_I999237[0-9]{4}$';
export const REHEARSAL_PROVIDER_NAMESPACE_RE = new RegExp(REHEARSAL_PROVIDER_NAMESPACE);

export const REHEARSAL_FIXTURE = {
  database: 'code_test_db',
  importer: {
    providerId: 'CD_I9992370001',
    /** An accepted AFL Tables profile identity (a tracked father–son resolution; debut 1970). */
    stableIdentity: 'players/B/Barry_Mulcair.html',
    matchMethod: 'afl_api_stat_vector_bootstrap',
    externalName: 'AFLDB-ISSUE-237 rehearsal importer fixture',
    notes: 'AFLDB-ISSUE-237 L1/L2 rehearsal fixture: synthetic importer-created unique row.',
  },
  human: {
    providerId: 'CD_I9992370002',
    /** An accepted AFL Tables profile identity (a tracked father–son resolution; debut 1970). */
    stableIdentity: 'players/G/Graeme_Shephard.html',
    /** The spine record the pending evidence hangs off: `<match>|<team>|<provider>`. */
    matchId: 'CD_M9992370002',
    teamId: 'CD_T20',
    externalRecordId: 'CD_M9992370002|CD_T20|CD_I9992370002',
    note: 'AFLDB-ISSUE-237 L1/L2 rehearsal fixture: human link of a synthetic provider.',
  },
  actorEmail: 'issue237-rehearsal-fixture@example.test',
  actorRole: 'super_admin',
  tool: 'issue237-rehearsal-fixture',
  hashRecipe: 'issue237-rehearsal-fixture:sha256',
  season: 2026,
} as const;

export const REHEARSAL_BASELINE_FORMAT = 'afldb.issue237.rehearsal_fixture_baseline';
export const REHEARSAL_BASELINE_VERSION = 1;

/** Under the SHARED capture root (D11a), beside — never inside — the capture stage's own directory. */
export function rehearsalBaselinePath(captureRoot: string, database: string): string {
  return join(captureRoot, 'issue-237-rehearsal', `${database}.baseline.json`);
}

// ---------------------------------------------------------------------------
// Arguments and DSNs
// ---------------------------------------------------------------------------

export type RehearsalCommand =
  | { step: 'seed'; allowOwnerImportDsn: boolean }
  | { step: 'verify'; phase: 'pre' | 'post' }
  | { step: 'teardown' }
  | { step: 'residue' };

export function parseRehearsalArgs(argv: readonly string[]): RehearsalCommand {
  const [step, ...rest] = argv;
  if (step === 'seed') {
    const unknown = rest.filter((a) => a !== '--allow-owner-import-dsn');
    if (unknown.length > 0) throw new RehearsalFixtureRefused(`Unexpected argument(s) for seed: ${unknown.join(' ')}`);
    return { step, allowOwnerImportDsn: rest.includes('--allow-owner-import-dsn') };
  }
  if (step === 'verify') {
    if (rest.length !== 2 || rest[0] !== '--phase' || (rest[1] !== 'pre' && rest[1] !== 'post')) {
      throw new RehearsalFixtureRefused('verify needs exactly --phase pre or --phase post.');
    }
    return { step, phase: rest[1] };
  }
  if (step === 'teardown' || step === 'residue') {
    if (rest.length > 0) throw new RehearsalFixtureRefused(`Unexpected argument(s) for ${step}: ${rest.join(' ')}`);
    return { step };
  }
  throw new RehearsalFixtureRefused(
    `Unknown step '${String(step)}': seed, verify --phase pre|post, teardown, or residue.`);
}

export const REHEARSAL_OWNER_ENV = 'AFLDB_CODE_TEST_DATABASE_URL';
export const REHEARSAL_IMPORT_ENV = 'AFLDB_CODE_TEST_IMPORT_DATABASE_URL';

export type RehearsalDsns = { database: string; ownerDsn: string; importDsn: string; importIsOwner: boolean };

/**
 * Only the two code_test_db variables are read. The owner DSN must pass the rebuild's own name
 * guard AND name `code_test_db` exactly (so `afldb_test`, `afldb_dev` and anything
 * production-like are refused); the import DSN must name the same database.
 */
export function resolveRehearsalDsns(
  env: Record<string, string | undefined>, opts: { allowOwnerImportDsn: boolean },
): RehearsalDsns {
  const ownerDsn = env[REHEARSAL_OWNER_ENV];
  if (!ownerDsn) throw new RehearsalFixtureRefused(`${REHEARSAL_OWNER_ENV} is not set.`);
  let database: string;
  try {
    database = databaseOf(ownerDsn);
  } catch {
    throw new RehearsalFixtureRefused(`${REHEARSAL_OWNER_ENV} is not a valid connection URL.`);
  }
  assertRebuildTargetName(database);
  if (database !== REHEARSAL_FIXTURE.database) {
    throw new RehearsalFixtureRefused(
      `${REHEARSAL_OWNER_ENV} names '${database}'. The ISSUE-237 rehearsal fixture runs on `
      + `'${REHEARSAL_FIXTURE.database}' only.`);
  }
  const restricted = env[REHEARSAL_IMPORT_ENV];
  if (restricted) {
    let importDatabase: string;
    try {
      importDatabase = databaseOf(restricted);
    } catch {
      throw new RehearsalFixtureRefused(`${REHEARSAL_IMPORT_ENV} is not a valid connection URL.`);
    }
    if (importDatabase !== database) {
      throw new RehearsalFixtureRefused(`${REHEARSAL_IMPORT_ENV} names '${importDatabase}', not '${database}'.`);
    }
    return { database, ownerDsn, importDsn: restricted, importIsOwner: false };
  }
  if (opts.allowOwnerImportDsn) return { database, ownerDsn, importDsn: ownerDsn, importIsOwner: true };
  throw new RehearsalFixtureRefused(
    `${REHEARSAL_IMPORT_ENV} is not set. Set it to the afldb_import DSN for code_test_db, or pass `
    + '--allow-owner-import-dsn to seed as owner deliberately.');
}

// ---------------------------------------------------------------------------
// Seed preconditions (pure)
// ---------------------------------------------------------------------------

export type RehearsalSeedObservation = {
  database: string;
  /** Distinct players each stable identity resolves to under the D15 rule. */
  importerResolvedPlayerIds: readonly number[];
  humanResolvedPlayerIds: readonly number[];
  /** The D7 forward identity of the uniquely-resolved player; null when not uniquely resolved. */
  importerForward: AflApiForwardIdentityResult | null;
  humanForward: AflApiForwardIdentityResult | null;
  /** Every `afl_api` identity row and ledger row on the database. Both must be 0. */
  aflApiRows: number;
  ledgerRows: number;
  /** The residue gate's total (the whole namespace, the pending evidence, the batch, the actor). */
  fixtureResidue: number;
  markerPresent: boolean;
  pendingCaptureExists: boolean;
  baselineExists: boolean;
};

function forwardProblem(label: string, identity: string, fwd: AflApiForwardIdentityResult | null): string | null {
  if (fwd === null) return null; // reported by the resolution check
  if (!fwd.ok) return `D7: the ${label} player's forward identity is ${fwd.reason}, not exactly afltables:${identity}`;
  if (fwd.via !== 'afltables' || fwd.identity !== identity) {
    return `D7: the ${label} player's forward identity is ${fwd.via}:${fwd.identity}, not afltables:${identity}`;
  }
  return null;
}

/** Every reason NOT to seed. Fail closed: another player is never chosen silently. */
export function rehearsalSeedPreconditionProblems(o: RehearsalSeedObservation): string[] {
  const f = REHEARSAL_FIXTURE;
  const problems: string[] = [];
  if (o.database !== f.database) problems.push(`connected to '${o.database}', not '${f.database}'`);
  for (const [label, identity, ids] of [
    ['importer', f.importer.stableIdentity, o.importerResolvedPlayerIds],
    ['human', f.human.stableIdentity, o.humanResolvedPlayerIds],
  ] as const) {
    if (ids.length !== 1) problems.push(`'${identity}' (${label}) resolves to ${ids.length} players, not exactly one`);
  }
  if (o.importerResolvedPlayerIds.length === 1 && o.humanResolvedPlayerIds.length === 1
      && o.importerResolvedPlayerIds[0] === o.humanResolvedPlayerIds[0]) {
    problems.push('the importer and human stable identities resolve to the same player');
  }
  for (const p of [forwardProblem('importer', f.importer.stableIdentity, o.importerForward),
    forwardProblem('human', f.human.stableIdentity, o.humanForward)]) {
    if (p) problems.push(p);
  }
  if (o.aflApiRows !== 0) {
    problems.push(`${o.aflApiRows} afl_api identity row(s) already exist; the rehearsal needs a database with none `
      + '(exact post-rebuild counts, and E_rebuild = ∅ by construction)');
  }
  if (o.ledgerRows !== 0) problems.push(`the adjudication ledger is not empty (${o.ledgerRows} row(s))`);
  if (o.fixtureResidue !== 0) problems.push(`${o.fixtureResidue} rehearsal fixture row(s) already exist: run teardown first`);
  if (o.markerPresent) problems.push('a rebuild marker is present: an earlier rebuild did not finish (recover it first)');
  if (o.pendingCaptureExists) problems.push(`a pending rebuild capture (${PENDING_CAPTURE_FILE}) exists: an earlier rebuild did not finish`);
  if (o.baselineExists) problems.push('a rehearsal baseline already exists: run teardown (which archives it) first');
  return problems;
}

// ---------------------------------------------------------------------------
// The baseline (pure) — durable fields only, never a surrogate id
// ---------------------------------------------------------------------------

export type RehearsalLedgerRow = {
  id: number;
  externalId: string;
  action: 'linked' | 'revoked';
  playerIdentity: string;
  evidenceSha256: string;
  supersedesId: number | null;
  adminEmail: string;
  note: string;
  /** UTC microseconds, the precision the reinstatement round-trips. */
  createdAt: string;
};

export type RehearsalBaseline = {
  format: typeof REHEARSAL_BASELINE_FORMAT;
  version: typeof REHEARSAL_BASELINE_VERSION;
  database: string;
  seededAt: string;
  importer: { externalId: string; playerIdentity: string; matchMethod: string; externalName: string; notes: string };
  human: { externalId: string; playerIdentity: string };
  ledger: RehearsalLedgerRow[];
  payloadSha256: string;
};

function durableLedgerTuple(r: RehearsalLedgerRow): unknown[] {
  return [r.id, r.externalId, r.action, r.playerIdentity, r.evidenceSha256, r.supersedesId,
    r.adminEmail.toLowerCase(), r.note, r.createdAt];
}

export function rehearsalBaselineSha256(b: Omit<RehearsalBaseline, 'payloadSha256'>): string {
  const canonical = JSON.stringify([b.format, b.version, b.database, b.seededAt,
    [b.importer.externalId, b.importer.playerIdentity, b.importer.matchMethod, b.importer.externalName, b.importer.notes],
    [b.human.externalId, b.human.playerIdentity], b.ledger.map(durableLedgerTuple)]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** The one-row history seed must have produced: a single `linked` row for the human provider. */
export function rehearsalLedgerShapeProblems(rows: readonly RehearsalLedgerRow[]): string[] {
  const f = REHEARSAL_FIXTURE;
  if (rows.length !== 1) return [`the ledger holds ${rows.length} row(s), expected exactly 1`];
  const [r] = rows;
  const problems: string[] = [];
  if (r.externalId !== f.human.providerId) problems.push(`the ledger row names ${r.externalId}, not ${f.human.providerId}`);
  if (r.action !== 'linked') problems.push(`the ledger row is '${r.action}', not 'linked'`);
  if (r.supersedesId !== null) problems.push('the ledger row supersedes another row');
  if (r.playerIdentity !== f.human.stableIdentity) {
    problems.push(`the ledger row's player_identity is '${r.playerIdentity}', not '${f.human.stableIdentity}'`);
  }
  if (r.adminEmail.toLowerCase() !== f.actorEmail) problems.push('the ledger row is not attributed to the fixture actor');
  if (r.note !== f.human.note) problems.push('the ledger row note is not the fixture note');
  return problems;
}

export function buildRehearsalBaseline(input: { database: string; seededAt: string; ledger: RehearsalLedgerRow[] }): RehearsalBaseline {
  const problems = rehearsalLedgerShapeProblems(input.ledger);
  if (problems.length > 0) throw new RehearsalFixtureRefused(`The seeded ledger is not the fixture shape: ${problems.join('; ')}`);
  const f = REHEARSAL_FIXTURE;
  const body: Omit<RehearsalBaseline, 'payloadSha256'> = {
    format: REHEARSAL_BASELINE_FORMAT, version: REHEARSAL_BASELINE_VERSION,
    database: input.database, seededAt: input.seededAt,
    importer: {
      externalId: f.importer.providerId, playerIdentity: f.importer.stableIdentity,
      matchMethod: f.importer.matchMethod, externalName: f.importer.externalName, notes: f.importer.notes,
    },
    human: { externalId: f.human.providerId, playerIdentity: f.human.stableIdentity },
    ledger: input.ledger.map((r) => ({ ...r })),
  };
  return { ...body, payloadSha256: rehearsalBaselineSha256(body) };
}

export function parseRehearsalBaseline(text: string, expectedDatabase: string): RehearsalBaseline {
  let raw: RehearsalBaseline;
  try {
    raw = JSON.parse(text) as RehearsalBaseline;
  } catch {
    throw new RehearsalFixtureRefused('The rehearsal baseline is not valid JSON.');
  }
  if (raw.format !== REHEARSAL_BASELINE_FORMAT || raw.version !== REHEARSAL_BASELINE_VERSION) {
    throw new RehearsalFixtureRefused('The rehearsal baseline has an unknown format or version.');
  }
  if (raw.database !== expectedDatabase) {
    throw new RehearsalFixtureRefused(`The rehearsal baseline is for '${String(raw.database)}', not '${expectedDatabase}'.`);
  }
  const rebuilt = buildRehearsalBaseline({ database: raw.database, seededAt: raw.seededAt, ledger: raw.ledger });
  if (JSON.stringify(rebuilt.importer) !== JSON.stringify(raw.importer)
      || JSON.stringify(rebuilt.human) !== JSON.stringify(raw.human)
      || rebuilt.payloadSha256 !== raw.payloadSha256) {
    throw new RehearsalFixtureRefused('The rehearsal baseline does not match its own payload hash or the fixture constants.');
  }
  return rebuilt;
}

// ---------------------------------------------------------------------------
// Verification (pure)
// ---------------------------------------------------------------------------

export type RehearsalAflApiRow = {
  externalId: string; status: string; matchMethod: string | null; playerId: number | null;
  candidateCount: number; externalUrl: string | null; externalName: string | null; notes: string | null;
};
export type RehearsalActor = { email: string; role: string; disabled: boolean; hasPasswordHash: boolean; hasTotpSecret: boolean };
export type RehearsalArchivedCapture = {
  file: string; fileSha256: string; payloadSha256: string;
  /** True only when the file parses, proves its own hash, and carries BOTH fixture sections exactly. */
  carriesFixture: boolean;
  /** The captured database's importer surrogate: audit only, printed, never trusted. */
  importerPlayerIdAtCapture: number | null;
};

export type RehearsalObservation = {
  database: string;
  markerPresent: boolean;
  pendingCaptureExists: boolean;
  importerResolvedPlayerIds: readonly number[];
  humanResolvedPlayerIds: readonly number[];
  importerForward: AflApiForwardIdentityResult | null;
  humanForward: AflApiForwardIdentityResult | null;
  /** EVERY `afl_api` identity row on the database. */
  aflApiRows: readonly RehearsalAflApiRow[];
  /** The WHOLE ledger, with each row's live `player_id`. */
  ledger: readonly (RehearsalLedgerRow & { playerId: number })[];
  actors: readonly RehearsalActor[];
  /** `assertAflApiIdentityInvariant()`: D5 census, D15 bijection, one row per player, D7. */
  invariant: 'ok' | { error: string };
  /** Both replays and the bijection, run read-only against the expected importer rows. */
  live: LiveReinstatementObservation;
  archivedCaptures: readonly RehearsalArchivedCapture[];
};

/**
 * Every way the database differs from the fixture contract. Both phases demand the exact fixture
 * state; `post` additionally demands an archived combined capture carrying both sections. No
 * check compares a `players.id` with a stored one: each is compared with the player the stable
 * identity resolves to in the SAME snapshot, so a renumbered player passes and a retargeted
 * row fails.
 */
export function rehearsalVerifyProblems(
  baseline: RehearsalBaseline, o: RehearsalObservation, phase: 'pre' | 'post',
): string[] {
  const f = REHEARSAL_FIXTURE;
  const p: string[] = [];
  if (o.database !== f.database) p.push(`connected to '${o.database}', not '${f.database}'`);
  if (o.markerPresent) {
    p.push(phase === 'post'
      ? 'a rebuild marker is still present (Stage 18 did not clear it)'
      : 'a rebuild marker is present (a rebuild is in flight)');
  }
  if (o.pendingCaptureExists) p.push(`a pending rebuild capture (${PENDING_CAPTURE_FILE}) exists`);

  const unique = (label: string, identity: string, ids: readonly number[]): number | null => {
    if (ids.length === 1) return ids[0];
    p.push(`'${identity}' (${label}) resolves to ${ids.length} players, not exactly one`);
    return null;
  };
  const importerPlayer = unique('importer', f.importer.stableIdentity, o.importerResolvedPlayerIds);
  const humanPlayer = unique('human', f.human.stableIdentity, o.humanResolvedPlayerIds);
  if (importerPlayer !== null && importerPlayer === humanPlayer) p.push('the two fixture identities resolve to the same player');
  for (const x of [forwardProblem('importer', f.importer.stableIdentity, o.importerForward),
    forwardProblem('human', f.human.stableIdentity, o.humanForward)]) {
    if (x) p.push(x);
  }

  // Exactly the two fixture rows (D5 census: one importer, one human; nothing else).
  const foreign = o.aflApiRows.filter((r) => r.externalId !== f.importer.providerId && r.externalId !== f.human.providerId);
  if (foreign.length > 0) {
    p.push(`${foreign.length} non-fixture afl_api row(s) exist: ${foreign.slice(0, 5).map((r) => r.externalId).join(', ')}`);
  }
  const rowsFor = (id: string) => o.aflApiRows.filter((r) => r.externalId === id);
  const importerRows = rowsFor(f.importer.providerId);
  if (importerRows.length !== 1) {
    p.push(`the importer provider ${f.importer.providerId} has ${importerRows.length} afl_api row(s), expected 1`);
  } else {
    const r = importerRows[0];
    if (r.status !== 'unique') p.push(`the importer row's status is '${r.status}', not 'unique' (superseded or rewritten)`);
    if (r.matchMethod !== f.importer.matchMethod) {
      p.push(`the importer row's match_method is '${String(r.matchMethod)}', not exactly '${f.importer.matchMethod}'`);
    }
    if (!isAflApiImporterMatchMethod(r.matchMethod)) p.push('D5: the importer row does not carry an approved importer match_method');
    if (r.candidateCount !== 1) p.push(`D5: the importer row's candidate_count is ${r.candidateCount}, not 1`);
    if (r.externalUrl !== null) p.push('D5: the importer row\'s external_url is not NULL');
    if (r.externalName !== f.importer.externalName) p.push('the importer row\'s external_name was not carried exactly');
    if (r.notes !== f.importer.notes) p.push('the importer row\'s notes were not carried exactly');
    if (importerPlayer !== null && r.playerId !== importerPlayer) {
      p.push(`the importer row names player ${String(r.playerId)}, but '${f.importer.stableIdentity}' is player `
        + `${importerPlayer} (retargeted)`);
    }
  }
  const humanRows = rowsFor(f.human.providerId);
  if (humanRows.length !== 1) {
    p.push(`the human provider ${f.human.providerId} has ${humanRows.length} afl_api row(s), expected 1`);
  } else {
    const r = humanRows[0];
    if (r.status !== 'resolved' || r.matchMethod !== AFL_API_ADMIN_MATCH_METHOD) {
      p.push(`the human row is ${r.status}/${String(r.matchMethod)}, not resolved/${AFL_API_ADMIN_MATCH_METHOD}`);
    }
    if (humanPlayer !== null && r.playerId !== humanPlayer) {
      p.push(`the human row names player ${String(r.playerId)}, but '${f.human.stableIdentity}' is player ${humanPlayer}`);
    }
  }

  // The ledger: exactly the baseline's rows, durable fields byte for byte, player re-derived.
  if (o.ledger.length !== baseline.ledger.length) {
    p.push(`the whole ledger holds ${o.ledger.length} row(s), the baseline ${baseline.ledger.length}`);
  } else {
    o.ledger.forEach((r, i) => {
      if (JSON.stringify(durableLedgerTuple(r)) !== JSON.stringify(durableLedgerTuple(baseline.ledger[i]))) {
        p.push(`ledger row ${r.id}: a durable field differs from the baseline (${DURABLE_LEDGER_FIELDS.join(', ')})`);
      }
      if (humanPlayer !== null && r.playerId !== humanPlayer) {
        p.push(`ledger row ${r.id}: player_id ${r.playerId} is not the player its identity names now (${humanPlayer})`);
      }
    });
  }
  if (o.ledger.some((r) => r.externalId === f.importer.providerId)) {
    p.push('E_rebuild: a ledger row names the importer provider');
  }

  if (o.invariant !== 'ok') p.push(`D5/D7/D13 standalone invariant failed: ${o.invariant.error}`);
  if ('error' in o.live.replay) {
    p.push(`the read-only D15 replay could not complete: ${o.live.replay.error}`);
  } else {
    if (o.live.replay.inserted !== 0) p.push(`a D15 replay would still insert ${o.live.replay.inserted} row(s)`);
    if (o.live.replay.stops.length !== 0) p.push(`the D15 replay stops on ${o.live.replay.stops.map((s) => s.externalId).join(', ')}`);
    if (o.live.replay.supersedes.length !== 0) {
      p.push(`the D15 replay supersedes ${o.live.replay.supersedes.length} row(s); expected none (E_rebuild = ∅)`);
    }
  }
  if ('error' in o.live.importerReplay) {
    p.push(`the read-only importer replay could not complete: ${o.live.importerReplay.error}`);
  } else if (o.live.importerReplay.inserted !== 0) {
    p.push(`an importer replay would still insert ${o.live.importerReplay.inserted} row(s)`);
  }
  if (o.live.bijection !== 'ok') p.push(`the D15 bijection does not hold: ${o.live.bijection.error}`);

  if (o.actors.length !== 1) {
    p.push(`${o.actors.length} fixture actor row(s), expected 1`);
  } else {
    const a = o.actors[0];
    if (a.role !== f.actorRole) p.push(`the fixture actor's role is '${a.role}', not '${f.actorRole}'`);
    if (!a.disabled || a.hasPasswordHash || a.hasTotpSecret) p.push('the fixture actor is not attribution-only (disabled, no credentials)');
  }

  const carrying = o.archivedCaptures.filter((c) => c.carriesFixture);
  if (phase === 'post' && carrying.length === 0) {
    p.push('no archived combined capture carries both fixture sections (importer row AND ledger row)');
  }
  if (phase === 'pre' && carrying.length > 0) {
    p.push('an archived capture already carries this seed: a rebuild has run since seed; use --phase post');
  }
  return p;
}

const DURABLE_LEDGER_FIELDS = ['id', 'external_id', 'action', 'player_identity', 'evidence_sha256', 'supersedes_id',
  'actor email', 'note', 'created_at'];

/** True when a parsed combined capture carries exactly the fixture's two sections. */
export function captureCarriesFixture(
  capture: { importerRows: readonly { externalId: string; playerIdentity: string; matchMethod: string; status: string;
    candidateCount: number; externalName: string | null; externalUrl: string | null; notes: string | null }[];
  ledgerRows: readonly { id: number; externalId: string; action: string; playerIdentity: string; evidenceSha256: string;
    supersedesId: number | null; adminEmail: string; note: string; createdAt: string }[] },
  baseline: RehearsalBaseline,
): boolean {
  const i = baseline.importer;
  const importerOk = capture.importerRows.length === 1 && capture.importerRows.every((r) =>
    r.externalId === i.externalId && r.playerIdentity === i.playerIdentity && r.matchMethod === i.matchMethod
    && r.status === 'unique' && r.candidateCount === 1 && r.externalUrl === null
    && r.externalName === i.externalName && r.notes === i.notes);
  const ledgerOk = capture.ledgerRows.length === baseline.ledger.length
    && capture.ledgerRows.every((r, n) =>
      JSON.stringify(durableLedgerTuple(r as RehearsalLedgerRow)) === JSON.stringify(durableLedgerTuple(baseline.ledger[n])));
  return importerOk && ledgerOk;
}

// ---------------------------------------------------------------------------
// Database reads
// ---------------------------------------------------------------------------

type Tx = TransactionSql;

async function aflApiSourceId(tx: Tx): Promise<number> {
  const [row] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
  if (!row) throw new RehearsalFixtureRefused("sources.key = 'afl_api' is missing (migration 077).");
  return row.id;
}

async function currentDatabase(tx: Tx): Promise<string> {
  const [{ database }] = await tx<{ database: string }[]>`SELECT current_database() AS database`;
  return database;
}

/** Distinct players an identity names. Ambiguity is reported by count, never resolved by picking one. */
async function resolvedPlayerIds(tx: Tx, stableIdentity: string): Promise<number[]> {
  const result = await resolveAflApiPlayerIdentity(tx, stableIdentity);
  if (result.ok) return [result.newPlayerId];
  if (result.reason === 'unresolvable') return [];
  const rows = await tx<{ playerId: number }[]>`
    SELECT DISTINCT ei.player_id AS "playerId"
      FROM external_identities ei JOIN sources s ON s.id = ei.source_id
     WHERE ((s.key = 'afltables' AND ei.match_method = 'afltables_profile_url')
            OR (s.key = 'manual_admin_edit' AND ei.match_method = 'manual_admin_edit'))
       AND ei.status IN ('unique', 'resolved') AND ei.external_id = ${stableIdentity}
  `;
  return rows.map((r) => r.playerId);
}

async function forwardOf(tx: Tx, ids: readonly number[]): Promise<AflApiForwardIdentityResult | null> {
  if (ids.length !== 1) return null;
  return (await readAflApiForwardIdentities(tx, ids)).get(ids[0]) ?? { ok: false, reason: 'no_identity' };
}

export type RehearsalResidue = {
  aflApiIdentities: number; ledgerRows: number; canonicalApplications: number; promotionCandidates: number;
  stagingRecords: number; stagingVersions: number; stagingPayloads: number; importBatches: number; actors: number;
};
export const ZERO_REHEARSAL_RESIDUE: RehearsalResidue = {
  aflApiIdentities: 0, ledgerRows: 0, canonicalApplications: 0, promotionCandidates: 0,
  stagingRecords: 0, stagingVersions: 0, stagingPayloads: 0, importBatches: 0, actors: 0,
};

/** The leftover gate: the WHOLE provider namespace, plus every non-identity row seed writes. */
export async function readRehearsalResidue(tx: Tx): Promise<RehearsalResidue> {
  const f = REHEARSAL_FIXTURE;
  const [row] = await tx<RehearsalResidue[]>`
    SELECT
      (SELECT count(*)::int FROM external_identities ei JOIN sources s ON s.id = ei.source_id
        WHERE s.key = 'afl_api' AND ei.external_id ~ ${REHEARSAL_PROVIDER_NAMESPACE}) AS "aflApiIdentities",
      (SELECT count(*)::int FROM afl_api_identity_adjudications
        WHERE external_id ~ ${REHEARSAL_PROVIDER_NAMESPACE}
           OR admin_user_id IN (SELECT id FROM auth_users WHERE lower(email) = ${f.actorEmail})) AS "ledgerRows",
      (SELECT count(*)::int FROM canonical_applications
        WHERE split_part(external_record_id, '|', 3) ~ ${REHEARSAL_PROVIDER_NAMESPACE}) AS "canonicalApplications",
      (SELECT count(*)::int FROM promotion_candidates
        WHERE split_part(external_record_id, '|', 3) ~ ${REHEARSAL_PROVIDER_NAMESPACE}) AS "promotionCandidates",
      (SELECT count(*)::int FROM staging.source_records
        WHERE split_part(external_record_id, '|', 3) ~ ${REHEARSAL_PROVIDER_NAMESPACE}) AS "stagingRecords",
      (SELECT count(*)::int FROM staging.source_record_versions
        WHERE split_part(external_record_id, '|', 3) ~ ${REHEARSAL_PROVIDER_NAMESPACE}) AS "stagingVersions",
      (SELECT count(*)::int FROM staging.source_payloads WHERE hash_recipe = ${f.hashRecipe}) AS "stagingPayloads",
      (SELECT count(*)::int FROM import_batches WHERE tool = ${f.tool}) AS "importBatches",
      (SELECT count(*)::int FROM auth_users WHERE lower(email) = ${f.actorEmail}) AS "actors"
  `;
  return row;
}

export function residueTotal(r: RehearsalResidue): number {
  return Object.values(r).reduce((sum, n) => sum + n, 0);
}

async function observeSeed(
  tx: Tx, files: { pendingCaptureExists: boolean; baselineExists: boolean },
): Promise<RehearsalSeedObservation> {
  const f = REHEARSAL_FIXTURE;
  const database = await currentDatabase(tx);
  const sourceId = await aflApiSourceId(tx);
  const importerIds = await resolvedPlayerIds(tx, f.importer.stableIdentity);
  const humanIds = await resolvedPlayerIds(tx, f.human.stableIdentity);
  const [counts] = await tx<{ aflApiRows: number; ledgerRows: number }[]>`
    SELECT (SELECT count(*)::int FROM external_identities WHERE source_id = ${sourceId}) AS "aflApiRows",
           (SELECT count(*)::int FROM afl_api_identity_adjudications) AS "ledgerRows"
  `;
  return {
    database,
    importerResolvedPlayerIds: importerIds,
    humanResolvedPlayerIds: humanIds,
    importerForward: await forwardOf(tx, importerIds),
    humanForward: await forwardOf(tx, humanIds),
    aflApiRows: counts.aflApiRows,
    ledgerRows: counts.ledgerRows,
    fixtureResidue: residueTotal(await readRehearsalResidue(tx)),
    markerPresent: (await readRebuildMarker(tx, database)) !== null,
    ...files,
  };
}

async function readLedger(tx: Tx): Promise<(RehearsalLedgerRow & { playerId: number })[]> {
  const rows = await tx<(Omit<RehearsalLedgerRow, 'id' | 'supersedesId'> & { id: string; supersedesId: string | null; playerId: number })[]>`
    SELECT a.id::text AS id, a.external_id AS "externalId", a.action, a.player_id AS "playerId",
           a.player_identity AS "playerIdentity", a.evidence_sha256 AS "evidenceSha256",
           a.supersedes_id::text AS "supersedesId", u.email AS "adminEmail", a.note,
           to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt"
      FROM afl_api_identity_adjudications a
      JOIN auth_users u ON u.id = a.admin_user_id
     ORDER BY a.id
  `;
  return rows.map((r) => ({ ...r, id: Number(r.id), supersedesId: r.supersedesId === null ? null : Number(r.supersedesId) }));
}

/** The importer rows `verify` expects — the fixture constant, never a captured surrogate. */
function expectedImporterRows(importerPlayer: number | null) {
  const i = REHEARSAL_FIXTURE.importer;
  return [{
    externalId: i.providerId, playerIdentity: i.stableIdentity, matchMethod: i.matchMethod,
    status: 'unique' as const, candidateCount: 1 as const, externalName: i.externalName, externalUrl: null,
    notes: i.notes, playerId: importerPlayer ?? 0,
  }];
}

export function readArchivedRehearsalCaptures(dir: string, database: string, baseline: RehearsalBaseline): RehearsalArchivedCapture[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /^afl-api-identities\..+\.reinstated\.json$/.test(file))
    .sort()
    .map((file) => {
      const text = readFileSync(join(dir, file), 'utf8');
      const fileSha256 = createHash('sha256').update(text, 'utf8').digest('hex');
      let capture;
      try {
        capture = parseCombinedCapture(text, database);
      } catch {
        return { file, fileSha256, payloadSha256: 'unverifiable', carriesFixture: false, importerPlayerIdAtCapture: null };
      }
      const importer = capture.importerRows.find((r) => r.externalId === REHEARSAL_FIXTURE.importer.providerId);
      return {
        file, fileSha256, payloadSha256: capture.payloadSha256,
        carriesFixture: captureCarriesFixture(capture, baseline),
        importerPlayerIdAtCapture: importer?.playerId ?? null,
      };
    });
}

/** Everything verify compares, in ONE read-only snapshot (the replays run in savepoints and cannot write). */
async function observeRehearsal(tx: Tx, captureDir: string, baseline: RehearsalBaseline): Promise<RehearsalObservation> {
  const f = REHEARSAL_FIXTURE;
  const database = await currentDatabase(tx);
  const sourceId = await aflApiSourceId(tx);
  const importerIds = await resolvedPlayerIds(tx, f.importer.stableIdentity);
  const humanIds = await resolvedPlayerIds(tx, f.human.stableIdentity);
  let invariant: RehearsalObservation['invariant'] = 'ok';
  try {
    await tx.savepoint((sp) => assertAflApiIdentityInvariant(sp));
  } catch (error) {
    invariant = { error: (error as Error).message };
  }
  return {
    database,
    markerPresent: (await readRebuildMarker(tx, database)) !== null,
    pendingCaptureExists: existsSync(join(captureDir, PENDING_CAPTURE_FILE)),
    importerResolvedPlayerIds: importerIds,
    humanResolvedPlayerIds: humanIds,
    importerForward: await forwardOf(tx, importerIds),
    humanForward: await forwardOf(tx, humanIds),
    aflApiRows: await tx<RehearsalAflApiRow[]>`
      SELECT external_id AS "externalId", status::text AS status, match_method AS "matchMethod",
             player_id AS "playerId", candidate_count AS "candidateCount", external_url AS "externalUrl",
             external_name AS "externalName", notes
        FROM external_identities WHERE source_id = ${sourceId} ORDER BY external_id
    `,
    ledger: await readLedger(tx),
    actors: await tx<RehearsalActor[]>`
      SELECT email, role, disabled_at IS NOT NULL AS disabled,
             password_hash IS NOT NULL AS "hasPasswordHash", totp_secret IS NOT NULL AS "hasTotpSecret"
        FROM auth_users WHERE lower(email) = ${f.actorEmail} ORDER BY id
    `,
    invariant,
    live: await observeLiveReinstatement(tx, expectedImporterRows(importerIds.length === 1 ? importerIds[0] : null)),
    archivedCaptures: readArchivedRehearsalCaptures(captureDir, database, baseline),
  };
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
  return postgres(dsn, { max: 1, onnotice: () => {}, connection: { application_name: 'afldb-issue237-rehearsal-fixture' } });
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
  return { captureDir: captureDirectory(root, database), baselinePath: rehearsalBaselinePath(root, database) };
}

function readBaseline(path: string, database: string): RehearsalBaseline {
  if (!existsSync(path)) throw new RehearsalFixtureRefused(`No rehearsal baseline at ${path}: run seed first.`);
  return parseRehearsalBaseline(readFileSync(path, 'utf8'), database);
}

/** Re-resolves the stable identity in a fresh snapshot; never reuses an earlier id. */
async function resolveNow(tx: Tx, stableIdentity: string): Promise<number> {
  const result = await resolveAflApiPlayerIdentity(tx, stableIdentity);
  if (!result.ok) throw new RehearsalFixtureRefused(`'${stableIdentity}' is ${result.reason} at write time; run teardown.`);
  return result.newPlayerId;
}

async function runSeed(dsns: RehearsalDsns): Promise<void> {
  const f = REHEARSAL_FIXTURE;
  const { captureDir, baselinePath } = paths(dsns.database);

  // 1. Preconditions, read-only. Nothing is written unless every one holds.
  const pre = await readOnly(dsns.ownerDsn, (tx) => observeSeed(tx, {
    pendingCaptureExists: existsSync(join(captureDir, PENDING_CAPTURE_FILE)),
    baselineExists: existsSync(baselinePath),
  }));
  const problems = rehearsalSeedPreconditionProblems(pre);
  if (problems.length > 0) throw new RehearsalFixtureRefused(`Seed refused; nothing was written: ${problems.join('; ')}`);

  // 2. The import role must really be a different role on code_test_db (unless owner was chosen).
  const importCheck = connect(dsns.importDsn);
  const ownerCheck = connect(dsns.ownerDsn);
  try {
    const [imp] = await importCheck<{ role: string; database: string }[]>`SELECT current_user AS role, current_database() AS database`;
    const [own] = await ownerCheck<{ role: string; database: string }[]>`SELECT current_user AS role, current_database() AS database`;
    if (imp.database !== dsns.database || own.database !== dsns.database) {
      throw new RehearsalFixtureRefused('A DSN connects to a database other than code_test_db; nothing was written.');
    }
    if (!dsns.importIsOwner && imp.role === own.role) {
      throw new RehearsalFixtureRefused(`${REHEARSAL_IMPORT_ENV} connects as the owner role '${own.role}'.`);
    }
    console.log(`    import role : ${imp.role}${dsns.importIsOwner ? ' (OWNER substituted: --allow-owner-import-dsn)' : ''}`);
  } finally {
    await importCheck.end();
    await ownerCheck.end();
  }

  // 3. Fixture setup as owner: the actor and the pending evidence a settle would have written
  //    for the HUMAN provider (without it a link is T5). The importer provider gets none.
  const owner = connect(dsns.ownerDsn);
  let actorId: number;
  try {
    actorId = await owner.begin(async (tx) => {
      if (await currentDatabase(tx) !== dsns.database) throw new RehearsalFixtureRefused('Owner connection moved; nothing was written.');
      const sourceId = await aflApiSourceId(tx);
      const humanPlayer = await resolveNow(tx, f.human.stableIdentity);
      const [player] = await tx<{ givenName: string | null; surname: string | null }[]>`
        SELECT given_name AS "givenName", surname FROM players WHERE id = ${humanPlayer}
      `;
      const [actor] = await tx<{ id: number }[]>`
        INSERT INTO auth_users (email, role, password_hash, totp_secret, disabled_at)
        VALUES (${f.actorEmail}, ${f.actorRole}, NULL, NULL, now())
        RETURNING id
      `;
      const [batch] = await tx<{ id: number }[]>`
        INSERT INTO import_batches (source_id, tool, status, completed_at, notes)
        VALUES (${sourceId}, ${f.tool}, 'completed', now(), ${f.tool})
        RETURNING id
      `;
      // The observed name is COPIED from the identity-resolved player so the link's surname
      // check agrees; it is evidence text, never a lookup key.
      const payload = {
        teamId: f.human.teamId,
        playerStats: {
          player: {
            playerId: f.human.providerId, playerJumperNumber: 25,
            playerName: { givenName: player.givenName ?? '', surname: player.surname ?? '' },
          },
          stats: {},
        },
      };
      const payloadHash = createHash('sha256')
        .update(`player_match_stats|${f.human.externalRecordId}|${JSON.stringify(payload)}`).digest('hex');
      await tx`
        INSERT INTO staging.source_payloads (source_id, family, payload_hash, hash_recipe, raw_payload)
        VALUES (${sourceId}, 'player_match_stats', ${payloadHash}, ${f.hashRecipe}, ${tx.json(payload as never)})
      `;
      await tx`
        INSERT INTO staging.source_record_versions
              (source_id, family, external_record_id, version_seq, payload_hash, observed_from, opened_by_batch_id)
        VALUES (${sourceId}, 'player_match_stats', ${f.human.externalRecordId}, 1, ${payloadHash}, now(), ${batch.id})
      `;
      await tx`
        INSERT INTO promotion_candidates
              (source_id, family, external_record_id, source_version_seq, verb, season,
               target_table, target_id, proposed_fields, status, created_by_batch_id)
        VALUES (${sourceId}, 'player_match_stats', ${f.human.externalRecordId}, 1, 'unresolved_identity',
                ${f.season}, 'player_match_stats', NULL, '{}'::jsonb, 'pending', ${batch.id})
      `;
      return actor.id;
    }) as number;
  } finally {
    await owner.end();
  }

  // 4. The importer-created row, written as the importer writes it: through the IMPORT role, on
  //    the player the stable identity resolves to inside this same transaction.
  const importer = connect(dsns.importDsn);
  try {
    await importer.begin(async (tx) => {
      if (await currentDatabase(tx) !== dsns.database) throw new RehearsalFixtureRefused('Import connection moved; run teardown.');
      const sourceId = await aflApiSourceId(tx);
      const playerId = await resolveNow(tx, f.importer.stableIdentity);
      await tx`
        INSERT INTO external_identities
              (source_id, external_id, external_name, player_id, status, candidate_count, match_method, notes)
        VALUES (${sourceId}, ${f.importer.providerId}, ${f.importer.externalName}, ${playerId}, 'unique', 1,
                ${f.importer.matchMethod}, ${f.importer.notes})
      `;
    });
    console.log('    importer    : ok');
  } finally {
    await importer.end();
  }

  // 5. The human adjudication through the real ISSUE-235 mutation, on the import DSN. All three
  //    development variables are overwritten, never inherited from .env.
  process.env.DATABASE_URL = dsns.ownerDsn;
  process.env.AFLDB_IMPORT_DATABASE_URL = dsns.importDsn;
  process.env.AFLDB_AUTH_DATABASE_URL = dsns.ownerDsn;
  const [{ linkAflApiProvider, readAflApiProviderEvidence }, { adjudicationFingerprint }, { sql: appSql }, { authSql }] =
    await Promise.all([
      import('@/db/queries/afl-api-player-links'),
      import('@/lib/acquisition/afl-api-adjudication'),
      import('@/db/client'),
      import('@/db/authClient'),
    ]);
  try {
    for (const client of [appSql, authSql]) {
      const [{ database }] = await client<{ database: string }[]>`SELECT current_database() AS database`;
      if (database !== dsns.database) throw new RehearsalFixtureRefused(`A query-module client connects to '${database}'; run teardown.`);
    }
    const humanPlayer = await readOnly(dsns.ownerDsn, (tx) => resolveNow(tx, f.human.stableIdentity));
    const evidence = await readAflApiProviderEvidence(f.human.providerId);
    if (evidence === null) throw new RehearsalFixtureRefused('The human provider has no pending evidence; run teardown.');
    const fingerprint = adjudicationFingerprint({
      providerId: f.human.providerId, existing: evidence.existing, pendingCandidates: evidence.pendingCandidates,
      latestAdjudicationId: evidence.latestAdjudicationId, chosenPlayerId: 0, chosenPlayerExistingRows: [],
    });
    const result = await linkAflApiProvider({
      providerId: f.human.providerId, playerId: humanPlayer, adminUserId: actorId, note: f.human.note,
      surnameAcknowledged: false, fingerprint,
    });
    if (!result.ok) {
      throw new RehearsalFixtureRefused(`The human link was refused (${result.code ?? 'no code'}): ${result.error} `
        + 'The fixture is partly seeded; run teardown.');
    }
    console.log('    human link  : ok');
  } finally {
    await appSql.end({ timeout: 5 });
    await authSql.end({ timeout: 5 });
  }

  // 6. The baseline, read back as owner in one snapshot: durable fields only.
  const baseline = await readOnly(dsns.ownerDsn, async (tx) => buildRehearsalBaseline({
    database: dsns.database, seededAt: new Date().toISOString(),
    ledger: (await readLedger(tx)).map(({ playerId: _audit, ...durable }) => durable),
  }));
  mkdirSync(dirname(baselinePath), { recursive: true });
  const text = `${JSON.stringify(baseline, null, 2)}\n`;
  writeFileSync(`${baselinePath}.tmp`, text, 'utf8');
  renameSync(`${baselinePath}.tmp`, baselinePath);
  console.log(`    importer    : ${f.importer.providerId} -> ${f.importer.stableIdentity} (${f.importer.matchMethod})`);
  console.log(`    human       : ${f.human.providerId} -> ${f.human.stableIdentity} (ledger ${baseline.ledger.map((r) => r.id).join(', ')})`);
  console.log(`    baseline    : ${baselinePath}`);
  console.log(`    payload     : ${baseline.payloadSha256}`);
  console.log('    next        : verify --phase pre');
}

async function runVerify(dsns: RehearsalDsns, phase: 'pre' | 'post'): Promise<void> {
  const { captureDir, baselinePath } = paths(dsns.database);
  const baseline = readBaseline(baselinePath, dsns.database);
  const observed = await readOnly(dsns.ownerDsn, (tx) => observeRehearsal(tx, captureDir, baseline));
  const problems = rehearsalVerifyProblems(baseline, observed, phase);
  const f = REHEARSAL_FIXTURE;
  console.log(`    importer    : ${f.importer.providerId} -> ${f.importer.stableIdentity} = player `
    + `${observed.importerResolvedPlayerIds.join('/') || 'none'}`);
  console.log(`    human       : ${f.human.providerId} -> ${f.human.stableIdentity} = player `
    + `${observed.humanResolvedPlayerIds.join('/') || 'none'}`);
  console.log(`    afl_api     : ${observed.aflApiRows.length} row(s); ledger ${observed.ledger.length} row(s); `
    + `marker ${observed.markerPresent ? 'PRESENT' : 'absent'}`);
  if (!('error' in observed.live.replay)) {
    console.log(`    replay      : ${observed.live.replay.inserted} insert, ${observed.live.replay.supersedes.length} supersede (expected 0/0)`);
  }
  for (const c of observed.archivedCaptures.filter((x) => x.carriesFixture)) {
    // Audit only: the captured surrogate is printed to show renumbering, never compared.
    console.log(`    capture     : ${c.file} sha256 ${c.fileSha256} payload ${c.payloadSha256} `
      + `(importer player at capture ${String(c.importerPlayerIdAtCapture)}, now ${observed.importerResolvedPlayerIds.join('/')})`);
  }
  if (problems.length > 0) {
    throw new RehearsalFixtureRefused(`verify --phase ${phase} FAILED (${problems.length}): ${problems.join('; ')}`);
  }
  console.log(`    ISSUE-237 rehearsal verify --phase ${phase}: PASS`);
}

async function runResidue(dsns: RehearsalDsns): Promise<void> {
  const residue = await readOnly(dsns.ownerDsn, async (tx) => {
    if (await currentDatabase(tx) !== dsns.database) throw new RehearsalFixtureRefused('The owner DSN connects elsewhere.');
    return readRehearsalResidue(tx);
  });
  console.log(`    residue     : ${JSON.stringify(residue)}`);
  if (residueTotal(residue) !== 0) throw new RehearsalFixtureRefused(`Rehearsal residue gate FAILED: ${residueTotal(residue)} row(s) remain.`);
  console.log('    ISSUE-237 rehearsal residue gate: PASS (0)');
}

async function runTeardown(dsns: RehearsalDsns): Promise<void> {
  const f = REHEARSAL_FIXTURE;
  const providers = [f.importer.providerId, f.human.providerId];
  const { captureDir, baselinePath } = paths(dsns.database);
  // Never mid-lifecycle: a marker or a pending capture means a rebuild still owes a recovery,
  // and deleting fixture rows now would make the recovered state differ from its capture.
  if (existsSync(join(captureDir, PENDING_CAPTURE_FILE))) {
    throw new RehearsalFixtureRefused(`A pending rebuild capture exists in ${captureDir}: recover the rebuild first; nothing was deleted.`);
  }
  const owner = connect(dsns.ownerDsn);
  try {
    const report = (what: string, n: number) => console.log(`    removed     : ${String(n).padStart(3)} ${what}`);
    // Every statement is an exact-literal DELETE; a rerun after a partial teardown removes only
    // what is still there. Child to parent.
    await owner.begin(async (tx) => {
      const database = await currentDatabase(tx);
      if (database !== dsns.database) throw new RehearsalFixtureRefused(`The owner DSN connects to '${database}'; nothing was deleted.`);
      if (await readRebuildMarker(tx, database)) {
        throw new RehearsalFixtureRefused('A rebuild marker is present: recover the rebuild first; nothing was deleted.');
      }
      const sourceId = await aflApiSourceId(tx);
      report('ledger row(s)', (await tx`
        DELETE FROM afl_api_identity_adjudications
         WHERE external_id = ANY (${tx.array(providers)})
            OR admin_user_id IN (SELECT id FROM auth_users WHERE lower(email) = ${f.actorEmail})
      `).count);
      report('afl_api identity row(s)', (await tx`
        DELETE FROM external_identities WHERE source_id = ${sourceId} AND external_id = ANY (${tx.array(providers)})
      `).count);
      report('canonical application(s)',
        (await tx`DELETE FROM canonical_applications WHERE external_record_id = ${f.human.externalRecordId}`).count);
      report('promotion candidate(s)',
        (await tx`DELETE FROM promotion_candidates WHERE external_record_id = ${f.human.externalRecordId}`).count);
      report('staging source record(s)', (await tx`
        DELETE FROM staging.source_records WHERE source_id = ${sourceId} AND external_record_id = ${f.human.externalRecordId}
      `).count);
      report('staging record version(s)', (await tx`
        DELETE FROM staging.source_record_versions WHERE source_id = ${sourceId} AND external_record_id = ${f.human.externalRecordId}
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

  await runResidue(dsns);

  if (existsSync(baselinePath)) {
    const archived = baselinePath.replace(/\.baseline\.json$/, `.baseline.${new Date().toISOString().replace(/[-:.]/g, '')}.torn-down.json`);
    renameSync(baselinePath, archived);
    console.log(`    baseline    : archived as ${archived}`);
  }
  console.log('    ISSUE-237 rehearsal teardown: PASS');
}

async function main(argv: string[]): Promise<void> {
  const command = parseRehearsalArgs(argv);
  loadDotEnv();
  const dsns = resolveRehearsalDsns(process.env, {
    // Only seed writes through the import DSN; verify, residue and teardown are owner-only.
    allowOwnerImportDsn: command.step === 'seed' ? command.allowOwnerImportDsn : true,
  });
  for (const id of [REHEARSAL_FIXTURE.importer.providerId, REHEARSAL_FIXTURE.human.providerId]) {
    if (!AFL_API_PROVIDER_ID_RE.test(id) || !REHEARSAL_PROVIDER_NAMESPACE_RE.test(id)) {
      throw new RehearsalFixtureRefused(`Fixture provider id ${id} is outside the ISSUE-237 namespace.`);
    }
  }
  console.log(`AFLDB-ISSUE-237 rehearsal fixture — ${command.step}`
    + `${command.step === 'verify' ? ` --phase ${command.phase}` : ''} on ${dsns.database}`);
  if (command.step === 'seed') return runSeed(dsns);
  if (command.step === 'verify') return runVerify(dsns, command.phase);
  if (command.step === 'residue') return runResidue(dsns);
  return runTeardown(dsns);
}

if (process.argv[1] && /afl_api_identity_rebuild_rehearsal_fixture\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`    REFUSED: ${redact((error as Error).message)}`);
      process.exit(1);
    });
}
