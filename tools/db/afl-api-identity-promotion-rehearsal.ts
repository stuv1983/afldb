/**
 * AFLDB-ISSUE-238 Slice 11 — the code_test_db rehearsal of corrected-identity PROMOTION: the §9.1
 * CPC at `--phase restored`, the v3 `E_promotion` artefact, the §7.4e promotion REPLAY
 * (`correct_afl_api_identity.ts --replay-promotion`, the REAL CLI as a subprocess) and the §7.5
 * candidate-phase CRV, one §12.1 P case at a time.
 *
 *     AFLDB_CODE_TEST_DATABASE_URL=<afldb_owner DSN naming code_test_db> \
 *     AFLDB_CODE_TEST_IMPORT_DATABASE_URL=<afldb_import DSN naming code_test_db> \
 *       npx tsx tools/db/afl-api-identity-promotion-rehearsal.ts run --case 34 --acknowledge code_test_db --out <dir>
 *     ... run --case 36 --variant absent-clean|still-implicated ...
 *     ... run --case 40 --variant divergent|tampered ...
 *     ... run --all --acknowledge code_test_db --out <dir>     (every case and variant, in order)
 *     ... residue                                              (read-only; expect 0 and no target schema)
 *     ... teardown --acknowledge code_test_db                  (only after a run that died before its own teardown)
 *
 * Cases: 33 (zero-corrected promotion path; NOT its PSG/post-swap sub-clause), 34, 35, 36, 37, 38,
 * 39, 40, 41, 42, 43, 63, 64, 65, 80, 86. Cases 45, 46 and 60 are the rebuild/recovery paths and
 * are proved separately; 44, 66, 67, 89, 90, 92 and 33's PSG clause are the DEV promotion rehearsal.
 *
 * MODEL (the ISSUE-242 pattern, `promotion-convergence-rehearsal.ts`). The CANDIDATE is `public`
 * of code_test_db. The TARGET is the shadow schema `issue238_s11_target` in the same database,
 * holding only what the target-side promotion reads need (`sources`, `external_identities`,
 * `afl_api_identity_adjudications`), read through a connection whose search_path is that schema
 * alone, so the REAL promotion-check SQL runs unchanged. Target player ids are target-local
 * (candidate id + 1e9): every cross-side join is by stable identity, as in a real promotion. Before
 * each world, the candidate's NON-fixture afl_api identity rows (and their players' accepted stable
 * identities) are cloned into the target, so G2/G3 see the real baseline on both sides.
 *
 * The flow per case is the real one: `--phase restored` (rebuild marker, CPC via
 * `runAflApiCorrectedPredict`, `gateAflApiOverlap` G2/G3, `gateAflApiCorrectedPredict`, the v3 file
 * from `aflApiSupersedeFileFor`, parsed back by the strict parser) -> the plan's reinstatement of
 * the target ledger into the candidate (ids preserved, player_id remapped by stable identity) ->
 * `--replay-promotion` (subprocess, CANDIDATE_DSN = the owner DSN, parsed fail-closed) -> `--phase
 * candidate` (`gateAflApiCandidateAfterReinstate`, and `gateAflApiCorrectedReplayVerification`
 * through `withCorrectionSatisfactionReader`). Nothing here re-implements a promotion decision.
 *
 * FIXTURE NAMESPACE AND ISOLATION. Candidate fixture rows are built with the Slice-10 harness's
 * builders (`world`, `pmsClosureRow`, ...), so they carry the real settle-evidence shape and live in
 * the Slice-10 fixture namespace (season 2092, `issue238-rh-<ccc>-*`, `CD_I99923800<ccc><n>`, ...),
 * covered by its `FIXTURE_TABLES` predicates, which also select the promotion REPLAY's batch
 * (`correct_afl_api_identity`, externalId in the fixture provider range) and its applications. A
 * run refuses to start on any fixture residue, an existing target schema, a rebuild marker, a
 * failing identity invariant or another rehearsal/correction session; it always tears down in
 * `finally` (fixture predicates + `DROP SCHEMA issue238_s11_target`), restores every sequence the
 * case advanced, and proves zero residue and an unchanged FOREIGN fingerprint (before the world,
 * after setup, after the promotion, after teardown).
 *
 * DEV, PROD and afldb_test are never contacted. `--environment dev` is only the artefact's
 * environment enum. No DSN is printed.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres, { type Sql, type TransactionSql } from 'postgres';

import {
  aflApiIdentityStateSha256, aflApiLedgerStateSha256, parseAflApiSupersedeFile, type AflApiSupersedeFile,
} from '../../src/lib/acquisition/afl-api-adjudication';
import type { CpcResult } from '../../src/lib/acquisition/afl-api-identity-correction';
import { canonicalJson, type JsonValue } from '../../src/lib/acquisition/observations';
import { replayPromotionGuardProblems, resolveCandidateDsn } from '../migration/correct_afl_api_identity';
import {
  aflApiIdentityStateRowsFromCensus, assertAflApiIdentityInvariant, replayAflApiAdjudicationsFromSupersedeFile,
} from '../migration/replay_afl_api_adjudications';
import {
  connectTargets, CORRECTION_REHEARSAL, FIXTURE_TABLES, fingerprintDiff, foreignFingerprint, nonZero, pmsClosureRow,
  readResidue, residueTotal, settleDerived, teardownFixture, world, type PmsClosureRow, type Targets, type World,
} from './afl-api-identity-correction-rehearsal';
import type { Row } from './catalog-fingerprint';
import {
  aflApiSupersedeFileFor, cpcPassSet, gateAflApiCandidateAfterReinstate, gateAflApiCorrectedCensus,
  gateAflApiCorrectedPredict, gateAflApiCorrectedReplayVerification, gateAflApiOverlap, gateAflApiRebuildMarker,
  netCorrectedCorrectionEntries, netCorrectedEntries, readAflApiForwardIdentities, readAflApiImporterView,
  readAflApiLedgerRows, readRebuildMarkerPresent, Report, runAflApiCorrectedPredict, targetHumanProvidersOf,
  withCorrectionSatisfactionReader, type AflApiCorrectedInputs, type AflApiOverlapResult, type Query,
} from './promotion-check';
import { redact } from './psql';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TSX_CLI = join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CORRECTION_CLI = join(PROJECT_ROOT, 'tools', 'migration', 'correct_afl_api_identity.ts');

const R = CORRECTION_REHEARSAL;

export const PROMOTION_REHEARSAL = {
  database: R.database,
  targetSchema: 'issue238_s11_target',
  /** The artefact's `targetDatabase` label: the shadow target (a free string in the v3 binding). */
  targetLabel: 'issue238_s11_target',
  /** Target-local player ids: candidate id + this offset (stable-identity joins only). */
  targetPlayerOffset: 1_000_000_000,
  /** Fixture ledger ids: base + case * 10 + k (explicit, never from the candidate's sequence). */
  ledgerIdBase: 923_800_000,
  environment: 'dev' as const,
} as const;

const P = PROMOTION_REHEARSAL;
const T = P.targetSchema;

class PromotionRehearsalRefused extends Error {}

/* ==================================================================== *
 * Cases and CLI
 * ==================================================================== */

export const CASE_VARIANTS: Readonly<Record<number, readonly (string | null)[]>> = {
  33: [null], 34: [null], 35: [null], 36: ['absent-clean', 'still-implicated'], 37: [null], 38: [null], 39: [null],
  40: ['divergent', 'tampered'], 41: [null], 42: [null], 43: [null], 63: [null], 64: [null], 65: [null], 80: [null], 86: [null],
};

const USAGE = 'usage: run --case <n> [--variant <v>] --acknowledge code_test_db --out <dir> | run --all --acknowledge code_test_db --out <dir> '
  + '| residue | teardown --acknowledge code_test_db';

export type PromotionRehearsalCommand =
  | { kind: 'run'; cases: readonly { caseNo: number; variant: string | null }[]; out: string }
  | { kind: 'residue' }
  | { kind: 'teardown' };

export function parsePromotionRehearsalArgs(argv: readonly string[]): PromotionRehearsalCommand {
  const [command, ...rest] = argv;
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (!flag.startsWith('--')) throw new PromotionRehearsalRefused(`unexpected argument '${flag}'. ${USAGE}`);
    if (flag === '--all') { flags.set(flag, true); continue; }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new PromotionRehearsalRefused(`${flag} needs a value. ${USAGE}`);
    flags.set(flag, value);
    i += 1;
  }
  const known = new Set(['--case', '--variant', '--acknowledge', '--out', '--all']);
  for (const f of flags.keys()) if (!known.has(f)) throw new PromotionRehearsalRefused(`unknown flag ${f}. ${USAGE}`);
  if (command === 'residue') {
    if (flags.size > 0) throw new PromotionRehearsalRefused(`residue takes no flags. ${USAGE}`);
    return { kind: 'residue' };
  }
  if (flags.get('--acknowledge') !== P.database) throw new PromotionRehearsalRefused(`--acknowledge ${P.database} is required. ${USAGE}`);
  if (command === 'teardown') return { kind: 'teardown' };
  if (command !== 'run') throw new PromotionRehearsalRefused(USAGE);
  const out = flags.get('--out');
  if (typeof out !== 'string') throw new PromotionRehearsalRefused(`run needs --out <dir>. ${USAGE}`);
  if (flags.get('--all') === true) {
    if (flags.has('--case') || flags.has('--variant')) throw new PromotionRehearsalRefused(`--all takes no --case/--variant. ${USAGE}`);
    const cases = Object.entries(CASE_VARIANTS).flatMap(([n, vs]) => vs.map((variant) => ({ caseNo: Number(n), variant })));
    return { kind: 'run', cases, out: resolve(out) };
  }
  const caseArg = flags.get('--case');
  if (typeof caseArg !== 'string' || !/^[1-9][0-9]*$/.test(caseArg)) throw new PromotionRehearsalRefused(`run needs --case <n>. ${USAGE}`);
  const caseNo = Number(caseArg);
  const variants = CASE_VARIANTS[caseNo];
  if (!variants) throw new PromotionRehearsalRefused(`case ${caseNo} is not a Slice-11 promotion case (${Object.keys(CASE_VARIANTS).join(', ')})`);
  const variantArg = flags.get('--variant');
  const variant = typeof variantArg === 'string' ? variantArg : null;
  if (!variants.includes(variant)) {
    throw new PromotionRehearsalRefused(`case ${caseNo} takes --variant ${variants.map((v) => v ?? '(none)').join(' | ')}`);
  }
  return { kind: 'run', cases: [{ caseNo, variant }], out: resolve(out) };
}

/* ==================================================================== *
 * Connections, preflight, residue, sequences
 * ==================================================================== */

type Ctx = {
  targets: Targets;
  owner: Sql;
  /** The shadow target's connection: search_path = the target schema alone. */
  target: Sql;
  qCand: Query;
  qTgt: Query;
  out: string;
  caseNo: number;
  variant: string | null;
  code: string;
  check: (label: string, ok: boolean, detail?: string) => void;
};

function queryOf(sql: Sql): Query {
  return (text, params) => sql.unsafe(text, (params ?? []) as never[]).then((rows) => rows as unknown as Row[]);
}

function connectTarget(ownerDsn: string): Sql {
  return postgres(ownerDsn, {
    // No prepared-statement cache: the target schema is dropped and re-created between worlds.
    max: 1, prepare: false, onnotice: () => {},
    connection: { application_name: 'afldb-issue238-s11-promotion-target', search_path: T },
  });
}

async function assertDatabase(tx: TransactionSql | Sql): Promise<void> {
  const [{ d, u }] = await tx<{ d: string; u: string }[]>`SELECT current_database() AS d, current_user AS u`;
  if (d !== P.database || u !== R.ownerRole) {
    throw new PromotionRehearsalRefused(`connected to '${d}' as '${u}', not '${P.database}' as '${R.ownerRole}'; nothing was written`);
  }
}

async function targetSchemaExists(sql: Sql): Promise<boolean> {
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = ${T}`;
  return row.n > 0;
}

/** Before any fixture write. Refuses on any doubt. */
async function preflight(targets: Targets): Promise<void> {
  const { owner, ownPids } = targets;
  const problems: string[] = [];
  const [session] = await owner.begin(async (tx) => tx<{ ro: string }[]>`SELECT current_setting('transaction_read_only') AS ro`);
  if (session.ro !== 'off') problems.push(`the owner session is read-only (transaction_read_only = ${session.ro})`);
  const residue = await readResidue(owner);
  if (residueTotal(residue) !== 0) problems.push(`fixture residue already present ${nonZero(residue)}: run teardown first`);
  if (await targetSchemaExists(owner)) problems.push(`schema ${T} already exists: run teardown first`);
  if (await readRebuildMarkerPresent(queryOf(owner))) problems.push('a rebuild marker is present');
  const [ledger] = await owner<{ ledger: number; resolved: number }[]>`
    SELECT (SELECT count(*)::int FROM afl_api_identity_adjudications) AS ledger,
           (SELECT count(*)::int FROM external_identities e JOIN sources s ON s.id = e.source_id
             WHERE s.key = 'afl_api' AND e.status = 'resolved') AS resolved
  `;
  if (ledger.ledger !== 0 || ledger.resolved !== 0) {
    problems.push(`the candidate is not a restored-candidate state: ${ledger.ledger} ledger row(s), ${ledger.resolved} resolved afl_api row(s)`);
  }
  try {
    await owner.begin('isolation level repeatable read read only', (tx) => assertAflApiIdentityInvariant(tx));
  } catch (error) {
    problems.push(`the combined afl_api identity invariant fails: ${(error as Error).message}`);
  }
  // A just-closed session of the previous case may linger for a moment: re-read for up to ~5 s.
  let others: { pid: number; app: string }[] = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    others = await owner<{ pid: number; app: string }[]>`
      SELECT pid, application_name AS app FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> ALL (${[...ownPids]}::int[])
         AND (application_name LIKE 'afldb-issue238%' OR application_name LIKE 'afldb-correct-afl-api-identity%'
              OR application_name LIKE 'afldb-promotion-check%')
    `;
    if (others.length === 0) break;
    await new Promise((done) => setTimeout(done, 500));
  }
  if (others.length > 0) problems.push(`other rehearsal/correction session(s) on ${P.database}: ${others.map((o) => `${o.pid} ${o.app}`).join(', ')}`);
  if (problems.length > 0) throw new PromotionRehearsalRefused(`Preflight refused; nothing was written: ${problems.join('; ')}.`);
}

type SeqState = { key: string; lastValue: string; isCalled: boolean; owner: { table: string; column: string } | null };

async function sequenceStates(sql: Sql): Promise<SeqState[]> {
  const seqs = await sql<{ key: string; tbl: string | null; col: string | null }[]>`
    SELECT format('%I.%I', n.nspname, c.relname) AS key,
           (SELECT d.refobjid::regclass::text FROM pg_depend d
             WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i') LIMIT 1) AS tbl,
           (SELECT a.attname::text FROM pg_depend d JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
             WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i') LIMIT 1) AS col
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'S' AND n.nspname IN ('public', 'staging')
     ORDER BY 1
  `;
  const out: SeqState[] = [];
  for (const s of seqs) {
    const [v] = await sql.unsafe<{ lastValue: string; isCalled: boolean }[]>(
      `SELECT last_value::text AS "lastValue", is_called AS "isCalled" FROM ${s.key}`);
    out.push({ key: s.key, lastValue: v.lastValue, isCalled: v.isCalled, owner: s.tbl && s.col ? { table: s.tbl, column: s.col } : null });
  }
  return out;
}

/**
 * Sequences are non-transactional: a case's fixture ids and the REPLAY batch advance them. After
 * teardown each changed sequence is set back exactly, but only when its owning column holds no
 * value above the restored point (a foreign row written meanwhile would make a rewind unsafe:
 * that refuses instead).
 */
async function restoreSequences(sql: Sql, before: readonly SeqState[]): Promise<string[]> {
  const now = new Map((await sequenceStates(sql)).map((s) => [s.key, s]));
  const restored: string[] = [];
  for (const b of before) {
    const n = now.get(b.key);
    if (!n) throw new PromotionRehearsalRefused(`sequence ${b.key} disappeared`);
    if (n.lastValue === b.lastValue && n.isCalled === b.isCalled) continue;
    if (b.owner) {
      const [m] = await sql.unsafe<{ over: number }[]>(
        `SELECT count(*)::int AS over FROM ${b.owner.table} WHERE ${JSON.stringify(b.owner.column)} > $1::bigint`, [b.lastValue]);
      if (m.over > 0) {
        throw new PromotionRehearsalRefused(`cannot restore ${b.key}: ${m.over} row(s) of ${b.owner.table} are above ${b.lastValue} after teardown`);
      }
    }
    await sql`SELECT setval(${b.key}::regclass, ${b.lastValue}::bigint, ${b.isCalled})`;
    restored.push(`${b.key} ${n.lastValue}/${n.isCalled} -> ${b.lastValue}/${b.isCalled}`);
  }
  return restored;
}

const seqText = (s: readonly SeqState[]) => JSON.stringify(s.map((x) => [x.key, x.lastValue, x.isCalled]));

/** Order-independent digest of every FIXTURE row (the complement of the foreign fingerprint). */
async function fixtureDigest(sql: Sql): Promise<string> {
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    const parts: string[] = [];
    for (const t of FIXTURE_TABLES) {
      const [row] = await tx.unsafe<{ n: string; h: string | null }[]>(
        `SELECT count(*)::text AS n, sum(hashtextextended(x::text, 0)::numeric)::text AS h
           FROM ${t.table} x WHERE COALESCE((${t.fixture}), false)`);
      parts.push(`${t.table}=${row.n}:${row.h ?? '-'}`);
    }
    return createHash('sha256').update(parts.join('\n')).digest('hex');
  }) as Promise<string>;
}

async function teardownAll(owner: Sql): Promise<void> {
  await teardownFixture(owner);
  await owner.begin(async (tx) => {
    await assertDatabase(tx);
    await tx.unsafe(`DROP SCHEMA IF EXISTS ${T} CASCADE`);
  });
}

/* ==================================================================== *
 * The shadow target
 * ==================================================================== */

/** One statement per element: the owner connection uses the extended protocol. */
const TARGET_DDL: readonly string[] = [
  `CREATE SCHEMA ${T}`,
  `CREATE TABLE ${T}.sources (id integer PRIMARY KEY, key text NOT NULL UNIQUE)`,
  `CREATE TABLE ${T}.external_identities (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id integer NOT NULL REFERENCES ${T}.sources (id),
    external_id text NOT NULL, player_id integer, status public.link_status NOT NULL,
    candidate_count integer NOT NULL, match_method text, external_url text,
    UNIQUE (source_id, external_id))`,
  `CREATE TABLE ${T}.afl_api_identity_adjudications (
    id bigint PRIMARY KEY, source_key text NOT NULL, external_id text NOT NULL, action text NOT NULL,
    player_id integer NOT NULL, player_identity text NOT NULL, previous_player_identity text,
    previous_state jsonb, evidence jsonb NOT NULL, evidence_sha256 text NOT NULL,
    surname_disagreement_acknowledged boolean NOT NULL,
    supersedes_id bigint REFERENCES ${T}.afl_api_identity_adjudications (id),
    admin_user_id integer NOT NULL, note text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
];

const ACCEPTED_IDENTITY_SQL = `((s.key = 'afltables' AND e.match_method = 'afltables_profile_url')
  OR (s.key = 'manual_admin_edit' AND e.match_method = 'manual_admin_edit')) AND e.status IN ('unique', 'resolved')`;

/** The shadow target and the clone of the candidate's NON-fixture afl_api baseline (and every
 * accepted stable identity of those rows' players), target-local ids. */
async function createTarget(tx: TransactionSql): Promise<{ foreignAflApiRows: number; foreignIdentityRows: number }> {
  for (const statement of TARGET_DDL) await tx.unsafe(statement);
  await tx.unsafe(`INSERT INTO ${T}.sources (id, key) SELECT id, key FROM public.sources`);
  const providerFixture = `e.external_id LIKE '${R.providerPrefix}%'`;
  const aflApi = await tx.unsafe<{ n: number }[]>(`
    WITH ins AS (
      INSERT INTO ${T}.external_identities (source_id, external_id, player_id, status, candidate_count, match_method, external_url)
      SELECT e.source_id, e.external_id, e.player_id + ${P.targetPlayerOffset}, e.status, e.candidate_count, e.match_method, e.external_url
        FROM public.external_identities e JOIN public.sources s ON s.id = e.source_id
       WHERE s.key = 'afl_api' AND NOT (${providerFixture})
      RETURNING 1)
    SELECT count(*)::int AS n FROM ins`);
  const identities = await tx.unsafe<{ n: number }[]>(`
    WITH ins AS (
      INSERT INTO ${T}.external_identities (source_id, external_id, player_id, status, candidate_count, match_method, external_url)
      SELECT e.source_id, e.external_id, e.player_id + ${P.targetPlayerOffset}, e.status, e.candidate_count, e.match_method, e.external_url
        FROM public.external_identities e JOIN public.sources s ON s.id = e.source_id
       WHERE ${ACCEPTED_IDENTITY_SQL}
         AND e.player_id IN (SELECT a.player_id FROM public.external_identities a JOIN public.sources sa ON sa.id = a.source_id
                              WHERE sa.key = 'afl_api' AND a.player_id IS NOT NULL AND a.external_id NOT LIKE '${R.providerPrefix}%')
      RETURNING 1)
    SELECT count(*)::int AS n FROM ins`);
  return { foreignAflApiRows: aflApi[0].n, foreignIdentityRows: identities[0].n };
}

async function targetSourceId(tx: TransactionSql, key: string): Promise<number> {
  const [row] = await tx.unsafe<{ id: number }[]>(`SELECT id FROM ${T}.sources WHERE key = $1`, [key]);
  if (!row) throw new PromotionRehearsalRefused(`target sources.key '${key}' is missing`);
  return row.id;
}

async function targetIdentity(tx: TransactionSql, path: string, candidatePlayerId: number): Promise<number> {
  const tid = candidatePlayerId + P.targetPlayerOffset;
  await tx.unsafe(`INSERT INTO ${T}.external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
                   VALUES ($1, $2, $3, 'unique', 1, 'afltables_profile_url')`, [await targetSourceId(tx, 'afltables'), path, tid]);
  return tid;
}

type LedgerSpec = {
  id: number; action: 'linked' | 'corrected'; playerId: number; playerIdentity: string;
  previousPlayerIdentity: string | null; supersedesId: number | null; previousState: JsonValue | null;
};

function evidenceFor(caseNo: number, spec: LedgerSpec, providerId: string): { evidence: JsonValue; sha256: string } {
  const evidence: JsonValue = {
    issue: 'AFLDB-ISSUE-238', rehearsal: 'Slice 11 promotion', fixture: true, case: caseNo,
    providerId, action: spec.action, playerIdentity: spec.playerIdentity, previousPlayerIdentity: spec.previousPlayerIdentity,
  };
  return { evidence, sha256: createHash('sha256').update(canonicalJson(evidence), 'utf8').digest('hex') };
}

async function insertLedgerRow(tx: TransactionSql, schema: string, caseNo: number, providerId: string, actorId: number, spec: LedgerSpec): Promise<void> {
  const { evidence, sha256 } = evidenceFor(caseNo, spec, providerId);
  const overriding = schema === 'public' ? 'OVERRIDING SYSTEM VALUE' : '';
  await tx.unsafe(`
    INSERT INTO ${schema}.afl_api_identity_adjudications
      (id, source_key, external_id, action, player_id, player_identity, previous_player_identity, previous_state,
       evidence, evidence_sha256, surname_disagreement_acknowledged, supersedes_id, admin_user_id, note)
    ${overriding}
    VALUES ($1, 'afl_api', $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, false, $10, $11, $12)`,
  [spec.id, providerId, spec.action, spec.playerId, spec.playerIdentity, spec.previousPlayerIdentity,
    spec.previousState === null ? null : JSON.stringify(spec.previousState), JSON.stringify(evidence), sha256,
    spec.supersedesId, actorId, `AFLDB-ISSUE-238 Slice 11 promotion rehearsal case ${caseNo}: ${spec.action} fixture authority`] as never[]);
}

/* ==================================================================== *
 * Candidate-side fixture builders (small, rehearsal-only; everything else is Slice 10's)
 * ==================================================================== */

/** A further fixture player in the Slice-10 namespace, with its accepted AFL Tables identity. */
async function fixturePlayer(tx: TransactionSql, w: World, role: string): Promise<{ id: number; path: string }> {
  const path = `${R.pathPrefix}${w.caseCode}_${role}.html`;
  const surname = `Zz238-${w.caseCode}-${role}`;
  const [player] = await tx<{ id: number }[]>`
    INSERT INTO players (display_name, sort_name, search_name, slug, given_name, surname, notes)
    VALUES (${`Rehearsal ${surname}`}, ${`${surname}, Rehearsal`}, ${`rehearsal ${surname.toLowerCase()}`},
            ${`${R.slugPrefix}${w.caseCode}-${role.toLowerCase()}`}, 'Rehearsal', ${surname},
            'AFLDB-ISSUE-238 Slice 11 promotion rehearsal fixture')
    RETURNING id
  `;
  await tx`
    INSERT INTO external_identities (source_id, external_id, player_id, status, candidate_count, match_method, notes)
    VALUES (${w.sourceIds.afltables}, ${path}, ${player.id}, 'unique', 1, 'afltables_profile_url',
            'AFLDB-ISSUE-238 Slice 11 promotion rehearsal fixture')
  `;
  return { id: player.id, path };
}

/** A D5 importer `afl_api` row (the shape `world` writes at P) for `providerId` at `playerId`. */
async function importerRow(tx: TransactionSql, w: World, providerId: string, playerId: number): Promise<void> {
  await tx`
    INSERT INTO external_identities (source_id, external_id, external_name, player_id, status, candidate_count, match_method, notes)
    VALUES (${w.sourceIds.aflApi}, ${providerId}, ${`Rehearsal Zz238-${w.caseCode}`}, ${playerId}, 'unique', 1,
            'afl_api_stat_vector_bootstrap', 'AFLDB-ISSUE-238 Slice 11 promotion rehearsal fixture')
  `;
}

/** An AFL Tables-owned (foreign, no AFL API lineage) P′ row at the closure row's key, identical values. */
async function foreignCounterpart(tx: TransactionSql, w: World, closure: PmsClosureRow): Promise<number> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO player_match_stats ${tx({
      player_id: w.pPrime.id, match_id: closure.matchId, ...closure.values,
      source_id: w.sourceIds.afltables, source_record_id: null, import_batch_id: null,
    } as never)}
    RETURNING id::text AS id
  `;
  return Number(row.id);
}

/** `brownlow_vote_entry_state` for M as the Brownlow admin writes it on a first finalise (revision 1). */
async function entryState(tx: TransactionSql, w: World, matchId: number, slots: { three: number; two: number; one: number }): Promise<void> {
  await tx`
    INSERT INTO brownlow_vote_entry_state
          (match_id, season, status, three_player_id, two_player_id, one_player_id,
           revision, created_by, updated_by, updated_at, finalised_by, finalised_at, finalised_revision, last_reason)
    VALUES (${matchId}, ${w.season}, 'final', ${slots.three}, ${slots.two}, ${slots.one},
            1, ${w.actorId}, ${w.actorId}, now(), ${w.actorId}, now(), 1, NULL)
  `;
}

/* ==================================================================== *
 * Worlds
 * ==================================================================== */

type CandidatePosition = 'at-p' | 'at-pprime' | 'absent' | 'at-third';
type Authority = 'corrected' | 'linked';

type WorldSpec = {
  candidate: CandidatePosition;
  closure: 'none' | 'pms' | 'pms-foreign-collision';
  authority: Authority;
  /** Case 38: another fixture provider already holds P′ in the candidate. */
  otherProviderAtPPrime?: boolean;
  /** Case 86: the corrected authority's previous identity (and the linked row's identity). */
  previousIdentity?: string;
};

type Built = {
  w: World;
  providerId: string;
  closure: PmsClosureRow | null;
  counterpartId: number | null;
  third: { id: number; path: string } | null;
  otherProviderId: string | null;
  ledgerIds: { linked: number; corrected: number | null };
  previousIdentity: string;
  target: { foreignAflApiRows: number; foreignIdentityRows: number };
};

async function buildWorld(ctx: Ctx, spec: WorldSpec): Promise<Built> {
  return ctx.owner.begin(async (tx) => {
    await assertDatabase(tx);
    const w = await world(tx, ctx.caseNo, { importerLink: spec.candidate === 'at-p' });
    const providerId = w.providerId;
    let third: Built['third'] = null;
    if (spec.candidate === 'at-pprime') await importerRow(tx, w, providerId, w.pPrime.id);
    if (spec.candidate === 'at-third') {
      third = await fixturePlayer(tx, w, 'Pthird');
      await importerRow(tx, w, providerId, third.id);
    }
    let otherProviderId: string | null = null;
    if (spec.otherProviderAtPPrime) {
      otherProviderId = `${R.providerPrefix}${w.caseCode}2`;
      await importerRow(tx, w, otherProviderId, w.pPrime.id);
    }
    let closure: PmsClosureRow | null = null;
    let counterpartId: number | null = null;
    if (spec.closure !== 'none') closure = await pmsClosureRow(tx, w, 1);
    if (spec.closure === 'pms-foreign-collision') counterpartId = await foreignCounterpart(tx, w, closure!);
    // A rebuilt candidate's derived state is settled: the real targeted recompute (Slice 10's
    // `settleDerived`), so REPLAY's own step-8 recompute is a no-op on every row it does not move.
    if (spec.closure !== 'none') await settleDerived(tx, w);

    // The shadow target: baseline clone, then the fixture authority at target-local ids.
    const target = await createTarget(tx);
    const previousIdentity = spec.previousIdentity ?? w.p.path;
    const tP = spec.previousIdentity === undefined ? await targetIdentity(tx, w.p.path, w.p.id) : w.p.id + P.targetPlayerOffset;
    const tPPrime = await targetIdentity(tx, w.pPrime.path, w.pPrime.id);
    const base = P.ledgerIdBase + ctx.caseNo * 10;
    const linkedId = base + 1;
    const correctedId = spec.authority === 'corrected' ? base + 2 : null;
    await insertLedgerRow(tx, T, ctx.caseNo, providerId, w.actorId, {
      id: linkedId, action: 'linked', playerId: tP, playerIdentity: previousIdentity, previousPlayerIdentity: null,
      supersedesId: null, previousState: null,
    });
    const aflApiSource = await targetSourceId(tx, 'afl_api');
    const [resolvedRow] = await tx.unsafe<{ id: string }[]>(`
      INSERT INTO ${T}.external_identities (source_id, external_id, player_id, status, candidate_count, match_method)
      VALUES ($1, $2, $3, 'resolved', 0, 'afl_api_admin_adjudication') RETURNING id::text AS id`,
    [aflApiSource, providerId, spec.authority === 'corrected' ? tPPrime : tP]);
    if (correctedId !== null) {
      await insertLedgerRow(tx, T, ctx.caseNo, providerId, w.actorId, {
        id: correctedId, action: 'corrected', playerId: tPPrime, playerIdentity: w.pPrime.path,
        previousPlayerIdentity: previousIdentity, supersedesId: linkedId,
        previousState: { id: Number(resolvedRow.id), status: 'resolved', playerId: tP },
      });
    }
    return {
      w, providerId, closure, counterpartId, third, otherProviderId,
      ledgerIds: { linked: linkedId, corrected: correctedId }, previousIdentity, target,
    };
  }) as Promise<Built>;
}

/* ==================================================================== *
 * The promotion phases
 * ==================================================================== */

type Names = { environment: 'dev'; candidateDatabase: string; targetDatabase: string };
const defaultNames: Names = { environment: P.environment, candidateDatabase: P.database, targetDatabase: P.targetLabel };

type Restored = {
  report: Report;
  failedGates: string[];
  results: readonly CpcResult[];
  overlap: AflApiOverlapResult;
  corrected: AflApiCorrectedInputs | undefined;
  file: AflApiSupersedeFile | null;
  fileText: string | null;
  filePath: string | null;
  fileSha256: string | null;
};

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** `--phase restored`'s afl_api work, in the checker's order, on candidate + shadow target. */
async function restoredPhase(ctx: Ctx, label: string, names: Names = defaultNames): Promise<Restored> {
  console.log(`\n--- --phase restored (${label}) ---`);
  const report = new Report();
  await gateAflApiRebuildMarker([
    { role: `candidate ${P.database}`, q: ctx.qCand }, { role: `target ${P.targetLabel}`, q: ctx.qTgt },
  ], report);
  const ledgerRows = await readAflApiLedgerRows(ctx.qTgt);
  const entries = netCorrectedCorrectionEntries(ledgerRows);
  const results = entries.length === 0 ? [] : await runAflApiCorrectedPredict(
    ctx.targets.ownerDsn, `s11-corrected-predict:${ctx.code}`, entries, targetHumanProvidersOf(ledgerRows));
  const overlap = await gateAflApiOverlap(
    { candidate: ctx.qCand, target: ctx.qTgt },
    { candidateDatabase: names.candidateDatabase, targetDatabase: names.targetDatabase },
    names.environment, undefined, report, cpcPassSet(results));
  const corrected = entries.length === 0 ? undefined : gateAflApiCorrectedPredict({
    entries, results, ePromotion: overlap.ePromotion, targetLedgerRows: ledgerRows, graded: overlap.ledgerState,
  }, report);
  const failedGates = report.results.filter((r) => r.verdict === 'FAIL').map((r) => r.gate);
  for (const r of results) console.log(`  CPC ${JSON.stringify(r)}`);
  if (failedGates.length > 0) {
    console.log(`  restored REFUSED (${failedGates.length} gate(s) failed): no E_promotion file is written`);
    return { report, failedGates, results, overlap, corrected, file: null, fileText: null, filePath: null, fileSha256: null };
  }
  const built = aflApiSupersedeFileFor(overlap, names, corrected ?? {});
  const fileText = `${JSON.stringify(built, null, 2)}\n`;
  const file = parseAflApiSupersedeFile(fileText, 'Slice-11 v3 artefact'); // the strict parser accepts what is handed on
  const filePath = join(ctx.out, `case-${ctx.code}${ctx.variant ? `-${ctx.variant}` : ''}-${label}.v3.json`);
  mkdirSync(ctx.out, { recursive: true });
  writeFileSync(filePath, fileText, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  const fileSha256 = sha256(fileText);
  console.log(`  v3 artefact ${filePath} sha256 ${fileSha256} (payloadSha256 ${file.payloadSha256}); `
    + `correctedReplays {${file.correctedReplays.map((e) => e.externalId).join(', ')}}; expectedSupersedes {${file.expectedSupersedes.join(', ')}}`);
  return { report, failedGates, results, overlap, corrected, file, fileText, filePath, fileSha256 };
}

/** The plan's reinstatement of the TARGET ledger into the candidate: ids preserved, player_id
 * remapped by the row's own stable identity (the ISSUE-151 staging + remap shape, in one step).
 * `extra` adds further production-only reinstated state (Brownlow entry state) in the same step. */
async function reinstate(ctx: Ctx, extra?: (tx: TransactionSql) => Promise<void>): Promise<number> {
  return ctx.owner.begin(async (tx) => {
    await assertDatabase(tx);
    const rows = await tx.unsafe<{ id: string; playerIdentity: string }[]>(
      `SELECT id::text AS id, player_identity AS "playerIdentity" FROM ${T}.afl_api_identity_adjudications ORDER BY id`);
    for (const row of rows) {
      const remap = await tx.unsafe<{ playerId: number }[]>(`
        SELECT DISTINCT e.player_id AS "playerId" FROM public.external_identities e JOIN public.sources s ON s.id = e.source_id
         WHERE ${ACCEPTED_IDENTITY_SQL} AND e.external_id = $1`, [row.playerIdentity]);
      if (remap.length !== 1) throw new PromotionRehearsalRefused(`reinstatement: ${row.playerIdentity} does not resolve to exactly one candidate player`);
      await tx.unsafe(`
        INSERT INTO public.afl_api_identity_adjudications
          (id, source_key, external_id, action, player_id, player_identity, previous_player_identity, previous_state,
           evidence, evidence_sha256, surname_disagreement_acknowledged, supersedes_id, admin_user_id, note, created_at)
        OVERRIDING SYSTEM VALUE
        SELECT id, source_key, external_id, action, $2, player_identity, previous_player_identity, previous_state,
               evidence, evidence_sha256, surname_disagreement_acknowledged, supersedes_id, admin_user_id, note, created_at
          FROM ${T}.afl_api_identity_adjudications WHERE id = $1`, [row.id, remap[0].playerId]);
    }
    if (extra) await extra(tx);
    return rows.length;
  }) as Promise<number>;
}

type ReplayProvider = {
  externalId: string; adjudicationId: number; result: 'REPLAYED' | 'ALREADY_REPLAYED'; candidateClass: number;
  identityAction: string; moved: number; deleted: number; batchId: number | null; fingerprint: string;
};

type ReplayRun =
  | { kind: 'REPLAYED' | 'ALREADY_REPLAYED' | 'NOTHING_TO_REPLAY'; providers: ReplayProvider[]; ledger: { rowCount: number; sha256: string };
    resolved: number; stdout: string }
  | { kind: 'REFUSED'; message: string; stdout: string; stderr: string };

const REPLAY_KIND = /^ {2}(REPLAYED|ALREADY_REPLAYED|ROLLED_BACK): (\d+) corrected provider\(s\)$/;
const REPLAY_NOTHING = /^ {2}NOTHING_TO_REPLAY: /;
const REPLAY_PROVIDER = /^ {4}(CD_I\d+) \(A (\d+)\): (REPLAYED|ALREADY_REPLAYED), class (\d), (\w+), moved (\d+), deleted (\d+), batch (none|\d+), fingerprint ([0-9a-f]{64})$/;
const REPLAY_LEDGER = /^ {2}ledger (\d+) row\(s\), sha256 ([0-9a-f]{64}) \(unchanged\)$/;
const REPLAY_STATE = /^ {2}importer state (\d+) row\(s\), identity state (\d+) row\(s\), resolved (\d+)$/;

/** Classify one `--replay-promotion` run from its exit status and output, failing closed. */
export function parseReplayOutput(run: { status: number | null; stdout: string; stderr: string }, expectDatabase: string): ReplayRun {
  const malformed = (why: string) => new PromotionRehearsalRefused(`replay CLI output malformed: ${why}`);
  const out = run.stdout.replace(/\r/g, '').split('\n').filter((l) => l.length > 0);
  const err = run.stderr.replace(/\r/g, '').split('\n');
  const refusal = err.find((l) => l.startsWith('REFUSED: '));
  if (run.status !== 0) {
    if (run.status !== 1 || refusal === undefined) throw malformed(`exit ${String(run.status)} without a REFUSED line`);
    if (!err.some((l) => l.includes('nothing was written'))) throw malformed('REFUSED without "nothing was written"');
    if (out.length > 0) throw malformed(`REFUSED with stdout: ${out.join(' | ')}`);
    return { kind: 'REFUSED', message: refusal.slice('REFUSED: '.length), stdout: run.stdout, stderr: run.stderr };
  }
  if (refusal !== undefined) throw malformed('exit 0 with a REFUSED line');
  const header = `  mode replay-promotion, ${P.environment}, database ${expectDatabase}`;
  if (out[0] !== header) throw malformed(`header '${out[0] ?? ''}' is not '${header.trim()}'`);
  const ledgerLine = out.map((l) => REPLAY_LEDGER.exec(l)).filter((m) => m !== null);
  const stateLine = out.map((l) => REPLAY_STATE.exec(l)).filter((m) => m !== null);
  if (ledgerLine.length !== 1 || stateLine.length !== 1) throw malformed('ledger/state lines missing or repeated');
  const ledger = { rowCount: Number(ledgerLine[0]![1]), sha256: ledgerLine[0]![2] };
  const resolved = Number(stateLine[0]![3]);
  if (REPLAY_NOTHING.test(out[1] ?? '')) {
    return { kind: 'NOTHING_TO_REPLAY', providers: [], ledger, resolved, stdout: run.stdout };
  }
  const kind = REPLAY_KIND.exec(out[1] ?? '');
  if (!kind) throw malformed(`outcome line '${out[1] ?? ''}'`);
  if (kind[1] === 'ROLLED_BACK') throw malformed('ROLLED_BACK outside a --dry-run');
  const n = Number(kind[2]);
  const providers: ReplayProvider[] = [];
  for (const line of out.slice(2, 2 + n)) {
    const m = REPLAY_PROVIDER.exec(line);
    if (!m) throw malformed(`provider line '${line}'`);
    providers.push({
      externalId: m[1], adjudicationId: Number(m[2]), result: m[3] as ReplayProvider['result'], candidateClass: Number(m[4]),
      identityAction: m[5], moved: Number(m[6]), deleted: Number(m[7]), batchId: m[8] === 'none' ? null : Number(m[8]), fingerprint: m[9],
    });
  }
  if (providers.length !== n) throw malformed(`announced ${n} provider(s), listed ${providers.length}`);
  return { kind: kind[1] as 'REPLAYED' | 'ALREADY_REPLAYED', providers, ledger, resolved, stdout: run.stdout };
}

/** The REAL `--replay-promotion` CLI as a subprocess. */
function replayCli(
  ctx: Ctx, filePath: string, opts: { dsn?: string; expectDatabase?: string } = {},
): ReplayRun {
  const expectDatabase = opts.expectDatabase ?? P.database;
  const child = spawnSync(process.execPath, [
    TSX_CLI, CORRECTION_CLI, '--replay-promotion', '--supersede-in', filePath, '--environment', P.environment,
    '--expect-database', expectDatabase, '--expect-role', 'afldb_owner',
  ], {
    cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 300_000,
    env: { ...process.env, CANDIDATE_DSN: opts.dsn ?? ctx.targets.ownerDsn },
  });
  if (child.error) throw new PromotionRehearsalRefused(`could not run the replay CLI: ${child.error.message}`);
  const run = parseReplayOutput({ status: child.status, stdout: child.stdout, stderr: child.stderr }, expectDatabase);
  console.log(`\n--- --replay-promotion (exit ${String(child.status)}) ---`);
  for (const line of (run.kind === 'REFUSED' ? run.stderr : run.stdout).replace(/\r/g, '').split('\n')) if (line) console.log(`  | ${redact(line)}`);
  return run;
}

/** `--phase candidate`'s afl_api work: G1 after reinstatement, then CRV when C_promotion is non-empty. */
async function candidatePhase(ctx: Ctx, file: AflApiSupersedeFile): Promise<Report> {
  console.log('\n--- --phase candidate ---');
  const report = new Report();
  await gateAflApiCandidateAfterReinstate(ctx.qCand, file, {
    environment: P.environment, candidateDatabase: file.candidateDatabase, targetDatabase: file.targetDatabase,
  }, report);
  if (file.correctedReplays.length > 0) {
    await withCorrectionSatisfactionReader(ctx.targets.ownerDsn, `s11-crv:${ctx.code}`,
      (reader) => gateAflApiCorrectedReplayVerification(reader, file.correctedReplays, report));
  }
  return report;
}

/* ==================================================================== *
 * Observations of candidate state
 * ==================================================================== */

type IdentityRow = { id: number; status: string; playerId: number | null; matchMethod: string | null; candidateCount: number };

async function identityRow(ctx: Ctx, providerId: string): Promise<IdentityRow | null> {
  const [row] = await ctx.owner<IdentityRow[]>`
    SELECT e.id::int AS id, e.status::text AS status, e.player_id AS "playerId", e.match_method AS "matchMethod",
           e.candidate_count AS "candidateCount"
      FROM external_identities e JOIN sources s ON s.id = e.source_id
     WHERE s.key = 'afl_api' AND e.external_id = ${providerId}
  `;
  return row ?? null;
}

async function replayBatches(ctx: Ctx, providerId: string): Promise<{ id: number; status: string; v: Record<string, unknown> | null }[]> {
  return ctx.owner<{ id: number; status: string; v: Record<string, unknown> | null }[]>`
    SELECT id::int AS id, status::text AS status, validation_result AS v FROM import_batches
     WHERE tool = ${R.correctionTool} AND validation_result->>'externalId' = ${providerId} ORDER BY id
  `;
}

async function applicationsOf(ctx: Ctx, batchId: number): Promise<{ verb: string; targetKey: Record<string, unknown> }[]> {
  return ctx.owner<{ verb: string; targetKey: Record<string, unknown> }[]>`
    SELECT verb::text AS verb, target_key AS "targetKey" FROM canonical_applications WHERE import_batch_id = ${batchId} ORDER BY id
  `;
}

async function pmsRowText(ctx: Ctx, rowId: number): Promise<{ playerId: number; text: string } | null> {
  const [row] = await ctx.owner<{ playerId: number; text: string }[]>`
    SELECT player_id AS "playerId", to_jsonb(x)::text AS text FROM player_match_stats x WHERE id = ${rowId}
  `;
  return row ?? null;
}

async function projectionPlayers(ctx: Ctx, providerId: string): Promise<number[]> {
  const rows = await ctx.owner<{ p: number }[]>`
    SELECT player_id AS p FROM staging.afl_api_player_match WHERE provider_player_id = ${providerId}
     ORDER BY external_record_id, version_seq
  `;
  return rows.map((r) => r.p);
}

async function ledgerState(ctx: Ctx): Promise<{ rowCount: number; sha256: string; corrected: number; text: string }> {
  const rows = await readAflApiLedgerRows(ctx.qCand);
  const [raw] = await ctx.owner<{ t: string | null }[]>`
    SELECT string_agg(to_jsonb(a)::text, E'\n' ORDER BY a.id) AS t FROM afl_api_identity_adjudications a
  `;
  return {
    rowCount: rows.length, sha256: aflApiLedgerStateSha256(rows), corrected: rows.filter((r) => r.action === 'corrected').length,
    text: sha256(raw.t ?? ''),
  };
}

async function dataIssuesFor(ctx: Ctx, providerId: string): Promise<number> {
  const [row] = await ctx.owner<{ n: number }[]>`SELECT count(*)::int AS n FROM data_issues WHERE details->>'external_id' = ${providerId}`;
  return row.n;
}

/** The candidate's importer and whole-identity digests, computed as REPLAY / CRV compute them. */
async function candidateDigests(ctx: Ctx): Promise<{ importer: string; importerRows: number; identity: string }> {
  const view = await readAflApiImporterView(ctx.qCand);
  const playerIds = [...new Set(view.census.filter((r) => r.playerId !== null).map((r) => r.playerId as number))];
  const identities = await readAflApiForwardIdentities(ctx.qCand, playerIds);
  return {
    importer: view.state.sha256, importerRows: view.state.rowCount,
    identity: aflApiIdentityStateSha256(aflApiIdentityStateRowsFromCensus(view.census, identities)),
  };
}

const gatePassed = (report: Report, gate: RegExp) => report.results.some((r) => gate.test(r.gate) && r.verdict === 'PASS');
const gateFailed = (report: Report, gate: RegExp) => report.results.some((r) => gate.test(r.gate) && r.verdict === 'FAIL');
const CPC_GATE = /CPC pre-classification/;
const G1_GATE = /candidate census after target-ledger reinstatement/;
const CRV_GATE = /replay verification \(CRV/;

/* ==================================================================== *
 * Shared case flows
 * ==================================================================== */

function checkCpcPass(ctx: Ctx, r: Restored, providerId: string, want: { cls: 1 | 2 | 3; action: string; moved: number; deleted: number }) {
  const cpc = r.results.find((x) => x.externalId === providerId);
  ctx.check(`CPC: ${providerId} PASS, class ${want.cls}, ${want.action}, moved ${want.moved}/0, deleted ${want.deleted}/0 (pms/brownlow)`,
    cpc?.outcome === 'PASS' && cpc.candidateClass === want.cls && cpc.predictedIdentityAction === want.action
      && cpc.predictedMutations.moved.player_match_stats === want.moved && cpc.predictedMutations.moved.brownlow_round_votes === 0
      && cpc.predictedMutations.deleted.player_match_stats === want.deleted && cpc.predictedMutations.deleted.brownlow_round_votes === 0
      && /^[0-9a-f]{64}$/.test(cpc.predictedClosureFingerprint),
    JSON.stringify(cpc));
  ctx.check('restored: every gate PASSES (rebuild marker, source lineage, G2, G3, CPC) and the v3 artefact is written',
    r.failedGates.length === 0 && r.file !== null && gatePassed(r.report, CPC_GATE), r.failedGates.join(' | '));
  const entry = r.file?.correctedReplays.find((e) => e.externalId === providerId);
  ctx.check('v3: C_promotion = {CD_I}, its entry carries exactly the CPC class/action/plannerVersion/fingerprint/counts',
    r.file !== null && r.file.correctedReplays.length === 1 && entry !== undefined && cpc?.outcome === 'PASS'
      && entry.candidateClass === cpc.candidateClass && entry.predictedIdentityAction === cpc.predictedIdentityAction
      && entry.plannerVersion === cpc.plannerVersion && entry.predictedClosureFingerprint === cpc.predictedClosureFingerprint
      && JSON.stringify(entry.predictedMutations) === JSON.stringify(cpc.predictedMutations)
      && !r.file.expectedSupersedes.includes(providerId),
    JSON.stringify(entry));
  return { cpc: cpc as Extract<CpcResult, { outcome: 'PASS' }>, entry: entry! };
}

function checkCpcFail(ctx: Ctx, r: Restored, providerId: string, cls: number | null, code: string, detail: RegExp) {
  const cpc = r.results.find((x) => x.externalId === providerId);
  ctx.check(`CPC: ${providerId} FAIL ${code}${cls === null ? '' : ` (class ${cls})`}, detail ${detail}`,
    cpc?.outcome === 'FAIL' && cpc.code === code && cpc.candidateClass === cls && detail.test(cpc.detail), JSON.stringify(cpc));
  ctx.check('restored: the CPC gate FAILS, so no v3 artefact exists and nothing can be replayed',
    gateFailed(r.report, CPC_GATE) && r.file === null && r.filePath === null, r.failedGates.join(' | '));
}

/** A replay that must be a REPLAYED single provider. Returns it. */
function checkReplayed(ctx: Ctx, run: ReplayRun, entry: AflApiSupersedeFile['correctedReplays'][number], want: { batch: boolean }): ReplayProvider | null {
  const p = run.kind === 'REPLAYED' ? run.providers[0] : undefined;
  ctx.check(`replay CLI: REPLAYED 1 provider, class ${entry.candidateClass} ${entry.predictedIdentityAction}, `
    + `moved ${entry.predictedMutations.moved.player_match_stats}, deleted ${entry.predictedMutations.deleted.player_match_stats}, `
    + `${want.batch ? 'one bound batch' : 'no batch'}, fingerprint = the artefact's`,
  run.kind === 'REPLAYED' && run.providers.length === 1 && p !== undefined && p.result === 'REPLAYED'
      && p.externalId === entry.externalId && p.adjudicationId === entry.adjudicationId
      && p.candidateClass === entry.candidateClass && p.identityAction === entry.predictedIdentityAction
      && p.moved === entry.predictedMutations.moved.player_match_stats + entry.predictedMutations.moved.brownlow_round_votes
      && p.deleted === entry.predictedMutations.deleted.player_match_stats + entry.predictedMutations.deleted.brownlow_round_votes
      && (want.batch ? p.batchId !== null : p.batchId === null) && p.fingerprint === entry.predictedClosureFingerprint,
  JSON.stringify(run.kind === 'REFUSED' ? run.message : run.kind === 'REPLAYED' ? run.providers : run.kind));
  return p ?? null;
}

async function checkIdentityAtPPrime(ctx: Ctx, built: Built, label: string, sameRowId: number | null) {
  const row = await identityRow(ctx, built.providerId);
  ctx.check(`${label}: CD_I is resolved/afl_api_admin_adjudication at P′${sameRowId === null ? '' : ` (the same row #${sameRowId})`}`,
    row !== null && row.status === 'resolved' && row.matchMethod === 'afl_api_admin_adjudication' && row.playerId === built.w.pPrime.id
      && (sameRowId === null || row.id === sameRowId),
    JSON.stringify(row));
}

async function checkCandidatePhasePass(ctx: Ctx, file: AflApiSupersedeFile) {
  const report = await candidatePhase(ctx, file);
  ctx.check('candidate phase: G1 after reinstatement PASSES (resolved = net-corrected = C_promotion; predicted post-replay importer/identity state; E_promotion reproduced)',
    gatePassed(report, G1_GATE) && !gateFailed(report, G1_GATE), JSON.stringify(report.results.map((r) => [r.gate, r.verdict])));
  if (file.correctedReplays.length > 0) {
    ctx.check('candidate phase: CRV PASSES (identity row, bound replay batch as predicted, Q2 CORRECTION SATISFACTION)',
      gatePassed(report, CRV_GATE) && !gateFailed(report, CRV_GATE), JSON.stringify(report.results.map((r) => [r.gate, r.verdict])));
  }
  return report;
}

/** The whole happy path for one corrected provider: restored -> reinstate -> REPLAY -> candidate. */
async function happyReplay(ctx: Ctx, built: Built, want: { cls: 1 | 2 | 3; action: string; moved: number; deleted: number },
  hooks: { afterReinstate?: (tx: TransactionSql) => Promise<void> } = {},
) {
  const r = await restoredPhase(ctx, 'restored');
  const { cpc, entry } = checkCpcPass(ctx, r, built.providerId, want);
  const digestsBefore = await candidateDigests(ctx);
  ctx.check('v3: predicted post-replay importer state is computed from the candidate the gates read (pre-replay digest recorded)',
    r.file!.candidateImporterSha256 === digestsBefore.importer, `${r.file!.candidateImporterSha256} vs ${digestsBefore.importer}`);
  const reinstated = await reinstate(ctx, hooks.afterReinstate);
  ctx.check('reinstatement: the target ledger rows are in the candidate, ids preserved, whole-ledger digest = the artefact\'s targetLedgerSha256',
    reinstated === r.file!.targetLedgerRowCount && (await ledgerState(ctx)).sha256 === r.file!.targetLedgerSha256, String(reinstated));
  const ledgerBefore = await ledgerState(ctx);
  const run = replayCli(ctx, r.filePath!);
  const provider = checkReplayed(ctx, run, entry, { batch: want.moved + want.deleted > 0 });
  const ledgerAfter = await ledgerState(ctx);
  ctx.check('replay: the adjudication ledger is byte-identical (count, digest, full row text); no second corrected row',
    ledgerAfter.rowCount === ledgerBefore.rowCount && ledgerAfter.sha256 === ledgerBefore.sha256 && ledgerAfter.text === ledgerBefore.text
      && ledgerAfter.corrected === 1 && run.kind === 'REPLAYED' && run.ledger.sha256 === ledgerBefore.sha256,
    JSON.stringify({ ledgerBefore, ledgerAfter }));
  ctx.check('replay: no data_issues row for CD_I (outside the REPLAY write allow-list)', await dataIssuesFor(ctx, built.providerId) === 0);
  return { r, cpc, entry, run, provider, ledgerBefore };
}

/* ==================================================================== *
 * The cases
 * ==================================================================== */

/** Case 33 (promotion portion only): zero-corrected. The target holds one net-LINKED provider that
 * AGREEs with the candidate importer row; C_promotion is empty. */
async function case33(ctx: Ctx): Promise<void> {
  const built = await buildWorld(ctx, { candidate: 'at-p', closure: 'none', authority: 'linked' });
  const r = await restoredPhase(ctx, 'restored');
  ctx.check('restored: every gate PASSES; CPC is not run (no net-corrected provider)', r.failedGates.length === 0 && r.results.length === 0,
    r.failedGates.join(' | '));
  ctx.check('v3: correctedReplays = [], the corrected-ledger subset is empty, E_promotion = {CD_I} (G2 AGREE)',
    r.file !== null && r.file.correctedReplays.length === 0 && r.file.targetCorrectedLedgerRowCount === 0
      && JSON.stringify(r.file.expectedSupersedes) === JSON.stringify([built.providerId]), JSON.stringify(r.file?.expectedSupersedes));
  const pre = await candidateDigests(ctx);
  ctx.check('v3: zero-corrected prediction = the pre-replay state (importer digest and rows)',
    r.file!.predictedPostReplayImporterSha256 === r.file!.candidateImporterSha256 && r.file!.candidateImporterSha256 === pre.importer
      && r.file!.predictedPostReplayImporterRowCount === pre.importerRows && r.file!.predictedPostReplayIdentitySha256 === pre.identity);
  await reinstate(ctx);
  const fixtureBefore = await fixtureDigest(ctx.owner);
  const run = replayCli(ctx, r.filePath!);
  ctx.check('replay CLI: NOTHING_TO_REPLAY, exit 0, the ledger line names the reinstated 1-row ledger',
    run.kind === 'NOTHING_TO_REPLAY' && run.ledger.rowCount === 1 && run.resolved === 0, run.kind);
  ctx.check('replay: no correction mutation at all (every fixture row byte-identical, no correction batch)',
    await fixtureDigest(ctx.owner) === fixtureBefore && (await replayBatches(ctx, built.providerId)).length === 0);
  const post = await candidateDigests(ctx);
  ctx.check('post-replay importer and whole-identity digests = the artefact\'s predictions',
    post.importer === r.file!.predictedPostReplayImporterSha256 && post.identity === r.file!.predictedPostReplayIdentitySha256
      && post.importerRows === r.file!.predictedPostReplayImporterRowCount);
  await checkCandidatePhasePass(ctx, r.file!);
  const row = await identityRow(ctx, built.providerId);
  ctx.check('CD_I is still the importer row at P (the net-linked provider is D15\'s, post-swap; not claimed here)',
    row?.status === 'unique' && row.playerId === built.w.p.id, JSON.stringify(row));
}

/** Case 34: CPC class 1 (candidate importer row at Pc) with a one-row player_match_stats MOVE. */
async function case34(ctx: Ctx): Promise<void> {
  const built = await buildWorld(ctx, { candidate: 'at-p', closure: 'pms', authority: 'corrected' });
  const before = await identityRow(ctx, built.providerId);
  const { r, provider } = await happyReplay(ctx, built, { cls: 1, action: 'update_in_place', moved: 1, deleted: 0 });
  await checkIdentityAtPPrime(ctx, built, 'replay', before?.id ?? -1);
  const row = await pmsRowText(ctx, built.closure!.rowId);
  ctx.check('replay: the closure row MOVED to P′ (same row id)', row?.playerId === built.w.pPrime.id, JSON.stringify(row?.playerId));
  ctx.check('replay: CD_I\'s typed projection names P′', JSON.stringify(await projectionPlayers(ctx, built.providerId)) === JSON.stringify([built.w.pPrime.id]));
  const batches = await replayBatches(ctx, built.providerId);
  ctx.check('replay: exactly one bound promotion batch, completed, mode replay, context promotion',
    batches.length === 1 && batches[0].id === provider?.batchId && batches[0].status === 'completed'
      && batches[0].v?.mode === 'replay' && batches[0].v?.context === 'promotion', JSON.stringify(batches));
  await checkCandidatePhasePass(ctx, r.file!);
}

/** Case 35: CPC class 2 (importer-shaped row already at P′c): identity-only upgrade, no batch. */
async function case35(ctx: Ctx): Promise<void> {
  const built = await buildWorld(ctx, { candidate: 'at-pprime', closure: 'none', authority: 'corrected' });
  const before = await identityRow(ctx, built.providerId);
  const { r } = await happyReplay(ctx, built, { cls: 2, action: 'upgrade_in_place', moved: 0, deleted: 0 });
  await checkIdentityAtPPrime(ctx, built, 'replay (upgrade in place)', before?.id ?? -1);
  ctx.check('replay: no correction batch for a zero-row closure', (await replayBatches(ctx, built.providerId)).length === 0);
  await checkCandidatePhasePass(ctx, r.file!);
}

/** Case 36: class 3. absent-clean: provider absent, nothing implicates it -> insert, identity-only;
 * still-implicated: provider absent but a candidate row still implicates CD_I at Pc -> CPC FAIL. */
async function case36(ctx: Ctx): Promise<void> {
  if (ctx.variant === 'absent-clean') {
    const built = await buildWorld(ctx, { candidate: 'absent', closure: 'none', authority: 'corrected' });
    ctx.check('pre: the candidate holds no CD_I identity row', await identityRow(ctx, built.providerId) === null);
    const { r } = await happyReplay(ctx, built, { cls: 3, action: 'insert', moved: 0, deleted: 0 });
    await checkIdentityAtPPrime(ctx, built, 'replay (insert)', null);
    ctx.check('replay: no correction batch (identity-only)', (await replayBatches(ctx, built.providerId)).length === 0);
    await checkCandidatePhasePass(ctx, r.file!);
    return;
  }
  const built = await buildWorld(ctx, { candidate: 'absent', closure: 'pms', authority: 'corrected' });
  const fixtureBefore = await fixtureDigest(ctx.owner);
  const r = await restoredPhase(ctx, 'restored');
  checkCpcFail(ctx, r, built.providerId, 3, 'PC_STILL_IMPLICATED', /^1 candidate row\(s\) implicate CD_I at Pc; unprovable lineage=false$/);
  ctx.check('no write: the candidate fixture state is byte-identical after the restored phase',
    await fixtureDigest(ctx.owner) === fixtureBefore && await identityRow(ctx, built.providerId) === null);
}

/** Case 37: DISAGREE — the candidate row is at a third identity. */
async function case37(ctx: Ctx): Promise<void> {
  const built = await buildWorld(ctx, { candidate: 'at-third', closure: 'none', authority: 'corrected' });
  const fixtureBefore = await fixtureDigest(ctx.owner);
  const r = await restoredPhase(ctx, 'restored');
  checkCpcFail(ctx, r, built.providerId, 4, 'DISAGREE',
    new RegExp(`is at player ${built.third!.id}, neither Pc ${built.w.p.id} nor P'c ${built.w.pPrime.id}$`));
  ctx.check('no write: the candidate fixture state is byte-identical', await fixtureDigest(ctx.owner) === fixtureBefore);
}

/** Case 38: COLLISION — another provider already holds P′c in the candidate. */
async function case38(ctx: Ctx): Promise<void> {
  const built = await buildWorld(ctx, { candidate: 'at-p', closure: 'none', authority: 'corrected', otherProviderAtPPrime: true });
  const fixtureBefore = await fixtureDigest(ctx.owner);
  const r = await restoredPhase(ctx, 'restored');
  checkCpcFail(ctx, r, built.providerId, 5, 'COLLISION', new RegExp(`candidate importer provider\\(s\\) at P'c: ${built.otherProviderId}$`));
  ctx.check('no write: the candidate fixture state is byte-identical', await fixtureDigest(ctx.owner) === fixtureBefore);
}

/** Case 39: the bound v3 prediction equals the actual replay (fingerprint, counts, importer and
 * whole-identity digests, CRV). */
async function case39(ctx: Ctx): Promise<void> {
  const built = await buildWorld(ctx, { candidate: 'at-p', closure: 'pms', authority: 'corrected' });
  const { r, cpc, entry, provider } = await happyReplay(ctx, built, { cls: 1, action: 'update_in_place', moved: 1, deleted: 0 });
  const batches = await replayBatches(ctx, built.providerId);
  const v = batches[0]?.v ?? null;
  const counts = (v?.counts ?? null) as { moved?: unknown; deleted?: unknown } | null;
  ctx.check('fingerprint: CPC = artefact = REPLAY = bound batch closureFingerprint = predictedClosureFingerprint',
    provider !== null && cpc.predictedClosureFingerprint === entry.predictedClosureFingerprint
      && provider.fingerprint === entry.predictedClosureFingerprint && v?.closureFingerprint === entry.predictedClosureFingerprint
      && v?.predictedClosureFingerprint === entry.predictedClosureFingerprint, JSON.stringify(v));
  ctx.check('counts: predicted mutations = REPLAY counts = bound batch counts',
    provider !== null && provider.moved === 1 && provider.deleted === 0
      && JSON.stringify(counts?.moved) === JSON.stringify(entry.predictedMutations.moved)
      && JSON.stringify(counts?.deleted) === JSON.stringify(entry.predictedMutations.deleted), JSON.stringify(counts));
  const post = await candidateDigests(ctx);
  ctx.check('post-replay importer digest/rows = the artefact\'s predictedPostReplayImporter*',
    post.importer === r.file!.predictedPostReplayImporterSha256 && post.importerRows === r.file!.predictedPostReplayImporterRowCount,
    JSON.stringify({ post, predicted: r.file!.predictedPostReplayImporterSha256 }));
  ctx.check('post-replay whole afl_api identity digest = the artefact\'s predictedPostReplayIdentitySha256',
    post.identity === r.file!.predictedPostReplayIdentitySha256);
  await checkCandidatePhasePass(ctx, r.file!);
}

/** Case 40: a valid artefact that no longer binds. divergent: a second CD_I closure row appears on
 * the candidate after §6 (the state diverges); tampered: one artefact field is edited in place. */
async function case40(ctx: Ctx): Promise<void> {
  const built = await buildWorld(ctx, { candidate: 'at-p', closure: 'pms', authority: 'corrected' });
  const r = await restoredPhase(ctx, 'restored');
  const { entry } = checkCpcPass(ctx, r, built.providerId, { cls: 1, action: 'update_in_place', moved: 1, deleted: 0 });
  await reinstate(ctx);
  let filePath = r.filePath!;
  if (ctx.variant === 'divergent') {
    await ctx.owner.begin(async (tx) => {
      await assertDatabase(tx);
      await pmsClosureRow(tx, built.w, 2); // a second settle through CD_I at P, after the prediction
    });
    console.log('  deliberate divergence: a second CD_I closure row (match 2) was settled at P after --phase restored');
  } else {
    const tampered = r.fileText!.replace(entry.predictedClosureFingerprint, entry.predictedClosureFingerprint.replace(/^./, (c) => (c === '0' ? '1' : '0')));
    filePath = join(ctx.out, `case-${ctx.code}-tampered.v3.json`);
    writeFileSync(filePath, tampered, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    console.log(`  deliberate tamper: ${filePath} sha256 ${sha256(tampered)} (predictedClosureFingerprint edited, payload hash NOT recomputed)`);
  }
  const before = { fixture: await fixtureDigest(ctx.owner), ledger: await ledgerState(ctx), identity: await identityRow(ctx, built.providerId) };
  const run = replayCli(ctx, filePath);
  if (ctx.variant === 'divergent') {
    ctx.check('replay CLI: REFUSED at §7.4e — the closure fingerprint and the mutation counts differ from the artefact',
      run.kind === 'REFUSED' && run.message.includes(`${built.providerId}: `) && run.message.includes('closure fingerprint')
        && run.message.includes('mutation counts differ from the artefact predictedMutations'), run.kind === 'REFUSED' ? run.message : run.kind);
  } else {
    ctx.check('replay CLI: REFUSED by the strict v3 parser (payload hash) before any connection',
      run.kind === 'REFUSED' && run.message.includes('payloadSha256 does not match the file content'),
      run.kind === 'REFUSED' ? run.message : run.kind);
  }
  ctx.check('no write: fixture state, ledger and CD_I identity are byte-identical; no correction batch',
    await fixtureDigest(ctx.owner) === before.fixture && JSON.stringify(await ledgerState(ctx)) === JSON.stringify(before.ledger)
      && JSON.stringify(await identityRow(ctx, built.providerId)) === JSON.stringify(before.identity)
      && (await replayBatches(ctx, built.providerId)).length === 0);
  const report = await candidatePhase(ctx, r.file!);
  ctx.check('candidate phase (§7.5) also STOPs: G1 FAILS (no resolved row for the C_promotion provider)', gateFailed(report, G1_GATE));
}

/** Case 41: a canonical collision DELETE through a real promotion batch. */
async function case41(ctx: Ctx): Promise<void> {
  const built = await buildWorld(ctx, { candidate: 'at-p', closure: 'pms-foreign-collision', authority: 'corrected' });
  const counterpartBefore = await pmsRowText(ctx, built.counterpartId!);
  const { r, provider } = await happyReplay(ctx, built, { cls: 1, action: 'update_in_place', moved: 0, deleted: 1 });
  const batches = await replayBatches(ctx, built.providerId);
  ctx.check('replay: one and only one promotion batch, completed, bound to the artefact (mode, context, adjudication, fingerprint)',
    batches.length === 1 && batches[0].id === provider?.batchId && batches[0].status === 'completed'
      && batches[0].v?.mode === 'replay' && batches[0].v?.context === 'promotion'
      && batches[0].v?.adjudicationId === built.ledgerIds.corrected
      && batches[0].v?.closureFingerprint === r.file!.correctedReplays[0].predictedClosureFingerprint, JSON.stringify(batches));
  const apps = batches.length === 1 ? await applicationsOf(ctx, batches[0].id) : [];
  ctx.check('replay: exactly one canonical_applications row for the batch, a delete at the closure key (P, M)',
    apps.length === 1 && apps[0].verb === 'delete' && apps[0].targetKey.player_id === built.w.p.id && apps[0].targetKey.match_id === built.closure!.matchId,
    JSON.stringify(apps));
  ctx.check('replay: the closure row is deleted', await pmsRowText(ctx, built.closure!.rowId) === null);
  const counterpartAfter = await pmsRowText(ctx, built.counterpartId!);
  ctx.check('replay: the foreign P′ counterpart is byte-identical', JSON.stringify(counterpartAfter) === JSON.stringify(counterpartBefore),
    JSON.stringify({ before: counterpartBefore, after: counterpartAfter }));
  ctx.check('replay: CD_I\'s typed projection moved to P′', JSON.stringify(await projectionPlayers(ctx, built.providerId)) === JSON.stringify([built.w.pPrime.id]));
  await checkIdentityAtPPrime(ctx, built, 'replay', null);
  await checkCandidatePhasePass(ctx, r.file!);
}

/** Case 42: REPLAY never adjudicates (a replay with a batch, so a write DID happen elsewhere). */
async function case42(ctx: Ctx): Promise<void> {
  const built = await buildWorld(ctx, { candidate: 'at-p', closure: 'pms', authority: 'corrected' });
  const { r, ledgerBefore } = await happyReplay(ctx, built, { cls: 1, action: 'update_in_place', moved: 1, deleted: 0 });
  const after = await ledgerState(ctx);
  const [rows] = await ctx.owner<{ corrected: number; forProvider: number; correctedId: string | null }[]>`
    SELECT count(*) FILTER (WHERE action = 'corrected')::int AS corrected,
           count(*) FILTER (WHERE external_id = ${built.providerId})::int AS "forProvider",
           max(id) FILTER (WHERE action = 'corrected')::text AS "correctedId"
      FROM afl_api_identity_adjudications
  `;
  ctx.check('ledger: row count, whole-ledger digest and full row text unchanged by the replay',
    after.rowCount === ledgerBefore.rowCount && after.sha256 === ledgerBefore.sha256 && after.text === ledgerBefore.text,
    JSON.stringify({ ledgerBefore, after }));
  ctx.check('ledger: exactly the pre-existing corrected authority row remains; no additional corrected row',
    rows.corrected === 1 && rows.forProvider === 2 && Number(rows.correctedId) === built.ledgerIds.corrected, JSON.stringify(rows));
  await checkCandidatePhasePass(ctx, r.file!);
}

/** Case 43: a repeated replay of the same artefact is a no-op. */
async function case43(ctx: Ctx): Promise<void> {
  const built = await buildWorld(ctx, { candidate: 'at-p', closure: 'pms', authority: 'corrected' });
  const { r } = await happyReplay(ctx, built, { cls: 1, action: 'update_in_place', moved: 1, deleted: 0 });
  const snapshot = { fixture: await fixtureDigest(ctx.owner), batches: await replayBatches(ctx, built.providerId), ledger: await ledgerState(ctx) };
  const second = replayCli(ctx, r.filePath!);
  const p = second.kind === 'ALREADY_REPLAYED' ? second.providers[0] : undefined;
  ctx.check('second replay: ALREADY_REPLAYED, moved 0, deleted 0, no batch',
    second.kind === 'ALREADY_REPLAYED' && second.providers.length === 1 && p?.result === 'ALREADY_REPLAYED'
      && p.moved === 0 && p.deleted === 0 && p.batchId === null, JSON.stringify(second.kind === 'REFUSED' ? second.message : second));
  ctx.check('second replay: every fixture row byte-identical (identity, canonical rows, projections, applications, batches)',
    await fixtureDigest(ctx.owner) === snapshot.fixture);
  ctx.check('second replay: no new batch, ledger unchanged',
    JSON.stringify(await replayBatches(ctx, built.providerId)) === JSON.stringify(snapshot.batches)
      && JSON.stringify(await ledgerState(ctx)) === JSON.stringify(snapshot.ledger));
  await checkCandidatePhasePass(ctx, r.file!);
}

/** Case 63: the REPLAY guards refuse before any write — wrong role, a database binding mismatch —
 * and the pure guards refuse live and pre_rebuild names without any connection. */
async function case63(ctx: Ctx): Promise<void> {
  const built = await buildWorld(ctx, { candidate: 'at-p', closure: 'none', authority: 'corrected' });
  const r = await restoredPhase(ctx, 'restored');
  checkCpcPass(ctx, r, built.providerId, { cls: 1, action: 'update_in_place', moved: 0, deleted: 0 });
  await reinstate(ctx);
  const before = { fixture: await fixtureDigest(ctx.owner), foreign: await foreignFingerprint(ctx.owner) };

  const wrongRole = replayCli(ctx, r.filePath!, { dsn: ctx.targets.importDsn });
  ctx.check('(1) CANDIDATE_DSN = the import role on code_test_db: REFUSED "session role is \'afldb_import\', not \'afldb_owner\'"',
    wrongRole.kind === 'REFUSED' && wrongRole.message.includes("session role is 'afldb_import', not 'afldb_owner'"),
    wrongRole.kind === 'REFUSED' ? wrongRole.message : wrongRole.kind);

  const otherCandidate = 'afldb_dev_candidate_20990101000000';
  const wrongExpect = replayCli(ctx, r.filePath!, { expectDatabase: otherCandidate });
  ctx.check(`(2a) --expect-database ${otherCandidate} against a code_test_db artefact: REFUSED by the guard before any connection`,
    wrongExpect.kind === 'REFUSED' && wrongExpect.message.includes(`database '${otherCandidate}' is not the artefact candidateDatabase '${P.database}'`),
    wrongExpect.kind === 'REFUSED' ? wrongExpect.message : wrongExpect.kind);

  // The same restored-phase inputs, bound by the real builder to another candidate name (a second
  // restored run is impossible here: the candidate already holds the reinstated ledger).
  const foreignNames: Names = { environment: P.environment, candidateDatabase: otherCandidate, targetDatabase: P.targetLabel };
  const otherText = `${JSON.stringify(aflApiSupersedeFileFor(r.overlap, foreignNames, r.corrected ?? {}), null, 2)}\n`;
  parseAflApiSupersedeFile(otherText, 'Slice-11 v3 artefact (other candidate)');
  const otherPath = join(ctx.out, `case-${ctx.code}-other-candidate.v3.json`);
  writeFileSync(otherPath, otherText, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  console.log(`  v3 artefact ${otherPath} sha256 ${sha256(otherText)} (bound to candidate ${otherCandidate})`);
  const wrongFile = replayCli(ctx, otherPath);
  ctx.check(`(2b) an artefact bound to candidate ${otherCandidate}, run with --expect-database ${P.database}: REFUSED`,
    wrongFile.kind === 'REFUSED' && wrongFile.message.includes(`database '${P.database}' is not the artefact candidateDatabase '${otherCandidate}'`),
    wrongFile.kind === 'REFUSED' ? wrongFile.message : wrongFile.kind);

  const artefact = r.file!;
  const pure = (expectDatabase: string) => replayPromotionGuardProblems({
    environment: 'dev', expectDatabase, expectRole: 'afldb_owner', artefact: { ...artefact, candidateDatabase: expectDatabase },
  });
  const live = pure('afldb_dev');
  const prod = pure('afldb_prod');
  const preRebuild = pure('afldb_dev_pre_rebuild_20990101');
  ctx.check('(3) pure guard: afldb_dev and afldb_prod are refused as live databases, a pre_rebuild name as pre_rebuild (no connection)',
    live.some((p) => p.includes("'afldb_dev' is a live database")) && prod.some((p) => p.includes("'afldb_prod' is a live database"))
      && preRebuild.some((p) => p.includes('is a pre_rebuild database')), JSON.stringify({ live, prod, preRebuild }));
  let dsnRefusal = '';
  try {
    resolveCandidateDsn({ CANDIDATE_DSN: ctx.targets.ownerDsn }, 'afldb_dev');
  } catch (error) {
    dsnRefusal = (error as Error).message;
  }
  ctx.check('(3) pure guard: a CANDIDATE_DSN naming code_test_db is refused for --expect-database afldb_dev',
    dsnRefusal === 'CANDIDATE_DSN does not target /afldb_dev -- refusing', dsnRefusal);

  ctx.check('no write on any refusal path: fixture state and foreign fingerprint identical; CD_I still the importer row at P; no batch',
    await fixtureDigest(ctx.owner) === before.fixture && fingerprintDiff(before.foreign, await foreignFingerprint(ctx.owner)).length === 0
      && (await identityRow(ctx, built.providerId))?.status === 'unique' && (await replayBatches(ctx, built.providerId)).length === 0);
}

/** Case 64: CPC predicts success at §6, but the reinstated brownlow_vote_entry_state names P -> STOP at §7.4e (BG3). */
async function case64(ctx: Ctx): Promise<void> {
  const built = await buildWorld(ctx, { candidate: 'at-p', closure: 'pms', authority: 'corrected' });
  const r = await restoredPhase(ctx, 'restored');
  checkCpcPass(ctx, r, built.providerId, { cls: 1, action: 'update_in_place', moved: 1, deleted: 0 });
  await reinstate(ctx, async (tx) => {
    const a = await fixturePlayer(tx, built.w, 'A');
    const b = await fixturePlayer(tx, built.w, 'B');
    await entryState(tx, built.w, built.closure!.matchId, { three: built.w.p.id, two: a.id, one: b.id });
  });
  const before = {
    identity: await identityRow(ctx, built.providerId), row: await pmsRowText(ctx, built.closure!.rowId),
    projection: await projectionPlayers(ctx, built.providerId), ledger: await ledgerState(ctx),
  };
  const run = replayCli(ctx, r.filePath!);
  ctx.check('replay CLI: REFUSED at §7.4e — CPC now STOPs on BG3 brownlow_entry_names_player (PREDICT_STOP, class 6)',
    run.kind === 'REFUSED' && run.message.includes(`${built.providerId}: CPC FAIL PREDICT_STOP (class 6)`)
      && run.message.includes('brownlow_entry_names_player'), run.kind === 'REFUSED' ? run.message : run.kind);
  ctx.check('no write: no promotion batch, no correction application, identity/canonical row/projection/ledger unchanged',
    (await replayBatches(ctx, built.providerId)).length === 0
      && JSON.stringify(await identityRow(ctx, built.providerId)) === JSON.stringify(before.identity)
      && JSON.stringify(await pmsRowText(ctx, built.closure!.rowId)) === JSON.stringify(before.row)
      && JSON.stringify(await projectionPlayers(ctx, built.providerId)) === JSON.stringify(before.projection)
      && JSON.stringify(await ledgerState(ctx)) === JSON.stringify(before.ledger));
}

/** Case 65: post-swap D15 finds its C_promotion provider NOT satisfied: the real
 * `replayAflApiAdjudicationsFromSupersedeFile` hard-STOPs before writing. The artefact binds
 * `code_test_db` as the target (the promoted live database of this isolated proof); the promoted
 * state has the reinstated ledger but REPLAY never ran, so CD_I is still an importer row at P. */
async function case65(ctx: Ctx): Promise<void> {
  const built = await buildWorld(ctx, { candidate: 'at-p', closure: 'none', authority: 'corrected' });
  const names: Names = { environment: P.environment, candidateDatabase: 'issue238_s11_promoted_candidate', targetDatabase: P.database };
  const r = await restoredPhase(ctx, 'restored-post-swap-binding', names);
  checkCpcPass(ctx, r, built.providerId, { cls: 1, action: 'update_in_place', moved: 0, deleted: 0 });
  await reinstate(ctx);
  const before = { fixture: await fixtureDigest(ctx.owner), ledger: await ledgerState(ctx) };
  let stop = '';
  class Rollback extends Error {}
  try {
    await ctx.owner.begin(async (tx) => {
      await assertDatabase(tx);
      try {
        await replayAflApiAdjudicationsFromSupersedeFile(tx, r.fileText!, { environment: 'dev', targetDatabase: P.database });
        stop = 'D15 RETURNED (no stop)';
      } catch (error) {
        stop = (error as Error).message;
      }
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  console.log(`  D15 stop: ${stop}`);
  const stoppedBy = stop.includes('post_replay_importer_state_mismatch') ? 'the post-replay importer-state binding'
    : stop.includes('post_replay_identity_state_mismatch') ? 'the post-replay identity-state binding' : 'another check';
  ctx.check(`D15 (replayAflApiAdjudicationsFromSupersedeFile) hard-STOPs before writing: refused by ${stoppedBy} `
    + '(the wrapper\'s bound-state check, reached before the inner ALREADY_SATISFIED exact set)',
  stop.startsWith('refusing the E_promotion file: it is not bound to this promoted database state, nothing written')
      && (stop.includes('post_replay_importer_state_mismatch') || stop.includes('post_replay_identity_state_mismatch')), stop);
  ctx.check('no write: ledger and every fixture row unchanged; CD_I still the importer row at P',
    await fixtureDigest(ctx.owner) === before.fixture && JSON.stringify(await ledgerState(ctx)) === JSON.stringify(before.ledger)
      && (await identityRow(ctx, built.providerId))?.status === 'unique');
}

/** Case 80: the closure fingerprint is stable §6 -> §7.4e when only context changes: BG3 has no
 * entry state to read at §6 (production-only, reinstated later) and passes at §7.4e (the
 * reinstated entry state names three other players). */
async function case80(ctx: Ctx): Promise<void> {
  const built = await buildWorld(ctx, { candidate: 'at-p', closure: 'pms', authority: 'corrected' });
  const r = await restoredPhase(ctx, 'restored');
  const { cpc, entry } = checkCpcPass(ctx, r, built.providerId, { cls: 1, action: 'update_in_place', moved: 1, deleted: 0 });
  const [pre] = await ctx.owner<{ n: number }[]>`SELECT count(*)::int AS n FROM brownlow_vote_entry_state WHERE match_id = ${built.closure!.matchId}`;
  ctx.check('§6 context: M has no brownlow_vote_entry_state on the candidate (BG3 has nothing to evaluate)', pre.n === 0);
  await reinstate(ctx, async (tx) => {
    const a = await fixturePlayer(tx, built.w, 'A');
    const b = await fixturePlayer(tx, built.w, 'B');
    const c = await fixturePlayer(tx, built.w, 'C');
    await entryState(tx, built.w, built.closure!.matchId, { three: a.id, two: b.id, one: c.id });
  });
  const ledgerRows = await readAflApiLedgerRows(ctx.qTgt);
  const again = await runAflApiCorrectedPredict(ctx.targets.ownerDsn, `s11-corrected-predict-again:${ctx.code}`,
    netCorrectedCorrectionEntries(ledgerRows), targetHumanProvidersOf(ledgerRows));
  const cpc2 = again.find((x) => x.externalId === built.providerId);
  ctx.check('§7.4e context: the real CPC re-run (entry state present, not naming P) PASSES with the SAME fingerprint, class, action and counts',
    cpc2?.outcome === 'PASS' && cpc2.predictedClosureFingerprint === cpc.predictedClosureFingerprint
      && cpc2.candidateClass === cpc.candidateClass && cpc2.predictedIdentityAction === cpc.predictedIdentityAction
      && JSON.stringify(cpc2.predictedMutations) === JSON.stringify(cpc.predictedMutations), JSON.stringify(cpc2));
  const run = replayCli(ctx, r.filePath!);
  checkReplayed(ctx, run, entry, { batch: true });
  await checkCandidatePhasePass(ctx, r.file!);
}

/** Case 86: previous_player_identity unresolvable — the candidate CPC is UNEVALUABLE; on a live
 * target, Q2 STOPs `identity_unresolvable` rather than remapping or guessing. */
async function case86(ctx: Ctx): Promise<void> {
  const gone = `${R.pathPrefix}${String(ctx.caseNo).padStart(3, '0')}_Gone.html`;
  const built = await buildWorld(ctx, { candidate: 'at-p', closure: 'none', authority: 'corrected', previousIdentity: gone });
  const fixtureBefore = await fixtureDigest(ctx.owner);
  const r = await restoredPhase(ctx, 'restored');
  checkCpcFail(ctx, r, built.providerId, null, 'UNEVALUABLE', /^Pc: unresolved$/);
  ctx.check('candidate side: no write (fixture state byte-identical)', await fixtureDigest(ctx.owner) === fixtureBefore);

  // The live-target side: the corrected authority as a live database holds it (ledger + resolved
  // row at P′), whose previous identity resolves to no player there. Q2 through the real census gate.
  await ctx.owner.begin(async (tx) => {
    await assertDatabase(tx);
    await insertLedgerRow(tx, 'public', ctx.caseNo, built.providerId, built.w.actorId, {
      id: built.ledgerIds.linked, action: 'linked', playerId: built.w.p.id, playerIdentity: gone, previousPlayerIdentity: null,
      supersedesId: null, previousState: null,
    });
    const [row] = await tx<{ id: string }[]>`
      UPDATE external_identities SET status = 'resolved', match_method = 'afl_api_admin_adjudication', candidate_count = 0,
             external_name = NULL, player_id = ${built.w.pPrime.id}
       WHERE external_id = ${built.providerId} AND source_id = ${built.w.sourceIds.aflApi} RETURNING id::text AS id`;
    await insertLedgerRow(tx, 'public', ctx.caseNo, built.providerId, built.w.actorId, {
      id: built.ledgerIds.corrected!, action: 'corrected', playerId: built.w.pPrime.id, playerIdentity: built.w.pPrime.path,
      previousPlayerIdentity: gone, supersedesId: built.ledgerIds.linked,
      previousState: { id: Number(row.id), status: 'unique', playerId: built.w.p.id },
    });
  });
  const liveBefore = await fixtureDigest(ctx.owner);
  const report = new Report();
  const corrected = netCorrectedEntries(await readAflApiLedgerRows(ctx.qCand));
  await withCorrectionSatisfactionReader(ctx.targets.ownerDsn, `s11-q2-live:${ctx.code}`,
    (reader) => gateAflApiCorrectedCensus(reader, corrected, report));
  const q2 = report.results.find((x) => /pre-cutover satisfaction census/.test(x.gate));
  ctx.check('live-target side: the real Q2 census gate FAILS with STOP identity_unresolvable for CD_I (no remap, no guess)',
    q2?.verdict === 'FAIL' && q2.lines.some((l) => l.startsWith(`${built.providerId} (ledger row ${built.ledgerIds.corrected})`) && l.includes('identity_unresolvable')),
    JSON.stringify(q2));
  ctx.check('live-target side: read-only (fixture state byte-identical)', await fixtureDigest(ctx.owner) === liveBefore);
}

const CASES: Readonly<Record<number, (ctx: Ctx) => Promise<void>>> = {
  33: case33, 34: case34, 35: case35, 36: case36, 37: case37, 38: case38, 39: case39, 40: case40,
  41: case41, 42: case42, 43: case43, 63: case63, 64: case64, 65: case65, 80: case80, 86: case86,
};

/* ==================================================================== *
 * Runner
 * ==================================================================== */

async function runOne(targets: Targets, out: string, caseNo: number, variant: string | null): Promise<{ passed: number; failed: number; unsafe: boolean }> {
  const code = String(caseNo).padStart(3, '0');
  const title = `case ${caseNo}${variant ? ` (${variant})` : ''}`;
  console.log(`\n${'='.repeat(78)}\n== ISSUE-238 Slice-11 promotion rehearsal ${title}\n${'='.repeat(78)}`);
  let passed = 0;
  let failed = 0;
  const check = (label: string, ok: boolean, detail?: string) => {
    if (ok) passed += 1; else failed += 1;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail ? `\n       detail: ${redact(detail)}` : ''}`);
  };
  await preflight(targets);
  const [who] = await targets.owner<{ d: string; u: string }[]>`SELECT current_database() AS d, current_user AS u`;
  console.log(`  session: ${who.u} on ${who.d}`);
  const fpBefore = await foreignFingerprint(targets.owner);
  const seqBefore = await sequenceStates(targets.owner);
  const target = connectTarget(targets.ownerDsn);
  const ctx: Ctx = {
    targets, owner: targets.owner, target, qCand: queryOf(targets.owner), qTgt: queryOf(target), out, caseNo, variant, code, check,
  };
  let caseError: unknown = null;
  try {
    await CASES[caseNo](ctx);
    const fpAfterCase = await foreignFingerprint(targets.owner);
    const diff = fingerprintDiff(fpBefore, fpAfterCase);
    check('foreign fingerprint unchanged by the fixture and the promotion (every non-fixture row of every fixture table)', diff.length === 0, diff.join('; '));
  } catch (error) {
    caseError = error;
    failed += 1;
    console.log(`  FAIL the case threw: ${redact((error as Error).stack ?? String(error))}`);
  } finally {
    await target.end({ timeout: 5 });
    await teardownAll(targets.owner);
    const restored = await restoreSequences(targets.owner, seqBefore);
    for (const line of restored) console.log(`  restore sequence ${line}`);
  }
  const residue = await readResidue(targets.owner);
  const schemaGone = !(await targetSchemaExists(targets.owner));
  const fpAfter = await foreignFingerprint(targets.owner);
  const diffAfter = fingerprintDiff(fpBefore, fpAfter);
  const seqExact = seqText(await sequenceStates(targets.owner)) === seqText(seqBefore);
  check('teardown: zero fixture residue', residueTotal(residue) === 0, nonZero(residue));
  check('teardown: the shadow target schema is gone', schemaGone);
  check('teardown: foreign fingerprint identical to before the case', diffAfter.length === 0, diffAfter.join('; '));
  check('teardown: every public/staging sequence restored exactly', seqExact);
  const unsafe = residueTotal(residue) !== 0 || !schemaGone || diffAfter.length > 0 || !seqExact;
  console.log(`\nISSUE-238 Slice-11 promotion rehearsal ${title}: ${passed}/${passed + failed} checks ${failed === 0 ? 'PASS' : `PASS, ${failed} FAIL`}`);
  if (caseError !== null && failed === 0) failed = 1;
  return { passed, failed, unsafe };
}

async function main(argv: readonly string[]): Promise<number> {
  const command = parsePromotionRehearsalArgs(argv);
  const targets = await connectTargets();
  try {
    if (command.kind === 'residue') {
      const residue = await readResidue(targets.owner);
      const schema = await targetSchemaExists(targets.owner);
      console.log(`residue: ${residueTotal(residue)} fixture row(s) ${nonZero(residue)}; target schema ${T}: ${schema ? 'PRESENT' : 'absent'}`);
      return residueTotal(residue) === 0 && !schema ? 0 : 1;
    }
    if (command.kind === 'teardown') {
      await teardownAll(targets.owner);
      const residue = await readResidue(targets.owner);
      console.log(`teardown: residue ${residueTotal(residue)} ${nonZero(residue)}; target schema ${(await targetSchemaExists(targets.owner)) ? 'PRESENT' : 'absent'}`);
      return residueTotal(residue) === 0 ? 0 : 1;
    }
    const summary: string[] = [];
    let anyFailed = false;
    for (const { caseNo, variant } of command.cases) {
      const { passed, failed, unsafe } = await runOne(targets, command.out, caseNo, variant);
      summary.push(`  case ${caseNo}${variant ? ` (${variant})` : ''}: ${passed}/${passed + failed} ${failed === 0 ? 'PASS' : 'FAIL'}`);
      if (failed > 0) anyFailed = true;
      if (unsafe) {
        summary.push('  STOPPED: teardown left residue, a target schema, a foreign-row change or a sequence drift; no further case runs');
        break;
      }
    }
    console.log(`\n${'='.repeat(78)}\nISSUE-238 Slice-11 promotion rehearsal summary\n${summary.join('\n')}`);
    return anyFailed ? 1 : 0;
  } finally {
    await Promise.all([targets.owner.end({ timeout: 5 }), targets.importer.end({ timeout: 5 })]);
  }
}

if (process.argv[1] && /afl-api-identity-promotion-rehearsal\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(`REFUSED: ${redact((error as Error).message)}`);
      process.exit(1);
    });
}
